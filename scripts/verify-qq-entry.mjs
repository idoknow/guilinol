// IDOK-156: 首页 QQ 群入口 — 按钮可达、弹层只建一次、二维码加载、群号可复制、Escape 只关弹层。
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const GROUP='1137384288',dir=process.env.QQ_CAPTURE_DIR??'out/qq'
await mkdir(dir,{recursive:true})
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const origin=`http://127.0.0.1:${server.httpServer.address().port}`
let browser
try {
  browser=await chromium.launch(browserOptions())
  for(const [name,viewport] of [['desktop',{width:1280,height:720}],['mobile',{width:390,height:844}],['small',{width:360,height:640}]]){
    const mobile=viewport.width<500
    const context=await browser.newContext({viewport,hasTouch:mobile,isMobile:mobile,permissions:['clipboard-read','clipboard-write']}),page=await context.newPage()
    await page.route('**/*',route=>{const url=new URL(route.request().url())
      if(url.origin!==origin)return route.abort()
      if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,json:{}})
      return route.continue()})
    await page.goto(origin,{waitUntil:'domcontentloaded'})
    const button=page.locator('.home-links [data-act=qq]')
    await button.scrollIntoViewIfNeeded();await button.click()
    const panel=page.locator('.about-panel.qq');await panel.waitFor()
    await page.waitForFunction(()=>{const img=document.querySelector('.qq-code');return img?.complete&&img.naturalWidth===881})
    assert.equal((await page.locator('.qq-num').textContent()).trim(),GROUP)
    const num=await page.locator('.qq-num').boundingBox();assert(num&&num.width>=80&&await page.locator('.qq-num').isVisible(),'group number not visible')
    const box=await page.locator('.qq-code').boundingBox();assert(box.width>=240,`QR too small: ${box.width}`)
    const pbox=await panel.boundingBox();assert(pbox.y>=0&&pbox.y+pbox.height<=viewport.height+1,'panel outside viewport')
    await page.screenshot({path:`${dir}/${name}.png`})
    await page.locator('.qq-copy').click()
    await page.waitForFunction(()=>document.querySelector('.qq-copy').textContent.includes('已复制'))
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),GROUP)
    await page.keyboard.press('Escape')
    await page.locator('.about-mask:has(.qq)').waitFor({state:'hidden'})
    assert(await page.locator('.home').isVisible(),'Escape closed the home screen too')
    await button.click();await panel.waitFor()
    assert.equal(await page.locator('.about-panel.qq').count(),1)
    await page.locator('.about-mask:has(.qq)').click({position:{x:4,y:4}})
    await page.locator('.about-mask:has(.qq)').waitFor({state:'hidden'})
    console.log(`${name} ok · QR ${Math.round(box.width)}px · panel ${Math.round(pbox.height)}px`)
    await context.close()
  }
  console.log('Home page QQ group entry, QR panel and copy-to-clipboard passed')
} finally {await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve))}
