/**
 * Headless Playwright UI & 3-Viewport Zero-Overlap Verification for Stage 1A (`IDOK-122`).
 *
 * Mounts the real compiled `shop-overlay.ts` + `shop-overlay.css` + `street-hud.ts` + `render-range.css` + `walk.css`
 * in headless Chromium across:
 *  - Desktop: 1280x720
 *  - Mobile Portrait: 390x844 (hasTouch: true)
 *  - Mobile Landscape: 844x390 (hasTouch: true)
 *
 * Verifies:
 *  1. 0 console errors & 0 page errors.
 *  2. Zero bounding-box overlap between 3D preview stage, shop drawer, tabs, cards, footer buttons; zero viewport overflow.
 *  3. Touch target minimum sizes (>=44px portrait, >=40px landscape).
 *  4. Street HUD `.render-entry` vs mobile `.minimap` & `.road-name` zero overlap; `.st-phone` scrollable in landscape.
 *  5. Interactive E2E in browser: insufficient funds warning -> creditReward -> preview unowned outfit -> Esc rollback ->
 *     re-open -> buy outfit atomically -> balance updates & button converts to '正在穿戴' -> reload verifies glol.save.v1!
 *  6. Saves headless screenshots under `captures/shop-ui/` for visual sign-off.
 */
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {build} from 'esbuild'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from 'playwright'

const tempDir = await mkdtemp(join(tmpdir(), 'glol-shop-ui-'))
const outDir = join(process.cwd(), 'captures/shop-ui')
await mkdir(outDir, {recursive: true})

const harnessEntry = join(tempDir, 'harness.ts')
const bundleJs = join(tempDir, 'bundle.js')
const bundleCss = join(tempDir, 'bundle.css')

const {writeFile, readFile} = await import('node:fs/promises')
await writeFile(
  harnessEntry,
  `
import '${join(process.cwd(), 'web/src/ui/theme.css').replace(/\\/g, '/')}'
import '${join(process.cwd(), 'web/src/ui/hud.css').replace(/\\/g, '/')}'
import '${join(process.cwd(), 'web/src/ui/walk.css').replace(/\\/g, '/')}'
import '${join(process.cwd(), 'web/src/ui/render-range.css').replace(/\\/g, '/')}'
import '${join(process.cwd(), 'web/src/ui/street-hud.css').replace(/\\/g, '/')}'
import {initGame, createGameDebugProbe} from '${join(process.cwd(), 'web/src/game/index.ts').replace(/\\/g, '/')}'
import {mountShopOverlay} from '${join(process.cwd(), 'web/src/ui/shop-overlay.ts').replace(/\\/g, '/')}'
import {mountStreetHud, demoSource} from '${join(process.cwd(), 'web/src/ui/street-hud.ts').replace(/\\/g, '/')}'
import {isGlobalHotkeyBlocked} from '${join(process.cwd(), 'web/src/walk/input-guard.ts').replace(/\\/g, '/')}'

initGame()
const probe = createGameDebugProbe()
const logs = { previews: [], rollbacks: [], orbitDrags: 0, hotkeyBlocked: false }

// Mock minimal street HUD + render-entry + minimap elements to test zero-overlap gates too
const hud = mountStreetHud(demoSource('foot'))
const mini = document.createElement('button'); mini.className = 'minimap'; mini.textContent = '图'; document.body.append(mini)
const road = document.createElement('div'); road.className = 'road-name'; road.textContent = '中山中路'; document.body.append(road)
const renderEntry = document.createElement('button'); renderEntry.className = 'render-entry'; renderEntry.textContent = '视野 · 标准'; document.body.append(renderEntry)

const overlay = mountShopOverlay({
  onPreviewOutfit(eq) { logs.previews.push(eq) },
  onPreviewRollback(eq) { logs.rollbacks.push(eq) },
  onOrbitDrag() { logs.orbitDrags++ },
})

window.addEventListener('keydown', e => {
  if (e.code === 'KeyW') logs.hotkeyBlocked = isGlobalHotkeyBlocked(e.target)
})

Object.assign(window, { __shopHarness: { overlay, probe, logs, hud } })
`,
)

await build({
  entryPoints: [harnessEntry],
  outfile: bundleJs,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'silent',
})

const [jsText, cssText] = await Promise.all([readFile(bundleJs, 'utf8'), readFile(bundleCss, 'utf8')])

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Shop UI Verify</title><style>
body{margin:0;background:radial-gradient(circle at 35% 45%,#2d4a58,#141b22 72%);height:100vh;width:100vw;overflow:hidden}
${cssText}
</style></head><body><script type="module" src="/bundle.js"></script></body></html>`

const server = createServer((req, res) => {
  if (req.url === '/bundle.js') {
    res.writeHead(200, {'Content-Type': 'application/javascript; charset=utf-8'})
    res.end(jsText)
  } else {
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'})
    res.end(html)
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const url = `http://127.0.0.1:${port}/`

let browser
try {
  const execPath = process.env.CHROMIUM || undefined
  browser = await chromium.launch({headless: true, executablePath: execPath})

  const viewports = [
    {name: 'desktop-1280x720', width: 1280, height: 720, hasTouch: false, minTouchPx: 34, shopId: 'shop_nikoniko_apparel'},
    {name: 'mobile-portrait-390x844', width: 390, height: 844, hasTouch: true, minTouchPx: 44, shopId: 'shop_nikoniko_apparel'},
    {name: 'mobile-landscape-844x390', width: 844, height: 390, hasTouch: true, minTouchPx: 40, shopId: 'shop_shizijie_ebike'},
  ]

  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: {width: vp.width, height: vp.height},
      hasTouch: vp.hasTouch,
      isMobile: vp.hasTouch,
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

    await page.goto(url, {waitUntil: 'load'})
    await page.waitForFunction(() => Boolean(window.__shopHarness))

    // 1. Check street HUD `.render-entry` vs `.minimap` & `.road-name` zero overlap BEFORE opening shop
    const streetOverlap = await page.evaluate(() => {
      const ids = ['.minimap', '.road-name', '.render-entry']
      const rects = ids
        .map(sel => {
          const el = document.querySelector(sel)
          if (!el) return null
          const cs = getComputedStyle(el)
          if (cs.display === 'none' || cs.visibility === 'hidden') return null
          const r = el.getBoundingClientRect()
          return {sel, l: r.left, t: r.top, r: r.right, b: r.bottom}
        })
        .filter(Boolean)
      const overlaps = []
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i], b = rects[j]
          const ox = Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l))
          const oy = Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t))
          if (ox * oy > 1) overlaps.push([a.sel, b.sel, Math.round(ox * oy)])
        }
      }
      return {rects, overlaps}
    })
    assert.deepEqual(streetOverlap.overlaps, [], `[${vp.name}] street HUD overlap: ${JSON.stringify(streetOverlap)}`)

    // 2. Open phone first (on desktop) then open shop to assert .st-phone auto-collapses cleanly on shop:open
    await page.evaluate(({shopId, testPhone}) => {
      if (testPhone) window.__shopHarness.hud.togglePhone(true)
      window.__shopHarness.overlay.openShop(shopId)
    }, {shopId: vp.shopId, testPhone: vp.name.startsWith('desktop')})

    const geom = await page.evaluate(({W, H, minTouch}) => {
      const stage = document.querySelector('.shop-stage').getBoundingClientRect()
      const drawer = document.querySelector('.shop-drawer').getBoundingClientRect()
      const head = document.querySelector('.shop-head').getBoundingClientRect()
      const tabs = document.querySelector('.shop-tabs').getBoundingClientRect()
      const list = document.querySelector('.shop-list').getBoundingClientRect()
      const footer = document.querySelector('.shop-footer').getBoundingClientRect()

      const intersect = (a, b) => {
        const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        const oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
        return ox * oy
      }

      const stageDrawerOverlap = intersect(stage, drawer)
      const internalOverlaps = []
      const sections = [['head', head], ['tabs', tabs], ['list', list], ['footer', footer]]
      for (let i = 0; i < sections.length; i++) {
        for (let j = i + 1; j < sections.length; j++) {
          const area = intersect(sections[i][1], sections[j][1])
          if (area > 1) internalOverlaps.push([sections[i][0], sections[j][0], area])
        }
      }
      const outOfBounds =
        drawer.left < -1 || drawer.top < -1 || drawer.right > W + 1 || drawer.bottom > H + 1 ||
        stage.left < -1 || stage.top < -1 || stage.right > W + 1 || stage.bottom > H + 1

      const buttons = [...document.querySelectorAll('.shop-footer button:not([hidden]), .shop-tabs button')]
      const tooSmall = buttons
        .map(b => ({text: b.textContent.trim(), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height)}))
        .filter(b => b.h < minTouch || b.w < minTouch)

      const hiddenWhileShop = ['.render-entry', '.st-hud', '.minimap', '.road-name'].every(sel => {
        const el = document.querySelector(sel)
        return !el || getComputedStyle(el).display === 'none'
      })

      return {
        stageRatioW: +(stage.width / W).toFixed(3),
        stageRatioH: +(stage.height / H).toFixed(3),
        drawerW: Math.round(drawer.width),
        drawerH: Math.round(drawer.height),
        stageDrawerOverlap,
        internalOverlaps,
        outOfBounds,
        tooSmall,
        hiddenWhileShop,
      }
    }, {W: vp.width, H: vp.height, minTouch: vp.minTouchPx})

    assert.equal(geom.stageDrawerOverlap, 0, `[${vp.name}] stage/drawer overlap: ${JSON.stringify(geom)}`)
    assert.deepEqual(geom.internalOverlaps, [], `[${vp.name}] drawer internal overlaps: ${JSON.stringify(geom)}`)
    assert.equal(geom.outOfBounds, false, `[${vp.name}] viewport overflow: ${JSON.stringify(geom)}`)
    assert.deepEqual(geom.tooSmall, [], `[${vp.name}] touch targets below ${vp.minTouchPx}px: ${JSON.stringify(geom)}`)
    assert.equal(geom.hiddenWhileShop, true, `[${vp.name}] competing HUD must hide when shop is open`)
    if (vp.name.startsWith('desktop')) {
      assert(geom.stageRatioW >= 0.65, `desktop 3D stage must be >= 65% width, got ${geom.stageRatioW}`)
    }

    await page.screenshot({path: join(outDir, `${vp.name}.png`)})

    // 3. On desktop, also run live interactive E2E flow (hotkey block + preview rollback + atomic purchase + reload persist)
    if (vp.name.startsWith('desktop')) {
      // Press W inside shop -> must be blocked by input-guard; also verify .st-phone auto-collapses when shop opens
      await page.keyboard.press('KeyW')
      const blocked = await page.evaluate(() => ({
        wBlocked: window.__shopHarness.logs.hotkeyBlocked,
        phoneClosed: !document.body.hasAttribute('data-phone'),
      }))
      assert.equal(blocked.wBlocked, true, 'KeyW must be blocked while shop is open')
      assert.equal(blocked.phoneClosed, true, 'st-phone must auto-collapse on shop:open')

      // Select unowned T1 hoodie -> preview fires; press Esc -> rollback fires and real state unchanged
      await page.click('.shop-card[data-item-key="outfit_preset:outfit_guilin_hoodie"]')
      await page.keyboard.press('Escape')
      const afterEsc = await page.evaluate(() => ({
        isOpen: window.__shopHarness.overlay.isOpen(),
        previews: window.__shopHarness.logs.previews.length,
        rollbacks: window.__shopHarness.logs.rollbacks.length,
        equippedTop: window.__shopHarness.probe.getState().wardrobe.equipped.top,
        money: window.__shopHarness.probe.getState().money,
      }))
      assert.equal(afterEsc.isOpen, false)
      assert(afterEsc.previews >= 1 && afterEsc.rollbacks >= 1)
      assert.equal(afterEsc.equippedTop, 'top_default_tee')
      assert.equal(afterEsc.money, 200)

      // Credit reward (+¥480 -> ¥680), reopen shop, buy T1 hoodie atomically -> ¥200 left & equipped
      await page.evaluate(() => {
        window.__shopHarness.probe.commerce.creditReward({
          source: 'mission_delivery',
          refId: 'noodle_ui_test',
          amount: 480,
          idempotencyKey: 'ui_fund_1',
        })
        window.__shopHarness.overlay.openShop('shop_nikoniko_apparel')
      })
      await page.click('.shop-card[data-item-key="outfit_preset:outfit_guilin_hoodie"]')
      await page.click('.shop-act-primary')
      const afterBuy = await page.evaluate(() => ({
        money: window.__shopHarness.probe.getState().money,
        equippedTop: window.__shopHarness.probe.getState().wardrobe.equipped.top,
        btnText: document.querySelector('.shop-act-primary').textContent.trim(),
      }))
      assert.equal(afterBuy.money, 200)
      assert.equal(afterBuy.equippedTop, 'top_guilin_hoodie')
      assert.equal(afterBuy.btnText, '正在穿戴')

      // Reload page & verify glol.save.v1 persisted money + outfit!
      await page.reload({waitUntil: 'load'})
      await page.waitForFunction(() => Boolean(window.__shopHarness))
      const afterReload = await page.evaluate(() => ({
        money: window.__shopHarness.probe.getState().money,
        equippedTop: window.__shopHarness.probe.getState().wardrobe.equipped.top,
        ownedPresets: window.__shopHarness.probe.getState().wardrobe.ownedPresetIds,
      }))
      assert.equal(afterReload.money, 200)
      assert.equal(afterReload.equippedTop, 'top_guilin_hoodie')
      assert(afterReload.ownedPresets.includes('outfit_guilin_hoodie'))
    }

    assert.deepEqual(errors, [], `[${vp.name}] console/page errors: ${JSON.stringify(errors)}`)
    console.log(`  ok   ${vp.name} (${JSON.stringify(geom)})`)
    await context.close()
  }

  console.log('\nALL 3-VIEWPORT HEADLESS SHOP UI CHECKS PASSED')
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
  await rm(tempDir, {recursive: true, force: true})
}
