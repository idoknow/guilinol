import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const outDir = process.env.EBIKE_SHOT_DIR
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
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM,
    args: process.platform === 'darwin'
      ? ['--enable-gpu', '--use-angle=metal']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
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

  // Gear shifts & Ghostfire mod toggle
  await page.keyboard.press('e')
  await page.evaluate(() => window.viewer.walk.tick(1 / 60))
  assert.equal(await page.textContent('.ride-gear'), 'D3')
  await page.keyboard.press('e')
  await page.evaluate(() => window.viewer.walk.tick(1 / 60))
  assert.equal(await page.textContent('.ride-gear'), 'S')
  await page.keyboard.press('q')
  await page.evaluate(() => window.viewer.walk.tick(1 / 60))
  assert.equal(await page.textContent('.ride-gear'), 'D3')

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
      walk.face(walk.heading - .95, .18)
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
    selectors: ['output', '.sky-ui', '.dock', '.btn-about', 'footer', '.hint', '.vehicle-action', '.ride-hud'],
  })
  assert.deepEqual(deskHud.overlaps, [], `desktop ride HUD overlap: ${JSON.stringify(deskHud.overlaps)}`)
  assert.deepEqual(deskHud.outOfBounds, [], `desktop ride HUD outOfBounds: ${JSON.stringify(deskHud.outOfBounds)}`)

  // Crash separation & recovery lift
  const crashRes = await page.evaluate(() => {
    const {walk} = window.viewer
    walk.ebike.triggerCrash('lowside', 1)
    for (let i = 0; i < 36; i++) walk.tick(1 / 60)
    const crashed = walk.probe()
    const sepDist = Math.hypot(crashed.figPos[0] - crashed.ebikeRig.seatWorld[0], crashed.figPos[2] - crashed.ebikeRig.seatWorld[2])
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Space'}))
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Space'}))
    for (let i = 0; i < 60; i++) walk.tick(1 / 60)
    const recovered = walk.probe()
    return {crashed, sepDist, recovered}
  })
  assert.equal(crashRes.crashed.ebike.crashPhase, 'crashed')
  assert(Math.abs(crashRes.crashed.ebikeRig.crashRoll) > 1.0, 'crashed e-bike should lie on side')
  assert(crashRes.sepDist > .45, `rider should separate from crashed bike: sepDist=${crashRes.sepDist}`)
  assert.equal(crashRes.recovered.ebike.crashPhase, 'none')
  assert.equal(Math.abs(crashRes.recovered.ebikeRig.crashRoll), 0)

  if (outDir) {
    await page.evaluate(() => {
      const {walk} = window.viewer
      walk.ebike.triggerCrash('impact', -1)
      for (let i = 0; i < 30; i++) walk.tick(1 / 60)
    })
    await page.screenshot({path: `${outDir}/desktop-crash.png`})
    await page.evaluate(() => {
      const {walk} = window.viewer
      walk.ebike.recover()
      for (let i = 0; i < 60; i++) walk.tick(1 / 60)
    })
  }

  // Dismount restores foot state & clears ride HUD
  await page.keyboard.press('f')
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'foot')
  assert.equal(await page.evaluate(() => document.body.dataset.ride ?? ''), '')
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.ride-hud')).display), 'none')
  console.log('Desktop e-bike FX & crash/recover OK', {
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
        'output', '.sky-ui', '.dock', '.btn-about', 'footer', '.vehicle-action',
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
    if (outDir) await mp.screenshot({path: `${outDir}/mobile-${label}-ride.png`})
    await mp.evaluate(() => {
      document.querySelector('.walk-ui .btn-wheelie').dispatchEvent(new PointerEvent('pointerup', {pointerId: 32, pointerType: 'touch', bubbles: true}))
      document.querySelector('.walk-ui .joystick').dispatchEvent(new PointerEvent('pointerup', {pointerId: 31, pointerType: 'touch', bubbles: true}))
    })
    console.log(`Mobile ${label} e-bike HUD & touch OK`)
    await ctx.close()
  }

  assert.deepEqual(errors, [], `Page errors: ${errors.join('; ')}`)
  console.log('ALL EBIKE FX & HUD TESTS PASSED')
} finally {
  await browser?.close()
  await server.close()
}
