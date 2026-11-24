import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_DRINKS_SKIN,
  DEFAULT_MASTER_DRINKS_SKIN,
  DRINK_CATEGORIES,
  DRINKS_MENU,
  DRINKS_MENU_BY_ID,
  MAX_DRINK_ORDER_QUANTITY,
  applyGbotPriceBackfill,
  createNpcDrinksSkin,
  createPropsDrinkSkin,
  createShopDrinksSkin,
  createUiDrinksSkin,
  defaultDrinkCustomization,
  formatDrinkDuration,
  getDrinkById,
  listDrinksByCategory,
  normalizeDrinkQuantity,
  quoteDrinkTotal,
  resolveDrinksMasterSkin,
  toShopMenuBoardRows,
  toSimDrinkMenuItems,
} from './index.ts'
import { DEFAULT_DRINKS_MENU } from '../sim/menu.ts'
import { DEFAULT_DRINK_SKIN } from '../props/skins.ts'
import { DEFAULT_DRINKS_NPC_SKIN } from '../npc/palette.ts'

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

  // toSimDrinkMenuItems & toShopMenuBoardRows 派生自唯一菜单
  const simDerived = toSimDrinkMenuItems()
  assert.equal(simDerived.length, DRINKS_MENU.length)
  assert.equal(simDerived[0].id, DRINKS_MENU[0].id)
  const boardRows = toShopMenuBoardRows()
  assert.equal(boardRows.length, 6)
  assert.equal(boardRows[0][1], `¥${DRINKS_MENU[0].price}`)
})

test('drinks/menu/skin.ts 作为唯一皮肤入口，可 1:1 生成 props、npc、shop、ui 默认皮肤且零真商标', () => {
  const propsSkin = createPropsDrinkSkin()
  const { sleeveTextureFactory: _ignored, ...expectedPropsSkin } = DEFAULT_DRINK_SKIN
  assert.deepEqual(propsSkin, expectedPropsSkin)

  const shopPropSkin = createPropsDrinkSkin(DEFAULT_MASTER_DRINKS_SKIN, 'shop')
  assert.deepEqual(shopPropSkin, { ...expectedPropsSkin, brandLabel: '王城冰茶铺' })

  const npcSkin = createNpcDrinksSkin()
  assert.deepEqual(npcSkin, DEFAULT_DRINKS_NPC_SKIN)

  const shopSkin = createShopDrinksSkin()
  assert.deepEqual(shopSkin.propSkin, shopPropSkin)
  assert.equal(shopSkin.signboard.menuBoardHeader, '王城冰茶铺 · 招牌饮品')
  assert.equal(shopSkin.mascot.crownColor, DEFAULT_MASTER_DRINKS_SKIN.sleeve.goldHex)
  assert.equal(shopSkin.mascot.scarfColor, DEFAULT_MASTER_DRINKS_SKIN.sleeve.primaryHex)

  const uiSkin = createUiDrinksSkin()
  assert.deepEqual(uiSkin, DEFAULT_DRINKS_SKIN)

  const customMaster = resolveDrinksMasterSkin({ signboard: { displayName: '漓江鲜饮' } })
  assert.equal(createPropsDrinkSkin(customMaster, 'shop').brandLabel, '漓江鲜饮')
  assert.equal(JSON.stringify(DEFAULT_MASTER_DRINKS_SKIN).includes('蜜雪'), false)
})

test('Gbot 实价回填必须附来源URL与日期才转已核，否则维持待核', () => {
  const rejected = applyGbotPriceBackfill([
    { id: 'ice_lemon_water', verifiedPrice: 5, sourceUrl: '', verifiedAt: '2026-11-24' },
  ])
  const stillPending = rejected.find(x => x.id === 'ice_lemon_water')
  assert.equal(stillPending.price, 4)
  assert.equal(stillPending.priceStatus, '待核')
  assert.equal(stillPending.priceVerified, false)

  const accepted = applyGbotPriceBackfill([
    {
      id: 'ice_lemon_water',
      verifiedPrice: 5,
      sourceUrl: 'https://example.com/wangcheng-menu',
      verifiedAt: '2026-11-24',
      note: '实拍菜单',
    },
  ])
  const updated = accepted.find(x => x.id === 'ice_lemon_water')
  assert.equal(updated.price, 5)
  assert.equal(updated.priceStatus, '已核')
  assert.equal(updated.priceVerified, true)
  assert.match(updated.priceSource, /https:\/\/example\.com\/wangcheng-menu/)
})
