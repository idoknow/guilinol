/**
 * 正阳路 / 王城·商厦「蜜雪冰城」双候选点位 1:1 建筑尺度、扩大内场与实拍证据蓝图（shop-local 米制坐标）。
 *
 * 本次依据 `docs/refs/rock/walk-shizijie-wangcheng/{04,06,08,09,13}*.jpg` 与
 * `docs/drinks-refs/shop/ref-01..19*.jpg` 共 24 张实景参考重构：
 * - 室内净尺寸扩大至 X ∈ [-6.60, +6.60]（面宽 13.20 m）、Z ∈ [-6.40, +2.80]（进深 9.20 m，121.44 ㎡），
 *   新增后场 1.80 m 员工双向穿行走廊、洗消备料台、双门立式冷柜与干货原料库，足够承接第一人称员工操作区；
 * - 门洞加宽至 2.80 m（x ∈ [-1.20, +1.60]，z = +2.80 m，净高 2.75 m，常开外折双玻璃门），满足 ≥2.40 m 通行要求；
 * - 外摆露台延续 z ∈ [+2.80, +5.20]（总进深 11.60 m），兼容并包络 `sim/menu.ts` 默认工位/客座锚点。
 */

import type { ShopAnchorsLike } from '../sim/types.ts'

export type BlueprintEvidenceTag = '实拍可见' | '推算' | '无资料'

export type DrinksCandidateId = 'poi_zhengyang208' | 'wangcheng_mall'

export const DRINKS_CANDIDATE_IDS: readonly DrinksCandidateId[] = ['poi_zhengyang208', 'wangcheng_mall']

export interface BlueprintDimensionEntry {
  readonly id: string
  readonly label: string
  readonly zone: 'site' | 'facade' | 'counter' | 'prep' | 'seating' | 'decor'
  readonly valueM: number
  readonly unit: 'm' | 'storeys' | 'count'
  readonly tag: BlueprintEvidenceTag
  readonly source: string
  readonly notes: string
}

export interface DrinksShopCandidateSite {
  readonly id: DrinksCandidateId
  readonly title: string
  readonly landmarkRef: string
  readonly district: string
  readonly lonLat: readonly [number, number]
  readonly bearingDeg: number
  readonly reportedStoreys: string
  readonly confidence: '高' | '中'
  readonly osmFootprintBoundsLocal?: { readonly xMin: number; readonly xMax: number; readonly zMin: number; readonly zMax: number }
  readonly primaryPhotoRef: string
  readonly secondaryPhotoRef: string
  readonly evidenceRefs: readonly string[]
  readonly poiNote: string
  readonly discrepancyNote: string
}

export interface DrinksShopCandidateBlueprint {
  readonly site: DrinksShopCandidateSite
  readonly entries: readonly BlueprintDimensionEntry[]
  readonly map: Readonly<Record<string, BlueprintDimensionEntry>>
}

/** 正门门洞净尺寸与坐标范围（供 Walk 第一人称进店、NPC 寻路与门框碰撞校验） */
export interface DrinksDoorwayBounds {
  readonly centerX: number
  readonly minX: number
  readonly maxX: number
  readonly z: number
  readonly widthM: number
  readonly heightM: number
}

/** 放大后营业大厅 + 后厨员工区室内净边界 */
export interface DrinksInteriorBounds {
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
  readonly widthM: number
  readonly depthM: number
  readonly heightM: number
  readonly areaSqm: number
}

/** 员工工位与操作热区（供 `drinks/staff` 等下游模块直接引用） */
export interface DrinksWorkstationZone {
  readonly id: string
  readonly kind:
    | 'cashier'
    | 'pickup'
    | 'prep_lemon_ice'
    | 'prep_tea_shake'
    | 'prep_cream_top'
    | 'back_wash_sink'
    | 'back_cold_storage'
    | 'back_dry_stock'
  readonly label: string
  readonly staffPos: { readonly x: number; readonly z: number; readonly yaw: number }
  readonly bounds: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }
}

export const DRINKS_SHOP_DOORWAY: DrinksDoorwayBounds = Object.freeze({
  centerX: 0.2,
  minX: -1.2,
  maxX: 1.6,
  z: 2.8,
  widthM: 2.8,
  heightM: 2.75,
})

export const DRINKS_SHOP_INTERIOR: DrinksInteriorBounds = Object.freeze({
  minX: -6.6,
  maxX: 6.6,
  minZ: -6.4,
  maxZ: 2.8,
  widthM: 13.2,
  depthM: 9.2,
  heightM: 3.6,
  areaSqm: 121.44,
})

export const DRINKS_STAFF_OPERATION_ZONE = Object.freeze({
  bounds: { minX: -6.35, maxX: 6.35, minZ: -6.22, maxZ: -0.82 },
  frontLaneZ: -1.4,
  prepIslandZ: -3.22,
  backAisleZ: -4.6,
  rearCounterZ: -5.9,
  westPassX: -4.45,
  eastPassX: 5.35,
})

export const DRINKS_STAFF_WORKSTATIONS: readonly DrinksWorkstationZone[] = Object.freeze([
  {
    id: 'cashier_left',
    kind: 'cashier',
    label: '左收银点单工位',
    staffPos: { x: -2.55, z: -0.98, yaw: 0 },
    bounds: { minX: -3.55, maxX: -1.55, minZ: -1.75, maxZ: -0.82 },
  },
  {
    id: 'cashier_right',
    kind: 'cashier',
    label: '右收银点单工位',
    staffPos: { x: -0.35, z: -0.98, yaw: 0 },
    bounds: { minX: -1.35, maxX: 0.65, minZ: -1.75, maxZ: -0.82 },
  },
  {
    id: 'pickup_pass',
    kind: 'pickup',
    label: '打包叫号出杯位',
    staffPos: { x: 2.35, z: -0.98, yaw: 0 },
    bounds: { minX: 1.0, maxX: 4.3, minZ: -1.75, maxZ: -0.82 },
  },
  {
    id: 'prep_lemon_1',
    kind: 'prep_lemon_ice',
    label: '鲜果捣冰制冰台',
    staffPos: { x: -3.2, z: -2.35, yaw: Math.PI },
    bounds: { minX: -3.85, maxX: -2.35, minZ: -2.8, maxZ: -1.85 },
  },
  {
    id: 'prep_tea_1',
    kind: 'prep_tea_shake',
    label: '萃茶摇茶工位 A',
    staffPos: { x: -1.35, z: -2.35, yaw: Math.PI },
    bounds: { minX: -2.15, maxX: -0.45, minZ: -2.8, maxZ: -1.85 },
  },
  {
    id: 'prep_tea_2',
    kind: 'prep_tea_shake',
    label: '摇茶封口工位 B',
    staffPos: { x: 0.5, z: -2.35, yaw: Math.PI },
    bounds: { minX: -0.35, maxX: 1.4, minZ: -2.8, maxZ: -1.85 },
  },
  {
    id: 'prep_cream_1',
    kind: 'prep_cream_top',
    label: '冰淇淋奶浆甜品台',
    staffPos: { x: 2.25, z: -2.35, yaw: Math.PI },
    bounds: { minX: 1.5, maxX: 3.8, minZ: -2.8, maxZ: -1.85 },
  },
  {
    id: 'back_wash_sink',
    kind: 'back_wash_sink',
    label: '后厨洗消备料水槽区',
    staffPos: { x: -1.8, z: -4.85, yaw: Math.PI },
    bounds: { minX: -3.6, maxX: 0.5, minZ: -5.45, maxZ: -3.8 },
  },
  {
    id: 'back_cold_storage',
    kind: 'back_cold_storage',
    label: '后厨冷藏保鲜冷柜区',
    staffPos: { x: 2.6, z: -4.85, yaw: Math.PI },
    bounds: { minX: 0.8, maxX: 5.2, minZ: -5.45, maxZ: -3.8 },
  },
  {
    id: 'back_dry_stock',
    kind: 'back_dry_stock',
    label: '西侧原料仓储货架补货区',
    staffPos: { x: -4.4, z: -3.15, yaw: -Math.PI * 0.5 },
    bounds: { minX: -5.05, maxX: -3.9, minZ: -5.45, maxZ: -2.4 },
  },
])

const SHOP_ANCHORS_RAW: ShopAnchorsLike = {
  width: DRINKS_SHOP_INTERIOR.widthM,
  depth: DRINKS_SHOP_INTERIOR.depthM + 2.4,
  entrance: { x: DRINKS_SHOP_DOORWAY.centerX, z: DRINKS_SHOP_DOORWAY.z },
  approachLeft: { x: -7.6, z: 4.95 },
  approachRight: { x: 7.8, z: 4.95 },
  menuBoardSlots: [
    { x: -1.7, z: 2.05, yaw: Math.PI },
    { x: -0.55, z: 2.05, yaw: Math.PI },
    { x: 0.55, z: 2.05, yaw: Math.PI },
    { x: 1.65, z: 2.05, yaw: Math.PI },
  ],
  cashiers: [
    {
      id: 'cashier_left',
      clerkPos: { x: -2.55, z: -0.92, yaw: 0 },
      customerPos: { x: -2.55, z: 0.14, yaw: Math.PI },
      queueAnchor: { x: -2.55, z: 1.08 },
      queueDir: { x: 0, z: 1.02 },
    },
    {
      id: 'cashier_right',
      clerkPos: { x: -0.35, z: -0.92, yaw: 0 },
      customerPos: { x: -0.35, z: 0.14, yaw: Math.PI },
      queueAnchor: { x: -0.35, z: 1.08 },
      queueDir: { x: 0, z: 1.02 },
    },
  ],
  prepStations: [
    { id: 'prep_lemon_1', kind: 'lemon_ice', x: -3.2, z: -2.35, yaw: Math.PI },
    { id: 'prep_tea_1', kind: 'tea_shake', x: -1.35, z: -2.35, yaw: Math.PI },
    { id: 'prep_tea_2', kind: 'tea_shake', x: 0.5, z: -2.35, yaw: Math.PI },
    { id: 'prep_cream_1', kind: 'cream_top', x: 2.25, z: -2.35, yaw: Math.PI },
  ],
  pickupClerkPos: { x: 2.35, z: -0.92, yaw: 0 },
  pickupSlots: [
    { x: 1.4, z: 0.18, yaw: Math.PI },
    { x: 2.25, z: 0.18, yaw: Math.PI },
    { x: 3.1, z: 0.18, yaw: Math.PI },
    { x: 3.9, z: 0.18, yaw: Math.PI },
  ],
  waitingSpots: [
    { x: 1.35, z: 1.15, yaw: Math.PI },
    { x: 2.25, z: 1.15, yaw: Math.PI },
    { x: 3.15, z: 1.15, yaw: Math.PI },
    { x: 4.0, z: 1.15, yaw: Math.PI },
    { x: 1.65, z: 2.05, yaw: Math.PI },
    { x: 2.6, z: 2.05, yaw: Math.PI },
    { x: 3.55, z: 2.05, yaw: Math.PI },
    { x: 4.45, z: 2.05, yaw: Math.PI },
  ],
  seats: [
    { id: 'seat_in_1', zone: 'indoor', x: -4.65, z: 0.35, yaw: Math.PI * 0.5 },
    { id: 'seat_in_2', zone: 'indoor', x: -4.65, z: 1.5, yaw: Math.PI * 0.5 },
    { id: 'seat_in_3', zone: 'indoor', x: -3.45, z: 0.95, yaw: -Math.PI * 0.5 },
    { id: 'seat_in_4', zone: 'indoor', x: 4.75, z: 0.45, yaw: -Math.PI * 0.5 },
    { id: 'seat_in_5', zone: 'indoor', x: 4.75, z: 1.45, yaw: -Math.PI * 0.5 },
    { id: 'seat_in_6', zone: 'indoor', x: 4.75, z: 2.25, yaw: -Math.PI * 0.5 },
    { id: 'seat_out_1', zone: 'patio', x: -3.75, z: 3.6, yaw: 0 },
    { id: 'seat_out_2', zone: 'patio', x: -2.85, z: 3.6, yaw: 0 },
    { id: 'seat_out_3', zone: 'patio', x: 2.65, z: 3.6, yaw: 0 },
    { id: 'seat_out_4', zone: 'patio', x: 3.55, z: 3.6, yaw: 0 },
  ],
  storagePos: { x: -4.4, z: -3.15, yaw: -Math.PI * 0.5 },
  patrolPoints: [
    { x: -3.8, z: -1.55, yaw: 0 },
    { x: -1.45, z: -1.65, yaw: 0 },
    { x: 0.55, z: -1.65, yaw: 0 },
    { x: 3.55, z: -1.45, yaw: 0 },
    { x: 1.2, z: -4.6, yaw: Math.PI },
    { x: -2.4, z: -4.6, yaw: Math.PI },
  ],
}

/** 结构化空间锚点，可直接传给 `sim/menu.ts` 的 `layoutFromShopAnchors()` 或供 `staff/` 读取 */
export const DRINKS_SHOP_ANCHORS: ShopAnchorsLike = Object.freeze(SHOP_ANCHORS_RAW)

const SHARED_INTERIOR_ENTRIES: readonly BlueprintDimensionEntry[] = [
  {
    id: 'interior_depth',
    label: '扩大后室内净进深（含后厨员工备料区）',
    zone: 'site',
    valueM: DRINKS_SHOP_INTERIOR.depthM,
    unit: 'm',
    tag: '推算',
    source: '由 ref-09/ref-11/ref-16 门店双吧台+后场备料及冷柜动线推算，从旧版 7.40m 扩展至 9.20m（z ∈ [-6.40, +2.80]）',
    notes: '室内净面积 121.44 ㎡（+44%），足以容纳前收银、中央水吧岛台、后场 1.80m 双向穿行通道及洗消冷柜货架。',
  },
  {
    id: 'patio_depth',
    label: '门前外摆露台与退界进深',
    zone: 'site',
    valueM: 2.4,
    unit: 'm',
    tag: '无资料',
    source: '无资料（04/06/08 商店紧邻路缘退界被公交车与树影遮挡）；按 z ∈ [+2.80, +5.20] 对齐',
    notes: '承载 4 席外摆座位与门前雪王打卡区。',
  },
  {
    id: 'total_depth',
    label: '门店总进深（含外摆）',
    zone: 'site',
    valueM: 11.6,
    unit: 'm',
    tag: '推算',
    source: '室内 9.20m + 外摆 2.40m（z ∈ [-6.40, +5.20]）',
    notes: '向后伸入王城商厦裙房内进深，不挤占门前十字街步道。',
  },
  {
    id: 'door_width',
    label: '加宽正门对开玻璃门净宽',
    zone: 'facade',
    valueM: DRINKS_SHOP_DOORWAY.widthM,
    unit: 'm',
    tag: '实拍可见',
    source: '参考 ref-04-suzhou-flagship-3.jpg 与 ref-18-singapore-bugis-01.jpg 宽敞无障碍双开入口并设 2.80m（≥2.40m）',
    notes: 'x ∈ [-1.20, +1.60]，门扇外开 95° 锁止，配竖向 LED 门框灯带与门贴，方便第一人称直接步入。',
  },
  {
    id: 'door_height',
    label: '正门门洞净高',
    zone: 'facade',
    valueM: DRINKS_SHOP_DOORWAY.heightM,
    unit: 'm',
    tag: '推算',
    source: '参考 ref-14-mixue-hq-01.jpg / ref-19-saigon-store-02.jpg 玻璃双开门门楣比例，设为 2.75m',
    notes: '衔接 1F 门头红白发光灯楣。',
  },
  {
    id: 'front_counter_length',
    label: '前台点单与取餐组合吧台总长',
    zone: 'counter',
    valueM: 8.2,
    unit: 'm',
    tag: '实拍可见',
    source: '参考 ref-11 / ref-16 / ref-13 蜜雪冰城直排与 L 型前吧台结构（x ∈ [-3.70, +4.50], z = -0.46）',
    notes: '白色横百叶护板嵌 3 道正红细条 + 底部正红踢脚灯带 + 圆形雪王背光徽标。',
  },
  {
    id: 'front_counter_height',
    label: '前台点单/出餐台面高度',
    zone: 'counter',
    valueM: 0.96,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按 ref-16 石英石点单取餐台人体工学高度 0.96m 定尺）',
    notes: '匹配收银 POS、扫码点单盒与取餐递杯高度。',
  },
  {
    id: 'front_counter_depth',
    label: '前台吧台进深',
    zone: 'counter',
    valueM: 0.64,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按商用收银递杯台 0.60–0.70m 深度定尺）',
    notes: 'z ∈ [-0.78, -0.14]，保持前收银员与排队顾客手部净空。',
  },
  {
    id: 'prep_bar_length',
    label: '中央开放式水吧三区岛台总长',
    zone: 'prep',
    valueM: 8.2,
    unit: 'm',
    tag: '实拍可见',
    source: '参考 ref-07 / ref-09 / ref-11 后场不锈钢滴水盘四茶桶+三杆软冰淇淋机连台排布（x ∈ [-3.80, +4.40]）',
    notes: '鲜果碎冰、萃茶封口、冰淇淋奶浆三区一体连贯。',
  },
  {
    id: 'prep_bar_height',
    label: '后场不锈钢操作台高度',
    zone: 'prep',
    valueM: 0.88,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按商用餐饮 880mm 标准工作台高度定尺）',
    notes: '承载斜坡制冰机、4 个红黑保温茶桶、GN 配料槽、自动封口机与 3 杆蜜雪红板软冰淇淋机。',
  },
  {
    id: 'prep_bar_depth',
    label: '中央水吧操作台进深',
    zone: 'prep',
    valueM: 0.8,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按商用软冰淇淋机/制冰机深 780–800mm 定尺）',
    notes: 'z ∈ [-3.62, -2.82]，前后双面均方便店员走动取放。',
  },
  {
    id: 'staff_aisle_width',
    label: '员工后厨双向穿行操作走廊净宽',
    zone: 'prep',
    valueM: 1.8,
    unit: 'm',
    tag: '推算',
    source: '放大后新增后场通道（岛台后缘 z=-3.62 至后厨靠墙洗消冷柜台 z=-5.54 净宽 1.92m，有效通行 ≥1.80m）',
    notes: '保障员工从前台穿行至后墙双槽水槽、开水器、双门冷柜与西侧货架区全环线畅通。',
  },
  {
    id: 'back_kitchen_counter_length',
    label: '后墙洗消备料与冷柜联排工作台宽',
    zone: 'prep',
    valueM: 9.0,
    unit: 'm',
    tag: '实拍可见',
    source: '参考 ref-11 / ref-16 / ref-17 后墙双门立式不锈钢冷柜、净水器、开水器与洗消池配置',
    notes: 'x ∈ [-3.60, +5.40], z ∈ [-6.28, -5.54]，补齐员工后场闭环操作设施。',
  },
  {
    id: 'customer_hall_depth',
    label: '前厅点单排队与等餐通廊进深',
    zone: 'seating',
    valueM: 2.94,
    unit: 'm',
    tag: '无资料',
    source: '无资料（由入口 z=+2.80 至前吧台 z=-0.14 扣减门框得 2.94m 净深）',
    notes: '确保 2.80m 大门步入后视野开阔不拥堵。',
  },
  {
    id: 'dining_table_size',
    label: '客席饮品桌标准面宽',
    zone: 'seating',
    valueM: 0.64,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按轻食茶饮方桌及 ref-05 / ref-10 室内座位尺寸定尺）',
    notes: '搭配 `我在蜜雪等着你` 红色卡座与浅橡木咖啡桌。',
  },
  {
    id: 'dining_seat_height',
    label: '客席椅坐面高度',
    zone: 'seating',
    valueM: 0.44,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按常规饮品座高 440mm 定尺）',
    notes: '室内暖木+红卡座、室外珊瑚红椅面。',
  },
  {
    id: 'mascot_showcase_height',
    label: '门前 3D 站立雪王雕塑定量高度',
    zone: 'decor',
    valueM: 2.15,
    unit: 'm',
    tag: '实拍可见',
    source: '参考 ref-14-mixue-hq-01.jpg 与 Rock 13_IMG_1402.jpg 门前站立玻璃钢雪王+圆形底座比例',
    notes: '白圆球躯干、三齿雪白皇冠、橙色胡萝卜尖鼻、红披风、金色华夫甜筒白色旋转冰淇淋权杖与 `你爱我♥我爱你` 圆台。',
  },
] as const

const WANGCHENG_MALL_SITE: DrinksShopCandidateSite = {
  id: 'wangcheng_mall',
  title: '候选点位 B · 王城·商厦转角「蜜雪冰城」旗舰裙房（OSM way/264901525）',
  landmarkRef: 'wangcheng_mall (way/264901525)',
  district: '桂林市秀峰区 · 解放东路与正阳步行街口王城·商厦（KING’S PLAZA）西北转角',
  lonLat: [110.2942305, 25.2803115],
  bearingDeg: 12.6,
  reportedStoreys: '8 / ~24.7m 临街主立面（1–5F 蜜雪红框包柱，6–8F 蓝灰幕墙；OSM 整体含高层登记 9 层）',
  confidence: '高',
  osmFootprintBoundsLocal: { xMin: -619, xMax: -543, zMin: -71, zMax: -3 },
  primaryPhotoRef: 'docs/drinks-refs/shop/ref-20-xhs-wangcheng-day-elevation.jpg',
  secondaryPhotoRef: 'docs/drinks-refs/shop/ref-29-xhs-wangcheng-night-front-ortho.jpg',
  evidenceRefs: [
    'docs/layout/dongxi-layout.md#L108',
    'docs/refs/rock/walk-shizijie-wangcheng/04_IMG_1393.jpg',
    'docs/refs/rock/walk-shizijie-wangcheng/06_IMG_1395.jpg',
    'docs/drinks-refs/shop/ref-20-xhs-wangcheng-day-elevation.jpg',
    'docs/drinks-refs/shop/ref-22-xhs-wangcheng-day-fascia-close.jpg',
    'docs/drinks-refs/shop/ref-23-xhs-wangcheng-day-corner-45.jpg',
    'docs/drinks-refs/shop/ref-25-xhs-wangcheng-day-billboard-ortho.jpg',
    'docs/drinks-refs/shop/ref-26-xhs-wangcheng-night-corner-45.jpg',
    'docs/drinks-refs/shop/ref-27-xhs-wangcheng-night-rooftop-wide.jpg',
    'docs/drinks-refs/shop/ref-29-xhs-wangcheng-night-front-ortho.jpg',
    'docs/drinks-refs/shop/ref-32-xhs-wangcheng-interior-stairs-king.jpg',
    'docs/drinks-refs/shop/ref-33-xhs-wangcheng-interior-bar-menu.jpg',
    'docs/drinks-refs/shop/ref-35-xhs-wangcheng-menu-display.jpg',
  ],
  poiNote: 'OSM way/264901525 锚定王城·商厦本体；结合十字街现场与小红书王城旗舰店全套日夜内外实拍，精确校准 1F 通高幕墙与深挑红门头（4.25m）、2–5F 分格红墙半身无甜筒雪王、夜景自发光对比与 1F 浅白红沿弧边吧台+「点餐」吊顶灯箱布局。',
  discrepancyNote: '依据小红书王城实拍优化 1F/上墙高度占比（4.25m:10.25m）、取消门前室外遮阳伞回归开敞石材广场并将立式雪王移至东南落地窗内红波浪底座，同时完整保留 121.44 ㎡ 室内员工操作区与 2.80m 玻璃双门净宽。',
}

const WANGCHENG_MALL_ENTRIES: readonly BlueprintDimensionEntry[] = [
  {
    id: 'facade_podium_storeys',
    label: '转角蜜雪冰城红色巨幅包框跨越层数',
    zone: 'facade',
    valueM: 5,
    unit: 'storeys',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/06_IMG_1395.jpg、04_IMG_1393.jpg、08_IMG_1397.jpg（红框自首层上抵 5F 飞扬美学腰线，上方紧邻 6F–8F 三层幕墙）',
    notes: '1:1 还原 1–5F 五层通高红色看板体量与顶部 5 盏黑色长臂投光射灯。',
  },
  {
    id: 'host_visible_storeys',
    label: '王城·商厦临街立面实拍总层数',
    zone: 'facade',
    valueM: 8,
    unit: 'storeys',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/06_IMG_1395.jpg、08_IMG_1397.jpg、09_IMG_1398.jpg（1F 入口雨棚上数至 8F 女儿墙及屋顶「GD 王城商厦」发光字）',
    notes: '完整呈现 1–8F 黑框蓝灰反射玻璃幕墙、屋顶女儿墙压顶与红色「GD 王城商厦」楼顶牌。',
  },
  {
    id: 'upper_curtain_panes_main',
    label: '蜜雪红框及左侧 6F–8F 幕墙分格数',
    zone: 'facade',
    valueM: 14,
    unit: 'count',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/06_IMG_1395.jpg（蜜雪主面 9 格 + 红柱 2 格 + 西侧邻铺延伸 3 格）',
    notes: '严格对齐黑色铝框竖梃与层间深灰铝塑板腰带。',
  },
  {
    id: 'curved_corner_panes',
    label: '右侧紧邻 8 格流畅圆弧玻璃转角',
    zone: 'facade',
    valueM: 8,
    unit: 'count',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/04_IMG_1393.jpg、06_IMG_1395.jpg、09_IMG_1398.jpg（弧窗上逐层写 KING’S PLAZA 王城·商厦 / 王城电脑城 5/6楼 / 飞扬美学 / DJI 大疆）',
    notes: '平滑 8 段弧形转角玻璃并向东接出 2 跨突翼写「王城超市」。',
  },
  {
    id: 'corner_pillar_storeys',
    label: '外凸竖排「蜜雪冰城」红白包柱层高',
    zone: 'facade',
    valueM: 5,
    unit: 'storeys',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/04_IMG_1393.jpg、06_IMG_1395.jpg（主红面右侧外凸两跨通高红柱，竖排「蜜/雪/冰/城」发光白字）',
    notes: '下段 1–2F 位置镶嵌站姿持甜筒雪王方牌。',
  },
  {
    id: 'street_paving_slabs',
    label: '路口街面深灰石材矩形大板（无强加盲道）',
    zone: 'site',
    valueM: 1,
    unit: 'count',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/08_IMG_1397.jpg（前列街面大板石材及黑黄警戒缘石，画面未见连续黄盲道）',
    notes: '写实复原街面深灰石材大板与黑黄路缘石。',
  },
  {
    id: 'mascot_showcase_visible',
    label: '立面半身无甜筒 3D 雪王与 1F 落地窗内波浪底座雪王',
    zone: 'decor',
    valueM: 2,
    unit: 'count',
    tag: '实拍可见',
    source: 'docs/drinks-refs/shop/ref-22-xhs-wangcheng-day-fascia-close.jpg、ref-25-xhs-wangcheng-day-billboard-ortho.jpg（墙面半身无甜筒雪王直接靠红墙坐于雨棚上方）；ref-32/ref-34（室内东南窗边波浪红台站立雪王）',
    notes: '外墙巨型半身雪王高约 7.2m 且双手张开无甜筒、紧贴雨棚顶缘；门前无遮阳伞且室内窗旁设红底座立式雪王与红白楼梯。',
  },
  {
    id: 'shop_width',
    label: '旗舰主展面总面宽（含扩大内场）',
    zone: 'site',
    valueM: DRINKS_SHOP_INTERIOR.widthM,
    unit: 'm',
    tag: '推算',
    source: '由 06_IMG_1395.jpg 与 ref-20 主面+红柱合计约 11–12 格幕墙按 ~1.10–1.20m/格比例推算为 13.20m，并完整包络 sim/menu.ts 锚点',
    notes: 'x ∈ [-6.60, +6.60]，为室内客座与后厨员工操作区留足横向空间。',
  },
  {
    id: 'curtain_bay_width',
    label: '标准玻璃幕墙立柱模数分格宽',
    zone: 'facade',
    valueM: 1.1,
    unit: 'm',
    tag: '推算',
    source: '由 13.20m 总展面 12 格（主面 10 格 + 红柱 2 格）推算单格宽 1.10m',
    notes: '用于 1F 全透落地幕墙与 6–8F 商厦主幕墙竖梃对齐。',
  },
  {
    id: 'floor1_height',
    label: '首层营业大厅与深挑门头通高',
    zone: 'facade',
    valueM: 4.25,
    unit: 'm',
    tag: '实拍可见',
    source: '依据小红书 ref-20-xhs-wangcheng-day-elevation.jpg / ref-24 / ref-29 实拍 1F 通高落地幕墙+深挑雨棚比例定尺 4.25m（占红框总高约 29.3%）',
    notes: '保障 1F 玻璃门头舒展比例及「点餐」跌级吊顶灯箱净空。',
  },
  {
    id: 'floor2_height',
    label: '二至五层红色看板单层标准高',
    zone: 'facade',
    valueM: 2.56,
    unit: 'm',
    tag: '推算',
    source: '由 ref-20 实拍 1F(4.25m) + 2–5F(4×2.56m=10.25m) = 14.50m 红盒总高比例反推',
    notes: '确保红盒上下占比对齐桂林王城实拍。',
  },
  {
    id: 'floor3_height',
    label: '六至八层上部幕墙总高',
    zone: 'facade',
    valueM: 10.2,
    unit: 'm',
    tag: '推算',
    source: '由 ref-20 / ref-27 实拍红盒上沿 6F/7F/8F 三层黑框蓝灰幕墙共 10.20m（女儿墙高 24.70m）推算',
    notes: '清晰展示 3 层蓝灰幕墙与屋顶宽幅红字「王城·商厦」。',
  },
  {
    id: 'podium_total_height',
    label: '1–5F 蜜雪冰城红色转角包框总高',
    zone: 'facade',
    valueM: 14.5,
    unit: 'm',
    tag: '推算',
    source: '由 ref-20 / ref-27 实拍 1F(4.25m) + 2–5F(10.25m) = 14.50m 对齐 6F 大疆窗下檐',
    notes: '顶接 6F 幕墙下沿，无多余高度压缩上部三层。',
  },
  {
    id: 'fascia_height',
    label: '2–5F 主立面巨幅蜜雪红色展板净高',
    zone: 'facade',
    valueM: 10.25,
    unit: 'm',
    tag: '实拍可见',
    source: '由 ref-22 / ref-25 主红板（y ∈ [4.25, 14.50]）实测高宽比定尺 10.25m',
    notes: '含白色铝板网格分缝、散落雪花、左中大字「蜜雪冰城」及右侧无甜筒半身雪王。',
  },
  {
    id: 'corner_pillar_width',
    label: '右侧转角外凸竖排「蜜雪冰城」包柱宽',
    zone: 'facade',
    valueM: 1.85,
    unit: 'm',
    tag: '推算',
    source: '按 04/06/08 与 ref-23/28 右侧外凸红柱约占 1.7 格幕墙推算（x ∈ [+4.75, +6.60]）',
    notes: '正侧两面皆可竖排高亮识别「蜜雪冰城」。',
  },
  {
    id: 'awning_projection',
    label: '首层门头深挑红框发光雨棚挑深',
    zone: 'facade',
    valueM: 1.32,
    unit: 'm',
    tag: '实拍可见',
    source: '参考 ref-22 / ref-29 / ref-30 实拍厚实正红挑檐（y ∈ [3.55, 4.22]，正立面写「蜜雪冰城 桂林旗舰店」，底面嵌 8 盏暖白筒灯）',
    notes: '雨棚底缘紧接 1F 通高玻璃门楣，夜晚筒灯洗亮 1F 玻璃与街面。',
  },
  ...SHARED_INTERIOR_ENTRIES,
] as const

const POI_ZHENGYANG208_SITE: DrinksShopCandidateSite = {
  id: 'poi_zhengyang208',
  title: '候选点位 A · 东西巷/正阳路「蜜雪冰城」街铺旗舰（正阳路208号 POI）',
  landmarkRef: 'dongxi_arch_poi (正阳路208号 · baidu:89f748120f2470e20bccdde0)',
  district: '桂林市秀峰区 · 正阳路208号 / 东西巷牌坊邻街首层',
  lonLat: [110.2938048, 25.2806767],
  bearingDeg: 13.4,
  reportedStoreys: '1 / 5.10m 单层街铺体量（Confidence: 中）',
  confidence: '中',
  osmFootprintBoundsLocal: { xMin: -619, xMax: -543, zMin: -71, zMax: -3 },
  primaryPhotoRef: 'docs/refs/rock/walk-shizijie-wangcheng/13_IMG_1402.jpg',
  secondaryPhotoRef: 'docs/drinks-refs/shop/ref-12-shanghai-street-front.jpg',
  evidenceRefs: [
    'docs/layout/dongxi-layout.md#L116',
    'docs/refs/rock/walk-shizijie-wangcheng/13_IMG_1402.jpg',
    'docs/drinks-refs/shop/ref-02-suzhou-flagship-1.jpg',
    'docs/drinks-refs/shop/ref-10-zhongshan-street-front.jpg',
    'docs/drinks-refs/shop/ref-12-shanghai-street-front.jpg',
    'docs/drinks-refs/shop/ref-19-saigon-store-02.jpg',
  ],
  poiNote: '百度 POI 登记「蜜雪冰城(东西巷牌坊店)：正阳路208号」；结合 13_IMG_1402.jpg 与标准街铺实拍，还原单层通长红色发光门头+红白条纹遮阳篷+门前站立 3D 雪王。',
  discrepancyNote: '保留单层街铺立面形态并与放大 121.44 ㎡ 室内操作区、2.80m 宽玻璃双开正门共用同一高效合批室内架构。',
}

const POI_ZHENGYANG208_ENTRIES: readonly BlueprintDimensionEntry[] = [
  {
    id: 'street_paving_slabs',
    label: '正阳步行街深灰矩形石材地坪',
    zone: 'site',
    valueM: 1,
    unit: 'count',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/08_IMG_1397.jpg、13_IMG_1402.jpg',
    notes: '写实深灰石板铺装，无虚假黄盲道。',
  },
  {
    id: 'brand_color_system',
    label: '正红发光门头「蜜雪冰城 · SINCE 1997」视觉体系',
    zone: 'facade',
    valueM: 1,
    unit: 'count',
    tag: '实拍可见',
    source: 'docs/drinks-refs/shop/ref-02-suzhou-flagship-1.jpg、ref-12-shanghai-street-front.jpg、ref-19-saigon-store-02.jpg',
    notes: '正红底板 + 白字发光字体 + 雪王徽标 + `你爱我♥我爱你 蜜雪冰城甜蜜蜜` 门楣。',
  },
  {
    id: 'curtain_mullion_style',
    label: '深色细铝框落地透视橱窗与玻璃双开门',
    zone: 'facade',
    valueM: 1,
    unit: 'count',
    tag: '实拍可见',
    source: 'docs/drinks-refs/shop/ref-19-saigon-store-02.jpg、ref-18-singapore-bugis-01.jpg',
    notes: '内嵌门框 LED 灯带与玻璃中心雪王圆形贴纸。',
  },
  {
    id: 'corner_mascot_vocab',
    label: '门前站姿持甜筒 3D 雪王雕塑及柱身五图标牌',
    zone: 'decor',
    valueM: 1,
    unit: 'count',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/13_IMG_1402.jpg、ref-14-mixue-hq-01.jpg、ref-19-saigon-store-02.jpg',
    notes: '还原街铺门口 3D 雪王摆件及西侧柱身 5 连圆底品类图标。',
  },
  {
    id: 'facade_podium_storeys',
    label: '单层沿街铺位立面层数（POI 1 / —）',
    zone: 'facade',
    valueM: 1,
    unit: 'storeys',
    tag: '推算',
    source: '据 dongxi-layout.md#L116 登记 1 层及 13_IMG_1402.jpg 单层正红横招推算',
    notes: '直观区分于王城·商厦 5 层包框 + 8 层主体候选方案。',
  },
  {
    id: 'shop_width',
    label: '沿街大开间总面宽（含扩大内场）',
    zone: 'site',
    valueM: DRINKS_SHOP_INTERIOR.widthM,
    unit: 'm',
    tag: '推算',
    source: '按步行街双开间扩大净面宽 13.20m 定尺（x ∈ [-6.60, +6.60]）',
    notes: '支撑同款放大内场与员工后厨闭环区。',
  },
  {
    id: 'floor1_height',
    label: '首层营业大厅净层高',
    zone: 'facade',
    valueM: DRINKS_SHOP_INTERIOR.heightM,
    unit: 'm',
    tag: '推算',
    source: '按街铺首层高净空与内挂菜单灯箱 3.60m 定尺',
    notes: '保障室内开阔采光。',
  },
  {
    id: 'parapet_height',
    label: '单层门头含女儿墙压顶总高度',
    zone: 'facade',
    valueM: 5.15,
    unit: 'm',
    tag: '推算',
    source: '首层 3.60m + 通长门头灯箱压顶 1.55m 累加推算',
    notes: '比例接近 ref-12 / ref-19 单层高门头。',
  },
  {
    id: 'fascia_height',
    label: '单层通长正红门头灯箱高',
    zone: 'facade',
    valueM: 1.5,
    unit: 'm',
    tag: '实拍可见',
    source: '参考 ref-02 / ref-12 / ref-19 单层门头灯箱高宽比推算',
    notes: '含居中雪王 + 「蜜雪冰城 · MIXUE · SINCE 1997」背光发光字。',
  },
  {
    id: 'curtain_bay_width',
    label: '玻璃幕墙标准分格宽',
    zone: 'facade',
    valueM: 1.25,
    unit: 'm',
    tag: '推算',
    source: '按 13.20m 开间对称扣除 2.80m 双门洞划分推算',
    notes: '通透展现室内白色横百叶吧台与 4 联价目墙。',
  },
  {
    id: 'corner_pillar_width',
    label: '东侧悬挑竖向双面灯箱刀旗宽',
    zone: 'facade',
    valueM: 0.62,
    unit: 'm',
    tag: '推算',
    source: '按步行街侧招双面竖排灯箱「蜜雪冰城」常规挑出宽度定尺',
    notes: '沿步行街双向引流。',
  },
  {
    id: 'awning_projection',
    label: '红白条纹门前遮阳挑檐深',
    zone: 'facade',
    valueM: 0.98,
    unit: 'm',
    tag: '实拍可见',
    source: '参考 ref-08-snow-king-statue.jpg 街铺红白相间遮阳篷比例定尺',
    notes: '置于 y = 2.94m，覆盖大门口迎宾区不压挡上方红招牌。',
  },
  ...SHARED_INTERIOR_ENTRIES,
] as const

function indexEntries(entries: readonly BlueprintDimensionEntry[]): Readonly<Record<string, BlueprintDimensionEntry>> {
  return Object.freeze(Object.fromEntries(entries.map(entry => [entry.id, entry])))
}

export const DRINKS_SHOP_CANDIDATES: Readonly<Record<DrinksCandidateId, DrinksShopCandidateBlueprint>> = Object.freeze({
  poi_zhengyang208: {
    site: POI_ZHENGYANG208_SITE,
    entries: POI_ZHENGYANG208_ENTRIES,
    map: indexEntries(POI_ZHENGYANG208_ENTRIES),
  },
  wangcheng_mall: {
    site: WANGCHENG_MALL_SITE,
    entries: WANGCHENG_MALL_ENTRIES,
    map: indexEntries(WANGCHENG_MALL_ENTRIES),
  },
})

export function getDrinksBlueprint(candidateId: DrinksCandidateId = 'wangcheng_mall'): DrinksShopCandidateBlueprint {
  return DRINKS_SHOP_CANDIDATES[candidateId]
}

export const DRINKS_SHOP_SITE = WANGCHENG_MALL_SITE
export const DRINKS_SHOP_BLUEPRINT_ENTRIES = WANGCHENG_MALL_ENTRIES
export const DRINKS_SHOP_BLUEPRINT: Readonly<Record<string, BlueprintDimensionEntry>> =
  DRINKS_SHOP_CANDIDATES.wangcheng_mall.map

export type DrinksBlueprintId = (typeof WANGCHENG_MALL_ENTRIES)[number]['id']

export interface BlueprintValidationResult {
  valid: boolean
  count: number
  countsByTag: Record<BlueprintEvidenceTag, number>
  errors: string[]
}

const ALLOWED_TAGS: ReadonlySet<BlueprintEvidenceTag> = new Set(['实拍可见', '推算', '无资料'])

export function validateDrinksBlueprint(
  entries: readonly BlueprintDimensionEntry[] = DRINKS_SHOP_BLUEPRINT_ENTRIES,
): BlueprintValidationResult {
  const countsByTag: Record<BlueprintEvidenceTag, number> = {
    实拍可见: 0,
    推算: 0,
    无资料: 0,
  }
  const errors: string[] = []
  const seenIds = new Set<string>()

  for (const item of entries) {
    if (!item.id || seenIds.has(item.id)) errors.push(`duplicate_or_empty_id:${item.id}`)
    seenIds.add(item.id)
    if (!Number.isFinite(item.valueM) || item.valueM <= 0) errors.push(`invalid_value:${item.id}`)
    if (!ALLOWED_TAGS.has(item.tag)) {
      errors.push(`invalid_tag:${item.id}`)
    } else {
      countsByTag[item.tag] += 1
    }
    if (!item.source || item.source.trim().length < 2) errors.push(`missing_source:${item.id}`)
  }

  return {
    valid: errors.length === 0 && entries.length >= 25,
    count: entries.length,
    countsByTag,
    errors,
  }
}

export function validateAllDrinksBlueprints(): Record<DrinksCandidateId, BlueprintValidationResult> {
  return {
    poi_zhengyang208: validateDrinksBlueprint(DRINKS_SHOP_CANDIDATES.poi_zhengyang208.entries),
    wangcheng_mall: validateDrinksBlueprint(DRINKS_SHOP_CANDIDATES.wangcheng_mall.entries),
  }
}
