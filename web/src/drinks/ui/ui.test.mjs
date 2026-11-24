import test from 'node:test'
import assert from 'node:assert/strict'
import { createDrinksSim } from '../sim/index.ts'
import { DrinkHoldSession } from '../hold/hold-controller.ts'
import { mountDrinksOrderPanel } from './order-panel.ts'
import { mountDrinksPickupHud } from './pickup-hud.ts'

function installMinimalDom() {
  const listeners = new Map()
  const makeClassList = el => ({
    add: (...cls) => {
      const set = new Set((el.className || '').split(/\s+/).filter(Boolean))
      for (const c of cls) set.add(c)
      el.className = [...set].join(' ')
    },
    remove: (...cls) => {
      const set = new Set((el.className || '').split(/\s+/).filter(Boolean))
      for (const c of cls) set.delete(c)
      el.className = [...set].join(' ')
    },
    toggle: (c, force) => {
      const set = new Set((el.className || '').split(/\s+/).filter(Boolean))
      const on = force === undefined ? !set.has(c) : Boolean(force)
      if (on) set.add(c)
      else set.delete(c)
      el.className = [...set].join(' ')
      return on
    },
    contains: c => (el.className || '').split(/\s+/).includes(c),
  })

  const makeEl = tagName => {
    const el = {
      tagName: tagName.toUpperCase(),
      className: '',
      hidden: false,
      disabled: false,
      dataset: {},
      attributes: new Map(),
      children: [],
      parent: null,
      _innerHTML: '',
      _textContent: '',
      listeners: new Map(),
      setAttribute(k, v) {
        this.attributes.set(k, String(v))
        if (k.startsWith('data-')) {
          const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())
          this.dataset[camel] = String(v)
        }
      },
      getAttribute(k) { return this.attributes.get(k) ?? null },
      append(...nodes) {
        for (const n of nodes) {
          n.parent = this
          this.children.push(n)
        }
      },
      remove() {
        if (!this.parent) return
        this.parent.children = this.parent.children.filter(c => c !== this)
        this.parent = null
      },
      addEventListener(type, fn) {
        if (!this.listeners.has(type)) this.listeners.set(type, [])
        this.listeners.get(type).push(fn)
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null },
      querySelectorAll(sel) {
        const res = []
        const walk = node => {
          for (const ch of node.children) {
            if (matches(ch, sel)) res.push(ch)
            walk(ch)
          }
        }
        walk(this)
        return res
      },
      closest(sel) {
        let cur = this
        while (cur) {
          if (matches(cur, sel)) return cur
          cur = cur.parent
        }
        return null
      },
      get innerHTML() { return this._innerHTML },
      set innerHTML(html) {
        this._innerHTML = String(html)
        this.children = []
        // 抽取带 data-* 属性的元素用于无头 DOM 单元测试
        const tagRe = /<(button|span|div|header|footer|strong|ol|ul|li|i)\b([^>]*)>/gi
        let m
        while ((m = tagRe.exec(this._innerHTML)) !== null) {
          const child = makeEl(m[1])
          const attrText = m[2]
          const attrRe = /([a-zA-Z0-9_-]+)(?:="([^"]*)")?/g
          let am
          while ((am = attrRe.exec(attrText)) !== null) {
            const name = am[1]
            const val = am[2] ?? ''
            if (name === 'class') child.className = val
            else if (name === 'hidden') child.hidden = true
            else if (name === 'disabled') child.disabled = true
            else child.setAttribute(name, val)
          }
          child.parent = this
          this.children.push(child)
        }
      },
      get textContent() { return this._textContent || this._innerHTML.replace(/<[^>]+>/g, '') },
      set textContent(v) { this._textContent = String(v); this._innerHTML = String(v) },
    }
    el.classList = makeClassList(el)
    return el
  }

  const matches = (el, sel) => {
    if (sel.startsWith('.')) return el.classList.contains(sel.slice(1))
    const m = sel.match(/^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/)
    if (m) {
      const has = el.attributes.has(m[1])
      return m[2] === undefined ? has : el.attributes.get(m[1]) === m[2]
    }
    return false
  }

  const body = makeEl('body')
  const doc = {
    body,
    createElement: tag => makeEl(tag),
  }
  const win = {
    addEventListener: (t, fn) => {
      if (!listeners.has(t)) listeners.set(t, [])
      listeners.get(t).push(fn)
    },
    removeEventListener: (t, fn) => {
      if (!listeners.has(t)) return
      listeners.set(t, listeners.get(t).filter(x => x !== fn))
    },
  }
  globalThis.document = doc
  globalThis.window = win
  return {
    cleanup: () => {
      delete globalThis.document
      delete globalThis.window
    },
  }
}

function createMockWallet(initialMoney) {
  let persisted = { money: initialMoney, updatedAt: 1000, economy: { txHistoryRing: [] } }
  let memoryMoney = initialMoney
  const clone = s => ({
    money: s.money,
    updatedAt: s.updatedAt,
    economy: { txHistoryRing: s.economy.txHistoryRing.map(x => ({ ...x })) },
  })
  return {
    getBalance: () => memoryMoney,
    getSnapshot: () => clone(persisted),
    cloneSnapshot: clone,
    persist: next => { persisted = clone(next); return true },
    commitMoney: m => { memoryMoney = m },
    emitMoneyChange: () => {},
    emitShopBuy: () => {},
  }
}

test('drinks/ui 点单扣款 → 模拟出杯 → 叫号取杯 → 手捧喝全链路（含重复下单与余额不足拦截）', async () => {
  const dom = installMinimalDom()
  try {
    const sim = createDrinksSim({ seed: 'ui-flow', now: 0, hourOf: () => 14.5 })
    const wallet = createMockWallet(10)
    const hold = new DrinkHoldSession()

    const pickup = mountDrinksPickupHud({ sim, holdSession: hold })
    const panel = mountDrinksOrderPanel({
      sim,
      holdSession: hold,
      wallet,
      onOrderPlaced: (ord, custom) => {
        pickup.rememberCustomization(ord.id, custom)
        pickup.sync()
      },
    })

    panel.open('pearl_milk_tea')
    assert.equal(panel.isOpen(), true)
    assert.equal(panel.getViewMode(), 'order')
    assert.equal(document.body.dataset.drinksUiOpen, '1')

    // 砍掉次要步骤/耗时/容量标签后，界面无多余次要文案
    assert.equal(panel.root.innerHTML.includes('drinks-steps'), false)
    assert.equal(panel.root.innerHTML.includes('drinks-detail-meta'), false)
    assert.equal(panel.root.innerHTML.includes(['drinks', 'swatch'].join('-')), false)
    assert.equal(panel.root.innerHTML.includes(['linear', 'gradient'].join('-')), false)

    // 下单 ¥7 珍珠奶茶，并发双击只扣 1 次，并自动切入取餐号等待态（一屏无「下单」按钮竞争）
    const [r1, r2] = await Promise.all([panel.submitOrder(), panel.submitOrder()])
    assert.equal(r1.ok, true)
    assert.equal(r2.ok, false)
    assert.equal(r2.code, 'IN_FLIGHT')
    assert.equal(wallet.getBalance(), 3)
    assert.equal(panel.getViewMode(), 'ticket')

    // 再切回点单点 ¥4 冰鲜柠檬水 -> 余额只剩 ¥3，必须被拦截且不扣款
    panel.selectDrink('ice_lemon_water')
    assert.equal(panel.getViewMode(), 'order')
    const poor = await panel.submitOrder()
    assert.equal(poor.ok, false)
    assert.equal(poor.code, 'INSUFFICIENT_FUNDS')
    assert.equal(wallet.getBalance(), 3)

    // 推进模拟直到玩家订单进入 ready_for_pickup
    const orderId = r1.order.id
    for (let i = 0; i < 400; i++) {
      sim.step(0.1)
      if (sim.getOrder(orderId)?.status === 'ready_for_pickup') break
    }
    assert.equal(sim.getOrder(orderId)?.status, 'ready_for_pickup')

    panel.close()
    assert.equal(panel.isOpen(), false)
    pickup.sync()
    assert.ok(pickup.root.innerHTML.includes(`data-drinks-collect="${orderId}"`))
    // 玩家自身取餐单号仅在我的取餐单区出现一次，不与下方叫号队列重复
    assert.equal(pickup.root.innerHTML.split(r1.order.ticketNo).length - 1, 1)

    // 取杯进入右手捧杯状态
    const col = pickup.collectOrder(orderId)
    assert.equal(col.ok, true)
    assert.equal(hold.getSnapshot().active, true)
    assert.equal(hold.getSnapshot().drink?.id, 'pearl_milk_tea')

    panel.dispose()
    pickup.dispose()
  } finally {
    dom.cleanup()
  }
})

test('drinks/ui 已付款未取杯订单支持页面刷新恢复且不重复扣款', async () => {
  const dom = installMinimalDom()
  const mem = new Map()
  const storage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)) },
    removeItem: k => { mem.delete(k) },
  }
  try {
    const sim1 = createDrinksSim({ seed: 'ui-refresh-1', now: 0, hourOf: () => 14.5 })
    const wallet = createMockWallet(20)
    const hold1 = new DrinkHoldSession({ storage })
    const panel1 = mountDrinksOrderPanel({ sim: sim1, holdSession: hold1, wallet, storage })
    panel1.open('ice_lemon_water')
    const res = await panel1.submitOrder()
    assert.equal(res.ok, true)
    assert.equal(wallet.getBalance(), 16)
    panel1.dispose()

    // 模拟浏览器刷新：新建 sim 与 DrinkHoldSession + pickupHud，未重扣钱恢复待取单
    const sim2 = createDrinksSim({ seed: 'ui-refresh-2', now: 0, hourOf: () => 14.5 })
    const hold2 = new DrinkHoldSession({ storage })
    const pickup2 = mountDrinksPickupHud({ sim: sim2, holdSession: hold2, storage })
    const restoredOrd = sim2.getSnapshot().orders.find(o => o.source === 'player')
    assert.ok(restoredOrd, 'pending paid order must be restored on reload')
    assert.equal(restoredOrd.itemId, 'ice_lemon_water')
    assert.equal(wallet.getBalance(), 16)

    // 推进做完并取杯后，清除待取存储，再刷新不重复出杯
    for (let i = 0; i < 400; i++) {
      sim2.step(0.1)
      if (sim2.getOrder(restoredOrd.id)?.status === 'ready_for_pickup') break
    }
    const collected = pickup2.collectOrder(restoredOrd.id)
    assert.equal(collected.ok, true)
    assert.equal(hold2.getSnapshot().active, true)

    const sim3 = createDrinksSim({ seed: 'ui-refresh-3', now: 0, hourOf: () => 14.5 })
    const hold3 = new DrinkHoldSession({ storage })
    const pickup3 = mountDrinksPickupHud({ sim: sim3, holdSession: hold3, storage })
    assert.equal(sim3.getSnapshot().orders.filter(o => o.source === 'player').length, 0)
    assert.equal(hold3.getSnapshot().active, true)
    assert.equal(hold3.getSnapshot().drink?.id, 'ice_lemon_water')

    pickup2.dispose()
    pickup3.dispose()
  } finally {
    dom.cleanup()
  }
})
