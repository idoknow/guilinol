// 首页 QQ 群入口：导航按钮在桌面 / 手机 / 小屏都在视野内，弹层里是二维码 + 可复制的群号。
// 只跑主界面，不进城市，所以不需要世界资产，几秒就能跑完。
import assert from 'node:assert/strict'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const QQ_GROUP = '1137384288'
const DOUYIN_GROUP = '837801239688'
const server = await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser = await chromium.launch(browserOptions(true))
  const context = await browser.newContext({viewport:{width:1280,height:720},permissions:['clipboard-write','clipboard-read']})
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error=>errors.push(error.message))
  // 主界面自己会去请求统计与账号接口，本地没有那些服务，直接给空响应免得拖慢加载。
  await page.route('**/api/t', route=>route.fulfill({status:204}))
  await page.route('**/favicon.ico', route=>route.fulfill({status:204}))

  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{waitUntil:'domcontentloaded',timeout:90000})
  const entry = '.home-social [data-act=qq]'
  await page.waitForSelector(entry,{state:'visible',timeout:120000})
  assert.equal(await page.locator('.about-mask').count(),0,'the QQ panel must not exist before the entry is used')

  for (const [name,viewport] of [['desktop',{width:1280,height:720}],['phone',{width:390,height:844}],['small',{width:360,height:640}]]){
    await page.setViewportSize(viewport)
    const button = await page.evaluate(()=>{
      const element = document.querySelector('.home-social [data-act=qq]')
      const box = element.getBoundingClientRect()
      return {text:element.textContent.trim(),display:getComputedStyle(element).display,
        right:Math.round(box.right),bottom:Math.round(box.bottom),scrolls:document.querySelector('.home').scrollHeight>innerHeight}
    })
    assert.equal(button.text,'QQQ群扫码或链接加入',`${name}: entry label`)
    assert.equal(button.display,'flex',`${name}: entry is laid out in the nav row`)
    assert.ok(button.right<=viewport.width,`${name}: entry stays inside the viewport width`)
    // 小屏主界面可以纵向滚动，按钮只要在文档流里、不被裁掉即可。
    assert.ok(button.bottom<=viewport.height||button.scrolls,`${name}: entry is reachable`)

    await page.click(entry)
    await page.waitForSelector('.about-panel.qq',{state:'visible',timeout:15000})
    // The card is a 124KB WebP; wait for the decode itself, not just the element.
    await page.waitForFunction(()=>{const image=document.querySelector('.qq-code');return !!image&&image.complete&&image.naturalWidth>0},null,{timeout:15000})
    const panel = await page.evaluate(()=>{
      const image = document.querySelector('.qq-code')
      const body = document.querySelector('.qq-body').getBoundingClientRect()
      return {src:image.getAttribute('src'),natural:[image.naturalWidth,image.naturalHeight],
        loaded:image.complete&&image.naturalWidth>0,alt:image.getAttribute('alt'),
        num:document.querySelector('.qq-num').textContent.trim(),
        masks:document.querySelectorAll('.about-mask').length,
        fits:body.top>=0&&body.bottom<=innerHeight+.5}
    })
    assert.equal(panel.src,'./icons/qq-group.webp',`${name}: QR from the self-hosted icon`)
    assert.ok(panel.loaded,`${name}: QR image decodes`)
    assert.deepEqual(panel.natural,[881,1101],`${name}: QR card is the trimmed crop`)
    assert.match(panel.alt,new RegExp(QQ_GROUP),`${name}: QR alt carries the group number`)
    assert.equal(panel.num,QQ_GROUP,`${name}: group number is spelled out`)
    assert.ok(panel.masks>=1,`${name}: QQ panel exists`)
    assert.ok(panel.fits,`${name}: panel body fits the viewport`)

    await page.click('.qq-copy')
    await page.waitForFunction(()=>document.querySelector('.qq-copy').textContent==='已复制',null,{timeout:5000})
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),QQ_GROUP,`${name}: copy puts the group number on the clipboard`)
    await page.waitForFunction(()=>document.querySelector('.qq-copy').textContent==='复制群号',null,{timeout:5000})

    await page.keyboard.press('Escape')
    await page.waitForFunction(()=>document.querySelector('.about-mask').hidden,null,{timeout:5000})
    assert.equal(await page.evaluate(()=>document.body.hasAttribute('data-home')),true,`${name}: Escape closes the panel, not the title screen`)

    await page.click('.home-social [data-act="douyin-group"]')
    await page.waitForSelector('.about-panel.qq--douyin-group',{state:'visible',timeout:15000})
    await page.waitForFunction(()=>{const image=document.querySelector('.qq--douyin-group .qq-code');return !!image&&image.complete&&image.naturalWidth>0},null,{timeout:15000})
    const group = await page.evaluate(()=>({num:document.querySelector('.qq--douyin-group .qq-num').textContent.trim(),src:document.querySelector('.qq--douyin-group .qq-code').getAttribute('src'),natural:[document.querySelector('.qq--douyin-group .qq-code').naturalWidth,document.querySelector('.qq--douyin-group .qq-code').naturalHeight]}))
    assert.equal(group.num,DOUYIN_GROUP,`${name}: Douyin group number`)
    assert.equal(group.src,'./icons/douyin-group.webp',`${name}: Douyin group QR`)
    assert.deepEqual(group.natural,[560,560],`${name}: Douyin group QR dimensions`)
    await page.keyboard.press('Escape')
  }
  assert.deepEqual(errors,[],'the entry must not throw')
  console.log('Home page QQ group entry, QR panel and copy-to-clipboard passed')
} finally {
  await browser?.close()
  await server.close()
}