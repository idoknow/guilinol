import {chromium} from 'playwright'
import {preview} from 'vite'
import {resolve} from 'node:path'
import {readFile,writeFile} from 'node:fs/promises'
import {glHookScript} from './gl-perf.mjs'
import {browserOptions} from './qa-browser.mjs'

const [baseline,candidate,output]=process.argv.slice(2)
const opening=await Promise.all([baseline,candidate].map(async dir=>
  (await readFile(resolve(dir,'index.html'),'utf8')).includes('id="opening-terrain"')))
if(opening[0]!==opening[1])throw Error('Build both frontends with the same opening-terrain configuration')
const runs=[]
const views=[['桂林站',110.27805,25.2601],['衡柳线',110.27622,25.27845]]
const browser=await chromium.launch(browserOptions(true))
try {
  for(let round=0;round<3;round++)for(const dir of (round%2?[candidate,baseline]:[baseline,candidate])){
    const server=await preview({configFile:false,build:{outDir:resolve(dir)},preview:{host:'127.0.0.1',port:0}})
    try {
      for(const [name,lon,lat] of views){
        const x=(lon-110.3)*111320*Math.cos(25.28*Math.PI/180),z=(25.28-lat)*110574
        const view={mode:'fly',x,y:205,z,lon,lat,yaw:0,pitch:-20,fov:55,alt:205,heading:0,target:null,landmark_id:null,build:'0'.repeat(40)}
        const page=await browser.newPage({viewport:{width:1280,height:800}})
        await page.addInitScript(glHookScript)
        await page.addInitScript(()=>performance.setResourceTimingBufferSize(10000))
        await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/?verify&radius=512&time=12&flow=0')
        await page.waitForFunction(()=>window.viewer?.stats.readyMs>0)
        const settled=()=>{
          const {stats,camera,manifest,stream}=window.viewer
          if(!stats.loaded || stats.pending || stream.forest.pending?.size || stream.updateLandmarks?.pendingCount())return false
          return manifest.chunks.every(tile=>{
            const distance=Math.hypot(tile.x+128-camera.position.x,tile.z+128-camera.position.z)
            return (distance>stream.radius || stream.loaded.has(tile)) &&
              (distance>(stream.metrics?.treeLoadRadius ?? 1682) || stream.forest.loaded.has(tile))
          })
        }
        // Finish loading the same opening pose before changing cameras. A deep
        // link can otherwise cancel different sets of in-flight landmark loads.
        await page.waitForFunction(settled,null,{timeout:120000})
        await page.waitForLoadState('networkidle')
        await page.evaluate(view=>window.viewer.setView(view),view)
        await page.waitForFunction(settled,null,{timeout:120000})
        await page.waitForLoadState('networkidle')
        const metrics=await page.evaluate(async()=>{
          const {stats,camera}=window.viewer
          await new Promise(done=>setTimeout(done,5000))
          const calls=[]
          for(let i=0;i<120;i++){await new Promise(requestAnimationFrame);if(i>=60)calls.push(stats.calls)}
          const bytes=performance.getEntriesByType('resource').filter(r=>r.name.includes('/world/')).reduce((a,b)=>a+b.encodedBodySize,0)
          return {loaded:stats.loaded,firstMs:stats.firstMs,calls:calls.sort((a,b)=>a-b)[30],bytes,vram:window.__glPerf.memory().totalBytes,camera:camera.position.toArray()}
        })
        runs.push({round,dir,name,...metrics})
        await page.close()
        await writeFile(output,JSON.stringify(runs,null,2))
      }
    }finally{await server.close()}
  }
}finally{await browser.close()}
