import {looks, lookNames, lookPalette, starterOutfit} from '../../../lib/avatar'
/**
 * Single Source of Truth (SSOT) catalog for Guilin Online commerce (IDOK-121 / IDOK-122 / IDOK-123 / IDOK-124).
 *
 * Hard constraints:
 *  - 100% original Guilin local brands/names; ZERO real-world trademarks or rideshare brand colors.
 *  - Pricing locked by IDOK-121 final ruling:
 *      - New player starting funds: ¥200
 *      - Outfits: free outfit_default + 6 streetwear sets (T1 ¥480 / T2 ¥960 / T3 ¥1,680) + slot items
 *      - Personal e-bikes: lijiang_light ¥1,800 (<=50 km/h) / city_range ¥3,600 (<=60 km/h) / xiangshan_gt ¥6,800 (<=70 km/h)
 *      - Service: slow_charge ¥0 (to 80%) / fast_charge ¥20 (to 100%) / full_repair ¥80 (durability to 100%) / full_service dynamic
 *  - Dependency-free so web/src/game/*, web/src/walk/*, web/src/ui/*, and Node unit tests can import directly.
 */

import {
  EBIKE_COMPLIANT_CAP_KMH,
  EBIKE_DEFAULT_GEAR,
  EBIKE_UPGRADE_MAX_KMH,
  type EbikeGearProfile,
  type ResolvedEbikeProfile,
} from '../walk/tuning'

export type OutfitSlot = 'top' | 'bottom' | 'shoes' | 'hat' | 'bag'
export type EquippedOutfit = Record<OutfitSlot, string>
export type PersonalEbikeModelId = 'lijiang_light' | 'city_range' | 'xiangshan_gt'

export interface PersistedEbikeUpgrades {
  motorLevel: 0 | 1 | 2 | 3
  controllerLevel: 0 | 1 | 2 | 3
  batteryLevel: 0 | 1 | 2 | 3
}

export interface PersistedEbikeVisual {
  preset: 'stock' | 'ghostfire' | 'neon'
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

export interface OutfitItemDef {
  readonly id: string
  readonly slot: OutfitSlot
  readonly name: string
  readonly tier: 0 | 1 | 2 | 3
  readonly price: number
  readonly colorHex: string
  readonly accentHex?: string
  readonly description: string
  readonly defaultOwned?: boolean
}

export interface OutfitPresetDef {
  readonly id: string
  readonly name: string
  readonly tier: 0 | 1 | 2 | 3
  readonly price: number
  readonly summary: string
  readonly tag: string
  readonly items: Readonly<EquippedOutfit>
  readonly defaultOwned?: boolean
}

export interface PersonalEbikeModelDef {
  readonly modelId: PersonalEbikeModelId
  readonly name: string
  readonly tierLabel: string
  readonly badge: string
  readonly price: number
  readonly summary: string
  readonly deliverySoupBonus?: number // e.g., 0.25 = -25% spill rate with delivery box
  readonly stockGearKmh: readonly [number, number, number, number] // [D1, D2, D3, S]
  readonly hardCapKmh: number
  readonly capacityScale: number
  readonly drainMul: number
  readonly accelScale: number
  readonly maxUpgrades: Readonly<PersistedEbikeUpgrades>
  readonly allowedVisuals: readonly string[]
  readonly defaultVisual: Readonly<PersistedEbikeVisual>
}

export interface EbikeUpgradeCatalogEntry {
  readonly id: string // e.g. "motor:1"
  readonly kind: 'motor' | 'controller' | 'battery'
  readonly level: 1 | 2 | 3
  readonly name: string
  readonly price: number
  readonly summary: string
}

export interface EbikeVisualCatalogEntry {
  readonly id: string // e.g. "visual:neon" or "paint:jade_slate"
  readonly category: 'paint' | 'kit' | 'accessory'
  readonly name: string
  readonly price: number
  readonly summary: string
  readonly slotKey: string
  readonly patch: Partial<PersistedEbikeVisual>
}

export interface EbikeServiceCatalogEntry {
  readonly id: 'slow_charge' | 'fast_charge' | 'full_repair' | 'full_service'
  readonly name: string
  readonly fixedPrice?: number
  readonly summary: string
}

/** Starting funds for new players (IDOK-121 / IDOK-123 / IDOK-128). */
export const DEFAULT_START_MONEY = 200
export const MAX_SAFE_MONEY = 99_999_999

/** Original Guilin slate/tile/ivory/terracotta shared bike palette (replaces real-world mint). */
export const SHARED_BIKE_ORIGINAL_PALETTE = {
  body: 0x5e7680,
  trim: 0xe8e4da,
  accent: 0xb5563d,
} as const

export const OUTFIT_ITEMS: readonly OutfitItemDef[] = [
  ...looks.slice(1).flatMap((look,i) => (['top','bottom','shoes'] as const).map((slot,j) => ({
    id:slot+'_starter_'+look, slot, name:lookNames[i+1]+['上装','下装','鞋'][j], tier:0 as const, price:0,
    colorHex:lookPalette[i+1][j], accentHex:lookPalette[i+1][3], description:'初始穿搭', defaultOwned:true,
  }))),
  // Default starter pieces (free)
  {id: 'top_default_tee', slot: 'top', name: '米白基础长袖', tier: 0, price: 0, colorHex: '#e9e7e1', description: '干净的米白长袖，什么都好搭', defaultOwned: true},
  {id: 'bottom_default_pants', slot: 'bottom', name: '黑色直筒裤', tier: 0, price: 0, colorHex: '#2a2c30', description: '基础黑色直筒裤', defaultOwned: true},
  {id: 'shoes_default_sneaker', slot: 'shoes', name: '小白鞋', tier: 0, price: 0, colorHex: '#f2f1ed', description: '百搭白色低帮鞋', defaultOwned: true},
  {id: 'hat_none', slot: 'hat', name: '不戴头饰', tier: 0, price: 0, colorHex: '#2b3036', description: '自然短发造型', defaultOwned: true},
  {id: 'bag_none', slot: 'bag', name: '不背包', tier: 0, price: 0, colorHex: '#2c2e32', description: '空手轻装出行', defaultOwned: true},

  // T1: outfit_guilin_hoodie (¥480 set)
  {id: 'top_guilin_hoodie', slot: 'top', name: '烟雨灰落肩卫衣', tier: 1, price: 220, colorHex: '#465460', accentHex: '#ffc53d', description: '重磅纯棉卫衣，胸口桂花金绣标'},
  {id: 'bottom_guilin_cargo', slot: 'bottom', name: '炭黑束脚工装裤', tier: 1, price: 160, colorHex: '#2d3238', description: '多袋街头束脚裤，适合步行骑行'},
  {id: 'shoes_guilin_canvas', slot: 'shoes', name: '青石帆布板鞋', tier: 1, price: 120, colorHex: '#d8d4c8', accentHex: '#35424a', description: '加厚胶底街头板鞋'},
  {id: 'hat_guilin_cap', slot: 'hat', name: '漓江青棒球帽', tier: 1, price: 80, colorHex: '#20998d', description: '防晒弯檐帽，街头辨识度拉满'},

  // T1: outfit_linen_summer (¥480 set)
  {id: 'top_linen_shirt', slot: 'top', name: '象牙亚麻短袖衬衫', tier: 1, price: 220, colorHex: '#ece5d4', accentHex: '#8d9b87', description: '透气桂林夏日亚麻开襟衫'},
  {id: 'bottom_linen_shorts', slot: 'bottom', name: '卡其休闲阔腿裤', tier: 1, price: 160, colorHex: '#a9977b', description: '清爽垂坠感度假休闲裤'},
  {id: 'shoes_linen_loafer', slot: 'shoes', name: '草编透气懒人鞋', tier: 1, price: 120, colorHex: '#c8b28e', description: '榕湖漫步首选轻盈草编鞋'},
  {id: 'bag_linen_tote', slot: 'bag', name: '漓岸帆布斜挎袋', tier: 1, price: 80, colorHex: '#ded5c0', accentHex: '#2d5f59', description: '手工印染山水线条单肩包'},

  // T2: outfit_rider_vest (¥960 set)
  {id: 'top_rider_vest', slot: 'top', name: '桂林快送机能马甲', tier: 2, price: 420, colorHex: '#d98a2b', accentHex: '#1c2329', description: '高可见桂花金反光条骑手马甲，非真实外卖品牌'},
  {id: 'bottom_rider_pants', slot: 'bottom', name: '耐磨防风骑行裤', tier: 2, price: 300, colorHex: '#252a30', accentHex: '#ffc53d', description: '膝部立体剪裁，久骑不勒腿'},
  {id: 'shoes_rider_boots', slot: 'shoes', name: '防滑电摩短靴', tier: 2, price: 260, colorHex: '#1f2326', accentHex: '#7d858c', description: '雨夜湿路防滑橡胶大底短靴'},
  {id: 'hat_rider_helmet', slot: 'hat', name: '桂花金半盔', tier: 2, price: 180, colorHex: '#e6b235', accentHex: '#1d2228', description: '轻量化透气骑行半盔'},
  {id: 'bag_rider_pack', slot: 'bag', name: '保温快送腰挎包', tier: 2, price: 220, colorHex: '#29343b', accentHex: '#ffc53d', description: '防泼水多仓骑行挎包'},

  // T2: outfit_lijiang_shell (¥960 set)
  {id: 'top_lijiang_shell', slot: 'top', name: '漓江青三防冲锋衣', tier: 2, price: 420, colorHex: '#1e9d91', accentHex: '#14191e', description: '防雨透气机能拼色冲锋衣'},
  {id: 'bottom_lijiang_tech', slot: 'bottom', name: '深灰防泼水机能裤', tier: 2, price: 300, colorHex: '#353d44', accentHex: '#20d6c1', description: '拉链风口机能裤'},
  {id: 'shoes_lijiang_trail', slot: 'shoes', name: '喀斯特徒步机能鞋', tier: 2, price: 260, colorHex: '#2e3839', accentHex: '#20d6c1', description: '抓地齿纹户外机能跑鞋'},
  {id: 'bag_lijiang_sling', slot: 'bag', name: '青岚硬壳机能胸包', tier: 2, price: 220, colorHex: '#1d272b', accentHex: '#20d6c1', description: '贴身防晃城市机能胸包'},

  // T3: outfit_guochao_pankou (¥1,680 set)
  {id: 'top_guochao_pankou', slot: 'top', name: '榕城墨韵盘扣夹克', tier: 3, price: 780, colorHex: '#1c242b', accentHex: '#c84b3c', description: '新中式立体盘扣配朱砂暗纹立领夹克'},
  {id: 'bottom_guochao_drape', slot: 'bottom', name: '玄青垂感廓形长裤', tier: 3, price: 540, colorHex: '#1c2026', accentHex: '#b89658', description: '双褶垂坠新国潮长裤'},
  {id: 'shoes_guochao_sneaker', slot: 'shoes', name: '云纹厚底国潮鞋', tier: 3, price: 480, colorHex: '#2a2d31', accentHex: '#d8b46a', description: '桂林山水浮雕底纹旗舰板鞋'},
  {id: 'bag_guochao_satchel', slot: 'bag', name: '鎏金扣织锦挎包', tier: 3, price: 320, colorHex: '#242930', accentHex: '#d8b46a', description: '桂花金扣饰原创国潮方包'},

  // T3: outfit_night_moto (¥1,680 set)
  {id: 'top_night_moto', slot: 'top', name: '夜城流光反光骑行服', tier: 3, price: 780, colorHex: '#161b22', accentHex: '#20d6c1', description: '全包围漓江青+桂花金夜视反光条电摩夹克'},
  {id: 'bottom_night_moto', slot: 'bottom', name: '夜巡护具骑行长裤', tier: 3, price: 540, colorHex: '#181c22', accentHex: '#20d6c1', description: '高弹性护膝反光拼接骑行裤'},
  {id: 'shoes_night_moto', slot: 'shoes', name: '碳纹疾风骑行靴', tier: 3, price: 480, colorHex: '#171a1f', accentHex: '#ffc53d', description: '加硬脚踝保护疾风骑行靴'},
  {id: 'hat_night_visor', slot: 'hat', name: '夜航全覆光镜盔', tier: 3, price: 320, colorHex: '#151920', accentHex: '#20d6c1', description: '流线型防风全盔配青色镜片'},

  // Traffic volunteer / persuasion duty kit (compliant public-web civic guidance design)
  {id: 'top_traffic_volunteer', slot: 'top', name: '文明劝导反光背心', tier: 0, price: 0, colorHex: '#e2f524', accentHex: '#eef4f8', description: '荧光黄高反光交通劝导背心，含双银反光条与志愿袖标（原创合规志愿样式）', defaultOwned: true},
  {id: 'bottom_traffic_duty', slot: 'bottom', name: '深蓝执勤长裤', tier: 0, price: 0, colorHex: '#1b2330', accentHex: '#dce6ee', description: '深蓝修身志愿劝导长裤，配简洁反光滚边', defaultOwned: true},
  {id: 'shoes_traffic_duty', slot: 'shoes', name: '黑色防滑执勤鞋', tier: 0, price: 0, colorHex: '#16191e', accentHex: '#2f3844', description: '轻量防滑全黑劝导执勤鞋', defaultOwned: true},
  {id: 'hat_traffic_cap', slot: 'hat', name: '桂林志愿劝导帽', tier: 0, price: 0, colorHex: '#1b2636', accentHex: '#e2f524', description: '深蓝荧光黄滚边交通劝导帽（原创合规志愿样式）', defaultOwned: true},
  {id: 'bag_traffic_flag', slot: 'bag', name: '劝导小黄旗腰包', tier: 0, price: 0, colorHex: '#1d2735', accentHex: '#f5d226', description: '志愿反光腰包与随身劝导小黄旗', defaultOwned: true},
] as const

export {starterOutfit}
export const DEFAULT_EQUIPPED_OUTFIT: Readonly<EquippedOutfit> = starterOutfit('basic')

export const DEFAULT_OWNED_OUTFIT_ITEMS: readonly string[] = OUTFIT_ITEMS
  .filter(item => item.defaultOwned)
  .map(item => item.id)

export const OUTFIT_PRESETS: readonly OutfitPresetDef[] = [
  ...looks.slice(1).map((look,i)=>({id:'starter_'+look,name:lookNames[i+1],tier:0 as const,price:0,
    summary:'免费初始穿搭',tag:'初始',items:starterOutfit(look),defaultOwned:true})),
  {
    id: 'outfit_default',
    name: '初见桂林常服',
    tier: 0,
    price: 0,
    summary: '米白长袖配黑色直筒裤和小白鞋。',
    tag: '默认',
    items: {...DEFAULT_EQUIPPED_OUTFIT},
    defaultOwned: true,
  },
  {
    id: 'outfit_guilin_hoodie',
    name: '烟雨街头卫衣套',
    tier: 1,
    price: 480,
    summary: '落肩卫衣 + 束脚工装裤 + 棒球帽，2~3 单稳买第一套。',
    tag: 'T1 · 街头',
    items: {
      top: 'top_guilin_hoodie',
      bottom: 'bottom_guilin_cargo',
      shoes: 'shoes_guilin_canvas',
      hat: 'hat_guilin_cap',
      bag: 'bag_none',
    },
  },
  {
    id: 'outfit_linen_summer',
    name: '漓岸亚麻度假套',
    tier: 1,
    price: 480,
    summary: '象牙亚麻衬衫配卡其裤与山水帆布袋，夏日清风穿搭。',
    tag: 'T1 · 度假',
    items: {
      top: 'top_linen_shirt',
      bottom: 'bottom_linen_shorts',
      shoes: 'shoes_linen_loafer',
      hat: 'hat_none',
      bag: 'bag_linen_tote',
    },
  },
  {
    id: 'outfit_rider_vest',
    name: '桂城快送骑手套',
    tier: 2,
    price: 960,
    summary: '桂花金反光马甲 + 半盔 + 快送挎包，跑单辨识度拉满。',
    tag: 'T2 · 骑手',
    items: {
      top: 'top_rider_vest',
      bottom: 'bottom_rider_pants',
      shoes: 'shoes_rider_boots',
      hat: 'hat_rider_helmet',
      bag: 'bag_rider_pack',
    },
  },
  {
    id: 'outfit_lijiang_shell',
    name: '漓江青机能冲锋套',
    tier: 2,
    price: 960,
    summary: '三防冲锋衣配硬壳机能胸包，桂林夜雨街头标配。',
    tag: 'T2 · 机能',
    items: {
      top: 'top_lijiang_shell',
      bottom: 'bottom_lijiang_tech',
      shoes: 'shoes_lijiang_trail',
      hat: 'hat_none',
      bag: 'bag_lijiang_sling',
    },
  },
  {
    id: 'outfit_guochao_pankou',
    name: '榕城国潮盘扣套',
    tier: 3,
    price: 1680,
    summary: '玄青盘扣立领夹克配鎏金织锦挎包，微笑堂镇店旗舰。',
    tag: 'T3 · 国潮',
    items: {
      top: 'top_guochao_pankou',
      bottom: 'bottom_guochao_drape',
      shoes: 'shoes_guochao_sneaker',
      hat: 'hat_none',
      bag: 'bag_guochao_satchel',
    },
  },
  {
    id: 'outfit_night_moto',
    name: '夜城反光骑行套',
    tier: 3,
    price: 1680,
    summary: '漓江青反光条骑行服 + 全覆光镜盔，十字街夜游旗舰。',
    tag: 'T3 · 夜骑',
    items: {
      top: 'top_night_moto',
      bottom: 'bottom_night_moto',
      shoes: 'shoes_night_moto',
      hat: 'hat_night_visor',
      bag: 'bag_none',
    },
  },
  {
    id: 'outfit_traffic_volunteer',
    name: '交通文明劝导志愿套',
    tier: 0,
    price: 0,
    summary: '荧光黄反光劝导背心配深蓝长袖与袖标（+0 Draw Call，原创合规志愿样式）。',
    tag: '志愿 · 劝导',
    items: {
      top: 'top_traffic_volunteer',
      bottom: 'bottom_traffic_duty',
      shoes: 'shoes_traffic_duty',
      hat: 'hat_none',
      bag: 'bag_none',
    },
    defaultOwned: true,
  },
] as const

export const DEFAULT_OWNED_OUTFIT_PRESETS: readonly string[] = OUTFIT_PRESETS.filter(p=>p.defaultOwned).map(p=>p.id)

export const PERSONAL_EBIKE_MODELS: Readonly<Record<PersonalEbikeModelId, PersonalEbikeModelDef>> = {
  lijiang_light: {
    modelId: 'lijiang_light',
    name: '漓江小轻骑',
    tierLabel: '1 档 · 入门通勤',
    badge: '小轻骑',
    price: 1800,
    summary: '轻巧稳健耐摔，钻东西巷与正阳街最顺手，5~8 单稳提首台个人电摩。',
    stockGearKmh: [16, 25, 36, 42],
    hardCapKmh: 50,
    capacityScale: 1.05,
    drainMul: 0.95,
    accelScale: 1.0,
    maxUpgrades: {motorLevel: 1, controllerLevel: 1, batteryLevel: 2},
    allowedVisuals: ['paint', 'windshield', 'topbox'],
    defaultVisual: {
      preset: 'stock',
      paintColor: 0x3b6f78,
      underglow: false,
      underglowColor: 0x20d6c1,
      angelEye: false,
      angelEyeColor: 0x6ce8ff,
      goldShock: false,
      tailWing: false,
      exhaust: false,
      windshield: 'none',
      topbox: 'none',
      headlightTier: 0,
    },
  },
  city_range: {
    modelId: 'city_range',
    name: '城心续航摩',
    tierLabel: '2 档 · 主力跑单',
    badge: '续航摩',
    price: 3600,
    summary: '1.45× 大容量电池 + 强夜灯 + 专属外卖箱位（降洒汤 25%），跑单神器。',
    deliverySoupBonus: 0.25,
    stockGearKmh: [16, 25, 38, 50],
    hardCapKmh: 60,
    capacityScale: 1.45,
    drainMul: 0.85,
    accelScale: 1.1,
    maxUpgrades: {motorLevel: 2, controllerLevel: 2, batteryLevel: 3},
    allowedVisuals: ['paint', 'neon', 'windshield', 'topbox', 'angelEye', 'goldShock', 'headlightTier'],
    defaultVisual: {
      preset: 'stock',
      paintColor: 0x25323d,
      underglow: false,
      underglowColor: 0x20d6c1,
      angelEye: false,
      angelEyeColor: 0xffc53d,
      goldShock: false,
      tailWing: false,
      exhaust: false,
      windshield: 'clear',
      topbox: 'commuter',
      headlightTier: 1,
    },
  },
  xiangshan_gt: {
    modelId: 'xiangshan_gt',
    name: '象山疾风电摩',
    tierLabel: '3 档 · 性能旗舰',
    badge: '疾风GT',
    price: 6800,
    summary: '高阶性能改装底盘，开放全部灯效与外观槽位，满改极速硬顶 70 km/h。',
    stockGearKmh: [18, 25, 42, 55],
    hardCapKmh: EBIKE_UPGRADE_MAX_KMH,
    capacityScale: 1.65,
    drainMul: 0.95,
    accelScale: 1.22,
    maxUpgrades: {motorLevel: 3, controllerLevel: 3, batteryLevel: 3},
    allowedVisuals: ['paint', 'neon', 'ghostfire', 'windshield', 'topbox', 'angelEye', 'goldShock', 'tailWing', 'exhaust', 'headlightTier'],
    defaultVisual: {
      preset: 'stock',
      paintColor: 0x1a1f26,
      underglow: false,
      underglowColor: 0x20d6c1,
      angelEye: true,
      angelEyeColor: 0x20d6c1,
      goldShock: false,
      tailWing: false,
      exhaust: false,
      windshield: 'tinted',
      topbox: 'none',
      headlightTier: 1,
    },
  },
} as const

export const PERSONAL_EBIKE_LIST: readonly PersonalEbikeModelDef[] = [
  PERSONAL_EBIKE_MODELS.lijiang_light,
  PERSONAL_EBIKE_MODELS.city_range,
  PERSONAL_EBIKE_MODELS.xiangshan_gt,
]

export const EBIKE_UPGRADE_CATALOG: readonly EbikeUpgradeCatalogEntry[] = [
  {id: 'motor:1', kind: 'motor', level: 1, name: '高扭轮毂电机 Lv1', price: 600, summary: '起步加速 +9%，S 挡极速 +4 km/h'},
  {id: 'motor:2', kind: 'motor', level: 2, name: '双磁钢直驱电机 Lv2', price: 1200, summary: '起步加速 +18%，S 挡极速 +8 km/h'},
  {id: 'motor:3', kind: 'motor', level: 3, name: '象山碳壳竞速电机 Lv3', price: 2200, summary: '起步加速 +27%，S 挡极速 +12 km/h（钳位 <=70）'},
  {id: 'controller:1', kind: 'controller', level: 1, name: '矢量电控调校 Lv1', price: 600, summary: '中段响应 +7%，S 挡极速 +5 km/h'},
  {id: 'controller:2', kind: 'controller', level: 2, name: '双核正弦波电控 Lv2', price: 1200, summary: '中段响应 +14%，S 挡极速 +10 km/h'},
  {id: 'controller:3', kind: 'controller', level: 3, name: '赛道全功率电控 Lv3', price: 2200, summary: '中段响应 +21%，S 挡极速 +15 km/h（钳位 <=70）'},
  {id: 'battery:1', kind: 'battery', level: 1, name: '长效锂电包 Lv1', price: 600, summary: '电池容量 +35%，能耗 -5%'},
  {id: 'battery:2', kind: 'battery', level: 2, name: '双仓高密锂电包 Lv2', price: 1200, summary: '电池容量 +70%，能耗 -10%'},
  {id: 'battery:3', kind: 'battery', level: 3, name: '桂城环线旗舰电芯 Lv3', price: 2200, summary: '电池容量 +105%，能耗 -15%'},
] as const

export const EBIKE_VISUAL_CATALOG: readonly EbikeVisualCatalogEntry[] = [
  {id: 'paint:lijiang_jade', category: 'paint', name: '漓江青涂装', price: 150, summary: '桂林山水青绿漆面', slotKey: 'paint', patch: {paintColor: 0x209c8e}},
  {id: 'paint:osmanthus_gold', category: 'paint', name: '桂花金涂装', price: 150, summary: '暖金哑光金属漆', slotKey: 'paint', patch: {paintColor: 0xd9a432}},
  {id: 'paint:obsidian_slate', category: 'paint', name: '柏油曜黑涂装', price: 150, summary: '深黑磨砂夜骑漆', slotKey: 'paint', patch: {paintColor: 0x1b2026}},
  {id: 'paint:cinnabar_red', category: 'paint', name: '朱砂红涂装', price: 150, summary: '原创朱砂赤红涂装', slotKey: 'paint', patch: {paintColor: 0xb84638}},
  {id: 'visual:windshield_clear', category: 'accessory', name: '透明加高风挡', price: 320, summary: '挡风防雨清晰视野', slotKey: 'windshield', patch: {windshield: 'clear'}},
  {id: 'visual:windshield_tinted', category: 'accessory', name: '熏黑竞速风挡', price: 320, summary: '低风阻熏黑前风挡', slotKey: 'windshield', patch: {windshield: 'tinted'}},
  {id: 'visual:topbox_commuter', category: 'accessory', name: '通勤硬壳尾箱', price: 450, summary: '实用储物快拆尾箱', slotKey: 'topbox', patch: {topbox: 'commuter'}},
  {id: 'visual:topbox_delivery', category: 'accessory', name: '恒温稳汤外卖箱', price: 450, summary: '减震保温箱，米粉外卖更稳', slotKey: 'topbox', patch: {topbox: 'delivery'}},
  {id: 'visual:neon', category: 'kit', name: '漓江青底盘霓虹', price: 380, summary: '夜间低功耗发光灯带（0 新增光源）', slotKey: 'neon', patch: {preset: 'neon', underglow: true, underglowColor: 0x20d6c1}},
  {id: 'visual:angel_eye', category: 'kit', name: '星环天使眼灯组', price: 260, summary: '高辨识环形日行灯', slotKey: 'angelEye', patch: {angelEye: true, angelEyeColor: 0xffc53d}},
  {id: 'visual:gold_shock', category: 'kit', name: '鎏金液压避震', price: 340, summary: '强化减震涂装件', slotKey: 'goldShock', patch: {goldShock: true}},
  {id: 'visual:tail_wing', category: 'kit', name: '碳纹定风尾翼', price: 280, summary: '高阶电摩运动尾翼', slotKey: 'tailWing', patch: {tailWing: true}},
  {id: 'visual:exhaust', category: 'kit', name: '双出装饰尾喉', price: 320, summary: '街头性能风外观套件', slotKey: 'exhaust', patch: {exhaust: true}},
  {id: 'visual:ghostfire', category: 'kit', name: '鬼火夜城全套外观', price: 520, summary: '全套夜骑灯效与镀金件', slotKey: 'ghostfire', patch: {preset: 'ghostfire', underglow: true, underglowColor: 0xffc53d, angelEye: true, goldShock: true, tailWing: true}},
  {id: 'visual:headlight_2', category: 'accessory', name: '双透镜远近光灯组', price: 420, summary: '夜间光束更亮更集中（0 新增光源）', slotKey: 'headlightTier', patch: {headlightTier: 2}},
] as const

export const EBIKE_SERVICE_CATALOG: Readonly<Record<EbikeServiceCatalogEntry['id'], EbikeServiceCatalogEntry>> = {
  slow_charge: {id: 'slow_charge', name: '免费慢充（至 80%）', fixedPrice: 0, summary: '公共慢充桩免费补电至 80%'},
  fast_charge: {id: 'fast_charge', name: '快捷快充（至 100%）', fixedPrice: 20, summary: '瞬间充满 100% 电量'},
  full_repair: {id: 'full_repair', name: '整车保养满修（耐久 100%）', fixedPrice: 80, summary: '修复车况并恢复 100% 耐久'},
  full_service: {id: 'full_service', name: '一键满电 + 满修', summary: '按缺电与缺损折算，最高不超过 ¥100'},
} as const

export const OUTFIT_ITEMS_BY_ID: Readonly<Record<string, OutfitItemDef>> = Object.fromEntries(
  OUTFIT_ITEMS.map(item => [item.id, item]),
)

export const OUTFIT_PRESETS_BY_ID: Readonly<Record<string, OutfitPresetDef>> = Object.fromEntries(
  OUTFIT_PRESETS.map(preset => [preset.id, preset]),
)

export const EBIKE_UPGRADES_BY_ID: Readonly<Record<string, EbikeUpgradeCatalogEntry>> = Object.fromEntries(
  EBIKE_UPGRADE_CATALOG.map(entry => [entry.id, entry]),
)

export const EBIKE_VISUALS_BY_ID: Readonly<Record<string, EbikeVisualCatalogEntry>> = Object.fromEntries(
  EBIKE_VISUAL_CATALOG.map(entry => [entry.id, entry]),
)

export function isPersonalEbikeModelId(value: unknown): value is PersonalEbikeModelId {
  return value === 'lijiang_light' || value === 'city_range' || value === 'xiangshan_gt'
}

function clampUpgradeLevel(v: unknown, max: 0 | 1 | 2 | 3): 0 | 1 | 2 | 3 {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0
  return Math.max(0, Math.min(max, n)) as 0 | 1 | 2 | 3
}

/** Clamps upgrade levels strictly to the model's ceiling (anti-tamper protection). */
export function clampPersonalUpgrades(
  modelId: PersonalEbikeModelId,
  raw?: Partial<PersistedEbikeUpgrades> | null,
): PersistedEbikeUpgrades {
  const cap = PERSONAL_EBIKE_MODELS[modelId].maxUpgrades
  return {
    motorLevel: clampUpgradeLevel(raw?.motorLevel, cap.motorLevel),
    controllerLevel: clampUpgradeLevel(raw?.controllerLevel, cap.controllerLevel),
    batteryLevel: clampUpgradeLevel(raw?.batteryLevel, cap.batteryLevel),
  }
}

export function createDefaultVisualForModel(modelId: PersonalEbikeModelId): PersistedEbikeVisual {
  return {...PERSONAL_EBIKE_MODELS[modelId].defaultVisual}
}

/**
 * Pure personal e-bike profile resolver (aligned with tuning.ts EBIKE_UPGRADE_MAX_KMH = 70).
 * Always double-clamps upgrades against model caps and enforces top speed <= min(modelHardCap, 70 km/h).
 */
export function resolvePersonalEbikeProfile(
  modelId: PersonalEbikeModelId,
  rawUpgrades?: Partial<PersistedEbikeUpgrades> | null,
): ResolvedEbikeProfile {
  const model = PERSONAL_EBIKE_MODELS[modelId]
  const upgrades = clampPersonalUpgrades(modelId, rawUpgrades)
  const [d1, d2, d3, sStock] = model.stockGearKmh
  const ceiling = Math.min(model.hardCapKmh, EBIKE_UPGRADE_MAX_KMH)
  const extraKmh = upgrades.motorLevel * 4 + upgrades.controllerLevel * 5
  const tierMaxKmh = Math.min(ceiling, sStock + extraKmh)
  const d3Extra = Math.max(0, tierMaxKmh - sStock) * 0.45
  const d3Max = Math.min(tierMaxKmh - 2, +(d3 + d3Extra).toFixed(1))

  const accelMul = model.accelScale * (1 + upgrades.motorLevel * 0.09 + upgrades.controllerLevel * 0.07)
  const capacityScale = model.capacityScale * (1 + upgrades.batteryLevel * 0.35)
  const drainMul = Math.max(0.55, model.drainMul * (1 + upgrades.motorLevel * 0.08 - upgrades.batteryLevel * 0.05))
  const upgraded = upgrades.motorLevel > 0 || upgrades.controllerLevel > 0 || upgrades.batteryLevel > 0

  const gears: EbikeGearProfile[] = [
    {id: 1, label: 'D1', hint: '经济', maxKmh: d1, accelScale: 0.56, launchTorque: 0.60, throttleExp: 1.40, leanScale: 0.72, wheelieGain: 0.26, uphillMul: 1.15, drainScale: 0.52},
    {id: 2, label: 'D2', hint: '合规', maxKmh: Math.min(d2, EBIKE_COMPLIANT_CAP_KMH), accelScale: 0.96, launchTorque: 0.94, throttleExp: 1.12, leanScale: 0.92, wheelieGain: 0.64, uphillMul: 1.00, drainScale: 0.90},
    {id: 3, label: 'D3', hint: '提速', maxKmh: d3Max, accelScale: 1.42, launchTorque: 1.38, throttleExp: 0.94, leanScale: 1.14, wheelieGain: 1.06, uphillMul: 0.86, drainScale: 1.65},
    {id: 4, label: 'S', hint: '运动', maxKmh: tierMaxKmh, accelScale: 1.86, launchTorque: 1.82, throttleExp: 0.78, leanScale: 1.32, wheelieGain: 1.46, uphillMul: 0.72, drainScale: 3.10},
  ]

  return {
    vehicleType: 'normal',
    tier: 'normal',
    isShared: false,
    tierLabel: model.name,
    badge: model.badge,
    stockMaxKmh: sStock,
    tierMaxKmh,
    compliantCapKmh: EBIKE_COMPLIANT_CAP_KMH,
    defaultGear: EBIKE_DEFAULT_GEAR,
    allowUpgrades: true,
    capacityScale,
    accelMul,
    drainMul,
    wheelieTorqueMul: 1 + upgrades.motorLevel * 0.10 + upgrades.controllerLevel * 0.08,
    gears,
    upgrades: {
      motorLevel: upgrades.motorLevel,
      controllerLevel: upgrades.controllerLevel,
      batteryLevel: upgrades.batteryLevel,
      topKmhBonus: 0,
      accelMul: model.accelScale,
      capacityScale: model.capacityScale,
      drainMul: model.drainMul,
    },
    upgraded,
  }
}

/**
 * Single source of truth service price calculator (integer yuan).
 * Aligned with IDOK-121 final ruling (fast_charge = ¥20, full_repair = ¥80, combined capped at ¥100).
 */
export function calcFullServiceCost(batteryPct: number, durabilityPct: number): number {
  const safeBat = Number.isFinite(batteryPct) ? Math.max(0, Math.min(100, batteryPct)) : 100
  const safeDur = Number.isFinite(durabilityPct) ? Math.max(0, Math.min(100, durabilityPct)) : 100
  const missingBat = Math.max(0, 100 - safeBat)
  const missingDur = Math.max(0, 100 - safeDur)
  if (missingBat < 0.5 && missingDur < 0.5) return 0
  const batCost = missingBat >= 0.5 ? Math.ceil((missingBat / 100) * 20) : 0
  const durCost = missingDur >= 0.5 ? Math.ceil((missingDur / 100) * 80) : 0
  return Math.max(5, Math.min(100, batCost + durCost))
}
