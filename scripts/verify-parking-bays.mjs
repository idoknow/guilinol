// IDOK-399 — verify kerbside parking bays at fixed spots: settle & idle behaviour,
// draw-call budget, carriageway & kerb placement, paint-to-road height gaps,
// and optional overview/close-up/top-down screenshots.
// Run `npm run build` first (or set PERF_DIST), then:
//   node --import tsx scripts/verify-parking-bays.mjs [--shots dir] [--cameras file] [--profile desktop|mobile|both]
// BAYS_SPOTS=lequn,east picks spots. The bay geometry comes from the game's own `parking-layout.ts`.

import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {telemetryPreview} from './telemetry-preview.mjs'
import {BAY_BOX_CLEARANCE, BAY_KERB, BAY_KERB_GAP, BAY_LINE, BAY_WIDTH} from '../web/src/traffic/parking-layout.ts'

const SPOT_TIMEOUT_MS = 180_000
const PROBE_WAIT_MS = 60_000
const NEAR_RADIUS = 100
const SETTLE_POLL_MS = 500
const SETTLE_MAX_MS = 60_000
// Two rounds of the slow re-read (every 8 s) of a settled bay.
const IDLE_CHECK_MS = 16_000
const DRAW_FRAMES = 40
const SHOT_SETTLE_MS = 1500

const ROAD_SIDE = BAY_WIDTH - BAY_KERB

const KERB_STEP = 0.05
const KERB_SCAN_MAX = 3
// End lines reach this far from the bay centre towards the kerb; the carriageway must go at least that far.
const KERB_REACH = BAY_KERB - BAY_KERB_GAP
// Carriageway going on this far past the car centre makes the bay a full box.
const BOX_CLEARANCE = BAY_BOX_CLEARANCE
// Line tips are checked this far short of their end: the street surface lookup is a raster.
const TIP_INSET = 0.05
const MAX_TIP_OFF_RATIO = 0.1
const MAX_NONE_RATIO = 0.35
const GAP_MIN = 0.002
const GAP_MAX = 0.03
// Markings baked into the street tiles (lane lines, zebra bars) are drawn 2 cm above the road; where a
// bay line crosses one, the marking covers it and the gap reads about -8 mm. Counted, not failed —
// unless it is more than a few of the samples.
const MARKING_GAP_MIN = -0.012
const MARKING_GAP_MAX = -0.004
const MAX_ON_MARKING_RATIO = 0.1
const MAX_ROAD_SIDE_OFF_RATIO = 0.1
const MAX_GAP_NULL_RATIO = 0.3

const QUERY = 'verify&solo=1&flow=0&time=17&traffic=1'
const WORLD_OVERLAY = process.env.PERF_WORLD ? resolve(process.env.PERF_WORLD) : null

const PROFILES = {
  desktop: {viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, isMobile: false, hasTouch: false},
  mobile: {viewport: {width: 844, height: 390}, deviceScaleFactor: 2, isMobile: true, hasTouch: true},
}

// `boxed`: the share of drawn bays near the spot that are a full box, lowest and highest expected —
// a wide street (cars out in the carriageway), residential streets (mostly three lines at the kerb),
// or both in view. A change of rule that turns every bay one way fails here.
const SPOTS = [
  {id: 'lequn', label: '乐群路', at: [-1007.9, -438.4], boxed: [0.9, 1]},
  {id: 'east', label: '东岸支路', at: [-168.7, -1003.3], boxed: [0.3, 0.9]},
  {id: 'southeast', label: '东南居民街', at: [367.5, -1813.5], boxed: [0.05, 0.6]},
  {id: 'south', label: '南区居民街', at: [-799.7, 1636.7], boxed: [0.05, 0.5]},
]

function parseArgs(argv) {
  let profile = 'both'
  let shots = null
  let cameras = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--profile') {
      profile = argv[++i]
      if (!profile) throw new Error('--profile requires desktop, mobile, or both')
    } else if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length)
    } else if (arg === '--shots') {
      shots = argv[++i]
      if (!shots) throw new Error('--shots requires a directory path')
    } else if (arg.startsWith('--shots=')) {
      shots = arg.slice('--shots='.length)
    } else if (arg === '--cameras') {
      cameras = argv[++i]
      if (!cameras) throw new Error('--cameras requires a cameras.json path')
    } else if (arg.startsWith('--cameras=')) {
      cameras = arg.slice('--cameras='.length)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!['desktop', 'mobile', 'both'].includes(profile)) {
    throw new Error(`Unknown profile "${profile}" (expected: desktop, mobile, both)`)
  }
  if (cameras && !shots) {
    throw new Error('--cameras replay mode requires --shots <dir>')
  }
  return {
    profileNames: profile === 'both' ? ['desktop', 'mobile'] : [profile],
    shotsDir: shots ? resolve(shots) : null,
    camerasPath: cameras ? resolve(cameras) : null,
  }
}

function round(n, digits = 3) {
  return Number(n.toFixed(digits))
}

function median(sorted) {
  if (!sorted.length) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function statsOf(values, digits = 3) {
  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b)
  if (!nums.length) return {min: null, median: null, max: null, rawMedian: null}
  const med = median(nums)
  return {
    min: round(nums[0], digits),
    median: round(med, digits),
    max: round(nums[nums.length - 1], digits),
    rawMedian: med,
  }
}

function bayCamera(bay) {
  const rightX = -bay.headingZ
  const rightZ = bay.headingX
  return {
    eye: [
      round(bay.x - rightX * 6 - bay.headingX * 7),
      round(bay.y + 3.2),
      round(bay.z - rightZ * 6 - bay.headingZ * 7),
    ],
    target: [
      round(bay.x + bay.headingX * 4),
      round(bay.y + 0.2),
      round(bay.z + bay.headingZ * 4),
    ],
  }
}

function topCamera(bay) {
  return {
    eye: [round(bay.x + 0.01), round(bay.y + 14), round(bay.z + 0.01)],
    target: [round(bay.x), round(bay.y), round(bay.z)],
  }
}

function buildSpotCameras(overview, drawnBays, walker) {
  const cams = [{name: 'overview', eye: overview.eye, target: overview.target}]
  const byDist = [...drawnBays].sort(
    (a, b) =>
      Math.hypot(a.x - walker.x, a.z - walker.z) - Math.hypot(b.x - walker.x, b.z - walker.z) ||
      String(a.key).localeCompare(String(b.key)),
  )
  const occupied = byDist.filter(b => b.occupied).slice(0, 3)
  occupied.forEach((bay, idx) => {
    cams.push({name: `bay${idx + 1}`, ...bayCamera(bay)})
  })
  const emptyBay = byDist.find(b => b.occupied === false)
  if (emptyBay) {
    cams.push({name: 'empty1', ...bayCamera(emptyBay)})
  }
  if (byDist.length > 0) {
    cams.push({name: 'top', ...topCamera(byDist[0])})
  }
  return cams
}

function emptySummary(spotId, profileName, diag, error) {
  return {
    spot: spotId,
    profile: profileName,
    total: 0,
    occupied: 0,
    empty: 0,
    drawn: 0,
    settled: 0,
    none: 0,
    waiting: 0,
    near: 0,
    nearEmpty: 0,
    nearBoxed: 0,
    nearNone: 0,
    tipsOffRoad: 0,
    drawCalls: 0,
    draws: null,
    settleMs: 0,
    samples: 0,
    idleSamplesDelta: 0,
    kerbDistance: {min: null, median: null, max: null, nulls: 0},
    roadSideOffRoad: 0,
    gap: {min: null, median: null, max: null, nulls: 0, onMarking: 0, count: 0},
    heightOffset: {min: null, median: null, max: null},
    under: [],
    pageErrors: diag.pageErrors,
    consoleErrors: diag.consoleErrors,
    failedRequests: Object.fromEntries(diag.failedRequests),
    error,
  }
}

async function detectRenderer(browser) {
  const page = await browser.newPage()
  try {
    return await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
      const ext = gl?.getExtension('WEBGL_debug_renderer_info')
      return (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || 'unknown'
    })
  } finally {
    await page.close()
  }
}

async function openSpotPage(context, baseUrl, spot, diag) {
  if (WORLD_OVERLAY) {
    await context.route('**/world/roads/*.json.gz', async route => {
      const file = join(WORLD_OVERLAY, new URL(route.request().url()).pathname)
      const body = await readFile(file).catch(() => null)
      if (body) await route.fulfill({status: 200, contentType: 'application/octet-stream', body})
      else await route.continue()
    })
  }
  const page = await context.newPage()
  page.on('console', msg => {
    if (msg.type() === 'error') diag.consoleErrors.push(msg.text())
  })
  page.on('pageerror', err => {
    diag.pageErrors.push(err.message)
  })
  page.on('response', response => {
    if (response.status() >= 400) {
      const key = `${response.status()} ${new URL(response.url()).pathname}`
      diag.failedRequests.set(key, (diag.failedRequests.get(key) ?? 0) + 1)
    }
  })

  await page.goto(`${baseUrl}/?${QUERY}`, {timeout: 120_000})
  await page.waitForFunction(() => Boolean(window.viewer?.walk?.active), null, {timeout: 120_000})

  // Teleport walker to the spot, read walkerY, then pin the overview camera via mutable window.__pin.
  const overview = await page.evaluate(
    async ({at}) => {
      const viewer = window.viewer
      if (!(await viewer.walkTo(at[0], at[1], 0, 'verify-parking-bays'))) {
        throw new Error('viewer.walkTo returned false')
      }
      const walkerY = viewer.walk.position.y
      const eye = [
        Number((at[0] + 20).toFixed(3)),
        Number((walkerY + 24).toFixed(3)),
        Number((at[1] + 20).toFixed(3)),
      ]
      const target = [
        Number(at[0].toFixed(3)),
        Number(walkerY.toFixed(3)),
        Number(at[1].toFixed(3)),
      ]
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
      viewer.walk.tick = elapsed => {
        tick(elapsed)
        applyPin()
      }
      return {eye, target}
    },
    {at: spot.at},
  )

  // Wait for walk-mode chunk/forest streaming to settle and trafficProbe to initialize.
  await page.waitForFunction(
    () => {
      const viewer = window.viewer
      if (!viewer?.stats?.firstMs || viewer.stats.pending) return false
      if (!viewer.walk?.active || !viewer.trafficProbe) return false
      const pos = viewer.walk.position
      const forest = viewer.stream.forest
      if (forest.pending && forest.pending.size > 0) return false
      return viewer.manifest.chunks.every(tile => {
        const dist = Math.hypot(tile.x + 128 - pos.x, tile.z + 128 - pos.z)
        return (
          (dist > viewer.stream.radius || viewer.stream.loaded.has(tile)) &&
          (dist > (viewer.stream.metrics?.treeLoadRadius ?? 1682) || forest.loaded.has(tile))
        )
      })
    },
    null,
    {timeout: 120_000},
  )

  const trafficLoaded = await page
    .waitForFunction(() => window.viewer.trafficProbe?.loads?.length > 0, null, {timeout: 60_000})
    .then(() => true)
    .catch(() => false)

  return {page, trafficLoaded, overview}
}

async function captureCameras(page, profileName, spotId, cams, shotsDir) {
  for (const cam of cams) {
    await page.evaluate(
      pin => {
        window.__pin = pin
        window.__applyPin?.()
      },
      {eye: cam.eye, target: cam.target},
    )
    await page.waitForTimeout(SHOT_SETTLE_MS)
    await page.screenshot({
      path: join(shotsDir, `${profileName}-${spotId}-${cam.name}.jpg`),
      type: 'jpeg',
      quality: 85,
    })
  }
}

async function verifySpot(browser, baseUrl, profileName, profile, spot, options) {
  const {shotsDir, spotCameras, recordedCameras, failures} = options
  const tag = `${profileName}/${spot.id}`
  const diag = {consoleErrors: [], pageErrors: [], failedRequests: new Map()}
  let context = null
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    context?.close().catch(() => {})
  }, SPOT_TIMEOUT_MS)

  try {
    context = await browser.newContext({
      viewport: profile.viewport,
      deviceScaleFactor: profile.deviceScaleFactor,
      isMobile: profile.isMobile,
      hasTouch: profile.hasTouch,
    })
    const {page, trafficLoaded, overview} = await openSpotPage(context, baseUrl, spot, diag)
    if (!trafficLoaded) {
      failures.push(`${tag}: trafficProbe.loads stayed empty after 60s`)
    }

    // 1: Wait for the parkingBays probe (max 60s).
    const hasProbe = await page
      .waitForFunction(() => typeof window.viewer?.trafficProbe?.parkingBays === 'function', null, {
        timeout: PROBE_WAIT_MS,
      })
      .then(() => true)
      .catch(() => false)

    if (!hasProbe) {
      failures.push(`${tag}: viewer.trafficProbe.parkingBays() is missing after ${PROBE_WAIT_MS / 1000}s`)
      return {
        summary: emptySummary(spot.id, profileName, diag, 'parkingBays probe missing'),
      }
    }

    // 2: Poll parkingBays() every 500ms until total > 0 and all near bays are settled or 'none' (max 60s).
    const settle = await page.evaluate(
      async ({radius, pollMs, maxMs}) => {
        const viewer = window.viewer
        const probe = viewer.trafficProbe
        const start = performance.now()
        const deadline = start + maxMs
        while (true) {
          const snap = probe.parkingBays()
          const pos = viewer.walk.position
          const bays = Array.isArray(snap?.bays) ? snap.bays : []
          let openCount = 0
          for (const b of bays) {
            if (Math.hypot(b.x - pos.x, b.z - pos.z) <= radius) {
              if (b.settled !== true && b.state !== 'none') openCount++
            }
          }
          if ((snap?.total ?? 0) > 0 && openCount === 0) {
            return {
              settled: true,
              settleMs: Math.round(performance.now() - start),
              openCount: 0,
              samplesBeforeIdle: snap?.samples ?? 0,
            }
          }
          const remaining = deadline - performance.now()
          if (remaining <= 0) {
            return {
              settled: false,
              settleMs: Math.round(performance.now() - start),
              openCount,
              samplesBeforeIdle: snap?.samples ?? 0,
            }
          }
          await new Promise(r => setTimeout(r, Math.min(pollMs, remaining)))
        }
      },
      {radius: NEAR_RADIUS, pollMs: SETTLE_POLL_MS, maxMs: SETTLE_MAX_MS},
    )

    if (!settle.settled) {
      failures.push(
        `${tag}: bays near the player did not settle within ${SETTLE_MAX_MS / 1000}s (${settle.openCount} still open)`,
      )
    }

    // 3: Idle check — a settled bay is re-read once every 8 s, four samples. Over IDLE_CHECK_MS (two
    // rounds) the count grows by one to three rounds over the bays in drape range (110 m): fewer and
    // the re-read has stopped, more and settled bays are being sampled every frame.
    const inRange = () => page.evaluate(() => {
      const viewer = window.viewer
      const snap = viewer.trafficProbe.parkingBays()
      const pos = viewer.walk.position
      const bays = (snap?.bays ?? []).filter(b => Math.hypot(b.x - pos.x, b.z - pos.z) <= 110)
      return {samples: snap?.samples ?? 0, live: bays.filter(b => b.state !== 'none').length, settled: bays.filter(b => b.state === 'drawn' && b.settled).length}
    })
    const idleStart = await inRange()
    await page.waitForTimeout(IDLE_CHECK_MS)
    const idle = await inRange()
    const idleSamplesDelta = idle.samples - idleStart.samples
    const idleRounds = IDLE_CHECK_MS / 8000
    if (idleSamplesDelta > idle.live * 4 * (idleRounds + 1)) {
      failures.push(
        `${tag}: ${idleSamplesDelta} ground samples in ${IDLE_CHECK_MS}ms with every bay settled (at most ${idle.live * 4 * (idleRounds + 1)} expected: ${idleRounds + 1} re-reads of ${idle.live} bays)`,
      )
    }
    if (idleSamplesDelta < Math.min(idleStart.settled, idle.settled) * 4 * (idleRounds - 1)) {
      failures.push(
        `${tag}: only ${idleSamplesDelta} ground samples in ${IDLE_CHECK_MS}ms: ${idle.settled} settled bays in range are not being re-read`,
      )
    }

    // 3b: Real draws of the line mesh, counted in the renderer over DRAW_FRAMES animation frames.
    const draws = await page.evaluate(frames => window.viewer.trafficProbe.parkingBayDraws(frames), DRAW_FRAMES)
    if (!(draws.draws >= 1 && draws.draws <= draws.frames && draws.mostPerFrame <= 1)) {
      failures.push(`${tag}: the line mesh was drawn ${draws.draws} times in ${draws.frames} frames, ${draws.mostPerFrame} in one of them (expected at most once a frame, and at least once)`)
    }

    // 4: Inspect near bays (road clearance, kerb distance, height spread/offset) and paint-to-road gaps.
    const inspected = await page.evaluate(
      async ({radius, roadSide, kerbStep, kerbScanMax, kerbReach, tipInset}) => {
        const viewer = window.viewer
        const probe = viewer.trafficProbe
        if (typeof probe.parkingBayGaps !== 'function') {
          throw new Error('viewer.trafficProbe.parkingBayGaps() is missing')
        }
        const snap = probe.parkingBays()
        const pos = viewer.walk.position
        const walker = {x: pos.x, y: pos.y, z: pos.z}
        const bays = Array.isArray(snap?.bays) ? snap.bays : []
        const isRoad = (x, z) => {
          const surf = viewer.stream.surfaceAt(x, z)
          return surf != null && Array.from(surf).includes(0)
        }
        const scanSteps = Math.round(kerbScanMax / kerbStep)
        const near = []

        for (const b of bays) {
          if (Math.hypot(b.x - walker.x, b.z - walker.z) > radius) continue
          let kerbDistance = null
          let centreOnRoad = null
          let roadSideOnRoad = null
          let tipsOffRoad = null
          let boxOnRoad = null
          let heightSpread = null
          let heightOffset = null

          if (b.state === 'drawn') {
            const rightX = -b.headingZ
            const rightZ = b.headingX
            centreOnRoad = isRoad(b.x, b.z)
            if (!centreOnRoad) {
              kerbDistance = 0
            } else {
              for (let s = 1; s <= scanSteps; s++) {
                const d = Number((s * kerbStep).toFixed(4))
                if (!isRoad(b.x + rightX * d, b.z + rightZ * d)) {
                  kerbDistance = d
                  break
                }
              }
            }
            roadSideOnRoad = isRoad(b.x - rightX * roadSide, b.z - rightZ * roadSide)
            // Where the paint really ends on the kerb side: the tips of both end lines, and for a
            // boxed bay the kerb-side line at its ends and middle.
            const kerbSide = (b.boxed ? roadSide : kerbReach) - tipInset
            const at = (along, side) => isRoad(b.x + b.headingX * along + rightX * side, b.z + b.headingZ * along + rightZ * side)
            tipsOffRoad = (at(-b.rear, kerbSide) ? 0 : 1) + (at(b.front, kerbSide) ? 0 : 1)
            if (b.boxed) boxOnRoad = at(-b.rear, roadSide) && at(0, roadSide) && at(b.front, roadSide)
            if (Array.isArray(b.heights) && b.heights.length > 0) {
              let minH = Infinity
              let maxH = -Infinity
              let sumH = 0
              for (const h of b.heights) {
                if (h < minH) minH = h
                if (h > maxH) maxH = h
                sumH += h
              }
              heightSpread = maxH - minH
              heightOffset = sumH / b.heights.length - b.y
            }
          }

          near.push({
            key: b.key,
            x: b.x,
            y: b.y,
            z: b.z,
            headingX: b.headingX,
            headingZ: b.headingZ,
            rear: b.rear,
            front: b.front,
            occupied: b.occupied,
            state: b.state,
            boxed: b.boxed === true,
            kerbDistance,
            centreOnRoad,
            roadSideOnRoad,
            tipsOffRoad,
            boxOnRoad,
            heightSpread,
            heightOffset,
          })
        }

        const rawGaps = await probe.parkingBayGaps({x: walker.x, z: walker.z}, radius)
        return {
          total: snap?.total ?? 0,
          occupied: snap?.occupied ?? 0,
          empty: snap?.empty ?? 0,
          drawn: snap?.drawn ?? 0,
          settled: snap?.settled ?? 0,
          waiting: snap?.waiting ?? 0,
          none: snap?.none ?? 0,
          visible: Boolean(snap?.visible),
          drawCalls: snap?.drawCalls ?? 0,
          samples: snap?.samples ?? 0,
          walker,
          near,
          gaps: Array.isArray(rawGaps) ? rawGaps : [],
        }
      },
      {radius: NEAR_RADIUS, roadSide: ROAD_SIDE, kerbStep: KERB_STEP, kerbScanMax: KERB_SCAN_MAX, kerbReach: KERB_REACH, tipInset: TIP_INSET},
    )

    const drawnNear = inspected.near.filter(b => b.state === 'drawn')
    const nearEmpty = drawnNear.filter(b => b.occupied === false).length

    // 5a: Non-empty totals and drawn bays within NEAR_RADIUS.
    if (inspected.total <= 0) {
      failures.push(`${tag}: parkingBays total is ${inspected.total} (expected > 0)`)
    }
    if (drawnNear.length <= 0) {
      failures.push(`${tag}: no drawn parking bays within ${NEAR_RADIUS}m (total=${inspected.total}, near=${inspected.near.length})`)
    }

    // 5a': Coverage. Some empty bays are painted; not too many bays are left unpainted; and the mix of
    // boxed and open bays is the one this street has.
    const nearNone = inspected.near.filter(b => b.state === 'none').length
    if (nearEmpty <= 0) {
      failures.push(`${tag}: no empty bay drawn within ${NEAR_RADIUS}m (of ${drawnNear.length} drawn)`)
    }
    if (inspected.near.length > 0 && nearNone / inspected.near.length > MAX_NONE_RATIO) {
      failures.push(`${tag}: ${nearNone}/${inspected.near.length} bays within ${NEAR_RADIUS}m are not painted (max ${MAX_NONE_RATIO * 100}%)`)
    }
    const boxedShare = drawnNear.length ? drawnNear.filter(b => b.boxed).length / drawnNear.length : 0
    if (spot.boxed && drawnNear.length > 0 && (boxedShare < spot.boxed[0] || boxedShare > spot.boxed[1])) {
      failures.push(`${tag}: ${round(boxedShare * 100, 1)}% of drawn bays are boxed (expected ${spot.boxed[0] * 100}–${spot.boxed[1] * 100}% on this street)`)
    }

    // 5b: Single draw call and visible mesh.
    if (inspected.drawCalls !== 1) {
      failures.push(`${tag}: parkingBays drawCalls is ${inspected.drawCalls} (expected 1)`)
    }
    if (inspected.visible !== true) {
      failures.push(`${tag}: parkingBays visible is ${inspected.visible} (expected true)`)
    }

    // 5c: Every drawn bay centre sits on motor carriageway (surface includes 0).
    const offRoadCentres = drawnNear.filter(b => b.centreOnRoad !== true)
    if (offRoadCentres.length > 0) {
      const sample = offRoadCentres
        .slice(0, 5)
        .map(b => `${b.key}@(${round(b.x, 1)},${round(b.z, 1)})`)
        .join(', ')
      failures.push(`${tag}: ${offRoadCentres.length} drawn bay(s) have centre off road: ${sample}`)
    }

    // 5d: The end lines stay on the carriageway: it goes on for at least KERB_REACH on the kerb side of
    // every bay centre. (Wide streets keep a strip between the parked cars and the kerb; null = no kerb
    // within 3 m.)
    const kerbValues = drawnNear.map(b => b.kerbDistance)
    const kerbNulls = kerbValues.filter(v => v === null || v === undefined || !Number.isFinite(v)).length
    const kerbStats = statsOf(kerbValues, 3)
    const overKerb = drawnNear.filter(b => Number.isFinite(b.kerbDistance) && b.kerbDistance < KERB_REACH - 1e-9)
    if (overKerb.length > 0) {
      const sample = overKerb.slice(0, 5).map(b => `${b.key}=${round(b.kerbDistance, 2)}m`).join(', ')
      failures.push(`${tag}: ${overKerb.length} drawn bay(s) have the kerb closer than ${KERB_REACH}m (end lines would cross it): ${sample}`)
    }
    // A boxed bay has carriageway out to its kerb-side line.
    const nearBoxed = drawnNear.filter(b => b.boxed).length
    const boxOverKerb = drawnNear.filter(b => b.boxed && Number.isFinite(b.kerbDistance) && b.kerbDistance < BOX_CLEARANCE - KERB_STEP)
    if (boxOverKerb.length > 0) {
      const sample = boxOverKerb.slice(0, 5).map(b => `${b.key}=${round(b.kerbDistance, 2)}m`).join(', ')
      failures.push(`${tag}: ${boxOverKerb.length} boxed bay(s) have the kerb closer than ${BOX_CLEARANCE}m: ${sample}`)
    }

    const boxOffRoad = drawnNear.filter(b => b.boxed && b.boxOnRoad !== true)
    if (boxOffRoad.length > 0) {
      failures.push(`${tag}: ${boxOffRoad.length} boxed bay(s) have their kerb-side line off the carriageway: ${boxOffRoad.slice(0, 5).map(b => b.key).join(', ')}`)
    }
    // The tips of the end lines (two per bay) are on the carriageway, but for a few on a bend.
    const tipsOffRoad = drawnNear.reduce((sum, b) => sum + (b.tipsOffRoad ?? 0), 0)
    if (drawnNear.length > 0 && tipsOffRoad / (drawnNear.length * 2) > MAX_TIP_OFF_RATIO) {
      failures.push(`${tag}: ${tipsOffRoad}/${drawnNear.length * 2} end-line tips are off the carriageway (max ${MAX_TIP_OFF_RATIO * 100}%)`)
    }

    // 5e: At most 10% of drawn bays may have road-side line off carriageway.
    const roadSideOffRoad = drawnNear.filter(b => b.roadSideOnRoad === false).length
    if (drawnNear.length > 0 && roadSideOffRoad / drawnNear.length > MAX_ROAD_SIDE_OFF_RATIO) {
      const pct = round((roadSideOffRoad / drawnNear.length) * 100, 1)
      failures.push(
        `${tag}: ${roadSideOffRoad}/${drawnNear.length} (${pct}%) drawn bays have road-side line off road (max ${MAX_ROAD_SIDE_OFF_RATIO * 100}%)`,
      )
    }

    // 5f: Paint-to-road gaps within [GAP_MIN, GAP_MAX] and null ratio <= 30%.
    const gapValues = []
    const outOfRangeGaps = []
    let gapNulls = 0
    let gapTotalSamples = 0
    let gapOnMarking = 0
    const underSet = new Set()

    for (const entry of inspected.gaps) {
      if (Array.isArray(entry.under)) {
        for (const meshName of entry.under) {
          if (meshName) underSet.add(String(meshName))
        }
      }
      const list = Array.isArray(entry.gaps) ? entry.gaps : []
      for (const g of list) {
        gapTotalSamples++
        if (g === null || g === undefined || !Number.isFinite(g)) {
          gapNulls++
        } else {
          if (g >= MARKING_GAP_MIN && g <= MARKING_GAP_MAX) {
            gapOnMarking++
            continue
          }
          gapValues.push(g)
          if (g < GAP_MIN || g > GAP_MAX) {
            outOfRangeGaps.push({key: entry.key, gap: g, under: (entry.under ?? []).join('+')})
          }
        }
      }
    }

    const gapStats = statsOf(gapValues, 4)
    if (drawnNear.length > 0 && gapTotalSamples === 0) {
      failures.push(`${tag}: parkingBayGaps returned 0 samples for ${drawnNear.length} drawn bay(s)`)
    }
    if (outOfRangeGaps.length > 0) {
      const sample = outOfRangeGaps
        .slice(0, 5)
        .map(g => `${g.key}=${round(g.gap, 4)}m under ${g.under}`)
        .join(', ')
      failures.push(
        `${tag}: ${outOfRangeGaps.length} gap sample(s) outside [${GAP_MIN}, ${GAP_MAX}]m: ${sample}`,
      )
    }
    if (gapTotalSamples > 0 && gapOnMarking / gapTotalSamples > MAX_ON_MARKING_RATIO) {
      failures.push(
        `${tag}: ${gapOnMarking}/${gapTotalSamples} gap samples lie under a baked road marking (max ${MAX_ON_MARKING_RATIO * 100}%)`,
      )
    }
    if (gapTotalSamples > 0 && gapNulls / gapTotalSamples > MAX_GAP_NULL_RATIO) {
      const pct = round((gapNulls / gapTotalSamples) * 100, 1)
      failures.push(
        `${tag}: ${gapNulls}/${gapTotalSamples} (${pct}%) gap samples are null (max ${MAX_GAP_NULL_RATIO * 100}%)`,
      )
    }

    // 5g: Unique keys among near bays.
    const seenKeys = new Set()
    const dupKeys = []
    for (const b of inspected.near) {
      if (seenKeys.has(b.key)) dupKeys.push(b.key)
      else seenKeys.add(b.key)
    }
    if (dupKeys.length > 0) {
      failures.push(
        `${tag}: ${dupKeys.length} duplicate near bay key(s): ${[...new Set(dupKeys)].slice(0, 5).join(', ')}`,
      )
    }

    // 7: Optional overview + oblique close-ups (bay1..bay3, empty1) + top-down screenshots.
    if (shotsDir) {
      let cams = spotCameras.get(spot.id)
      if (!cams) {
        cams = buildSpotCameras(overview, drawnNear, inspected.walker)
        spotCameras.set(spot.id, cams)
        for (const cam of cams) {
          recordedCameras.push({
            profile: profileName,
            spot: spot.id,
            name: cam.name,
            eye: cam.eye,
            target: cam.target,
          })
        }
      }
      await captureCameras(page, profileName, spot.id, cams, shotsDir)
    }

    // 5h: Zero uncaught page errors.
    if (diag.pageErrors.length > 0) {
      failures.push(`${tag}: ${diag.pageErrors.length} pageerror(s): ${diag.pageErrors.slice(0, 3).join('; ')}`)
    }

    const heightOffsetStats = statsOf(
      drawnNear.map(b => b.heightOffset),
      3,
    )

    return {
      summary: {
        spot: spot.id,
        profile: profileName,
        total: inspected.total,
        occupied: inspected.occupied,
        empty: inspected.empty,
        drawn: inspected.drawn,
        settled: inspected.settled,
        none: inspected.none,
        waiting: inspected.waiting,
        near: drawnNear.length,
        nearEmpty,
        nearBoxed,
        nearNone,
        tipsOffRoad,
        drawCalls: inspected.drawCalls,
        draws,
        settleMs: settle.settleMs,
        samples: inspected.samples,
        idleSamplesDelta,
        kerbDistance: {
          min: kerbStats.min,
          median: kerbStats.median,
          max: kerbStats.max,
          nulls: kerbNulls,
        },
        roadSideOffRoad,
        gap: {
          min: gapStats.min,
          median: gapStats.median,
          max: gapStats.max,
          nulls: gapNulls,
          onMarking: gapOnMarking,
          count: gapTotalSamples,
        },
        heightOffset: {
          min: heightOffsetStats.min,
          median: heightOffsetStats.median,
          max: heightOffsetStats.max,
        },
        under: [...underSet].sort(),
        pageErrors: diag.pageErrors,
        consoleErrors: diag.consoleErrors,
        failedRequests: Object.fromEntries(diag.failedRequests),
      },
    }
  } catch (err) {
    const message = timedOut
      ? `Spot timed out after ${SPOT_TIMEOUT_MS / 1000}s`
      : err instanceof Error
        ? err.message
        : String(err)
    failures.push(`${tag}: ${message}`)
    return {
      summary: emptySummary(spot.id, profileName, diag, message),
    }
  } finally {
    clearTimeout(timer)
    await context?.close().catch(() => {})
  }
}

async function replaySpot(browser, baseUrl, profileName, profile, spot, cams, shotsDir) {
  const diag = {consoleErrors: [], pageErrors: [], failedRequests: new Map()}
  let context = null
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    context?.close().catch(() => {})
  }, SPOT_TIMEOUT_MS)

  try {
    context = await browser.newContext({
      viewport: profile.viewport,
      deviceScaleFactor: profile.deviceScaleFactor,
      isMobile: profile.isMobile,
      hasTouch: profile.hasTouch,
    })
    const {page} = await openSpotPage(context, baseUrl, spot, diag)
    await captureCameras(page, profileName, spot.id, cams, shotsDir)
    return {shots: cams.length, error: null}
  } catch (err) {
    const message = timedOut
      ? `Spot timed out after ${SPOT_TIMEOUT_MS / 1000}s`
      : err instanceof Error
        ? err.message
        : String(err)
    return {shots: 0, error: message}
  } finally {
    clearTimeout(timer)
    await context?.close().catch(() => {})
  }
}

function loadReplayCameras(raw, spotFilter) {
  if (!Array.isArray(raw)) throw new Error('--cameras file must contain a JSON array')
  const bySpot = new Map()
  const seen = new Set()
  for (const cam of raw) {
    if (!cam || typeof cam.spot !== 'string' || typeof cam.name !== 'string' || !Array.isArray(cam.eye) || !Array.isArray(cam.target)) {
      throw new Error(`Invalid camera entry: ${JSON.stringify(cam)}`)
    }
    if (spotFilter?.size && !spotFilter.has(cam.spot)) continue
    const key = `${cam.spot}\0${cam.name}`
    if (seen.has(key)) continue
    seen.add(key)
    if (!bySpot.has(cam.spot)) bySpot.set(cam.spot, [])
    bySpot.get(cam.spot).push({name: cam.name, eye: cam.eye, target: cam.target})
  }
  const byId = new Map(SPOTS.map(s => [s.id, s]))
  const replaySpots = []
  for (const [id, cams] of bySpot) {
    replaySpots.push({
      spot: byId.get(id) ?? {id, label: id, at: [cams[0].target[0], cams[0].target[2]]},
      cams,
    })
  }
  return replaySpots
}

function printTable(rows) {
  const headers = ['profile', 'spot', 'near', 'empty', 'boxed', 'none', 'draws/frames', 'settleMs', 'kerbMed', 'tipsOff', 'gap(med/min/max)+onMarking', 'samples', 'pageErr', 'httpErr']
  const alignRight = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
  const body = rows.map(r => {
    const httpErrs = Object.values(r.failedRequests ?? {}).reduce((sum, n) => sum + n, 0)
    if (r.error) {
      return [
        r.profile,
        r.spot,
        'ERR',
        '-',
        '-',
        '-',
        '-',
        '-',
        '-',
        '-',
        r.error.slice(0, 32),
        '-',
        String(r.pageErrors.length),
        String(httpErrs),
      ]
    }
    const kerbText = r.kerbDistance?.median != null ? `${r.kerbDistance.median.toFixed(2)}m` : '-'
    const gapText =
      r.gap?.median != null
        ? `${round(r.gap.median, 4)}/${round(r.gap.min, 4)}/${round(r.gap.max, 4)}+${r.gap.onMarking}`
        : '-'
    const samplesText = r.idleSamplesDelta ? `${r.samples}(+${r.idleSamplesDelta})` : String(r.samples)
    return [
      r.profile,
      r.spot,
      String(r.near),
      `${r.nearEmpty}/${r.empty}`,
      String(r.nearBoxed),
      String(r.nearNone),
      r.draws ? `${r.draws.draws}/${r.draws.frames}` : '-',
      `${r.settleMs}ms`,
      kerbText,
      String(r.tipsOffRoad),
      gapText,
      samplesText,
      String(r.pageErrors.length),
      String(httpErrs),
    ]
  })
  const widths = headers.map((h, i) => Math.max(h.length, ...body.map(row => row[i].length)))
  const fmtRow = row =>
    row.map((cell, i) => (alignRight.has(i) ? cell.padStart(widths[i]) : cell.padEnd(widths[i]))).join('  ')
  console.log(fmtRow(headers))
  console.log(widths.map(w => '-'.repeat(w)).join('  '))
  for (const row of body) console.log(fmtRow(row))
}

const args = parseArgs(process.argv.slice(2))
const spotFilterRaw = process.env.BAYS_SPOTS
const spotFilter = spotFilterRaw
  ? new Set(spotFilterRaw.split(',').map(s => s.trim()).filter(Boolean))
  : null
const spots = spotFilter?.size ? SPOTS.filter(s => spotFilter.has(s.id)) : SPOTS
if (!spots.length) throw new Error(`No matching spots for spot filter "${spotFilterRaw}"`)

// Always headless; use Metal on macOS unless SwiftShader is forced.
const useMetal = process.platform === 'darwin' && process.env.PERF_SWIFTSHADER !== '1'
const launchOptions = {
  headless: true,
  executablePath: process.env.CHROMIUM || undefined,
  args: useMetal
    ? ['--enable-gpu', '--use-angle=metal']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
}

let server
let browser

try {
  server = await preview({
    plugins: [telemetryPreview],
    root: 'web',
    configFile: 'web/vite.config.ts',
    build: {outDir: resolve(process.env.PERF_DIST ?? 'dist')},
    preview: {host: '127.0.0.1', port: 0},
  })
  const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
  const build = await fetch(`${baseUrl}/version.json`)
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null)

  browser = await chromium.launch(launchOptions)
  const renderer = await detectRenderer(browser)

  if (args.shotsDir) await mkdir(args.shotsDir, {recursive: true})

  if (args.camerasPath) {
    const rawCameras = JSON.parse(await readFile(args.camerasPath, 'utf8'))
    const replaySpots = loadReplayCameras(rawCameras, spotFilter)
    if (!replaySpots.length) throw new Error(`No matching cameras in ${args.camerasPath}`)
    let totalShots = 0
    const replayErrors = []
    for (const profileName of args.profileNames) {
      const profile = PROFILES[profileName]
      for (const {spot, cams} of replaySpots) {
        console.error(`[verify-parking-bays] replay ${profileName}/${spot.id} (${cams.length} cams) ...`)
        const res = await replaySpot(browser, baseUrl, profileName, profile, spot, cams, args.shotsDir)
        totalShots += res.shots
        if (res.error) {
          replayErrors.push(`${profileName}/${spot.id}: ${res.error}`)
          console.error(`[verify-parking-bays] replay ${profileName}/${spot.id} FAILED: ${res.error}`)
        }
      }
    }
    if (replayErrors.length) {
      for (const err of replayErrors) console.log(`  - ${err}`)
      process.exitCode = 1
    } else {
      console.log(`ok — replayed ${totalShots} screenshot(s) into ${args.shotsDir}`)
    }
  } else {
    const results = []
    const failures = []
    const spotCameras = new Map()
    const recordedCameras = []

    for (const profileName of args.profileNames) {
      const profile = PROFILES[profileName]
      for (const spot of spots) {
        console.error(`[verify-parking-bays] ${profileName}/${spot.id} (${spot.label}) ...`)
        const {summary} = await verifySpot(browser, baseUrl, profileName, profile, spot, {
          shotsDir: args.shotsDir,
          spotCameras,
          recordedCameras,
          failures,
        })
        results.push(summary)
        if (args.shotsDir && recordedCameras.length) {
          await writeFile(join(args.shotsDir, 'cameras.json'), JSON.stringify(recordedCameras, null, 2) + '\n')
        }
      }
    }

    if (args.shotsDir) {
      const report = {
        timestamp: new Date().toISOString(),
        build,
        browser: browser.version(),
        renderer,
        worldOverlay: WORLD_OVERLAY,
        geometry: {
          bayKerb: BAY_KERB,
          bayWidth: BAY_WIDTH,
          roadSide: ROAD_SIDE,
          bayLine: BAY_LINE,
          boxClearance: BOX_CLEARANCE,
        },
        profiles: args.profileNames,
        spots: spots.map(s => s.id),
        results,
        failures,
        ok: failures.length === 0,
      }
      await writeFile(join(args.shotsDir, 'verify-parking-bays.json'), JSON.stringify(report, null, 2) + '\n')
    }

    printTable(results)
    if (failures.length) {
      console.log(`\nFAIL (${failures.length}):`)
      for (const failure of failures) console.log(`  - ${failure}`)
      process.exitCode = 1
    } else {
      const primaryProfile = args.profileNames.includes('desktop') ? 'desktop' : args.profileNames[0]
      const checkedBays = results
        .filter(r => r.profile === primaryProfile)
        .reduce((sum, r) => sum + (r.near ?? 0), 0)
      console.log(`ok — parking bays: ${checkedBays} near drawn bays checked across ${spots.length} spot(s)`)
    }
  }
} finally {
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
}
