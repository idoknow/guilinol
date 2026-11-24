import type {
  IngredientKey,
  InventoryItemDef,
  InventoryStock,
  MifenEconomyConfig,
  MifenRecipe,
  ShopLevel,
} from '../types.ts'
import { roundMoney, type ShopEquipmentBonuses } from '../state.ts'

export const ALL_INGREDIENTS: readonly IngredientKey[] = ['noodle', 'brine', 'guoshao', 'meat', 'condiment']

export const DEFAULT_INVENTORY_ITEMS: readonly InventoryItemDef[] = [
  { id: 'noodle', name: '鲜湿圆粉', unit: '份', unitCost: 0.9, batchSize: 20, baseCap: 60, overnightSpoilageRate: 0.28 },
  { id: 'brine', name: '秘制老卤', unit: '份', unitCost: 1.0, batchSize: 20, baseCap: 75, overnightSpoilageRate: 0.05 },
  { id: 'guoshao', name: '脆皮锅烧', unit: '份', unitCost: 1.6, batchSize: 15, baseCap: 50, overnightSpoilageRate: 0.12 },
  { id: 'meat', name: '卤牛肉叉烧', unit: '份', unitCost: 1.8, batchSize: 15, baseCap: 50, overnightSpoilageRate: 0.08 },
  { id: 'condiment', name: '七盆小料', unit: '份', unitCost: 0.6, batchSize: 25, baseCap: 80, overnightSpoilageRate: 0.06 },
]

export function resolveInventoryItems(items?: readonly InventoryItemDef[]): readonly InventoryItemDef[] {
  return items && items.length > 0 ? items : DEFAULT_INVENTORY_ITEMS
}

export function getIngredientCap(
  item: InventoryItemDef,
  shopLevel: ShopLevel,
  bonuses?: Pick<ShopEquipmentBonuses, 'inventoryCapBonus'>,
): number {
  const levelBonus = shopLevel === 3 ? 40 : shopLevel === 2 ? 20 : 0
  const extra = bonuses ? Math.max(0, bonuses.inventoryCapBonus - levelBonus) : 0
  return Math.round(item.baseCap + levelBonus + extra)
}

export function getRecipeIngredients(recipe: MifenRecipe): Partial<InventoryStock> {
  if (recipe.ingredients) return recipe.ingredients
  const noodle = recipe.portion === '三两' ? 1.5 : recipe.portion === '一两' ? 0.75 : 1.0
  const brine = recipe.portion === '三两' ? 1.4 : 1.0
  const meats = recipe.requiredMeats ?? []
  const guoshao = meats.includes('guoshao') ? 1 : 0
  const otherMeatCount = meats.filter(m => m === 'beef' || m === 'charsiu').length
  const meat = otherMeatCount > 0 ? otherMeatCount : meats.includes('egg') ? 0.5 : 0
  const condiment = 1
  return { noodle, brine, guoshao, meat, condiment }
}

export interface ConsumeStockResult {
  nextInventory: InventoryStock
  usedEmergencyBrine: boolean
  emergencyBrineCost: number
  rawMaterialCost: number
  shortages: IngredientKey[]
}

/**
 * 扣减一笔订单消耗的原料库存。
 * 若秘制老卤余量不足，自动降级使用高成本应急商业卤水（不卡死出餐，但毛利从 72% 降至 64%）。
 */
export function consumeStockForRecipe(
  inventory: Readonly<InventoryStock>,
  recipe: MifenRecipe,
  items?: readonly InventoryItemDef[],
  config?: Pick<MifenEconomyConfig, 'rawCostRateNormal' | 'rawCostRateEmergencyBrine'>,
): ConsumeStockResult {
  const defs = new Map(resolveInventoryItems(items).map(d => [d.id, d]))
  const req = getRecipeIngredients(recipe)
  const next: InventoryStock = { ...inventory }
  const shortages: IngredientKey[] = []

  const needBrine = req.brine ?? 1
  const usedEmergencyBrine = next.brine + 0.001 < needBrine

  for (const key of ALL_INGREDIENTS) {
    const need = req[key] ?? 0
    if (need <= 0) continue
    if (next[key] + 0.001 < need) {
      shortages.push(key)
      next[key] = 0
    } else {
      next[key] = roundMoney(Math.max(0, next[key] - need))
    }
  }

  const normalRate = config?.rawCostRateNormal ?? 0.28
  const emergencyRate = config?.rawCostRateEmergencyBrine ?? 0.36
  const baseRaw = roundMoney(recipe.price * normalRate)
  const emergencySurcharge = usedEmergencyBrine
    ? roundMoney(recipe.price * Math.max(0, emergencyRate - normalRate))
    : 0

  // 若除老卤外的鲜粉/肉码也缺货，按单件临时急购加价 25% 兜底核算真实成本
  let nonBrineEmergency = 0
  for (const key of shortages) {
    if (key === 'brine') continue
    const def = defs.get(key)
    const missing = Math.max(0, (req[key] ?? 0) - inventory[key])
    if (def && missing > 0) {
      nonBrineEmergency += missing * def.unitCost * 0.25
    }
  }

  const emergencyBrineCost = roundMoney(emergencySurcharge + nonBrineEmergency)
  const rawMaterialCost = roundMoney(baseRaw + emergencyBrineCost)

  return {
    nextInventory: next,
    usedEmergencyBrine,
    emergencyBrineCost,
    rawMaterialCost,
    shortages,
  }
}

export interface DirectConsumeResult {
  ok: boolean
  nextInventory: InventoryStock
  missing?: IngredientKey
}

/**
 * 严格扣减库存（用于零售分装与批发，库存不足时拒绝售卖，确保共享老卤/湿粉互斥锁生效）。
 */
export function consumeStockStrict(
  inventory: Readonly<InventoryStock>,
  consumes: Partial<InventoryStock>,
): DirectConsumeResult {
  for (const key of ALL_INGREDIENTS) {
    const need = consumes[key] ?? 0
    if (need > 0 && inventory[key] + 0.001 < need) {
      return { ok: false, nextInventory: { ...inventory }, missing: key }
    }
  }
  const next: InventoryStock = { ...inventory }
  for (const key of ALL_INGREDIENTS) {
    const need = consumes[key] ?? 0
    if (need > 0) next[key] = roundMoney(Math.max(0, next[key] - need))
  }
  return { ok: true, nextInventory: next }
}

export interface RestockQuote {
  item: IngredientKey
  name: string
  requestedUnits: number
  actualUnits: number
  unitCost: number
  totalCost: number
  cap: number
}

export function quoteRestock(
  inventory: Readonly<InventoryStock>,
  itemKey: IngredientKey,
  batches: number,
  shopLevel: ShopLevel,
  bonuses?: Pick<ShopEquipmentBonuses, 'inventoryCapBonus'>,
  items?: readonly InventoryItemDef[],
): RestockQuote {
  const def = resolveInventoryItems(items).find(d => d.id === itemKey) ?? DEFAULT_INVENTORY_ITEMS[0]
  const cap = getIngredientCap(def, shopLevel, bonuses)
  const safeBatches = Math.max(1, Math.floor(batches))
  const requestedUnits = safeBatches * def.batchSize
  const room = Math.max(0, roundMoney(cap - inventory[itemKey]))
  const actualUnits = roundMoney(Math.min(requestedUnits, room))
  // 整批进货满 2 批享 5% 批量折扣
  const discount = safeBatches >= 2 ? 0.95 : 1.0
  const totalCost = roundMoney(actualUnits * def.unitCost * discount)
  return {
    item: itemKey,
    name: def.name,
    requestedUnits,
    actualUnits,
    unitCost: def.unitCost,
    totalCost,
    cap,
  }
}

export interface RestockResult {
  ok: boolean
  reason?: 'AT_CAPACITY' | 'INSUFFICIENT_FUNDS'
  quote: RestockQuote
  nextInventory: InventoryStock
  fundsAfter: number
}

export function applyRestock(
  inventory: Readonly<InventoryStock>,
  funds: number,
  itemKey: IngredientKey,
  batches: number,
  shopLevel: ShopLevel,
  bonuses?: Pick<ShopEquipmentBonuses, 'inventoryCapBonus'>,
  items?: readonly InventoryItemDef[],
): RestockResult {
  const quote = quoteRestock(inventory, itemKey, batches, shopLevel, bonuses, items)
  if (quote.actualUnits <= 0) {
    return { ok: false, reason: 'AT_CAPACITY', quote, nextInventory: { ...inventory }, fundsAfter: funds }
  }
  if (funds + 0.001 < quote.totalCost) {
    return { ok: false, reason: 'INSUFFICIENT_FUNDS', quote, nextInventory: { ...inventory }, fundsAfter: funds }
  }
  const nextInventory: InventoryStock = {
    ...inventory,
    [itemKey]: roundMoney(inventory[itemKey] + quote.actualUnits),
  }
  return {
    ok: true,
    quote,
    nextInventory,
    fundsAfter: roundMoney(funds - quote.totalCost),
  }
}

export interface SpoilageReport {
  nextInventory: InventoryStock
  spoiledUnits: InventoryStock
  totalSpoilageCost: number
}

/**
 * 隔夜闭店报废损耗：鲜湿圆粉损耗最高（28%），装备双温保鲜冷柜可减半。
 */
export function computeOvernightSpoilage(
  inventory: Readonly<InventoryStock>,
  bonuses?: Pick<ShopEquipmentBonuses, 'spoilageReduction'>,
  items?: readonly InventoryItemDef[],
): SpoilageReport {
  const defs = resolveInventoryItems(items)
  const reduction = Math.max(0, Math.min(0.8, bonuses?.spoilageReduction ?? 0))
  const nextInventory: InventoryStock = { ...inventory }
  const spoiledUnits: InventoryStock = { noodle: 0, brine: 0, guoshao: 0, meat: 0, condiment: 0 }
  let totalCost = 0

  for (const def of defs) {
    const current = inventory[def.id] ?? 0
    if (current <= 0) continue
    const rate = def.overnightSpoilageRate * (1 - reduction)
    const lost = roundMoney(current * rate)
    spoiledUnits[def.id] = lost
    nextInventory[def.id] = roundMoney(Math.max(0, current - lost))
    totalCost += lost * def.unitCost
  }

  return {
    nextInventory,
    spoiledUnits,
    totalSpoilageCost: roundMoney(totalCost),
  }
}

export function getLowStockIngredients(
  inventory: Readonly<InventoryStock>,
  threshold = 8,
): IngredientKey[] {
  return ALL_INGREDIENTS.filter(k => (inventory[k] ?? 0) <= threshold)
}
