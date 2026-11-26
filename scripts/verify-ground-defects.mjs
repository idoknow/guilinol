/**
 * Headless Metal Chromium visual & walk-over verification for IDOK-431:
 *  - Captures South Ring / Wenchang Bridge (Image 1) and South Ring / Wenming / Binjiang crosswalk
 *    sidewalk views (Image 2) against built `dist/`.
 *  - Runs real Rapier3D third-person character walk-over tests:
 *      1. Walking straight across the repaired Wenchang Bridge water chasm & north abutment landing
 *         (crossing the z=1024 256m chunk boundary onto the south bank without falling into water or snagging).
 *      2. Walking straight across the repaired South Ring Rd north sidewalk/bike-lane crosswalk notch (02b).
 *      3. Walking straight across the repaired Binjiang Rd north crosswalk sidewalk notch (02c).
 *  - Fails non-zero on any console error, pageerror, HTTP >= 400 response, water fall, or walk snag.
 */
import { chromium } from 'playwright'
import { preview } from 'vite'
import { mkdirSync } from 'node:fs'

const outDir = process.argv[2] || '/tmp/idok431-verify'
mkdirSync(outDir, { recursive: true })

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

const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await ctx.newPage()
await page.route('**/api/**', route => route.fulfill({ status: 204, body: '' }))
await page.route('**/stats.rcpd.cc/**', route => route.fulfill({ status: 204, body: '' }))
await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }))

const consoleErrors = []
const pageErrors = []
const badResponses = []
page.on('pageerror', e => pageErrors.push(e.message))
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('response', r => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`) })

try {
  // Boot in verify flight mode (~20s) and jump straight to South Ring Rd / Wenchang Bridge via viewer.walkTo().
  await page.goto(`${baseUrl}/?verify&flow=0&gfx=mid&time=13.5`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  })
  await page.waitForFunction(
    () => Boolean(typeof window.viewer?.walkTo === 'function' && ![1, 2].includes(window.__loading?.level)),
    null,
    { timeout: 180000 },
  )

  async function waitChunks(cx, cz, radius = 360) {
    await page.waitForFunction(
      ({ cx, cz, radius }) => {
        const v = window.viewer
        if (!v || v.stats.pending) return false
        const r = Math.min(v.stream.radius, radius)
        const near = v.manifest.chunks.filter(t => Math.hypot(t.x + 128 - cx, t.z + 128 - cz) <= r)
        return near.every(t => v.stream.loaded.has(t))
      },
      { cx, cz, radius },
      { timeout: 120000 },
    )
    await page.waitForTimeout(250)
  }

  // ------------------------------------------------------------------
  // 1. Real Rapier3D walk-over tests (bridge chasm + sidewalk notches)
  // ------------------------------------------------------------------
  async function runWalkTest(name, start, dir, seconds, opts) {
    const res = await page.evaluate(async ({ start, dir, seconds }) => {
      const v = window.viewer
      const yaw = Math.atan2(-dir[0], -dir[1])
      const ok = await v.walkTo(start[0], start[1], yaw, 'ground-repair')
      if (!ok || !v.walk?.active) return { entered: false }
      const { walk } = v
      for (let i = 0; i < 6; i++) walk.tick(0.05)
      const p0 = walk.probe()
      walk.drive(dir[0], dir[1], false)
      const steps = Math.round(seconds * 10)
      let minFoot = p0.foot, maxFoot = p0.foot, maxStep = 0
      let waterFallCount = 0, blockedWaterCount = 0, resetsCount = 0, deckFrames = 0
      let prevFoot = p0.foot
      const samples = []
      for (let i = 0; i < steps; i++) {
        walk.tick(0.1)
        const p = walk.probe()
        if (p.foot < minFoot) minFoot = p.foot
        if (p.foot > maxFoot) maxFoot = p.foot
        const dy = Math.abs(p.foot - prevFoot)
        if (dy > maxStep) maxStep = dy
        prevFoot = p.foot
        if (p.resets) resetsCount++
        if (p.blockedWater) blockedWaterCount++
        if (p.wet && p.deck === undefined) waterFallCount++
        if (p.deck !== undefined) deckFrames++
        if (i % 20 === 0 || i === steps - 1) {
          samples.push({
            x: +p.x.toFixed(1),
            foot: +p.foot.toFixed(2),
            z: +p.z.toFixed(1),
            deck: p.deck !== undefined ? +p.deck.toFixed(2) : null,
            wet: !!p.wet,
          })
        }
      }
      walk.drive(0, 0, false)
      const pEnd = walk.probe()
      const dist = Math.hypot(pEnd.x - p0.x, pEnd.z - p0.z)
      return {
        entered: true,
        start: { x: +p0.x.toFixed(1), foot: +p0.foot.toFixed(2), z: +p0.z.toFixed(1) },
        end: { x: +pEnd.x.toFixed(1), foot: +pEnd.foot.toFixed(2), z: +pEnd.z.toFixed(1) },
        dist: +dist.toFixed(1),
        minFoot: +minFoot.toFixed(2),
        maxFoot: +maxFoot.toFixed(2),
        maxStep: +maxStep.toFixed(3),
        waterFallCount,
        blockedWaterCount,
        resetsCount,
        deckFrames,
        samples,
      }
    }, { start, dir, seconds })

    console.log(`WALK [${name}]:`, JSON.stringify(res))
    if (!res.entered) throw new Error(`${name}: failed to enter walk mode at ${start}`)
    if (res.resetsCount > 0) throw new Error(`${name}: walker triggered reset (${res.resetsCount} frames)!`)
    if (res.waterFallCount > 0) throw new Error(`${name}: walker fell into water with no deck (${res.waterFallCount} frames)!`)
    if (res.blockedWaterCount > 0) throw new Error(`${name}: walker was blocked by open water (${res.blockedWaterCount} frames)!`)
    if (res.minFoot < opts.minY) throw new Error(`${name}: minFoot=${res.minFoot} fell below ${opts.minY}!`)
    if (res.dist < opts.minDist) throw new Error(`${name}: distance ${res.dist}m < ${opts.minDist}m (snagged/blocked)!`)
    if (res.maxStep > opts.maxStep) throw new Error(`${name}: vertical jolt maxStep=${res.maxStep}m > ${opts.maxStep}m!`)
    if (opts.requireDeck && res.deckFrames === 0) throw new Error(`${name}: walker never stepped on bridge deck!`)
    if (opts.minEndZ !== undefined && res.end.z < opts.minEndZ) throw new Error(`${name}: end.z=${res.end.z} < ${opts.minEndZ}!`)
  }

  // Test 1: Walk straight across the formerly open water chasm on Wenchang Bridge
  // from north road (-1151.0, 1006.0) SSW (-0.31, +0.95) across z=1024 seam onto south bank (z~1048)
  await runWalkTest('wenchang_bridge_chasm_crossing', [-1151.0, 1006.0], [-0.31, 0.95], 28, {
    minY: 149.7,
    minDist: 36,
    maxStep: 0.45,
    requireDeck: true,
    minEndZ: 1035,
  })

  // Test 2: Walk straight across the repaired Nanhuan Rd north sidewalk/cycle crosswalk notch (02b, User Image 2)
  await runWalkTest('nanhuan_north_sidewalk_notch', [-1149.0, 992.2], [-0.97, -0.23], 10, {
    minY: 149.8,
    minDist: 12,
    maxStep: 0.30,
  })

  // Test 3: Walk straight across the repaired Binjiang Rd north crosswalk notch (02c)
  await runWalkTest('binjiang_north_sidewalk_notch', [-1114.5, 1002.6], [0.96, 0.28], 10, {
    minY: 149.8,
    minDist: 12,
    maxStep: 0.30,
  })

  // ------------------------------------------------------------------
  // 2. Clean static visual verification shots (exact comparison poses)
  // ------------------------------------------------------------------
  const shots = [
    { id: '01_bridge_user_angle', pos: [-1149.5, 153.2, 999.5], look: [-1154.5, 148.0, 1024] },
    { id: '01b_bridge_gap_high', pos: [-1148, 165.0, 992], look: [-1148, 148.0, 1032] },
    { id: '02a_wenming_west_notch', pos: [-1141.5, 152.1, 993.5], look: [-1134, 150.2, 976] },
    { id: '02b_nanhuan_north_notch', pos: [-1145.5, 152.1, 992.5], look: [-1162, 150.2, 990] },
    { id: '02c_binjiang_north_notch', pos: [-1116.5, 152.1, 1001.5], look: [-1103, 150.2, 1005] },
  ]

  for (const s of shots) {
    await page.evaluate(({ pos, look }) => {
      const v = window.viewer
      if (v.walk?.active) v.walk.leave()
      if (typeof v.flight === 'function') v.flight()
      v.camera.position.set(pos[0], pos[1], pos[2])
      v.camera.lookAt(look[0], look[1], look[2])
      v.camera.updateMatrixWorld()
    }, s)
    await waitChunks(s.pos[0], s.pos[2])
    await page.evaluate(({ pos, look }) => {
      const v = window.viewer
      v.camera.position.set(pos[0], pos[1], pos[2])
      v.camera.lookAt(look[0], look[1], look[2])
      v.camera.updateMatrixWorld()
    }, s)
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${outDir}/${s.id}.png` })
    console.log('SHOT:', s.id)
  }

  console.log('SUMMARY:', { consoleErrors: consoleErrors.length, pageErrors: pageErrors.length, badResponses: badResponses.length })
  if (consoleErrors.length || pageErrors.length || badResponses.length) {
    console.error({ consoleErrors, pageErrors, badResponses })
    process.exit(1)
  }
  console.log('VERIFY_GROUND_DEFECTS_PASSED')
} finally {
  await browser.close()
  server.httpServer.close()
}
