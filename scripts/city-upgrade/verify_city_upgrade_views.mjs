#!/usr/bin/env node
/**
 * Full-City 4,080-chunk / 952-shard Headless Metal Chromium Visual & Steady-State QA (IDOK-437 / IDOK-434).
 *
 * Captures pixel-aligned Before (cityUpgrade=false) vs After (cityUpgrade=true) comparisons
 * across all 6 outer-ring districts + R1 Sanduo Road regression check (day sunny + night):
 *   1. 临桂新区 (世纪大道/万达)
 *   2. 桂林北站周边 (站前路/北辰路)
 *   3. 七星东 / 三里店 / 高新区
 *   4. 花江桂电 / 尧山东
 *   5. 瓦窑 / 凯风路 (城南)
 *   6. 两江国际机场周边 (静区零商业招牌 + 克制村镇)
 *   7. 三多路百米 (R1 零退化 + 夜景橱窗色温明暗层次)
 *
 * Also executes a single-session cross-city teleport stability test across 4 distant districts
 * verifying shard eviction (`loadedShards` / `mountedPropGroups` stay bounded, DrawCall delta <= +10).
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { preview } from 'vite'

const OUT_DIR = process.argv[2] || '/tmp/city-upgrade-4080-shots'
fs.mkdirSync(OUT_DIR, { recursive: true })

const VIEWS = [
  {
    id: '01_lingui',
    label: '临桂新区 · 世纪东路现代商圈 (R4)',
    pos: [-10150.9, 188.0, 3294.1],
    look: [-10215.0, 162.0, 3272.0],
    expectProps: true,
  },
  {
    id: '02_guilin_north',
    label: '桂林北站周边 · 八里四路/站前片区 (R4)',
    pos: [651.0, 186.0, -7357.6],
    look: [586.0, 162.0, -7376.0],
    expectProps: true,
  },
  {
    id: '03_qixing_east',
    label: '七星东 / 三里店 / 高新区 · 芳香路 (R3)',
    pos: [2190.8, 184.0, 281.7],
    look: [2256.0, 159.0, 265.0],
    expectProps: true,
  },
  {
    id: '04_huajiang_yaoshan',
    label: '花江桂电 / 尧山东 · 白墙灰瓦建筑群 (R4)',
    pos: [5242.7, 182.6, 735.0],
    look: [5180.7, 158.6, 693.0],
    expectProps: false,
  },
  {
    id: '05_wayao_kaifeng',
    label: '瓦窑 / 凯风路 · 城南商住过渡街景 (R4)',
    pos: [-962.7, 159.1, 5347.4],
    look: [-939.0, 159.6, 5355.7],
    expectProps: true,
  },
  {
    id: '06_airport',
    label: '两江国际机场周边 · 临苏路静区零招牌 (R4)',
    pos: [-16587.1, 188.0, 7344.9],
    look: [-16652.0, 161.0, 7335.0],
    expectProps: false,
  },
  {
    id: '07_sanduo_r1',
    label: '三多路百米 · R1 零退化与夜景橱窗 (R1)',
    pos: [-1224.5, 160.0, -41.0],
    look: [-1189.6, 160.4, -38.6],
    expectProps: true,
  },
]

const MODES = [
  { key: 'day', zh: '晴午', query: 'time=13.5' },
  { key: 'night', zh: '夜景', query: 'time=21.5' },
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
const crossCityTrace = []
let verifiedStats = null

async function waitViewReady(page, expectProps, label) {
  try {
    await page.waitForFunction((reqProps) => {
      const v = window.viewer
      const { stats, stream, camera, manifest, cityUpgrade } = v
      const cu = cityUpgrade.getStats()
      const chunksReady = !stats.pending && (!stream.queue || stream.queue.length === 0) && manifest.chunks.every(
        t => Math.hypot(t.x + 128 - camera.position.x, t.z + 128 - camera.position.z) > stream.radius || stream.loaded.has(t),
      )
      return chunksReady && cu.indexReady && cu.texturesReady && cu.loadedShards > 0 && (!reqProps || cu.mountedPropGroups > 0)
    }, expectProps, { timeout: 120000 })
  } catch (err) {
    const diag = await page.evaluate(() => {
      const v = window.viewer
      return {
        frame: v?.stats?.frame,
        pending: v?.stats?.pending,
        loaded: v?.stream?.loaded?.size,
        cam: v?.camera?.position?.toArray(),
        cu: v?.cityUpgrade?.getStats?.(),
      }
    }).catch(() => null)
    console.error(`[timeout-diag] ${label}:`, JSON.stringify(diag))
    throw err
  }
  await page.waitForTimeout(1600)
}

async function sampleCalls(page) {
  return page.evaluate(async () => {
    const v = window.viewer
    const samples = []
    for (let i = 0; i < 20; i++) {
      await new Promise(r => requestAnimationFrame(r))
      if (typeof v.stats?.calls === 'number' && v.stats.calls > 0) samples.push(v.stats.calls)
    }
    await v.freeze()
    const cu = v.cityUpgrade.getStats()
    const calls = samples.length ? Math.min(...samples) : (v.stats?.calls ?? -1)
    return { cu, calls, loadedTiles: v.stream?.loaded?.size ?? -1 }
  })
}

async function captureMode(mode) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await ctx.newPage()
  await page.route('**/api/**', route => route.fulfill({ status: 204, body: '' }))
  page.on('pageerror', e => pageErrors.push(`${mode.key}: ${e.message}`))
  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(`${mode.key}: ${m.text()}`)
  })
  page.on('response', r => {
    if (r.status() >= 400) badResponses.push(`${mode.key}: ${r.status()} ${r.url()}`)
  })

  const url = `${baseUrl}/?verify&loading=skip&gfx=mid&${mode.query}&cityUpgrade=1`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(window.viewer?.stats?.firstMs > 0 && window.viewer?.cityUpgrade), null, { timeout: 90000 })

  for (let vi = 0; vi < VIEWS.length; vi++) {
    const view = VIEWS[vi]
    // Enable cityUpgrade and fly to target viewpoint (same session tests cross-city eviction too!)
    await page.evaluate(({ pos, look, needResume }) => {
      const v = window.viewer
      if (needResume) v.resume()
      v.cityUpgrade.setEnabled(true)
      if (typeof v.flight === 'function') v.flight()
      v.camera.position.set(pos[0], pos[1], pos[2])
      v.camera.lookAt(look[0], look[1], look[2])
      v.camera.updateMatrixWorld()
    }, { pos: view.pos, look: view.look, needResume: vi > 0 })

    await waitViewReady(page, view.expectProps, `${view.id}/${mode.key}`)
    const afterStats = await sampleCalls(page)
    verifiedStats = afterStats.cu
    if (mode.key === 'day') {
      crossCityTrace.push({
        view: view.id,
        loadedTiles: afterStats.loadedTiles,
        loadedShards: afterStats.cu.loadedShards,
        mountedPropGroups: afterStats.cu.mountedPropGroups,
        upgradedTiles: afterStats.cu.upgradedTiles,
      })
    }

    const afterPng = path.join(OUT_DIR, `${view.id}_${mode.key}_after.png`)
    await page.screenshot({ path: afterPng })

    // Toggle cityUpgrade OFF at exact same camera pose for Before shot
    await page.evaluate(() => {
      const v = window.viewer
      v.resume()
      v.cityUpgrade.setEnabled(false)
    })
    await page.waitForTimeout(800)
    const beforeStats = await sampleCalls(page)
    const beforePng = path.join(OUT_DIR, `${view.id}_${mode.key}_before.png`)
    await page.screenshot({ path: beforePng })

    const dcDelta = afterStats.calls >= 0 && beforeStats.calls >= 0 ? afterStats.calls - beforeStats.calls : null
    metrics.push({
      view: view.id,
      mode: mode.key,
      beforeCalls: beforeStats.calls,
      afterCalls: afterStats.calls,
      dcDelta,
      loadedTiles: afterStats.loadedTiles,
      cu: afterStats.cu,
    })
    console.log(
      `[shot] ${view.id} (${mode.key}): calls ${beforeStats.calls} -> ${afterStats.calls} (delta ${dcDelta}) | ` +
      `indexed=${afterStats.cu.indexedShards} loadedShards=${afterStats.cu.loadedShards} mounted=${afterStats.cu.mountedPropGroups} tiles=${afterStats.loadedTiles}`,
    )
  }

  await ctx.close()
}

try {
  for (const mode of MODES) {
    await captureMode(mode)
  }
} finally {
  await browser.close()
  server.httpServer.close()
}

// Stitch clean comparison contact sheets via Python Pillow
const pyScript = `
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

out = Path(${JSON.stringify(OUT_DIR)})
views = ${JSON.stringify(VIEWS.map(v => ({ id: v.id, label: v.label })))}
modes = ${JSON.stringify(MODES.map(m => ({ key: m.key, zh: m.zh })))}

font_sm = None
font_lg = None
for p in ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc"]:
    if Path(p).exists():
        font_sm = ImageFont.truetype(p, 16)
        font_lg = ImageFont.truetype(p, 20)
        break

# 1. Per-view before/after pairs
for v in views:
    for m in modes:
        b = Image.open(out / f"{v['id']}_{m['key']}_before.png").convert("RGB").resize((640, 360), Image.Resampling.LANCZOS)
        a = Image.open(out / f"{v['id']}_{m['key']}_after.png").convert("RGB").resize((640, 360), Image.Resampling.LANCZOS)
        comp = Image.new("RGB", (1284, 396), (22, 24, 28))
        comp.paste(b, (0, 36))
        comp.paste(a, (644, 36))
        d = ImageDraw.Draw(comp)
        d.rectangle([640, 0, 643, 396], fill=(220, 224, 228))
        d.text((12, 8), f"原版 GL04 · {v['label']} [{m['zh']}]", fill=(210, 215, 220), font=font_sm)
        d.text((656, 8), f"城建 v1+ 全图版 (4,080 区块) · {v['label']} [{m['zh']}]", fill=(255, 218, 128), font=font_sm)
        comp.save(out / f"{v['id']}_{m['key']}_compare.jpg", quality=88)

# 2. Outer-ring 6-district contact sheets (day & night, 2 cols x 3 rows, each cell before|after)
outer = views[:6]
for m in modes:
    cell_w, cell_h, hdr = 964, 304, 34
    cols, rows = 2, 3
    sheet = Image.new("RGB", (cols * cell_w + 16, rows * cell_h + 52), (16, 18, 22))
    sd = ImageDraw.Draw(sheet)
    sd.text((18, 12), f"城建 v1+ 全开放地图 (4,080 区块 / 952 分片) · 外环 6 大区 Before / After 实拍 [{m['zh']}]", fill=(255, 224, 140), font=font_lg)
    for idx, v in enumerate(outer):
        r, c = divmod(idx, cols)
        x0 = 6 + c * cell_w
        y0 = 48 + r * cell_h
        b = Image.open(out / f"{v['id']}_{m['key']}_before.png").convert("RGB").resize((476, 268), Image.Resampling.LANCZOS)
        a = Image.open(out / f"{v['id']}_{m['key']}_after.png").convert("RGB").resize((476, 268), Image.Resampling.LANCZOS)
        sheet.paste(b, (x0, y0 + hdr))
        sheet.paste(a, (x0 + 480, y0 + hdr))
        sd.rectangle([x0 + 476, y0, x0 + 479, y0 + hdr + 268], fill=(180, 185, 195))
        sd.text((x0 + 8, y0 + 7), f"Before · {v['label']}", fill=(200, 206, 214), font=font_sm)
        sd.text((x0 + 488, y0 + 7), f"After · 城建 v1+", fill=(255, 218, 128), font=font_sm)
    sheet.save(out / f"outer6_{m['key']}_sheet.jpg", quality=88)

# 3. Sanduo R1 regression + night shopfront showcase sheet (day + night stacked)
s_day = Image.open(out / "07_sanduo_r1_day_compare.jpg")
s_night = Image.open(out / "07_sanduo_r1_night_compare.jpg")
s_sheet = Image.new("RGB", (s_day.width, s_day.height + s_night.height + 6), (16, 18, 22))
s_sheet.paste(s_day, (0, 0))
s_sheet.paste(s_night, (0, s_day.height + 6))
s_sheet.save(out / "sanduo_r1_day_night_sheet.jpg", quality=90)
print("Stitched all comparison sheets in", out)
`

const pyBin = fs.existsSync('/Users/pan-work/guilinol/.venv/bin/python')
  ? '/Users/pan-work/guilinol/.venv/bin/python'
  : 'python3'
const stitch = spawnSync(pyBin, ['-c', pyScript], { stdio: 'inherit' })
if (stitch.status !== 0) {
  console.error('Stitching failed')
  process.exit(1)
}

const assertions = []
if (!verifiedStats || verifiedStats.indexedShards !== 952) {
  assertions.push(`Expected indexedShards=952, got ${verifiedStats?.indexedShards}`)
}
if (!verifiedStats || verifiedStats.fasciaGrid?.[0] !== 6 || verifiedStats.fasciaGrid?.[1] !== 16) {
  assertions.push(`Expected fasciaGrid=[6,16], got ${JSON.stringify(verifiedStats?.fasciaGrid)}`)
}
for (const m of metrics) {
  if (m.dcDelta !== null && m.dcDelta > 10) {
    assertions.push(`DrawCall delta > +10 at ${m.view}/${m.mode}: +${m.dcDelta}`)
  }
}
for (const t of crossCityTrace) {
  if (t.loadedShards > 36) {
    assertions.push(`Shard eviction leak suspected at ${t.view}: loadedShards=${t.loadedShards}`)
  }
}

const summary = { metrics, crossCityTrace, consoleErrors, pageErrors, badResponses, assertions }
fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2))
console.log('CROSS_CITY_TRACE:', JSON.stringify(crossCityTrace))
console.log('QA_SUMMARY:', JSON.stringify({
  pairs: metrics.length,
  indexedShards: verifiedStats?.indexedShards,
  fasciaGrid: verifiedStats?.fasciaGrid,
  maxDcDelta: Math.max(...metrics.map(m => m.dcDelta ?? -999)),
  maxLoadedShards: Math.max(...crossCityTrace.map(t => t.loadedShards)),
  consoleErrors: consoleErrors.length,
  pageErrors: pageErrors.length,
  badResponses: badResponses.length,
  assertions,
}))

if (consoleErrors.length || pageErrors.length || badResponses.length || assertions.length) {
  console.error('VISUAL QA FAILED:', JSON.stringify(summary, null, 2))
  process.exit(1)
}
