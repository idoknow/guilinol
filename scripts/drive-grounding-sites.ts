// Exercise the normal parked-vehicle mount and driving controllers at the audit sites.
import fs from 'node:fs'
import path from 'node:path'
import {gzipSync,gunzipSync} from 'node:zlib'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'
import {withFixtureBays} from './ride-fixture-bays.mjs'
import {vehicleSurface} from './vehicle-surface'
import {sites} from './vehicle-grounding-sites'
import {contactPose} from '../web/src/traffic/lane-surface'

const dist=path.resolve(process.env.GROUNDING_DIST??'dist'),world=path.join(dist,'world')
const packed=(file:string)=>JSON.parse(gunzipSync(fs.readFileSync(world+'/'+file)).toString())
const graph=packed('roads/graph.json.gz'),vehicles=packed('vehicles.bin')
const surface=vehicleSurface(world,JSON.parse(fs.readFileSync(world+'/manifest.json','utf8')))
const nodes=new Map(graph.nodes.map(node=>[node.id,node]))
const cases=sites.filter(([name])=>!process.env.GROUNDING_SITE||name===process.env.GROUNDING_SITE).map(([name,id,f])=>{
  const lane=graph.lanes.find(l=>l.id===id),a=nodes.get(lane.from),b=nodes.get(lane.to)
  const len=Math.hypot(b.x-a.x,b.z-a.z),dx=(b.x-a.x)/len,dz=(b.z-a.z)/len
  const x=a.x+dx*f*len-dz*lane.offset,z=a.z+dz*f*len+dx*lane.offset
  return {name,lane,row:[x,contactPose({...lane,length:len},f*len).y,z,Math.atan2(-dx,-dz),0]}
})
const server=await preview({root:'web',configFile:'web/vite.config.ts',build:{outDir:dist},preview:{host:'127.0.0.1',port:0}})
const browser=await chromium.launch(browserOptions()),results=[]
const out=process.env.GROUNDING_SITE?'captures/vehicle-grounding/debug':'captures/vehicle-grounding'
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
      let stage='spawn'
      try{
        let boarded=false
        for(const [forward,right] of [[0,0],[-.9,.7],[.9,-.7],[-.8,-.65],[.8,.65]]){
          const [x,y,z,heading]=row
          const east=x-Math.sin(heading)*forward+Math.cos(heading)*right
          const south=z-Math.cos(heading)*forward-Math.sin(heading)*right
          try{
            stage='spawn'
            if(!await page.evaluate(([x,y,z,yaw])=>window.viewer.walk.enterLaneFixture(x,y,z,yaw),[east,y,south,heading]))continue
            stage='prompt'
            await page.waitForFunction(()=>!!document.querySelector('.vehicle-action:not([hidden])')?.textContent,null,{timeout:3000})
            stage='mount'
            await page.keyboard.press('f')
            await page.waitForFunction(k=>window.viewer.walk.vehicle===k,kind,{timeout:3000})
            boarded=true
            break
          }catch(error){if(forward===.8)throw error}
        }
        if(!boarded)throw Error('No accessible boarding position beside the lane fixture')
        const run=await page.evaluate(async k=>{
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
          const probe=w.probe(),walls=[]
          if(Math.hypot(w.position.x-start.x,w.position.z-start.z)<2){
            for(const h of [.7,1.15])for(const turn of [0,-.4,.4,Math.PI/2,-Math.PI/2,Math.PI]){
              const a=w.heading+turn
              walls.push(w.raycastObstacle(probe.x,probe.foot+h,probe.z,-Math.sin(a),0,-Math.cos(a),4))
            }
          }
          return {trace,speed:w.speed,obstacle:w.obstacle,probe,walls}
        },kind)
        const {trace}=run
        const distance=Math.hypot(trace.at(-1)[0][0]-trace[0][0][0],trace.at(-1)[0][2]-trace[0][0][2])
        const gaps=trace.flat().map(([x,y,z])=>y-surface(x,z,lane))
        results.push({name,kind,diagnostic:distance<2?{speed:run.speed,obstacle:run.obstacle,probe:run.probe,walls:run.walls}:undefined,status:distance<2?'no-motion':gaps.every(g=>Math.abs(g)<=.25)?'pass':'contact',distance,min:Math.min(...gaps),max:Math.max(...gaps),pass:distance>=2&&gaps.every(g=>Math.abs(g)<=.25)})
      }catch(error){
        const details=await page.evaluate(([x,,z])=>{
          const w=window.viewer.walk
          return {probe:w.probe(),parked:w.parked().filter(p=>Math.hypot((p.x??p[0])-x,(p.z??p[2])-z)<6),
            action:document.querySelector('.vehicle-action')?.textContent}
        },row)
        results.push({name,kind,status:'setup',stage,pass:false,details,error:String(error).split('\n')[0]})
      }
      fs.writeFileSync(out+'/drive.json',JSON.stringify(results,null,2))
    }
    await page.close()
  }
}finally{await browser.close();await server.close()}
console.table(results)
if(results.some(r=>!r.pass))process.exitCode=1
