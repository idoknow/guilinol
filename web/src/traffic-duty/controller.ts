import {creditReward} from '../game/commerce.ts'
import type {DutyPropsHandle} from '../gear/duty-props.ts'
import {getLatestTraffic, stopActor as stopTrafficActor, type Actor, type Position, type Traffic, type TrafficViolation} from '../traffic/sim.ts'
import {isCitableViolator, resolveTrafficDutyCandidate, type WalkLockState} from './arbiter.ts'
import {
  bindDutyKeyboard,
  createDutyKeysController,
  syncDutyKeysIntoPanels,
  type BoundDutyKeyboardHandle,
  type DutyKeysController,
  type FlagKeyActionResult,
  type WhistleKeyActionResult,
} from './duty-keys.ts'
import {
  attachReceiptToViolator,
  DUPLICATE_CITATION_MESSAGE,
  getViolatorHeldReceipt,
  HANDOVER_MAX_DISTANCE_M,
  sharedCitationLedger,
} from './handover/index.ts'
import {createLocalLeaderboardProvider, type TrafficDutyLeaderboardProvider} from './leaderboard.ts'
import {
  createDutyStoryDirector,
  type DutyStoryBeatId,
  type DutyStoryDirectorHandle,
  type DutyStoryDirectorOptions,
  type DutyStorySnapshot,
} from './story/index.ts'
import {
  clampToBridgeDutyBounds,
  computeCommissionYuan,
  computeFineYuanStack,
  DEFAULT_FINE_YUAN,
  DEFAULT_OFFICER_TALK_RANGE_M,
  DEFAULT_SIGNAL_RANGE_M,
  DEFAULT_STOP_DURATION_SEC,
  DEFAULT_WHISTLE_RANGE_M,
  distanceToJiefangOfficer,
  DUTY_ZONES,
  formatDutyReportTitle,
  formatViolationBreakdownFormula,
  formatViolationStackLabel,
  isInBridgeDutyBounds,
  JIEFANG_DUTY_BOUNDS_WARNING,
  JIEFANG_DUTY_ZONE,
  PLAYER_COMMISSION_RATE,
  resolveActorViolations,
  resolveDutyZone,
  TRAFFIC_DUTY_DURATION_SEC,
  VIOLATION_BUBBLE_LINES,
  type ActiveViolation,
  type DutyBubbleSnapshot,
  type DutyFineTable,
  type DutyGearState,
  type DutyPhase,
  type DutySignalKind,
  type DutySignalResult,
  type DutyZone,
  type DutyZoneId,
  type FineTerminalRequest,
  type FineTerminalResult,
  type LeaderboardSummary,
  type OffDutySettlementResult,
  type ScreenMarkerSnapshot,
  type ShiftSettlement,
  type TrafficDutyController,
  type TrafficDutyHost,
  type TrafficDutyInteractCandidate,
  type TrafficDutySnapshot,
  type ViolationBreakdown,
  type WhistleCiteResult,
} from './types.ts'
import type {TrafficDutyUiHandle, TrafficDutyUiOptions} from './ui.ts'
import {playBrakeScreechSound, playCarHornSound, playFlagWaveSound, playWhistleSound} from './whistle.ts'

const BUBBLE_DURATION_SEC = 2.6
const BOUNDS_TOAST_COOLDOWN_SEC = 2.5
const BOUNDS_BANNER_HOLD_SEC = 2.4
const HORN_TOAST_COOLDOWN_SEC = 3.0

let globalShiftUid = 0

type ExtendedStoryDirectorHandle = DutyStoryDirectorHandle & {
  step?: (dt: number) => void
  isCameraActive?: () => boolean
}

function isEditableFocused(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.activeElement
  if (!el || typeof el.closest !== 'function') return false
  return Boolean(el.closest('input,textarea,select,[contenteditable]'))
}

interface LazyDutyPropsHooks {
  onWhistlePulse?: () => void
  onFlagMode?: (mode: 'stop' | 'pass') => void
}

function createLazyDutyPropsProxy(
  getHandle: () => DutyPropsHandle | null | undefined,
  hooks?: LazyDutyPropsHooks,
): DutyPropsHandle {
  const emptyProbe = (): ReturnType<DutyPropsHandle['getProbe']> => ({
    attached: false,
    attachedToSkeleton: false,
    whistleVisible: false,
    flagVisible: false,
    printerVisible: false,
    holsterStrapVisible: false,
    handSlipVisible: false,
    whistleAlwaysAtMouth: true,
    whistleMode: 'mouth',
    blowBlend: 0,
    blowPulse: 0,
    flagMode: 'stowed',
    printerMode: 'hidden',
    printProgress: 0,
    paperTornOff: false,
    handSide: 'right',
    whistleWorldPos: {x: 0, y: 0, z: 0},
    chestWorldPos: {x: 0, y: 0, z: 0},
    mouthWorldPos: {x: 0, y: 0, z: 0},
    flagWorldPos: {x: 0, y: 0, z: 0},
    printerWorldPos: {x: 0, y: 0, z: 0},
    whistleToMouthDist: 0,
    whistleToChestDist: 0,
  })
  return {
    get whistleGroup() {
      return getHandle()?.whistleGroup as DutyPropsHandle['whistleGroup']
    },
    get flagGroup() {
      return getHandle()?.flagGroup as DutyPropsHandle['flagGroup']
    },
    get holsterGroup() {
      return getHandle()?.holsterGroup as DutyPropsHandle['holsterGroup']
    },
    get printerGroup() {
      return getHandle()?.printerGroup as DutyPropsHandle['printerGroup']
    },
    get handSlipGroup() {
      return getHandle()?.handSlipGroup as DutyPropsHandle['handSlipGroup']
    },
    setVisible: v => getHandle()?.setVisible(v),
    setWhistleVisible: v => getHandle()?.setWhistleVisible(v),
    setFlagVisible: v => getHandle()?.setFlagVisible(v),
    setPrinterVisible: v => getHandle()?.setPrinterVisible(v),
    setWhistleAlwaysAtMouth: v => getHandle()?.setWhistleAlwaysAtMouth(v),
    setWhistleBlowing: (b, i) => getHandle()?.setWhistleBlowing(b, i),
    triggerWhistlePulse: () => {
      getHandle()?.triggerWhistlePulse()
      hooks?.onWhistlePulse?.()
    },
    setFlagMode: m => {
      getHandle()?.setFlagMode(m)
      if (m === 'stop' || m === 'pass') {
        hooks?.onFlagMode?.(m)
      }
    },
    setPrinterMode: m => getHandle()?.setPrinterMode(m),
    setPrintProgress: p => getHandle()?.setPrintProgress(p),
    tearOffSlip: () => getHandle()?.tearOffSlip(),
    clearHandSlip: () => getHandle()?.clearHandSlip(),
    isFlagSuppressedByTicket: () => Boolean(getHandle()?.isFlagSuppressedByTicket()),
    syncFromEmoteId: (id, i) => getHandle()?.syncFromEmoteId(id, i),
    update: dt => getHandle()?.update(dt),
    getProbe: () => getHandle()?.getProbe() ?? emptyProbe(),
    dispose: () => {},
  }
}

interface ActiveBubble {
  id: string
  actor: Actor
  title: string
  line: string
  fineYuan: number
  remainingSec: number
}

function emptyBreakdown(): ViolationBreakdown {
  return {
    no_helmet: 0,
    bike_double: 0,
    ebike_overload: 0,
    illegal_mod: 0,
    wrong_way: 0,
    red_light_run: 0,
  }
}

export function createTrafficDutyController(
  host: TrafficDutyHost,
  options?: {
    leaderboard?: TrafficDutyLeaderboardProvider
    mountDom?: boolean
    mountUi?: (opts: TrafficDutyUiOptions) => TrafficDutyUiHandle
  },
): TrafficDutyController {
  const durationSec = Math.max(10, Math.round(host.durationSec ?? TRAFFIC_DUTY_DURATION_SEC))
  const whistleRangeM = Math.max(3.5, Math.min(4.5, host.whistleRangeM ?? DEFAULT_WHISTLE_RANGE_M))
  const officerTalkRangeM = Math.max(3.0, host.officerTalkRangeM ?? DEFAULT_OFFICER_TALK_RANGE_M)
  const signalRangeM = Math.max(8.0, host.signalRangeM ?? DEFAULT_SIGNAL_RANGE_M)
  const stopDurationSec = Math.max(1.5, host.stopDurationSec ?? DEFAULT_STOP_DURATION_SEC)
  const fineTable: DutyFineTable = {
    no_helmet: Math.max(1, Math.round(host.fineTable?.no_helmet ?? DEFAULT_FINE_YUAN.no_helmet)),
    bike_double: Math.max(1, Math.round(host.fineTable?.bike_double ?? DEFAULT_FINE_YUAN.bike_double)),
    ebike_overload: Math.max(1, Math.round(host.fineTable?.ebike_overload ?? DEFAULT_FINE_YUAN.ebike_overload)),
    illegal_mod: Math.max(1, Math.round(host.fineTable?.illegal_mod ?? DEFAULT_FINE_YUAN.illegal_mod)),
    wrong_way: Math.max(1, Math.round(host.fineTable?.wrong_way ?? DEFAULT_FINE_YUAN.wrong_way)),
    red_light_run: Math.max(1, Math.round(host.fineTable?.red_light_run ?? DEFAULT_FINE_YUAN.red_light_run)),
    sidewalk_riding: Math.max(1, Math.round(host.fineTable?.sidewalk_riding ?? DEFAULT_FINE_YUAN.sidewalk_riding)),
  }
  const leaderboard = options?.leaderboard ?? createLocalLeaderboardProvider()
  let cachedLeaderboard = leaderboard.load()

  let phase: DutyPhase = 'idle'
  let remainingSec = durationSec
  let elapsedSec = 0
  let totalFineYuan = 0
  let pendingEarningsYuan = 0
  let settledEarningsYuan = 0
  let stackedCitationCount = 0
  let stackedFineYuan = 0
  const nextShiftNonce = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  let shiftUid = ++globalShiftUid
  let shiftNonce = nextShiftNonce()
  let shiftSettled = false
  let offDutyStoryActive = false
  let citedCount = 0
  let whistleCount = 0
  let signalCount = 0
  let lastSignal: DutySignalKind | null = null
  let breakdown: ViolationBreakdown = emptyBreakdown()
  let reportTitle: string | null = null
  let lastRecordRank: number | null = null
  let isNewRecord = false
  let lastTrafficApplied: Traffic | undefined
  let bubbleSeq = 0
  const bubbles: ActiveBubble[] = []
  let shiftZone: DutyZone | null = null
  let ui: TrafficDutyUiHandle | undefined

  // Story gate + duty gear state
  let briefingAuthorized = false
  let gear: DutyGearState = Object.freeze({hasWhistle: false, hasFlag: false})
  let terminalOpen = false
  const citedActors = new WeakSet<Actor>()
  let pendingViolator: Actor | null = null
  let outOfBoundsWarning: string | null = null
  let outOfBoundsHoldSec = 0
  let boundsToastCooldown = 0
  let hornToastCooldown = 0
  let lastCameraLocked = false
  let unsubscribeHit: (() => void) | null = null
  let unsubscribeHorn: (() => void) | null = null
  let dutyKeyboardHandle: BoundDutyKeyboardHandle | null = null
  let disposed = false

  const shouldMountDom =
    options?.mountDom === true || (options?.mountDom !== false && typeof document !== 'undefined')

  function isKnockdownActive(): boolean {
    const kd = host.knockdownBridge?.isDown
    return typeof kd === 'function' ? Boolean(kd()) : Boolean(kd)
  }

  function officerWorldPos(): {x: number; y: number; z: number} {
    return host.getOfficerPos?.() ?? JIEFANG_DUTY_ZONE.spot
  }

  function activeTraffic(): Traffic | undefined {
    return host.trafficBridge?.getTraffic?.() ?? host.getTraffic?.() ?? getLatestTraffic()
  }

  function currentActors(): readonly Actor[] {
    if (host.trafficBridge?.getActors) return host.trafficBridge.getActors()
    if (host.getActors) return host.getActors()
    return activeTraffic()?.actors ?? []
  }

  function stopTargetActor(actor: Actor, sec: number): boolean {
    if (host.trafficBridge?.stopActor) return host.trafficBridge.stopActor(actor, sec)
    if (host.stopActor) return host.stopActor(actor, sec)
    return stopTrafficActor(actor, sec, activeTraffic())
  }

  function notifyActorPulledOver(actor: Actor, durationSecVal: number): void {
    host.trafficBridge?.onViolatorPulledOver?.(actor, durationSecVal)
  }

  function applyTrafficDutyConfig(on: boolean): void {
    const sim = activeTraffic()
    if (!sim) return
    lastTrafficApplied = sim
    const existing = sim.getDutyConfig?.()
    sim.setDutyConfig({
      ...(existing ?? {}),
      active: on,
      center: existing?.center ?? JIEFANG_DUTY_ZONE.center,
      radius: existing?.radius ?? JIEFANG_DUTY_ZONE.radiusM,
      zones: host.trafficBridge
        ? [
            {
              id: JIEFANG_DUTY_ZONE.id,
              center: JIEFANG_DUTY_ZONE.center,
              radius: JIEFANG_DUTY_ZONE.radiusM,
              weights: host.violationWeights ?? existing?.weights,
            },
          ]
        : DUTY_ZONES.map(zone => ({
            id: zone.id,
            center: zone.center,
            radius: zone.radiusM,
            weights: host.violationWeights,
          })),
      weights: host.violationWeights ?? existing?.weights,
      twoWheelShare: host.twoWheelShare ?? existing?.twoWheelShare ?? 0.56,
    })
  }

  function startTrafficBridge(): void {
    lastTrafficApplied = undefined
    host.trafficBridge?.start?.()
    applyTrafficDutyConfig(true)
  }

  function stopTrafficBridge(): void {
    applyTrafficDutyConfig(false)
    host.trafficBridge?.stop?.()
    lastTrafficApplied = undefined
  }

  function syncDutyBodyAndPanels(on: boolean): void {
    if (typeof document === 'undefined' || !document.body) return
    document.body.dataset.tdDutyActive = on ? '1' : '0'
    if (on) document.body.dataset.duty = 'active'
    else delete document.body.dataset.duty
    if (shouldMountDom && host.enableDutyKeys !== false) {
      syncDutyKeysIntoPanels(document, on)
    }
  }

  function isHandoverReady(): boolean {
    if (host.fineTerminal?.isDelivering?.()) return true
    return dutyKeys.getActiveWorkflow()?.getStage() === 'tear_off'
  }

  function isTerminalFlowActive(): boolean {
    if (terminalOpen) return true
    if (host.fineTerminal?.isOpen?.()) return true
    if (dutyKeys.getActiveWorkflow()?.isActive()) return true
    return false
  }

  function isStoryOrOffDutyActive(): boolean {
    return story.isActive() || offDutyStoryActive
  }

  function canStartKnockdown(): boolean {
    return !isStoryOrOffDutyActive() && !isTerminalFlowActive()
  }

  function canOpenStory(): boolean {
    return !isKnockdownActive() && !isTerminalFlowActive() && !isStoryOrOffDutyActive()
  }

  function canOpenFineTerminal(): boolean {
    return phase === 'active' && !isKnockdownActive() && !isStoryOrOffDutyActive() && !isTerminalFlowActive()
  }

  function isCameraLocked(): boolean {
    if (isStoryOrOffDutyActive() || story.getSnapshot().cameraState?.active) return true
    if (host.fineTerminal?.isHandingOver?.()) return true
    const wf = dutyKeys.getActiveWorkflow()
    if (wf && wf.getSnapshot().closeup.active) return true
    return false
  }

  function syncCameraLock(): void {
    const locked = isCameraLocked()
    if (locked !== lastCameraLocked) {
      lastCameraLocked = locked
      host.onCameraControlChange?.(locked)
    }
  }

  function attachHitListener(): void {
    detachHitListener()
    const unsub = host.trafficBridge?.onPlayerHit?.((severity, dir, event) => {
      if (phase !== 'active' || !canStartKnockdown()) return
      const score =
        typeof severity === 'number'
          ? severity
          : typeof event?.severityScore === 'number'
            ? event.severityScore
            : severity === 'heavy'
              ? 1.0
              : severity === 'medium'
                ? 0.65
                : 0.35
      host.knockdownBridge?.triggerKnockdown?.('vehicle_hit', dir, score)
    })
    unsubscribeHit = typeof unsub === 'function' ? unsub : null

    const unsubHorn = host.trafficBridge?.onPlayerHorn?.(() => {
      if (phase !== 'active' || !canStartKnockdown() || isKnockdownActive()) return
      playCarHornSound()
      if (hornToastCooldown <= 0) {
        hornToastCooldown = HORN_TOAST_COOLDOWN_SEC
        host.onToast?.('来车鸣笛提醒，请注意避让机动车道', 1800)
      }
    })
    unsubscribeHorn = typeof unsubHorn === 'function' ? unsubHorn : null
  }

  function detachHitListener(): void {
    unsubscribeHit?.()
    unsubscribeHit = null
    unsubscribeHorn?.()
    unsubscribeHorn = null
  }

  function clearBubbles(): void {
    bubbles.length = 0
  }

  function buildBubbleSnapshots(): DutyBubbleSnapshot[] {
    return bubbles.map(item => {
      const worldY = item.actor.y + 2.05
      const proj = host.projectToScreen?.({x: item.actor.x, y: worldY, z: item.actor.z})
      return {
        id: item.id,
        actor: item.actor,
        title: item.title,
        line: item.line,
        fineYuan: item.fineYuan,
        x: item.actor.x,
        y: worldY,
        z: item.actor.z,
        remainingSec: item.remainingSec,
        screenX: proj?.x ?? 0,
        screenY: proj?.y ?? 0,
        visible: Boolean(proj?.visible),
      }
    })
  }

  function buildOfficerScreenMarker(): ScreenMarkerSnapshot | null {
    if (!host.projectToScreen) return null
    const op = officerWorldPos()
    return host.projectToScreen({x: op.x, y: op.y + 2.38, z: op.z})
  }

  function emitBoundsWarning(clamped: Position, emitHostClamp = true): void {
    outOfBoundsWarning = JIEFANG_DUTY_BOUNDS_WARNING
    outOfBoundsHoldSec = BOUNDS_BANNER_HOLD_SEC
    if (emitHostClamp) host.onDutyBoundaryClamp?.(clamped, outOfBoundsWarning)
    if (!ui && boundsToastCooldown <= 0) {
      boundsToastCooldown = BOUNDS_TOAST_COOLDOWN_SEC
      host.onToast?.(outOfBoundsWarning, 2200)
    }
  }

  function isInActiveShiftBounds(pos: Position | null): boolean {
    if (!shiftZone || shiftZone.id === 'jiefang') return isInBridgeDutyBounds(pos)
    return resolveDutyZone(pos)?.id === shiftZone.id
  }

  function clampPlayerPos(
    pos: Position,
    options?: {emitHostClamp?: boolean},
  ): {pos: Position; clamped: boolean; warning: string | null} {
    if (phase !== 'active' || (shiftZone && shiftZone.id !== 'jiefang')) {
      return {pos: {x: pos.x, y: pos.y, z: pos.z}, clamped: false, warning: null}
    }
    const {clamped, outOfBounds} = clampToBridgeDutyBounds(pos)
    if (outOfBounds) {
      emitBoundsWarning(clamped, options?.emitHostClamp !== false)
      return {pos: clamped, clamped: true, warning: outOfBoundsWarning}
    }
    return {pos: clamped, clamped: false, warning: outOfBoundsWarning}
  }

  function setGear(next: DutyGearState): void {
    gear = Object.freeze({hasWhistle: Boolean(next.hasWhistle), hasFlag: Boolean(next.hasFlag)})
    if (gear.hasWhistle || gear.hasFlag) {
      host.propsBridge?.grantGear?.(gear)
      host.propsBridge?.setWhistleAlwaysAtMouth?.(gear.hasWhistle)
      host.onGearGrant?.(gear)
    } else {
      host.propsBridge?.setWhistleAlwaysAtMouth?.(false)
      host.propsBridge?.clearGear?.()
    }
  }

  const storyOpts: DutyStoryDirectorOptions = {
    container: host.mountContainer ?? (typeof document !== 'undefined' ? document.body : null),
    mountDom: shouldMountDom && typeof document !== 'undefined',
    camera: host.camera ?? null,
    getPlayerPos: () => host.getPlayerPos(),
    getOfficerAnchor: () => {
      const op = officerWorldPos()
      const head = host.officerNpc?.headWorld?.()
      const pp = host.getPlayerPos()
      return {
        npcPos: [op.x, op.y, op.z],
        npcYaw: host.getOfficerYaw?.() ?? JIEFANG_DUTY_ZONE.spot.yaw,
        npcHead: head ? [head.x, head.y, head.z] : [op.x, op.y + 1.56, op.z],
        playerPos: pp ? [pp.x, pp.y, pp.z] : null,
      }
    },
    onOfficerExpression: expr => {
      host.onOfficerExpression?.(expr)
      host.officerNpc?.setExpression?.(expr)
    },
    onOfficerLookTarget: pos => {
      host.onOfficerLookTarget?.(pos)
      host.officerNpc?.setLookTarget?.(pos)
    },
    onOpen() {
      ui?.closePanel()
      host.onOfficerStateChange?.('talking')
      host.onOfficerLookTarget?.(host.getPlayerPos())
      syncCameraLock()
      syncUi()
    },
    onLineChange(line) {
      if (line.grantGear) host.onOfficerStateChange?.('handoff')
      else host.onOfficerStateChange?.('talking')
      host.onOfficerExpression?.(line.expr)
      host.onOfficerLookTarget?.(host.getPlayerPos())
      syncCameraLock()
    },
    onGearHandover(reward) {
      setGear(reward)
      host.onOfficerStateChange?.('handoff')
      syncUi()
    },
    onComplete(payload) {
      host.onOfficerLookTarget?.(null)
      const beatText = String(payload.beatId ?? '')
      if (offDutyStoryActive || beatText.includes('off_duty') || beatText.includes('offduty')) {
        if (payload.accepted !== false) {
          completeOffDutySettlement()
        } else {
          offDutyStoryActive = false
          host.onOfficerStateChange?.(phase === 'active' ? 'active' : 'available')
          syncCameraLock()
          syncUi()
        }
        return
      }
      syncCameraLock()
      if (payload.accepted) {
        briefingAuthorized = true
        setGear(payload.gear)
        enterActiveDutyFromBriefing()
      } else {
        host.onOfficerStateChange?.('available')
        host.onToast?.('随时回到解放桥交警身旁即可领取任务上岗', 2200)
        syncUi()
      }
    },
    onSettled() {
      completeOffDutySettlement()
    },
    onCancel() {
      if (offDutyStoryActive) {
        offDutyStoryActive = false
        host.onOfficerStateChange?.(phase === 'active' ? 'active' : 'available')
        host.onOfficerLookTarget?.(null)
        syncCameraLock()
        syncUi()
        return
      }
      host.onOfficerStateChange?.('available')
      host.onOfficerLookTarget?.(null)
      syncCameraLock()
      syncUi()
    },
  }

  const story: ExtendedStoryDirectorHandle = createDutyStoryDirector(storyOpts) as ExtendedStoryDirectorHandle

  let inDutyKeysGesture = false
  let lastDutyKeysGestureSeq = 0
  const dispatchDutyKeysGesture = (kind: DutySignalKind) => {
    if (inDutyKeysGesture) return
    inDutyKeysGesture = true
    lastDutyKeysGestureSeq++
    try {
      if (kind === 'whistle') {
        whistleCount++
      }
      signalCount++
      lastSignal = kind
      host.propsBridge?.playGesture?.(kind)
      syncUi()
    } finally {
      inDutyKeysGesture = false
    }
  }

  const lazyDutyProps = createLazyDutyPropsProxy(() => host.propsBridge?.getHandle?.() ?? null)
  const dutyKeys: DutyKeysController = createDutyKeysController({
    isDutyActive: () => phase === 'active' && !isKnockdownActive() && !isStoryOrOffDutyActive(),
    getPlayerPos: () => host.getPlayerPos(),
    getPlayerForward: host.getPlayerForward,
    getPlayerYaw: host.getPlayerYaw,
    getActors: () => currentActors(),
    stopActor: (actor, sec) => {
      pendingViolator = actor
      const pulled = host.trafficBridge?.onViolatorPulledOver?.(actor, sec)
      if (pulled) return true
      return stopTargetActor(actor, sec)
    },
    onViolatorReleased: actor => {
      host.trafficBridge?.releaseViolator?.(actor)
      if (pendingViolator === actor) pendingViolator = null
      syncUi()
    },
    playGesture: kind => dispatchDutyKeysGesture(kind),
    isExternalTicketing: () => terminalOpen || Boolean(host.fineTerminal?.isOpen?.()),
    ledger: sharedCitationLedger,
    dutyProps: lazyDutyProps,
    getActorHandBone: actor => host.trafficBridge?.getActorHandBone?.(actor, 'right') ?? null,
    resolveViolatorHandBone: actor => host.trafficBridge?.getActorHandBone?.(actor, 'right') ?? null,
    sound: shouldMountDom,
    onToast: msg => host.onToast?.(msg, 2400),
    onTicketStarted: (_wf, actor) => {
      pendingViolator = actor
      syncCameraLock()
      syncUi()
    },
    onTicketDelivered: actor => {
      const wfSnap = dutyKeys.getActiveWorkflow()?.getSnapshot()
      if (!citedActors.has(actor)) {
        const actorViols = resolveActorViolations(actor as Actor & {violations?: readonly TrafficViolation[]})
        const viol: ActiveViolation = wfSnap?.violation ?? actorViols[0] ?? 'no_helmet'
        const finalViolations = actorViols.length > 0 ? actorViols : [viol]
        const yuan = wfSnap?.fineYuan ?? computeFineYuanStack(finalViolations, fineTable)
        const dist = wfSnap?.distanceToTargetM ?? 1.0
        commitIssuedCitation(
          actor,
          viol,
          yuan,
          dist,
          wfSnap?.receiptNo,
          wfSnap?.plateNo,
          wfSnap?.issuedRecord ?? undefined,
          finalViolations,
        )
      } else {
        host.trafficBridge?.notifyViolatorCited?.(actor)
        host.trafficBridge?.onTicketReceived?.(actor, {
          ticketId: wfSnap?.receiptNo,
          fineYuan: wfSnap?.fineYuan,
          plateNo: wfSnap?.plateNo,
          violation: wfSnap?.violation,
        })
      }
      syncCameraLock()
      syncUi()
    },
  })

  if (shouldMountDom && host.enableDutyKeys !== false && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    dutyKeyboardHandle = bindDutyKeyboard(
      window,
      dutyKeys,
      () =>
        phase === 'active' &&
        host.isWalking() &&
        !isKnockdownActive() &&
        !isStoryOrOffDutyActive() &&
        !host.isUiBlocked?.() &&
        !isEditableFocused() &&
        typeof document !== 'undefined' &&
        !document.body.hasAttribute('data-home') &&
        document.body.dataset.photo !== 'on' &&
        document.body.dataset.shopOpen !== '1',
    )
  }

  function isActorAlreadyCited(actor: Actor): boolean {
    return Boolean(actor.cited || citedActors.has(actor) || sharedCitationLedger.hasCited(actor))
  }

  function resolveActivePendingViolator(pos: Position | null): Actor | null {
    if (!pendingViolator) return null
    if (isActorAlreadyCited(pendingViolator) || pendingViolator.leaving) {
      pendingViolator = null
      return null
    }
    const actors = currentActors()
    if (!actors.includes(pendingViolator)) {
      pendingViolator = null
      return null
    }
    if (pos && Math.hypot(pendingViolator.x - pos.x, pendingViolator.z - pos.z) > 32) {
      pendingViolator = null
      return null
    }
    return pendingViolator
  }

  function getInteractCandidate(walkLocks?: WalkLockState): TrafficDutyInteractCandidate | null {
    if (!host.isWalking() || isStoryOrOffDutyActive() || isKnockdownActive()) return null
    const pos = host.getPlayerPos()

    // Priority 1: Ready-to-deliver fine slip (`<= 1.5m` handover) overrides fine-ticket opening & officer dialogue
    if (phase === 'active' && isHandoverReady() && isInActiveShiftBounds(pos)) {
      if (walkLocks && (walkLocks.active === false || walkLocks.crashed || walkLocks.standingUp || walkLocks.pickingUpKind || walkLocks.aboardKind)) {
        return null
      }
      const target = host.fineTerminal?.getTargetActor?.() ?? pendingViolator
      const dist = pos && target ? Math.hypot(target.x - pos.x, target.z - pos.z) : 0
      const canDeliverNow = dist <= HANDOVER_MAX_DISTANCE_M + 1e-6
      const targetViols = resolveActorViolations(target as (Actor & {violations?: readonly TrafficViolation[]}) | null)
      const viol: ActiveViolation = targetViols[0] ?? 'no_helmet'
      const stackedViols = targetViols.length > 0 ? targetViols : [viol]
      return {
        action: 'handover_ticket',
        label: canDeliverNow ? '递交罚单' : `走近至 ${HANDOVER_MAX_DISTANCE_M}m 内递交罚单`,
        distance: dist,
        violation: viol,
        violations: stackedViols,
        fineYuan: computeFineYuanStack(stackedViols, fineTable),
        actor: target ?? undefined,
        canDeliverNow,
      }
    }

    if (host.isUiBlocked?.() || isTerminalFlowActive()) return null
    // Boss #5: during active duty, strictly forbid duty interaction outside active duty shift bounds
    if (phase === 'active' && !isInActiveShiftBounds(pos)) return null
    const activePending = phase === 'active' ? resolveActivePendingViolator(pos) : null
    const candidateActors = activePending
      ? [activePending]
      : currentActors().filter(a => !isActorAlreadyCited(a))
    const canReportOffDutyNow =
      phase === 'active' || (phase === 'summary' && !shiftSettled && pendingEarningsYuan > 0)
    return resolveTrafficDutyCandidate(
      phase === 'active',
      walkLocks,
      candidateActors,
      pos,
      whistleRangeM,
      fineTable,
      {
        canTalkOfficer: phase !== 'active',
        canReportOffDuty: canReportOffDutyNow,
        pendingEarningsYuan,
        officerPos: officerWorldPos(),
        officerRangeM: officerTalkRangeM,
        briefingDone: story.hasCompletedBriefing(),
      },
    )
  }

  function getShiftSettlement(): ShiftSettlement {
    const activeZone = shiftZone ?? resolveDutyZone(host.getPlayerPos()) ?? JIEFANG_DUTY_ZONE
    const earnings = shiftSettled ? settledEarningsYuan : pendingEarningsYuan
    const roundedElapsed = Math.max(0, Math.round(elapsedSec))
    return {
      citedCount,
      totalFineYuan,
      commissionRate: PLAYER_COMMISSION_RATE,
      playerShareRate: PLAYER_COMMISSION_RATE,
      pendingEarningsYuan,
      earningsYuan: earnings,
      rewardYuan: earnings,
      stackedCitationCount,
      stackedCount: stackedCitationCount,
      stackedFineYuan,
      breakdown: {...breakdown},
      zoneName: activeZone.name,
      durationSec: roundedElapsed,
      elapsedSec: roundedElapsed,
      settled: shiftSettled,
    }
  }

  function getSnapshot(): TrafficDutySnapshot {
    const pos = host.getPlayerPos()
    const currentZone = resolveDutyZone(pos)
    const inDutyZone = currentZone !== null
    const inBridgeBounds = isInBridgeDutyBounds(pos)
    const candidate = getInteractCandidate()
    const violatorCand = candidate && candidate.action === 'whistle_cite' && candidate.violation !== 'officer_briefing'
      ? candidate
      : null
    const op = officerWorldPos()
    const termOpenNow = isTerminalFlowActive()
    const kdNow = isKnockdownActive()
    const storyOpenNow = isStoryOrOffDutyActive()
    return {
      phase,
      durationSec,
      remainingSec,
      elapsedSec,
      totalFineYuan,
      pendingEarningsYuan,
      settledEarningsYuan,
      commissionRate: PLAYER_COMMISSION_RATE,
      stackedCitationCount,
      citedCount,
      breakdown: {...breakdown},
      inDutyZone,
      inBridgeBounds,
      zoneId: currentZone?.id ?? null,
      zoneName: currentZone?.name ?? null,
      nearestDistanceM: violatorCand ? violatorCand.distance : null,
      nearestViolation: violatorCand ? (violatorCand.violation as ActiveViolation) : null,
      nearestFineYuan: violatorCand ? violatorCand.fineYuan : null,
      whistleCount,
      signalCount,
      lastSignal,
      briefingDone: briefingAuthorized || story.hasCompletedBriefing(),
      storyActive: storyOpenNow,
      offDutyStoryActive,
      terminalOpen: termOpenNow,
      handoverPending: isHandoverReady(),
      cameraLocked: isCameraLocked(),
      knockdownActive: kdNow,
      hasPendingCitation: Boolean(phase === 'active' && resolveActivePendingViolator(pos)),
      gear: {...gear},
      officerDistanceM: distanceToJiefangOfficer(pos, op),
      officerScreen: !storyOpenNow && !kdNow ? buildOfficerScreenMarker() : null,
      outOfBoundsWarning,
      reportTitle,
      lastRecordRank,
      isNewRecord,
      bubbles: buildBubbleSnapshots(),
    }
  }

  function syncUi(): void {
    ui?.render(getSnapshot(), cachedLeaderboard, getInteractCandidate())
  }

  function resetCounters(): void {
    remainingSec = durationSec
    elapsedSec = 0
    totalFineYuan = 0
    pendingEarningsYuan = 0
    settledEarningsYuan = 0
    stackedCitationCount = 0
    stackedFineYuan = 0
    shiftUid = ++globalShiftUid
    shiftNonce = nextShiftNonce()
    shiftSettled = false
    offDutyStoryActive = false
    citedCount = 0
    whistleCount = 0
    signalCount = 0
    lastSignal = null
    breakdown = emptyBreakdown()
    reportTitle = null
    lastRecordRank = null
    isNewRecord = false
    shiftZone = null
    pendingViolator = null
    outOfBoundsWarning = null
    outOfBoundsHoldSec = 0
    boundsToastCooldown = 0
    hornToastCooldown = 0
    clearBubbles()
  }

  function enterActiveDutyFromBriefing(): TrafficDutySnapshot {
    resetCounters()
    shiftZone = resolveDutyZone(host.getPlayerPos()) ?? JIEFANG_DUTY_ZONE
    phase = 'active'
    if (!gear.hasWhistle || !gear.hasFlag) {
      setGear({hasWhistle: true, hasFlag: true})
    }
    syncDutyBodyAndPanels(true)
    ui?.closePanel()
    startTrafficBridge()
    attachHitListener()
    host.onOfficerStateChange?.('active')
    host.onDutyStateChange?.(true)
    host.onToast?.(
      shiftZone.id === 'jiefang'
        ? '解放桥交通劝导已上岗，请留在桥面执勤范围内吹哨挥旗劝导违规车'
        : `${shiftZone.name}交通劝导已上岗，请留在执勤范围内吹哨挥旗劝导违规车`,
      2800,
    )
    syncCameraLock()
    syncUi()
    return getSnapshot()
  }

  /**
   * Hard story gate: players CANNOT start duty directly without completing the Jiefang officer briefing dialogue.
   * Once a briefing has been authorized for the current shift (via story completion), this starts duty cleanly.
   */
  function startDuty(): TrafficDutySnapshot {
    if (!briefingAuthorized) {
      host.onToast?.('请先到解放桥桥头与交警对话，领取哨子和指挥旗后再上岗', 2600)
      syncUi()
      return getSnapshot()
    }
    return enterActiveDutyFromBriefing()
  }

  function startOfficerBriefing(beatId?: DutyStoryBeatId): boolean {
    if (phase === 'active' || !canOpenStory()) return false
    const opened = story.open(beatId)
    if (opened) {
      syncCameraLock()
      syncUi()
    }
    return opened
  }

  function creditPendingEarningsOnce(): OffDutySettlementResult {
    if (shiftSettled) {
      return {
        ok: true,
        alreadySettled: true,
        creditedYuan: 0,
        settlement: getShiftSettlement(),
      }
    }
    const payout = Math.max(0, Math.round(pendingEarningsYuan))
    const preSettlement = getShiftSettlement()
    let credited = 0
    let balanceAfter: number | undefined
    if (payout > 0) {
      if (host.creditWallet) {
        const res = host.creditWallet(payout, preSettlement)
        if (!res.ok) {
          return {
            ok: false,
            alreadySettled: false,
            creditedYuan: 0,
            balanceAfter: res.balanceAfter,
            settlement: preSettlement,
          }
        }
        credited = res.credited
        balanceAfter = res.balanceAfter
      } else {
        const key = `traffic_duty_settle:${shiftUid}:${shiftNonce}:${totalFineYuan}:${citedCount}:${payout}`
        const res = creditReward({
          source: 'mission_errand',
          refId: 'traffic_duty_jiefang',
          amount: payout,
          idempotencyKey: key,
        })
        if (!res.ok) {
          return {
            ok: false,
            alreadySettled: false,
            creditedYuan: 0,
            balanceAfter: res.balanceAfter,
            settlement: preSettlement,
          }
        }
        credited = res.credited
        balanceAfter = res.balanceAfter
      }
    }
    settledEarningsYuan = credited
    pendingEarningsYuan = 0
    shiftSettled = true
    return {
      ok: true,
      alreadySettled: false,
      creditedYuan: credited,
      ...(balanceAfter !== undefined ? {balanceAfter} : {}),
      settlement: getShiftSettlement(),
    }
  }

  function completeOffDutySettlement(): OffDutySettlementResult {
    offDutyStoryActive = false
    const settled = creditPendingEarningsOnce()
    if (phase === 'active') {
      recordAndSummarize(true)
    } else {
      syncCameraLock()
      syncUi()
    }
    if (!settled.alreadySettled && settled.ok) {
      if (settled.creditedYuan > 0) {
        host.onToast?.(`已向解放桥交警交差下岗，执勤分成 ¥${settled.creditedYuan} 已入账`, 2800)
      } else {
        host.onToast?.('已向解放桥交警交差下岗', 2200)
      }
    }
    return settled
  }

  function startOffDutyReport(): boolean {
    const canReport = phase === 'active' || (phase === 'summary' && !shiftSettled && pendingEarningsYuan > 0)
    if (!canReport || !canOpenStory()) return false
    const settlement = getShiftSettlement()
    offDutyStoryActive = true
    const finishSettled = () => {
      if (!offDutyStoryActive && shiftSettled) return
      completeOffDutySettlement()
    }
    const cancelReport = () => {
      if (!offDutyStoryActive) return
      offDutyStoryActive = false
      host.onOfficerLookTarget?.(null)
      host.onOfficerStateChange?.(phase === 'active' ? 'active' : 'available')
      syncCameraLock()
      syncUi()
    }
    if (host.onOpenOffDutyStory) {
      const opened = host.onOpenOffDutyStory(settlement, {
        onSettled: finishSettled,
        onCancel: cancelReport,
      })
      if (!opened) {
        offDutyStoryActive = false
        return false
      }
      ui?.closePanel()
      host.onOfficerStateChange?.('talking')
      host.onOfficerLookTarget?.(host.getPlayerPos())
      syncCameraLock()
      syncUi()
      return true
    }
    if (typeof story.openOffDuty === 'function') {
      const opened = story.openOffDuty(settlement, () => finishSettled())
      if (!opened) {
        offDutyStoryActive = false
        return false
      }
      syncCameraLock()
      syncUi()
      return true
    }
    completeOffDutySettlement()
    return true
  }

  function recordAndSummarize(completed: boolean): TrafficDutySnapshot {
    phase = 'summary'
    briefingAuthorized = false
    offDutyStoryActive = false
    terminalOpen = false
    pendingViolator = null
    dutyKeys.getActiveWorkflow()?.cancel()
    host.fineTerminal?.close?.()
    detachHitListener()
    stopTrafficBridge()
    setGear({hasWhistle: false, hasFlag: false})
    syncDutyBodyAndPanels(false)
    host.onOfficerStateChange?.('available')
    host.onDutyStateChange?.(false)
    outOfBoundsWarning = null
    outOfBoundsHoldSec = 0
    const activeZone = shiftZone ?? resolveDutyZone(host.getPlayerPos()) ?? JIEFANG_DUTY_ZONE
    reportTitle = formatDutyReportTitle(totalFineYuan, activeZone.name)
    if (citedCount === 0 && totalFineYuan === 0) {
      lastRecordRank = null
      isNewRecord = false
    } else {
      const saved = leaderboard.record({
        playerName: host.getPlayerName?.() || '桂林市民',
        totalFineYuan,
        citedCount,
        breakdown: {...breakdown},
        durationSec: Math.max(1, Math.round(elapsedSec || (completed ? durationSec : 1))),
        completed,
        achievedAt: Date.now(),
      })
      cachedLeaderboard = saved.summary
      lastRecordRank = saved.rank
      isNewRecord = saved.isNewRecord
    }
    syncCameraLock()
    ui?.openPanel('duty')
    syncUi()
    return getSnapshot()
  }

  function abandonDuty(): TrafficDutySnapshot {
    if (phase !== 'active') return getSnapshot()
    // Direct abandon without checking out with the officer forfeits pending 10% commission.
    pendingEarningsYuan = 0
    return recordAndSummarize(false)
  }

  function finishDuty(): TrafficDutySnapshot {
    if (phase !== 'active') return getSnapshot()
    remainingSec = 0
    return recordAndSummarize(true)
  }

  function resetToIdle(): TrafficDutySnapshot {
    phase = 'idle'
    briefingAuthorized = false
    offDutyStoryActive = false
    terminalOpen = false
    pendingViolator = null
    dutyKeys.getActiveWorkflow()?.cancel()
    host.fineTerminal?.close?.()
    detachHitListener()
    stopTrafficBridge()
    setGear({hasWhistle: false, hasFlag: false})
    syncDutyBodyAndPanels(false)
    host.onOfficerStateChange?.('available')
    host.onDutyStateChange?.(false)
    resetCounters()
    syncCameraLock()
    syncUi()
    return getSnapshot()
  }

  function triggerSignal(kind: DutySignalKind): DutySignalResult {
    if (phase !== 'active') {
      return {ok: false, kind, reason: 'inactive', affectedCount: 0, stoppedCount: 0, fleeingCount: 0}
    }
    if (isKnockdownActive()) {
      return {ok: false, kind, reason: 'knockdown_active', affectedCount: 0, stoppedCount: 0, fleeingCount: 0}
    }
    if (story.isActive()) {
      return {ok: false, kind, reason: 'story_open', affectedCount: 0, stoppedCount: 0, fleeingCount: 0}
    }
    if (isTerminalFlowActive()) {
      return {ok: false, kind, reason: 'terminal_open', affectedCount: 0, stoppedCount: 0, fleeingCount: 0}
    }
    const pos = host.getPlayerPos()
    if ((kind === 'whistle' || kind === 'flag_stop') && resolveActivePendingViolator(pos)) {
      host.onToast?.('请先为已拦停的违规车开完罚单，再拦下一辆', 2200)
      return {ok: false, kind, reason: 'pending_citation', affectedCount: 0, stoppedCount: 0, fleeingCount: 0}
    }
    if (kind === 'whistle' && !gear.hasWhistle) {
      return {ok: false, kind, reason: 'missing_gear', affectedCount: 0, stoppedCount: 0, fleeingCount: 0}
    }
    if ((kind === 'flag_stop' || kind === 'flag_go') && !gear.hasFlag) {
      return {ok: false, kind, reason: 'missing_gear', affectedCount: 0, stoppedCount: 0, fleeingCount: 0}
    }

    signalCount++
    lastSignal = kind
    if (kind === 'whistle') {
      whistleCount++
      playWhistleSound()
    } else {
      playFlagWaveSound(kind === 'flag_stop' ? 'stop' : 'go')
    }
    host.propsBridge?.playGesture?.(kind)

    let affectedCount = 0
    let stoppedCount = 0
    let fleeingCount = 0
    let newlyHaltedTarget: Actor | null = null
    let newlyHaltedDist = Infinity

    if (pos) {
      const haltRes =
        kind !== 'flag_go' && host.trafficBridge?.commandHalt
          ? host.trafficBridge.commandHalt(pos, {
              kind: kind === 'whistle' ? 'whistle' : 'flag',
              rangeM: kind === 'whistle' ? signalRangeM : Math.min(14, signalRangeM),
              stopDurationSec,
            })
          : null

      if (haltRes) {
        affectedCount = haltRes.affected
        stoppedCount = haltRes.halted.length
        fleeingCount = haltRes.fled.length
        for (const a of haltRes.halted) {
          if (!isCitableViolator(a) || isActorAlreadyCited(a)) continue
          const d = Math.hypot(a.x - pos.x, a.z - pos.z)
          if (d < newlyHaltedDist) {
            newlyHaltedDist = d
            newlyHaltedTarget = a
          }
        }
      } else {
        const bridged =
          kind === 'whistle'
            ? host.trafficBridge?.signalWhistle?.(pos, signalRangeM)
            : host.trafficBridge?.signalFlag?.(kind === 'flag_stop' ? 'stop' : 'go', pos, signalRangeM)

        if (Array.isArray(bridged)) {
          affectedCount = bridged.length
          stoppedCount = bridged.filter(a => a.speed <= 0.25).length
          fleeingCount = Math.max(0, affectedCount - stoppedCount)
          for (const a of bridged) {
            if (a.speed > 0.25 || !isCitableViolator(a) || isActorAlreadyCited(a)) continue
            const d = Math.hypot(a.x - pos.x, a.z - pos.z)
            if (d < newlyHaltedDist) {
              newlyHaltedDist = d
              newlyHaltedTarget = a
            }
          }
        } else if (typeof bridged === 'number') {
          affectedCount = Math.max(0, bridged)
          stoppedCount = affectedCount
        } else {
          // Pure local fallback when independent trafficBridge is not wired yet:
          // halt at most one nearest uncited violator so the player must ticket before halting another.
          const range = kind === 'whistle' ? signalRangeM : Math.min(14, signalRangeM)
          const actors = currentActors()
          if (kind === 'flag_go') {
            for (const actor of actors) {
              if (actor.kind !== 'scooter' || actor.leaving || actor.scale < 0.5) continue
              if (Math.abs(actor.y - pos.y) > 2.5) continue
              if (Math.hypot(actor.x - pos.x, actor.z - pos.z) <= range && !isCitableViolator(actor)) {
                affectedCount++
              }
            }
          } else {
            let nearest: Actor | null = null
            let nearestDist = Infinity
            for (const actor of actors) {
              if (!isCitableViolator(actor) || isActorAlreadyCited(actor)) continue
              if (Math.abs(actor.y - pos.y) > 2.5) continue
              const d = Math.hypot(actor.x - pos.x, actor.z - pos.z)
              if (d <= range && d < nearestDist) {
                nearestDist = d
                nearest = actor
              }
            }
            if (nearest) {
              affectedCount = 1
              stopTargetActor(nearest, Math.max(stopDurationSec, 12))
              stoppedCount = 1
              newlyHaltedTarget = nearest
            }
          }
        }
      }
      if (newlyHaltedTarget) {
        pendingViolator = newlyHaltedTarget
        notifyActorPulledOver(newlyHaltedTarget, Math.max(stopDurationSec, 14))
        const haltedViols = resolveActorViolations(newlyHaltedTarget as Actor & {violations?: readonly TrafficViolation[]})
        if (haltedViols.length > 1) {
          host.onToast?.(`已拦停 · 数罪并罚：${formatViolationBreakdownFormula(haltedViols, fineTable)}`, 2600)
        }
      }
      if (stoppedCount > 0) playBrakeScreechSound()
    }

    const result: DutySignalResult = {
      ok: true,
      kind,
      affectedCount,
      stoppedCount,
      fleeingCount,
    }
    host.onSignalAction?.(result)
    syncUi()
    return result
  }

  function pressDutyWhistle(): WhistleKeyActionResult {
    const seqBefore = lastDutyKeysGestureSeq
    const res = dutyKeys.pressWhistle()
    if (res.ok) {
      if (lastDutyKeysGestureSeq === seqBefore) {
        dispatchDutyKeysGesture('whistle')
      }
      if (res.haltedFleeingActors.length > 0 && !pendingViolator) {
        pendingViolator = res.haltedFleeingActors[0]
      }
      syncUi()
    }
    return res
  }

  function pressDutyFlagShort(): FlagKeyActionResult {
    const seqBefore = lastDutyKeysGestureSeq
    const res = dutyKeys.pressFlagShort()
    if (res.ok) {
      if (lastDutyKeysGestureSeq === seqBefore) {
        dispatchDutyKeysGesture('flag_stop')
      }
      if (res.targetActor) {
        pendingViolator = res.targetActor
        const targetViols = resolveActorViolations(res.targetActor as Actor & {violations?: readonly TrafficViolation[]})
        if (targetViols.length > 1) {
          host.onToast?.(`已拦停 · 数罪并罚：${formatViolationBreakdownFormula(targetViols, fineTable)}`, 2600)
        }
      }
      syncUi()
    }
    return res
  }

  function pressDutyFlagLongRelease(): FlagKeyActionResult {
    const seqBefore = lastDutyKeysGestureSeq
    const res = dutyKeys.pressFlagLongRelease()
    if (res.ok) {
      if (lastDutyKeysGestureSeq === seqBefore) {
        dispatchDutyKeysGesture('flag_go')
      }
      if (res.targetActor && pendingViolator === res.targetActor) {
        pendingViolator = null
      }
      syncUi()
    }
    return res
  }

  function resolveTerminalOpener(): ((req: FineTerminalRequest) => Promise<FineTerminalResult> | FineTerminalResult) | null {
    if (host.fineTerminal?.openFineTerminal) {
      return req => host.fineTerminal!.openFineTerminal(req)
    }
    if (host.openFineTerminal) {
      return req => host.openFineTerminal!(req)
    }
    if (ui?.openFallbackFineTerminal) {
      return req => ui!.openFallbackFineTerminal!(req)
    }
    return null
  }

  function diagnoseNoViolator(pos: Position | null): WhistleCiteResult {
    if (pos) {
      const actors = currentActors()
      let nearestAnyDist = Infinity
      let nearestCited = false
      for (const a of actors) {
        if (a.kind !== 'scooter' || a.leaving || a.scale < 0.5) continue
        if (Math.abs(a.y - pos.y) > 2.5) continue
        const d = Math.hypot(a.x - pos.x, a.z - pos.z)
        if (d <= whistleRangeM && isActorAlreadyCited(a)) {
          nearestCited = true
          break
        }
        const aViols = resolveActorViolations(a as Actor & {violations?: readonly TrafficViolation[]})
        if (aViols.length > 0 && !isActorAlreadyCited(a)) {
          nearestAnyDist = Math.min(nearestAnyDist, d)
        }
      }
      if (nearestCited) return {ok: false, reason: 'already_cited'}
      if (Number.isFinite(nearestAnyDist) && nearestAnyDist > whistleRangeM) {
        return {ok: false, reason: 'out_of_range', distance: nearestAnyDist}
      }
    }
    return {ok: false, reason: 'no_target'}
  }

  function commitIssuedCitation(
    actor: Actor,
    violation: ActiveViolation,
    fineYuan: number,
    distance: number,
    ticketId?: string,
    plateNo?: string,
    citationRecord?: import('./handover/types.ts').CitationRecord,
    violations?: readonly ActiveViolation[],
    handedSide?: 'left' | 'right',
  ): WhistleCiteResult {
    // IDOK-153 & r8-2: only cite NPC violators; player wallet is NOT credited here — 10% commission stays pending until officer off-duty check-in.
    const resolvedViolations: ActiveViolation[] =
      violations && violations.length > 0 ? [...violations] : [violation]
    citedActors.add(actor)
    actor.cited = true
    if (pendingViolator === actor) pendingViolator = null
    stopTargetActor(actor, stopDurationSec)
    host.trafficBridge?.notifyViolatorCited?.(actor)
    let resolvedHandSide: 'left' | 'right' = citationRecord?.handedSide ?? handedSide ?? 'right'
    let heldTicketObject: import('three').Object3D | undefined
    if (citationRecord) {
      const preferredSide: 'left' | 'right' = resolvedHandSide
      const handBone = host.trafficBridge?.getActorHandBone?.(actor, preferredSide) ?? null
      const existingHeld = getViolatorHeldReceipt(actor)
      if (existingHeld && existingHeld.mountedNode) {
        heldTicketObject = existingHeld.model.group
        resolvedHandSide = existingHeld.side
      } else if (handBone) {
        const attached = attachReceiptToViolator(actor, citationRecord, {
          preferredSide,
          ...(preferredSide === 'left' ? {leftHandBone: handBone} : {rightHandBone: handBone}),
          handBone,
        })
        heldTicketObject = attached.model.group
        resolvedHandSide = attached.side
      }
    }
    host.trafficBridge?.onTicketReceived?.(actor, {
      ticketId,
      fineYuan,
      plateNo,
      violation,
      handedSide: resolvedHandSide,
      ...(heldTicketObject ? {ticketObject: heldTicketObject} : {}),
    })
    whistleCount++
    citedCount++
    totalFineYuan += fineYuan
    pendingEarningsYuan = computeCommissionYuan(totalFineYuan)
    for (const v of resolvedViolations) {
      breakdown[v] = (breakdown[v] ?? 0) + 1
    }
    if (resolvedViolations.length > 1) {
      stackedCitationCount++
      stackedFineYuan += fineYuan
    }

    playWhistleSound()

    const lines = VIOLATION_BUBBLE_LINES[violation]
    const line = lines[(citedCount - 1) % lines.length]
    const labelText = formatViolationStackLabel(resolvedViolations)
    const title =
      resolvedViolations.length > 1
        ? `数罪并罚 · ${formatViolationBreakdownFormula(resolvedViolations, fineTable)}`
        : `电子罚单 ¥${fineYuan} · ${labelText}`
    for (let i = bubbles.length - 1; i >= 0; i--) {
      if (bubbles[i].actor === actor) bubbles.splice(i, 1)
    }
    bubbles.push({
      id: `tdb_${++bubbleSeq}`,
      actor,
      title,
      line,
      fineYuan,
      remainingSec: BUBBLE_DURATION_SEC,
    })

    const result: WhistleCiteResult = {
      ok: true,
      action: 'whistle_cite',
      actor,
      violation,
      violations: resolvedViolations,
      fineYuan,
      totalFineYuan,
      citedCount,
      distance,
      handedSide: resolvedHandSide,
      ...(ticketId ? {ticketId} : {}),
    }
    host.onWhistle?.(result)
    syncCameraLock()
    syncUi()
    return result
  }

  async function interceptViolator(): Promise<WhistleCiteResult> {
    if (phase !== 'active') return {ok: false, reason: 'inactive'}
    if (isKnockdownActive()) return {ok: false, reason: 'knockdown_active'}
    if (isStoryOrOffDutyActive()) return {ok: false, reason: 'story_open'}
    if (isTerminalFlowActive()) return {ok: false, reason: 'terminal_open'}

    const pos = host.getPlayerPos()
    const activePending = resolveActivePendingViolator(pos)
    const candidate = getInteractCandidate()
    if (!candidate || candidate.action !== 'whistle_cite' || !candidate.actor || candidate.violation === 'officer_briefing') {
      if (activePending) {
        host.onToast?.('请先为已拦停的违规车开完罚单，再拦下一辆', 2200)
        return {ok: false, reason: 'pending_citation', actor: activePending}
      }
      return diagnoseNoViolator(pos)
    }

    const opener = resolveTerminalOpener()
    if (!opener) {
      return {ok: false, reason: 'no_terminal'}
    }

    const actor = candidate.actor
    if (isActorAlreadyCited(actor)) {
      host.onToast?.(DUPLICATE_CITATION_MESSAGE, 2200)
      return {ok: false, reason: 'already_cited', actor}
    }
    const violation = candidate.violation
    const violations =
      candidate.violations && candidate.violations.length > 0
        ? candidate.violations
        : resolveActorViolations(actor as Actor & {violations?: readonly TrafficViolation[]})
    const resolvedViolations = violations.length > 0 ? violations : [violation]
    const fineYuan = candidate.fineYuan
    const distance = candidate.distance

    // Lock this halted violator until their ticket is issued (cannot halt/intercept next vehicle mid-citation)
    pendingViolator = actor
    ui?.closePanel()
    const haltHoldSec = Math.max(stopDurationSec, 18)
    actor.dutyState = actor.dutyState === 'pulled_over' ? 'pulled_over' : 'halted'
    actor.haltedByDuty = true
    actor.speed = 0
    stopTargetActor(actor, haltHoldSec)
    notifyActorPulledOver(actor, haltHoldSec)
    playWhistleSound()
    host.propsBridge?.playGesture?.('whistle')

    const req: FineTerminalRequest = {
      actor,
      violation,
      violations: resolvedViolations,
      violationLabel: formatViolationStackLabel(resolvedViolations),
      fineYuan,
      vehicleSubtype: actor.vehicleSubtype ?? (violation === 'bike_double' ? 'bicycle' : 'ebike'),
      zoneName: shiftZone?.name ?? JIEFANG_DUTY_ZONE.name,
      getPlayerPos: () => host.getPlayerPos(),
      violatorObject3D: host.trafficBridge?.getActorHandBone?.(actor) ?? null,
      dutyProps: host.propsBridge?.getHandle?.() ?? null,
      closeupCamera: host.camera ?? null,
      onToast: msg => host.onToast?.(msg, 2400),
      onPhaseChange: () => {
        syncCameraLock()
        syncUi()
      },
    }

    terminalOpen = true
    syncCameraLock()
    syncUi()
    try {
      const outcome = await opener(req)
      if (disposed || phase !== 'active' || citedActors.has(actor)) {
        return {ok: false, reason: 'terminal_cancelled'}
      }
      if (!outcome || !outcome.issued) {
        if (outcome?.reason === 'already_cited') {
          host.onToast?.(outcome.message ?? DUPLICATE_CITATION_MESSAGE, 2200)
          return {ok: false, reason: 'already_cited', actor, violation, distance}
        }
        host.onToast?.('已取消开单，本起未计入执勤成绩', 2000)
        return {ok: false, reason: 'terminal_cancelled', actor, violation, distance}
      }
      const finalViolations =
        outcome.violations && outcome.violations.length > 0 ? outcome.violations : resolvedViolations
      const finalFine =
        typeof outcome.fineYuan === 'number' && Number.isFinite(outcome.fineYuan) && outcome.fineYuan > 0
          ? Math.round(outcome.fineYuan)
          : fineYuan
      return commitIssuedCitation(
        actor,
        violation,
        finalFine,
        distance,
        outcome.ticketId ?? outcome.receiptNo,
        outcome.plateNo ?? outcome.citationRecord?.plateNo,
        outcome.citationRecord,
        finalViolations,
        outcome.handedSide ?? outcome.citationRecord?.handedSide,
      )
    } catch {
      return {ok: false, reason: 'terminal_cancelled', actor, violation, distance}
    } finally {
      terminalOpen = false
      syncCameraLock()
      syncUi()
    }
  }

  function deliverActiveHandover(): WhistleCiteResult {
    if (isKnockdownActive()) return {ok: false, action: 'handover_ticket', reason: 'knockdown_active'}
    if (story.isActive()) return {ok: false, action: 'handover_ticket', reason: 'story_open'}
    if (host.fineTerminal?.isDelivering?.()) {
      const ok = Boolean(host.fineTerminal.confirmDeliver?.())
      syncCameraLock()
      syncUi()
      return ok
        ? {ok: true, action: 'handover_ticket'}
        : {ok: false, action: 'handover_ticket', reason: 'too_far_to_deliver'}
    }
    const wf = dutyKeys.getActiveWorkflow()
    if (wf && wf.getStage() === 'tear_off') {
      const res = dutyKeys.pressTicket()
      syncCameraLock()
      syncUi()
      return res.ok
        ? {ok: true, action: 'handover_ticket', distanceM: res.distanceM}
        : {ok: false, action: 'handover_ticket', reason: res.reason === 'too_far_to_deliver' ? 'too_far_to_deliver' : 'terminal_open', distanceM: res.distanceM}
    }
    return {ok: false, action: 'handover_ticket', reason: 'no_target'}
  }

  async function interact(): Promise<WhistleCiteResult> {
    if (isKnockdownActive()) return {ok: false, reason: 'knockdown_active'}
    if (isStoryOrOffDutyActive()) return {ok: false, reason: 'story_open'}
    // Priority 1: handover torn-off ticket within 1.5m
    if (isHandoverReady()) {
      return deliverActiveHandover()
    }
    if (isTerminalFlowActive()) return {ok: false, reason: 'terminal_open'}
    const candidate = getInteractCandidate()
    // Priority 2: open fine terminal for violator
    if (candidate?.action === 'whistle_cite') {
      return interceptViolator()
    }
    // Priority 3: talk to Jiefang officer (off-duty check-in when active/unsettled, else briefing)
    if (candidate?.action === 'talk_officer') {
      const opened =
        candidate.isOffDutyReport || phase === 'active'
          ? startOffDutyReport()
          : startOfficerBriefing()
      return opened ? {ok: true, action: 'talk_officer', distance: candidate.distance} : {ok: false, reason: 'story_open'}
    }
    return interceptViolator()
  }

  function triggerWhistle(): WhistleCiteResult {
    if (isKnockdownActive()) return {ok: false, reason: 'knockdown_active'}
    if (isStoryOrOffDutyActive()) return {ok: false, reason: 'story_open'}
    if (isHandoverReady()) return deliverActiveHandover()
    if (isTerminalFlowActive()) return {ok: false, reason: 'terminal_open'}
    const candidate = getInteractCandidate()
    if (candidate?.action === 'talk_officer') {
      const opened =
        candidate.isOffDutyReport || phase === 'active'
          ? startOffDutyReport()
          : startOfficerBriefing()
      return opened ? {ok: true, action: 'talk_officer', distance: candidate.distance} : {ok: false, reason: 'story_open'}
    }
    if (phase !== 'active') {
      return {ok: false, reason: 'inactive'}
    }
    if (!candidate || candidate.action !== 'whistle_cite' || !candidate.actor || candidate.violation === 'officer_briefing') {
      return diagnoseNoViolator(host.getPlayerPos())
    }
    if (!resolveTerminalOpener()) {
      return {ok: false, reason: 'no_terminal'}
    }
    void interceptViolator()
    return {
      ok: true,
      pending: true,
      action: 'whistle_cite',
      actor: candidate.actor,
      violation: candidate.violation,
      violations: candidate.violations,
      fineYuan: candidate.fineYuan,
      distance: candidate.distance,
    }
  }

  function step(dt: number): TrafficDutySnapshot {
    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(0.25, dt) : 0
    const sim = activeTraffic()
    if (phase === 'active' && sim && sim !== lastTrafficApplied) {
      applyTrafficDutyConfig(true)
    }

    if (boundsToastCooldown > 0) {
      boundsToastCooldown = Math.max(0, boundsToastCooldown - safeDt)
    }
    if (hornToastCooldown > 0) {
      hornToastCooldown = Math.max(0, hornToastCooldown - safeDt)
    }

    if (story.isActive()) {
      story.step?.(safeDt)
    }
    if (phase === 'active') {
      dutyKeys.step(safeDt)
      const pos = host.getPlayerPos()
      if ((!shiftZone || shiftZone.id === 'jiefang') && pos && !isInBridgeDutyBounds(pos)) {
        const {clamped} = clampToBridgeDutyBounds(pos)
        emitBoundsWarning(clamped)
      } else if (outOfBoundsHoldSec > 0) {
        outOfBoundsHoldSec = Math.max(0, outOfBoundsHoldSec - safeDt)
        if (outOfBoundsHoldSec <= 0) outOfBoundsWarning = null
      }
    }

    for (let i = bubbles.length - 1; i >= 0; i--) {
      bubbles[i].remainingSec -= safeDt
      if (bubbles[i].remainingSec <= 0 || bubbles[i].actor.leaving) {
        bubbles.splice(i, 1)
      }
    }

    if (
      phase === 'active' &&
      !host.isPaused?.() &&
      !host.isUiBlocked?.() &&
      !ui?.isPanelOpen() &&
      !isStoryOrOffDutyActive() &&
      !isTerminalFlowActive()
    ) {
      elapsedSec += safeDt
      remainingSec = Math.max(0, remainingSec - safeDt)
      if (remainingSec <= 0) {
        return finishDuty()
      }
    }

    syncCameraLock()
    syncUi()
    return getSnapshot()
  }

  if (options?.mountUi && shouldMountDom) {
    const onGoZone =
      host.onTeleportToZone
        ? (zoneId: DutyZoneId) => void host.onTeleportToZone?.(zoneId)
        : host.onTeleportToBridge
          ? (zoneId: DutyZoneId) => {
              if (zoneId === 'jiefang') void host.onTeleportToBridge?.()
            }
          : undefined
    ui = options.mountUi({
      container: host.mountContainer ?? (typeof document !== 'undefined' ? document.body : (undefined as unknown as HTMLElement)),
      arbiterWired: Boolean(host.arbiterWired),
      alwaysShowEntry: Boolean(host.alwaysShowEntry),
      onTalkOfficer: () => {
        const dist = distanceToJiefangOfficer(host.getPlayerPos(), officerWorldPos())
        if (dist !== null && dist <= officerTalkRangeM + 0.5) {
          if (phase === 'active' || (phase === 'summary' && !shiftSettled && pendingEarningsYuan > 0)) {
            startOffDutyReport()
          } else {
            startOfficerBriefing()
          }
        } else if (onGoZone) {
          void Promise.resolve(
            host.onTeleportToZone ? host.onTeleportToZone('jiefang') : host.onTeleportToBridge?.(),
          )
            .then(ok => {
              if (ok !== false) host.onToast?.('正在前往解放桥交警岗，靠近后按 F 对话', 2400)
            })
            .catch(() => {})
        } else {
          host.onToast?.('请前往解放桥西桥头找交警对话', 2400)
        }
      },
      onReportOffDuty: () => {
        const dist = distanceToJiefangOfficer(host.getPlayerPos(), officerWorldPos())
        if (dist !== null && dist <= officerTalkRangeM + 0.5) {
          startOffDutyReport()
        } else if (onGoZone) {
          onGoZone('jiefang')
          host.onToast?.('请到解放桥交警身旁按 F 交差下岗领取分成', 2600)
        } else {
          host.onToast?.('请先返回解放桥交警身旁按 F 交差下岗领取分成', 2600)
        }
      },
      onAbandon: () => abandonDuty(),
      onFinish: () => finishDuty(),
      onInteract: () => void interact(),
      onSignal: kind => {
        if (kind === 'whistle') {
          pressDutyWhistle()
        } else if (kind === 'flag_stop') {
          pressDutyFlagShort()
        } else {
          pressDutyFlagLongRelease()
        }
      },
      onGoBridge: host.onTeleportToBridge ? () => void host.onTeleportToBridge?.() : undefined,
      onGoZone,
      getFineTable: () => fineTable,
    })
    syncUi()
  }

  return {
    startDuty,
    abandonDuty,
    finishDuty,
    resetToIdle,
    step,
    interact,
    interceptViolator,
    triggerWhistle,
    triggerSignal,
    pressDutyWhistle,
    pressDutyFlagShort,
    pressDutyFlagLongRelease,
    getDutyKeys: () => dutyKeys,
    getShiftSettlement,
    startOffDutyReport,
    completeOffDutySettlement,
    startOfficerBriefing,
    advanceStory: () => {
      const ok = story.advance()
      if (ok) {
        syncCameraLock()
        syncUi()
      }
      return ok
    },
    chooseStoryOption: (choiceId: string) => {
      const ok = story.choose(choiceId)
      if (ok) {
        syncCameraLock()
        syncUi()
      }
      return ok
    },
    skipStory: () => {
      const ok = story.skip()
      if (ok) {
        syncCameraLock()
        syncUi()
      }
      return ok
    },
    cancelStory: () => {
      const ok = story.cancel()
      if (ok) {
        syncCameraLock()
        syncUi()
      }
      return ok
    },
    isStoryOpen: () => isStoryOrOffDutyActive(),
    getStorySnapshot: () => story.getSnapshot(),
    isTerminalOpen: () => isTerminalFlowActive(),
    isHandoverReady,
    isKnockdownActive,
    isCameraLocked,
    canStartKnockdown,
    canOpenStory,
    canOpenFineTerminal,
    clampPlayerPos,
    getInteractCandidate,
    getSnapshot,
    getLeaderboard: () => (cachedLeaderboard = leaderboard.load()),
    openPanel(tab = 'duty') {
      cachedLeaderboard = leaderboard.load()
      ui?.openPanel(tab)
      syncUi()
    },
    closePanel() {
      ui?.closePanel()
      syncUi()
    },
    isPanelOpen: () => Boolean(ui?.isPanelOpen()),
    dispose() {
      disposed = true
      dutyKeyboardHandle?.dispose()
      dutyKeyboardHandle = null
      dutyKeys.getActiveWorkflow()?.cancel()
      detachHitListener()
      story.dispose()
      host.fineTerminal?.close?.()
      syncDutyBodyAndPanels(false)
      if (phase === 'active') {
        pendingViolator = null
        stopTrafficBridge()
        setGear({hasWhistle: false, hasFlag: false})
        host.onOfficerStateChange?.('available')
        host.onDutyStateChange?.(false)
        phase = 'idle'
      }
      syncCameraLock()
      clearBubbles()
      ui?.dispose()
      ui = undefined
    },
  }
}
