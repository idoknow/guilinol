import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {Matrix4,Vector3,Frustum} from 'three'
import {resolve} from 'node:path'
import {gunzipSync} from 'node:zlib'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const dir='public/world/roads/parking',index=JSON.parse(await readFile(`${dir}/index.json`))
const rows=(await Promise.all(Object.keys(index).map(async key=>JSON.parse(gunzipSync(await readFile(`${dir}/${key}.json.gz`)))))).flat()
assert.equal(rows.length,Object.values(index).reduce((sum,count)=>sum+count,0))
const major=cls=>['trunk','primary','secondary'].includes(cls?.replace(/_link$/,''))
assert.ok(rows.every(row=>!major(row[5])))
const graph=JSON.parse(gunzipSync(await readFile('public/world/roads/graph.json.gz')))
const nodes=new Map(graph.nodes.map(node=>[node.id,node]))
const lanes=graph.lanes.filter(lane=>lane.kind==='motor'&&major(lane.cls)),majorIds=new Set(lanes.map(lane=>lane.id))
async function withDeadline(work,label){
  let timer
  try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`${label}: 300 s wall timeout; 30 s simulation window not verified`)),300000)})])}
  finally{clearTimeout(timer)}
}
function validHeading(matrix,eye){
  const planes=new Frustum().setFromProjectionMatrix(new Matrix4().fromArray(matrix)).planes
  const origin=new Vector3(...eye)
  for(const lane of lanes){
    const start=nodes.get(lane.from),end=nodes.get(lane.to),dx=end.x-start.x,dz=end.z-start.z,length=Math.hypot(dx,dz)
    if(!length)continue
    const x=start.x-dz/length*lane.offset,z=start.z+dx/length*lane.offset
    const nearest=Math.max(0,Math.min(1,((origin.x-x)*dx+(origin.z-z)*dz)/(length*length)))
    if(Math.hypot(x+nearest*dx-origin.x,z+nearest*dz-origin.z)>80)continue
    const levels=lane.heights??[0,start.y,1,end.y]
    for(let index=2;index<levels.length;index+=2){
      const point=at=>new Vector3(x+levels[at]*dx,levels[at+1],z+levels[at]*dz)
      const from=point(index-2),to=point(index),delta=to.clone().sub(from)
      let low=0,high=1
      for(const plane of planes){
        const first=plane.distanceToPoint(from),last=plane.distanceToPoint(to)
        if(first<0&&last<0){high=-1;break}
        if(first<0)low=Math.max(low,first/(first-last));else if(last<0)high=Math.min(high,first/(first-last))
      }
      if(low>high)continue
      const fraction=Math.max(low,Math.min(high,origin.clone().sub(from).dot(delta)/(delta.lengthSq()||1)))
      if(from.addScaledVector(delta,fraction).distanceTo(origin)<=80)return lane.id
    }
  }
  return null
}
const pickups=JSON.parse(gunzipSync(await readFile('public/world/vehicles.bin'))).cars
let minSquared=Infinity
for(const [east,,south] of rows)for(const [pickupEast,,pickupSouth] of pickups){
  minSquared=Math.min(minSquared,(pickupEast-east)**2+(pickupSouth-south)**2)
}
console.log('Pickup clearance',{parked:rows.length,pickups:pickups.length,minMetres:Math.sqrt(minSquared)})
assert.ok(minSquared>64,'G2 parked car inside the pickup exclusion radius')
const server=await preview({root:'web',configFile:'web/vite.config.ts',build:{outDir:resolve(process.env.PERF_DIST??'dist')},preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch(browserOptions())
  const mobile=process.env.PERF_MOBILE==='1'
  const page=await browser.newPage(mobile?{viewport:{width:844,height:390},deviceScaleFactor:3,isMobile:true,hasTouch:true}:{viewport:{width:800,height:450}})
  if(mobile)await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate:4})
  page.on('pageerror',error=>console.error(error));page.on('console',msg=>{if(msg.type()==='error')console.error(msg.text().slice(-1500))})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&play=tour&traffic=1&flow=0&time=16&radius=480`)
  const cdp=await page.context().newCDPSession(page)
  const capture=async path=>writeFile(path,Buffer.from((await cdp.send('Page.captureScreenshot',{format:'jpeg'})).data,'base64'))
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  console.log('Traffic startup (ms)',await page.evaluate(()=>({firstFrame:window.viewer.stats.firstMs,viewerReady:performance.now()})))
  const shots=[...['residential','tertiary'].map(cls=>{
    const [x,y,z,yaw]=rows.filter(row=>row[5]===cls).sort((a,b)=>Math.hypot(a[0],a[2])-Math.hypot(b[0],b[2]))[0]
    return {name:cls,x:x-14*Math.sin(yaw)-3*Math.cos(yaw),y:y+4,z:z-14*Math.cos(yaw)+3*Math.sin(yaw),yaw}
  // IDOK-273: each street has only 1–3 motors; require one visible motor per valid heading.
  }),{name:'jiefang',x:-265,y:168,z:15,yaw:1.32,min:1},{name:'fengbei',x:-941.1,y:162,z:-845.46,yaw:0,min:1}]
  await mkdir('captures/traffic',{recursive:true});const results=[]
  for(const shot of shots){
    await page.evaluate(({x,y,z,yaw})=>{const camera=window.viewer.camera;camera.position.set(x,y,z);camera.lookAt(x+20*Math.sin(yaw),y-4,z+20*Math.cos(yaw));camera.updateMatrixWorld()},shot)
    await page.waitForFunction(({x,z})=>{const viewer=window.viewer;return viewer.trafficProbe?.loads.at(-1)?.key===`${Math.floor(x/512)}_${Math.floor(z/512)}`&&!viewer.stats.pending},shot,{timeout:120000})
    await page.waitForFunction(frame=>window.viewer.stats.frame>=frame+15,await page.evaluate(()=>window.viewer.stats.frame),{timeout:120000})
    if(!shot.min){
      const nearby=await page.evaluate(({x,z})=>window.viewer.trafficProbe.motorLanes.filter(actor=>Math.hypot(actor.x-x,actor.z-z)<=200),shot)
      const illegal=nearby.filter(actor=>!majorIds.has(actor.lane));console.log(shot.name,{nearby:nearby.length,illegal});assert.equal(illegal.length,0)
      await page.evaluate(()=>{window.viewer.trafficProbe.staticOnly=true})
      await page.waitForFunction(()=>window.viewer.trafficProbe.allMotors.length===0&&window.viewer.trafficProbe.parked>0)
      console.log('Static-only',shot.name,await page.evaluate(()=>({parked:window.viewer.trafficProbe.parked,moving:window.viewer.trafficProbe.allMotors.length})))
      await capture(`captures/traffic/${shot.name}-static.jpg`)
      await page.evaluate(()=>{window.viewer.trafficProbe.staticOnly=false})
    }
    await capture(`captures/traffic/${shot.name}.jpg`)
    if(!shot.min)continue
    const counts=[]
    await page.evaluate(()=>window.viewer.freeze())
    try{
      for(let heading=0;heading<8;heading++){
        const {matrix,eye}=await page.evaluate(({x,y,z,angle})=>{const camera=window.viewer.camera;camera.lookAt(x+20*Math.sin(angle),y-6,z+20*Math.cos(angle));camera.updateMatrixWorld();return {matrix:camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).toArray(),eye:camera.position.toArray()}},{...shot,angle:shot.yaw+heading*Math.PI/4})
        const lane=validHeading(matrix,eye)
        const street=lanes.find(track=>track.id===lane)?.street
        const observation=lane===null?{maxPixels:null,firstMs:null}:await withDeadline(page.evaluate(async({min,street})=>{
          const viewer=window.viewer,probe=viewer.trafficProbe,simStart=probe.simTime,trace=[]
          let firstMs=null,maxPixels=0,samples=0
          for(let second=0;second<=30;second++){
            while(probe.simTime-simStart<second-1e-6){
              const previous=probe.simTime;viewer.stepStreetTraffic()
              if(!(probe.simTime>previous))throw Error(`Traffic clock stalled; only ${samples} samples`)
            }
            const hits=await viewer.motorPixelCounts(),elapsed=probe.simTime-simStart
            samples++;maxPixels=Math.max(maxPixels,...hits.map(hit=>hit.pixels))
            if(firstMs===null&&hits.filter(hit=>hit.pixels>=6).length>=min)firstMs=Math.round(elapsed*1000)
            trace.push({second,actors:probe.motorLanes.filter(actor=>actor.street===street)})
          }
          return {maxPixels,firstMs,samples,simSeconds:+(probe.simTime-simStart).toFixed(2),...(firstMs===null?{street,trace}:{})}
        },{min:shot.min,street}),`${shot.name}/${heading}`)
        if(observation.trace)console.log('No motor pixels: trajectories',JSON.stringify(observation.trace))
        counts.push({heading,valid:lane!==null,lane,...observation});console.log(shot.name,counts.at(-1))
      }
    }finally{await page.evaluate(()=>window.viewer.resume())}
    if(shot.name==='fengbei'){
      await page.evaluate(({x,y,z})=>{const camera=window.viewer.camera;camera.lookAt(x+Math.SQRT2*10,y-6,z+Math.SQRT2*10);camera.updateMatrixWorld()},shot)
      await capture('captures/traffic/fengbei-45.jpg')
    }
    results.push(counts.filter(row=>row.valid))
  }
  for(const valid of results){assert.ok(valid.length,'no valid headings');for(const row of valid){
    assert.ok(row.samples>=20,`heading ${row.heading}: insufficient samples (${row.samples}/20)`)
    assert.ok(row.simSeconds>=30,`heading ${row.heading}: incomplete simulation window`)
    assert.notEqual(row.firstMs,null,`heading ${row.heading}: no motor with ≥6 pixels in 30 simulation seconds`)
  }}
}finally{await browser?.close();await server.close()}
