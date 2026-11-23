import {nearStatic,resolveContact,staticSolids} from './contact.ts'
type Node = {id:number,x:number,y:number,z:number}
type Lane = {id:number,from:number,to:number,offset:number,kind:'motor'|'bus'|'nonmotor',speedKmh:number,cls?:string,heights?:number[]}
const tier=(cls?:string)=>cls==='primary'||cls==='trunk'?0:cls==='secondary'?1:cls==='tertiary'?2:3
const density=[1,.6,.35,.12]
const sector=(point:Position,center:Position)=>(Math.floor(Math.atan2(point.x-center.x,point.z-center.z)*4/Math.PI+.5)+8)%8
function coverage(x:number,z:number,y:number,center:Position){
  const dx=x-center.x,dz=z-center.z,radius=Math.hypot(dx,dz)
  if(radius<Math.max(8,(center.y-y)*1.45)||radius>60)return 0
  const angle=Math.atan2(dx,dz)*4/Math.PI+8,nearest=Math.round(angle)
  let mask=1<<(nearest%8)
  if(Math.abs(nearest-angle)>.18)mask|=1<<((nearest+Math.sign(angle-nearest)+8)%8)
  return mask
}
type Phase = {lanes:number[],green:number,yellow:number}
type Signal={node:number,group:number,offset:number,phases:Phase[]}
export type Graph = {nodes:Node[],lanes:Lane[],walks:[number,number,number,number?,number[]?][],signals:Signal[]}
export type Track = Lane & {start:Node,end:Node,dx:number,dz:number,yaw:number,length:number,walk:boolean}
function trackHeight(track:Track,dist:number){
  const fraction=Math.min(1,Math.max(0,dist/track.length)), heights=track.heights
  if(!heights)return track.start.y+(track.end.y-track.start.y)*fraction
  let lo=0,hi=heights.length/2-1
  while(hi-lo>1){const mid=(lo+hi)>>>1;if(heights[mid*2]<=fraction)lo=mid;else hi=mid}
  const index=lo*2
  return heights[index+1]+(heights[index+3]-heights[index+1])*(fraction-heights[index])/(heights[index+2]-heights[index])
}
type Actor = {track:Track,dist:number,speed:number,kind:'car'|'scooter'|'person',down:number,dodge:number,x:number,y:number,z:number,yaw:number,scale:number,leaving:boolean,halfWidth:number,halfLength:number,height:number,holdUntil?:number,waitingFor?:Actor,waitingSince?:number}
type Position = {x:number,z:number,y:number}
export const MAX_ACTORS=100
export const MOBILE_ACTORS=80
// IDOK-160: motor actors never appear inside the view frustum closer than this,
// except right after a cold start or teleport when the street is still empty.
export const VISIBLE_SPAWN_MIN=130
const WARMUP_S=1.2,TELEPORT=60
const distanceSq=(left:Position,right:Position)=>(left.x-right.x)**2+(left.y-right.y)**2+(left.z-right.z)**2

export class Traffic {
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
  private anchorX=Infinity
  private anchorZ=Infinity
  private limits=[0,0,0,0]
  private rebalanceAt=0
  private checkWaitsAt=0
  private warmUntil=-1
  private lastCamera?:Position
  private samples:{track:Track,dist:number}[][]=[]
  private primarySites:{track:Track,dist:number,x:number,y:number,z:number}[]=[]
  private updateLimits(camera:Position,street:boolean){
    if(Math.hypot(this.anchorX-camera.x,this.anchorZ-camera.z)<16)return
    this.anchorX=camera.x;this.anchorZ=camera.z
    this.samples=Array.from({length:8},()=>[])
    this.primarySites=[]
    const quota=[0,0,0,0],col=Math.floor(camera.x/128),row=Math.floor(camera.z/128)
    for(let east=col-2;east<=col+2;east++)for(let south=row-2;south<=row+2;south++){
      for(const track of this.cells.get(`${east},${south}`)??[]){
        if(track.walk||track.kind!=='motor')continue
        const dx=camera.x-track.start.x,dz=camera.z-track.start.z
        const center=dx*track.dx+dz*track.dz,lateral=dx*track.dz-dz*track.dx
        const group=tier(track.cls),radius=street&&group===0?150:185
        if(Math.abs(lateral)>=radius)continue
        const span=Math.sqrt(radius**2-lateral**2)
        quota[group]+=Math.max(0,Math.min(track.length,center+span)-Math.max(0,center-span))*.095*density[group]
        if(street&&group===0)for(let dist=Math.max(2,center-span);dist<Math.min(track.length,center+span);dist+=7){
          this.primarySites.push({track,dist,x:track.start.x+track.dx*dist-track.dz*track.offset,y:trackHeight(track,dist),z:track.start.z+track.dz*dist+track.dx*track.offset})
        }
        if(street&&Math.abs(lateral+track.offset)<60){
          for(let dist=Math.max(2,center-60);dist<Math.min(track.length,center+60);dist+=6){
            const x=track.start.x+track.dx*dist-track.dz*track.offset,z=track.start.z+track.dz*dist+track.dx*track.offset
            const mask=coverage(x,z,trackHeight(track,dist),camera)
            for(let i=0;i<8;i++)if(mask&(1<<i))this.samples[i].push({track,dist})
          }
        }
      }
    }
    const budget=street?this.actorLimit-(quota[0]>=60?12:20):60
    const primary=street?Math.min(quota[0],budget):0
    if(street)quota[0]=0
    const factor=Math.min(1,(budget-primary)/Math.max(1,quota.reduce((a,b)=>a+b,0)))
    let sum=0
    this.limits=quota.map(value=>{const before=Math.round(sum);sum+=value*factor;return Math.round(sum)-before})
    this.limits[0]+=Math.round(primary)
  }
  private actorLimit:number
  constructor(graph:Graph,random=Math.random,actorLimit=MAX_ACTORS){
    this.actorLimit=actorLimit
    this.random=random
    const nodes=new Map(graph.nodes.map(node=>[node.id,node]))
    const add=(lane:Lane,walk:boolean)=>{
      const start=nodes.get(lane.from)!,end=nodes.get(lane.to)!
      const length=Math.hypot(end.x-start.x,end.z-start.z)
      if(length<.5)return
      const track={...lane,start,end,length,dx:(end.x-start.x)/length,dz:(end.z-start.z)/length,yaw:Math.atan2(end.x-start.x,end.z-start.z),walk}
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
    graph.walks.forEach(([from,to,offset,stable,heights],index)=>{for(const reverse of [false,true]){
      const profile=reverse&&heights?[]:heights
      if(reverse&&heights&&profile)for(let i=heights.length-2;i>=0;i-=2)profile.push(1-heights[i],heights[i+1])
      add({from:reverse?to:from,to:reverse?from:to,offset:reverse?-offset:offset,heights:profile,id:-1-2*(stable??index)-Number(reverse),kind:'nonmotor',speedKmh:5},true)
    }})
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
    actor.y=trackHeight(track,dist)
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
    const hiddenSpawn=(point:Position)=>warm||!visible||!visible(point)||(point.x-camera.x)**2+(point.z-camera.z)**2>VISIBLE_SPAWN_MIN**2
    this.actors=this.actors.filter(actor=>(!actor.leaving||actor.scale>0)&&distanceSq(actor,camera)<210**2)
    let persons=0,scooters=0
    this.updateLimits(camera,!!visible)
    const counts=[0,0,0,0]
    let outside=0
    const cap=visible?this.actorLimit:80,canSpawn=this.actors.length<cap
    const rebalance=visible&&this.time>=this.rebalanceAt
    const nearbySectors=(canSpawn||rebalance)&&visible?new Uint8Array(8):null
    const sectorPopulation=nearbySectors?new Uint8Array(8):null
    const countNearby=(actor:Actor)=>{const mask=coverage(actor.x,actor.z,actor.y,camera);for(let i=0;i<8;i++)if(mask&(1<<i))nearbySectors![i]++}
    for(const actor of this.actors){
      if(actor.kind==='person'){persons++;continue}
      counts[tier(actor.track.cls)]++;scooters+=Number(actor.kind==='scooter')
      if(canSpawn&&visible&&!visible(actor))outside++
      if(nearbySectors&&sectorPopulation){sectorPopulation[sector(actor,camera)]++;countNearby(actor)}
    }
    let motors=this.actors.length-persons
    const walkers=visible&&this.limits[0]>=60?12:20
    if(visible&&rebalance&&sectorPopulation&&nearbySectors){
      this.rebalanceAt=this.time+.25
      let distant:Actor|undefined,donor:Actor|undefined,inView=0
      const crowded=sectorPopulation.indexOf(Math.max(...sectorPopulation))
      const deficit=nearbySectors.some((count,index)=>this.samples[index].length>0&&count<(walkers===12?4:2))
      for(const actor of this.actors){
        if(actor.kind==='person'||actor.leaving)continue
        if(deficit&&!visible(actor)&&sector(actor,camera)===crowded&&sectorPopulation[crowded]>8&&(!donor||distanceSq(actor,camera)>distanceSq(donor,camera)))donor=actor
        if(visible(actor)){inView++;continue}
        if((distanceSq(actor,camera)>60**2||sectorPopulation[sector(actor,camera)]>8)&&(!distant||distanceSq(actor,camera)>distanceSq(distant,camera)))distant=actor
      }
      if(walkers===12&&inView<52&&distant)distant.leaving=true
      else if(!canSpawn&&deficit&&donor)donor.leaving=true
    }
    for(let attempt=0;attempt<48 && this.actors.length<cap;attempt++){
      const walk=persons<walkers && (motors>=cap-walkers||attempt%3===0)
      if(!walk&&motors>=cap-walkers)continue
      let bucket=attempt%8
      if(nearbySectors&&!walk&&attempt%2===0){
        for(let offset=1;offset<=8;offset++){
          const candidate=(attempt+offset)%8
          if(this.samples[candidate].length&&(!this.samples[bucket].length||nearbySectors[candidate]<nearbySectors[bucket]))bucket=candidate
        }
      }
      const samples=!walk&&nearbySectors&&nearbySectors[bucket]<6?this.samples[bucket]:null
      let target=samples?.length?samples[Math.floor(this.random()*samples.length)]:null
      if(!walk&&visible&&this.primarySites.length&&counts[0]<this.limits[0]&&motors-outside<52&&(!target||attempt%3!==0)){
        for(let retry=0;retry<4;retry++){
          const site=this.primarySites[Math.floor(this.random()*this.primarySites.length)]
          if(visible(site)&&hiddenSpawn(site)){target=site;break}
        }
      }
      const cell=this.cells.get(`${Math.floor(camera.x/128)+Math.floor(this.random()*3)-1},${Math.floor(camera.z/128)+Math.floor(this.random()*3)-1}`)
      if(!cell?.length&&!target)continue
      const track=target?.track??cell![Math.floor(this.random()*cell!.length)]
      const scooter=scooters<Math.round((motors+1)*.36)
      const group=tier(track.cls)
      if(!walk&&!target&&counts[group]>=this.limits[group])continue
      if(track.walk!==walk || (!walk&&(track.kind==='bus'||(!scooter&&track.kind==='nonmotor'))))continue
      const actor:Actor={track,dist:this.random()*track.length,speed:0,kind:walk?'person':scooter?'scooter':'car',down:0,dodge:0,x:0,y:0,z:0,yaw:0,scale:0,leaving:false,halfWidth:scooter?.3:.9,halfLength:scooter?.85:2.1,height:1.5}
      if(target)actor.dist=target.dist
      this.position(actor)
      const offscreen=!walk&&visible&&!visible(actor)
      if(!walk&&!hiddenSpawn(actor))continue
      const radial=distanceSq(actor,camera),octant=nearbySectors&&!walk?sector(actor,camera):-1
      if(!target&&octant>=0&&offscreen&&sectorPopulation![octant]>=5&&sectorPopulation!.some(count=>count<4)&&this.random()>.04)continue
      if(octant>=0&&motors>12&&nearbySectors![octant]<3&&radial>=65**2&&this.random()>.25)continue
      if(!target&&offscreen&&outside>=22&&this.limits[0]>=30&&this.random()>.04)continue
      if(!walk&&nearStatic(actor.x,actor.z)&&resolveContact(actor,actor.y,actor.yaw,actor.halfWidth,actor.halfLength,staticSolids))continue
      if(radial>185**2 || this.actors.some(other=>(other.x-actor.x)**2+(other.z-actor.z)**2<(other.track.id===track.id?36:5)))continue
      this.actors.push(actor)
      if(octant>=0){sectorPopulation![octant]++;countNearby(actor)}
      if(walk)persons++;else {counts[group]++;motors++;scooters+=Number(scooter);outside+=Number(!!offscreen)}
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
    this.advanceActors(dt)
    profile?.(spawned-start,gridded-spawned,performance.now()-gridded)
  }
  private advanceActors(dt:number){
    const decay=Math.exp(-dt*1.2)
    for(const actor of this.actors)this.advanceActor(actor,dt,decay)
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
  private advanceActor(actor:Actor,dt:number,decay:number){
      const obstacles=this.obstacles
      const {track}=actor,person=actor.kind==='person'
      const previousBlocker=actor.waitingFor
      actor.waitingFor=undefined
      if(actor.leaving){actor.scale=Math.max(0,actor.scale-dt/.4);return}
      actor.scale=Math.min(1,actor.scale+dt/.4)
      if(actor.holdUntil&&actor.holdUntil>performance.now()){actor.speed=0;return}
      const maxSpeed=(person?1.4:Math.min(track.speedKmh/3.6,actor.kind==='car'?12:7))
      let advance=Math.min(maxSpeed,actor.speed+dt*2)*dt
      if(actor.down>0){actor.down-=dt;actor.waitingFor=previousBlocker;return}
      actor.dodge*=decay
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
          if('kind' in other && other.kind==='person')continue
          const distanceSq=dx*dx+dz*dz
          if(distanceSq<1.44){actor.down=2;advance=0;if('kind' in other)actor.waitingFor=other;break nearby}
          if(distanceSq<16){
            const away=dx*track.dz-dz*track.dx>=0?1:-1
            actor.dodge=Math.max(-.9,Math.min(.9,actor.dodge+away*dt*3));advance=0;if('kind' in other)actor.waitingFor=other;break nearby
          }
        }else if(ahead>0&&lateral<1.8){advance=Math.min(advance,Math.max(0,ahead-5));if(advance<1e-6&&'kind' in other)actor.waitingFor=other;if(!advance)break nearby}
        }
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
        const next={x:actor.x+track.dx*advance,y:actor.y,z:actor.z+track.dz*advance}
        if(resolveContact(next,next.y,track.yaw,actor.halfWidth,actor.halfLength,staticSolids)){actor.speed=0;actor.dist-=advance;return}
      }
      if(actor.dist>=track.length){
        if(!person&&this.signal.has(track.to)){this.crossed++;this.onCross?.(track,this.time)}
        const choices=(this.exits.get(track.to)??[]).filter(next=>next.walk===person && (person||next.to!==track.from) && (person||next.kind==='motor'||(actor.kind==='scooter'&&next.kind==='nonmotor')))
        if(!choices.length){actor.dist=track.length;actor.speed=0;actor.leaving=true;return}
        const onward=choices.filter(next=>next.to!==track.from)
        const pool=onward.length?onward:choices
        const straight=pool.filter(next=>next.dx*track.dx+next.dz*track.dz>.88)
        actor.track=straight.length&&this.random()<.85?straight.reduce((best,next)=>Math.abs(next.offset-track.offset)<Math.abs(best.offset-track.offset)?next:best):pool[Math.floor(this.random()*pool.length)]
        actor.dist=0;this.transitions++
      }
      this.position(actor)
  }
}
