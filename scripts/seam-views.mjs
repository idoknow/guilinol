import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const [dir,reportFile,output]=process.argv.slice(2)
if(!dir||!reportFile||!output)throw Error('usage: node scripts/seam-views.mjs DIST BASELINE_SEAMS_JSON OUT')
const report=JSON.parse(await readFile(reportFile)),manifest=JSON.parse(await readFile(join(dir,'world/manifest.json')))
const server=await preview({root:'web',configFile:'web/vite.config.ts',build:{outDir:dir},preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch(browserOptions())
  const page=await browser.newPage({viewport:{width:800,height:540}})
  page.on('pageerror',error=>console.error(error.message))
  page.on('console',message=>{if(['warning','error'].includes(message.type()))console.error(message.text().slice(0,500))})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&radius=256&time=12`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0,null,{timeout:60000})
  await mkdir(output,{recursive:true})
  const cameras={}
  for(const [name,view] of Object.entries(report.cameras??report.landmarks)){
    const {points=[],declaredMaterials=[],landmark:id=name}=view
    const entry=manifest.landmarks.find(item=>item.id===id)
    if(!entry)throw Error(`Missing landmark ${id}`)
    const [cx,cy,cz]=entry.position
    const point=points.find(point=>declaredMaterials.includes(point[2])&&point.at(-1).length)||points.find(point=>point.at(-1).length)||points[0]
    const x=point?.[0]??cx,z=point?.[1]??cz
    const length=Math.hypot(x-cx,z-cz)||1,dx=length===1?1:(x-cx)/length,dz=(z-cz)/length
    const pose=view.eye?view:{eye:[x+dx*28,cy+12,z+dz*28],target:[x,cy+.5,z]};cameras[name]=pose
    if(report.cameras)await page.setViewportSize(view.viewport??{width:800,height:540})
    await page.evaluate(({eye,target,id})=>{const {camera,stream,manifest}=window.viewer;camera.position.set(...eye);camera.lookAt(...target);stream.updateLandmarks?.(camera.position,manifest.landmarks.find(entry=>entry.id===id))},{...pose,id})
    await page.waitForFunction(id=>{const {stats,stream}=window.viewer;return !stats.pending&&[...stream.landmarks.keys()].some(item=>item.id===id)},id,{timeout:45000}).catch(async error=>{console.error(id,await page.evaluate(()=>({stats:window.viewer.stats,eye:window.viewer.camera.position.toArray(),loaded:[...window.viewer.stream.landmarks.keys()].map(entry=>entry.id)})));throw error})
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await page.waitForFunction(()=>{const {manifest,camera,stream}=window.viewer;return manifest.chunks.every(tile=>Math.hypot(tile.x+128-camera.position.x,tile.z+128-camera.position.z)>stream.radius||stream.loaded.has(tile))},null,{timeout:60000})
    await page.screenshot({path:join(output,name+'.png')})
  }
  await writeFile(join(output,'cameras.json'),JSON.stringify(cameras,null,2))
}finally{await browser?.close();await server.close()}
