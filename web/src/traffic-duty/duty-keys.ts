/**
 * 辅警执勤三键规划与底部居中亮灭状态条 / 手机三按钮模块（`web/src/traffic-duty/duty-keys.ts`）。
 *
 * - `Q` 吹哨（`dutyWhistle`）：口哨一直在嘴边，按一下吹一声；半径 12m 内违规车减速，逃跑车概率停下，正常车不受影响；开单期间照常可用。
 * - `E` 挥旗（`dutyFlag`）：短按示意前方 8m 内违规车靠边停；长按 0.6s 放行刚拦下的车；开单期间严格变灰禁用。
 * - `F` 开单与递交（`dutyTicket`）：靠近停稳违规车按 F 从腰侧拿出打印机敲字吐纸撕下；走到 1.5m 内再按 F 递交对方伸手接过。
 *
 * ─── 热点文件接线（`ui/walk.ts` / `ui/guide.ts` / `main.ts`）───
 * - `web/src/ui/walk.ts`：骑行换挡监听前加 `if (!shouldSuppressRideGearKey(event.code, document.body.dataset.duty === 'active'))`（与本模块 `bindDutyKeyboard` capture 拦截双保险）。
 * - `web/src/ui/guide.ts`：`KEY_GROUPS()` 加入 `getDutyGuideKeyGroup()`，`FEATURES()` 加入 `getDutyGuideFeature()`，或直接调用 `syncDutyKeysIntoPanels(document, dutyActive)`。
 */

import type * as THREE from 'three'
import type {DutyPropsHandle} from '../gear/duty-props.ts'
import {
  bindingLabel,
  getDutyCardRows,
  getDutyGuideFeature,
  getDutyGuideKeyGroup,
  hits,
  type GuideKeyRow,
} from '../input/keymap.ts'
import {stopActor as stopSimActor, type Actor, type Position} from '../traffic/sim.ts'
import {isFineTerminalBusy} from './fine-terminal/index.ts'
import {
  DUPLICATE_CITATION_MESSAGE,
  HANDOVER_MAX_DISTANCE_M,
  sharedCitationLedger,
  startHandoverWorkflow,
  type CitationLedger,
  type HandoverWorkflowHandle,
} from './handover/index.ts'
import {playBrakeScreechSound, playFlagWaveSound, playWhistleSound} from './whistle.ts'

/** Q 吹哨半径：12m 内违规车减速、逃逸车有概率停下，正常车不受影响。 */
export const DUTY_WHISTLE_RADIUS_M = 12
/** E 挥旗短按距离：前方 8m 以内的一辆违规车示意靠边停。 */
export const DUTY_FLAG_STOP_RANGE_M = 8
/** E 挥旗长按时长：按住 0.6 秒放行刚拦下的车。 */
export const DUTY_FLAG_RELEASE_HOLD_SEC = 0.6
/** F 靠近已停下的违规车开始开票的最大距离（米）。 */
export const DUTY_TICKET_START_RANGE_M = 4.0
/** F 撕下罚单后递交的最大距离（米）：必须在 1.5m 以内才能递出。 */
export const DUTY_TICKET_DELIVER_RANGE_M = HANDOVER_MAX_DISTANCE_M

const MAX_VERTICAL_DIFF_M = 3.0
const DUTY_WHISTLE_SLOWDOWN_RATIO = 0.45
const DEFAULT_FLEE_HALT_PROB = 0.65

export interface WhistleKeyActionResult {
  readonly ok: boolean
  readonly kind: 'whistle'
  readonly reason?: 'inactive'
  readonly slowedActors: readonly Actor[]
  readonly haltedFleeingActors: readonly Actor[]
  readonly unaffectedNormalCount: number
}

export interface FlagKeyActionResult {
  readonly ok: boolean
  readonly kind: 'flag_stop' | 'flag_release'
  readonly reason?: 'inactive' | 'disabled_while_ticketing' | 'no_target_ahead' | 'nothing_to_release'
  readonly message?: string
  readonly targetActor?: Actor
  readonly distanceM?: number
}

export interface TicketKeyActionResult {
  readonly ok: boolean
  readonly action: 'start_ticket' | 'deliver_ticket' | 'rejected'
  readonly reason?:
    | 'inactive'
    | 'already_cited'
    | 'too_far_to_deliver'
    | 'target_not_stopped'
    | 'no_stopped_violator'
    | 'busy_printing'
  readonly message?: string
  readonly distanceM?: number
  readonly workflow?: HandoverWorkflowHandle
}

export interface DutyKeySlotState {
  readonly enabled: boolean
  readonly lit: boolean
  readonly label: string
  readonly keyCap: string
}

export interface DutyKeyAvailabilitySnapshot {
  readonly active: boolean
  readonly whistle: DutyKeySlotState
  readonly flag: DutyKeySlotState
  readonly ticket: DutyKeySlotState
}

export interface DutyKeysHost {
  readonly isDutyActive: () => boolean
  readonly getPlayerPos: () => Position | null
  readonly getPlayerForward?: () => {x: number; z: number}
  readonly getPlayerYaw?: () => number
  readonly getActors: () => readonly Actor[]
  readonly stopActor?: (actor: Actor, durationSec: number) => boolean
  readonly isExternalTicketing?: () => boolean
  readonly resolveViolatorHandBone?: (actor: Actor) => THREE.Object3D | null | undefined
  readonly getActorHandBone?: (actor: Actor) => THREE.Object3D | null | undefined
  readonly onViolatorReleased?: (actor: Actor) => void
  readonly playGesture?: (kind: 'whistle' | 'flag_stop' | 'flag_go') => void
  readonly ledger?: CitationLedger
  readonly dutyProps?: DutyPropsHandle | null
  readonly random?: () => number
  readonly fleeHaltProbability?: number
  readonly sound?: boolean
  readonly onToast?: (message: string) => void
  readonly onTicketStarted?: (workflow: HandoverWorkflowHandle, actor: Actor) => void
  readonly onTicketDelivered?: (actor: Actor) => void
}

export interface DutyKeysController {
  pressWhistle(): WhistleKeyActionResult
  pressFlagShort(): FlagKeyActionResult
  pressFlagLongRelease(): FlagKeyActionResult
  pressTicket(): TicketKeyActionResult
  handleKeyDown(code: string, repeat?: boolean): boolean
  handleKeyUp(code: string): boolean
  step(dt: number): void
  isTicketing(): boolean
  isFlagEnabled(): boolean
  isWhistleEnabled(): boolean
  getAvailability(): DutyKeyAvailabilitySnapshot
  getActiveWorkflow(): HandoverWorkflowHandle | null
  getLastHaltedActor(): Actor | null
  setExternalWorkflow(workflow: HandoverWorkflowHandle | null): void
}

function isViolatorActor(actor: Actor): boolean {
  if (actor.leaving || actor.scale < 0.5) return false
  if (!actor.violation || actor.violation === 'none') return false
  if (actor.violation === 'red_light_run' && actor.redLightActive === false) return false
  return true
}

function isActorStopped(actor: Actor): boolean {
  return (
    actor.speed <= 0.35 ||
    Boolean(actor.haltedByDuty) ||
    actor.dutyState === 'halted' ||
    actor.dutyState === 'pulled_over'
  )
}

/**
 * 判定当前按键是否应屏蔽骑车/开车换挡（`KeyQ` / `KeyE`）：
 * 执勤激活期间，`Q` 和 `E` 专用于执勤吹哨与挥旗，严禁触发骑行加减挡。
 */
export function shouldSuppressRideGearKey(code: string, dutyActive: boolean): boolean {
  if (!dutyActive) return false
  return (
    code === 'KeyQ' ||
    code === 'KeyE' ||
    hits(code, 'dutyWhistle') ||
    hits(code, 'dutyFlag')
  )
}

/**
 * 创建辅警执勤三键（Q 吹哨 / E 短按拦停·长按 0.6s 放行 / F 开单·1.5m 递交）控制器。
 */
export function createDutyKeysController(host: DutyKeysHost): DutyKeysController {
  const ledger = host.ledger ?? sharedCitationLedger
  const rng = host.random ?? Math.random
  const fleeProb = Math.max(0, Math.min(1, host.fleeHaltProbability ?? DEFAULT_FLEE_HALT_PROB))
  const soundOn = host.sound === true

  let activeWorkflow: HandoverWorkflowHandle | null = null
  let workflowTargetActor: Actor | null = null
  let lastHaltedActor: Actor | null = null

  let flagKeyHeld = false
  let flagHoldElapsed = 0
  let flagLongFired = false

  function resolveForward(): {x: number; z: number} {
    if (host.getPlayerForward) {
      const f = host.getPlayerForward()
      const len = Math.hypot(f.x, f.z)
      if (len > 1e-5) return {x: f.x / len, z: f.z / len}
    }
    if (host.getPlayerYaw) {
      const yaw = host.getPlayerYaw()
      return {x: -Math.sin(yaw), z: -Math.cos(yaw)}
    }
    return {x: 0, z: 1}
  }

  function haltActor(actor: Actor, durationSec = 14): void {
    actor.speed = 0
    actor.dutyState = 'halted'
    actor.haltedByDuty = true
    actor.fleeUntil = undefined
    actor.brakingForOfficer = false
    if (actor.track?.kind === 'nonmotor') {
      actor.dodge = 0.45
    }
    if (host.stopActor) host.stopActor(actor, durationSec)
    else stopSimActor(actor, durationSec)
  }

  function isTicketingNow(): boolean {
    if (activeWorkflow && activeWorkflow.isActive()) return true
    if (host.isExternalTicketing?.()) return true
    if (isFineTerminalBusy()) return true
    return false
  }

  function findAheadFlagCandidate(pos: Position): {actor: Actor; dist: number} | null {
    const fwd = resolveForward()
    let best: Actor | null = null
    let bestDist = Infinity
    for (const actor of host.getActors()) {
      if (!isViolatorActor(actor) || ledger.hasCited(actor)) continue
      if (Math.abs(actor.y - pos.y) > MAX_VERTICAL_DIFF_M) continue
      const dx = actor.x - pos.x
      const dz = actor.z - pos.z
      const dist = Math.hypot(dx, dz)
      if (dist > DUTY_FLAG_STOP_RANGE_M) continue
      if (actor.dutyState === 'leaving_with_ticket') continue
      if (dist > 0.05) {
        const dot = (dx * fwd.x + dz * fwd.z) / dist
        if (dot < 0.15) continue
      }
      if (dist < bestDist) {
        bestDist = dist
        best = actor
      }
    }
    return best ? {actor: best, dist: bestDist} : null
  }

  function getAvailability(): DutyKeyAvailabilitySnapshot {
    const qCap = bindingLabel('dutyWhistle').split(' / ')[0]
    const eCap = bindingLabel('dutyFlag').split(' / ')[0]
    const fCap = bindingLabel('dutyTicket').split(' / ')[0]
    const active = host.isDutyActive()
    if (!active) {
      return {
        active: false,
        whistle: {enabled: false, lit: false, label: '吹哨', keyCap: qCap},
        flag: {enabled: false, lit: false, label: '挥旗', keyCap: eCap},
        ticket: {enabled: false, lit: false, label: '开单', keyCap: fCap},
      }
    }

    const pos = host.getPlayerPos()
    const ticketing = isTicketingNow()
    let hasViolatorIn12m = false
    let hasStoppedUncitedNear = false

    if (pos) {
      for (const a of host.getActors()) {
        if (!isViolatorActor(a) || ledger.hasCited(a)) continue
        if (Math.abs(a.y - pos.y) > MAX_VERTICAL_DIFF_M) continue
        const d = Math.hypot(a.x - pos.x, a.z - pos.z)
        if (d <= DUTY_WHISTLE_RADIUS_M) hasViolatorIn12m = true
        if (d <= DUTY_TICKET_START_RANGE_M && isActorStopped(a)) hasStoppedUncitedNear = true
      }
    }

    // Q 吹哨：执勤全程可用（开单时也可用），12m 内有违规车或正在开单时亮起
    const whistleState: DutyKeySlotState = {
      enabled: true,
      lit: hasViolatorIn12m || ticketing,
      label: '吹哨',
      keyCap: qCap,
    }

    // E 挥旗：开单期间严格变灰禁用；非开单时前方 8m 有目标或有待放行车辆时亮起
    const aheadCand = !ticketing && pos ? findAheadFlagCandidate(pos) : null
    const canWaveFlag = !ticketing && (aheadCand !== null || lastHaltedActor !== null)
    const flagState: DutyKeySlotState = {
      enabled: !ticketing,
      lit: canWaveFlag,
      label: lastHaltedActor ? '挥旗 · 长按放行' : '挥旗拦停',
      keyCap: eCap,
    }

    // F 开单 / 递交：按能否开单或是否在 1.5m 内可递交精确亮起或变灰
    let ticketEnabled = false
    let ticketLit = false
    let ticketLabel = '开单'
    if (activeWorkflow && activeWorkflow.isActive()) {
      const snap = activeWorkflow.getSnapshot()
      if (snap.stage === 'tear_off') {
        ticketEnabled = snap.canDeliverNow
        ticketLit = snap.canDeliverNow
        ticketLabel = snap.canDeliverNow ? '递交' : '走近递交'
      } else {
        ticketEnabled = false
        ticketLit = false
        ticketLabel = snap.stageLabel
      }
    } else if (!ticketing && hasStoppedUncitedNear) {
      ticketEnabled = true
      ticketLit = true
      ticketLabel = '开单'
    }

    return {
      active: true,
      whistle: whistleState,
      flag: flagState,
      ticket: {
        enabled: ticketEnabled,
        lit: ticketLit,
        label: ticketLabel,
        keyCap: fCap,
      },
    }
  }

  function pressWhistle(): WhistleKeyActionResult {
    if (!host.isDutyActive()) {
      return {
        ok: false,
        kind: 'whistle',
        reason: 'inactive',
        slowedActors: [],
        haltedFleeingActors: [],
        unaffectedNormalCount: 0,
      }
    }

    host.dutyProps?.setWhistleAlwaysAtMouth(true)
    host.dutyProps?.triggerWhistlePulse()
    host.playGesture?.('whistle')
    if (soundOn) playWhistleSound()

    const pos = host.getPlayerPos()
    const slowedActors: Actor[] = []
    const haltedFleeingActors: Actor[] = []
    let unaffectedNormalCount = 0

    if (pos) {
      for (const actor of host.getActors()) {
        if (actor.leaving || actor.scale < 0.5) continue
        if (Math.abs(actor.y - pos.y) > MAX_VERTICAL_DIFF_M) continue
        const dist = Math.hypot(actor.x - pos.x, actor.z - pos.z)
        if (dist > DUTY_WHISTLE_RADIUS_M) continue

        if (!isViolatorActor(actor)) {
          unaffectedNormalCount++
          continue
        }
        if (ledger.hasCited(actor) || actor.dutyState === 'leaving_with_ticket') {
          continue
        }

        const isFleeing = actor.dutyState === 'fleeing' || actor.dutyState === 'evading'
        if (isFleeing && rng() < fleeProb) {
          haltActor(actor, 14)
          lastHaltedActor = actor
          haltedFleeingActors.push(actor)
        } else if (actor.speed > 0.05) {
          actor.speed = Math.max(0.6, actor.speed * DUTY_WHISTLE_SLOWDOWN_RATIO)
          actor.brakingForOfficer = true
          slowedActors.push(actor)
        }
      }
      if (haltedFleeingActors.length > 0 && soundOn) {
        playBrakeScreechSound()
      }
    }

    return {
      ok: true,
      kind: 'whistle',
      slowedActors,
      haltedFleeingActors,
      unaffectedNormalCount,
    }
  }

  function pressFlagShort(): FlagKeyActionResult {
    if (!host.isDutyActive()) {
      return {ok: false, kind: 'flag_stop', reason: 'inactive'}
    }
    if (isTicketingNow()) {
      const msg = '开单期间无法挥旗，嘴边口哨可按 Q 吹响'
      host.onToast?.(msg)
      return {ok: false, kind: 'flag_stop', reason: 'disabled_while_ticketing', message: msg}
    }

    const pos = host.getPlayerPos()
    if (!pos) {
      return {ok: false, kind: 'flag_stop', reason: 'no_target_ahead'}
    }

    const ahead = findAheadFlagCandidate(pos)
    host.playGesture?.('flag_stop')
    host.dutyProps?.setFlagMode('stop')
    if (soundOn) playFlagWaveSound('stop')

    if (!ahead) {
      return {ok: false, kind: 'flag_stop', reason: 'no_target_ahead'}
    }

    haltActor(ahead.actor, 16)
    lastHaltedActor = ahead.actor
    if (soundOn) playBrakeScreechSound()

    return {
      ok: true,
      kind: 'flag_stop',
      targetActor: ahead.actor,
      distanceM: ahead.dist,
    }
  }

  function pressFlagLongRelease(): FlagKeyActionResult {
    if (!host.isDutyActive()) {
      return {ok: false, kind: 'flag_release', reason: 'inactive'}
    }
    if (isTicketingNow()) {
      const msg = '开单期间无法挥旗，嘴边口哨可按 Q 吹响'
      host.onToast?.(msg)
      return {ok: false, kind: 'flag_release', reason: 'disabled_while_ticketing', message: msg}
    }

    host.playGesture?.('flag_go')
    host.dutyProps?.setFlagMode('pass')
    if (soundOn) playFlagWaveSound('go')

    if (!lastHaltedActor) {
      return {ok: false, kind: 'flag_release', reason: 'nothing_to_release'}
    }

    const released = lastHaltedActor
    lastHaltedActor = null
    released.haltedByDuty = false
    released.stoppedUntil = undefined
    released.holdUntil = undefined
    released.brakingForOfficer = false
    released.dutyState = 'normal'
    released.dodge = 0
    released.speed = Math.max(released.speed, released.pace ?? 4.2)
    host.onViolatorReleased?.(released)

    return {
      ok: true,
      kind: 'flag_release',
      targetActor: released,
    }
  }

  function pressTicket(): TicketKeyActionResult {
    if (!host.isDutyActive()) {
      return {ok: false, action: 'rejected', reason: 'inactive'}
    }

    if (activeWorkflow && activeWorkflow.isActive()) {
      const st = activeWorkflow.getStage()
      if (st === 'tear_off') {
        const deliverAttempt = activeWorkflow.deliver(host.getPlayerPos())
        if (!deliverAttempt.ok) {
          return {
            ok: false,
            action: 'rejected',
            reason: 'too_far_to_deliver',
            message: deliverAttempt.message,
            distanceM: deliverAttempt.distanceM,
            workflow: activeWorkflow,
          }
        }
        return {
          ok: true,
          action: 'deliver_ticket',
          distanceM: deliverAttempt.distanceM,
          workflow: activeWorkflow,
        }
      }
      return {
        ok: false,
        action: 'rejected',
        reason: 'busy_printing',
        workflow: activeWorkflow,
      }
    }

    const pos = host.getPlayerPos()
    if (!pos) {
      return {ok: false, action: 'rejected', reason: 'no_stopped_violator'}
    }

    let nearestStoppedUncited: {actor: Actor; dist: number} | null = null
    let nearestCited: {actor: Actor; dist: number} | null = null
    let nearestMovingViolator = false

    for (const actor of host.getActors()) {
      if (!isViolatorActor(actor)) continue
      if (Math.abs(actor.y - pos.y) > MAX_VERTICAL_DIFF_M) continue
      const dist = Math.hypot(actor.x - pos.x, actor.z - pos.z)
      if (dist > DUTY_TICKET_START_RANGE_M) continue

      if (ledger.hasCited(actor) || actor.dutyState === 'leaving_with_ticket') {
        if (!nearestCited || dist < nearestCited.dist) {
          nearestCited = {actor, dist}
        }
        continue
      }

      if (isActorStopped(actor)) {
        if (!nearestStoppedUncited || dist < nearestStoppedUncited.dist) {
          nearestStoppedUncited = {actor, dist}
        }
      } else {
        nearestMovingViolator = true
      }
    }

    if (!nearestStoppedUncited) {
      if (nearestCited) {
        host.onToast?.(DUPLICATE_CITATION_MESSAGE)
        return {
          ok: false,
          action: 'rejected',
          reason: 'already_cited',
          message: DUPLICATE_CITATION_MESSAGE,
          distanceM: nearestCited.dist,
        }
      }
      if (nearestMovingViolator) {
        const msg = '请先按 Q 吹哨或按 E 挥旗让违规车停稳后再开罚单'
        host.onToast?.(msg)
        return {ok: false, action: 'rejected', reason: 'target_not_stopped', message: msg}
      }
      return {ok: false, action: 'rejected', reason: 'no_stopped_violator'}
    }

    const target = nearestStoppedUncited.actor
    workflowTargetActor = target
    const started = startHandoverWorkflow(
      {
        actor: target,
        getPlayerPos: host.getPlayerPos,
        resolveViolatorHandBone: host.resolveViolatorHandBone ?? host.getActorHandBone,
        sound: soundOn,
        onToast: host.onToast,
        onStageChange(nextStage) {
          if (nextStage === 'received' && workflowTargetActor) {
            host.onTicketDelivered?.(workflowTargetActor)
          }
        },
      },
      {ledger, dutyProps: host.dutyProps},
    )

    if (!started.started) {
      return {
        ok: false,
        action: 'rejected',
        reason: 'already_cited',
        message: DUPLICATE_CITATION_MESSAGE,
      }
    }

    activeWorkflow = started.workflow
    host.onTicketStarted?.(started.workflow, target)
    return {
      ok: true,
      action: 'start_ticket',
      distanceM: nearestStoppedUncited.dist,
      workflow: started.workflow,
    }
  }

  function handleKeyDown(code: string, repeat = false): boolean {
    if (!host.isDutyActive()) return false
    if (hits(code, 'dutyWhistle')) {
      if (!repeat) pressWhistle()
      return true
    }
    if (hits(code, 'dutyFlag')) {
      if (!repeat && !flagKeyHeld) {
        flagKeyHeld = true
        flagHoldElapsed = 0
        flagLongFired = false
      }
      return true
    }
    if (hits(code, 'dutyTicket')) {
      if (!repeat) pressTicket()
      return true
    }
    return false
  }

  function handleKeyUp(code: string): boolean {
    if (hits(code, 'dutyFlag') && flagKeyHeld) {
      const shouldShort = !flagLongFired && flagHoldElapsed < DUTY_FLAG_RELEASE_HOLD_SEC
      flagKeyHeld = false
      flagHoldElapsed = 0
      flagLongFired = false
      if (host.isDutyActive() && shouldShort) {
        pressFlagShort()
      }
      return host.isDutyActive()
    }
    return false
  }

  function step(dt: number): void {
    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 1) : 0
    if (flagKeyHeld && host.isDutyActive() && !flagLongFired && safeDt > 0) {
      flagHoldElapsed += safeDt
      if (flagHoldElapsed >= DUTY_FLAG_RELEASE_HOLD_SEC) {
        flagLongFired = true
        pressFlagLongRelease()
      }
    }
    if (activeWorkflow && activeWorkflow.isActive() && safeDt > 0) {
      activeWorkflow.step(safeDt)
    }
    if (activeWorkflow && !activeWorkflow.isActive()) {
      const st = activeWorkflow.getStage()
      if (st === 'received' || st === 'cancelled') {
        activeWorkflow = null
        workflowTargetActor = null
      }
    }
  }

  return {
    pressWhistle,
    pressFlagShort,
    pressFlagLongRelease,
    pressTicket,
    handleKeyDown,
    handleKeyUp,
    step,
    isTicketing: isTicketingNow,
    isFlagEnabled: () => host.isDutyActive() && !isTicketingNow(),
    isWhistleEnabled: () => host.isDutyActive(),
    getAvailability,
    getActiveWorkflow: () => activeWorkflow,
    getLastHaltedActor: () => lastHaltedActor,
    setExternalWorkflow(wf) {
      activeWorkflow = wf
    },
  }
}

export interface BoundDutyKeyboardHandle {
  dispose(): void
}

/**
 * 在 capture 阶段绑定执勤热键（Q / E / F）：
 * - 当执勤激活时，Q 与 E 在 capture 阶段即被消费并 `stopImmediatePropagation()`，绝不泄漏触发 `ui/walk.ts` 骑车换挡。
 */
export function bindDutyKeyboard(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  controller: DutyKeysController,
  isDutyActive: () => boolean,
): BoundDutyKeyboardHandle {
  const onKeyDown = (ev: Event) => {
    const kev = ev as KeyboardEvent
    if (!isDutyActive()) return
    if (shouldSuppressRideGearKey(kev.code, true)) {
      kev.preventDefault?.()
      kev.stopImmediatePropagation?.()
      kev.stopPropagation?.()
      controller.handleKeyDown(kev.code, Boolean(kev.repeat))
      return
    }
    if (hits(kev.code, 'dutyTicket') && controller.getActiveWorkflow()?.getStage() === 'tear_off') {
      kev.preventDefault?.()
      kev.stopImmediatePropagation?.()
      kev.stopPropagation?.()
      controller.handleKeyDown(kev.code, Boolean(kev.repeat))
    }
  }

  const onKeyUp = (ev: Event) => {
    const kev = ev as KeyboardEvent
    if (!isDutyActive()) return
    if (shouldSuppressRideGearKey(kev.code, true)) {
      kev.preventDefault?.()
      kev.stopImmediatePropagation?.()
      kev.stopPropagation?.()
      controller.handleKeyUp(kev.code)
    }
  }

  target.addEventListener('keydown', onKeyDown as EventListener, true)
  target.addEventListener('keyup', onKeyUp as EventListener, true)

  return {
    dispose() {
      target.removeEventListener('keydown', onKeyDown as EventListener, true)
      target.removeEventListener('keyup', onKeyUp as EventListener, true)
    },
  }
}

function renderCapsHtml(keys: readonly string[]): string {
  return keys.map(k => `<kbd>${k}</kbd>`).join('')
}

function renderRowsHtml(rows: readonly GuideKeyRow[]): string {
  return rows
    .map(
      row =>
        `<li${row.id ? ` data-id="${row.id}"` : ''}><span class="keys-caps">${renderCapsHtml(row.keys)}</span><span>${row.label}</span></li>`,
    )
    .join('')
}

/**
 * 将 `keymap.ts` 中的 Q、E、F 三个执勤键同步渲染进左下角「按键」面板 (`.keys-card`) 与 `F1` 玩法指南面板 (`.guide-sheet`)。
 */
export function syncDutyKeysIntoPanels(doc: Document, dutyActive: boolean): void {
  const keysCard = doc.querySelector<HTMLElement>('.keys-card')
  if (keysCard) {
    const ctxEl = keysCard.querySelector<HTMLElement>('.keys-ctx')
    const listEl = keysCard.querySelector<HTMLElement>('.keys-list')
    if (dutyActive && listEl) {
      if (!keysCard.dataset.preDutyHtml) {
        keysCard.dataset.preDutyCtx = ctxEl?.textContent ?? ''
        keysCard.dataset.preDutyHtml = listEl.innerHTML
      }
      if (ctxEl) ctxEl.textContent = '执勤'
      listEl.innerHTML = renderRowsHtml(getDutyCardRows())
    } else if (!dutyActive && keysCard.dataset.preDutyHtml && listEl) {
      if (ctxEl) ctxEl.textContent = keysCard.dataset.preDutyCtx ?? '步行'
      listEl.innerHTML = keysCard.dataset.preDutyHtml
      delete keysCard.dataset.preDutyHtml
      delete keysCard.dataset.preDutyCtx
    }
  }

  const keyGrid = doc.querySelector<HTMLElement>('.guide-sheet .guide-keygrid')
  if (keyGrid) {
    const groupData = getDutyGuideKeyGroup()
    let dutySection = keyGrid.querySelector<HTMLElement>('section[data-duty-keys-group="1"]')
    if (!dutySection) {
      dutySection = doc.createElement('section')
      dutySection.dataset.dutyKeysGroup = '1'
      keyGrid.appendChild(dutySection)
    }
    dutySection.innerHTML = `<h3>${groupData.title}</h3><ul>${renderRowsHtml(groupData.rows)}</ul>`
  }

  const featureList = doc.querySelector<HTMLElement>('.guide-sheet .guide-features')
  if (featureList && !featureList.querySelector('[data-duty-feature="1"]')) {
    const feat = getDutyGuideFeature()
    const li = doc.createElement('li')
    li.dataset.dutyFeature = '1'
    li.innerHTML = `<span class="ui-seal">${feat.seal}</span><div><b>${feat.title}</b><p>${feat.pc}</p></div>`
    featureList.appendChild(li)
  }
}

export const DUTY_TOUCH_DOCK_CSS = `
.td-duty-keys-dock {
  position: fixed;
  left: 50%;
  bottom: 72px;
  transform: translateX(-50%);
  z-index: 62;
  display: flex;
  align-items: stretch;
  gap: 8px;
  font-family: var(--ui-serif, 'Noto Serif SC', 'Songti SC', Georgia, serif);
  pointer-events: auto;
}
body[data-home] .td-duty-keys-dock,
body[data-photo='on'] .td-duty-keys-dock,
body[data-shop-open='1'] .td-duty-keys-dock,
body[data-td-story-active='1'] .td-duty-keys-dock,
body[data-td-knockdown='1'] .td-duty-keys-dock,
body[data-kd-down] .td-duty-keys-dock {
  display: none !important;
}
.td-duty-key-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(244, 239, 226, 0.22);
  background: rgba(20, 33, 30, 0.94);
  color: #f4efe2;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
}
.td-duty-key-btn.is-lit {
  border-color: #c56a56;
  color: #f4efe2;
  background: #223832;
}
.td-duty-key-btn--primary.is-lit {
  background: #a9503c;
  border-color: #c56a56;
  font-weight: 700;
}
.td-duty-key-btn.is-dim,
.td-duty-key-btn:disabled {
  opacity: 0.42;
  color: rgba(244, 239, 226, 0.54);
  cursor: default;
}
.td-duty-key-cap {
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid rgba(244, 239, 226, 0.32);
  background: rgba(12, 20, 18, 0.72);
  font-size: 12px;
}
.td-duty-keys-dock.is-touch-mode {
  bottom: 20px;
  gap: 10px;
}
.td-duty-keys-dock.is-touch-mode .td-duty-key-btn {
  min-height: 46px;
  padding: 0 18px;
  font-size: 14px;
  font-weight: 700;
}
.td-duty-keys-dock.is-touch-mode .td-duty-key-cap {
  display: none;
}
`

export interface DutyTouchDockOptions {
  readonly touchMode?: boolean | (() => boolean)
}

export interface DutyTouchDockHandle {
  readonly element: HTMLElement
  sync(): void
  dispose(): void
}

function detectCoarseTouch(doc: Document): boolean {
  if (doc.body?.dataset?.input === 'touch') return true
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(pointer: coarse) and (not (any-pointer: fine))').matches
  }
  return false
}

/**
 * 挂载屏幕底部中间执勤三键栏（电脑端显示 Q/E/F 键帽并随可用态亮起或变灰；手机端切换为三个触屏大按钮）。
 */
export function mountDutyTouchButtons(
  container: HTMLElement,
  controller: DutyKeysController,
  options?: DutyTouchDockOptions,
): DutyTouchDockHandle {
  const doc = container.ownerDocument
  if (doc.head || doc.body) {
    if (!doc.getElementById('td-duty-keys-dock-style')) {
      const style = doc.createElement('style')
      style.id = 'td-duty-keys-dock-style'
      style.textContent = DUTY_TOUCH_DOCK_CSS
      ;(doc.head ?? doc.body).appendChild(style)
    }
  }

  const dock = doc.createElement('div')
  dock.className = 'td-duty-keys-dock'
  dock.setAttribute('role', 'group')
  dock.setAttribute('aria-label', '辅警执勤三键操作')

  const whistleBtn = doc.createElement('button')
  whistleBtn.type = 'button'
  whistleBtn.className = 'td-duty-key-btn'
  whistleBtn.dataset.dutyAction = 'whistle'
  whistleBtn.addEventListener('click', () => {
    controller.pressWhistle()
    sync()
  })

  const flagBtn = doc.createElement('button')
  flagBtn.type = 'button'
  flagBtn.className = 'td-duty-key-btn'
  flagBtn.dataset.dutyAction = 'flag'
  let holdTimer: ReturnType<typeof setTimeout> | null = null
  let longTriggered = false
  const clearHold = () => {
    if (holdTimer !== null) {
      clearTimeout(holdTimer)
      holdTimer = null
    }
  }
  flagBtn.addEventListener('pointerdown', () => {
    if (!controller.isFlagEnabled()) return
    longTriggered = false
    clearHold()
    holdTimer = setTimeout(() => {
      longTriggered = true
      holdTimer = null
      controller.pressFlagLongRelease()
      sync()
    }, DUTY_FLAG_RELEASE_HOLD_SEC * 1000)
  })
  flagBtn.addEventListener('pointerup', () => {
    const wasHolding = holdTimer !== null
    clearHold()
    if (wasHolding && !longTriggered) {
      controller.pressFlagShort()
      sync()
    }
  })
  flagBtn.addEventListener('pointercancel', clearHold)

  const ticketBtn = doc.createElement('button')
  ticketBtn.type = 'button'
  ticketBtn.className = 'td-duty-key-btn td-duty-key-btn--primary'
  ticketBtn.dataset.dutyAction = 'ticket'
  ticketBtn.addEventListener('click', () => {
    controller.pressTicket()
    sync()
  })

  dock.append(whistleBtn, flagBtn, ticketBtn)
  container.appendChild(dock)

  const applySlot = (btn: HTMLButtonElement, slot: DutyKeySlotState, isPrimary = false) => {
    btn.disabled = !slot.enabled
    btn.setAttribute('aria-disabled', String(!slot.enabled))
    btn.dataset.state = !slot.enabled ? 'dim' : slot.lit ? 'lit' : 'ready'
    btn.className = [
      'td-duty-key-btn',
      isPrimary ? 'td-duty-key-btn--primary' : '',
      !slot.enabled ? 'is-dim' : slot.lit ? 'is-lit' : '',
    ]
      .filter(Boolean)
      .join(' ')
    btn.innerHTML = `<kbd class="td-duty-key-cap">${slot.keyCap}</kbd><span>${slot.label}</span>`
  }

  function sync(): void {
    const avail = controller.getAvailability()
    dock.hidden = !avail.active
    const isTouch =
      typeof options?.touchMode === 'function'
        ? options.touchMode()
        : typeof options?.touchMode === 'boolean'
          ? options.touchMode
          : detectCoarseTouch(doc)
    dock.classList.toggle('is-touch-mode', isTouch)

    applySlot(whistleBtn, avail.whistle, false)
    applySlot(flagBtn, avail.flag, false)
    applySlot(ticketBtn, avail.ticket, true)
  }

  sync()

  return {
    element: dock,
    sync,
    dispose() {
      clearHold()
      dock.remove()
    },
  }
}
