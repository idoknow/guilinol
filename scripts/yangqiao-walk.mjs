import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'
import {telemetryPreview} from './telemetry-preview.mjs'

const server=await preview({root:'web',configFile:'web/vite.config.ts',plugins:[telemetryPreview],preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch(browserOptions());const page=await browser.newPage({viewport:{width:480,height:270}})
  await page.goto(`${server.resolvedUrls.local[0]}?verify&mode=walk&radius=320&flow=0`)
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:120000})
  for(const [name,points] of Object.entries({
    west:[[-1092.1,351.3],[-1057.8,308.5]],east:[[-1063.1,376.2],[-1030,330.3]],
    ronghuBank:[[-1072,299.8],[-1104.7,282.6]],shanhuBank:[[-1016.6,342.3],[-988.3,369.1]],
  })){
    const result=await page.evaluate(async({name,points})=>{
      const viewer=window.viewer,{walk,stream}=viewer
      walk.leave();if(!await walk.enter(...points[0],0,name,false,AbortSignal.timeout(85000)))return {ok:false,reason:'cannot enter'}
      const deadline=performance.now()+60000
      while(![...stream.collisionLandmarks.keys()].some(entry=>entry.id==='zhongshan_road')){
        if(performance.now()>deadline)throw Error('Bridge collision not loaded');await new Promise(requestAnimationFrame)
      }
      await viewer.freeze()
      try{
        const resets=walk.probe().resets
        const [x,z]=points[1];let probe=walk.probe()
        for(let tick=0;tick<800;tick++){
          const dx=x-probe.x,dz=z-probe.z,distance=Math.hypot(dx,dz)
          if(distance<.45)return {ok:probe.resets===resets,tick,resets:probe.resets-resets}
          walk.drive(dx/distance,dz/distance,false);walk.tick(.1);probe=walk.probe()
        }
        return {ok:false,x:probe.x,z:probe.z,remaining:Math.hypot(x-probe.x,z-probe.z),resets:probe.resets-resets,foot:probe.foot,contacts:probe.contactSources,wet:probe.blockedWater}
      }finally{walk.drive(0,0,false);viewer.resume()}
    },{name,points})
    console.log(name,JSON.stringify(result));if(!result.ok)process.exitCode=1
  }
}finally{await browser?.close();await server.close()}
