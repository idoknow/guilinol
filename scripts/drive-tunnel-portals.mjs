// Drive the actual controls across the signed 20 m stations prepared by the bake.
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {gzipSync,gunzipSync} from 'node:zlib'
import {resolve} from 'node:path'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'
import {withFixtureBays} from './ride-fixture-bays.mjs'

const directory=resolve(process.env.GROUNDING_DIST??'dist')
const output=process.argv[2]??'captures/vehicle-grounding/portals.json'
const selected=new Set(process.argv.slice(3).map(Number))
const sites=JSON.parse(await readFile(directory+'/world/vehicle-portal-routes.json','utf8')).filter(s=>!selected.size||selected.has(s.id))
if(!sites.length)throw Error('No matching portal fixtures')
const vehicles=JSON.parse(gunzipSync(await readFile(directory+'/world/vehicles.bin')))
const results=sites.filter(s=>!s.modes.some(m=>!m.boundary)).map(s=>({id:s.id,way:s.way,unavailable:'no permitted continuous route',links:s.links}))
const groups=[]
for(const site of sites)for(const {mode,route,startHeight,direction,boundary=false} of site.modes){
  const [[x,z],[nx,nz]]=route
  let group=groups.find(g=>g.mode===mode&&g.tests.every(t=>Math.hypot(t.x-x,t.z-z)>65))
  if(!group){group={mode,tests:[]};groups.push(group)}
  group.tests.push({x,z,id:site.id,way:site.way,route,boundary,direction,startHeight,heading:Math.atan2(x-nx,z-nz)})
}
await mkdir(resolve(output,'..'),{recursive:true})
const server=await preview({configFile:false,build:{outDir:directory},preview:{host:'127.0.0.1',port:0}})
const browser=await chromium.launch(browserOptions())
try{
  for(const {mode,tests} of groups){
    const page=await browser.newPage({viewport:{width:480,height:270}})
    const bays=tests.map(t=>[t.x,t.startHeight,t.z,t.heading,0])
    const fleet={...(mode==='bike'?withFixtureBays(vehicles,bays):vehicles),cars:[],bikes:[],bicycles:[],sharedBikes:[]}
    if(mode!=='foot')fleet[{car:'cars',bicycle:'bicycles',bike:'bikes'}[mode]]=bays
    await page.route('**/world/vehicles.bin',route=>route.fulfill({body:gzipSync(JSON.stringify(fleet))}))
    await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/?verify&mode=walk&radius=320&flow=0')
    await page.waitForFunction(mode=>window.viewer?.walk?.active&&(mode==='foot'||window.viewer.walk.parked().length),mode,{timeout:60000})
    for(const {id,way,x,z,route,boundary,direction,startHeight:y,heading} of tests){
      try{
        let ready=false,setupError
        for(const [along,side] of [[0,0],[-.9,.7],[.9,-.7],[-.8,-.65],[.8,.65]]){
          try{
            ready=await page.evaluate(async({x,z,y,heading})=>{
              const w=window.viewer.walk
              w.leave()
              return w.enterLaneFixture(x,y,z,heading)
            },{x:x-Math.sin(heading)*along+Math.cos(heading)*side,z:z-Math.cos(heading)*along-Math.sin(heading)*side,y,heading})
            if(!ready)continue
            if(mode!=='foot'){
              await page.waitForFunction(()=>!!document.querySelector('.vehicle-action:not([hidden])')?.textContent,null,{timeout:3000})
              await page.keyboard.press('f')
              await page.waitForFunction(k=>window.viewer.walk.vehicle===k,mode,{timeout:3000})
            }
            break
          }catch(e){ready=false;setupError=e.message.split('\n')[0]}
        }
        if(!ready)throw Error(setupError??'could not reach or board lane fixture')
        const run=await page.evaluate(async({route,mode,boundary})=>{
          const v=window.viewer,w=v.walk,held=new Set(),frames=[]
          const key=(code,down)=>{
            if(held.has(code)===down)return
            if(down)held.add(code);else held.delete(code)
            window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code,bubbles:true}))
          }
          if(mode==='bike'){w.ebike.setPark(false,true);w.ebike.setKickstand(false,true)}
          const rig=mode==='foot'?null:v.stream.scene.getObjectByName('dynamic-'+(mode==='bike'?'ebike':mode))
          const height=()=>mode==='car'||mode==='foot'?w.fixtureHeight():rig.position.y
          let part=1,maximum=0,previous,completed=false
          await v.freeze()
          try{
            for(let frame=0;frame<2400;frame++){
              const p=w.position,[a,b]=route[part-1],[x,z]=route[part]
              const len=Math.hypot(x-a,z-b),dx=(x-a)/len,dz=(z-b)/len
              const progress=(p.x-a)*dx+(p.z-b)*dz,cross=Math.abs((p.x-a)*dz-(p.z-b)*dx)
              if(part===route.length-1&&progress>=len-(boundary&&mode==='car'?2.12*.85:0)&&cross<2){completed=true;break}
              // Aim ahead through intermediate bends while retaining the final
              // station as a real crossing gate for the measured vehicle.
              if(part<route.length-1&&progress>len-1.2&&cross<3.5){part++;continue}
              let ahead=Math.max(0,progress)+(mode==='car'?6.5:3.5)
              let tx=a+ahead*dx,tz=b+ahead*dz
              // Steer through bends within the vehicle's turning radius.
              for(let leg=part;leg<route.length-1&&ahead>0;leg++){
                const [u,v]=route[leg-1],[ex,ez]=route[leg]
                ahead-=Math.hypot(ex-u,ez-v)
                if(ahead<=0)break
                const [nx,nz]=route[leg+1],dist=Math.hypot(nx-ex,nz-ez)
                tx=ex+(nx-ex)*ahead/dist;tz=ez+(nz-ez)*ahead/dist
              }
              tx-=p.x;tz-=p.z
              if(mode==='foot')w.drive(tx,tz,false)
              else{
                const turn=Math.atan2(-tx,-tz)-w.heading,delta=Math.atan2(Math.sin(turn),Math.cos(turn))
                key('KeyW',Math.abs(w.speed)<(Math.abs(delta)>.6?2:3.5))
                key('KeyA',delta>.04);key('KeyD',delta<-.04)
              }
              v.stream.tick(w.position);v.stream.updateLandmarks?.(w.position);w.tick(1/60)
              const y=height(),next=w.position
              if(previous!==undefined)maximum=Math.max(maximum,Math.abs(y-previous))
              previous=y;frames.push([next.x,next.z,y])
              if(frame%15===0)await new Promise(r=>setTimeout(r,0))
              if(frames.length>300&&Math.hypot(next.x-frames.at(-300)[0],next.z-frames.at(-300)[1])<.06)break
            }
          }finally{for(const code of held)key(code,false);if(mode==='foot')w.drive(0,0,false);v.resume()}
          const probe=w.probe(),p=w.position,fx=-Math.sin(w.heading),fz=-Math.cos(w.heading)
          const contacts=completed?undefined:[-.85,0,.85].map(side=>w.raycastObstacle(
            p.x+fz*side,probe.foot+.8,p.z-fx*side,fx,0,fz,4))
          const obstruction=contacts?.some(Boolean)||w.obstacle==='collision'||
            probe.contactSources?.some(hit=>Math.abs(hit.normal?.y)<.5)
          const failure=completed?undefined:obstruction?'collision':'tool'
          return {completed,failure,maximum,frames,part,obstacle:w.obstacle,contacts,
            stopped:completed?undefined:{hits:probe.contactSources,foot:probe.foot,resets:probe.resets,heading:w.heading}}
        },{route,mode,boundary})
        results.push({id,way,mode,boundary,direction,...run})
      }catch(e){results.push({id,way,mode,boundary,direction,failure:"tool",unavailable:e.message.split('\n')[0]})}
    }
    await writeFile(output+'.gz',gzipSync(JSON.stringify(results)))
    await page.close()
  }
}finally{await browser.close();await server.close()}
const passed=r=>r.completed&&r.maximum<=.1
const completed=results.filter(r=>r.completed)
const summary={
  requested:sites.length,runs:results.length,completed:completed.length,
  boundaryRuns:results.filter(r=>r.boundary).length,
  pass:sites.filter(s=>results.filter(r=>r.id===s.id).every(passed)).length,
  overLimit:completed.filter(r=>r.maximum>.1).length,
  stalled:results.filter(r=>r.completed===false).length,
  failures:Object.fromEntries(["collision","tool"].map(kind=>[kind,results.filter(r=>r.failure===kind).length])),
  unavailable:results.filter(r=>r.unavailable).length,
  maximum:completed.reduce((highest,r)=>Math.max(highest,r.maximum),0)
}
await writeFile(output,JSON.stringify(summary,null,2))
console.log(summary)
if(summary.pass!==sites.length)process.exitCode=1
