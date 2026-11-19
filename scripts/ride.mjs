import {browserOptions, recordFrames} from './qa-browser.mjs'
import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {rideToCrossroads} from './ride-route.mjs'
import {lakeChecks} from './ride-lake.mjs'

const data=JSON.parse(gunzipSync(await readFile('dist/world/vehicles.bin')))
const atlas=JSON.parse(gunzipSync(await readFile('dist/world/atlas.bin')))
const output='captures/ride';await mkdir(output,{recursive:true})
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const browser=await chromium.launch(browserOptions())
const errors=[]
const bounds=JSON.parse(await readFile('pipeline/vessel-bounds.json','utf8'))
const {bridges,minimum}=data.clearance
assert(bridges.length?minimum>=.3-1e-10:minimum===null)
console.log(`航线经过 ${bridges.length} 座桥；最小净空：${minimum===null?'不适用':minimum.toFixed(3)+' m'}`)
try{
  for(const mobile of [false,true]){
    const page=await browser.newPage({viewport:mobile?{width:420,height:740}:{width:800,height:450},hasTouch:mobile,isMobile:mobile})
    page.on('pageerror',error=>errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?mode=walk&verify&radius=480`)
    await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:90000})
    await recordFrames(page)
    if(!mobile){const boat=await lakeChecks(page,data,output);assert(boat.roof<=bounds.boat.roof+1e-6&&boat.head<=bounds.boat.head+1e-6)}
    async function fixture(x,z){assert(await page.evaluate(async([x,z])=>{const walker=window.viewer.walk;walker.leave();return walker.enter(x,z,0,'ride-fixture')},[x,z]))}
    const button=page.locator('.vehicle-action')
    async function interact(label){const close=page.locator('.spot-card.show .card-close');if(await close.isVisible())await close.click();await page.waitForFunction(label=>document.querySelector('.vehicle-action')?.textContent.includes(label),label);if(mobile)await button.tap();else await page.keyboard.press('e')}
    async function shot(name){await page.screenshot({path:`${output}/${name}.png`})}
    async function timings(){return page.evaluate(async()=>{const samples=[];for(let frame=0;frame<24;frame++){await new Promise(requestAnimationFrame);samples.push(window.viewer.stats.ms)}return samples.sort((a,b)=>a-b)[12]})}
    const gate=[-588,-212],distance=bike=>Math.hypot(bike[0]-gate[0],bike[2]-gate[1]);const bike=[...data.bikes].sort((first,second)=>distance(first)-distance(second))[0]
    await fixture(bike[0],bike[2]);const foot=mobile?0:await timings();await interact('骑行')
    assert.equal(await page.evaluate(()=>window.viewer.walk.vehicle),'bike')
    async function steer(target,wall=false){return page.evaluate(({target,wall})=>{
      const walker=window.viewer.walk,keys=new Set(),start=walker.position.clone()
      function press(code,on){if(keys.has(code)===on)return;window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code}));if(on)keys.add(code);else keys.delete(code)}
      for(let frame=0;frame<1200;frame++){
        const pos=walker.position,dx=target[0]-pos.x,dz=target[1]-pos.z,angle=Math.atan2(-dx,-dz)-walker.heading,error=Math.atan2(Math.sin(angle),Math.cos(angle))
        if(!wall&&Math.hypot(dx,dz)<3)break
        press('KeyA',error>.05);press('KeyD',error<-.05);press('KeyW',Math.abs(error)<.65);walker.tick(1/60)
        if(walker.probe().inHouse||walker.speed>25/3.6+.001)throw Error('unsafe ride')
      }
      for(const key of [...keys])press(key,false)
      const end=walker.position.clone();return {distance:end.distanceTo(start),targetDistance:Math.hypot(end.x-target[0],end.z-target[1]),end:end.toArray(),obstacle:walker.obstacle,speed:walker.speed}
    },{target,wall})}
    const ride=await rideToCrossroads(page,atlas);console.log('ride',ride);assert(ride.main>=500&&ride.crossed&&ride.targetDistance<=10)
    await shot(mobile?'bike-mobile':'bike-desktop');if(!mobile)console.log('median frame ms',{foot,bike:await timings()})
    await interact('下车');assert.equal(await page.evaluate(()=>window.viewer.walk.vehicle),'foot')
    if(!mobile){
      await fixture(-31,510.3);await interact('骑行');const wall=await steer([-42,510.5],true);console.log('wall',wall);assert(wall.obstacle==='building'&&wall.speed===0&&wall.distance<8);await interact('下车')
      const [x,,z]=data.docks['解放桥码头'];await fixture(x,z);await shot('dock');await interact('上船');
      const distance=await page.evaluate((bounds)=>{const walker=window.viewer.walk,start=walker.position.clone();for(let frame=0;frame<3600;frame++){walker.tick(1/60);const probe=walker.boatClearance();if(probe?.kind!=='raft'||probe.clearance<.3||probe.roof-walker.position.y>bounds.roof+1e-6||probe.head-walker.position.y>bounds.head+1e-6)throw Error(`unsafe raft: ${JSON.stringify(probe)}`)}return walker.position.distanceTo(start)},bounds.raft)
      assert(distance>80&&distance<125);await shot('boat');await interact('下站下船')
      await page.evaluate(async()=>{const {walk,stream}=window.viewer;for(let count=0;count<4000&&walk.vehicle==='boat';count++){walk.tick(.12);if(count%24===0){stream.tick(walk.position);await new Promise(requestAnimationFrame)}}})
      assert.equal(await page.evaluate(()=>window.viewer.walk.vehicle),'foot');console.log('60s boat displacement',distance)
    }
    await page.close()
  }
  assert.deepEqual(errors,[])
}finally{await browser.close();await server.close()}
