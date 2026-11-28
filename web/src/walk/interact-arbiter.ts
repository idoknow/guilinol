/**
 * Unified `[F]` interaction arbiter (`web/src/walk/interact-arbiter.ts`).
 *
 * Replaces private `KeyF` listeners in `vehicles.ts` with a single deterministic 7-level priority short-circuit
 * (docs/commerce-shops-spec.md §2.2):
 *   0 (Blocked)       : text input focused / data-home / photo mode / shop·wardrobe·garage·modal open -> hide & block
 *   1 (Locked)        : crash / standUp / pickup animation active -> block shop & mount (show pickup progress label)
 *   2 (Aboard)        : riding ebike/bike, driving car, or boating -> ONLY dismount / disembark (if in shop radius, soft hint only)
 *   3 (Foot·Pickup)   : on foot near downed two-wheeler (< 4.4m, |dy| <= 1.5m) -> pickup fallen bike
 *   4 (Foot·Shop/Bay) : on foot inside shop trigger (!quiet) or serviceBay -> open shop / service bay (suppresses 4.2m mount!)
 *   5 (Foot·Vehicle)  : on foot near vehicle (< 4.2m / car < 4.6m; personal bike +0.6m priority bias) -> mount
 *   6 (Foot·Water)    : on foot near free boat dock or tour pier -> board boat
 */

import {hits, isDutyScopeActive} from '../input/keymap'
import {isGlobalHotkeyBlocked} from './input-guard'

export type InteractionActionKind =
  | 'none'
  | 'pickup_busy'
  | 'dismount'
  | 'pickup_downed'
  | 'handover_ticket'
  | 'whistle_cite'
  | 'talk_officer'
  | 'open_shop'
  | 'open_service'
  | 'mount_vehicle'
  | 'damaged_vehicle'
  | 'board_boat'

export interface VehicleCandidateSnapshot {
  kind: 'car' | 'bike' | 'bicycle'
  downed: boolean
  damaged?: boolean
  distance: number
  ownership?: 'shared' | 'personal' | 'test_ride'
  ebikeTier?: 'shared' | 'normal'
  alreadyUnlocked?: boolean
}

export interface BoatCandidateSnapshot {
  kind: 'free_boat' | 'tour_boat'
  label: string
  distance: number
}

export interface ShopCandidateSnapshot {
  shopId: string
  brandName: string
  displayName: string
  distance: number
}

export interface ServiceBayCandidateSnapshot {
  shopId: string
  displayName: string
  distance: number
}

export interface TrafficDutyHandoverSnapshot {
  label: string
  distance?: number
  canDeliverNow?: boolean
}

export interface TrafficDutyOfficerSnapshot {
  label: string
  distance?: number
}

export interface InteractionContext {
  soloEnabled: boolean
  active: boolean
  modalOrOverlayBlocked: boolean
  crashed: boolean
  standingUp: boolean
  pickingUpKind: 'bike' | 'bicycle' | null
  aboardKind: 'car' | 'bike' | 'bicycle' | 'free_boat' | 'tour_boat' | null
  tourDisembarkQueued?: boolean
  inQuietZone: boolean
  nearDownedVehicle: VehicleCandidateSnapshot | null
  nearShop: ShopCandidateSnapshot | null
  nearServiceBay: ServiceBayCandidateSnapshot | null
  nearTicketHandover?: TrafficDutyHandoverSnapshot | null
  nearTrafficViolator?: {label: string; violation: string; fineYuan: number; action?: 'handover_ticket' | 'talk_officer' | 'whistle_cite'} | null
  nearDutyOfficer?: TrafficDutyOfficerSnapshot | null
  nearVehicle: VehicleCandidateSnapshot | null
  nearDamagedVehicle?: VehicleCandidateSnapshot | null
  nearBoat: BoatCandidateSnapshot | null
}

export interface InteractionDecision {
  priority: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
  action: InteractionActionKind
  label: string
  disabled: boolean
  shopId?: string
  softHint?: string
  ebikeTier?: 'shared' | 'normal'
  ownership?: 'shared' | 'personal' | 'test_ride'
}

/** Pure deterministic 7-level `[F]` priority resolver (zero DOM/Three.js coupling; fully unit-testable). */
export function resolveInteraction(ctx: InteractionContext): InteractionDecision {
  // Priority 0: Modal / home / photo / shop overlay / inactive walk mode -> hard block
  if (!ctx.active || ctx.modalOrOverlayBlocked) {
    return {priority: 0, action: 'none', label: '', disabled: true}
  }

  // Priority 1: Crash / stand-up / pickup lock
  if (ctx.pickingUpKind) {
    return {
      priority: 1,
      action: 'pickup_busy',
      label: ctx.pickingUpKind === 'bicycle' ? '正在扶起单车' : '正在扶起电动车',
      disabled: true,
    }
  }
  if (ctx.standingUp || ctx.crashed) {
    return {priority: 1, action: 'none', label: '', disabled: true}
  }

  // Priority 2: Aboard any vehicle/boat -> ONLY dismount/disembark; riding in shop radius shows soft hint only
  if (ctx.aboardKind) {
    const label =
      ctx.aboardKind === 'free_boat'
        ? '靠岸下船'
        : ctx.aboardKind === 'tour_boat'
          ? (ctx.tourDisembarkQueued ? '下一站下船' : '下站下船')
          : '下车'
    const softHint =
      (ctx.aboardKind === 'bike' || ctx.aboardKind === 'bicycle' || ctx.aboardKind === 'car') &&
      (ctx.soloEnabled || ctx.nearShop?.shopId === 'wangcheng_drinks_shop') && !ctx.inQuietZone &&
      (ctx.nearShop || ctx.nearServiceBay)
        ? '先按 F 下车再进店'
        : undefined
    return {
      priority: 2,
      action: 'dismount',
      label,
      disabled: false,
      ...(softHint ? {softHint} : {}),
    }
  }

  // Priority 3: On foot near downed two-wheeler -> pickup first so shop entrance never soft-locks
  if (ctx.nearDownedVehicle && !ctx.nearDownedVehicle.damaged) {
    return {
      priority: 3,
      action: 'pickup_downed',
      label: ctx.nearDownedVehicle.kind === 'bicycle' ? '扶起单车' : '扶起电动车',
      disabled: false,
    }
  }

  // Priority 4: Strict duty priority on foot: handover > fine ticket > talk officer > shop/service > vehicle/boat
  if (ctx.nearTicketHandover) {
    return {
      priority: 4,
      action: 'handover_ticket',
      label: ctx.nearTicketHandover.label,
      disabled: false,
    }
  }
  if (ctx.nearTrafficViolator?.action === 'handover_ticket') {
    return {
      priority: 4,
      action: 'handover_ticket',
      label: ctx.nearTrafficViolator.label,
      disabled: false,
    }
  }
  if (ctx.nearTrafficViolator && ctx.nearTrafficViolator.action !== 'talk_officer') {
    return {
      priority: 4,
      action: 'whistle_cite',
      label: ctx.nearTrafficViolator.label,
      disabled: false,
    }
  }
  if (ctx.nearDutyOfficer) {
    return {
      priority: 4,
      action: 'talk_officer',
      label: ctx.nearDutyOfficer.label,
      disabled: false,
    }
  }
  if (ctx.nearTrafficViolator?.action === 'talk_officer') {
    return {
      priority: 4,
      action: 'talk_officer',
      label: ctx.nearTrafficViolator.label,
      disabled: false,
    }
  }

  if ((ctx.soloEnabled || ctx.nearShop?.shopId === 'wangcheng_drinks_shop') && !ctx.inQuietZone && ctx.nearShop) {
    const label = ctx.nearShop.displayName.startsWith('取杯')
      ? ctx.nearShop.displayName
      : `进店 · ${ctx.nearShop.brandName}`
    return {
      priority: 4,
      action: 'open_shop',
      label,
      disabled: false,
      shopId: ctx.nearShop.shopId,
    }
  }
  if (ctx.soloEnabled && !ctx.inQuietZone && ctx.nearServiceBay) {
    return {
      priority: 4,
      action: 'open_service',
      label: '充电/保养',
      disabled: false,
      shopId: ctx.nearServiceBay.shopId,
    }
  }

  // Priority 5: On foot near mountable vehicle (healthy vehicle always takes precedence over damaged)
  if (ctx.nearVehicle && !ctx.nearVehicle.damaged) {
    const v = ctx.nearVehicle
    // In Solo economy mode, rentable shared e-bikes clearly display the ¥2 unlock fee;
    // Tour mode (no wallet) and personal/bicycle/car keep their original concise prompts.
    const label =
      v.kind === 'car'
        ? '开车'
        : v.kind === 'bicycle'
          ? '骑单车'
          : v.ownership === 'personal'
            ? '骑我的电摩'
            : ctx.soloEnabled && v.ownership !== 'test_ride'
              ? v.alreadyUnlocked
                ? '继续骑共享电车'
                : '解锁共享电动车（¥2）'
              : '骑电动车'
    return {
      priority: 5,
      action: 'mount_vehicle',
      label,
      disabled: false,
      ...(v.ebikeTier ? {ebikeTier: v.ebikeTier} : {}),
      ...(v.ownership ? {ownership: v.ownership} : {}),
    }
  }

  // Priority 6: On foot near water dock / mooring
  if (ctx.nearBoat) {
    return {
      priority: 6,
      action: 'board_boat',
      label: ctx.nearBoat.label,
      disabled: false,
    }
  }

  // Fallback notice when standing beside a damaged shared e-bike with no usable vehicle/boat in reach
  const damagedTarget = ctx.nearDamagedVehicle ?? (ctx.nearVehicle?.damaged ? ctx.nearVehicle : ctx.nearDownedVehicle?.damaged ? ctx.nearDownedVehicle : null)
  if (damagedTarget) {
    return {
      priority: 6,
      action: 'damaged_vehicle',
      label: '已损坏 · 无法骑行',
      disabled: false,
      ebikeTier: 'shared',
      ownership: 'shared',
    }
  }

  return {priority: 7, action: 'none', label: '', disabled: true}
}

export interface InteractArbiterCallbacks {
  startRescue?:(closerThan:number)=>boolean
  stopRescue?:()=>void
  getContext: () => InteractionContext
  onOpenShop: (shopId: string) => void
  onOpenService: (shopId: string) => void
  onHandoverTicket?: () => void
  onTalkOfficer?: () => void
  onWhistleCite?: () => void
  onVehicleOrBoatInteract: () => void
  onDamagedVehicleInteract?: () => void
  onSoftHint?: (text: string) => void
  onDecisionChange?: (decision: InteractionDecision) => void
}

export interface InteractArbiterHandle {
  sync: (buttonEl: HTMLButtonElement | null) => InteractionDecision
  trigger: () => InteractionDecision
  getLastDecision: () => InteractionDecision
  dispose: () => void
}

/**
 * Single runtime `[F]` keyboard & `.vehicle-action` click coordinator.
 */
export function createInteractArbiter(callbacks: InteractArbiterCallbacks): InteractArbiterHandle {
  let lastDecision: InteractionDecision = {priority: 0, action: 'none', label: '', disabled: true}
  let lastSoftHintAt = 0
  let lastSoftHintText = ''

  function applyButton(buttonEl: HTMLButtonElement | null, decision: InteractionDecision): void {
    if (!buttonEl) return
    if (decision.ebikeTier) buttonEl.dataset.ebikeTier = decision.ebikeTier
    else delete buttonEl.dataset.ebikeTier
    if (decision.ownership) buttonEl.dataset.ownership = decision.ownership
    else delete buttonEl.dataset.ownership
    buttonEl.dataset.interactAction = decision.action
    buttonEl.hidden = !decision.label
    if (buttonEl.textContent !== decision.label) buttonEl.textContent = decision.label
  }

  function sync(buttonEl: HTMLButtonElement | null): InteractionDecision {
    const decision = resolveInteraction(callbacks.getContext())
    applyButton(buttonEl, decision)
    if (decision.softHint) {
      const now = performance.now()
      if (decision.softHint !== lastSoftHintText || now - lastSoftHintAt > 4500) {
        lastSoftHintText = decision.softHint
        lastSoftHintAt = now
        callbacks.onSoftHint?.(decision.softHint)
      }
    } else {
      lastSoftHintText = ''
    }
    if (
      decision.action !== lastDecision.action ||
      decision.label !== lastDecision.label ||
      decision.shopId !== lastDecision.shopId
    ) {
      lastDecision = decision
      callbacks.onDecisionChange?.(decision)
    } else {
      lastDecision = decision
    }
    return decision
  }

  function trigger(): InteractionDecision {
    const decision = resolveInteraction(callbacks.getContext())
    lastDecision = decision
    if (decision.disabled || decision.action === 'none' || decision.action === 'pickup_busy') {
      return decision
    }
    if (decision.action === 'open_shop' && decision.shopId) {
      callbacks.onOpenShop(decision.shopId)
      return decision
    }
    if (decision.action === 'open_service' && decision.shopId) {
      callbacks.onOpenService(decision.shopId)
      return decision
    }
    if (decision.action === 'handover_ticket') {
      if (callbacks.onHandoverTicket) callbacks.onHandoverTicket()
      else callbacks.onWhistleCite?.()
      return decision
    }
    if (decision.action === 'talk_officer') {
      if (callbacks.onTalkOfficer) callbacks.onTalkOfficer()
      else callbacks.onWhistleCite?.()
      return decision
    }
    if (decision.action === 'whistle_cite') {
      callbacks.onWhistleCite?.()
      return decision
    }
    if (decision.action === 'damaged_vehicle') {
      callbacks.onDamagedVehicleInteract?.()
      return decision
    }
    callbacks.onVehicleOrBoatInteract()
    return decision
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const dutyBlocksRescueKey = isDutyScopeActive() && (hits(event.code, 'dutyFlag') || hits(event.code, 'dutyWhistle') || event.code === 'KeyE')
    if (hits(event.code, 'rescue') && !dutyBlocksRescueKey && !event.repeat && !isGlobalHotkeyBlocked(event.target)) {
      let closerThan = Infinity
      if (hits(event.code, 'interact')) {
        const ctx = callbacks.getContext()
        const decision = resolveInteraction(ctx)
        const candidates = {pickup_downed:ctx.nearDownedVehicle,open_shop:ctx.nearShop,
          open_service:ctx.nearServiceBay,mount_vehicle:ctx.nearVehicle,board_boat:ctx.nearBoat}
        const action = decision.action
        if (action in candidates) closerThan = candidates[action as keyof typeof candidates]?.distance ?? Infinity
      }
      if (callbacks.startRescue?.(closerThan)) {event.preventDefault();return}
    }
    if (!hits(event.code, 'interact') || event.repeat) return
    if (isGlobalHotkeyBlocked(event.target)) return
    const decision = trigger()
    if (decision.action !== 'none') {
      event.preventDefault()
    }
  }

  const release=(e:KeyboardEvent)=>{
    if(isDutyScopeActive()&&(hits(e.code,'dutyFlag')||hits(e.code,'dutyWhistle')||e.code==='KeyE'))return
    if(hits(e.code,'rescue'))callbacks.stopRescue?.()
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('keyup',release)
    window.addEventListener('keydown', onKeyDown)
  }

  return {
    sync,
    trigger,
    getLastDecision: () => lastDecision,
    dispose: () => {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('keyup',release)
        window.removeEventListener('keydown', onKeyDown)
      }
    },
  }
}
