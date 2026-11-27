/**
 * 小香港地下商业城室内视觉素材库入口（Stage 2 预备，零 runtime/layout 依赖）。
 */

export {
  XXG_TEXTURE_BUDGET_BYTES,
  XXG_PALETTE,
  XXG_SIGN_FONTS,
  XXG_UI_TOKENS,
  SIGN_ATLAS_RECTS,
  XXG_PHOTO_COMPARISON_PAIRS,
  uvBoundsFromAtlasRect,
  applySignAtlasRect,
  applyAtlasRectUv,
  XXG_SIGN_ATLAS_W,
  XXG_SIGN_ATLAS_H,
  XXG_FASCIA_ASPECT,
  XXG_BLADE_ASPECT,
  type AtlasRect,
  type SwatchSpec,
  type SignAtlasSlot,
  type PhotoComparisonPair,
} from './palette.ts'

export {
  createTextureUploadCache,
  buildTerrazzoMaps,
  buildRenovatedTileMaps,
  buildCeilingGridMaps,
  buildLightStripTexture,
  buildRollerShutterMaps,
  buildWallAndStoneMaps,
  type TextureUploadCache,
  type TextureBudgetSnapshot,
  type TextureBudgetEntry,
} from './textures.ts'

export {
  createXiaoxianggangMaterials,
  resolveShopLook,
  type XiaoxianggangMaterialPack,
  type CreateMaterialsOptions,
  type MaterialSlotKey,
  type ResolvedShopLook,
} from './materials.ts'

export { buildSignAtlasMap } from './sign-atlas.ts'
export {
  XXG_SHOP_SIGNS,
  XXG_SIGN_PLAQUES,
  isLitSignStyle,
  type XxgShopSign,
  type XxgSignExtra,
  type XxgSignFace,
  type XxgSignForm,
  type XxgSignStyle,
} from './shop-signs.ts'
