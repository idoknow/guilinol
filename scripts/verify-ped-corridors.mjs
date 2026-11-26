import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {writeFileSync} from 'node:fs'

export function verifyCorridors(graph,sim,tracks){
  const neg=graph.lanes.find(lane=>lane.id===32044)
  assert.ok(neg?.pedProfiles?.every(([,spans])=>!spans.length),'32044 must not have gates')
  const cases=[],seen=new Set()
  for(const track of tracks){
    if(!track.painted||seen.has(track.link.osm.join(':')))continue
    seen.add(track.link.osm.join(':'));cases.push({track,label:track.link.osm.join('/'),start:[1,1]})
    if(seen.size===4)break
  }
  assert.equal(seen.size,4,'four distinct OSM-backed crossings required')
  const profiles=new Set()
  for(const track of tracks){
    const corridor=track.corridor
    if(!corridor||corridor.direction!==1||profiles.has(corridor.profile))continue
    const span=corridor.profile[1].find(([, ,left,right])=>left!==null&&right!==null)
    if(!span)continue
    const [,,left,right]=span
    const first=Math.min(corridor.length,2*left)-corridor.origin,last=corridor.origin+track.length-Math.min(corridor.length,2*right)
    if(first<-.55||last<-.55)continue
    cases.push({track,label:track.street,span,start:[Math.max(0,first),Math.max(0,last)]});profiles.add(corridor.profile)
    if(profiles.size===4)break
  }
  const results=[]
  for(const {track,label,start,span} of cases){
    const actors=start.map((dist,index)=>({id:`ped-${index}`,track:index?track.pairTrack:track,dist,kind:'person',pace:1.4,speed:1.4,scale:1,dodge:0,down:0,leaving:false}))
    sim.actors=actors.slice();actors.forEach(actor=>sim.position(actor))
    const camera={x:(track.start.x+track.end.x)/2,z:(track.start.z+track.end.z)/2,y:track.start.y},slow=[0,0],wait=[0,0],frames=[],trace=[]
    let overlap=0,stalls=0,longest=0,closest=Infinity,passed=false
    for(let frame=0;frame<1200;frame++){
      sim.step(.05,camera)
      const active=actors.filter(actor=>sim.actors.includes(actor)&&!actor.leaving&&!actor.arrived)
      const inside=[]
      for(const [index,actor] of actors.entries()){
        const stopped=active.includes(actor)&&actor.speed<.1
        slow[index]=stopped&&!actor.waitingAtGate?slow[index]+1:0
        wait[index]=stopped&&actor.waitingAtGate?wait[index]+1:0
        if(slow[index]===41)stalls++
        longest=Math.max(longest,wait[index])
        if(span&&active.includes(actor)&&actor.track.corridor?.profile===track.corridor.profile){
          const along=actor.track.corridor.origin+actor.dist*actor.track.corridor.direction
          if(along>=2*span[0]&&along<=2*span[1])inside.push([actor.x,actor.z])
        }
      }
      frames.push(inside)
      if(active.length===2){
        const [first,second]=actors,dx=second.x-first.x,dz=second.z-first.z,dist=Math.hypot(dx,dz)
        if(dist<.45)overlap++
        closest=Math.min(closest,dist)
        if(dx*track.dx+dz*track.dz<-.65)passed=true
        if(span&&dist<5)trace.push(actors.map(({x,y,z,yaw,speed})=>({x,y,z,yaw,speed})))
      }
    }
    const [outside]=span?JSON.parse(execFileSync('uv',['run','--locked','python','scripts/ped-envelope.py'],{input:JSON.stringify([frames])})):[0]
    if(trace.length&&process.env.PED_NARROW_TRACE)writeFileSync(process.env.PED_NARROW_TRACE,JSON.stringify(trace))
    results.push({label,passed,closest:+closest.toFixed(3),overlap,stalls,maxWait:longest*.05,narrowBodyOutside:outside})
  }
  console.table(results)
  return results
}
