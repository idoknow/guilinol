import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {preview} from 'vite'
import {chromium} from 'playwright'

const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  await mkdir('captures/fishing',{recursive:true})
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:640,height:360}})
  const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.message)})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk&flow=0`)
  await page.waitForFunction(()=>window.viewer?.walk?.active && ![1,2].includes(window.__loading?.level) && document.querySelector('.hotbar:not([hidden])'),null,{timeout:90000})
  console.log('Walk ready',await page.evaluate(()=>({ride:document.body.dataset.ride,focus:document.activeElement.tagName,pos:window.viewer.walk.position.toArray(),shop:document.body.dataset.shopOpen})))
  await page.keyboard.press('4');await page.keyboard.press('Space');await page.waitForFunction(()=>window.fishing?.state?.().stage==='idle')
  assert(await page.evaluate(()=>window.fishing.teleportToSpot('lijiang_xiangbi')))
  await page.keyboard.press('4');await page.waitForFunction(()=>window.fishing.state().stage==='equip')
  const cast=()=>page.locator('[data-cast]').click()
  async function fight(wrong){await cast();return page.evaluate(wrong=>{
    const {fishing,viewer}=window;fishing.setSeed(1);fishing.forceBite();const key=(code,type)=>window.dispatchEvent(new KeyboardEvent(type,{code,cancelable:true}))
    const canvas=document.querySelector('canvas');canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'mouse',button:0,bubbles:true}))
    for(let index=0;index<900;index++){const {stage,direction}=fishing.state();if(!['hook','fight'].includes(stage))break
      key('KeyA','keyup');const aim=wrong?(direction===1?-1:1):direction;if(aim)key(aim<0?'KeyA':'KeyD','keydown');viewer.walk.tick(1/60)}
    window.dispatchEvent(new PointerEvent('pointerup',{pointerType:'mouse'}));key('KeyA','keyup');const final=fishing.state();if(final.stage==='idle')throw Error(JSON.stringify({final,pos:viewer.walk.position.toArray(),ride:viewer.walk.vehicle,focus:document.activeElement.outerHTML.slice(0,100),hidden:document.querySelector('.hotbar').hidden}));return final.stage
  },wrong)}
  assert.equal(await fight(false),'land');await page.screenshot({path:'captures/fishing/lure.png'});assert.equal(await fight(true),'snap')
  await page.locator('[data-method]').click()
  for(const [seed,result] of [[1,'land'],[9,'junk']]){await cast();assert.equal(await page.evaluate(seed=>{
    const {fishing,viewer}=window;fishing.setSeed(seed);fishing.forceBite();if(fishing.state().stage!=='bite')return 'no bite'
    document.querySelector('[data-strike]').click();for(let index=0;index<90&&fishing.state().stage==='strike';index++)viewer.walk.tick(1/60);return fishing.state().stage
  },seed),result)}
  await page.screenshot({path:'captures/fishing/pole.png'});await page.locator('[data-menu]').click();await page.getByRole('button',{name:'背包',exact:true}).click()
  const wallet=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('glol.save.v1')))
  const before=await wallet();await page.getByRole('button',{name:/^卖 \d/}).first().click();const after=await wallet();assert.equal(after.money-before.money,before.fishing.bag[0].price);assert.equal(after.fishing.bag.length,before.fishing.bag.length-1)
  await page.locator('[data-close]').click();await page.evaluate(async()=>{const {walk,walkTo}=window.viewer;const target=walk.parked('bike').find(row=>Math.hypot(row[0]+539,row[2]+95)<12)??walk.parked('bike')[0];await walkTo(target[0],target[2],0,'fishing-bike');for(let index=0;index<6;index++)walk.tick(1/60)})
  await page.waitForFunction(()=>document.querySelector('.vehicle-action')?.textContent==='骑电动车');await page.keyboard.press('f');await page.waitForFunction(()=>document.body.dataset.ride==='bike');await page.evaluate(()=>window.viewer.walk.ebike.setVehicleType('normal'));await page.keyboard.press('4');await page.waitForFunction(()=>document.querySelector('.ride-gear')?.textContent==='S');assert.equal(await page.evaluate(()=>window.fishing.state().stage),'idle')
  assert.deepEqual(errors,[]);console.log('Fishing browser: shore gate, lure land/snap, float land/junk, wallet, bike gear OK')
}finally{await browser?.close();await server.close()}
