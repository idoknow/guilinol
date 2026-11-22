import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const ROOT = resolve(import.meta.dirname, '..')

function inspectHudLayoutScript() {
  return ({width, height}) => {
    const missionSelectors = ['.gl-mission-entry', '.gl-mission-hud']
    const hudSelectors = [
      '.hud-me',
      '.sky-ui',
      '.btn-menu',
      '.account-entry',
      '.render-entry',
      '.dock',
      '.btn-mode',
      '.walk-ui .joystick',
      '.walk-ui .btn-run',
      '.walk-ui .btn-crouch',
      '.walk-ui .btn-jump',
      '.walk-ui .btn-view',
      '.walk-ui .btn-wheelie',
      '.walk-ui .btn-gear-up',
      '.walk-ui .btn-gear-down',
      '.walk-ui .btn-tuck',
      '.ride-hud',
      '.vehicle-action',
      'output',
      '.hint',
      'footer',
    ]
    const measure = sel => {
      const el = document.querySelector(sel)
      if (!el) return null
      const st = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const hidden =
        st.display === 'none' ||
        st.visibility === 'hidden' ||
        el.hasAttribute('hidden') ||
        r.width < 1 ||
        r.height < 1
      if (hidden) return null
      return {
        sel,
        left: +r.left.toFixed(1),
        top: +r.top.toFixed(1),
        right: +r.right.toFixed(1),
        bottom: +r.bottom.toFixed(1),
      }
    }

    const activeMissionBoxes = missionSelectors.map(measure).filter(Boolean)
    const otherBoxes = hudSelectors.map(measure).filter(Boolean)
    const overlaps = []
    for (const a of activeMissionBoxes) {
      for (const b of otherBoxes) {
        const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        const oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
        if (ox * oy > 0) overlaps.push({a: a.sel, b: b.sel, area: +(ox * oy).toFixed(1), boxA: a, boxB: b})
      }
    }
    const outOfBounds = activeMissionBoxes.filter(
      b => b.left < -0.5 || b.top < -0.5 || b.right > width + 0.5 || b.bottom > height + 0.5,
    )
    return {activeMissionBoxes, otherBoxes, overlaps, outOfBounds}
  }
}

async function waitForWalkReady(page) {
  await page.waitForFunction(
    () => Boolean(window.viewer?.walk?.active && window.viewer?.game && window.viewer?.tour?.goTo && window.viewer?.stats?.loaded >= 6),
    null,
    {timeout: 90000},
  )
}

async function verifyViewportLayout(browser, baseUrl, label, viewport, hasTouch) {
  const ctx = await browser.newContext({viewport, hasTouch, isMobile: hasTouch})
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', err => errors.push(`pageerror(${label}): ${err.message}`))
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`console.error(${label}): ${msg.text()}`)
  })
  await page.route('**/favicon.ico', r => r.fulfill({status: 204}))
  await page.goto(`${baseUrl}/?verify&story=1&mode=walk&flow=0`)
  await waitForWalkReady(page)
  await page.waitForTimeout(300)

  const idleLayout = await page.evaluate(inspectHudLayoutScript(), viewport)
  assert.equal(idleLayout.overlaps.length, 0, `${label} idle HUD overlaps: ${JSON.stringify(idleLayout.overlaps)}`)
  assert.equal(idleLayout.outOfBounds.length, 0, `${label} idle HUD OOB: ${JSON.stringify(idleLayout.outOfBounds)}`)
  assert.ok(idleLayout.activeMissionBoxes.some(b => b.sel === '.gl-mission-entry'), `${label} .gl-mission-entry must be visible`)

  await page.evaluate(() => {
    window.viewer.game.missions.start('noodle-01')
  })
  await page.waitForFunction(() => Boolean(document.querySelector('.gl-mission-hud:not([hidden]) .st-meter:not([hidden])')))
  await page.waitForTimeout(150)

  const activeLayout = await page.evaluate(inspectHudLayoutScript(), viewport)
  assert.equal(activeLayout.overlaps.length, 0, `${label} active HUD overlaps: ${JSON.stringify(activeLayout.overlaps)}`)
  assert.equal(activeLayout.outOfBounds.length, 0, `${label} active HUD OOB: ${JSON.stringify(activeLayout.outOfBounds)}`)
  assert.ok(activeLayout.activeMissionBoxes.some(b => b.sel === '.gl-mission-hud'), `${label} .gl-mission-hud must be visible`)

  assert.deepEqual(errors, [], `${label} errors: ${errors.join('; ')}`)
  await ctx.close()
}

const server = await preview({
  root: resolve(ROOT, 'web'),
  configFile: resolve(ROOT, 'web/vite.config.ts'),
  preview: {host: '127.0.0.1', port: 0},
})
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
let browser

try {
  browser = await chromium.launch(browserOptions(true))
  const errors = []

  // -------------------------------------------------------------------------
  // A. Desktop E2E Gameplay Loop, Persistence, Soup/Freeze, Quiet & Spots
  // -------------------------------------------------------------------------
  const ctx = await browser.newContext({viewport: {width: 1280, height: 720}})
  const page = await ctx.newPage()
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`))
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
  })
  await page.route('**/favicon.ico', r => r.fulfill({status: 204}))
  await page.goto(`${baseUrl}/?verify&story=1&mode=walk&flow=0`)
  await waitForWalkReady(page)

  // 1. Fresh save starts with ¥200
  const initCheck = await page.evaluate(() => {
    window.viewer.game.save.reset(200)
    const raw = JSON.parse(localStorage.getItem('glol.save.v1') || '{}')
    return {
      money: window.viewer.game.getState().money,
      saveMoney: raw.money,
      entryText: document.querySelector('.gl-mission-entry')?.textContent,
    }
  })
  assert.equal(initCheck.money, 200)
  assert.equal(initCheck.saveMoney, 200)
  assert.ok(initCheck.entryText?.includes('200'), `expected ¥200 on entry badge, got ${initCheck.entryText}`)

  // 2. Open Mission Board dialog & verify input-guard shields WASD movement
  await page.click('.gl-mission-entry')
  await page.waitForFunction(() => document.querySelector('dialog.mission-board[open]') !== null)
  const posBeforeKeys = await page.evaluate(() => ({
    x: window.viewer.walk.position.x,
    z: window.viewer.walk.position.z,
    cardCount: document.querySelectorAll('dialog.mission-board .mb-card').length,
  }))
  assert.equal(posBeforeKeys.cardCount, 5, 'mission board must list all 5 missions')
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(250)
  await page.keyboard.up('KeyW')
  const posAfterKeys = await page.evaluate(() => ({
    x: window.viewer.walk.position.x,
    z: window.viewer.walk.position.z,
  }))
  assert.ok(
    Math.hypot(posAfterKeys.x - posBeforeKeys.x, posAfterKeys.z - posBeforeKeys.z) < 0.05,
    'dialog[open] must block WASD movement via input-guard',
  )

  // 3. Accept errand-01 from board UI, verify 3D beacon & complete both steps -> ¥380
  await page.click('dialog.mission-board button[data-start="errand-01"]')
  await page.waitForFunction(() => {
    const s = window.viewer.game.getState()
    return s.mission?.id === 'errand-01' && window.viewer.game.missions.beaconVisible() === true
  })

  await page.evaluate(async () => {
    const target1 = window.viewer.game.getState().mission.target
    await window.viewer.walkTo(target1[0], target1[1], 0, 'e2e-errand1-step1')
  })
  await page.waitForFunction(() => window.viewer.game.getState().mission?.stepIndex === 1, null, {timeout: 15000})

  await page.evaluate(async () => {
    const target2 = window.viewer.game.getState().mission.target
    await window.viewer.walkTo(target2[0], target2[1], 0, 'e2e-errand1-step2')
  })
  await page.waitForFunction(() => window.viewer.game.getState().mission === null, null, {timeout: 15000})

  const afterErrand = await page.evaluate(() => ({
    money: window.viewer.game.getState().money,
    missionsDone: window.viewer.game.getState().missionsDone,
    beacon: window.viewer.game.missions.beaconVisible(),
  }))
  assert.equal(afterErrand.money, 380)
  assert.ok(afterErrand.missionsDone.includes('errand-01'))
  assert.equal(afterErrand.beacon, false, 'beacon must hide after mission completion')

  // 4. Reload persistence check
  await page.reload()
  await waitForWalkReady(page)
  const afterReload = await page.evaluate(() => ({
    money: window.viewer.game.getState().money,
    missionsDone: window.viewer.game.getState().missionsDone,
  }))
  assert.equal(afterReload.money, 380, 'money must persist across page reload')
  assert.ok(afterReload.missionsDone.includes('errand-01'))

  // 5. Accept noodle-01 -> pickup -> test activeShop timer freeze -> test abandon cleanup & re-accept
  const startNoodle = await page.evaluate(() => window.viewer.game.missions.start('noodle-01'))
  assert.equal(startNoodle.ok, true)
  await page.waitForFunction(() => Boolean(document.querySelector('.gl-mission-hud:not([hidden]) .st-meter:not([hidden])')))
  await page.evaluate(async () => {
    const t = window.viewer.game.getState().mission.target
    await window.viewer.walkTo(t[0], t[1], 0, 'e2e-noodle1-pickup')
  })
  await page.waitForFunction(() => window.viewer.game.getState().mission?.stepIndex === 1, null, {timeout: 15000})

  const freezeCheck = await page.evaluate(() => {
    window.viewer.game.save.setActiveShop({shopId: 'shop_nikoniko_apparel', kind: 'clothing', openedAt: Date.now()})
    window.viewer.game.missions.advanceTimerForTest(0.1)
    const tBefore = window.viewer.game.missions.status().timerRemaining
    window.viewer.game.missions.advanceTimerForTest(12)
    const tAfter = window.viewer.game.missions.status().timerRemaining
    const textFrozen = document.querySelector('.gl-mission-hud .st-timer')?.textContent ?? ''
    window.viewer.game.save.setActiveShop(null)
    return {tBefore, tAfter, textFrozen}
  })
  assert.equal(freezeCheck.tAfter, freezeCheck.tBefore, 'activeShop open must freeze mission timer')
  assert.ok(freezeCheck.textFrozen.includes('暂停'), `timer HUD should show 暂停, got ${freezeCheck.textFrozen}`)

  // Test abandon single-exit cleanup -> beacon & HUD hidden -> clean re-accept
  const abandonCheck = await page.evaluate(() => {
    const ab = window.viewer.game.missions.abandon()
    return {
      ab,
      mission: window.viewer.game.getState().mission,
      beacon: window.viewer.game.missions.beaconVisible(),
      hudHidden: document.querySelector('.gl-mission-hud')?.hasAttribute('hidden'),
      reaccepted: window.viewer.game.missions.start('noodle-01').ok,
    }
  })
  assert.equal(abandonCheck.ab, true)
  assert.equal(abandonCheck.mission, null)
  assert.equal(abandonCheck.beacon, false)
  assert.equal(abandonCheck.hudHidden, true)
  assert.equal(abandonCheck.reaccepted, true)

  // 6. Real mounted two-wheeler crash test: ensure crash triggers single -25% penalty, NO per-frame drain
  const parkedBike = await page.evaluate(() => {
    const p = window.viewer.walk.position
    const list = window.viewer.walk.parked('bike')
    if (!list.length) return null
    list.sort((a, b) => Math.hypot(a[0] - p.x, a[2] - p.z) - Math.hypot(b[0] - p.x, b[2] - p.z))
    return list[0]
  })
  assert.ok(parkedBike, 'expected parked shared ebike nearby to test real crash state machine')
  await page.evaluate(async b => {
    await window.viewer.walkTo(b[0] + 1.2, b[2], 0, 'e2e-mount-bike')
  }, parkedBike)
  await page.waitForTimeout(150)
  await page.keyboard.press('KeyF')
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike', null, {timeout: 8000})

  const crashSoupCheck = await page.evaluate(async () => {
    const runFrames = async n => {
      for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(r))
    }
    window.viewer.walk.ebike.triggerCrash('lowside', 1)
    await runFrames(20)
    const soupAfterCrashFrames = window.viewer.game.missions.status().soup
    window.viewer.walk.ebike.recover()
    await runFrames(20)
    const soupDuringRecover = window.viewer.game.missions.status().soup
    return {soupAfterCrashFrames, soupDuringRecover}
  })
  assert.equal(crashSoupCheck.soupAfterCrashFrames, 0.75, 'crash must deduct exactly ONE -25% (not per-frame drain)')
  assert.equal(crashSoupCheck.soupDuringRecover, 0.75, 'standup recovery frames must NOT deduct extra soup')

  // Dismount if still nearby or abandon -> deliver noodle-01 cleanly -> buy T1 outfit -> repeat scaling
  await page.evaluate(async () => {
    // Re-pick noodle-01 fresh and walk step 0 & 1 so we earn full ¥300 (¥380 + ¥300 = ¥680)
    window.viewer.game.missions.abandon()
    window.viewer.game.missions.start('noodle-01')
    const s0 = window.viewer.game.getState().mission.target
    await window.viewer.walkTo(s0[0], s0[1], 0, 'e2e-n1-s0')
  })
  await page.waitForFunction(() => window.viewer.game.getState().mission?.stepIndex === 1, null, {timeout: 15000})
  await page.evaluate(async () => {
    const s1 = window.viewer.game.getState().mission.target
    await window.viewer.walkTo(s1[0], s1[1], 0, 'e2e-n1-s1')
  })
  await page.waitForFunction(() => window.viewer.game.getState().mission === null, null, {timeout: 15000})

  const outfitAndRepeatCheck = await page.evaluate(() => {
    const moneyAfterN1 = window.viewer.game.getState().money
    const buyRes = window.viewer.game.commerce.executePurchase({
      shopId: 'shop_nikoniko_apparel',
      itemType: 'outfit_preset',
      itemId: 'outfit_guilin_hoodie',
      expectedPrice: 480,
      idempotencyKey: 'e2e_buy_t1_1',
    })
    return {moneyAfterN1, buyRes, equippedTop: window.viewer.game.getState().wardrobe.equipped.top}
  })
  assert.equal(outfitAndRepeatCheck.moneyAfterN1, 680)
  assert.equal(outfitAndRepeatCheck.buyRes.ok, true)
  assert.equal(outfitAndRepeatCheck.buyRes.balanceAfter, 200)
  assert.equal(outfitAndRepeatCheck.equippedTop, 'top_guilin_hoodie')

  // Repeat noodle-01 verifying payout scales down from ¥300 to ¥180 (¥140 + ¥40)
  await page.evaluate(async () => {
    window.viewer.game.missions.start('noodle-01')
    const s0 = window.viewer.game.getState().mission.target
    await window.viewer.walkTo(s0[0], s0[1], 0, 'e2e-n1-rep-s0')
  })
  await page.waitForFunction(() => window.viewer.game.getState().mission?.stepIndex === 1, null, {timeout: 15000})
  await page.evaluate(async () => {
    const s1 = window.viewer.game.getState().mission.target
    await window.viewer.walkTo(s1[0], s1[1], 0, 'e2e-n1-rep-s1')
  })
  await page.waitForFunction(() => window.viewer.game.getState().mission === null, null, {timeout: 15000})
  const afterRepeat = await page.evaluate(() => window.viewer.game.getState().money)
  assert.equal(afterRepeat, 380, 'repeat full-soup noodle-01 must pay ¥180 (200 -> 380), not ¥300')

  // 7. Quiet zone runtime checks (libin_middle, guilin_middle, plus Spot ¥120 idempotency)
  const quietAndSpotCheck = await page.evaluate(async () => {
    const libin = window.viewer.game.quiet.findQuietZoneAt(-541, 76)
    const guilin = window.viewer.game.quiet.findQuietZoneAt(-1231, -370)
    // Teleport onto a known walkable spot (duxiu) to verify ¥120 spot bounty + reload idempotency
    const duxiu = window.viewer.tour.spots.find(s => s.id === 'duxiu')
    await window.viewer.tour.goTo(duxiu)
    await new Promise(r => setTimeout(r, 300))
    const moneyAfterSpot = window.viewer.game.getState().money
    const secondTry = window.viewer.game.commerce.claimSpotBounty('duxiu')
    return {libinId: libin?.id, guilinId: guilin?.id, moneyAfterSpot, secondCode: secondTry.code}
  })
  assert.equal(quietAndSpotCheck.libinId, 'libin_middle')
  assert.equal(quietAndSpotCheck.guilinId, 'guilin_middle')
  assert.equal(quietAndSpotCheck.moneyAfterSpot, 500, '380 + 120 duxiu spot bounty = 500')
  assert.equal(quietAndSpotCheck.secondCode, 'ALREADY_CLAIMED')

  await page.reload()
  await waitForWalkReady(page)
  const moneyPostSpotReload = await page.evaluate(() => window.viewer.game.getState().money)
  assert.equal(moneyPostSpotReload, 500, 'spot bounty must stay at 500 without re-paying after reload')

  assert.deepEqual(errors, [], `desktop E2E errors: ${errors.join('; ')}`)
  await ctx.close()

  // -------------------------------------------------------------------------
  // B. Zero-Overlap Multi-Viewport HUD Layout Audit
  // -------------------------------------------------------------------------
  await verifyViewportLayout(browser, baseUrl, 'desktop-1280x720', {width: 1280, height: 720}, false)
  await verifyViewportLayout(browser, baseUrl, 'mobile-portrait-390x844', {width: 390, height: 844}, true)
  await verifyViewportLayout(browser, baseUrl, 'mobile-landscape-844x390', {width: 844, height: 390}, true)

  console.log('ALL HEADLESS MISSION & ECONOMY E2E VERIFICATIONS PASSED')
} finally {
  await browser?.close()
  server.httpServer.close()
}
