import {axleHeight,contactPose} from './lane-surface.ts'
import {nearStatic,resolveContact,staticSolids,pickups,type Solid} from './contact.ts'
import {CAR_SCALE} from '../drive/scale.ts'
type Node = {id:number,x:number,y:number,z:number}
type Lane = {id:number,from:number,to:number,offset:number,width?:number,kind:'motor'|'bus'|'nonmotor',speedKmh:number,cls?:string,street?:string,npcWalks?:number[][],heights?:number[],floor?:string}
type Phase = {lanes:number[],green:number,yellow:number}
type Signal={node:number,group:number,offset:number,phases:Phase[]}
export type Graph = {nodes:Node[],lanes:Lane[],walks:[number,number,number,number?,number[]?][],signals:Signal[]}
export type SurfaceLookup = (x:number,z:number)=>readonly number[]|undefined
export type Track = Lane & {
  start:Node,end:Node,dx:number,dz:number,yaw:number,length:number,walk:boolean,
  outwardSign?:1|-1,dodgeMin?:number,dodgeMax?:number,tightEdge?:boolean,
  surfaceState?:'pending'|'ok'|'rejected',suspectVerge?:boolean,pairTrack?:Track,
}
type MotorSeg = {id:number,cls?:string,street?:string,ax:number,az:number,bx:number,bz:number,dx:number,dz:number,len:number,halfW:number}
const MOTOR_CLEARANCE=.45
const MEDIAN_HALF_SPAN=10
const WALK_MIN_LEN=2
const WALK_EDGE_KEEP=.45
const isSafeWalkSurface=(kinds:readonly number[])=>(kinds.includes(1)||kinds.includes(6))&&!kinds.includes(0)&&!kinds.includes(5)
const isVergeSurface=(kinds:readonly number[])=>kinds.includes(4)&&!kinds.includes(1)&&!kinds.includes(6)
function trackHeight(track:Track,dist:number){
  if(track.floor)return axleHeight(track,dist)
  const fraction=Math.min(1,Math.max(0,dist/track.length)), heights=track.heights
  if(!heights)return track.start.y+(track.end.y-track.start.y)*fraction
  let lo=0,hi=heights.length/2-1
  while(hi-lo>1){const mid=(lo+hi)>>>1;if(heights[mid*2]<=fraction)lo=mid;else hi=mid}
  const index=lo*2
  return heights[index+1]+(heights[index+3]-heights[index+1])*(fraction-heights[index])/(heights[index+2]-heights[index])
}
export const WALK_OFFSET=.32
type Actor = {pitch?:number,roll?:number,track:Track,dist:number,speed:number,pace?:number,arrived?:boolean,kind:'car'|'scooter'|'person',down:number,dodge:number,x:number,y:number,z:number,yaw:number,scale:number,leaving:boolean,halfWidth:number,halfLength:number,height:number,holdUntil?:number,waitingFor?:Actor,waitingSince?:number}
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
  surfaceAt?:SurfaceLookup
  private motorGrid=new Map<number,MotorSeg[]>()
  private nearMotors(x:number,z:number){return this.motorGrid.get(Math.floor(x/64)*65536+Math.floor(z/64))??[]}
  hitsMotorLane(x:number,z:number,margin=MOTOR_CLEARANCE){
    for(const m of this.nearMotors(x,z)){
      const ex=x-m.ax,ez=z-m.az,along=ex*m.dx+ez*m.dz
      if(along<-margin||along>m.len+margin)continue
      if(Math.abs(ez*m.dx-ex*m.dz)<m.halfW+margin)return true
    }
    return false
  }
  /** Side clearances along normal (-dz, dx) (+pos) and (dz, -dx) (-neg) to nearby parallel motor lanes. */
  sideClearances(x:number,z:number,dx:number,dz:number){
    let posD=Infinity,negD=Infinity
    for(const m of this.nearMotors(x,z)){
      if(Math.abs(m.dx*dx+m.dz*dz)<.72)continue
      const ex=x-m.ax,ez=z-m.az,along=ex*m.dx+ez*m.dz
      if(along<-2||along>m.len+2)continue
      const signed=ex*dz-ez*dx // >0 means motor lane lies on +normal (-dz, dx) side
      const edgeDist=Math.abs(signed)-m.halfW
      if(signed>0&&edgeDist<posD)posD=edgeDist
      if(signed<0&&edgeDist<negD)negD=edgeDist
    }
    return {posD,negD,betweenMotors:posD<MEDIAN_HALF_SPAN&&negD<MEDIAN_HALF_SPAN}
  }
  private extractSafeSegments(x1:number,z1:number,x2:number,z2:number,ok:(x:number,z:number)=>boolean):[number,number,number,number][]{
    const len=Math.hypot(x2-x1,z2-z1)
    if(len<WALK_MIN_LEN)return []
    const steps=Math.max(4,Math.ceil(len/.5))
    const segs:[number,number,number,number][]=[]
    let start=-1
    for(let i=0;i<=steps;i++){
      const t=i/steps,px=x1+(x2-x1)*t,pz=z1+(z2-z1)*t
      const pass=ok(px,pz)
      if(pass&&start<0)start=i
      if((!pass||i===steps)&&start>=0){
        const end=pass?i:i-1
        const t0=start/steps,t1=end/steps
        if((t1-t0)*len>=WALK_MIN_LEN){
          segs.push([x1+(x2-x1)*t0,z1+(z2-z1)*t0,x1+(x2-x1)*t1,z1+(z2-z1)*t1])
        }
        start=-1
      }
    }
    return segs
  }
  private computeWalkSafety(track:Track){
    const mx=(track.start.x+track.end.x)/2,mz=(track.start.z+track.end.z)/2
    const {posD,negD}=this.sideClearances(mx,mz,track.dx,track.dz)
    track.outwardSign=posD<negD?-1:1
    let minPos=posD,minNeg=negD
    for(const t of [.15,.5,.85]){
      const px=track.start.x+track.dx*track.length*t,pz=track.start.z+track.dz*track.length*t
      const s=this.sideClearances(px,pz,track.dx,track.dz)
      if(s.posD<minPos)minPos=s.posD
      if(s.negD<minNeg)minNeg=s.negD
    }
    let maxD=Number.isFinite(minPos)?Math.min(WALK_OFFSET,Math.max(0,minPos-WALK_EDGE_KEEP)):WALK_OFFSET
    let minD=Number.isFinite(minNeg)?-Math.min(WALK_OFFSET,Math.max(0,minNeg-WALK_EDGE_KEEP)):-WALK_OFFSET
    if(this.surfaceAt){
      const nx=-track.dz,nz=track.dx
      const sampleOk=(shift:number)=>{
        for(const t of [.2,.5,.8]){
          const ks=this.surfaceAt!(track.start.x+track.dx*track.length*t+nx*shift,track.start.z+track.dz*track.length*t+nz*shift)
          if(ks&&!isSafeWalkSurface(ks))return false
        }
        return true
      }
      if(maxD>0&&!sampleOk(maxD))maxD=sampleOk(maxD*.5)?maxD*.5:0
      if(minD<0&&!sampleOk(minD))minD=sampleOk(minD*.5)?minD*.5:0
    }
    track.dodgeMin=minD;track.dodgeMax=maxD
    const cls=(track.cls??'').replace(/_link$/,'')
    const nearestEdge=Math.min(posD,negD)
    track.tightEdge=nearestEdge<1.2
    track.suspectVerge=(cls==='trunk'||cls==='primary')&&nearestEdge<2.6
  }
  private registerTrackCells(track:Track){
    for(let col=Math.floor(Math.min(track.start.x,track.end.x)/128);col<=Math.floor(Math.max(track.start.x,track.end.x)/128);col++)for(let row=Math.floor(Math.min(track.start.z,track.end.z)/128);row<=Math.floor(Math.max(track.start.z,track.end.z)/128);row++){
      const key=`${col},${row}`,cell=this.cells.get(key)??[]
      if(!cell.includes(track)){cell.push(track);this.cells.set(key,cell)}
    }
  }
  private updateTrackGeometry(track:Track,x1:number,z1:number,x2:number,z2:number){
    const len=Math.hypot(x2-x1,z2-z1)
    if(len<WALK_MIN_LEN)return false
    const updatePair=(t:Track,sx:number,sz:number,ex:number,ez:number)=>{
      t.start.x=sx;t.start.z=sz;t.end.x=ex;t.end.z=ez
      t.length=len;t.dx=(ex-sx)/len;t.dz=(ez-sz)/len;t.yaw=Math.atan2(ex-sx,ez-sz)
      this.computeWalkSafety(t)
      this.registerTrackCells(t)
    }
    updatePair(track,x1,z1,x2,z2)
    if(track.pairTrack)updatePair(track.pairTrack,x2,z2,x1,z1)
    return true
  }
  private resolveWalkSurface(track:Track):boolean{
    if(!track.walk)return true
    if(track.surfaceState==='ok')return true
    if(track.surfaceState==='rejected')return false
    const lookup=this.surfaceAt
    if(!lookup)return true
    const s0=lookup(track.start.x,track.start.z)
    const sm=lookup((track.start.x+track.end.x)/2,(track.start.z+track.end.z)/2)
    const s1=lookup(track.end.x,track.end.z)
    // Wait until surrounding GL04 street tiles have loaded before spawning pedestrians on this track,
    // preventing race conditions where a verge/road track spawns walkers before surface refinement runs.
    if(!s0||!sm||!s1)return false
    const mark=(state:'ok'|'rejected')=>{
      track.surfaceState=state
      if(track.pairTrack)track.pairTrack.surfaceState=state
      if(state==='rejected'){
        for(const actor of this.actors)if(actor.track===track||actor.track===track.pairTrack)actor.leaving=true
      }
      return state==='ok'
    }
    const checkAllSafe=(x1:number,z1:number,x2:number,z2:number)=>{
      const len=Math.hypot(x2-x1,z2-z1),steps=Math.max(4,Math.ceil(len/1))
      for(let i=0;i<=steps;i++){
        const t=i/steps,ks=lookup(x1+(x2-x1)*t,z1+(z2-z1)*t)
        if(!ks||!isSafeWalkSurface(ks))return false
      }
      return true
    }
    if(checkAllSafe(track.start.x,track.start.z,track.end.x,track.end.z)){
      this.computeWalkSafety(track)
      if(track.pairTrack)this.computeWalkSafety(track.pairTrack)
      return mark('ok')
    }
    const wdx=track.dx,wdz=track.dz,nx=-wdz,nz=wdx
    const outSign=track.outwardSign??1
    const safePt=(px:number,pz:number)=>{
      const ks=lookup(px,pz)
      return !!ks&&isSafeWalkSurface(ks)&&!this.hitsMotorLane(px,pz,MOTOR_CLEARANCE)&&!this.sideClearances(px,pz,wdx,wdz).betweenMotors
    }
    const safeWithWidth=(px:number,pz:number)=>safePt(px,pz)&&safePt(px+nx*.32,pz+nz*.32)&&safePt(px-nx*.32,pz-nz*.32)
    // Verge track (arterial kind=4 median/planting strip): push outward across cycleway onto real kind=1/6 outer sidewalk.
    let bestSeg:[number,number,number,number]|undefined,bestLen=0
    if(isVergeSurface(sm)||isVergeSurface(s0)||isVergeSurface(s1)){
      const mx=(track.start.x+track.end.x)/2,mz=(track.start.z+track.end.z)/2
      for(let shift=2;shift<=11.5;shift+=.5){
        const sx=outSign*nx*shift,sz=outSign*nz*shift
        // Fast probe midpoint & quarter points before full-length extraction.
        if(!safeWithWidth(mx+sx,mz+sz)&&!safeWithWidth(track.start.x+track.dx*track.length*.25+sx,track.start.z+track.dz*track.length*.25+sz)&&!safeWithWidth(track.start.x+track.dx*track.length*.75+sx,track.start.z+track.dz*track.length*.75+sz))continue
        const segs=this.extractSafeSegments(track.start.x+sx,track.start.z+sz,track.end.x+sx,track.end.z+sz,safeWithWidth)
        for(const seg of segs){
          const l=Math.hypot(seg[2]-seg[0],seg[3]-seg[1])
          if(l>bestLen){bestLen=l;bestSeg=seg}
        }
      }
    }
    if(!bestSeg){
      const segs=this.extractSafeSegments(track.start.x,track.start.z,track.end.x,track.end.z,safePt)
      for(const seg of segs){
        const l=Math.hypot(seg[2]-seg[0],seg[3]-seg[1])
        if(l>bestLen){bestLen=l;bestSeg=seg}
      }
    }
    if(!bestSeg||!this.updateTrackGeometry(track,bestSeg[0],bestSeg[1],bestSeg[2],bestSeg[3]))return mark('rejected')
    for(const actor of this.actors){
      if(actor.track===track||actor.track===track.pairTrack){
        actor.dist=Math.min(actor.dist,Math.max(0,actor.track.length-.1))
        this.position(actor)
      }
    }
    this.cellKey=''
    return mark('ok')
  }
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
  private usable(track:Track){return track.walk?this.resolveWalkSurface(track):!this.parkingHits(track).length||!!this.adjacent(track).length}
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
  constructor(graph:Graph,random=Math.random,actorLimit=MAX_ACTORS,rules={classes:['trunk','primary','secondary'],carMin:1,carMax:2,personMin:3,personMax:6},surfaceAt?:SurfaceLookup){
    this.rules=rules
    this.actorLimit=actorLimit
    this.random=random
    this.surfaceAt=surfaceAt
    const nodes=new Map(graph.nodes.map(node=>[node.id,node]))
    // Index every motor/bus lane in the graph (all road classes) to enforce strict pedestrian carriageway exclusion.
    for(const lane of graph.lanes){
      if(lane.kind!=='motor'&&lane.kind!=='bus')continue
      const a=nodes.get(lane.from),b=nodes.get(lane.to)
      if(!a||!b)continue
      const len=Math.hypot(b.x-a.x,b.z-a.z)
      if(len<.5)continue
      const dx=(b.x-a.x)/len,dz=(b.z-a.z)/len,off=lane.offset||0,w=lane.width??3
      const seg:MotorSeg={id:lane.id,cls:lane.cls,street:lane.street,ax:a.x-dz*off,az:a.z+dx*off,bx:b.x-dz*off,bz:b.z+dx*off,dx,dz,len,halfW:w/2}
      const x0=Math.floor((Math.min(seg.ax,seg.bx)-16)/64),x1=Math.floor((Math.max(seg.ax,seg.bx)+16)/64)
      const z0=Math.floor((Math.min(seg.az,seg.bz)-16)/64),z1=Math.floor((Math.max(seg.az,seg.bz)+16)/64)
      for(let gx=x0;gx<=x1;gx++)for(let gz=z0;gz<=z1;gz++){
        const k=gx*65536+gz,arr=this.motorGrid.get(k)??[];arr.push(seg);this.motorGrid.set(k,arr)
      }
    }
    const add=(lane:Lane,walk:boolean):Track|undefined=>{
      const start=nodes.get(lane.from)!,end=nodes.get(lane.to)!
      const length=Math.hypot(end.x-start.x,end.z-start.z)
      if(length<.5)return undefined
      const track:Track={...lane,start,end,length,dx:(end.x-start.x)/length,dz:(end.z-start.z)/length,yaw:Math.atan2(end.x-start.x,end.z-start.z),walk,surfaceState:walk?'pending':'ok'}
      if(walk)this.computeWalkSafety(track)
      const exits=this.exits.get(start.id)??[];exits.push(track);this.exits.set(start.id,exits)
      this.registerTrackCells(track)
      return track
    }
    const arms=new Map<number,Set<number>>()
    let synthNodeId=-1
    for(const lane of graph.lanes){
      if(!rules.classes.includes((lane.cls??'').replace(/_link$/,''))||lane.kind!=='motor')continue
      add(lane,false)
      const head=nodes.get(lane.from)!,tail=nodes.get(lane.to)!
      const yAt=(px:number,pz:number)=>{const dx=tail.x-head.x,dz=tail.z-head.z,d2=dx*dx+dz*dz||1;return head.y+(tail.y-head.y)*Math.max(0,Math.min(1,((px-head.x)*dx+(pz-head.z)*dz)/d2))}
      for(const [x,z,east,south] of lane.npcWalks??[]){
        const wLen=Math.hypot(east-x,south-z)
        if(wLen<WALK_MIN_LEN)continue
        const wdx=(east-x)/wLen,wdz=(south-z)/wLen
        let segs=this.extractSafeSegments(x,z,east,south,(px,pz)=>!this.hitsMotorLane(px,pz,MOTOR_CLEARANCE)&&!this.sideClearances(px,pz,wdx,wdz).betweenMotors)
        // Fallback ONLY for roads where a stale walk centerline falls directly inside the carriageway
        // (never push divided-road median tracks blindly into off-sidewalk ground).
        if(!segs.length){
          const midX=(x+east)/2,midZ=(z+south)/2
          const midClear=this.sideClearances(midX,midZ,wdx,wdz)
          if(this.hitsMotorLane(midX,midZ,MOTOR_CLEARANCE)&&!midClear.betweenMotors){
            const nx=-wdz,nz=wdx,shift=(lane.width??3)/2+1.2
            for(const sign of [1,-1] as const){
              const sx=sign*nx*shift,sz=sign*nz*shift
              const shifted=this.extractSafeSegments(x+sx,z+sz,east+sx,south+sz,(px,pz)=>{
                if(this.hitsMotorLane(px,pz,MOTOR_CLEARANCE)||this.sideClearances(px,pz,wdx,wdz).betweenMotors)return false
                if(this.surfaceAt){const ks=this.surfaceAt(px,pz);if(ks&&!isSafeWalkSurface(ks))return false}
                return true
              })
              if(shifted.length){segs=shifted;break}
            }
          }
        }
        for(const [sx,sz,ex,ez] of segs){
          const from=synthNodeId--,to=synthNodeId--
          nodes.set(from,{id:from,x:sx,z:sz,y:yAt(sx,sz)});nodes.set(to,{id:to,x:ex,z:ez,y:yAt(ex,ez)})
          const fwd=add({from,to,id:from,offset:0,cls:lane.cls,street:lane.street,kind:'nonmotor',speedKmh:5},true)
          const rev=add({from:to,to:from,id:to,offset:0,cls:lane.cls,street:lane.street,kind:'nonmotor',speedKmh:5},true)
          if(fwd&&rev){fwd.pairTrack=rev;rev.pairTrack=fwd}
        }
      }
      for(const [node,other] of [[lane.from,lane.to],[lane.to,lane.from]]){
        const neighbors=arms.get(node)??new Set<number>();neighbors.add(other);arms.set(node,neighbors)
      }
    }
    for(const [node,neighbors] of arms)if(neighbors.size>=3)this.junctions.add(node)
    for(const signal of graph.signals){this.signal.set(signal.node,signal);this.junctions.delete(signal.node)}
  }
  private onwardWalk(track:Track){
    const {x,z}=track.end, tolerance=.45
    let best:{track:Track,dist:number,remaining:number}|undefined
    for(let col=Math.floor((x-tolerance)/128);col<=Math.floor((x+tolerance)/128);col++){
      for(let row=Math.floor((z-tolerance)/128);row<=Math.floor((z+tolerance)/128);row++){
        for(const next of this.cells.get(`${col},${row}`)??[]){
          if(!next.walk||next===track||next.street!==track.street||next.dx*track.dx+next.dz*track.dz<.7)continue
          if(!this.usable(next))continue
          const dist=Math.max(0,Math.min(next.length,(x-next.start.x)*next.dx+(z-next.start.z)*next.dz))
          const remaining=next.length-dist
          if(remaining<WALK_MIN_LEN||(best&&remaining<=best.remaining))continue
          if(Math.hypot(next.start.x+dist*next.dx-x,next.start.z+dist*next.dz-z)>tolerance)continue
          if(Math.abs(trackHeight(next,dist)-trackHeight(track,track.length))>tolerance)continue
          best={track:next,dist,remaining}
        }
      }
    }
    return best
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
    if(actor.kind==='person'&&actor.dodge!==0){
      const lo=track.dodgeMin??-WALK_OFFSET,hi=track.dodgeMax??WALK_OFFSET
      actor.dodge=Math.max(lo,Math.min(hi,actor.dodge))
    }
    actor.x=track.start.x+track.dx*dist-track.dz*(track.offset+actor.dodge)
    actor.z=track.start.z+track.dz*dist+track.dx*(track.offset+actor.dodge)
    if(actor.kind==='person'&&actor.dodge!==0&&(track.tightEdge||this.surfaceAt)){
      const ks=this.surfaceAt?.(actor.x,actor.z)
      if((track.tightEdge&&this.hitsMotorLane(actor.x,actor.z,.35))||(ks&&!isSafeWalkSurface(ks))){
        actor.dodge=0
        actor.x=track.start.x+track.dx*dist-track.dz*track.offset
        actor.z=track.start.z+track.dz*dist+track.dx*track.offset
      }
    }
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
      if(person&&track.surfaceState==='pending'&&this.surfaceAt){
        if(!this.resolveWalkSurface(track)){actor.leaving=true;return}
      }
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
      if(actor.arrived){if(!visible?.(actor))actor.leaving=true;return}
      let keepRight=false,passLeft=false
      const safeMinDodge=person?(track.dodgeMin??-WALK_OFFSET):-WALK_OFFSET
      const safeMaxDodge=person?(track.dodgeMax??WALK_OFFSET):WALK_OFFSET
      let minDodge=safeMinDodge,maxDodge=safeMaxDodge
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
        let target=keepRight?WALK_OFFSET:passLeft?-WALK_OFFSET:0
        // If dodging toward the carriageway side is clamped out, shift outward onto the safe sidewalk side instead.
        if(target>safeMaxDodge&&safeMinDodge<0)target=safeMinDodge
        else if(target<safeMinDodge&&safeMaxDodge>0)target=safeMaxDodge
        const clampedLow=Math.max(safeMinDodge,Math.min(safeMaxDodge,minDodge))
        const clampedHigh=Math.max(clampedLow,Math.min(safeMaxDodge,maxDodge))
        const goal=Math.max(safeMinDodge,Math.min(safeMaxDodge,Math.max(clampedLow,Math.min(clampedHigh,target))))
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
      if(person&&actor.dist>=track.length){
        const onward=this.onwardWalk(track)
        if(onward){actor.track=onward.track;actor.dist=onward.dist;this.transitions++}
        else{actor.dist=track.length;actor.speed=0;actor.arrived=true}
      }else if(actor.dist>=track.length){
        const exits=(this.exits.get(track.to)??[]).filter(next=>!next.walk&&next.to!==track.from&&(next.kind==='motor'||(actor.kind==='scooter'&&next.kind==='nonmotor'))&&this.usable(next)&&!this.parkingHits(next).some(hit=>hit.dist<12))
        const sameStreet=exits.filter(next=>next.street===track.street)
        const choices=sameStreet.length?sameStreet:exits
        if(!choices.length){actor.dist=track.length;actor.speed=0;this.position(actor);actor.leaving=!visible?.(actor);return}
        if(this.signal.has(track.to)){this.crossed++;this.onCross?.(track,this.time)}
        const pool=choices
        const straight=pool.filter(next=>next.dx*track.dx+next.dz*track.dz>.88)
        actor.track=straight.length&&this.random()<.85?straight.reduce((best,next)=>Math.abs(next.offset-track.offset)<Math.abs(best.offset-track.offset)?next:best):pool[Math.floor(this.random()*pool.length)]
        actor.dist=0;this.transitions++
      }
      this.position(actor)
      if(person&&actor.track===track&&Math.hypot(actor.x-previousX,actor.z-previousZ)>1e-5)actor.yaw=Math.atan2(actor.x-previousX,actor.z-previousZ)
  }
}
