/**
 * 桂林十字街地下街 B1 室内材质包、`wayfinding` 数据驱动吊牌图集与 `lookKey` 解析器。
 *
 * 严格隔离：
 * - 不修改 runtime / layout / 宿主 terrain / main.ts。
 * - 所有 PBR 纹理经引用计数 TextureUploadCache 单例共享，0 重复上传，全进程显存严格 <= 8 MiB，图集 <= 2 张。
 */

import * as THREE from 'three'
import type { SzjShopCategory } from '../contract.ts'
import { SHIZIJIE_B1_LAYOUT } from '../layout/index.ts'
import { buildSzjWayfinding, type SzjWayfinding } from '../wayfinding/index.ts'
import {
  SHIZIJIE_PALETTE,
  SHIZIJIE_TEXTURE_BUDGET_BYTES,
  SZJ_SIGN_ATLAS_RECTS,
  applySignAtlasRect,
  getCategorySignSlot,
  type AtlasRect,
  type SzjSignAtlasSlot,
} from './palette.ts'
import {
  buildCeilingGridMaps,
  buildCorridorTileMaps,
  buildLightStripTexture,
  buildRollerShutterMaps,
  buildSignAtlasMaps,
  buildStairAndWallMaps,
  buildTerrazzoMaps,
  createTextureUploadCache,
  type TextureBudgetSnapshot,
  type TextureUploadCache,
} from './textures.ts'
import { buildWayfindingSignAtlas, type SzjWayfindingAtlasLayout } from './wayfinding-signs.ts'

export type ShizijieMaterialSlotKey =
  | 'floorTerrazzo'
  | 'floorCorridorTile'
  | 'stairGranite'
  | 'stairTread'
  | 'wallCorridor'
  | 'columnStone'
  | 'ceilingGrid'
  | 'lightStripCool'
  | 'lightStripWarm'
  | 'rollerShutterSilver'
  | 'rollerShutterCream'
  | 'canopyGlassBlue'
  | 'canopyTrussDark'
  | 'canopyHandrailWhite'
  | 'handrailSteel'
  | 'bollardRedReflect'
  | 'storefrontGlass'
  | 'signAtlasMat'
  | 'wayfindingMat'
  | 'rackMetal'

export type ResolvedShopLook =
  | {
      readonly kind: 'sign-atlas'
      readonly key: string
      readonly slot: SzjSignAtlasSlot
      readonly rect: AtlasRect
      readonly material: THREE.MeshStandardMaterial
      readonly isFallback: false
      readonly applyUv: (geometry: THREE.BufferGeometry, padPx?: number) => THREE.BufferGeometry
    }
  | {
      readonly kind: 'material'
      readonly key: ShizijieMaterialSlotKey
      readonly material: THREE.MeshStandardMaterial
      readonly isFallback: boolean
    }

const PACK_MATERIAL_KEYS: ReadonlySet<ShizijieMaterialSlotKey> = new Set([
  'floorTerrazzo',
  'floorCorridorTile',
  'stairGranite',
  'stairTread',
  'wallCorridor',
  'columnStone',
  'ceilingGrid',
  'lightStripCool',
  'lightStripWarm',
  'rollerShutterSilver',
  'rollerShutterCream',
  'canopyGlassBlue',
  'canopyTrussDark',
  'canopyHandrailWhite',
  'handrailSteel',
  'bollardRedReflect',
  'storefrontGlass',
  'signAtlasMat',
  'wayfindingMat',
  'rackMetal',
])

export interface ShizijieMaterialPack {
  readonly floorTerrazzo: THREE.MeshStandardMaterial
  readonly floorCorridorTile: THREE.MeshStandardMaterial
  readonly stairGranite: THREE.MeshStandardMaterial
  readonly stairTread: THREE.MeshStandardMaterial
  readonly wallCorridor: THREE.MeshStandardMaterial
  readonly columnStone: THREE.MeshStandardMaterial
  readonly ceilingGrid: THREE.MeshStandardMaterial
  readonly lightStripCool: THREE.MeshStandardMaterial
  readonly lightStripWarm: THREE.MeshStandardMaterial
  readonly rollerShutterSilver: THREE.MeshStandardMaterial
  readonly rollerShutterCream: THREE.MeshStandardMaterial
  readonly canopyGlassBlue: THREE.MeshStandardMaterial
  readonly canopyTrussDark: THREE.MeshStandardMaterial
  readonly canopyHandrailWhite: THREE.MeshStandardMaterial
  readonly handrailSteel: THREE.MeshStandardMaterial
  readonly bollardRedReflect: THREE.MeshStandardMaterial
  readonly storefrontGlass: THREE.MeshStandardMaterial
  readonly signAtlasMat: THREE.MeshStandardMaterial
  readonly wayfindingMat: THREE.MeshStandardMaterial
  readonly wayfindingAtlas: SzjWayfindingAtlasLayout
  readonly rackMetal: THREE.MeshStandardMaterial
  readonly cache: TextureUploadCache
  setLightingBoost(boost: number): void
  getTextureBudget(): TextureBudgetSnapshot
  dispose(): void
}

export interface CreateShizijieMaterialsOptions {
  readonly cache?: TextureUploadCache
  readonly preserveExternalCacheOnDispose?: boolean
  readonly wayfinding?: SzjWayfinding
}

let defaultSharedCache: TextureUploadCache | null = null
let defaultSharedUsers = 0
let cachedDefaultWayfinding: SzjWayfinding | null = null

function getDefaultWayfinding(): SzjWayfinding {
  if (!cachedDefaultWayfinding) {
    cachedDefaultWayfinding = buildSzjWayfinding(SHIZIJIE_B1_LAYOUT)
  }
  return cachedDefaultWayfinding
}

function acquireDefaultSharedCache(): TextureUploadCache {
  if (!defaultSharedCache) {
    defaultSharedCache = createTextureUploadCache()
  }
  defaultSharedUsers++
  return defaultSharedCache
}

function releaseDefaultSharedCache(): void {
  defaultSharedUsers = Math.max(0, defaultSharedUsers - 1)
  if (defaultSharedUsers === 0 && defaultSharedCache) {
    defaultSharedCache.releaseAll()
    defaultSharedCache = null
  }
}

/** 为 B1 抛光花岗岩与水磨石地面注入对齐每块 600mm 砖缝的菲涅耳抛光掠射阶跃高光（串联宿主 atmosphere 与顶点 cameraPosition varying，于 lights_fragment_end 后汇入 totalSpecular）。 */
function bindFloorUndergroundSheen(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader, renderer) => {
    THREE.Material.prototype.onBeforeCompile.call(mat, shader, renderer)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vSzjFloorWorldPos;\nvarying vec3 vSzjFloorViewVec;\nvarying vec2 vSzjTileUv;',
      )
      .replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\nvSzjTileUv = vec2(0.0);\n#ifdef USE_UV\n  vSzjTileUv = uv * 2.0;\n#endif',
      )
      .replace(
        '#include <fog_vertex>',
        [
          '{',
          '  vec4 szjWp = modelMatrix * vec4(transformed, 1.0);',
          '  vSzjFloorWorldPos = szjWp.xyz;',
          '  vSzjFloorViewVec = cameraPosition - szjWp.xyz;',
          '}',
          '#include <fog_vertex>',
        ].join('\n'),
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vSzjFloorWorldPos;\nvarying vec3 vSzjFloorViewVec;\nvarying vec2 vSzjTileUv;',
      )
      .replace(
        '#include <lights_fragment_end>',
        [
          '#include <lights_fragment_end>',
          'if (vSzjFloorWorldPos.y < 8.0) {',
          '  vec3 viewW = normalize(vSzjFloorViewVec);',
          '  float gloss = clamp(1.0 - roughnessFactor, 0.0, 1.0);',
          '  float specAmp = pow(gloss, 2.8);',
          '  float grazing = pow(clamp(1.0 - max(viewW.y, 0.0), 0.0, 1.0), 3.0);',
          '  vec2 tileId = floor(vSzjTileUv);',
          '  float slabCatch = 0.72 + 0.56 * fract(sin(dot(tileId, vec2(127.1, 311.7))) * 43758.5453);',
          '  vec3 ceilIbl = vec3(0.92, 0.95, 1.0);',
          '  reflectedLight.indirectSpecular += ceilIbl * grazing * specAmp * slabCatch * 0.42;',
          '}',
        ].join('\n'),
      )
  }
  mat.customProgramCacheKey = () => 'szj-floor-sheen-v9'
  return mat
}

/** 1:1 招牌图集自发光槽位门控（shutterRentBanner 保持纯漫反射 0 自发光，stairCaution 保留高反差安全内透，串联宿主 atmosphere）。 */
function bindSignNonLitMask(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader, renderer) => {
    THREE.Material.prototype.onBeforeCompile.call(mat, shader, renderer)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      [
        '#include <emissivemap_fragment>',
        '#ifdef USE_EMISSIVEMAP',
        'if (vEmissiveMapUv.x >= 0.498 && vEmissiveMapUv.x <= 0.752 && vEmissiveMapUv.y >= 0.123 && vEmissiveMapUv.y <= 0.252) {',
        '  totalEmissiveRadiance = vec3(0.0);',
        '}',
        '#endif',
      ].join('\n'),
    )
  }
  mat.customProgramCacheKey = () => 'szj-sign-nonlit-mask-v2'
  return mat
}

export function createShizijieMaterials(opts: CreateShizijieMaterialsOptions = {}): ShizijieMaterialPack {
  const usesDefaultShared = !opts.cache
  const cache = opts.cache ?? acquireDefaultSharedCache()
  const mats: THREE.Material[] = []
  const litEntries: Array<{ mat: THREE.MeshStandardMaterial; base: number; range: number }> = []
  let disposed = false

  const track = (mat: THREE.MeshStandardMaterial, baseEmissive = 0, range = 0): THREE.MeshStandardMaterial => {
    mat.emissiveIntensity = baseEmissive
    mats.push(mat)
    if (baseEmissive > 0 || range > 0) litEntries.push({ mat, base: baseEmissive, range })
    return mat
  }

  // 1. 半光盐椒花水磨石与抛光芝麻灰花岗岩（关掉乳白 emissive 泛灰雾感，拉开石材底色与镜面掠射对比度）
  const terrazzo = buildTerrazzoMaps(cache)
  const floorTerrazzo = bindFloorUndergroundSheen(
    track(
      new THREE.MeshStandardMaterial({
        name: 'szj_floor_terrazzo',
        map: terrazzo.map,
        normalMap: terrazzo.normalMap,
        normalScale: new THREE.Vector2(0.95, 0.95),
        roughnessMap: terrazzo.roughnessMap,
        roughness: 1,
        metalness: 0.16,
      }),
      0,
      0.02,
    ),
  )
  floorTerrazzo.userData = { tiled: true, periodM: [1.2, 1.2] }

  const corridorTile = buildCorridorTileMaps(cache)
  const floorCorridorTile = bindFloorUndergroundSheen(
    track(
      new THREE.MeshStandardMaterial({
        name: 'szj_floor_corridor_tile',
        map: corridorTile.map,
        normalMap: corridorTile.normalMap,
        normalScale: new THREE.Vector2(0.85, 0.85),
        roughnessMap: corridorTile.roughnessMap,
        roughness: 1,
        metalness: 0.18,
      }),
      0,
      0.02,
    ),
  )
  floorCorridorTile.userData = { tiled: true, periodM: [1.2, 1.2] }

  const stoneAndWall = buildStairAndWallMaps(cache)
  const stairGranite = track(
    new THREE.MeshStandardMaterial({
      name: 'szj_stair_granite',
      map: stoneAndWall.stairGraniteAlbedo,
      normalMap: stoneAndWall.wallNormal,
      normalScale: new THREE.Vector2(0.32, 0.32),
      roughnessMap: stoneAndWall.stairGraniteRoughness,
      roughness: 1,
      metalness: 0.14,
      emissive: '#6e7278',
    }),
    0.04,
    0.05,
  )
  stairGranite.userData = { tiled: true, periodM: [1.0, 1.0] }

  const stairTread = track(
    new THREE.MeshStandardMaterial({
      name: 'szj_stair_tread',
      map: stoneAndWall.stairTreadAlbedo,
      normalMap: stoneAndWall.stairTreadNormal,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 0.76,
      metalness: 0.04,
      emissive: '#a89f8e',
    }),
    0.05,
    0.06,
  )
  stairTread.userData = { tiled: true, periodM: [1.0, 0.3] }

  const wallCorridor = track(
    new THREE.MeshStandardMaterial({
      name: 'szj_wall_corridor',
      map: stoneAndWall.wallAlbedo,
      normalMap: stoneAndWall.wallNormal,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: stoneAndWall.wallRoughness,
      roughness: 1,
      metalness: 0.06,
      emissive: '#ece7de',
    }),
    0.04,
    0.05,
  )
  wallCorridor.userData = { tiled: true, periodM: [2.8, 3.2] }

  const columnStone = track(
    new THREE.MeshStandardMaterial({
      name: 'szj_column_stone',
      color: SHIZIJIE_PALETTE.columnGranite.hex,
      map: stoneAndWall.stairGraniteAlbedo,
      normalMap: stoneAndWall.wallNormal,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughnessMap: stoneAndWall.stairGraniteRoughness,
      roughness: 0.86,
      metalness: 0.08,
      emissive: '#7d6e62',
    }),
    0.04,
    0.05,
  )
  columnStone.userData = { tiled: true, periodM: [1.0, 1.5] }

  // 2. 银白拉丝铝合金吊顶（稀疏条形嵌灯，杜绝黑格子污染）
  const ceiling = buildCeilingGridMaps(cache)
  const ceilingGrid = track(
    new THREE.MeshStandardMaterial({
      name: 'szj_ceiling_grid',
      map: ceiling.map,
      emissiveMap: ceiling.emissiveMap,
      roughnessMap: ceiling.roughnessMap,
      roughness: 1,
      metalness: 0.18,
      emissive: '#ffffff',
    }),
    0.95,
    0.45,
  )
  ceilingGrid.userData = { tiled: true, periodM: [2.4, 2.2] }

  const stripTex = buildLightStripTexture(cache)
  const lightStripCool = track(
    new THREE.MeshStandardMaterial({
      name: 'szj_light_strip_cool',
      color: SHIZIJIE_PALETTE.lightStripCool.hex,
      map: stripTex,
      emissiveMap: stripTex,
      emissive: '#e4f0ff',
      roughness: 0.22,
      metalness: 0.04,
    }),
    1.05,
    0.45,
  )

  const lightStripWarm = track(
    new THREE.MeshStandardMaterial({
      name: 'szj_light_strip_warm',
      color: SHIZIJIE_PALETTE.lightStripWarm.hex,
      map: stripTex,
      emissiveMap: stripTex,
      emissive: '#ffdfb0',
      roughness: 0.24,
      metalness: 0.04,
    }),
    0.95,
    0.45,
  )

  // 3. 波纹金属卷帘门（合理 metalness 防无 HDRI 死黑）
  const silverShutter = buildRollerShutterMaps(cache, 'silver')
  const rollerShutterSilver = track(
    new THREE.MeshStandardMaterial({
      name: 'szj_roller_shutter_silver',
      map: silverShutter.map,
      normalMap: silverShutter.normalMap,
      normalScale: new THREE.Vector2(1.05, 1.05),
      roughnessMap: silverShutter.roughnessMap,
      roughness: 1,
      metalness: 0.42,
      emissive: '#8f99a3',
    }),
    0.04,
    0.05,
  )
  rollerShutterSilver.userData = { tiled: true, periodM: [1.4, 2.2] }

  const creamShutter = buildRollerShutterMaps(cache, 'cream')
  const rollerShutterCream = track(
    new THREE.MeshStandardMaterial({
      name: 'szj_roller_shutter_cream',
      map: creamShutter.map,
      normalMap: creamShutter.normalMap,
      normalScale: new THREE.Vector2(1.05, 1.05),
      roughnessMap: creamShutter.roughnessMap,
      roughness: 1,
      metalness: 0.28,
      emissive: '#b8b0a1',
    }),
    0.04,
    0.05,
  )
  rollerShutterCream.userData = { tiled: true, periodM: [1.4, 2.2] }

  // 4. 地面梯井雨棚与金属构件（控制在合理 metalness 保持冷冽质感而不发黑）
  const canopyGlassBlue = track(
    new THREE.MeshStandardMaterial({
      name: 'szj_canopy_glass_blue',
      map: stoneAndWall.canopyGlass,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      roughness: 0.14,
      metalness: 0.2,
      side: THREE.DoubleSide,
      emissive: '#4d7c94',
    }),
    0.08,
    0.06,
  )

  const canopyTrussDark = track(
    new THREE.MeshStandardMaterial({
      name: 'szj_canopy_truss_dark',
      color: SHIZIJIE_PALETTE.canopyTrussDark.hex,
      roughness: 0.36,
      metalness: 0.28,
      emissive: '#47505e',
    }),
    0.12,
    0.05,
  )

  const canopyHandrailWhite = track(
    new THREE.MeshStandardMaterial({
      name: 'szj_canopy_handrail_white',
      color: SHIZIJIE_PALETTE.canopyHandrailWhite.hex,
      roughness: 0.3,
      metalness: 0.32,
    }),
  )

  const handrailSteel = track(
    new THREE.MeshStandardMaterial({
      name: 'szj_handrail_steel',
      color: SHIZIJIE_PALETTE.handrailSteel.hex,
      roughness: 0.24,
      metalness: 0.52,
      emissive: '#9da5ae',
    }),
    0.06,
    0.05,
  )

  const bollardRedReflect = track(
    new THREE.MeshStandardMaterial({
      name: 'szj_bollard_red_reflect',
      color: SHIZIJIE_PALETTE.bollardRedReflect.hex,
      roughness: 0.28,
      metalness: 0.16,
      emissive: '#bd3a31',
    }),
    0.16,
    0.16,
  )

  const storefrontGlass = track(
    new THREE.MeshStandardMaterial({
      name: 'szj_storefront_glass',
      color: SHIZIJIE_PALETTE.storefrontGlassTint.hex,
      transparent: true,
      opacity: 0.22,
      roughness: 0.08,
      metalness: 0.12,
      depthWrite: false,
      emissive: '#cde2ed',
    }),
    0.04,
    0.05,
  )

  const rackMetal = track(
    new THREE.MeshStandardMaterial({
      name: 'szj_rack_metal',
      color: '#525a66',
      roughness: 0.34,
      metalness: 0.34,
      emissive: '#3a414c',
    }),
    0.07,
    0.04,
  )

  // 5. 招牌合批图集（Sheet 1: 1024×512 1:1 店铺/入口/安全出口 + Sheet 2: 1024×256 1:1 wayfinding 吊牌）
  const atlas = buildSignAtlasMaps(cache)
  const signAtlasMat = bindSignNonLitMask(
    track(
      new THREE.MeshStandardMaterial({
        name: 'szj_sign_atlas',
        map: atlas.map,
        emissiveMap: atlas.map,
        emissive: '#ffffff',
        roughness: 0.3,
        metalness: 0.08,
      }),
      0.56,
      0.34,
    ),
  )

  const wf = opts.wayfinding ?? getDefaultWayfinding()
  const wfAtlas = buildWayfindingSignAtlas(wf, cache)
  const wayfindingMat = track(
    new THREE.MeshStandardMaterial({
      name: 'szj_wayfinding_atlas',
      map: wfAtlas.map,
      emissiveMap: wfAtlas.map,
      emissive: '#ffffff',
      roughness: 0.28,
      metalness: 0.1,
    }),
    0.58,
    0.2,
  )

  const snapshot = cache.getSnapshot()
  if (snapshot.rawBytes > SHIZIJIE_TEXTURE_BUDGET_BYTES || snapshot.mipmappedBytes > SHIZIJIE_TEXTURE_BUDGET_BYTES) {
    throw new RangeError(
      `Texture budget exceeded: raw=${snapshot.rawBytes}B mip=${snapshot.mipmappedBytes}B > ${SHIZIJIE_TEXTURE_BUDGET_BYTES}B`,
    )
  }

  return {
    floorTerrazzo,
    floorCorridorTile,
    stairGranite,
    stairTread,
    wallCorridor,
    columnStone,
    ceilingGrid,
    lightStripCool,
    lightStripWarm,
    rollerShutterSilver,
    rollerShutterCream,
    canopyGlassBlue,
    canopyTrussDark,
    canopyHandrailWhite,
    handrailSteel,
    bollardRedReflect,
    storefrontGlass,
    signAtlasMat,
    wayfindingMat,
    wayfindingAtlas: wfAtlas.layout,
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
      if (disposed) return
      disposed = true
      for (const m of mats) m.dispose()
      if (usesDefaultShared) {
        releaseDefaultSharedCache()
      } else if (!opts.preserveExternalCacheOnDispose) {
        cache.releaseAll()
      }
    },
  }
}

/** 按 contract.ts `Xxg/SzjShop.lookKey` 与 `category` 索引材质或招牌图集槽位。 */
export function resolveShopLook(
  pack: ShizijieMaterialPack,
  lookKey?: string,
  category?: SzjShopCategory,
  index = 0,
): ResolvedShopLook {
  if (lookKey && Object.prototype.hasOwnProperty.call(SZJ_SIGN_ATLAS_RECTS, lookKey)) {
    const slot = lookKey as SzjSignAtlasSlot
    return {
      kind: 'sign-atlas',
      key: slot,
      slot,
      rect: SZJ_SIGN_ATLAS_RECTS[slot],
      material: pack.signAtlasMat,
      isFallback: false,
      applyUv: (geometry, padPx) => applySignAtlasRect(geometry, slot, padPx),
    }
  }
  if (lookKey && PACK_MATERIAL_KEYS.has(lookKey as ShizijieMaterialSlotKey)) {
    const key = lookKey as ShizijieMaterialSlotKey
    return {
      kind: 'material',
      key,
      material: pack[key],
      isFallback: false,
    }
  }
  if (category) {
    const slot = getCategorySignSlot(category, index)
    return {
      kind: 'sign-atlas',
      key: slot,
      slot,
      rect: SZJ_SIGN_ATLAS_RECTS[slot],
      material: pack.signAtlasMat,
      isFallback: false,
      applyUv: (geometry, padPx) => applySignAtlasRect(geometry, slot, padPx),
    }
  }
  return {
    kind: 'material',
    key: 'rollerShutterSilver',
    material: pack.rollerShutterSilver,
    isFallback: true,
  }
}
