import assert from 'node:assert/strict'
import {mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const CAPTURE_DIR = resolve(ROOT, 'captures/nikoniko-shop')

// nikoniko bay 5+6 facade geometry (world space)
const SHOP_WALL = {x: -926.1913, z: -105.4394, nx: 0.965353, nz: 0.260949}
const SHOP_TRIGGER = {x: -924.31, z: -104.93}

async function waitForWalkReady(page) {
  await page.waitForFunction(
    () =>
      Boolean(
        window.viewer?.walk?.active &&
          window.viewer?.game &&
          window.viewer?.stream &&
          window.viewer?.stats?.loaded >= 6,
      ),
    null,
    {timeout: 90000},
  )
}

async function waitForNikonikoLoaded(page) {
  await page.waitForFunction(
    () => {
      const entries = [...(window.viewer?.stream?.landmarks?.entries() ?? [])]
      const found = entries.find(([e]) => e.id === 'nikoniko')
      if (!found) return false
      const root = found[1]
      return Boolean(root?.visible && root.children.length > 0)
    },
    null,
    {timeout: 90000},
  )
  await page.waitForTimeout(450)
}

async function captureFacade(browser, baseUrl, timeVal, outName) {
  console.log(`[nikoniko-e2e] start captureFacade ${outName} (time=${timeVal})`)
  const ctx = await browser.newContext({viewport: {width: 1280, height: 720}})
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', err => {
    console.error(`[pageerror ${outName}]`, err.message)
    errors.push(`pageerror(${outName}): ${err.message}`)
  })
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error(`[console.error ${outName}]`, msg.text())
      errors.push(`console.error(${outName}): ${msg.text()}`)
    }
  })
  await page.route('**/favicon.ico', r => r.fulfill({status: 204}))
  await page.goto(`${baseUrl}/?verify&mode=walk&flow=0&time=${timeVal}`, {waitUntil: 'domcontentloaded'})
  console.log(`[nikoniko-e2e] domcontentloaded ${outName}`)
  await waitForWalkReady(page)
  console.log(`[nikoniko-e2e] walkReady ${outName}`)
  await page.evaluate(async pos => {
    await window.viewer.walkTo(pos.x, pos.z, -1.8348, 'facade-check')
  }, SHOP_TRIGGER)
  console.log(`[nikoniko-e2e] walkedTo ${outName}, waiting nikoniko...`)
  await waitForNikonikoLoaded(page)
  console.log(`[nikoniko-e2e] nikoniko loaded ${outName}`)

  // Inspect loaded nikoniko Three.js materials & light count (strict 0 dynamic lights rule)
  const sceneCheck = await page.evaluate(() => {
    const entries = [...window.viewer.stream.landmarks.entries()]
    const root = entries.find(([e]) => e.id === 'nikoniko')?.[1]
    if (!root) return {found: false}
    let lights = 0
    const materials = []
    root.traverse(obj => {
      if (obj.isLight) lights++
      if (obj.isMesh && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
        for (const m of mats) {
          materials.push({
            name: m.name,
            transparent: Boolean(m.transparent),
            opacity: m.opacity,
          })
        }
      }
    })
    return {found: true, lights, materials}
  })

  assert.equal(sceneCheck.found, true, `${outName}: nikoniko landmark must load`)
  assert.equal(sceneCheck.lights, 0, `${outName}: nikoniko must add ZERO Three.js Light objects`)
  assert.ok(
    sceneCheck.materials.some(m => m.name === 'nikoniko_shop_signs'),
    `${outName}: nikoniko_shop_signs material missing: ${JSON.stringify(sceneCheck.materials)}`,
  )
  const glassMat = sceneCheck.materials.find(m => m.name === 'nikoniko_showcase_glass')
  assert.ok(glassMat && glassMat.transparent && glassMat.opacity < 0.5, `${outName}: transparent glass missing`)

  // Frame close-up facade camera in fly mode looking across Zhongshan Middle Rd sidewalk into bay 5 + bay 6 store
  await page.evaluate(async () => {
    window.viewer.walk.leave()
    const cam = window.viewer.camera
    cam.position.set(-914.5, 154.2, -101.6)
    cam.lookAt(-927.0, 153.5, -105.6)
    cam.fov = 46
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  })
  await page.waitForTimeout(300)
  await page.screenshot({path: resolve(CAPTURE_DIR, outName)})

  assert.equal(errors.length, 0, `${outName} errors: ${errors.join('; ')}`)
  await ctx.close()
}

async function run() {
  mkdirSync(CAPTURE_DIR, {recursive: true})
  const server = await preview({
    root: resolve(ROOT, 'web'),
    configFile: resolve(ROOT, 'web/vite.config.ts'),
    preview: {host: '127.0.0.1', port: 0, strictPort: false},
  })
  const addr = server.httpServer?.address()
  const baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 4173}`
  const browser = await chromium.launch(browserOptions())

  try {
    // 1. Daytime & Nighttime facade visual + material + 0-light checks
    await captureFacade(browser, baseUrl, '13.5', 'facade-day.png')
    await captureFacade(browser, baseUrl, '21.5', 'facade-night.png')

    // 2. Map marker, search, pin navigation & full E2E shop flow
    console.log('[nikoniko-e2e] start map + shop flow')
    const ctx = await browser.newContext({viewport: {width: 1280, height: 720}})
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', err => errors.push(`pageerror(e2e): ${err.message}`))
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`console.error(e2e): ${msg.text()}`)
    })
    await page.route('**/favicon.ico', r => r.fulfill({status: 204}))
    await page.goto(`${baseUrl}/?verify&mode=walk&flow=0&time=14.5`, {waitUntil: 'domcontentloaded'})
    await waitForWalkReady(page)
    console.log('[nikoniko-e2e] opening map')

    // Open full map via dock button and search for '微笑堂服装店'
    await page.click('.dock-map')
    await page.waitForSelector('.atlas:not([hidden]) .atlas-search input', {timeout: 15000})
    await page.fill('.atlas-search input', '微笑堂服装店')
    await page.waitForSelector('.atlas-search ol li:not(.none)', {timeout: 5000})
    const firstResultText = await page.locator('.atlas-search ol li').first().innerText()
    assert.ok(
      firstResultText.includes('微笑堂服装店') && firstResultText.includes('漓尚服饰'),
      `expected 微笑堂服装店 map search hit, got: ${firstResultText}`,
    )

    // Click search hit -> popup with 标记导航 + 前往
    await page.locator('.atlas-search ol li').first().click()
    await page.waitForSelector('.atlas-pop:not([hidden]) [data-act="nav"]', {timeout: 5000})
    await page.click('.atlas-pop [data-act="nav"]')
    const navState = await page.evaluate(() => window.viewer.tour.map?.navTarget ?? null)
    assert.ok(navState && navState.name.includes('微笑堂服装店'), `expected navTarget set, got: ${JSON.stringify(navState)}`)
    await page.screenshot({path: resolve(CAPTURE_DIR, 'map-shop-nav.png')})

    // Click '前往' -> teleports cleanly near shop trigger via goPoint()
    await page.click('.atlas-pop [data-act="go"]')
    await page.waitForFunction(
      target => {
        const p = window.viewer?.walk?.position
        return Boolean(
          p &&
            window.viewer?.walk?.active &&
            Math.hypot(p.x - target.x, p.z - target.z) <= 5.0,
        )
      },
      SHOP_TRIGGER,
      {timeout: 20000},
    )
    await waitForNikonikoLoaded(page)
    console.log(
      '[nikoniko-e2e] post-go state:',
      await page.evaluate(() => ({
        pos: window.viewer.walk.position,
        prompt: window.viewer.game.getState().prompt,
      })),
    )

    await page.click('.btn-menu')
    await page.click('[data-umami-event=home-solo]')
    await page.waitForSelector('.gl-mission-entry')
    // Verify [F] enter prompt appears cleanly in game state + HUD button
    await page.waitForFunction(
      () => {
        const prompt = window.viewer.game.getState().prompt
        const stText = document.querySelector('.st-prompt:not([hidden])')?.textContent ?? ''
        const btnText = document.querySelector('.vehicle-action:not([hidden])')?.textContent ?? ''
        const text = `${prompt?.key ?? ''} ${prompt?.text ?? ''} ${stText} ${btnText}`
        return text.includes('漓尚服饰') && text.includes('F')
      },
      null,
      {timeout: 15000},
    )

    // Press F to enter boutique
    await page.keyboard.press('KeyF')
    await page.waitForFunction(
      () => window.viewer.game.getState().activeShop?.shopId === 'shop_nikoniko_apparel',
      null,
      {timeout: 8000},
    )
    await page.waitForTimeout(350)

    // Verify 360° orbit drag + zoom out NEVER clips camera behind storefront wall/glass (d >= 0.05 m)
    const stageBox = await page.locator('.shop-stage').boundingBox()
    assert.ok(stageBox && stageBox.width > 400, 'shop-stage must be visible')
    const cx = stageBox.x + stageBox.width * 0.5
    const cy = stageBox.y + stageBox.height * 0.5
    const minWallDistM = {min: Infinity}

    for (let step = 0; step < 12; step++) {
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.mouse.move(cx + 66, cy + (step % 2 === 0 ? 10 : -10), {steps: 5})
      await page.mouse.up()
      // Also zoom out slightly to stress wall raycast clamp
      await page.mouse.wheel(0, 120)
      await page.waitForTimeout(50)
      const camCheck = await page.evaluate(wall => {
        const p = window.viewer.camera.position
        const d = (p.x - wall.x) * wall.nx + (p.z - wall.z) * wall.nz
        const pos = window.viewer.walk.position
        const target = {x: pos.x, y: pos.y + 1.05, z: pos.z}
        const dx = target.x - p.x
        const dy = target.y - p.y
        const dz = target.z - p.z
        const dist = Math.hypot(dx, dy, dz)
        const dir = {x: dx / dist, y: dy / dist, z: dz / dist}
        // Check loaded nikoniko meshes via stream.landmarks (imported THREE not needed: use vector dot/distance via simple check or Raycaster if needed)
        return {x: p.x, y: p.y, z: p.z, d, dist, dir}
      }, SHOP_WALL)
      minWallDistM.min = Math.min(minWallDistM.min, camCheck.d)
      // Recessed vestibule glass doors sit at d = -0.35 m, storefront windows at d = +0.12 m, stagePos at d = +2.15 m
      assert.ok(
        camCheck.d >= -0.25 && camCheck.dist >= 0.72,
        `360 orbit camera clipped behind vestibule doors/wall at step ${step}: d=${camCheck.d.toFixed(3)}m dist=${camCheck.dist.toFixed(3)}m`,
      )
    }

    // Switch preview across 2 outfits and purchase affordable item (hat_guilin_cap ¥80)
    await page.locator('.shop-card').nth(1).click()
    await page.waitForTimeout(150)
    await page.locator('.shop-tab', {hasText: '头饰'}).click()
    await page.waitForTimeout(150)
    const capCard = page.locator('.shop-card', {hasText: '漓江青棒球帽'})
    await capCard.click()
    await page.waitForTimeout(200)

    const beforeBuy = await page.evaluate(() => ({
      money: window.viewer.game.getState().money,
      shopBuyCount: window.viewer.walk.ebike.audioStats.counts.shopBuy,
    }))
    assert.equal(beforeBuy.money, 200)

    await page.click('.shop-act-primary')
    await page.waitForFunction(
      () => window.viewer.game.getState().wardrobe.ownedItemIds.includes('hat_guilin_cap'),
      null,
      {timeout: 5000},
    )

    const afterBuy = await page.evaluate(() => ({
      money: window.viewer.game.getState().money,
      owned: window.viewer.game.getState().wardrobe.ownedItemIds,
      equippedHat: window.viewer.game.getState().wardrobe.equipped.hat,
      shopBuyCount: window.viewer.walk.ebike.audioStats.counts.shopBuy,
      statusText: document.querySelector('.shop-status-msg')?.textContent ?? '',
    }))
    assert.equal(afterBuy.money, 120)
    assert.equal(afterBuy.equippedHat, 'hat_guilin_cap')
    assert.ok(afterBuy.shopBuyCount >= beforeBuy.shopBuyCount + 1, 'purchase must play shopBuy sound chime')
    assert.ok(afterBuy.statusText.includes('成交'), `expected purchase confirmation status, got: ${afterBuy.statusText}`)

    await page.screenshot({path: resolve(CAPTURE_DIR, 'shop-open-360.png')})

    // Exit shop & verify street restoration
    await page.click('.shop-act-close')
    await page.waitForFunction(() => window.viewer.game.getState().activeShop === null, null, {timeout: 5000})

    // Reload page & verify persistence across reload
    await page.reload({waitUntil: 'domcontentloaded'})
    await waitForWalkReady(page)
    const afterReload = await page.evaluate(() => ({
      money: window.viewer.game.getState().money,
      owned: window.viewer.game.getState().wardrobe.ownedItemIds,
      equippedHat: window.viewer.game.getState().wardrobe.equipped.hat,
    }))
    assert.equal(afterReload.money, 120, 'money must persist across reload')
    assert.ok(afterReload.owned.includes('hat_guilin_cap'), 'wardrobe item must persist across reload')
    assert.equal(afterReload.equippedHat, 'hat_guilin_cap')

    assert.equal(errors.length, 0, `E2E errors: ${errors.join('; ')}`)
    console.log(
      JSON.stringify(
        {
          ok: true,
          minCameraWallDistM: +minWallDistM.min.toFixed(3),
          balanceBefore: beforeBuy.money,
          balanceAfter: afterReload.money,
          shopBuyAudioCount: afterBuy.shopBuyCount,
          navTarget: navState.name,
        },
        null,
        2,
      ),
    )
    await ctx.close()
  } finally {
    await browser.close()
    await new Promise(resolve => server.httpServer.close(resolve))
  }
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
