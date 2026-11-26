/**
 * 桂林十字街地下街 B1 纹理生成器与零重复 GPU 上传缓存。
 *
 * 约定：
 * 1. 所有 PBR 地砖、楼梯踏步、银白铝合金条形吊顶（含稀疏嵌入式线性灯盘）、波纹卷帘门与墙裙贴图
 *    使用纯不透明 RGB（a=255）确定性 DataTexture（无 Alpha 预乘污染），1:1 映射 `web/public/shizijie/textures/` 导出资产。
 * 2. 合批图集严格控制 <= 2 张（atlas-signs-albedo 1024×512 + atlas-wayfinding-albedo 1024×256），
 *    总纹理显存（含 Mipmap）严格 <= 8 MiB（SZJ_BUDGET.indoorTextureBytesMax）硬约束。
 * 3. TextureUploadCache 单例按逻辑 key 去重，0 重复 GPU 上传。
 */

import * as THREE from 'three'
import {
  SHIZIJIE_PALETTE,
  SHIZIJIE_SIGN_FONTS,
  SHIZIJIE_TEXTURE_BUDGET_BYTES,
  SZJ_SIGN_ATLAS_RECTS,
  SZJ_SIGN_META,
  type AtlasRect,
} from './palette.ts'

export const SHIZIJIE_PUBLIC_TEXTURE_URLS = Object.freeze({
  atlasSignsAlbedo: new URL('../../../public/shizijie/textures/atlas-signs-albedo.png', import.meta.url).href,
  atlasWayfindingAlbedo: new URL('../../../public/shizijie/textures/atlas-wayfinding-albedo.png', import.meta.url).href,
  tileTerrazzoAlbedo: new URL('../../../public/shizijie/textures/tile-terrazzo-albedo.png', import.meta.url).href,
  tileTerrazzoNormal: new URL('../../../public/shizijie/textures/tile-terrazzo-normal.png', import.meta.url).href,
  tileTerrazzoRoughness: new URL('../../../public/shizijie/textures/tile-terrazzo-roughness.png', import.meta.url).href,
  tileCorridorAlbedo: new URL('../../../public/shizijie/textures/tile-corridor-albedo.png', import.meta.url).href,
  tileCorridorNormal: new URL('../../../public/shizijie/textures/tile-corridor-normal.png', import.meta.url).href,
  tileCorridorRoughness: new URL('../../../public/shizijie/textures/tile-corridor-roughness.png', import.meta.url).href,
  ceilingGridAlbedo: new URL('../../../public/shizijie/textures/ceiling-grid-albedo.png', import.meta.url).href,
  ceilingGridEmissive: new URL('../../../public/shizijie/textures/ceiling-grid-emissive.png', import.meta.url).href,
  ceilingGridRoughness: new URL('../../../public/shizijie/textures/ceiling-grid-roughness.png', import.meta.url).href,
  lightStrip: new URL('../../../public/shizijie/textures/light-strip.png', import.meta.url).href,
  shutterSilverAlbedo: new URL('../../../public/shizijie/textures/shutter-silver-albedo.png', import.meta.url).href,
  shutterCreamAlbedo: new URL('../../../public/shizijie/textures/shutter-cream-albedo.png', import.meta.url).href,
  shutterNormal: new URL('../../../public/shizijie/textures/shutter-normal.png', import.meta.url).href,
  shutterRoughness: new URL('../../../public/shizijie/textures/shutter-roughness.png', import.meta.url).href,
  stairGraniteAlbedo: new URL('../../../public/shizijie/textures/stair-granite-albedo.png', import.meta.url).href,
  stairGraniteRoughness: new URL('../../../public/shizijie/textures/stair-granite-roughness.png', import.meta.url).href,
  stairTreadAlbedo: new URL('../../../public/shizijie/textures/stair-tread-albedo.png', import.meta.url).href,
  stairTreadNormal: new URL('../../../public/shizijie/textures/stair-tread-normal.png', import.meta.url).href,
  wallCorridorAlbedo: new URL('../../../public/shizijie/textures/wall-corridor-albedo.png', import.meta.url).href,
  wallCorridorNormal: new URL('../../../public/shizijie/textures/wall-corridor-normal.png', import.meta.url).href,
  wallCorridorRoughness: new URL('../../../public/shizijie/textures/wall-corridor-roughness.png', import.meta.url).href,
  canopyGlassAlbedo: new URL('../../../public/shizijie/textures/canopy-glass-albedo.png', import.meta.url).href,
})

export interface TextureBudgetEntry {
  readonly key: string
  readonly width: number
  readonly height: number
  readonly rawBytes: number
  readonly mipmappedBytes: number
  readonly kind: 'albedo' | 'normal' | 'roughness' | 'emissive'
  readonly uses: number
}

export interface TextureBudgetSnapshot {
  readonly limitBytes: number
  readonly rawBytes: number
  readonly mipmappedBytes: number
  readonly uniqueTextureCount: number
  readonly atlasSheetCount: number
  readonly acquireCalls: number
  readonly cacheHits: number
  readonly duplicateUploadCount: number
  readonly entries: readonly TextureBudgetEntry[]
}

export interface TextureUploadCache {
  acquire(spec: {
    key: string
    width: number
    height: number
    kind: 'albedo' | 'normal' | 'roughness' | 'emissive'
    isAtlas?: boolean
    build: () => THREE.Texture
  }): THREE.Texture
  getSnapshot(): TextureBudgetSnapshot
  releaseAll(): void
}

function estimateMipBytes(rawBytes: number): number {
  return Math.ceil((rawBytes * 4) / 3)
}

export function createTextureUploadCache(): TextureUploadCache {
  const map = new Map<
    string,
    {
      tex: THREE.Texture
      width: number
      height: number
      rawBytes: number
      mipmappedBytes: number
      kind: 'albedo' | 'normal' | 'roughness' | 'emissive'
      isAtlas: boolean
      uses: number
    }
  >()
  let acquireCalls = 0
  let cacheHits = 0

  return {
    acquire({ key, width, height, kind, isAtlas = false, build }) {
      acquireCalls++
      const existing = map.get(key)
      if (existing) {
        cacheHits++
        existing.uses++
        return existing.tex
      }
      const tex = build()
      const rawBytes = width * height * 4
      map.set(key, {
        tex,
        width,
        height,
        rawBytes,
        mipmappedBytes: estimateMipBytes(rawBytes),
        kind,
        isAtlas,
        uses: 1,
      })
      return tex
    },
    getSnapshot() {
      let rawBytes = 0
      let mipmappedBytes = 0
      let atlasSheetCount = 0
      const entries: TextureBudgetEntry[] = []
      const seenUuids = new Set<string>()
      let duplicateUploadCount = 0

      for (const [key, rec] of map.entries()) {
        rawBytes += rec.rawBytes
        mipmappedBytes += rec.mipmappedBytes
        if (rec.isAtlas) atlasSheetCount++
        if (seenUuids.has(rec.tex.uuid)) duplicateUploadCount++
        seenUuids.add(rec.tex.uuid)
        entries.push({
          key,
          width: rec.width,
          height: rec.height,
          rawBytes: rec.rawBytes,
          mipmappedBytes: rec.mipmappedBytes,
          kind: rec.kind,
          uses: rec.uses,
        })
      }

      return {
        limitBytes: SHIZIJIE_TEXTURE_BUDGET_BYTES,
        rawBytes,
        mipmappedBytes,
        uniqueTextureCount: map.size,
        atlasSheetCount,
        acquireCalls,
        cacheHits,
        duplicateUploadCount,
        entries,
      }
    },
    releaseAll() {
      for (const rec of map.values()) rec.tex.dispose()
      map.clear()
    },
  }
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
}

function hexRgb(hex: string): readonly [number, number, number] {
  const s = hex.replace('#', '')
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)] as const
}

function makeRng(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0
    return (s >>> 0) / 4294967296
  }
}

function hash2D(x: number, y: number, periodX: number, periodY: number, seed: number): number {
  const wx = ((x % periodX) + periodX) % periodX
  const wy = ((y % periodY) + periodY) % periodY
  let h = (wx * 374761393 + wy * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function tileNoiseRect(x: number, y: number, w: number, h: number, cell: number, seed: number): number {
  const px = Math.max(2, Math.floor(w / cell))
  const py = Math.max(2, Math.floor(h / cell))
  const fx = x / cell
  const fy = y / cell
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)
  const n00 = hash2D(x0, y0, px, py, seed)
  const n10 = hash2D(x0 + 1, y0, px, py, seed)
  const n01 = hash2D(x0, y0 + 1, px, py, seed)
  const n11 = hash2D(x0 + 1, y0 + 1, px, py, seed)
  return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy
}

function tileNoise(x: number, y: number, size: number, cell: number, seed: number): number {
  return tileNoiseRect(x, y, size, size, cell, seed)
}

function heightFieldToNormalRgba(height: Float32Array, w: number, h: number, strength: number): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const ym = (y - 1 + h) % h
    const yp = (y + 1) % h
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w
      const xp = (x + 1) % w
      const dx = (height[y * w + xp]! - height[y * w + xm]!) * strength
      const dy = (height[yp * w + x]! - height[ym * w + x]!) * strength
      const nx = -dx
      const ny = -dy
      const nz = 1
      const inv = 1 / Math.hypot(nx, ny, nz)
      const p = (y * w + x) * 4
      out[p] = clampByte((nx * inv * 0.5 + 0.5) * 255)
      out[p + 1] = clampByte((ny * inv * 0.5 + 0.5) * 255)
      out[p + 2] = clampByte((nz * inv * 0.5 + 0.5) * 255)
      out[p + 3] = 255
    }
  }
  return out
}

function makeDataTexture(
  data: Uint8Array,
  w: number,
  h: number,
  srgb: boolean,
  repeat: readonly [number, number] | null,
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat)
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.anisotropy = 4
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(repeat[0], repeat[1])
  } else {
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  }
  tex.needsUpdate = true
  return tex
}

export function buildTerrazzoMaps(cache: TextureUploadCache) {
  const map = cache.acquire({
    key: 'szj:terrazzo:albedo',
    width: 256,
    height: 256,
    kind: 'albedo',
    build() {
      const data = new Uint8Array(256 * 256 * 4)
      const base = SHIZIJIE_PALETTE.terrazzoBase.rgb
      const grout = SHIZIJIE_PALETTE.terrazzoGrout.rgb
      const rng = makeRng(707)
      // 真实高反差黑白灰矿物碎石（软边缘混合 + 骨料间 1px 细矿物点噪，摆脱硬边贴纸与平滑水泥底）
      const chips: Array<readonly [number, number, number]> = [
        [40, 42, 46],
        [60, 62, 66],
        [208, 204, 194],
        [156, 132, 110],
        [92, 96, 102],
        [182, 178, 168],
      ]
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const tileIx = Math.floor(x / 128)
          const tileIy = Math.floor(y / 128)
          const slabTint = (hash2D(tileIx, tileIy, 2, 2, 711) - 0.5) * 10
          const fineSand = hash2D(x, y, 256, 256, 715)
          const sandDelta = fineSand > 0.86 ? 26 : fineSand < 0.16 ? -26 : (fineSand - 0.5) * 14
          const n = tileNoise(x, y, 256, 6, 102) - 0.5
          const isSeam = x % 128 < 1 || y % 128 < 1
          const p = (y * 256 + x) * 4
          if (isSeam) {
            data[p] = grout[0]
            data[p + 1] = grout[1]
            data[p + 2] = grout[2]
          } else {
            const delta = n * 16 + sandDelta + slabTint
            data[p] = clampByte(base[0] + delta)
            data[p + 1] = clampByte(base[1] + delta)
            data[p + 2] = clampByte(base[2] + delta)
          }
          data[p + 3] = 255
        }
      }
      // 柔和边缘多边形骨料碎石（边缘与基底半透明融合，防卡通锯齿贴纸感）
      for (let i = 0; i < 880; i++) {
        const cx = rng() * 256
        const cy = rng() * 256
        const col = chips[Math.floor(rng() * chips.length)]!
        const a0 = rng() * Math.PI * 2
        const vCount = 4 + Math.floor(rng() * 3)
        const baseR = 1.3 + rng() * 2.2
        const vx: number[] = []
        const vy: number[] = []
        for (let k = 0; k < vCount; k++) {
          const ang = a0 + (k / vCount) * Math.PI * 2 + (rng() - 0.5) * 0.35
          const rad = baseR * (0.55 + rng() * 0.75)
          vx.push(Math.cos(ang) * rad)
          vy.push(Math.sin(ang) * rad)
        }
        const bound = Math.ceil(baseR * 1.35)
        for (let dy = -bound; dy <= bound; dy++) {
          for (let dx = -bound; dx <= bound; dx++) {
            let inside = false
            for (let a = 0, b = vCount - 1; a < vCount; b = a++) {
              const yi = vy[a]!
              const yj = vy[b]!
              const xi = vx[a]!
              const xj = vx[b]!
              if ((yi > dy) !== (yj > dy) && dx < ((xj - xi) * (dy - yi)) / (yj - yi + 1e-6) + xi) {
                inside = !inside
              }
            }
            if (!inside) continue
            const px = (Math.round(cx + dx) + 256) % 256
            const py = (Math.round(cy + dy) + 256) % 256
            if (px % 128 < 1 || py % 128 < 1) continue
            const idx = (py * 256 + px) * 4
            const edgeBlend = Math.hypot(dx, dy) > baseR * 0.65 ? 0.65 : 0.9
            data[idx] = clampByte(data[idx]! * (1 - edgeBlend) + col[0] * edgeBlend)
            data[idx + 1] = clampByte(data[idx + 1]! * (1 - edgeBlend) + col[1] * edgeBlend)
            data[idx + 2] = clampByte(data[idx + 2]! * (1 - edgeBlend) + col[2] * edgeBlend)
          }
        }
      }
      return makeDataTexture(data, 256, 256, true, [1, 1])
    },
  })

  const normalMap = cache.acquire({
    key: 'szj:terrazzo:normal',
    width: 128,
    height: 128,
    kind: 'normal',
    build() {
      const h = new Float32Array(128 * 128)
      for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 128; x++) {
          const tileX = Math.floor(x / 64)
          const tileY = Math.floor(y / 64)
          const tiltX = (hash2D(tileX, tileY, 2, 2, 721) - 0.5) * 0.14
          const tiltY = (hash2D(tileX, tileY, 2, 2, 722) - 0.5) * 0.14
          const seam = x % 64 < 1 || y % 64 < 1 ? -0.68 : 0
          h[y * 128 + x] =
            tileNoise(x, y, 128, 10, 103) * 0.24 + ((x % 64) / 64) * tiltX + ((y % 64) / 64) * tiltY + seam
        }
      }
      return makeDataTexture(heightFieldToNormalRgba(h, 128, 128, 2.2), 128, 128, false, [1, 1])
    },
  })

  const roughnessMap = cache.acquire({
    key: 'szj:terrazzo:roughness',
    width: 64,
    height: 64,
    kind: 'roughness',
    build() {
      const data = new Uint8Array(64 * 64 * 4)
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const seam = x % 32 < 1 || y % 32 < 1
          const tileR = (hash2D(Math.floor(x / 32), Math.floor(y / 32), 2, 2, 723) - 0.5) * 0.05
          const wear = tileNoise(x, y, 64, 12, 105) * 0.06
          const val = clampByte((seam ? 0.78 : 0.11 + tileNoise(x, y, 64, 4, 104) * 0.06 + wear + tileR) * 255)
          const p = (y * 64 + x) * 4
          data[p] = data[p + 1] = data[p + 2] = val
          data[p + 3] = 255
        }
      }
      return makeDataTexture(data, 64, 64, false, [1, 1])
    },
  })

  return { map, normalMap, roughnessMap }
}

export function buildCorridorTileMaps(cache: TextureUploadCache) {
  const map = cache.acquire({
    key: 'szj:corridor-tile:albedo',
    width: 256,
    height: 256,
    kind: 'albedo',
    build() {
      const data = new Uint8Array(256 * 256 * 4)
      const base = SHIZIJIE_PALETTE.corridorTileBase.rgb
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const slabTint = (hash2D(Math.floor(x / 128), Math.floor(y / 128), 2, 2, 207) - 0.5) * 8
          // 紧实高密芝麻灰花岗岩（1px/3px 锐利黑白灰盐椒晶粒 + 极微云斑 + 1px 细灰拼缝）
          const subtleCloud = (tileNoise(x, y, 256, 20, 201) - 0.5) * 10
          const fine = (tileNoise(x, y, 256, 3, 212) - 0.5) * 20
          const fleck = hash2D(x, y, 256, 256, 209)
          const crystal = fleck > 0.82 ? 32 : fleck < 0.22 ? -34 : (fleck - 0.5) * 18
          const seam = x % 128 < 1 || y % 128 < 1
          const p = (y * 256 + x) * 4
          if (seam) {
            data[p] = 74
            data[p + 1] = 72
            data[p + 2] = 68
          } else {
            const d = subtleCloud + fine + crystal + slabTint
            data[p] = clampByte(base[0] + d)
            data[p + 1] = clampByte(base[1] + d)
            data[p + 2] = clampByte(base[2] + d)
          }
          data[p + 3] = 255
        }
      }
      return makeDataTexture(data, 256, 256, true, [1, 1])
    },
  })

  const normalMap = cache.acquire({
    key: 'szj:corridor-tile:normal',
    width: 128,
    height: 128,
    kind: 'normal',
    build() {
      const h = new Float32Array(128 * 128)
      for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 128; x++) {
          const tileX = Math.floor(x / 64)
          const tileY = Math.floor(y / 64)
          const tilt = ((x % 64) / 64) * ((hash2D(tileX, tileY, 2, 2, 211) - 0.5) * 0.14)
          h[y * 128 + x] = tileNoise(x, y, 128, 18, 203) * 0.18 + tilt - (x % 64 < 1 || y % 64 < 1 ? 0.65 : 0)
        }
      }
      return makeDataTexture(heightFieldToNormalRgba(h, 128, 128, 2.2), 128, 128, false, [1, 1])
    },
  })

  const roughnessMap = cache.acquire({
    key: 'szj:corridor-tile:roughness',
    width: 64,
    height: 64,
    kind: 'roughness',
    build() {
      const data = new Uint8Array(64 * 64 * 4)
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const seam = x % 32 < 1 || y % 32 < 1
          const tileR = (hash2D(Math.floor(x / 32), Math.floor(y / 32), 2, 2, 213) - 0.5) * 0.05
          const wear = tileNoise(x, y, 64, 7, 204) * 0.06
          const val = clampByte((seam ? 0.76 : 0.10 + wear + tileR) * 255)
          const p = (y * 64 + x) * 4
          data[p] = data[p + 1] = data[p + 2] = val
          data[p + 3] = 255
        }
      }
      return makeDataTexture(data, 64, 64, false, [1, 1])
    },
  })

  return { map, normalMap, roughnessMap }
}

/**
 * 吊顶纹理重构（对标 BV1b8411r7EP_sheet_1 R3 + 17_xxg 实拍）：
 * - 银白拉丝铝合金大块扣板 + 极细浅银接缝（彻底淘汰压迫视觉的黑框与大白方块污染）
 * - 真正稀疏（面积约 10.6%）的纤细嵌入式冷白条形灯盘 + 细银框压边 + 精细线性格栅风口
 */
export function buildCeilingGridMaps(cache: TextureUploadCache) {
  const W = 256
  const H = 128
  const isTrofferLed = (x: number, y: number): boolean => x >= 24 && x <= 232 && y >= 57 && y <= 71
  const isTrofferBezel = (x: number, y: number): boolean =>
    x >= 22 && x <= 234 && y >= 55 && y <= 73 && !isTrofferLed(x, y)

  const map = cache.acquire({
    key: 'szj:ceiling-grid:albedo',
    width: W,
    height: H,
    kind: 'albedo',
    build() {
      const data = new Uint8Array(W * H * 4)
      const board = SHIZIJIE_PALETTE.ceilingBoard.rgb
      const seamCol = SHIZIJIE_PALETTE.ceilingGridBaffle.rgb
      const lamp = SHIZIJIE_PALETTE.lightStripCool.rgb
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const seam = x % 128 === 0 || y % 64 === 0
          const ventLouver = x >= 202 && x <= 238 && y >= 12 && y <= 24 && y % 3 === 0
          const brush = (tileNoiseRect(x, y, W, H, 8, 251) - 0.5) * 5
          const p = (y * W + x) * 4
          if (isTrofferLed(x, y)) {
            data[p] = lamp[0]
            data[p + 1] = lamp[1]
            data[p + 2] = lamp[2]
          } else if (isTrofferBezel(x, y)) {
            data[p] = 158
            data[p + 1] = 166
            data[p + 2] = 178
          } else if (ventLouver) {
            data[p] = 172
            data[p + 1] = 178
            data[p + 2] = 186
          } else if (seam) {
            data[p] = seamCol[0]
            data[p + 1] = seamCol[1]
            data[p + 2] = seamCol[2]
          } else {
            data[p] = clampByte(board[0] + brush)
            data[p + 1] = clampByte(board[1] + brush)
            data[p + 2] = clampByte(board[2] + brush)
          }
          data[p + 3] = 255
        }
      }
      return makeDataTexture(data, W, H, true, [1, 1])
    },
  })

  const emissiveMap = cache.acquire({
    key: 'szj:ceiling-grid:emissive',
    width: W,
    height: H,
    kind: 'emissive',
    build() {
      const data = new Uint8Array(W * H * 4)
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const p = (y * W + x) * 4
          if (isTrofferLed(x, y)) {
            const dy = Math.abs((y - 64) / 7)
            const k = 1 - dy * dy * 0.2
            data[p] = clampByte(240 * k)
            data[p + 1] = clampByte(246 * k)
            data[p + 2] = clampByte(252 * k)
          } else {
            data[p] = data[p + 1] = data[p + 2] = 0
          }
          data[p + 3] = 255
        }
      }
      return makeDataTexture(data, W, H, true, [1, 1])
    },
  })

  const roughnessMap = cache.acquire({
    key: 'szj:ceiling-grid:roughness',
    width: 64,
    height: 64,
    kind: 'roughness',
    build() {
      const data = new Uint8Array(64 * 64 * 4)
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const bezel = y >= 27 && y <= 37
          const val = clampByte((bezel ? 0.26 : 0.40 + tileNoise(x, y, 64, 6, 253) * 0.12) * 255)
          const p = (y * 64 + x) * 4
          data[p] = data[p + 1] = data[p + 2] = val
          data[p + 3] = 255
        }
      }
      return makeDataTexture(data, 64, 64, false, [1, 1])
    },
  })

  return { map, emissiveMap, roughnessMap }
}

export function buildLightStripTexture(cache: TextureUploadCache): THREE.Texture {
  return cache.acquire({
    key: 'szj:light-strip:shared',
    width: 64,
    height: 32,
    kind: 'albedo',
    build() {
      const data = new Uint8Array(64 * 32 * 4)
      for (let y = 0; y < 32; y++) {
        const bevel = y >= 2 && y <= 29
        const dist = Math.abs(y / 31 - 0.5) * 2
        const falloff = Math.max(0.12, Math.min(1, 1 - Math.pow(dist, 1.8)))
        for (let x = 0; x < 64; x++) {
          const p = (y * 64 + x) * 4
          if (bevel) {
            data[p] = clampByte(246 * falloff)
            data[p + 1] = clampByte(244 * falloff)
            data[p + 2] = clampByte(238 * falloff)
          } else {
            data[p] = 72
            data[p + 1] = 78
            data[p + 2] = 86
          }
          data[p + 3] = 255
        }
      }
      return makeDataTexture(data, 64, 32, true, [1, 1])
    },
  })
}

export function buildRollerShutterMaps(cache: TextureUploadCache, variant: 'silver' | 'cream') {
  const baseRgb =
    variant === 'silver' ? SHIZIJIE_PALETTE.rollerShutterSilver.rgb : SHIZIJIE_PALETTE.rollerShutterCream.rgb
  const amp = variant === 'silver' ? 22 : 18
  const seed = variant === 'silver' ? 301 : 302

  const map = cache.acquire({
    key: `szj:shutter:${variant}:albedo`,
    width: 128,
    height: 256,
    kind: 'albedo',
    build() {
      // DataTexture flipY=false: y=0 为卷帘门底部（贴地橡胶封条 + 下端锁盒）
      const data = new Uint8Array(128 * 256 * 4)
      for (let y = 0; y < 256; y++) {
        const wave = Math.sin((y / 256) * Math.PI * 2 * 16)
        const rib = y % 16 < 2
        const seal = y < 14
        const topShadow = y > 246
        for (let x = 0; x < 128; x++) {
          const p = (y * 128 + x) * 4
          const lock = y >= 24 && y <= 40 && x >= 50 && x <= 78
          if (seal) {
            data[p] = variant === 'silver' ? 38 : 48
            data[p + 1] = variant === 'silver' ? 42 : 46
            data[p + 2] = variant === 'silver' ? 48 : 42
          } else if (lock) {
            data[p] = 58
            data[p + 1] = 62
            data[p + 2] = 68
          } else {
            const streak = (tileNoiseRect(x, y, 128, 256, 8, seed) - 0.5) * 9
            const ao = topShadow ? 0.78 : 1
            const factor = (rib ? 0.75 : 1) * ao
            data[p] = clampByte((baseRgb[0] + wave * amp + streak) * factor)
            data[p + 1] = clampByte((baseRgb[1] + wave * amp + streak) * factor)
            data[p + 2] = clampByte((baseRgb[2] + wave * amp + streak) * factor)
          }
          data[p + 3] = 255
        }
      }
      return makeDataTexture(data, 128, 256, true, [1, 1])
    },
  })

  const normalMap = cache.acquire({
    key: 'szj:shutter:shared:normal',
    width: 64,
    height: 128,
    kind: 'normal',
    build() {
      const h = new Float32Array(64 * 128)
      for (let y = 0; y < 128; y++) {
        const wave = Math.sin((y / 128) * Math.PI * 2 * 16) * 0.58 - (y % 8 < 1 ? 0.36 : 0)
        for (let x = 0; x < 64; x++) h[y * 64 + x] = wave
      }
      return makeDataTexture(heightFieldToNormalRgba(h, 64, 128, 4.2), 64, 128, false, [1, 1])
    },
  })

  const roughnessMap = cache.acquire({
    key: 'szj:shutter:shared:roughness',
    width: 64,
    height: 128,
    kind: 'roughness',
    build() {
      const data = new Uint8Array(64 * 128 * 4)
      for (let y = 0; y < 128; y++) {
        const val = clampByte((0.26 + 0.16 * Math.abs(Math.sin((y / 128) * Math.PI * 2 * 16))) * 255)
        for (let x = 0; x < 64; x++) {
          const p = (y * 64 + x) * 4
          data[p] = data[p + 1] = data[p + 2] = val
          data[p + 3] = 255
        }
      }
      return makeDataTexture(data, 64, 128, false, [1, 1])
    },
  })

  return { map, normalMap, roughnessMap }
}

export function buildStairAndWallMaps(cache: TextureUploadCache) {
  const stairGraniteAlbedo = cache.acquire({
    key: 'szj:stair:granite:albedo',
    width: 256,
    height: 256,
    kind: 'albedo',
    build() {
      const data = new Uint8Array(256 * 256 * 4)
      const base = SHIZIJIE_PALETTE.stairGranite.rgb
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const n =
            tileNoise(x, y, 256, 20, 401) * 0.45 +
            tileNoise(x, y, 256, 6, 402) * 0.35 +
            Math.sin(x * 0.05 + y * 0.03 + tileNoise(x, y, 256, 28, 405) * 3.0) * 0.12
          const seam = x % 128 < 2 || y % 64 < 2
          const floorAo = y < 16 ? 0.8 + (y / 16) * 0.2 : 1
          const p = (y * 256 + x) * 4
          if (seam) {
            data[p] = 56
            data[p + 1] = 59
            data[p + 2] = 64
          } else {
            const k = (1 + (n - 0.5) * 0.36) * floorAo
            data[p] = clampByte(base[0] * k)
            data[p + 1] = clampByte(base[1] * k)
            data[p + 2] = clampByte(base[2] * k)
          }
          data[p + 3] = 255
        }
      }
      return makeDataTexture(data, 256, 256, true, [1, 1])
    },
  })

  const stairGraniteRoughness = cache.acquire({
    key: 'szj:stair:granite:roughness',
    width: 64,
    height: 64,
    kind: 'roughness',
    build() {
      const data = new Uint8Array(64 * 64 * 4)
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const seam = x % 32 < 1 || y % 16 < 1
          const val = clampByte((seam ? 0.75 : 0.34 + tileNoise(x, y, 64, 4, 402) * 0.16) * 255)
          const p = (y * 64 + x) * 4
          data[p] = data[p + 1] = data[p + 2] = val
          data[p + 3] = 255
        }
      }
      return makeDataTexture(data, 64, 64, false, [1, 1])
    },
  })

  const stairTreadAlbedo = cache.acquire({
    key: 'szj:stair:tread:albedo',
    width: 128,
    height: 256,
    kind: 'albedo',
    build() {
      const data = new Uint8Array(128 * 256 * 4)
      const nosing = SHIZIJIE_PALETTE.stairNosingYellow.rgb
      for (let y = 0; y < 256; y++) {
        const isNosing = y < 36
        const isGroove = y >= 44 && y <= 76 && y % 10 < 4
        for (let x = 0; x < 128; x++) {
          const p = (y * 128 + x) * 4
          if (isNosing) {
            data[p] = nosing[0]
            data[p + 1] = nosing[1]
            data[p + 2] = nosing[2]
          } else if (isGroove) {
            data[p] = 64
            data[p + 1] = 63
            data[p + 2] = 60
          } else {
            const n = tileNoiseRect(x, y, 128, 256, 8, 403)
            data[p] = clampByte(116 + (n - 0.5) * 32)
            data[p + 1] = clampByte(114 + (n - 0.5) * 32)
            data[p + 2] = clampByte(110 + (n - 0.5) * 30)
          }
          data[p + 3] = 255
        }
      }
      return makeDataTexture(data, 128, 256, true, [1, 1])
    },
  })

  const stairTreadNormal = cache.acquire({
    key: 'szj:stair:tread:normal',
    width: 64,
    height: 128,
    kind: 'normal',
    build() {
      const h = new Float32Array(64 * 128)
      for (let y = 0; y < 128; y++) {
        const groove = y >= 22 && y <= 38 && y % 5 < 2 ? -0.75 : 0
        for (let x = 0; x < 64; x++) h[y * 64 + x] = tileNoiseRect(x, y, 64, 128, 4, 404) * 0.25 + groove
      }
      return makeDataTexture(heightFieldToNormalRgba(h, 64, 128, 3.2), 64, 128, false, [1, 1])
    },
  })

  const wallAlbedo = cache.acquire({
    key: 'szj:wall:corridor:albedo',
    width: 256,
    height: 256,
    kind: 'albedo',
    build() {
      // indoor-scene.ts 将下部 1.04m 独立赋予 stairGranite(dadoSpecs)，wallCorridor 贴于 y=1.04..3.25m 上墙（世界 UV v=0.325..1.016）
      // 采用无缝纯净暖白微水泥饰面 + 1.4m 竖向饰面板勾缝 + 顶部阴角 AO（避免局部底边腰线因 UV 起点偏移错位或消失）
      const data = new Uint8Array(256 * 256 * 4)
      const upperRgb = SHIZIJIE_PALETTE.wallPlaster.rgb
      for (let y = 0; y < 256; y++) {
        const ceilingAo = y > 236 ? 1 - ((y - 236) / 20) * 0.14 : 1
        for (let x = 0; x < 256; x++) {
          const p = (y * 256 + x) * 4
          const panelSeam = x % 128 < 2
          const stucco = (tileNoise(x, y, 256, 12, 501) - 0.5) * 11
          const wear = (tileNoise(x, y, 256, 48, 503) - 0.5) * 6
          const k = (panelSeam ? 0.86 : 1) * ceilingAo
          data[p] = clampByte((upperRgb[0] + stucco + wear) * k)
          data[p + 1] = clampByte((upperRgb[1] + stucco + wear) * k)
          data[p + 2] = clampByte((upperRgb[2] + stucco + wear) * k)
          data[p + 3] = 255
        }
      }
      return makeDataTexture(data, 256, 256, true, [1, 1])
    },
  })

  const wallNormal = cache.acquire({
    key: 'szj:wall:corridor:normal',
    width: 64,
    height: 64,
    kind: 'normal',
    build() {
      const h = new Float32Array(64 * 64)
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const verticalSeam = x % 32 < 1 ? -0.4 : 0
          const stucco = tileNoise(x, y, 64, 3, 504) * 0.22
          h[y * 64 + x] = stucco + verticalSeam
        }
      }
      return makeDataTexture(heightFieldToNormalRgba(h, 64, 64, 2.0), 64, 64, false, [1, 1])
    },
  })

  const wallRoughness = cache.acquire({
    key: 'szj:wall:corridor:roughness',
    width: 64,
    height: 64,
    kind: 'roughness',
    build() {
      const data = new Uint8Array(64 * 64 * 4)
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const panelSeam = x % 32 < 1
          const baseR = panelSeam ? 0.92 : 0.78 + tileNoise(x, y, 64, 8, 501) * 0.08
          const val = clampByte(baseR * 255)
          const p = (y * 64 + x) * 4
          data[p] = data[p + 1] = data[p + 2] = val
          data[p + 3] = 255
        }
      }
      return makeDataTexture(data, 64, 64, false, [1, 1])
    },
  })

  const canopyGlass = cache.acquire({
    key: 'szj:canopy:glass:albedo',
    width: 64,
    height: 64,
    kind: 'albedo',
    build() {
      // IDOK-385 §5.3：保持纯不透明 RGB（a=255），透明感由材质 opacity=0.72 控制，避免预乘污染
      const data = new Uint8Array(64 * 64 * 4)
      const gCol = SHIZIJIE_PALETTE.canopyGlassBlue.rgb
      const truss = SHIZIJIE_PALETTE.canopyTrussDark.rgb
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const mullion = x % 32 < 2 || y % 32 < 2
          const sheen = Math.sin((x + y) * 0.16) * 8
          const p = (y * 64 + x) * 4
          if (mullion) {
            data[p] = truss[0]
            data[p + 1] = truss[1]
            data[p + 2] = truss[2]
          } else {
            data[p] = clampByte(gCol[0] + sheen)
            data[p + 1] = clampByte(gCol[1] + sheen)
            data[p + 2] = clampByte(gCol[2] + sheen)
          }
          data[p + 3] = 255
        }
      }
      return makeDataTexture(data, 64, 64, true, [1, 1])
    },
  })

  return {
    stairGraniteAlbedo,
    stairGraniteRoughness,
    stairTreadAlbedo,
    stairTreadNormal,
    wallAlbedo,
    wallNormal,
    wallRoughness,
    canopyGlass,
  }
}

function paintRectRgba(
  buf: Uint8Array,
  bufW: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: readonly [number, number, number],
): void {
  const cx0 = Math.max(0, x0)
  const cy0 = Math.max(0, y0)
  const cx1 = Math.min(bufW, x1)
  for (let y = cy0; y < y1; y++) {
    for (let x = cx0; x < cx1; x++) {
      const p = (y * bufW + x) * 4
      buf[p] = rgb[0]
      buf[p + 1] = rgb[1]
      buf[p + 2] = rgb[2]
      buf[p + 3] = 255
    }
  }
}

function drawSignAtlasCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.scale(w / 1024, h / 512)
  ctx.fillStyle = '#20262e'
  ctx.fillRect(0, 0, 1024, 512)

  for (const item of SZJ_SIGN_META) {
    const rect: AtlasRect = SZJ_SIGN_ATLAS_RECTS[item.slot]
    const x = Math.round(rect[0] * 1024)
    const y = Math.round(rect[1] * 512)
    const rw = Math.round((rect[2] - rect[0]) * 1024)
    const rh = Math.round((rect[3] - rect[1]) * 512)

    const isExit = item.slot.startsWith('exit')
    const isCanopyHdr = item.slot === 'canopyHeader'
    const isSafetyExit = item.slot === 'safetyExit'
    const zhSize = rw >= 400 ? 22 : isCanopyHdr ? 17 : isExit ? 17 : 19
    const zhY = isCanopyHdr ? y + 18 : y + 22
    const zhMaxW = isCanopyHdr ? rw - 26 : rw - 26

    // 全格填充 bgHex（保证外圈 0..4px bleed 安全区无 #20262e 漏边），内框缩进至 5px
    ctx.fillStyle = item.bgHex
    ctx.fillRect(x, y, rw, rh)

    if (item.backlit) {
      const grad = ctx.createLinearGradient(x, y + 4, x, y + rh - 4)
      grad.addColorStop(0, 'rgba(255,255,255,0.08)')
      grad.addColorStop(0.55, 'rgba(255,255,255,0.01)')
      grad.addColorStop(1, 'rgba(0,0,0,0.09)')
      ctx.fillStyle = grad
      ctx.fillRect(x + 4, y + 4, rw - 8, rh - 8)
    }

    if (isCanopyHdr) {
      const midY = y + Math.floor(rh * 0.53)
      ctx.fillStyle = '#222730'
      ctx.fillRect(x + 5, midY, rw - 10, y + rh - 5 - midY)
      ctx.strokeStyle = '#58616e'
      ctx.lineWidth = 1.5
      ctx.strokeRect(x + 5, y + 5, rw - 10, rh - 10)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = item.fgHex
      ctx.font = `700 ${zhSize}px ${SHIZIJIE_SIGN_FONTS.sans}`
      ctx.fillText(item.zh, x + rw / 2, zhY, zhMaxW)
      ctx.fillStyle = '#ebd798'
      ctx.font = `700 11px ${SHIZIJIE_SIGN_FONTS.condensed}`
      ctx.fillText(item.en, x + rw / 2, midY + (y + rh - 5 - midY) / 2, rw - 24)
    } else if (isSafetyExit) {
      // 安全出口：左侧国标白色逃生门+奔跑小人图标，薄银绿框
      ctx.strokeStyle = '#89c4a2'
      ctx.lineWidth = 1.5
      ctx.strokeRect(x + 5, y + 5, rw - 10, rh - 10)
      // Running man + exit doorway icon
      const ix = x + 16
      const iy = y + 14
      ctx.fillStyle = '#f4fbf7'
      ctx.fillRect(ix, iy, 16, 26)
      ctx.fillStyle = item.bgHex
      ctx.beginPath()
      ctx.arc(ix + 9, iy + 6, 2.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = item.bgHex
      ctx.lineWidth = 2.4
      ctx.beginPath()
      ctx.moveTo(ix + 8, iy + 9)
      ctx.lineTo(ix + 7, iy + 17)
      ctx.lineTo(ix + 3, iy + 23)
      ctx.moveTo(ix + 7, iy + 17)
      ctx.lineTo(ix + 12, iy + 22)
      ctx.moveTo(ix + 4, iy + 12)
      ctx.lineTo(ix + 12, iy + 12)
      ctx.stroke()

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = item.fgHex
      ctx.font = `800 19px ${SHIZIJIE_SIGN_FONTS.sans}`
      ctx.fillText(item.zh, x + rw / 2 + 12, y + 20, rw - 52)
      ctx.fillStyle = '#ffffff'
      ctx.font = `800 14.5px ${SHIZIJIE_SIGN_FONTS.condensed}`
      ctx.fillText(item.en, x + rw / 2 + 12, y + 46, rw - 52)
    } else if (item.slot === 'stairCaution') {
      ctx.strokeStyle = item.rimHex
      ctx.lineWidth = 2.8
      ctx.strokeRect(x + 5, y + 5, rw - 10, rh - 10)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = item.fgHex
      ctx.font = `900 ${zhSize + 1}px ${SHIZIJIE_SIGN_FONTS.sans}`
      ctx.fillText(item.zh, x + rw / 2, y + 20, zhMaxW)
      ctx.fillStyle = item.fgHex
      ctx.font = `800 15px ${SHIZIJIE_SIGN_FONTS.condensed}`
      ctx.fillText(item.en, x + rw / 2, y + 46, rw - 18)
    } else {
      ctx.strokeStyle = item.rimHex
      ctx.lineWidth = 1.5
      ctx.strokeRect(x + 5, y + 5, rw - 10, rh - 10)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = item.fgHex
      ctx.font = `700 ${zhSize}px ${SHIZIJIE_SIGN_FONTS.sans}`
      ctx.fillText(item.zh, x + rw / 2, zhY, zhMaxW)
      ctx.fillStyle = item.rimHex
      ctx.font = `700 12.5px ${SHIZIJIE_SIGN_FONTS.condensed}`
      ctx.fillText(item.en, x + rw / 2, y + 47, rw - 24)
    }
  }
  return canvas
}

function drawSignAtlasNodeData(w: number, h: number): THREE.DataTexture {
  const data = new Uint8Array(w * h * 4)
  paintRectRgba(data, w, 0, 0, w, h, [32, 38, 46])
  for (const item of SZJ_SIGN_META) {
    const rect: AtlasRect = SZJ_SIGN_ATLAS_RECTS[item.slot]
    const x0 = Math.round(rect[0] * w)
    const y0 = Math.round(rect[1] * h)
    const x1 = Math.round(rect[2] * w)
    const y1 = Math.round(rect[3] * h)
    const bg = hexRgb(item.bgHex)
    const fg = hexRgb(item.fgHex)
    paintRectRgba(data, w, x0 + 2, y0 + 2, x1 - 2, y1 - 2, bg)
    const barY0 = y0 + Math.floor((y1 - y0) * 0.34)
    const barY1 = y0 + Math.floor((y1 - y0) * 0.56)
    paintRectRgba(data, w, x0 + 10, barY0, x1 - 10, barY1, fg)
  }
  return makeDataTexture(data, w, h, true, null)
}

/** 1024×512 高清店招合批主图集（由 signAtlasMat 在 1:1 分辨率下兼具 albedo 与按槽位自发光遮罩） */
export function buildSignAtlasMaps(cache: TextureUploadCache): { readonly map: THREE.Texture } {
  const map = cache.acquire({
    key: 'szj:atlas-signs:albedo',
    width: 1024,
    height: 512,
    kind: 'albedo',
    isAtlas: true,
    build() {
      if (typeof document !== 'undefined') {
        const tex = new THREE.CanvasTexture(drawSignAtlasCanvas(1024, 512))
        tex.colorSpace = THREE.SRGBColorSpace
        tex.generateMipmaps = true
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.magFilter = THREE.LinearFilter
        tex.anisotropy = 4
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
        tex.needsUpdate = true
        return tex
      }
      return drawSignAtlasNodeData(1024, 512)
    },
  })

  return { map }
}
