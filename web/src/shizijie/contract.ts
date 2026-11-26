/**
 * 十字街地下街 B1 · 路线 A（地面楼梯口 → 独立室内场景）骨架契约 v1（冻结）。
 *
 * 本文件只放类型、常量和纯函数，不依赖宿主运行时，不导入 three 的值（仅类型）。
 * Carbon（runtime）、Gemini（locomotion/stairs）、Hy1（layout）、Hy2（look）、Neon（crowd）
 * 都按这里的字段实现；改动必须先改 docs/shizijie/contract.md 并递增 SZJ_CONTRACT_VERSION，
 * 只由组长发布。
 *
 * 数据来源（只读，不改）：/Users/pan-work/guilinol-xp-overnight/pipeline/shizijie_underpass.py
 *   - SHIZIJIE_ORIGIN = (-879.7502021582604, -169.62604470000713)；SHIZIJIE_SURFACE_Y = 151.3；
 *     UNDERPASS_DEPTH = 4.2；
 *   - STAIRWELLS：4 个地面楼梯井（nw/ne/se/sw），十字街局部 (x, z) + yawDeg + width + length；
 *   - 楼梯井局部几何：局部 -Z（lz = -length/2）是街面开口，+Z（lz = +length/2）下到 -4.2m；
 *   - 局部 → 世界：stair_local_to_frame = (cx + lx·c + lz·s, cz − lx·s + lz·c)，即 three.js rotation.y。
 * 路线 A 不挖地：地面只放入口罩（Hy2 look），楼梯和地下街全部在独立室内场景里。
 */
import type * as THREE from 'three'

export const SZJ_CONTRACT_VERSION = 1 as const

// ---------------------------------------------------------------------------
// 1. 坐标系（唯一）
// ---------------------------------------------------------------------------

export interface SzjXZ {
  readonly x: number
  readonly z: number
}

/**
 * 室内坐标系 = 十字街局部坐标系（pipeline 的 `shizijie` 字段）：
 *   原点：十字街路口中心 SHIZIJIE_ORIGIN 正下方；单位米；Y 朝上；
 *   +X = 世界 +X，+Z = 世界 +Z（纯平移，不旋转、不缩放）；
 *   室内地面 y = indoorFloorY = 0，楼梯顶 = depth = 4.2（与地面落差一致）。
 * 所以地下楼梯正好压在地面楼梯井的正下方，室内坐标 = 世界坐标 − origin。
 */
export const SZJ_FRAME = {
  units: 'm',
  originWorld: { x: -879.7502021582604, z: -169.62604470000713 },
  /** 地面楼梯口处的世界地面高（m），pipeline SHIZIJIE_SURFACE_Y。 */
  surfaceY: 151.3,
  /** 室内地面 y。室内场景独立渲染，不和世界高程发生关系。 */
  indoorFloorY: 0,
  /** 地面到 B1 地面的落差（m），pipeline UNDERPASS_DEPTH。室内楼梯顶面 y = depth。 */
  depth: 4.2,
} as const

/** 室内 (x, z) → 世界 (x, z)。 */
export function indoorToWorld(p: SzjXZ): SzjXZ {
  const o = SZJ_FRAME.originWorld
  return { x: p.x + o.x, z: p.z + o.z }
}

/** 世界 (x, z) → 室内 (x, z)。 */
export function worldToIndoor(p: SzjXZ): SzjXZ {
  const o = SZJ_FRAME.originWorld
  return { x: p.x - o.x, z: p.z - o.z }
}

/** Object3D.rotation.y = yaw 时，局部 (x, z) 的偏移（与 pipeline stair_local_to_frame 同一公式）。 */
export function rotateLocal(local: SzjXZ, yaw: number): SzjXZ {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return { x: local.x * c + local.z * s, z: -local.x * s + local.z * c }
}

/** 宿主 walkTo / camera.rotation.y 的朝向约定：相机看向 (-sin yaw, -cos yaw)。 */
export function yawFacing(dir: SzjXZ): number {
  return Math.atan2(-dir.x, -dir.z)
}

// ---------------------------------------------------------------------------
// 2. 四个楼梯口（地面入口 = 室内楼梯，同一块占地）
// ---------------------------------------------------------------------------

export type SzjStairId = 'nw' | 'ne' | 'se' | 'sw'
export const SZJ_STAIR_IDS: readonly SzjStairId[] = ['nw', 'ne', 'se', 'sw']

/** pipeline STAIRWELLS 原样字段（只读拷贝，逐位一致，校验脚本对拍）。 */
export interface SzjStairwellSource {
  readonly id: SzjStairId
  /** pipeline 的 id，如 'shizijie_stair_nw'；入口罩 mesh 名沿用它。 */
  readonly pipelineId: string
  readonly label: string
  /** 十字街局部 = 室内坐标，楼梯井中心。 */
  readonly local: SzjXZ
  readonly yawDeg: number
  readonly width: number
  readonly length: number
}

export const SZJ_STAIRWELL_SOURCES: readonly SzjStairwellSource[] = [
  { id: 'nw', pipelineId: 'shizijie_stair_nw', label: '南方大厦 · NW出口', local: { x: -22.5, z: -38.8 }, yawDeg: 72.0, width: 3.4, length: 9.0 },
  { id: 'ne', pipelineId: 'shizijie_stair_ne', label: '解放东路 · NE出口', local: { x: 43.0, z: -23.0 }, yawDeg: -45.0, width: 3.4, length: 9.0 },
  { id: 'se', pipelineId: 'shizijie_stair_se', label: '文化大厦 · SE出口', local: { x: 22.5, z: 46.5 }, yawDeg: -158.0, width: 3.4, length: 9.0 },
  { id: 'sw', pipelineId: 'shizijie_stair_sw', label: '微笑堂 · SW出口', local: { x: -46.2, z: 21.5 }, yawDeg: -131.2, width: 3.2, length: 8.8 },
]

/**
 * 楼梯几何规格（所有楼梯口共用）。28 级 × 0.15m = 4.2m，踏面 0.30m，水平投影 8.4m；
 * 剩余长度做顶部平台 landingTop = length − count·tread（nw/ne/se 0.6m，sw 0.4m）。
 * 这份规格同时是 Gemini locomotion/stairs 的输入（结构兼容 SzjStairProfile）。
 */
export const SZJ_STAIR_SPEC = {
  riser: 0.15,
  tread: 0.3,
  count: 28,
  /** 楼梯底部往室内再走出去的落脚距离（m）：foot = 局部 (0, length/2 + footRun)。 */
  footRun: 1.5,
  /** 顶部平台最小长度（m）；任何楼梯口低于它都视为契约错误。 */
  landingTopMin: 0.3,
} as const

/** 交给 locomotion/stairs 的一跑楼梯（不含方向，方向由使用方给）。 */
export interface SzjStairProfile {
  readonly riser: number
  readonly tread: number
  readonly count: number
  readonly width: number
  /** 顶部平台长度（m）。 */
  readonly landingTop: number
  /** 底部落脚长度（m）。 */
  readonly landingFoot: number
}

export interface SzjStairwell {
  readonly id: SzjStairId
  readonly pipelineId: string
  readonly label: string
  /** 室内坐标，楼梯井中心。 */
  readonly indoor: SzjXZ
  /** 世界坐标，楼梯井中心。 */
  readonly world: SzjXZ
  /** rotation.y（弧度），= yawDeg·π/180。 */
  readonly yaw: number
  readonly yawDeg: number
  readonly width: number
  readonly length: number
  /** 世界/室内单位向量：下行方向（局部 +Z）。两个坐标系只差平移，向量相同。 */
  readonly inward: SzjXZ
  readonly profile: SzjStairProfile
  /** 地面开口中心（局部 (0, -length/2)），室内坐标。 */
  readonly mouthIndoor: SzjXZ
  /** 楼梯顶部平台中心，室内坐标，y = depth。进入时玩家放在这里。 */
  readonly topIndoor: SzjXZ
  /** 楼梯最后一级外沿（局部 (0, +length/2)），室内坐标，y = 0。 */
  readonly bottomIndoor: SzjXZ
  /** 底部落脚点，室内坐标，y = 0。脚本下楼的终点。 */
  readonly footIndoor: SzjXZ
  /** 地面入口高度（m）。 */
  readonly groundY: number
}

function deg2rad(d: number): number {
  // 与 CPython math.radians 同式：x * (pi / 180)，逐位一致
  return d * (Math.PI / 180)
}

function stairOffset(center: SzjXZ, yaw: number, lx: number, lz: number): SzjXZ {
  const r = rotateLocal({ x: lx, z: lz }, yaw)
  return { x: center.x + r.x, z: center.z + r.z }
}

function makeStairwell(src: SzjStairwellSource): SzjStairwell {
  const yaw = deg2rad(src.yawDeg)
  const S = SZJ_STAIR_SPEC
  const hl = src.length / 2
  const landingTop = src.length - S.count * S.tread
  const inward = rotateLocal({ x: 0, z: 1 }, yaw)
  return {
    id: src.id,
    pipelineId: src.pipelineId,
    label: src.label,
    indoor: src.local,
    world: indoorToWorld(src.local),
    yaw,
    yawDeg: src.yawDeg,
    width: src.width,
    length: src.length,
    inward,
    profile: { riser: S.riser, tread: S.tread, count: S.count, width: src.width, landingTop, landingFoot: S.footRun },
    mouthIndoor: stairOffset(src.local, yaw, 0, -hl),
    topIndoor: stairOffset(src.local, yaw, 0, -hl + landingTop / 2),
    bottomIndoor: stairOffset(src.local, yaw, 0, hl),
    footIndoor: stairOffset(src.local, yaw, 0, hl + S.footRun),
    groundY: SZJ_FRAME.surfaceY,
  }
}

export const SZJ_STAIRWELLS: readonly SzjStairwell[] = SZJ_STAIRWELL_SOURCES.map(makeStairwell)

export function getStairwell(id: SzjStairId): SzjStairwell {
  const hit = SZJ_STAIRWELLS.find(s => s.id === id)
  if (!hit) throw new Error(`unknown stairwell ${id}`)
  return hit
}

/** 室内坐标点 → 楼梯局部 (lx, lz)。世界点先 worldToIndoor 再调它。 */
export function indoorToStairLocal(st: SzjStairwell, p: SzjXZ): SzjXZ {
  return rotateLocal({ x: p.x - st.indoor.x, z: p.z - st.indoor.z }, -st.yaw)
}

/** 楼梯局部 (lx, lz) → 室内坐标点。 */
export function stairLocalToIndoor(st: SzjStairwell, l: SzjXZ): SzjXZ {
  return stairOffset(st.indoor, st.yaw, l.x, l.z)
}

/** 世界点 → 楼梯局部（地面触发用）。 */
export function worldToStairLocal(st: SzjStairwell, p: SzjXZ): SzjXZ {
  return indoorToStairLocal(st, worldToIndoor(p))
}

/**
 * 室内楼梯踏面高度（几何真值，台阶状，碰撞和放脚用）。lz 为楼梯局部 z：
 *   lz ≤ -hl + landingTop → depth（顶部平台，平台外侧也按 depth，接地面）；
 *   台阶段第 i 级（0 起）踏面 y = depth − (i+1)·riser；
 *   lz ≥ hl → 0（B1 地面）。
 * 平滑后的视线高度由 locomotion/stairs 负责，不在契约里。
 */
export function stairTreadY(st: SzjStairwell, lz: number): number {
  const hl = st.length / 2
  const p = st.profile
  const start = -hl + p.landingTop
  if (lz <= start) return SZJ_FRAME.depth
  if (lz >= hl) return SZJ_FRAME.indoorFloorY
  const i = Math.min(p.count - 1, Math.floor((lz - start) / p.tread))
  return SZJ_FRAME.depth - (i + 1) * p.riser
}

/** 台阶前缘连线（斜坡）高度：从平台边 (depth) 线性降到底部 (0)。坡度 = riser/tread。 */
export function stairNosingY(st: SzjStairwell, lz: number): number {
  const hl = st.length / 2
  const start = -hl + st.profile.landingTop
  if (lz <= start) return SZJ_FRAME.depth
  if (lz >= hl) return SZJ_FRAME.indoorFloorY
  return SZJ_FRAME.depth * (1 - (lz - start) / (hl - start))
}

// ---------------------------------------------------------------------------
// 3. 触发区（楼梯局部坐标，单位米）
// ---------------------------------------------------------------------------

/**
 * 地面进入：楼梯局部 |lx| ≤ width/2 − sideInset，lz ∈ [-hl + zFromMouth, -hl + thresholdFromMouth]，
 * |y − groundY| ≤ yTolerance，且水平速度与 inward 点积 > 0。
 * 室内离开：楼梯局部 |lx| ≤ width/2，lz ≤ -hl + landingTop，室内 y ≥ depth − exitYTolerance，
 * 且速度与 inward 点积 < 0（朝外走）。
 */
export const SZJ_TRIGGER = {
  sideInset: 0.2,
  /** 进入区起点（相对开口，负值 = 开口外）。 */
  zFromMouth: -0.6,
  /** 越过这条线即进入（相对开口，正值 = 罩内）。 */
  thresholdFromMouth: 0.8,
  yTolerance: 2,
  exitYTolerance: 0.3,
  /** 出来后的地面落点：局部 (0, -hl − landingOut)，面朝外。 */
  landingOut: 1.5,
} as const

export function shouldEnterStair(st: SzjStairwell, pos: { x: number; y: number; z: number }, vel: SzjXZ): boolean {
  const T = SZJ_TRIGGER
  if (Math.abs(pos.y - st.groundY) > T.yTolerance) return false
  const l = worldToStairLocal(st, pos)
  const hl = st.length / 2
  if (Math.abs(l.x) > st.width / 2 - T.sideInset) return false
  if (l.z < -hl + T.zFromMouth || l.z > -hl + T.thresholdFromMouth) return false
  return vel.x * st.inward.x + vel.z * st.inward.z > 0
}

/** 室内玩家（室内坐标，y 为脚底高）是否触发离开。 */
export function shouldExitStair(st: SzjStairwell, pos: { x: number; y: number; z: number }, vel: SzjXZ): boolean {
  if (pos.y < SZJ_FRAME.depth - SZJ_TRIGGER.exitYTolerance) return false
  const l = indoorToStairLocal(st, pos)
  if (Math.abs(l.x) > st.width / 2) return false
  if (l.z > -st.length / 2 + st.profile.landingTop) return false
  return vel.x * st.inward.x + vel.z * st.inward.z < 0
}

/** 出来时的地面落点（世界坐标）与朝向（面朝外，walkTo 约定）。 */
export function stairLanding(st: SzjStairwell): { x: number; z: number; yaw: number } {
  const p = indoorToWorld(stairLocalToIndoor(st, { x: 0, z: -st.length / 2 - SZJ_TRIGGER.landingOut }))
  return { x: p.x, z: p.z, yaw: yawFacing({ x: -st.inward.x, z: -st.inward.z }) }
}

/** 进来时室内放置点（顶部平台，脚底 y = depth）与朝向（面朝下行方向）。 */
export function stairEntryPose(st: SzjStairwell): { x: number; y: number; z: number; yaw: number } {
  return { x: st.topIndoor.x, y: SZJ_FRAME.depth, z: st.topIndoor.z, yaw: yawFacing(st.inward) }
}

// ---------------------------------------------------------------------------
// 4. 转场时序与性能预算
// ---------------------------------------------------------------------------

/**
 * 进入：越线 → 锁输入 → openVeil → 等 veilFadeInMs → suspendWorld → 室内相机放到 stairEntryPose
 *       （强制第一人称，俯角 entryPitchDeg）→ 首帧 → veil.done() 同时开始脚本下楼
 *       （水平匀速 descentSpeed，从 topIndoor 走到 footIndoor，视线高度走 locomotion/stairs）→ 交还控制。
 * 离开：玩家自己走上楼梯（locomotion/stairs 平滑）→ shouldExitStair → openVeil → 等 veilFadeInMs
 *       → resumeWorldAt(stairLanding) → veil.done()，宿主恢复进来前的视角。
 */
export const SZJ_TIMING = {
  prefetchRadiusM: 60,
  veilFadeInMs: 280,
  swapBudgetMs: 300,
  veilFadeOutMs: 420,
  /** 触发 → 室内首帧可见（veil 开始淡出）的上限。 */
  totalSwapMaxMs: 1000,
  /** 脚本下楼的水平速度（m/s）。 */
  descentSpeed: 1.8,
  /** 脚本下楼期间输入锁定；超过该时长仍未到终点则直接放到 footIndoor 并交还控制。 */
  descentMaxMs: 7000,
  /** 出来后同一楼梯口的再触发冷却。 */
  reenterCooldownMs: 1500,
} as const

/** 某个楼梯口脚本下楼时长（ms）：topIndoor → footIndoor 水平距离 / descentSpeed。 */
export function descentMs(st: SzjStairwell): number {
  const d = Math.hypot(st.footIndoor.x - st.topIndoor.x, st.footIndoor.z - st.topIndoor.z)
  return (d / SZJ_TIMING.descentSpeed) * 1000
}

export const SZJ_BUDGET = {
  indoorDrawCallsMax: 60,
  indoorTrianglesMax: 200_000,
  indoorTextureBytesMax: 8 * 1024 * 1024,
  swapMsMax: SZJ_TIMING.swapBudgetMs,
  blackFramesMax: 0,
  /** 室内 NPC 总数上限：shop npcSpots + walker 路线人数之和。 */
  npcMax: 48,
  /** 全部 NPC 合计 drawCall 上限（实例化）。 */
  npcDrawCallsMax: 6,
  /** crowd.step(dt) 平均耗时上限（ms）。 */
  crowdStepMsMax: 1.5,
  /** 上下楼时 60fps 下视线高度每帧变化上限（m）。 */
  eyeDyPerFrameMax: 0.08,
  /** 出来后地面落点误差上限（m）。 */
  landingErrorMax: 0.5,
  mainChunkDeltaBytesMax: 2048,
} as const

// ---------------------------------------------------------------------------
// 5. 室内场景接口
// ---------------------------------------------------------------------------

export type SzjState = 'unmounted' | 'idle' | 'entering' | 'descending' | 'inside' | 'exiting' | 'disposed'

/** 允许的状态迁移；表外迁移必须忽略并返回 false，不抛错。 */
export const SZJ_TRANSITIONS: Readonly<Record<SzjState, readonly SzjState[]>> = {
  unmounted: ['idle', 'disposed'],
  idle: ['entering', 'disposed'],
  entering: ['descending', 'idle', 'disposed'],
  descending: ['inside', 'disposed'],
  inside: ['exiting', 'disposed'],
  exiting: ['idle', 'inside', 'disposed'],
  disposed: [],
}

export function canTransition(from: SzjState, to: SzjState): boolean {
  return SZJ_TRANSITIONS[from].includes(to)
}

/** 宿主能力，全部由整合步在 main.ts 落地（SHARE+）。与小香港同构，bodyFlag 不同。 */
export interface SzjHostContext {
  readonly renderer: THREE.WebGLRenderer
  readonly worldCamera: THREE.PerspectiveCamera
  /** 步行中返回玩家世界位置（脚底）与水平速度；骑车、开车、飞行时返回 null。 */
  getWalker(): { position: { x: number; y: number; z: number }; velocity: SzjXZ } | null
  openVeil(destination: string): { done(): Promise<void> }
  suspendWorld(): void
  resumeWorldAt(point: { x: number; z: number; yaw: number }): Promise<boolean>
  /** 室内期间 runtime 设 document.body.dataset.szjActive = '1'。 */
  readonly bodyFlag: 'szjActive'
}

export interface SzjIndoorMetrics {
  drawCalls: number
  triangles: number
  textureBytes: number
  npcCount: number
  lastSwapMs: number
  lastBlackFrames: number
  /** 最近一次上/下楼过程中视线高度的最大单帧变化（m）。 */
  lastMaxEyeDy: number
  /** 最近一次出来时落点与 stairLanding 的距离（m）。 */
  lastLandingError: number
}

/**
 * 室内场景：独立 THREE.Scene + 自带第一人称相机与碰撞（地面 y=0、楼梯按 stairTreadY、墙与铺位 AABB），
 * 不读世界高程、不碰 world.ts / terrain / walk/physics，不调用 view-mode.setViewMode。
 */
export interface SzjIndoorScene {
  readonly state: SzjState
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  mount(ctx: SzjHostContext): Promise<void>
  /** idle → entering → descending → inside。 */
  enter(stairId: SzjStairId): Promise<boolean>
  /** inside → exiting → idle。 */
  exit(): Promise<boolean>
  step(dtSeconds: number): void
  getMetrics(): SzjIndoorMetrics
  dispose(): void
}

export const SZJ_PLAYER = {
  eyeHeight: 1.6,
  radius: 0.3,
  walkSpeed: 1.6,
  runSpeed: 3.2,
  /** 楼梯上水平速度倍率（上楼 / 下楼）。 */
  stairUpSpeedScale: 0.75,
  stairDownSpeedScale: 0.85,
  fovDeg: 70,
  /** 进入时相机俯角（度，负 = 向下看）。 */
  entryPitchDeg: -18,
} as const

// ---------------------------------------------------------------------------
// 6. 布局 JSON schema（Hy1 产数据，Carbon 读取，Hy2 按 lookKey 贴素材，Neon 按 npcSpots/walkers 放人）
// ---------------------------------------------------------------------------

export interface SzjRect {
  /** 室内坐标，矩形中心；与坐标轴对齐。 */
  x: number
  z: number
  w: number
  d: number
}

export interface SzjCorridor {
  id: string
  kind: 'ring' | 'main' | 'alley'
  /** 折线中心线（室内坐标），≥2 点。 */
  points: SzjXZ[]
  width: number
}

export type SzjShopCategory = 'clothing' | 'phone' | 'snack' | 'drink' | 'accessory' | 'shoes' | 'beauty' | 'toy' | 'other'
export type SzjNpcRole = 'keeper' | 'customer'
export type SzjNpcPose = 'idle' | 'browse' | 'tidy' | 'phone' | 'chat'

export interface SzjNpcSpot {
  role: SzjNpcRole
  pose: SzjNpcPose
  /** 室内坐标。 */
  x: number
  z: number
  /** walkTo 约定的朝向。 */
  yaw: number
}

export interface SzjShop {
  id: string
  kind: 'shop' | 'stall'
  /** 铺位编号，如 "B1-018"。 */
  no: string
  rect: SzjRect
  /** 铺面朝向的走廊 id。 */
  frontage: string
  category: SzjShopCategory
  /** 招牌文字（改写，不用真实品牌）。 */
  name: string
  lookKey?: string
  /** 每铺 1~3 个。 */
  npcSpots: SzjNpcSpot[]
}

export interface SzjWalker {
  id: string
  /** 沿走廊的路径点（室内坐标），≥2 点。 */
  points: SzjXZ[]
  loop: boolean
  /** 这条路线上的行人数。 */
  count: number
}

export interface SzjExit {
  stairId: SzjStairId
  /** 必须与 getStairwell(stairId).indoor 一致（≤ stairMatchEps）。 */
  center: SzjXZ
  /** 必须与 yaw 一致（≤ yawMatchEps）。 */
  yaw: number
  /** 必须与 footIndoor 一致（≤ stairMatchEps）。 */
  foot: SzjXZ
}

export interface SzjLayout {
  version: 1
  units: 'm'
  ceilingHeight: number
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  corridors: SzjCorridor[]
  shops: SzjShop[]
  walkers: SzjWalker[]
  columns: { xs: number[]; zs: number[]; size: number }
  /** 四个楼梯口各一个。 */
  exits: SzjExit[]
  sources: string[]
}

export const SZJ_LAYOUT_LIMITS = {
  ceilingHeightMin: 2.6,
  ceilingHeightMax: 6,
  corridorWidthMin: 2.4,
  shopSideMin: 1.2,
  shopCountMin: 24,
  shopCountMax: 36,
  npcSpotsPerShopMin: 1,
  npcSpotsPerShopMax: 3,
  stairMatchEps: 0.01,
  yawMatchEps: 1e-4,
  /** 铺位与楼梯占地之间的最小净距（m）。 */
  stairClearance: 0.3,
  overlapEpsilon: 0.01,
} as const

function inBounds(b: SzjLayout['bounds'], p: SzjXZ): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ
}

function rectsOverlap(a: SzjRect, b: SzjRect, eps: number): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w - eps * 2 && Math.abs(a.z - b.z) * 2 < a.d + b.d - eps * 2
}

/** 轴对齐矩形与楼梯占地（旋转矩形，外扩 margin）是否相交：分离轴判定。 */
export function rectHitsStair(r: SzjRect, st: SzjStairwell, margin: number): boolean {
  const hw = st.width / 2 + margin
  const hl = st.length / 2 + margin
  const corners = [
    stairLocalToIndoor(st, { x: -hw, z: -hl }),
    stairLocalToIndoor(st, { x: hw, z: -hl }),
    stairLocalToIndoor(st, { x: hw, z: hl }),
    stairLocalToIndoor(st, { x: -hw, z: hl }),
  ]
  const xs = corners.map(c => c.x)
  const zs = corners.map(c => c.z)
  if (Math.max(...xs) <= r.x - r.w / 2 || Math.min(...xs) >= r.x + r.w / 2) return false
  if (Math.max(...zs) <= r.z - r.d / 2 || Math.min(...zs) >= r.z + r.d / 2) return false
  const rc = [
    { x: r.x - r.w / 2, z: r.z - r.d / 2 },
    { x: r.x + r.w / 2, z: r.z - r.d / 2 },
    { x: r.x + r.w / 2, z: r.z + r.d / 2 },
    { x: r.x - r.w / 2, z: r.z + r.d / 2 },
  ].map(p => indoorToStairLocal(st, p))
  const lx = rc.map(c => c.x)
  const lz = rc.map(c => c.z)
  if (Math.max(...lx) <= -hw || Math.min(...lx) >= hw) return false
  if (Math.max(...lz) <= -hl || Math.min(...lz) >= hl) return false
  return true
}

function angleDiff(a: number, b: number): number {
  const d = (((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI
  return Math.abs(d)
}

/** 布局里 NPC 总人数（npcSpots + walkers.count）。 */
export function layoutNpcCount(layout: SzjLayout): number {
  let n = 0
  for (const s of layout.shops ?? []) n += s.npcSpots?.length ?? 0
  for (const w of layout.walkers ?? []) n += w.count ?? 0
  return n
}

/** 校验布局，返回错误列表；空数组 = 通过。Hy1 单测和 Carbon 运行时加载都调用它。 */
export function validateSzjLayout(input: unknown): string[] {
  const errors: string[] = []
  const L = SZJ_LAYOUT_LIMITS
  if (!input || typeof input !== 'object') return ['layout 不是对象']
  const layout = input as SzjLayout
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
    if (!(c.points?.length >= 2)) errors.push(`走廊 ${c.id} 至少 2 点`)
    else if (!c.points.every(p => inBounds(b, p))) errors.push(`走廊 ${c.id} 有点出界`)
  }
  if (!(layout.corridors?.some(c => c.kind === 'ring' || c.kind === 'main'))) errors.push('至少需要一条 ring 或 main 走廊')
  const shops = layout.shops ?? []
  if (shops.length < L.shopCountMin || shops.length > L.shopCountMax) {
    errors.push(`铺位数 ${shops.length} 须在 [${L.shopCountMin}, ${L.shopCountMax}]`)
  }
  for (const s of shops) {
    if (ids.has(s.id)) errors.push(`id 重复: ${s.id}`)
    ids.add(s.id)
    const r = s.rect
    if (!(r && r.w >= L.shopSideMin && r.d >= L.shopSideMin)) errors.push(`铺位 ${s.id} 尺寸过小`)
    else {
      if (!inBounds(b, { x: r.x - r.w / 2, z: r.z - r.d / 2 }) || !inBounds(b, { x: r.x + r.w / 2, z: r.z + r.d / 2 })) {
        errors.push(`铺位 ${s.id} 出界`)
      }
      for (const st of SZJ_STAIRWELLS) {
        if (rectHitsStair(r, st, L.stairClearance)) errors.push(`铺位 ${s.id} 压到楼梯 ${st.id}`)
      }
    }
    if (!corridorIds.has(s.frontage)) errors.push(`铺位 ${s.id} 的 frontage ${s.frontage} 不存在`)
    if (!s.name) errors.push(`铺位 ${s.id} 缺 name`)
    const n = s.npcSpots?.length ?? 0
    if (n < L.npcSpotsPerShopMin || n > L.npcSpotsPerShopMax) {
      errors.push(`铺位 ${s.id} npcSpots ${n} 须在 [${L.npcSpotsPerShopMin}, ${L.npcSpotsPerShopMax}]`)
    }
    for (const p of s.npcSpots ?? []) if (!inBounds(b, p)) errors.push(`铺位 ${s.id} 有 npcSpot 出界`)
  }
  for (let i = 0; i < shops.length; i++) {
    for (let j = i + 1; j < shops.length; j++) {
      if (shops[i].rect && shops[j].rect && rectsOverlap(shops[i].rect, shops[j].rect, L.overlapEpsilon)) {
        errors.push(`铺位重叠: ${shops[i].id} / ${shops[j].id}`)
      }
    }
  }
  for (const w of layout.walkers ?? []) {
    if (ids.has(w.id)) errors.push(`id 重复: ${w.id}`)
    ids.add(w.id)
    if (!(w.points?.length >= 2)) errors.push(`行人路线 ${w.id} 至少 2 点`)
    else if (!w.points.every(p => inBounds(b, p))) errors.push(`行人路线 ${w.id} 有点出界`)
    if (!(Number.isInteger(w.count) && w.count >= 0)) errors.push(`行人路线 ${w.id} count 非法`)
  }
  const npc = layoutNpcCount(layout)
  if (npc > SZJ_BUDGET.npcMax) errors.push(`NPC 总数 ${npc} > ${SZJ_BUDGET.npcMax}`)
  const exits = layout.exits ?? []
  for (const id of SZJ_STAIR_IDS) {
    const hits = exits.filter(e => e.stairId === id)
    if (hits.length !== 1) {
      errors.push(`楼梯口 ${id} 须恰好 1 个，实际 ${hits.length}`)
      continue
    }
    const e = hits[0]
    const st = getStairwell(id)
    if (!(Math.hypot(e.center.x - st.indoor.x, e.center.z - st.indoor.z) <= L.stairMatchEps)) errors.push(`楼梯口 ${id} center 与契约不符`)
    if (!(Math.hypot(e.foot.x - st.footIndoor.x, e.foot.z - st.footIndoor.z) <= L.stairMatchEps)) errors.push(`楼梯口 ${id} foot 与契约不符`)
    if (!(angleDiff(e.yaw, st.yaw) <= L.yawMatchEps)) errors.push(`楼梯口 ${id} yaw 与契约不符`)
    if (!inBounds(b, e.foot)) errors.push(`楼梯口 ${id} foot 出界`)
  }
  if (!(layout.columns && layout.columns.size > 0)) errors.push('columns.size 须 > 0')
  if (!(layout.sources?.length)) errors.push('sources 不能为空')
  return errors
}
