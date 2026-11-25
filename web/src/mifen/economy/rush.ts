import type {
  DayPhase,
  InventoryItemDef,
  InventoryStock,
  MifenEconomyConfig,
  MifenRecipe,
  ShopLevel,
} from '../types.ts'
import { roundMoney, type ShopEquipmentBonuses } from '../state.ts'
import { consumeStockForRecipe, type ConsumeStockResult } from './inventory.ts'

export const DEFAULT_ECONOMY_CONFIG: MifenEconomyConfig = {
  morningRushStartHour: 6.5,
  morningRushEndHour: 9.5,
  morningRushTrafficMultiplier: 2.0,
  morningRushPremiumRate: 0.15,
  morningRushZeroDropBonusRate: 0.15,
  rawCostRateNormal: 0.28,
  rawCostRateEmergencyBrine: 0.36,
  deliveryMarkupRate: 0.15,
  deliveryPlatformCommissionRate: 0.18,
  deliverySeparatedPackCost: 1.2,
  deliveryMixedPenalty: 1.5,
  deliveryDailyQuotaByLevel: { '1': 8, '2': 12, '3': 18 },
  fixedDailyOverheadByLevel: { '1': 8, '2': 14, '3': 22 },
}

export function resolveEconomyConfig(cfg?: Partial<MifenEconomyConfig>): MifenEconomyConfig {
  return {
    ...DEFAULT_ECONOMY_CONFIG,
    ...(cfg ?? {}),
    deliveryDailyQuotaByLevel: {
      ...DEFAULT_ECONOMY_CONFIG.deliveryDailyQuotaByLevel,
      ...(cfg?.deliveryDailyQuotaByLevel ?? {}),
    },
    fixedDailyOverheadByLevel: {
      ...DEFAULT_ECONOMY_CONFIG.fixedDailyOverheadByLevel,
      ...(cfg?.fixedDailyOverheadByLevel ?? {}),
    },
  }
}

export function getDayPhase(hour: number, cfg?: Partial<MifenEconomyConfig>): DayPhase {
  const c = resolveEconomyConfig(cfg)
  const h = ((hour % 24) + 24) % 24
  if (h >= 5.5 && h < c.morningRushStartHour) return 'prep'
  if (h >= c.morningRushStartHour && h < c.morningRushEndHour) return 'morning_rush'
  if (h >= c.morningRushEndHour && h < 14.0) return 'midday'
  if (h >= 14.0 && h < 17.5) return 'afternoon'
  if (h >= 17.5 && h < 23.0) return 'evening'
  return 'closed'
}

export interface MorningRushModifiers {
  phase: DayPhase
  isMorningRush: boolean
  trafficMultiplier: number
  premiumRate: number
}

/**
 * 口碑分 (1.0 ~ 5.0) 对客流倍率的影响：
 * 4.2 星基准为 1.0x，低于 3.0 星明显掉客，4.8~5.0 星客流最高 +24%。
 */
export function getReputationTrafficMultiplier(reputation: number): number {
  const clamped = Math.min(5.0, Math.max(1.0, reputation))
  const raw = 1.0 + (clamped - 4.2) * 0.28
  return Math.round(Math.min(1.3, Math.max(0.55, raw)) * 100) / 100
}

/**
 * 早市高峰（06:30–09:30）：客流翻倍 (2.0x) + 早市溢价 (+15%)，同时叠加口碑分客流系数。
 */
export function getTimeAndTrafficModifiers(
  hour: number,
  reputation: number,
  cfg?: Partial<MifenEconomyConfig>,
): MorningRushModifiers {
  const c = resolveEconomyConfig(cfg)
  const phase = getDayPhase(hour, c)
  const repMult = getReputationTrafficMultiplier(reputation)

  if (phase === 'morning_rush') {
    return {
      phase,
      isMorningRush: true,
      trafficMultiplier: Math.round(c.morningRushTrafficMultiplier * repMult * 100) / 100,
      premiumRate: c.morningRushPremiumRate,
    }
  }
  const baseTraffic = phase === 'midday' ? 1.15 : phase === 'evening' ? 1.25 : phase === 'afternoon' ? 0.8 : 0.5
  return {
    phase,
    isMorningRush: false,
    trafficMultiplier: Math.round(baseTraffic * repMult * 100) / 100,
    premiumRate: 0,
  }
}

/**
 * PlateUp! 队列复利耐心消耗速率：每多 1 位排队客，消耗速率 × 1.10；
 * 拥有分色粉票速印机（patienceMultiplier = 1.3）可显著缓解拥挤惩罚。
 */
export function computeQueuePatienceRate(queueLength: number, patienceMultiplier = 1.0): number {
  const extra = Math.max(0, Math.floor(queueLength) - 1)
  const safeMult = Math.max(0.5, patienceMultiplier)
  return Math.round((Math.pow(1.1, extra) / safeMult) * 1000) / 1000
}

/**
 * Overcooked! 2 按序出碗连击小费率：每连击 +5%，6 连封顶 +30%（叠品相最高封顶 45%）。
 */
export function computeComboTipRate(streak: number, tipBonusRatio = 0): number {
  const k = Math.max(0, Math.min(6, Math.floor(streak)))
  return Math.min(0.45, Math.round((0.05 * k + Math.max(0, tipBonusRatio) * 0.5) * 1000) / 1000)
}

export interface DineInOrderInput {
  recipe: MifenRecipe
  stars: 1 | 2 | 3
  streak: number
  hour: number
  reputation: number
  shopLevel: ShopLevel
  inventory: Readonly<InventoryStock>
  guoshaoFreshness?: number // 0..1，>0.7 触发脆皮锅烧 +8% 溢价
  matchedCondimentRatio?: number // 0..1，小料偏好匹配度
  bonuses?: ShopEquipmentBonuses
  inventoryItems?: readonly InventoryItemDef[]
  config?: Partial<MifenEconomyConfig>
}

export interface DineInSettlementResult {
  gross: number
  rawCost: number
  tip: number
  flavorBonus: number
  rushPremium: number
  net: number
  reputationDelta: number
  nextStreak: number
  isMorningRush: boolean
  stockResult: ConsumeStockResult
}

/**
 * 堂食单碗完整结算（融合玩法 1 早市高峰连击 + 玩法 2 锅烧脆度与老卤风味溢价 + 库存原料成本）。
 */
export function settleDineInOrder(input: DineInOrderInput): DineInSettlementResult {
  const cfg = resolveEconomyConfig(input.config)
  const timeMod = getTimeAndTrafficModifiers(input.hour, input.reputation, cfg)
  const shopMult = input.bonuses?.priceMultiplier ?? (input.shopLevel === 3 ? 1.35 : input.shopLevel === 2 ? 1.15 : 1.0)
  const tipQualityScale = input.stars === 3 ? 0.8 : input.stars === 2 ? 0.5 : 0

  const stockResult = consumeStockForRecipe(input.inventory, input.recipe, input.inventoryItems, cfg)

  const baseGross = input.recipe.price * shopMult + (input.bonuses?.priceBonusFlat ?? 0)
  const rushPremium = timeMod.isMorningRush ? roundMoney(baseGross * timeMod.premiumRate) : 0

  const nextStreak = input.stars >= 2 ? input.streak + 1 : 0
  const comboRate = input.stars >= 2 ? computeComboTipRate(nextStreak, input.bonuses?.tipBonusRatio ?? 0) : 0
  const tip = roundMoney(input.recipe.price * tipQualityScale * comboRate)

  const freshFlag = (input.guoshaoFreshness ?? 0.85) > 0.7 && input.recipe.requiredMeats.includes('guoshao') ? 1 : 0
  const condimentMatch = Math.max(0, Math.min(1, input.matchedCondimentRatio ?? 0.5))
  const repScale = 0.85 + 0.05 * Math.min(5.0, Math.max(1.0, input.reputation))
  const flavorBonus =
    input.stars >= 2
      ? roundMoney(input.recipe.price * (0.08 * freshFlag + 0.06 * condimentMatch) * repScale)
      : 0

  const gross = roundMoney(baseGross + rushPremium + tip + flavorBonus)
  const net = roundMoney(gross - stockResult.rawMaterialCost)

  const rawRepDelta = input.stars === 3 ? 0.03 : input.stars === 2 ? 0.01 : -0.06
  const repBoost = input.stars >= 2 ? 1 + (input.bonuses?.reputationGainBonus ?? 0) / 100 : 1
  const reputationDelta = Math.round(rawRepDelta * repBoost * 1000) / 1000

  return {
    gross,
    rawCost: stockResult.rawMaterialCost,
    tip,
    flavorBonus,
    rushPremium,
    net,
    reputationDelta,
    nextStreak,
    isMorningRush: timeMod.isMorningRush,
    stockResult,
  }
}
