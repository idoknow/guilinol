import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const ROOT = resolve(import.meta.dirname, '../../../..')
const SHOT_DIR = process.env.DRINKS_SHOT_DIR || '/Users/pan-work/z-rubbish/guilinol-drinks-hy3-20261124'
const PEAK_SHOT_PATH = join(SHOT_DIR, 'peak-30-npc.png')

await mkdir(SHOT_DIR, { recursive: true })
const tempDir = await mkdtemp(join(tmpdir(), 'glol-drinks-npc-preview-'))
const entryFile = join(tempDir, 'entry.ts')
const bundleJs = join(tempDir, 'bundle.js')

await writeFile(
  entryFile,
  `
import { mountDrinksNpcPreview } from '${join(ROOT, 'web/src/drinks/npc/preview.ts').replace(/\\/g, '/')}'
const root = document.getElementById('app')!
mountDrinksNpcPreview(root, { width: 1280, height: 720 })
`,
)

await build({
  entryPoints: [entryFile],
  outfile: bundleJs,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'silent',
})

const jsText = await readFile(bundleJs, 'utf8')
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>王城鲜饮旗舰店 · 互动与30人同屏预览</title><style>html,body,#app{margin:0;width:1280px;height:720px;overflow:hidden;background:#d9e5ea}</style></head><body><div id="app"></div><script type="module" src="/bundle.js"></script></body></html>`

const server = createServer((req, res) => {
  if (req.url === '/bundle.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' })
    res.end(jsText)
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  }
})

await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
const addr = server.address()
const url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/`

const useMetal = process.env.QA_NATIVE_GPU === '1' && process.platform === 'darwin'
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM || undefined,
  args: useMetal
    ? ['--enable-gpu', '--use-angle=metal']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction(() => Boolean(window.__drinksNpcPreview))

  // 1. Capture 6 interaction groups
  const interactionSpecs = [
    { id: 'order', file: '01-order-dialogue.png', expectOneOf: ['order_ask', 'make_change', 'order_reply', 'receive_change'] },
    { id: 'handover', file: '02-handover-cup.png', expectOneOf: ['handover_cup', 'receive_cup'] },
    { id: 'call', file: '03-call-lookup.png', expectOneOf: ['call_number', 'look_up_called'] },
    { id: 'complain', file: '04-complain-leave.png', expectOneOf: ['complain_leave'] },
    { id: 'chat', file: '05-chat-pair.png', expectOneOf: ['chat_pair_a', 'chat_pair_b'] },
    { id: 'player_greet', file: '06-player-greet.png', expectOneOf: ['clerk_greet_player', 'remind_cut_in', 'queue_yield_player'] },
  ]

  const scenarioResults = []
  for (const spec of interactionSpecs) {
    const res = await page.evaluate(id => window.__drinksNpcPreview.runScenario(id), spec.id)
    const shotPath = join(SHOT_DIR, spec.file)
    await page.screenshot({ path: shotPath })
    const matched = spec.expectOneOf.some(k => res.matchedKinds.includes(k))
    assert.ok(matched, `scenario ${spec.id} did not produce expected interaction (${spec.expectOneOf.join('|')}); got: ${res.matchedKinds.join(',')}`)
    assert.ok(res.visibleBadgeCount <= 8, `badge cap exceeded in ${spec.id}: ${res.visibleBadgeCount}`)
    scenarioResults.push({ ...res, file: shotPath })
  }

  // 2. Peak 30-NPC screenshot & 60-frame timing benchmark
  const peakRes = await page.evaluate(() => window.__drinksNpcPreview.runScenario('peak_30'))
  const metrics = await page.evaluate(() => window.__drinksNpcPreview.getMetrics())
  const bench = await page.evaluate(() => window.__drinksNpcPreview.measureFrames(60))
  await page.screenshot({ path: PEAK_SHOT_PATH })

  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`)
  assert.equal(metrics.npcLightCount, 0, `NPC renderer must add 0 lights, got ${metrics.npcLightCount}`)
  assert.ok(bench.activeTotal >= 30, `expected >= 30 NPCs on screen at peak, got ${bench.activeTotal}`)
  assert.ok(bench.visibleCount >= 30, `expected >= 30 visible NPC instances, got ${bench.visibleCount}`)
  assert.ok(bench.visibleBadgeCount <= 8, `expected capped bubbles <= 8, got ${bench.visibleBadgeCount}`)

  console.log(
    JSON.stringify(
      {
        peakScreenshot: PEAK_SHOT_PATH,
        peakInitKindsCount: peakRes.matchedKinds.length,
        scenarios: scenarioResults,
        activeTotal: bench.activeTotal,
        visibleCount: bench.visibleCount,
        visibleBadgeCount: bench.visibleBadgeCount,
        clerksCount: bench.clerksCount,
        customersCount: bench.customersCount,
        holdingCupCount: metrics.holdingCupCount,
        seatedCount: metrics.seatedCount,
        dirtySeatsCount: metrics.dirtySeatsCount,
        drawCallLayers: metrics.drawCallLayers,
        rendererDrawCalls: metrics.rendererDrawCalls,
        rendererTriangles: metrics.rendererTriangles,
        npcLightCount: metrics.npcLightCount,
        avgNpcUpdateMs: bench.avgNpcUpdateMs,
        avgFrameMs: bench.avgFrameMs,
        p95FrameMs: bench.p95FrameMs,
        maxFrameMs: bench.maxFrameMs,
        fpsEstimate: bench.fpsEstimate,
      },
      null,
      2,
    ),
  )

  await ctx.close()
} finally {
  await browser.close()
  await new Promise(resolveClose => server.close(resolveClose))
  await rm(tempDir, { recursive: true, force: true })
}
