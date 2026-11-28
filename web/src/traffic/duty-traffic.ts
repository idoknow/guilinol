import * as THREE from 'three'
import {npcDefaults} from '../../../lib/npc'
import {getViolatorHeldReceipt} from '../traffic-duty/handover/receipt-model.ts'
import {
  JIEFANG_BRIDGE_ROTATION_Y,
  JIEFANG_CROSS_SECTION,
  classifyJiefangCrossSectionZ,
  isOnJiefangBridgeDeck,
  jiefangBridgeLocalToWorld,
  jiefangDeckWorldY,
  worldToJiefangBridgeLocal,
} from '../traffic-duty/jiefang-railings'
import {
  ESCAPE_PASSIVE_RETRY_WINDOW_SEC,
  JIEFANG_FRONT_WHISTLE_STOP_PROB,
  acknowledgeJiefangStoryMode,
  applyEscapeImpulse,
  classifyInterceptAspect,
  computeEscapeDodge,
  escapeFleeProbability,
  getEscapeClockSec,
  getJiefangStoryModeVersion,
  isActorStoppedOrTicketing,
  isJiefangStoryModeActive,
  isJiefangStoryModeRequested,
  markEscapeCause,
  peekEscapeMark,
  subscribeDutyEscape,
  tryEmitDutyEscape,
  type DutyEscapeCause,
  type DutyEscapeEvent,
  type DutyEscapeListener,
  type InterceptAspect,
} from '../traffic-duty/jiefang-escape'
import {computeFineYuanStack, resolveDutyFineTable, type DutyFineTable} from '../traffic-duty/types'
import {touchUi} from '../ui/input-mode'
import {masterVolume, rideSoundMuted} from '../walk/ride-sound-pref'
import {staticSolids, useTrafficSolids, type Solid} from './contact'
import {
  loadCarMeshes,
  resolveTwoWheelSpec,
  trafficMaterial,
  trafficModels,
  type CarMesh,
  type TwoWheelSubtype,
  type Variant,
} from './models'
import {riderPool} from './rider-pool'
import {SIGNAL_DRIVER_RANK, citySignalClock, citySignals} from './signals'
import {
  CITY_NONMOTOR_VIOLATION_RATE,
  Traffic,
  VIOLATOR_NO_HELMET_CONDITIONAL_RATE,
  actorHasAnyViolation,
  actorHasViolation,
  getActorViolations,
  pickTwoWheelProfile,
  type ActiveTrafficViolation,
  type Actor,
  type DutyHiddenLifecycleConfig,
  type ActorHandSide,
  type ActorLifecycleCallback,
  type ActorLifecycleEvent,
  type ActorViolationSnapshot,
  type DutyCrossSectionZone,
  type DutyStoryOverrideConfig,
  type DutyViolationWeights,
  type Graph,
  type HitSeverity,
  type PlayerHitCallback,
  type PlayerHitEvent,
  type PlayerHornCallback,
  type PlayerHornEvent,
  type Position,
  type ReceiveTicketOptions,
  type ReceiveTicketResult,
  type TicketReceivedCallback,
  type TicketReceivedEvent,
  type TrafficViolation,
  type TrafficViolationPolicy,
  type ViolatorPulledOverCallback,
  type ViolatorPulledOverEvent,
  type WhistleFlagHaltResult,
} from './sim'

/**
 * Independent Jiefang Bridge duty traffic manager (`web/src/traffic/duty-traffic.ts`).
 *
 * Runs completely independently of `playMode` (`tour` vs `solo`) and global city traffic:
 *  - On `start()`, spawns motor cars and two-wheelers (including violators) inside Jiefang Bridge's
 *    240 m duty zone regardless of whether global city traffic is enabled.
 *  - Feeds on-duty auxiliary-police position into `Traffic` every step for automatic vehicle
 *    deceleration, motor-lane player collision (`onPlayerHit`), violator spotting/fleeing (8~15 m),
 *    and whistle/flag halt commands (`commandHalt`).
 *  - On `stop()` / `dispose()`, cleanly tears down the isolated simulator, BatchedMesh, and riderPool
 *    without touching global city traffic.
 */

export const JIEFANG_DUTY_CENTER = Object.freeze({x: -168, z: 40})
export const JIEFANG_DUTY_RADIUS_M = 240
export const JIEFANG_DUTY_ROAD_CELL = '-1_0'
export const JIEFANG_NONMOTOR_VIOLATION_RATE = CITY_NONMOTOR_VIOLATION_RATE
export const JIEFANG_NO_HELMET_CONDITIONAL_RATE = VIOLATOR_NO_HELMET_CONDITIONAL_RATE
export const JIEFANG_MAX_VIOLATOR_RATIO = 0.60
export const JIEFANG_MAX_CONCURRENT_VIOLATORS = 16
export const JIEFANG_VIOLATOR_RESPAWN_COOLDOWN_S = 0
export const JIEFANG_PULLOVER_OUTER_ABS_Z = 15.2
export const JIEFANG_SIDEWALK_PULLOVER_ABS_Z = 17.4
export const JIEFANG_APPROACH_MIN_DIST_M = 60
export const JIEFANG_HIDDEN_PLAYER_MIN_DIST_M = 90
export const JIEFANG_HIDDEN_FRUSTUM_MAX_DIST_M = 120
export const JIEFANG_APPROACH_OUTER_X = 285
export const JIEFANG_APPROACH_SPAWN_MIN_ABS_X = 205
const JIEFANG_APPROACH_PREROLL_MIN_ABS_X = 262

/**
 * Signed distance along the bridge corridor beyond the nearest Jiefang Bridge end (`±140.5m`):
 *  - `> 0` outside the bridge deck along the West/East approaches (e.g. `65` at `lx = ±205.5m`)
 *  - `<= 0` on the bridge deck (`lx ∈ [-140.5, +140.5]`)
 */
export function jiefangBridgeEndDistanceM(pos: {readonly x: number; readonly z: number}): number {
  const [lx] = worldToJiefangBridgeLocal(pos.x, pos.z)
  if (lx < JIEFANG_CROSS_SECTION.minX) return JIEFANG_CROSS_SECTION.minX - lx
  if (lx > JIEFANG_CROSS_SECTION.maxX) return lx - JIEFANG_CROSS_SECTION.maxX
  return -Math.min(lx - JIEFANG_CROSS_SECTION.minX, JIEFANG_CROSS_SECTION.maxX - lx)
}

/**
 * True when a point lies on the elevated Jiefang Bridge deck OR its elevated West/East approach
 * corridors (excluding under-bridge riverfront roads like Binjiang Rd at y ≈ 146.5 m).
 */
export function isOnJiefangApproachCorridor(
  pos: {readonly x: number; readonly y?: number; readonly z: number} | null | undefined,
): boolean {
  if (!pos) return false
  const [lx, lz] = worldToJiefangBridgeLocal(pos.x, pos.z)
  if (Math.abs(lx) > JIEFANG_APPROACH_OUTER_X + 140 || Math.abs(lz) > 24) return false
  if (pos.y !== undefined && Number.isFinite(pos.y)) {
    if (pos.y < 149.2 || pos.y > 156.5) return false
  }
  return true
}

export interface CrossSectionBand {
  readonly minZ: number
  readonly maxZ: number
}

export interface JiefangBridgeCrossSection {
  readonly northSidewalk: CrossSectionBand
  readonly northNonmotor: CrossSectionBand
  readonly northMotor: CrossSectionBand
  readonly southMotor: CrossSectionBand
  readonly southNonmotor: CrossSectionBand
  readonly southSidewalk: CrossSectionBand
}

/**
 * Fallback Jiefang Bridge cross-section measured directly from `pipeline/landmarks/jiefang_bridge.py`:
 *  - Sidewalks (light-gray paved + granite curb at ±16.16m): [-21.5, -16.175] and [+16.175, +21.5]
 *  - Black asphalt non-motor lanes: [-16.0, -12.1] (north/WB) and [+12.1, +16.0] (south/EB)
 *  - Motor carriageways (3 lanes each way): [-11.9, -0.2] and [+0.2, +11.9]
 * Automatically yields to `JIEFANG_CROSS_SECTION` exported from `web/src/traffic-duty/jiefang-railings.ts` when present.
 */
export const FALLBACK_JIEFANG_CROSS_SECTION: Readonly<JiefangBridgeCrossSection> = Object.freeze({
  northSidewalk: Object.freeze({minZ: -21.5, maxZ: -16.175}),
  northNonmotor: Object.freeze({minZ: -16.0, maxZ: -12.1}),
  northMotor: Object.freeze({minZ: -11.9, maxZ: -0.2}),
  southMotor: Object.freeze({minZ: 0.2, maxZ: 11.9}),
  southNonmotor: Object.freeze({minZ: 12.1, maxZ: 16.0}),
  southSidewalk: Object.freeze({minZ: 16.175, maxZ: 21.5}),
})

export function getJiefangCrossSection(): JiefangBridgeCrossSection {
  return {
    northSidewalk: {minZ: JIEFANG_CROSS_SECTION.northSidewalk.minZ, maxZ: JIEFANG_CROSS_SECTION.northSidewalk.maxZ},
    northNonmotor: {minZ: JIEFANG_CROSS_SECTION.northNonmotor.minZ, maxZ: JIEFANG_CROSS_SECTION.northNonmotor.maxZ},
    northMotor: {minZ: JIEFANG_CROSS_SECTION.northMotor.minZ, maxZ: JIEFANG_CROSS_SECTION.northMotor.maxZ},
    southMotor: {minZ: JIEFANG_CROSS_SECTION.southMotor.minZ, maxZ: JIEFANG_CROSS_SECTION.southMotor.maxZ},
    southNonmotor: {minZ: JIEFANG_CROSS_SECTION.southNonmotor.minZ, maxZ: JIEFANG_CROSS_SECTION.southNonmotor.maxZ},
    southSidewalk: {minZ: JIEFANG_CROSS_SECTION.southSidewalk.minZ, maxZ: JIEFANG_CROSS_SECTION.southSidewalk.maxZ},
  }
}

export function classifyJiefangCrossSectionZone(
  pos: {readonly x: number; readonly y?: number; readonly z: number} | null | undefined,
): DutyCrossSectionZone {
  if (!pos || !isOnJiefangBridgeDeck(pos)) return 'off_bridge'
  const [, lz] = worldToJiefangBridgeLocal(pos.x, pos.z)
  const role = classifyJiefangCrossSectionZ(lz)
  if (role === 'sidewalk' || role === 'curb') return 'sidewalk'
  if (role === 'nonmotor' || role === 'railing') return 'nonmotor'
  if (role === 'motor' || role === 'median') return 'motor'
  return 'off_bridge'
}

/**
 * Runtime hard cross-section constraint derived strictly from `JIEFANG_CROSS_SECTION`:
 *  - Two-wheelers (`scooter`) are clamped inside the black asphalt non-motor safe corridor
 *    (`northNonmotor.safeMinZ..safeMaxZ` or `southNonmotor.safeMinZ..safeMaxZ`), keeping even
 *    body half-width (0.30 m) completely off the sidewalks and railings.
 *  - Cars (`car`) are clamped inside the motor carriageway safe corridor with half-width clearance.
 */
export function constrainJiefangActorPosition(actor: Actor): void {
  if (actor.kind === 'person') return
  const [lx, lz] = worldToJiefangBridgeLocal(actor.x, actor.z)
  if (lx < -(JIEFANG_APPROACH_OUTER_X + 12) || lx > JIEFANG_APPROACH_OUTER_X + 12) return
  const south = lz >= 0
  let clampedLz = lz
  if (actor.kind === 'scooter') {
    if (actorHasViolation(actor, 'sidewalk_riding')) {
      // Sidewalk-riding violator (story override / encroachment): route cleanly between tactile paving (±16.93) and lamp posts (±18.9)
      // Separate forward (!wrongWay) and reverse (wrongWay) into dual sub-lanes (~0.74m apart > 0.42m opposite minLat & 0.60m combined widths)
      // so bidirectional sidewalk violators pass cleanly without head-on deadlocks or clipping tactile strip/lamp posts.
      const sw = south ? JIEFANG_CROSS_SECTION.southSidewalk : JIEFANG_CROSS_SECTION.northSidewalk
      const pullingOver = actor.dutyState === 'pulling_over' || actor.dutyState === 'pulled_over'
      if (pullingOver) {
        const swMin = south ? Math.max(sw.minZ + 1.05, 17.25) : Math.max(sw.minZ + 3.05, -18.45)
        const swMax = south ? Math.min(sw.maxZ - 3.05, 18.45) : Math.min(sw.maxZ - 1.05, -17.25)
        clampedLz = Math.max(swMin, Math.min(swMax, lz))
      } else {
        const targetAbs = actor.wrongWay ? 18.22 : 17.48
        const halfBand = 0.08
        const subMin = south
          ? Math.max(sw.minZ + 1.15, targetAbs - halfBand)
          : Math.max(sw.minZ + 3.1, -(targetAbs + halfBand))
        const subMax = south
          ? Math.min(sw.maxZ - 3.1, targetAbs + halfBand)
          : Math.min(sw.maxZ - 1.15, -(targetAbs - halfBand))
        clampedLz = Math.max(subMin, Math.min(subMax, lz))
      }
    } else {
      const band = south ? JIEFANG_CROSS_SECTION.southNonmotor : JIEFANG_CROSS_SECTION.northNonmotor
      clampedLz = Math.max(band.safeMinZ, Math.min(band.safeMaxZ, lz))
    }
  } else if (actor.kind === 'car' && lx >= JIEFANG_CROSS_SECTION.minX - 4 && lx <= JIEFANG_CROSS_SECTION.maxX + 4) {
    const band = south ? JIEFANG_CROSS_SECTION.southMotor : JIEFANG_CROSS_SECTION.northMotor
    const margin = Math.min(1.05, Math.max(0.85, actor.halfWidth || 0.9))
    clampedLz = Math.max(band.minZ + margin, Math.min(band.maxZ - margin, lz))
  }
  if (Math.abs(clampedLz - lz) > 1e-4) {
    const [wx, wz] = jiefangBridgeLocalToWorld(lx, clampedLz)
    actor.x = wx
    actor.z = wz
  }
}

let dutyHornAudioCtx: AudioContext | null = null
let activeDutyHorns = 0

/**
 * Plays a short dual-tone car warning horn when a motor vehicle warns an auxiliary police officer
 * on Jiefang Bridge. Respects `rideSoundMuted()` & `masterVolume()` and safely no-ops in Node/headless.
 */
export function playDutyWarningHornSound(actor?: {kind?: string}): boolean {
  if (typeof window === 'undefined' || rideSoundMuted()) return false
  const vol = masterVolume()
  if (vol <= 0 || activeDutyHorns >= 2) return false
  const win = window as unknown as {AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext}
  const Ctor = win.AudioContext ?? win.webkitAudioContext
  if (!Ctor) return false
  try {
    dutyHornAudioCtx ??= new Ctor()
    const ctx = dutyHornAudioCtx
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    if (ctx.state !== 'running') return false
    const now = ctx.currentTime
    const isScooter = actor?.kind === 'scooter'
    const base = isScooter ? 820 : 380
    const peak = Math.min(0.18, 0.14 * vol)
    const toots: readonly [number, number][] = isScooter ? [[0, 0.11], [0.16, 0.11]] : [[0, 0.13], [0.19, 0.28]]
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = isScooter ? 3000 : 2200
    tone.Q.value = 0.8
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    for (const [at, dur] of toots) {
      gain.gain.setValueAtTime(0.0001, now + at)
      gain.gain.linearRampToValueAtTime(peak, now + at + 0.012)
      gain.gain.setValueAtTime(peak, now + at + Math.max(0.02, dur - 0.025))
      gain.gain.linearRampToValueAtTime(0.0001, now + at + dur)
    }
    const end = now + toots[toots.length - 1][0] + toots[toots.length - 1][1] + 0.02
    const ratios = isScooter ? [1] : [1, 1.19]
    const oscs = ratios.map(ratio => {
      const osc = ctx.createOscillator()
      osc.type = isScooter ? 'square' : 'sawtooth'
      osc.frequency.value = base * ratio
      osc.connect(tone)
      osc.start(now)
      osc.stop(end)
      return osc
    })
    tone.connect(gain)
    gain.connect(ctx.destination)
    activeDutyHorns++
    oscs[0].onended = () => {
      activeDutyHorns = Math.max(0, activeDutyHorns - 1)
      for (const osc of oscs) osc.disconnect()
      tone.disconnect()
      gain.disconnect()
    }
    return true
  } catch {
    return false
  }
}

/**
 * Bridge-native violation weights aligned with the 60% non-motor violation baseline
 * (and 80% conditional `no_helmet` rate via `pickTwoWheelProfile`).
 * Story mode can dynamically override density, violation rate, and `sidewalk_riding` via `setStoryOverride()`.
 * Bridge deck bounds single source of truth lives in `web/src/traffic-duty/jiefang-railings.ts`.
 */
export const JIEFANG_DUTY_WEIGHTS: Readonly<DutyViolationWeights> = Object.freeze({
  none: 40,
  no_helmet: 20,
  ebike_overload: 13,
  bike_double: 8,
  illegal_mod: 10,
  wrong_way: 9,
  red_light_run: 0,
  sidewalk_riding: 0,
})

// ─── IDOK-541 解放桥剧情执勤预设（仅在 controller 请求剧情模式且本实例为桥面 deckOnly 车流时落地） ───

/** 剧情模式次级违章相对权重（不含 no_helmet；闯红灯在桥面关闭）。 */
export const JIEFANG_STORY_SECONDARY_WEIGHTS = Object.freeze({
  ebike_overload: 10,
  bike_double: 8,
  // 次级单项期望 ≈ ¥63 → 每辆违规车 F̄ ≈ ¥107–112（数罪并罚累加，目标 104–125）
  illegal_mod: 22,
  wrong_way: 9,
  sidewalk_riding: 12,
  red_light_run: 0,
})

const JIEFANG_STORY_OVERRIDE_BASE: Readonly<DutyStoryOverrideConfig> = Object.freeze({
  active: true,
  nonmotorViolationRate: 0.88,
  noHelmetGivenViolatorRate: 0.8,
  multiViolationStackRate: 0.8,
  allowSidewalkRiding: true,
  sidewalkRidingWeight: 12,
  allowWrongWay: true,
  allowRedLightRun: false,
  secondaryWeights: JIEFANG_STORY_SECONDARY_WEIGHTS,
  maxViolatorRatio: 1.0,
  violatorCooldownSec: 0,
})

/** 桌面：38 两轮 + 16 机动车 = 54 ≤ 56 actor 上限。 */
export const JIEFANG_STORY_OVERRIDE_DESKTOP: Readonly<DutyStoryOverrideConfig> = Object.freeze({
  ...JIEFANG_STORY_OVERRIDE_BASE,
  desiredCars: 16,
  desiredScooters: 38,
  maxConcurrentViolators: 40,
})

/** 手机：30 两轮 + 10 机动车 = 40 ≤ 42 actor 上限。 */
export const JIEFANG_STORY_OVERRIDE_MOBILE: Readonly<DutyStoryOverrideConfig> = Object.freeze({
  ...JIEFANG_STORY_OVERRIDE_BASE,
  desiredCars: 10,
  desiredScooters: 30,
  maxConcurrentViolators: 32,
})

/** 罚款池统计用默认罚款标准（与 controller / 罚款终端同源）。 */
const DEFAULT_POOL_FINE_TABLE: Readonly<DutyFineTable> = Object.freeze(resolveDutyFineTable())

/**
 * 剧情模式同向两轮车隐藏入场最小车头间距（米）：
 * 解放桥南北非机动车道/人行道横向间距约 28~35m；sim 以欧氏距离校验 headway，
 * 若小于 28m 会导致南北成对扎堆发车、出现 200m+ 空档；保持 36m 可让 38 辆两轮车均匀铺满全桥零空档。
 */
export const JIEFANG_STORY_SCOOTER_HEADWAY_M = 36
/** 罚款池流量模型：东西引桥 + 桥面全长（|lx| ≤ 285m）。 */
export const JIEFANG_STORY_CORRIDOR_LENGTH_M = JIEFANG_APPROACH_OUTER_X * 2
/** 罚款池流量模型：两轮车平均通过速度（米/秒）。 */
export const JIEFANG_STORY_MEAN_SCOOTER_SPEED_MPS = 6

export type JiefangFinePoolProfile = 'desktop' | 'mobile'

export function resolveJiefangStoryOverride(profile: JiefangFinePoolProfile): Readonly<DutyStoryOverrideConfig> {
  return profile === 'mobile' ? JIEFANG_STORY_OVERRIDE_MOBILE : JIEFANG_STORY_OVERRIDE_DESKTOP
}

function makeFinePoolRng(seed: number): () => number {
  // mulberry32：确定性、可复现
  let s = seed >>> 0 || 0x9e3779b9
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface JiefangViolatorFineSample {
  /** 抽样两轮车数。 */
  samples: number
  /** 违规车占比（≈ nonmotorViolationRate）。 */
  violatorShare: number
  /** 每辆违规车平均罚款（元，数罪并罚累加）。 */
  meanFinePerViolatorYuan: number
  /** 每辆两轮车平均罚款（元，含守规车 0 元）。 */
  meanFinePerScooterYuan: number
  /** 违规车中 ≥2 项叠加的占比。 */
  multiViolationShare: number
}

/**
 * 以与 sim 完全一致的 `pickTwoWheelProfile` + 剧情覆盖做确定性蒙特卡洛，估计每辆违规车的平均罚款。
 */
export function sampleJiefangViolatorFines(opts?: {
  profile?: JiefangFinePoolProfile
  storyOverride?: DutyStoryOverrideConfig
  fineTable?: Partial<DutyFineTable>
  samples?: number
  seed?: number
}): JiefangViolatorFineSample {
  const story = opts?.storyOverride ?? resolveJiefangStoryOverride(opts?.profile ?? 'desktop')
  const table = resolveDutyFineTable(opts?.fineTable)
  const samples = Math.max(100, Math.round(opts?.samples ?? 20000))
  const rng = makeFinePoolRng(opts?.seed ?? 541)
  const policy: TrafficViolationPolicy = {
    nonmotorViolationRate: JIEFANG_NONMOTOR_VIOLATION_RATE,
    noHelmetGivenViolatorRate: JIEFANG_NO_HELMET_CONDITIONAL_RATE,
    allowSidewalkRiding: false,
  }
  let violators = 0
  let multi = 0
  let fineSum = 0
  for (let i = 0; i < samples; i++) {
    const p = pickTwoWheelProfile(rng, JIEFANG_DUTY_WEIGHTS, true, {
      allowWrongWay: true,
      policy,
      storyOverride: {active: true, ...story},
    })
    if (p.violations.length === 0) continue
    violators++
    if (p.violations.length >= 2) multi++
    fineSum += computeFineYuanStack(p.violations, table)
  }
  return {
    samples,
    violatorShare: violators / samples,
    meanFinePerViolatorYuan: violators > 0 ? fineSum / violators : 0,
    meanFinePerScooterYuan: fineSum / samples,
    multiViolationShare: violators > 0 ? multi / violators : 0,
  }
}

export interface JiefangFinePoolEstimate {
  profile: JiefangFinePoolProfile
  durationSec: number
  /** 每个方向（北 / 南非机动车道）同时在场两轮车数。 */
  scootersPerSide: number
  /** 两轮车穿越 570m 走廊的平均时长（秒）。 */
  traversalSec: number
  /** 时长内每个方向经过的两轮车总数 n·(1 + t/T)。 */
  scootersPerSideOverDuration: number
  violatorShare: number
  meanFinePerViolatorYuan: number
  multiViolationShare: number
  northYuan: number
  southYuan: number
  totalYuan: number
}

/**
 * 纯函数：解放桥剧情模式理论罚款池（双向合计）。
 *
 * 流量模型：pool_side = n · r · F̄ · (1 + t / T)，
 *  - n：单方向同时在场两轮车（desiredScooters / 2）；r：违规占比；F̄：每辆违规车平均罚款；
 *  - T = 走廊长度 / 平均速度（默认 570m / 6m·s⁻¹ ≈ 95s）；初始在场车 + 时长内新入场车各计一次。
 */
export function estimateJiefangDutyFinePool(opts: {
  durationSec: number
  profile?: JiefangFinePoolProfile
  fineTable?: Partial<DutyFineTable>
  storyOverride?: DutyStoryOverrideConfig
  samples?: number
  seed?: number
  corridorLengthM?: number
  meanScooterSpeedMps?: number
}): JiefangFinePoolEstimate {
  const profile = opts.profile ?? 'desktop'
  const story = opts.storyOverride ?? resolveJiefangStoryOverride(profile)
  const durationSec = Math.max(0, Number.isFinite(opts.durationSec) ? opts.durationSec : 0)
  const fines = sampleJiefangViolatorFines({
    storyOverride: story,
    fineTable: opts.fineTable,
    samples: opts.samples,
    seed: opts.seed,
  })
  const scootersPerSide = Math.max(0, (story.desiredScooters ?? 0) / 2)
  const corridor = Math.max(1, opts.corridorLengthM ?? JIEFANG_STORY_CORRIDOR_LENGTH_M)
  const speed = Math.max(0.5, opts.meanScooterSpeedMps ?? JIEFANG_STORY_MEAN_SCOOTER_SPEED_MPS)
  const traversalSec = corridor / speed
  const scootersPerSideOverDuration = scootersPerSide * (1 + durationSec / traversalSec)
  const sideYuan = Math.round(scootersPerSideOverDuration * fines.violatorShare * fines.meanFinePerViolatorYuan)
  return {
    profile,
    durationSec,
    scootersPerSide,
    traversalSec,
    scootersPerSideOverDuration,
    violatorShare: fines.violatorShare,
    meanFinePerViolatorYuan: fines.meanFinePerViolatorYuan,
    multiViolationShare: fines.multiViolationShare,
    northYuan: sideYuan,
    southYuan: sideYuan,
    totalYuan: sideYuan * 2,
  }
}

/** 运行时可观测的双向罚款池（`getStats().finePool`）。 */
export interface DutyFinePoolStats {
  /** 本次计数起（剧情落地或 start）累计入场违规两轮车理论罚款：北侧（lz<0）。 */
  northYuan: number
  /** 南侧（lz≥0）。 */
  southYuan: number
  totalYuan: number
  /** 当前桥面在场、未开单违规车理论罚款。 */
  liveNorthYuan: number
  liveSouthYuan: number
  liveTotalYuan: number
  violatorsSeen: number
  meanFinePerViolatorYuan: number
  elapsedSec: number
}

export interface DutyTrafficOptions {
  scene?: THREE.Scene
  camera?: THREE.Camera
  sampleGround?: Traffic['sampleGround']
  /** Optional preloaded road graph (ideal for Node unit tests or deterministic fixtures). */
  graph?: Graph
  /** Optional async graph loader override; defaults to fetching `/world/roads/-1_0.json.gz`. */
  loadGraph?: () => Promise<Graph>
  center?: {x: number; z: number}
  radiusM?: number
  desiredCars?: number
  desiredScooters?: number
  actorLimit?: number
  weights?: DutyViolationWeights
  /** Optional violation/compliance rule policy overrides (e.g. nonmotorViolationRate, noHelmetGivenViolatorRate, allowSidewalkRiding). */
  policy?: TrafficViolationPolicy
  /** Optional initial story-mode override configuration (density, sidewalk_riding, violation rate). */
  storyOverride?: DutyStoryOverrideConfig | null
  /** Restrict spawned lanes to Jiefang Bridge deck (with Y elevation check); defaults to true near Jiefang Bridge. */
  bridgeDeckOnly?: boolean
  maxViolatorRatio?: number
  maxConcurrentViolators?: number
  violatorCooldownSec?: number
  random?: () => number
  onPlayerHit?: PlayerHitCallback
  onPlayerHorn?: PlayerHornCallback
  onViolatorPulledOver?: ViolatorPulledOverCallback
  onTicketReceived?: TicketReceivedCallback
  onActorSpawn?: ActorLifecycleCallback
  onActorDespawn?: ActorLifecycleCallback
}

export interface DutyTrafficStepOptions {
  officerActive?: boolean
  officerYaw?: number
  officerRunning?: boolean
  officerZone?: DutyCrossSectionZone
  vehiclePos?: Position
  cameraPos?: Position
  visible?: (point: Position) => boolean
}

export interface DutyLifecycleStats {
  spawns: number
  despawns: number
  deferredSpawns: number
  deferredDespawns: number
  minSpawnBridgeEndDistM: number | null
  minDespawnBridgeEndDistM: number | null
  minSpawnPlayerDistM: number | null
  minDespawnPlayerDistM: number | null
  frustumViolations120m: number
}

export interface DutyTrafficStats {
  active: boolean
  total: number
  cars: number
  scooters: number
  violators: number
  violatorRatio: number
  nonmotorViolationRate: number
  noHelmetViolatorRate: number
  multiViolationCount: number
  sidewalkRidingViolators: number
  storyOverrideActive: boolean
  violatorCooldownRemainingSec: number
  warningHorns: number
  sidewalkTwoWheelers: number
  nonmotorLaneCars: number
  lastHitSpeedKmh: number | null
  lastHitSeverity: HitSeverity | null
  fleeing: number
  halted: number
  braking: number
  /** IDOK-541：本实例是否已落地解放桥剧情模式（正面拦车几何 + 逃逸气泡）。 */
  jiefangStoryMode: boolean
  /** IDOK-541：双向理论罚款池。 */
  finePool: DutyFinePoolStats
}

export interface DutyTrafficHandle {
  start(override?: {center?: {x: number; z: number}; radiusM?: number}): Promise<void>
  stop(): void
  dispose(): void
  isActive(): boolean
  step(dt: number, playerPos?: Position | null, opts?: DutyTrafficStepOptions): void
  getTraffic(): Traffic | undefined
  getActors(): readonly Actor[]
  /** Dynamically overrides regional violation density, `sidewalk_riding`, and caps for duty story mode. */
  setStoryOverride(override: DutyStoryOverrideConfig | null): void
  clearStoryOverride(): void
  getStoryOverride(): Readonly<DutyStoryOverrideConfig> | null
  /** Queries the full deduplicated multi-violation list for a given actor or actorId. */
  getActorViolations(actorIdOrActor: string | number | Actor): ActiveTrafficViolation[]
  /** Queries snapshots of active violators including complete violation list, bitmask, and heading vector. */
  getViolatorSnapshots(opts?: {includeCited?: boolean}): ActorViolationSnapshot[]
  onPlayerHit(listener: PlayerHitCallback): () => void
  onPlayerHorn(listener: PlayerHornCallback): () => void
  onViolatorPulledOver(listener: ViolatorPulledOverCallback): () => void
  onViolatorPulledOver(actor: Actor, durationSec?: number): boolean
  onTicketReceived(listener: TicketReceivedCallback): () => void
  onTicketReceived(
    actor: Actor,
    receipt?: {
      ticketId?: string
      fineYuan?: number
      plateNo?: string
      violation?: string
      ticketObject?: THREE.Object3D
      handSide?: ActorHandSide
    },
  ): void
  onActorSpawn(listener: ActorLifecycleCallback): () => void
  onActorDespawn(listener: ActorLifecycleCallback): () => void
  getActorHandBone(actorIdOrActor: string | number | Actor, side?: ActorHandSide): THREE.Object3D | null
  receiveTicket(
    actorIdOrActor: string | number | Actor,
    opts?: ReceiveTicketOptions & {ticketObject?: THREE.Object3D},
  ): ReceiveTicketResult & {handBone?: THREE.Object3D | null; ticketObject?: THREE.Object3D | null}
  releaseViolator(actorIdOrActor: string | number | Actor): boolean
  commandRelease(origin: Position, rangeM?: number): Actor[]
  notifyViolatorCited(actor?: Actor): void
  commandHalt(
    origin: Position,
    opts?: {kind?: 'whistle' | 'flag'; rangeM?: number; haltProbability?: number; stopDurationSec?: number; pullOver?: boolean; random?: () => number},
  ): WhistleFlagHaltResult
  getStats(): DutyTrafficStats
  getLifecycleStats(): DutyLifecycleStats
  /** IDOK-541：剧情模式下违规车跑路（侧后方拦车 / sim 被动发现带）事件；已过单车 6s + 全局 0.3s 节流。 */
  onViolatorEscape(listener: DutyEscapeListener): () => void
}

let activeDutyRef:
  | {
      sim: Traffic
      center: {x: number; z: number}
      radius: number
      getActorHandBone: DutyTrafficHandle['getActorHandBone']
      receiveTicket: DutyTrafficHandle['receiveTicket']
      setStoryOverride: DutyTrafficHandle['setStoryOverride']
      getStoryOverride: DutyTrafficHandle['getStoryOverride']
      getViolatorSnapshots: DutyTrafficHandle['getViolatorSnapshots']
    }
  | undefined

export function getActiveDutyTraffic(): Traffic | undefined {
  return activeDutyRef?.sim
}

export function setActiveDutyStoryOverride(override: DutyStoryOverrideConfig | null): boolean {
  if (!activeDutyRef) return false
  activeDutyRef.setStoryOverride(override)
  return true
}

export function getActorHandBone(
  actorIdOrActor: string | number | Actor,
  side: ActorHandSide = 'right',
): THREE.Object3D | null {
  return activeDutyRef?.getActorHandBone(actorIdOrActor, side) ?? null
}

export function receiveDutyTicket(
  actorIdOrActor: string | number | Actor,
  opts?: ReceiveTicketOptions & {ticketObject?: THREE.Object3D},
): ReceiveTicketResult & {handBone?: THREE.Object3D | null; ticketObject?: THREE.Object3D | null} {
  if (!activeDutyRef) return {ok: false, reason: 'not_found'}
  return activeDutyRef.receiveTicket(actorIdOrActor, opts)
}

export function isDutyTrafficActive(): boolean {
  return Boolean(activeDutyRef)
}

export function getDutyTrafficExclusionZone(): {center: {x: number; z: number}; radius: number} | null {
  if (!activeDutyRef) return null
  return {center: activeDutyRef.center, radius: activeDutyRef.radius}
}

async function fetchDefaultJiefangGraph(): Promise<Graph> {
  const response = await fetch(`/world/roads/${JIEFANG_DUTY_ROAD_CELL}.json.gz`)
  if (!response.ok || !response.body) throw Error(`duty traffic graph: ${response.status}`)
  const bytes = await response.arrayBuffer()
  const sig = new Uint8Array(bytes, 0, 2)
  const body =
    sig[0] === 31 && sig[1] === 139
      ? new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
      : bytes
  const decoded = await new Response(body).arrayBuffer()
  return JSON.parse(new TextDecoder().decode(decoded)) as Graph
}

function sampleLaneHeight(lane: Graph['lanes'][number], startY: number, endY: number, fraction: number): number {
  const heights = lane.heights
  if (!heights || heights.length < 4) return startY + (endY - startY) * fraction
  let lo = 0
  let hi = Math.floor(heights.length / 2) - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1
    if (heights[mid * 2] <= fraction) lo = mid
    else hi = mid
  }
  const index = lo * 2
  const span = heights[index + 2] - heights[index]
  if (Math.abs(span) < 1e-6) return heights[index + 1]
  return heights[index + 1] + ((heights[index + 3] - heights[index + 1]) * (fraction - heights[index])) / span
}

function isLaneOnJiefangBridgeDeck(
  lane: Graph['lanes'][number],
  nodeMap: Map<number, Graph['nodes'][number]>,
): boolean {
  const a = nodeMap.get(lane.from)
  const b = nodeMap.get(lane.to)
  if (!a || !b) return false
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len = Math.hypot(dx, dz) || 1
  const nx = -dz / len
  const nz = dx / len
  const off = lane.offset ?? 0
  const ax = a.x + nx * off
  const az = a.z + nz * off
  const bx = b.x + nx * off
  const bz = b.z + nz * off
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const x = ax + (bx - ax) * t
    const z = az + (bz - az) * t
    const y = sampleLaneHeight(lane, a.y, b.y, t)
    if (!isOnJiefangBridgeDeck({x, y, z})) return false
  }
  if (lane.heights && lane.heights.length >= 4) {
    for (let i = 0; i + 1 < lane.heights.length; i += 2) {
      const t = Math.max(0, Math.min(1, lane.heights[i]))
      const x = ax + (bx - ax) * t
      const z = az + (bz - az) * t
      const y = lane.heights[i + 1]
      if (!isOnJiefangBridgeDeck({x, y, z})) return false
    }
  }
  return true
}

/**
 * Filters a cell graph down to lanes intersecting `radiusM + 100 m` of the duty zone center.
 * When `bridgeDeckOnly` is true:
 *  - Restricts lanes strictly to the elevated Jiefang Bridge deck (`isOnJiefangBridgeDeck` including Y height).
 *  - Keeps motor lanes strictly inside the motor carriageway (`northMotor` / `southMotor`).
 *  - Re-projects non-motor lanes strictly onto the center of the black asphalt non-motor lane
 *    (`northNonmotor` / `southNonmotor`), guaranteeing zero two-wheelers on the riverside sidewalks.
 */
export function sliceDutySubgraph(
  graph: Graph,
  center: {x: number; z: number},
  radiusM: number,
  bridgeDeckOnly = false,
): Graph {
  const keepR = radiusM + 100
  const keepRSq = keepR * keepR
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]))
  const xs = bridgeDeckOnly ? getJiefangCrossSection() : undefined
  const northNonmotorCenterZ = bridgeDeckOnly ? JIEFANG_CROSS_SECTION.northNonmotor.centerlineZ : -14.065
  const southNonmotorCenterZ = bridgeDeckOnly ? JIEFANG_CROSS_SECTION.southNonmotor.centerlineZ : 14.065
  const nonmotorNodeClones = new Map<number, Graph['nodes'][number]>()
  let nextCloneId = -1_000_000
  const keptNodeMap = new Map<number, Graph['nodes'][number]>()
  const lanes: Graph['lanes'] = []

  const getSnappedNonmotorNode = (orig: Graph['nodes'][number]): Graph['nodes'][number] => {
    const existing = nonmotorNodeClones.get(orig.id)
    if (existing) return existing
    const [lx, lz] = worldToJiefangBridgeLocal(orig.x, orig.z)
    const clampedLx = Math.max(-139.5, Math.min(139.5, lx))
    const targetLz = lz < 0 ? northNonmotorCenterZ : southNonmotorCenterZ
    const [wx, wz] = jiefangBridgeLocalToWorld(clampedLx, targetLz)
    const wy = jiefangDeckWorldY(wx, wz)
    const cloned: Graph['nodes'][number] = {id: nextCloneId--, x: wx, y: wy, z: wz}
    nonmotorNodeClones.set(orig.id, cloned)
    keptNodeMap.set(cloned.id, cloned)
    return cloned
  }

  for (const l of graph.lanes) {
    const a = nodeMap.get(l.from)
    const b = nodeMap.get(l.to)
    if (!a || !b) continue
    const mx = (a.x + b.x) * 0.5
    const mz = (a.z + b.z) * 0.5
    if ((mx - center.x) ** 2 + (mz - center.z) ** 2 > keepRSq) continue
    if (bridgeDeckOnly) {
      if (!isLaneOnJiefangBridgeDeck(l, nodeMap)) continue
      if (l.kind === 'nonmotor') {
        const na = getSnappedNonmotorNode(a)
        const nb = getSnappedNonmotorNode(b)
        const heights: number[] = []
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const sx = na.x + (nb.x - na.x) * t
          const sz = na.z + (nb.z - na.z) * t
          heights.push(t, jiefangDeckWorldY(sx, sz))
        }
        lanes.push({
          ...l,
          from: na.id,
          to: nb.id,
          offset: 0,
          width: Math.min(l.width ?? 3, Math.max(2.2, (xs!.southNonmotor.maxZ - xs!.southNonmotor.minZ) * 0.85)),
          heights,
        })
        continue
      }
      // Motor lanes must remain strictly inside the motor carriageway
      const dx = b.x - a.x
      const dz = b.z - a.z
      const len = Math.hypot(dx, dz) || 1
      const nx = -dz / len
      const nz = dx / len
      const off = l.offset ?? 0
      const [, alz] = worldToJiefangBridgeLocal(a.x + nx * off, a.z + nz * off)
      const [, blz] = worldToJiefangBridgeLocal(b.x + nx * off, b.z + nz * off)
      const inMotor = (z: number) =>
        (z >= xs!.northMotor.minZ && z <= xs!.northMotor.maxZ) ||
        (z >= xs!.southMotor.minZ && z <= xs!.southMotor.maxZ)
      if (!inMotor(alz) || !inMotor(blz)) continue
    }
    keptNodeMap.set(a.id, a)
    keptNodeMap.set(b.id, b)
    lanes.push(l)
  }

  // r8-1: Extend West & East approach corridors >= 60 m beyond both bridge ends (±140.5 m -> ±285 m)
  // so vehicles spawn & recycle invisibly off-bridge and flow continuously onto and off the deck.
  if (bridgeDeckOnly && lanes.length > 0) {
    let nextApproachLaneId = -2_000_000
    const mkApproachNode = (lx: number, lz: number, fallbackY: number): Graph['nodes'][number] => {
      const [wx, wz] = jiefangBridgeLocalToWorld(lx, lz)
      const onDeck = lx >= JIEFANG_CROSS_SECTION.minX && lx <= JIEFANG_CROSS_SECTION.maxX
      const y = onDeck ? jiefangDeckWorldY(wx, wz) : fallbackY
      const n: Graph['nodes'][number] = {id: nextCloneId--, x: wx, y, z: wz}
      keptNodeMap.set(n.id, n)
      return n
    }
    const pushLinearChain = (
      chainNodes: readonly Graph['nodes'][number][],
      base: Omit<Graph['lanes'][number], 'id' | 'from' | 'to' | 'heights'>,
    ) => {
      for (let i = 0; i + 1 < chainNodes.length; i++) {
        const na = chainNodes[i]
        const nb = chainNodes[i + 1]
        if (Math.hypot(nb.x - na.x, nb.z - na.z) < 0.5) continue
        const [alx] = worldToJiefangBridgeLocal(na.x, na.z)
        const [blx] = worldToJiefangBridgeLocal(nb.x, nb.z)
        const crossesDeck = Math.min(alx, blx) < JIEFANG_CROSS_SECTION.maxX && Math.max(alx, blx) > JIEFANG_CROSS_SECTION.minX
        const heights: number[] = []
        if (crossesDeck) {
          for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
            const sx = na.x + (nb.x - na.x) * t
            const sz = na.z + (nb.z - na.z) * t
            const [slx] = worldToJiefangBridgeLocal(sx, sz)
            const sy =
              slx >= JIEFANG_CROSS_SECTION.minX && slx <= JIEFANG_CROSS_SECTION.maxX
                ? jiefangDeckWorldY(sx, sz)
                : na.y + (nb.y - na.y) * t
            heights.push(t, sy)
          }
        } else {
          heights.push(0, na.y, 1, nb.y)
        }
        lanes.push({
          ...base,
          id: nextApproachLaneId--,
          from: na.id,
          to: nb.id,
          heights,
        })
      }
    }

    const nmWidth = Math.max(2.2, (xs!.southNonmotor.maxZ - xs!.southNonmotor.minZ) * 0.85)
    // South nonmotor (EB: West -> East) & North nonmotor (WB: East -> West)
    let southNmWest: {node: Graph['nodes'][number]; lx: number} | null = null
    let southNmEast: {node: Graph['nodes'][number]; lx: number} | null = null
    let northNmWest: {node: Graph['nodes'][number]; lx: number} | null = null
    let northNmEast: {node: Graph['nodes'][number]; lx: number} | null = null
    for (const l of lanes) {
      if (l.kind !== 'nonmotor') continue
      const a = keptNodeMap.get(l.from)
      const b = keptNodeMap.get(l.to)
      if (!a || !b) continue
      const [alx, alz] = worldToJiefangBridgeLocal(a.x, a.z)
      const [blx] = worldToJiefangBridgeLocal(b.x, b.z)
      if (alz >= 0) {
        if (!southNmWest || alx < southNmWest.lx) southNmWest = {node: a, lx: alx}
        if (!southNmEast || blx > southNmEast.lx) southNmEast = {node: b, lx: blx}
      } else {
        if (!northNmEast || alx > northNmEast.lx) northNmEast = {node: a, lx: alx}
        if (!northNmWest || blx < northNmWest.lx) northNmWest = {node: b, lx: blx}
      }
    }
    if (southNmWest && southNmEast) {
      const yW = southNmWest.node.y
      const yE = southNmEast.node.y
      const westChain: Graph['nodes'][number][] = [
        mkApproachNode(-JIEFANG_APPROACH_OUTER_X, southNonmotorCenterZ, yW),
        mkApproachNode(-JIEFANG_APPROACH_PREROLL_MIN_ABS_X, southNonmotorCenterZ, yW),
        mkApproachNode(-206, southNonmotorCenterZ, yW),
      ]
      if (southNmWest.lx > -136) westChain.push(mkApproachNode(-140, southNonmotorCenterZ, yW))
      westChain.push(southNmWest.node)
      pushLinearChain(westChain, {
        kind: 'nonmotor',
        offset: 0,
        width: nmWidth,
        speedKmh: 25,
        cls: 'cycleway',
        gradeSeparated: 'jiefang',
      })
      const eastChain: Graph['nodes'][number][] = [southNmEast.node]
      if (southNmEast.lx < 136) eastChain.push(mkApproachNode(140, southNonmotorCenterZ, yE))
      eastChain.push(
        mkApproachNode(206, southNonmotorCenterZ, yE),
        mkApproachNode(JIEFANG_APPROACH_PREROLL_MIN_ABS_X, southNonmotorCenterZ, yE),
        mkApproachNode(JIEFANG_APPROACH_OUTER_X, southNonmotorCenterZ, yE),
      )
      pushLinearChain(eastChain, {
        kind: 'nonmotor',
        offset: 0,
        width: nmWidth,
        speedKmh: 25,
        cls: 'cycleway',
        gradeSeparated: 'jiefang',
      })
    }
    if (northNmEast && northNmWest) {
      const yE = northNmEast.node.y
      const yW = northNmWest.node.y
      const eastChain: Graph['nodes'][number][] = [
        mkApproachNode(JIEFANG_APPROACH_OUTER_X, northNonmotorCenterZ, yE),
        mkApproachNode(JIEFANG_APPROACH_PREROLL_MIN_ABS_X, northNonmotorCenterZ, yE),
        mkApproachNode(206, northNonmotorCenterZ, yE),
      ]
      if (northNmEast.lx < 136) eastChain.push(mkApproachNode(140, northNonmotorCenterZ, yE))
      eastChain.push(northNmEast.node)
      pushLinearChain(eastChain, {
        kind: 'nonmotor',
        offset: 0,
        width: nmWidth,
        speedKmh: 25,
        cls: 'cycleway',
        gradeSeparated: 'jiefang',
      })
      const westChain: Graph['nodes'][number][] = [northNmWest.node]
      if (northNmWest.lx > -136) westChain.push(mkApproachNode(-140, northNonmotorCenterZ, yW))
      westChain.push(
        mkApproachNode(-206, northNonmotorCenterZ, yW),
        mkApproachNode(-JIEFANG_APPROACH_PREROLL_MIN_ABS_X, northNonmotorCenterZ, yW),
        mkApproachNode(-JIEFANG_APPROACH_OUTER_X, northNonmotorCenterZ, yW),
      )
      pushLinearChain(westChain, {
        kind: 'nonmotor',
        offset: 0,
        width: nmWidth,
        speedKmh: 25,
        cls: 'cycleway',
        gradeSeparated: 'jiefang',
      })
    }

    // South motor (EB: West -> East) & North motor (WB: East -> West), preserving 3-lane offsets
    let southMotorWest: {node: Graph['nodes'][number]; lx: number; offsets: Set<number>} | null = null
    let southMotorEast: {node: Graph['nodes'][number]; lx: number; offsets: Set<number>} | null = null
    let northMotorEast: {node: Graph['nodes'][number]; lx: number; offsets: Set<number>} | null = null
    let northMotorWest: {node: Graph['nodes'][number]; lx: number; offsets: Set<number>} | null = null
    for (const l of lanes) {
      if (l.kind !== 'motor') continue
      const a = keptNodeMap.get(l.from)
      const b = keptNodeMap.get(l.to)
      if (!a || !b) continue
      const [alx, alz] = worldToJiefangBridgeLocal(a.x, a.z)
      const [blx] = worldToJiefangBridgeLocal(b.x, b.z)
      const off = l.offset ?? 0
      if (alz >= 0 && blx > alx) {
        if (!southMotorWest || alx < southMotorWest.lx - 0.5) {
          southMotorWest = {node: a, lx: alx, offsets: new Set([off])}
        } else if (a.id === southMotorWest.node.id) {
          southMotorWest.offsets.add(off)
        }
        if (!southMotorEast || blx > southMotorEast.lx + 0.5) {
          southMotorEast = {node: b, lx: blx, offsets: new Set([off])}
        } else if (b.id === southMotorEast.node.id) {
          southMotorEast.offsets.add(off)
        }
      } else if (alz < 0 && blx < alx) {
        if (!northMotorEast || alx > northMotorEast.lx + 0.5) {
          northMotorEast = {node: a, lx: alx, offsets: new Set([off])}
        } else if (a.id === northMotorEast.node.id) {
          northMotorEast.offsets.add(off)
        }
        if (!northMotorWest || blx < northMotorWest.lx - 0.5) {
          northMotorWest = {node: b, lx: blx, offsets: new Set([off])}
        } else if (b.id === northMotorWest.node.id) {
          northMotorWest.offsets.add(off)
        }
      }
    }
    if (southMotorWest && southMotorEast) {
      const [, zW] = worldToJiefangBridgeLocal(southMotorWest.node.x, southMotorWest.node.z)
      const [, zE] = worldToJiefangBridgeLocal(southMotorEast.node.x, southMotorEast.node.z)
      const westNodes: Graph['nodes'][number][] = [
        mkApproachNode(-JIEFANG_APPROACH_OUTER_X, zW, southMotorWest.node.y),
        mkApproachNode(-JIEFANG_APPROACH_PREROLL_MIN_ABS_X, zW, southMotorWest.node.y),
        mkApproachNode(-206, zW, southMotorWest.node.y),
      ]
      if (southMotorWest.lx > -136) westNodes.push(mkApproachNode(-140, zW, southMotorWest.node.y))
      westNodes.push(southMotorWest.node)
      const eastNodes: Graph['nodes'][number][] = [southMotorEast.node]
      if (southMotorEast.lx < 136) eastNodes.push(mkApproachNode(140, zE, southMotorEast.node.y))
      eastNodes.push(
        mkApproachNode(206, zE, southMotorEast.node.y),
        mkApproachNode(JIEFANG_APPROACH_PREROLL_MIN_ABS_X, zE, southMotorEast.node.y),
        mkApproachNode(JIEFANG_APPROACH_OUTER_X, zE, southMotorEast.node.y),
      )
      for (const off of southMotorWest.offsets) {
        pushLinearChain(westNodes, {kind: 'motor', offset: off, width: 3.5, speedKmh: 45, cls: 'primary', gradeSeparated: 'jiefang'})
      }
      for (const off of southMotorEast.offsets) {
        pushLinearChain(eastNodes, {kind: 'motor', offset: off, width: 3.5, speedKmh: 45, cls: 'primary', gradeSeparated: 'jiefang'})
      }
    }
    if (northMotorEast && northMotorWest) {
      const [, zE] = worldToJiefangBridgeLocal(northMotorEast.node.x, northMotorEast.node.z)
      const [, zW] = worldToJiefangBridgeLocal(northMotorWest.node.x, northMotorWest.node.z)
      const eastNodes: Graph['nodes'][number][] = [
        mkApproachNode(JIEFANG_APPROACH_OUTER_X, zE, northMotorEast.node.y),
        mkApproachNode(JIEFANG_APPROACH_PREROLL_MIN_ABS_X, zE, northMotorEast.node.y),
        mkApproachNode(206, zE, northMotorEast.node.y),
      ]
      if (northMotorEast.lx < 136) eastNodes.push(mkApproachNode(140, zE, northMotorEast.node.y))
      eastNodes.push(northMotorEast.node)
      const westNodes: Graph['nodes'][number][] = [northMotorWest.node]
      if (northMotorWest.lx > -136) westNodes.push(mkApproachNode(-140, zW, northMotorWest.node.y))
      westNodes.push(
        mkApproachNode(-206, zW, northMotorWest.node.y),
        mkApproachNode(-JIEFANG_APPROACH_PREROLL_MIN_ABS_X, zW, northMotorWest.node.y),
        mkApproachNode(-JIEFANG_APPROACH_OUTER_X, zW, northMotorWest.node.y),
      )
      for (const off of northMotorEast.offsets) {
        pushLinearChain(eastNodes, {kind: 'motor', offset: off, width: 3.5, speedKmh: 45, cls: 'primary', gradeSeparated: 'jiefang'})
      }
      for (const off of northMotorWest.offsets) {
        pushLinearChain(westNodes, {kind: 'motor', offset: off, width: 3.5, speedKmh: 45, cls: 'primary', gradeSeparated: 'jiefang'})
      }
    }
  }

  const nodes = [...keptNodeMap.values()]
  const signals = (graph.signals ?? []).filter(s => keptNodeMap.has(s.node))
  return {nodes, lanes, walks: [], signals}
}

interface DutyVisuals {
  batch: THREE.BatchedMesh
  material: THREE.Material
  models: ReturnType<typeof trafficModels>
  riders: ReturnType<typeof riderPool>
  geometryIds: number[]
  slotGeometry: Int16Array
  slotPaint: (THREE.Color | undefined)[]
  slotShown: Uint8Array
  transforms: Float64Array
  pose: THREE.Object3D
  variants: WeakMap<object, {full: Variant; bare?: Variant; subtype?: TwoWheelSubtype; violation?: TrafficViolation; violationMask?: number; noHelmet?: boolean; u: number; v: number}>
  riddenSlots: Map<object, {slot: number; variant: Variant}>
  ridden: Set<object>
  slots: number
  show(slot: number, variant: Variant, x: number, y: number, z: number, yaw: number, scale: number, down?: boolean): void
  hide(from: number, to: number): void
  syncRiddenVehicle(actor: object, x: number, y: number, z: number, yaw: number, scale: number): void
  dispose(): void
}

function mountDutyVisuals(
  scene: THREE.Scene,
  camera: THREE.Camera,
  sampleGround: Traffic['sampleGround'],
  carMeshes: CarMesh[],
  slots: number,
): DutyVisuals {
  const models = trafficModels(carMeshes)
  const material = trafficMaterial()
  const totalVerts = models.geometries.reduce((sum, g) => sum + g.attributes.position.count, 0)
  const batch = new THREE.BatchedMesh(slots, totalVerts, 0, material)
  batch.name = 'G2 duty traffic visuals'
  batch.frustumCulled = false
  batch.perObjectFrustumCulled = true
  scene.add(batch)

  const geometryIds = models.geometries.map(g => batch.addGeometry(g))
  const slotGeometry = new Int16Array(slots).fill(-1)
  const slotPaint: (THREE.Color | undefined)[] = []
  const slotShown = new Uint8Array(slots)
  for (let s = 0; s < slots; s++) {
    batch.addInstance(geometryIds[0])
    batch.setVisibleAt(s, false)
  }

  const pose = new THREE.Object3D()
  pose.rotation.order = 'YXZ'
  const transforms = new Float64Array(slots * 6).fill(NaN)
  const FAR = 75 ** 2
  const riders = riderPool(scene, camera, sampleGround)
  const variants = new WeakMap<
    object,
    {full: Variant; bare?: Variant; subtype?: TwoWheelSubtype; violation?: TrafficViolation; violationMask?: number; noHelmet?: boolean; u: number; v: number}
  >()
  const riddenSlots = new Map<object, {slot: number; variant: Variant}>()
  const ridden = new Set<object>()

  const show = (slot: number, variant: Variant, x: number, y: number, z: number, yaw: number, scale: number, down = false) => {
    if (slot < 0 || slot >= slots) return
    const lod = models.far[variant.geometry]
    const geometry = lod !== undefined && (x - camera.position.x) ** 2 + (z - camera.position.z) ** 2 > FAR ? lod : variant.geometry
    if (slotGeometry[slot] !== geometry) {
      batch.setGeometryIdAt(slot, geometryIds[geometry])
      slotGeometry[slot] = geometry
    }
    if (slotPaint[slot] !== variant.paint) {
      batch.setColorAt(slot, variant.paint)
      slotPaint[slot] = variant.paint
    }
    if (!slotShown[slot]) {
      batch.setVisibleAt(slot, true)
      slotShown[slot] = 1
    }
    const off = slot * 6
    if (
      transforms[off] === x &&
      transforms[off + 1] === y &&
      transforms[off + 2] === z &&
      transforms[off + 3] === yaw &&
      transforms[off + 4] === scale &&
      transforms[off + 5] === Number(down)
    ) {
      return
    }
    transforms[off] = x
    transforms[off + 1] = y
    transforms[off + 2] = z
    transforms[off + 3] = yaw
    transforms[off + 4] = scale
    transforms[off + 5] = Number(down)
    pose.position.set(x, y + (down ? 0.16 : 0), z)
    pose.rotation.set(down ? -Math.PI / 2 : 0, yaw, 0)
    pose.scale.setScalar(Math.max(scale, 0.001))
    pose.updateMatrix()
    batch.setMatrixAt(slot, pose.matrix)
  }

  const hide = (from: number, to: number) => {
    for (let s = from; s < Math.min(to, slots); s++) {
      if (slotShown[s]) {
        batch.setVisibleAt(s, false)
        slotShown[s] = 0
      }
    }
  }

  const syncRiddenVehicle = (actor: object, x: number, y: number, z: number, yaw: number, scale: number) => {
    const item = riddenSlots.get(actor)
    if (!item) return
    show(item.slot, item.variant, x, y, z, yaw, scale, false)
  }

  return {
    batch,
    material,
    models,
    riders,
    geometryIds,
    slotGeometry,
    slotPaint,
    slotShown,
    transforms,
    pose,
    variants,
    riddenSlots,
    ridden,
    slots,
    show,
    hide,
    syncRiddenVehicle,
    dispose() {
      riders.clear()
      riddenSlots.clear()
      ridden.clear()
      batch.removeFromParent()
      batch.dispose()
      material.dispose()
      for (const g of models.geometries) g.dispose()
    },
  }
}

export function createDutyTraffic(opts: DutyTrafficOptions = {}): DutyTrafficHandle {
  const defaultCenter = opts.center ?? JIEFANG_DUTY_CENTER
  const defaultRadiusM = opts.radiusM ?? JIEFANG_DUTY_RADIUS_M
  const hasExplicitCars = opts.desiredCars !== undefined
  const hasExplicitScooters = opts.desiredScooters !== undefined
  const weights = opts.weights ?? JIEFANG_DUTY_WEIGHTS
  const basePolicy: TrafficViolationPolicy = {
    ...(opts.weights === undefined ? {nonmotorViolationRate: JIEFANG_NONMOTOR_VIOLATION_RATE} : {}),
    noHelmetGivenViolatorRate: JIEFANG_NO_HELMET_CONDITIONAL_RATE,
    allowSidewalkRiding: false,
    ...opts.policy,
  }
  let storyOverride: DutyStoryOverrideConfig | null =
    opts.storyOverride && opts.storyOverride.active !== false
      ? {active: true, ...opts.storyOverride}
      : null
  const maxViolatorRatio = opts.maxViolatorRatio ?? JIEFANG_MAX_VIOLATOR_RATIO
  const maxConcurrentViolators = opts.maxConcurrentViolators ?? JIEFANG_MAX_CONCURRENT_VIOLATORS
  const violatorCooldownSec = opts.violatorCooldownSec ?? JIEFANG_VIOLATOR_RESPAWN_COOLDOWN_S
  const random = opts.random ?? Math.random
  const hitListeners = new Set<PlayerHitCallback>()
  const hornListeners = new Set<PlayerHornCallback>()
  const pulledOverListeners = new Set<ViolatorPulledOverCallback>()
  const ticketReceivedListeners = new Set<TicketReceivedCallback>()
  const spawnListeners = new Set<ActorLifecycleCallback>()
  const despawnListeners = new Set<ActorLifecycleCallback>()
  if (opts.onPlayerHit) hitListeners.add(opts.onPlayerHit)
  if (opts.onPlayerHorn) hornListeners.add(opts.onPlayerHorn)
  if (opts.onViolatorPulledOver) pulledOverListeners.add(opts.onViolatorPulledOver)
  if (opts.onTicketReceived) ticketReceivedListeners.add(opts.onTicketReceived)
  if (opts.onActorSpawn) spawnListeners.add(opts.onActorSpawn)
  if (opts.onActorDespawn) despawnListeners.add(opts.onActorDespawn)
  const escapeListeners = new Set<DutyEscapeListener>()

  // IDOK-541 剧情模式握手 / 逃逸监听 / 罚款池
  let storyDeckOnly = false
  let storyMobile = false
  let storyApplied = false
  let storyVersionSeen = -1
  let storyPrevOverride: DutyStoryOverrideConfig | null = null
  let storyPrevScooterHeadwayM: number | undefined
  let activeHiddenLifecycle: DutyHiddenLifecycleConfig | undefined
  let escapeEpisodes = new WeakMap<Actor, {startedAt: number; done: boolean}>()
  let finePoolSeen = new WeakSet<Actor>()
  let finePoolNorthYuan = 0
  let finePoolSouthYuan = 0
  let finePoolViolators = 0
  let finePoolStartSimTime = 0

  let active = false
  let startSeq = 0
  let startPromise: Promise<void> | undefined
  let sim: Traffic | undefined
  let visuals: DutyVisuals | undefined
  let cachedGraph: Graph | undefined = opts.graph
  let cachedCarMeshes: Promise<CarMesh[]> | undefined
  let activeCenter = {...defaultCenter}
  let activeRadiusM = defaultRadiusM
  let accumulator = 0
  const signalDriver = citySignalClock.driver(SIGNAL_DRIVER_RANK.duty)
  let ownsTrafficSolids = false
  let warningHorns = 0
  let lastHitSpeedKmh: number | null = null
  let lastHitSeverity: HitSeverity | null = null
  let lastOfficerPos: Position | null = null
  let lifecycleSpawns = 0
  let lifecycleDespawns = 0
  let minSpawnBridgeEndDistM: number | null = null
  let minDespawnBridgeEndDistM: number | null = null
  let minSpawnPlayerDistM: number | null = null
  let minDespawnPlayerDistM: number | null = null
  let frustumViolations120m = 0

  interface ActorHandAnchorEntry {
    actor: Actor
    right: THREE.Object3D
    left: THREE.Object3D
    ticket?: THREE.Object3D
    ownedTicket?: boolean
  }
  const handAnchors = new Map<Actor, ActorHandAnchorEntry>()

  function disposeAnchorEntry(entry: ActorHandAnchorEntry): void {
    if (entry.ticket) {
      entry.ticket.removeFromParent()
      if (entry.ownedTicket && entry.ticket instanceof THREE.Mesh) {
        entry.ticket.geometry.dispose()
        ;(entry.ticket.material as THREE.Material).dispose()
      }
      entry.ticket = undefined
    }
    entry.right.clear()
    entry.left.clear()
  }

  function clearAllHandAnchors(): void {
    for (const entry of handAnchors.values()) disposeAnchorEntry(entry)
    handAnchors.clear()
  }

  function pruneHandAnchors(): void {
    if (!handAnchors.size) return
    const live = new Set(sim?.actors ?? [])
    for (const [actor, entry] of handAnchors) {
      if (!live.has(actor)) {
        getViolatorHeldReceipt(actor)?.detach()
        disposeAnchorEntry(entry)
        handAnchors.delete(actor)
      } else {
        entry.right.position.set(actor.x, actor.y + 1.05, actor.z)
        entry.left.position.set(actor.x, actor.y + 1.05, actor.z)
        const holdSide: ActorHandSide = actor.heldTicketHandSide === 'left' ? 'left' : 'right'
        const liveBone = visuals?.riders.getActorHandBone(actor, holdSide)
        if (liveBone && entry.ticket && entry.ticket.parent !== liveBone) {
          liveBone.add(entry.ticket)
        }
      }
    }
  }

  function getActorHandBoneInternal(
    actorIdOrActor: string | number | Actor,
    side: ActorHandSide = 'right',
  ): THREE.Object3D | null {
    const actor = sim?.findActor(actorIdOrActor)
    if (!actor) return null
    const liveBone = visuals?.riders.getActorHandBone(actor, side)
    let entry = handAnchors.get(actor)
    if (!entry) {
      const right = new THREE.Group()
      right.name = 'attach_hand_r'
      right.userData = {actorId: actor.id, side: 'right', boneName: 'hand_r'}
      right.position.set(actor.x, actor.y + 1.05, actor.z)
      const left = new THREE.Group()
      left.name = 'attach_hand_l'
      left.userData = {actorId: actor.id, side: 'left', boneName: 'hand_l'}
      left.position.set(actor.x, actor.y + 1.05, actor.z)
      entry = {actor, right, left}
      handAnchors.set(actor, entry)
    }
    if (liveBone) {
      const holdSide: ActorHandSide = actor.heldTicketHandSide === 'left' ? 'left' : 'right'
      if (side === holdSide && entry.ticket && entry.ticket.parent !== liveBone) {
        liveBone.add(entry.ticket)
      }
      return liveBone
    }
    return side === 'right' ? entry.right : entry.left
  }

  function receiveTicketInternal(
    actorIdOrActor: string | number | Actor,
    ticketOpts?: ReceiveTicketOptions & {ticketObject?: THREE.Object3D},
  ): ReceiveTicketResult & {handBone?: THREE.Object3D | null; ticketObject?: THREE.Object3D | null} {
    if (!sim) return {ok: false, reason: 'not_found'}
    const actor = sim.findActor(actorIdOrActor)
    if (!actor) return {ok: false, reason: 'not_found'}
    if (actor.ticketReceived || (!ticketOpts?.allowAlreadyCited && actor.cited)) {
      return {ok: false, reason: 'already_cited', actor, actorId: actor.id, ticketId: actor.heldTicketId}
    }
    const existingHeld = getViolatorHeldReceipt(actor)
    const handSide: ActorHandSide =
      ticketOpts?.handSide ??
      (existingHeld?.anchorBoneName === 'hand_l' ? 'left' : undefined) ??
      actor.heldTicketHandSide ??
      'right'
    const handBone = getActorHandBoneInternal(actor, handSide)
    const entry = handAnchors.get(actor)
    let ticketObj = ticketOpts?.ticketObject ?? existingHeld?.model.group
    let ownedTicket = false
    if (!ticketObj) {
      ticketObj = new THREE.Mesh(
        new THREE.PlaneGeometry(0.09, 0.14),
        new THREE.MeshBasicMaterial({color: 0xf6f2e6, side: THREE.DoubleSide}),
      )
      ticketObj.name = 'violator_held_ticket'
      ticketObj.position.set(handSide === 'left' ? -0.012 : 0.012, -0.018, -0.052)
      ticketObj.rotation.set(-0.36, handSide === 'left' ? -0.22 : 0.22, handSide === 'left' ? 0.14 : -0.14)
      ownedTicket = true
    }
    if (handBone && ticketObj.parent !== handBone) {
      handBone.add(ticketObj)
    }
    if (entry) {
      if (entry.ticket && entry.ticket !== ticketObj) {
        entry.ticket.removeFromParent()
        if (entry.ownedTicket && entry.ticket instanceof THREE.Mesh) {
          entry.ticket.geometry.dispose()
          ;(entry.ticket.material as THREE.Material).dispose()
        }
      }
      entry.ticket = ticketObj
      entry.ownedTicket = ownedTicket
    }
    const res = sim.receiveTicket(actor, {
      ...ticketOpts,
      handSide,
      handBone,
      ticketObject: ticketObj,
    })
    return {...res, handBone, ticketObject: ticketObj}
  }

  function computeBridgePullOverTarget(actor: Actor): {targetDodge: number; targetLocalZ: number} {
    const track = actor.track
    const baseX = track.start.x + track.dx * actor.dist - track.dz * track.offset
    const baseZ = track.start.z + track.dz * actor.dist + track.dx * track.offset
    const [, baseLz] = worldToJiefangBridgeLocal(baseX, baseZ)
    const xs = getJiefangCrossSection()
    const isSidewalkRider = actorHasViolation(actor, 'sidewalk_riding')
    const targetLocalZ = isSidewalkRider
      ? baseLz < 0
        ? Math.max(xs.northSidewalk.minZ + 1.25, -JIEFANG_SIDEWALK_PULLOVER_ABS_Z)
        : Math.min(xs.southSidewalk.maxZ - 1.25, JIEFANG_SIDEWALK_PULLOVER_ABS_Z)
      : baseLz < 0
        ? Math.max(xs.northNonmotor.minZ + 0.35, -JIEFANG_PULLOVER_OUTER_ABS_Z)
        : Math.min(xs.southNonmotor.maxZ - 0.35, JIEFANG_PULLOVER_OUTER_ABS_Z)
    const c = Math.cos(JIEFANG_BRIDGE_ROTATION_Y)
    const s = Math.sin(JIEFANG_BRIDGE_ROTATION_Y)
    const latLocalZ = -track.dz * s + track.dx * c
    const rawTotalOffset = Math.abs(latLocalZ) > 0.2 ? (targetLocalZ - baseLz) / latLocalZ : 1.135
    const wrongWayOff = actor.wrongWay ? -0.55 : 0
    const maxBound = isSidewalkRider ? 4.2 : 1.85
    const targetDodge = Math.max(-maxBound, Math.min(maxBound, rawTotalOffset - wrongWayOff))
    return {targetDodge, targetLocalZ}
  }

  const frustum = new THREE.Frustum()
  const projMatrix = new THREE.Matrix4()
  const probePoint = new THREE.Vector3()

  function dispatchPlayerHit(severity: HitSeverity, dir: {x: number; z: number}, event: PlayerHitEvent): void {
    lastHitSpeedKmh = event.speedKmh
    lastHitSeverity = severity
    for (const listener of hitListeners) {
      try {
        listener(severity, dir, event)
      } catch (err) {
        console.warn('dutyTraffic onPlayerHit listener error', err)
      }
    }
  }

  function dispatchPlayerHorn(event: PlayerHornEvent): void {
    warningHorns++
    playDutyWarningHornSound(event.actor)
    for (const listener of hornListeners) {
      try {
        listener(event)
      } catch (err) {
        console.warn('dutyTraffic onPlayerHorn listener error', err)
      }
    }
  }

  function dispatchViolatorPulledOver(event: ViolatorPulledOverEvent): void {
    for (const listener of pulledOverListeners) {
      try {
        listener(event)
      } catch (err) {
        console.warn('dutyTraffic onViolatorPulledOver listener error', err)
      }
    }
  }

  function dispatchTicketReceived(event: TicketReceivedEvent): void {
    for (const listener of ticketReceivedListeners) {
      try {
        listener(event)
      } catch (err) {
        console.warn('dutyTraffic onTicketReceived listener error', err)
      }
    }
  }

  function recordLifecycleEvent(event: ActorLifecycleEvent): void {
    if (event.type === 'spawn') {
      lifecycleSpawns++
      if (minSpawnBridgeEndDistM === null || event.bridgeEndDistM < minSpawnBridgeEndDistM) {
        minSpawnBridgeEndDistM = event.bridgeEndDistM
      }
      if (event.playerDistM !== null && (minSpawnPlayerDistM === null || event.playerDistM < minSpawnPlayerDistM)) {
        minSpawnPlayerDistM = event.playerDistM
      }
    } else {
      lifecycleDespawns++
      if (minDespawnBridgeEndDistM === null || event.bridgeEndDistM < minDespawnBridgeEndDistM) {
        minDespawnBridgeEndDistM = event.bridgeEndDistM
      }
      if (event.playerDistM !== null && (minDespawnPlayerDistM === null || event.playerDistM < minDespawnPlayerDistM)) {
        minDespawnPlayerDistM = event.playerDistM
      }
    }
    if (event.inFrustum && event.cameraDistM !== null && event.cameraDistM <= JIEFANG_HIDDEN_FRUSTUM_MAX_DIST_M) {
      frustumViolations120m++
    }
    const listeners = event.type === 'spawn' ? spawnListeners : despawnListeners
    for (const listener of listeners) {
      try {
        listener(event)
      } catch (err) {
        console.warn(`dutyTraffic onActor${event.type === 'spawn' ? 'Spawn' : 'Despawn'} listener error`, err)
      }
    }
  }

  function registerSolidsIfStandalone(): void {
    if (!sim) return
    const dutySim = sim
    const near = (x: number, z: number, visit: (solid: Solid) => void) => {
      dutySim.nearSolids(x, z, visit)
      staticSolids(x, z, visit)
    }
    useTrafficSolids(near)
    ownsTrafficSolids = true
  }

  function start(override?: {center?: {x: number; z: number}; radiusM?: number}): Promise<void> {
    if (startPromise) return startPromise
    const token = ++startSeq
    active = true
    activeCenter = {...(override?.center ?? defaultCenter)}
    activeRadiusM = override?.radiusM ?? defaultRadiusM
    accumulator = 0
    lifecycleSpawns = 0
    lifecycleDespawns = 0
    minSpawnBridgeEndDistM = null
    minDespawnBridgeEndDistM = null
    minSpawnPlayerDistM = null
    minDespawnPlayerDistM = null
    frustumViolations120m = 0

    const deckOnly =
      opts.bridgeDeckOnly ??
      isOnJiefangBridgeDeck({x: activeCenter.x, z: activeCenter.z}, {marginM: 40})
    const desiredCars = hasExplicitCars ? opts.desiredCars! : deckOnly ? 18 : 10
    const desiredScooters = hasExplicitScooters ? opts.desiredScooters! : deckOnly ? 22 : 12

    const pending = (async () => {
      let baseGraph = cachedGraph
      if (!baseGraph) {
        const loader = opts.loadGraph ?? fetchDefaultJiefangGraph
        baseGraph = await loader()
        if (!active || token !== startSeq) return
        cachedGraph = baseGraph
      }

      const subGraph = sliceDutySubgraph(baseGraph, activeCenter, activeRadiusM, deckOnly)
      const fallbackGraph = deckOnly ? subGraph : subGraph.lanes.length > 0 ? subGraph : baseGraph
      const mobile = typeof window !== 'undefined' && typeof matchMedia === 'function' ? touchUi() : false
      const limit = opts.actorLimit ?? (deckOnly ? (mobile ? 42 : 56) : mobile ? 28 : 40)

      const deckSafeSampleGround: Traffic['sampleGround'] | undefined = opts.sampleGround
        ? deckOnly
          ? (x, z, reference, car) => {
              const sampled = opts.sampleGround!(x, z, reference, car)
              if (sampled === undefined) return reference
              if (isOnJiefangBridgeDeck({x, y: sampled, z})) return sampled
              if (isOnJiefangApproachCorridor({x, y: sampled, z}) && Math.abs(sampled - reference) <= 2.5) {
                return sampled
              }
              return reference
            }
          : opts.sampleGround
        : undefined

      citySignals.add(fallbackGraph.signals)
      const nextSim = new Traffic(fallbackGraph, random, limit, {
        classes: npcDefaults.classes,
        carMin: 0,
        carMax: 0,
        personMin: 0,
        personMax: 0,
      })
      nextSim.sampleGround = deckSafeSampleGround
      nextSim.onPlayerHit = dispatchPlayerHit
      nextSim.onPlayerHorn = dispatchPlayerHorn
      nextSim.onViolatorPulledOver = dispatchViolatorPulledOver
      nextSim.onTicketReceived = dispatchTicketReceived
      nextSim.onActorSpawn = recordLifecycleEvent
      nextSim.onActorDespawn = recordLifecycleEvent

      let minSpawnAbsX = JIEFANG_APPROACH_PREROLL_MIN_ABS_X
      const canSpawnOnApproachTrack = (track: {start: Position; end: Position}, wrongWay: boolean): boolean => {
        const [startLx] = worldToJiefangBridgeLocal(track.start.x, track.start.z)
        const [endLx] = worldToJiefangBridgeLocal(track.end.x, track.end.z)
        const travelDx = wrongWay ? startLx - endLx : endLx - startLx
        if (travelDx > 0.1) {
          // Traveling West -> East toward bridge: spawn strictly on West outer approach
          return Math.max(startLx, endLx) <= -minSpawnAbsX
        }
        if (travelDx < -0.1) {
          // Traveling East -> West toward bridge: spawn strictly on East outer approach
          return Math.min(startLx, endLx) >= minSpawnAbsX
        }
        return false
      }

      // 保留对象引用：剧情模式落地时原地调整同向两轮车隐藏入场车头间距（sim 浅拷贝 dutyConfig 时引用不变）。
      const hiddenLifecycle: DutyHiddenLifecycleConfig | undefined = deckOnly
        ? {
            minBridgeEndDistM: JIEFANG_APPROACH_MIN_DIST_M,
            minPlayerDistM: JIEFANG_HIDDEN_PLAYER_MIN_DIST_M,
            frustumMinDistM: JIEFANG_HIDDEN_FRUSTUM_MAX_DIST_M,
            bridgeEndDistance: jiefangBridgeEndDistanceM,
            canSpawnOnTrack: canSpawnOnApproachTrack,
            minCarHeadwayM: 34,
            minScooterHeadwayM: 36,
          }
        : undefined
      activeHiddenLifecycle = hiddenLifecycle
      storyDeckOnly = deckOnly
      storyMobile = mobile

      nextSim.setDutyConfig({
        active: true,
        dutyOnly: true,
        center: activeCenter,
        radius: activeRadiusM,
        zones: [
          {
            id: 'jiefang',
            center: activeCenter,
            radius: activeRadiusM,
            weights,
            desiredCars,
            desiredScooters,
          },
        ],
        weights,
        desiredCars,
        desiredScooters,
        twoWheelShare: 0.5,
        maxViolatorRatio,
        maxConcurrentViolators,
        violatorCooldownSec,
        policy: basePolicy,
        storyOverride,
        classifyOfficerZone: deckOnly ? classifyJiefangCrossSectionZone : undefined,
        constrainActorPosition: deckOnly ? constrainJiefangActorPosition : undefined,
        computePullOverTarget: deckOnly ? computeBridgePullOverTarget : undefined,
        hiddenLifecycle,
      })

      if (opts.scene && opts.camera) {
        if (!cachedCarMeshes) {
          cachedCarMeshes =
            typeof fetch === 'function'
              ? loadCarMeshes().catch(() => [])
              : Promise.resolve([])
        }
        const carMeshes = await cachedCarMeshes
        if (!active || token !== startSeq) return
        visuals = mountDutyVisuals(opts.scene, opts.camera, deckSafeSampleGround, carMeshes, limit + 4)
      }

      sim = nextSim
      activeDutyRef = {
        sim: nextSim,
        center: activeCenter,
        radius: activeRadiusM,
        getActorHandBone: getActorHandBoneInternal,
        receiveTicket: receiveTicketInternal,
        setStoryOverride: setStoryOverrideInternal,
        getStoryOverride: () => storyOverride,
        getViolatorSnapshots: (qOpts?: {includeCited?: boolean}) => sim?.getViolatorSnapshots(qOpts) ?? [],
      }
      registerSolidsIfStandalone()
      resetFinePool()
      // IDOK-541：controller 已请求剧情模式时，在预热前落地剧情密度，开局即达到剧情车流。
      storyVersionSeen = -1
      syncJiefangStoryMode()

      // Pre-roll traffic smoothly from the far outer approaches (|lx| >= 262m, >= 121.5m from every bridge point)
      // with steady headway spacing so the entire 570m corridor reaches uniform bidirectional flow before gameplay.
      const warmPos: Position = {x: activeCenter.x, y: 151.7, z: activeCenter.z}
      const preRollTicks = deckOnly && (desiredCars > 0 || desiredScooters > 0) ? 850 : 6
      const preRollDt = deckOnly ? 0.1 : 0.05
      for (let i = 0; i < preRollTicks; i++) {
        nextSim.step(preRollDt, warmPos)
      }
      minSpawnAbsX = JIEFANG_APPROACH_SPAWN_MIN_ABS_X
      // 罚款池计时从预热结束算起；预热留在场上的车会在首帧计入（对应流量模型的初始 n）。
      finePoolStartSimTime = nextSim.time
    })().catch(err => {
      if (token === startSeq) {
        stop()
      }
      throw err
    })

    startPromise = pending
    return pending
  }

  function stop(): void {
    startSeq++
    active = false
    startPromise = undefined
    accumulator = 0
    warningHorns = 0
    lastHitSpeedKmh = null
    lastHitSeverity = null
    if (storyApplied) {
      revertJiefangStoryMode()
      acknowledgeJiefangStoryMode(false)
    }
    storyVersionSeen = -1
    activeHiddenLifecycle = undefined
    escapeEpisodes = new WeakMap()
    if (activeDutyRef && activeDutyRef.sim === sim) {
      activeDutyRef = undefined
    }
    if (sim) {
      sim.setDutyOfficer(null)
      sim.setDutyConfig({active: false})
      sim.onPlayerHit = undefined
      sim.onPlayerHorn = undefined
      sim.onViolatorPulledOver = undefined
      sim.onTicketReceived = undefined
      sim.onActorSpawn = undefined
      sim.onActorDespawn = undefined
      sim.actors.length = 0
      sim = undefined
    }
    clearAllHandAnchors()
    lastOfficerPos = null
    if (visuals) {
      visuals.dispose()
      visuals = undefined
    }
    if (ownsTrafficSolids) {
      useTrafficSolids(undefined)
      ownsTrafficSolids = false
    }
  }

  function syncVisualFrame(dt: number, lag: number, stepped: boolean): void {
    if (!visuals || !sim || !opts.camera) return
    if (!stepped) {
      visuals.riders.animate(dt, lag, visuals.syncRiddenVehicle, lastOfficerPos)
      return
    }
    visuals.ridden = visuals.riders.select(sim.actors)
    visuals.riddenSlots.clear()
    sim.actors.forEach((actor, index) => {
      if (index >= visuals!.slots) return
      let entry = visuals!.variants.get(actor)
      const spec = actor.kind === 'scooter' ? resolveTwoWheelSpec(actor) : undefined
      if (
        !entry ||
        (spec &&
          (entry.subtype !== spec.subtype ||
            entry.violation !== spec.violation ||
            entry.violationMask !== spec.violationMask ||
            entry.noHelmet !== spec.noHelmet))
      ) {
        const u = entry?.u ?? random()
        const v = entry?.v ?? random()
        if (spec) {
          const pair = visuals!.models.twoWheelVariant(spec.subtype, spec.violation, u, v, spec.noHelmet, spec.violations)
          entry = {
            full: pair.full,
            bare: pair.bare,
            subtype: spec.subtype,
            violation: spec.violation,
            violationMask: spec.violationMask,
            noHelmet: spec.noHelmet,
            u,
            v,
          }
        } else {
          entry = {full: visuals!.models.variant(actor.kind, u, v), u, v}
        }
        visuals!.variants.set(actor, entry)
        const geometry = visuals!.models.geometries[entry.full.geometry]
        if (!geometry.boundingBox) geometry.computeBoundingBox()
        const {min, max} = geometry.boundingBox!
        actor.halfWidth = Math.max(-min.x, max.x)
        actor.halfLength = Math.max(-min.z, max.z)
        actor.height = max.y
      }
      const isRidden = visuals!.ridden.has(actor) && Boolean(entry.bare)
      const activeVariant = isRidden ? entry.bare! : entry.full
      if (isRidden) visuals!.riddenSlots.set(actor, {slot: index, variant: activeVariant})
      visuals!.show(index, activeVariant, actor.x, actor.y, actor.z, actor.yaw, actor.scale, false)
    })
    visuals.riders.animate(dt, lag, visuals.syncRiddenVehicle, lastOfficerPos)
    visuals.hide(sim.actors.length, visuals.slots)
  }

  function step(dt: number, playerPos?: Position | null, stepOpts?: DutyTrafficStepOptions): void {
    if (!active || !sim) return
    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(0.2, dt) : 0
    if (safeDt <= 0) return

    lastOfficerPos = playerPos ? {x: playerPos.x, y: playerPos.y, z: playerPos.z} : null
    if (playerPos) {
      sim.setDutyOfficer({
        pos: playerPos,
        active: stepOpts?.officerActive ?? true,
        yaw: stepOpts?.officerYaw,
        running: stepOpts?.officerRunning,
        zone: stepOpts?.officerZone,
      })
    } else {
      sim.setDutyOfficer(null)
    }

    const focus: Position =
      stepOpts?.cameraPos ??
      (opts.camera
        ? {x: opts.camera.position.x, y: opts.camera.position.y, z: opts.camera.position.z}
        : playerPos ?? {x: activeCenter.x, y: 151.7, z: activeCenter.z})

    accumulator += safeDt
    // Same lights as the street sim: follow the one city clock (pre-roll above ran on the sim's own time).
    signalDriver.advance(safeDt)
    sim.signalShift = citySignalClock.now - accumulator - sim.time
    if (accumulator < 0.05) {
      syncVisualFrame(safeDt, accumulator, false)
      return
    }

    let visibleCheck = stepOpts?.visible
    if (!visibleCheck && opts.camera) {
      opts.camera.updateMatrixWorld()
      frustum.setFromProjectionMatrix(projMatrix.multiplyMatrices(opts.camera.projectionMatrix, opts.camera.matrixWorldInverse))
      visibleCheck = (actor: {x: number; y: number; z: number}) => frustum.containsPoint(probePoint.set(actor.x, actor.y + 0.7, actor.z))
    }

    syncJiefangStoryMode()
    while (accumulator >= 0.05) {
      // 记录本子步前逆行逃逸两轮车的 dodge，修正 sim.ts 在车头坐标系下反向朝执勤者横移的符号（平滑单步 0.11m，零瞬移锯齿）
      let wrongWayFleeBefore: Map<Actor, number> | null = null
      if (lastOfficerPos) {
        for (const a of sim.actors) {
          if (a.kind === 'scooter' && a.wrongWay && a.track && (a.dutyState === 'fleeing' || a.dutyState === 'evading')) {
            if (!wrongWayFleeBefore) wrongWayFleeBefore = new Map()
            wrongWayFleeBefore.set(a, a.dodge)
          }
        }
      }
      sim.step(0.05, focus, stepOpts?.vehiclePos, visibleCheck)
      if (wrongWayFleeBefore && lastOfficerPos) {
        for (const [a, prev] of wrongWayFleeBefore) {
          if (!a.wrongWay || !a.track || (a.dutyState !== 'fleeing' && a.dutyState !== 'evading')) continue
          const delta = a.dodge - prev
          if (Math.abs(delta) <= 1e-5) continue
          const nx = -a.track.dz
          const nz = a.track.dx
          const officerSide = (lastOfficerPos.x - a.x) * nx + (lastOfficerPos.z - a.z) * nz
          if (delta * officerSide > 0) {
            const limit = a.track.gradeSeparated === 'jiefang' ? 0.6 : 0.85
            const corrected = Math.max(-limit, Math.min(limit, prev - delta))
            const shift = corrected - a.dodge
            a.dodge = corrected
            a.x += nx * shift
            a.z += nz * shift
            if (storyDeckOnly) constrainJiefangActorPosition(a)
          }
        }
      }
      accumulator -= 0.05
    }
    pruneHandAnchors()
    trackFinePool()
    monitorEscapes()
    syncVisualFrame(safeDt, accumulator, true)
  }

  function setStoryOverrideInternal(override: DutyStoryOverrideConfig | null): void {
    storyOverride = override && override.active !== false ? {active: true, ...override} : null
    if (sim) {
      sim.setStoryOverride(storyOverride)
    }
  }

  // ─── IDOK-541 剧情模式握手 ───

  function isStoryModeLiveHere(): boolean {
    return storyApplied && isJiefangStoryModeActive()
  }

  function applyJiefangStoryMode(): void {
    storyPrevOverride = storyOverride
    setStoryOverrideInternal({...resolveJiefangStoryOverride(storyMobile ? 'mobile' : 'desktop')})
    if (activeHiddenLifecycle) {
      storyPrevScooterHeadwayM = activeHiddenLifecycle.minScooterHeadwayM
      activeHiddenLifecycle.minScooterHeadwayM = JIEFANG_STORY_SCOOTER_HEADWAY_M
    }
    storyApplied = true
    resetFinePool()
  }

  function revertJiefangStoryMode(): void {
    if (!storyApplied) return
    storyApplied = false
    if (activeHiddenLifecycle) {
      activeHiddenLifecycle.minScooterHeadwayM = storyPrevScooterHeadwayM ?? 36
    }
    storyPrevScooterHeadwayM = undefined
    const prev = storyPrevOverride
    storyPrevOverride = null
    setStoryOverrideInternal(prev)
  }

  /** 轮询 controller 的剧情请求版本号；只撤销自己落地的覆盖，不干扰外部 `setStoryOverride()`。 */
  function syncJiefangStoryMode(): void {
    if (!sim) return
    const version = getJiefangStoryModeVersion()
    if (version === storyVersionSeen) return
    storyVersionSeen = version
    const want = isJiefangStoryModeRequested() && storyDeckOnly && activeDutyRef?.sim === sim
    if (want) {
      if (!storyApplied) applyJiefangStoryMode()
      acknowledgeJiefangStoryMode(true)
    } else if (storyApplied) {
      revertJiefangStoryMode()
      acknowledgeJiefangStoryMode(false)
    }
  }

  // ─── IDOK-541 双向罚款池 ───

  function resetFinePool(): void {
    finePoolSeen = new WeakSet()
    finePoolNorthYuan = 0
    finePoolSouthYuan = 0
    finePoolViolators = 0
    finePoolStartSimTime = sim?.time ?? 0
  }

  function actorFineYuan(a: Actor): number {
    return computeFineYuanStack(getActorViolations(a), DEFAULT_POOL_FINE_TABLE)
  }

  function trackFinePool(): void {
    if (!sim) return
    for (const a of sim.actors) {
      if (a.kind !== 'scooter' || a.leaving || a.pendingRecycle || finePoolSeen.has(a)) continue
      if (!actorHasAnyViolation(a)) continue
      finePoolSeen.add(a)
      const yuan = actorFineYuan(a)
      if (yuan <= 0) continue
      finePoolViolators++
      const [, lz] = worldToJiefangBridgeLocal(a.x, a.z)
      if (lz >= 0) finePoolSouthYuan += yuan
      else finePoolNorthYuan += yuan
    }
  }

  function buildFinePoolStats(actors: readonly Actor[]): DutyFinePoolStats {
    let liveNorth = 0
    let liveSouth = 0
    for (const a of actors) {
      if (a.kind !== 'scooter' || a.leaving || a.pendingRecycle || a.cited || a.ticketReceived) continue
      if (!actorHasAnyViolation(a)) continue
      const yuan = actorFineYuan(a)
      if (yuan <= 0) continue
      const [, lz] = worldToJiefangBridgeLocal(a.x, a.z)
      if (lz >= 0) liveSouth += yuan
      else liveNorth += yuan
    }
    const total = finePoolNorthYuan + finePoolSouthYuan
    return {
      northYuan: finePoolNorthYuan,
      southYuan: finePoolSouthYuan,
      totalYuan: total,
      liveNorthYuan: liveNorth,
      liveSouthYuan: liveSouth,
      liveTotalYuan: liveNorth + liveSouth,
      violatorsSeen: finePoolViolators,
      meanFinePerViolatorYuan: finePoolViolators > 0 ? Number((total / finePoolViolators).toFixed(2)) : 0,
      elapsedSec: sim ? Number(Math.max(0, sim.time - finePoolStartSimTime).toFixed(2)) : 0,
    }
  }

  // ─── IDOK-541 逃逸事件 ───

  function dispatchEscape(event: DutyEscapeEvent): void {
    if (!sim || !sim.actors.includes(event.actor)) return
    for (const listener of [...escapeListeners]) {
      try {
        listener(event)
      } catch {
        // 订阅方异常不影响车流
      }
    }
  }

  // 统一订阅全局逃逸总线：无论由 Q/E/F、commandHalt 还是被动发现触发，dutyTraffic.onViolatorEscape() 均可收到且不重复。
  const unsubEscapeBus = subscribeDutyEscape(dispatchEscape)

  function emitEscape(actor: Actor, cause: DutyEscapeCause, aspect: InterceptAspect): ReturnType<typeof tryEmitDutyEscape> {
    return tryEmitDutyEscape({actor, cause, aspect})
  }

  function isEscapeCandidate(a: Actor): boolean {
    return a.kind === 'scooter' && !a.leaving && !a.pendingRecycle && !a.cited && !a.ticketReceived && a.scale >= 0.5 && actorHasAnyViolation(a)
  }

  /**
   * 监听 normal→fleeing/evading 迁移：
   *  - 有 `markEscapeCause` 标记（侧后方 E/Q、吹哨失败等）：沿用标记的 cause / aspect，必发；
   *  - 无标记（sim 4–15m 发现带被动跑路）：执勤者不在车头正前方扇区才发；
   *  - 全局节流时在 1.5s 窗口内逐帧补发；单车冷却中则本段跑路不再补发。
   */
  function monitorEscapes(): void {
    if (!sim) return
    const live = isStoryModeLiveHere()
    const now = getEscapeClockSec()
    for (const a of sim.actors) {
      if (a.kind !== 'scooter') continue
      const state = a.dutyState
      const escaping = state === 'fleeing' || state === 'evading'
      if (!escaping) {
        escapeEpisodes.delete(a)
        continue
      }
      let episode = escapeEpisodes.get(a)
      if (!episode) {
        episode = {startedAt: now, done: !live}
        escapeEpisodes.set(a, episode)
      }
      if (episode.done || !live) continue
      if (!isEscapeCandidate(a)) {
        episode.done = true
        continue
      }
      if (now - episode.startedAt > ESCAPE_PASSIVE_RETRY_WINDOW_SEC) {
        episode.done = true
        continue
      }
      const mark = peekEscapeMark(a)
      let cause: DutyEscapeCause
      let aspect: InterceptAspect
      if (mark) {
        cause = mark.cause
        aspect = mark.aspect
      } else {
        if (!lastOfficerPos) {
          episode.done = true
          continue
        }
        aspect = classifyInterceptAspect(a, lastOfficerPos)
        if (aspect === 'front') {
          episode.done = true
          continue
        }
        cause = 'spotted'
      }
      const res = emitEscape(a, cause, aspect)
      if (res.event || res.verdict === 'actor_cooldown') episode.done = true
    }
  }

  /**
   * 包装 `sim.commandHalt`：
   *  1) 剧情模式下且未显式指定 `haltProbability` 时，按车头正前方扇区判定：
   *     - 已停稳/靠边中违规车不惊跑；
   *     - 侧面 0.80 / 车尾 0.85 概率（或已在逃逸中）直接加速逃逸 + 触发逃逸气泡；
   *     - 正面拦车按 E 100% / Q 0.85 靠边停车（未停则减速）；
   *  2) 修正逆行（wrongWay）跑路车横向避让符号：sim 在车头坐标系计算 side，逆行车会反向贴近执勤者；
   *     这里以车道坐标系重算（仍限幅 ±0.6 / ±0.85，位置继续经 `constrainJiefangActorPosition` 夹紧）。
   *  3) 剧情模式下为跑路车标记 cause / aspect 并发出逃逸事件。
   */
  function commandHaltWrapped(
    origin: Position,
    haltOpts?: Parameters<DutyTrafficHandle['commandHalt']>[1],
  ): WhistleFlagHaltResult {
    if (!sim) return {affected: 0, halted: [], fled: []}
    const storyLive = isStoryModeLiveHere()
    const cause: DutyEscapeCause = haltOpts?.kind === 'flag' ? 'flag' : 'whistle'
    if (storyLive && haltOpts?.haltProbability === undefined) {
      const rangeM = Math.max(4, haltOpts?.rangeM ?? (cause === 'flag' ? 10 : 12))
      const stopDurationSec = Math.max(2, haltOpts?.stopDurationSec ?? (cause === 'flag' ? 45 : 14))
      const rng = haltOpts?.random ?? random
      const halted: Actor[] = []
      const fled: Actor[] = []
      for (const a of sim.actors) {
        if (!isEscapeCandidate(a)) continue
        if (Math.abs(a.y - origin.y) > 3) continue
        if (Math.hypot(a.x - origin.x, a.z - origin.z) > rangeM) continue
        if (isActorStoppedOrTicketing(a)) continue
        const aspect = classifyInterceptAspect(a, origin)
        const alreadyFleeing = a.dutyState === 'fleeing' || a.dutyState === 'evading'
        if (aspect !== 'front' && (alreadyFleeing || rng() < escapeFleeProbability(aspect))) {
          applyEscapeImpulse(a, {simTime: sim.time, officer: origin})
          if (storyDeckOnly) constrainJiefangActorPosition(a)
          markEscapeCause(a, cause, aspect)
          emitEscape(a, cause, aspect)
          fled.push(a)
        } else if (cause === 'flag' || (aspect === 'front' && rng() < JIEFANG_FRONT_WHISTLE_STOP_PROB)) {
          if (haltOpts?.pullOver === false) {
            a.dutyState = 'halted'
            a.haltedByDuty = true
            a.fleeUntil = undefined
            a.brakingForOfficer = false
            a.lookAtOfficer = true
            sim.stopActor(a, stopDurationSec)
          } else {
            if (a.dutyState === 'fleeing' || a.dutyState === 'evading') a.dutyState = 'normal'
            a.fleeUntil = undefined
            sim.pullOverViolator(a, stopDurationSec)
          }
          halted.push(a)
        } else {
          a.whistleSlowUntil = sim.time + 3.5
          a.brakingForOfficer = true
        }
      }
      return {affected: halted.length + fled.length, halted, fled}
    }
    const prevDodge = new Map<Actor, number>()
    for (const a of sim.actors) {
      if (a.kind === 'scooter' && a.wrongWay) prevDodge.set(a, a.dodge)
    }
    const res = sim.commandHalt(origin, haltOpts)
    for (const a of res.fled) {
      const before = prevDodge.get(a)
      if (before === undefined || !a.wrongWay || !a.track || a.dodge === before) continue
      const limit = a.track.gradeSeparated === 'jiefang' ? 0.6 : 0.85
      a.dodge = computeEscapeDodge(a, origin, before, limit)
      if (storyDeckOnly) constrainJiefangActorPosition(a)
    }
    if (storyLive && res.fled.length > 0) {
      for (const a of res.fled) {
        const aspect = classifyInterceptAspect(a, origin)
        markEscapeCause(a, cause, aspect)
        emitEscape(a, cause, aspect)
      }
    }
    return res
  }

  return {
    start,
    stop,
    dispose() {
      unsubEscapeBus()
      stop()
      hitListeners.clear()
      hornListeners.clear()
      pulledOverListeners.clear()
      ticketReceivedListeners.clear()
      spawnListeners.clear()
      despawnListeners.clear()
      escapeListeners.clear()
    },
    isActive: () => active,
    step,
    getTraffic: () => sim,
    getActors: () => sim?.actors ?? [],
    setStoryOverride: setStoryOverrideInternal,
    clearStoryOverride() {
      setStoryOverrideInternal(null)
    },
    getStoryOverride: () => storyOverride,
    getActorViolations(actorIdOrActor: string | number | Actor) {
      return sim?.getActorViolations(actorIdOrActor) ?? []
    },
    getViolatorSnapshots(qOpts?: {includeCited?: boolean}) {
      return sim?.getViolatorSnapshots(qOpts) ?? []
    },
    onPlayerHit(listener: PlayerHitCallback) {
      hitListeners.add(listener)
      return () => {
        hitListeners.delete(listener)
      }
    },
    onPlayerHorn(listener: PlayerHornCallback) {
      hornListeners.add(listener)
      return () => {
        hornListeners.delete(listener)
      }
    },
    onViolatorPulledOver: ((
      listenerOrActor: ViolatorPulledOverCallback | Actor,
      durationSec?: number,
    ): (() => void) | boolean => {
      if (typeof listenerOrActor === 'function') {
        pulledOverListeners.add(listenerOrActor)
        return () => {
          pulledOverListeners.delete(listenerOrActor)
        }
      }
      return sim?.pullOverViolator(listenerOrActor, durationSec) ?? false
    }) as DutyTrafficHandle['onViolatorPulledOver'],
    onTicketReceived: ((
      listenerOrActor: TicketReceivedCallback | Actor,
      receipt?: {
        ticketId?: string
        fineYuan?: number
        plateNo?: string
        violation?: string
        ticketObject?: THREE.Object3D
        handSide?: ActorHandSide
      },
    ): (() => void) | void => {
      if (typeof listenerOrActor === 'function') {
        ticketReceivedListeners.add(listenerOrActor)
        return () => {
          ticketReceivedListeners.delete(listenerOrActor)
        }
      }
      receiveTicketInternal(listenerOrActor, {
        ticketId: receipt?.ticketId,
        ticketObject: receipt?.ticketObject,
        handSide: receipt?.handSide,
        allowAlreadyCited: true,
      })
    }) as DutyTrafficHandle['onTicketReceived'],
    onActorSpawn(listener: ActorLifecycleCallback) {
      spawnListeners.add(listener)
      return () => {
        spawnListeners.delete(listener)
      }
    },
    onActorDespawn(listener: ActorLifecycleCallback) {
      despawnListeners.add(listener)
      return () => {
        despawnListeners.delete(listener)
      }
    },
    getActorHandBone: getActorHandBoneInternal,
    receiveTicket: receiveTicketInternal,
    releaseViolator(actorIdOrActor: string | number | Actor) {
      return sim?.releaseViolator(actorIdOrActor) ?? false
    },
    commandRelease(origin: Position, rangeM?: number) {
      return sim?.commandRelease(origin, rangeM) ?? []
    },
    notifyViolatorCited(actor?: Actor) {
      sim?.notifyViolatorCited(actor)
    },
    commandHalt(origin, haltOpts) {
      return commandHaltWrapped(origin, haltOpts)
    },
    onViolatorEscape(listener: DutyEscapeListener) {
      escapeListeners.add(listener)
      return () => {
        escapeListeners.delete(listener)
      }
    },
    getLifecycleStats(): DutyLifecycleStats {
      return {
        spawns: lifecycleSpawns,
        despawns: lifecycleDespawns,
        deferredSpawns: sim?.deferredSpawnCount ?? 0,
        deferredDespawns: sim?.deferredDespawnCount ?? 0,
        minSpawnBridgeEndDistM: minSpawnBridgeEndDistM !== null ? Number(minSpawnBridgeEndDistM.toFixed(2)) : null,
        minDespawnBridgeEndDistM: minDespawnBridgeEndDistM !== null ? Number(minDespawnBridgeEndDistM.toFixed(2)) : null,
        minSpawnPlayerDistM: minSpawnPlayerDistM !== null ? Number(minSpawnPlayerDistM.toFixed(2)) : null,
        minDespawnPlayerDistM: minDespawnPlayerDistM !== null ? Number(minDespawnPlayerDistM.toFixed(2)) : null,
        frustumViolations120m,
      }
    },
    getStats(): DutyTrafficStats {
      sim?.syncCitedViolatorCooldown()
      const actors = sim?.actors ?? []
      let cars = 0
      let scooters = 0
      let violators = 0
      let totalViolatorScooters = 0
      let noHelmetViolators = 0
      let multiViolationCount = 0
      let sidewalkRidingViolators = 0
      let fleeing = 0
      let halted = 0
      let braking = 0
      let sidewalkTwoWheelers = 0
      let nonmotorLaneCars = 0
      for (const a of actors) {
        if (a.leaving || a.pendingRecycle) continue
        if (a.kind === 'car') {
          cars++
          if (isOnJiefangBridgeDeck(a) && classifyJiefangCrossSectionZone(a) !== 'motor') {
            nonmotorLaneCars++
          }
        } else if (a.kind === 'scooter') {
          scooters++
          if (isOnJiefangBridgeDeck(a) && classifyJiefangCrossSectionZone(a) === 'sidewalk') {
            sidewalkTwoWheelers++
          }
          const viols = getActorViolations(a)
          if (viols.length > 0) {
            totalViolatorScooters++
            if (viols.includes('no_helmet')) noHelmetViolators++
            if (viols.length >= 2) multiViolationCount++
            if (viols.includes('sidewalk_riding')) sidewalkRidingViolators++
            if (!a.cited && actorHasAnyViolation(a)) violators++
          }
        }
        if (a.dutyState === 'fleeing' || a.dutyState === 'evading') fleeing++
        if (a.dutyState === 'halted' || a.haltedByDuty) halted++
        if (a.brakingForOfficer) braking++
      }
      const total = cars + scooters
      return {
        active,
        total,
        cars,
        scooters,
        violators,
        violatorRatio: total > 0 ? Number((violators / total).toFixed(4)) : 0,
        nonmotorViolationRate: scooters > 0 ? Number((totalViolatorScooters / scooters).toFixed(4)) : 0,
        noHelmetViolatorRate: totalViolatorScooters > 0 ? Number((noHelmetViolators / totalViolatorScooters).toFixed(4)) : 0,
        multiViolationCount,
        sidewalkRidingViolators,
        storyOverrideActive: Boolean(storyOverride && storyOverride.active !== false),
        violatorCooldownRemainingSec: Number((sim?.getViolatorCooldownRemaining() ?? 0).toFixed(2)),
        warningHorns,
        sidewalkTwoWheelers,
        nonmotorLaneCars,
        lastHitSpeedKmh: lastHitSpeedKmh !== null ? Number(lastHitSpeedKmh.toFixed(2)) : null,
        lastHitSeverity,
        fleeing,
        halted,
        braking,
        jiefangStoryMode: isStoryModeLiveHere(),
        finePool: buildFinePoolStats(actors),
      }
    },
  }
}
