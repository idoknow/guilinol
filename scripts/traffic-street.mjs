import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {gunzipSync} from 'node:zlib'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const dir='public/world/roads/parking',index=JSON.parse(await readFile(`${dir}/index.json`))
const rows=(await Promise.all(Object.keys(index).map(async key=>JSON.parse(gunzipSync(await readFile(`${dir}/${key}.json.gz`)))))).flat()
assert.equal(rows.length,Object.values(index).reduce((sum,count)=>sum+count,0))
assert.ok(rows.every(row=>row[5]!=='primary'&&row[5]!=='trunk'))
const pickups=JSON.parse(gunzipSync(await readFile('public/world/vehicles.bin'))).cars
let minSquared=Infinity
for(const [east,,south] of rows)for(const [pickupEast,,pickupSouth] of pickups){
  minSquared=Math.min(minSquared,(pickupEast-east)**2+(pickupSouth-south)**2)
}
console.log('Pickup clearance',{parked:rows.length,pickups:pickups.length,minMetres:Math.sqrt(minSquared)})
assert.ok(minSquared>64,'G2 parked car inside the pickup exclusion radius')
const server=await preview({root:'web',configFile:'web/vite.config.ts',build:{outDir:resolve(process.env.PERF_DIST??'dist')},preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch(browserOptions())
  const mobile=process.env.PERF_MOBILE==='1'
  const page=await browser.newPage(mobile?{viewport:{width:844,height:390},deviceScaleFactor:3,isMobile:true,hasTouch:true}:{viewport:{width:800,height:450}})
  if(mobile)await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate:4})
  page.on('pageerror',error=>console.error(error));page.on('console',msg=>{if(msg.type()==='error')console.error(msg.text().slice(-1500))})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&traffic=1&flow=0&time=16&radius=480`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  const shots=[...['residential','tertiary'].map(cls=>{
    const [x,y,z,yaw]=rows.filter(row=>row[5]===cls).sort((a,b)=>Math.hypot(a[0],a[2])-Math.hypot(b[0],b[2]))[0]
    return {name:cls,x:x-14*Math.sin(yaw)-3*Math.cos(yaw),y:y+4,z:z-14*Math.cos(yaw)+3*Math.sin(yaw),yaw}
  }),{name:'jiefang',x:-265,y:168,z:15,yaw:1.32,min:4},{name:'fengbei',x:-941.1,y:162,z:-845.46,yaw:0,min:1}]
  await mkdir('captures/traffic',{recursive:true});const results=[]
  for(const shot of shots){
    await page.evaluate(({x,y,z,yaw})=>{const camera=window.viewer.camera;camera.position.set(x,y,z);camera.lookAt(x+20*Math.sin(yaw),y-4,z+20*Math.cos(yaw));camera.updateMatrixWorld()},shot)
    await page.waitForFunction(({x,z})=>{const viewer=window.viewer;return viewer.trafficProbe?.loads.at(-1)?.key===`${Math.floor(x/512)}_${Math.floor(z/512)}`&&!viewer.stats.pending&&viewer.trafficProbe.allMotors?.length>=1},shot,{timeout:120000})
    await page.waitForFunction(frame=>window.viewer.stats.frame>=frame+15,await page.evaluate(()=>window.viewer.stats.frame),{timeout:120000})
    if(shot.name==='residential'){
      await page.evaluate(()=>{window.viewer.trafficProbe.staticOnly=true})
      await page.waitForFunction(()=>window.viewer.trafficProbe.allMotors.length===0&&window.viewer.trafficProbe.parked>0)
      console.log('Static-only residential',await page.evaluate(()=>({parked:window.viewer.trafficProbe.parked,moving:window.viewer.trafficProbe.allMotors.length})))
      await page.screenshot({path:'captures/traffic/residential-static.jpg'})
      await page.evaluate(()=>{window.viewer.trafficProbe.staticOnly=false})
    }
    await page.screenshot({path:`captures/traffic/${shot.name}.jpg`})
    if(!shot.min)continue
    const visible=await page.evaluate(async({x,y,z,yaw})=>{
      const viewer=window.viewer,counts=[]
      for(let heading=0;heading<8;heading++){
        const angle=yaw+heading*Math.PI/4
        viewer.camera.lookAt(x+20*Math.sin(angle),y-6,z+20*Math.cos(angle));viewer.camera.updateMatrixWorld()
        await new Promise(resolve=>requestAnimationFrame(resolve))
        let maximum=(await viewer.trafficPixels()).length,frames=1
        const until=performance.now()+2000
        do{
          await new Promise(resolve=>requestAnimationFrame(resolve))
          if(performance.now()>until)break
          maximum=Math.max(maximum,(await viewer.trafficPixels()).length);frames++
        }while(performance.now()<until)
        if(frames<2)throw Error(`Insufficient pixel samples in heading ${heading}`)
        counts.push(maximum)
      }
      return counts
    },shot)
    if(shot.name==='fengbei'){
      await page.evaluate(({x,y,z})=>{const camera=window.viewer.camera;camera.lookAt(x+Math.SQRT2*10,y-6,z+Math.SQRT2*10);camera.updateMatrixWorld()},shot)
      await page.screenshot({path:'captures/traffic/fengbei-45.jpg'})
    }
    console.log(shot.name,visible);results.push([visible,shot.min])
  }
  assert.ok(results.every(([counts,min])=>counts.every(count=>count>=min)),'eight-heading motor pixel minimum')
}finally{await browser?.close();await server.close()}
