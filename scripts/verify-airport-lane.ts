import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {gunzipSync} from 'node:zlib'
import {Traffic} from '../web/src/traffic/sim'
import {floorLevel} from '../web/src/tunnels'
import {vehicleSurface} from './vehicle-surface'

const [world='public/world',output='captures/vehicle-grounding/airport-route.json',baseline]=process.argv.slice(2)
const load=(file:string)=>JSON.parse(gunzipSync(fs.readFileSync(file)).toString())
const graph=load(path.join(world,'roads/graph.json.gz'))
const manifest=JSON.parse(fs.readFileSync(path.join(world,'manifest.json'),'utf8'))
const surface=vehicleSurface(world,manifest,graph)
const way=385796480, first=3891288847, last=3891288846
const nodes=new Map(graph.nodes.map(n=>[n.id,n] as const))
const exits=new Map(graph.lanes.filter(l=>l.way===way).map(l=>[l.from,l] as const))
const chain=[]
for(let ref=first;ref!==last;){
  const lane=exits.get(ref)
  assert(lane&&!chain.includes(lane),'Broken or cyclic service lane at '+ref)
  chain.push(lane)
  ref=lane.to
}
assert(chain.length>1)
if(baseline){
  const previous=load(path.join(baseline,'roads/graph.json.gz'))
  assert.deepEqual(graph.signals,previous.signals,'A signal phase or incoming lane ID changed')
  assert.equal(chain.at(-1).id,previous.lanes.find(l=>l.way===way&&l.from===first&&l.to===last)?.id)
}
const cell=load(path.join(world,'roads',Math.floor(-18814.81/512)+'_'+Math.floor(3934.32/512)+'.json.gz'))
const sim=new Traffic({...cell,walks:[]},()=>.99)
const tracks=[...sim.allTracks()]
const lanes=chain.map(l=>{
  const track=tracks.find(t=>t.id===l.id)
  assert(track&&track.floor===l.floor&&track.from===l.from&&track.to===l.to,'Missing or stale streamed lane '+l.id)
  return track
})
const start=lanes[0],car={track:start,dist:start.length-2,kind:'car' as const,scale:1,speed:7,
  down:0,dodge:0,leaving:false,x:start.end.x-2*start.dx,y:161,z:start.end.z-2*start.dz,
  yaw:start.yaw,halfLength:2.24,halfWidth:.91,height:1.5}
sim.actors.push(car)
const visited=new Set<number>()
for(let frame=0;frame<2400;frame++){
  visited.add(car.track.id)
  if(visited.size>=chain.length&&car.track.from===last)break
  sim.step(1/60,{x:car.x,y:car.y,z:car.z},undefined,()=>false)
}
assert(lanes.every(l=>visited.has(l.id))&&car.track.from===last,'Ambient motor did not traverse the complete chain')

const next=exits.get(last)
assert(next)
const end=nodes.get(next.to),junction=nodes.get(last)
const length=Math.hypot(end.x-junction.x,end.z-junction.z)
const second=nodes.get(chain[0].to)
const route=[[second.x-2*start.dx,second.z-2*start.dz,way],
  ...chain.map(l=>{const n=nodes.get(l.to);return [n.x,n.z,way]}),
  [junction.x+12*(end.x-junction.x)/length,junction.z+12*(end.z-junction.z)/length,way]]
const tunnel=manifest.tunnels.find(t=>t.way===385795252)
assert(tunnel)
let edgeSamples=0
for(const track of lanes){
  for(let d=0;d<=track.length;d+=.1){
    const x=track.start.x+track.dx*d,z=track.start.z+track.dz*d
    if(Math.hypot(x+18814.81,z-3934.32)>10)continue
    for(const side of [-.995,0,.995]){
      const hit={hidden:false,road:-Infinity}
      const px=x-track.dz*side,pz=z+track.dx*side
      surface(px,pz,{way},hit)
      const floor=floorLevel(tunnel,px,pz)??Math.min(...tunnel.portals.map(p=>p[1]))
      assert(!hit.hidden&&hit.road>=floor+tunnel.clearance,JSON.stringify({px,pz,floor,hit}))
      edgeSamples++
    }
  }
}
assert(edgeSamples>500)
const modes=[route,[...route].reverse()].map((points,i)=>({
  mode:'car',direction:i?'out':'in',route:points,startHeight:surface(points[0][0],points[0][1],{way})
}))
fs.mkdirSync(path.dirname(output),{recursive:true})
fs.writeFileSync(output,JSON.stringify([{id:way,way,modes}]))
console.log(JSON.stringify({segments:lanes.length,downstreamID:chain.at(-1).id,edgeSamples,clearanceBeyondWheel:.2,
  ambientTraversed:true,routeFile:output}))
