import {writeFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'
const [dist='dist',output='platform-walk.json']=process.argv.slice(2)
const cases=JSON.parse(execFileSync('uv',['run','--locked','python','pipeline/platform_access_walk.py',resolve(dist,'world')],{encoding:'utf8',maxBuffer:8<<20}))
const server=await preview({configFile:false,build:{outDir:resolve(dist)},preview:{host:'127.0.0.1',port:0}})
const browser=await chromium.launch(browserOptions(true))
const report=[]
try{
 for(const route of cases){
  const page=await browser.newPage()
  page.on('pageerror',e=>console.log(e.message))
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/?verify&mode=walk&radius=1024&flow=0&time=12')
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:90000})
  const result=await page.evaluate(async ({points,levels})=>{
   const view=window.viewer,walk=view.walk,trace=[]
   walk.leave()
   if(!await walk.enter(...points[0],0,'platform access'))return {pass:false,why:'spawn'}
   for(let i=0;i<360;i++){await new Promise(requestAnimationFrame);if(i>45&&!view.stats.pending)break}
   await view.freeze()
   let p=walk.probe(),resets=p.resets,maxStep=0
   for(let i=1;i<points.length;i++){
    const [x,z]=points[i]
    let arrived=false
    for(let t=0;t<220;t++){
     const dx=x-p.x,dz=z-p.z,d=Math.hypot(dx,dz)
     if(d<.15){arrived=true;break}
     walk.drive(dx/d,dz/d,false);walk.tick(.05)
     const next=walk.probe()
     maxStep=Math.max(maxStep,Math.abs(next.foot-p.foot))
     p=next
     if(t%8===0)trace.push([p.x,p.foot,p.z])
     if(maxStep>.16 || p.resets!==resets || p.inHouse || p.wet)
      return {pass:false,why:'lost support',at:i,maxStep,trace}
    }
    if(!arrived || (levels[i]!=null && Math.abs(p.foot-levels[i])>.11))
     return {pass:false,why:arrived?'wrong support':'obstructed',at:i,foot:p.foot,expected:levels[i],maxStep,trace}
   }
   return {pass:true,maxStep,trace}
  },route)
  report.push({platform:route.platform,...result})
  writeFileSync(output,JSON.stringify(report));console.log(route.platform,result.pass,result.why,result.at,result.maxStep)
  await page.close()
 }
}finally{await browser.close();await server.close()}
if(!report.every(r=>r.pass))process.exitCode=1
