import type {Actor, Position, TrafficViolation} from '../traffic/sim.ts'
import type {InteractionContext, InteractionDecision} from '../walk/interact-arbiter.ts'
import {
  computeFineYuanStack,
  DEFAULT_FINE_YUAN,
  DEFAULT_OFFICER_TALK_RANGE_M,
  DEFAULT_WHISTLE_RANGE_M,
  formatViolationBreakdownFormula,
  formatViolationStackLabel,
  JIEFANG_DUTY_ZONE,
  resolveActorViolations,
  type ActiveViolation,
  type DutyFineTable,
  type TrafficDutyInteractAction,
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
      action: TrafficDutyInteractAction
      label: string
      disabled: false
      violation: ActiveViolation | 'officer_briefing'
      fineYuan: number
    }

const MAX_VERTICAL_DELTA_M = 2.5

function isWalkLocked(walkLocks: WalkLockState | undefined): boolean {
  if (!walkLocks) return false
  if (walkLocks.active === false || walkLocks.modalOrOverlayBlocked) return true
  if (walkLocks.crashed || walkLocks.standingUp || walkLocks.pickingUpKind) return true
  if (walkLocks.aboardKind) return true
  if (walkLocks.nearDownedVehicle || walkLocks.nearShop || walkLocks.nearServiceBay) return true
  return false
}

export function isCitableViolator(actor: Actor): boolean {
  if (actor.kind !== 'scooter') return false
  if (actor.leaving || actor.scale < 0.5) return false
  if (actor.cited) return false
  return resolveActorViolations(actor as Actor & {violations?: readonly TrafficViolation[]}).length > 0
}

export function findOfficerInteractCandidate(
  playerPos: Position | null,
  officerPos: {x: number; y: number; z: number} = JIEFANG_DUTY_ZONE.spot,
  maxRangeM = DEFAULT_OFFICER_TALK_RANGE_M,
  briefingDone = false,
  isOffDutyReport = false,
  pendingEarningsYuan = 0,
): TrafficDutyInteractCandidate | null {
  if (!playerPos) return null
  if (Math.abs(officerPos.y - playerPos.y) > MAX_VERTICAL_DELTA_M) return null
  const distance = Math.hypot(officerPos.x - playerPos.x, officerPos.z - playerPos.z)
  if (distance > maxRangeM) return null
  const pendingInt = Math.max(0, Math.round(pendingEarningsYuan))
  return {
    action: 'talk_officer',
    officerId: 'jiefang',
    distance,
    violation: 'officer_briefing',
    fineYuan: 0,
    ...(isOffDutyReport ? {isOffDutyReport: true} : {}),
    label: isOffDutyReport
      ? pendingInt > 0
        ? `下岗交差 ¥${pendingInt}`
        : '下岗交差'
      : briefingDone
        ? '与解放桥交警对话 · 再接一班'
        : '与解放桥交警对话 · 领取执勤任务',
  }
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
      const violations = resolveActorViolations(actor as Actor & {violations?: readonly TrafficViolation[]})
      if (violations.length === 0) continue
      const primary = violations[0]
      const fineYuan = computeFineYuanStack(violations, fineTable)
      const label =
        violations.length > 1
          ? `拦截开单 · 数罪并罚 ${formatViolationBreakdownFormula(violations, fineTable)}`
          : `拦截开单 · ${formatViolationStackLabel(violations)} ¥${fineYuan}`
      best = {
        actor,
        violation: primary,
        violations,
        distance,
        fineYuan,
        label,
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
  officerOpts?: {
    canTalkOfficer?: boolean
    canReportOffDuty?: boolean
    pendingEarningsYuan?: number
    officerPos?: {x: number; y: number; z: number}
    officerRangeM?: number
    briefingDone?: boolean
  },
): TrafficDutyInteractCandidate | null {
  if (isWalkLocked(walkLocks)) return null
  if (!dutyActive) {
    if (officerOpts?.canReportOffDuty) {
      return findOfficerInteractCandidate(
        playerPos,
        officerOpts.officerPos ?? JIEFANG_DUTY_ZONE.spot,
        officerOpts.officerRangeM ?? DEFAULT_OFFICER_TALK_RANGE_M,
        true,
        true,
        officerOpts.pendingEarningsYuan ?? 0,
      )
    }
    if (officerOpts?.canTalkOfficer) {
      return findOfficerInteractCandidate(
        playerPos,
        officerOpts.officerPos ?? JIEFANG_DUTY_ZONE.spot,
        officerOpts.officerRangeM ?? DEFAULT_OFFICER_TALK_RANGE_M,
        Boolean(officerOpts.briefingDone),
        false,
        0,
      )
    }
    return null
  }
  // Priority 2: violator intercept strictly precedes officer off-duty check-in
  const violator = findNearestCitableViolator(actors, playerPos, maxRangeM, fineTable)
  if (violator) return violator
  if (officerOpts?.canReportOffDuty) {
    return findOfficerInteractCandidate(
      playerPos,
      officerOpts.officerPos ?? JIEFANG_DUTY_ZONE.spot,
      officerOpts.officerRangeM ?? DEFAULT_OFFICER_TALK_RANGE_M,
      true,
      true,
      officerOpts.pendingEarningsYuan ?? 0,
    )
  }
  return null
}

/**
 * Pure bridge for integrating `traffic-duty` into `walk/index.ts` + `interact-arbiter.ts`:
 *  - Priorities 0..4 (`none`/blocked, lock, `dismount`, `pickup_downed`, `open_shop`, `open_service`) always take precedence.
 *  - Priorities 5..7 (`mount_vehicle`, `board_boat`, `none`) yield to `talk_officer` or `whistle_cite`.
 */
export function mergeTrafficDutyDecision(
  baseDecision: InteractionDecision,
  candidate: TrafficDutyInteractCandidate | null,
): MergedTrafficDutyDecision {
  if (!candidate) return baseDecision
  if (baseDecision.priority <= 4) return baseDecision
  return {
    priority: 4,
    action: candidate.action,
    label: candidate.label,
    disabled: false,
    violation: candidate.violation,
    fineYuan: candidate.fineYuan,
  }
}

export function isContextBlockedForDuty(
  ctx: Pick<InteractionContext, 'active' | 'modalOrOverlayBlocked' | 'crashed' | 'standingUp' | 'pickingUpKind' | 'aboardKind'>,
): boolean {
  return !ctx.active || ctx.modalOrOverlayBlocked || ctx.crashed || ctx.standingUp || !!ctx.pickingUpKind || !!ctx.aboardKind
}
