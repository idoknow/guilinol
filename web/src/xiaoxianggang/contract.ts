/**
 * 小香港商业城 · 路线 A（下沉口 → 独立室内场景）骨架契约 v1。
 *
 * 本文件只放类型、常量和纯函数，不依赖宿主运行时，不导入 three 的值（仅类型）。
 * Carbon（runtime）、Hy1（layout）、Hy2（look）都按这里的字段实现；改动必须先改
 * docs/xiaoxianggang/contract.md 并递增 XXG_CONTRACT_VERSION。
 *
 * 数据来源：pipeline/landmarks/central_square.py
 *   - 锚点 anchor = (-845, 232)，landmarks.json rotation = 0；
 *   - 广场轴向坐标 _ax_pt(along_east, across_south)：E = (0.938, 0.346)，S = (-0.346, 0.938)；
 *   - 四个下沉口 _underground_portal(cx, cz, yaw)：(-22, +26.5, AXIS_YAW)、(-22, -26.5, AXIS_YAW+π)、
 *     (-78, +19.5, AXIS_YAW)、(-78, -19.5, AXIS_YAW)，AXIS_YAW = atan2(-0.938, -0.346)；
 *   - 下沉口局部几何：开口在局部 +Z（顶级台阶外沿 z≈3.96），玩家朝局部 -Z 下行，后墙 z=-4.15；
 *   - 入口地面高 153.868m（B_plaza_pave，Hy2 调研 audit_grounding 6/6 pass）。
 */
import type * as THREE from 'three'

export const XXG_CONTRACT_VERSION = 1 as const

// ---------------------------------------------------------------------------
// 1. 坐标系（唯一）
// ---------------------------------------------------------------------------

export interface XxgXZ {
  readonly x: number
  readonly z: number
}

/**
 * 室内局部坐标系 = 中心广场轴向坐标系：
 *   原点：广场锚点正下方，室内地面 y = 0；单位：米；Y 朝上；
 *   +X：沿广场主轴朝东南偏东（体育馆方向，世界向量 E）；
 *   +Z：横跨主轴朝南（世界向量 S）。
 * 这样每个下沉口在室内的位置就是 central_square.py 里的 _ax_pt 参数，地下出口正好落在地面入口下方。
 * E、S 直接沿用 pipeline 的取值（非严格单位长，行列式 0.99956，正值，右手系不变）；
 * indoorToWorld 与 pipeline 逐位一致，worldToIndoor 用精确逆矩阵，往返误差 < 1e-9m。
 */
export const XXG_FRAME = {
  units: 'm',
  anchorWorld: { x: -845, z: 232 },
  axisE: { x: 0.938, z: 0.346 },
  axisS: { x: -0.346, z: 0.938 },
  /** 地面入口处的世界地面高（m）。 */
  surfaceY: 153.868,
  /** 室内地面 y。室内场景独立渲染，不和世界高程发生关系。 */
  indoorFloorY: 0,
} as const

/** 室内 (x, z) → 世界 (x, z)。只用于小地图、指南针和出口落点换算。 */
export function indoorToWorld(p: XxgXZ): XxgXZ {
  const { anchorWorld: a, axisE: e, axisS: s } = XXG_FRAME
  return { x: a.x + p.x * e.x + p.z * s.x, z: a.z + p.x * e.z + p.z * s.z }
}

/** 世界 (x, z) → 室内 (x, z)：[E S] 的精确逆。 */
export function worldToIndoor(p: XxgXZ): XxgXZ {
  const { anchorWorld: a, axisE: e, axisS: s } = XXG_FRAME
  const det = e.x * s.z - s.x * e.z
  const dx = p.x - a.x
  const dz = p.z - a.z
  return { x: (s.z * dx - s.x * dz) / det, z: (-e.z * dx + e.x * dz) / det }
}

/** 世界里 Object3D.rotation.y = yaw 时，局部 (x, z) 的世界位置（与 pipeline Builder._xf 同一公式）。 */
export function rotateLocal(local: XxgXZ, yaw: number): XxgXZ {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return { x: local.x * c + local.z * s, z: -local.x * s + local.z * c }
}

/** 宿主 walkTo / camera.rotation.y 的朝向约定：相机看向 (-sin yaw, -cos yaw)。 */
export function yawFacing(dir: XxgXZ): number {
  return Math.atan2(-dir.x, -dir.z)
}

// ---------------------------------------------------------------------------
// 2. 四个下沉入口
// ---------------------------------------------------------------------------

export type XxgPortalId = 'E1' | 'E2' | 'W1' | 'W2'

export const XXG_PORTAL_IDS: readonly XxgPortalId[] = ['E1', 'E2', 'W1', 'W2']

export interface XxgPortal {
  readonly id: XxgPortalId
  /** 参照 Hy2 调研命名：E=东侧(along -22)，W=西侧(along -78)；1=南，2=北。 */
  readonly label: string
  /** 室内坐标（= 广场轴向坐标），入口中心。 */
  readonly indoor: XxgXZ
  /** 世界坐标，入口中心（下沉井中心）。 */
  readonly world: XxgXZ
  readonly groundY: number
  /** 入口模型的 rotation.y（与 central_square.py 一致）。 */
  readonly yaw: number
  /** 世界单位向量：玩家下行方向（入口局部 -Z）。 */
  readonly inward: XxgXZ
}

/** 入口局部触发区（局部坐标，单位米）：台阶范围内越过阈线 thresholdZ 且朝内走即进入。 */
export const XXG_PORTAL_TRIGGER = {
  halfWidth: 2.1,
  zMin: -1.2,
  zMax: 3.96,
  /** 越过这条线（局部 z 小于它）且移动方向与 inward 点积 > 0 时触发 enter。 */
  thresholdZ: 3.0,
  /** 与 groundY 的竖直容差。 */
  yTolerance: 2,
  /** 出来后的落点：局部 (0, landingZ)，即开口外 1.5m，面朝外。 */
  landingZ: 5.8,
} as const

const AXIS_YAW = Math.atan2(-0.938, -0.346)

function portal(id: XxgPortalId, label: string, along: number, across: number, yaw: number): XxgPortal {
  const indoor = { x: along, z: across }
  const world = indoorToWorld(indoor)
  const back = rotateLocal({ x: 0, z: -1 }, yaw)
  return { id, label, indoor, world, groundY: XXG_FRAME.surfaceY, yaw, inward: back }
}

export const XXG_PORTALS: readonly XxgPortal[] = [
  portal('E1', '东南入口', -22, 26.5, AXIS_YAW),
  portal('E2', '东北入口', -22, -26.5, AXIS_YAW + Math.PI),
  portal('W1', '西南入口', -78, 19.5, AXIS_YAW),
  portal('W2', '西北入口', -78, -19.5, AXIS_YAW),
]

export function getPortal(id: XxgPortalId): XxgPortal {
  const hit = XXG_PORTALS.find(p => p.id === id)
  if (!hit) throw new Error(`unknown portal ${id}`)
  return hit
}

/** 世界点 → 入口局部坐标。 */
export function worldToPortalLocal(portalDef: XxgPortal, p: XxgXZ): XxgXZ {
  return rotateLocal({ x: p.x - portalDef.world.x, z: p.z - portalDef.world.z }, -portalDef.yaw)
}

/** 出来时的地面落点与朝向（面朝外，walkTo 约定）。 */
export function portalLanding(portalDef: XxgPortal): { x: number; z: number; yaw: number } {
  const off = rotateLocal({ x: 0, z: XXG_PORTAL_TRIGGER.landingZ }, portalDef.yaw)
  const outward = { x: -portalDef.inward.x, z: -portalDef.inward.z }
  return { x: portalDef.world.x + off.x, z: portalDef.world.z + off.z, yaw: yawFacing(outward) }
}

/** 玩家当前位置与速度是否触发进入。纯函数，runtime 每帧调用。 */
export function shouldEnterPortal(portalDef: XxgPortal, pos: { x: number; y: number; z: number }, vel: XxgXZ): boolean {
  if (Math.abs(pos.y - portalDef.groundY) > XXG_PORTAL_TRIGGER.yTolerance) return false
  const l = worldToPortalLocal(portalDef, pos)
  if (Math.abs(l.x) > XXG_PORTAL_TRIGGER.halfWidth) return false
  if (l.z < XXG_PORTAL_TRIGGER.zMin || l.z > XXG_PORTAL_TRIGGER.thresholdZ) return false
  return vel.x * portalDef.inward.x + vel.z * portalDef.inward.z > 0
}

// ---------------------------------------------------------------------------
// 3. 转场时序与性能预算
// ---------------------------------------------------------------------------

export const XXG_TIMING = {
  /** 进入预取半径：离任一入口 ≤ 该距离时 import() 室内模块与素材，转场里不发网络请求。 */
  prefetchRadiusM: 60,
  /** veil(destination) 立即挂载，loading.css 的 opacity 过渡 .28s。 */
  veilFadeInMs: 280,
  /** veil 完全淡入后开始换场：挂载/显示室内、放置玩家、渲染出第一帧，整个阶段 ≤ 300ms。 */
  swapBudgetMs: 300,
  /** veil.done() 的淡出（loading.ts 非 reduced-motion 时 420ms）。 */
  veilFadeOutMs: 420,
  /** 从触发到可操作的总上限。 */
  totalMaxMs: 1000,
  /** 出来后同一入口的再触发冷却，防止落点抖动来回进出。 */
  reenterCooldownMs: 1500,
} as const

export const XXG_BUDGET = {
  indoorDrawCallsMax: 40,
  indoorTrianglesMax: 150_000,
  /** 室内纹理总字节（GPU 估算），与 Hy2 look 验收一致。 */
  indoorTextureBytesMax: 8 * 1024 * 1024,
  swapMsMax: XXG_TIMING.swapBudgetMs,
  /** 转场期间允许出现的纯色空帧数：0（veil 半透明，背后每一帧都必须是世界或室内的完整画面）。 */
  blackFramesMax: 0,
  /** 生产包首包增量：室内代码全部懒加载，main chunk 增量 ≤ 2kB（只含入口触发与预取）。 */
  mainChunkDeltaBytesMax: 2048,
} as const

// ---------------------------------------------------------------------------
// 4. 室内场景接口
// ---------------------------------------------------------------------------

export type XxgState = 'unmounted' | 'idle' | 'entering' | 'inside' | 'exiting' | 'disposed'

/** 允许的状态迁移；runtime 遇到表外迁移必须忽略并返回 false，不抛错。 */
export const XXG_TRANSITIONS: Readonly<Record<XxgState, readonly XxgState[]>> = {
  unmounted: ['idle', 'disposed'],
  idle: ['entering', 'disposed'],
  entering: ['inside', 'idle', 'disposed'],
  inside: ['exiting', 'disposed'],
  exiting: ['idle', 'disposed'],
  disposed: [],
}

export function canTransition(from: XxgState, to: XxgState): boolean {
  return XXG_TRANSITIONS[from].includes(to)
}

/** 宿主给室内模块的能力，全部由整合步在 main.ts 落地（SHARE+）。 */
export interface XxgHostContext {
  readonly renderer: THREE.WebGLRenderer
  /** 世界相机；室内不改它，只在出来时由宿主恢复。 */
  readonly worldCamera: THREE.PerspectiveCamera
  /** 步行中返回玩家世界位置与水平速度；骑车、开车、飞行时返回 null（不触发入口）。 */
  getWalker(): { position: { x: number; y: number; z: number }; velocity: XxgXZ } | null
  /** 打开转场遮罩，直接用 web/src/ui/loading.ts 的 veil(label, { destination })。 */
  openVeil(destination: string): { done(): Promise<void> }
  /** 暂停世界：停步行输入与物理、停世界渲染；宿主主循环改为调用 indoor.step + 渲染 indoor.scene。 */
  suspendWorld(): void
  /** 恢复世界，把玩家放到落点（同步放置，入口周边区块一直在内存里，不走网络）。 */
  resumeWorldAt(point: { x: number; z: number; yaw: number }): Promise<boolean>
  /** 室内期间宿主键盘、触屏处理要让路：runtime 设 document.body.dataset.xxgActive = '1'。 */
  readonly bodyFlag: 'xxgActive'
  /** 可选：将步行玩家传送至中心广场小香港下沉口外（面向入口楼梯）。 */
  teleportToPlaza?: () => Promise<boolean>
}

export interface XxgIndoorMetrics {
  drawCalls: number
  triangles: number
  textureBytes: number
  /** 最近一次 enter 的换场耗时（veil 淡入完成 → 室内首帧渲染完成）。 */
  lastSwapMs: number
  /** 最近一次转场里的纯色空帧数。 */
  lastBlackFrames: number
}

/**
 * 室内场景。独立 THREE.Scene + 自带第一人称相机与碰撞（地面 y=0，墙和铺位为 AABB），
 * 不读世界高程、不碰 world.ts / terrain / walk/physics。
 * 第一人称只用室内自带相机实现，不调用 walk/view-mode.setViewMode，出来后宿主原视角自然保持。
 */
export interface XxgIndoorScene {
  readonly state: XxgState
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  /** unmounted → idle：建场景、加载布局与素材。可重复调用，第二次直接返回。 */
  mount(ctx: XxgHostContext): Promise<void>
  /** idle → entering → inside。时序：openVeil → 等 veilFadeInMs → suspendWorld → 放置玩家到对应出口 → 渲染首帧 → veil.done()。 */
  enter(portalId: XxgPortalId): Promise<boolean>
  /** inside → exiting → idle。时序：openVeil → 等 veilFadeInMs → resumeWorldAt(portalLanding) → veil.done()。 */
  exit(): Promise<boolean>
  /** 每帧；inside 时推进室内玩家并检测出口，idle 时检测入口触发。 */
  step(dtSeconds: number): void
  getMetrics(): XxgIndoorMetrics
  /** 任意状态 → disposed：释放几何、材质、纹理、DOM、监听器，删除 bodyFlag；可重复调用。 */
  dispose(): void
}

/** 室内第一人称玩家参数。 */
export const XXG_PLAYER = {
  eyeHeight: 1.6,
  radius: 0.3,
  walkSpeed: 1.6,
  runSpeed: 3.2,
  fovDeg: 70,
  /** 离开出口楼梯底部进入「出去」触发：站在出口区域内且朝外走。 */
  exitTriggerRadius: 1.5,
} as const

// ---------------------------------------------------------------------------
// 5. 布局 JSON schema（Hy1 产数据，Carbon 读取，Hy2 按 shop/zone id 贴素材）
// ---------------------------------------------------------------------------

export interface XxgRect {
  /** 室内坐标，矩形中心。 */
  x: number
  z: number
  /** 沿 X 的宽、沿 Z 的深（m），与坐标轴对齐。 */
  w: number
  d: number
}

export interface XxgCorridor {
  id: string
  kind: 'main' | 'alley'
  /** 中心线两端点（室内坐标），直线段。 */
  from: XxgXZ
  to: XxgXZ
  /** 净宽（m），≥ XXG_LAYOUT_LIMITS.corridorWidthMin。 */
  width: number
}

export interface XxgShop {
  id: string
  /** 现场铺位编号，如 "A-018"。 */
  no: string
  rect: XxgRect
  /** 铺面朝向的走廊 id。 */
  frontage: string
  /** 招牌文字（可空，Stage 1 空铺）。 */
  name?: string
  /** look 素材键，Hy2 的贴图图集用它索引。 */
  lookKey?: string
}

export interface XxgExit {
  portalId: XxgPortalId
  /** 楼梯底部、玩家落脚点（室内坐标）。必须在对应入口 indoor 坐标 XXG_LAYOUT_LIMITS.exitMaxOffset 米内。 */
  foot: XxgXZ
  /** 玩家进来后面朝的方向（walkTo 约定的 yaw，室内坐标系）。 */
  yaw: number
  /** 楼梯占地（不可走，碰撞用）。 */
  stair: XxgRect
}

export interface XxgLayout {
  version: 1
  units: 'm'
  /** 室内净高（m）。 */
  ceilingHeight: number
  /** 可活动区域外包框（室内坐标），所有铺位、走廊端点、出口都必须在框内。 */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  corridors: XxgCorridor[]
  shops: XxgShop[]
  /** 柱网：x 列坐标 × z 行坐标，方柱边长 size。 */
  columns: { xs: number[]; zs: number[]; size: number }
  /** 四个出口各一个，与 XXG_PORTAL_IDS 一一对应。 */
  exits: XxgExit[]
  /** 资料来源（Hy1 的平面依据），每条写清出处。 */
  sources: string[]
}

export const XXG_LAYOUT_LIMITS = {
  ceilingHeightMin: 2.6,
  ceilingHeightMax: 6,
  corridorWidthMin: 2.4,
  shopSideMin: 1.5,
  exitMaxOffset: 6,
  overlapEpsilon: 0.01,
} as const

function inBounds(b: XxgLayout['bounds'], p: XxgXZ): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ
}

function rectsOverlap(a: XxgRect, b: XxgRect, eps: number): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w - eps * 2 && Math.abs(a.z - b.z) * 2 < a.d + b.d - eps * 2
}

/** 校验布局，返回错误列表；空数组 = 通过。Hy1 单测和 Carbon 运行时加载都调用它。 */
export function validateXxgLayout(input: unknown): string[] {
  const errors: string[] = []
  const L = XXG_LAYOUT_LIMITS
  if (!input || typeof input !== 'object') return ['layout 不是对象']
  const layout = input as XxgLayout
  if (layout.version !== 1) errors.push('version 必须为 1')
  if (layout.units !== 'm') errors.push("units 必须为 'm'")
  if (!(layout.ceilingHeight >= L.ceilingHeightMin && layout.ceilingHeight <= L.ceilingHeightMax)) {
    errors.push(`ceilingHeight 须在 [${L.ceilingHeightMin}, ${L.ceilingHeightMax}]`)
  }
  const b = layout.bounds
  if (!b || !(b.minX < b.maxX && b.minZ < b.maxZ)) {
    errors.push('bounds 非法')
    return errors
  }
  const ids = new Set<string>()
  const corridorIds = new Set<string>()
  for (const c of layout.corridors ?? []) {
    if (ids.has(c.id)) errors.push(`id 重复: ${c.id}`)
    ids.add(c.id)
    corridorIds.add(c.id)
    if (!(c.width >= L.corridorWidthMin)) errors.push(`走廊 ${c.id} 宽 ${c.width} < ${L.corridorWidthMin}`)
    if (!inBounds(b, c.from) || !inBounds(b, c.to)) errors.push(`走廊 ${c.id} 端点出界`)
  }
  if (!(layout.corridors?.some(c => c.kind === 'main'))) errors.push('至少需要一条 main 走廊')
  const shops = layout.shops ?? []
  for (const s of shops) {
    if (ids.has(s.id)) errors.push(`id 重复: ${s.id}`)
    ids.add(s.id)
    const r = s.rect
    if (!(r && r.w >= L.shopSideMin && r.d >= L.shopSideMin)) errors.push(`铺位 ${s.id} 尺寸过小`)
    else if (!inBounds(b, { x: r.x - r.w / 2, z: r.z - r.d / 2 }) || !inBounds(b, { x: r.x + r.w / 2, z: r.z + r.d / 2 })) {
      errors.push(`铺位 ${s.id} 出界`)
    }
    if (!corridorIds.has(s.frontage)) errors.push(`铺位 ${s.id} 的 frontage ${s.frontage} 不存在`)
  }
  for (let i = 0; i < shops.length; i++) {
    for (let j = i + 1; j < shops.length; j++) {
      if (shops[i].rect && shops[j].rect && rectsOverlap(shops[i].rect, shops[j].rect, L.overlapEpsilon)) {
        errors.push(`铺位重叠: ${shops[i].id} / ${shops[j].id}`)
      }
    }
  }
  const exits = layout.exits ?? []
  for (const id of XXG_PORTAL_IDS) {
    const hits = exits.filter(e => e.portalId === id)
    if (hits.length !== 1) {
      errors.push(`出口 ${id} 须恰好 1 个，实际 ${hits.length}`)
      continue
    }
    const e = hits[0]
    const p = getPortal(id).indoor
    if (Math.hypot(e.foot.x - p.x, e.foot.z - p.z) > L.exitMaxOffset) errors.push(`出口 ${id} 离入口正下方超过 ${L.exitMaxOffset}m`)
    if (!inBounds(b, e.foot)) errors.push(`出口 ${id} 出界`)
  }
  if (!(layout.columns && layout.columns.size > 0)) errors.push('columns.size 须 > 0')
  if (!(layout.sources?.length)) errors.push('sources 不能为空')
  return errors
}
