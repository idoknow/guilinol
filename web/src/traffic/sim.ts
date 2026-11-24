import {axleHeight,contactPose} from './lane-surface.ts'
import {nearStatic,resolveContact,staticSolids,pickups,type Solid} from './contact.ts'
import {CAR_SCALE} from '../drive/scale.ts'
type Node = {id:number,x:number,y:number,z:number}
type Lane = {id:number,from:number,to:number,offset:number,width?:number,kind:'motor'|'bus'|'nonmotor',speedKmh:number,cls?:string,street?:string,npcWalks?:number[][],heights?:number[],floor?:string}
type Phase = {lanes:number[],green:number,yellow:number}
type Signal={node:number,group:number,offset:number,phases:Phase[]}
export type Graph = {nodes:Node[],lanes:Lane[],walks:[number,number,number,number?,number[]?][],signals:Signal[]}
export type Track = Lane & {knots?:Int32Array,start:Node,end:Node,dx:number,dz:number,yaw:number,length:number,walk:boolean}
export function trackHeight(track:Track,dist:number){
  if(track.floor)return axleHeight(track,dist)
  if(track.wheelPose)return poseAt(track.wheelPose,dist/track.length,1)
  const fraction=Math.min(1,Math.max(0,dist/track.length)), heights=track.heights
  if(!heights)return track.start.y+(track.end.y-track.start.y)*fraction
  let lo=0,hi=heights.length/2-1
  while(hi-lo>1){const mid=(lo+hi)>>>1;if(heights[mid*2]<=fraction)lo=mid;else hi=mid}
  const index=lo*2
  return heights[index+1]+(heights[index+3]-heights[index+1])*(fraction-heights[index])/(heights[index+2]-heights[index])
}
export const WALK_OFFSET=.32
type Actor = {pitch?:number,roll?:number,track:Track,dist:number,speed:number,pace?:number,kind:'car'|'scooter'|'person',down:number,dodge:number,x:number,y:number,z:number,yaw:number,scale:number,leaving:boolean,halfWidth:number,halfLength:number,height:number,holdUntil?:number,waitingFor?:Actor,waitingSince?:number}
type Position = {x:number,z:number,y:number}
export const MAX_ACTORS=100
export const MOBILE_ACTORS=80
// IDOK-160: motor actors never appear inside the view frustum closer than this,
// except right after a cold start or teleport when the street is still empty.
export const VISIBLE_SPAWN_MIN=130
const WARMUP_S=1.2,TELEPORT=60
const distanceSq=(left:Position,right:Position)=>(left.x-right.x)**2+(left.y-right.y)**2+(left.z-right.z)**2

export class Traffic {
  sampleGround?:(x:number,z:number,reference:number,car:boolean)=>number|undefined
  *allTracks(){for(const list of this.exits.values())yield* list}
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
  private parked=new WeakMap<Track,{revision:number,hits:{solid:Solid,dist:number}[]}>()
  private clearance=new WeakMap<Track,{revision:number,hits:{solid:Solid,dist:number}[]}>()
  parkingHits(track:Track,swept=true){
    const cache=swept?this.clearance:this.parked,cached=cache.get(track)
    if(cached?.revision===pickups.revision)return cached.hits
    const hits:{solid:Solid,dist:number}[]=[],seen=new Set<Solid>(),half=(track.width??3)/2
    const inspect=(solid:Solid)=>{
      if(seen.has(solid))return;seen.add(solid)
      const east=solid.x-track.start.x,south=solid.z-track.start.z
      const dist=east*track.dx+south*track.dz,side=south*track.dx-east*track.dz-track.offset
      const cosine=Math.cos(solid.yaw-track.yaw),sine=Math.sin(solid.yaw-track.yaw)
      const middle=dist-track.length/2
      const reach=track.length/2+(swept?2.12*CAR_SCALE:0)
      if(Math.abs(middle)>reach+solid.halfLength*Math.abs(cosine)+solid.halfWidth*Math.abs(sine)||
        Math.abs(side)>half+solid.halfLength*Math.abs(sine)+solid.halfWidth*Math.abs(cosine)||
        Math.abs(middle*cosine-side*sine)>solid.halfLength+reach*Math.abs(cosine)+half*Math.abs(sine)||
        Math.abs(middle*sine+side*cosine)>solid.halfWidth+reach*Math.abs(sine)+half*Math.abs(cosine)||
        Math.abs(solid.y-trackHeight(track,dist))>1.5)return
      hits.push({solid,dist})
    }
    const steps=Math.ceil(track.length/6)
    for(let step=0;step<=steps;step++){const along=track.length*step/steps;pickups.near(track.start.x+track.dx*along-track.dz*track.offset,track.start.z+track.dz*along+track.dx*track.offset,inspect)}
    hits.sort((a,b)=>a.dist-b.dist);cache.set(track,{revision:pickups.revision,hits});return hits
  }
  private adjacent(track:Track){return (this.exits.get(track.from)??[]).filter(next=>next!==track&&!next.walk&&next.to===track.to&&next.street===track.street&&Math.abs(next.offset-track.offset)<=(next.width??3)/2+(track.width??3)/2+.1&&!this.parkingHits(next).length)}
  private usable(track:Track){return track.walk||!this.parkingHits(track).length||!!this.adjacent(track).length}
  private cells=new Map<string,Track[]>()
  private obstacles=new Map<number,(Position|Actor)[]>()
  nearSolids=(x:number,z:number,visit:(actor:Actor)=>void)=>{
    const col=Math.floor(x/16),row=Math.floor(z/16)
    for(let east=col-1;east<=col+1;east++)for(let south=row-1;south<=row+1;south++){
      const bin=this.obstacles.get(east*65536+south)
      if(bin)for(const item of bin)if('kind' in item&&item.kind!=='person'&&Math.abs(item.x-x)<10&&Math.abs(item.z-z)<10)visit(item)
    }
  }
  private random:()=>number
  private checkWaitsAt=0
  private warmUntil=-1
  private lastCamera?:Position
  private streets=new Map<string,{walk:Track[],motor:Track[]}>()
  private cellKey=''
  private sites(camera:Position){
    const col=Math.floor(camera.x/128),row=Math.floor(camera.z/128),key=`${col},${row}`
    if(key===this.cellKey)return this.streets
    this.cellKey=key;this.streets.clear()
    const seen=new Set<Track>()
    for(let east=col-2;east<=col+2;east++)for(let south=row-2;south<=row+2;south++)for(const track of this.cells.get(`${east},${south}`)??[]){
      if(seen.has(track)||!track.street)continue
      seen.add(track)
      let group=this.streets.get(track.street)
      if(!group){group={walk:[],motor:[]};this.streets.set(track.street,group)}
      group[track.walk?'walk':'motor'].push(track)
    }
    return this.streets
  }
  private rules:{classes:string[],carMin:number,carMax:number,personMin:number,personMax:number}
  private actorLimit:number
  constructor(graph:Graph,random=Math.random,actorLimit=MAX_ACTORS,rules={classes:['trunk','primary','secondary'],carMin:1,carMax:2,personMin:3,personMax:6}){
    this.rules=rules
    this.actorLimit=actorLimit
    this.random=random
    const nodes=new Map(graph.nodes.map(node=>[node.id,node]))
    const add=(lane:Lane,walk:boolean)=>{
      const start=nodes.get(lane.from)!,end=nodes.get(lane.to)!
      const length=Math.hypot(end.x-start.x,end.z-start.z)
      if(length<.5)return
      const track=Object.assign({start,end,length,dx:(end.x-start.x)/length,dz:(end.z-start.z)/length,yaw:Math.atan2(end.x-start.x,end.z-start.z),walk},lane)
      const exits=this.exits.get(start.id)??[];exits.push(track);this.exits.set(start.id,exits)
      for(let col=Math.floor(Math.min(start.x,end.x)/128);col<=Math.floor(Math.max(start.x,end.x)/128);col++)for(let row=Math.floor(Math.min(start.z,end.z)/128);row<=Math.floor(Math.max(start.z,end.z)/128);row++){
        const key=`${col},${row}`,cell=this.cells.get(key)??[];cell.push(track);this.cells.set(key,cell)
      }
    }
    const arms=new Map<number,Set<number>>()
    for(const lane of graph.lanes){
      if(!rules.classes.includes((lane.cls??'').replace(/_link$/,''))||lane.kind!=='motor')continue
      add(lane,false)
      for(const [index,[x,z,east,south]] of (lane.npcWalks??[]).entries()){
        const from=-(lane.id*65536+index*2+1),to=from-1
        const head=nodes.get(lane.from)!,tail=nodes.get(lane.to)!
        const yAt=(px:number,pz:number)=>{const dx=tail.x-head.x,dz=tail.z-head.z;return head.y+(tail.y-head.y)*Math.max(0,Math.min(1,((px-head.x)*dx+(pz-head.z)*dz)/(dx*dx+dz*dz)))}
        nodes.set(from,{id:from,x,z,y:yAt(x,z)});nodes.set(to,{id:to,x:east,z:south,y:yAt(east,south)})
        for(const reverse of [false,true])add({from:reverse?to:from,to:reverse?from:to,id:reverse?to:from,offset:0,cls:lane.cls,street:lane.street,kind:'nonmotor',speedKmh:5},true)
      }
      for(const [node,other] of [[lane.from,lane.to],[lane.to,lane.from]]){
        const neighbors=arms.get(node)??new Set<number>();neighbors.add(other);arms.set(node,neighbors)
      }
    }
    for(const [node,neighbors] of arms)if(neighbors.size>=3)this.junctions.add(node)
    for(const signal of graph.signals){this.signal.set(signal.node,signal);this.junctions.delete(signal.node)}
  }
  isJunction(node:number){return this.junctions.has(node)||this.signal.has(node)}
  inherit(previous:Traffic){
    this.time=previous.time
    this.warmUntil=previous.warmUntil;this.lastCamera=previous.lastCamera
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
    if(track.floor){
      const pose=contactPose(track,dist,undefined,undefined,undefined,actor.dodge)
      actor.y=pose.y;actor.pitch=pose.pitch;actor.roll=pose.roll;actor.yaw=track.yaw
      return
    }
    actor.pitch=actor.roll=0
    const reference=trackHeight(track,dist)
    const car=actor.kind==='car'
    actor.y=this.sampleGround?.(actor.x,actor.z,reference,car)??reference
    if(actor.y!==reference&&this.sampleGround){
      // The baked reference may be below a ramp. Recheck deck eligibility at the placed height.
      for(let pass=0;pass<3;pass++){
        const support=this.sampleGround(actor.x,actor.z,actor.y,car)
        if(support===undefined||support===actor.y)break
        actor.y=support
      }
    }
    actor.yaw=track.yaw
  }
  phase(track:Lane,time=this.time):'green'|'red'|'yellow'{
    const signal=this.signal.get(track.to)
    if(!signal)return 'green'
    const {phases,offset}=signal
    let local=(time+offset)%phases.reduce((sum,p)=>sum+p.green+p.yellow,0)
    for(const phase of phases){
      if(local<phase.green+phase.yellow)return !phase.lanes.includes(track.id)?'red':local<phase.green?'green':'yellow'
      local-=phase.green+phase.yellow
    }
    return 'red'
  }
  green(track:Lane,time=this.time){
    return this.phase(track,time)==='green'
  }
  step(dt:number,camera:Position,vehicle?:Position,visible?:(point:Position)=>boolean,profile?:(spawn:number,grid:number,motion:number)=>void){
    const start=profile?performance.now():0
    this.time+=dt
    if(!this.lastCamera||Math.hypot(camera.x-this.lastCamera.x,camera.z-this.lastCamera.z)>TELEPORT)this.warmUntil=this.time+WARMUP_S
    this.lastCamera={x:camera.x,y:camera.y,z:camera.z}
    const warm=this.time<this.warmUntil
    // IDOK-236: also never materialise a car on top of the camera/player (the frustum test says "not visible" there).
    const hiddenSpawn=(point:Position)=>{
      if(warm||!visible)return true
      const radial=(point.x-camera.x)**2+(point.z-camera.z)**2
      return radial>VISIBLE_SPAWN_MIN**2||radial>15**2&&!visible(point)
    }
    this.actors=this.actors.filter(actor=>(!actor.leaving||actor.scale>0)&&(actor.x-camera.x)**2+(actor.z-camera.z)**2<=200**2)
    const counts=new Map<string,number>()
    for(const actor of this.actors){const key=actor.track.street+':'+actor.track.walk;counts.set(key,(counts.get(key)??0)+1)}
    let budget=warm?48:8
    for(const [street,group] of this.sites(camera))for(const walk of [false,true]){
      const key=street+':'+walk,existing=counts.get(key)??0
      const low=walk?this.rules.personMin:this.rules.carMin,high=walk?this.rules.personMax:this.rules.carMax
      const desired=this.actorLimit===MOBILE_ACTORS?low:Math.ceil((low+high)/2)
      if(existing>=desired||budget<=0)continue
      const candidates:{track:Track,min:number,max:number,end:number}[]=[]
      let availableLength=0
      for(const track of group[walk?'walk':'motor']){
        if(!this.usable(track))continue
        const dx=camera.x-track.start.x+track.dz*track.offset,dz=camera.z-track.start.z-track.dx*track.offset
        const center=dx*track.dx+dz*track.dz,span=Math.sqrt(200**2-(dx*track.dz-dz*track.dx)**2)
        const min=Math.max(0,center-span),max=Math.min(track.length,center+span)
        if(max>min){availableLength+=max-min;candidates.push({track,min,max,end:availableLength})}
      }
      const otherMotor=!walk&&this.actors.find(actor=>!actor.track.walk&&!actor.leaving&&actor.track.street===street)
      for(let count=existing,attempt=0;candidates.length&&count<desired&&attempt<24&&budget>0&&this.actors.length<this.actorLimit;attempt++){
        const metre=this.random()*availableLength
        const {track,min,max}=candidates.find(candidate=>candidate.end>metre)??candidates[candidates.length-1]
        const scooter=!walk&&this.actors.filter(other=>other.kind==='scooter').length<Math.round((1+this.actors.filter(other=>other.kind!=='person').length)*.36)
        const actor:Actor={track,dist:min+this.random()*(max-min),speed:0,kind:walk?'person':scooter?'scooter':'car',down:0,dodge:0,x:0,y:0,z:0,yaw:0,scale:0,leaving:false,halfWidth:walk||scooter?.3:.9*CAR_SCALE,halfLength:walk?.3:scooter?.85:2.1*CAR_SCALE,height:1.5}
        this.position(actor)
        if(!walk&&attempt<18){
          const approach=(camera.x-actor.x)*track.dx+(camera.z-actor.z)*track.dz
          if(approach<10||approach>150)continue
          if(attempt<10&&otherMotor&&track.dx*otherMotor.track.dx+track.dz*otherMotor.track.dz>.5)continue
        }
        if(!hiddenSpawn(actor)||this.actors.some(other=>distanceSq(other,actor)<(walk?.5:5)**2))continue
        if(!walk&&nearStatic(actor.x,actor.z)&&resolveContact(actor,actor.y,actor.yaw,actor.halfWidth,actor.halfLength,staticSolids))continue
        this.actors.push(actor);count++;budget--
      }
    }
    const spawned=profile?performance.now():0
    for(const [node,queue] of this.queues){
      const retained=queue.filter(actor=>this.actors.includes(actor)&&!actor.leaving&&(actor.track.to===node||actor.track.from===node&&actor.dist<6))
      if(retained.length)this.queues.set(node,retained);else this.queues.delete(node)
    }
    const obstacles=this.obstacles;obstacles.clear()
    for(const obstacle of vehicle?[...this.actors,vehicle]:this.actors){
      const key=Math.floor(obstacle.x/16)*65536+Math.floor(obstacle.z/16)
      const bin=obstacles.get(key)
      if(bin)bin.push(obstacle);else obstacles.set(key,[obstacle])
    }
    const gridded=profile?performance.now():0
    this.advanceActors(dt,visible)
    profile?.(spawned-start,gridded-spawned,performance.now()-gridded)
  }
  private advanceActors(dt:number,visible?:(point:Position)=>boolean){
    const decay=Math.exp(-dt*1.2)
    for(const actor of this.actors)this.advanceActor(actor,dt,decay,visible)
    if(this.time>=this.checkWaitsAt){
      this.checkWaitsAt=this.time+1
      const visited=new Set<Actor>()
      for(const start of this.actors){
        if(!start.waitingFor||visited.has(start))continue
        const chain=new Set<Actor>()
        let actor:Actor|undefined=start
        while(actor?.waitingFor&&!actor.leaving&&this.time-(actor.waitingSince??this.time)>=8){
          if(chain.has(actor)){actor.leaving=true;break}
          if(visited.has(actor))break
          visited.add(actor);chain.add(actor);actor=actor.waitingFor
        }
      }
      const starved=this.actors.find(actor=>actor.kind!=='person'&&!actor.leaving&&actor.waitingFor&&
        actor.waitingFor.waitingSince===undefined&&!actor.waitingFor.leaving&&this.green(actor.track)&&
        this.time-(actor.waitingSince??this.time)>=60)
      if(starved)starved.leaving=true
    }
    this.actors=this.actors.filter(actor=>Number.isFinite(actor.y))
  }
  private advanceActor(actor:Actor,dt:number,decay:number,visible?:(point:Position)=>boolean){
      const obstacles=this.obstacles
      let {track}=actor;const person=actor.kind==='person'
      const previousBlocker=actor.waitingFor
      actor.waitingFor=undefined
      if(actor.leaving){actor.scale=Math.max(0,actor.scale-dt/.4);return}
      if(!person&&this.parkingHits(track).some(hit=>hit.dist>=actor.dist-2&&hit.dist<actor.dist+28)){
        const options=this.adjacent(track),next=options.find(lane=>!this.actors.some(other=>other!==actor&&other.track===lane&&Math.abs(other.dist-actor.dist)<10))
        if(next){actor.dodge+=track.offset-next.offset;actor.track=track=next}
        else if(!options.length&&!visible?.(actor)){actor.leaving=true;return}
      }
      actor.scale=Math.min(1,actor.scale+dt/.4)
      if(actor.holdUntil&&actor.holdUntil>performance.now()){actor.speed=0;return}
      const maxSpeed=(person?(actor.pace??=1.1+.6*this.random()):Math.min(track.speedKmh/3.6,actor.kind==='car'?12:7))
      let advance=Math.min(maxSpeed,actor.speed+dt*2)*dt
      if(actor.down>0){actor.down-=dt;actor.waitingFor=previousBlocker;return}
      let keepRight=false,passLeft=false
      let minDodge=-WALK_OFFSET,maxDodge=WALK_OFFSET
      const previousX=actor.x,previousZ=actor.z
      if(!person)actor.dodge*=decay
      const left=Math.floor((actor.x-7)/16),right=Math.floor((actor.x+7)/16),top=Math.floor((actor.z-7)/16),bottom=Math.floor((actor.z+7)/16)
      nearby:for(let col=left;col<=right;col++)for(let row=top;row<=bottom;row++){
        const bin=obstacles.get(col*65536+row)
        if(!bin)continue
        for(let index=0;index<bin.length;index++){
        const other=bin[index]
        if(other===actor||Math.abs(other.y-actor.y)>2)continue
        const dx=other.x-actor.x,dz=other.z-actor.z
        if(Math.abs(dx)>7||Math.abs(dz)>7)continue
        const ahead=dx*track.dx+dz*track.dz,lateral=Math.abs(dx*track.dz-dz*track.dx)
        if(person){
          if('kind' in other && other.kind==='person'){
            const alignment=track.dx*other.track.dx+track.dz*other.track.dz
            if(lateral>1||Math.abs(alignment)<.8||ahead>4||ahead< -4)continue
            if(alignment<0){if(ahead> -1)keepRight=true}
            else {
              const faster=maxSpeed>(other.pace??1.4)
              if(faster&&ahead> -1.2)passLeft=true
              if(!faster&&ahead<1.2)keepRight=true
            }
            if(ahead>0&&lateral<.48){
              const gap=Math.max(0,ahead-.52)
              advance=Math.min(advance,alignment<0?gap*.45:gap)
            }
            if(Math.abs(ahead)<.5&&lateral>.12){
              const side=dz*track.dx-dx*track.dz
              if(side>0)maxDodge=Math.min(maxDodge,actor.dodge+side-.48)
              else minDodge=Math.max(minDodge,actor.dodge+side+.48)
            }
            continue
          }
          const distanceSq=dx*dx+dz*dz
          if(distanceSq<1.44){actor.down=2;advance=0;if('kind' in other)actor.waitingFor=other;break nearby}
          if(distanceSq<16){
            advance=0;if('kind' in other)actor.waitingFor=other;break nearby
          }
        }else if(ahead>0&&lateral<1.8){advance=Math.min(advance,Math.max(0,ahead-5));if(advance<1e-6&&'kind' in other)actor.waitingFor=other;if(!advance)break nearby}
        }
      }
      if(person){
        const target=keepRight?WALK_OFFSET:passLeft?-WALK_OFFSET:0
        const goal=Math.max(-WALK_OFFSET,Math.min(WALK_OFFSET,Math.max(minDodge,Math.min(maxDodge,target))))
        actor.dodge+=(goal-actor.dodge)*(1-Math.exp(-dt*(goal?3.5:1.2)))
      }
      if(!person&&this.junctions.has(track.to)&&track.length-actor.dist<9){
        const queue=this.queues.get(track.to)??[]
        if(!queue.includes(actor)){
          const follower=queue.findIndex(waiting=>waiting.track===track&&waiting.dist<actor.dist)
          if(follower<0)queue.push(actor);else queue.splice(follower,0,actor)
        }
        this.queues.set(track.to,queue)
        const occupied=this.actors.find(other=>other!==actor&&other.kind!=='person'&&other.track.from===track.to&&other.dist<6)
        if(occupied||queue[0]!==actor){
          const gap=Math.max(0,track.length-actor.dist-3)
          if(gap<1e-6)actor.waitingFor=occupied??queue[0]
          advance=Math.min(advance,gap)
        }
      }
      if(!person&&!this.green(track)){
        const gap=Math.max(0,track.length-actor.dist-1)
        if(advance>gap)this.stopped++
        advance=Math.min(advance,gap)
      }
      if(advance>=dt*.05)actor.waitingSince=undefined
      else actor.waitingSince??=this.time
      actor.speed=advance/dt;actor.dist+=advance
      if(!person&&advance>0&&nearStatic(actor.x+track.dx*advance,actor.z+track.dz*advance)){
        const offset=track.offset+actor.dodge
        const next={x:track.start.x+track.dx*actor.dist-track.dz*offset,y:actor.y,z:track.start.z+track.dz*actor.dist+track.dx*offset}
        if(resolveContact(next,next.y,track.yaw,actor.halfWidth,actor.halfLength,staticSolids)){actor.speed=0;actor.dist-=advance;return}
      }
      if(actor.dist>=track.length){
        if(!person&&this.signal.has(track.to)){this.crossed++;this.onCross?.(track,this.time)}
        const choices=(this.exits.get(track.to)??[]).filter(next=>this.usable(next)&&(next.walk||!this.parkingHits(next).some(hit=>hit.dist<12))&&next.walk===person && next.street===track.street && (person||next.to!==track.from) && (person||next.kind==='motor'||(actor.kind==='scooter'&&next.kind==='nonmotor')))
        if(!choices.length){actor.dist=track.length;actor.speed=0;actor.leaving=true;return}
        const onward=choices.filter(next=>next.to!==track.from)
        const pool=onward.length?onward:choices
        const straight=pool.filter(next=>next.dx*track.dx+next.dz*track.dz>.88)
        actor.track=straight.length&&this.random()<.85?straight.reduce((best,next)=>Math.abs(next.offset-track.offset)<Math.abs(best.offset-track.offset)?next:best):pool[Math.floor(this.random()*pool.length)]
        if(person&&actor.track.to===track.from)actor.dodge= -actor.dodge
        actor.dist=0;this.transitions++
      }
      this.position(actor)
      if(person&&actor.track===track&&Math.hypot(actor.x-previousX,actor.z-previousZ)>1e-5)actor.yaw=Math.atan2(actor.x-previousX,actor.z-previousZ)
  }
}
