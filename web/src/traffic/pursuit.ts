import {applyFine} from '../game/commerce'
import {isPointInQuietZone, QUIET_ZONE_BUFFER_M} from '../game/quiet-zones'
import {emit, getState, setPoliceStop, setWanted, type GameEvent, type GameState} from '../game/state'
import {Traffic, type Track} from './sim'

type Point = {x:number; y:number; z:number}
type Reason = Extract<GameEvent,{type:'traffic:violation'}>['reason']
type End = Extract<GameEvent,{type:'pursuit:end'}>['reason']
type Officer = {track:Track; along:number; yaw:number} & Point

function longitudinal(track:Track, pos:Point) {
  return (pos.x-track.start.x)*track.dx+(pos.z-track.start.z)*track.dz
}
function pose(track:Track, along:number, offset=0) {
  return {x:track.start.x+track.dx*along-track.dz*offset,
    z:track.start.z+track.dz*along+track.dx*offset,
    y:track.start.y+(track.end.y-track.start.y)*along/track.length}
}
const distance = (first:Point, second:Point) => Math.hypot(first.x-second.x,first.y-second.y,first.z-second.z)

class Streets {
  private bins=new Map<string,Track[]>()
  private safe=new Map<number,boolean>()
  private incoming?:Map<number,Track[]>
  private goal?:number
  private next=new Map<number,Track>()
  constructor(private sim:Traffic) {
    for(const track of sim.allTracks()){
      const margin=Math.abs(track.offset)+6
      for(let col=Math.floor((Math.min(track.start.x,track.end.x)-margin)/32);col<=Math.floor((Math.max(track.start.x,track.end.x)+margin)/32);col++){
        for(let row=Math.floor((Math.min(track.start.z,track.end.z)-margin)/32);row<=Math.floor((Math.max(track.start.z,track.end.z)+margin)/32);row++){
          const key=`${col},${row}`,list=this.bins.get(key)??[]
          list.push(track);this.bins.set(key,list)
        }
      }
    }
  }
  nearest(pos:Point, motion:Point){
    let road:Track|undefined,walkDistance=Infinity,roadDistance=Infinity,score=Infinity
    for(const track of this.bins.get(`${Math.floor(pos.x/32)},${Math.floor(pos.z/32)}`)??[]){
      const along=Math.min(track.length,Math.max(0,longitudinal(track,pos)))
      const gap=distance(pos,pose(track,along,track.offset))
      if(track.walk){walkDistance=Math.min(walkDistance,gap);continue}
      const rank=gap+(motion.x*track.dx+motion.z*track.dz<0?.25:0)
      if(rank<score){score=rank;roadDistance=gap;road=track}
    }
    return {road,roadDistance,walkDistance}
  }
  allowed(track:Track){
    if(track.walk||track.kind!=='motor')return false
    let result=this.safe.get(track.id)
    if(result===undefined){
      result=true
      const steps=Math.ceil(track.length/4)
      for(let index=0;index<=steps;index++){
        const point=pose(track,track.length*index/steps)
        if(isPointInQuietZone(point.x,point.z,QUIET_ZONE_BUFFER_M+4)){result=false;break}
      }
      this.safe.set(track.id,result)
    }
    return result
  }
  private network(){
    if(!this.incoming){
      this.incoming=new Map()
      for(const track of this.sim.allTracks()){
        if(!this.allowed(track))continue
        const list=this.incoming.get(track.to)??[];list.push(track);this.incoming.set(track.to,list)
      }
    }
    return this.incoming
  }
  dispatch(road:Track,player:Point,spacing:number){
    let track=road,along=Math.min(road.length,longitudinal(road,player))-spacing
    while(along<0){
      const inbound=this.network().get(track.from)
      const previous=inbound?.find(candidate=>candidate.from!==track.to)??inbound?.[0]
      if(!previous){along=0;break}
      track=previous;along+=track.length
    }
    return {track,along,yaw:Math.atan2(track.dx,track.dz),...pose(track,along)}
  }
  route(node:number,goal:number){
    const incoming=this.network()
    if(this.goal!==goal){
      this.goal=goal;this.next.clear()
      const queue=[goal],seen=new Set(queue)
      for(let index=0;index<queue.length;index++)for(const track of incoming.get(queue[index])??[]){
        if(seen.has(track.from))continue
        seen.add(track.from);queue.push(track.from);this.next.set(track.from,track)
      }
    }
    return this.next.get(node)
  }
}

export class Pursuit {
  readonly officers:Officer[]=[]
  private sim?:Traffic
  private streets?:Streets
  private previous?:Point
  private lane?:Track
  private vehicle?:string
  private time=0
  private decay=0
  private lost=0
  private stopped=0
  private cooldown=new Map<Reason,number>()
  private caseId=''

  private violation(reason:Reason,points:number){
    if(this.time<(this.cooldown.get(reason)??0))return
    this.cooldown.set(reason,this.time+(reason==='collision'?3:5))
    if(!getState().wanted)this.caseId=crypto.randomUUID()
    setWanted(Math.min(5,getState().wanted+points) as GameState['wanted'])
    emit({type:'traffic:violation',reason,points});this.decay=this.time+30
  }
  end(reason:End){
    const active=getState().wanted>0
    setPoliceStop(false);setWanted(0);this.officers.length=0;this.lost=0;this.stopped=0
    this.previous=undefined;this.lane=undefined;this.vehicle=undefined;this.cooldown.clear()
    if(active)emit({type:'pursuit:end',reason})
  }
  step(dt:number,sim:Traffic|undefined,pos:Point,vehicleId?:string){
    this.time+=dt
    if(vehicleId&&this.vehicle&&this.vehicle!==vehicleId)this.end('switch')
    if(vehicleId)this.vehicle=vehicleId
    if(this.sim!==sim){this.sim=sim;this.streets=undefined;this.lane=undefined}
    if(!vehicleId&&!getState().wanted){this.previous=undefined;this.lane=undefined;return}
    if(sim&&!this.streets)this.streets=new Streets(sim)
    const prev=this.previous,motion={x:prev?pos.x-prev.x:0,z:prev?pos.z-prev.z:0,y:0}
    const speed=Math.hypot(motion.x,motion.z)/dt
    const match=this.streets?.nearest(pos,motion),road=match?.road
    if(vehicleId&&prev&&speed>1.5&&speed<90&&sim&&match){
      if(this.lane&&longitudinal(this.lane,prev)<this.lane.length&&longitudinal(this.lane,pos)>=this.lane.length&&sim.phase(this.lane)==='red')this.violation('red',2)
      if(match.walkDistance<1.6&&match.walkDistance+.35<match.roadDistance)this.violation('sidewalk',1)
      else if(road&&match.roadDistance<2.5&&(road.dx*motion.x+road.dz*motion.z)<-.7*speed*dt)this.violation('wrong-way',1)
      if(sim.actors.some(actor=>actor.kind!=='person'&&actor.scale>.6&&distance(actor,pos)<2.3))this.violation('collision',speed>8?3:2)
    }
    this.lane=vehicleId&&match&&match.roadDistance<3.5?road:undefined
    this.previous={...pos}
    const level=getState().wanted
    if(!level)return
    if(this.time>=this.decay){
      if(level===1){this.end('clear');return}
      setWanted((level-1) as GameState['wanted']);this.decay=this.time+15
    }
    const count=getState().wanted,streets=this.streets
    if(this.officers.length>count)this.officers.length=count
    if(streets&&road&&streets.allowed(road)&&match!.roadDistance<12){
      while(this.officers.length<count){
        this.officers.push(streets.dispatch(road,pos,32+8*this.officers.length))
      }
      for(const [slot,officer] of this.officers.entries()){
        const track=officer.track,same=track.id===road.id
        const target=same?Math.max(0,Math.min(track.length,longitudinal(road,pos)-slot*5)):track.length
        const advance=Math.sign(target-officer.along)*Math.min(Math.abs(target-officer.along),(7+count*2)*dt)
        officer.along+=advance
        if(advance)officer.yaw=Math.atan2(track.dx,track.dz)+(advance<0?Math.PI:0)
        Object.assign(officer,pose(track,officer.along))
        if(!same&&officer.along>=track.length){
          const next=track.to===road.from?road:streets.route(track.to,road.from)
          if(next){officer.track=next;officer.along=0}
        }
      }
    }
    const nearest=this.officers.reduce((gap,officer)=>Math.min(gap,distance(officer,pos)),Infinity)
    const spotted=nearest<12||this.officers.some(officer=>distance(officer,pos)<65+count*5&&
      (pos.x-officer.x)*Math.sin(officer.yaw)+(pos.z-officer.z)*Math.cos(officer.yaw)>0)
    this.lost=spotted?0:this.lost+dt
    setPoliceStop(!!vehicleId&&nearest<4&&speed<6)
    this.stopped=vehicleId&&nearest<4&&speed<1?this.stopped+dt:0
    if(this.lost>=8){this.end('lost');return}
    if(this.stopped>=2){
      if(applyFine({amount:count*35,reason:'traffic-pursuit',idempotencyKey:this.caseId}).ok)this.end('fine')
      else this.stopped=0
    }
  }
}
