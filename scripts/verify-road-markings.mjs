#!/usr/bin/env node
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {resolve, join} from 'node:path'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const distRoot = process.env.GLOL_VERIFY_ROOT ? resolve(process.env.GLOL_VERIFY_ROOT) : process.cwd()
const outDir = process.env.MARKING_SHOT_DIR ? resolve(process.env.MARKING_SHOT_DIR) : '/tmp/glol-markings-shots'
await mkdir(outDir, {recursive: true})

const SHOTS = [
  // 1. Zhongshan Middle Rd (paired 4+4 carriageway, planter avoidance mid-block, arrows/stop lines)
  {id: '01-zhongshan-mid-driver', cx: -926, cz: -12, ch: 4.2, tx: -904, tz: -80, th: 0.6, roadCheck: [-916, -42]},
  {id: '02-zhongshan-mid-top', cx: -928, cz: -10, ch: 75, tx: -928, tz: -11, th: 0, roadCheck: [-916, -42]},
  // 2. Shizijie Crossroads (ban surface crosswalks inside core, keep stop bars/arrows/red-yellow waiting zones)
  {id: '03-shizijie-top', cx: -880, cz: -169, ch: 82, tx: -880, tz: -170, th: 0, roadCheck: [-910, -176]},
  {id: '04-shizijie-approach', cx: -928, cz: -178, ch: 4.5, tx: -880, tz: -169, th: 0.5, roadCheck: [-910, -176]},
  // 3. Jiefang W Rd (Guilin Middle school gate yellow grid + divided 3+3 lanes)
  {id: '05-jiefang-w-top', cx: -1245, cz: -238, ch: 72, tx: -1245, tz: -239, th: 0, roadCheck: [-1235, -236]},
  // 4. Jiefang E Rd (divided primary corridor & crosswalks)
  {id: '06-jiefang-e-driver', cx: -560, cz: -92, ch: 4.2, tx: -620, tz: -110, th: 0.5, roadCheck: [-580, -98]},
  // 5. Jiefang Bridge West Portal (ramp approaches outside GLB keepout)
  {id: '07-jiefang-bridge-w-top', cx: -435, cz: -55, ch: 78, tx: -435, tz: -56, th: 0, roadCheck: [-450, -56]},
  // 6. Lijiang Rd (was almost unmarked: now dual 3-lane main + aux frontage bike lanes + bus stop bays)
  {id: '08-lijiang-driver', cx: 880, cz: 1897, ch: 4.2, tx: 950, tz: 1896, th: 0.5, roadCheck: [893, 1897]},
  {id: '09-lijiang-top', cx: 903, cz: 1897, ch: 76, tx: 903, tz: 1896, th: 0, roadCheck: [893, 1897]},
  // 7. Qixing Rd (Park bus stop + divided 3+3 + k5 cycleways)
  {id: '10-qixing-top', cx: 165, cz: 146, ch: 78, tx: 165, tz: 145, th: 0, roadCheck: [165, 146]},
  // 8. Binjiang Rd (one-way 4 lanes + both cycleways)
  {id: '11-binjiang-top', cx: -480, cz: 348, ch: 70, tx: -480, tz: 347, th: 0, roadCheck: [-480, 348]},
  // 9. Rongyin Rd Kuiguang School Gate (upgraded draped yellow no-parking mesh box)
  {id: '12-kuiguang-school-top', cx: -1362, cz: 4, ch: 56, tx: -1362, tz: 3, th: 0, roadCheck: [-1365, 8]},
  {id: '13-kuiguang-driver', cx: -1370, cz: 32, ch: 4.0, tx: -1350, tz: -20, th: 0.5, roadCheck: [-1355, -6]},
  // 10. Lequn / Two-way Secondary & Residential streets
  {id: '14-lequn-secondary-top', cx: -1035, cz: -452, ch: 68, tx: -1035, tz: -453, th: 0, roadCheck: [-1035, -452]},
]

const server = await preview({
  configFile: false,
  root: distRoot,
  build: {outDir: join(distRoot, 'dist')},
  preview: {host: '127.0.0.1', port: 0},
})
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
let browser
const errors = []
const failed404 = []

try {
  browser = await chromium.launch(browserOptions(true))
  const page = await browser.newPage({viewport: {width: 1280, height: 720}})
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`))
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.location().url}: ${msg.text()}`)
  })
  page.on('response', res => {
    if (res.status() === 404 && !res.url().includes('favicon.ico')) {
      failed404.push(`${res.status()} ${res.url()}`)
    }
  })
  await page.route('**/favicon.ico', route => route.fulfill({status: 204}))
  await page.route('**/api/t', route => route.fulfill({status: 204}))
  await page.route('**/stats.rcpd.cc/**', route => route.fulfill({status: 204, body: ''}))

  await page.goto(`${baseUrl}/?verify&radius=280&time=10.5`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  })
  await page.waitForFunction(
    () => window.viewer?.stats?.firstMs > 0 && window.viewer?.stream && window.viewer?.manifest,
    null,
    {timeout: 120000},
  )
  // Hide HTML UI overlays cleanly while keeping WebGL canvas untouched
  await page.evaluate(() => {
    for (const el of document.body.children) {
      if (el.tagName !== 'CANVAS') el.style.display = 'none'
    }
  })

  const results = []
  for (const shot of SHOTS) {
    // Move camera near target so streaming prioritizes local chunks, then wait until ALL in-radius chunks load
    await page.evaluate(({x, z}) => {
      const {camera, stream} = window.viewer
      camera.position.set(x, 175, z + 1)
      camera.lookAt(x, 150, z)
      camera.updateMatrixWorld()
      stream.tick(camera.position)
    }, {x: shot.tx, z: shot.tz})

    await page.waitForFunction(() => {
      const v = window.viewer
      const {stats, stream, camera, manifest} = v
      stream.tick(camera.position)
      return !stats.pending && !stream.pending.size && stream.queuedTiles === 0 &&
        manifest.chunks.every(t => Math.hypot(t.x + 128 - camera.position.x, t.z + 128 - camera.position.z) > stream.radius || stream.loaded.has(t))
    }, null, {timeout: 120000})

    const metrics = await page.evaluate(async s => {
      const {camera, stream, stats, redrawGfx} = window.viewer
      const sceneRoot = stream.batches?.scene ?? stream.scene
      const groundAt = (x, z) => {
        let sum = 0, cnt = 0, bestD = 99, bestY = 152
        sceneRoot?.traverse?.(obj => {
          const g = obj.geometry
          if (!obj.visible || !g) return
          const pos = g.getAttribute('position')
          const aSurf = g.getAttribute('aSurface')
          if (!pos || !aSurf) return
          obj.updateWorldMatrix(true, false)
          const m = obj.matrixWorld.elements
          const step = Math.max(1, Math.floor(pos.count / 45000))
          for (let i = 0; i < pos.count; i += step) {
            if (Math.round(aSurf.getX(i)) !== 0) continue
            const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i)
            const wx = m[0] * px + m[4] * py + m[8] * pz + m[12]
            const wz = m[2] * px + m[6] * py + m[10] * pz + m[14]
            const d = Math.hypot(wx - x, wz - z)
            if (d > 30) continue
            const wy = m[1] * px + m[5] * py + m[9] * pz + m[13]
            if (d < 8) { sum += wy; cnt++ }
            if (d < bestD) { bestD = d; bestY = wy }
          }
        })
        if (cnt > 0) return sum / cnt
        if (bestD < 30) return bestY
        return 152
      }
      const gy = groundAt(s.tx, s.tz)
      const cy = groundAt(s.cx, s.cz)
      camera.position.set(s.cx, cy + s.ch, s.cz)
      camera.lookAt(s.tx, gy + s.th, s.tz)
      camera.updateMatrixWorld()
      stream.tick(camera.position)
      redrawGfx?.()
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))))

      // Sample rendered surface colors on streets batch meshes in stream.scene / batches.scene
      let whiteVerts = 0, yellowVerts = 0, otherMarkVerts = 0
      const seenGeo = new Set()
      sceneRoot?.traverse?.(obj => {
        const g = obj.geometry
        if (!obj.visible || !g || seenGeo.has(g)) return
        const aSurf = g.getAttribute('aSurface')
        const col = g.getAttribute('color')
        if (!aSurf || !col) return
        seenGeo.add(g)
        const n = Math.min(aSurf.count, col.count)
        for (let i = 0; i < n; i++) {
          if (Math.round(aSurf.getX(i)) !== 2) continue
          const r = col.getX(i), gr = col.getY(i), b = col.getZ(i)
          if (r > 0.65 && gr > 0.65 && b > 0.55) whiteVerts++
          else if (r > 0.60 && gr > 0.35 && b < 0.12) yellowVerts++
          else otherMarkVerts++
        }
      })

      return {
        id: s.id,
        cy: Number(cy.toFixed(2)),
        gy: Number(gy.toFixed(2)),
        calls: stats.calls,
        triangles: stats.triangles,
        whiteVerts,
        yellowVerts,
        otherMarkVerts,
      }
    }, shot)

    await page.screenshot({path: join(outDir, `${shot.id}.png`), timeout: 60000})
    results.push(metrics)
    console.log('SHOT', JSON.stringify(metrics))
    assert.ok(metrics.whiteVerts > 0, `${shot.id} must render white markings`)
    assert.ok(metrics.yellowVerts > 0, `${shot.id} must render yellow markings`)
  }

  console.log(`\nCaptured ${results.length} screenshots -> ${outDir}`)
  assert.deepEqual(failed404, [], `Unexpected 404 responses: ${failed404.join(', ')}`)
  assert.deepEqual(errors, [], `Console/page errors: ${errors.join('; ')}`)
} finally {
  await browser?.close()
  server.httpServer.close()
}
