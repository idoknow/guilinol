// Drive the northbound Zhongshan South Road carriageway past the station frontage.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { chromium } from 'playwright'
import { preview } from 'vite'
import { browserOptions } from './qa-browser.mjs'

const server = await preview({
  configFile: false,
  build: { outDir: resolve(process.argv[2] ?? 'dist') },
  preview: { host: '127.0.0.1', port: 0 },
})
const browser = await chromium.launch(browserOptions(true))
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } })
  // The world and motor mask remain the shipped inputs. Seed one pickup on
  // the carriageway so the same wheel path is available on both builds.
  await page.route('**/world/vehicles.bin', async (route) => {
    const response = await route.fetch()
    const data = JSON.parse(gunzipSync(await response.body()))
    data.cars.unshift([-2069.6, 154.7, 1815.7, 0.026, 0])
    await route.fulfill({ response, body: gzipSync(JSON.stringify(data)) })
  })
  await page.goto(
    'http://127.0.0.1:' +
      server.httpServer.address().port +
      '/?verify&mode=walk&traffic=1&flow=0&time=12',
  )
  await page.waitForFunction(() => window.viewer?.walk?.active)
  assert(
    await page.evaluate(async () => {
      const { walk } = window.viewer
      walk.leave()
      return walk.enter(-2069.6, 1815.7, 0.026, 'station-drive')
    }),
  )
  await page.waitForFunction(
    () => document.querySelector('.vehicle-action')?.textContent === '开车',
  )
  await page.keyboard.press('f')
  await page.waitForFunction(
    () =>
      window.viewer.walk.vehicle === 'car' &&
      window.viewer.trafficProbe?.allMotors?.length,
  )
  const result = await page.evaluate(async () => {
    const { walk } = window.viewer
    const initial = [...walk.position.toArray(), walk.heading]
    const motors = window.viewer.trafficProbe.allMotors.length
    const route = [
      [-2070.5, 1782],
      [-2069.3, 1752],
      [-2066, 1724],
      [-2058, 1686],
    ]
    const pressed = new Set()
    function key(code, on) {
      if (pressed.has(code) === on) return
      window.dispatchEvent(
        new KeyboardEvent(on ? 'keydown' : 'keyup', { code }),
      )
      if (on) pressed.add(code)
      else pressed.delete(code)
    }
    try {
      for (const [east, south] of route) {
        let arrived = false
        const deadline = performance.now() + 25000
        while (performance.now() < deadline) {
          const dx = east - walk.position.x,
            dz = south - walk.position.z
          if (Math.hypot(dx, dz) < 3) {
            arrived = true
            break
          }
          const diff = Math.atan2(-dx, -dz) - walk.heading
          const turn = Math.atan2(Math.sin(diff), Math.cos(diff))
          key('KeyA', turn > 0.04)
          key('KeyD', turn < -0.04)
          key('KeyW', Math.abs(walk.speed) < (Math.abs(turn) > 0.35 ? 2.8 : 5))
          await new Promise(requestAnimationFrame)
          const probe = walk.probe()
          if (probe.resets || probe.inHouse || probe.renderClearance < -0.6)
            throw Error('Unsafe station drive ' + JSON.stringify(probe))
        }
        if (!arrived)
          throw Error(
            'Station drive stopped ' +
              JSON.stringify({
                target: [east, south],
                initial,
                position: walk.position.toArray(),
                obstacle: walk.obstacle, hits:walk.probe().hits, contacts:walk.probe().contactSources,
              }),
          )
      }
      return { checkpoints: route.length, motors, end: walk.position.toArray() }
    } finally {
      for (const code of pressed) key(code, false)
    }
  })
  console.log(JSON.stringify(result))
} finally {
  await browser.close()
  await server.close()
}
