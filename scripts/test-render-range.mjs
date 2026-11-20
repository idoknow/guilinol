import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {
  RENDER_RADIUS_DEFAULT,
  RENDER_RADIUS_MAX,
  RENDER_RADIUS_MIN,
  RENDER_STORAGE_KEY,
  clampRenderRadius,
  deriveRenderScope,
  loadRenderConfig,
  parseRenderQuery,
  presetForRadius,
  snapRenderRadius,
} from '../web/src/render-config.ts'

assert.equal(clampRenderRadius(NaN), RENDER_RADIUS_DEFAULT)
assert.equal(clampRenderRadius(50), RENDER_RADIUS_MIN)
assert.equal(clampRenderRadius(9999), RENDER_RADIUS_MAX)
assert.equal(snapRenderRadius(260), 256)
assert.equal(snapRenderRadius(490), 480)
assert.equal(presetForRadius(256), 'fast')
assert.equal(presetForRadius(480), 'balanced')
assert.equal(presetForRadius(960), 'far')
assert.equal(presetForRadius(640), 'custom')
assert.deepEqual(parseRenderQuery(new URLSearchParams('range=fast')), {preset: 'fast', radius: 256})
assert.deepEqual(parseRenderQuery(new URLSearchParams('range=远景')), {preset: 'far', radius: 960})
assert.deepEqual(parseRenderQuery(new URLSearchParams('radius=640&range=fast')), {preset: 'custom', radius: 640})
assert.equal(parseRenderQuery(new URLSearchParams('radius=abc&range=unknown')), null)
assert.deepEqual(loadRenderConfig(new URLSearchParams('range=far')), {preset: 'far', radius: 960, source: 'url'})
assert.deepEqual(loadRenderConfig(new URLSearchParams('')), {preset: 'balanced', radius: 480, source: 'default'})

const scopeFast = deriveRenderScope(256)
const scopeFar = deriveRenderScope(960)
assert(scopeFast.chunkRadius < scopeFar.chunkRadius)
assert(scopeFast.landmarkLoadRadius < scopeFar.landmarkLoadRadius)
assert(scopeFast.forestLoadRadius < scopeFar.forestLoadRadius)
assert(scopeFast.fogScale < scopeFar.fogScale)
console.log('render-config unit tests OK')

const outDir = process.env.RENDER_SHOT_DIR
if (outDir) await mkdir(outDir, {recursive: true})

const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
let browser

function checkRectsScript() {
  return ({width, height, selectors}) => {
    const boxes = selectors.map(sel => {
      const el = document.querySelector(sel)
      if (!el) return {sel, missing: true}
      const st = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const hidden = st.display === 'none' || st.visibility === 'hidden' || el.hasAttribute('hidden') || r.width === 0 || r.height === 0
      return {
        sel,
        missing: false,
        hidden,
        left: +r.left.toFixed(1),
        top: +r.top.toFixed(1),
        right: +r.right.toFixed(1),
        bottom: +r.bottom.toFixed(1),
      }
    })
    const visible = boxes.filter(b => !b.missing && !b.hidden)
    const overlaps = []
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const a = visible[i], b = visible[j]
        const involved = a.sel.startsWith('.render-') || b.sel.startsWith('.render-')
        if (!involved) continue
        const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        const oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
        if (ox * oy > 0) overlaps.push({a: a.sel, b: b.sel, area: +(ox * oy).toFixed(1)})
      }
    }
    const outOfBounds = visible.filter(b => b.sel.startsWith('.render-') && (b.left < -0.5 || b.top < -0.5 || b.right > width + 0.5 || b.bottom > height + 0.5))
    return {overlaps, outOfBounds}
  }
}

try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM,
    args: process.platform === 'darwin'
      ? ['--enable-gpu', '--use-angle=metal']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const errors = []

  const deskCtx = await browser.newContext({viewport: {width: 1280, height: 720}})
  const page = await deskCtx.newPage()
  page.on('pageerror', e => errors.push('desk: ' + e.message))
  await page.route('**/favicon.ico', r => r.fulfill({status: 204}))
  await page.goto(`${baseUrl}/?verify&mode=walk&flow=0`)
  await page.waitForFunction(() => window.viewer?.walk?.active && document.querySelector('.account-entry') && document.querySelector('.render-entry') && window.viewer?.tour?.map, null, {timeout: 90000})
  await page.waitForFunction(() => window.viewer.stats.pending === 0 && window.viewer.stats.loaded >= 10, null, {timeout: 60000})

  const deskSelectors = ['output', '.sky-ui', '.account-entry', '.render-entry', '.dock', '.btn-about', 'footer', '.hint']
  const deskClosed = await page.evaluate(checkRectsScript(), {width: 1280, height: 720, selectors: deskSelectors})
  assert.deepEqual(deskClosed.overlaps, [])
  assert.deepEqual(deskClosed.outOfBounds, [])

  await page.click('.render-entry')
  await page.waitForSelector('.render-pop:not([hidden])')
  const deskOpen = await page.evaluate(checkRectsScript(), {width: 1280, height: 720, selectors: [...deskSelectors, '.render-pop']})
  assert.deepEqual(deskOpen.overlaps, [])
  assert.deepEqual(deskOpen.outOfBounds, [])
  if (outDir) await page.screenshot({path: `${outDir}/desktop-open.png`})

  const initialLoaded = await page.evaluate(() => window.viewer.stats.loaded)
  await page.click('.render-presets button[data-preset="far"]')
  await page.waitForFunction(() => window.viewer.stream.radius === 960 && window.viewer.stats.loaded > 22, null, {timeout: 60000})
  const farLoaded = await page.evaluate(() => window.viewer.stats.loaded)
  assert(farLoaded > initialLoaded)

  await page.click('.render-presets button[data-preset="fast"]')
  await page.waitForFunction(() => window.viewer.stream.radius === 256 && window.viewer.stats.loaded <= 12, null, {timeout: 30000})
  const fastLoaded = await page.evaluate(() => window.viewer.stats.loaded)
  assert(fastLoaded <= 12 && fastLoaded < farLoaded)

  await page.evaluate(() => {
    const slider = document.querySelector('.render-pop input[type="range"]')
    slider.value = '640'
    slider.dispatchEvent(new Event('input', {bubbles: true}))
    slider.dispatchEvent(new Event('change', {bubbles: true}))
  })
  await page.waitForFunction(() => window.viewer.stream.radius === 640)
  assert.deepEqual(JSON.parse(await page.evaluate(k => localStorage.getItem(k), RENDER_STORAGE_KEY)), {preset: 'custom', radius: 640})

  await page.goto(`${baseUrl}/?verify&mode=walk&flow=0`)
  await page.waitForFunction(() => window.viewer?.walk?.active && document.querySelector('.render-entry'), null, {timeout: 90000})
  assert.equal(await page.evaluate(() => window.viewer.stream.radius), 640)

  await page.goto(`${baseUrl}/?verify&mode=walk&flow=0&range=fast`)
  await page.waitForFunction(() => window.viewer?.walk?.active && document.querySelector('.render-entry'), null, {timeout: 90000})
  assert.equal(await page.evaluate(() => window.viewer.stream.radius), 256)
  await page.click('.render-entry')
  assert.equal(await page.textContent('.render-badge'), 'URL 覆盖')
  assert.deepEqual(JSON.parse(await page.evaluate(k => localStorage.getItem(k), RENDER_STORAGE_KEY)), {preset: 'custom', radius: 640})

  await page.goto(`${baseUrl}/?verify&mode=walk&flow=0&radius=320`)
  await page.waitForFunction(() => window.viewer?.walk?.active && document.querySelector('.render-entry'), null, {timeout: 90000})
  assert.equal(await page.evaluate(() => window.viewer.stream.radius), 320)
  await page.click('.render-entry')
  await page.click('.render-reset')
  assert.equal(await page.evaluate(() => window.viewer.stream.radius), 480)
  assert.equal(await page.evaluate(k => localStorage.getItem(k), RENDER_STORAGE_KEY), null)

  await page.click('.dock-photo')
  await page.waitForFunction(() => document.body.dataset.photo === 'on')
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.render-entry')).display === 'none' && getComputedStyle(document.querySelector('.render-pop')).display === 'none'), true)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.body.dataset.photo !== 'on')
  await deskCtx.close()

  const mobSelectors = ['output', '.sky-ui', '.account-entry', '.render-entry', '.dock', '.btn-about', 'footer', '.walk-ui .joystick', '.walk-ui .btn-run', '.walk-ui .btn-jump', '.walk-ui .btn-view']
  for (const [label, vp] of [['390x844', {width: 390, height: 844}], ['844x390', {width: 844, height: 390}]]) {
    const ctx = await browser.newContext({viewport: vp, deviceScaleFactor: 1, isMobile: true, hasTouch: true})
    const mp = await ctx.newPage()
    mp.on('pageerror', e => errors.push(`${label}: ${e.message}`))
    await mp.route('**/favicon.ico', r => r.fulfill({status: 204}))
    await mp.goto(`${baseUrl}/?verify&mode=walk&flow=0&time=10.5`)
    await mp.waitForFunction(() => window.viewer?.walk?.active && window.viewer?.tour?.map && document.querySelector('.account-entry') && document.querySelector('.render-entry') && document.querySelector('.btn-about'), null, {timeout: 90000})
    await mp.evaluate(async () => { for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame) })

    const closed = await mp.evaluate(checkRectsScript(), {...vp, selectors: mobSelectors})
    assert.deepEqual(closed.overlaps, [], `${label} closed overlap`)
    assert.deepEqual(closed.outOfBounds, [], `${label} closed outOfBounds`)
    await mp.locator('.render-entry').tap()
    await mp.waitForSelector('.render-pop:not([hidden])')
    const open = await mp.evaluate(checkRectsScript(), {...vp, selectors: [...mobSelectors, '.render-pop']})
    assert.deepEqual(open.overlaps, [], `${label} open overlap`)
    assert.deepEqual(open.outOfBounds, [], `${label} open outOfBounds`)
    if (outDir) await mp.screenshot({path: `${outDir}/mobile-${label}-open.png`})
    await ctx.close()
  }

  assert.deepEqual(errors, [])
  console.log('ALL RENDER RANGE TESTS PASSED', {initialLoaded, farLoaded, fastLoaded})
} finally {
  await browser?.close()
  await server.close()
}
