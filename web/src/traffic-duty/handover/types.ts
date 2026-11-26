import type * as THREE from 'three'
import type {Actor, ActorHandSide, Position, VehicleSubtype} from '../../traffic/sim.ts'
import type {ActiveViolation, DutyFineTable} from '../types.ts'

export type HandoverStage =
  | 'idle'
  | 'take_out'
  | 'input'
  | 'printing'
  | 'tear_off'
  | 'deliver'
  | 'received'
  | 'cancelled'

export const HANDOVER_ORDERED_STAGES = Object.freeze([
  'take_out',
  'input',
  'printing',
  'tear_off',
  'deliver',
  'received',
] as const)

export const HANDOVER_STAGE_LABELS: Readonly<Record<HandoverStage, string>> = Object.freeze({
  idle: '待命',
  take_out: '拿出',
  input: '输入',
  printing: '吐纸',
  tear_off: '撕下',
  deliver: '递交',
  received: '对方接住',
  cancelled: '已取消',
})

export const HANDOVER_STAGE_FULL_LABELS: Readonly<Record<HandoverStage, string>> = Object.freeze({
  idle: '腰侧待命',
  take_out: '拿出打印机',
  input: '输入核对',
  printing: '热敏吐纸',
  tear_off: '扯下凭条',
  deliver: '就近塞单',
  received: '对方手握凭条',
  cancelled: '已取消',
})

export const HANDOVER_MAX_DISTANCE_M = 1.5
export const DUPLICATE_CITATION_MESSAGE = '已开过罚单'

/** 罚单分项明细行（用于数罪并罚逐行展示 + 合计）。 */
export interface FineLineItem {
  readonly violation: ActiveViolation
  readonly label: string
  readonly fineYuan: number
}

export interface CitationRecord {
  readonly ticketId: string
  readonly vehicleKey: string
  readonly plateNo: string
  readonly violation: ActiveViolation
  readonly violations?: readonly ActiveViolation[]
  readonly violationLabel: string
  readonly lineItems?: readonly FineLineItem[]
  readonly fineYuan: number
  readonly officerBadgeId: string
  readonly qrPayload: string
  readonly zoneName: string
  readonly note: string
  readonly issuedAtMs: number
  readonly heldInHand: boolean
  readonly handedSide?: ActorHandSide
}

export interface SerializedCitationLedger {
  readonly version: 1
  readonly exportedAtMs: number
  readonly records: readonly CitationRecord[]
}

export interface CitationNetSyncPayload {
  readonly type: 'glol.duty.citation.sync.v1'
  readonly senderId: string
  readonly seq: number
  readonly sentAtMs: number
  readonly records: readonly CitationRecord[]
}

export interface TypingProgressSnapshot {
  readonly typedPlateNo: string
  readonly typedViolationLabel: string
  readonly typedFineText: string
  readonly totalChars: number
  readonly typedChars: number
  readonly completed: boolean
  readonly activeKeyIndex: number | null
}

export interface CloseupSnapshot {
  readonly active: boolean
  readonly blend: number
  readonly cameraPos: {x: number; y: number; z: number}
  readonly lookAt: {x: number; y: number; z: number}
  readonly fov: number
}

export interface HandoverAttemptResult {
  readonly ok: boolean
  readonly stage: HandoverStage
  readonly stageLabel: string
  readonly reason?:
    | 'already_cited'
    | 'invalid_stage'
    | 'too_far'
    | 'no_target'
    | 'cancelled'
  readonly message?: string
  readonly distanceM?: number
  readonly maxDistanceM?: number
  readonly handedSide?: ActorHandSide
  readonly record?: CitationRecord
}

export interface HandoverWorkflowSnapshot {
  readonly stage: HandoverStage
  readonly stageLabel: string
  readonly stageFullLabel: string
  readonly stageHistory: readonly HandoverStage[]
  readonly stageLabelHistory: readonly string[]
  readonly stageFullLabelHistory: readonly string[]
  readonly whistleAllowed: boolean
  readonly flagAllowed: boolean
  readonly printerMountMode: 'belt' | 'hand'
  readonly typing: TypingProgressSnapshot
  readonly printProgress: number
  readonly deliverProgress: number
  readonly violatorReachBlend: number
  readonly paperTornOff: boolean
  readonly printerHolsteredOnBelt: boolean
  readonly violatorHoldingSlip: boolean
  readonly handedSide: ActorHandSide | null
  readonly violation: ActiveViolation
  readonly violations: readonly ActiveViolation[]
  readonly violationLabel: string
  readonly lineItems: readonly FineLineItem[]
  readonly fineYuan: number
  readonly plateNo: string
  readonly officerBadgeId: string
  readonly receiptNo: string
  readonly qrPayload: string
  readonly zoneName: string
  readonly note: string
  readonly distanceToTargetM: number | null
  readonly canDeliverNow: boolean
  readonly closeup: CloseupSnapshot
  readonly lastError: string | null
  readonly issuedRecord: CitationRecord | null
}

export interface HandoverWorkflowOptions {
  readonly actor: Actor
  readonly vehicleKey?: string
  readonly violation?: ActiveViolation
  /** 数罪并罚违法列表（如 `['ebike_overload', 'no_helmet']`）；未传则自动读取 `actor.violations` 或 `[violation]`。 */
  readonly violations?: readonly ActiveViolation[]
  readonly fineTable?: Partial<DutyFineTable>
  readonly fineYuan?: number
  readonly plateNo?: string
  readonly officerBadgeId?: string
  readonly zoneName?: string
  readonly note?: string
  readonly vehicleSubtype?: VehicleSubtype | 'car'
  readonly printerMountMode?: 'hand' | 'belt'
  readonly takeOutDurationSec?: number
  readonly charTypeIntervalSec?: number
  readonly printDurationSec?: number
  readonly deliverDurationSec?: number
  readonly maxDeliverDistanceM?: number
  readonly getPlayerPos?: () => Position | null
  /** Neon 双向手骨查询器：`getActorHandBone(actor, 'left' | 'right')`，按离玩家更近的那只手自动塞入。 */
  readonly getActorHandBone?: (actor: Actor, side: ActorHandSide) => THREE.Object3D | null | undefined
  readonly violatorHandBone?: THREE.Object3D | null
  readonly resolveViolatorHandBone?: (actor: Actor, side?: ActorHandSide) => THREE.Object3D | null | undefined
  readonly violatorObject3D?: THREE.Object3D | null
  readonly camera?: THREE.PerspectiveCamera | null
  readonly sound?: boolean
  readonly onToast?: (message: string) => void
  readonly onStageChange?: (stage: HandoverStage, snapshot: HandoverWorkflowSnapshot) => void
}
