import type {Actor, DutyViolationWeights, Position, Traffic, TrafficViolation, VehicleSubtype} from '../traffic/sim.ts'

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
  no_helmet: 20,
  bike_double: 30,
  ebike_overload: 50,
  illegal_mod: 50,
  wrong_way: 50,
  red_light_run: 50,
})

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

export type DutyZoneId = 'jiefang' | 'shizijie'

export interface DutyZone {
  readonly id: DutyZoneId
  readonly name: string
  readonly shortName: string
  readonly center: Readonly<{x: number; z: number}>
  readonly spot: Readonly<{x: number; y: number; z: number; yaw: number}>
  readonly teleport: Readonly<{x: number; z: number; yaw: number}>
  readonly radiusM: number
}

export const JIEFANG_DUTY_ZONE = Object.freeze({
  id: 'jiefang' as const,
  name: '解放桥',
  shortName: '解放桥',
  center: Object.freeze({x: -168, z: 40}),
  spot: Object.freeze({x: -264.7, y: 151.7, z: 26.5, yaw: 0.8}),
  teleport: Object.freeze({x: -268, z: 16, yaw: 1.32}),
  westHead: Object.freeze({x: -268, y: 151.7, z: 16}),
  eastHead: Object.freeze({x: -45, y: 151.2, z: 88}),
  radiusM: 240,
})

export const SHIZIJIE_DUTY_ZONE = Object.freeze({
  id: 'shizijie' as const,
  name: '十字街',
  shortName: '十字街',
  center: Object.freeze({x: -879.75, z: -169.63}),
  spot: Object.freeze({x: -854.38, y: 151.45, z: -170.57, yaw: 2.15}),
  teleport: Object.freeze({x: -855.47, z: -171.47, yaw: 2.15}),
  radiusM: 180,
})

export const DUTY_ZONES: readonly DutyZone[] = Object.freeze([
  JIEFANG_DUTY_ZONE,
  SHIZIJIE_DUTY_ZONE,
])

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
  zoneId: DutyZoneId | null
  zoneName: string | null
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
  onTeleportToZone?: (zoneId: DutyZoneId) => Promise<boolean> | void
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

export function formatDutyReportTitle(totalFineYuan: number, zoneName?: string | null): string {
  const prefix = zoneName && zoneName !== '解放桥' ? `${zoneName}第一交通志愿者` : '解放桥第一交通志愿者'
  return `${prefix} · 10分钟模拟罚单 ¥${Math.max(0, Math.round(totalFineYuan))}`
}

export function computeFineYuan(violation: TrafficViolation | undefined, table: Readonly<DutyFineTable> = DEFAULT_FINE_YUAN): number {
  if (!violation || violation === 'none') return 0
  return table[violation]
}
