import type * as THREE from 'three'
import type { CookingVisualState } from './cooking'

/** 田源米粉门店扩店等级（Lv1 经典老店 → Lv2 双开间明档 → Lv3 三多路旗舰大店） */
export type ShopLevel = 1 | 2 | 3

/** 店内与后厨交互工位键名 */
export type StationKey =
  | 'counter'
  | 'boil'
  | 'meat'
  | 'broth'
  | 'toppings'
  | 'pickup'
  | 'upgrade'

/** 桂林米粉招牌肉码与配食键名 */
export type ToppingKey = 'guoshao' | 'beef' | 'charsiu' | 'egg' | 'youtiao'

/** 局部坐标系轴对齐碰撞盒（用于实心墙体与大柜台，通道门洞严格留空） */
export interface AabbCollider {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  label?: string
}

/** 堂食或门前人行道外摆座位锚点 */
export interface ShopSeat {
  id: string
  pos: [number, number, number]
  yaw: number
  zone: 'indoor' | 'sidewalk'
}

/** 门店每帧视觉更新上下文（严禁创建动态 Three.js 灯光，统一走 emissive 与粒子） */
export interface TianyuanShopVisualsCtx {
  /** 夜晚程度 0（白天）.. 1（深夜） */
  night: number
  /** 沸水烫粉灶是否处于大火煮粉状态 */
  boiling: boolean
  /** 当前门前及店内排队顾客数 */
  queueCount: number
  /** 累计运行时间（秒） */
  time: number
  /**
   * 玩家是否在店内。缺省时读 `document.body.dataset.mifenIndoor === '1'`。
   * 玩家在店内且相机在室内体积之外（第三人称）时，自动剖开外墙、楼上和天花板。
   */
  indoor?: boolean
  /** 三工位做粉逐帧精细动画进度与实体粉碗状态快照 */
  cooking?: CookingVisualState
  /** 过渡兼容：与 shop-mesh 动画扩展字段同步 */
  cookingStage?: 'idle' | 'boil' | 'meat' | 'broth' | 'done'
  stepProgress?: number
  activeMeats?: readonly string[]
  holdingStage?: 'none' | 'boiled' | 'meated' | 'brined'
  /** 当前相机世界坐标（用于自动屋顶剖切与后厨动态件近距显隐） */
  cameraPos?: THREE.Vector3
}

/** 剖切模式：auto 按玩家与相机位置判断；true / false 强制开关 */
export type ShopCutawayMode = 'auto' | boolean

/** 局部坐标分区（Agent 与调试用：判断玩家 / 顾客在哪个功能区） */
export interface ShopZoneRect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** 田源米粉 3D 门店构建结果（局部坐标系约定：门店正门朝 +Z） */
export interface TianyuanShopBuildResult {
  level: ShopLevel
  group: THREE.Group
  colliders: AabbCollider[]
  walkBounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  stations: Record<StationKey, [number, number, number]>
  seats: ShopSeat[]
  entrance: [number, number, number]
  kitchenEntry: [number, number, number]
  queuePoints: [number, number, number][]
  /** 功能分区：sidewalk 门前外摆、hall 前厅、pass 出餐隔墙、kitchen 后厨 */
  zones?: Record<'sidewalk' | 'hall' | 'pass' | 'kitchen', ShopZoneRect>
  updateVisuals(dt: number, ctx: TianyuanShopVisualsCtx): void
  /** 剖切开关，默认 auto */
  setCutaway?(mode: ShopCutawayMode): void
  /** 当前是否处于剖切状态 */
  isCutaway?(): boolean
  /** 远距 LOD：距离 >35m 时隐藏室内动态件，保留完整建筑外观 */
  setDetailVisible?(visible: boolean): void
  dispose(): void
}

/** 米粉菜单配单定义 */
export interface MifenRecipe {
  id: string
  name: string
  portion: '一两' | '二两' | '三两'
  price: number
  ticketColor: string
  requiredMeats: ToppingKey[]
  brothStyle: 'lucai_dry' | 'soup' | 'sour_spicy'
  boilTargetSec: number
  brineTarget: number
  description: string
  /** 若存在则需达成对应成就后解锁；缺省为初始可用基础粉品 */
  unlockAchievementId?: string
  /** 单碗消耗库存（缺省按份量与肉码自动推导） */
  ingredients?: Partial<InventoryStock>
}

/** 扩店升级与后厨设备升级定义 */
export interface MifenUpgradeDef {
  id: string
  kind: 'shop_level' | 'equipment'
  targetLevel?: ShopLevel
  name: string
  cost: number
  desc: string
  effect: Record<string, number>
}

/** 食客画像与桂林市井台词定义 */
export interface CustomerArchetype {
  id: string
  name: string
  shirtColors: string[]
  patienceSec: number
  tipMultiplier: number
  favoriteRecipes: string[]
  preferredCondiments: string[]
  praiseLines: string[]
  impatientLines: string[]
}

/** 自助小料定义 */
export interface MifenCondimentDef {
  id: string
  name: string
  color: string
}

/** 桂林米粉全量配方、升级、顾客与经济配置表 */
export interface MifenRecipesData {
  shopTitle: string
  recipes: MifenRecipe[]
  upgrades: MifenUpgradeDef[]
  customerTypes: CustomerArchetype[]
  condiments: { id: string; name: string; color: string }[]
  inventoryItems?: InventoryItemDef[]
  deliveryZones?: DeliveryZoneDef[]
  retailSkus?: RetailSkuDef[]
  achievements?: AchievementDef[]
  economyConfig?: MifenEconomyConfig
}

/** 经济系统：核心原料键名 */
export type IngredientKey = 'noodle' | 'brine' | 'guoshao' | 'meat' | 'condiment'

/** 原料库存量（份） */
export type InventoryStock = Record<IngredientKey, number>

/** 原料进货与损耗配置 */
export interface InventoryItemDef {
  id: IngredientKey
  name: string
  unit: string
  unitCost: number
  batchSize: number
  baseCap: number
  overnightSpoilageRate: number
}

/** 桂林三多路周边外卖配送点配置 */
export interface DeliveryZoneDef {
  id: string
  name: string
  distanceM: number
  baseFee: number
  perKmRate: number
  deadlineSec: number
}

/** 外卖包装方式：汤卤分离 vs 混装 */
export type DeliveryPackStyle = 'separated' | 'mixed'

/** 外卖订单快照 */
export interface DeliveryOrder {
  id: string
  recipeId: string
  recipeName: string
  basePrice: number
  zoneId: string
  zoneName: string
  distanceM: number
  packStyle: DeliveryPackStyle
  deliveryFee: number
  quotedTotal: number
  deadlineSec: number
  elapsedSec: number
  status: 'pending' | 'delivering' | 'completed' | 'failed'
}

/** 卤水/锅烧/小料外售与微批发 SKU */
export interface RetailSkuDef {
  id: string
  name: string
  kind: 'retail' | 'wholesale'
  price: number
  unitCost: number
  consumes: Partial<InventoryStock>
  minShopLevel: ShopLevel
  dailyCap: number
}

/** 营业时段 */
export type DayPhase = 'prep' | 'morning_rush' | 'midday' | 'afternoon' | 'evening' | 'closed'

/** 三大核心收益赛道 */
export type RevenueStream = 'dine_in' | 'delivery' | 'retail'

/** 成就与新粉品解锁配置 */
export interface AchievementDef {
  id: string
  name: string
  metric:
    | 'totalBowlsServed'
    | 'perfectBowls'
    | 'streak'
    | 'totalDeliveries'
    | 'totalRetailSold'
    | 'reputation'
    | 'shopLevel'
    | 'dailyNetPeak'
    | 'threeStreamsDay'
  target: number
  rewardFunds: number
  unlocksRecipeId?: string
}

/** 经济核心全局参数 */
export interface MifenEconomyConfig {
  morningRushStartHour: number
  morningRushEndHour: number
  morningRushTrafficMultiplier: number
  morningRushPremiumRate: number
  morningRushZeroDropBonusRate: number
  rawCostRateNormal: number
  rawCostRateEmergencyBrine: number
  deliveryMarkupRate: number
  deliveryPlatformCommissionRate: number
  deliverySeparatedPackCost: number
  deliveryMixedPenalty: number
  deliveryDailyQuotaByLevel: Record<'1' | '2' | '3', number>
  fixedDailyOverheadByLevel: Record<'1' | '2' | '3', number>
}

/** 当日经营累计器 */
export interface DailyAccumulators {
  dineInGross: number
  dineInNet: number
  dineInBowls: number
  deliveryGross: number
  deliveryNet: number
  deliveriesCompleted: number
  deliveriesFailed: number
  retailGross: number
  retailNet: number
  retailUnitsSold: number
  restockSpend: number
  emergencyBrineCost: number
  rushServed: number
  rushAngryDrops: number
}

/** 每日闭店结算记录 */
export interface DailyLedgerRecord {
  day: number
  shopLevel: ShopLevel
  grossByStream: Record<RevenueStream, number>
  netByStream: Record<RevenueStream, number>
  streamShares: Record<RevenueStream, number>
  rushBonus: number
  restockSpend: number
  spoilageLoss: number
  fixedOverhead: number
  totalNetProfit: number
  bowlsServed: number
  deliveriesCompleted: number
  retailUnitsSold: number
  endingReputation: number
  endingFunds: number
}

/** 成品桂林米粉碗 3D 模型可选项 */
export interface MifenBowlOptions {
  hasGuoshao?: boolean
  hasBeef?: boolean
  hasEgg?: boolean
  hasToppings?: boolean
  hasCharsiu?: boolean
  hasYoutiao?: boolean
  /** 缺省按干捞卤菜粉（少量卤水）；soup 为骨头汤，sour_spicy 为酸辣汤 */
  brothStyle?: MifenRecipe['brothStyle']
}

/** 三多路田源米粉世界落位与朝向配置 */
export interface TianyuanSiteConfig {
  readonly shopId: string
  readonly displayName: string
  readonly realAddress: string
  /** 门店锚点世界坐标 [x, y, z] */
  readonly position: readonly [number, number, number]
  /** 门店门前触发点世界坐标 [x, y, z]（对齐 tianyuan-mifen-site.json shopTriggerDef.triggerPos） */
  readonly triggerPos: readonly [number, number, number]
  /**
   * 适配「局部正门朝 +Z」的 Three.js group.rotation.y（弧度）。
   * rotateY(theta) 将局部 (0, 0, 1) 映射到 (sin(theta), 0, cos(theta))。
   */
  readonly rotationY: number
  /** 兼容 site.json 中 Three.js -Z 前向约定的 yaw（= rotationY + Math.PI） */
  readonly facingYawNegZ: number
  /** 门店正门在世界坐标系中的外法线单位向量 */
  readonly forwardWorld: readonly [number, number, number]
  /** 门前人行道快捷直达落脚点 */
  readonly teleportPos: readonly [number, number, number]
  /** 直达时默认视线锚点 */
  readonly teleportLookAt: readonly [number, number, number]
}
