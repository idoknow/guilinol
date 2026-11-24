import {browserOptions} from './qa-browser.mjs'
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {telemetryPreview} from './telemetry-preview.mjs'

const site=await preview({root:'web',configFile:'web/vite.config.ts',plugins:[telemetryPreview],preview:{host:'127.0.0.1',port:0}})
const base='http://127.0.0.1:'+site.httpServer.address().port
let browser
try{
  browser=await chromium.launch(browserOptions())
  for(const [width,height] of [[1440,900],[844,390],[740,360]]){
    for(const view of ['first','third']){
      const touch=width<1000
      const page=await browser.newPage({viewport:{width,height},hasTouch:touch,isMobile:touch})
      page.setDefaultTimeout(30000)
      page.on('pageerror',error=>console.error('page error:',error.message))
      const dir=`captures/smoke-flow/${width}-${view}`
      await mkdir(dir,{recursive:true})
      await page.addInitScript(view=>localStorage.setItem('glol.prefs',JSON.stringify({view})),view)
      await page.goto(base+'/?verify&mode=walk&flow=0',{waitUntil:'domcontentloaded'})
      await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:120000})
      const slot=page.locator('.hotbar [data-slot=smoke]')
      const hint=page.locator('.smoke-hint')
      const shop=page.locator('.shop-overlay.show')
      const select=()=>touch?slot.tap():page.keyboard.press('3')
      const shot=name=>{console.log(width,view,name);return page.screenshot({path:dir+'/'+name+'.jpg',quality:75,timeout:60000})}
      await slot.waitFor()
      await page.waitForFunction(()=>{
        const slot=document.querySelector('.hotbar [data-slot=smoke]')
        if(!slot || document.body.hasAttribute('data-home'))return false
        const r=slot.getBoundingClientRect()
        return slot.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))
      },null,{timeout:90000})
      if(view==='third'){
        await page.evaluate(()=>window.viewer.walk.face(window.viewer.walk.yaw+Math.PI-.35,.08))
        await page.mouse.move(width/2,height*.6)
        await page.mouse.wheel(0,-1200)
      }
      await select()
      await shop.waitFor()
      await shop.locator('.shop-act-primary').click()
      await page.waitForFunction(()=>JSON.parse(localStorage.getItem('glol.save.v1')).packs.length===1)
      await shot('01-shop')
      await shop.locator('.shop-act-close').click()
      await shop.waitFor({state:'hidden'})
      await page.evaluate(()=>{
        window.worldInteractions=0
        window.addEventListener('keydown',event=>{if(event.code==='KeyF')window.worldInteractions++})
      })
      await select()
      async function press(label){
        await hint.filter({hasText:label}).waitFor()
        if(touch)await hint.tap()
        else await page.keyboard.press('f')
      }
      async function capturePhase(name,phase,minProgress=0,puff=false){
        await page.waitForFunction(({phase,minProgress,puff})=>{
          const v=window.viewer.walk.probe().smoke
          const waiting=['sealed','open','ready','smoking'].includes(phase)&&!puff
          if(waiting&&(v.progress<.18||document.querySelector('.smoke-hint').hidden))return false
          if(v.phase!==phase || v.progress<minProgress || (puff && v.puff<.25))return false
          return true
        },{phase,minProgress,puff},{polling:'raf'})
        await page.evaluate(()=>window.viewer.freeze())
        try{
          assert.equal(await page.evaluate(()=>window.viewer.walk.probe().smoke.phase),phase)
          // Let the compositor present the last WebGL frame before the screenshot.
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
          await shot(name)
        }finally{await page.evaluate(()=>window.viewer.resume())}
      }
      await capturePhase('02-pack','sealed')
      await press('撕开')
      await capturePhase('03-tear','tear',.25)
      await capturePhase('04-open','open')
      await press('拿取')
      await capturePhase('05-take','take',.28)
      await capturePhase('06-mouth','ready')
      await press('点燃')
      await capturePhase('07-light','light',.45)
      await capturePhase('08-lit','smoking')
      for(const name of ['09-puff','10-puff','11-puff']){
        await press('吸一口')
        await capturePhase(name,'smoking',0,true)
      }
      await select()
      await hint.waitFor({state:'hidden'})
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('glol.save.v1')).packs[0].remaining),19)
      await shot('12-discard')
      assert.equal(await page.evaluate(()=>window.viewer.walk.probe().smoke.phase),'idle')
      if(!touch){
        assert.equal(await page.evaluate(()=>window.worldInteractions),0)
        await page.keyboard.press('f')
        assert.equal(await page.evaluate(()=>window.worldInteractions),1)
      }
      console.log(dir)
      await page.close()
    }
  }
  const disabled=await browser.newPage()
  await disabled.goto(base+'/?verify&mode=walk&smoke=0&flow=0',{waitUntil:'domcontentloaded'})
  await disabled.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:120000})
  assert.equal(await disabled.locator('[data-slot=smoke],[data-shop=smoke],.smoke-hint').count(),0)
  await disabled.close()
}finally{await browser?.close();await new Promise(resolve=>site.httpServer.close(resolve))}
