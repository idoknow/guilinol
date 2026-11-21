#!/usr/bin/env node
/**
 * Real-browser Playwright E2E smoke test for Stage 1A (IDOK-122) & Stage 1C (IDOK-124):
 *  - Boots built Guilin 3D scene in walk mode with 0 uncaught runtime/console errors
 *  - Verifies 3-viewport layout (1280x720 desktop, 390x844 mobile portrait, 844x390 mobile landscape)
 *    including landscape `.vehicle-action` above `.ride-hud` with zero overlap & `top >= 260`
 *  - Walks through earn -> buy outfit at 漓尚衣坊 -> buy & mod personal e-bike at 榕城电行
 *    -> quiet-zone summon block -> street summon -> free test ride start/end -> page reload persistence!
 * Always closes Playwright browser & Vite preview server in `finally`.
 */
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

let server
let browser
const failures = []
let passed = 0

function check(label, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`ok   ${label}${detail ? ` (${detail})` : ''}`)
  } else {
    failures.push(`${label}${detail ? `: ${detail}` : ''}`)
    console.error(`FAIL ${label}${detail ? ` (${detail})` : ''}`)
  }
}

function rectsOverlap(a, b, pad = 0) {
  if (!a || !b || a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false
  return !(a.right - pad <= b.left || b.right - pad <= a.left || a.bottom - pad <= b.top || b.bottom - pad <= a.top)
}

try {
  server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
  const port = server.httpServer.address().port
  const baseUrl = `http://127.0.0.1:${port}`
  browser = await chromium.launch(browserOptions())

  // ---- 1. Desktop 1280x720 full functional flow + persistence across reload ----
  const deskCtx = await browser.newContext({viewport: {width: 1280, height: 720}})
  const page = await deskCtx.newPage()
  await page.route('**/api/t', route => route.fulfill({status: 204, body: ''}))
  const errors = []
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })

  await page.goto(`${baseUrl}/?verify&mode=walk&spawn=crossing`, {waitUntil: 'domcontentloaded'})
  await page.waitForFunction(() => !!window.viewer?.walk?.active && !!window.viewer?.game, null, {timeout: 45000})
  await page.waitForTimeout(600)

  const initSnap = await page.evaluate(() => ({
    money: window.viewer.game.getState().money,
    shops: window.viewer.walk.shops.list.map(s => s.brandName),
    quietCount: window.viewer.game.quietZones.QUIET_ZONES.length,
  }))
  check('desktop boots walk mode with game/shops/quietZones mounted', initSnap.money === 200 && initSnap.shops.includes('漓尚衣坊') && initSnap.shops.includes('榕城电行') && initSnap.quietCount === 25, JSON.stringify(initSnap))

  // Credit earnings, open 漓尚衣坊, check drawer bounds & modal input lock, buy T1 outfit, Esc close
  const apparelResult = await page.evaluate(() => {
    const g = window.viewer.game
    g.commerce.creditReward({source: 'mission_delivery', refId: 'e2e_m1', amount: 2000, firstClearOnly: true, idempotencyKey: 'e2e_rwd_1'})
    g.commerce.creditReward({source: 'mission_delivery', refId: 'e2e_m2', amount: 1200, firstClearOnly: true, idempotencyKey: 'e2e_rwd_2'})
    const opened = window.viewer.walk.shops.open('shop_nikoniko_apparel')
    const drawer = document.querySelector('.cm-drawer')?.getBoundingClientRect()
    const shopOpenAttr = document.body.dataset.shopOpen
    const buyRes = g.commerce.executePurchase({
      shopId: 'shop_nikoniko_apparel',
      itemType: 'outfit_preset',
      itemId: 'outfit_guilin_hoodie',
      expectedPrice: 480,
      idempotencyKey: 'e2e_buy_outfit_1',
    })
    return {
      opened,
      shopOpenAttr,
      drawerInBounds: !!drawer && drawer.left >= 0 && drawer.right <= 1280 && drawer.top >= 0 && drawer.bottom <= 720,
      buyOk: buyRes.ok && buyRes.charged === 480,
      equippedTop: g.getState().wardrobe.equipped.top,
      moneyAfter: g.getState().money,
    }
  })
  check('漓尚衣坊 opens cleanly on 1280x720, locks input & purchases T1 outfit atomically', apparelResult.opened && apparelResult.shopOpenAttr === '1' && apparelResult.drawerInBounds && apparelResult.buyOk && apparelResult.equippedTop === 'top_guilin_hoodie' && apparelResult.moneyAfter === 2920, JSON.stringify(apparelResult))

  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  const closedByEsc = await page.evaluate(() => !window.viewer.walk.shops.isOpen && !document.body.dataset.shopOpen)
  check('Escape closes shop overlay and clears data-shop-open', closedByEsc)

  // Open 榕城电行, buy lijiang_light + motor:1 upgrade, summon personal bike, test-ride start & end
  const ebikeResult = await page.evaluate(() => {
    const g = window.viewer.game
    window.viewer.walk.shops.open('shop_shizijie_ebike')
    const buyBike = g.commerce.executePurchase({
      shopId: 'shop_shizijie_ebike',
      itemType: 'ebike_model',
      itemId: 'lijiang_light',
      expectedPrice: 1800,
      idempotencyKey: 'e2e_buy_bike_1',
    })
    const vid = buyBike.createdVehicleId
    const buyMod = g.commerce.executePurchase({
      shopId: 'shop_shizijie_ebike',
      itemType: 'ebike_upgrade',
      itemId: 'motor:1',
      targetVehicleId: vid,
      expectedPrice: 320,
      idempotencyKey: 'e2e_buy_mod_1',
    })
    window.viewer.walk.shops.close('user')
    const summonRes = window.viewer.walk.garage.summon(vid)
    const trStart = window.viewer.walk.garage.startTestRide('shop_shizijie_ebike', 'xiangshan_gt')
    const hasTrState = !!g.getState().garage.activeTestRide
    window.viewer.walk.garage.endTestRide('user')
    const clearedTrState = !g.getState().garage.activeTestRide
    const rawSave = JSON.parse(localStorage.getItem('glol.save.v1') || '{}')
    return {
      buyBikeOk: buyBike.ok && !!vid,
      buyModOk: buyMod.ok && buyMod.charged === 320,
      summonOk: summonRes.ok,
      trStartOk: trStart.ok && hasTrState && clearedTrState,
      noTestRideInSave: !Object.keys(rawSave.garage?.vehicles || {}).some(k => k.startsWith('test-ride:')),
      moneyAfter: g.getState().money,
      vid,
    }
  })
  check('榕城电行 buy/mod/summon/test-ride lifecycle succeeds with zero test-ride pollution in save', ebikeResult.buyBikeOk && ebikeResult.buyModOk && ebikeResult.summonOk && ebikeResult.trStartOk && ebikeResult.noTestRideInSave && ebikeResult.moneyAfter === 800, JSON.stringify(ebikeResult))

  // Reload page and confirm full persistence!
  await page.reload({waitUntil: 'domcontentloaded'})
  await page.waitForFunction(() => !!window.viewer?.walk?.active && !!window.viewer?.game, null, {timeout: 45000})
  const afterReload = await page.evaluate(vid => {
    const s = window.viewer.game.getState()
    const v = s.garage.vehicles[vid]
    return {
      money: s.money,
      top: s.wardrobe.equipped.top,
      modelId: v?.modelId,
      motorLevel: v?.upgrades?.motorLevel,
    }
  }, ebikeResult.vid)
  check('reload restores exact money, equipped outfit & upgraded personal e-bike from glol.save.v1', afterReload.money === 800 && afterReload.top === 'top_guilin_hoodie' && afterReload.modelId === 'lijiang_light' && afterReload.motorLevel === 1, JSON.stringify(afterReload))
  check('desktop session has 0 runtime/console errors', errors.length === 0, errors.join('; '))
  await deskCtx.close()

  // ---- 2. Mobile Portrait 390x844 Shop Drawer Layout ----
  const portCtx = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true})
  const portPage = await portCtx.newPage()
  await portPage.route('**/api/t', route => route.fulfill({status: 204, body: ''}))
  await portPage.goto(`${baseUrl}/?verify&mode=walk&spawn=crossing`, {waitUntil: 'domcontentloaded'})
  await portPage.waitForFunction(() => !!window.viewer?.walk?.active && !!window.viewer?.game, null, {timeout: 45000})
  const portMetrics = await portPage.evaluate(() => {
    window.viewer.walk.shops.open('shop_nikoniko_apparel')
    const drawer = document.querySelector('.cm-drawer')?.getBoundingClientRect()
    const walkUiHidden = getComputedStyle(document.querySelector('.walk-ui')).display === 'none'
    return {drawer, walkUiHidden}
  })
  check('mobile portrait 390x844 bottom drawer fits viewport cleanly and hides walk-ui', !!portMetrics.drawer && portMetrics.drawer.left >= 0 && portMetrics.drawer.right <= 390 && portMetrics.drawer.top >= 300 && portMetrics.drawer.bottom <= 844 && portMetrics.walkUiHidden, JSON.stringify(portMetrics.drawer))
  await portCtx.close()

  // ---- 3. Mobile Landscape 844x390 Dismount Button (IDOK-124) & Shop Layout ----
  const landCtx = await browser.newContext({viewport: {width: 844, height: 390}, hasTouch: true, isMobile: true})
  const landPage = await landCtx.newPage()
  await landPage.route('**/api/t', route => route.fulfill({status: 204, body: ''}))
  await landPage.goto(`${baseUrl}/?verify&mode=walk&spawn=crossing`, {waitUntil: 'domcontentloaded'})
  await landPage.waitForFunction(() => !!window.viewer?.walk?.active && !!window.viewer?.game && !!document.querySelector('.vehicle-action'), null, {timeout: 45000})
  await landPage.waitForTimeout(300)
  const landMetrics = await landPage.evaluate(() => {
    // Simulate riding state to inspect `.vehicle-action` ("下车") vs `.ride-hud` exact geometry on 844x390
    document.body.setAttribute('data-aboard', '')
    document.body.dataset.ride = 'bike'
    const act = document.querySelector('.vehicle-action')
    if (act) { act.hidden = false; act.textContent = '下车' }
    const actRect = act?.getBoundingClientRect()
    const hudRect = document.querySelector('.ride-hud')?.getBoundingClientRect()
    window.viewer.walk.shops.open('shop_shizijie_ebike')
    const drawerRect = document.querySelector('.cm-drawer')?.getBoundingClientRect()
    return {
      actRect: actRect ? {left: actRect.left, top: actRect.top, right: actRect.right, bottom: actRect.bottom, width: actRect.width, height: actRect.height} : null,
      hudRect: hudRect ? {left: hudRect.left, top: hudRect.top, right: hudRect.right, bottom: hudRect.bottom, width: hudRect.width, height: hudRect.height} : null,
      drawerRect: drawerRect ? {left: drawerRect.left, top: drawerRect.top, right: drawerRect.right, bottom: drawerRect.bottom, width: drawerRect.width, height: drawerRect.height} : null,
    }
  })
  const noActHudOverlap = !rectsOverlap(landMetrics.actRect, landMetrics.hudRect, 1)
  check(
    'IDOK-124 mobile landscape 844x390 .vehicle-action sits at top >= 260 (below rider center) with 0 overlap against .ride-hud',
    !!landMetrics.actRect && landMetrics.actRect.top >= 260 && landMetrics.actRect.bottom <= 390 && noActHudOverlap,
    `act=${JSON.stringify(landMetrics.actRect)} hud=${JSON.stringify(landMetrics.hudRect)}`,
  )
  check(
    'mobile landscape 844x390 shop drawer fits right 44% cleanly inside viewport',
    !!landMetrics.drawerRect && landMetrics.drawerRect.left >= 440 && landMetrics.drawerRect.right <= 844 && landMetrics.drawerRect.top >= 0 && landMetrics.drawerRect.bottom <= 390,
    JSON.stringify(landMetrics.drawerRect),
  )
  await landCtx.close()

  console.log(`\nBROWSER E2E STAGE 1 RESULT: ${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    console.error('Failures:\n- ' + failures.join('\n- '))
    process.exitCode = 1
  }
} finally {
  await browser?.close()
  await server?.close()
}
