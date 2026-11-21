import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const outDir = process.env.EBIKE_SHOT_DIR
const STRICT_V2 = process.argv.includes('--strict-v2') || process.env.STRICT_TWOWHEEL_V2 === '1'
if (outDir) await mkdir(outDir, {recursive: true})

const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
let browser

function checkRectsScript() {
  return ({width, height, selectors}) => {
    const boxes = selectors.map(sel => {
      const el = document.querySelector(sel)
      if (!el) return {sel, missing: true}
      const st = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const hidden = st.display === 'none' || st.visibility === 'hidden' || el.hasAttribute('hidden') || r.width === 0 || r.height === 0
      return {
        sel,
        missing: false,
        hidden,
        left: +r.left.toFixed(1),
        top: +r.top.toFixed(1),
        right: +r.right.toFixed(1),
        bottom: +r.bottom.toFixed(1),
      }
    })
    const visible = boxes.filter(b => !b.missing && !b.hidden)
    const overlaps = []
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const a = visible[i], b = visible[j]
        const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        const oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
        if (ox * oy > 0) overlaps.push({a: a.sel, b: b.sel, area: +(ox * oy).toFixed(1)})
      }
    }
    const outOfBounds = visible.filter(b => b.left < -0.5 || b.top < -0.5 || b.right > width + 0.5 || b.bottom > height + 0.5)
    return {boxes, overlaps, outOfBounds}
  }
}

try {
  browser = await chromium.launch(browserOptions())
  const errors = []

  // --- A. Desktop 1280x720: stance, wheelie, lean, crash/recover, mod slots, HUD ---
  const deskCtx = await browser.newContext({viewport: {width: 1280, height: 720}})
  const page = await deskCtx.newPage()
  page.on('pageerror', e => errors.push('desk: ' + e.message))
  await page.route('**/favicon.ico', r => r.fulfill({status: 204}))
  await page.goto(`${baseUrl}/?verify&mode=walk&flow=0`)
  await page.waitForFunction(() => window.viewer?.walk?.active && window.viewer.walk.parked('bike').length > 0, null, {timeout: 90000})

  // Move to nearest parked e-bike on plaza or Jiefang East road and mount
  await page.evaluate(async () => {
    const {walk} = window.viewer
    const target = walk.parked('bike').find(b => Math.hypot(b[0] + 539, b[2] + 95) < 12) ?? walk.parked('bike')[0]
    await window.viewer.walkTo(target[0], target[2], 0, 'ebike-test')
    for (let i = 0; i < 6; i++) walk.tick(1 / 60)
  })
  await page.waitForFunction(() => document.querySelector('.vehicle-action')?.textContent === '骑电动车')
  await page.keyboard.press('f')
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike' && document.body.dataset.ride === 'bike')
  await page.evaluate(() => {
    window.viewer.walk.ebike.setVehicleType('normal')
    window.viewer.walk.tick(1 / 60)
  })

  // Default compliant gear on mount (D2 <= 25 km/h), normal bike type & full battery
  assert.equal(await page.textContent('.ride-type'), '电摩')
  assert.equal(await page.textContent('.ride-gear'), 'D2')
  assert.equal(await page.textContent('.ride-bat-pct'), '100%')
  assert.equal(await page.evaluate(() => window.viewer.walk.probe().ebike.maxKmh), 25)

  // Clickable gear pills + Shift Q/E + Key1..4 work smoothly on e-bike
  await page.click('.ride-gear-btn[data-gear="3"]')
  await page.evaluate(() => window.viewer.walk.tick(1 / 60))
  assert.equal(await page.textContent('.ride-gear'), 'D3')
  await page.keyboard.press('e')
  await page.evaluate(() => window.viewer.walk.tick(1 / 60))
  assert.equal(await page.textContent('.ride-gear'), 'S')
  assert.equal(await page.evaluate(() => window.viewer.walk.probe().ebike.maxKmh), 50)
  await page.keyboard.press('q')
  await page.evaluate(() => window.viewer.walk.tick(1 / 60))
  assert.equal(await page.textContent('.ride-gear'), 'D3')

  // Switch to shared e-bike -> capped at 40 km/h on S, badge = 共享, hides .ride-mod
  await page.evaluate(() => {
    window.viewer.walk.ebike.setVehicleType('shared')
    window.viewer.walk.tick(1 / 60)
  })
  assert.equal(await page.textContent('.ride-type'), '共享')
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.ride-mod')).display), 'none')
  await page.keyboard.press('e')
  await page.evaluate(() => window.viewer.walk.tick(1 / 60))
  assert.equal(await page.textContent('.ride-gear'), 'S')
  assert.equal(await page.evaluate(() => window.viewer.walk.probe().ebike.maxKmh), 40)

  // Low battery & critical battery warning HUD
  await page.evaluate(() => {
    window.viewer.walk.ebike.setBattery(18)
    window.viewer.walk.tick(1 / 60)
  })
  assert.equal(await page.evaluate(() => document.querySelector('.ride-bat').dataset.level), 'low')
  assert.equal(await page.textContent('.ride-bat-pct'), '18%')
  assert.equal(await page.textContent('.ride-state'), '低电预警')

  await page.evaluate(() => {
    window.viewer.walk.ebike.setBattery(8)
    window.viewer.walk.tick(1 / 60)
  })
  assert.equal(await page.evaluate(() => document.querySelector('.ride-bat').dataset.level), 'crit')
  const critMax = await page.evaluate(() => window.viewer.walk.probe().ebike.maxKmh)
  assert(critMax >= 10 && critMax <= 16, `expected critical battery cap in 10..16, got ${critMax}`)
  assert.equal(await page.textContent('.ride-state'), `极低电 · 限速 ${Math.round(critMax)}`)

  await page.evaluate(() => {
    window.viewer.walk.ebike.setBattery(0)
    window.viewer.walk.tick(1 / 60)
  })
  assert.equal(await page.evaluate(() => window.viewer.walk.probe().ebike.maxKmh), 10)
  assert.equal(await page.textContent('.ride-state'), '电量耗尽 · 限速 10')

  await page.evaluate(() => {
    window.viewer.walk.ebike.setVehicleType('shared')
    window.viewer.walk.ebike.setBattery(15)
    window.viewer.walk.tick(1 / 60)
  })
  assert.equal(await page.textContent('.ride-type'), '共享')
  assert.equal(await page.textContent('.ride-bat-pct'), '15%')
  if (outDir) await page.screenshot({path: `${outDir}/desktop-shared-lowbat.png`})

  // Restore to normal e-bike at full battery, toggle Ghostfire & drop back to D3
  await page.evaluate(() => {
    window.viewer.walk.ebike.setVehicleType('normal')
    window.viewer.walk.ebike.setBattery(100)
    window.viewer.walk.tick(1 / 60)
  })
  await page.keyboard.press('q')
  await page.evaluate(() => window.viewer.walk.tick(1 / 60))
  await page.keyboard.press('g')
  await page.evaluate(() => window.viewer.walk.tick(1 / 60))
  assert.equal(await page.textContent('.ride-mod'), '鬼火')
  assert.equal(await page.evaluate(() => window.viewer.walk.probe().ebike.modPreset), 'ghostfire')

  // Accelerate + wheelie + corner lean
  const wheelieRes = await page.evaluate(() => {
    const {walk} = window.viewer
    for (let i = 0; i < 16; i++) walk.tick(1 / 60)
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
    for (let i = 0; i < 45; i++) walk.tick(1 / 60)
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Space'}))
    for (let i = 0; i < 40; i++) walk.tick(1 / 60)
    const pWheelie = walk.probe()
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Space'}))
    for (let i = 0; i < 30; i++) walk.tick(1 / 60)
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyD'}))
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'ShiftLeft'}))
    for (let i = 0; i < 35; i++) walk.tick(1 / 60)
    const pLean = walk.probe()
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'ShiftLeft'}))
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyD'}))
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
    return {pWheelie, pLean}
  })
  assert(wheelieRes.pWheelie.ebike.wheelie > .25, `wheelie angle too low: ${JSON.stringify(wheelieRes.pWheelie.ebike)}`)
  assert(wheelieRes.pWheelie.ebikeRig.wheelie > .25, 'dynamic rig wheeliePivot should rotate')
  assert(Math.abs(wheelieRes.pWheelie.ebikeRig.rearWheelSpin) > 1, 'rear wheel should spin')
  assert(wheelieRes.pLean.ebike.lean < -.22, `cornering right lean expected negative: ${JSON.stringify(wheelieRes.pLean.ebike)}`)
  assert(wheelieRes.pLean.ebikeRig.steer < -.1, 'front steering assembly should turn')

  if (outDir) {
    await page.evaluate(() => {
      const {walk} = window.viewer
      walk.face(walk.heading + .95, .18)
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Space'}))
      for (let i = 0; i < 36; i++) walk.tick(1 / 60)
    })
    await page.screenshot({path: `${outDir}/desktop-ghostfire-wheelie.png`})
    await page.evaluate(() => {
      const {walk} = window.viewer
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Space'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
      walk.face(walk.heading, .3)
    })
  }

  // Desktop HUD check while riding
  const deskHud = await page.evaluate(checkRectsScript(), {
    width: 1280, height: 720,
    selectors: ['output', '.hud-me', '.sky-ui', '.render-entry', '.dock', 'footer', '.hint', '.vehicle-action', '.ride-hud'],
  })
  assert.deepEqual(deskHud.overlaps, [], `desktop ride HUD overlap: ${JSON.stringify(deskHud.overlaps)}`)
  assert.deepEqual(deskHud.outOfBounds, [], `desktop ride HUD outOfBounds: ${JSON.stringify(deskHud.outOfBounds)}`)

  // Crash separation -> rider stands up FIRST while bike remains sideways -> walk near -> F pickup upright -> remount
  await page.evaluate(() => {
    const {walk} = window.viewer
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyS'}))
    for (let i = 0; i < 40; i++) walk.tick(1 / 60)
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyS'}))
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
    for (let i = 0; i < 20; i++) walk.tick(1 / 60)
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
    walk.ebike.triggerCrash('lowside', 1)
    for (let i = 0; i < 36; i++) walk.tick(1 / 60)
  })
  if (outDir) await page.screenshot({path: `${outDir}/desktop-crash.png`})
  const crashRes = await page.evaluate(() => {
    const {walk} = window.viewer
    const crashed = walk.probe()
    const sepDist = Math.hypot(crashed.figPos[0] - crashed.ebikeRig.seatWorld[0], crashed.figPos[2] - crashed.ebikeRig.seatWorld[2])
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Space'}))
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Space'}))
    for (let i = 0; i < 8; i++) walk.tick(1 / 60)
    const rising = walk.probe()
    for (let i = 0; i < 55; i++) walk.tick(1 / 60)
    const stood = walk.probe()
    return {crashed, sepDist, rising, stood}
  })
  assert.equal(crashRes.crashed.twoWheelFlow, 'crashed')
  assert.equal(crashRes.crashed.ebike.crashPhase, 'crashed')
  assert(Math.abs(crashRes.crashed.ebikeRig.crashRoll) > 1.0, 'crashed e-bike should lie on side')
  assert(crashRes.sepDist > .45, `rider should separate from crashed bike: sepDist=${crashRes.sepDist}`)
  assert.equal(crashRes.rising.twoWheelFlow, 'standing_up', 'rider should stand up FIRST before pickup')
  assert.equal(crashRes.rising.downedCount, 1)
  assert(Math.abs(crashRes.rising.downedBikes[0].roll) > 1.3, 'downed bike must stay lying sideways while rider rises')
  assert.equal(crashRes.stood.twoWheelFlow, 'foot')
  assert.equal(crashRes.stood.downedCount, 1)
  assert(Math.abs(crashRes.stood.downedBikes[0].roll) > 1.3, 'bike must stay on side after rider stands up')

  // Walk close to the downed bike (just like a player returning on foot to lift it)
  await page.evaluate(() => {
    const {walk} = window.viewer
    const target = walk.probe().downedBikes[0]
    if (target && target.dist > 1.8) {
      const yawToBike = Math.atan2(-(target.x - walk.probe().x), -(target.z - walk.probe().z))
      walk.face(yawToBike, .28)
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
      for (let i = 0; i < 120; i++) {
        walk.tick(1 / 60)
        if ((walk.probe().downedBikes[0]?.dist ?? 99) < 1.8) break
      }
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
    }
    walk.tick(1 / 60)
  })
  if (outDir) await page.screenshot({path: `${outDir}/desktop-crash-stood.png`})

  const nearText = await page.textContent('.vehicle-action')
  assert(nearText?.includes('扶起电动车'), `expected pickup prompt 扶起电动车, got ${nearText}`)
  await page.keyboard.press('f')
  const pickupSnap = await page.evaluate(() => {
    const {walk} = window.viewer
    walk.tick(1 / 60)
    const during = walk.probe()
    for (let i = 0; i < 50; i++) walk.tick(1 / 60)
    const after = walk.probe()
    return {during, after}
  })
  assert.equal(pickupSnap.during.twoWheelFlow, 'picking_up')
  assert.equal(pickupSnap.after.downedCount, 0)
  assert.equal(pickupSnap.after.twoWheelFlow, 'foot')
  await page.waitForFunction(() => document.querySelector('.vehicle-action')?.textContent === '骑电动车')
  await page.keyboard.press('f')
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike')

  // Dismount restores foot state & clears ride HUD, and remounting resets gear to compliant D2 (<=25) while keeping battery
  await page.evaluate(() => {
    window.viewer.walk.ebike.setBattery(77)
    window.viewer.walk.tick(1 / 60)
  })
  await page.keyboard.press('f')
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'foot')
  assert.equal(await page.evaluate(() => document.body.dataset.ride ?? ''), '')
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.ride-hud')).display), 'none')
  await page.evaluate(() => window.viewer.walk.tick(1 / 60))
  await page.waitForFunction(() => document.querySelector('.vehicle-action')?.textContent === '骑电动车')
  await page.keyboard.press('f')
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike')
  await page.evaluate(() => window.viewer.walk.tick(1 / 60))
  assert.equal(await page.textContent('.ride-gear'), 'D2')
  assert.equal(await page.evaluate(() => window.viewer.walk.probe().ebike.maxKmh), 25)
  assert.equal(await page.textContent('.ride-bat-pct'), '77%')
  await page.keyboard.press('f')
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'foot')

  // Bicycle desktop HUD: visible & clickable 1挡 / 2挡 / 3挡 gears + crash/stand-up/pickup flow
  await page.evaluate(async () => {
    const {walk} = window.viewer
    const bc = walk.parked('bicycle').find(b => Math.hypot(b[0] + 588, b[2] + 212) < 30) ?? walk.parked('bicycle')[0]
    await window.viewer.walkTo(bc[0], bc[2], 0, 'bicycle-fx-test')
    for (let i = 0; i < 6; i++) walk.tick(1 / 60)
  })
  await page.waitForFunction(() => document.querySelector('.vehicle-action')?.textContent === '骑单车')
  await page.keyboard.press('f')
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'bicycle' && document.body.dataset.ride === 'bicycle')
  await page.evaluate(() => window.viewer.walk.tick(1 / 60))
  assert.equal(await page.textContent('.ride-type'), '单车')
  assert.equal(await page.textContent('.ride-gear'), '2挡')
  assert.equal(await page.evaluate(() => document.querySelector('.ride-gear-btn[data-gear="4"]')?.hidden), true)
  await page.click('.ride-gear-btn[data-gear="3"]')
  await page.evaluate(() => window.viewer.walk.tick(1 / 60))
  assert.equal(await page.textContent('.ride-gear'), '3挡')
  await page.keyboard.press('q')
  await page.evaluate(() => window.viewer.walk.tick(1 / 60))
  assert.equal(await page.textContent('.ride-gear'), '2挡')
  if (outDir) await page.screenshot({path: `${outDir}/desktop-bicycle-gears.png`})
  await page.keyboard.press('f')
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'foot')

  console.log('Desktop two-wheel FX, bicycle gears & rider-first crash/pickup OK', {
    wheelie: +wheelieRes.pWheelie.ebike.wheelie.toFixed(3),
    lean: +wheelieRes.pLean.ebike.lean.toFixed(3),
    sepDist: +crashRes.sepDist.toFixed(2),
  })
  await deskCtx.close()

  // --- B. Mobile Portrait (390x844) & Landscape (844x390) ---
  for (const [label, vp] of [['390x844', {width: 390, height: 844}], ['844x390', {width: 844, height: 390}]]) {
    const ctx = await browser.newContext({viewport: vp, deviceScaleFactor: 1, isMobile: true, hasTouch: true})
    const mp = await ctx.newPage()
    mp.on('pageerror', e => errors.push(`${label}: ${e.message}`))
    await mp.route('**/favicon.ico', r => r.fulfill({status: 204}))
    await mp.goto(`${baseUrl}/?verify&mode=walk&flow=0&time=10.5`)
    await mp.waitForFunction(() => window.viewer?.walk?.active && window.viewer?.tour?.map && window.viewer.walk.parked('bike').length > 0, null, {timeout: 90000})

    await mp.evaluate(async () => {
      const target = window.viewer.walk.parked('bike')[0]
      await window.viewer.walkTo(target[0], target[2], 0, 'mobile-ebike')
      for (let i = 0; i < 4; i++) window.viewer.walk.tick(1 / 60)
      document.querySelector('.spot-card.show .card-close')?.click()
    })
    await mp.waitForFunction(() => document.querySelector('.vehicle-action')?.textContent === '骑电动车')
    await mp.locator('.vehicle-action').tap()
    await mp.waitForFunction(() => window.viewer.walk.vehicle === 'bike' && document.body.dataset.ride === 'bike')
    await mp.evaluate(async () => { for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame) })

    // Verify jump/run remain hidden (compat with verify:ride) and bike touch buttons + ride-hud have 0 overlap
    const hudCheck = await mp.evaluate(checkRectsScript(), {
      ...vp,
      selectors: [
        'output', '.hud-me', '.sky-ui', '.render-entry', '.dock', 'footer', '.vehicle-action',
        '.walk-ui .joystick', '.walk-ui .btn-view',
        '.walk-ui .btn-wheelie', '.walk-ui .btn-gear-up', '.walk-ui .btn-gear-down', '.walk-ui .btn-tuck',
        '.ride-hud',
      ],
    })
    assert.deepEqual(hudCheck.overlaps, [], `${label} ride HUD overlap: ${JSON.stringify(hudCheck.overlaps)}`)
    assert.deepEqual(hudCheck.outOfBounds, [], `${label} ride HUD outOfBounds: ${JSON.stringify(hudCheck.outOfBounds)}`)
    const hiddenCheck = await mp.evaluate(() => ({
      jumpHidden: getComputedStyle(document.querySelector('.walk-ui .btn-jump')).display === 'none',
      runHidden: getComputedStyle(document.querySelector('.walk-ui .btn-run')).display === 'none',
    }))
    assert(hiddenCheck.jumpHidden && hiddenCheck.runHidden, `${label} jump/run must remain hidden while riding`)

    // Touch controls: tap gear up & hold wheelie while pushing joystick
    await mp.locator('.walk-ui .btn-gear-up').tap()
    await mp.evaluate(() => window.viewer.walk.tick(1 / 60))
    assert.equal(await mp.textContent('.ride-gear'), 'D3')

    await mp.evaluate(() => {
      const {walk} = window.viewer
      const joy = document.querySelector('.walk-ui .joystick')
      const wBtn = document.querySelector('.walk-ui .btn-wheelie')
      const jr = joy.getBoundingClientRect()
      joy.dispatchEvent(new PointerEvent('pointerdown', {pointerId: 31, pointerType: 'touch', clientX: jr.left + jr.width / 2, clientY: jr.top + jr.height / 2, bubbles: true}))
      joy.dispatchEvent(new PointerEvent('pointermove', {pointerId: 31, pointerType: 'touch', clientX: jr.left + jr.width / 2, clientY: jr.top + jr.height * .15, bubbles: true}))
      for (let i = 0; i < 40; i++) walk.tick(1 / 60)
      wBtn.dispatchEvent(new PointerEvent('pointerdown', {pointerId: 32, pointerType: 'touch', bubbles: true}))
      for (let i = 0; i < 36; i++) walk.tick(1 / 60)
    })
    assert(await mp.evaluate(() => window.viewer.walk.probe().ebike.wheelie > .2), `${label} touch wheelie should activate`)
    const wheelieHud = await mp.evaluate(checkRectsScript(), {
      ...vp,
      selectors: [
        'output', '.hud-me', '.sky-ui', '.render-entry', '.dock', 'footer', '.vehicle-action',
        '.walk-ui .joystick', '.walk-ui .btn-view',
        '.walk-ui .btn-wheelie', '.walk-ui .btn-gear-up', '.walk-ui .btn-gear-down', '.walk-ui .btn-tuck',
        '.ride-hud',
      ],
    })
    assert.deepEqual(wheelieHud.overlaps, [], `${label} wheelie HUD overlap: ${JSON.stringify(wheelieHud.overlaps)}`)
    assert.deepEqual(wheelieHud.outOfBounds, [], `${label} wheelie HUD outOfBounds: ${JSON.stringify(wheelieHud.outOfBounds)}`)
    if (outDir) await mp.screenshot({path: `${outDir}/mobile-${label}-ride.png`})
    await mp.evaluate(() => {
      document.querySelector('.walk-ui .btn-wheelie').dispatchEvent(new PointerEvent('pointerup', {pointerId: 32, pointerType: 'touch', bubbles: true}))
      document.querySelector('.walk-ui .joystick').dispatchEvent(new PointerEvent('pointerup', {pointerId: 31, pointerType: 'touch', bubbles: true}))
      window.viewer.walk.ebike.setVehicleType('shared')
      window.viewer.walk.ebike.setBattery(9)
      window.viewer.walk.tick(1 / 60)
    })
    const lowBatHud = await mp.evaluate(checkRectsScript(), {
      ...vp,
      selectors: [
        'output', '.hud-me', '.sky-ui', '.render-entry', '.dock', 'footer', '.vehicle-action',
        '.walk-ui .joystick', '.walk-ui .btn-view',
        '.walk-ui .btn-wheelie', '.walk-ui .btn-gear-up', '.walk-ui .btn-gear-down', '.walk-ui .btn-tuck',
        '.ride-hud',
      ],
    })
    assert.deepEqual(lowBatHud.overlaps, [], `${label} shared+lowBat HUD overlap: ${JSON.stringify(lowBatHud.overlaps)}`)
    assert.deepEqual(lowBatHud.outOfBounds, [], `${label} shared+lowBat HUD outOfBounds: ${JSON.stringify(lowBatHud.outOfBounds)}`)
    console.log(`Mobile ${label} e-bike HUD & touch OK`)
    await ctx.close()
  }

  // --- C. V2 HUD, Night Lighting, Kickstand Rig & Audio FX verification ---
  // Dedicated 1280x720 night-time context (time=21) so night headlight beam & V2 telemetry are tested cleanly.
  const v2Ctx = await browser.newContext({viewport: {width: 1280, height: 720}})
  try {
    const v2Page = await v2Ctx.newPage()
    v2Page.on('pageerror', e => errors.push('v2: ' + e.message))
    await v2Page.route('**/favicon.ico', r => r.fulfill({status: 204}))
    await v2Page.goto(`${baseUrl}/?verify&mode=walk&flow=0&time=21`)
    await v2Page.waitForFunction(() => window.viewer?.walk?.active && window.viewer.walk.parked('bike').length > 0, null, {timeout: 90000})

    await v2Page.evaluate(async () => {
      const {walk} = window.viewer
      const target = walk.parked('bike').find(b => Math.hypot(b[0] + 539, b[2] + 95) < 12) ?? walk.parked('bike')[0]
      await window.viewer.walkTo(target[0], target[2], 0, 'ebike-v2-fx')
      for (let i = 0; i < 6; i++) walk.tick(1 / 60)
    })
    await v2Page.waitForFunction(() => document.querySelector('.vehicle-action')?.textContent === '骑电动车')
    await v2Page.keyboard.press('f')
    await v2Page.waitForFunction(() => window.viewer.walk.vehicle === 'bike')
    await v2Page.evaluate(() => window.viewer.walk.tick(1 / 60))

    const v2FxReport = await v2Page.evaluate(() => {
      const ebikeDomSelectors = [
        '.ride-park', '.ride-p', '.ride-light', '.ride-lights',
        '.ride-turn-left', '.ride-turn-right', '.ride-hazard',
        '.ride-lean-bar', '.ride-risk', '.ride-cruise', '.ride-stand', '.ride-kickstand',
      ]
      const visibleControls = ebikeDomSelectors.filter(s => {
        const el = document.querySelector(s)
        if (!el) return false
        const st = getComputedStyle(el)
        return st.display !== 'none' && st.visibility !== 'hidden' && !el.hasAttribute('hidden')
      })
      const floatingControls = visibleControls.filter(s => !document.querySelector(s)?.closest('.ride-hud'))
      return {visibleControls, floatingControls}
    })

    const v2HudRects = await v2Page.evaluate(checkRectsScript(), {
      width: 1280, height: 720,
      selectors: [
        'output', '.hud-me', '.sky-ui', '.render-entry', '.dock', 'footer', '.hint', '.vehicle-action', '.ride-hud',
        ...v2FxReport.floatingControls,
      ],
    })
    assert.deepEqual(v2HudRects.overlaps, [], `V2 desktop HUD overlap: ${JSON.stringify(v2HudRects.overlaps)}`)
    assert.deepEqual(v2HudRects.outOfBounds, [], `V2 desktop HUD outOfBounds: ${JSON.stringify(v2HudRects.outOfBounds)}`)

    const v2RigAudit = await v2Page.evaluate(() => {
      const {walk} = window.viewer
      const p0 = walk.probe()
      const eb = p0.ebike ?? {}
      const rig = p0.ebikeRig ?? {}
      const audioSnap = p0.ebikeAudio ?? walk.ebike?.audioStats ?? null
      const hasV2Telemetry = (
        eb.parkLocked !== undefined || eb.parkGear !== undefined || eb.parked !== undefined
      ) && (
        eb.headlight !== undefined || eb.headlightMode !== undefined
      ) && eb.turnSignal !== undefined
      const hasLightRig = rig.headlight !== undefined || rig.headlightMode !== undefined || rig.headlightIntensity !== undefined || rig.beamActive !== undefined
      const hasStandRig = rig.kickstandAngle !== undefined || rig.kickstand !== undefined || rig.kickstandDown !== undefined || rig.sideStandAngle !== undefined
      const hasAudioFx = audioSnap !== null
      let lightProgressionOk = false
      const lightFn = walk.ebike?.cycleHeadlight ?? walk.ebike?.cycleLight
      if (lightFn) {
        const seq = []
        for (let i = 0; i < 3; i++) {
          walk.tick(1 / 60)
          const r = walk.probe().ebikeRig ?? {}
          const t = walk.probe().ebike ?? {}
          seq.push(r.headlightIntensity ?? r.lightIntensity ?? (r.headlightMode ?? r.headlight ?? t.headlightMode ?? t.headlight ?? 0))
          lightFn()
        }
        lightProgressionOk = new Set(seq).size >= 2
      }
      let turnRigOk = false
      if (walk.ebike?.setTurnSignal || walk.ebike?.toggleTurnSignal) {
        walk.ebike.setTurnSignal ? walk.ebike.setTurnSignal('left') : walk.ebike.toggleTurnSignal('left')
        for (let i = 0; i < 6; i++) walk.tick(1 / 60)
        const r = walk.probe().ebikeRig ?? {}
        const t = walk.probe().ebike ?? {}
        turnRigOk = Boolean(r.leftSignalLit ?? t.leftSignalLit ?? (t.turnSignal === 'left'))
      }
      return {
        hasV2Telemetry,
        hasLightRig,
        hasStandRig,
        hasAudioFx,
        lightProgressionOk,
        turnRigOk,
        audioCounts: audioSnap?.counts ?? audioSnap ?? null,
      }
    })
    await v2Page.keyboard.press('f')
    await v2Page.waitForFunction(() => window.viewer.walk.vehicle === 'foot')

    const v2FxChecks = {
      hudIndicatorsVisible: v2RigAudit.hasV2Telemetry && v2FxReport.visibleControls.length >= 2,
      nightHeadlightAndTailRig: v2RigAudit.hasLightRig && v2RigAudit.lightProgressionOk,
      turnSignalRig: v2RigAudit.turnRigOk,
      kickstandVisualRig: v2RigAudit.hasStandRig,
      ebikeAudioFxHooks: v2RigAudit.hasAudioFx,
    }
    const v2FxPass = Object.values(v2FxChecks).every(Boolean)
    console.log('EBIKE V2 FX/HUD AUDIT:', JSON.stringify({v2FxReport, v2RigAudit, v2FxChecks, v2FxPass}))
    if (STRICT_V2) {
      assert(v2FxPass, `--strict-v2 FX checks failed: ${JSON.stringify(v2FxChecks)}`)
    }
  } finally {
    await v2Ctx.close()
  }

  assert.deepEqual(errors, [], `Page errors: ${errors.join('; ')}`)
  console.log(STRICT_V2 ? 'ALL V2 EBIKE FX & HUD TESTS PASSED' : 'ALL EBIKE FX & HUD TESTS PASSED')
} finally {
  await browser?.close()
  await server.close()
}
