import {getTicketHandover, playTicketHandover} from '../../emote/ticket-handover.ts'
import {getDutyPrinterSlotWorldPosition} from '../../gear/duty-props.ts'
import type {Actor, ActorHandSide, VehicleSubtype} from '../../traffic/sim.ts'
import {createHandoverCloseupController} from '../handover/camera-closeup.ts'
import {sharedCitationLedger} from '../handover/ledger.ts'
import {
  animateViolatorReachPose,
  attachReceiptToViolator,
  buildSimulatedQrPayload,
  selectNearestViolatorHand,
} from '../handover/receipt-model.ts'
import {
  DUPLICATE_CITATION_MESSAGE,
  HANDOVER_MAX_DISTANCE_M,
  type CitationRecord,
  type FineLineItem,
  type TypingProgressSnapshot,
} from '../handover/types.ts'
import {
  ACTIVE_VIOLATIONS,
  DEFAULT_FINE_YUAN,
  VIOLATION_LABELS,
  computeFineYuanStack as computeUpstreamFineYuanStack,
  resolveActorViolations,
  type ActiveViolation,
  type DutyFineTable,
} from '../types.ts'
import {
  playTerminalCancelSound,
  playTerminalDeliverSound,
  playTerminalKeySound,
  playTerminalPrintPulseSound,
  playTerminalPrintReadySound,
  playTerminalTakeOutSound,
  playTerminalTearPaperSound,
} from './audio.ts'
import type {
  FineTerminalCancelReason,
  FineTerminalOpenOptions,
  FineTerminalPhase,
  FineTerminalResult,
  FineTerminalSession,
  FineTerminalSnapshot,
} from './types.ts'

/**
 * r8-2 罚款标准表：单源复用 `../types.ts` 的 `DEFAULT_FINE_YUAN`（默认 50 元/项，改装 100 元，电驴超载 20 元）。
 */
export const R8_DEFAULT_FINE_YUAN: Readonly<DutyFineTable> = DEFAULT_FINE_YUAN

export function normalizeViolationStack(
  violations?: readonly ActiveViolation[] | null,
  fallback?: ActiveViolation,
): ActiveViolation[] {
  const out: ActiveViolation[] = []
  if (Array.isArray(violations)) {
    for (const v of violations) {
      if (ACTIVE_VIOLATIONS.includes(v) && !out.includes(v)) {
        out.push(v)
      }
    }
  }
  if (out.length === 0) {
    out.push(fallback && ACTIVE_VIOLATIONS.includes(fallback) ? fallback : 'no_helmet')
  }
  return out
}

export function resolveFineTable(custom?: Partial<DutyFineTable>): DutyFineTable {
  return {
    no_helmet: Math.max(1, Math.round(custom?.no_helmet ?? R8_DEFAULT_FINE_YUAN.no_helmet)),
    bike_double: Math.max(1, Math.round(custom?.bike_double ?? R8_DEFAULT_FINE_YUAN.bike_double)),
    ebike_overload: Math.max(1, Math.round(custom?.ebike_overload ?? R8_DEFAULT_FINE_YUAN.ebike_overload)),
    illegal_mod: Math.max(1, Math.round(custom?.illegal_mod ?? R8_DEFAULT_FINE_YUAN.illegal_mod)),
    wrong_way: Math.max(1, Math.round(custom?.wrong_way ?? R8_DEFAULT_FINE_YUAN.wrong_way)),
    red_light_run: Math.max(1, Math.round(custom?.red_light_run ?? R8_DEFAULT_FINE_YUAN.red_light_run)),
  }
}

/**
 * 计算数罪并罚合计金额（直接单源委托 `../types.ts` 的 `computeFineYuanStack`）。
 */
export function computeFineYuanStack(
  violations: readonly ActiveViolation[],
  customTable?: Partial<DutyFineTable>,
): number {
  const normalized = normalizeViolationStack(violations)
  return computeUpstreamFineYuanStack(normalized, resolveFineTable(customTable))
}

export function computeFineLineItems(
  violations: readonly ActiveViolation[],
  customTable?: Partial<DutyFineTable>,
): FineLineItem[] {
  const normalized = normalizeViolationStack(violations)
  const table = resolveFineTable(customTable)
  return normalized.map(v =>
    Object.freeze({
      violation: v,
      label: VIOLATION_LABELS[v],
      fineYuan: table[v],
    }),
  )
}

export function formatViolationStackLabel(violations: readonly ActiveViolation[]): string {
  return normalizeViolationStack(violations)
    .map(v => VIOLATION_LABELS[v])
    .join(' + ')
}

let nextReceiptSeq = 1

function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0')
}

function pad4(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(4, '0')
}

export function deriveSimulatedPlateNo(
  actor?: Actor,
  vehicleSubtype?: VehicleSubtype | 'car',
  fallbackSeed = 1,
): string {
  const hashBase = actor
    ? (Math.abs(Math.round(actor.x * 13 + actor.z * 29 + (actor.track?.id ?? 7) * 7)) % 9000) + 1000
    : ((Math.abs(Math.round(fallbackSeed)) * 271) % 9000) + 1000
  const kind = actor?.kind
  const sub = actor?.vehicleSubtype ?? vehicleSubtype
  if (kind === 'car' || sub === 'car') {
    return `桂C·模${pad4(hashBase)}`
  }
  if (sub === 'bicycle') {
    return `单车·模${pad4(hashBase)}`
  }
  return `桂C·电模${pad4(hashBase)}`
}

export function generateSimulatedReceiptNo(): string {
  const seq = nextReceiptSeq++
  const d = new Date()
  const hhmm = `${pad2(d.getHours())}${pad2(d.getMinutes())}`
  return `JLQ-${hhmm}-${pad4(seq)}`
}

export function resolveInitialViolations(opts: FineTerminalOpenOptions): ActiveViolation[] {
  if (opts.violations && opts.violations.length > 0) {
    return normalizeViolationStack(opts.violations, opts.violation)
  }
  if (opts.actor && Array.isArray((opts.actor as Actor & {violations?: unknown}).violations)) {
    const resolved = resolveActorViolations(opts.actor)
    if (resolved.length > 0) {
      return normalizeViolationStack(resolved, opts.violation)
    }
  }
  const single =
    opts.violation && ACTIVE_VIOLATIONS.includes(opts.violation)
      ? opts.violation
      : opts.actor?.violation && opts.actor.violation !== 'none' && ACTIVE_VIOLATIONS.includes(opts.actor.violation)
        ? opts.actor.violation
        : 'no_helmet'
  return [single]
}

export function clampFineYuan(value: number): number {
  if (!Number.isFinite(value)) return R8_DEFAULT_FINE_YUAN.no_helmet
  return Math.max(5, Math.min(1000, Math.round(value)))
}

export function createFineTerminalSession(options: FineTerminalOpenOptions = {}): FineTerminalSession {
  const charTypeIntervalSec = Math.max(0.015, options.charTypeIntervalSec ?? 0.048)
  const printDurationSec = Math.max(0.05, options.printDurationSec ?? 1.0)
  const baseDeliverDurationSec = Math.max(0, options.deliverDurationSec ?? (options.headless ? 0 : 0.18))
  let activeDeliverDurationSec = baseDeliverDurationSec
  const maxDeliverDistanceM = Math.max(0.3, options.maxDeliverDistanceM ?? HANDOVER_MAX_DISTANCE_M)
  const soundEnabled = options.sound !== false && !options.headless
  const ledger = options.ledger ?? (options.enforceDuplicateCheck || options.actor ? sharedCitationLedger : null)
  const closeup = createHandoverCloseupController()

  let phase: FineTerminalPhase = 'input'
  let violations: ActiveViolation[] = resolveInitialViolations(options)
  let lineItems: FineLineItem[] = computeFineLineItems(violations, options.fineTable)
  let fineYuan = clampFineYuan(options.fineYuan ?? computeFineYuanStack(violations, options.fineTable))
  let customFineOverridden = typeof options.fineYuan === 'number'
  let plateNo =
    options.plateNo?.trim() ||
    deriveSimulatedPlateNo(options.actor, options.vehicleSubtype, nextReceiptSeq)
  const zoneName = options.zoneName?.trim() || '解放桥'
  const officerBadgeId = options.officerBadgeId?.trim() || 'GL-JLQ-01'
  const receiptNo = generateSimulatedReceiptNo()
  let note = options.note?.trim() ?? ''

  let typingAccumSec = 0
  let typedChars = 0
  let activeKeyIndex: number | null = null
  let printProgress = 0
  let paperTornOff = false
  let printerHolsteredOnBelt = options.printerMountMode === 'belt'
  let deliverProgress = 0
  let handingOver = false
  let handedSide: ActorHandSide | null = null
  let deliverError: string | null = null
  let issuedAtMs: number | null = null
  let lastPulseBucket = -1
  let settled = false

  let resolvePromise!: (res: FineTerminalResult) => void
  const result = new Promise<FineTerminalResult>(resolve => {
    resolvePromise = resolve
  })

  const syncViolationDerived = (syncDefaultFine: boolean) => {
    lineItems = computeFineLineItems(violations, options.fineTable)
    if (syncDefaultFine || !customFineOverridden) {
      fineYuan = clampFineYuan(computeFineYuanStack(violations, options.fineTable))
      customFineOverridden = false
    }
  }

  const currentViolationLabel = () => formatViolationStackLabel(violations)

  const buildTypingSnapshot = (): TypingProgressSnapshot => {
    const vLabel = currentViolationLabel()
    const fText = `¥${Math.round(fineYuan)}`
    const pChars = [...plateNo]
    const vChars = [...vLabel]
    const fChars = [...fText]
    const total = pChars.length + vChars.length + fChars.length
    const clamped = Math.max(0, Math.min(total, typedChars))

    const pCount = Math.min(pChars.length, clamped)
    const remP = Math.max(0, clamped - pChars.length)
    const vCount = Math.min(vChars.length, remP)
    const remV = Math.max(0, remP - vChars.length)
    const fCount = Math.min(fChars.length, remV)

    return {
      typedPlateNo: pChars.slice(0, pCount).join(''),
      typedViolationLabel: vChars.slice(0, vCount).join(''),
      typedFineText: fChars.slice(0, fCount).join(''),
      totalChars: total,
      typedChars: clamped,
      completed: clamped >= total,
      activeKeyIndex: phase === 'input' && clamped < total ? activeKeyIndex : null,
    }
  }

  const typeNextChar = (): boolean => {
    if (phase !== 'input') return false
    const snap = buildTypingSnapshot()
    if (snap.completed) {
      activeKeyIndex = null
      return false
    }
    typedChars++
    const combined = `${plateNo}${currentViolationLabel()}¥${Math.round(fineYuan)}`
    const code = combined.charCodeAt(Math.max(0, typedChars - 1)) || typedChars
    activeKeyIndex = code % 9
    if (soundEnabled) playTerminalKeySound()
    return true
  }

  const completeTyping = (): void => {
    typedChars = [...plateNo].length + [...currentViolationLabel()].length + [...`¥${Math.round(fineYuan)}`].length
    activeKeyIndex = null
  }

  const measureDistanceM = (): number | null => {
    if (!options.getPlayerPos || !options.actor) return null
    const p = options.getPlayerPos()
    if (!p) return null
    return Math.hypot(options.actor.x - p.x, options.actor.z - p.z)
  }

  const queryHandBoneBySide = (actor: Actor, side: ActorHandSide) => {
    if (options.getActorHandBone) return options.getActorHandBone(actor, side) ?? null
    if (options.resolveViolatorHandBone) return options.resolveViolatorHandBone(actor, side) ?? null
    return null
  }

  const currentQrPayload = () =>
    buildSimulatedQrPayload({
      receiptNo,
      officerBadgeId,
      fineYuan,
      plateNo,
    })

  const buildSnapshot = (): FineTerminalSnapshot => {
    const dist = measureDistanceM()
    const canDeliverWithinRange = dist === null || dist <= maxDeliverDistanceM + 1e-6
    return {
      phase,
      violation: violations[0],
      violations: [...violations],
      violationLabel: currentViolationLabel(),
      lineItems: [...lineItems],
      fineYuan,
      plateNo,
      zoneName,
      officerBadgeId,
      receiptNo,
      qrPayload: currentQrPayload(),
      note,
      typing: buildTypingSnapshot(),
      printProgress,
      paperTornOff,
      printerHolsteredOnBelt,
      deliverProgress,
      isHandingOver: handingOver,
      distanceToTargetM: dist,
      canDeliverWithinRange,
      handedSide,
      deliverError,
      issuedAtMs,
    }
  }

  const emitPhase = () => {
    options.onPhaseChange?.(phase, buildSnapshot())
  }

  const settleCancelled = (reason: FineTerminalCancelReason, message?: string) => {
    if (settled) return
    settled = true
    const lastPhase = phase
    phase = 'cancelled'
    printerHolsteredOnBelt = true
    options.dutyProps?.clearHandSlip()
    getTicketHandover()?.stop()
    closeup.release(true)
    if (soundEnabled && reason === 'cancelled') {
      playTerminalCancelSound()
    }
    emitPhase()
    resolvePromise({
      issued: false,
      reason,
      ...(message ? {message} : {}),
      lastPhase,
    })
  }

  const shouldCheckDuplicate =
    Boolean(options.enforceDuplicateCheck) ||
    Boolean(options.ledger) ||
    Boolean(options.actor?.cited) ||
    Boolean(options.actor && ledger?.hasCited(options.actor))
  if (shouldCheckDuplicate && ledger) {
    const check = ledger.checkCanCite(options.actor ?? null, options.vehicleKey, options.plateNo ? plateNo : undefined)
    if (!check.allowed) {
      phase = 'idle'
      deliverError = DUPLICATE_CITATION_MESSAGE
      options.onToast?.(DUPLICATE_CITATION_MESSAGE)
      settleCancelled('already_cited', DUPLICATE_CITATION_MESSAGE)
    }
  }

  if (!settled) {
    if (soundEnabled) playTerminalTakeOutSound()
    options.dutyProps?.setPrinterMode(options.printerMountMode === 'belt' ? 'belt_printing' : 'in_hand')
    options.dutyProps?.setPrintProgress(0)
  }

  const performTearOff = (): boolean => {
    if (paperTornOff) return true
    if (phase !== 'printing' && phase !== 'deliver') return false
    if (printProgress < 1) return false
    paperTornOff = true
    printerHolsteredOnBelt = true
    phase = 'deliver'
    deliverProgress = 0
    if (soundEnabled) {
      playTerminalPrintReadySound()
      playTerminalTearPaperSound()
    }
    const tearSide = options.actor ? selectNearestViolatorHand(options.actor, buildMountOptions()).side : undefined
    options.dutyProps?.tearOffSlip(tearSide)
    emitPhase()
    return true
  }

  const buildMountOptions = () => ({
    playerPos: options.getPlayerPos?.() ?? null,
    getActorHandBone: options.actor ? (a: Actor, side: ActorHandSide) => queryHandBoneBySide(a, side) : undefined,
    handBone: options.violatorHandBone ?? null,
    violatorObject3D: options.violatorObject3D ?? null,
  })

  const settleIssued = () => {
    if (settled) return
    settled = true
    phase = 'done'
    deliverProgress = 1
    handingOver = false
    deliverError = null
    issuedAtMs = Date.now()
    options.dutyProps?.clearHandSlip()
    closeup.release(false)

    const preSnap = buildSnapshot()
    const vehicleKey = ledger
      ? ledger.deriveVehicleKey(options.actor ?? null, options.vehicleKey, preSnap.plateNo)
      : `veh:${preSnap.plateNo}`

    let chosenSide: ActorHandSide = handedSide ?? 'right'
    let baseRecord: CitationRecord = {
      ticketId: preSnap.receiptNo,
      vehicleKey,
      plateNo: preSnap.plateNo,
      violation: preSnap.violation,
      violations: preSnap.violations,
      violationLabel: preSnap.violationLabel,
      lineItems: preSnap.lineItems,
      fineYuan: preSnap.fineYuan,
      officerBadgeId: preSnap.officerBadgeId,
      qrPayload: preSnap.qrPayload,
      zoneName: preSnap.zoneName,
      note: preSnap.note,
      issuedAtMs: preSnap.issuedAtMs!,
      heldInHand: true,
      handedSide: chosenSide,
    }

    if (
      options.actor ||
      options.violatorHandBone ||
      options.violatorObject3D ||
      options.getActorHandBone ||
      options.resolveViolatorHandBone
    ) {
      const attached = attachReceiptToViolator(options.actor, baseRecord, buildMountOptions())
      chosenSide = attached.side
      handedSide = chosenSide
      baseRecord = attached.record
    }

    if (ledger && (options.actor || options.vehicleKey || options.enforceDuplicateCheck || options.ledger)) {
      baseRecord = ledger.record(baseRecord, options.actor ?? null)
    }

    const finalSnap = buildSnapshot()
    options.onPhaseChange?.('done', finalSnap)
    resolvePromise({
      issued: true,
      violation: finalSnap.violation,
      violations: [...finalSnap.violations],
      violationLabel: finalSnap.violationLabel,
      lineItems: finalSnap.lineItems,
      fineYuan: finalSnap.fineYuan,
      plateNo: finalSnap.plateNo,
      receiptNo: finalSnap.receiptNo,
      qrPayload: finalSnap.qrPayload,
      zoneName: finalSnap.zoneName,
      officerBadgeId: finalSnap.officerBadgeId,
      note: finalSnap.note,
      handedSide: chosenSide,
      issuedAtMs: finalSnap.issuedAtMs!,
      citationRecord: baseRecord,
    })
  }

  return {
    result,
    getSnapshot: buildSnapshot,
    getPhase: () => phase,
    typeNextChar,
    completeTyping,
    setPlateNo(nextPlate: string): boolean {
      if (phase !== 'input') return false
      const trimmed = nextPlate.trim()
      if (!trimmed) return false
      plateNo = trimmed.slice(0, 24)
      completeTyping()
      return true
    },
    setViolation(nextViol: ActiveViolation, syncDefaultFine = true): boolean {
      if (phase !== 'input') return false
      if (!ACTIVE_VIOLATIONS.includes(nextViol)) return false
      violations = [nextViol]
      syncViolationDerived(syncDefaultFine)
      completeTyping()
      if (soundEnabled) playTerminalKeySound()
      return true
    },
    setViolations(nextViols: readonly ActiveViolation[], syncDefaultFine = true): boolean {
      if (phase !== 'input') return false
      const normalized = normalizeViolationStack(nextViols)
      violations = normalized
      syncViolationDerived(syncDefaultFine)
      completeTyping()
      if (soundEnabled) playTerminalKeySound()
      return true
    },
    toggleViolation(targetViol: ActiveViolation, syncDefaultFine = true): boolean {
      if (phase !== 'input') return false
      if (!ACTIVE_VIOLATIONS.includes(targetViol)) return false
      const exists = violations.includes(targetViol)
      if (exists && violations.length <= 1) return false
      violations = exists ? violations.filter(v => v !== targetViol) : [...violations, targetViol]
      syncViolationDerived(syncDefaultFine)
      completeTyping()
      if (soundEnabled) playTerminalKeySound()
      return true
    },
    setFineYuan(nextYuan: number): boolean {
      if (phase !== 'input') return false
      if (!Number.isFinite(nextYuan) || nextYuan <= 0) return false
      fineYuan = clampFineYuan(nextYuan)
      customFineOverridden = true
      completeTyping()
      return true
    },
    setNote(nextNote: string): boolean {
      if (phase !== 'input') return false
      note = nextNote.trim().slice(0, 64)
      return true
    },
    confirmInput(): boolean {
      if (phase !== 'input') return false
      if (!plateNo.trim() || fineYuan <= 0) return false
      completeTyping()
      phase = 'printing'
      printProgress = 0
      paperTornOff = false
      lastPulseBucket = -1
      if (soundEnabled) playTerminalKeySound()
      options.dutyProps?.setPrintProgress(0)
      options.onPrintProgress?.(0)
      emitPhase()
      return true
    },
    step(dt: number): FineTerminalSnapshot {
      const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 5) : 0
      if (phase === 'input' && safeDt > 0) {
        typingAccumSec += safeDt
        while (typingAccumSec >= charTypeIntervalSec) {
          typingAccumSec -= charTypeIntervalSec
          if (!typeNextChar()) break
        }
      } else if (phase === 'printing' && safeDt > 0 && printProgress < 1) {
        printProgress = Math.min(1, printProgress + safeDt / printDurationSec)
        options.dutyProps?.setPrintProgress(printProgress)
        options.onPrintProgress?.(printProgress)
        const bucket = Math.floor(printProgress * 6)
        if (soundEnabled && bucket > lastPulseBucket && printProgress < 1) {
          lastPulseBucket = bucket
          playTerminalPrintPulseSound(bucket)
        }
        if (printProgress >= 1) {
          printProgress = 1
          options.dutyProps?.setPrintProgress(1)
          if (!options.requireExplicitTearOff) {
            performTearOff()
          } else {
            if (soundEnabled) playTerminalPrintReadySound()
            emitPhase()
          }
        }
      } else if (phase === 'deliver' && handingOver && safeDt > 0) {
        const pPos = options.getPlayerPos?.() ?? null
        const aPos = options.actor ? {x: options.actor.x, y: options.actor.y, z: options.actor.z} : null
        closeup.step(safeDt, pPos, aPos)
        deliverProgress =
          activeDeliverDurationSec > 0 ? Math.min(1, deliverProgress + safeDt / activeDeliverDurationSec) : 1
        const reachNode =
          (options.actor ? queryHandBoneBySide(options.actor, handedSide ?? 'right') : null) ??
          options.violatorObject3D ??
          null
        animateViolatorReachPose(
          reachNode,
          'reaching',
          Math.min(1, 0.35 + deliverProgress * 0.65),
          handedSide ?? 'right',
        )
        if (deliverProgress >= 1) {
          settleIssued()
        }
      }
      return buildSnapshot()
    },
    tearOff(): boolean {
      return performTearOff()
    },
    confirmDeliver(): boolean {
      if (phase === 'printing' && printProgress >= 1 && options.requireExplicitTearOff && !paperTornOff) {
        return false
      }
      if (phase !== 'deliver' || handingOver) return false
      const dist = measureDistanceM()
      if (dist !== null && dist > maxDeliverDistanceM + 1e-6) {
        deliverError = `距离违规人员 ${dist.toFixed(1)}m，请走到 ${maxDeliverDistanceM.toFixed(1)}m 以内再塞入对方手中`
        options.onToast?.(deliverError)
        emitPhase()
        return false
      }
      deliverError = null
      handingOver = true
      const sel = selectNearestViolatorHand(options.actor ?? null, buildMountOptions())
      handedSide = sel.side
      const targetHandNode =
        (options.actor ? queryHandBoneBySide(options.actor, sel.side) : null) ??
        sel.node ??
        options.violatorObject3D ??
        null
      animateViolatorReachPose(targetHandNode, 'reaching', 0.35, sel.side)
      const pPos = options.getPlayerPos?.()
      if (pPos && options.actor) {
        closeup.begin(pPos, {x: options.actor.x, y: options.actor.y, z: options.actor.z}, options.closeupCamera ?? null)
      }

      activeDeliverDurationSec = baseDeliverDurationSec
      if (!options.headless && baseDeliverDurationSec > 0 && options.actor) {
        const played = playTicketHandover({
          targetWorldPos: () => {
            if (targetHandNode) {
              targetHandNode.updateWorldMatrix(true, false)
              const e = targetHandNode.matrixWorld.elements
              return {x: e[12], y: e[13], z: e[14]}
            }
            return options.actor ? {x: options.actor.x, y: options.actor.y + 1.05, z: options.actor.z} : null
          },
          side: 'auto',
          printerWorldPos: () => {
            const slot = getDutyPrinterSlotWorldPosition(options.dutyProps)
            return slot ? {x: slot.x, y: slot.y, z: slot.z} : null
          },
          holdSec: 0.32,
          onTear: playerSide => {
            options.dutyProps?.tearOffSlip(playerSide)
          },
          onDeliver: () => {
            options.dutyProps?.clearHandSlip()
          },
        })
        if (played && options.deliverDurationSec === undefined) {
          activeDeliverDurationSec = 1.18
        }
      }

      if (soundEnabled) playTerminalDeliverSound()
      if (activeDeliverDurationSec <= 0) {
        settleIssued()
      } else {
        emitPhase()
      }
      return true
    },
    cancel(reason: FineTerminalCancelReason = 'cancelled'): void {
      settleCancelled(reason)
    },
    dispose(): void {
      settleCancelled('disposed')
    },
  }
}
