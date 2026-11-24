import { DRINKS_MENU, getDrinkById, defaultDrinkCustomization, type DrinkCatalogItem, type DrinkCustomization } from '../menu/menu.ts'
import { resolveEquipmentActionForStep, type EquipmentActionId } from '../props/equipment.ts'
import type { DrinkSoundId } from '../audio/catalog.ts'
import type { DrinksSim, PrepStationKind } from '../sim/types.ts'
import {
  distanceXZ,
  isInsideBackstageArea,
  pickPrepStationAnchor,
  resolveDrinksStaffAnchors,
  type DrinksStaffAnchors,
  type StaffZonePoint,
} from './anchors.ts'

export type StaffShiftPhase =
  | 'off_duty'
  | 'idle_ready'
  | 'accept_order'
  | 'add_toppings'
  | 'seal_cup'
  | 'call_pickup'

export type StaffWorkflowEventKind =
  | 'hired'
  | 'uniform_equipped'
  | 'uniform_removed'
  | 'order_accepted'
  | 'toppings_completed'
  | 'cup_sealed'
  | 'order_called'
  | 'shift_ended'

export interface StaffWorkflowEvent {
  readonly type: StaffWorkflowEventKind
  readonly timeSec: number
  readonly ticketNo?: string
  readonly itemId?: string
  readonly itemName?: string
  readonly soundId?: DrinkSoundId
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
  readonly kind: 'recruit' | 'accept_order' | 'add_toppings' | 'seal_cup' | 'call_pickup'
  readonly label: string
  readonly ctaLabel: string
  readonly targetPoint: StaffZonePoint
}

export interface DrinksStaffStateSnapshot {
  readonly onDuty: boolean
  readonly uniformEquipped: boolean
  readonly phase: StaffShiftPhase
  readonly nearRecruit: boolean
  readonly recruitDistanceM: number
  readonly inBackstage: boolean
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
  readonly shiftEarningsYuan: number
  readonly lastCalledTicketNo: string | null
}

const STEP_AUDIO_BY_EQUIP: Record<EquipmentActionId, DrinkSoundId> = {
  ice_cream_dispense: 'ice_cream_dispense',
  tea_shake: 'shaker_shake',
  cup_seal: 'cup_seal',
  fruit_pour: 'fruit_pour',
  ice_scoop: 'ice_scoop',
  label_apply: 'label_apply',
}

export interface DrinksStaffSessionOptions {
  anchors?: DrinksStaffAnchors
  sim?: Pick<DrinksSim, 'getSnapshot' | 'getMenu' | 'getLayout'>
  recruitTriggerRadiusM?: number
  stationTriggerRadiusM?: number
  toppingsDurationSec?: number
  sealDurationSec?: number
}

/**
 * 玩家门店员工全流程纯状态机（零 Three.js / DOM 依赖）：
 * 门口应聘穿衣 (`applyForJob`) -> 接单 (`accept_order`) -> 加料/制作 (`add_toppings`) -> 封口贴标 (`seal_cup`) -> 叫号出餐 (`call_pickup`)。
 */
export class DrinksStaffSession {
  readonly anchors: DrinksStaffAnchors
  private readonly sim?: Pick<DrinksSim, 'getSnapshot' | 'getMenu' | 'getLayout'>
  private readonly recruitRadiusM: number
  private readonly stationRadiusM: number
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
  private bgmPlaying = false

  private activeTicket: StaffActiveTicket | null = null
  private stepProgress = 0
  private stepAudioFired = false
  private cupLidSealed = false
  private cupsServed = 0
  private shiftEarningsYuan = 0
  private nextTicketSeq = 1
  private lastCalledTicketNo: string | null = null

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
    this.stationRadiusM = opts.stationTriggerRadiusM ?? 2.2
    this.toppingsDurationSec = Math.max(0.3, opts.toppingsDurationSec ?? 1.1)
    this.sealDurationSec = Math.max(0.25, opts.sealDurationSec ?? 0.8)
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

  private recomputeSpatial(): void {
    this.recruitDistanceM = distanceXZ(
      this.playerX,
      this.playerZ,
      this.anchors.recruitStandee.x,
      this.anchors.recruitStandee.z,
    )
    this.nearRecruit = this.recruitDistanceM <= this.recruitRadiusM
    this.inBackstage = isInsideBackstageArea(this.playerX, this.playerZ, this.anchors)
  }

  private resolveTargetZone(): StaffZonePoint | null {
    if (!this.onDuty) {
      return this.nearRecruit ? this.anchors.recruitStandee : null
    }
    if (this.phase === 'accept_order' || this.phase === 'idle_ready') {
      return this.anchors.orderDesk
    }
    if (this.phase === 'add_toppings') {
      return pickPrepStationAnchor(this.anchors, this.activeTicket?.stationKind ?? 'lemon_ice')
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
        label: '前台接单',
        ctaLabel: '接单',
        targetPoint: this.anchors.orderDesk,
      }
    }
    if (this.phase === 'add_toppings') {
      return {
        visible: true,
        kind: 'add_toppings',
        label: ticketLabel,
        ctaLabel: '加料制作',
        targetPoint: pickPrepStationAnchor(this.anchors, this.activeTicket?.stationKind ?? 'lemon_ice'),
      }
    }
    if (this.phase === 'seal_cup') {
      return {
        visible: true,
        kind: 'seal_cup',
        label: ticketLabel,
        ctaLabel: '封口贴标',
        targetPoint: this.anchors.sealStation,
      }
    }
    if (this.phase === 'call_pickup') {
      return {
        visible: true,
        kind: 'call_pickup',
        label: ticketLabel,
        ctaLabel: '出杯叫号',
        targetPoint: this.anchors.pickupCounter,
      }
    }
    return null
  }

  private resolveActiveCupPos(): StaffZonePoint | null {
    if (!this.onDuty || !this.activeTicket) return null
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

  private pickNextMenuItem(): DrinkCatalogItem {
    if (this.sim) {
      const queued = this.sim.getSnapshot().orders.find(o => o.status === 'queued' || o.status === 'preparing')
      if (queued) {
        const match = getDrinkById(queued.itemId)
        if (match) return match
      }
    }
    return DRINKS_MENU[(this.nextTicketSeq - 1) % DRINKS_MENU.length] ?? DRINKS_MENU[0]!
  }

  updatePlayerLocalPos(x: number, z: number, _yaw = 0): void {
    const prevNear = this.nearRecruit
    const prevBack = this.inBackstage
    this.playerX = x
    this.playerZ = z
    this.recomputeSpatial()
    if (prevNear !== this.nearRecruit || prevBack !== this.inBackstage) {
      this.notify()
    }
  }

  applyForJob(opts?: { force?: boolean }): boolean {
    if (this.onDuty) return false
    if (!opts?.force && !this.nearRecruit) return false
    this.onDuty = true
    this.uniformEquipped = true
    this.phase = 'accept_order'
    this.bgmPlaying = true
    this.stepProgress = 0
    this.cupLidSealed = false
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
    const firstStep = item.steps[0]
    const toppingAction: EquipmentActionId = firstStep
      ? resolveEquipmentActionForStep(firstStep.id, item.stationKind)
      : item.stationKind === 'cream_top'
        ? 'ice_cream_dispense'
        : item.stationKind === 'tea_shake'
          ? 'tea_shake'
          : 'ice_scoop'

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
    this.phase = 'add_toppings'
    this.stepProgress = 0.08
    this.stepAudioFired = false
    this.cupLidSealed = false
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

  private completeToppings(): void {
    if (!this.activeTicket || this.phase !== 'add_toppings') return
    this.stepProgress = 0
    this.stepAudioFired = false
    this.phase = 'seal_cup'
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
    this.shiftEarningsYuan += finished.price >= 7 ? 3 : 2
    this.lastCalledTicketNo = finished.ticketNo
    this.activeTicket = null
    this.stepProgress = 0
    this.cupLidSealed = false
    this.phase = 'accept_order'
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
   * 持续按住推动当前工位进度（加料 / 封口动画随真实经过时间推进，未到 1 时触发设备实时动作音效）
   */
  holdWork(dtSec: number): boolean {
    if (!this.onDuty || !this.activeTicket) return false
    const dt = Math.max(0, Math.min(0.5, Number.isFinite(dtSec) ? dtSec : 0))
    if (dt <= 0) return false
    if (this.phase === 'add_toppings') {
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
   * 未入职且靠近招聘牌 -> 应聘；接单 -> 开始加料；加料 -> 完成加料；封口 -> 封口完成；叫号 -> 出杯完成。
   */
  performPrimaryAction(opts?: { forceRecruit?: boolean }): boolean {
    if (!this.onDuty) {
      return this.applyForJob({ force: opts?.forceRecruit })
    }
    if (this.phase === 'idle_ready' || this.phase === 'accept_order') {
      return Boolean(this.acceptNextOrder())
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
    if (this.onDuty) this.shiftTimeSec += dt
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
      this.phase === 'add_toppings' && this.activeTicket
        ? this.activeTicket.toppingAction
        : this.phase === 'seal_cup'
          ? 'cup_seal'
          : null

    const activeCupFill =
      !this.activeTicket
        ? 0
        : this.phase === 'add_toppings'
          ? 0.14 + this.stepProgress * 0.78
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
      shiftEarningsYuan: this.shiftEarningsYuan,
      lastCalledTicketNo: this.lastCalledTicketNo,
    }
  }
}
