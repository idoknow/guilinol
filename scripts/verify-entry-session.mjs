import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const server = await preview({root:'web', configFile:'web/vite.config.ts', preview:{host:'127.0.0.1', port:0}})
const url = 'http://127.0.0.1:' + server.httpServer.address().port
let browser
try {
  browser = await chromium.launch(browserOptions(true))
  for (const [hasTouch, enabled, expected] of [[false,true,0],[true,true,1],[true,false,0]]) {
    const page = await browser.newPage({hasTouch})
    await page.addInitScript(enabled => {
      if (!enabled) localStorage.setItem('glol.prefs',JSON.stringify({autoFullscreen:false}))
      window.fullscreenCalls = []
      Element.prototype.requestFullscreen = async () => {
        window.fullscreenCalls.push(navigator.userActivation.isActive)
      }
    }, enabled)
    await page.route('**/api/me', route => route.fulfill({status:401,json:{error:{code:'unauthorized'}}}))
    await page.goto(url)
    await page.click('.home-mode--tour')
    await page.waitForSelector('dialog.account[open] input[type=password]')
    assert.deepEqual(await page.evaluate(() => window.fullscreenCalls), Array(expected).fill(true))
    await page.close()
  }

  const page = await browser.newPage()
  const context = page.context()
  const valid = () => context.addCookies([{name:'glol_session', value:'fixture', url, httpOnly:true}])
  await page.route('**/api/me', async route => {
    const cookie = await route.request().headerValue('cookie')
    await route.fulfill(cookie?.includes('glol_session=fixture')
      ? {json:{id:'fixture',nickname:'测试游客'}}
      : {status:401,json:{error:{code:'unauthorized'}}})
  })
  await page.route('**/api/me/avatar',route => route.fulfill({json:{avatar:null}}))
  await page.route('**/api/me/save',route => route.fulfill({json:{save:null}}))
  await page.goto(url)
  await valid()
  await page.click('.home-account')
  await page.getByText('测试游客',{exact:true}).first().waitFor()
  assert.equal(await page.locator('dialog.account[open]').count(),0)
  await context.clearCookies()
  await page.click('.home-account')
  await page.waitForSelector('dialog.account[open] input[type=password]')
  await valid()
  await page.goto(url+'/?social=login')
  // An account without an avatar resumes game entry at character creation.
  await page.waitForSelector('dialog.creator[open]')
  assert.equal(await page.locator('dialog.account[open]').count(),0)
  await context.clearCookies()
  await page.goto(url+'/?social=login')
  await page.waitForSelector('dialog.account[open] input[type=password]')
  console.log('Fullscreen gesture, preference, session revalidation and OAuth return passed')
} finally {
  await browser?.close()
  await server.close()
}
