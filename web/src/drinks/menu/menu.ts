import type { DrinkCategory, DrinkMenuItem, PrepStationKind } from '../sim/types.ts'

export type { DrinkCategory, DrinkMenuItem, PrepStationKind }

export type DrinkPriceStatus = '待核' | '已核'

export type DrinkIceLevel = '正常冰' | '少冰' | '去冰' | '热饮'
export type DrinkSugarLevel = '全糖' | '七分糖' | '五分糖' | '不额外加糖'

export interface DrinkCustomization {
  ice: DrinkIceLevel
  sugar: DrinkSugarLevel
}

export interface DrinkPrepStep {
  id: string
  label: string
  stationKind: PrepStationKind
  durationSec: number
  detail: string
}

export interface DrinkCatalogItem extends DrinkMenuItem {
  readonly priceStatus: DrinkPriceStatus
  readonly priceVerified: boolean
  readonly priceSource: string
  readonly durationSec: number
  readonly steps: readonly DrinkPrepStep[]
  readonly volumeMl: number
  readonly sipsCount: number
  readonly iceOptions: readonly DrinkIceLevel[]
  readonly sugarOptions: readonly DrinkSugarLevel[]
  readonly hasCreamCrown?: boolean
  readonly hasPearls?: boolean
}

export interface DrinksShopSkinConfig {
  readonly skinId: string
  readonly shopId: string
  readonly displayName: string
  readonly shortName: string
  readonly cupTag: string
  readonly brandMark: string
  readonly isOriginalSkin: true
}

/**
 * 原创皮肤配置（遵循 docs/style.md:109 & docs/plan-2.md:82：真商标与品牌资产不入仓，
 * 后续若获授权只需替换本皮肤配置而无需改动建筑/点单/手持代码）。
 */
export const DEFAULT_DRINKS_SKIN: DrinksShopSkinConfig = {
  skinId: 'wangcheng_tea_original',
  shopId: 'shop_wangcheng_drinks',
  displayName: '王城冰茶铺',
  shortName: '王城茶铺',
  cupTag: '王城鲜茶',
  brandMark: '茶',
  isOriginalSkin: true,
}

export const DRINK_CATEGORIES: readonly { id: 'all' | DrinkCategory; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'lemonade', label: '柠檬水' },
  { id: 'fruit_tea', label: '果茶' },
  { id: 'milk_tea', label: '奶茶' },
  { id: 'coffee', label: '咖啡' },
  { id: 'ice_cream', label: '冰淇淋' },
]

export const MAX_DRINK_ORDER_QUANTITY = 6

/**
 * 王城饮品店菜单目录（与 `drinks/sim/menu.ts` ID / 制作时长 / 配料 1:1 对齐）。
 * 所有价目均标注 `priceStatus: '待核'`，待 Gbot 实景核价回传后定稿。
 */
export const DRINKS_MENU: readonly DrinkCatalogItem[] = [
  {
    id: 'ice_lemon_water',
    name: '冰鲜柠檬水',
    category: 'lemonade',
    price: 4, // 待核：待 Gbot 核实王城店实价
    priceStatus: '待核',
    priceVerified: false,
    priceSource: '待核（Gbot 实景价目调研中）',
    prepSec: 2.2,
    durationSec: 2.2,
    stationKind: 'lemon_ice',
    cupColor: '#f6df6e',
    accentColor: '#ffffff',
    ingredients: { cup: 1, ice: 2, lemon: 2, syrup: 1 },
    volumeMl: 700,
    sipsCount: 5,
    iceOptions: ['正常冰', '少冰', '去冰'],
    sugarOptions: ['全糖', '七分糖', '五分糖'],
    steps: [
      { id: 'smash_lemon', label: '鲜柠檬切捣出汁', stationKind: 'lemon_ice', durationSec: 0.9, detail: '取鲜切柠檬片锤捣出汁入杯' },
      { id: 'ice_syrup', label: '加冰调糖浆补水', stationKind: 'lemon_ice', durationSec: 0.7, detail: '加入冰块、蔗糖浆与直饮冰水' },
      { id: 'shake_seal', label: '雪克摇匀加盖', stationKind: 'lemon_ice', durationSec: 0.6, detail: '摇匀封盖并插入粗吸管出杯' },
    ],
  },
  {
    id: 'passion_fruit_cup',
    name: '满杯百香果',
    category: 'fruit_tea',
    price: 7, // 待核：待 Gbot 核实王城店实价
    priceStatus: '待核',
    priceVerified: false,
    priceSource: '待核（Gbot 实景价目调研中）',
    prepSec: 3.1,
    durationSec: 3.1,
    stationKind: 'lemon_ice',
    cupColor: '#f5a638',
    accentColor: '#7a4518',
    ingredients: { cup: 1, ice: 2, fruit_pulp: 2, tea_base: 1, syrup: 1 },
    volumeMl: 700,
    sipsCount: 5,
    iceOptions: ['正常冰', '少冰', '去冰'],
    sugarOptions: ['全糖', '七分糖', '五分糖', '不额外加糖'],
    steps: [
      { id: 'scoop_pulp', label: '舀取百香果泥', stationKind: 'lemon_ice', durationSec: 1.0, detail: '杯底盛入鲜百香果果浆与果籽' },
      { id: 'pour_tea_ice', label: '注入绿茶汤加冰', stationKind: 'lemon_ice', durationSec: 1.2, detail: '加入冰块、蔗糖浆与茉莉茶底' },
      { id: 'shake_cap', label: '摇匀封杯贴标', stationKind: 'lemon_ice', durationSec: 0.9, detail: '快速摇匀后压盖出杯' },
    ],
  },
  {
    id: 'pearl_milk_tea',
    name: '珍珠奶茶',
    category: 'milk_tea',
    price: 7, // 待核：待 Gbot 核实王城店实价
    priceStatus: '待核',
    priceVerified: false,
    priceSource: '待核（Gbot 实景价目调研中）',
    prepSec: 3.2,
    durationSec: 3.2,
    stationKind: 'tea_shake',
    cupColor: '#d9b589',
    accentColor: '#3a271c',
    ingredients: { cup: 1, ice: 1, tea_base: 2, milk: 2, pearls: 2, syrup: 1 },
    volumeMl: 500,
    sipsCount: 5,
    hasPearls: true,
    iceOptions: ['正常冰', '少冰', '去冰', '热饮'],
    sugarOptions: ['全糖', '七分糖', '五分糖', '不额外加糖'],
    steps: [
      { id: 'scoop_pearls', label: '盛入黑糖珍珠', stationKind: 'tea_shake', durationSec: 0.9, detail: '杯底舀入两勺温热琥珀珍珠' },
      { id: 'blend_milk_tea', label: '冲调红茶与牛乳', stationKind: 'tea_shake', durationSec: 1.4, detail: '热红茶底混合冷藏牛乳与糖浆' },
      { id: 'seal_cup', label: '封膜贴标出杯', stationKind: 'tea_shake', durationSec: 0.9, detail: '热压封膜配粗吸管放取餐台' },
    ],
  },
  {
    id: 'jasmine_milk_green',
    name: '茉莉奶绿',
    category: 'milk_tea',
    price: 6, // 待核：待 Gbot 核实王城店实价
    priceStatus: '待核',
    priceVerified: false,
    priceSource: '待核（Gbot 实景价目调研中）',
    prepSec: 2.8,
    durationSec: 2.8,
    stationKind: 'tea_shake',
    cupColor: '#e9e4c7',
    accentColor: '#8ba870',
    ingredients: { cup: 1, ice: 1, tea_base: 2, milk: 1, syrup: 1 },
    volumeMl: 500,
    sipsCount: 5,
    iceOptions: ['正常冰', '少冰', '去冰', '热饮'],
    sugarOptions: ['全糖', '七分糖', '五分糖', '不额外加糖'],
    steps: [
      { id: 'brew_jasmine', label: '量取茉莉绿茶底', stationKind: 'tea_shake', durationSec: 1.0, detail: '量杯注入现萃茉莉绿茶汤' },
      { id: 'mix_milk', label: '融奶加冰摇匀', stationKind: 'tea_shake', durationSec: 1.1, detail: '加入牛乳与风味糖浆摇匀挂壁' },
      { id: 'seal_cup', label: '封膜出杯', stationKind: 'tea_shake', durationSec: 0.7, detail: '封膜贴取餐号放叫号台' },
    ],
  },
  {
    id: 'taro_grape_tea',
    name: '芋圆葡萄',
    category: 'fruit_tea',
    price: 8, // 待核：待 Gbot 核实王城店实价
    priceStatus: '待核',
    priceVerified: false,
    priceSource: '待核（Gbot 实景价目调研中）',
    prepSec: 3.8,
    durationSec: 3.8,
    stationKind: 'tea_shake',
    cupColor: '#9f75b5',
    accentColor: '#efe6f5',
    ingredients: { cup: 1, ice: 2, fruit_pulp: 2, tea_base: 1, pearls: 1, syrup: 1 },
    volumeMl: 700,
    sipsCount: 5,
    hasPearls: true,
    iceOptions: ['正常冰', '少冰', '去冰'],
    sugarOptions: ['全糖', '七分糖', '五分糖'],
    steps: [
      { id: 'taro_base', label: '铺底芋圆与果肉', stationKind: 'tea_shake', durationSec: 1.2, detail: '盛入软糯小芋圆与巨峰葡萄果肉' },
      { id: 'grape_slush', label: '注入葡萄茶冰沙', stationKind: 'tea_shake', durationSec: 1.7, detail: '混合葡萄果泥、冰块与绿茶汤' },
      { id: 'cap_straw', label: '加盖配粗吸管', stationKind: 'tea_shake', durationSec: 0.9, detail: '压紧杯盖贴单并叫号' },
    ],
  },
  {
    id: 'mango_pomelo_sago',
    name: '杨枝甘露',
    category: 'fruit_tea',
    price: 9, // 待核：待 Gbot 核实王城店实价
    priceStatus: '待核',
    priceVerified: false,
    priceSource: '待核（Gbot 实景价目调研中）',
    prepSec: 4.0,
    durationSec: 4.0,
    stationKind: 'cream_top',
    cupColor: '#f7c844',
    accentColor: '#f3f1e9',
    ingredients: { cup: 1, ice: 1, fruit_pulp: 3, milk: 2, syrup: 1 },
    volumeMl: 500,
    sipsCount: 5,
    hasPearls: true,
    iceOptions: ['正常冰', '少冰', '去冰'],
    sugarOptions: ['全糖', '七分糖', '五分糖'],
    steps: [
      { id: 'mango_sago_base', label: '装入西米柚粒', stationKind: 'cream_top', durationSec: 1.2, detail: '杯底铺满晶莹西米与红柚果粒' },
      { id: 'mango_coconut', label: '浇入芒果椰奶浆', stationKind: 'cream_top', durationSec: 1.8, detail: '注入浓芒果浆与冰镇椰乳底' },
      { id: 'finish_seal', label: '顶层点缀封盖', stationKind: 'cream_top', durationSec: 1.0, detail: '补放芒果丁后封盖出杯' },
    ],
  },
  {
    id: 'shake_milkshake',
    name: '草莓摇摇奶昔',
    category: 'ice_cream',
    price: 6, // 待核：待 Gbot 核实王城店实价
    priceStatus: '待核',
    priceVerified: false,
    priceSource: '待核（Gbot 实景价目调研中）',
    prepSec: 3.0,
    durationSec: 3.0,
    stationKind: 'cream_top',
    cupColor: '#f29ea9',
    accentColor: '#fff7f5',
    ingredients: { cup: 1, ice: 1, ice_cream: 2, tea_base: 1, fruit_pulp: 1 },
    volumeMl: 500,
    sipsCount: 4,
    hasCreamCrown: true,
    iceOptions: ['正常冰', '少冰'],
    sugarOptions: ['全糖', '七分糖'],
    steps: [
      { id: 'strawberry_jam', label: '草莓果酱挂壁', stationKind: 'cream_top', durationSec: 0.9, detail: '杯内侧转圈涂抹草莓果酱' },
      { id: 'soft_serve_tea', label: '打入奶浆与茶底', stationKind: 'cream_top', durationSec: 1.3, detail: '冰淇淋机打入奶昔基液并配红茶' },
      { id: 'shake_dome', label: '封半球盖出杯', stationKind: 'cream_top', durationSec: 0.8, detail: '扣合半球顶盖贴单放取餐台' },
    ],
  },
  {
    id: 'sundae_cup',
    name: '黑糖珍珠圣代',
    category: 'ice_cream',
    price: 6, // 待核：待 Gbot 核实王城店实价
    priceStatus: '待核',
    priceVerified: false,
    priceSource: '待核（Gbot 实景价目调研中）',
    prepSec: 2.6,
    durationSec: 2.6,
    stationKind: 'cream_top',
    cupColor: '#f8f2e4',
    accentColor: '#4c2c1c',
    ingredients: { cup: 1, ice_cream: 3, pearls: 1, syrup: 1 },
    volumeMl: 280,
    sipsCount: 4,
    hasCreamCrown: true,
    hasPearls: true,
    iceOptions: ['正常冰'],
    sugarOptions: ['全糖'],
    steps: [
      { id: 'swirl_cream', label: '螺旋打入圣代', stationKind: 'cream_top', durationSec: 1.2, detail: '从冰淇淋机口螺旋挤满圣代杯' },
      { id: 'top_pearls_syrup', label: '淋黑糖挂珍珠', stationKind: 'cream_top', durationSec: 0.8, detail: '顶层浇浓稠黑糖浆与温热珍珠' },
      { id: 'serve_spoon', label: '插匙加盖出杯', stationKind: 'cream_top', durationSec: 0.6, detail: '加高顶盖并配小勺放取餐台' },
    ],
  },
  {
    id: 'iced_americano',
    name: '冰美式咖啡',
    category: 'coffee',
    price: 5, // 待核：待 Gbot 核实王城店实价
    priceStatus: '待核',
    priceVerified: false,
    priceSource: '待核（Gbot 实景价目调研中）',
    prepSec: 2.5,
    durationSec: 2.5,
    stationKind: 'tea_shake',
    cupColor: '#422c1d',
    accentColor: '#f0ece6',
    ingredients: { cup: 1, ice: 2, coffee: 2 },
    volumeMl: 450,
    sipsCount: 5,
    iceOptions: ['正常冰', '少冰', '热饮'],
    sugarOptions: ['不额外加糖', '五分糖'],
    steps: [
      { id: 'pull_espresso', label: '双份意式萃取', stationKind: 'tea_shake', durationSec: 1.2, detail: '现磨萃取两份浓缩咖啡液' },
      { id: 'pour_over_ice', label: '冷水满冰融合', stationKind: 'tea_shake', durationSec: 0.8, detail: '纯水加冰块倒入热浓缩形成分层' },
      { id: 'cap_cup', label: '压直饮盖出杯', stationKind: 'tea_shake', durationSec: 0.5, detail: '压紧咖啡直饮盖叫号取餐' },
    ],
  },
  {
    id: 'brown_sugar_milk',
    name: '黑糖波波牛乳',
    category: 'milk_tea',
    price: 8, // 待核：待 Gbot 核实王城店实价
    priceStatus: '待核',
    priceVerified: false,
    priceSource: '待核（Gbot 实景价目调研中）',
    prepSec: 3.4,
    durationSec: 3.4,
    stationKind: 'cream_top',
    cupColor: '#ede0cc',
    accentColor: '#5c3118',
    ingredients: { cup: 1, ice: 1, milk: 2, pearls: 2, syrup: 2 },
    hot: true,
    volumeMl: 500,
    sipsCount: 5,
    hasPearls: true,
    iceOptions: ['热饮', '少冰', '正常冰'],
    sugarOptions: ['全糖', '七分糖', '五分糖'],
    steps: [
      { id: 'wall_syrup', label: '黑糖挂壁铺波波', stationKind: 'cream_top', durationSec: 1.1, detail: '热黑糖波波舀入杯底旋转挂虎纹' },
      { id: 'steam_milk', label: '注入醇香鲜牛乳', stationKind: 'cream_top', durationSec: 1.5, detail: '缓缓倒入加热或冰镇鲜牛乳' },
      { id: 'cap_tag', label: '加防烫杯套出杯', stationKind: 'cream_top', durationSec: 0.8, detail: '压盖套防烫杯套贴单叫号' },
    ],
  },
]

export const DRINKS_MENU_BY_ID: Readonly<Record<string, DrinkCatalogItem>> = Object.fromEntries(
  DRINKS_MENU.map(item => [item.id, item]),
)

export function getDrinkById(id: string): DrinkCatalogItem | undefined {
  return DRINKS_MENU_BY_ID[id]
}

export function listDrinksByCategory(category: 'all' | DrinkCategory = 'all'): readonly DrinkCatalogItem[] {
  if (category === 'all') return DRINKS_MENU
  return DRINKS_MENU.filter(item => item.category === category)
}

export function normalizeDrinkQuantity(quantity = 1): number | null {
  if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity)) return null
  if (quantity < 1 || quantity > MAX_DRINK_ORDER_QUANTITY) return null
  return quantity
}

export function quoteDrinkTotal(itemId: string, quantity = 1): number | null {
  const item = DRINKS_MENU_BY_ID[itemId]
  const qty = normalizeDrinkQuantity(quantity)
  if (!item || qty === null) return null
  return item.price * qty
}

export function defaultDrinkCustomization(item: Pick<DrinkCatalogItem, 'iceOptions' | 'sugarOptions'>): DrinkCustomization {
  return {
    ice: item.iceOptions[0] ?? '正常冰',
    sugar: item.sugarOptions[0] ?? '全糖',
  }
}

export function formatDrinkDuration(durationSec: number): string {
  const safe = Math.max(0, Number.isFinite(durationSec) ? durationSec : 0)
  return safe >= 10 ? `${Math.round(safe)}s` : `${safe.toFixed(1).replace(/\.0$/, '')}s`
}
