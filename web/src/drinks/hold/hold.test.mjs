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
  DRINK_HOLD_STORAGE_KEY,
  DRINK_SIP_DURATION_SEC,
  DRINK_SIP_HOTKEY,
  DrinkHoldSession,
  ORIGIN_MAIN_KEY_AUDIT,
  evaluateHoldHostAction,
  mountDrinkHoldHud,
  readHoldHostState,
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
  const tea = getDrinkById('mango_pomelo_sago') // ¥10

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
  assert.equal(poor.deficit, 5)
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
  const item = getDrinkById('pearl_milk_tea') // ¥6

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
  assert.equal(results[0].charged, 6)
  assert.equal(results[0].balanceAfter, 24)
  assert.ok(results[0].txId)

  for (let i = 1; i < results.length; i++) {
    assert.equal(results[i].ok, true)
    assert.equal(results[i].code, 'IDEMPOTENT_REPLAY')
    assert.equal(results[i].charged, 0)
    assert.equal(results[i].balanceAfter, 24)
    assert.equal(results[i].txId, results[0].txId)
  }
  assert.equal(wallet.getBalance(), 24)
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
  assert.equal(secondCup.charged, 12)
  assert.equal(secondCup.balanceAfter, 12)

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
  assert.equal(mismatch.expectedUnitPrice, 6)
  assert.equal(wallet.getBalance(), 12)

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
  assert.equal(wallet.getBalance(), 12)
  assert.equal(getPersistedSave().money, 12)
  setFailPersist(false)

  const refund1 = refundDrinkWithWallet(
    {
      menuItemId: item.id,
      quantity: 2,
      amount: 12,
      idempotencyKey: 'second_order_key',
      reason: 'shop_closed',
    },
    wallet,
    3400,
  )
  assert.equal(refund1.ok, true)
  assert.equal(refund1.refunded, 12)
  assert.equal(refund1.balanceAfter, 24)

  const refund2 = refundDrinkWithWallet(
    {
      menuItemId: item.id,
      quantity: 2,
      amount: 12,
      idempotencyKey: 'second_order_key',
      reason: 'shop_closed',
    },
    wallet,
    3401,
  )
  assert.equal(refund2.ok, true)
  assert.equal(refund2.code, 'IDEMPOTENT_REPLAY')
  assert.equal(refund2.refunded, 0)
  assert.equal(wallet.getBalance(), 24)

  // 未购买过的订单退款与超额退款均被拒绝
  const fakeRefund = refundDrinkWithWallet(
    {
      menuItemId: item.id,
      quantity: 1,
      amount: 6,
      idempotencyKey: 'never_paid_key',
      reason: 'fake',
    },
    wallet,
    3402,
  )
  assert.equal(fakeRefund.ok, false)
  assert.equal(fakeRefund.code, 'PURCHASE_NOT_FOUND')
  assert.equal(wallet.getBalance(), 24)

  const buyOne = purchaseDrinkWithWallet(
    {
      menuItemId: 'ice_lemon_water',
      quantity: 1,
      expectedUnitPrice: 4,
      idempotencyKey: 'single_cup_key',
    },
    wallet,
    3410,
  )
  assert.equal(buyOne.ok, true)
  assert.equal(wallet.getBalance(), 20)

  const overRefund = refundDrinkWithWallet(
    {
      menuItemId: 'ice_lemon_water',
      quantity: 1,
      amount: 10,
      idempotencyKey: 'single_cup_key',
      reason: 'over',
    },
    wallet,
    3411,
  )
  assert.equal(overRefund.ok, false)
  assert.equal(overRefund.code, 'AMOUNT_EXCEEDS_CHARGE')
  assert.equal(wallet.getBalance(), 20)
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
    mod.resetSaveForTesting(9, store) // 主钱包 ¥9

    const r1 = mod.purchaseDrink({ menuItemId: 'pearl_milk_tea', quantity: 1, expectedUnitPrice: 6, idempotencyKey: 'real_buy_1' })
    assert.equal(r1.ok, true)
    assert.equal(r1.charged, 6)
    assert.equal(mod.getState().money, 3)

    // 重复点击同一 idempotencyKey 不重扣
    const r1Dup = mod.purchaseDrink({ menuItemId: 'pearl_milk_tea', quantity: 1, expectedUnitPrice: 6, idempotencyKey: 'real_buy_1' })
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

test('手捧饮品刷新恢复 + 键位避让(KeyY/KeyH让位给KeyI) + 骑车自动收杯 + 拍照暂隐', () => {
  const mem = new Map()
  const storage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)) },
    removeItem: k => { mem.delete(k) },
  }

  // 1) 刷新恢复：拿 ¥6 珍珠奶茶喝两口 -> 重建 DrinkHoldSession 自动恢复剩余 3/5 口与液位 0.6
  const milkTea = getDrinkById('pearl_milk_tea')
  const s1 = new DrinkHoldSession({ storage, resolveDrink: getDrinkById })
  s1.pickup(milkTea, { ice: '少冰', sugar: '七分糖' }, 'ord_refresh_1')
  assert.equal(s1.sip().ok, true)
  for (let k = 0; k < 10; k++) s1.step(0.2)
  assert.equal(s1.sip().ok, true)
  assert.equal(s1.getSnapshot().sipsLeft, 3)
  assert.ok(mem.has(DRINK_HOLD_STORAGE_KEY))

  const restored = new DrinkHoldSession({ storage, resolveDrink: getDrinkById })
  const rSnap = restored.getSnapshot()
  assert.equal(rSnap.active, true)
  assert.equal(rSnap.state, 'holding')
  assert.equal(rSnap.drink?.id, 'pearl_milk_tea')
  assert.equal(rSnap.sipsLeft, 3)
  assert.equal(rSnap.sipsTotal, 5)
  assert.equal(rSnap.fillRatio, 0.6)
  assert.equal(rSnap.customization?.ice, '少冰')

  // 收杯后清档，刷新不再恢复
  restored.discard()
  assert.equal(mem.has(DRINK_HOLD_STORAGE_KEY), false)
  const afterDiscard = new DrinkHoldSession({ storage, resolveDrink: getDrinkById })
  assert.equal(afterDiscard.getSnapshot().active, false)

  // 2) origin/main 键位避让 + 触屏按钮 + 拍照暂隐 + 骑车/开车自动收杯
  assert.equal(ORIGIN_MAIN_KEY_AUDIT.chosen, 'KeyI')
  assert.equal(DRINK_SIP_HOTKEY, 'KeyI')

  const makeEl = tag => {
    const attrs = new Map()
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      hidden: false,
      disabled: false,
      dataset: {},
      children: [],
      _listeners: new Map(),
      _innerHTML: '',
      _textContent: '',
      setAttribute(k, v) { attrs.set(k, String(v)) },
      getAttribute(k) { return attrs.get(k) ?? null },
      hasAttribute(k) { return attrs.has(k) },
      removeAttribute(k) { attrs.delete(k) },
      append(...nodes) { el.children.push(...nodes) },
      remove() {},
      addEventListener(t, fn) {
        if (!el._listeners.has(t)) el._listeners.set(t, [])
        el._listeners.get(t).push(fn)
      },
      querySelector(sel) {
        const m = sel.match(/^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/)
        if (!m) return null
        return el.children.find(c => (m[2] === undefined ? c.hasAttribute(m[1]) : c.getAttribute(m[1]) === m[2])) ?? null
      },
      set innerHTML(v) {
        el._innerHTML = String(v)
        const matches = [...el._innerHTML.matchAll(/<(span|button)\b([^>]*)>/g)]
        el.children = matches.map(m => {
          const ch = makeEl(m[1])
          for (const am of m[2].matchAll(/([a-zA-Z0-9_-]+)(?:="([^"]*)")?/g)) {
            ch.setAttribute(am[1], am[2] ?? '')
          }
          return ch
        })
      },
      get innerHTML() { return el._innerHTML },
      set textContent(v) { el._textContent = String(v) },
      get textContent() { return el._textContent },
    }
    return el
  }

  const winListeners = new Map()
  const prevDoc = globalThis.document
  const prevWin = globalThis.window
  try {
    const body = makeEl('body')
    globalThis.document = { body, createElement: tag => makeEl(tag) }
    globalThis.window = {
      addEventListener: (t, fn) => {
        if (!winListeners.has(t)) winListeners.set(t, [])
        winListeners.get(t).push(fn)
      },
      removeEventListener: (t, fn) => {
        winListeners.set(t, (winListeners.get(t) ?? []).filter(x => x !== fn))
      },
    }

    const s2 = new DrinkHoldSession({ storage, resolveDrink: getDrinkById })
    s2.pickup(milkTea)
    const hud = mountDrinkHoldHud({ session: s2 })
    assert.equal(hud.hotkey, 'KeyI')
    assert.equal(hud.root.hidden, false)

    const fireKey = code => {
      for (const fn of winListeners.get('keydown') ?? []) {
        fn({ code, repeat: false, altKey: false, ctrlKey: false, metaKey: false, target: null })
      }
    }

    // KeyY (useItem) 与 KeyH (车铃) 绝不误触发喝饮料
    fireKey('KeyY')
    fireKey('KeyH')
    assert.equal(s2.getSnapshot().sipsLeft, 5)

    // 拍照模式禁用快捷键且暂隐悬浮条，退出拍照恢复可喝
    body.dataset.photo = 'on'
    hud.syncHostState()
    assert.equal(hud.root.hidden, true)
    fireKey('KeyI')
    assert.equal(s2.getSnapshot().sipsLeft, 5)

    delete body.dataset.photo
    hud.syncHostState()
    assert.equal(hud.root.hidden, false)

    // 正常按 KeyI 触发喝一口
    fireKey('KeyI')
    assert.equal(s2.getSnapshot().sipsLeft, 4)

    // 骑车/开车 (data-aboard) 自动收杯暂存：藏掉悬浮条、禁喝，下车后恢复同杯余量；主动点收起才清档
    body.setAttribute('data-aboard', '')
    const resAboard = evaluateHoldHostAction(s2, readHoldHostState(body))
    hud.syncHostState()
    assert.equal(resAboard, 'stowed')
    assert.equal(s2.getSnapshot().paused, true)
    assert.equal(s2.sip().code, 'PAUSED')
    assert.equal(hud.root.hidden, true)

    body.removeAttribute('data-aboard')
    const resFoot = evaluateHoldHostAction(s2, readHoldHostState(body))
    hud.syncHostState()
    assert.equal(resFoot, 'active')
    assert.equal(s2.getSnapshot().paused, false)
    assert.equal(s2.getSnapshot().sipsLeft, 4)
    assert.equal(hud.root.hidden, false)

    s2.discard()
    assert.equal(mem.has(DRINK_HOLD_STORAGE_KEY), false)

    hud.dispose()
  } finally {
    globalThis.document = prevDoc
    globalThis.window = prevWin
  }
})
