import type {
  NormalizedStairProfile,
  StairDirection,
  StairFlightSegment,
  StairLanding,
  StairMidLanding,
  StairPlacement,
  StairProfile,
  StairSample,
  StairWorldProjection,
  StairZone,
  Vec3,
} from './types.ts'

const EPS = 1e-9

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** C¹ smoothstep `S(u) = 3u² - 2u³` on `[0, 1]`, with `S(0)=0, S(1)=1, S'(0)=S'(1)=0`. */
function smoothstep(u: number): number {
  const c = clamp(u, 0, 1)
  return c * c * (3 - 2 * c)
}

/** Derivative of smoothstep `S'(u) = 6u(1 - u)`. */
function smoothstepDeriv(u: number): number {
  const c = clamp(u, 0, 1)
  return 6 * c * (1 - c)
}

/** Exact antiderivative `∫₀ᵘ (3t² - 2t³) dt = u³(1 - 0.5u)`, with `I(0)=0, I(1)=0.5`. */
function integrateSmoothstep(u: number): number {
  const c = clamp(u, 0, 1)
  const c3 = c * c * c
  return c3 * (1 - 0.5 * c)
}

/** Exact antiderivative `∫₀ᵘ (1 - S(t)) dt = u - u³ + 0.5u⁴`, with `I(0)=0, I(1)=0.5`. */
function integrateOneMinusSmoothstep(u: number): number {
  const c = clamp(u, 0, 1)
  const c3 = c * c * c
  return c - c3 + 0.5 * c3 * c
}

function resolveLanding(profile: StairProfile): StairLanding {
  const { landing, landingTop, landingFoot } = profile
  if (landing !== undefined) {
    if (typeof landing === 'number') return { entry: landing, exit: landing }
    return { entry: landing.entry, exit: landing.exit }
  }
  if (landingTop !== undefined || landingFoot !== undefined) {
    const top = landingTop ?? 0
    const foot = landingFoot ?? 0
    return (profile.direction ?? 'up') === 'down'
      ? { entry: top, exit: foot }
      : { entry: foot, exit: top }
  }
  return { entry: 0, exit: 0 }
}

/** Validates a `StairProfile`, returning an empty array when valid or human-readable error strings. */
export function validateStairProfile(profile: StairProfile): string[] {
  const errors: string[] = []
  if (!Number.isFinite(profile.riser) || profile.riser <= 0) {
    errors.push(`riser must be a finite number > 0 (got ${String(profile.riser)})`)
  }
  if (!Number.isFinite(profile.tread) || profile.tread <= 0) {
    errors.push(`tread must be a finite number > 0 (got ${String(profile.tread)})`)
  }
  if (!Number.isInteger(profile.count) || profile.count < 1) {
    errors.push(`count must be an integer >= 1 (got ${String(profile.count)})`)
  }
  if (profile.landingTop !== undefined && (!Number.isFinite(profile.landingTop) || profile.landingTop < 0)) {
    errors.push(`landingTop must be >= 0 (got ${String(profile.landingTop)})`)
  }
  if (profile.landingFoot !== undefined && (!Number.isFinite(profile.landingFoot) || profile.landingFoot < 0)) {
    errors.push(`landingFoot must be >= 0 (got ${String(profile.landingFoot)})`)
  }
  const landing = resolveLanding(profile)
  if (!Number.isFinite(landing.entry) || landing.entry < 0) {
    errors.push(`landing.entry must be >= 0 (got ${String(landing.entry)})`)
  }
  if (!Number.isFinite(landing.exit) || landing.exit < 0) {
    errors.push(`landing.exit must be >= 0 (got ${String(landing.exit)})`)
  }
  if (profile.midLanding !== undefined) {
    const { afterStep, length } = profile.midLanding
    if (!Number.isInteger(afterStep) || afterStep < 1 || afterStep >= profile.count) {
      errors.push(`midLanding.afterStep must be an integer in [1, count-1] (got ${String(afterStep)})`)
    }
    if (!Number.isFinite(length) || length <= 0) {
      errors.push(`midLanding.length must be > 0 (got ${String(length)})`)
    }
  }
  if (profile.shoulderLength !== undefined && (!Number.isFinite(profile.shoulderLength) || profile.shoulderLength < 0)) {
    errors.push(`shoulderLength must be >= 0 (got ${String(profile.shoulderLength)})`)
  }
  if (profile.baseY !== undefined && !Number.isFinite(profile.baseY)) {
    errors.push(`baseY must be finite (got ${String(profile.baseY)})`)
  }
  if (profile.width !== undefined && (!Number.isFinite(profile.width) || profile.width <= 0)) {
    errors.push(`width must be > 0 (got ${String(profile.width)})`)
  }
  if (profile.direction !== undefined && profile.direction !== 'up' && profile.direction !== 'down') {
    errors.push(`direction must be 'up' or 'down' (got ${String(profile.direction)})`)
  }
  return errors
}

function buildFlightSegment(
  index: number,
  flightStart: number,
  stepOffset: number,
  stepCount: number,
  tread: number,
  riser: number,
  sign: 1 | -1,
  startY: number,
  availBefore: number,
  availAfter: number,
  requestedShoulder: number,
): StairFlightSegment {
  const flightLen = stepCount * tread
  const flightEnd = flightStart + flightLen
  const deltaY = sign * stepCount * riser
  const endY = startY + deltaY

  const halfReq = requestedShoulder * 0.5
  const extIn = Math.min(halfReq, availBefore)
  const intIn = Math.min(halfReq, flightLen * 0.45)
  const extOut = Math.min(halfReq, availAfter)
  const intOut = Math.min(halfReq, flightLen * 0.45)

  const shoulderInStart = flightStart - extIn
  const shoulderInEnd = flightStart + intIn
  const shoulderOutStart = flightEnd - intOut
  const shoulderOutEnd = flightEnd + extOut

  const dIn = shoulderInEnd - shoulderInStart
  const dOut = shoulderOutEnd - shoulderOutStart
  const midLen = Math.max(0, shoulderOutStart - shoulderInEnd)
  const effectiveArea = 0.5 * dIn + midLen + 0.5 * dOut
  const peakSlope = effectiveArea > EPS ? deltaY / effectiveArea : 0

  return {
    index,
    flightStart,
    flightEnd,
    shoulderInStart,
    shoulderInEnd,
    shoulderOutStart,
    shoulderOutEnd,
    startY,
    endY,
    peakSlope,
    stepOffset,
    stepCount,
  }
}

/**
 * Normalizes and validates a `StairProfile` into precomputed C² flight segments.
 * Throws if the profile parameters are invalid.
 */
export function normalizeStairProfile(profile: StairProfile): NormalizedStairProfile {
  const errors = validateStairProfile(profile)
  if (errors.length > 0) {
    throw new Error(`Invalid StairProfile: ${errors.join('; ')}`)
  }

  const landing = resolveLanding(profile)
  const direction: StairDirection = profile.direction ?? 'up'
  const sign: 1 | -1 = direction === 'down' ? -1 : 1
  const baseY = profile.baseY ?? 0
  const width = profile.width ?? 2.4
  const midLanding: StairMidLanding | null = profile.midLanding ?? null
  const shoulderLength = profile.shoulderLength ?? Math.min(profile.tread * 1.5, 0.55)

  const totalRise = profile.count * profile.riser
  const endY = baseY + sign * totalRise

  const flights: StairFlightSegment[] = []
  let totalRun = 0

  if (midLanding) {
    const firstSteps = midLanding.afterStep
    const secondSteps = profile.count - firstSteps
    const f1Start = landing.entry
    const f1 = buildFlightSegment(
      0,
      f1Start,
      0,
      firstSteps,
      profile.tread,
      profile.riser,
      sign,
      baseY,
      landing.entry,
      midLanding.length * 0.5,
      shoulderLength,
    )
    const f2Start = f1.flightEnd + midLanding.length
    const f2 = buildFlightSegment(
      1,
      f2Start,
      firstSteps,
      secondSteps,
      profile.tread,
      profile.riser,
      sign,
      f1.endY,
      midLanding.length * 0.5,
      landing.exit,
      shoulderLength,
    )
    flights.push(f1, f2)
    totalRun = f2.flightEnd + landing.exit
  } else {
    const f1 = buildFlightSegment(
      0,
      landing.entry,
      0,
      profile.count,
      profile.tread,
      profile.riser,
      sign,
      baseY,
      landing.entry,
      landing.exit,
      shoulderLength,
    )
    flights.push(f1)
    totalRun = f1.flightEnd + landing.exit
  }

  return {
    riser: profile.riser,
    tread: profile.tread,
    count: profile.count,
    landing,
    midLanding,
    shoulderLength,
    direction,
    sign,
    baseY,
    endY,
    totalRise,
    totalRun,
    width,
    nominalSlope: (sign * profile.riser) / profile.tread,
    flights,
  }
}

function isNormalized(p: StairProfile | NormalizedStairProfile): p is NormalizedStairProfile {
  return 'flights' in p && Array.isArray(p.flights) && 'totalRun' in p
}

function sampleDiscreteAt(norm: NormalizedStairProfile, s: number): {
  discreteHeight: number
  stepIndex: number
  stepPhase: number
} {
  for (const flight of norm.flights) {
    if (s < flight.flightStart) {
      return {
        discreteHeight: flight.startY,
        stepIndex: flight.stepOffset,
        stepPhase: 0,
      }
    }
    if (s < flight.flightEnd) {
      const localS = s - flight.flightStart
      const exactStep = localS / norm.tread
      const withinFlight = Math.min(flight.stepCount - 1, Math.floor(exactStep))
      const stepPhase = clamp(exactStep - withinFlight, 0, 1 - 1e-12)
      const stepIndex = flight.stepOffset + withinFlight
      // On ascent, stepping onto tread k elevates foot to (k + 1) * riser; on descent, steps down after tread edge.
      const completedSteps = norm.sign > 0 ? withinFlight + 1 : withinFlight + (stepPhase > 0 ? 1 : 0)
      return {
        discreteHeight: flight.startY + norm.sign * completedSteps * norm.riser,
        stepIndex,
        stepPhase,
      }
    }
  }
  return {
    discreteHeight: norm.endY,
    stepIndex: norm.count,
    stepPhase: 0,
  }
}

/**
 * Samples smooth C² continuous height, exact slope `dy/ds`, curvature `d²y/ds²`,
 * discrete tread height, step index/phase, and zone at longitudinal coordinate `s`.
 */
export function sampleStairProfile(
  profile: StairProfile | NormalizedStairProfile,
  rawS: number,
): StairSample {
  const norm = isNormalized(profile) ? profile : normalizeStairProfile(profile)
  const s = clamp(rawS, 0, norm.totalRun)
  const t = norm.totalRun > EPS ? s / norm.totalRun : 0
  const discrete = sampleDiscreteAt(norm, s)

  for (let i = 0; i < norm.flights.length; i++) {
    const f = norm.flights[i]!
    if (s <= f.shoulderInStart) {
      const zone: StairZone = i === 0 ? 'entry-landing' : 'mid-landing'
      return {
        s,
        t,
        height: f.startY,
        slope: 0,
        curvature: 0,
        discreteHeight: discrete.discreteHeight,
        stepIndex: discrete.stepIndex,
        stepPhase: discrete.stepPhase,
        inclineRad: 0,
        zone,
      }
    }

    if (s < f.shoulderOutEnd) {
      const dIn = f.shoulderInEnd - f.shoulderInStart
      const dOut = f.shoulderOutEnd - f.shoulderOutStart
      const yAfterIn = f.startY + 0.5 * f.peakSlope * dIn
      const midLen = f.shoulderOutStart - f.shoulderInEnd
      const yAfterMid = yAfterIn + f.peakSlope * midLen

      if (dIn > EPS && s < f.shoulderInEnd) {
        const u = (s - f.shoulderInStart) / dIn
        const height = f.startY + f.peakSlope * dIn * integrateSmoothstep(u)
        const slope = f.peakSlope * smoothstep(u)
        const curvature = (f.peakSlope / dIn) * smoothstepDeriv(u)
        return {
          s,
          t,
          height,
          slope,
          curvature,
          discreteHeight: discrete.discreteHeight,
          stepIndex: discrete.stepIndex,
          stepPhase: discrete.stepPhase,
          inclineRad: Math.atan(slope),
          zone: 'entry-shoulder',
        }
      }

      if (s <= f.shoulderOutStart) {
        const height = yAfterIn + f.peakSlope * (s - f.shoulderInEnd)
        const slope = f.peakSlope
        return {
          s,
          t,
          height,
          slope,
          curvature: 0,
          discreteHeight: discrete.discreteHeight,
          stepIndex: discrete.stepIndex,
          stepPhase: discrete.stepPhase,
          inclineRad: Math.atan(slope),
          zone: 'flight',
        }
      }

      if (dOut > EPS) {
        const u = (s - f.shoulderOutStart) / dOut
        const height = yAfterMid + f.peakSlope * dOut * integrateOneMinusSmoothstep(u)
        const slope = f.peakSlope * (1 - smoothstep(u))
        const curvature = -(f.peakSlope / dOut) * smoothstepDeriv(u)
        return {
          s,
          t,
          height,
          slope,
          curvature,
          discreteHeight: discrete.discreteHeight,
          stepIndex: discrete.stepIndex,
          stepPhase: discrete.stepPhase,
          inclineRad: Math.atan(slope),
          zone: 'exit-shoulder',
        }
      }
    }
  }

  return {
    s,
    t,
    height: norm.endY,
    slope: 0,
    curvature: 0,
    discreteHeight: norm.endY,
    stepIndex: norm.count,
    stepPhase: 0,
    inclineRad: 0,
    zone: 'exit-landing',
  }
}

/** Returns Three.js camera-convention forward & right unit XZ vectors for `yawRad`. */
export function stairBasisXZ(yawRad: number): {
  forwardX: number
  forwardZ: number
  rightX: number
  rightZ: number
} {
  const sinY = Math.sin(yawRad)
  const cosY = Math.cos(yawRad)
  return {
    forwardX: -sinY,
    forwardZ: -cosY,
    rightX: cosY,
    rightZ: -sinY,
  }
}

/** Converts stair-local `(s, lateral, yOffset)` into 3D world space using `placement`. */
export function stairLocalToWorld(
  placement: StairPlacement,
  s: number,
  lateral = 0,
  yOffset = 0,
): Vec3 {
  const norm = normalizeStairProfile({
    ...placement.profile,
    baseY: placement.profile.baseY ?? placement.origin.y,
  })
  const sample = sampleStairProfile(norm, s)
  const basis = stairBasisXZ(placement.yawRad)
  return {
    x: placement.origin.x + basis.forwardX * s + basis.rightX * lateral,
    y: sample.height + yOffset,
    z: placement.origin.z + basis.forwardZ * s + basis.rightZ * lateral,
  }
}

/** Projects a 3D world position onto a `StairPlacement`, returning progress, lateral offset, and sample. */
export function projectWorldToStair(
  placement: StairPlacement,
  worldPos: Vec3,
): StairWorldProjection {
  const norm = normalizeStairProfile({
    ...placement.profile,
    baseY: placement.profile.baseY ?? placement.origin.y,
  })
  const basis = stairBasisXZ(placement.yawRad)
  const dx = worldPos.x - placement.origin.x
  const dz = worldPos.z - placement.origin.z
  const rawS = dx * basis.forwardX + dz * basis.forwardZ
  const lateral = dx * basis.rightX + dz * basis.rightZ
  const sample = sampleStairProfile(norm, rawS)
  const inBounds = rawS >= -EPS && rawS <= norm.totalRun + EPS && Math.abs(lateral) <= norm.width * 0.5 + EPS
  return {
    rawS,
    lateral,
    inBounds,
    sample,
    centerlinePoint: {
      x: placement.origin.x + basis.forwardX * sample.s,
      y: sample.height,
      z: placement.origin.z + basis.forwardZ * sample.s,
    },
  }
}

export interface CreatePlacementFromEndpointsOptions {
  /** Desired nominal riser height in meters (default `0.15`). Adjusted slightly so `count * riser = |Δy|` exactly. */
  readonly targetRiser?: number
  /** Flat approach/departure landing length (default `0`). */
  readonly landing?: number | StairLanding
  /** Optional smooth shoulder length in meters. */
  readonly shoulderLength?: number
  /** Stair width in meters (default `2.4`). */
  readonly width?: number
}

/**
 * Builds an exact `StairPlacement` connecting arbitrary 3D `start` and `end` world endpoints.
 * Guarantees `stairLocalToWorld(placement, 0) === start` and `stairLocalToWorld(placement, totalRun) === end`.
 */
export function createStairPlacementFromEndpoints(
  start: Vec3,
  end: Vec3,
  opts: CreatePlacementFromEndpointsOptions = {},
): StairPlacement {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const dy = end.y - start.y
  const horizDist = Math.hypot(dx, dz)
  if (!Number.isFinite(horizDist) || horizDist <= EPS) {
    throw new Error('createStairPlacementFromEndpoints requires distinct XZ endpoints')
  }
  const absRise = Math.abs(dy)
  if (!Number.isFinite(absRise) || absRise <= EPS) {
    throw new Error('createStairPlacementFromEndpoints requires non-zero elevation change')
  }
  const landing = resolveLanding({ riser: 0.15, tread: 0.3, count: 1, landing: opts.landing })
  const flightRun = horizDist - landing.entry - landing.exit
  if (flightRun <= EPS) {
    throw new Error('Landing lengths exceed horizontal distance between endpoints')
  }
  const targetRiser = opts.targetRiser ?? 0.15
  const count = Math.max(1, Math.round(absRise / targetRiser))
  const riser = absRise / count
  const tread = flightRun / count
  const yawRad = Math.atan2(-dx, -dz)
  const direction: StairDirection = dy >= 0 ? 'up' : 'down'

  return {
    origin: { x: start.x, y: start.y, z: start.z },
    yawRad,
    profile: {
      riser,
      tread,
      count,
      landing,
      shoulderLength: opts.shoulderLength,
      direction,
      baseY: start.y,
      width: opts.width,
    },
  }
}

/** Generic reusable architectural presets (no landmark-specific coordinates). */
export const STAIR_PRESETS = {
  /** Single street curb or threshold step (15 cm). */
  curb: {
    riser: 0.15,
    tread: 0.32,
    count: 1,
    landing: 0.35,
    width: 2.0,
    direction: 'up',
  } satisfies StairProfile,

  /** Short 3-step entrance stoop (48 cm rise). */
  stoop: {
    riser: 0.16,
    tread: 0.3,
    count: 3,
    landing: 0.5,
    width: 2.4,
    direction: 'up',
  } satisfies StairProfile,

  /** Standard interior floor-to-floor building staircase (18 steps, 2.97 m rise). */
  buildingFlight: {
    riser: 0.165,
    tread: 0.28,
    count: 18,
    landing: 1.0,
    width: 1.6,
    direction: 'up',
  } satisfies StairProfile,

  /** Standard pedestrian underpass descent (28 steps, 4.2 m drop, top/bottom landings). */
  underpassDescent: {
    riser: 0.15,
    tread: 0.3,
    count: 28,
    landing: { entry: 0.6, exit: 0.8 },
    width: 3.4,
    direction: 'down',
  } satisfies StairProfile,
} as const
