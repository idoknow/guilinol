import assert from 'node:assert/strict'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const server=await createServer({root:'web',configFile:'web/vite.config.ts',server:{host:'127.0.0.1',port:0}})
let browser
try{
  await server.listen()
  browser=await chromium.launch(browserOptions())
  const page=await browser.newPage()
  page.on('requestfailed',r=>console.error(r.url(),r.failure()?.errorText));page.on('pageerror',console.error)
  page.on('console',m=>{if(m.type()==='error')console.error(m.text())})
  await page.route('**/ground-check',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Ground audit</title>'}))
  await page.goto(new URL('ground-check',server.resolvedUrls.local[0]).href)
  const report=await page.evaluate(async(checkPullOver)=>{
    const [{detail},{createPhysics},{playerSupport},{Traffic},{trafficModels}]=await Promise.all([
      '/src/world.ts','/src/walk/physics.ts','/src/walk/support.ts','/src/traffic/sim.ts','/src/traffic/models.ts',
    ].map(path=>import(new URL(path,location.href).href).catch(e=>{throw Error(`${path}: ${e}`)})))
    const manifest=await (await fetch('/world/manifest.json')).json()
    const bytes=await (await fetch('/world/roads/graph.json.gz')).arrayBuffer()
    const stream=new Blob([bytes]).stream()
    const graph=await new Response(new Uint8Array(bytes)[0]===31?stream.pipeThrough(new DecompressionStream('gzip')):stream).json()
    const traffic=new Traffic(graph), loaded=new Map(), tiles=new Map(manifest.chunks.map(tile=>[`${tile.x},${tile.z}`,tile]))
    const physics=await createPhysics(manifest,{loaded,radius:256,landmarks:new Map(),forest:{loaded:new Map()},grid:{near:()=>loaded.keys()}},{colliders:[],modelPeaks:[]}).catch(e=>{throw Error(`physics: ${e.stack}`)})
    const {supportAt,carSupportAt}=playerSupport(physics)
    traffic.sampleGround=(x,z,y,car)=>(car?carSupportAt:supportAt)(x,z,y)?.y
    const batches=new Map(),models=trafficModels(),bottoms={}
    for(const kind of ['car','scooter','person']){
      const ids=new Set(Array.from({length:100},(_,i)=>models.variant(kind,i/100,0).geometry))
      bottoms[kind]=[...ids].map(id=>{const mesh=models.geometries[id];mesh.computeBoundingBox();return mesh.boundingBox.min.y})
    }
    for(const track of traffic.allTracks()){
      const steps=Math.ceil(track.length/4)
      for(let index=0;index<=steps;index++){
        const dist=track.length*index/steps,x=track.start.x+track.dx*dist-track.dz*track.offset,z=track.start.z+track.dz*dist+track.dx*track.offset
        const key=`${Math.floor(x/256)*256},${Math.floor(z/256)*256}`
        if(!batches.has(key))batches.set(key,[])
        batches.get(key).push({track,dist})
      }
    }
    let samples=0,failed=0,missing=0,pullOver=null;const worst=[]
    for(const [key,points] of batches){
      const tile=tiles.get(key),data=tile&&await detail(tile,new AbortController().signal,undefined,manifest.tunnels).catch(e=>{throw Error(`${key}: ${e.stack}`)})
      if(data){loaded.set(tile,data);physics.sync(tile.x+128,tile.z+128)}
      if(checkPullOver&&key==='-2560,1792'){
        const duty=new Traffic(graph,()=>.5,1),track=[...duty.allTracks()].find(track=>track.id===39656&&!track.walk)
        const dist=(-2384.5373-track.start.x)*track.dx+(1936.9227-track.start.z)*track.dz
        const actor={track,dist,kind:'scooter',wrongWay:true,dodge:0,speed:1,scale:1}
        duty.sampleGround=traffic.sampleGround;duty.position(actor);duty.actors.push(actor)
        const camera={x:actor.x,y:actor.y,z:actor.z}
        if(!duty.pullOverViolator(actor))throw Error('pull-over rejected')
        for(let frame=0;frame<60;frame++)duty.step(1/30,camera,undefined,()=>true)
        const floor=supportAt(actor.x,actor.z,actor.y)?.y
        pullOver={lane:track.id,state:actor.dutyState,halted:actor.haltedByDuty,dodge:actor.dodge,speed:actor.speed,y:actor.y,floor}
      }
      for(const {track,dist} of points)for(const kind of track.walk?['person']:['car','scooter']){
        const actor={track,dist,kind,dodge:0};traffic.position(actor)
        const {x,y,z}=actor,ground=data&&(kind==='car'?carSupportAt:supportAt)(x,z,y)
        const delta=ground?Math.max(...bottoms[kind].map(bottom=>Math.abs(y+bottom-ground.y))):null
        samples++;if(delta===null)missing++;if(delta===null||delta>.05)failed++
        if(worst.length<10||(delta??Infinity)>(worst.at(-1).delta??Infinity)){
          worst.push({lane:track.id,kind,x,y,z,delta});worst.sort((a,b)=>(b.delta??Infinity)-(a.delta??Infinity));worst.splice(10)
        }
      }
      physics.clear();loaded.clear();data?.dispose()
    }
    return {tiles:batches.size,samples,failed,missing,worst,pullOver}
  },process.argv.includes('--pull-over'))
  console.log(JSON.stringify(report,null,2));assert.ok(report.samples>0&&report.failed===0)
  if(process.argv.includes('--pull-over')){
    const stop=report.pullOver
    assert.ok(stop&&stop.state==='pulled_over'&&stop.halted&&stop.speed===0&&stop.dodge>0&&Math.abs(stop.y-stop.floor)<.001)
  }
}finally{await browser?.close();await server.close()}
