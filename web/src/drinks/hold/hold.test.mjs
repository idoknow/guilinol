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
  DRINK_SIP_HOTKEY,
  DRINK_SIP_LATENCY_SEC,
  DRINK_SIP_RAMP_SEC,
  DrinkHoldSession,
  ORIGIN_MAIN_KEY_AUDIT,
  evaluateHoldHostAction,
  mountDrinkHoldHud,
  readHoldHostState,
  resolveCupEmptyDurationSec,
} from './hold-controller.ts'
import { createDrinkCupModel } from './cup-model.ts'
import { createDrinkStrawAudio, DRINK_LOW_ENERGY_THRESHOLD } from './straw-audio.ts'
import { DEFAULT_DRINKS_SKIN, DRINKS_MENU, getDrinkById } from '../menu/menu.ts'

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

  // 未购买过的订单退款与超额退款均被拒绝
  const fakeRefund = refundDrinkWithWallet(
    {
      menuItemId: item.id,
      quantity: 1,
      amount: 7,
      idempotencyKey: 'never_paid_key',
      reason: 'fake',
    },
    wallet,
    3402,
  )
  assert.equal(fakeRefund.ok, false)
  assert.equal(fakeRefund.code, 'PURCHASE_NOT_FOUND')
  assert.equal(wallet.getBalance(), 23)

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
  assert.equal(wallet.getBalance(), 19)

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
  assert.equal(wallet.getBalance(), 19)
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

test('长按持续喝能量条连续扣减 + 松手即停 + 3D杯液面同步下降 + 吸管音效生命周期', () => {
  const session = new DrinkHoldSession({ storage: null })
  const lemon = getDrinkById('ice_lemon_water') // 700ml -> 5.4s 喝完
  const cup = createDrinkCupModel()
  cup.setDrink(lemon)
  const audio = createDrinkStrawAudio({ muted: true })

  // 空手不可启动
  assert.equal(session.getSnapshot().active, false)
  assert.equal(session.startDrinking().code, 'NO_DRINK')
  assert.equal(session.sip().code, 'NO_DRINK')

  // 取杯：100% 满格能量条，700ml
  const s0 = session.pickup(lemon, { ice: '少冰', sugar: '七分糖' }, 'ord_hold_1')
  assert.equal(s0.active, true)
  assert.equal(s0.state, 'holding')
  assert.equal(s0.energy, 1)
  assert.equal(s0.energyPct, 100)
  assert.equal(s0.fillRatio, 1)
  assert.equal(s0.drinking, false)

  // 长按开始持续喝 -> 前 DRINK_SIP_LATENCY_SEC 内抬杯蓄压不秒掉能量，随后平滑连续消耗
  assert.equal(session.startDrinking().ok, true)
  assert.equal(session.startDrinking().code, 'ALREADY_DRINKING')
  audio.triggerStrawPoke()
  audio.setDrinking(true, 1)

  // 验证起吸延迟手感（0.10s < 0.14s 抬杯阶段：手臂抬起但余量暂稳在 100%）
  session.step(0.1)
  assert.equal(session.getSnapshot().energy, 1)
  assert.ok(session.getSnapshot().sipProgress > 0.5)

  const energies = []
  for (let i = 0; i < 4; i++) {
    session.step(0.25)
    energies.push(session.getSnapshot().energy)
    cup.setFillRatio(session.getSnapshot().fillRatio)
  }
  // 验证能量严格连续递减（非整口阶跃），且符合蓄压曲线积分
  assert.ok(energies[0] > energies[1] && energies[1] > energies[2] && energies[2] > energies[3])
  const totalElapsed = 0.1 + 4 * 0.25
  const effectiveSec = totalElapsed - DRINK_SIP_LATENCY_SEC - DRINK_SIP_RAMP_SEC * 0.5
  const expectedAfter = 1 - effectiveSec / resolveCupEmptyDurationSec(lemon)
  assert.ok(Math.abs(energies[3] - expectedAfter) < 1e-4)
  assert.ok(session.getSnapshot().sipProgress > 0.8)

  // 松手立即停止：继续空转 2.0s 能量与液面一丝不动
  const frozenEnergy = session.getSnapshot().energy
  assert.equal(session.stopDrinking(), true)
  audio.setDrinking(false, frozenEnergy)
  assert.equal(session.stopDrinking(), false)
  for (let k = 0; k < 10; k++) session.step(0.2)
  assert.equal(session.getSnapshot().state, 'holding')
  assert.equal(session.getSnapshot().drinking, false)
  assert.equal(session.getSnapshot().energy, frozenEnergy)
  assert.equal(session.getSnapshot().sipProgress, 0)
  assert.equal(audio.getStats().active, false)
  assert.equal(audio.getStats().pokeCount, 1)
  assert.equal(audio.getStats().drawPulseCount, 1)
  assert.equal(audio.getStats().lowWarningCount, 0)

  // 暂停保护期间不可喝
  session.setPaused(true)
  assert.equal(session.startDrinking().code, 'PAUSED')
  assert.equal(session.sip().code, 'PAUSED')
  session.setPaused(false)

  // 继续长按跨过 DRINK_LOW_ENERGY_THRESHOLD -> 触发快空预警音一次且不刷屏 -> 喝空收回
  assert.equal(session.startDrinking().ok, true)
  let lowTriggeredCountDuringSip = 0
  let finishedNow = false
  for (let i = 0; i < 40; i++) {
    if (session.step(0.2)) finishedNow = true
    const snapNow = session.getSnapshot()
    if (snapNow.drinking) {
      audio.setDrinking(true, snapNow.energy)
      if (snapNow.energy <= DRINK_LOW_ENERGY_THRESHOLD) lowTriggeredCountDuringSip += 1
    }
    cup.setFillRatio(snapNow.fillRatio)
  }
  assert.equal(finishedNow, true)
  assert.ok(lowTriggeredCountDuringSip >= 1)
  assert.equal(audio.getStats().lowWarningCount, 1)
  audio.triggerComplete()
  const endSnap = session.getSnapshot()
  assert.equal(endSnap.state, 'idle')
  assert.equal(endSnap.active, false)
  assert.equal(endSnap.energy, 0)
  assert.equal(endSnap.fillRatio, 0)
  assert.equal(endSnap.syncState.holding, false)
  assert.equal(audio.getStats().completeCount, 1)

  // 10 款饮品均可在 3D 杯模正常切换，且冷饮含冷凝水珠、热饮/圣代关闭冷珠并切出瓦楞/碗型
  for (const item of DRINKS_MENU) {
    cup.setDrink(item)
    cup.setFillRatio(0.42)
    const cond = cup.group.getObjectByName('drinks-condensation')
    const ribs = cup.group.getObjectByName('drinks-corrugated-ribs')
    assert.ok(cond)
    assert.ok(ribs)
    if (item.id === 'brown_sugar_milk') {
      assert.equal(cond.visible, false)
      assert.equal(ribs.visible, true)
    } else if (item.id === 'sundae_cup') {
      assert.equal(cond.visible, false)
      assert.equal(ribs.visible, false)
    } else {
      assert.equal(cond.visible, true)
      assert.equal(ribs.visible, false)
    }
  }

  // 主动收起
  session.pickup(lemon)
  assert.equal(session.discard(), true)
  assert.equal(session.discard(), false)
  cup.dispose()
  audio.dispose()
})

test('手捧饮品刷新恢复(连续能量) + 键位避让(KeyY/KeyH让位给KeyI长按松手) + 骑车自动收杯 + 拍照暂隐', () => {
  const mem = new Map()
  const storage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)) },
    removeItem: k => { mem.delete(k) },
  }

  // 1) 刷新恢复：拿 ¥7 珍珠奶茶 (4.5s 喝完) 长按喝 1.35s 松手 -> 重建 session 精确恢复对应百分比
  const milkTea = getDrinkById('pearl_milk_tea')
  const s1 = new DrinkHoldSession({ storage, resolveDrink: getDrinkById })
  s1.pickup(milkTea, { ice: '少冰', sugar: '七分糖' }, 'ord_refresh_1')
  assert.equal(s1.startDrinking().ok, true)
  for (let k = 0; k < 9; k++) s1.step(0.15)
  s1.stopDrinking()
  const savedPct = s1.getSnapshot().energyPct
  const expectedSavedPct = Math.round((1 - (1.35 - DRINK_SIP_LATENCY_SEC - DRINK_SIP_RAMP_SEC * 0.5) / 4.5) * 100)
  assert.equal(savedPct, expectedSavedPct)
  assert.ok(mem.has(DRINK_HOLD_STORAGE_KEY))

  const restored = new DrinkHoldSession({ storage, resolveDrink: getDrinkById })
  const rSnap = restored.getSnapshot()
  assert.equal(rSnap.active, true)
  assert.equal(rSnap.state, 'holding')
  assert.equal(rSnap.drink?.id, 'pearl_milk_tea')
  assert.equal(rSnap.energyPct, expectedSavedPct)
  assert.equal(rSnap.customization?.ice, '少冰')

  // 收杯后清档，刷新不再恢复
  restored.discard()
  assert.equal(mem.has(DRINK_HOLD_STORAGE_KEY), false)
  const afterDiscard = new DrinkHoldSession({ storage, resolveDrink: getDrinkById })
  assert.equal(afterDiscard.getSnapshot().active, false)

  // 2) origin/main 键位避让 + KeyI 长按/松手 + 触屏按钮 + 拍照暂隐 + 骑车自动收杯
  assert.equal(ORIGIN_MAIN_KEY_AUDIT.chosen, 'KeyI')
  assert.equal(DRINK_SIP_HOTKEY, 'KeyI')

  const makeEl = tag => {
    const attrs = new Map()
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      classList: {
        _s: new Set(),
        toggle(c, force) {
          if (force) el.classList._s.add(c)
          else el.classList._s.delete(c)
        },
        contains: c => el.classList._s.has(c),
      },
      hidden: false,
      disabled: false,
      style: {},
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
      dispatch(t, ev = {}) {
        for (const fn of el._listeners.get(t) ?? []) fn({ preventDefault() {}, button: 0, pointerType: 'touch', pointerId: 1, ...ev })
      },
      querySelector(sel) {
        const m = sel.match(/^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/)
        if (!m) return null
        return el.children.find(c => (m[2] === undefined ? c.hasAttribute(m[1]) : c.getAttribute(m[1]) === m[2])) ?? null
      },
      set innerHTML(v) {
        el._innerHTML = String(v)
        const matches = [...el._innerHTML.matchAll(/<(span|i|button|div)\b([^>]*)>/g)]
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
    globalThis.document = { body, hidden: false, createElement: tag => makeEl(tag), addEventListener() {}, removeEventListener() {} }
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
    const hudAudio = createDrinkStrawAudio({ muted: true })
    const hud = mountDrinkHoldHud({ session: s2, strawAudio: hudAudio })
    try {
      assert.equal(hud.hotkey, 'KeyI')
    assert.equal(hud.root.hidden, false)

    const fireWin = (type, code) => {
      for (const fn of winListeners.get(type) ?? []) {
        fn({ code, repeat: false, altKey: false, ctrlKey: false, metaKey: false, target: null })
      }
    }

    // KeyY (useItem) 与 KeyH (车铃) 不误触发
    fireWin('keydown', 'KeyY')
    fireWin('keydown', 'KeyH')
    s2.step(0.25)
    assert.equal(s2.getSnapshot().energyPct, 100)

    // 拍照模式禁用快捷键且暂隐
    body.dataset.photo = 'on'
    hud.syncHostState()
    assert.equal(hud.root.hidden, true)
    fireWin('keydown', 'KeyI')
    s2.step(0.25)
    assert.equal(s2.getSnapshot().energyPct, 100)

    delete body.dataset.photo
    hud.syncHostState()
    assert.equal(hud.root.hidden, false)

    // KeyI 长按 -> step 连续掉量 (首帧 0.08s 处于起吸延迟期 data-phase=priming) -> 连续掉量 -> 松手停止
    fireWin('keydown', 'KeyI')
    assert.equal(s2.getSnapshot().drinking, true)
    assert.equal(hudAudio.getStats().active, true)
    s2.step(0.08)
    assert.equal(hud.root.dataset.phase, 'priming')
    s2.step(0.25)
    s2.step(0.25)
    assert.equal(hud.root.dataset.phase, 'drawing')
    const afterHalfSec = s2.getSnapshot().energyPct
    assert.ok(afterHalfSec < 96 && afterHalfSec > 80)
    // 推进至 <= 18% 快空区间 -> 触发一次低液位预警音与 data-low="1"
    for (let j = 0; j < 32 && s2.getSnapshot().energy > 0.14; j++) {
      s2.step(0.15)
    }
    assert.equal(hud.root.dataset.low, '1')
    assert.equal(hud.root.dataset.phase, 'low')
    assert.equal(hudAudio.getStats().lowWarningCount, 1)
    fireWin('keyup', 'KeyI')
    assert.equal(s2.getSnapshot().drinking, false)
    assert.equal(hudAudio.getStats().active, false)
    const frozenPct = s2.getSnapshot().energyPct
    s2.step(0.25)
    assert.equal(s2.getSnapshot().energyPct, frozenPct)

    // 触屏按钮 pointerdown 长按 -> pointerup 松手停止
    const sipBtn = hud.root.querySelector('[data-drinks-action="sip"]')
    sipBtn.dispatch('pointerdown')
    assert.equal(s2.getSnapshot().drinking, true)
    s2.step(0.2)
    s2.step(0.2)
    const afterTouchHold = s2.getSnapshot().energyPct
    assert.ok(afterTouchHold > 0 && afterTouchHold < frozenPct)
    sipBtn.dispatch('pointerup')
    assert.equal(s2.getSnapshot().drinking, false)
    s2.step(0.25)
    assert.equal(s2.getSnapshot().energyPct, afterTouchHold)

    // 骑车/开车 (data-aboard) 自动收杯暂存，下车恢复
    body.setAttribute('data-aboard', '')
    const resAboard = evaluateHoldHostAction(s2, readHoldHostState(body))
    hud.syncHostState()
    assert.equal(resAboard, 'stowed')
    assert.equal(s2.getSnapshot().paused, true)
    assert.equal(s2.startDrinking().code, 'PAUSED')
    assert.equal(hud.root.hidden, true)

    body.removeAttribute('data-aboard')
    const resFoot = evaluateHoldHostAction(s2, readHoldHostState(body))
    hud.syncHostState()
    assert.equal(resFoot, 'active')
    assert.equal(s2.getSnapshot().paused, false)
    assert.equal(s2.getSnapshot().energyPct, afterTouchHold)
    assert.equal(hud.root.hidden, false)

      s2.discard()
      assert.equal(mem.has(DRINK_HOLD_STORAGE_KEY), false)
    } finally {
      hud.dispose()
      hudAudio.dispose()
    }
  } finally {
    globalThis.document = prevDoc
    globalThis.window = prevWin
  }
})
