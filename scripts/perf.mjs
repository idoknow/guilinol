import {telemetryPreview} from './telemetry-preview.mjs'
import {glHookScript} from './gl-perf.mjs'
import {mkdir, writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'

const CAMERAS = [
  {id: 'overview', label: 'overview', query: 'verify&cam=overview&flow=0', mode: 'fly'},
  {id: 'lijiang', label: 'lijiang', query: 'verify&cam=lijiang&flow=0', mode: 'fly'},
  {id: 'palace', label: 'palace', query: 'verify&cam=palace&flow=0', mode: 'fly'},
  {id: 'south', label: 'south', query: 'verify&cam=south&flow=0', mode: 'fly'},
  {id: 'walk-palace', label: '步行王城', query: 'verify&mode=walk&flow=0', mode: 'walk'},
  {id: 'street-jiefang', label: '解放桥街头', query: 'verify&solo=1&flow=0&time=17', mode: 'walk'},
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
const trafficQuery = process.argv.includes('--traffic') ? '&traffic=1' : ''
const OUT_FILE = process.env.PERF_OUT ?? 'captures/perf.json'

const native=process.platform==='darwin' && process.env.QA_NATIVE_GPU!=='0'
const mobile=process.env.PERF_MOBILE==='1'
const viewport=mobile?{width:844,height:390}:native?{width:1920,height:1080}:{width:960,height:540}
const launch={headless:!native,executablePath:process.env.CHROMIUM,args:[...(native?['--enable-gpu','--use-angle=metal']:['--use-angle=swiftshader','--enable-unsafe-swiftshader']),'--enable-precise-memory-info']}
const cpuRate = Number(process.env.PERF_CPU_RATE ?? (mobile?4:1))
const sampleMs=Number(process.env.PERF_MS??(native?10000:0))
async function throttle(page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', {rate:cpuRate})
}

function round(n, digits = 2) {
  return +n.toFixed(digits)
}

const server = await preview({plugins:[telemetryPreview],root: 'web', configFile: 'web/vite.config.ts',build:{outDir:resolve(process.env.PERF_DIST??'dist')}, preview: {host: '127.0.0.1', port: 0}})
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
let browser

try {
  // 1. Measure 5 consecutive cold-process first frames (matches verify:flight cold launch).
  const firstFrameRuns = []
  const firstWorldBytes = []
  const firstWorldRequests = []
  for (let i = 0; i < FIRST_RUNS; i++) {
    const coldBrowser = await chromium.launch(launch)
    try {
      const page = await coldBrowser.newPage({viewport: {width: 960, height: 540}})
      await throttle(page)
      await page.goto(`${baseUrl}/?verify&slot=N&flow=0${trafficQuery}`)
      await page.waitForFunction(() => window.viewer?.stats.firstMs > 0, null, {timeout: 30000})
      const firstMs = await page.evaluate(() => +window.viewer.stats.firstMs.toFixed(1))
      firstFrameRuns.push(firstMs)
      const requests=await page.evaluate(()=>{
        const root=new URL('./world/',document.baseURI).href
        return performance.getEntriesByType('resource')
          .filter(entry=>entry.name.startsWith(root)&&entry.startTime<=window.viewer.stats.firstMs)
          .map(entry=>({file:entry.name.slice(root.length),bytes:entry.encodedBodySize}))
      })
      firstWorldRequests.push(requests)
      firstWorldBytes.push(requests.reduce((total,request)=>total+request.bytes,0))
    } finally {
      await coldBrowser.close()
    }
  }

  browser = await chromium.launch(launch)

  // 2. Measure the 5 fixed viewpoints.
  const context = await browser.newContext({viewport,deviceScaleFactor:mobile?3:1,isMobile:mobile,hasTouch:mobile})
  await context.addInitScript(glHookScript)
  const page = await context.newPage()
  await throttle(page)
  const errors = []
  page.on('pageerror', err => {
    errors.push(err.message)
    console.error('PAGEERROR:', err.message)
  })

  const viewpoints = {}
  const build=await (await fetch(`${baseUrl}/version.json`)).json()
  const renderer=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'), ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown'})
  if(native)assert.match(renderer,/Metal/i,'Hardware run requires Metal')
  const outDir = OUT_FILE.includes('/') ? OUT_FILE.slice(0, OUT_FILE.lastIndexOf('/')) : '.'
  await mkdir(outDir, {recursive: true})
  async function saveReport() {
    const count = firstFrameRuns.length
    const summary = {
      timestamp: new Date().toISOString(),
      viewport: {...viewport, renderer, dpr:mobile?3:1}, build, browser:browser.version(), sampleMs,
      cpuRate, sampleFrames: SAMPLE_FRAMES,
      firstFrame: {
        runsMs: firstFrameRuns, worldBytes: firstWorldBytes, requests:firstWorldRequests,
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
    await page.goto(`${baseUrl}/?${cam.query}${trafficQuery}`)
    if(cam.id==='street-jiefang'){
      await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:120000})
      await page.evaluate(async()=>{
        const viewer=window.viewer
        if(!await viewer.walkTo(-265,15,0,'perf-jiefang'))throw Error('Could not place walker at bridge')
        const tick=viewer.walk.tick.bind(viewer.walk)
        const target=viewer.perfTarget=[-145,153,45]
        viewer.walk.tick=elapsed=>{tick(elapsed);viewer.camera.position.set(-265,168,15);viewer.camera.lookAt(...target);viewer.camera.updateMatrixWorld()}
      })
      if(trafficQuery)await page.waitForFunction(()=>window.viewer.trafficProbe?.loads.at(-1)?.key==='-1_0',null,{timeout:180000})
    }
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
    if(process.env.PERF_TRACE)await browser.startTracing(page,{path:`${process.env.PERF_TRACE}-${cam.id}.json`,categories:['devtools.timeline','blink.user_timing','disabled-by-default-v8.cpu_profiler']})
    const metrics = await page.evaluate(async ([sampleCount,minMs]) => {
      function nextRaf() {
        return new Promise(resolve => requestAnimationFrame(resolve))
      }
      // Warmup frames so mirror target, LODs, and shader programs settle.
      for (let i = 0; i < 6; i++) await nextRaf()
      await new Promise(done=>setTimeout(done,5000))

      const frameTimes = []
      let heapPeakBytes = 0
      let lastDraw = null
      let visibleMotors=0,visiblePeople=0,drawCalls=0,triangles=0
      const start=await nextRaf(); let last=start
      for (let i = 0; i < sampleCount || last-start<minMs; i++) {
        window.__glPerf.resetFrame()
        const now=await nextRaf()
        const dt=now-last;last=now
        lastDraw = window.__glPerf.readFrame()
        visibleMotors+=window.viewer.trafficProbe?.motors??0
        visiblePeople+=window.viewer.trafficProbe?.pedestrians??0
        drawCalls+=lastDraw.calls;triangles+=lastDraw.triangles
        frameTimes.push(dt)
        heapPeakBytes = Math.max(heapPeakBytes, performance.memory?.usedJSHeapSize ?? 0)
      }
      const sorted = [...frameTimes].sort((a, b) => a - b)
      const mean = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
      const median = sorted[Math.floor(sorted.length * 0.5)]
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
      const mem = window.__glPerf.memory()
      const peakDraws = window.viewer.peaksStats?.calls ?? null
      const percentile95=values=>{const sorted=[...(values??[])].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length*.95)]??null}
      return {
        fps:+(1000/mean).toFixed(2), frameTimes, motors:window.viewer.trafficProbe?.motors??0,
        fpsP50:1000/median,fpsP95:1000/sorted[Math.floor((sorted.length-1)*.05)],
        averageVisibleMotors:visibleMotors/sorted.length,averageVisiblePeople:visiblePeople/sorted.length,averageCalls:drawCalls/sorted.length,averageTriangles:triangles/sorted.length,
        camera:window.viewer.camera.position.toArray(),
        trafficStepP95:percentile95(window.viewer.trafficProbe?.stepMs),trafficContactP95:percentile95(window.viewer.trafficProbe?.contactMs),
        trafficStepPartsP95:Object.fromEntries(Object.entries(window.viewer.trafficProbe?.stepParts??{}).map(([key,values])=>[key,percentile95(values)])),
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
    }, [SAMPLE_FRAMES,sampleMs])
    if(process.env.PERF_TRACE)await browser.stopTracing()

    if (expansion) {
      const dir = 'captures/expansion'
      await mkdir(dir, {recursive:true})
      if (cam.mode==='walk' && cam.id!=='walk-palace' && cam.id!=='street-jiefang') {
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
    if(cam.id==='street-jiefang'&&process.env.PERF_SHOT){
      await page.screenshot({path:process.env.PERF_SHOT+'-east.png'})
      await page.evaluate(()=>window.viewer.perfTarget.splice(0,3,-385,149,-22))
      await page.waitForFunction(()=>window.viewer.trafficProbe.motors>0&&window.viewer.trafficProbe.pedestrians>0,null,{timeout:90000})
      await page.screenshot({path:process.env.PERF_SHOT+'-city.png'})
    }
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
