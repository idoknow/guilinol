import type {Actor, DutyViolationWeights, Position, Traffic, TrafficViolation, VehicleSubtype} from '../traffic/sim.ts'

export type {DutyViolationWeights, TrafficViolation, VehicleSubtype}

export type ActiveViolation = Exclude<TrafficViolation, 'none'>

export interface DutyFineTable {
  no_helmet: number
  bike_double: number
  ebike_overload: number
}

export const DEFAULT_FINE_YUAN: Readonly<DutyFineTable> = Object.freeze({
  no_helmet: 20,
  bike_double: 30,
  ebike_overload: 50,
})

export const VIOLATION_LABELS: Readonly<Record<ActiveViolation, string>> = Object.freeze({
  no_helmet: '未戴头盔',
  bike_double: '单车双载',
  ebike_overload: '电驴超载',
})

export const VIOLATION_BUBBLE_LINES: Readonly<Record<ActiveViolation, readonly string[]>> = Object.freeze({
  no_helmet: ['马上戴好头盔再走', '这次记住戴头盔了'],
  bike_double: ['单车只骑一人，这就下来', '下次一定不带人了'],
  ebike_overload: ['这就分乘，安全第一', '以后不超载了'],
})

export const TRAFFIC_DUTY_DURATION_SEC = 600
export const DEFAULT_WHISTLE_RANGE_M = 4.2
export const DEFAULT_STOP_DURATION_SEC = 4.2

export const JIEFANG_DUTY_ZONE = Object.freeze({
  center: {x: -168, z: 40},
  westHead: {x: -268, y: 151.7, z: 16},
  eastHead: {x: -45, y: 151.2, z: 88},
  radiusM: 240,
})

export type DutyPhase = 'idle' | 'active' | 'summary'

export type ViolationBreakdown = Record<ActiveViolation, number>

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

export interface TrafficDutySnapshot {
  phase: DutyPhase
  durationSec: number
  remainingSec: number
  elapsedSec: number
  totalFineYuan: number
  citedCount: number
  breakdown: ViolationBreakdown
  inDutyZone: boolean
  nearestDistanceM: number | null
  nearestViolation: ActiveViolation | null
  nearestFineYuan: number | null
  whistleCount: number
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

export interface TrafficDutyInteractCandidate {
  actor: Actor
  violation: ActiveViolation
  distance: number
  fineYuan: number
  label: string
  action: 'whistle_cite'
}

export interface WhistleCiteResult {
  ok: boolean
  reason?: 'inactive' | 'no_target' | 'already_cited' | 'not_violator' | 'out_of_range'
  actor?: Actor
  violation?: ActiveViolation
  fineYuan?: number
  totalFineYuan?: number
  citedCount?: number
  distance?: number
}

export interface TrafficDutyHost {
  getPlayerPos: () => Position | null
  isWalking: () => boolean
  isPaused?: () => boolean
  isUiBlocked?: () => boolean
  getTraffic?: () => Traffic | undefined
  getActors?: () => readonly Actor[]
  stopActor?: (actor: Actor, durationSec: number) => boolean
  getPlayerName?: () => string
  projectToScreen?: (worldPos: {x: number; y: number; z: number}) => {x: number; y: number; visible: boolean} | null
  onDutyStateChange?: (active: boolean) => void
  onWhistle?: (result: WhistleCiteResult) => void
  onToast?: (text: string, ms?: number) => void
  onTeleportToBridge?: () => Promise<boolean> | void
  durationSec?: number
  whistleRangeM?: number
  stopDurationSec?: number
  fineTable?: Partial<DutyFineTable>
  violationWeights?: DutyViolationWeights
  twoWheelShare?: number
  mountContainer?: HTMLElement
  arbiterWired?: boolean
  alwaysShowEntry?: boolean
}

export interface TrafficDutyController {
  startDuty(): TrafficDutySnapshot
  abandonDuty(): TrafficDutySnapshot
  finishDuty(): TrafficDutySnapshot
  resetToIdle(): TrafficDutySnapshot
  step(dt: number): TrafficDutySnapshot
  triggerWhistle(): WhistleCiteResult
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

export function formatDutyReportTitle(totalFineYuan: number): string {
  return `解放桥第一交通志愿者 · 10分钟模拟罚单 ¥${Math.max(0, Math.round(totalFineYuan))}`
}

export function computeFineYuan(violation: TrafficViolation | undefined, table: Readonly<DutyFineTable> = DEFAULT_FINE_YUAN): number {
  if (!violation || violation === 'none') return 0
  return table[violation]
}
