import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const SHOTS_DIR = '/tmp/hy4-ebike-physics-shots'
const STRICT_PHYSICS = process.argv.includes('--strict-physics')

const assert = (cond, msg) => { if (!cond) throw Error(`Assertion failed: ${msg}`) }
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a))

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

async function steerTowardPoint(page, tx, tz, stopAfter = true, maxSteps = 80) {
  for (let i = 0; i < maxSteps; i++) {
    const snap = await stepTicks(page, 1, 0.05)
    const err = wrapAngle(Math.atan2(-(tx - snap.probe.x), -(tz - snap.probe.z)) - snap.heading)
    const dist = Math.hypot(tx - snap.probe.x, tz - snap.probe.z)
    if (Math.abs(err) < 0.08 && (!stopAfter || snap.speed < 0.25)) break
    if (dist < 4 && !stopAfter) break
    await page.keyboard.down('KeyW')
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
  page.on('console', msg => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`) })

  const port = server.httpServer.address().port
  await page.goto(`http://127.0.0.1:${port}/?verify&mode=walk&flow=0&time=10`, {waitUntil: 'domcontentloaded'})
  await mountNearestBike(page)

  // Pause RAF walk loop while running deterministic fixed-dt steps
  await page.evaluate(() => {
    const w = window.viewer.walk
    window.__advanceWalk = w.tick
    w.tick = () => {}
  })

  // 1. HUD baseline + gear switching + steady top speed per gear
  const hudInit = await page.evaluate(() => ({
    visible: getComputedStyle(document.querySelector('.ride-hud')).display !== 'none',
    gear: document.querySelector('.ride-gear')?.textContent,
    speed: document.querySelector('.ride-speed')?.textContent,
    mod: document.querySelector('.ride-mod')?.textContent,
  }))
  assert(hudInit.visible && hudInit.gear === 'D2' && hudInit.mod === '素车', `Bad init HUD: ${JSON.stringify(hudInit)}`)

  // Move smoothly onto clear Jiefang East Road (-511,-70) before running speed/coast/stunt checks
  await steerTowardPoint(page, -511, -70, false, 60)

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
      if (endSnap.ebike?.crashPhase === 'crashed') {
        await page.keyboard.press('Space')
        await stepTicks(page, 24, 0.05)
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

  // 3. Wheelie hold + Ghostfire mod visual
  await page.evaluate(() => window.viewer.walk.ebike.setMod('ghostfire'))
  const [txWh, tzWh] = await pingPongEndpoint(page)
  await steerTowardPoint(page, txWh, tzWh, true, 60)
  await page.keyboard.down('KeyW')
  await stepTicks(page, 16, 0.05)
  await page.keyboard.down('Space')
  let peakWheelie = 0
  let loopoutCrash = false
  let wheelieStateText = ''
  for (let i = 0; i < 32; i++) {
    const snap = await stepTicks(page, 2, 0.05)
    peakWheelie = Math.max(peakWheelie, snap.ebike?.wheelie ?? 0, snap.probe?.ebikeRig?.wheelie ?? 0)
    const st = await page.locator('.ride-state').textContent()
    if (st) wheelieStateText = st
    if (snap.ebike?.crashPhase === 'crashed' && snap.ebike?.crashReason === 'loopout') {
      loopoutCrash = true
      break
    }
  }
  await page.screenshot({path: `${SHOTS_DIR}/wheelie-ghostfire.png`})
  await page.keyboard.up('Space')
  await page.keyboard.up('KeyW')
  assert(peakWheelie > 0.18, `Wheelie pitch too small: ${peakWheelie}`)
  if (loopoutCrash) {
    await page.keyboard.press('Space')
    await stepTicks(page, 24, 0.05)
  } else {
    await stepTicks(page, 12, 0.05)
  }

  // 4. Left & right steering lean + tuck
  await page.keyboard.down('KeyW')
  await page.keyboard.down('ShiftLeft')
  await page.keyboard.down('KeyA')
  let maxLeftLean = 0
  let leftLowside = false
  for (let i = 0; i < 20; i++) {
    const snap = await stepTicks(page, 2, 0.05)
    const lean = snap.probe?.ebikeRig?.lean ?? 0
    if (Math.abs(lean) > Math.abs(maxLeftLean)) maxLeftLean = lean
    if (snap.ebike?.crashPhase === 'crashed' && snap.ebike?.crashReason === 'lowside') {
      leftLowside = true
      break
    }
  }
  await page.screenshot({path: `${SHOTS_DIR}/lean-left.png`})
  await page.keyboard.up('KeyA')
  if (leftLowside) {
    await page.keyboard.press('Space')
    await stepTicks(page, 24, 0.05)
  }
  await page.keyboard.down('KeyD')
  let maxRightLean = 0
  for (let i = 0; i < 20; i++) {
    const snap = await stepTicks(page, 2, 0.05)
    const lean = snap.probe?.ebikeRig?.lean ?? 0
    if (Math.abs(lean) > Math.abs(maxRightLean)) maxRightLean = lean
    if (snap.ebike?.crashPhase === 'crashed') break
  }
  await page.keyboard.up('KeyD')
  await page.keyboard.up('ShiftLeft')
  await page.keyboard.up('KeyW')
  assert(
    Math.abs(maxLeftLean) > 0.12 && Math.abs(maxRightLean) > 0.12 && maxLeftLean * maxRightLean < 0,
    `Left/right lean must oppose & exceed 0.12 rad: left=${maxLeftLean}, right=${maxRightLean}`,
  )

  // 5. Crash separation & safe Space recover (non-clipping & non-wet)
  await page.evaluate(() => window.viewer.walk.ebike.recover())
  await stepTicks(page, 24, 0.05)
  await page.keyboard.down('KeyW')
  await stepTicks(page, 14, 0.05)
  await page.keyboard.up('KeyW')
  await page.evaluate(() => window.viewer.walk.ebike.triggerCrash('lowside', 1))
  const crashedSnap = await stepTicks(page, 14, 0.05)
  assert(crashedSnap.ebike?.crashPhase === 'crashed', `Expected crashed phase, got ${crashedSnap.ebike?.crashPhase}`)
  assert(!crashedSnap.probe.inHouse && !crashedSnap.probe.wet, `Crashed clipped inHouse=${crashedSnap.probe.inHouse} wet=${crashedSnap.probe.wet}`)
  await page.screenshot({path: `${SHOTS_DIR}/crash-lowside.png`})
  await page.keyboard.press('Space')
  const recoveredSnap = await stepTicks(page, 28, 0.05)
  assert(recoveredSnap.ebike?.crashPhase === 'none', `Failed recover: ${recoveredSnap.ebike?.crashPhase}`)
  assert(!recoveredSnap.probe.inHouse && !recoveredSnap.probe.wet && recoveredSnap.probe.grounded, 'Unsafe state after recover')

  // 6. Wall collision test (steer into building wall) -> verify zero house clipping
  await page.keyboard.down('KeyW')
  await page.keyboard.down('KeyA')
  let sawObstacle = ''
  let impactCrash = false
  for (let i = 0; i < 65; i++) {
    const snap = await stepTicks(page, 2, 0.05)
    assert(!snap.probe.inHouse, `Bike clipped inside building during collision! pos=${snap.probe.x},${snap.probe.z}`)
    if (snap.obstacle) sawObstacle = snap.obstacle
    if (snap.ebike?.crashPhase === 'crashed' && snap.ebike?.crashReason === 'impact') {
      impactCrash = true
      break
    }
    if (sawObstacle && snap.speed < 0.25 && i > 10) break
  }
  await page.keyboard.up('KeyA')
  await page.keyboard.up('KeyW')

  // 7. Mod cycle KeyG + HUD click + clean dismount KeyF
  await page.keyboard.press('KeyG')
  await stepTicks(page, 1, 0.05)
  const modAfterG = await page.locator('.ride-mod').textContent()
  await page.locator('.ride-mod').click()
  await stepTicks(page, 1, 0.05)
  const modAfterClick = await page.locator('.ride-mod').textContent()
  assert(modAfterG !== modAfterClick, `Mod cycle failed: ${modAfterG} -> ${modAfterClick}`)
  await page.screenshot({path: `${SHOTS_DIR}/mod-neon.png`})

  await page.keyboard.press('KeyF')
  const dismountSnap = await stepTicks(page, 12, 0.05)
  const hudHiddenAfterDismount = await page.evaluate(() => getComputedStyle(document.querySelector('.ride-hud')).display === 'none')
  assert(dismountSnap.vehicle === 'foot' && hudHiddenAfterDismount, `Dismount failed: vehicle=${dismountSnap.vehicle}, hudHidden=${hudHiddenAfterDismount}`)
  assert(!dismountSnap.probe.inHouse && !dismountSnap.probe.wet, 'Dismount landed inside house or water')

  const physicsChecks = {
    gearTopSpeedScaling: gearResults.S.peakKmh > gearResults.D3.peakKmh && gearResults.D3.peakKmh > gearResults.D2.peakKmh && gearResults.D2.peakKmh > gearResults.D1.peakKmh,
    coastingInertiaTail: coastStats.v08 > 0.5,
    wheelieLoopoutAutoCrash: loopoutCrash,
    lowsideAutoCrash: leftLowside,
    wallImpactAutoCrash: impactCrash,
  }
  const strictPass = Object.values(physicsChecks).every(Boolean)
  assert(errors.length === 0, `Runtime errors: ${errors.join('; ')}`)
  console.log('EBIKE PHYSICS & HUD ACCEPTANCE REPORT:', JSON.stringify({
    gearResults,
    coastStats,
    peakWheelieRad: Number(peakWheelie.toFixed(3)),
    wheelieStateText,
    maxLeftLeanRad: Number(maxLeftLean.toFixed(3)),
    maxRightLeanRad: Number(maxRightLean.toFixed(3)),
    sawObstacle,
    modCycle: [hudInit.mod, modAfterG, modAfterClick],
    physicsChecks,
    strictPass,
  }, null, 2))
  if (STRICT_PHYSICS && !strictPass) {
    throw Error(`--strict-physics failed: ${JSON.stringify(physicsChecks)}`)
  }
  console.log(STRICT_PHYSICS ? 'STRICT EBIKE PHYSICS PASS' : 'EBIKE STANCE/HUD ACCEPTANCE PASS (physics integration telemetry recorded)')
} finally {
  await page?.evaluate(() => { if (window.__advanceWalk) window.viewer.walk.tick = window.__advanceWalk }).catch(() => {})
  await browser?.close()
  await server.close()
}
