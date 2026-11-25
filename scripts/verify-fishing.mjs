import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {verifyZones} from './fishing-zone-probes.mjs'

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
  await verifyZones(page)
  assert(await page.evaluate(()=>window.fishing.teleportToSpot('lijiang_xiangbi')))
  await page.keyboard.press('4');await page.waitForFunction(()=>window.fishing.state().stage==='equip')
  await page.evaluate(()=>{
    window.fishEvents=[]
    for(const name of ['charge','cast','cast-blocked','approach','nibble','hit','hooked','spooked','missed','fight'])window.addEventListener('fishing:'+name,event=>window.fishEvents.push([name,event.detail]))
  })
  await page.keyboard.down('Space');await page.waitForFunction(()=>window.fishEvents.some(([name,detail])=>name==='charge'&&detail.power>.95));await page.keyboard.up('Space')
  const landing=await page.evaluate(()=>window.fishEvents.find(([name])=>name==='cast')?.[1]);assert(landing,'charged keyboard cast');assert(landing.to.x<landing.from.x)
  const fight=async(mode,first=false)=>page.evaluate(({mode,first})=>{
    const {fishing,viewer}=window,press=()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'})),release=()=>window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}))
    if(!first&&!fishing.charge(1))throw Error('cast rejected: '+fishing.state().phase)
    if(first){for(let jerk=0;jerk<3;jerk++){press();release()};if(fishing.state().phase!=='retrieve')throw Error('early hook')}
    fishing.setSeed(1);fishing.forceHit();if(fishing.state().phase!=='hit')throw Error('no hit')
    press();let held=true;if(fishing.state().phase!=='fight')throw Error('strike failed')
    for(let tick=0;tick<3600;tick++){
      const {phase,tension}=fishing.state();if(phase!=='fight')break
      const reel=mode==='snap'||(mode==='land'&&tension<.65)
      if(held!==reel){if(reel)press();else release();held=reel}
      viewer.walk.tick(1/60)
    }
    release();return fishing.state().phase
  },{mode,first})
  assert.equal(await fight('land',true),'land');await page.screenshot({path:'captures/fishing/lure.png'})
  assert.equal(await fight('snap'),'snap');assert.equal(await fight('escape'),'escape')
  await page.locator('[data-method]').click()
  const phases=await page.evaluate(()=>{
    const {fishing,viewer}=window;fishing.charge(.8);fishing.setSeed(1);fishing.forceApproach()
    for(let tick=0;tick<60&&fishing.state().phase==='approach';tick++)viewer.walk.tick(1/60)
    const phase=fishing.state().phase;window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}))
    const reset=fishing.state().phase;fishing.setSeed(1);fishing.forceHit();for(let tick=0;tick<50;tick++)viewer.walk.tick(1/60)
    return [phase,reset,fishing.state().phase]
  });assert.deepEqual(phases,['nibble','wait','miss']);await page.screenshot({path:'captures/fishing/pole.png'})
  const invalid=await page.evaluate(()=>{
    const {fishing,viewer}=window,before=fishing.state().inventory.bait.bait11,grids=[...viewer.stream.loaded.values()].map(tile=>[tile.water,tile.water.slice()]);try{
      for(const [water] of grids)water.fill(-32768)
      return [fishing.charge(1),fishing.state().inventory.bait.bait11-before]
    }finally{for(const [water,snapshot] of grids)water.set(snapshot)}
  });assert.deepEqual(invalid,[false,0]);
  assert.deepEqual(await page.evaluate(()=>[...new Set(window.fishEvents.map(([name])=>name))].sort()),['approach','cast','cast-blocked','charge','fight','hit','hooked','missed','nibble','spooked'])
  await page.locator('[data-menu]').click();await page.getByRole('button',{name:'背包',exact:true}).click()
  const wallet=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('glol.save.v1')))
  const before=await wallet(),sell=page.getByRole('button',{name:/^卖 \d/}).first(),soldId=await sell.getAttribute('data-sell');await sell.click();const after=await wallet();assert.equal(after.money-before.money,before.fishing.bag.find(item=>item.id===soldId).price);assert.equal(after.fishing.bag.length,before.fishing.bag.length-1)
  await page.locator('[data-close]').click();await page.evaluate(async()=>{const {walk,walkTo}=window.viewer;const target=walk.parked('bike').find(row=>Math.hypot(row[0]+539,row[2]+95)<12)??walk.parked('bike')[0];await walkTo(target[0],target[2],0,'fishing-bike');for(let index=0;index<6;index++)walk.tick(1/60)})
  await page.waitForFunction(()=>document.querySelector('.vehicle-action')?.textContent==='骑电动车');await page.keyboard.press('f');await page.waitForFunction(()=>document.body.dataset.ride==='bike');await page.evaluate(()=>window.viewer.walk.ebike.setVehicleType('normal'));await page.keyboard.press('4');await page.waitForFunction(()=>document.querySelector('.ride-gear')?.textContent==='S');assert.equal(await page.evaluate(()=>window.fishing.state().stage),'idle')
  assert.deepEqual(errors,[]);console.log('Fishing browser: shore gate, lure land/snap, slack escape, float spook/miss, invalid cast, wallet, bike gear OK')
}finally{await browser?.close();await server.close()}
