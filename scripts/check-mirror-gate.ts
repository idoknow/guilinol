import assert from 'node:assert/strict'
import {GroundMirrorGate} from '../web/src/look/mirror-gate'

const gate=new GroundMirrorGate(), switches:number[]=[]
let now=0
function frame(distance:number,clear=true,elapsed=10){
  now+=elapsed
  const {active,ready}=gate
  gate.step(now,clear && distance<=gate.radius)
  assert.ok(Math.abs(gate.ready-ready)<=.06+1e-12)
  if(active!==gate.active)switches.push(now)
}
function frames(count:number,distance:number){for(let index=0;index<count;index++)frame(distance)}
frames(200,121);assert.equal(gate.ready,0);assert.equal(gate.active,false)
frame(120);frames(34,140);assert.ok(gate.ready>.999)
for(let index=0;index<200;index++)frame(140,index%2===0)
frames(69,141);assert.equal(gate.ready,1)
frame(138);frames(99,141);assert.equal(gate.active,true)
frame(141);assert.equal(gate.active,false);assert.ok(gate.ready>.97)
frames(50,119);assert.equal(gate.ready,0);assert.equal(gate.active,false)
frames(100,119);assert.equal(gate.active,true)
frame(141,false,300);frames(118,141);assert.equal(gate.active,true)
frames(3,141);assert.equal(gate.active,false)
assert.equal(switches.length,4)
assert.ok(switches.slice(1).every((time,index)=>time-switches[index]>=1500))
gate.reset(now);assert.equal(gate.ready,0);assert.equal(gate.radius,120)
console.log('Mirror gate passed; transition times (ms):',switches)
