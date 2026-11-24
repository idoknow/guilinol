import type { DrinkCategory, PrepStationKind } from '../sim/types.ts'

export const DRINK_IDS = [
  'ice_lemon_water',
  'passion_fruit_cup',
  'pearl_milk_tea',
  'jasmine_milk_green',
  'taro_grape_tea',
  'mango_pomelo_sago',
  'shake_milkshake',
  'sundae_cup',
  'iced_americano',
  'brown_sugar_milk',
] as const

export type DrinkId = (typeof DRINK_IDS)[number]

export type DrinkSilhouetteKind =
  | 'tall_clear'
  | 'medium_clear'
  | 'frosted_slender'
  | 'cheesefoam_sip'
  | 'milkshake_dome'
  | 'sundae_bowl'
  | 'coffee_tumbler'
  | 'corrugated_hot'

export type DrinkLidKind =
  | 'heat_seal_red'
  | 'heat_seal_clear'
  | 'flip_cap_clear'
  | 'hemisphere_dome'
  | 'coffee_sip_lid'
  | 'hot_sip_lid'
  | 'open_swirl'

export interface DrinkSpec {
  readonly id: DrinkId
  readonly name: string
  readonly category: DrinkCategory
  readonly stationKind: PrepStationKind
  readonly cupMl: 280 | 450 | 500 | 700
  readonly silhouette: DrinkSilhouetteKind
  readonly lid: DrinkLidKind
  readonly cupHeightM: number
  readonly topRadiusM: number
  readonly bottomRadiusM: number
  readonly liquidHex: string
  readonly liquidSecondaryHex: string
  readonly liquidOpacity: number
  readonly accentHex: string
  readonly strawHex: string | null
  readonly strawRadiusM: number
  readonly sleeveTheme: 'house' | 'coffee' | 'hot_kraft' | 'jasmine_jade'
  readonly priceYuan: number
  readonly handGripYOffsetM: number
  readonly summary: string
}

export const DRINK_CATALOG: Readonly<Record<DrinkId, DrinkSpec>> = {
  ice_lemon_water: {
    id: 'ice_lemon_water',
    name: '冰鲜柠檬水',
    category: 'lemonade',
    stationKind: 'lemon_ice',
    cupMl: 700,
    silhouette: 'tall_clear',
    lid: 'heat_seal_red',
    cupHeightM: 0.168,
    topRadiusM: 0.044,
    bottomRadiusM: 0.036,
    liquidHex: '#f8ec78',
    liquidSecondaryHex: '#fff5b8',
    liquidOpacity: 0.62,
    accentHex: '#ebba00',
    strawHex: '#d9252e',
    strawRadiusM: 0.0042,
    sleeveTheme: 'house',
    priceYuan: 4,
    handGripYOffsetM: -0.008,
    summary: '700ml 宽底胖墩冰柠晶杯，双片鲜黄厚柠檬片与剔透冰块，红色热封膜配红吸管',
  },
  passion_fruit_cup: {
    id: 'passion_fruit_cup',
    name: '满杯百香果',
    category: 'fruit_tea',
    stationKind: 'lemon_ice',
    cupMl: 700,
    silhouette: 'tall_clear',
    lid: 'flip_cap_clear',
    cupHeightM: 0.172,
    topRadiusM: 0.042,
    bottomRadiusM: 0.0285,
    liquidHex: '#f5951d',
    liquidSecondaryHex: '#f7c84c',
    liquidOpacity: 0.72,
    accentHex: '#59a92c',
    strawHex: '#ff771c',
    strawRadiusM: 0.0056,
    sleeveTheme: 'house',
    priceYuan: 7,
    handGripYOffsetM: -0.008,
    summary: '700ml 窄底收腰高透百香果杯，黑籽挂壁、珍珠椰果沉底配青柠角、透明拱盖与橙粗吸管',
  },
  pearl_milk_tea: {
    id: 'pearl_milk_tea',
    name: '珍珠奶茶',
    category: 'milk_tea',
    stationKind: 'tea_shake',
    cupMl: 500,
    silhouette: 'medium_clear',
    lid: 'heat_seal_red',
    cupHeightM: 0.148,
    topRadiusM: 0.042,
    bottomRadiusM: 0.031,
    liquidHex: '#d9b589',
    liquidSecondaryHex: '#fff4e4',
    liquidOpacity: 0.9,
    accentHex: '#3a271c',
    strawHex: '#2b1c17',
    strawRadiusM: 0.0062,
    sleeveTheme: 'house',
    priceYuan: 6,
    handGripYOffsetM: -0.005,
    summary: '500ml 醇香烤红茶奶茶，杯底净铺乌亮黑糖珍珠（通透可视）与奶沫顶层配粗黑吸管',
  },
  jasmine_milk_green: {
    id: 'jasmine_milk_green',
    name: '茉莉奶绿',
    category: 'milk_tea',
    stationKind: 'tea_shake',
    cupMl: 500,
    silhouette: 'frosted_slender',
    lid: 'heat_seal_clear',
    cupHeightM: 0.16,
    topRadiusM: 0.037,
    bottomRadiusM: 0.026,
    liquidHex: '#e7e2c1',
    liquidSecondaryHex: '#8ba870',
    liquidOpacity: 0.94,
    accentHex: '#6c9c56',
    strawHex: '#4f8f47',
    strawRadiusM: 0.004,
    sleeveTheme: 'jasmine_jade',
    priceYuan: 6,
    handGripYOffsetM: -0.006,
    summary: '500ml 修长磨砂细腰杯型，淡青茉莉茶乳配鼠尾草绿杯套、白茉莉花瓣点缀与细绿吸管',
  },
  taro_grape_tea: {
    id: 'taro_grape_tea',
    name: '芋圆葡萄',
    category: 'fruit_tea',
    stationKind: 'tea_shake',
    cupMl: 700,
    silhouette: 'cheesefoam_sip',
    lid: 'flip_cap_clear',
    cupHeightM: 0.166,
    topRadiusM: 0.043,
    bottomRadiusM: 0.031,
    liquidHex: '#9358ad',
    liquidSecondaryHex: '#4f1b58',
    liquidOpacity: 0.84,
    accentHex: '#efe6f5',
    strawHex: '#a552bd',
    strawRadiusM: 0.0058,
    sleeveTheme: 'house',
    priceYuan: 8,
    handGripYOffsetM: -0.008,
    summary: '700ml 巨峰葡萄果泥底叠双色金紫芋圆球、整颗果粒、厚奶盖配直饮掀扣盖',
  },
  mango_pomelo_sago: {
    id: 'mango_pomelo_sago',
    name: '杨枝甘露',
    category: 'fruit_tea',
    stationKind: 'cream_top',
    cupMl: 500,
    silhouette: 'medium_clear',
    lid: 'heat_seal_red',
    cupHeightM: 0.148,
    topRadiusM: 0.042,
    bottomRadiusM: 0.031,
    liquidHex: '#f7b217',
    liquidSecondaryHex: '#fffbf0',
    liquidOpacity: 0.9,
    accentHex: '#ff5244',
    strawHex: '#f2c12e',
    strawRadiusM: 0.006,
    sleeveTheme: 'house',
    priceYuan: 10,
    handGripYOffsetM: -0.005,
    summary: '500ml 鲜芒底叠外围乳白厚椰奶环，杯底西米露，顶部鲜橙芒果丁配红柚粒与亮黄粗吸管',
  },
  shake_milkshake: {
    id: 'shake_milkshake',
    name: '草莓摇摇奶昔',
    category: 'ice_cream',
    stationKind: 'cream_top',
    cupMl: 500,
    silhouette: 'milkshake_dome',
    lid: 'hemisphere_dome',
    cupHeightM: 0.144,
    topRadiusM: 0.042,
    bottomRadiusM: 0.031,
    liquidHex: '#f5a8b6',
    liquidSecondaryHex: '#d62845',
    liquidOpacity: 0.9,
    accentHex: '#fff7f5',
    strawHex: '#ff597a',
    strawRadiusM: 0.0048,
    sleeveTheme: 'house',
    priceYuan: 6,
    handGripYOffsetM: -0.005,
    summary: '500ml 草莓果酱流心挂壁奶昔杯，配透明高半球顶盖、顶内草莓奶油螺旋花与粉红吸管',
  },
  sundae_cup: {
    id: 'sundae_cup',
    name: '黑糖珍珠圣代',
    category: 'ice_cream',
    stationKind: 'cream_top',
    cupMl: 280,
    silhouette: 'sundae_bowl',
    lid: 'open_swirl',
    cupHeightM: 0.118,
    topRadiusM: 0.045,
    bottomRadiusM: 0.03,
    liquidHex: '#f8f2e4',
    liquidSecondaryHex: '#4c2212',
    liquidOpacity: 0.98,
    accentHex: '#d9252e',
    strawHex: null,
    strawRadiusM: 0,
    sleeveTheme: 'house',
    priceYuan: 6,
    handGripYOffsetM: -0.002,
    summary: '280ml 敞口阔沿圣代碗杯，三层高耸盘旋奶霜塔顶挂黑糖流心与乌亮珍珠，斜插红小勺',
  },
  iced_americano: {
    id: 'iced_americano',
    name: '冰美式咖啡',
    category: 'coffee',
    stationKind: 'tea_shake',
    cupMl: 450,
    silhouette: 'coffee_tumbler',
    lid: 'coffee_sip_lid',
    cupHeightM: 0.144,
    topRadiusM: 0.041,
    bottomRadiusM: 0.03,
    liquidHex: '#3f2617',
    liquidSecondaryHex: '#b98b5b',
    liquidOpacity: 0.84,
    accentHex: '#1f1b19',
    strawHex: null,
    strawRadiusM: 0,
    sleeveTheme: 'coffee',
    priceYuan: 5,
    handGripYOffsetM: -0.004,
    summary: '450ml 分层冰美式透明杯，冷萃冰块、深棕咖啡套与哑光黑直饮咖啡口杯盖（无吸管）',
  },
  brown_sugar_milk: {
    id: 'brown_sugar_milk',
    name: '黑糖波波牛乳',
    category: 'milk_tea',
    stationKind: 'cream_top',
    cupMl: 500,
    silhouette: 'corrugated_hot',
    lid: 'hot_sip_lid',
    cupHeightM: 0.148,
    topRadiusM: 0.042,
    bottomRadiusM: 0.031,
    liquidHex: '#f1e5d2',
    liquidSecondaryHex: '#4a210d',
    liquidOpacity: 0.98,
    accentHex: '#d9252e',
    strawHex: null,
    strawRadiusM: 0,
    sleeveTheme: 'hot_kraft',
    priceYuan: 8,
    handGripYOffsetM: -0.005,
    summary: '500ml 防烫瓦楞隔热热饮杯，黑糖虎纹露沿、厚波波底层配奶油白防烫盖与红防漏塞棒',
  },
}
