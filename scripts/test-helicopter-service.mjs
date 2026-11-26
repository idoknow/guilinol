import assert from 'node:assert/strict'
import test from 'node:test'
import {flightClock,queueETA,services} from '../lib/helicopter-clock.ts'
import {aircraftPose} from '../web/src/helicopter/flight.ts'
import {cabins,closestCabin} from '../web/src/helicopter/doors.ts'

for(const [mode,plan] of Object.entries(services))test(`${mode}: published service time, queue ETA and flight envelope agree`,()=>{
  const start=-plan.start*1000,end=start+plan.total*1000
  assert.ok(plan.total<=420);assert.equal(queueETA(mode,start,start,[]),plan.total)
  assert.equal(flightClock(start,0,mode).phase,'start');assert.equal(flightClock(end-1,0,mode).phase,'stop');assert.equal(flightClock(end,0,mode).phase,'landed')
  let previous,velocity
  for(let time=start;time<=end;time+=10){
    const pose=aircraftPose(time,0,mode)
    if(previous){const next=(pose.y-previous.y)*100;assert.ok(Math.abs(next)<=4.00001);if(velocity!==undefined)assert.ok(Math.abs(next-velocity)*100<=1.5001);velocity=next}
    previous=pose
  }
})

test('nearest free passenger door, never the occupied front-right pilot seat',()=>{
  for(const cabin of cabins){assert.equal(closestCabin(name=>name===cabin.door?0:10),cabin);assert.notEqual(closestCabin(name=>name===cabin.door?0:10,[cabin.number]),cabin)}
  assert.deepEqual(cabins.map(({seat,door})=>[door,seat]),[['door_front_L','seat_pax_1'],['door_L','seat_pax_2'],['door_R','seat_pax_3']])
})
