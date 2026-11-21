import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {gzipSync,gunzipSync} from 'node:zlib'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const routes={west:[[-300.28,38.58],[-294.85,27.91],[-286.02,5.59],[-279.43,-11.15],[-274.16,-28.36]],east:[[-26.21,49.93],[-32.78,59.97],[-46.15,79.9],[-59.52,99.83],[-66.24,109.77]]}
routes.deck=[[-21,94.8],[-35.915,90.04],[-49.955,85.57],[-82,75],[-115,64]]
const output=process.argv[2]??'captures/underpass'
await mkdir(output,{recursive:true})
const vehicles=JSON.parse(gunzipSync(await readFile('dist/world/vehicles.bin')))
for(const [role,[[x,z],[east,south]]] of Object.entries(routes))vehicles.bikes.push([x,role==='deck'?150.57:147,z,Math.atan2(x-east,z-south),0])
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
const results=[]
try{
  browser=await chromium.launch(browserOptions())
  for(const mobile of [false,true]){
    const page=await browser.newPage({viewport:mobile?{width:420,height:740}:{width:640,height:400},isMobile:mobile,hasTouch:mobile})
    await page.route('**/vehicles.bin*',route=>route.fulfill({body:gzipSync(JSON.stringify(vehicles))}))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk&radius=256`)
    await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:90000})
    for(const [bank,points] of Object.entries(routes))for(const bike of [false,true]){
      try{
        if(!await page.evaluate(([x,z])=>window.viewer.walkTo(x,z,0,'underpass'),points[0]))throw Error('spawn failed')
        if(bike){await page.waitForFunction(()=>document.querySelector('.vehicle-action')?.textContent.includes('骑'));await page.locator('.vehicle-action').click()}
        const result=await page.evaluate(({points,bike,bank})=>{
          const walk=window.viewer.walk,trace=[];let index=1
          const held=new Set();function key(code,on){if(held.has(code)===on)return;window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code}));if(on)held.add(code);else held.delete(code)}
          if(bike&&walk.vehicle!=='bike')throw Error('not riding')
          try{for(let frame=0;frame<2100&&index<points.length;frame++){
            const pos=walk.position,dx=points[index][0]-pos.x,dz=points[index][1]-pos.z,dist=Math.hypot(dx,dz)
            if(dist<2){index++;continue}
            if(bike){const turn=Math.atan2(-dx,-dz)-walk.heading,angle=Math.atan2(Math.sin(turn),Math.cos(turn));key('KeyA',angle>.05);key('KeyD',angle<-.05);key('KeyW',Math.abs(angle)<.65)}else walk.drive(dx/dist,dz/dist)
            walk.tick(1/60)
            const {x,z,foot,resets}=walk.probe(),dropped=bank==='deck'&&foot<150.2
            if(frame%30===0||dropped||resets)trace.push([x,z,foot,resets]);if(resets||dropped)break
          }}finally{walk.drive(0,0);for(const code of held)key(code,false)}
          return {arrived:index===points.length,trace}
        },{points,bike,bank});results.push({mobile,bank,bike,...result})
      }catch(error){results.push({mobile,bank,bike,arrived:false,error:String(error)})}
      await writeFile(`${output}/travel.json`,JSON.stringify(results))
    }
    await page.close()
  }
  if(results.some(row=>!row.arrived))process.exitCode=1
}finally{await browser?.close();await server.close()}
