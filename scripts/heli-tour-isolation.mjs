import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch(browserOptions());const page=await browser.newPage({viewport:{width:480,height:300}}),requests=[]
  page.on('request',request=>requests.push(request.url()))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&flow=0&radius=480`,{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0,null,{timeout:120000})
  assert.equal(await page.evaluate(()=>document.body.dataset.mode),'fly')
  assert.ok(await page.evaluate(()=>window.viewer.walkTo(-805.8,257.6,-1.57,'heli-tour-test')))
  await page.locator('.heli-mode-notice').waitFor({state:'visible',timeout:60000});await page.keyboard.press('KeyF')
  assert.equal(await page.locator('.heli-panel[open]').count(),0)
  assert.equal(await page.evaluate(()=>localStorage.getItem('glol.save.v1')),null)
  assert.deepEqual(requests.filter(url=>/\/(solo-layer|mission-ui|commerce|shop-overlay)[.-]/.test(url)),[])
  console.log('Free-tour flight entry, view-only helipad, zero save and lazy commerce passed')
}finally{await browser?.close();await server.close()}
