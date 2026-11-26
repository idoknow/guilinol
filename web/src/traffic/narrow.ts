type Station = [number,number]|null
type Span = [number,number,number|null,number|null]
export type Profile = [Station[],Span[]]
export type Corridor = {profile:Profile,length:number,origin:number,direction:number}

type Walker = {id?:string,dist:number,pace?:number,arrived?:boolean,leaving:boolean,track:{corridor?:Corridor}}
const station = (corridor:Corridor,index:number)=>Math.min(corridor.length,index*2)
const offset = (corridor:Corridor,dist:number)=>corridor.origin+corridor.direction*dist

export function clearance(corridor:Corridor,dist:number):[number,number]{
  const along=offset(corridor,dist),samples=corridor.profile[0]
  const index=Math.max(0,Math.min(samples.length-1,Math.floor(along/2)))
  const current=samples[index],next=samples[Math.min(samples.length-1,index+1)]
  if(!current||!next)return [0,0]
  const room=[0,1].map(side=>Math.max(0,Math.min(current[side],next[side])/1000-.25))
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
    return {singleFile:along>=start&&along<=end,limit}
  }
}
