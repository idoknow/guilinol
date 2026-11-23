// IDOK-160: no motor vehicle may appear (or vanish) on screen near the camera.
// Drives a street-height camera along real primary/secondary roads with a
// 100° horizontal view cone and counts motor actors that first appear inside
// the cone closer than VISIBLE_SPAWN_MIN once the warm-up after a teleport is over.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {Traffic,VISIBLE_SPAWN_MIN} from '../web/src/traffic/sim.ts'

const graph=JSON.parse(gunzipSync(readFileSync('public/world/roads/graph.json.gz')))
const nodes=new Map(graph.nodes.map(node=>[node.id,node]))
const routes=graph.lanes.filter(lane=>lane.kind==='motor'&&(lane.cls==='primary'||lane.cls==='secondary')).filter((_,i)=>i%97===0).slice(0,24)
let seed=160,popIn=0,popOut=0,spawned=0,nearVisible=0,samples=0
for(const lane of routes){
  const sim=new Traffic(graph,()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32))
  const a=nodes.get(lane.from),b=nodes.get(lane.to),length=Math.hypot(b.x-a.x,b.z-a.z)
  if(length<20)continue
  const dx=(b.x-a.x)/length,dz=(b.z-a.z)/length
  let yaw=Math.atan2(dx,dz)
  const camera={x:a.x,y:a.y+1.7,z:a.z}
  const visible=point=>{
    const px=point.x-camera.x,pz=point.z-camera.z,d=Math.hypot(px,pz)
    if(d<.5||d>900)return false
    let delta=Math.atan2(px,pz)-yaw;delta=Math.atan2(Math.sin(delta),Math.cos(delta))
    return Math.abs(delta)<50*Math.PI/180
  }
  let previous=new Set()
  for(let tick=0;tick<1200;tick++){
    const t=tick*.05,s=(t*8)%(2*length)
    const along=s<length?s:2*length-s
    camera.x=a.x+dx*along;camera.z=a.z+dz*along
    yaw=Math.atan2(dx,dz)+(s<length?0:Math.PI)+Math.sin(t*.7)*1.2 // look around while driving
    sim.step(.05,camera,undefined,visible)
    const current=new Set(sim.actors)
    const settled=t>3
    for(const actor of sim.actors){
      if(actor.kind==='person')continue
      const near=(actor.x-camera.x)**2+(actor.z-camera.z)**2<VISIBLE_SPAWN_MIN**2
      if(settled&&near&&visible(actor))nearVisible++
      if(previous.has(actor))continue
      spawned++
      if(settled&&near&&visible(actor))popIn++
    }
    for(const actor of previous)if(!current.has(actor)&&actor.kind!=="person"&&actor.scale>.5&&settled&&visible(actor)&&(actor.x-camera.x)**2+(actor.z-camera.z)**2<VISIBLE_SPAWN_MIN**2)popOut++
    if(settled)samples++
    previous=current
  }
}
const perFrame=nearVisible/samples
console.log('Pop-in',{routes:routes.length,spawned,popIn,popOut,nearVisiblePerTick:+perFrame.toFixed(1)})
assert.equal(popIn,0,'motor actor spawned on screen near the camera')
assert.equal(popOut,0,'motor actor vanished on screen near the camera')
