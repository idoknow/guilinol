// IDOK-399 stage 5b — verify bus stop signs and shelters at real stops in a real browser: the file
// loads, every stop within 170 m of the walker is drawn and settled, shelters stand clear of the
// carriageway and of buildings, each column reaches 0.3 m under the ground that is drawn, two draw
// calls, no page errors. Screenshots: each spot with and without the stops, and a close-up of a sign.
// Run `npm run build` first (or set PERF_DIST), then:
//   node --import tsx scripts/verify-bus-stops.mjs [--shots dir] [--profile desktop|mobile|both]
// BUS_STOP_SPOTS=qixing,sanlidian picks spots.

import {mkdir, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {telemetryPreview} from './telemetry-preview.mjs'
import {BURIED, MAX_SHOWN, SHOW_RADIUS} from '../web/src/traffic/bus-stop-layout.ts'

const SPOT_TIMEOUT_MS = 180_000
const PROBE_WAIT_MS = 60_000
const SETTLE_POLL_MS = 500
const SETTLE_MAX_MS = 60_000
const DRAW_FRAMES = 40
const SHOT_SETTLE_MS = 1500
/** A stop in the file and one in the probe are the same within this (keys are rounded to the centimetre). */
const SAME_STOP = 0.05

// Column bottom minus the highest drawn surface under it: 0.3 m under its ground, give or take what the drawn-ground reading misses.
const FOOT_GAP_MIN = -0.35
const FOOT_GAP_MAX = 0.03
// The pole base meets what is drawn under it, as the kerb bollards do.
const POLE_GAP_MAX = 0.06
const MAX_NULL_RATIO = 0.1
const MAX_NEW_DRAWS = 3

const QUERY = 'verify&solo=1&flow=0&time=17&traffic=1'

const PROFILES = {
  desktop: {viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, isMobile: false, hasTouch: false},
  mobile: {viewport: {width: 844, height: 390}, deviceScaleFactor: 2, isMobile: true, hasTouch: true},
}

// The camera looks at `stops[0]`; every listed stop must be drawn, the shelters standing.
const SPOTS = [
  {id: 'qixing', label: '七星公园站牌', stops: [{at: [256.44, 167.30], shelter: false}, {at: [212.27, 39.08], shelter: false}, {at: [211.88, 72.90], shelter: false}]},
  {id: 'nanmenqiao', label: '南门桥南亭', stops: [{at: [-1777.74, 1085.53], shelter: true}]},
  {id: 'sanlidian', label: '三里店广场两亭', stops: [{at: [1315.17, 1842.71], shelter: true}, {at: [1318.72, 1872.72], shelter: true}]},
  {id: 'pengjialing', label: '彭家岭两亭', stops: [{at: [1398.66, -1052.13], shelter: true}, {at: [1446.26, -973.36], shelter: true}]},
  {id: 'xinjian', label: '新建路口站牌', stops: [{at: [-136.96, -4134.16], shelter: false}, {at: [-158.11, -4135.61], shelter: false}]},
]

function parseArgs(argv) {
  let profile = 'both', shots = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--profile') profile = argv[++i]
    else if (arg.startsWith('--profile=')) profile = arg.slice('--profile='.length)
    else if (arg === '--shots') shots = argv[++i]
    else if (arg.startsWith('--shots=')) shots = arg.slice('--shots='.length)
    else throw new Error(`Unknown argument ${arg}`)
  }
  const profileNames = profile === 'both' ? ['desktop', 'mobile'] : [profile]
  for (const name of profileNames) if (!PROFILES[name]) throw new Error(`Unknown profile ${name}`)
  return {profileNames, shotsDir: shots ? resolve(shots) : process.env.VERIFY_OUT ? resolve(process.env.VERIFY_OUT) : null}
}

const round = (n, digits = 3) => Number(n.toFixed(digits))

function statsOf(values) {
  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b)
  if (!nums.length) return {min: null, median: null, max: null}
  return {min: round(nums[0]), median: round(nums[Math.floor(nums.length / 2)]), max: round(nums[nums.length - 1])}
}

/** The stop's frame: `n` towards the lane, `t` along the kerb (three's rotation.y). */
const frameOf = stop => ({nx: Math.sin(stop.yaw), nz: Math.cos(stop.yaw), tx: Math.cos(stop.yaw), tz: -Math.sin(stop.yaw)})

/** Centre of what is drawn at the stop: the shelter when it stands, else the pole. */
function centreOf(stop) {
  if (stop.shelterState === 'up' && stop.outline.length) return {x: stop.outline.reduce((s, c) => s + c.x, 0) / 4, z: stop.outline.reduce((s, c) => s + c.z, 0) / 4}
  return {x: stop.x, z: stop.z}
}

function buildCameras(spot, main, others) {
  const {nx, nz, tx, tz} = frameOf(main), centre = centreOf(main), y = main.y
  const cams = [
    // From the carriageway, a little along the kerb, about 10 m off and under the crowns of the street trees.
    {name: 'stop', eye: [round(centre.x + nx * 8.5 + tx * 4.5 * main.side), round(y + 2.3), round(centre.z + nz * 8.5 + tz * 4.5 * main.side)], target: [round(centre.x), round(y + 1.3), round(centre.z)]},
    // From the pavement behind, the other way along the kerb.
    {name: 'stop-back', eye: [round(centre.x - nx * 10 - tx * 9 * main.side), round(y + 4.6), round(centre.z - nz * 10 - tz * 9 * main.side)], target: [round(centre.x), round(y + 1.2), round(centre.z)]},
  ]
  // 2.4 m from the face of the flag sign that looks away from the shelter, level with the name.
  const signX = main.x - nx * 0.37, signZ = main.z - nz * 0.37, away = -main.side
  cams.push({name: 'sign', eye: [round(signX + tx * 2.4 * away + nx * 0.3), round(y + 2.0), round(signZ + tz * 2.4 * away + nz * 0.3)], target: [round(signX), round(y + 2.2), round(signZ)]})
  if (main.shelterState === 'up') cams.push({name: 'fascia', eye: [round(centre.x + nx * 6), round(y + 2.0), round(centre.z + nz * 6)], target: [round(centre.x), round(y + 2.2), round(centre.z)]})
  for (const [index, other] of others.entries()) {
    const f = frameOf(other)
    cams.push({name: `other${index + 1}`, eye: [round(other.x + f.nx * 9 + f.tx * 9), round(other.y + 4), round(other.z + f.nz * 9 + f.tz * 9)], target: [round(other.x), round(other.y + 1.5), round(other.z)]})
  }
  return cams
}

async function detectRenderer(browser) {
  const page = await browser.newPage()
  try {
    return await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2')
      const ext = gl?.getExtension('WEBGL_debug_renderer_info')
      return (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || 'unknown'
    })
  } finally {
    await page.close()
  }
}

async function openSpotPage(context, baseUrl, spot, diag) {
  const page = await context.newPage()
  page.on('console', msg => { if (msg.type() === 'error') diag.consoleErrors.push(msg.text()) })
  page.on('pageerror', err => { diag.pageErrors.push(err.message) })
  await page.goto(`${baseUrl}/?${QUERY}`, {timeout: 120_000})
  await page.waitForFunction(() => Boolean(window.viewer?.walk?.active), null, {timeout: 120_000})
  // Walk to the stop, then pin the camera through `window.__pin` so the shots do not follow the walker.
  await page.evaluate(async ({at}) => {
    const viewer = window.viewer
    if (!(await viewer.walkTo(at[0], at[1], 0, 'verify-bus-stops'))) throw new Error('viewer.walkTo returned false')
    const y = viewer.walk.position.y
    window.__pin = {eye: [at[0] + 14, y + 16, at[1] + 14], target: [at[0], y, at[1]]}
    const tick = viewer.walk.tick.bind(viewer.walk)
    const applyPin = () => {
      const pin = window.__pin
      if (!pin) return
      viewer.perfTarget = pin.target
      viewer.camera.position.set(pin.eye[0], pin.eye[1], pin.eye[2])
      viewer.camera.lookAt(pin.target[0], pin.target[1], pin.target[2])
      viewer.camera.updateMatrixWorld()
    }
    window.__applyPin = applyPin
    applyPin()
    viewer.walk.tick = elapsed => { tick(elapsed); applyPin() }
  }, {at: spot.stops[0].at})
  await page.waitForFunction(() => {
    const viewer = window.viewer
    if (!viewer?.stats?.firstMs || viewer.stats.pending) return false
    if (!viewer.walk?.active || !viewer.trafficProbe) return false
    const pos = viewer.walk.position
    return viewer.manifest.chunks.every(tile => Math.hypot(tile.x + 128 - pos.x, tile.z + 128 - pos.z) > viewer.stream.radius || viewer.stream.loaded.has(tile))
  }, null, {timeout: 120_000})
  return page
}

async function captureCameras(page, profileName, spotId, cams, shotsDir) {
  for (const cam of cams) {
    await page.evaluate(pin => { window.__pin = pin; window.__applyPin?.() }, {eye: cam.eye, target: cam.target})
    await page.waitForTimeout(SHOT_SETTLE_MS)
    await page.screenshot({path: join(shotsDir, `${profileName}-${spotId}-${cam.name}.jpg`), type: 'jpeg', quality: 88})
    // The same frame without the stops: what the street looked like before this stage (the old blank sign is gone too).
    await page.evaluate(() => window.viewer.trafficProbe.busStopsShown(false))
    await page.waitForTimeout(250)
    await page.screenshot({path: join(shotsDir, `${profileName}-${spotId}-${cam.name}-before.jpg`), type: 'jpeg', quality: 88})
    await page.evaluate(() => window.viewer.trafficProbe.busStopsShown(true))
  }
}

/** The stops the walker should see: within 170 m of the probe's focus, not excluded, the nearest 24. */
function expectedStops(rows, excluded, focus) {
  const skip = new Set(excluded)
  return rows
    .map(row => ({x: row[0], z: row[1], key: `${row[0].toFixed(2)},${row[1].toFixed(2)}`, shelter: row[3] === 1, name: row[5] ?? ''}))
    .filter(stop => !skip.has(stop.key))
    .map(stop => ({...stop, distance: Math.hypot(stop.x - focus.x, stop.z - focus.z)}))
    .filter(stop => stop.distance <= SHOW_RADIUS)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_SHOWN)
}

async function verifySpot(browser, baseUrl, profileName, profile, spot, options) {
  const {shotsDir, failures} = options
  const tag = `${profileName}/${spot.id}`
  const diag = {pageErrors: [], consoleErrors: []}
  let context, timer, timedOut = false
  try {
    context = await browser.newContext(profile)
    const work = (async () => {
      const page = await openSpotPage(context, baseUrl, spot, diag)
      const ready = await page
        .waitForFunction(() => typeof window.viewer?.trafficProbe?.busStops === 'function' && window.viewer.trafficProbe.busStops().load === 'ready', null, {timeout: PROBE_WAIT_MS})
        .then(() => true, () => false)
      if (!ready) throw new Error('trafficProbe.busStops() missing or bus-stops.json not loaded')
      const rows = await page.evaluate(async () => (await (await fetch('./street-furniture/bus-stops.json')).json()).stops)
      // The walker stands 13 m out on the carriageway side, behind every camera but the one on the pavement: not in front of the sign.
      const mainRow = rows.find(row => Math.hypot(row[0] - spot.stops[0].at[0], row[1] - spot.stops[0].at[1]) < SAME_STOP)
      if (mainRow) await page.evaluate(([x, z]) => window.viewer.walkTo(x, z, 0, 'verify-bus-stops'), [mainRow[0] + Math.sin(mainRow[2]) * 13, mainRow[1] + Math.cos(mainRow[2]) * 13])

      // Settled: every stop the walker should see is drawn and settled, three polls in a row.
      const started = Date.now()
      let calm = 0, settleMs = null, open = null
      while (Date.now() - started < SETTLE_MAX_MS) {
        const probe = await page.evaluate(() => window.viewer.trafficProbe.busStops())
        const focus = probe.focus ?? {x: spot.stops[0].at[0], z: spot.stops[0].at[1]}
        const expected = expectedStops(rows, probe.excluded, focus)
        open = expected.filter(item => !probe.stops.some(stop => Math.hypot(stop.x - item.x, stop.z - item.z) < SAME_STOP && stop.state === 'drawn' && stop.settled))
        calm = expected.length && !open.length ? calm + 1 : 0
        if (calm >= 3) { settleMs = Date.now() - started; break }
        await page.waitForTimeout(SETTLE_POLL_MS)
      }
      if (settleMs === null) failures.push(`${tag}: ${open?.length ?? '?'} stop(s) within ${SHOW_RADIUS} m not drawn and settled within ${SETTLE_MAX_MS / 1000}s: ${(open ?? []).slice(0, 4).map(item => `${item.name || '(无名)'}@${item.key}`).join(', ')}`)

      const inspected = await page.evaluate(async ({frames}) => {
        const viewer = window.viewer, probe = viewer.trafficProbe
        const busStops = probe.busStops(), focus = busStops.focus ?? {x: viewer.walk.position.x, z: viewer.walk.position.z}
        const draws = await probe.busStopDraws(frames)
        const audit = await probe.busStopAudit(focus, 170)
        // Every mesh in the scene carrying our names: there must be exactly the two.
        const named = probe.busStopMeshes()
        // Buildings: each loaded tile's rings (centimetres from the tile corner), even-odd over every ring of a building.
        let buildings = null
        try {
          buildings = []
          for (const [tile, data] of viewer.stream.loaded) for (const building of data.rings ?? []) {
            const rings = building[2]
            if (!Array.isArray(rings)) continue
            buildings.push(rings.map(ring => ring.map(([east, south]) => [tile.x + east / 100, tile.z + south / 100])))
          }
        } catch { buildings = null }
        const inside = (x, z) => buildings.some(rings => {
          let hit = false
          for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, zi] = ring[i], [xj, zj] = ring[j]
            if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) hit = !hit
          }
          return hit
        })
        const stops = busStops.stops.map(stop => {
          const points = stop.shelterState === 'up' ? [...stop.outline, ...stop.corners] : []
          return {
            ...stop,
            lanes: points.map(point => viewer.stream.surfaceAt(point.x, point.z) ?? null),
            inBuilding: buildings ? points.map(point => inside(point.x, point.z)) : null,
          }
        })
        const strip = ({stops: _stops, ...rest}) => rest
        return {focus, probe: strip(busStops), stops, draws, audit, named, buildingsRead: buildings !== null, calls: viewer.stats?.calls ?? null}
      }, {frames: DRAW_FRAMES})

      const drawn = inspected.stops.filter(stop => stop.state === 'drawn')
      // The listed stops: there, drawn, settled; shelters standing.
      const listed = spot.stops.map(item => ({item, stop: inspected.stops.find(stop => Math.hypot(stop.x - item.at[0], stop.z - item.at[1]) < SAME_STOP)}))
      for (const {item, stop} of listed) {
        if (!stop) { failures.push(`${tag}: stop at ${item.at.join(', ')} not drawn`); continue }
        if (stop.state !== 'drawn' || !stop.settled) failures.push(`${tag}: ${stop.name || stop.key} ${stop.state}, settled ${stop.settled}`)
        if (item.shelter && stop.shelterState !== 'up') failures.push(`${tag}: ${stop.name || stop.key} shelter ${stop.shelterState} (spread ${stop.spread})`)
        if (!item.shelter && stop.shelter) failures.push(`${tag}: ${stop.key} expected a bare sign, has a shelter in the file`)
      }
      // Shelters clear of the carriageway and of buildings.
      for (const stop of drawn) {
        const onLane = stop.lanes.filter(kinds => kinds && (kinds.includes(0) || kinds.includes(5))).length
        if (onLane) failures.push(`${tag}: ${stop.name || stop.key}: ${onLane} shelter corner(s) on the carriageway or a guardrail`)
        if (stop.inBuilding?.some(Boolean)) failures.push(`${tag}: ${stop.name || stop.key}: shelter corner(s) inside a building`)
      }
      // Column bottoms 0.3 m under what is drawn; pole bases on it.
      const footGaps = inspected.audit.flatMap(item => item.feet.map(foot => foot.gap))
      const footNulls = footGaps.filter(gap => gap === null).length
      const footOff = inspected.audit.flatMap(item => item.feet.filter(foot => foot.gap !== null && (foot.gap < FOOT_GAP_MIN || foot.gap > FOOT_GAP_MAX)).map(foot => `${item.key} ${foot.gap} on ${foot.under}`))
      if (footOff.length) failures.push(`${tag}: ${footOff.length} column foot/feet outside ${FOOT_GAP_MIN}…+${FOOT_GAP_MAX} m: ${footOff.slice(0, 4).join(', ')}`)
      if (footGaps.length && footNulls / footGaps.length > MAX_NULL_RATIO) failures.push(`${tag}: ${footNulls}/${footGaps.length} column feet with nothing drawn below`)
      const poleGaps = inspected.audit.map(item => item.pole.gap)
      const floating = inspected.audit.filter(item => item.pole.gap !== null && Math.abs(item.pole.gap) > POLE_GAP_MAX)
      if (floating.length) failures.push(`${tag}: ${floating.length} pole(s) off the drawn ground by > ${POLE_GAP_MAX} m: ${floating.slice(0, 3).map(item => `${item.key} ${item.pole.gap} on ${item.pole.under}`).join(', ')}`)
      // Draw calls: two meshes, each drawn at most once a frame.
      const most = (inspected.draws.parts?.mostPerFrame ?? 0) + (inspected.draws.faces?.mostPerFrame ?? 0)
      if (most > MAX_NEW_DRAWS) failures.push(`${tag}: ${most} bus stop draws in a frame (> ${MAX_NEW_DRAWS})`)
      if (drawn.length && !inspected.draws.parts?.draws) failures.push(`${tag}: stop parts never drawn in ${DRAW_FRAMES} frames`)
      if (drawn.length && !inspected.draws.faces?.draws) failures.push(`${tag}: name faces never drawn in ${DRAW_FRAMES} frames`)
      if (inspected.named.length !== 2) failures.push(`${tag}: ${inspected.named.length} bus stop meshes in the scene: ${inspected.named.join(', ')}`)
      if (inspected.probe.atlas.used > 32) failures.push(`${tag}: atlas ${inspected.probe.atlas.used} cells`)
      if (!inspected.probe.atlas.texture) failures.push(`${tag}: no name atlas texture`)

      if (shotsDir) {
        const main = listed[0].stop
        if (main) await captureCameras(page, profileName, spot.id, buildCameras(spot, main, listed.slice(1).map(entry => entry.stop).filter(Boolean)), shotsDir)
      }
      if (diag.pageErrors.length) failures.push(`${tag}: ${diag.pageErrors.length} pageerror(s): ${diag.pageErrors.slice(0, 3).join('; ')}`)

      return {
        spot: spot.id, profile: profileName, settleMs, focus: inspected.focus,
        probe: inspected.probe, near: drawn.length, shelters: drawn.filter(stop => stop.shelterState === 'up').length,
        skipped: drawn.filter(stop => stop.shelterState === 'skipped').map(stop => ({key: stop.key, name: stop.name, spread: stop.spread})),
        listed: listed.map(({item, stop}) => ({at: item.at, key: stop?.key ?? null, name: stop?.name ?? null, shelterState: stop?.shelterState ?? null, settled: stop?.settled ?? null, named: stop?.named ?? null})),
        footGap: {...statsOf(footGaps), nulls: footNulls, count: footGaps.length, expect: -BURIED},
        poleGap: statsOf(poleGaps),
        // Per stop: where it stands (pole base, collider under it, each column foot) and every drawn surface under those points.
        heights: drawn.map(stop => ({key: stop.key, name: stop.name, y: stop.y, support: stop.support, corners: stop.corners.map(corner => ({y: corner.y, support: corner.support, bottom: corner.bottom})), audit: inspected.audit.find(item => item.key === stop.key) ?? null})),
        buildingsChecked: inspected.buildingsRead,
        draws: inspected.draws, rendererCalls: inspected.calls,
        pageErrors: diag.pageErrors, consoleErrors: diag.consoleErrors,
      }
    })()
    return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error('timeout')) }, SPOT_TIMEOUT_MS) })])
  } catch (err) {
    const message = timedOut ? `spot timed out after ${SPOT_TIMEOUT_MS / 1000}s` : err instanceof Error ? err.message : String(err)
    failures.push(`${tag}: ${message}`)
    return {spot: spot.id, profile: profileName, error: message, pageErrors: diag.pageErrors, consoleErrors: diag.consoleErrors}
  } finally {
    clearTimeout(timer)
    await context?.close().catch(() => {})
  }
}

const args = parseArgs(process.argv.slice(2))
const spotFilter = process.env.BUS_STOP_SPOTS ? new Set(process.env.BUS_STOP_SPOTS.split(',').map(s => s.trim()).filter(Boolean)) : null
const spots = spotFilter?.size ? SPOTS.filter(spot => spotFilter.has(spot.id)) : SPOTS
if (!spots.length) throw new Error(`No matching spots for "${process.env.BUS_STOP_SPOTS}"`)

// Always headless; Metal on macOS unless SwiftShader is forced.
const useMetal = process.platform === 'darwin' && process.env.PERF_SWIFTSHADER !== '1'
let server, browser
try {
  server = await preview({
    plugins: [telemetryPreview], root: 'web', configFile: 'web/vite.config.ts',
    build: {outDir: resolve(process.env.PERF_DIST ?? 'dist')}, preview: {host: '127.0.0.1', port: 0},
  })
  const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({
    headless: true, executablePath: process.env.CHROMIUM || undefined,
    args: useMetal ? ['--enable-gpu', '--use-angle=metal'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const renderer = await detectRenderer(browser)
  if (args.shotsDir) await mkdir(args.shotsDir, {recursive: true})
  const results = [], failures = []
  for (const profileName of args.profileNames) for (const spot of spots) {
    console.error(`[verify-bus-stops] ${profileName}/${spot.id} (${spot.label}) ...`)
    results.push(await verifySpot(browser, baseUrl, profileName, PROFILES[profileName], spot, {shotsDir: args.shotsDir, failures}))
  }
  if (args.shotsDir) await writeFile(join(args.shotsDir, 'verify-bus-stops.json'), JSON.stringify({timestamp: new Date().toISOString(), browser: browser.version(), renderer, results, failures, ok: !failures.length}, null, 2) + '\n')
  for (const row of results) {
    if (row.error) { console.log(`${row.profile}/${row.spot}: ERROR ${row.error}`); continue }
    console.log(`${row.profile}/${row.spot}: ${row.near} stops drawn (${row.shelters} shelters, skipped ${row.skipped.length}), feet gap ${row.footGap.min}…${row.footGap.median}…${row.footGap.max} m (nulls ${row.footGap.nulls}/${row.footGap.count}), pole gap ${row.poleGap.min}…${row.poleGap.max}; draws ${row.draws.parts?.mostPerFrame}+${row.draws.faces?.mostPerFrame}; atlas ${row.probe.atlas.used}/${row.probe.atlas.capacity}; buildings ${row.buildingsChecked ? 'checked' : 'NOT checked (stream.loaded rings unreadable)'}; settle ${row.settleMs} ms`)
  }
  if (failures.length) {
    console.log(`\nFAIL (${failures.length}):`)
    for (const failure of failures) console.log(`  - ${failure}`)
    process.exitCode = 1
  } else {
    const primary = results.filter(row => row.profile === args.profileNames[0])
    console.log(`ok — bus stops: ${primary.reduce((sum, row) => sum + row.near, 0)} stops checked across ${spots.length} spot(s)`)
  }
} finally {
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
}
