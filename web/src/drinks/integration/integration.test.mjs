import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import { ll2xz, xz2ll } from '../../../../lib/projection.ts'
import {
  bearingDegToWorldYaw,
  DEFAULT_DRINKS_SITE_ID,
  DRINKS_SITE_CANDIDATES,
  lonLatToWorldXZ,
  resolveDrinksSite,
  resolveDrinksSiteId,
  shopLocalToWorld,
  shouldMountDrinksShop,
  SITE,
  worldToShopLocal,
  worldXZToLonLat,
} from '../site.ts'
import { mountDrinksShop } from '../index.ts'
import {
  createDrinksIndoorViewController,
  mapSimEventToSound,
  measureSceneGroupsAlignment,
  resolveHeldDrinkPause,
  shouldExposeDrinksDebugProbe,
} from './runtime.ts'

function installMockDom() {
  const winListeners = new Map()

  const makeClassList = el => ({
    add: (...cls) => {
      const s = new Set((el.className || '').split(/\s+/).filter(Boolean))
      for (const c of cls) s.add(c)
      el.className = [...s].join(' ')
    },
    remove: (...cls) => {
      const s = new Set((el.className || '').split(/\s+/).filter(Boolean))
      for (const c of cls) s.delete(c)
      el.className = [...s].join(' ')
    },
    toggle: (c, force) => {
      const s = new Set((el.className || '').split(/\s+/).filter(Boolean))
      const on = force === undefined ? !s.has(c) : Boolean(force)
      if (on) s.add(c)
      else s.delete(c)
      el.className = [...s].join(' ')
      return on
    },
    contains: c => (el.className || '').split(/\s+/).includes(c),
  })

  const matches = (el, sel) => {
    for (const part of sel.split(',')) {
      const s = part.trim()
      if (s.startsWith('.') && el.classList.contains(s.slice(1))) return true
      const m = s.match(/^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/)
      if (m) {
        const has = el.attributes.has(m[1])
        if (m[2] === undefined ? has : el.attributes.get(m[1]) === m[2]) return true
      }
    }
    return false
  }

  const makeEl = tagName => {
    const el = {
      tagName: tagName.toUpperCase(),
      className: '',
      hidden: false,
      disabled: false,
      width: 0,
      height: 0,
      style: {
        setProperty(k, v) { this[k] = String(v) },
        removeProperty(k) { delete this[k] },
      },
      dataset: {},
      attributes: new Map(),
      children: [],
      parent: null,
      _innerHTML: '',
      _textContent: '',
      listeners: new Map(),
      getContext: () => null,
      setAttribute(k, v) {
        this.attributes.set(k, String(v))
        if (k.startsWith('data-')) {
          const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())
          this.dataset[camel] = String(v)
        }
      },
      removeAttribute(k) {
        this.attributes.delete(k)
      },
      hasAttribute(k) {
        return this.attributes.has(k)
      },
      getAttribute(k) {
        return this.attributes.get(k) ?? null
      },
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
      removeEventListener(type, fn) {
        if (!this.listeners.has(type)) return
        this.listeners.set(type, this.listeners.get(type).filter(x => x !== fn))
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] ?? null
      },
      querySelectorAll(sel) {
        const out = []
        const walk = node => {
          for (const ch of node.children) {
            if (matches(ch, sel)) out.push(ch)
            walk(ch)
          }
        }
        walk(this)
        return out
      },
      closest(sel) {
        let cur = this
        while (cur) {
          if (matches(cur, sel)) return cur
          cur = cur.parent
        }
        return null
      },
      get innerHTML() {
        return this._innerHTML
      },
      set innerHTML(html) {
        this._innerHTML = String(html)
        this.children = []
        const tagRe = /<(button|span|div|header|footer|strong|ol|ul|li|i)\b([^>]*)>/gi
        let m
        while ((m = tagRe.exec(this._innerHTML)) !== null) {
          const child = makeEl(m[1])
          const attrRe = /([a-zA-Z0-9_-]+)(?:="([^"]*)")?/g
          let am
          while ((am = attrRe.exec(m[2])) !== null) {
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
      get textContent() {
        return this._textContent || this._innerHTML.replace(/<[^>]+>/g, '')
      },
      set textContent(v) {
        this._textContent = String(v)
        this._innerHTML = String(v)
      },
    }
    el.classList = makeClassList(el)
    return el
  }

  const body = makeEl('body')
  const docListeners = new Map()
  const doc = {
    body,
    hidden: false,
    createElement: tag => makeEl(tag),
    querySelector: sel => body.querySelector(sel),
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, new Set())
      docListeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      docListeners.get(type)?.delete(fn)
    },
    listenerCount(type) {
      return docListeners.get(type)?.size ?? 0
    },
  }
  const win = {
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, new Set())
      winListeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      winListeners.get(type)?.delete(fn)
    },
    listenerCount(type) {
      return winListeners.get(type)?.size ?? 0
    },
  }

  const prevDoc = globalThis.document
  const prevWin = globalThis.window
  globalThis.document = doc
  globalThis.window = win
  return {
    body,
    win,
    cleanup() {
      if (prevDoc === undefined) delete globalThis.document
      else globalThis.document = prevDoc
      if (prevWin === undefined) delete globalThis.window
      else globalThis.window = prevWin
    },
  }
}

function createMockWallet(initialMoney) {
  let persisted = { money: initialMoney, updatedAt: 1000, economy: { txHistoryRing: [] } }
  let balance = initialMoney
  const clone = src => ({
    money: src.money,
    updatedAt: src.updatedAt,
    economy: { txHistoryRing: src.economy.txHistoryRing.map(x => ({ ...x })) },
  })
  return {
    wallet: {
      getBalance: () => balance,
      getSnapshot: () => clone(persisted),
      cloneSnapshot: clone,
      persist: next => {
        persisted = clone(next)
        return true
      },
      commitMoney: money => {
        balance = money
      },
      emitMoneyChange: () => {},
      emitShopBuy: () => {},
    },
    getBalance: () => balance,
    getPersistedMoney: () => persisted.money,
  }
}

function createMockWalker(pos) {
  const handAnchorObj = new THREE.Group()
  handAnchorObj.name = 'hand_r'
  const head = new THREE.Group()
  head.name = 'Head'
  const torso = new THREE.Group()
  torso.name = 'Torso'
  const armL = new THREE.Group()
  armL.name = 'ArmL'
  const armR = new THREE.Group()
  armR.name = 'ArmR'
  torso.add(armL, armR)
  const figure = new THREE.Group()
  figure.add(head, torso, handAnchorObj)
  const holdCalls = []
  const syncedVolumes = new Map()
  return {
    walker: {
      active: true,
      yaw: 0,
      vehicle: 'foot',
      position: pos,
      figure,
      hold() {},
      face(nextYaw) {
        this.yaw = nextYaw
      },
      showFigure() {},
      handAnchor: () => handAnchorObj,
      setCameraHold(on, pose) {
        holdCalls.push({ on, pose })
      },
      syncObstacleVolume(spec) {
        syncedVolumes.set(spec.id, spec)
      },
      removeObstacleVolume(id) {
        syncedVolumes.delete(id)
      },
    },
    handAnchorObj,
    head,
    torso,
    holdCalls,
    syncedVolumes,
  }
}

test('drinks/site 坐标换算：双候选（正阳路208号 POI 与王城商厦 way/264901525）精确对齐 lib/projection 且正反可逆', () => {
  assert.equal(SITE.id, DEFAULT_DRINKS_SITE_ID)
  assert.equal(Object.keys(DRINKS_SITE_CANDIDATES).length, 2)

  const poi = DRINKS_SITE_CANDIDATES.zhengyang_208
  assert.equal(poi.lon, 110.2938048)
  assert.equal(poi.lat, 25.2806767)
  const expectedPoi = ll2xz(poi.lat, poi.lon)
  assert.ok(Math.abs(poi.worldX - expectedPoi.x) < 0.002)
  assert.ok(Math.abs(poi.worldZ - expectedPoi.z) < 0.002)
  const backPoi = worldXZToLonLat(poi.worldX, poi.worldZ)
  assert.ok(Math.abs(backPoi.lon - poi.lon) < 1e-6)
  assert.ok(Math.abs(backPoi.lat - poi.lat) < 1e-6)

  const mall = DRINKS_SITE_CANDIDATES.wangcheng_mall
  assert.equal(mall.osmRef, 'way/264901525')
  const expectedMallCentroid = lonLatToWorldXZ(110.2942305, 25.2803115)
  assert.ok(Math.abs(mall.centroidWorldX - expectedMallCentroid.x) < 0.002)
  assert.ok(Math.abs(mall.centroidWorldZ - expectedMallCentroid.z) < 0.002)
  // docs/landmarks.md:265: 王城商厦 way/264901525 轮廓 x ∈ [-619, -543], z ∈ [-71, -3]
  assert.ok(mall.centroidWorldX >= -619 && mall.centroidWorldX <= -543)
  assert.ok(mall.centroidWorldZ >= -71 && mall.centroidWorldZ <= -3)
  assert.ok(mall.worldX >= -619 && mall.worldX <= -543)
  assert.ok(mall.worldZ >= -71.5 && mall.worldZ <= -3)

  // Bearing -> worldYaw maps shop-local +Z to true compass outward normal (sin θ, -cos θ)
  for (const [deg, expX, expZ] of [
    [0, 0, -1],
    [90, 1, 0],
    [180, 0, 1],
    [270, -1, 0],
    [13.4, Math.sin((13.4 * Math.PI) / 180), -Math.cos((13.4 * Math.PI) / 180)],
  ]) {
    const yaw = bearingDegToWorldYaw(deg)
    assert.ok(Math.abs(Math.sin(yaw) - expX) < 1e-9, `bearing ${deg} sin mismatch`)
    assert.ok(Math.abs(Math.cos(yaw) - expZ) < 1e-9, `bearing ${deg} cos mismatch`)
  }

  // shopLocalToWorld <-> worldToShopLocal exact roundtrip on both sites
  for (const cand of [poi, mall]) {
    const w = shopLocalToWorld(cand, 2.35, -3.1)
    const l = worldToShopLocal(cand, w.x, w.z)
    assert.ok(Math.abs(l.x - 2.35) < 1e-9)
    assert.ok(Math.abs(l.z - -3.1) < 1e-9)
    const backLl = xz2ll(w.x, w.z)
    assert.ok(Number.isFinite(backLl.lat) && Number.isFinite(backLl.lon))
  }

  assert.equal(resolveDrinksSiteId('?drinksSite=wangcheng_mall'), 'wangcheng_mall')
  assert.equal(resolveDrinksSiteId('?drinksSite=way/264901525'), 'wangcheng_mall')
  assert.equal(resolveDrinksSite('?drinksSite=zhengyang_208').id, 'zhengyang_208')
})

test('生产默认不挂载：仅 DEV 或显式 ?drinks=1 启用，且 main.ts 走条件动态导入', () => {
  assert.equal(shouldMountDrinksShop({ isDev: false, search: '' }), false)
  assert.equal(shouldMountDrinksShop({ isDev: false, search: '?solo=1&mode=walk' }), false)
  assert.equal(shouldMountDrinksShop({ isDev: false, search: '?drinks=0' }), false)
  assert.equal(shouldMountDrinksShop({ isDev: false, search: '?drinks=1' }), true)
  assert.equal(shouldMountDrinksShop({ isDev: false, search: '?drinks=true' }), true)
  assert.equal(shouldMountDrinksShop({ isDev: true, search: '' }), true)
  assert.equal(shouldMountDrinksShop({ isDev: true, search: '?drinks=0' }), false)

  const mainTs = readFileSync(join(process.cwd(), 'web/src/main.ts'), 'utf8')
  assert.match(mainTs, /shouldMountDrinksShop\(\s*\{\s*isDev:\s*import\.meta\.env\.DEV/)
  assert.match(mainTs, /import\('\.\/drinks'\)/)
  assert.equal(/^\s*import\s+.*mountDrinksShop.*from\s+['"]\.\/drinks['"]/m.test(mainTs), false)
})

test('远近切换状态接续：远离只跑数据（5分钟订单持续完成），靠近显示模型，再次远近切换无缝接续', () => {
  const dom = installMockDom()
  try {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000)
    const farPos = new THREE.Vector3(SITE.worldX + 420, 156, SITE.worldZ + 280)
    const nearPos = new THREE.Vector3(SITE.worldX + 1.2, 156, SITE.worldZ - 3.5)
    const playerPos = farPos.clone()
    const { walker } = createMockWalker(playerPos)
    const { wallet } = createMockWallet(100)

    const handle = mountDrinksShop({
      scene,
      camera,
      getPlayerPos: () => playerPos,
      getWalker: () => walker,
      getHour: () => 15.0,
      getNightFactor: () => 0,
      sampleGroundY: () => 156.2,
      container: dom.body,
      wallet,
      showNpcBadges: false,
      seed: 'integration-lod-continuity',
    })

    // 初始在远处：模型隐藏、叫号屏隐藏
    assert.equal(handle.isVisualActive(), false)
    assert.equal(handle.shop.group.visible, false)
    assert.equal(handle.npc.group.visible, false)
    assert.equal(handle.pickupHud.root.hidden, true)

    // 远离 5 分钟（300s 模拟推进）：纯数据持续完成订单，零错误
    for (let i = 0; i < 3000; i++) {
      handle.step(0.1)
    }
    const farState = handle.getProbe().getState()
    assert.equal(farState.visualActive, false)
    assert.ok(farState.simTimeSec >= 299.9, `expected >= 300s sim time, got ${farState.simTimeSec}`)
    assert.ok(farState.metrics.ordersCompleted >= 10, `expected >= 10 completed orders while far, got ${farState.metrics.ordersCompleted}`)
    assert.ok(farState.metrics.totalRevenue > 0)
    assert.equal(handle.sim.validateInvariants().ok, true)

    // 走近门店：立即显示建筑与 NPC 模型，且订单数无缝接续不重置
    playerPos.copy(nearPos)
    camera.position.set(nearPos.x, nearPos.y + 2, nearPos.z - 4)
    handle.step(0.05)
    const nearState = handle.getProbe().getState()
    assert.equal(nearState.visualActive, true)
    assert.equal(handle.shop.group.visible, true)
    assert.equal(handle.npc.group.visible, true)
    assert.equal(nearState.pickupHudVisible, true)
    assert.ok(nearState.npcMetrics.activeTotal >= 5)
    assert.ok(nearState.metrics.ordersCompleted >= farState.metrics.ordersCompleted)

    // 再次远离 2 分钟，模型自动隐藏，数据继续上涨
    playerPos.copy(farPos)
    for (let i = 0; i < 1200; i++) {
      handle.step(0.1)
    }
    const farAgain = handle.getProbe().getState()
    assert.equal(farAgain.visualActive, false)
    assert.equal(handle.shop.group.visible, false)
    assert.ok(farAgain.metrics.ordersCompleted > nearState.metrics.ordersCompleted)

    // 再次回到近处：状态完整接上
    playerPos.copy(nearPos)
    handle.step(0.05)
    const backNear = handle.getProbe().getState()
    assert.equal(backNear.visualActive, true)
    assert.equal(handle.shop.group.visible, true)
    assert.ok(backNear.simTimeSec > 419)
    assert.ok(backNear.metrics.ordersCompleted >= farAgain.metrics.ordersCompleted)

    handle.dispose()
  } finally {
    dom.cleanup()
  }
})

test('重复挂载与 dispose 完整释放：无场景节点/DOM/事件监听器泄漏', () => {
  const dom = installMockDom()
  try {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000)
    const baseSceneChildren = scene.children.length
    const baseDomChildren = dom.body.children.length
    const baseKeyListeners = dom.win.listenerCount('keydown')

    for (let round = 0; round < 3; round++) {
      const playerPos = new THREE.Vector3(SITE.worldX, 156, SITE.worldZ - 4)
      const { walker, syncedVolumes } = createMockWalker(playerPos)
      const { wallet } = createMockWallet(50)
      const handle = mountDrinksShop({
        scene,
        camera,
        getPlayerPos: () => playerPos,
        getWalker: () => walker,
        getHour: () => 14.0,
        container: dom.body,
        wallet,
        showNpcBadges: false,
        seed: `remount-${round}`,
      })

      handle.step(0.1)
      // 四组统一直接挂于同一父节点 scene（无二次嵌套、无残留）
      assert.equal(scene.children.length, baseSceneChildren + 4)
      assert.equal(dom.body.children.length, baseDomChildren + 3)
      assert.equal(syncedVolumes.size, 1)

      handle.orderPanel.open()
      assert.equal(dom.body.dataset.drinksUiOpen, '1')

      handle.dispose()
      handle.dispose() // 幂等重复 dispose
      handle.step(0.5) // 释放后 step 安全空转

      assert.equal(handle.isDisposed(), true)
      assert.equal(handle.getProbe(), undefined)
      assert.equal(scene.children.length, baseSceneChildren)
      assert.equal(dom.body.children.length, baseDomChildren)
      assert.equal(dom.win.listenerCount('keydown'), baseKeyListeners)
      assert.equal(syncedVolumes.size, 0)
      assert.equal(scene.userData.crowdThinningZones, undefined)
      assert.equal(dom.body.dataset.drinksUiOpen, undefined)
      assert.equal(dom.body.dataset.drinksHold, undefined)
      assert.equal(dom.body.dataset.drinksIndoor, undefined)
    }
  } finally {
    dom.cleanup()
  }
})

test('点单扣款、叫号取杯、喝到空、丢杯与骑车自动收杯全闭环', async () => {
  const dom = installMockDom()
  try {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000)
    const playerPos = new THREE.Vector3(SITE.worldX, 156, SITE.worldZ - 4)
    const { walker, handAnchorObj } = createMockWalker(playerPos)
    const { wallet, getBalance, getPersistedMoney } = createMockWallet(50)

    const handle = mountDrinksShop({
      scene,
      camera,
      getPlayerPos: () => playerPos,
      getWalker: () => walker,
      getHour: () => 14.0,
      container: dom.body,
      wallet,
      showNpcBadges: false,
      seed: 'integration-full-flow',
    })

    // 1. 下单并扣主钱包
    handle.orderPanel.open('ice_lemon_water') // ¥4
    const orderRes = await handle.orderPanel.submitOrder()
    assert.equal(orderRes.ok, true)
    assert.ok(orderRes.order)
    assert.equal(getBalance(), 46)
    assert.equal(getPersistedMoney(), 46)
    handle.orderPanel.close()

    // 2. 推进门店直到叫号就绪
    let readyOrder = null
    for (let i = 0; i < 400; i++) {
      handle.step(0.1)
      readyOrder = handle.sim.getOrder(orderRes.order.id)
      if (readyOrder?.status === 'ready_for_pickup') break
    }
    assert.equal(readyOrder?.status, 'ready_for_pickup')
    assert.ok((handle.audio.getStats().playedCounts.call_number ?? 0) >= 1)

    // 3. 取杯 -> 手部挂杯 & 显示喝一口 HUD
    const colRes = handle.getProbe().collectReady()
    assert.equal(colRes?.ok, true)
    handle.step(0.05)
    assert.equal(handle.holdSession.getSnapshot().active, true)
    assert.equal(handle.getProbe().getState().cupAttached, true)
    assert.equal(handAnchorObj.children.some(c => c.name === 'drinks-held-cup'), true)

    // 4. 骑车自动收杯 -> 3D 杯摘除、paused=true、HUD 隐藏；下车恢复
    walker.vehicle = 'bike'
    handle.step(0.05)
    const ridingState = handle.getProbe().getState()
    assert.equal(ridingState.stowedForRide, true)
    assert.equal(ridingState.hold.paused, true)
    assert.equal(ridingState.cupAttached, false)
    assert.equal(ridingState.holdHudVisible, false)
    assert.equal(handle.getProbe().sip().code, 'PAUSED')

    walker.vehicle = 'foot'
    handle.step(0.05)
    assert.equal(handle.getProbe().getState().cupAttached, true)
    assert.equal(handle.getProbe().getState().hold.paused, false)

    // 5. 连续喝到空自动收起
    const totalSips = handle.holdSession.getSnapshot().sipsTotal
    for (let s = 0; s < totalSips; s++) {
      const sipRes = handle.getProbe().sip()
      assert.equal(sipRes.ok, true)
      for (let k = 0; k < 20; k++) handle.step(0.1)
    }
    assert.equal(handle.holdSession.getSnapshot().state, 'idle')
    assert.equal(handle.getProbe().getState().cupAttached, false)

    // 6. 再点一杯并手动丢杯（收起）
    handle.orderPanel.open('iced_americano') // ¥5
    const order2 = await handle.orderPanel.submitOrder()
    assert.equal(order2.ok, true)
    assert.equal(getBalance(), 41)
    handle.orderPanel.close()
    for (let i = 0; i < 400; i++) {
      handle.step(0.1)
      if (handle.sim.getOrder(order2.order.id)?.status === 'ready_for_pickup') break
    }
    assert.equal(handle.getProbe().collectReady()?.ok, true)
    handle.step(0.05)
    assert.equal(handle.getProbe().getState().cupAttached, true)
    assert.equal(handle.getProbe().discard(), true)
    handle.step(0.05)
    assert.equal(handle.holdSession.getSnapshot().active, false)
    assert.equal(handle.getProbe().getState().cupAttached, false)

    // Pure helpers sanity checks
    assert.equal(resolveHeldDrinkPause({ walkerActive: true, vehicle: 'bicycle' }).stowedForRide, true)
    assert.equal(mapSimEventToSound({ type: 'order_called', timeSec: 10 }, 30, true)?.soundId, 'call_number')
    assert.equal(mapSimEventToSound({ type: 'order_called', timeSec: 10 }, 30, false), null)

    handle.dispose()
  } finally {
    dom.cleanup()
  }
})

test('穿门自动切第一人称，出门恢复原视角（原第三人称还原、原第一人称保持、门槛滞回防抖与 dispose 复位）', () => {
  let mode = 'third'
  const setCalls = []
  const dataset = {}
  const viewMode = {
    isFirstPerson: () => mode === 'first',
    setViewMode: next => {
      mode = next
      setCalls.push(next)
    },
  }

  const ctrl = createDrinksIndoorViewController({
    site: SITE,
    viewMode,
    bodyDataset: dataset,
  })

  // 1. 站在门外人行道 (lx=0.2, lz=4.5) -> 保持第三人称
  const outWorld = shopLocalToWorld(SITE, 0.2, 4.5)
  let st = ctrl.update(outWorld, true)
  assert.equal(st.inside, false)
  assert.equal(mode, 'third')
  assert.equal(setCalls.length, 0)

  // 2. 穿过门洞进入店内 (lx=0.2, lz=1.8) -> 自动切第一人称
  const inWorld = shopLocalToWorld(SITE, 0.2, 1.8)
  st = ctrl.update(inWorld, true)
  assert.equal(st.inside, true)
  assert.equal(st.autoSwitched, true)
  assert.equal(mode, 'first')
  assert.equal(dataset.drinksIndoor, '1')

  // 3. 停在门洞门槛处 (lz=2.85，在 exitMarginM=0.22 内) -> 防抖滞回保持第一人称不闪跳
  const sillWorld = shopLocalToWorld(SITE, 0.2, 2.85)
  st = ctrl.update(sillWorld, true)
  assert.equal(st.inside, true)
  assert.equal(mode, 'first')

  // 4. 走出门外 (lz=3.3 > 2.8 + 0.22) -> 精确恢复原第三人称
  const exitedWorld = shopLocalToWorld(SITE, 0.2, 3.3)
  st = ctrl.update(exitedWorld, true)
  assert.equal(st.inside, false)
  assert.equal(st.autoSwitched, false)
  assert.equal(mode, 'third')
  assert.equal(dataset.drinksIndoor, '0')
  assert.deepEqual(setCalls, ['first', 'third'])

  // 5. 若玩家进店前本来就是手动第一人称，出门不得强切回第三人称
  mode = 'first'
  setCalls.length = 0
  ctrl.update(inWorld, true)
  assert.equal(ctrl.isInside(), true)
  assert.equal(ctrl.getState().autoSwitched, false)
  assert.equal(mode, 'first')
  ctrl.update(exitedWorld, true)
  assert.equal(ctrl.isInside(), false)
  assert.equal(mode, 'first')
  assert.equal(setCalls.length, 0)

  // 6. 处于店内自动第一人称状态时 dispose -> 立即恢复原第三人称并清理 dataset
  mode = 'third'
  ctrl.update(inWorld, true)
  assert.equal(mode, 'first')
  ctrl.dispose()
  assert.equal(mode, 'third')
  assert.equal(dataset.drinksIndoor, undefined)

  // 7. 宿主若提供 scoped enterIndoorFirstPerson/leaveIndoorFirstPerson 接口则优先委托
  const scopedEvents = []
  const scopedCtrl = createDrinksIndoorViewController({
    site: SITE,
    bodyDataset: {},
    viewMode: {
      isFirstPerson: () => false,
      setViewMode: () => {},
      enterIndoorFirstPerson: id => scopedEvents.push(`enter:${id}`),
      leaveIndoorFirstPerson: id => scopedEvents.push(`leave:${id}`),
    },
  })
  scopedCtrl.update(inWorld, true)
  scopedCtrl.update(exitedWorld, true)
  assert.deepEqual(scopedEvents, ['enter:drinks_shop', 'leave:drinks_shop'])
  scopedCtrl.dispose()
})

test('集成态客流与排队上限：5 分钟无人值守订单持续完成，全程并发顾客 ≤ 8 且门口排队 ≤ 4', () => {
  const dom = installMockDom()
  try {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000)
    const playerPos = new THREE.Vector3(SITE.worldX + 260, 156, SITE.worldZ + 180)
    const { walker } = createMockWalker(playerPos)
    const { wallet } = createMockWallet(100)

    const handle = mountDrinksShop({
      scene,
      camera,
      getPlayerPos: () => playerPos,
      getWalker: () => walker,
      getHour: () => 19.5,
      container: dom.body,
      wallet,
      showNpcBadges: false,
      seed: 'integration-crowd-cap-5min',
      maxCustomers: 26, // 验证即使传入旧大值也被硬上限钳制到 <= 8
    })

    let maxCustomersSeen = 0
    let maxQueueSeen = 0
    for (let i = 0; i < 3000; i++) {
      handle.step(0.1)
      const s = handle.sim.getSnapshot()
      if (s.customers.length > maxCustomersSeen) maxCustomersSeen = s.customers.length
      if (s.metrics.queueLength > maxQueueSeen) maxQueueSeen = s.metrics.queueLength
      assert.ok(s.customers.length <= 8, `tick ${i}: customers ${s.customers.length} > 8`)
      assert.ok(s.metrics.queueLength <= 4, `tick ${i}: queue ${s.metrics.queueLength} > 4`)
    }

    const end = handle.getProbe().getState()
    assert.ok(maxCustomersSeen >= 5 && maxCustomersSeen <= 8, `peak customers ${maxCustomersSeen}`)
    assert.ok(maxQueueSeen <= 4, `peak queue ${maxQueueSeen}`)
    assert.ok(end.metrics.ordersCompleted >= 10, `5min unattended orders ${end.metrics.ordersCompleted} < 10`)
    assert.equal(handle.sim.validateInvariants().ok, true)
    handle.dispose()
  } finally {
    dom.cleanup()
  }
})

test('四组世界坐标与父节点严格统一（误差 ≤ 0.01m，无二次偏移/叠加旋转）且 terrain.refit 后四组实时同步跟随', () => {
  const dom = installMockDom()
  try {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000)
    const nearWorld = shopLocalToWorld(SITE, 0.2, 4.5)
    const playerPos = new THREE.Vector3(nearWorld.x, 157.4, nearWorld.z)
    const { walker } = createMockWalker(playerPos)
    const { wallet } = createMockWallet(100)

    let currentElevation = 157.38
    const handle = mountDrinksShop({
      scene,
      camera,
      getPlayerPos: () => playerPos,
      getWalker: () => walker,
      getHour: () => 14.5,
      sampleGroundY: () => currentElevation,
      container: dom.body,
      wallet,
      showNpcBadges: false,
      seed: 'four-groups-coord-sync',
    })
    handle.step(0.05)

    const fourGroups = {
      shopGroup: handle.shop.group,
      plinthGroup: handle.terrain.plinthGroup,
      staffGroup: handle.staff.group,
      npcGroup: handle.npc.group,
    }

    // 1. 同一父节点（scene），无交叉嵌套污染 shop.getMetrics().meshes
    assert.equal(handle.shop.group.parent, scene)
    assert.equal(handle.terrain.plinthGroup.parent, scene)
    assert.equal(handle.staff.group.parent, scene)
    assert.equal(handle.npc.group.parent, scene)
    assert.ok(handle.shop.getMetrics().meshes <= 30, `shop meshes ${handle.shop.getMetrics().meshes} > 30`)

    const alignBefore = measureSceneGroupsAlignment(fourGroups)
    assert.equal(alignBefore.sameParent, true)
    assert.ok(alignBefore.maxOriginErrorM <= 0.01, `origin error ${alignBefore.maxOriginErrorM}m > 0.01m`)
    assert.ok(alignBefore.maxSamplePointErrorM <= 0.01, `sample error ${alignBefore.maxSamplePointErrorM}m > 0.01m`)
    assert.ok(alignBefore.maxYawErrorRad <= 1e-6, `yaw error ${alignBefore.maxYawErrorRad}rad`)

    // 验证招聘牌（staff 组内）世界坐标与 shopLocalToWorld 完全一致（无二次旋转偏移）
    const standeeWorld = new THREE.Vector3()
    handle.staff.stage.standee.group.getWorldPosition(standeeWorld)
    const expectedStandee = shopLocalToWorld(SITE, handle.staff.session.anchors.recruitStandee.x, handle.staff.session.anchors.recruitStandee.z)
    assert.ok(Math.hypot(standeeWorld.x - expectedStandee.x, standeeWorld.z - expectedStandee.z) <= 0.01)
    assert.ok(Math.abs(standeeWorld.y - handle.terrain.plotY) <= 0.01)

    // 验证 NPC 实例的世界坐标与 sim 局部锚点换算完全一致（无二次偏移或叠加旋转）
    const snap = handle.sim.getSnapshot()
    assert.ok(snap.clerks.length > 0)
    const clerk0 = snap.clerks[0]
    const expectedClerk0 = shopLocalToWorld(SITE, clerk0.x, clerk0.z)
    const instMesh = handle.npc.group.children.find(c => c.isInstancedMesh)
    assert.ok(instMesh)
    const mInst = new THREE.Matrix4()
    instMesh.getMatrixAt(0, mInst)
    const instWorld = new THREE.Vector3().setFromMatrixPosition(mInst).applyMatrix4(handle.npc.group.matrixWorld)
    assert.ok(
      Math.hypot(instWorld.x - expectedClerk0.x, instWorld.z - expectedClerk0.z) <= 0.01,
      `npc world drift: got (${instWorld.x.toFixed(3)}, ${instWorld.z.toFixed(3)}) vs (${expectedClerk0.x.toFixed(3)}, ${expectedClerk0.z.toFixed(3)})`,
    )

    // 2. 直接调用 terrain.refit 到新标高 161.25m：四组无需额外手动干预即同步跟随
    currentElevation = 161.25
    handle.terrain.refit(() => currentElevation)
    assert.ok(Math.abs(handle.terrain.plotY - 161.25) <= 0.01)
    assert.ok(Math.abs(handle.getProbe().getState().groundY - 161.25) <= 0.01)

    const alignAfter = measureSceneGroupsAlignment(fourGroups)
    assert.equal(alignAfter.sameParent, true)
    assert.ok(alignAfter.maxOriginErrorM <= 0.01, `post-refit origin error ${alignAfter.maxOriginErrorM}m > 0.01m`)
    assert.ok(alignAfter.maxSamplePointErrorM <= 0.01, `post-refit sample error ${alignAfter.maxSamplePointErrorM}m > 0.01m`)
    for (const g of [handle.shop.group, handle.terrain.plinthGroup, handle.staff.group, handle.npc.group]) {
      const wp = g.getWorldPosition(new THREE.Vector3())
      assert.ok(Math.abs(wp.x - SITE.worldX) <= 0.01)
      assert.ok(Math.abs(wp.y - 161.25) <= 0.01)
      assert.ok(Math.abs(wp.z - SITE.worldZ) <= 0.01)
    }

    handle.dispose()
  } finally {
    dom.cleanup()
  }
})

test('生产环境默认零调试接口挂载：isProd=true 且无 ?verify 时 getProbe() 返回 undefined，探针零内部可变实例泄漏', () => {
  assert.equal(shouldExposeDrinksDebugProbe({ isProd: true, search: '' }), false)
  assert.equal(shouldExposeDrinksDebugProbe({ isProd: true, search: '?solo=1&mode=walk&drinks=1' }), false)
  assert.equal(shouldExposeDrinksDebugProbe({ isProd: true, search: '?verify=&drinks=1' }), true)
  assert.equal(shouldExposeDrinksDebugProbe({ isProd: false, search: '' }), true)

  const dom = installMockDom()
  try {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000)
    const playerPos = new THREE.Vector3(SITE.worldX, 157.4, SITE.worldZ)
    const { walker } = createMockWalker(playerPos)

    const prodHandle = mountDrinksShop({
      scene,
      camera,
      getPlayerPos: () => playerPos,
      getWalker: () => walker,
      container: dom.body,
      isProd: true,
      search: '?drinks=1',
    })
    assert.equal(prodHandle.getProbe(), undefined)
    assert.equal('viewer' in dom.win, false)
    prodHandle.dispose()

    const verifyHandle = mountDrinksShop({
      scene,
      camera,
      getPlayerPos: () => playerPos,
      getWalker: () => walker,
      container: dom.body,
      isProd: true,
      search: '?verify=&drinks=1',
    })
    const verifyProbe = verifyHandle.getProbe()
    assert.ok(verifyProbe)
    assert.equal(Object.isFrozen(verifyProbe), true)
    // 严禁暴露内部可变对象或刷钱作弊方法
    for (const forbidden of ['sim', 'holdSession', 'staff', 'terrain', 'grantFunds', 'completeActiveOrderPerfect', 'setShopLevel']) {
      assert.equal(forbidden in verifyProbe, false, `forbidden key ${forbidden} on probe`)
    }
    verifyHandle.dispose()
  } finally {
    dom.cleanup()
  }
})

test('全链路打通：门口 -> 穿过 2.8m 门洞自动切第一人称 -> 招聘牌互动 -> 换员工服 -> 五步制作出1杯饮品 -> 叫号交接 -> 手捧长按喝能量条连续走动 -> 出门恢复原视角', () => {
  const dom = installMockDom()
  try {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000)
    let viewModeState = 'third'
    const viewMode = {
      isFirstPerson: () => viewModeState === 'first',
      setViewMode: next => { viewModeState = next },
    }

    const startWorld = shopLocalToWorld(SITE, 0.2, 5.2)
    const playerPos = new THREE.Vector3(startWorld.x, 157.4, startWorld.z)
    const { walker, handAnchorObj, head, torso } = createMockWalker(playerPos)
    const { wallet } = createMockWallet(100)

    const moveLocal = (lx, lz) => {
      const w = shopLocalToWorld(SITE, lx, lz)
      playerPos.set(w.x, 157.4, w.z)
    }

    const handle = mountDrinksShop({
      scene,
      camera,
      getPlayerPos: () => playerPos,
      getWalker: () => walker,
      getHour: () => 14.5,
      viewMode,
      container: dom.body,
      wallet,
      showNpcBadges: false,
      seed: 'full-loop-e2e',
    })

    // 1. 走到门口：初始第三人称，门洞净宽 2.8m (>= 2.4m)
    handle.step(0.05)
    assert.equal(handle.shop.doorway.widthM >= 2.8, true)
    assert.equal(handle.getProbe().getState().viewMode, 'third')
    assert.equal(handle.getProbe().getState().insideShop, false)

    // 2. 穿过 2.8m 门洞进入店内迎宾位 (-0.85, 2.35)：自动切第一人称，且透过橱窗靠近招聘牌 (距离 <= 2.35m)
    moveLocal(-0.85, 2.35)
    handle.step(0.05)
    const afterEnter = handle.getProbe().getState()
    assert.equal(afterEnter.insideShop, true)
    assert.equal(afterEnter.viewMode, 'first')
    assert.equal(afterEnter.staff.nearRecruit, true)

    // 3. 看招聘牌互动 -> 应聘上岗并自动穿上蜜雪自建员工服
    assert.equal(handle.getProbe().interactRecruit(), true)
    handle.step(0.05)
    const afterHire = handle.getProbe().getState()
    assert.equal(afterHire.staff.onDuty, true)
    assert.equal(afterHire.staff.uniformEquipped, true)
    assert.equal(head.children.some(c => c.name === 'drinks-staff-uniform-head'), true)
    assert.equal(torso.children.some(c => c.name === 'drinks-staff-uniform-torso'), true)
    assert.equal(afterHire.staff.phase, 'accept_order')

    // 4. 按 targetZone 指引依次走完制作台五步工序：接单 -> 摇杯 -> 加料 -> 封口 -> 叫号出杯
    const anchors = handle.staff.session.anchors
    moveLocal(anchors.orderDesk.x, anchors.orderDesk.z)
    handle.step(0.05)
    assert.equal(handle.staff.performAction(), true)
    assert.equal(handle.staff.getSnapshot().phase, 'shake_cup')

    moveLocal(anchors.shakeStation.x, anchors.shakeStation.z)
    handle.step(0.05)
    handle.staff.setHoldingAction(true)
    for (let i = 0; i < 12; i++) handle.step(0.1)
    handle.staff.setHoldingAction(false)
    assert.equal(handle.staff.getSnapshot().phase, 'add_toppings')

    const prepTarget = handle.staff.getSnapshot().targetZone
    assert.ok(prepTarget)
    moveLocal(prepTarget.x, prepTarget.z)
    handle.step(0.05)
    handle.staff.setHoldingAction(true)
    for (let i = 0; i < 14; i++) handle.step(0.1)
    handle.staff.setHoldingAction(false)
    assert.equal(handle.staff.getSnapshot().phase, 'seal_cup')

    moveLocal(anchors.sealStation.x, anchors.sealStation.z)
    handle.step(0.05)
    handle.staff.setHoldingAction(true)
    for (let i = 0; i < 12; i++) handle.step(0.1)
    handle.staff.setHoldingAction(false)
    assert.equal(handle.staff.getSnapshot().phase, 'call_pickup')

    // 5. 到取餐台出杯叫号 -> 叫号音效响起，且饮品自动交接到玩家右手供长按饮用
    moveLocal(anchors.pickupCounter.x, anchors.pickupCounter.z)
    handle.step(0.05)
    assert.equal(handle.staff.performAction(), true)
    handle.step(0.05)
    const afterCall = handle.getProbe().getState()
    assert.equal(afterCall.staff.cupsServed, 1)
    assert.ok(afterCall.staff.lastCalledTicketNo)
    assert.ok((afterCall.audioStats.playedCounts.call_number ?? 0) >= 1)
    assert.equal(afterCall.hold.active, true)
    assert.equal(afterCall.cupAttached, true)
    assert.equal(handAnchorObj.children.some(c => c.name === 'drinks-held-cup'), true)
    assert.equal(afterCall.holdHudVisible, true)

    // 6. 手捧杯长按喝：能量条连续平滑下降，松手即停
    const energyBefore = afterCall.hold.energy
    const startSip = handle.getProbe().startHoldSip()
    assert.equal(startSip.ok, true)
    for (let i = 0; i < 12; i++) handle.step(0.1)
    const energyDuring = handle.getProbe().getState().hold.energy
    assert.ok(energyBefore - energyDuring > 0.08, `expected energy drop > 0.08, got ${energyBefore} -> ${energyDuring}`)
    assert.equal(handle.getProbe().stopHoldSip(), true)
    for (let i = 0; i < 5; i++) handle.step(0.1)
    const energyFrozen = handle.getProbe().getState().hold.energy
    assert.ok(Math.abs(energyDuring - energyFrozen) < 1e-4)

    // 7. 手捧饮品走出 2.8m 门洞回到门外 -> 自动恢复进店前原第三人称视角，饮品依然握在手中
    moveLocal(0.2, 4.6)
    handle.step(0.05)
    const afterExit = handle.getProbe().getState()
    assert.equal(afterExit.insideShop, false)
    assert.equal(afterExit.viewMode, 'third')
    assert.equal(afterExit.hold.active, true)
    assert.equal(afterExit.cupAttached, true)

    handle.dispose()
  } finally {
    dom.cleanup()
  }
})
