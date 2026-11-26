import assert from 'node:assert/strict'
import test from 'node:test'
import {cruiseSeconds,routeVersion,services} from '../lib/helicopter-clock.ts'
import {flightReplica} from '../web/src/helicopter/flight.ts'

const epoch=1800000000000
const delays=[[12,14],[85,11],[12,36],[18,65],[50,12],[15,13],[25,44],[8,9]]
function client(skew,stagger){
  const replica=flightReplica();let next=-30000+stagger,index=stagger?3:0
  return (time,flight)=>{
    while(next<=time){
      const [up,baseDown]=delays[index%delays.length],down=baseDown+(stagger?2:0)
      replica.sync(epoch+next-up-down+skew,epoch+next+skew,epoch+next-down)
      next+=2500;index++
    }
    return replica.pose(epoch+time+skew,flight)
  }
}
for(const mode of Object.keys(cruiseSeconds))test(`independent replicas: ${mode}`,()=>{
  const flight={t0:epoch,mode,version:routeVersion};let distance=0,angle=0
  for(const firstSkew of [0,-200,200])for(const secondSkew of [0,-200,200]){
    const first=client(firstSkew,0),second=client(secondSkew,731)
    for(let time=-7000;time<=(services[mode].total+60)*1000;time+=50){
      const left=first(time,flight),right=second(time,{...flight})
      distance=Math.max(distance,Math.hypot(left.x-right.x,left.y-right.y,left.z-right.z))
      for(const key of ['yaw','pitch','roll']){const delta=left[key]-right[key];angle=Math.max(angle,Math.abs(Math.atan2(Math.sin(delta),Math.cos(delta))))}
    }
    assert.equal(first(0,{...flight,version:'unknown'}),null)
  }
  console.log({mode,distance,angleDegrees:angle*180/Math.PI});assert.ok(distance<=.5);assert.ok(angle<.01)
})
