import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {Traffic} from '../web/src/traffic/sim.ts'
import {isPointInQuietZone} from '../web/src/game/quiet-zones.ts'

const graph=JSON.parse(gunzipSync(readFileSync('public/world/roads/graph.json.gz')))
let seed=110
const sim=new Traffic(graph,()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32))
const nodes=new Map(graph.nodes.map(node=>[node.id,node]))
const signals=new Map(graph.signals.map(signal=>[signal.node,signal.phases]))
let red=0,quiet=0,scooters=0,motorFrames=0,people=0
sim.onCross=(lane,time)=>{
  const phases=signals.get(lane.to)
  const period=phases.reduce((sum,phase)=>sum+phase.green+phase.yellow,0)
  const stamp=(time+lane.to%31)%period
  let start=0
  if(!phases.some(phase=>{
    const allowed=stamp>=start&&stamp<start+phase.green&&phase.lanes.includes(lane.id)
    start+=phase.green+phase.yellow
    return allowed
  }))red++
}
const bridge={x:-168,y:155,z:40}
const junction=[...signals.keys()].map(id=>nodes.get(id)).sort((a,b)=>Math.hypot(a.x-bridge.x,a.z-bridge.z)-Math.hypot(b.x-bridge.x,b.z-bridge.z))[0]
for(let frame=0;frame<6000;frame++){
  sim.step(.05,frame<2000?bridge:junction)
  for(const actor of sim.actors){
    if(actor.kind==='person'){people++;continue}
    motorFrames++;scooters+=Number(actor.kind==='scooter')
    quiet+=Number(isPointInQuietZone(actor.x,actor.z))
  }
}
const share=scooters/motorFrames
console.log({seconds:300,crossings:sim.crossed,transitions:sim.transitions,stopTicks:sim.stopped,red,quiet,motorFrames,scooterShare:share,pedestrianFrames:people})
assert.ok(sim.crossed>0&&sim.stopped>0&&sim.transitions>0&&people>0)
assert.equal(red,0);assert.equal(quiet,0);assert.ok(share>=.3&&share<=.4)
sim.step(.05,{x:1e6,y:0,z:1e6});assert.equal(sim.actors.length,0)
