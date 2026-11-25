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
const selected=new Set(process.argv.slice(3).filter(arg=>arg!=='--surface').map(Number))
const sites=JSON.parse(await readFile(process.env.GROUNDING_ROUTES_FILE??directory+'/world/'+(process.argv.includes('--surface')?'vehicle-surface-routes.json':'vehicle-portal-routes.json'),'utf8')).filter(s=>!selected.size||selected.has(s.id))
if(!sites.length)throw Error('No matching portal fixtures')
const vehicles=JSON.parse(gunzipSync(await readFile(directory+'/world/vehicles.bin')))
const results=sites.filter(s=>!s.modes.length).map(s=>({id:s.id,way:s.way,unavailable:'no permitted continuous route',links:s.links}))
const groups=[]
for(const site of sites)for(const {mode,route,startHeight,direction,reverseExit=false,boundary=false} of site.modes){
  const [[x,z]]=route
  // A two-centimetre stub at an intersection cannot define the heading
  // of a 4.5 m parked sedan. Aim its front axle along the upcoming path.
  let remaining=mode==='car'?3:1,nx=x,nz=z
  for(const [ex,ez] of route.slice(1)){
    const distance=Math.hypot(ex-nx,ez-nz)
    if(distance>=remaining){nx+=(ex-nx)*remaining/distance;nz+=(ez-nz)*remaining/distance;break}
    remaining-=distance;nx=ex;nz=ez
  }
  let group=groups.find(g=>g.mode===mode&&g.tests.every(t=>Math.hypot(t.x-x,t.z-z)>65))
  if(!group){group={mode,tests:[]};groups.push(group)}
  group.tests.push({x,z,id:site.id,way:site.way,singleFile:site.singleFile,route,boundary,reverseExit,direction,startHeight,heading:Math.atan2(x-nx,z-nz)})
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
    await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:60000})
    for(const {id,way,x,z,singleFile,route,boundary,reverseExit,direction,startHeight:y,heading} of tests){
      try{
        let ready=false,setupError
        for(const [along,side] of [[0,0],[-.9,.7],[.9,-.7],[-.8,-.65],[.8,.65],[0,1.25],[0,-1.25],[-1.8,1],[-1.8,-1]]){
          try{
            ready=await page.evaluate(async({x,z,y,heading})=>{
              const w=window.viewer.walk
              w.leave()
              return w.enterLaneFixture(x,y,z,heading)
            },{x:x-Math.sin(heading)*along+Math.cos(heading)*side,z:z-Math.cos(heading)*along-Math.sin(heading)*side,y,heading})
            if(!ready)continue
            if(mode!=='foot'){
              await page.waitForFunction(({mode,x,z})=>window.viewer.walk.parked(mode)
                .some(([px,,pz])=>Math.hypot(px-x,pz-z)<2),{mode,x,z},{timeout:5000})
              await page.waitForFunction(()=>!!document.querySelector('.vehicle-action:not([hidden])')?.textContent,null,{timeout:3000})
              await page.keyboard.press('f')
              await page.waitForFunction(k=>window.viewer.walk.vehicle===k,mode,{timeout:3000})
            }
            break
          }catch(e){ready=false;setupError=e.message.split('\n')[0]}
        }
        if(!ready)throw Error(setupError??'could not reach or board lane fixture')
        const run=await page.evaluate(async({route,mode,boundary,reverseExit,singleFile,surfaceApproach})=>{
          const v=window.viewer,w=v.walk,held=new Set(),frames=[]
          const key=(code,down)=>{
            if(held.has(code)===down)return
            if(down)held.add(code);else held.delete(code)
            window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code,bubbles:true}))
          }
          if(mode==='bike'){w.ebike.setPark(false,true);w.ebike.setKickstand(false,true)}
          const rig=mode==='foot'?null:v.stream.scene.getObjectByName('dynamic-'+(mode==='bike'?'ebike':mode))
          const height=()=>mode==='car'||mode==='foot'?w.fixtureHeight():rig.position.y
          const initialResets=w.probe().resets
          let part=1,maximum=0,previous,completed=false,furthest=0,reversing=false,exitStation
          await v.freeze()
          try{
            const length=route.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-route[i][0],p[1]-route[i][1]),0)
            const frameLimit=Math.max(2400,Math.ceil(60*length/(singleFile ? .75 : 1.5)))
            for(let frame=0;frame<frameLimit;frame++){
              const p=w.position,[a,b]=route[part-1],[x,z]=route[part]
              const len=Math.hypot(x-a,z-b),dx=(x-a)/len,dz=(z-b)/len
              const progress=(p.x-a)*dx+(p.z-b)*dz,cross=Math.abs((p.x-a)*dz-(p.z-b)*dx)
              if(reverseExit){
                furthest=Math.max(furthest,progress)
                // Reverse with ordinary driving controls once inside the pinch,
                // or once contact has stopped further progress.
                if(progress>=len || (furthest>.5 && frames.length>150 &&
                  Math.hypot(p.x-frames.at(-120)[0],p.z-frames.at(-120)[1])<.06))reversing=true
                if(reversing && progress < -2.25 && cross<2){
                  completed=true;exitStation=progress;break
                }
              }
              if(!reverseExit&&part===route.length-1&&progress>=len-(boundary&&mode==='car'?2.12*.85:0)&&cross<2){completed=true;break}
              // Aim ahead through intermediate bends while retaining the final
              // station as a real crossing gate for the measured vehicle.
              if(part<route.length-1){
                const [nx,nz]=route[part+1],nextLength=Math.hypot(nx-x,nz-z)
                const alongNext=((p.x-x)*(nx-x)+(p.z-z)*(nz-z))/nextLength
                const lateralNext=Math.abs((p.x-x)*(nz-z)-(p.z-z)*(nx-x))/nextLength
                // A vehicle rounding a sharp corner can enter the next leg
                // without its centre passing through the vertex itself.
                const rounded=mode==='car'&&alongNext>2&&lateralNext<cross&&lateralNext<1.5&&progress>len-4
                const reached=mode==='foot'?Math.hypot(p.x-x,p.z-z)<.15:progress>len-(singleFile ? .2:1.2)&&cross<3.5
                if(reached||rounded){part++;continue}
              }
              // Brake before a bend. A long look-ahead at driving speed
              // can send the front wheels across the inside curb.
              const nextLeg=route[part+1]
              let bend=false,sharp=false
              if(nextLeg && len-progress<11){
                const ex=nextLeg[0]-x,ez=nextLeg[1]-z
                const cosine=(dx*ex+dz*ez)/Math.hypot(ex,ez)
                bend=cosine<.87
                sharp=cosine<-.5
              }
              // Anticipate hairpins. At ordinary right-angle junctions the shorter
              // lookahead keeps the car on the paved inside corner.
              // Ground intersections can have a kerb on the outside of the
              // turn. Start the steering arc earlier, then reacquire the
              // lane centre before resuming the normal straight lookahead.
              let carLookahead=6.5
              if(sharp)carLookahead=7.5
              else if(bend)carLookahead=surfaceApproach?5:3.4
              else if(surfaceApproach&&cross>.4)carLookahead=3
              let ahead=Math.max(0,progress)+(mode==='car'?carLookahead:singleFile&&mode!=='foot' ? .9:3.5)
              // A pedestrian can turn at the vertex itself. Looking beyond a hairpin
              // before reaching it can leave the walker at a stationary target.
              if(mode==='foot'&&part<route.length-1)ahead=Math.min(len,ahead)
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
                key('KeyS',reversing)
                key('KeyW',!reversing&&Math.abs(w.speed)<(bend||singleFile?1.5:Math.abs(delta)>.6?2:3.5))
                key('KeyA',!reversing&&delta>.04);key('KeyD',!reversing&&delta<-.04)
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
          // An overhead deck can stop a rider with no obstruction at the
          // horizontal bumper rays. Use the actual contact and rider height.
          const headContact=probe.contactSources?.some(hit=>hit.normal?.y<-.5&&
            hit.point?.y>probe.foot+.5&&hit.point.y<probe.foot+(mode==='car'?2:2.5))
          const obstruction=contacts?.some(Boolean)||w.obstacle==='collision'||headContact||
            probe.contactSources?.some(hit=>Math.abs(hit.normal?.y)<.5)
          if(reverseExit && probe.resets!==initialResets)completed=false
          const failure=completed?undefined:obstruction||probe.resets>initialResets?'collision':'tool'
          return {completed,failure,maximum,frames,part,
            reverseExit:reverseExit?{furthest,exitStation,resets:probe.resets-initialResets}:undefined,obstacle:w.obstacle,contacts,
            stopped:completed?undefined:{wet:probe.wet,blockedWater:probe.blockedWater,surface:probe.surfaceKind,inHouse:probe.inHouse,hits:probe.contactSources,foot:probe.foot,resets:probe.resets-initialResets,heading:w.heading}}
        },{route,mode,boundary,reverseExit,singleFile,surfaceApproach:!boundary&&process.argv.includes('--surface')})
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
