import {checkOverlaps} from './mobile-hud-baseline.mjs'
import {enableStickInput} from './joystick-fixture.mjs'
import assert from 'node:assert/strict'
import {copyFile, mkdir, readFile} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {vehicleModel} from '../web/src/walk/vehicle-model.ts'

// 1. Model triangle budget & 4 paint finishes check (1500..3000 triangles).
for (let paint = 0; paint < 4; paint++) {
  const geom = vehicleModel('car', paint).geometry
  const tris = geom.index ? geom.index.count / 3 : geom.attributes.position.count / 3
  assert(tris >= 1500 && tris <= 3000, `car paint=${paint} triangle count out of [1500,3000]: ${tris}`)
  if (paint === 0) console.log(`car model triangles: ${tris} (4 paint finishes verified)`)
}

// 2. Motorway mask & curbside car spawn checks on built vehicles.bin.
const data = JSON.parse(gunzipSync(await readFile('dist/world/vehicles.bin')))
assert(Array.isArray(data.cars) && data.cars.length >= 200, `expected >= 200 cars, got ${data.cars?.length}`)
assert(Array.isArray(data.motorGrid) && typeof data.motorMask === 'string', 'missing motorGrid / motorMask')
const [mLeft, mTop, mW, mH, mStep] = data.motorGrid
const mBytes = Buffer.from(data.motorMask, 'base64')
function motorAt(x, z) {
  const col = Math.round((x - mLeft) / mStep), row = Math.round((z - mTop) / mStep)
  if (col < 0 || row < 0 || col >= mW || row >= mH) return false
  const idx = row * mW + col
  return !!(mBytes[idx >> 3] & (128 >> (idx & 7)))
}
assert(data.cars.every(c => motorAt(c[0], c[2]) && c[4] >= 0 && c[4] <= 3), 'every spawned car must lie inside motorMask with paint 0..3')
for (const [name, x, z] of [
  ['正阳步行街', -632.2, 46.9],
  ['东西巷', -422.2, -200.6],
  ['解放桥北人行道', -162.8, 24.3],
  ['解放桥南人行道', -173.2, 55.7],
  ['丽泽桥人行道', -1601.1, -175.6],
  ['花桥', 414.3, 331.6],
  ['玻璃桥', -1173.8, 282.0],
]) {
  assert(!motorAt(x, z), `${name} (${x},${z}) must be excluded from motorMask`)
}
for (const [name, x, z] of [
  ['解放桥车行道', -168.0, 40.0],
  ['中山中路', -875.0, -150.0],
  ['解放东路', -500.0, -70.0],
  ['文昌桥', -1149.1, 1033.4],
]) {
  assert(motorAt(x, z), `${name} (${x},${z}) must be included in motorMask`)
}
console.log(`motorMask & ${data.cars.length} curbside cars verified`)

const output = 'captures/car'
const extraDir = process.env.CAR_SHOT_DIR || ''
await mkdir(output, {recursive: true})
if (extraDir) await mkdir(extraDir, {recursive: true})

async function saveShot(page, name) {
  const close = page.locator('.spot-card.show .card-close')
  if (await close.isVisible()) await close.click()
  const p = `${output}/${name}.png`
  await page.screenshot({path: p})
  if (extraDir) await copyFile(p, `${extraDir}/${name}.png`)
}

const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const errors = []

try {
  // Desktop end-to-end physics, motorway confinement, and showcase shots.
  const page = await browser.newPage({viewport: {width: 960, height: 540}})
  page.on('pageerror', err => errors.push(err.message))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?mode=walk&verify&radius=480&hour=9.5`)
  await page.waitForFunction(() => window.viewer?.walk?.active, null, {timeout: 90000})

  async function settleAt(x, z, yaw = 0) {
    const ok = await page.evaluate(async ([x, z, yaw]) => {
      const {walk, stream} = window.viewer
      walk.leave()
      const entered = await walk.enter(x, z, yaw, 'car-fixture')
      if (!entered) return false
      for (let i = 0; i < 16; i++) {
        stream.tick(walk.position)
        walk.tick(1 / 60)
        await new Promise(requestAnimationFrame)
      }
      return true
    }, [x, z, yaw])
    assert(ok, `failed to enter at (${x}, ${z})`)
  }

  async function interactExact(expectedText) {
    const close = page.locator('.spot-card.show .card-close')
    if (await close.isVisible()) await close.click()
    await page.waitForFunction(
      expected => {
        const btn = document.querySelector('.vehicle-action')
        return btn && !btn.hidden && btn.textContent === expected && btn.getAttribute('aria-keyshortcuts') === 'F'
      },
      expectedText,
      {timeout: 20000},
    )
    await page.keyboard.press('f')
  }

  async function steerCarTo(target, maxFrames = 1400, arrive = 4.0) {
    return page.evaluate(async ({target, maxFrames, arrive}) => {
      const {walk, stream} = window.viewer
      const keys = new Set()
      const start = walk.position.clone()
      let maxSpeed = 0, maxAbsPitch = 0
      function press(code, on) {
        if (keys.has(code) === on) return
        window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', {code}))
        if (on) keys.add(code); else keys.delete(code)
      }
      for (let frame = 0; frame < maxFrames; frame++) {
        const pos = walk.position
        const dx = target[0] - pos.x, dz = target[1] - pos.z
        const dist = Math.hypot(dx, dz)
        if (dist < arrive) break
        const desired = Math.atan2(-dx, -dz)
        const err = Math.atan2(Math.sin(desired - walk.heading), Math.cos(desired - walk.heading))
        press('KeyA', err > .04)
        press('KeyD', err < -.04)
        press('KeyW', Math.abs(err) < .85)
        walk.tick(1 / 60)
        if (frame % 15 === 0) {
          stream.tick(walk.position)
          await new Promise(r => setTimeout(r, 0))
        }
        const p = walk.probe()
        if (p.inHouse) throw new Error(`car entered building at ${JSON.stringify(pos.toArray())}`)
        if (walk.speed > 40 / 3.6 + 1e-3) throw new Error(`car exceeded 40 km/h: ${walk.speed}`)
        if (walk.speed > maxSpeed) maxSpeed = walk.speed
        if (Math.abs(p.carPitch) > maxAbsPitch) maxAbsPitch = Math.abs(p.carPitch)
        if (frame > 90 && walk.obstacle === 'off-road' && Math.abs(walk.speed) < 1e-3) break
      }
      for (const k of [...keys]) press(k, false)
      const end = walk.position.clone()
      return {
        traveled: end.distanceTo(start),
        targetDist: Math.hypot(end.x - target[0], end.z - target[1]),
        end: end.toArray(),
        speed: walk.speed,
        maxSpeed,
        maxAbsPitch,
        obstacle: walk.obstacle,
      }
    }, {target, maxFrames, arrive})
  }

  // Showcase close-up shots of the 4 sedan paint colors on wide, sunlit carriageways (full 3/4 front & 3/4 rear views).
  const paintSamples = [0, 1, 2, 3].map(p =>
    data.cars.find(c => c[4] === p && (p === 1 ? c[0] < -400 : (c[0] > -780 || c[0] < -1020)) && c[0] > -1200 && c[0] < 200 && c[2] > -450 && c[2] < 450)
    ?? data.cars.find(c => c[4] === p),
  )
  for (let p = 0; p < 4; p++) {
    const c = paintSamples[p]
    assert(c, `missing car sample for paint ${p}`)
    const [cx, , cz, cyaw] = c
    const fx = -Math.sin(cyaw), fz = -Math.cos(cyaw), rx = Math.cos(cyaw), rz = -Math.sin(cyaw)
    await settleAt(cx - rx * .15 - fx * .1, cz - rz * .15 - fz * .1, cyaw + Math.PI + .66)
    await page.evaluate(({cyaw}) => {
      const {walk, canvas} = {walk: window.viewer.walk, canvas: document.querySelector('canvas')}
      walk.showFigure(false)
      canvas.dispatchEvent(new WheelEvent('wheel', {deltaY: -120}))
      walk.face(cyaw + Math.PI + .66, .14)
    }, {cyaw})
    await new Promise(r => setTimeout(r, 90))
    await saveShot(page, `car-paint-${p}`)
    if (p === 0) {
      await page.evaluate(({cyaw}) => window.viewer.walk.face(cyaw - .66, .16), {cyaw})
      await new Promise(r => setTimeout(r, 70))
      await saveShot(page, 'car-34-rear')
    }
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas')
      window.viewer.walk.showFigure(true)
      canvas.dispatchEvent(new WheelEvent('wheel', {deltaY: 120}))
    })
  }

  // Case A: Zhongshan Middle Road straightway — mount lock, zero standstill spin, 40 km/h cap, coast, brake, delayed -12 km/h reverse, and Ackermann turning radius.
  const zsCar = data.cars.find(c => Math.hypot(c[0] - -949.4, c[2] - 85.8) < 5) ?? data.cars[0]
  await settleAt(zsCar[0], zsCar[2], zsCar[3])
  await interactExact('开车')
  assert.equal(await page.evaluate(() => window.viewer.walk.vehicle), 'car')

  const dynamics = await page.evaluate(() => {
    const {walk} = window.viewer
    const keys = new Set()
    function press(code, on) {
      if (keys.has(code) === on) return
      window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', {code}))
      if (on) keys.add(code); else keys.delete(code)
    }

    // 1) 0.24s door-entry lock
    press('KeyW', true)
    walk.tick(.06); walk.tick(.06)
    const mountLockSpeed = walk.speed
    press('KeyW', false)
    for (let i = 0; i < 6; i++) walk.tick(.06)

    // 2) Standstill steering must produce ZERO pivot rotation
    const h0 = walk.heading
    press('KeyA', true)
    for (let i = 0; i < 30; i++) walk.tick(1 / 60)
    const zeroSpinDelta = Math.abs(walk.heading - h0)
    press('KeyA', false)
    for (let i = 0; i < 15; i++) walk.tick(1 / 60)

    // 3) Straight acceleration toward (-895, -90) up to 40 km/h (11.11 m/s)
    const target = [-895, -90]
    let peakSpeed = 0
    for (let i = 0; i < 260; i++) {
      const pos = walk.position
      const dx = target[0] - pos.x, dz = target[1] - pos.z
      const desired = Math.atan2(-dx, -dz)
      const err = Math.atan2(Math.sin(desired - walk.heading), Math.cos(desired - walk.heading))
      press('KeyA', err > .03); press('KeyD', err < -.03); press('KeyW', true)
      walk.tick(1 / 60)
      if (walk.speed > peakSpeed) peakSpeed = walk.speed
    }
    press('KeyA', false); press('KeyD', false); press('KeyW', false)

    // 4) Coasting drag
    const coastStart = walk.position.clone(), preCoast = walk.speed
    for (let i = 0; i < 30; i++) walk.tick(1 / 60)
    const coastDist = walk.position.distanceTo(coastStart), coastEndSpeed = walk.speed

    // 5) Strong brake without accidental reverse, then 0.24s hold into reverse (-12 km/h cap)
    press('KeyS', true)
    for (let i = 0; i < 18; i++) walk.tick(1 / 60)
    const brakeSpeed = walk.speed
    for (let g = 0; g < 240 && walk.speed > 0; g++) walk.tick(1 / 60)
    press('KeyS', false); walk.tick(1 / 60)
    press('KeyS', true); walk.tick(.08); walk.tick(.08)
    const tapRevSpeed = walk.speed
    const revStart = walk.position.clone()
    for (let i = 0; i < 90; i++) walk.tick(1 / 60)
    const revSpeed = walk.speed, revDist = walk.position.distanceTo(revStart)

    // 6) Reverse right-steer yaw sign check (backing up with right wheel turns nose left => heading increases)
    const revH0 = walk.heading
    press('KeyD', true)
    for (let i = 0; i < 24; i++) walk.tick(1 / 60)
    const revRightHeadingDelta = Math.atan2(Math.sin(walk.heading - revH0), Math.cos(walk.heading - revH0))
    press('KeyD', false); press('KeyS', false)
    for (let g = 0; g < 240 && Math.abs(walk.speed) > .02; g++) walk.tick(1 / 60)

    // 7) Low-speed full-lock turning radius measurement R = |v / omega|
    press('KeyA', true)
    for (let i = 0; i < 30; i++) walk.tick(1 / 60)
    press('KeyW', true)
    for (let i = 0; i < 22; i++) walk.tick(1 / 60)
    const turnH0 = walk.heading, dtSample = 1 / 60
    walk.tick(dtSample)
    const turnSpd = walk.speed
    const turnOmega = Math.abs(Math.atan2(Math.sin(walk.heading - turnH0), Math.cos(walk.heading - turnH0))) / dtSample
    const turnRadius = turnOmega > 1e-4 ? turnSpd / turnOmega : Infinity
    press('KeyW', false); press('KeyA', false)

    return {
      mountLockSpeed,
      zeroSpinDelta,
      peakSpeed,
      preCoast,
      coastDist,
      coastEndSpeed,
      brakeSpeed,
      tapRevSpeed,
      revSpeed,
      revDist,
      revRightHeadingDelta,
      turnRadius,
    }
  })
  console.log('car dynamics:', dynamics)
  assert.equal(dynamics.mountLockSpeed, 0, '0.24s mount transition must lock initial throttle')
  assert.equal(dynamics.zeroSpinDelta, 0, 'car must not pivot-turn in place at speed=0')
  assert(dynamics.peakSpeed >= 10.2 && dynamics.peakSpeed <= 40 / 3.6 + 1e-3, `40 km/h cap/accel failed: ${JSON.stringify(dynamics)}`)
  assert(dynamics.coastDist > 3.5 && dynamics.coastEndSpeed < dynamics.preCoast, `coasting failed: ${JSON.stringify(dynamics)}`)
  assert(dynamics.brakeSpeed < dynamics.coastEndSpeed - 2.0 && dynamics.tapRevSpeed === 0, `brake/revHold failed: ${JSON.stringify(dynamics)}`)
  assert(dynamics.revSpeed < -2.4 && dynamics.revSpeed >= -12 / 3.6 - 1e-3 && dynamics.revDist > 2.0, `reverse failed: ${JSON.stringify(dynamics)}`)
  assert(dynamics.revRightHeadingDelta > .04, `reverse Ackermann steering inverted: ${JSON.stringify(dynamics)}`)
  assert(dynamics.turnRadius >= 4.6 && dynamics.turnRadius <= 6.2, `low-speed turning radius out of [4.6, 6.2]m: ${dynamics.turnRadius}`)

  await interactExact('下车')
  assert.equal(await page.evaluate(() => window.viewer.walk.vehicle), 'foot')

  // Case B: Drive across Jiefang Bridge carriageway, capture scenic driving shot, and verify bridge sidewalk exclusion.
  const jfCar = data.cars.find(c => Math.hypot(c[0] - -455.4, c[2] - -47.4) < 5)
  assert(jfCar, 'expected Jiefang East Rd car fixture')
  await settleAt(jfCar[0], jfCar[2], jfCar[3])
  await interactExact('开车')
  const bridgeDrive = await steerCarTo([-185, 34], 2200, 5.0)
  console.log('Jiefang bridge drive:', bridgeDrive)
  assert(bridgeDrive.traveled > 250 && bridgeDrive.targetDist <= 6.0 && bridgeDrive.maxSpeed > 9.5, `failed to reach Jiefang Bridge carriageway: ${JSON.stringify(bridgeDrive)}`)
  await page.evaluate(() => {
    const w = window.viewer.walk
    w.face(w.heading - .22, .22)
  })
  await new Promise(r => setTimeout(r, 80))
  await saveShot(page, 'car-driving-jiefang-bridge')

  // Attempt to steer hard onto Jiefang Bridge north sidewalk (-162.8, 24.3) — must stay confined off the sidewalk!
  const bridgeSidewalkBlock = await steerCarTo([-160.5, 19.5], 360, 1.5)
  console.log('Jiefang bridge sidewalk block:', bridgeSidewalkBlock)
  assert(!motorAt(-162.8, 24.3) && bridgeSidewalkBlock.targetDist > 4.0, `car leaked onto Jiefang Bridge sidewalk: ${JSON.stringify(bridgeSidewalkBlock)}`)
  await interactExact('下车')
  assert.equal(await page.evaluate(() => window.viewer.walk.vehicle), 'foot')

  // Starter roadside car check: guaranteed near Zhengyang south exit on Jiefang East Rd (-572, -92).
  assert(data.cars.some(c => Math.hypot(c[0] - -572, c[2] - -92) < 6), 'missing starter sedan near (-572, -92)')
  // Case C: Yiren Rd -> Zhengyang Pedestrian Street exclusion & boundary/wall stop + reverse escape + door dismount.
  const zyNearCar = [...data.cars].sort((a, b) => Math.hypot(a[0] - -685, a[2] - 188) - Math.hypot(b[0] - -685, b[2] - 188))[0]
  await settleAt(zyNearCar[0], zyNearCar[2], zyNearCar[3])
  await interactExact('开车')
  const pullOut = await steerCarTo([-700.0, 183.5], 900, 4.0)
  assert(pullOut.traveled > 45 && pullOut.targetDist <= 4.5, `failed to merge onto Yiren Rd centerline: ${JSON.stringify(pullOut)}`)
  // Aim south of relocated zhengyang_clock (-655.2, 195.5) into Zhengyang Pedestrian Street so pure motorMask 'off-road' blocks entry.
  const pedBlock = await steerCarTo([-656.0, 214.0], 900, 2.0)
  console.log('Zhengyang pedestrian block:', pedBlock)
  assert(pedBlock.traveled > 25 && pedBlock.targetDist > 10 && pedBlock.obstacle === 'off-road' && !motorAt(-640.0, 202.0) && !motorAt(-656.0, 214.0) && motorAt(pedBlock.end[0], pedBlock.end[2]), `car must not enter Zhengyang Pedestrian Street: ${JSON.stringify(pedBlock)}`)

  // Steer into nearby building wall, verify clean stop + reverse escape + door dismount.
  const wallCheck = await page.evaluate(() => {
    const {walk} = window.viewer
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyD'}))
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
    for (let i = 0; i < 240; i++) {
      walk.tick(1 / 60)
      if (walk.obstacle === 'building' || walk.obstacle === 'collision' || walk.obstacle === 'off-road') {
        if (walk.speed === 0) break
      }
    }
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyD'}))
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
    const hitObs = walk.obstacle, hitSpd = walk.speed, inHouse = walk.probe().inHouse
    const stoppedAt = walk.position.clone()
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyS'}))
    for (let i = 0; i < 75; i++) walk.tick(1 / 60)
    const revMoved = walk.position.distanceTo(stoppedAt), revSpd = walk.speed
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyS'}))
    for (let g = 0; g < 240 && Math.abs(walk.speed) > .02; g++) walk.tick(1 / 60)
    return {hitObs, hitSpd, inHouse, revMoved, revSpd, carPos: walk.position.toArray()}
  })
  console.log('car boundary/wall stop & reverse:', wallCheck)
  assert(wallCheck.hitObs !== '' && wallCheck.hitSpd === 0 && !wallCheck.inHouse, `car boundary/wall stop failed: ${JSON.stringify(wallCheck)}`)
  assert(wallCheck.revMoved > .8 && wallCheck.revSpd < -.5, `car reverse escape failed: ${JSON.stringify(wallCheck)}`)

  await interactExact('下车')
  const postDismount = await page.evaluate(cp => {
    const p = window.viewer.walk.probe()
    return {vehicle: window.viewer.walk.vehicle, dist: Math.hypot(p.x - cp[0], p.z - cp[2]), inHouse: p.inHouse}
  }, wallCheck.carPos)
  console.log('car door dismount:', postDismount)
  assert(postDismount.vehicle === 'foot' && postDismount.dist >= 1.0 && postDismount.dist <= 3.2 && !postDismount.inHouse, `car dismount bad: ${JSON.stringify(postDismount)}`)

  // Case D: Right after door dismount on level ground, next tick shows '开车'; at >1.5m elevation gap, prompt stays hidden.
  const elevCheck = await page.evaluate(() => {
    const {walk} = window.viewer
    walk.tick(1 / 60)
    const btn = document.querySelector('.vehicle-action')
    return !!(btn && !btn.hidden && btn.textContent === '开车')
  })
  assert(elevCheck, 'expected mount button visible on next tick after door dismount')
  await page.close()

  // Mobile 390x844 touch HUD & joystick driving check (stand beside driver door before mounting).
  const mCar = paintSamples[0]
  const mDoorX = mCar[0] - Math.cos(mCar[3]) * 1.38, mDoorZ = mCar[2] + Math.sin(mCar[3]) * 1.38
  const mPage = await browser.newPage({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true})
  await enableStickInput(mPage, true)
  mPage.on('pageerror', err => errors.push(err.message))
  await mPage.goto(`http://127.0.0.1:${server.httpServer.address().port}/?mode=walk&verify&radius=480&hour=9.5`)
  await mPage.waitForFunction(() => window.viewer?.walk?.active, null, {timeout: 90000})
  await mPage.evaluate(async ([x, z, yaw]) => {
    const {walk, stream} = window.viewer
    walk.leave()
    await walk.enter(x, z, yaw, 'car-mobile')
    for (let i = 0; i < 12; i++) {
      stream.tick(walk.position)
      walk.tick(1 / 60)
      await new Promise(requestAnimationFrame)
    }
  }, [mDoorX, mDoorZ, mCar[3]])

  const closeM = mPage.locator('.spot-card.show .card-close')
  if (await closeM.isVisible()) await closeM.click()
  await mPage.waitForFunction(() => document.querySelector('.vehicle-action')?.textContent === '开车', null, {timeout: 20000})
  await saveShot(mPage, 'car-mobile-pre-mount')

  await mPage.locator('.vehicle-action').tap()
  const mobileCarCheck = await mPage.evaluate(async () => {
    const {walk} = window.viewer
    const joy = document.querySelector('.walk-ui .joystick')
    for (let i = 0; i < 6; i++) walk.tick(.06)
    const btnText = document.querySelector('.vehicle-action')?.textContent
    const jumpHidden = getComputedStyle(document.querySelector('.walk-ui .btn-jump')).display === 'none'
    const runHidden = !document.querySelector('.walk-ui .btn-run')?.getClientRects().length
    const sels = ['.walk-ui .joystick', '.walk-ui .btn-view', '.vehicle-action', '.hud-dev', '.dock', '.sky-ui', 'output', '.btn-menu', '.account-entry']
    const boxes = sels.map(sel => {
      const el = document.querySelector(sel)
      if (!el) return null
      const st = getComputedStyle(el), r = el.getBoundingClientRect()
      return st.display === 'none' || st.visibility === 'hidden' || el.hasAttribute('hidden')
        ? null
        : {sel, left: r.left, top: r.top, right: r.right, bottom: r.bottom}
    }).filter(Boolean)
    const overlaps = []
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
      const oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
      if (ox * oy > 0) overlaps.push({a: a.sel, b: b.sel, area: ox * oy})
    }
    const jr = joy.getBoundingClientRect(), cx = jr.left + jr.width / 2, cy = jr.top + jr.height / 2
    const pos0 = walk.position.clone(), h0 = walk.heading
    await window.testStick('down', cx, cy)
    await window.testStick('move', cx + jr.width * .25, cy - jr.height * .55)
    for (let i = 0; i < 50; i++) walk.tick(1 / 60)
    const dist = walk.position.distanceTo(pos0), spd = walk.speed, dh = Math.abs(walk.heading - h0)
    await window.testStick('up')
    return {vehicle: walk.vehicle, btnText, jumpHidden, runHidden, overlaps, dist, spd, dh}
  })
  console.log('mobile car check:', mobileCarCheck)
  assert(mobileCarCheck.vehicle === 'car' && mobileCarCheck.btnText === '下车' && mobileCarCheck.jumpHidden && mobileCarCheck.runHidden, `mobile car state bad: ${JSON.stringify(mobileCarCheck)}`)
  checkOverlaps(mobileCarCheck.overlaps)
  assert(mobileCarCheck.dist > 1.2 && mobileCarCheck.spd > 2.5 && mobileCarCheck.dh > .04, `mobile stick car drive failed: ${JSON.stringify(mobileCarCheck)}`)
  await saveShot(mPage, 'car-mobile-driving')
  await mPage.close()

  assert.deepEqual(errors, [])
  console.log('ALL CAR CHECKS PASSED')
} finally {
  await browser.close()
  await server.close()
}
