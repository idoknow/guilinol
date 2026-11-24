export {
  DRINK_IDS,
  DRINK_CATALOG,
  DRINK_SIM_SKU_ALIASES,
  resolveDrinkPropId,
  type DrinkId,
  type DrinkSpec,
  type DrinkSilhouetteKind,
  type DrinkLidKind,
} from './catalog.ts'
export {
  DEFAULT_DRINK_SKIN,
  resolveDrinkSkin,
  createCupSleeveTexture,
  createCaramelSwirlTexture,
  type DrinkSkinConfig,
} from './skins.ts'
export {
  DRINK_HAND_GRIP,
  buildDrinkProp,
  buildAllDrinksShowcaseGroup,
  attachDrinkToHand,
  disposeDrinkProp,
  countObjectTriangles,
  countObjectMeshes,
  measureDrinkBounds,
  inspectDrinkCatalogProps,
  type DrinkBuildOptions,
  type DrinkPropBounds,
  type DrinkPropReportItem,
} from './builder.ts'
