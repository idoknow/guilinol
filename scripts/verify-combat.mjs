import assert from 'node:assert/strict'
import { combatFrames } from './combat-frame-sample.mjs'
import { mkdir } from 'node:fs/promises'
import { preview } from 'vite'
import { chromium } from 'playwright'
import { browserOptions } from './qa-browser.mjs'

export async function verifyCombat(rt, ticket) {
  const site = await preview({
    root: 'web',
    configFile: 'web/vite.config.ts',
    preview: { host: '127.0.0.1', port: 0 },
  })
  const browser = await chromium.launch({
    ...browserOptions(true),
    args: [
      ...browserOptions(true).args,
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
    ],
  })
  const origin = 'http://127.0.0.1:' + site.httpServer.address().port,
    out = 'docs/review/combat'
  try {
    await mkdir(out, { recursive: true })
    async function join(uid, z, yaw) {
      const page = await browser.newPage({ viewport: { width: 960, height: 600 } })
      page.on('pageerror', (e) => console.error('page', e))
      await page.route('**/api/**', (route) => {
        const path = new URL(route.request().url()).pathname
        return route.fulfill({
          json:
            path === '/api/me'
              ? { id: String(uid), uid, nickname: '玩家' + uid }
              : path === '/api/rt/ticket'
                ? { ticket: ticket(uid) }
                : {},
        })
      })
      await page.addInitScript((host) => localStorage.setItem('guiling.ws', 'ws://' + host + '/ws'), rt)
      await page.addInitScript(() => {
        window.combatTimes = {}
        window.addEventListener('combat:hp', ({ detail }) => {
          window.combatTimes[detail.hp] = performance.now()
        })
      })
      await page.goto(origin + '/?verify&mode=walk&mp=1&flow=0')
      await page.waitForFunction(() => window.viewer?.walk?.net?.status().state === 'online', null, {
        timeout: 90000,
      })
      assert(await page.evaluate(([z, yaw]) => window.viewer.walkTo(-309, z, yaw, 'combat-test'), [z, yaw]))
      await page.waitForFunction(() => window.viewer.walk.probe().grounded)
      await page
        .locator('.keys-card:not(.folded) .keys-head')
        .click({ timeout: 1000 })
        .catch(() => {})
      await page.mouse.move(360, 216)
      await page.mouse.wheel(0, -460)
      return page
    }
    const a = await join(100001, 0.31, 0)
    if (process.argv.includes('--frames')) {
      await combatFrames(a, rt, ticket)
      return
    }
    if (process.argv.includes('--inputs')) {
      await a.goto(origin + '/?verify&solo=1&mode=walk&flow=0')
      await a.waitForFunction(() => window.viewer?.walk?.active)
      assert(await a.evaluate(() => window.fishing.teleportToSpot('lijiang_xiangbi')))
      await a.keyboard.press('4')
      await a.waitForFunction(() => window.fishing?.state?.().stage === 'equip')
      await a.evaluate(() => {
        window.swings = 0
        window.addEventListener('combat:state', ({ detail }) => {
          if (detail.state === 'windup') window.swings++
        })
      })
      await a.mouse.move(480, 292)
      await a.mouse.down()
      await a.waitForFunction(() => window.fishing.state().phase === 'charge')
      await a.mouse.up()
      await a.waitForTimeout(450)
      assert.equal(await a.evaluate(() => window.swings), 0)
      await a.keyboard.press('1')
      assert(await a.evaluate(() => window.viewer.walkTo(-924.31, -104.93, -1.8348, 'combat-shop-test')))
      await a.waitForFunction(() => window.viewer.walk.shop.getInteractDecision()?.action === 'open_shop')
      await a.keyboard.press('f')
      await a.waitForFunction(() => document.body.dataset.shopOpen === '1')
      console.log('Mouse fishing and F shop interaction passed')
      return
    }
    // 软件渲染（无 GPU 的 Linux）下 A 全速渲染会饿死 B 的加载，B 进场期间先冻结 A
    await a.evaluate(() => window.viewer.freeze?.())
    const b = await join(100002, -0.31, Math.PI)
    await a.evaluate(() => window.viewer.resume?.())
    await a.waitForFunction(() => window.viewer.walk.net.probe().some((p) => p.ready))
    const pos = (p) => p.evaluate(() => window.viewer.walk.position).then(({ x, z }) => [x, z])
    async function move(page, ms) {
      const start = await pos(page)
      await page.keyboard.down('d')
      await page.waitForTimeout(ms)
      await page.keyboard.up('d')
      const end = await pos(page)
      return Math.hypot(end[0] - start[0], end[1] - start[1])
    }
    const walk = await move(b, 2000)
    async function place() {
      assert(await b.evaluate(() => window.viewer.walkTo(-309, -0.31, Math.PI, 'combat-test')))
      await b.waitForFunction(() => window.viewer.walk.probe().grounded)
    }
    await place()
    const hp = async (page) => Number((await page.locator('.cb-hp-text').textContent()).split('/')[0])
    const shot = (page, name) => page.screenshot({ path: out + '/' + name + '.png' })
    async function down(first) {
      for (let i = 0; i < 20 && (await hp(b)) > 0; i++) {
        await a.mouse.click(480, 292)
        if (first && i === 0) {
          await b.waitForFunction(
            () => parseInt(document.querySelector('.cb-hp-text').textContent) < 100,
            null,
            { timeout: Number(process.env.COMBAT_WAIT_MS ?? 3500) },
          )
          await Promise.all([shot(a, 'strike'), shot(b, 'stagger')])
        }
        await a.waitForTimeout(i % 3 === 2 ? 750 : 455)
      }
      assert.equal(await hp(b), 0)
    }
    await a.keyboard.down('g')
    await a.locator('.emote-overlay:not([hidden])').waitFor()
    await a.mouse.click(480, 292)
    await a.keyboard.up('g')
    await a.waitForTimeout(500)
    assert.equal(await hp(b), 100)
    await a.keyboard.press('Enter')
    await a.locator('.chat-input').waitFor({ state: 'visible' })
    await a.locator('.chat-input').focus()
    // openChat 在下一帧才聚焦；低帧率下这一帧可能晚于 Escape 把焦点抢回输入框，先等它落地
    await a.evaluate(() => new Promise((done) => requestAnimationFrame(() => done())))
    await a.keyboard.press('e')
    await a.keyboard.press('f')
    await a.keyboard.press('Escape')
    assert.equal(await hp(b), 100)
    await a.waitForTimeout(1800)
    await down(true)
    await shot(b, 'down')
    const [crawl] = await Promise.all([move(b, 2000), b.waitForTimeout(900).then(() => shot(b, 'crawl'))])
    console.log({ crawl, walk })
    assert(crawl > 0 && crawl < walk / 3, JSON.stringify({ crawl, walk }))
    await a.keyboard.down('e')
    await a.waitForFunction(() => !document.querySelector('.cb-revive-bar').hidden)
    await a.waitForTimeout(1000)
    await shot(a, 'helping')
    await b.waitForFunction(() => parseInt(document.querySelector('.cb-hp-text').textContent) === 40)
    await a.keyboard.up('e')
    await shot(b, 'revived')
    await place()
    assert(await a.evaluate(() => window.viewer.walkTo(-309, 0.31, 0, 'combat-test')))
    await down(false)
    await b.waitForFunction(() => parseInt(document.querySelector('.cb-hp-text').textContent) === 30, null, {
      timeout: 17000,
    })
    const riseMs = await b.evaluate(() => window.combatTimes[30] - window.combatTimes[0])
    assert(riseMs >= 14800 && riseMs < 15500, 'self-rise time ' + riseMs)
    console.log({ crawl, walk, riseMs, out })
  } finally {
    await browser.close()
    await new Promise((resolve) => site.httpServer.close(resolve))
  }
}
