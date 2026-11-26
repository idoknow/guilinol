import {
  normalizeStairProfile,
  sampleStairProfile,
  stairBasisXZ,
} from './profile.ts'
import type {
  NormalizedStairProfile,
  ScriptedStairFrame,
  ScriptedStairOptions,
  StairDirection,
  StairEyeSmootherOptions,
  StairEyeState,
  StairLimbPose,
  StairSample,
  Vec3,
} from './types.ts'

const DEFAULT_EYE_OFFSET = 1.6
const DEFAULT_SMOOTH_TAU = 0.045
const DEFAULT_MAX_DELTA_Y = 0.08
const DEFAULT_PITCH_SCALE = 0.32
const DEFAULT_PITCH_TAU = 0.1
const DEFAULT_SPEED = 1.45

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function smoothstep01(u: number): number {
  const c = clamp(u, 0, 1)
  return c * c * (3 - 2 * c)
}

/**
 * Monotonic exponential damping helper.
 * Because `alpha = 1 - exp(-dt / tau) ∈ [0, 1]`, it never overshoots or reverses a monotonic target.
 */
function expDamp(current: number, target: number, dt: number, tau: number): number {
  if (dt <= 0) return current
  if (tau <= 1e-6) return target
  const alpha = 1 - Math.exp(-dt / tau)
  return current + (target - current) * alpha
}

export interface StairEyeSmoother {
  reset(footY: number, pitchBiasRad?: number): StairEyeState
  step(sample: StairSample, dtSec: number, settleBlend?: number): StairEyeState
  getState(): StairEyeState
}

/**
 * Smoothly tracks eye height and pitch bias across stairs/steps.
 * Guarantees monotonic convergence (no bounce/overshoot) and caps per-frame `|Δy| <= maxDeltaYPerFrame`.
 */
export function createStairEyeSmoother(opts: StairEyeSmootherOptions = {}): StairEyeSmoother {
  const eyeOffset = opts.eyeOffset ?? DEFAULT_EYE_OFFSET
  const smoothTauSec = Math.max(0, opts.smoothTauSec ?? DEFAULT_SMOOTH_TAU)
  const maxDeltaYPerFrame = Math.max(1e-4, opts.maxDeltaYPerFrame ?? DEFAULT_MAX_DELTA_Y)
  const pitchBiasScale = opts.pitchBiasScale ?? DEFAULT_PITCH_SCALE
  const pitchTauSec = Math.max(0, opts.pitchTauSec ?? DEFAULT_PITCH_TAU)

  let state: StairEyeState = {
    initialized: false,
    footY: 0,
    eyeY: eyeOffset,
    pitchBiasRad: 0,
    lastDeltaY: 0,
  }

  function reset(footY: number, pitchBiasRad = 0): StairEyeState {
    state = {
      initialized: true,
      footY,
      eyeY: footY + eyeOffset,
      pitchBiasRad,
      lastDeltaY: 0,
    }
    return state
  }

  function step(sample: StairSample, dtSec: number, settleBlend = 0): StairEyeState {
    const dt = Math.max(0, Number.isFinite(dtSec) ? dtSec : 0)
    const targetFootY = sample.height
    const targetEyeY = targetFootY + eyeOffset
    const targetPitch = sample.inclineRad * pitchBiasScale

    if (!state.initialized) {
      return reset(targetFootY, targetPitch)
    }

    // Effective tau shrinks smoothly toward 0 during final settle so endpoints converge cleanly.
    const settle = clamp(settleBlend, 0, 1)
    const effectiveTau = smoothTauSec * (1 - settle)
    const rawNextEyeY = expDamp(state.eyeY, targetEyeY, dt, effectiveTau)
    const rawDelta = rawNextEyeY - state.eyeY
    const clampedDelta = clamp(rawDelta, -maxDeltaYPerFrame, maxDeltaYPerFrame)
    const nextEyeY = state.eyeY + clampedDelta
    const nextFootY = nextEyeY - eyeOffset

    const effectivePitchTau = pitchTauSec * (1 - settle)
    const nextPitch = expDamp(state.pitchBiasRad, targetPitch, dt, effectivePitchTau)

    state = {
      initialized: true,
      footY: nextFootY,
      eyeY: nextEyeY,
      pitchBiasRad: nextPitch,
      lastDeltaY: clampedDelta,
    }
    return state
  }

  return {
    reset,
    step,
    getState: () => state,
  }
}

/**
 * C¹ monotonic ease-in / constant-cruise / ease-out progress remap `u ∈ [0, 1] -> [0, 1]`.
 * Keeps peak speed bounded (~1.15× nominal) while giving smooth acceleration at start and stop.
 */
function evalTraversalProgress(u: number, easeEnds: boolean): number {
  const c = clamp(u, 0, 1)
  if (!easeEnds) return c
  const ramp = 0.15
  // Integral of smoothstep ramp up over [0, ramp], 1 over [ramp, 1-ramp], ramp down over [1-ramp, 1]:
  // area = 0.5*ramp + (1 - 2*ramp) + 0.5*ramp = 1 - ramp.
  const normFactor = 1 / (1 - ramp)
  if (c < ramp) {
    const t = c / ramp
    const area = ramp * t * t * t * (1 - 0.5 * t)
    return clamp(area * normFactor, 0, 1)
  }
  if (c <= 1 - ramp) {
    const area = 0.5 * ramp + (c - ramp)
    return clamp(area * normFactor, 0, 1)
  }
  const t = (c - (1 - ramp)) / ramp
  const area = 0.5 * ramp + (1 - 2 * ramp) + ramp * (t - t * t * t + 0.5 * t * t * t * t)
  return clamp(area * normFactor, 0, 1)
}

export interface ScriptedStairTraversal {
  step(dtSec: number): ScriptedStairFrame
  sampleAtProgress(progress01: number): ScriptedStairFrame
  getState(): ScriptedStairFrame
  getStartPoint(): Vec3
  getEndPoint(): Vec3
  isDone(): boolean
  reset(opts?: { startLateral?: number }): ScriptedStairFrame
}

/**
 * Deterministic scripted traversal along a `StairProfile` / `StairPlacement`
 * (e.g. locked-input first-person stairwell entry or exit).
 * Guarantees:
 * - strictly monotonic footY and eyeY on ascent and descent
 * - per-frame `|Δy| <= maxDeltaYPerFrame` (default `0.08m`) at 60fps
 * - exact endpoint landing within `< 1e-6` (`<< 1e-3`) on completion
 */
export function createScriptedStairTraversal(opts: ScriptedStairOptions): ScriptedStairTraversal {
  const origin: Vec3 = opts.placement
    ? {
        x: opts.placement.origin.x,
        y: opts.profile.baseY ?? opts.placement.origin.y,
        z: opts.placement.origin.z,
      }
    : { x: 0, y: opts.profile.baseY ?? 0, z: 0 }
  const yawRad = opts.placement?.yawRad ?? 0
  const norm: NormalizedStairProfile = normalizeStairProfile({
    ...opts.profile,
    baseY: origin.y,
  })
  const basis = stairBasisXZ(yawRad)
  const eyeOffset = opts.eyeOffset ?? DEFAULT_EYE_OFFSET
  const maxDeltaYPerFrame = Math.max(1e-4, opts.maxDeltaYPerFrame ?? DEFAULT_MAX_DELTA_Y)
  const easeEnds = opts.easeEnds ?? true

  // Compute safe duration so peak vertical speed at 60fps stays well under maxDeltaYPerFrame.
  const nominalSpeed = Math.max(0.1, opts.speed ?? DEFAULT_SPEED)
  const requestedDuration =
    opts.durationSec !== undefined && Number.isFinite(opts.durationSec) && opts.durationSec > 0
      ? opts.durationSec
      : Math.max(0.25, norm.totalRun / nominalSpeed)

  // Safety floor on duration so even very steep flights never exceed maxDeltaYPerFrame at 60fps.
  const peakSpeedFactor = easeEnds ? 1 / (1 - 0.15) : 1
  const maxPeakSlope = norm.flights.reduce((acc, f) => Math.max(acc, Math.abs(f.peakSlope)), 0)
  const minSafeDuration =
    (norm.totalRun * peakSpeedFactor * maxPeakSlope) / Math.max(1e-4, maxDeltaYPerFrame * 60 * 0.85)
  const durationSec = Math.max(requestedDuration, minSafeDuration)

  let startLateral = opts.startLateral ?? 0
  const targetLateral = opts.targetLateral ?? 0

  const smoother = createStairEyeSmoother({
    eyeOffset,
    smoothTauSec: opts.smoothTauSec ?? DEFAULT_SMOOTH_TAU,
    maxDeltaYPerFrame,
    pitchBiasScale: opts.pitchBiasScale ?? DEFAULT_PITCH_SCALE,
  })

  function worldPoint(s: number, lateral: number, footY: number): Vec3 {
    return {
      x: origin.x + basis.forwardX * s + basis.rightX * lateral,
      y: footY,
      z: origin.z + basis.forwardZ * s + basis.rightZ * lateral,
    }
  }

  function lateralAt(u: number): number {
    // Center lateral offset smoothly across the first 45% of traversal so player enters the flight aligned.
    const blend = smoothstep01(u / 0.45)
    return startLateral + (targetLateral - startLateral) * blend
  }

  let elapsedSec = 0
  let currentFrame: ScriptedStairFrame = buildInitialFrame()

  function buildInitialFrame(): ScriptedStairFrame {
    const sample = sampleStairProfile(norm, 0)
    const eyeState = smoother.reset(sample.height, 0)
    const pos = worldPoint(0, startLateral, sample.height)
    return {
      elapsedSec: 0,
      durationSec,
      progress: 0,
      done: false,
      position: pos,
      eyeY: eyeState.eyeY,
      eyePosition: { x: pos.x, y: eyeState.eyeY, z: pos.z },
      yawRad,
      pitchBiasRad: eyeState.pitchBiasRad,
      deltaEyeY: 0,
      lateral: startLateral,
      sample,
    }
  }

  function step(dtSec: number): ScriptedStairFrame {
    if (currentFrame.done) {
      return {
        ...currentFrame,
        deltaEyeY: 0,
      }
    }
    const dt = Math.max(0, Number.isFinite(dtSec) ? dtSec : 0)
    elapsedSec = Math.min(durationSec, elapsedSec + dt)
    const u = durationSec > 0 ? clamp(elapsedSec / durationSec, 0, 1) : 1
    const sProgress = evalTraversalProgress(u, easeEnds)
    const s = sProgress * norm.totalRun
    const sample = sampleStairProfile(norm, s)
    const lateral = lateralAt(u)

    // Smoothly tighten eye smoother during the final 15% (where slope decays to 0) so landing is exact.
    const settleBlend = u >= 0.85 ? smoothstep01((u - 0.85) / 0.15) : 0
    const eyeState = smoother.step(sample, dt, settleBlend)

    const atEnd = elapsedSec >= durationSec - 1e-9
    let finalEyeY = eyeState.eyeY
    let finalDeltaY = eyeState.lastDeltaY
    let finalPitch = eyeState.pitchBiasRad
    let finalFootY = sample.height
    let done = false

    if (atEnd) {
      const targetEndEyeY = norm.endY + eyeOffset
      const remaining = targetEndEyeY - currentFrame.eyeY
      if (Math.abs(remaining) <= maxDeltaYPerFrame + 1e-9) {
        finalEyeY = targetEndEyeY
        finalDeltaY = remaining
        finalFootY = norm.endY
        finalPitch = 0
        done = true
      } else {
        // Rare case (e.g. huge caller dt spike): step cleanly toward endY without violating maxDeltaYPerFrame.
        const clampedStep = clamp(remaining, -maxDeltaYPerFrame, maxDeltaYPerFrame)
        finalEyeY = currentFrame.eyeY + clampedStep
        finalDeltaY = clampedStep
        finalFootY = finalEyeY - eyeOffset
        done = false
      }
    }

    const pos = worldPoint(done ? norm.totalRun : sample.s, done ? targetLateral : lateral, finalFootY)
    currentFrame = {
      elapsedSec,
      durationSec,
      progress: done ? 1 : u,
      done,
      position: pos,
      eyeY: finalEyeY,
      eyePosition: { x: pos.x, y: finalEyeY, z: pos.z },
      yawRad,
      pitchBiasRad: finalPitch,
      deltaEyeY: finalDeltaY,
      lateral: done ? targetLateral : lateral,
      sample: done ? sampleStairProfile(norm, norm.totalRun) : sample,
    }
    return currentFrame
  }

  function sampleAtProgress(progress01: number): ScriptedStairFrame {
    const u = clamp(progress01, 0, 1)
    const sProgress = evalTraversalProgress(u, easeEnds)
    const s = sProgress * norm.totalRun
    const sample = sampleStairProfile(norm, s)
    const lateral = lateralAt(u)
    const pos = worldPoint(sample.s, lateral, sample.height)
    const eyeY = sample.height + eyeOffset
    return {
      elapsedSec: u * durationSec,
      durationSec,
      progress: u,
      done: u >= 1,
      position: pos,
      eyeY,
      eyePosition: { x: pos.x, y: eyeY, z: pos.z },
      yawRad,
      pitchBiasRad: sample.inclineRad * (opts.pitchBiasScale ?? DEFAULT_PITCH_SCALE),
      deltaEyeY: 0,
      lateral,
      sample,
    }
  }

  return {
    step,
    sampleAtProgress,
    getState: () => currentFrame,
    getStartPoint: () => worldPoint(0, startLateral, norm.baseY),
    getEndPoint: () => worldPoint(norm.totalRun, targetLateral, norm.endY),
    isDone: () => currentFrame.done,
    reset(nextOpts) {
      elapsedSec = 0
      if (nextOpts?.startLateral !== undefined) {
        startLateral = nextOpts.startLateral
      }
      currentFrame = buildInitialFrame()
      return currentFrame
    },
  }
}

export interface ComputeStairLimbPoseOptions {
  /** Traversal speed in m/s (default `1.45`). Controls arm/leg cadence weight. */
  readonly speed?: number
  /** Traversal direction override (inferred from `sample.slope` when omitted). */
  readonly direction?: StairDirection
}

/**
 * Pure procedural stair-stepping limb pose generator compatible with Guilin OL's `AvatarJointMap`
 * (`ThighL/R`, `ShinL/R`, `ArmL/R`, `ForearmL/R`, `Torso`).
 * Smoothly fades to `weight = 0` on flat landings (`slope = 0`) so transitions never pop.
 */
export function computeStairLimbPose(
  sample: StairSample,
  opts: ComputeStairLimbPoseOptions = {},
): StairLimbPose {
  const slopeMag = Math.abs(sample.slope)
  const speed = Math.max(0, opts.speed ?? DEFAULT_SPEED)
  const speedWeight = clamp(speed / 0.6, 0, 1)
  const slopeWeight = smoothstep01(slopeMag / 0.25)
  const weight = slopeWeight * speedWeight

  if (weight <= 1e-5) {
    return {
      weight: 0,
      pelvisOffsetY: 0,
      torsoPitchX: 0,
      thighLX: 0,
      thighRX: 0,
      shinLX: 0,
      shinRX: 0,
      armLX: 0,
      armRX: 0,
      forearmLX: 0,
      forearmRX: 0,
    }
  }

  const ascending = opts.direction ? opts.direction === 'up' : sample.slope >= 0
  // Alternate left/right legs every step: even stepIndex drives left lift, odd drives right lift.
  const cycleRad = (sample.stepIndex + sample.stepPhase) * Math.PI
  const swing = Math.sin(cycleRad)
  const liftL = Math.max(0, swing)
  const liftR = Math.max(0, -swing)
  const plantL = Math.max(0, -swing)
  const plantR = Math.max(0, swing)

  const gradeScale = clamp(slopeMag / 0.55, 0.45, 1.35)
  const torsoPitchX = (ascending ? 0.14 : -0.06) * gradeScale * weight
  const pelvisOffsetY = (ascending ? -0.035 : -0.045) * Math.abs(Math.cos(cycleRad)) * weight

  // Positive Thigh X lifts knee forward; negative Shin X bends knee back (matching walk/avatar-rig.ts).
  const thighLift = (ascending ? 0.82 : 0.48) * gradeScale
  const thighTrail = (ascending ? -0.24 : -0.18) * gradeScale
  const shinLift = (ascending ? -1.08 : -0.78) * gradeScale
  const shinPlant = (ascending ? -0.28 : -0.46) * gradeScale

  const thighLX = (thighLift * liftL + thighTrail * plantL) * weight
  const thighRX = (thighLift * liftR + thighTrail * plantR) * weight
  const shinLX = (shinLift * liftL + shinPlant * plantL) * weight
  const shinRX = (shinLift * liftR + shinPlant * plantR) * weight

  // Natural counter-swinging arms.
  const armAmp = (ascending ? 0.46 : 0.32) * weight
  const armLX = -swing * armAmp
  const armRX = swing * armAmp
  const forearmLX = (ascending ? 0.36 : 0.24) * weight
  const forearmRX = (ascending ? 0.36 : 0.24) * weight

  return {
    weight,
    pelvisOffsetY,
    torsoPitchX,
    thighLX,
    thighRX,
    shinLX,
    shinRX,
    armLX,
    armRX,
    forearmLX,
    forearmRX,
  }
}
