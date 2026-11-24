import type {
  DailyLedgerRecord,
  DayPhase,
  DeliveryOrder,
  DeliveryPackStyle,
  IngredientKey,
  MifenRecipesData,
  MifenRecipe,
  ShopLevel,
} from '../types.ts'
import {
  computeShopBonuses,
  createEmptyDailyAccumulators,
  roundMoney,
  type MifenSaveState,
  type MifenStore,
} from '../state.ts'
import {
  createEconomyEventBus,
  ECONOMY_UI_SLOTS,
  type EconomyEventBus,
  type EconomyUiActionSlot,
} from './events.ts'
import {
  applyRestock,
  getLowStockIngredients,
  quoteRestock,
  resolveInventoryItems,
  type RestockQuote,
  type RestockResult,
} from './inventory.ts'
import {
  computeQueuePatienceRate,
  getTimeAndTrafficModifiers,
  resolveEconomyConfig,
  settleDineInOrder,
  type DineInSettlementResult,
  type MorningRushModifiers,
} from './rush.ts'
import {
  getDailyDeliveryQuota,
  quoteDeliveryOrder,
  resolveDeliveryZones,
  settleDeliveryOrder,
  type DeliverySettlementResult,
} from './delivery.ts'
import {
  getRetailConversionRate,
  resolveRetailSkus,
  settleRetailSale,
  type RetailSaleResult,
} from './retail.ts'
import { settleBusinessDay, type CloseDayResult } from './settlement.ts'
import { evaluateAchievements, getAvailableRecipes, resolveAchievements } from './achievements.ts'

export interface UiSlotRuntimeState {
  slot: EconomyUiActionSlot
  ready: boolean
  ariaLabel: string
  badgeCount: number
}

export interface EconomyDashboardSnapshot {
  day: number
  phase: DayPhase
  isMorningRush: boolean
  trafficMultiplier: number
  rushPremiumRate: number
  funds: number
  reputation: number
  shopLevel: ShopLevel
  deliveryQuotaUsed: number
  deliveryQuotaMax: number
  activeDeliveries: DeliveryOrder[]
  lowStock: IngredientKey[]
  retailConversionRate: number
  availableRecipes: MifenRecipe[]
  uiSlots: UiSlotRuntimeState[]
}

export interface MifenEconomyEngine {
  readonly events: EconomyEventBus
  getState(): Readonly<MifenSaveState>
  getTimeModifiers(hour: number): MorningRushModifiers
  getQueuePatienceRate(queueLength: number): number
  getAvailableRecipes(): MifenRecipe[]
  getRestockQuote(item: IngredientKey, batches?: number): RestockQuote
  getDashboardSnapshot(hour: number): EconomyDashboardSnapshot
  recordDineInSale(params: {
    recipeId: string
    stars: 1 | 2 | 3
    hour: number
    guoshaoFreshness?: number
    matchedCondimentRatio?: number
  }): DineInSettlementResult | null
  acceptDeliveryOrder(params: {
    recipeId: string
    zoneId: string
    packStyle?: DeliveryPackStyle
  }): DeliveryOrder | null
  completeDeliveryOrder(params: {
    orderId: string
    elapsedSec: number
    stars: 1 | 2 | 3
  }): DeliverySettlementResult | null
  sellRetailSku(skuId: string, quantity?: number): RetailSaleResult | null
  restock(item: IngredientKey, batches?: number): RestockResult
  closeDay(): CloseDayResult
  syncHour(hour: number): DayPhase
}

export function createMifenEconomy(
  store: MifenStore,
  recipesData: MifenRecipesData,
): MifenEconomyEngine {
  const events = createEconomyEventBus()
  const cfg = resolveEconomyConfig(recipesData.economyConfig)
  const invItems = resolveInventoryItems(recipesData.inventoryItems)
  const zones = resolveDeliveryZones(recipesData.deliveryZones)
  const skus = resolveRetailSkus(recipesData.retailSkus)
  const achievements = resolveAchievements(recipesData.achievements)

  const activeDeliveries = new Map<string, DeliveryOrder>()
  const retailSoldBySku = new Map<string, number>()
  let orderSeq = 0
  let lastPhase: DayPhase | null = null

  function bonusesOf(state: Readonly<MifenSaveState>) {
    return computeShopBonuses(state, recipesData.upgrades ?? [])
  }

  function runAchievementCheck(): void {
    const snap = store.getState()
    const evalRes = evaluateAchievements(snap, achievements)
    if (evalRes.newlyUnlocked.length === 0) return

    store.updateState(draft => {
      for (const ach of evalRes.newlyUnlocked) {
        if (!draft.unlockedAchievements.includes(ach.id)) {
          draft.unlockedAchievements.push(ach.id)
        }
        draft.funds = roundMoney(draft.funds + ach.rewardFunds)
      }
      for (const rid of evalRes.unlockedRecipeIds) {
        if (!draft.unlockedRecipes.includes(rid)) {
          draft.unlockedRecipes.push(rid)
        }
      }
    })

    for (const ach of evalRes.newlyUnlocked) {
      events.emit('achievement:unlocked', { achievement: ach, rewardFunds: ach.rewardFunds })
      if (ach.unlocksRecipeId && evalRes.unlockedRecipeIds.includes(ach.unlocksRecipeId)) {
        events.emit('recipe:unlocked', { recipeId: ach.unlocksRecipeId, byAchievementId: ach.id })
      }
    }
  }

  function emitLowStockIfAny(state: Readonly<MifenSaveState>): void {
    const low = getLowStockIngredients(state.inventory)
    if (low.length > 0) {
      events.emit('inventory:low', { items: low })
    }
  }

  return {
    events,

    getState() {
      return store.getState()
    },

    getTimeModifiers(hour) {
      return getTimeAndTrafficModifiers(hour, store.getState().reputation, cfg)
    },

    getQueuePatienceRate(queueLength) {
      const state = store.getState()
      const bonuses = bonusesOf(state)
      return computeQueuePatienceRate(queueLength, bonuses.patienceMultiplier)
    },

    getAvailableRecipes() {
      return getAvailableRecipes(recipesData.recipes, store.getState().unlockedRecipes)
    },

    getRestockQuote(item, batches = 1) {
      const state = store.getState()
      return quoteRestock(state.inventory, item, batches, state.shopLevel, bonusesOf(state), invItems)
    },

    syncHour(hour) {
      const mod = getTimeAndTrafficModifiers(hour, store.getState().reputation, cfg)
      if (mod.phase !== lastPhase) {
        lastPhase = mod.phase
        events.emit('rush:phase_changed', {
          phase: mod.phase,
          hour,
          trafficMultiplier: mod.trafficMultiplier,
          premiumRate: mod.premiumRate,
        })
      }
      return mod.phase
    },

    recordDineInSale({ recipeId, stars, hour, guoshaoFreshness, matchedCondimentRatio }) {
      const recipe = recipesData.recipes.find(r => r.id === recipeId)
      if (!recipe) return null
      const before = store.getState()
      const bonuses = bonusesOf(before)
      const res = settleDineInOrder({
        recipe,
        stars,
        streak: before.streak,
        hour,
        reputation: before.reputation,
        shopLevel: before.shopLevel,
        inventory: before.inventory,
        guoshaoFreshness,
        matchedCondimentRatio,
        bonuses,
        inventoryItems: invItems,
        config: cfg,
      })

      const nextState = store.updateState(draft => {
        draft.inventory = res.stockResult.nextInventory
        draft.funds = roundMoney(draft.funds + res.net)
        draft.totalRevenue = roundMoney(draft.totalRevenue + res.gross)
        draft.totalBowlsServed += 1
        draft.dailyServed += 1
        if (stars === 3) draft.perfectBowls += 1
        draft.streak = res.nextStreak
        draft.reputation = Math.round(Math.min(5.0, Math.max(1.0, draft.reputation + res.reputationDelta)) * 100) / 100
        draft.today.dineInBowls += 1
        draft.today.dineInGross = roundMoney(draft.today.dineInGross + res.gross)
        draft.today.dineInNet = roundMoney(draft.today.dineInNet + res.net)
        draft.today.emergencyBrineCost = roundMoney(draft.today.emergencyBrineCost + res.stockResult.emergencyBrineCost)
        if (res.isMorningRush) draft.today.rushServed += 1
      })

      events.emit('dine_in:settled', {
        recipeId: recipe.id,
        stars,
        gross: res.gross,
        rawCost: res.rawCost,
        tip: res.tip,
        net: res.net,
        usedEmergencyBrine: res.stockResult.usedEmergencyBrine,
        isMorningRush: res.isMorningRush,
        streak: res.nextStreak,
      })
      emitLowStockIfAny(nextState)
      runAchievementCheck()
      return res
    },

    acceptDeliveryOrder({ recipeId, zoneId, packStyle = 'separated' }) {
      const recipe = recipesData.recipes.find(r => r.id === recipeId)
      const zone = zones.find(z => z.id === zoneId)
      if (!recipe || !zone) return null
      const state = store.getState()
      const quota = getDailyDeliveryQuota(state.shopLevel, bonusesOf(state), cfg)
      if (state.today.deliveriesCompleted + activeDeliveries.size >= quota) return null

      orderSeq += 1
      const order = quoteDeliveryOrder({
        id: `dlv_${state.day}_${orderSeq}`,
        recipe,
        zone,
        packStyle,
        bonuses: bonusesOf(state),
        config: cfg,
      })
      const accepted: DeliveryOrder = { ...order, status: 'delivering' }
      activeDeliveries.set(accepted.id, accepted)
      events.emit('delivery:accepted', { order: accepted })
      return accepted
    },

    completeDeliveryOrder({ orderId, elapsedSec, stars }) {
      const order = activeDeliveries.get(orderId)
      if (!order) return null
      const recipe = recipesData.recipes.find(r => r.id === order.recipeId)
      if (!recipe) return null
      activeDeliveries.delete(orderId)

      const before = store.getState()
      const bonuses = bonusesOf(before)
      const res = settleDeliveryOrder({
        order,
        recipe,
        elapsedSec,
        stars,
        deliveriesDoneToday: before.today.deliveriesCompleted,
        shopLevel: before.shopLevel,
        inventory: before.inventory,
        bonuses,
        inventoryItems: invItems,
        config: cfg,
      })

      if (!res.ok) return res

      const nextState = store.updateState(draft => {
        draft.inventory = res.stockResult.nextInventory
        draft.funds = Math.max(0, roundMoney(draft.funds + res.net))
        draft.totalRevenue = roundMoney(draft.totalRevenue + res.gross)
        draft.reputation = Math.round(Math.min(5.0, Math.max(1.0, draft.reputation + res.reputationDelta)) * 100) / 100
        draft.today.deliveryGross = roundMoney(draft.today.deliveryGross + res.gross)
        draft.today.deliveryNet = roundMoney(draft.today.deliveryNet + res.net)
        draft.today.emergencyBrineCost = roundMoney(draft.today.emergencyBrineCost + res.stockResult.emergencyBrineCost)
        if (res.onTime) {
          draft.today.deliveriesCompleted += 1
          draft.totalDeliveries += 1
        } else {
          draft.today.deliveriesFailed += 1
        }
      })

      if (res.onTime) {
        events.emit('delivery:completed', {
          order: res.completedOrder,
          onTime: true,
          gross: res.gross,
          commission: res.commission,
          packCost: res.packCost,
          rawCost: res.rawCost,
          tip: res.tip,
          penalty: res.penalty,
          net: res.net,
          reputationDelta: res.reputationDelta,
        })
      } else {
        events.emit('delivery:failed', {
          order: res.completedOrder,
          penalty: res.penalty,
          reputationDelta: res.reputationDelta,
        })
      }

      emitLowStockIfAny(nextState)
      runAchievementCheck()
      return res
    },

    sellRetailSku(skuId, quantity = 1) {
      const sku = skus.find(s => s.id === skuId)
      if (!sku) return null
      const before = store.getState()
      const soldToday = retailSoldBySku.get(sku.id) ?? 0
      const res = settleRetailSale({
        sku,
        quantity,
        shopLevel: before.shopLevel,
        inventory: before.inventory,
        soldTodayForSku: soldToday,
        bonuses: bonusesOf(before),
      })

      if (!res.ok) return res
      retailSoldBySku.set(sku.id, soldToday + res.quantitySold)

      const nextState = store.updateState(draft => {
        draft.inventory = res.nextInventory
        draft.funds = roundMoney(draft.funds + res.net)
        draft.totalRevenue = roundMoney(draft.totalRevenue + res.gross)
        draft.totalRetailSold += res.quantitySold
        draft.today.retailGross = roundMoney(draft.today.retailGross + res.gross)
        draft.today.retailNet = roundMoney(draft.today.retailNet + res.net)
        draft.today.retailUnitsSold += res.quantitySold
      })

      events.emit('retail:sold', {
        skuId: sku.id,
        skuName: sku.name,
        quantity: res.quantitySold,
        gross: res.gross,
        cost: res.cost,
        net: res.net,
      })
      emitLowStockIfAny(nextState)
      runAchievementCheck()
      return res
    },

    restock(item, batches = 1) {
      const before = store.getState()
      const res = applyRestock(
        before.inventory,
        before.funds,
        item,
        batches,
        before.shopLevel,
        bonusesOf(before),
        invItems,
      )
      if (!res.ok) return res

      store.updateState(draft => {
        draft.inventory = res.nextInventory
        draft.funds = res.fundsAfter
        draft.today.restockSpend = roundMoney(draft.today.restockSpend + res.quote.totalCost)
      })

      events.emit('inventory:restocked', {
        item,
        quantity: res.quote.actualUnits,
        cost: res.quote.totalCost,
        stockAfter: res.nextInventory[item],
      })
      return res
    },

    closeDay() {
      const before = store.getState()
      const res = settleBusinessDay({
        day: before.day,
        shopLevel: before.shopLevel,
        funds: before.funds,
        reputation: before.reputation,
        today: before.today,
        inventory: before.inventory,
        bonuses: bonusesOf(before),
        inventoryItems: invItems,
        config: cfg,
      })

      activeDeliveries.clear()
      retailSoldBySku.clear()

      store.updateState(draft => {
        draft.day = res.nextDay
        draft.funds = res.nextFunds
        draft.inventory = res.nextInventory
        draft.dailyServed = 0
        draft.dailyNetPeak = Math.max(draft.dailyNetPeak, res.ledger.totalNetProfit)
        if (res.threeStreamsPositive) draft.threeStreamsDays += 1
        draft.today = createEmptyDailyAccumulators()
        draft.dailyHistory = [...draft.dailyHistory.slice(-13), res.ledger]
      })

      events.emit('day:settled', { ledger: res.ledger })
      runAchievementCheck()
      return res
    },

    getDashboardSnapshot(hour) {
      const state = store.getState()
      const bonuses = bonusesOf(state)
      const timeMod = getTimeAndTrafficModifiers(hour, state.reputation, cfg)
      const deliveryQuotaMax = getDailyDeliveryQuota(state.shopLevel, bonuses, cfg)
      const lowStock = getLowStockIngredients(state.inventory)
      const availableRecipes = getAvailableRecipes(recipesData.recipes, state.unlockedRecipes)
      const deliveryRemaining = Math.max(0, deliveryQuotaMax - state.today.deliveriesCompleted)
      const retailReady = state.inventory.brine >= 8 || state.inventory.guoshao >= 6 || state.inventory.condiment >= 6
      const ledgerReady = state.today.dineInBowls > 0 || state.today.deliveriesCompleted > 0 || state.today.retailUnitsSold > 0

      const uiSlots: UiSlotRuntimeState[] = ECONOMY_UI_SLOTS.actions.map(slot => {
        let ready = false
        let badgeCount = 0
        if (slot.id === 'delivery') {
          ready = deliveryRemaining > 0 && timeMod.phase !== 'closed'
          badgeCount = activeDeliveries.size
        } else if (slot.id === 'retail') {
          ready = retailReady
          badgeCount = state.today.retailUnitsSold
        } else if (slot.id === 'restock') {
          ready = lowStock.length > 0
          badgeCount = lowStock.length
        } else if (slot.id === 'ledger') {
          ready = ledgerReady
          badgeCount = state.day
        }
        return {
          slot,
          ready,
          ariaLabel: ready ? slot.readyAriaLabel : slot.idleAriaLabel,
          badgeCount,
        }
      })

      return {
        day: state.day,
        phase: timeMod.phase,
        isMorningRush: timeMod.isMorningRush,
        trafficMultiplier: timeMod.trafficMultiplier,
        rushPremiumRate: timeMod.premiumRate,
        funds: state.funds,
        reputation: state.reputation,
        shopLevel: state.shopLevel,
        deliveryQuotaUsed: state.today.deliveriesCompleted,
        deliveryQuotaMax,
        activeDeliveries: Array.from(activeDeliveries.values()),
        lowStock,
        retailConversionRate: getRetailConversionRate(state.reputation),
        availableRecipes,
        uiSlots,
      }
    },
  }
}

export type { DailyLedgerRecord }
