// IDOK-105: per-slot opening-frame captures + acceptance checks for "回到上次离开的地方".
//   node scripts/spawn-pool.mjs                → shoot all 8 slots to captures/spawn-<id>.png
//   node scripts/spawn-pool.mjs --check        → roundtrip + no-pollution assertions (no images)
//   node scripts/spawn-pool.mjs N NE S         → shoot a subset
//
// The --check cases run against vite preview (no auth backend):
//  1. save → reload(plain) → "回到上次离开的地方" button shows, restore lands within 1 m / 1°.
//     The button visibility and the view roundtrip are exercised here; the final click-through
//     that passes requireUser() is covered by the auth-backed suite (auth-test.mjs pattern) on sg.
//  2. a `?verify` session must not write glol.lastView.
import { browserOptions } from './qa-browser.mjs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { preview } from 'vite'

const check = process.argv.includes('--check')
const picked = process.argv.slice(2).filter((arg) => arg !== '--check')

const server = await preview({ root: 'web', configFile: 'web/vite.config.ts', preview: { host: '127.0.0.1', port: 0 } })
const origin = `http://127.0.0.1:${server.httpServer.address().port}`
const out = 'captures/spawn'
await mkdir(out, { recursive: true })

let browser
try {
  browser = await chromium.launch(browserOptions())
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } })

  const slotIds = (async () => {
    const page = await context.newPage()
    await page.goto(origin + '/?verify&slot=NE&flow=0')
    await page.waitForFunction(() => window.viewer?.stats.firstMs > 0)
    return page.evaluate(() => window.viewer.spawnPool.map((slot) => slot.id))
  })()

  if (check) {
    // 1. Save a pose, reload to a plain visit, confirm the button shows, and the stored view
    //    round-trips through applyLastView within 1 m / 1°.
    const page = await context.newPage()
    await page.goto(origin + '/?verify&slot=NE&flow=0')
    await page.waitForFunction(() => window.viewer?.stats.firstMs > 0)
    const saved = await page.evaluate(() => {
      const { camera } = window.viewer
      camera.position.set(120, 380, -1400); camera.lookAt(-500, 160, -600); camera.updateMatrixWorld()
      return window.viewer.saveLastViewNow().then(() => {
        const { camera } = window.viewer
        return { x: camera.position.x, y: camera.position.y, z: camera.position.z, pitch: camera.rotation.x, yaw: camera.rotation.y, fov: camera.fov }
      })
    })
    // Plain visit: title screen, no login yet. The resume button appears only when a view is stored.
    await page.goto(origin + '/')
    await page.waitForSelector('.home-resume:not([hidden])')
    // Restore the view through the same code path main.ts uses (applyLastView) and measure drift.
    const delta = await page.evaluate((saved) => {
      // Read the stored view and apply it to a throwaway perspective-camera math check via the module
      // is not possible without booting; instead re-enter the engine in a verify session and apply.
      return saved
    }, saved)
    // Re-enter via deep link (skips login, skips random) to measure applyLastView drift precisely.
    await page.goto(origin + '/?verify&slot=NE&flow=0')
    await page.waitForFunction(() => window.viewer?.stats.firstMs > 0)
    const drift = await page.evaluate((saved) => {
      const view = window.viewer.readLastViewNow()
      window.viewer.applyLastViewNow(view)
      const { camera } = window.viewer
      return {
        dist: Math.hypot(camera.position.x - saved.x, camera.position.y - saved.y, camera.position.z - saved.z),
        pitch: Math.abs(camera.rotation.x - saved.pitch),
        yaw: Math.abs(camera.rotation.y - saved.yaw),
      }
    }, saved)
    assert(drift.dist < 1, `restore drifted ${drift.dist.toFixed(2)} m`)
    assert(drift.pitch < 0.018 && drift.yaw < 0.018, `restore angle off by ${(drift.pitch * 180 / Math.PI).toFixed(3)}°/ ${(drift.yaw * 180 / Math.PI).toFixed(3)}°`)
    console.log('restore within', drift.dist.toFixed(3), 'm /', (drift.pitch * 180 / Math.PI).toFixed(3), '°')
    await page.close()

    // 2. A `?verify` session must not write glol.lastView.
    const clean = await context.newPage()
    await clean.goto(origin + '/?verify&slot=NE&flow=0')
    await clean.waitForFunction(() => window.viewer?.stats.firstMs > 0)
    const wrote = await clean.evaluate(() => localStorage.getItem('glol.lastView') !== null)
    assert(!wrote, '?verify session must not persist glol.lastView')
    console.log('?verify session left no glol.lastView')
    await clean.close()
    console.log('spawn-pool checks passed')
  } else {
    const ids = picked.length ? picked : await slotIds
    for (const id of ids) {
      if (!(await slotIds).includes(id)) throw Error(`unknown slot ${id}`)
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(`${origin}/?verify&slot=${id}&flow=0`)
      await page.waitForFunction(() => window.viewer?.stats.firstMs > 0)
      await page.waitForFunction(
        () => {
          const { stats, stream, camera, manifest } = window.viewer
          return !stats.pending && manifest.chunks.every((tile) => Math.hypot(tile.x + 128 - camera.position.x, tile.z + 128 - camera.position.z) > stream.radius || stream.loaded.has(tile))
        },
        null,
        { timeout: 120000 },
      )
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${out}/spawn-${id}.png` })
      const stats = await page.evaluate(() => {
        const { stats } = window.viewer
        return { firstMs: stats.firstMs, firstWorldBytes: stats.firstWorldBytes, loaded: stats.loaded, pending: stats.pending }
      })
      console.log(`spawn-${id}.png firstMs=${stats.firstMs} worldBytes=${stats.firstWorldBytes} chunks=${stats.loaded}/${stats.loaded + stats.pending}`)
      assert.deepEqual(errors, [])
      await page.close()
    }
  }
} finally {
  await browser?.close()
  await server.close()
}
