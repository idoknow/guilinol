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

  // 出生点周围应该已经点亮了几格（走路 tick 每 220 ms 记一次；IDOK-590 起每格 8 m、半径 10 m）。
  const born = await page.evaluate(() => ({
    cells: window.mapFog.count(),
    stored: JSON.parse(localStorage.getItem('glol.fog.v2') ?? '[]').length,
    area: window.mapFog.area(),
  }))
  assert.ok(born.stored > 0, 'walking should already have revealed the spawn cell')
  assert.equal(born.cells, born.stored, 'memory and localStorage agree')
  assert.ok(born.area > 0 && born.area < .01, `one 10 m radius around spawn is a tiny patch, got ${born.area} km²`)
  console.log('spawn reveal', JSON.stringify(born))

  // 点亮 800 m 外的一圈 → 计数和面积都要往上走（10 m 半径会覆盖若干 8 m 格）。
  const grown = await page.evaluate(() => {
    const w = window.viewer.walk.position
    const added = window.mapFog.reveal(w.x + 800, w.z)
    return {added, cells: window.mapFog.count(), area: window.mapFog.area()}
  })
  assert.ok(grown.added >= 1 && grown.added < 40, `revealing one spot lights a small ring of cells, got ${grown.added}`)
  assert.equal(grown.cells, born.cells + grown.added)
  assert.ok(grown.area > born.area)
  console.log('revealed far patch', JSON.stringify(grown))

  // 桌面端小地图应该是 GTA 那种会随朝向转的圆角方框（触屏仍是圆盘）。
  const mini = await page.evaluate(() => {
    const box = document.querySelector('.minimap')
    const style = getComputedStyle(box)
    return {gta: box.classList.contains('gta'), radius: style.borderRadius, angle: box.style.getPropertyValue('--north-angle'), size: box.getBoundingClientRect().width}
  })
  assert.equal(mini.gta, true, 'a desktop browser with a fine pointer gets the GTA-style minimap')
  assert.ok(parseFloat(mini.radius) < mini.size / 3, `GTA minimap is a rounded square, not a disc (radius ${mini.radius})`)
  assert.match(mini.angle, /-?\d+(\.\d+)?rad/, 'the north badge follows the heading')
  console.log('minimap', JSON.stringify(mini))

  // 玩家脚下就几格，太窄了看不出来：先沿街点亮一小段（相当于走过去几十米）再截图比对。
  const trail = await page.evaluate(() => {
    const w = window.viewer.walk.position
    let added = 0
    for (let d = -24; d <= 24; d += 8) added += window.mapFog.reveal(w.x + d, w.z)
    return {added, cells: window.mapFog.count(), area: window.mapFog.area()}
  })
  assert.ok(trail.cells > grown.cells, `walking further opens more of the map, got ${JSON.stringify(trail)}`)
  console.log('trail', JSON.stringify(trail))

  // 全屏地图：图例要有「已探明 N km²/公顷」，画面上要同时存在雾与已探明的街道。
  // 走 window.mapFog.open()：加载遮罩在流式加载期间有 document 级捕获监听，合成点击到不了小地图。
  await page.evaluate(async () => { await window.mapFog.open() })
  await page.waitForFunction(() => !document.querySelector('.atlas')?.hidden, null, {timeout: 60000, polling: 250})
  await page.waitForFunction(() => (document.querySelector('.atlas-fog')?.textContent ?? '').includes('已探明'), null, {timeout: 30000, polling: 250})
  const legend = await page.evaluate(() => document.querySelector('.atlas-fog')?.textContent ?? '')
  assert.match(legend, /已探明 \d+(\.\d+)? (km²|公顷)/, `legend should report the explored area, got ${legend}`)
  await page.waitForTimeout(2200)   // 地图每 0.2 s 重画一次，等一帧画完
  const pixels = await page.evaluate(() => {
    const canvas = document.querySelector('.atlas canvas')
    const g = canvas.getContext('2d')
    const {data} = g.getImageData(0, 0, canvas.width, canvas.height)
    const at = (x, y) => { const i = (y * canvas.width + x) * 4; return [data[i], data[i + 1], data[i + 2]] }
    const luma = ([r, gg, b]) => r * .299 + gg * .587 + b * .114
    // 四角（离玩家很远）应该是雾：冷灰、几乎不带色。
    const corners = [[24, 24], [canvas.width - 25, 24], [24, canvas.height - 25], [canvas.width - 25, canvas.height - 25]].map(([x, y]) => at(x, y))
    const mist = corners.filter(c => { const l = luma(c), spread = Math.max(...c) - Math.min(...c); return l > 80 && l < 205 && spread < 40 })
    const cornerLuma = corners.reduce((sum, c) => sum + luma(c), 0) / corners.length
    // 玩家脚下应该已经开过图：小窗里要有纸白/路面这类亮像素（箭头本身是深色，只看亮度）。
    const cx = Math.round(canvas.width / 2), cy = Math.round(canvas.height / 2)
    let inner = 0, bright = 0, n = 0
    for (let y = cy - 14; y < cy + 14; y += 2) for (let x = cx - 14; x < cx + 14; x += 2) {
      const l = luma(at(x, y)); inner += l; n++; if (l > 200) bright++
    }
    return {corners: corners.map(c => c.join(',')), mist: mist.length, inner: Math.round(inner / n), cornerLuma: Math.round(cornerLuma), bright}
  })
  assert.ok(pixels.mist >= 3, `unexplored corners must read as fog, got ${JSON.stringify(pixels)}`)
  assert.ok(pixels.bright >= 8, `the explored patch under the player must stand out of the fog, got ${JSON.stringify(pixels)}`)
  assert.ok(pixels.inner > pixels.cornerLuma + 12, `explored ground is brighter than the fog, got ${JSON.stringify(pixels)}`)
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
