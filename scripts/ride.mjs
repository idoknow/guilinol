import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({viewport: {width: 640, height: 360}})
const errors = []
page.on('pageerror', error => errors.push(error.message))

const output = process.env.CAPTURES ?? 'captures/ride'
await mkdir(output, {recursive: true})
const shot = name => page.screenshot({path: `${output}/${name}.png`})

try {
  await page.addInitScript(() => {
    window.checkedRideProbe = label => {
      const p = window.viewer.walk.probe()
      if (!Number.isFinite(p.renderClearance) || p.renderClearance < -0.15) {
        throw Error(`${label}: visible ground sink ${JSON.stringify(p)}`)
      }
      if (p.clearance < -0.3 || p.inHouse || p.inPeak || p.resets) {
        throw Error(`${label}: unsafe state ${JSON.stringify(p)}`)
      }
      if (p.wet && (p.deck == null || Math.abs(p.foot - p.deck) > 0.3)) {
        throw Error(`${label}: off bridge deck ${JSON.stringify(p)}`)
      }
      return p
    }
  })

  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?mode=walk&verify`)
  await page.waitForFunction(() => window.viewer?.walk?.active, null, {timeout: 45000})

  // 1. Far from parked e-bikes: KeyE must NOT mount out of thin air
  await page.evaluate(async () => {
    const w = window.viewer.walk
    w.leave()
    await w.enter(-572, -206, 0, 'far-check')
  })
  await page.keyboard.press('KeyE')
  const farProbe = await page.evaluate(() => window.checkedRideProbe('far'))
  assert.equal(farProbe.canMount, false)
  assert.equal(farProbe.riding, false)

  // 2. Spawn at Wangcheng Gate (-588, -212) near parked e-bike (-590.8, -210.5), mount via KeyE & check ~25 km/h cap
  await page.evaluate(async () => {
    const w = window.viewer.walk
    w.leave()
    await w.enter(-588, -212, -0.16, 'gate-ebike')
  })
  const gateProbe = await page.evaluate(() => window.checkedRideProbe('gate'))
  assert.equal(gateProbe.canMount, true)
  await page.keyboard.press('KeyE')
  const mounted = await page.evaluate(() => window.checkedRideProbe('mounted'))
  assert.equal(mounted.riding, true)
  await shot('mount-gate')

  const speedRun = await page.evaluate(async () => {
    const w = window.viewer.walk
    const start = window.checkedRideProbe('speed-start')
    let maxSpeed = 0, sawRoad = false, last = start
    w.drive(0.98, 0.18, true)
    while (last.elapsed - start.elapsed < 3.2) {
      await new Promise(requestAnimationFrame)
      last = window.checkedRideProbe('speed-run')
      maxSpeed = Math.max(maxSpeed, last.speed)
      if (last.road) sawRoad = true
    }
    w.drive(0, 0)
    return {maxSpeed, maxKmh: maxSpeed * 3.6, sawRoad}
  })
  console.log('speedCheck', JSON.stringify(speedRun))
  assert.ok(speedRun.maxSpeed >= 5.8 && speedRun.maxSpeed <= 7.05, `Expected ~25 km/h cap, got ${speedRun.maxKmh}`)
  assert.ok(speedRun.sawRoad, 'Expected roadAt sensing along street')

  // 3. Building collision: mount second parked e-bike at (-594, -211.2), ride north into Wangcheng wall & verify crash-stop
  await page.keyboard.press('KeyE')
  const mountedWall = await page.evaluate(async () => {
    const w = window.viewer.walk
    w.leave()
    await w.enter(-594.0, -211.2, 0, 'wall-test')
    return w.toggleRide()
  })
  assert.equal(mountedWall, true, 'Expected mounting Gate-2 e-bike')
  const wallHit = await page.evaluate(async () => {
    const w = window.viewer.walk
    const start = window.checkedRideProbe('wall-start')
    const hits = new Set()
    let peakSpeed = 0, last = start
    w.drive(0, -1, true)
    while (last.elapsed - start.elapsed < 6.5) {
      await new Promise(requestAnimationFrame)
      last = window.checkedRideProbe('wall')
      peakSpeed = Math.max(peakSpeed, last.speed)
      for (const h of last.hits) hits.add(h)
    }
    w.drive(0, 0)
    return {
      hits: [...hits],
      peakSpeed,
      finalSpeed: last.speed,
      distance: Math.hypot(last.x - start.x, last.z - start.z),
      inHouse: last.inHouse,
      resets: last.resets,
    }
  })
  await shot('building-stop')
  console.log('buildingStop', JSON.stringify(wallHit))
  assert.ok(wallHit.peakSpeed >= 4.0, `Expected e-bike riding speed before impact, got ${wallHit.peakSpeed}`)
  assert.ok(wallHit.hits.includes('building') && wallHit.distance < 55, JSON.stringify(wallHit))
  assert.ok(Math.abs(wallHit.finalSpeed) < 0.25, `Expected stop against building, got speed=${wallHit.finalSpeed}`)

  // 4. Ride across Jiefang Bridge (解放桥: [-311.5,-2.2] -> [-174,44] -> [-30,92]) without clipping or falling
  await page.evaluate(async () => {
    const w = window.viewer.walk
    w.leave()
    const ok = await w.enter(-311.5, -2.2, -1.9, 'bridge-west')
    if (!ok) throw Error('Failed to enter bridge west')
  })
  await page.keyboard.press('KeyE')
  assert.equal((await page.evaluate(() => window.checkedRideProbe('bridge-mount'))).riding, true)

  async function rideWaypoints(points, label) {
    return page.evaluate(async ({points, label}) => {
      const w = window.viewer.walk
      let minClearance = Infinity, maxSink = 0, wetFrames = 0, maxSpeed = 0, frames = 0, last = null
      for (const [tx, tz] of points) {
        const start = window.checkedRideProbe(label)
        const limit = 8 + Math.hypot(tx - start.x, tz - start.z) / 2.2
        do {
          await new Promise(requestAnimationFrame)
          last = window.checkedRideProbe(label)
          frames++
          minClearance = Math.min(minClearance, last.clearance)
          maxSink = Math.max(maxSink, -last.renderClearance)
          maxSpeed = Math.max(maxSpeed, last.speed)
          if (last.wet) wetFrames++
          const dx = tx - last.x, dz = tz - last.z, dist = Math.hypot(dx, dz)
          if (dist < 1.6) break
          if (last.elapsed - start.elapsed > limit) {
            throw Error(`Stuck riding to ${tx},${tz}: ${JSON.stringify(last)}`)
          }
          w.drive(dx / dist, dz / dist, true)
        } while (true)
        w.drive(0, 0)
      }
      return {frames, wetFrames, minClearance, maxSink, maxSpeed, last}
    }, {points, label})
  }

  const midBridge = await rideWaypoints([[-174, 44]], 'jiefang-mid')
  await shot('jiefang-bridge')
  const eastBank = await rideWaypoints([[-30, 92]], 'jiefang-east')
  const totalWet = midBridge.wetFrames + eastBank.wetFrames
  console.log('jiefangBridge', JSON.stringify({
    wetFrames: totalWet,
    minClearance: Math.min(midBridge.minClearance, eastBank.minClearance),
    maxSink: Math.max(midBridge.maxSink, eastBank.maxSink),
    maxKmh: Math.max(midBridge.maxSpeed, eastBank.maxSpeed) * 3.6,
    resets: eastBank.last.resets,
  }))
  assert.ok(totalWet > 15, `Expected riding over river water on Jiefang Bridge, wetFrames=${totalWet}`)
  assert.equal(eastBank.last.resets, 0)

  // Dismount via KeyE on east bank
  await page.keyboard.press('KeyE')
  assert.equal((await page.evaluate(() => window.checkedRideProbe('bridge-dismount'))).riding, false)

  // 5. Shizijie (十字街) parked e-bikes & mobile button (.btn-ride) mount/dismount check
  await page.evaluate(async () => {
    const w = window.viewer.walk
    w.leave()
    await w.enter(-871.5, -154.0, -2.75, 'shizijie')
  })
  const shizijie = await page.evaluate(() => window.checkedRideProbe('shizijie'))
  assert.equal(shizijie.canMount, true)
  await page.evaluate(() => document.querySelector('.btn-ride').dispatchEvent(new PointerEvent('pointerdown', {bubbles: true})))
  assert.equal((await page.evaluate(() => window.checkedRideProbe('mobile-mount'))).riding, true)
  await shot('shizijie-ebike')
  await page.evaluate(() => document.querySelector('.btn-ride').dispatchEvent(new PointerEvent('pointerdown', {bubbles: true})))
  assert.equal((await page.evaluate(() => window.checkedRideProbe('mobile-dismount'))).riding, false)

  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await server.close()
}
