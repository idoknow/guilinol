import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {setTimeout as delay} from 'node:timers/promises'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

// Only account and ticket issuance are fixtures. Both game clients and the WS
// relay run the production code, including the welcome and players snapshots.
export async function verifyEmotes(rt, ticket) {
  const site = await preview({
    root: 'web',
    configFile: 'web/vite.config.ts',
    preview: {port: 0, host: '127.0.0.1'},
  })
  const browser = await chromium.launch({
    ...browserOptions(true),
    args: [
      ...browserOptions(true).args,
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  })
  const origin = 'http://127.0.0.1:' + site.httpServer.address().port,
    out = 'docs/review/idok-208'
  try {
    await mkdir(out, {recursive: true})
    async function join(uid, touch = false) {
      const page = await browser.newPage({
        viewport: touch ? {width: 390, height: 844} : {width: 640, height: 400},
        hasTouch: touch,
        isMobile: touch,
      })
      page.on('pageerror', (e) => console.error(e))
      await page.route('**/api/**', (route) => {
        const path = new URL(route.request().url()).pathname
        return route.fulfill({
          json:
            path === '/api/me'
              ? {id: String(uid), uid, nickname: String(uid)}
              : path === '/api/rt/ticket'
                ? {ticket: ticket(uid)}
                : {},
        })
      })
      await page.addInitScript((host) => localStorage.setItem('guiling.ws', 'ws://' + host + '/ws'), rt)
      await page.goto(origin + '/?verify&mode=walk&mp=1&flow=0')
      await page.waitForFunction(() => window.viewer?.walk?.net?.status().state === 'online', null, {
        timeout: 90000,
      })
      if (touch && (await page.locator('.rotate-skip').isVisible())) await page.locator('.rotate-skip').tap()
      assert(
        await page.evaluate(
          (uid) =>
            window.viewer.walkTo(-309, uid === 100001 ? -3 : -1, uid === 100001 ? Math.PI : 0, 'emote-test'),
          uid,
        ),
      )
      await page.waitForFunction(() => window.viewer.walk.probe().grounded)
      return page
    }
    const a = await join(100001),
      b = await join(100002, true)
    await b.waitForFunction(() => window.viewer.walk.net.probe().some((p) => p.ready))
    const observe = async (clip) => {
      await b.waitForFunction((name) => window.viewer.walk.net.probe().some((p) => p.clip === name), clip, {
        timeout: 3500,
        polling: 12,
      })
      return b.evaluate(() => Date.now())
    }
    for (const [i, key] of ['thumbs_up', 'yixia_fanshang', 'naiwa_laugh'].entries()) {
      await delay(1100)
      const start = await a.evaluate((id) => {
        window.viewer.walk.emote.play(id)
        return Date.now()
      }, i + 1)
      const latency = (await observe('emote_' + key)) - start
      assert(latency <= 300, key + ' activation took ' + latency + 'ms')
      console.log(key, latency + 'ms')
      if (i === 0) {
        await b.evaluate(() => window.viewer.walk.net.reconnect())
        await observe('emote_' + key)
        await a.keyboard.down('w')
        await observe('')
        await a.keyboard.up('w')
      }
      if (i === 2) {
        await b.setViewportSize({width: 900, height: 550})
        await b.keyboard.press('t')
        await delay(350)
        await b.screenshot({path: out + '/remote.png'})
        await b.keyboard.press('t')
        await b.setViewportSize({width: 390, height: 844})
      }
    }
    await a.setViewportSize({width: 1440, height: 900})
    await a.keyboard.down('g')
    await a.locator('.emote-overlay').waitFor()
    await a.getByRole('button', {name: '以下犯上', exact: true}).hover()
    await a.screenshot({path: out + '/wheel-desktop.png'})
    await a.keyboard.up('g')
    await observe('emote_yixia_fanshang')
    await b.locator('.emote-toggle').tap()
    await b.locator('.emote-overlay').waitFor()
    await b.screenshot({path: out + '/wheel-mobile.png'})
    await b.getByRole('button', {name: '点赞', exact: true}).tap()
    await a.waitForFunction(() => window.viewer.walk.net.probe().some((p) => p.clip === 'emote_thumbs_up'))
  } finally {
    await browser.close()
    await site.close()
  }
}
