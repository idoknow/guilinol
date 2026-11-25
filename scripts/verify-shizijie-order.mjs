#!/usr/bin/env node
import assert from 'node:assert/strict'
import {mkdir, readFile} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {join} from 'node:path'
import {register} from 'tsx/esm/api'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

register()

const {
  SHIZIJIE_ORIGIN,
  SHIZIJIE_CURB_BARRIER_POLYLINES,
  SHIZIJIE_DECOR_EXCLUSION_POLY,
  SHIZIJIE_NO_PED_CORE_POLY,
  isInShizijieNoPedZone,
  isShizijieCrosswalkRing,
  isShizijieDecorSuppressed,
  pointInRelPoly,
  touchesShizijieTile,
} = await import('../web/src/shizijie-zone.ts')
const {buildRoadBarriers} = await import('../web/src/road-barriers.ts')
const {streetGeometry} = await import('../web/src/street-worker.ts')
const {Traffic} = await import('../web/src/traffic/sim.ts')

const outDir = process.env.SHIZIJIE_ORDER_DIR ?? '/tmp/shizijie-order'
await mkdir(outDir, {recursive: true})

const [OX, OZ] = SHIZIJIE_ORIGIN

function decodeGl04Streets(buf) {
  const data = gunzipSync(buf)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3])
  assert.equal(magic, 'GL04', `Expected GL04 magic, got ${magic}`)
  const vertices = view.getUint32(4, true)
  const indices = view.getUint32(8, true)
  const length = view.getUint32(12, true)
  const offset = 24 + 4 * (256 / 4 + 1) ** 2 + 9 * vertices + 4 * indices
  return JSON.parse(data.subarray(offset, offset + length).toString('utf8'))[1]
}

function pointInRing2D(px, pz, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1]
    const xj = ring[j][0], zj = ring[j][1]
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) {
      inside = !inside
    }
  }
  return inside
}

// ---------------------------------------------------------------------------
// 1. Whitebox verification against baked GL04 tiles & road graph (30s sim)
// ---------------------------------------------------------------------------
console.log('1) Checking baked GL04 chunks (crosswalks, legacy decor, curb barriers)...')
const tiles = [
  {file: 'public/world/101_38.glc', ox: -1024, oz: -256},
  {file: 'public/world/102_38.glc', ox: -768, oz: -256},
  {file: 'public/world/101_37.glc', ox: -1024, oz: -512},
  {file: 'public/world/100_38.glc', ox: -1280, oz: -256},
]

const tileData = []
let totalShizijieCrosswalksMatched = 0
let totalDistantCrosswalksPreserved = 0
let totalSuppressedDecor = 0
let totalOuterDecorPreserved = 0
const surfacePolys = []

for (const tile of tiles) {
  const streets = decodeGl04Streets(await readFile(tile.file))
  tileData.push({...tile, streets})
  const paths = streets[0] ?? []
  const decor = streets[9] ?? []

  for (const [kind, ...rings] of paths) {
    if (kind !== 2 && rings[0]?.length >= 3) {
      const worldRing = rings[0].map(([x, z]) => [tile.ox + x / 100, tile.oz + z / 100])
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (const [wx, wz] of worldRing) {
        if (wx < minX) minX = wx
        if (wx > maxX) maxX = wx
        if (wz < minZ) minZ = wz
        if (wz > maxZ) maxZ = wz
      }
      const holes = rings.slice(1).map(r => r.map(([x, z]) => [tile.ox + x / 100, tile.oz + z / 100]))
      surfacePolys.push({kind, outer: worldRing, holes, minX, maxX, minZ, maxZ})
    }
    if (kind === 2 && rings[0]?.length >= 4) {
      const localRing = rings[0].map(([x, z]) => [x / 100, z / 100])
      if (touchesShizijieTile(tile.ox, tile.oz) && isShizijieCrosswalkRing(localRing, tile.ox, tile.oz)) {
        totalShizijieCrosswalksMatched++
      } else {
        // Count distant legitimate crosswalks to prove we didn't over-delete
        const cx = localRing.reduce((s, p) => s + p[0], 0) / localRing.length + tile.ox - OX
        const cz = localRing.reduce((s, p) => s + p[1], 0) / localRing.length + tile.oz - OZ
        if (Math.abs(cx) > 150 || Math.abs(cz) > 150) {
          // Verify distant marking polygons outside Shizijie are never suppressed
          assert.equal(isShizijieCrosswalkRing(localRing, tile.ox, tile.oz), false)
          if (Math.abs(cx) < 260 && Math.abs(cz) < 260) totalDistantCrosswalksPreserved++
        }
      }
    }
  }

  for (const item of decor) {
    const kind = item[0], wx = tile.ox + item[1] / 10, wz = tile.oz + item[2] / 10
    if (isShizijieDecorSuppressed(wx, wz, kind)) {
      totalSuppressedDecor++
    } else if (kind === 1 || kind === 2 || kind === 4 || kind === 5 || kind === 6 || kind === 7) {
      const rx = wx - OX, rz = wz - OZ
      if (Math.abs(rx) < 160 && Math.abs(rz) < 160) totalOuterDecorPreserved++
    }
  }
}

assert(totalShizijieCrosswalksMatched >= 50, `Expected Shizijie crosswalk bars >= 50, got ${totalShizijieCrosswalksMatched}`)
assert(totalSuppressedDecor >= 40, `Expected suppressed legacy Shizijie decor >= 40, got ${totalSuppressedDecor}`)
assert(totalOuterDecorPreserved > 0, 'Expected surrounding outer district decor preserved')
console.log(`  Crosswalk bars matched for removal: ${totalShizijieCrosswalksMatched}; distant preserved markings: ${totalDistantCrosswalksPreserved}`)
console.log(`  Suppressed Shizijie legacy decor: ${totalSuppressedDecor}; surrounding decor preserved: ${totalOuterDecorPreserved}`)

// Verify streetGeometry actually outputs 0 matrices when given ONLY suppressed decor inside Shizijie,
// and emits 0 triangles for all Shizijie crosswalk rings.
const mainTile = tileData[0]
const suppressedDecorOnly = (mainTile.streets[9] ?? []).filter(d => isShizijieDecorSuppressed(mainTile.ox + d[1] / 10, mainTile.oz + d[2] / 10, d[0]))
const crosswalkPathsOnly = (mainTile.streets[0] ?? []).filter(([k, r]) => k === 2 && r?.length >= 4 && isShizijieCrosswalkRing(r.map(([x, z]) => [x / 100, z / 100]), mainTile.ox, mainTile.oz))
const emptyStreetsWithSuppressedOnly = [[], [], [], [], [], null, [], [], [], suppressedDecorOnly, [], null, null, null, [], [], []]
const suppressedOut = streetGeometry(emptyStreetsWithSuppressedOnly, () => 151.3, [], [], () => 151.3, undefined, new Set(), [mainTile.ox, mainTile.oz])
assert.equal(suppressedOut.furnitureMatrices.length, 0, 'Suppressed Shizijie decor must emit 0 visual furniture instances')
const crosswalkStreetsOnly = [crosswalkPathsOnly, [], [], [], [], null, [], [], [], [], [], null, null, null, [], [], []]
const crosswalkOut = streetGeometry(crosswalkStreetsOnly, () => 151.3, [], [], () => 151.3, undefined, new Set(), [mainTile.ox, mainTile.oz])
assert.equal(crosswalkOut.positions.length, 0, 'Shizijie crosswalk polygons must emit 0 street triangles')
assert.equal(crosswalkOut.road.length, 0, 'Shizijie crosswalk polygons must emit 0 road triangles')

// Verify roadBarriers keeps full outer curb walls cleanly merged inside Shizijie
const shizijieBarriers = buildRoadBarriers(mainTile.streets[9] ?? [], () => 151.3, [mainTile.ox, mainTile.oz])
const legacyBarriers = buildRoadBarriers(mainTile.streets[9] ?? [], () => 151.3)
assert(shizijieBarriers.length > legacyBarriers.length, `Expected continuous curb barriers added (${shizijieBarriers.length / 7} vs legacy ${legacyBarriers.length / 7})`)

// Verify 30s Traffic NPC simulation strictly on outer sidewalks around Shizijie (with real GL04 surfaceLookup)
console.log('2) Checking 30s NPC Traffic simulation around Shizijie with real GL04 surfaceAt...')
const surfaceAt = (wx, wz) => {
  const kinds = []
  for (const p of surfacePolys) {
    if (wx < p.minX || wx > p.maxX || wz < p.minZ || wz > p.maxZ) continue
    if (!pointInRing2D(wx, wz, p.outer)) continue
    if (p.holes.some(h => pointInRing2D(wx, wz, h))) continue
    if (!kinds.includes(p.kind)) kinds.push(p.kind)
  }
  return kinds.length ? kinds : undefined
}
const graph = JSON.parse(gunzipSync(await readFile('public/world/roads/-2_-1.json.gz')).toString('utf8'))
const sim = new Traffic(graph, () => 0.42, 100, undefined, surfaceAt)
const camShizijie = {x: OX, y: 151.3, z: OZ}
let simPedSamples = 0
let simMaxActivePeds = 0
let simViolations = 0
for (let step = 0; step < 600; step++) {
  sim.step(0.05, camShizijie, () => false)
  let activeNear = 0
  for (const a of sim.actors) {
    if (a.kind !== 'person') continue
    const rx = a.x - OX, rz = a.z - OZ
    if (Math.abs(rx) <= 105 && Math.abs(rz) <= 95) {
      activeNear++
      simPedSamples++
      if (isInShizijieNoPedZone(a.x, a.z)) simViolations++
    }
  }
  if (activeNear > simMaxActivePeds) simMaxActivePeds = activeNear
}
assert(simMaxActivePeds >= 1 && simPedSamples >= 50, `Expected active Shizijie sidewalk NPCs during 30s sim, got max=${simMaxActivePeds}, samples=${simPedSamples}`)
assert.equal(simViolations, 0, `NPC entered Shizijie forbidden carriageway/crossing zone ${simViolations} times`)
console.log(`  30s Traffic unit sim OK: maxActive=${simMaxActivePeds}, totalSamples=${simPedSamples}, violations=${simViolations}`)

// ---------------------------------------------------------------------------
// 2. Live Browser E2E (Metal Headless Chromium) + Screenshots + Curb Collision
// ---------------------------------------------------------------------------
console.log('3) Launching Playwright headless Metal Chromium against built dist/...')
const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
let browser
const errors = []

try {
  browser = await chromium.launch(browserOptions({headless: true}))
  const page = await browser.newPage({viewport: {width: 1280, height: 720}})
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`))
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.location().url}: ${msg.text()}`)
  })
  await page.route('**/favicon.ico', route => route.fulfill({status: 204}))
  await page.route('**/api/t', route => route.fulfill({status: 204}))
  await page.route('**/stats.rcpd.cc/**', route => route.fulfill({status: 204, body: ''}))

  // --- Pass A: Overhead view + 30s live traffic check in Tour mode ---
  await page.goto(`${baseUrl}/?verify&play=tour&traffic=1&flow=0&time=10.5&radius=320`, {waitUntil: 'domcontentloaded', timeout: 120000})
  await page.waitForFunction(() => window.viewer?.camera && window.viewer?.stream && ![1, 2].includes(window.__loading?.level), null, {timeout: 90000})

  // Move camera below the y < 250 m traffic activation threshold at Shizijie center.
  await page.evaluate(({ox, oz}) => {
    const {camera, stream} = window.viewer
    camera.position.set(ox, 151.3 + 96, oz + 8)
    camera.lookAt(ox, 151.3, oz)
    camera.updateMatrixWorld()
    stream.tick(camera.position)
  }, {ox: OX, oz: OZ})

  await page.waitForFunction(() => {
    const v = window.viewer
    const loads = v.trafficProbe?.loads ?? []
    return v.trafficProbe && !v.stats.pending && loads.some(l => l.key === '-2_-1')
  }, null, {timeout: 90000})
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  await page.evaluate(() => window.viewer.freeze())
  await page.evaluate(({ox, oz}) => {
    const {camera, redrawGfx} = window.viewer
    camera.position.set(ox, 151.3 + 96, oz + 8)
    camera.lookAt(ox, 151.3, oz)
    camera.updateMatrixWorld()
    redrawGfx?.()
  }, {ox: OX, oz: OZ})
  await page.screenshot({path: join(outDir, '01-overhead.png'), timeout: 60000})

  // Step 30s live street traffic inside the browser engine around Shizijie
  const liveTrafficStats = await page.evaluate(({ox, oz, poly}) => {
    const inPoly = (wx, wz) => {
      const rx = wx - ox, rz = wz - oz
      if (rx < -105 || rx > 88 || rz < -88 || rz > 84) return false
      let inside = false
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1]
        if ((zi > rz) !== (zj > rz) && rx < ((xj - xi) * (rz - zi)) / (zj - zi) + xi) inside = !inside
      }
      return inside
    }
    const probe = window.viewer.trafficProbe
    let samples = 0, violations = 0, maxActive = 0
    for (let i = 0; i < 600; i++) {
      window.viewer.stepStreetTraffic()
      let near = 0
      for (const p of probe.pedestriansDetail ?? []) {
        const rx = p.x - ox, rz = p.z - oz
        if (Math.abs(rx) <= 105 && Math.abs(rz) <= 95) {
          near++; samples++
          if (inPoly(p.x, p.z)) violations++
        }
      }
      if (near > maxActive) maxActive = near
    }
    return {samples, violations, maxActive, simTime: probe.simTime}
  }, {ox: OX, oz: OZ, poly: SHIZIJIE_NO_PED_CORE_POLY})

  assert(liveTrafficStats.maxActive >= 1 && liveTrafficStats.samples > 0, `Expected live pedestrians near Shizijie in browser, got ${JSON.stringify(liveTrafficStats)}`)
  assert.equal(liveTrafficStats.violations, 0, `Live browser pedestrians crossed Shizijie road zone: ${JSON.stringify(liveTrafficStats)}`)
  console.log(`  Live browser 30s Traffic OK:`, liveTrafficStats)

  // --- Pass B: Walk mode 4-corner street views & continuous curb barrier physics ---
  await page.goto(`${baseUrl}/?verify&solo=1&mode=walk&flow=0&time=10.5&radius=320`, {waitUntil: 'domcontentloaded', timeout: 120000})
  await page.waitForFunction(() => window.viewer?.walk?.active && ![1, 2].includes(window.__loading?.level), null, {timeout: 90000})

  const corners = [
    {name: '02-nw-corner.png', label: 'NW', relX: -22.0, relZ: -26.5, lookRelX: 0, lookRelZ: 0, dirX: 0.45, dirZ: 0.89},
    {name: '03-ne-corner.png', label: 'NE', relX: 46.0, relZ: -2.5, lookRelX: 10, lookRelZ: 2, dirX: -0.24, dirZ: 0.97},
    {name: '04-se-corner.png', label: 'SE', relX: 35.0, relZ: 33.0, lookRelX: 10, lookRelZ: 10, dirX: -0.24, dirZ: -0.97},
    {name: '05-sw-corner.png', label: 'SW', relX: -55.0, relZ: 19.0, lookRelX: -15, lookRelZ: 4, dirX: 0.22, dirZ: -0.97},
  ]

  const barrierResults = []
  for (const corner of corners) {
    const sx = OX + corner.relX, sz = OZ + corner.relZ
    const tx = OX + corner.lookRelX, tz = OZ + corner.lookRelZ
    const yaw = Math.atan2(-(tx - sx), -(tz - sz))

    const ok = await page.evaluate(async ({x, z, yaw}) => {
      const {walk, stream} = window.viewer
      walk.leave()
      const entered = await walk.enter(x, z, yaw, 'verify-shizijie')
      if (!entered) return false
      for (let i = 0; i < 40; i++) {
        stream.tick(walk.position)
        walk.tick(1 / 60)
      }
      walk.showFigure(true)
      walk.face(yaw, 0.08)
      return true
    }, {x: sx, z: sz, yaw})
    assert(ok, `Failed to spawn on ${corner.label} outer sidewalk at (${sx}, ${sz})`)

    await page.waitForFunction(() => !window.viewer.stats.pending, null, {timeout: 30000})
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    await page.evaluate(() => window.viewer.redrawGfx?.())
    await page.screenshot({path: join(outDir, corner.name), timeout: 60000})

    const res = await page.evaluate(({dirX, dirZ, ox, oz, poly}) => {
      const inPoly = (wx, wz) => {
        const rx = wx - ox, rz = wz - oz
        if (rx < -105 || rx > 88 || rz < -88 || rz > 84) return false
        let inside = false
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1]
          if ((zi > rz) !== (zj > rz) && rx < ((xj - xi) * (rz - zi)) / (zj - zi) + xi) inside = !inside
        }
        return inside
      }
      const {walk} = window.viewer
      const len = Math.hypot(dirX, dirZ)
      const ux = dirX / len, uz = dirZ / len
      const start = walk.position.clone()
      let hitRail = false, enteredRoadZone = false
      walk.drive(ux, uz, true)
      for (let i = 0; i < 210; i++) {
        walk.tick(1 / 60)
        const p = walk.probe()
        if (p.hits?.includes('rail')) hitRail = true
        if (inPoly(p.x, p.z)) enteredRoadZone = true
      }
      walk.drive(0, 0, false)
      const end = walk.position.clone()
      const movedDist = Math.hypot(end.x - start.x, end.z - start.z)
      return {hitRail, enteredRoadZone, movedDist: +movedDist.toFixed(2), endRel: [+(end.x - ox).toFixed(2), +(end.z - oz).toFixed(2)]}
    }, {dirX: corner.dirX, dirZ: corner.dirZ, ox: OX, oz: OZ, poly: SHIZIJIE_NO_PED_CORE_POLY})

    assert.equal(res.enteredRoadZone, false, `${corner.label} player crossed curb into Shizijie roadway! ${JSON.stringify(res)}`)
    assert(res.hitRail, `${corner.label} player did not register rail collision stopping walk-out: ${JSON.stringify(res)}`)
    assert(res.movedDist < 5.0, `${corner.label} player moved too far (${res.movedDist}m) instead of being blocked at sidewalk curb`)
    barrierResults.push({corner: corner.label, ...res})
  }

  console.log('  Player 4-corner curb collision OK:', barrierResults)
  assert.deepEqual(errors, [], `Unexpected browser errors: ${errors.join(' | ')}`)
  console.log(`ALL SHIZIJIE ORDER VERIFICATIONS PASSED! Screenshots in ${outDir}`)
} finally {
  await browser?.close()
  await server.httpServer?.close()
}
