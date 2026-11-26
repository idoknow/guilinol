import {streetAreaFindings} from './street-triangulation.mjs'
import {evidencePath} from './photo-refs.mjs'
import {telemetryPreview} from './telemetry-preview.mjs'
import {execFileSync} from 'node:child_process'
import {cp, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'

const args = process.argv.slice(2)
const strict = args.includes('--strict')
const noShots = args.includes('--no-shots')
function argValue(flag, fallback) {
  const idx = args.indexOf(flag)
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback
}
const outDir = argValue('--out', 'captures')
const namedDir = argValue('--named-shots', '')
const spotsFrom = argValue('--spots-from', '')

await mkdir(outDir, {recursive: true})
const shotsDir = join(outDir, 'audit')
if (!noShots) {
  await rm(shotsDir, {recursive: true, force: true})
  await mkdir(shotsDir, {recursive: true})
}

// 1. Run pipeline-level audit across 100% of chunks, roads, buildings, trees, and landmarks
const pipelineOut = join(outDir, 'audit-pipeline.json')
execFileSync('uv', ['run', '--locked', 'python', 'pipeline/audit.py', '--out', pipelineOut], {
  stdio: 'inherit',
  timeout: Number(process.env.AUDIT_TIMEOUT_MS ?? 900000),
})
const streetOverflow = streetAreaFindings('public/world')
await writeFile(join(outDir, 'street-overflow.json'), JSON.stringify(streetOverflow, null, 2))
console.log('Street triangulation over 100.5%:', streetOverflow.length)
const pipelineReport = JSON.parse(await readFile(pipelineOut, 'utf8'))

// Ensure dist/ has fresh public/world & public/textures & public/landmarks if dist exists
if (existsSync('dist/index.html')) {
  for (const sub of ['world', 'textures', 'landmarks']) {
    const srcCheck = sub === 'world' ? 'public/world/manifest.json' : `public/${sub}`
    const dstCheck = sub === 'world' ? 'dist/world/manifest.json' : `dist/${sub}`
    if (existsSync(srcCheck)) {
      let needSync = !existsSync(dstCheck)
      if (!needSync && sub === 'world') {
        const [sStat, dStat] = await Promise.all([stat(srcCheck), stat(dstCheck)])
        needSync = sStat.mtimeMs > dStat.mtimeMs + 50
      }
      if (needSync || sub === 'textures') {
        await cp(`public/${sub}`, `dist/${sub}`, {recursive: true, force: true})
      }
    }
  }
}

// 2. Run browser-level audit in Playwright headless (SwiftShader)
const server = await preview({plugins:[telemetryPreview],root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
const port = server.httpServer.address().port
let browser
let browserReport
const catalog = evidencePath('refs/rock/photo-locations.json')
const photo = catalog && JSON.parse(await readFile(catalog, 'utf8'))['IMG_1299.jpg']
const namedViews = [
  {id: 'shizijie', label: '十字街', x: -891, z: -165, yaw: -1.2},
  {id: 'zhongshan', label: '中山中路', x: -935, z: -20, yaw: -0.18},
  {id: 'jiefang', label: '解放东路', x: -720, z: -168, yaw: -1.55},
  {id: 'ronghu', label: '榕湖北路', x: -1360, z: 105, yaw: 1.75},
  {id: 'binjiang', label: '滨江路', x: -255, z: 95, yaw: 0.25},
  {id: 'zhengyang', label: '正阳步行街', x: -612, z: -70, yaw: 0.12},
  ...(photo ? [{id: 'gunanmen', label: '走向古南门路口（榕荫路×三多路）', x: photo.x, z: photo.z, yaw: -photo.heading * Math.PI / 180, focal35: photo.focal35}] : []),
]

function pickDistinct(items, count, minSep = 15) {
  const chosen = []
  for (const it of items) {
    if (!Number.isFinite(it.x) || !Number.isFinite(it.z)) continue
    if (it.x === 0 && it.z === 0 && it.subtype === 'ktx2Failure') continue
    if (chosen.some(c => Math.hypot(c.x - it.x, c.z - it.z) < minSep)) continue
    chosen.push(it)
    if (chosen.length >= count) break
  }
  return chosen
}

try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const page = await browser.newPage({viewport: {width: 960, height: 540}})
  const consoleErrors = []
  const consoleWarnings = []
  page.on('pageerror', err => consoleErrors.push(err.message))
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push([msg.location().url, msg.text()].filter(Boolean).join(' '))
    else if (msg.type() === 'warning') consoleWarnings.push(msg.text())
  })
  await page.route('**/favicon.ico', route => route.fulfill({status: 204}))
  await page.route('**/api/t', route => route.fulfill({status: 204}))

  await page.goto(`http://127.0.0.1:${port}/?verify&mode=walk&radius=320&time=13.5`)
  await page.waitForFunction(() => window.viewer?.walk?.active, null, {timeout: 60000})

  const settleNear = (maxMs = 8000) => page.waitForFunction(() => {
    const {stats, stream, walk, manifest} = window.viewer
    const eye = walk.position
    return !stats.pending && manifest.chunks.every(
      t => Math.hypot(t.x + 128 - eye.x, t.z + 128 - eye.z) > stream.radius || stream.loaded.has(t),
    )
  }, null, {timeout: maxMs})

  // Visit major city anchors so chunks & landmarks stream into WebGL & Rapier
  const sweepAnchors = [
    [-885, -168], [-950, 90], [-610, -100],
    [-1410, 120], [-240, 60], [400, 330],
  ]
  for (const [ax, az] of sweepAnchors) {
    await page.evaluate(async ([x, z]) => {
      const {walk, stream} = window.viewer
      walk.leave()
      await walk.enter(x, z, 0, 'audit-sweep')
      for (let i = 0; i < 6; i++) {
        stream.tick(walk.position)
        await new Promise(r => requestAnimationFrame(r))
      }
    }, [ax, az])
    await settleNear()
  }
  await page.waitForTimeout(400)

  // Inspect live WebGL / Three.js / KTX2 state in the browser
  browserReport = await page.evaluate(async () => {
    const {stream, stats} = window.viewer
    const zFight = []
    const downNormals = []
    const uvStretch = []
    const ktx2Issues = []

    // Check KTX2 textures via fetch + head size and shader uniform readiness
    const channels = ['wall', 'roof', 'road', 'sidewalk', 'bank']
    for (const ch of channels) {
      const resp = await fetch(`./textures/${ch}.ktx2`)
      if (!resp.ok) {
        ktx2Issues.push({subtype: 'ktx2Failure', x: 0, z: 0, value: 1, detail: `HTTP ${resp.status} loading ${ch}.ktx2`})
      } else {
        const buf = await resp.arrayBuffer()
        const dv = new DataView(buf)
        const w = buf.byteLength >= 28 ? dv.getUint32(20, true) : 0
        const h = buf.byteLength >= 28 ? dv.getUint32(24, true) : 0
        if (buf.byteLength <= 512 || w <= 8 || h <= 8) {
          ktx2Issues.push({
            subtype: 'ktx2Failure', x: -885, z: -168, value: 1,
            detail: `Browser ${ch}.ktx2 is ${w}x${h} (${buf.byteLength}B) solid-color placeholder`,
          })
        }
      }
    }

    // Check polygonOffset on street surface mesh material
    const streetMesh = stream.batches?.streets?.mesh
    const streetMat = streetMesh?.material
    const hasPolyOffset = !!(streetMat && streetMat.polygonOffset)

    for (const [tile, data] of stream.loaded) {
      const surf = data.streets.surface
      const gPos = data.groundMesh.geometry.getAttribute('position')
      const segs = data.groundMesh.geometry.parameters.widthSegments || 32
      const gStep = 256 / segs, stride = segs + 1
      const groundAt = (lx, lz) => {
        const clx = Math.min(256, Math.max(0, lx)), clz = Math.min(256, Math.max(0, lz))
        const col = Math.min(segs - 1, Math.max(0, Math.floor(clx / gStep)))
        const row = Math.min(segs - 1, Math.max(0, Math.floor(clz / gStep)))
        const at = row * stride + col
        const u = clx / gStep - col, v = clz / gStep - row
        const a = gPos.getY(at), b = gPos.getY(at + 1), c = gPos.getY(at + stride), d = gPos.getY(at + stride + 1)
        return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v)
      }

      if (surf) {
        const pos = surf.getAttribute('position')
        const kind = surf.getAttribute('aSurface')
        const aAlong = surf.getAttribute('aAlong')
        // Note: ChunkBatcher.add shifted surf positions by (tile.x, tile.z)
        for (let i = 0; i < pos.count; i += 3) {
          const k = kind.getX(i)
          const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i)
          const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1)
          const cx = pos.getX(i + 2), cy = pos.getY(i + 2), cz = pos.getZ(i + 2)
          const e1x = bx - ax, e1y = by - ay, e1z = bz - az
          const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
          const nx = e1y * e2z - e1z * e2y
          const ny = e1z * e2x - e1x * e2z
          const nz = e1x * e2y - e1y * e2x
          const nlen = Math.hypot(nx, ny, nz)
          if (nlen < 1e-5) continue

          if (k === 3) {
            // Bank wall UV check: if aAlong is absent, tiles.ts uses (x+z) which stretches on NE-SW walls
            const horizLen = Math.hypot(bx - ax, bz - az)
            if (!aAlong && horizLen > 0.2 && Math.abs(by - cy) > 0.1) {
              const du = Math.abs((bx + bz) - (ax + az)) / horizLen
              if (du < 0.5 || du > 2.0) {
                uvStretch.push({
                  subtype: 'uvStretch', x: +(ax + bx) / 2, z: +(az + bz) / 2,
                  value: du < 1e-4 ? 999 : Math.max(du, 1 / du),
                  detail: `Browser bank triangle world-UV density=${du.toFixed(2)}x`,
                })
              }
            }
            continue
          }

          // Skip vertical sidewalk curb quads (|ny/nlen| < 0.25)
          if (Math.abs(ny / nlen) < 0.25) continue

          if (ny <= 0) {
            downNormals.push({
              subtype: 'downwardNormal', x: (ax + bx + cx) / 3, z: (az + bz + cz) / 3,
              value: -ny / nlen, detail: `Street surface kind=${k} downward normal`,
            })
          }

          // Check z-fighting (< 0.03m above groundMesh) at centroid, edge midpoints, and 8m grid vertices inside triangle
          const samples = [
            [(ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3],
            [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2],
            [(bx + cx) / 2, (by + cy) / 2, (bz + cz) / 2],
            [(cx + ax) / 2, (cy + ay) / 2, (cz + az) / 2],
            [ax, ay, az], [bx, by, bz], [cx, cy, cz],
          ]
          // Also test any groundMesh grid vertex inside the triangle bounding box
          const minLx = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - tile.x) / gStep)) * gStep
          const maxLx = Math.min(256, Math.floor((Math.max(ax, bx, cx) - tile.x) / gStep)) * gStep
          const minLz = Math.max(0, Math.ceil((Math.min(az, bz, cz) - tile.z) / gStep)) * gStep
          const maxLz = Math.min(256, Math.floor((Math.max(az, bz, cz) - tile.z) / gStep)) * gStep
          const detT = (bx - ax) * (cz - az) - (cx - ax) * (bz - az)
          if (Math.abs(detT) > 1e-5) {
            for (let gx = minLx; gx <= maxLx; gx += gStep) {
              for (let gz = minLz; gz <= maxLz; gz += gStep) {
                const wx = tile.x + gx, wz = tile.z + gz
                const w1 = ((wx - ax) * (cz - az) - (cx - ax) * (wz - az)) / detT
                const w2 = ((bx - ax) * (wz - az) - (wx - ax) * (bz - az)) / detT
                if (w1 >= 0 && w2 >= 0 && w1 + w2 <= 1) {
                  samples.push([wx, ay + w1 * (by - ay) + w2 * (cy - ay), wz])
                }
              }
            }
          }
          let minDiff = Infinity
          let worstPt = samples[0]
          for (const s of samples) {
            const diff = s[1] - groundAt(s[0] - tile.x, s[2] - tile.z)
            if (diff < minDiff) { minDiff = diff; worstPt = s }
          }
          if (minDiff < 0.03) {
            zFight.push({
              subtype: 'zFighting', x: +worstPt[0].toFixed(2), z: +worstPt[2].toFixed(2),
              value: +(0.03 - minDiff).toFixed(4),
              detail: `Street kind=${k} clearance=${(minDiff * 100).toFixed(2)}cm (<3cm) over groundMesh`,
            })
          }
        }
      }
    }

    return {
      loadedChunks: stream.loaded.size,
      loadedLandmarks: stream.landmarks.size,
      failures: stats.failures,
      hasPolygonOffset: hasPolyOffset,
      counts: {
        zFighting: zFight.length,
        downwardNormal: downNormals.length,
        uvStretch: uvStretch.length,
        ktx2Failure: ktx2Issues.length,
      },
      samples: {
        zFighting: zFight.sort((a, b) => b.value - a.value).slice(0, 60),
        downwardNormal: downNormals.slice(0, 60),
        uvStretch: uvStretch.sort((a, b) => b.value - a.value).slice(0, 60),
        ktx2Failure: ktx2Issues,
      },
    }
  })

  if (consoleErrors.length) {
    for (const msg of consoleErrors) {
      browserReport.samples.ktx2Failure.push({
        subtype: 'ktx2Failure', x: 0, z: 0, value: 1, detail: `Console error: ${msg}`,
      })
    }
    browserReport.counts.ktx2Failure = browserReport.samples.ktx2Failure.length
  }
  for (const msg of consoleWarnings) {
    if (msg.includes('City textures unavailable') || msg.includes('KTX2')) {
      browserReport.samples.ktx2Failure.push({
        subtype: 'ktx2Failure', x: 0, z: 0, value: 1, detail: `Console warning: ${msg}`,
      })
      browserReport.counts.ktx2Failure = browserReport.samples.ktx2Failure.length
    }
  }

  // Merge pipeline + browser texture issues
  const mergedCategories = structuredClone(pipelineReport.categories)
  const extraTex = [
    ...browserReport.samples.zFighting,
    ...browserReport.samples.downwardNormal,
    ...(pipelineReport.categories.textureIssue.bySubtype.ktx2Failure ? [] : browserReport.samples.ktx2Failure),
  ]
  mergedCategories.textureIssue.count +=
    browserReport.counts.zFighting +
    browserReport.counts.downwardNormal +
    (pipelineReport.categories.textureIssue.bySubtype.ktx2Failure ? 0 : browserReport.counts.ktx2Failure)
  if (browserReport.counts.zFighting) {
    mergedCategories.textureIssue.bySubtype.zFighting =
      (mergedCategories.textureIssue.bySubtype.zFighting ?? 0) + browserReport.counts.zFighting
  }
  if (browserReport.counts.downwardNormal) {
    mergedCategories.textureIssue.bySubtype.downwardNormal =
      (mergedCategories.textureIssue.bySubtype.downwardNormal ?? 0) + browserReport.counts.downwardNormal
  }
  if (!pipelineReport.categories.textureIssue.bySubtype.ktx2Failure && browserReport.counts.ktx2Failure) {
    mergedCategories.textureIssue.bySubtype.ktx2Failure = browserReport.counts.ktx2Failure
  }
  const combinedTexSample = [...extraTex, ...mergedCategories.textureIssue.sample100]
  mergedCategories.textureIssue.top20 = pickDistinct(combinedTexSample, 20, 12)

  for (const cat of ['buildingOnRoad', 'unevenRoad', 'otherBasic']) {
    mergedCategories[cat].top20 = pickDistinct(mergedCategories[cat].sample100, 20, 12)
  }

  // Helper to take an eye-level pedestrian-view screenshot (1.65 m eye height) looking at (tx, tz)
  async function shootPedestrian(tx, tz, filePath, fixedYaw = null, focal35 = null) {
    await page.evaluate(async ({tx, tz, fixedYaw, focal35}) => {
      const {walk, stream, camera, manifest} = window.viewer
      if (walk?.active) walk.leave()
      const yaw = fixedYaw ?? 0.25
      const back = fixedYaw !== null ? 0 : 10
      const ex = tx + Math.sin(yaw) * back
      const ez = tz + Math.cos(yaw) * back
      window.auditDefaultFov ??= camera.fov
      camera.fov = focal35 ? 2 * Math.atan(18 / (focal35 * camera.aspect)) * 180 / Math.PI : window.auditDefaultFov
      camera.updateProjectionMatrix()
      camera.position.set(ex, 155, ez)
      const tile = manifest.chunks.find(t => ex >= t.x && ex < t.x + 256 && ez >= t.z && ez < t.z + 256)
      const deadline = performance.now() + 6000
      while (tile && !stream.loaded.has(tile) && performance.now() < deadline) {
        stream.tick(camera.position)
        await new Promise(r => setTimeout(r, 16))
      }
      const groundY = (wx, wz) => {
        const t = manifest.chunks.find(c => wx >= c.x && wx < c.x + 256 && wz >= c.z && wz < c.z + 256)
        const d = t && stream.loaded.get(t)
        if (!d) return 152
        const gPos = d.groundMesh.geometry.getAttribute('position')
        const segs = d.groundMesh.geometry.parameters.widthSegments || 32
        const step = 256 / segs, stride = segs + 1
        const lx = Math.min(256, Math.max(0, wx - t.x)), lz = Math.min(256, Math.max(0, wz - t.z))
        const col = Math.min(segs - 1, Math.floor(lx / step)), row = Math.min(segs - 1, Math.floor(lz / step)), at = row * stride + col
        const u = lx / step - col, v = lz / step - row
        const a = gPos.getY(at), b = gPos.getY(at + 1), c = gPos.getY(at + stride), dd = gPos.getY(at + stride + 1)
        const gy = u + v <= 1 ? a + (b - a) * u + (c - a) * v : dd + (c - dd) * (1 - u) + (b - dd) * (1 - v)
        const wAt = Math.min(64, Math.round(lz / 4)) * 65 + Math.min(64, Math.round(lx / 4))
        return d.water[wAt] !== -32768 ? Math.max(gy, d.water[wAt] / 10) : gy
      }
      const ey = groundY(ex, ez) + (focal35 ? 1.5 : 1.68)
      camera.position.set(ex, ey, ez)
      if (fixedYaw !== null) {
        const lx = ex - Math.sin(fixedYaw) * 18
        const lz = ez - Math.cos(fixedYaw) * 18
        camera.lookAt(lx, groundY(lx, lz) + 1.35, lz)
      } else {
        camera.lookAt(tx, groundY(tx, tz) + 1.15, tz)
      }
      for (let i = 0; i < 5; i++) {
        stream.tick(camera.position)
        await new Promise(r => requestAnimationFrame(r))
      }
    }, {tx, tz, fixedYaw, focal35})
    await page.waitForFunction(() => {
      const {stats, stream, camera, manifest} = window.viewer
      return !stats.pending && manifest.chunks.every(
        t => Math.hypot(t.x + 128 - camera.position.x, t.z + 128 - camera.position.z) > stream.radius || stream.loaded.has(t),
      )
      && manifest.landmarks.every(lm =>
        Math.hypot(camera.position.x - lm.position[0], camera.position.y - lm.position[1], camera.position.z - lm.position[2]) - lm.sphere[3] > 350
        || stream.landmarks.has(lm))
    }, null, {timeout: 60000})
    await page.waitForTimeout(60)
    await page.evaluate(() => window.viewer.freeze())
    try { await page.screenshot({path: filePath}) }
    finally { await page.evaluate(() => window.viewer.resume()) }
    return true
  }

  // 3. Take up to 20 pedestrian screenshots per category (sorted spatially to reuse chunk cache!)
  const screenshots = {buildingOnRoad: [], unevenRoad: [], textureIssue: [], otherBasic: []}
  if (!noShots) {
    const jobs = []
    for (const cat of ['buildingOnRoad', 'unevenRoad', 'textureIssue', 'otherBasic']) {
      const top = mergedCategories[cat].top20.slice(0, 20)
      top.forEach((item, i) => {
        const xStr = Math.round(item.x), zStr = Math.round(item.z)
        const fname = `${cat}_${String(i + 1).padStart(2, '0')}_${item.subtype}_x${xStr}_z${zStr}.png`
        jobs.push({cat, item, fpath: join(shotsDir, fname)})
      })
    }
    jobs.sort((a, b) => (Math.floor(a.item.z / 512) - Math.floor(b.item.z / 512)) || (a.item.x - b.item.x))
    for (const job of jobs) {
      if (await shootPedestrian(job.item.x, job.item.z, job.fpath)) {
        screenshots[job.cat].push(job.fpath)
      }
    }
    for (const cat of Object.keys(screenshots)) screenshots[cat].sort()
  }

  // Optional: capture deterministic named street views + top 5 worst overall hotspots for before/after comparison
  if (namedDir) {
    await mkdir(namedDir, {recursive: true})
    let top5Spots
    if (spotsFrom && existsSync(spotsFrom)) {
      top5Spots = JSON.parse(await readFile(spotsFrom, 'utf8')).top5Spots
    } else {
      const pool = [
        ...mergedCategories.buildingOnRoad.top20.slice(0, 3),
        ...mergedCategories.unevenRoad.top20.slice(0, 3),
        ...mergedCategories.textureIssue.top20.slice(0, 3),
        ...mergedCategories.otherBasic.top20.slice(0, 3),
      ]
      top5Spots = pickDistinct(pool, 5, 40).map((it, i) => ({
        id: `hotspot_${i + 1}`,
        label: `问题点${i + 1}_${it.subtype}_x${Math.round(it.x)}_z${Math.round(it.z)}`,
        x: it.x,
        z: it.z,
        subtype: it.subtype,
        detail: it.detail,
      }))
      await writeFile(join(namedDir, 'spots.json'), JSON.stringify({namedViews, top5Spots}, null, 2) + '\n')
    }

    for (const v of namedViews) {
      await shootPedestrian(v.x, v.z, join(namedDir, `street_${v.id}_x${Math.round(v.x)}_z${Math.round(v.z)}.png`), v.yaw, v.focal35)
    }
    for (const sp of top5Spots) {
      await shootPedestrian(sp.x, sp.z, join(namedDir, `${sp.id}_x${Math.round(sp.x)}_z${Math.round(sp.z)}.png`))
    }
    if (!spotsFrom) {
      await writeFile(join(namedDir, 'spots.json'), JSON.stringify({namedViews, top5Spots}, null, 2) + '\n')
    }
  }

  const finalCounts = {
    streetOverflow: streetOverflow.length,
    buildingOnRoad: mergedCategories.buildingOnRoad.count,
    unevenRoad: mergedCategories.unevenRoad.count,
    textureIssue: mergedCategories.textureIssue.count,
    otherBasic: mergedCategories.otherBasic.count,
  }

  const finalAudit = {
    timestamp: new Date().toISOString(),
    counts: finalCounts,
    approvedExceptions: pipelineReport.approvedExceptions,
    totalIssues: Object.values(finalCounts).reduce((a, b) => a + b, 0),
    pipelineCounts: pipelineReport.counts,
    browserCounts: browserReport.counts,
    browserMeta: {
      loadedChunks: browserReport.loadedChunks,
      loadedLandmarks: browserReport.loadedLandmarks,
      hasPolygonOffset: browserReport.hasPolygonOffset,
      consoleErrors,
    },
    categories: {
      streetOverflow: {count: streetOverflow.length, top20: streetOverflow.slice(0, 20)},
      buildingOnRoad: {
        count: mergedCategories.buildingOnRoad.count,
        bySubtype: mergedCategories.buildingOnRoad.bySubtype,
        top20: mergedCategories.buildingOnRoad.top20,
        screenshots: screenshots.buildingOnRoad,
      },
      unevenRoad: {
        count: mergedCategories.unevenRoad.count,
        bySubtype: mergedCategories.unevenRoad.bySubtype,
        top20: mergedCategories.unevenRoad.top20,
        screenshots: screenshots.unevenRoad,
      },
      textureIssue: {
        count: mergedCategories.textureIssue.count,
        bySubtype: mergedCategories.textureIssue.bySubtype,
        top20: mergedCategories.textureIssue.top20,
        screenshots: screenshots.textureIssue,
      },
      otherBasic: {
        count: mergedCategories.otherBasic.count,
        bySubtype: mergedCategories.otherBasic.bySubtype,
        top20: mergedCategories.otherBasic.top20,
        screenshots: screenshots.otherBasic,
      },
    },
  }

  const auditJsonPath = join(outDir, 'audit.json')
  await writeFile(auditJsonPath, JSON.stringify(finalAudit, null, 2) + '\n')
  console.log('\n=== Scene Audit Summary ===')
  console.log(JSON.stringify(finalCounts, null, 2))
  for (const [k, v] of Object.entries(finalAudit.categories)) {
    console.log(`  ${k}: ${v.count}`, v.bySubtype ?? {})
  }
  console.log(`Wrote ${auditJsonPath}`)

  if (strict && finalAudit.totalIssues > 0) {
    console.error(`Audit STRICT failed: ${finalAudit.totalIssues} total issue(s) remaining.`)
    process.exitCode = 1
  }
} finally {
  await browser?.close()
  await server.close()
}
