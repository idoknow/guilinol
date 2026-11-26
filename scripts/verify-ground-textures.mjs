#!/usr/bin/env node
/**
 * Headless Metal / SwiftShader Playwright visual QA & Before/After comparison script
 * for IDOK-432 (urban ground, riverbank/slope, bridge deck/fascia & street surface textures).
 *
 * Captures pixel-aligned Before (groundUpgrade=false) vs After (groundUpgrade=true)
 * side-by-side comparisons across 6 viewpoints (晴午 & 夜间):
 *   1. 南环路 · 文昌桥跨河口（图 1 同机位：裸地 + 河岸斜坡 + 桥梁顶/侧面）
 *   2. 南环路 · 斑马线与建筑退界裸地（图 2 同机位：大片退界地面 + 人行道 + 中央绿带 + 沥青路面）
 *   3. 十字街 · 核心商圈路面/人行道/退界协调度
 *   4. 三多路 · 商街沥青/人行道与建筑立面协调度
 *   5. 漓江/桃花江河岸草坡 · 绿地/草坡/驳岸斜坡防拉丝质感
 *   6. 跨 256m 瓦片边界（z=1024）· 跨块无缝连续核验
 *
 * Enforces strict gates:
 *   - 0 console / WebGL / shader errors
 *   - 0 pageerrors
 *   - 0 HTTP 404/5xx
 *   - DrawCall delta === 0 (strictly <= 0)
 *   - No black screen / blown-out neon saturation / zero-change regression
 *
 * Strictly headless (never opens visible browser windows on shared macOS host).
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { preview } from 'vite'

const OUT_DIR = process.argv[2] || '/tmp/idok-432-ground-shots'
fs.mkdirSync(OUT_DIR, { recursive: true })

const VIEWS = [
  {
    id: '01_nanhuan_bridge',
    label: '南环路·文昌桥跨河口（图1同机位）',
    pos: [-1151.0, 152.9, 999.0],
    look: [-1155.0, 149.2, 1044.0],
    modes: [
      { key: 'day', query: 'time=13.5' },
      { key: 'night', query: 'time=21.5' },
    ],
  },
  {
    id: '02_nanhuan_setback',
    label: '南环路·斑马线与建筑退界裸地（图2同机位）',
    pos: [-1165.5, 153.2, 994.8],
    look: [-1140.0, 150.2, 998.5],
    modes: [
      { key: 'day', query: 'time=13.5' },
      { key: 'night', query: 'time=21.5' },
    ],
  },
  {
    id: '03_shizijie',
    label: '十字街·核心商圈路面与人行道',
    pos: [-905.0, 156.0, -166.0],
    look: [-865.0, 151.5, -163.0],
    modes: [
      { key: 'day', query: 'time=13.5' },
      { key: 'night', query: 'time=21.5' },
    ],
  },
  {
    id: '04_sanduo',
    label: '三多路·商街沥青与退界协调度',
    pos: [-1224.5, 159.2, -41.0],
    look: [-1189.6, 156.2, -38.6],
    modes: [
      { key: 'day', query: 'time=13.5' },
      { key: 'night', query: 'time=21.5' },
    ],
  },
  {
    id: '05_riverbank_grass',
    label: '桃花江·河岸草坡与驳岸',
    pos: [-1032.0, 157.5, 1044.0],
    look: [-1088.0, 148.5, 1066.0],
    modes: [
      { key: 'day', query: 'time=13.5' },
      { key: 'night', query: 'time=21.5' },
    ],
  },
  {
    id: '06_tile_seam',
    label: '跨256m瓦片边界（z=1024）无缝核验',
    pos: [-1132.0, 160.0, 1002.0],
    look: [-1145.0, 149.0, 1044.0],
    modes: [
      { key: 'day', query: 'time=13.5' },
    ],
  },
]

function resolveWorldFallbackDir() {
  const candidates = [
    process.env.GLOL_WORLD_DIR,
    path.resolve('public/world'),
    '/Users/pan-work/guilinol/public/world',
  ].filter(Boolean)
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir
  }
  return null
}

const fallbackWorldDir = fs.existsSync(path.resolve('dist/world/manifest.json'))
  ? null
  : resolveWorldFallbackDir()

const server = await preview({
  root: 'web',
  configFile: 'web/vite.config.ts',
  preview: { host: '127.0.0.1', port: 0 },
})
if (fallbackWorldDir) {
  // Prepend before Vite preview's static/SPA fallback middleware so /world/* resolves cleanly when dist/world is absent.
  server.middlewares.stack.unshift({
    route: '/world',
    handle(req, res) {
      const cleanPath = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '')
      if (!cleanPath || cleanPath.includes('..')) {
        res.statusCode = 404
        res.end('Not found')
        return
      }
      const full = path.join(fallbackWorldDir, cleanPath)
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        res.statusCode = 404
        res.end('Not found')
        return
      }
      const st = fs.statSync(full)
      const ext = path.extname(full).toLowerCase()
      const mime = ext === '.json' ? 'application/json'
        : ext === '.png' ? 'image/png'
        : 'application/octet-stream'
      res.setHeader('Content-Type', mime)
      res.setHeader('Content-Length', String(st.size))
      fs.createReadStream(full).pipe(res)
    },
  })
}

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

async function sampleSteady(page) {
  return page.evaluate(async () => {
    const v = window.viewer
    const callSamples = []
    let last = v.stats?.frame ?? 0
    const t0 = performance.now()
    const frames = 24
    for (let i = 0; i < frames; i++) {
      do {
        await new Promise(r => requestAnimationFrame(r))
      } while ((v.stats?.frame ?? 0) === last)
      last = v.stats?.frame ?? 0
      if (typeof v.stats?.calls === 'number' && v.stats.calls > 0) callSamples.push(v.stats.calls)
    }
    const elapsed = performance.now() - t0
    await v.freeze()
    const calls = callSamples.length ? Math.min(...callSamples) : (v.stats?.calls ?? -1)
    const fps = elapsed > 0 ? Math.round((frames * 1000 / elapsed) * 10) / 10 : 0
    return { calls, fps }
  })
}

async function capturePair(view, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await ctx.newPage()
  await page.route('**/api/**', route => route.fulfill({ status: 204, body: '' }))
  let closing = false
  page.on('pageerror', e => { if (!closing) pageErrors.push(`${view.id}/${mode.key}: ${e.message}`) })
  page.on('console', m => {
    if (closing) return
    const txt = m.text()
    if (m.type() === 'error' || /Shader Error|VALIDATE_STATUS|GL_INVALID/i.test(txt)) {
      consoleErrors.push(`${view.id}/${mode.key}: ${txt}`)
    }
  })
  page.on('requestfailed', req => {
    if (closing) return
    const errText = req.failure()?.errorText || 'unknown'
    if (!/ERR_ABORTED/i.test(errText)) {
      badResponses.push(`${view.id}/${mode.key}: FAILED ${errText} ${req.url()}`)
    }
  })
  page.on('response', r => {
    if (!closing && r.status() >= 400) badResponses.push(`${view.id}/${mode.key}: ${r.status()} ${r.url()}`)
  })

  const url = `${baseUrl}/?verify&loading=skip&gfx=mid&${mode.query}&cityUpgrade=1`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  try {
    await page.waitForFunction(() => Boolean(window.viewer?.stats?.firstMs > 0 && window.__glolGroundUpgrade), null, { timeout: 90000 })
  } catch (err) {
    console.error('Boot wait failed:', { consoleErrors, pageErrors, badResponses })
    throw err
  }

  await page.evaluate(({ pos, look }) => {
    const v = window.viewer
    if (typeof v.flight === 'function') v.flight()
    v.camera.position.set(pos[0], pos[1], pos[2])
    v.camera.lookAt(look[0], look[1], look[2])
    v.camera.updateMatrixWorld()
  }, { pos: view.pos, look: view.look })

  await page.waitForFunction(() => {
    const v = window.viewer
    const { stats, stream, camera, manifest } = v
    return !stats.pending && manifest.chunks.every(
      t => Math.hypot(t.x + 128 - camera.position.x, t.z + 128 - camera.position.z) > stream.radius || stream.loaded.has(t),
    )
  }, null, { timeout: 120000 })

  // Let KTX2 street tiles, city-upgrade textures & mipmaps settle
  await page.waitForTimeout(1400)

  const afterStats = await sampleSteady(page)
  const afterPng = path.join(OUT_DIR, `${view.id}_${mode.key}_after.png`)
  await page.screenshot({ path: afterPng })

  // Toggle groundUpgrade OFF at the EXACT same frame & camera for pixel-aligned Before shot
  await page.evaluate(() => {
    window.viewer.resume()
    window.__glolGroundUpgrade.setEnabled(false)
  })
  await page.waitForTimeout(350)

  const beforeStats = await sampleSteady(page)
  const beforePng = path.join(OUT_DIR, `${view.id}_${mode.key}_before.png`)
  await page.screenshot({ path: beforePng })

  closing = true
  await ctx.close()

  const dcDelta = afterStats.calls >= 0 && beforeStats.calls >= 0 ? afterStats.calls - beforeStats.calls : null
  metrics.push({
    view: view.id,
    mode: mode.key,
    beforeCalls: beforeStats.calls,
    afterCalls: afterStats.calls,
    dcDelta,
    beforeFps: beforeStats.fps,
    afterFps: afterStats.fps,
  })
  console.log(
    `[shot] ${view.id} (${mode.key}): calls ${beforeStats.calls} -> ${afterStats.calls} (delta ${dcDelta}) | ` +
    `fps ${beforeStats.fps} -> ${afterStats.fps}`,
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

// Stitch side-by-side Before/After sheets and compute quantitative image QA metrics via Python Pillow + NumPy
const pyScript = `
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

out = Path(${JSON.stringify(OUT_DIR)})
views = ${JSON.stringify(VIEWS.map(v => ({ id: v.id, label: v.label, modes: v.modes.map(m => m.key) })))}
font = None
for p in ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc"]:
    if Path(p).exists():
        font = ImageFont.truetype(p, 18)
        break

pixel_report = []
for v in views:
    for mk in v["modes"]:
        b_img = Image.open(out / f"{v['id']}_{mk}_before.png").convert("RGB")
        a_img = Image.open(out / f"{v['id']}_{mk}_after.png").convert("RGB")
        b_arr = np.asarray(b_img, dtype=np.float32)
        a_arr = np.asarray(a_img, dtype=np.float32)
        # Analyze lower 55% of frame (ground / street / bridge / riverbank region)
        h = a_arr.shape[0]
        b_low = b_arr[int(h * 0.45):]
        a_low = a_arr[int(h * 0.45):]
        diff = float(np.mean(np.abs(a_low - b_low)))
        b_luma = float(np.mean(b_low @ np.array([0.2126, 0.7152, 0.0722])))
        a_luma = float(np.mean(a_low @ np.array([0.2126, 0.7152, 0.0722])))
        # Local texture richness: mean absolute horizontal+vertical pixel gradient on lower half
        b_gray = b_low @ np.array([0.2126, 0.7152, 0.0722])
        a_gray = a_low @ np.array([0.2126, 0.7152, 0.0722])
        b_grad = float(np.mean(np.abs(np.diff(b_gray, axis=1))) + np.mean(np.abs(np.diff(b_gray, axis=0))))
        a_grad = float(np.mean(np.abs(np.diff(a_gray, axis=1))) + np.mean(np.abs(np.diff(a_gray, axis=0))))
        # Neon-green guard: fraction of lower pixels with G - max(R, B) > 45
        neon_green_frac = float(np.mean((a_low[:, :, 1] - np.maximum(a_low[:, :, 0], a_low[:, :, 2])) > 45.0))
        # Pure-black ground guard: fraction of lower pixels with all RGB < 8
        dead_black_frac = float(np.mean(np.max(a_low, axis=2) < 8.0))
        pixel_report.append({
            "view": v["id"],
            "mode": mk,
            "meanAbsDiff": round(diff, 2),
            "beforeLuma": round(b_luma, 2),
            "afterLuma": round(a_luma, 2),
            "beforeGrad": round(b_grad, 2),
            "afterGrad": round(a_grad, 2),
            "neonGreenFrac": round(neon_green_frac, 4),
            "deadBlackFrac": round(dead_black_frac, 4),
        })

        b = b_img.resize((720, 405), Image.Resampling.LANCZOS)
        a = a_img.resize((720, 405), Image.Resampling.LANCZOS)
        comp = Image.new("RGB", (1444, 445), (22, 24, 28))
        comp.paste(b, (0, 40))
        comp.paste(a, (724, 40))
        d = ImageDraw.Draw(comp)
        d.rectangle([720, 0, 723, 445], fill=(220, 224, 228))
        mode_zh = "晴午" if mk == "day" else "夜间"
        d.text((14, 8), f"修复前（纯色光板）· {v['label']} [{mode_zh}]", fill=(210, 215, 220), font=font)
        d.text((738, 8), f"修复后（IDOK-432 贴图升级）· {v['label']} [{mode_zh}]", fill=(255, 218, 128), font=font)
        comp.save(out / f"{v['id']}_{mk}_compare.jpg", quality=92)

(out / "pixel_report.json").write_text(json.dumps(pixel_report, indent=2, ensure_ascii=False))
print("PIXEL_QA", json.dumps(pixel_report, ensure_ascii=False))
`

const pyBin = fs.existsSync('/Users/pan-work/guilinol/.venv/bin/python')
  ? '/Users/pan-work/guilinol/.venv/bin/python'
  : 'python3'
const stitch = spawnSync(pyBin, ['-c', pyScript], { stdio: 'inherit' })
if (stitch.status !== 0) {
  console.error('Stitching & pixel QA failed')
  process.exit(1)
}

const pixelReport = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'pixel_report.json'), 'utf8'))
const assertions = []
for (const m of metrics) {
  if (m.dcDelta !== null && m.dcDelta > 0) {
    assertions.push(`DrawCall increased at ${m.view}/${m.mode}: +${m.dcDelta} (expected 0)`)
  }
}
for (const p of pixelReport) {
  if (p.mode === 'day' && p.afterLuma < 35) {
    assertions.push(`Day ground too dark (possible black ground bug) at ${p.view}: luma=${p.afterLuma}`)
  }
  if (p.mode === 'day' && p.meanAbsDiff < 0.8) {
    assertions.push(`No visible ground texture change at ${p.view}/${p.mode}: diff=${p.meanAbsDiff}`)
  }
  if (p.neonGreenFrac > 0.03) {
    assertions.push(`Excessive neon-green pixels at ${p.view}/${p.mode}: frac=${p.neonGreenFrac}`)
  }
  if (p.mode === 'day' && p.deadBlackFrac > 0.04) {
    assertions.push(`Excessive dead-black ground pixels at ${p.view}/${p.mode}: frac=${p.deadBlackFrac}`)
  }
}

const summary = { metrics, pixelReport, consoleErrors, pageErrors, badResponses, assertions }
fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2))
console.log('QA Summary:', JSON.stringify({
  pairs: metrics.length,
  maxDcDelta: Math.max(...metrics.map(m => m.dcDelta ?? 0)),
  consoleErrors: consoleErrors.length,
  pageErrors: pageErrors.length,
  badResponses: badResponses.length,
  assertions: assertions.length,
}))

if (consoleErrors.length || pageErrors.length || badResponses.length || assertions.length) {
  console.error('GROUND TEXTURE QA FAILED:', JSON.stringify(summary, null, 2))
  process.exit(1)
}
