// 首页联机主推 + 单人弱化保留验收（IDOK-392）：
// 只跑主界面，不进 3D 城，验证桌面 / 手机竖屏 / 小屏 / 手机横屏的视觉层级、默认焦点、偏好持久化与无溢出。
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const captureDir = process.env.HOME_CAPTURE_DIR || ''
const server = await preview({root:'web', configFile:'web/vite.config.ts', preview:{host:'127.0.0.1', port:0}})
const origin = `http://127.0.0.1:${server.httpServer.address().port}`
let browser
try {
  browser = await chromium.launch(browserOptions(true))
  const context = await browser.newContext({viewport:{width:1280, height:720}})
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))

  await page.route('**/api/t', route => route.fulfill({status:204}))
  await page.route('**/favicon.ico', route => route.fulfill({status:204}))
  await page.route('**/api/live', route => route.fulfill({json:{online:24, mp:12}}))
  await page.route('**/api/me', route => route.fulfill({status:401, json:{error:{code:'unauthorized'}}}))

  // 1) 首次访问：默认聚焦联机模式；按 Enter 会把 glol.mp 设为 1 并触发登录校验
  await page.goto(origin, {waitUntil:'domcontentloaded', timeout:90000})
  await page.waitForSelector('.home.show', {timeout:30000})
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-umami-event') === 'home-mp', null, {timeout:5000})
  assert.equal(await page.evaluate(() => localStorage.getItem('glol.mp')), null, 'fresh visit must not pre-write glol.mp')

  // 点一次单人模式 → 记录显式单人偏好 ('0')，关闭登录框后重载，焦点应留在单人
  await page.click('[data-umami-event=home-solo]')
  await page.waitForSelector('dialog.account[open]', {timeout:15000})
  assert.equal(await page.evaluate(() => localStorage.getItem('glol.mp')), '0', 'clicking solo records explicit solo choice')
  await page.keyboard.press('Escape')
  await page.evaluate(() => localStorage.setItem('glol.playMode', 'solo'))
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForSelector('.home.show', {timeout:30000})
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-umami-event') === 'home-solo', null, {timeout:5000})

  // 点一次联机模式 → 记录联机偏好 ('1')，重载后回到联机焦点
  await page.click('[data-umami-event=home-mp]')
  await page.waitForSelector('dialog.account[open]', {timeout:15000})
  assert.equal(await page.evaluate(() => localStorage.getItem('glol.mp')), '1', 'clicking mp records mp preference')
  await page.keyboard.press('Escape')
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForSelector('.home.show', {timeout:30000})
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-umami-event') === 'home-mp', null, {timeout:5000})

  // 点一次游览模式 → 清掉 glol.mp 但不伪造显式单人偏好
  await page.click('[data-umami-event=home-tour]')
  await page.waitForSelector('dialog.account[open]', {timeout:15000})
  assert.equal(await page.evaluate(() => localStorage.getItem('glol.mp')), null, 'clicking tour clears glol.mp without locking solo')
  await page.keyboard.press('Escape')

  // 2) 注入钱包、印章、续游记录与实时在线人数，验收四档视口视觉层级与边界
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('glol.save.v1', JSON.stringify({money: 1280}))
    localStorage.setItem('glol.stamps', JSON.stringify(['elephant', 'pagodas', 'duxiu']))
    localStorage.setItem('glol.lastView', JSON.stringify({x: -588, y: 120, z: -212, yaw: 0, pitch: -0.3, at: Date.now() - 18 * 60000}))
  })
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForSelector('.home.show', {timeout:30000})
  await page.waitForFunction(() => {
    const img = document.querySelector('.home-bg img.on')
    return !!img && img.complete && img.naturalWidth > 0
  }, null, {timeout:15000})
  // live.ts 默认 4s 后拉一次 /api/live；等它把 12 人在线渲染出来
  await page.waitForFunction(() => {
    const el = document.querySelector('.home-mp-live')
    return !!el && !el.hidden && el.textContent.trim() === '12'
  }, null, {timeout:12000})

  if (captureDir) await mkdir(captureDir, {recursive:true})

  const viewports = [
    ['desktop', {width:1280, height:720}],
    ['phone', {width:390, height:844}],
    ['small', {width:360, height:640}],
    ['landscape', {width:844, height:390}],
  ]

  for (const [name, viewport] of viewports) {
    await page.setViewportSize(viewport)
    await page.waitForTimeout(150)
    const metrics = await page.evaluate(() => {
      const rect = sel => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        const st = getComputedStyle(el)
        return {x:r.x, y:r.y, right:r.right, bottom:r.bottom, w:r.width, h:r.height, display:st.display, opacity:Number(st.opacity), fontSize:parseFloat(st.fontSize)}
      }
      return {
        mp: rect('.home-mode--mp'),
        mpGo: rect('.home-go--mp'),
        mpDesc: rect('.home-mode--mp .home-mode-text > span'),
        mpTitle: rect('.home-mode--mp .home-mode-text b'),
        mpBadge: rect('.home-mp-badge'),
        mpLive: rect('.home-mp-live'),
        wallet: document.querySelector('.home-mode--mp .home-wallet')?.textContent?.trim() ?? '',
        tour: rect('.home-mode--tour'),
        solo: rect('.home-mode--solo'),
        soloGo: rect('.home-go--solo'),
        soloTitle: rect('.home-mode--solo .home-mode-text b'),
        seal: rect('.home-seal'),
        douyin: rect('.home-douyin'),
        links: rect('.home-links'),
        foot: rect('.home-foot'),
        overflowX: document.querySelector('.home').scrollWidth - innerWidth,
        scrollHeight: document.querySelector('.home').scrollHeight,
        innerHeight,
        innerWidth,
      }
    })

    assert.ok(metrics.mp && metrics.tour && metrics.solo, `${name}: all three mode buttons exist`)
    assert.ok(metrics.mp.y < metrics.tour.y && metrics.tour.y < metrics.solo.y,
      `${name}: vertical order must be mp -> tour -> solo (${JSON.stringify({mp:metrics.mp.y, tour:metrics.tour.y, solo:metrics.solo.y})})`)
    assert.ok(metrics.mp.h > metrics.solo.h * 1.6,
      `${name}: mp card must be visually dominant over solo (${metrics.mp.h.toFixed(1)} vs ${metrics.solo.h.toFixed(1)})`)
    assert.ok(metrics.mpGo.w > metrics.soloGo.w * 2,
      `${name}: mp CTA must be full-width vs compact solo CTA (${metrics.mpGo.w.toFixed(1)} vs ${metrics.soloGo.w.toFixed(1)})`)
    assert.ok(metrics.mpTitle.fontSize > metrics.soloTitle.fontSize + 2,
      `${name}: mp heading font larger than solo (${metrics.mpTitle.fontSize} vs ${metrics.soloTitle.fontSize})`)
    assert.notEqual(metrics.mpDesc.display, 'none', `${name}: mp description stays visible`)
    assert.ok(metrics.mpDesc.h > 10, `${name}: mp description has visible height`)
    assert.ok(metrics.mpBadge && metrics.mpBadge.w > 20, `${name}: mp recommended badge visible`)
    assert.ok(metrics.mpLive && metrics.mpLive.w > 20, `${name}: mp live count visible`)
    assert.equal(metrics.wallet, '钱包 ¥1,280', `${name}: street wallet shown on mp hero card`)
    assert.ok(metrics.solo.w > 180 && metrics.solo.h >= 40, `${name}: solo entry remains clearly clickable`)
    assert.ok(metrics.overflowX <= 1, `${name}: no horizontal overflow (${metrics.overflowX}px)`)
    assert.ok(metrics.mp.right <= viewport.width + 1 && metrics.solo.right <= viewport.width + 1, `${name}: cards fit viewport width`)
    if (metrics.seal && metrics.seal.display !== 'none') {
      assert.ok(metrics.seal.y >= 0, `${name}: logo emblem must not clip above top edge (y=${metrics.seal.y.toFixed(1)})`)
      if (metrics.douyin && metrics.douyin.display !== 'none') {
        const overlap = metrics.seal.x < metrics.douyin.right && metrics.seal.right > metrics.douyin.x &&
          metrics.seal.y < metrics.douyin.bottom && metrics.seal.bottom > metrics.douyin.y
        assert.equal(overlap, false, `${name}: logo emblem must not overlap douyin pill`)
      }
    }
    if (name !== 'small') {
      assert.ok(metrics.foot.bottom <= viewport.height + 2, `${name}: footer fits within viewport (${metrics.foot.bottom.toFixed(1)} <= ${viewport.height})`)
    }

    if (captureDir) {
      await page.screenshot({path:`${captureDir}/${name}.png`})
    }
  }

  assert.deepEqual(errors, [], 'home page must not throw errors')
  console.log('Home multiplayer-first hierarchy, solo demotion, focus defaults and responsive layout passed')
} finally {
  await browser?.close()
  await server.close()
}
