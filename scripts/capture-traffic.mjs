import {chromium} from 'playwright'
import {preview} from 'vite'
import {mkdir} from 'node:fs/promises'
import {browserOptions} from './qa-browser.mjs'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'

const baseline=process.argv[2]
const server=await preview({root:'web',configFile:'web/vite.config.ts',build:{outDir:resolve(baseline??'dist')},preview:{host:'127.0.0.1',port:0}})
const browser=await chromium.launch(browserOptions())
try {
  const page=await browser.newPage({viewport:{width:960,height:540}})
  page.on('pageerror',console.error)
  page.on('console',message=>{if(message.text().includes('Traffic unavailable'))console.error(message.text())})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&traffic=1&flow=0&time=17`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  await page.evaluate(()=>{
    const camera=window.viewer.camera
    camera.position.set(-265,174,-9);camera.lookAt(-172,153,39);camera.updateMatrixWorld()
  })
  try {await page.waitForFunction(base=>!window.viewer.stats.pending&&!window.viewer.stream.forest.pending.size&&window.viewer.stats.frame>35&&(base||window.viewer.trafficProbe?.motors>=28),Boolean(baseline),{timeout:180000})}
  catch(error){console.error(await page.evaluate(()=>({count:window.viewer.trafficCount,probe:window.viewer.trafficProbe,camera:window.viewer.camera.position.toArray(),stats:window.viewer.stats})));throw error}
  const snapshot=await page.evaluate(async()=>{await window.viewer.freeze();return {calls:window.viewer.stats.calls,actors:window.viewer.trafficCount,...window.viewer.trafficProbe}})
  console.log('Jiefang',JSON.stringify(snapshot))
  await mkdir('captures',{recursive:true})
  if(!baseline){
    const pixelVisible=await page.evaluate(async()=>(await window.viewer.trafficPixels()).length);console.log('Pixel-visible motors',pixelVisible);assert.ok(pixelVisible>=20)
    await page.screenshot({path:'captures/jiefang-traffic.png'})
    await page.evaluate(()=>window.viewer.resume())
    await page.evaluate(()=>{const camera=window.viewer.camera;camera.position.set(135,207,138);camera.lookAt(162,153,149);camera.updateMatrixWorld()})
    const queue=await page.evaluate(async()=>{
      const viewer=window.viewer
      const evidence=async(checkPixels)=>{
        const visible=checkPixels?await viewer.trafficPixels():null
        const cars=viewer.trafficProbe.approaches.filter(car=>(!visible||visible.includes(car.index))&&Math.hypot(car.x-162,car.z-149)<32)
        for(const lead of cars.filter(car=>!car.green&&car.speed<.1&&car.gap<5)){
          const stopped=cars.filter(car=>!car.green&&car.speed<.1&&Math.cos(car.yaw-lead.yaw)>.85)
          const crossing=cars.filter(car=>car.green&&car.speed>1&&Math.abs(Math.cos(car.yaw-lead.yaw))<.7)
          if(stopped.length>=2&&crossing.length)return {stopped:stopped.length,crossing:crossing.length}
        }
      }
      const deadline=performance.now()+240000
      while(performance.now()<deadline){
        await new Promise(requestAnimationFrame)
        if(viewer.trafficProbe?.loads.at(-1)?.key!=='0_0'||!viewer.trafficProbe.redStops||viewer.stats.pending||!await evidence(false))continue
        await viewer.freeze()
        const frame=await evidence(true)
        if(frame)return frame
        viewer.resume()
      }
      throw Error('No unobscured east bridge queue and crossing flow')
    })
    console.log('East queue',queue)
    await page.screenshot({path:'captures/jiefang-queue.png'})
    await page.evaluate(()=>{window.viewer.resume();window.viewer.camera.position.z=-9})
    for(const x of [40,-600,-265]){
      await page.evaluate(x=>{window.viewer.camera.position.x=x},x)
      await page.waitForFunction(x=>window.viewer.trafficProbe?.loads.at(-1)?.key===`${Math.floor(x/512)}_-1`,x)
    }
    console.log('Cell switches',JSON.stringify(await page.evaluate(()=>window.viewer.trafficProbe.loads)))
  }
} finally {await browser.close();await server.close()}
