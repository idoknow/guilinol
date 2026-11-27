/**
 * 小香港地下商业城室内纹理生成器与零重复 GPU 上传缓存。
 *
 * 约定：
 * 1. 所有可平铺建筑 PBR 贴图使用纯确定性 RGBA 像素缓冲（DataTexture），
 *    在浏览器 WebGL 与 headless Node 测试环境下产出一致分辨率与精确字节体积。
 * 2. 招牌合批图集见 sign-atlas.ts（浏览器 Canvas2D 绘制，Node 下同尺寸色块缓冲）。
 * 3. TextureUploadCache 按逻辑 key 唯一缓存：相同材质变体共用同一 THREE.Texture 实例，
 *    从根本上保证 WebGLTextures 零重复上传与显存严格受控（≤ 8 MiB）。
 */

import * as THREE from 'three'
import { XXG_PALETTE, XXG_TEXTURE_BUDGET_BYTES } from './palette.ts'

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
      uses: number
    }
  >()
  let acquireCalls = 0
  let cacheHits = 0

  return {
    acquire({ key, width, height, kind, build }) {
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
        uses: 1,
      })
      return tex
    },
    getSnapshot() {
      let rawBytes = 0
      let mipmappedBytes = 0
      const entries: TextureBudgetEntry[] = []
      const seenSources = new Set<string>()
      let duplicateUploadCount = 0

      for (const [key, rec] of map.entries()) {
        rawBytes += rec.rawBytes
        mipmappedBytes += rec.mipmappedBytes
        if (seenSources.has(rec.tex.uuid)) duplicateUploadCount++
        seenSources.add(rec.tex.uuid)
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
        limitBytes: XXG_TEXTURE_BUDGET_BYTES,
        rawBytes,
        mipmappedBytes,
        uniqueTextureCount: map.size,
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

// ───────────────────────────── 像素级确定性工具 ─────────────────────────────

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
}

function makeRng(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0
    return (s >>> 0) / 4294967296
  }
}

function hash2D(x: number, y: number, period: number, seed: number): number {
  const wx = ((x % period) + period) % period
  const wy = ((y % period) + period) % period
  let h = (wx * 374761393 + wy * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function tileNoise(x: number, y: number, size: number, cell: number, seed: number): number {
  const period = Math.max(2, Math.floor(size / cell))
  const fx = x / cell
  const fy = y / cell
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)
  const n00 = hash2D(x0, y0, period, seed)
  const n10 = hash2D(x0 + 1, y0, period, seed)
  const n01 = hash2D(x0, y0 + 1, period, seed)
  const n11 = hash2D(x0 + 1, y0 + 1, period, seed)
  return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy
}

function heightFieldToNormalRgba(height: Float32Array, w: number, h: number, strength: number): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const ym = (y - 1 + h) % h
    const yp = (y + 1) % h
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w
      const xp = (x + 1) % w
      const dhdx = (height[y * w + xp]! - height[y * w + xm]!) * strength
      const dhdy = (height[yp * w + x]! - height[ym * w + x]!) * strength
      const nx = -dhdx
      const ny = -dhdy
      const nz = 1
      const invLen = 1 / Math.hypot(nx, ny, nz)
      const i = (y * w + x) * 4
      out[i] = clampByte((nx * invLen * 0.5 + 0.5) * 255)
      out[i + 1] = clampByte((ny * invLen * 0.5 + 0.5) * 255)
      out[i + 2] = clampByte((nz * invLen * 0.5 + 0.5) * 255)
      out[i + 3] = 255
    }
  }
  return out
}

export function configureDataTexture(
  data: Uint8Array,
  w: number,
  h: number,
  kind: 'albedo' | 'normal' | 'roughness' | 'emissive',
  wrapRepeat = true,
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat)
  tex.colorSpace = kind === 'albedo' || kind === 'emissive' ? THREE.SRGBColorSpace : THREE.NoColorSpace
  tex.flipY = true
  tex.wrapS = wrapRepeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
  tex.wrapT = wrapRepeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = 2
  tex.needsUpdate = true
  return tex
}

export function fillPixelRect(
  buf: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  rw: number,
  rh: number,
  rgba: readonly [number, number, number, number],
): void {
  const xs = Math.max(0, Math.floor(x0))
  const xe = Math.min(w, Math.floor(x0 + rw))
  const ys = Math.max(0, Math.floor(y0))
  const ye = Math.min(h, Math.floor(y0 + rh))
  for (let y = ys; y < ye; y++) {
    // flipY=true 下，DataTexture 第0行对应 Canvas 底部，所以翻转 y 保持与 Canvas 坐标一致
    const flippedY = h - 1 - y
    for (let x = xs; x < xe; x++) {
      const idx = (flippedY * w + x) * 4
      buf[idx] = rgba[0]
      buf[idx + 1] = rgba[1]
      buf[idx + 2] = rgba[2]
      buf[idx + 3] = rgba[3]
    }
  }
}

// ───────────────────────────── 各建筑贴图合成器 ─────────────────────────────

export function buildTerrazzoMaps(cache: TextureUploadCache): {
  map: THREE.Texture
  normalMap: THREE.Texture
  roughnessMap: THREE.Texture
} {
  const S = 256
  const compute = () => {
    const albedo = new Uint8Array(S * S * 4)
    const rough = new Uint8Array(S * S * 4)
    const height = new Float32Array(S * S)
    const [br, bg, bb] = XXG_PALETTE.terrazzoBase.rgb
    const [gr, gg, gb] = XXG_PALETTE.terrazzoGrout.rgb

    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n1 = tileNoise(x, y, S, 16, 11)
        const n2 = tileNoise(x, y, S, 4, 29)
        const lx = x % 128
        const ly = y % 128
        const isGrout = lx < 2 || ly < 2 || lx > 126 || ly > 126
        const i = (y * S + x) * 4
        if (isGrout) {
          albedo[i] = gr
          albedo[i + 1] = gg
          albedo[i + 2] = gb
          albedo[i + 3] = 255
          height[y * S + x] = 0.12
          const rv = clampByte(205 + (n2 - 0.5) * 18)
          rough[i] = rough[i + 1] = rough[i + 2] = rv
          rough[i + 3] = 255
        } else {
          const jitter = (n1 - 0.5) * 10 + (n2 - 0.5) * 7
          albedo[i] = clampByte(br + jitter)
          albedo[i + 1] = clampByte(bg + jitter)
          albedo[i + 2] = clampByte(bb + jitter)
          albedo[i + 3] = 255
          height[y * S + x] = 0.85 + n2 * 0.06
          const rv = clampByte(132 + (n1 - 0.5) * 16)
          rough[i] = rough[i + 1] = rough[i + 2] = rv
          rough[i + 3] = 255
        }
      }
    }

    // 散布水磨石骨料颗粒（深褐灰 / 暖赭石 / 乳白碎石，无缝环绕）
    const rng = makeRng(20261125)
    const chips: ReadonlyArray<readonly [number, number, number, number]> = [
      [112, 108, 102, 0.4],
      [168, 152, 132, 0.35],
      [234, 229, 219, 0.25],
      [82, 79, 74, 0.45],
    ]
    for (let k = 0; k < 560; k++) {
      const cx = Math.floor(rng() * S)
      const cy = Math.floor(rng() * S)
      const rad = 1 + Math.floor(rng() * 3.2)
      const chip = chips[k % chips.length]!
      const chipRough = clampByte(104 + rng() * 24)
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (dx * dx + dy * dy > rad * rad + 0.5) continue
          const px = (cx + dx + S) % S
          const py = (cy + dy + S) % S
          const lx = px % 128
          const ly = py % 128
          if (lx < 2 || ly < 2 || lx > 126 || ly > 126) continue
          const i = (py * S + px) * 4
          albedo[i] = chip[0]
          albedo[i + 1] = chip[1]
          albedo[i + 2] = chip[2]
          height[py * S + px] = 0.92
          rough[i] = rough[i + 1] = rough[i + 2] = chipRough
        }
      }
    }

    return {
      albedo,
      normal: heightFieldToNormalRgba(height, S, S, 2.2),
      rough,
    }
  }

  let built: ReturnType<typeof compute> | null = null
  const ensure = () => (built ??= compute())

  return {
    map: cache.acquire({
      key: 'xxg:terrazzo:albedo',
      width: S,
      height: S,
      kind: 'albedo',
      build: () => configureDataTexture(ensure().albedo, S, S, 'albedo'),
    }),
    normalMap: cache.acquire({
      key: 'xxg:terrazzo:normal',
      width: S,
      height: S,
      kind: 'normal',
      build: () => configureDataTexture(ensure().normal, S, S, 'normal'),
    }),
    roughnessMap: cache.acquire({
      key: 'xxg:terrazzo:roughness',
      width: S,
      height: S,
      kind: 'roughness',
      build: () => configureDataTexture(ensure().rough, S, S, 'roughness'),
    }),
  }
}

export function buildRenovatedTileMaps(cache: TextureUploadCache): {
  map: THREE.Texture
  normalMap: THREE.Texture
  roughnessMap: THREE.Texture
} {
  const S = 256
  const NS = 128
  const [br, bg, bb] = XXG_PALETTE.renovatedTileBase.rgb
  const [vr, vg, vb] = XXG_PALETTE.renovatedTileVein.rgb

  let cached: {
    albedo: Uint8Array
    normal: Uint8Array
    rough: Uint8Array
  } | null = null

  const ensure = () => {
    if (cached) return cached
    const albedo = new Uint8Array(S * S * 4)
    const height = new Float32Array(NS * NS)
    const rough = new Uint8Array(NS * NS * 4)

    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const lx = x % 128
        const ly = y % 128
        const isGrout = lx < 1 || ly < 1 || lx > 126 || ly > 126
        const i = (y * S + x) * 4
        if (isGrout) {
          albedo[i] = 148
          albedo[i + 1] = 144
          albedo[i + 2] = 136
          albedo[i + 3] = 255
        } else {
          const macro = tileNoise(x, y, S, 32, 41)
          const micro = tileNoise(x, y, S, 8, 53)
          const veinWave = Math.abs(Math.sin((x * 0.045 + y * 0.032) + macro * 4.4))
          const veinBlend = veinWave > 0.86 ? (veinWave - 0.86) * 4.2 : 0
          const r = br * (1 - veinBlend) + vr * veinBlend + (micro - 0.5) * 6
          const g = bg * (1 - veinBlend) + vg * veinBlend + (micro - 0.5) * 6
          const b = bb * (1 - veinBlend) + vb * veinBlend + (micro - 0.5) * 6
          albedo[i] = clampByte(r)
          albedo[i + 1] = clampByte(g)
          albedo[i + 2] = clampByte(b)
          albedo[i + 3] = 255
        }
      }
    }

    for (let y = 0; y < NS; y++) {
      for (let x = 0; x < NS; x++) {
        const lx = x % 64
        const ly = y % 64
        const isGrout = lx === 0 || ly === 0 || lx === 63 || ly === 63
        const m = tileNoise(x, y, NS, 16, 77)
        height[y * NS + x] = isGrout ? 0.25 : 0.9 + (m - 0.5) * 0.04
        const i = (y * NS + x) * 4
        const rv = isGrout ? 215 : clampByte(172 + (m - 0.5) * 26)
        rough[i] = rough[i + 1] = rough[i + 2] = rv
        rough[i + 3] = 255
      }
    }

    cached = {
      albedo,
      normal: heightFieldToNormalRgba(height, NS, NS, 1.8),
      rough,
    }
    return cached
  }

  return {
    map: cache.acquire({
      key: 'xxg:renovated-tile:albedo',
      width: S,
      height: S,
      kind: 'albedo',
      build: () => configureDataTexture(ensure().albedo, S, S, 'albedo'),
    }),
    normalMap: cache.acquire({
      key: 'xxg:renovated-tile:normal',
      width: NS,
      height: NS,
      kind: 'normal',
      build: () => configureDataTexture(ensure().normal, NS, NS, 'normal'),
    }),
    roughnessMap: cache.acquire({
      key: 'xxg:renovated-tile:roughness',
      width: NS,
      height: NS,
      kind: 'roughness',
      build: () => configureDataTexture(ensure().rough, NS, NS, 'roughness'),
    }),
  }
}

/** 吊顶矿棉板自发光底值（0..255）：让朝下的板面在半球光下不发灰，龙骨保持 0。 */
export const CEILING_BOARD_GLOW = 188

export function buildCeilingGridMaps(cache: TextureUploadCache): {
  map: THREE.Texture
  emissiveMap: THREE.Texture
  roughnessMap: THREE.Texture
} {
  const S = 256
  const RS = 128
  const [br, bg, bb] = XXG_PALETTE.ceilingBoard.rgb
  const [rr, rg, rb] = XXG_PALETTE.ceilingGridRail.rgb

  let cached: { albedo: Uint8Array; emissive: Uint8Array; rough: Uint8Array } | null = null
  const ensure = () => {
    if (cached) return cached
    const albedo = new Uint8Array(S * S * 4)
    const emissive = new Uint8Array(S * S * 4)
    const rough = new Uint8Array(RS * RS * 4)

    for (let y = 0; y < S; y++) {
      const ty = Math.floor(y / 128)
      const ly = y % 128
      for (let x = 0; x < S; x++) {
        const tx = Math.floor(x / 128)
        const lx = x % 128
        const isRail = lx < 3 || ly < 3 || lx > 124 || ly > 124
        // 方灯改由场景几何按 600mm 格对齐嵌入（runtime/indoor-scene.ts 方灯矩阵），贴图只留矿棉板与龙骨。
        // 板面带一层柔和自发光，模拟地下廊道灯光在浅色吊顶上的漫反射；龙骨不发光，保留深灰分格线。
        const grain = (tileNoise(x, y, S, 4, 91) - 0.5) * 9
        const fissure = tileNoise(x, y, S, 2, 37 + tx * 3 + ty * 5) > 0.84 ? -10 : 0
        const i = (y * S + x) * 4
        if (isRail) {
          albedo[i] = rr
          albedo[i + 1] = rg
          albedo[i + 2] = rb
          albedo[i + 3] = 255
          emissive[i] = emissive[i + 1] = emissive[i + 2] = 0
          emissive[i + 3] = 255
        } else {
          albedo[i] = clampByte(br + grain + fissure)
          albedo[i + 1] = clampByte(bg + grain + fissure)
          albedo[i + 2] = clampByte(bb + grain + fissure)
          albedo[i + 3] = 255
          const glow = clampByte(CEILING_BOARD_GLOW + grain * 0.6 + fissure)
          emissive[i] = glow
          emissive[i + 1] = glow
          emissive[i + 2] = clampByte(glow - 4)
          emissive[i + 3] = 255
        }
      }
    }

    for (let y = 0; y < RS; y++) {
      const ty = Math.floor(y / 64)
      const ly = y % 64
      for (let x = 0; x < RS; x++) {
        const tx = Math.floor(x / 64)
        const lx = x % 64
        const isRail = lx < 2 || ly < 2 || lx > 61 || ly > 61
        const i = (y * RS + x) * 4
        const rv = isRail ? 120 : 216 - ((tx + ty) % 2) * 8
        rough[i] = rough[i + 1] = rough[i + 2] = rv
        rough[i + 3] = 255
      }
    }

    cached = { albedo, emissive, rough }
    return cached
  }

  return {
    map: cache.acquire({
      key: 'xxg:ceiling-grid:albedo',
      width: S,
      height: S,
      kind: 'albedo',
      build: () => configureDataTexture(ensure().albedo, S, S, 'albedo'),
    }),
    emissiveMap: cache.acquire({
      key: 'xxg:ceiling-grid:emissive',
      width: S,
      height: S,
      kind: 'emissive',
      build: () => configureDataTexture(ensure().emissive, S, S, 'emissive'),
    }),
    roughnessMap: cache.acquire({
      key: 'xxg:ceiling-grid:roughness',
      width: RS,
      height: RS,
      kind: 'roughness',
      build: () => configureDataTexture(ensure().rough, RS, RS, 'roughness'),
    }),
  }
}

export function buildLightStripTexture(cache: TextureUploadCache): THREE.Texture {
  const W = 128
  const H = 64
  return cache.acquire({
    key: 'xxg:light-strip:shared',
    width: W,
    height: H,
    kind: 'albedo',
    build: () => {
      const data = new Uint8Array(W * H * 4)
      for (let y = 0; y < H; y++) {
        const edgeFade = Math.sin((y / (H - 1)) * Math.PI)
        const louver = y < 6 || y > H - 7 ? 0.55 : 0.86 + 0.14 * edgeFade
        for (let x = 0; x < W; x++) {
          const micro = 0.96 + 0.04 * Math.sin((x / W) * Math.PI * 16)
          const v = clampByte(252 * louver * micro)
          const i = (y * W + x) * 4
          data[i] = v
          data[i + 1] = v
          data[i + 2] = clampByte(v * 0.99)
          data[i + 3] = 255
        }
      }
      return configureDataTexture(data, W, H, 'albedo')
    },
  })
}

export function buildRollerShutterMaps(
  cache: TextureUploadCache,
  variant: 'silver' | 'cream',
): {
  map: THREE.Texture
  normalMap: THREE.Texture
  roughnessMap: THREE.Texture
} {
  const S = 256
  const RS = 128
  const [br, bg, bb] =
    variant === 'silver' ? XXG_PALETTE.rollerShutterSilver.rgb : XXG_PALETTE.rollerShutterCream.rgb

  const map = cache.acquire({
    key: `xxg:shutter:${variant}:albedo`,
    width: S,
    height: S,
    kind: 'albedo',
    build: () => {
      const data = new Uint8Array(S * S * 4)
      for (let y = 0; y < S; y++) {
        // flipY=true 下 y=0 为底部（绘制黑色橡胶封条），向上 8 道 32px 横向波纹帘片
        const isBottomRubber = y < 10
        const slatIdx = Math.floor(y / 32)
        const localY = y % 32
        const crown = Math.sin((localY / 31) * Math.PI)
        const seam = localY < 2 || localY > 29
        for (let x = 0; x < S; x++) {
          const i = (y * S + x) * 4
          const isStiffener = x >= 125 && x <= 130
          const isLockPlate = !isBottomRubber && slatIdx === 1 && Math.abs(x - 128) <= 10 && localY >= 8 && localY <= 22
          const isVentSlot = slatIdx === 6 && localY >= 12 && localY <= 18 && x % 16 >= 5 && x % 16 <= 11

          if (isBottomRubber) {
            data[i] = 36
            data[i + 1] = 38
            data[i + 2] = 42
          } else if (isVentSlot) {
            data[i] = 42
            data[i + 1] = 44
            data[i + 2] = 48
          } else if (isLockPlate) {
            data[i] = 198
            data[i + 1] = 204
            data[i + 2] = 212
          } else {
            const shade = seam ? 0.72 : 0.88 + crown * 0.16 + (isStiffener ? -0.06 : 0)
            const brush = (tileNoise(x, y, S, 4, 131) - 0.5) * 6
            data[i] = clampByte(br * shade + brush)
            data[i + 1] = clampByte(bg * shade + brush)
            data[i + 2] = clampByte(bb * shade + brush)
          }
          data[i + 3] = 255
        }
      }
      return configureDataTexture(data, S, S, 'albedo')
    },
  })

  // 两色卷帘门共用唯一一套波纹法线与粗糙度贴图（0 重复上传）
  const normalMap = cache.acquire({
    key: 'xxg:shutter:shared:normal',
    width: S,
    height: S,
    kind: 'normal',
    build: () => {
      const h = new Float32Array(S * S)
      for (let y = 0; y < S; y++) {
        const isBottomRubber = y < 10
        const localY = y % 32
        const wave = Math.sin((localY / 31) * Math.PI)
        for (let x = 0; x < S; x++) {
          const isStiffener = x >= 125 && x <= 130 ? -0.08 : 0
          h[y * S + x] = isBottomRubber ? 0.65 : 0.35 + wave * 0.55 + isStiffener
        }
      }
      return configureDataTexture(heightFieldToNormalRgba(h, S, S, 3.0), S, S, 'normal')
    },
  })

  const roughnessMap = cache.acquire({
    key: 'xxg:shutter:shared:roughness',
    width: RS,
    height: RS,
    kind: 'roughness',
    build: () => {
      const r = new Uint8Array(RS * RS * 4)
      for (let y = 0; y < RS; y++) {
        const isBottomRubber = y < 5
        const localY = y % 16
        const seam = localY === 0 || localY === 15
        for (let x = 0; x < RS; x++) {
          const i = (y * RS + x) * 4
          const brush = (tileNoise(x, y, RS, 4, 151) - 0.5) * 18
          const rv = isBottomRubber ? 230 : seam ? 168 : clampByte(96 + brush)
          r[i] = r[i + 1] = r[i + 2] = rv
          r[i + 3] = 255
        }
      }
      return configureDataTexture(r, RS, RS, 'roughness')
    },
  })

  return { map, normalMap, roughnessMap }
}

export function buildWallAndStoneMaps(cache: TextureUploadCache): {
  wallAlbedo: THREE.Texture
  wallRoughness: THREE.Texture
  graniteAlbedo: THREE.Texture
  graniteRoughness: THREE.Texture
  skylightGlassMap: THREE.Texture
} {
  const S = 128

  const wallAlbedo = cache.acquire({
    key: 'xxg:wall:plaster:albedo',
    width: S,
    height: S,
    kind: 'albedo',
    build: () => {
      const data = new Uint8Array(S * S * 4)
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const n = (tileNoise(x, y, S, 8, 173) - 0.5) * 10
          const v = clampByte(242 + n)
          const i = (y * S + x) * 4
          data[i] = v
          data[i + 1] = v
          data[i + 2] = clampByte(v - 2)
          data[i + 3] = 255
        }
      }
      return configureDataTexture(data, S, S, 'albedo')
    },
  })

  const wallRoughness = cache.acquire({
    key: 'xxg:wall:plaster:roughness',
    width: S,
    height: S,
    kind: 'roughness',
    build: () => {
      const data = new Uint8Array(S * S * 4)
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const n = (tileNoise(x, y, S, 8, 191) - 0.5) * 20
          const rv = clampByte(214 + n)
          const i = (y * S + x) * 4
          data[i] = data[i + 1] = data[i + 2] = rv
          data[i + 3] = 255
        }
      }
      return configureDataTexture(data, S, S, 'roughness')
    },
  })

  const [gr, gg, gb] = XXG_PALETTE.stairGranite.rgb
  const graniteAlbedo = cache.acquire({
    key: 'xxg:stone:granite:albedo',
    width: S,
    height: S,
    kind: 'albedo',
    build: () => {
      const data = new Uint8Array(S * S * 4)
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const speck = (hash2D(x, y, S, 211) - 0.5) * 34
          const antiSlip = y % 32 < 3 ? -26 : 0
          const i = (y * S + x) * 4
          data[i] = clampByte(gr + speck + antiSlip)
          data[i + 1] = clampByte(gg + speck + antiSlip)
          data[i + 2] = clampByte(gb + speck + antiSlip)
          data[i + 3] = 255
        }
      }
      return configureDataTexture(data, S, S, 'albedo')
    },
  })

  const graniteRoughness = cache.acquire({
    key: 'xxg:stone:granite:roughness',
    width: S,
    height: S,
    kind: 'roughness',
    build: () => {
      const data = new Uint8Array(S * S * 4)
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const speck = (hash2D(x, y, S, 223) - 0.5) * 28
          const groove = y % 32 < 3 ? 35 : 0
          const rv = clampByte(188 + speck + groove)
          const i = (y * S + x) * 4
          data[i] = data[i + 1] = data[i + 2] = rv
          data[i + 3] = 255
        }
      }
      return configureDataTexture(data, S, S, 'roughness')
    },
  })

  const [sr, sg, sb] = XXG_PALETTE.skylightGlassTint.rgb
  const skylightGlassMap = cache.acquire({
    key: 'xxg:glass:skylight:albedo',
    width: S,
    height: S,
    kind: 'albedo',
    build: () => {
      const data = new Uint8Array(S * S * 4)
      for (let y = 0; y < S; y++) {
        const mullion = xEdgeOrBar(y, S)
        for (let x = 0; x < S; x++) {
          const isBar = mullion || x % 64 < 3
          const i = (y * S + x) * 4
          if (isBar) {
            data[i] = 176
            data[i + 1] = 186
            data[i + 2] = 196
            data[i + 3] = 248
          } else {
            data[i] = sr
            data[i + 1] = sg
            data[i + 2] = sb
            data[i + 3] = 92
          }
        }
      }
      return configureDataTexture(data, S, S, 'albedo')
    },
  })

  return { wallAlbedo, wallRoughness, graniteAlbedo, graniteRoughness, skylightGlassMap }
}

function xEdgeOrBar(coord: number, size: number): boolean {
  return coord % (size / 2) < 3
}
