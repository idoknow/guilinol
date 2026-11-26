import * as THREE from 'three'
import { XXG_PLAYER, yawFacing, type XxgExit, type XxgPortalId, type XxgXZ } from '../contract.ts'
import {
  normalizeStairProfile,
  sampleStairProfile,
  type NormalizedStairProfile,
  type StairEyeSmootherOptions,
  type StairEyeState,
  type StairPlacement,
  type StairProfile,
  type StairSample,
} from '../../locomotion/stairs/index.ts'
import { orientedBar, type BoxSpec } from './scene-boxes.ts'
import { normalizeAngleRad } from './types.ts'

/** 台阶踢面高（m）。 */
export const XXG_STAIR_RISER = 0.16
/** 目标踏面深（m），用于推导默认级数。 */
export const XXG_STAIR_TARGET_TREAD = 0.3
/** 踏面深允许下限（m）。 */
export const XXG_STAIR_MIN_TREAD = 0.27
/** 踏面深允许上限（m）。 */
export const XXG_STAIR_MAX_TREAD = 0.32
/** 最少台阶级数。 */
export const XXG_STAIR_MIN_STEPS = 8
/** 顶部平台目标深度（m）。 */
export const XXG_STAIR_TOP_LANDING = 0.5
/** 两侧花岗岩矮墙厚度（m，放在楼梯矩形内侧）。 */
export const XXG_STAIR_DWARF_WALL_THICKNESS = 0.12
/** 两侧花岗岩矮墙高出踏步斜线的高度（m）。 */
export const XXG_STAIR_DWARF_WALL_HEIGHT = 0.82
/** 白色扶手高出踏步斜线的高度（m）。 */
export const XXG_STAIR_HANDRAIL_HEIGHT = 0.94
/** 扶手立杆沿斜坡间距（m）。 */
export const XXG_STAIR_POST_SPACING = 1.2
/** 每帧视线高度最大变化量（m）。 */
export const XXG_STAIR_MAX_DELTA_Y = 0.08
/** 下楼脚本水平速度（m/s）。 */
export const XXG_STAIR_DESCENT_SPEED = 1.4
/** 下楼脚本起始俯角（rad，-18°）。 */
export const XXG_STAIR_DESCENT_PITCH_RAD = (-18 * Math.PI) / 180
/** 下楼脚本终点前平滑转向与抬头时长（s）。 */
export const XXG_STAIR_DESCENT_TURN_SEC = 0.6
/** 下楼起点离楼梯顶玻璃门的距离（m）。 */
export const XXG_STAIR_DESCENT_DOOR_OFFSET = 0.45
/** 玻璃门相对楼梯远端边线的外移量（m，与 indoor-scene 一致）。 */
export const XXG_STAIR_GLASS_DOOR_OFFSET = 0.08
/** 触发离开的水平进度占比阈值。 */
export const XXG_STAIR_EXIT_PROGRESS_RATIO = 0.55
/** 触发离开的脚底高度占比阈值。 */
export const XXG_STAIR_EXIT_HEIGHT_RATIO = 0.5
/** 触发离开时沿上行方向的最小速度分量（m/s）。 */
export const XXG_STAIR_EXIT_MIN_SPEED = 0.05
/** 触发离开的脚底高度硬上限（m，保证 eyeY = footY + 1.6 < 2.9 + 0.3 = 3.2m）。 */
export const XXG_STAIR_MAX_TRIGGER_FOOT_Y = 1.42
/** 黄色 L 形防滑条无贴图标准材质色（数值照抄十字街降饱和明黄 #d8ad38，不引用十字街代码）。 */
export const XXG_STAIR_NOSING_COLOR = '#d8ad38'

/** 可选的楼梯井方向提示（直接兼容 indoor-scene 的 ExitWell）。 */
export interface XxgExitWellHint {
  readonly alongZ: boolean
  readonly sign: 1 | -1
  readonly startEdge: number
}

/** 单个出口楼梯的统一几何与采样描述（indoor-scene / collision / controller 共用）。 */
export interface XxgExitStairSpec {
  readonly portalId: XxgPortalId
  readonly alongZ: boolean
  readonly sign: 1 | -1
  /** 第一级台阶起步线坐标（沿楼梯主轴）。 */
  readonly startEdge: number
  /** 楼梯顶远端边线坐标（靠玻璃门一侧，沿楼梯主轴）。 */
  readonly endEdge: number
  /** 踏步段终点坐标（顶部平台起点，沿楼梯主轴）。 */
  readonly flightEndEdge: number
  /** 楼梯总水平长度（m，踏步段 + 顶部平台）。 */
  readonly runLen: number
  /** 踏步段水平长度（m，stepCount * tread）。 */
  readonly flightRun: number
  /** 顶部平台深度（m）。 */
  readonly topLandingDepth: number
  /** 楼梯横向中心坐标（m）。 */
  readonly acrossC: number
  /** 楼梯总宽度（m，等于 exit.stair 宽/深）。 */
  readonly acrossLen: number
  /** 扣除两侧矮墙后的净宽（m）。 */
  readonly clearWidth: number
  /** 上行单位向量（室内 XZ）。 */
  readonly up: XxgXZ
  /** 面向楼梯上行时的右手单位向量（室内 XZ）。 */
  readonly right: XxgXZ
  /** 面向楼梯上行方向的 yaw（Three.js 相机约定）。 */
  readonly upYaw: number
  /** 面向楼梯下行方向的 yaw（Three.js 相机约定）。 */
  readonly downYaw: number
  /** 起步线中心点（s = 0）。 */
  readonly startCenter: XxgXZ
  /** 远端中心点（s = runLen）。 */
  readonly endCenter: XxgXZ
  readonly stepCount: number
  readonly riser: number
  readonly tread: number
  /** 顶部平台脚底高度（m）。 */
  readonly topY: number
  readonly profile: StairProfile
  readonly normalizedProfile: NormalizedStairProfile
  readonly placement: StairPlacement
}

export interface XxgStairProjection {
  readonly progress: number
  readonly lateral: number
  readonly footY: number
  readonly sample: StairSample
}

export interface XxgStairDescentFrame {
  readonly x: number
  readonly z: number
  readonly footY: number
  readonly yaw: number
  readonly pitch: number
  readonly done: boolean
}

export interface XxgStairDescent {
  readonly start: XxgStairDescentFrame
  readonly totalDurationSec: number
  step(dtSeconds: number): XxgStairDescentFrame
}

export interface XxgStairEyeSmoother {
  reset(footY: number): number
  step(targetFootY: number, dtSeconds: number): number
  getState(): StairEyeState
}

export interface BuiltExitStairGeometry {
  /** 每级花岗岩实心踏步盒（从 y=0 到该级顶面），长度 = stepCount，顶面高度严格递增。 */
  readonly stepBoxes: BoxSpec[]
  /** 顶部平台花岗岩实心块（若存在顶部平台）。 */
  readonly topLandingBox: BoxSpec | null
  /** 两侧沿坡度花岗岩矮墙几何（合并进 xxg_stair_granite，0 新增 draw call）。 */
  readonly dwarfWallGeos: THREE.BufferGeometry[]
  /** 每级前缘黄色防滑条顶面窄条（0.05m 深），长度 = stepCount。 */
  readonly nosingTopBoxes: BoxSpec[]
  /** 每级前缘黄色防滑条前立面窄条（0.04m 高），长度 = stepCount。 */
  readonly nosingFrontBoxes: BoxSpec[]
  /** 黄色 L 形防滑条全部盒子（top + front，用于 xxg_stair_nosing_yellow 单批提交）。 */
  readonly nosingBoxes: BoxSpec[]
  /** 两侧白色扶手 + 立杆几何（并入 skylightFrameGeos，0 新增 draw call）。 */
  readonly handrailGeos: THREE.BufferGeometry[]
}

/**
 * 由布局出口（及可选的 ExitWell）推导出标准化楼梯描述。
 */
export function resolveXxgExitStair(exit: XxgExit, well?: XxgExitWellHint): XxgExitStairSpec {
  const st = exit.stair
  const minX = st.x - st.w * 0.5
  const maxX = st.x + st.w * 0.5
  const minZ = st.z - st.d * 0.5
  const maxZ = st.z + st.d * 0.5

  const dirX = st.x - exit.foot.x
  const dirZ = st.z - exit.foot.z
  const alongZ = well ? well.alongZ : Math.abs(dirZ) >= Math.abs(dirX)
  const sign: 1 | -1 = well
    ? well.sign
    : alongZ
      ? dirZ >= 0
        ? 1
        : -1
      : dirX >= 0
        ? 1
        : -1

  const startEdge = well
    ? well.startEdge
    : alongZ
      ? sign > 0
        ? minZ
        : maxZ
      : sign > 0
        ? minX
        : maxX
  const endEdge = alongZ ? (sign > 0 ? maxZ : minZ) : sign > 0 ? maxX : minX
  const runLen = Math.abs(endEdge - startEdge)
  const acrossC = alongZ ? st.x : st.z
  const acrossLen = alongZ ? st.w : st.d
  const clearWidth = Math.max(0.8, acrossLen - XXG_STAIR_DWARF_WALL_THICKNESS * 2)

  // 计算级数与踏面深：默认预留 0.5m 顶部平台，踏面深控制在 [0.27, 0.32]，最少 8 级
  const nominalAvail = Math.max(0.4, runLen - XXG_STAIR_TOP_LANDING)
  let stepCount = Math.max(XXG_STAIR_MIN_STEPS, Math.floor(nominalAvail / XXG_STAIR_TARGET_TREAD))
  let tread = nominalAvail / stepCount
  if (tread > XXG_STAIR_MAX_TREAD) {
    const nextTread = nominalAvail / (stepCount + 1)
    if (nextTread >= XXG_STAIR_MIN_TREAD) {
      stepCount += 1
      tread = nextTread
    } else {
      tread = XXG_STAIR_MAX_TREAD
    }
  } else if (tread < XXG_STAIR_MIN_TREAD) {
    const maxPossibleTread = Math.max(0.18, (runLen - 0.25) / stepCount)
    tread = Math.min(XXG_STAIR_MIN_TREAD, maxPossibleTread)
  }

  const flightRun = stepCount * tread
  const topLandingDepth = Math.max(0, runLen - flightRun)
  const flightEndEdge = startEdge + sign * flightRun
  const riser = XXG_STAIR_RISER
  const topY = Math.round(stepCount * riser * 10000) / 10000

  const up: XxgXZ = alongZ ? { x: 0, z: sign } : { x: sign, z: 0 }
  const right: XxgXZ = { x: -up.z, z: up.x }
  const upYaw = yawFacing(up)
  const downYaw = yawFacing({ x: -up.x, z: -up.z })
  const startCenter: XxgXZ = alongZ ? { x: acrossC, z: startEdge } : { x: startEdge, z: acrossC }
  const endCenter: XxgXZ = alongZ ? { x: acrossC, z: endEdge } : { x: endEdge, z: acrossC }

  // 限制肩部过渡长度，保证顶部平台下楼起点（离玻璃门 0.45m）严格落在平缓顶面 y=topY
  const shoulderLength = Math.min(tread * 0.8, topLandingDepth * 0.45, 0.24)
  const profile: StairProfile = {
    riser,
    tread,
    count: stepCount,
    landing: { entry: 0, exit: topLandingDepth },
    shoulderLength,
    direction: 'up',
    baseY: 0,
    width: clearWidth,
  }
  const normalizedProfile = normalizeStairProfile(profile)
  const placement: StairPlacement = {
    origin: { x: startCenter.x, y: 0, z: startCenter.z },
    yawRad: upYaw,
    profile,
  }

  return {
    portalId: exit.portalId,
    alongZ,
    sign,
    startEdge,
    endEdge,
    flightEndEdge,
    runLen,
    flightRun,
    topLandingDepth,
    acrossC,
    acrossLen,
    clearWidth,
    up,
    right,
    upYaw,
    downYaw,
    startCenter,
    endCenter,
    stepCount,
    riser,
    tread,
    topY,
    profile,
    normalizedProfile,
    placement,
  }
}

/** 将室内 XZ 点投影到单个出口楼梯；不在楼梯矩形范围内时返回 null。 */
export function projectPointToXxgStair(stair: XxgExitStairSpec, x: number, z: number): XxgStairProjection | null {
  const dx = x - stair.startCenter.x
  const dz = z - stair.startCenter.z
  const rawS = dx * stair.up.x + dz * stair.up.z
  if (rawS < 0 || rawS > stair.runLen + 1e-6) return null
  const lateral = dx * stair.right.x + dz * stair.right.z
  if (Math.abs(lateral) > stair.acrossLen * 0.5 + 1e-6) return null
  const progress = Math.min(stair.runLen, Math.max(0, rawS))
  const sample = sampleStairProfile(stair.normalizedProfile, progress)
  return {
    progress,
    lateral,
    footY: sample.height,
    sample,
  }
}

/** 采样玩家在指定出口楼梯上的脚底高度；不在楼梯上返回 null。 */
export function sampleExitStairFootY(stair: XxgExitStairSpec, x: number, z: number): number | null {
  const hit = projectPointToXxgStair(stair, x, z)
  return hit ? hit.footY : null
}

/** 遍历所有出口楼梯，返回命中的楼梯与采样信息；不在任何楼梯上时返回 null。 */
export function sampleAllExitStairsFootY(
  stairs: readonly XxgExitStairSpec[],
  x: number,
  z: number,
): { readonly stair: XxgExitStairSpec; readonly footY: number; readonly progress: number; readonly sample: StairSample } | null {
  for (const stair of stairs) {
    const hit = projectPointToXxgStair(stair, x, z)
    if (hit) {
      return { stair, footY: hit.footY, progress: hit.progress, sample: hit.sample }
    }
  }
  return null
}

/**
 * 离开判定：脚底高度 ≥ min(topY * 0.5, 1.42m) 且没有往下走；
 * 或沿上行方向进度 ≥ 55% 且速度在 up 上的分量 > 0.05 m/s。
 * 保证触发时玩家不会站在顶部平台上，且视线高度 footY + 1.6 < 2.9 + 0.3。
 */
export function shouldClimbOut(
  stair: XxgExitStairSpec,
  x: number,
  z: number,
  footY: number,
  vx: number,
  vz: number,
): boolean {
  const proj = projectPointToXxgStair(stair, x, z)
  if (!proj) return false
  const speedAlongUp = vx * stair.up.x + vz * stair.up.z
  // 上段：只要不是往下走就离开，防止贴着横向慢慢挪上楼梯顶
  if (footY >= xxgStairExitFootY(stair)) return speedAlongUp >= 0
  if (speedAlongUp <= XXG_STAIR_EXIT_MIN_SPEED) return false
  return proj.progress >= stair.runLen * XXG_STAIR_EXIT_PROGRESS_RATIO
}

/** 触发离开的脚底高度阈值。 */
export function xxgStairExitFootY(stair: XxgExitStairSpec): number {
  return Math.min(stair.topY * XXG_STAIR_EXIT_HEIGHT_RATIO, XXG_STAIR_MAX_TRIGGER_FOOT_Y)
}

/**
 * 可步行的最远上行进度：脚底高度超过离开阈值两级处即止，
 * 顶部平台与上段台阶只给下楼脚本用，玩家视线不会越过吊顶。
 */
export function xxgStairWalkLimitProgress(stair: XxgExitStairSpec): number {
  const limitY = xxgStairExitFootY(stair) + stair.riser * 2
  for (let s = 0; s <= stair.runLen; s += 0.01) {
    if (sampleStairProfile(stair.normalizedProfile, s).height >= limitY - 1e-6) return s
  }
  return stair.runLen
}

/**
 * 楼梯井金字塔拱座高出吊顶的高度：拱座顶要高过下楼起点的视线 0.15m，
 * 否则从楼梯顶往外看会越过拱座、透过玻璃看到吊顶背面。
 */
export function xxgStairCurbM(stair: XxgExitStairSpec, ceilH: number): number {
  return Math.max(0.45, stair.topY + XXG_PLAYER.eyeHeight + 0.15 - ceilH)
}

/**
 * 视线高度平滑器：指数平滑 + 每帧 Δy 硬上限（默认 0.08m），用于下楼脚本、上楼攀爬与回平地过渡。
 */
export function createXxgStairEyeSmoother(opts: StairEyeSmootherOptions = {}): XxgStairEyeSmoother {
  const eyeOffset = opts.eyeOffset ?? XXG_PLAYER.eyeHeight
  const smoothTauSec = opts.smoothTauSec ?? 0.045
  const maxDeltaYPerFrame = opts.maxDeltaYPerFrame ?? XXG_STAIR_MAX_DELTA_Y

  let initialized = false
  let currentFootY = 0
  let currentEyeY = eyeOffset
  let lastDeltaY = 0

  return {
    reset(footY: number): number {
      initialized = true
      currentFootY = footY
      currentEyeY = footY + eyeOffset
      lastDeltaY = 0
      return currentEyeY
    },

    step(targetFootY: number, dtSeconds: number): number {
      if (!initialized) {
        initialized = true
        currentFootY = targetFootY
        currentEyeY = targetFootY + eyeOffset
        lastDeltaY = 0
        return currentEyeY
      }
      const dt = Math.max(0, Number.isFinite(dtSeconds) ? dtSeconds : 0)
      if (dt <= 0) {
        lastDeltaY = 0
        return currentEyeY
      }
      const targetEyeY = targetFootY + eyeOffset
      const alpha = smoothTauSec > 1e-6 ? 1 - Math.exp(-dt / smoothTauSec) : 1
      const rawDelta = (targetEyeY - currentEyeY) * alpha
      const clampedDelta = Math.max(-maxDeltaYPerFrame, Math.min(maxDeltaYPerFrame, rawDelta))
      currentEyeY += clampedDelta
      if (Math.abs(targetEyeY - currentEyeY) < 1e-5) {
        currentEyeY = targetEyeY
      }
      currentFootY = currentEyeY - eyeOffset
      lastDeltaY = clampedDelta
      return currentEyeY
    },

    getState(): StairEyeState {
      return {
        initialized,
        footY: currentFootY,
        eyeY: currentEyeY,
        pitchBiasRad: 0,
        lastDeltaY,
      }
    },
  }
}

/**
 * 进场下楼脚本路径：
 * 起点 = 楼梯顶部、离玻璃门 0.45m、脚底 y=topY、面朝下行、俯角 -18°；
 * 以 1.4 m/s 匀速走下楼梯至起步线外，再走向 exit.foot；
 * 最后 0.6s 平滑转向 exit.yaw 且俯角归 0。
 */
export function descentPath(stair: XxgExitStairSpec, exit: XxgExit): XxgStairDescent {
  // 玻璃门位于 endEdge + sign * 0.08，起点距玻璃门 0.45m（落在顶部平台上）
  const idealStartS = stair.runLen + XXG_STAIR_GLASS_DOOR_OFFSET - XXG_STAIR_DESCENT_DOOR_OFFSET
  const startS = Math.min(stair.runLen - 0.12, Math.max(stair.flightRun, idealStartS))

  const p0x = stair.startCenter.x + stair.up.x * startS
  const p0z = stair.startCenter.z + stair.up.z * startS

  // 起步线外过渡点 P1：确保先沿楼梯中轴线完全走下第一级台阶，再平稳折向 exit.foot
  const footDx = exit.foot.x - stair.startCenter.x
  const footDz = exit.foot.z - stair.startCenter.z
  const footOutDist = Math.max(0, -(footDx * stair.up.x + footDz * stair.up.z))
  const outClearance = footOutDist >= 0.45 ? 0.45 : footOutDist
  const p1x = stair.startCenter.x - stair.up.x * outClearance
  const p1z = stair.startCenter.z - stair.up.z * outClearance

  const p2x = exit.foot.x
  const p2z = exit.foot.z

  const seg1Len = startS + outClearance
  const seg2Len = Math.hypot(p2x - p1x, p2z - p1z)
  const totalLen = seg1Len + seg2Len
  const totalDurationSec = Math.max(XXG_STAIR_DESCENT_TURN_SEC, totalLen / XXG_STAIR_DESCENT_SPEED)
  const effectiveSpeed = totalDurationSec > 1e-6 ? totalLen / totalDurationSec : XXG_STAIR_DESCENT_SPEED
  const turnStartSec = Math.max(0, totalDurationSec - XXG_STAIR_DESCENT_TURN_SEC)
  const turnSpanSec = Math.max(1e-6, totalDurationSec - turnStartSec)

  const targetYaw = normalizeAngleRad(exit.yaw)
  const deltaYaw = normalizeAngleRad(targetYaw - stair.downYaw)

  const sampleAt = (elapsed: number): XxgStairDescentFrame => {
    const t = Math.max(0, Math.min(totalDurationSec, elapsed))
    const done = t >= totalDurationSec - 1e-6
    if (done) {
      return {
        x: p2x,
        z: p2z,
        footY: 0,
        yaw: targetYaw,
        pitch: 0,
        done: true,
      }
    }

    const dist = Math.min(totalLen, t * effectiveSpeed)
    let x: number
    let z: number
    let footY: number
    if (dist <= seg1Len) {
      const sNow = startS - dist
      x = stair.startCenter.x + stair.up.x * sNow
      z = stair.startCenter.z + stair.up.z * sNow
      footY = sNow > 0 ? sampleStairProfile(stair.normalizedProfile, sNow).height : 0
    } else {
      const u = seg2Len > 1e-6 ? (dist - seg1Len) / seg2Len : 1
      x = p1x + (p2x - p1x) * u
      z = p1z + (p2z - p1z) * u
      footY = 0
    }

    let yaw = stair.downYaw
    let pitch = XXG_STAIR_DESCENT_PITCH_RAD
    if (t > turnStartSec) {
      const u = Math.min(1, (t - turnStartSec) / turnSpanSec)
      const w = u * u * (3 - 2 * u)
      yaw = normalizeAngleRad(stair.downYaw + deltaYaw * w)
      pitch = XXG_STAIR_DESCENT_PITCH_RAD * (1 - w)
    }

    return { x, z, footY, yaw, pitch, done: false }
  }

  let elapsedSec = 0
  const start = sampleAt(0)

  return {
    start,
    totalDurationSec,
    step(dtSeconds: number): XxgStairDescentFrame {
      const dt = Math.max(0, Number.isFinite(dtSeconds) ? dtSeconds : 0)
      elapsedSec = Math.min(totalDurationSec, elapsedSec + dt)
      return sampleAt(elapsedSec)
    },
  }
}

/**
 * 构建单个沿坡度变化的直角梯形棱柱几何（用于花岗岩矮墙），带正确外法线与世界尺度 UV。
 */
function buildSlopedWallPrism(
  a0: number,
  a1: number,
  yTop0: number,
  yTop1: number,
  cCenter: number,
  thickness: number,
  alongZ: boolean,
  uvScale: readonly [number, number] = [1, 1],
): THREE.BufferGeometry {
  const aMin = Math.min(a0, a1)
  const aMax = Math.max(a0, a1)
  const yAtMin = a0 <= a1 ? yTop0 : yTop1
  const yAtMax = a0 <= a1 ? yTop1 : yTop0
  const cMin = cCenter - thickness * 0.5
  const cMax = cCenter + thickness * 0.5

  const x0 = alongZ ? cMin : aMin
  const x1 = alongZ ? cMax : aMax
  const z0 = alongZ ? aMin : cMin
  const z1 = alongZ ? aMax : cMax

  const y00 = alongZ ? yAtMin : yAtMin
  const y10 = alongZ ? yAtMin : yAtMax
  const y01 = alongZ ? yAtMax : yAtMin
  const y11 = alongZ ? yAtMax : yAtMax

  const b00: readonly [number, number, number] = [x0, 0, z0]
  const b10: readonly [number, number, number] = [x1, 0, z0]
  const b11: readonly [number, number, number] = [x1, 0, z1]
  const b01: readonly [number, number, number] = [x0, 0, z1]
  const t00: readonly [number, number, number] = [x0, y00, z0]
  const t10: readonly [number, number, number] = [x1, y10, z0]
  const t11: readonly [number, number, number] = [x1, y11, z1]
  const t01: readonly [number, number, number] = [x0, y01, z1]

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const [su, sv] = uvScale
  let vOffset = 0

  const pushQuad = (
    p0: readonly [number, number, number],
    p1: readonly [number, number, number],
    p2: readonly [number, number, number],
    p3: readonly [number, number, number],
  ) => {
    const ux = p1[0] - p0[0]
    const uy = p1[1] - p0[1]
    const uz = p1[2] - p0[2]
    const vx = p2[0] - p0[0]
    const vy = p2[1] - p0[1]
    const vz = p2[2] - p0[2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len
    ny /= len
    nz /= len

    const verts = [p0, p1, p2, p3]
    for (const p of verts) {
      positions.push(p[0], p[1], p[2])
      normals.push(nx, ny, nz)
      if (Math.abs(ny) > 0.5) {
        uvs.push(p[0] * su, p[2] * sv)
      } else if (Math.abs(nx) > 0.5) {
        uvs.push(p[2] * su, p[1] * sv)
      } else {
        uvs.push(p[0] * su, p[1] * sv)
      }
    }
    indices.push(vOffset, vOffset + 1, vOffset + 2, vOffset, vOffset + 2, vOffset + 3)
    vOffset += 4
  }

  // 6 个外法线面（逆时针绕序）
  pushQuad(t00, t01, t11, t10) // 顶面（坡面/平顶）
  pushQuad(b00, b10, b11, b01) // 底面
  pushQuad(b00, t00, t10, b10) // -Z 面
  pushQuad(b01, b11, t11, t01) // +Z 面
  pushQuad(b00, b01, t01, t00) // -X 面
  pushQuad(b10, t10, t11, b11) // +X 面

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geom.setIndex(indices)
  geom.computeBoundingSphere()
  return geom
}

/**
 * 构建单个出口楼梯的几何分组：
 * - 花岗岩踏步 + 顶部平台（BoxSpec，并入 xxg_stair_granite）
 * - 两侧花岗岩矮墙沿坡度（BufferGeometry，并入 xxg_stair_granite）
 * - 每级前缘黄色 L 形防滑条（BoxSpec，单批 xxg_stair_nosing_yellow）
 * - 两侧白色扶手与每 1.2m 立杆（BufferGeometry，并入 skylightFrameGeos；同十字街只做两侧，
 *   楼梯中线是下楼脚本与上楼的走线，不放扶手免得镜头穿模）
 */
export function buildExitStairGeometry(
  stair: XxgExitStairSpec,
  graniteUvScale: readonly [number, number] = [1, 1],
): BuiltExitStairGeometry {
  const { alongZ, sign, startEdge, endEdge, flightEndEdge, acrossC, acrossLen, clearWidth, stepCount, riser, tread, topY } = stair

  const box = (a: number, y: number, c: number, sa: number, sy: number, sc: number): BoxSpec =>
    alongZ ? { cx: c, cy: y, cz: a, sx: sc, sy, sz: sa } : { cx: a, cy: y, cz: c, sx: sa, sy, sz: sc }
  const pt = (a: number, y: number, c: number): { x: number; y: number; z: number } =>
    alongZ ? { x: c, y, z: a } : { x: a, y, z: c }

  const stepBoxes: BoxSpec[] = []
  const nosingTopBoxes: BoxSpec[] = []
  const nosingFrontBoxes: BoxSpec[] = []
  const dwarfWallGeos: THREE.BufferGeometry[] = []
  const handrailGeos: THREE.BufferGeometry[] = []

  // 1. 花岗岩踏步（宽度嵌入矮墙内沿 1cm 防止微缝）+ 每级前缘黄色 L 形防滑条
  const stepWidth = Math.min(acrossLen, clearWidth + 0.02)
  const nosingWidth = Math.max(0.4, clearWidth - 0.02)
  const nosingTopDepth = 0.05
  const nosingFrontHeight = 0.04
  const nosingThick = 0.008

  for (let i = 0; i < stepCount; i++) {
    const h = (i + 1) * riser
    const aFront = startEdge + sign * i * tread
    const aMid = startEdge + sign * (i + 0.5) * tread

    stepBoxes.push(box(aMid, h * 0.5, acrossC, tread, h, stepWidth))
    nosingTopBoxes.push(box(aFront + sign * (nosingTopDepth * 0.5), h + nosingThick * 0.5, acrossC, nosingTopDepth, nosingThick, nosingWidth))
    nosingFrontBoxes.push(
      box(aFront - sign * (nosingThick * 0.5), h - nosingFrontHeight * 0.5, acrossC, nosingThick, nosingFrontHeight, nosingWidth),
    )
  }

  const topLandingBox: BoxSpec | null =
    stair.topLandingDepth > 0.01
      ? box((flightEndEdge + endEdge) * 0.5, topY * 0.5, acrossC, stair.topLandingDepth, topY, stepWidth)
      : null

  // 2. 两侧花岗岩矮墙（放在 stair 宽度内侧，沿坡度上升并衔接顶部平台平段）
  const wallT = XXG_STAIR_DWARF_WALL_THICKNESS
  const wallH = XXG_STAIR_DWARF_WALL_HEIGHT
  for (const side of [-1, 1] as const) {
    const wallC = acrossC + side * (acrossLen * 0.5 - wallT * 0.5)
    dwarfWallGeos.push(
      buildSlopedWallPrism(startEdge, flightEndEdge, wallH, topY + wallH, wallC, wallT, alongZ, graniteUvScale),
    )
    if (stair.topLandingDepth > 0.01) {
      dwarfWallGeos.push(
        buildSlopedWallPrism(flightEndEdge, endEdge, topY + wallH, topY + wallH, wallC, wallT, alongZ, graniteUvScale),
      )
    }
  }

  // 3. 两侧白色扶手，立杆沿坡度每 1.2m 一根
  const postPositionsS: number[] = []
  const firstPostS = Math.min(0.15, stair.flightRun * 0.15)
  for (let s = firstPostS; s < stair.flightRun - 0.25; s += XXG_STAIR_POST_SPACING) {
    postPositionsS.push(s)
  }
  postPositionsS.push(stair.flightRun)
  if (stair.topLandingDepth >= 0.22) {
    postPositionsS.push(stair.runLen - 0.1)
  }

  const pitchYAt = (s: number): number => {
    if (s <= 0) return 0
    if (s >= stair.flightRun) return topY
    return (s / stair.flightRun) * topY
  }

  const railEndA = endEdge - sign * 0.06
  const hasTopExtension = stair.topLandingDepth > 0.12

  // 两侧扶手（架在矮墙顶面上方，白色立杆落在矮墙顶面）
  for (const side of [-1, 1] as const) {
    const railC = acrossC + side * (acrossLen * 0.5 - wallT * 0.5)
    const sideRailH = XXG_STAIR_HANDRAIL_HEIGHT
    handrailGeos.push(
      orientedBar(pt(startEdge, sideRailH, railC), pt(flightEndEdge, topY + sideRailH, railC), 0.042),
    )
    if (hasTopExtension) {
      handrailGeos.push(
        orientedBar(pt(flightEndEdge, topY + sideRailH, railC), pt(railEndA, topY + sideRailH, railC), 0.042),
      )
    }
    for (const s of postPositionsS) {
      const py = pitchYAt(s)
      const a = startEdge + sign * s
      handrailGeos.push(orientedBar(pt(a, py + wallH - 0.02, railC), pt(a, py + sideRailH, railC), 0.032))
    }
  }

  return {
    stepBoxes,
    topLandingBox,
    dwarfWallGeos,
    nosingTopBoxes,
    nosingFrontBoxes,
    nosingBoxes: [...nosingTopBoxes, ...nosingFrontBoxes],
    handrailGeos,
  }
}
