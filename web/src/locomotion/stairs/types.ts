/**
 * Reusable stair-locomotion types (domain-agnostic: curbs, stoops, building stairs, underground stairwells).
 * Zero dependency on Three.js runtime values or any specific landmark module.
 */

export interface Vec3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

export type StairDirection = 'up' | 'down'

export interface StairLanding {
  /** Flat approach length before step 1 at `s = 0` (meters, >= 0). */
  readonly entry: number
  /** Flat departure length after the final step at `s = totalRun` (meters, >= 0). */
  readonly exit: number
}

export interface StairMidLanding {
  /** Insert flat intermediate landing after this 1-based step count (`1 <= afterStep < count`). */
  readonly afterStep: number
  /** Length of the intermediate landing along the stair travel axis (meters, > 0). */
  readonly length: number
}

export interface StairProfile {
  /** Vertical rise of a single step (meters, > 0). */
  readonly riser: number
  /** Horizontal run of a single tread (meters, > 0). */
  readonly tread: number
  /** Total step count (positive integer >= 1). */
  readonly count: number
  /** Flat entry/exit landing length (meters >= 0, or separate `{ entry, exit }`). Defaults to `0` (or `landingTop`/`landingFoot` if supplied). */
  readonly landing?: number | StairLanding
  /**
   * Optional top-end landing length (meters, >= 0) for elevation-keyed profiles (e.g. `{ landingTop, landingFoot }`).
   * Used when `landing` is omitted: maps to `entry` on `'down'` and `exit` on `'up'`.
   */
  readonly landingTop?: number
  /**
   * Optional bottom/foot-end landing length (meters, >= 0) for elevation-keyed profiles (e.g. `{ landingTop, landingFoot }`).
   * Used when `landing` is omitted: maps to `exit` on `'down'` and `entry` on `'up'`.
   */
  readonly landingFoot?: number
  /** Optional intermediate flat landing splitting the flight into two runs. */
  readonly midLanding?: StairMidLanding
  /**
   * Length of each C² smoothstep shoulder zone bridging flat landings and sloped flights (meters, >= 0).
   * Defaults to `Math.min(tread * 1.5, 0.55)`. Set `0` only if raw piecewise-linear slope is explicitly desired.
   */
  readonly shoulderLength?: number
  /** Traversal direction along increasing `s`: `'up'` ascends (+Y), `'down'` descends (-Y). Defaults to `'up'`. */
  readonly direction?: StairDirection
  /** Foot elevation at `s = 0` (meters). Defaults to `0`. */
  readonly baseY?: number
  /** Clear stair width for spatial bounds checks (meters, > 0). Defaults to `2.4`. */
  readonly width?: number
}

export interface StairFlightSegment {
  /** Index of this flight segment (0, or 0 and 1 when `midLanding` is present). */
  readonly index: number
  /** Geometric start of the physical steps along `s`. */
  readonly flightStart: number
  /** Geometric end of the physical steps along `s`. */
  readonly flightEnd: number
  /** Start of the entry C² shoulder along `s` (`<= flightStart`). */
  readonly shoulderInStart: number
  /** End of the entry C² shoulder / start of constant-slope middle along `s`. */
  readonly shoulderInEnd: number
  /** Start of the exit C² shoulder / end of constant-slope middle along `s`. */
  readonly shoulderOutStart: number
  /** End of the exit C² shoulder along `s` (`>= flightEnd`). */
  readonly shoulderOutEnd: number
  /** Starting foot elevation of this segment. */
  readonly startY: number
  /** Ending foot elevation of this segment. */
  readonly endY: number
  /** Peak constant slope `dy/ds` across the middle portion of this flight segment. */
  readonly peakSlope: number
  /** Cumulative step index at the start of this flight segment. */
  readonly stepOffset: number
  /** Step count within this flight segment. */
  readonly stepCount: number
}

export interface NormalizedStairProfile {
  readonly riser: number
  readonly tread: number
  readonly count: number
  readonly landing: StairLanding
  readonly midLanding: StairMidLanding | null
  readonly shoulderLength: number
  readonly direction: StairDirection
  readonly sign: 1 | -1
  readonly baseY: number
  readonly endY: number
  readonly totalRise: number
  readonly totalRun: number
  readonly width: number
  readonly nominalSlope: number
  readonly flights: readonly StairFlightSegment[]
}

export type StairZone =
  | 'entry-landing'
  | 'entry-shoulder'
  | 'flight'
  | 'mid-landing'
  | 'exit-shoulder'
  | 'exit-landing'

export interface StairSample {
  /** Clamped longitudinal progress along the stair profile in `[0, totalRun]` (meters). */
  readonly s: number
  /** Normalized progress in `[0, 1]`. */
  readonly t: number
  /** Smooth C² continuous foot elevation at `s` (meters). */
  readonly height: number
  /** Exact analytical slope `dy/ds` (dimensionless; 0 on landings and endpoints). */
  readonly slope: number
  /** Exact analytical curvature `d²y/ds²` (1/m). */
  readonly curvature: number
  /** Discrete physical tread top elevation at `s` (meters, useful for foot placement / IK). */
  readonly discreteHeight: number
  /** 0-based current step index in `[0, count]`. */
  readonly stepIndex: number
  /** Fractional progress `[0, 1)` across the current tread (0 on flat landings). */
  readonly stepPhase: number
  /** Pitch angle `atan(slope)` in radians (> 0 climbing, < 0 descending). */
  readonly inclineRad: number
  /** Structural zone containing `s`. */
  readonly zone: StairZone
}

export interface StairPlacement {
  /** World-space origin at `s = 0, lateral = 0` (`origin.y` is used as `baseY` if profile omits `baseY`). */
  readonly origin: Vec3
  /**
   * Three.js camera yaw (radians) facing the `+s` traversal axis:
   * `forward = (-sin(yawRad), -cos(yawRad))`, `right = (cos(yawRad), -sin(yawRad))`.
   */
  readonly yawRad: number
  readonly profile: StairProfile
}

export interface StairWorldProjection {
  /** Unclamped signed longitudinal distance from `origin` along `+s` (meters). */
  readonly rawS: number
  /** Signed lateral offset from the stair centerline (+right, -left) (meters). */
  readonly lateral: number
  /** True when `rawS` lies in `[0, totalRun]` and `|lateral| <= width / 2`. */
  readonly inBounds: boolean
  /** Sampled stair geometry at `clamp(rawS, 0, totalRun)`. */
  readonly sample: StairSample
  /** Closest centerline world point at `sample.s, lateral = 0, y = sample.height`. */
  readonly centerlinePoint: Vec3
}

export interface StairEyeSmootherOptions {
  /** Eye offset above foot elevation in meters (default `1.6`). */
  readonly eyeOffset?: number
  /** Exponential smoothing time constant in seconds (default `0.045`). Smaller = tighter tracking. */
  readonly smoothTauSec?: number
  /** Hard safety ceiling on per-frame vertical displacement in meters (default `0.08`). */
  readonly maxDeltaYPerFrame?: number
  /** Pitch bias multiplier applied to `sample.inclineRad` (default `0.32`). */
  readonly pitchBiasScale?: number
  /** Pitch bias smoothing time constant in seconds (default `0.10`). */
  readonly pitchTauSec?: number
  /** Optional micro-cadence eye bob amplitude in meters (default `0`; always non-reversing if > 0). */
  readonly stepCadenceAmp?: number
}

export interface StairEyeState {
  readonly initialized: boolean
  readonly footY: number
  readonly eyeY: number
  readonly pitchBiasRad: number
  readonly lastDeltaY: number
}

export interface ScriptedStairOptions {
  readonly profile: StairProfile
  /** Optional 3D world placement. If omitted, runs along local `-Z` starting at `(0, baseY, 0)` (yaw 0). */
  readonly placement?: StairPlacement
  /** Nominal horizontal traversal speed in m/s (default `1.45`). Ignored when `durationSec` is set. */
  readonly speed?: number
  /** Explicit traversal duration in seconds (> 0). Overrides `speed` when provided. */
  readonly durationSec?: number
  /** Eye offset above foot elevation in meters (default `1.6`). */
  readonly eyeOffset?: number
  /** Initial lateral offset in meters smoothly blended to `targetLateral` (default `0`). */
  readonly startLateral?: number
  /** Final lateral offset in meters at traversal completion (default `0`). */
  readonly targetLateral?: number
  /** Eye-height smoother time constant in seconds (default `0.045`). */
  readonly smoothTauSec?: number
  /** Hard per-frame vertical displacement cap in meters (default `0.08`). */
  readonly maxDeltaYPerFrame?: number
  /** Gaze pitch bias multiplier relative to stair slope angle (default `0.32`). */
  readonly pitchBiasScale?: number
  /** Whether to gently ease horizontal speed in/out at the start and end (default `true`). */
  readonly easeEnds?: boolean
}

export interface ScriptedStairFrame {
  /** Elapsed time in seconds. */
  readonly elapsedSec: number
  /** Total planned duration in seconds. */
  readonly durationSec: number
  /** Normalized traversal progress in `[0, 1]`. */
  readonly progress: number
  /** True once traversal has landed at the final point. */
  readonly done: boolean
  /** Current world-space foot position. */
  readonly position: Vec3
  /** Current smoothed world-space eye elevation (`y`). */
  readonly eyeY: number
  /** World-space eye position `{ x: position.x, y: eyeY, z: position.z }`. */
  readonly eyePosition: Vec3
  /** Travel heading yaw in radians (Three.js camera yaw convention). */
  readonly yawRad: number
  /** Smooth gaze pitch bias in radians (0 at start and end landings). */
  readonly pitchBiasRad: number
  /** Vertical eye delta from previous frame (meters). */
  readonly deltaEyeY: number
  /** Current lateral offset in meters. */
  readonly lateral: number
  /** Underlying profile sample at current `s`. */
  readonly sample: StairSample
}

export interface StairLimbPose {
  /** Blend weight in `[0, 1]` (0 on flat landings, 1 on active flight steps). */
  readonly weight: number
  /** Pelvis vertical adjustment in meters relative to smooth foot curve. */
  readonly pelvisOffsetY: number
  /** Forward torso lean in radians (+ leans forward on ascent, slight upright brace on descent). */
  readonly torsoPitchX: number
  readonly thighLX: number
  readonly thighRX: number
  readonly shinLX: number
  readonly shinRX: number
  readonly armLX: number
  readonly armRX: number
  readonly forearmLX: number
  readonly forearmRX: number
}

export interface CameraLike {
  position: { set(x: number, y: number, z: number): unknown }
  rotation?: { x: number; y: number }
}

export interface JointRotationLike {
  x: number
  y: number
  z: number
  set(x: number, y: number, z: number): unknown
}

export interface JointHandleLike {
  rotation: JointRotationLike
}

export interface JointMapLike {
  readonly Torso?: JointHandleLike
  readonly ThighL?: JointHandleLike
  readonly ThighR?: JointHandleLike
  readonly ShinL?: JointHandleLike
  readonly ShinR?: JointHandleLike
  readonly ArmL?: JointHandleLike
  readonly ArmR?: JointHandleLike
  readonly ForearmL?: JointHandleLike
  readonly ForearmR?: JointHandleLike
}
