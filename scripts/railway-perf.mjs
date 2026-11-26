import {chromium} from 'playwright'
import {preview} from 'vite'
import {resolve} from 'node:path'
import {readFile,writeFile} from 'node:fs/promises'
import {glHookScript} from './gl-perf.mjs'
import {browserOptions} from './qa-browser.mjs'

const [baseline,candidate,output,cameraFile]=process.argv.slice(2)
const runs=[]
const metresLon=111320*Math.cos(25.28*Math.PI/180)
const views=cameraFile ? [] : [
  {name:'桂林站',x:(110.27805-110.3)*metresLon,y:205,z:(25.28-25.2601)*110574,yaw:0,pitch:-20,fov:55},
  {name:'衡柳线',x:(110.27622-110.3)*metresLon,y:205,z:(25.28-25.27845)*110574,yaw:0,pitch:-20,fov:55},
]
const cameras=cameraFile ? JSON.parse(await readFile(cameraFile,'utf8')) : []
cameras.push({name:'n-road',eye:[35.1716,159.5,-9385.9371],target:[1.69,157.9,-9391.3365]})
for(const {name,eye:[x,y,z],target:[tx,ty,tz]} of cameras){
  const yaw=Math.atan2(x-tx,z-tz)*180/Math.PI
  const pitch=Math.atan2(ty-y,Math.hypot(tx-x,tz-z))*180/Math.PI
  views.push({name,x,y,z,yaw,pitch,fov:60})
}
const browser=await chromium.launch(browserOptions(true))
try {
  for(let round=0;round<3;round++)for(const dir of (round%2?[candidate,baseline]:[baseline,candidate])){
    const server=await preview({configFile:false,build:{outDir:resolve(dir)},preview:{host:'127.0.0.1',port:0}})
    try {
      for(const {name,x,y,z,yaw,pitch,fov} of views){
        const lon=110.3+x/metresLon,lat=25.28-z/110574
        const token=Buffer.from(JSON.stringify({mode:'fly',x,y,z,lon,lat,yaw,pitch,fov,alt:y,heading:0,target:null,landmark_id:null,build:'0'.repeat(40)})).toString('base64url')
        const page=await browser.newPage({viewport:{width:1280,height:800}})
        await page.addInitScript(glHookScript)
        await page.addInitScript(()=>performance.setResourceTimingBufferSize(10000))
        await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/?verify&radius=512&time=12&flow=0&view='+token)
        await page.waitForFunction(()=>window.viewer?.stats.readyMs>0)
        await page.waitForFunction(([x,y,z])=>{
          const v=window.viewer
          return v.stats.loaded>0 && !v.stats.pending && Math.hypot(v.camera.position.x-x,v.camera.position.y-y,v.camera.position.z-z)<.05
            && v.manifest.chunks.every(t=>Math.hypot(t.x+128-x,t.z+128-z)>v.stream.radius || v.stream.loaded.has(t))
        },[x,y,z],{timeout:90000})
        await page.waitForLoadState('networkidle')
        const metrics=await page.evaluate(async()=>{
          const {stats,camera}=window.viewer
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
