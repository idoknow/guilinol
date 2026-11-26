import type * as THREE from 'three'
import type {DutyPropsHandle} from '../gear/duty-props.ts'
import type {Actor, DutyViolationWeights, Position, Traffic, TrafficViolation, VehicleSubtype} from '../traffic/sim.ts'
import type {DutyKeysController, FlagKeyActionResult, WhistleKeyActionResult} from './duty-keys.ts'
import type {CitationRecord} from './handover/types.ts'
import {
  evaluateJiefangDutyInteractionZone,
  isOnJiefangBridgeDeck,
  JIEFANG_BRIDGE_DECK_BOUNDS,
  JIEFANG_BRIDGE_ORIGIN,
  jiefangBridgeLocalToWorld,
  jiefangDeckRoadLocalY,
  worldToJiefangBridgeLocal,
} from './jiefang-railings.ts'
import type {DutyStoryBeatId, DutyStorySnapshot} from './story/index.ts'

export {
  evaluateJiefangDutyInteractionZone,
  isOnJiefangBridgeDeck,
  JIEFANG_BRIDGE_DECK_BOUNDS,
} from './jiefang-railings.ts'

export type {DutyViolationWeights, TrafficViolation, VehicleSubtype}

export type ActiveViolation = Exclude<TrafficViolation, 'none'>

export const ACTIVE_VIOLATIONS: readonly ActiveViolation[] = Object.freeze([
  'no_helmet',
  'bike_double',
  'ebike_overload',
  'illegal_mod',
  'wrong_way',
  'red_light_run',
])

export interface DutyFineTable {
  no_helmet: number
  bike_double: number
  ebike_overload: number
  illegal_mod: number
  wrong_way: number
  red_light_run: number
}

export const DEFAULT_FINE_YUAN: Readonly<DutyFineTable> = Object.freeze({
  no_helmet: 50,
  bike_double: 50,
  ebike_overload: 20,
  illegal_mod: 100,
  wrong_way: 50,
  red_light_run: 50,
})

export const PLAYER_COMMISSION_RATE = 0.1

export function computeCommissionYuan(totalFineYuan: number, rate = PLAYER_COMMISSION_RATE): number {
  if (!Number.isFinite(totalFineYuan) || totalFineYuan <= 0) return 0
  if (!Number.isFinite(rate) || rate <= 0) return 0
  return Math.round(totalFineYuan * rate)
}

export const VIOLATION_LABELS: Readonly<Record<ActiveViolation, string>> = Object.freeze({
  no_helmet: '未戴头盔',
  bike_double: '单车双载',
  ebike_overload: '电驴超载',
  illegal_mod: '非法改装',
  wrong_way: '逆向行驶',
  red_light_run: '闯红灯',
})

export const VIOLATION_BUBBLE_LINES: Readonly<Record<ActiveViolation, readonly string[]>> = Object.freeze({
  no_helmet: ['马上戴好头盔再走', '这次记住戴头盔了'],
  bike_double: ['单车只骑一人，这就下来', '下次一定不带人了'],
  ebike_overload: ['这就分乘，安全第一', '以后不超载了'],
  illegal_mod: ['这就拆除改装件恢复原厂', '合规上路才安心'],
  wrong_way: ['马上调头顺向骑行', '以后一定按道顺行'],
  red_light_run: ['宁等三分不抢一秒', '下次一定看清信号灯'],
})

export const TRAFFIC_DUTY_DURATION_SEC = 600
export const DEFAULT_WHISTLE_RANGE_M = 4.2
export const DEFAULT_STOP_DURATION_SEC = 4.2
export const DEFAULT_OFFICER_TALK_RANGE_M = 5.0
export const DEFAULT_SIGNAL_RANGE_M = 18.0

export type DutyZoneId = 'jiefang' | 'shizijie'

export interface DutyZone {
  readonly id: DutyZoneId
  readonly name: string
  readonly shortName: string
  readonly center: Readonly<{x: number; z: number}>
  readonly spot: Readonly<{x: number; y: number; z: number; yaw: number}>
  readonly teleport: Readonly<{x: number; y?: number; z: number; yaw: number}>
  readonly radiusM: number
}

export const JIEFANG_DUTY_ZONE = Object.freeze({
  id: 'jiefang' as const,
  name: '解放桥',
  shortName: '解放桥',
  center: Object.freeze({x: -168, z: 40}),
  /** Exact resolved west-head sidewalk position of the Jiefang Bridge traffic officer (deck y=151.85). */
  spot: Object.freeze({x: -266.26, y: 151.85, z: 26.86, yaw: 0.8}),
  /** Spawns walker 3.04m in front of the Jiefang officer on the upper bridge deck (inside west_officer gap), facing straight at officer. */
  teleport: Object.freeze({x: -268.5, y: 151.86, z: 24.8, yaw: -2.34}),
  westHead: Object.freeze({x: -268, y: 151.75, z: 16}),
  eastHead: Object.freeze({x: -45, y: 151.2, z: 88}),
  radiusM: 240,
})

export const SHIZIJIE_DUTY_ZONE = Object.freeze({
  id: 'shizijie' as const,
  name: '十字街',
  shortName: '十字街',
  center: Object.freeze({x: -879.75, z: -169.63}),
  spot: Object.freeze({x: -854.38, y: 151.45, z: -170.57, yaw: 2.15}),
  teleport: Object.freeze({x: -855.47, y: 151.45, z: -171.47, yaw: 2.15}),
  radiusM: 180,
})

export const DUTY_ZONES: readonly DutyZone[] = Object.freeze([
  JIEFANG_DUTY_ZONE,
  SHIZIJIE_DUTY_ZONE,
])

/**
 * Bridge duty perimeter single source of truth lives in `./jiefang-railings.ts` (`JIEFANG_BRIDGE_DECK_BOUNDS`).
 * Stepping past the bridge deck while on duty clamps the player back inside and displays `JIEFANG_DUTY_BOUNDS_WARNING`.
 */
export const JIEFANG_DUTY_BOUNDS_WARNING = '正在值班 · 请留在解放桥执勤范围内'
const BRIDGE_CLAMP_INSET_M = 1.2

export function projectOntoJiefangBridge(pos: {x: number; z: number}): {along: number; lateral: number} {
  const [along, lateral] = worldToJiefangBridgeLocal(pos.x, pos.z)
  return {along, lateral}
}

export function isInBridgeDutyBounds(pos: Position | null): boolean {
  return isOnJiefangBridgeDeck(pos)
}

export function clampToBridgeDutyBounds(pos: Position): {clamped: Position; outOfBounds: boolean} {
  const zone = evaluateJiefangDutyInteractionZone(pos)
  if (zone.onBridge) {
    return {clamped: {x: pos.x, y: pos.y, z: pos.z}, outOfBounds: false}
  }
  const [lx, lz] = worldToJiefangBridgeLocal(pos.x, pos.z)
  const clampedX = Math.max(
    JIEFANG_BRIDGE_DECK_BOUNDS.minX + BRIDGE_CLAMP_INSET_M,
    Math.min(JIEFANG_BRIDGE_DECK_BOUNDS.maxX - BRIDGE_CLAMP_INSET_M, lx),
  )
  const clampedZ = Math.max(
    JIEFANG_BRIDGE_DECK_BOUNDS.minZ + BRIDGE_CLAMP_INSET_M,
    Math.min(JIEFANG_BRIDGE_DECK_BOUNDS.maxZ - BRIDGE_CLAMP_INSET_M, lz),
  )
  const [wx, wz] = jiefangBridgeLocalToWorld(clampedX, clampedZ)
  const deckY = JIEFANG_BRIDGE_ORIGIN[1] + jiefangDeckRoadLocalY(clampedX)
  const yOut = !Number.isFinite(pos.y) || pos.y < deckY - 1.1 || pos.y > deckY + 4.5
  return {
    clamped: {x: wx, y: yOut ? deckY : pos.y, z: wz},
    outOfBounds: true,
  }
}

/**
 * Resolves the bridge/sidewalk landing elevation for duty teleports:
 * accepts sampled landmark/deck height within `±0.8m` of `targetY`, rejecting lower Binjiang Road hits (`~146.5m`).
 */
export function resolveDutyTeleportDeckY(sampledY: number | undefined, targetY: number): number {
  if (typeof sampledY === 'number' && Number.isFinite(sampledY) && Math.abs(sampledY - targetY) <= 0.8) {
    return sampledY
  }
  return targetY
}

export function distanceToJiefangOfficer(
  pos: Position | null,
  officerPos: {x: number; y: number; z: number} = JIEFANG_DUTY_ZONE.spot,
): number | null {
  if (!pos) return null
  return Math.hypot(pos.x - officerPos.x, pos.z - officerPos.z)
}

export function resolveDutyZone(pos: Position | null): DutyZone | null {
  if (!pos) return null
  let best: DutyZone | null = null
  let bestDistSq = Infinity
  for (const zone of DUTY_ZONES) {
    const dx = pos.x - zone.center.x
    const dz = pos.z - zone.center.z
    const dSq = dx * dx + dz * dz
    if (dSq <= zone.radiusM ** 2 && dSq < bestDistSq) {
      best = zone
      bestDistSq = dSq
    }
  }
  return best
}

export function isInAnyDutyZone(pos: Position | null): boolean {
  return resolveDutyZone(pos) !== null
}

export function isInJiefangZone(pos: Position | null): boolean {
  if (!pos) return false
  const dx = pos.x - JIEFANG_DUTY_ZONE.center.x
  const dz = pos.z - JIEFANG_DUTY_ZONE.center.z
  return dx * dx + dz * dz <= JIEFANG_DUTY_ZONE.radiusM ** 2
}

export type DutyPhase = 'idle' | 'active' | 'summary'

export type ViolationBreakdown = Record<ActiveViolation, number>

export interface DutyGearState {
  readonly hasWhistle: boolean
  readonly hasFlag: boolean
}

export type DutySignalKind = 'whistle' | 'flag_stop' | 'flag_go'

export interface DutySignalResult {
  ok: boolean
  kind: DutySignalKind
  reason?: 'inactive' | 'missing_gear' | 'terminal_open' | 'story_open' | 'pending_citation' | 'knockdown_active'
  affectedCount: number
  stoppedCount: number
  fleeingCount: number
}

export interface ScreenMarkerSnapshot {
  x: number
  y: number
  visible: boolean
}

export interface DutyBubbleSnapshot {
  id: string
  actor: Actor
  title: string
  line: string
  fineYuan: number
  x: number
  y: number
  z: number
  remainingSec: number
  screenX: number
  screenY: number
  visible: boolean
}

export interface ShiftSettlement {
  readonly citedCount: number
  readonly totalFineYuan: number
  readonly commissionRate: number
  readonly playerShareRate: number
  readonly pendingEarningsYuan: number
  readonly earningsYuan: number
  readonly rewardYuan: number
  readonly stackedCitationCount: number
  readonly stackedCount: number
  readonly stackedFineYuan: number
  readonly breakdown: ViolationBreakdown
  readonly zoneName: string
  readonly durationSec: number
  readonly elapsedSec: number
  readonly settled: boolean
}

export interface OffDutySettlementResult {
  readonly ok: boolean
  readonly alreadySettled: boolean
  readonly creditedYuan: number
  readonly balanceAfter?: number
  readonly settlement: ShiftSettlement
}

export interface TrafficDutySnapshot {
  phase: DutyPhase
  durationSec: number
  remainingSec: number
  elapsedSec: number
  totalFineYuan: number
  pendingEarningsYuan: number
  settledEarningsYuan: number
  commissionRate: number
  stackedCitationCount: number
  citedCount: number
  breakdown: ViolationBreakdown
  inDutyZone: boolean
  inBridgeBounds: boolean
  zoneId: DutyZoneId | null
  zoneName: string | null
  nearestDistanceM: number | null
  nearestViolation: ActiveViolation | null
  nearestFineYuan: number | null
  whistleCount: number
  signalCount: number
  lastSignal: DutySignalKind | null
  briefingDone: boolean
  storyActive: boolean
  offDutyStoryActive: boolean
  terminalOpen: boolean
  handoverPending: boolean
  cameraLocked: boolean
  knockdownActive: boolean
  hasPendingCitation: boolean
  gear: DutyGearState
  officerDistanceM: number | null
  officerScreen: ScreenMarkerSnapshot | null
  outOfBoundsWarning: string | null
  reportTitle: string | null
  lastRecordRank: number | null
  isNewRecord: boolean
  bubbles: readonly DutyBubbleSnapshot[]
}

export interface LeaderboardEntry {
  id: string
  playerName: string
  totalFineYuan: number
  citedCount: number
  breakdown: ViolationBreakdown
  durationSec: number
  completed: boolean
  title: string
  achievedAt: number
}

export interface LeaderboardSummary {
  entries: LeaderboardEntry[]
  bestFineYuan: number
}

export type TrafficDutyInteractAction = 'handover_ticket' | 'talk_officer' | 'whistle_cite'

export interface TrafficDutyInteractCandidate {
  action: TrafficDutyInteractAction
  label: string
  distance: number
  /** ActiveViolation for violator intercept/handover, or `'officer_briefing'` when talking to the Jiefang officer. */
  violation: ActiveViolation | 'officer_briefing'
  violations?: ActiveViolation[]
  fineYuan: number
  actor?: Actor
  officerId?: DutyZoneId
  canDeliverNow?: boolean
  isOffDutyReport?: boolean
}

export interface WhistleCiteResult {
  ok: boolean
  pending?: boolean
  action?: 'handover_ticket' | 'talk_officer' | 'whistle_cite'
  reason?:
    | 'inactive'
    | 'briefing_required'
    | 'story_open'
    | 'terminal_open'
    | 'terminal_cancelled'
    | 'pending_citation'
    | 'knockdown_active'
    | 'too_far_to_deliver'
    | 'target_not_stopped'
    | 'no_terminal'
    | 'no_target'
    | 'already_cited'
    | 'not_violator'
    | 'out_of_range'
  actor?: Actor
  violation?: ActiveViolation
  violations?: ActiveViolation[]
  fineYuan?: number
  totalFineYuan?: number
  citedCount?: number
  distance?: number
  distanceM?: number
  ticketId?: string
  handedSide?: 'left' | 'right'
}

/** Bridge to Neon's independent Jiefang duty traffic module (`web/src/traffic/duty-traffic.ts`). */
export interface DutyTrafficBridge {
  start?: () => void | Promise<void>
  stop?: () => void
  getTraffic?: () => Traffic | undefined
  getActors?: () => readonly Actor[]
  onPlayerHit?: (
    cb: (
      severity: number | 'light' | 'medium' | 'heavy',
      dir: {x: number; z: number},
      event?: {severityScore?: number},
    ) => void,
  ) => (() => void) | void
  onPlayerHorn?: (
    cb: (event: {actor: Actor; dist: number; speed: number; time: number}) => void,
  ) => (() => void) | void
  /** Called when a violator is pulled over by whistle/flag/intercept during duty. */
  onViolatorPulledOver?: (actor: Actor, durationSec?: number) => boolean | void
  /** Called when a violator receives the torn-off fine slip into their hand. */
  onTicketReceived?: (
    actor: Actor,
    receipt?: {
      ticketId?: string
      fineYuan?: number
      plateNo?: string
      violation?: ActiveViolation
      handedSide?: 'left' | 'right'
      ticketObject?: THREE.Object3D
    },
  ) => void
  /** Returns the 3D hand bone or root Object3D of a traffic violator for persistent receipt attachment. */
  getActorHandBone?: (actor: Actor, side?: 'right' | 'left') => THREE.Object3D | null
  /** Releases a pulled-over violator back into normal traffic (e.g. long-press E). */
  releaseViolator?: (actor: Actor) => boolean
  notifyViolatorCited?: (actor?: Actor) => void
  commandHalt?: (
    origin: Position,
    opts?: {kind?: 'whistle' | 'flag'; rangeM?: number; stopDurationSec?: number},
  ) => {affected: number; halted: readonly Actor[]; fled: readonly Actor[]}
  signalWhistle?: (pos: Position, rangeM: number) => readonly Actor[] | number | void
  signalFlag?: (mode: 'stop' | 'go', pos: Position, rangeM: number) => readonly Actor[] | number | void
  stopActor?: (actor: Actor, durationSec: number) => boolean
}

export interface FineTerminalRequest {
  actor: Actor
  actorId?: string
  plate?: string
  plateNo?: string
  violation: ActiveViolation
  violations?: ActiveViolation[]
  violationLabel: string
  fineYuan: number
  vehicleSubtype: VehicleSubtype
  zoneName: string
  getPlayerPos?: () => Position | null
  violatorObject3D?: THREE.Object3D | null
  dutyProps?: DutyPropsHandle | null
  closeupCamera?: THREE.PerspectiveCamera | null
  onToast?: (message: string) => void
  onPhaseChange?: (phase: string, snapshot: unknown) => void
}

export interface FineTerminalResult {
  issued: boolean
  fineYuan?: number
  violations?: ActiveViolation[]
  ticketId?: string
  receiptNo?: string
  plateNo?: string
  handedSide?: 'left' | 'right'
  reason?: string
  message?: string
  citationRecord?: CitationRecord
  cancelled?: boolean
}

/** Bridge to Carbon's first-person / belt electronic fine terminal (`web/src/traffic-duty/fine-terminal/`). */
export interface FineTerminalBridge {
  openFineTerminal: (req: FineTerminalRequest) => Promise<FineTerminalResult> | FineTerminalResult
  isOpen?: () => boolean
  isDelivering?: () => boolean
  isHandingOver?: () => boolean
  confirmDeliver?: () => boolean
  getTargetActor?: () => Actor | null
  close?: () => void
}

/** Bridge to duty props & gesture system (`web/src/gear/duty-props.ts` + `web/src/emote/`). */
export interface DutyPropsBridge {
  grantGear?: (gear: DutyGearState) => void
  clearGear?: () => void
  playGesture?: (kind: DutySignalKind) => void
  setWhistleAlwaysAtMouth?: (alwaysAtMouth: boolean) => void
  getHandle?: () => DutyPropsHandle | null
}

/** Bridge to player knockdown feedback (`web/src/walk/knockdown.ts`). */
export interface KnockdownBridge {
  triggerKnockdown?: (kind: 'vehicle_hit' | 'bike_crash' | 'ebike_fall', dir: {x: number; z: number}, severity: number) => void
  isDown?: boolean | (() => boolean)
}

export interface DutyOfficerNpcRef {
  readonly group?: THREE.Object3D
  readonly officerRoot?: THREE.Object3D
  readonly position?: Readonly<{x: number; y: number; z: number}>
  setDutyState?: (state: 'available' | 'talking' | 'handoff' | 'active') => void
  setExpression?: (expr: string) => void
  setLookTarget?: (pos: {x: number; y?: number; z: number} | null) => void
  headWorld?: (out?: THREE.Vector3) => THREE.Vector3
}

export interface TrafficDutyHost {
  getPlayerPos: () => Position | null
  getPlayerYaw?: () => number
  getPlayerForward?: () => {x: number; z: number}
  getPlayerObject?: () => THREE.Object3D | null
  isWalking: () => boolean
  isPaused?: () => boolean
  isUiBlocked?: () => boolean
  getTraffic?: () => Traffic | undefined
  getActors?: () => readonly Actor[]
  stopActor?: (actor: Actor, durationSec: number) => boolean
  getOfficerPos?: () => {x: number; y: number; z: number} | null
  getOfficerYaw?: () => number
  getOfficerObject?: () => THREE.Object3D | null
  officerNpc?: DutyOfficerNpcRef | null
  camera?: THREE.PerspectiveCamera | null
  renderer?: THREE.WebGLRenderer | null
  scene?: THREE.Scene | null
  getPlayerName?: () => string
  projectToScreen?: (worldPos: {x: number; y: number; z: number}) => ScreenMarkerSnapshot | null
  onDutyStateChange?: (active: boolean) => void
  onOfficerStateChange?: (state: 'available' | 'talking' | 'handoff' | 'active') => void
  onOfficerExpression?: (expr: string) => void
  onOfficerLookTarget?: (pos: {x: number; y?: number; z: number} | null) => void
  onCameraControlChange?: (locked: boolean) => void
  onGearGrant?: (gear: DutyGearState) => void
  onSignalAction?: (result: DutySignalResult) => void
  onDutyBoundaryClamp?: (clamped: Position, warning: string) => void
  onWhistle?: (result: WhistleCiteResult) => void
  onToast?: (text: string, ms?: number) => void
  onTeleportToBridge?: () => Promise<boolean> | void
  onTeleportToZone?: (zoneId: DutyZoneId) => Promise<boolean> | void
  /** Optional custom off-duty check-in story hook (falls back to story.openOffDuty when present). */
  onOpenOffDutyStory?: (
    settlement: ShiftSettlement,
    callbacks: {onSettled: () => void; onCancel: () => void},
  ) => boolean
  /** Optional wallet credit override (defaults to atomic `creditReward` in `game/commerce.ts`). */
  creditWallet?: (
    amountYuan: number,
    settlement: ShiftSettlement,
  ) => {ok: boolean; credited: number; balanceAfter?: number}
  trafficBridge?: DutyTrafficBridge
  fineTerminal?: FineTerminalBridge
  openFineTerminal?: (req: FineTerminalRequest) => Promise<FineTerminalResult> | FineTerminalResult
  propsBridge?: DutyPropsBridge
  knockdownBridge?: KnockdownBridge
  durationSec?: number
  whistleRangeM?: number
  officerTalkRangeM?: number
  signalRangeM?: number
  stopDurationSec?: number
  fineTable?: Partial<DutyFineTable>
  violationWeights?: DutyViolationWeights
  twoWheelShare?: number
  mountContainer?: HTMLElement
  arbiterWired?: boolean
  alwaysShowEntry?: boolean
  enableDutyKeys?: boolean
}

export interface TrafficDutyController {
  /** Blocked unless the Jiefang officer briefing dialogue has been completed; returns current snapshot. */
  startDuty(): TrafficDutySnapshot
  abandonDuty(): TrafficDutySnapshot
  finishDuty(): TrafficDutySnapshot
  resetToIdle(): TrafficDutySnapshot
  step(dt: number): TrafficDutySnapshot
  /** Unified `[F]` interaction: handover > fine ticket > talk officer (briefing or off-duty check-in). */
  interact(): Promise<WhistleCiteResult>
  /** Intercepts nearest violator and invokes the electronic fine terminal; counts fine only when issued. */
  interceptViolator(): Promise<WhistleCiteResult>
  /** Synchronous entry compatible with `walk/index.ts`; delivers ready slip, talks to officer, or triggers intercept. */
  triggerWhistle(): WhistleCiteResult
  /** Blows whistle or waves command flag (`stop` / `go`) during active duty. */
  triggerSignal(kind: DutySignalKind): DutySignalResult
  /** Duty 3-key actions wired to Carbon's `duty-keys.ts` (`Q` whistle / `E` short pull-over / `E` long release). */
  pressDutyWhistle(): WhistleKeyActionResult
  pressDutyFlagShort(): FlagKeyActionResult
  pressDutyFlagLongRelease(): FlagKeyActionResult
  getDutyKeys(): DutyKeysController
  /** Returns current shift settlement summary (fines, 10% commission, stacked violation count). */
  getShiftSettlement(): ShiftSettlement
  /** Starts off-duty check-in dialogue with Jiefang officer; pays out 10% commission once on `onSettled`. */
  startOffDutyReport(): boolean
  /** Idempotently settles pending 10% commission into player wallet once and closes shift into summary. */
  completeOffDutySettlement(): OffDutySettlementResult
  /** Opens Jiefang officer pre-duty story briefing dialogue (blocked while knocked down or issuing ticket). */
  startOfficerBriefing(beatId?: DutyStoryBeatId): boolean
  advanceStory(): boolean
  chooseStoryOption(choiceId: string): boolean
  skipStory(): boolean
  cancelStory(): boolean
  isStoryOpen(): boolean
  getStorySnapshot(): DutyStorySnapshot
  isTerminalOpen(): boolean
  isHandoverReady(): boolean
  isKnockdownActive(): boolean
  /** True when story camera or ticket handover closeup owns the camera (pauses third-person follow). */
  isCameraLocked(): boolean
  /** 3-way mutual exclusion gates (knockdown / story / fine terminal). */
  canStartKnockdown(): boolean
  canOpenStory(): boolean
  canOpenFineTerminal(): boolean
  /** Clamps player position inside Jiefang Bridge bounds during active duty and emits warning if clamped. */
  clampPlayerPos(pos: Position): {pos: Position; clamped: boolean; warning: string | null}
  getInteractCandidate(walkLocks?: {
    active?: boolean
    modalOrOverlayBlocked?: boolean
    crashed?: boolean
    standingUp?: boolean
    pickingUpKind?: string | null
    aboardKind?: string | null
    nearDownedVehicle?: unknown
    nearShop?: unknown
    nearServiceBay?: unknown
  }): TrafficDutyInteractCandidate | null
  getSnapshot(): TrafficDutySnapshot
  getLeaderboard(): LeaderboardSummary
  openPanel(tab?: 'duty' | 'rank'): void
  closePanel(): void
  isPanelOpen(): boolean
  dispose(): void
}

export function formatDutyReportTitle(totalFineYuan: number, zoneName?: string | null): string {
  const prefix = zoneName && zoneName !== '解放桥' ? `${zoneName}第一交通志愿者` : '解放桥第一交通志愿者'
  return `${prefix} · 10分钟模拟罚单 ¥${Math.max(0, Math.round(totalFineYuan))}`
}

const ACTIVE_VIOLATION_SET = new Set<string>(ACTIVE_VIOLATIONS)

export function isActiveViolation(value: unknown): value is ActiveViolation {
  return typeof value === 'string' && ACTIVE_VIOLATION_SET.has(value)
}

export function resolveActorViolations(
  actor:
    | (Pick<Actor, 'violation' | 'redLightActive'> & {violations?: readonly TrafficViolation[]})
    | null
    | undefined,
): ActiveViolation[] {
  if (!actor) return []
  const raw: readonly (TrafficViolation | undefined)[] =
    Array.isArray(actor.violations) && actor.violations.length > 0
      ? actor.violations
      : actor.violation
        ? [actor.violation]
        : []
  const out: ActiveViolation[] = []
  const seen = new Set<ActiveViolation>()
  for (const item of raw) {
    if (!isActiveViolation(item)) continue
    if (item === 'red_light_run' && actor.redLightActive === false) continue
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

export function formatViolationStackLabel(violations: readonly ActiveViolation[]): string {
  if (!violations.length) return ''
  return violations.map(v => VIOLATION_LABELS[v]).join('+')
}

export function formatViolationFormula(
  violations: readonly ActiveViolation[],
  table: Readonly<DutyFineTable> = DEFAULT_FINE_YUAN,
): string {
  if (!violations.length) return '¥0'
  const total = computeFineYuanStack(violations, table)
  if (violations.length === 1) return `¥${total}`
  return `${violations.map(v => `¥${table[v]}`).join('+')}=¥${total}`
}

export function formatViolationBreakdownFormula(
  violations: readonly ActiveViolation[],
  table: Readonly<DutyFineTable> = DEFAULT_FINE_YUAN,
): string {
  if (!violations.length) return ''
  const total = computeFineYuanStack(violations, table)
  if (violations.length === 1) return `${VIOLATION_LABELS[violations[0]]} ¥${total}`
  return `${violations.map(v => `${VIOLATION_LABELS[v]}¥${table[v]}`).join('+')}=¥${total}`
}

export function computeFineYuanStack(
  violations: readonly (TrafficViolation | null | undefined)[] | null | undefined,
  table: Readonly<DutyFineTable> = DEFAULT_FINE_YUAN,
): number {
  if (!violations || violations.length === 0) return 0
  let sum = 0
  const seen = new Set<ActiveViolation>()
  for (const item of violations) {
    if (!isActiveViolation(item)) continue
    if (seen.has(item)) continue
    seen.add(item)
    const yuan = table[item]
    if (typeof yuan === 'number' && Number.isFinite(yuan) && yuan > 0) {
      sum += yuan
    }
  }
  return sum
}

export function computeFineYuan(
  violation: TrafficViolation | undefined,
  table: Readonly<DutyFineTable> = DEFAULT_FINE_YUAN,
): number {
  if (!violation || violation === 'none') return 0
  return computeFineYuanStack([violation], table)
}
