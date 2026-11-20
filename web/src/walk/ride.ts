import R from '@dimforge/rapier3d-compat'
import * as T from 'three'
import type {Stream} from '../stream'
import type {Tile} from '../world'
import {
  BICYCLE_DEFAULT_GEAR,
  EBIKE_COMPLIANT_CAP_KMH,
  EBIKE_DEFAULT_GEAR,
  bicycleConfig,
  bicycleGearConfigs,
  bikeConfig as bcfg,
  ebikeBatteryConfig,
  resolveEbikeKind,
  resolveEbikeProfile,
  twoWheelCrashFlowConfig,
  walkConfig as wcfg,
  type EbikeBatteryStatus,
  type EbikeGearProfile,
  type EbikeTier,
  type EbikeUpgradeMods,
  type EbikeVehicleType,
  type NormalizedEbikeUpgrades,
  type ResolvedEbikeProfile,
  type TwoWheelCrashPhase,
  type TwoWheelCrashReason,
} from './config'

export type RideKind = 'bike' | 'bicycle'

export interface EbikeStepControl {
  wheelie?: boolean | number
  tuck?: boolean
  gearDelta?: number
  gearSelect?: number | null
}

export interface EbikeMountOptions {
  vehicleType?: EbikeVehicleType
  tier?: EbikeTier
  batteryPct?: number
  mods?: EbikeUpgradeMods | null
  keepGear?: boolean
  drainEnabled?: boolean
  autoCrash?: boolean
}

export interface TwoWheelSurfaceState {
  wet?: boolean
  offRoad?: boolean
}

export interface TwoWheelCrashWorldProbe {
  canPlaceWorld?: (wx: number, wy: number, wz: number) => boolean
  supportYWorld?: (wx: number, wz: number, refY: number) => number
}

export interface TwoWheelCrashInput {
  standUp?: boolean
  pickup?: boolean
  recover?: boolean
  moveHeld?: boolean
  autoStand?: boolean
}

export interface TwoWheelPickupResult {
  ok: boolean
  reason?: 'not_down' | 'rider_must_stand_first' | 'too_far' | 'already_picking_up'
  distance?: number
  standSpot?: {x: number; y: number; z: number; yaw: number}
}

export interface TwoWheelCrashSnapshot {
  phase: TwoWheelCrashPhase
  reason: TwoWheelCrashReason
  side: -1 | 1
  kind: RideKind
  bikePos: {x: number; y: number; z: number}
  bikeYaw: number
  bikeRoll: number
  bikePitch: number
  riderPos: {x: number; y: number; z: number}
  riderYaw: number
  pickupSpot: {x: number; y: number; z: number; yaw: number}
  bikeSlideSpeed: number
  riderSlideSpeed: number
  distToBike: number
  elapsed: number
  phaseElapsed: number
  riderStandProgress: number
  pickupProgress: number
  bikeIsDown: boolean
  riderIsDown: boolean
  riderOnFoot: boolean
  canStandUp: boolean
  canPickup: boolean
  justRecoveredToRide: boolean
}

export interface EbikeDynamicTelemetry {
  kind: RideKind
  vehicleType: EbikeVehicleType
  isShared: boolean
  tier: EbikeVehicleType
  tierLabel: string
  badge: string
  gear: number
  gearCount: number
  gearLabel: string
  gearHint: string
  speed: number
  kmh: number
  maxKmh: number
  targetKmh: number
  tierMaxKmh: number
  compliantCapKmh: number
  battery: number
  batteryPct: number
  batteryStatus: EbikeBatteryStatus
  lowBattery: boolean
  criticalBattery: boolean
  batteryDepleted: boolean
  lowBatteryCapKmh: number | null
  drainPerSec: number
  lean: number
  leanLimit: number
  gripLimitRad: number
  crashRisk: number
  wheelie: number
  wheelieVel: number
  tucking: boolean
  braking: boolean
  wetSurface: boolean
  offRoadSurface: boolean
  crashPhase: TwoWheelCrashPhase
  crashReason: TwoWheelCrashReason
  crashSide: -1 | 1
  bikeIsDown: boolean
  riderOnFoot: boolean
  canStandUp: boolean
  canPickup: boolean
  upgrades: NormalizedEbikeUpgrades
  upgraded: boolean
}

type Kind = 'ground'|'overview'|'road'|'deck'|'deckThin'|'building'|'peak'|'tree'|'rail'|'sidewalk'|'landmark'
type SurfaceHit = {y:number; slope:number} | null

export interface DismountContext {
  world: R.World
  capsule: R.Collider
  shape: R.Capsule
  kinds: Map<number, Kind>
  stream: Stream
  tileAt: (x:number, z:number)=>Tile|undefined
  surface: (x:number, z:number, kind:Kind, origin?:number, reach?:number)=>SurfaceHit
  wet: (x:number, z:number)=>boolean
  insideHouse: (x:number, z:number)=>boolean
}

export interface BikeMoveContext {
  pos: {x:number; y:number; z:number}
  next: {x:number; z:number}
  move: {x:number; z:number}
  heading: number
  speed: number
  step: number
  pavement: (x:number, z:number)=>boolean
  insideHouse: (x:number, z:number)=>boolean
  blockedAt: (x:number, y:number, z:number)=>boolean
  collisionKind: (dirX:number, dirZ:number)=>'building'|'collision'|''
  wetSurface?: boolean
  stopBike: ()=>void
  dampBike: (step:number)=>number
  capOffRoad: (step:number, limit:number)=>number
}

export type MountCheckResult =
  | {ok: true; x: number; y: number; z: number; bikeY: number; shifted: boolean}
  | {ok: false; reason: 'height'|'blocked'|'narrow'}

const IDENTITY = {x:0, y:0, z:0, w:1}
const OFF_ROAD_CAP = 4.2
const MOUNT_OFFSETS: readonly [number, number][] = [
  [.45, 0], [-.45, 0], [0, .45], [0, -.45],
  [.35, .35], [-.35, .35], [.35, -.35], [-.35, -.35],
  [.85, 0], [-.85, 0], [0, .85], [0, -.85],
  [.6, .6], [-.6, .6], [.6, -.6], [-.6, -.6],
]
const DISMOUNT_OFFSETS: readonly [number, number][] = [
  [-1.05, -.2],
  [1.05, -.2],
  [0, -1.45],
  [-1.15, .6],
  [1.15, .6],
  [0, 1.55],
  [0, 0],
]
const JOINT_NAMES = ['ThighL', 'ThighR', 'ShinL', 'ShinR', 'ArmL', 'ArmR', 'ForearmL', 'ForearmR', 'Torso', 'Head'] as const
type JointName = (typeof JOINT_NAMES)[number]

let wallRay: R.Ray | undefined

function smoothstep(t: number) {
  const c = T.MathUtils.clamp(t, 0, 1)
  return c * c * (3 - 2 * c)
}

function deadzone(value: number, threshold: number) {
  const abs = Math.abs(value)
  if (abs <= threshold) return 0
  return Math.sign(value) * (abs - threshold) / (1 - threshold)
}

function shortestAngle(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

function turnRate(speed: number, spec = bcfg, maxSpeed = spec.maxSpeed) {
  const s = T.MathUtils.clamp(Math.abs(speed) / Math.max(.5, maxSpeed), 0, 1)
  if (s <= .4) return T.MathUtils.lerp(spec.pivotTurn, spec.peakTurn, smoothstep(s / .4))
  return T.MathUtils.lerp(spec.peakTurn, spec.topTurn, smoothstep((s - .4) / .6))
}

function batteryStatusOf(pct: number): EbikeBatteryStatus {
  if (pct <= 0) return 'empty'
  if (pct <= ebikeBatteryConfig.criticalThresholdPct) return 'critical'
  if (pct <= ebikeBatteryConfig.lowThresholdPct) return 'low'
  return 'normal'
}

function computeBatteryLimits(pct: number): {
  status: EbikeBatteryStatus
  lowBattery: boolean
  capKmh: number | null
  accelMul: number
} {
  const status = batteryStatusOf(pct)
  if (status === 'normal') return {status, lowBattery: false, capKmh: null, accelMul: 1}
  if (status === 'empty') {
    return {status, lowBattery: true, capKmh: ebikeBatteryConfig.emptyCapKmh, accelMul: ebikeBatteryConfig.emptyAccelMul}
  }
  if (status === 'critical') {
    const t = T.MathUtils.clamp(pct / Math.max(1e-3, ebikeBatteryConfig.criticalThresholdPct), 0, 1)
    return {
      status,
      lowBattery: true,
      capKmh: +T.MathUtils.lerp(ebikeBatteryConfig.emptyCapKmh, ebikeBatteryConfig.criticalCapKmh, t).toFixed(2),
      accelMul: ebikeBatteryConfig.emptyAccelMul,
    }
  }
  const span = Math.max(1e-3, ebikeBatteryConfig.lowThresholdPct - ebikeBatteryConfig.criticalThresholdPct)
  const t = T.MathUtils.clamp((pct - ebikeBatteryConfig.criticalThresholdPct) / span, 0, 1)
  return {
    status,
    lowBattery: true,
    capKmh: +T.MathUtils.lerp(ebikeBatteryConfig.criticalCapKmh, ebikeBatteryConfig.lowCapKmh, t).toFixed(2),
    accelMul: ebikeBatteryConfig.lowAccelMul,
  }
}

/** Shows non-intrusive toast when mounting/dismounting or crash pickup is blocked. */
export function notifyDismountBlocked(message = '这里太窄了，挪一挪再下车') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('walk:toast', {detail: {text: message, ms: 2400}}))
}

function isWallBlocker(kind: Kind | undefined) {
  return kind === 'building' || kind === 'rail' || kind === 'peak' || kind === 'landmark' || kind === 'tree' || kind === 'deck' || kind === 'deckThin'
}

function localSupport(ctx: DismountContext, x: number, z: number, refY: number) {
  const deck = ctx.surface(x, z, 'deck', refY + .35, 1.4)
  const validDeck = deck && deck.y <= refY + .35 ? deck : null
  const lm = ctx.surface(x, z, 'landmark', refY + .35, 1.4)
  const validLm = lm && lm.slope <= wcfg.slope && lm.y <= refY + .35 ? lm : null
  const bridgeDeck = validDeck && validLm ? (validLm.y > validDeck.y ? validLm : validDeck) : (validDeck ?? validLm)
  const support = bridgeDeck ?? ctx.surface(x, z, 'sidewalk') ?? ctx.surface(x, z, 'road') ?? ctx.surface(x, z, 'ground')
  if (!support || support.slope > wcfg.slope || (!bridgeDeck && ctx.wet(x, z))) return null
  const peak = ctx.surface(x, z, 'peak')
  if (peak && peak.y > support.y + .05) return null
  return support
}

function segmentBlocked(ctx: DismountContext, x0: number, z0: number, x1: number, z1: number, baseY: number, trimEnd = 0) {
  const dx = x1 - x0, dz = z1 - z0, dist = Math.hypot(dx, dz)
  const len = dist - trimEnd
  if (len <= .05) return false
  wallRay ??= new R.Ray({x: 0, y: 0, z: 0}, {x: 0, y: 0, z: -1})
  wallRay.dir.x = dx / dist; wallRay.dir.y = 0; wallRay.dir.z = dz / dist
  for (const offset of [.5, 1.25]) {
    wallRay.origin.x = x0; wallRay.origin.y = baseY + offset; wallRay.origin.z = z0
    if (ctx.world.castRay(wallRay, len, true, undefined, undefined, ctx.capsule, undefined, coll => isWallBlocker(ctx.kinds.get(coll.handle)))) {
      return true
    }
  }
  return false
}

function standClear(ctx: DismountContext, x: number, y: number, z: number) {
  return !ctx.world.intersectionWithShape({x, y, z}, IDENTITY, ctx.shape, undefined, undefined, ctx.capsule)
}

/** Probes 7 local spots beside the parked bike with height-diff, horizontal dual-ray LOS, and capsule checks. */
export function probeLocalDismount(ctx: DismountContext, cx: number, cz: number, heading: number, bikeY: number) {
  const fx = -Math.sin(heading), fz = -Math.cos(heading)
  const rx = Math.cos(heading), rz = -Math.sin(heading)
  for (let i = 0; i < DISMOUNT_OFFSETS.length; i++) {
    const [side, fwd] = DISMOUNT_OFFSETS[i]
    const dx = side * rx + fwd * fx, dz = side * rz + fwd * fz
    const x = cx + dx, z = cz + dz
    const tile = ctx.tileAt(x, z)
    if (!tile || !ctx.stream.loaded.has(tile) || ctx.insideHouse(x, z)) continue
    const support = localSupport(ctx, x, z, bikeY)
    if (!support || Math.abs(support.y - bikeY) > .85) continue
    if (segmentBlocked(ctx, cx, cz, x, z, Math.max(bikeY, support.y))) continue
    const y = support.y + wcfg.height / 2 + .055
    if (!standClear(ctx, x, y, z)) continue
    return {x, y, z, rule: i === DISMOUNT_OFFSETS.length - 1 ? 'local-origin' : `local-${i}`}
  }
  return null
}

/** Validates Y elevation gap, wall/rail LOS between player and bike, and capsule clearance before mounting. */
export function probeLocalMount(ctx: DismountContext, px: number, py: number, pz: number, bx: number, by: number, bz: number): MountCheckResult {
  if (Math.abs(by - py) > 1.5) return {ok: false, reason: 'height'}
  if (segmentBlocked(ctx, px, pz, bx, bz, Math.max(py, by))) return {ok: false, reason: 'blocked'}

  const tryPlace = (x: number, z: number, shifted: boolean): MountCheckResult | null => {
    const tile = ctx.tileAt(x, z)
    if (!tile || !ctx.stream.loaded.has(tile) || ctx.insideHouse(x, z)) return null
    const support = localSupport(ctx, x, z, by)
    if (!support || Math.abs(support.y - by) > .55) return null
    if (shifted && (
      segmentBlocked(ctx, px, pz, x, z, Math.max(py, support.y))
      || segmentBlocked(ctx, bx, bz, x, z, Math.max(by, support.y))
    )) return null
    const y = support.y + wcfg.height / 2 + .055
    if (!standClear(ctx, x, y, z)) return null
    return {ok: true, x, y, z, bikeY: support.y, shifted}
  }

  const direct = tryPlace(bx, bz, false)
  if (direct) return direct
  for (const [ox, oz] of MOUNT_OFFSETS) {
    const res = tryPlace(bx + ox, bz + oz, true)
    if (res) return res
  }
  return {ok: false, reason: 'narrow'}
}

function isVerifySilentMode(): boolean {
  if (typeof location === 'undefined') return false
  const p = new URLSearchParams(location.search)
  return p.has('verify') && p.get('stunt') !== '1'
}

function emitToast(text: string, ms = 2400) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('walk:toast', {detail: {text, ms}}))
}

/**
 * Unified two-wheel dynamics & crash recovery controller for normal/shared e-bikes AND pedal bicycles:
 * - Distinct tactile manual gears on both e-bike (D1/D2/D3/S) and bicycle (1挡/2挡/3挡)
 * - Longitudinal coasting inertia, slope gravity pull, and torque-coupled wheelie pitch dynamics
 * - Hair-trigger crash detection: lowside corner slip (amplified by wet/off-road/braking), wheelie loopout, and wall/curb impact
 * - Realistic multi-phase crash recovery state machine: sliding -> downed -> rider_rising -> bike_down -> picking_up -> upright
 *   (vehicle remains lying sideways on ground while rider gets up on foot first, then walks close to lift & right it).
 */
export function createBikeControl() {
  let speed = 0, heading = 0, lean = 0, pitch = 0, steerInput = 0, revHold = 0
  let onPavement = false, wetSurface = false, offRoadSurface = false
  let kind: RideKind = 'bike'
  let vehicleType: EbikeVehicleType = 'normal'
  let mods: EbikeUpgradeMods | null = null
  let profile: ResolvedEbikeProfile = resolveEbikeProfile(vehicleType)
  let gear = EBIKE_DEFAULT_GEAR
  let batteryPct = 100
  let lastBatteryStatus: EbikeBatteryStatus = 'normal'
  let drainEnabledOverride: boolean | undefined
  let autoCrashOverride: boolean | undefined
  let drainPerSec = 0
  let wheelie = 0
  let wheelieVel = 0
  let wheelieLoad = 0
  let tucking = false
  let braking = false
  let sharpSteerHold = 0
  let gripLimitRad = bcfg.crash.lowsideLeanRad
  let crashRisk = 0

  // Crash & rider-first-rise state machine
  let bikePos = {x: 0, y: 0, z: 0}
  let riderPos = {x: 0, y: 0, z: 0}
  let crashPhase: TwoWheelCrashPhase = 'none'
  let crashReason: TwoWheelCrashReason = ''
  let crashSide: -1 | 1 = 1
  let crashElapsed = 0
  let phaseElapsed = 0
  let bikeRoll = 0
  let bikeYaw = 0
  let riderYaw = 0
  let bikeSlideSpeed = 0
  let riderSlideSpeed = 0
  let riderStandProgress = 0
  let pickupProgress = 0
  let pickupStartRoll = 0
  let justRecoveredToRide = false

  function spec() {
    return kind === 'bicycle' ? bicycleConfig : bcfg
  }

  function activeGears(): readonly EbikeGearProfile[] {
    return kind === 'bicycle' ? bicycleGearConfigs : profile.gears
  }

  function defaultGearFor(targetKind: RideKind) {
    return targetKind === 'bicycle' ? BICYCLE_DEFAULT_GEAR : EBIKE_DEFAULT_GEAR
  }

  function currentGearSpec(): EbikeGearProfile {
    const list = activeGears()
    return list[T.MathUtils.clamp(gear - 1, 0, list.length - 1)]
  }

  function canAutoCrash(): boolean {
    if (autoCrashOverride !== undefined) return autoCrashOverride
    return !isVerifySilentMode()
  }

  function computePickupSpot(): {x: number; y: number; z: number; yaw: number} {
    // Stand on the upright side opposite the ground-lay side so rider faces the downed bike frame cleanly.
    const rx = Math.cos(bikeYaw) * crashSide
    const rz = -Math.sin(bikeYaw) * crashSide
    const sx = bikePos.x - rx * .74
    const sz = bikePos.z - rz * .74
    const yaw = Math.atan2(-(bikePos.x - sx), -(bikePos.z - sz))
    return {x: sx, y: bikePos.y, z: sz, yaw}
  }

  function distRiderToBike(): number {
    return Math.hypot(riderPos.x - bikePos.x, riderPos.z - bikePos.z)
  }

  function effectiveMaxKmh(): {
    targetKmh: number
    lowBatteryCapKmh: number | null
    accelBatteryMul: number
    status: EbikeBatteryStatus
    lowBattery: boolean
    criticalBattery: boolean
  } {
    const g = currentGearSpec()
    if (kind === 'bicycle') {
      const tuckBonus = tucking && Math.abs(speed) > 4.2 ? 1.5 : 0
      return {
        targetKmh: g.maxKmh + tuckBonus,
        lowBatteryCapKmh: null,
        accelBatteryMul: 1,
        status: 'normal',
        lowBattery: false,
        criticalBattery: false,
      }
    }
    const bat = computeBatteryLimits(batteryPct)
    return {
      targetKmh: bat.capKmh !== null ? Math.min(g.maxKmh, bat.capKmh) : g.maxKmh,
      lowBatteryCapKmh: bat.capKmh,
      accelBatteryMul: bat.accelMul,
      status: bat.status,
      lowBattery: bat.lowBattery,
      criticalBattery: batteryPct <= ebikeBatteryConfig.criticalThresholdPct,
    }
  }

  function maybeNotifyBattery(nextStatus: EbikeBatteryStatus) {
    const rank: Record<EbikeBatteryStatus, number> = {normal: 0, low: 1, critical: 2, empty: 3}
    if (rank[nextStatus] <= rank[lastBatteryStatus]) {
      lastBatteryStatus = nextStatus
      return
    }
    lastBatteryStatus = nextStatus
    if (isVerifySilentMode()) return
    const text = nextStatus === 'empty'
      ? `${profile.tierLabel}电量耗尽，已切至 ${ebikeBatteryConfig.emptyCapKmh} km/h 应急助力`
      : nextStatus === 'critical'
        ? `${profile.tierLabel}严重亏电，已限速 ${ebikeBatteryConfig.criticalCapKmh} km/h`
        : `${profile.tierLabel}电量偏低，开启低电降速保护`
    emitToast(text, 2600)
  }

  function clearCrashState() {
    crashPhase = 'none'
    crashReason = ''
    crashElapsed = 0
    phaseElapsed = 0
    bikeRoll = 0
    bikeSlideSpeed = 0
    riderSlideSpeed = 0
    riderStandProgress = 0
    pickupProgress = 0
    pickupStartRoll = 0
    sharpSteerHold = 0
    crashRisk = 0
  }

  function reset() {
    speed = lean = pitch = steerInput = revHold = 0
    drainPerSec = wheelie = wheelieVel = wheelieLoad = 0
    tucking = braking = false
    onPavement = wetSurface = offRoadSurface = false
    gripLimitRad = spec().crash.lowsideLeanRad
    kind = 'bike'
    vehicleType = 'normal'
    mods = null
    profile = resolveEbikeProfile('normal')
    gear = EBIKE_DEFAULT_GEAR
    batteryPct = 100
    lastBatteryStatus = 'normal'
    drainEnabledOverride = undefined
    autoCrashOverride = undefined
    justRecoveredToRide = false
    clearCrashState()
  }

  function setGear(nextGear: number) {
    const list = activeGears()
    gear = T.MathUtils.clamp(Math.round(nextGear), 1, list.length)
    return gear
  }

  function setVehicleType(nextType: EbikeVehicleType | string) {
    vehicleType = resolveEbikeKind(0, nextType)
    if (vehicleType === 'shared') mods = null
    profile = resolveEbikeProfile(vehicleType, mods)
    gear = T.MathUtils.clamp(gear, 1, activeGears().length)
    return profile
  }

  function setUpgrades(nextMods: EbikeUpgradeMods | null) {
    mods = vehicleType === 'shared' ? null : (nextMods ? {...nextMods} : null)
    profile = resolveEbikeProfile(vehicleType, mods)
    gear = T.MathUtils.clamp(gear, 1, activeGears().length)
    return profile
  }

  function setBattery(pct: number) {
    batteryPct = T.MathUtils.clamp(Number.isFinite(pct) ? pct : 100, 0, 100)
    lastBatteryStatus = batteryStatusOf(batteryPct)
    return batteryPct
  }

  function setVehicleWorldPos(x: number, y: number, z: number) {
    bikePos.x = x; bikePos.y = y; bikePos.z = z
    if (crashPhase === 'none') {
      riderPos.x = x; riderPos.y = y; riderPos.z = z
    }
  }

  function setRiderWorldPos(x: number, y: number, z: number) {
    riderPos.x = x; riderPos.y = y; riderPos.z = z
  }

  function setSurfaceCondition(state: TwoWheelSurfaceState) {
    if (state.wet !== undefined) wetSurface = state.wet
    if (state.offRoad !== undefined) offRoadSurface = state.offRoad
  }

  function triggerCrash(reason: Exclude<TwoWheelCrashReason, ''>, side?: -1 | 1, probe?: TwoWheelCrashWorldProbe): TwoWheelCrashSnapshot {
    if (crashPhase !== 'none') return crashSnapshot()
    const resolvedSide: -1 | 1 = side ?? (Math.abs(lean) > .05 ? (lean > 0 ? -1 : 1) : (steerInput >= 0 ? 1 : -1))
    const entrySpd = Math.max(Math.abs(speed), reason === 'loopout' ? 4.4 : reason === 'lowside' ? 5.0 : 3.4)
    crashPhase = 'sliding'
    crashReason = reason
    crashSide = resolvedSide
    crashElapsed = 0
    phaseElapsed = 0
    bikeYaw = heading
    riderYaw = heading
    bikeRoll = lean
    bikeSlideSpeed = T.MathUtils.clamp(entrySpd * (reason === 'impact' ? .55 : .88), 2.2, 13.5)
    riderSlideSpeed = T.MathUtils.clamp(entrySpd * twoWheelCrashFlowConfig.riderSlideMul, 2.8, 16.0)
    riderStandProgress = 0
    pickupProgress = 0
    justRecoveredToRide = false

    // Immediately kick rider off to opposite-or-forward separation vector so rider never overlaps fallen bike.
    const fwdX = -Math.sin(bikeYaw), fwdZ = -Math.cos(bikeYaw)
    const sideX = Math.cos(bikeYaw) * crashSide, sideZ = -Math.sin(bikeYaw) * crashSide
    const ejectDx = fwdX * (reason === 'loopout' ? -.45 : .42) - sideX * .72
    const ejectDz = fwdZ * (reason === 'loopout' ? -.45 : .42) - sideZ * .72
    const nx = bikePos.x + ejectDx, nz = bikePos.z + ejectDz
    const ny = probe?.supportYWorld ? probe.supportYWorld(nx, nz, bikePos.y) : bikePos.y
    if (!probe?.canPlaceWorld || probe.canPlaceWorld(nx, ny, nz)) {
      riderPos.x = nx; riderPos.y = ny; riderPos.z = nz
    } else {
      riderPos.x = bikePos.x; riderPos.y = bikePos.y; riderPos.z = bikePos.z
    }

    speed = 0
    wheelie = 0
    wheelieVel = 0
    sharpSteerHold = 0
    braking = false

    const vehicleName = kind === 'bicycle' ? '单车' : '电车'
    const msg = reason === 'lowside'
      ? `压弯过低打滑摔车！人将先爬起，再走近扶起${vehicleName}`
      : reason === 'loopout'
        ? `翘头过度后翻！人将先爬起，再走近扶起${vehicleName}`
        : `撞击倒地！人将先爬起，再走近扶起${vehicleName}`
    if (!isVerifySilentMode()) emitToast(msg, 2800)
    return crashSnapshot()
  }

  /** Step 1 of recovery: only the thrown rider gets back up onto their feet; vehicle remains lying on its side. */
  function standUp(): boolean {
    if (crashPhase !== 'downed') return false
    crashPhase = 'rider_rising'
    phaseElapsed = 0
    riderStandProgress = 0
    return true
  }

  /** Step 2 of recovery: standing rider approaches within pickupRadius and lifts the downed two-wheeler upright. */
  function startPickup(): TwoWheelPickupResult {
    const spot = computePickupSpot()
    if (crashPhase === 'none') return {ok: false, reason: 'not_down'}
    if (crashPhase === 'picking_up') return {ok: false, reason: 'already_picking_up', standSpot: spot}
    if (crashPhase === 'sliding' || crashPhase === 'downed' || crashPhase === 'rider_rising') {
      return {ok: false, reason: 'rider_must_stand_first', standSpot: spot}
    }
    const dist = distRiderToBike()
    if (dist > twoWheelCrashFlowConfig.pickupRadius) {
      return {ok: false, reason: 'too_far', distance: dist, standSpot: spot}
    }
    crashPhase = 'picking_up'
    phaseElapsed = 0
    pickupProgress = 0
    pickupStartRoll = bikeRoll
    return {ok: true, distance: dist, standSpot: spot}
  }

  /** Context-sensitive helper: stands up first if downed; picks up bike if standing nearby. */
  function recover(): boolean {
    if (crashPhase === 'downed') return standUp()
    if (crashPhase === 'bike_down') return startPickup().ok
    return false
  }

  function stepCrash(dt: number, input?: TwoWheelCrashInput, probe?: TwoWheelCrashWorldProbe): TwoWheelCrashSnapshot {
    justRecoveredToRide = false
    if (crashPhase === 'none') return crashSnapshot()
    const cdt = Math.min(.1, Math.max(0, dt))
    crashElapsed += cdt
    phaseElapsed += cdt

    const layRoll = -crashSide * twoWheelCrashFlowConfig.bikeLayRollRad

    if (crashPhase === 'sliding') {
      const fwdX = -Math.sin(bikeYaw), fwdZ = -Math.cos(bikeYaw)
      const sideX = Math.cos(bikeYaw) * crashSide, sideZ = -Math.sin(bikeYaw) * crashSide

      if (bikeSlideSpeed > .02 && cdt > 0) {
        const bStep = bikeSlideSpeed * cdt
        const nbx = bikePos.x + (fwdX * .88 + sideX * .38) * bStep
        const nbz = bikePos.z + (fwdZ * .88 + sideZ * .38) * bStep
        const nby = probe?.supportYWorld ? probe.supportYWorld(nbx, nbz, bikePos.y) : bikePos.y
        if (!probe?.canPlaceWorld || probe.canPlaceWorld(nbx, nby, nbz)) {
          bikePos.x = nbx; bikePos.y = nby; bikePos.z = nbz
        } else {
          bikeSlideSpeed *= .25
        }
        bikeSlideSpeed = Math.max(0, bikeSlideSpeed - twoWheelCrashFlowConfig.slideFriction * cdt)
      }

      if (riderSlideSpeed > .02 && cdt > 0) {
        const rStep = riderSlideSpeed * cdt
        const rDirX = crashReason === 'loopout' ? -fwdX * .35 - sideX * .72 : fwdX * .78 - sideX * .62
        const rDirZ = crashReason === 'loopout' ? -fwdZ * .35 - sideZ * .72 : fwdZ * .78 - sideZ * .62
        const nrx = riderPos.x + rDirX * rStep
        const nrz = riderPos.z + rDirZ * rStep
        const nry = probe?.supportYWorld ? probe.supportYWorld(nrx, nrz, riderPos.y) : riderPos.y
        if (!probe?.canPlaceWorld || probe.canPlaceWorld(nrx, nry, nrz)) {
          riderPos.x = nrx; riderPos.y = nry; riderPos.z = nrz
        } else {
          riderSlideSpeed *= .2
        }
        riderSlideSpeed = Math.max(0, riderSlideSpeed - twoWheelCrashFlowConfig.riderFriction * cdt)
      }

      bikeRoll = T.MathUtils.damp(bikeRoll, layRoll, 11, cdt)

      if (phaseElapsed >= twoWheelCrashFlowConfig.minSlideSec && bikeSlideSpeed < .25 && riderSlideSpeed < .25) {
        bikeSlideSpeed = 0
        riderSlideSpeed = 0
        bikeRoll = layRoll
        crashPhase = 'downed'
        phaseElapsed = 0
      }
    } else if (crashPhase === 'downed') {
      bikeRoll = layRoll
      if (input?.standUp || input?.recover || input?.moveHeld || (input?.autoStand !== false && phaseElapsed >= twoWheelCrashFlowConfig.autoRiseDelaySec)) {
        standUp()
      }
    } else if (crashPhase === 'rider_rising') {
      bikeRoll = layRoll
      riderStandProgress = T.MathUtils.clamp(phaseElapsed / twoWheelCrashFlowConfig.riderRiseSec, 0, 1)
      if (riderStandProgress >= 1) {
        crashPhase = 'bike_down'
        phaseElapsed = 0
        if (!isVerifySilentMode()) {
          emitToast(`已站起，靠近倒地的${kind === 'bicycle' ? '单车' : '电动车'}按 F 扶正`, 2500)
        }
      }
    } else if (crashPhase === 'bike_down') {
      bikeRoll = layRoll
      riderStandProgress = 1
      if (input?.pickup || input?.recover) {
        startPickup()
      }
    } else if (crashPhase === 'picking_up') {
      pickupProgress = T.MathUtils.clamp(phaseElapsed / twoWheelCrashFlowConfig.pickupSec, 0, 1)
      const ease = smoothstep(pickupProgress)
      bikeRoll = T.MathUtils.lerp(pickupStartRoll, 0, ease)
      if (pickupProgress >= 1) {
        heading = bikeYaw
        lean = 0
        speed = 0
        wheelie = 0
        wheelieVel = 0
        clearCrashState()
        setGear(defaultGearFor(kind))
        justRecoveredToRide = true
      }
    }

    return crashSnapshot()
  }

  function crashSnapshot(): TwoWheelCrashSnapshot {
    const dist = distRiderToBike()
    return {
      phase: crashPhase,
      reason: crashReason,
      side: crashSide,
      kind,
      bikePos: {...bikePos},
      bikeYaw,
      bikeRoll,
      bikePitch: pitch,
      riderPos: {...riderPos},
      riderYaw,
      pickupSpot: computePickupSpot(),
      bikeSlideSpeed,
      riderSlideSpeed,
      distToBike: dist,
      elapsed: crashElapsed,
      phaseElapsed,
      riderStandProgress,
      pickupProgress,
      bikeIsDown: crashPhase !== 'none',
      riderIsDown: crashPhase === 'sliding' || crashPhase === 'downed' || crashPhase === 'rider_rising',
      riderOnFoot: crashPhase === 'bike_down' || crashPhase === 'picking_up',
      canStandUp: crashPhase === 'downed',
      canPickup: crashPhase === 'bike_down' && dist <= twoWheelCrashFlowConfig.pickupRadius,
      justRecoveredToRide,
    }
  }

  function telemetry(): EbikeDynamicTelemetry {
    const list = activeGears()
    const g = currentGearSpec()
    const lim = effectiveMaxKmh()
    const batRounded = +batteryPct.toFixed(1)
    const snap = crashSnapshot()
    return {
      kind,
      vehicleType,
      isShared: vehicleType === 'shared',
      tier: vehicleType,
      tierLabel: kind === 'bicycle' ? '人力单车' : profile.tierLabel,
      badge: kind === 'bicycle' ? '单车' : profile.badge,
      gear,
      gearCount: list.length,
      gearLabel: g.label,
      gearHint: g.hint,
      speed,
      kmh: Math.round(Math.abs(speed) * 3.6),
      maxKmh: lim.targetKmh,
      targetKmh: lim.targetKmh,
      tierMaxKmh: kind === 'bicycle' ? bicycleGearConfigs[bicycleGearConfigs.length - 1].maxKmh : profile.tierMaxKmh,
      compliantCapKmh: profile.compliantCapKmh,
      battery: batRounded,
      batteryPct: batRounded,
      batteryStatus: lim.status,
      lowBattery: lim.lowBattery,
      criticalBattery: lim.criticalBattery,
      batteryDepleted: kind === 'bike' && batteryPct <= 0,
      lowBatteryCapKmh: lim.lowBatteryCapKmh,
      drainPerSec: +drainPerSec.toFixed(3),
      lean,
      leanLimit: gripLimitRad,
      gripLimitRad,
      crashRisk,
      wheelie,
      wheelieVel,
      tucking,
      braking,
      wetSurface,
      offRoadSurface,
      crashPhase,
      crashReason,
      crashSide,
      bikeIsDown: snap.bikeIsDown,
      riderOnFoot: snap.riderOnFoot,
      canStandUp: snap.canStandUp,
      canPickup: snap.canPickup,
      upgrades: profile.upgrades,
      upgraded: profile.upgraded,
    }
  }

  return {
    get kind() { return kind },
    get vehicleType() { return vehicleType },
    get tier() { return vehicleType },
    get isShared() { return vehicleType === 'shared' },
    get gear() { return gear },
    get gearCount() { return activeGears().length },
    get profile() { return profile },
    get mods() { return mods },
    get batteryPct() { return batteryPct },
    get batteryStatus() { return batteryStatusOf(batteryPct) },
    get lowBattery() { return batteryStatusOf(batteryPct) !== 'normal' },
    get criticalBattery() { return batteryPct <= ebikeBatteryConfig.criticalThresholdPct },
    get drainPerSec() { return drainPerSec },
    get speed() { return speed },
    get heading() { return heading },
    get lean() { return lean },
    get pitch() { return pitch },
    get steerInput() { return steerInput },
    get wheelie() { return wheelie },
    get crashRisk() { return crashRisk },
    get gripLimitRad() { return gripLimitRad },
    get crashPhase() { return crashPhase },
    get isCrashedOrDown() { return crashPhase !== 'none' },
    get bikeDownState() { return crashSnapshot() },
    get crashState() { return crashSnapshot() },
    get telemetry() { return telemetry },
    mount(yaw: number, initialPitch = 0, rideKind: RideKind = 'bike', options?: EbikeMountOptions) {
      heading = yaw
      reset()
      kind = rideKind
      pitch = initialPitch
      vehicleType = resolveEbikeKind(0, options?.vehicleType ?? options?.tier ?? 'normal')
      mods = vehicleType === 'shared' ? null : (options?.mods ? {...options.mods} : null)
      profile = resolveEbikeProfile(vehicleType, mods)
      gear = options?.keepGear ? T.MathUtils.clamp(gear, 1, activeGears().length) : defaultGearFor(kind)
      batteryPct = T.MathUtils.clamp(options?.batteryPct ?? 100, 0, 100)
      lastBatteryStatus = batteryStatusOf(batteryPct)
      drainEnabledOverride = options?.drainEnabled
      autoCrashOverride = options?.autoCrash
      gripLimitRad = spec().crash.lowsideLeanRad
    },
    setGear,
    shiftGear(delta: number) { return setGear(gear + delta) },
    resetGearToCompliant() { return setGear(defaultGearFor(kind)) },
    setVehicleType,
    setUpgrades,
    setBattery,
    setAutoCrash(on: boolean | undefined) { autoCrashOverride = on },
    setVehicleWorldPos,
    setRiderWorldPos,
    setSurfaceCondition,
    triggerCrash,
    standUp,
    startPickup,
    recover,
    stepCrash,
    stop() { speed = 0; drainPerSec = 0; wheelieVel = 0 },
    reset,
    dampSpeed(step: number) {
      speed *= Math.max(0, 1 - spec().slideDamp * step)
      return speed
    },
    capSpeed(step: number, limit: number) {
      const abs = Math.abs(speed)
      if (abs > limit) speed = Math.sign(speed) * Math.max(limit, abs - 6.5 * step)
      return speed
    },
    steer(forward: number, right: number, dt: number, mounted = true, control?: EbikeStepControl) {
      const s = spec()
      const cdt = Math.min(.12, Math.max(0, dt))

      if (crashPhase !== 'none') {
        speed = 0
        drainPerSec = 0
        wheelieVel = 0
        return 0
      }

      if (control?.gearSelect !== undefined && control.gearSelect !== null) setGear(control.gearSelect)
      else if (control?.gearDelta) setGear(gear + control.gearDelta)

      if (!mounted) {
        revHold = 0
        drainPerSec = 0
        braking = false
        tucking = false
        wheelieLoad = 0
        wheelieVel = 0
        wheelie = T.MathUtils.damp(wheelie, 0, 10, cdt)
        steerInput = T.MathUtils.damp(steerInput, 0, s.steerDamp, cdt)
        lean = T.MathUtils.damp(lean, 0, s.leanDamp, cdt)
        sharpSteerHold = 0
        crashRisk = 0
        return speed
      }

      const prevSpeed = speed
      const uFwd = deadzone(T.MathUtils.clamp(forward, -1, 1), s.stickDeadFwd)
      const uTurn = deadzone(T.MathUtils.clamp(right, -1, 1), s.stickDeadTurn)
      steerInput = T.MathUtils.damp(steerInput, uTurn, s.steerDamp, cdt)
      tucking = !!control?.tuck && Math.abs(speed) > 1.8

      const reqWheelie = typeof control?.wheelie === 'number'
        ? T.MathUtils.clamp(control.wheelie, 0, 1)
        : control?.wheelie ? 1 : 0
      wheelieLoad = reqWheelie

      const uphillSin = Math.sin(pitch)
      const gSpec = currentGearSpec()
      const batLim = effectiveMaxKmh()
      const capMs = batLim.targetKmh / 3.6
      const uphillFactor = uphillSin > .012 ? Math.max(0, uphillSin - .012) : 0
      const downhillFactor = uphillSin < -.012 ? Math.max(0, -uphillSin - .012) : 0
      const slopeMul = kind === 'bicycle' ? gSpec.uphillMul : gSpec.uphillMul
      const effMax = uphillFactor > 0
        ? Math.max(2.0, capMs * (1 - s.uphillCapScale * .28 * slopeMul * uphillFactor))
        : capMs

      const torqueMul = kind === 'bike' ? profile.accelMul * batLim.accelBatteryMul : 1
      braking = (uFwd < -.05 && speed > .05) || (uFwd > .05 && speed < -.05)

      if (uFwd > .05) {
        revHold = 0
        if (speed < 0) {
          speed = Math.min(0, speed + s.brake * uFwd * cdt)
        } else {
          const ratio = T.MathUtils.clamp(speed / Math.max(.8, effMax), 0, 1.1)
          const blendedGearAccel = T.MathUtils.lerp(gSpec.launchTorque, gSpec.accelScale, smoothstep(Math.min(1, ratio))) * torqueMul
          const rawDrive = s.accel * blendedGearAccel * (1 - s.torqueDecay * Math.pow(Math.min(1, ratio), s.torquePow)) * uFwd
          const slopeDrag = uphillFactor > 0
            ? Math.min(rawDrive * .72, s.uphillDrag * slopeMul * uphillFactor)
            : -9.8 * downhillFactor * .32
          const nextSpd = speed + (rawDrive - slopeDrag) * cdt
          const capDrop = batLim.lowBatteryCapKmh !== null || capMs < speed ? 3.4 : 0
          speed = nextSpd <= effMax
            ? nextSpd
            : Math.max(effMax, speed - (s.rollDrag + s.uphillDrag * uphillFactor + capDrop) * cdt)
        }
      } else if (uFwd < -.05) {
        if (speed > .05) {
          revHold = 0
          speed = Math.max(0, speed + s.brake * uFwd * cdt)
        } else if (speed < -.01) {
          revHold = s.revHold
          speed = T.MathUtils.clamp(speed + s.revAccel * uFwd * cdt, s.reverseMax, 0)
        } else {
          revHold += cdt
          if (revHold >= s.revHold) speed = T.MathUtils.clamp(speed + s.revAccel * uFwd * cdt, s.reverseMax, 0)
          else speed = 0
        }
      } else {
        // Freewheel / coasting inertia: gentle rolling drag + aerodynamic quadratic drag + slope gravity.
        revHold = 0
        if (speed > 0) {
          const gravityDelta = uphillFactor > 0
            ? (9.8 * uphillFactor * (kind === 'bicycle' ? gSpec.uphillMul : .75))
            : -(9.8 * downhillFactor * .35)
          const drag = s.rollDrag + s.aeroDrag * speed * speed + gravityDelta
          speed = Math.max(0, speed - drag * cdt)
          if (downhillFactor > 0 && speed > effMax * 1.12) speed = effMax * 1.12
        } else if (speed < 0) {
          speed = Math.min(0, speed + (s.rollDrag * 2.2 + s.aeroDrag * speed * speed) * cdt)
        }
      }

      // Active wheelie pitch physics driven by throttle torque + gear wheelie gain.
      const torqueBias = gSpec.wheelieGain * (kind === 'bike' ? profile.wheelieTorqueMul : 1)
      if (wheelieLoad > .05 && speed >= s.crash.wheelieMinSpeedMs && !braking) {
        const speedEase = T.MathUtils.clamp(speed / 3.8, .48, 1.25)
        const liftAccel = s.crash.wheelieRaiseRate * wheelieLoad * torqueBias * speedEase
        wheelieVel = T.MathUtils.damp(wheelieVel, Math.max(0, liftAccel * .32), 6, cdt)
        wheelie = Math.max(0, wheelie + wheelieVel * cdt)
      } else {
        wheelieVel = T.MathUtils.damp(wheelieVel, -s.crash.wheelieFallRate * (wheelie > 0 ? .38 : 0), 10, cdt)
        wheelie = Math.max(0, T.MathUtils.damp(wheelie, 0, s.crash.wheelieFallRate, cdt))
      }

      const omega = turnRate(speed, s, Math.max(s.maxSpeed, capMs * .85))
      const dirSign = speed < -.05 ? -1 : 1
      // Wheelie reduces front tire steering bite mildly, and tucking tightens corner carve.
      const frontGripFactor = wheelie > .18 ? T.MathUtils.lerp(1, .52, T.MathUtils.clamp((wheelie - .18) / .35, 0, 1)) : 1
      heading -= steerInput * omega * dirSign * frontGripFactor * cdt

      const maxLean = tucking ? s.tuckLeanMax : s.leanMax
      const speedNorm = Math.abs(speed) / Math.max(1.2, s.maxSpeed)
      const targetLean = Math.abs(speed) > .45
        ? T.MathUtils.clamp(-steerInput * Math.min(1.32, .35 + speedNorm * .78) * maxLean, -maxLean, maxLean)
        : 0
      lean = T.MathUtils.damp(lean, targetLean, s.leanDamp, cdt)

      // Dynamic cornering grip threshold (wet, off-road, braking in lean, and high speed lower slip threshold).
      let limit = s.crash.lowsideLeanRad
      if (wetSurface) limit -= s.crash.wetGripPenaltyRad
      if (offRoadSurface) limit -= s.crash.offRoadGripPenaltyRad
      if (braking && Math.abs(lean) > .14) limit -= s.crash.brakeInLeanPenaltyRad
      if (Math.abs(speed) > s.crash.highSpeedPenaltyStartMs) limit -= s.crash.highSpeedPenaltyRad
      gripLimitRad = Math.max(.16, limit)

      if (Math.abs(steerInput) >= s.crash.sharpSteerInput && Math.abs(speed) >= s.crash.sharpSteerSpeedMs) {
        sharpSteerHold += cdt
      } else {
        sharpSteerHold = Math.max(0, sharpSteerHold - cdt * 3)
      }

      const leanRatio = Math.abs(lean) / gripLimitRad
      const wheelieRatio = wheelie / s.crash.wheelieCrashRad
      const jerkRatio = sharpSteerHold / s.crash.sharpSteerWindowSec
      crashRisk = T.MathUtils.clamp(Math.max(leanRatio, wheelieRatio, jerkRatio), 0, 1)

      if (canAutoCrash()) {
        if (wheelie >= s.crash.wheelieCrashRad) {
          triggerCrash('loopout', steerInput >= 0 ? 1 : -1)
          return speed
        }
        if ((Math.abs(lean) >= gripLimitRad && Math.abs(speed) >= 3.2) || jerkRatio >= 1) {
          triggerCrash('lowside', lean > 0 ? -1 : 1)
          return speed
        }
      }

      const shouldDrain = drainEnabledOverride ?? !isVerifySilentMode()
      if (kind === 'bike' && cdt > 0 && shouldDrain) {
        const driveFactor = uFwd > .05 ? uFwd : (uFwd < -.05 && prevSpeed <= .05) ? Math.abs(uFwd) * .55 : 0
        const posAccel = Math.max(0, (speed - prevSpeed) / cdt - ebikeBatteryConfig.accelNoiseThreshold)
        const speedRatio = (Math.abs(speed) * 3.6) / EBIKE_COMPLIANT_CAP_KMH
        const leanNorm = Math.min(1.5, Math.abs(lean) / Math.max(.1, s.leanMax))
        const activeLoad = driveFactor > 0
          ? (ebikeBatteryConfig.cruiseDrainPerSec * gSpec.drainScale
            + ebikeBatteryConfig.speedAeroDrainPerSec * speedRatio * speedRatio
            + ebikeBatteryConfig.accelDrainPerAccel * posAccel
            + ebikeBatteryConfig.wheelieDrainPerSec * wheelieLoad
            + ebikeBatteryConfig.cornerLeanDrainPerSec * leanNorm
            + (tucking ? ebikeBatteryConfig.tuckDrainPerSec : 0)
            + ebikeBatteryConfig.climbDrainPerSlope * Math.max(0, uphillSin)) * driveFactor * profile.drainMul
          : 0
        const regen = braking && prevSpeed > 3 ? ebikeBatteryConfig.regenOnBrakePerSec : 0
        drainPerSec = Math.max(0, (ebikeBatteryConfig.idleDrainPerSec + activeLoad - regen) / Math.max(.25, profile.capacityScale))
        batteryPct = Math.max(0, batteryPct - drainPerSec * cdt)
        maybeNotifyBattery(batteryStatusOf(batteryPct))
      } else {
        drainPerSec = 0
      }

      return speed
    },
    setPitch(frontY: number | undefined, backY: number | undefined, dt: number) {
      const s = spec()
      const target = frontY !== undefined && backY !== undefined && Math.abs(frontY - backY) < .45
        ? T.MathUtils.clamp(Math.atan2(frontY - backY, 1.1), -s.pitchMax, s.pitchMax)
        : 0
      pitch = T.MathUtils.damp(pitch, target, s.pitchDamp, Math.min(.12, Math.max(0, dt)))
    },
    resolveMove(ctx: BikeMoveContext) {
      setVehicleWorldPos(ctx.pos.x, ctx.pos.y, ctx.pos.z)
      if (ctx.wetSurface !== undefined) wetSurface = ctx.wetSurface

      if (crashPhase !== 'none') {
        ctx.next.x = ctx.pos.x; ctx.next.z = ctx.pos.z; ctx.stopBike()
        return {blocked: true, reason: 'crashed', speed: 0}
      }

      const s = spec()
      const preSpeed = Math.abs(ctx.speed)
      const preLean = Math.abs(lean)
      const preWheelie = wheelie
      const fwdX = -Math.sin(ctx.heading), fwdZ = -Math.cos(ctx.heading), sign = ctx.speed >= 0 ? 1 : -1
      const probeX = ctx.next.x + fwdX * sign * .72, probeZ = ctx.next.z + fwdZ * sign * .72

      const maybeCrashOnImpact = (reason: '' | 'building' | 'collision') => {
        if (!reason || !canAutoCrash()) return false
        if (preSpeed >= s.crash.impactCrashMs
          || (preSpeed >= s.crash.angledImpactCrashMs && (preLean >= s.crash.angledImpactLeanRad || preWheelie >= .12))) {
          triggerCrash('impact', steerInput >= 0 ? 1 : -1)
          return true
        }
        return false
      }

      if (Math.abs(ctx.speed) > 1e-4 && ctx.insideHouse(probeX, probeZ)) {
        maybeCrashOnImpact('building')
        ctx.next.x = ctx.pos.x; ctx.next.z = ctx.pos.z; ctx.stopBike()
        return {blocked: true, reason: 'building', speed: 0}
      }
      if (Math.hypot(ctx.move.x, ctx.move.z) < Math.abs(ctx.speed) * ctx.step * .35) {
        const hit = ctx.collisionKind(fwdX * sign, fwdZ * sign)
        if (hit) {
          maybeCrashOnImpact(hit)
          ctx.next.x = ctx.pos.x; ctx.next.z = ctx.pos.z; ctx.stopBike()
          return {blocked: true, reason: hit, speed: 0}
        }
      }
      if (ctx.pavement(ctx.next.x, ctx.next.z)) {
        onPavement = true
        offRoadSurface = false
        return {blocked: false, reason: '', speed: ctx.speed}
      }

      // Leaving pavement: glide along shallow road-edge angles; high-speed curb jumps destabilize.
      const wasOnPavement = onPavement
      if (onPavement) {
        const mx = ctx.next.x - ctx.pos.x, mz = ctx.next.z - ctx.pos.z, mLen = Math.hypot(mx, mz)
        const safeAt = (sx: number, sz: number) =>
          ctx.pavement(sx, sz)
          && !ctx.insideHouse(sx + fwdX * sign * .72, sz + fwdZ * sign * .72)
          && !ctx.blockedAt(sx, ctx.pos.y, sz)

        const canX = mLen > 1e-6 && Math.abs(mx) >= mLen * .45 && safeAt(ctx.next.x, ctx.pos.z)
        const canZ = mLen > 1e-6 && Math.abs(mz) >= mLen * .45 && safeAt(ctx.pos.x, ctx.next.z)
        if (canX && (!canZ || Math.abs(mx) >= Math.abs(mz))) {
          ctx.next.z = ctx.pos.z
          return {blocked: false, reason: '', speed: ctx.dampBike(ctx.step * .5)}
        }
        if (canZ) {
          ctx.next.x = ctx.pos.x
          return {blocked: false, reason: '', speed: ctx.dampBike(ctx.step * .5)}
        }

        let inX = 0, inZ = 0
        for (const ox of [-4, 0, 4]) for (const oz of [-4, 0, 4]) {
          if ((ox || oz) && ctx.pavement(ctx.next.x + ox, ctx.next.z + oz)) {
            inX += ox; inZ += oz
          }
        }
        const inLen = Math.hypot(inX, inZ)
        if (inLen > 1e-4 && mLen > 1e-6) {
          const nx = inX / inLen, nz = inZ / inLen
          const outDot = mx * nx + mz * nz
          if (-outDot <= mLen * .82) {
            let tx = outDot < 0 ? mx - outDot * nx : mx
            let tz = outDot < 0 ? mz - outDot * nz : mz
            tx += nx * mLen * .35; tz += nz * mLen * .35
            const sx = ctx.pos.x + tx, sz = ctx.pos.z + tz
            if (safeAt(sx, sz)) {
              ctx.next.x = sx; ctx.next.z = sz
              return {blocked: false, reason: '', speed: ctx.dampBike(ctx.step * .5)}
            }
          }
        }
      }

      onPavement = false
      offRoadSurface = true
      if (wasOnPavement && preSpeed >= s.crash.offRoadShockMs && (preLean >= .18 || Math.abs(steerInput) > .35) && canAutoCrash()) {
        triggerCrash('lowside', lean > 0 ? -1 : 1)
        return {blocked: true, reason: 'crashed', speed: 0}
      }
      return {blocked: false, reason: '', speed: ctx.capOffRoad(ctx.step, s.offRoadCap || OFF_ROAD_CAP)}
    },
  }
}

function solvePedalIK(phase: number): [number, number] {
  const dy = (.33 + .15 * Math.cos(phase)) - .88
  const dz = (.05 - .15 * Math.sin(phase)) - .23
  const d = T.MathUtils.clamp(Math.hypot(dy, dz), .24, .88)
  const alpha = Math.atan2(-dz, -dy)
  const L1 = .45, L2 = .45
  const cosKnee = T.MathUtils.clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1)
  const beta = Math.acos(T.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1))
  return [alpha + beta, -(Math.PI - Math.acos(cosKnee))]
}

/** Handles smooth mount, dynamic rider joint pose (ebike wheelie/tuck/lean + bicycle crank IK), and step-off / crash pose helpers. */
export function createRiderPose(figure: T.Group) {
  const joints = Object.fromEntries(JOINT_NAMES.map(name => [name, figure.getObjectByName(name)])) as Record<JointName, T.Object3D | undefined>
  const startPos = new T.Vector3(), startRot = new Map<JointName, [number, number, number]>()
  const dismountFrom = new T.Vector3(), dismountStartRot = new Map<JointName, [number, number, number]>()
  let startYaw = 0, dismountFromYaw = 0, mountElapsed = bcfg.mountDuration, dismountElapsed = bcfg.dismountDuration, camArmOffset = 0
  let footWeight = 1, pedalPhase = 0

  function clearJoints() {
    for (const name of JOINT_NAMES) joints[name]?.rotation.set(0, 0, 0)
  }

  function applySeatedPose(speed: number, steerInput: number, blend: number, dt: number, kind: RideKind, wheelieRad = 0, tucking = false) {
    const cdt = Math.min(.12, Math.max(0, dt))
    const idleFoot = smoothstep((.35 - Math.abs(speed)) / .35)
    footWeight = T.MathUtils.damp(footWeight, idleFoot, 10, cdt)
    const leanMag = Math.abs(steerInput)
    const tuckAmt = tucking ? 1 : 0
    let targets: Record<JointName, [number, number, number]>
    if (kind === 'bicycle') {
      const spdRatio = Math.max(0, speed) / bicycleConfig.maxSpeed
      const [thighLPedal, shinLPedal] = solvePedalIK(pedalPhase)
      const [thighRPedal, shinRPedal] = solvePedalIK(pedalPhase + Math.PI)
      const cadenceSway = (1 - footWeight) * Math.sin(pedalPhase) * .035 * T.MathUtils.clamp(Math.abs(speed) / 2.5, 0, 1)
      const insideKneeL = steerInput < -.15 && tucking ? -.35 * Math.min(1, leanMag) : 0
      const insideKneeR = steerInput > .15 && tucking ? .35 * Math.min(1, leanMag) : 0
      targets = {
        ThighL: [T.MathUtils.lerp(thighLPedal, .52, footWeight), 0, T.MathUtils.lerp(insideKneeL, -.20, footWeight)],
        ShinL: [T.MathUtils.lerp(shinLPedal, -.50, footWeight), 0, 0],
        ThighR: [thighRPedal, 0, T.MathUtils.lerp(insideKneeR, 0, footWeight)],
        ShinR: [shinRPedal, 0, 0],
        ArmL: [.86 + steerInput * .16 - wheelieRad * .25, -steerInput * .12, 0],
        ArmR: [.86 - steerInput * .16 - wheelieRad * .25, -steerInput * .12, 0],
        ForearmL: [.32 + wheelieRad * .42 + tuckAmt * .20, 0, 0],
        ForearmR: [.32 + wheelieRad * .42 + tuckAmt * .20, 0, 0],
        Torso: [-.14 - spdRatio * .08 - tuckAmt * .22 + wheelieRad * .35, cadenceSway * .5, cadenceSway],
        Head: [.05 + tuckAmt * .14 - wheelieRad * .32, -steerInput * .20, 0],
      }
    } else {
      const spdRatio = Math.max(0, speed) / bcfg.maxSpeed
      const insideKneeL = steerInput < -.15 && tucking ? -.38 * Math.min(1, leanMag) : 0
      const insideKneeR = steerInput > .15 && tucking ? .38 * Math.min(1, leanMag) : 0
      targets = {
        ThighL: [T.MathUtils.lerp(1.25, .56, footWeight), 0, T.MathUtils.lerp(insideKneeL, -.22, footWeight)],
        ShinL: [T.MathUtils.lerp(-1.4, -.55, footWeight), 0, 0],
        ThighR: [1.25, 0, T.MathUtils.lerp(insideKneeR, 0, footWeight)],
        ShinR: [-1.4, 0, 0],
        ArmL: [.9 + steerInput * .16 - wheelieRad * .28, -steerInput * .12, 0],
        ArmR: [.9 - steerInput * .16 - wheelieRad * .28, -steerInput * .12, 0],
        ForearmL: [.35 + wheelieRad * .45 + tuckAmt * .20, 0, 0],
        ForearmR: [.35 + wheelieRad * .45 + tuckAmt * .20, 0, 0],
        Torso: [-.09 - spdRatio * .06 - tuckAmt * .22 + wheelieRad * .38, 0, 0],
        Head: [tuckAmt * .14 - wheelieRad * .35, -steerInput * .20, 0],
      }
    }
    for (const name of JOINT_NAMES) {
      const joint = joints[name]
      if (!joint) continue
      const [tx, ty, tz] = targets[name]
      if (blend < 1) {
        const from = startRot.get(name) ?? [0, 0, 0]
        joint.rotation.set(
          T.MathUtils.lerp(from[0], tx, blend),
          T.MathUtils.lerp(from[1], ty, blend),
          T.MathUtils.lerp(from[2], tz, blend),
        )
      } else {
        joint.rotation.set(tx, ty, tz)
      }
    }
  }

  return {
    get mounted() { return mountElapsed >= bcfg.mountDuration },
    get pedalPhase() { return pedalPhase },
    startMount(footPos: {x:number; y:number; z:number}, yawYaw: number) {
      startPos.set(footPos.x, footPos.y, footPos.z)
      startYaw = yawYaw
      mountElapsed = 0
      dismountElapsed = bcfg.dismountDuration
      footWeight = 1
      pedalPhase = 0
      for (const name of JOINT_NAMES) {
        const r = joints[name]?.rotation
        startRot.set(name, r ? [r.x, r.y, r.z] : [0, 0, 0])
      }
    },
    startDismount(prevVisualPos: T.Vector3, prevVisualYaw: number) {
      dismountFrom.copy(prevVisualPos)
      dismountFromYaw = prevVisualYaw
      dismountElapsed = 0
      mountElapsed = bcfg.mountDuration
      figure.rotation.x = figure.rotation.z = 0
      for (const name of JOINT_NAMES) {
        const r = joints[name]?.rotation
        dismountStartRot.set(name, r ? [r.x, r.y, r.z] : [0, 0, 0])
      }
    },
    reset() {
      mountElapsed = bcfg.mountDuration
      dismountElapsed = bcfg.dismountDuration
      camArmOffset = 0
      pedalPhase = 0
      figure.rotation.x = figure.rotation.z = 0
      clearJoints()
    },
    advanceMount(dt: number) {
      if (mountElapsed < bcfg.mountDuration) mountElapsed = Math.min(bcfg.mountDuration, mountElapsed + Math.max(0, dt))
    },
    cameraArm(riding: boolean, dt: number, snap: boolean) {
      const target = riding ? 2.6 : 0
      if (snap && dt <= 0) camArmOffset = target
      else camArmOffset = T.MathUtils.damp(camArmOffset, target, riding ? 12 : 10, Math.min(.12, Math.max(0, dt)))
      return camArmOffset
    },
    updateRiding(
      bikePos: T.Vector3,
      heading: number,
      lean: number,
      pitch: number,
      speed: number,
      steerInput: number,
      dt: number,
      kind: RideKind = 'bike',
      bikeMesh?: T.Object3D | null,
      wheelieRad = 0,
      tucking = false,
    ) {
      const cdt = Math.min(.12, Math.max(0, dt))
      if (kind === 'bicycle') {
        pedalPhase = (pedalPhase + (speed / .33) * cdt * .48) % (Math.PI * 2)
        if (pedalPhase < 0) pedalPhase += Math.PI * 2
        const crank = bikeMesh?.getObjectByName('Crank')
        if (crank) crank.rotation.x = -pedalPhase
      }
      const t = smoothstep(mountElapsed / bcfg.mountDuration)
      const seatOffset = kind === 'bicycle' ? .22 : .23
      const seatLift = kind === 'bicycle' ? .035 : 0
      const seatX = bikePos.x + Math.sin(heading) * seatOffset
      const seatZ = bikePos.z + Math.cos(heading) * seatOffset
      const seatY = bikePos.y + seatLift - Math.sin(wheelieRad) * .22
      const swing = t < 1 ? Math.sin(t * Math.PI) : 0
      if (t < 1) {
        figure.position.set(
          T.MathUtils.lerp(startPos.x, seatX, t),
          T.MathUtils.lerp(startPos.y, seatY, t) + swing * .18,
          T.MathUtils.lerp(startPos.z, seatZ, t),
        )
        figure.rotation.set(0, startYaw + shortestAngle(startYaw, heading) * t, -swing * .10, 'YXZ')
      } else {
        figure.position.set(seatX, seatY, seatZ)
        figure.rotation.set(pitch * .45 + wheelieRad * .55, heading, lean * .9, 'YXZ')
      }
      applySeatedPose(speed, steerInput, t, dt, kind, wheelieRad, tucking)
      if (swing > 1e-4) {
        if (joints.ThighR) {
          joints.ThighR.rotation.x += swing * .35
          joints.ThighR.rotation.z -= swing * .55
        }
        if (joints.ShinR) joints.ShinR.rotation.x -= swing * .30
        if (joints.Torso) joints.Torso.rotation.x -= swing * .14
      }
    },
    /** Applies visual pose during downed / rider-gets-up-first / bike-pickup phases for external render loops. */
    applyCrashPhasePose(snap: TwoWheelCrashSnapshot) {
      if (snap.phase === 'none' || snap.phase === 'bike_down') {
        figure.rotation.x = figure.rotation.z = 0
        clearJoints()
        return
      }
      if (snap.phase === 'sliding' || snap.phase === 'downed') {
        figure.position.set(snap.riderPos.x, snap.riderPos.y + .18, snap.riderPos.z)
        figure.rotation.set(-.95, snap.riderYaw - snap.side * .35, snap.side * 1.15, 'YXZ')
        if (joints.ThighL) joints.ThighL.rotation.set(.45, 0, -.18)
        if (joints.ThighR) joints.ThighR.rotation.set(.68, 0, .24)
        if (joints.ShinL) joints.ShinL.rotation.set(-.55, 0, 0)
        if (joints.ShinR) joints.ShinR.rotation.set(-.82, 0, 0)
        if (joints.ArmL) joints.ArmL.rotation.set(1.25, 0, -.32)
        if (joints.ArmR) joints.ArmR.rotation.set(.95, 0, .42)
        if (joints.Torso) joints.Torso.rotation.set(.18, 0, 0)
        return
      }
      if (snap.phase === 'rider_rising') {
        const up = smoothstep(snap.riderStandProgress)
        const fallRoll = snap.side * 1.15 * (1 - up)
        const fallPitch = -.95 * (1 - up)
        const kneelDip = Math.sin(up * Math.PI) * .28
        figure.position.set(snap.riderPos.x, snap.riderPos.y + .18 * (1 - up), snap.riderPos.z)
        figure.rotation.set(fallPitch, snap.riderYaw - snap.side * .35 * (1 - up), fallRoll, 'YXZ')
        if (joints.ThighL) joints.ThighL.rotation.set((.45 + kneelDip) * (1 - up), 0, -.18 * (1 - up))
        if (joints.ThighR) joints.ThighR.rotation.set((.68 + kneelDip * 1.3) * (1 - up), 0, .24 * (1 - up))
        if (joints.ShinL) joints.ShinL.rotation.set((-.55 - kneelDip * 1.4) * (1 - up), 0, 0)
        if (joints.ShinR) joints.ShinR.rotation.set((-.82 - kneelDip * 1.5) * (1 - up), 0, 0)
        if (joints.ArmL) joints.ArmL.rotation.set(1.25 * (1 - up), 0, -.32 * (1 - up))
        if (joints.ArmR) joints.ArmR.rotation.set(.95 * (1 - up), 0, .42 * (1 - up))
        if (joints.Torso) joints.Torso.rotation.set(.18 * (1 - up) - kneelDip * .5, 0, 0)
        return
      }
      if (snap.phase === 'picking_up') {
        const lift = smoothstep(snap.pickupProgress)
        const bend = Math.sin(lift * Math.PI)
        figure.position.set(snap.pickupSpot.x, snap.pickupSpot.y, snap.pickupSpot.z)
        figure.rotation.set(0, snap.pickupSpot.yaw, 0, 'YXZ')
        if (joints.Torso) joints.Torso.rotation.set(-.55 * bend, 0, 0)
        if (joints.ThighL) joints.ThighL.rotation.set(.42 * bend, 0, 0)
        if (joints.ThighR) joints.ThighR.rotation.set(.32 * bend, 0, 0)
        if (joints.ShinL) joints.ShinL.rotation.set(-.58 * bend, 0, 0)
        if (joints.ShinR) joints.ShinR.rotation.set(-.45 * bend, 0, 0)
        if (joints.ArmL) joints.ArmL.rotation.set(1.05 * bend, 0, 0)
        if (joints.ArmR) joints.ArmR.rotation.set(1.05 * bend, 0, 0)
      }
    },
    applyDismount(currentFootPos: T.Vector3, targetYaw: number, dt: number) {
      if (dismountElapsed >= bcfg.dismountDuration) return
      if (dt > 0) dismountElapsed = Math.min(bcfg.dismountDuration, dismountElapsed + Math.min(.12, dt))
      const t = smoothstep(dismountElapsed / bcfg.dismountDuration)
      figure.position.lerpVectors(dismountFrom, currentFootPos, t)
      figure.position.y += Math.sin(t * Math.PI) * .12
      figure.rotation.y = dismountFromYaw + shortestAngle(dismountFromYaw, targetYaw) * t
      if (t >= 1) {
        clearJoints()
      } else {
        for (const name of JOINT_NAMES) {
          const joint = joints[name]
          if (!joint) continue
          const from = dismountStartRot.get(name) ?? [0, 0, 0]
          joint.rotation.set(from[0] * (1 - t), from[1] * (1 - t), from[2] * (1 - t))
        }
      }
    },
    clearJoints,
  }
}
