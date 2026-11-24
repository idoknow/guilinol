/**
 * 王城鲜饮旗舰店 · 1:1 建筑尺度与结构蓝图（shop-local 米制坐标）。
 *
 * 与 `drinks/sim/menu.ts` 的 `createDefaultDrinksLayout()` 空间一一对应：
 * - X ∈ [-5.70, +5.70]（总面宽 11.40 m）
 * - Z ∈ [-4.60, +5.20]（后墙 -4.60 m → 玻璃幕墙正门 +2.80 m → 外摆露台 +5.20 m）
 *
 * 每条尺寸均按事实依据严格标注来源标签：
 * - `实拍可见`：直接由仓库本地 2026-11-19 实拍图可见（含照片编号与几何特征）
 * - `推算`：由实拍可见结构分格 / 行业人体工学标准按比例换算，非实测卷尺数据
 * - `无资料`：实拍被遮挡或公开图源未录得实测值，仅作为程序对齐占位定尺
 */

export type BlueprintEvidenceTag = '实拍可见' | '推算' | '无资料'

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

export const DRINKS_SHOP_SITE = {
  landmarkRef: 'wangcheng_mall (way/264901525)',
  district: '桂林市秀峰区 · 正阳步行街 / 王城商厦路口转角裙房',
  osmFootprintBoundsLocal: { xMin: -619, xMax: -543, zMin: -71, zMax: -3 },
  primaryPhotoRef: 'docs/refs/rock/walk-shizijie-wangcheng/06_IMG_1395.jpg',
  secondaryPhotoRef: 'docs/refs/rock/walk-shizijie-wangcheng/10_IMG_1399.jpg',
} as const

export const DRINKS_SHOP_BLUEPRINT_ENTRIES: readonly BlueprintDimensionEntry[] = [
  {
    id: 'facade_podium_storeys',
    label: '转角旗舰红色裙房包装层数',
    zone: 'facade',
    valueM: 2,
    unit: 'storeys',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/06_IMG_1395.jpg（2026-11-19实拍）',
    notes: '王城·商厦转角底部1-2层通高红色包框裙房，其上方承接4层黑框玻璃幕墙标准层（共6层）。',
  },
  {
    id: 'shop_width',
    label: '临街总面宽（开间）',
    zone: 'site',
    valueM: 11.4,
    unit: 'm',
    tag: '推算',
    source: '按 docs/refs/rock/walk-shizijie-wangcheng/06_IMG_1395.jpg 约 10–12 格幕墙分格（约1.0m/格）推算，并对齐 sim/menu.ts width=11.40',
    notes: 'x ∈ [-5.70, +5.70]，覆盖主立面红框展面与右侧转角竖向包柱。',
  },
  {
    id: 'interior_depth',
    label: '室内净进深',
    zone: 'site',
    valueM: 7.4,
    unit: 'm',
    tag: '无资料',
    source: '无资料（06_IMG_1395.jpg 首层进深与后场被公交车及外墙遮挡，公开地图无室内实测）；按 sim/menu.ts z∈[-4.60,+2.80] 对齐',
    notes: '室内净面积约 84.4㎡（含前厅客席、收银吧台、后场制茶备料台及仓储区）。',
  },
  {
    id: 'patio_depth',
    label: '门前外摆露台与人行退界进深',
    zone: 'site',
    valueM: 2.4,
    unit: 'm',
    tag: '无资料',
    source: '无资料（06_IMG_1395.jpg 首层地面退界被车辆遮挡）；按 sim/menu.ts patio z∈[+2.80,+5.20] 定尺',
    notes: '承接 patio 4 席外摆座位与街角打卡区，总进深 7.40 + 2.40 = 9.80m。',
  },
  {
    id: 'total_depth',
    label: '总进深（含外摆）',
    zone: 'site',
    valueM: 9.8,
    unit: 'm',
    tag: '无资料',
    source: '无资料（由室内 7.40m + 外摆 2.40m 累加，严格对齐 sim/menu.ts depth=9.80）',
    notes: 'z ∈ [-4.60, +5.20]，确保所有 NPC 队列与座位落点不穿模。',
  },
  {
    id: 'floor1_height',
    label: '首层营业厅层高',
    zone: 'facade',
    valueM: 3.3,
    unit: 'm',
    tag: '推算',
    source: '由 06_IMG_1395.jpg 商厦六层幕墙竖向分格比例及商业首层排风管线净高（>=2.8m）推算',
    notes: '吊顶下净高 3.05m，顶部预留灯膜槽与风口装饰格栅。',
  },
  {
    id: 'floor2_height',
    label: '二层裙房橱窗展区层高',
    zone: 'facade',
    valueM: 3.1,
    unit: 'm',
    tag: '推算',
    source: '由 06_IMG_1395.jpg 红色包框占裙房双层高度与相邻 2F 夹层玻璃窗格推算',
    notes: '与首层合计 6.40m，构成标志性双层转角红白视觉盒体。',
  },
  {
    id: 'podium_total_height',
    label: '转角红框裙房总高度',
    zone: 'facade',
    valueM: 6.4,
    unit: 'm',
    tag: '推算',
    source: '由 06_IMG_1395.jpg 二层包框总高度按两层商业层高 3.30 + 3.10m 累加推算',
    notes: '用于外立面 1-2F 红白形象盒体、雪花纹理带与转角竖招总高。',
  },
  {
    id: 'fascia_height',
    label: '主立面门头横招高度',
    zone: 'facade',
    valueM: 2.55,
    unit: 'm',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/06_IMG_1395.jpg（主红招高宽比约 1:2.5，横跨裙房转角主界面）',
    notes: '面板内容采用原创皮肤（王城冰茶铺 + 几何皇冠冰晶纹），不含真实商业商标。',
  },
  {
    id: 'corner_pillar_width',
    label: '右侧转角竖向包柱招牌宽',
    zone: 'facade',
    valueM: 1.65,
    unit: 'm',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/06_IMG_1395.jpg（右侧转角约 1.5 格幕墙宽双层高竖向红柱）',
    notes: '位于 x ∈ [+4.05, +5.70], z = +2.85，增强正阳/十字街多向视线识别。',
  },
  {
    id: 'curtain_bay_width',
    label: '玻璃幕墙标准立柱模数分格',
    zone: 'facade',
    valueM: 1.05,
    unit: 'm',
    tag: '推算',
    source: '由 06_IMG_1395.jpg 相邻商厦入口 4-5 格深色细框玻璃幕墙比例推算',
    notes: '用于正立面与二层玻璃窗深灰金属细竖梃排布。',
  },
  {
    id: 'door_width',
    label: '正门双开玻璃门净宽',
    zone: 'facade',
    valueM: 2.2,
    unit: 'm',
    tag: '无资料',
    source: '无资料（06_IMG_1395.jpg 首层门口被公交车完全遮挡；按大客流双开平开门通行宽度对齐 entrance x=0.20,z=2.80）',
    notes: '门口范围 x ∈ [-0.90, +1.30]，常开状态迎客，避免 30 人高峰并发进出卡塞。',
  },
  {
    id: 'door_height',
    label: '正门门洞净高',
    zone: 'facade',
    valueM: 2.5,
    unit: 'm',
    tag: '无资料',
    source: '无资料（06_IMG_1395.jpg 底层被遮挡）；按商业玻璃门框通用净高 2.4–2.6m 取值',
    notes: '上方衔接 0.80m 高亮门头吊楣灯箱与风幕机槽位。',
  },
  {
    id: 'front_counter_length',
    label: '前台点单与取餐组合吧台总长',
    zone: 'counter',
    valueM: 7.8,
    unit: 'm',
    tag: '无资料',
    source: '无资料（街景照片不可见室内台体）；按 sim/menu.ts 双收银(-2.25/-0.55)与四取餐格(1.35..3.75)对齐定尺',
    notes: 'x ∈ [-3.70, +4.10], z = -0.38，兼顾点单排队与外卖/堂食叫号分流。',
  },
  {
    id: 'front_counter_height',
    label: '前台点单/出餐台面高度',
    zone: 'counter',
    valueM: 0.96,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按商业茶饮前台防溅高度与点单递杯人体工学 0.85–1.00m 区间定尺）',
    notes: '与 npc/preview.ts 既有台高一致，确保递杯/收银动作与台面严丝合缝。',
  },
  {
    id: 'front_counter_depth',
    label: '前台吧台进深',
    zone: 'counter',
    valueM: 0.68,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按商用点单/取餐吧台常规台深 0.60–0.75m 定尺）',
    notes: '面向客区一侧留足扫码/取餐台沿与玻璃挡板。',
  },
  {
    id: 'prep_bar_length',
    label: '后场现制设备操作总台长',
    zone: 'prep',
    valueM: 8.0,
    unit: 'm',
    tag: '无资料',
    source: '无资料（无后场实拍）；按 sim/menu.ts 四台制茶/碎冰/冰淇淋工位(-3.2,-1.4,+0.4,+2.1)连通排版定尺',
    notes: 'x ∈ [-4.20, +3.80], z = -3.25，划分鲜果碎冰、摇茶萃取与圣代甜筒三区。',
  },
  {
    id: 'prep_bar_height',
    label: '后场不锈钢操作台面高度',
    zone: 'prep',
    valueM: 0.88,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按商用餐饮后厨 800–880mm 立姿工作台人体工学定尺）',
    notes: '上方台面安置制冰槽、摇茶机、蒸汽萃取头与双缸甜筒冰淇淋机。',
  },
  {
    id: 'prep_bar_depth',
    label: '后场操作台进深',
    zone: 'prep',
    valueM: 0.78,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按商用制冰机/封口机设备底脚 700–800mm 要求定尺）',
    notes: '台下设不锈钢双开冷藏备料柜。',
  },
  {
    id: 'staff_aisle_width',
    label: '吧台内部员工双人交错过道净宽',
    zone: 'prep',
    valueM: 1.25,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按茶饮后场双人背对背通行净宽 1.0–1.25m 规范并配合 patrolPoints z=-1.65 设定）',
    notes: '保障点单员、调饮员与补料员交错穿行不穿台体。',
  },
  {
    id: 'customer_hall_depth',
    label: '前厅点单排队与等餐主通廊进深',
    zone: 'seating',
    valueM: 2.6,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按主通道 >=1.5m 与 sim/menu.ts z∈[0.0,+2.6] 排队等餐区间设定）',
    notes: '满足两列点单队列与右侧取餐等候区并行。',
  },
  {
    id: 'dining_table_size',
    label: '双人饮品小方桌边长',
    zone: 'seating',
    valueM: 0.64,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按轻量茶饮双人方桌常见 600–700mm 尺寸并对齐 layout.seats）',
    notes: '桌面高 0.74m，配 0.44m 坐高单人椅，内外共 10 席。',
  },
  {
    id: 'dining_seat_height',
    label: '客席椅坐面高度',
    zone: 'seating',
    valueM: 0.44,
    unit: 'm',
    tag: '无资料',
    source: '无资料（按常规餐饮座椅 420–450mm 人体工学定尺）',
    notes: '室内米木暖色椅面，室外露台珊瑚砖红坐垫。',
  },
  {
    id: 'mascot_showcase_height',
    label: '门前转角立体冰冠精灵打卡雕像高',
    zone: 'decor',
    valueM: 2.05,
    unit: 'm',
    tag: '实拍可见',
    source: 'docs/refs/rock/walk-shizijie-wangcheng/06_IMG_1395.jpg（红白转角门面外摆大尺寸半身打卡装置与二层橱窗展台）',
    notes: '模型严格用原创「皇冠冰晶精灵」几何造型替代外部商业IP形象，零商标特征。',
  },
] as const

export type DrinksBlueprintId = (typeof DRINKS_SHOP_BLUEPRINT_ENTRIES)[number]['id']

export const DRINKS_SHOP_BLUEPRINT: Readonly<Record<string, BlueprintDimensionEntry>> = Object.freeze(
  Object.fromEntries(DRINKS_SHOP_BLUEPRINT_ENTRIES.map(entry => [entry.id, entry])),
)

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
