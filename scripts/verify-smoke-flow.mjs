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
      const dir=`captures/smoke-flow/round-2/${width}-${view}`
      await mkdir(dir,{recursive:true})
      await page.addInitScript(view=>localStorage.setItem('glol.prefs',JSON.stringify({view})),view)
      if(width===740)await page.addInitScript(()=>localStorage.setItem('glol.avatar.v1',JSON.stringify({body:'f',v:1,createdAt:123,skin:3,face:1,brows:0,eyes:0,hair:'f_bun',hairColor:1,look:'hoodie'})))
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
        await page.evaluate(()=>window.viewer.walk.face(window.viewer.walk.yaw+Math.PI-.95,.08))
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
        if(touch){
          await hint.filter({hasText:label}).waitFor()
          const clear=await hint.evaluate(el=>{
            const r=el.getBoundingClientRect()
            const overlap=b=>r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top
            const controls=document.querySelectorAll('.walk-ui button,.joystick,.hotbar,.dock-buttons button,.vehicle-action')
            return r.width>=44&&r.height>=44&&[...controls].every(c=>c===el||!c.getClientRects().length||!overlap(c.getBoundingClientRect()))
          })
          assert(clear,'touch action must have a free 44px hit target')
          await hint.tap()
        }else{
          await page.waitForFunction(()=>window.viewer.camera.getObjectByName('smoke-prompt')?.visible)
          await page.keyboard.press('f')
        }
      }
      async function capturePhase(name,phase,minProgress=0,puff=false){
        await page.waitForFunction(({phase,minProgress,puff})=>{
          const v=window.viewer.walk.probe().smoke
          const waiting=['sealed','open','ready','smoking'].includes(phase)&&!puff
          if(waiting&&(v.progress<.18||document.querySelector('.smoke-hint').hidden))return false
          if(v.phase!==phase || v.progress<minProgress || (puff && v.puff<.98))return false
          return true
        },{phase,minProgress,puff},{polling:'raf'}).catch(async error=>{
          console.error('Missed phase',phase,await page.evaluate(()=>({smoke:window.viewer.walk.probe().smoke,focus:document.activeElement?.className,interactions:window.worldInteractions})))
          throw error
        })
        await page.evaluate(()=>window.viewer.freeze())
        try{
          assert.equal(await page.evaluate(()=>window.viewer.walk.probe().smoke.phase),phase)
          if(['sealed','ready'].includes(phase)){
            const center=await page.evaluate(()=>{
              const camera=window.viewer.camera,prompt=camera.getObjectByName('smoke-prompt')
              const p=prompt.getWorldPosition(camera.position.clone()).project(camera)
              return {visible:prompt.visible,x:p.x,y:p.y}
            })
            assert.equal(center.visible,!touch)
            if(!touch)assert(Math.hypot(center.x,center.y)<.001,'3D text must project to the optical centre')
          }
          const mount=await page.evaluate(phase=>{
            const scene=window.viewer.camera.parent
            const name=['sealed','tear','open'].includes(phase)?'smoke-pack':phase==='take'||phase==='smoking'?'smoke-cigarette':'smoke-lighter'
            return scene.getObjectByName(name)?.parent?.name
          },phase)
          assert.equal(mount,phase==='take'?'smoke-grip-r':phase==='smoking'?'smoke-lips':'smoke-grip-l')
          if(view==='first' && (phase==='ready' || phase==='smoking')){
            const geometry=await page.evaluate(()=>{
              const camera=window.viewer.camera,cig=camera.parent.getObjectByName('smoke-lips').getObjectByName('smoke-cigarette')
              const point=z=>cig.localToWorld(camera.position.clone().set(0,0,z))
              const filter=point(-.02).project(camera)
              const axis=camera.worldToLocal(point(.064)).sub(camera.worldToLocal(point(-.02)))
              return {x:filter.x,y:filter.y,forward:axis.z,down:axis.y}
            })
            assert(Math.abs(geometry.x)<.002 && geometry.y< -1 && geometry.y> -1.25,'filter must meet the lower centre edge')
            assert(geometry.forward<-.08 && geometry.down<0,'ember must point forward and slightly down')
          }
          // Let the compositor present the last WebGL frame before the screenshot.
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
          await shot(name)
        }finally{await page.evaluate(()=>window.viewer.resume())}
      }
      if(width===1440 && view==='third'){
        await page.waitForFunction(()=>window.viewer.walk.probe().smoke.phase==='sealed')
        await page.evaluate(()=>{
          const c=window.viewer.camera,lips=c.parent.getObjectByName('smoke-lips')
          const p=lips.getWorldPosition(c.position.clone()).project(c)
          const w=innerWidth,h=innerHeight,scale=3.2
          c.setViewOffset(w,h,(p.x+1)*w/2-w*.37/scale,(1-p.y)*h/2-h*.42/scale,w/scale,h/scale)
        })
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
