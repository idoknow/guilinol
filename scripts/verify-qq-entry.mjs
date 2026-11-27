// 首页 QQ 群入口：导航按钮在桌面直接可见、手机点「更多」后可见，弹层里是二维码 + 可复制的群号。
// 只跑主界面，不进城市，所以不需要世界资产，几秒就能跑完。
import assert from 'node:assert/strict'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const QQ_GROUP = '1137384288'
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
  const entry = '.home-links [data-act=qq]'
  await page.waitForSelector(entry,{state:'visible',timeout:120000})
  assert.equal(await page.locator('.about-mask').count(),0,'the QQ panel must not exist before the entry is used')

  for (const [name,viewport] of [['desktop',{width:1280,height:720}],['phone',{width:390,height:844}],['small',{width:360,height:640}]]){
    await page.setViewportSize(viewport)
    // 手机默认收起（IDOK-468）：QQ 群在「更多」里。先确认它收着，点开再量。
    const fold = viewport.width<=760
    assert.equal(await page.locator('.home-more').isVisible(),fold,`${name}: 更多 toggle only on phones`)
    if (fold&&await page.getAttribute('.home-more','aria-expanded')!=='true'){
      assert.equal(await page.locator(entry).isVisible(),false,`${name}: entry folds behind 更多`)
      await page.click('.home-more')
    }
    const button = await page.evaluate(()=>{
      const element = document.querySelector('.home-links [data-act=qq]')
      const box = element.getBoundingClientRect()
      return {text:element.textContent.trim(),display:getComputedStyle(element).display,
        right:Math.round(box.right),bottom:Math.round(box.bottom),scrolls:document.querySelector('.home').scrollHeight>innerHeight}
    })
    assert.equal(button.text,'QQ 群',`${name}: entry label`)
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
    assert.equal(panel.masks,1,`${name}: the panel is built once and reused`)
    assert.ok(panel.fits,`${name}: panel body fits the viewport`)

    await page.click('.qq-copy')
    await page.waitForFunction(()=>document.querySelector('.qq-copy').textContent==='已复制',null,{timeout:5000})
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),QQ_GROUP,`${name}: copy puts the group number on the clipboard`)
    await page.waitForFunction(()=>document.querySelector('.qq-copy').textContent==='复制群号',null,{timeout:5000})

    await page.keyboard.press('Escape')
    await page.waitForFunction(()=>document.querySelector('.about-mask').hidden,null,{timeout:5000})
    assert.equal(await page.evaluate(()=>document.body.hasAttribute('data-home')),true,`${name}: Escape closes the panel, not the title screen`)
  }
  assert.deepEqual(errors,[],'the entry must not throw')
  console.log('Home page QQ group entry, QR panel and copy-to-clipboard passed')
} finally {
  await browser?.close()
  await server.close()
}