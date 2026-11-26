import assert from 'node:assert/strict'
import test from 'node:test'
import {spots} from '../web/src/play/spots.ts'
import {tourRoute, modes, canDisembark} from '../web/src/helicopter/route.ts'

for (const mode of Object.keys(modes)) test(`${mode}: closed album route and bounded attitude`,()=>{
  const pad={x:-830,z:230}, floor=150, route=tourRoute(pad,mode,()=>floor)
  assert.deepEqual(route.stops,[pad,...spots,pad]); assert.ok(route.duration>=240 && route.duration<=420)
  for(const [index, time] of route.times.entries()) {
    const pose=route.pose(time), stop=route.stops[index]
    assert.ok(Math.hypot(route.target(time).x-stop.x,route.target(time).z-stop.z)<0.001);assert.ok(Math.hypot(pose.x-stop.x, pose.z-stop.z)<1)
  }
  for(let time=0;time<route.duration;time+=0.2) {
    const pose=route.pose(time)
    assert.ok(pose.y-floor>=(mode==='high'?250:40))
    if(mode==='low') assert.ok(pose.y-floor<=70)
    assert.ok(Math.abs(pose.roll)<=25*Math.PI/180 && Math.abs(pose.pitch)<=Math.PI/18)
  }
})

test('exit requires landed, skids down, idling rotor and no motion',()=>{
  for(const phase of ['cruise','descent','landed']) for(const contact of [true,false])
    for(const idle of [true,false]) for(const speed of [0,0.01])
      assert.equal(canDisembark(phase,contact,idle,speed),phase==='landed' && contact && idle && speed===0)
})
