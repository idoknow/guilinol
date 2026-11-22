import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {setTimeout as wait} from 'node:timers/promises'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const origin=`http://127.0.0.1:${server.httpServer.address().port}`
let browser
try {
  browser=await chromium.launch(browserOptions())
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
    const mobile=viewport.width<500,dir=`${process.env.LOADING_CAPTURE_DIR??'out/loading'}/${mobile?'mobile':'desktop'}`
    await mkdir(dir,{recursive:true})
    const context=await browser.newContext({viewport,hasTouch:mobile}),page=await context.newPage()
    page.setDefaultTimeout(90000)
    const shot=async name=>{await page.screenshot({path:`${dir}/${name}.png`});console.log(`${dir}/${name}`)}
    const atlas=Promise.withResolvers(),landing=Promise.withResolvers();let holdLanding=false
    let tileDelay=300,fail=false,failures=0
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url()),path=url.pathname
      if(url.origin!==origin)return route.abort()
      if(path==='/api/me')return route.fulfill({json:{nickname:'测试游客',email:'loading@example.invalid'}})
      if(path==='/api/me/avatar')return route.fulfill({json:{avatar:{v:1,createdAt:1,body:'f'}}})
      if(path.startsWith('/api/'))return route.fulfill({json:{}})
      if(/\/main-[^/]+\.js$/.test(path))await wait(700)
      if(path.endsWith('atlas.bin'))await atlas.promise
      if(path.endsWith('.glc')){if(fail&&!failures++){return route.fulfill({status:500})}await Promise.all([wait(tileDelay),holdLanding?landing.promise:Promise.resolve()])}
      if(path.endsWith('manifest.json')||path.endsWith('overview.png')||path.endsWith('atlas.bin'))await wait(1600)
      await route.continue().catch(()=>{})
    })
    await page.addInitScript(()=>{Object.defineProperty(window,'devicePixelRatio',{value:.6});window.samples=[];setInterval(()=>{if(window.__loading)window.samples.push({...window.__loading})},100)})
    await page.goto(origin,{waitUntil:'domcontentloaded'})
    await page.evaluate(()=>history.replaceState(null,'','?verify&cam=foot'))
    await page.locator('[data-umami-event=home-tour]').click()
    await page.waitForFunction(()=>window.__loading?.fraction>=.24);await shot('full-25')
    await page.waitForFunction(()=>window.__loading?.fraction>=.69);await shot('full-70')
    await page.waitForFunction(()=>window.viewer?.stats.readyMs&&window.viewer.tour)
    const {stats,samples}=await page.evaluate(()=>({stats:window.viewer.stats,samples:window.samples.filter(sample=>sample.level===1)}))
    assert(stats.readyMs>=stats.openingRingMs&&stats.readyMs>=stats.firstMs)
    assert(new Set(samples.map(sample=>sample.stage)).size>=4);assert.equal(samples.at(-1).fraction,1)
    assert(samples.every((sample,index)=>!index||sample.fraction>=samples[index-1].fraction))
    await page.locator('.ld-skeleton').waitFor();await shot('panel-skeleton');atlas.resolve()
    const pose=()=>page.evaluate(()=>[...window.viewer.camera.position.toArray(),...window.viewer.camera.quaternion.toArray()])
    tileDelay=20000;holdLanding=true
    const before=await page.evaluate(()=>{window.viewer.camera.position.set(-924,200,2990);const camera=window.viewer.camera;const start=[...camera.position.toArray(),...camera.quaternion.toArray()];window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyV'}));return start})
    const cancelButton=page.locator('.ld-veil button');await cancelButton.waitFor();await shot('veil')
    const pendingSamples=await page.evaluate(()=>window.samples.filter(sample=>sample.level===2&&sample.stage==='正在落地'))
    assert(pendingSamples.length>0&&pendingSamples.every((sample,index)=>!index||sample.fraction>=pendingSamples[index-1].fraction))
    await cancelButton.click();landing.resolve();holdLanding=false;console.log('flight cancelled');await page.locator('.ld-veil').waitFor({state:'detached'})
    await wait(6000);assert.deepEqual(await pose(),before);assert.equal(await page.locator('body').getAttribute('data-mode'),'fly')
    tileDelay=1000;await page.evaluate(()=>window.viewer.camera.position.set(-924.31,200,-104.93));await page.keyboard.press('KeyV')
    await page.waitForFunction(()=>window.viewer.walk?.active&&!document.querySelector('.ld-veil'))
    const progress=await page.evaluate(()=>window.samples.filter(sample=>sample.level===2&&sample.stage==='正在落地').map(sample=>sample.fraction));assert(progress.length>0)
    await page.evaluate(()=>window.viewer.walkTo(-450.81,-729.05,0,'verify-loading'))
    await page.locator('.ld-corner').waitFor();await shot('corner')
    await page.waitForFunction(()=>!window.viewer.stream.pending.size&&!window.viewer.stream.updateLandmarks?.pendingCount())
    await page.locator('.ld-corner').waitFor({state:'hidden',timeout:1200})
    fail=true;await page.goto(`${origin}/?verify`,{waitUntil:'domcontentloaded'});await page.locator('#boot.failed').waitFor();await shot('full-fail')
    fail=false;await page.getByRole('button',{name:'重试'}).click();await page.waitForFunction(()=>window.viewer?.stats.readyMs>0)
    await page.goto(origin,{waitUntil:'domcontentloaded'});const saved=await page.evaluate(()=>localStorage.getItem('glol.playMode'));tileDelay=20000
    await page.locator('[data-umami-event=home-solo]').click();await page.getByRole('button',{name:'取消',exact:true}).click()
    await page.waitForFunction(()=>document.body.hasAttribute('data-home'));await wait(6000)
    assert.equal(await page.evaluate(()=>localStorage.getItem('glol.playMode')),saved);assert.equal(await page.locator('body[data-mode=fly]').count(),0)
    console.log(JSON.stringify({viewport,stats,stages:[...new Set(samples.map(sample=>sample.stage))]}));await context.close()
  }
} finally {await browser?.close();await server.close()}
