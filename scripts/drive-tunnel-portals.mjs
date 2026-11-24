import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {gzipSync,gunzipSync} from 'node:zlib'
import {resolve} from 'node:path'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'
import {axleHeight} from '../web/src/traffic/lane-surface.ts'

const directory=resolve(process.env.GROUNDING_DIST??'dist'),output=process.argv[2]??'captures/vehicle-grounding/portals.json'
const graph=JSON.parse(gunzipSync(await readFile(directory+'/world/roads/graph.json.gz')))
const manifest=JSON.parse(await readFile(directory+'/world/manifest.json','utf8'))
const vehicles=JSON.parse(gunzipSync(await readFile(directory+'/world/vehicles.bin')))
const nodes=new Map(graph.nodes.map(p=>[p.id,p]))
const adj=new Map()
for(const lane of graph.lanes){
  for(const [a,b] of [[lane.from,lane.to],[lane.to,lane.from]]){
    if(!adj.has(a))adj.set(a,new Map())
    adj.get(a).set(b,{node:nodes.get(b),structure:lane.structure,lane})
  }
}
const xy=p=>p.x+','+p.z
const ids=new Map(graph.nodes.map(p=>[xy(p),p.id]))
const tests=[],seen=new Set()
function trace(first,origin,dx,dz,inside){
  const route=[origin],visited=new Set([origin.id])
  let p=origin,next=first,left=20,startHeight=origin.y
  while(next&&left>.001){
    const length=Math.hypot(next.x-p.x,next.z-p.z)
    dx=(next.x-p.x)/length;dz=(next.z-p.z)/length
    if(length>=left){
      route.push({x:p.x+left*dx,z:p.z+left*dz})
      const lane=adj.get(p.id).get(next.id).lane
      startHeight=lane.floor?axleHeight({...lane,length},lane.from===p.id?left:length-left):p.y+(next.y-p.y)*left/length
      left=0
      break
    }
    route.push(next);visited.add(next.id);left-=length;p=next;startHeight=p.y
    const links=[...(adj.get(p.id)?.values()??[])].filter(c=>!visited.has(c.node.id))
    const matching=links.filter(c=>inside?c.structure==='tunnel':!c.structure)
    const choices=matching.length?matching:links.filter(c=>!c.structure)
    next=choices.sort((a,b)=>score(b.node)-score(a.node))[0]?.node
    function score(q){return ((q.x-p.x)*dx+(q.z-p.z)*dz)/Math.hypot(q.x-p.x,q.z-p.z)}
  }
  return {route,length:20-left,startHeight}
}
for(const t of manifest.tunnels??[]){
  if(!t.generated)continue
  for(let i=0;i<2;i++){
    if(!t.mouths[i])continue
    const [x,y,z]=t.portals[i],k=ids.get(x+','+z),origin=nodes.get(k)
    if(seen.has(k)&&k!==undefined)continue
    seen.add(k)
    const site={way:t.way,id:k,x,y,z}
    const [tx,,tz]=t.portals[1-i],next=nodes.get(ids.get(tx+','+tz))
    if(!origin||!next){tests.push({...site,unavailable:'no public lane at mapped access'});continue}
    const dx=(tx-x)/t.length,dz=(tz-z)/t.length
    const choices=[...(adj.get(k)?.values()??[])].filter(c=>!c.structure)
    function score(p){return -((p.x-x)*dx+(p.z-z)*dz)/Math.hypot(p.x-x,p.z-z)}
    const outside=trace(choices.sort((a,b)=>score(b.node)-score(a.node))[0]?.node,origin,-dx,-dz,false)
    const inside=trace(next,origin,dx,dz,true)
    if(outside.length<2||inside.length<2){tests.push({...site,unavailable:'no traversable lane on one side',outside:outside.length,inside:inside.length});continue}
    const route=[...outside.route.reverse(),...inside.route.slice(1)].map(p=>[p.x,p.z])
    const heading=Math.atan2(route[0][0]-route[1][0],route[0][1]-route[1][1])
    tests.push({...site,route,heading,startHeight:outside.startHeight,outside:outside.length,inside:inside.length})
  }
}
const groups=[],results=tests.filter(t=>t.unavailable)
for(const t of tests.filter(t=>t.route)){
  let group=groups.find(g=>g.every(q=>Math.hypot(q.x-t.x,q.z-t.z)>65))
  if(!group){group=[];groups.push(group)}
  group.push(t)
}
await mkdir(resolve(output,'..'),{recursive:true})
const server=await preview({configFile:false,build:{outDir:directory},preview:{host:'127.0.0.1',port:0}})
const browser=await chromium.launch(browserOptions())
try{
  for(const group of groups){
    const page=await browser.newPage({viewport:{width:480,height:270}})
    page.setDefaultTimeout(7000)
    const cars=group.map(t=>[t.route[0][0],t.startHeight,t.route[0][1],t.heading,0])
    await page.route('**/world/vehicles.bin',route=>route.fulfill({body:gzipSync(JSON.stringify({...vehicles,cars,bikes:[],bicycles:[],sharedBikes:[]}))}))
    await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/?verify&mode=walk&radius=256&flow=0')
    await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:60000})
    for(const {id,way,route,startHeight:y,heading,outside,inside} of group){
      try{
        const mounted=await page.evaluate(async({route,y,heading})=>{
          const w=window.viewer.walk
          w.leave()
          const [x,z]=route[0]
          for(const [f,r] of [[0,0],[-.9,.7],[.9,-.7],[-.8,-.65],[.8,.65]]){
            try{
              if(await w.enterLaneFixture(x-Math.sin(heading)*f+Math.cos(heading)*r,y,
                z-Math.cos(heading)*f-Math.sin(heading)*r,heading))return true
            }catch{ /* Try the opposite side of a parked vehicle. */ }
          }
          return false
        },{route,y,heading})
        if(!mounted)throw Error('lane fixture unavailable')
        await page.waitForFunction(()=>document.querySelector('.vehicle-action:not([hidden])')?.textContent==='开车',null,{timeout:2000})
        await page.keyboard.press('f')
        await page.waitForFunction(()=>window.viewer.walk.vehicle==='car',null,{timeout:2000})
        const run=await page.evaluate(async route=>{
          const v=window.viewer,w=v.walk,held=new Set(),frames=[]
          const key=(code,down)=>{
            if(held.has(code)===down)return
            if(down)held.add(code);else held.delete(code)
            window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code,bubbles:true}))
          }
          let part=1,maximum=0,previous
          await v.freeze()
          try{
            for(let frame=0;frame<1500;frame++){
              const p=w.position,[x,z]=route[part],distance=Math.hypot(p.x-x,p.z-z)
              if(distance<1.35&&++part===route.length)break
              const [tx,tz]=route[part],turn=Math.atan2(-(tx-p.x),-(tz-p.z))-w.heading
              const delta=Math.atan2(Math.sin(turn),Math.cos(turn))
              key('KeyW',Math.abs(w.speed)<(Math.abs(delta)>.6?2.2:4))
              key('KeyA',delta>.035);key('KeyD',delta<-.035)
              v.stream.tick(w.position);w.tick(1/60)
              const y=w.probe().carY
              if(previous!==undefined)maximum=Math.max(maximum,Math.abs(y-previous))
              previous=y;frames.push([p.x,p.z,y])
              if(frame%40===0)await new Promise(r=>setTimeout(r,0))
              if(frame>180&&Math.hypot(p.x-frames[frame-180][0],p.z-frames[frame-180][1])<.1)break
            }
          }finally{for(const code of held)key(code,false);v.resume()}
          return {completed:part===route.length,maximum,frames}
        },route)
        results.push({id,way,outside,inside,...run})
      }catch(e){results.push({id,way,unavailable:e.message.split('\n')[0]})}
    }
    await writeFile(output+'.gz',gzipSync(JSON.stringify(results)))
    await page.close()
  }
}finally{await browser.close();await server.close()}
const completed=results.filter(r=>r.completed)
const fullDistance=completed.filter(r=>Math.min(r.outside,r.inside)>=20-.001)
const summary={
  requested:tests.length,
  completed:completed.length,
  fullDistance:fullDistance.length,
  pass:fullDistance.filter(r=>r.maximum<=.1).length,
  overLimit:completed.filter(r=>r.maximum>.1).length,
  stalled:results.filter(r=>r.completed===false).length,
  unavailable:results.filter(r=>r.unavailable).length,
  maximum:completed.reduce((highest,r)=>Math.max(highest,r.maximum),0)
}
await writeFile(output,JSON.stringify(summary,null,2))
console.log(summary)
if(summary.pass!==tests.length)process.exitCode=1
