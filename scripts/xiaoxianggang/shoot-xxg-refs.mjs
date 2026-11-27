#!/usr/bin/env node
/**
 * 小香港 B1 室内「同角度」验收截图（IDOK-364 Stage 2）。
 *
 * 用 esbuild 把 web/src/xiaoxianggang/runtime 打成单文件，起一个只监听 127.0.0.1 的静态服务，
 * 无头 chromium 里真实挂载 createXxgIndoorScene（含限流人群），按 XXG_REF_SHOTS 的机位逐张渲染，
 * 左边实拍、右边渲染拼成一张对照图，写到 --out（默认 /tmp/xxg-ref-shots）。
 * 不起 vite dev、不弹窗口、不碰 4190。
 *
 *   node scripts/xiaoxianggang/shoot-xxg-refs.mjs [--out DIR] [--only 04,11] [--width 540] [--warmup 40]
 *
 * 地面三张（01–03）需要城市世界，由 verify-xxg-indoor.mjs 的地面截图覆盖，这里只出室内 04–20。
 */
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')
const REFS_DIR = join(REPO_ROOT, 'docs/xiaoxianggang/refs')

const HALF_PI = Math.PI / 2

/**
 * yaw 按宿主约定：相机看向 (-sin yaw, -cos yaw)。+x 方向 yaw = -π/2，-x 方向 yaw = π/2，+z 方向 yaw = π，-z 方向 yaw = 0。
 * 01–03 是地面广场实拍，不在室内场景范围；reverse 表示实拍是从地面入口往下看，室内只能在楼梯底往上拍反向机位。
 */
export const XXG_REF_SHOTS = Object.freeze([
  { id: '04', ref: '04-skylight-pyramid-interior-stairs.jpg', x: -18.5, z: 26.5, yaw: HALF_PI, pitch: 0.42, fov: 74 },
  { id: '05', ref: '05-skylight-landing-stairs-globes.jpg', x: -18.4, z: 24.6, yaw: HALF_PI + 0.5, pitch: 0.6, fov: 74 },
  { id: '06', ref: '06-portal-18-market-sign-steps.jpg', x: -29, z: -26.5, yaw: -HALF_PI, pitch: 0.2, fov: 68, reverse: true },
  { id: '07', ref: '07-portal-17-gold-sign-stairs.jpg', x: -72.4, z: 19.5, yaw: HALF_PI, pitch: 0.2, fov: 68, reverse: true },
  { id: '08', ref: '08-portal-10-glass-gallery-entry.jpg', x: -18, z: 4.5, yaw: Math.PI, pitch: 0.02, fov: 68 },
  { id: '09', ref: '09-portal-escalator-glass-arch-up.jpg', x: -30, z: -26.5, yaw: -HALF_PI, pitch: 0.22, fov: 68 },
  { id: '10', ref: '10-portal-escalator-hall-welcome.jpg', x: -74.6, z: -19.5, yaw: HALF_PI, pitch: 0.42, fov: 70 },
  { id: '11', ref: '11-corridor-main-hallway-wide.jpg', x: -77.2, z: 0.4, yaw: -HALF_PI, pitch: 0.03, fov: 68 },
  { id: '12', ref: '12-corridor-terrazzo-yuyu-jiulin.jpg', x: -67.6, z: -18.6, yaw: -HALF_PI + 0.18, pitch: -0.12, fov: 68 },
  { id: '13', ref: '13-corridor-everyday-shops-1987.jpg', x: -71, z: 20.2, yaw: -HALF_PI + 0.12, pitch: -0.02, fov: 68 },
  { id: '14', ref: '14-atrium-renovated-rest-area.jpg', x: -47.5, z: -1.8, yaw: 2.2, pitch: -0.04, fov: 68 },
  { id: '15', ref: '15-shop-boutique-b181-queenshan.jpg', x: -61.6, z: 20.6, yaw: 0.28, pitch: 0.04, fov: 68 },
  { id: '16', ref: '16-shop-stall-yilian-mid12.jpg', x: -65.2, z: 10.2, yaw: Math.PI - 0.3, pitch: 0.02, fov: 68 },
  { id: '17', ref: '17-shop-boutique-zhencai-floral.jpg', x: -58.4, z: 20.4, yaw: 0.3, pitch: 0.02, fov: 68 },
  { id: '18', ref: '18-shop-interior-boutique-browsing.jpg', x: -31.6, z: -2.2, yaw: 0.12, pitch: -0.1, fov: 62, aspect: 4 / 3 },
  { id: '19', ref: '19-alley-retro-discount-racks.jpg', x: -71.5, z: -9.6, yaw: -HALF_PI + 0.1, pitch: -0.05, fov: 68 },
  { id: '20', ref: '20-alley-vintage-hk-street-sign.jpg', x: -67.4, z: -10.4, yaw: 0.95, pitch: 0.08, fov: 68 },
])

/** 首批三家店（无对应实拍，单独出渲染图）。 */
export const XXG_FIRST_SHOP_SHOTS = Object.freeze([
  { id: 'shop-apparel', x: -31, z: 1.2, yaw: 0, pitch: 0.02, fov: 62 },
  { id: 'shop-accessory', x: -26.8, z: 1.2, yaw: 0, pitch: 0, fov: 62 },
  { id: 'shop-snack', x: -22.8, z: -1.2, yaw: Math.PI, pitch: 0, fov: 62 },
  { id: 'first-shops-row', x: -35.5, z: 1.2, yaw: -HALF_PI + 0.42, pitch: -0.06, fov: 68, aspect: 4 / 3 },
  { id: 'crowd-east-ns', x: -18, z: 22, yaw: 0, pitch: -0.03, fov: 60, aspect: 4 / 3 },
])

export function parseShootArgs(argv) {
  const opts = { out: '/tmp/xxg-ref-shots', only: null, width: 540, warmup: 40 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--out') opts.out = resolve(next() || opts.out)
    else if (a === '--only') opts.only = String(next() || '').split(',').map(s => s.trim()).filter(Boolean)
    else if (a === '--width') opts.width = Math.max(180, Number(next()) || opts.width)
    else if (a === '--warmup') opts.warmup = Math.max(0, Number(next()) || 0)
  }
  return opts
}

const PAGE_ENTRY = `
import * as THREE from 'three'
import { createXxgIndoorScene } from './web/src/xiaoxianggang/runtime/index.ts'

window.__xxgShoot = async ({ shots, width, warmupSeconds }) => {
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true })
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setPixelRatio(1)
  const worldCamera = new THREE.PerspectiveCamera(55, 3 / 4, 0.1, 2000)
  const indoor = createXxgIndoorScene({ veilFadeInMs: 0, crowdSeed: 7 })
  await indoor.mount({
    renderer,
    worldCamera,
    bodyFlag: 'xxgActive',
    getWalker: () => null,
    openVeil: () => ({ done: async () => {} }),
    suspendWorld() {},
    resumeWorldAt: async () => true,
  })
  if (!(await indoor.enter('E1'))) throw new Error('enter E1 failed')
  for (let t = 0; t < warmupSeconds; t += 1 / 30) indoor.step(1 / 30)
  const cam = new THREE.PerspectiveCamera(68, 3 / 4, 0.05, 160)
  cam.rotation.order = 'YXZ'
  const out = []
  for (const s of shots) {
    const aspect = s.aspect ?? 3 / 4
    const w = width
    const h = Math.round(width / aspect)
    renderer.setSize(w, h, false)
    cam.aspect = aspect
    cam.fov = s.fov ?? 68
    cam.updateProjectionMatrix()
    cam.position.set(s.x, s.eyeY ?? 1.6, s.z)
    cam.rotation.set(s.pitch ?? 0, s.yaw ?? 0, 0, 'YXZ')
    cam.updateMatrixWorld(true)
    renderer.info.reset()
    renderer.render(indoor.scene, cam)
    const calls = renderer.info.render.calls
    let png = canvas.toDataURL('image/png')
    if (s.ref) {
      const img = new Image()
      img.src = '/refs/' + s.ref
      await img.decode()
      const rh = Math.round(img.height * (w / img.width))
      const board = document.createElement('canvas')
      board.width = w * 2 + 12
      board.height = Math.max(rh, h)
      const g = board.getContext('2d')
      g.fillStyle = '#f4efe2'
      g.fillRect(0, 0, board.width, board.height)
      g.drawImage(img, 0, 0, w, rh)
      g.drawImage(canvas, w + 12, 0, w, h)
      png = board.toDataURL('image/jpeg', 0.86)
    }
    out.push({ id: s.id, calls, png })
  }
  const metrics = { ...indoor.getMetrics(), crowd: indoor.getCrowdMetrics ? indoor.getCrowdMetrics() : null }
  indoor.dispose()
  renderer.dispose()
  return { shots: out, metrics }
}
`

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png' }

export async function runShoot(opts) {
  const req = createRequire(import.meta.url)
  const esbuild = req(join(REPO_ROOT, 'node_modules/esbuild'))
  const { chromium } = req(join(REPO_ROOT, 'node_modules/playwright'))
  mkdirSync(opts.out, { recursive: true })

  const bundle = await esbuild.build({
    stdin: { contents: PAGE_ENTRY, resolveDir: REPO_ROOT, sourcefile: 'xxg-ref-shots-entry.ts', loader: 'ts' },
    bundle: true,
    format: 'esm',
    write: false,
    target: 'es2022',
    loader: { '.json': 'json', '.css': 'empty' },
    logLevel: 'silent',
  })
  const js = bundle.outputFiles[0].text
  const html = '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><script type="module" src="/app.js"></script>'

  const missing = []
  const server = createServer((reqMsg, res) => {
    const url = decodeURIComponent((reqMsg.url || '/').split('?')[0])
    if (url === '/favicon.ico') {
      res.writeHead(204)
      return res.end()
    }
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'content-type': MIME['.html'] })
      return res.end(html)
    }
    if (url.endsWith('.css')) {
      // 运行时按 URL 挂的 HUD 样式与截图无关，回空样式表
      res.writeHead(200, { 'content-type': 'text/css' })
      return res.end('')
    }
    if (url === '/app.js') {
      res.writeHead(200, { 'content-type': MIME['.js'] })
      return res.end(js)
    }
    if (url.startsWith('/refs/')) {
      const file = join(REFS_DIR, url.slice('/refs/'.length).replace(/[\\/]/g, ''))
      if (existsSync(file)) {
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
        return res.end(readFileSync(file))
      }
    }
    missing.push(url)
    res.writeHead(404)
    res.end()
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const port = server.address().port

  const browser = await chromium.launch({
    headless: true,
    args: process.platform === 'darwin'
      ? ['--enable-gpu', '--use-angle=metal']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const errors = []
  try {
    const page = await browser.newPage()
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => {
      if (m.type() === 'error') errors.push(`${m.text()} ${m.location()?.url ?? ''}`.trim())
    })
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' })
    await page.waitForFunction(() => typeof window.__xxgShoot === 'function', null, { timeout: 30000 })
    const all = [...XXG_REF_SHOTS, ...XXG_FIRST_SHOP_SHOTS]
    const shots = opts.only ? all.filter(s => opts.only.includes(s.id)) : all
    const result = await page.evaluate(
      args => window.__xxgShoot(args),
      { shots, width: opts.width, warmupSeconds: opts.warmup },
    )
    const files = []
    for (const s of result.shots) {
      const isJpeg = s.png.startsWith('data:image/jpeg')
      const file = join(opts.out, `${isJpeg ? 'compare' : 'render'}-${s.id}.${isJpeg ? 'jpg' : 'png'}`)
      writeFileSync(file, Buffer.from(s.png.split(',')[1], 'base64'))
      const spec = all.find(x => x.id === s.id)
      files.push({ id: s.id, calls: s.calls, file, ...(spec?.reverse ? { reverse: true } : {}) })
    }
    const report = { ok: errors.length === 0, out: opts.out, metrics: result.metrics, files, errors, missing }
    writeFileSync(join(opts.out, 'report.json'), JSON.stringify(report, null, 2))
    return report
  } finally {
    await browser.close()
    server.close()
  }
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntry) {
  runShoot(parseShootArgs(process.argv.slice(2)))
    .then(r => {
      console.log(JSON.stringify({ ok: r.ok, out: r.out, metrics: r.metrics, shots: r.files.length, errors: r.errors, missing: r.missing }, null, 2))
      process.exit(r.ok ? 0 : 1)
    })
    .catch(e => {
      console.error(e)
      process.exit(1)
    })
}
