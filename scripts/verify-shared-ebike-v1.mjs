import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const OUT_DIR = resolve(process.env.SHARED_EBIKE_OUT_DIR ?? '../captures-idok421')
await mkdir(OUT_DIR, {recursive: true})

const SAVE_KEY = 'glol.save.v1'

const server = await createServer({
  configFile: resolve('web/vite.config.ts'),
  root: resolve('web'),
  server: {host: '127.0.0.1', port: 0, strictPort: false},
  logLevel: 'silent',
})
await server.listen()
const {port} = server.httpServer.address()
const baseUrl = `http://127.0.0.1:${port}`

async function waitWalkReady(page) {
  await page.waitForFunction(
    () => {
      const w = window.viewer?.walk
      return w && typeof w.tick === 'function' && w.parked?.('bike')?.length > 0 && w.shop && window.viewer?.game
    },
    null,
    {timeout: 60000},
  )
}

async function walkNearSharedBike(page, label = 'shared-bike', preferPaint = null) {
  const target = await page.evaluate(async pref => {
    const {walk} = window.viewer
    const p = walk.position
    const allBikes = (walk.parkedBikes?.() ?? []).length
      ? walk.parkedBikes()
      : walk.parked('bike').map(([x, y, z]) => ({x, y, z, paint: 0}))
    const filtered = pref === null ? allBikes : allBikes.filter(b => (((b.paint % 4) + 4) % 4) === pref)
    const pool = filtered.length ? filtered : allBikes
    pool.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))
    const chosen = pool[0]
    await window.viewer.walkTo(chosen.x, chosen.z, 0, 'e2e-shared')
    for (let i = 0; i < 8; i++) walk.tick(1 / 60)
    return {
      chosen,
      decision: walk.shop.getInteractDecision(),
      actionText: document.querySelector('.vehicle-action:not([hidden])')?.textContent ?? '',
    }
  }, preferPaint)
  return target
}

function makeSeedSave(money) {
  return JSON.stringify({
    version: 1,
    money,
    wardrobe: {ownedIds: [], equipped: {top: 'top_default_tee', bottom: 'bot_default_jeans', shoes: 'sho_default_sneaker', hat: null, bag: null, prop: null}, autoHelmetOnRide: true},
    garage: {activeVehicleId: null, vehicles: {}, activeTestRide: null},
    missions: {completedCounts: {}, bestScores: {}},
    stamps: [],
    ledger: [],
    roadsideBattery: {},
    summonCooldownUntil: 0,
  })
}

const errors = []
let browser
try {
  browser = await chromium.launch(browserOptions(true))
  const context = await browser.newContext({viewport: {width: 1280, height: 800}})
  const page = await context.newPage()
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`))
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const t = msg.text()
      if (!/ERR_(CONNECTION_CLOSED|ABORTED)|404/.test(t)) errors.push(`console: ${t}`)
    }
  })
  await page.route('**/favicon.ico', r => r.fulfill({status: 204}))
  await page.route('**/api/t', r => r.fulfill({status: 204}))

  // -------------------------------------------------------------------------
  // 1. Seed ¥1 (< ¥2): verify unlock prompt + strict block + friendly toast
  // -------------------------------------------------------------------------
  await page.addInitScript(
    ({key, raw}) => {
      localStorage.setItem(key, raw)
    },
    {key: SAVE_KEY, raw: makeSeedSave(1)},
  )
  await page.goto(`${baseUrl}/?verify&solo=1&mode=walk&flow=0&time=10.5&radius=420`, {waitUntil: 'domcontentloaded'})
  await waitWalkReady(page)

  // Clear stale spot card if open
  await page.evaluate(() => document.querySelector('.spot-card .card-close')?.click())
  const preMount = await walkNearSharedBike(page, 'low-balance', 0)
  assert.equal(preMount.decision?.action, 'mount_vehicle')
  assert.equal(preMount.actionText, '解锁共享电动车（¥2）', `Expected ¥2 prompt, got ${JSON.stringify(preMount)}`)
  await page.screenshot({path: resolve(OUT_DIR, '01-shared-prompt-2yuan.png')})

  await page.keyboard.press('KeyF')
  await page.evaluate(() => {
    for (let i = 0; i < 8; i++) window.viewer.walk.tick(1 / 60)
  })
  const deniedState = await page.evaluate(() => ({
    vehicle: window.viewer.walk.vehicle,
    money: window.viewer.game.getState().money,
    toast: document.querySelector('.toast')?.textContent ?? '',
  }))
  assert.equal(deniedState.vehicle, 'foot', `Must block ride when balance < ¥2, got ${deniedState.vehicle}`)
  assert.equal(deniedState.money, 1, `Wallet must stay ¥1 (never negative), got ${deniedState.money}`)
  assert.ok(deniedState.toast.includes('余额不足'), `Expected insufficient-funds toast, got ${deniedState.toast}`)
  await page.screenshot({path: resolve(OUT_DIR, '02-shared-blocked-low-balance.png')})
  console.log('[1/5] Low-balance (¥1) block verified:', JSON.stringify(deniedState))

  // -------------------------------------------------------------------------
  // 2. Balance ¥20 on starter paint=0 roadside bike: ¥20->¥18, forced shared 18km/h & 0 mods
  // -------------------------------------------------------------------------
  await page.evaluate(
    ({key, raw}) => {
      localStorage.setItem(key, raw)
      window.viewer.game.save.reload()
    },
    {key: SAVE_KEY, raw: makeSeedSave(20)},
  )
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) window.viewer.walk.tick(1 / 60)
  })

  await page.keyboard.press('KeyF')
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike', null, {timeout: 8000})
  const mountedSharedP0 = await page.evaluate(() => {
    const {walk, game} = window.viewer
    for (let i = 0; i < 6; i++) walk.tick(1 / 60)
    // Shift to S (gear 4) & attempt G mod cycle
    walk.ebike.setPark(false, true)
    walk.ebike.setKickstand(false, true)
    walk.ebike.setGear(4)
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyG'}))
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyG'}))
    walk.tick(1 / 60)
    return {
      money: game.getState().money,
      ownership: game.getState().vehicle?.ownership,
      typeText: document.querySelector('.ride-type')?.textContent,
      stateText: document.querySelector('.ride-state')?.textContent,
      wheelieBtnText: document.querySelector('.walk-ui .btn-wheelie')?.textContent,
      modDisplay: getComputedStyle(document.querySelector('.ride-mod')).display,
      probe: walk.probe().ebike,
    }
  })
  assert.equal(mountedSharedP0.money, 18, `Expected ¥20 -> ¥18 after unlock, got ¥${mountedSharedP0.money}`)
  assert.equal(mountedSharedP0.ownership, 'shared')
  assert.equal(mountedSharedP0.typeText, '共享')
  assert.equal(mountedSharedP0.modDisplay, 'none')
  assert.equal(mountedSharedP0.probe.modPreset, 'stock')
  assert.equal(mountedSharedP0.probe.maxKmh, 18, `Shared bike maxKmh must be 18, got ${mountedSharedP0.probe.maxKmh}`)
  assert.equal(mountedSharedP0.stateText, '单次代步 · 限18')

  // Dismount paint=0 bike cleanly, move to open Jiefang Rd shared bike near (-389.6, -49.4) for full speed & wheelie test
  await page.keyboard.press('KeyF')
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'foot', null, {timeout: 5000})
  const openShared = await page.evaluate(async () => {
    const {walk} = window.viewer
    await window.viewer.walkTo(-389.6, -49.4, 0, 'e2e-open-shared-prep')
    for (let i = 0; i < 6; i++) walk.tick(1 / 60)
    const bikes = walk.parked('bike')
    bikes.sort((a, b) => Math.hypot(a[0] + 389.6, a[2] + 49.4) - Math.hypot(b[0] + 389.6, b[2] + 49.4))
    const open = bikes[0]
    if (!open) return null
    await window.viewer.walkTo(open[0], open[2], 0, 'e2e-open-shared')
    for (let i = 0; i < 8; i++) walk.tick(1 / 60)
    return {open, label: document.querySelector('.vehicle-action:not([hidden])')?.textContent ?? ''}
  })
  assert.ok(openShared, 'Open-road shared bike near (-389.6, -49.4) not found')
  assert.equal(openShared.label, '解锁共享电动车（¥2）')
  await page.keyboard.press('KeyF')
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike', null, {timeout: 8000})

  const driveTest = await page.evaluate(() => {
    const {walk, game} = window.viewer
    walk.ebike.setPark(false, true)
    walk.ebike.setKickstand(false, true)
    walk.ebike.setGear(4)
    const target = [-463, -54]
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Space'}))
    let peakKmh = 0
    let peakWheelie = 0
    for (let i = 0; i < 420; i++) {
      const dx = target[0] - walk.position.x
      const dz = target[1] - walk.position.z
      const desiredYaw = Math.atan2(-dx, -dz)
      const err = Math.atan2(Math.sin(desiredYaw - walk.heading), Math.cos(desiredYaw - walk.heading))
      window.dispatchEvent(new KeyboardEvent(err > .04 ? 'keydown' : 'keyup', {code: 'KeyA'}))
      window.dispatchEvent(new KeyboardEvent(err < -.04 ? 'keydown' : 'keyup', {code: 'KeyD'}))
      walk.tick(1 / 60)
      peakKmh = Math.max(peakKmh, walk.speed * 3.6)
      peakWheelie = Math.max(peakWheelie, Math.abs(walk.probe().ebike?.wheelie ?? 0))
    }
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyA'}))
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyD'}))
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Space'}))
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
    for (let i = 0; i < 10; i++) walk.tick(1 / 60)
    return {
      peakKmh: +peakKmh.toFixed(2),
      peakWheelie,
      moneyDuringRide: game.getState().money,
    }
  })
  assert(driveTest.peakKmh <= 18.2 && driveTest.peakKmh >= 13, `Expected shared peak in 13..18.2 km/h, got ${driveTest.peakKmh}`)
  assert.equal(driveTest.peakWheelie, 0, `Expected 0 wheelie on shared bike, got ${driveTest.peakWheelie}`)
  assert.equal(driveTest.moneyDuringRide, 16, 'Second unlock should bring wallet ¥18 -> ¥16 and NOT double-charge during ride')
  await page.screenshot({path: resolve(OUT_DIR, '03-shared-riding-capped-18.png')})
  console.log('[2/5] Shared ride cap & wheelie lock verified:', JSON.stringify({mountedSharedP0: mountedSharedP0.probe, driveTest}))

  // -------------------------------------------------------------------------
  // 3. Crash pickup remount does NOT double charge; dismount & re-borrow charges ¥2 (¥16 -> ¥14)
  // -------------------------------------------------------------------------
  const crashRecoverState = await page.evaluate(() => {
    const {walk, game} = window.viewer
    walk.ebike.triggerCrash('lowside', 1)
    for (let i = 0; i < 20; i++) walk.tick(1 / 60)
    walk.ebike.recover()
    for (let i = 0; i < 55; i++) walk.tick(1 / 60)
    return {
      moneyAfterCrashRecover: game.getState().money,
      vehicle: walk.vehicle,
      decision: walk.shop.getInteractDecision(),
    }
  })
  assert.equal(crashRecoverState.moneyAfterCrashRecover, 16, 'Crash recovery must never charge extra')
  assert.equal(crashRecoverState.vehicle, 'foot')
  assert.equal(crashRecoverState.decision?.action, 'pickup_downed')

  // Pick up crashed bike -> confirm prompt shows '继续骑共享电车' -> remount costs ¥0
  const crashRemount = await page.evaluate(() => {
    const {walk, game} = window.viewer
    walk.ebike.pickupNearest()
    for (let i = 0; i < 50; i++) walk.tick(1 / 60)
    const beforeRemount = walk.shop.getInteractDecision()
    walk.shop.triggerInteract()
    for (let i = 0; i < 8; i++) walk.tick(1 / 60)
    return {
      beforeRemountLabel: beforeRemount?.label,
      vehicleAfterRemount: walk.vehicle,
      moneyAfterRemount: game.getState().money,
    }
  })
  assert.equal(crashRemount.beforeRemountLabel, '继续骑共享电车')
  assert.equal(crashRemount.vehicleAfterRemount, 'bike')
  assert.equal(crashRemount.moneyAfterRemount, 16, 'Remounting own crashed shared bike must NOT double-charge')

  // Dismount cleanly -> prompt resets to '解锁共享电动车（¥2）' -> re-borrow charges ¥2 (¥16 -> ¥14)
  await page.keyboard.press('KeyF')
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'foot', null, {timeout: 5000})
  const beforeReborrow = await page.evaluate(() => {
    for (let i = 0; i < 6; i++) window.viewer.walk.tick(1 / 60)
    return window.viewer.walk.shop.getInteractDecision()
  })
  assert.equal(beforeReborrow?.label, '解锁共享电动车（¥2）')
  await page.keyboard.press('KeyF')
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike', null, {timeout: 5000})
  const reborrowMoney = await page.evaluate(() => window.viewer.game.getState().money)
  assert.equal(reborrowMoney, 14, `Re-borrowing after dismount must charge ¥2 (¥16 -> ¥14), got ¥${reborrowMoney}`)
  await page.keyboard.press('KeyF')
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'foot', null, {timeout: 5000})
  console.log('[3/5] Crash-pickup remount (¥0) & dismount -> re-borrow billing lifecycle verified (¥16 -> ¥14)')

  // -------------------------------------------------------------------------
  // 4. Personal owned e-bike regression check: ¥0 unlock fee, > 42 km/h, wheelie > 0.15
  // -------------------------------------------------------------------------
  const personalStats = await page.evaluate(async () => {
    const {walk, game} = window.viewer
    game.commerce.creditReward({
      source: 'mission_delivery',
      refId: 'v1_verify_personal',
      amount: 8000,
      idempotencyKey: 'v1_verify_personal_key',
    })
    const buy = game.commerce.executePurchase({
      shopId: 'shop_shizijie_ebike',
      itemType: 'ebike_model',
      itemId: 'xiangshan_gt',
      expectedPrice: 6800,
      idempotencyKey: 'v1_buy_gt',
    })
    await window.viewer.walkTo(-415, -51, Math.PI * 0.5, 'jiefang-personal')
    for (let i = 0; i < 6; i++) walk.tick(1 / 60)
    walk.garage.summon(buy.createdVehicleId)
    for (let i = 0; i < 6; i++) walk.tick(1 / 60)
    const moneyBeforeMount = game.getState().money
    const decision = walk.shop.getInteractDecision()
    walk.shop.triggerInteract()
    for (let i = 0; i < 8; i++) walk.tick(1 / 60)
    walk.ebike.setPark(false, true)
    walk.ebike.setKickstand(false, true)
    walk.ebike.setGear(4)
    const target = [-485, -56]
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Space'}))
    let peakKmh = 0
    let peakWheelie = 0
    for (let i = 0; i < 180; i++) {
      const dx = target[0] - walk.position.x
      const dz = target[1] - walk.position.z
      const desiredYaw = Math.atan2(-dx, -dz)
      const err = Math.atan2(Math.sin(desiredYaw - walk.heading), Math.cos(desiredYaw - walk.heading))
      window.dispatchEvent(new KeyboardEvent(err > .04 ? 'keydown' : 'keyup', {code: 'KeyA'}))
      window.dispatchEvent(new KeyboardEvent(err < -.04 ? 'keydown' : 'keyup', {code: 'KeyD'}))
      walk.tick(1 / 60)
      peakKmh = Math.max(peakKmh, walk.speed * 3.6)
      peakWheelie = Math.max(peakWheelie, Math.abs(walk.probe().ebike?.wheelie ?? 0))
    }
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyA'}))
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyD'}))
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Space'}))
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
    return {
      decisionLabel: decision?.label,
      moneyBeforeMount,
      moneyAfterMount: game.getState().money,
      ownership: game.getState().vehicle?.ownership,
      maxKmh: walk.probe().ebike?.maxKmh,
      peakKmh: +peakKmh.toFixed(1),
      peakWheelie: +peakWheelie.toFixed(3),
      modDisplay: getComputedStyle(document.querySelector('.ride-mod')).display,
    }
  })
  assert.equal(personalStats.decisionLabel, '骑我的电摩')
  assert.equal(personalStats.moneyAfterMount, personalStats.moneyBeforeMount, 'Personal e-bike must not charge ¥2')
  assert.equal(personalStats.ownership, 'personal')
  assert(personalStats.peakKmh >= 45 && personalStats.maxKmh >= 55, `Personal GT speed regression: ${JSON.stringify(personalStats)}`)
  assert(personalStats.peakWheelie > 0.15, `Personal GT wheelie must work: ${JSON.stringify(personalStats)}`)
  assert.notEqual(personalStats.modDisplay, 'none', 'Personal e-bike must keep .ride-mod button visible')
  await page.screenshot({path: resolve(OUT_DIR, '04-personal-ebike-unrestricted.png')})
  console.log('[4/5] Personal e-bike zero-regression verified:', JSON.stringify(personalStats))

  // -------------------------------------------------------------------------
  // 5. Mobile touch viewport: unlock prompt & riding HUD non-overlap
  // -------------------------------------------------------------------------
  const mCtx = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 1, hasTouch: true, isMobile: true})
  const mp = await mCtx.newPage()
  mp.on('pageerror', err => errors.push(`mobile pageerror: ${err.message}`))
  await mp.route('**/favicon.ico', r => r.fulfill({status: 204}))
  await mp.route('**/api/t', r => r.fulfill({status: 204}))
  await mp.addInitScript(
    ({key, raw}) => {
      sessionStorage.setItem('glol.portraitOk', '1')
      localStorage.setItem(key, raw)
    },
    {key: SAVE_KEY, raw: makeSeedSave(20)},
  )
  await mp.goto(`${baseUrl}/?verify&solo=1&mode=walk&flow=0&time=10.5&radius=420`, {waitUntil: 'domcontentloaded'})
  await waitWalkReady(mp)
  await mp.evaluate(() => document.querySelector('.portrait-gate button')?.click())
  await mp.evaluate(() => document.querySelector('.spot-card .card-close')?.click())
  await walkNearSharedBike(mp, 'mob-shared', 1)
  const mLabel = await mp.locator('.vehicle-action').textContent()
  assert.equal(mLabel, '解锁共享电动车（¥2）')
  await mp.locator('.vehicle-action').tap()
  await mp.waitForFunction(() => window.viewer.walk.vehicle === 'bike', null, {timeout: 8000})
  const mobRide = await mp.evaluate(() => {
    for (let i = 0; i < 6; i++) window.viewer.walk.tick(1 / 60)
    const hud = document.querySelector('.ride-hud').getBoundingClientRect()
    const stats = document.querySelector('.hud-stats').getBoundingClientRect()
    const overlap = !(hud.right < stats.left || stats.right < hud.left || hud.bottom < stats.top || stats.bottom < hud.top)
    return {
      money: window.viewer.game.getState().money,
      stateText: document.querySelector('.ride-state')?.textContent,
      wheelieLocked: document.querySelector('.walk-ui .btn-wheelie')?.getAttribute('data-locked'),
      wheelieText: document.querySelector('.walk-ui .btn-wheelie')?.textContent,
      overlap,
    }
  })
  assert.equal(mobRide.money, 18)
  assert.equal(mobRide.wheelieLocked, '1')
  assert.equal(mobRide.wheelieText, '禁翘头')
  assert.equal(mobRide.overlap, false, 'Mobile ride-hud and hud-stats must not overlap')
  await mp.screenshot({path: resolve(OUT_DIR, '05-mobile-shared-hud.png')})
  await mCtx.close()
  console.log('[5/5] Mobile HUD & touch unlock verified:', JSON.stringify(mobRide))

  assert.deepEqual(errors, [], `Uncaught errors: ${JSON.stringify(errors)}`)
  console.log('verify:shared-ebike-v1 ALL PASSED')
} finally {
  await browser?.close()
  await server.close()
}
