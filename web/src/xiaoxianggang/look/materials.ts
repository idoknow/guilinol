/**
 * 小香港地下商业城室内材质资产包。
 *
 * 严格隔离设计：
 * - 不触碰 runtime、layout 与城市室外大气系统（地下空间采用自带中性商业光色基调）。
 * - 纹理通过 TextureUploadCache 单例化共享，0 重复 GPU 上传，总预算 ≤ 8 MiB。
 */

import * as THREE from 'three'
import {
  SIGN_ATLAS_RECTS,
  XXG_PALETTE,
  XXG_TEXTURE_BUDGET_BYTES,
  applySignAtlasRect,
  type AtlasRect,
  type SignAtlasSlot,
} from './palette.ts'
import {
  buildCeilingGridMaps,
  buildLightStripTexture,
  buildRenovatedTileMaps,
  buildRollerShutterMaps,
  buildSignAtlasMaps,
  buildTerrazzoMaps,
  buildWallAndStoneMaps,
  createTextureUploadCache,
  type TextureBudgetSnapshot,
  type TextureUploadCache,
} from './textures.ts'

export type MaterialSlotKey =
  | 'floorTerrazzo'
  | 'floorRenovated'
  | 'wallCorridor'
  | 'wallBoutiquePink'
  | 'ceilingGrid'
  | 'lightStripCool'
  | 'lightStripWarm'
  | 'globeLamp'
  | 'skylightGlass'
  | 'storefrontGlass'
  | 'rollerShutterSilver'
  | 'rollerShutterCream'
  | 'stairGranite'
  | 'signAtlasMat'
  | 'rackMetal'

export type ResolvedShopLook =
  | {
      readonly kind: 'sign-atlas'
      readonly key: string
      readonly slot: SignAtlasSlot
      readonly rect: AtlasRect
      readonly material: THREE.MeshStandardMaterial
      readonly isFallback: false
      readonly applyUv: (geometry: THREE.BufferGeometry, padPx?: number) => THREE.BufferGeometry
    }
  | {
      readonly kind: 'material'
      readonly key: MaterialSlotKey
      readonly material: THREE.MeshStandardMaterial
      readonly isFallback: boolean
    }

const PACK_MATERIAL_KEYS: ReadonlySet<MaterialSlotKey> = new Set([
  'floorTerrazzo',
  'floorRenovated',
  'wallCorridor',
  'wallBoutiquePink',
  'ceilingGrid',
  'lightStripCool',
  'lightStripWarm',
  'globeLamp',
  'skylightGlass',
  'storefrontGlass',
  'rollerShutterSilver',
  'rollerShutterCream',
  'stairGranite',
  'signAtlasMat',
  'rackMetal',
])

export interface XiaoxianggangMaterialPack {
  readonly floorTerrazzo: THREE.MeshStandardMaterial
  readonly floorRenovated: THREE.MeshStandardMaterial
  readonly wallCorridor: THREE.MeshStandardMaterial
  readonly wallBoutiquePink: THREE.MeshStandardMaterial
  readonly ceilingGrid: THREE.MeshStandardMaterial
  readonly lightStripCool: THREE.MeshStandardMaterial
  readonly lightStripWarm: THREE.MeshStandardMaterial
  readonly globeLamp: THREE.MeshStandardMaterial
  readonly skylightGlass: THREE.MeshStandardMaterial
  readonly storefrontGlass: THREE.MeshStandardMaterial
  readonly rollerShutterSilver: THREE.MeshStandardMaterial
  readonly rollerShutterCream: THREE.MeshStandardMaterial
  readonly stairGranite: THREE.MeshStandardMaterial
  readonly signAtlasMat: THREE.MeshStandardMaterial
  readonly rackMetal: THREE.MeshStandardMaterial
  readonly cache: TextureUploadCache
  setLightingBoost(boost: number): void
  getTextureBudget(): TextureBudgetSnapshot
  dispose(): void
}

export interface CreateMaterialsOptions {
  readonly cache?: TextureUploadCache
  /** 仅当使用外部注入 shared cache 时保持底层纹理存续；默认销毁自建缓存 */
  readonly preserveExternalCacheOnDispose?: boolean
}

export function createXiaoxianggangMaterials(opts: CreateMaterialsOptions = {}): XiaoxianggangMaterialPack {
  const ownsCache = !opts.cache
  const cache = opts.cache ?? createTextureUploadCache()
  const mats: THREE.Material[] = []
  const litEntries: Array<{ mat: THREE.MeshStandardMaterial; base: number; range: number }> = []

  const track = (mat: THREE.MeshStandardMaterial, baseEmissive = 0, range = 0): THREE.MeshStandardMaterial => {
    mat.emissiveIntensity = baseEmissive
    mats.push(mat)
    if (baseEmissive > 0 || range > 0) litEntries.push({ mat, base: baseEmissive, range })
    return mat
  }

  // 1. 地砖：老区水磨石 + 翻新大理石纹砖
  const terrazzo = buildTerrazzoMaps(cache)
  const floorTerrazzo = track(
    new THREE.MeshStandardMaterial({
      name: 'xxg_floor_terrazzo',
      map: terrazzo.map,
      normalMap: terrazzo.normalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughnessMap: terrazzo.roughnessMap,
      roughness: 1,
      metalness: 0.04,
      emissive: '#f7f1e3',
    }),
    0.05,
    0.08,
  )
  floorTerrazzo.userData = { tiled: true, periodM: [1.2, 1.2] }

  const renovated = buildRenovatedTileMaps(cache)
  const floorRenovated = track(
    new THREE.MeshStandardMaterial({
      name: 'xxg_floor_renovated',
      map: renovated.map,
      normalMap: renovated.normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughnessMap: renovated.roughnessMap,
      roughness: 1,
      metalness: 0,
      emissive: '#dfd8cc',
    }),
    0.01,
    0.02,
  )
  floorRenovated.userData = { tiled: true, periodM: [1.6, 1.6] }

  // 2. 墙面与裙边：共用同一墙面纹理（靠颜色染色区分，0 重复贴图上传）
  const wallAndStone = buildWallAndStoneMaps(cache)
  const wallCorridor = track(
    new THREE.MeshStandardMaterial({
      name: 'xxg_wall_corridor',
      color: XXG_PALETTE.wallCorridorPlaster.hex,
      map: wallAndStone.wallAlbedo,
      roughnessMap: wallAndStone.wallRoughness,
      roughness: 1,
      metalness: 0.02,
      emissive: '#f3efe6',
    }),
    0.04,
    0.06,
  )
  wallCorridor.userData = { tiled: true, periodM: [2.0, 2.0] }

  const wallBoutiquePink = track(
    new THREE.MeshStandardMaterial({
      name: 'xxg_wall_boutique_pink',
      color: XXG_PALETTE.wallBoutiquePink.hex,
      map: wallAndStone.wallAlbedo,
      roughnessMap: wallAndStone.wallRoughness,
      roughness: 1,
      metalness: 0.02,
      emissive: '#eed5d8',
    }),
    0.05,
    0.06,
  )
  wallBoutiquePink.userData = { tiled: true, periodM: [2.0, 2.0] }

  // 3. 吊顶方灯矩阵与连续灯带、球形吊灯
  const ceiling = buildCeilingGridMaps(cache)
  const ceilingGrid = track(
    new THREE.MeshStandardMaterial({
      name: 'xxg_ceiling_grid',
      map: ceiling.map,
      emissiveMap: ceiling.emissiveMap,
      roughnessMap: ceiling.roughnessMap,
      roughness: 1,
      metalness: 0.06,
      emissive: '#fff4e2',
    }),
    0.62,
    0.30,
  )
  ceilingGrid.userData = { tiled: true, periodM: [1.2, 1.2] }

  const stripTex = buildLightStripTexture(cache)
  const lightStripCool = track(
    new THREE.MeshStandardMaterial({
      name: 'xxg_light_strip_cool',
      color: XXG_PALETTE.ceilingLampCool.hex,
      map: stripTex,
      emissiveMap: stripTex,
      emissive: '#e6f1ff',
      roughness: 0.24,
      metalness: 0.04,
    }),
    0.68,
    0.32,
  )

  const lightStripWarm = track(
    new THREE.MeshStandardMaterial({
      name: 'xxg_light_strip_warm',
      color: XXG_PALETTE.lightStripWarm.hex,
      map: stripTex,
      emissiveMap: stripTex,
      emissive: '#ffdfaa',
      roughness: 0.24,
      metalness: 0.05,
    }),
    1.05,
    0.5,
  )

  const globeLamp = track(
    new THREE.MeshStandardMaterial({
      name: 'xxg_globe_lamp',
      color: XXG_PALETTE.globeLampWarm.hex,
      emissive: '#ffeccc',
      roughness: 0.2,
      metalness: 0.04,
    }),
    0.95,
    0.45,
  )

  // 4. 天窗玻璃、精品橱窗玻璃、花岗岩石阶、金属货架框
  const skylightGlass = track(
    new THREE.MeshStandardMaterial({
      name: 'xxg_skylight_glass',
      map: wallAndStone.skylightGlassMap,
      transparent: true,
      roughness: 0.14,
      metalness: 0.22,
      side: THREE.DoubleSide,
      emissive: '#bde0ec',
    }),
    0.16,
    0.12,
  )
  skylightGlass.userData = { tiled: true, periodM: [1.5, 1.5] }

  const storefrontGlass = track(
    new THREE.MeshStandardMaterial({
      name: 'xxg_storefront_glass',
      color: XXG_PALETTE.storefrontGlassTint.hex,
      transparent: true,
      opacity: 0.34,
      roughness: 0.08,
      metalness: 0.16,
      depthWrite: false,
      emissive: '#cfe7f3',
    }),
    0.06,
    0.08,
  )

  const stairGranite = track(
    new THREE.MeshStandardMaterial({
      name: 'xxg_stair_granite',
      map: wallAndStone.graniteAlbedo,
      roughnessMap: wallAndStone.graniteRoughness,
      roughness: 1,
      metalness: 0.05,
      emissive: '#a39a8d',
    }),
    0.02,
    0.04,
  )
  stairGranite.userData = { tiled: true, periodM: [1.0, 1.0] }

  const rackMetal = track(
    new THREE.MeshStandardMaterial({
      name: 'xxg_rack_metal',
      color: '#2c3038',
      roughness: 0.34,
      metalness: 0.72,
      emissive: '#22262e',
    }),
    0.02,
    0.04,
  )

  // 5. 金属波纹卷帘门（银灰商业款 + 米灰老区款共享波纹法线与粗糙度）
  const shutterSilver = buildRollerShutterMaps(cache, 'silver')
  const rollerShutterSilver = track(
    new THREE.MeshStandardMaterial({
      name: 'xxg_roller_shutter_silver',
      map: shutterSilver.map,
      normalMap: shutterSilver.normalMap,
      normalScale: new THREE.Vector2(1.05, 1.05),
      roughnessMap: shutterSilver.roughnessMap,
      roughness: 1,
      metalness: 0.52,
      emissive: '#8d96a0',
    }),
    0.03,
    0.06,
  )
  rollerShutterSilver.userData = { tiled: true, periodM: [1.0, 1.0] }

  const shutterCream = buildRollerShutterMaps(cache, 'cream')
  const rollerShutterCream = track(
    new THREE.MeshStandardMaterial({
      name: 'xxg_roller_shutter_cream',
      map: shutterCream.map,
      normalMap: shutterCream.normalMap,
      normalScale: new THREE.Vector2(1.05, 1.05),
      roughnessMap: shutterCream.roughnessMap,
      roughness: 1,
      metalness: 0.32,
      emissive: '#b5aea0',
    }),
    0.03,
    0.06,
  )
  rollerShutterCream.userData = { tiled: true, periodM: [1.0, 1.0] }

  // 6. 招牌与导视合批总图集（单个 GPU 纹理服务全商业城招牌）
  const atlas = buildSignAtlasMaps(cache)
  const signAtlasMat = track(
    new THREE.MeshStandardMaterial({
      name: 'xxg_sign_atlas',
      map: atlas.map,
      emissiveMap: atlas.emissiveMap,
      emissive: '#e8e2d6',
      roughness: 0.72,
      metalness: 0.0,
    }),
    0.14,
    0.18,
  )

  const snapshot = cache.getSnapshot()
  if (snapshot.rawBytes > XXG_TEXTURE_BUDGET_BYTES || snapshot.mipmappedBytes > XXG_TEXTURE_BUDGET_BYTES) {
    throw new RangeError(
      `Texture budget exceeded: raw=${snapshot.rawBytes}B mip=${snapshot.mipmappedBytes}B > ${XXG_TEXTURE_BUDGET_BYTES}B`,
    )
  }

  return {
    floorTerrazzo,
    floorRenovated,
    wallCorridor,
    wallBoutiquePink,
    ceilingGrid,
    lightStripCool,
    lightStripWarm,
    globeLamp,
    skylightGlass,
    storefrontGlass,
    rollerShutterSilver,
    rollerShutterCream,
    stairGranite,
    signAtlasMat,
    rackMetal,
    cache,
    setLightingBoost(boost: number) {
      const clamped = Math.max(0, Math.min(1.5, Number.isFinite(boost) ? boost : 0))
      for (const item of litEntries) {
        item.mat.emissiveIntensity = item.base + item.range * clamped
      }
    },
    getTextureBudget() {
      return cache.getSnapshot()
    },
    dispose() {
      for (const m of mats) m.dispose()
      if (ownsCache || !opts.preserveExternalCacheOnDispose) {
        cache.releaseAll()
      }
    },
  }
}

/** 根据 contract.ts `XxgShop.lookKey` 索引对应材质或招牌合批图集槽位。 */
export function resolveShopLook(pack: XiaoxianggangMaterialPack, lookKey?: string): ResolvedShopLook {
  if (lookKey && Object.prototype.hasOwnProperty.call(SIGN_ATLAS_RECTS, lookKey)) {
    const slot = lookKey as SignAtlasSlot
    return {
      kind: 'sign-atlas',
      key: slot,
      slot,
      rect: SIGN_ATLAS_RECTS[slot],
      material: pack.signAtlasMat,
      isFallback: false,
      applyUv: (geometry, padPx) => applySignAtlasRect(geometry, slot, padPx),
    }
  }
  if (lookKey && PACK_MATERIAL_KEYS.has(lookKey as MaterialSlotKey)) {
    const key = lookKey as MaterialSlotKey
    return {
      kind: 'material',
      key,
      material: pack[key],
      isFallback: false,
    }
  }
  return {
    kind: 'material',
    key: 'rollerShutterSilver',
    material: pack.rollerShutterSilver,
    isFallback: true,
  }
}
