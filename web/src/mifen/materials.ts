import * as THREE from 'three'
import {bindAtmo,bindVcEmissive,bindSurfaceMaster,SHOP_SURF_NIGHT,type SurfLayer} from './shader-binders'
export {bindVcEmissive,SHOP_SURF_NIGHT} from './shader-binders'
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

  /** 合批主材质（shop-mesh Batch 自动按 userData.batchTarget 归并，大幅压低 draw calls） */
  batchMasters?: {
    vcMetal: THREE.MeshStandardMaterial
    vcWood: THREE.MeshStandardMaterial
    vcStone: THREE.MeshStandardMaterial
    vcPlastic: THREE.MeshStandardMaterial
    vcFood: THREE.MeshStandardMaterial
    vcEmissive: THREE.MeshStandardMaterial
    vcExterior: THREE.MeshStandardMaterial
    vcGlass: THREE.MeshStandardMaterial
    signAtlas: THREE.MeshStandardMaterial
    signAtlasLit: THREE.MeshStandardMaterial
  }

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
const sharedSourceTexCache = new Map<string, THREE.Texture>()
const sharedVariantTexCache = new Map<string, THREE.Texture>()

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
  tex.anisotropy = 2
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(repeat[0], repeat[1])
  } else if (periodM) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(1 / periodM[0], 1 / periodM[1])
  }
  return tex
}

/** 全局 URL 纹理缓存：同 URL 只上传 1 次 GPU 贴图，不同 repeat 通过 clone() 共享底层 source */
function texAsset(pool: THREE.Texture[], url: string, periodM?: PeriodM, kind: TexKind = 'albedo', repeat?: PeriodM): THREE.Texture {
  const rx = repeat ? repeat[0] : periodM ? 1 / periodM[0] : 1
  const ry = repeat ? repeat[1] : periodM ? 1 / periodM[1] : 1
  const wrapKey = repeat || periodM ? 'R' : 'C'
  const variantKey = `${url}|${kind}|${wrapKey}|${rx.toFixed(3)},${ry.toFixed(3)}`
  const hit = sharedVariantTexCache.get(variantKey)
  if (hit) return hit

  const baseKey = `${url}|${kind}`
  let base = sharedSourceTexCache.get(baseKey)
  if (!base) {
    if (typeof document !== 'undefined') {
      texLoader ??= new THREE.TextureLoader()
      base = texLoader.load(url)
    } else {
      const px =
        kind === 'normal'
          ? new Uint8Array([128, 128, 255, 255])
          : kind === 'roughness'
            ? new Uint8Array([180, 180, 180, 255])
            : new Uint8Array([214, 204, 186, 255])
      base = new THREE.DataTexture(px, 1, 1)
      base.needsUpdate = true
    }
    base.userData.sourceUrl = url
    base.userData.sharedCached = true
    configureTex(base, periodM, kind, repeat)
    sharedSourceTexCache.set(baseKey, base)
    sharedVariantTexCache.set(variantKey, base)
    void pool
    return base
  }

  const cloned = base.clone()
  cloned.source = base.source
  cloned.userData.sourceUrl = url
  cloned.userData.sharedCached = true
  configureTex(cloned, periodM, kind, repeat)
  if (!base.image || base.image.complete !== false) cloned.needsUpdate = true
  sharedVariantTexCache.set(variantKey, cloned)
  void pool
  return cloned
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

function applyAtmoAndName<T extends THREE.Material>(mat: T, name: string, tiled: boolean): T {
  mat.name = name
  mat.userData.tiled = tiled
  if (/_signs$/.test(name)) nightLit(mat)
  else if (mat.vertexColors) bindVcEmissive(mat)
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

/** 释放单次工厂创建材质及非共享贴图（共享缓存贴图永不在此销毁） */
export function disposeMifenMaterial(mat: THREE.Material): void {
  if (mat.userData?.sharedCached) return
  if (mat instanceof THREE.MeshStandardMaterial) {
    if (mat.map && !mat.map.userData?.sharedCached) mat.map.dispose()
    if (mat.normalMap && !mat.normalMap.userData?.sharedCached) mat.normalMap.dispose()
    if (mat.roughnessMap && !mat.roughnessMap.userData?.sharedCached) mat.roughnessMap.dispose()
    if (mat.emissiveMap && mat.emissiveMap !== mat.map && !mat.emissiveMap.userData?.sharedCached) mat.emissiveMap.dispose()
  }
  mat.dispose()
}

function buildCompactPbr(
  spec: PbrSpec,
  defaultName: string,
  opts: TiledPbrOptions = {},
  useNormalRough = false,
): THREE.MeshStandardMaterial {
  const isTiled = opts.tiled ?? spec.tiled ?? true
  const period = opts.periodM ?? spec.periodM
  const repeat = opts.repeat ?? (opts.periodM ? undefined : !isTiled ? spec.repeat : undefined)
  const pool: THREE.Texture[] = []
  const map = texAsset(pool, spec.albedo, period, 'albedo', repeat)
  const normalMap = useNormalRough ? texAsset(pool, spec.normal, period, 'normal', repeat) : undefined
  const roughnessMap = useNormalRough ? texAsset(pool, spec.roughness, period, 'roughness', repeat) : undefined
  const ns = opts.normalScale ?? spec.normalScale ?? 0.75
  const m = new THREE.MeshStandardMaterial({
    map,
    ...(normalMap ? {normalMap, normalScale: new THREE.Vector2(ns, ns)} : {}),
    ...(roughnessMap ? {roughnessMap} : {}),
    roughness: opts.roughness ?? (roughnessMap ? 1 : 0.78),
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

export function createWoodMaterial(variant: WoodVariant = 'cedar', opts: TiledPbrOptions = {}): THREE.MeshStandardMaterial {
  return buildCompactPbr(WOOD_SPECS[variant], `tianyuan_wood_${variant}`, opts, variant === 'cedar')
}

export function createTileMaterial(variant: TileVariant = 'hall_wall', opts: TiledPbrOptions = {}): THREE.MeshStandardMaterial {
  return buildCompactPbr(TILE_SPECS[variant], `tianyuan_tile_${variant}`, opts, variant === 'hall_wall' || variant === 'hall_floor')
}

export function createStainlessMaterial(variant: StainlessVariant = 'brushed', opts: TiledPbrOptions = {}): THREE.MeshStandardMaterial {
  return buildCompactPbr(STAINLESS_SPECS[variant], `tianyuan_steel_${variant}`, opts, variant === 'brushed')
}

export function createConcreteMaterial(variant: ConcreteVariant = 'plaster', opts: TiledPbrOptions = {}): THREE.MeshStandardMaterial {
  return buildCompactPbr(CONCRETE_SPECS[variant], `tianyuan_concrete_${variant}`, opts, false)
}

export function createCurtainMaterial(variant: CurtainVariant = 'stripe_vinyl', opts: TiledPbrOptions = {}): THREE.MeshStandardMaterial {
  return buildCompactPbr(CURTAIN_SPECS[variant], `tianyuan_curtain_${variant}`, opts, false)
}

export function createIngredientMaterial(variant: IngredientVariant = 'noodle', opts: TiledPbrOptions = {}): THREE.MeshStandardMaterial {
  return buildCompactPbr(INGREDIENT_SPECS[variant], `tianyuan_food_${variant}`, opts, false)
}

export function createCondimentMaterial(variant: CondimentVariant = 'scallion', opts: TiledPbrOptions = {}): THREE.MeshStandardMaterial {
  return buildCompactPbr(CONDIMENT_SPECS[variant], `tianyuan_cond_${variant}`, opts, false)
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

  // 1) 共享低显存贴图与 1024×1024 统一招牌图集（16 张牌匾/菜单/冰柜/票据合并为 1 张 4MB 贴图 + 1~2 draw calls）
  const ATLAS_W = 1024
  const ATLAS_H = 1024
  const atlasRects: Record<string, [number, number, number, number]> = {}
  const atlasSlots: Array<[string, number, number, number, number, Draw]> = [
    ['interiorPlaque', 2, 2, 508, 152, drawInteriorPlaque],
    ['menuPosters', 514, 2, 508, 152, drawMenuPosters],
    ['fridgeFront', 2, 162, 252, 508, drawFridgeFront],
    ['priceBoard', 258, 162, 252, 316, drawPriceBoard],
    ['menuScreen', 514, 162, 320, 188, drawMenuScreen],
    ['supervisionBoard', 838, 162, 184, 132, drawSupervisionBoard],
    ['blueprint', 838, 298, 184, 124, drawBlueprint],
    ['mustEatPlaque', 514, 354, 156, 196, drawMustEat],
    ['certificate', 674, 354, 160, 124, drawCertificate],
    ['wallClock', 838, 426, 160, 160, drawClock],
    ['ticketPink', 258, 482, 120, 180, drawTicketPad('#f4a7c7')],
    ['ticketBlue', 382, 482, 120, 180, drawTicketPad('#a6dfe8')],
    ['ticketWhite', 674, 482, 120, 180, drawTicketPad('#f7f7f4')],
    ['cashierSign', 2, 674, 252, 96, badge('#1f8a4c', '#ffffff', '收银台')],
    ['toppingsSign', 258, 674, 320, 96, badge('#b3261e', '#fff6dc', '小料自助', '#f2cf66')],
    ['kitchenDoorSign', 582, 674, 320, 96, badge('#f4f1e8', '#b3261e', '后厨重地 闲人免进', '#b3261e')],
    ['stepWarning', 2, 774, 420, 64, badge('#f6f3ea', '#d0281c', '注意台阶  防止跌倒')],
    ['streetPlate', 426, 774, 220, 110, badge('#1d5aa6', '#ffffff', '三多路 28', '#ffffff')],
    ['choppingBlock', 650, 774, 160, 160, drawChoppingBlock],
  ]
  const signAtlasTex = canvasTex(tex, ATLAS_W, ATLAS_H, (ctx, w, h) => {
    ctx.fillStyle = '#e8dfd0'
    ctx.fillRect(0, 0, w, h)
    for (const [key, x, y, sw, sh, drawFn] of atlasSlots) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, sw, sh)
      ctx.clip()
      ctx.translate(x, y)
      drawFn(ctx, sw, sh)
      ctx.restore()
      atlasRects[key] = [x / w, 1 - (y + sh) / h, (x + sw) / w, 1 - y / h]
    }
  })
  // Node / headless 离线环境兜底填齐 rect
  for (const [key, x, y, sw, sh] of atlasSlots) {
    atlasRects[key] ??= [x / ATLAS_W, 1 - (y + sh) / ATLAS_H, (x + sw) / ATLAS_W, 1 - y / ATLAS_H]
  }
  const signAtlasMat = std('tianyuan_sign_atlas', {
    map: signAtlasTex,
    emissive: 0xffffff,
    emissiveMap: signAtlasTex,
    emissiveIntensity: 0.16,
    roughness: 0.52,
  })
  const signAtlasLitMat = std('tianyuan_sign_atlas_signs', {
    map: signAtlasTex,
    emissive: 0xffffff,
    emissiveMap: signAtlasTex,
    emissiveIntensity: 0.45,
    roughness: 0.35,
  })

  // 2) 合批主材质（通过顶点色合并同类金属/木料/石材/塑料/食材/灯具，大幅削减 draw calls 与贴图数）
  const steelSharedMap = texAsset(tex, TEX.steelBrushedAlbedo, [1, 1], 'albedo')
  const steelSharedNormal = texAsset(tex, TEX.steelBrushedNormal, [1, 1], 'normal')
  const steelSharedRough = texAsset(tex, TEX.steelBrushedRoughness, [1, 1], 'roughness')
  const woodSharedMap = texAsset(tex, TEX.woodTableAlbedo, [1, 1], 'albedo')
  const concreteSharedMap = texAsset(tex, TEX.concretePlasterAlbedo, [2.4, 2.4], 'albedo')
  const concreteSharedNormal = texAsset(tex, TEX.concreteNormal, [2.4, 2.4], 'normal')
  const concreteSharedRough = texAsset(tex, TEX.concreteRoughness, [2.4, 2.4], 'roughness')

  const vcMetal = std(
    'tianyuan_vc_metal',
    {
      vertexColors: true,
      map: steelSharedMap,
      normalMap: steelSharedNormal,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughnessMap: steelSharedRough,
      roughness: 0.9,
      metalness: 0.25,
      emissive: 0xffeeda,
      emissiveMap: steelSharedMap,
      emissiveIntensity: 0.2,
    },
    true,
  )
  const vcWood = std(
    'tianyuan_vc_wood',
    {
      vertexColors: true,
      map: woodSharedMap,
      roughness: 0.78,
      metalness: 0.02,
      emissive: 0xffe2be,
      emissiveMap: woodSharedMap,
      emissiveIntensity: 0.16,
    },
    true,
  )
  const vcStone = std(
    'tianyuan_vc_stone',
    {
      vertexColors: true,
      map: concreteSharedMap,
      normalMap: concreteSharedNormal,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughnessMap: concreteSharedRough,
      roughness: 0.92,
      emissive: 0xfff0d8,
      emissiveMap: concreteSharedMap,
      emissiveIntensity: 0.24,
    },
    true,
  )
  const vcPlastic = std('tianyuan_vc_plastic', {
    vertexColors: true,
    roughness: 0.72,
    metalness: 0.03,
    emissive: 0xffe8cc,
    emissiveIntensity: 0.18,
    side: THREE.DoubleSide,
  })
  const vcFood = vcPlastic
  const vcEmissive = std('tianyuan_vc_emissive_signs', {
    vertexColors: true,
    roughness: 0.3,
    emissive: 0xfff2d6,
    emissiveIntensity: 0.75,
  })
  const vcExterior = std(
    'tianyuan_vc_exterior',
    {
      vertexColors: true,
      map: concreteSharedMap,
      roughness: 0.85,
      metalness: 0.08,
      emissive: 0xffe6c0,
      emissiveMap: concreteSharedMap,
      emissiveIntensity: 0.12,
      side: THREE.DoubleSide,
    },
    true,
  )
  const vcGlass = std('tianyuan_vc_glass', {
    vertexColors: true,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.12,
    metalness: 0.1,
  })

  const bindBatch = (
    m: THREE.MeshStandardMaterial,
    target: THREE.MeshStandardMaterial,
    tintHex?: number,
    atlasKey?: string,
  ): THREE.MeshStandardMaterial => {
    m.userData.batchTarget = target
    if (tintHex !== undefined) m.userData.batchColor = tintHex
    if (atlasKey && atlasRects[atlasKey]) m.userData.atlasRect = atlasRects[atlasKey]
    return m
  }

  // 3) 核心建筑主材（保留原生平铺贴图，确保三多路实景辨识度 100% 不降级）
  const cedarShared = {
    map: texAsset(tex, WOOD_SPECS.cedar.albedo, WOOD_SPECS.cedar.periodM, 'albedo'),
    normalMap: texAsset(tex, WOOD_SPECS.cedar.normal, WOOD_SPECS.cedar.periodM, 'normal'),
    roughnessMap: texAsset(tex, WOOD_SPECS.cedar.roughness, WOOD_SPECS.cedar.periodM, 'roughness'),
  }
  const facadeWood = pbr('tianyuan_facade_cedar', WOOD_SPECS.cedar, {emissive: 0xffd296, emissiveIntensity: 0}, cedarShared)
  facadeWood.emissiveMap = cedarShared.map
  const soffitWood = bindBatch(
    pbr('tianyuan_soffit_cedar', WOOD_SPECS.cedar, {emissive: 0xffd9a0, emissiveIntensity: 0}, cedarShared),
    facadeWood,
  )
  soffitWood.userData.keepOwnTarget = facadeWood
  soffitWood.emissiveMap = cedarShared.map
  const woodCladding = bindBatch(
    pbr('tianyuan_wood_cladding', WOOD_SPECS.cedar, {emissive: 0xffe2b8, emissiveIntensity: 0}, cedarShared),
    vcWood,
    0xffffff,
  )
  woodCladding.emissiveMap = cedarShared.map
  woodCladding.userData.surfTex = 'cedar'
  woodCladding.userData.glow = [0.2, 0.12]

  const glyphs = signTex(512, 128, drawFasciaGlyphs)
  const fasciaLetters = std('tianyuan_fascia_signs', {
    map: glyphs,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    roughness: 0.4,
    emissive: 0xffe23a,
    emissiveMap: glyphs,
    emissiveIntensity: 0.45,
  })
  const roofTile = std(
    'tianyuan_roll_tile',
    {
      map: texAsset(tex, TILE_SPECS.roof_tile.albedo, TILE_SPECS.roof_tile.periodM, 'albedo'),
      roughness: 0.82,
      metalness: 0.05,
      emissive: 0xffe0b0,
      emissiveIntensity: 0,
    },
    true,
  )
  roofTile.emissiveMap = roofTile.map
  const residentialWall = std(
    'tianyuan_residential_wall',
    {
      map: texAsset(tex, TILE_SPECS.residential.albedo, TILE_SPECS.residential.periodM, 'albedo'),
      roughness: 0.88,
      emissive: 0xffe2b8,
      emissiveIntensity: 0,
    },
    true,
  )
  residentialWall.emissiveMap = residentialWall.map
  const residentialWindows = std(
    'tianyuan_residential_windows',
    {
      map: canvasTex(tex, 256, 256, drawResidentialWindows, [3, 2.9]),
      roughness: 0.85,
      emissive: 0xffc979,
      emissiveMap: canvasTex(tex, 64, 64, drawResidentialWindowsGlow, [3, 2.9]),
      emissiveIntensity: 0,
    },
    true,
  )
  const balconyGrille = std(
    'tianyuan_balcony_grille',
    {
      map: canvasTex(tex, 256, 256, drawBalconyGrille, [3, 2.9]),
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.6,
      metalness: 0.2,
      emissive: 0xffe0b4,
      emissiveIntensity: 0,
    },
    true,
  )
  const slabEdge = bindBatch(std('tianyuan_slab_edge', {color: 0xd5cebf, roughness: 0.9}, true), vcExterior, 0xd5cebf)
  slabEdge.userData.glow = [0, 0.26]
  const roofDeck = bindBatch(std('tianyuan_roof_deck', {color: 0x9b9890, roughness: 0.92}, true), vcExterior, 0x9b9890)
  const granite = bindBatch(
    std('tianyuan_granite', {map: texAsset(tex, CONCRETE_SPECS.granite.albedo, CONCRETE_SPECS.granite.periodM, 'albedo'), roughness: 0.72}, true),
    vcStone,
    0xffffff,
  )
  granite.userData.surfTex = 'granite'
  granite.userData.glow = [0, 0.12]
  const paversMap = texAsset(tex, TILE_SPECS.pavers.albedo, TILE_SPECS.pavers.periodM, 'albedo')
  const pavement = bindBatch(
    std('tianyuan_pavers', {color: 0xffffff, map: paversMap, roughness: 0.88}, true),
    vcStone,
    0xffffff,
  )
  pavement.userData.surfTex = 'pavers'
  pavement.userData.glow = [0, 0]
  const storefrontGlass = std('tianyuan_storefront_glass', {
    map: signTex(128, 256, drawStorefrontGlass),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.12,
    metalness: 0.1,
  })
  const glassClear = bindBatch(
    std('tianyuan_glass', {color: 0xcfe3e6, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, roughness: 0.1}),
    vcGlass,
    0xcfe3e6,
  )
  const aluminium = bindBatch(std('tianyuan_aluminium', {color: 0xd4d9dd, metalness: 0.26, roughness: 0.38}, true), vcMetal, 0xd4d9dd)
  const acUnit = bindBatch(std('tianyuan_ac_unit', {color: 0xe9e8e2, metalness: 0.08, roughness: 0.75}, true), vcExterior, 0xe9e8e2)

  // IDOK-305：三张主材质按顶点选层 + 自发光，找回杉木条 / 花岗岩 / 人行道砖与吊顶灯盘（不加 draw call）
  const graniteMap = granite.map as THREE.Texture
  const cedarLayer: SurfLayer = {key: 'cedar', tex: cedarShared.map, periodM: WOOD_SPECS.cedar.periodM}
  const graniteLayer: SurfLayer = {key: 'granite', tex: graniteMap, periodM: CONCRETE_SPECS.granite.periodM}
  const paversLayer: SurfLayer = {key: 'pavers', tex: paversMap, periodM: TILE_SPECS.pavers.periodM}
  bindSurfaceMaster(vcWood, [cedarLayer], [0.14, 0.1])
  bindSurfaceMaster(vcStone, [graniteLayer, paversLayer], [0.26, 0.14])
  bindSurfaceMaster(vcExterior, [cedarLayer, graniteLayer], [0.08, 0.22])
  vcExterior.emissive.setHex(0xfff2e0)
  // 被 EC/SF 统一改投 vcExterior 的金属、塑料、灯具保持纯色，并沿用原主材质的自发光
  for (const [m, glow] of [
    [vcMetal, [0.02, 0.06]],
    [vcPlastic, [0.18, 0.12]],
    [vcEmissive, [0.6, 1.4]],
  ] as const) {
    m.userData.surfTex = 'none'
    m.userData.glow = glow
  }

  // 4) 室内主墙与地砖（前厅/后厨共用 2 张高质量大理石地墙贴图 + 顶点色微调，省 4 张大贴图 + 2 draws）
  const wallTileHall = std(
    'tianyuan_wall_tile_hall',
    {
      vertexColors: true,
      map: texAsset(tex, TILE_SPECS.hall_wall.albedo, TILE_SPECS.hall_wall.periodM, 'albedo'),
      normalMap: texAsset(tex, TILE_SPECS.hall_wall.normal, TILE_SPECS.hall_wall.periodM, 'normal'),
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughness: 0.72,
      emissive: 0xfff0d8,
      emissiveIntensity: 0,
    },
    true,
  )
  wallTileHall.emissiveMap = wallTileHall.map
  const wallTileKitchen = bindBatch(
    std('tianyuan_wall_tile_kitchen', {color: 0xf4f6f4, roughness: 0.68}, true),
    wallTileHall,
    0xf5f7f4,
  )
  const floorHall = std(
    'tianyuan_floor_hall',
    {
      vertexColors: true,
      map: texAsset(tex, TILE_SPECS.hall_floor.albedo, TILE_SPECS.hall_floor.periodM, 'albedo'),
      normalMap: texAsset(tex, TILE_SPECS.hall_floor.normal, TILE_SPECS.hall_floor.periodM, 'normal'),
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughness: 0.75,
      emissive: 0xffe8c8,
      emissiveIntensity: 0,
    },
    true,
  )
  floorHall.emissiveMap = floorHall.map
  const floorKitchen = bindBatch(
    std('tianyuan_floor_kitchen', {color: 0xbcb8ae, roughness: 0.85}, true),
    floorHall,
    0xbcb8ae,
  )
  const ceiling = bindBatch(std('tianyuan_ceiling', {color: 0xf6f3eb, roughness: 0.85}, true), vcExterior, 0xf6f3eb)
  ceiling.userData.glow = [0.62, 0.2]
  const ceilingLamp = bindBatch(
    std('tianyuan_ceiling_lamp', {color: 0xfbfaf4, emissive: 0xfff5e0, emissiveIntensity: 0.6, roughness: 0.4}),
    vcEmissive,
    0xfbfaf4,
  )
  const downlight = bindBatch(
    std('tianyuan_downlight', {color: 0xfffaf0, emissive: 0xffeccc, emissiveIntensity: 0.5, roughness: 0.4}),
    vcEmissive,
    0xfffaf0,
  )
  downlight.userData.glow = [0.5, 2.2]
  const quartzTop = bindBatch(std('tianyuan_quartz_top', {color: 0xf2ede3, roughness: 0.35}, true), vcStone, 0xf2ede3)
  quartzTop.userData.glow = [0.24, 0.14]
  const stainless = bindBatch(
    std('tianyuan_stainless', {color: 0xdbe0e4, map: steelSharedMap, roughness: 0.38, metalness: 0.28, emissive: 0xfff2e2, emissiveIntensity: 0.24}, true),
    vcMetal,
    0xdbe0e4,
  )
  const stainlessDark = bindBatch(
    std('tianyuan_stainless_dark', {color: 0x8a9196, map: steelSharedMap, roughness: 0.48, metalness: 0.22, emissive: 0xffecc8, emissiveIntensity: 0.24}, true),
    vcMetal,
    0x8a9196,
  )
  const darkWood = bindBatch(
    std('tianyuan_dark_wood', {color: 0x6b4730, map: woodSharedMap, roughness: 0.78, emissive: 0xffd8b0, emissiveIntensity: 0.14}, true),
    vcWood,
    0x6b4730,
  )
  darkWood.userData.glow = [0.12, 0.08]
  const tableWood = bindBatch(
    std('tianyuan_table_wood', {color: 0xc28f5c, map: woodSharedMap, roughness: 0.72, emissive: 0xffe4be, emissiveIntensity: 0.14}, true),
    vcWood,
    0xc28f5c,
  )
  const blackMetal = bindBatch(
    std('tianyuan_black_metal', {color: 0x2c3034, roughness: 0.55, metalness: 0.22}, true),
    vcMetal,
    0x33383e,
  )
  const doorCurtain = bindBatch(std('tianyuan_door_curtain', {color: 0xc74736, roughness: 0.88, side: THREE.DoubleSide}, true), vcPlastic, 0xc74736)
  const thermalCurtain = bindBatch(
    std('tianyuan_thermal_curtain', {color: 0xdcebea, transparent: true, opacity: 0.58, depthWrite: false, side: THREE.DoubleSide, roughness: 0.3}),
    vcGlass,
    0xdcebea,
  )

  // 5) 招牌/菜牌/冰柜/票据（全部指向 1024×1024 图集）
  const atlasSign = (name: string, atlasKey: string, lit = false) =>
    bindBatch(
      std(name, {map: signAtlasTex, roughness: lit ? 0.35 : 0.55, emissive: 0xffffff, emissiveMap: signAtlasTex, emissiveIntensity: lit ? 0.45 : 0.14}),
      lit ? signAtlasLitMat : signAtlasMat,
      0xffffff,
      atlasKey,
    )
  const interiorPlaque = atlasSign('tianyuan_interior_plaque', 'interiorPlaque')
  const priceBoard = atlasSign('tianyuan_price_board', 'priceBoard')
  const priceLightbox = atlasSign('tianyuan_price_lightbox_signs', 'priceBoard', true)
  const menuPosters = atlasSign('tianyuan_menu_posters', 'menuPosters')
  const menuScreen = atlasSign('tianyuan_menu_screen_signs', 'menuScreen', true)
  const supervisionBoard = atlasSign('tianyuan_supervision_board', 'supervisionBoard')
  const mustEatPlaque = atlasSign('tianyuan_must_eat', 'mustEatPlaque')
  const certificate = atlasSign('tianyuan_certificate', 'certificate')
  const cashierSign = atlasSign('tianyuan_cashier_sign', 'cashierSign')
  const toppingsSign = atlasSign('tianyuan_toppings_sign', 'toppingsSign')
  const kitchenDoorSign = atlasSign('tianyuan_kitchen_sign', 'kitchenDoorSign')
  const glassWarning = std('tianyuan_glass_warning', {
    map: signTex(512, 64, drawGlassWarning),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.15,
  })
  const stepWarning = atlasSign('tianyuan_step_warning', 'stepWarning')
  const streetPlate = atlasSign('tianyuan_street_plate', 'streetPlate')
  const fridgeFront = atlasSign('tianyuan_fridge_front', 'fridgeFront')
  const fridgeBody = bindBatch(std('tianyuan_fridge_body', {color: 0xd5dadd, roughness: 0.65, metalness: 0.15}, true), vcPlastic, 0xd5dadd)
  const wallClock = atlasSign('tianyuan_wall_clock', 'wallClock')
  const blueprint = atlasSign('tianyuan_blueprint', 'blueprint')
  const choppingBlock = atlasSign('tianyuan_chopping_block', 'choppingBlock')
  const ticketPink = atlasSign('tianyuan_ticket_pink', 'ticketPink')
  const ticketBlue = atlasSign('tianyuan_ticket_blue', 'ticketBlue')
  const ticketWhite = atlasSign('tianyuan_ticket_white', 'ticketWhite')

  // 6) 道具（全部走 vcPlastic / vcWood / vcEmissive 合批）
  const plasticProp = (name: string, colorHex: number, roughness = 0.85, metalness = 0) =>
    bindBatch(
      std(name, {color: colorHex, roughness, metalness, emissive: colorHex, emissiveIntensity: 0.14}, true),
      vcPlastic,
      colorHex,
    )
  const clipboard = plasticProp('tianyuan_clipboard', 0x3d6f86, 0.85)
  const stoolWood = bindBatch(std('tianyuan_stool_wood', {color: 0xb98552, roughness: 0.76}, true), vcWood, 0xb98552)
  const stoolRed = plasticProp('tianyuan_stool_red', 0xc5342b, 0.9)
  const stoolBlue = plasticProp('tianyuan_stool_blue', 0x2a62b0, 0.9)
  const crateBlue = plasticProp('tianyuan_crate_blue', 0x2c64b8, 0.92)
  const crateGreen = plasticProp('tianyuan_crate_green', 0x2a9a7a, 0.92)
  const whitePlastic = plasticProp('tianyuan_white_plastic', 0xeeece6, 0.85)
  const rubber = plasticProp('tianyuan_rubber', 0x232527, 0.95)
  const scooterShell = plasticProp('tianyuan_scooter_shell', 0xe7e9ea, 0.55, 0.1)
  const scooterPlate = plasticProp('tianyuan_scooter_plate', 0x2f8f52, 0.8)
  const plantLeaf = plasticProp('tianyuan_plant_leaf', 0x3e7a34, 0.8)
  const lanternRed = bindBatch(
    std('tianyuan_lantern_signs', {color: 0xd6281e, roughness: 0.6, emissive: 0xff3020, emissiveIntensity: 0.18}),
    vcEmissive,
    0xd6281e,
  )
  const gasFlame = std('tianyuan_gas_flame', {color: 0x2f5bff, emissive: 0x4a7dff, emissiveIntensity: 0.6, roughness: 0.6})
  const cookingOil = plasticProp('tianyuan_cooking_oil', 0x8a5a14, 0.25, 0.08)

  // 7) 食材与小料（全部走 vcFood 合批，省去 57 张未压缩食材 PNG = ~21MB 显存 + 16 draw calls）
  const foodMat = (name: string, colorHex: number, roughness = 0.55) =>
    bindBatch(std(name, {color: colorHex, roughness, emissive: colorHex, emissiveIntensity: 0.16}), vcFood, colorHex)
  const noodle = foodMat('tianyuan_noodle', 0xf3ead8, 0.48)
  const guoshao = foodMat('tianyuan_guoshao', 0xb8662e, 0.52)
  const beef = foodMat('tianyuan_beef', 0x6f3524, 0.56)
  const charsiu = foodMat('tianyuan_charsiu', 0x9c3626, 0.45)
  const braisedEgg = foodMat('tianyuan_braised_egg', 0x7c4a26, 0.42)
  const youtiao = foodMat('tianyuan_youtiao', 0xd6963a, 0.58)
  const brine = foodMat('tianyuan_brine', 0x4b2416, 0.22)
  const boneBroth = foodMat('tianyuan_bone_broth', 0xe5d3ad, 0.25)
  const boilingWater = std('tianyuan_boiling_water', {color: 0xd8e2df, roughness: 0.1, metalness: 0.05, transparent: true, opacity: 0.88})
  const condiments = (recipes.condiments ?? []).map(c => {
    const col = new THREE.Color(c.color)
    return foodMat(`tianyuan_cond_${c.id}`, col.getHex(), /oil/.test(c.id) ? 0.22 : 0.6)
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

  const litSurfaces: [THREE.MeshStandardMaterial, number, number][] = [
    [wallTileHall, 0.3, 0.14],
    [floorHall, 0.14, 0.12],
    [facadeWood, 0.04, 0.22],
    [residentialWall, 0, 0.24],
    [balconyGrille, 0, 0.18],
    [roofTile, 0, 0.34],
    [vcMetal, 0.24, 0.16],
    [vcPlastic, 0.18, 0.12],
    [signAtlasMat, 0.14, 0.28],
    [stainless, 0.24, 0.12],
    [stainlessDark, 0.26, 0.24],
    [darkWood, 0.14, 0.1],
    [noodle, 0.22, 0.14],
    [guoshao, 0.2, 0.12],
    [beef, 0.18, 0.12],
    [charsiu, 0.18, 0.12],
    [braisedEgg, 0.18, 0.12],
    [youtiao, 0.18, 0.12],
    [brine, 0.16, 0.1],
    [boneBroth, 0.2, 0.12],
  ]

  function updateNight(night: number, boiling = false, time = 0) {
    const n = THREE.MathUtils.clamp(night, 0, 1)
    SHOP_SURF_NIGHT.value = n
    for (const [m, day, k] of litSurfaces) m.emissiveIntensity = day + n * k
    residentialWindows.emissiveIntensity = n * 0.8
    const gap = Math.max(0, n - atmo.uNight.value)
    fasciaLetters.emissiveIntensity = 0.45 + gap * 1.6
    signAtlasLitMat.emissiveIntensity = 0.42 + n * 0.65 + gap * 0.5
    vcEmissive.emissiveIntensity = 0.55 + n * 1.4
    lanternRed.emissiveIntensity = 0.15 + n * 0.8 + gap * 0.8
    const flicker = 0.5 + 0.5 * Math.sin(time * (boiling ? 13 : 5))
    gasFlame.emissiveIntensity = boiling ? 1.4 + flicker * 0.8 : 0.45 + flicker * 0.15
    steam.opacity = boiling ? 0.85 : 0.6
  }
  updateNight(0)

  function dispose() {
    for (const m of mats) m.dispose()
    for (const t of tex) if (!t.userData?.sharedCached) t.dispose()
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
    batchMasters: {
      vcMetal,
      vcWood,
      vcStone,
      vcPlastic,
      vcFood,
      vcEmissive,
      vcExterior,
      vcGlass,
      signAtlas: signAtlasMat,
      signAtlasLit: signAtlasLitMat,
    },
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
  /** 整碗顶点色合批共享主材质（单碗 1 draw call，0 重复贴图） */
  bowlVc?: THREE.MeshStandardMaterial
}

let sharedBowlMaterials: MifenBowlMaterialSet | null = null

/**
 * 成品碗共享只读材质池：所有顾客成品碗复用同一套材质与顶点色主材，
 * 不再为每碗粉新建 16 套材质与 48 张纹理；`userData.sharedCached = true` 防止被单碗销毁误释放。
 */
export function createBowlMaterialSet(): MifenBowlMaterialSet {
  if (sharedBowlMaterials) return sharedBowlMaterials
  const bowlVc = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.48,
    metalness: 0.02,
    emissive: 0xfff0d8,
    emissiveIntensity: 0.16,
    side: THREE.DoubleSide,
  })
  bowlVc.name = 'bowl_shared_vc'
  bowlVc.userData.sharedCached = true
  bindVcEmissive(bowlVc)

  const make = (name: string, colorHex: number, roughness = 0.5, side: THREE.Side = THREE.FrontSide) => {
    const m = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness,
      metalness: 0.02,
      emissive: colorHex,
      emissiveIntensity: 0.16,
      side,
    })
    m.name = name
    m.userData.sharedCached = true
    m.userData.batchTarget = bowlVc
    m.userData.batchColor = colorHex
    bindAtmo(m)
    return m
  }

  sharedBowlMaterials = {
    ceramic: make('bowl_ceramic', 0xf6f4ee, 0.25, THREE.DoubleSide),
    rim: make('bowl_rim', 0x2f5d9a, 0.3),
    noodle: make('bowl_noodle', 0xf3ead8, 0.48),
    brine: make('bowl_brine', 0x4b2416, 0.2),
    soup: make('bowl_soup', 0xe5d3ad, 0.22),
    sourSoup: make('bowl_sour_soup', 0xd6502c, 0.22),
    guoshao: make('bowl_guoshao', 0xb8662e, 0.5),
    beef: make('bowl_beef', 0x6f3524, 0.55),
    charsiu: make('bowl_charsiu', 0x9c3626, 0.45),
    egg: make('bowl_egg', 0x7c4a26, 0.42),
    yolk: make('bowl_yolk', 0xf0a522, 0.45),
    youtiao: make('bowl_youtiao', 0xd6963a, 0.58),
    peanut: make('bowl_peanut', 0xc97336, 0.55),
    scallion: make('bowl_scallion', 0x4f9438, 0.6),
    chili: make('bowl_chili', 0xc83022, 0.35),
    sourBean: make('bowl_sour_bean', 0x6e7b36, 0.6),
    bowlVc,
  }
  return sharedBowlMaterials
}
