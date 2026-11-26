import type * as THREE from 'three'
import type {DutyPropsHandle} from '../../gear/duty-props.ts'
import type {Actor, ActorHandSide, Position, VehicleSubtype} from '../../traffic/sim.ts'
import type {CitationLedger} from '../handover/ledger.ts'
import type {CitationRecord, FineLineItem, TypingProgressSnapshot} from '../handover/types.ts'
import type {ActiveViolation, DutyFineTable} from '../types.ts'

export type FineTerminalPhase = 'idle' | 'input' | 'printing' | 'deliver' | 'done' | 'cancelled'

export type FineTerminalCancelReason = 'cancelled' | 'superseded' | 'disposed' | 'already_cited'

export interface FineTerminalOpenOptions {
  readonly actor?: Actor
  readonly vehicleKey?: string
  readonly violation?: ActiveViolation
  /** 数罪并罚违法列表（如 `['ebike_overload', 'no_helmet']`）；未传则尝试读取 `actor.violations` 或 `[violation]`。 */
  readonly violations?: readonly ActiveViolation[]
  readonly fineTable?: Partial<DutyFineTable>
  readonly fineYuan?: number
  readonly plateNo?: string
  readonly zoneName?: string
  readonly officerBadgeId?: string
  readonly note?: string
  readonly vehicleSubtype?: VehicleSubtype | 'car'
  readonly charTypeIntervalSec?: number
  readonly printDurationSec?: number
  readonly deliverDurationSec?: number
  readonly maxDeliverDistanceM?: number
  readonly getPlayerPos?: () => Position | null
  readonly ledger?: CitationLedger
  readonly enforceDuplicateCheck?: boolean
  readonly requireExplicitTearOff?: boolean
  readonly printerMountMode?: 'hand' | 'belt'
  readonly mountContainer?: HTMLElement
  readonly handAnchor?: THREE.Object3D | null
  readonly firstPersonCamera?: THREE.Camera | null
  readonly dutyProps?: DutyPropsHandle | null
  /** Neon 骑手池双侧手骨查询器：`getActorHandBone(actor, 'left' | 'right')`，按离玩家更近的那只手塞单。 */
  readonly getActorHandBone?: (actor: Actor, side: ActorHandSide) => THREE.Object3D | null | undefined
  readonly violatorHandBone?: THREE.Object3D | null
  readonly resolveViolatorHandBone?: (actor: Actor, side?: ActorHandSide) => THREE.Object3D | null | undefined
  readonly violatorObject3D?: THREE.Object3D | null
  readonly closeupCamera?: THREE.PerspectiveCamera | null
  readonly headless?: boolean
  readonly sound?: boolean
  readonly onToast?: (message: string) => void
  readonly onPhaseChange?: (phase: FineTerminalPhase, snapshot: FineTerminalSnapshot) => void
  readonly onPrintProgress?: (progress: number) => void
}

export interface FineTerminalSnapshot {
  readonly phase: FineTerminalPhase
  readonly violation: ActiveViolation
  readonly violations: readonly ActiveViolation[]
  readonly violationLabel: string
  readonly lineItems: readonly FineLineItem[]
  readonly fineYuan: number
  readonly plateNo: string
  readonly zoneName: string
  readonly officerBadgeId: string
  readonly receiptNo: string
  readonly qrPayload: string
  readonly note: string
  readonly typing: TypingProgressSnapshot
  readonly printProgress: number
  readonly paperTornOff: boolean
  readonly printerHolsteredOnBelt: boolean
  readonly deliverProgress: number
  readonly isHandingOver: boolean
  readonly distanceToTargetM: number | null
  readonly canDeliverWithinRange: boolean
  readonly handedSide: ActorHandSide | null
  readonly deliverError: string | null
  readonly issuedAtMs: number | null
}

export interface FineTerminalIssuedResult {
  readonly issued: true
  readonly violation: ActiveViolation
  readonly violations: ActiveViolation[]
  readonly violationLabel: string
  readonly lineItems: readonly FineLineItem[]
  readonly fineYuan: number
  readonly plateNo: string
  readonly receiptNo: string
  readonly qrPayload: string
  readonly zoneName: string
  readonly officerBadgeId: string
  readonly note: string
  readonly handedSide: ActorHandSide
  readonly issuedAtMs: number
  readonly citationRecord: CitationRecord
}

export interface FineTerminalCancelledResult {
  readonly issued: false
  readonly reason: FineTerminalCancelReason
  readonly message?: string
  readonly lastPhase: FineTerminalPhase
}

export type FineTerminalResult = FineTerminalIssuedResult | FineTerminalCancelledResult

export interface FineTerminalSession {
  readonly result: Promise<FineTerminalResult>
  getSnapshot(): FineTerminalSnapshot
  getPhase(): FineTerminalPhase
  typeNextChar(): boolean
  completeTyping(): void
  setPlateNo(plateNo: string): boolean
  setViolation(violation: ActiveViolation, syncDefaultFine?: boolean): boolean
  setViolations(violations: readonly ActiveViolation[], syncDefaultFine?: boolean): boolean
  toggleViolation(violation: ActiveViolation, syncDefaultFine?: boolean): boolean
  setFineYuan(fineYuan: number): boolean
  setNote(note: string): boolean
  confirmInput(): boolean
  step(dt: number): FineTerminalSnapshot
  tearOff(): boolean
  confirmDeliver(): boolean
  cancel(reason?: FineTerminalCancelReason): void
  dispose(): void
}

export type FineTerminalPromise = Promise<FineTerminalResult> & {
  readonly session: FineTerminalSession
  cancel(reason?: FineTerminalCancelReason): void
  dispose(): void
}
