import {chromium} from 'playwright'
import {preview} from 'vite'
import {mkdir} from 'node:fs/promises'
import {browserOptions} from './qa-browser.mjs'

const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const browser=await chromium.launch(browserOptions())
try {
  const page=await browser.newPage({viewport:{width:960,height:540}})
  page.on('pageerror',console.error)
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&flow=0&time=17`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  await page.evaluate(()=>{
    const camera=window.viewer.camera
    camera.position.set(-265,168,15);camera.lookAt(-145,153,45);camera.updateMatrixWorld()
  })
  await page.waitForFunction(()=>window.viewer.trafficCount>=22&&!window.viewer.stats.pending,null,{timeout:180000})
  await page.evaluate(()=>window.viewer.freeze())
  const count=await page.evaluate(()=>window.viewer.trafficCount)
  await mkdir('captures',{recursive:true})
  await page.screenshot({path:'captures/jiefang-traffic.png'})
  console.log('Jiefang actors',count)
} finally {await browser.close();await server.close()}
