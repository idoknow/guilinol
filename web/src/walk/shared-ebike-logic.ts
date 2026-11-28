/**
 * Shared e-bike real-life logic & turn-slip compensation rules (IDOK-545).
 *
 * Pure, dependency-free domain module shared across `tuning.ts`, `ride.ts`,
 * `vehicles.ts`, `shared-ebike-unlock.ts`, `commerce.ts`, and unit tests:
 *  - Speed cap locked to 25 km/h & single-gear lockout (no shifting).
 *  - Shared e-bike & shared bicycle headlight beam-switching lockout (no high-beam toggle).
 *  - Deliberate turn-event detector with signed yaw accumulation, speed hysteresis,
 *    and per-turn cooldown (prevents 60fps re-rolling into guaranteed crash) for exact 1% slip odds.
 *  - Anti-farm compensation eligibility gate (per-bay permanent claim + 10 min cooldown + 2/day cap).
 */

import type {EbikeHeadlightMode} from './config'
import type {EbikeVehicleType} from './tuning'

export const SHARED_EBIKE_MAX_KMH = 25
export const SHARED_EBIKE_SLIP_PROBABILITY = 0.01
export const SHARED_EBIKE_COMPENSATION_YUAN = 200
export const SHARED_EBIKE_COMPENSATION_COPY = '商家对于你的不幸感到糟糕的赔偿'
export const SHARED_EBIKE_COMPENSATION_REASON = 'shared_ebike_compensation'
export const SHARED_EBIKE_COMP_COOLDOWN_MS = 10 * 60_000
export const SHARED_EBIKE_COMP_DAILY_CAP = 2

export type TwoWheelRideKind = 'bike' | 'bicycle'

export interface SharedEbikeCompState {
  lastAt: number
  dayKey: string
  dayCount: number
}

export interface SharedEbikeCompEligibility {
  allowed: boolean
  reason?: 'invalid_key' | 'already_claimed' | 'cooldown' | 'daily_cap'
  cooldownRemainingMs?: number
  dayCount?: number
  dayCap?: number
}

export function isSharedEbike(kind: TwoWheelRideKind, vehicleType: EbikeVehicleType): boolean {
  return kind === 'bike' && vehicleType === 'shared'
}

/** Shared e-bikes are fixed single-gear commuters (no manual gear shifting). */
export function isSharedEbikeGearLocked(kind: TwoWheelRideKind, vehicleType: EbikeVehicleType): boolean {
  return isSharedEbike(kind, vehicleType)
}

/** Shared e-bikes and shared bicycles cannot switch between low beam and high beam. */
export function isSharedHeadlightSwitchLocked(kind: TwoWheelRideKind, vehicleType: EbikeVehicleType): boolean {
  return kind === 'bicycle' || vehicleType === 'shared'
}

/** Enforces single-state base light ceiling (shared e-bike max `'low'`; bicycle `'off'`). */
export function clampHeadlightForVehicle(
  kind: TwoWheelRideKind,
  vehicleType: EbikeVehicleType,
  desired: EbikeHeadlightMode,
): EbikeHeadlightMode {
  if (kind === 'bicycle') return 'off'
  if (vehicleType === 'shared') return desired === 'high' ? 'low' : desired
  return desired
}

/** Formats local calendar day key (`YYYY-MM-DD`) for daily compensation cap tracking. */
export function localDayKey(nowMs = Date.now()): string {
  const d = new Date(nowMs)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Pure eligibility check: per-bay permanent claim + 10 min real-time cooldown + 2/day cap. */
export function evaluateSharedEbikeCompEligibility(
  claimedKeys: readonly string[],
  bikeKey: string,
  state?: SharedEbikeCompState | null,
  nowMs = Date.now(),
  opts?: {cooldownMs?: number; dailyCap?: number},
): SharedEbikeCompEligibility {
  if (!bikeKey || typeof bikeKey !== 'string') {
    return {allowed: false, reason: 'invalid_key'}
  }
  if (claimedKeys.includes(bikeKey)) {
    return {allowed: false, reason: 'already_claimed'}
  }
  const cooldownMs = opts?.cooldownMs ?? SHARED_EBIKE_COMP_COOLDOWN_MS
  const dailyCap = opts?.dailyCap ?? SHARED_EBIKE_COMP_DAILY_CAP
  const today = localDayKey(nowMs)
  const lastAt = state && Number.isFinite(state.lastAt) ? state.lastAt : 0
  const dayCount = state && state.dayKey === today && Number.isFinite(state.dayCount) ? Math.max(0, Math.trunc(state.dayCount)) : 0

  if (dayCount >= dailyCap) {
    return {allowed: false, reason: 'daily_cap', dayCount, dayCap: dailyCap}
  }
  if (lastAt > 0 && nowMs - lastAt < cooldownMs) {
    return {
      allowed: false,
      reason: 'cooldown',
      cooldownRemainingMs: Math.max(0, cooldownMs - (nowMs - lastAt)),
      dayCount,
      dayCap: dailyCap,
    }
  }
  return {allowed: true, dayCount, dayCap: dailyCap}
}

export interface SharedTurnSlipConfig {
  /** Probability of slipping on each qualifying turn event (default 0.01 = 1%). */
  slipProbability: number
  /** Forward speed (m/s) required to arm turn-slip detection (~8 km/h). */
  minForwardSpeedMs: number
  /** Hysteresis speed (m/s) below which turn-slip detection disarms. */
  resetSpeedMs: number
  /** Minimum |steerInput| to start/continue a turn event. */
  steerEnterThreshold: number
  /** Maximum |steerInput| considered straightened out. */
  steerReleaseThreshold: number
  /** Minimum sustained steering duration (s) to qualify as a real turn. */
  minTurnHoldSec: number
  /** Minimum signed heading change (rad) in the steered direction (~12.6 deg). */
  minTurnYawRad: number
  /** Straight-riding hold duration (s) required to finish a turn before next turn can roll. */
  straightResetSec: number
  /** Minimum cooldown (s) between consecutive turn-slip evaluations. */
  cooldownSec: number
  /** Grace window (s) after mounting before turn-slip detection can roll. */
  mountGraceSec: number
}

export const DEFAULT_SHARED_TURN_SLIP_CONFIG: Readonly<SharedTurnSlipConfig> = {
  slipProbability: SHARED_EBIKE_SLIP_PROBABILITY,
  minForwardSpeedMs: 2.2,
  resetSpeedMs: 1.8,
  steerEnterThreshold: 0.35,
  steerReleaseThreshold: 0.15,
  minTurnHoldSec: 0.14,
  minTurnYawRad: 0.22,
  straightResetSec: 0.20,
  cooldownSec: 2.0,
  mountGraceSec: 3.0,
}

export interface SharedTurnSlipDetectorOptions extends Partial<SharedTurnSlipConfig> {
  rng?: () => number
}

export interface SharedTurnSlipStepInput {
  dt: number
  /** Forward velocity in m/s (negative = reversing; only forward >= minForwardSpeedMs arms). */
  speed: number
  /** Smoothed steering input in [-1, 1] (+1 right, -1 left). */
  steerInput: number
  /** Frame heading delta in radians (`shortestAngle(prevHeading, heading)`; right turn => negative). */
  dYaw: number
  isSharedEbike: boolean
  enabled: boolean
  rng?: () => number
}

export interface SharedTurnSlipStepResult {
  rolled: boolean
  slipped: boolean
  side: -1 | 1
  roll?: number
}

export interface SharedTurnSlipStats {
  activeDir: -1 | 0 | 1
  turnHoldSec: number
  turnYawAccum: number
  evaluated: boolean
  cooldownSec: number
  mountElapsedSec: number
  speedArmed: boolean
  rollCount: number
  slipCount: number
  lastRoll: number | null
}

export interface SharedTurnSlipDetector {
  step(input: SharedTurnSlipStepInput): SharedTurnSlipStepResult
  reset(preserveStats?: boolean): void
  setRng(rng: (() => number) | null): void
  getStats(): SharedTurnSlipStats
}

/**
 * Turn-event detector that evaluates slip probability at most ONCE per deliberate turn.
 * Prevents 60fps per-frame re-rolling while preserving exact `slipProbability` per turn.
 */
export function createSharedTurnSlipDetector(options?: SharedTurnSlipDetectorOptions): SharedTurnSlipDetector {
  const cfg: SharedTurnSlipConfig = {
    ...DEFAULT_SHARED_TURN_SLIP_CONFIG,
    ...options,
  }
  let customRng: (() => number) | null = options?.rng ?? null
  let activeDir: -1 | 0 | 1 = 0
  let turnHoldSec = 0
  let turnYawAccum = 0
  let evaluated = false
  let straightHoldSec = 0
  let cooldownSec = 0
  let mountElapsedSec = 0
  let speedArmed = false
  let rollCount = 0
  let slipCount = 0
  let lastRoll: number | null = null

  function clearActiveTurn() {
    activeDir = 0
    turnHoldSec = 0
    turnYawAccum = 0
    evaluated = false
    straightHoldSec = 0
  }

  function reset(preserveStats = false) {
    clearActiveTurn()
    cooldownSec = 0
    mountElapsedSec = 0
    speedArmed = false
    if (!preserveStats) {
      rollCount = 0
      slipCount = 0
      lastRoll = null
    }
  }

  function setRng(rng: (() => number) | null) {
    customRng = rng
  }

  function step(input: SharedTurnSlipStepInput): SharedTurnSlipStepResult {
    const cdt = Number.isFinite(input.dt) ? Math.min(0.12, Math.max(0, input.dt)) : 0
    if (cooldownSec > 0 && cdt > 0) {
      cooldownSec = Math.max(0, cooldownSec - cdt)
    }

    if (!input.isSharedEbike) {
      clearActiveTurn()
      mountElapsedSec = 0
      speedArmed = false
      return {rolled: false, slipped: false, side: 1}
    }

    mountElapsedSec += cdt

    if (!input.enabled) {
      clearActiveTurn()
      speedArmed = false
      return {rolled: false, slipped: false, side: 1}
    }

    const fwdSpeed = Number.isFinite(input.speed) ? input.speed : 0
    if (speedArmed) {
      if (fwdSpeed < cfg.resetSpeedMs) speedArmed = false
    } else if (fwdSpeed >= cfg.minForwardSpeedMs) {
      speedArmed = true
    }

    if (!speedArmed) {
      clearActiveTurn()
      return {rolled: false, slipped: false, side: 1}
    }

    if (mountElapsedSec < cfg.mountGraceSec) {
      clearActiveTurn()
      return {rolled: false, slipped: false, side: 1}
    }

    const steer = Number.isFinite(input.steerInput) ? input.steerInput : 0
    const dYaw = Number.isFinite(input.dYaw) ? input.dYaw : 0
    const absSteer = Math.abs(steer)
    const steerSign: -1 | 0 | 1 =
      absSteer >= cfg.steerEnterThreshold ? (steer > 0 ? 1 : -1) : 0

    if (activeDir === 0) {
      if (steerSign !== 0) {
        activeDir = steerSign
        turnHoldSec = cdt
        // In ride.ts: heading -= steerInput * omega * dt, so right turn (activeDir=+1) yields dYaw < 0.
        turnYawAccum = Math.max(0, -activeDir * dYaw)
        evaluated = false
        straightHoldSec = 0
      }
    } else if (steerSign === activeDir) {
      straightHoldSec = 0
      turnHoldSec += cdt
      turnYawAccum = Math.max(0, turnYawAccum + -activeDir * dYaw)
    } else if (steerSign === -activeDir) {
      // Deliberate reversal into opposite turn starts a new turn window (still gated by cooldownSec).
      activeDir = steerSign
      turnHoldSec = cdt
      turnYawAccum = Math.max(0, -activeDir * dYaw)
      evaluated = false
      straightHoldSec = 0
    } else if (absSteer <= cfg.steerReleaseThreshold) {
      straightHoldSec += cdt
      if (straightHoldSec >= cfg.straightResetSec) {
        clearActiveTurn()
      }
    } else if (steer * activeDir < 0) {
      straightHoldSec += cdt
      if (straightHoldSec >= cfg.straightResetSec) {
        clearActiveTurn()
      }
    }

    if (
      activeDir !== 0 &&
      !evaluated &&
      cooldownSec <= 0 &&
      turnHoldSec >= cfg.minTurnHoldSec &&
      turnYawAccum >= cfg.minTurnYawRad
    ) {
      evaluated = true
      cooldownSec = cfg.cooldownSec
      rollCount++
      const roll = (input.rng ?? customRng ?? Math.random)()
      lastRoll = roll
      const slipped = Number.isFinite(roll) && roll >= 0 && roll < cfg.slipProbability
      if (slipped) slipCount++
      return {rolled: true, slipped, side: activeDir, roll}
    }

    return {rolled: false, slipped: false, side: activeDir || 1}
  }

  return {
    step,
    reset,
    setRng,
    getStats: () => ({
      activeDir,
      turnHoldSec,
      turnYawAccum,
      evaluated,
      cooldownSec,
      mountElapsedSec,
      speedArmed,
      rollCount,
      slipCount,
      lastRoll,
    }),
  }
}
