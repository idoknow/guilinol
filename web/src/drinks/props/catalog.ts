export const DRINK_IDS = [
  'lemonade',
  'passion_fruit',
  'mango_pomelo',
  'brown_sugar_boba',
  'four_seasons_milk',
  'grape_cheesefoam',
  'peach_oolong',
  'sundae_cone',
] as const

export type DrinkId = (typeof DRINK_IDS)[number]

export type DrinkSilhouetteKind = 'tall_clear' | 'medium_clear' | 'frosted_slender' | 'cheesefoam_sip' | 'sundae_bowl'

export type DrinkLidKind = 'heat_seal_red' | 'heat_seal_clear' | 'flip_cap_clear' | 'open_swirl'

export interface DrinkSpec {
  readonly id: DrinkId
  readonly name: string
  readonly category: 'fruit_tea' | 'milk_tea' | 'cheesefoam' | 'ice_cream'
  readonly cupMl: 340 | 500 | 700
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
  readonly hasSleeve: boolean
  readonly priceYuan: number
  readonly handGripYOffsetM: number
  readonly summary: string
}

export const DRINK_CATALOG: Readonly<Record<DrinkId, DrinkSpec>> = {
  lemonade: {
    id: 'lemonade',
    name: '冰鲜柠檬水',
    category: 'fruit_tea',
    cupMl: 700,
    silhouette: 'tall_clear',
    lid: 'heat_seal_red',
    cupHeightM: 0.168,
    topRadiusM: 0.043,
    bottomRadiusM: 0.031,
    liquidHex: '#f6ea7c',
    liquidSecondaryHex: '#fff5b8',
    liquidOpacity: 0.72,
    accentHex: '#ffd12b',
    strawHex: '#d9252e',
    strawRadiusM: 0.0042,
    hasSleeve: true,
    priceYuan: 4,
    handGripYOffsetM: -0.008,
    summary: '700ml 高透晶杯，双片厚切鲜黄柠檬与碎冰块，红白主题封口与条纹吸管',
  },
  passion_fruit: {
    id: 'passion_fruit',
    name: '满杯百香果',
    category: 'fruit_tea',
    cupMl: 700,
    silhouette: 'tall_clear',
    lid: 'heat_seal_red',
    cupHeightM: 0.168,
    topRadiusM: 0.043,
    bottomRadiusM: 0.031,
    liquidHex: '#f09418',
    liquidSecondaryHex: '#f7c43c',
    liquidOpacity: 0.78,
    accentHex: '#d45a12',
    strawHex: '#d9252e',
    strawRadiusM: 0.0056,
    hasSleeve: true,
    priceYuan: 7,
    handGripYOffsetM: -0.008,
    summary: '700ml 金橙百香果茶底，黑籽挂杯、椰果粒与黑糖珍珠沉底，搭配青柠片与粗吸管',
  },
  mango_pomelo: {
    id: 'mango_pomelo',
    name: '杨枝甘露',
    category: 'fruit_tea',
    cupMl: 500,
    silhouette: 'medium_clear',
    lid: 'heat_seal_red',
    cupHeightM: 0.148,
    topRadiusM: 0.042,
    bottomRadiusM: 0.031,
    liquidHex: '#f7b217',
    liquidSecondaryHex: '#fff2da',
    liquidOpacity: 0.9,
    accentHex: '#ef6e5f',
    strawHex: '#f2c12e',
    strawRadiusM: 0.006,
    hasSleeve: true,
    priceYuan: 8,
    handGripYOffsetM: -0.005,
    summary: '500ml 金黄芒果泥叠奶白椰浆中层，珊瑚西柚粒、芒果丁与晶莹西米分层可见',
  },
  brown_sugar_boba: {
    id: 'brown_sugar_boba',
    name: '黑糖珍珠奶茶',
    category: 'milk_tea',
    cupMl: 500,
    silhouette: 'medium_clear',
    lid: 'heat_seal_red',
    cupHeightM: 0.148,
    topRadiusM: 0.042,
    bottomRadiusM: 0.031,
    liquidHex: '#d6ab7c',
    liquidSecondaryHex: '#431d0b',
    liquidOpacity: 0.92,
    accentHex: '#2c160b',
    strawHex: '#2b1c17',
    strawRadiusM: 0.0062,
    hasSleeve: true,
    priceYuan: 7,
    handGripYOffsetM: -0.005,
    summary: '500ml 焦糖虎纹内壁挂酱，厚底亮黑木薯珍珠与奶沫顶层，粗黑吸管',
  },
  four_seasons_milk: {
    id: 'four_seasons_milk',
    name: '四季奶青',
    category: 'milk_tea',
    cupMl: 700,
    silhouette: 'frosted_slender',
    lid: 'heat_seal_red',
    cupHeightM: 0.166,
    topRadiusM: 0.041,
    bottomRadiusM: 0.029,
    liquidHex: '#e7d5b5',
    liquidSecondaryHex: '#2f8a73',
    liquidOpacity: 0.94,
    accentHex: '#2f8a73',
    strawHex: '#d9252e',
    strawRadiusM: 0.0044,
    hasSleeve: true,
    priceYuan: 6,
    handGripYOffsetM: -0.008,
    summary: '700ml 磨砂修长杯型，乌龙奶青淡金茶色叠青碧环带与杯底晶球椰果',
  },
  grape_cheesefoam: {
    id: 'grape_cheesefoam',
    name: '芝士葡萄',
    category: 'cheesefoam',
    cupMl: 700,
    silhouette: 'cheesefoam_sip',
    lid: 'flip_cap_clear',
    cupHeightM: 0.166,
    topRadiusM: 0.043,
    bottomRadiusM: 0.031,
    liquidHex: '#8d3694',
    liquidSecondaryHex: '#fff5e4',
    liquidOpacity: 0.86,
    accentHex: '#4c1752',
    strawHex: '#c84b9e',
    strawRadiusM: 0.0038,
    hasSleeve: true,
    priceYuan: 8,
    handGripYOffsetM: -0.008,
    summary: '700ml 三段渐变紫葡萄冰沙，底铺捣碎紫葡萄果肉与整颗果粒，顶封厚咸芝士奶盖与直饮掀盖',
  },
  peach_oolong: {
    id: 'peach_oolong',
    name: '桃桃乌龙',
    category: 'fruit_tea',
    cupMl: 500,
    silhouette: 'medium_clear',
    lid: 'heat_seal_clear',
    cupHeightM: 0.148,
    topRadiusM: 0.042,
    bottomRadiusM: 0.031,
    liquidHex: '#f6a7b3',
    liquidSecondaryHex: '#ffe3dc',
    liquidOpacity: 0.62,
    accentHex: '#ff7b91',
    strawHex: '#f27285',
    strawRadiusM: 0.0048,
    hasSleeve: true,
    priceYuan: 7,
    handGripYOffsetM: -0.005,
    summary: '500ml 粉绯白桃乌龙茶汤，沉底蜜桃冻块、白桃果丁与冰块，透明封口膜配珊瑚吸管',
  },
  sundae_cone: {
    id: 'sundae_cone',
    name: '摩天圣代',
    category: 'ice_cream',
    cupMl: 340,
    silhouette: 'sundae_bowl',
    lid: 'open_swirl',
    cupHeightM: 0.162,
    topRadiusM: 0.045,
    bottomRadiusM: 0.029,
    liquidHex: '#fff9ec',
    liquidSecondaryHex: '#4f2414',
    liquidOpacity: 0.98,
    accentHex: '#d9252e',
    strawHex: null,
    strawRadiusM: 0,
    hasSleeve: true,
    priceYuan: 6,
    handGripYOffsetM: -0.006,
    summary: '敞口阔沿圣代杯，巧克力与草莓酱流心底纹叠黑曲奇碎，三圈盘旋奶霜塔顶插脆皮卷与红小勺',
  },
}

/** 将 drinks/sim/menu.ts 或第三方菜单 SKU 映射为对应 3D 杯模 ID（零双向耦合） */
export const DRINK_SIM_SKU_ALIASES: Readonly<Record<string, DrinkId>> = {
  ice_lemon_water: 'lemonade',
  passion_fruit_cup: 'passion_fruit',
  mango_pomelo_sago: 'mango_pomelo',
  pearl_milk_tea: 'brown_sugar_boba',
  brown_sugar_milk: 'brown_sugar_boba',
  jasmine_milk_green: 'four_seasons_milk',
  iced_americano: 'four_seasons_milk',
  taro_grape_tea: 'grape_cheesefoam',
  shake_milkshake: 'peach_oolong',
  sundae_cup: 'sundae_cone',
}

export function resolveDrinkPropId(idOrSku: string): DrinkId | null {
  if (idOrSku in DRINK_CATALOG) return idOrSku as DrinkId
  return DRINK_SIM_SKU_ALIASES[idOrSku] ?? null
}
