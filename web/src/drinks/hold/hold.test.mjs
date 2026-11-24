import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  _withDrinkInFlightLockForTest,
  createDrinkLockKey,
  purchaseDrinkWithWallet,
  refundDrinkWithWallet,
} from './payment-core.ts'
import {
  DRINK_FINISH_FADE_SEC,
  DRINK_SIP_DURATION_SEC,
  DrinkHoldSession,
} from './hold-controller.ts'
import { DEFAULT_DRINKS_SKIN, getDrinkById } from '../menu/menu.ts'

function createMockWallet(initialMoney, opts) {
  let persisted = { money: initialMoney, updatedAt: 1000, economy: { txHistoryRing: [] } }
  let memoryMoney = initialMoney
  let failPersist = Boolean(opts?.failPersist)
  const events = []

  const clone = src => ({
    money: src.money,
    updatedAt: src.updatedAt,
    economy: { txHistoryRing: src.economy.txHistoryRing.map(x => ({ ...x })) },
  })

  const wallet = {
    getBalance: () => memoryMoney,
    getSnapshot: () => clone(persisted),
    cloneSnapshot: clone,
    persist: next => {
      if (failPersist) return false
      persisted = clone(next)
      return true
    },
    commitMoney: money => {
      memoryMoney = money
    },
    emitMoneyChange: (delta, balance) => {
      events.push({ kind: 'money:change', delta, balance })
    },
    emitShopBuy: (_shopId, _itemId, price) => {
      events.push({ kind: 'shop:buy', price })
    },
  }

  return {
    wallet,
    events,
    setFailPersist: on => { failPersist = on },
    getPersistedSave: () => persisted,
  }
}

test('主钱包饮品扣款：余额不足精确拒绝且零扣款，不扣负余额', () => {
  const { wallet, events, getPersistedSave } = createMockWallet(5)
  const tea = getDrinkById('mango_pomelo_sago') // ¥9

  const poor = purchaseDrinkWithWallet(
    {
      menuItemId: tea.id,
      quantity: 1,
      expectedUnitPrice: tea.price,
      idempotencyKey: 'drink_poor_1',
    },
    wallet,
    2000,
  )

  assert.equal(poor.ok, false)
  assert.equal(poor.code, 'INSUFFICIENT_FUNDS')
  assert.equal(poor.charged, 0)
  assert.equal(poor.balanceAfter, 5)
  assert.equal(poor.deficit, 4)
  assert.equal(wallet.getBalance(), 5)
  assert.equal(getPersistedSave().money, 5)
  assert.equal(events.length, 0)

  const twoPoor = purchaseDrinkWithWallet(
    {
      menuItemId: 'ice_lemon_water', // ¥4 x 2 = ¥8
      quantity: 2,
      expectedUnitPrice: 4,
      idempotencyKey: 'drink_poor_qty2',
    },
    wallet,
    2001,
  )
  assert.equal(twoPoor.ok, false)
  assert.equal(twoPoor.code, 'INSUFFICIENT_FUNDS')
  assert.equal(twoPoor.deficit, 3)
  assert.equal(wallet.getBalance(), 5)
})

test('主钱包饮品扣款：付款重复点击幂等拦截 + 同步重入锁 + 写盘失败回滚', () => {
  const { wallet, events, setFailPersist, getPersistedSave } = createMockWallet(30)
  const item = getDrinkById('pearl_milk_tea') // ¥7

  const lockKey = createDrinkLockKey(DEFAULT_DRINKS_SKIN.shopId, item.id, 'burst_key_1')
  const locked = _withDrinkInFlightLockForTest(lockKey, () =>
    purchaseDrinkWithWallet(
      {
        menuItemId: item.id,
        quantity: 1,
        expectedUnitPrice: item.price,
        idempotencyKey: 'burst_key_1',
      },
      wallet,
      3000,
    ),
  )
  assert.equal(locked.ok, false)
  assert.equal(locked.code, 'IN_FLIGHT')
  assert.equal(wallet.getBalance(), 30)

  const results = []
  for (let i = 0; i < 10; i++) {
    results.push(
      purchaseDrinkWithWallet(
        {
          menuItemId: item.id,
          quantity: 1,
          expectedUnitPrice: item.price,
          idempotencyKey: 'burst_key_1',
        },
        wallet,
        3010 + i,
      ),
    )
  }

  assert.equal(results[0].ok, true)
  assert.equal(results[0].code, 'OK')
  assert.equal(results[0].charged, 7)
  assert.equal(results[0].balanceAfter, 23)
  assert.ok(results[0].txId)

  for (let i = 1; i < results.length; i++) {
    assert.equal(results[i].ok, true)
    assert.equal(results[i].code, 'IDEMPOTENT_REPLAY')
    assert.equal(results[i].charged, 0)
    assert.equal(results[i].balanceAfter, 23)
    assert.equal(results[i].txId, results[0].txId)
  }
  assert.equal(wallet.getBalance(), 23)
  assert.equal(events.filter(e => e.kind === 'shop:buy').length, 1)

  const secondCup = purchaseDrinkWithWallet(
    {
      menuItemId: item.id,
      quantity: 2,
      expectedUnitPrice: item.price,
      idempotencyKey: 'second_order_key',
    },
    wallet,
    3100,
  )
  assert.equal(secondCup.ok, true)
  assert.equal(secondCup.charged, 14)
  assert.equal(secondCup.balanceAfter, 9)

  const mismatch = purchaseDrinkWithWallet(
    {
      menuItemId: item.id,
      quantity: 1,
      expectedUnitPrice: 1,
      idempotencyKey: 'stale_price_key',
    },
    wallet,
    3200,
  )
  assert.equal(mismatch.ok, false)
  assert.equal(mismatch.code, 'PRICE_MISMATCH')
  assert.equal(mismatch.expectedUnitPrice, 7)
  assert.equal(wallet.getBalance(), 9)

  setFailPersist(true)
  const failRes = purchaseDrinkWithWallet(
    {
      menuItemId: 'ice_lemon_water',
      quantity: 1,
      expectedUnitPrice: 4,
      idempotencyKey: 'persist_fail_key',
    },
    wallet,
    3300,
  )
  assert.equal(failRes.ok, false)
  assert.equal(failRes.code, 'PERSIST_FAILED')
  assert.equal(wallet.getBalance(), 9)
  assert.equal(getPersistedSave().money, 9)
  setFailPersist(false)

  const refund1 = refundDrinkWithWallet(
    {
      menuItemId: item.id,
      quantity: 2,
      amount: 14,
      idempotencyKey: 'second_order_key',
      reason: 'shop_closed',
    },
    wallet,
    3400,
  )
  assert.equal(refund1.ok, true)
  assert.equal(refund1.refunded, 14)
  assert.equal(refund1.balanceAfter, 23)

  const refund2 = refundDrinkWithWallet(
    {
      menuItemId: item.id,
      quantity: 2,
      amount: 14,
      idempotencyKey: 'second_order_key',
      reason: 'shop_closed',
    },
    wallet,
    3401,
  )
  assert.equal(refund2.ok, true)
  assert.equal(refund2.code, 'IDEMPOTENT_REPLAY')
  assert.equal(refund2.refunded, 0)
  assert.equal(wallet.getBalance(), 23)
})

test('真实 glol.save.v1 钱包联调：验证 payment.ts 扣款写盘、不碰 glol.mifen.v1 且余额不足拒绝', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'glol-drinks-pay-'))
  try {
    const gameOut = join(dir, 'game.mjs')
    const payOut = join(dir, 'pay.mjs')
    await Promise.all([
      build({ entryPoints: ['web/src/game/index.ts'], outfile: gameOut, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' }),
      build({ entryPoints: ['web/src/drinks/hold/payment.ts'], outfile: payOut, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' }),
    ])
    // 注意：bundle 各自打包会有独立模块状态，因此联合入口一次性打包来测真实共享状态
    const combinedOut = join(dir, 'combined.mjs')
    const entry = join(dir, 'entry.ts')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(
      entry,
      `
export * from '${join(process.cwd(), 'web/src/game/index.ts').replace(/\\/g, '/')}'
export { purchaseDrink, refundDrinkPurchase } from '${join(process.cwd(), 'web/src/drinks/hold/payment.ts').replace(/\\/g, '/')}'
`,
    )
    await build({ entryPoints: [entry], outfile: combinedOut, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' })
    const mod = await import(pathToFileURL(combinedOut).href)

    const map = new Map()
    map.set('glol.mifen.v1', JSON.stringify({ funds: 888 }))
    const store = {
      getItem: k => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)) },
      removeItem: k => { map.delete(k) },
    }
    mod.setSaveStorageForTest(store)
    mod._resetGameStateForTest()
    mod.resetSaveForTesting(10, store) // 主钱包 ¥10

    const r1 = mod.purchaseDrink({ menuItemId: 'pearl_milk_tea', quantity: 1, expectedUnitPrice: 7, idempotencyKey: 'real_buy_1' })
    assert.equal(r1.ok, true)
    assert.equal(r1.charged, 7)
    assert.equal(mod.getState().money, 3)

    // 重复点击同一 idempotencyKey 不重扣
    const r1Dup = mod.purchaseDrink({ menuItemId: 'pearl_milk_tea', quantity: 1, expectedUnitPrice: 7, idempotencyKey: 'real_buy_1' })
    assert.equal(r1Dup.code, 'IDEMPOTENT_REPLAY')
    assert.equal(r1Dup.charged, 0)
    assert.equal(mod.getState().money, 3)

    // 再点一杯 ¥4，主钱包只剩 ¥3 -> 余额不足拒绝
    const r2Poor = mod.purchaseDrink({ menuItemId: 'ice_lemon_water', quantity: 1, expectedUnitPrice: 4, idempotencyKey: 'real_buy_2' })
    assert.equal(r2Poor.ok, false)
    assert.equal(r2Poor.code, 'INSUFFICIENT_FUNDS')
    assert.equal(r2Poor.deficit, 1)
    assert.equal(mod.getState().money, 3)

    // 持久化落地到 glol.save.v1，且米粉营业款 glol.mifen.v1 丝毫未动
    const savedMain = JSON.parse(map.get('glol.save.v1'))
    assert.equal(savedMain.money, 3)
    assert.equal(JSON.parse(map.get('glol.mifen.v1')).funds, 888)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('手捧饮品状态机：空手不可喝、拿杯后分口喝、喝期间防连点、喝完自动收回', () => {
  const session = new DrinkHoldSession()
  const lemon = getDrinkById('ice_lemon_water')

  assert.equal(session.getSnapshot().active, false)
  assert.equal(session.sip().code, 'NO_DRINK')

  const s0 = session.pickup(lemon, { ice: '少冰', sugar: '七分糖' }, 'ord_1')
  assert.equal(s0.active, true)
  assert.equal(s0.state, 'holding')
  assert.equal(s0.sipsLeft, lemon.sipsCount)
  assert.equal(s0.fillRatio, 1)
  assert.equal(s0.canSip, true)
  assert.equal(s0.syncState.holding, true)
  assert.equal(s0.syncState.drinkId, 'ice_lemon_water')

  const sip1 = session.sip()
  assert.equal(sip1.ok, true)
  assert.equal(sip1.sipsLeft, lemon.sipsCount - 1)
  const dupSip = session.sip()
  assert.equal(dupSip.ok, false)
  assert.equal(dupSip.code, 'SIP_IN_PROGRESS')

  for (let k = 0; k < 3; k++) session.step(0.2)
  const midSnap = session.getSnapshot()
  assert.equal(midSnap.state, 'drinking')
  assert.ok(midSnap.sipProgress > 0.9)
  assert.ok(midSnap.fillRatio < 1 && midSnap.fillRatio > (lemon.sipsCount - 1) / lemon.sipsCount - 0.01)

  for (let k = 0; k < 4; k++) session.step(0.2)
  assert.equal(session.getSnapshot().state, 'holding')
  assert.equal(session.getSnapshot().canSip, true)

  session.setPaused(true)
  assert.equal(session.sip().code, 'PAUSED')
  session.setPaused(false)

  for (let i = 1; i < lemon.sipsCount; i++) {
    const r = session.sip()
    assert.equal(r.ok, true)
    let finishedNow = false
    for (let k = 0; k < 20; k++) {
      if (session.step(0.1)) finishedNow = true
    }
    if (i < lemon.sipsCount - 1) {
      assert.equal(finishedNow, false)
      assert.equal(session.getSnapshot().state, 'holding')
    } else {
      assert.equal(finishedNow || session.getSnapshot().state === 'idle', true)
    }
  }
  for (let k = 0; k < 3; k++) session.step(0.2)
  const endSnap = session.getSnapshot()
  assert.equal(endSnap.state, 'idle')
  assert.equal(endSnap.active, false)
  assert.equal(endSnap.sipsLeft, 0)
  assert.equal(endSnap.fillRatio, 0)
  assert.equal(endSnap.syncState.holding, false)

  session.pickup(lemon)
  assert.equal(session.getSnapshot().active, true)
  assert.equal(session.discard(), true)
  assert.equal(session.getSnapshot().active, false)
  assert.equal(session.discard(), false)
})
