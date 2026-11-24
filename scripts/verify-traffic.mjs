import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {Traffic,TRAFFIC_DENSITY} from '../web/src/traffic/sim.ts'
import {pickups,resolveContact,useTrafficSolids} from '../web/src/traffic/contact.ts'
import {isPointInQuietZone} from '../web/src/game/quiet-zones.ts'

const graph=JSON.parse(gunzipSync(readFileSync('public/world/roads/graph.json.gz')))
let seed=110
const sim=new Traffic(graph,()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32))
const nodes=new Map(graph.nodes.map(node=>[node.id,node]))
const signals=new Map(graph.signals.map(signal=>[signal.node,signal]))
const approach=lane=>{
  const start=nodes.get(lane.from),end=nodes.get(lane.to)
  const length=Math.hypot(end.x-start.x,end.z-start.z)
  return [(end.x-start.x)/length,(end.z-start.z)/length]
}
const groups=Map.groupBy(graph.signals,signal=>signal.group)
for(const signal of graph.signals){
  assert.ok(signal.phases.every(phase=>phase.lanes.length>0),'empty green interval')
  for(const other of graph.signals){
    const start=nodes.get(signal.node),end=nodes.get(other.node)
    if(Math.hypot(end.x-start.x,end.z-start.z)<=45)assert.equal(signal.group,other.group)
  }
}
const conflicts=new Map()
for(const members of groups.values()){
  const ids=new Set(members.map(signal=>signal.node))
  const lanes=graph.lanes.filter(lane=>ids.has(lane.to))
  const served=new Set()
  for(const signal of members){assert.deepEqual(signal.phases,members[0].phases);assert.equal(signal.offset,members[0].offset)}
  const period=members[0].phases.reduce((sum,phase)=>sum+phase.green+phase.yellow,0)
  for(let time=0;time<period;time+=.25){
    const directions=[]
    for(const lane of lanes)if(sim.green(lane,time)){
      const [dx,dz]=approach(lane)
      if(directions.some(([vx,vz])=>Math.abs(dx*vx+dz*vz)<=Math.SQRT1_2+1e-12))conflicts.set(members[0].group,time)
      directions.push([dx,dz]);served.add(lane.id)
    }
  }
  assert.equal(served.size,lanes.length,'unserved inbound lane')
}
assert.equal(conflicts.size,0,`simultaneous crossing greens (junction, time): ${JSON.stringify([...conflicts])}`)
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
  if(sim.actors.length>=20+Math.round(60*TRAFFIC_DENSITY))fullLoad.push(elapsed) // IDOK-236: full load = 20 walkers + thinned motor cap
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

for(const mode of ['walk','car']){
  const solid={x:0,y:0,z:0,yaw:.87,halfWidth:.9,halfLength:2.1,height:1.5}
  useTrafficSolids((_x,_z,visit)=>visit(solid))
  const driving=mode==='car',radius=driving?2.12:.29
  const forward={x:Math.sin(solid.yaw),z:Math.cos(solid.yaw)}
  const point={x:-forward.x*6,y:0,z:-forward.z*6}
  let maxDepth=0,contacts=0;const durations=[]
  for(let frame=0;frame<180;frame++){
    const travel=(driving?15:1.65)/60
    point.x+=forward.x*travel;point.z+=forward.z*travel
    const start=performance.now()
    contacts+=Number(resolveContact(point,0,solid.yaw,driving?.86:radius,driving?radius:0))
    durations.push(performance.now()-start)
    maxDepth=Math.max(maxDepth,2.1+radius+point.x*forward.x+point.z*forward.z)
  }
  const {p95}=percentiles(durations);console.log({mode,contacts,maxDepth,p95})
  assert.ok(contacts>0&&maxDepth<=.05&&p95<=.2)
}
useTrafficSolids()

const classes=['primary','secondary','tertiary','residential']
const parallel={nodes:[],lanes:[],walks:[],signals:[]}
for(const [row,cls] of classes.entries())for(let side=0;side<2;side++){
  const id=2*row+side,z=8*(id-4)
  parallel.nodes.push({id:id*2,x:-124,y:0,z},{id:id*2+1,x:124,y:0,z})
  parallel.lanes.push({id,from:id*2,to:id*2+1,kind:'motor',cls,offset:0,speedKmh:20})
}
const densityRun=new Traffic(parallel,()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32))
const counts=[0,0,0,0]
for(let tick=0;tick<1600;tick++){
  densityRun.step(.05,{x:0,y:0,z:0})
  if(tick>=400)for(const actor of densityRun.actors)counts[classes.indexOf(actor.track.cls)]++
}
for(const [index,target] of [1,.6,.35,.12].entries()){
  const ratio=counts[index]/counts[0];console.log(classes[index],{perLaneKm:counts[index]/1200/.496,ratio})
  assert.ok(Math.abs(ratio-target)<=.3*target)
}

const vehicleData=JSON.parse(gunzipSync(readFileSync('public/world/vehicles.bin')))
// Keep the historical westbound curb as a deterministic parked-car
// obstruction even on releases where this particular pickup was moved.
const curbFixtures=[[-1415.4,-298.6],[-432.7,-59],[-984,-193.9],[-1001.5,-197.3],[-572,-92]]
for(const [east,south] of curbFixtures){
  const parked=vehicleData.cars.find(row=>row[0]===east && row[2]===south)
  const fixture=parked ?? (east===-1001.5 ? [-1001.5,151.5,-197.3,1.393] : null)
  assert.ok(fixture,`Missing pickup at ${east},${south}`)
  const [x,y,z,yaw]=fixture
  const remove=pickups.add({x,y,z,yaw,halfWidth:.9,halfLength:2.12,height:1.5})
  try{
    const flow=new Traffic(graph,()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32))
    let waiting=0,longest=0,peak=0
    for(let tick=0;tick<2400;tick++){
      flow.step(.05,{x,y,z});const stopped=flow.actors.filter(actor=>actor.kind!=='person'&&actor.speed<.1&&Math.hypot(actor.x-x,actor.z-z)<12).length
      waiting=stopped?waiting+1:0;longest=Math.max(longest,waiting);peak=Math.max(peak,stopped)
    }
    console.log('Jiefang pickup',{x,z,peakStoppedWithin12m:peak,longestStoppedSeconds:longest*.05})
    assert.ok(longest*.05<=30,`queue persisted at ${x},${z}`)
  }finally{remove()}
}
