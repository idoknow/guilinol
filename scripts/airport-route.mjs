import './expanded-world-check.mjs'
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
  for(const route of ['drive','walk','lingui-walk','terminal-walk']){
    if(process.argv.length>2 && !process.argv.includes('--'+route))continue
    const mode=route==='drive'?'drive':'walk'
    const corridor=(kind,start,end)=>{
      const leg=config.corridors.find(c=>c.mode===kind&&c.start===start&&c.end===end)
      assert(leg,'Missing corridor from '+start+' to '+end)
      return leg.geometry.coordinates
    }
    let path
    if(route==='lingui-walk'){
      path=corridor('walk',legs[0],legs[1])
    }else if(route==='terminal-walk'){
      path=corridor('walk',legs[2],legs[3])
    }else if(mode==='walk'){
      // Tower and expo are modeled as shared street corridors. Join the
      // walking polyline at actual shared vertices, with no spawn between legs.
      const tower=corridor('drive','桂林塔',legs[1])
      const civic=corridor('walk',legs[1],legs[2])
      const west=corridor('walk',legs[2],legs[3])
      const expo=corridor('drive','临桂新区·会展','临桂万达')
      const junction=expo.findIndex(p=>west.some(q=>q[0]===p[0]&&q[1]===p[1]))
      assert(junction>=0,'Missing expo junction')
      const merge=west.findIndex(p=>p[0]===expo[junction][0]&&p[1]===expo[junction][1])
      path=[...tower,...civic.slice(1),...west.slice(1,merge+1),...expo.slice(0,junction).reverse()]
    }else{
      path=legs.slice(1).flatMap((end,i)=>corridor(mode,legs[i],end).slice(i?1:0))
    }
    // Use the published west approach pickup. The closest car by air is below the bridge.
    const car=vehicles.cars.find(([x,,z])=>Math.hypot(x+572,z+92)<5)
    if(mode==='drive'){
      assert(car,'Missing Jiefang East Road pickup')
      // Follow the north lane past the pedestrian entrance at Zhengyang Street.
      const gate=path.findIndex(([x,z])=>Math.hypot(x+608.6,z+104.9)<1)
      assert(gate>=0,'Missing Zhengyang junction on the westbound route')
      path.splice(gate,1,[-582,-101],[-609,-108],[-637,-115])
      path.unshift([-511,-70],[-378,-25])
      // On long OSM edges steer against a nearby point, so a small heading error
      // cannot carry the car across a curb before the next source vertex.
      const vertices=path.splice(0)
      path.push(vertices[0])
      for(let i=1;i<vertices.length;i++){
        const [ax,az]=vertices[i-1],[bx,bz]=vertices[i]
        const steps=Math.ceil(Math.hypot(bx-ax,bz-az)/12)
        for(let j=1;j<=steps;j++)path.push([ax+(bx-ax)*j/steps,az+(bz-az)*j/steps])
      }
    }
    const page=await browser.newPage()
    try {
      await page.goto(url+'/?verify&mode=walk&flow=0')
      await page.waitForFunction(driving=>window.viewer?.walk?.active && (!driving || window.viewer.walk.parked('car').length>0),mode==='drive',{timeout:90000})
      const start=mode==='drive'?[car[0],car[2]]:path[0]
      const readyBy=Date.now()+60000
      while(Date.now()<readyBy){
        const placed=await page.evaluate(async ([x,z])=>{
          const v=window.viewer
          if(v.walk.spawns.at(-1)?.reason==='airport-route')return true
          await v.walkTo(x,z,0,'airport-route')
          return v.walk.spawns.at(-1)?.reason==='airport-route'
        },start)
        if(placed)break
        await page.waitForTimeout(100)
      }
      assert.equal(await page.evaluate(()=>window.viewer.walk.spawns.at(-1)?.reason),'airport-route')
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
          let backing=false
          for(const [index,[east,south]] of path.entries()){
            const before=path[index-1],after=path[index+1]
            const turn=before && after && Math.abs(Math.atan2(
              (east-before[0])*(after[1]-south)-(south-before[1])*(after[0]-east),
              (east-before[0])*(after[0]-east)+(south-before[1])*(after[1]-south)))>.48
            const shortConnector=before && Math.hypot(east-before[0],south-before[1])<6
            const tolerance=mode==='walk' || turn?2:shortConnector?6:4
            let best=Infinity,stalled=0,reverse
            for(let tick=0;;tick++){
              const pos=walk.position,dx=east-pos.x,dz=south-pos.z,gap=Math.hypot(dx,dz)
              // Street centerline junctions can have a short connector inside the
              // turning circle. Capture those at lane-width tolerance.
              if(gap<tolerance || mode==='drive' && gap<6 && stalled>45 && !walk.obstacle)break
              if(gap<best-.5){best=gap;stalled=0}
              if(++stalled>900)throw Error(mode+' stalled at waypoint '+index+' from '+pos.toArray()+' target '+[east,south]+' heading '+walk.heading+' speed '+walk.speed+' obstacle '+walk.obstacle)
              if(mode==='walk')walk.drive(dx/gap,dz/gap,true)
              else{
                const angle=Math.atan2(-dx,-dz)-walk.heading,err=Math.atan2(Math.sin(angle),Math.cos(angle))
                // A corridor leg may end on the same street the next leg retraces.
                // Back out along the street until the next junction permits a forward turn.
                reverse ??= Math.abs(err)>Math.PI*(backing ? .35 : .68)
                backing=reverse
                const steering=reverse?Math.atan2(Math.sin(err),-Math.cos(err)):err
                const limit=Math.abs(err)>.3?2.5:turn?Math.min(8,2.5+Math.max(0,gap-5)*.18):8
                key('KeyA',steering>.035);key('KeyD',steering<-.035)
                key('KeyW',reverse?walk.speed < -3:walk.speed < limit)
                key('KeyS',reverse?walk.speed > -2.5:walk.speed > limit+1)
              }
              stream.tick(pos);stream.updateLandmarks?.(pos)
              walk.tick(1/30)
              if(tick%15===0 || walk.obstacle==='streaming'){
                if(walk.probe().resets!==initial)throw Error(mode+' reset at waypoint '+index)
                await new Promise(resolve=>setTimeout(resolve,0))
              }
            }
          }
          if(walk.probe().resets!==initial)throw Error(mode+' reset before arrival')
          return {waypoints:path.length,position:walk.position.toArray(),resets:walk.probe().resets-initial}
        }finally{
          for(const code of pressed)key(code,false)
          window.viewer.resume()
        }
      },{mode,path})
      if(route==='terminal-walk'){
        const [east,south]=path.at(-1)
        const error=Math.hypot(result.position[0]-east,result.position[2]-south)
        assert.ok(error<2,'Walker did not arrive at the landside destination')
        console.log(route,{waypoints:result.waypoints,resets:result.resets,arrivalErrorM:error})
      }else console.log(route,result)
    }finally{await page.close()}
  }
}finally{await browser?.close();await server.close()}
