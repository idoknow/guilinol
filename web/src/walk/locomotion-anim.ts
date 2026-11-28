import * as THREE from 'three'
import type {AvatarRig} from './avatar-rig'

/**
 * IDOK-602 · Procedural run / jump layer for the creator avatar (figure_m / figure_f).
 *
 * The layer sits between `mixer.update()` and every later pose layer (camera hold, smoke, emote,
 * ticket, combat). Each frame it snapshots the mixer's local bone values, solves a full-body pose in
 * character space, and slerps toward it by a smoothed weight. `reset()` puts the snapshot back
 * (LIFO with the other layers). Idle and crouch fade the weight to 0, so the authored clips stay in
 * full control there and the idle sole-contact asserts are untouched.
 *
 * Space conventions (shared with avatar-rig.ts):
 * - "Character space" is the CreatorProportions frame: forward −Z, up +Y, left −X. Rotations are
 *   pure quaternion products below it, so they ignore the creator's non-uniform body scale.
 * - Lengths in poses and metrics are rig-local metres (CP units). World speed is divided by the
 *   CP→world forward scale, so planted feet move back at exactly the ground speed.
 * - Hanging limbs swing forward with +rx. Upright bones lean forward with −rx. +ry turns left.
 *   +rz tilts an upright bone to the left. Feet dorsiflex with +rx.
 */

export type LocomotionBody = 'm' | 'f'
export type LocomotionGait = 'idle' | 'walk' | 'run' | 'sprint'
export type JumpPhase = 'none' | 'takeoff' | 'rise' | 'apex' | 'fall' | 'land'
/** Value knots at [walk, run, sprint]. Blended by runness and then sprintness. */
export type GaitTri = readonly [walk: number, run: number, sprint: number]

export interface LocomotionProfile {
  /** Cadence multiplier over the shared table. The f/m ratio is about 1.13. */
  cadence: number
  /** Run stance-length multiplier (world metres). The skirt keeps the female stride shorter. */
  runStride: number
  /** Total forward lean in radians (negative is forward). Split 35% to the pelvis, 65% to the torso. */
  lean: GaitTri
  pelvisYaw: GaitTri
  /** Absolute chest counter-rotation against the pelvis. */
  chestYaw: GaitTri
  /** Swing-side pelvis drop. */
  pelvisRoll: GaitTri
  /** Fraction of the pelvis roll the torso cancels, keeping the shoulders level. */
  shoulderLevel: number
  /** Lateral pelvis shift over the stance leg (CP units). */
  sway: GaitTri
  /** How far the foot line sits inside the hip line (CP units). */
  footIn: GaitTri
  /** Vertical bob amplitude. Walk uses a double-peak vault; run/sprint use a single compression per step. */
  bob: GaitTri
  /** Base pelvis lowering (knee bend) per gait. */
  sink: GaitTri
  /** Peak lift of the swing ankle (heel recovery / toe clearance). */
  lift: GaitTri
  /** Swing-leg thigh limits (rad). The female values keep the skirt hem from tearing. */
  thighFwdMax: number
  thighBackMin: number
  splitMax: number
  armMean: GaitTri
  armSwing: GaitTri
  elbow: GaitTri
  elbowSwing: GaitTri
  /** Upper-arm abduction away from the body. */
  armAbduct: GaitTri
  /** Humeral internal rotation, which carries the bent forearm in toward the chest. */
  forearmIn: GaitTri
  /** Shoulder protraction/retraction that follows the arm swing. */
  clavicle: GaitTri
  fingerCurl: GaitTri
  thumbCurl: GaitTri
  headStabilise: number
  /** Jump knee-drive and arm-lift scale. */
  jumpPower: number
  /** Arm opening in the air (abduction scale). */
  jumpArmsOpen: number
  /** Takeoff duration in seconds. */
  takeoff: number
  landDepth: number
  landTorso: number
  /** Landing duration scale (f is lighter and quicker). */
  landTime: number
}

export const LOCOMOTION_PROFILES: Readonly<Record<LocomotionBody, LocomotionProfile>> = {
  // Male: athletic, broad-shouldered, powerful drive. Longer stride, lower cadence, deeper sprint lean,
  // wide upper arms with strong full-arc swing (hands outside midline), steady pelvis, decisive chest counter-twist.
  m: {
    cadence: 0.92, runStride: 1.04,
    lean: [-0.05, -0.20, -0.38], pelvisYaw: [0.08, 0.13, 0.16], chestYaw: [0.10, 0.23, 0.29],
    pelvisRoll: [0.03, 0.038, 0.035], shoulderLevel: 0.76, sway: [0.010, 0.007, 0.005], footIn: [0.020, 0.036, 0.042],
    bob: [0.018, 0.035, 0.027], sink: [0.01, 0.036, 0.058], lift: [0.075, 0.22, 0.30],
    thighFwdMax: 1.24, thighBackMin: -0.88, splitMax: 2.08,
    armMean: [0.0, -0.02, -0.04], armSwing: [0.30, 0.76, 0.98], elbow: [0.28, 1.44, 1.54], elbowSwing: [0.14, 0.26, 0.30],
    armAbduct: [0.11, 0.24, 0.28], forearmIn: [0.02, 0.05, 0.04], clavicle: [0.025, 0.06, 0.085],
    fingerCurl: [0.30, 0.80, 1.0], thumbCurl: [0.28, 0.82, 1.0], headStabilise: 0.82,
    jumpPower: 1.04, jumpArmsOpen: 1, takeoff: 0.11, landDepth: 1, landTorso: 0.56, landTime: 1,
  },
  // Female: light, agile, refined posture. Higher cadence (+18.5%), crisp compact stride (protects skirt),
  // more upright torso, upper arms close to torso (clearing hip on backswing), forearms gently carried inward
  // toward chest on upswing, soft hip-shoulder counter-flow. Authentic and graceful, never exaggerated.
  f: {
    cadence: 1.09, runStride: 0.84,
    lean: [-0.02, -0.09, -0.17], pelvisYaw: [0.12, 0.17, 0.20], chestYaw: [0.08, 0.15, 0.19],
    pelvisRoll: [0.065, 0.078, 0.068], shoulderLevel: 0.48, sway: [0.022, 0.017, 0.014], footIn: [0.040, 0.054, 0.058],
    bob: [0.016, 0.030, 0.022], sink: [0.008, 0.028, 0.044], lift: [0.062, 0.18, 0.24],
    thighFwdMax: 1.02, thighBackMin: -0.62, splitMax: 1.44,
    armMean: [0.02, 0.02, 0.0], armSwing: [0.22, 0.50, 0.66], elbow: [0.34, 1.38, 1.44], elbowSwing: [0.10, 0.24, 0.28],
    armAbduct: [0.045, 0.075, 0.09], forearmIn: [0.16, 0.44, 0.42], clavicle: [0.03, 0.068, 0.08],
    fingerCurl: [0.26, 0.72, 0.94], thumbCurl: [0.26, 0.74, 0.94], headStabilise: 0.86,
    jumpPower: 0.9, jumpArmsOpen: 0.78, takeoff: 0.1, landDepth: 0.88, landTorso: 0.44, landTime: 0.95,
  },
}

/** Gait label thresholds in world m/s. They are only used for the debug label; all curves blend continuously. */
export const GAIT_SPEEDS = {idle: 0.12, run: 2.4, sprint: 6.4, max: 9.5} as const

// Shared walk table (world m/s → steps/s, duty factor). Running derives duty from stance length.
const WALK_SPEED = [0.3, 0.8, 1.2, 1.65, 2.4] as const
// Tuned to the rig's reach. About 0.82 m of stance travel at 1.65 m/s keeps the heel-strike knee nearly straight and
// the toe-off pelvis dip within about 1 cm of the designed vault.
const WALK_CADENCE = [1.5, 1.82, 2.03, 2.26, 2.55] as const
const WALK_DUTY = [0.64, 0.6, 0.57, 0.53, 0.5] as const
/**
 * Foot-roll and swing-path shape per [walk, run, sprint] (shared by both bodies):
 * strike/mid/toeOff are foot pitches (walk heel strike → sprint forefoot strike), flatAt/heelOffAt are stance
 * fractions, tanOut/tanIn are the Hermite tangents (heel recovery / claw-back) as fractions of the swing span,
 * and liftSkew moves the lift peak earlier.
 */
const FOOT = {
  frontFrac: [0.38, 0.28, 0.25], strike: [0.28, 0.06, -0.16], mid: [0, -0.01, -0.07], toeOff: [-0.88, -1.02, -1.08],
  flatAt: [0.16, 0.14, 0.12], heelOffAt: [0.50, 0.36, 0.28], swing: [0.08, -0.16, -0.26],
  tanOut: [0.25, 0.48, 0.58], tanIn: [0.05, 0.56, 0.82], liftSkew: [0.22, 0.28, 0.32],
} as const satisfies Record<string, GaitTri>

const TAU = Math.PI * 2
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smooth01 = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t
  return x * x * (3 - 2 * x)
}
const smoothstep = (a: number, b: number, v: number) => smooth01((v - a) / (b - a))
const tri = (t: GaitTri, r: number, q: number) => lerp(lerp(t[0], t[1], r), t[2], q)
const damp = (x: number, target: number, rate: number, dt: number) => x + (target - x) * (1 - Math.exp(-rate * dt))
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
/** Polynomial smooth-min: continuous and C1, so the pelvis never kinks when a reach limit engages. */
function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}
function knots(xs: readonly number[], ys: readonly number[], x: number) {
  if (x <= xs[0]) return ys[0]
  const n = xs.length - 1
  if (x >= xs[n]) return ys[n]
  for (let i = 1; i <= n; i++) {
    if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1])
  }
  return ys[n]
}

// ───────────────────────────── gait parameters (pure) ─────────────────────────────

export interface GaitSample {
  speed: number
  /** Runness (0 walk → 1 run) and sprintness (0 run → 1 sprint). */
  r: number
  q: number
  /** Stride amount (0 at a standstill), so pitches and lifts fade out when slowing. */
  amount: number
  /** Steps per second. */
  cadence: number
  /** Fraction of the cycle each foot is planted. >0.5 gives double support, <0.5 gives a flight phase. */
  duty: number
  /** Distance the planted foot travels under the hip during stance (CP units). */
  stance: number
  frontFrac: number
  pitchStrike: number
  pitchMid: number
  pitchToe: number
  flatAt: number
  heelOffAt: number
  pitchSwing: number
  tanOut: number
  tanIn: number
  liftSkew: number
  lift: number
  footIn: number
  sway: number
  bobWalk: number
  bobRun: number
  sinkWalk: number
  sinkRun: number
  pelvisYaw: number
  chestYaw: number
  pelvisRoll: number
  lean: number
  armMean: number
  armSwing: number
  armLag: number
  elbow: number
  elbowSwing: number
  abduct: number
  forearmIn: number
  clavicle: number
  curl: number
  thumb: number
}

export function createGaitSample(): GaitSample {
  return {
    speed: 0, r: 0, q: 0, amount: 0, cadence: 0, duty: 0.6, stance: 0, frontFrac: 0.3,
    pitchStrike: 0, pitchMid: 0, pitchToe: 0, flatAt: 0.16, heelOffAt: 0.5, pitchSwing: 0,
    tanOut: 0, tanIn: 0, liftSkew: 0, lift: 0, footIn: 0, sway: 0, bobWalk: 0, bobRun: 0, sinkWalk: 0, sinkRun: 0,
    pelvisYaw: 0, chestYaw: 0, pelvisRoll: 0, lean: 0, armMean: 0, armSwing: 0, armLag: 0, elbow: 0, elbowSwing: 0,
    abduct: 0, forearmIn: 0, clavicle: 0, curl: 0, thumb: 0,
  }
}

/**
 * Speed → gait parameters. Stance length is always `2·speed·duty/cadence`, so the planted foot moves back
 * at exactly the ground speed at every blend between walk, run and sprint (no foot skating from the model).
 */
export function sampleGait(profile: LocomotionProfile, speed: number, worldScale: number, out: GaitSample): GaitSample {
  const s = Math.max(0, speed)
  const r = smoothstep(1.9, 2.9, s), q = smoothstep(5.4, 8.4, s)
  const amount = smoothstep(0.04, 0.9, s)
  const sr = clamp(s, 2.4, GAIT_SPEEDS.max)
  const cadWalk = knots(WALK_SPEED, WALK_CADENCE, s) * profile.cadence
  const cadRun = (2.55 + (sr - 2.4) * 0.175) * profile.cadence
  // Run stance travel (world m): 0.66 at a 2.4 m/s jog → 0.83 at a 9 m/s sprint. Duty 0.33 → 0.16 (sprint contact ≈ 0.09 s).
  const runLen = (0.6 + 0.026 * sr) * profile.runStride
  const dutyRun = clamp((runLen * cadRun) / (2 * sr), 0.16, 0.46)
  const cadence = lerp(cadWalk, cadRun, r)
  const duty = lerp(knots(WALK_SPEED, WALK_DUTY, s), dutyRun, r)
  out.speed = s
  out.r = r
  out.q = q
  out.amount = amount
  out.cadence = cadence
  out.duty = duty
  out.stance = (2 * s * duty) / cadence / Math.max(0.2, worldScale)
  out.frontFrac = tri(FOOT.frontFrac, r, q)
  out.pitchStrike = lerp(lerp(FOOT.strike[0] * smoothstep(0.15, 1.3, s), FOOT.strike[1], r), FOOT.strike[2], q)
  out.pitchMid = tri(FOOT.mid, r, q) * amount
  out.pitchToe = tri(FOOT.toeOff, r, q) * amount
  out.flatAt = tri(FOOT.flatAt, r, q)
  out.heelOffAt = tri(FOOT.heelOffAt, r, q)
  out.pitchSwing = tri(FOOT.swing, r, q) * amount
  out.tanOut = tri(FOOT.tanOut, r, q)
  out.tanIn = tri(FOOT.tanIn, r, q)
  out.liftSkew = tri(FOOT.liftSkew, r, q)
  const liftWalk = profile.lift[0] * Math.max(smoothstep(0.05, 1.2, s), 0.25 * amount)
  const liftRun = lerp(profile.lift[1] * lerp(0.62, 1, smoothstep(2.4, 6, s)), profile.lift[2], q)
  out.lift = lerp(liftWalk, liftRun, r)
  out.footIn = tri(profile.footIn, r, q)
  out.sway = tri(profile.sway, r, q)
  out.bobWalk = profile.bob[0] * smoothstep(0.2, 1.65, s)
  out.bobRun = lerp(profile.bob[1], profile.bob[2], q)
  out.sinkWalk = profile.sink[0] * smoothstep(0.2, 1.65, s)
  out.sinkRun = lerp(profile.sink[1], profile.sink[2], q)
  out.pelvisYaw = tri(profile.pelvisYaw, r, q) * lerp(smoothstep(0.1, 1.4, s), 1, r)
  out.chestYaw = tri(profile.chestYaw, r, q) * lerp(smoothstep(0.1, 1.4, s), 1, r)
  out.pelvisRoll = tri(profile.pelvisRoll, r, q) * amount
  out.lean = tri(profile.lean, r, q) * smoothstep(0.1, 1.6, s)
  out.armMean = tri(profile.armMean, r, q)
  out.armSwing = tri(profile.armSwing, r, q) * lerp(smoothstep(0.05, 1.65, s), 1, r)
  out.armLag = lerp(0.03, -0.05, r)
  out.elbow = lerp(0.12, tri(profile.elbow, r, q), amount)
  out.elbowSwing = tri(profile.elbowSwing, r, q) * amount
  out.abduct = tri(profile.armAbduct, r, q)
  out.forearmIn = tri(profile.forearmIn, r, q)
  out.clavicle = tri(profile.clavicle, r, q)
  out.curl = tri(profile.fingerCurl, r, q)
  out.thumb = tri(profile.thumbCurl, r, q)
  return out
}

// ───────────────────────────── rig metrics ─────────────────────────────

export interface Vec3Like {
  x: number
  y: number
  z: number
}

/** Rest geometry in character space (CP units). Index 0 is left, 1 is right. */
export interface LocomotionMetrics {
  pelvis: Vec3Like
  hip: readonly [Vec3Like, Vec3Like]
  ankle: readonly [Vec3Like, Vec3Like]
  ball: readonly [Vec3Like, Vec3Like]
  /** Rearmost sole probe of each foot: the heel-strike pivot. */
  heel: readonly [Vec3Like, Vec3Like]
  thighLen: [number, number]
  shinLen: [number, number]
  /** Rest sagittal angles from vertical (+ is forward). */
  thighRest: [number, number]
  shinRest: [number, number]
  ground: number
}

function v3(x: number, y: number, z: number): Vec3Like {
  return {x, y, z}
}

/** Defaults measured from the figure_m / figure_f GLB rest pose (the skeletons are identical; only CreatorProportions differs). */
export const DEFAULT_LOCOMOTION_METRICS: LocomotionMetrics = ((): LocomotionMetrics => {
  const side = (sx: number) => ({
    hip: v3(-0.089 * sx, 0.932, -0.0014),
    knee: v3(-0.089 * sx, 0.5259, -0.0193),
    ankle: v3(-0.089 * sx, 0.0979, 0.0482),
    ball: v3(-0.089 * sx, 0.0152, -0.1132),
    heel: v3(-0.089 * sx, 0.012, 0.114),
  })
  const l = side(1), r = side(-1)
  const len = (a: Vec3Like, b: Vec3Like) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
  const ang = (a: Vec3Like, b: Vec3Like) => Math.atan2(-(b.z - a.z), -(b.y - a.y))
  return {
    pelvis: v3(0, 0.9166, 0.0501),
    hip: [l.hip, r.hip], ankle: [l.ankle, r.ankle], ball: [l.ball, r.ball], heel: [l.heel, r.heel],
    thighLen: [len(l.hip, l.knee), len(r.hip, r.knee)], shinLen: [len(l.knee, l.ankle), len(r.knee, r.ankle)],
    thighRest: [ang(l.hip, l.knee), ang(r.hip, r.knee)], shinRest: [ang(l.knee, l.ankle), ang(r.knee, r.ankle)],
    ground: 0.004,
  }
})()

// ───────────────────────────── pose state & output ─────────────────────────────

/** Per-frame solver input. The driver owns one instance and mutates it. */
export interface LocomotionState {
  /** Damped animation speed, world m/s. */
  speed: number
  /** Stride phase in [0,1). The left foot strikes at 0, the right at 0.5. */
  phase: number
  /** CP → world scale along the facing axis. */
  worldScale: number
  turnRoll: number
  accelPitch: number
  /** Air-pose weight 0..1. */
  air: number
  jumped: boolean
  jumpTime: number
  vy: number
  /** 0 = standing jump, 1 = running jump (stride split kept). */
  runJump: number
  leadLeft: boolean
  /** Fall alertness 0..1 (long, fast drops). */
  alert: number
  /** Landing compression curve value. It peaks at 1 and dips slightly below 0 on the rebound. */
  land: number
  /** Smooth bell envelope over the standing-landing recovery arc (keeps knees & arms elastic through rebound). */
  landRecov: number
  landDepth: number
  landMoving: number
}

export function createLocomotionState(): LocomotionState {
  return {
    speed: 0, phase: 0, worldScale: 1, turnRoll: 0, accelPitch: 0, air: 0, jumped: false, jumpTime: 0, vy: 0,
    runJump: 0, leadLeft: false, alert: 0, land: 0, landRecov: 0, landDepth: 0, landMoving: 0,
  }
}

export interface LegPose {
  /** Thigh and shin sagittal angles from vertical (+ forward). */
  thigh: number
  shin: number
  /** Absolute foot pitch relative to rest (+ dorsiflex). */
  foot: number
  /** Toe (ball bone) bend relative to the foot. */
  toe: number
  /** Leg-plane tilt about Z (+ moves the foot toward +X). */
  tilt: number
  /** 1 = planted / weight-bearing, 0 = free swing. */
  contact: number
  ankleX: number
  ankleY: number
  ankleZ: number
}

export interface ArmPose {
  /** Shoulder flexion (+ forward). */
  swing: number
  abduct: number
  /** Humeral internal rotation (+ carries the forearm toward the midline). */
  twist: number
  elbow: number
  /** Shoulder protraction (+ forward). */
  clavicle: number
}

export interface LocomotionPose {
  pelvisX: number
  pelvisY: number
  pelvisZ: number
  pelvisPitch: number
  pelvisYaw: number
  pelvisRoll: number
  torsoPitch: number
  torsoYaw: number
  torsoRoll: number
  headPitch: number
  headYaw: number
  headRoll: number
  curl: number
  thumb: number
  legs: [LegPose, LegPose]
  arms: [ArmPose, ArmPose]
}

const newLeg = (): LegPose => ({thigh: 0, shin: 0, foot: 0, toe: 0, tilt: 0, contact: 1, ankleX: 0, ankleY: 0, ankleZ: 0})
const newArm = (): ArmPose => ({swing: 0, abduct: 0, twist: 0, elbow: 0, clavicle: 0})

export function createLocomotionPose(): LocomotionPose {
  return {
    pelvisX: 0, pelvisY: 0, pelvisZ: 0, pelvisPitch: 0, pelvisYaw: 0, pelvisRoll: 0,
    torsoPitch: 0, torsoYaw: 0, torsoRoll: 0, headPitch: 0, headYaw: 0, headRoll: 0, curl: 0, thumb: 0,
    legs: [newLeg(), newLeg()], arms: [newArm(), newArm()],
  }
}

/** Discrete jump-phase label (used for debug). The solver itself blends phases continuously. */
export function resolveJumpPhase(airborne: boolean, jumped: boolean, jumpTime: number, vy: number, landing: boolean, takeoff = 0.1): JumpPhase {
  if (airborne) {
    if (jumped && jumpTime < takeoff && vy > 0) return 'takeoff'
    if (vy > 1.6) return 'rise'
    if (vy < -1.6) return 'fall'
    return 'apex'
  }
  return landing ? 'land' : 'none'
}

/**
 * Landing response: an underdamped impulse (ζ≈0.55) normalised to peak 1. The peak lands at ~23% of the
 * duration, holds a controlled elastic recovery through ~72%, then gives a gentle rebound overshoot (~10%)
 * before tapering smoothly to 0 at `duration` (avoiding a stiff mid-recovery snap to attention).
 */
export function landingCurve(t: number, duration: number) {
  if (t <= 0 || t >= duration) return 0
  const tau = (Math.PI / (0.72 * duration)) * t
  return ((Math.exp(-0.6587 * tau) * Math.sin(tau)) / 0.4357) * (1 - smoothstep(0.84 * duration, duration, t))
}

// Air keyframes per leg as [thigh, knee flex, foot pitch relative to the shin].
// S = standing jump (slight natural stagger), R = running jump (stride split kept). lead/trail by leg.
type AirLeg = readonly [number, number, number]
const AIR = {
  tk0: {sLead: [0.68, 1.16, 0.14], sTrail: [0.44, 0.96, -0.32], rLead: [0.80, 1.28, -0.24], rTrail: [-0.40, 0.20, -0.68]},
  tk1: {sLead: [0.80, 1.12, -0.62], sTrail: [-0.20, 0.14, -0.88], rLead: [1.02, 1.38, -0.36], rTrail: [-0.52, 0.12, -0.92]},
  rise: {sLead: [0.68, 1.06, -0.48], sTrail: [-0.04, 0.42, -0.60], rLead: [0.90, 1.26, -0.28], rTrail: [-0.44, 0.62, -0.64]},
  apex: {sLead: [0.86, 1.46, -0.22], sTrail: [0.68, 1.36, -0.24], rLead: [0.92, 1.42, -0.22], rTrail: [0.12, 1.28, -0.30]},
  fall: {sLead: [0.60, 0.84, -0.16], sTrail: [0.34, 0.76, -0.22], rLead: [0.66, 0.74, -0.14], rTrail: [0.18, 0.86, -0.24]},
} as const satisfies Record<string, Record<'sLead' | 'sTrail' | 'rLead' | 'rTrail', AirLeg>>
// Air arm keyframes as [swing, abduct, elbow]. Both standing & running falls keep clear asymmetric balance arms.
type AirArm = readonly [number, number, number]
const AIR_ARM = {
  tk0: {s: [-0.62, 0.22, 0.86], rFwd: [0.55, 0.24, 1.34], rBack: [-0.48, 0.26, 0.96]},
  tk1: {s: [1.55, 0.28, 1.24], rFwd: [1.24, 0.24, 1.34], rBack: [-0.66, 0.28, 0.88]},
  rise: {s: [1.24, 0.40, 1.04], rFwd: [1.08, 0.30, 1.24], rBack: [-0.56, 0.32, 0.84]},
  apex: {s: [0.46, 0.68, 0.84], rFwd: [0.64, 0.56, 0.98], rBack: [-0.04, 0.68, 0.78]},
  fall: {s: [0.24, 1.04, 0.90], rFwd: [0.80, 0.88, 1.04], rBack: [-0.46, 1.18, 0.72]},
} as const satisfies Record<string, Record<'s' | 'rFwd' | 'rBack', AirArm>>
// Torso pitch [standing, running], pelvis height offset, and extra head pitch (gaze) per air key.
const AIR_TORSO = {tk0: [-0.28, -0.28], tk1: [0.06, -0.08], rise: [-0.04, -0.14], apex: [-0.12, -0.18], fall: [-0.20, -0.24]} as const
const AIR_PELVIS_Y = {tk0: -0.09, tk1: 0.015, rise: 0.008, apex: 0.012, fall: -0.01} as const
const AIR_HEAD = {tk0: 0.04, tk1: 0.03, rise: 0, apex: -0.14, fall: -0.20} as const

/** Continuous air-phase weights, written by `airWeights`. */
const _aw = {tk: 0, e: 0, rise: 0, apex: 0, fall: 0}
function airWeights(profile: LocomotionProfile, st: LocomotionState) {
  const u = st.jumped ? clamp(st.jumpTime / profile.takeoff, 0, 1) : 1
  _aw.e = 1 - (1 - u) * (1 - u) * (1 - u) // explosive ease-out
  _aw.tk = st.jumped ? 1 - smoothstep(0.85, 1.6, st.jumpTime / profile.takeoff) : 0
  _aw.rise = smoothstep(0.6, 2.6, st.vy)
  _aw.fall = smoothstep(0.6, 2.6, -st.vy)
  _aw.apex = 1 - _aw.rise - _aw.fall
}
function mixAir3(
  tk0: readonly number[], tk1: readonly number[], rise: readonly number[], apex: readonly number[], fall: readonly number[], i: number,
) {
  const flight = _aw.rise * rise[i] + _aw.apex * apex[i] + _aw.fall * fall[i]
  return _aw.tk * lerp(tk0[i], tk1[i], _aw.e) + (1 - _aw.tk) * flight
}
function airLegValue(lead: boolean, run: number, i: number) {
  const s = lead
    ? mixAir3(AIR.tk0.sLead, AIR.tk1.sLead, AIR.rise.sLead, AIR.apex.sLead, AIR.fall.sLead, i)
    : mixAir3(AIR.tk0.sTrail, AIR.tk1.sTrail, AIR.rise.sTrail, AIR.apex.sTrail, AIR.fall.sTrail, i)
  const r = lead
    ? mixAir3(AIR.tk0.rLead, AIR.tk1.rLead, AIR.rise.rLead, AIR.apex.rLead, AIR.fall.rLead, i)
    : mixAir3(AIR.tk0.rTrail, AIR.tk1.rTrail, AIR.rise.rTrail, AIR.apex.rTrail, AIR.fall.rTrail, i)
  return lerp(s, r, run)
}
function airArmValue(forward: boolean, run: number, i: number) {
  const s = mixAir3(AIR_ARM.tk0.s, AIR_ARM.tk1.s, AIR_ARM.rise.s, AIR_ARM.apex.s, AIR_ARM.fall.s, i)
  const r = forward
    ? mixAir3(AIR_ARM.tk0.rFwd, AIR_ARM.tk1.rFwd, AIR_ARM.rise.rFwd, AIR_ARM.apex.rFwd, AIR_ARM.fall.rFwd, i)
    : mixAir3(AIR_ARM.tk0.rBack, AIR_ARM.tk1.rBack, AIR_ARM.rise.rBack, AIR_ARM.apex.rBack, AIR_ARM.fall.rBack, i)
  return lerp(s, r, run)
}
function airScalar(tab: {tk0: number; tk1: number; rise: number; apex: number; fall: number}) {
  const flight = _aw.rise * tab.rise + _aw.apex * tab.apex + _aw.fall * tab.fall
  return _aw.tk * lerp(tab.tk0, tab.tk1, _aw.e) + (1 - _aw.tk) * flight
}
function airTorso(run: number) {
  const t = AIR_TORSO
  const s = mixAir3(t.tk0, t.tk1, t.rise, t.apex, t.fall, 0)
  const r = mixAir3(t.tk0, t.tk1, t.rise, t.apex, t.fall, 1)
  return lerp(s, r, run)
}

// ───────────────────────────── pure pose solver ─────────────────────────────

const _gait = createGaitSample()
const _qPel = new THREE.Quaternion()
const _ePel = new THREE.Euler(0, 0, 0, 'YXZ')
const _hip = new THREE.Vector3()
const _ankS = new THREE.Vector3()
const _ankE = new THREE.Vector3()
const _hipNoY: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()]
const _ankT: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()]
const _pitch: [number, number] = [0, 0]
const _toe: [number, number] = [0, 0]
const _contact: [number, number] = [0, 0]

function stancePitch(g: GaitSample, sigma: number) {
  if (sigma < g.flatAt) return lerp(g.pitchStrike, g.pitchMid, smooth01(sigma / g.flatAt))
  if (sigma < g.heelOffAt) return g.pitchMid
  const t = (sigma - g.heelOffAt) / (1 - g.heelOffAt)
  return g.pitchMid + (g.pitchToe - g.pitchMid) * Math.pow(t, 1.6)
}

/** Ankle of a planted foot. The foot rolls about the heel when p ≥ 0 and about the ball when p < 0, so the contact point never slides. */
function plantedAnkle(m: LocomotionMetrics, side: 0 | 1, refZ: number, x: number, p: number, out: THREE.Vector3) {
  const a = m.ankle[side]
  const piv = p >= 0 ? m.heel[side] : m.ball[side]
  const ry = a.y - piv.y, rz = a.z - piv.z
  const c = Math.cos(p), s = Math.sin(p)
  out.set(x, piv.y + ry * c - rz * s, refZ + (piv.z - a.z) + ry * s + rz * c)
  return out
}

/** Highest pelvis offset at which a hip can still reach `ankle` with a near-straight knee. */
function reachLimit(m: LocomotionMetrics, side: 0 | 1, hip: THREE.Vector3, ankle: THREE.Vector3) {
  const L = (m.thighLen[side] + m.shinLen[side]) * 0.996
  const h2 = (ankle.x - hip.x) ** 2 + (ankle.z - hip.z) ** 2
  return ankle.y + Math.sqrt(Math.max(L * L - h2, 0.0009)) - hip.y
}

/** Analytic two-bone IK in the sagittal plane, with the plane tilted about Z to reach lateral targets. */
function solveLeg(m: LocomotionMetrics, side: 0 | 1, hip: THREE.Vector3, ankle: THREE.Vector3, leg: LegPose) {
  const L1 = m.thighLen[side], L2 = m.shinLen[side]
  const dx = ankle.x - hip.x, dz = ankle.z - hip.z
  const dd = Math.max(hip.y - ankle.y, 1e-3)
  const tilt = clamp(Math.atan2(dx, dd), -0.4, 0.4)
  const down = Math.hypot(dx, dd), fwd = -dz
  const r = clamp(Math.hypot(down, fwd), Math.abs(L1 - L2) + 0.02, (L1 + L2) * 0.9995)
  const phi = Math.atan2(fwd, down)
  const c1 = clamp((L1 * L1 + r * r - L2 * L2) / (2 * L1 * r), -1, 1)
  const c2 = clamp((L2 * L2 + r * r - L1 * L1) / (2 * L2 * r), -1, 1)
  leg.thigh = phi + Math.acos(c1)
  leg.shin = phi - Math.acos(c2)
  leg.tilt = tilt
}

/** Rotates the whole swing leg (thigh + shin) by `d`, weighted by how free it is. The knee angle is kept. */
function swingNudge(leg: LegPose, d: number) {
  const w = 1 - leg.contact
  leg.thigh += d * w
  leg.shin += d * w
}

/**
 * Pure full-body solve: gait (planted IK feet, contact-limited pelvis, counter-rotation, arms, fingers)
 * → continuous five-phase air pose → landing compression. Writes into `out` and allocates nothing.
 */
export function sampleLocomotionPose(
  profile: LocomotionProfile, metrics: LocomotionMetrics, st: LocomotionState, out: LocomotionPose,
): LocomotionPose {
  const m = metrics
  const g = sampleGait(profile, st.speed, st.worldScale, _gait)
  const phi = ((st.phase % 1) + 1) % 1
  // During landing compression on a moving landing, briefly widen the contact duty so the strike leg
  // stays firmly planted through absorption before pushing off into the next stride (no airborne front foot at Land Peak).
  const landGrip = st.land > 0.05 ? clamp(st.land, 0, 1) * st.landMoving : 0
  const beta = lerp(g.duty, Math.max(g.duty, 0.46), landGrip)
  const ms = TAU * (phi - beta * 0.5) // 0 at left mid-stance
  const amount = g.amount
  const r = g.r

  // Pelvis/torso rotation from gait, turn and acceleration.
  const yawP = -g.pelvisYaw * Math.cos(TAU * phi)
  const rollGait = -g.pelvisRoll * Math.cos(ms)
  const rollP = rollGait + st.turnRoll * 0.3
  const pitchP = g.lean * 0.35 + st.accelPitch * 0.4
  const swayX = -g.sway * Math.cos(ms) * amount

  // Designed pelvis height: walk vaults (high at mid-stance, low at double support); run compresses at mid-stance.
  const hWalk = -g.sinkWalk - g.bobWalk * (1 - Math.cos(2 * ms)) * 0.5
  const hRun = -g.sinkRun - g.bobRun * Math.cos(2 * ms)
  const landK = st.land * st.landDepth
  const standRecov = st.landRecov * (1 - st.landMoving)
  let design = lerp(hWalk, hRun, r) - landK * (1 - 0.38 * st.landMoving) - 0.048 * standRecov
  const pelvisZ = landK * 0.36 * (1 - 0.65 * st.landMoving) + 0.015 * standRecov

  _ePel.set(pitchP, yawP, rollP, 'YXZ')
  _qPel.setFromEuler(_ePel)

  // Slight natural foot stagger on a standing landing + recovery so feet absorb & rebound organically.
  const standLandStagger = Math.max(st.land > 0 ? clamp(st.land, 0, 1) : 0, st.landRecov * 0.65) * (1 - st.landMoving) * 0.065

  // Feet: planted stance (heel → flat → ball roll) or a Hermite swing path with a skewed lift bump.
  for (let side = 0 as 0 | 1; side < 2; side = (side + 1) as 0 | 1) {
    const legPhase = side === 0 ? phi : (phi + 0.5) % 1
    const footX = m.hip[side].x + (side === 0 ? g.footIn : -g.footIn)
    const leadStagger = ((side === 0) === st.leadLeft ? -standLandStagger : standLandStagger)
    const az = m.ankle[side].z + leadStagger
    const tgt = _ankT[side]
    if (legPhase < beta) {
      const sigma = legPhase / beta
      const p = stancePitch(g, sigma)
      plantedAnkle(m, side, az + (sigma - g.frontFrac) * g.stance, footX, p, tgt)
      _pitch[side] = p
      _toe[side] = p < 0 ? Math.min(-p, 1) : 0
      _contact[side] = 1
    } else {
      const u = (legPhase - beta) / (1 - beta)
      plantedAnkle(m, side, az + (1 - g.frontFrac) * g.stance, footX, g.pitchToe, _ankS)
      plantedAnkle(m, side, az - g.frontFrac * g.stance, footX, g.pitchStrike, _ankE)
      const span = Math.max(_ankS.z - _ankE.z, 0)
      const u2 = u * u, u3 = u2 * u
      const z = (2 * u3 - 3 * u2 + 1) * _ankS.z + (u3 - 2 * u2 + u) * g.tanOut * span
        + (-2 * u3 + 3 * u2) * _ankE.z + (u3 - u2) * g.tanIn * span
      const bump = (Math.sin(Math.PI * u) * (1 + g.liftSkew * Math.cos(Math.PI * u))) / (1 + 0.155 * g.liftSkew)
      const y = lerp(_ankS.y, _ankE.y, smooth01(u)) + g.lift * bump
      const x = footX + (side === 0 ? -0.006 : 0.006) * Math.sin(Math.PI * u) * amount
      tgt.set(x, y, z)
      _pitch[side] = lerp(g.pitchToe, g.pitchStrike, smooth01(u)) + (g.pitchSwing - (g.pitchToe + g.pitchStrike) * 0.5) * Math.sin(Math.PI * u)
      _toe[side] = Math.min(-g.pitchToe, 1) * (1 - smoothstep(0, 0.35, u)) * (g.pitchToe < 0 ? 1 : 0)
      _contact[side] = Math.max(1 - smoothstep(0, 0.3, u), smoothstep(0.62, 1, u))
    }
    // Hip without vertical offset (pelvis rotation applied about the pelvis origin).
    const hn = _hipNoY[side]
    hn.set(m.hip[side].x - m.pelvis.x, m.hip[side].y - m.pelvis.y, m.hip[side].z - m.pelvis.z).applyQuaternion(_qPel)
    hn.x += m.pelvis.x + swayX
    hn.y += m.pelvis.y
    hn.z += m.pelvis.z + pelvisZ
  }

  // Contact-solved pelvis: smooth-min of the design height and each weight-bearing leg's reach. No float, no hyperextension.
  // The floor keeps an out-of-envelope stride from turning into a squat. Past it, the IK clamp lets the toe peel off early.
  const floor = design - 0.07
  for (let side = 0 as 0 | 1; side < 2; side = (side + 1) as 0 | 1) {
    const lim = Math.max(reachLimit(m, side, _hipNoY[side], _ankT[side]), floor) + (1 - _contact[side]) * 0.5
    design = smin(design, lim, 0.025)
  }
  const pelvisY = design

  for (let side = 0 as 0 | 1; side < 2; side = (side + 1) as 0 | 1) {
    const leg = out.legs[side]
    _hip.copy(_hipNoY[side])
    _hip.y += pelvisY
    solveLeg(m, side, _hip, _ankT[side], leg)
    leg.foot = _pitch[side]
    leg.toe = _toe[side]
    leg.contact = _contact[side]
    leg.ankleX = _ankT[side].x
    leg.ankleY = _ankT[side].y
    leg.ankleZ = _ankT[side].z
    swingNudge(leg, clamp(leg.thigh, profile.thighBackMin, profile.thighFwdMax) - leg.thigh)
  }
  // Split limit (skirt): only free legs give way.
  {
    const iF = out.legs[0].thigh >= out.legs[1].thigh ? 0 : 1
    const front = out.legs[iF], back = out.legs[1 - iF]
    const excess = front.thigh - back.thigh - profile.splitMax
    if (excess > 0) {
      const sF = 1 - front.contact, sB = 1 - back.contact, tot = sF + sB
      if (tot > 1e-3) {
        const k = excess * Math.min(1, tot) / tot
        front.thigh -= k * sF
        front.shin -= k * sF
        back.thigh += k * sB
        back.shin += k * sB
      }
    }
  }

  // Upper body (gait).
  const chestYaw = g.chestYaw * Math.cos(TAU * phi)
  let torsoPitch = g.lean * 0.65 + st.accelPitch * 0.6 - 0.025 * r * Math.cos(2 * ms) * amount
  let torsoRoll = -profile.shoulderLevel * rollGait + st.turnRoll * 0.7
  const torsoYaw = chestYaw - yawP
  const armC = -Math.cos(TAU * (phi - g.armLag)) // left arm (+ forward)
  const hipClear = profile.runStride < 0.9 ? 0.13 : 0.07
  for (let side = 0; side < 2; side++) {
    const c = side === 0 ? armC : -armC
    const back = Math.max(0, -c)
    const fwd = (c + 1) * 0.5
    // Asymmetric swing keeps the backswing fluid (0.70×) without snapping the upper arm into a stiff horizontal hook.
    const swingC = c >= 0 ? c : c * 0.70
    const arm = out.arms[side]
    arm.swing = g.armMean * amount + g.armSwing * swingC
    // Extra outward clearance on backswing guarantees the hand clears the hip/skirt hem cleanly from behind.
    arm.abduct = g.abduct + hipClear * back * amount
    // Inward forearm carry peaks on the forward upswing and eases slightly outward on backswing (zero hip/skirt graze).
    arm.twist = lerp(-0.05 * amount, g.forearmIn, smooth01(fwd))
    arm.elbow = g.elbow + g.elbowSwing * c
    arm.clavicle = g.clavicle * c * amount
  }
  out.curl = g.curl
  out.thumb = g.thumb

  // Landing (both standing and moving): compression fold + elastic recovery arc (no stiff stand-at-attention snap).
  if (landK !== 0 || standRecov > 1e-4) {
    const k = st.land * (st.landDepth / 0.15) * (1 - 0.45 * st.landMoving)
    const standOnly = 1 - st.landMoving
    torsoPitch -= profile.landTorso * k + 0.12 * standRecov
    for (let side = 0; side < 2; side++) {
      const arm = out.arms[side]
      const asym = ((side === 0) === st.leadLeft ? 1 : -1)
      // Compression: arms sweep out-back to counter deep hip flexion. Rebound: arms swing smoothly forward-up with bent elbows as knees extend.
      arm.swing += (-0.36 * standOnly + 0.18 * st.landMoving) * k + (0.34 + 0.08 * asym) * standRecov
      arm.abduct += (0.30 * standOnly + 0.14 * st.landMoving) * k + 0.16 * standRecov
      arm.elbow += (0.38 * standOnly + 0.22 * st.landMoving) * k + 0.46 * standRecov
    }
    const grip = Math.max(Math.abs(st.land), standRecov * 0.7)
    out.curl = Math.max(out.curl, 0.58 * grip)
    out.thumb = Math.max(out.thumb, 0.56 * grip)
  }

  let pPitch = pitchP, pYaw = yawP, pRoll = rollP, pX = swayX, pY = pelvisY, pZ = pelvisZ
  let tYaw = torsoYaw, headExtra = 0

  // Air: five continuous phases (takeoff → rise → apex → fall), blended over the gait by `st.air`.
  const a = st.air
  if (a > 0) {
    airWeights(profile, st)
    const run = st.runJump, power = profile.jumpPower
    const torsoAir = airTorso(run) - 0.06 * st.alert * _aw.fall
    for (let side = 0 as 0 | 1; side < 2; side = (side + 1) as 0 | 1) {
      const lead = (side === 0) === st.leadLeft
      let thigh = airLegValue(lead, run, 0)
      if (thigh > 0) thigh *= lerp(1, power, 0.8)
      const knee = airLegValue(lead, run, 1) + 0.15 * st.alert * _aw.fall
      const footRel = airLegValue(lead, run, 2)
      const shin = thigh - knee
      const leg = out.legs[side]
      leg.thigh = lerp(leg.thigh, thigh, a)
      leg.shin = lerp(leg.shin, shin, a)
      leg.foot = lerp(leg.foot, shin - m.shinRest[side] + footRel, a)
      leg.toe = lerp(leg.toe, 0.08, a)
      leg.tilt = lerp(leg.tilt, side === 0 ? 0.025 : -0.025, a)
      leg.contact = lerp(leg.contact, 0, a)
      // Arms: clear left/right balance offset in fall (both standing and running jumps) so arms never mirror robotically.
      const fwdArm = (side === 0) !== st.leadLeft
      const arm = out.arms[side]
      const fallOffsetSwing = (1 - run) * _aw.fall * (fwdArm ? 0.52 : -0.46)
      const fallOffsetAbd = (1 - run) * _aw.fall * (fwdArm ? -0.10 : 0.16)
      const fallOffsetElbow = (1 - run) * _aw.fall * (fwdArm ? 0.18 : -0.16)
      let swing = airArmValue(fwdArm, run, 0) + fallOffsetSwing
      if (swing > 0) swing *= lerp(1, power, 0.6)
      swing += 0.25 * st.alert * _aw.fall
      const abd = (airArmValue(fwdArm, run, 1) + 0.25 * st.alert * _aw.fall + fallOffsetAbd) * profile.jumpArmsOpen
      arm.swing = lerp(arm.swing, swing, a)
      arm.abduct = lerp(arm.abduct, abd, a)
      arm.elbow = lerp(arm.elbow, airArmValue(fwdArm, run, 2) + fallOffsetElbow, a)
      arm.twist = lerp(arm.twist, profile.forearmIn[0], a)
      arm.clavicle = lerp(arm.clavicle, 0, a)
    }
    pPitch = lerp(pPitch, torsoAir * 0.3, a)
    pYaw = lerp(pYaw, 0, a)
    pRoll = lerp(pRoll, 0, a)
    pX = lerp(pX, 0, a)
    pY = lerp(pY, airScalar(AIR_PELVIS_Y), a)
    pZ = lerp(pZ, 0, a)
    torsoPitch = lerp(torsoPitch, torsoAir * 0.7, a)
    torsoRoll = lerp(torsoRoll, 0, a)
    tYaw = lerp(tYaw, 0, a)
    headExtra = airScalar(AIR_HEAD) * a - 0.05 * st.alert * _aw.fall * a
    out.curl = lerp(out.curl, 0.68, a)
    out.thumb = lerp(out.thumb, 0.66, a)
  }

  out.pelvisX = pX
  out.pelvisY = pY
  out.pelvisZ = pZ
  out.pelvisPitch = pPitch
  out.pelvisYaw = pYaw
  out.pelvisRoll = pRoll
  out.torsoPitch = torsoPitch
  out.torsoYaw = tYaw
  out.torsoRoll = torsoRoll
  // Head stabilisation: the gaze stays level against chest twist, roll and lean.
  const stab = profile.headStabilise
  out.headPitch = -stab * 0.75 * (pPitch + torsoPitch) + headExtra
  out.headYaw = -stab * (pYaw + tYaw)
  out.headRoll = -stab * 0.8 * (pRoll + torsoRoll)
  return out
}

// ───────────────────────────── zero-allocation bone driver ─────────────────────────────

export interface LocomotionFrame {
  /** Horizontal ground speed, world m/s. */
  speed: number
  /** Vertical velocity, world m/s. */
  vy: number
  grounded: boolean
  moving: boolean
  crouching: boolean
  /** Facing yaw (rad). Used for the turn lean. */
  facing: number
  /** The jump impulse was issued (any frame of the takeoff is fine). The driver also detects a strong upward vy on its own. */
  jumped: boolean
  /** False in vehicles, knockdown, scripted sessions, etc. The weight snaps to 0. */
  enabled: boolean
}

export interface LocomotionProbe {
  body: LocomotionBody
  gait: LocomotionGait
  jumpPhase: JumpPhase
  blend: number
  airBlend: number
  stridePhase: number
  speed: number
  cadence: number
  duty: number
  landCompress: number
  landDepth: number
  pelvisOffsetY: number
  leadLeg: 'l' | 'r'
  contact: [number, number]
}

export interface LocomotionAnimator {
  readonly frame: LocomotionFrame
  readonly body: LocomotionBody
  /** Call right after `mixer.update(dt)` once `frame` is filled in. */
  update(dt: number): void
  /** LIFO restore of the mixer values this layer overwrote. Call at frame start after the later layers reset. */
  reset(): void
  /** Restore and drop all blend/air/land state (teleport, respawn, vehicle exit). */
  halt(): void
  setBody(body: string): void
  /** Re-read the CreatorProportions scale (avatar change). */
  refreshScale(): void
  /** Read-only debug snapshot. This allocates, so it is not for the hot path. */
  probe(): LocomotionProbe
}

const NAMES_SPINE = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head'] as const
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const
const B_PELVIS = 0, B_SPINE = 1, B_NECK = 4, B_HEAD = 5
const ARM_BASE = [6, 25] as const // clavicle, upperarm, lowerarm, hand
const FINGER_BASE = [10, 29] as const // 5 fingers × 3 joints
const LEG_BASE = [44, 48] as const // thigh, calf, foot, ball
const BONE_COUNT = 52
const SPINE_SHARE = [0.25, 0.65, 1] as const
// Calibrated full-fist joint bend angles (rad) in T-pose palm frame: MCP, PIP, DIP.
// Chained via incremental quaternion multiplication so fingertips tuck tightly into the palm with zero gimbal flip.
const FIST_BENDS = [1.62, 1.84, 1.24] as const
const FINGER_MULT = [0, 1.0, 1.05, 1.10, 1.15] as const
// Subtle MCP-only adduction (index→pinky) to close the wide T-pose spread cleanly without splaying distal phalanges.
const FINGER_SPREAD_CLOSE = [0, 0.08, 0.0, -0.05, -0.11] as const
// Calibrated thumb-over-index opposition steps [rx, ry_left, rz_left] per joint (right hand mirrors ry & rz).
const THUMB_FIST = [[0.14, 0.12, 0.34], [-0.18, 0.72, 0.14], [-0.12, 0.42, 0.08]] as const

function boneNames(): string[] {
  const names: string[] = [...NAMES_SPINE]
  for (const s of ['l', 'r']) {
    names.push(`clavicle_${s}`, `upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`)
    for (const f of FINGERS) for (const j of ['01', '02', '03']) names.push(`${f}_${j}_${s}`)
  }
  for (const s of ['l', 'r']) names.push(`thigh_${s}`, `calf_${s}`, `foot_${s}`, `ball_${s}`)
  return names
}

const ARMS_DROP_ANGLE = Math.PI * 0.48 // must match avatar-rig.ts
const AXIS_Z = new THREE.Vector3(0, 0, 1)
const Q_DROP: readonly [THREE.Quaternion, THREE.Quaternion] = [
  new THREE.Quaternion().setFromAxisAngle(AXIS_Z, ARMS_DROP_ANGLE),
  new THREE.Quaternion().setFromAxisAngle(AXIS_Z, -ARMS_DROP_ANGLE),
]

// Driver scratch (module level, shared by every animator. update() is synchronous).
const _qa = new THREE.Quaternion()
const _qb = new THREE.Quaternion()
const _qc = new THREE.Quaternion()
const _qT = new THREE.Quaternion()
const _qS3 = new THREE.Quaternion()
const _qH = new THREE.Quaternion()
const _qArm = new THREE.Quaternion()
const _qLow = new THREE.Quaternion()
const _qHand = new THREE.Quaternion()
const _qChain = new THREE.Quaternion()
const _qInv = new THREE.Quaternion()
const _qLocal = new THREE.Quaternion()
const _eul = new THREE.Euler(0, 0, 0, 'YXZ')
const _vOff = new THREE.Vector3()
const rotX = (out: THREE.Quaternion, a: number) => out.set(Math.sin(a * 0.5), 0, 0, Math.cos(a * 0.5))
const rotY = (out: THREE.Quaternion, a: number) => out.set(0, Math.sin(a * 0.5), 0, Math.cos(a * 0.5))
const rotZ = (out: THREE.Quaternion, a: number) => out.set(0, 0, Math.sin(a * 0.5), Math.cos(a * 0.5))

function noopAnimator(body: LocomotionBody): LocomotionAnimator {
  const frame: LocomotionFrame = {speed: 0, vy: 0, grounded: true, moving: false, crouching: false, facing: 0, jumped: false, enabled: false}
  let current = body
  return {
    frame,
    get body() { return current },
    update() {},
    reset() {},
    halt() {},
    setBody(b) { current = b === 'f' ? 'f' : 'm' },
    refreshScale() {},
    probe: () => ({
      body: current, gait: 'idle', jumpPhase: 'none', blend: 0, airBlend: 0, stridePhase: 0, speed: 0, cadence: 0, duty: 0,
      landCompress: 0, landDepth: 0, pelvisOffsetY: 0, leadLeg: 'r', contact: [1, 1],
    }),
  }
}

/**
 * Builds the procedural locomotion layer for an avatar. Create it while the skeleton is still at its bind
 * rest pose (right after `ensureAvatarRig`, before any mixer action runs).
 */
export function createLocomotionAnimator(root: THREE.Object3D, bodyIn: string): LocomotionAnimator {
  let body: LocomotionBody = bodyIn === 'f' ? 'f' : 'm'
  const rig = root.userData.avatarRig as AvatarRig | undefined
  const skeletonRoot = root.getObjectByName('root') ?? root.getObjectByName('Armature') ?? root
  const pelvisBone = skeletonRoot.getObjectByName('pelvis')
  if (!rig?.isSkinned || !pelvisBone) return noopAnimator(body)
  const cp = root.getObjectByName('CreatorProportions')
  const armature = root.getObjectByName('Armature')
  const charFrame: THREE.Object3D = cp ?? armature?.parent ?? rig.traveller ?? root

  // ── bones, rest pose, char-space rest quaternions ──
  const names = boneNames()
  const bones: (THREE.Object3D | undefined)[] = names.map(n => skeletonRoot.getObjectByName(n))
  const index = new Map<THREE.Object3D, number>()
  bones.forEach((b, i) => b && index.set(b, i))
  const charQuat = (node: THREE.Object3D | null, out: THREE.Quaternion) => {
    out.identity()
    for (let n = node; n && n !== charFrame; n = n.parent) out.premultiply(n.quaternion)
    return out
  }
  const charMatrix = (node: THREE.Object3D | null, out: THREE.Matrix4) => {
    out.identity()
    for (let n = node; n && n !== charFrame; n = n.parent) {
      n.updateMatrix()
      out.premultiply(n.matrix)
    }
    return out
  }
  const worldRest = names.map((_, i) => charQuat(bones[i] ?? null, new THREE.Quaternion()))
  const dropRest = worldRest.map((q, i) => {
    const side: 0 | 1 | -1 = i >= ARM_BASE[0] + 1 && i <= ARM_BASE[0] + 3 ? 0 : i >= ARM_BASE[1] + 1 && i <= ARM_BASE[1] + 3 ? 1 : -1
    return side === -1 ? q.clone() : q.clone().premultiply(Q_DROP[side])
  })
  const parentIdx = new Int16Array(BONE_COUNT).fill(-1)
  const staticParent = names.map(() => new THREE.Quaternion())
  for (let i = 0; i < BONE_COUNT; i++) {
    const p = bones[i]?.parent ?? null
    const pi = p ? index.get(p) : undefined
    if (pi !== undefined && pi < i) parentIdx[i] = pi
    else charQuat(p, staticParent[i])
  }
  const target = names.map(() => new THREE.Quaternion())
  const saved = names.map(() => new THREE.Quaternion())
  const pelvisRest = pelvisBone.position.clone()
  const savedPelvis = new THREE.Vector3()

  // ── metrics (character space, CP units) ──
  const mtx = new THREE.Matrix4()
  const charPos = (node: THREE.Object3D | undefined, fallback: Vec3Like) =>
    node ? new THREE.Vector3().setFromMatrixPosition(charMatrix(node, mtx)) : new THREE.Vector3(fallback.x, fallback.y, fallback.z)
  const D = DEFAULT_LOCOMOTION_METRICS
  const hipL = charPos(bones[LEG_BASE[0]], D.hip[0]), hipR = charPos(bones[LEG_BASE[1]], D.hip[1])
  const kneeL = charPos(bones[LEG_BASE[0] + 1], v3(D.hip[0].x, 0.5259, -0.0193)), kneeR = charPos(bones[LEG_BASE[1] + 1], v3(D.hip[1].x, 0.5259, -0.0193))
  const ankL = charPos(bones[LEG_BASE[0] + 2], D.ankle[0]), ankR = charPos(bones[LEG_BASE[1] + 2], D.ankle[1])
  const ballL = charPos(bones[LEG_BASE[0] + 3], D.ball[0]), ballR = charPos(bones[LEG_BASE[1] + 3], D.ball[1])
  const heel = [new THREE.Vector3(ankL.x, 0.004, -Infinity), new THREE.Vector3(ankR.x, 0.004, -Infinity)]
  let ground = Infinity
  const pt = new THREE.Vector3()
  // Extract true shoe sole floor and heel pivot directly from the skinned mesh bind vertices in charFrame (CP) space.
  // Avoids skewed footProbe AABB corner bias (where foot_l probe corners sit ~3.3 cm below the actual sole and forward of the heel).
  const skinned = rig.skinnedMesh
  const posAttr = skinned?.geometry.getAttribute('position')
  if (skinned && posAttr) {
    const cpInvM = new THREE.Matrix4().copy(charFrame.matrixWorld).invert()
    const meshToCp = new THREE.Matrix4().multiplyMatrices(cpInvM, skinned.matrixWorld)
    for (let i = 0; i < posAttr.count; i++) {
      pt.fromBufferAttribute(posAttr, i).applyMatrix4(meshToCp)
      if (pt.y < ground) ground = pt.y
    }
    const soleBand = ground + 0.025
    for (let i = 0; i < posAttr.count; i++) {
      pt.fromBufferAttribute(posAttr, i).applyMatrix4(meshToCp)
      if (pt.y > soleBand) continue
      const side = pt.x < 0 ? 0 : 1
      if (pt.z > heel[side].z) heel[side].set(side === 0 ? ankL.x : ankR.x, ground + 0.004, pt.z)
    }
  }
  if (!Number.isFinite(ground)) ground = Math.min(ballL.y, ballR.y) - 0.015
  const anks = [ankL, ankR]
  for (const side of [0, 1]) {
    if (!Number.isFinite(heel[side].z)) heel[side].set(anks[side].x, ground + 0.004, anks[side].z + 0.056)
    heel[side].x = anks[side].x
  }
  const len = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceTo(b)
  const ang = (a: THREE.Vector3, b: THREE.Vector3) => Math.atan2(-(b.z - a.z), -(b.y - a.y))
  const metrics: LocomotionMetrics = {
    pelvis: charPos(pelvisBone, D.pelvis),
    hip: [hipL, hipR], ankle: [ankL, ankR], ball: [ballL, ballR], heel: [heel[0], heel[1]],
    thighLen: [len(hipL, kneeL), len(hipR, kneeR)], shinLen: [len(kneeL, ankL), len(kneeR, ankR)],
    thighRest: [ang(hipL, kneeL), ang(hipR, kneeR)], shinRest: [ang(kneeL, ankL), ang(kneeR, ankR)],
    ground,
  }

  // Pelvis translation goes through the inverse 3×3 of pelvis.parent → character frame (never a raw `position.y +=`).
  const pelvisInv = new THREE.Matrix3()
  let worldScale = 1
  function refreshScale() {
    pelvisInv.setFromMatrix4(charMatrix(pelvisBone!.parent, mtx)).invert()
    let s = 1
    for (let n: THREE.Object3D | null = cp ?? null; n; n = n.parent) {
      s *= Math.abs(n.scale.z)
      if (n === root) break
    }
    worldScale = s
  }
  refreshScale()

  // ── runtime state ──
  const frame: LocomotionFrame = {speed: 0, vy: 0, grounded: true, moving: false, crouching: false, facing: 0, jumped: false, enabled: false}
  const st = createLocomotionState()
  const pose = createLocomotionPose()
  const gait = createGaitSample()
  let profile = LOCOMOTION_PROFILES[body]
  let weight = 0, airW = 0, dirty = false, stale = 0
  let wasGrounded = true, airTime = 0, minVy = 0, airPose = false
  let landTimer = -1, landDur = 0.3
  let prevFacing = NaN, turnRate = 0, prevAnimSpeed = 0, accel = 0

  function restore() {
    for (let i = 0; i < BONE_COUNT; i++) {
      const b = bones[i]
      if (b) b.quaternion.copy(saved[i])
    }
    pelvisBone!.position.copy(savedPelvis)
    dirty = false
  }
  function reset() {
    if (dirty) restore()
    stale++
  }
  function clearDynamics() {
    weight = airW = 0
    airPose = false
    st.air = st.land = st.landRecov = st.landDepth = st.landMoving = st.alert = 0
    st.jumped = false
    st.jumpTime = 0
    landTimer = -1
    airTime = minVy = 0
    wasGrounded = frame.grounded
    prevFacing = NaN
    turnRate = accel = st.turnRoll = st.accelPitch = 0
  }
  function halt() {
    if (dirty) restore()
    clearDynamics()
    st.speed = prevAnimSpeed = 0
  }

  function stepState(dt: number) {
    const f = frame
    // Damped animation speed. The physics reaches 9 m/s in tens of ms; the body takes a few strides' worth of time.
    const sp = Math.max(0, Number.isFinite(f.speed) ? f.speed : 0)
    st.speed = damp(st.speed, sp, sp > st.speed ? 9 : 7, dt)
    accel = damp(accel, (st.speed - prevAnimSpeed) / dt, 8, dt)
    prevAnimSpeed = st.speed
    st.accelPitch = f.grounded ? clamp(-0.011 * accel, -0.06, 0.05) : damp(st.accelPitch, 0, 6, dt)
    // Heading rate → lean into the turn (upright bones +rz lean left; facing increases when turning left).
    const dYaw = Number.isFinite(prevFacing) ? wrapAngle(f.facing - prevFacing) : 0
    prevFacing = f.facing
    turnRate = damp(turnRate, Math.abs(dYaw) > 1.2 ? 0 : clamp(dYaw / dt, -6, 6), 10, dt)
    st.turnRoll = damp(st.turnRoll, clamp(turnRate * st.speed * 0.011, -0.075, 0.075) * (f.grounded ? 1 : 0.4), 8, dt)

    // Air / landing state machine.
    if (!f.grounded) {
      if (wasGrounded) {
        airTime = 0
        minVy = Math.min(0, f.vy)
        st.jumped = false
        st.jumpTime = 0
        landTimer = -1
        st.land = 0
        // Walk-offs keep the stride split too; a detected jump below re-reads the same values.
        st.runJump = smoothstep(1, 4, st.speed)
        st.leadLeft = st.speed > 0.9 ? st.phase >= 0.5 : false
      }
      airTime += dt
      if (!st.jumped && (f.jumped || f.vy > 2.5) && f.vy > 0.5 && airTime < 0.25) {
        st.jumped = true
        st.jumpTime = 0
        st.runJump = smoothstep(1, 4, st.speed)
        st.leadLeft = st.speed > 0.9 ? st.phase >= 0.5 : false
      }
      if (st.jumped) st.jumpTime += dt
      if (f.vy < minVy) minVy = f.vy
      airPose = st.jumped || (airTime > 0.14 && f.vy < -2.4)
      st.alert = smoothstep(9, 14, -f.vy)
    } else {
      if (!wasGrounded) {
        const impact = -minVy
        if (st.jumped || (impact > 3.4 && airTime > 0.16)) {
          const k = smoothstep(4, 12, impact)
          landDur = lerp(0.30, 0.44, k) * profile.landTime
          st.landDepth = clamp(0.09 + 0.013 * impact, 0.10, 0.24) * profile.landDepth
          st.landMoving = smoothstep(0.8, 2.2, st.speed)
          // Moving landing: the lead leg (reaching forward in the air) takes the strike right at initial contact.
          if (st.landMoving > 0.5 && st.jumped) st.phase = st.leadLeft ? 0.0 : 0.5
          landTimer = 0
        }
        st.jumped = false
        st.jumpTime = 0
      }
      airPose = false
      st.alert = 0
      if (landTimer >= 0) {
        landTimer += dt
        if (landTimer >= landDur) landTimer = -1
      }
    }
    wasGrounded = f.grounded
    st.land = landTimer >= 0 ? landingCurve(landTimer, landDur) : 0
    if (landTimer >= 0) {
      const lu = landTimer / landDur
      st.landRecov = lu > 0.22 && lu < 0.98 ? Math.sin(Math.PI * clamp((lu - 0.22) / 0.76, 0, 1)) : 0
    } else {
      st.landRecov = 0
    }
    st.vy = f.vy

    // Stride phase. Frozen in the air so the landing can pick the strike leg.
    sampleGait(profile, st.speed, worldScale, gait)
    if (f.grounded) st.phase = (st.phase + dt * gait.cadence * 0.5 * smoothstep(0.02, 0.3, st.speed)) % 1

    // Layer weights (linear ramps eased on use). Explosive jump takeoff snaps into active blend immediately so frame 1 is never stiff upright.
    const landing = landTimer >= 0
    const jumpingNow = st.jumped && st.jumpTime < profile.takeoff * 1.4
    let goal = 0
    if (airPose || landing) goal = 1
    else if (!f.crouching && (st.speed > GAIT_SPEEDS.idle || (f.moving && f.speed > 0.05))) goal = 1
    if (jumpingNow) {
      weight = Math.max(weight, 0.88)
      airW = Math.max(airW, 0.86)
    }
    const rate = goal > weight ? (jumpingNow ? 48 : airPose ? 22 : 7) : f.crouching ? 10 : 4.5
    weight = goal > weight ? Math.min(goal, weight + rate * dt) : Math.max(goal, weight - rate * dt)
    const airGoal = airPose ? 1 : 0
    const airRiseRate = jumpingNow ? 42 : 16
    airW = airGoal > airW ? Math.min(1, airW + airRiseRate * dt) : Math.max(0, airW - 20 * dt)
    st.air = smooth01(airW)
  }

  function computeTargets() {
    const P = pose
    // Spine chain: pelvis delta, then the torso spread 25/65/100% over spine_01..03.
    _eul.set(P.pelvisPitch, P.pelvisYaw, P.pelvisRoll, 'YXZ')
    _qPel.setFromEuler(_eul)
    target[B_PELVIS].multiplyQuaternions(_qPel, worldRest[B_PELVIS])
    _eul.set(P.torsoPitch, P.torsoYaw, P.torsoRoll, 'YXZ')
    _qT.setFromEuler(_eul)
    for (let k = 0; k < 3; k++) {
      _qa.identity().slerp(_qT, SPINE_SHARE[k])
      _qb.multiplyQuaternions(_qPel, _qa)
      target[B_SPINE + k].multiplyQuaternions(_qb, worldRest[B_SPINE + k])
    }
    _qS3.multiplyQuaternions(_qPel, _qT)
    _eul.set(P.headPitch, P.headYaw, P.headRoll, 'YXZ')
    _qH.setFromEuler(_eul)
    _qa.identity().slerp(_qH, 0.35)
    _qb.multiplyQuaternions(_qS3, _qa)
    target[B_NECK].multiplyQuaternions(_qb, worldRest[B_NECK])
    _qb.multiplyQuaternions(_qS3, _qH)
    target[B_HEAD].multiplyQuaternions(_qb, worldRest[B_HEAD])

    for (let side = 0; side < 2; side++) {
      const arm = P.arms[side], sgn = side === 0 ? -1 : 1, base = ARM_BASE[side]
      // Clavicle: protraction follows the forward swing.
      _qb.multiplyQuaternions(_qS3, rotY(_qa, sgn * arm.clavicle))
      target[base].multiplyQuaternions(_qb, worldRest[base])
      // Upper arm: abduction (outermost) · flexion · internal rotation about the hanging axis.
      _qArm.multiplyQuaternions(_qS3, rotZ(_qa, sgn * arm.abduct))
      _qArm.multiply(rotX(_qa, arm.swing))
      _qArm.multiply(rotY(_qa, sgn * arm.twist))
      target[base + 1].multiplyQuaternions(_qArm, dropRest[base + 1])
      _qLow.multiplyQuaternions(_qArm, rotX(_qa, arm.elbow))
      target[base + 2].multiplyQuaternions(_qLow, dropRest[base + 2])
      target[base + 3].multiplyQuaternions(_qLow, dropRest[base + 3])
      // Fingers: incremental quaternion chain curling fingertips tightly into the palm (calibrated to zero hollow gap),
      // with MCP-only spread closing and mirrored thumb opposition tucking cleanly against the curled index middle phalanx.
      _qHand.multiplyQuaternions(_qLow, Q_DROP[side])
      const fb = FINGER_BASE[side]
      const fSgn = side === 0 ? 1 : -1
      const curlAmt = clamp(P.curl, 0, 1.1)
      const thumbAmt = clamp(P.thumb, 0, 1.1)
      for (let f = 0; f < 5; f++) {
        _qChain.identity()
        const mult = FINGER_MULT[f]
        const spread = FINGER_SPREAD_CLOSE[f] * clamp(curlAmt, 0, 1) * fSgn
        for (let j = 0; j < 3; j++) {
          if (f === 0) {
            const step = THUMB_FIST[j]
            _eul.set(step[0] * thumbAmt, step[1] * thumbAmt * fSgn, step[2] * thumbAmt * fSgn, 'XYZ')
            _qc.setFromEuler(_eul)
          } else {
            _eul.set(0, j === 0 ? spread : 0, fSgn * FIST_BENDS[j] * mult * curlAmt, 'YZX')
            _qc.setFromEuler(_eul)
          }
          _qChain.multiply(_qc)
          const i = fb + f * 3 + j
          _qb.multiplyQuaternions(_qHand, _qChain)
          target[i].multiplyQuaternions(_qb, worldRest[i])
        }
      }
    }

    for (let side = 0 as 0 | 1; side < 2; side = (side + 1) as 0 | 1) {
      const leg = P.legs[side], base = LEG_BASE[side]
      rotZ(_qc, leg.tilt)
      _qb.multiplyQuaternions(_qc, rotX(_qa, leg.thigh - metrics.thighRest[side]))
      target[base].multiplyQuaternions(_qb, worldRest[base])
      _qb.multiplyQuaternions(_qc, rotX(_qa, leg.shin - metrics.shinRest[side]))
      target[base + 1].multiplyQuaternions(_qb, worldRest[base + 1])
      // Sole stays level laterally; pitch only.
      target[base + 2].multiplyQuaternions(rotX(_qa, leg.foot), worldRest[base + 2])
      target[base + 3].multiplyQuaternions(rotX(_qa, leg.foot + leg.toe), worldRest[base + 3])
    }
  }

  function update(dtIn: number) {
    if (dirty) restore()
    const dt = clamp(Number.isFinite(dtIn) ? dtIn : 0, 1e-4, 0.1)
    if (stale > 2) clearDynamics() // skipped frames (boat, cutscene) → no stale blend
    stale = 0
    if (!frame.enabled) {
      clearDynamics()
      st.speed = damp(st.speed, Math.max(0, frame.speed), 7, dt)
      wasGrounded = frame.grounded
      return
    }
    stepState(dt)
    const w = smooth01(weight)
    if (w <= 1e-4) return

    st.worldScale = worldScale
    sampleLocomotionPose(profile, metrics, st, pose)
    computeTargets()

    // Snapshot the mixer pose, then slerp toward the procedural local rotations (top-down, so parents are known).
    for (let i = 0; i < BONE_COUNT; i++) {
      const b = bones[i]
      if (!b) continue
      saved[i].copy(b.quaternion)
      const pi = parentIdx[i]
      _qInv.copy(pi >= 0 ? target[pi] : staticParent[i]).invert()
      _qLocal.multiplyQuaternions(_qInv, target[i])
      b.quaternion.slerp(_qLocal, w)
    }
    savedPelvis.copy(pelvisBone!.position)
    _vOff.set(pose.pelvisX, pose.pelvisY, pose.pelvisZ).applyMatrix3(pelvisInv).add(pelvisRest)
    pelvisBone!.position.lerp(_vOff, w)
    dirty = true
  }

  return {
    frame,
    get body() { return body },
    update,
    reset,
    halt,
    setBody(b: string) {
      if (dirty) restore()
      body = b === 'f' ? 'f' : 'm'
      profile = LOCOMOTION_PROFILES[body]
      refreshScale()
    },
    refreshScale,
    probe(): LocomotionProbe {
      const s = st.speed, w = smooth01(weight)
      const gaitLabel: LocomotionGait = w < 0.05 ? 'idle' : s < GAIT_SPEEDS.run ? 'walk' : s < GAIT_SPEEDS.sprint ? 'run' : 'sprint'
      return {
        body, gait: gaitLabel,
        jumpPhase: resolveJumpPhase(!frame.grounded && (airPose || st.jumped), st.jumped, st.jumpTime, st.vy, landTimer >= 0, profile.takeoff),
        blend: +w.toFixed(3), airBlend: +st.air.toFixed(3), stridePhase: +st.phase.toFixed(3), speed: +s.toFixed(3),
        cadence: +gait.cadence.toFixed(3), duty: +gait.duty.toFixed(3), landCompress: +st.land.toFixed(3),
        landDepth: +st.landDepth.toFixed(3), pelvisOffsetY: +pose.pelvisY.toFixed(4), leadLeg: st.leadLeft ? 'l' : 'r',
        contact: [+pose.legs[0].contact.toFixed(2), +pose.legs[1].contact.toFixed(2)],
      }
    },
  }
}

/**
 * Remote players: derive the frame from the 20 Hz pose stream without any protocol change. Vertical speed
 * comes from the smoothed root height. "Grounded" waits for the smoothed root to settle, so the landing
 * compression starts when the avatar visibly touches down rather than when the packet arrives.
 */
export function createRemoteLocomotionFeed(anim: LocomotionAnimator) {
  let prevY = NaN, vy = 0
  return (dt: number, shownY: number, packetY: number, gr: boolean, speed: number, facing: number, enabled: boolean) => {
    const f = anim.frame
    const d = Math.max(1e-3, dt)
    const raw = Number.isFinite(prevY) ? (shownY - prevY) / d : 0
    prevY = shownY
    const grounded = gr && shownY - packetY < 0.08
    vy = grounded ? damp(vy, 0, 20, d) : damp(vy, clamp(raw, -30, 15), 14, d)
    f.enabled = enabled
    f.speed = speed
    f.vy = vy
    f.grounded = grounded
    f.moving = speed > 0.14
    f.crouching = false
    f.facing = facing
    f.jumped = false
    anim.update(dt)
  }
}
