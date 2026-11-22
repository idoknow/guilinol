import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {Traffic} from '../web/src/traffic/sim.ts'
import {isPointInQuietZone} from '../web/src/game/quiet-zones.ts'

const graph=JSON.parse(gunzipSync(readFileSync('public/world/roads/graph.json.gz')))
let seed=110
const sim=new Traffic(graph,()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32))
const nodes=new Map(graph.nodes.map(node=>[node.id,node]))
const signals=new Map(graph.signals.map(signal=>[signal.node,signal]))
const approach=lane=>{
  const start=nodes.get(lane.from),end=nodes.get(lane.to)
  return Math.abs(end.x-start.x)>Math.abs(end.z-start.z)?'EW':'NS'
}
const groups=Map.groupBy(graph.signals,signal=>signal.group)
for(const signal of graph.signals){
  assert.ok(signal.phases.every(phase=>phase.lanes.length>0),'empty green interval')
  for(const other of graph.signals){
    const start=nodes.get(signal.node),end=nodes.get(other.node)
    if(Math.hypot(end.x-start.x,end.z-start.z)<=45)assert.equal(signal.group,other.group)
  }
}
for(const members of groups.values()){
  const ids=new Set(members.map(signal=>signal.node))
  const lanes=graph.lanes.filter(lane=>ids.has(lane.to))
  const served=new Set()
  for(const signal of members){assert.deepEqual(signal.phases,members[0].phases);assert.equal(signal.offset,members[0].offset)}
  const period=members[0].phases.reduce((sum,phase)=>sum+phase.green+phase.yellow,0)
  for(let time=0;time<period;time+=.25){
    const directions=new Set()
    for(const lane of lanes)if(sim.green(lane,time)){directions.add(approach(lane));served.add(lane.id)}
    assert.ok(directions.size<=1,`cross traffic green at junction ${members[0].group}, t=${time}`)
  }
  assert.equal(served.size,lanes.length,'unserved inbound lane')
}
let red=0,quiet=0,scooters=0,motorFrames=0,people=0
sim.onCross=(lane,time)=>{
  const {phases,offset}=signals.get(lane.to)
  const period=phases.reduce((sum,phase)=>sum+phase.green+phase.yellow,0)
  const stamp=(time+offset)%period
  let start=0
  if(!phases.some(phase=>{
    const allowed=stamp>=start&&stamp<start+phase.green&&phase.lanes.includes(lane.id)
    start+=phase.green+phase.yellow
    return allowed
  }))red++
}
const bridge={x:-168,y:155,z:40}
const junction=[...signals.keys()].map(id=>nodes.get(id)).sort((a,b)=>Math.hypot(a.x-bridge.x,a.z-bridge.z)-Math.hypot(b.x-bridge.x,b.z-bridge.z))[0]
const stepMs=[],fullLoad=[]
for(let frame=0;frame<6000;frame++){
  const start=performance.now()
  sim.step(.05,frame<2000?bridge:junction)
  const elapsed=performance.now()-start;stepMs.push(elapsed)
  if(sim.actors.length===80)fullLoad.push(elapsed)
  for(const actor of sim.actors){
    if(actor.kind==='person'){people++;continue}
    motorFrames++;scooters+=Number(actor.kind==='scooter')
    quiet+=Number(isPointInQuietZone(actor.x,actor.z))
  }
}
const share=scooters/motorFrames
const percentiles=values=>{values.sort((left,right)=>left-right);return {steps:values.length,p50:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)]}}
console.log({signalGroups:groups.size,stepMs:percentiles(stepMs),fullLoadMs:percentiles(fullLoad)})
assert.ok(fullLoad.length>3000 && percentiles(fullLoad).p95<1)
console.log({seconds:300,crossings:sim.crossed,transitions:sim.transitions,stopTicks:sim.stopped,red,quiet,motorFrames,scooterShare:share,pedestrianFrames:people})
assert.ok(sim.crossed>0&&sim.stopped>0&&sim.transitions>0&&people>0)
assert.equal(red,0);assert.equal(quiet,0);assert.ok(share>=.3&&share<=.4)
sim.step(.05,{x:1e6,y:0,z:1e6});assert.equal(sim.actors.length,0)

const crossroads={nodes:[[1,-20,0],[2,0,-20],[3,0,0],[4,20,0]].map(([id,x,z])=>({id,x,z,y:0})),
  lanes:[[1,3],[2,3],[3,4]].map(([from,to],id)=>({id,from,to,kind:'motor',offset:0,speedKmh:36})),walks:[],signals:[]}
const fixture=new Traffic(crossroads,()=>.99)
function fixtureCar(lane,dist){
  const start=crossroads.nodes.find(node=>node.id===lane.from),end=crossroads.nodes.find(node=>node.id===lane.to)
  const length=Math.hypot(end.x-start.x,end.z-start.z),dx=(end.x-start.x)/length,dz=(end.z-start.z)/length
  return {track:{...lane,start,end,length,dx,dz,walk:false},dist,kind:'car',scale:1,speed:6,down:0,dodge:0,leaving:false,x:start.x+dist*dx,y:0,z:start.z+dist*dz,yaw:Math.atan2(dx,dz)}
}
const first=fixtureCar(crossroads.lanes[0],13),second=fixtureCar(crossroads.lanes[1],10)
fixture.actors.push(second,first)
let held=false,released=false,fadeTicks=0
for(let frame=0;frame<280;frame++){
  fixture.step(.05,{x:100,y:0,z:100})
  if(first.track.from===3&&first.dist<6){held=true;assert.equal(second.track.to,3)}
  if(second.track.from===3){released=true;assert.ok(first.track.from===3&&first.dist>=6)}
  if(first.leaving&&fixture.actors.includes(first)&&first.scale>0&&first.scale<1)fadeTicks++
}
assert.ok(held&&released,'first arrival owns the junction until the exit clears')
assert.equal(fadeTicks,7);assert.equal(fixture.actors.length,0)
console.log('FIFO / occupied exit / 400 ms dead-end fade: pass')
