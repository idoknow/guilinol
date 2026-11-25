import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const [dist, out] = process.argv.slice(2)
await mkdir(out, {recursive:true})
const server = await preview({configFile:false, build:{outDir:resolve(dist)}, preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser = await chromium.launch(browserOptions())
  const page = await browser.newPage({viewport:{width:960,height:540}})
  await page.route('https://stats.rcpd.cc/**', route=>route.fulfill({status:204}))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&cam=overview&radius=480&time=14&flow=0`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  await page.addStyleTag({content:'body > :not(canvas){visibility:hidden!important}'})
  for (const [name,eye,look] of [
    ['shanhu-west',[-1041,179,404],[-1057,153,376]],
    ['shanhu-south',[-1039,157,679],[-1035.55,149,670.64]],
    ['elephant',[-941,168,1110],[-965,146,1095]],
    ['ronghu',[-1560,198,352],[-1480,153,305]],
    ['overview',[-820,352,1110],[-1230,150,375]],
  ]) {
    const mark = await page.evaluate(({eye,look})=>{
      const {camera,stats} = window.viewer
      camera.position.set(...eye); camera.lookAt(...look); camera.updateMatrixWorld()
      return stats.frame
    },{eye,look})
    await page.waitForFunction(({eye,mark})=>{
      const {stats,stream,manifest} = window.viewer
      return stats.frame>mark+8 && manifest.chunks.filter(tile=>Math.hypot(tile.x+128-eye[0],tile.z+128-eye[2])<225).every(tile=>stream.loaded.has(tile))
    },{eye,mark},{timeout:120000})
    await page.evaluate(()=>window.viewer.freeze())
    await page.screenshot({path:resolve(out,`${name}.png`)})
    await page.evaluate(()=>window.viewer.resume())
  }
} finally { await browser?.close(); await server.close() }
