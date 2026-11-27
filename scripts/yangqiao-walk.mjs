import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'
import {telemetryPreview} from './telemetry-preview.mjs'
import profile from '../pipeline/data/landmarks/yangqiao-grade.json' with {type:'json'}

const server=await preview({root:'web',configFile:'web/vite.config.ts',plugins:[telemetryPreview],preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch(browserOptions());const page=await browser.newPage({viewport:{width:480,height:270}})
  await page.goto(`${server.resolvedUrls.local[0]}?verify&radius=320&flow=0`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0,null,{timeout:120000})
  const northOnly=process.argv.includes('--north-only'),northWalk=[[-1033.2,253],[-1029.2,243],[-1025.63,233],[-1022.04,223]],entry=northOnly?northWalk[0]:[-1092.1,351.3]
  await page.evaluate(([x,z])=>viewer.camera.position.set(x,175,z),entry)
  await page.waitForFunction(([x,z])=>viewer.manifest.chunks.filter(tile=>Math.hypot(tile.x+128-x,tile.z+128-z)<260).every(tile=>viewer.stream.loaded.has(tile)),entry,{timeout:180000})
  if(!await page.evaluate(([x,z])=>viewer.walkTo(x,z,0,'bridge-audit'),entry))throw Error('Cannot enter audit route')
  for(const [name,points] of Object.entries({
    west:[[-1092.1,351.3],[-1057.8,308.5]],east:[[-1063.1,376.2],[-1030,330.3]],
    ronghuBank:[[-1072,299.8],[-1104.7,282.6]],shanhuBank:[[-1016.6,342.3],[-988.3,369.1]],
    westApproaches:[[-1099.39,362.08],[-1052.83,299.04]],
    eastApproaches:[[-1068.88,384.46],[-1023.84,322.06]],
    crossing:[[-1076.11,330.56],[-1059.25,343.42],[-1076.11,330.56]],
    northWestSidewalk:northWalk,
  })){
    if(northOnly&&name!=='northWestSidewalk')continue
    const result=await page.evaluate(async({name,points,profile})=>{
      const viewer=window.viewer,{walk,stream}=viewer
      walk.leave();if(!await walk.enter(...points[0],0,name,false,AbortSignal.timeout(85000)))return {ok:false,reason:'cannot enter'}
      const deadline=performance.now()+60000
      while(![...stream.collisionLandmarks.keys()].some(entry=>entry.id==='zhongshan_road')){
        if(performance.now()>deadline)throw Error('Bridge collision not loaded');await new Promise(requestAnimationFrame)
      }
      await viewer.freeze()
      try{
        const resets=walk.probe().resets
        const seams={}
        if(name==='crossing'){
          function at(along,lateral){
            const ends=profile.south.map((point,side)=>point.map((coord,axis)=>coord+along*(profile.north[side][axis]-coord)))
            return ends[0].map((coord,axis)=>coord+lateral*(ends[1][axis]-coord))
          }
          for(const along of [-.18,0,1,1.18])for(const lateral of [.125,.875]){
            const supports=await Promise.all([-.0002,.0002].map(step=>viewer.photoSupport(...at(along+step,lateral))))
            seams[`${along}:${lateral}`]=Math.abs(supports[0].y-supports[1].y)
          }
          for(const lateral of [.25,.765]){
            const supports=await Promise.all([-.0002,.0002].map(step=>viewer.photoSupport(...at(.5,lateral+step))))
            seams[`inner:${lateral}`]=Math.abs(supports[0].y-supports[1].y)
          }
        }
        let probe=walk.probe(),totalTicks=0
        for(const [x,z] of points.slice(1)){
          for(let tick=0;tick<800;tick++){
          const dx=x-probe.x,dz=z-probe.z,distance=Math.hypot(dx,dz)
          if(distance<.45)break
          walk.drive(dx/distance,dz/distance,false);walk.tick(.1);probe=walk.probe();totalTicks++
          }
          if(Math.hypot(x-probe.x,z-probe.z)>=.45)return {ok:false,x:probe.x,z:probe.z,stalls:1,resets:probe.resets-resets,foot:probe.foot,contacts:probe.contactSources}
        }
        return {ok:probe.resets===resets&&Object.values(seams).every(gap=>gap<=.03),totalTicks,resets:probe.resets-resets,stalls:0,...(name==='northWestSidewalk'?{start:points[0],finish:[probe.x,probe.z],metres:Math.hypot(probe.x-points[0][0],probe.z-points[0][1])}:{}),...(name==='crossing'?{seams}:{})}
      }finally{walk.drive(0,0,false);viewer.resume()}
    },{name,points,profile})
    console.log(name,JSON.stringify(result));if(!result.ok)process.exitCode=1
  }
}finally{await browser?.close();await server.close()}
