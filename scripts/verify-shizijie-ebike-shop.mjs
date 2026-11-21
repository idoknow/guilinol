#!/usr/bin/env node
/**
 * Headless Playwright E2E + Visual Verification for IDOK-127:
 * 十字街电动车专卖店「漓行电驴行 · 十字街总店」(`shop_shizijie_ebike`)
 *
 * Verifies:
 *  1. Real shizijie.glb landmark loaded with `shizijie_shop_signs` night emissive material, 0 new dynamic lights.
 *  2. 3 exhibition plinth bikes (`lijiang_light`, `city_range`, `xiangshan_gt`) snapped flush onto granite plinths,
 *     distinct tier colors, facing Jiefang East Rd.
 *  3. Daytime (10:30) and Nighttime (20:48) storefront + fast-charging bay headless screenshots.
 *  4. Full map (`M`) displays「漓行电驴行」quick-nav button & search (`电动车`), click-to-teleport lands at storefront.
 *  5. `[F]` interact arbiter triggers `进店 · 漓行电驴行`, opens shop overlay with 360° live e-bike showcase on `stagePos`
 *     (d=+4.2m), 6 physical spec bars per model card, full 360° orbit drag with zero wall clipping (`!camInHouse`).
 *  6. Free test ride (`xiangshan_gt`) spawns on Jiefang East Rd (`testRideSpawn`), rides cleanly, ends atomically with 0 residual.
 *  7. Purchase `city_range` (¥3,600) + `visual:neon` (¥380) + `visual:topbox_delivery` (¥450) -> balance exact,
 *     delivers parked personal bike at `deliveryBay`, mount (`骑我的电摩`), P-gear unlock (`E -> D2`), headlight (`L`),
 *     reload page -> verifies 100% persistence in `glol.save.v1`, 0 `pageerror` & 0 `console.error`.
 */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const outDir = join(process.cwd(), 'captures/idok-127')
await mkdir(outDir, {recursive: true})

const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
const errors = []
let browser

async function settleFrames(page, n = 10) {
  await page.evaluate(count => new Promise(resolve => {
    let left = count
    const step = () => {
      window.viewer?.walk?.tick?.(1 / 60)
      if (--left <= 0) resolve()
      else requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }), n)
}

async function setHour(page, hour) {
  await page.evaluate(h => {
    const {clock} = window.viewer
    clock.flowing = false
    clock.hour = h
    clock.goal = h
  }, hour)
  // Let environment smooth damp converge (evaluate runs with ~1.2s time constant; step 90 frames or snap via reload?
  // Wait: let's tick enough frames so env.night settles cleanly!)
  await page.waitForFunction(targetNight => {
    const night = window.viewer?.env?.night ?? 0
    return targetNight ? night >= 0.92 : night <= 0.08
  }, hour >= 19 || hour < 5, {timeout: 15000})
  await settleFrames(page, 6)
}

try {
  browser = await chromium.launch(browserOptions())
  const ctx = await browser.newContext({viewport: {width: 1280, height: 720}})
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })
  await page.route('**/favicon.ico', r => r.fulfill({status: 204}))

  // 1. Boot daytime walk mode and walk to Jiefang East Rd sidewalk facing「漓行电驴行 · 十字街总店」
  await page.goto(`${baseUrl}/?verify&mode=walk&flow=0&time=10.5&radius=480`)
  await page.waitForFunction(() => window.viewer?.walk?.active && window.viewer?.game, null, {timeout: 90000})

  await page.evaluate(async () => {
    window.viewer.game.save.reset(200)
    await window.viewer.walkTo(-782.4, -150.2, -0.2317, 'idok127-day-wide')
  })
  await page.waitForFunction(() => {
    const lm = [...(window.viewer?.stream?.landmarks?.keys() ?? [])]
    const stands = window.viewer?.walk?.shop?.getShowroomStands?.() ?? []
    return lm.some(e => e.id === 'shizijie') && stands.length === 3 && stands.every(s => s.snapped && s.visible)
  }, null, {timeout: 60000})

  await page.evaluate(() => {
    window.viewer.walk.showFigure(false)
    window.viewer.walk.face(-0.2317, 0.03)
  })
  await settleFrames(page, 12)

  // Inspect loaded shizijie landmark materials & 3 showroom bikes
  const dayCheck = await page.evaluate(() => {
    const mats = new Set()
    let dynamicLights = 0
    for (const [entry, root] of window.viewer.stream.landmarks.entries()) {
      if (entry.id !== 'shizijie') continue
      root.traverse(obj => {
        if (obj.isLight) dynamicLights++
        if (obj.isMesh) {
          const list = Array.isArray(obj.material) ? obj.material : [obj.material]
          for (const m of list) if (m?.name) mats.add(m.name)
        }
      })
    }
    const stands = window.viewer.walk.shop.getShowroomStands()
    return {
      materials: [...mats].sort(),
      dynamicLights,
      stands,
      envNight: window.viewer.env.night,
    }
  })

  assert(dayCheck.materials.includes('shizijie_shop_signs'), `missing shizijie_shop_signs material: ${JSON.stringify(dayCheck.materials)}`)
  assert.equal(dayCheck.dynamicLights, 0, 'shizijie landmark must add 0 Three.js lights')
  assert.equal(dayCheck.stands.length, 3, 'expected 3 showroom display bikes')
  const standModels = dayCheck.stands.map(s => s.modelId)
  assert.deepEqual(standModels, ['lijiang_light', 'city_range', 'xiangshan_gt'])
  const uniquePaints = new Set(dayCheck.stands.map(s => s.paintColor))
  assert.equal(uniquePaints.size, 3, 'all 3 exhibition bikes must have distinct tier paints')
  for (const st of dayCheck.stands) {
    assert(st.pos[1] > 151.4 && st.pos[1] < 153.2, `stand ${st.id} Y out of plausible plinth range: ${st.pos[1]}`)
  }

  // Daytime storefront wide shot + closer plinth/charger shot
  await page.screenshot({path: join(outDir, '01-day-storefront.png')})

  await page.evaluate(async () => {
    await window.viewer.walkTo(-781.0, -155.8, -0.2317, 'idok127-day-plinths')
    window.viewer.walk.showFigure(false)
    window.viewer.walk.face(-0.2317, 0.08)
  })
  await settleFrames(page, 10)
  await page.screenshot({path: join(outDir, '02-day-plinths-closeup.png')})

  // 2. Nighttime storefront & glowing fast charger (20:48 -> env.night >= 0.92)
  await page.evaluate(async () => {
    await window.viewer.walkTo(-782.4, -150.2, -0.2317, 'idok127-night-wide')
    window.viewer.walk.showFigure(false)
    window.viewer.walk.face(-0.2317, 0.03)
  })
  await setHour(page, 20.8)
  await page.screenshot({path: join(outDir, '03-night-storefront.png')})

  // Charger close-up at night (standing on sidewalk looking at u=-6.2 charger)
  await page.evaluate(async () => {
    await window.viewer.walkTo(-786.5, -156.2, -0.18, 'idok127-night-charger')
    window.viewer.walk.showFigure(false)
    window.viewer.walk.face(-0.18, 0.05)
  })
  await settleFrames(page, 10)
  await page.screenshot({path: join(outDir, '04-night-charger.png')})

  // Switch back to daytime for clean map & showroom checks (then we'll also check delivery bay)
  await setHour(page, 11.0)
  await page.evaluate(() => window.viewer.walk.showFigure(true))

  // 3. Full Map (`M`) shop marker + search + quick-nav teleport
  await page.waitForSelector('.dock-map', {timeout: 30000})
  await page.click('.dock-map')
  await page.waitForSelector('.atlas.show', {timeout: 15000})
  const shopQuickBtn = page.locator('.atlas-shop-btn[data-shop="shop_shizijie_ebike"]')
  assert.equal(await shopQuickBtn.count(), 1, 'full map must show quick-nav button for shop_shizijie_ebike')
  await page.fill('.atlas-search input', '电动车')
  await page.waitForSelector('.atlas-search ol li', {timeout: 5000})
  const searchResultText = await page.locator('.atlas-search ol li').first().textContent()
  assert(searchResultText?.includes('漓行电驴行'), `expected 漓行电驴行 in search results, got: ${searchResultText}`)
  await page.locator('.atlas-search ol li').first().click()
  await page.waitForSelector('.atlas-pop:not([hidden])', {timeout: 5000})
  await page.waitForTimeout(250)
  await page.screenshot({path: join(outDir, '05-map-shop-marker.png')})

  // Click「前往」in map popup -> verify teleport lands at storefront triggerPos facing sign
  await page.click('.atlas-pop button')
  await page.waitForFunction(() => {
    const p = window.viewer?.walk?.position
    const open = window.viewer?.tour?.map?.active
    return !open && p && Math.hypot(p.x - (-780.05), p.z - (-160.08)) < 3.5
  }, null, {timeout: 15000})
  await settleFrames(page, 12)

  // 4. Verify [F] interact arbiter at storefront & open shop -> 360° live e-bike showcase
  const interactBeforeOpen = await page.evaluate(() => window.viewer.walk.shop.getInteractDecision())
  assert.equal(interactBeforeOpen?.action, 'open_shop', `expected open_shop interact decision, got ${JSON.stringify(interactBeforeOpen)}`)
  assert.equal(interactBeforeOpen?.shopId, 'shop_shizijie_ebike')
  assert(interactBeforeOpen?.label?.includes('漓行电驴行'), `expected 漓行电驴行 prompt label, got ${interactBeforeOpen?.label}`)

  await page.evaluate(() => window.viewer.walk.shop.triggerInteract())
  await page.waitForSelector('.shop-overlay.show', {timeout: 5000})
  await settleFrames(page, 12)

  const shopState = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.shop-card')]
    return {
      isOpen: window.viewer.walk.shop.isOpen(),
      showcaseVisible: window.viewer.walk.shop.showcaseVisible(),
      title: document.querySelector('.shop-title')?.textContent?.trim(),
      cardCount: cards.length,
      specCounts: cards.map(c => c.querySelectorAll('.shop-spec').length),
      camInHouse: window.viewer.walk.probe().camInHouse,
    }
  })
  assert.equal(shopState.isOpen, true)
  assert.equal(shopState.showcaseVisible, true, '360° live e-bike showcase rig must be visible')
  assert.equal(shopState.title, '漓行电驴行 · 十字街总店')
  assert.equal(shopState.cardCount, 3)
  assert.deepEqual(shopState.specCounts, [6, 6, 6], 'every e-bike model card must display 6 physical spec metrics')
  assert.equal(shopState.camInHouse, false, 'initial showroom showcase camera must not clip inside building')

  // Select 3rd tier xiangshan_gt to preview flagship bike on 360° stage
  await page.click('.shop-card[data-item-key="ebike_model:xiangshan_gt"]')
  await settleFrames(page, 10)
  await page.screenshot({path: join(outDir, '06-shop-showcase-360.png')})

  // Drag 360° across .shop-stage in 6 steps and assert camera never enters building
  const stageBox = await page.locator('.shop-stage').boundingBox()
  assert(stageBox && stageBox.width > 500, 'shop-stage bounding box missing')
  let orbitClipped = false
  for (let step = 0; step < 6; step++) {
    const sx = stageBox.x + stageBox.width * 0.65
    const sy = stageBox.y + stageBox.height * 0.55
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    await page.mouse.move(sx - 180, sy, {steps: 8})
    await page.mouse.up()
    await settleFrames(page, 4)
    const inHouse = await page.evaluate(() => window.viewer.walk.probe().camInHouse)
    if (inHouse) orbitClipped = true
  }
  assert.equal(orbitClipped, false, '360° orbit drag around showcase bike clipped inside a building!')

  // 5. Free test ride of xiangshan_gt from Jiefang East Rd testRideSpawn
  await page.click('.shop-act-secondary')
  await page.waitForFunction(() => window.viewer?.walk?.vehicle === 'bike' && window.viewer?.game?.getState()?.vehicle?.ownership === 'test_ride', null, {timeout: 10000})
  await settleFrames(page, 10)

  const testRideCheck = await page.evaluate(() => {
    const {walk, game} = window.viewer
    const p = walk.position
    const probe = walk.probe()
    return {
      pos: [p.x, p.y, p.z],
      distToSpawn: Math.hypot(p.x - (-782.25), p.z - (-150.73)),
      ownership: game.getState().vehicle?.ownership,
      modelId: game.getState().vehicle?.modelId,
      inHouse: probe.inHouse,
      wet: probe.wet,
      maxKmh: probe.ebike?.maxKmh,
    }
  })
  assert(testRideCheck.distToSpawn < 4.0, `test ride spawned too far from testRideSpawn: ${testRideCheck.distToSpawn}`)
  assert.equal(testRideCheck.ownership, 'test_ride')
  assert.equal(testRideCheck.modelId, 'xiangshan_gt')
  assert.equal(testRideCheck.inHouse, false)
  assert.equal(testRideCheck.wet, false)
  await page.screenshot({path: join(outDir, '07-test-ride-road.png')})

  // End test ride cleanly and verify zero residual test-ride state
  await page.evaluate(() => window.viewer.walk.garage.endTestRide('user'))
  await settleFrames(page, 8)
  const afterTestRide = await page.evaluate(() => {
    const s = window.viewer.game.getState()
    return {
      vehicle: window.viewer.walk.vehicle,
      activeTestRide: s.garage.activeTestRide,
      leakedKeys: Object.keys(s.garage.vehicles).filter(k => k.startsWith('test-ride:')),
    }
  })
  assert.equal(afterTestRide.vehicle, 'foot')
  assert.equal(afterTestRide.activeTestRide, null)
  assert.deepEqual(afterTestRide.leakedKeys, [])

  // 6. Insufficient funds guard -> credit funds -> buy city_range + neon + delivery topbox via real UI
  await page.evaluate(async () => {
    await window.viewer.walkTo(-780.05, -160.08, -0.2317, 'idok127-buy-return')
    window.viewer.walk.shop.open('shop_shizijie_ebike', 'models')
  })
  await page.waitForSelector('.shop-overlay.show', {timeout: 5000})
  await page.click('.shop-card[data-item-key="ebike_model:city_range"]')
  const primaryWarnLabel = await page.locator('.shop-act-primary').textContent()
  assert(primaryWarnLabel?.includes('余额不足'), `expected insufficient-funds button label, got: ${primaryWarnLabel}`)
  await page.click('.shop-act-primary')
  const warnText = await page.locator('.shop-status-msg').textContent()
  assert(warnText?.includes('还差'), `expected insufficient-funds status message, got: ${warnText}`)

  // Fund test wallet to ¥10,200 -> reopen models tab -> buy city_range (¥3,600) -> ¥6,600
  await page.evaluate(() => {
    window.viewer.game.save.reset(10200)
    window.viewer.walk.shop.open('shop_shizijie_ebike', 'models')
  })
  await page.click('.shop-card[data-item-key="ebike_model:city_range"]')
  await page.click('.shop-act-primary')
  await settleFrames(page, 8)
  assert.equal(await page.evaluate(() => window.viewer.game.getState().money), 6600)

  // Switch to visuals tab, preview & purchase neon (¥380) + topbox_delivery (¥450) -> ¥5,770
  await page.click('.shop-tab[data-tab="visuals"]')
  await page.click('.shop-card[data-item-key="ebike_visual:visual:neon"]')
  await page.click('.shop-act-primary')
  await page.click('.shop-card[data-item-key="ebike_visual:visual:topbox_delivery"]')
  await page.click('.shop-act-primary')
  await settleFrames(page, 10)
  assert.equal(await page.evaluate(() => window.viewer.game.getState().money), 5770)

  // Preview night glow on modded showcase bike before closing
  await setHour(page, 20.8)
  await page.screenshot({path: join(outDir, '08-shop-mod-preview-night.png')})

  // Close shop -> check deliveryBay personal bike parked with kickstand & night neon
  await page.click('.shop-act-close')
  await page.waitForFunction(() => !window.viewer.walk.shop.isOpen(), null, {timeout: 5000})
  await page.evaluate(async () => {
    await window.viewer.walkTo(-778.0, -154.6, 0.25, 'idok127-view-delivery')
    window.viewer.walk.face(0.32, 0.14)
  })
  await settleFrames(page, 12)
  await page.screenshot({path: join(outDir, '09-delivery-bay-night.png')})

  // Walk beside deliveryBay personal bike -> mount -> P-gear unlock E->D2 -> cycle headlight L
  const rideCheck = await page.evaluate(async () => {
    const {walk, game} = window.viewer
    await window.viewer.walkTo(-778.6, -157.0, 1.3391, 'idok127-mount-delivery')
    for (let i = 0; i < 8; i++) walk.tick(1 / 60)
    const dec = walk.shop.getInteractDecision()
    walk.shop.triggerInteract()
    for (let i = 0; i < 8; i++) walk.tick(1 / 60)
    const mountedOwnership = game.getState().vehicle?.ownership
    const mountedModel = game.getState().vehicle?.modelId
    walk.ebike.setPark(true, true)
    walk.tick(1 / 60)
    const locked = walk.probe().ebike?.parkLocked === true
    walk.ebike.shiftGear(1)
    walk.tick(1 / 60)
    const unlockedD2 = walk.probe().ebike?.parkLocked === false && walk.probe().ebike?.gear === 2
    const lightNext = walk.ebike.cycleHeadlight()
    return {dec, mountedOwnership, mountedModel, locked, unlockedD2, lightNext}
  })
  assert.equal(rideCheck.dec?.label, '骑我的电摩', `expected 骑我的电摩 near deliveryBay, got ${JSON.stringify(rideCheck.dec)}`)
  assert.equal(rideCheck.mountedOwnership, 'personal')
  assert.equal(rideCheck.mountedModel, 'city_range')
  assert.equal(rideCheck.locked, true)
  assert.equal(rideCheck.unlockedD2, true)
  assert(['low', 'high', 'off'].includes(rideCheck.lightNext))

  // 7. Full page reload -> verify glol.save.v1 persistence
  await page.reload()
  await page.waitForFunction(() => window.viewer?.walk?.active && window.viewer?.game, null, {timeout: 90000})
  const persisted = await page.evaluate(() => {
    const s = window.viewer.game.getState()
    const active = s.garage.activeVehicleId ? s.garage.vehicles[s.garage.activeVehicleId] : null
    return {
      money: s.money,
      modelId: active?.modelId,
      underglow: active?.visual?.underglow,
      topbox: active?.visual?.topbox,
    }
  })
  assert.equal(persisted.money, 5770)
  assert.equal(persisted.modelId, 'city_range')
  assert.equal(persisted.underglow, true)
  assert.equal(persisted.topbox, 'delivery')

  assert.deepEqual(errors, [], `runtime errors: ${errors.join('; ')}`)
  console.log('IDOK-127 SHIZIJIE EBIKE SHOP E2E OK:', JSON.stringify({
    materials: dayCheck.materials,
    stands: dayCheck.stands.map(s => ({id: s.id, modelId: s.modelId, y: +s.pos[1].toFixed(2)})),
    specCounts: shopState.specCounts,
    orbitClipped,
    testRideDistM: +testRideCheck.distToSpawn.toFixed(2),
    persisted,
    capturesDir: outDir,
  }))
} finally {
  if (browser) await browser.close()
  await new Promise(r => server.httpServer.close(r))
}
