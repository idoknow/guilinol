type Station = [number,number]|null
type Span = [number,number,number|null,number|null]
export type Profile = [Station[],Span[]]
// behind: the walk track leading into this one, the dist on it of its nearest >=0.85 m station (target) and the metres back to it from this track's start (gap).
export type Corridor = {profile:Profile,length:number,origin:number,direction:number,pair?:Corridor,behind?:{track:WalkTrack,target:number,gap:number}}
type WalkTrack = {corridor?:Corridor,length:number,dx?:number,dz?:number,pairTrack?:WalkTrack}

type Walker = {id?:string,dist:number,pace?:number,arrived?:boolean,leaving:boolean,x?:number,z?:number,track:WalkTrack}
const station = (corridor:Corridor,index:number)=>Math.min(corridor.length,index*2)
const offset = (corridor:Corridor,dist:number)=>corridor.origin+corridor.direction*dist

type Pinch = {first:number,last:number,left:number|null,right:number|null}
const pinchCache=new WeakMap<Profile,Pinch[]>()
export function pinches(profile:Profile){
  const cached=pinchCache.get(profile)
  if(cached)return cached
  const [samples,spans]=profile,result:Pinch[]=[]
  const width=(index:number)=>{const sample=samples[index];return sample?sample[0]+sample[1]:NaN}
  for(const [start,end] of spans){
    for(let index=start;index<=end;index++){
      if(!(width(index)<850))continue
      const first=index
      while(index<end&&width(index+1)<850)index++
      result.push({first,last:index,left:width(first-1)>=850?first-1:null,right:width(index+1)>=850?index+1:null})
    }
  }
  pinchCache.set(profile,result)
  return result
}

// Nearest >=0.85 m station within 8 m of a track's far end, measured back along that track.
export function bayBehind(corridor:Corridor,length:number){
  let gap=Infinity
  for(const [index,sample] of corridor.profile[0].entries()){
    if(!sample||sample[0]+sample[1]<850)continue
    const dist=(station(corridor,index)-corridor.origin)*corridor.direction
    if(dist>=-.001&&dist<=length+.001&&length-dist<=8)gap=Math.min(gap,Math.max(0,length-dist))
  }
  return gap
}
// A pinch that starts at this track's start can be backed out of onto the previous track.
function backsOut(corridor:Corridor|undefined,pinch:Pinch){
  if(!corridor?.behind)return false
  return (station(corridor,corridor.direction>0?pinch.first:pinch.last)-corridor.origin)*corridor.direction<=2
}
// Along-corridor position of the waiting station on each side of a pinch, own track first, then the connected track behind.
function gates(corridor:Corridor,pinch:Pinch):[number|null,number|null]{
  const forward=corridor.direction>0?corridor:corridor.pair,backward=corridor.direction>0?corridor.pair:corridor
  const behind=(side:Corridor|undefined)=>side&&backsOut(side,pinch)?side.origin-side.direction*side.behind!.gap:null
  return [pinch.left!==null?station(corridor,pinch.left):behind(forward),pinch.right!==null?station(corridor,pinch.right):behind(backward)]
}

type Retreat={track:WalkTrack,target:number,other:Walker,profile:Profile}
const retreats=new WeakMap<Walker,Retreat>()
export function needsAdmission(corridor:Corridor,pinch:Pinch){
  const [left,right]=gates(corridor,pinch),count=Number(left!==null)+Number(right!==null)
  return !count||(right??station(corridor,pinch.last))-(left??station(corridor,pinch.first))>8*count
}
export function canRoute(corridor:Corridor|undefined,dist:number,actors:readonly Walker[]){
  if(!corridor)return true
  const along=offset(corridor,dist),direction=corridor.direction
  return !pinches(corridor.profile).some(pinch=>{
    if(!needsAdmission(corridor,pinch))return false
    const near=station(corridor,direction>0?pinch.first:pinch.last),far=station(corridor,direction>0?pinch.last:pinch.first)
    if((far-along)*direction<0)return false
    return actors.some(other=>{
      const reverse=other.track.corridor
      return !other.arrived&&!other.leaving&&reverse?.profile===corridor.profile&&reverse.direction!==direction&&(offset(reverse,other.dist)-near)*direction>=0
    })
  })
}
// Where a walker inside a pinch would back off to: its own entry station, else the station behind on the previous track.
function retreatTo(actor:Walker,pinch:Pinch){
  const corridor=actor.track.corridor!,entry=corridor.direction>0?pinch.left:pinch.right
  if(entry!==null){
    const distance=(offset(corridor,actor.dist)-station(corridor,entry))*corridor.direction
    if(distance>=0&&distance<=8&&distance<=actor.dist)return {distance,track:actor.track,target:actor.dist-distance}
  }
  const behind=corridor.behind
  if(behind?.track.corridor&&backsOut(corridor,pinch)&&actor.dist+behind.gap<=8)return {distance:actor.dist+behind.gap,track:behind.track,target:behind.target}
}
// Metres still to back up; the target may sit on the track behind the walker's current one.
const backLeft=(actor:Walker,state:Retreat)=>Math.max(0,state.track===actor.track?actor.dist-state.target:actor.dist+state.track.length-state.target)
function heldRetreat(actor:Walker,actors:readonly Walker[]){
  const state=retreats.get(actor)
  if(!state)return
  const {other,track,profile}=state,{dx=0,dz=0}=actor.track
  const oncoming=!other.arrived&&!other.leaving&&actors.includes(other)&&(other.track.corridor?.profile===profile||other.track===track.pairTrack)
  // Released once the oncoming walker is 0.7 m past; world coordinates keep this valid across the track change.
  const ahead=((other.x??0)-(actor.x??0))*dx+((other.z??0)-(actor.z??0))*dz
  if(oncoming&&ahead>-.7)return state
  retreats.delete(actor)
}
function claimRetreat(actor:Walker,actors:readonly Walker[],corridor:Corridor){
  const along=offset(corridor,actor.dist),direction=corridor.direction
  for(const pinch of pinches(corridor.profile)){
    const start=station(corridor,pinch.first),end=station(corridor,pinch.last)
    if(along<start||along>end)continue
    const mine=retreatTo(actor,pinch)
    if(!mine)continue
    for(const other of actors){
      const reverse=other.track.corridor
      if(!reverse||other.arrived||other.leaving||retreats.has(other)||reverse.profile!==corridor.profile||direction===reverse.direction)continue
      const opposite=offset(reverse,other.dist)
      if(opposite<start||opposite>end||(opposite-along)*direction<=0)continue
      const theirs=retreatTo(other,pinch)?.distance??Infinity
      if(mine.distance>theirs||mine.distance===theirs&&String(actor.id??actors.indexOf(actor))>String(other.id??actors.indexOf(other)))continue
      const state={track:mine.track,target:mine.target,other,profile:corridor.profile};retreats.set(actor,state);return state
    }
  }
}
const yielder=(actor:Walker,actors:readonly Walker[])=>actors.find(other=>other!==actor&&retreats.get(other)?.other===actor&&heldRetreat(other,actors))
// Walkers mid-retreat, or the walker being let through, keep consulting passage() even on a track without narrow spans.
export function engaged(actor:Walker,actors:readonly Walker[]){return Boolean(heldRetreat(actor,actors)||yielder(actor,actors))}
// The track a retreating walker continues onto once it backs past its current track's start.
export function retreatTrack(actor:Walker){
  const state=retreats.get(actor)
  return state&&state.track!==actor.track?state.track:undefined
}

function pinchLimit(actor:Walker,actors:readonly Walker[],corridor:Corridor){
  const direction=corridor.direction,along=offset(corridor,actor.dist)
  let limit=Infinity
  for(const pinch of pinches(corridor.profile)){
    const entry=direction>0?pinch.left:pinch.right
    if(entry===null)continue
    const gate=station(corridor,entry),distance=(gate-along)*direction
    if(distance>5||distance<-.001)continue
    const far=direction>0?pinch.right:pinch.left
    const farGate=station(corridor,far??(direction>0?pinch.last:pinch.first))
    for(const other of actors){
      const reverse=other.track.corridor
      if(other.arrived||other.leaving||reverse?.profile!==corridor.profile||reverse.direction===direction)continue
      const opposite=offset(reverse,other.dist)
      if((opposite-gate)*direction<=0)continue
      const otherDistance=(opposite-farGate)*direction
      const eta=distance/(actor.pace??1.4),otherEta=otherDistance/(other.pace??1.4)
      if(otherDistance<0||otherEta<eta||otherEta===eta&&(otherDistance<distance||otherDistance===distance&&(other.id??'')<(actor.id??''))){
        limit=Math.min(limit,Math.max(0,distance));break
      }
    }
  }
  return limit
}

// Lateral room either side of the walk line. A full body (0.25 m) stays on the surface unless walkers squeeze past each other;
// then the edge margin gives up only what two opposite walkers need for 0.5 m between centres, and never more than 4.9 cm.
export function clearance(corridor:Corridor,dist:number,squeeze=0,atBay=false):[number,number]{
  const along=offset(corridor,dist),samples=corridor.profile[0]
  const index=Math.max(0,Math.min(samples.length-1,Math.floor(along/2)))
  const current=samples[index],next=samples[Math.min(samples.length-1,index+1)]
  if(!current||!next)return [0,0]
  const fraction=Math.min(1,Math.max(0,(along-station(corridor,index))/(station(corridor,index+1)-station(corridor,index)||1)))
  const sides=[0,1].map(side=>(atBay?current[side]+fraction*(next[side]-current[side]):Math.min(current[side],next[side]))/1000)
  const margin=Math.min(.25,Math.max(.25-.049*squeeze,(sides[0]+sides[1]-.5)/2))
  const roundingGuard=pinches(corridor.profile).length&&margin>=.25?.001:0
  const room=sides.map(width=>Math.max(0,width-margin-roundingGuard))
  return corridor.direction>0?[-room[0],room[1]]:[-room[1],room[0]]
}

export function passage(actor:Walker,actors:readonly Walker[]){
  const corridor=actor.track.corridor
  if(!corridor)return
  const held=heldRetreat(actor,actors)
  if(held){
    const back=backLeft(actor,held)
    return {singleFile:back>.01,limit:0,squeeze:back>.01?0:1,back,atBay:true}
  }
  const yielding=yielder(actor,actors)
  if(yielding&&retreats.get(yielding)!.profile!==corridor.profile){
    return {singleFile:false,limit:Infinity,squeeze:backLeft(yielding,retreats.get(yielding)!)>.01?0:1,atBay:true}
  }
  const along=offset(corridor,actor.dist),direction=corridor.direction
  for(const [first,last,left,right] of corridor.profile[1]){
    const start=station(corridor,first),end=station(corridor,last)
    const gateIndex=direction>0?left:right
    const gate=gateIndex===null?(direction>0?start:end):station(corridor,gateIndex)
    const remaining=(gate-along)*direction
    const exit=direction>0?(right===null?end:station(corridor,right)):(left===null?start:station(corridor,left))
    const nearbyPinches=pinches(corridor.profile).filter(pinch=>pinch.first>=first&&pinch.last<=last)
    if(remaining>5||(exit-along)*direction<(nearbyPinches.length?-3:-.5))continue
    const singleFile=along>=start&&along<=end
    if((left===null||right===null||end-start>14)&&!corridor.profile[0].slice(first,last+1).some(sample=>sample&&sample[0]+sample[1]<450)){
      let squeeze=0,atGate=false
      for(const other of actors){
        const reverse=other.track.corridor
        if(other.arrived||other.leaving||reverse?.profile!==corridor.profile||reverse.direction===direction)continue
        const gap=(offset(reverse,other.dist)-along)*direction
        if(gap>=-1.2&&gap<=3&&nearbyPinches.some(pinch=>[pinch.left,pinch.right].some(index=>index!==null&&Math.abs(along+direction*gap/2-station(corridor,index))<=3))){
          atGate=true;squeeze=Math.max(squeeze,Math.min(1,3-gap,2+gap))
        }
        if(gap>=-1&&gap<=3&&along+direction*gap/2>=start-.5&&along+direction*gap/2<=end+.5){
          squeeze=Math.max(squeeze,Math.min(1,3-gap,1+gap))
        }
      }
      const retreat=claimRetreat(actor,actors,corridor)
      if(retreat){
        const back=backLeft(actor,retreat)
        return {singleFile,limit:0,squeeze:back>.01?0:1,back,atBay:true}
      }
      if(yielding)squeeze=backLeft(yielding,retreats.get(yielding)!)>.01?0:1
      return {singleFile,limit:pinchLimit(actor,actors,corridor),squeeze,atBay:Boolean(yielding)||atGate}
    }
    let limit=Infinity
    if(remaining>=-.01){
      const otherGateIndex=direction>0?right:left
      const otherGate=otherGateIndex===null?exit:station(corridor,otherGateIndex)
      for(const other of actors){
        const reverse=other.track.corridor
        if(other.arrived||other.leaving||reverse?.profile!==corridor.profile||reverse.direction===direction)continue
        const opposite=offset(reverse,other.dist),otherGap=(opposite-otherGate)*direction
        if((opposite-gate)*direction<-.5)continue
        const eta=remaining/(actor.pace??1.4),otherEta=otherGap/(other.pace??1.4)
        if(otherGap<0||otherEta<eta||otherEta===eta&&(otherGap<remaining||otherGap===remaining&&(other.id??'')<(actor.id??''))){limit=Math.max(0,remaining);break}
      }
    }
    return {singleFile,limit,squeeze:0}
  }
}
