import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {preview} from 'vite'

const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:480,height:270}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk&radius=384`)
  await page.waitForFunction(()=>window.viewer?.walk?.active&&['jingjiang','wangcheng_market','zhengyang'].every(id=>[...window.viewer.stream.landmarks.keys()].some(entry=>entry.id===id)),null,{timeout:90000})
  const route=[[-610,-124],[-604,-128],[-603,-142],[-604,-128],[-593,-119],[-546,-108],[-540,-130],[-537,-154],[-598,-163],[-593,-196],[-587,-227],[-584,-249],[-575,-310],[-568,-360],[-567,-373]]
  const result=await page.evaluate(async route=>{
    const {walk}=window.viewer;walk.leave()
    if(!await walk.enter(...route[0],0,'wangcheng'))throw Error('Could not spawn')
    let distance=0
    for(const [x,z] of route.slice(1)){
      let arrived=false
      for(let step=0;step<220;step++){
        const start=walk.probe(),dx=x-start.x,dz=z-start.z
        if(Math.hypot(dx,dz)<.75){arrived=true;break}
        walk.drive(dx,dz);walk.tick(.1)
        const end=walk.probe();distance+=Math.hypot(end.x-start.x,end.z-start.z)
        if(end.resets||end.inHouse||end.wet)throw Error(JSON.stringify(end))
      }
      if(!arrived)throw Error(`Blocked approaching ${x},${z}: ${JSON.stringify(walk.probe())}`)
    }
    walk.drive(0,0);return distance
  },route)
  assert(result>300);console.log(`Route: ${result.toFixed(1)} m, ${route.length-1} waypoints, no reset or teleport`)
}finally{await browser?.close();await server.close()}
