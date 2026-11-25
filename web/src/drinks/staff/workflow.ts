import { DRINKS_MENU, getDrinkById, defaultDrinkCustomization, type DrinkCatalogItem, type DrinkCustomization } from '../menu/menu.ts'
import { resolveEquipmentActionForStep, type EquipmentActionId } from '../props/equipment.ts'
import type { DrinkSoundId } from '../audio/catalog.ts'
import type { DrinksSim, PrepStationKind } from '../sim/types.ts'
import {
  distanceXZ,
  isInsideBackstageArea,
  isInsideShopInterior,
  pickPrepStationAnchor,
  resolveDrinksStaffAnchors,
  type DrinksStaffAnchors,
  type StaffZonePoint,
} from './anchors.ts'

export type StaffShiftPhase =
  | 'off_duty'
  | 'idle_ready'
  | 'accept_order'
  | 'shake_cup'
  | 'add_toppings'
  | 'seal_cup'
  | 'call_pickup'

export type StaffWorkflowEventKind =
  | 'hired'
  | 'uniform_equipped'
  | 'uniform_removed'
  | 'order_accepted'
  | 'shake_completed'
  | 'toppings_completed'
  | 'cup_sealed'
  | 'order_called'
  | 'mistake'
  | 'shift_ended'

export type StaffMistakeCode = 'wrong_station' | 'wrong_step' | 'not_on_duty' | 'no_active_ticket'

export interface StaffWorkflowEvent {
  readonly type: StaffWorkflowEventKind
  readonly timeSec: number
  readonly ticketNo?: string
  readonly itemId?: string
  readonly itemName?: string
  readonly soundId?: DrinkSoundId
  readonly detail?: string
}

export interface StaffFeedbackNotice {
  readonly seq: number
  readonly code: StaffMistakeCode
  readonly message: string
  readonly expectedPhase: StaffShiftPhase
  readonly attemptedAction?: string
  readonly expiresAtShiftSec: number
}

export interface StaffActiveTicket {
  readonly orderId: string
  readonly ticketNo: string
  readonly itemId: string
  readonly itemName: string
  readonly cupColor: string
  readonly accentColor: string
  readonly stationKind: PrepStationKind
  readonly price: number
  readonly hasPearls: boolean
  readonly hasCreamCrown: boolean
  readonly hot: boolean
  readonly customization: DrinkCustomization
  readonly toppingAction: EquipmentActionId
}

export interface StaffActionPrompt {
  readonly visible: boolean
  readonly kind: 'recruit' | 'accept_order' | 'shake_cup' | 'add_toppings' | 'seal_cup' | 'call_pickup'
  readonly label: string
  readonly ctaLabel: string
  readonly targetPoint: StaffZonePoint
}

export interface StaffStepGesture {
  readonly phase: StaffShiftPhase
  readonly untilShiftSec: number
  readonly isError: boolean
}

export interface DrinksStaffStateSnapshot {
  readonly onDuty: boolean
  readonly uniformEquipped: boolean
  readonly phase: StaffShiftPhase
  readonly nearRecruit: boolean
  readonly recruitDistanceM: number
  readonly inBackstage: boolean
  readonly inShopInterior: boolean
  readonly bgmPlaying: boolean
  readonly shiftTimeSec: number
  readonly stepProgress: number
  readonly activeActionId: EquipmentActionId | null
  readonly activeCupFill: number
  readonly cupLidSealed: boolean
  readonly activeCupPos: StaffZonePoint | null
  readonly activeTicket: StaffActiveTicket | null
  readonly prompt: StaffActionPrompt | null
  readonly targetZone: StaffZonePoint | null
  readonly cupsServed: number
  readonly streakCount: number
  readonly shiftEarningsYuan: number
  readonly lastCalledTicketNo: string | null
  readonly mistakeCount: number
  readonly lastMistake: StaffFeedbackNotice | null
  readonly lastStepGesture: StaffStepGesture | null
}

const STEP_AUDIO_BY_EQUIP: Record<EquipmentActionId, DrinkSoundId> = {
  ice_cream_dispense: 'ice_cream_dispense',
  tea_shake: 'shaker_shake',
  cup_seal: 'cup_seal',
  fruit_pour: 'fruit_pour',
  ice_scoop: 'ice_scoop',
  label_apply: 'label_apply',
}

const STATION_NAME_ZH: Record<PrepStationKind, string> = {
  lemon_ice: '鲜果碎冰区',
  tea_shake: '萃茶摇茶区',
  cream_top: '奶浆雪糕区',
}

const PHASE_GUIDE_TEXT: Record<StaffShiftPhase, string> = {
  off_duty: '请先在门口应聘上岗',
  idle_ready: '请先到前台收银接单',
  accept_order: '请先到前台收银接单',
  shake_cup: '请先在萃茶区摇杯匀冰',
  add_toppings: '请先前往对应台区加料',
  seal_cup: '请先到封口机压膜贴标',
  call_pickup: '请前往取餐台出杯叫号',
}

export interface DrinksStaffSessionOptions {
  anchors?: DrinksStaffAnchors
  sim?: Pick<DrinksSim, 'getSnapshot' | 'getMenu' | 'getLayout'>
  recruitTriggerRadiusM?: number
  stationTriggerRadiusM?: number
  shakeDurationSec?: number
  toppingsDurationSec?: number
  sealDurationSec?: number
}

/**
 * 玩家门店员工全流程纯状态机（零 Three.js / DOM 依赖）：
 * 门口应聘穿衣 (`applyForJob`) -> 接单 (`accept_order`) -> 摇杯 (`shake_cup`) -> 加料 (`add_toppings`) -> 封口贴标 (`seal_cup`) -> 叫号出餐 (`call_pickup`)。
 * 内置错误工位/错步校验与连单不重样节奏调度。
 */
export class DrinksStaffSession {
  readonly anchors: DrinksStaffAnchors
  private readonly sim?: Pick<DrinksSim, 'getSnapshot' | 'getMenu' | 'getLayout'>
  private readonly recruitRadiusM: number
  private readonly stationRadiusM: number
  private readonly shakeDurationSec: number
  private readonly toppingsDurationSec: number
  private readonly sealDurationSec: number

  private onDuty = false
  private uniformEquipped = false
  private phase: StaffShiftPhase = 'off_duty'
  private shiftTimeSec = 0
  private playerX = 0
  private playerZ = 6.0
  private nearRecruit = false
  private recruitDistanceM = Infinity
  private inBackstage = false
  private inShopInterior = false
  private bgmPlaying = false

  private activeTicket: StaffActiveTicket | null = null
  private stepProgress = 0
  private stepAudioFired = false
  private cupLidSealed = false
  private cupsServed = 0
  private streakCount = 0
  private shiftEarningsYuan = 0
  private nextTicketSeq = 1
  private lastCalledTicketNo: string | null = null
  private lastServedItemId: string | null = null

  private mistakeCount = 0
  private mistakeSeq = 0
  private lastMistake: StaffFeedbackNotice | null = null
  private lastStepGesture: StaffStepGesture | null = null

  private readonly events: StaffWorkflowEvent[] = []
  private readonly pendingSounds: DrinkSoundId[] = []
  private readonly listeners = new Set<(snap: DrinksStaffStateSnapshot) => void>()

  constructor(opts: DrinksStaffSessionOptions = {}) {
    this.anchors =
      opts.anchors ??
      resolveDrinksStaffAnchors({
        layout: opts.sim?.getLayout(),
      })
    this.sim = opts.sim
    this.recruitRadiusM = opts.recruitTriggerRadiusM ?? 2.35
    this.stationRadiusM = opts.stationTriggerRadiusM ?? 1.45
    this.shakeDurationSec = Math.max(0.25, opts.shakeDurationSec ?? 0.72)
    this.toppingsDurationSec = Math.max(0.3, opts.toppingsDurationSec ?? 0.92)
    this.sealDurationSec = Math.max(0.25, opts.sealDurationSec ?? 0.74)
    this.recomputeSpatial()
  }

  private emitEvent(ev: StaffWorkflowEvent): void {
    this.events.push(ev)
    if (this.events.length > 100) this.events.splice(0, this.events.length - 100)
  }

  private queueSound(id: DrinkSoundId): void {
    this.pendingSounds.push(id)
  }

  private notify(): void {
    const snap = this.getSnapshot()
    for (const cb of this.listeners) cb(snap)
  }

  private recordStepGesture(phase: StaffShiftPhase, isError = false, durationSec = 0.55): void {
    this.lastStepGesture = {
      phase,
      untilShiftSec: this.shiftTimeSec + durationSec,
      isError,
    }
  }

  private recomputeSpatial(): void {
    this.recruitDistanceM = distanceXZ(
      this.playerX,
      this.playerZ,
      this.anchors.recruitStandee.x,
      this.anchors.recruitStandee.z,
    )
    this.nearRecruit = this.recruitDistanceM <= this.recruitRadiusM
    this.inBackstage = isInsideBackstageArea(this.playerX, this.playerZ, this.anchors)
    this.inShopInterior = isInsideShopInterior(this.playerX, this.playerZ, this.anchors)
  }

  private resolvePrepTargetZone(kind: PrepStationKind): StaffZonePoint {
    const st = pickPrepStationAnchor(this.anchors, kind)
    if (kind === 'cream_top') {
      // cream_top working deck sits in open space left of baked ice-cream housing
      return { ...st, x: st.x - 0.48 }
    }
    return st
  }

  private resolveTargetZone(): StaffZonePoint | null {
    if (!this.onDuty) {
      return this.nearRecruit ? this.anchors.recruitStandee : null
    }
    if (this.phase === 'accept_order' || this.phase === 'idle_ready') {
      return this.anchors.orderDesk
    }
    if (this.phase === 'shake_cup') {
      return this.anchors.shakeStation
    }
    if (this.phase === 'add_toppings') {
      return this.resolvePrepTargetZone(this.activeTicket?.stationKind ?? 'lemon_ice')
    }
    if (this.phase === 'seal_cup') {
      return this.anchors.sealStation
    }
    if (this.phase === 'call_pickup') {
      return this.anchors.pickupCounter
    }
    return null
  }

  private resolvePrompt(): StaffActionPrompt | null {
    if (!this.onDuty) {
      if (!this.nearRecruit) return null
      return {
        visible: true,
        kind: 'recruit',
        label: '蜜雪招聘',
        ctaLabel: '应聘上岗',
        targetPoint: this.anchors.recruitStandee,
      }
    }

    const ticketLabel = this.activeTicket ? `${this.activeTicket.ticketNo} ${this.activeTicket.itemName}` : '待接新单'
    if (this.phase === 'idle_ready' || this.phase === 'accept_order') {
      return {
        visible: true,
        kind: 'accept_order',
        label: this.streakCount > 0 ? `前台接单 · 连做${this.streakCount}杯` : '前台接单',
        ctaLabel: '接单',
        targetPoint: this.anchors.orderDesk,
      }
    }
    if (this.phase === 'shake_cup') {
      return {
        visible: true,
        kind: 'shake_cup',
        label: `${ticketLabel} · 摇杯`,
        ctaLabel: '手摇匀杯',
        targetPoint: this.anchors.shakeStation,
      }
    }
    if (this.phase === 'add_toppings') {
      return {
        visible: true,
        kind: 'add_toppings',
        label: `${ticketLabel} · 加料`,
        ctaLabel: '加料制作',
        targetPoint: this.resolvePrepTargetZone(this.activeTicket?.stationKind ?? 'lemon_ice'),
      }
    }
    if (this.phase === 'seal_cup') {
      return {
        visible: true,
        kind: 'seal_cup',
        label: `${ticketLabel} · 封口`,
        ctaLabel: '封口贴标',
        targetPoint: this.anchors.sealStation,
      }
    }
    if (this.phase === 'call_pickup') {
      return {
        visible: true,
        kind: 'call_pickup',
        label: `${ticketLabel} · 叫号`,
        ctaLabel: '出杯叫号',
        targetPoint: this.anchors.pickupCounter,
      }
    }
    return null
  }

  private resolveActiveCupPos(): StaffZonePoint | null {
    if (!this.onDuty || !this.activeTicket) return null
    if (this.phase === 'shake_cup') {
      return {
        x: this.anchors.shakeStation.x + 0.24,
        z: this.anchors.shakeStation.z - 0.62,
        yaw: 0,
        y: (this.anchors.shakeStation.y ?? this.anchors.prepBarHeightM) + 0.052,
      }
    }
    if (this.phase === 'add_toppings') {
      const st = pickPrepStationAnchor(this.anchors, this.activeTicket.stationKind)
      const dx = st.kind === 'cream_top' ? -0.46 : 0.24
      return {
        x: st.x + dx,
        z: st.z - 0.6,
        yaw: 0,
        y: (st.y ?? this.anchors.prepBarHeightM) + 0.052,
      }
    }
    if (this.phase === 'seal_cup') {
      return {
        x: this.anchors.sealStation.x,
        z: this.anchors.sealStation.z - 0.64,
        yaw: 0,
        y: (this.anchors.sealStation.y ?? this.anchors.prepBarHeightM) + 0.052,
      }
    }
    if (this.phase === 'call_pickup') {
      return this.anchors.pickupCupSlot
    }
    return null
  }

  private resolveToppingAction(item: DrinkCatalogItem): EquipmentActionId {
    const firstStep = item.steps[0]
    let act: EquipmentActionId = firstStep
      ? resolveEquipmentActionForStep(firstStep.id, item.stationKind)
      : item.stationKind === 'cream_top'
        ? 'ice_cream_dispense'
        : item.stationKind === 'tea_shake'
          ? 'ice_scoop'
          : 'fruit_pour'
    // `shake_cup` already performs `tea_shake`, so `add_toppings` differentiates clearly with pouring/scooping/dispense
    if (act === 'tea_shake') {
      act = item.hasPearls ? 'ice_scoop' : 'fruit_pour'
    }
    return act
  }

  private pickNextMenuItem(): DrinkCatalogItem {
    if (this.sim) {
      const queued = this.sim
        .getSnapshot()
        .orders.find(o => (o.status === 'queued' || o.status === 'preparing') && o.itemId !== this.lastServedItemId)
      if (queued) {
        const match = getDrinkById(queued.itemId)
        if (match) return match
      }
    }
    const len = DRINKS_MENU.length
    let idx = (this.nextTicketSeq - 1) % len
    let candidate = DRINKS_MENU[idx] ?? DRINKS_MENU[0]!
    if (candidate.id === this.lastServedItemId && len > 1) {
      idx = (idx + 1) % len
      candidate = DRINKS_MENU[idx] ?? candidate
    }
    return candidate
  }

  /**
   * 触发一次明确的「做错提示反馈」（播放拒绝提示音 + 记录错因 + 驱动 3D 摆手与 HUD 温和抖动）。
   */
  triggerMistake(code: StaffMistakeCode, message?: string, attemptedAction?: string): StaffFeedbackNotice {
    const fallbackMsg =
      this.phase === 'add_toppings' && this.activeTicket
        ? `请先去${STATION_NAME_ZH[this.activeTicket.stationKind]}加料`
        : PHASE_GUIDE_TEXT[this.phase]
    this.mistakeCount += 1
    this.mistakeSeq += 1
    const notice: StaffFeedbackNotice = {
      seq: this.mistakeSeq,
      code,
      message: message ?? fallbackMsg,
      expectedPhase: this.phase,
      attemptedAction,
      expiresAtShiftSec: this.shiftTimeSec + 2.2,
    }
    this.lastMistake = notice
    this.recordStepGesture(this.phase, true, 0.55)
    this.queueSound('action_reject')
    this.emitEvent({
      type: 'mistake',
      timeSec: this.shiftTimeSec,
      ticketNo: this.activeTicket?.ticketNo,
      itemId: this.activeTicket?.itemId,
      itemName: this.activeTicket?.itemName,
      soundId: 'action_reject',
      detail: `${code}:${notice.message}`,
    })
    this.notify()
    return notice
  }

  clearMistake(): void {
    if (!this.lastMistake) return
    this.lastMistake = null
    this.notify()
  }

  private detectWrongNearbyStation(): { stationLabel: string; message: string } | null {
    const target = this.resolveTargetZone()
    if (!target) return null
    const distTarget = distanceXZ(this.playerX, this.playerZ, target.x, target.z)

    // Compare against other indoor workstations: fail if closer to a wrong workstation, OR outside stationRadiusM while at another bench
    const otherSpots: Array<{ label: string; pt: StaffZonePoint; radius: number }> = [
      { label: '收银台', pt: this.anchors.orderDesk, radius: 1.35 },
      { label: '萃茶摇杯区', pt: this.anchors.shakeStation, radius: 1.35 },
      { label: '封口区', pt: this.anchors.sealStation, radius: 1.35 },
      { label: '取餐台', pt: this.anchors.pickupCounter, radius: 1.35 },
    ]
    for (const ps of this.anchors.prepStations) {
      otherSpots.push({ label: ps.label, pt: this.resolvePrepTargetZone(ps.kind), radius: 1.35 })
    }

    for (const spot of otherSpots) {
      if (distanceXZ(spot.pt.x, spot.pt.z, target.x, target.z) < 0.45) continue
      const distSpot = distanceXZ(this.playerX, this.playerZ, spot.pt.x, spot.pt.z)
      const closerToWrong = distSpot <= spot.radius && distSpot + 0.1 < distTarget
      const farOutOnWrong = distTarget > this.stationRadiusM && distSpot <= spot.radius
      if (closerToWrong || farOutOnWrong) {
        const nextGuide =
          this.phase === 'add_toppings' && this.activeTicket
            ? `请到${STATION_NAME_ZH[this.activeTicket.stationKind]}加料`
            : PHASE_GUIDE_TEXT[this.phase]
        return {
          stationLabel: spot.label,
          message: `站错工位(${spot.label})，${nextGuide}`,
        }
      }
    }
    return null
  }

  updatePlayerLocalPos(x: number, z: number, _yaw = 0): void {
    const prevNear = this.nearRecruit
    const prevBack = this.inBackstage
    const prevShop = this.inShopInterior
    this.playerX = x
    this.playerZ = z
    this.recomputeSpatial()
    if (prevNear !== this.nearRecruit || prevBack !== this.inBackstage || prevShop !== this.inShopInterior) {
      this.notify()
    }
  }

  applyForJob(opts?: { force?: boolean }): boolean {
    if (this.onDuty) return false
    if (!opts?.force && !this.nearRecruit) {
      this.triggerMistake('wrong_station', '请靠近门口招聘立牌应聘', 'recruit')
      return false
    }
    this.onDuty = true
    this.uniformEquipped = true
    this.phase = 'accept_order'
    this.bgmPlaying = true
    this.stepProgress = 0
    this.cupLidSealed = false
    this.lastMistake = null
    this.recordStepGesture('accept_order', false, 0.45)
    this.queueSound('staff_clock_in')
    this.emitEvent({ type: 'hired', timeSec: this.shiftTimeSec, soundId: 'staff_clock_in' })
    this.emitEvent({ type: 'uniform_equipped', timeSec: this.shiftTimeSec })
    this.notify()
    return true
  }

  resignJob(): boolean {
    if (!this.onDuty) return false
    this.onDuty = false
    this.uniformEquipped = false
    this.phase = 'off_duty'
    this.bgmPlaying = false
    this.activeTicket = null
    this.stepProgress = 0
    this.cupLidSealed = false
    this.lastMistake = null
    this.lastStepGesture = null
    this.emitEvent({ type: 'uniform_removed', timeSec: this.shiftTimeSec })
    this.emitEvent({ type: 'shift_ended', timeSec: this.shiftTimeSec })
    this.notify()
    return true
  }

  acceptNextOrder(): StaffActiveTicket | null {
    if (!this.onDuty) return null
    if (this.phase !== 'idle_ready' && this.phase !== 'accept_order') return this.activeTicket

    const item = this.pickNextMenuItem()
    const seqNo = this.nextTicketSeq++
    const ticketNo = `S${String(seqNo).padStart(3, '0')}`
    const toppingAction = this.resolveToppingAction(item)

    const ticket: StaffActiveTicket = {
      orderId: `staff_ord_${seqNo}`,
      ticketNo,
      itemId: item.id,
      itemName: item.name,
      cupColor: item.cupColor,
      accentColor: item.accentColor,
      stationKind: item.stationKind,
      price: item.price,
      hasPearls: Boolean(item.hasPearls),
      hasCreamCrown: Boolean(item.hasCreamCrown),
      hot: Boolean(item.hot),
      customization: defaultDrinkCustomization(item),
      toppingAction,
    }
    this.activeTicket = ticket
    this.phase = 'shake_cup'
    this.stepProgress = 0.06
    this.stepAudioFired = false
    this.cupLidSealed = false
    this.lastMistake = null
    this.recordStepGesture('accept_order', false, 0.45)
    this.queueSound('order_chime')
    this.queueSound('cup_drop')
    this.emitEvent({
      type: 'order_accepted',
      timeSec: this.shiftTimeSec,
      ticketNo,
      itemId: item.id,
      itemName: item.name,
      soundId: 'order_chime',
    })
    this.notify()
    return ticket
  }

  private completeShake(): void {
    if (!this.activeTicket || this.phase !== 'shake_cup') return
    this.stepProgress = 0
    this.stepAudioFired = false
    this.phase = 'add_toppings'
    this.lastMistake = null
    this.recordStepGesture('shake_cup', false, 0.45)
    this.queueSound('staff_step_done')
    this.emitEvent({
      type: 'shake_completed',
      timeSec: this.shiftTimeSec,
      ticketNo: this.activeTicket.ticketNo,
      itemId: this.activeTicket.itemId,
      itemName: this.activeTicket.itemName,
      soundId: 'staff_step_done',
    })
    this.notify()
  }

  private completeToppings(): void {
    if (!this.activeTicket || this.phase !== 'add_toppings') return
    this.stepProgress = 0
    this.stepAudioFired = false
    this.phase = 'seal_cup'
    this.lastMistake = null
    this.recordStepGesture('add_toppings', false, 0.45)
    this.queueSound('staff_step_done')
    this.emitEvent({
      type: 'toppings_completed',
      timeSec: this.shiftTimeSec,
      ticketNo: this.activeTicket.ticketNo,
      itemId: this.activeTicket.itemId,
      itemName: this.activeTicket.itemName,
      soundId: 'staff_step_done',
    })
    this.notify()
  }

  private completeSeal(): void {
    if (!this.activeTicket || this.phase !== 'seal_cup') return
    this.stepProgress = 1
    this.cupLidSealed = true
    this.stepAudioFired = false
    this.phase = 'call_pickup'
    this.lastMistake = null
    this.recordStepGesture('seal_cup', false, 0.45)
    this.queueSound('label_apply')
    this.queueSound('staff_step_done')
    this.emitEvent({
      type: 'cup_sealed',
      timeSec: this.shiftTimeSec,
      ticketNo: this.activeTicket.ticketNo,
      itemId: this.activeTicket.itemId,
      itemName: this.activeTicket.itemName,
      soundId: 'label_apply',
    })
    this.notify()
  }

  completeCallPickup(): boolean {
    if (!this.onDuty || !this.activeTicket || this.phase !== 'call_pickup') return false
    const finished = this.activeTicket
    this.cupsServed += 1
    this.streakCount += 1
    this.shiftEarningsYuan += finished.price >= 7 ? 3 : 2
    this.lastCalledTicketNo = finished.ticketNo
    this.lastServedItemId = finished.itemId
    this.activeTicket = null
    this.stepProgress = 0
    this.cupLidSealed = false
    this.phase = 'accept_order'
    this.lastMistake = null
    this.recordStepGesture('call_pickup', false, 0.65)
    this.queueSound('call_number')
    this.emitEvent({
      type: 'order_called',
      timeSec: this.shiftTimeSec,
      ticketNo: finished.ticketNo,
      itemId: finished.itemId,
      itemName: finished.itemName,
      soundId: 'call_number',
    })
    this.notify()
    return true
  }

  /**
   * 显式按工序或工位执行动作（如在「摇杯」阶段误按「封口」或「叫号」时，触发错步反馈）。
   */
  performStationAction(attemptedStep: StaffShiftPhase, opts?: { bypassProximity?: boolean }): boolean {
    if (!this.onDuty) {
      this.triggerMistake('not_on_duty', PHASE_GUIDE_TEXT.off_duty, attemptedStep)
      return false
    }
    if (attemptedStep !== this.phase && !(this.phase === 'idle_ready' && attemptedStep === 'accept_order')) {
      const msg =
        this.phase === 'add_toppings' && this.activeTicket
          ? `步骤错了，请先去${STATION_NAME_ZH[this.activeTicket.stationKind]}加料`
          : `步骤错了，${PHASE_GUIDE_TEXT[this.phase]}`
      this.triggerMistake('wrong_step', msg, attemptedStep)
      return false
    }
    return this.performPrimaryAction({ bypassProximity: opts?.bypassProximity })
  }

  /**
   * 持续按住推动当前工位进度（摇杯 / 加料 / 封口 动画随真实经过时间推进，并触发对应实时设备音效与手部摆动）
   */
  holdWork(dtSec: number, opts?: { bypassProximity?: boolean }): boolean {
    if (!this.onDuty || !this.activeTicket) return false
    const dt = Math.max(0, Math.min(0.5, Number.isFinite(dtSec) ? dtSec : 0))
    if (dt <= 0) return false
    if (!opts?.bypassProximity) {
      const wrong = this.detectWrongNearbyStation()
      if (wrong) {
        if (!this.lastMistake || this.lastMistake.expiresAtShiftSec <= this.shiftTimeSec) {
          this.triggerMistake('wrong_station', wrong.message, this.phase)
        }
        return false
      }
    }

    if (this.phase === 'shake_cup') {
      this.lastMistake = null
      if (!this.stepAudioFired) {
        this.stepAudioFired = true
        this.queueSound('shaker_shake')
      }
      this.stepProgress = Math.min(1, this.stepProgress + dt / this.shakeDurationSec)
      if (this.stepProgress >= 1) {
        this.completeShake()
      } else {
        this.notify()
      }
      return true
    }

    if (this.phase === 'add_toppings') {
      this.lastMistake = null
      if (!this.stepAudioFired) {
        this.stepAudioFired = true
        this.queueSound(STEP_AUDIO_BY_EQUIP[this.activeTicket.toppingAction])
      }
      this.stepProgress = Math.min(1, this.stepProgress + dt / this.toppingsDurationSec)
      if (this.stepProgress >= 1) {
        this.completeToppings()
      } else {
        this.notify()
      }
      return true
    }

    if (this.phase === 'seal_cup') {
      this.lastMistake = null
      if (!this.stepAudioFired) {
        this.stepAudioFired = true
        this.queueSound('cup_seal')
      }
      this.stepProgress = Math.min(1, this.stepProgress + dt / this.sealDurationSec)
      if (this.stepProgress >= 1) {
        this.completeSeal()
      } else {
        this.notify()
      }
      return true
    }
    return false
  }

  /**
   * 单次点击/按键触发当前阶段的下一步推进：
   * 若站在店里另一错误工位（或未在目标站位）则触发做错反馈；否则顺次完成当前步。
   */
  performPrimaryAction(opts?: { forceRecruit?: boolean; bypassProximity?: boolean }): boolean {
    if (!this.onDuty) {
      return this.applyForJob({ force: opts?.forceRecruit })
    }
    if (!opts?.bypassProximity) {
      const wrong = this.detectWrongNearbyStation()
      if (wrong) {
        this.triggerMistake('wrong_station', wrong.message, this.phase)
        return false
      }
    }
    if (this.phase === 'idle_ready' || this.phase === 'accept_order') {
      return Boolean(this.acceptNextOrder())
    }
    if (this.phase === 'shake_cup') {
      if (!this.stepAudioFired) {
        this.stepAudioFired = true
        this.queueSound('shaker_shake')
      }
      this.stepProgress = 1
      this.completeShake()
      return true
    }
    if (this.phase === 'add_toppings') {
      if (!this.stepAudioFired && this.activeTicket) {
        this.stepAudioFired = true
        this.queueSound(STEP_AUDIO_BY_EQUIP[this.activeTicket.toppingAction])
      }
      this.stepProgress = 1
      this.completeToppings()
      return true
    }
    if (this.phase === 'seal_cup') {
      if (!this.stepAudioFired) {
        this.stepAudioFired = true
        this.queueSound('cup_seal')
      }
      this.stepProgress = 1
      this.completeSeal()
      return true
    }
    if (this.phase === 'call_pickup') {
      return this.completeCallPickup()
    }
    return false
  }

  step(dtSec: number): void {
    const dt = Math.max(0, Math.min(0.25, Number.isFinite(dtSec) ? dtSec : 0))
    if (dt <= 0) return
    if (this.onDuty) {
      this.shiftTimeSec += dt
      let changed = false
      if (this.lastMistake && this.shiftTimeSec >= this.lastMistake.expiresAtShiftSec) {
        this.lastMistake = null
        changed = true
      }
      if (this.lastStepGesture && this.shiftTimeSec >= this.lastStepGesture.untilShiftSec) {
        this.lastStepGesture = null
        changed = true
      }
      if (changed) this.notify()
    }
  }

  isNearTargetStation(): boolean {
    const pt = this.resolveTargetZone()
    if (!pt) return false
    return distanceXZ(this.playerX, this.playerZ, pt.x, pt.z) <= this.stationRadiusM
  }

  drainEvents(): StaffWorkflowEvent[] {
    return this.events.splice(0, this.events.length)
  }

  drainSounds(): DrinkSoundId[] {
    return this.pendingSounds.splice(0, this.pendingSounds.length)
  }

  subscribe(listener: (snap: DrinksStaffStateSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): DrinksStaffStateSnapshot {
    const activeActionId: EquipmentActionId | null =
      this.phase === 'shake_cup' && this.activeTicket
        ? 'tea_shake'
        : this.phase === 'add_toppings' && this.activeTicket
          ? this.activeTicket.toppingAction
          : this.phase === 'seal_cup'
            ? 'cup_seal'
            : null

    const activeCupFill =
      !this.activeTicket
        ? 0
        : this.phase === 'shake_cup'
          ? 0.22 + this.stepProgress * 0.26
          : this.phase === 'add_toppings'
            ? 0.48 + this.stepProgress * 0.44
            : this.phase === 'seal_cup' || this.phase === 'call_pickup'
              ? 0.92
              : 0

    return {
      onDuty: this.onDuty,
      uniformEquipped: this.uniformEquipped,
      phase: this.phase,
      nearRecruit: this.nearRecruit,
      recruitDistanceM: Math.round(this.recruitDistanceM * 100) / 100,
      inBackstage: this.inBackstage,
      inShopInterior: this.inShopInterior,
      bgmPlaying: this.bgmPlaying,
      shiftTimeSec: Math.round(this.shiftTimeSec * 100) / 100,
      stepProgress: Math.round(this.stepProgress * 1000) / 1000,
      activeActionId,
      activeCupFill: Math.round(activeCupFill * 1000) / 1000,
      cupLidSealed: this.cupLidSealed,
      activeCupPos: this.resolveActiveCupPos(),
      activeTicket: this.activeTicket,
      prompt: this.resolvePrompt(),
      targetZone: this.resolveTargetZone(),
      cupsServed: this.cupsServed,
      streakCount: this.streakCount,
      shiftEarningsYuan: this.shiftEarningsYuan,
      lastCalledTicketNo: this.lastCalledTicketNo,
      mistakeCount: this.mistakeCount,
      lastMistake: this.lastMistake,
      lastStepGesture: this.lastStepGesture,
    }
  }
}
