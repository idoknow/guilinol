import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const config=JSON.parse(await readFile('pipeline/region.json','utf8'))
const vehicles=JSON.parse(gunzipSync(await readFile('dist/world/vehicles.bin')))
const legs=['老城核心','临桂老城·区政府','临桂新区市政中心','两江机场']
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const url='http://127.0.0.1:'+server.httpServer.address().port
let browser
try {
  browser=await chromium.launch(browserOptions())
  for(const mode of ['drive','walk']){
    const path=legs.slice(1).flatMap((end,i)=>{
      const route=config.corridors.find(c=>c.mode===mode&&c.start===legs[i]&&c.end===end)
      assert(route,'Missing '+mode+' leg to '+end)
      return route.geometry.coordinates.slice(i?1:0)
    })
    // Use the published west approach pickup. The closest car by air is below the bridge.
    const car=vehicles.cars.find(([x,,z])=>Math.hypot(x+572,z+92)<5)
    if(mode==='drive'){
      assert(car,'Missing Jiefang East Road pickup')
      // Follow the north lane past the pedestrian entrance at Zhengyang Street.
      const gate=path.findIndex(([x,z])=>Math.hypot(x+608.6,z+104.9)<1)
      assert(gate>=0,'Missing Zhengyang junction on the westbound route')
      path.splice(gate,1,[-582,-101],[-609,-108],[-637,-115])
      path.unshift([-511,-70],[-378,-25])
    }
    const page=await browser.newPage()
    try {
      await page.goto(url+'/?verify&mode=walk&flow=0')
      await page.waitForFunction(()=>window.viewer?.walk?.active && window.viewer.walk.parked('car').length>0,null,{timeout:90000})
      const start=mode==='drive'?[car[0],car[2]]:path[0]
      assert(await page.evaluate(([x,z])=>window.viewer.walkTo(x,z,0,'airport-route'),start))
      if(mode==='drive'){
        await page.waitForFunction(()=>document.querySelector('.vehicle-action')?.textContent==='开车')
        await page.keyboard.press('f')
        await page.waitForFunction(()=>window.viewer.walk.vehicle==='car')
      }
      const result=await page.evaluate(async({mode,path})=>{
        const {walk,stream}=window.viewer
        const initial=walk.probe().resets,pressed=new Set()
        function key(code,down){
          if(pressed.has(code)===down)return
          window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code}))
          if(down)pressed.add(code);else pressed.delete(code)
        }
        await window.viewer.freeze()
        try {
          for(const [index,[east,south]] of path.entries()){
            let best=Infinity,stalled=0
            for(let tick=0;;tick++){
              const pos=walk.position,dx=east-pos.x,dz=south-pos.z,gap=Math.hypot(dx,dz)
              if(gap<(mode==='drive'?5:2))break
              if(gap<best-.5){best=gap;stalled=0}
              if(++stalled>900)throw Error(mode+' stalled at waypoint '+index+' from '+pos.toArray()+' obstacle '+walk.obstacle)
              if(mode==='walk')walk.drive(dx/gap,dz/gap,true)
              else{
                const angle=Math.atan2(-dx,-dz)-walk.heading,err=Math.atan2(Math.sin(angle),Math.cos(angle))
                key('KeyA',err>.035);key('KeyD',err<-.035);key('KeyW',Math.abs(walk.speed)<(Math.abs(err)>.35?2.8:8))
              }
              stream.tick(pos);stream.updateLandmarks?.(pos)
              walk.tick(1/30)
              if(tick%15===0 || walk.obstacle==='streaming'){
                if(walk.probe().resets!==initial)throw Error(mode+' reset at waypoint '+index)
                await new Promise(resolve=>setTimeout(resolve,0))
              }
            }
          }
          if(walk.probe().resets!==initial)throw Error(mode+' reset before T2')
          return {waypoints:path.length,position:walk.position.toArray(),resets:walk.probe().resets-initial}
        }finally{
          for(const code of pressed)key(code,false)
          window.viewer.resume()
        }
      },{mode,path})
      console.log(mode,result)
    }finally{await page.close()}
  }
}finally{await browser?.close();await server.close()}
