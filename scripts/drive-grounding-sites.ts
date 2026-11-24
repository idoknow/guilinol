// Exercise the normal parked-vehicle mount and driving controllers at the audit sites.
import fs from 'node:fs'
import {gzipSync,gunzipSync} from 'node:zlib'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'
import {withFixtureBays} from './ride-fixture-bays.mjs'
import {vehicleSurface} from './vehicle-surface'
import {sites} from './vehicle-grounding-sites'
import {poseAt} from '../web/src/traffic/sim'

const world='dist/world'
const packed=(file:string)=>JSON.parse(gunzipSync(fs.readFileSync(world+'/'+file)).toString())
const graph=packed('roads/graph.json.gz'),vehicles=packed('vehicles.bin')
const surface=vehicleSurface(world,JSON.parse(fs.readFileSync(world+'/manifest.json','utf8')))
const nodes=new Map(graph.nodes.map(node=>[node.id,node]))
const cases=sites.map(([name,id,f])=>{
  const lane=graph.lanes.find(l=>l.id===id),a=nodes.get(lane.from),b=nodes.get(lane.to)
  const len=Math.hypot(b.x-a.x,b.z-a.z),dx=(b.x-a.x)/len,dz=(b.z-a.z)/len
  const x=a.x+dx*f*len-dz*lane.offset,z=a.z+dz*f*len+dx*lane.offset
  return {name,lane,row:[x,poseAt(lane.wheelPose,f,1),z,Math.atan2(-dx,-dz),0]}
})
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const browser=await chromium.launch(browserOptions()),results=[]
const out='captures/vehicle-grounding'
fs.mkdirSync(out,{recursive:true})
try{
  for(const [kind,field] of [['car','cars'],['bike','bikes'],['bicycle','bicycles']]){
    const page=await browser.newPage({viewport:{width:600,height:400}})
    const bays=cases.map(c=>c.row)
    const body=gzipSync(JSON.stringify({...(kind==='bike'?withFixtureBays(vehicles,bays):vehicles),cars:[],bicycles:[],bikes:[],sharedBikes:[],[field]:bays}))
    await page.route('**/world/vehicles.bin',route=>route.fulfill({body}))
    await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/?verify&mode=walk&radius=480&flow=0')
    await page.waitForFunction(()=>window.viewer?.walk?.parked().length,null,{timeout:60000})
    for(const {name,lane,row} of cases){
      try{
        if(!await page.evaluate(([x,,z])=>window.viewer.walkTo(x,z,0,'grounding-drive'),row))throw Error('Spawn unavailable')
        await page.waitForFunction(()=>!!document.querySelector('.vehicle-action:not([hidden])')?.textContent,null,{timeout:5000})
        await page.keyboard.press('f')
        await page.waitForFunction(k=>window.viewer.walk.vehicle===k,kind,{timeout:5000})
        const trace=await page.evaluate(async k=>{
          const v=window.viewer,w=v.walk,rig=v.stream.scene.getObjectByName('dynamic-'+(k==='bike'?'ebike':k)),trace=[]
          const points=k==='car'?[[-.795,-1.34],[.795,-1.34],[-.795,1.31],[.795,1.31]]:k==='bike'?[[0,-.66],[0,.62]]:[[0,-.54],[0,.54]]
          if(k==='bike'){w.ebike.setPark(false,true);w.ebike.setKickstand(false,true)}
          const start=w.position.clone()
          await v.freeze()
          window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',bubbles:true}))
          try{
            for(let i=0;i<240;i++){
              v.stream.tick(w.position);v.stream.updateLandmarks?.(w.position);w.tick(1/60)
              if(i%10===0)await new Promise(r=>setTimeout(r,0))
              if(i%5===0){
                rig.updateWorldMatrix(true,false)
                trace.push(points.map(([x,z])=>rig.position.clone().set(x,0,z).applyMatrix4(rig.matrixWorld).toArray()))
                if(Math.hypot(w.position.x-start.x,w.position.z-start.z)>=6)break
              }
            }
          }finally{window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW',bubbles:true}));v.resume()}
          return trace
        },kind)
        const distance=Math.hypot(trace.at(-1)[0][0]-trace[0][0][0],trace.at(-1)[0][2]-trace[0][0][2])
        const gaps=trace.flat().map(([x,y,z])=>y-surface(x,z,lane))
        results.push({name,kind,distance,min:Math.min(...gaps),max:Math.max(...gaps),pass:distance>=2&&gaps.every(g=>Math.abs(g)<=.25)})
      }catch(error){results.push({name,kind,pass:false,error:String(error).split('\n')[0]})}
      fs.writeFileSync(out+'/drive.json',JSON.stringify(results,null,2))
    }
    await page.close()
  }
}finally{await browser.close();await server.close()}
console.table(results)
if(results.some(r=>!r.pass))process.exitCode=1
