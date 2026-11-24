import type {
  DeliveryOrder,
  DeliveryPackStyle,
  DeliveryZoneDef,
  InventoryItemDef,
  InventoryStock,
  MifenEconomyConfig,
  MifenRecipe,
  ShopLevel,
} from '../types.ts'
import { roundMoney, type ShopEquipmentBonuses } from '../state.ts'
import { consumeStockForRecipe, type ConsumeStockResult } from './inventory.ts'
import { resolveEconomyConfig } from './rush.ts'

export const DEFAULT_DELIVERY_ZONES: readonly DeliveryZoneDef[] = [
  { id: 'zone_nikoniko', name: '微笑堂商厦', distanceM: 220, baseFee: 2.2, perKmRate: 2.4, deadlineSec: 45 },
  { id: 'zone_shizijie', name: '十字街写字楼', distanceM: 280, baseFee: 2.4, perKmRate: 2.4, deadlineSec: 50 },
  { id: 'zone_central_square', name: '中心广场', distanceM: 360, baseFee: 2.6, perKmRate: 2.5, deadlineSec: 55 },
  { id: 'zone_zhengyang', name: '正阳步行街', distanceM: 540, baseFee: 3.0, perKmRate: 2.6, deadlineSec: 65 },
  { id: 'zone_dongxixiang', name: '东西巷', distanceM: 580, baseFee: 3.2, perKmRate: 2.6, deadlineSec: 68 },
  { id: 'zone_elephant', name: '象鼻山北门', distanceM: 1120, baseFee: 3.8, perKmRate: 3.0, deadlineSec: 90 },
]

export function resolveDeliveryZones(zones?: readonly DeliveryZoneDef[]): readonly DeliveryZoneDef[] {
  return zones && zones.length > 0 ? zones : DEFAULT_DELIVERY_ZONES
}

export function getDailyDeliveryQuota(
  shopLevel: ShopLevel,
  bonuses?: Pick<ShopEquipmentBonuses, 'deliveryQuotaBonus'>,
  cfg?: Partial<MifenEconomyConfig>,
): number {
  const c = resolveEconomyConfig(cfg)
  const key = String(shopLevel) as '1' | '2' | '3'
  const base = c.deliveryDailyQuotaByLevel[key] ?? 8
  return base + Math.max(0, bonuses?.deliveryQuotaBonus ?? 0)
}

/**
 * 按距离计算外卖配送费：起步价 + (距离公里数 × 公里单价)。
 */
export function computeDeliveryFee(zone: DeliveryZoneDef): number {
  const km = Math.max(0, zone.distanceM) / 1000
  return roundMoney(zone.baseFee + km * zone.perKmRate)
}

export interface QuoteDeliveryInput {
  id: string
  recipe: MifenRecipe
  zone: DeliveryZoneDef
  packStyle?: DeliveryPackStyle
  bonuses?: Pick<ShopEquipmentBonuses, 'priceMultiplier' | 'priceBonusFlat'>
  config?: Partial<MifenEconomyConfig>
}

export function quoteDeliveryOrder(input: QuoteDeliveryInput): DeliveryOrder {
  const cfg = resolveEconomyConfig(input.config)
  const brandUnit =
    input.recipe.price * (input.bonuses?.priceMultiplier ?? 1) +
    (input.bonuses?.priceBonusFlat ?? 0)
  const markedPrice = roundMoney(brandUnit * (1 + cfg.deliveryMarkupRate))
  const deliveryFee = computeDeliveryFee(input.zone)
  const quotedTotal = roundMoney(markedPrice + deliveryFee)
  return {
    id: input.id,
    recipeId: input.recipe.id,
    recipeName: input.recipe.name,
    basePrice: input.recipe.price,
    zoneId: input.zone.id,
    zoneName: input.zone.name,
    distanceM: input.zone.distanceM,
    packStyle: input.packStyle ?? 'separated',
    deliveryFee,
    quotedTotal,
    deadlineSec: input.zone.deadlineSec,
    elapsedSec: 0,
    status: 'pending',
  }
}

export interface SettleDeliveryInput {
  order: DeliveryOrder
  recipe: MifenRecipe
  elapsedSec: number
  stars: 1 | 2 | 3
  deliveriesDoneToday: number
  shopLevel: ShopLevel
  inventory: Readonly<InventoryStock>
  bonuses?: ShopEquipmentBonuses
  inventoryItems?: readonly InventoryItemDef[]
  config?: Partial<MifenEconomyConfig>
}

export interface DeliverySettlementResult {
  ok: boolean
  reason?: 'QUOTA_EXCEEDED'
  onTime: boolean
  gross: number
  commission: number
  packCost: number
  rawCost: number
  tip: number
  penalty: number
  net: number
  reputationDelta: number
  stockResult: ConsumeStockResult
  completedOrder: DeliveryOrder
}

/**
 * 外卖订单结算（对齐调研报告玩法 3）：
 * - 按距离计价配送费 + 外卖菜品 +15% 溢价
 * - 平台抽成 18%，汤卤分离扣除分格包装费（可被分装打包台设备减免）
 * - 限时内送达且选汤卤分离获准时好评小费；超时扣延误违约金；混装导致坨粉扣差评赔付并降口碑
 */
export function settleDeliveryOrder(input: SettleDeliveryInput): DeliverySettlementResult {
  const cfg = resolveEconomyConfig(input.config)
  const quota = getDailyDeliveryQuota(input.shopLevel, input.bonuses, cfg)
  const emptyStock: ConsumeStockResult = {
    nextInventory: { ...input.inventory },
    usedEmergencyBrine: false,
    emergencyBrineCost: 0,
    rawMaterialCost: 0,
    shortages: [],
  }

  if (input.deliveriesDoneToday >= quota) {
    return {
      ok: false,
      reason: 'QUOTA_EXCEEDED',
      onTime: false,
      gross: 0,
      commission: 0,
      packCost: 0,
      rawCost: 0,
      tip: 0,
      penalty: 0,
      net: 0,
      reputationDelta: 0,
      stockResult: emptyStock,
      completedOrder: { ...input.order, elapsedSec: input.elapsedSec, status: 'failed' },
    }
  }

  const stockResult = consumeStockForRecipe(input.inventory, input.recipe, input.inventoryItems, cfg)
  const onTime = input.elapsedSec <= input.order.deadlineSec
  const separated = input.order.packStyle === 'separated'

  const packDiscount = input.bonuses?.packCostDiscount ?? 0
  const packCost = separated ? roundMoney(Math.max(0.4, cfg.deliverySeparatedPackCost - packDiscount)) : 0.3

  const gross = input.order.quotedTotal
  const commissionBase = Math.max(0, gross - packCost)
  const commission = roundMoney(commissionBase * cfg.deliveryPlatformCommissionRate)

  let tip = 0
  let penalty = 0
  let reputationDelta = 0

  if (onTime && separated && input.stars >= 2) {
    // 距离越远、制作星级越高，准时汤卤分离小费越高
    const distBonus = Math.min(1.2, (input.order.distanceM / 1000) * 0.9)
    tip = roundMoney((input.stars === 3 ? 1.5 : 1.0) + distBonus)
    reputationDelta = input.stars === 3 ? 0.03 : 0.01
  } else if (!onTime) {
    // 超过限时：按超时比例扣违约金并扣口碑
    const overtimeRatio = Math.min(1, (input.elapsedSec - input.order.deadlineSec) / Math.max(15, input.order.deadlineSec))
    penalty = roundMoney(1.5 + overtimeRatio * 2.5)
    reputationDelta = -0.06
  }

  if (!separated) {
    // 混装易坨粉吸干卤水，触发固定赔付与差评
    penalty = roundMoney(penalty + cfg.deliveryMixedPenalty)
    reputationDelta = Math.round((reputationDelta - 0.08) * 1000) / 1000
  }

  const net = roundMoney(gross - packCost - commission - stockResult.rawMaterialCost + tip - penalty)
  const completedOrder: DeliveryOrder = {
    ...input.order,
    elapsedSec: roundMoney(input.elapsedSec),
    status: onTime ? 'completed' : 'failed',
  }

  return {
    ok: true,
    onTime,
    gross,
    commission,
    packCost,
    rawCost: stockResult.rawMaterialCost,
    tip,
    penalty,
    net,
    reputationDelta,
    stockResult,
    completedOrder,
  }
}
