import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const data=JSON.parse(gunzipSync(await readFile('dist/world/vehicles.bin')))
const car=data.cars.filter(point=>Math.hypot(point[0]+572,point[2]+92)<50)
  .sort((left,right)=>Math.hypot(left[0]+572,left[2]+92)-Math.hypot(right[0]+572,right[2]+92))[0]
assert(car,'no car at Wangcheng gate approach')
const route=[[-511,-70],[-378,-25],[-374,3],[-383,40],[-381,57],[-367,71],[-331,92],[-602,560],[-633,583],[-647,590],[-666,591],[-719,571],[-869,881],[-879,968],[-885,991],[-899,1010],[-924,1019],[-952,1023],[-1033,1024],[-1085,1018],[-1125,1007],[-1140,1006],[-1139,1015],[-1141,1022],[-1144,1032],[-1151,1053],[-1164,1094]]
const parking=[-1132.4,1072.8] // West access edge of OSM parking way 1430634139.
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch(browserOptions())
  await mkdir('captures/drive',{recursive:true})
  for(const [width,height] of [[1440,900],[390,844]]){
    const page=await browser.newPage({viewport:{width,height},isMobile:width===390,hasTouch:width===390})
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk`)
    await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:90000})
    assert(await page.evaluate(([east,,south])=>window.viewer.walkTo(east,south,0,'drive-start'),car))
    await page.waitForFunction(()=>document.querySelector('.vehicle-action')?.textContent==='开车')
    await page.keyboard.press('f')
    await page.waitForFunction(()=>window.viewer.walk.vehicle==='car')
    await page.screenshot({path:`captures/drive/${width}x${height}.png`,timeout:120000})
    if(width===1440){
      const result=await page.evaluate(async ({route,parking})=>{
        const {walk,stream}=window.viewer,pressed=new Set(),path=[],start=performance.now()
        function key(code,on){if(pressed.has(code)===on)return;window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code}));if(on)pressed.add(code);else pressed.delete(code)}
        for(const [east,south] of route){
          let reached=false
          const budget=600+Math.ceil(60*Math.hypot(east-walk.position.x,south-walk.position.z)/4)
          for(let frame=0;frame<budget;frame++){
            const pos=walk.position,dx=east-pos.x,dz=south-pos.z
            if(Math.hypot(dx,dz)<4){path.push([Math.round(pos.x),Math.round(pos.z)]);reached=true;break}
            const delta=Math.atan2(-dx,-dz)-walk.heading,error=Math.atan2(Math.sin(delta),Math.cos(delta))
            key('KeyA',error>.04);key('KeyD',error<-.04);key('KeyW',Math.abs(walk.speed)<(Math.abs(error)>.35?2.8:8))
            walk.tick(1/60)
            const probe=walk.probe()
            if(probe.inHouse||probe.renderClearance<-.6||Math.abs(walk.speed)>40/3.6+.001)throw Error(`unsafe position ${JSON.stringify(probe)}`)
            const {zone}=window.viewer.game.getState()
            if(zone.quiet||zone.carFree)throw Error(`entered forbidden zone at ${walk.position.toArray()}`)
            if(frame%20===0){stream.tick(walk.position);await new Promise(resolve=>setTimeout(resolve,0))}
          }
          if(!reached){const {hits,carContact}=walk.probe();throw Error(`stalled at ${walk.position.toArray()} heading for ${east},${south}: ${walk.obstacle} ${JSON.stringify({hits,carContact})}`)}
        }
        for(const code of pressed)key(code,false)
        return {path,elapsedMs:Math.round(performance.now()-start),distance:Math.hypot(walk.position.x-parking[0],walk.position.z-parking[1])}
      },{route,parking})
      console.log(result);assert(result.distance<=40,'missed parking radius')
      await page.screenshot({path:'captures/drive/parking.png',timeout:120000})
      await page.keyboard.press('f');await page.waitForFunction(()=>window.viewer.walk.vehicle==='foot')
    }
    await page.close()
  }
}finally{await browser?.close();await server.close()}
