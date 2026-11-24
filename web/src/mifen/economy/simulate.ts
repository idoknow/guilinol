import type {
  DailyLedgerRecord,
  IngredientKey,
  MifenRecipesData,
  RevenueStream,
  ShopLevel,
} from '../types.ts'
import { createMifenStore, roundMoney } from '../state.ts'
import { createMifenEconomy } from './engine.ts'
import { checkRevenueStreamBalance, type BalanceCheckResult } from './settlement.ts'

export interface ThreeDaySimulationReport {
  days: DailyLedgerRecord[]
  cumulativeNetByStream: Record<RevenueStream, number>
  cumulativeGrossByStream: Record<RevenueStream, number>
  cumulativeBalance: BalanceCheckResult
  perDayBalanced: boolean
  endingFunds: number
  endingReputation: number
  endingShopLevel: ShopLevel
  ownedEquipment: string[]
  unlockedAchievements: string[]
  unlockedRecipes: string[]
  upgradesPurchased: { day: number; id: string; cost: number }[]
}

/**
 * 确定性模拟 3 个完整营业日（第 1 日 Lv1 起步 -> 第 2 日扩店 Lv2 -> 第 3 日全业态联运），
 * 验证堂食早市/日间、汤卤分离外卖、老卤/小料外售三条赛道均有稳定正收益且无一家独大。
 */
export function simulateThreeDays(recipesData: MifenRecipesData): ThreeDaySimulationReport {
  const store = createMifenStore({ memoryOnly: true })
  const eco = createMifenEconomy(store, recipesData)
  const upgradesPurchased: { day: number; id: string; cost: number }[] = []

  const buyUpgradeIfAffordable = (day: number, id: string): boolean => {
    const def = recipesData.upgrades.find(u => u.id === id)
    if (!def) return false
    const st = store.getState()
    if (def.kind === 'shop_level') {
      const target = def.targetLevel ?? 2
      if (st.shopLevel >= target || target > st.shopLevel + 1) return false
      if (!store.spendFunds(def.cost)) return false
      store.setShopLevel(target)
      upgradesPurchased.push({ day, id, cost: def.cost })
      return true
    }
    if (store.hasEquipment(def.id) || !store.spendFunds(def.cost)) return false
    store.addEquipment(def.id)
    upgradesPurchased.push({ day, id, cost: def.cost })
    return true
  }

  const restockIfLow = (targets: Partial<Record<IngredientKey, number>>): void => {
    const inv = store.getState().inventory
    for (const [key, minLevel] of Object.entries(targets) as [IngredientKey, number][]) {
      if (inv[key] < minLevel) {
        eco.restock(key, 1)
      }
    }
  }

  const days: DailyLedgerRecord[] = []

  // 每个营业日按真实时段推进：晨间备料 -> 早市高峰堂食 -> 午晚错峰外卖 -> 熟客外带/批发 -> 闭店结算
  const dayPlans: Array<{
    day: number
    morningBowls: Array<{ recipeId: string; stars: 1 | 2 | 3 }>
    middayBowls: Array<{ recipeId: string; stars: 1 | 2 | 3 }>
    deliveries: Array<{ recipeId: string; zoneId: string; elapsedSec: number; stars: 1 | 2 | 3 }>
    retailSales: Array<{ skuId: string; qty: number }>
    targetUpgrades: string[]
  }> = [
    {
      // 第 1 日（Lv1 初创老铺）：14 碗堂食（8 早市 + 6 午晚）+ 5 单汤卤分离外卖 + 5 份卤水/锅烧/小料外售
      day: 1,
      morningBowls: [
        { recipeId: 'lucai_2', stars: 3 },
        { recipeId: 'lucai_1', stars: 3 },
        { recipeId: 'guoshao_bowl', stars: 3 },
        { recipeId: 'lucai_2', stars: 2 },
        { recipeId: 'lucai_3', stars: 3 },
        { recipeId: 'beef_soup', stars: 3 },
        { recipeId: 'lucai_2', stars: 3 },
        { recipeId: 'guoshao_bowl', stars: 2 },
      ],
      middayBowls: [
        { recipeId: 'double_combo', stars: 3 },
        { recipeId: 'sour_spicy', stars: 3 },
        { recipeId: 'lucai_3', stars: 2 },
        { recipeId: 'beef_soup', stars: 3 },
        { recipeId: 'guoshao_bowl', stars: 3 },
        { recipeId: 'lucai_2', stars: 3 },
      ],
      deliveries: [
        { recipeId: 'double_combo', zoneId: 'zone_shizijie', elapsedSec: 34, stars: 3 },
        { recipeId: 'guoshao_bowl', zoneId: 'zone_nikoniko', elapsedSec: 30, stars: 3 },
        { recipeId: 'beef_soup', zoneId: 'zone_central_square', elapsedSec: 42, stars: 2 },
        { recipeId: 'sour_spicy', zoneId: 'zone_zhengyang', elapsedSec: 48, stars: 3 },
        { recipeId: 'grand_feast', zoneId: 'zone_dongxixiang', elapsedSec: 52, stars: 3 },
      ],
      retailSales: [
        { skuId: 'sku_brine_bottle', qty: 2 },
        { skuId: 'sku_guoshao_box', qty: 2 },
        { skuId: 'sku_condiment_jar', qty: 2 },
      ],
      targetUpgrades: ['eq_twin_boiler', 'shop_lv2'],
    },
    {
      // 第 2 日（Lv2 双开间旺铺）：18 碗堂食 + 7 单外卖（含新解锁三鲜粉）+ 8 份外售与日配鲜湿粉批发
      day: 2,
      morningBowls: [
        { recipeId: 'lucai_2', stars: 3 },
        { recipeId: 'lucai_3', stars: 3 },
        { recipeId: 'guoshao_bowl', stars: 3 },
        { recipeId: 'sanxian_mifen', stars: 3 },
        { recipeId: 'lucai_2', stars: 3 },
        { recipeId: 'beef_soup', stars: 3 },
        { recipeId: 'guoshao_bowl', stars: 2 },
        { recipeId: 'lucai_3', stars: 3 },
        { recipeId: 'double_combo', stars: 3 },
        { recipeId: 'lucai_2', stars: 3 },
      ],
      middayBowls: [
        { recipeId: 'sanxian_mifen', stars: 3 },
        { recipeId: 'double_combo', stars: 3 },
        { recipeId: 'sour_spicy', stars: 3 },
        { recipeId: 'grand_feast', stars: 2 },
        { recipeId: 'beef_soup', stars: 3 },
        { recipeId: 'guoshao_bowl', stars: 3 },
        { recipeId: 'lucai_3', stars: 3 },
        { recipeId: 'lucai_2', stars: 3 },
      ],
      deliveries: [
        { recipeId: 'double_combo', zoneId: 'zone_shizijie', elapsedSec: 32, stars: 3 },
        { recipeId: 'grand_feast', zoneId: 'zone_elephant', elapsedSec: 68, stars: 3 },
        { recipeId: 'sanxian_mifen', zoneId: 'zone_central_square', elapsedSec: 39, stars: 3 },
        { recipeId: 'beef_soup', zoneId: 'zone_zhengyang', elapsedSec: 46, stars: 3 },
        { recipeId: 'guoshao_bowl', zoneId: 'zone_nikoniko', elapsedSec: 28, stars: 2 },
        { recipeId: 'sour_spicy', zoneId: 'zone_dongxixiang', elapsedSec: 50, stars: 3 },
        { recipeId: 'double_combo', zoneId: 'zone_elephant', elapsedSec: 74, stars: 3 },
      ],
      retailSales: [
        { skuId: 'sku_brine_bottle', qty: 3 },
        { skuId: 'sku_guoshao_box', qty: 3 },
        { skuId: 'sku_condiment_jar', qty: 3 },
        { skuId: 'sku_wet_noodle_pack', qty: 2 },
      ],
      targetUpgrades: ['eq_master_brine', 'eq_cold_cabinet'],
    },
    {
      // 第 3 日（冲刺 Lv3 旗舰大店）：22 碗堂食（含牛腩粉/油茶套餐）+ 9 单全城外卖 + 10 份外售与批发
      day: 3,
      morningBowls: [
        { recipeId: 'lucai_2', stars: 3 },
        { recipeId: 'guoshao_bowl', stars: 3 },
        { recipeId: 'brisket_lucai', stars: 3 },
        { recipeId: 'sanxian_mifen', stars: 3 },
        { recipeId: 'double_combo', stars: 3 },
        { recipeId: 'lucai_3', stars: 3 },
        { recipeId: 'beef_soup', stars: 3 },
        { recipeId: 'guoshao_bowl', stars: 3 },
        { recipeId: 'brisket_lucai', stars: 2 },
        { recipeId: 'lucai_2', stars: 3 },
        { recipeId: 'double_combo', stars: 3 },
        { recipeId: 'sanxian_mifen', stars: 3 },
      ],
      middayBowls: [
        { recipeId: 'you_cha_combo', stars: 3 },
        { recipeId: 'brisket_lucai', stars: 3 },
        { recipeId: 'grand_feast', stars: 3 },
        { recipeId: 'sour_spicy', stars: 3 },
        { recipeId: 'double_combo', stars: 3 },
        { recipeId: 'beef_soup', stars: 2 },
        { recipeId: 'guoshao_bowl', stars: 3 },
        { recipeId: 'sanxian_mifen', stars: 3 },
        { recipeId: 'lucai_3', stars: 3 },
        { recipeId: 'lucai_2', stars: 3 },
      ],
      deliveries: [
        { recipeId: 'brisket_lucai', zoneId: 'zone_elephant', elapsedSec: 65, stars: 3 },
        { recipeId: 'grand_feast', zoneId: 'zone_dongxixiang', elapsedSec: 49, stars: 3 },
        { recipeId: 'double_combo', zoneId: 'zone_zhengyang', elapsedSec: 44, stars: 3 },
        { recipeId: 'you_cha_combo', zoneId: 'zone_central_square', elapsedSec: 38, stars: 3 },
        { recipeId: 'sanxian_mifen', zoneId: 'zone_shizijie', elapsedSec: 33, stars: 3 },
        { recipeId: 'beef_soup', zoneId: 'zone_nikoniko', elapsedSec: 29, stars: 3 },
        { recipeId: 'guoshao_bowl', zoneId: 'zone_dongxixiang', elapsedSec: 52, stars: 2 },
        { recipeId: 'brisket_lucai', zoneId: 'zone_zhengyang', elapsedSec: 47, stars: 3 },
        { recipeId: 'double_combo', zoneId: 'zone_elephant', elapsedSec: 70, stars: 3 },
      ],
      retailSales: [
        { skuId: 'sku_brine_bottle', qty: 4 },
        { skuId: 'sku_guoshao_box', qty: 4 },
        { skuId: 'sku_condiment_jar', qty: 4 },
        { skuId: 'sku_wet_noodle_pack', qty: 3 },
      ],
      targetUpgrades: ['eq_pack_station', 'shop_lv3'],
    },
  ]

  for (const plan of dayPlans) {
    // 晨间备料（第 2、3 日在开门前补齐原料，避免用高价应急卤水）
    if (plan.day > 1) {
      restockIfLow({ noodle: 38, brine: 46, guoshao: 28, meat: 28, condiment: 36 })
    }

    // 早市高峰堂食 (07:30)
    eco.syncHour(7.5)
    for (const b of plan.morningBowls) {
      restockIfLow({ noodle: 6, brine: 10, guoshao: 5, meat: 5, condiment: 6 })
      const available = eco.getAvailableRecipes()
      const useId = available.some(r => r.id === b.recipeId) ? b.recipeId : 'lucai_2'
      eco.recordDineInSale({
        recipeId: useId,
        stars: b.stars,
        hour: 7.5,
        guoshaoFreshness: 0.9,
        matchedCondimentRatio: 0.75,
      })
    }

    // 午间外卖波次 (12:00)
    eco.syncHour(12.0)
    for (const d of plan.deliveries) {
      restockIfLow({ noodle: 6, brine: 10, guoshao: 5, meat: 5, condiment: 6 })
      const available = eco.getAvailableRecipes()
      const useId = available.some(r => r.id === d.recipeId) ? d.recipeId : 'double_combo'
      const order = eco.acceptDeliveryOrder({ recipeId: useId, zoneId: d.zoneId, packStyle: 'separated' })
      if (order) {
        eco.completeDeliveryOrder({ orderId: order.id, elapsedSec: d.elapsedSec, stars: d.stars })
      }
    }

    // 下午熟客卤水/小料外带与鲜湿粉微批发 (15:00)
    eco.syncHour(15.0)
    restockIfLow({ noodle: 24, brine: 24, guoshao: 16, condiment: 18 })
    for (const r of plan.retailSales) {
      eco.sellRetailSku(r.skuId, r.qty)
    }

    // 午晚堂食 (19:00)
    eco.syncHour(19.0)
    for (const b of plan.middayBowls) {
      restockIfLow({ noodle: 6, brine: 10, guoshao: 5, meat: 5, condiment: 6 })
      const available = eco.getAvailableRecipes()
      const useId = available.some(r => r.id === b.recipeId) ? b.recipeId : 'guoshao_bowl'
      eco.recordDineInSale({
        recipeId: useId,
        stars: b.stars,
        hour: 19.0,
        guoshaoFreshness: 0.82,
        matchedCondimentRatio: 0.65,
      })
    }

    // 闭店前用当日结余购买升级
    for (const uid of plan.targetUpgrades) {
      buyUpgradeIfAffordable(plan.day, uid)
    }

    // 闭店结算
    const closed = eco.closeDay()
    days.push(closed.ledger)
  }

  const cumulativeNetByStream: Record<RevenueStream, number> = { dine_in: 0, delivery: 0, retail: 0 }
  const cumulativeGrossByStream: Record<RevenueStream, number> = { dine_in: 0, delivery: 0, retail: 0 }
  let perDayBalanced = true

  for (const d of days) {
    cumulativeNetByStream.dine_in = roundMoney(cumulativeNetByStream.dine_in + d.netByStream.dine_in)
    cumulativeNetByStream.delivery = roundMoney(cumulativeNetByStream.delivery + d.netByStream.delivery)
    cumulativeNetByStream.retail = roundMoney(cumulativeNetByStream.retail + d.netByStream.retail)
    cumulativeGrossByStream.dine_in = roundMoney(cumulativeGrossByStream.dine_in + d.grossByStream.dine_in)
    cumulativeGrossByStream.delivery = roundMoney(cumulativeGrossByStream.delivery + d.grossByStream.delivery)
    cumulativeGrossByStream.retail = roundMoney(cumulativeGrossByStream.retail + d.grossByStream.retail)
    const dayCheck = checkRevenueStreamBalance(d.netByStream, 0.65, 0.12)
    if (!dayCheck.balanced) perDayBalanced = false
  }

  const cumulativeBalance = checkRevenueStreamBalance(cumulativeNetByStream, 0.65, 0.12)
  const finalState = store.getState()

  return {
    days,
    cumulativeNetByStream,
    cumulativeGrossByStream,
    cumulativeBalance,
    perDayBalanced,
    endingFunds: finalState.funds,
    endingReputation: finalState.reputation,
    endingShopLevel: finalState.shopLevel,
    ownedEquipment: [...finalState.ownedEquipment],
    unlockedAchievements: [...finalState.unlockedAchievements],
    unlockedRecipes: [...finalState.unlockedRecipes],
    upgradesPurchased,
  }
}
