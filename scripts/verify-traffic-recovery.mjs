import assert from 'node:assert/strict'
import {Traffic} from '../web/src/traffic/sim.ts'

const nodes=[[0,0],[40,0],[130,0],[40,60]].map(([x,z],id)=>({id,x,y:0,z}))
const lanes=[[0,1],[1,2],[3,1]].map(([from,to],id)=>({id,from,to,kind:'motor',cls:'primary',offset:0,speedKmh:36}))
const sim=new Traffic({nodes,lanes,signals:[],walks:[]},()=>.5,0)
const track=[...sim.allTracks()][0]
const car=dist=>({track,dist,x:dist,y:0,z:0,speed:0,kind:'car',down:0,dodge:0,yaw:track.yaw,scale:1,leaving:false,halfWidth:.9,halfLength:2.1,height:1.5})
const follower=car(32),leader=car(37)
sim.actors.push(follower,leader)
const camera={x:40,y:1,z:0},obstacle={x:39,y:0,z:0}
const samples=[]
let passedAt
for(let tick=0;tick<400;tick++){
  sim.step(.05,camera,tick<40?obstacle:undefined,()=>true)
  if(tick%40===39)samples.push(sim.actors.filter(actor=>!actor.leaving&&actor.speed<.05).length)
  if(follower.track.from===1&&follower.dist>3&&follower.speed>0)passedAt??=sim.time
}
console.log({stoppedEvery2s:samples,passedAt})
assert.ok(passedAt<12,'follower must clear the junction within 10s of obstacle removal')

const opposite={...lanes[0],id:4,from:1,to:0}
const faceoff=new Traffic({nodes,lanes:[lanes[0],opposite],signals:[],walks:[]},()=>.5,0)
const [east,west]=faceoff.allTracks(),a=car(16),b=car(21)
Object.assign(a,{track:east});Object.assign(b,{track:west,dist:19})
faceoff.actors.push(a,b)
let survivorPassed=false
for(let tick=0;tick<320;tick++){
  faceoff.step(.05,camera,undefined,()=>true)
  survivorPassed||=(!a.leaving&&a.x>23)||(!b.leaving&&b.x<14)
}
assert.ok(survivorPassed,'a confirmed head-on cycle must yield and clear')

const held=new Traffic({nodes,lanes:[lanes[0]],signals:[],walks:[]},()=>.5,0)
const patient=car(32);patient.track=[...held.allTracks()][0];held.actors.push(patient)
for(let tick=0;tick<1600;tick++)held.step(.05,camera,{x:34,y:0,z:0},()=>true)
assert.ok(!patient.leaving&&patient.x===32,'do not withdraw a car waiting for the player')
