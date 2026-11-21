import {telemetryPreview} from './telemetry-preview.mjs'
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

const expansion = process.argv.includes('--expansion')
if (expansion) {
  for (const id of ['balijie','zengpiyan','guilinta','eastBoundary']) {
    CAMERAS.push({id, label:id, query:`verify&cam=${id}&flow=0`, mode:'fly'})
    CAMERAS.push({id:'walk-'+id, label:id, query:`verify&spawn=${id}&flow=0`, mode:'walk'})
  }
}

const SAMPLE_FRAMES = Number(process.env.PERF_FRAMES ?? 60)
const FIRST_RUNS = Number(process.env.PERF_FIRST_RUNS ?? 5)
const OUT_FILE = process.env.PERF_OUT ?? 'captures/perf.json'

const cpuRate = Number(process.env.PERF_CPU_RATE ?? 1)
async function throttle(page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', {rate:cpuRate})
}

function round(n, digits = 2) {
  return +n.toFixed(digits)
}

const server = await preview({plugins:[telemetryPreview],root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
let browser

try {
  // 1. Measure 5 consecutive cold-process first frames (matches verify:flight cold launch).
  const firstFrameRuns = []
  const firstWorldBytes = []
  for (let i = 0; i < FIRST_RUNS; i++) {
    const coldBrowser = await chromium.launch({
      executablePath: process.env.CHROMIUM,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader','--enable-precise-memory-info'],
    })
    try {
      const page = await coldBrowser.newPage({viewport: {width: 960, height: 540}})
      await throttle(page)
      await page.goto(`${baseUrl}/?verify&slot=N&flow=0`)
      await page.waitForFunction(() => window.viewer?.stats.firstMs > 0, null, {timeout: 30000})
      const firstMs = await page.evaluate(() => +window.viewer.stats.firstMs.toFixed(1))
      firstFrameRuns.push(firstMs)
      firstWorldBytes.push(await page.evaluate(() => window.viewer.stats.firstWorldBytes))
    } finally {
      await coldBrowser.close()
    }
  }

  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader','--enable-precise-memory-info'],
  })

  // 2. Measure the 5 fixed viewpoints.
  const context = await browser.newContext({viewport: {width: 960, height: 540}})
  await context.addInitScript(glHookScript)
  const page = await context.newPage()
  await throttle(page)
  const errors = []
  page.on('pageerror', err => {
    errors.push(err.message)
    console.error('PAGEERROR:', err.message)
  })

  const viewpoints = {}
  const outDir = OUT_FILE.includes('/') ? OUT_FILE.slice(0, OUT_FILE.lastIndexOf('/')) : '.'
  await mkdir(outDir, {recursive: true})
  async function saveReport() {
    const count = firstFrameRuns.length
    const summary = {
      timestamp: new Date().toISOString(),
      viewport: {width: 960, height: 540, renderer: 'SwiftShader'},
      cpuRate, sampleFrames: SAMPLE_FRAMES,
      firstFrame: {
        runsMs: firstFrameRuns, worldBytes: firstWorldBytes,
        meanMs: count ? round(firstFrameRuns.reduce((a,b)=>a+b,0)/count,1) : null,
        maxMs: count ? Math.max(...firstFrameRuns) : null,
        minMs: count ? Math.min(...firstFrameRuns) : null,
      },
      viewpoints, errors,
    }
    await writeFile(OUT_FILE, JSON.stringify(summary, null, 2) + '\n')
  }
  await saveReport()
  for (const cam of CAMERAS) {
    if(process.env.PERF_CAMERA && process.env.PERF_CAMERA!==cam.id)continue
    const started = performance.now()
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
          (dist > (viewer.stream.metrics?.treeLoadRadius ?? 1682) || forest.loaded.has(tile))
      })
    }, cam.mode, {timeout: 120000})

    const loadMs = Math.round(performance.now()-started)
    const metrics = await page.evaluate(async sampleCount => {
      function nextRaf() {
        return new Promise(resolve => requestAnimationFrame(resolve))
      }
      // Warmup frames so mirror target, LODs, and shader programs settle.
      for (let i = 0; i < 6; i++) await nextRaf()

      const frameTimes = []
      let heapPeakBytes = 0
      let lastDraw = null
      for (let i = 0; i < sampleCount; i++) {
        const t0 = performance.now()
        window.__glPerf.resetFrame()
        await nextRaf()
        const dt = performance.now() - t0
        lastDraw = window.__glPerf.readFrame()
        frameTimes.push(dt)
        heapPeakBytes = Math.max(heapPeakBytes, performance.memory?.usedJSHeapSize ?? 0)
      }
      const sorted = [...frameTimes].sort((a, b) => a - b)
      const mean = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
      const median = sorted[Math.floor(sorted.length * 0.5)]
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
      const mem = window.__glPerf.memory()
      const peakDraws = window.viewer.peaksStats?.calls ?? null
      return {
        heapPeakBytes,
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

    if (expansion) {
      const dir = 'captures/expansion'
      await mkdir(dir, {recursive:true})
      if (cam.mode==='walk' && cam.id!=='walk-palace') {
        const last = await page.evaluate(()=>window.viewer.walk.spawns.at(-1))
        if (!last?.to || last.reason==='fallback') throw Error('Unexpected fallback spawn: '+cam.id)
      }
      if (cam.mode==='fly') {
        const matrix = await page.evaluate(()=>{
          const camera = window.viewer.camera
          return camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).toArray()
        })
        await writeFile(`${dir}/${cam.id}.matrix.json`,JSON.stringify(matrix))
      }
      await page.screenshot({path:`${dir}/${cam.id}.png`})
    }
    viewpoints[cam.id] = {label: cam.label, loadMs, ...metrics}
    await saveReport()
    console.log(
      `${cam.id.padEnd(12)} | ${String(metrics.meanMs).padStart(6)} ms (p95 ${String(metrics.p95Ms).padStart(6)} ms) | ` +
      `calls ${String(metrics.calls).padStart(3)} (total ${String(metrics.totalCalls).padStart(3)}) | ` +
      `tris ${String(metrics.triangles).padStart(7)} | VRAM ${String(metrics.vramMB).padStart(6)} MB`
    )
  }

  await context.close()

  console.log('First frames (ms):', firstFrameRuns.join(', '))
  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`)
} finally {
  await browser?.close()
  await server.close()
}
