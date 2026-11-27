// IDOK-399 — verify the city signal heads at fixed spots: draw-call budget, pole placement,
// live colour parity with the signal source, and optional overview/close-up screenshots.
// Run `npm run build` first (or set PERF_DIST), then:
//   node scripts/verify-signal-heads.mjs [--shots dir] [--cameras file] [--profile desktop|mobile|both]

import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {telemetryPreview} from './telemetry-preview.mjs'

const SPOT_TIMEOUT_MS = 180_000
const STABLE_POLL_MS = 500
const STABLE_STREAK = 6
const STABLE_MAX_MS = 40_000
const COLOUR_POLL_MS = 250
const COLOUR_LONG_MS = 50_000
const COLOUR_SHORT_MS = 5_000
const SHOT_SETTLE_MS = 1500
const SHIZIJIE_GANTRY_GROUP = 626322720
const QUERY = 'verify&solo=1&flow=0&time=17&traffic=1'
const WORLD_OVERLAY = process.env.PERF_WORLD ? resolve(process.env.PERF_WORLD) : null

const PROFILES = {
  desktop: {viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, isMobile: false, hasTouch: false},
  mobile: {viewport: {width: 844, height: 390}, deviceScaleFactor: 2, isMobile: true, hasTouch: true},
}

const SPOTS = [
  {id: 'shizijie', label: '十字街路口', eye: [-850, 161, -130], target: [-895, 151, -180]},
  {id: 'jiefang', label: '解放桥街头', eye: [-265, 168, 15], target: [-145, 153, 45]},
  {id: 'zhongshan', label: '中山路-解放西路口', eye: [-1414, 162, -299], target: [-1454, 153, -330]},
  {id: 'school', label: '乐群小学周边', eye: [-1060, 162, -500], target: [-1090, 153, -525]},
  {id: 'south', label: '南区主干路口', eye: [-2040, 164, 1955], target: [-2075, 154, 1920]},
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

function headCamera(head) {
  const fzX = Math.sin(head.yaw)
  const fzZ = Math.cos(head.yaw)
  const fxX = Math.cos(head.yaw)
  const fxZ = -Math.sin(head.yaw)
  const arm = head.arm > 0 ? head.arm : 0
  const side = arm > 0 ? arm : 2.5
  return {
    eye: [
      round(head.x + fzX * 22 - fxX * side),
      round(head.y + 2.6),
      round(head.z + fzZ * 22 - fxZ * side),
    ],
    target: [
      round(head.x - fxX * (arm * 0.5)),
      round(head.y + (arm > 0 ? 5.2 : 2.6)),
      round(head.z - fxZ * (arm * 0.5)),
    ],
  }
}

function buildSpotCameras(spot, heads, walker) {
  const cams = [{name: 'overview', eye: spot.eye, target: spot.target}]
  const nearest = [...heads]
    .sort(
      (a, b) =>
        Math.hypot(a.x - walker.x, a.z - walker.z) - Math.hypot(b.x - walker.x, b.z - walker.z) ||
        String(a.key).localeCompare(String(b.key)),
    )
    .slice(0, 3)
  nearest.forEach((head, idx) => {
    cams.push({name: `head${idx + 1}`, ...headCamera(head)})
  })
  return cams
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

  // Teleport walker to the spot and pin the camera via mutable window.__pin.
  await page.evaluate(
    async ({eye, target}) => {
      const viewer = window.viewer
      if (!(await viewer.walkTo(eye[0], eye[2], 0, 'verify-signal-heads'))) {
        throw new Error('viewer.walkTo returned false')
      }
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
    },
    {eye: spot.eye, target: spot.target},
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

  return {page, trafficLoaded}
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
  const {shotsDir, allowLongSample, spotCameras, recordedCameras, failures} = options
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
    const {page, trafficLoaded} = await openSpotPage(context, baseUrl, spot, diag)
    if (!trafficLoaded) {
      failures.push(`${tag}: trafficProbe.loads stayed empty after 60s`)
    }

    // Wait until signalHeads().heads.length stays unchanged for 6 consecutive 500ms polls (max 40s).
    const stable = await page.evaluate(
      async ({pollMs, streak, maxMs}) => {
        const probe = window.viewer?.trafficProbe
        if (typeof probe?.signalHeads !== 'function') return {missing: true}
        const deadline = Date.now() + maxMs
        let prevLen = -1
        let unchanged = 0
        while (true) {
          const snap = probe.signalHeads()
          const len = Array.isArray(snap?.heads) ? snap.heads.length : 0
          if (len === prevLen) unchanged++
          else {
            prevLen = len
            unchanged = 0
          }
          if (unchanged >= streak) return {missing: false, settled: true}
          const remaining = deadline - Date.now()
          if (remaining <= 0) return {missing: false, settled: false}
          await new Promise(r => setTimeout(r, Math.min(pollMs, remaining)))
        }
      },
      {pollMs: STABLE_POLL_MS, streak: STABLE_STREAK, maxMs: STABLE_MAX_MS},
    )

    if (stable.missing) {
      failures.push(`${tag}: viewer.trafficProbe.signalHeads() is missing`)
      return {
        summary: {
          spot: spot.id,
          profile: profileName,
          heads: 0,
          total: 0,
          pending: 0,
          none: 0,
          arms: 0,
          posts: 0,
          colourSamples: 0,
          mismatches: 0,
          coloursSeen: [],
          pageErrors: diag.pageErrors,
          consoleErrors: diag.consoleErrors,
          failedRequests: Object.fromEntries(diag.failedRequests),
          error: 'signalHeads probe missing',
        },
        usedLongSample: false,
      }
    }

    // Inspect scene node, drawCalls, head metadata, and pole base surface clearance.
    const inspected = await page.evaluate(() => {
      const viewer = window.viewer
      const snap = viewer.trafficProbe.signalHeads()
      const rawHeads = Array.isArray(snap?.heads) ? snap.heads : []
      const undefinedSurface = []
      const carriagewaySurface = []
      const heads = rawHeads.map(h => {
        const surf = viewer.stream.surfaceAt(h.x, h.z)
        if (surf === undefined || surf === null) {
          undefinedSurface.push({key: h.key, x: h.x, z: h.z})
        } else {
          const list = Array.from(surf)
          if (list.includes(0)) carriagewaySurface.push({key: h.key, x: h.x, z: h.z, surf: list})
        }
        return {key: h.key, group: h.group, x: h.x, y: h.y, z: h.z, yaw: h.yaw, arm: h.arm}
      })
      const pos = viewer.walk.position
      return {
        total: snap?.total ?? 0,
        pending: snap?.pending ?? 0,
        none: snap?.none ?? 0,
        drawCalls: snap?.drawCalls,
        heads,
        undefinedSurface,
        carriagewaySurface,
        walker: {x: pos.x, y: pos.y, z: pos.z},
      }
    })

    // 3a: Draw call budget. The probe counts the visible meshes of the head group that are in the scene:
    // two while any head is shown (poles + lenses), none otherwise.
    const expectedCalls = inspected.heads.length ? 2 : 0
    if (inspected.drawCalls !== expectedCalls) {
      failures.push(`${tag}: signalHeads drawCalls is ${inspected.drawCalls} (expected ${expectedCalls} with ${inspected.heads.length} heads)`)
    }

    // 3b: Pole base surface loaded and off motor carriageway (0).
    if (inspected.undefinedSurface.length) {
      const sample = inspected.undefinedSurface
        .slice(0, 5)
        .map(h => `${h.key}@(${round(h.x, 1)},${round(h.z, 1)})`)
        .join(', ')
      failures.push(`${tag}: ${inspected.undefinedSurface.length} head(s) have undefined surfaceAt(x,z): ${sample}`)
    }
    if (inspected.carriagewaySurface.length) {
      const sample = inspected.carriagewaySurface
        .slice(0, 5)
        .map(h => `${h.key}@(${round(h.x, 1)},${round(h.z, 1)})=[${h.surf.join(',')}]`)
        .join(', ')
      failures.push(`${tag}: ${inspected.carriagewaySurface.length} head(s) on carriageway (surface includes 0): ${sample}`)
    }

    // 3c: Excluded Shizijie gantry group.
    const excluded = inspected.heads.filter(h => h.group === SHIZIJIE_GANTRY_GROUP)
    if (excluded.length) {
      failures.push(
        `${tag}: ${excluded.length} head(s) in excluded Shizijie group ${SHIZIJIE_GANTRY_GROUP}: ${excluded.slice(0, 5).map(h => h.key).join(', ')}`,
      )
    }

    // 3d: Unique head keys.
    const seenKeys = new Set()
    const dupKeys = []
    for (const h of inspected.heads) {
      if (seenKeys.has(h.key)) dupKeys.push(h.key)
      else seenKeys.add(h.key)
    }
    if (dupKeys.length) {
      failures.push(`${tag}: ${dupKeys.length} duplicate head key(s): ${[...new Set(dupKeys)].slice(0, 5).join(', ')}`)
    }

    // 3e: Colour parity polling (50s on first spot with >=2 heads, 5s on remaining spots).
    const isLongSample = allowLongSample && inspected.heads.length >= 2
    const sampleMs = isLongSample ? COLOUR_LONG_MS : COLOUR_SHORT_MS
    const colour = await page.evaluate(
      async ({durationMs, pollMs}) => {
        const probe = window.viewer.trafficProbe
        const start = performance.now()
        let samples = 0
        let mismatches = 0
        const mismatchSamples = []
        const allColours = new Set()
        const perHeadColours = new Map()

        while (true) {
          samples++
          const snap = probe.signalHeads()
          const list = Array.isArray(snap?.heads) ? snap.heads : []
          for (const h of list) {
            if (h.shown != null) allColours.add(String(h.shown))
            if (typeof h.shown === 'string' && h.shown && h.shown !== 'dark') {
              let set = perHeadColours.get(h.key)
              if (!set) {
                set = new Set()
                perHeadColours.set(h.key, set)
              }
              set.add(h.shown)
            }
            if (h.truth == null || h.shown !== h.truth) {
              mismatches++
              if (mismatchSamples.length < 5) {
                mismatchSamples.push({key: h.key, shown: h.shown, truth: h.truth, sample: samples})
              }
            }
          }
          const remaining = durationMs - (performance.now() - start)
          if (remaining <= 0) break
          await new Promise(r => setTimeout(r, Math.min(pollMs, remaining)))
        }

        let maxColoursOnOneHead = 0
        for (const set of perHeadColours.values()) {
          if (set.size > maxColoursOnOneHead) maxColoursOnOneHead = set.size
        }
        return {
          samples,
          mismatches,
          mismatchSamples,
          coloursSeen: [...allColours].sort(),
          maxColoursOnOneHead,
        }
      },
      {durationMs: sampleMs, pollMs: COLOUR_POLL_MS},
    )

    if (colour.mismatches > 0) {
      const sampleText = colour.mismatchSamples
        .map(m => `#${m.sample} ${m.key}: shown=${String(m.shown)} truth=${String(m.truth)}`)
        .join('; ')
      failures.push(`${tag}: ${colour.mismatches} colour mismatch(es) over ${colour.samples} samples (${sampleText})`)
    }
    if (isLongSample && colour.maxColoursOnOneHead < 2) {
      failures.push(
        `${tag}: no head changed colour during ${sampleMs / 1000}s sample (max per-head=${colour.maxColoursOnOneHead}, seen=[${colour.coloursSeen.join(',')}])`,
      )
    }

    // 4: Optional overview + closest 3 driver-view screenshots.
    if (shotsDir) {
      let cams = spotCameras.get(spot.id)
      if (!cams) {
        cams = buildSpotCameras(spot, inspected.heads, inspected.walker)
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

    // 3f: Zero uncaught page errors.
    if (diag.pageErrors.length > 0) {
      failures.push(`${tag}: ${diag.pageErrors.length} pageerror(s): ${diag.pageErrors.slice(0, 3).join('; ')}`)
    }

    const arms = inspected.heads.filter(h => h.arm > 0).length
    const posts = inspected.heads.length - arms
    return {
      summary: {
        spot: spot.id,
        profile: profileName,
        heads: inspected.heads.length,
        total: inspected.total,
        pending: inspected.pending,
        none: inspected.none,
        arms,
        posts,
        colourSamples: colour.samples,
        mismatches: colour.mismatches,
        coloursSeen: colour.coloursSeen,
        pageErrors: diag.pageErrors,
        failedRequests: Object.fromEntries(diag.failedRequests),
        ...(diag.consoleErrors.length ? {consoleErrors: diag.consoleErrors} : {}),
        ...(colour.mismatchSamples.length ? {mismatchSamples: colour.mismatchSamples} : {}),
      },
      usedLongSample: isLongSample,
    }
  } catch (err) {
    const message = timedOut
      ? `Spot timed out after ${SPOT_TIMEOUT_MS / 1000}s`
      : err instanceof Error
        ? err.message
        : String(err)
    failures.push(`${tag}: ${message}`)
    return {
      summary: {
        spot: spot.id,
        profile: profileName,
        heads: 0,
        total: 0,
        pending: 0,
        none: 0,
        arms: 0,
        posts: 0,
        colourSamples: 0,
        mismatches: 0,
        coloursSeen: [],
        pageErrors: diag.pageErrors,
        failedRequests: Object.fromEntries(diag.failedRequests),
        ...(diag.consoleErrors.length ? {consoleErrors: diag.consoleErrors} : {}),
        error: message,
      },
      usedLongSample: false,
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
      spot: byId.get(id) ?? {id, label: id, eye: cams[0].eye, target: cams[0].target},
      cams,
    })
  }
  return replaySpots
}

function printTable(rows) {
  const headers = ['profile', 'spot', 'heads', 'total', 'pend', 'none', 'arm/post', 'samples', 'mismatch', 'colours', 'pageErr', 'httpErr']
  const alignRight = new Set([2, 3, 4, 5, 6, 7, 8, 10, 11])
  const body = rows.map(r => {
    const httpErrs = Object.values(r.failedRequests ?? {}).reduce((sum, n) => sum + n, 0)
    if (r.error) {
      return [r.profile, r.spot, 'ERR', '-', '-', '-', '-', '-', '-', r.error.slice(0, 32), String(r.pageErrors.length), String(httpErrs)]
    }
    return [
      r.profile,
      r.spot,
      String(r.heads),
      String(r.total),
      String(r.pending),
      String(r.none),
      `${r.arms}/${r.posts}`,
      String(r.colourSamples),
      String(r.mismatches),
      r.coloursSeen.join(',') || '-',
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
const spotFilter = process.env.HEADS_SPOTS
  ? new Set(process.env.HEADS_SPOTS.split(',').map(s => s.trim()).filter(Boolean))
  : null
const spots = spotFilter?.size ? SPOTS.filter(s => spotFilter.has(s.id)) : SPOTS
if (!spots.length) throw new Error(`No matching spots for HEADS_SPOTS="${process.env.HEADS_SPOTS}"`)

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
        console.error(`[verify-signal-heads] replay ${profileName}/${spot.id} (${cams.length} cams) ...`)
        const res = await replaySpot(browser, baseUrl, profileName, profile, spot, cams, args.shotsDir)
        totalShots += res.shots
        if (res.error) {
          replayErrors.push(`${profileName}/${spot.id}: ${res.error}`)
          console.error(`[verify-signal-heads] replay ${profileName}/${spot.id} FAILED: ${res.error}`)
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
      let longSampleDone = false
      for (const spot of spots) {
        console.error(`[verify-signal-heads] ${profileName}/${spot.id} (${spot.label}) ...`)
        const {summary, usedLongSample} = await verifySpot(browser, baseUrl, profileName, profile, spot, {
          shotsDir: args.shotsDir,
          allowLongSample: !longSampleDone,
          spotCameras,
          recordedCameras,
          failures,
        })
        if (usedLongSample) longSampleDone = true
        results.push(summary)
        if (args.shotsDir && recordedCameras.length) {
          await writeFile(join(args.shotsDir, 'cameras.json'), JSON.stringify(recordedCameras, null, 2) + '\n')
        }
      }
    }

    // Global assertion: sum of heads across spots (desktop profile when run) >= 8.
    const primaryProfile = args.profileNames.includes('desktop') ? 'desktop' : args.profileNames[0]
    const checkedHeads = results
      .filter(r => r.profile === primaryProfile)
      .reduce((sum, r) => sum + (r.heads ?? 0), 0)
    if (checkedHeads < 8) {
      failures.push(`global: total ${primaryProfile} heads across spots is ${checkedHeads} (expected >= 8)`)
    }

    if (args.shotsDir) {
      const report = {
        timestamp: new Date().toISOString(),
        build,
        browser: browser.version(),
        renderer,
        worldOverlay: WORLD_OVERLAY,
        profiles: args.profileNames,
        spots: spots.map(s => s.id),
        results,
        failures,
        ok: failures.length === 0,
      }
      await writeFile(join(args.shotsDir, 'verify-signal-heads.json'), JSON.stringify(report, null, 2) + '\n')
    }

    printTable(results)
    if (failures.length) {
      console.log(`\nFAIL (${failures.length}):`)
      for (const failure of failures) console.log(`  - ${failure}`)
      process.exitCode = 1
    } else {
      console.log(`ok — signal heads: ${checkedHeads} heads checked, colours match the signal source`)
    }
  }
} finally {
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
}
