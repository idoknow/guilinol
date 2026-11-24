import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_DRINKS_SKIN,
  DRINK_CATEGORIES,
  DRINKS_MENU,
  DRINKS_MENU_BY_ID,
  MAX_DRINK_ORDER_QUANTITY,
  defaultDrinkCustomization,
  formatDrinkDuration,
  getDrinkById,
  listDrinksByCategory,
  normalizeDrinkQuantity,
  quoteDrinkTotal,
} from './menu.ts'
import { DEFAULT_DRINKS_MENU } from '../sim/menu.ts'

test('drinks/menu 目录字段完整、价格标待核、步骤时长之和精确匹配总时长', () => {
  assert.ok(DRINKS_MENU.length >= 10, 'catalog should cover all standard shop drinks')
  const seenIds = new Set()
  const hexRe = /^#[0-9a-fA-F]{6}$/

  for (const item of DRINKS_MENU) {
    assert.ok(item.id.length > 0 && !seenIds.has(item.id), `duplicate or empty id: ${item.id}`)
    seenIds.add(item.id)
    assert.ok(item.name.trim().length > 0, `empty name for ${item.id}`)
    assert.equal(Number.isSafeInteger(item.price) && item.price > 0, true, `integer yuan price required for ${item.id}`)
    assert.equal(item.priceStatus, '待核', `unverified price must be marked 待核 for ${item.id}`)
    assert.equal(item.priceVerified, false, `priceVerified must stay false until Gbot audit for ${item.id}`)
    assert.ok(item.durationSec > 0 && item.durationSec === item.prepSec, `durationSec must equal prepSec for ${item.id}`)
    assert.ok(item.steps.length >= 2, `at least 2 prep steps required for ${item.id}`)
    const stepSum = item.steps.reduce((acc, s) => acc + s.durationSec, 0)
    assert.ok(Math.abs(stepSum - item.durationSec) < 1e-6, `step durations ${stepSum} != ${item.durationSec} for ${item.id}`)
    assert.match(item.cupColor, hexRe, `valid cupColor hex for ${item.id}`)
    assert.match(item.accentColor, hexRe, `valid accentColor hex for ${item.id}`)
    assert.ok(item.sipsCount >= 3, `sipsCount >= 3 for ${item.id}`)
    assert.ok(item.iceOptions.length >= 1 && item.sugarOptions.length >= 1, `customization options required for ${item.id}`)
  }
})

test('drinks/menu 与 sim/menu.ts 1:1 ID/价格/时长契约对齐且使用原创皮肤', () => {
  assert.equal(DEFAULT_DRINKS_SKIN.isOriginalSkin, true)
  assert.equal(DEFAULT_DRINKS_SKIN.displayName.includes('蜜雪'), false, 'original skin must not hardcode real brand trademark')

  for (const simItem of DEFAULT_DRINKS_MENU) {
    const catItem = DRINKS_MENU_BY_ID[simItem.id]
    assert.ok(catItem, `sim item ${simItem.id} missing in drinks/menu/menu.ts`)
    assert.equal(catItem.name, simItem.name)
    assert.equal(catItem.category, simItem.category)
    assert.equal(catItem.price, simItem.price)
    assert.equal(catItem.prepSec, simItem.prepSec)
    assert.equal(catItem.stationKind, simItem.stationKind)
  }
})

test('drinks/menu 查询与计价辅助函数边界校验', () => {
  assert.equal(getDrinkById('ice_lemon_water')?.name, '冰鲜柠檬水')
  assert.equal(getDrinkById('unknown_drink'), undefined)

  assert.equal(listDrinksByCategory('all').length, DRINKS_MENU.length)
  for (const cat of DRINK_CATEGORIES) {
    if (cat.id === 'all') continue
    const list = listDrinksByCategory(cat.id)
    assert.ok(list.length > 0, `category ${cat.id} should not be empty`)
    assert.ok(list.every(item => item.category === cat.id))
  }

  assert.equal(normalizeDrinkQuantity(1), 1)
  assert.equal(normalizeDrinkQuantity(MAX_DRINK_ORDER_QUANTITY), MAX_DRINK_ORDER_QUANTITY)
  assert.equal(normalizeDrinkQuantity(0), null)
  assert.equal(normalizeDrinkQuantity(-1), null)
  assert.equal(normalizeDrinkQuantity(1.5), null)
  assert.equal(normalizeDrinkQuantity(MAX_DRINK_ORDER_QUANTITY + 1), null)

  assert.equal(quoteDrinkTotal('ice_lemon_water', 2), 8)
  assert.equal(quoteDrinkTotal('ice_lemon_water', 0), null)
  assert.equal(quoteDrinkTotal('missing', 1), null)

  const custom = defaultDrinkCustomization(getDrinkById('brown_sugar_milk'))
  assert.equal(custom.ice, '热饮')
  assert.equal(custom.sugar, '全糖')
  assert.equal(formatDrinkDuration(2.2), '2.2s')
  assert.equal(formatDrinkDuration(3.0), '3s')
})
