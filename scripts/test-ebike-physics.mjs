import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const SHOTS_DIR = '/tmp/hy4-ebike-physics-shots'
const STRICT_PHYSICS = process.argv.includes('--strict-physics')
const STRICT_V2 = process.argv.includes('--strict-v2') || process.env.STRICT_TWOWHEEL_V2 === '1'

const assert = (cond, msg) => { if (!cond) throw Error(`Assertion failed: ${msg}`) }
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a))

function readV2Telemetry(eb) {
  if (!eb) return {}
  const pick = keys => {
    for (const k of keys) if (eb[k] !== undefined && eb[k] !== null) return eb[k]
    return undefined
  }
  return {
    fatalLeanRad: pick(['mandatoryFallLeanRad', 'effectiveFallLeanRad', 'fatalLeanRad', 'leanLimit']),
    leanRateDegPerSec: pick(['leanRateDegPerSec']),
    leanDangerRatio: pick(['leanDangerRatio', 'leanWarning']),
    parked: pick(['parkLocked', 'parkGear', 'parked', 'pGear', 'isParked', 'parkLock']),
    kickstand: pick(['kickstandDown', 'kickstand', 'sideStand', 'sideStandDown']),
    headlight: pick(['headlight', 'headlightMode', 'lightMode', 'light']),
    taillight: pick(['taillight', 'tailLight']),
    brakeLight: pick(['brakeLight', 'brakeLamp', 'tailBrake']),
    turnSignal: pick(['turnSignal', 'blinker', 'indicator']),
    leftSignalLit: pick(['leftSignalLit']),
    rightSignalLit: pick(['rightSignalLit']),
    hazard: pick(['hazard', 'hazardLights', 'doubleFlash']),
    cruise: pick(['cruiseControl', 'cruise', 'cruiseActive']),
    cruiseKmh: pick(['cruiseTargetKmh', 'cruiseKmh']),
    hornCount: pick(['hornSeq', 'hornCount', 'hornTriggers']),
    hornActive: pick(['hornActive', 'honking', 'horn']),
  }
}

async function releaseParkIfLocked(page) {
  await page.evaluate(() => {
    const {walk} = window.viewer
    const eb = walk.probe()?.ebike
    if (!eb) return
    if (eb.parkLocked || eb.parkGear || eb.parked || eb.pGear || eb.isParked || eb.parkLock) {
      walk.ebike.setPark?.(false) ?? walk.ebike.togglePark?.()
    }
    if (eb.kickstand || eb.kickstandDown || eb.sideStand || eb.sideStandDown) {
      walk.ebike.setKickstand?.(false) ?? walk.ebike.toggleKickstand?.()
    }
  })
}

async function stepTicks(page, count, dt = 0.05) {
  return page.evaluate(({count, dt}) => {
    const fn = window.__advanceWalk ?? window.viewer.walk.tick
    for (let i = 0; i < count; i++) fn(dt)
    const w = window.viewer.walk
    return {
      speed: w.speed,
      heading: w.heading,
      obstacle: w.obstacle,
      vehicle: w.vehicle,
      probe: w.probe(),
      ebike: w.ebike.state,
    }
  }, {count, dt})
}

async function steerTowardPoint(page, tx, tz, stopAfter = true, maxSteps = 90, arrivalDist = 0) {
  for (let i = 0; i < maxSteps; i++) {
    const snap = await stepTicks(page, 1, 0.05)
    if (snap.probe?.twoWheelFlow === 'crashed') break
    const err = wrapAngle(Math.atan2(-(tx - snap.probe.x), -(tz - snap.probe.z)) - snap.heading)
    const dist = Math.hypot(tx - snap.probe.x, tz - snap.probe.z)
    if (snap.obstacle && Math.abs(snap.speed) < 0.25) {
      await page.keyboard.up('KeyW')
      await page.keyboard.down('KeyS')
      await page.keyboard[err >= 0 ? 'down' : 'up']('KeyA')
      await page.keyboard[err < 0 ? 'down' : 'up']('KeyD')
      await stepTicks(page, 22, 0.05)
      await page.keyboard.up('KeyS')
      await page.keyboard.up('KeyA')
      await page.keyboard.up('KeyD')
      await stepTicks(page, 4, 0.05)
      continue
    }
    const closeEnough = arrivalDist > 0 ? dist <= arrivalDist : true
    if (!snap.obstacle && closeEnough && Math.abs(err) < 0.08 && (!stopAfter || snap.speed < 0.25)) break
    if (dist < Math.max(4, arrivalDist) && !stopAfter) break
    const needTurn = Math.abs(err) > 0.25
    await page.keyboard[needTurn && snap.speed > 3.2 ? 'up' : 'down']('KeyW')
    await page.keyboard[err > 0.05 ? 'down' : 'up']('KeyA')
    await page.keyboard[err < -0.05 ? 'down' : 'up']('KeyD')
    await stepTicks(page, 2, 0.05)
  }
  await page.keyboard.up('KeyA')
  await page.keyboard.up('KeyD')
  await page.keyboard.up('KeyW')
  if (stopAfter) {
    await page.keyboard.down('KeyS')
    for (let i = 0; i < 24; i++) {
      const snap = await stepTicks(page, 1, 0.05)
      if (Math.abs(snap.speed) < 0.15) break
    }
    await page.keyboard.up('KeyS')
    await stepTicks(page, 6, 0.05)
  }
}

async function pingPongEndpoint(page) {
  const p = await page.evaluate(() => window.viewer.walk.probe())
  // Clear 330m open Jiefang East Road segment from ride-path.json: (-511,-70) <-> (-197,37)
  return p.x < -360 ? [-197, 37] : [-511, -70]
}

async function mountNearestBike(page) {
  await page.waitForFunction(
    () => window.viewer?.walk?.active && window.viewer.walk.parked('bike').length > 0,
    null,
    {timeout: 60000},
  )
  await page.evaluate(async () => {
    const {walk} = window.viewer
    const bikes = walk.parked('bike')
    const target = bikes.find(b => Math.hypot(b[0] + 539, b[2] + 95) < 16) ?? bikes[0]
    await walk.enter(target[0] + 1.0, target[2] + 1.0, Math.atan2(-(target[0] - (target[0] + 1.0)), -(target[2] - (target[2] + 1.0))))
  })
  await stepTicks(page, 8, 0.05)
  await page.keyboard.press('KeyF')
  await stepTicks(page, 20, 0.05)
  const mounted = await page.evaluate(() => ({
    vehicle: window.viewer.walk.vehicle,
    probe: window.viewer.walk.probe(),
  }))
  assert(mounted.vehicle === 'bike', `Expected vehicle=bike after KeyF, got ${mounted.vehicle}`)
  await releaseParkIfLocked(page)
  await stepTicks(page, 2, 0.05)
}

await mkdir(SHOTS_DIR, {recursive: true})
const server = await preview({
  root: resolve(ROOT, 'web'),
  configFile: resolve(ROOT, 'web/vite.config.ts'),
  build: {outDir: resolve(ROOT, 'dist')},
  preview: {host: '127.0.0.1', port: 0},
})

let browser
let page
try {
  browser = await chromium.launch(browserOptions(true))
  const context = await browser.newContext({viewport: {width: 1280, height: 720}})
  page = await context.newPage()
  const errors = []
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`))
  page.on('console', msg => {
    if (msg.type() !== 'error') return
    const txt = msg.text()
    // Streaming tile aborts during rapid multi-district teleports can close a localhost keep-alive socket.
    if (/Failed to load resource: net::ERR_(CONNECTION_CLOSED|ABORTED)/.test(txt)) return
    errors.push(`console: ${txt}`)
  })

  const port = server.httpServer.address().port
  await page.route('**/favicon.ico', r => r.fulfill({status: 204}))
  await page.route('**/api/t', r => r.fulfill({status: 204}))
  await page.goto(`http://127.0.0.1:${port}/?verify&mode=walk&flow=0&time=10`, {waitUntil: 'domcontentloaded'})
  await mountNearestBike(page)

  // Pause RAF walk loop while running deterministic fixed-dt steps
  await page.evaluate(() => {
    const w = window.viewer.walk
    window.__advanceWalk = w.tick
    w.tick = () => {}
  })

  // 1. HUD baseline + normal/shared badge & battery + gear switching
  await page.evaluate(() => window.viewer.walk.ebike.setVehicleType('normal'))
  await stepTicks(page, 1, 0.05)
  const hudInit = await page.evaluate(() => ({
    visible: getComputedStyle(document.querySelector('.ride-hud')).display !== 'none',
    type: document.querySelector('.ride-type')?.textContent,
    gear: document.querySelector('.ride-gear')?.textContent,
    speed: document.querySelector('.ride-speed')?.textContent,
    bat: document.querySelector('.ride-bat-pct')?.textContent,
    mod: document.querySelector('.ride-mod')?.textContent,
  }))
  assert(
    hudInit.visible && hudInit.type === '电摩' && hudInit.gear === 'D2' && hudInit.bat === '100%' && hudInit.mod === '素车',
    `Bad init HUD: ${JSON.stringify(hudInit)}`,
  )

  // Keep auto-crash off while reversing/U-turning for pure gear top-speed & coasting benchmarks,
  // then turn real auto-crash ON for wheelie loopout, sharp-steer lowside, wall impact, and bicycle crashes.
  await page.evaluate(() => window.viewer.walk.ebike.setAutoCrash(false))

  // Move smoothly onto clear Jiefang East Road (-511,-70) before running speed/coast/stunt checks
  await steerTowardPoint(page, -511, -70, false, 60)

  async function finishCrashStandAndPickup(page, expectedPrompt) {
    await page.keyboard.up('KeyW')
    await page.keyboard.up('KeyA')
    await page.keyboard.up('KeyD')
    await page.keyboard.up('ShiftLeft')
    await page.keyboard.up('Space')
    await stepTicks(page, 8, 0.05) // pass 0.28s slide
    await page.keyboard.press('Space')
    await stepTicks(page, 4, 0.05)
    const risingSnap = await page.evaluate(() => window.viewer.walk.probe())
    assert(risingSnap.twoWheelFlow === 'standing_up' && risingSnap.downedCount >= 1, `Expected standing_up while bike stays down, got ${risingSnap.twoWheelFlow}`)
    assert(Math.abs(risingSnap.downedBikes[0].roll) > 1.3, `Bike must stay lying sideways while rider stands up! roll=${risingSnap.downedBikes[0].roll}`)
    await stepTicks(page, 18, 0.05) // finish 0.68s stand-up -> foot
    let stoodSnap = await page.evaluate(() => ({probe: window.viewer.walk.probe(), btn: document.querySelector('.vehicle-action')?.textContent}))
    assert(stoodSnap.probe.twoWheelFlow === 'foot' && stoodSnap.probe.downedCount >= 1, `Expected foot flow after stand-up: ${JSON.stringify(stoodSnap)}`)
    assert(Math.abs(stoodSnap.probe.downedBikes[0].roll) > 1.3, 'Bike must stay lying sideways after rider gets up')
    if (stoodSnap.probe.downedBikes[0].dist > 2.4) {
      await page.evaluate(() => {
        const {walk} = window.viewer
        const stepFn = window.__advanceWalk ?? walk.tick
        const tgt = walk.probe().downedBikes[0]
        if (tgt) {
          walk.face(Math.atan2(-(tgt.x - walk.probe().x), -(tgt.z - walk.probe().z)), .28)
          window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
          for (let i = 0; i < 160; i++) {
            stepFn(0.05)
            if ((walk.probe().downedBikes[0]?.dist ?? 99) <= 2.2) break
          }
          window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
          stepFn(0.05)
        }
      })
      stoodSnap = await page.evaluate(() => ({probe: window.viewer.walk.probe(), btn: document.querySelector('.vehicle-action')?.textContent}))
    }
    assert(stoodSnap.btn?.includes(expectedPrompt), `Expected ${expectedPrompt}, got ${stoodSnap.btn} (dist=${stoodSnap.probe.downedBikes[0]?.dist})`)
    await page.keyboard.press('KeyF')
    await stepTicks(page, 2, 0.05)
    const pickingSnap = await page.evaluate(() => window.viewer.walk.probe())
    assert(pickingSnap.twoWheelFlow === 'picking_up', `Expected picking_up after KeyF, got ${pickingSnap.twoWheelFlow}`)
    await stepTicks(page, 18, 0.05)
    const uprightSnap = await page.evaluate(() => window.viewer.walk.probe())
    assert(uprightSnap.downedCount === 0 && uprightSnap.twoWheelFlow === 'foot', `Bike pickup did not clear downed state: ${JSON.stringify(uprightSnap)}`)
    await page.keyboard.press('KeyF')
    await stepTicks(page, 12, 0.05)
    const remountInfo = await page.evaluate(() => ({
      vehicle: window.viewer.walk.vehicle,
      btn: document.querySelector('.vehicle-action')?.textContent,
      btnHidden: document.querySelector('.vehicle-action')?.hidden,
      toast: document.querySelector('.toast')?.textContent,
      pos: [window.viewer.walk.probe().x, window.viewer.walk.probe().foot, window.viewer.walk.probe().z],
    }))
    assert(remountInfo.vehicle === 'bike' || remountInfo.vehicle === 'bicycle', `Expected remount, got ${JSON.stringify(remountInfo)}`)
  }

  const gearResults = {}
  const gearOrder = [
    ['Digit1', 'D1'],
    ['Digit2', 'D2'],
    ['Digit3', 'D3'],
    ['Digit4', 'S'],
  ]
  for (const [digitKey, label] of gearOrder) {
    const [tx, tz] = await pingPongEndpoint(page)
    await steerTowardPoint(page, tx, tz, true, 60)
    await page.keyboard.press(digitKey)
    await stepTicks(page, 2, 0.05)
    await page.keyboard.down('KeyW')
    let peakSpeed = 0
    let endSnap
    for (let i = 0; i < 36; i++) {
      endSnap = await stepTicks(page, 2, 0.05)
      if (endSnap.speed > peakSpeed) peakSpeed = endSnap.speed
      if (endSnap.probe?.twoWheelFlow === 'crashed') {
        await finishCrashStandAndPickup(page, '扶起电动车')
        await page.keyboard.press(digitKey)
        await stepTicks(page, 2, 0.05)
      }
    }
    await page.keyboard.up('KeyW')
    const hudGear = await page.locator('.ride-gear').textContent()
    assert(hudGear === label, `Expected HUD gear ${label}, got ${hudGear}`)
    gearResults[label] = {
      peakMs: Number(peakSpeed.toFixed(2)),
      peakKmh: Math.round(peakSpeed * 3.6),
      hudKmh: await page.locator('.ride-speed').textContent(),
      obstacle: endSnap.obstacle,
    }
  }

  // Verify KeyE / KeyQ relative shifting
  await page.keyboard.press('Digit2')
  await stepTicks(page, 1, 0.05)
  assert((await page.locator('.ride-gear').textContent()) === 'D2', 'Digit2 should select D2')
  await page.keyboard.press('KeyE')
  await stepTicks(page, 1, 0.05)
  assert((await page.locator('.ride-gear').textContent()) === 'D3', 'KeyE should upshift D2->D3')
  await page.keyboard.press('KeyQ')
  await stepTicks(page, 1, 0.05)
  assert((await page.locator('.ride-gear').textContent()) === 'D2', 'KeyQ should downshift D3->D2')

  // 2. Coasting inertia check
  const [txCoast, tzCoast] = await pingPongEndpoint(page)
  await steerTowardPoint(page, txCoast, tzCoast, true, 60)
  await page.keyboard.down('KeyW')
  for (let i = 0; i < 20; i++) await stepTicks(page, 2, 0.05)
  const v0 = (await stepTicks(page, 1, 0.05)).speed
  await page.keyboard.up('KeyW')
  const vAfter03s = (await stepTicks(page, 6, 0.05)).speed
  const vAfter08s = (await stepTicks(page, 10, 0.05)).speed
  const vAfter15s = (await stepTicks(page, 14, 0.05)).speed
  const coastStats = {
    v0: Number(v0.toFixed(2)),
    v03: Number(vAfter03s.toFixed(2)),
    v08: Number(vAfter08s.toFixed(2)),
    v15: Number(vAfter15s.toFixed(2)),
  }
  assert(v0 > 3.5 && vAfter03s < v0, `Coasting check failed: ${JSON.stringify(coastStats)}`)

  // 3. Real Wheelie loopout auto-crash + Ghostfire mod visual
  await page.evaluate(() => window.viewer.walk.ebike.setMod('ghostfire'))
  await page.click('.ride-gear-btn[data-gear="3"]')
  await stepTicks(page, 1, 0.05)
  const [txWh, tzWh] = await pingPongEndpoint(page)
  await steerTowardPoint(page, txWh, tzWh, true, 60)
  await page.evaluate(() => window.viewer.walk.ebike.setAutoCrash(true))
  await page.keyboard.down('KeyW')
  await stepTicks(page, 16, 0.05)
  await page.keyboard.down('Space')
  let peakWheelie = 0
  let loopoutCrash = false
  let wheelieStateText = ''
  for (let i = 0; i < 36; i++) {
    const snap = await stepTicks(page, 2, 0.05)
    peakWheelie = Math.max(peakWheelie, snap.ebike?.wheelie ?? 0, snap.probe?.ebikeRig?.wheelie ?? 0)
    const st = await page.locator('.ride-state').textContent()
    if (st) wheelieStateText = st
    if (snap.probe?.twoWheelFlow === 'crashed' && snap.ebike?.crashReason === 'loopout') {
      loopoutCrash = true
      break
    }
  }
  await page.screenshot({path: `${SHOTS_DIR}/wheelie-ghostfire.png`})
  await page.keyboard.up('Space')
  await page.keyboard.up('KeyW')
  assert(peakWheelie > 0.18, `Wheelie pitch too small: ${peakWheelie}`)
  if (loopoutCrash) {
    await finishCrashStandAndPickup(page, '扶起电动车')
  } else {
    await stepTicks(page, 12, 0.05)
  }

  // 4. Speed-scaled lean rate, low-speed controllability, non-tuck corner survival & fatal lean lowside boundary
  await page.evaluate(() => window.viewer.walk.ebike.setAutoCrash(false))
  const [txLow, tzLow] = await pingPongEndpoint(page)
  await steerTowardPoint(page, txLow, tzLow, true, 60)
  await page.click('.ride-gear-btn[data-gear="1"]')
  await page.evaluate(() => window.viewer.walk.ebike.setAutoCrash(true))
  await page.keyboard.down('KeyW')
  await stepTicks(page, 22, 0.05)
  await page.keyboard.down('KeyA')
  let lowSpeedLeanAt015 = 0
  let lowSpeedCrashed = false
  let maxLowLean = 0
  for (let i = 0; i < 48; i++) {
    const snap = await stepTicks(page, 1, 0.05)
    const lean = Math.abs(snap.probe?.ebikeRig?.lean ?? snap.ebike?.lean ?? 0)
    if (i === 2) lowSpeedLeanAt015 = lean
    if (lean > maxLowLean) maxLowLean = lean
    if (snap.probe?.twoWheelFlow === 'crashed') { lowSpeedCrashed = true; break }
  }
  await page.keyboard.up('KeyA')
  await page.keyboard.up('KeyW')
  if (lowSpeedCrashed) await finishCrashStandAndPickup(page, '扶起电动车')
  else await stepTicks(page, 10, 0.05)

  // Non-tuck D2 compliant full-lock turn should survive cleanly without false crash
  await page.evaluate(() => window.viewer.walk.ebike.setAutoCrash(false))
  const [txMid, tzMid] = await pingPongEndpoint(page)
  await steerTowardPoint(page, txMid, tzMid, true, 60)
  await page.click('.ride-gear-btn[data-gear="2"]')
  await stepTicks(page, 1, 0.05)
  await page.evaluate(() => window.viewer.walk.ebike.setAutoCrash(true))
  await page.keyboard.down('KeyW')
  await stepTicks(page, 32, 0.05)
  await page.keyboard.down('KeyA')
  let maxLeftLean = 0
  let midLeanAt015 = 0
  let d2NonTuckCrashed = false
  for (let i = 0; i < 40; i++) {
    const snap = await stepTicks(page, 1, 0.05)
    const lean = snap.probe?.ebikeRig?.lean ?? snap.ebike?.lean ?? 0
    if (i === 2) midLeanAt015 = Math.abs(lean)
    if (Math.abs(lean) > Math.abs(maxLeftLean)) maxLeftLean = lean
    if (snap.probe?.twoWheelFlow === 'crashed') { d2NonTuckCrashed = true; break }
  }
  await page.keyboard.up('KeyA')
  await page.keyboard.up('KeyW')
  if (d2NonTuckCrashed) await finishCrashStandAndPickup(page, '扶起电动车')

  // High-speed D3 non-tuck turn check (re-center along Jiefang East Rd before facing west at (-539,-95) plaza)
  await page.evaluate(() => window.viewer.walk.ebike.setAutoCrash(false))
  await steerTowardPoint(page, -445, -48, false, 140, 12)
  await steerTowardPoint(page, -539, -95, true, 180, 6)
  await steerTowardPoint(page, -610, -110, true, 24)
  await page.click('.ride-gear-btn[data-gear="3"]')
  await stepTicks(page, 1, 0.05)
  await page.evaluate(() => window.viewer.walk.ebike.setAutoCrash(true))
  await page.keyboard.down('KeyW')
  await stepTicks(page, 30, 0.05)
  await page.keyboard.down('KeyA')
  let leftLeanAt015 = 0
  let nonTuckLeftCrashed = false
  for (let i = 0; i < 36; i++) {
    const snap = await stepTicks(page, 1, 0.05)
    const lean = snap.probe?.ebikeRig?.lean ?? snap.ebike?.lean ?? 0
    if (i === 2) leftLeanAt015 = Math.abs(lean)
    if (Math.abs(lean) > Math.abs(maxLeftLean)) maxLeftLean = lean
    if (snap.probe?.twoWheelFlow === 'crashed') { nonTuckLeftCrashed = true; break }
  }
  await page.keyboard.up('KeyA')
  await page.keyboard.up('KeyW')
  if (nonTuckLeftCrashed) await finishCrashStandAndPickup(page, '扶起电动车')

  // Deep-lean tuck in S gear past fatal lean angle triggers real lowside
  await page.evaluate(() => window.viewer.walk.ebike.setAutoCrash(false))
  await steerTowardPoint(page, -511, -70, false, 140, 3)
  await steerTowardPoint(page, -463, -54, false, 120, 3)
  await steerTowardPoint(page, -378, -25, true, 120, 3)
  await steerTowardPoint(page, -197, 37, true, 35)
  await page.click('.ride-gear-btn[data-gear="4"]')
  await page.evaluate(() => window.viewer.walk.ebike.setAutoCrash(true))
  await page.keyboard.down('KeyW')
  let fatalLeftLowside = false
  let leftCrashed = false
  let fatalLeftLean = 0
  for (let i = 0; i < 30; i++) {
    const snap = await stepTicks(page, 1, 0.05)
    if (snap.probe?.twoWheelFlow === 'crashed') {
      leftCrashed = true
      if (snap.ebike?.crashReason === 'lowside') {
        fatalLeftLowside = true
        fatalLeftLean = Math.abs(snap.ebike?.lean ?? 0)
      }
      break
    }
  }
  if (!leftCrashed) {
    await page.keyboard.down('ShiftLeft')
    await page.keyboard.down('KeyA')
    for (let i = 0; i < 40; i++) {
      const snap = await stepTicks(page, 1, 0.05)
      const lean = snap.probe?.ebikeRig?.lean ?? snap.ebike?.lean ?? 0
      if (Math.abs(lean) > Math.abs(maxLeftLean)) maxLeftLean = lean
      if (snap.probe?.twoWheelFlow === 'crashed') {
        leftCrashed = true
        if (snap.ebike?.crashReason === 'lowside') {
          fatalLeftLowside = true
          fatalLeftLean = Math.abs(snap.ebike?.lean ?? lean)
        }
        break
      }
    }
  }
  await page.screenshot({path: `${SHOTS_DIR}/lean-left.png`})
  await page.keyboard.up('KeyA')
  await page.keyboard.up('ShiftLeft')
  await page.keyboard.up('KeyW')
  if (leftCrashed) {
    await finishCrashStandAndPickup(page, '扶起电动车')
  }
  const leftLowside = fatalLeftLowside || nonTuckLeftCrashed

  await page.evaluate(() => window.viewer.walk.ebike.setAutoCrash(false))
  await steerTowardPoint(page, -445, -48, false, 120, 12)
  await steerTowardPoint(page, -197, 37, true, 35)
  await page.click('.ride-gear-btn[data-gear="4"]')
  await page.evaluate(() => window.viewer.walk.ebike.setAutoCrash(true))
  await page.keyboard.down('KeyW')
  await stepTicks(page, 30, 0.05)
  await page.keyboard.down('ShiftLeft')
  await page.keyboard.down('KeyD')
  let maxRightLean = 0
  let rightLowside = false
  for (let i = 0; i < 40; i++) {
    const snap = await stepTicks(page, 1, 0.05)
    const lean = snap.probe?.ebikeRig?.lean ?? snap.ebike?.lean ?? 0
    if (Math.abs(lean) > Math.abs(maxRightLean)) maxRightLean = lean
    if (snap.probe?.twoWheelFlow === 'crashed') {
      rightLowside = true
      break
    }
  }
  await page.keyboard.up('KeyD')
  await page.keyboard.up('ShiftLeft')
  await page.keyboard.up('KeyW')
  if (rightLowside) {
    await finishCrashStandAndPickup(page, '扶起电动车')
  }
  const lowLeanRate = +(lowSpeedLeanAt015 / 0.15).toFixed(2)
  const midLeanRate = +(midLeanAt015 / 0.15).toFixed(2)
  const highLeanRate = +(leftLeanAt015 / 0.15).toFixed(2)
  assert(
    Math.abs(maxLeftLean) > 0.12 && Math.abs(maxRightLean) > 0.12 && maxLeftLean * maxRightLean < 0,
    `Left/right lean must oppose & exceed 0.12 rad: left=${maxLeftLean}, right=${maxRightLean}`,
  )

  // 5. Full rider-first crash separation visual & safe non-clipping state
  await page.keyboard.down('KeyW')
  await stepTicks(page, 14, 0.05)
  await page.keyboard.up('KeyW')
  await page.evaluate(() => window.viewer.walk.ebike.triggerCrash('lowside', 1))
  const crashedSnap = await stepTicks(page, 14, 0.05)
  assert(crashedSnap.probe?.twoWheelFlow === 'crashed', `Expected crashed phase, got ${crashedSnap.probe?.twoWheelFlow}`)
  assert(!crashedSnap.probe.inHouse && !crashedSnap.probe.wet, `Crashed clipped inHouse=${crashedSnap.probe.inHouse} wet=${crashedSnap.probe.wet}`)
  await page.screenshot({path: `${SHOTS_DIR}/crash-lowside.png`})
  await finishCrashStandAndPickup(page, '扶起电动车')

  // 6. Mod cycle KeyG + HUD click + battery/shared distinction + compliant D2 reset on remount + clean dismount KeyF
  await page.evaluate(() => window.viewer.walk.ebike.setAutoCrash(false))
  await steerTowardPoint(page, -463, -54, true, 140, 3)
  await page.keyboard.press('KeyG')
  await stepTicks(page, 1, 0.05)
  const modAfterG = await page.locator('.ride-mod').textContent()
  await page.locator('.ride-mod').click()
  await stepTicks(page, 1, 0.05)
  const modAfterClick = await page.locator('.ride-mod').textContent()
  assert(modAfterG !== modAfterClick, `Mod cycle failed: ${modAfterG} -> ${modAfterClick}`)
  await page.screenshot({path: `${SHOTS_DIR}/mod-neon.png`})

  // Battery HUD critical state + shared vehicle mode hiding mod slots
  await page.evaluate(() => window.viewer.walk.ebike.setBattery(10))
  await stepTicks(page, 1, 0.05)
  const lowBatState = await page.locator('.ride-state').textContent()
  assert(lowBatState?.includes('极低电'), `Expected critical battery warning at 10%, got ${lowBatState}`)
  await page.evaluate(() => window.viewer.walk.ebike.setBattery(100))
  await page.evaluate(() => window.viewer.walk.ebike.setVehicleType('shared'))
  await stepTicks(page, 1, 0.05)
  const sharedHud = await page.evaluate(() => ({
    type: document.querySelector('.ride-type')?.textContent,
    modHidden: getComputedStyle(document.querySelector('.ride-mod')).display === 'none',
  }))
  assert(sharedHud.type === '共享' && sharedHud.modHidden, `Shared HUD check failed: ${JSON.stringify(sharedHud)}`)
  await page.evaluate(() => window.viewer.walk.ebike.setVehicleType('normal'))
  await page.keyboard.press('Digit4')
  await stepTicks(page, 1, 0.05)
  assert((await page.locator('.ride-gear').textContent()) === 'S', 'Expected gear S before dismount')

  await page.keyboard.press('KeyF')
  const dismountSnap = await stepTicks(page, 12, 0.05)
  const hudHiddenAfterDismount = await page.evaluate(() => getComputedStyle(document.querySelector('.ride-hud')).display === 'none')
  assert(dismountSnap.vehicle === 'foot' && hudHiddenAfterDismount, `Dismount failed: vehicle=${dismountSnap.vehicle}, hudHidden=${hudHiddenAfterDismount}`)
  assert(!dismountSnap.probe.inHouse && !dismountSnap.probe.wet, 'Dismount landed inside house or water')

  // Remount verifies compliant D2 (<=25 km/h) reset
  await page.keyboard.press('KeyF')
  await stepTicks(page, 18, 0.05)
  const remountGear = await page.locator('.ride-gear').textContent()
  assert(remountGear === 'D2', `Expected compliant D2 reset on remount, got ${remountGear}`)
  await page.keyboard.press('KeyF')
  await stepTicks(page, 12, 0.05)

  // 7. Wall impact crash test at parked bike (-1610.8, 425) -> building wall (-1606.2, 418.7)
  await page.evaluate(async () => {
    const {walk} = window.viewer
    const target = [...walk.parked('bike')].sort((a, b) => Math.hypot(a[0] + 1610.8, a[2] - 425) - Math.hypot(b[0] + 1610.8, b[2] - 425))[0]
    await walk.enter(target[0] + 1.0, target[2] + 1.0, Math.atan2(-(target[0] - (target[0] + 1.0)), -(target[2] - (target[2] + 1.0))))
  })
  await stepTicks(page, 8, 0.05)
  await page.keyboard.press('KeyF')
  await stepTicks(page, 20, 0.05)
  assert((await page.evaluate(() => window.viewer.walk.vehicle)) === 'bike', 'Expected bike for wall test')
  await page.evaluate(() => window.viewer.walk.ebike.setAutoCrash(false))
  // Aim toward wall (-1606.2, 418.7) at gentle speed, then accelerate straight with autoCrash ON
  await steerTowardPoint(page, -1606.2, 418.7, false, 10)
  await page.evaluate(() => window.viewer.walk.ebike.setAutoCrash(true))
  await page.keyboard.down('KeyW')
  let sawObstacle = ''
  let impactCrash = false
  for (let i = 0; i < 65; i++) {
    const snap = await stepTicks(page, 2, 0.05)
    assert(!snap.probe.inHouse, `Bike clipped inside building during collision! pos=${snap.probe.x},${snap.probe.z}`)
    if (snap.obstacle) sawObstacle = snap.obstacle
    if (snap.probe?.twoWheelFlow === 'crashed' && snap.ebike?.crashReason === 'impact') {
      impactCrash = true
      break
    }
    if (sawObstacle && snap.speed < 0.25 && i > 10) break
  }
  await page.keyboard.up('KeyW')
  if (impactCrash) {
    await finishCrashStandAndPickup(page, '扶起电动车')
  }
  if ((await page.evaluate(() => window.viewer.walk.vehicle)) === 'bike') {
    await page.keyboard.press('KeyF')
    await stepTicks(page, 12, 0.05)
  }

  // 8. Real Bicycle test on open road: low-speed 1挡 stability + visible 1挡/2挡/3挡 HUD + deep-tuck fatal crash + rider-first pickup
  await page.evaluate(async () => {
    const {walk} = window.viewer
    const bc = [...walk.parked('bicycle')].sort((a, b) => Math.hypot(a[0] - 585, a[2] - 1384) - Math.hypot(b[0] - 585, b[2] - 1384))[0]
    await walk.enter(bc[0] + 1.0, bc[2] + 1.0, Math.atan2(-(bc[0] - (bc[0] + 1.0)), -(bc[2] - (bc[2] + 1.0))))
  })
  await stepTicks(page, 8, 0.05)
  await page.keyboard.press('KeyF')
  await stepTicks(page, 20, 0.05)
  assert((await page.evaluate(() => window.viewer.walk.vehicle)) === 'bicycle', 'Expected mounted bicycle')
  assert((await page.locator('.ride-gear').textContent()) === '2挡', 'Expected bicycle default 2挡')
  await page.evaluate(() => window.viewer.walk.ebike.setAutoCrash(false))
  await steerTowardPoint(page, 592, 1392, true, 60)
  await steerTowardPoint(page, 636, 1392, true, 70)
  const bicycleGearPeaks = {}
  for (const [g, lbl, tgtX, tgtZ] of [[1, '1挡', 710, 1392], [3, '3挡', 592, 1392]]) {
    await steerTowardPoint(page, tgtX, tgtZ, true, 50)
    await page.click(`.ride-gear-btn[data-gear="${g}"]`)
    await stepTicks(page, 2, 0.05)
    assert((await page.locator('.ride-gear').textContent()) === lbl, `Expected bicycle gear ${lbl}`)
    await page.keyboard.down('KeyW')
    let pk = 0
    for (let i = 0; i < 45; i++) {
      const s = await stepTicks(page, 2, 0.05)
      if (s.speed > pk) pk = s.speed
    }
    await page.keyboard.up('KeyW')
    bicycleGearPeaks[lbl] = +(pk * 3.6).toFixed(1)
  }

  // Low-speed 1挡 stability check on open multi-lane center road
  await steerTowardPoint(page, 636, 1398, true, 60)
  await steerTowardPoint(page, 580, 1398, false, 12)
  await page.click('.ride-gear-btn[data-gear="1"]')
  await stepTicks(page, 1, 0.05)
  await page.evaluate(() => window.viewer.walk.ebike.setAutoCrash(true))
  await page.keyboard.down('KeyW')
  let bicycleLowSpeedCrashed = false
  for (let i = 0; i < 20; i++) {
    const s = await stepTicks(page, 1, 0.05)
    if (s.probe?.twoWheelFlow === 'crashed') { bicycleLowSpeedCrashed = true; break }
  }
  if (!bicycleLowSpeedCrashed) {
    await page.keyboard.down('KeyA')
    for (let i = 0; i < 40; i++) {
      const s = await stepTicks(page, 1, 0.05)
      if (s.probe?.twoWheelFlow === 'crashed') { bicycleLowSpeedCrashed = true; break }
    }
    await page.keyboard.up('KeyA')
  }
  await page.keyboard.up('KeyW')
  if (bicycleLowSpeedCrashed) await finishCrashStandAndPickup(page, '扶起单车')
  await page.evaluate(() => window.viewer.walk.ebike.setAutoCrash(false))

  // 3挡 deep-tuck fatal lowside check on open multi-lane center road
  await steerTowardPoint(page, 636, 1398, true, 60)
  await steerTowardPoint(page, 580, 1398, false, 12)
  await page.click('.ride-gear-btn[data-gear="3"]')
  await stepTicks(page, 1, 0.05)
  await page.evaluate(() => window.viewer.walk.ebike.setAutoCrash(true))
  await page.keyboard.down('KeyW')
  await stepTicks(page, 38, 0.05) // accelerate > 5 m/s in 3挡 along open multi-lane center road
  await page.keyboard.down('ShiftLeft')
  await page.keyboard.down('KeyD')
  let bicycleLowside = false
  for (let i = 0; i < 40; i++) {
    const s = await stepTicks(page, 1, 0.05)
    if (s.probe?.twoWheelFlow === 'crashed') { bicycleLowside = true; break }
  }
  await page.keyboard.up('KeyD')
  await page.keyboard.up('ShiftLeft')
  await page.keyboard.up('KeyW')
  await stepTicks(page, 6, 0.05)
  await page.screenshot({path: `${SHOTS_DIR}/bicycle-crash.png`})
  if (bicycleLowside) {
    await finishCrashStandAndPickup(page, '扶起单车')
  }
  await page.keyboard.press('KeyF')
  await stepTicks(page, 12, 0.05)

  // 9. V2 Real E-bike features probe (P-gear, kickstand, lights, turn signals, hazard, horn, cruise)
  await page.evaluate(async () => { await window.viewer.walk.enter(-539, -95) })
  await stepTicks(page, 12, 0.05)
  await mountNearestBike(page)
  const v2State0 = await page.evaluate(() => window.viewer.walk.probe()?.ebike)
  const v2Init = readV2Telemetry(v2State0)
  const hasV2Proto = v2Init.parked !== undefined && v2Init.headlight !== undefined && v2Init.turnSignal !== undefined
  const v2Checks = {
    lowSpeedNoFalseCrash: !lowSpeedCrashed,
    d2CompliantNoFalseCrash: !d2NonTuckCrashed,
    bicycleLowSpeedNoFalseCrash: !bicycleLowSpeedCrashed,
    nonTuckTurnSurvived: !nonTuckLeftCrashed,
    speedScaledLeanRate: highLeanRate > lowLeanRate * 1.35,
    fatalLeanLowside: fatalLeftLowside,
    pGearBlocksThrottle: false,
    kickstandBlocksThrottle: false,
    lightAndBrakeCycle: false,
    turnAndHazard: false,
    hornAndCruise: false,
  }
  if (hasV2Proto) {
    await page.evaluate(() => window.viewer.walk.ebike.setPark?.(true))
    await stepTicks(page, 2, 0.05)
    await page.keyboard.down('KeyW')
    const pSpd = (await stepTicks(page, 10, 0.05)).speed
    await page.keyboard.up('KeyW')
    const pKick = readV2Telemetry(await page.evaluate(() => window.viewer.walk.probe().ebike)).kickstand
    await page.evaluate(() => window.viewer.walk.ebike.setPark?.(false))
    await stepTicks(page, 2, 0.05)
    v2Checks.pGearBlocksThrottle = pSpd === 0
    v2Checks.kickstandBlocksThrottle = Boolean(pKick) && pSpd === 0

    if (await page.evaluate(() => typeof window.viewer?.walk?.ebike?.setKickstand === 'function')) {
      await page.evaluate(() => window.viewer.walk.ebike.setKickstand?.(true))
      await stepTicks(page, 2, 0.05)
      await page.keyboard.down('KeyW')
      const ksSpd = (await stepTicks(page, 10, 0.05)).speed
      await page.keyboard.up('KeyW')
      await page.evaluate(() => window.viewer.walk.ebike.setKickstand?.(false))
      v2Checks.kickstandBlocksThrottle = ksSpd === 0
    }

    const lightSeq = []
    for (let i = 0; i < 4; i++) {
      lightSeq.push(readV2Telemetry(await page.evaluate(() => window.viewer.walk.probe().ebike)).headlight)
      await page.evaluate(() => window.viewer.walk.ebike.cycleHeadlight?.() ?? window.viewer.walk.ebike.cycleLight?.())
      await stepTicks(page, 1, 0.05)
    }
    await page.keyboard.down('KeyW')
    await stepTicks(page, 16, 0.05)
    await page.keyboard.up('KeyW')
    await page.keyboard.down('KeyS')
    const brkSnap = readV2Telemetry((await stepTicks(page, 2, 0.05)).ebike)
    await page.keyboard.up('KeyS')
    v2Checks.lightAndBrakeCycle = new Set(lightSeq.slice(0, 3)).size === 3 && brkSnap.brakeLight === true

    await page.evaluate(() => window.viewer.walk.ebike.setTurnSignal?.('left'))
    const tsL = readV2Telemetry((await stepTicks(page, 2, 0.05)).ebike).turnSignal
    await page.evaluate(() => window.viewer.walk.ebike.setHazard?.(true))
    const hzOn = readV2Telemetry((await stepTicks(page, 2, 0.05)).ebike).hazard === true
    await page.evaluate(() => { window.viewer.walk.ebike.setHazard?.(false); window.viewer.walk.ebike.setTurnSignal?.('off') })
    v2Checks.turnAndHazard = tsL === 'left' && hzOn

    const h0 = readV2Telemetry((await stepTicks(page, 1, 0.05)).ebike).hornCount ?? 0
    await page.evaluate(() => window.viewer.walk.ebike.pulseHorn?.() ?? window.viewer.walk.ebike.honk?.() ?? window.viewer.walk.ebike.triggerHorn?.())
    const h1 = readV2Telemetry((await stepTicks(page, 1, 0.05)).ebike).hornCount ?? 0
    await page.keyboard.down('KeyW')
    await stepTicks(page, 24, 0.05)
    await page.keyboard.up('KeyW')
    await page.evaluate(() => window.viewer.walk.ebike.setCruise?.(true))
    const cSnap = await stepTicks(page, 20, 0.05)
    const cHeld = readV2Telemetry(cSnap.ebike).cruise === true && cSnap.speed > 4.0
    await page.keyboard.down('KeyS')
    const cOff = readV2Telemetry((await stepTicks(page, 2, 0.05)).ebike).cruise === false
    await page.keyboard.up('KeyS')
    v2Checks.hornAndCruise = h1 > h0 && cHeld && cOff
  }
  await page.keyboard.press('KeyF')
  await stepTicks(page, 10, 0.05)

  const physicsChecks = {
    gearTopSpeedScaling: gearResults.S.peakKmh > gearResults.D3.peakKmh && gearResults.D3.peakKmh > gearResults.D2.peakKmh && gearResults.D2.peakKmh > gearResults.D1.peakKmh,
    bicycleGearTopSpeedScaling: bicycleGearPeaks['3挡'] > bicycleGearPeaks['1挡'] + 6,
    coastingInertiaTail: coastStats.v08 > 0.5,
    wheelieLoopoutAutoCrash: loopoutCrash,
    lowsideAutoCrash: leftLowside,
    bicycleLowsideAutoCrash: bicycleLowside,
    wallImpactAutoCrash: impactCrash,
  }
  const strictPass = Object.values(physicsChecks).every(Boolean)
  const v2Pass = Object.values(v2Checks).every(Boolean)
  assert(errors.length === 0, `Runtime errors: ${errors.join('; ')}`)
  console.log('EBIKE PHYSICS & HUD ACCEPTANCE REPORT:', JSON.stringify({
    gearResults,
    bicycleGearPeaks,
    coastStats,
    peakWheelieRad: Number(peakWheelie.toFixed(3)),
    wheelieStateText,
    maxLeftLeanRad: Number(maxLeftLean.toFixed(3)),
    maxRightLeanRad: Number(maxRightLean.toFixed(3)),
    lowLeanRateRadS: lowLeanRate,
    midLeanRateRadS: midLeanRate,
    highLeanRateRadS: highLeanRate,
    fatalLeftLeanRad: Number(fatalLeftLean.toFixed(3)),
    sawObstacle,
    modCycle: [hudInit.mod, modAfterG, modAfterClick],
    physicsChecks,
    v2Checks,
    strictPass,
    v2Pass,
  }, null, 2))
  if (STRICT_PHYSICS && !strictPass) {
    throw Error(`--strict-physics failed: ${JSON.stringify(physicsChecks)}`)
  }
  if (STRICT_V2 && !v2Pass) {
    throw Error(`--strict-v2 failed: ${JSON.stringify(v2Checks)}`)
  }
  console.log(STRICT_V2 ? 'STRICT V2 EBIKE PHYSICS PASS' : STRICT_PHYSICS ? 'STRICT EBIKE PHYSICS PASS' : 'EBIKE STANCE/HUD ACCEPTANCE PASS (physics integration telemetry recorded)')
} finally {
  await page?.evaluate(() => { if (window.__advanceWalk) window.viewer.walk.tick = window.__advanceWalk }).catch(() => {})
  await browser?.close()
  await server.close()
}
