// Measure resident tile geometry in the same mobile palace view as perf-drive.
import {mkdir,writeFile} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions,seedBenchmark} from './qa-browser.mjs'

const [directory='dist',output='captures/vehicle-grounding/residency.json']=process.argv.slice(2)
const server=await preview({root:'web',configFile:false,build:{outDir:resolve(directory)},preview:{host:'127.0.0.1',port:0}})
const browser=await chromium.launch(browserOptions())
try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
  await seedBenchmark(context)
  const page=await context.newPage()
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/?verify&flow=0&time=10&traffic=1&cam=palace')
  async function settled(){
    await page.waitForFunction(()=>{
      const v=window.viewer
      if(!v?.stats.firstMs||v.stats.pending||!v.trafficProbe?.allMotors?.length)return false
      return v.manifest.chunks.every(t=>Math.hypot(t.x+128-v.camera.position.x,t.z+128-v.camera.position.z)>v.stream.radius||v.stream.loaded.has(t))
    },null,{timeout:120000})
  }
  await settled()
  const report=await page.evaluate(()=>{
    const v=window.viewer,tiles=[]
    function bytes(g){
      if(!g)return 0
      const buffers=new Set(Object.values(g.attributes).map(a=>a.array.buffer))
      if(g.index)buffers.add(g.index.array.buffer)
      return [...buffers].reduce((sum,b)=>sum+b.byteLength,0)
    }
    for(const [tile,item] of v.stream.loaded){
      const t=item.tunnel
      tiles.push({file:tile.file,ground:bytes(item.groundMesh.geometry),street:bytes(item.streets.surface),
        building:bytes(item.batch.walls),structure:bytes(item.batch.bridge),
        detachedTunnel:t?Object.values(t).reduce((n,mesh)=>n+bytes(mesh.geometry),0):0})
    }
    return {tiles,profile:v.trafficProbe?.profileMemory?.(),cell:v.trafficProbe?.loads?.at(-1)?.key}
  })
  await page.evaluate(()=>{const c=window.viewer.camera;c.position.x+=2300;c.updateMatrixWorld()})
  await page.waitForFunction(files=>{
    const v=window.viewer
    return !v.stats.pending&&v.stream.loaded.size>0&&[...v.stream.loaded.keys()].every(t=>!files.includes(t.file))
  },report.tiles.map(t=>t.file),{timeout:120000})
  report.afterMove=await page.evaluate(()=>({tiles:[...window.viewer.stream.loaded.keys()].map(t=>t.file),profile:window.viewer.trafficProbe?.profileMemory?.()}))
  await mkdir(dirname(output),{recursive:true})
  await writeFile(output,JSON.stringify(report,null,2))
} finally {await browser.close();await server.close()}
