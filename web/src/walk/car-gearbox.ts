/**
 * Car ignition, electronic column shifter (P / R / N / D), pedal translation,
 * and unattended non-P rollaway simulation (IDOK-546).
 *
 * Orthogonal to `car.ts` drive modes (`cruise` / `street` / `sport`) and 5-speed
 * internal ratio calculation so `car.ts` and `scripts/check-car-physics.mjs` stay 100% untouched.
 */

export type CarIgnitionState = 'off' | 'cranking' | 'on'
export type CarGearSelector = 'P' | 'R' | 'N' | 'D'

export const GEARBOX = {
  /** Starter motor cranking duration (s). */
  crankSec: 0.85,
  /** Maximum speed (m/s) allowed to shift into or out of P. */
  parkMaxSpeed: 0.45,
  /** Maximum speed (m/s) allowed to shift between D and R. */
  reverseMaxSpeed: 1.2,
  /** Maximum speed (m/s) allowed to switch ignition off. */
  offMaxSpeed: 0.5,
  /** Idle torque-converter creep speeds (m/s). */
  creepSpeed: 1.55,
  creepReverse: 1.1,
  /** Forward pedal value sent to carCtrl to sustain smooth idle creep (above stickDeadFwd 0.08). */
  creepPedal: 0.16,
  /** Engine start RPM flare duration (s). */
  revFlareSec: 0.4,
  /** Unattended rollaway safety limits (m, s, m/s). */
  rollawayMaxCreepDistM: 2.2,
  rollawayMaxSlopeDistM: 3.5,
  rollawayMaxDurationSec: 3.5,
  rollawayMaxSpeedMs: 1.4,
  rollawaySlopeMinRad: 0.0175, // ~1.0 deg
} as const

export interface CarGearboxAssist {
  /** Auto-crank ignition on mount (default true on touch devices until IDOK-544 controls ship). */
  autoIgnite: boolean
  /** Auto-shift P -> D on first throttle press after ignition is on (touch convenience). */
  autoDrive: boolean
  /** Require brake pedal held to leave P (default false for smooth desktop flow). */
  shiftLock: boolean
  /** Automatically engage EPB on exit (always false by default in strict mode so unparked rollaway occurs). */
  autoEpbOnExit: boolean
}

export type CarGearboxRejectReason =
  | 'not_in_car'
  | 'not_strict'
  | 'engine_off'
  | 'cranking'
  | 'speed_too_high'
  | 'brake_required'

export type CarGearboxEvent =
  | {type: 'crank_start'}
  | {type: 'engine_started'}
  | {type: 'engine_stopped'}
  | {type: 'shifted'; from: CarGearSelector; to: CarGearSelector; engageKick: number}
  | {type: 'reject'; action: 'ignition' | 'shift' | 'throttle' | 'reverse_hint'; reason: CarGearboxRejectReason; text: string}

export type CarDismountPlan = 'safe' | 'auto_off' | 'creep_fwd' | 'creep_rev' | 'coast' | 'unsecured_flat'

export interface CarGearboxSnapshot {
  strict: boolean
  ignition: CarIgnitionState
  selector: CarGearSelector
  display: string
  engineRunning: boolean
  crankProgress: number
  crankDimFactor: number
  hazard: boolean
  canShift: {P: boolean; R: boolean; N: boolean; D: boolean}
  assist: CarGearboxAssist
}

export interface CarGearboxResult {
  ok: boolean
  state: CarGearboxSnapshot
  reason?: CarGearboxRejectReason
  text?: string
  event?: CarGearboxEvent
}

export interface CarGearboxPersisted {
  ignition: CarIgnitionState
  selector: CarGearSelector
  hazard: boolean
}

export function resolveCarStrict(ctx: {verify: boolean; param: string | null}): boolean {
  if (ctx.param === '1' || ctx.param === 'true') return true
  if (ctx.param === '0' || ctx.param === 'false') return false
  return !ctx.verify
}

export interface CarGearboxController {
  readonly strict: boolean
  readonly ignitionState: CarIgnitionState
  readonly selector: CarGearSelector
  readonly engineRunning: boolean
  readonly hazard: boolean
  readonly crankProgress: number
  readonly crankDimFactor: number
  readonly revFlare: number
  readonly idleRpm: number
  setStrict: (on: boolean) => void
  setAssist: (patch: Partial<CarGearboxAssist>) => void
  getAssist: () => CarGearboxAssist
  setHazard: (on: boolean) => boolean
  toggleHazard: () => boolean
  resetForMount: (saved?: Partial<CarGearboxPersisted>) => void
  ignition: (on?: boolean, speedMs?: number) => CarGearboxResult
  shift: (target: CarGearSelector, ctx: {speedMs: number; brake?: boolean}) => CarGearboxResult
  lever: (dir: 'up' | 'down', ctx: {speedMs: number; brake?: boolean}) => CarGearboxResult
  tick: (dt: number) => CarGearboxEvent | 0
  /** Translates driver W/S input into forward command fed to `carCtrl.steer`. */
  pedals: (fwd: number, vLong: number, dt?: number) => {forward: number; holdBrake: boolean; revThrottle: number; hint?: CarGearboxEvent}
  brakeLamp: (fwd: number, vLong: number, handbrake: boolean) => boolean
  reverseLamp: () => boolean
  displayGear: (innerGear: number) => string
  planDismount: (pitchRad: number) => CarDismountPlan
  snapshot: (innerGear?: number, speedMs?: number, brake?: boolean) => CarGearboxSnapshot
  persist: () => CarGearboxPersisted
}

export function createCarGearbox(options?: {
  strict?: boolean
  assist?: Partial<CarGearboxAssist>
}): CarGearboxController {
  let strict = options?.strict ?? true
  const assist: CarGearboxAssist = {
    autoIgnite: options?.assist?.autoIgnite ?? false,
    autoDrive: options?.assist?.autoDrive ?? false,
    shiftLock: options?.assist?.shiftLock ?? false,
    autoEpbOnExit: options?.assist?.autoEpbOnExit ?? false,
  }

  let ignitionState: CarIgnitionState = 'off'
  let selector: CarGearSelector = 'P'
  let hazard = false
  let crankElapsed = 0
  let revFlareTimer = 0
  let throttleHintCooldown = 0
  let revHoldPromptSec = 0

  function displayGear(innerGear: number): string {
    if (!strict) {
      if (innerGear < 0) return 'R'
      if (innerGear === 0) return 'N'
      return `D${innerGear}`
    }
    if (selector === 'P') return 'P'
    if (selector === 'R') return 'R'
    if (selector === 'N') return 'N'
    const n = Math.max(1, Math.min(5, innerGear > 0 ? innerGear : 1))
    return `D${n}`
  }

  function crankProgressValue(): number {
    if (ignitionState === 'on') return 1
    if (ignitionState === 'off') return 0
    return Math.max(0, Math.min(1, crankElapsed / GEARBOX.crankSec))
  }

  function crankDimValue(): number {
    if (ignitionState === 'off') return 0
    if (ignitionState === 'cranking') {
      // Realistic battery voltage sag during starter crank (dips to 0.55 then rebounds)
      const p = crankProgressValue()
      return 0.55 + 0.35 * Math.pow(p, 2)
    }
    return 1
  }

  function computeCanShift(speedMs: number, brake: boolean): {P: boolean; R: boolean; N: boolean; D: boolean} {
    const absSpd = Math.abs(speedMs)
    if (!strict) return {P: false, R: true, N: true, D: true}
    const running = ignitionState === 'on'
    const leavePAllowed = running && absSpd <= GEARBOX.parkMaxSpeed && (!assist.shiftLock || brake)
    const inP = selector === 'P'
    return {
      P: absSpd <= GEARBOX.parkMaxSpeed,
      N: inP ? leavePAllowed : true,
      D: inP ? leavePAllowed : running && (selector === 'D' || selector === 'N' || absSpd <= GEARBOX.reverseMaxSpeed),
      R: inP ? leavePAllowed : running && (selector === 'R' || selector === 'N' || absSpd <= GEARBOX.reverseMaxSpeed),
    }
  }

  function snapshot(innerGear = 1, speedMs = 0, brake = false): CarGearboxSnapshot {
    return {
      strict,
      ignition: strict ? ignitionState : 'on',
      selector: strict ? selector : (innerGear < 0 ? 'R' : innerGear === 0 ? 'N' : 'D'),
      display: displayGear(innerGear),
      engineRunning: !strict || ignitionState === 'on',
      crankProgress: strict ? crankProgressValue() : 1,
      crankDimFactor: strict ? crankDimValue() : 1,
      hazard,
      canShift: computeCanShift(speedMs, brake),
      assist: {...assist},
    }
  }

  function resetForMount(saved?: Partial<CarGearboxPersisted>) {
    ignitionState = saved?.ignition === 'on' ? 'on' : 'off'
    selector = saved?.selector ?? 'P'
    hazard = !!saved?.hazard
    crankElapsed = ignitionState === 'on' ? GEARBOX.crankSec : 0
    revFlareTimer = 0
    throttleHintCooldown = 0
    revHoldPromptSec = 0
    if (strict && assist.autoIgnite && ignitionState === 'off') {
      ignitionState = 'cranking'
      crankElapsed = 0
    }
  }

  function ignition(on?: boolean, speedMs = 0): CarGearboxResult {
    if (!strict) {
      return {ok: false, state: snapshot(), reason: 'not_strict', text: '当前为简化驾驶模式'}
    }
    const targetOn = on !== undefined ? on : ignitionState === 'off'
    if (targetOn) {
      if (ignitionState === 'on') return {ok: true, state: snapshot()}
      if (ignitionState === 'cranking') {
        return {ok: false, state: snapshot(), reason: 'cranking', text: '正在点火启动中…'}
      }
      ignitionState = 'cranking'
      crankElapsed = 0
      const ev: CarGearboxEvent = {type: 'crank_start'}
      return {ok: true, state: snapshot(), event: ev}
    }
    if (Math.abs(speedMs) > GEARBOX.offMaxSpeed) {
      const text = '行驶中无法熄火，请先刹停'
      return {
        ok: false,
        state: snapshot(1, speedMs),
        reason: 'speed_too_high',
        text,
        event: {type: 'reject', action: 'ignition', reason: 'speed_too_high', text},
      }
    }
    ignitionState = 'off'
    crankElapsed = 0
    revFlareTimer = 0
    return {ok: true, state: snapshot(), event: {type: 'engine_stopped'}}
  }

  function shift(target: CarGearSelector, ctx: {speedMs: number; brake?: boolean}): CarGearboxResult {
    if (!strict) {
      return {ok: false, state: snapshot(), reason: 'not_strict', text: '当前为简化驾驶模式'}
    }
    const absSpd = Math.abs(ctx.speedMs)
    const brake = !!ctx.brake
    if (target === selector) {
      return {ok: true, state: snapshot(1, ctx.speedMs, brake)}
    }

    if (target === 'P') {
      if (absSpd > GEARBOX.parkMaxSpeed) {
        const text = '车速过高，请先刹停再挂入 P 挡'
        return {
          ok: false,
          state: snapshot(1, ctx.speedMs, brake),
          reason: 'speed_too_high',
          text,
          event: {type: 'reject', action: 'shift', reason: 'speed_too_high', text},
        }
      }
      const from = selector
      selector = 'P'
      revHoldPromptSec = 0
      return {
        ok: true,
        state: snapshot(0, ctx.speedMs, brake),
        event: {type: 'shifted', from, to: 'P', engageKick: 0},
      }
    }

    if (ignitionState === 'off') {
      const text = '请先按 K 点火启动后再挂挡'
      return {
        ok: false,
        state: snapshot(0, ctx.speedMs, brake),
        reason: 'engine_off',
        text,
        event: {type: 'reject', action: 'shift', reason: 'engine_off', text},
      }
    }
    if (ignitionState === 'cranking') {
      const text = '正在启动中，稍候再挂挡'
      return {
        ok: false,
        state: snapshot(0, ctx.speedMs, brake),
        reason: 'cranking',
        text,
        event: {type: 'reject', action: 'shift', reason: 'cranking', text},
      }
    }

    if (selector === 'P') {
      if (absSpd > GEARBOX.parkMaxSpeed) {
        const text = '请先稳住车辆再切换挡位'
        return {
          ok: false,
          state: snapshot(0, ctx.speedMs, brake),
          reason: 'speed_too_high',
          text,
          event: {type: 'reject', action: 'shift', reason: 'speed_too_high', text},
        }
      }
      if (assist.shiftLock && !brake) {
        const text = '请先踩住刹车(S)再挂出 P 挡'
        return {
          ok: false,
          state: snapshot(0, ctx.speedMs, brake),
          reason: 'brake_required',
          text,
          event: {type: 'reject', action: 'shift', reason: 'brake_required', text},
        }
      }
    }

    if ((selector === 'D' && target === 'R') || (selector === 'R' && target === 'D')) {
      if (absSpd > GEARBOX.reverseMaxSpeed) {
        const text = `车速过高，无法直接挂入 ${target} 挡`
        return {
          ok: false,
          state: snapshot(1, ctx.speedMs, brake),
          reason: 'speed_too_high',
          text,
          event: {type: 'reject', action: 'shift', reason: 'speed_too_high', text},
        }
      }
    }

    const from = selector
    selector = target
    revHoldPromptSec = 0
    const engageKick = target === 'D' ? 0.012 : target === 'R' ? -0.012 : 0
    return {
      ok: true,
      state: snapshot(target === 'R' ? -1 : target === 'N' ? 0 : 1, ctx.speedMs, brake),
      event: {type: 'shifted', from, to: target, engageKick},
    }
  }

  function lever(dir: 'up' | 'down', ctx: {speedMs: number; brake?: boolean}): CarGearboxResult {
    // Electronic column stalk (Tesla/Li Auto):
    //   down (E / gear+): R -> N -> D; P -> D; N -> D
    //   up   (Q / gear-): D -> N -> R; P -> R; N -> R
    let target: CarGearSelector = selector
    if (dir === 'down') {
      if (selector === 'R') target = 'N'
      else if (selector === 'P' || selector === 'N') target = 'D'
    } else {
      if (selector === 'D') target = 'N'
      else if (selector === 'P' || selector === 'N') target = 'R'
    }
    return shift(target, ctx)
  }

  function tick(dt: number): CarGearboxEvent | 0 {
    const cdt = Math.min(0.12, Math.max(0, dt))
    if (throttleHintCooldown > 0) throttleHintCooldown = Math.max(0, throttleHintCooldown - cdt)
    if (revFlareTimer > 0) revFlareTimer = Math.max(0, revFlareTimer - cdt)

    if (ignitionState === 'cranking') {
      crankElapsed += cdt
      if (crankElapsed >= GEARBOX.crankSec) {
        crankElapsed = GEARBOX.crankSec
        ignitionState = 'on'
        revFlareTimer = GEARBOX.revFlareSec
        return {type: 'engine_started'}
      }
    }
    return 0
  }

  function pedals(fwd: number, vLong: number, dt = 1 / 60): {forward: number; holdBrake: boolean; revThrottle: number; hint?: CarGearboxEvent} {
    if (!strict) {
      return {forward: fwd, holdBrake: false, revThrottle: 0}
    }

    const absV = Math.abs(vLong)
    const pressingW = fwd > 0.12
    const pressingS = fwd < -0.12

    // Engine off or cranking: W never accelerates; S brakes if rolling
    if (ignitionState !== 'on') {
      let hint: CarGearboxEvent | undefined
      if (pressingW && throttleHintCooldown <= 0) {
        throttleHintCooldown = 2.5
        const reason: CarGearboxRejectReason = ignitionState === 'cranking' ? 'cranking' : 'engine_off'
        const text = ignitionState === 'cranking' ? '发动机启动中，请稍候…' : '车辆未点火 · 按 K 启动发动机'
        hint = {type: 'reject', action: 'throttle', reason, text}
      }
      const brakeCmd = pressingS && absV > 0.05 ? (vLong > 0 ? fwd : -fwd) : 0
      return {forward: brakeCmd, holdBrake: selector === 'P', revThrottle: 0, hint}
    }

    // Touch convenience: auto-shift P -> D on first forward throttle once engine is running
    if (selector === 'P' && pressingW && assist.autoDrive && absV <= GEARBOX.parkMaxSpeed) {
      selector = 'D'
    }

    if (selector === 'P') {
      let hint: CarGearboxEvent | undefined
      if (pressingW && throttleHintCooldown <= 0) {
        throttleHintCooldown = 2.5
        hint = {type: 'reject', action: 'throttle', reason: 'engine_off', text: '当前为 P 挡驻车 · 按 E 挂入 D 挡起步'}
      }
      return {forward: 0, holdBrake: true, revThrottle: pressingW ? fwd : 0, hint}
    }

    if (selector === 'N') {
      const brakeCmd = pressingS && absV > 0.05 ? (vLong > 0 ? fwd : -fwd) : 0
      return {forward: brakeCmd, holdBrake: false, revThrottle: pressingW ? fwd : 0}
    }

    if (selector === 'D') {
      if (pressingW) {
        revHoldPromptSec = 0
        return {forward: fwd, holdBrake: false, revThrottle: 0}
      }
      if (pressingS) {
        if (vLong > 0.05) {
          revHoldPromptSec = 0
          return {forward: fwd, holdBrake: false, revThrottle: 0}
        }
        // D gear NEVER auto-reverses; holding S at standstill gives a helpful shift-to-R hint after 0.6s
        revHoldPromptSec += Math.min(0.12, Math.max(0, dt))
        let hint: CarGearboxEvent | undefined
        if (revHoldPromptSec >= 0.6 && throttleHintCooldown <= 0) {
          throttleHintCooldown = 2.5
          revHoldPromptSec = 0
          hint = {type: 'reject', action: 'reverse_hint', reason: 'speed_too_high', text: '当前为 D 挡 · 按 Q 切入 N/R 挡倒车'}
        }
        return {forward: 0, holdBrake: true, revThrottle: 0, hint}
      }
      revHoldPromptSec = 0
      // Idle forward creep in D
      if (vLong < GEARBOX.creepSpeed) {
        const taper = Math.max(0.25, 1 - Math.max(0, vLong) / GEARBOX.creepSpeed)
        return {forward: GEARBOX.creepPedal * taper, holdBrake: false, revThrottle: 0}
      }
      return {forward: 0, holdBrake: false, revThrottle: 0}
    }

    // selector === 'R'
    if (pressingW) {
      revHoldPromptSec = 0
      if (vLong < -0.05) {
        return {forward: fwd, holdBrake: false, revThrottle: 0}
      }
      return {forward: 0, holdBrake: true, revThrottle: 0}
    }
    if (pressingS) {
      revHoldPromptSec = 0
      return {forward: fwd, holdBrake: false, revThrottle: 0}
    }
    // Idle reverse creep in R
    if (vLong > -GEARBOX.creepReverse) {
      const taper = Math.max(0.25, 1 - Math.max(0, -vLong) / GEARBOX.creepReverse)
      return {forward: -GEARBOX.creepPedal * taper, holdBrake: false, revThrottle: 0}
    }
    return {forward: 0, holdBrake: false, revThrottle: 0}
  }

  function brakeLamp(fwd: number, vLong: number, handbrake: boolean): boolean {
    if (handbrake) return true
    if (!strict) return (fwd < -0.05 && vLong > 0.05) || (fwd > 0.05 && vLong < -0.05)
    if (selector === 'P') return fwd < -0.12
    if (selector === 'R') return fwd > 0.12
    return fwd < -0.12
  }

  function reverseLamp(): boolean {
    if (!strict) return false
    return ignitionState === 'on' && selector === 'R'
  }

  function planDismount(pitchRad: number): CarDismountPlan {
    if (!strict || assist.autoEpbOnExit) return 'safe'
    if (selector === 'P') {
      return ignitionState === 'off' ? 'safe' : 'auto_off'
    }
    if (ignitionState === 'on') {
      if (selector === 'D') return 'creep_fwd'
      if (selector === 'R') return 'creep_rev'
    }
    if (Math.abs(pitchRad) >= GEARBOX.rollawaySlopeMinRad) return 'coast'
    return 'unsecured_flat'
  }

  return {
    get strict() { return strict },
    get ignitionState() { return ignitionState },
    get selector() { return selector },
    get engineRunning() { return !strict || ignitionState === 'on' },
    get hazard() { return hazard },
    get crankProgress() { return crankProgressValue() },
    get crankDimFactor() { return crankDimValue() },
    get revFlare() { return revFlareTimer > 0 ? revFlareTimer / GEARBOX.revFlareSec : 0 },
    get idleRpm() {
      if (!strict) return 850
      if (ignitionState === 'off') return 0
      if (ignitionState === 'cranking') return 320 + Math.sin(crankElapsed * 42) * 80
      return 750 + (revFlareTimer > 0 ? (revFlareTimer / GEARBOX.revFlareSec) * 950 : 0)
    },
    setStrict(on: boolean) {
      strict = !!on
      if (!strict) {
        ignitionState = 'on'
        selector = 'D'
      }
    },
    setAssist(patch: Partial<CarGearboxAssist>) {
      if (patch.autoIgnite !== undefined) assist.autoIgnite = !!patch.autoIgnite
      if (patch.autoDrive !== undefined) assist.autoDrive = !!patch.autoDrive
      if (patch.shiftLock !== undefined) assist.shiftLock = !!patch.shiftLock
      if (patch.autoEpbOnExit !== undefined) assist.autoEpbOnExit = !!patch.autoEpbOnExit
    },
    getAssist() { return {...assist} },
    setHazard(on: boolean) { hazard = !!on; return hazard },
    toggleHazard() { hazard = !hazard; return hazard },
    resetForMount,
    ignition,
    shift,
    lever,
    tick,
    pedals,
    brakeLamp,
    reverseLamp,
    displayGear,
    planDismount,
    snapshot,
    persist() {
      return {ignition: ignitionState, selector, hazard}
    },
  }
}

/* ---------------- Unattended non-P rollaway simulation (pure & testable) ---------------- */

export type RollawayStopReason = '' | 'epb' | 'wall' | 'water' | 'dropoff' | 'player' | 'stopped'

export interface CarRollawayProbe {
  /** True if moving bumper corner segment hits a wall or solid. */
  segmentBlocked: (x0: number, z0: number, x1: number, z1: number, y: number) => boolean
  /** True if target point is over water. */
  isWet: (x: number, z: number) => boolean
  /** Returns ground support Y at (x, z) near refY, or null if unsupported / cliff. */
  supportY: (x: number, z: number, refY: number) => number | null
  /** Optional standing player position so the rolling car halts cleanly before touching the player. */
  playerPos?: () => {x: number; z: number} | null
}

export interface CarRollawaySim {
  active: boolean
  plan: Exclude<CarDismountPlan, 'safe' | 'auto_off'>
  x: number
  y: number
  z: number
  heading: number
  pitch: number
  speed: number
  distance: number
  elapsed: number
  maxDistance: number
  stopReason: RollawayStopReason
  impactTriggered: boolean
}

export function createCarRollaway(params: {
  plan: Exclude<CarDismountPlan, 'safe' | 'auto_off'>
  x: number
  y: number
  z: number
  heading: number
  pitch: number
  initialSpeed?: number
}): CarRollawaySim {
  const isCreep = params.plan === 'creep_fwd' || params.plan === 'creep_rev'
  return {
    active: true,
    plan: params.plan,
    x: params.x,
    y: params.y,
    z: params.z,
    heading: params.heading,
    pitch: params.pitch,
    speed: params.initialSpeed ?? 0,
    distance: 0,
    elapsed: 0,
    maxDistance: isCreep ? GEARBOX.rollawayMaxCreepDistM : GEARBOX.rollawayMaxSlopeDistM,
    stopReason: '',
    impactTriggered: false,
  }
}

function playerOverlapsCar(
  cx: number,
  cz: number,
  heading: number,
  px: number,
  pz: number,
): boolean {
  const fx = -Math.sin(heading)
  const fz = -Math.cos(heading)
  const rx = Math.cos(heading)
  const rz = -Math.sin(heading)
  const dx = px - cx
  const dz = pz - cz
  const along = Math.abs(dx * fx + dz * fz)
  const across = Math.abs(dx * rx + dz * rz)
  // Sedan half-length ~2.12m, half-width ~0.91m, plus 0.35m safety margin
  return along <= 2.47 && across <= 1.26
}

/**
 * Advances unattended car rollaway by `dt` seconds.
 * Checks bumper corners against walls, water, dropoffs, and player OBB every step.
 * Triggers simulated door-open EPB stop upon reaching max distance / duration.
 */
export function stepCarRollaway(sim: CarRollawaySim, dt: number, probe: CarRollawayProbe): RollawayStopReason {
  if (!sim.active) return sim.stopReason
  const cdt = Math.min(0.1, Math.max(0, dt))
  if (cdt <= 0) return ''

  sim.elapsed += cdt

  if (sim.plan === 'unsecured_flat') {
    // Stationary alert on flat ground: hold brief warning window then engage EPB cleanly
    if (sim.elapsed >= 1.8) {
      sim.active = false
      sim.speed = 0
      sim.stopReason = 'epb'
      return 'epb'
    }
    return ''
  }

  let acc = 0
  let maxSpd: number = GEARBOX.rollawayMaxSpeedMs
  if (sim.plan === 'creep_fwd') {
    acc = 0.8
    maxSpd = 1.2
  } else if (sim.plan === 'creep_rev') {
    acc = -0.8
    maxSpd = 0.9
  } else {
    // Gravity roll on slope (positive pitch = nose uphill => rolls backwards)
    const grav = -9.81 * Math.sin(sim.pitch)
    const drag = Math.abs(sim.speed) > 0.02 ? -0.18 * Math.sign(sim.speed) : 0
    acc = grav + drag
    maxSpd = GEARBOX.rollawayMaxSpeedMs
  }

  // Smooth EPB deceleration near the distance/time cap
  const distLeft = sim.maxDistance - sim.distance
  if (distLeft <= 0 || sim.elapsed >= GEARBOX.rollawayMaxDurationSec) {
    sim.speed = 0
    sim.active = false
    sim.stopReason = 'epb'
    return 'epb'
  }

  let nextSpd = sim.speed + acc * cdt
  if (Math.abs(nextSpd) > maxSpd) nextSpd = Math.sign(nextSpd) * maxSpd
  if (distLeft < 0.35 && Math.abs(nextSpd) > 0.1) {
    const decel = Math.min(Math.abs(nextSpd), 3.0 * cdt)
    nextSpd -= Math.sign(nextSpd) * decel
  }

  const ds = nextSpd * cdt
  if (Math.abs(ds) < 1e-6) {
    if (sim.plan === 'coast' && Math.abs(acc) < 0.05 && sim.elapsed > 0.4) {
      sim.speed = 0
      sim.active = false
      sim.stopReason = 'stopped'
      return 'stopped'
    }
    return ''
  }

  const fx = -Math.sin(sim.heading)
  const fz = -Math.cos(sim.heading)
  const rx = Math.cos(sim.heading)
  const rz = -Math.sin(sim.heading)
  const nx = sim.x + fx * ds
  const nz = sim.z + fz * ds
  const dirSign = ds >= 0 ? 1 : -1

  // Probe both leading bumper corners
  const bumperZ = dirSign * 2.15
  const cornerHalfW = 0.86
  for (const side of [-1, 1] as const) {
    const c0x = sim.x + fx * bumperZ + rx * (side * cornerHalfW)
    const c0z = sim.z + fz * bumperZ + rz * (side * cornerHalfW)
    const c1x = nx + fx * bumperZ + rx * (side * cornerHalfW)
    const c1z = nz + fz * bumperZ + rz * (side * cornerHalfW)

    if (probe.segmentBlocked(c0x, c0z, c1x, c1z, sim.y + 0.45)) {
      sim.speed = 0
      sim.active = false
      sim.impactTriggered = true
      sim.stopReason = 'wall'
      return 'wall'
    }
    if (probe.isWet(c1x, c1z)) {
      sim.speed = 0
      sim.active = false
      sim.stopReason = 'water'
      return 'water'
    }
  }

  const nextSupY = probe.supportY(nx, nz, sim.y)
  if (nextSupY === null || Math.abs(nextSupY - sim.y) > 0.3) {
    sim.speed = 0
    sim.active = false
    sim.stopReason = 'dropoff'
    return 'dropoff'
  }

  const pPos = probe.playerPos?.()
  if (pPos && playerOverlapsCar(nx, nz, sim.heading, pPos.x, pPos.z)) {
    sim.speed = 0
    sim.active = false
    sim.stopReason = 'player'
    return 'player'
  }

  sim.x = nx
  sim.z = nz
  sim.y = nextSupY
  sim.speed = nextSpd
  sim.distance += Math.abs(ds)

  if (sim.distance >= sim.maxDistance || sim.elapsed >= GEARBOX.rollawayMaxDurationSec) {
    sim.speed = 0
    sim.active = false
    sim.stopReason = 'epb'
    return 'epb'
  }
  return ''
}
