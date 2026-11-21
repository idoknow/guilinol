import {glHookScript} from './gl-perf.mjs'
import {mkdir, writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const CAMERAS = [
  {id: 'overview', label: 'overview', query: 'verify&cam=overview&flow=0', mode: 'fly'},
  {id: 'lijiang', label: 'lijiang', query: 'verify&cam=lijiang&flow=0', mode: 'fly'},
  {id: 'palace', label: 'palace', query: 'verify&cam=palace&flow=0', mode: 'fly'},
  {id: 'south', label: 'south', query: 'verify&cam=south&flow=0', mode: 'fly'},
  {id: 'walk-palace', label: '步行王城', query: 'verify&mode=walk&flow=0', mode: 'walk'},
]

const SAMPLE_FRAMES = Number(process.env.PERF_FRAMES ?? 60)
const FIRST_RUNS = Number(process.env.PERF_FIRST_RUNS ?? 5)
const OUT_FILE = process.env.PERF_OUT ?? 'captures/perf.json'

const mobile = process.env.PERF_MOBILE === '1'
const viewport = mobile ? {width: 390, height: 844} : {width: 960, height: 540}
const device = {viewport, isMobile: mobile, hasTouch: mobile}

function round(n, digits = 2) {
  return +n.toFixed(digits)
}

const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
let browser

try {
  // 1. Measure 5 consecutive cold-process first frames (matches verify:flight cold launch).
  const firstFrameRuns = []
  for (let i = 0; i < FIRST_RUNS; i++) {
    const coldBrowser = await chromium.launch({
      executablePath: process.env.CHROMIUM,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    })
    try {
      const page = await coldBrowser.newPage(device)
      await page.goto(`${baseUrl}/?verify&flow=0`)
      await page.waitForFunction(() => window.viewer?.stats.firstMs > 0, null, {timeout: 30000})
      const firstMs = await page.evaluate(() => +window.viewer.stats.firstMs.toFixed(1))
      firstFrameRuns.push(firstMs)
    } finally {
      await coldBrowser.close()
    }
  }

  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })

  // 2. Measure the 5 fixed viewpoints.
  const context = await browser.newContext(device)
  await context.addInitScript(glHookScript)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', err => {
    errors.push(err.message)
    console.error('PAGEERROR:', err.message)
  })

  const viewpoints = {}
  for (const cam of CAMERAS) {
    if(process.env.PERF_CAMERA && process.env.PERF_CAMERA!==cam.id)continue
    await page.goto(`${baseUrl}/?${cam.query}`)
    await page.waitForFunction(mode => {
      const viewer = window.viewer
      if (!viewer?.stats.firstMs || viewer.stats.pending) return false
      if (mode === 'walk' && !viewer.walk?.active) return false
      const pos = mode === 'walk' ? viewer.walk.position : viewer.camera.position
      const forest = viewer.stream.forest
      if (forest.pending && forest.pending.size > 0) return false
      return viewer.manifest.chunks.every(tile => {
        const dist = Math.hypot(tile.x + 128 - pos.x, tile.z + 128 - pos.z)
        return (dist > viewer.stream.radius || viewer.stream.loaded.has(tile)) &&
          (dist > 1682 || forest.loaded.has(tile))
      })
    }, cam.mode, {timeout: 120000})

    const metrics = await page.evaluate(async sampleCount => {
      function nextRaf() {
        return new Promise(resolve => requestAnimationFrame(resolve))
      }
      // Warmup frames so mirror target, LODs, and shader programs settle.
      for (let i = 0; i < 6; i++) await nextRaf()

      const frameTimes = []
      let lastDraw = null
      for (let i = 0; i < sampleCount; i++) {
        const t0 = performance.now()
        window.__glPerf.resetFrame()
        await nextRaf()
        const dt = performance.now() - t0
        lastDraw = window.__glPerf.readFrame()
        frameTimes.push(dt)
      }
      const sorted = [...frameTimes].sort((a, b) => a - b)
      const mean = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
      const median = sorted[Math.floor(sorted.length * 0.5)]
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
      const mem = window.__glPerf.memory()
      const peakDraws = window.viewer.peaksStats?.calls ?? null
      return {
        meanMs: +mean.toFixed(2),
        medianMs: +median.toFixed(2),
        p95Ms: +p95.toFixed(2),
        calls: lastDraw.calls,
        mirrorCalls: lastDraw.mirrorCalls,
        totalCalls: lastDraw.totalCalls,
        peakCalls: peakDraws,
        triangles: lastDraw.triangles,
        totalTriangles: lastDraw.totalTriangles,
        loadedChunks: window.viewer.stats.loaded,
        vramMB: mem.vramMB,
        bufferMB: mem.bufferMB,
        textureMB: mem.textureMB,
      }
    }, SAMPLE_FRAMES)

    viewpoints[cam.id] = {label: cam.label, ...metrics}
    console.log(
      `${cam.id.padEnd(12)} | ${String(metrics.meanMs).padStart(6)} ms (p95 ${String(metrics.p95Ms).padStart(6)} ms) | ` +
      `calls ${String(metrics.calls).padStart(3)} (total ${String(metrics.totalCalls).padStart(3)}) | ` +
      `tris ${String(metrics.triangles).padStart(7)} | VRAM ${String(metrics.vramMB).padStart(6)} MB`
    )
  }

  await context.close()

  const sortedFirst = [...firstFrameRuns].sort((a, b) => a - b)
  const summary = {
    timestamp: new Date().toISOString(),
    viewport: {...viewport, renderer: 'SwiftShader'},
    sampleFrames: SAMPLE_FRAMES,
    firstFrame: {
      runsMs: firstFrameRuns,
      meanMs: round(firstFrameRuns.reduce((a, b) => a + b, 0) / firstFrameRuns.length, 1),
      maxMs: sortedFirst[sortedFirst.length - 1],
      minMs: sortedFirst[0],
    },
    viewpoints,
    errors,
  }

  const outDir = OUT_FILE.includes('/') ? OUT_FILE.slice(0, OUT_FILE.lastIndexOf('/')) : '.'
  await mkdir(outDir, {recursive: true})
  await writeFile(OUT_FILE, JSON.stringify(summary, null, 2) + '\n')
  console.log('First-frame 5x (ms):', firstFrameRuns.join(', '), `(max ${summary.firstFrame.maxMs} ms)`)
  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`)
} finally {
  await browser?.close()
  await server.close()
}
