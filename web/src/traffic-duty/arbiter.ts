import type {Actor, Position} from '../traffic/sim.ts'
import type {InteractionContext, InteractionDecision} from '../walk/interact-arbiter.ts'
import {
  computeFineYuan,
  DEFAULT_FINE_YUAN,
  DEFAULT_WHISTLE_RANGE_M,
  VIOLATION_LABELS,
  type ActiveViolation,
  type DutyFineTable,
  type TrafficDutyInteractCandidate,
} from './types.ts'

export interface WalkLockState {
  active?: boolean
  modalOrOverlayBlocked?: boolean
  crashed?: boolean
  standingUp?: boolean
  pickingUpKind?: string | null
  aboardKind?: string | null
  nearDownedVehicle?: unknown
  nearShop?: unknown
  nearServiceBay?: unknown
}

export type MergedTrafficDutyDecision =
  | InteractionDecision
  | {
      priority: 4
      action: 'whistle_cite'
      label: string
      disabled: false
      violation: ActiveViolation
      fineYuan: number
    }

const MAX_VERTICAL_DELTA_M = 2.5

export function isCitableViolator(actor: Actor): actor is Actor & {violation: ActiveViolation} {
  if (actor.kind !== 'scooter') return false
  if (actor.leaving || actor.scale < 0.5) return false
  if (actor.cited) return false
  return actor.violation === 'no_helmet' || actor.violation === 'bike_double' || actor.violation === 'ebike_overload'
}

export function findNearestCitableViolator(
  actors: readonly Actor[],
  playerPos: Position | null,
  maxRangeM = DEFAULT_WHISTLE_RANGE_M,
  fineTable: Readonly<DutyFineTable> = DEFAULT_FINE_YUAN,
): TrafficDutyInteractCandidate | null {
  if (!playerPos) return null
  let best: TrafficDutyInteractCandidate | null = null
  for (const actor of actors) {
    if (!isCitableViolator(actor)) continue
    if (Math.abs(actor.y - playerPos.y) > MAX_VERTICAL_DELTA_M) continue
    const distance = Math.hypot(actor.x - playerPos.x, actor.z - playerPos.z)
    if (distance > maxRangeM) continue
    if (!best || distance < best.distance) {
      const fineYuan = computeFineYuan(actor.violation, fineTable)
      best = {
        actor,
        violation: actor.violation,
        distance,
        fineYuan,
        label: `吹哨劝导 · ${VIOLATION_LABELS[actor.violation]} ¥${fineYuan}`,
        action: 'whistle_cite',
      }
    }
  }
  return best
}

/**
 * Resolves `[F]` traffic-duty candidate in strict alignment with `web/src/walk/interact-arbiter.ts`.
 * Yields immediately to modal/overlay (0), crash/standup/pickup lock (1), aboard vehicle/boat (2),
 * downed pickup (3), and shop/service trigger (4).
 */
export function resolveTrafficDutyCandidate(
  dutyActive: boolean,
  walkLocks: WalkLockState | undefined,
  actors: readonly Actor[],
  playerPos: Position | null,
  maxRangeM = DEFAULT_WHISTLE_RANGE_M,
  fineTable: Readonly<DutyFineTable> = DEFAULT_FINE_YUAN,
): TrafficDutyInteractCandidate | null {
  if (!dutyActive) return null
  if (walkLocks) {
    if (walkLocks.active === false || walkLocks.modalOrOverlayBlocked) return null
    if (walkLocks.crashed || walkLocks.standingUp || walkLocks.pickingUpKind) return null
    if (walkLocks.aboardKind) return null
    if (walkLocks.nearDownedVehicle || walkLocks.nearShop || walkLocks.nearServiceBay) return null
  }
  return findNearestCitableViolator(actors, playerPos, maxRangeM, fineTable)
}

/**
 * Pure bridge for `py Neon` when integrating `traffic-duty` into `walk/index.ts` + `interact-arbiter.ts`:
 *  - Priorities 0..4 (`none`/blocked, lock, `dismount`, `pickup_downed`, `open_shop`, `open_service`) always take precedence.
 *  - Priorities 5..7 (`mount_vehicle`, `board_boat`, `none`) yield to `whistle_cite` when a violator is in `[F]` range.
 */
export function mergeTrafficDutyDecision(
  baseDecision: InteractionDecision,
  candidate: TrafficDutyInteractCandidate | null,
): MergedTrafficDutyDecision {
  if (!candidate) return baseDecision
  if (baseDecision.priority <= 4) return baseDecision
  return {
    priority: 4,
    action: 'whistle_cite',
    label: candidate.label,
    disabled: false,
    violation: candidate.violation,
    fineYuan: candidate.fineYuan,
  }
}

export function isContextBlockedForDuty(ctx: Pick<InteractionContext, 'active' | 'modalOrOverlayBlocked' | 'crashed' | 'standingUp' | 'pickingUpKind' | 'aboardKind'>): boolean {
  return !ctx.active || ctx.modalOrOverlayBlocked || ctx.crashed || ctx.standingUp || !!ctx.pickingUpKind || !!ctx.aboardKind
}
