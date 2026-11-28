import {telemetryPreview} from './telemetry-preview.mjs'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {preview} from 'vite'

// IDOK-588 地图迷雾冒烟测试：
//   走过的地方在地图上亮着、没走过的压黑；点亮进度写 localStorage；全屏地图图例报「已探明 N km²」。
//   服务端 /api/walk/fog 在本地 preview 里没有后端，必须安静降级（本地照常记、页面不报错）。
const start = performance.now()
const server = await preview({plugins: [telemetryPreview], root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const url = `${base}/?verify&mode=walk&flow=0`
let browser
try {
  browser = await chromium.launch({executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']})
  const page = await browser.newPage({viewport: {width: 1280, height: 720}})
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.route('**/favicon.ico', route => route.fulfill({status: 204}))
  await page.route('**/stats.rcpd.cc/**', route => route.fulfill({status: 204, body: ''}))
  await page.route('**/api/live', route => route.fulfill({status: 200, contentType: 'application/json', body: '{"online":42}'}))
  await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 120000})
  // swiftshader 下首帧/激活 1–7 分钟都可能，必须慢轮询 + 长超时。
  await page.waitForFunction(() => window.viewer?.walk?.active, null, {timeout: 300000, polling: 500})
  await page.waitForFunction(() => typeof window.mapFog?.count === 'function', null, {timeout: 60000, polling: 250})

  // 出生点周围应该已经点亮了几格（走路 tick 每 220 ms 记一次）。
  const born = await page.evaluate(() => ({
    cells: window.mapFog.count(),
    stored: JSON.parse(localStorage.getItem('glol.fog.v1') ?? '[]').length,
    area: window.mapFog.area(),
  }))
  assert.ok(born.stored > 0, 'walking should already have revealed the spawn cell')
  assert.equal(born.cells, born.stored, 'memory and localStorage agree')
  console.log('spawn reveal', JSON.stringify(born))

  // 点亮一格 800 m 外的地方 → 计数和面积都要往上走。
  const grown = await page.evaluate(() => {
    const w = window.viewer.walk.position
    const added = window.mapFog.reveal(w.x + 800, w.z)
    return {added, cells: window.mapFog.count(), area: window.mapFog.area()}
  })
  assert.equal(grown.added, 1, 'revealing an unvisited cell adds exactly one')
  assert.equal(grown.cells, born.cells + 1)
  assert.ok(grown.area > born.area)
  console.log('revealed far cell', JSON.stringify(grown))

  // 全屏地图：图例要有「已探明 N km²」，画面上要同时存在压黑与点亮的像素。
  // 点小地图圆盘开图（M 会被 isGlobalHotkeyBlocked 挡掉，验证模式下有遮罩层）。
  // 地图在场景跑起来几秒后才懒加载，小地图圆盘出现之前点击会落空。
  await page.waitForFunction(() => !!document.querySelector('.minimap canvas'), null, {timeout: 180000, polling: 500})
  // 进场后可能还有一段「正在前往目的地」的过场遮罩（会吞掉点击），等它散掉再开图。
  await page.waitForFunction(() => !document.querySelector('.ld-veil'), null, {timeout: 240000, polling: 500})
  await page.evaluate(() => document.querySelector('.minimap')?.click())
  await page.waitForFunction(() => !document.querySelector('.atlas')?.hidden, null, {timeout: 60000, polling: 250})
  await page.waitForFunction(() => (document.querySelector('.atlas-fog')?.textContent ?? '').includes('已探明'), null, {timeout: 30000, polling: 250})
  const legend = await page.evaluate(() => document.querySelector('.atlas-fog')?.textContent ?? '')
  assert.match(legend, /已探明 \d+\.\d{1,2} km²/, `legend should report the explored area, got ${legend}`)
  await page.waitForTimeout(1200)   // 地图每 0.2 s 重画一次，等一帧画完
  const pixels = await page.evaluate(() => {
    const canvas = document.querySelector('.atlas canvas')
    const g = canvas.getContext('2d')
    const {data} = g.getImageData(0, 0, canvas.width, canvas.height)
    let dark = 0, lit = 0, darkest = 255, lightest = 0
    for (let i = 0; i < data.length; i += 4 * 97) {
      const luma = data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114
      darkest = Math.min(darkest, luma); lightest = Math.max(lightest, luma)
      if (luma < 40) dark++; else if (luma > 90) lit++
    }
    return {dark, lit, darkest: Math.round(darkest), lightest: Math.round(lightest), width: canvas.width}
  })
  assert.ok(pixels.dark > 20, `unexplored ground must stay dark, got ${JSON.stringify(pixels)}`)
  assert.ok(pixels.lit > 20, `explored ground must stay readable, got ${JSON.stringify(pixels)}`)
  console.log('atlas pixels', JSON.stringify(pixels))

  // 重新加载：进度留在 localStorage 里，不会丢。
  await page.reload({waitUntil: 'domcontentloaded', timeout: 120000})
  await page.waitForFunction(() => typeof window.mapFog?.count === 'function', null, {timeout: 300000, polling: 500})
  const after = await page.evaluate(() => window.mapFog.count())
  assert.ok(after >= grown.cells, `fog progress must survive a reload (${after} >= ${grown.cells})`)
  console.log('after reload', after)

  assert.deepEqual(errors, [], `no page errors: ${errors.join(' | ')}`)
  console.log(`map fog passed in ${((performance.now() - start) / 1000).toFixed(1)}s`)
} finally {
  await browser?.close().catch(() => {})
  await server.close().catch(() => {})
}
