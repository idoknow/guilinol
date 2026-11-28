import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { chromium } from 'playwright'
import { preview } from 'vite'
import { browserOptions } from './qa-browser.mjs'

const views = [
  ['overview', [-24600,520,6300], [-25550,175,7100]],
  ['t2-landside', [-25150,215,7650], [-25600,182,7430]],
  ['t2-airside', [-25950,200,7100], [-25620,182,7430]],
  ['t1-front', [-25250,190,6950], [-25500,180,6860]],
  ['tower', [-25290,184,6600], [-25380,200,6543]],
  ['hangar-cargo', [-26095,233,5850], [-25620,175,5850]],
  ['departure-walk', [-25455.6,179,7432], [-25480.6,179,7432]],
  ['stand-walk', [-25894,177,7644], [-25874,180,7640]],
  ['threshold-walk', [-26366,177,8248], [-26354,177,8170]],
]
const table=JSON.parse(await readFile(process.env.AIRPORT_SHOT_PROPS??'dist/world/airport-props.json','utf8'))
if(process.env.AIRPORT_FAR){
  const entries=JSON.parse(await readFile('dist/world/manifest.json','utf8')).landmarks.filter(entry=>entry.farRadius===3000)
  for(const entry of entries){
    const [east,ground,south]=entry.position
    for(const [direction,dx,dz] of [['east',1,0],['south',0,1],['west',-1,0],['north',0,-1]])
      views.push([`${entry.id}-${direction}`,[east+2920*dx,ground+240,south+2920*dz],[east,ground+14,south]])
  }
}
function detail(name,kind,distance,height,azimuth=0){
  const [east,ground,south,yaw]=table[kind][0],angle=yaw+azimuth
  views.push([name,[east+distance*Math.sin(angle),ground+height,south+distance*Math.cos(angle)],
    [east,ground+(kind==='standSign'?1.6:1.15),south]])
}
detail('stand-number','standSign',6,2)
detail('ground-service','bus',12,3,.85)
detail('papi','papi',15,2,.7)
detail('approach','approachLight',15,2,.55)
detail('scenic-fence','fence',8,2,.95)
views.push(['terminal-night',[-25950,207,7100],[-25620,182,7430]])
const prefix = process.argv[2] ?? 'captures/airport/before'
await mkdir(dirname(prefix), {recursive:true})
const server = process.env.BASE ? null : await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser = await chromium.launch(browserOptions())
  const page = await browser.newPage({viewport:{width:1280,height:800}})
  const base = process.env.BASE ?? `http://127.0.0.1:${server.httpServer.address().port}`
  await page.goto(new URL('/?verify&flow=0&time=11', base).href, {waitUntil:'commit'})
  await page.waitForFunction(() => window.viewer?.camera, null, {timeout:180000})
  const metrics = {}
  for (const [name, eye, target] of views) {
    if(process.env.AIRPORT_FAR&&!name.startsWith('liangjiang_')&&name!=='overview')continue
    if(process.env.AIRPORT_VIEW && process.env.AIRPORT_VIEW!==name)continue
    await page.evaluate(([eye,target,name]) => {
      const { camera, manifest } = window.viewer
      window.viewer.clock.set(name==='terminal-night'?22:11)
      if (!manifest.region || manifest.dev_bbox) throw Error('Airport shots require the expanded world')
      camera.position.set(...eye)
      camera.lookAt(...target)
      camera.updateMatrixWorld()
    }, [eye,target,name])
    await page.waitForTimeout(4000)
    await page.waitForFunction(far => {
      const { stream, manifest, camera } = window.viewer
      const nearby = manifest.chunks.filter(tile => Math.hypot(tile.x + 128 - camera.position.x,
        tile.z + 128 - camera.position.z) <= stream.radius)
      return (far||!manifest.airportProps||stream.scene.getObjectByName('Airport props')) && !stream.updateLandmarks?.pendingCount?.() && (far||nearby.length) && nearby.every(tile => stream.loaded.has(tile)) &&
        !stream.pending.size && !stream.forest.pending.size
    }, Boolean(process.env.AIRPORT_FAR), {timeout:120000})
    metrics[name] = await page.evaluate(async () => {
      const samples = []
      const stream=window.viewer.stream, restore=[]
      let buckets={},peakBreakdown={}
      const count=(root,key)=>root?.traverse(node=>{
        if(!node.isMesh)return
        const previous=node.onBeforeRender
        node.onBeforeRender=function(...args){
          buckets[key]=(buckets[key]??0)+1
          return previous.apply(this,args)
        }
        restore.push(()=>{node.onBeforeRender=previous})
      })
      for(const [entry,group] of stream.landmarks){
        if(entry.id.startsWith('liangjiang_'))for(const lod of entry.lods)count(group.getObjectByName(lod),entry.id+':'+lod)
      }
      count(stream.scene.getObjectByName('Airport props'),'props')
      try{
        await new Promise(requestAnimationFrame)
        for (let frame = 0; frame < 12; frame++) {
          buckets={}
          await new Promise(requestAnimationFrame)
          const calls=window.viewer.stats.calls
          if(!samples.length||calls>Math.max(...samples))peakBreakdown={...buckets}
          samples.push(calls)
        }
      }finally{
        for(const reset of restore)reset()
      }
      return {peakCalls:Math.max(...samples), samples,airportMeshSubmissionsAtPeak:peakBreakdown}
    })
    await page.screenshot({path:`${prefix}-${name}.jpg`, quality:85})
    console.log(name, metrics[name].peakCalls)
  }
  await writeFile(`${prefix}-metrics.json`, JSON.stringify(metrics, null, 2) + '\n')
} finally {
  await browser?.close()
  await server?.close()
}
