/**
 * Deterministic cross-module state-coupling rules between two-wheel crash/standup/pickup flow
 * and operational states (P-gear park lock, side kickstand, hazard flashers, headlight mode).
 *
 * Core invariants enforced across physics (`ride.ts`), vehicle registry (`vehicles.ts`),
 * scene orchestration (`walk/index.ts`), and visuals (`vehicle-model.ts`):
 *  1. While crashed / downed / standing up / picking up: kickstand stays retracted (never clips
 *     into asphalt at ±82° lay angle), P-gear is disabled, and hazard flashers stay on until upright.
 *  2. Completing downed pickup onto foot: clears hazard flashers, deploys kickstand so the upright
 *     parked bike leans naturally (~6°), turns headlight off, and sets parked P-gear state.
 *  3. Normal dismount: engages P-gear + kickstand and switches off active headlight beam (0 idle GPU cost).
 *  4. P-gear / kickstand engagement while seated is gated to low speed (<= 1.25 m/s) and coupled
 *     bidirectionally (side-stand power cutoff: kickstand down => P-gear locked; P unlocked => kickstand stowed).
 */

export type TwoWheelHeadlightMode = 'off' | 'low' | 'high'
export type TwoWheelVehicleKind = 'bike' | 'bicycle'

export const KICKSTAND_REST_ROLL_RAD = -0.105
export const PARK_ENGAGE_MAX_SPEED_MS = 1.25
export const NIGHT_AUTO_HEADLIGHT_THRESHOLD = 0.45

export interface TwoWheelOperationalState {
  parkLocked: boolean
  kickstandDown: boolean
  hazard: boolean
  headlight: TwoWheelHeadlightMode
  headlightManual: boolean
}

export function createInitialTwoWheelOpState(): TwoWheelOperationalState {
  return {
    parkLocked: false,
    kickstandDown: false,
    hazard: false,
    headlight: 'off',
    headlightManual: false,
  }
}

export type TwoWheelLifecycleEvent =
  | {type: 'mount'; kind: TwoWheelVehicleKind; verifyMode: boolean; nightLevel: number; parkStart?: boolean}
  | {type: 'dismount'; kind: TwoWheelVehicleKind}
  | {type: 'crash'; kind: TwoWheelVehicleKind}
  | {type: 'standup'; kind: TwoWheelVehicleKind}
  | {type: 'pickup_start'; kind: TwoWheelVehicleKind}
  | {type: 'pickup_complete'; kind: TwoWheelVehicleKind}
  | {type: 'toggle_park'; kind: TwoWheelVehicleKind; speedMs: number; crashLocked: boolean; force?: boolean}
  | {type: 'toggle_kickstand'; kind: TwoWheelVehicleKind; speedMs: number; crashLocked: boolean; force?: boolean}
  | {type: 'cycle_headlight'; kind: TwoWheelVehicleKind; crashLocked: boolean}
  | {type: 'set_headlight'; kind: TwoWheelVehicleKind; mode: TwoWheelHeadlightMode; manual?: boolean}
  | {type: 'night_sync'; kind: TwoWheelVehicleKind; nightLevel: number; crashLocked: boolean}

export interface TwoWheelTransitionResult {
  state: TwoWheelOperationalState
  changed: boolean
  rejectedReason?: 'speed_too_high' | 'crash_locked' | 'not_supported'
}

const HEADLIGHT_ORDER: readonly TwoWheelHeadlightMode[] = ['off', 'low', 'high']

export function nextHeadlightMode(current: TwoWheelHeadlightMode): TwoWheelHeadlightMode {
  const idx = HEADLIGHT_ORDER.indexOf(current)
  return HEADLIGHT_ORDER[(idx + 1) % HEADLIGHT_ORDER.length]
}

export function isDriveLockedByParkOrStand(state: TwoWheelOperationalState): boolean {
  return state.parkLocked || state.kickstandDown
}

export function computeParkedRoll(downed: boolean, downedRoll: number, kickstandDown: boolean): number {
  if (downed) return downedRoll
  return kickstandDown ? KICKSTAND_REST_ROLL_RAD : 0
}

export function computePickupRoll(startRoll: number, progress: number, targetKickstandDown: boolean): number {
  const u = Math.max(0, Math.min(1, progress))
  const liftT = u <= .30 ? 0 : u >= .92 ? 1 : (() => {
    const t = (u - .30) / .62
    return t * t * (3 - 2 * t)
  })()
  const targetRoll = targetKickstandDown ? KICKSTAND_REST_ROLL_RAD : 0
  return startRoll + (targetRoll - startRoll) * liftT
}

export function resolveTwoWheelTransition(
  prev: TwoWheelOperationalState,
  event: TwoWheelLifecycleEvent,
): TwoWheelTransitionResult {
  const next: TwoWheelOperationalState = {...prev}

  switch (event.type) {
    case 'mount': {
      const startParked = event.kind === 'bike' && !event.verifyMode && !!event.parkStart
      next.parkLocked = startParked
      next.kickstandDown = startParked
      next.hazard = false
      next.headlightManual = false
      next.headlight = event.kind === 'bike' && event.nightLevel >= NIGHT_AUTO_HEADLIGHT_THRESHOLD ? 'low' : 'off'
      return {state: next, changed: true}
    }

    case 'dismount': {
      next.parkLocked = event.kind === 'bike'
      next.kickstandDown = true
      next.hazard = false
      next.headlight = 'off'
      next.headlightManual = false
      return {state: next, changed: true}
    }

    case 'crash': {
      // Lying sideways on asphalt: kickstand MUST retract, P-gear cleared, hazard flashers on.
      next.parkLocked = false
      next.kickstandDown = false
      next.hazard = event.kind === 'bike'
      return {state: next, changed: true}
    }

    case 'standup': {
      // Rider stands up first while vehicle stays lying sideways on the ground.
      next.parkLocked = false
      next.kickstandDown = false
      next.hazard = event.kind === 'bike'
      return {state: next, changed: true}
    }

    case 'pickup_start': {
      next.parkLocked = false
      next.kickstandDown = false
      next.hazard = event.kind === 'bike'
      return {state: next, changed: true}
    }

    case 'pickup_complete': {
      // Vehicle is now lifted upright and standing on foot: drop side stand, clear hazards, park safely.
      next.parkLocked = event.kind === 'bike'
      next.kickstandDown = true
      next.hazard = false
      next.headlight = 'off'
      next.headlightManual = false
      return {state: next, changed: true}
    }

    case 'toggle_park': {
      if (event.kind !== 'bike') return {state: prev, changed: false, rejectedReason: 'not_supported'}
      if (event.crashLocked) return {state: prev, changed: false, rejectedReason: 'crash_locked'}
      const target = event.force !== undefined ? event.force : !prev.parkLocked
      if (target && Math.abs(event.speedMs) > PARK_ENGAGE_MAX_SPEED_MS) {
        return {state: prev, changed: false, rejectedReason: 'speed_too_high'}
      }
      next.parkLocked = target
      next.kickstandDown = target
      return {state: next, changed: next.parkLocked !== prev.parkLocked || next.kickstandDown !== prev.kickstandDown}
    }

    case 'toggle_kickstand': {
      if (event.crashLocked) return {state: prev, changed: false, rejectedReason: 'crash_locked'}
      const target = event.force !== undefined ? event.force : !prev.kickstandDown
      if (target && Math.abs(event.speedMs) > PARK_ENGAGE_MAX_SPEED_MS) {
        return {state: prev, changed: false, rejectedReason: 'speed_too_high'}
      }
      next.kickstandDown = target
      if (event.kind === 'bike') {
        // Real e-bike side-stand cutoff switch: dropping kickstand locks P-gear; raising it unlocks P-gear.
        next.parkLocked = target
      }
      return {state: next, changed: next.kickstandDown !== prev.kickstandDown || next.parkLocked !== prev.parkLocked}
    }

    case 'cycle_headlight': {
      if (event.kind !== 'bike') return {state: prev, changed: false, rejectedReason: 'not_supported'}
      if (event.crashLocked) return {state: prev, changed: false, rejectedReason: 'crash_locked'}
      next.headlight = nextHeadlightMode(prev.headlight)
      next.headlightManual = true
      return {state: next, changed: next.headlight !== prev.headlight}
    }

    case 'set_headlight': {
      if (event.kind !== 'bike') return {state: prev, changed: false, rejectedReason: 'not_supported'}
      next.headlight = event.mode
      if (event.manual !== undefined) next.headlightManual = event.manual
      return {state: next, changed: next.headlight !== prev.headlight}
    }

    case 'night_sync': {
      if (event.kind !== 'bike' || event.crashLocked || prev.headlightManual) {
        return {state: prev, changed: false}
      }
      const desired: TwoWheelHeadlightMode = event.nightLevel >= NIGHT_AUTO_HEADLIGHT_THRESHOLD ? 'low' : 'off'
      if (desired === prev.headlight) return {state: prev, changed: false}
      next.headlight = desired
      return {state: next, changed: true}
    }
  }
}
