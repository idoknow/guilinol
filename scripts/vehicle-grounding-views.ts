// Render the same sedan and camera against each measured contact plane.
import fs from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'
import {trafficModels} from '../web/src/traffic/models'
import {contactPose} from '../web/src/traffic/lane-surface'
import {trackHeight} from '../web/src/traffic/sim'

import path from 'node:path'
import {sites} from './vehicle-grounding-sites'
const sedanAxles=trafficModels().axles.get(0)!
const output='captures/vehicle-grounding/views'
fs.mkdirSync(output,{recursive:true})
const baseline=process.argv[2]
if(!baseline)throw Error('Pass the main checkout with its matching public/world')
const browser=await chromium.launch(browserOptions())
async function capture(side:'before'|'after',checkout:string){
  const root=path.resolve(checkout)
  const graph=JSON.parse(gunzipSync(fs.readFileSync(path.join(root,'public/world/roads/graph.json.gz'))).toString())
  const nodes=new Map(graph.nodes.map(n=>[n.id,n]))
  const server=await createServer({root:path.join(root,'web'),configFile:path.join(root,'web/vite.config.ts'),server:{port:0,host:'127.0.0.1'}})
  await server.listen()
  const page=await browser.newPage({viewport:{width:800,height:500}})
  try{
  await page.goto(server.resolvedUrls.local[0]+'?verify&flow=0&traffic=0&radius=256&time=14')
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0,null,{timeout:120000})
  await page.addStyleTag({content:'body > :not(canvas){visibility:hidden!important}'})
  for(const [name,id,f] of sites){
    const lane=graph.lanes.find(l=>l.id===id),a=nodes.get(lane.from),b=nodes.get(lane.to)
    const length=Math.hypot(b.x-a.x,b.z-a.z),dx=(b.x-a.x)/length,dz=(b.z-a.z)/length
    const x=a.x+dx*length*f-dz*lane.offset,z=a.z+dz*length*f+dx*lane.offset
    const track={...lane,length,start:a,end:b}
    const {pitch,roll,y}=side==='after'?contactPose(track,f*length,...sedanAxles):{pitch:0,roll:0,y:trackHeight(track,f*length)}
    const cy=y
      await page.evaluate(async({x,y,z,dx,dz,cy,pitch,roll})=>{
        const v=window.viewer,scene=v.stream.scene
        let sedan=scene.getObjectByName('grounding-fixture')
        if(!sedan){
          const {trafficModels}=await import('/src/traffic/models.ts')
          const {Mesh,MeshStandardMaterial}=await import('/@id/three')
          sedan=new Mesh(trafficModels().geometries[0],new MeshStandardMaterial({vertexColors:true,roughness:.7}))
          sedan.name='grounding-fixture';scene.add(sedan)
        }
        sedan.position.set(x,cy,z);sedan.rotation.set(pitch,Math.atan2(dx,dz),roll,'YXZ')
        v.camera.position.set(x+dx*4+dz*5,y+3,z+dz*4-dx*5);v.camera.lookAt(x,y+.45,z)
      },{x,y,z,dx,dz,cy,pitch,roll})
      await page.waitForFunction(({x,z})=>{
        const v=window.viewer
        return !v.stats.pending&&v.stream.loaded.has(v.manifest.chunks.find(c=>x>=c.x&&x<c.x+256&&z>=c.z&&z<c.z+256))
      },{x,z},{timeout:120000})
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
      await page.screenshot({path:output+'/'+name+'-'+side+'.png'})
    console.log(name,side)
  }
  }finally{await page.close();await server.close()}
}
try{await capture('before',baseline);await capture('after','.')}finally{await browser.close()}
