import assert from 'node:assert/strict'
import {gzipSync,gunzipSync} from 'node:zlib'
import {chromium} from 'playwright'
import {preview} from 'vite'

const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  for(const direction of [-1,1])for(const bike of [false,true]){
    const page=await browser.newPage({viewport:{width:480,height:270}})
    const angle=14.5*Math.PI/180,dx=direction*Math.cos(angle),dz=direction*Math.sin(angle)
    const lateral=direction*9.75,station=-direction*69
    const x=-1598.66734+station*Math.cos(angle)-lateral*Math.sin(angle),z=-184.87973+station*Math.sin(angle)+lateral*Math.cos(angle)
    if(bike)await page.route('**/world/vehicles.bin',async route=>{
      const response=await route.fetch(),data=JSON.parse(gunzipSync(await response.body()))
      data.bikes.unshift([x,direction===1?152:156,z,Math.atan2(-dx,-dz),0]);await route.fulfill({response,body:gzipSync(JSON.stringify(data))})
    })
    try{
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk&radius=300`)
      await page.waitForFunction(()=>window.viewer?.walk?.active)
      await page.evaluate(async([x,z])=>{const {walk}=window.viewer;walk.leave();if(!await walk.enter(x,z,0,'lize'))throw Error('spawn failed')},[x,z])
      await page.waitForFunction(()=>[...window.viewer.stream.landmarks.keys()].some(entry=>entry.id==='lize_bridge'))
      if(bike){await page.waitForFunction(()=>document.querySelector('.vehicle-action')?.textContent==='骑行');await page.keyboard.press('e');await page.keyboard.down('w')}
      const result=await page.evaluate(({dx,dz,x,z,bike})=>{
        const {walk}=window.viewer,start=walk.position.clone(),startOffset=Math.hypot(start.x-x,start.z-z);let maximumOffset=0,wetSamples=0
        if(bike&&walk.vehicle!=='bike')throw Error('bike mount failed');if(!bike)walk.drive(dx,dz,false)
        for(let step=0;step<600;step++){
          walk.tick(.1);const probe=walk.probe(),travel=(probe.x-x)*dx+(probe.z-z)*dz
          maximumOffset=Math.max(maximumOffset,Math.abs((probe.x-x)*dz-(probe.z-z)*dx));if(probe.wet)wetSamples++
          if(travel>=137||step===599)return {travel,maximumOffset,wetSamples,startOffset,vehicle:walk.vehicle,obstacle:walk.obstacle,probe}
        }
      },{dx,dz,x,z,bike});console.log(JSON.stringify({direction,bike,...result}));
      assert(result.travel>=137&&result.maximumOffset<1.6&&result.wetSamples>0&&!result.probe.resets)
    }catch(error){process.exitCode=1;console.error(error.message)}finally{await page.close()}
  }
}finally{await browser?.close();await server.close()}
