import {mkdir, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {glHookScript} from './gl-perf.mjs'

const OUT_DIR = resolve(process.argv[2] ?? 'captures/idok-295-check')
const DIST_DIR = resolve(process.env.PERF_DIST ?? 'dist')
const SKIP_SHOTS = process.env.SKIP_SHOTS === '1'

const native = process.platform === 'darwin' && process.env.QA_NATIVE_GPU !== '0'
const launch = {
  headless: true,
  executablePath: process.env.CHROMIUM,
  args: native
    ? ['--enable-gpu', '--use-angle=metal', '--enable-precise-memory-info']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'],
}

// Track compressed texture internalFormats & exact shader source strings
function extraHookScript() {
  const formats = new Map()
  const shaderSources = new Map()
  const programShaders = new Map()
  let compileCount = 0
  let linkCount = 0
  const origPatch = Proto => {
    if (!Proto || Proto.__idok295Patched) return
    Proto.__idok295Patched = true
    const origComp = Proto.compressedTexImage2D
    Proto.compressedTexImage2D = function (target, level, internalformat, width, height, border, data) {
      if (level === 0) {
        const key = 'comp:0x' + internalformat.toString(16)
        const cur = formats.get(key) ?? {count: 0, bytes: 0}
        cur.count++
        cur.bytes += data?.byteLength ?? 0
        formats.set(key, cur)
      }
      return origComp.apply(this, arguments)
    }
    if (Proto.compressedTexSubImage2D) {
      const origCompSub = Proto.compressedTexSubImage2D
      Proto.compressedTexSubImage2D = function (target, level, x, y, width, height, format, data) {
        if (level === 0) {
          const key = 'compSub:0x' + format.toString(16)
          const cur = formats.get(key) ?? {count: 0, bytes: 0}
          cur.count++
          cur.bytes += data?.byteLength ?? 0
          formats.set(key, cur)
        }
        return origCompSub.apply(this, arguments)
      }
    }
    const origShaderSrc = Proto.shaderSource
    Proto.shaderSource = function (shader, src) {
      shaderSources.set(shader, src)
      return origShaderSrc.call(this, shader, src)
    }
    const origCompile = Proto.compileShader
    Proto.compileShader = function (shader) {
      compileCount++
      return origCompile.call(this, shader)
    }
    const origAttach = Proto.attachShader
    Proto.attachShader = function (program, shader) {
      let arr = programShaders.get(program)
      if (!arr) { arr = []; programShaders.set(program, arr) }
      arr.push(shader)
      return origAttach.call(this, program, shader)
    }
    const origLink = Proto.linkProgram
    Proto.linkProgram = function (program) {
      linkCount++
      return origLink.call(this, program)
    }
  }
  if (typeof WebGL2RenderingContext !== 'undefined') origPatch(WebGL2RenderingContext.prototype)
  if (typeof WebGLRenderingContext !== 'undefined') origPatch(WebGLRenderingContext.prototype)

  const longTasks = []
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      const obs = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          longTasks.push({start: +entry.startTime.toFixed(1), duration: +entry.duration.toFixed(1)})
        }
      })
      obs.observe({entryTypes: ['longtask']})
    } catch {}
  }

  window.__idok295 = {
    formats: () => Object.fromEntries(formats),
    shaderStats: () => {
      let totalFrag = 0, streetWireDiscard = 0, wireFenceShaders = 0, landmarkFadeDiscard = 0
      for (const src of shaderSources.values()) {
        if (!src.includes('gl_FragColor') && !src.includes('pc_fragColor')) continue
        totalFrag++
        const hasWireDiscard = src.includes('min(wire.x,wire.y)') && src.includes('discard')
        if (src.includes('tile_road') && hasWireDiscard) streetWireDiscard++
        if (!src.includes('tile_road') && hasWireDiscard) wireFenceShaders++
        if (src.includes('uLandmarkCoverage') && /\bdiscard\s*;/.test(src)) landmarkFadeDiscard++
      }
      return {compileCount, linkCount, totalFrag, streetWireDiscard, wireFenceShaders, landmarkFadeDiscard}
    },
    resetLongTasks: () => { longTasks.length = 0 },
    readLongTasks: () => [...longTasks],
  }
}

const SHOT_CAMERAS = [
  {id: 'nikoniko', eye: [-880, 174, -102], target: [-955, 175, -121]},
  {id: 'ronghu', eye: [-1390, 164, 155], target: [-1445, 155, 118]},
  {id: 'gunanmen', eye: [-1411, 156, 142], target: [-1411, 154, 120]},
  {id: 'shizijie', eye: [-890, 156, -146], target: [-876, 153, -171]},
  {id: 'guilin_middle', eye: [-1228, 168, -225], target: [-1238, 160, -255]},
  {id: 'wangcheng_market', eye: [-598, 163, -108], target: [-600, 161, -135]},
]

async function waitWorldSettled(page, checkLandmarks = true) {
  await page.waitForFunction(checkLm => {
    const v = window.viewer
    if (!v?.stats?.firstMs || v.stats.pending) return false
    const p = v.walk?.active ? v.walk.position : v.camera.position
    const m = v.rangeMetrics ?? v.stream.metrics
    const rad = m?.landmarkLoadRadius ?? 900
    const chunksOk = v.manifest.chunks.every(t => Math.hypot(t.x + 128 - p.x, t.z + 128 - p.z) > v.stream.radius || v.stream.loaded.has(t))
    if (!chunksOk) return false
    if (!checkLm) return true
    if ((v.stream.updateLandmarks?.pendingCount?.() ?? 0) > 0) return false
    return (v.manifest.landmarks ?? []).every(e => {
      const d = Math.hypot(p.x - e.position[0], p.y - e.position[1], p.z - e.position[2]) - e.sphere[3]
      return d > rad || v.stream.landmarks.has(e)
    })
  }, checkLandmarks, {timeout: 120000})
}

async function measureSanduoAndSpin(browser, baseUrl) {
  const ctx = await browser.newContext({viewport: {width: 1512, height: 945}, deviceScaleFactor: 1.5})
  await ctx.addInitScript(glHookScript)
  await ctx.addInitScript(extraHookScript)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))

  // Land near Tianyuan Mifen on Sanduo Rd at 20:00
  const view = {mode: 'fly', x: -1134, y: 158.2, z: -43, yaw: 0.4, pitch: -0.05, fov: 55}
  const token = Buffer.from(JSON.stringify(view)).toString('base64url')
  await page.goto(`${baseUrl}/?verify&flow=0&time=20&traffic=0&view=${token}`)
  await page.waitForFunction(() => window.viewer?.stats?.firstMs > 0, null, {timeout: 60000})
  await page.evaluate(async () => {
    const v = window.viewer
    v.camera.position.set(-1134, 158.2, -43)
    v.camera.lookAt(-1139.2, 157.5, -55.5)
    v.camera.updateMatrixWorld()
  })

  // Wait until chunks & landmarks settle at Sanduo facing Mifen shop
  await waitWorldSettled(page, true)
  await page.evaluate(async () => {
    for (let i = 0; i < 15; i++) await new Promise(requestAnimationFrame)
  })

  const sanduoAudit = await page.evaluate(() => {
    const v = window.viewer
    const mem = window.__glPerf.memory()
    const formats = window.__idok295.formats()
    const shaders = window.__idok295.shaderStats()
    const rendererInfo = {
      programs: v.renderer?.info?.programs?.length ?? null,
      geometries: v.stats.geometries,
      textures: v.stats.textures,
      calls: v.stats.calls,
    }
    // Walk scene textures categorized by landmark vs mifen vs other
    const seenSources = new Set()
    const byCategory = {landmarks: {count: 0, rgbaBytes: 0}, mifen: {count: 0, rgbaBytes: 0}, other: {count: 0, rgbaBytes: 0}}
    const perLandmark = []
    const lmRoots = new Map()
    for (const [entry, root] of v.stream.landmarks) lmRoots.set(root, entry.id)

    function texSize(tex) {
      const img = tex?.image
      if (!img) return 0
      const w = img.width || img.naturalWidth || 0
      const h = img.height || img.naturalHeight || 0
      return w * h * 4
    }

    let lmCoverageOneWithDiscard = 0
    let lmCoverageOneWithoutDiscard = 0
    for (const [entry, root] of v.stream.landmarks) {
      const localSeen = new Set()
      let localRgba = 0
      let uniqueGlobalAdded = 0
      root.traverse(obj => {
        if (!obj.isMesh) return
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
        for (const mat of mats) {
          if (!mat) continue
          const key = mat.customProgramCacheKey?.() ?? ''
          if (root.visible && obj.visible) {
            if (key.includes('stream-fade')) lmCoverageOneWithDiscard++
            else lmCoverageOneWithoutDiscard++
          }
          for (const val of Object.values(mat)) {
            if (!val?.isTexture) continue
            const srcKey = val.source?.uuid ?? val.uuid
            if (!localSeen.has(srcKey)) {
              localSeen.add(srcKey)
              localRgba += texSize(val)
            }
            if (!seenSources.has(srcKey)) {
              seenSources.add(srcKey)
              const sz = texSize(val)
              byCategory.landmarks.count++
              byCategory.landmarks.rgbaBytes += sz
              uniqueGlobalAdded += sz
            }
          }
        }
      })
      perLandmark.push({
        id: entry.id,
        textures: localSeen.size,
        rgbaMB: +(localRgba / 1048576).toFixed(2),
        uniqueAddedMB: +(uniqueGlobalAdded / 1048576).toFixed(2),
      })
    }
    perLandmark.sort((a, b) => b.rgbaMB - a.rgbaMB)

    const scene = v.stream.overviewMesh()?.parent
    scene?.traverse(obj => {
      if (!obj.isMesh) return
      let cur = obj
      let isLm = false, isMifen = false
      while (cur) {
        if (lmRoots.has(cur)) { isLm = true; break }
        if (cur.name?.includes('tianyuan') || cur.name?.includes('mifen')) { isMifen = true; break }
        cur = cur.parent
      }
      if (isLm) return
      const cat = isMifen ? byCategory.mifen : byCategory.other
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const mat of mats) {
        if (!mat) continue
        for (const val of Object.values(mat)) {
          if (!val?.isTexture) continue
          const srcKey = val.source?.uuid ?? val.uuid
          if (seenSources.has(srcKey)) continue
          seenSources.add(srcKey)
          cat.count++
          cat.rgbaBytes += texSize(val)
        }
      }
    })

    return {
      landmarkLoadRadius: v.rangeMetrics?.landmarkLoadRadius,
      loadedLandmarks: v.stream.landmarks.size,
      glMemory: mem,
      glCompressedFormats: formats,
      shaderStats: shaders,
      lmCoverageOneWithDiscard,
      lmCoverageOneWithoutDiscard,
      rendererInfo,
      byCategoryMB: {
        landmarks: {count: byCategory.landmarks.count, rgbaMB: +(byCategory.landmarks.rgbaBytes / 1048576).toFixed(2)},
        mifen: {count: byCategory.mifen.count, rgbaMB: +(byCategory.mifen.rgbaBytes / 1048576).toFixed(2)},
        other: {count: byCategory.other.count, rgbaMB: +(byCategory.other.rgbaBytes / 1048576).toFixed(2)},
        totalRgbaMB: +((byCategory.landmarks.rgbaBytes + byCategory.mifen.rgbaBytes + byCategory.other.rgbaBytes) / 1048576).toFixed(2),
      },
      topLandmarks: perLandmark.slice(0, 12),
    }
  })

  // Scenario B: 360-degree rotation at Sanduo after initial landing (triggers lazy compile/upload of off-screen landmarks)
  const spinWarm = await page.evaluate(async () => {
    const v = window.viewer
    const before = {
      geometries: v.stats.geometries,
      textures: v.stats.textures,
      landmarks: v.stream.landmarks.size,
      shaders: window.__idok295.shaderStats(),
    }
    window.__idok295.resetLongTasks()
    const frameTimes = []
    const steps = 180
    let prev = await new Promise(requestAnimationFrame)
    for (let i = 1; i <= steps; i++) {
      const yaw = 0.4 + (i / steps) * Math.PI * 2
      v.camera.position.set(-1134, 158.2, -43)
      v.camera.lookAt(-1134 - Math.sin(yaw) * 30, 157.5, -43 - Math.cos(yaw) * 30)
      v.camera.updateMatrixWorld()
      const now = await new Promise(requestAnimationFrame)
      frameTimes.push(now - prev)
      prev = now
    }
    await new Promise(r => setTimeout(r, 100))
    const longTasks = window.__idok295.readLongTasks()
    const sorted = [...frameTimes].sort((a, b) => a - b)
    const after = {
      geometries: v.stats.geometries,
      textures: v.stats.textures,
      landmarks: v.stream.landmarks.size,
      shaders: window.__idok295.shaderStats(),
    }
    return {
      before,
      after,
      maxFrameMs: +Math.max(...frameTimes).toFixed(1),
      p95FrameMs: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
      p50FrameMs: +sorted[Math.floor(sorted.length * 0.5)].toFixed(1),
      maxLongTaskMs: longTasks.length ? Math.max(...longTasks.map(x => x.duration)) : 0,
      longTasksOver50ms: longTasks.filter(x => x.duration > 50).length,
      longTasks,
    }
  })

  // Scenario A: Teleport to Shizijie/Wangcheng (fresh streaming area) and IMMEDIATELY spin 360 degrees while landmarks stream in
  const spinCold = await page.evaluate(async () => {
    const v = window.viewer
    // Jump ~1.5km away first to unload Sanduo landmarks, then jump to Shizijie (-879, -169) and spin while streaming!
    v.camera.position.set(1200, 190, 1200)
    v.camera.lookAt(1200, 160, 1170)
    v.camera.updateMatrixWorld()
    for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame)

    const before = {
      geometries: v.stats.geometries,
      textures: v.stats.textures,
      landmarks: v.stream.landmarks.size,
      shaders: window.__idok295.shaderStats(),
    }
    window.__idok295.resetLongTasks()
    const frameTimes = []
    const steps = 240
    let prev = await new Promise(requestAnimationFrame)
    for (let i = 1; i <= steps; i++) {
      const yaw = (i / steps) * Math.PI * 2
      v.camera.position.set(-885, 164, -155)
      v.camera.lookAt(-885 - Math.sin(yaw) * 40, 158, -155 - Math.cos(yaw) * 40)
      v.camera.updateMatrixWorld()
      const now = await new Promise(requestAnimationFrame)
      frameTimes.push(now - prev)
      prev = now
    }
    await new Promise(r => setTimeout(r, 100))
    const longTasks = window.__idok295.readLongTasks()
    const sorted = [...frameTimes].sort((a, b) => a - b)
    const after = {
      geometries: v.stats.geometries,
      textures: v.stats.textures,
      landmarks: v.stream.landmarks.size,
      shaders: window.__idok295.shaderStats(),
    }
    return {
      before,
      after,
      maxFrameMs: +Math.max(...frameTimes).toFixed(1),
      p95FrameMs: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
      p50FrameMs: +sorted[Math.floor(sorted.length * 0.5)].toFixed(1),
      maxLongTaskMs: longTasks.length ? Math.max(...longTasks.map(x => x.duration)) : 0,
      longTasksOver50ms: longTasks.filter(x => x.duration > 50).length,
      longTasks,
    }
  })

  await ctx.close()
  return {sanduoAudit, spinWarm, spinCold, errors}
}

async function captureShots(browser, baseUrl) {
  const ctx = await browser.newContext({viewport: {width: 1280, height: 720}})
  const page = await ctx.newPage()
  await page.goto(`${baseUrl}/?verify&flow=0&time=10.5`)
  await page.waitForFunction(() => window.viewer?.stats?.firstMs > 0, null, {timeout: 60000})
  for (const shot of SHOT_CAMERAS) {
    await page.evaluate(({eye, target}) => {
      const v = window.viewer
      v.camera.position.set(...eye)
      v.camera.lookAt(...target)
      v.camera.updateMatrixWorld()
    }, shot)
    await waitWorldSettled(page, true)
    await page.evaluate(async () => {
      for (let i = 0; i < 6; i++) await new Promise(requestAnimationFrame)
    })
    await page.screenshot({path: `${OUT_DIR}/${shot.id}.png`})
  }
  await ctx.close()
}

await mkdir(OUT_DIR, {recursive: true})
const server = await preview({
  root: 'web',
  configFile: 'web/vite.config.ts',
  build: {outDir: DIST_DIR},
  preview: {host: '127.0.0.1', port: 0},
})
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
let browser
try {
  browser = await chromium.launch(launch)
  const report = await measureSanduoAndSpin(browser, baseUrl)
  if (!SKIP_SHOTS) await captureShots(browser, baseUrl)
  await writeFile(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2) + '\n')
  console.log('=== SANDUO AUDIT ===')
  console.log(JSON.stringify(report.sanduoAudit, null, 2))
  console.log('=== 360 SPIN (WARM @ SANDUO) ===')
  console.log(JSON.stringify(report.spinWarm, null, 2))
  console.log('=== 360 SPIN (COLD STREAM @ SHIZIJIE) ===')
  console.log(JSON.stringify(report.spinCold, null, 2))
  if (report.errors.length) {
    console.error('PAGE ERRORS:', report.errors)
    process.exitCode = 1
  }
} finally {
  await browser?.close()
  await server.close()
}
