import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {gzipSync,gunzipSync} from 'node:zlib'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const baked=JSON.parse(gunzipSync(await readFile('dist/world/vehicles.bin')))
const scenarios={east:[-636,-101,-1.81],west:[-583,-98.4,1.33],entrance:[-611,-96,2.98]}
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser=await chromium.launch(browserOptions());await mkdir('captures/jiefang-mouth',{recursive:true})
  for(const [name,[x,z,yaw]] of Object.entries(scenarios)){
    const page=await browser.newPage({viewport:{width:800,height:450}})
    const fixture={...baked,cars:[[x,157,z,yaw,0]],bikes:[],sharedBikes:[],bicycles:[]}
    await page.route('**/world/vehicles.bin',route=>route.fulfill({body:gzipSync(JSON.stringify(fixture))}))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk&flow=0`)
    await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:90000})
    assert(await page.evaluate(([x,z])=>window.viewer.walkTo(x,z,0,'jiefang-mouth'),[x,z]))
    await page.waitForFunction(()=>document.querySelector('.vehicle-action:not([hidden])')?.textContent==='开车')
    await page.keyboard.press('f');await page.waitForFunction(()=>window.viewer.walk.vehicle==='car')
    const result=await page.evaluate(async({x,z,yaw,name})=>{
      const {walk,game}=window.viewer;await window.viewer.freeze()
      const keys=new Set()
      function key(code,on){if(keys.has(code)===on)return;window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code}));if(on)keys.add(code);else keys.delete(code)}
      const obstacles=new Set();let distance=0
      try {for(let frame=0;frame<1400;frame++){
        const along=(walk.position.x-x)*-Math.sin(yaw)+(walk.position.z-z)*-Math.cos(yaw)
        const dx=x-(along+6)*Math.sin(yaw)-walk.position.x,dz=z-(along+6)*Math.cos(yaw)-walk.position.z
        const delta=Math.atan2(-dx,-dz)-walk.heading,error=Math.atan2(Math.sin(delta),Math.cos(delta))
        key('KeyA',error>.03);key('KeyD',error<-.03);key('KeyW',walk.speed<(Math.abs(error)>.3?2:6))
        walk.tick(1/60);distance=Math.hypot(walk.position.x-x,walk.position.z-z)
        if(walk.obstacle)obstacles.add(walk.obstacle)
        if(game.getState().zone.carFree)throw Error('vehicle entered pedestrian area')
        if(name!=='entrance' && distance>=48)break
      }}finally{for(const code of keys)key(code,false);window.viewer.resume()}
      return {distance,obstacles:[...obstacles],end:walk.position.toArray(),speed:walk.speed}
    },{x,z,yaw,name})
    console.log(name,result)
    await page.screenshot({path:`captures/jiefang-mouth/${name}.png`});await page.close()
    if(name==='entrance')assert(result.distance>1&&result.distance<8&&Math.abs(result.speed)<.1&&result.obstacles.some(reason=>reason==='restricted'||reason==='off-road'))
    else assert(result.distance>=48&&!result.obstacles.includes('restricted'))
  }
}finally{await browser?.close();await server.close()}
