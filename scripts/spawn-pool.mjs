// IDOK-105: per-slot opening-frame captures + acceptance checks for the random opening and
// "回到上次离开的地方" restore.
//   node scripts/spawn-pool.mjs            → shoot all 8 slots to captures/spawn-<id>.png
//   node scripts/spawn-pool.mjs --check    → the four assertions below (no images)
//   node scripts/spawn-pool.mjs N NE S     → shoot a subset
//
// --check runs against vite preview, stubbing /api/me per test so a real sign-in happens without a
// backend. Assertions:
//  1. every slot is level — camera right-vector |right.y| < 0.001. This catches a lookAt()/rotation
//     set before flight() assigns rotation.order='YXZ', which leaves a permanent roll.
//  2. restore path goes through the real chain (stored view → plain `/` → `.home-resume` click →
//     consumeRestore → main.ts) and lands within 1 m / 1°.
//  3. plain 「开始游览」 lands on a spawnPool slot, and two visits in a row differ.
//  4. `?verify` in a fresh context never writes glol.lastView, even past the 15 s throttle and after
//     visibilitychange→hidden / pagehide.
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

// Signed-in member without a backend: account.ts only needs /api/me to answer.
const ACCOUNT = { email: 'walker@example.test', nickname: '漓江访客', notify_email: false }
const signIn = (context) =>
  context.route('**/api/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ACCOUNT) }),
  )

// A FeedbackView built the way validView() expects (ll2xz round-trips within 1 m of x/z).
const viewFixture = ({ x = 120, y = 380, z = -1400, yaw = -40, pitch = -25, fov = 55 } = {}) => {
  const metresLatitude = 110574
  const metresLongitude = 111320 * Math.cos((25.28 * Math.PI) / 180)
  return {
    mode: 'fly', x, y, z,
    lat: 25.28 - z / metresLatitude,
    lon: 110.3 + x / metresLongitude,
    alt: y, yaw, pitch, heading: (360 - yaw) % 360, fov,
    target: null, landmark_id: null, build: '0'.repeat(40),
  }
}

let browser
try {
  browser = await chromium.launch(browserOptions())

  if (check) {
    // --- 1. every slot is level -------------------------------------------------------------
    const levelContext = await browser.newContext({ viewport: { width: 960, height: 540 } })
    const slotIds = await (async () => {
      const page = await levelContext.newPage()
      await page.goto(origin + '/?verify&slot=NE&flow=0')
      await page.waitForFunction(() => window.viewer?.stats.firstMs > 0)
      return page.evaluate(() => window.viewer.spawnPool.map((slot) => slot.id))
    })()
    for (const id of slotIds) {
      const page = await levelContext.newPage()
      await page.goto(`${origin}/?verify&slot=${id}&flow=0`)
      await page.waitForFunction(() => window.viewer?.stats.firstMs > 0)
      const rightY = await page.evaluate(() => {
        const { camera } = window.viewer
        camera.updateMatrixWorld()
        return camera.matrixWorld.elements[1] // column 0 (right vector), y component
      })
      assert(Math.abs(rightY) < 0.001, `slot ${id} is rolled: right.y=${rightY.toFixed(4)}`)
      await page.close()
    }
    console.log(`all ${slotIds.length} slots level (|right.y| < 0.001)`)
    await levelContext.close()

    // --- 2. restore through the real path ---------------------------------------------------
    const restoreContext = await browser.newContext({ viewport: { width: 960, height: 540 } })
    await signIn(restoreContext)
    const restore = await restoreContext.newPage()
    const fixture = viewFixture()
    await restore.goto(origin + '/')
    await restore.evaluate((view) => {
      localStorage.setItem('glol.lastView', JSON.stringify({ t: Date.now(), v: view }))
    }, fixture)
    await restore.reload()
    await restore.locator('.home-resume:not([hidden])').waitFor({ timeout: 60000 })
    await restore.locator('.home-resume').click()
    await restore.waitForFunction(() => window.viewer?.stats.firstMs > 0, null, { timeout: 120000 })
    const landed = await restore.evaluate(() => {
      const { camera } = window.viewer
      const deg = (rad) => (rad * 180) / Math.PI
      return { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: deg(camera.rotation.y), pitch: deg(camera.rotation.x) }
    })
    const distance = Math.hypot(landed.x - fixture.x, landed.y - fixture.y, landed.z - fixture.z)
    const angleOff = Math.max(Math.abs(landed.yaw - fixture.yaw), Math.abs(landed.pitch - fixture.pitch))
    assert(distance < 1, `restore drifted ${distance.toFixed(2)} m`)
    assert(angleOff < 1, `restore angle off by ${angleOff.toFixed(2)}°`)
    console.log(`restore within ${distance.toFixed(3)} m / ${angleOff.toFixed(3)}°`)
    await restoreContext.close()

    // --- 3. plain play lands on a pool slot, and changes between visits ---------------------
    const playContext = await browser.newContext({ viewport: { width: 960, height: 540 } })
    await signIn(playContext)
    const play = await playContext.newPage()
    const landings = []
    for (let visit = 0; visit < 2; visit++) {
      await play.goto(origin + '/')
      await play.getByRole('button', { name: /开始游览|继续游览/ }).first().click()
      await play.waitForFunction(() => window.viewer?.stats.firstMs > 0, null, { timeout: 120000 })
      landings.push(
        await play.evaluate(() => {
          const { camera } = window.viewer
          let best = null
          for (const slot of window.viewer.spawnPool) {
            const d = Math.hypot(slot.eye[0] - camera.position.x, slot.eye[1] - camera.position.y, slot.eye[2] - camera.position.z)
            if (!best || d < best.d) best = { id: slot.id, d }
          }
          return best
        }),
      )
    }
    assert(landings[0].d < 1 && landings[1].d < 1, `plain play did not land on a pool slot: ${JSON.stringify(landings)}`)
    assert.notEqual(landings[0].id, landings[1].id, `two visits landed on the same slot (${landings[0].id})`)
    console.log(`consecutive visits landed on ${landings[0].id} then ${landings[1].id}`)
    await playContext.close()

    // --- 4. ?verify never writes the record, even after the real save triggers -------------
    const cleanContext = await browser.newContext({ viewport: { width: 960, height: 540 } })
    const clean = await cleanContext.newPage()
    await clean.goto(origin + '/?verify&slot=NE&flow=0')
    await clean.waitForFunction(() => window.viewer?.stats.firstMs > 0)
    await clean.waitForTimeout(16000) // past the 15 s write throttle
    await clean.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('pagehide'))
    })
    await clean.waitForTimeout(1500)
    const wrote = await clean.evaluate(() => localStorage.getItem('glol.lastView') !== null)
    assert(!wrote, '?verify session must not persist glol.lastView')
    console.log('?verify left no glol.lastView (after 16 s + pagehide)')
    await cleanContext.close()

    console.log('spawn-pool checks passed')
  } else {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const slotIds = await (async () => {
      const page = await context.newPage()
      await page.goto(origin + '/?verify&slot=NE&flow=0')
      await page.waitForFunction(() => window.viewer?.stats.firstMs > 0)
      return page.evaluate(() => window.viewer.spawnPool.map((slot) => slot.id))
    })()
    const ids = picked.length ? picked : slotIds
    for (const id of ids) {
      if (!slotIds.includes(id)) throw Error(`unknown slot ${id}`)
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
