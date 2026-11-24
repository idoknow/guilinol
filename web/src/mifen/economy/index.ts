export {
  createEconomyEventBus,
  ECONOMY_UI_SLOTS,
  type EconomyEventBus,
  type EconomyEventMap,
  type EconomyEventName,
  type EconomyListener,
  type EconomyUiActionSlot,
  type EconomyUiStatSlot,
} from './events.ts'

export {
  ALL_INGREDIENTS,
  DEFAULT_INVENTORY_ITEMS,
  resolveInventoryItems,
  getIngredientCap,
  getRecipeIngredients,
  consumeStockForRecipe,
  consumeStockStrict,
  quoteRestock,
  applyRestock,
  computeOvernightSpoilage,
  getLowStockIngredients,
  type ConsumeStockResult,
  type DirectConsumeResult,
  type RestockQuote,
  type RestockResult,
  type SpoilageReport,
} from './inventory.ts'

export {
  DEFAULT_ECONOMY_CONFIG,
  resolveEconomyConfig,
  getDayPhase,
  getReputationTrafficMultiplier,
  getTimeAndTrafficModifiers,
  computeQueuePatienceRate,
  computeComboTipRate,
  settleDineInOrder,
  type MorningRushModifiers,
  type DineInOrderInput,
  type DineInSettlementResult,
} from './rush.ts'

export {
  DEFAULT_DELIVERY_ZONES,
  resolveDeliveryZones,
  getDailyDeliveryQuota,
  computeDeliveryFee,
  quoteDeliveryOrder,
  settleDeliveryOrder,
  type QuoteDeliveryInput,
  type SettleDeliveryInput,
  type DeliverySettlementResult,
} from './delivery.ts'

export {
  DEFAULT_RETAIL_SKUS,
  resolveRetailSkus,
  getRetailConversionRate,
  getRetailUnitPrice,
  getRetailUnitMargin,
  settleRetailSale,
  type RetailSaleInput,
  type RetailSaleResult,
} from './retail.ts'

export {
  getFixedDailyOverhead,
  computeStreamShares,
  checkRevenueStreamBalance,
  settleBusinessDay,
  type CloseDayInput,
  type CloseDayResult,
  type BalanceCheckResult,
} from './settlement.ts'

export {
  DEFAULT_ACHIEVEMENTS,
  resolveAchievements,
  readAchievementMetric,
  evaluateAchievements,
  isRecipeUnlocked,
  getAvailableRecipes,
  type AchievementEvalResult,
} from './achievements.ts'

export {
  createMifenEconomy,
  type MifenEconomyEngine,
  type EconomyDashboardSnapshot,
  type UiSlotRuntimeState,
} from './engine.ts'

export {
  simulateThreeDays,
  type ThreeDaySimulationReport,
} from './simulate.ts'
