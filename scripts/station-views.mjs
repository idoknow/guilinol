import {mkdir, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'
import {glHookScript} from './gl-perf.mjs'

const [build = 'dist', output = 'captures/station'] = process.argv.slice(2)
const east = (110.278235 - 110.3) * 111320 * Math.cos(25.28 * Math.PI / 180)
const south = (25.28 - 25.263846) * 110574
// Eye and target are east, absolute elevation, south. Identical for both builds.
const views = [
  ['front', [70, 157, -10], [0, 161, 0], 12],
  ['square', [100, 186, 64], [-12, 154, -5], 12],
  ['eaves', [56, 155, 67], [0, 161, -6], 12],
  ['taxi', [90, 157, -50], [18, 152, 4], 12],
  ['canopies', [-128, 170, 105], [-81, 156, -62], 12],
  ['bridge', [-135, 165, -125], [-58, 160, -86], 12],
  ['plan', [0, 700, 0], [0, 150, -0.01], 12],
  ['platform-night', [-62, 155, 45], [-68, 155, -55], 21],
  ['platform-day', [-62, 155, 45], [-68, 155, -55], 12],
  ['stairs', [-110, 155, -105], [-107, 159, -84], 12],
  ['front-night', [70, 157, -10], [0, 161, 0], 21],
]
await mkdir(output, {recursive:true})
const server = await preview({configFile:false,build:{outDir:resolve(build)},preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser = await chromium.launch(browserOptions(true))
  const records = []
  for (const [id, eye, target, hour] of views) {
    const page = await browser.newPage({viewport:{width:960,height:600}})
    await page.addInitScript(glHookScript)
    const [dx,dy,dz] = target.map((n,i)=>n-eye[i])
    const x=east+eye[0], z=south+eye[2]
    const view={mode:'fly',x,y:eye[1],z,lon:110.3+x/(111320*Math.cos(25.28*Math.PI/180)),lat:25.28-z/110574,
      yaw:Math.atan2(-dx,-dz)*180/Math.PI,pitch:Math.atan2(dy,Math.hypot(dx,dz))*180/Math.PI,
      fov:60,alt:eye[1],heading:0,target:null,landmark_id:null,build:'0'.repeat(40)}
    const token=Buffer.from(JSON.stringify(view)).toString('base64url')
    await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/?verify&radius=512&flow=0&time='+hour+'&view='+token)
    await page.waitForFunction(()=>window.viewer?.stats.readyMs>0 && window.viewer.stats.loaded && !window.viewer.stats.pending,null,{timeout:90000})
    await page.waitForLoadState('networkidle')
    const metrics=await page.evaluate(async()=>{
      const {stats,camera}=window.viewer
      const calls=[]
      for(let i=0;i<20;i++){await new Promise(requestAnimationFrame);calls.push(stats.calls)}
      return {firstMs:stats.firstMs,drawCalls:calls.sort((a,b)=>a-b)[10],vram:window.__glPerf.memory().totalBytes,eye:camera.position.toArray()}
    })
    await page.addStyleTag({content:'body * {visibility:hidden!important} canvas {visibility:visible!important}'})
    await page.screenshot({path:resolve(output,id+'.jpg'),quality:88})
    records.push({id, ...metrics})
    await writeFile(resolve(output,'views.json'),JSON.stringify(records,null,2))
    await page.close()
  }
} finally {
  await browser?.close()
  await server.close()
}
