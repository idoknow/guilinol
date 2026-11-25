import type {
  AchievementDef,
  DailyLedgerRecord,
  DayPhase,
  DeliveryOrder,
  IngredientKey,
  RevenueStream,
  ShopLevel,
} from '../types.ts'

export interface EconomyEventMap {
  'dine_in:settled': {
    recipeId: string
    stars: 1 | 2 | 3
    gross: number
    rawCost: number
    tip: number
    net: number
    usedEmergencyBrine: boolean
    isMorningRush: boolean
    streak: number
  }
  'delivery:accepted': { order: DeliveryOrder }
  'delivery:completed': {
    order: DeliveryOrder
    onTime: boolean
    gross: number
    commission: number
    packCost: number
    rawCost: number
    tip: number
    penalty: number
    net: number
    reputationDelta: number
  }
  'delivery:failed': {
    order: DeliveryOrder
    penalty: number
    reputationDelta: number
  }
  'retail:sold': {
    skuId: string
    skuName: string
    quantity: number
    gross: number
    cost: number
    net: number
  }
  'inventory:restocked': {
    item: IngredientKey
    quantity: number
    cost: number
    stockAfter: number
  }
  'inventory:low': {
    items: IngredientKey[]
  }
  'rush:phase_changed': {
    phase: DayPhase
    hour: number
    trafficMultiplier: number
    premiumRate: number
  }
  'day:settled': {
    ledger: DailyLedgerRecord
  }
  'achievement:unlocked': {
    achievement: AchievementDef
    rewardFunds: number
  }
  'recipe:unlocked': {
    recipeId: string
    byAchievementId: string
  }
  'shop:upgraded': {
    shopLevel: ShopLevel
  }
}

export type EconomyEventName = keyof EconomyEventMap
export type EconomyListener<K extends EconomyEventName> = (payload: EconomyEventMap[K]) => void

export interface EconomyEventBus {
  on<K extends EconomyEventName>(event: K, listener: EconomyListener<K>): () => void
  emit<K extends EconomyEventName>(event: K, payload: EconomyEventMap[K]): void
  clear(): void
}

export function createEconomyEventBus(): EconomyEventBus {
  const map = new Map<EconomyEventName, Set<EconomyListener<EconomyEventName>>>()

  return {
    on(event, listener) {
      let set = map.get(event)
      if (!set) {
        set = new Set()
        map.set(event, set)
      }
      set.add(listener as EconomyListener<EconomyEventName>)
      return () => {
        set?.delete(listener as EconomyListener<EconomyEventName>)
      }
    },
    emit(event, payload) {
      const set = map.get(event)
      if (!set || set.size === 0) return
      for (const fn of Array.from(set)) {
        try {
          ;(fn as EconomyListener<typeof event>)(payload)
        } catch {
          // Keep subscribers isolated
        }
      }
    },
    clear() {
      map.clear()
    },
  }
}

/**
 * 严格遵循 docs/design-rules.md 的 UI 挂点契约（零 DOM 创建，仅输出给 index.ts / 整合层渲染）：
 * - 经营条入口：.mifen-btn + data-hud-action="<id>"，两字动词/名词，无 emoji
 * - 读屏数字：.mifen-stat + data-mf-stat="<key>"
 * - 面板：.mifen-panel + data-mifen-panel="<id>"
 */
export interface EconomyUiActionSlot {
  readonly id: 'delivery' | 'retail' | 'restock' | 'ledger'
  readonly hudAction: string
  readonly panelKey: string
  readonly label: string
  readonly readyAriaLabel: string
  readonly idleAriaLabel: string
}

export interface EconomyUiStatSlot {
  readonly key: 'day' | 'phase' | 'brine'
  readonly srLabel: string
}

export const ECONOMY_UI_SLOTS: {
  readonly actions: readonly EconomyUiActionSlot[]
  readonly stats: readonly EconomyUiStatSlot[]
  readonly streamLabels: Readonly<Record<RevenueStream, string>>
} = {
  actions: [
    {
      id: 'delivery',
      hudAction: 'open-delivery',
      panelKey: 'delivery',
      label: '外卖',
      readyAriaLabel: '外卖，有待接单',
      idleAriaLabel: '外卖',
    },
    {
      id: 'retail',
      hudAction: 'open-retail',
      panelKey: 'retail',
      label: '外售',
      readyAriaLabel: '外售，可分装卤水与小料',
      idleAriaLabel: '外售',
    },
    {
      id: 'restock',
      hudAction: 'open-restock',
      panelKey: 'restock',
      label: '进货',
      readyAriaLabel: '进货，库存偏低',
      idleAriaLabel: '进货',
    },
    {
      id: 'ledger',
      hudAction: 'open-ledger',
      panelKey: 'ledger',
      label: '账本',
      readyAriaLabel: '账本，可结本日营收',
      idleAriaLabel: '账本',
    },
  ],
  stats: [
    { key: 'day', srLabel: '营业日' },
    { key: 'phase', srLabel: '时段' },
    { key: 'brine', srLabel: '老卤余量' },
  ],
  streamLabels: {
    dine_in: '堂食',
    delivery: '外卖',
    retail: '外售',
  },
}
