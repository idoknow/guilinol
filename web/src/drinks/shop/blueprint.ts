/**
 * 正阳路 / 王城路口鲜饮旗舰店 · 双候选点位 1:1 建筑尺度与证据蓝图（shop-local 米制坐标）。
 *
 * 与 `drinks/sim/menu.ts` 的 `createDefaultDrinksLayout()` 空间一一对应：
 * - X ∈ [-5.70, +5.70]（总面宽 11.40 m）
 * - Z ∈ [-4.60, +5.20]（后墙 -4.60 m → 玻璃幕墙正门 +2.80 m → 外摆露台 +5.20 m）
 *
 * 显式拆分为仓内文档与实拍交叉比对所得的两个候选点位：
 * 1. `poi_zhengyang208`：仓内 `docs/layout/dongxi-layout.md` 登记 POI（正阳路208号，1 / — 层，置信度中）
 * 2. `wangcheng_mall`：路口东南侧转角实拍裙房（OSM way/264901525，9 层 / 36.9m 主体，1–3F 红色转角包框）
 *
 * 每条尺寸严格按证据分类标注：
 * - `实拍可见`：仅限 `docs/refs/rock/walk-shizijie-wangcheng/{04,06,08,09}*.jpg` 画面直接可辨的构造（附照片编号与画面位置）
 * - `推算`：由实拍幕墙分格比例 / `dongxi-layout.md` 层数及人体工学按比例换算，非卷尺实测
 * - `无资料`：首层门口/退界/室内被公交车、小车、树冠或外墙遮挡，按 sim 对齐或行业定尺占位
 */

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

const SHARED_INTERIOR_NO_DATA_ENTRIES: readonly BlueprintDimensionEntry[] = [
  {
    id: 'interior_depth',
    label: '室内净进深',
    zone: 'site',
    valueM: 7.4,
    unit: 'm',
    tag: '无资料',
    source: '无资料（04/06/08/09 首层与室内进深均被公交车、社会车辆及外立面完全遮挡，公开地图无室内实测）；按 sim/menu.ts z∈[-4.60,+2.80] 对齐',
    notes: '室内净面积约 84.4㎡（前厅客席、收银取餐吧台、三区制作岛台与仓储区）。',
  },
  {
    id: 'patio_depth',
    label: '门前外摆露台与退界进深',
    zone: 'site',
    valueM: 2.4,
    unit: 'm',
    tag: '无资料',
    source: '无资料（04/06/08 商店紧邻路缘退界被公交车与绿化隔离带遮挡）；按 sim/menu.ts patio z∈[+2.80,+5.20] 定尺',
    notes: '承载 4 席外摆座位与门前打卡区。',
  },
  {
    id: 'total_depth',
    label: '总进深（含外摆）',
    zone: 'site',
    valueM: 9.8,
    unit: 'm',
    tag: '无资料',
    source: '无资料（室内 7.40m + 外摆 2.40m 累加，严格对齐 sim/menu.ts depth=9.80）',
    notes: 'z ∈ [-4.60, +5.20]，确保全部工位与客流路径零穿模。',
  },
  {
    id: 'door_width',
    label: '正门双开玻璃门净宽',
    zone: 'facade',
    valueM: 2.2,
    unit: 'm',
    tag: '无资料',
    source: '无资料（04/06/08 首层开门尺度被车流遮挡）；按大客流双开平开门通行净宽对齐 entrance x=0.20,z=2.80',
    notes: '门口范围 x ∈ [-0.90, +1.30]，常开状态保障高峰 30 NPC 顺畅通行。',
  },
  {
    id: 'door_height',
    label: '正门门洞净高',
    zone: 'facade',
    valueM: 2.5,
    unit: 'm',
    tag: '无资料',
    source: '无资料（04/06/08 首层被车流遮挡）；按商业玻璃门框通用净高 2.4–2.6m 定尺',
    notes: '上方衔接亮面吊楣横框。',
  },
  {
    id: 'front_counter_length',
    label: '前台点单与取餐组合吧台总长',
    zone: 'counter',
    valueM: 7.8,
    unit: 'm',
    tag: '无资料',
    source: '无资料（街景实拍不可见室内吧台）；按 sim/menu.ts 双收银(-2.55/-0.35)与四取餐格(+1.40..+3.90)对齐定尺',
    notes: 'x ∈ [-3.50, +4.30], z = -0.38，左侧收银点单台与右侧取餐区明确分区标牌。',
  },
  {
    id: 'front_counter_height',
    label: '前台点单/出餐台面高度',
    zone: 'counter',
    valueM: 0.96,
    unit: 'm',
    tag: '无资料',
    source: '无资料（无室内测量）；按茶饮商业收银递杯人体工学 0.90–1.00m 区间定尺',
    notes: '匹配营业 NPC 手部递杯高度。',
  },
  {
    id: 'front_counter_depth',
    label: '前台吧台进深',
    zone: 'counter',
    valueM: 0.68,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按商用收银台/出杯台常见 0.60–0.75m 深度定尺）',
    notes: '保留扫码点单沿与出杯防溅玻璃挡板空间。',
  },
  {
    id: 'prep_bar_length',
    label: '后场开放式三区操作台总长',
    zone: 'prep',
    valueM: 8.0,
    unit: 'm',
    tag: '无资料',
    source: '无资料（无后场照片）；按 sim/menu.ts 鲜果(-3.20)、萃茶(-1.35/+0.50)、冰淇淋(+2.25)工位连通定尺',
    notes: 'x ∈ [-4.20, +3.80], z = -3.35，明确划分鲜果碎冰、摇茶封口、冰淇淋奶浆三区。',
  },
  {
    id: 'prep_bar_height',
    label: '后场不锈钢操作台高度',
    zone: 'prep',
    valueM: 0.88,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按餐饮后厨 850–900mm 站姿台面人体工学定尺）',
    notes: '承载制冰机、双萃茶桶、果糖架、封口机与三拉杆甜筒冰淇淋机。',
  },
  {
    id: 'prep_bar_depth',
    label: '后场操作台进深',
    zone: 'prep',
    valueM: 0.78,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按商用制冰/冰淇淋机底脚 700–800mm 要求定尺）',
    notes: '后背设防水瓷砖墙与分区灯箱标牌。',
  },
  {
    id: 'staff_aisle_width',
    label: '吧台内侧员工双人过道净宽',
    zone: 'prep',
    valueM: 1.25,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按茶饮后场双人交错过道标准及 patrolPoints z=-1.40、prep z=-2.35 配合定尺）',
    notes: '保证点单、制茶与补料动线互不干涉。',
  },
  {
    id: 'customer_hall_depth',
    label: '前厅点单排队与等餐通廊进深',
    zone: 'seating',
    valueM: 2.6,
    unit: 'm',
    tag: '无资料',
    source: '无资料（依据通道 >=1.5m 及 sim/menu.ts z∈[0.0,+2.6] 排队等待落点定尺）',
    notes: '避开东西侧客席桌椅与候餐队列碰撞。',
  },
  {
    id: 'dining_table_size',
    label: '客席饮品桌标准面宽',
    zone: 'seating',
    valueM: 0.64,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按轻食茶饮双人方桌 600–700mm 通用规格并对齐 layout.seats 定尺）',
    notes: '东侧紧邻候餐区采用 0.42m 紧凑圆角小桌防止挡道。',
  },
  {
    id: 'dining_seat_height',
    label: '客席椅坐面高度',
    zone: 'seating',
    valueM: 0.44,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按常规饮品座高 420–450mm 人体工学定尺）',
    notes: '室内暖木色、室外珊瑚红色椅面区分内外区。',
  },
  {
    id: 'mascot_showcase_height',
    label: '门前迎宾打卡立像定量高度',
    zone: 'decor',
    valueM: 2.05,
    unit: 'm',
    tag: '无资料',
    source: '无资料（04/06/08 仅见高位大型打卡雕塑轮廓，地面底座与准确米数被车流遮挡；按街角迎宾雕塑比例定尺）',
    notes: '造型严格采用原创「皇冠冰晶精灵」几何形象，零商业商标。',
  },
] as const

const WANGCHENG_MALL_SITE: DrinksShopCandidateSite = {
  id: 'wangcheng_mall',
  title: '候选点位 B · 王城·商厦路口转角裙房（OSM way/264901525）',
  landmarkRef: 'wangcheng_mall (way/264901525)',
  district: '桂林市秀峰区 · 解放东路与正阳步行街口王城·商厦转角裙房',
  lonLat: [110.2942305, 25.2803115],
  bearingDeg: 12.6,
  reportedStoreys: '9 / 36.9（06/08/09 临街主界面可数 7 层，裙房包框 1–3 层）',
  confidence: '高',
  osmFootprintBoundsLocal: { xMin: -619, xMax: -543, zMin: -71, zMax: -3 },
  primaryPhotoRef: 'docs/refs/rock/walk-shizijie-wangcheng/06_IMG_1395.jpg',
  secondaryPhotoRef: 'docs/refs/rock/walk-shizijie-wangcheng/04_IMG_1393.jpg',
  evidenceRefs: [
    'docs/layout/dongxi-layout.md#L108',
    'docs/refs/rock/walk-shizijie-wangcheng/04_IMG_1393.jpg',
    'docs/refs/rock/walk-shizijie-wangcheng/06_IMG_1395.jpg',
    'docs/refs/rock/walk-shizijie-wangcheng/08_IMG_1397.jpg',
    'docs/refs/rock/walk-shizijie-wangcheng/09_IMG_1398.jpg',
  ],
  poiNote: 'OSM way/264901525 锚定王城商厦本体；04/06/08 三张实拍清楚显示红白鲜饮大型转角包框裙房正位于商厦左下转角 1–3F。',
  discrepancyNote: '实拍可见 1–3F 三层通高红盒与上方 4–7F 黑框蓝灰玻璃幕墙、8 格弧角幕墙及右向 3 跨突翼；首层门口、外摆与退界在 04/06/08 均被公交与汽车遮挡，标为「无资料」。',
}

const WANGCHENG_MALL_ENTRIES: readonly BlueprintDimensionEntry[] = [
  {
    id: 'facade_podium_storeys',
    label: '转角旗舰红色裙房包装层数',
    zone: 'facade',
    valueM: 3,
    unit: 'storeys',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/04_IMG_1393.jpg(画面中左x≈23%-40%)、06_IMG_1395.jpg(x≈23%-49%)、08_IMG_1397.jpg(x≈33%-48%)',
    notes: '明确跨越王城·商厦底部 1–3 层，红色包框顶缘与 3F「王城·商厦」窗顶及 4F「5/6楼」窗下檐齐平。',
  },
  {
    id: 'host_visible_storeys',
    label: '王城·商厦临街主立面实拍可数层数',
    zone: 'facade',
    valueM: 7,
    unit: 'storeys',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/06_IMG_1395.jpg、08_IMG_1397.jpg(主楼自地坪至女儿墙顶)',
    notes: '临街前立面 1–7 层黑框玻璃幕墙清楚可数；`dongxi-layout.md#L108` 记录含后退高区整体为 9 层 / 檐高 36.9m。',
  },
  {
    id: 'upper_curtain_panes_main',
    label: '主红招正上方 4F–7F 幕墙横向分格数',
    zone: 'facade',
    valueM: 12,
    unit: 'count',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/06_IMG_1395.jpg(主展面上方4F–7F蓝灰幕墙格数≈12–14格)',
    notes: '左侧树冠旁另有约 3 格与右侧转角竖柱 1 格，上部共承接黑框标准玻璃幕墙。',
  },
  {
    id: 'curved_corner_panes',
    label: '右侧紧邻弧形转角玻璃幕墙竖格数',
    zone: 'facade',
    valueM: 8,
    unit: 'count',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/04_IMG_1393.jpg、06_IMG_1395.jpg、08_IMG_1397.jpg(主红竖柱右侧弧段); 09_IMG_1398.jpg(画面左侧可见右半5–6格)',
    notes: '清楚可数 8 格细黑竖梃弧形转角玻璃，2F 内摆毛绒展品；其右再接 3 跨突翼写「王城电脑城/超市」。',
  },
  {
    id: 'corner_pillar_storeys',
    label: '右侧外凸竖向红白包柱高度与折面特征',
    zone: 'facade',
    valueM: 3,
    unit: 'storeys',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/04_IMG_1393.jpg、06_IMG_1395.jpg(红框右缘竖向折角柱高宽比约4:1)',
    notes: '通贯 1–3 层，带直角折返侧面、顶部雪花纹、竖排白字区域及 2F 高度白底圆角方形徽标。',
  },
  {
    id: 'street_paving_slabs',
    label: '路口街面大块石材铺装（未见盲道）',
    zone: 'site',
    valueM: 1,
    unit: 'count',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/08_IMG_1397.jpg(左下与前景路口人行地坪及黑黄路缘石)',
    notes: '地面实拍为大块深灰矩形石材与黑黄警戒缘石，前景画面中未见黄色条形盲道，建模不强加虚假盲道。',
  },
  {
    id: 'mascot_showcase_visible',
    label: '立面立体大型打卡造型与橱窗公仔存在性',
    zone: 'decor',
    valueM: 2,
    unit: 'count',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/04_IMG_1393.jpg、06_IMG_1395.jpg、08_IMG_1397.jpg(主红招右部巨型半身立体白偶及弧窗2F公仔)',
    notes: '实拍确有立体大型白偶造型与 2F 橱窗摆件，本工程用原创「皇冠冰晶精灵」替换以防侵权。',
  },
  {
    id: 'shop_width',
    label: '临街旗舰主展面总宽（开间）',
    zone: 'site',
    valueM: 11.4,
    unit: 'm',
    tag: '推算',
    source: '由 06_IMG_1395.jpg 主面正上方 12 格标准幕墙分格按 ~0.95m/格 比例推算，并严格对齐 sim/menu.ts width=11.40',
    notes: 'x ∈ [-5.70, +5.70]，覆盖主立面玻璃展面与东侧转角包柱。',
  },
  {
    id: 'curtain_bay_width',
    label: '标准玻璃幕墙立柱模数分格宽',
    zone: 'facade',
    valueM: 0.95,
    unit: 'm',
    tag: '推算',
    source: '由 06_IMG_1395.jpg 主展面 12 格幕墙总宽 11.40m 反算单格宽度',
    notes: '用于 1F 玻璃细竖梃与 4F–6F 商厦主体幕墙网格对齐。',
  },
  {
    id: 'floor1_height',
    label: '首层营业大厅层高',
    zone: 'facade',
    valueM: 3.3,
    unit: 'm',
    tag: '推算',
    source: '由 06_IMG_1395.jpg 裙房 1–3 层竖向比例及商业首层吊顶风管净高要求推算',
    notes: '全透明落地玻璃幕墙展现收银台、价目灯箱与开放制作岛台。',
  },
  {
    id: 'floor2_height',
    label: '二层红色裙房橱窗展区层高',
    zone: 'facade',
    valueM: 3.1,
    unit: 'm',
    tag: '推算',
    source: '由 06_IMG_1395.jpg 右邻弧角 2F 毛绒展窗相对首层比例推算',
    notes: '二层设橱窗展示台。',
  },
  {
    id: 'floor3_height',
    label: '三层红色门头封冠层高',
    zone: 'facade',
    valueM: 3.1,
    unit: 'm',
    tag: '推算',
    source: '由 06_IMG_1395.jpg 红盒顶部紧接 4F 铝塑板窗槛的 3F 标准层高推算',
    notes: '与 1–2F 共同构成 9.50m 三层通高转角红框体块。',
  },
  {
    id: 'podium_total_height',
    label: '1–3F 转角红色裙房总高',
    zone: 'facade',
    valueM: 9.5,
    unit: 'm',
    tag: '推算',
    source: '由实拍 3 层通高红盒按 3.30 + 3.10 + 3.10m 商业层高累加推算（上接 4–6F 幕墙示廓）',
    notes: '对齐 04/06/08 所见 1–3F 齐平高度。',
  },
  {
    id: 'fascia_height',
    label: '2–3F 主立面巨幅红色门头板高',
    zone: 'facade',
    valueM: 4.8,
    unit: 'm',
    tag: '推算',
    source: '由 06_IMG_1395.jpg 主红展面跨 2F 上半至 3F 顶且高宽比约 1:2 比例推算',
    notes: '板面含白边压顶、雪花底纹、原创标题与皇冠徽标。',
  },
  {
    id: 'corner_pillar_width',
    label: '右侧转角外凸竖向包柱招牌宽',
    zone: 'facade',
    valueM: 1.65,
    unit: 'm',
    tag: '推算',
    source: '按 04/06/08 右侧外凸红柱约占 1.5–1.7 格幕墙分格宽推算（高 9.5m、约 4:1 高宽比）',
    notes: 'x ∈ [+4.05, +5.70]，z = +2.85。',
  },
  {
    id: 'awning_projection',
    label: '首层门头浅挑檐外挑深',
    zone: 'facade',
    valueM: 1.05,
    unit: 'm',
    tag: '无资料',
    source: '无资料（06_IMG_1395.jpg 鲜饮首层檐口被公交车挡住；参照右邻王城入口浅金属平雨棚语言定尺）',
    notes: 'y = 2.82m 处为双开门遮雨且不压挡 2F 红招视线。',
  },
  ...SHARED_INTERIOR_NO_DATA_ENTRIES,
] as const

const POI_ZHENGYANG208_SITE: DrinksShopCandidateSite = {
  id: 'poi_zhengyang208',
  title: '候选点位 A · 东西巷牌坊街铺位（正阳路208号 POI）',
  landmarkRef: 'dongxi_arch_poi (正阳路208号 · baidu:89f748120f2470e20bccdde0)',
  district: '桂林市秀峰区 · 正阳路208号（东西巷牌坊南口侧沿街首层铺位）',
  lonLat: [110.2938048, 25.2806767],
  bearingDeg: 13.4,
  reportedStoreys: '1 / —（Confidence: 中）',
  confidence: '中',
  osmFootprintBoundsLocal: { xMin: -619, xMax: -543, zMin: -71, zMax: -3 },
  primaryPhotoRef: 'docs/refs/rock/walk-shizijie-wangcheng/06_IMG_1395.jpg',
  secondaryPhotoRef: 'docs/refs/rock/walk-shizijie-wangcheng/10_IMG_1399.jpg',
  evidenceRefs: [
    'docs/layout/dongxi-layout.md#L116',
    'docs/layout/dongxi-evidence.md',
    'docs/refs/rock/walk-shizijie-wangcheng/04_IMG_1393.jpg',
    'docs/refs/rock/walk-shizijie-wangcheng/06_IMG_1395.jpg',
    'docs/refs/rock/walk-shizijie-wangcheng/08_IMG_1397.jpg',
    'docs/refs/rock/walk-shizijie-wangcheng/10_IMG_1399.jpg',
  ],
  poiNote: '据仓内 `docs/layout/dongxi-layout.md#L116` 登记，百度 POI 仅确认点位归属「正阳路208号」；据 `docs/layout/dongxi-evidence.md`，POI 点不直接提供临街实际开间与门槛尺度。',
  discrepancyNote: '在 04/06/08 主角度中正阳路208号牌坊沿街段首层被前景乔木与车辆遮挡，可见亮眼门面是东南侧王城·商厦 1–3F 红色裙房；10_IMG_1399.jpg 右缘另可见牌坊侧单层横条红招（约 3.5:1），本方案据此落地标准单层平铺旗舰体块与候选 B 对照。',
}

const POI_ZHENGYANG208_ENTRIES: readonly BlueprintDimensionEntry[] = [
  {
    id: 'street_paving_slabs',
    label: '正阳步行街口石材铺装与缘石特征',
    zone: 'site',
    valueM: 1,
    unit: 'count',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/08_IMG_1397.jpg(左下与前景街口石材地坪); 04_IMG_1393.jpg(街道前景)',
    notes: '沿街地坪为深灰矩形石材大板，画面未见连续黄色盲道，建构写实石板街面。',
  },
  {
    id: 'brand_color_system',
    label: '品牌红白门头与雪花边饰视觉体系',
    zone: 'facade',
    valueM: 1,
    unit: 'count',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/04_IMG_1393.jpg、06_IMG_1395.jpg、08_IMG_1397.jpg(街角红白门面); 10_IMG_1399.jpg(牌坊侧单层红条招)',
    notes: '确认统一采用正红主色 + 奶油白边框 + 冰晶雪花纹饰语言（工程去除了全部真实商标文字）。',
  },
  {
    id: 'curtain_mullion_style',
    label: '沿街深色窄框落地透明玻璃橱窗语汇',
    zone: 'facade',
    valueM: 1,
    unit: 'count',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/06_IMG_1395.jpg(中景沿街商业首层黑色窄框玻璃幕墙与透视窗)',
    notes: '208 号本身首层被树冠与车流遮挡，但同段街区商业立面均采用深灰细竖框通透玻璃窗。',
  },
  {
    id: 'corner_mascot_vocab',
    label: '街铺立体白色皇冠迎宾形象语汇',
    zone: 'decor',
    valueM: 1,
    unit: 'count',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/04_IMG_1393.jpg、06_IMG_1395.jpg(同品牌实拍门面立体白偶打卡装置)',
    notes: '实拍街角店配白色立体形象立牌，工程以原创几何「皇冠冰晶精灵」落地。',
  },
  {
    id: 'facade_podium_storeys',
    label: '沿街铺位营业立面层数（POI登记 1 / —）',
    zone: 'facade',
    valueM: 1,
    unit: 'storeys',
    tag: '推算',
    source: '据 docs/layout/dongxi-layout.md#L116 登记「1 / —」（置信度中）及 10_IMG_1399.jpg 牌坊侧单层横向条招形态推算（04/06/08 该段被树遮挡）',
    notes: '采用单层沿街大面宽女儿墙盒体，直观区分于王城·商厦 3 层裙房候选方案。',
  },
  {
    id: 'shop_width',
    label: '沿街大开间总面宽',
    zone: 'site',
    valueM: 11.4,
    unit: 'm',
    tag: '推算',
    source: '据 dongxi-evidence.md 百度 POI 不标定开间宽度，按步行街双开间商铺跨度推算并严格对齐 sim/menu.ts width=11.40',
    notes: 'x ∈ [-5.70, +5.70]，保证店内 10 席客座与四工位后场 1:1 兼容。',
  },
  {
    id: 'floor1_height',
    label: '首层营业大厅净层高',
    zone: 'facade',
    valueM: 3.35,
    unit: 'm',
    tag: '推算',
    source: '按正阳步行街首层商铺常规结构层高与吊顶排风预留净高推算',
    notes: '透明落地玻璃窗高达 3.1m，街外可清晰透视内部收银、价目板与制作区。',
  },
  {
    id: 'parapet_height',
    label: '单层门头含女儿墙压顶总高度',
    zone: 'facade',
    valueM: 4.6,
    unit: 'm',
    tag: '推算',
    source: '由首层 3.35m + 门头女儿墙 1.25m 累加推算，符合 1 层沿街商铺尺度',
    notes: '浅暖石材外框搭配 1.32m 高通长发光红底横招。',
  },
  {
    id: 'fascia_height',
    label: '单层沿街通长水平门头灯箱高',
    zone: 'facade',
    valueM: 1.32,
    unit: 'm',
    tag: '推算',
    source: '按 10_IMG_1399.jpg 所见单层横招高宽比约 1:3.5 结合大开间比例推算',
    notes: '横跨正立面核心区域，夜光字清晰。',
  },
  {
    id: 'curtain_bay_width',
    label: '玻璃幕墙标准分格宽',
    zone: 'facade',
    valueM: 1.15,
    unit: 'm',
    tag: '推算',
    source: '按 11.40m 沿街面宽十跨均分与正门 2.20m 对称划分推算',
    notes: '纤细深棕黑铝框保证极大通透视野。',
  },
  {
    id: 'corner_pillar_width',
    label: '东侧悬挑竖向双面灯箱刀旗宽',
    zone: 'facade',
    valueM: 0.55,
    unit: 'm',
    tag: '推算',
    source: '按步行街单层临街商铺规范侧招刀旗常见 0.50–0.60m 挑出宽度推算',
    notes: '沿步行街方向双向引导客流，无占用主立面巨柱体量。',
  },
  {
    id: 'awning_projection',
    label: '红白条纹可收放门前遮阳挑檐深',
    zone: 'facade',
    valueM: 0.95,
    unit: 'm',
    tag: '无资料',
    source: '无资料（04/06/08 首层被遮挡）；按桂林多雨多晒步行街铺位常规挑棚进深定尺',
    notes: '位于 y = 2.86m，既庇护大门与门口看牌区，又不遮挡顶部主横招。',
  },
  ...SHARED_INTERIOR_NO_DATA_ENTRIES,
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

// 默认向后兼容导出（指向实地实拍可见红框裙房点位 `wangcheng_mall`）
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
    valid: errors.length === 0 && entries.length >= 20,
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
