import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {readFile, writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {applyCpuThrottle, browserOptions} from './qa-browser.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const baselinePath = resolve(import.meta.dirname, 'mission-layout-main.json')
const mainDist = process.env.RECORD_MAIN_LAYOUT_DIST
const baseline = mainDist ? {
  main: execFileSync('git', ['rev-parse', 'origin/main'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  note: '待 UI 分支修复', measurements: {},
} : JSON.parse(await readFile(baselinePath, 'utf8'))

function checkOverlaps(viewport, state, overlaps) {
  const key = `${viewport.width}x${viewport.height}:${state}`
  if (mainDist) {
    baseline.measurements[key] = overlaps.map(({a, b, area}) => ({a, b, area}))
    return
  }
  const limits = baseline.measurements[key]
  assert.ok(limits, `Missing main measurement for ${key}`)
  const regressions = overlaps.filter(({a, b, area}) => !limits.some(limit =>
    limit.a === a && limit.b === b && area <= limit.area))
  assert.deepEqual(regressions, [], `${key} overlap regression against ${baseline.main}: ${JSON.stringify(regressions)}`)
}

function inspectHudLayoutScript() {
  return ({width, height, fullHud = false}) => {
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
      '.hud-dev',
      '.minimap',
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
    if (fullHud) for (const [index, first] of otherBoxes.entries()) {
      const left = document.querySelector(first.sel)
      for (const second of otherBoxes.slice(index + 1)) {
        const right = document.querySelector(second.sel)
        if (left.contains(right) || right.contains(left)) continue
        const width = Math.min(first.right, second.right) - Math.max(first.left, second.left)
        const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)
        if (width > 0 && height > 0) overlaps.push({a:first.sel,b:second.sel,area:+(width*height).toFixed(1)})
      }
    }
    const outOfBounds = activeMissionBoxes.filter(
      b => b.left < -0.5 || b.top < -0.5 || b.right > width + 0.5 || b.bottom > height + 0.5,
    )
  return {activeMissionBoxes, otherBoxes, overlaps, outOfBounds}
  }
}

async function measureVehicles(page, viewport, mission) {
  const fixtures = [
    ['foot', -588, -212, ''], ['bike', -539, -95, '骑电动车'],
    ['bicycle', 585, 1384, '骑单车'], ['car', -572, -92, '开车'],
    ['boat', -1340, 326, '划小船'],
  ]
  for (const [kind, east, south, label] of fixtures) {
    const landed = await page.evaluate(async ([kind, east, south]) => {
      const {walk, walkTo} = window.viewer
      if (kind !== 'foot' && kind !== 'boat') {
        const nearest = walk.parked(kind).sort((left,right) =>
          Math.hypot(left[0]-east,left[2]-south)-Math.hypot(right[0]-east,right[2]-south))[0]
        if (!nearest) return false
        ;[east,,south] = nearest
      }
      return walkTo(east,south,0,'layout-fixture')
    }, [kind,east,south])
    assert(landed, `no ${kind} fixture`)
    if (label) {
      await page.evaluate(() => document.querySelector('.spot-card.show .card-close')?.click())
      await page.waitForFunction(label => document.querySelector('.vehicle-action:not([hidden])')?.textContent.includes(label), label)
      await page.keyboard.press('f')
    }
    await page.waitForFunction(kind => window.viewer.walk.vehicle===kind, kind)
    await page.waitForFunction(mission => (window.viewer.game.getState().mission?.id ?? 'idle')===mission,mission)
    await page.evaluate(async () => {for (let index=0;index<3;index++) await new Promise(requestAnimationFrame)})
    const layout = await page.evaluate(inspectHudLayoutScript(), {...viewport,fullHud:true})
    checkOverlaps(viewport, `${mission}:${kind}`, layout.overlaps)
  }
}

async function waitForWalkReady(page) {
  let lastProgress, lastChange = performance.now()
  const deadline = lastChange + 240000
  while (performance.now() < deadline) {
    const state = await page.evaluate(() => {
      const viewer = window.viewer
      return {walking: Boolean(viewer?.walk?.active), game: Boolean(viewer?.game), tour: Boolean(viewer?.tour?.goTo),
        loaded: viewer?.stats?.loaded ?? 0, loading: window.__loading}
    })
    if (state.walking && state.game && state.tour && state.loaded >= 6) return
    const progress = JSON.stringify(state)
    if (progress !== lastProgress) {lastChange = performance.now(); lastProgress = progress}
    if (performance.now() - lastChange > 90000) break
    await page.waitForTimeout(500)
  }
  throw Error(`Mission walk startup stalled or exceeded 240s: ${lastProgress}`)
}

async function verifyViewportLayout(browser, baseUrl, label, viewport, hasTouch) {
  const ctx = await browser.newContext({viewport, hasTouch, isMobile: hasTouch})
  await ctx.route('**/api/t', route => route.fulfill({status:204}))
  const page = await ctx.newPage()
  await applyCpuThrottle(page)
  const errors = []
  page.on('pageerror', err => errors.push(`pageerror(${label}): ${err.message}`))
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`console.error(${label}): ${msg.text()}`)
  })
  await page.route('**/favicon.ico', r => r.fulfill({status: 204}))
  await page.goto(`${baseUrl}/?verify&solo=1&mode=walk&flow=0`)
  await waitForWalkReady(page)
  await page.waitForTimeout(300)

  const idleLayout = await page.evaluate(inspectHudLayoutScript(), viewport)
  checkOverlaps(viewport, 'idle', idleLayout.overlaps)
  assert.equal(idleLayout.outOfBounds.length, 0, `${label} idle HUD OOB: ${JSON.stringify(idleLayout.outOfBounds)}`)
  assert.ok(idleLayout.activeMissionBoxes.some(b => b.sel === '.gl-mission-entry'), `${label} .gl-mission-entry must be visible`)

  await measureVehicles(page, viewport, 'idle')
  await page.evaluate(() => window.viewer.walkTo(-588,-212,0,'layout-mission'))

  await page.evaluate(() => {
    window.viewer.game.missions.start('noodle-01')
  })
  await page.waitForFunction(() => Boolean(document.querySelector('.gl-mission-hud:not([hidden]) .st-meter:not([hidden])')))
  await page.waitForTimeout(150)

  const activeLayout = await page.evaluate(inspectHudLayoutScript(), viewport)
  checkOverlaps(viewport, 'noodle-01', activeLayout.overlaps)
  assert.equal(activeLayout.outOfBounds.length, 0, `${label} active HUD OOB: ${JSON.stringify(activeLayout.outOfBounds)}`)
  assert.ok(activeLayout.activeMissionBoxes.some(b => b.sel === '.gl-mission-hud'), `${label} .gl-mission-hud must be visible`)
  await measureVehicles(page, viewport, 'noodle-01')

  assert.deepEqual(errors, [], `${label} errors: ${errors.join('; ')}`)
  await ctx.close()
}

const server = await preview({
  ...((mainDist || process.env.QA_DIST) && {build: {outDir: resolve(mainDist || process.env.QA_DIST)}}),
  root: resolve(ROOT, 'web'),
  configFile: resolve(ROOT, 'web/vite.config.ts'),
  preview: {host: '127.0.0.1', port: 0},
})
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
let browser

try {
  browser = await chromium.launch(browserOptions(true))
  if (mainDist) {
    const version = await (await fetch(`${baseUrl}/version.json`)).json()
    assert.equal(version.sha, baseline.main, 'Refusing to record non-main dist')
  } else await verifyDesktopGameplay()

  async function verifyDesktopGameplay() {
  const errors = []

  // -------------------------------------------------------------------------
  // A. Desktop E2E Gameplay Loop, Persistence, Soup/Freeze, Quiet & Spots
  // -------------------------------------------------------------------------
  const ctx = await browser.newContext({viewport: {width: 1280, height: 720}})
  await ctx.route('**/api/t', route => route.fulfill({status:204}))
  const page = await ctx.newPage()
  await applyCpuThrottle(page)
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`))
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()} (${msg.location().url})`)
  })
  await page.route('**/favicon.ico', r => r.fulfill({status: 204}))
  await page.goto(`${baseUrl}/?verify&solo=1&mode=walk&flow=0`)
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
    orderIds: [...document.querySelectorAll('dialog.mission-board [data-start]')].map(button => button.dataset.start),
  }))
  for (const [line, count] of [['errand', 2], ['noodle', 3], ['taxi', 3], ['race', 3]]) {
    for (let order = 1; order <= count; order++) {
      assert.ok(posBeforeKeys.orderIds.includes(`${line}-0${order}`), `missing ${line} order ${order}`)
    }
  }
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
  const atGiver = await page.evaluate(() => window.viewer.game.getState())
  assert.equal(atGiver.mode, 'foot')
  assert.equal(atGiver.zone.quiet, false)
  assert.equal(atGiver.zone.carFree, true)
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
    mode: window.viewer.game.getState().mode,
    money: window.viewer.game.getState().money,
    missionsDone: window.viewer.game.getState().missionsDone,
    beacon: window.viewer.game.missions.beaconVisible(),
  }))
  assert.equal(afterErrand.mode, 'foot')
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
    const list = window.viewer.walk.parked('bike')
    if (!list.length) return null
    list.sort((a, b) => Math.hypot(a[0] + 539, a[2] + 95) - Math.hypot(b[0] + 539, b[2] + 95))
    return list[0]
  })
  assert.ok(parkedBike, 'expected parked shared ebike nearby to test real crash state machine')
  assert(await page.evaluate(b => window.viewer.walkTo(b[0], b[2], 0, 'e2e-mount-bike'), parkedBike))
  await page.waitForFunction(() => document.querySelector('.vehicle-action')?.dataset.interactAction === 'mount_vehicle', null, {timeout:8000})
  await page.keyboard.press('KeyF')
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike' && window.viewer.walk.ebike.state !== null, null, {timeout: 8000})

  const crashSoupCheck = await page.evaluate(async () => {
    const runFrames = async n => {
      for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(r))
    }
    window.viewer.walk.ebike.triggerCrash('lowside', 1)
    await runFrames(20)
    const flow=window.viewer.walk.probe().twoWheelFlow
    const soupAfterCrashFrames = window.viewer.game.missions.status().soup
    window.viewer.walk.ebike.recover()
    await runFrames(20)
    const soupDuringRecover = window.viewer.game.missions.status().soup
    return {soupAfterCrashFrames, soupDuringRecover,flow}
  })
  assert.equal(crashSoupCheck.flow, 'crashed', 'the mounted rider must enter the crash state')
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
    const {game,walk}=window.viewer,events=[]
    const off=game.onEvent(event=>events.push(event))
    const arrived=await window.viewer.walkTo(duxiu.x,duxiu.z,0,'e2e-walk-to-stamp')
    await new Promise(r => setTimeout(r, 300))
    const moneyAfterSpot = window.viewer.game.getState().money
    off()
    const diagnostic={arrived,landing:walk.spawns.at(-1),events,ledger:game.save.getSnapshot().economy.txHistoryRing}
    const secondTry = window.viewer.game.commerce.claimSpotBounty('duxiu')
    return {libinId: libin?.id, guilinId: guilin?.id, moneyAfterSpot, secondCode: secondTry.code,diagnostic}
  })
  console.log('独秀峰首次打卡',JSON.stringify(quietAndSpotCheck))
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
  }

  // -------------------------------------------------------------------------
  // B. Zero-Overlap Multi-Viewport HUD Layout Audit
  // -------------------------------------------------------------------------
  await verifyViewportLayout(browser, baseUrl, 'desktop-1280x720', {width: 1280, height: 720}, false)
  await verifyViewportLayout(browser, baseUrl, 'mobile-portrait-390x844', {width: 390, height: 844}, true)
  await verifyViewportLayout(browser, baseUrl, 'mobile-landscape-844x390', {width: 844, height: 390}, true)

  if (mainDist) await writeFile(baselinePath, JSON.stringify(baseline, null, 2) + '\n')
  else console.log('ALL HEADLESS MISSION & ECONOMY E2E VERIFICATIONS PASSED')
} finally {
  await browser?.close()
  server.httpServer.close()
}
