import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {glHookScript} from './gl-perf.mjs'
import {telemetryPreview} from './telemetry-preview.mjs'

const MB = 1048576
const SPOT_TIMEOUT_MS = 240_000
const QUERY = 'verify&solo=1&flow=0&time=17&traffic=1'
// Optional directory laid out like the site root (`<dir>/world/roads/<cell>.json.gz`). Road cells found
// there replace the build's own, e.g. to measure with production road data when the local world is older.
const WORLD_OVERLAY = process.env.PERF_WORLD ? resolve(process.env.PERF_WORLD) : null

const PROFILES = {
  desktop: {
    viewport: {width: 1440, height: 900},
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    cpuRate: 1,
  },
  mobile: {
    viewport: {width: 844, height: 390},
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    cpuRate: 4,
  },
}

const SPOTS = [
  {id: 'shizijie', label: '十字街路口', eye: [-850, 161, -130], target: [-895, 151, -180]},
  {id: 'jiefang', label: '解放桥街头', eye: [-265, 168, 15], target: [-145, 153, 45]},
  {id: 'zhongshan', label: '中山路-解放西路口', eye: [-1414, 162, -299], target: [-1454, 153, -330]},
  {id: 'school', label: '乐群小学周边', eye: [-1060, 162, -500], target: [-1090, 153, -525]},
  {id: 'south', label: '南区主干路口', eye: [-2040, 164, 1955], target: [-2075, 154, 1920]},
]

function parseArgs(argv) {
  let profile = null
  let compare = null
  let runs = null
  let hot = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--profile') {
      profile = argv[++i]
      if (!profile) throw new Error('--profile requires desktop or mobile')
    } else if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length)
    } else if (arg === '--compare') {
      compare = argv[++i]
      if (!compare) throw new Error('--compare requires a perf-city.json path')
    } else if (arg.startsWith('--compare=')) {
      compare = arg.slice('--compare='.length)
    } else if (arg === '--runs') {
      runs = Number(argv[++i])
    } else if (arg.startsWith('--runs=')) {
      runs = Number(arg.slice('--runs='.length))
    } else if (arg === '--hot') {
      hot = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (runs !== null && !(Number.isInteger(runs) && runs >= 1)) throw new Error('--runs requires a positive integer')
  return {profile, compare, runs, hot}
}

function envNumber(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}: ${raw}`)
  return value
}

function round(n, digits = 2) {
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null
}

function percentile(sorted, p) {
  if (!sorted.length) return null
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

function p95(values) {
  if (!Array.isArray(values)) return null
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  return sorted.length ? round(percentile(sorted, 0.95)) : null
}

function fmt(value, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '-'
}

function fmtCompare(prev, next) {
  if (typeof prev !== 'number' || typeof next !== 'number') {
    return prev == null && next == null ? '-' : `${fmt(prev)} → ${fmt(next)}`
  }
  if (prev === 0) return `${fmt(prev)} → ${fmt(next)} (${next === 0 ? '0.0%' : 'n/a'})`
  const pct = ((next - prev) / Math.abs(prev)) * 100
  return `${fmt(prev)} → ${fmt(next)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`
}

function escapeCell(text) {
  return String(text).replace(/[\r\n|]+/g, ' ').trim().slice(0, 120)
}

function median(values) {
  const sorted = values.filter(v => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b)
  if (!sorted.length) return null
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : round((sorted[mid - 1] + sorted[mid]) / 2, 3)
}

/** One result per spot from several runs: the median of every numeric metric, every error kept. */
function mergeRuns(results) {
  const good = results.filter(result => !result.error)
  if (results.length === 1) return results[0]
  if (!good.length) return {...results[results.length - 1], failedRuns: results.map(result => result.error)}
  const merged = {...good[good.length - 1]}
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === 'number') merged[key] = median(good.map(result => result[key]))
  }
  if (merged.trafficStepPartsP95) {
    merged.trafficStepPartsP95 = Object.fromEntries(
      Object.keys(merged.trafficStepPartsP95).map(key => [key, median(good.map(result => result.trafficStepPartsP95?.[key]))]),
    )
  }
  for (const key of ['consoleErrors', 'pageErrors', 'failedRequests']) merged[key] = results.flatMap(result => result[key] ?? [])
  // A spot with at least one good run keeps its medians; the runs that failed are listed beside them.
  const failed = results.filter(result => result.error).map(result => result.error)
  if (failed.length) merged.failedRuns = failed
  merged.runs = results.map(result => ({
    fps: result.fps ?? null,
    mainThreadMsPerFrame: result.mainThreadMsPerFrame ?? null,
    drawCallsAvg: result.drawCallsAvg ?? null,
    allocMBps: result.allocMBps ?? null,
  }))
  return merged
}

function shortUrl(url) {
  return url ? url.replace(/^.*\//, '').replace(/\?.*$/, '') : '(native)'
}

/** file:line:column, so functions that share a line in a minified chunk stay apart. */
function frameKey(frame) {
  return `${frame.functionName || '(anonymous)'} ${shortUrl(frame.url)}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`
}

/** Self time per function from a CDP CPU profile, heaviest first; shares are of busy (non-idle) time. */
function hotCpu(profile, limit = 25) {
  const self = new Map()
  const byId = new Map(profile.nodes.map(node => [node.id, node]))
  let total = 0
  profile.samples.forEach((id, index) => {
    const dt = profile.timeDeltas[index] ?? 0
    const frame = byId.get(id)?.callFrame
    // Shares are of the time the main thread was busy; waiting for the next frame is not a hot spot.
    if (!frame || frame.functionName === '(idle)') return
    total += dt
    const key = frameKey(frame)
    self.set(key, (self.get(key) ?? 0) + dt)
  })
  return [...self]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([where, micros]) => ({where, ms: round(micros / 1000), pct: total ? round((micros / total) * 100, 1) : 0}))
}

/** Bytes allocated per function from a CDP sampling heap profile, heaviest first. */
function hotAlloc(profile, limit = 25) {
  const self = new Map()
  let total = 0
  const walk = node => {
    const key = frameKey(node.callFrame)
    if (node.selfSize) {
      self.set(key, (self.get(key) ?? 0) + node.selfSize)
      total += node.selfSize
    }
    node.children?.forEach(walk)
  }
  walk(profile.head)
  return [...self]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([where, bytes]) => ({where, mb: round(bytes / MB), pct: total ? round((bytes / total) * 100, 1) : 0}))
}

async function readCdpMetrics(cdp) {
  const {metrics} = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(metrics.map(m => [m.name, m.value]))
}

// Probe the unmasked WebGL renderer once in an isolated blank page.
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

async function measureSpot(browser, baseUrl, profileName, profile, spot, settleMs, sampleMs, outDir) {
  const consoleErrors = []
  const pageErrors = []
  const failedRequests = []
  let context = null
  let timedOut = false
  // Hard per-spot wall-clock guard: closing the context aborts any pending Playwright/CDP call.
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
    await context.addInitScript(glHookScript)
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
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', err => {
      pageErrors.push(err.message)
    })
    // Console only says "Failed to load resource"; keep the path so a 404 can be told apart from a real fault.
    page.on('response', response => {
      if (response.status() >= 400) failedRequests.push(`${response.status()} ${new URL(response.url()).pathname}`)
    })

    const cdp = await context.newCDPSession(page)
    await cdp.send('Performance.enable')
    await cdp.send('Emulation.setCPUThrottlingRate', {rate: profile.cpuRate})

    await page.goto(`${baseUrl}/?${QUERY}`, {timeout: 120_000})
    await page.waitForFunction(() => Boolean(window.viewer?.walk?.active), null, {timeout: 120_000})

    // Teleport walker to the fixed spot and pin the camera each walk tick.
    await page.evaluate(
      async ({eye, target}) => {
        const viewer = window.viewer
        if (!(await viewer.walkTo(eye[0], eye[2], 0, 'perf-city'))) {
          throw new Error('viewer.walkTo returned false')
        }
        const tick = viewer.walk.tick.bind(viewer.walk)
        viewer.perfTarget = target
        const pin = () => {
          viewer.camera.position.set(eye[0], eye[1], eye[2])
          viewer.camera.lookAt(target[0], target[1], target[2])
          viewer.camera.updateMatrixWorld()
        }
        pin()
        viewer.walk.tick = elapsed => {
          tick(elapsed)
          pin()
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

    // Street traffic loads its road cell asynchronously; sampling before that measures an empty city.
    await page
      .waitForFunction(() => window.viewer.trafficProbe?.loads?.length > 0, null, {timeout: 60_000})
      .catch(() => consoleErrors.push('perf-city: traffic cell did not load within 60 s'))
    if (settleMs > 0) await page.waitForTimeout(settleMs)

    if (HOT) {
      await cdp.send('Profiler.enable')
      await cdp.send('Profiler.setSamplingInterval', {interval: 200})
      await cdp.send('HeapProfiler.enable')
      // Report everything allocated in the window, including what a GC already collected.
      await cdp.send('HeapProfiler.startSampling', {samplingInterval: 8192, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true})
      // Whole-document selector queries are a classic per-frame cost; count them over the window.
      await page.evaluate(() => {
        const original = Document.prototype.querySelector
        window.__perfDocQueries = 0
        Document.prototype.querySelector = function (selector) {
          window.__perfDocQueries++
          return original.call(this, selector)
        }
      })
      await cdp.send('Profiler.start')
    }
    const cdpBefore = await readCdpMetrics(cdp)
    const sample = await page.evaluate(async durationMs => {
      const nextRaf = () => new Promise(r => requestAnimationFrame(r))
      const oneMB = 1048576
      const dts = []
      let drawCallsSum = 0
      let trianglesSum = 0
      let motorsSum = 0
      let pedestriansSum = 0

      const start = await nextRaf()
      let last = start
      const hasMem = typeof performance.memory?.usedJSHeapSize === 'number'
      const heapStartBytes = hasMem ? performance.memory.usedJSHeapSize : null
      let heapPeakBytes = heapStartBytes ?? 0
      let prevHeap = heapStartBytes
      let allocBytes = 0
      let gcDrops = 0
      let gcDropBytes = 0

      do {
        window.__glPerf.resetFrame()
        const now = await nextRaf()
        const dt = now - last
        last = now
        dts.push(dt)

        const draw = window.__glPerf.readFrame()
        // The post pipeline renders the scene into an offscreen target, so count every pass.
        drawCallsSum += draw.totalCalls
        trianglesSum += draw.totalTriangles

        const probe = window.viewer?.trafficProbe
        motorsSum += probe?.motors ?? 0
        pedestriansSum += probe?.pedestrians ?? 0

        if (hasMem) {
          const heap = performance.memory.usedJSHeapSize
          if (heap > heapPeakBytes) heapPeakBytes = heap
          const delta = heap - prevHeap
          if (delta > 0) allocBytes += delta
          else if (-delta > oneMB) {
            gcDrops += 1
            gcDropBytes += -delta
          }
          prevHeap = heap
        }
      } while (last - start < durationMs)

      const probe = window.viewer?.trafficProbe
      const stepMs = probe?.stepMs ? Array.from(probe.stepMs) : null
      const contactMs = probe?.contactMs ? Array.from(probe.contactMs) : null
      const stepParts =
        probe?.stepParts && typeof probe.stepParts === 'object'
          ? Object.fromEntries(
              Object.entries(probe.stepParts).map(([k, v]) => [k, v ? Array.from(v) : null]),
            )
          : null

      // Single-source check: every lane the street sim controls must read the same colour from the city plan.
      function signalSnapshot(signals) {
        let checked = 0, mismatched = 0
        for (const node of signals.nodes()) {
          for (const lane of signals.state(node).lanes.flat()) {
            const fromSim = signals.sim(node, lane)
            if (fromSim === null) continue
            checked++
            if (fromSim !== signals.color(node, lane)) mismatched++
          }
        }
        return {count: signals.count(), clock: signals.clock(), checked, mismatched}
      }

      return {
        dts,
        windowMs: last - start,
        drawCallsSum,
        trianglesSum,
        motorsSum,
        pedestriansSum,
        trafficState: probe
          ? {simTime: probe.simTime ?? null, loads: probe.loads?.length ?? 0, allMotors: probe.allMotors?.length ?? 0, parked: probe.parked ?? 0, queued: probe.queued ?? 0, redStops: probe.redStops ?? 0, staticOnly: Boolean(probe.staticOnly), signals: probe.signals ? signalSnapshot(probe.signals) : null}
          : null,
        hasMem,
        heapStartBytes,
        heapPeakBytes,
        allocBytes,
        gcDrops,
        gcDropBytes,
        stepMs,
        contactMs,
        stepParts,
      }
    }, sampleMs)
    const cdpAfter = await readCdpMetrics(cdp)
    let hot = null
    if (HOT) {
      const cpu = (await cdp.send('Profiler.stop')).profile
      const heap = (await cdp.send('HeapProfiler.stopSampling')).profile
      await writeFile(join(outDir, `${profileName}-${spot.id}.cpuprofile`), JSON.stringify(cpu))
      const docQueries = await page.evaluate(() => window.__perfDocQueries)
      hot = {docQueriesPerFrame: round(docQueries / Math.max(1, sample.dts.length)), cpu: hotCpu(cpu), alloc: hotAlloc(heap)}
    }

    await page.screenshot({
      path: join(outDir, `${profileName}-${spot.id}.jpg`),
      type: 'jpeg',
      quality: 80,
    })

    const frames = sample.dts.length
    const sortedDts = [...sample.dts].sort((a, b) => a - b)
    const meanDt = sample.dts.reduce((sum, dt) => sum + dt, 0) / frames
    const windowSec = sample.windowMs / 1000
    const cdpMsPerFrame = key => {
      const before = cdpBefore[key]
      const after = cdpAfter[key]
      if (!Number.isFinite(before) || !Number.isFinite(after) || frames <= 0) return null
      return round((Math.max(0, after - before) * 1000) / frames)
    }

    return {
      label: spot.label,
      fps: meanDt > 0 ? round(1000 / meanDt) : null,
      frameMsMean: round(meanDt),
      frameMsP50: round(percentile(sortedDts, 0.5)),
      frameMsP95: round(percentile(sortedDts, 0.95)),
      frameMsP99: round(percentile(sortedDts, 0.99)),
      frameMsMax: round(sortedDts[sortedDts.length - 1]),
      longFrames33: sample.dts.filter(dt => dt > 33.4).length,
      longFrames50: sample.dts.filter(dt => dt > 50).length,
      frames,
      mainThreadMsPerFrame: cdpMsPerFrame('TaskDuration'),
      scriptMsPerFrame: cdpMsPerFrame('ScriptDuration'),
      drawCallsAvg: round(sample.drawCallsSum / frames),
      trianglesAvg: round(sample.trianglesSum / frames),
      motorsAvg: round(sample.motorsSum / frames),
      pedestriansAvg: round(sample.pedestriansSum / frames),
      trafficState: sample.trafficState,
      heapStartMB: sample.hasMem ? round(sample.heapStartBytes / MB) : null,
      heapPeakMB: sample.hasMem ? round(sample.heapPeakBytes / MB) : null,
      allocMBps: sample.hasMem && windowSec > 0 ? round(sample.allocBytes / MB / windowSec) : null,
      gcDrops: sample.hasMem ? sample.gcDrops : null,
      gcDropMB: sample.hasMem ? round(sample.gcDropBytes / MB) : null,
      trafficStepP95: p95(sample.stepMs),
      trafficContactP95: p95(sample.contactMs),
      trafficStepPartsP95: sample.stepParts
        ? Object.fromEntries(Object.entries(sample.stepParts).map(([k, v]) => [k, p95(v)]))
        : null,
      ...(hot ? {hot} : {}),
      consoleErrors,
      pageErrors,
      failedRequests,
    }
  } catch (err) {
    const message = timedOut
      ? `Spot timed out after ${SPOT_TIMEOUT_MS / 1000}s`
      : err instanceof Error
        ? err.message
        : String(err)
    return {
      label: spot.label,
      error: message,
      consoleErrors,
      pageErrors,
      failedRequests,
    }
  } finally {
    clearTimeout(timer)
    await context?.close().catch(() => {})
  }
}

function buildMarkdown(report, profileNames, spots, comparePath, oldReport) {
  const buildText =
    report.build == null
      ? 'null'
      : typeof report.build === 'string'
        ? report.build
        : JSON.stringify(report.build)
  const lines = [
    '# City Performance Baseline',
    '',
    `- Timestamp: \`${report.timestamp}\``,
    `- Browser: \`${report.browser}\``,
    `- Renderer: \`${report.renderer}\``,
    `- Build: \`${buildText}\``,
    `- Settle: \`${report.settleMs}ms\` | Sample: \`${report.sampleMs}ms\`${report.runs > 1 ? ` | Runs: \`${report.runs}\`（表内为各轮中位数）` : ''}${report.hot ? ' | 带剖析采样，FPS 偏低，不用于前后对比' : ''}`,
    ...(report.worldOverlay ? [`- Road cells overlay: \`${report.worldOverlay}\``] : []),
    '',
  ]

  for (const profileName of profileNames) {
    const cfg = PROFILES[profileName]
    const profileResults = report.profiles[profileName] ?? {}
    lines.push(
      `## ${profileName} (${cfg.viewport.width}x${cfg.viewport.height}, dpr ${cfg.deviceScaleFactor}, cpu ${cfg.cpuRate}x)`,
      '',
      '| 机位 | FPS | 帧 ms 均值/P95/最大 | 主线程 ms/帧 | 脚本 ms/帧 | draw call | 三角形(万) | 车 | 人 | 分配 MB/s | GC 次数 | traffic step P95 |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    )
    const notes = []
    for (const spot of spots) {
      const m = profileResults[spot.id]
      if (!m || m.error) {
        const msg = escapeCell(m?.error ?? 'missing')
        lines.push(`| ${spot.label} (${spot.id}) | ERROR | ${msg} | - | - | - | - | - | - | - | - | - |`)
        notes.push(`- ${spot.id}: error: ${msg}`)
      } else {
        const frameTriple = `${fmt(m.frameMsMean)} / ${fmt(m.frameMsP95)} / ${fmt(m.frameMsMax)}`
        const trisWan = typeof m.trianglesAvg === 'number' ? fmt(m.trianglesAvg / 10000) : '-'
        lines.push(
          `| ${spot.label} (${spot.id}) | ${fmt(m.fps)} | ${frameTriple} | ${fmt(m.mainThreadMsPerFrame)} | ${fmt(m.scriptMsPerFrame)} | ${fmt(m.drawCallsAvg)} | ${trisWan} | ${fmt(m.motorsAvg)} | ${fmt(m.pedestriansAvg)} | ${fmt(m.allocMBps)} | ${m.gcDrops ?? '-'} | ${fmt(m.trafficStepP95)} |`,
        )
      }
      if (m?.failedRuns?.length) {
        notes.push(`- ${spot.id}: ${m.failedRuns.length}/${m.runs?.length ?? report.runs} 轮失败（中位数只算成功的轮）：${m.failedRuns.map(escapeCell).join('；')}`)
      }
      if (m && !m.error && !m.trafficState?.allMotors && !m.motorsAvg && !m.pedestriansAvg) {
        notes.push(`- ${spot.id}: 交通为空（sim 没有生成任何车辆和行人）。本地路网 cell 缺 \`street\` 字段时会这样，用 PERF_WORLD 指向带线上路网的目录重采。`)
      }
      const signals = m?.trafficState?.signals
      if (signals?.mismatched) {
        notes.push(`- ${spot.id}: 红绿灯不同源：${signals.mismatched}/${signals.checked} 条车道的 sim 读数和真源读数不一致。`)
      }
      if (m?.failedRequests?.length) {
        notes.push(`- ${spot.id}: 失败请求 (${m.failedRequests.length}): ${escapeCell([...new Set(m.failedRequests)].slice(0, 6).join(', '))}`)
      }
      if (m?.pageErrors?.length) {
        notes.push(`- ${spot.id}: pageErrors (${m.pageErrors.length}): ${escapeCell(m.pageErrors[0])}`)
      }
    }
    if (notes.length) lines.push('', ...notes)
    lines.push('')
    for (const spot of spots) {
      const hot = report.profiles[profileName]?.[spot.id]?.hot
      if (!hot) continue
      lines.push(`### ${profileName} / ${spot.id}：主线程自耗时最多的函数`, '')
      if (hot.docQueriesPerFrame != null) lines.push(`整页选择器查询 \`document.querySelector\`：${fmt(hot.docQueriesPerFrame)} 次/帧。占比按主线程忙碌时间算，不含空闲。`, '')
      lines.push('| 函数 文件:行:列 | ms | 占比 % |', '| --- | ---: | ---: |')
      for (const row of hot.cpu) lines.push(`| ${escapeCell(row.where)} | ${fmt(row.ms)} | ${fmt(row.pct, 1)} |`)
      lines.push('', `### ${profileName} / ${spot.id}：分配最多的函数`, '', '| 函数 文件:行:列 | MB | 占比 % |', '| --- | ---: | ---: |')
      for (const row of hot.alloc) lines.push(`| ${escapeCell(row.where)} | ${fmt(row.mb)} | ${fmt(row.pct, 1)} |`)
      lines.push('')
    }
  }

  if (oldReport) {
    lines.push(`## Compare vs \`${comparePath}\``, '')
    for (const profileName of profileNames) {
      const curSpots = report.profiles[profileName] ?? {}
      const oldSpots = oldReport.profiles?.[profileName] ?? {}
      lines.push(
        `### ${profileName}`,
        '',
        '| 机位 | FPS | 主线程 ms/帧 | draw call | 分配 MB/s |',
        '| --- | ---: | ---: | ---: | ---: |',
      )
      for (const spot of spots) {
        const prev = oldSpots[spot.id]
        const next = curSpots[spot.id]
        lines.push(
          `| ${spot.label} (${spot.id}) | ${fmtCompare(prev?.fps, next?.fps)} | ${fmtCompare(prev?.mainThreadMsPerFrame, next?.mainThreadMsPerFrame)} | ${fmtCompare(prev?.drawCallsAvg, next?.drawCallsAvg)} | ${fmtCompare(prev?.allocMBps, next?.allocMBps)} |`,
        )
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

const args = parseArgs(process.argv.slice(2))
const profileNames = args.profile
  ? args.profile.split(',').map(s => s.trim()).filter(Boolean)
  : Object.keys(PROFILES)
if (!profileNames.length) throw new Error('--profile requires desktop or mobile')
for (const name of profileNames) {
  if (!PROFILES[name]) {
    throw new Error(`Unknown profile "${name}" (expected: ${Object.keys(PROFILES).join(', ')})`)
  }
}

const spotFilter = process.env.PERF_SPOTS
  ? new Set(process.env.PERF_SPOTS.split(',').map(s => s.trim()).filter(Boolean))
  : null
const spots = spotFilter?.size ? SPOTS.filter(s => spotFilter.has(s.id)) : SPOTS
if (!spots.length) throw new Error(`No matching spots for PERF_SPOTS="${process.env.PERF_SPOTS}"`)

const SETTLE_MS = envNumber('PERF_SETTLE', 15000)
const SAMPLE_MS = envNumber('PERF_MS', 10000)
const RUNS = args.runs ?? envNumber('PERF_RUNS', 1)
if (!(Number.isInteger(RUNS) && RUNS >= 1)) throw new Error(`Invalid PERF_RUNS: ${process.env.PERF_RUNS} (positive integer)`)
const HOT = args.hot
// A hot-spot table and its .cpuprofile describe one sampling window; medians across runs do not apply to them.
if (HOT && RUNS > 1) throw new Error('--hot profiles a single run; drop --runs / PERF_RUNS')
const OUT = process.env.PERF_OUT ?? 'captures/perf-city'
const oldReport = args.compare ? JSON.parse(await readFile(args.compare, 'utf8')) : null

// Always headless; use Metal on macOS unless SwiftShader is forced.
const useMetal = process.platform === 'darwin' && process.env.PERF_SWIFTSHADER !== '1'
const launchOptions = {
  headless: true,
  executablePath: process.env.CHROMIUM || undefined,
  args: [
    ...(useMetal
      ? ['--enable-gpu', '--use-angle=metal']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    '--enable-precise-memory-info',
  ],
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

  await mkdir(OUT, {recursive: true})
  const report = {
    timestamp: new Date().toISOString(),
    build,
    browser: browser.version(),
    renderer,
    worldOverlay: WORLD_OVERLAY,
    settleMs: SETTLE_MS,
    sampleMs: SAMPLE_MS,
    runs: RUNS,
    hot: HOT,
    profiles: {},
  }
  const saveJson = () => writeFile(join(OUT, 'perf-city.json'), JSON.stringify(report, null, 2) + '\n')

  let hasFailure = false
  for (const profileName of profileNames) {
    const profile = PROFILES[profileName]
    report.profiles[profileName] = {}
    const perSpot = new Map(spots.map(spot => [spot.id, []]))
    // Runs go round the spots in turn, so machine-load drift spreads across spots instead of hitting one.
    for (let run = 1; run <= RUNS; run++) {
      for (const spot of spots) {
        const tag = `${profileName}/${spot.id}${RUNS > 1 ? ` run ${run}/${RUNS}` : ''}`
        console.error(`[perf-city] ${tag} (${spot.label}) ...`)
        const result = await measureSpot(browser, baseUrl, profileName, profile, spot, SETTLE_MS, SAMPLE_MS, OUT)
        perSpot.get(spot.id).push(result)
        report.profiles[profileName][spot.id] = mergeRuns(perSpot.get(spot.id))
        if (result.error || result.pageErrors?.length) {
          hasFailure = true
          console.error(`[perf-city] ${tag} FAILED: ${result.error ?? result.pageErrors.join('; ')}`)
        } else {
          console.error(
            `[perf-city] ${tag} done: ${fmt(result.fps)} fps, main ${fmt(result.mainThreadMsPerFrame)} ms, calls ${fmt(result.drawCallsAvg)}`,
          )
        }
        await saveJson()
      }
    }
  }

  const md = buildMarkdown(report, profileNames, spots, args.compare, oldReport)
  await saveJson()
  await writeFile(join(OUT, 'perf-city.md'), md)
  process.stdout.write(md)

  if (hasFailure) process.exitCode = 1
} finally {
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
}
