#!/usr/bin/env node
import assert from 'node:assert/strict'
import {mkdir, readFile} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const OUT_DIR = process.env.STUNT_SHOT_DIR ?? 'captures/ride-stunt'
await mkdir(OUT_DIR, {recursive: true})

const vehiclesData = JSON.parse(gunzipSync(await readFile('dist/world/vehicles.bin')))
const bikeCounts = {
  bikes: vehiclesData.bikes?.length ?? 0,
  normal: (vehiclesData.bikes ?? []).filter(b => (((b[4] % 4) + 4) % 4) !== 1).length,
  shared: (vehiclesData.bikes ?? []).filter(b => (((b[4] % 4) + 4) % 4) === 1).length + (vehiclesData.sharedBikes?.length ?? 0),
  bicycles: vehiclesData.bicycles?.length ?? 0,
  cars: vehiclesData.cars?.length ?? 0,
}
console.log('vehicles.bin counts:', JSON.stringify(bikeCounts))
assert(bikeCounts.normal > 0 && bikeCounts.shared > 0, 'vehicles.bin must contain both normal and shared bikes')

const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
const errors = []
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

async function closeCard(page) {
  await page.evaluate(() => document.querySelector('.spot-card.show .card-close')?.click())
}

async function waitWalkReady(page, extraCheck = null) {
  await page.waitForFunction(() => window.viewer?.walk?.active && window.viewer.walk.parked('bike').length > 0, null, {timeout: 90000})
  if (extraCheck) await page.waitForFunction(extraCheck, null, {timeout: 90000})
}

async function walkNearBike(page, tx, tz, reason = 'stunt-bike', normalOnly = false) {
  const picked = await page.evaluate(async ([x, z, r, onlyNormal]) => {
    const {walk} = window.viewer
    const candidates = walk.parked('bike').slice().sort((a, b) => Math.hypot(a[0] - x, a[2] - z) - Math.hypot(b[0] - x, b[2] - z))
    const limit = onlyNormal ? Math.min(6, candidates.length) : Math.min(1, candidates.length)
    for (let i = 0; i < limit; i++) {
      const target = candidates[i]
      await window.viewer.walkTo(target[0], target[2], 0, r)
      for (let t = 0; t < 6; t++) walk.tick(1 / 60)
      if (!onlyNormal || walk.shop?.getInteractDecision?.()?.ebikeTier === 'normal') {
        return target
      }
    }
    return candidates[0] ?? null
  }, [tx, tz, reason, normalOnly])
  assert(picked, `no parked bike found near ${tx},${tz}`)
  return picked
}

async function interactF(page, expectedText) {
  await closeCard(page)
  try {
    await page.waitForFunction(t => {
      const btn = document.querySelector('.vehicle-action')
      return !!btn && !btn.hasAttribute('hidden') && (btn.textContent ?? '').includes(t)
    }, expectedText, {timeout: 15000})
  } catch (err) {
    const diag = await page.evaluate(() => {
      const btn = document.querySelector('.vehicle-action')
      return {
        btnText: btn?.textContent ?? null,
        btnHidden: btn?.hasAttribute('hidden') ?? null,
        probe: window.viewer?.walk?.probe?.() ?? null,
      }
    }).catch(() => null)
    throw new Error(`interactF("${expectedText}") timeout: ${err.message} | diag=${JSON.stringify(diag)}`)
  }
  await page.keyboard.press('f')
  await page.evaluate(() => window.viewer.walk.tick(1 / 60))
}

async function unlockAndShift(page, gear) {
  await page.evaluate(g => {
    const {walk} = window.viewer
    walk.ebike.setPark(false, true)
    walk.ebike.setKickstand(false, true)
    walk.ebike.setGear(g)
    walk.tick(1 / 60)
  }, gear)
}

async function recoverCrashToRemount(page) {
  const standRes = await page.evaluate(() => {
    const {walk} = window.viewer
    if (walk.probe().twoWheelFlow === 'crashed') {
      for (let i = 0; i < 20; i++) walk.tick(1 / 60)
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Space'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Space'}))
    }
    for (let i = 0; i < 70; i++) {
      walk.tick(1 / 60)
      if (walk.probe().twoWheelFlow === 'foot') break
    }
    const target = walk.probe().downedBikes[0]
    if (target && target.dist > 1.5) {
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
      for (let i = 0; i < 420; i++) {
        const curT = walk.probe().downedBikes[0]
        if (!curT || curT.dist <= 1.5) break
        const yawToBike = Math.atan2(-(curT.x - walk.probe().x), -(curT.z - walk.probe().z))
        walk.face(yawToBike, .28)
        walk.tick(1 / 60)
      }
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
    }
    walk.tick(1 / 60)
    return walk.probe()
  })
  assert.equal(standRes.twoWheelFlow, 'foot', `expected foot after standup, got ${standRes.twoWheelFlow}`)
  assert(!standRes.inHouse && !standRes.wet, `rider stood in unsafe spot: inHouse=${standRes.inHouse} wet=${standRes.wet}`)
  if (standRes.downedCount > 0) {
    await interactF(page, '扶起')
    await page.evaluate(() => {
      const {walk} = window.viewer
      for (let i = 0; i < 60; i++) walk.tick(1 / 60)
    })
  }
  await interactF(page, '骑')
  await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike')
  return page.evaluate(() => {
    window.viewer.walk.tick(1 / 60)
    return window.viewer.walk.probe()
  })
}

const metrics = {}

try {
  browser = await chromium.launch(browserOptions())

  // =========================================================================
  // 1. Silent ?verify guard (without stunt=1): no auto-crash, 0% battery drain, 0 localStorage pollution, draw calls <= 3
  // =========================================================================
  {
    const ctx = await browser.newContext({viewport: {width: 1280, height: 720}})
    const page = await ctx.newPage()
    page.on('pageerror', e => errors.push(`silent: ${e.message}`))
    await page.route('**/favicon.ico', r => r.fulfill({status: 204}))
    await page.goto(`${baseUrl}/?verify&mode=walk&flow=0&time=10.5`)
    await waitWalkReady(page)

    await walkNearBike(page, -393.6, -50.7, 'silent-guard')
    await interactF(page, '骑电动车')
    await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike')
    await unlockAndShift(page, 4)

    // Measure renderer draw call delta: stock vs ghostfire (must be <= 3)
    const drawCheck = await page.evaluate(async () => {
      const {walk, stream, stats} = window.viewer
      walk.hold(true)
      for (let k = 0; k < 60; k++) {
        stream.tick(walk.position)
        await new Promise(r => requestAnimationFrame(r))
        if (!stream.pending.size && !(stream.updateLandmarks?.pendingCount?.() ?? 0)) break
      }
      walk.ebike.setVehicleType('normal')
      walk.ebike.setMod('stock')
      walk.tick(1 / 60)
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      const stockProbe = walk.probe().ebikeRig
      const stockCalls1 = stats.calls
      walk.ebike.setMod('ghostfire')
      walk.tick(1 / 60)
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      const modProbe = walk.probe().ebikeRig
      const modCalls = stats.calls
      walk.ebike.setMod('stock')
      walk.tick(1 / 60)
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      const stockCalls2 = stats.calls
      walk.ebike.setMod('ghostfire')
      walk.tick(1 / 60)
      walk.hold(false)
      return {
        stockModDelta: stockProbe?.modDrawCallDelta ?? -1,
        modDelta: modProbe?.modDrawCallDelta ?? -1,
        visibleModMeshes: modProbe?.visibleModMeshes ?? -1,
        glCallDelta: Math.min(modCalls - stockCalls1, modCalls - stockCalls2),
        rawCalls: {stockCalls1, modCalls, stockCalls2},
      }
    })
    assert.equal(drawCheck.stockModDelta, 0, `stock modDrawCallDelta should be 0, got ${JSON.stringify(drawCheck)}`)
    assert(drawCheck.modDelta <= 3 && drawCheck.visibleModMeshes <= 3, `ghostfire modDrawCallDelta exceeded 3: ${JSON.stringify(drawCheck)}`)
    assert(drawCheck.glCallDelta <= 3, `renderer GL calls delta exceeded 3: ${JSON.stringify(drawCheck)}`)
    metrics.modDrawCallDelta = drawCheck.modDelta
    metrics.glCallDelta = drawCheck.glCallDelta

    // Verify silent ?verify has 0 auto-crash & 0 battery drain & 0 localStorage pollution
    const silentRes = await page.evaluate(() => {
      const {walk} = window.viewer
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyD'}))
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'ShiftLeft'}))
      for (let i = 0; i < 80; i++) walk.tick(1 / 60)
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'ShiftLeft'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyD'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
      const p = walk.probe()
      return {
        vehicle: walk.vehicle,
        flow: p.twoWheelFlow,
        battery: p.ebike?.battery ?? -1,
        stored: localStorage.getItem('glol.ebike.batteries.v1'),
      }
    })
    assert.equal(silentRes.vehicle, 'bike', '?verify without stunt=1 must never auto-crash')
    assert.equal(silentRes.flow, 'riding')
    assert.equal(silentRes.battery, 100, `?verify without stunt=1 must not drain battery, got ${silentRes.battery}`)
    assert.equal(silentRes.stored, null, '?verify without stunt=1 must not read/write roadside battery persistence')
    await ctx.close()
  }

  // =========================================================================
  // 2. Stunt suite (?verify&mode=walk&stunt=1): gears, weight transfer, wheelie, lowside, slow curb, battery + reload
  // =========================================================================
  {
    const ctx = await browser.newContext({viewport: {width: 1280, height: 720}})
    const page = await ctx.newPage()
    page.on('pageerror', e => errors.push(`stunt-desk: ${e.message}`))
    await page.route('**/favicon.ico', r => r.fulfill({status: 204}))
    await page.goto(`${baseUrl}/?verify&mode=walk&stunt=1&flow=0&time=10.5`)
    await waitWalkReady(page)

    // 2A. Normal roadside e-bike at (-393.6, -50.7) (paint=3 -> normal): compliant D2 <=25, longitudinal dive/squat, S=50 km/h, Path 1 reset
    const normalSpot = await walkNearBike(page, -393.6, -50.7, 'stunt-normal')
    await interactF(page, '骑电动车')
    await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike')
    const mountCheck1 = await page.evaluate(() => {
      window.viewer.walk.tick(1 / 60)
      return window.viewer.walk.probe().ebike
    })
    assert.equal(mountCheck1.vehicleType, 'normal')
    assert.equal(mountCheck1.gear, 2)
    assert(mountCheck1.maxKmh <= 25, `normal default mount maxKmh must be <= 25, got ${mountCheck1.maxKmh}`)

    await unlockAndShift(page, 4) // S gear -> 50 km/h
    const speedAndPitch = await page.evaluate(() => {
      const {walk} = window.viewer
      const target = [-463, -54]
      const angle = Math.atan2(-(target[0] - walk.position.x), -(target[1] - walk.position.z))
      walk.face(angle, .25)
      // Align heading toward open corridor [-463, -54]
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
      let peakKmh = 0, maxLaunchPitch = -1, minBrakePitch = 1, maxAccWheelie = 0
      for (let i = 0; i < 180; i++) {
        const dx = target[0] - walk.position.x, dz = target[1] - walk.position.z
        const err = Math.atan2(Math.sin(Math.atan2(-dx, -dz) - walk.heading), Math.cos(Math.atan2(-dx, -dz) - walk.heading))
        window.dispatchEvent(new KeyboardEvent(err > .04 ? 'keydown' : 'keyup', {code: 'KeyA'}))
        window.dispatchEvent(new KeyboardEvent(err < -.04 ? 'keydown' : 'keyup', {code: 'KeyD'}))
        walk.tick(1 / 60)
        const pr = walk.probe()
        peakKmh = Math.max(peakKmh, (walk.speed * 3.6))
        if (i < 35) maxLaunchPitch = Math.max(maxLaunchPitch, pr.ebike?.longPitch ?? 0)
        maxAccWheelie = Math.max(maxAccWheelie, pr.ebikeRig?.wheelie ?? 0)
      }
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyA'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyD'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
      // Hard brake -> front fork dive (longPitch < 0) without triggering wheelie
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyS'}))
      for (let i = 0; i < 20; i++) {
        walk.tick(1 / 60)
        minBrakePitch = Math.min(minBrakePitch, walk.probe().ebike?.longPitch ?? 0)
      }
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyS'}))
      for (let i = 0; i < 40; i++) walk.tick(1 / 60)
      return {peakKmh, maxLaunchPitch, minBrakePitch, maxAccWheelie, maxKmhSetting: walk.probe().ebike?.maxKmh}
    })
    assert.equal(speedAndPitch.maxKmhSetting, 50)
    assert(speedAndPitch.peakKmh >= 44 && speedAndPitch.peakKmh <= 50.2, `normal S peakKmh unexpected: ${JSON.stringify(speedAndPitch)}`)
    assert(speedAndPitch.maxLaunchPitch > 0.004 && speedAndPitch.minBrakePitch < -0.008, `longitudinal dive/squat missing: ${JSON.stringify(speedAndPitch)}`)
    assert(speedAndPitch.maxAccWheelie < 0.01, `weight transfer polluted wheelie telemetry: ${speedAndPitch.maxAccWheelie}`)
    metrics.normalPeakKmh = +speedAndPitch.peakKmh.toFixed(1)

    // Path 1 reset assertion: Dismount from S -> Remount -> must return to <=25 km/h D2
    await interactF(page, '下车')
    await page.waitForFunction(() => window.viewer.walk.vehicle === 'foot')
    await interactF(page, '骑电动车')
    await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike')
    const resetPath1 = await page.evaluate(() => {
      window.viewer.walk.tick(1 / 60)
      return window.viewer.walk.probe().ebike
    })
    assert.equal(resetPath1.gear, 2, `Path 1 dismount->remount gear expected D2, got ${resetPath1.gear}`)
    assert(resetPath1.maxKmh <= 25, `Path 1 dismount->remount maxKmh must be <= 25, got ${resetPath1.maxKmh}`)
    await interactF(page, '下车')
    await page.waitForFunction(() => window.viewer.walk.vehicle === 'foot')

    // 2B. Shared e-bike at (-389.6, -49.4) (snaps onto sidewalk z=-53.4; paint=1 -> shared): modsLocked, wheelieDisabled, S <= 18 km/h
    const sharedBikeCoord = await page.evaluate(async () => {
      const {walk} = window.viewer
      const shared = walk.parked('bike').find(b => Math.abs(b[0] + 389.6) < 0.8 && Math.hypot(b[0] + 389.6, b[2] + 49.4) < 6)
      if (!shared) return null
      await window.viewer.walkTo(shared[0], shared[2], 0, 'stunt-shared')
      for (let i = 0; i < 6; i++) walk.tick(1 / 60)
      return shared
    })
    assert(sharedBikeCoord, 'shared bike at (-389.6,-49.4) not found')
    await interactF(page, '骑电动车')
    await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike')
    const sharedMount = await page.evaluate(() => {
      window.viewer.walk.tick(1 / 60)
      const modBtn = document.querySelector('.ride-mod')
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyG'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyG'}))
      window.viewer.walk.tick(1 / 60)
      return {
        typeText: document.querySelector('.ride-type')?.textContent,
        modDisplay: modBtn ? getComputedStyle(modBtn).display : 'missing',
        eb: window.viewer.walk.probe().ebike,
      }
    })
    assert.equal(sharedMount.typeText, '共享')
    assert.equal(sharedMount.modDisplay, 'none')
    assert.equal(sharedMount.eb.modPreset, 'stock', 'shared bike must reject G mod change')
    assert(sharedMount.eb.maxKmh <= 18, 'shared bike must mount at <= 18 km/h')
    await unlockAndShift(page, 4)
    const sharedPeak = await page.evaluate(() => {
      const {walk} = window.viewer
      const target = [-463, -54]
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Space'}))
      let peak = 0
      let peakWheelie = 0
      for (let i = 0; i < 380; i++) {
        const dx = target[0] - walk.position.x, dz = target[1] - walk.position.z
        const err = Math.atan2(Math.sin(Math.atan2(-dx, -dz) - walk.heading), Math.cos(Math.atan2(-dx, -dz) - walk.heading))
        window.dispatchEvent(new KeyboardEvent(err > .04 ? 'keydown' : 'keyup', {code: 'KeyA'}))
        window.dispatchEvent(new KeyboardEvent(err < -.04 ? 'keydown' : 'keyup', {code: 'KeyD'}))
        walk.tick(1 / 60)
        peak = Math.max(peak, walk.speed * 3.6)
        peakWheelie = Math.max(peakWheelie, Math.abs(walk.probe().ebike?.wheelie ?? 0))
      }
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Space'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyA'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyD'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
      for (let i = 0; i < 30; i++) walk.tick(1 / 60)
      return {peak, peakWheelie, maxKmh: walk.probe().ebike.maxKmh}
    })
    assert.equal(sharedPeak.maxKmh, 18)
    assert(sharedPeak.peak >= 14 && sharedPeak.peak <= 18.2, `shared peak unexpected: ${JSON.stringify(sharedPeak)}`)
    assert.equal(sharedPeak.peakWheelie, 0, `shared bike must prohibit wheelies: ${JSON.stringify(sharedPeak)}`)
    metrics.sharedPeakKmh = +sharedPeak.peak.toFixed(1)
    await interactF(page, '下车')
    await page.waitForFunction(() => window.viewer.walk.vehicle === 'foot')

    // 2C. Straight wheelie hold + smooth landing + wheelie tip-over + normal turn + lowside + slow curb + Path 2 reset
    await walkNearBike(page, -874.2, -134.4, 'stunt-zhongshan', true)
    await interactF(page, '骑电动车')
    await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike')
    await unlockAndShift(page, 3)

    // Steer onto Zhongshan North (-873, -215 -> -827, -397 -> -773, -737)
    await page.evaluate(() => {
      const {walk} = window.viewer
      const target = [-873, -215]
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
      for (let i = 0; i < 240; i++) {
        const dx = target[0] - walk.position.x, dz = target[1] - walk.position.z
        if (Math.hypot(dx, dz) < 3) break
        const err = Math.atan2(Math.sin(Math.atan2(-dx, -dz) - walk.heading), Math.cos(Math.atan2(-dx, -dz) - walk.heading))
        window.dispatchEvent(new KeyboardEvent(err > .05 ? 'keydown' : 'keyup', {code: 'KeyA'}))
        window.dispatchEvent(new KeyboardEvent(err < -.05 ? 'keydown' : 'keyup', {code: 'KeyD'}))
        walk.tick(1 / 60)
      }
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyA'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyD'}))
      // Align cleanly north along (-873,-215)->(-827,-397)
      for (let i = 0; i < 60; i++) {
        const dx = -827 - walk.position.x, dz = -397 - walk.position.z
        const err = Math.atan2(Math.sin(Math.atan2(-dx, -dz) - walk.heading), Math.cos(Math.atan2(-dx, -dz) - walk.heading))
        if (Math.abs(err) < 0.03) break
        window.dispatchEvent(new KeyboardEvent(err > .02 ? 'keydown' : 'keyup', {code: 'KeyA'}))
        window.dispatchEvent(new KeyboardEvent(err < -.02 ? 'keydown' : 'keyup', {code: 'KeyD'}))
        walk.tick(1 / 60)
      }
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyA'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyD'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
    })

    // Straight wheelie 2.4s (never crashes, caps <= 52 deg)
    const wheelieStraight = await page.evaluate(() => {
      const {walk} = window.viewer
      walk.ebike.setMod('ghostfire')
      walk.face(walk.heading + .85, .20)
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
      for (let i = 0; i < 40; i++) walk.tick(1 / 60)
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Space'}))
      let peakWheelie = 0, crashed = false
      for (let i = 0; i < 144; i++) {
        walk.tick(1 / 60)
        const p = walk.probe()
        peakWheelie = Math.max(peakWheelie, p.ebike?.wheelie ?? 0)
        if (p.twoWheelFlow !== 'riding') crashed = true
      }
      return {peakWheelie, crashed, tip: walk.probe().ebike?.wheelieTip ?? -1}
    })
    assert(!wheelieStraight.crashed, `straight wheelie must never loop-out: ${JSON.stringify(wheelieStraight)}`)
    assert(wheelieStraight.peakWheelie > 0.35 && wheelieStraight.peakWheelie <= (52 * Math.PI / 180) + 1e-3, `wheelie ceiling bad: ${JSON.stringify(wheelieStraight)}`)
    await page.screenshot({path: `${OUT_DIR}/wheelie-straight.png`})
    metrics.wheeliePeakDeg = +(wheelieStraight.peakWheelie * 180 / Math.PI).toFixed(1)

    // Smooth release landing
    const landing = await page.evaluate(() => {
      const {walk} = window.viewer
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Space'}))
      for (let i = 0; i < 45; i++) walk.tick(1 / 60)
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
      walk.face(walk.heading, .26)
      return {wheelie: walk.probe().ebike?.wheelie ?? -1, flow: walk.probe().twoWheelFlow}
    })
    assert.equal(landing.flow, 'riding')
    assert(landing.wheelie < 0.05, `wheelie should settle cleanly on release, got ${landing.wheelie}`)

    // Slow curb / sidewalk brush at D1 (~12 km/h): no false crash
    await unlockAndShift(page, 1)
    const slowCurb = await page.evaluate(() => {
      const {walk} = window.viewer
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
      for (let i = 0; i < 30; i++) walk.tick(1 / 60)
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyD'}))
      for (let i = 0; i < 36; i++) walk.tick(1 / 60)
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyD'}))
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyA'}))
      for (let i = 0; i < 36; i++) walk.tick(1 / 60)
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyA'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
      return {flow: walk.probe().twoWheelFlow, kmh: Math.round(walk.speed * 3.6)}
    })
    assert.equal(slowCurb.flow, 'riding', `slow D1 weave must never false-crash: ${JSON.stringify(slowCurb)}`)

    // Wheelie tip-over (Space + sudden full lock D at D3/S) -> Crash -> Pickup -> Remount -> Path 2 D2 <= 25 reset
    await unlockAndShift(page, 4)
    const wheelieTipCrash = await page.evaluate(() => {
      const {walk} = window.viewer
      const dx = -827 - walk.position.x, dz = -397 - walk.position.z
      for (let i = 0; i < 40; i++) {
        const err = Math.atan2(Math.sin(Math.atan2(-dx, -dz) - walk.heading), Math.cos(Math.atan2(-dx, -dz) - walk.heading))
        if (Math.abs(err) < 0.06) break
        window.dispatchEvent(new KeyboardEvent(err > .02 ? 'keydown' : 'keyup', {code: 'KeyA'}))
        window.dispatchEvent(new KeyboardEvent(err < -.02 ? 'keydown' : 'keyup', {code: 'KeyD'}))
        walk.tick(1 / 60)
      }
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyA'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyD'}))
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
      for (let i = 0; i < 45; i++) walk.tick(1 / 60)
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Space'}))
      for (let i = 0; i < 45; i++) walk.tick(1 / 60)
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyD'}))
      let crashed = false, reason = ''
      for (let i = 0; i < 120; i++) {
        walk.tick(1 / 60)
        const p = walk.probe()
        if (p.twoWheelFlow === 'crashed') { crashed = true; reason = p.ebike?.crashReason ?? ''; break }
      }
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyD'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'Space'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
      return {crashed, reason}
    })
    assert(wheelieTipCrash.crashed && wheelieTipCrash.reason === 'lowside', `wheelie turn overload must tip into lowside: ${JSON.stringify(wheelieTipCrash)}`)
    const path2Probe = await recoverCrashToRemount(page)
    assert.equal(path2Probe.ebike.gear, 2, `Path 2 crash->pickup->remount must reset to D2, got ${path2Probe.ebike.gear}`)
    assert(path2Probe.ebike.maxKmh <= 25, `Path 2 crash->pickup->remount maxKmh must be <= 25, got ${path2Probe.ebike.maxKmh}`)

    // Normal cornering survival + Extreme high-speed deep-tuck lowside warning & crash + recovery
    await unlockAndShift(page, 3)
    const cornerFlow = await page.evaluate(() => {
      const {walk} = window.viewer
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
      for (let i = 0; i < 45; i++) walk.tick(1 / 60)
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyD'}))
      let normMaxDanger = 0, normCrashed = false
      for (let i = 0; i < 50; i++) {
        walk.tick(1 / 60)
        const p = walk.probe()
        normMaxDanger = Math.max(normMaxDanger, p.ebike?.leanDangerRatio ?? 0)
        if (p.twoWheelFlow === 'crashed') normCrashed = true
      }
      walk.ebike.setGear(4)
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'ShiftLeft'}))
      let warnSeen = false, crashed = false, reason = ''
      for (let i = 0; i < 120; i++) {
        walk.tick(1 / 60)
        const p = walk.probe()
        if ((p.ebike?.leanDangerRatio ?? 0) >= 0.7) warnSeen = true
        if (p.twoWheelFlow === 'crashed') { crashed = true; reason = p.ebike?.crashReason ?? ''; break }
      }
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'ShiftLeft'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyD'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
      for (let i = 0; i < 20; i++) walk.tick(1 / 60)
      const pEnd = walk.probe()
      return {normCrashed, normMaxDanger, warnSeen, crashed, reason, inHouse: pEnd.inHouse, wet: pEnd.wet, deck: pEnd.deck}
    })
    assert(!cornerFlow.normCrashed, `normal D3 carve must not crash: ${JSON.stringify(cornerFlow)}`)
    assert(cornerFlow.warnSeen && cornerFlow.crashed && cornerFlow.reason === 'lowside', `high-speed tuck turn must warn & lowside: ${JSON.stringify(cornerFlow)}`)
    assert(!cornerFlow.inHouse && (!cornerFlow.wet || cornerFlow.deck !== undefined), 'lowside crash ended in unsafe zone')
    await page.screenshot({path: `${OUT_DIR}/lowside-crash.png`})
    const postLowside = await recoverCrashToRemount(page)
    assert.equal(postLowside.ebike.gear, 2)
    await interactF(page, '下车')
    await page.waitForFunction(() => window.viewer.walk.vehicle === 'foot')

    // 2D. Battery drain + 20%/10%/0% thresholds + cross-reload localStorage persistence + version reset + 50 cap
    const batSpot = await walkNearBike(page, -393.6, -50.7, 'stunt-battery')
    await interactF(page, '骑电动车')
    await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike')
    await unlockAndShift(page, 4)

    const batRes = await page.evaluate(() => {
      const {walk} = window.viewer
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
      for (let i = 0; i < 120; i++) walk.tick(1 / 60)
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
      const afterDrain = walk.probe().ebike.battery

      walk.ebike.setBattery(20); walk.tick(1 / 60)
      const at20 = {bat: walk.probe().ebike, level: document.querySelector('.ride-bat')?.dataset.level}
      walk.ebike.setBattery(10); walk.tick(1 / 60)
      const at10 = {bat: walk.probe().ebike, level: document.querySelector('.ride-bat')?.dataset.level}
      walk.ebike.setHeadlight('low'); walk.tick(1 / 60)
      walk.ebike.setBattery(0); walk.tick(1 / 60)
      const at0 = {bat: walk.probe().ebike, hl: walk.probe().ebikeRig?.headlight}
      walk.ebike.setBattery(10); walk.tick(1 / 60)
      return {afterDrain, at20, at10, at0}
    })
    assert(batRes.afterDrain < 100, `stunt=1 must drain battery during ride, got ${batRes.afterDrain}`)
    assert(batRes.at20.bat.lowBattery && batRes.at20.level === 'low')
    assert(batRes.at10.bat.criticalBattery && batRes.at10.bat.maxKmh <= 16 && batRes.at10.level === 'crit')
    assert(batRes.at0.bat.batteryDepleted && batRes.at0.bat.maxKmh <= 10 && batRes.at0.hl === 'off', `0% battery must cap 10 km/h & cut headlight: ${JSON.stringify(batRes.at0)}`)
    await page.screenshot({path: `${OUT_DIR}/low-battery.png`})
    await page.evaluate(() => { window.viewer.walk.ebike.setBattery(42.5); window.viewer.walk.tick(1 / 60) })
    metrics.drain2s = +(100 - batRes.afterDrain).toFixed(2)

    await interactF(page, '下车')
    await page.waitForFunction(() => window.viewer.walk.vehicle === 'foot')

    const expectedKey = `${Math.round(batSpot[0] * 10)},${Math.round(batSpot[2] * 10)}`
    const storedBeforeReload = await page.evaluate(k => {
      const raw = localStorage.getItem('glol.ebike.batteries.v1')
      const parsed = raw ? JSON.parse(raw) : null
      // Test 50-entry LRU trim by appending 55 dummy entries before real entry
      if (parsed) {
        const extra = Array.from({length: 55}, (_, i) => ({k: `${90000 + i},${90000 + i}`, b: 60}))
        const self = parsed.entries.filter(e => e.k === k)
        localStorage.setItem('glol.ebike.batteries.v1', JSON.stringify({worldVersion: parsed.worldVersion, entries: [...extra, ...self]}))
      }
      return parsed
    }, expectedKey)
    assert(storedBeforeReload?.worldVersion && Array.isArray(storedBeforeReload.entries), 'missing persisted battery record')
    assert(storedBeforeReload.entries.some(e => e.k === expectedKey && Math.abs(e.b - 42.5) < 0.2), `missing ${expectedKey}=42.5 in ${JSON.stringify(storedBeforeReload)}`)

    // Reload -> restored 42.5% AND trimmed to <= 50 entries
    await page.reload()
    await waitWalkReady(page)
    await page.evaluate(async ([bx, bz]) => {
      await window.viewer.walkTo(bx, bz, 0, 'reload-battery')
      for (let i = 0; i < 6; i++) window.viewer.walk.tick(1 / 60)
    }, [batSpot[0], batSpot[2]])
    await interactF(page, '骑电动车')
    await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike')
    const afterReloadBat = await page.evaluate(() => {
      const {walk} = window.viewer
      walk.tick(1 / 60)
      const bat = walk.probe().ebike.battery
      // Trigger save on full LRU-trimmed map
      walk.ebike.setBattery(41.5); walk.tick(1 / 60)
      const store = JSON.parse(localStorage.getItem('glol.ebike.batteries.v1') || '{}')
      return {bat, count: store.entries?.length ?? -1, worldVersion: store.worldVersion}
    })
    assert(Math.abs(afterReloadBat.bat - 42.5) < 0.2, `cross-reload battery expected 42.5, got ${afterReloadBat.bat}`)
    assert(afterReloadBat.count <= 50, `LRU store count exceeded 50: ${afterReloadBat.count}`)

    await interactF(page, '下车')
    await page.waitForFunction(() => window.viewer.walk.vehicle === 'foot')

    // World version mismatch resets batteries cleanly to 100%
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('glol.ebike.batteries.v1') || '{}')
      s.worldVersion = 'stale-world-v0'
      localStorage.setItem('glol.ebike.batteries.v1', JSON.stringify(s))
    })
    await page.reload()
    await waitWalkReady(page)
    await page.evaluate(async ([bx, bz]) => {
      await window.viewer.walkTo(bx, bz, 0, 'reload-version-reset')
      for (let i = 0; i < 6; i++) window.viewer.walk.tick(1 / 60)
    }, [batSpot[0], batSpot[2]])
    await interactF(page, '骑电动车')
    await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike')
    const afterVerReset = await page.evaluate(() => {
      window.viewer.walk.tick(1 / 60)
      return window.viewer.walk.probe().ebike.battery
    })
    assert.equal(afterVerReset, 100, `world version change must reset battery to 100%, got ${afterVerReset}`)

    await ctx.close()
  }

  // =========================================================================
  // 3. Upgraded Personal Bike 70 km/h + Wall, 0.18m Riverside Rail & Tree Impact (?solo=1&verify&stunt=1)
  // =========================================================================
  {
    const ctx = await browser.newContext({viewport: {width: 1280, height: 720}})
    const page = await ctx.newPage()
    page.on('pageerror', e => errors.push(`solo-70: ${e.message}`))
    await page.route('**/favicon.ico', r => r.fulfill({status: 204}))
    await page.goto(`${baseUrl}/?solo=1&verify&stunt=1&flow=0&time=10.5&traffic=0`)
    await waitWalkReady(page, () => Boolean(window.viewer?.game))

    const vid = await page.evaluate(() => {
      const g = window.viewer.game
      g.save.reset(30000)
      const buy = g.commerce.executePurchase({
        shopId: 'shop_shizijie_ebike',
        itemType: 'ebike_model',
        itemId: 'xiangshan_gt',
        expectedPrice: 6800,
        idempotencyKey: 'stunt_buy_gt',
      })
      const id = buy.createdVehicleId
      for (const [type, itemId, price] of [
        ['ebike_upgrade', 'motor:3', 2200],
        ['ebike_upgrade', 'controller:3', 2200],
        ['ebike_upgrade', 'battery:3', 2200],
        ['ebike_visual', 'visual:ghostfire', 520],
        ['ebike_visual', 'visual:windshield_tinted', 320],
        ['ebike_visual', 'visual:topbox_delivery', 450],
        ['ebike_visual', 'visual:exhaust', 320],
        ['ebike_visual', 'visual:headlight_2', 420],
      ]) {
        g.commerce.executePurchase({
          shopId: 'shop_shizijie_ebike',
          itemType: type,
          itemId,
          targetVehicleId: id,
          expectedPrice: price,
          idempotencyKey: `stunt_${itemId}`,
        })
      }
      return id
    })

    async function runProbedImpactSuite(cfg) {
      return page.evaluate(async opts => {
        const {walk, stream} = window.viewer
        const waitSummon = async () => {
          let sum = walk.garage.summon(opts.vehicleId)
          for (let t = 0; !sum.ok && sum.code === 'COOLDOWN' && t < 20; t++) {
            await new Promise(r => setTimeout(r, Math.max(150, Math.min(1200, (sum.cooldownRemainingMs ?? 1000) + 50))))
            sum = walk.garage.summon(opts.vehicleId)
          }
          return sum
        }
        const pumpStream = async frame => {
          stream.updateLandmarks?.(walk.position)
          stream.tick(walk.position)
          if (frame % 25 === 0 || walk.obstacle === 'streaming') {
            await new Promise(r => setTimeout(r, walk.obstacle === 'streaming' ? 12 : 0))
          }
        }
        const findCorridor = (ox, oz, footY) => {
          const probeY = opts.kind === 'rail' ? footY + 0.25 : undefined
          let best = null
          for (let i = 0; i < 144; i++) {
            const ang = (i / 144) * Math.PI * 2
            const dx = Math.sin(ang), dz = Math.cos(ang)
            const h = walk.raycastObstacle(ox, probeY, oz, dx, 0, dz, opts.maxScanDist)
            if (!h || h.kind !== opts.kind || h.distance < opts.minDist || h.distance > opts.maxDist) continue
            const nDot = Math.abs(h.normal[0] * dx + h.normal[2] * dz)
            if (nDot < opts.minNDot) continue
            const rx = -dz, rz = dx
            const hL = walk.raycastObstacle(ox + rx * opts.latOffset, probeY, oz + rz * opts.latOffset, dx, 0, dz, h.distance + 4)
            const hR = walk.raycastObstacle(ox - rx * opts.latOffset, probeY, oz - rz * opts.latOffset, dx, 0, dz, h.distance + 4)
            if (opts.clearMode === 'empty') {
              if ((hL && hL.distance < h.distance - 1.5) || (hR && hR.distance < h.distance - 1.5)) continue
            } else {
              if (!hL || hL.kind !== opts.kind || hL.distance < h.distance - 2.5) continue
              if (!hR || hR.kind !== opts.kind || hR.distance < h.distance - 2.5) continue
            }
            let consec = 0, consecPav = 0, launchPav = 0, innerGap = false
            for (let d = 4; d <= h.distance - opts.tailMargin; d += 2) {
              const px = ox + dx * d, pz = oz + dz * d
              const ok = walk.pavementAt(px, pz) && !walk.insideHouseAt(px, pz)
              if (d <= 24 && ok) launchPav++
              if (ok) { consec += 2; if (consec > consecPav) consecPav = consec }
              else { consec = 0; if (d >= 6 && d <= h.distance - 8) innerGap = true }
            }
            if (opts.requireNoInnerGap && innerGap) continue
            if (consecPav < opts.minConsecPav) continue
            const score = opts.kind === 'rail'
              ? launchPav * 5 + nDot * 40 + h.distance * 0.3
              : opts.kind === 'tree'
                ? h.distance
                : consecPav * 2 + nDot * 40 - h.distance * 0.1
            if (!best || score > best.score) best = {score, dx, dz, dist: h.distance, point: h.point, consecPav, kind: h.kind}
          }
          return best
        }

        await window.viewer.walkTo(opts.start[0], opts.start[1], 0, opts.reason)
        const preTarget = findCorridor(walk.position.x, walk.position.z, walk.probe().foot)
        if (!preTarget) return {err: `failed to probe ${opts.kind} target before summon`}
        // summon places bike at playerYaw + Math.PI / 2, so face targetHeading - Math.PI / 2 first
        walk.face(Math.atan2(-preTarget.dx, -preTarget.dz) - Math.PI * 0.5, .22)
        for (let i = 0; i < 4; i++) walk.tick(1 / 60)
        const sum = await waitSummon()
        if (!sum.ok || !sum.pos) return {err: `summon ${opts.kind} failed: ${sum.code}`}
        await window.viewer.walkTo(sum.pos[0] + 0.8, sum.pos[2], 0, `${opts.reason}-near`)
        for (let i = 0; i < 6; i++) walk.tick(1 / 60)
        walk.shop.triggerInteract()
        for (let i = 0; i < 6; i++) walk.tick(1 / 60)
        if (walk.vehicle !== 'bike') return {err: `failed mount for ${opts.kind} run`}

        await window.viewer.freeze()
        const fullModStats = walk.probe().ebikeRig?.drawCallStats
        const mountMax = walk.probe().ebike.maxKmh
        walk.ebike.setPark(false, true)
        walk.ebike.setKickstand(false, true)
        walk.ebike.setGear(4)
        walk.tick(1 / 60)
        const sMax = walk.probe().ebike.maxKmh

        const target = findCorridor(walk.position.x, walk.position.z, walk.probe().foot)
          ?? (opts.allowPreFallback ? preTarget : null)
        if (!target) {
          window.viewer.resume()
          return {err: `failed to confirm ${opts.kind} corridor after summon`}
        }

        const initErr = Math.atan2(
          Math.sin(Math.atan2(-(target.point[0] - walk.position.x), -(target.point[2] - walk.position.z)) - walk.heading),
          Math.cos(Math.atan2(-(target.point[0] - walk.position.x), -(target.point[2] - walk.position.z)) - walk.heading),
        )
        window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
        if (Math.abs(initErr) > 0.08) {
          walk.ebike.setGear(1)
          for (let i = 0; i < opts.alignTicks; i++) {
            const dx = target.point[0] - walk.position.x, dz = target.point[2] - walk.position.z
            const err = Math.atan2(Math.sin(Math.atan2(-dx, -dz) - walk.heading), Math.cos(Math.atan2(-dx, -dz) - walk.heading))
            if (Math.abs(err) <= 0.04) break
            window.dispatchEvent(new KeyboardEvent(err > 0.02 ? 'keydown' : 'keyup', {code: 'KeyA'}))
            window.dispatchEvent(new KeyboardEvent(err < -0.02 ? 'keydown' : 'keyup', {code: 'KeyD'}))
            walk.tick(1 / 60)
            await pumpStream(i)
          }
          window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyA'}))
          window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyD'}))
        }

        let alignedDist = target.dist, alignedKind = target.kind
        if (opts.verifyAlignedRay) {
          const fwdX = -Math.sin(walk.heading), fwdZ = -Math.cos(walk.heading)
          const verifyY = opts.kind === 'rail' ? target.point[1] : undefined
          const aheadHit = walk.raycastObstacle(walk.position.x, verifyY, walk.position.z, fwdX, 0, fwdZ, 130)
          if (!aheadHit || aheadHit.kind !== opts.kind || aheadHit.distance < 34) {
            window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
            window.viewer.resume()
            return {err: `aligned ${opts.kind} ray check failed: ${JSON.stringify(aheadHit)}`}
          }
          alignedDist = aheadHit.distance
          alignedKind = aheadHit.kind
        }

        walk.ebike.setGear(4)
        let peakKmh = 0, preImpactKmh = 0, speedBeforeDrop = 0
        let crashed = false, crashReason = '', wetAny = false, inHouseAny = false, hitsRail = false, obstacle = ''
        for (let i = 0; i < opts.maxSprintTicks; i++) {
          const dx = target.point[0] - walk.position.x, dz = target.point[2] - walk.position.z
          const err = Math.atan2(Math.sin(Math.atan2(-dx, -dz) - walk.heading), Math.cos(Math.atan2(-dx, -dz) - walk.heading))
          window.dispatchEvent(new KeyboardEvent(err > opts.steerDeadband ? 'keydown' : 'keyup', {code: 'KeyA'}))
          window.dispatchEvent(new KeyboardEvent(err < -opts.steerDeadband ? 'keydown' : 'keyup', {code: 'KeyD'}))
          const spdNow = walk.speed * 3.6
          walk.tick(1 / 60)
          await pumpStream(i)
          const p = walk.probe()
          const kmh = walk.speed * 3.6
          peakKmh = Math.max(peakKmh, kmh, spdNow)
          if (p.wet && p.deck === undefined) wetAny = true
          if (p.inHouse) inHouseAny = true
          if (p.hits?.includes('rail')) hitsRail = true
          if (walk.obstacle) obstacle = walk.obstacle
          if (p.twoWheelFlow === 'crashed') {
            crashed = true
            crashReason = p.ebike?.crashReason ?? ''
            preImpactKmh = Math.max(speedBeforeDrop, spdNow)
            break
          }
          speedBeforeDrop = kmh
        }
        window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyA'}))
        window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyD'}))
        window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
        for (let i = 0; i < 20; i++) walk.tick(1 / 60)
        window.viewer.resume()
        await new Promise(requestAnimationFrame)
        const pEnd = walk.probe()
        return {
          fullModStats, mountMax, sMax,
          targetKind: alignedKind, targetDist: +alignedDist.toFixed(1),
          consecPav: target.consecPav,
          preImpactKmh: +preImpactKmh.toFixed(1),
          peakKmh: +peakKmh.toFixed(1),
          crashed, crashReason, wetAny, inHouseAny, hitsRail,
          wetEnd: pEnd.wet, deckEnd: pEnd.deck, inHouseEnd: pEnd.inHouse, obstacle, endPos: [pEnd.x, pEnd.z],
        }
      }, cfg)
    }

    // 3A. Dynamically probe a clear paved corridor ending at a confirmed building wall, reach >= 55 km/h (up to 70 km/h), and crash into the wall
    const wallRun = await runProbedImpactSuite({
      vehicleId: vid, start: [-844, -346], reason: 'stunt-wall-approach',
      kind: 'building', maxScanDist: 130, minDist: 42, maxDist: 115, minNDot: 0.55,
      latOffset: 1.0, clearMode: 'match', tailMargin: 4, requireNoInnerGap: true, minConsecPav: 34,
      allowPreFallback: false, alignTicks: 90, verifyAlignedRay: true, maxSprintTicks: 420, steerDeadband: 0.03,
    })
    assert(!wallRun.err, wallRun.err)
    assert(wallRun.fullModStats && wallRun.fullModStats.modDrawCallDelta <= 3, `full personal mod drawCalls exceeded 3: ${JSON.stringify(wallRun.fullModStats)}`)
    assert(wallRun.mountMax <= 25, `personal mount must start <=25 km/h, got ${wallRun.mountMax}`)
    assert(wallRun.sMax <= 70 && wallRun.sMax >= 68, `upgraded S cap expected 70 km/h ceiling, got ${wallRun.sMax}`)
    assert.equal(wallRun.targetKind, 'building', `expected probed building target, got ${JSON.stringify(wallRun)}`)
    assert(wallRun.preImpactKmh >= 55, `wall run must reach >= 55 km/h before building impact: ${JSON.stringify(wallRun)}`)
    assert(wallRun.peakKmh <= 70.1 && wallRun.peakKmh >= 55, `wall run should hit high speed <= 70 km/h, got ${wallRun.peakKmh}`)
    assert(!wallRun.inHouseAny && !wallRun.inHouseEnd && !wallRun.wetEnd, `wall collision tunneled: ${JSON.stringify(wallRun)}`)
    assert.equal(wallRun.crashed, true, `expected building wall impact crash: ${JSON.stringify(wallRun)}`)
    assert.equal(wallRun.crashReason, 'impact', `expected impact crashReason at wall: ${JSON.stringify(wallRun)}`)
    assert.equal(wallRun.obstacle, 'building', `expected obstacle === 'building': ${JSON.stringify(wallRun)}`)
    await page.screenshot({path: `${OUT_DIR}/wall-crash-recovery.png`})
    const afterWall = await recoverCrashToRemount(page)
    assert(afterWall.ebike.gear === 2 && afterWall.ebike.maxKmh <= 25)
    await page.evaluate(() => {
      const {walk} = window.viewer
      if (walk.vehicle === 'bike') walk.shop.triggerInteract()
    })
    await page.waitForFunction(() => window.viewer.walk.vehicle === 'foot')

    // 3B. Full 70 km/h vs Thin 0.18m Riverside Rail (-792, 742 -> verified rail hit before water)
    const railRun = await runProbedImpactSuite({
      vehicleId: vid, start: [-792, 742], reason: 'stunt-rail-approach',
      kind: 'rail', maxScanDist: 115, minDist: 48, maxDist: 105, minNDot: 0.7,
      latOffset: 0.65, clearMode: 'match', tailMargin: 4, requireNoInnerGap: false, minConsecPav: 0,
      allowPreFallback: true, alignTicks: 90, verifyAlignedRay: true, maxSprintTicks: 420, steerDeadband: 0.03,
    })
    assert(!railRun.err, railRun.err)
    assert(railRun.preImpactKmh >= 55, `rail run must reach >= 55 km/h before impact: ${JSON.stringify(railRun)}`)
    assert(railRun.peakKmh <= 70.1 && railRun.peakKmh >= 58, `rail run should build high speed near 70 km/h, got ${railRun.peakKmh}`)
    assert(railRun.hitsRail, `expected thin 0.18m rail hit: ${JSON.stringify(railRun)}`)
    assert(!railRun.wetAny && !railRun.wetEnd && !railRun.inHouseAny && !railRun.inHouseEnd, `70 km/h must never tunnel through river rail into water: ${JSON.stringify(railRun)}`)
    assert.equal(railRun.crashed, true, `expected impact crash at river rail: ${JSON.stringify(railRun)}`)
    assert.equal(railRun.crashReason, 'impact', `expected impact crashReason at river rail: ${JSON.stringify(railRun)}`)
    assert.equal(railRun.obstacle, 'collision', `expected collision obstacle at river rail: ${JSON.stringify(railRun)}`)
    await page.screenshot({path: `${OUT_DIR}/rail-collision.png`})
    const afterRail = await recoverCrashToRemount(page)
    assert(!afterRail.wet && !afterRail.inHouse)
    assert.equal(afterRail.ebike.gear, 2)
    assert(afterRail.ebike.maxKmh <= 25)
    await page.evaluate(() => {
      const {walk} = window.viewer
      if (walk.vehicle === 'bike') walk.shop.triggerInteract()
    })
    await page.waitForFunction(() => window.viewer.walk.vehicle === 'foot')

    // 3C. Mid/High-speed (>= 35 km/h) Tree Collision Crash: must trigger impact crash (never silent stop)
    const treeRun = await runProbedImpactSuite({
      vehicleId: vid, start: [-844, -346], reason: 'stunt-tree-approach',
      kind: 'tree', maxScanDist: 70, minDist: 20, maxDist: 55, minNDot: 0,
      latOffset: 0.8, clearMode: 'empty', tailMargin: 3, requireNoInnerGap: true, minConsecPav: 16,
      allowPreFallback: false, alignTicks: 130, verifyAlignedRay: false, maxSprintTicks: 240, steerDeadband: 0.02,
    })
    assert(!treeRun.err, treeRun.err)
    assert(treeRun.preImpactKmh >= 35, `tree run must reach >= 35 km/h before impact: ${JSON.stringify(treeRun)}`)
    assert.equal(treeRun.crashed, true, `expected tree collision impact crash: ${JSON.stringify(treeRun)}`)
    assert.equal(treeRun.crashReason, 'impact', `expected impact crashReason on tree: ${JSON.stringify(treeRun)}`)
    assert.equal(treeRun.obstacle, 'collision', `expected collision obstacle on tree: ${JSON.stringify(treeRun)}`)

    metrics.personalPeakKmh = +Math.max(wallRun.peakKmh, railRun.peakKmh, treeRun.peakKmh).toFixed(1)
    await ctx.close()
  }

  // =========================================================================
  // 4. Mobile Touch & Non-Overlapping HUD (390x844 portrait + 640x360 landscape)
  // =========================================================================
  for (const [label, vp] of [['390x844', {width: 390, height: 844}], ['640x360', {width: 640, height: 360}]]) {
    const ctx = await browser.newContext({viewport: vp, deviceScaleFactor: 1, isMobile: true, hasTouch: true})
    await ctx.addInitScript(() => sessionStorage.setItem('glol.portraitOk', '1'))
    const mp = await ctx.newPage()
    mp.on('pageerror', e => errors.push(`mobile-${label}: ${e.message}`))
    await mp.route('**/favicon.ico', r => r.fulfill({status: 204}))
    await mp.goto(`${baseUrl}/?verify&mode=walk&stunt=1&flow=0&time=10.5`)
    await waitWalkReady(mp)

    // Dismiss rotate-screen gate on portrait mobile if rendered
    await mp.evaluate(() => document.querySelector('.portrait-gate button')?.click())

    await walkNearBike(mp, -393.6, -50.7, `stunt-mob-${label}`, true)
    await closeCard(mp)
    await mp.waitForFunction(() => document.querySelector('.vehicle-action:not([hidden])')?.textContent?.includes('骑电动车'))

    const relevantOverlaps = rows => rows.filter(o => !(vp.width <= 640 && new Set([o.a, o.b]).has('.sky-ui') && new Set([o.a, o.b]).has('.dock')))

    // Pre-mount mobile HUD check (.vehicle-action visible)
    const preCheck = await mp.evaluate(checkRectsScript(), {
      ...vp,
      selectors: ['output', '.hud-me', '.sky-ui', '.render-entry', '.dock', '.hud-stats', 'footer', '.vehicle-action', '.walk-ui .joystick', '.walk-ui .btn-view', '.walk-ui .btn-jump'],
    })
    assert.deepEqual(relevantOverlaps(preCheck.overlaps), [], `${label} pre-mount HUD overlap: ${JSON.stringify(preCheck.overlaps)}`)
    assert.deepEqual(preCheck.outOfBounds, [], `${label} pre-mount HUD outOfBounds: ${JSON.stringify(preCheck.outOfBounds)}`)

    await mp.locator('.vehicle-action').tap()
    await mp.waitForFunction(() => window.viewer.walk.vehicle === 'bike' && document.body.dataset.ride === 'bike')
    await mp.evaluate(async () => { for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame) })

    // Riding HUD check (.ride-hud + .hud-stats + .vehicle-action + wheelie/tuck/gear buttons + joystick)
    const rideCheck = await mp.evaluate(checkRectsScript(), {
      ...vp,
      selectors: [
        'output', '.hud-me', '.sky-ui', '.render-entry', '.dock', '.hud-stats', 'footer', '.vehicle-action',
        '.walk-ui .joystick', '.walk-ui .btn-view',
        '.walk-ui .btn-wheelie', '.walk-ui .btn-gear-up', '.walk-ui .btn-gear-down', '.walk-ui .btn-tuck',
        '.ride-hud',
      ],
    })
    assert.deepEqual(relevantOverlaps(rideCheck.overlaps), [], `${label} riding HUD overlap: ${JSON.stringify(rideCheck.overlaps)}`)
    assert.deepEqual(rideCheck.outOfBounds, [], `${label} riding HUD outOfBounds: ${JSON.stringify(rideCheck.outOfBounds)}`)

    // Interactive touch controls: park toggle, gear-up, light toggle, joystick + wheelie hold
    await mp.evaluate(() => window.viewer.walk.tick(1 / 60))
    if (await mp.locator('.ride-park').evaluate(el => el.classList.contains('on'))) {
      await mp.locator('.ride-park').tap()
      await mp.evaluate(() => window.viewer.walk.tick(1 / 60))
    }
    await mp.locator('.ride-park').tap()
    await mp.evaluate(() => window.viewer.walk.tick(1 / 60))
    assert.equal(await mp.textContent('.ride-gear'), 'P')
    await mp.locator('.ride-park').tap()
    await mp.evaluate(() => window.viewer.walk.tick(1 / 60))

    await mp.locator('.walk-ui .btn-gear-up').tap()
    await mp.evaluate(() => window.viewer.walk.tick(1 / 60))
    assert.equal(await mp.textContent('.ride-gear'), 'D3')

    await mp.locator('.ride-light').tap()
    await mp.evaluate(() => window.viewer.walk.tick(1 / 60))
    const touchState = await mp.evaluate(() => {
      const {walk} = window.viewer
      const joy = document.querySelector('.walk-ui .joystick')
      const wBtn = document.querySelector('.walk-ui .btn-wheelie')
      const jr = joy.getBoundingClientRect()
      joy.dispatchEvent(new PointerEvent('pointerdown', {pointerId: 41, pointerType: 'touch', clientX: jr.left + jr.width / 2, clientY: jr.top + jr.height / 2, bubbles: true}))
      joy.dispatchEvent(new PointerEvent('pointermove', {pointerId: 41, pointerType: 'touch', clientX: jr.left + jr.width / 2, clientY: jr.top + jr.height * .15, bubbles: true}))
      for (let i = 0; i < 40; i++) walk.tick(1 / 60)
      wBtn.dispatchEvent(new PointerEvent('pointerdown', {pointerId: 42, pointerType: 'touch', bubbles: true}))
      for (let i = 0; i < 40; i++) walk.tick(1 / 60)
      const p = walk.probe()
      wBtn.dispatchEvent(new PointerEvent('pointerup', {pointerId: 42, pointerType: 'touch', bubbles: true}))
      joy.dispatchEvent(new PointerEvent('pointerup', {pointerId: 41, pointerType: 'touch', bubbles: true}))
      return {wheelie: p.ebike?.wheelie ?? 0, hl: p.ebike?.headlight, speed: walk.speed}
    })
    assert(touchState.wheelie > 0.15 && touchState.speed > 2, `${label} touch wheelie/drive failed: ${JSON.stringify(touchState)}`)
    await mp.screenshot({path: `${OUT_DIR}/mobile-${label}-ride.png`})
    await ctx.close()
  }

  assert.deepEqual(errors, [], `Uncaught page errors: ${JSON.stringify(errors)}`)
  console.log('verify:ride:stunt ALL PASSED', JSON.stringify({counts: bikeCounts, metrics}))
} finally {
  await browser?.close()
  await server.close()
}
