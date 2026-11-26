/**
 * 十字街地下街 B1 视觉材质、招牌图集、天花板 wayfinding 灯箱与地面梯井入口罩出口。
 */

export {
  SHIZIJIE_TEXTURE_BUDGET_BYTES,
  SHIZIJIE_ATLAS_MAX_SHEETS,
  SHIZIJIE_PALETTE,
  SHIZIJIE_WAYFINDING_PALETTE,
  SHIZIJIE_SIGN_FONTS,
  SHIZIJIE_UI_TOKENS,
  SZJ_SIGN_ATLAS_RECTS,
  SZJ_SIGN_META,
  SZJ_CATEGORY_SIGN_SLOTS,
  getStairExitSignSlot,
  getCategorySignSlot,
  uvBoundsFromAtlasRect,
  applySignAtlasRect,
  type AtlasRect,
  type SwatchSpec,
  type SzjSignAtlasSlot,
  type SzjSignMeta,
} from './palette.ts'

export {
  SHIZIJIE_PUBLIC_TEXTURE_URLS,
  createTextureUploadCache,
  buildTerrazzoMaps,
  buildCorridorTileMaps,
  buildCeilingGridMaps,
  buildLightStripTexture,
  buildRollerShutterMaps,
  buildStairAndWallMaps,
  buildSignAtlasMaps,
  type TextureUploadCache,
  type TextureBudgetSnapshot,
  type TextureBudgetEntry,
} from './textures.ts'

export {
  WAYFINDING_ATLAS_WIDTH,
  WAYFINDING_ATLAS_HEIGHT,
  WAYFINDING_ROW_PX,
  WAYFINDING_TEXELS_PER_METER,
  computeWayfindingAtlasLayout,
  buildWayfindingSignAtlas,
  buildWayfindingFaceGeometry,
  createWayfindingSignsGroup,
  type WayfindingExitLabelSpec,
  type SzjWayfindingAtlasLayout,
  type SzjWayfindingAtlasResult,
  type SzjWayfindingSignsBatch,
} from './wayfinding-signs.ts'

export {
  createShizijieMaterials,
  resolveShopLook,
  type ShizijieMaterialPack,
  type CreateShizijieMaterialsOptions,
  type ShizijieMaterialSlotKey,
  type ResolvedShopLook,
} from './materials.ts'

export {
  createStairwellHood,
  createSurfaceStairwellHoods,
  type SurfaceHoodBuildOptions,
} from './canopy.ts'
