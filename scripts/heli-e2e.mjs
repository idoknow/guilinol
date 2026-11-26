import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'
import {mkdir} from 'node:fs/promises'
import assert from 'node:assert/strict'
const output=process.env.HELI_CAPTURE_DIR??'captures/helicopter',server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  await mkdir(output,{recursive:true});browser=await chromium.launch(browserOptions(true))
  const page=await browser.newPage({viewport:{width:800,height:500}}),origin=`http://127.0.0.1:${server.httpServer.address().port}`
  const shot=async name=>{await page.screenshot({path:`${output}/${name}.jpg`,type:'jpeg',quality:80});console.log('captured',name)}
  const phase=async name=>page.waitForFunction(state=>window.viewer.heli.phase===state,name,{timeout:180000})
  const rate=async value=>page.evaluate(speed=>window.viewer.heli.rate(speed),value)
  const fps=async()=>page.evaluate(async()=>{const start=performance.now();for(let frame=0;frame<24;frame++)await new Promise(requestAnimationFrame);return 24000/(performance.now()-start)})
  await page.goto(`${origin}/?verify&solo=1&flow=0&radius=480`,{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:120000})
  assert.ok(await page.evaluate(()=>window.viewer.walkTo(-844,208,-2.51,'plaza-e2e')))
  await shot('01-spawn');const baseline=await fps()
  const approach=await page.evaluate(()=>{
    const player=window.viewer.walk
    for(let frame=0;frame<1000;frame++){
      const current=player.position,dx=-810-current.x,dz=258-current.z,distance=Math.hypot(dx,dz)
      if(distance<2){player.drive(0,0);return true}player.drive(dx/distance,dz/distance);player.tick(1/30)
    }
    return player.position.toArray()
  });assert.equal(approach,true,`walk to helipad: ${approach}`)
  await shot('02-pad');await page.locator('.heli-prompt').click();await shot('03-panel')
  for(const mode of ['low','high','dynamic']){
    await page.locator('.heli-panel select').selectOption(mode);await rate(1);await page.locator('.heli-confirm').click();await phase('board');if(mode==='low')await shot('04-board');await rate(4);await phase('ascend');if(mode==='low')await shot('05-ascent');await phase('cruise');await rate(1)
    await page.keyboard.press('KeyF');assert.equal(await page.evaluate(()=>window.viewer.heli.phase),'cruise');if(mode==='low')await shot('06-third')
    const flightFps=await fps();await page.keyboard.press('KeyT');assert.ok(await page.evaluate(()=>window.viewer.heli.first));if(mode==='low')await shot('07-first');await page.keyboard.press('KeyT');await rate(120);await phase('landed');if(mode==='low')await shot('08-landed');await rate(3);await page.keyboard.press('KeyF');await phase('idle');if(mode==='low')await shot('09-exit');console.log({mode,baseline,flightFps,ratio:flightFps/baseline})
    if(mode!=='dynamic')await page.locator('.heli-prompt').click()
  }
}finally{await browser?.close();await server.close()}
