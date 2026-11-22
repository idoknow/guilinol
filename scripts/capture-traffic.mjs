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
    const pixelVisible=await page.evaluate(()=>window.viewer.trafficPixels());console.log('Pixel-visible motors',pixelVisible);assert.ok(pixelVisible>=20)
    await page.screenshot({path:'captures/jiefang-traffic.png'})
    await page.evaluate(()=>window.viewer.resume())
    await page.evaluate(()=>{const camera=window.viewer.camera;camera.position.set(60,172,95);camera.lookAt(160,153,147);camera.updateMatrixWorld()})
    await page.waitForFunction(()=>window.viewer.trafficProbe?.loads.at(-1)?.key==='0_0'&&window.viewer.trafficProbe.redStops>0&&window.viewer.trafficProbe.queued>=3&&!window.viewer.stats.pending,null,{timeout:180000})
    await page.evaluate(()=>window.viewer.freeze());console.log('East queue',JSON.stringify(await page.evaluate(()=>window.viewer.trafficProbe)))
    await page.screenshot({path:'captures/jiefang-queue.png'})
    await page.evaluate(()=>{window.viewer.resume();window.viewer.camera.position.z=-9})
    for(const x of [40,-600,-265]){
      await page.evaluate(x=>{window.viewer.camera.position.x=x},x)
      await page.waitForFunction(x=>window.viewer.trafficProbe?.loads.at(-1)?.key===`${Math.floor(x/512)}_-1`,x)
    }
    console.log('Cell switches',JSON.stringify(await page.evaluate(()=>window.viewer.trafficProbe.loads)))
  }
} finally {await browser.close();await server.close()}
