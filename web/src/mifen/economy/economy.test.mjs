import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applyRestock,
  checkRevenueStreamBalance,
  computeComboTipRate,
  computeDeliveryFee,
  computeOvernightSpoilage,
  computeQueuePatienceRate,
  consumeStockForRecipe,
  createMifenEconomy,
  ECONOMY_UI_SLOTS,
  evaluateAchievements,
  getAvailableRecipes,
  getDayPhase,
  getReputationTrafficMultiplier,
  getRetailConversionRate,
  getRetailUnitPrice,
  getTimeAndTrafficModifiers,
  quoteDeliveryOrder,
  settleBusinessDay,
  settleDeliveryOrder,
  settleDineInOrder,
  settleRetailSale,
  simulateThreeDays,
} from './index.ts'
import {
  computeShopBonuses,
  createDefaultInventory,
  createDefaultMifenState,
  createMifenStore,
} from '../state.ts'
import {
  estimateUpgradePaybackDays,
  getUpgradeProgressionCurve,
} from '../upgrade.ts'

const here = dirname(fileURLToPath(import.meta.url))
const recipesData = JSON.parse(readFileSync(join(here, '../recipes.json'), 'utf8'))

test('库存消耗、应急补卤加价、进货采购与冷柜防损耗', () => {
  const lucai2 = recipesData.recipes.find(r => r.id === 'lucai_2')
  assert.ok(lucai2)

  // 正常有老卤时按 28% 原料成本率
  const normal = consumeStockForRecipe(
    { noodle: 10, brine: 10, guoshao: 10, meat: 10, condiment: 10 },
    lucai2,
    recipesData.inventoryItems,
    recipesData.economyConfig,
  )
  assert.equal(normal.usedEmergencyBrine, false)
  assert.equal(normal.emergencyBrineCost, 0)
  assert.equal(normal.rawMaterialCost, 1.5) // 5.5 * 0.28 = 1.54 -> 1.5
  assert.equal(normal.nextInventory.brine, 9)

  // 老卤见底时自动触发应急卤水（成本率升至 36%，不卡死出餐）
  const dry = consumeStockForRecipe(
    { noodle: 10, brine: 0, guoshao: 10, meat: 10, condiment: 10 },
    lucai2,
    recipesData.inventoryItems,
    recipesData.economyConfig,
  )
  assert.equal(dry.usedEmergencyBrine, true)
  assert.ok(dry.emergencyBrineCost > 0)
  assert.ok(dry.rawMaterialCost > normal.rawMaterialCost)

  // 进货采购校验扣款、容量上限与批量 95 折
  const restock1 = applyRestock(
    { noodle: 10, brine: 10, guoshao: 10, meat: 10, condiment: 10 },
    100,
    'noodle',
    2,
    1,
    undefined,
    recipesData.inventoryItems,
  )
  assert.equal(restock1.ok, true)
  assert.equal(restock1.quote.actualUnits, 40) // 2 * 20
  assert.equal(restock1.quote.totalCost, 34.2) // 40 * 0.9 * 0.95
  assert.equal(restock1.fundsAfter, 65.8)

  // 资金不足拒绝进货
  const poor = applyRestock(
    { noodle: 10, brine: 10, guoshao: 10, meat: 10, condiment: 10 },
    5,
    'noodle',
    1,
    1,
    undefined,
    recipesData.inventoryItems,
  )
  assert.equal(poor.ok, false)
  assert.equal(poor.reason, 'INSUFFICIENT_FUNDS')

  // 隔夜损耗：有双温保鲜冷柜时损耗减半
  const inv = { noodle: 40, brine: 20, guoshao: 10, meat: 10, condiment: 10 }
  const spoilBase = computeOvernightSpoilage(inv, { spoilageReduction: 0 }, recipesData.inventoryItems)
  const spoilCold = computeOvernightSpoilage(inv, { spoilageReduction: 0.5 }, recipesData.inventoryItems)
  assert.ok(spoilBase.spoiledUnits.noodle > 10)
  assert.ok(spoilCold.totalSpoilageCost < spoilBase.totalSpoilageCost * 0.6)
})

test('早市高峰客流翻倍与溢价、口碑客流倍率、连击封顶与队列耐心惩罚', () => {
  assert.equal(getDayPhase(7.5, recipesData.economyConfig), 'morning_rush')
  assert.equal(getDayPhase(12.5, recipesData.economyConfig), 'midday')
  assert.equal(getDayPhase(20.0, recipesData.economyConfig), 'evening')

  const rushMod = getTimeAndTrafficModifiers(7.5, 4.2, recipesData.economyConfig)
  const middayMod = getTimeAndTrafficModifiers(12.0, 4.2, recipesData.economyConfig)
  assert.equal(rushMod.isMorningRush, true)
  assert.equal(rushMod.trafficMultiplier, 2.0)
  assert.equal(rushMod.premiumRate, 0.15)
  assert.ok(rushMod.trafficMultiplier > middayMod.trafficMultiplier)

  // 口碑显著影响客流
  assert.ok(getReputationTrafficMultiplier(4.9) > getReputationTrafficMultiplier(4.2))
  assert.ok(getReputationTrafficMultiplier(2.8) < getReputationTrafficMultiplier(4.2))

  // PlateUp 队列复利耐心惩罚与粉票速印机缓解
  const p1 = computeQueuePatienceRate(1, 1.0)
  const p5 = computeQueuePatienceRate(5, 1.0)
  const p5Printer = computeQueuePatienceRate(5, 1.3)
  assert.equal(p1, 1)
  assert.ok(p5 > 1.45)
  assert.ok(p5Printer < p5)

  // Overcooked 连击小费封顶 <= 45%
  assert.equal(computeComboTipRate(0), 0)
  assert.equal(computeComboTipRate(6), 0.3)
  assert.ok(computeComboTipRate(99, 1.0) <= 0.45)

  // 早市堂食净利高于午间同单（溢价生效）
  const recipe = recipesData.recipes.find(r => r.id === 'guoshao_bowl')
  const inv = createDefaultInventory()
  const rushSale = settleDineInOrder({
    recipe,
    stars: 3,
    streak: 3,
    hour: 7.5,
    reputation: 4.2,
    shopLevel: 1,
    inventory: inv,
    config: recipesData.economyConfig,
  })
  const normalSale = settleDineInOrder({
    recipe,
    stars: 3,
    streak: 3,
    hour: 12.5,
    reputation: 4.2,
    shopLevel: 1,
    inventory: inv,
    config: recipesData.economyConfig,
  })
  assert.ok(rushSale.rushPremium > 0)
  assert.equal(normalSale.rushPremium, 0)
  assert.ok(rushSale.net > normalSale.net)
})

test('外卖按距离计价、限时送达、汤卤分离 vs 混装与日配额限制', () => {
  const recipe = recipesData.recipes.find(r => r.id === 'double_combo')
  const nearZone = recipesData.deliveryZones.find(z => z.id === 'zone_nikoniko')
  const farZone = recipesData.deliveryZones.find(z => z.id === 'zone_elephant')
  assert.ok(recipe && nearZone && farZone)

  // 按距离计价：象鼻山远于微笑堂，配送费与总报价更高
  assert.ok(computeDeliveryFee(farZone) > computeDeliveryFee(nearZone))
  const nearQuote = quoteDeliveryOrder({ id: 'd1', recipe, zone: nearZone, packStyle: 'separated', config: recipesData.economyConfig })
  const farQuote = quoteDeliveryOrder({ id: 'd2', recipe, zone: farZone, packStyle: 'separated', config: recipesData.economyConfig })
  assert.ok(farQuote.deliveryFee > nearQuote.deliveryFee)
  assert.ok(farQuote.quotedTotal > nearQuote.quotedTotal)

  const inv = createDefaultInventory()
  // 准时 + 汤卤分离：高正净利 + 口碑提升
  const sepOnTime = settleDeliveryOrder({
    order: farQuote,
    recipe,
    elapsedSec: 50,
    stars: 3,
    deliveriesDoneToday: 0,
    shopLevel: 1,
    inventory: inv,
    config: recipesData.economyConfig,
  })
  assert.equal(sepOnTime.ok, true)
  assert.equal(sepOnTime.onTime, true)
  assert.ok(sepOnTime.net > 8)
  assert.ok(sepOnTime.tip > 0)
  assert.ok(sepOnTime.commission > 0)
  assert.ok(sepOnTime.reputationDelta > 0)

  // 超时配送：触发违约金与口碑下降
  const late = settleDeliveryOrder({
    order: farQuote,
    recipe,
    elapsedSec: farZone.deadlineSec + 30,
    stars: 3,
    deliveriesDoneToday: 0,
    shopLevel: 1,
    inventory: inv,
    config: recipesData.economyConfig,
  })
  assert.equal(late.onTime, false)
  assert.ok(late.penalty > 0)
  assert.ok(late.reputationDelta < 0)
  assert.ok(late.net < sepOnTime.net)

  // 混装打包：触发坨粉差评赔付与口碑下滑
  const mixedQuote = quoteDeliveryOrder({ id: 'd3', recipe, zone: farZone, packStyle: 'mixed', config: recipesData.economyConfig })
  const mixedRes = settleDeliveryOrder({
    order: mixedQuote,
    recipe,
    elapsedSec: 50,
    stars: 3,
    deliveriesDoneToday: 0,
    shopLevel: 1,
    inventory: inv,
    config: recipesData.economyConfig,
  })
  assert.ok(mixedRes.penalty >= 1.5)
  assert.ok(mixedRes.reputationDelta < 0)

  // 日配额上限阻断防刷单
  const capped = settleDeliveryOrder({
    order: nearQuote,
    recipe,
    elapsedSec: 30,
    stars: 3,
    deliveriesDoneToday: 8,
    shopLevel: 1,
    inventory: inv,
    config: recipesData.economyConfig,
  })
  assert.equal(capped.ok, false)
  assert.equal(capped.reason, 'QUOTA_EXCEEDED')
})

test('卤水与小料外售、鲜湿粉微批发与共享老卤库存互斥', () => {
  assert.ok(getRetailConversionRate(4.8) > getRetailConversionRate(3.5))
  const brineSku = recipesData.retailSkus.find(s => s.id === 'sku_brine_bottle')
  const wetWholesale = recipesData.retailSkus.find(s => s.id === 'sku_wet_noodle_pack')
  assert.ok(brineSku && wetWholesale)

  // 正常售出老卤随身瓶：正净利并扣减共享老卤库存
  const okSale = settleRetailSale({
    sku: brineSku,
    quantity: 2,
    shopLevel: 1,
    inventory: createDefaultInventory(),
    soldTodayForSku: 0,
  })
  assert.equal(okSale.ok, true)
  assert.equal(okSale.gross, 28)
  assert.equal(okSale.net, 17)
  assert.equal(okSale.nextInventory.brine, 28)

  // 老卤不足拒绝外售（防止抽干堂食卤水）
  const drySale = settleRetailSale({
    sku: brineSku,
    quantity: 1,
    shopLevel: 1,
    inventory: { noodle: 20, brine: 2, guoshao: 10, meat: 10, condiment: 10 },
    soldTodayForSku: 0,
  })
  assert.equal(drySale.ok, false)
  assert.equal(drySale.reason, 'INSUFFICIENT_STOCK')
  assert.equal(drySale.missingIngredient, 'brine')

  // 鲜湿粉批发需 Lv2 解锁
  const locked = settleRetailSale({
    sku: wetWholesale,
    quantity: 1,
    shopLevel: 1,
    inventory: createDefaultInventory(),
    soldTodayForSku: 0,
  })
  assert.equal(locked.ok, false)
  assert.equal(locked.reason, 'LEVEL_LOCKED')

  // 外售单价纯函数与 settleRetailSale 结算口径一致（Lv2 + 老卤升级抬价，批发维持原价）
  const lv2Bonuses = { priceMultiplier: 1.15, priceBonusFlat: 1.5 }
  assert.equal(getRetailUnitPrice(brineSku, lv2Bonuses), 17.6)
  assert.equal(getRetailUnitPrice(wetWholesale, lv2Bonuses), 12)
  const lv2Sale = settleRetailSale({
    sku: brineSku,
    quantity: 1,
    shopLevel: 2,
    inventory: createDefaultInventory(),
    soldTodayForSku: 0,
    bonuses: lv2Bonuses,
  })
  assert.equal(lv2Sale.ok, true)
  assert.equal(lv2Sale.gross, getRetailUnitPrice(brineSku, lv2Bonuses))
})

test('每日闭店结算、成就解锁新粉品、升级曲线与纯事件总线', () => {
  const store = createMifenStore({ memoryOnly: true })
  const eco = createMifenEconomy(store, recipesData)
  const seenEvents = []
  eco.events.on('dine_in:settled', () => seenEvents.push('dine_in'))
  eco.events.on('delivery:completed', () => seenEvents.push('delivery'))
  eco.events.on('retail:sold', () => seenEvents.push('retail'))
  eco.events.on('day:settled', () => seenEvents.push('day'))
  eco.events.on('recipe:unlocked', p => seenEvents.push(`unlock:${p.recipeId}`))

  // 初始仅 8 道基础粉品可用
  assert.equal(eco.getAvailableRecipes().length, 8)
  assert.equal(ECONOMY_UI_SLOTS.actions.length, 4)

  // 早市出 12 碗触发「早市开门红」并解锁桂林三鲜煮粉
  for (let i = 0; i < 12; i++) {
    eco.recordDineInSale({ recipeId: 'lucai_2', stars: 3, hour: 7.5 })
  }
  assert.ok(seenEvents.includes('unlock:sanxian_mifen'))
  assert.equal(eco.getAvailableRecipes().length, 9)

  // 跑 1 单外卖 + 1 份外售 + 闭店结算
  const ord = eco.acceptDeliveryOrder({ recipeId: 'double_combo', zoneId: 'zone_shizijie' })
  assert.ok(ord)
  const dRes = eco.completeDeliveryOrder({ orderId: ord.id, elapsedSec: 32, stars: 3 })
  assert.equal(dRes?.ok, true)
  const rRes = eco.sellRetailSku('sku_brine_bottle', 2)
  assert.equal(rRes?.ok, true)

  const closed = eco.closeDay()
  assert.equal(closed.nextDay, 2)
  assert.ok(closed.ledger.rushBonus > 0)
  assert.ok(closed.ledger.fixedOverhead === 8)
  assert.ok(closed.ledger.spoilageLoss > 0)
  assert.equal(closed.threeStreamsPositive, true)
  assert.ok(seenEvents.includes('day'))

  // 升级推荐曲线与回本周期校验
  const bonuses = computeShopBonuses(store.getState(), recipesData.upgrades)
  assert.ok(bonuses.priceMultiplier >= 1)
  const curve = getUpgradeProgressionCurve(store.getState(), recipesData.upgrades)
  assert.ok(curve.length >= 6)
  assert.ok(estimateUpgradePaybackDays(recipesData.upgrades.find(u => u.id === 'eq_twin_boiler')) <= 2.0)

  // 独立验证成就与新粉品解锁纯函数
  const highState = { ...createDefaultMifenState(), reputation: 4.7, totalDeliveries: 6 }
  const ev = evaluateAchievements(highState, recipesData.achievements)
  assert.ok(ev.unlockedRecipeIds.includes('brisket_lucai'))
  assert.ok(ev.unlockedRecipeIds.includes('you_cha_combo'))
  assert.equal(getAvailableRecipes(recipesData.recipes, [...highState.unlockedRecipes, ...ev.unlockedRecipeIds]).length, 10)

  // 平衡校验边界：单线 80% 必须被判失衡
  const skewed = checkRevenueStreamBalance({ dine_in: 80, delivery: 10, retail: 10 })
  assert.equal(skewed.balanced, false)

  // 早市若有顾客气走（recordCustomerLeftAngry），闭店无阻畅行奖金必须归零
  const dropStore = createMifenStore({ memoryOnly: true })
  const dropEco = createMifenEconomy(dropStore, recipesData)
  for (let i = 0; i < 5; i++) {
    dropEco.recordDineInSale({ recipeId: 'lucai_2', stars: 3, hour: 7.5 })
  }
  dropStore.recordCustomerLeftAngry()
  const dropClosed = dropEco.closeDay()
  assert.equal(dropClosed.ledger.rushBonus, 0)
})

test('k9 · 模拟 3 个游戏日跑出收入曲线：三种玩法均正收益且无一家独大', () => {
  const sim = simulateThreeDays(recipesData)
  assert.equal(sim.days.length, 3)

  for (const d of sim.days) {
    assert.ok(d.netByStream.dine_in > 0, `Day ${d.day} 堂食净利应 > 0，实际 ${d.netByStream.dine_in}`)
    assert.ok(d.netByStream.delivery > 0, `Day ${d.day} 外卖净利应 > 0，实际 ${d.netByStream.delivery}`)
    assert.ok(d.netByStream.retail > 0, `Day ${d.day} 外售净利应 > 0，实际 ${d.netByStream.retail}`)
    assert.ok(d.totalNetProfit > 0, `Day ${d.day} 当日总净利应 > 0，实际 ${d.totalNetProfit}`)
    assert.ok(d.streamShares.dine_in <= 0.65, `Day ${d.day} 堂食占比不能一家独大，实际 ${d.streamShares.dine_in}`)
    assert.ok(d.streamShares.delivery <= 0.65, `Day ${d.day} 外卖占比不能一家独大，实际 ${d.streamShares.delivery}`)
    assert.ok(d.streamShares.retail <= 0.65, `Day ${d.day} 外售占比不能一家独大，实际 ${d.streamShares.retail}`)
  }

  assert.equal(sim.perDayBalanced, true)
  assert.equal(sim.cumulativeBalance.allPositive, true)
  assert.equal(sim.cumulativeBalance.balanced, true)
  assert.ok(sim.endingShopLevel >= 2, `3 日内至少应自然扩店至 Lv2，实际 Lv${sim.endingShopLevel}`)
  assert.ok(sim.unlockedRecipes.length >= 10, `3 日内应通过成就解锁新粉品，实际 ${sim.unlockedRecipes.length} 款`)

  // 打印可读的 3 日收入曲线供验收核查
  const summary = sim.days.map(d => ({
    day: d.day,
    lv: d.shopLevel,
    dine_in: d.netByStream.dine_in,
    delivery: d.netByStream.delivery,
    retail: d.netByStream.retail,
    shares: d.streamShares,
    netProfit: d.totalNetProfit,
    endFunds: d.endingFunds,
  }))
  console.log('[3-DAY-CURVE]', JSON.stringify({ days: summary, total: sim.cumulativeNetByStream, shares: sim.cumulativeBalance.shares, shopLv: sim.endingShopLevel, unlockedRecipes: sim.unlockedRecipes.length }))
})
