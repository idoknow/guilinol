// Reproduce the low approach view with the production sedan at its measured wheel height.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {gunzipSync} from 'node:zlib'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'
import {trafficModels} from '../web/src/traffic/models'
import {contactPose} from '../web/src/traffic/lane-surface'

const world='public/world', output=process.argv[2]??'captures/canal-passages'
const graph=JSON.parse(gunzipSync(fs.readFileSync(path.join(world,'roads/graph.json.gz'))).toString())
const nodes=new Map(graph.nodes.map(n=>[n.id,n] as const))
const axles=trafficModels().axles.get(0)!
fs.mkdirSync(output,{recursive:true})
const server=await createServer({root:'web',configFile:'web/vite.config.ts',server:{port:0,host:'127.0.0.1'}})
await server.listen()
const browser=await chromium.launch(browserOptions())
try{
  const page=await browser.newPage({viewport:{width:1100,height:680},deviceScaleFactor:1})
  await page.goto(server.resolvedUrls!.local[0]+'?verify&flow=0&traffic=0&time=14&radius=320')
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0,null,{timeout:120000})
  await page.addStyleTag({content:'body > :not(canvas){visibility:hidden!important}'})
  const approaches=process.argv.includes('--warehouse')?[[1112703462,10180689515,78.5]]:[[1025751314,9457383800,4.8],[1034716138,9531714412,20.1]]
  for(const [way,node,distance] of approaches){
    const lane=graph.lanes.find(l=>l.way===way&&l.from===node)
    assert(lane && !lane.structure)
    const a=nodes.get(node),b=nodes.get(lane.to)
    const length=Math.hypot(b.x-a.x,b.z-a.z),dx=(b.x-a.x)/length,dz=(b.z-a.z)/length
    const x=a.x+dx*distance-dz*lane.offset,z=a.z+dz*distance+dx*lane.offset
    const {y,pitch,roll}=contactPose({...lane,start:a,end:b,length},distance,...axles)
    await page.evaluate(async({x,y,z,dx,dz,pitch,roll})=>{
      const v=window.viewer,scene=v.stream.scene
      let sedan=scene.getObjectByName('canal-passage-sedan')
      if(!sedan){
        const {trafficModels}=await import('/src/traffic/models.ts')
        const {Mesh,MeshStandardMaterial}=await import('/@id/three')
        sedan=new Mesh(trafficModels().geometries[0],new MeshStandardMaterial({vertexColors:true,roughness:.7}))
        sedan.name='canal-passage-sedan'
        scene.add(sedan)
      }
      sedan.position.set(x,y,z)
      sedan.rotation.set(pitch,Math.atan2(dx,dz),roll,'YXZ')
      v.camera.position.set(x-7*dx+4*dz,y+2.2,z-7*dz-4*dx)
      v.camera.lookAt(x+2.5*dx,y+1.35,z+2.5*dz)
    },{x,y,z,dx,dz,pitch,roll})
    await page.waitForFunction(({x,z})=>{
      const v=window.viewer
      return v.stats.pending===0&&v.manifest.chunks.filter(t=>Math.hypot(t.x+128-x,t.z+128-z)<215).every(t=>v.stream.loaded.has(t))
    },{x,z},{timeout:120000})
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await page.locator('body > canvas').first().screenshot({path:path.join(output,way+'.png')})
  }
}finally{await browser.close();await server.close()}
