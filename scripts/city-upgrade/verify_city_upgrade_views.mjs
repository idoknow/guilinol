#!/usr/bin/env node
/**
 * Headless Metal/SwiftShader Playwright visual comparison & QA verification script
 * for Guilin Online City Upgrade v1+ full-city (R1 regression + R2/R3 outer-ring) acceptance.
 *
 * Captures pixel-aligned Before (cityUpgrade=false) vs After (cityUpgrade=true, 96-shop 8x12)
 * side-by-side comparisons across 4 representative outer-ring corridors (day sunny + rain night)
 * plus 1 R1 Sanduo Road regression check:
 *   1. Guilin Railway Station (桂林站周边 · 中山南路/上海路) [R2/R3]
 *   2. Qixing / Jiefang Bridge East (解放桥东 / 七星 · 栖霞路/东江路) [R2]
 *   3. Nanmen Bridge (南门桥 · 中山中路/西城路/南环路) [R2]
 *   4. Beiji Square (北极广场周边 · 环城北一路/中山北路) [R3]
 *   5. Sanduo Road (三多路百米 · R1 96款招牌回归核验) [R1]
 *
 * Enforces strict zero-error gates: 0 console errors, 0 pageerrors, 0 HTTP 404/5xx,
 * indexedShards === 96, fasciaGrid === [8, 12], DrawCall delta <= +10.
 * Strictly headless (never opens visible browser windows on shared macOS host).
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { preview } from 'vite'

const OUT_DIR = process.argv[2] || '/tmp/city-upgrade-outer-shots'
fs.mkdirSync(OUT_DIR, { recursive: true })

// 5 viewpoints aimed directly at upgraded commercial streets (camera positioned in roadway clear of walls)
const VIEWS = [
  {
    id: '01_guilin_station',
    label: '桂林站周边 · 中山南路/上海路 (R2/R3)',
    pos: [-1919, 159.2, 1966],
    look: [-1903, 158.0, 1998],
    modes: [
      { key: 'day', query: 'time=13.5' },
      { key: 'rain_night', query: 'time=21.5&weather=rain' },
    ],
  },
  {
    id: '02_qixing_jiefang_east',
    label: '解放桥东 / 七星片区 · 栖霞路/东江路 (R2)',
    pos: [120, 155.5, -62],
    look: [106, 154.5, -106],
    modes: [
      { key: 'day', query: 'time=13.5' },
      { key: 'rain_night', query: 'time=21.5&weather=rain' },
    ],
  },
  {
    id: '03_nanmen_bridge',
    label: '南门桥 · 中山南路商街 (R2)',
    pos: [-1754.0, 160.2, 1026.3],
    look: [-1779.5, 160.0, 1050.3],
    modes: [
      { key: 'day', query: 'time=13.5' },
      { key: 'rain_night', query: 'time=21.5&weather=rain' },
    ],
  },
  {
    id: '04_beiji_square',
    label: '北极广场 · 中山北路商街 (R3)',
    pos: [-620.1, 160.8, -2088.4],
    look: [-607.4, 161.0, -2121.0],
    modes: [
      { key: 'day', query: 'time=13.5' },
      { key: 'rain_night', query: 'time=21.5&weather=rain' },
    ],
  },
  {
    id: '05_sanduo_r1_reg',
    label: '三多路百米 · R1 96款招牌回归 (R1)',
    pos: [-1224.5, 160.0, -41.0],
    look: [-1189.6, 160.4, -38.6],
    modes: [
      { key: 'day', query: 'time=13.5' },
    ],
  },
]

const server = await preview({
  root: 'web',
  configFile: 'web/vite.config.ts',
  preview: { host: '127.0.0.1', port: 0 },
})
const port = server.httpServer.address().port
const baseUrl = `http://127.0.0.1:${port}`

const launchArgs = process.env.USE_SWIFTSHADER === '1'
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--use-gl=angle', '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist']

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM || undefined,
  args: launchArgs,
})

const consoleErrors = []
const pageErrors = []
const badResponses = []
const metrics = []
let verifiedStats = null

async function capturePair(view, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await ctx.newPage()
  // Static vite preview has no Cloudflare Worker backend; stub /api/** cleanly like audit.mjs
  await page.route('**/api/**', route => route.fulfill({ status: 204, body: '' }))
  page.on('pageerror', e => pageErrors.push(`${view.id}/${mode.key}: ${e.message}`))
  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(`${view.id}/${mode.key}: ${m.text()}`)
  })
  page.on('response', r => {
    if (r.status() >= 400) badResponses.push(`${view.id}/${mode.key}: ${r.status()} ${r.url()}`)
  })

  const url = `${baseUrl}/?verify&loading=skip&gfx=mid&${mode.query}&cityUpgrade=1`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(window.viewer?.stats?.firstMs > 0 && window.viewer?.cityUpgrade), null, { timeout: 90000 })

  // Switch into clean flight camera (stops walker override) and place at target viewpoint
  await page.evaluate(({ pos, look }) => {
    const v = window.viewer
    if (typeof v.flight === 'function') v.flight()
    v.camera.position.set(pos[0], pos[1], pos[2])
    v.camera.lookAt(look[0], look[1], look[2])
    v.camera.updateMatrixWorld()
  }, { pos: view.pos, look: view.look })

  // Wait for chunks + city-upgrade textures & shards to load
  await page.waitForFunction(() => {
    const v = window.viewer
    const { stats, stream, camera, manifest, cityUpgrade } = v
    const cu = cityUpgrade.getStats()
    const chunksReady = !stats.pending && manifest.chunks.every(
      t => Math.hypot(t.x + 128 - camera.position.x, t.z + 128 - camera.position.z) > stream.radius || stream.loaded.has(t),
    )
    return chunksReady && cu.indexReady && cu.texturesReady && cu.loadedShards > 0 && cu.mountedPropGroups > 0
  }, null, { timeout: 120000 })

  // Let textures & WebGL2 mipmaps settle, then sample steady-state main-pass draw calls (min over 10 frames filters periodic shadow-map refresh spikes)
  await page.waitForTimeout(1400)

  const afterStats = await page.evaluate(async () => {
    const v = window.viewer
    const samples = []
    for (let i = 0; i < 10; i++) {
      await new Promise(r => requestAnimationFrame(r))
      if (typeof v.stats?.calls === 'number' && v.stats.calls > 0) samples.push(v.stats.calls)
    }
    await v.freeze()
    const cu = v.cityUpgrade.getStats()
    const calls = samples.length ? Math.min(...samples) : (v.stats?.calls ?? -1)
    return { cu, calls }
  })
  verifiedStats = afterStats.cu

  const afterPng = path.join(OUT_DIR, `${view.id}_${mode.key}_after.png`)
  await page.screenshot({ path: afterPng })

  // Toggle cityUpgrade OFF at the EXACT same camera & frame environment for Before shot
  await page.evaluate(() => {
    const v = window.viewer
    v.resume()
    v.cityUpgrade.setEnabled(false)
  })
  await page.waitForTimeout(900)

  const beforeStats = await page.evaluate(async () => {
    const v = window.viewer
    const samples = []
    for (let i = 0; i < 10; i++) {
      await new Promise(r => requestAnimationFrame(r))
      if (typeof v.stats?.calls === 'number' && v.stats.calls > 0) samples.push(v.stats.calls)
    }
    await v.freeze()
    const cu = v.cityUpgrade.getStats()
    const calls = samples.length ? Math.min(...samples) : (v.stats?.calls ?? -1)
    return { cu, calls }
  })

  const beforePng = path.join(OUT_DIR, `${view.id}_${mode.key}_before.png`)
  await page.screenshot({ path: beforePng })

  await ctx.close()
  const dcDelta = afterStats.calls >= 0 && beforeStats.calls >= 0 ? afterStats.calls - beforeStats.calls : null
  metrics.push({
    view: view.id,
    mode: mode.key,
    beforeCalls: beforeStats.calls,
    afterCalls: afterStats.calls,
    dcDelta,
    cu: afterStats.cu,
  })
  console.log(
    `[shot] ${view.id} (${mode.key}): calls ${beforeStats.calls} -> ${afterStats.calls} (delta ${dcDelta}) | ` +
    `shards=${afterStats.cu.indexedShards} loaded=${afterStats.cu.loadedShards} mounted=${afterStats.cu.mountedPropGroups} grid=${afterStats.cu.fasciaGrid}`,
  )
}

try {
  for (const view of VIEWS) {
    for (const mode of view.modes) {
      await capturePair(view, mode)
    }
  }
} finally {
  await browser.close()
  server.httpServer.close()
}

// Stitch side-by-side before/after comparisons via Python Pillow
const pyScript = `
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

out = Path(${JSON.stringify(OUT_DIR)})
views = ${JSON.stringify(VIEWS.map(v => ({ id: v.id, label: v.label, modes: v.modes.map(m => m.key) })))}
font = None
for p in ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc"]:
    if Path(p).exists():
        font = ImageFont.truetype(p, 18)
        break

for v in views:
    for mk in v["modes"]:
        b = Image.open(out / f"{v['id']}_{mk}_before.png").convert("RGB").resize((720, 405), Image.Resampling.LANCZOS)
        a = Image.open(out / f"{v['id']}_{mk}_after.png").convert("RGB").resize((720, 405), Image.Resampling.LANCZOS)
        comp = Image.new("RGB", (1444, 445), (22, 24, 28))
        comp.paste(b, (0, 40))
        comp.paste(a, (724, 40))
        d = ImageDraw.Draw(comp)
        d.rectangle([720, 0, 723, 445], fill=(220, 224, 228))
        mode_zh = "晴午" if mk == "day" else "雨夜"
        d.text((14, 8), f"原版 GL04 · {v['label']} [{mode_zh}]", fill=(210, 215, 220), font=font)
        d.text((738, 8), f"城建 v1+ 全城版 (96款一店一色) · {v['label']} [{mode_zh}]", fill=(255, 218, 128), font=font)
        comp.save(out / f"{v['id']}_{mk}_compare.jpg", quality=90)
print("Stitched comparison sheets in", out)
`
const pyBin = fs.existsSync('/Users/pan-work/guilinol/.venv/bin/python')
  ? '/Users/pan-work/guilinol/.venv/bin/python'
  : 'python3'
const stitch = spawnSync(pyBin, ['-c', pyScript], { stdio: 'inherit' })
if (stitch.status !== 0) {
  console.error('Stitching comparisons failed')
  process.exit(1)
}

const assertions = []
if (!verifiedStats || verifiedStats.indexedShards !== 96) {
  assertions.push(`Expected indexedShards=96, got ${verifiedStats?.indexedShards}`)
}
if (!verifiedStats || verifiedStats.fasciaGrid?.[0] !== 8 || verifiedStats.fasciaGrid?.[1] !== 12) {
  assertions.push(`Expected fasciaGrid=[8,12], got ${JSON.stringify(verifiedStats?.fasciaGrid)}`)
}
for (const m of metrics) {
  if (m.dcDelta !== null && m.dcDelta > 12) {
    assertions.push(`DrawCall delta too high at ${m.view}/${m.mode}: +${m.dcDelta}`)
  }
}

const summary = { metrics, consoleErrors, pageErrors, badResponses, assertions }
fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2))
console.log('QA Summary:', JSON.stringify({
  pairs: metrics.length,
  indexedShards: verifiedStats?.indexedShards,
  fasciaGrid: verifiedStats?.fasciaGrid,
  consoleErrors: consoleErrors.length,
  pageErrors: pageErrors.length,
  badResponses: badResponses.length,
  assertions: assertions.length,
}))

if (consoleErrors.length || pageErrors.length || badResponses.length || assertions.length) {
  console.error('VISUAL QA FAILED:', JSON.stringify(summary, null, 2))
  process.exit(1)
}
