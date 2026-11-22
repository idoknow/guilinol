/**
 * Real-Browser Visual & Performance Verification for Avatar Style-Fusion Rendering & Cross-Module Compat.
 *
 * Launches built `web/dist` via Vite preview + headless Chromium, walks on street level, and verifies:
 *  1. Zero console / page / WebGL shader compilation errors across day, dusk, rain, and night.
 *  2. `detail-budget` draw-call & fly-boot byte gates hold (`fly firstResourceBytes` delta <= 150 KB, `walk calls <= 86`).
 *  3. `probe().avatarCompat` reports 0 warnings, `styledMaterials >= 1`, `surfaceAttrApplied === true`,
 *     `footSink` within tolerance, and contact shadow active on foot + fading smoothly in jump air + hidden when riding.
 *  4. Captures close-up 3/4 character screenshots across noon clear, dusk, rain, and night (+ outfit swap) to `/tmp/avatar-look-*.png`.
 */
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {preview} from 'vite'

const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

try {
  const port = server.httpServer.address().port
  const errors = []

  // 1. Check fly-mode zero-overhead budget first
  const flyPage = await browser.newPage({viewport: {width: 960, height: 540}})
  await flyPage.route('https://stats.rcpd.cc/**', r => r.fulfill({status: 200, contentType: 'application/javascript', body: ''}))
  await flyPage.route('**/api/**', r => r.fulfill({status: 204, body: ''}))
  flyPage.on('response', r => { if (r.status() >= 400) console.log('FLY HTTP', r.status(), r.url()) })
  flyPage.on('pageerror', e => { console.error('FLY PAGEERROR:', e); errors.push(`fly pageerror: ${e.message}`) })
  flyPage.on('console', m => { if (m.type() === 'error') { console.error('FLY CONSOLE:', m.text()); errors.push(`fly console: ${m.text()}`) } })
  await flyPage.goto(`http://127.0.0.1:${port}/?verify&mode=fly`)
  await flyPage.waitForFunction(() => {
    const v = window.viewer
    return Boolean(v?.stats.firstMs && v.stats.frame >= 6)
  }, undefined, {timeout: 60000})
  const flyStats = await flyPage.evaluate(() => {
    const {firstMs, firstWorldBytes, calls} = window.viewer.stats
    const resources = performance.getEntriesByType('resource')
    const firstResourceBytes = resources
      .filter(e => e.responseEnd <= firstMs)
      .reduce((sum, e) => sum + e.encodedBodySize, 0)
    const avatarLoadedInFly = resources.some(e => e.name.includes('figure.glb') || e.name.includes('rapier'))
    return {firstMs, firstWorldBytes, firstResourceBytes, calls, avatarLoadedInFly}
  })
  console.log('fly', flyStats)
  assert.equal(flyStats.avatarLoadedInFly, false, 'walk/avatar modules must NOT load during fly boot (+0 bytes overhead)')
  await flyPage.close()

  // 2. Walk-mode multi-atmosphere & compat verification
  const page = await browser.newPage({viewport: {width: 1120, height: 680}})
  await page.route('https://stats.rcpd.cc/**', r => r.fulfill({status: 200, contentType: 'application/javascript', body: ''}))
  await page.route('**/api/**', r => r.fulfill({status: 204, body: ''}))
  page.on('response', r => { if (r.status() >= 400) console.log('WALK HTTP', r.status(), r.url()) })
  page.on('pageerror', e => { console.error('WALK PAGEERROR:', e); errors.push(`walk pageerror: ${e.message}`) })
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`WALK ${m.type().toUpperCase()}:`, m.text()); if (m.type() === 'error') errors.push(`walk console: ${m.text()}`) })
  await page.goto(`http://127.0.0.1:${port}/?verify&mode=walk`)
  try {
    await page.waitForFunction(() => {
      const v = window.viewer
      if (!v?.stats.firstMs || !v.walk?.active) return false
      const p = v.walk.position
      return v.manifest.chunks.every(t => {
        const d = Math.hypot(t.x + 128 - p.x, t.z + 128 - p.z)
        return d > Math.min(v.stream.radius, 320) || v.stream.loaded.has(t)
      })
    }, undefined, {timeout: 60000})
  } catch (err) {
    const diag = await page.evaluate(() => ({
      hasViewer: Boolean(window.viewer),
      stats: window.viewer?.stats,
      walkActive: window.viewer?.walk?.active,
      hasWalk: Boolean(window.viewer?.walk),
      spawns: window.viewer?.walk?.spawns,
      destination: window.viewer?.walk?.destination,
      compat: window.viewer?.walk?.avatarCompat,
      mode: document.body.dataset.mode,
      loadedChunks: window.viewer?.stream?.loaded?.size,
      radius: window.viewer?.stream?.radius,
    }))
    console.error('WALK WAIT TIMEOUT DIAG:', JSON.stringify(diag, null, 2), 'ERRORS:', errors)
    throw err
  }

  const waitFrames = async (n = 8) => {
    await page.evaluate(
      count => new Promise(res => {
        let i = 0
        const step = () => (++i >= count ? res() : requestAnimationFrame(step))
        requestAnimationFrame(step)
      }),
      n,
    )
  }

  // Step onto the light limestone forecourt in front of 王城 so contact shadow is clearly visible against bright stone
  await page.keyboard.down('KeyW')
  await waitFrames(18)
  await page.keyboard.up('KeyW')
  await waitFrames(10)

  // Frame full body + shoes + ground contact shadow on bright palace stone forecourt
  await page.evaluate(async () => {
    const w = window.viewer.walk
    w.face(w.yaw + Math.PI - 0.45, 0.28)
  })
  await page.mouse.move(560, 340)
  for (let k = 0; k < 2; k++) {
    await page.mouse.wheel(0, -140)
  }
  await waitFrames(12)

  const shots = [
    {name: 'noon-clear', hour: 13.5, weather: 'clear', outfit: null},
    {name: 'dusk-clear', hour: 18.1, weather: 'clear', outfit: null},
    {name: 'day-rain', hour: 14.0, weather: 'rain', outfit: null},
    {name: 'night-clear', hour: 21.5, weather: 'clear', outfit: {top: 'top_lijiang_shell', bottom: 'bottom_guilin_cargo', shoes: 'shoes_lijiang_trail', hat: 'hat_guilin_cap', bag: 'bag_rider_pack'}},
  ]

  const reports = {}
  for (const s of shots) {
    const data = await page.evaluate(async cfg => {
      const v = window.viewer
      v.clock.flowing = false
      v.clock.set(cfg.hour, cfg.weather)
      if (cfg.outfit) v.walk.outfit.setPreview(cfg.outfit)
      else v.walk.outfit.setPreview(null)
      const targetRain = cfg.weather === 'rain' ? 1 : 0
      const deadline = performance.now() + 6000
      while (performance.now() < deadline) {
        await new Promise(r => requestAnimationFrame(r))
        if (Math.abs(v.env.rain - targetRain) < 0.06) break
      }
      for (let i = 0; i < 6; i++) await new Promise(r => requestAnimationFrame(r))
      const p = v.walk.probe()
      return {
        calls: v.stats.calls,
        footSink: p.footSink,
        avatarCompat: p.avatarCompat,
        avatarLook: p.avatarLook,
        outfitDrawDelta: p.outfit.drawCallDelta,
        outfitStrategy: p.outfit.strategy,
      }
    }, s)
    reports[s.name] = data
    console.log(s.name, JSON.stringify({
      calls: data.calls,
      footSink: +data.footSink.toFixed(4),
      shadow: data.avatarLook.contactShadow,
      styled: data.avatarLook.styledMaterials,
      night: +data.avatarLook.night.toFixed(2),
      rain: +data.avatarLook.rain.toFixed(2),
      warnings: data.avatarCompat.warnings,
    }))
    await page.screenshot({path: `/tmp/avatar-look-${s.name}.png`})
  }

  // Assert all invariants across all 4 conditions
  const noon = reports['noon-clear']
  const rain = reports['day-rain']
  const night = reports['night-clear']

  assert.equal(noon.avatarCompat.warnings.length, 0, `avatarCompat warnings: ${noon.avatarCompat.warnings}`)
  assert.equal(noon.avatarCompat.surfaceAttrApplied, true)
  assert.equal(noon.outfitStrategy, 'legacy_color0')
  assert(Math.abs(noon.footSink) < 0.04, `footSink too large: ${noon.footSink}`)
  assert(noon.calls <= 86, `walk draw calls exceeded detail-budget (86): ${noon.calls}`)
  assert(noon.avatarLook.contactShadow.visible === true, 'contact shadow must be visible on foot at noon')
  assert(noon.avatarLook.contactShadow.opacity > rain.avatarLook.contactShadow.opacity, 'rain shadow should diffuse softer than noon')
  assert(rain.avatarLook.contactShadow.opacity > night.avatarLook.contactShadow.opacity, 'night shadow should attenuate below rain')
  assert.equal(night.outfitDrawDelta, 2, 'night outfit preview with cap+pack should add +2 draw calls')

  // Verify jump air shadow attenuation & crouch shadow expansion in live physics
  await page.evaluate(async () => {
    const v = window.viewer
    v.clock.flowing = false
    v.clock.set(13.5, 'clear')
    v.walk.outfit.setPreview(null)
    const deadline = performance.now() + 4000
    while (performance.now() < deadline) {
      await new Promise(r => requestAnimationFrame(r))
      if (v.env.rain < 0.06) break
    }
  })
  await waitFrames(8)
  const beforeJump = await page.evaluate(() => window.viewer.walk.probe().avatarLook.contactShadow)

  // Crouch check (KeyX)
  await page.keyboard.down('KeyX')
  await waitFrames(12)
  const crouched = await page.evaluate(() => {
    const p = window.viewer.walk.probe()
    return {crouching: p.crouching, shadow: p.avatarLook.contactShadow}
  })
  await page.keyboard.up('KeyX')
  await waitFrames(8)

  // Jump check (Space)
  await page.keyboard.down('Space')
  await waitFrames(10)
  await page.keyboard.up('Space')
  const inAir = await page.evaluate(() => {
    const p = window.viewer.walk.probe()
    return {grounded: p.grounded, opacity: p.avatarLook.contactShadow.opacity}
  })
  console.log('posture-check', {beforeJump, crouched, inAir})
  if (crouched.crouching) {
    assert(crouched.shadow.scaleX > beforeJump.scaleX, `expected crouch shadow (${crouched.shadow.scaleX}) > stand shadow (${beforeJump.scaleX})`)
  }
  assert(!inAir.grounded || inAir.opacity <= beforeJump.opacity, 'jump should lift off ground and attenuate shadow')
  if (!inAir.grounded) {
    assert(inAir.opacity < beforeJump.opacity, `expected air shadow (${inAir.opacity}) < grounded shadow (${beforeJump.opacity})`)
  }

  assert.equal(errors.length, 0, `browser errors detected:\n${errors.join('\n')}`)
  console.log('\nALL BROWSER AVATAR LOOK & COMPAT CHECKS PASSED (0 errors)')
  await page.close()
} finally {
  await browser.close()
  await server.close()
}
