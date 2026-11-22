type Node = {id:number,x:number,y:number,z:number}
type Lane = {id:number,from:number,to:number,offset:number,kind:'motor'|'bus'|'nonmotor',speedKmh:number}
type Phase = {lanes:number[],green:number,yellow:number}
export type Graph = {nodes:Node[],lanes:Lane[],walks:[number,number,number,number?][],signals:{node:number,phases:Phase[]}[]}
type Track = Lane & {start:Node,end:Node,dx:number,dz:number,length:number,walk:boolean}
type Actor = {track:Track,dist:number,speed:number,kind:'car'|'scooter'|'person',down:number,dodge:number,x:number,y:number,z:number,yaw:number}
type Position = {x:number,z:number,y:number}

export class Traffic {
  actors:Actor[]=[]
  time=0
  crossed=0
  stopped=0
  transitions=0
  onCross?: (track:Lane,time:number)=>void
  private signal=new Map<number,Phase[]>()
  private exits=new Map<number,Track[]>()
  private cells=new Map<string,Track[]>()
  private random:()=>number
  constructor(graph:Graph,random=Math.random){
    this.random=random
    const nodes=new Map(graph.nodes.map(node=>[node.id,node]))
    const add=(lane:Lane,walk:boolean)=>{
      const start=nodes.get(lane.from)!,end=nodes.get(lane.to)!
      const length=Math.hypot(end.x-start.x,end.z-start.z)
      if(length<.5)return
      const track={...lane,start,end,length,dx:(end.x-start.x)/length,dz:(end.z-start.z)/length,walk}
      const exits=this.exits.get(start.id)??[];exits.push(track);this.exits.set(start.id,exits)
      const key=`${Math.floor((start.x+end.x)/2/128)},${Math.floor((start.z+end.z)/2/128)}`
      const cell=this.cells.get(key)??[];cell.push(track);this.cells.set(key,cell)
    }
    for(const lane of graph.lanes)add(lane,false)
    graph.walks.forEach(([from,to,offset,stable],index)=>{for(const reverse of [false,true])add({from:reverse?to:from,to:reverse?from:to,offset:reverse?-offset:offset,id:-1-2*(stable??index)-Number(reverse),kind:'nonmotor',speedKmh:5},true)})
    for(const signal of graph.signals)this.signal.set(signal.node,signal.phases)
  }
  inherit(previous:Traffic){
    this.time=previous.time
    for(const actor of previous.actors){
      const track=this.exits.get(actor.track.from)?.find(candidate=>candidate.id===actor.track.id)
      if(track)this.actors.push({...actor,track})
    }
  }
  private position(actor:Actor){
    const {track,dist}=actor
    actor.x=track.start.x+track.dx*dist-track.dz*(track.offset+actor.dodge)
    actor.z=track.start.z+track.dz*dist+track.dx*(track.offset+actor.dodge)
    actor.y=track.start.y+(track.end.y-track.start.y)*dist/track.length
    actor.yaw=Math.atan2(track.dx,track.dz)
  }
  private green(track:Track){
    const phases=this.signal.get(track.to)
    if(!phases)return true
    let local=(this.time+track.to%31)%phases.reduce((sum,p)=>sum+p.green+p.yellow,0)
    for(const phase of phases){
      if(local<phase.green+phase.yellow)return local<phase.green && phase.lanes.includes(track.id)
      local-=phase.green+phase.yellow
    }
    return false
  }
  step(dt:number,camera:Position,vehicle?:Position){
    this.time+=dt
    this.actors=this.actors.filter(actor=>Math.hypot(actor.x-camera.x,actor.y-camera.y,actor.z-camera.z)<210)
    for(let attempt=0;attempt<12 && this.actors.length<38;attempt++){
      const persons=this.actors.filter(actor=>actor.kind==='person').length
      const motors=this.actors.length-persons
      const walk=persons<12 && (motors>=26||attempt%3===0)
      if(!walk&&motors>=26)continue
      const cell=this.cells.get(`${Math.floor(camera.x/128)+Math.floor(this.random()*3)-1},${Math.floor(camera.z/128)+Math.floor(this.random()*3)-1}`)
      if(!cell?.length)continue
      const track=cell[Math.floor(this.random()*cell.length)]
      const scooter=this.actors.filter(actor=>actor.kind==='scooter').length<Math.round((motors+1)*.36)
      if(track.walk!==walk || (!walk&&(track.kind==='bus'||(!scooter&&track.kind==='nonmotor'))))continue
      const actor:Actor={track,dist:this.random()*track.length,speed:0,kind:walk?'person':scooter?'scooter':'car',down:0,dodge:0,x:0,y:0,z:0,yaw:0}
      this.position(actor)
      if(Math.hypot(actor.x-camera.x,actor.y-camera.y,actor.z-camera.z)>150 || this.actors.some(other=>Math.hypot(other.x-actor.x,other.z-actor.z)<8))continue
      this.actors.push(actor)
    }
    const obstacles=vehicle?[...this.actors,vehicle]:this.actors
    for(const actor of this.actors){
      const {track}=actor,person=actor.kind==='person'
      const maxSpeed=(person?1.4:Math.min(track.speedKmh/3.6,actor.kind==='car'?12:7))
      let advance=Math.min(maxSpeed,actor.speed+dt*2)*dt
      if(actor.down>0){actor.down-=dt;continue}
      actor.dodge*=Math.exp(-dt*1.2)
      for(const other of obstacles){
        if(other===actor||Math.abs(other.y-actor.y)>2)continue
        const dx=other.x-actor.x,dz=other.z-actor.z
        const ahead=dx*track.dx+dz*track.dz,lateral=Math.abs(dx*track.dz-dz*track.dx)
        if(person){
          if('kind' in other && other.kind==='person')continue
          if(Math.hypot(dx,dz)<1.2){actor.down=2;advance=0;break}
          if(Math.hypot(dx,dz)<4){
            const away=dx*track.dz-dz*track.dx>=0?1:-1
            actor.dodge=Math.max(-.9,Math.min(.9,actor.dodge+away*dt*3));advance=0;break
          }
        }else if(ahead>0&&lateral<1.8){advance=Math.min(advance,Math.max(0,ahead-5))}
      }
      if(!person&&!this.green(track)){
        const gap=Math.max(0,track.length-actor.dist-1)
        if(advance>gap)this.stopped++
        advance=Math.min(advance,gap)
      }
      actor.speed=advance/dt;actor.dist+=advance
      if(actor.dist>=track.length){
        if(!person&&this.signal.has(track.to)){this.crossed++;this.onCross?.(track,this.time)}
        const choices=(this.exits.get(track.to)??[]).filter(next=>next.walk===person && (person||next.to!==track.from) && (person||next.kind==='motor'||(actor.kind==='scooter'&&next.kind==='nonmotor')))
        if(!choices.length){actor.dist=track.length;actor.y=Infinity;continue}
        const onward=choices.filter(next=>next.to!==track.from)
        const pool=onward.length?onward:choices
        actor.track=pool[Math.floor(this.random()*pool.length)];actor.dist=0;this.transitions++
      }
      this.position(actor)
    }
    this.actors=this.actors.filter(actor=>Number.isFinite(actor.y))
  }
}
