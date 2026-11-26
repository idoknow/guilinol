import * as T from 'three'
import type {AvatarJointMap, AvatarJointName} from './avatar-rig'

/**
 * 倒地 / 缓一缓 / 连按爬起 状态机 + 程序化姿态（辅警 3.0 · r5 大优化）。
 *
 * 坐标约定（已用 figure.glb 实测）：角色本地朝 -Z，右手 +X。
 * - figure rotX +：向后仰倒；rotX -：向前扑（-π/2 = 趴）。rotZ +：向左倒。
 * - Torso/Head x -：前屈/低头；x +：后仰/抬头。Torso z +：向左歪。
 * - Arm x +：前抬；ArmL z - / ArmR z +：外展。Forearm x +：屈肘。
 * - Thigh x +：屈髋抬腿；ThighL z - / ThighR z +：外展。Shin x -：屈膝。
 *
 * 姿态整体朝向用四元数插值（翻滚/侧滚超过 90° 也不会跳变），骨盆水平锚在 basePos，
 * 用简化正向运动学求身体最低点贴地，保证全程身体不悬空不穿地。
 */

export type KnockdownKind = 'vehicle_hit' | 'bike_crash'
export type KnockdownPhase = 'idle' | 'falling' | 'stunned' | 'mashing' | 'rising'
export type KnockdownVariant =
  | 'front_launch'
  | 'side_topple_l'
  | 'side_topple_r'
  | 'forward_sprawl'
  | 'stagger_kneel'
  | 'bike_slide'
export type KnockdownBreathState = 'pant' | 'clutch_side' | 'look_around' | 'prop_up'

export const KNOCKDOWN_VARIANTS: readonly KnockdownVariant[] = [
  'front_launch',
  'side_topple_l',
  'side_topple_r',
  'forward_sprawl',
  'stagger_kneel',
  'bike_slide',
]
export const KNOCKDOWN_BREATH_STATES: readonly KnockdownBreathState[] = ['pant', 'clutch_side', 'look_around', 'prop_up']
/** 爬起三段：1 趴撑 → 2 跪撑 → 3 单膝；按满后进入 rising（站起拍灰）。 */
/** 倒地俯视补偿上限（弧度）。默认相机俯角 0.3，叠加后约 0.72（41°）。 */
export const KNOCKDOWN_CAMERA_PITCH_BIAS = 0.42

export const KNOCKDOWN_RECOVERY_SEGMENTS = ['趴撑', '跪撑', '单膝'] as const

export type KnockdownDirInput =
  | {x: number; z: number}
  | 'front'
  | 'back'
  | 'left'
  | 'right'

export interface KnockdownOptions {
  mashRequired?: number
  /** 两次按键之间允许的最长间隔；超时退回上一段。 */
  mashWindowSec?: number
  /** 下落时长下限（ride.ts 传滑行时长）；实际取 max(下限, 倒法自带节奏)。 */
  fallDurationSec?: number
  stunDurationSec?: number
  riseDurationSec?: number
  onRecover?: () => void
  /** 随机种子（测试用，保证缓气状态切换可复现）。 */
  seed?: number
}

export interface KnockdownTriggerOptions {
  yaw?: number
  side?: -1 | 1
  reason?: string
}

export interface KnockdownSnapshot {
  isDown: boolean
  isRecovering: boolean
  phase: KnockdownPhase
  kind: KnockdownKind | null
  variant: KnockdownVariant | null
  severity: number
  elapsedSec: number
  phaseElapsedSec: number
  stunProgress: number
  riseProgress: number
  breathPhase: number
  propUpBlend: number
  mashCount: number
  mashRequired: number
  mashProgress: number
  /** 距离“退回上一段”还剩多少秒（未开始按为 0）。 */
  mashWindowRemainingSec: number
  cameraShake: number
  cameraPitchBias?: number
  knockbackVel: {x: number; z: number}
  directionLocal: {forward: number; right: number}
  /** 每次倒地自增，姿态层用它缓存起始朝向。 */
  triggerId?: number
  /** 下落时间轴进度 0..1。 */
  fallU?: number
  /** 倒向：+1 左 / -1 右（侧倒、摔车用）。 */
  side?: number
  /** 摔车侧滚圈数。 */
  rolls?: number
  /** 缓气状态（随机切换）。 */
  breathState?: KnockdownBreathState | null
  prevBreathState?: KnockdownBreathState | null
  breathBlend?: number
  breathStateElapsedSec?: number
  /** 当前爬起段：0 未起 / 1 趴撑 / 2 跪撑 / 3 单膝。 */
  recoverySegment?: number
  /** 平滑后的爬起进度（0..3）。 */
  recoveryProgress?: number
  /** rising 开始时的爬起进度，rising 段从这里接着走到站直。 */
  riseFromProgress?: number
  /** 晃动强度：没站起前按得越多越大。 */
  wobble?: number
  /** 超时退段次数。 */
  fallbackCount?: number
  /** 是否已落地（落地帧额外一次镜头震动）。 */
  landed?: boolean
  lastMashAgeSec?: number
  mashWindowSec?: number
}

export interface KnockdownHudHandle {
  element: HTMLElement | null
  sync: (snap: KnockdownSnapshot) => void
  dispose: () => void
}

export interface KnockdownController {
  readonly isDown: boolean
  readonly isRecovering: boolean
  readonly phase: KnockdownPhase
  readonly variant: KnockdownVariant | null
  readonly kind: KnockdownKind | null
  readonly severity: number
  readonly mashCount: number
  readonly mashRequired: number
  readonly mashProgress: number
  readonly cameraShake: number
  /** 倒地期间额外俯视角（弧度，平滑 0→KNOCKDOWN_CAMERA_PITCH_BIAS→0）：跟随相机加到 pitch 上，从栏杆上方俯看倒地的人。 */
  readonly cameraPitchBias: number
  readonly knockbackVel: {x: number; z: number}
  readonly breathPhase: number
  readonly propUpBlend: number
  readonly breathState: KnockdownBreathState | null
  readonly recoverySegment: number
  triggerKnockdown: (
    kind: KnockdownKind,
    dir: KnockdownDirInput,
    severity?: number,
    opts?: KnockdownTriggerOptions,
  ) => KnockdownSnapshot
  step: (dt: number) => KnockdownSnapshot
  recordRecoverMash: () => boolean
  handleKeyDown: (code: string, repeat?: boolean) => boolean
  forceRise: (instant?: boolean) => boolean
  reset: () => void
  getSnapshot: () => KnockdownSnapshot
  applyPose: (figure: T.Object3D, joints?: Partial<AvatarJointMap>, basePos?: {x: number; y: number; z: number}) => void
  attachHud: (container?: HTMLElement | null) => KnockdownHudHandle
}

const DEFAULT_MASH_REQUIRED = 5
const DEFAULT_MASH_WINDOW_SEC = 2.4
const DEFAULT_STUN_SEC = 1.7
const DEFAULT_RISE_SEC = 1.35
const BREATH_MIN_SEC = 0.95
const BREATH_MAX_SEC = 1.75
const BREATH_FADE_SEC = 0.38

/** 各倒法默认时长（含落地停顿），随力度略放大。 */
const VARIANT_FALL_SEC: Record<KnockdownVariant, number> = {
  front_launch: 1.35,
  side_topple_l: 0.98,
  side_topple_r: 0.98,
  forward_sprawl: 1.0,
  stagger_kneel: 1.3,
  bike_slide: 1.25,
}
/** 落地那一刻在下落时间轴上的位置（0..1）。 */
const VARIANT_LAND_T: Record<KnockdownVariant, number> = {
  front_launch: 0.7,
  side_topple_l: 0.55,
  side_topple_r: 0.55,
  forward_sprawl: 0.6,
  stagger_kneel: 0.72,
  bike_slide: 0.22,
}

const PI = Math.PI
const HALF_PI = Math.PI / 2
const TAU = Math.PI * 2

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function smoothstep(t: number): number {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}

function easeOutCubic(t: number): number {
  const x = clamp01(t)
  return 1 - (1 - x) ** 3
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ───────────────────────────── 方向 / 倒法选择 ─────────────────────────────

/**
 * Resolves an arbitrary world-space impact vector or cardinal keyword into character-local
 * `{ forward, right }` push components and world push unit vector `{ wx, wz }`.
 * Player faces `-Z` at `yaw = 0` (`forward = (-sin(yaw), -cos(yaw))`, `right = (cos(yaw), -sin(yaw))`).
 */
export function resolveKnockdownDirection(
  dir: KnockdownDirInput,
  yaw = 0,
): {forward: number; right: number; wx: number; wz: number} {
  const fwdX = -Math.sin(yaw)
  const fwdZ = -Math.cos(yaw)
  const rightX = Math.cos(yaw)
  const rightZ = -Math.sin(yaw)

  if (typeof dir === 'string') {
    if (dir === 'front') return {forward: 1, right: 0, wx: fwdX, wz: fwdZ}
    if (dir === 'back') return {forward: -1, right: 0, wx: -fwdX, wz: -fwdZ}
    if (dir === 'right') return {forward: 0, right: 1, wx: rightX, wz: rightZ}
    return {forward: 0, right: -1, wx: -rightX, wz: -rightZ}
  }

  const len = Math.hypot(dir.x, dir.z)
  if (!Number.isFinite(len) || len < 1e-5) {
    return {forward: -1, right: 0, wx: -fwdX, wz: -fwdZ}
  }
  const ux = dir.x / len
  const uz = dir.z / len
  return {
    forward: ux * fwdX + uz * fwdZ,
    right: ux * rightX + uz * rightZ,
    wx: ux,
    wz: uz,
  }
}

/**
 * 按推力方向（撞击把人往哪推）和力度选倒法：
 * - `stagger_kneel`：轻擦（力度 < 0.35），踉跄几步单膝跪地
 * - `side_topple_l/r`：侧面被撞，侧倒手撑
 * - `forward_sprawl`：从后面被撞（推向前），向前扑倒双手撑地
 * - `front_launch`：正面被撞（推向后），腾空、翻滚卸力、趴下
 * - `bike_slide`：从电动车 / 单车上摔，侧滑后滚 1~2 圈
 */
export function resolveKnockdownVariant(
  dir: KnockdownDirInput,
  severity: number,
  kind: KnockdownKind,
  opts?: KnockdownTriggerOptions,
): KnockdownVariant {
  const sev = clamp01(Number.isFinite(severity) ? severity : 0.6)
  if (opts?.reason === 'loopout') return 'front_launch'
  const local = resolveKnockdownDirection(dir, opts?.yaw ?? 0)
  const absRight = Math.abs(local.right)
  const absFwd = Math.abs(local.forward)

  if (kind === 'bike_crash') {
    if (opts?.reason === 'lowside' || sev >= 0.4) return 'bike_slide'
    return 'forward_sprawl'
  }
  if (sev < 0.35) return 'stagger_kneel'
  if (absRight > 0.45 && absRight >= absFwd * 0.85) {
    return local.right < 0 ? 'side_topple_l' : 'side_topple_r'
  }
  if (local.forward > 0.25) return 'forward_sprawl'
  return 'front_launch'
}

function resolveSide(variant: KnockdownVariant, local: {right: number}, opts?: KnockdownTriggerOptions): number {
  if (variant === 'side_topple_l') return 1
  if (variant === 'side_topple_r') return -1
  if (opts?.side) return opts.side < 0 ? 1 : -1
  return local.right > 0 ? -1 : 1
}

// ───────────────────────────── 姿态数据 ─────────────────────────────

type Triple = [number, number, number]
type JointPose = Partial<Record<AvatarJointName, Triple>>
/** o = 整体朝向 [rx, ry, rz]（YXZ 欧拉，相对倒地瞬间朝向）；air = 额外腾空高度。 */
interface KPose {
  o: Triple
  air?: number
  j: JointPose
}
interface Key {
  t: number
  p: KPose
  ease?: 'out' | 'lin'
}

const JOINTS: readonly AvatarJointName[] = [
  'Hips', 'Torso', 'Head',
  'ArmL', 'ArmR', 'ForearmL', 'ForearmR',
  'ThighL', 'ThighR', 'ShinL', 'ShinR',
]
const MIRROR_NAME: Record<AvatarJointName, AvatarJointName> = {
  Hips: 'Hips', Torso: 'Torso', Head: 'Head',
  ArmL: 'ArmR', ArmR: 'ArmL', ForearmL: 'ForearmR', ForearmR: 'ForearmL',
  ThighL: 'ThighR', ThighR: 'ThighL', ShinL: 'ShinR', ShinR: 'ShinL',
}

function pose(o: Triple, j: JointPose, air = 0): KPose {
  return {o, j, air}
}

/** 左右镜像（X=0 平面）：L/R 互换，关节 y/z 取反，整体 ry/rz 取反。 */
function mirror(p: KPose): KPose {
  const j: JointPose = {}
  for (const name of JOINTS) {
    const v = p.j[name]
    if (v) j[MIRROR_NAME[name]] = [v[0], -v[1], -v[2]]
  }
  return {o: [p.o[0], -p.o[1], -p.o[2]], air: p.air, j}
}

function withYaw(p: KPose, ry: number): KPose {
  return {o: [p.o[0], p.o[1] + ry, p.o[2]], air: p.air, j: p.j}
}

function withO(p: KPose, o: Triple, air = p.air ?? 0): KPose {
  return {o, air, j: p.j}
}

function tweak(p: KPose, over: JointPose): KPose {
  return {o: p.o, air: p.air, j: {...p.j, ...over}}
}

const STAND = pose([0, 0, 0], {})
const RIDE = pose([0, 0, 0], {
  Torso: [-0.25, 0, 0], ArmL: [0.95, 0, -0.1], ArmR: [0.95, 0, 0.1], ForearmL: [0.45, 0, 0], ForearmR: [0.45, 0, 0],
  ThighL: [1.25, 0, -0.1], ThighR: [1.25, 0, 0.1], ShinL: [-1.3, 0, 0], ShinR: [-1.3, 0, 0],
})

// —— 地面姿态（爬起链节点） ——
/** 趴平：脸侧向一边，一只手伸过头顶、一只手在身侧，一条腿蛙式弯着。 */
const PRONE_FLAT = pose([-HALF_PI, 0, 0], {
  Head: [0.28, 0.78, 0], Torso: [0.05, 0, 0],
  ArmL: [2.85, 0, -0.7], ForearmL: [0.55, 0, 0],
  ArmR: [-0.12, 0, 0.3], ForearmR: [0.15, 0, 0],
  ThighL: [0, 0, -0.12], ShinL: [-0.18, 0, 0],
  ThighR: [0, 0, 0.55], ShinR: [-0.95, 0, 0],
})
/** 趴撑：双手撑在肩下，头抬起，准备推地。 */
const PRONE_HANDS = pose([-1.5, 0, 0], {
  Head: [0.48, 0, 0], Torso: [0.14, 0, 0],
  ArmL: [-0.28, 0, -0.42], ForearmL: [1.85, 0, 0],
  ArmR: [-0.28, 0, 0.42], ForearmR: [1.85, 0, 0],
  ThighL: [0, 0, -0.1], ShinL: [-0.15, 0, 0],
  ThighR: [0, 0, 0.1], ShinR: [-0.2, 0, 0],
})
/** 跪撑：四肢着地，大腿与手臂竖直。 */
const ALL_FOURS = pose([-1.32, 0, 0], {
  Head: [0.58, 0, 0], Torso: [-0.06, 0, 0],
  ArmL: [1.3, 0, -0.08], ForearmL: [0.06, 0, 0],
  ArmR: [1.3, 0, 0.08], ForearmR: [0.06, 0, 0],
  ThighL: [1.4, 0, -0.06], ShinL: [-1.6, 0, 0],
  ThighR: [1.4, 0, 0.06], ShinR: [-1.6, 0, 0],
})
/** 单膝：左脚踩前、右膝着地，手扶左膝。 */
const KNEEL_ONE = pose([0, 0, 0], {
  Head: [0.12, 0, 0], Torso: [-0.3, 0, 0],
  ArmL: [0.78, 0, -0.08], ForearmL: [0.72, 0, 0],
  ArmR: [0.42, 0, 0.16], ForearmR: [0.42, 0, 0],
  ThighL: [1.72, 0, -0.06], ShinL: [-1.72, 0, 0],
  ThighR: [-0.05, 0, 0.05], ShinR: [-1.5, 0, 0],
})
/** 单膝双手压膝、后膝微抬：准备发力。 */
const KNEEL_PUSH = pose([0, 0, 0], {
  Head: [0.2, 0, 0], Torso: [-0.5, 0, 0],
  ArmL: [0.85, 0, 0.12], ForearmL: [0.55, 0, 0],
  ArmR: [0.8, 0, -0.22], ForearmR: [0.62, 0, 0],
  ThighL: [1.6, 0, -0.06], ShinL: [-1.62, 0, 0],
  ThighR: [0.2, 0, 0.05], ShinR: [-1.45, 0, 0],
})
/** 半蹲撑腿：后膝离地，双手压大腿发力。 */
const CROUCH_PUSH = pose([0, 0, 0], {
  Head: [0.22, 0, 0], Torso: [-0.62, 0, 0],
  ArmL: [0.72, 0, 0.12], ForearmL: [0.55, 0, 0],
  ArmR: [0.66, 0, -0.18], ForearmR: [0.6, 0, 0],
  ThighL: [1.15, 0, -0.05], ShinL: [-1.25, 0, 0],
  ThighR: [0.55, 0, 0.05], ShinR: [-1.05, 0, 0],
})
/** 侧倒手撑（向左倒）：左前臂撑地，上身翘起。 */
const SIDE_PROP_L = pose([0, 0, 1.2], {
  Head: [0, 0, -0.38], Torso: [0, 0, -0.36],
  ArmL: [0.5, 0, -0.78], ForearmL: [1.5, 0, 0],
  ArmR: [0.32, 0, 0.22], ForearmR: [0.65, 0, 0],
  ThighL: [0.55, 0, 0], ShinL: [-1.0, 0, 0],
  ThighR: [0.3, 0, 0.05], ShinR: [-0.5, 0, 0],
})
/** 摔车滚完：趴着，头朝倒下那一侧（ry=+π/2 对应向左滚）。 */
const BIKE_REST_L = pose([-HALF_PI, HALF_PI, 0], {
  Head: [0.22, -0.72, 0], Torso: [0.04, 0, 0],
  ArmL: [2.8, 0, -0.75], ForearmL: [0.6, 0, 0],
  ArmR: [-0.1, 0, 0.28], ForearmR: [0.2, 0, 0],
  ThighL: [0, 0, -0.08], ShinL: [-0.25, 0, 0],
  ThighR: [0, 0, 0.5], ShinR: [-1.0, 0, 0],
})
/** 踉跄跪地：单膝，弓背低头，一只手扶膝一只手撑地。 */
const KNEEL_SLUMP = pose([0, 0, 0], {
  Head: [-0.38, 0, 0], Torso: [-0.58, 0, 0.08],
  ArmL: [0.58, 0, 0.05], ForearmL: [0.95, 0, 0],
  ArmR: [0.62, 0, 0.18], ForearmR: [0.12, 0, 0],
  ThighL: [1.72, 0, -0.06], ShinL: [-1.72, 0, 0],
  ThighR: [-0.05, 0, 0.05], ShinR: [-1.5, 0, 0],
})
/** 跪姿双手扶膝：踉跄倒法第 1 段。 */
const KNEEL_BRACE = pose([0, 0, 0], {
  Head: [-0.08, 0, 0], Torso: [-0.72, 0, 0],
  ArmL: [0.92, 0, 0.1], ForearmL: [0.6, 0, 0],
  ArmR: [0.88, 0, -0.26], ForearmR: [0.7, 0, 0],
  ThighL: [1.72, 0, -0.06], ShinL: [-1.72, 0, 0],
  ThighR: [-0.05, 0, 0.05], ShinR: [-1.5, 0, 0],
})

/** 缓气叠加（加在当前地面姿态上的关节增量），三类身体朝向分别给。 */
type Family = 'prone' | 'side' | 'kneel'
const BREATH_DELTA: Record<Family, Record<KnockdownBreathState, JointPose>> = {
  prone: {
    pant: {},
    clutch_side: {ArmR: [0.3, 0, -0.12], ForearmR: [1.35, 0, 0], Torso: [-0.1, 0, -0.14], ThighR: [0.38, 0, 0], ShinR: [-0.45, 0, 0], Head: [-0.12, -0.4, 0]},
    look_around: {Head: [0.42, -0.6, 0], Torso: [0.16, 0, 0]},
    prop_up: {Torso: [0.34, 0, 0], Head: [0.22, -0.5, 0], ArmL: [-1.9, 0, 0.15], ForearmL: [1.2, 0, 0], ArmR: [-0.45, 0, 0.1], ForearmR: [1.5, 0, 0]},
  },
  side: {
    pant: {},
    clutch_side: {ArmR: [0.18, 0, -0.32], ForearmR: [1.0, 0, 0], Torso: [-0.18, 0, 0], ThighL: [0.35, 0, 0], ThighR: [0.4, 0, 0], ShinR: [-0.4, 0, 0], Head: [-0.15, 0, 0]},
    look_around: {Head: [0.3, 0.4, 0.15], Torso: [0.05, 0, -0.05]},
    prop_up: {Torso: [0, 0, -0.26], Head: [0, 0, -0.12], ArmL: [0, 0, -0.18], ForearmL: [-0.55, 0, 0]},
  },
  kneel: {
    pant: {},
    clutch_side: {ArmR: [-0.32, 0, -0.42], ForearmR: [1.45, 0, 0], Torso: [-0.12, 0, -0.18], Head: [-0.15, 0, 0]},
    look_around: {Head: [0.7, 0.55, 0], Torso: [0.3, 0, 0]},
    prop_up: {Torso: [0.4, 0, 0], Head: [0.45, 0, 0], ArmR: [-0.3, 0, 0], ForearmR: [0.5, 0, 0]},
  },
}

function familyOf(variant: KnockdownVariant): Family {
  if (variant === 'side_topple_l' || variant === 'side_topple_r') return 'side'
  if (variant === 'stagger_kneel') return 'kneel'
  return 'prone'
}

/** 爬起链：[倒地休息, 第1段, 第2段, 第3段, 半蹲, 站直]，下标即进度 v（0..5）。 */
function recoveryChain(variant: KnockdownVariant, side: number): KPose[] {
  const s = side >= 0 ? 1 : -1
  if (variant === 'stagger_kneel') {
    return [KNEEL_SLUMP, KNEEL_BRACE, KNEEL_ONE, KNEEL_PUSH, CROUCH_PUSH, STAND]
  }
  if (variant === 'front_launch' || variant === 'forward_sprawl') {
    const rest = variant === 'front_launch' ? PRONE_FLAT : PRONE_HANDS
    return [rest, PRONE_HANDS, ALL_FOURS, KNEEL_ONE, CROUCH_PUSH, STAND]
  }
  const restL = variant === 'bike_slide' ? BIKE_REST_L : SIDE_PROP_L
  return [
    s > 0 ? restL : mirror(restL),
    withYaw(PRONE_HANDS, s * HALF_PI),
    withYaw(ALL_FOURS, s * HALF_PI),
    withYaw(KNEEL_ONE, s * PI * 0.28),
    withYaw(CROUCH_PUSH, s * PI * 0.12),
    STAND,
  ]
}

/** 下落关键帧（t 为 0..1；最后一帧 = 爬起链第 0 个姿态，保证无缝衔接）。 */
function fallKeys(
  variant: KnockdownVariant,
  sev: number,
  side: number,
  rolls: number,
  local: {forward: number; right: number},
  fromRide = false,
): Key[] {
  const keys = fallKeysFromStand(variant, sev, side, rolls, local)
  if (!fromRide || variant === 'bike_slide') return keys
  // 从车上摔：起手是骑姿，撞击帧往前多栽一点（车头一顿人往前飞）
  const [, hit, ...rest] = keys
  const lean: Triple = [hit.p.o[0] - 0.35, hit.p.o[1], hit.p.o[2]]
  return [{t: 0, p: RIDE}, {...hit, p: withO(hit.p, lean, Math.max(hit.p.air ?? 0, 0.12))}, ...rest]
}

function fallKeysFromStand(variant: KnockdownVariant, sev: number, side: number, rolls: number, local: {forward: number; right: number}): Key[] {
  const chain0 = recoveryChain(variant, side)[0]
  const s = side >= 0 ? 1 : -1
  if (variant === 'front_launch') {
    const air = 0.1 + 0.1 * sev
    return [
      {t: 0, p: STAND},
      // 撞击：腿被铲，上身折向车头，手前甩
      {t: 0.08, ease: 'out', p: pose([0.34, 0, 0], {Torso: [-0.58, 0, 0], Head: [-0.48, 0, 0], ArmL: [1.05, 0, -0.5], ArmR: [1.05, 0, 0.5], ForearmL: [0.4, 0, 0], ForearmR: [0.4, 0, 0], ThighL: [0.55, 0, 0], ThighR: [0.35, 0, 0], ShinL: [-0.35, 0, 0], ShinR: [-0.2, 0, 0]}, air * 0.5)},
      // 腾空：向后仰飞，四肢乱甩
      {t: 0.26, p: pose([1.45, 0, 0.12], {Torso: [-0.65, 0, 0], Head: [-0.3, 0, 0], ArmL: [1.9, 0, -1.0], ArmR: [1.6, 0, 1.1], ForearmL: [0.9, 0, 0], ForearmR: [0.6, 0, 0], ThighL: [1.25, 0, 0], ThighR: [0.9, 0, 0], ShinL: [-1.5, 0, 0], ShinR: [-1.1, 0, 0]}, air)},
      // 翻滚卸力：抱团后滚
      {t: 0.44, p: pose([3.0, 0, 0.1], {Torso: [-0.85, 0, 0], Head: [-0.5, 0, 0], ArmL: [1.3, 0, -0.4], ArmR: [1.3, 0, 0.4], ForearmL: [1.5, 0, 0], ForearmR: [1.5, 0, 0], ThighL: [1.7, 0, 0], ThighR: [1.6, 0, 0], ShinL: [-2.0, 0, 0], ShinR: [-1.9, 0, 0]}, air * 0.55)},
      {t: 0.6, p: pose([4.25, 0, 0.05], {Torso: [-0.2, 0, 0], ArmL: [2.0, 0, -0.6], ArmR: [2.0, 0, 0.6], ForearmL: [0.8, 0, 0], ForearmR: [0.8, 0, 0], ThighL: [0.6, 0, 0], ThighR: [0.6, 0, 0], ShinL: [-0.9, 0, 0], ShinR: [-0.9, 0, 0]}, 0.06)},
      // 落地：趴着拍地
      {t: 0.7, ease: 'out', p: withO(tweak(PRONE_FLAT, {Torso: [0.22, 0, 0], Head: [0.4, 0.3, 0], ArmR: [1.6, 0, 0.7]}), [TAU - 1.5, 0, 0], 0)},
      {t: 0.78, p: withO(PRONE_FLAT, [TAU - 1.42, 0, 0], 0.05)},
      // 落地停顿
      {t: 0.88, p: withO(chain0, [TAU - HALF_PI, 0, 0], 0)},
      {t: 1, p: withO(chain0, [TAU - HALF_PI, 0, 0], 0)},
    ]
  }
  if (variant === 'side_topple_l' || variant === 'side_topple_r') {
    const keys: Key[] = [
      {t: 0, p: STAND},
      // 撞击：腿被扫向一侧，上身反向甩
      {t: 0.1, ease: 'out', p: pose([0, 0, -0.22], {Head: [0, 0, -0.38], Torso: [0, 0, -0.1], ArmL: [0.3, 0, -0.9], ArmR: [0.5, 0, 0.9], ThighL: [0.2, 0, -0.35], ThighR: [0.1, 0, -0.2]}, 0.1)},
      // 侧飞：倒下一侧的手伸出去找地
      {t: 0.32, p: pose([0.15, 0, 0.85], {Torso: [0, 0, 0.2], Head: [0, 0, -0.4], ArmL: [0.6, 0, -1.5], ForearmL: [0.2, 0, 0], ArmR: [0.9, 0, 0.6], ForearmR: [0.8, 0, 0], ThighL: [0.3, 0, -0.1], ThighR: [0.4, 0, 0.55], ShinL: [-0.4, 0, 0], ShinR: [-0.6, 0, 0]}, 0.12 + 0.08 * sev)},
      // 侧身砸地
      {t: 0.55, ease: 'out', p: pose([0.05, 0, 1.52], {Torso: [0, 0, 0.1], Head: [0, 0, -0.5], ArmL: [0.6, 0, -1.2], ForearmL: [0.6, 0, 0], ArmR: [0.7, 0, 0.3], ForearmR: [0.7, 0, 0], ThighL: [0.4, 0, 0], ThighR: [0.35, 0, 0.15], ShinL: [-0.6, 0, 0], ShinR: [-0.5, 0, 0]})},
      {t: 0.66, p: pose([0.05, 0, 1.4], {Torso: [0, 0, 0.05], Head: [0, 0, -0.45], ArmL: [0.55, 0, -1.0], ForearmL: [0.9, 0, 0], ArmR: [0.6, 0, 0.3], ForearmR: [0.7, 0, 0], ThighL: [0.45, 0, 0], ThighR: [0.35, 0, 0.1], ShinL: [-0.7, 0, 0], ShinR: [-0.5, 0, 0]}, 0.04)},
      // 手肘撑起上身
      {t: 0.84, p: SIDE_PROP_L},
      {t: 1, p: SIDE_PROP_L},
    ]
    return s > 0 ? keys : keys.map((k) => ({...k, p: mirror(k.p)}))
  }
  if (variant === 'forward_sprawl') {
    return [
      {t: 0, p: STAND},
      // 撞击：腰被顶，头和手往后甩
      {t: 0.1, ease: 'out', p: pose([-0.12, 0, 0], {Torso: [0.4, 0, 0], Head: [0.55, 0, 0], ArmL: [-0.6, 0, -0.2], ArmR: [-0.6, 0, 0.2], ThighL: [-0.3, 0, 0], ThighR: [0.2, 0, 0], ShinL: [-0.3, 0, 0]}, 0.06)},
      // 往前冲一步，双手前伸
      {t: 0.3, p: pose([-0.65, 0, 0], {Torso: [-0.1, 0, 0], Head: [0.4, 0, 0], ArmL: [1.5, 0, -0.35], ArmR: [1.5, 0, 0.35], ForearmL: [0.2, 0, 0], ForearmR: [0.2, 0, 0], ThighL: [-0.4, 0, 0], ShinL: [-0.9, 0, 0], ThighR: [0.95, 0, 0], ShinR: [-0.7, 0, 0]}, 0.12)},
      {t: 0.48, p: pose([-1.15, 0, 0], {Torso: [0.1, 0, 0], Head: [0.5, 0, 0], ArmL: [1.55, 0, -0.4], ArmR: [1.55, 0, 0.4], ForearmL: [0.1, 0, 0], ForearmR: [0.1, 0, 0], ThighL: [-0.1, 0, 0], ThighR: [0.2, 0, 0], ShinL: [-0.4, 0, 0], ShinR: [-0.4, 0, 0]}, 0.1)},
      // 双手撑地
      {t: 0.6, ease: 'out', p: pose([-1.42, 0, 0], {Torso: [0.3, 0, 0], Head: [0.55, 0, 0], ArmL: [0.6, 0, -0.45], ForearmL: [0.9, 0, 0], ArmR: [0.6, 0, 0.45], ForearmR: [0.9, 0, 0], ShinL: [-0.3, 0, 0], ShinR: [-0.5, 0, 0]})},
      // 手肘一软
      {t: 0.7, p: pose([-1.56, 0, 0], {Torso: [0.05, 0, 0], Head: [0.25, 0.3, 0], ArmL: [-0.2, 0, -0.5], ForearmL: [1.7, 0, 0], ArmR: [-0.2, 0, 0.5], ForearmR: [1.7, 0, 0], ShinL: [-0.2, 0, 0], ShinR: [-0.3, 0, 0]}, 0.03)},
      {t: 0.86, p: chain0},
      {t: 1, p: chain0},
    ]
  }
  if (variant === 'stagger_kneel') {
    const tiltX = -local.forward * 0.26
    const tiltZ = -local.right * 0.26
    const tilt = (k: number): Triple => [tiltX * k, 0, tiltZ * k]
    return [
      {t: 0, p: STAND},
      // 被擦一下：身子一歪，手张开找平衡
      {t: 0.08, ease: 'out', p: pose(tilt(1.25), {Torso: [0.18, 0, -local.right * 0.2], Head: [0.3, 0, 0], ArmL: [0.4, 0, -0.75], ArmR: [0.4, 0, 0.75]}, 0.04)},
      // 踉跄三步
      {t: 0.24, p: pose(tilt(1.0), {Torso: [-0.2, 0, 0], ArmL: [1.0, 0, -0.6], ArmR: [-0.3, 0, 0.8], ThighL: [0.62, 0, 0], ShinL: [-0.5, 0, 0], ThighR: [-0.3, 0, 0], ShinR: [-0.3, 0, 0]})},
      {t: 0.4, p: pose(tilt(0.85), {Torso: [-0.25, 0, 0], ArmL: [-0.3, 0, -0.8], ArmR: [1.0, 0, 0.6], ThighR: [0.62, 0, 0], ShinR: [-0.5, 0, 0], ThighL: [-0.3, 0, 0], ShinL: [-0.3, 0, 0]})},
      {t: 0.56, p: pose(tilt(0.5), {Torso: [-0.4, 0, 0], ArmL: [0.6, 0, -0.5], ArmR: [0.7, 0, 0.5], ThighL: [0.95, 0, 0], ShinL: [-0.85, 0, 0], ThighR: [-0.1, 0, 0], ShinR: [-0.6, 0, 0]})},
      // 单膝砸地
      {t: 0.72, ease: 'out', p: tweak(KNEEL_SLUMP, {Torso: [-0.78, 0, 0.1], Head: [-0.5, 0, 0]})},
      {t: 0.82, p: KNEEL_SLUMP},
      {t: 1, p: KNEEL_SLUMP},
    ]
  }
  // bike_slide：甩出 → 侧身砸地 → 侧滑 → 向前侧滚 rolls 圈 → 趴下
  const tuck: JointPose = {Torso: [-0.3, 0, 0], Head: [-0.35, 0, 0], ArmL: [1.0, 0, 0.2], ArmR: [1.0, 0, -0.2], ForearmL: [1.6, 0, 0], ForearmR: [1.6, 0, 0], ThighL: [0.55, 0, 0], ThighR: [0.5, 0, 0], ShinL: [-0.85, 0, 0], ShinR: [-0.8, 0, 0]}
  const keys: Key[] = [
    {t: 0, p: RIDE},
    {t: 0.1, ease: 'out', p: pose([0, 0, 0.7], {Torso: [0, 0, 0.2], ArmL: [0.5, 0, -1.3], ArmR: [1.2, 0, 0.5], ThighL: [0.6, 0, 0], ThighR: [0.6, 0, 0], ShinL: [-0.8, 0, 0], ShinR: [-0.8, 0, 0]}, 0.16)},
    {t: 0.22, ease: 'out', p: pose([0, 0, HALF_PI], {Torso: [0, 0, -0.15], Head: [0, 0, -0.4], ArmL: [1.2, 0, -0.4], ForearmL: [0.8, 0, 0], ArmR: [0.9, 0, 0.4], ForearmR: [1.0, 0, 0], ThighL: [0.5, 0, 0], ThighR: [0.4, 0, 0], ShinL: [-0.7, 0, 0], ShinR: [-0.6, 0, 0]})},
    {t: 0.3, p: pose([-0.15, 0, HALF_PI], tuck)},
  ]
  const thetaEnd = -(TAU * rolls + HALF_PI)
  const steps = Math.max(3, Math.ceil(Math.abs(thetaEnd) / 1.15))
  for (let i = 1; i <= steps; i++) {
    const k = i / steps
    const th = -0.15 + (thetaEnd + 0.15) * k
    keys.push({
      t: 0.3 + 0.54 * k,
      ease: 'lin',
      p: i === steps ? withO(BIKE_REST_L, [th, 0, HALF_PI]) : pose([th, 0, HALF_PI], tuck, 0.03 * Math.sin(k * PI)),
    })
  }
  keys.push({t: 0.92, p: withO(BIKE_REST_L, [thetaEnd, 0, HALF_PI])})
  keys.push({t: 1, p: BIKE_REST_L})
  return s > 0 ? keys : keys.map((k) => ({...k, p: mirror(k.p)}))
}

// ───────────────────────────── 姿态求值 ─────────────────────────────

export interface KnockdownEvalPose {
  q: T.Quaternion
  air: number
  j: Record<AvatarJointName, Triple>
  sway: number
}
type EvalPose = Omit<KnockdownEvalPose, 'sway'>

const _e = new T.Euler()

function poseQuat(o: Triple): T.Quaternion {
  _e.set(o[0], o[1], o[2], 'YXZ')
  return new T.Quaternion().setFromEuler(_e)
}

function emptyJ(): Record<AvatarJointName, Triple> {
  const j = {} as Record<AvatarJointName, Triple>
  for (const name of JOINTS) j[name] = [0, 0, 0]
  return j
}

function toEval(p: KPose): EvalPose {
  const j = emptyJ()
  for (const name of JOINTS) {
    const v = p.j[name]
    if (v) j[name] = [v[0], v[1], v[2]]
  }
  return {q: poseQuat(p.o), air: p.air ?? 0, j}
}

function blendEval(a: EvalPose, b: EvalPose, t: number): EvalPose {
  const k = clamp01(t)
  const j = emptyJ()
  for (const name of JOINTS) {
    const x = a.j[name]
    const y = b.j[name]
    j[name] = [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k]
  }
  return {q: a.q.clone().slerp(b.q, k), air: a.air + (b.air - a.air) * k, j}
}

function addJ(target: EvalPose, delta: JointPose, w: number): void {
  if (w <= 0) return
  for (const name of JOINTS) {
    const d = delta[name]
    if (!d) continue
    const v = target.j[name]
    v[0] += d[0] * w
    v[1] += d[1] * w
    v[2] += d[2] * w
  }
}

function sampleKeys(keys: Key[], t: number): EvalPose {
  const u = clamp01(t)
  if (u <= keys[0].t) return toEval(keys[0].p)
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]
    if (u <= b.t) {
      const a = keys[i - 1]
      const raw = (u - a.t) / Math.max(1e-6, b.t - a.t)
      const k = b.ease === 'out' ? easeOutCubic(raw) : b.ease === 'lin' ? raw : smoothstep(raw)
      return blendEval(toEval(a.p), toEval(b.p), k)
    }
  }
  return toEval(keys[keys.length - 1].p)
}

function sampleChain(chain: KPose[], v: number): EvalPose {
  const x = Math.max(0, Math.min(chain.length - 1, v))
  const i = Math.min(chain.length - 2, Math.floor(x))
  return blendEval(toEval(chain[i]), toEval(chain[i + 1]), smoothstep(x - i))
}

// —— 简化正向运动学：求身体最低点（贴地）与骨盆位置（水平锚点）。尺寸取自 figure.glb 骨骼 ——
const PELVIS = new T.Vector3(0, 0.93, 0)
const TORSO_PIVOT = new T.Vector3(0, 1.08, 0)
const CHEST = new T.Vector3(0, 1.36, 0)
const HEAD = new T.Vector3(0, 1.62, 0)
const SHOULDER_L = new T.Vector3(-0.17, 1.43, 0.02)
const SHOULDER_R = new T.Vector3(0.17, 1.43, 0.02)
const HIP_L = new T.Vector3(-0.09, 0.93, 0)
const HIP_R = new T.Vector3(0.09, 0.93, 0)
const UPPER_ARM = new T.Vector3(0, -0.3, 0)
const FOREARM = new T.Vector3(0, -0.28, 0)
const FINGERS = new T.Vector3(0, -0.2, 0)
const THIGH = new T.Vector3(0, -0.4, 0)
const SHIN = new T.Vector3(0, -0.43, 0)
const TOE = new T.Vector3(0, -0.08, -0.17)

function jq(tr: Triple): T.Quaternion {
  _e.set(tr[0], tr[1], tr[2], 'XYZ')
  return new T.Quaternion().setFromEuler(_e)
}

export interface KnockdownFootprint {
  /** 身体表面最低点相对 figure 原点的高度（贴地时 figure.y = ground - minY）。 */
  minY: number
  lowest: string
  pelvis: T.Vector3
  points: Array<{name: string; p: T.Vector3; r: number}>
}

/** 姿态（不含偏航）下各关键点位置；figure 原点在双脚 (0,0,0)。 */
export function knockdownFootprint(q: T.Quaternion, j: Record<AvatarJointName, Triple>): KnockdownFootprint {
  const qH = jq(j.Hips)
  const qT = qH.clone().multiply(jq(j.Torso))
  const around = (pt: T.Vector3, pivot: T.Vector3, rot: T.Quaternion) => pt.clone().sub(pivot).applyQuaternion(rot).add(pivot)
  const tp = around(TORSO_PIVOT, PELVIS, qH)
  const upper = (pt: T.Vector3) => pt.clone().sub(TORSO_PIVOT).applyQuaternion(qT).add(tp)
  const pts: Array<{name: string; p: T.Vector3; r: number}> = [
    {name: 'pelvis', p: PELVIS.clone(), r: 0.12},
    {name: 'chest', p: upper(CHEST), r: 0.13},
    {name: 'head', p: upper(HEAD), r: 0.12},
  ]
  for (const [side, sh, armN, foreN] of [
    ['L', SHOULDER_L, 'ArmL', 'ForearmL'],
    ['R', SHOULDER_R, 'ArmR', 'ForearmR'],
  ] as const) {
    const s = upper(sh)
    const qa = qT.clone().multiply(jq(j[armN]))
    const elbow = s.clone().add(UPPER_ARM.clone().applyQuaternion(qa))
    const qf = qa.clone().multiply(jq(j[foreN]))
    const hand = elbow.clone().add(FOREARM.clone().applyQuaternion(qf))
    const tip = hand.clone().add(FINGERS.clone().applyQuaternion(qf))
    pts.push({name: `elbow${side}`, p: elbow, r: 0.05}, {name: `hand${side}`, p: hand, r: 0.04}, {name: `fingers${side}`, p: tip, r: 0.015})
  }
  for (const [side, hip, thN, shN] of [
    ['L', HIP_L, 'ThighL', 'ShinL'],
    ['R', HIP_R, 'ThighR', 'ShinR'],
  ] as const) {
    const h = around(hip, PELVIS, qH)
    const qth = qH.clone().multiply(jq(j[thN]))
    const knee = h.clone().add(THIGH.clone().applyQuaternion(qth))
    const qsh = qth.clone().multiply(jq(j[shN]))
    const ankle = knee.clone().add(SHIN.clone().applyQuaternion(qsh))
    const toe = ankle.clone().add(TOE.clone().applyQuaternion(qsh))
    pts.push({name: `knee${side}`, p: knee, r: 0.06}, {name: `ankle${side}`, p: ankle, r: 0.1}, {name: `toe${side}`, p: toe, r: 0.02})
  }
  let minY = Infinity
  let lowest = ''
  for (const it of pts) {
    it.p.applyQuaternion(q)
    const y = it.p.y - it.r
    if (y < minY) {
      minY = y
      lowest = it.name
    }
  }
  return {minY, lowest, pelvis: pts[0].p, points: pts}
}

/** 按快照求出完整姿态（朝向四元数、关节、腾空、晃动）。导出供测试 / 调试。 */
export function evaluateKnockdownPose(snap: KnockdownSnapshot): KnockdownEvalPose {
  const variant = snap.variant ?? 'front_launch'
  const side = snap.side ?? (variant === 'side_topple_r' ? -1 : 1)
  const chain = recoveryChain(variant, side)
  const fam = familyOf(variant)
  const famDelta = (state: KnockdownBreathState | null | undefined): JointPose => {
    if (!state) return {}
    const d = BREATH_DELTA[fam][state]
    return side >= 0 || fam !== 'side' ? d : mirror(pose([0, 0, 0], d)).j
  }
  const wobble = snap.wobble ?? 0
  const t = snap.elapsedSec
  let out: EvalPose
  let sway = 0

  if (snap.phase === 'falling') {
    out = sampleKeys(fallKeys(variant, snap.severity, side, snap.rolls ?? 1, snap.directionLocal, snap.kind === 'bike_crash'), snap.fallU ?? 0)
  } else if (snap.phase === 'stunned' || snap.phase === 'mashing' || snap.phase === 'rising') {
    const rising = snap.phase === 'rising'
    const r = rising ? clamp01(snap.riseProgress) : 0
    const from = Math.max(0, Math.min(3, snap.riseFromProgress ?? 3))
    const v = rising ? from + (chain.length - 1 - from) * smoothstep(r / 0.6) : Math.max(0, snap.recoveryProgress ?? 0)
    out = sampleChain(chain, v)
    // 缓气：4 种动作随机切换（交叉淡入），开始爬起后逐渐退出
    const restW = 1 - smoothstep(v / 0.9)
    if (restW > 0) {
      const blend = snap.breathBlend ?? 1
      const weightOf = (state: KnockdownBreathState) =>
        ((snap.breathState === state ? blend : 0) + (snap.prevBreathState === state ? 1 - blend : 0)) * restW
      addJ(out, famDelta(snap.prevBreathState), restW * (1 - blend))
      addJ(out, famDelta(snap.breathState), restW * blend)
      const heave = Math.sin(snap.breathPhase)
      const pantAmp = (0.05 + 0.05 * snap.severity) * (1 + weightOf('pant') * 1.2)
      out.j.Torso[0] += heave * pantAmp * restW
      out.j.Head[0] += Math.sin(snap.breathPhase + 0.6) * pantAmp * 0.6 * restW
      out.air += (0.5 + 0.5 * heave) * 0.012 * restW
      const look = weightOf('look_around')
      if (look > 0) out.j.Head[1] += Math.sin((snap.breathStateElapsedSec ?? 0) * 2.1) * 0.65 * look
      const clutch = weightOf('clutch_side')
      if (clutch > 0) out.j.Torso[2] += Math.sin(t * 17) * 0.025 * clutch
    }
    // 爬起过程中也保留轻微喘息
    out.j.Torso[0] += Math.sin(snap.breathPhase) * 0.03 * (1 - restW) * (rising ? 1 - r : 1)
    // 每按一下：发力顶一下（60ms 冲上去，220ms 回落）
    const age = snap.lastMashAgeSec ?? 9
    const effort = age < 0.06 ? age / 0.06 : Math.max(0, 1 - (age - 0.06) / 0.22)
    out.j.Torso[0] -= effort * 0.12
    out.j.Head[0] += effort * 0.08
    // 晃：没站起前按得越多晃得越厉害；站起过程中逐渐稳住
    const wob = wobble * (rising ? 1 - r * 0.6 : 1)
    sway = wob * Math.sin(t * 8.2) * 0.085
    out.j.Torso[2] += wob * Math.sin(t * 7.0 + 1.1) * 0.11
    out.j.Head[2] += wob * Math.sin(t * 6.1) * 0.07
    if (rising) {
      // 站起后拍灰：左右手交替拍大腿，低头看身上
      const dustEnv = Math.sin(PI * clamp01((r - 0.56) / 0.44))
      if (dustEnv > 0) {
        const pa = Math.max(0, Math.sin(r * PI * 9))
        const pb = Math.max(0, Math.sin(r * PI * 9 + PI))
        addJ(out, {
          Torso: [-0.24, 0, 0], Head: [-0.34, 0, 0],
          ArmL: [0.22 + 0.22 * pa, 0, 0.28], ForearmL: [1.0 + 0.45 * pa, 0, 0],
          ArmR: [0.2 + 0.22 * pb, 0, -0.32], ForearmR: [0.95 + 0.45 * pb, 0, 0],
        }, dustEnv)
      }
    }
  } else {
    out = toEval(STAND)
  }
  return {...out, sway}
}

const _qYaw = new T.Quaternion()
const _qSway = new T.Quaternion()
const _axisY = new T.Vector3(0, 1, 0)
const _axisZ = new T.Vector3(0, 0, 1)

/** 带晃动的身体朝向（不含偏航）+ 足迹，供 applyKnockdownPose 与测试共用。 */
export function knockdownBodyPose(snap: KnockdownSnapshot): {ev: KnockdownEvalPose; qBody: T.Quaternion; fp: KnockdownFootprint} {
  const ev = evaluateKnockdownPose(snap)
  _qSway.setFromAxisAngle(_axisZ, ev.sway)
  const qBody = _qSway.clone().multiply(ev.q)
  return {ev, qBody, fp: knockdownFootprint(qBody, ev.j)}
}

/**
 * 把快照姿态应用到 figure：整体朝向（相对倒地瞬间偏航）、骨盆锚定、最低点贴地、关节旋转。
 * `basePos.y` 视为地面高度。
 */
export function applyKnockdownPose(
  figure: T.Object3D,
  joints: Partial<AvatarJointMap> | undefined,
  snap: KnockdownSnapshot,
  basePos?: {x: number; y: number; z: number},
): void {
  const ud = figure.userData as {kdTriggerId?: number; kdBaseYaw?: number}
  if (!snap.isDown || snap.phase === 'idle' || !snap.variant) {
    const yaw = ud.kdBaseYaw ?? figure.rotation.y
    figure.rotation.set(0, yaw, 0, 'YXZ')
    delete ud.kdTriggerId
    delete ud.kdBaseYaw
    if (joints) for (const name of JOINTS) joints[name]?.rotation.set(0, 0, 0)
    if (basePos) figure.position.set(basePos.x, basePos.y, basePos.z)
    return
  }
  const id = snap.triggerId ?? -1
  if (ud.kdTriggerId !== id || ud.kdBaseYaw === undefined) {
    ud.kdTriggerId = id
    ud.kdBaseYaw = figure.rotation.y
  }
  const baseYaw = ud.kdBaseYaw
  const {ev, qBody, fp} = knockdownBodyPose(snap)
  _qYaw.setFromAxisAngle(_axisY, baseYaw)
  figure.rotation.order = 'YXZ'
  figure.quaternion.copy(_qYaw).multiply(qBody)
  if (basePos) {
    // 骨盆水平锚在 basePos：身体绕骨盆转，不会整段甩出去；最低点贴地面
    const off = new T.Vector3(-fp.pelvis.x, 0, -fp.pelvis.z).applyQuaternion(_qYaw)
    figure.position.set(basePos.x + off.x, basePos.y - fp.minY + ev.air, basePos.z + off.z)
  }
  if (joints) {
    for (const name of JOINTS) {
      const v = ev.j[name]
      joints[name]?.rotation.set(v[0], v[1], v[2])
    }
  }
}

// ───────────────────────────── 状态机 ─────────────────────────────

let triggerCounter = 0

/** 连按次数 → 爬起进度 v（0..3）。5 下：0,1,1.5,2,3（第 5 下进入 rising）。 */
function progressForCount(count: number, required: number): number {
  if (count <= 0) return 0
  if (required === 5) return [0, 1, 1.5, 2, 3][Math.min(4, count)]
  if (required <= 1) return 3
  return Math.min(3, (3 * count) / (required - 1))
}

function segmentForProgress(v: number): number {
  if (v <= 0) return 0
  if (v < 2) return 1
  if (v < 3) return 2
  return 3
}

export function createKnockdownState(options?: KnockdownOptions): KnockdownController {
  const mashRequired = Math.max(1, Math.round(options?.mashRequired ?? DEFAULT_MASH_REQUIRED))
  const mashWindowSec = Math.max(0.4, options?.mashWindowSec ?? DEFAULT_MASH_WINDOW_SEC)
  const fixedFallSec = options?.fallDurationSec !== undefined ? Math.max(0.12, options.fallDurationSec) : null
  const stunDurationSec = Math.max(0.15, options?.stunDurationSec ?? DEFAULT_STUN_SEC)
  const riseDurationSec = Math.max(0.15, options?.riseDurationSec ?? DEFAULT_RISE_SEC)
  const rand = mulberry32(options?.seed ?? 0x9e3779b1)

  // 每段的起始计数：退段时回到上一段起点
  const segStartCount: number[] = [0, 0, 0, 0]
  for (let c = mashRequired - 1; c >= 1; c--) {
    segStartCount[segmentForProgress(progressForCount(c, mashRequired))] = c
  }

  let phase: KnockdownPhase = 'idle'
  let kind: KnockdownKind | null = null
  let variant: KnockdownVariant | null = null
  let severity = 0
  let side = 1
  let rolls = 1
  let triggerId = 0
  let elapsedSec = 0
  let phaseElapsedSec = 0
  let fallDurationSec = 1
  let breathPhase = 0
  let propUpBlend = 0
  let riseProgress = 0
  let riseFromProgress = 0
  let cameraShake = 0
  let camBias = 0
  let knockbackVel = {x: 0, z: 0}
  let directionLocal = {forward: 0, right: 0}
  let mashCount = 0
  let progress = 0
  let progressVel = 0
  let lastMashAt = -99
  let wobble = 0
  let fallbackCount = 0
  let landed = false
  let breathState: KnockdownBreathState | null = null
  let prevBreathState: KnockdownBreathState | null = null
  let breathStateElapsed = 0
  let breathStateDur = 1.2
  let hudHandle: KnockdownHudHandle | null = null

  function pickBreathState(): void {
    const pool = KNOCKDOWN_BREATH_STATES.filter((s) => s !== breathState)
    prevBreathState = breathState
    breathState = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))]
    breathStateElapsed = 0
    breathStateDur = BREATH_MIN_SEC + rand() * (BREATH_MAX_SEC - BREATH_MIN_SEC)
  }

  function enterRising(): void {
    phase = 'rising'
    phaseElapsedSec = 0
    riseProgress = 0
    riseFromProgress = Math.max(0, Math.min(3, progress))
    hudHandle?.sync(getSnapshot())
  }

  function reset(): void {
    phase = 'idle'
    kind = null
    variant = null
    severity = 0
    side = 1
    rolls = 1
    elapsedSec = 0
    phaseElapsedSec = 0
    breathPhase = 0
    propUpBlend = 0
    riseProgress = 0
    riseFromProgress = 0
    cameraShake = 0
    camBias = 0
    knockbackVel = {x: 0, z: 0}
    directionLocal = {forward: 0, right: 0}
    mashCount = 0
    progress = 0
    progressVel = 0
    lastMashAt = -99
    wobble = 0
    fallbackCount = 0
    landed = false
    breathState = null
    prevBreathState = null
    breathStateElapsed = 0
    hudHandle?.sync(getSnapshot())
  }

  function getSnapshot(): KnockdownSnapshot {
    const isDown = phase !== 'idle'
    const stunProgress =
      phase === 'falling' ? 0 : phase === 'stunned' ? clamp01(phaseElapsedSec / stunDurationSec) : isDown ? 1 : 0
    const sinceMash = elapsedSec - lastMashAt
    return {
      isDown,
      isRecovering: phase === 'rising',
      phase,
      kind,
      variant,
      severity,
      elapsedSec,
      phaseElapsedSec,
      stunProgress,
      riseProgress,
      breathPhase,
      propUpBlend,
      mashCount,
      mashRequired,
      mashProgress: phase === 'rising' ? 1 : clamp01(mashCount / mashRequired),
      mashWindowRemainingSec: phase === 'mashing' && mashCount > 0 ? Math.max(0, mashWindowSec - sinceMash) : 0,
      cameraShake,
      cameraPitchBias: camBias * KNOCKDOWN_CAMERA_PITCH_BIAS,
      knockbackVel: {x: knockbackVel.x, z: knockbackVel.z},
      directionLocal: {forward: directionLocal.forward, right: directionLocal.right},
      triggerId,
      fallU: phase === 'falling' ? clamp01(phaseElapsedSec / fallDurationSec) : 1,
      side,
      rolls,
      breathState: isDown ? breathState : null,
      prevBreathState: isDown ? prevBreathState : null,
      breathBlend: smoothstep(breathStateElapsed / BREATH_FADE_SEC),
      breathStateElapsedSec: breathStateElapsed,
      recoverySegment: phase === 'rising' ? 3 : segmentForProgress(progressForCount(mashCount, mashRequired)),
      recoveryProgress: progress,
      riseFromProgress,
      wobble,
      fallbackCount,
      landed,
      lastMashAgeSec: Math.max(0, sinceMash),
      mashWindowSec,
    }
  }

  function triggerKnockdown(
    nextKind: KnockdownKind,
    dir: KnockdownDirInput,
    nextSeverity = 0.65,
    opts?: KnockdownTriggerOptions,
  ): KnockdownSnapshot {
    const sev = clamp01(Number.isFinite(nextSeverity) ? nextSeverity : 0.65)
    const dirInfo = resolveKnockdownDirection(dir, opts?.yaw ?? 0)
    const nextVariant = resolveKnockdownVariant(dir, sev, nextKind, opts)
    const impulse =
      nextVariant === 'front_launch' ? 3.2 + sev * 5.0
        : nextVariant === 'stagger_kneel' ? 1.5 + sev * 1.8
          : nextVariant === 'bike_slide' ? 3.0 + sev * 4.0
            : nextVariant === 'forward_sprawl' ? 2.4 + sev * 3.6
              : 2.6 + sev * 3.6

    phase = 'falling'
    kind = nextKind
    variant = nextVariant
    severity = sev
    side = resolveSide(nextVariant, dirInfo, opts)
    rolls = nextVariant === 'bike_slide' && sev >= 0.8 ? 2 : 1
    triggerId = ++triggerCounter
    elapsedSec = 0
    phaseElapsedSec = 0
    fallDurationSec = Math.max(fixedFallSec ?? 0, VARIANT_FALL_SEC[nextVariant] * (0.9 + 0.25 * sev))
    breathPhase = 0
    propUpBlend = 0
    riseProgress = 0
    riseFromProgress = 0
    // 镜头震动随力度：轻擦 ≈0.3，正面撞飞 ≈1
    cameraShake = (nextVariant === 'stagger_kneel' ? 0.18 : 0.3) + sev * 0.7
    directionLocal = {forward: dirInfo.forward, right: dirInfo.right}
    knockbackVel = {x: dirInfo.wx * impulse, z: dirInfo.wz * impulse}
    mashCount = 0
    progress = 0
    progressVel = 0
    lastMashAt = -99
    wobble = 0
    fallbackCount = 0
    landed = false
    breathState = null
    prevBreathState = null
    breathStateElapsed = 0

    const snap = getSnapshot()
    hudHandle?.sync(snap)
    return snap
  }

  function step(dt: number): KnockdownSnapshot {
    if (phase === 'idle') return getSnapshot()
    const cdt = Number.isFinite(dt) && dt > 0 ? Math.min(0.15, dt) : 0
    elapsedSec += cdt
    phaseElapsedSec += cdt

    cameraShake *= Math.exp(-cdt * 4.5)
    if (cameraShake < 0.005) cameraShake = 0
    // 俯视补偿：倒下去以后镜头抬高往下看，免得被 1.1m 的桥栏杆挡住躺在地上的人；起身时收回。
    const camTarget = phase === 'rising' ? Math.max(0, 1 - riseProgress * 1.6) : phase === 'falling' ? 0.75 : 1
    camBias += (camTarget - camBias) * (1 - Math.exp(-cdt * (phase === 'rising' ? 6 : 3.2)))

    const landT = variant ? VARIANT_LAND_T[variant] : 0.6
    const airborne = phase === 'falling' && phaseElapsedSec / fallDurationSec < landT
    const velDamp = Math.exp(-cdt * (airborne ? (variant === 'stagger_kneel' ? 3.2 : 2.4) : 7.5))
    knockbackVel.x *= velDamp
    knockbackVel.z *= velDamp
    if (Math.hypot(knockbackVel.x, knockbackVel.z) < 0.03) {
      knockbackVel.x = 0
      knockbackVel.z = 0
    }

    if (phase === 'falling') {
      const u = phaseElapsedSec / fallDurationSec
      if (!landed && u >= landT) {
        landed = true
        cameraShake = Math.max(cameraShake, 0.12 + severity * 0.5)
      }
      if (variant === 'bike_slide' && landed && u < 0.82) {
        cameraShake = Math.max(cameraShake, 0.06 + severity * 0.12)
      }
      if (phaseElapsedSec >= fallDurationSec) {
        phase = 'stunned'
        phaseElapsedSec = 0
        landed = true
        pickBreathState()
        breathStateElapsed = BREATH_FADE_SEC
      }
    } else if (phase === 'stunned' || phase === 'mashing') {
      breathPhase += cdt * (phase === 'stunned' ? 6.4 + severity * 2.6 : 5.2 + severity * 1.6)
      breathStateElapsed += cdt
      if (breathStateElapsed >= breathStateDur) pickBreathState()
      propUpBlend += ((breathState === 'prop_up' ? 1 : 0) - propUpBlend) * (1 - Math.exp(-cdt * 6))
      if (phase === 'stunned' && phaseElapsedSec >= stunDurationSec) {
        phase = 'mashing'
        phaseElapsedSec = 0
      }
      if (phase === 'mashing' && mashCount > 0 && elapsedSec - lastMashAt > mashWindowSec) {
        // 超时没按：退回上一段
        const seg = segmentForProgress(progressForCount(mashCount, mashRequired))
        mashCount = seg <= 1 ? 0 : segStartCount[seg - 1]
        fallbackCount += 1
        lastMashAt = mashCount === 0 ? -99 : elapsedSec
        wobble *= 0.5
      }
      // 进度弹簧（欠阻尼，轻微过冲 = 每按一下“推一把”）
      const target = progressForCount(mashCount, mashRequired)
      const k = 70
      const c = 2 * 0.58 * Math.sqrt(k)
      progressVel += ((target - progress) * k - progressVel * c) * cdt
      progress += progressVel * cdt
      if (progress < 0) {
        progress = 0
        progressVel = Math.max(0, progressVel)
      }
      wobble *= Math.exp(-cdt * 0.9)
    } else if (phase === 'rising') {
      breathPhase += cdt * 4.2
      riseProgress = clamp01(phaseElapsedSec / riseDurationSec)
      wobble *= Math.exp(-cdt * 1.6)
      if (riseProgress >= 1) {
        const cb = options?.onRecover
        reset()
        cb?.()
        return getSnapshot()
      }
    }

    const snap = getSnapshot()
    hudHandle?.sync(snap)
    return snap
  }

  function recordRecoverMash(): boolean {
    if (phase === 'idle' || phase === 'rising' || phase === 'falling') return false
    if (phase === 'stunned') {
      // 还在缓气：不计数，只给一点挣扎反馈
      wobble = Math.min(1.6, wobble + 0.08)
      hudHandle?.sync(getSnapshot())
      return false
    }
    mashCount = Math.min(mashRequired, mashCount + 1)
    lastMashAt = elapsedSec
    // 没站起前按得越多晃得越厉害
    wobble = Math.min(1.6, wobble + 0.22 + 0.1 * mashCount)
    progressVel += 2.2
    if (mashCount >= mashRequired) {
      enterRising()
      return true
    }
    hudHandle?.sync(getSnapshot())
    return false
  }

  function handleKeyDown(code: string, repeat = false): boolean {
    if (repeat) return false
    if (code === 'Space' || code === ' ') return recordRecoverMash()
    return false
  }

  function forceRise(instant = false): boolean {
    if (phase === 'idle') return false
    if (instant) {
      const cb = options?.onRecover
      reset()
      cb?.()
      return true
    }
    if (phase !== 'rising') enterRising()
    return true
  }

  function attachHud(container?: HTMLElement | null): KnockdownHudHandle {
    if (hudHandle) return hudHandle
    const handle = createKnockdownHud(container, () => recordRecoverMash())
    hudHandle = {
      element: handle.element,
      sync: handle.sync,
      dispose() {
        handle.dispose()
        hudHandle = null
      },
    }
    hudHandle.sync(getSnapshot())
    return hudHandle
  }

  return {
    get isDown() { return phase !== 'idle' },
    get isRecovering() { return phase === 'rising' },
    get phase() { return phase },
    get variant() { return variant },
    get kind() { return kind },
    get severity() { return severity },
    get mashCount() { return mashCount },
    get mashRequired() { return mashRequired },
    get mashProgress() { return phase === 'rising' ? 1 : clamp01(mashCount / mashRequired) },
    get cameraShake() { return cameraShake },
    get cameraPitchBias() { return phase === 'idle' ? 0 : camBias * KNOCKDOWN_CAMERA_PITCH_BIAS },
    get knockbackVel() { return {x: knockbackVel.x, z: knockbackVel.z} },
    get breathPhase() { return breathPhase },
    get propUpBlend() { return propUpBlend },
    get breathState() { return phase === 'idle' ? null : breathState },
    get recoverySegment() { return phase === 'rising' ? 3 : segmentForProgress(progressForCount(mashCount, mashRequired)) },
    triggerKnockdown,
    step,
    recordRecoverMash,
    handleKeyDown,
    forceRise,
    reset,
    getSnapshot,
    applyPose(figure, joints, basePos) {
      applyKnockdownPose(figure, joints, getSnapshot(), basePos)
    },
    attachHud,
  }
}

// ───────────────────────────── HUD：环形进度 + 按键动效 + 手机按钮 ─────────────────────────────

const HUD_STYLE_ID = 'knockdown-hud-style'
const HUD_CSS = `
.knockdown-hud{position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:88;display:flex;flex-direction:row;align-items:center;gap:12px;padding:6px 16px 6px 6px;border-radius:999px;background:rgba(14,20,24,.5);border:1px solid rgba(255,212,120,.22);box-shadow:0 6px 18px rgba(0,0,0,.28);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);max-width:calc(100vw - 24px);box-sizing:border-box;pointer-events:none;user-select:none;-webkit-user-select:none;font:600 14px/1.35 system-ui,-apple-system,"PingFang SC",sans-serif;color:#f6f1e4;text-shadow:0 1px 3px rgba(0,0,0,.55)}
.knockdown-hud[hidden]{display:none}
body:not([data-hotbar=on]) .knockdown-hud{bottom:calc(28px + env(safe-area-inset-bottom))}
.knockdown-hud .kd-info{display:flex;flex-direction:column;align-items:flex-start;gap:5px;min-width:0}
body[data-kd-down] .td-duty-keys-dock,body[data-kd-down] .beta-note,body[data-kd-down] .hint{opacity:0;visibility:hidden;pointer-events:none;transition:opacity .18s}
.knockdown-hud .kd-title{font-size:15px;letter-spacing:.04em;white-space:nowrap}
.knockdown-hud .kd-title.kd-alert{color:#ffd7a3}
.knockdown-hud:has(.kd-title.kd-alert){border-color:rgba(255,140,90,.6)}
.knockdown-hud .kd-ring{position:relative;flex:none;width:92px;height:92px;border:0;padding:0;margin:0;background:none;pointer-events:auto;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;border-radius:50%;outline:none;color:inherit}
.knockdown-hud .kd-ring:focus-visible{box-shadow:0 0 0 3px rgba(255,220,140,.7)}
.knockdown-hud .kd-ring svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg);overflow:visible}
.knockdown-hud .kd-track{fill:rgba(14,20,24,.72);stroke:rgba(255,255,255,.14);stroke-width:9}
.knockdown-hud .kd-fill{fill:none;stroke:url(#kd-grad);stroke-width:9;stroke-linecap:round;transition:stroke-dashoffset .16s cubic-bezier(.2,.9,.3,1.3)}
.knockdown-hud .kd-timer{fill:none;stroke:rgba(255,120,90,.85);stroke-width:3;stroke-linecap:round}
.knockdown-hud .kd-tick{stroke:rgba(14,20,24,.95);stroke-width:3}
.knockdown-hud .kd-key{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);min-width:54px;padding:7px 8px 9px;border-radius:12px;background:linear-gradient(#fdf4dc,#e6d3a5);color:#3b2a10;font:800 15px/1 system-ui,-apple-system,"PingFang SC",sans-serif;text-shadow:none;box-shadow:0 5px 0 #a8885a,0 8px 14px rgba(0,0,0,.4);transition:transform .07s,box-shadow .07s}
.knockdown-hud .kd-key small{display:block;margin-top:3px;font-size:10px;font-weight:700;opacity:.7}
.knockdown-hud .kd-ring.kd-press .kd-key{transform:translate(-50%,calc(-50% + 4px)) scale(.94);box-shadow:0 1px 0 #a8885a,0 3px 8px rgba(0,0,0,.4)}
.knockdown-hud .kd-ring.kd-wait .kd-key{filter:grayscale(.6) brightness(.85)}
.knockdown-hud .kd-ring.kd-pulse{animation:kd-pulse 1s ease-in-out infinite}
.knockdown-hud .kd-ring.kd-burst::after{content:"";position:absolute;inset:-6px;border-radius:50%;border:3px solid rgba(255,220,140,.9);animation:kd-burst .32s ease-out forwards}
.knockdown-hud .kd-ring.kd-done .kd-fill{stroke:#4ade80}
.knockdown-hud .kd-segs{display:flex;gap:6px}
.knockdown-hud .kd-seg{padding:2px 9px;border-radius:99px;font-size:12px;background:rgba(14,20,24,.6);border:1px solid rgba(255,255,255,.14);opacity:.6;transition:all .15s}
.knockdown-hud .kd-seg.kd-on{opacity:1;background:rgba(245,158,11,.35);border-color:rgba(255,212,120,.7)}
.knockdown-hud .kd-sub{font-size:12px;opacity:.85;min-height:16px}
.knockdown-hud.kd-shake{animation:kd-shake .3s ease-out}
@keyframes kd-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes kd-burst{from{opacity:1;transform:scale(.9)}to{opacity:0;transform:scale(1.25)}}
@keyframes kd-shake{0%,100%{transform:translateX(-50%)}25%{transform:translateX(calc(-50% - 6px))}75%{transform:translateX(calc(-50% + 6px))}}
@media (pointer:coarse){.knockdown-hud .kd-ring{width:112px;height:112px}.knockdown-hud .kd-key{min-width:66px;padding:12px 9px;font-size:17px}}
@media (max-width:420px){.knockdown-hud{gap:8px;padding-right:10px}.knockdown-hud .kd-seg{padding:2px 6px;font-size:11px}.knockdown-hud .kd-title{font-size:13px}}
@media (prefers-reduced-motion:reduce){.knockdown-hud .kd-ring.kd-pulse,.knockdown-hud.kd-shake{animation:none}}
`

const BREATH_CAPTION: Record<KnockdownBreathState, string> = {
  pant: '大口喘气…',
  clutch_side: '捂着腰缓一缓…',
  look_around: '抬头看看四周…',
  prop_up: '撑起上身…',
}

function isCoarsePointer(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

function createKnockdownHud(container: HTMLElement | null | undefined, onMash: () => void): KnockdownHudHandle {
  if (typeof document === 'undefined') return {element: null, sync() {}, dispose() {}}
  const parent = container ?? document.body
  if (!parent) return {element: null, sync() {}, dispose() {}}

  if (!document.getElementById(HUD_STYLE_ID)) {
    const style = document.createElement('style')
    style.id = HUD_STYLE_ID
    style.textContent = HUD_CSS
    document.head?.appendChild(style)
  }

  const R = 46
  const C = 2 * Math.PI * R
  const R2 = 54
  const C2 = 2 * Math.PI * R2
  const coarse = isCoarsePointer()

  const wrap = document.createElement('div')
  wrap.className = 'knockdown-hud'
  wrap.hidden = true
  wrap.setAttribute('role', 'status')
  wrap.setAttribute('aria-live', 'polite')

  const title = document.createElement('div')
  title.className = 'kd-title'

  const ring = document.createElement('button')
  ring.type = 'button'
  ring.className = 'kd-ring'
  ring.setAttribute('aria-label', coarse ? '连点起身' : '连按空格起身')
  // 段落刻度：第 1/3/4 下分别进入 趴撑/跪撑/单膝
  const ticks = [1, 3, 4].map((n) => {
    const a = (n / 5) * Math.PI * 2
    return `<line class="kd-tick" x1="${(60 + Math.cos(a) * (R - 6)).toFixed(1)}" y1="${(60 + Math.sin(a) * (R - 6)).toFixed(1)}" x2="${(60 + Math.cos(a) * (R + 6)).toFixed(1)}" y2="${(60 + Math.sin(a) * (R + 6)).toFixed(1)}"/>`
  }).join('')
  ring.innerHTML = `<svg viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="kd-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f59e0b"/><stop offset="1" stop-color="#facc15"/></linearGradient></defs><circle class="kd-track" cx="60" cy="60" r="${R}"/><circle class="kd-fill" cx="60" cy="60" r="${R}" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${C.toFixed(2)}"/><circle class="kd-timer" cx="60" cy="60" r="${R2}" stroke-dasharray="${C2.toFixed(2)}" stroke-dashoffset="${C2.toFixed(2)}"/>${ticks}</svg><span class="kd-key">${coarse ? '起身' : '空格'}<small>${coarse ? '连点' : 'SPACE'}</small></span>`
  const fill = ring.querySelector<SVGCircleElement>('.kd-fill')
  const timer = ring.querySelector<SVGCircleElement>('.kd-timer')

  const segs = document.createElement('div')
  segs.className = 'kd-segs'
  const segEls = KNOCKDOWN_RECOVERY_SEGMENTS.map((label) => {
    const el = document.createElement('span')
    el.className = 'kd-seg'
    el.textContent = label
    segs.appendChild(el)
    return el
  })
  const sub = document.createElement('div')
  sub.className = 'kd-sub'

  const info = document.createElement('div')
  info.className = 'kd-info'
  info.append(title, segs, sub)
  wrap.append(ring, info)
  parent.appendChild(wrap)

  let lastCount = -1
  let lastFallback = -1
  let lastPhase = ''
  let pressTimer: ReturnType<typeof setTimeout> | undefined
  let burstTimer: ReturnType<typeof setTimeout> | undefined

  const flashPress = () => {
    ring.classList.add('kd-press')
    clearTimeout(pressTimer)
    pressTimer = setTimeout(() => ring.classList.remove('kd-press'), 90)
  }
  const burst = () => {
    ring.classList.remove('kd-burst')
    void ring.offsetWidth
    ring.classList.add('kd-burst')
    clearTimeout(burstTimer)
    burstTimer = setTimeout(() => ring.classList.remove('kd-burst'), 340)
  }

  const onPointer = (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    flashPress()
    onMash()
  }
  ring.addEventListener('pointerdown', onPointer)
  // 键盘按空格时按键帽同步下压（不拦截事件，计数由 walk 的 keydown 负责）
  const onKey = (e: KeyboardEvent) => {
    if ((e.code === 'Space' || e.key === ' ') && !e.repeat && !wrap.hidden) flashPress()
  }
  window.addEventListener('keydown', onKey, true)

  const sync = (snap: KnockdownSnapshot) => {
    const visible = snap.isDown && snap.phase !== 'idle'
    wrap.hidden = !visible
    // 倒地期间执勤三键（Q/E/F）本就互斥禁用；把底部居中的三键条让位给起身环，免得手机上误触。
    if (visible) document.body.dataset.kdDown = '1'
    else delete document.body.dataset.kdDown
    if (!visible) {
      lastCount = -1
      lastFallback = -1
      lastPhase = ''
      return
    }
    const seg = snap.recoverySegment ?? 0
    const frac = snap.phase === 'rising' ? 1 : snap.mashProgress
    if (fill) fill.style.strokeDashoffset = (C * (1 - frac)).toFixed(2)
    const windowSec = Math.max(0.01, snap.mashWindowSec ?? DEFAULT_MASH_WINDOW_SEC)
    const timeFrac = snap.phase === 'mashing' && snap.mashCount > 0 ? clamp01(snap.mashWindowRemainingSec / windowSec) : 0
    if (timer) timer.style.strokeDashoffset = (C2 * (1 - timeFrac)).toFixed(2)
    segEls.forEach((el, i) => el.classList.toggle('kd-on', seg > i || snap.phase === 'rising'))
    ring.classList.toggle('kd-wait', snap.phase === 'falling' || snap.phase === 'stunned')
    ring.classList.toggle('kd-pulse', snap.phase === 'mashing' && snap.mashCount === 0)
    ring.classList.toggle('kd-done', snap.phase === 'rising')
    ring.disabled = snap.phase === 'falling' || snap.phase === 'rising'
    title.classList.toggle('kd-alert', snap.phase === 'falling')

    if (snap.phase === 'falling') {
      title.textContent = snap.kind === 'bike_crash' ? '摔车了！' : '被撞倒了！'
      sub.textContent = ''
    } else if (snap.phase === 'stunned') {
      title.textContent = '先缓一缓…'
      sub.textContent = snap.breathState ? BREATH_CAPTION[snap.breathState] : ''
    } else if (snap.phase === 'mashing') {
      title.textContent = `${coarse ? '连点按钮' : '连按空格'}起身 ${snap.mashCount}/${snap.mashRequired}`
      sub.textContent = snap.mashCount === 0
        ? (snap.breathState ? BREATH_CAPTION[snap.breathState] : '')
        : `停太久会退回上一段 ${snap.mashWindowRemainingSec.toFixed(1)}s`
    } else if (snap.phase === 'rising') {
      title.textContent = '站起来，拍拍灰'
      sub.textContent = ''
    }
    if (snap.phase === 'mashing' && lastCount >= 0 && snap.mashCount > lastCount) burst()
    if (lastPhase === 'mashing' && snap.phase === 'rising') burst()
    const fb = snap.fallbackCount ?? 0
    if (lastFallback >= 0 && fb > lastFallback) {
      wrap.classList.remove('kd-shake')
      void wrap.offsetWidth
      wrap.classList.add('kd-shake')
    }
    lastFallback = fb
    lastCount = snap.mashCount
    lastPhase = snap.phase
  }

  return {
    element: wrap,
    sync,
    dispose() {
      ring.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey, true)
      clearTimeout(pressTimer)
      clearTimeout(burstTimer)
      delete document.body.dataset.kdDown
      wrap.remove()
    },
  }
}

// ───────────────────────────── 单例 ─────────────────────────────

export const knockdown = createKnockdownState()

export function triggerKnockdown(
  kind: KnockdownKind,
  dir: KnockdownDirInput,
  severity = 0.65,
  opts?: KnockdownTriggerOptions,
): KnockdownSnapshot {
  return knockdown.triggerKnockdown(kind, dir, severity, opts)
}

export function isDown(): boolean {
  return knockdown.isDown
}
