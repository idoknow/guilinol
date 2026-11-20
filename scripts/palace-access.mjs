import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {chromium} from 'playwright'
import {preview} from 'vite'

const {routes}=JSON.parse(execFileSync('uv',['run','--locked','python','scripts/palace-access-fixture.py']))
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:320,height:180}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk&radius=480`)
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:120000})
  for(const route of routes){
    const result=await page.evaluate(async route=>{
      const {walk,stream,camera,manifest}=window.viewer;walk.leave()
      if(!await walk.enter(route[0][0],route[0][1],0,'wall-foot'))throw Error('Could not spawn at wall foot')
      let distance=0
      for(const [x,z,y] of route){
        const tile=manifest.chunks.find(tile=>x>=tile.x&&x<tile.x+256&&z>=tile.z&&z<tile.z+256)
        const focus=camera.position.clone().set(x,y,z),deadline=performance.now()+30000
        while(tile&&!stream.loaded.has(tile)&&performance.now()<deadline){stream.tick(focus);await new Promise(resolve=>setTimeout(resolve,12))}
        if(!tile||!stream.loaded.has(tile))throw Error(`Missing terrain at ${x},${z}`)
        let reached=false,stuck=0
        for(let tick=0;tick<360;tick++){
          const start=walk.probe(),dx=x-start.x,dz=z-start.z
          if(Math.hypot(dx,dz)<.32){if(Math.abs(start.foot-y)>.5)throw Error(`Wrong level at ${x},${z}: ${start.foot} vs ${y}`);reached=true;break}
          walk.drive(dx*3,dz*3,false);walk.tick(.1)
          const end=walk.probe(),step=Math.hypot(end.x-start.x,end.z-start.z);distance+=step
          if(end.resets||end.inHouse||end.wet||((stuck=step<.01?stuck+1:0)>10))throw Error(`Blocked toward ${x},${z}: ${JSON.stringify(end)}`)
        }
        if(!reached)throw Error(`Missed ${x},${z}`)
      }
      walk.drive(0,0);return distance
    },route)
    assert(result>100);console.log(`Ground-to-ground route ${result.toFixed(1)} m`)
  }
}finally{await browser?.close();await server.close()}
