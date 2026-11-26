/**
 * 王城饮品店视觉皮肤唯一入口：
 * 统一产出招牌文案/色值、吉祥物配色、杯套贴花、NPC 服饰、建筑材质与 UI 品牌令牌，
 * 保证 `drinks/props`、`drinks/npc`、`drinks/shop`、`drinks/ui`、`drinks/hold` 五端同源且零真商标。
 */

export type DrinksEmblemKind = 'crown_spark' | 'wave_ribbon' | 'minimal_badge'

export interface DrinksSignboardSkin {
  readonly shopId: string
  readonly propsBrandLabel: string
  readonly displayName: string
  readonly shortName: string
  readonly shopBrandName: string
  readonly subLabel: string
  readonly fasciaSubtitle: string
  readonly menuBoardHeader: string
  readonly callScreenTitle: string
  readonly cupTag: string
  readonly brandMark: string
}

export interface DrinksMascotSkin {
  readonly id: string
  readonly name: string
  readonly emblemKind: DrinksEmblemKind
  readonly bodyColor: string
  readonly eyeColor: string
  readonly crownColor: string
  readonly scarfColor: string
  readonly baseCreamColor: string
  readonly scepterConeColor: string
  readonly scoopColor: string
}

export interface DrinksSleeveSkin {
  readonly propsSkinId: string
  readonly primaryHex: string
  readonly secondaryHex: string
  readonly creamHex: string
  readonly goldHex: string
  readonly cupTintHex: string
  readonly sealFilmHex: string
  readonly cupBandColor: string
  readonly emblemKind: DrinksEmblemKind
}

export interface DrinksNpcSkinPalette {
  readonly clerkShirtColor: string
  readonly clerkApronColor: string
  readonly clerkCapColor: string
  readonly clerkPantsColor: string
  readonly cupBrandBandColor: string
}

export interface DrinksArchitecturePalette {
  readonly roofColor: string
  readonly wallCreamColor: string
  readonly wainscotWoodColor: string
  readonly floorTileColor: string
  readonly sidewalkColor: string
  readonly tactilePathColor: string
  readonly curtainMullionColor: string
  readonly curtainGlassColor: string
  readonly doorGlassColor: string
  readonly counterBodyColor: string
  readonly counterTopColor: string
  readonly stainlessColor: string
  readonly darkEquipmentColor: string
  readonly woodTableColor: string
  readonly chairIndoorColor: string
  readonly chairPatioColor: string
  readonly parasolColor: string
  readonly crateColor: string
  readonly ceilingLampColor: string
  readonly uiAccentColor: string
}

export interface DrinksMasterSkin {
  readonly skinId: string
  readonly isOriginalSkin: true
  readonly signboard: DrinksSignboardSkin
  readonly mascot: DrinksMascotSkin
  readonly sleeve: DrinksSleeveSkin
  readonly npc: DrinksNpcSkinPalette
  readonly architecture: DrinksArchitecturePalette
}

/** 保持与现有 `ui` / `hold` 导入完全兼容的轻量门店皮肤视图 */
export interface DrinksShopSkinConfig {
  readonly skinId: string
  readonly shopId: string
  readonly displayName: string
  readonly shortName: string
  readonly cupTag: string
  readonly brandMark: string
  readonly isOriginalSkin: true
}

/** 与 `web/src/drinks/props/skins.ts` `DrinkSkinConfig` 结构一致（纯数据无 Three 纹理回调） */
export interface DrinksPropsSkinCompat {
  readonly id: string
  readonly brandLabel: string
  readonly subLabel: string
  readonly primaryHex: string
  readonly secondaryHex: string
  readonly creamHex: string
  readonly goldHex: string
  readonly cupTintHex: string
  readonly sealFilmHex: string
  readonly emblemKind: DrinksEmblemKind
}

/** 与 `web/src/drinks/npc/types.ts` `DrinksNpcSkinConfig` 结构一致 */
export interface DrinksNpcSkinCompat {
  readonly shopBrandName: string
  readonly clerkShirtColor: string
  readonly clerkApronColor: string
  readonly clerkCapColor: string
  readonly clerkPantsColor: string
  readonly cupBrandBandColor: string
}

/** 与 `web/src/drinks/shop/materials.ts` 对齐的门店全套视觉生成包 */
export interface DrinksShopSkinCompat {
  readonly propSkin: DrinksPropsSkinCompat
  readonly signboard: DrinksSignboardSkin
  readonly mascot: DrinksMascotSkin
  readonly architecture: DrinksArchitecturePalette
}

export const DEFAULT_MASTER_DRINKS_SKIN: DrinksMasterSkin = {
  skinId: 'wangcheng_tea_original',
  isOriginalSkin: true,
  signboard: {
    shopId: 'shop_wangcheng_drinks',
    propsBrandLabel: '桂林冰饮',
    displayName: '蜜雪林城',
    shortName: '蜜雪林城',
    shopBrandName: '蜜雪林城旗舰店',
    subLabel: 'LINCHENG FROST',
    fasciaSubtitle: 'WANGCHENG ICE TEA · 鲜果茶 · 冰淇淋 · 现磨咖啡',
    menuBoardHeader: '蜜雪林城 · 招牌饮品',
    callScreenTitle: '取餐叫号',
    cupTag: '蜜雪林城',
    brandMark: '雪',
  },
  mascot: {
    id: 'drinks.ice_crown_mascot',
    name: '冰冠萌偶',
    emblemKind: 'crown_spark',
    bodyColor: '#ffffff',
    eyeColor: '#272d36',
    crownColor: '#f6c33e',
    scarfColor: '#d9252e',
    baseCreamColor: '#fff7ee',
    scepterConeColor: '#db6e54',
    scoopColor: '#ffffff',
  },
  sleeve: {
    propsSkinId: 'guilin_frost_original',
    primaryHex: '#d9252e',
    secondaryHex: '#b31822',
    creamHex: '#fff7ee',
    goldHex: '#f6c33e',
    cupTintHex: '#f8fcff',
    sealFilmHex: '#d9252e',
    cupBandColor: '#d93d35',
    emblemKind: 'crown_spark',
  },
  npc: {
    clerkShirtColor: '#f6f3eb',
    clerkApronColor: '#d93d35',
    clerkCapColor: '#d93d35',
    clerkPantsColor: '#252a31',
    cupBrandBandColor: '#d93d35',
  },
  architecture: {
    roofColor: '#e6e1d8',
    wallCreamColor: '#f6f2ea',
    wainscotWoodColor: '#d7be98',
    floorTileColor: '#ede7db',
    sidewalkColor: '#8f8e88',
    tactilePathColor: '#d8b740',
    curtainMullionColor: '#242930',
    curtainGlassColor: '#d6eaf2',
    doorGlassColor: '#c4e3ee',
    counterBodyColor: '#f5efe3',
    counterTopColor: '#ffffff',
    stainlessColor: '#b7c0c7',
    darkEquipmentColor: '#272d36',
    woodTableColor: '#f6f1e6',
    chairIndoorColor: '#d4be9f',
    chairPatioColor: '#db6e54',
    parasolColor: '#d9252e',
    crateColor: '#b8844c',
    ceilingLampColor: '#fff8e8',
    uiAccentColor: '#a9503c',
  },
}

export interface DrinksMasterSkinOverride {
  skinId?: string
  signboard?: Partial<DrinksSignboardSkin>
  mascot?: Partial<DrinksMascotSkin>
  sleeve?: Partial<DrinksSleeveSkin>
  npc?: Partial<DrinksNpcSkinPalette>
  architecture?: Partial<DrinksArchitecturePalette>
}

export function resolveDrinksMasterSkin(override?: DrinksMasterSkinOverride): DrinksMasterSkin {
  if (!override) return DEFAULT_MASTER_DRINKS_SKIN
  return {
    skinId: override.skinId ?? DEFAULT_MASTER_DRINKS_SKIN.skinId,
    isOriginalSkin: true,
    signboard: { ...DEFAULT_MASTER_DRINKS_SKIN.signboard, ...override.signboard },
    mascot: { ...DEFAULT_MASTER_DRINKS_SKIN.mascot, ...override.mascot },
    sleeve: { ...DEFAULT_MASTER_DRINKS_SKIN.sleeve, ...override.sleeve },
    npc: { ...DEFAULT_MASTER_DRINKS_SKIN.npc, ...override.npc },
    architecture: { ...DEFAULT_MASTER_DRINKS_SKIN.architecture, ...override.architecture },
  }
}

/**
 * 由统一皮肤主配置生成 `drinks/props` 默认皮肤（`variant='props'` 对齐 `DEFAULT_DRINK_SKIN`，
 * `variant='shop'` 对齐 `drinks/shop/materials.ts`）。
 */
export function createPropsDrinkSkin(
  master: DrinksMasterSkin = DEFAULT_MASTER_DRINKS_SKIN,
  variant: 'props' | 'shop' = 'props',
): DrinksPropsSkinCompat {
  return {
    id: master.sleeve.propsSkinId,
    brandLabel: variant === 'shop' ? master.signboard.displayName : master.signboard.propsBrandLabel,
    subLabel: master.signboard.subLabel,
    primaryHex: master.sleeve.primaryHex,
    secondaryHex: master.sleeve.secondaryHex,
    creamHex: master.sleeve.creamHex,
    goldHex: master.sleeve.goldHex,
    cupTintHex: master.sleeve.cupTintHex,
    sealFilmHex: master.sleeve.sealFilmHex,
    emblemKind: master.sleeve.emblemKind,
  }
}

/** 由统一皮肤主配置生成 `drinks/npc` 默认皮肤（100% 匹配 `DEFAULT_DRINKS_NPC_SKIN`） */
export function createNpcDrinksSkin(
  master: DrinksMasterSkin = DEFAULT_MASTER_DRINKS_SKIN,
): DrinksNpcSkinCompat {
  return {
    shopBrandName: master.signboard.shopBrandName,
    clerkShirtColor: master.npc.clerkShirtColor,
    clerkApronColor: master.npc.clerkApronColor,
    clerkCapColor: master.npc.clerkCapColor,
    clerkPantsColor: master.npc.clerkPantsColor,
    cupBrandBandColor: master.npc.cupBrandBandColor,
  }
}

/** 由统一皮肤主配置生成 `drinks/shop` 建筑+招牌+吉祥物全量材质皮肤 */
export function createShopDrinksSkin(
  master: DrinksMasterSkin = DEFAULT_MASTER_DRINKS_SKIN,
): DrinksShopSkinCompat {
  return {
    propSkin: createPropsDrinkSkin(master, 'shop'),
    signboard: { ...master.signboard },
    mascot: { ...master.mascot },
    architecture: { ...master.architecture },
  }
}

/** 由统一皮肤主配置生成 UI / Hold 默认店铺信息 */
export function createUiDrinksSkin(
  master: DrinksMasterSkin = DEFAULT_MASTER_DRINKS_SKIN,
): DrinksShopSkinConfig {
  return {
    skinId: master.skinId,
    shopId: master.signboard.shopId,
    displayName: master.signboard.displayName,
    shortName: master.signboard.shortName,
    cupTag: master.signboard.cupTag,
    brandMark: master.signboard.brandMark,
    isOriginalSkin: true,
  }
}

export const DEFAULT_DRINKS_SKIN: DrinksShopSkinConfig = createUiDrinksSkin(DEFAULT_MASTER_DRINKS_SKIN)
