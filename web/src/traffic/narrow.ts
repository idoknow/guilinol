type Station = [number,number]|null
type Span = [number,number,number|null,number|null]
export type Profile = [Station[],Span[]]
export type Corridor = {profile:Profile,length:number,origin:number,direction:number}

type Walker = {id?:string,dist:number,pace?:number,arrived?:boolean,leaving:boolean,track:{corridor?:Corridor}}
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

export function clearance(corridor:Corridor,dist:number,margin=.25):[number,number]{
  const along=offset(corridor,dist),samples=corridor.profile[0]
  const index=Math.max(0,Math.min(samples.length-1,Math.floor(along/2)))
  const current=samples[index],next=samples[Math.min(samples.length-1,index+1)]
  if(!current||!next)return [0,0]
  const room=[0,1].map(side=>Math.max(0,Math.min(current[side],next[side])/1000-margin))
  return corridor.direction>0?[-room[0],room[1]]:[-room[1],room[0]]
}

export function passage(actor:Walker,actors:readonly Walker[]){
  const corridor=actor.track.corridor
  if(!corridor)return
  const along=offset(corridor,actor.dist),direction=corridor.direction
  for(const [first,last,left,right] of corridor.profile[1]){
    const start=station(corridor,first),end=station(corridor,last)
    const gateIndex=direction>0?left:right
    const gate=gateIndex===null?(direction>0?start:end):station(corridor,gateIndex)
    const remaining=(gate-along)*direction
    const exit=direction>0?(right===null?end:station(corridor,right)):(left===null?start:station(corridor,left))
    if(remaining>5||(exit-along)*direction<-.5)continue
    const singleFile=along>=start&&along<=end
    if((left===null||right===null||end-start>14)&&!corridor.profile[0].slice(first,last+1).some(sample=>sample&&sample[0]+sample[1]<450)){
      let squeeze=0
      for(const other of actors){
        const reverse=other.track.corridor
        if(other.arrived||other.leaving||reverse?.profile!==corridor.profile||reverse.direction===direction)continue
        const gap=(offset(reverse,other.dist)-along)*direction
        if(gap>=-1&&gap<=3&&along+direction*gap/2>=start-.5&&along+direction*gap/2<=end+.5){
          squeeze=Math.max(squeeze,Math.min(1,3-gap,1+gap))
        }
      }
      return {singleFile,limit:pinchLimit(actor,actors,corridor),squeeze}
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
