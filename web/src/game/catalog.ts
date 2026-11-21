import {EBIKE_UPGRADE_MAX_KMH} from '../walk/tuning'

export type PersonalEbikeModelId = 'lijiang_light' | 'city_range' | 'xiangshan_gt'
export type OutfitSlot = 'top' | 'bottom' | 'shoes' | 'hat' | 'bag'
export type EquippedOutfit = Record<OutfitSlot, string>

export interface PersistedEbikeUpgrades {
  motorLevel: 0 | 1 | 2 | 3
  controllerLevel: 0 | 1 | 2 | 3
  batteryLevel: 0 | 1 | 2 | 3
}

export type EbikeVisualPresetId = 'stock' | 'neon' | 'ghostfire'

export interface PersistedEbikeVisual {
  preset: EbikeVisualPresetId
  paintColor?: number
  underglow: boolean
  underglowColor: number
  angelEye: boolean
  angelEyeColor: number
  goldShock: boolean
  tailWing: boolean
  exhaust: boolean
  windshield?: 'none' | 'clear' | 'tinted'
  topbox?: 'none' | 'commuter' | 'delivery'
  headlightTier?: 0 | 1 | 2
}

/** Single-source economic constants reconciled across IDOK-122 / IDOK-123 / IDOK-124 / IDOK-125 / IDOK-128. */
export const ECONOMY_CONSTANTS = {
  INITIAL_MONEY: 200,
  MAX_MONEY: 99_999_999,
  SPOT_BOUNTY: 120,
  MAX_SINGLE_REWARD: 2_000,
  SHARED_BIKE_FEE: 3,
  SHARED_BIKE_FREE_GRACE_SEC: 120,
  FAST_CHARGE_PRICE: 20,
  FULL_REPAIR_MAX_PRICE: 80,
  FULL_REPAIR_MIN_PRICE: 10,
  SUMMON_COOLDOWN_MS: 10_000,
  TEST_RIDE_DURATION_MS: 90_000,
  TEST_RIDE_MAX_RADIUS_M: 350,
} as const

export const DEFAULT_EQUIPPED_OUTFIT: Readonly<EquippedOutfit> = {
  top: 'top_default_tee',
  bottom: 'bottom_default_pants',
  shoes: 'shoes_default_sneaker',
  hat: 'hat_none',
  bag: 'bag_none',
}

export const DEFAULT_OWNED_OUTFIT_ITEMS: readonly string[] = [
  'top_default_tee',
  'bottom_default_pants',
  'shoes_default_sneaker',
  'hat_none',
  'bag_none',
]

export interface OutfitItemDef {
  readonly id: string
  readonly name: string
  readonly slot: OutfitSlot
  readonly tier: 0 | 1 | 2 | 3
  readonly price: number
  readonly presetId?: string
  readonly desc: string
  /** Optional vertex-color / swatch hints consumed by Stage 2A `walk/outfits.ts` */
  readonly palette?: {primary: number; panel?: number; trim?: number; sole?: number}
}

export interface OutfitPresetDef {
  readonly id: string
  readonly name: string
  readonly tier: 0 | 1 | 2 | 3
  readonly price: number
  readonly desc: string
  readonly slots: Readonly<EquippedOutfit>
}

export const OUTFIT_ITEMS: readonly OutfitItemDef[] = [
  // Free default set
  {id: 'top_default_tee', name: '桂林常服·落霞短袖', slot: 'top', tier: 0, price: 0, presetId: 'outfit_default', desc: '经典落霞橙日常上衣', palette: {primary: 0xde5211, panel: 0x222c33, trim: 0xe2dcce}},
  {id: 'bottom_default_pants', name: '桂林常服·深靛长裤', slot: 'bottom', tier: 0, price: 0, presetId: 'outfit_default', desc: '耐穿深靛蓝休闲长裤', palette: {primary: 0x172946}},
  {id: 'shoes_default_sneaker', name: '桂林常服·米灰板鞋', slot: 'shoes', tier: 0, price: 0, presetId: 'outfit_default', desc: '轻便街头漫步鞋', palette: {primary: 0xdad2c2, sole: 0x8d5226}},
  {id: 'hat_none', name: '不戴头饰', slot: 'hat', tier: 0, price: 0, presetId: 'outfit_default', desc: '保持原发型清爽出门'},
  {id: 'bag_none', name: '不背随身包', slot: 'bag', tier: 0, price: 0, presetId: 'outfit_default', desc: '轻装上阵'},

  // T1-1: outfit_guilin_hoodie (¥480 bundle)
  {id: 'top_guilin_hoodie', name: '落雾卫衣', slot: 'top', tier: 1, price: 220, presetId: 'outfit_guilin_hoodie', desc: '石青灰连帽卫衣，配桂花黄抽绳', palette: {primary: 0x566973, panel: 0x3b4852, trim: 0xf0be54}},
  {id: 'bottom_guilin_hoodie', name: '象牙工装裤', slot: 'bottom', tier: 1, price: 160, presetId: 'outfit_guilin_hoodie', desc: '多袋阔腿街头工装裤', palette: {primary: 0x2e3640}},
  {id: 'shoes_guilin_hoodie', name: '石板帆布鞋', slot: 'shoes', tier: 1, price: 120, presetId: 'outfit_guilin_hoodie', desc: '低帮软底城市帆布鞋', palette: {primary: 0xe8e2d5, sole: 0x4b5359}},
  {id: 'hat_guilin_cap', name: '漓岸棒球帽', slot: 'hat', tier: 1, price: 80, presetId: 'outfit_guilin_hoodie', desc: '青灰弯檐街帽', palette: {primary: 0x455863}},
  {id: 'bag_canvas_tote', name: '桂花斜挎包', slot: 'bag', tier: 1, price: 80, presetId: 'outfit_guilin_hoodie', desc: '原色帆布通勤挎包', palette: {primary: 0xd8c8a8}},

  // T1-2: outfit_linen_summer (¥480 bundle)
  {id: 'top_linen_summer', name: '漓水亚麻衬衫', slot: 'top', tier: 1, price: 220, presetId: 'outfit_linen_summer', desc: '透气米白亚麻开襟衫', palette: {primary: 0xebe4d4, panel: 0xd4cbb8, trim: 0x5c8070}},
  {id: 'bottom_linen_summer', name: '青竹休闲裤', slot: 'bottom', tier: 1, price: 160, presetId: 'outfit_linen_summer', desc: '宽松青竹绿亚麻裤', palette: {primary: 0x4b6b5d}},
  {id: 'shoes_linen_summer', name: '编织乐福鞋', slot: 'shoes', tier: 1, price: 120, presetId: 'outfit_linen_summer', desc: '米杏透气平底鞋', palette: {primary: 0xd6c3a5, sole: 0x6b5340}},
  {id: 'hat_straw_bucket', name: '榕荫渔夫帽', slot: 'hat', tier: 1, price: 80, presetId: 'outfit_linen_summer', desc: '夏日防晒亚麻渔夫帽', palette: {primary: 0xdccbb0}},
  {id: 'bag_rattan_sling', name: '竹编轻骑包', slot: 'bag', tier: 1, price: 80, presetId: 'outfit_linen_summer', desc: '轻质编织小背袋', palette: {primary: 0xb89668}},

  // T2-1: outfit_rider_vest (¥960 bundle)
  {id: 'top_rider_vest', name: '山城骑行机能马甲', slot: 'top', tier: 2, price: 420, presetId: 'outfit_rider_vest', desc: '反光饰条防风骑行马甲', palette: {primary: 0x2a343b, panel: 0x1a2026, trim: 0x20d6c1}},
  {id: 'bottom_rider_vest', name: '护膝骑行裤', slot: 'bottom', tier: 2, price: 300, presetId: 'outfit_rider_vest', desc: '耐磨弹力骑行长裤', palette: {primary: 0x232a32}},
  {id: 'shoes_rider_vest', name: '高帮机能靴', slot: 'shoes', tier: 2, price: 240, presetId: 'outfit_rider_vest', desc: '防滑减震电摩骑行鞋', palette: {primary: 0x2e353d, sole: 0x20d6c1}},
  {id: 'hat_helmet_commute', name: '漓行通勤半盔', slot: 'hat', tier: 2, price: 160, presetId: 'outfit_rider_vest', desc: '轻量化防风镜片安全半盔', palette: {primary: 0xeae6dc, trim: 0x20d6c1}},
  {id: 'bag_delivery_pack', name: '全城跑单硬壳包', slot: 'bag', tier: 2, price: 180, presetId: 'outfit_rider_vest', desc: '恒温防泼水城市机能背包', palette: {primary: 0x2c3c45, trim: 0xffc53d}},

  // T2-2: outfit_lijiang_shell (¥960 bundle)
  {id: 'top_lijiang_shell', name: '青灰防雨冲锋衣', slot: 'top', tier: 2, price: 420, presetId: 'outfit_lijiang_shell', desc: '应对桂林烟雨的三层压胶壳衣', palette: {primary: 0x3b6c75, panel: 0x243b42, trim: 0xf4efe2}},
  {id: 'bottom_lijiang_shell', name: '防泼水速干裤', slot: 'bottom', tier: 2, price: 300, presetId: 'outfit_lijiang_shell', desc: '修身防雨户外束脚裤', palette: {primary: 0x28363d}},
  {id: 'shoes_lijiang_shell', name: '喀斯特徒步鞋', slot: 'shoes', tier: 2, price: 240, presetId: 'outfit_lijiang_shell', desc: '湿地高抓地防滑鞋', palette: {primary: 0x4f5c61, sole: 0x292d30}},
  {id: 'hat_storm_beanie', name: '防风针织冷帽', slot: 'hat', tier: 2, price: 160, presetId: 'outfit_lijiang_shell', desc: '深青针织帽，不挡视距', palette: {primary: 0x2d4a52}},
  {id: 'bag_waterproof_pack', name: '卷口防水双肩包', slot: 'bag', tier: 2, price: 180, presetId: 'outfit_lijiang_shell', desc: '雨天通勤无忧防水包', palette: {primary: 0x374c54}},

  // T3-1: outfit_guochao_pankou (¥1,680 bundle)
  {id: 'top_guochao_pankou', name: '王城国潮盘扣夹克', slot: 'top', tier: 3, price: 680, presetId: 'outfit_guochao_pankou', desc: '朱砂金线立领盘扣拼接夹克', palette: {primary: 0x8f2d24, panel: 0x1e2229, trim: 0xffc53d}},
  {id: 'bottom_guochao_pankou', name: '玄墨束脚长裤', slot: 'bottom', tier: 3, price: 480, presetId: 'outfit_guochao_pankou', desc: '国潮暗纹织带运动长裤', palette: {primary: 0x1a1e24}},
  {id: 'shoes_guochao_pankou', name: '金桂联名潮鞋', slot: 'shoes', tier: 3, price: 380, presetId: 'outfit_guochao_pankou', desc: '黑金撞色厚底街头潮鞋', palette: {primary: 0x1f2226, sole: 0xffc53d}},
  {id: 'hat_guochao_visor', name: '金桂刺绣礼帽', slot: 'hat', tier: 3, price: 260, presetId: 'outfit_guochao_pankou', desc: '桂花暗纹潮牌鸭舌帽', palette: {primary: 0x1c2026, trim: 0xffc53d}},
  {id: 'bag_guochao_box', name: '朱漆国潮机能箱包', slot: 'bag', tier: 3, price: 280, presetId: 'outfit_guochao_pankou', desc: '双肩硬壳潮玩背箱', palette: {primary: 0x7d2620, trim: 0xffc53d}},

  // T3-2: outfit_night_moto (¥1,680 bundle)
  {id: 'top_night_moto', name: '象山夜骑霓虹皮衣', slot: 'top', tier: 3, price: 680, presetId: 'outfit_night_moto', desc: '哑光黑机车护甲皮衣配青紫光条', palette: {primary: 0x191d24, panel: 0x2c2440, trim: 0x3ef0d8}},
  {id: 'bottom_night_moto', name: '夜骑碳纹骑行裤', slot: 'bottom', tier: 3, price: 480, presetId: 'outfit_night_moto', desc: '修身防摔护具长裤', palette: {primary: 0x161920}},
  {id: 'shoes_night_moto', name: '疾风碳板骑行靴', slot: 'shoes', tier: 3, price: 380, presetId: 'outfit_night_moto', desc: '夜光饰边高速护踝靴', palette: {primary: 0x1a1e26, sole: 0x3ef0d8}},
  {id: 'hat_helmet_full', name: '疾风气动全盔', slot: 'hat', tier: 3, price: 260, presetId: 'outfit_night_moto', desc: '流线护目全覆盖安全盔', palette: {primary: 0x1b2028, trim: 0x3ef0d8}},
  {id: 'bag_aero_shell', name: '流线碳纤驼峰包', slot: 'bag', tier: 3, price: 280, presetId: 'outfit_night_moto', desc: '低风阻电摩高速护脊包', palette: {primary: 0x1f2430, trim: 0xc84bff}},
]

export const OUTFIT_PRESETS: readonly OutfitPresetDef[] = [
  {
    id: 'outfit_default',
    name: '桂林街头常服',
    tier: 0,
    price: 0,
    desc: '初始默认穿搭',
    slots: DEFAULT_EQUIPPED_OUTFIT,
  },
  {
    id: 'outfit_guilin_hoodie',
    name: '街角漫步·落雾套',
    tier: 1,
    price: 480,
    desc: 'T1 入门街头卫衣整套，2~3 单即可拿下',
    slots: {top: 'top_guilin_hoodie', bottom: 'bottom_guilin_hoodie', shoes: 'shoes_guilin_hoodie', hat: 'hat_guilin_cap', bag: 'bag_canvas_tote'},
  },
  {
    id: 'outfit_linen_summer',
    name: '漓水清风·亚麻套',
    tier: 1,
    price: 480,
    desc: 'T1 清爽桂林夏日亚麻穿搭整套',
    slots: {top: 'top_linen_summer', bottom: 'bottom_linen_summer', shoes: 'shoes_linen_summer', hat: 'hat_straw_bucket', bag: 'bag_rattan_sling'},
  },
  {
    id: 'outfit_rider_vest',
    name: '山城骑行·机能套',
    tier: 2,
    price: 960,
    desc: 'T2 跑单骑行专属防风马甲与通勤头盔套装',
    slots: {top: 'top_rider_vest', bottom: 'bottom_rider_vest', shoes: 'shoes_rider_vest', hat: 'hat_helmet_commute', bag: 'bag_delivery_pack'},
  },
  {
    id: 'outfit_lijiang_shell',
    name: '雨雾漓江·冲锋套',
    tier: 2,
    price: 960,
    desc: 'T2 青灰防水三层冲锋衣整套',
    slots: {top: 'top_lijiang_shell', bottom: 'bottom_lijiang_shell', shoes: 'shoes_lijiang_shell', hat: 'hat_storm_beanie', bag: 'bag_waterproof_pack'},
  },
  {
    id: 'outfit_guochao_pankou',
    name: '王城国潮·盘扣套',
    tier: 3,
    price: 1680,
    desc: 'T3 桂林原创朱砂金桂国潮旗舰套装',
    slots: {top: 'top_guochao_pankou', bottom: 'bottom_guochao_pankou', shoes: 'shoes_guochao_pankou', hat: 'hat_guochao_visor', bag: 'bag_guochao_box'},
  },
  {
    id: 'outfit_night_moto',
    name: '夜骑象山·霓虹套',
    tier: 3,
    price: 1680,
    desc: 'T3 电摩性能夜骑护甲与全盔套装',
    slots: {top: 'top_night_moto', bottom: 'bottom_night_moto', shoes: 'shoes_night_moto', hat: 'hat_helmet_full', bag: 'bag_aero_shell'},
  },
]

export const OUTFIT_ITEM_MAP: ReadonlyMap<string, OutfitItemDef> = new Map(OUTFIT_ITEMS.map(item => [item.id, item]))
export const OUTFIT_PRESET_MAP: ReadonlyMap<string, OutfitPresetDef> = new Map(OUTFIT_PRESETS.map(p => [p.id, p]))

/**
 * Partial-set bundle diff pricing rule (reconciled for IDOK-125 / IDOK-122):
 * If the player already bought 1-2 individual pieces of a preset, buying the full preset
 * only charges the pro-rata share of unowned pieces (capped <= preset.price).
 * If all pieces are already owned, returns `alreadyOwned: true, price: 0`.
 */
export function computeOutfitPresetQuote(
  presetId: string,
  ownedItemIds: readonly string[],
): {valid: boolean; alreadyOwned: boolean; price: number; missingItemIds: string[]} {
  const preset = OUTFIT_PRESET_MAP.get(presetId)
  if (!preset) return {valid: false, alreadyOwned: false, price: 0, missingItemIds: []}
  const ownedSet = new Set(ownedItemIds)
  const allSlotIds = Object.values(preset.slots).filter(id => id !== 'hat_none' && id !== 'bag_none')
  const missingItemIds = allSlotIds.filter(id => !ownedSet.has(id))
  if (missingItemIds.length === 0) {
    return {valid: true, alreadyOwned: true, price: 0, missingItemIds: []}
  }
  if (missingItemIds.length === allSlotIds.length) {
    return {valid: true, alreadyOwned: false, price: preset.price, missingItemIds}
  }
  const fullRetail = allSlotIds.reduce((sum, id) => sum + (OUTFIT_ITEM_MAP.get(id)?.price ?? 0), 0)
  const missingRetail = missingItemIds.reduce((sum, id) => sum + (OUTFIT_ITEM_MAP.get(id)?.price ?? 0), 0)
  const discounted = fullRetail > 0 ? Math.round((preset.price * missingRetail) / fullRetail) : preset.price
  return {
    valid: true,
    alreadyOwned: false,
    price: Math.max(0, Math.min(preset.price, discounted)),
    missingItemIds,
  }
}

export interface PersonalEbikeModelDef {
  readonly id: PersonalEbikeModelId
  readonly tier: 1 | 2 | 3
  readonly name: string
  readonly badge: string
  readonly price: number
  readonly desc: string
  readonly stockGearsKmh: readonly [number, number, number, number] // [D1, D2, D3, S]
  readonly hardCapKmh: number // Never exceeds EBIKE_UPGRADE_MAX_KMH (70)
  readonly baseCapacityScale: number
  readonly baseAccelMul: number
  readonly baseDrainMul: number
  readonly maxUpgrades: Readonly<PersistedEbikeUpgrades>
  readonly defaultVisual: Readonly<PersistedEbikeVisual>
  readonly allowedPresets: readonly EbikeVisualPresetId[]
  readonly allowUnderglow: boolean
  readonly allowAngelEye: boolean
  readonly allowGoldShock: boolean
  readonly allowAeroParts: boolean // tailWing + exhaust
}

export const PERSONAL_EBIKE_MODELS: Record<PersonalEbikeModelId, PersonalEbikeModelDef> = {
  lijiang_light: {
    id: 'lijiang_light',
    tier: 1,
    name: '漓江小轻骑',
    badge: '轻骑',
    price: 1800,
    desc: '轻巧好停的新手第一台个人电摩，支持基础改装与外观漆色',
    stockGearsKmh: [16, 25, 36, 42],
    hardCapKmh: 50,
    baseCapacityScale: 1.05,
    baseAccelMul: 1.0,
    baseDrainMul: 0.95,
    maxUpgrades: {motorLevel: 1, controllerLevel: 1, batteryLevel: 2},
    defaultVisual: {
      preset: 'stock',
      paintColor: 0xf1ece1,
      underglow: false,
      underglowColor: 0x3ad6c8,
      angelEye: false,
      angelEyeColor: 0x72ecff,
      goldShock: false,
      tailWing: false,
      exhaust: false,
      windshield: 'none',
      topbox: 'none',
      headlightTier: 0,
    },
    allowedPresets: ['stock'],
    allowUnderglow: false,
    allowAngelEye: false,
    allowGoldShock: false,
    allowAeroParts: false,
  },
  city_range: {
    id: 'city_range',
    tier: 2,
    name: '城心续航摩',
    badge: '续航',
    price: 3600,
    desc: '大容量长续航全城跑单主力车，支持霓虹套件与强化夜灯',
    stockGearsKmh: [16, 25, 38, 50],
    hardCapKmh: 60,
    baseCapacityScale: 1.45,
    baseAccelMul: 1.1,
    baseDrainMul: 0.85,
    maxUpgrades: {motorLevel: 2, controllerLevel: 2, batteryLevel: 3},
    defaultVisual: {
      preset: 'stock',
      paintColor: 0x3b6e78,
      underglow: false,
      underglowColor: 0x3ef0d8,
      angelEye: false,
      angelEyeColor: 0x58f7ff,
      goldShock: false,
      tailWing: false,
      exhaust: false,
      windshield: 'clear',
      topbox: 'commuter',
      headlightTier: 1,
    },
    allowedPresets: ['stock', 'neon'],
    allowUnderglow: true,
    allowAngelEye: true,
    allowGoldShock: true,
    allowAeroParts: false,
  },
  xiangshan_gt: {
    id: 'xiangshan_gt',
    tier: 3,
    name: '象山疾风电摩',
    badge: '旗舰',
    price: 6800,
    desc: '性能旗舰电摩，解锁全槽位深度动力与外观改装（安全上限 70 km/h）',
    stockGearsKmh: [18, 25, 42, 55],
    hardCapKmh: EBIKE_UPGRADE_MAX_KMH,
    baseCapacityScale: 1.65,
    baseAccelMul: 1.22,
    baseDrainMul: 0.95,
    maxUpgrades: {motorLevel: 3, controllerLevel: 3, batteryLevel: 3},
    defaultVisual: {
      preset: 'stock',
      paintColor: 0xb84a32,
      underglow: false,
      underglowColor: 0xc84bff,
      angelEye: true,
      angelEyeColor: 0x72ecff,
      goldShock: true,
      tailWing: false,
      exhaust: false,
      windshield: 'tinted',
      topbox: 'none',
      headlightTier: 2,
    },
    allowedPresets: ['stock', 'neon', 'ghostfire'],
    allowUnderglow: true,
    allowAngelEye: true,
    allowGoldShock: true,
    allowAeroParts: true,
  },
}

export const PERSONAL_EBIKE_LIST: readonly PersonalEbikeModelDef[] = [
  PERSONAL_EBIKE_MODELS.lijiang_light,
  PERSONAL_EBIKE_MODELS.city_range,
  PERSONAL_EBIKE_MODELS.xiangshan_gt,
]

export function isPersonalEbikeModelId(id: unknown): id is PersonalEbikeModelId {
  return id === 'lijiang_light' || id === 'city_range' || id === 'xiangshan_gt'
}

export function clampUpgradesForModel(
  modelId: PersonalEbikeModelId,
  raw?: Partial<PersistedEbikeUpgrades> | null,
): PersistedEbikeUpgrades {
  const cap = PERSONAL_EBIKE_MODELS[modelId].maxUpgrades
  const norm = (v: unknown, max: number): 0 | 1 | 2 | 3 => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0
    return Math.max(0, Math.min(max, n)) as 0 | 1 | 2 | 3
  }
  return {
    motorLevel: norm(raw?.motorLevel, cap.motorLevel),
    controllerLevel: norm(raw?.controllerLevel, cap.controllerLevel),
    batteryLevel: norm(raw?.batteryLevel, cap.batteryLevel),
  }
}

export function sanitizeVisualForModel(
  modelId: PersonalEbikeModelId,
  raw?: Partial<PersistedEbikeVisual> | null,
): PersistedEbikeVisual {
  const def = PERSONAL_EBIKE_MODELS[modelId]
  const base = def.defaultVisual
  const preset: EbikeVisualPresetId = raw?.preset && def.allowedPresets.includes(raw.preset) ? raw.preset : base.preset
  const colorNum = (v: unknown, fb: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff ? v : fb
  return {
    preset,
    paintColor: raw?.paintColor !== undefined ? colorNum(raw.paintColor, base.paintColor ?? 0xf1ece1) : base.paintColor,
    underglow: def.allowUnderglow ? Boolean(raw?.underglow ?? base.underglow) : false,
    underglowColor: colorNum(raw?.underglowColor, base.underglowColor),
    angelEye: def.allowAngelEye ? Boolean(raw?.angelEye ?? base.angelEye) : false,
    angelEyeColor: colorNum(raw?.angelEyeColor, base.angelEyeColor),
    goldShock: def.allowGoldShock ? Boolean(raw?.goldShock ?? base.goldShock) : false,
    tailWing: def.allowAeroParts ? Boolean(raw?.tailWing ?? base.tailWing) : false,
    exhaust: def.allowAeroParts ? Boolean(raw?.exhaust ?? base.exhaust) : false,
    windshield: raw?.windshield === 'none' || raw?.windshield === 'clear' || raw?.windshield === 'tinted' ? raw.windshield : base.windshield,
    topbox: raw?.topbox === 'none' || raw?.topbox === 'commuter' || raw?.topbox === 'delivery' ? raw.topbox : base.topbox,
    headlightTier: raw?.headlightTier === 0 || raw?.headlightTier === 1 || raw?.headlightTier === 2 ? raw.headlightTier : base.headlightTier,
  }
}

export interface EbikeUpgradeCatalogEntry {
  readonly id: string // "motor:1" .. "battery:3"
  readonly part: 'motorLevel' | 'controllerLevel' | 'batteryLevel'
  readonly level: 1 | 2 | 3
  readonly name: string
  readonly price: number
  readonly desc: string
}

export const EBIKE_UPGRADE_CATALOG: readonly EbikeUpgradeCatalogEntry[] = [
  {id: 'motor:1', part: 'motorLevel', level: 1, name: '高磁轮毂电机 Lv.1', price: 320, desc: '极速 +4 km/h · 扭矩提升'},
  {id: 'motor:2', part: 'motorLevel', level: 2, name: '双绕组电机 Lv.2', price: 680, desc: '极速 +8 km/h · 爬坡更轻快'},
  {id: 'motor:3', part: 'motorLevel', level: 3, name: '中置性能电机 Lv.3', price: 1200, desc: '极速 +12 km/h · 澎湃加速'},
  {id: 'controller:1', part: 'controllerLevel', level: 1, name: '正弦波电控 Lv.1', price: 280, desc: '极速 +5 km/h · 油门更跟手'},
  {id: 'controller:2', part: 'controllerLevel', level: 2, name: '矢量电控 Lv.2', price: 620, desc: '极速 +10 km/h · 弯道平顺输出'},
  {id: 'controller:3', part: 'controllerLevel', level: 3, name: '赛道矢量电控 Lv.3', price: 1100, desc: '极速 +15 km/h（钳位 <= 70 km/h）'},
  {id: 'battery:1', part: 'batteryLevel', level: 1, name: '扩容锂电组 Lv.1', price: 240, desc: '电池容量 +35% · 耗电略降'},
  {id: 'battery:2', part: 'batteryLevel', level: 2, name: '高密度锂电组 Lv.2', price: 520, desc: '电池容量 +70% · 全城跑单无忧'},
  {id: 'battery:3', part: 'batteryLevel', level: 3, name: '旗舰长续航电芯 Lv.3', price: 960, desc: '电池容量 +105% · 长途稳航'},
]

export const EBIKE_UPGRADE_MAP: ReadonlyMap<string, EbikeUpgradeCatalogEntry> = new Map(
  EBIKE_UPGRADE_CATALOG.map(e => [e.id, e]),
)

export interface EbikeVisualCatalogEntry {
  readonly id: string
  readonly name: string
  readonly price: number
  readonly desc: string
  readonly patch: Partial<PersistedEbikeVisual>
  readonly requires?: 'neon' | 'ghostfire' | 'underglow' | 'angelEye' | 'goldShock' | 'aero'
}

export const EBIKE_VISUAL_CATALOG: readonly EbikeVisualCatalogEntry[] = [
  {id: 'paint:porcelain', name: '车漆 · 桂林素瓷白', price: 120, desc: '温润青白素瓷漆面', patch: {paintColor: 0xf1ece1}},
  {id: 'paint:lijiang', name: '车漆 · 漓江青灰', price: 120, desc: '桂林山水青灰漆面', patch: {paintColor: 0x3b6e78}},
  {id: 'paint:terracotta', name: '车漆 · 朱砂岩红', price: 150, desc: '复古砖红街头涂装', patch: {paintColor: 0xb84a32}},
  {id: 'paint:obsidian', name: '车漆 · 象山玄黑', price: 180, desc: '哑光炭黑运动涂装', patch: {paintColor: 0x2a2f36}},
  {id: 'paint:osmanthus', name: '车漆 · 桂花暖金', price: 220, desc: '秋日金桂金属烤漆', patch: {paintColor: 0xd9a236}},
  {id: 'paint:indigo', name: '车漆 · 烟雨靛蓝', price: 220, desc: '夜色深靛蓝涂装', patch: {paintColor: 0x2c4b75}},
  {id: 'windshield:clear', name: '配件 · 透明挡风镜', price: 140, desc: '日常防风挡雨风挡', patch: {windshield: 'clear'}},
  {id: 'windshield:tinted', name: '配件 · 熏黑运动风挡', price: 220, desc: '低风阻熏黑风挡', patch: {windshield: 'tinted'}},
  {id: 'topbox:commuter', name: '配件 · 都市通勤尾箱', price: 180, desc: '可放头盔与雨衣', patch: {topbox: 'commuter'}},
  {id: 'topbox:delivery', name: '配件 · 恒温外卖箱', price: 260, desc: '桂林米粉专送保温箱', patch: {topbox: 'delivery'}},
  {id: 'preset:neon', name: '套件 · 漓江霓虹包', price: 420, desc: '青色底盘霓虹 + 天使眼 + 镀金避震', patch: {preset: 'neon', paintColor: 0x266c7a, underglow: true, underglowColor: 0x3ef0d8, angelEye: true, angelEyeColor: 0x58f7ff, goldShock: true}, requires: 'neon'},
  {id: 'preset:ghostfire', name: '套件 · 象山疾风鬼火包', price: 580, desc: '紫电底盘灯 + 粉色天使眼 + 尾翼 + 排气件', patch: {preset: 'ghostfire', paintColor: 0x5c2e8a, underglow: true, underglowColor: 0xc84bff, angelEye: true, angelEyeColor: 0xff4c9a, goldShock: true, tailWing: true, exhaust: true}, requires: 'ghostfire'},
  {id: 'part:underglow', name: '灯光 · 底盘氛围灯', price: 260, desc: '夜间街道青光底盘氛围灯（零动态光源开销）', patch: {underglow: true, underglowColor: 0x3ef0d8}, requires: 'underglow'},
  {id: 'part:angelEye', name: '灯光 · 天使眼大灯圈', price: 220, desc: '高亮自发光天使眼环', patch: {angelEye: true, angelEyeColor: 0x58f7ff}, requires: 'angelEye'},
  {id: 'part:goldShock', name: '底盘 · 镀金液压避震', price: 280, desc: '强化视觉与质感减震套件', patch: {goldShock: true}, requires: 'goldShock'},
  {id: 'part:aero', name: '外观 · 运动尾翼与排气饰件', price: 320, desc: '旗舰专属气动尾翼与侧排饰件', patch: {tailWing: true, exhaust: true}, requires: 'aero'},
]

export const EBIKE_VISUAL_MAP: ReadonlyMap<string, EbikeVisualCatalogEntry> = new Map(
  EBIKE_VISUAL_CATALOG.map(e => [e.id, e]),
)

export function calcFastChargeCost(batteryPct: number): number {
  return batteryPct >= 99.5 ? 0 : ECONOMY_CONSTANTS.FAST_CHARGE_PRICE
}

export function calcRepairCost(durabilityPct: number): number {
  const missing = Math.max(0, 100 - Math.min(100, durabilityPct))
  if (missing < 0.5) return 0
  return Math.min(
    ECONOMY_CONSTANTS.FULL_REPAIR_MAX_PRICE,
    Math.max(ECONOMY_CONSTANTS.FULL_REPAIR_MIN_PRICE, Math.ceil(missing * 0.8)),
  )
}

export function calcFullServiceCost(batteryPct: number, durabilityPct: number): number {
  return calcFastChargeCost(batteryPct) + calcRepairCost(durabilityPct)
}
