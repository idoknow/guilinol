// IDOK-399 stage 5 — verify manhole covers and kerb bollards at fixed spots in a real browser:
// both settle, one draw call each, covers lie on the carriageway a centimetre above what is drawn
// and off the baked road paint, bollards stand on the pavement clear of fences and poles.
// Run `npm run build` first (or set PERF_DIST), then:
//   node --import tsx scripts/verify-street-furniture.mjs [--shots dir] [--profile desktop|mobile|both]
// FURNITURE_SPOTS=zhongshan,east picks spots.

import {mkdir, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {telemetryPreview} from './telemetry-preview.mjs'
import {MANHOLE_MIN_GAP} from '../web/src/traffic/manhole-layout.ts'
import {BOLLARD_MIN_GAP} from '../web/src/traffic/bollard-layout.ts'

const SPOT_TIMEOUT_MS = 180_000
const PROBE_WAIT_MS = 60_000
const NEAR_RADIUS = 90
const SETTLE_POLL_MS = 500
const SETTLE_MAX_MS = 60_000
const DRAW_FRAMES = 40
const SHOT_SETTLE_MS = 1500

// A cover is draped 1.1 cm above the road colliders; what is drawn there is within a few millimetres of them.
const GAP_MIN = 0.002
const GAP_MAX = 0.03
const MAX_GAP_OFF_RATIO = 0.1
// The covers are laid out from the road graph, which knows nothing of the paint baked into the tiles.
// A cover whose centre or rim lands on paint is counted; more than this share of them fails.
const MAX_ON_PAINT_RATIO = 0.12
const MAX_NONE_RATIO = 0.6
// A post stands on the ground as drawn (tile ground mesh or street surface, `drawn-ground.ts`), so its
// base meets what is drawn under it. Only where that is not read (bridges, tunnel fringes, landmark
// models) does it fall back to the walking collider, which can ride a hand's width above the drawing.
const POST_GAP_MAX = 0.06
const POST_SUNK_MAX = 0.06
// Reported, not failed: posts whose base is this far above the drawn ground (they read a little tall).
const POST_GAP_SNUG = 0.02
const MAX_POST_TOUCHING_RATIO = 0.1

const QUERY = 'verify&solo=1&flow=0&time=17&traffic=1'

const PROFILES = {
  desktop: {viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, isMobile: false, hasTouch: false},
  mobile: {viewport: {width: 844, height: 390}, deviceScaleFactor: 2, isMobile: true, hasTouch: true},
}

// `posts`: a signalised junction is in reach, so bollards are expected.
const SPOTS = [
  {id: 'zhongshan', label: '中山路-解放西路口', at: [-1454, -330], posts: true},
  {id: 'nanqu', label: '南区主干路口', at: [-2075, 1920], posts: true},
  {id: 'east', label: '东岸支路', at: [-168.7, -1003.3], posts: false},
  {id: 'southeast', label: '东南居民街', at: [367.5, -1813.5], posts: false},
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

/** Looking down the lane at a cover from behind and a little to the left, the way a driver sees it. */
function coverCamera(cover, back = 5, up = 2.4) {
  const rightX = -cover.headingZ, rightZ = cover.headingX
  return {
    eye: [round(cover.x - cover.headingX * back - rightX * 1.5), round(cover.y + up), round(cover.z - cover.headingZ * back - rightZ * 1.5)],
    target: [round(cover.x + cover.headingX * 1.5), round(cover.y), round(cover.z + cover.headingZ * 1.5)],
  }
}

const topCamera = (item, up = 6) => ({eye: [round(item.x + 0.01), round(item.y + up), round(item.z + 0.01)], target: [round(item.x), round(item.y), round(item.z)]})

/** From the road side at standing height, a few metres off. */
function postCamera(post, walker) {
  const dx = walker.x - post.x, dz = walker.z - post.z, length = Math.hypot(dx, dz) || 1
  return {
    eye: [round(post.x + dx / length * 7), round(post.y + 2.2), round(post.z + dz / length * 7)],
    target: [round(post.x), round(post.y + 0.5), round(post.z)],
  }
}

function buildCameras(overview, covers, posts, walker) {
  const byDistance = items => [...items].sort((a, b) => Math.hypot(a.x - walker.x, a.z - walker.z) - Math.hypot(b.x - walker.x, b.z - walker.z) || String(a.key).localeCompare(String(b.key)))
  const cams = [{name: 'overview', ...overview}]
  const near = byDistance(covers)
  for (const kind of [0, 1, 2]) {
    const cover = near.find(item => item.kind === kind)
    if (!cover) continue
    cams.push({name: `cover${kind}`, ...coverCamera(cover)})
    cams.push({name: `cover${kind}-top`, ...topCamera(cover, 4)})
  }
  const post = byDistance(posts)[0]
  if (post) {
    cams.push({name: 'posts', ...postCamera(post, walker)})
    cams.push({name: 'posts-top', ...topCamera(post, 9)})
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
  // Walk to the spot, then pin the camera through `window.__pin` so the shots do not follow the walker.
  const overview = await page.evaluate(async ({at}) => {
    const viewer = window.viewer
    if (!(await viewer.walkTo(at[0], at[1], 0, 'verify-street-furniture'))) throw new Error('viewer.walkTo returned false')
    const y = viewer.walk.position.y
    const eye = [+(at[0] + 16).toFixed(3), +(y + 18).toFixed(3), +(at[1] + 16).toFixed(3)]
    const target = [+at[0].toFixed(3), +y.toFixed(3), +at[1].toFixed(3)]
    window.__pin = {eye, target}
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
    return {eye, target}
  }, {at: spot.at})
  await page.waitForFunction(() => {
    const viewer = window.viewer
    if (!viewer?.stats?.firstMs || viewer.stats.pending) return false
    if (!viewer.walk?.active || !viewer.trafficProbe) return false
    const pos = viewer.walk.position
    return viewer.manifest.chunks.every(tile => Math.hypot(tile.x + 128 - pos.x, tile.z + 128 - pos.z) > viewer.stream.radius || viewer.stream.loaded.has(tile))
  }, null, {timeout: 120_000})
  return {page, overview}
}

async function captureCameras(page, profileName, spotId, cams, shotsDir) {
  for (const cam of cams) {
    await page.evaluate(pin => { window.__pin = pin; window.__applyPin?.() }, {eye: cam.eye, target: cam.target})
    await page.waitForTimeout(SHOT_SETTLE_MS)
    await page.screenshot({path: join(shotsDir, `${profileName}-${spotId}-${cam.name}.jpg`), type: 'jpeg', quality: 85})
    // The same frame without the covers and posts: what the street looked like before this stage.
    await page.evaluate(() => window.viewer.trafficProbe.streetFurnitureShown(false))
    await page.waitForTimeout(250)
    await page.screenshot({path: join(shotsDir, `${profileName}-${spotId}-${cam.name}-before.jpg`), type: 'jpeg', quality: 85})
    await page.evaluate(() => window.viewer.trafficProbe.streetFurnitureShown(true))
  }
}

/** Pairs closer than `gap` in plan. */
function tooClose(items, gap) {
  const pairs = []
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const distance = Math.hypot(items[i].x - items[j].x, items[i].z - items[j].z)
    if (distance < gap - 1e-3) pairs.push(`${items[i].key}/${items[j].key} ${distance.toFixed(2)} m`)
  }
  return pairs
}

async function verifySpot(browser, baseUrl, profileName, profile, spot, options) {
  const {shotsDir, spotCameras, failures} = options
  const tag = `${profileName}/${spot.id}`
  const diag = {pageErrors: [], consoleErrors: []}
  let context, timer, timedOut = false
  try {
    context = await browser.newContext(profile)
    const work = (async () => {
      const {page, overview} = await openSpotPage(context, baseUrl, spot, diag)
      const ready = await page
        .waitForFunction(() => typeof window.viewer?.trafficProbe?.manholeCovers === 'function' && typeof window.viewer.trafficProbe.bollards === 'function', null, {timeout: PROBE_WAIT_MS})
        .then(() => true, () => false)
      if (!ready) throw new Error('trafficProbe.manholeCovers()/bollards() missing')

      // Settled: nothing near the walker is still waiting for its street tile, twice in a row.
      const started = Date.now()
      let calm = 0, settleMs = null
      while (Date.now() - started < SETTLE_MAX_MS) {
        const open = await page.evaluate(radius => {
          const viewer = window.viewer, probe = viewer.trafficProbe, pos = viewer.walk.position
          const near = item => Math.hypot(item.x - pos.x, item.z - pos.z) <= radius
          const covers = probe.manholeCovers().covers.filter(near), posts = probe.bollards().posts.filter(near)
          const heads = probe.signalHeads?.()
          return {
            covers: covers.length,
            waiting: covers.filter(item => item.state === 'waiting' || (item.state === 'drawn' && item.settled === false)).length
              + posts.filter(item => item.state === 'waiting' || (item.state === 'drawn' && item.settled === false)).length,
            heads: heads ? (heads.waiting ?? 0) + (heads.scanning ?? 0) : 0,
          }
        }, NEAR_RADIUS)
        calm = open.covers > 0 && open.waiting === 0 && open.heads === 0 ? calm + 1 : 0
        if (calm >= 3) { settleMs = Date.now() - started; break }
        await page.waitForTimeout(SETTLE_POLL_MS)
      }
      if (settleMs === null) failures.push(`${tag}: covers and bollards did not settle within ${SETTLE_MAX_MS / 1000}s`)

      const inspected = await page.evaluate(async ({radius, frames}) => {
        const viewer = window.viewer, probe = viewer.trafficProbe, pos = viewer.walk.position
        const focus = {x: pos.x, z: pos.z}
        const near = item => Math.hypot(item.x - pos.x, item.z - pos.z) <= radius
        const covers = probe.manholeCovers(), posts = probe.bollards()
        const surface = item => viewer.stream.surfaceAt(item.x, item.z) ?? null
        const draws = await probe.streetFurnitureDraws(frames)
        const audit = await probe.streetFurnitureAudit(focus, radius)
        const strip = ({covers: _c, posts: _p, ...rest}) => rest
        return {
          walker: {x: pos.x, y: pos.y, z: pos.z},
          covers: strip(covers), posts: strip(posts),
          nearCovers: covers.covers.filter(near).map(item => ({...item, surface: surface(item)})),
          nearPosts: posts.posts.filter(near).map(item => ({...item, surface: surface(item)})),
          draws, audit,
        }
      }, {radius: NEAR_RADIUS, frames: DRAW_FRAMES})

      const drawnCovers = inspected.nearCovers.filter(item => item.state === 'drawn')
      const noneCovers = inspected.nearCovers.filter(item => item.state === 'none')
      const drawnPosts = inspected.nearPosts.filter(item => item.state === 'drawn')

      // Covers: some drawn, not most of them refused, unique, spaced, on the carriageway.
      if (!drawnCovers.length) failures.push(`${tag}: no manhole cover drawn within ${NEAR_RADIUS} m`)
      if (inspected.nearCovers.length && noneCovers.length / inspected.nearCovers.length > MAX_NONE_RATIO) failures.push(`${tag}: ${noneCovers.length}/${inspected.nearCovers.length} covers refused (> ${MAX_NONE_RATIO})`)
      if (new Set(inspected.nearCovers.map(item => item.key)).size !== inspected.nearCovers.length) failures.push(`${tag}: duplicate cover keys`)
      const crowded = tooClose(drawnCovers, MANHOLE_MIN_GAP)
      if (crowded.length) failures.push(`${tag}: covers closer than ${MANHOLE_MIN_GAP} m: ${crowded.slice(0, 3).join(', ')}`)
      const offRoad = drawnCovers.filter(item => !item.surface?.includes(0))
      if (offRoad.length) failures.push(`${tag}: ${offRoad.length} cover(s) not on the carriageway: ${offRoad.slice(0, 3).map(item => `${item.key}@${item.surface}`).join(', ')}`)
      const kinds = [0, 1, 2].map(kind => drawnCovers.filter(item => item.kind === kind).length)

      // What is drawn under them: a centimetre below, and asphalt rather than paint.
      const gaps = inspected.audit.covers.flatMap(item => item.gaps)
      const gapNulls = gaps.filter(gap => gap === null).length
      const gapOff = gaps.filter(gap => gap !== null && (gap < GAP_MIN || gap > GAP_MAX)).length
      if (gaps.length && (gapOff + gapNulls) / gaps.length > MAX_GAP_OFF_RATIO) failures.push(`${tag}: ${gapOff} cover height sample(s) outside ${GAP_MIN}–${GAP_MAX} m and ${gapNulls} with nothing drawn below, of ${gaps.length}`)
      const buried = inspected.audit.covers.filter(item => item.gaps[0] !== null && item.gaps[0] < -0.001)
      if (buried.length) failures.push(`${tag}: ${buried.length} cover(s) drawn under the road: ${buried.slice(0, 3).map(item => `${item.key} ${item.gaps[0]}`).join(', ')}`)
      const onPaint = inspected.audit.covers.filter(item => item.paint.some(Boolean))
      if (inspected.audit.covers.length && onPaint.length / inspected.audit.covers.length > MAX_ON_PAINT_RATIO) failures.push(`${tag}: ${onPaint.length}/${inspected.audit.covers.length} covers on road paint (> ${MAX_ON_PAINT_RATIO}): ${onPaint.slice(0, 4).map(item => item.key).join(', ')}`)

      // Bollards: at a signalised junction some stand, on the pavement, spaced, in nothing.
      if (spot.posts && !drawnPosts.length) failures.push(`${tag}: no bollard drawn within ${NEAR_RADIUS} m of a signalised junction`)
      if (new Set(inspected.nearPosts.map(item => item.key)).size !== inspected.nearPosts.length) failures.push(`${tag}: duplicate bollard keys`)
      const packed = tooClose(drawnPosts, BOLLARD_MIN_GAP)
      if (packed.length) failures.push(`${tag}: bollards closer than ${BOLLARD_MIN_GAP} m: ${packed.slice(0, 3).join(', ')}`)
      // Behind most kerbs the street tiles have nothing (plain ground); what a post must not stand on is road, fence or verge.
      const onRoad = drawnPosts.filter(item => !item.surface || item.surface.includes(0) || item.surface.includes(5) || item.surface.includes(4))
      if (onRoad.length) failures.push(`${tag}: ${onRoad.length} bollard(s) on road, fence or verge: ${onRoad.slice(0, 3).map(item => `${item.key}@${item.surface}`).join(', ')}`)
      const postGaps = inspected.audit.posts.map(item => item.gap)
      const floating = inspected.audit.posts.filter(item => item.gap === null || item.gap > POST_GAP_MAX || item.gap < -POST_SUNK_MAX)
      if (floating.length) failures.push(`${tag}: ${floating.length} bollard(s) off the ground (base −${POST_SUNK_MAX}…+${POST_GAP_MAX} m from the drawn ground): ${floating.slice(0, 3).map(item => `${item.key} ${item.gap} on ${item.under}`).join(', ')}`)
      const touching = inspected.audit.posts.filter(item => item.touching.length)
      if (inspected.audit.posts.length && touching.length / inspected.audit.posts.length > MAX_POST_TOUCHING_RATIO) failures.push(`${tag}: ${touching.length}/${inspected.audit.posts.length} bollards stand in something: ${touching.slice(0, 4).map(item => `${item.key}→${item.touching.join('+')}`).join(', ')}`)

      // One draw call each, every frame.
      for (const [name, draws] of [['covers', inspected.draws.covers], ['bollards', inspected.draws.posts]]) {
        if (!draws) failures.push(`${tag}: ${name} draw probe missing`)
        else if (draws.mostPerFrame > 1) failures.push(`${tag}: ${name} drawn ${draws.mostPerFrame} times in a frame (expected ≤ 1)`)
      }
      if (drawnCovers.length && inspected.draws.covers?.draws === 0) failures.push(`${tag}: covers never drawn in ${DRAW_FRAMES} frames`)
      if (drawnPosts.length && inspected.draws.posts?.draws === 0) failures.push(`${tag}: bollards never drawn in ${DRAW_FRAMES} frames`)

      if (shotsDir) {
        let cams = spotCameras.get(spot.id)
        if (!cams) spotCameras.set(spot.id, cams = buildCameras(overview, drawnCovers, drawnPosts, inspected.walker))
        await captureCameras(page, profileName, spot.id, cams, shotsDir)
      }
      if (diag.pageErrors.length) failures.push(`${tag}: ${diag.pageErrors.length} pageerror(s): ${diag.pageErrors.slice(0, 3).join('; ')}`)

      return {
        spot: spot.id, profile: profileName, settleMs,
        covers: {...inspected.covers, near: inspected.nearCovers.length, nearDrawn: drawnCovers.length, nearNone: noneCovers.length, kinds, onPaint: onPaint.length, audited: inspected.audit.covers.length, gap: {...statsOf(gaps), nulls: gapNulls, off: gapOff, count: gaps.length}},
        posts: {...inspected.posts, near: inspected.nearPosts.length, nearDrawn: drawnPosts.length, touching: touching.length, tall: postGaps.filter(gap => gap !== null && gap > POST_GAP_SNUG).length, gap: statsOf(postGaps)},
        draws: inspected.draws,
        onPaintKeys: onPaint.map(item => item.key), touchingPosts: touching.map(item => ({key: item.key, touching: item.touching})),
        under: [...new Set(inspected.audit.covers.flatMap(item => item.under))].sort(),
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
const spotFilter = process.env.FURNITURE_SPOTS ? new Set(process.env.FURNITURE_SPOTS.split(',').map(s => s.trim()).filter(Boolean)) : null
const spots = spotFilter?.size ? SPOTS.filter(spot => spotFilter.has(spot.id)) : SPOTS
if (!spots.length) throw new Error(`No matching spots for "${process.env.FURNITURE_SPOTS}"`)

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
  const results = [], failures = [], spotCameras = new Map()
  for (const profileName of args.profileNames) for (const spot of spots) {
    console.error(`[verify-street-furniture] ${profileName}/${spot.id} (${spot.label}) ...`)
    results.push(await verifySpot(browser, baseUrl, profileName, PROFILES[profileName], spot, {shotsDir: args.shotsDir, spotCameras, failures}))
  }
  if (args.shotsDir) {
    await writeFile(join(args.shotsDir, 'verify-street-furniture.json'), JSON.stringify({timestamp: new Date().toISOString(), browser: browser.version(), renderer, results, failures, ok: !failures.length}, null, 2) + '\n')
    await writeFile(join(args.shotsDir, 'cameras.json'), JSON.stringify([...spotCameras].map(([spot, cams]) => ({spot, cams})), null, 2) + '\n')
  }
  for (const row of results) {
    if (row.error) { console.log(`${row.profile}/${row.spot}: ERROR ${row.error}`); continue }
    console.log(`${row.profile}/${row.spot}: covers ${row.covers.nearDrawn}/${row.covers.near} drawn (圆/篦/方 ${row.covers.kinds.join('/')}, none ${row.covers.nearNone}, on paint ${row.covers.onPaint}/${row.covers.audited}), gap ${row.covers.gap.min}…${row.covers.gap.median}…${row.covers.gap.max} m; bollards ${row.posts.nearDrawn}/${row.posts.near} drawn (touching ${row.posts.touching}, on drawn ground ${row.posts.onDrawn ?? '-'}/${row.posts.drawn}, base >${POST_GAP_SNUG} m above drawn ground ${row.posts.tall}, gap ${row.posts.gap.min ?? '-'}…${row.posts.gap.max ?? '-'}); draws ${row.draws.covers?.mostPerFrame}/${row.draws.posts?.mostPerFrame}; settle ${row.settleMs} ms`)
  }
  if (failures.length) {
    console.log(`\nFAIL (${failures.length}):`)
    for (const failure of failures) console.log(`  - ${failure}`)
    process.exitCode = 1
  } else {
    const primary = results.filter(row => row.profile === args.profileNames[0])
    console.log(`ok — street furniture: ${primary.reduce((sum, row) => sum + row.covers.nearDrawn, 0)} covers and ${primary.reduce((sum, row) => sum + row.posts.nearDrawn, 0)} bollards checked across ${spots.length} spot(s)`)
  }
} finally {
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
}
