import type {DutyPropsHandle} from '../../gear/duty-props.ts'
import type {Actor, ActorHandSide} from '../../traffic/sim.ts'
import {
  playTerminalCancelSound,
  playTerminalDeliverSound,
  playTerminalKeySound,
  playTerminalPrintPulseSound,
  playTerminalPrintReadySound,
  playTerminalTakeOutSound,
  playTerminalTearPaperSound,
} from '../fine-terminal/audio.ts'
import {
  clampFineYuan,
  computeFineLineItems,
  computeFineYuanStack,
  deriveSimulatedPlateNo,
  formatViolationStackLabel,
  generateSimulatedReceiptNo,
  normalizeViolationStack,
} from '../fine-terminal/engine.ts'
import {ACTIVE_VIOLATIONS, resolveActorViolations, type ActiveViolation} from '../types.ts'
import {createHandoverCloseupController} from './camera-closeup.ts'
import {sharedCitationLedger, type CitationLedger} from './ledger.ts'
import {
  animateViolatorReachPose,
  attachReceiptToViolator,
  buildSimulatedQrPayload,
  isViolatorHoldingReceipt,
  selectNearestViolatorHand,
} from './receipt-model.ts'
import {
  DUPLICATE_CITATION_MESSAGE,
  HANDOVER_MAX_DISTANCE_M,
  HANDOVER_STAGE_FULL_LABELS,
  HANDOVER_STAGE_LABELS,
  type CitationRecord,
  type FineLineItem,
  type HandoverAttemptResult,
  type HandoverStage,
  type HandoverWorkflowOptions,
  type HandoverWorkflowSnapshot,
  type TypingProgressSnapshot,
} from './types.ts'

export interface HandoverWorkflowHandle {
  getStage(): HandoverStage
  getSnapshot(): HandoverWorkflowSnapshot
  isFlagAllowed(): boolean
  isWhistleAllowed(): boolean
  isActive(): boolean
  finishTakeOut(): HandoverAttemptResult
  typeNextChar(): boolean
  completeTyping(): void
  setPlateNo(plateNo: string): boolean
  setViolation(violation: ActiveViolation, syncDefaultFine?: boolean): boolean
  setViolations(violations: readonly ActiveViolation[], syncDefaultFine?: boolean): boolean
  toggleViolation(violation: ActiveViolation, syncDefaultFine?: boolean): boolean
  setFineYuan(fineYuan: number): boolean
  setNote(note: string): boolean
  confirmInput(): HandoverAttemptResult
  step(dt: number): HandoverWorkflowSnapshot
  tearOff(): HandoverAttemptResult
  deliver(overridePos?: {x: number; y: number; z: number} | null): HandoverAttemptResult
  completeReceive(): HandoverAttemptResult
  cancel(): HandoverAttemptResult
}

export interface CreateHandoverWorkflowDeps {
  readonly ledger?: CitationLedger
  readonly dutyProps?: DutyPropsHandle | null
}

function resolveInitialStack(options: HandoverWorkflowOptions): ActiveViolation[] {
  if (options.violations && options.violations.length > 0) {
    return normalizeViolationStack(options.violations, options.violation)
  }
  if (Array.isArray((options.actor as Actor & {violations?: unknown}).violations)) {
    const resolved = resolveActorViolations(options.actor)
    if (resolved.length > 0) {
      return normalizeViolationStack(resolved, options.violation)
    }
  }
  const single =
    options.violation && ACTIVE_VIOLATIONS.includes(options.violation)
      ? options.violation
      : options.actor.violation && options.actor.violation !== 'none' && ACTIVE_VIOLATIONS.includes(options.actor.violation)
        ? options.actor.violation
        : 'no_helmet'
  return [single]
}

export function startHandoverWorkflow(
  options: HandoverWorkflowOptions,
  deps?: CreateHandoverWorkflowDeps,
): {started: boolean; rejection?: HandoverAttemptResult; workflow: HandoverWorkflowHandle} {
  const ledger = deps?.ledger ?? sharedCitationLedger
  const dutyProps = deps?.dutyProps ?? null
  const closeup = createHandoverCloseupController()
  const soundEnabled = options.sound === true

  const takeOutDurationSec = Math.max(0.05, options.takeOutDurationSec ?? 0.18)
  const charTypeIntervalSec = Math.max(0.015, options.charTypeIntervalSec ?? 0.048)
  const printDurationSec = Math.max(0.05, options.printDurationSec ?? 0.9)
  const deliverDurationSec = Math.max(0.05, options.deliverDurationSec ?? 0.2)
  const maxDeliverDistanceM = Math.max(0.3, options.maxDeliverDistanceM ?? HANDOVER_MAX_DISTANCE_M)
  const printerMountMode: 'belt' | 'hand' = options.printerMountMode ?? 'hand'

  let violations: ActiveViolation[] = resolveInitialStack(options)
  let lineItems: FineLineItem[] = computeFineLineItems(violations, options.fineTable)
  let fineYuan = clampFineYuan(options.fineYuan ?? computeFineYuanStack(violations, options.fineTable))
  let customFineOverridden = typeof options.fineYuan === 'number'
  let plateNo =
    options.plateNo?.trim() ||
    deriveSimulatedPlateNo(options.actor, options.vehicleSubtype)
  const officerBadgeId = options.officerBadgeId?.trim() || 'GL-JLQ-01'
  const zoneName = options.zoneName?.trim() || '解放桥'
  const receiptNo = generateSimulatedReceiptNo()
  let note = options.note?.trim() ?? ''

  let stage: HandoverStage = 'idle'
  const stageHistory: HandoverStage[] = []
  let takeOutElapsed = 0
  let typingAccumSec = 0
  let typedChars = 0
  let activeKeyIndex: number | null = null
  let printProgress = 0
  let deliverProgress = 0
  let violatorReachBlend = 0
  let paperTornOff = false
  let printerHolsteredOnBelt = true
  let handedSide: ActorHandSide | null = null
  let lastDeliverPos: {x: number; y: number; z: number} | null = null
  let lastError: string | null = null
  let issuedRecord: CitationRecord | null = null
  let lastPulseBucket = -1

  const syncViolationDerived = (syncDefaultFine: boolean) => {
    lineItems = computeFineLineItems(violations, options.fineTable)
    if (syncDefaultFine || !customFineOverridden) {
      fineYuan = clampFineYuan(computeFineYuanStack(violations, options.fineTable))
      customFineOverridden = false
    }
  }

  const currentViolationLabel = () => formatViolationStackLabel(violations)

  const computeTypingSnapshot = (): TypingProgressSnapshot => {
    const vLabel = currentViolationLabel()
    const fText = `¥${Math.round(fineYuan)}`
    const pChars = [...plateNo]
    const vChars = [...vLabel]
    const fChars = [...fText]
    const total = pChars.length + vChars.length + fChars.length
    const clampedTyped = Math.max(0, Math.min(total, typedChars))

    const pCount = Math.min(pChars.length, clampedTyped)
    const remAfterP = Math.max(0, clampedTyped - pChars.length)
    const vCount = Math.min(vChars.length, remAfterP)
    const remAfterV = Math.max(0, remAfterP - vChars.length)
    const fCount = Math.min(fChars.length, remAfterV)

    return {
      typedPlateNo: pChars.slice(0, pCount).join(''),
      typedViolationLabel: vChars.slice(0, vCount).join(''),
      typedFineText: fChars.slice(0, fCount).join(''),
      totalChars: total,
      typedChars: clampedTyped,
      completed: clampedTyped >= total,
      activeKeyIndex: stage === 'input' && clampedTyped < total ? activeKeyIndex : null,
    }
  }

  const advanceOneTypedChar = (): boolean => {
    const snap = computeTypingSnapshot()
    if (snap.completed) {
      activeKeyIndex = null
      return false
    }
    typedChars++
    const combined = `${plateNo}${currentViolationLabel()}¥${Math.round(fineYuan)}`
    const ch = combined.charCodeAt(Math.max(0, typedChars - 1)) || typedChars
    activeKeyIndex = ch % 9
    if (soundEnabled) playTerminalKeySound()
    return true
  }

  const completeAllTyping = (): void => {
    const total = [...plateNo].length + [...currentViolationLabel()].length + [...`¥${Math.round(fineYuan)}`].length
    typedChars = total
    activeKeyIndex = null
  }

  const computeQr = () =>
    buildSimulatedQrPayload({
      receiptNo,
      officerBadgeId,
      fineYuan,
      plateNo,
    })

  const computeDistM = (overridePos?: {x: number; y: number; z: number} | null): number | null => {
    const pos = overridePos ?? options.getPlayerPos?.() ?? null
    if (!pos) return null
    return Math.hypot(options.actor.x - pos.x, options.actor.z - pos.z)
  }

  const queryHandBoneBySide = (actor: Actor, side: ActorHandSide) => {
    if (options.getActorHandBone) return options.getActorHandBone(actor, side) ?? null
    if (options.resolveViolatorHandBone) return options.resolveViolatorHandBone(actor, side) ?? null
    return null
  }

  const buildMountOpts = (overridePos?: {x: number; y: number; z: number} | null) => ({
    playerPos: overridePos ?? lastDeliverPos ?? options.getPlayerPos?.() ?? null,
    getActorHandBone: (a: Actor, side: ActorHandSide) => queryHandBoneBySide(a, side),
    handBone: options.violatorHandBone ?? null,
    violatorObject3D: options.violatorObject3D ?? null,
  })

  const isWorkflowTicketing = (): boolean =>
    stage === 'take_out' ||
    stage === 'input' ||
    stage === 'printing' ||
    stage === 'tear_off' ||
    stage === 'deliver'

  const buildSnapshot = (overridePos?: {x: number; y: number; z: number} | null): HandoverWorkflowSnapshot => {
    const dist = computeDistM(overridePos)
    const ticketing = isWorkflowTicketing()
    return {
      stage,
      stageLabel: HANDOVER_STAGE_LABELS[stage],
      stageFullLabel: HANDOVER_STAGE_FULL_LABELS[stage],
      stageHistory: [...stageHistory],
      stageLabelHistory: stageHistory.map(s => HANDOVER_STAGE_LABELS[s]),
      stageFullLabelHistory: stageHistory.map(s => HANDOVER_STAGE_FULL_LABELS[s]),
      whistleAllowed: true,
      flagAllowed: !ticketing,
      printerMountMode,
      typing: computeTypingSnapshot(),
      printProgress,
      deliverProgress,
      violatorReachBlend,
      paperTornOff,
      printerHolsteredOnBelt,
      violatorHoldingSlip: isViolatorHoldingReceipt(options.actor) || Boolean(issuedRecord?.heldInHand),
      handedSide,
      violation: violations[0],
      violations: [...violations],
      violationLabel: currentViolationLabel(),
      lineItems: [...lineItems],
      fineYuan,
      plateNo,
      officerBadgeId,
      receiptNo,
      qrPayload: computeQr(),
      zoneName,
      note,
      distanceToTargetM: dist,
      canDeliverNow: stage === 'tear_off' && (dist === null || dist <= maxDeliverDistanceM + 1e-6),
      closeup: closeup.getSnapshot(),
      lastError,
      issuedRecord,
    }
  }

  const transitionTo = (nextStage: HandoverStage) => {
    stage = nextStage
    if (stageHistory[stageHistory.length - 1] !== nextStage) {
      stageHistory.push(nextStage)
    }
    options.onStageChange?.(nextStage, buildSnapshot())
  }

  const citeCheck = ledger.checkCanCite(options.actor, options.vehicleKey, plateNo)
  if (!citeCheck.allowed) {
    lastError = DUPLICATE_CITATION_MESSAGE
    options.onToast?.(DUPLICATE_CITATION_MESSAGE)
    const rejection: HandoverAttemptResult = {
      ok: false,
      stage: 'idle',
      stageLabel: HANDOVER_STAGE_LABELS.idle,
      reason: 'already_cited',
      message: DUPLICATE_CITATION_MESSAGE,
      record: citeCheck.existingRecord,
    }
    const rejectedHandle: HandoverWorkflowHandle = {
      getStage: () => stage,
      getSnapshot: () => buildSnapshot(),
      isFlagAllowed: () => true,
      isWhistleAllowed: () => true,
      isActive: () => false,
      finishTakeOut: () => rejection,
      typeNextChar: () => false,
      completeTyping() {},
      setPlateNo: () => false,
      setViolation: () => false,
      setViolations: () => false,
      toggleViolation: () => false,
      setFineYuan: () => false,
      setNote: () => false,
      confirmInput: () => rejection,
      step: () => buildSnapshot(),
      tearOff: () => rejection,
      deliver: () => rejection,
      completeReceive: () => rejection,
      cancel: () => rejection,
    }
    return {started: false, rejection, workflow: rejectedHandle}
  }

  printerHolsteredOnBelt = printerMountMode === 'belt'
  dutyProps?.setPrinterMode(printerMountMode === 'belt' ? 'belt_printing' : 'in_hand')
  dutyProps?.setPrintProgress(0)
  if (soundEnabled) playTerminalTakeOutSound()
  transitionTo('take_out')

  const finishTakeOut = (): HandoverAttemptResult => {
    if (stage !== 'take_out') {
      return {ok: false, stage, stageLabel: HANDOVER_STAGE_LABELS[stage], reason: 'invalid_stage'}
    }
    lastError = null
    typedChars = 0
    typingAccumSec = 0
    transitionTo('input')
    return {ok: true, stage, stageLabel: HANDOVER_STAGE_LABELS[stage]}
  }

  const confirmInput = (): HandoverAttemptResult => {
    if (stage !== 'input') {
      return {ok: false, stage, stageLabel: HANDOVER_STAGE_LABELS[stage], reason: 'invalid_stage'}
    }
    if (!plateNo.trim() || fineYuan <= 0) {
      return {ok: false, stage, stageLabel: HANDOVER_STAGE_LABELS[stage], reason: 'invalid_stage'}
    }
    completeAllTyping()
    printProgress = 0
    lastPulseBucket = -1
    lastError = null
    dutyProps?.setPrintProgress(0)
    if (soundEnabled) playTerminalKeySound()
    transitionTo('printing')
    return {ok: true, stage, stageLabel: HANDOVER_STAGE_LABELS[stage]}
  }

  const tearOff = (): HandoverAttemptResult => {
    if (stage !== 'printing' || printProgress < 1 - 1e-6) {
      return {
        ok: false,
        stage,
        stageLabel: HANDOVER_STAGE_LABELS[stage],
        reason: 'invalid_stage',
        message: '热敏凭条尚未吐纸完成，暂时不能扯下',
      }
    }
    paperTornOff = true
    printerHolsteredOnBelt = true
    lastError = null
    dutyProps?.tearOffSlip()
    if (soundEnabled) playTerminalTearPaperSound()
    transitionTo('tear_off')
    return {ok: true, stage, stageLabel: HANDOVER_STAGE_LABELS[stage]}
  }

  const deliver = (overridePos?: {x: number; y: number; z: number} | null): HandoverAttemptResult => {
    if (stage !== 'tear_off') {
      return {ok: false, stage, stageLabel: HANDOVER_STAGE_LABELS[stage], reason: 'invalid_stage'}
    }
    const dist = computeDistM(overridePos)
    if (dist !== null && dist > maxDeliverDistanceM + 1e-6) {
      const msg = `距离违规人员 ${dist.toFixed(2)}m（超过 ${maxDeliverDistanceM}m），请走近后再塞单`
      lastError = msg
      options.onToast?.(msg)
      return {
        ok: false,
        stage,
        stageLabel: HANDOVER_STAGE_LABELS[stage],
        reason: 'too_far',
        message: msg,
        distanceM: dist,
        maxDistanceM: maxDeliverDistanceM,
      }
    }
    lastError = null
    deliverProgress = 0
    violatorReachBlend = 0.35
    const officerPos =
      overridePos ?? options.getPlayerPos?.() ?? {x: options.actor.x, y: options.actor.y, z: options.actor.z - 1.1}
    lastDeliverPos = {x: officerPos.x, y: officerPos.y, z: officerPos.z}
    const sel = selectNearestViolatorHand(options.actor, buildMountOpts(officerPos))
    handedSide = sel.side
    animateViolatorReachPose(options.violatorObject3D ?? sel.node, 'reaching', violatorReachBlend, sel.side)

    closeup.begin(
      officerPos,
      {x: options.actor.x, y: options.actor.y, z: options.actor.z},
      options.camera ?? null,
    )
    if (soundEnabled) playTerminalDeliverSound()
    transitionTo('deliver')
    return {
      ok: true,
      stage,
      stageLabel: HANDOVER_STAGE_LABELS[stage],
      handedSide: sel.side,
      ...(dist !== null ? {distanceM: dist} : {}),
      maxDistanceM: maxDeliverDistanceM,
    }
  }

  const completeReceive = (): HandoverAttemptResult => {
    if (stage !== 'deliver') {
      return {ok: false, stage, stageLabel: HANDOVER_STAGE_LABELS[stage], reason: 'invalid_stage'}
    }
    deliverProgress = 1
    violatorReachBlend = 1
    lastError = null
    const qrPayload = computeQr()
    const vehicleKey = ledger.deriveVehicleKey(options.actor, options.vehicleKey, plateNo)
    const draftRecord: CitationRecord = {
      ticketId: receiptNo,
      vehicleKey,
      plateNo,
      violation: violations[0],
      violations: [...violations],
      violationLabel: currentViolationLabel(),
      lineItems: [...lineItems],
      fineYuan,
      officerBadgeId,
      qrPayload,
      zoneName,
      note,
      issuedAtMs: Date.now(),
      heldInHand: true,
      handedSide: handedSide ?? 'right',
    }
    const attached = attachReceiptToViolator(options.actor, draftRecord, buildMountOpts())
    handedSide = attached.side
    const saved = ledger.record({...draftRecord, handedSide: attached.side}, options.actor)
    issuedRecord = saved
    dutyProps?.clearHandSlip()
    closeup.release(false)
    transitionTo('received')
    return {
      ok: true,
      stage,
      stageLabel: HANDOVER_STAGE_LABELS[stage],
      handedSide: attached.side,
      record: saved,
    }
  }

  const workflow: HandoverWorkflowHandle = {
    getStage: () => stage,
    getSnapshot: () => buildSnapshot(),
    isFlagAllowed: () => !isWorkflowTicketing(),
    isWhistleAllowed: () => true,
    isActive: () => isWorkflowTicketing(),
    finishTakeOut,
    typeNextChar: advanceOneTypedChar,
    completeTyping: completeAllTyping,
    setPlateNo(nextPlate: string) {
      if (stage !== 'input') return false
      const clean = nextPlate.trim()
      if (!clean) return false
      plateNo = clean.slice(0, 24)
      completeAllTyping()
      return true
    },
    setViolation(nextViol: ActiveViolation, syncDefaultFine = true) {
      if (stage !== 'input') return false
      if (!ACTIVE_VIOLATIONS.includes(nextViol)) return false
      violations = [nextViol]
      syncViolationDerived(syncDefaultFine)
      completeAllTyping()
      if (soundEnabled) playTerminalKeySound()
      return true
    },
    setViolations(nextViols: readonly ActiveViolation[], syncDefaultFine = true) {
      if (stage !== 'input') return false
      violations = normalizeViolationStack(nextViols)
      syncViolationDerived(syncDefaultFine)
      completeAllTyping()
      if (soundEnabled) playTerminalKeySound()
      return true
    },
    toggleViolation(targetViol: ActiveViolation, syncDefaultFine = true) {
      if (stage !== 'input') return false
      if (!ACTIVE_VIOLATIONS.includes(targetViol)) return false
      const exists = violations.includes(targetViol)
      if (exists && violations.length <= 1) return false
      violations = exists ? violations.filter(v => v !== targetViol) : [...violations, targetViol]
      syncViolationDerived(syncDefaultFine)
      completeAllTyping()
      if (soundEnabled) playTerminalKeySound()
      return true
    },
    setFineYuan(nextYuan: number) {
      if (stage !== 'input') return false
      if (!Number.isFinite(nextYuan) || nextYuan <= 0) return false
      fineYuan = clampFineYuan(nextYuan)
      customFineOverridden = true
      completeAllTyping()
      return true
    },
    setNote(nextNote: string) {
      if (stage !== 'input') return false
      note = nextNote.trim().slice(0, 64)
      return true
    },
    confirmInput,
    step(dt: number) {
      const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 5) : 0
      if (stage === 'take_out' && safeDt > 0) {
        takeOutElapsed += safeDt
        if (takeOutElapsed >= takeOutDurationSec) {
          finishTakeOut()
        }
      } else if (stage === 'input' && safeDt > 0) {
        typingAccumSec += safeDt
        while (typingAccumSec >= charTypeIntervalSec) {
          typingAccumSec -= charTypeIntervalSec
          if (!advanceOneTypedChar()) break
        }
      } else if (stage === 'printing' && safeDt > 0 && printProgress < 1) {
        printProgress = Math.min(1, printProgress + safeDt / printDurationSec)
        dutyProps?.setPrintProgress(printProgress)
        const bucket = Math.floor(printProgress * 6)
        if (soundEnabled && bucket > lastPulseBucket && printProgress < 1) {
          lastPulseBucket = bucket
          playTerminalPrintPulseSound(bucket)
        }
        if (printProgress >= 1) {
          printProgress = 1
          dutyProps?.setPrintProgress(1)
          if (soundEnabled) playTerminalPrintReadySound()
        }
      } else if (stage === 'deliver' && safeDt > 0) {
        const pPos = options.getPlayerPos?.() ?? null
        closeup.step(safeDt, pPos, {x: options.actor.x, y: options.actor.y, z: options.actor.z})
        deliverProgress = Math.min(1, deliverProgress + safeDt / deliverDurationSec)
        violatorReachBlend = Math.min(1, 0.35 + deliverProgress * 0.65)
        animateViolatorReachPose(options.violatorObject3D ?? null, 'reaching', violatorReachBlend, handedSide ?? 'right')
        if (deliverProgress >= 1) {
          completeReceive()
        }
      } else if (stage === 'received' && safeDt > 0) {
        closeup.step(safeDt)
      }
      return buildSnapshot()
    },
    tearOff,
    deliver,
    completeReceive,
    cancel() {
      if (!isWorkflowTicketing()) {
        return {ok: false, stage, stageLabel: HANDOVER_STAGE_LABELS[stage], reason: 'invalid_stage'}
      }
      paperTornOff = false
      printerHolsteredOnBelt = true
      dutyProps?.clearHandSlip()
      closeup.release(true)
      if (soundEnabled) playTerminalCancelSound()
      transitionTo('cancelled')
      return {ok: true, stage, stageLabel: HANDOVER_STAGE_LABELS[stage], reason: 'cancelled'}
    },
  }

  return {started: true, workflow}
}
