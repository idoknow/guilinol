import type {
  IngredientKey,
  InventoryStock,
  RetailSkuDef,
  ShopLevel,
} from '../types.ts'
import { roundMoney, type ShopEquipmentBonuses } from '../state.ts'
import { consumeStockStrict } from './inventory.ts'

export const DEFAULT_RETAIL_SKUS: readonly RetailSkuDef[] = [
  {
    id: 'sku_brine_bottle',
    name: '浓缩老卤随身瓶',
    kind: 'retail',
    price: 14.0,
    unitCost: 5.5,
    consumes: { brine: 4 },
    minShopLevel: 1,
    dailyCap: 6,
  },
  {
    id: 'sku_guoshao_box',
    name: '脆皮锅烧熟食盒',
    kind: 'retail',
    price: 12.0,
    unitCost: 6.2,
    consumes: { guoshao: 3 },
    minShopLevel: 1,
    dailyCap: 6,
  },
  {
    id: 'sku_condiment_jar',
    name: '腌青椒酸豆角罐',
    kind: 'retail',
    price: 9.5,
    unitCost: 3.5,
    consumes: { condiment: 3 },
    minShopLevel: 1,
    dailyCap: 8,
  },
  {
    id: 'sku_wet_noodle_pack',
    name: '日配鲜湿粉批发包',
    kind: 'wholesale',
    price: 12.0,
    unitCost: 9.5,
    consumes: { noodle: 8 },
    minShopLevel: 2,
    dailyCap: 4,
  },
]

export function resolveRetailSkus(skus?: readonly RetailSkuDef[]): readonly RetailSkuDef[] {
  return skus && skus.length > 0 ? skus : DEFAULT_RETAIL_SKUS
}

/**
 * 熟客顺手外带转化率（随口碑 1.0~5.0 平滑提升，区间 [5%, 28%]）。
 */
export function getRetailConversionRate(reputation: number): number {
  const raw = 0.08 + 0.06 * (reputation - 3.5)
  return Math.round(Math.min(0.28, Math.max(0.05, raw)) * 1000) / 1000
}

/**
 * 外售/微批发单件售价（零售款随门店倍率与老卤升级同步抬价，批发款维持薄利走量价）。
 */
export function getRetailUnitPrice(
  sku: RetailSkuDef,
  bonuses?: Pick<ShopEquipmentBonuses, 'priceMultiplier' | 'priceBonusFlat'>,
): number {
  if (sku.kind !== 'retail') return sku.price
  return roundMoney(
    sku.price * (bonuses?.priceMultiplier ?? 1) +
      (sku.id === 'sku_brine_bottle' ? (bonuses?.priceBonusFlat ?? 0) : 0),
  )
}

export function getRetailUnitMargin(
  sku: RetailSkuDef,
  bonuses?: Pick<ShopEquipmentBonuses, 'priceMultiplier' | 'priceBonusFlat'>,
): number {
  return roundMoney(getRetailUnitPrice(sku, bonuses) - sku.unitCost)
}

export interface RetailSaleInput {
  sku: RetailSkuDef
  quantity: number
  shopLevel: ShopLevel
  inventory: Readonly<InventoryStock>
  soldTodayForSku: number
  bonuses?: Pick<ShopEquipmentBonuses, 'priceMultiplier' | 'priceBonusFlat'>
}

export interface RetailSaleResult {
  ok: boolean
  reason?: 'LEVEL_LOCKED' | 'DAILY_CAP_REACHED' | 'INSUFFICIENT_STOCK'
  missingIngredient?: IngredientKey
  quantitySold: number
  gross: number
  cost: number
  net: number
  nextInventory: InventoryStock
}

/**
 * 卤水/锅烧/小料外售及鲜湿粉微批发结算。
 * 严格校验门店等级、单日限额与共享原料库存（防止抽干堂食老卤无上限套利）。
 */
export function settleRetailSale(input: RetailSaleInput): RetailSaleResult {
  const safeQty = Math.max(1, Math.floor(input.quantity))
  if (input.shopLevel < input.sku.minShopLevel) {
    return {
      ok: false,
      reason: 'LEVEL_LOCKED',
      quantitySold: 0,
      gross: 0,
      cost: 0,
      net: 0,
      nextInventory: { ...input.inventory },
    }
  }

  const remainingCap = Math.max(0, input.sku.dailyCap - input.soldTodayForSku)
  if (remainingCap <= 0) {
    return {
      ok: false,
      reason: 'DAILY_CAP_REACHED',
      quantitySold: 0,
      gross: 0,
      cost: 0,
      net: 0,
      nextInventory: { ...input.inventory },
    }
  }

  const actualQty = Math.min(safeQty, remainingCap)
  const scaledConsumes: Partial<InventoryStock> = {}
  for (const [k, v] of Object.entries(input.sku.consumes) as [IngredientKey, number][]) {
    if (typeof v === 'number' && v > 0) scaledConsumes[k] = roundMoney(v * actualQty)
  }

  const stockCheck = consumeStockStrict(input.inventory, scaledConsumes)
  if (!stockCheck.ok) {
    return {
      ok: false,
      reason: 'INSUFFICIENT_STOCK',
      missingIngredient: stockCheck.missing,
      quantitySold: 0,
      gross: 0,
      cost: 0,
      net: 0,
      nextInventory: { ...input.inventory },
    }
  }

  const unitPrice = getRetailUnitPrice(input.sku, input.bonuses)
  const gross = roundMoney(unitPrice * actualQty)
  const cost = roundMoney(input.sku.unitCost * actualQty)
  const net = roundMoney(gross - cost)

  return {
    ok: true,
    quantitySold: actualQty,
    gross,
    cost,
    net,
    nextInventory: stockCheck.nextInventory,
  }
}
