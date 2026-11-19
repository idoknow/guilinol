import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {preview} from 'vite'

const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:480,height:270}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk`)
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:60000})
  const result=await page.evaluate(async()=>{
    const {manifest,walk,camera}=window.viewer
    const [east,base,south]=manifest.landmarks.find(entry=>entry.id==='ronghu').position
    walk.leave();camera.position.set(east+75,base+1,south+36)
    const waypoints=[[75.2,38.2],[76.9,45.3],[88.7,53.5],[103.1,49.9],[109.4,63.1],[99.5,73],[101.7,88.1],[89.6,97.3],[92.9,111.4],[110,123.4],[118,130]]
    await new Promise(resolve=>{function ready(){if([...window.viewer.stream.landmarks.keys()].some(entry=>entry.id==='ronghu'))resolve();else requestAnimationFrame(ready)}ready()})
    if(!await walk.enter(east+75,south+36,0,'nine-bends'))throw Error('North bank spawn failed')
    for(const [targetX,targetZ] of waypoints){
      let reached=false
      for(let tick=0;tick<320;tick++){
        const probe=walk.probe(),dx=east+targetX-probe.x,dz=south+targetZ-probe.z,distance=Math.hypot(dx,dz)
        if(distance<.34){reached=true;break}
        walk.drive(dx/distance,dz/distance,false);walk.tick(.05)
      }
      if(!reached)return {reached:false,target:[targetX,targetZ],probe:walk.probe(),origin:[east,base,south]}
    }
    return {reached:true,resets:walk.probe().resets}
  })
  console.log(JSON.stringify(result));assert.equal(result.reached,true);assert.equal(result.resets,0)
}finally{await browser?.close();await server.close()}
