import type {
  DailyAccumulators,
  DailyLedgerRecord,
  InventoryItemDef,
  InventoryStock,
  MifenEconomyConfig,
  RevenueStream,
  ShopLevel,
} from '../types.ts'
import { roundMoney, type ShopEquipmentBonuses } from '../state.ts'
import { computeOvernightSpoilage, type SpoilageReport } from './inventory.ts'
import { resolveEconomyConfig } from './rush.ts'

export interface CloseDayInput {
  day: number
  shopLevel: ShopLevel
  funds: number
  reputation: number
  today: Readonly<DailyAccumulators>
  inventory: Readonly<InventoryStock>
  bonuses?: Pick<ShopEquipmentBonuses, 'spoilageReduction'>
  inventoryItems?: readonly InventoryItemDef[]
  config?: Partial<MifenEconomyConfig>
}

export interface CloseDayResult {
  ledger: DailyLedgerRecord
  nextDay: number
  nextFunds: number
  nextInventory: InventoryStock
  spoilage: SpoilageReport
  threeStreamsPositive: boolean
}

export function getFixedDailyOverhead(
  shopLevel: ShopLevel,
  cfg?: Partial<MifenEconomyConfig>,
): number {
  const c = resolveEconomyConfig(cfg)
  const key = String(shopLevel) as '1' | '2' | '3'
  return c.fixedDailyOverheadByLevel[key] ?? 8
}

export function computeStreamShares(
  netByStream: Readonly<Record<RevenueStream, number>>,
): Record<RevenueStream, number> {
  const posDine = Math.max(0, netByStream.dine_in)
  const posDeliv = Math.max(0, netByStream.delivery)
  const posRetail = Math.max(0, netByStream.retail)
  const total = posDine + posDeliv + posRetail
  if (total <= 0) {
    return { dine_in: 0, delivery: 0, retail: 0 }
  }
  return {
    dine_in: Math.round((posDine / total) * 1000) / 1000,
    delivery: Math.round((posDeliv / total) * 1000) / 1000,
    retail: Math.round((posRetail / total) * 1000) / 1000,
  }
}

export interface BalanceCheckResult {
  balanced: boolean
  allPositive: boolean
  maxStream: RevenueStream
  maxShare: number
  minShare: number
  shares: Record<RevenueStream, number>
}

/**
 * 校验三大赚钱玩法（堂食 / 外卖 / 外售）是否均产生正收益且无一家独大。
 */
export function checkRevenueStreamBalance(
  netByStream: Readonly<Record<RevenueStream, number>>,
  maxAllowedShare = 0.65,
  minRequiredShare = 0.12,
): BalanceCheckResult {
  const allPositive = netByStream.dine_in > 0 && netByStream.delivery > 0 && netByStream.retail > 0
  const shares = computeStreamShares(netByStream)
  const entries = Object.entries(shares) as [RevenueStream, number][]
  entries.sort((a, b) => b[1] - a[1])
  const [maxStream, maxShare] = entries[0]
  const minShare = entries[entries.length - 1][1]
  const balanced = allPositive && maxShare <= maxAllowedShare && minShare >= minRequiredShare
  return { balanced, allPositive, maxStream, maxShare, minShare, shares }
}

/**
 * 每日闭店结算：
 * 1. 若早市高峰出餐 >= 4 碗且零顾客气走，发放 +15% 无阻畅行奖金；
 * 2. 核算固定水电租金与隔夜鲜湿粉/备料损耗；
 * 3. 输出三大赛道毛收入、净利、占比，用于每日账本与口碑/成就判定。
 */
export function settleBusinessDay(input: CloseDayInput): CloseDayResult {
  const cfg = resolveEconomyConfig(input.config)
  const fixedOverhead = getFixedDailyOverhead(input.shopLevel, cfg)
  const spoilage = computeOvernightSpoilage(input.inventory, input.bonuses, input.inventoryItems)

  const rushBonus =
    input.today.rushServed >= 4 && input.today.rushAngryDrops === 0
      ? roundMoney(Math.max(0, input.today.dineInNet) * cfg.morningRushZeroDropBonusRate)
      : 0

  const grossByStream: Record<RevenueStream, number> = {
    dine_in: roundMoney(input.today.dineInGross + rushBonus),
    delivery: roundMoney(input.today.deliveryGross),
    retail: roundMoney(input.today.retailGross),
  }
  const netByStream: Record<RevenueStream, number> = {
    dine_in: roundMoney(input.today.dineInNet + rushBonus),
    delivery: roundMoney(input.today.deliveryNet),
    retail: roundMoney(input.today.retailNet),
  }
  const streamShares = computeStreamShares(netByStream)

  // 当日经营净利 = 三线毛贡献净额 - 水电固定成本 - 隔夜报废损耗
  const totalNetProfit = roundMoney(
    netByStream.dine_in + netByStream.delivery + netByStream.retail - fixedOverhead - spoilage.totalSpoilageCost,
  )

  // 现金余额在闭店时入账早市畅行奖并扣除当日固定水电租金（原料采购已在进货/单笔消耗时结算）
  const nextFunds = Math.max(0, roundMoney(input.funds + rushBonus - fixedOverhead))
  const threeStreamsPositive = netByStream.dine_in > 0 && netByStream.delivery > 0 && netByStream.retail > 0

  const ledger: DailyLedgerRecord = {
    day: input.day,
    shopLevel: input.shopLevel,
    grossByStream,
    netByStream,
    streamShares,
    rushBonus,
    restockSpend: roundMoney(input.today.restockSpend),
    spoilageLoss: spoilage.totalSpoilageCost,
    fixedOverhead,
    totalNetProfit,
    bowlsServed: input.today.dineInBowls,
    deliveriesCompleted: input.today.deliveriesCompleted,
    retailUnitsSold: input.today.retailUnitsSold,
    endingReputation: input.reputation,
    endingFunds: nextFunds,
  }

  return {
    ledger,
    nextDay: input.day + 1,
    nextFunds,
    nextInventory: spoilage.nextInventory,
    spoilage,
    threeStreamsPositive,
  }
}
