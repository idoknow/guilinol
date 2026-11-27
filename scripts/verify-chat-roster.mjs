import assert from 'node:assert/strict'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
let browser
try {
  browser = await chromium.launch(browserOptions())
  const page = await browser.newPage({viewport: {width: 1280, height: 720}})
  const params = new URLSearchParams({verify: '', mode: 'walk'})
  if (process.env.QA_VIEW) params.set('view', process.env.QA_VIEW)
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?${params}`, {waitUntil: 'domcontentloaded'})
  await page.waitForFunction(() => window.viewer?.stats.loaded > 0 && !window.viewer.stream.pending.size, null, {timeout: 120000})
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('glol:mp-status', {detail: {state: 'online', online: 1}})))
  await page.locator('.chat-bubble').click()
  const input = page.locator('.chat-input')
  await input.fill('草稿')
  await page.locator('.hud-stat--mp').click()
  await page.locator('.mp-roster.show').waitFor()
  if (process.env.QA_CAPTURE) await page.screenshot({path: process.env.QA_CAPTURE, timeout: 120000})
  assert.notEqual(await page.locator('.chat-dock').getAttribute('data-open'), '1', 'opening roster must fold chat')
  await page.locator('.chat-panel').waitFor({state: 'hidden'})
  await page.keyboard.press('Enter')
  await input.waitFor()
  await page.locator('.mp-roster').waitFor({state: 'hidden'})
  assert.equal(await input.inputValue(), '草稿')
  await page.waitForFunction(() => document.activeElement?.matches('.chat-input'))
  await page.keyboard.press('Escape')
  await page.locator('.chat-panel').waitFor({state: 'hidden'})
  console.log('PASS: chat → roster → Enter → chat → Escape; draft preserved')
} finally {
  await browser?.close()
  await server.close()
}
