// IDOK-449 acceptance: the shared e-bike mount must become observable in `walk.ebike.state` promptly,
// on 3 consecutive mounts. The bug was intermittent and only visible as a slow mount, so this pins the
// latency instead of just waiting up to a timeout.
//
//   node scripts/verify-shared-ebike-mount.mjs
//   GLOL_CPU_THROTTLE=4 node scripts/verify-shared-ebike-mount.mjs
//
// QA_DIST points at an existing build (e.g. a dist produced with the private module overlay); when it
// is unset the script previews `web/` directly, which is only useful for local debugging.
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {applyCpuThrottle, browserOptions} from './qa-browser.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const ROUNDS = Number(process.env.MOUNT_ROUNDS ?? 3)
// Absolute ceiling: the reported bug was "still not riding after 8s". Keep a wide margin below it so a
// slow-but-passing mount still fails, without turning this into a machine-speed benchmark.
const MAX_MOUNT_MS = 5000

const throttle = Math.max(1, Number(process.env.GLOL_CPU_THROTTLE ?? 1) || 1)
const server = await preview({
  ...(process.env.QA_DIST && {build: {outDir: resolve(process.env.QA_DIST)}}),
  root: resolve(ROOT, 'web'),
  configFile: resolve(ROOT, 'web/vite.config.ts'),
  preview: {host: '127.0.0.1', port: 0},
})
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
let browser

async function waitForWalkReady(page) {
  let lastProgress, lastChange = performance.now()
  const deadline = lastChange + 240000 * throttle
  while (performance.now() < deadline) {
    const state = await page.evaluate(() => {
      const viewer = window.viewer
      return {walking: Boolean(viewer?.walk?.active), game: Boolean(viewer?.game), tour: Boolean(viewer?.tour?.goTo),
        loaded: viewer?.stats?.loaded ?? 0}
    })
    if (state.walking && state.game && state.tour && state.loaded >= 6) return
    const progress = JSON.stringify(state)
    if (progress !== lastProgress) {lastChange = performance.now(); lastProgress = progress}
    if (performance.now() - lastChange > 90000 * throttle) break
    await page.waitForTimeout(500)
  }
  throw Error(`walk startup stalled: ${lastProgress}`)
}

const results = []
try {
  browser = await chromium.launch(browserOptions(true))
  const ctx = await browser.newContext({viewport: {width: 1280, height: 720}})
  await ctx.route('**/api/t', r => r.fulfill({status: 204}))
  // vite preview serves no Functions; the helicopter runtime polls its queue every 2.5s in solo mode.
  await ctx.route('**/api/helicopter', r => r.fulfill({status: 200, contentType: 'application/json',
    body: JSON.stringify({code: 'OK', now: Date.now(), state: 'idle', mine: null, ahead: 0, eta: 0, flight: null})}))
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  await page.route('**/favicon.ico', r => r.fulfill({status: 204}))
  await page.goto(`${baseUrl}/?verify&solo=1&mode=walk&flow=0`)
  await waitForWalkReady(page)
  await page.evaluate(() => window.viewer.game.save.reset(200))
  // Throttle only after the world is up: this test is about the mount, not about boot time.
  await applyCpuThrottle(page)

  let expectedMoney = 200
  for (let round = 1; round <= ROUNDS; round++) {
    const target = await page.evaluate(() => {
      const list = window.viewer.walk.parked('bike')
      if (!list.length) return null
      list.sort((a, b) => Math.hypot(a[0] + 539, a[2] + 95) - Math.hypot(b[0] + 539, b[2] + 95))
      return list[0]
    })
    assert.ok(target, 'no parked shared e-bike to mount')

    let promptReady = false
    let lastDump = null
    for (let attempt = 0; attempt < 5 && !promptReady; attempt++) {
      assert(await page.evaluate(([b, r]) => window.viewer.walkTo(b[0], b[2], 0, `e2e-mount-bike-${r}`), [target, round]))
      // Landing on a landmark opens a spot card, and an open overlay blocks the [F] arbiter.
      await page.evaluate(() => document.querySelector('.spot-card.show .card-close')?.click())
      try {
        await page.waitForFunction(() => document.querySelector('.vehicle-action')?.dataset.interactAction === 'mount_vehicle', null, {timeout: 4000})
        promptReady = true
      } catch {
        lastDump = await page.evaluate(() => {
          const el = document.querySelector('.vehicle-action')
          const d = window.viewer.walk.getInteractDecision?.()
          const p = window.viewer.walk.position
          return {
            pos: [Math.round(p.x), Math.round(p.z)], vehicle: window.viewer.walk.vehicle,
            action: el?.dataset.interactAction ?? null, hidden: el?.hidden ?? null, text: el?.textContent ?? null,
            decision: d ? {priority: d.priority, action: d.action, label: d.label} : null,
            parkedNear: window.viewer.walk.parked('bike')
              .map(b => Math.round(Math.hypot(b[0] - p.x, b[2] - p.z))).sort((a, b) => a - b).slice(0, 3),
          }
        })
      }
    }
    assert.ok(promptReady, `round ${round}: shared e-bike mount prompt never appeared ${JSON.stringify(lastDump)}`)

    const before = await page.evaluate(() => window.viewer.game.getState().money)
    const pressedAt = Date.now()
    await page.keyboard.press('KeyF')
    let mounted = false
    let mountDump = null
    try {
      await page.waitForFunction(() => window.viewer.walk.vehicle === 'bike' && window.viewer.walk.ebike.state !== null, null, {timeout: 8000})
      mounted = true
    } catch {
      mountDump = await page.evaluate(() => ({
        vehicle: window.viewer.walk.vehicle,
        ebikeState: window.viewer.walk.ebike.state === null ? null : 'present',
        flow: window.viewer.walk.probe?.().twoWheelFlow ?? null,
        money: window.viewer.game.getState().money,
        action: document.querySelector('.vehicle-action')?.dataset.interactAction ?? null,
        text: document.querySelector('.vehicle-action')?.textContent ?? null,
      }))
    }
    assert.ok(mounted, `round ${round}: riding state not observable 8s after F ${JSON.stringify(mountDump)}`)
    const mountMs = Date.now() - pressedAt
    assert.ok(mountMs < MAX_MOUNT_MS, `round ${round}: shared e-bike mount became observable only after ${mountMs}ms (limit ${MAX_MOUNT_MS}ms)`)

    const fee = await page.evaluate(() => window.viewer.game.getState().money) - before
    assert.equal(fee, -2, `round ${round}: mounting a shared e-bike must charge exactly ¥2`)
    expectedMoney = before + fee
    results.push({round, mountMs, fee})
    console.log(`PASS shared-ebike mount ${round}/${ROUNDS}`, JSON.stringify({mountMs, fee}))

    // Dismount so the next round starts from foot. The arbiter may still be busy right after mounting,
    // so retry until the walker is back on foot.
    let dismounted = false
    for (let attempt = 0; attempt < 20 && !dismounted; attempt++) {
      await page.evaluate(() => window.viewer.walk.shop.triggerInteract())
      try {
        await page.waitForFunction(() => window.viewer.walk.vehicle === 'foot', null, {timeout: 2000})
        dismounted = true
      } catch {}
    }
    assert.ok(dismounted, `round ${round}: could not dismount the shared e-bike`)
  }

  assert.equal(expectedMoney, 200 - ROUNDS * 2, `each shared e-bike mount must charge ¥2 (${ROUNDS} mounts)`)
  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`)
  console.log(`ALL ${ROUNDS} SHARED-E-BIKE MOUNT ROUNDS PASSED`, JSON.stringify({
    throttle, mounts: results,
  }))
} finally {
  await browser?.close()
  server.httpServer.close()
}
