import { browserOptions, recordFrames } from './qa-browser.mjs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { preview } from 'vite'

const server = await preview({
  root: 'web',
  configFile: 'web/vite.config.ts',
  preview: { host: '127.0.0.1', port: 0 },
})
let browser
try {
  browser = await chromium.launch(browserOptions())
  for (const viewport of [
    { width: 960, height: 540 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({
      viewport,
      hasTouch: viewport.width < 500,
      isMobile: viewport.width < 500,
    })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    // Portrait phones get the IDOK-144 rotate gate; take its 竖屏继续 escape so the tour flow is reachable.
    await page.addInitScript(() => sessionStorage.setItem('glol.portraitOk', '1'))
    await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/?verify')
    await page.waitForFunction(() => window.viewer?.tour)
    await recordFrames(page)
    await page.locator('.dock-map').click()
    await page.getByRole('searchbox').fill('象鼻山')
    await page.locator('.atlas-search li').filter({ hasText: '观景点' }).first().click()
    await page.locator('.atlas-pop button[data-act=go]').click()
    await page.locator('.spot-card.show [data-act="photo"]').click()
    await page.getByRole('button', { name: '按快门' }).click()
    await page.waitForFunction(() => window.lastPhoto?.bytes > 5000)
    assert(await page.evaluate(() => window.viewer.tour.stamps.has('elephant')))
    await page.getByRole('button', { name: '退出拍照' }).click()
    await page.locator('.dock-book').click()
    assert(await page.locator('.book li.done [data-id="elephant"]').isVisible())
    assert.deepEqual(errors, [])
    await page.close()
  }
} finally {
  await browser?.close()
  await server.close()
}
