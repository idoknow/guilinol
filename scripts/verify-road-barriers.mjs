import assert from 'node:assert/strict'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {gunzipSync, gzipSync} from 'node:zlib'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {withFixtureBays} from './ride-fixture-bays.mjs'

const beforeMode = process.argv.includes('--before')
const outDir = process.env.ROAD_BARRIER_DIR ?? 'captures/road-barriers'
await mkdir(outDir, {recursive: true})

const baked = JSON.parse(gunzipSync(await readFile('dist/world/vehicles.bin')))

// Real Guilin arterial barrier coordinates extracted from world GL04 chunks:
// 1) Jiefang East Rd median (kind=1/2) at (-544.3, -83.3): normal=(+0.249, -0.969) pointing north.
// 2) Jiefang East Rd south verge (kind=5) at (-544.1, -71.9): normal=(-0.247, +0.969) pointing south.
// 3) Jiefang East Rd x Zhengyang intersection opening (27 m gap) at (-609.0, -99.8).
// 4) Zhongshan Middle Rd median (kind=1/2) at (-838.8, -321.0) & west verge (kind=5) at (-854.3, -320.4): normal=(-0.967, -0.256) pointing west.
// 5) Planted median (kind=7) at (-1393.9, -296.0) & stone-pillar fence (kind=8) at (-1545.9, -3.8).
// 6) Non-blocking ground curb strip (kind=9) at (-1542.0, -2.7) & yellow stripe (kind=10) at (-1358.2, -9.8).
const JF_MEDIAN = {x: -544.3, z: -83.3, tx: -0.969, tz: -0.249, nx: 0.249, nz: -0.969}
const JF_VERGE = {x: -544.1, z: -71.9, tx: 0.969, tz: 0.247, nx: -0.247, nz: 0.969}
const JF_GAP = {x: -609.0, z: -99.8, nx: 0.249, nz: -0.969}
const JF_EAST_GAP = {x: -431.3, z: -48.8, nx: 0.307, nz: -0.952}
const ZS_MEDIAN = {x: -838.8, z: -321.0, tx: -0.256, tz: 0.967, nx: -0.967, nz: -0.256}
const ZS_VERGE = {x: -854.3, z: -320.4, tx: -0.256, tz: 0.967, nx: -0.967, nz: -0.256}
const KIND7_HEDGE = {x: -1393.9, z: -296.0, nx: -0.497, nz: 0.868}
const KIND8_FENCE = {x: -1545.9, z: -3.8, nx: 0.984, nz: 0.180}
const KIND9_STRIP = {x: -1542.0, z: -2.7, nx: 0.964, nz: 0.267}
const KIND10_STRIPE = {x: -1358.2, z: -9.8, nx: 0.389, nz: 0.921}
// 7) Lijiang Rd green boulevard: central crape-myrtle tree median + roadside hedge-curb verge
const LJ_MEDIAN = {x: 453.0, z: 1905.4, tx: -1.0, tz: 0.002, nx: -0.002, nz: -1.0}
const LJ_VERGE = {x: 452.4, z: 1896.7, tx: -1.0, tz: 0.002, nx: -0.002, nz: -1.0}
// 8) Binjiang Rd collector three-band soft delineator strip (must stay walkable with zero invisible wall)
const BJ_SOFT = {x: -366.2, z: 140.8, tx: -0.497, tz: 0.868, nx: 0.868, nz: 0.497}

// Heading convention in walk: fwd = (-sin(heading), -cos(heading)).
// Keep parked fixture headings within (-pi/2, pi/2) so Three.js default XYZ Euler record copy preserves exact yaw.
function headingToward(dx, dz) {
  return Math.atan2(-dx, -dz)
}

// Start vehicles on wide carriageway / cycleway approaching barriers from the -n side going +n (all headings in (-pi/2, pi/2)).
// Offset e-bike and sedan longitudinally along Jiefang East Rd so test vehicles never overlap or collide with each other!
const bikeMedianStart = [JF_MEDIAN.x + JF_MEDIAN.tx * 9.5 - JF_MEDIAN.nx * 3.8, 156.5, JF_MEDIAN.z + JF_MEDIAN.tz * 9.5 - JF_MEDIAN.nz * 3.8, headingToward(JF_MEDIAN.nx, JF_MEDIAN.nz), 0]
const bicycleVergeStart = [JF_VERGE.x + JF_VERGE.nx * 3.2, 156.5, JF_VERGE.z + JF_VERGE.nz * 3.2, headingToward(-JF_VERGE.nx, -JF_VERGE.nz), 0]
const carMedianStart = [JF_MEDIAN.x - JF_MEDIAN.tx * 7.5 - JF_MEDIAN.nx * 5.0, 156.5, JF_MEDIAN.z - JF_MEDIAN.tz * 7.5 - JF_MEDIAN.nz * 5.0, headingToward(JF_MEDIAN.nx, JF_MEDIAN.nz), 0]
const obDirX = JF_MEDIAN.nx * 0.65 + JF_MEDIAN.tx * 0.76
const obDirZ = JF_MEDIAN.nz * 0.65 + JF_MEDIAN.tz * 0.76
const carObliqueStart = [JF_MEDIAN.x - JF_MEDIAN.nx * 4.5 - JF_MEDIAN.tx * 14.5, 156.5, JF_MEDIAN.z - JF_MEDIAN.nz * 4.5 - JF_MEDIAN.tz * 14.5, headingToward(obDirX, obDirZ), 3]
const carVergeStart = [ZS_VERGE.x - ZS_VERGE.nx * 5.2, 153.3, ZS_VERGE.z - ZS_VERGE.nz * 5.2, headingToward(ZS_VERGE.nx, ZS_VERGE.nz), 1]
const carGapStart = [JF_EAST_GAP.x - JF_EAST_GAP.nx * 5.0, 151.8, JF_EAST_GAP.z - JF_EAST_GAP.nz * 5.0, headingToward(JF_EAST_GAP.nx, JF_EAST_GAP.nz), 2]

const fixtureBikes = [bikeMedianStart]
const fixtureBicycles = [bicycleVergeStart]
const fixtureCars = [carMedianStart, carObliqueStart, carVergeStart, carGapStart]
const patchedVehicles = gzipSync(JSON.stringify({
  ...withFixtureBays(baked, [...fixtureBikes, ...fixtureBicycles]),
  bikes: [...baked.bikes, ...fixtureBikes],
  bicycles: [...baked.bicycles, ...fixtureBicycles],
  cars: [...baked.cars, ...fixtureCars],
}))

const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
let browser

try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM,
    args: process.env.USE_METAL === '1'
      ? ['--use-gl=angle', '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const page = await browser.newPage({viewport: {width: 1280, height: 720}})
  const errors = []
  page.on('pageerror', err => errors.push(err.message))
  await page.route('**/favicon.ico', route => route.fulfill({status: 204}))
  await page.route('**/api/t', route => route.fulfill({status: 204}))
  await page.route('**/stats.rcpd.cc/**', route => route.fulfill({status: 204, body: ''}))
  await page.route('**/world/vehicles.bin', route => route.fulfill({body: patchedVehicles}))
  await page.goto(`${baseUrl}/?verify&mode=walk&flow=0&radius=360&hour=9.5`, {waitUntil: 'domcontentloaded', timeout: 120000})
  await page.waitForFunction(() => window.viewer?.walk?.active, null, {timeout: 180000})

  async function closeCards() {
    await page.evaluate(() => {
      document.querySelectorAll('.spot-card.show .card-close').forEach(el => el.click())
    })
  }

  async function enterAt(x, z, yaw = 0) {
    const ok = await page.evaluate(async ([x, z, yaw]) => {
      const {walk, stream} = window.viewer
      walk.leave()
      let entered = false
      for (let attempt = 0; attempt < 2 && !entered; attempt++) {
        entered = await walk.enter(x, z, yaw, 'barrier-verify', false, new AbortController().signal)
      }
      if (!entered) return false
      for (let i = 0; i < 12; i++) {
        stream.tick(walk.position)
        walk.tick(1 / 60)
        await new Promise(requestAnimationFrame)
      }
      return true
    }, [x, z, yaw])
    assert(ok, `failed to spawn at (${x}, ${z})`)
  }

  async function walkAttempt(startX, startZ, dirX, dirZ, barrier, seconds = 2.0, run = true) {
    const yaw = headingToward(dirX, dirZ)
    await enterAt(startX, startZ, yaw)
    return page.evaluate(({dirX, dirZ, barrier, seconds, run}) => {
      const {walk} = window.viewer
      const len = Math.hypot(dirX, dirZ)
      const ux = dirX / len, uz = dirZ / len
      const signed = (px, pz) => (px - barrier.x) * barrier.nx + (pz - barrier.z) * barrier.nz
      const startPos = walk.position.clone()
      const startSigned = signed(startPos.x, startPos.z)
      walk.drive(ux, uz, run)
      let hitRail = false
      let minSigned = startSigned
      let maxSigned = startSigned
      const frames = Math.round(seconds * 60)
      for (let i = 0; i < frames; i++) {
        walk.tick(1 / 60)
        const p = walk.probe()
        const s = signed(p.x, p.z)
        if (s < minSigned) minSigned = s
        if (s > maxSigned) maxSigned = s
        if (p.hits.includes('rail') || p.contactSources.some(c => c?.source === 'road-barrier')) hitRail = true
      }
      walk.drive(0, 0, false)
      const endPos = walk.position.clone()
      const endSigned = signed(endPos.x, endPos.z)
      const crossed = (startSigned > 0 && endSigned < 0) || (startSigned < 0 && endSigned > 0) || (startSigned > 0 && minSigned < 0) || (startSigned < 0 && maxSigned > 0)
      const totalDist = Math.hypot(endPos.x - startPos.x, endPos.z - startPos.z)
      return {startSigned: +startSigned.toFixed(3), endSigned: +endSigned.toFixed(3), minSigned: +minSigned.toFixed(3), maxSigned: +maxSigned.toFixed(3), crossed, hitRail, totalDist: +totalDist.toFixed(3), end: [endPos.x, endPos.z]}
    }, {dirX, dirZ, barrier, seconds, run})
  }

  async function mountAndDrive(spawn, label, vehicleKind, barrier, seconds = 2.4) {
    await enterAt(spawn[0], spawn[2], spawn[3])
    await closeCards()
    await page.waitForFunction(
      expected => {
        const btn = document.querySelector('.vehicle-action')
        return btn && !btn.hidden && btn.textContent === expected
      },
      label,
      {timeout: 20000},
    )
    await page.keyboard.press('f')
    await page.waitForFunction(k => window.viewer.walk.vehicle === k, vehicleKind, {timeout: 15000})
    return page.evaluate(({barrier, seconds, vehicleKind}) => {
      const {walk} = window.viewer
      if (vehicleKind === 'bike' || vehicleKind === 'bicycle') {
        walk.ebike.setPark(false, true)
        walk.ebike.setKickstand(false, true)
        walk.ebike.setAutoCrash(false)
      }
      for (let i = 0; i < 20; i++) walk.tick(1 / 60)
      const signed = (px, pz) => (px - barrier.x) * barrier.nx + (pz - barrier.z) * barrier.nz
      const startPos = walk.position.clone()
      const startSigned = signed(startPos.x, startPos.z)
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))
      let hitRail = false
      let obstacleSeen = ''
      let minSigned = startSigned
      let maxSigned = startSigned
      const frames = Math.round(seconds * 60)
      try {
        for (let i = 0; i < frames; i++) {
          walk.tick(1 / 60)
          const p = walk.probe()
          const s = signed(p.x, p.z)
          if (s < minSigned) minSigned = s
          if (s > maxSigned) maxSigned = s
          if (p.hits.includes('rail') || p.contactSources.some(c => c?.source === 'road-barrier')) hitRail = true
          if (walk.obstacle) obstacleSeen = walk.obstacle
        }
      } finally {
        window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}))
      }
      const endPos = walk.position.clone()
      const endSigned = signed(endPos.x, endPos.z)
      const crossed = (startSigned > 0 && endSigned < 0) || (startSigned < 0 && endSigned > 0) || (startSigned > 0 && minSigned < 0) || (startSigned < 0 && maxSigned > 0)
      const totalDist = Math.hypot(endPos.x - startPos.x, endPos.z - startPos.z)
      return {startSigned: +startSigned.toFixed(3), endSigned: +endSigned.toFixed(3), minSigned: +minSigned.toFixed(3), maxSigned: +maxSigned.toFixed(3), crossed, hitRail, obstacleSeen, speed: +walk.speed.toFixed(2), totalDist: +totalDist.toFixed(3), end: [endPos.x, endPos.z]}
    }, {barrier, seconds, vehicleKind})
  }

  async function dismountClean() {
    await closeCards()
    const v = await page.evaluate(() => window.viewer.walk.vehicle)
    if (v !== 'foot') {
      await page.keyboard.press('f')
      await page.waitForFunction(() => window.viewer.walk.vehicle === 'foot', null, {timeout: 10000})
    }
  }

  async function shot(name, yawOffset = 0.72, pitch = 0.22) {
    await closeCards()
    await page.evaluate(({yawOffset, pitch}) => {
      const w = window.viewer.walk
      w.face(w.yaw + yawOffset, pitch)
      w.tick(1 / 60)
    }, {yawOffset, pitch})
    await page.waitForTimeout(120)
    await page.screenshot({path: `${outDir}/${name}.png`})
  }

  if (beforeMode) {
    // Capture BEFORE evidence: foot & sedan phasing straight through Jiefang East Rd median guardrail.
    const footBefore = await walkAttempt(JF_MEDIAN.x - JF_MEDIAN.nx * 2.5, JF_MEDIAN.z - JF_MEDIAN.nz * 2.5, JF_MEDIAN.nx, JF_MEDIAN.nz, JF_MEDIAN, 0.7, true)
    await shot('before-foot-median', 0.85, 0.24)
    const carBefore = await mountAndDrive(carMedianStart, '开车', 'car', JF_MEDIAN, 2.15)
    await shot('before-car-median', 0.72, 0.20)
    await dismountClean()
    const summary = {mode: 'before', footBefore, carBefore}
    await writeFile(`${outDir}/before.json`, JSON.stringify(summary, null, 2) + '\n')
    console.log('BEFORE CAPTURE:', JSON.stringify(summary))
  } else {
    const results = {}

    // 1. Foot head-on & oblique against Jiefang East Rd median guardrail (kind=1/2)
    results.footJfMedianHeadOn = await walkAttempt(JF_MEDIAN.x - JF_MEDIAN.nx * 2.8, JF_MEDIAN.z - JF_MEDIAN.nz * 2.8, JF_MEDIAN.nx, JF_MEDIAN.nz, JF_MEDIAN, 1.8, true)
    await shot('after-foot-median', -1.05, 0.18)
    assert(!results.footJfMedianHeadOn.crossed && results.footJfMedianHeadOn.endSigned < -0.25 && results.footJfMedianHeadOn.hitRail, `foot Jiefang median head-on failed: ${JSON.stringify(results.footJfMedianHeadOn)}`)

    results.footJfMedianOblique = await walkAttempt(JF_MEDIAN.x - JF_MEDIAN.nx * 2.5, JF_MEDIAN.z - JF_MEDIAN.nz * 2.5, JF_MEDIAN.nx * 0.7 + JF_MEDIAN.tx * 0.7, JF_MEDIAN.nz * 0.7 + JF_MEDIAN.tz * 0.7, JF_MEDIAN, 1.8, true)
    assert(!results.footJfMedianOblique.crossed && results.footJfMedianOblique.endSigned < -0.25 && results.footJfMedianOblique.totalDist > 2.5, `foot Jiefang median oblique slide failed: ${JSON.stringify(results.footJfMedianOblique)}`)

    // 2. Foot head-on against Jiefang East Rd south verge (kind=5)
    results.footJfVergeHeadOn = await walkAttempt(JF_VERGE.x - JF_VERGE.nx * 3.0, JF_VERGE.z - JF_VERGE.nz * 3.0, JF_VERGE.nx, JF_VERGE.nz, JF_VERGE, 1.8, true)
    await shot('after-foot-verge', 0.85, 0.24)
    assert(!results.footJfVergeHeadOn.crossed && results.footJfVergeHeadOn.endSigned < -0.5 && results.footJfVergeHeadOn.hitRail, `foot Jiefang verge head-on failed: ${JSON.stringify(results.footJfVergeHeadOn)}`)

    // 3. Foot head-on against Zhongshan Middle Rd median (upgraded to central crape-myrtle green trees)
    results.footZsMedianHeadOn = await walkAttempt(ZS_MEDIAN.x - ZS_MEDIAN.nx * 3.0, ZS_MEDIAN.z - ZS_MEDIAN.nz * 3.0, ZS_MEDIAN.nx, ZS_MEDIAN.nz, ZS_MEDIAN, 1.8, true)
    await shot('showcase-zhongshan-median-trees', 0.95, 0.20)
    assert(!results.footZsMedianHeadOn.crossed && results.footZsMedianHeadOn.endSigned < -0.25 && results.footZsMedianHeadOn.hitRail, `foot Zhongshan median failed: ${JSON.stringify(results.footZsMedianHeadOn)}`)

    // 3b. Foot head-on against Zhongshan Middle Rd verge (tree-pit + redwood flower planter)
    results.footZsVergeHeadOn = await walkAttempt(ZS_VERGE.x - ZS_VERGE.nx * 3.0, ZS_VERGE.z - ZS_VERGE.nz * 3.0, ZS_VERGE.nx, ZS_VERGE.nz, ZS_VERGE, 1.8, true)
    await shot('showcase-zhongshan-verge-planter', 0.92, 0.22)
    assert(!results.footZsVergeHeadOn.crossed && results.footZsVergeHeadOn.endSigned < -0.45 && results.footZsVergeHeadOn.hitRail, `foot Zhongshan verge planter failed: ${JSON.stringify(results.footZsVergeHeadOn)}`)

    // 4. E-bike head-on against Jiefang East Rd median (kind=1/2)
    results.ebikeJfMedian = await mountAndDrive(bikeMedianStart, '骑电动车', 'bike', JF_MEDIAN, 2.2)
    await shot('after-ebike-median', -0.95, 0.18)
    assert(!results.ebikeJfMedian.crossed && results.ebikeJfMedian.endSigned < -0.25 && (results.ebikeJfMedian.hitRail || results.ebikeJfMedian.obstacleSeen === 'collision'), `e-bike median block failed: ${JSON.stringify(results.ebikeJfMedian)}`)
    await dismountClean()

    // 5. Bicycle head-on against Jiefang East Rd verge (kind=5) from cycleway
    results.bicycleJfVerge = await mountAndDrive(bicycleVergeStart, '骑单车', 'bicycle', JF_VERGE, 2.4)
    assert(!results.bicycleJfVerge.crossed && results.bicycleJfVerge.endSigned > 0.5 && (results.bicycleJfVerge.hitRail || results.bicycleJfVerge.obstacleSeen === 'collision'), `bicycle verge block failed: ${JSON.stringify(results.bicycleJfVerge)}`)
    await dismountClean()

    // 6. Car head-on & oblique against Jiefang East Rd median (kind=1/2) and Zhongshan Middle Rd verge (kind=5)
    results.carJfMedianHeadOn = await mountAndDrive(carMedianStart, '开车', 'car', JF_MEDIAN, 2.6)
    await shot('after-car-median', -0.88, 0.18)
    assert(!results.carJfMedianHeadOn.crossed && results.carJfMedianHeadOn.endSigned < -1.2 && results.carJfMedianHeadOn.obstacleSeen === 'collision', `car median head-on block failed: ${JSON.stringify(results.carJfMedianHeadOn)}`)
    await dismountClean()

    results.carJfMedianOblique = await mountAndDrive(carObliqueStart, '开车', 'car', JF_MEDIAN, 2.8)
    assert(!results.carJfMedianOblique.crossed && results.carJfMedianOblique.endSigned < -0.8 && results.carJfMedianOblique.obstacleSeen === 'collision', `car median oblique block failed: ${JSON.stringify(results.carJfMedianOblique)}`)
    await dismountClean()

    results.carZsVergeHeadOn = await mountAndDrive(carVergeStart, '开车', 'car', ZS_VERGE, 2.6)
    assert(!results.carZsVergeHeadOn.crossed && results.carZsVergeHeadOn.endSigned < -1.5 && results.carZsVergeHeadOn.obstacleSeen === 'collision', `car Zhongshan verge block failed: ${JSON.stringify(results.carZsVergeHeadOn)}`)
    await dismountClean()

    // 7. Intersection / crosswalk opening pass-through (foot + car must cross cleanly with zero invisible wall)
    results.footGapPass = await walkAttempt(JF_GAP.x - JF_GAP.nx * 4.5, JF_GAP.z - JF_GAP.nz * 4.5, JF_GAP.nx, JF_GAP.nz, JF_GAP, 2.0, true)
    assert(results.footGapPass.crossed && results.footGapPass.endSigned > 2.0, `foot intersection gap blocked: ${JSON.stringify(results.footGapPass)}`)

    results.carGapPass = await mountAndDrive(carGapStart, '开车', 'car', JF_EAST_GAP, 3.0)
    assert(results.carGapPass.crossed && results.carGapPass.endSigned > 2.5 && !results.carGapPass.obstacleSeen, `car intersection gap blocked: ${JSON.stringify(results.carGapPass)}`)
    await dismountClean()

    // 8. Planted median (kind=7) & stone-pillar iron fence (kind=8) must block
    results.footKind7 = await walkAttempt(KIND7_HEDGE.x - KIND7_HEDGE.nx * 3.0, KIND7_HEDGE.z - KIND7_HEDGE.nz * 3.0, KIND7_HEDGE.nx, KIND7_HEDGE.nz, KIND7_HEDGE, 1.8, true)
    assert(!results.footKind7.crossed && results.footKind7.endSigned < -0.45 && results.footKind7.hitRail, `kind=7 planted median block failed: ${JSON.stringify(results.footKind7)}`)

    // kind=8 stone-pillar fence separates building courtyard (-n) from sidewalk (+n); approach from open sidewalk (+n) toward -n.
    results.footKind8 = await walkAttempt(KIND8_FENCE.x + KIND8_FENCE.nx * 2.2, KIND8_FENCE.z + KIND8_FENCE.nz * 2.2, -KIND8_FENCE.nx, -KIND8_FENCE.nz, KIND8_FENCE, 1.8, true)
    assert(!results.footKind8.crossed && results.footKind8.endSigned > 0.25 && results.footKind8.hitRail, `kind=8 stone-pillar fence block failed: ${JSON.stringify(results.footKind8)}`)

    // 9. Non-blocking ground curb strip (kind=9) & yellow paint (kind=10) must stay walkable
    results.footKind9Pass = await walkAttempt(KIND9_STRIP.x - KIND9_STRIP.nx * 1.6, KIND9_STRIP.z - KIND9_STRIP.nz * 1.6, KIND9_STRIP.nx, KIND9_STRIP.nz, KIND9_STRIP, 2.2, false)
    assert(results.footKind9Pass.crossed && results.footKind9Pass.endSigned > 0.5, `kind=9 low curb strip falsely blocked: ${JSON.stringify(results.footKind9Pass)}`)

    results.footKind10Pass = await walkAttempt(KIND10_STRIPE.x - KIND10_STRIPE.nx * 2.5, KIND10_STRIPE.z - KIND10_STRIPE.nz * 2.5, KIND10_STRIPE.nx, KIND10_STRIPE.nz, KIND10_STRIPE, 2.4, false)
    assert(results.footKind10Pass.crossed && results.footKind10Pass.endSigned > 0.5, `kind=10 yellow paint falsely blocked: ${JSON.stringify(results.footKind10Pass)}`)

    // 9b. Lijiang Rd green boulevard: central crape-myrtle tree median + hedge-curb verge must block cleanly
    results.footLjMedian = await walkAttempt(LJ_MEDIAN.x - LJ_MEDIAN.nx * 3.2, LJ_MEDIAN.z - LJ_MEDIAN.nz * 3.2, LJ_MEDIAN.nx, LJ_MEDIAN.nz, LJ_MEDIAN, 1.8, true)
    await shot('showcase-lijiang-median-green', 0.92, 0.20)
    assert(!results.footLjMedian.crossed && results.footLjMedian.endSigned < -0.30 && results.footLjMedian.hitRail, `foot Lijiang green median failed: ${JSON.stringify(results.footLjMedian)}`)

    results.footLjVerge = await walkAttempt(LJ_VERGE.x - LJ_VERGE.nx * 3.2, LJ_VERGE.z - LJ_VERGE.nz * 3.2, LJ_VERGE.nx, LJ_VERGE.nz, LJ_VERGE, 1.8, true)
    await shot('showcase-lijiang-verge-hedge', 0.95, 0.22)
    assert(!results.footLjVerge.crossed && results.footLjVerge.endSigned < -0.50 && results.footLjVerge.hitRail, `foot Lijiang hedge-curb verge failed: ${JSON.stringify(results.footLjVerge)}`)

    // 9c. Binjiang Rd collector narrow three-band soft delineators must NOT create an invisible wall
    results.footBjSoftPass = await walkAttempt(BJ_SOFT.x - BJ_SOFT.nx * 2.4, BJ_SOFT.z - BJ_SOFT.nz * 2.4, BJ_SOFT.nx, BJ_SOFT.nz, BJ_SOFT, 2.2, false)
    // Step into clear carriageway axis along Binjiang Rd for an unobstructed shot of both soft-delineator rows
    await enterAt(BJ_SOFT.x + BJ_SOFT.nx * 2.6, BJ_SOFT.z + BJ_SOFT.nz * 2.6, headingToward(BJ_SOFT.tx, BJ_SOFT.tz))
    await shot('showcase-binjiang-soft-collector', 0.22, 0.16)
    assert(results.footBjSoftPass.crossed && results.footBjSoftPass.endSigned > 0.5, `Binjiang collector soft delineator falsely blocked: ${JSON.stringify(results.footBjSoftPass)}`)

    // 9d. Capture Jiefang East Rd junction opening & close-up yellow/black end-cap view
    await enterAt(JF_GAP.x - JF_GAP.nx * 3.8 + JF_MEDIAN.tx * 7.5, JF_GAP.z - JF_GAP.nz * 3.8 + JF_MEDIAN.tz * 7.5, headingToward(JF_GAP.nx, JF_GAP.nz))
    await shot('showcase-jiefang-opening-endcap', 0.48, 0.18)

    // 10. Loaded road barrier collider stats around Jiefang East Rd
    await enterAt(JF_MEDIAN.x - JF_MEDIAN.nx * 3.0, JF_MEDIAN.z - JF_MEDIAN.nz * 3.0, 0)
    results.stats = await page.evaluate(() => {
      const {stream} = window.viewer
      let loadedTiles = 0, barrierTiles = 0, totalBarrierColliders = 0, maxTileColliders = 0
      for (const item of stream.loaded.values()) {
        loadedTiles++
        const n = (item.streets.roadBarriers?.length ?? 0) / 7
        if (n > 0) barrierTiles++
        totalBarrierColliders += n
        if (n > maxTileColliders) maxTileColliders = n
      }
      return {loadedTiles, barrierTiles, totalBarrierColliders, maxTileColliders}
    })

    assert.deepEqual(errors, [], `page errors: ${JSON.stringify(errors)}`)
    await writeFile(`${outDir}/after.json`, JSON.stringify(results, null, 2) + '\n')
    console.log('ALL ROAD BARRIER CHECKS PASSED:', JSON.stringify(results.stats))
    for (const [k, v] of Object.entries(results)) {
      if (k !== 'stats') console.log(`  ${k}:`, JSON.stringify(v))
    }
  }
} finally {
  await browser?.close()
  await server.close()
}
