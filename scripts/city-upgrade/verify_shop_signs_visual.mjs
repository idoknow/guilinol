#!/usr/bin/env node
/**
 * Headless Metal Chromium Visual & Runtime Verification for IDOK-471 / IDOK-473
 * (4:1 HD Vector-Icon Shop Fascias, Zero Awning Occlusion, Shade-Adaptive Fill,
 *  Anisotropy=8 Oblique Clarity, Rainy Night Lightboxes, and Mobile ?gfx=low Retention).
 *
 * Captures 6 street-level verification views:
 *   1. 01_sanduo_closeup        — 三多路近景平视 (4:1 防拉扁 + 矢量行业图标清晰度)
 *   2. 02a_wxt_behind_shade     — 微笑堂背后背阴面 + 2F 挑檐 (0 遮挡 + 背阴提亮)
 *   3. 02b_alley_k1_awning      — 窄巷 kind=1 雨棚 + 背阴面 (雨棚下压 0 截断 + 背阴清晰)
 *   4. 03_shizijie_oblique      — 十字街周边沿街 25° 斜视 (anisotropy=8 斜看不糊)
 *   5. 04_night_rain_lightbox   — 夜间雨夜灯箱 (time=21.5&weather=rain, 锐利不白爆)
 *   6. 05_low_mobile_gfx        — ?gfx=low 手机视口 (430×932, 低画质保留高清新招牌)
 *
 * Usage:
 *   node scripts/city-upgrade/verify_shop_signs_visual.mjs [outDir] [--expect-grid 6x16]
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { preview } from 'vite'

const args = process.argv.slice(2)
let outDir = '/tmp/idok-473-visual-qa'
let expectGrid = [6, 16]
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--expect-grid' && args[i + 1]) {
    expectGrid = args[++i].split('x').map(Number)
  } else if (!args[i].startsWith('--')) {
    outDir = args[i]
  }
}
fs.mkdirSync(outDir, { recursive: true })

const SHOTS = [
  {
    id: '01_sanduo_closeup',
    label: '1. 三多路近景平视 · 4:1 防拉扁 + 行业矢量图标',
    query: 'gfx=mid&time=13.5&weather=clear',
    viewport: { width: 1280, height: 720 },
    dpr: 1,
    pos: [-1192.0, 158.1, -37.2],
    look: [-1192.0, 159.1, -48.0],
    expectQuality: 'mid',
  },
  {
    id: '02a_wxt_behind_shade',
    label: '2A. 微笑堂背后背阴面 + 2F 挑檐 · 0 截断 + 背阴提亮',
    query: 'gfx=mid&time=13.5&weather=clear',
    viewport: { width: 1280, height: 720 },
    dpr: 1,
    pos: [-1128.8, 158.3, -133.5],
    look: [-1139.2, 159.1, -137.5],
    expectQuality: 'mid',
  },
  {
    id: '02b_alley_k1_awning',
    label: '2B. 城中窄巷 kind=1 雨棚 22° 俯视 · 雨棚下压 0 遮挡',
    query: 'gfx=mid&time=13.5&weather=clear',
    viewport: { width: 1280, height: 720 },
    dpr: 1,
    pos: [-625.5, 159.4, 204.2],
    look: [-625.5, 155.3, 214.8],
    expectQuality: 'mid',
  },
  {
    id: '03_shizijie_oblique',
    label: '3. 十字街周边沿街斜视 · anisotropy=8 斜看不糊',
    query: 'gfx=mid&time=13.5&weather=clear',
    viewport: { width: 1280, height: 720 },
    dpr: 1,
    pos: [-825.8, 159.6, -277.5],
    look: [-813.0, 160.5, -304.5],
    expectQuality: 'mid',
  },
  {
    id: '04_night_rain_lightbox',
    label: '4. 夜间雨夜灯箱 · 锐利不白爆',
    query: 'gfx=mid&time=21.5&weather=rain',
    viewport: { width: 1280, height: 720 },
    dpr: 1,
    pos: [-1200.5, 158.1, -36.5],
    look: [-1185.0, 159.2, -47.8],
    expectQuality: 'mid',
  },
  {
    id: '05_low_mobile_gfx',
    label: '5. ?gfx=low 低画质手机视口 (430×932) · 保留高清新招牌',
    query: 'gfx=low&time=13.5&weather=clear',
    viewport: { width: 430, height: 932 },
    dpr: 2,
    mobile: true,
    pos: [-1192.0, 158.1, -35.8],
    look: [-1192.0, 159.1, -48.0],
    expectQuality: 'low',
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
const results = []
const assertions = []

async function waitViewReady(page, label) {
  try {
    await page.waitForFunction(() => {
      const v = window.viewer
      if (!v) return false
      const { stats, stream, camera, manifest, cityUpgrade } = v
      const cu = cityUpgrade.getStats()
      const chunksReady = !stats.pending && (!stream.queue || stream.queue.length === 0) && manifest.chunks.every(
        t => Math.hypot(t.x + 128 - camera.position.x, t.z + 128 - camera.position.z) > stream.radius || stream.loaded.has(t),
      )
      return chunksReady && cu.indexReady && cu.texturesReady && cu.loadedShards > 0 && cu.mountedPropGroups > 0
    }, null, { timeout: 120000 })
  } catch (err) {
    const diag = await page.evaluate(() => ({
      frame: window.viewer?.stats?.frame,
      pending: window.viewer?.stats?.pending,
      loaded: window.viewer?.stream?.loaded?.size,
      cam: window.viewer?.camera?.position?.toArray(),
      cu: window.viewer?.cityUpgrade?.getStats?.(),
    })).catch(() => null)
    console.error(`[timeout-diag] ${label}:`, JSON.stringify(diag))
    throw err
  }
  await page.waitForTimeout(1800)
}

async function sampleAndFreeze(page) {
  return page.evaluate(async () => {
    const v = window.viewer
    const samples = []
    for (let i = 0; i < 16; i++) {
      await new Promise(r => requestAnimationFrame(r))
      if (typeof v.stats?.calls === 'number' && v.stats.calls > 0) samples.push(v.stats.calls)
    }
    await v.freeze()
    return {
      cu: v.cityUpgrade.getStats(),
      calls: samples.length ? Math.min(...samples) : (v.stats?.calls ?? -1),
      loadedTiles: v.stream?.loaded?.size ?? -1,
    }
  })
}

async function runShot(shot) {
  const ctx = await browser.newContext({
    viewport: shot.viewport,
    deviceScaleFactor: shot.dpr || 1,
    hasTouch: Boolean(shot.mobile),
    isMobile: Boolean(shot.mobile),
  })
  const page = await ctx.newPage()
  await page.route('**/api/**', route => route.fulfill({ status: 204, body: '' }))
  page.on('pageerror', e => pageErrors.push(`${shot.id}: ${e.message}`))
  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(`${shot.id}: ${m.text()}`)
  })
  page.on('response', r => {
    if (r.status() >= 400) badResponses.push(`${shot.id}: ${r.status()} ${r.url()}`)
  })

  // Note: intentionally DO NOT pass cityUpgrade=1 on 05_low_mobile_gfx to prove ?gfx=low keeps it ON by default!
  const url = `${baseUrl}/?verify&loading=skip&${shot.query}`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(window.viewer?.stats?.firstMs > 0 && window.viewer?.cityUpgrade), null, { timeout: 90000 })

  // Dismiss mobile portrait orientation gate ("竖屏继续") so mobile screenshots show unobstructed street view
  if (shot.mobile) {
    const skipBtn = page.locator('.rotate-skip')
    if (await skipBtn.isVisible().catch(() => false)) {
      await skipBtn.click()
      await page.waitForTimeout(200)
    }
  }

  await page.evaluate(({ pos, look }) => {
    const v = window.viewer
    if (typeof v.flight === 'function') v.flight()
    v.camera.position.set(pos[0], pos[1], pos[2])
    v.camera.lookAt(look[0], look[1], look[2])
    v.camera.updateMatrixWorld()
  }, { pos: shot.pos, look: shot.look })

  await waitViewReady(page, shot.id)
  const after = await sampleAndFreeze(page)
  const afterPath = path.join(outDir, `${shot.id}.png`)
  await page.screenshot({ path: afterPath })

  // Capture a baseline Before (cityUpgrade=false) pair for shot 1 and shot 5 (mobile low) for direct comparison
  let beforeCalls = null
  if (shot.id === '01_sanduo_closeup' || shot.id === '05_low_mobile_gfx') {
    await page.evaluate(() => {
      const v = window.viewer
      v.resume()
      v.cityUpgrade.setEnabled(false)
    })
    await page.waitForTimeout(900)
    const before = await sampleAndFreeze(page)
    beforeCalls = before.calls
    await page.screenshot({ path: path.join(outDir, `${shot.id}_before.png`) })
  }

  // Hard assertions per shot
  const cu = after.cu
  if (!cu.enabled) assertions.push(`${shot.id}: expected cityUpgrade.enabled=true, got false`)
  if (cu.quality !== shot.expectQuality) assertions.push(`${shot.id}: expected quality=${shot.expectQuality}, got ${cu.quality}`)
  if (cu.fasciaGrid?.[0] !== expectGrid[0] || cu.fasciaGrid?.[1] !== expectGrid[1]) {
    assertions.push(`${shot.id}: expected fasciaGrid=${JSON.stringify(expectGrid)}, got ${JSON.stringify(cu.fasciaGrid)}`)
  }
  if ((cu.anisotropy ?? 0) < 8 && process.env.USE_SWIFTSHADER !== '1') {
    assertions.push(`${shot.id}: expected anisotropy>=8 on Metal GPU, got ${cu.anisotropy}`)
  }
  if (cu.mountedPropGroups <= 0) {
    assertions.push(`${shot.id}: mountedPropGroups=${cu.mountedPropGroups} (expected > 0)`)
  }

  results.push({
    id: shot.id,
    label: shot.label,
    calls: after.calls,
    beforeCalls,
    loadedTiles: after.loadedTiles,
    cu,
  })
  console.log(
    `[shot] ${shot.id}: calls=${after.calls}${beforeCalls !== null ? ` (before=${beforeCalls})` : ''} ` +
    `quality=${cu.quality} enabled=${cu.enabled} grid=${cu.fasciaGrid} aniso=${cu.anisotropy} mounted=${cu.mountedPropGroups}`,
  )
  await ctx.close()
}

try {
  for (const shot of SHOTS) {
    await runShot(shot)
  }
} finally {
  await browser.close()
  server.httpServer.close()
}

// Stitch clean 6-panel showcase collage + mobile low before/after comparison via Python Pillow
const pyScript = `
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

out = Path(${JSON.stringify(outDir)})
shots = json.loads(${JSON.stringify(JSON.stringify(SHOTS.map(s => ({ id: s.id, label: s.label, mobile: Boolean(s.mobile) }))))})

font_sm = font_lg = None
for p in ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc"]:
    if Path(p).exists():
        font_sm = ImageFont.truetype(p, 17)
        font_lg = ImageFont.truetype(p, 22)
        break

# 1. Desktop 5-view + Mobile panel overview (2 cols x 3 rows)
cw, ch, hdr = 640, 360, 36
pad = 12
sheet = Image.new("RGB", (pad * 3 + cw * 2, 56 + pad * 4 + (ch + hdr) * 3), (18, 20, 24))
d = ImageDraw.Draw(sheet)
d.text((pad, 16), "IDOK-471 / IDOK-473 · 桂林城建 4:1 高清矢量招牌 + 零雨棚遮挡 + 背阴提亮 + 低画质保留 实拍验收", fill=(255, 224, 144), font=font_lg)

for idx, s in enumerate(shots):
    r, c = divmod(idx, 2)
    x0 = pad + c * (cw + pad)
    y0 = 56 + pad + r * (ch + hdr + pad)
    img = Image.open(out / f"{s['id']}.png").convert("RGB")
    if s["mobile"]:
        # Fit portrait mobile screenshot cleanly onto a 640x360 dark stage alongside its before shot
        stage = Image.new("RGB", (cw, ch), (28, 31, 37))
        b_path = out / f"{s['id']}_before.png"
        if b_path.exists():
            bi = Image.open(b_path).convert("RGB")
            th = ch - 12
            tw = int(bi.width * th / bi.height)
            bi_r = bi.resize((tw, th), Image.Resampling.LANCZOS)
            ai_r = img.resize((tw, th), Image.Resampling.LANCZOS)
            gap = 20
            sx = (cw - (tw * 2 + gap)) // 2
            stage.paste(bi_r, (sx, 6))
            stage.paste(ai_r, (sx + tw + gap, 6))
            sd = ImageDraw.Draw(stage)
            sd.text((sx + 6, 10), "关城建(旧)", fill=(255, 160, 140), font=font_sm)
            sd.text((sx + tw + gap + 6, 10), "?gfx=low(新)", fill=(160, 255, 180), font=font_sm)
        else:
            th = ch
            tw = int(img.width * th / img.height)
            stage.paste(img.resize((tw, th), Image.Resampling.LANCZOS), ((cw - tw) // 2, 0))
        img_fit = stage
    else:
        img_fit = img.resize((cw, ch), Image.Resampling.LANCZOS)
    d.rectangle([x0, y0, x0 + cw, y0 + hdr], fill=(30, 34, 40))
    d.text((x0 + 10, y0 + 8), s["label"], fill=(238, 240, 244), font=font_sm)
    sheet.paste(img_fit, (x0, y0 + hdr))

sheet.save(out / "idok-473-visual-qa-sheet.jpg", quality=92)
print("Saved stitched QA sheet:", out / "idok-473-visual-qa-sheet.jpg")
`

const pyBin = fs.existsSync('/Users/pan-work/guilinol/.venv/bin/python')
  ? '/Users/pan-work/guilinol/.venv/bin/python'
  : 'python3'
const stitch = spawnSync(pyBin, ['-c', pyScript], { stdio: 'inherit' })
if (stitch.status !== 0) {
  console.error('Stitching failed')
  process.exit(1)
}

const summary = { results, consoleErrors, pageErrors, badResponses, assertions }
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log('SHOP_SIGNS_QA_SUMMARY:', JSON.stringify({
  shots: results.length,
  consoleErrors: consoleErrors.length,
  pageErrors: pageErrors.length,
  badResponses: badResponses.length,
  assertions,
}))

if (consoleErrors.length || pageErrors.length || badResponses.length || assertions.length) {
  console.error('SHOP SIGNS VISUAL QA FAILED:', JSON.stringify(summary, null, 2))
  process.exit(1)
}
