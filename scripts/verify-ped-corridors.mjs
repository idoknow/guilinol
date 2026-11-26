import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {writeFileSync} from 'node:fs'
import {pinches,needsAdmission,canRoute} from '../web/src/traffic/narrow.ts'

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
  for(const id of [27672,56082,11018,1226]){
    const lane=graph.lanes.find(lane=>lane.id===id)
    const track=tracks.find(track=>track.corridor?.direction===1&&lane.pedProfiles.includes(track.corridor.profile)&&track.corridor.profile[1].some(([a,b,l,r])=>(l===null||r===null)&&2*(b-a)>20))
    assert.ok(track,`missing measured track ${id}`)
    const span=track.corridor.profile[1].find(([a,b,l,r])=>(l===null||r===null)&&2*(b-a)>20)
    const mid=span[0]+span[1]-track.corridor.origin
    assert.ok(mid>=5&&mid<=track.length-5)
    const start=id===1226?[32,track.length-36]:[mid-5,track.length-mid-5]
    cases.push({track,label:`${track.street} ${id}`,span,start})
  }
  let restricted=0,pinchCount=0
  for(const track of tracks){
    const corridor=track.corridor
    if(corridor?.direction!==1)continue
    for(const pinch of pinches(corridor.profile)){
      pinchCount++
      if(needsAdmission(corridor,pinch)){
        restricted++
        assert.equal(canRoute(corridor,0,[{track:track.pairTrack,dist:0}]),false)
      }
    }
  }
  console.log({runtimePinches:pinchCount,restricted})
  let seed=277
  const candidates=tracks.filter(track=>track.corridor?.direction===1&&track.length>10&&pinches(track.corridor.profile).length&&!cases.some(test=>test.track===track))
  for(let index=0;index<3;index++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0
    const [track]=candidates.splice(seed%candidates.length,1)
    const id=graph.lanes.find(lane=>lane.pedProfiles?.includes(track.corridor.profile)).id
    const corridor=track.corridor,pinch=pinches(corridor.profile)[0]
    const pos=index=>Math.min(corridor.length,2*index)-corridor.origin
    const start=pinch.left===null?[pos(pinch.first),track.length-pos(pinch.right)-1]:[pos(pinch.left)-1,track.length-pos(pinch.last)]
    const span=corridor.profile[1].find(([first,last])=>first<=pinch.first&&last>=pinch.last)
    cases.push({track,label:`pinch ${id}`,span,start})
  }
  for(const {track,label,start,span} of cases){
    const actors=start.map((dist,index)=>({id:`ped-${index}`,track:index?track.pairTrack:track,dist,kind:'person',pace:1.4,speed:1.4,scale:1,dodge:0,down:0,leaving:false}))
    sim.actors=actors.slice();actors.forEach(actor=>sim.position(actor))
    const camera={x:(track.start.x+track.end.x)/2,z:(track.start.z+track.end.z)/2,y:track.start.y},slow=[0,0],wait=[0,0],frames=[],trace=[]
    let overlap=0,stalls=0,longest=0,closest=Infinity,passed=false,retreats=0,backMetres=0,retreatTime=0
    const backBefore=[false,false],elapsed=[0,0]
    for(let frame=0;frame<1200;frame++){
      sim.step(.05,camera)
      const active=actors.filter(actor=>sim.actors.includes(actor)&&!actor.leaving&&!actor.arrived)
      const inside=[]
      for(const [index,actor] of actors.entries()){
        if(actor.backing){
          if(!backBefore[index])retreats++
          assert.ok(actor.speed<=.600001&&Math.cos(actor.yaw-actor.track.yaw)>.999)
          backMetres+=actor.speed*.05
        }
        elapsed[index]=actor.backing||elapsed[index]&&actor.waitingAtGate?elapsed[index]+.05:0
        retreatTime=Math.max(retreatTime,elapsed[index]);backBefore[index]=actor.backing
        const stopped=active.includes(actor)&&actor.speed<.1
        slow[index]=stopped&&!actor.waitingAtGate?slow[index]+1:0
        wait[index]=stopped&&actor.waitingAtGate?wait[index]+1:0
        if(slow[index]===41)stalls++
        longest=Math.max(longest,wait[index])
        if(span&&active.includes(actor)&&actor.track.corridor?.profile===track.corridor.profile){
          const along=actor.track.corridor.origin+actor.dist*actor.track.corridor.direction
          if(along>=2*span[0]&&along<=2*span[1])inside.push([actor.x,actor.z,actor.squeeze])
        }
      }
      frames.push(inside)
      if(active.length===2){
        const [first,second]=actors,dx=second.x-first.x,dz=second.z-first.z,dist=Math.hypot(dx,dz)
        if(dist<.45)overlap++
        closest=Math.min(closest,dist)
        if(dx*track.dx+dz*track.dz<-.65)passed=true
        if(span&&(dist<5||label.endsWith('1226')))trace.push(actors.map(({x,y,z,yaw,speed,squeeze})=>({x,y,z,yaw,speed,squeeze})))
      }
    }
    const [[squeezeFrames,maxExcess,narrowBodyOutside,centerOutside]]=span?JSON.parse(execFileSync('uv',['run','--locked','python','scripts/ped-envelope.py','--squeeze'],{input:JSON.stringify([frames])})):[[0,0,0,0]]
    if(label==='六合路'&&trace.length&&process.env.PED_NARROW_TRACE)writeFileSync(process.env.PED_NARROW_TRACE,JSON.stringify(trace))
    if(label.endsWith('1226')){
      assert.ok(retreats===1&&Math.abs(backMetres-6)<.001&&retreatTime<=15)
      if(process.env.PED_RETREAT_TRACE)writeFileSync(process.env.PED_RETREAT_TRACE,JSON.stringify(trace))
    }
    results.push({label,passed,closest:+closest.toFixed(3),overlap,stalls,maxWait:longest*.05,squeezeFrames,maxExcess,narrowBodyOutside,centerOutside,retreats,backMetres:+backMetres.toFixed(2),retreatTime:+retreatTime.toFixed(2)})
  }
  console.table(results)
  return results
}
