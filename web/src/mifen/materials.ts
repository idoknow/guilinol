import * as THREE from 'three'
import {shareAtmosphere} from '../look/atmosphere'
import {nightLit} from '../look/night'
import {atmo} from '../look/time'
import rawRecipes from './recipes.json'
import type {MifenRecipesData} from './types'

/**
 * 田源米粉（三多路店）材质与程序化贴图。
 *
 * 取色与做法以 docs/tianyuan-mifen-art-bible.md 为准（三多路转角店实拍）：
 * 杉木竖条门楣 + 黄色发光立体字、灰筒瓦披檐、楼上奶白老居民楼与绿板铁花阳台；
 * 室内米黄大理石纹瓷砖、白铝扣板吊顶、白石英台面、拉丝不锈钢明档、深棕金字木匾。
 *
 * 约定：
 * - 平铺类材质 `userData.tiled = true`，几何 UV 以米为单位，贴图 repeat = 1 / 图案周期（米）。
 * - 零动态灯光。招牌类材质名以 `_signs` 结尾，夜间由 look/night.ts 的 nightLit 按 uNight 自发光；
 *   室内面在 updateNight() 里按夜间程度抬 emissive，模拟日光灯照明。
 * - 价目与菜牌直接读 recipes.json，价格只有一个来源。
 */

const recipes = rawRecipes as unknown as MifenRecipesData

const SANS = '"PingFang SC","Noto Sans CJK SC","Source Han Sans SC","Microsoft YaHei",sans-serif'
const SERIF = '"Songti SC","Noto Serif SC","Source Han Serif SC","STSong","SimSun",serif'
const BRUSH = '"STKaiti","Kaiti SC","KaiTi","BiauKai","Songti SC","Noto Serif SC","STSong",serif'

export interface TianyuanMaterialPack {
  // 建筑壳体
  facadeWood: THREE.MeshStandardMaterial
  soffitWood: THREE.MeshStandardMaterial
  fasciaLetters: THREE.MeshStandardMaterial
  roofTile: THREE.MeshStandardMaterial
  residentialWall: THREE.MeshStandardMaterial
  residentialWindows: THREE.MeshStandardMaterial
  balconyGrille: THREE.MeshStandardMaterial
  slabEdge: THREE.MeshStandardMaterial
  roofDeck: THREE.MeshStandardMaterial
  granite: THREE.MeshStandardMaterial
  pavement: THREE.MeshStandardMaterial
  storefrontGlass: THREE.MeshStandardMaterial
  glassClear: THREE.MeshStandardMaterial
  aluminium: THREE.MeshStandardMaterial
  acUnit: THREE.MeshStandardMaterial

  // 室内装修
  wallTileHall: THREE.MeshStandardMaterial
  wallTileKitchen: THREE.MeshStandardMaterial
  floorHall: THREE.MeshStandardMaterial
  floorKitchen: THREE.MeshStandardMaterial
  ceiling: THREE.MeshStandardMaterial
  ceilingLamp: THREE.MeshStandardMaterial
  downlight: THREE.MeshStandardMaterial
  woodCladding: THREE.MeshStandardMaterial
  quartzTop: THREE.MeshStandardMaterial
  stainless: THREE.MeshStandardMaterial
  stainlessDark: THREE.MeshStandardMaterial
  darkWood: THREE.MeshStandardMaterial
  tableWood: THREE.MeshStandardMaterial
  blackMetal: THREE.MeshStandardMaterial
  doorCurtain: THREE.MeshStandardMaterial
  thermalCurtain: THREE.MeshStandardMaterial

  // 牌匾、菜牌与标识
  interiorPlaque: THREE.MeshStandardMaterial
  priceBoard: THREE.MeshStandardMaterial
  priceLightbox: THREE.MeshStandardMaterial
  menuPosters: THREE.MeshStandardMaterial
  menuScreen: THREE.MeshStandardMaterial
  supervisionBoard: THREE.MeshStandardMaterial
  mustEatPlaque: THREE.MeshStandardMaterial
  certificate: THREE.MeshStandardMaterial
  cashierSign: THREE.MeshStandardMaterial
  toppingsSign: THREE.MeshStandardMaterial
  kitchenDoorSign: THREE.MeshStandardMaterial
  glassWarning: THREE.MeshStandardMaterial
  stepWarning: THREE.MeshStandardMaterial
  streetPlate: THREE.MeshStandardMaterial
  fridgeFront: THREE.MeshStandardMaterial
  fridgeBody: THREE.MeshStandardMaterial
  wallClock: THREE.MeshStandardMaterial
  blueprint: THREE.MeshStandardMaterial

  // 道具
  choppingBlock: THREE.MeshStandardMaterial
  ticketPink: THREE.MeshStandardMaterial
  ticketBlue: THREE.MeshStandardMaterial
  ticketWhite: THREE.MeshStandardMaterial
  clipboard: THREE.MeshStandardMaterial
  stoolWood: THREE.MeshStandardMaterial
  stoolRed: THREE.MeshStandardMaterial
  stoolBlue: THREE.MeshStandardMaterial
  crateBlue: THREE.MeshStandardMaterial
  crateGreen: THREE.MeshStandardMaterial
  whitePlastic: THREE.MeshStandardMaterial
  rubber: THREE.MeshStandardMaterial
  scooterShell: THREE.MeshStandardMaterial
  scooterPlate: THREE.MeshStandardMaterial
  plantLeaf: THREE.MeshStandardMaterial
  lanternRed: THREE.MeshStandardMaterial
  gasFlame: THREE.MeshStandardMaterial
  cookingOil: THREE.MeshStandardMaterial

  // 食材与汤卤
  noodle: THREE.MeshStandardMaterial
  guoshao: THREE.MeshStandardMaterial
  beef: THREE.MeshStandardMaterial
  charsiu: THREE.MeshStandardMaterial
  braisedEgg: THREE.MeshStandardMaterial
  youtiao: THREE.MeshStandardMaterial
  brine: THREE.MeshStandardMaterial
  boneBroth: THREE.MeshStandardMaterial
  boilingWater: THREE.MeshStandardMaterial
  /** 自助小料，按 recipes.json condiments 顺序（实拍小料台 7 盆） */
  condiments: THREE.MeshStandardMaterial[]

  steam: THREE.PointsMaterial

  /** 夜间程度 0..1、是否大火烫粉、累计时间（秒） */
  updateNight(night: number, boiling?: boolean, time?: number): void
  dispose(): void
}

const MAX_METALNESS = 0.3

const TEX = {
  woodCedarAlbedo: new URL('../../public/mifen/textures/wood-cedar-albedo.png', import.meta.url).href,
  woodCedarNormal: new URL('../../public/mifen/textures/wood-cedar-normal.png', import.meta.url).href,
  woodCedarRoughness: new URL('../../public/mifen/textures/wood-cedar-roughness.png', import.meta.url).href,
  woodDarkAlbedo: new URL('../../public/mifen/textures/wood-dark-albedo.png', import.meta.url).href,
  woodDarkNormal: new URL('../../public/mifen/textures/wood-dark-normal.png', import.meta.url).href,
  woodDarkRoughness: new URL('../../public/mifen/textures/wood-dark-roughness.png', import.meta.url).href,
  woodTableAlbedo: new URL('../../public/mifen/textures/wood-table-albedo.png', import.meta.url).href,
  woodTableNormal: new URL('../../public/mifen/textures/wood-table-normal.png', import.meta.url).href,
  woodTableRoughness: new URL('../../public/mifen/textures/wood-table-roughness.png', import.meta.url).href,
  tileHallWallAlbedo: new URL('../../public/mifen/textures/tile-hall-wall-albedo.png', import.meta.url).href,
  tileHallWallNormal: new URL('../../public/mifen/textures/tile-hall-wall-normal.png', import.meta.url).href,
  tileHallWallRoughness: new URL('../../public/mifen/textures/tile-hall-wall-roughness.png', import.meta.url).href,
  tileKitchenWallAlbedo: new URL('../../public/mifen/textures/tile-kitchen-wall-albedo.png', import.meta.url).href,
  tileKitchenWallNormal: new URL('../../public/mifen/textures/tile-kitchen-wall-normal.png', import.meta.url).href,
  tileKitchenWallRoughness: new URL('../../public/mifen/textures/tile-kitchen-wall-roughness.png', import.meta.url).href,
  tileHallFloorAlbedo: new URL('../../public/mifen/textures/tile-hall-floor-albedo.png', import.meta.url).href,
  tileHallFloorNormal: new URL('../../public/mifen/textures/tile-hall-floor-normal.png', import.meta.url).href,
  tileHallFloorRoughness: new URL('../../public/mifen/textures/tile-hall-floor-roughness.png', import.meta.url).href,
  tileKitchenFloorAlbedo: new URL('../../public/mifen/textures/tile-kitchen-floor-albedo.png', import.meta.url).href,
  tileKitchenFloorNormal: new URL('../../public/mifen/textures/tile-kitchen-floor-normal.png', import.meta.url).href,
  tileKitchenFloorRoughness: new URL('../../public/mifen/textures/tile-kitchen-floor-roughness.png', import.meta.url).href,
  tilePaversAlbedo: new URL('../../public/mifen/textures/tile-pavers-albedo.png', import.meta.url).href,
  tilePaversNormal: new URL('../../public/mifen/textures/tile-pavers-normal.png', import.meta.url).href,
  tilePaversRoughness: new URL('../../public/mifen/textures/tile-pavers-roughness.png', import.meta.url).href,
  tileRoofAlbedo: new URL('../../public/mifen/textures/tile-roof-albedo.png', import.meta.url).href,
  tileRoofNormal: new URL('../../public/mifen/textures/tile-roof-normal.png', import.meta.url).href,
  tileRoofRoughness: new URL('../../public/mifen/textures/tile-roof-roughness.png', import.meta.url).href,
  tileResWallAlbedo: new URL('../../public/mifen/textures/tile-res-wall-albedo.png', import.meta.url).href,
  tileResWallNormal: new URL('../../public/mifen/textures/tile-res-wall-normal.png', import.meta.url).href,
  tileResWallRoughness: new URL('../../public/mifen/textures/tile-res-wall-roughness.png', import.meta.url).href,
  stoneGraniteAlbedo: new URL('../../public/mifen/textures/stone-granite-albedo.png', import.meta.url).href,
  stoneGraniteNormal: new URL('../../public/mifen/textures/stone-granite-normal.png', import.meta.url).href,
  stoneGraniteRoughness: new URL('../../public/mifen/textures/stone-granite-roughness.png', import.meta.url).href,
  stoneQuartzAlbedo: new URL('../../public/mifen/textures/stone-quartz-albedo.png', import.meta.url).href,
  stoneQuartzNormal: new URL('../../public/mifen/textures/stone-quartz-normal.png', import.meta.url).href,
  stoneQuartzRoughness: new URL('../../public/mifen/textures/stone-quartz-roughness.png', import.meta.url).href,
  steelBrushedAlbedo: new URL('../../public/mifen/textures/steel-brushed-albedo.png', import.meta.url).href,
  steelBrushedNormal: new URL('../../public/mifen/textures/steel-brushed-normal.png', import.meta.url).href,
  steelBrushedRoughness: new URL('../../public/mifen/textures/steel-brushed-roughness.png', import.meta.url).href,
  steelDarkAlbedo: new URL('../../public/mifen/textures/steel-dark-albedo.png', import.meta.url).href,
  aluBrushedAlbedo: new URL('../../public/mifen/textures/alu-brushed-albedo.png', import.meta.url).href,
  metalBlackAlbedo: new URL('../../public/mifen/textures/metal-black-albedo.png', import.meta.url).href,
  metalPowderNormal: new URL('../../public/mifen/textures/metal-powder-normal.png', import.meta.url).href,
  metalPowderRoughness: new URL('../../public/mifen/textures/metal-powder-roughness.png', import.meta.url).href,
  concretePlasterAlbedo: new URL('../../public/mifen/textures/concrete-plaster-albedo.png', import.meta.url).href,
  concreteDeckAlbedo: new URL('../../public/mifen/textures/concrete-deck-albedo.png', import.meta.url).href,
  concreteSlabAlbedo: new URL('../../public/mifen/textures/concrete-slab-albedo.png', import.meta.url).href,
  concreteNormal: new URL('../../public/mifen/textures/concrete-normal.png', import.meta.url).href,
  concreteRoughness: new URL('../../public/mifen/textures/concrete-roughness.png', import.meta.url).href,
  curtainLinenAlbedo: new URL('../../public/mifen/textures/curtain-linen-albedo.png', import.meta.url).href,
  curtainLinenNormal: new URL('../../public/mifen/textures/curtain-linen-normal.png', import.meta.url).href,
  curtainLinenRoughness: new URL('../../public/mifen/textures/curtain-linen-roughness.png', import.meta.url).href,
  curtainBlueAlbedo: new URL('../../public/mifen/textures/curtain-blue-albedo.png', import.meta.url).href,
  curtainVinylAlbedo: new URL('../../public/mifen/textures/curtain-vinyl-albedo.png', import.meta.url).href,
  curtainVinylNormal: new URL('../../public/mifen/textures/curtain-vinyl-normal.png', import.meta.url).href,
  curtainVinylRoughness: new URL('../../public/mifen/textures/curtain-vinyl-roughness.png', import.meta.url).href,
  plasticMicroAlbedo: new URL('../../public/mifen/textures/plastic-micro-albedo.png', import.meta.url).href,
  plasticGrainNormal: new URL('../../public/mifen/textures/plastic-grain-normal.png', import.meta.url).href,
  plasticGrainRoughness: new URL('../../public/mifen/textures/plastic-grain-roughness.png', import.meta.url).href,
  foodNoodleAlbedo: new URL('../../public/mifen/textures/food-noodle-albedo.png', import.meta.url).href,
  foodNoodleNormal: new URL('../../public/mifen/textures/food-noodle-normal.png', import.meta.url).href,
  foodNoodleRoughness: new URL('../../public/mifen/textures/food-noodle-roughness.png', import.meta.url).href,
  foodGuoshaoAlbedo: new URL('../../public/mifen/textures/food-guoshao-albedo.png', import.meta.url).href,
  foodGuoshaoNormal: new URL('../../public/mifen/textures/food-guoshao-normal.png', import.meta.url).href,
  foodGuoshaoRoughness: new URL('../../public/mifen/textures/food-guoshao-roughness.png', import.meta.url).href,
  foodBeefAlbedo: new URL('../../public/mifen/textures/food-beef-albedo.png', import.meta.url).href,
  foodBeefNormal: new URL('../../public/mifen/textures/food-beef-normal.png', import.meta.url).href,
  foodBeefRoughness: new URL('../../public/mifen/textures/food-beef-roughness.png', import.meta.url).href,
  foodCharsiuAlbedo: new URL('../../public/mifen/textures/food-charsiu-albedo.png', import.meta.url).href,
  foodCharsiuNormal: new URL('../../public/mifen/textures/food-charsiu-normal.png', import.meta.url).href,
  foodCharsiuRoughness: new URL('../../public/mifen/textures/food-charsiu-roughness.png', import.meta.url).href,
  foodEggAlbedo: new URL('../../public/mifen/textures/food-egg-albedo.png', import.meta.url).href,
  foodEggNormal: new URL('../../public/mifen/textures/food-egg-normal.png', import.meta.url).href,
  foodEggRoughness: new URL('../../public/mifen/textures/food-egg-roughness.png', import.meta.url).href,
  foodYolkAlbedo: new URL('../../public/mifen/textures/food-yolk-albedo.png', import.meta.url).href,
  foodYolkNormal: new URL('../../public/mifen/textures/food-yolk-normal.png', import.meta.url).href,
  foodYolkRoughness: new URL('../../public/mifen/textures/food-yolk-roughness.png', import.meta.url).href,
  foodYoutiaoAlbedo: new URL('../../public/mifen/textures/food-youtiao-albedo.png', import.meta.url).href,
  foodYoutiaoNormal: new URL('../../public/mifen/textures/food-youtiao-normal.png', import.meta.url).href,
  foodYoutiaoRoughness: new URL('../../public/mifen/textures/food-youtiao-roughness.png', import.meta.url).href,
  foodPeanutAlbedo: new URL('../../public/mifen/textures/food-peanut-albedo.png', import.meta.url).href,
  foodPeanutNormal: new URL('../../public/mifen/textures/food-peanut-normal.png', import.meta.url).href,
  foodPeanutRoughness: new URL('../../public/mifen/textures/food-peanut-roughness.png', import.meta.url).href,
  foodBrineAlbedo: new URL('../../public/mifen/textures/food-brine-albedo.png', import.meta.url).href,
  foodSoupAlbedo: new URL('../../public/mifen/textures/food-soup-albedo.png', import.meta.url).href,
  foodSourSoupAlbedo: new URL('../../public/mifen/textures/food-sour-soup-albedo.png', import.meta.url).href,
  foodLiquidNormal: new URL('../../public/mifen/textures/food-liquid-normal.png', import.meta.url).href,
  foodLiquidRoughness: new URL('../../public/mifen/textures/food-liquid-roughness.png', import.meta.url).href,
  bowlCeramicAlbedo: new URL('../../public/mifen/textures/bowl-ceramic-albedo.png', import.meta.url).href,
  bowlCeramicNormal: new URL('../../public/mifen/textures/bowl-ceramic-normal.png', import.meta.url).href,
  bowlCeramicRoughness: new URL('../../public/mifen/textures/bowl-ceramic-roughness.png', import.meta.url).href,
  condScallionAlbedo: new URL('../../public/mifen/textures/cond-scallion-albedo.png', import.meta.url).href,
  condScallionNormal: new URL('../../public/mifen/textures/cond-scallion-normal.png', import.meta.url).href,
  condScallionRoughness: new URL('../../public/mifen/textures/cond-scallion-roughness.png', import.meta.url).href,
  condGreenChiliAlbedo: new URL('../../public/mifen/textures/cond-green-chili-albedo.png', import.meta.url).href,
  condGreenChiliNormal: new URL('../../public/mifen/textures/cond-green-chili-normal.png', import.meta.url).href,
  condGreenChiliRoughness: new URL('../../public/mifen/textures/cond-green-chili-roughness.png', import.meta.url).href,
  condSourBeansAlbedo: new URL('../../public/mifen/textures/cond-sour-beans-albedo.png', import.meta.url).href,
  condSourBeansNormal: new URL('../../public/mifen/textures/cond-sour-beans-normal.png', import.meta.url).href,
  condSourBeansRoughness: new URL('../../public/mifen/textures/cond-sour-beans-roughness.png', import.meta.url).href,
  condRadishAlbedo: new URL('../../public/mifen/textures/cond-radish-albedo.png', import.meta.url).href,
  condRadishNormal: new URL('../../public/mifen/textures/cond-radish-normal.png', import.meta.url).href,
  condRadishRoughness: new URL('../../public/mifen/textures/cond-radish-roughness.png', import.meta.url).href,
  condPickledChiliAlbedo: new URL('../../public/mifen/textures/cond-pickled-chili-albedo.png', import.meta.url).href,
  condPickledChiliNormal: new URL('../../public/mifen/textures/cond-pickled-chili-normal.png', import.meta.url).href,
  condPickledChiliRoughness: new URL('../../public/mifen/textures/cond-pickled-chili-roughness.png', import.meta.url).href,
  condChiliOilAlbedo: new URL('../../public/mifen/textures/cond-chili-oil-albedo.png', import.meta.url).href,
  condChiliOilNormal: new URL('../../public/mifen/textures/cond-chili-oil-normal.png', import.meta.url).href,
  condChiliOilRoughness: new URL('../../public/mifen/textures/cond-chili-oil-roughness.png', import.meta.url).href,
  condSourBambooAlbedo: new URL('../../public/mifen/textures/cond-sour-bamboo-albedo.png', import.meta.url).href,
  condSourBambooNormal: new URL('../../public/mifen/textures/cond-sour-bamboo-normal.png', import.meta.url).href,
  condSourBambooRoughness: new URL('../../public/mifen/textures/cond-sour-bamboo-roughness.png', import.meta.url).href,
} as const

type TexKind = 'albedo' | 'normal' | 'roughness'
type PeriodM = readonly [number, number]

export interface TiledPbrOptions {
  color?: THREE.ColorRepresentation
  periodM?: [number, number]
  repeat?: [number, number]
  tiled?: boolean
  roughness?: number
  metalness?: number
  normalScale?: number
  emissive?: THREE.ColorRepresentation
  emissiveIntensity?: number
  side?: THREE.Side
  transparent?: boolean
  opacity?: number
  name?: string
}

export type WoodVariant = 'cedar' | 'dark' | 'table'
export type TileVariant = 'hall_wall' | 'kitchen_wall' | 'hall_floor' | 'kitchen_floor' | 'pavers' | 'roof_tile' | 'residential'
export type StainlessVariant = 'brushed' | 'dark' | 'aluminium'
export type ConcreteVariant = 'plaster' | 'roof_deck' | 'slab_edge' | 'granite' | 'quartz'
export type CurtainVariant = 'kitchen_linen' | 'guilin_blue' | 'stripe_vinyl'
export type IngredientVariant =
  | 'noodle'
  | 'guoshao'
  | 'beef'
  | 'charsiu'
  | 'egg'
  | 'yolk'
  | 'youtiao'
  | 'peanut'
  | 'brine'
  | 'soup'
  | 'sour_soup'
  | 'ceramic'
export type CondimentVariant =
  | 'scallion'
  | 'pickled_green_chili'
  | 'sour_long_beans'
  | 'radish_strips'
  | 'pickled_chili'
  | 'chili_oil'
  | 'sour_bamboo'

interface PbrSpec {
  albedo: string
  normal: string
  roughness: string
  periodM: PeriodM
  repeat?: PeriodM
  tiled?: boolean
  metalness?: number
  normalScale?: number
  side?: THREE.Side
  transparent?: boolean
  opacity?: number
}

const WOOD_SPECS: Record<WoodVariant, PbrSpec> = {
  cedar: {
    albedo: TEX.woodCedarAlbedo,
    normal: TEX.woodCedarNormal,
    roughness: TEX.woodCedarRoughness,
    periodM: [0.72, 1.6],
    normalScale: 0.9,
  },
  dark: {
    albedo: TEX.woodDarkAlbedo,
    normal: TEX.woodDarkNormal,
    roughness: TEX.woodDarkRoughness,
    periodM: [1, 1],
    normalScale: 0.8,
  },
  table: {
    albedo: TEX.woodTableAlbedo,
    normal: TEX.woodTableNormal,
    roughness: TEX.woodTableRoughness,
    periodM: [1, 1],
    normalScale: 0.75,
  },
}

const TILE_SPECS: Record<TileVariant, PbrSpec> = {
  hall_wall: {
    albedo: TEX.tileHallWallAlbedo,
    normal: TEX.tileHallWallNormal,
    roughness: TEX.tileHallWallRoughness,
    periodM: [2.4, 2.4],
    normalScale: 0.7,
  },
  kitchen_wall: {
    albedo: TEX.tileKitchenWallAlbedo,
    normal: TEX.tileKitchenWallNormal,
    roughness: TEX.tileKitchenWallRoughness,
    periodM: [2.4, 2.4],
    normalScale: 0.75,
  },
  hall_floor: {
    albedo: TEX.tileHallFloorAlbedo,
    normal: TEX.tileHallFloorNormal,
    roughness: TEX.tileHallFloorRoughness,
    periodM: [3.2, 3.2],
    normalScale: 0.75,
  },
  kitchen_floor: {
    albedo: TEX.tileKitchenFloorAlbedo,
    normal: TEX.tileKitchenFloorNormal,
    roughness: TEX.tileKitchenFloorRoughness,
    periodM: [2.4, 2.4],
    normalScale: 1.0,
  },
  pavers: {
    albedo: TEX.tilePaversAlbedo,
    normal: TEX.tilePaversNormal,
    roughness: TEX.tilePaversRoughness,
    periodM: [1.2, 1.2],
    normalScale: 1.0,
  },
  roof_tile: {
    albedo: TEX.tileRoofAlbedo,
    normal: TEX.tileRoofNormal,
    roughness: TEX.tileRoofRoughness,
    periodM: [1.2, 1.2],
    metalness: 0.05,
    normalScale: 1.05,
  },
  residential: {
    albedo: TEX.tileResWallAlbedo,
    normal: TEX.tileResWallNormal,
    roughness: TEX.tileResWallRoughness,
    periodM: [3, 3],
    normalScale: 0.75,
  },
}

const STAINLESS_SPECS: Record<StainlessVariant, PbrSpec> = {
  brushed: {
    albedo: TEX.steelBrushedAlbedo,
    normal: TEX.steelBrushedNormal,
    roughness: TEX.steelBrushedRoughness,
    periodM: [1, 1],
    metalness: 0.28,
    normalScale: 0.55,
  },
  dark: {
    albedo: TEX.steelDarkAlbedo,
    normal: TEX.steelBrushedNormal,
    roughness: TEX.steelBrushedRoughness,
    periodM: [1, 1],
    metalness: 0.22,
    normalScale: 0.55,
  },
  aluminium: {
    albedo: TEX.aluBrushedAlbedo,
    normal: TEX.steelBrushedNormal,
    roughness: TEX.steelBrushedRoughness,
    periodM: [1, 1],
    metalness: 0.26,
    normalScale: 0.5,
  },
}

const CONCRETE_SPECS: Record<ConcreteVariant, PbrSpec> = {
  plaster: {
    albedo: TEX.concretePlasterAlbedo,
    normal: TEX.concreteNormal,
    roughness: TEX.concreteRoughness,
    periodM: [2.4, 2.4],
    normalScale: 0.75,
  },
  roof_deck: {
    albedo: TEX.concreteDeckAlbedo,
    normal: TEX.concreteNormal,
    roughness: TEX.concreteRoughness,
    periodM: [2.4, 2.4],
    normalScale: 0.85,
  },
  slab_edge: {
    albedo: TEX.concreteSlabAlbedo,
    normal: TEX.concreteNormal,
    roughness: TEX.concreteRoughness,
    periodM: [2.4, 2.4],
    normalScale: 0.75,
  },
  granite: {
    albedo: TEX.stoneGraniteAlbedo,
    normal: TEX.stoneGraniteNormal,
    roughness: TEX.stoneGraniteRoughness,
    periodM: [1, 1],
    metalness: 0.05,
    normalScale: 0.75,
  },
  quartz: {
    albedo: TEX.stoneQuartzAlbedo,
    normal: TEX.stoneQuartzNormal,
    roughness: TEX.stoneQuartzRoughness,
    periodM: [1, 1],
    normalScale: 0.35,
  },
}

const CURTAIN_SPECS: Record<CurtainVariant, PbrSpec> = {
  kitchen_linen: {
    albedo: TEX.curtainLinenAlbedo,
    normal: TEX.curtainLinenNormal,
    roughness: TEX.curtainLinenRoughness,
    periodM: [1.2, 2.1],
    normalScale: 1.05,
    side: THREE.DoubleSide,
  },
  guilin_blue: {
    albedo: TEX.curtainBlueAlbedo,
    normal: TEX.curtainLinenNormal,
    roughness: TEX.curtainLinenRoughness,
    periodM: [1.2, 2.1],
    normalScale: 1.05,
    side: THREE.DoubleSide,
  },
  stripe_vinyl: {
    albedo: TEX.curtainVinylAlbedo,
    normal: TEX.curtainVinylNormal,
    roughness: TEX.curtainVinylRoughness,
    periodM: [1.2, 2.1],
    normalScale: 0.95,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8,
  },
}

const INGREDIENT_SPECS: Record<IngredientVariant, PbrSpec> = {
  noodle: {
    albedo: TEX.foodNoodleAlbedo,
    normal: TEX.foodNoodleNormal,
    roughness: TEX.foodNoodleRoughness,
    periodM: [0.16, 0.16],
    repeat: [1.4, 1.4],
    tiled: true,
    normalScale: 0.85,
  },
  guoshao: {
    albedo: TEX.foodGuoshaoAlbedo,
    normal: TEX.foodGuoshaoNormal,
    roughness: TEX.foodGuoshaoRoughness,
    periodM: [0.16, 0.16],
    repeat: [1.0, 1.0],
    tiled: true,
    normalScale: 1.1,
  },
  beef: {
    albedo: TEX.foodBeefAlbedo,
    normal: TEX.foodBeefNormal,
    roughness: TEX.foodBeefRoughness,
    periodM: [0.14, 0.14],
    repeat: [1.0, 1.0],
    tiled: false,
    normalScale: 0.95,
  },
  charsiu: {
    albedo: TEX.foodCharsiuAlbedo,
    normal: TEX.foodCharsiuNormal,
    roughness: TEX.foodCharsiuRoughness,
    periodM: [0.14, 0.14],
    repeat: [1.0, 1.0],
    tiled: false,
    normalScale: 0.75,
  },
  egg: {
    albedo: TEX.foodEggAlbedo,
    normal: TEX.foodEggNormal,
    roughness: TEX.foodEggRoughness,
    periodM: [0.1, 0.1],
    repeat: [1, 1],
    tiled: false,
    normalScale: 0.55,
  },
  yolk: {
    albedo: TEX.foodYolkAlbedo,
    normal: TEX.foodYolkNormal,
    roughness: TEX.foodYolkRoughness,
    periodM: [0.06, 0.06],
    repeat: [1, 1],
    tiled: false,
    normalScale: 0.6,
  },
  youtiao: {
    albedo: TEX.foodYoutiaoAlbedo,
    normal: TEX.foodYoutiaoNormal,
    roughness: TEX.foodYoutiaoRoughness,
    periodM: [0.12, 0.12],
    repeat: [1.1, 1.1],
    tiled: false,
    normalScale: 0.95,
  },
  peanut: {
    albedo: TEX.foodPeanutAlbedo,
    normal: TEX.foodPeanutNormal,
    roughness: TEX.foodPeanutRoughness,
    periodM: [0.1, 0.1],
    repeat: [1, 1],
    tiled: false,
    normalScale: 0.9,
  },
  brine: {
    albedo: TEX.foodBrineAlbedo,
    normal: TEX.foodLiquidNormal,
    roughness: TEX.foodLiquidRoughness,
    periodM: [0.3, 0.3],
    repeat: [1.5, 1.5],
    tiled: false,
    metalness: 0.06,
    normalScale: 0.45,
  },
  soup: {
    albedo: TEX.foodSoupAlbedo,
    normal: TEX.foodLiquidNormal,
    roughness: TEX.foodLiquidRoughness,
    periodM: [0.3, 0.3],
    repeat: [1.5, 1.5],
    tiled: false,
    metalness: 0.04,
    normalScale: 0.45,
  },
  sour_soup: {
    albedo: TEX.foodSourSoupAlbedo,
    normal: TEX.foodLiquidNormal,
    roughness: TEX.foodLiquidRoughness,
    periodM: [0.3, 0.3],
    repeat: [1.5, 1.5],
    tiled: false,
    metalness: 0.05,
    normalScale: 0.5,
  },
  ceramic: {
    albedo: TEX.bowlCeramicAlbedo,
    normal: TEX.bowlCeramicNormal,
    roughness: TEX.bowlCeramicRoughness,
    periodM: [0.25, 0.25],
    repeat: [2, 2],
    tiled: false,
    normalScale: 0.35,
    side: THREE.DoubleSide,
  },
}

const CONDIMENT_SPECS: Record<CondimentVariant, PbrSpec> = {
  scallion: {
    albedo: TEX.condScallionAlbedo,
    normal: TEX.condScallionNormal,
    roughness: TEX.condScallionRoughness,
    periodM: [0.16, 0.16],
    repeat: [1.3, 1.3],
    tiled: false,
    normalScale: 1.0,
  },
  pickled_green_chili: {
    albedo: TEX.condGreenChiliAlbedo,
    normal: TEX.condGreenChiliNormal,
    roughness: TEX.condGreenChiliRoughness,
    periodM: [0.16, 0.16],
    repeat: [1.3, 1.3],
    tiled: false,
    normalScale: 0.95,
  },
  sour_long_beans: {
    albedo: TEX.condSourBeansAlbedo,
    normal: TEX.condSourBeansNormal,
    roughness: TEX.condSourBeansRoughness,
    periodM: [0.16, 0.16],
    repeat: [1.35, 1.35],
    tiled: false,
    normalScale: 0.95,
  },
  radish_strips: {
    albedo: TEX.condRadishAlbedo,
    normal: TEX.condRadishNormal,
    roughness: TEX.condRadishRoughness,
    periodM: [0.16, 0.16],
    repeat: [1.3, 1.3],
    tiled: false,
    normalScale: 0.9,
  },
  pickled_chili: {
    albedo: TEX.condPickledChiliAlbedo,
    normal: TEX.condPickledChiliNormal,
    roughness: TEX.condPickledChiliRoughness,
    periodM: [0.16, 0.16],
    repeat: [1.3, 1.3],
    tiled: false,
    normalScale: 0.95,
  },
  chili_oil: {
    albedo: TEX.condChiliOilAlbedo,
    normal: TEX.condChiliOilNormal,
    roughness: TEX.condChiliOilRoughness,
    periodM: [0.16, 0.16],
    repeat: [1.3, 1.3],
    tiled: false,
    normalScale: 0.85,
  },
  sour_bamboo: {
    albedo: TEX.condSourBambooAlbedo,
    normal: TEX.condSourBambooNormal,
    roughness: TEX.condSourBambooRoughness,
    periodM: [0.16, 0.16],
    repeat: [1.25, 1.25],
    tiled: false,
    normalScale: 0.9,
  },
}

let texLoader: THREE.TextureLoader | null = null

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void

function seeded(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0
    return (s >>> 0) / 4294967296
  }
}

function configureTex(tex: THREE.Texture, periodM?: PeriodM, kind: TexKind = 'albedo', repeat?: PeriodM): THREE.Texture {
  tex.colorSpace = kind === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace
  tex.anisotropy = 8
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(repeat[0], repeat[1])
  } else if (periodM) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(1 / periodM[0], 1 / periodM[1])
  }
  return tex
}

function texAsset(pool: THREE.Texture[], url: string, periodM?: PeriodM, kind: TexKind = 'albedo', repeat?: PeriodM): THREE.Texture {
  let tex: THREE.Texture
  if (typeof document !== 'undefined') {
    texLoader ??= new THREE.TextureLoader()
    tex = texLoader.load(url)
  } else {
    const px =
      kind === 'normal'
        ? new Uint8Array([128, 128, 255, 255])
        : kind === 'roughness'
          ? new Uint8Array([180, 180, 180, 255])
          : new Uint8Array([214, 204, 186, 255])
    tex = new THREE.DataTexture(px, 1, 1)
    tex.needsUpdate = true
  }
  tex.userData.sourceUrl = url
  configureTex(tex, periodM, kind, repeat)
  pool.push(tex)
  return tex
}

function canvasTex(pool: THREE.Texture[], w: number, h: number, draw: Draw, periodM?: PeriodM): THREE.Texture {
  let tex: THREE.Texture
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (ctx) draw(ctx, w, h)
    tex = new THREE.CanvasTexture(canvas)
  } else {
    tex = new THREE.DataTexture(new Uint8Array([214, 204, 186, 255]), 1, 1)
    tex.needsUpdate = true
  }
  configureTex(tex, periodM, 'albedo')
  pool.push(tex)
  return tex
}

const rgb = (r: number, g: number, b: number) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`

// ───────────────────────────── 建筑外立面 ─────────────────────────────

/** 门头「田源米粉」四字图集：黄色亚克力发光字，透明底 */
function drawFasciaGlyphs(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h)
  const chars = ['田', '源', '米', '粉']
  const cell = w / chars.length
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  chars.forEach((ch, i) => {
    const cx = cell * (i + 0.5)
    const cy = h * 0.52
    ctx.save()
    ctx.translate(cx, cy)
    ctx.transform(1, 0, -0.08, 1, 0, 0)
    ctx.font = `900 ${Math.round(h * 0.8)}px ${BRUSH}`
    ctx.lineJoin = 'round'
    ctx.lineWidth = h * 0.07
    ctx.strokeStyle = '#a98a08'
    ctx.strokeText(ch, 3, 4)
    ctx.lineWidth = h * 0.05
    ctx.strokeStyle = '#f3dc1c'
    ctx.strokeText(ch, 0, 0)
    ctx.fillStyle = '#fbe83a'
    ctx.fillText(ch, 0, 0)
    ctx.restore()
  })
}



/** 老居民楼奶白外墙：小块面砖 + 雨痕 */
function drawResidentialWall(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#e4ddcd'
  ctx.fillRect(0, 0, w, h)
  const rand = seeded(29)
  for (let y = 0; y < h; y += 16) {
    for (let x = (y / 16) % 2 ? 0 : 12; x < w; x += 24) {
      const t = (rand() - 0.5) * 14
      ctx.fillStyle = rgb(228 + t, 221 + t, 205 + t)
      ctx.fillRect(x + 1, y + 1, 22, 14)
    }
  }
  for (let i = 0; i < 14; i++) {
    const x = rand() * w
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, 'rgba(120,110,92,0.18)')
    g.addColorStop(1, 'rgba(120,110,92,0)')
    ctx.fillStyle = g
    ctx.fillRect(x, 0, 6 + rand() * 18, h * (0.3 + rand() * 0.6))
  }
}

/** 居民楼窗带：铝框推拉窗 + 防盗网，周期 3m × 1 层 */
function drawResidentialWindows(ctx: CanvasRenderingContext2D, w: number, h: number) {
  drawResidentialWall(ctx, w, h)
  const winW = w * 0.46
  const x0 = (w - winW) / 2
  const y0 = h * 0.28
  const winH = h * 0.42
  ctx.fillStyle = '#2b3438'
  ctx.fillRect(x0, y0, winW, winH)
  const g = ctx.createLinearGradient(x0, y0, x0 + winW, y0 + winH)
  g.addColorStop(0, 'rgba(150,180,190,0.42)')
  g.addColorStop(0.5, 'rgba(60,80,90,0.1)')
  g.addColorStop(1, 'rgba(150,180,190,0.3)')
  ctx.fillStyle = g
  ctx.fillRect(x0, y0, winW, winH)
  ctx.strokeStyle = '#c9ccc8'
  ctx.lineWidth = 5
  ctx.strokeRect(x0, y0, winW, winH)
  ctx.fillStyle = '#c9ccc8'
  ctx.fillRect(x0 + winW / 2 - 2, y0, 4, winH)
  ctx.strokeStyle = 'rgba(70,74,72,0.85)'
  ctx.lineWidth = 2
  for (let x = x0 - 8; x <= x0 + winW + 8; x += 14) {
    ctx.beginPath()
    ctx.moveTo(x, y0 - 10)
    ctx.lineTo(x, y0 + winH + 6)
    ctx.stroke()
  }
  ctx.fillStyle = '#d3d0c6'
  ctx.fillRect(x0 - 10, y0 + winH + 4, winW + 20, 8)
}

/** 居民窗夜间自发光遮罩：只有窗洞透出暖光，与 drawResidentialWindows 同尺寸同位置 */
function drawResidentialWindowsGlow(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  const winW = w * 0.46
  const x0 = (w - winW) / 2
  const y0 = h * 0.28
  const winH = h * 0.42
  const g = ctx.createLinearGradient(0, y0, 0, y0 + winH)
  g.addColorStop(0, '#6b5a40')
  g.addColorStop(0.5, '#ffffff')
  g.addColorStop(1, '#b09a72')
  ctx.fillStyle = g
  ctx.fillRect(x0 + 3, y0 + 3, winW - 6, winH - 6)
  ctx.fillStyle = '#000'
  ctx.fillRect(x0 + winW / 2 - 3, y0, 6, winH)
}

/** 弧形阳台：1 张 = 3m × 2.9m，自下而上为米色实心栏板约 1m、白灰铁花防盗网（竖栅 + 拱花 + 菱形饰带，alpha 镂空） */
function drawBalconyGrille(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h)
  const capY = h * 0.64
  const g = ctx.createLinearGradient(0, capY, 0, h)
  g.addColorStop(0, '#e9e2d2')
  g.addColorStop(1, '#d8cfbc')
  ctx.fillStyle = g
  ctx.fillRect(0, capY, w, h - capY)
  const rand = seeded(57)
  for (let i = 0; i < 26; i++) {
    const x = rand() * w
    ctx.fillStyle = `rgba(92,84,70,${0.05 + rand() * 0.08})`
    ctx.fillRect(x, capY + 8, 2 + rand() * 4, (h - capY) * (0.2 + rand() * 0.5))
  }
  ctx.fillStyle = '#f2eee4'
  ctx.fillRect(0, capY - 6, w, 10)

  const top = h * 0.09
  ctx.strokeStyle = '#d6d9d3'
  ctx.lineWidth = 4
  for (let x = 5; x < w; x += 17) {
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, capY)
    ctx.stroke()
  }
  ctx.lineWidth = 6
  const midY = top + (capY - top) * 0.3
  for (const y of [top, midY, capY - 8]) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }
  ctx.lineWidth = 3
  for (let x = 0; x < w; x += w / 8) {
    ctx.beginPath()
    ctx.arc(x + w / 16, midY, w / 18, Math.PI, 0)
    ctx.stroke()
  }
  const dy = (capY - midY) * 0.55 + midY
  for (let x = w / 16; x < w; x += w / 8) {
    ctx.beginPath()
    ctx.moveTo(x, dy - 16)
    ctx.lineTo(x + 12, dy)
    ctx.lineTo(x, dy + 16)
    ctx.lineTo(x - 12, dy)
    ctx.closePath()
    ctx.stroke()
  }
}



/** 橱窗玻璃：浅青通透 + 腰线黄色防撞条 */
function drawStorefrontGlass(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(176,206,212,0.22)'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(242,206,36,0.95)'
  ctx.fillRect(0, h * 0.62, w, h * 0.035)
  ctx.fillStyle = 'rgba(255,255,255,0.14)'
  ctx.beginPath()
  ctx.moveTo(w * 0.1, 0)
  ctx.lineTo(w * 0.24, 0)
  ctx.lineTo(w * 0.06, h)
  ctx.lineTo(0, h)
  ctx.fill()
}



/** 深色木纹（桌面、木匾背板），周期 1m */
function drawWoodGrain(ctx: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], seed: number) {
  ctx.fillStyle = rgb(...base)
  ctx.fillRect(0, 0, w, h)
  const rand = seeded(seed)
  for (let i = 0; i < 70; i++) {
    const y = rand() * h
    ctx.strokeStyle = rand() < 0.5 ? 'rgba(20,10,4,0.22)' : 'rgba(255,210,160,0.08)'
    ctx.lineWidth = 0.8 + rand() * 2.5
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.bezierCurveTo(w * 0.3, y + (rand() - 0.5) * 20, w * 0.7, y + (rand() - 0.5) * 20, w, y + (rand() - 0.5) * 10)
    ctx.stroke()
  }
}

// ───────────────────────────── 牌匾与菜牌 ─────────────────────────────

/** 内墙深棕金字木匾「田源米粉」+ 右下竖排「老字号」+ 左上朱印（实拍 #05/#09/#17） */
function drawInteriorPlaque(ctx: CanvasRenderingContext2D, w: number, h: number) {
  drawWoodGrain(ctx, w, h, [72, 30, 20], 107)
  ctx.strokeStyle = '#d6ad47'
  ctx.lineWidth = 5
  ctx.strokeRect(14, 14, w - 28, h - 28)
  const corner = (x: number, y: number, sx: number, sy: number) => {
    ctx.beginPath()
    ctx.moveTo(x, y + sy * 34)
    ctx.lineTo(x, y)
    ctx.lineTo(x + sx * 34, y)
    ctx.moveTo(x + sx * 10, y + sy * 22)
    ctx.lineTo(x + sx * 10, y + sy * 10)
    ctx.lineTo(x + sx * 22, y + sy * 10)
    ctx.stroke()
  }
  ctx.lineWidth = 4
  corner(24, 24, 1, 1)
  corner(w - 24, 24, -1, 1)
  corner(24, h - 24, 1, -1)
  corner(w - 24, h - 24, -1, -1)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `900 ${Math.round(h * 0.5)}px ${BRUSH}`
  const chars = ['田', '源', '米', '粉']
  chars.forEach((ch, i) => {
    const x = w * (0.2 + i * 0.19)
    ctx.fillStyle = 'rgba(20,6,2,0.6)'
    ctx.fillText(ch, x + 4, h * 0.53 + 4)
    const g = ctx.createLinearGradient(0, h * 0.25, 0, h * 0.8)
    g.addColorStop(0, '#f7dc86')
    g.addColorStop(0.5, '#d9a93c')
    g.addColorStop(1, '#a87a22')
    ctx.fillStyle = g
    ctx.fillText(ch, x, h * 0.53)
  })
  ctx.font = `700 ${Math.round(h * 0.1)}px ${SERIF}`
  ctx.fillStyle = '#d9b25a'
  ;['老', '字', '号'].forEach((ch, i) => ctx.fillText(ch, w * 0.93, h * (0.52 + i * 0.12)))
  ctx.fillStyle = '#a3322a'
  ctx.fillRect(w * 0.06, h * 0.16, h * 0.13, h * 0.13)
}

/** 黄底价目表（实拍 #15 同城店价目表样式），数据来自 recipes.json */
function drawPriceBoard(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#f6d23a'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#c0392b'
  ctx.lineWidth = 8
  ctx.strokeRect(10, 10, w - 20, h - 20)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#b3261e'
  ctx.font = `900 ${Math.round(h * 0.085)}px ${SANS}`
  ctx.fillText('米粉价目表', w / 2, h * 0.09)
  const list = recipes.recipes ?? []
  const rows = Math.max(1, list.length)
  const top = h * 0.17
  const rowH = (h * 0.8) / rows
  list.forEach((r, i) => {
    const y = top + rowH * (i + 0.5)
    ctx.fillStyle = '#c0392b'
    ctx.fillRect(w * 0.05, y - rowH * 0.36, w * 0.13, rowH * 0.72)
    ctx.fillStyle = '#fff4c2'
    ctx.font = `800 ${Math.round(rowH * 0.42)}px ${SANS}`
    ctx.fillText(r.portion, w * 0.115, y)
    ctx.textAlign = 'left'
    ctx.fillStyle = '#2b1a0e'
    const name = r.name.replace(/（.*?）/g, '')
    let size = Math.round(rowH * 0.46)
    ctx.font = `800 ${size}px ${SANS}`
    while (ctx.measureText(name).width > w * 0.5 && size > 12) {
      size -= 1
      ctx.font = `800 ${size}px ${SANS}`
    }
    ctx.fillText(name, w * 0.22, y)
    ctx.textAlign = 'right'
    ctx.fillStyle = '#b3261e'
    ctx.font = `900 ${Math.round(rowH * 0.5)}px ${SANS}`
    ctx.fillText(`${r.price.toFixed(1)}元`, w * 0.94, y)
    ctx.textAlign = 'center'
  })
}

/** 明档上方四联菜牌：卤菜粉 / 汤菜粉 / 锅烧粉 / 香肠粉（实拍 #10） */
function drawMenuPosters(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const items: [string, string, string][] = [
    ['卤菜粉', '#6b3416', '#e0a040'],
    ['汤菜粉', '#d9c9a0', '#6f9a4a'],
    ['锅烧粉', '#c97a24', '#f2c46a'],
    ['香肠粉', '#a8322a', '#e8d6b0'],
  ]
  const pw = w / items.length
  ctx.fillStyle = '#1b1b1b'
  ctx.fillRect(0, 0, w, h)
  items.forEach(([title, meat, accent], i) => {
    const x = i * pw + 6
    const iw = pw - 12
    ctx.fillStyle = '#f7f5ef'
    ctx.fillRect(x, 6, iw, h - 12)
    const bx = x + iw / 2
    const by = h * 0.4
    const r = h * 0.27
    ctx.fillStyle = '#9aa3a8'
    ctx.beginPath()
    ctx.ellipse(bx, by, r * 1.25, r, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#efe9dc'
    ctx.beginPath()
    ctx.ellipse(bx, by, r * 1.08, r * 0.84, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(200,190,170,0.9)'
    ctx.lineWidth = 2
    for (let k = 0; k < 14; k++) {
      ctx.beginPath()
      ctx.arc(bx + (k - 7) * 4, by + 6, r * 0.6, Math.PI * 1.1, Math.PI * 1.9)
      ctx.stroke()
    }
    ctx.fillStyle = meat
    for (let k = 0; k < 5; k++) ctx.fillRect(bx - r * 0.7 + k * r * 0.28, by - r * 0.35 + (k % 2) * 8, r * 0.3, r * 0.22)
    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.arc(bx + r * 0.5, by + r * 0.25, r * 0.16, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#3f9a3c'
    for (let k = 0; k < 9; k++) ctx.fillRect(bx - r * 0.5 + k * r * 0.12, by + r * 0.42 - (k % 3) * 4, 5, 5)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#c4241b'
    ctx.font = `900 ${Math.round(h * 0.17)}px ${SANS}`
    ctx.fillText(title, bx, h * 0.84)
  })
}

/** 明档上方电视菜单屏：深底 + 两只粉碗特写 + 菜名价格（实拍 #06） */
function drawMenuScreen(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, '#3a1a0c')
  g.addColorStop(1, '#160904')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#e8b44a'
  ctx.fillRect(0, 0, w, h * 0.16)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#3a1a0c'
  ctx.font = `900 ${Math.round(h * 0.11)}px ${SANS}`
  ctx.fillText('田源米粉', w * 0.04, h * 0.08)
  const featured = ['lucai_2', 'guoshao_bowl']
    .map(id => (recipes.recipes ?? []).find(r => r.id === id))
    .filter((r): r is NonNullable<typeof r> => !!r)
  featured.forEach((r, i) => {
    const cx = w * (0.27 + i * 0.46)
    const cy = h * 0.55
    const rad = h * 0.27
    ctx.fillStyle = '#b8bfc4'
    ctx.beginPath()
    ctx.arc(cx, cy, rad, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#f1ebdd'
    ctx.beginPath()
    ctx.arc(cx, cy, rad * 0.86, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#d58a2a'
    for (let k = 0; k < 4; k++) ctx.fillRect(cx - rad * 0.6 + k * rad * 0.3, cy - rad * 0.4, rad * 0.26, rad * 0.2)
    ctx.fillStyle = '#5a2c18'
    for (let k = 0; k < 3; k++) ctx.fillRect(cx - rad * 0.4 + k * rad * 0.3, cy + rad * 0.02, rad * 0.26, rad * 0.16)
    ctx.fillStyle = '#4a9a3c'
    for (let k = 0; k < 10; k++) ctx.fillRect(cx - rad * 0.5 + k * rad * 0.1, cy + rad * 0.4 - (k % 3) * 5, 6, 6)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#fbe9c0'
    ctx.font = `800 ${Math.round(h * 0.08)}px ${SANS}`
    ctx.fillText(`${r.name.replace(/（.*?）/g, '')} ${r.price.toFixed(1)}`, cx, h * 0.92)
  })
}

/** 餐饮服务监管信息公示栏：蓝头白底，证照位用灰色占位，不编造编号 */
function drawSupervisionBoard(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#f2f5f8'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#2a64a8'
  ctx.lineWidth = 8
  ctx.strokeRect(4, 4, w - 8, h - 8)
  ctx.fillStyle = '#2a64a8'
  ctx.fillRect(8, 8, w - 16, h * 0.14)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#fff'
  ctx.font = `800 ${Math.round(h * 0.07)}px ${SANS}`
  ctx.fillText('桂林市餐饮服务监管信息公示', w / 2, h * 0.08)
  const rand = seeded(131)
  const cells: [number, number, number, number][] = [
    [0.05, 0.2, 0.42, 0.36],
    [0.53, 0.2, 0.42, 0.36],
    [0.05, 0.6, 0.27, 0.34],
    [0.37, 0.6, 0.27, 0.34],
    [0.69, 0.6, 0.26, 0.34],
  ]
  for (const [x, y, cw, ch] of cells) {
    ctx.fillStyle = '#fff'
    ctx.fillRect(w * x, h * y, w * cw, h * ch)
    ctx.strokeStyle = '#b7c6d8'
    ctx.lineWidth = 2
    ctx.strokeRect(w * x, h * y, w * cw, h * ch)
    ctx.fillStyle = 'rgba(70,84,100,0.35)'
    for (let l = 0; l < 6; l++) ctx.fillRect(w * (x + 0.02), h * (y + 0.05 + l * ch * 0.14), w * cw * (0.5 + rand() * 0.4), 3)
  }
}

/** 「必吃榜」橙红牌（实拍 #17 位置与配色；年份看不清，不写） */
function drawMustEat(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#f36b2a')
  g.addColorStop(1, '#d9431b')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#fff'
  ctx.font = `900 ${Math.round(h * 0.24)}px ${SANS}`
  ctx.fillText('必吃榜', w / 2, h * 0.5)
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
  ctx.lineWidth = 4
  ctx.strokeRect(w * 0.08, h * 0.08, w * 0.84, h * 0.84)
}

/** 金色奖牌 / 证书框 */
function drawCertificate(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#7a5a20'
  ctx.fillRect(0, 0, w, h)
  const g = ctx.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, '#f1d27a')
  g.addColorStop(0.5, '#c99a32')
  g.addColorStop(1, '#e6c160')
  ctx.fillStyle = g
  ctx.fillRect(w * 0.08, h * 0.08, w * 0.84, h * 0.84)
  ctx.fillStyle = 'rgba(90,60,10,0.45)'
  for (let l = 0; l < 5; l++) ctx.fillRect(w * 0.2, h * (0.3 + l * 0.1), w * 0.6, 3)
}

/** 通用小牌：底色 + 一行字 */
function badge(bg: string, fg: string, text: string, border?: string): Draw {
  return (ctx, w, h) => {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)
    if (border) {
      ctx.strokeStyle = border
      ctx.lineWidth = Math.max(4, h * 0.05)
      ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, w - ctx.lineWidth * 2, h - ctx.lineWidth * 2)
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = fg
    let size = Math.round(h * 0.56)
    ctx.font = `900 ${size}px ${SANS}`
    while (ctx.measureText(text).width > w * 0.88 && size > 10) {
      size -= 2
      ctx.font = `900 ${size}px ${SANS}`
    }
    ctx.fillText(text, w / 2, h * 0.54)
  }
}

/** 玻璃层板上的红字「注意玻璃 防止碰头」（实拍 #10），透明底 */
function drawGlassWarning(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(190,220,226,0.25)'
  ctx.fillRect(0, 0, w, h)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#e0301e'
  ctx.font = `800 ${Math.round(h * 0.42)}px ${SANS}`
  ctx.fillText('注意玻璃  防止碰头', w / 2, h * 0.5)
}

/** XINGX 双门冷柜正面：蓝色顶灯箱 + 饮料 */
function drawFridgeFront(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#d9dee2'
  ctx.fillRect(0, 0, w, h)
  const top = h * 0.14
  const g = ctx.createLinearGradient(0, 0, w, 0)
  g.addColorStop(0, '#1a5fb8')
  g.addColorStop(1, '#3d8fe0')
  ctx.fillStyle = g
  ctx.fillRect(6, 6, w - 12, top)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#fff'
  ctx.font = `italic 900 ${Math.round(top * 0.5)}px ${SANS}`
  ctx.fillText('XINGX', w * 0.08, top * 0.55 + 6)
  const doorY = top + 18
  const doorH = h - doorY - h * 0.09
  ctx.fillStyle = '#26343c'
  ctx.fillRect(14, doorY, w - 28, doorH)
  const colors = ['#e23b2e', '#f4c430', '#2f9e5b', '#f5f0e0', '#f08a24', '#2b6cb0', '#e8e2c8']
  const rows = 4
  const rh = doorH / rows
  for (let r = 0; r < rows; r++) {
    const sy = doorY + rh * (r + 1) - 8
    ctx.fillStyle = '#9aa6ad'
    ctx.fillRect(18, sy, w - 36, 4)
    for (let c = 0; c < 9; c++) {
      const bx = 22 + c * ((w - 44) / 9)
      ctx.fillStyle = colors[(r * 4 + c) % colors.length]
      ctx.fillRect(bx, sy - rh * 0.62, (w - 44) / 9 - 6, rh * 0.62)
      ctx.fillStyle = 'rgba(255,255,255,0.4)'
      ctx.fillRect(bx + 3, sy - rh * 0.56, 4, rh * 0.5)
    }
  }
  ctx.fillStyle = 'rgba(210,230,240,0.16)'
  ctx.fillRect(14, doorY, w - 28, doorH)
  ctx.fillStyle = '#c6cdd2'
  ctx.fillRect(w / 2 - 4, doorY, 8, doorH)
  ctx.fillStyle = '#6d7880'
  ctx.fillRect(w / 2 - 18, doorY + doorH * 0.35, 6, doorH * 0.25)
  ctx.fillRect(w / 2 + 12, doorY + doorH * 0.35, 6, doorH * 0.25)
}

/** 白色圆挂钟 */
function drawClock(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#c9a24a'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#f8f6f0'
  ctx.beginPath()
  ctx.arc(w / 2, h / 2, w * 0.44, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#222'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${Math.round(w * 0.09)}px ${SANS}`
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2
    ctx.fillText(String(i), w / 2 + Math.sin(a) * w * 0.35, h / 2 - Math.cos(a) * w * 0.35)
  }
  ctx.strokeStyle = '#222'
  ctx.lineWidth = w * 0.03
  ctx.beginPath()
  ctx.moveTo(w / 2, h / 2)
  ctx.lineTo(w / 2 + w * 0.16, h / 2 - w * 0.12)
  ctx.moveTo(w / 2, h / 2)
  ctx.lineTo(w / 2 - w * 0.04, h / 2 - w * 0.3)
  ctx.stroke()
}

/** 分色纸质粉票：粉 / 浅蓝 / 白三色票本（实拍 #12）；票面只印店名，面额对应关系未核实不印 */
function drawTicketPad(bg: string): Draw {
  return (ctx, w, h) => {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)
    const rows = 4
    const rh = h / rows
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let r = 0; r < rows; r++) {
      const y = r * rh
      ctx.strokeStyle = 'rgba(60,60,80,0.35)'
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(0, y + rh)
      ctx.lineTo(w, y + rh)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#2b2b3a'
      ctx.font = `900 ${Math.round(rh * 0.36)}px ${SERIF}`
      ctx.fillText('田源米粉', w * 0.5, y + rh * 0.5)
      ctx.strokeStyle = 'rgba(178,40,30,0.7)'
      ctx.lineWidth = 3
      ctx.strokeRect(w * 0.8, y + rh * 0.25, rh * 0.42, rh * 0.42)
    }
  }
}

/** 后厨账房扩店图纸：蓝底白线，画出本店前厅 / 出餐线 / 后厨三段 */
function drawBlueprint(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#1f4f8a'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'
  ctx.lineWidth = 1
  for (let x = 0; x < w; x += 16) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }
  for (let y = 0; y < h; y += 16) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }
  ctx.strokeStyle = '#f4f7fb'
  ctx.lineWidth = 3
  const x0 = w * 0.1
  const x1 = w * 0.9
  const y0 = h * 0.18
  const y1 = h * 0.86
  ctx.beginPath()
  ctx.moveTo(x0, y1)
  ctx.lineTo(x0, y0)
  ctx.lineTo(x1, y0)
  ctx.lineTo(x1, y1 - h * 0.2)
  ctx.arc(x1 - h * 0.2, y1 - h * 0.2, h * 0.2, 0, Math.PI / 2)
  ctx.closePath()
  ctx.stroke()
  const mid = x0 + (x1 - x0) * 0.5
  ctx.beginPath()
  ctx.moveTo(mid, y0)
  ctx.lineTo(mid, y0 + (y1 - y0) * 0.35)
  ctx.moveTo(mid, y0 + (y1 - y0) * 0.55)
  ctx.lineTo(mid, y1)
  ctx.stroke()
  ctx.fillStyle = '#f4f7fb'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `800 ${Math.round(h * 0.09)}px ${SANS}`
  ctx.fillText('后厨', (x0 + mid) / 2, (y0 + y1) / 2)
  ctx.fillText('前厅', (mid + x1) / 2, (y0 + y1) / 2)
}


/** 砧板：年轮 + 刀痕 */
function drawChoppingBlock(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#5a3a22'
  ctx.fillRect(0, 0, w, h)
  for (let r = w * 0.48; r > 6; r -= 8) {
    ctx.strokeStyle = r % 16 < 8 ? 'rgba(30,16,6,0.35)' : 'rgba(150,100,60,0.2)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2)
    ctx.stroke()
  }
  const rand = seeded(173)
  ctx.strokeStyle = 'rgba(200,170,130,0.3)'
  ctx.lineWidth = 1.2
  for (let i = 0; i < 70; i++) {
    const x = w * (0.25 + rand() * 0.5)
    const y = h * (0.25 + rand() * 0.5)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + 30 * Math.cos(rand()), y + 8 * (rand() - 0.5))
    ctx.stroke()
  }
}

/** 蒸汽粒子：柔边白点 */
function drawSteamDot(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h)
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
  g.addColorStop(0, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.45, 'rgba(250,250,246,0.42)')
  g.addColorStop(1, 'rgba(250,250,246,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

// ───────────────────────────── 材质包 ─────────────────────────────

function bindAtmo<T extends THREE.Material>(mat: T): T {
  mat.onBeforeCompile = shader => shareAtmosphere(shader)
  return mat
}

function applyAtmoAndName<T extends THREE.Material>(mat: T, name: string, tiled: boolean): T {
  mat.name = name
  mat.userData.tiled = tiled
  if (/_signs$/.test(name)) nightLit(mat)
  else bindAtmo(mat)
  return mat
}

function buildPbrMaterial(
  pool: THREE.Texture[],
  spec: PbrSpec,
  defaultName: string,
  opts: TiledPbrOptions = {},
  sharedMaps?: {map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture},
): THREE.MeshStandardMaterial {
  const isTiled = opts.tiled ?? spec.tiled ?? true
  const period = opts.periodM ?? spec.periodM
  const repeat = opts.repeat ?? (opts.periodM ? undefined : !isTiled ? spec.repeat : undefined)
  const map = sharedMaps?.map ?? texAsset(pool, spec.albedo, period, 'albedo', repeat)
  const normalMap = sharedMaps?.normalMap ?? texAsset(pool, spec.normal, period, 'normal', repeat)
  const roughnessMap = sharedMaps?.roughnessMap ?? texAsset(pool, spec.roughness, period, 'roughness', repeat)
  const ns = opts.normalScale ?? spec.normalScale ?? 0.8
  const m = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(ns, ns),
    roughnessMap,
    roughness: opts.roughness ?? 1,
    metalness: Math.min(MAX_METALNESS, Math.max(0, opts.metalness ?? spec.metalness ?? 0)),
    ...(opts.color !== undefined ? {color: opts.color} : {}),
    ...(opts.emissive !== undefined ? {emissive: opts.emissive} : {}),
    ...(opts.emissiveIntensity !== undefined ? {emissiveIntensity: opts.emissiveIntensity} : {}),
    ...(opts.side !== undefined ? {side: opts.side} : spec.side !== undefined ? {side: spec.side} : {}),
    ...(opts.transparent !== undefined ? {transparent: opts.transparent} : spec.transparent !== undefined ? {transparent: spec.transparent} : {}),
    ...(opts.opacity !== undefined ? {opacity: opts.opacity} : spec.opacity !== undefined ? {opacity: spec.opacity} : {}),
  })
  m.userData.periodM = period
  return applyAtmoAndName(m, opts.name ?? defaultName, isTiled)
}

/** 释放单次工厂创建材质及附带 PBR 贴图（TianyuanMaterialPack 请调用 pack.dispose()） */
export function disposeMifenMaterial(mat: THREE.Material): void {
  if (mat instanceof THREE.MeshStandardMaterial) {
    mat.map?.dispose()
    mat.normalMap?.dispose()
    mat.roughnessMap?.dispose()
    if (mat.emissiveMap && mat.emissiveMap !== mat.map) mat.emissiveMap.dispose()
  }
  mat.dispose()
}

export function createWoodMaterial(variant: WoodVariant = 'cedar', opts: TiledPbrOptions = {}): THREE.MeshStandardMaterial {
  const pool: THREE.Texture[] = []
  return buildPbrMaterial(pool, WOOD_SPECS[variant], `tianyuan_wood_${variant}`, opts)
}

export function createTileMaterial(variant: TileVariant = 'hall_wall', opts: TiledPbrOptions = {}): THREE.MeshStandardMaterial {
  const pool: THREE.Texture[] = []
  return buildPbrMaterial(pool, TILE_SPECS[variant], `tianyuan_tile_${variant}`, opts)
}

export function createStainlessMaterial(variant: StainlessVariant = 'brushed', opts: TiledPbrOptions = {}): THREE.MeshStandardMaterial {
  const pool: THREE.Texture[] = []
  return buildPbrMaterial(pool, STAINLESS_SPECS[variant], `tianyuan_steel_${variant}`, opts)
}

export function createConcreteMaterial(variant: ConcreteVariant = 'plaster', opts: TiledPbrOptions = {}): THREE.MeshStandardMaterial {
  const pool: THREE.Texture[] = []
  return buildPbrMaterial(pool, CONCRETE_SPECS[variant], `tianyuan_concrete_${variant}`, opts)
}

export function createCurtainMaterial(variant: CurtainVariant = 'stripe_vinyl', opts: TiledPbrOptions = {}): THREE.MeshStandardMaterial {
  const pool: THREE.Texture[] = []
  return buildPbrMaterial(pool, CURTAIN_SPECS[variant], `tianyuan_curtain_${variant}`, opts)
}

export function createIngredientMaterial(variant: IngredientVariant = 'noodle', opts: TiledPbrOptions = {}): THREE.MeshStandardMaterial {
  const pool: THREE.Texture[] = []
  return buildPbrMaterial(pool, INGREDIENT_SPECS[variant], `tianyuan_food_${variant}`, opts)
}

export function createCondimentMaterial(variant: CondimentVariant = 'scallion', opts: TiledPbrOptions = {}): THREE.MeshStandardMaterial {
  const pool: THREE.Texture[] = []
  return buildPbrMaterial(pool, CONDIMENT_SPECS[variant], `tianyuan_cond_${variant}`, opts)
}

function createPack(): TianyuanMaterialPack {
  const tex: THREE.Texture[] = []
  const mats: THREE.Material[] = []

  const std = (name: string, params: THREE.MeshStandardMaterialParameters, tiled = false): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({
      metalness: 0,
      roughness: 0.85,
      ...params,
      ...(params.metalness !== undefined ? {metalness: Math.min(MAX_METALNESS, Math.max(0, params.metalness))} : {}),
    })
    applyAtmoAndName(m, name, tiled)
    mats.push(m)
    return m
  }
  const pbr = (name: string, spec: PbrSpec, opts: TiledPbrOptions = {}, sharedMaps?: {map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture}) => {
    const m = buildPbrMaterial(tex, spec, name, {...opts, name}, sharedMaps)
    mats.push(m)
    return m
  }
  const signTex = (w: number, h: number, draw: Draw) => canvasTex(tex, w, h, draw)
  /** 室内牌匾：白天看贴图本色，夜里按 updateNight 抬亮；木匾叠木纹法线/粗糙度 */
  const board = (name: string, map: THREE.Texture, roughness = 0.65, woodRelief = false) =>
    std(name, {
      map,
      roughness,
      emissive: 0xffffff,
      emissiveMap: map,
      emissiveIntensity: 0,
      ...(woodRelief
        ? {
            normalMap: texAsset(tex, TEX.woodDarkNormal, [1, 1], 'normal'),
            normalScale: new THREE.Vector2(0.3, 0.3),
            roughnessMap: texAsset(tex, TEX.woodDarkRoughness, [1, 1], 'roughness'),
            roughness: 1,
          }
        : {}),
    })

  // 共享微观塑料/烤漆微纹，消灭纯色道具塑料感
  const plasticMaps = {
    map: texAsset(tex, TEX.plasticMicroAlbedo, [0.35, 0.35], 'albedo'),
    normalMap: texAsset(tex, TEX.plasticGrainNormal, [0.35, 0.35], 'normal'),
    roughnessMap: texAsset(tex, TEX.plasticGrainRoughness, [0.35, 0.35], 'roughness'),
  }
  const powderNormal = texAsset(tex, TEX.metalPowderNormal, [0.6, 0.6], 'normal')
  const powderRough = texAsset(tex, TEX.metalPowderRoughness, [0.6, 0.6], 'roughness')
  const powder = (name: string, color: THREE.ColorRepresentation, albedoUrl: string, metalness = 0.15, period: PeriodM = [0.6, 0.6]) => {
    const m = std(
      name,
      {
        color,
        map: texAsset(tex, albedoUrl, period, 'albedo'),
        normalMap: powderNormal,
        normalScale: new THREE.Vector2(0.5, 0.5),
        roughnessMap: powderRough,
        roughness: 1,
        metalness,
      },
      true,
    )
    m.userData.periodM = period
    return m
  }

  // 杉木三处共用同套 PBR 贴图
  const cedarShared = {
    map: texAsset(tex, WOOD_SPECS.cedar.albedo, WOOD_SPECS.cedar.periodM, 'albedo'),
    normalMap: texAsset(tex, WOOD_SPECS.cedar.normal, WOOD_SPECS.cedar.periodM, 'normal'),
    roughnessMap: texAsset(tex, WOOD_SPECS.cedar.roughness, WOOD_SPECS.cedar.periodM, 'roughness'),
  }
  const facadeWood = pbr('tianyuan_facade_cedar', WOOD_SPECS.cedar, {emissive: 0xffd296, emissiveIntensity: 0}, cedarShared)
  facadeWood.emissiveMap = cedarShared.map
  const soffitWood = pbr('tianyuan_soffit_cedar', WOOD_SPECS.cedar, {emissive: 0xffd9a0, emissiveIntensity: 0}, cedarShared)
  soffitWood.emissiveMap = cedarShared.map
  const woodCladding = pbr('tianyuan_wood_cladding', WOOD_SPECS.cedar, {emissive: 0xffe2b8, emissiveIntensity: 0}, cedarShared)
  woodCladding.emissiveMap = cedarShared.map

  const glyphs = signTex(1024, 256, drawFasciaGlyphs)
  const fasciaLetters = std('tianyuan_fascia_signs', {
    map: glyphs,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    roughness: 0.4,
    emissive: 0xffe23a,
    emissiveMap: glyphs,
    emissiveIntensity: 0.45,
  })
  const roofTile = pbr('tianyuan_roll_tile', TILE_SPECS.roof_tile, {emissive: 0xffe0b0, emissiveIntensity: 0})
  const residentialWall = pbr('tianyuan_residential_wall', TILE_SPECS.residential, {emissive: 0xffe2b8, emissiveIntensity: 0})
  const residentialWindows = std(
    'tianyuan_residential_windows',
    {
      map: canvasTex(tex, 512, 512, drawResidentialWindows, [3, 2.9]),
      normalMap: texAsset(tex, TEX.tileResWallNormal, [3, 2.9], 'normal'),
      normalScale: new THREE.Vector2(0.25, 0.25),
      roughnessMap: texAsset(tex, TEX.tileResWallRoughness, [3, 2.9], 'roughness'),
      roughness: 0.9,
      emissive: 0xffc979,
      emissiveMap: canvasTex(tex, 128, 128, drawResidentialWindowsGlow, [3, 2.9]),
      emissiveIntensity: 0,
    },
    true,
  )
  const balconyGrille = std(
    'tianyuan_balcony_grille',
    {
      map: canvasTex(tex, 512, 512, drawBalconyGrille, [3, 2.9]),
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.6,
      metalness: 0.2,
      emissive: 0xffe0b4,
      emissiveIntensity: 0,
    },
    true,
  )
  const slabEdge = pbr('tianyuan_slab_edge', CONCRETE_SPECS.slab_edge, {emissive: 0xffe4bc, emissiveIntensity: 0})
  const roofDeck = pbr('tianyuan_roof_deck', CONCRETE_SPECS.roof_deck)
  const granite = pbr('tianyuan_granite', CONCRETE_SPECS.granite, {emissive: 0xffe0b8, emissiveIntensity: 0})
  const pavement = pbr('tianyuan_pavers', TILE_SPECS.pavers)
  const storefrontGlass = std('tianyuan_storefront_glass', {
    map: signTex(256, 512, drawStorefrontGlass),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.12,
    metalness: 0.1,
  })
  const glassClear = std('tianyuan_glass', {color: 0xcfe3e6, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, roughness: 0.1})
  const aluminium = pbr('tianyuan_aluminium', STAINLESS_SPECS.aluminium, {emissive: 0xc4c8ca, emissiveIntensity: 0})
  const acUnit = powder('tianyuan_ac_unit', 0xe9e8e2, TEX.plasticMicroAlbedo, 0.08, [0.5, 0.5])

  const wallTileHall = pbr('tianyuan_wall_tile_hall', TILE_SPECS.hall_wall, {emissive: 0xfff0d8, emissiveIntensity: 0})
  const wallTileKitchen = pbr('tianyuan_wall_tile_kitchen', TILE_SPECS.kitchen_wall, {emissive: 0xfff4e4, emissiveIntensity: 0})
  const floorHall = pbr('tianyuan_floor_hall', TILE_SPECS.hall_floor, {emissive: 0xffe8c8, emissiveIntensity: 0})
  const floorKitchen = pbr('tianyuan_floor_kitchen', TILE_SPECS.kitchen_floor, {emissive: 0xffe8c8, emissiveIntensity: 0})
  const ceiling = pbr('tianyuan_ceiling', CONCRETE_SPECS.plaster, {emissive: 0xfff6e6, emissiveIntensity: 0})
  const ceilingLamp = std('tianyuan_ceiling_lamp', {color: 0xfbfaf4, emissive: 0xfff5e0, emissiveIntensity: 0.6, roughness: 0.4})
  const downlight = std('tianyuan_downlight', {color: 0xfffaf0, emissive: 0xffeccc, emissiveIntensity: 0.5, roughness: 0.4})
  const quartzTop = pbr('tianyuan_quartz_top', CONCRETE_SPECS.quartz, {emissive: 0xfff4e4, emissiveIntensity: 0})

  const steelNormal = texAsset(tex, TEX.steelBrushedNormal, [1, 1], 'normal')
  const steelRough = texAsset(tex, TEX.steelBrushedRoughness, [1, 1], 'roughness')
  const stainless = pbr(
    'tianyuan_stainless',
    STAINLESS_SPECS.brushed,
    {emissive: 0xfff2e2, emissiveIntensity: 0},
    {map: texAsset(tex, TEX.steelBrushedAlbedo, [1, 1], 'albedo'), normalMap: steelNormal, roughnessMap: steelRough},
  )
  const stainlessDark = pbr(
    'tianyuan_stainless_dark',
    STAINLESS_SPECS.dark,
    {emissive: 0xffecc8, emissiveIntensity: 0},
    {map: texAsset(tex, TEX.steelDarkAlbedo, [1, 1], 'albedo'), normalMap: steelNormal, roughnessMap: steelRough},
  )
  const darkWood = pbr('tianyuan_dark_wood', WOOD_SPECS.dark, {emissive: 0xffd8b0, emissiveIntensity: 0})
  const tableShared = {
    map: texAsset(tex, WOOD_SPECS.table.albedo, WOOD_SPECS.table.periodM, 'albedo'),
    normalMap: texAsset(tex, WOOD_SPECS.table.normal, WOOD_SPECS.table.periodM, 'normal'),
    roughnessMap: texAsset(tex, WOOD_SPECS.table.roughness, WOOD_SPECS.table.periodM, 'roughness'),
  }
  const tableWood = pbr('tianyuan_table_wood', WOOD_SPECS.table, {emissive: 0xffe4be, emissiveIntensity: 0}, tableShared)
  const blackMetal = powder('tianyuan_black_metal', 0xffffff, TEX.metalBlackAlbedo, 0.22, [0.8, 0.8])
  blackMetal.emissive.setHex(0xe8e4dc)
  const doorCurtain = pbr('tianyuan_door_curtain', CURTAIN_SPECS.kitchen_linen, {emissive: 0xffe8cc, emissiveIntensity: 0})
  const thermalCurtain = pbr('tianyuan_thermal_curtain', CURTAIN_SPECS.stripe_vinyl, {emissive: 0xeaf4f4, emissiveIntensity: 0})

  const interiorPlaque = board('tianyuan_interior_plaque', signTex(1024, 300, drawInteriorPlaque), 0.5, true)
  const priceMap = signTex(512, 640, drawPriceBoard)
  const priceBoard = board('tianyuan_price_board', priceMap)
  const priceLightbox = std('tianyuan_price_lightbox_signs', {map: priceMap, emissive: 0xffffff, emissiveMap: priceMap, emissiveIntensity: 0.18, roughness: 0.4})
  const menuPosters = board('tianyuan_menu_posters', signTex(1024, 256, drawMenuPosters), 0.6)
  const screenMap = signTex(512, 300, drawMenuScreen)
  const menuScreen = std('tianyuan_menu_screen_signs', {map: screenMap, emissive: 0xffffff, emissiveMap: screenMap, emissiveIntensity: 0.55, roughness: 0.3})
  const supervisionBoard = board('tianyuan_supervision_board', signTex(512, 360, drawSupervisionBoard))
  const mustEatPlaque = board('tianyuan_must_eat', signTex(256, 320, drawMustEat), 0.5, true)
  const certificate = board('tianyuan_certificate', signTex(256, 200, drawCertificate), 0.4)
  const cashierSign = board('tianyuan_cashier_sign', signTex(256, 96, badge('#1f8a4c', '#ffffff', '收银台')))
  const toppingsSign = board('tianyuan_toppings_sign', signTex(384, 112, badge('#b3261e', '#fff6dc', '小料自助', '#f2cf66')))
  const kitchenDoorSign = board('tianyuan_kitchen_sign', signTex(384, 112, badge('#f4f1e8', '#b3261e', '后厨重地 闲人免进', '#b3261e')))
  const glassWarning = std('tianyuan_glass_warning', {
    map: signTex(1024, 96, drawGlassWarning),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.15,
  })
  const stepWarning = std('tianyuan_step_warning', {map: signTex(512, 64, badge('#f6f3ea', '#d0281c', '注意台阶  防止跌倒')), roughness: 0.6})
  const streetPlate = std('tianyuan_street_plate', {map: signTex(320, 160, badge('#1d5aa6', '#ffffff', '三多路 28', '#ffffff')), roughness: 0.5, metalness: 0.2})
  const fridgeMap = signTex(512, 1024, drawFridgeFront)
  const fridgeFront = std('tianyuan_fridge_front', {map: fridgeMap, emissive: 0xffffff, emissiveMap: fridgeMap, emissiveIntensity: 0.12, roughness: 0.25, metalness: 0.15})
  const fridgeBody = powder('tianyuan_fridge_body', 0xd5dadd, TEX.plasticMicroAlbedo, 0.15, [0.6, 0.6])
  fridgeBody.emissive.setHex(0xd5dadd)
  const wallClock = std('tianyuan_wall_clock', {map: signTex(256, 256, drawClock), roughness: 0.4})
  const blueprint = board('tianyuan_blueprint', signTex(384, 256, drawBlueprint))

  const choppingBlock = std('tianyuan_chopping_block', {
    map: signTex(256, 256, drawChoppingBlock),
    normalMap: tableShared.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: tableShared.roughnessMap,
    roughness: 1,
    emissive: 0xffe4be,
    emissiveIntensity: 0,
  })
  const ticketPink = std('tianyuan_ticket_pink', {map: signTex(256, 384, drawTicketPad('#f4a7c7')), roughness: 0.9, emissive: 0xffffff, emissiveIntensity: 0})
  const ticketBlue = std('tianyuan_ticket_blue', {map: signTex(256, 384, drawTicketPad('#a6dfe8')), roughness: 0.9, emissive: 0xffffff, emissiveIntensity: 0})
  const ticketWhite = std('tianyuan_ticket_white', {map: signTex(256, 384, drawTicketPad('#f7f7f4')), roughness: 0.9, emissive: 0xffffff, emissiveIntensity: 0})
  const plasticProp = (name: string, color: THREE.ColorRepresentation, roughness = 0.95, metalness = 0) =>
    std(
      name,
      {
        color,
        map: plasticMaps.map,
        normalMap: plasticMaps.normalMap,
        normalScale: new THREE.Vector2(0.45, 0.45),
        roughnessMap: plasticMaps.roughnessMap,
        roughness,
        metalness,
        emissive: color,
        emissiveIntensity: 0,
      },
      true,
    )
  const clipboard = plasticProp('tianyuan_clipboard', 0x3d6f86, 0.85)
  const stoolWood = pbr('tianyuan_stool_wood', WOOD_SPECS.table, {emissive: 0xffe4be, emissiveIntensity: 0}, tableShared)
  const stoolRed = plasticProp('tianyuan_stool_red', 0xc5342b, 0.95)
  const stoolBlue = plasticProp('tianyuan_stool_blue', 0x2a62b0, 0.95)
  const crateBlue = plasticProp('tianyuan_crate_blue', 0x2c64b8, 1)
  const crateGreen = plasticProp('tianyuan_crate_green', 0x2a9a7a, 1)
  const whitePlastic = plasticProp('tianyuan_white_plastic', 0xeeece6, 0.92)
  const rubber = plasticProp('tianyuan_rubber', 0x232527, 1.25)
  const scooterShell = plasticProp('tianyuan_scooter_shell', 0xe7e9ea, 0.55, 0.1)
  const scooterPlate = plasticProp('tianyuan_scooter_plate', 0x2f8f52, 0.8)
  const plantLeaf = std('tianyuan_plant_leaf', {color: 0x3e7a34, roughness: 0.8})
  const lanternRed = std('tianyuan_lantern_signs', {color: 0xd6281e, roughness: 0.6, emissive: 0xff3020, emissiveIntensity: 0.08})
  const gasFlame = std('tianyuan_gas_flame', {color: 0x2f5bff, emissive: 0x4a7dff, emissiveIntensity: 0.6, roughness: 0.6})
  const cookingOil = std('tianyuan_cooking_oil', {color: 0x8a5a14, roughness: 0.15, metalness: 0.1})

  const noodle = pbr('tianyuan_noodle', INGREDIENT_SPECS.noodle, {emissive: 0xfff2dc, emissiveIntensity: 0})
  const guoshao = pbr('tianyuan_guoshao', INGREDIENT_SPECS.guoshao, {emissive: 0xfff0d4, emissiveIntensity: 0})
  const beef = pbr('tianyuan_beef', INGREDIENT_SPECS.beef, {emissive: 0xffe8cc, emissiveIntensity: 0})
  const charsiu = pbr('tianyuan_charsiu', INGREDIENT_SPECS.charsiu, {emissive: 0xffe8cc, emissiveIntensity: 0})
  const braisedEgg = pbr('tianyuan_braised_egg', INGREDIENT_SPECS.egg, {emissive: 0xffe8cc, emissiveIntensity: 0})
  const youtiao = pbr('tianyuan_youtiao', INGREDIENT_SPECS.youtiao, {emissive: 0xfff0d4, emissiveIntensity: 0})
  const brine = pbr('tianyuan_brine', INGREDIENT_SPECS.brine, {emissive: 0xffd8b0, emissiveIntensity: 0})
  const boneBroth = pbr('tianyuan_bone_broth', INGREDIENT_SPECS.soup, {emissive: 0xfff4e0, emissiveIntensity: 0})
  const boilingWater = std('tianyuan_boiling_water', {color: 0xd8e2df, roughness: 0.08, metalness: 0.05, transparent: true, opacity: 0.9})
  const condiments = (recipes.condiments ?? []).map(c => {
    const spec = (CONDIMENT_SPECS as Record<string, PbrSpec>)[c.id]
    if (spec) {
      return pbr(`tianyuan_cond_${c.id}`, spec, {emissive: 0xfff2dc, emissiveIntensity: 0})
    }
    return std(`tianyuan_cond_${c.id}`, {color: new THREE.Color(c.color), emissive: new THREE.Color(c.color), emissiveIntensity: 0, roughness: /oil/.test(c.id) ? 0.2 : 0.6})
  })

  const steam = new THREE.PointsMaterial({
    map: signTex(64, 64, drawSteamDot),
    size: 0.55,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
  })
  steam.name = 'tianyuan_steam'
  bindAtmo(steam)
  mats.push(steam)

  const nightBoards = [interiorPlaque, priceBoard, menuPosters, supervisionBoard, mustEatPlaque, certificate, cashierSign, toppingsSign, kitchenDoorSign, blueprint]
  // 店里日光灯全天开着，室内面没有动态光源可吃：自发光 = 自身贴图 ×（白天底光 + 夜间增量）；外立面高层与瓦檐仅夜间微补街灯余光 (day=0)
  const litSurfaces: [THREE.MeshStandardMaterial, number, number][] = [
    [ceiling, 0.62, 0.2],
    [wallTileHall, 0.3, 0.12],
    [wallTileKitchen, 0.34, 0.14],
    [floorHall, 0.14, 0.12],
    [floorKitchen, 0.12, 0.1],
    [woodCladding, 0.2, 0.12],
    [quartzTop, 0.24, 0.14],
    [stainless, 0.26, 0.1],
    [stainlessDark, 0.28, 0.26],
    [aluminium, 0.2, 0.08],
    [soffitWood, 0.1, 0.32],
    [facadeWood, 0, 0.16],
    [residentialWall, 0, 0.24],
    [balconyGrille, 0, 0.18],
    [slabEdge, 0, 0.26],
    [roofTile, 0, 0.34],
    [granite, 0, 0.12],
    [darkWood, 0.12, 0.08],
    [tableWood, 0.14, 0.1],
    [stoolWood, 0.14, 0.1],
    [blackMetal, 0.1, 0.06],
    [fridgeBody, 0.18, 0.12],
    [doorCurtain, 0.16, 0.12],
    [thermalCurtain, 0.16, 0.12],
    [choppingBlock, 0.16, 0.1],
    [ticketPink, 0.2, 0.12],
    [ticketBlue, 0.2, 0.12],
    [ticketWhite, 0.2, 0.12],
    [clipboard, 0.14, 0.1],
    [stoolRed, 0.14, 0.1],
    [stoolBlue, 0.14, 0.1],
    [crateBlue, 0.14, 0.1],
    [crateGreen, 0.12, 0.09],
    [whitePlastic, 0.2, 0.14],
    [noodle, 0.22, 0.14],
    [guoshao, 0.2, 0.12],
    [beef, 0.18, 0.12],
    [charsiu, 0.18, 0.12],
    [braisedEgg, 0.18, 0.12],
    [youtiao, 0.18, 0.12],
    [brine, 0.14, 0.1],
    [boneBroth, 0.2, 0.12],
    ...condiments.map((c): [THREE.MeshStandardMaterial, number, number] => [c, 0.2, 0.14]),
  ]
  for (const [m] of litSurfaces) m.emissiveMap ??= m.map

  function updateNight(night: number, boiling = false, time = 0) {
    const n = THREE.MathUtils.clamp(night, 0, 1)
    for (const [m, day, k] of litSurfaces) m.emissiveIntensity = day + n * k
    for (const m of nightBoards) m.emissiveIntensity = 0.12 + n * 0.3
    ceilingLamp.emissiveIntensity = 0.6 + n * 1.4
    downlight.emissiveIntensity = 0.5 + n * 2.2
    fridgeFront.emissiveIntensity = 0.12 + n * 0.5
    residentialWindows.emissiveIntensity = n * 0.8
    // nightLit 已经按 atmo.uNight 点亮 *_signs；外部单独给 night（如预览/过场）时补足差值
    const gap = Math.max(0, n - atmo.uNight.value)
    fasciaLetters.emissiveIntensity = 0.45 + gap * 1.6
    menuScreen.emissiveIntensity = 0.55 + gap * 0.8
    priceLightbox.emissiveIntensity = 0.18 + gap * 0.9
    lanternRed.emissiveIntensity = 0.08 + gap * 1.2
    const flicker = 0.5 + 0.5 * Math.sin(time * (boiling ? 13 : 5))
    gasFlame.emissiveIntensity = boiling ? 1.4 + flicker * 0.8 : 0.45 + flicker * 0.15
    steam.opacity = boiling ? 0.85 : 0.6
  }
  updateNight(0)

  function dispose() {
    for (const m of mats) m.dispose()
    for (const t of tex) t.dispose()
  }

  return {
    facadeWood,
    soffitWood,
    fasciaLetters,
    roofTile,
    residentialWall,
    residentialWindows,
    balconyGrille,
    slabEdge,
    roofDeck,
    granite,
    pavement,
    storefrontGlass,
    glassClear,
    aluminium,
    acUnit,
    wallTileHall,
    wallTileKitchen,
    floorHall,
    floorKitchen,
    ceiling,
    ceilingLamp,
    downlight,
    woodCladding,
    quartzTop,
    stainless,
    stainlessDark,
    darkWood,
    tableWood,
    blackMetal,
    doorCurtain,
    thermalCurtain,
    interiorPlaque,
    priceBoard,
    priceLightbox,
    menuPosters,
    menuScreen,
    supervisionBoard,
    mustEatPlaque,
    certificate,
    cashierSign,
    toppingsSign,
    kitchenDoorSign,
    glassWarning,
    stepWarning,
    streetPlate,
    fridgeFront,
    fridgeBody,
    wallClock,
    blueprint,
    choppingBlock,
    ticketPink,
    ticketBlue,
    ticketWhite,
    clipboard,
    stoolWood,
    stoolRed,
    stoolBlue,
    crateBlue,
    crateGreen,
    whitePlastic,
    rubber,
    scooterShell,
    scooterPlate,
    plantLeaf,
    lanternRed,
    gasFlame,
    cookingOil,
    noodle,
    guoshao,
    beef,
    charsiu,
    braisedEgg,
    youtiao,
    brine,
    boneBroth,
    boilingWater,
    condiments,
    steam,
    updateNight,
    dispose,
  }
}

let shared: TianyuanMaterialPack | null = null
let users = 0

/**
 * 取共享材质包（引用计数）。扩店重建时旧店先 release、新店再 acquire，
 * 释放延后一拍执行，所以重建不会重新绘制贴图。
 */
export function acquireTianyuanMaterials(): TianyuanMaterialPack {
  shared ??= createPack()
  users++
  return shared
}

export function releaseTianyuanMaterials(): void {
  users = Math.max(0, users - 1)
  if (users > 0) return
  setTimeout(() => {
    if (users === 0 && shared) {
      shared.dispose()
      shared = null
    }
  }, 0)
}

/** 兼容旧调用：创建一份独立材质包，由调用方负责 dispose() */
export function createTianyuanMaterials(): TianyuanMaterialPack {
  return createPack()
}

export interface MifenBowlMaterialSet {
  ceramic: THREE.MeshStandardMaterial
  rim: THREE.MeshStandardMaterial
  noodle: THREE.MeshStandardMaterial
  brine: THREE.MeshStandardMaterial
  soup: THREE.MeshStandardMaterial
  sourSoup: THREE.MeshStandardMaterial
  guoshao: THREE.MeshStandardMaterial
  beef: THREE.MeshStandardMaterial
  charsiu: THREE.MeshStandardMaterial
  egg: THREE.MeshStandardMaterial
  yolk: THREE.MeshStandardMaterial
  youtiao: THREE.MeshStandardMaterial
  peanut: THREE.MeshStandardMaterial
  scallion: THREE.MeshStandardMaterial
  chili: THREE.MeshStandardMaterial
  sourBean: THREE.MeshStandardMaterial
}

/**
 * 成品碗的独立纯色材质。顾客端销毁碗时会连材质一起 dispose，所以每只碗各用一套，
 * 不借共享材质包；同参数材质共用同一着色器程序，不会重复编译。
 */
export function createBowlMaterialSet(): MifenBowlMaterialSet {
  const bowlPbr = (
    name: string,
    spec: PbrSpec,
    extra: Partial<TiledPbrOptions> = {},
  ): THREE.MeshStandardMaterial => {
    const pool: THREE.Texture[] = []
    const m = buildPbrMaterial(pool, spec, name, {
      tiled: false,
      repeat: spec.repeat ? [spec.repeat[0], spec.repeat[1]] : [1, 1],
      emissive: 0xfff0d8,
      emissiveIntensity: 0.16,
      ...extra,
    })
    m.emissiveMap = m.map
    // 兼容 customers.ts disposeObject3D：在 m.dispose() 时同步释放 normalMap / roughnessMap 防泄漏
    m.addEventListener('dispose', () => {
      for (const t of pool) t.dispose()
    })
    return m
  }
  const rimPool: THREE.Texture[] = []
  const rim = new THREE.MeshStandardMaterial({
    color: 0x2f5d9a,
    normalMap: texAsset(rimPool, TEX.bowlCeramicNormal, [0.25, 0.25], 'normal', [2, 2]),
    normalScale: new THREE.Vector2(0.3, 0.3),
    roughnessMap: texAsset(rimPool, TEX.bowlCeramicRoughness, [0.25, 0.25], 'roughness', [2, 2]),
    roughness: 1,
    metalness: 0,
    emissive: 0x2f5d9a,
    emissiveIntensity: 0.14,
  })
  rim.name = 'bowl_rim'
  bindAtmo(rim)
  rim.addEventListener('dispose', () => {
    for (const t of rimPool) t.dispose()
  })

  return {
    ceramic: bowlPbr('bowl_ceramic', INGREDIENT_SPECS.ceramic, {side: THREE.DoubleSide, repeat: [2, 2]}),
    rim,
    noodle: bowlPbr('bowl_noodle', INGREDIENT_SPECS.noodle, {repeat: [1.5, 1.5]}),
    brine: bowlPbr('bowl_brine', INGREDIENT_SPECS.brine, {repeat: [1.5, 1.5]}),
    soup: bowlPbr('bowl_soup', INGREDIENT_SPECS.soup, {repeat: [1.5, 1.5]}),
    sourSoup: bowlPbr('bowl_sour_soup', INGREDIENT_SPECS.sour_soup, {repeat: [1.5, 1.5]}),
    guoshao: bowlPbr('bowl_guoshao', INGREDIENT_SPECS.guoshao, {repeat: [1, 1]}),
    beef: bowlPbr('bowl_beef', INGREDIENT_SPECS.beef, {repeat: [1, 1]}),
    charsiu: bowlPbr('bowl_charsiu', INGREDIENT_SPECS.charsiu, {repeat: [1, 1]}),
    egg: bowlPbr('bowl_egg', INGREDIENT_SPECS.egg, {repeat: [1, 1]}),
    yolk: bowlPbr('bowl_yolk', INGREDIENT_SPECS.yolk, {repeat: [1, 1]}),
    youtiao: bowlPbr('bowl_youtiao', INGREDIENT_SPECS.youtiao, {repeat: [1.2, 1.2]}),
    peanut: bowlPbr('bowl_peanut', INGREDIENT_SPECS.peanut, {repeat: [1, 1]}),
    scallion: bowlPbr('bowl_scallion', CONDIMENT_SPECS.scallion, {repeat: [1.4, 1.4]}),
    chili: bowlPbr('bowl_chili', CONDIMENT_SPECS.pickled_chili, {repeat: [1.4, 1.4]}),
    sourBean: bowlPbr('bowl_sour_bean', CONDIMENT_SPECS.sour_long_beans, {repeat: [1.4, 1.4]}),
  }
}
