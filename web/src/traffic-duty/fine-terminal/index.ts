import type {Actor} from '../../traffic/sim.ts'
import type {FineTerminalBridge, FineTerminalRequest} from '../types.ts'
import {createFineTerminalSession} from './engine.ts'
import {mountFineTerminalOverlay} from './ui.ts'
import type {FineTerminalCancelReason, FineTerminalOpenOptions, FineTerminalPromise, FineTerminalSession} from './types.ts'

export {
  R8_DEFAULT_FINE_YUAN,
  clampFineYuan,
  computeFineLineItems,
  computeFineYuanStack,
  createFineTerminalSession,
  deriveSimulatedPlateNo,
  formatViolationStackLabel,
  generateSimulatedReceiptNo,
  normalizeViolationStack,
  resolveFineTable,
} from './engine.ts'
export {
  createFineTerminalModel,
  type FineTerminalModelUpdateInput,
  type FineTerminalVisualModel,
} from './model.ts'
export {
  playTerminalCancelSound,
  playTerminalDeliverSound,
  playTerminalKeySound,
  playTerminalPrintPulseSound,
  playTerminalPrintReadySound,
  playTerminalStuffInHandSound,
  playTerminalTakeOutSound,
  playTerminalTearPaperSound,
} from './audio.ts'
export {TERMINAL_OVERLAY_CSS, mountFineTerminalOverlay, type FineTerminalMountHandle} from './ui.ts'
export type {
  FineTerminalCancelReason,
  FineTerminalCancelledResult,
  FineTerminalIssuedResult,
  FineTerminalOpenOptions,
  FineTerminalPhase,
  FineTerminalPromise,
  FineTerminalResult,
  FineTerminalSession,
  FineTerminalSnapshot,
} from './types.ts'

let activeSession: FineTerminalSession | null = null
let activeTargetActor: Actor | null = null

export function openFineTerminal(options: FineTerminalOpenOptions = {}): FineTerminalPromise {
  if (activeSession) {
    activeSession.cancel('superseded')
    activeSession = null
    activeTargetActor = null
  }

  let overlayHandle: {updateDom(): void; cleanup(): void} | null = null
  const session = createFineTerminalSession({
    ...options,
    onPhaseChange(phase, snap) {
      overlayHandle?.updateDom()
      options.onPhaseChange?.(phase, snap)
    },
    onPrintProgress(p) {
      overlayHandle?.updateDom()
      options.onPrintProgress?.(p)
    },
  })

  const initialPhase = session.getPhase()
  if (initialPhase !== 'done' && initialPhase !== 'cancelled') {
    activeSession = session
    activeTargetActor = options.actor ?? null
    overlayHandle = mountFineTerminalOverlay(session, options)
  }

  const settledPromise = session.result.finally(() => {
    if (activeSession === session) {
      activeSession = null
      activeTargetActor = null
    }
  })

  const decorated = settledPromise as FineTerminalPromise
  Object.defineProperties(decorated, {
    session: {value: session, enumerable: true},
    cancel: {
      value: (reason: FineTerminalCancelReason = 'cancelled') => session.cancel(reason),
      enumerable: true,
    },
    dispose: {
      value: () => session.dispose(),
      enumerable: true,
    },
  })

  return decorated
}

export function getActiveFineTerminalSession(): FineTerminalSession | null {
  return activeSession
}

export function getActiveFineTerminalTargetActor(): Actor | null {
  return activeTargetActor
}

export function isFineTerminalBusy(): boolean {
  const s = activeSession
  if (!s) return false
  const ph = s.getPhase()
  return ph !== 'idle' && ph !== 'done' && ph !== 'cancelled'
}

export function isFineTerminalDelivering(): boolean {
  return activeSession?.getPhase() === 'deliver'
}

export function isFineTerminalHandingOver(): boolean {
  return Boolean(activeSession?.getSnapshot().isHandingOver)
}

export function confirmActiveFineTerminalDeliver(): boolean {
  return activeSession?.confirmDeliver() ?? false
}

export function createFineTerminalBridge(
  defaults?: Omit<FineTerminalOpenOptions, 'actor' | 'violation' | 'fineYuan' | 'plateNo' | 'zoneName' | 'vehicleSubtype'>,
): FineTerminalBridge {
  return {
    openFineTerminal(req: FineTerminalRequest) {
      const reqWithViolations = req as FineTerminalRequest & {violations?: readonly import('../types.ts').ActiveViolation[]}
      return openFineTerminal({
        ...defaults,
        actor: req.actor,
        violation: req.violation,
        violations: reqWithViolations.violations,
        fineYuan: req.fineYuan,
        plateNo: req.plateNo ?? req.plate,
        zoneName: req.zoneName,
        vehicleSubtype: req.vehicleSubtype,
        getPlayerPos: req.getPlayerPos ?? defaults?.getPlayerPos,
        violatorObject3D: req.violatorObject3D ?? defaults?.violatorObject3D,
        dutyProps: req.dutyProps ?? defaults?.dutyProps,
        closeupCamera: req.closeupCamera ?? defaults?.closeupCamera,
        onToast: req.onToast ?? defaults?.onToast,
        onPhaseChange: (phase, snap) => {
          defaults?.onPhaseChange?.(phase, snap)
          req.onPhaseChange?.(phase, snap)
        },
      })
    },
    isOpen: () => isFineTerminalBusy(),
    isDelivering: () => isFineTerminalDelivering(),
    isHandingOver: () => isFineTerminalHandingOver(),
    confirmDeliver: () => confirmActiveFineTerminalDeliver(),
    getTargetActor: () => getActiveFineTerminalTargetActor(),
    close: () => getActiveFineTerminalSession()?.cancel('disposed'),
  }
}
