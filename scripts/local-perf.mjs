// 本地性能采样（本地工具，不参与构建）：用系统 Edge/Chrome 跑生产包。
// 用法：CHROMIUM="...msedge.exe" node scripts/local-perf.mjs [baseUrl]
// 环境变量：VW/VH/DPR 视口；FRAMES 采样帧数；STRESS 长跑帧数（0 关闭）；CASES 逗号切分；SOFTWARE=1 强制软件渲染
import {chromium} from 'playwright'

const base = process.argv[2] ?? process.env.BASE_URL ?? 'http://127.0.0.1:8788'
const exe = process.env.CHROMIUM
const headless = process.env.HEADFUL !== '1'
const frames = Number(process.env.FRAMES ?? 90)
const stressFrames = Number(process.env.STRESS ?? 300)
const vw = Number(process.env.VW ?? 1707)
const vh = Number(process.env.VH ?? 1067)
const dpr = Number(process.env.DPR ?? 1.5)

const CASES = [
  {id: 'lijiang', label: '漓江机位', query: '?verify&cam=lijiang&flow=0', mode: 'fly'},
  {id: 'palace', label: '王城机位', query: '?verify&cam=palace&flow=0', mode: 'fly'},
  {id: 'walk', label: '步行王城', query: '?verify&mode=walk&flow=0', mode: 'walk'},
]

const only = process.env.CASES ? process.env.CASES.split(',') : null
const args = process.env.SOFTWARE === '1'
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
const browser = await chromium.launch({executablePath: exe, headless, args})

const info = await (async () => {
  const p = await browser.newPage()
  await p.goto('about:blank')
  const out = await p.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return {renderer: 'no-webgl2'}
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    return {renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)}
  })
  await p.close()
  return out
})()

const context = await browser.newContext({viewport: {width: vw, height: vh}, deviceScaleFactor: dpr})
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.stack ?? e.message))

const summary = {base, viewport: {vw, vh, dpr}, gpu: info.renderer, cases: {}}
console.log(`GPU ${info.renderer}`)

function stats(dts) {
  if (!dts.length) return {meanMs: 0, medianMs: 0, p95Ms: 0, maxMs: 0, fps: 0, hitches: 0, severe: 0, frames: 0}
  const sorted = [...dts].sort((a, b) => a - b)
  const mean = dts.reduce((a, b) => a + b, 0) / dts.length
  return {
    meanMs: +mean.toFixed(2),
    medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(2),
    p95Ms: +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(2),
    maxMs: +sorted[sorted.length - 1].toFixed(2),
    fps: +(1000 / mean).toFixed(1),
    hitches: dts.filter(d => d > 33.4).length,
    severe: dts.filter(d => d > 66.7).length,
    frames: dts.length,
  }
}

const pageUrl = query => base.includes('?') ? `${base}&${query.replace(/^\?/, '')}` : `${base}/${query}`

for (const c of CASES) {
  if (only && !only.includes(c.id)) continue
  const t0 = Date.now()
  await page.goto(pageUrl(c.query), {waitUntil: 'load'})
  await page.waitForFunction(() => window.viewer?.stats.firstMs > 0, null, {timeout: 180000})
  await page.waitForFunction(mode => {
    const v = window.viewer
    if (!v || v.stats.pending) return false
    if (mode === 'walk' && !v.walk?.active) return false
    const pos = mode === 'walk' ? v.walk.position : v.camera.position
    return v.manifest.chunks.every(tile => {
      const d = Math.hypot(tile.x + 128 - pos.x, tile.z + 128 - pos.z)
      return d > v.stream.radius || v.stream.loaded.has(tile)
    })
  }, c.mode, {timeout: 300000})
  const readyMs = Date.now() - t0

  const idle = await page.evaluate(async n => {
    const raf = () => new Promise(r => requestAnimationFrame(r))
    for (let i = 0; i < 15; i++) await raf()
    const dts = []
    let calls = 0
    for (let i = 0; i < n; i++) {
      const s = performance.now()
      await raf()
      dts.push(performance.now() - s)
      calls += window.viewer.stats.calls
    }
    const canvas = document.querySelector('canvas')
    return {
      dts, calls: calls / n, geo: window.viewer.stats.geometries, tex: window.viewer.stats.textures,
      loaded: window.viewer.stats.loaded, buffer: [canvas.width, canvas.height],
      pixelRatio: +(canvas.width / innerWidth).toFixed(3),
      quality: window.viewer.quality ? {tier: window.viewer.quality.tier, setting: window.viewer.quality.setting,
        scale: +window.viewer.quality.scale.toFixed(2), radius: window.viewer.quality.radius} : null,
    }
  }, frames)
  const idleStats = stats(idle.dts)

  let stress = null
  if (c.mode === 'walk' && stressFrames > 0) {
    const raw = await page.evaluate(async n => {
      const raf = () => new Promise(r => requestAnimationFrame(r))
      const w = window.viewer.walk
      const start = w.position.clone()
      const dts = []
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 4
        w.drive(Math.cos(angle) * 60 + start.x, Math.sin(angle) * 60 + start.z, true)
        const s = performance.now()
        await raf()
        dts.push(performance.now() - s)
      }
      w.hold(true)
      return {dts, travelled: Math.hypot(w.position.x - start.x, w.position.z - start.z),
        loaded: window.viewer.stats.loaded, calls: window.viewer.stats.calls}
    }, stressFrames)
    stress = {travelled: +raw.travelled.toFixed(1), loaded: raw.loaded, calls: raw.calls, ...stats(raw.dts)}
  }

  summary.cases[c.id] = {label: c.label, readyMs, idle: idleStats, buffer: idle.buffer, pixelRatio: idle.pixelRatio,
    quality: idle.quality, calls: Math.round(idle.calls), geo: idle.geo, tex: idle.tex, loaded: idle.loaded, stress}
  console.log(
    `${c.id.padEnd(8)} ${String(idleStats.fps).padStart(6)} fps | 中位 ${String(idleStats.medianMs).padStart(6)} ms | p95 ${String(idleStats.p95Ms).padStart(7)} ms | ` +
    `calls ${String(Math.round(idle.calls)).padStart(3)} | buffer ${idle.buffer.join('x')} | 画质 ${idle.quality ? `${idle.quality.setting}/${idle.quality.tier} ×${idle.quality.scale}` : '-'} | ready ${readyMs}ms`,
  )
  if (stress) console.log(`${''.padEnd(8)} 长跑 ${String(stress.fps).padStart(6)} fps | p95 ${String(stress.p95Ms).padStart(7)} ms | 卡顿 ${stress.hitches}/${stress.frames} | 走了 ${stress.travelled} m`)
}

if (errors.length) console.log('PAGEERRORS', errors.slice(0, 3).join('\n'))
console.log('PERF_JSON ' + JSON.stringify(summary))
await browser.close()
