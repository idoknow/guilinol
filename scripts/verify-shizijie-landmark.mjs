#!/usr/bin/env node
/**
 * Headless Metal Chromium verification for IDOK-411 Shizijie streetscape reconstruction:
 *  - Zero dynamic Three.js lights, zero pageerror/console.error, all required materials loaded
 *  - Physical barrier enclosure check across NW / NE / SE / SW sidewalk corners (player blocked from carriageway)
 *  - Unobstructed access check at NE_ANNEX「漓行电驴行」deliveryBay -> testRideSpawn
 *  - Multi-angle 1440x900 daytime & nighttime screenshots under /tmp/szj-verify/ (zero desktop clutter)
 */
import assert from 'node:assert/strict'
import {mkdir, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'
import {SHIZIJIE_NO_PED_CORE_POLY} from '../web/src/shizijie-zone.ts'

const ROOT = resolve(import.meta.dirname, '..')
const OUT_DIR = process.env.SZJ_CAPTURE_DIR || '/tmp/szj-verify'

async function settleFrames(page, n = 8) {
  await page.evaluate(
    count =>
      new Promise(resolve => {
        let left = count
        const step = () => {
          window.viewer?.walk?.tick?.(1 / 60)
          if (--left <= 0) resolve()
          else requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }),
    n,
  )
}

async function setHour(page, hour) {
  await page.evaluate(h => {
    const {clock} = window.viewer
    clock.flowing = false
    clock.hour = h
    clock.goal = h
  }, hour)
  await page.waitForFunction(
    targetNight => {
      const night = window.viewer?.env?.night ?? 0
      return targetNight ? night >= 0.9 : night <= 0.1
    },
    hour >= 19 || hour < 5,
    {timeout: 15000},
  )
  await settleFrames(page, 6)
}

async function flyLook(page, eye, target) {
  await page.evaluate(
    ({eye, target}) => {
      const v = window.viewer
      if (v.walk?.active) v.flight()
      v.camera.position.set(eye[0], eye[1], eye[2])
      v.camera.lookAt(target[0], target[1], target[2])
      v.camera.updateMatrixWorld()
      v.redrawGfx?.()
    },
    {eye, target},
  )
  await page.waitForFunction(
    () => (window.viewer?.stream?.pending?.size ?? 0) === 0,
    null,
    {timeout: 20000},
  )
  await settleFrames(page, 8)
}

async function walkView(page, wx, wz, yaw, pitch = 0.04, tag = 'view') {
  await page.evaluate(
    async ({wx, wz, yaw, pitch, tag}) => {
      const ok = await window.viewer.walkTo(wx, wz, yaw, tag)
      if (!ok) throw Error(`walkTo failed for ${tag} at (${wx}, ${wz})`)
      window.viewer.walk.showFigure(false)
      window.viewer.walk.face(yaw, pitch)
      window.viewer.redrawGfx?.()
    },
    {wx, wz, yaw, pitch, tag},
  )
  await page.waitForFunction(
    () => (window.viewer?.stream?.pending?.size ?? 0) === 0,
    null,
    {timeout: 20000},
  )
  await settleFrames(page, 8)
}

await mkdir(OUT_DIR, {recursive: true})
const server = await preview({root: join(ROOT, 'web'), configFile: join(ROOT, 'web/vite.config.ts'), preview: {host: '127.0.0.1', port: 0}})
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
const errors = []
let browser

try {
  browser = await chromium.launch(browserOptions())
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}})
  const page = await ctx.newPage()
  await page.route('**/favicon.ico', route => route.fulfill({status: 204, body: ''}))
  await page.route('**/api/t', route => route.fulfill({status: 204, body: ''}))
  const badUrls = []
  page.on('response', res => {
    if (res.status() >= 400) badUrls.push(`${res.status()} ${res.url()}`)
  })
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await page.goto(`${baseUrl}/?verify=1`, {waitUntil: 'domcontentloaded'})
  await page.waitForFunction(() => Boolean(window.viewer?.manifest && window.viewer?.stream && window.viewer?.walkTo), null, {timeout: 90000})

  const origin = await page.evaluate(() => {
    const lm = window.viewer.manifest.landmarks.find(l => l.id === 'shizijie')
    return {x: lm.position[0], y: lm.position[1], z: lm.position[2]}
  })
  const L = (lx, ly, lz) => [origin.x + lx, origin.y + ly, origin.z + lz]

  // Walk into intersection center so shizijie GLB + surrounding chunks stream completely
  await page.evaluate(async ([wx, _, wz]) => {
    await window.viewer.walkTo(wx, wz, 0, 'szj-init')
  }, L(0, 0, 0))
  await page.waitForFunction(
    () => [...(window.viewer?.stream?.landmarks?.keys() ?? [])].some(e => e.id === 'shizijie') && window.viewer.stats.loaded >= 6,
    null,
    {timeout: 60000},
  )
  await setHour(page, 13.5)

  // 1. Scene graph & material inspection
  const sceneMeta = await page.evaluate(() => {
    const entry = [...window.viewer.stream.landmarks.entries()].find(([e]) => e.id === 'shizijie')
    const root = entry?.[1]
    let lights = 0
    let meshCount = 0
    const materials = new Set()
    const nodeNames = []
    root?.traverse(o => {
      if (o.isLight) lights++
      if (o.isMesh) {
        meshCount++
        if (o.name) nodeNames.push(o.name)
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (m?.name) materials.add(m.name)
        }
      }
    })
    return {lights, meshCount, materials: [...materials].sort(), nodeNames: [...new Set(nodeNames)].sort()}
  })
  assert.equal(sceneMeta.lights, 0, `Shizijie must emit 0 dynamic lights, got ${sceneMeta.lights}`)
  for (const reqMat of ['B_surfaces', 'B_signs', 'shizijie_shop_signs', 'shizijie_surfaces']) {
    assert.ok(sceneMeta.materials.includes(reqMat), `Missing required material ${reqMat} in ${JSON.stringify(sceneMeta.materials)}`)
  }

  // 2. Physical barrier collision verification across 4 corner sidewalks (sprint in world-space toward carriageway)
  // First run an unobstructed control walk with identical sprint ticks to prove the threshold genuinely rejects missing barriers.
  const SPRINT_TICKS = 150
  const MAX_BLOCKED_DIST = 8.0
  const controlWalk = await page.evaluate(
    async ({ox, oz, ticks}) => {
      const {walk, walkTo} = window.viewer
      const ok = await walkTo(ox, oz, Math.atan2(0.97, 0.24), 'control-unobstructed')
      if (!ok) return {ok: false, walked: 0}
      const p0 = {x: walk.position.x, z: walk.position.z}
      const len = Math.hypot(-0.97, -0.24)
      walk.drive(-0.97 / len, -0.24 / len, true)
      for (let i = 0; i < ticks; i++) walk.tick(1 / 60)
      walk.drive(0, 0, false)
      const p1 = {x: walk.position.x, z: walk.position.z}
      return {ok: true, walked: +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2)}
    },
    {ox: origin.x, oz: origin.z, ticks: SPRINT_TICKS},
  )
  assert.equal(controlWalk.ok, true, 'Unobstructed control walk spawn failed')
  assert.ok(
    controlWalk.walked > MAX_BLOCKED_DIST + 4.0,
    `Control walk must clear barrier threshold (${MAX_BLOCKED_DIST}m), got ${controlWalk.walked}m`,
  )

  const barrierChecks = []
  const tests = [
    {name: 'NW_corner_blocked', sx: -22.0, sz: -26.5, tx: -10.0, tz: -6.0, expectBlockedBeforeDist: 6.5},
    {name: 'NE_corner_blocked', sx: 46.0, sz: -2.5, tx: 40.0, tz: 18.0, expectBlockedBeforeDist: 6.5},
    {name: 'SE_corner_blocked', sx: 35.0, sz: 33.0, tx: 30.0, tz: 12.0, expectBlockedBeforeDist: 6.5},
    {name: 'SW_weixiaotang_blocked', sx: -43.0, sz: 28.0, tx: -28.0, tz: 14.0, expectBlockedBeforeDist: 8.0},
  ]
  for (const t of tests) {
    const res = await page.evaluate(
      async ({ox, oz, t, ticks, noPedPoly}) => {
        const inPoly = (wx, wz) => {
          const rx = wx - ox
          const rz = wz - oz
          if (rx < -105 || rx > 88 || rz < -88 || rz > 84) return false
          let inside = false
          for (let i = 0, j = noPedPoly.length - 1; i < noPedPoly.length; j = i++) {
            const xi = noPedPoly[i][0], zi = noPedPoly[i][1], xj = noPedPoly[j][0], zj = noPedPoly[j][1]
            if ((zi > rz) !== (zj > rz) && rx < ((xj - xi) * (rz - zi)) / (zj - zi) + xi) inside = !inside
          }
          return inside
        }
        const {walk, walkTo} = window.viewer
        const sx = ox + t.sx
        const sz = oz + t.sz
        const tx = ox + t.tx
        const tz = oz + t.tz
        const dx = tx - sx
        const dz = tz - sz
        const dlen = Math.hypot(dx, dz)
        const ux = dx / dlen
        const uz = dz / dlen
        const yaw = Math.atan2(-ux, -uz)
        const ok = await walkTo(sx, sz, yaw, `barrier-${t.name}`)
        if (!ok) return {ok: false, name: t.name}
        const p0 = {x: walk.position.x, z: walk.position.z}
        walk.face(yaw, 0)
        let hitBarrier = false
        let enteredRoadZone = false
        walk.drive(ux, uz, true)
        for (let i = 0; i < ticks; i++) {
          walk.tick(1 / 60)
          const p = walk.probe()
          if (p.hits?.some(h => h === 'rail' || h === 'landmark')) hitBarrier = true
          if (inPoly(p.x, p.z)) enteredRoadZone = true
        }
        walk.drive(0, 0, false)
        const p1 = {x: walk.position.x, z: walk.position.z}
        const walked = Math.hypot(p1.x - p0.x, p1.z - p0.z)
        const distToTarget = Math.hypot(p1.x - tx, p1.z - tz)
        return {
          ok: true,
          name: t.name,
          walked: +walked.toFixed(2),
          distToTarget: +distToTarget.toFixed(2),
          hitBarrier,
          enteredRoadZone,
          blocked: walked < t.expectBlockedBeforeDist && hitBarrier && !enteredRoadZone,
        }
      },
      {ox: origin.x, oz: origin.z, t, ticks: SPRINT_TICKS, noPedPoly: SHIZIJIE_NO_PED_CORE_POLY},
    )
    assert.equal(res.ok, true, `Failed to spawn for ${t.name}`)
    assert.equal(res.enteredRoadZone, false, `Pedestrian crossed into Shizijie roadway at ${t.name}: ${JSON.stringify(res)}`)
    assert.equal(res.blocked, true, `Guardrail failed to stop pedestrian at ${t.name}: ${JSON.stringify(res)}`)
    barrierChecks.push(res)
  }

  // Verify e-bike flagship deliveryBay -> testRideSpawn path arrives within tolerance (unblocked by any barrier)
  const ebikePath = await page.evaluate(async () => {
    const {walk, walkTo} = window.viewer
    const sx = -779.14, sz = -157.40
    const tx = -782.25, tz = -150.73
    const yaw = Math.atan2(-(tx - sx), -(tz - sz))
    const startOk = await walkTo(sx, sz, yaw, 'ebike-path')
    if (!startOk) return {startOk: false, reached: false, distToTarget: Infinity, distWalked: 0, endPos: [sx, sz]}
    let reached = false
    for (let i = 0; i < 240; i++) {
      const dx = tx - walk.position.x
      const dz = tz - walk.position.z
      const rem = Math.hypot(dx, dz)
      if (rem <= 0.75) {
        reached = true
        break
      }
      walk.drive(dx / rem, dz / rem, true)
      walk.tick(1 / 60)
    }
    walk.drive(0, 0, false)
    const p = walk.position
    const distWalked = Math.hypot(p.x - sx, p.z - sz)
    const distToTarget = Math.hypot(p.x - tx, p.z - tz)
    return {
      startOk,
      reached: reached || distToTarget <= 1.0,
      distWalked: +distWalked.toFixed(2),
      distToTarget: +distToTarget.toFixed(2),
      endPos: [+p.x.toFixed(2), +p.z.toFixed(2)],
    }
  })
  assert.equal(ebikePath.startOk, true, 'e-bike deliveryBay spawn failed')
  assert.equal(
    ebikePath.reached,
    true,
    `e-bike deliveryBay -> testRideSpawn blocked! distToTarget=${ebikePath.distToTarget}m (${JSON.stringify(ebikePath)})`,
  )

  // 3. Multi-angle Daytime Screenshots (13:30)
  await flyLook(page, L(6, 98, 32), L(12, 0, 2))
  await page.screenshot({path: join(OUT_DIR, '01-day-overhead.png')})

  await flyLook(page, L(-2.5, 2.6, 10.0), L(-2.0, 3.8, -28.0))
  await page.screenshot({path: join(OUT_DIR, '02-day-center-N.png')})

  await flyLook(page, L(-8.0, 2.6, 3.0), L(36.0, 3.6, -2.0))
  await page.screenshot({path: join(OUT_DIR, '03-day-center-E.png')})

  await flyLook(page, L(1.5, 2.6, -8.0), L(8.0, 3.8, 38.0))
  await page.screenshot({path: join(OUT_DIR, '04-day-center-S.png')})

  await flyLook(page, L(10.0, 2.6, -2.0), L(-42.0, 3.6, 8.0))
  await page.screenshot({path: join(OUT_DIR, '05-day-center-W.png')})

  // Closeup: SW underpass plaque, white guardrail + helmet banner, SW island shrubs & bike signal (from roadway looking SW, zero canopy clipping)
  await flyLook(page, L(-26.5, 2.3, 13.5), L(-39.8, 1.8, 24.5))
  await page.screenshot({path: join(OUT_DIR, '06-day-closeup-rail-green.png')})

  // Elevated closeup: North approach gantry + forward direction plaque & 3-aspect vertical visored heads
  await flyLook(page, L(-1.5, 4.4, -39.5), L(1.8, 5.7, -23.5))
  await page.screenshot({path: join(OUT_DIR, '07-day-closeup-gantry-N.png')})

  // Closeup: South approach gantry + roadside twin-post direction sign + SE island greenery/trees
  await flyLook(page, L(7.5, 3.8, 57.5), L(6.5, 4.5, 38.0))
  await page.screenshot({path: join(OUT_DIR, '08-day-closeup-gantry-S.png')})

  // Closeup: East & West approach gantries front faces + dedicated 3.45m bike signal
  await flyLook(page, L(50.0, 4.2, 4.0), L(30.0, 5.4, -1.5))
  await page.screenshot({path: join(OUT_DIR, '12-day-closeup-gantry-E.png')})

  await flyLook(page, L(-66.0, 4.2, 11.5), L(-46.0, 5.4, 15.8))
  await page.screenshot({path: join(OUT_DIR, '13-day-closeup-gantry-W.png')})

  // Closeup: East e-bike flagship frontage (integrity guard)
  await walkView(page, -782.4, -150.2, -0.2317, 0.03, 'day-ebike')
  await page.screenshot({path: join(OUT_DIR, '09-day-ebike-flagship.png')})

  // 4. Nighttime Screenshots (21:00)
  await setHour(page, 21.0)
  await flyLook(page, L(4.0, 3.8, 12.0), L(30.0, 2.8, -4.0))
  await page.screenshot({path: join(OUT_DIR, '10-night-center-NE.png')})

  await flyLook(page, L(18.0, 4.2, -16.0), L(-30.0, 3.2, 14.0))
  await page.screenshot({path: join(OUT_DIR, '11-night-center-SW.png')})

  assert.deepEqual(errors, [], `Runtime console/page errors: ${errors.join('; ')}`)
  assert.deepEqual(badUrls, [], `Unexpected HTTP >=400 responses: ${badUrls.join(', ')}`)
  const report = {ok: true, sceneMeta, controlWalk, barrierChecks, ebikePath, outDir: OUT_DIR}
  await writeFile(join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2))
  console.log('SHIZIJIE VERIFY PASS:', JSON.stringify(report))
} finally {
  if (browser) await browser.close()
  await new Promise(r => server.httpServer.close(r))
}
