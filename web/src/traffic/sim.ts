type Node = {id:number,x:number,y:number,z:number}
type Lane = {id:number,from:number,to:number,offset:number,kind:'motor'|'bus'|'nonmotor',speedKmh:number}
type Phase = {lanes:number[],green:number,yellow:number}
type Signal={node:number,group:number,offset:number,phases:Phase[]}
export type Graph = {nodes:Node[],lanes:Lane[],walks:[number,number,number,number?][],signals:Signal[]}
type Track = Lane & {start:Node,end:Node,dx:number,dz:number,length:number,walk:boolean}
type Actor = {track:Track,dist:number,speed:number,kind:'car'|'scooter'|'person',down:number,dodge:number,x:number,y:number,z:number,yaw:number,scale:number,leaving:boolean}
type Position = {x:number,z:number,y:number}

export class Traffic {
  actors:Actor[]=[]
  time=0
  crossed=0
  stopped=0
  transitions=0
  onCross?: (track:Lane,time:number)=>void
  private signal=new Map<number,Signal>()
  private junctions=new Set<number>()
  private queues=new Map<number,Actor[]>()
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
    const arms=new Map<number,Set<number>>()
    for(const lane of graph.lanes){
      add(lane,false)
      for(const [node,other] of [[lane.from,lane.to],[lane.to,lane.from]]){
        const neighbors=arms.get(node)??new Set<number>();neighbors.add(other);arms.set(node,neighbors)
      }
    }
    for(const [node,neighbors] of arms)if(neighbors.size>=3)this.junctions.add(node)
    graph.walks.forEach(([from,to,offset,stable],index)=>{for(const reverse of [false,true])add({from:reverse?to:from,to:reverse?from:to,offset:reverse?-offset:offset,id:-1-2*(stable??index)-Number(reverse),kind:'nonmotor',speedKmh:5},true)})
    for(const signal of graph.signals){this.signal.set(signal.node,signal);this.junctions.delete(signal.node)}
  }
  inherit(previous:Traffic){
    this.time=previous.time
    for(const actor of previous.actors){
      const track=this.exits.get(actor.track.from)?.find(candidate=>candidate.id===actor.track.id)
      if(track){actor.track=track;this.actors.push(actor)}
    }
    for(const [node,queue] of previous.queues)if(this.junctions.has(node))this.queues.set(node,queue.filter(actor=>this.actors.includes(actor)))
  }
  private position(actor:Actor){
    const {track,dist}=actor
    actor.x=track.start.x+track.dx*dist-track.dz*(track.offset+actor.dodge)
    actor.z=track.start.z+track.dz*dist+track.dx*(track.offset+actor.dodge)
    actor.y=track.start.y+(track.end.y-track.start.y)*dist/track.length
    actor.yaw=Math.atan2(track.dx,track.dz)
  }
  green(track:Lane,time=this.time){
    const signal=this.signal.get(track.to)
    if(!signal)return true
    const {phases,offset}=signal
    let local=(time+offset)%phases.reduce((sum,p)=>sum+p.green+p.yellow,0)
    for(const phase of phases){
      if(local<phase.green+phase.yellow)return local<phase.green && phase.lanes.includes(track.id)
      local-=phase.green+phase.yellow
    }
    return false
  }
  step(dt:number,camera:Position,vehicle?:Position,visible?:(point:Position)=>boolean){
    this.time+=dt
    this.actors=this.actors.filter(actor=>(!actor.leaving||actor.scale>0)&&Math.hypot(actor.x-camera.x,actor.y-camera.y,actor.z-camera.z)<210)
    let persons=0,scooters=0
    for(const actor of this.actors){persons+=Number(actor.kind==='person');scooters+=Number(actor.kind==='scooter')}
    let motors=this.actors.length-persons
    for(let attempt=0;attempt<48 && this.actors.length<80;attempt++){
      const walk=persons<20 && (motors>=60||attempt%3===0)
      if(!walk&&motors>=60)continue
      const cell=this.cells.get(`${Math.floor(camera.x/128)+Math.floor(this.random()*3)-1},${Math.floor(camera.z/128)+Math.floor(this.random()*3)-1}`)
      if(!cell?.length)continue
      const track=cell[Math.floor(this.random()*cell.length)]
      const scooter=scooters<Math.round((motors+1)*.36)
      if(track.walk!==walk || (!walk&&(track.kind==='bus'||(!scooter&&track.kind==='nonmotor'))))continue
      const actor:Actor={track,dist:this.random()*track.length,speed:0,kind:walk?'person':scooter?'scooter':'car',down:0,dodge:0,x:0,y:0,z:0,yaw:0,scale:0,leaving:false}
      this.position(actor)
      if(visible&&!visible(actor)&&this.random()>.035)continue
      if(Math.hypot(actor.x-camera.x,actor.y-camera.y,actor.z-camera.z)>185 || this.actors.some(other=>(other.x-actor.x)**2+(other.z-actor.z)**2<(other.track.id===track.id?36:5)))continue
      this.actors.push(actor)
      if(walk)persons++;else {motors++;scooters+=Number(scooter)}
    }
    for(const [node,queue] of this.queues){
      const retained=queue.filter(actor=>this.actors.includes(actor)&&!actor.leaving&&(actor.track.to===node||actor.track.from===node&&actor.dist<6))
      if(retained.length)this.queues.set(node,retained);else this.queues.delete(node)
    }
    const obstacles=vehicle?[...this.actors,vehicle]:this.actors
    for(const actor of this.actors){
      const {track}=actor,person=actor.kind==='person'
      if(actor.leaving){actor.scale=Math.max(0,actor.scale-dt/.4);continue}
      actor.scale=Math.min(1,actor.scale+dt/.4)
      const maxSpeed=(person?1.4:Math.min(track.speedKmh/3.6,actor.kind==='car'?12:7))
      let advance=Math.min(maxSpeed,actor.speed+dt*2)*dt
      if(actor.down>0){actor.down-=dt;continue}
      actor.dodge*=Math.exp(-dt*1.2)
      for(const other of obstacles){
        if(other===actor||Math.abs(other.y-actor.y)>2)continue
        const dx=other.x-actor.x,dz=other.z-actor.z
        if(Math.abs(dx)>7||Math.abs(dz)>7)continue
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
      if(!person&&this.junctions.has(track.to)&&track.length-actor.dist<9){
        const queue=this.queues.get(track.to)??[]
        if(!queue.includes(actor))queue.push(actor)
        this.queues.set(track.to,queue)
        const occupied=this.actors.some(other=>other!==actor&&other.kind!=='person'&&other.track.from===track.to&&other.dist<6)
        if(occupied||queue[0]!==actor)advance=Math.min(advance,Math.max(0,track.length-actor.dist-3))
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
        if(!choices.length){actor.dist=track.length;actor.speed=0;actor.leaving=true;continue}
        const onward=choices.filter(next=>next.to!==track.from)
        const pool=onward.length?onward:choices
        const straight=pool.filter(next=>next.dx*track.dx+next.dz*track.dz>.88)
        actor.track=straight.length&&this.random()<.85?straight.reduce((best,next)=>Math.abs(next.offset-track.offset)<Math.abs(best.offset-track.offset)?next:best):pool[Math.floor(this.random()*pool.length)]
        actor.dist=0;this.transitions++
      }
      this.position(actor)
    }
    this.actors=this.actors.filter(actor=>Number.isFinite(actor.y))
  }
}
