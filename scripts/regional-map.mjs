import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const out='captures/regional'
await mkdir(out,{recursive:true})
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0,headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'credentialless'}}})
const browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
try {
  let panP95
  for(const expanded of [false,true]){
    const page=await browser.newPage({viewport:{width:1000,height:720}}),requests=[],errors=[]
    page.on('request',request=>requests.push(new URL(request.url()).pathname))
    page.on('pageerror',error=>errors.push(error.message))
    if(expanded)await page.route('**/world/manifest.json',async route=>{
      const response=await route.fetch(),manifest=await response.json()
      manifest.bbox=[25.212,110.243,25.366,110.352];await route.fulfill({response,json:manifest})
    })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&flow=0`)
    await page.waitForFunction(()=>window.viewer?.tour?.map,null,{timeout:60000})
    assert(!requests.includes('/world/overview.bin'))
    if(!expanded){
      await page.evaluate(()=>{window.viewer.camera.position.set(-2200,200,-200);window.viewer.tour.map.tick(1)})
      await page.waitForFunction(()=>performance.getEntriesByType('resource').some(item=>item.name.endsWith('/overview-edge.bin')))
      await page.locator('.minimap').screenshot({path:`${out}/mini.png`})
      assert(!requests.includes('/world/overview.bin'))
    }
    const loaded=page.waitForResponse('**/world/overview.bin');await page.evaluate(()=>window.viewer.tour.map.open());assert((await loaded).ok())
    const canvas=page.locator('.atlas canvas');await canvas.waitFor()
    await page.evaluate(()=>{window.viewer.camera.position.set(-885,170,-165);document.querySelector('.atlas-here').click()})
    if(!expanded){
      await page.screenshot({path:`${out}/city.png`})
      await page.evaluate(()=>{window.viewer.camera.position.x=-2210;document.querySelector('.atlas-here').click()})
      await page.screenshot({path:`${out}/edge.png`})
      await canvas.click({position:{x:250,y:380}});assert.equal(await page.locator('.atlas-pop').innerText(),'未开放')
      assert.equal(await page.locator('.atlas-pop button').count(),0)
    }
    await page.evaluate(()=>{
      const west=(110.25-110.3)*111320*Math.cos(25.28*Math.PI/180),south=(25.28-25.24)*110574
      window.viewer.camera.position.set(west,180,south);document.querySelector('.atlas-here').click()
      const canvas=document.querySelector('.atlas canvas');canvas.dispatchEvent(new WheelEvent('wheel',{clientX:500,clientY:360,deltaY:5000,cancelable:true}))
    })
    if(!expanded){await page.evaluate(()=>{window.viewer.tour.map.close();window.viewer.tour.map.open();document.querySelector('.atlas canvas').dispatchEvent(new WheelEvent('wheel',{clientX:500,clientY:360,deltaY:5000,cancelable:true}))})}
    await page.screenshot({path:`${out}/${expanded?'expanded':'region'}.png`})
    if(!expanded){
      await page.mouse.move(500,360);await page.mouse.wheel(0,-620);await page.waitForTimeout(100)
      await page.mouse.move(550,360);await page.mouse.down()
      const result=await page.evaluate(async()=>{
        const canvas=document.querySelector('.atlas canvas'),paint=[],frames=[];let previous
        for(let index=0;index<=30;index++){
          const now=await new Promise(requestAnimationFrame);if(previous)frames.push(now-previous);previous=now
          const start=performance.now();canvas.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:550+index*2,clientY:360,buttons:1}));paint.push(performance.now()-start)
        }
        const p95=values=>values.sort((first,second)=>first-second)[Math.ceil(values.length*.95)-1]
        return {frames:frames.length,frameP95:p95(frames),paintP95:p95(paint)}
      });await page.mouse.up();console.log(result);assert.equal(result.frames,30)
      panP95=result.frameP95
    }
    assert.deepEqual(errors,[]);await page.close()
  }
  assert(panP95<=16.700001,`pan frame p95 ${panP95}`)
} finally {await browser.close();await server.close()}
