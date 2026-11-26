import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {gzipSync,gunzipSync} from 'node:zlib'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'
import {withFixtureBays} from './ride-fixture-bays.mjs'

const routes={
  west:[[-300.28,38.58],[-294.85,27.91],[-286.02,5.59],[-279.43,-11.15],[-274.16,-28.36]],
  east:[[-26.21,49.93],[-32.78,59.97],[-46.15,79.9],[-59.52,99.83],[-66.24,109.77]],
  deck:[[-21,94.8],[-35.915,90.04],[-49.955,85.57],[-82,75],[-115,64]],
  // Shizijie B1 underground traversal: surface outside NW entrance -> down NW stairs -> B1 ring concourse (-4.2m) -> up SE stairs -> surface outside SE entrance
  shizijie_underground:[
    [-909.23,-211.22],[-906.38,-210.29],[-902.1,-208.9],[-897.82,-207.51],
    [-896.21,-203.42],[-892.45,-208.48],[-884.58,-189.65],[-877.37,-172.42],
    [-867.62,-149.1],[-859.43,-129.49],[-859.4,-127.11],[-857.71,-122.94],
    [-856.03,-118.77],[-854.9,-115.98],
  ],
}
const output=process.argv[2]??'captures/underpass'
await mkdir(output,{recursive:true})
const rawVehicles=JSON.parse(gunzipSync(await readFile('dist/world/vehicles.bin')))
const fixtureBays=[]
for(const [role,[[x,z],[east,south]]] of Object.entries(routes)){
  if(role==='shizijie_underground')continue
  fixtureBays.push([x,role==='deck'?150.57:147,z,Math.atan2(x-east,z-south),0])
}
const vehiclesBody=gzipSync(JSON.stringify({...withFixtureBays(rawVehicles,fixtureBays),bikes:[...rawVehicles.bikes,...fixtureBays]}))
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
const results=[]
try{
  browser=await chromium.launch(browserOptions())
  for(const mobile of [false,true]){
    const page=await browser.newPage({viewport:mobile?{width:420,height:740}:{width:640,height:400},isMobile:mobile,hasTouch:mobile})
    await page.route('**/vehicles.bin*',route=>route.fulfill({body:vehiclesBody}))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk&radius=256`)
    await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:90000})
    if(mobile){
      const skip=page.getByRole('button',{name:'竖屏继续'})
      if(await skip.isVisible().catch(()=>false))await skip.tap()
    }
    await page.waitForFunction(()=>window.viewer?.walk?.parked().length>0,null,{timeout:30000})
    for(const [bank,points] of Object.entries(routes))for(const bike of [false,true]){
      if(bank==='shizijie_underground'&&bike)continue
      try{
        if(!await page.evaluate(([x,z])=>window.viewer.walkTo(x,z,0,'underpass'),points[0]))throw Error('spawn failed')
        if(bike){
          await page.waitForFunction(()=>document.querySelector('.vehicle-action')?.textContent?.includes('骑'),null,{timeout:15000})
          if(mobile)await page.locator('.vehicle-action').tap();else await page.locator('.vehicle-action').click()
        }
        const result=await page.evaluate(({points,bike,bank})=>{
          const walk=window.viewer.walk,trace=[];let index=1
          const held=new Set();function key(code,on){if(held.has(code)===on)return;window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code}));if(on)held.add(code);else held.delete(code)}
          if(bike&&walk.vehicle!=='bike')throw Error('not riding')
          const isShizijie=bank==='shizijie_underground'
          const maxFrames=isShizijie?3600:2100
          const reach=isShizijie?1.35:2
          const startFoot=walk.probe().foot
          let minFoot=startFoot,maxFoot=startFoot,endFoot=startFoot,lastResets=0
          try{for(let frame=0;frame<maxFrames&&index<points.length;frame++){
            const pos=walk.position,dx=points[index][0]-pos.x,dz=points[index][1]-pos.z,dist=Math.hypot(dx,dz)
            if(dist<reach){index++;continue}
            if(bike){const turn=Math.atan2(-dx,-dz)-walk.heading,angle=Math.atan2(Math.sin(turn),Math.cos(turn));key('KeyA',angle>.05);key('KeyD',angle<-.05);key('KeyW',Math.abs(angle)<.65)}else walk.drive(dx/dist,dz/dist)
            walk.tick(1/60)
            const {x,z,foot,resets}=walk.probe()
            if(foot<minFoot)minFoot=foot
            if(foot>maxFoot)maxFoot=foot
            endFoot=foot;lastResets=resets
            const dropped=(bank==='deck'&&foot<150.2)||(isShizijie&&foot<145.5)
            if(frame%30===0||dropped||resets)trace.push([x,z,foot,resets]);if(resets||dropped)break
          }}finally{walk.drive(0,0);for(const code of held)key(code,false)}
          const reached=index===points.length
          const undergroundOk=!isShizijie||(startFoot>=150.5&&minFoot<=148.0&&minFoot>=145.5&&endFoot>=150.5&&lastResets===0)
          return {arrived:reached&&undergroundOk,startFoot:+startFoot.toFixed(2),minFoot:+minFoot.toFixed(2),endFoot:+endFoot.toFixed(2),resets:lastResets,trace}
        },{points,bike,bank});results.push({mobile,bank,bike,...result})
      }catch(error){results.push({mobile,bank,bike,arrived:false,error:String(error)})}
      await writeFile(`${output}/travel.json`,JSON.stringify(results))
    }
    await page.close()
  }
  if(results.some(row=>!row.arrived))process.exitCode=1
}finally{await browser?.close();await server.close()}
