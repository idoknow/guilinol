import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'
import {join} from 'node:path'

const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch(browserOptions())
  const page=await browser.newPage({viewport:{width:900,height:510}})
  if(process.env.SHOT_ROADS)await page.route('**/world/roads/**',route=>route.fulfill({path:join(process.env.SHOT_ROADS,new URL(route.request().url()).pathname.split('/roads/')[1])}))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&traffic=1&flow=0&time=16&radius=480`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  await page.evaluate(()=>{const camera=window.viewer.camera;camera.position.set(598,155.7,1113);camera.lookAt(591,155,1127);camera.updateMatrixWorld()})
  await page.addStyleTag({content:'body > :not(canvas){visibility:hidden!important}'})
  await page.waitForFunction(async()=>{
    const viewer=window.viewer,probe=viewer.trafficProbe
    if(probe?.loads.at(-1)?.key!=='1_2'||viewer.stats.pending)return false
    const nearby=probe.approaches.filter(actor=>Math.abs(actor.z-1127)<10&&Math.abs(actor.x-592)<4)
    if(!nearby.length)return false
    const seen=await viewer.trafficPixels()
    if(!nearby.some(actor=>seen.includes(actor.index)))return false
    await viewer.freeze();return true
  },null,{timeout:180000})
  await page.screenshot({path:process.argv[2]})
}finally{await browser?.close();await server.close()}
