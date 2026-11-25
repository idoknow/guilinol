import { defaultDrinkCustomization, DRINKS_MENU, getDrinkById, type DrinkCatalogItem } from '../menu/menu.ts'
import type { DrinkHoldSession } from '../hold/hold-controller.ts'
import type { StaffWorkflowEvent } from '../staff/index.ts'

export interface StaffToHoldBridgeOptions {
  readonly drainStaffEvents: () => StaffWorkflowEvent[]
  readonly holdSession: DrinkHoldSession
  readonly onCupHandedOff?: (item: DrinkCatalogItem, ticketNo: string) => void
}

export interface StaffToHoldBridge {
  /** 消费并桥接员工工作台事件：当完成整套工序并执行「出杯叫号」时，自动将自制饮品交到玩家手中供长按饮用 */
  flush(): number
  getHandedOffCount(): number
  reset(): void
}

export function createStaffToHoldBridge(opts: StaffToHoldBridgeOptions): StaffToHoldBridge {
  let handedOffCount = 0
  let lastHandedTicketNo: string | null = null

  return {
    flush(): number {
      const events = opts.drainStaffEvents()
      if (events.length === 0) return 0
      let deliveredNow = 0
      for (const ev of events) {
        if (ev.type !== 'order_called') continue
        const ticketNo = ev.ticketNo ?? `S${handedOffCount + 1}`
        if (ticketNo === lastHandedTicketNo) continue
        const holdSnap = opts.holdSession.getSnapshot()
        if (holdSnap.active) continue
        const item = (ev.itemId ? getDrinkById(ev.itemId) : undefined) ?? DRINKS_MENU[0]
        if (!item) continue
        lastHandedTicketNo = ticketNo
        handedOffCount += 1
        deliveredNow += 1
        opts.holdSession.pickup(item, defaultDrinkCustomization(item), `staff_${ticketNo}`)
        opts.onCupHandedOff?.(item, ticketNo)
      }
      return deliveredNow
    },
    getHandedOffCount: () => handedOffCount,
    reset() {
      lastHandedTicketNo = null
    },
  }
}
