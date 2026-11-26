import {axleHeight,contactPose} from './lane-surface.ts'
import {nearStatic,resolveContact,staticSolids,pickups,type Solid} from './contact.ts'
import {CAR_SCALE} from '../drive/scale.ts'
import {clampOutsideShizijieNoPedZone,isInShizijieNoPedZone,isNearShizijiePrecinct,segmentHitsShizijieNoPedZone} from '../shizijie-zone.ts'
export type Node = {id:number,x:number,y:number,z:number}
export type Lane = {id:number,from:number,to:number,offset:number,width?:number,kind:'motor'|'bus'|'nonmotor',speedKmh:number,cls?:string,street?:string,npcWalks?:number[][],heights?:number[],floor?:string,gradeSeparated?:string,oneway?:boolean}
type Phase = {lanes:number[],green:number,yellow:number}
type Signal={node:number,group:number,offset:number,phases:Phase[]}
export type Graph = {nodes:Node[],lanes:Lane[],walks:[number,number,number,number?,number[]?][],signals:Signal[]}
export type SurfaceLookup = (x:number,z:number)=>readonly number[]|undefined
export type Track = Lane & {
  start:Node,end:Node,dx:number,dz:number,yaw:number,length:number,walk:boolean,
  virtual?:boolean,sourceLaneId?:number,
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
export type TrafficViolation =
  | 'none'
  | 'no_helmet'
  | 'ebike_overload'
  | 'bike_double'
  | 'wrong_way'
  | 'illegal_mod'
  | 'red_light_run'
export type ActiveTrafficViolation = Exclude<TrafficViolation, 'none'>
export type VehicleSubtype = 'ebike' | 'bicycle'
export type DutyViolationWeights = Partial<Record<TrafficViolation, number>>
export type HitSeverity = 'light' | 'medium' | 'heavy'
export type DutyBehaviorState =
  | 'normal'
  | 'fleeing'
  | 'evading'
  | 'pulling_over'
  | 'pulled_over'
  | 'halted'
  | 'leaving_with_ticket'
export type ActorHandSide = 'right' | 'left'
export type BlinkerMode = 'none' | 'right' | 'hazard'
export interface ViolatorPulledOverEvent {
  actor: Actor
  actorId: string
  pos: Position
  localZ: number | null
  side: 'north' | 'south' | 'unknown'
  time: number
}
export type ViolatorPulledOverCallback = (event: ViolatorPulledOverEvent) => void
export interface TicketReceivedEvent {
  actor: Actor
  actorId: string
  ticketId: string
  handBone?: unknown
  ticketObject?: unknown
  time: number
}
export type TicketReceivedCallback = (event: TicketReceivedEvent) => void
export interface ReceiveTicketOptions {
  ticketId?: string
  slowDurationSec?: number
  handBone?: unknown
  ticketObject?: unknown
  /** Which rider hand receives/holds the ticket (defaults to 'right'; supports 'left' for nearest-hand handover). */
  handSide?: ActorHandSide
  /** Allows traffic-duty handover bridge to complete ticket-received animation/departure after ledger marks actor.cited=true. */
  allowAlreadyCited?: boolean
}
export interface ActorLifecycleEvent {
  type: 'spawn' | 'despawn'
  actor: Actor
  actorId: string
  kind: Actor['kind']
  pos: Position
  bridgeEndDistM: number
  playerDistM: number | null
  cameraDistM: number | null
  inFrustum: boolean
  time: number
}
export type ActorLifecycleCallback = (event: ActorLifecycleEvent) => void
export interface DutyHiddenLifecycleConfig {
  /** Minimum distance along lane beyond bridge ends for any spawn or recycle (m, e.g. 60). */
  minBridgeEndDistM: number
  /** Minimum horizontal distance from player/officer at spawn or recycle moment (m, e.g. 90). */
  minPlayerDistM: number
  /** Frustum exclusion distance: 0 spawns & 0 recycles inside frustum within this range (m, e.g. 120). */
  frustumMinDistM: number
  /** Signed distance beyond nearest bridge end (>0 outside bridge along approach, <=0 on bridge deck). */
  bridgeEndDistance: (pos: Position) => number
  /** Restricts spawn tracks by heading so vehicles enter from approaches toward the bridge. */
  canSpawnOnTrack?: (track: Track, wrongWay: boolean) => boolean
  /** Minimum longitudinal headway (m) between same-direction cars when spawning on hidden approaches. */
  minCarHeadwayM?: number
  /** Minimum longitudinal headway (m) between same-direction scooters when spawning on hidden approaches. */
  minScooterHeadwayM?: number
}
export interface ReceiveTicketResult {
  ok: boolean
  reason?: 'not_found' | 'already_cited'
  actor?: Actor
  actorId?: string
  ticketId?: string
}
export function hitSeverityToNumber(severity: HitSeverity): number {
  return severity === 'heavy' ? 0.95 : severity === 'medium' ? 0.65 : 0.35
}
export interface PlayerHitEvent {
  severity: HitSeverity
  /** Normalized 0..1 impact intensity compatible with `walk/knockdown.ts` `triggerKnockdown()`. */
  severityScore: number
  dir: {x: number; z: number}
  speed: number
  /** Impact speed in km/h (strictly capped <= 25 km/h). */
  speedKmh: number
  honkedBeforeHit: boolean
  actor: Actor
}
export type PlayerHitCallback = (severity: HitSeverity, dir: {x: number; z: number}, event: PlayerHitEvent) => void
export interface PlayerHornEvent {
  actor: Actor
  dist: number
  speed: number
  time: number
}
export type PlayerHornCallback = (event: PlayerHornEvent) => void
export type DutyCrossSectionZone = 'sidewalk' | 'nonmotor' | 'motor' | 'off_bridge'
export interface DutyOfficerContext {
  pos: Position
  active: boolean
  yaw?: number
  /** True when player is sprinting/running; false when walking calmly; undefined auto-infers from position delta. */
  running?: boolean
  /** Optional explicit cross-section zone override. */
  zone?: DutyCrossSectionZone
}
export interface WhistleFlagHaltResult {
  affected: number
  halted: Actor[]
  fled: Actor[]
}
export type DutyZoneConfig = {
  id?:string
  center:{x:number,z:number}
  radius:number
  weights?:DutyViolationWeights
  desiredCars?:number
  desiredScooters?:number
}
export type DutyTrafficConfig = {
  active:boolean
  /** When true, spawns cars & scooters ONLY inside configured duty zones (independent of citywide street traffic). */
  dutyOnly?:boolean
  center?:{x:number,z:number}
  radius?:number
  zones?:readonly DutyZoneConfig[]
  weights?:DutyViolationWeights
  twoWheelShare?:number
  desiredCars?:number
  desiredScooters?:number
  /** Hard cap on active violators as a fraction of total active bridge vehicles (e.g. 0.15). */
  maxViolatorRatio?:number
  /** Hard cap on simultaneous uncited violators (e.g. 2). */
  maxConcurrentViolators?:number
  /** Minimum cooldown in seconds after catching/citing a violator before spawning the next violator (e.g. 20). */
  violatorCooldownSec?:number
  /** Optional bridge cross-section classifier for enforcing sidewalk/nonmotor immunity from car hits. */
  classifyOfficerZone?:(pos:Position)=>DutyCrossSectionZone
  /** Optional runtime cross-section clamp keeping scooters in black nonmotor lanes and cars in motor lanes. */
  constrainActorPosition?:(actor:Actor)=>void
  /** Optional bridge pull-over target solver mapping an actor onto the outer non-motor curb (±15.2m). */
  computePullOverTarget?:(actor:Actor)=>{targetDodge:number;targetLocalZ:number}
  /** Optional off-bridge hidden spawn/recycle lifecycle gate (r8-1). */
  hiddenLifecycle?:DutyHiddenLifecycleConfig
}
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
export type Actor = {
  id?:string
  pitch?:number,roll?:number,arrived?:boolean,
  track:Track,dist:number,speed:number,pace?:number,kind:'car'|'scooter'|'person',down:number,dodge:number,
  x:number,y:number,z:number,yaw:number,scale:number,leaving:boolean,halfWidth:number,halfLength:number,height:number,
  holdUntil?:number,waitingFor?:Actor,waitingSince?:number,
  violation?:TrafficViolation,violations?:ActiveTrafficViolation[],vehicleSubtype?:VehicleSubtype,stoppedUntil?:number,cited?:boolean,
  wrongWay?:boolean,redLightActive?:boolean,redLightTrailDist?:number,
  dutyState?:DutyBehaviorState,fleeUntil?:number,haltedByDuty?:boolean,brakingForOfficer?:boolean,lastPlayerHitAt?:number,
  honkingForOfficer?:boolean,lastHornAt?:number,hornCount?:number,officerWarningSince?:number,
  blinker?:BlinkerMode,lookAtOfficer?:boolean,
  pullOverTargetDodge?:number,pullOverTargetLocalZ?:number,pullOverStopDurationSec?:number,pullOverNotified?:boolean,
  whistleSlowUntil?:number,
  ticketReceived?:boolean,holdingReceipt?:boolean,heldTicketId?:string,heldTicketHandSide?:ActorHandSide,ticketReceivedAt?:number,
  ticketReceiveAnimUntil?:number,ticketReceiveAnimDuration?:number,ticketReceiveAnimActive?:boolean,ticketReceiveAnimElapsed?:number,
  postTicketSlowUntil?:number,
  ghostPassUntil?:number,
  pendingRecycle?:boolean,recycleHeadingX?:number,recycleHeadingZ?:number,recycleSpeed?:number,
  spawnStreet?:string,
}
export type Position = {x:number,z:number,y:number}
export const MAX_ACTORS=100
export const MOBILE_ACTORS=80
export const MAX_PLAYER_HIT_SPEED_KMH=25
export const WHISTLE_FLEE_SURRENDER_PROB=0.4
export const OVERLOAD_NO_HELMET_STACK_PROB=0.55
export const POST_TICKET_SLOW_DURATION_S=3.0
export const POST_TICKET_SLOW_MAX_SPEED_MS=2.2
const MAX_PLAYER_HIT_SPEED_MS=24.5/3.6
const HORN_WARN_DIST_M=26
const BRAKE_START_DIST_M=20
const HORN_IGNORE_GRACE_S=0.65
let nextActorUid=1
function ensureActorId(actor:Actor):string{
  if(!actor.id)actor.id=`actor_${nextActorUid++}`
  return actor.id
}
// IDOK-160: motor actors never appear inside the view frustum closer than this,
// except right after a cold start or teleport when the street is still empty.
export const VISIBLE_SPAWN_MIN=130
const WARMUP_S=1.2,TELEPORT=60
const DEFAULT_DUTY_CENTER={x:-168,z:40}
const DEFAULT_DUTY_RADIUS=240
const SHIZIJIE_MOD_SHOP={x:-779.4,z:-162.8}
const WRONG_WAY_LATERAL_OFFSET=-.55
const DEFAULT_AMBIENT_WEIGHTS:Record<TrafficViolation,number>={
  none:82,no_helmet:5,ebike_overload:4,bike_double:3,illegal_mod:3,wrong_way:2,red_light_run:1,
}
const DEFAULT_DUTY_WEIGHTS:Record<TrafficViolation,number>={
  none:72,no_helmet:8,ebike_overload:6,bike_double:5,illegal_mod:5,wrong_way:4,red_light_run:0,
}
const distanceSq=(left:Position,right:Position)=>(left.x-right.x)**2+(left.y-right.y)**2+(left.z-right.z)**2

const actorOwners=new WeakMap<Actor,Traffic>()
let latestTrafficRef:WeakRef<Traffic>|undefined

export function getLatestTraffic():Traffic|undefined{
  return latestTrafficRef?.deref()
}

export function stopActor(actor:Actor,durationSec=4,traffic?:Traffic):boolean{
  const owner=traffic??actorOwners.get(actor)
  if(owner)return owner.stopActor(actor,durationSec)
  if(!actor||!Number.isFinite(durationSec)||durationSec<0)return false
  actor.holdUntil=Math.max(actor.holdUntil??0,performance.now()+durationSec*1000)
  actor.speed=0
  return true
}

function pointToSegmentDistSq(px:number,pz:number,ax:number,az:number,bx:number,bz:number){
  const dx=bx-ax,dz=bz-az,lenSq=dx*dx+dz*dz
  if(lenSq<1e-6)return (px-ax)**2+(pz-az)**2
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/lenSq))
  return (px-ax-dx*t)**2+(pz-az-dz*t)**2
}

export function getActorViolations(
  actor?: Pick<Actor, 'violation' | 'violations'> | null,
): ActiveTrafficViolation[] {
  if (!actor) return []
  const list: ActiveTrafficViolation[] = []
  if (Array.isArray(actor.violations)) {
    for (const v of actor.violations) {
      if (v && (v as string) !== 'none' && !list.includes(v)) list.push(v)
    }
  }
  if (actor.violation && actor.violation !== 'none' && !list.includes(actor.violation)) {
    list.unshift(actor.violation)
  }
  return list
}

export function actorHasViolation(
  actor: Pick<Actor, 'violation' | 'violations'> | null | undefined,
  target: ActiveTrafficViolation,
): boolean {
  return getActorViolations(actor).includes(target)
}

function pickTwoWheelProfile(
  random:()=>number,
  weights?:DutyViolationWeights,
  dutyActive=false,
  opts?:{allowWrongWay?:boolean,nearModShop?:boolean,approachingSignal?:boolean},
):{vehicleSubtype:VehicleSubtype,violation:TrafficViolation,violations:ActiveTrafficViolation[]}{
  const base=dutyActive?DEFAULT_DUTY_WEIGHTS:DEFAULT_AMBIENT_WEIGHTS
  const weightOf=(k:TrafficViolation)=>Math.max(0,weights?(weights[k]??0):base[k])
  const wNone=weightOf('none')
  const wHelmet=weightOf('no_helmet')
  const wOverload=weightOf('ebike_overload')
  const wDouble=weightOf('bike_double')
  const wIllegalMod=weightOf('illegal_mod')*(opts?.nearModShop&&!weights?1.6:1)
  const wWrongWay=opts?.allowWrongWay===false?0:weightOf('wrong_way')
  const wRedLight=weightOf('red_light_run')*(opts?.approachingSignal&&!weights?1.8:1)
  const total=wNone+wHelmet+wOverload+wDouble+wIllegalMod+wWrongWay+wRedLight
  if(total<=0)return {vehicleSubtype:random()<.72?'ebike':'bicycle',violation:'none',violations:[]}
  let roll=random()*total
  if((roll-=wHelmet)<0)return {vehicleSubtype:'ebike',violation:'no_helmet',violations:['no_helmet']}
  if((roll-=wOverload)<0){
    const stackNoHelmet=random()<OVERLOAD_NO_HELMET_STACK_PROB
    return {
      vehicleSubtype:'ebike',
      violation:'ebike_overload',
      violations:stackNoHelmet?['ebike_overload','no_helmet']:['ebike_overload'],
    }
  }
  if((roll-=wDouble)<0)return {vehicleSubtype:'bicycle',violation:'bike_double',violations:['bike_double']}
  if((roll-=wIllegalMod)<0)return {vehicleSubtype:'ebike',violation:'illegal_mod',violations:['illegal_mod']}
  if((roll-=wWrongWay)<0)return {vehicleSubtype:'ebike',violation:'wrong_way',violations:['wrong_way']}
  if((roll-=wRedLight)<0)return {vehicleSubtype:'ebike',violation:'red_light_run',violations:['red_light_run']}
  return {vehicleSubtype:random()<.72?'ebike':'bicycle',violation:'none',violations:[]}
}

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
          const px=track.start.x+track.dx*track.length*t+nx*shift,pz=track.start.z+track.dz*track.length*t+nz*shift
          if(isInShizijieNoPedZone(px,pz))return false
          const ks=this.surfaceAt!(px,pz)
          if(ks&&!isSafeWalkSurface(ks))return false
        }
        return true
      }
      if(maxD>0&&!sampleOk(maxD))maxD=sampleOk(maxD*.5)?maxD*.5:0
      if(minD<0&&!sampleOk(minD))minD=sampleOk(minD*.5)?minD*.5:0
    }else{
      const nx=-track.dz,nz=track.dx
      const shizijieOk=(shift:number)=>{
        for(const t of [.2,.5,.8]){
          if(isInShizijieNoPedZone(track.start.x+track.dx*track.length*t+nx*shift,track.start.z+track.dz*track.length*t+nz*shift))return false
        }
        return true
      }
      if(maxD>0&&!shizijieOk(maxD))maxD=shizijieOk(maxD*.5)?maxD*.5:0
      if(minD<0&&!shizijieOk(minD))minD=shizijieOk(minD*.5)?minD*.5:0
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
    if(!segmentHitsShizijieNoPedZone(track.start.x,track.start.z,track.end.x,track.end.z)&&checkAllSafe(track.start.x,track.start.z,track.end.x,track.end.z)){
      this.computeWalkSafety(track)
      if(track.pairTrack)this.computeWalkSafety(track.pairTrack)
      return mark('ok')
    }
    const wdx=track.dx,wdz=track.dz,nx=-wdz,nz=wdx
    const outSign=track.outwardSign??1
    const safePt=(px:number,pz:number)=>{
      if(isInShizijieNoPedZone(px,pz))return false
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
    if(!bestSeg||segmentHitsShizijieNoPedZone(bestSeg[0],bestSeg[1],bestSeg[2],bestSeg[3])||!this.updateTrackGeometry(track,bestSeg[0],bestSeg[1],bestSeg[2],bestSeg[3]))return mark('rejected')
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
  onPlayerHit?: PlayerHitCallback
  onPlayerHorn?: PlayerHornCallback
  onViolatorPulledOver?: ViolatorPulledOverCallback
  onTicketReceived?: TicketReceivedCallback
  onActorSpawn?: ActorLifecycleCallback
  onActorDespawn?: ActorLifecycleCallback
  deferredSpawnCount=0
  deferredDespawnCount=0
  private signal=new Map<number,Signal>()
  private junctions=new Set<number>()
  private queues=new Map<number,Actor[]>()
  private exits=new Map<number,Track[]>()
  private entries=new Map<number,Track[]>()
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
  private adjacent(track:Track){return (this.exits.get(track.from)??[]).filter(next=>next!==track&&!next.walk&&next.kind===track.kind&&next.to===track.to&&next.street===track.street&&Math.abs(next.offset-track.offset)<=(next.width??3)/2+(track.width??3)/2+.1&&!this.parkingHits(next).length)}
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
  private streets=new Map<string,{walk:Track[],motor:Track[],virtualNonmotor:Track[]}>()
  private nearbyRealNonmotor:Track[]=[]
  private cellKey=''
  private dutyConfig:DutyTrafficConfig={active:false}
  private dutyTracksCache=new Map<string,{nonmotor:Track[],motor:Track[]}>()
  private dutyOfficer?:DutyOfficerContext
  private prevOfficerPos?:Position
  private officerSpeed=0
  private externalExclusion?:{center:{x:number,z:number},radius:number}
  private lastHitAt=-Infinity
  private lastViolatorCitedAt=-Infinity
  private countedCitedActors=new WeakSet<Actor>()
  setDutyConfig(config:Partial<DutyTrafficConfig>){
    this.dutyConfig={...this.dutyConfig,...config}
  }
  getDutyConfig():Readonly<DutyTrafficConfig>{return this.dutyConfig}
  setDutyOfficer(ctx:DutyOfficerContext|null|undefined){
    this.dutyOfficer=ctx??undefined
    if(!ctx||!ctx.active){this.prevOfficerPos=undefined;this.officerSpeed=0}
  }
  getDutyOfficer():Readonly<DutyOfficerContext>|undefined{return this.dutyOfficer}
  notifyViolatorCited(actor?:Actor){
    if(actor){
      actor.cited=true
      this.countedCitedActors.add(actor)
    }
    this.lastViolatorCitedAt=this.time
  }
  syncCitedViolatorCooldown(){
    for(const actor of this.actors){
      if(actor.cited&&actor.violation&&actor.violation!=='none'&&!this.countedCitedActors.has(actor)){
        this.countedCitedActors.add(actor)
        this.lastViolatorCitedAt=this.time
      }
    }
  }
  getViolatorCooldownRemaining():number{
    const cd=this.dutyConfig.violatorCooldownSec??0
    if(cd<=0||!Number.isFinite(this.lastViolatorCitedAt))return 0
    return Math.max(0,cd-(this.time-this.lastViolatorCitedAt))
  }
  private canSpawnViolator():boolean{
    const cfg=this.dutyConfig
    if(cfg.violatorCooldownSec!==undefined&&cfg.violatorCooldownSec>0&&this.time-this.lastViolatorCitedAt<cfg.violatorCooldownSec){
      return false
    }
    let activeVehicles=0,activeViolators=0
    for(const a of this.actors){
      if(a.leaving||a.pendingRecycle||a.kind==='person')continue
      activeVehicles++
      if(a.kind==='scooter'&&!a.cited&&a.violation&&a.violation!=='none'){
        activeViolators++
      }
    }
    if(cfg.maxConcurrentViolators!==undefined&&activeViolators>=cfg.maxConcurrentViolators){
      return false
    }
    if(cfg.maxViolatorRatio!==undefined&&cfg.maxViolatorRatio<1){
      // Enforce strict ratio cap with 2-vehicle exit headroom so normal vehicles leaving bridge never spike share > maxViolatorRatio.
      const projectedTotal=activeVehicles+1
      const projectedViolators=activeViolators+1
      const effectiveTotal=Math.max(1,projectedTotal-2)
      if(projectedViolators/projectedTotal>cfg.maxViolatorRatio||projectedViolators/effectiveTotal>cfg.maxViolatorRatio){
        return false
      }
    }
    return true
  }
  setExternalExclusion(zone:{center:{x:number,z:number},radius:number}|null|undefined){
    this.externalExclusion=zone??undefined
  }
  findActor(actorOrId:string|number|Actor|null|undefined):Actor|undefined{
    if(!actorOrId)return undefined
    if(typeof actorOrId==='object'){
      return this.actors.includes(actorOrId)?actorOrId:undefined
    }
    const key=String(actorOrId)
    return this.actors.find(a=>ensureActorId(a)===key)
  }
  private beginPullOver(actor:Actor,stopDurationSec:number){
    ensureActorId(actor)
    const target=this.dutyConfig.computePullOverTarget?.(actor)
    actor.dutyState='pulling_over'
    actor.blinker='right'
    actor.fleeUntil=undefined
    actor.whistleSlowUntil=undefined
    actor.haltedByDuty=false
    actor.stoppedUntil=undefined
    actor.holdUntil=undefined
    actor.pullOverTargetDodge=target?target.targetDodge:1.1
    actor.pullOverTargetLocalZ=target?target.targetLocalZ:undefined
    actor.pullOverStopDurationSec=Math.max(4,stopDurationSec)
    actor.pullOverNotified=false
    actor.lookAtOfficer=false
  }
  pullOverViolator(actorOrId:string|number|Actor,stopDurationSec=45):boolean{
    const actor=this.findActor(actorOrId)
    if(!actor||actor.kind!=='scooter'||actor.leaving)return false
    this.beginPullOver(actor,stopDurationSec)
    return true
  }
  releaseViolator(actorOrId:string|number|Actor):boolean{
    const actor=this.findActor(actorOrId)
    if(!actor)return false
    actor.haltedByDuty=false
    actor.stoppedUntil=undefined
    actor.holdUntil=undefined
    actor.blinker='none'
    actor.lookAtOfficer=false
    actor.pullOverTargetDodge=undefined
    actor.pullOverNotified=false
    if(actor.dutyState==='pulling_over'||actor.dutyState==='pulled_over'||actor.dutyState==='halted'){
      actor.dutyState='normal'
    }
    return true
  }
  commandRelease(origin:Position,rangeM=10):Actor[]{
    const released:Actor[]=[]
    for(const actor of this.actors){
      if(actor.kind!=='scooter'||actor.leaving)continue
      if(actor.dutyState!=='pulled_over'&&actor.dutyState!=='pulling_over'&&actor.dutyState!=='halted'&&!actor.haltedByDuty)continue
      if(Math.abs(actor.y-origin.y)>3)continue
      if(Math.hypot(actor.x-origin.x,actor.z-origin.z)>rangeM)continue
      if(this.releaseViolator(actor))released.push(actor)
    }
    return released
  }
  receiveTicket(actorOrId:string|number|Actor,opts?:ReceiveTicketOptions):ReceiveTicketResult{
    const actor=this.findActor(actorOrId)
    if(!actor)return {ok:false,reason:'not_found'}
    const actorId=ensureActorId(actor)
    if(actor.ticketReceived||(!opts?.allowAlreadyCited&&actor.cited)){
      return {ok:false,reason:'already_cited',actor,actorId,ticketId:actor.heldTicketId}
    }
    const ticketId=opts?.ticketId??`TKT-${actorId}`
    const slowDurationSec=Math.max(0.5,opts?.slowDurationSec??POST_TICKET_SLOW_DURATION_S)
    actor.cited=true
    actor.ticketReceived=true
    actor.holdingReceipt=true
    actor.heldTicketId=ticketId
    actor.heldTicketHandSide=opts?.handSide??actor.heldTicketHandSide??'right'
    actor.ticketReceivedAt=this.time
    actor.ticketReceiveAnimDuration=1.15
    actor.ticketReceiveAnimUntil=this.time+actor.ticketReceiveAnimDuration
    actor.ticketReceiveAnimActive=true
    actor.ticketReceiveAnimElapsed=0
    actor.postTicketSlowUntil=this.time+slowDurationSec
    actor.haltedByDuty=false
    actor.stoppedUntil=undefined
    actor.holdUntil=undefined
    actor.blinker='none'
    actor.lookAtOfficer=false
    actor.fleeUntil=undefined
    actor.whistleSlowUntil=undefined
    actor.pullOverTargetDodge=undefined
    actor.dutyState='leaving_with_ticket'
    this.notifyViolatorCited(actor)
    this.onTicketReceived?.({
      actor,
      actorId,
      ticketId,
      handBone:opts?.handBone,
      ticketObject:opts?.ticketObject,
      time:this.time,
    })
    return {ok:true,actor,actorId,ticketId}
  }
  commandHalt(
    origin:Position,
    opts?:{kind?:'whistle'|'flag',rangeM?:number,haltProbability?:number,stopDurationSec?:number,pullOver?:boolean,random?:()=>number},
  ):WhistleFlagHaltResult{
    const kind=opts?.kind??'whistle'
    const rangeM=Math.max(4,opts?.rangeM??(kind==='flag'?10:12))
    const stopDurationSec=Math.max(2,opts?.stopDurationSec??(kind==='flag'?45:14))
    const rng=opts?.random??this.random
    const halted:Actor[]=[]
    const fled:Actor[]=[]
    for(const actor of this.actors){
      if(actor.kind!=='scooter'||actor.leaving||actor.cited||actor.ticketReceived||actor.scale<.5)continue
      if(!actor.violation||actor.violation==='none')continue
      if(Math.abs(actor.y-origin.y)>3)continue
      const dist=Math.hypot(actor.x-origin.x,actor.z-origin.z)
      if(dist>rangeM)continue
      ensureActorId(actor)
      const isFleeing=actor.dutyState==='fleeing'||actor.dutyState==='evading'
      if(kind==='flag'){
        const prob=opts?.haltProbability!==undefined?Math.min(1,Math.max(0,opts.haltProbability)):1
        if(rng()<prob){
          if(opts?.pullOver===false){
            actor.dutyState='halted'
            actor.haltedByDuty=true
            actor.fleeUntil=undefined
            actor.brakingForOfficer=false
            actor.lookAtOfficer=true
            this.stopActor(actor,stopDurationSec)
          }else{
            this.beginPullOver(actor,stopDurationSec)
          }
          halted.push(actor)
        }else{
          actor.dutyState='fleeing'
          actor.haltedByDuty=false
          actor.fleeUntil=this.time+7
          const dirX=actor.wrongWay?-actor.track.dx:actor.track.dx
          const dirZ=actor.wrongWay?-actor.track.dz:actor.track.dz
          const side=(origin.z-actor.z)*dirX-(origin.x-actor.x)*dirZ
          const maxDodgeBound=actor.track.gradeSeparated==='jiefang'?.6:.85
          actor.dodge=Math.max(-maxDodgeBound,Math.min(maxDodgeBound,actor.dodge-Math.sign(side||1)*.45))
          fled.push(actor)
        }
        continue
      }
      // Whistle ('whistle'): fleeing violators abandon escape with 40% default probability; non-fleeing violators slow down
      if(isFleeing){
        const prob=opts?.haltProbability!==undefined
          ?Math.min(1,Math.max(0,opts.haltProbability))
          :WHISTLE_FLEE_SURRENDER_PROB
        if(rng()<prob){
          if(opts?.haltProbability!==undefined&&opts?.pullOver!==true){
            actor.dutyState='halted'
            actor.haltedByDuty=true
            actor.fleeUntil=undefined
            actor.brakingForOfficer=false
            actor.lookAtOfficer=true
            if(actor.track.kind==='nonmotor')actor.dodge=.35
            this.stopActor(actor,stopDurationSec)
          }else{
            this.beginPullOver(actor,stopDurationSec)
          }
          halted.push(actor)
        }else{
          actor.dutyState='fleeing'
          actor.haltedByDuty=false
          actor.fleeUntil=this.time+7
          fled.push(actor)
        }
      }else if(opts?.haltProbability!==undefined){
        const prob=Math.min(1,Math.max(0,opts.haltProbability))
        if(rng()<prob){
          if(opts.pullOver===true){
            this.beginPullOver(actor,stopDurationSec)
          }else{
            actor.dutyState='halted'
            actor.haltedByDuty=true
            actor.fleeUntil=undefined
            actor.brakingForOfficer=false
            actor.lookAtOfficer=true
            if(actor.track.kind==='nonmotor')actor.dodge=.35
            this.stopActor(actor,stopDurationSec)
          }
          halted.push(actor)
        }else{
          actor.dutyState='fleeing'
          actor.haltedByDuty=false
          actor.fleeUntil=this.time+7
          const dirX=actor.wrongWay?-actor.track.dx:actor.track.dx
          const dirZ=actor.wrongWay?-actor.track.dz:actor.track.dz
          const side=(origin.z-actor.z)*dirX-(origin.x-actor.x)*dirZ
          const maxDodgeBound=actor.track.gradeSeparated==='jiefang'?.6:.85
          actor.dodge=Math.max(-maxDodgeBound,Math.min(maxDodgeBound,actor.dodge-Math.sign(side||1)*.45))
          fled.push(actor)
        }
      }else{
        // Default Q whistle on non-fleeing violator within 12m: audible warning slowdown
        actor.whistleSlowUntil=this.time+3.5
        actor.brakingForOfficer=true
      }
    }
    return {affected:halted.length+fled.length,halted,fled}
  }
  hasSignal(nodeId:number):boolean{return this.signal.has(nodeId)}
  getSignalPhase(laneId:number,toNode:number,time=this.time):'green'|'red'|'yellow'|null{
    if(!this.signal.has(toNode))return null
    return this.phase({id:laneId,from:0,to:toNode,offset:0,kind:'motor',speedKmh:30},time)
  }
  stopActor(actor:Actor,durationSec=4):boolean{
    if(!actor||!Number.isFinite(durationSec)||durationSec<0)return false
    actor.stoppedUntil=this.time+durationSec
    actor.speed=0
    actorOwners.set(actor,this)
    return true
  }
  private sites(camera:Position){
    const col=Math.floor(camera.x/128),row=Math.floor(camera.z/128),key=`${col},${row}`
    if(key===this.cellKey)return this.streets
    this.cellKey=key;this.streets.clear();this.nearbyRealNonmotor.length=0
    const seen=new Set<Track>()
    for(let east=col-2;east<=col+2;east++)for(let south=row-2;south<=row+2;south++)for(const track of this.cells.get(`${east},${south}`)??[]){
      if(seen.has(track))continue
      seen.add(track)
      if(!track.walk&&track.kind==='nonmotor'&&!track.virtual)this.nearbyRealNonmotor.push(track)
      if(!track.street)continue
      let group=this.streets.get(track.street)
      if(!group){group={walk:[],motor:[],virtualNonmotor:[]};this.streets.set(track.street,group)}
      if(track.walk)group.walk.push(track)
      else if(track.kind==='nonmotor'){if(track.virtual)group.virtualNonmotor.push(track)}
      else group.motor.push(track)
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
    const add=(lane:Lane,walk:boolean,virtual=false,sourceLaneId?:number):Track|undefined=>{
      const start=nodes.get(lane.from),end=nodes.get(lane.to)
      if(!start||!end)return undefined
      const length=Math.hypot(end.x-start.x,end.z-start.z)
      if(length<.5)return undefined
      const track:Track={...lane,start,end,length,dx:(end.x-start.x)/length,dz:(end.z-start.z)/length,yaw:Math.atan2(end.x-start.x,end.z-start.z),walk,virtual,sourceLaneId,surfaceState:walk?'pending':'ok'}
      if(walk)this.computeWalkSafety(track)
      const exits=this.exits.get(start.id)??[];exits.push(track);this.exits.set(start.id,exits)
      const entries=this.entries.get(end.id)??[];entries.push(track);this.entries.set(end.id,entries)
      this.registerTrackCells(track)
      return track
    }
    const arms=new Map<number,Set<number>>()
    const realNonmotorCells=new Map<string,Track[]>()
    const rightmostMotor=new Map<string,Lane>()
    let synthNodeId=-1
    for(const lane of graph.lanes){
      if(lane.kind==='nonmotor'){
        const track=add(lane,false,false)
        if(track){
          const ax=track.start.x-track.dz*track.offset,az=track.start.z+track.dx*track.offset
          const bx=track.end.x-track.dz*track.offset,bz=track.end.z+track.dx*track.offset
          for(let c=Math.floor(Math.min(ax,bx)/64);c<=Math.floor(Math.max(ax,bx)/64);c++)
            for(let r=Math.floor(Math.min(az,bz)/64);r<=Math.floor(Math.max(az,bz)/64);r++){
              const k=`${c},${r}`,bucket=realNonmotorCells.get(k)??[];bucket.push(track);realNonmotorCells.set(k,bucket)
            }
        }
        continue
      }
      if(!rules.classes.includes((lane.cls??'').replace(/_link$/,''))||lane.kind!=='motor')continue
      add(lane,false,false)
      const edgeKey=`${lane.from}:${lane.to}`,existingBest=rightmostMotor.get(edgeKey)
      if(!existingBest||lane.offset>existingBest.offset)rightmostMotor.set(edgeKey,lane)
      const head=nodes.get(lane.from)!,tail=nodes.get(lane.to)!
      const yAt=(px:number,pz:number)=>{const dx=tail.x-head.x,dz=tail.z-head.z,d2=dx*dx+dz*dz||1;return head.y+(tail.y-head.y)*Math.max(0,Math.min(1,((px-head.x)*dx+(pz-head.z)*dz)/d2))}
      for(const [x,z,east,south] of lane.npcWalks??[]){
        const wLen=Math.hypot(east-x,south-z)
        if(wLen<WALK_MIN_LEN)continue
        const wdx=(east-x)/wLen,wdz=(south-z)/wLen
        let segs=this.extractSafeSegments(x,z,east,south,(px,pz)=>!isInShizijieNoPedZone(px,pz)&&!this.hitsMotorLane(px,pz,MOTOR_CLEARANCE)&&!this.sideClearances(px,pz,wdx,wdz).betweenMotors)
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
                if(isInShizijieNoPedZone(px,pz)||this.hitsMotorLane(px,pz,MOTOR_CLEARANCE)||this.sideClearances(px,pz,wdx,wdz).betweenMotors)return false
                if(this.surfaceAt){const ks=this.surfaceAt(px,pz);if(ks&&!isSafeWalkSurface(ks))return false}
                return true
              })
              if(shifted.length){segs=shifted;break}
            }
          }
        }
        for(const [sx,sz,ex,ez] of segs){
          if(segmentHitsShizijieNoPedZone(sx,sz,ex,ez))continue
          const from=synthNodeId--,to=synthNodeId--
          nodes.set(from,{id:from,x:sx,z:sz,y:yAt(sx,sz)});nodes.set(to,{id:to,x:ex,z:ez,y:yAt(ex,ez)})
          const fwd=add({from,to,id:from,offset:0,cls:lane.cls,street:lane.street,kind:'nonmotor',speedKmh:5},true,false)
          const rev=add({from:to,to:from,id:to,offset:0,cls:lane.cls,street:lane.street,kind:'nonmotor',speedKmh:5},true,false)
          if(fwd&&rev){fwd.pairTrack=rev;rev.pairTrack=fwd}
        }
      }
      for(const [node,other] of [[lane.from,lane.to],[lane.to,lane.from]]){
        const neighbors=arms.get(node)??new Set<number>();neighbors.add(other);arms.set(node,neighbors)
      }
    }
    // Phase 1 fallback: synthesize a virtual right-edge nonmotor track on major motor roads lacking an adjacent cycleway.
    if(realNonmotorCells.size||rightmostMotor.size){
      for(const best of rightmostMotor.values()){
        if(best.gradeSeparated==='jiefang')continue
        const head=nodes.get(best.from),tail=nodes.get(best.to)
        if(!head||!tail)continue
        const len=Math.hypot(tail.x-head.x,tail.z-head.z)
        if(len<.5)continue
        const dx=(tail.x-head.x)/len,dz=(tail.z-head.z)/len
        const mx=(head.x+tail.x)/2-dz*best.offset,mz=(head.z+tail.z)/2+dx*best.offset,my=(head.y+tail.y)/2
        let covered=false
        const cc=Math.floor(mx/64),cr=Math.floor(mz/64)
        outer:for(let dc=-1;dc<=1;dc++)for(let dr=-1;dr<=1;dr++){
          for(const nm of realNonmotorCells.get(`${cc+dc},${cr+dr}`)??[]){
            if(dx*nm.dx+dz*nm.dz<.65)continue
            const nmAx=nm.start.x-nm.dz*nm.offset,nmAz=nm.start.z+nm.dx*nm.offset
            const nmBx=nm.end.x-nm.dz*nm.offset,nmBz=nm.end.z+nm.dx*nm.offset
            if(pointToSegmentDistSq(mx,mz,nmAx,nmAz,nmBx,nmBz)<=20**2&&Math.abs(my-(nm.start.y+nm.end.y)/2)<=2.5){
              covered=true;break outer
            }
          }
        }
        if(covered)continue
        const laneW=best.width??3
        const virtualOffset=Math.round((best.offset+Math.min(1.45,laneW*.45))*100)/100
        add({...best,kind:'nonmotor',offset:virtualOffset,width:1.6,speedKmh:Math.min(best.speedKmh,25)},false,true,best.id)
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
          const nxPt=next.start.x+dist*next.dx,nzPt=next.start.z+dist*next.dz
          if(Math.hypot(nxPt-x,nzPt-z)>tolerance)continue
          if(segmentHitsShizijieNoPedZone(next.start.x,next.start.z,next.end.x,next.end.z)||segmentHitsShizijieNoPedZone(x,z,nxPt,nzPt))continue
          if(Math.abs(trackHeight(next,dist)-trackHeight(track,track.length))>tolerance)continue
          best={track:next,dist,remaining}
        }
      }
    }
    return best
  }
  private shizijieTurnOrReverse(track:Track){
    const {x,z}=track.end
    if(!isNearShizijiePrecinct(x,z,12))return undefined
    const tolerance=4.5
    let best:{track:Track,dist:number,gap:number}|undefined
    for(let col=Math.floor((x-tolerance)/128);col<=Math.floor((x+tolerance)/128);col++){
      for(let row=Math.floor((z-tolerance)/128);row<=Math.floor((z+tolerance)/128);row++){
        for(const next of this.cells.get(`${col},${row}`)??[]){
          if(!next.walk||next===track||next===track.pairTrack||next.dx*track.dx+next.dz*track.dz<-.75)continue
          if(!this.usable(next))continue
          const dist=Math.max(0,Math.min(next.length,(x-next.start.x)*next.dx+(z-next.start.z)*next.dz))
          if(next.length-dist<WALK_MIN_LEN)continue
          const nxPt=next.start.x+dist*next.dx,nzPt=next.start.z+dist*next.dz
          const gap=Math.hypot(nxPt-x,nzPt-z)
          if(gap>tolerance||(best&&gap>=best.gap))continue
          if(segmentHitsShizijieNoPedZone(next.start.x,next.start.z,next.end.x,next.end.z)||segmentHitsShizijieNoPedZone(x,z,nxPt,nzPt))continue
          if(gap>.5&&this.surfaceAt){
            const midKs=this.surfaceAt((x+nxPt)*.5,(z+nzPt)*.5)
            if(midKs&&!isSafeWalkSurface(midKs))continue
          }
          if(Math.abs(trackHeight(next,dist)-trackHeight(track,track.length))>.6)continue
          best={track:next,dist,gap}
        }
      }
    }
    if(best)return best
    const rev=track.pairTrack
    if(rev&&this.usable(rev)&&!segmentHitsShizijieNoPedZone(rev.start.x,rev.start.z,rev.end.x,rev.end.z)){
      return {track:rev,dist:0}
    }
    return undefined
  }
  isJunction(node:number){return this.junctions.has(node)||this.signal.has(node)}
  inherit(previous:Traffic){
    this.time=previous.time
    this.warmUntil=previous.warmUntil;this.lastCamera=previous.lastCamera
    this.dutyConfig={...previous.dutyConfig};this.dutyTracksCache.clear()
    for(const actor of previous.actors){
      const track=this.exits.get(actor.track.from)?.find(candidate=>candidate.id===actor.track.id&&candidate.kind===actor.track.kind&&!!candidate.virtual===!!actor.track.virtual)
      if(track){actor.track=track;this.actors.push(actor);actorOwners.set(actor,this)}
    }
    for(const [node,queue] of previous.queues)if(this.junctions.has(node))this.queues.set(node,queue.filter(actor=>this.actors.includes(actor)))
  }
  private position(actor:Actor){
    const {track,dist}=actor
    if(actor.kind==='person'&&actor.dodge!==0){
      const lo=track.dodgeMin??-WALK_OFFSET,hi=track.dodgeMax??WALK_OFFSET
      actor.dodge=Math.max(lo,Math.min(hi,actor.dodge))
    }
    const totalOffset=track.offset+actor.dodge+(actor.wrongWay?WRONG_WAY_LATERAL_OFFSET:0)
    actor.x=track.start.x+track.dx*dist-track.dz*totalOffset
    actor.z=track.start.z+track.dz*dist+track.dx*totalOffset
    if(actor.kind!=='person')this.dutyConfig.constrainActorPosition?.(actor)
    if(actor.kind==='person'&&(actor.dodge!==0&&(track.tightEdge||this.surfaceAt)||isInShizijieNoPedZone(actor.x,actor.z))){
      const ks=this.surfaceAt?.(actor.x,actor.z)
      if((track.tightEdge&&this.hitsMotorLane(actor.x,actor.z,.35))||(ks&&!isSafeWalkSurface(ks))||isInShizijieNoPedZone(actor.x,actor.z)){
        actor.dodge=0
        actor.x=track.start.x+track.dx*dist-track.dz*track.offset
        actor.z=track.start.z+track.dz*dist+track.dx*track.offset
        if(isInShizijieNoPedZone(actor.x,actor.z)){
          const [cx,cz]=clampOutsideShizijieNoPedZone(actor.x,actor.z,.3)
          actor.x=cx;actor.z=cz
        }
      }
    }
    const pose=track.floor?contactPose(track,dist,undefined,undefined,undefined,actor.dodge+(actor.wrongWay?WRONG_WAY_LATERAL_OFFSET:0)):undefined
    actor.pitch=pose?(actor.wrongWay?-pose.pitch:pose.pitch):0
    actor.roll=pose?(actor.wrongWay?-pose.roll:pose.roll):0
    const reference=pose?.y??trackHeight(track,dist)
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
    actor.yaw=actor.wrongWay?Math.atan2(-track.dx,-track.dz):track.yaw
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
  private collectCandidates(tracks:readonly Track[],camera:Position,searchRadius=200){
    const candidates:{track:Track,min:number,max:number,end:number}[]=[]
    let availableLength=0
    for(const track of tracks){
      if(!this.usable(track))continue
      const dx=camera.x-track.start.x+track.dz*track.offset,dz=camera.z-track.start.z-track.dx*track.offset
      const center=dx*track.dx+dz*track.dz,span=Math.sqrt(searchRadius**2-(dx*track.dz-dz*track.dx)**2)
      const min=Math.max(0,center-span),max=Math.min(track.length,center+span)
      if(max>min){availableLength+=max-min;candidates.push({track,min,max,end:availableLength})}
    }
    return {candidates,availableLength}
  }
  private evalHiddenGate(
    pos:Position,
    camera:Position,
    visible:((point:Position)=>boolean)|undefined,
    hl:DutyHiddenLifecycleConfig,
  ):{allowed:boolean,bridgeEndDistM:number,playerDistM:number,cameraDistM:number,inFrustum:boolean}{
    const bridgeEndDistM=hl.bridgeEndDistance(pos)
    const officerPos=this.dutyOfficer?.active?this.dutyOfficer.pos:undefined
    const cameraDistM=Math.hypot(pos.x-camera.x,pos.z-camera.z)
    const playerDistM=officerPos?Math.hypot(pos.x-officerPos.x,pos.z-officerPos.z):cameraDistM
    const inFrustum=Boolean(visible?.(pos))
    const allowed=
      bridgeEndDistM>=hl.minBridgeEndDistM&&
      playerDistM>=hl.minPlayerDistM&&
      cameraDistM>=hl.minPlayerDistM&&
      !(inFrustum&&(cameraDistM<=hl.frustumMinDistM||playerDistM<=hl.frustumMinDistM))
    return {allowed,bridgeEndDistM,playerDistM,cameraDistM,inFrustum}
  }
  private emitLifecycle(
    type:'spawn'|'despawn',
    actor:Actor,
    camera:Position,
    visible:((point:Position)=>boolean)|undefined,
  ):void{
    const cb=type==='spawn'?this.onActorSpawn:this.onActorDespawn
    if(!cb)return
    const hl=this.dutyConfig.hiddenLifecycle
    const officerPos=this.dutyOfficer?.active?this.dutyOfficer.pos:undefined
    const cameraDistM=Math.hypot(actor.x-camera.x,actor.z-camera.z)
    const playerDistM=officerPos?Math.hypot(actor.x-officerPos.x,actor.z-officerPos.z):cameraDistM
    cb({
      type,
      actor,
      actorId:ensureActorId(actor),
      kind:actor.kind,
      pos:{x:actor.x,y:actor.y,z:actor.z},
      bridgeEndDistM:hl?hl.bridgeEndDistance(actor):0,
      playerDistM,
      cameraDistM,
      inFrustum:Boolean(visible?.(actor)),
      time:this.time,
    })
  }
  private trySpawnFromPool(
    pool:{candidates:{track:Track,min:number,max:number,end:number}[],availableLength:number},
    kind:Actor['kind'],
    camera:Position,
    hiddenCheck:(point:Position)=>boolean,
    spawnStreet?:string,
    dutyWeighted=false,
    overrideWeights?:DutyViolationWeights,
    ignoreExternalExclusion=false,
    visible?:(point:Position)=>boolean,
    approachPref?:{attempt:number,otherMotor?:Actor},
  ):Actor|null{
    const {candidates,availableLength}=pool
    if(!candidates.length||availableLength<=0)return null
    const walk=kind==='person',scooter=kind==='scooter'
    const hl=dutyWeighted?this.dutyConfig.hiddenLifecycle:undefined
    const sampleTrackForPick=candidates[Math.floor(this.random()*candidates.length)].track
    const allowWrongWay=!walk&&scooter
    const mx=(sampleTrackForPick.start.x+sampleTrackForPick.end.x)*.5,mz=(sampleTrackForPick.start.z+sampleTrackForPick.end.z)*.5
    const nearModShop=(mx-SHIZIJIE_MOD_SHOP.x)**2+(mz-SHIZIJIE_MOD_SHOP.z)**2<140**2
    const approachingSignal=this.signal.has(sampleTrackForPick.to)
    const rawProfile=scooter
      ?pickTwoWheelProfile(this.random,overrideWeights??this.dutyConfig.weights,dutyWeighted||this.dutyConfig.active,{allowWrongWay,nearModShop,approachingSignal})
      :undefined
    const profile=rawProfile&&rawProfile.violation!=='none'&&!this.canSpawnViolator()
      ?{...rawProfile,violation:'none' as const,violations:[] as ActiveTrafficViolation[]}
      :rawProfile
    const wrongWay=Boolean(profile?.violation==='wrong_way'&&allowWrongWay)
    let picked:{track:Track,min:number,max:number}|undefined
    if(hl?.canSpawnOnTrack){
      const eligible:{track:Track,min:number,max:number,len:number}[]=[]
      for(const c of candidates){
        if(!hl.canSpawnOnTrack(c.track,wrongWay))continue
        eligible.push({track:c.track,min:c.min,max:c.max,len:c.max-c.min})
      }
      if(!eligible.length)return null
      let chosenPool=eligible
      // Balance bidirectional inflow so blocking one lane never starves opposite-direction traffic.
      const refTrack=eligible[0].track
      const refSign=wrongWay?-1:1
      const refDx=refTrack.dx*refSign,refDz=refTrack.dz*refSign
      const groupA:typeof eligible=[],groupB:typeof eligible=[]
      for(const c of eligible){
        const sign=wrongWay?-1:1
        const dot=c.track.dx*sign*refDx+c.track.dz*sign*refDz
        if(dot>=0)groupA.push(c)
        else groupB.push(c)
      }
      if(groupA.length&&groupB.length){
        let cntA=0,cntB=0
        for(const other of this.actors){
          if(other.leaving||other.pendingRecycle||other.kind!==kind)continue
          const oSign=other.wrongWay?-1:1
          const dot=other.track.dx*oSign*refDx+other.track.dz*oSign*refDz
          if(dot>=0)cntA++
          else cntB++
        }
        if(cntA!==cntB&&this.random()<.85){
          chosenPool=cntA<cntB?groupA:groupB
        }
      }
      let totalLen=0
      for(const c of chosenPool)totalLen+=c.len
      if(totalLen<=0)return null
      let metre=this.random()*totalLen
      picked=chosenPool[chosenPool.length-1]
      for(const c of chosenPool){
        metre-=c.len
        if(metre<=0){picked=c;break}
      }
    }else{
      const metre=this.random()*availableLength
      picked=candidates.find(candidate=>candidate.end>metre)??candidates[candidates.length-1]
    }
    const {track,min,max}=picked
    const finalWrongWay=Boolean(wrongWay&&!track.walk&&track.kind==='nonmotor')
    const cruiseSpeed=hl
      ?Math.min(track.speedKmh/3.6,kind==='car'?9.5:6.2)
      :0
    const actor:Actor={
      id:`actor_${nextActorUid++}`,
      track,
      dist:min+this.random()*(max-min),
      speed:cruiseSpeed,
      kind,
      down:0,
      dodge:0,
      x:0,
      y:0,
      z:0,
      yaw:0,
      scale:hl?1:0,
      leaving:false,
      halfWidth:walk||scooter?.3:.9*CAR_SCALE,
      halfLength:walk?.3:scooter?.85:2.1*CAR_SCALE,
      height:1.5,
      ...(profile?{
        violation:profile.violation,
        violations:[...profile.violations],
        vehicleSubtype:profile.vehicleSubtype,
        cited:false,
        dutyState:'normal' as const,
        ...(finalWrongWay?{wrongWay:true}:{}),
        ...(profile.violation==='red_light_run'?{redLightActive:false}:{}),
      }:{}),
      ...(spawnStreet?{spawnStreet}:{}),
    }
    this.position(actor)
    if(!walk&&!hl&&approachPref&&approachPref.attempt<18){
      const approach=(camera.x-actor.x)*track.dx+(camera.z-actor.z)*track.dz
      if(approach<10||approach>150)return null
      if(approachPref.attempt<10&&approachPref.otherMotor&&track.dx*approachPref.otherMotor.track.dx+track.dz*approachPref.otherMotor.track.dz>.5)return null
    }
    if(!ignoreExternalExclusion&&this.externalExclusion){
      const ex=this.externalExclusion
      if((actor.x-ex.center.x)**2+(actor.z-ex.center.z)**2<=ex.radius**2)return null
    }
    if(hl){
      const gate=this.evalHiddenGate(actor,camera,visible,hl)
      if(!gate.allowed){
        if(gate.bridgeEndDistM>=hl.minBridgeEndDistM)this.deferredSpawnCount++
        return null
      }
    }else if(!hiddenCheck(actor)){
      return null
    }
    const minSpacing=walk?.5:hl?14:5
    if(this.actors.some(other=>distanceSq(other,actor)<minSpacing**2))return null
    if(hl&&!walk){
      const headway=kind==='car'?(hl.minCarHeadwayM??34):(hl.minScooterHeadwayM??36)
      if(headway>minSpacing){
        const headwaySq=headway*headway
        const aDirX=finalWrongWay?-track.dx:track.dx
        const aDirZ=finalWrongWay?-track.dz:track.dz
        for(const other of this.actors){
          if(other.leaving||other.pendingRecycle||other.kind!==kind)continue
          const oDirX=other.wrongWay?-other.track.dx:other.track.dx
          const oDirZ=other.wrongWay?-other.track.dz:other.track.dz
          if(aDirX*oDirX+aDirZ*oDirZ<=0.5)continue
          if(distanceSq(other,actor)<headwaySq)return null
        }
      }
    }
    if(!walk&&nearStatic(actor.x,actor.z)&&resolveContact(actor,actor.y,actor.yaw,actor.halfWidth,actor.halfLength,staticSolids))return null
    actorOwners.set(actor,this)
    this.actors.push(actor)
    this.emitLifecycle('spawn',actor,camera,visible)
    return actor
  }
  private getDutyTracks(cx:number,cz:number,radius:number):{nonmotor:Track[],motor:Track[]}{
    const key=`${cx.toFixed(2)},${cz.toFixed(2)},${radius.toFixed(1)}`
    const cached=this.dutyTracksCache.get(key)
    if(cached)return cached
    const rSq=radius**2
    const bridgeNm:Track[]=[],realNm:Track[]=[],virtNm:Track[]=[]
    const bridgeMotor:Track[]=[],otherMotor:Track[]=[]
    for(const list of this.exits.values())for(const t of list){
      if(t.walk)continue
      const mx=(t.start.x+t.end.x)*.5,mz=(t.start.z+t.end.z)*.5
      if((mx-cx)**2+(mz-cz)**2>rSq)continue
      if(t.kind==='nonmotor'){
        if(!t.virtual){
          if(t.gradeSeparated==='jiefang')bridgeNm.push(t)
          else realNm.push(t)
        }else virtNm.push(t)
      }else if(t.kind==='motor'){
        if(t.gradeSeparated==='jiefang')bridgeMotor.push(t)
        else otherMotor.push(t)
      }
    }
    const motor=bridgeMotor.length?[...bridgeMotor,...otherMotor]:otherMotor
    const nonmotor=bridgeNm.length
      ?[...bridgeNm,...realNm,...virtNm]
      :realNm.length?[...realNm,...virtNm]:virtNm.length?virtNm:(this.dutyConfig.dutyOnly?[]:motor)
    const result={nonmotor,motor}
    this.dutyTracksCache.set(key,result)
    return result
  }
  private stepDutySpawns(camera:Position,visible:((point:Position)=>boolean)|undefined,budget:number,warm=false):number{
    if(!this.dutyConfig.active||budget<=0||this.actors.length>=this.actorLimit)return budget
    const zones:readonly DutyZoneConfig[]=this.dutyConfig.zones?.length
      ?this.dutyConfig.zones
      :[{
        center:this.dutyConfig.center??DEFAULT_DUTY_CENTER,
        radius:this.dutyConfig.radius??DEFAULT_DUTY_RADIUS,
        weights:this.dutyConfig.weights,
        desiredCars:this.dutyConfig.desiredCars,
        desiredScooters:this.dutyConfig.desiredScooters,
      }]
    const dutyOnly=Boolean(this.dutyConfig.dutyOnly)
    const dutyHidden=(point:Position)=>{
      if(warm||!visible)return true
      const radial=(point.x-camera.x)**2+(point.z-camera.z)**2
      if(dutyOnly)return radial>22**2&&(!visible(point)||radial>55**2)
      return radial>VISIBLE_SPAWN_MIN**2||(radial>18**2&&!visible(point))
    }
    const hl=this.dutyConfig.hiddenLifecycle
    const defaultScooters=Math.min(10,Math.max(4,Math.floor(this.actorLimit*.1)))
    for(const zone of zones){
      if(budget<=0||this.actors.length>=this.actorLimit)break
      const {center,radius}=zone
      const corridorRadius=hl?Math.max(radius+160,420):radius
      if(Math.hypot(camera.x-center.x,camera.z-center.z)>corridorRadius+160)continue
      const {nonmotor,motor}=this.getDutyTracks(center.x,center.z,corridorRadius)
      const rSq=corridorRadius**2
      let existingScooters=0,existingCars=0
      for(const actor of this.actors){
        if(actor.leaving||actor.pendingRecycle)continue
        if((actor.x-center.x)**2+(actor.z-center.z)**2>rSq)continue
        if(actor.kind==='scooter')existingScooters++
        else if(actor.kind==='car')existingCars++
      }
      const desiredScooters=zone.desiredScooters??this.dutyConfig.desiredScooters??defaultScooters
      const desiredCars=zone.desiredCars??this.dutyConfig.desiredCars??(dutyOnly?8:0)
      const spawnCenter=dutyOnly?{x:center.x,y:camera.y,z:center.z}:camera
      const searchR=hl?Math.max(corridorRadius+40,460):dutyOnly?Math.max(240,radius+20):200
      if(desiredCars>0&&existingCars<desiredCars&&motor.length&&budget>0&&this.actors.length<this.actorLimit){
        const carPool=this.collectCandidates(motor,spawnCenter,searchR)
        for(let attempt=0;attempt<28&&existingCars<desiredCars&&budget>0&&this.actors.length<this.actorLimit;attempt++){
          if(this.trySpawnFromPool(carPool,'car',camera,dutyHidden,undefined,true,undefined,true,visible)){
            existingCars++;budget--
          }
        }
      }
      if(existingScooters<desiredScooters&&nonmotor.length){
        const pool=this.collectCandidates(nonmotor,spawnCenter,searchR)
        for(let attempt=0;attempt<28&&existingScooters<desiredScooters&&budget>0&&this.actors.length<this.actorLimit;attempt++){
          if(this.trySpawnFromPool(pool,'scooter',camera,dutyHidden,undefined,true,zone.weights??this.dutyConfig.weights,true,visible)){
            existingScooters++;budget--
          }
        }
      }
    }
    return budget
  }
  step(dt:number,camera:Position,vehicle?:Position,visible?:(point:Position)=>boolean,profile?:(spawn:number,grid:number,motion:number)=>void){
    if(!this.dutyConfig.dutyOnly)latestTrafficRef=new WeakRef(this)
    else if(!latestTrafficRef?.deref())latestTrafficRef=new WeakRef(this)
    const start=profile?performance.now():0
    this.time+=dt
    this.syncCitedViolatorCooldown()
    if(this.dutyOfficer?.active){
      const op=this.dutyOfficer.pos
      if(this.prevOfficerPos&&dt>0){
        const moved=Math.hypot(op.x-this.prevOfficerPos.x,op.z-this.prevOfficerPos.z)
        this.officerSpeed=moved>8?0:moved/dt
      }else{
        this.officerSpeed=0
      }
      this.prevOfficerPos={x:op.x,y:op.y,z:op.z}
    }else{
      this.prevOfficerPos=undefined
      this.officerSpeed=0
    }
    if(!this.lastCamera||Math.hypot(camera.x-this.lastCamera.x,camera.z-this.lastCamera.z)>TELEPORT)this.warmUntil=this.time+WARMUP_S
    this.lastCamera={x:camera.x,y:camera.y,z:camera.z}
    const warm=this.time<this.warmUntil
    const dutyOnly=Boolean(this.dutyConfig.active&&this.dutyConfig.dutyOnly)
    const hl=this.dutyConfig.hiddenLifecycle
    // IDOK-236: also never materialise a car on top of the camera/player (the frustum test says "not visible" there).
    const hiddenSpawn=(point:Position)=>{
      if(warm||!visible)return true
      const radial=(point.x-camera.x)**2+(point.z-camera.z)**2
      return radial>VISIBLE_SPAWN_MIN**2||radial>15**2&&!visible(point)
    }
    const kept:Actor[]=[]
    if(dutyOnly){
      const zCenter=this.dutyConfig.zones?.[0]?.center??this.dutyConfig.center??DEFAULT_DUTY_CENTER
      const zRad=(this.dutyConfig.zones?.[0]?.radius??this.dutyConfig.radius??DEFAULT_DUTY_RADIUS)+(hl?280:90)
      for(const actor of this.actors){
        const outOfRange=(actor.x-zCenter.x)**2+(actor.z-zCenter.z)**2>zRad**2&&(actor.x-camera.x)**2+(actor.z-camera.z)**2>(hl?340:200)**2
        if(hl){
          if(actor.pendingRecycle||outOfRange||actor.leaving){
            const gate=this.evalHiddenGate(actor,camera,visible,hl)
            if(gate.allowed){
              this.emitLifecycle('despawn',actor,camera,visible)
              continue
            }
            actor.pendingRecycle=true
            actor.leaving=false
            this.deferredDespawnCount++
          }
          kept.push(actor)
        }else{
          if((!actor.leaving||actor.scale>0)&&!outOfRange)kept.push(actor)
          else this.emitLifecycle('despawn',actor,camera,visible)
        }
      }
    }else{
      for(const actor of this.actors){
        if((!actor.leaving||actor.scale>0)&&(actor.x-camera.x)**2+(actor.z-camera.z)**2<=200**2)kept.push(actor)
        else this.emitLifecycle('despawn',actor,camera,visible)
      }
    }
    this.actors=kept
    const counts=new Map<string,number>()
    for(const actor of this.actors){const key=(actor.spawnStreet??actor.track.street)+':'+actor.track.walk;counts.set(key,(counts.get(key)??0)+1)}
    let budget=hl?2:(warm?48:8)
    if(!dutyOnly){
      const scooterShare=this.dutyConfig.active?(this.dutyConfig.twoWheelShare??.52):.36
      for(const [street,group] of this.sites(camera))for(const walk of [false,true]){
        const key=street+':'+walk,existing=counts.get(key)??0
        const low=walk?this.rules.personMin:this.rules.carMin,high=walk?this.rules.personMax:this.rules.carMax
        const desired=this.actorLimit===MOBILE_ACTORS?low:Math.ceil((low+high)/2)
        if(existing>=desired||budget<=0)continue
        if(walk){
          if(!group.walk.length)continue
          const walkPool=this.collectCandidates(group.walk,camera)
          for(let count=existing,attempt=0;walkPool.candidates.length&&count<desired&&attempt<24&&budget>0&&this.actors.length<this.actorLimit;attempt++){
            if(this.trySpawnFromPool(walkPool,'person',camera,hiddenSpawn)){count++;budget--}
          }
          continue
        }
        if(!group.motor.length)continue
        const motorPool=this.collectCandidates(group.motor,camera)
        if(!motorPool.candidates.length)continue
        const otherMotor=this.actors.find(actor=>!actor.track.walk&&!actor.leaving&&actor.track.street===street)
        let virtualPool:ReturnType<Traffic['collectCandidates']>|undefined
        let realNmPool:ReturnType<Traffic['collectCandidates']>|undefined
        for(let count=existing,attempt=0;count<desired&&attempt<24&&budget>0&&this.actors.length<this.actorLimit;attempt++){
          const pref={attempt,otherMotor}
          const scooter=this.actors.filter(other=>other.kind==='scooter').length<Math.round((1+this.actors.filter(other=>other.kind!=='person').length)*scooterShare)
          if(!scooter){
            if(this.trySpawnFromPool(motorPool,'car',camera,hiddenSpawn,undefined,false,undefined,false,visible,pref)){count++;budget--}
            continue
          }
          if(realNmPool===undefined&&this.nearbyRealNonmotor.length){
            const localNm=this.nearbyRealNonmotor.filter(t=>pointToSegmentDistSq(camera.x,camera.z,t.start.x,t.start.z,t.end.x,t.end.z)<=180**2)
            realNmPool=this.collectCandidates(localNm,camera)
          }
          if(realNmPool?.candidates.length&&this.trySpawnFromPool(realNmPool,'scooter',camera,hiddenSpawn,street,false,undefined,false,visible,pref)){count++;budget--;continue}
          if(virtualPool===undefined)virtualPool=this.collectCandidates(group.virtualNonmotor,camera)
          if(virtualPool.candidates.length&&this.trySpawnFromPool(virtualPool,'scooter',camera,hiddenSpawn,street,false,undefined,false,visible,pref)){count++;budget--;continue}
          if(this.trySpawnFromPool(motorPool,'scooter',camera,hiddenSpawn,street,false,undefined,false,visible,pref)){count++;budget--}
        }
      }
    }
    if(this.dutyConfig.active)budget=this.stepDutySpawns(camera,visible,budget,warm)
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
    this.advanceActors(dt,camera,visible)
    profile?.(spawned-start,gridded-spawned,performance.now()-gridded)
  }
  private advanceActors(dt:number,camera:Position,visible?:(point:Position)=>boolean){
    const decay=Math.exp(-dt*1.2)
    const hl=this.dutyConfig.hiddenLifecycle
    for(const actor of this.actors)this.advanceActor(actor,dt,decay,camera,visible)
    if(this.time>=this.checkWaitsAt){
      this.checkWaitsAt=this.time+1
      const visited=new Set<Actor>()
      for(const start of this.actors){
        if(!start.waitingFor||visited.has(start))continue
        const chain=new Set<Actor>()
        let actor:Actor|undefined=start
        while(actor?.waitingFor&&!actor.leaving&&this.time-(actor.waitingSince??this.time)>=6){
          if(chain.has(actor)){
            if(hl){
              for(const member of chain){
                member.ghostPassUntil=this.time+4.0
                member.waitingFor=undefined
                member.waitingSince=undefined
              }
            }
            else actor.leaving=true
            break
          }
          if(visited.has(actor))break
          visited.add(actor);chain.add(actor);actor=actor.waitingFor
        }
      }
      const starved=this.actors.find(actor=>actor.kind!=='person'&&!actor.leaving&&actor.waitingFor&&
        actor.waitingFor.waitingSince===undefined&&!actor.waitingFor.leaving&&this.green(actor.track)&&
        this.time-(actor.waitingSince??this.time)>=18)
      if(starved){
        if(hl){starved.ghostPassUntil=this.time+4.0;starved.waitingFor=undefined;starved.waitingSince=undefined}
        else starved.leaving=true
      }
    }
    if(hl){
      const survivors:Actor[]=[]
      for(const actor of this.actors){
        if(!Number.isFinite(actor.y))continue
        if(actor.pendingRecycle){
          const gate=this.evalHiddenGate(actor,camera,visible,hl)
          if(gate.allowed){
            this.emitLifecycle('despawn',actor,camera,visible)
            continue
          }
          this.deferredDespawnCount++
        }
        survivors.push(actor)
      }
      this.actors=survivors
    }else{
      this.actors=this.actors.filter(actor=>Number.isFinite(actor.y))
    }
  }
  private advanceActor(actor:Actor,dt:number,decay:number,camera:Position,visible?:(point:Position)=>boolean){
      const obstacles=this.obstacles
      let {track}=actor;const person=actor.kind==='person'
      const previousBlocker=actor.waitingFor
      actor.waitingFor=undefined
      if(actor.pendingRecycle){
        const spd=Math.max(4.5,actor.recycleSpeed??6)
        const hx=actor.recycleHeadingX??(actor.wrongWay?-track.dx:track.dx)
        const hz=actor.recycleHeadingZ??(actor.wrongWay?-track.dz:track.dz)
        actor.x+=hx*spd*dt
        actor.z+=hz*spd*dt
        actor.speed=spd
        actor.scale=1
        return
      }
      if(actor.leaving){actor.scale=Math.max(0,actor.scale-dt/.4);return}
      if(person&&track.surfaceState==='pending'&&this.surfaceAt){
        if(!this.resolveWalkSurface(track)){actor.leaving=true;return}
      }
      if(!person&&this.parkingHits(track).some(hit=>hit.dist>=actor.dist-2&&hit.dist<actor.dist+28)){
        const options=this.adjacent(track),next=options.find(lane=>!this.actors.some(other=>other!==actor&&other.track===lane&&Math.abs(other.dist-actor.dist)<10))
        if(next){actor.dodge+=track.offset-next.offset;actor.track=track=next}
        else if(!options.length&&!visible?.(actor)&&!this.dutyConfig.hiddenLifecycle){actor.leaving=true;return}
      }
      actor.scale=Math.min(1,actor.scale+dt/.4)
      ensureActorId(actor)
      // Update ticket-receive right-arm reach animation progress
      if(actor.ticketReceiveAnimUntil!==undefined){
        const dur=actor.ticketReceiveAnimDuration??1.15
        const startAt=actor.ticketReceiveAnimUntil-dur
        if(this.time<actor.ticketReceiveAnimUntil){
          actor.ticketReceiveAnimActive=true
          actor.ticketReceiveAnimElapsed=Math.max(0,this.time-startAt)
        }else{
          actor.ticketReceiveAnimActive=false
          actor.ticketReceiveAnimElapsed=dur
          actor.ticketReceiveAnimUntil=undefined
        }
      }
      // Flag/whistle smooth pull-over state machine: blinker on -> decelerate -> steer to ±15.2m outer curb -> full stop
      if(actor.dutyState==='pulling_over'){
        actor.blinker='right'
        actor.brakingForOfficer=true
        const targetDodge=actor.pullOverTargetDodge??1.1
        const diff=targetDodge-actor.dodge
        const maxLateralStep=2.8*dt
        actor.dodge+=Math.abs(diff)<=maxLateralStep?diff:Math.sign(diff)*maxLateralStep
        const nextSpeed=Math.max(0,actor.speed-4.8*dt)
        const stepDist=nextSpeed*dt
        const rev=Boolean(actor.wrongWay)
        if(rev)actor.dist=Math.max(0,actor.dist-stepDist)
        else actor.dist=Math.min(track.length,actor.dist+stepDist)
        actor.speed=nextSpeed
        this.position(actor)
        if(actor.speed<=0.08&&Math.abs(targetDodge-actor.dodge)<=0.06){
          actor.dodge=targetDodge
          actor.speed=0
          this.position(actor)
          actor.dutyState='pulled_over'
          actor.haltedByDuty=true
          actor.brakingForOfficer=false
          actor.lookAtOfficer=true
          this.stopActor(actor,actor.pullOverStopDurationSec??45)
          if(!actor.pullOverNotified){
            actor.pullOverNotified=true
            const localZ=actor.pullOverTargetLocalZ??null
            this.onViolatorPulledOver?.({
              actor,
              actorId:ensureActorId(actor),
              pos:{x:actor.x,y:actor.y,z:actor.z},
              localZ,
              side:localZ===null?'unknown':localZ<0?'north':'south',
              time:this.time,
            })
          }
        }
        return
      }
      if((actor.holdUntil&&actor.holdUntil>performance.now())||(actor.stoppedUntil!==undefined&&actor.stoppedUntil>this.time)){
        actor.speed=0
        if(actor.dutyState==='pulled_over'||actor.dutyState==='halted')actor.lookAtOfficer=true
        return
      }
      if(actor.stoppedUntil!==undefined&&actor.stoppedUntil<=this.time){
        actor.stoppedUntil=undefined
        if(actor.haltedByDuty){
          actor.haltedByDuty=false
          actor.blinker='none'
          actor.lookAtOfficer=false
          actor.pullOverTargetDodge=undefined
          actor.dutyState='normal'
        }
      }
      const reverse=Boolean(actor.wrongWay)
      let dirX=reverse?-track.dx:track.dx,dirZ=reverse?-track.dz:track.dz
      let maxSpeed=(person?(actor.pace??=1.1+.6*this.random()):Math.min(track.speedKmh/3.6,actor.kind==='car'?12:7))
      let accelRate=2
      actor.brakingForOfficer=false
      actor.honkingForOfficer=false
      const officerCtx=this.dutyOfficer?.active?this.dutyOfficer:undefined
      const officer=officerCtx?.pos
      const officerZone:DutyCrossSectionZone|undefined=officer
        ?(officerCtx?.zone??this.dutyConfig.classifyOfficerZone?.(officer))
        :undefined
      const officerInSafeZone=officerZone==='sidewalk'||officerZone==='nonmotor'||officerZone==='off_bridge'
      const officerRunning=officerCtx?.running===true||(officerCtx?.running===undefined&&this.officerSpeed>=3.4)
      const officerWalkingCalmly=officerCtx?.running===false||(officerCtx?.running===undefined&&this.officerSpeed>=0.25&&this.officerSpeed<3.4)
      // Violator evasion: when spotting auxiliary police within 8..15m, accelerate to flee or change lane.
      if(!person&&officer&&actor.kind==='scooter'&&!actor.cited&&!actor.haltedByDuty&&actor.violation&&actor.violation!=='none'){
        const odx=officer.x-actor.x,odz=officer.z-actor.z,ody=Math.abs(officer.y-actor.y)
        const odist=Math.hypot(odx,odz)
        const oahead=odx*dirX+odz*dirZ
        const inSpottingBand=ody<=3&&odist>=4&&odist<=15&&(odist>=8||oahead>-1.5)
        if(inSpottingBand&&actor.dutyState!=='fleeing'&&actor.dutyState!=='evading'){
          actor.fleeUntil=this.time+6
          const options=this.adjacent(track).filter(lane=>!this.actors.some(other=>other!==actor&&other.track===lane&&Math.abs(other.dist-actor.dist)<8))
          let switched=false
          if(options.length){
            let bestLane:Track|undefined,bestDistSq=-1
            for(const lane of options){
              const lx=lane.start.x+lane.dx*actor.dist-lane.dz*lane.offset
              const lz=lane.start.z+lane.dz*actor.dist+lane.dx*lane.offset
              const dSq=(lx-officer.x)**2+(lz-officer.z)**2
              if(dSq>bestDistSq){bestDistSq=dSq;bestLane=lane}
            }
            if(bestLane){
              actor.dodge+=track.offset-bestLane.offset
              actor.track=track=bestLane
              dirX=reverse?-track.dx:track.dx;dirZ=reverse?-track.dz:track.dz
              actor.dutyState='evading'
              switched=true
            }
          }
          if(!switched){
            actor.dutyState='fleeing'
            if(!reverse){
              const side=odz*dirX-odx*dirZ
              const maxDodgeBound=track.gradeSeparated==='jiefang'?.6:.85
              actor.dodge=Math.max(-maxDodgeBound,Math.min(maxDodgeBound,actor.dodge-Math.sign(side||1)*.6))
            }
          }
        }
        if(actor.fleeUntil!==undefined){
          if(this.time<actor.fleeUntil){
            maxSpeed*=1.55
            accelRate=5.5
          }else{
            actor.fleeUntil=undefined
            if(actor.dutyState==='fleeing'||actor.dutyState==='evading')actor.dutyState='normal'
          }
        }else if(actor.fleeUntil!==undefined){
          actor.fleeUntil=undefined
          if(actor.dutyState==='fleeing'||actor.dutyState==='evading')actor.dutyState='normal'
        }
      }
      // Post-ticket slow departure for 3 seconds before resuming normal speed
      if(actor.postTicketSlowUntil!==undefined){
        if(this.time<actor.postTicketSlowUntil){
          maxSpeed=Math.min(maxSpeed,POST_TICKET_SLOW_MAX_SPEED_MS)
          accelRate=1.6
          actor.dutyState='leaving_with_ticket'
        }else{
          actor.postTicketSlowUntil=undefined
          if(actor.dutyState==='leaving_with_ticket')actor.dutyState='normal'
        }
      }
      // Whistle warning slowdown for non-fleeing violators
      if(actor.whistleSlowUntil!==undefined){
        if(this.time<actor.whistleSlowUntil){
          maxSpeed*=0.55
          actor.brakingForOfficer=true
        }else{
          actor.whistleSlowUntil=undefined
        }
      }
      // Duty-mode honk-first -> decelerate -> gentle-hit logic (and anti-clip yield for fleeing scooters).
      let desiredSpeed=Math.min(maxSpeed,actor.speed+dt*accelRate)
      if(!person&&officer&&actor.kind==='scooter'&&(actor.dutyState==='fleeing'||actor.dutyState==='evading')){
        const odx=officer.x-actor.x,odz=officer.z-actor.z,ody=Math.abs(officer.y-actor.y)
        const oahead=odx*dirX+odz*dirZ,olateral=Math.abs(odx*dirZ-odz*dirX)
        if(ody<=2.5&&oahead>0&&oahead<7.5&&olateral<actor.halfWidth+0.85){
          const side=odz*dirX-odx*dirZ
          const maxDodgeBound=track.gradeSeparated==='jiefang'?.6:.85
          actor.dodge=Math.max(-maxDodgeBound,Math.min(maxDodgeBound,actor.dodge-Math.sign(side||1)*dt*2.2))
          if(oahead<4.2&&olateral<actor.halfWidth+0.62){
            const yieldCap=oahead<=1.8?0:maxSpeed*Math.max(0,(oahead-1.8)/2.4)
            actor.brakingForOfficer=true
            desiredSpeed=actor.speed>yieldCap?Math.max(yieldCap,actor.speed-9.5*dt):Math.min(yieldCap,desiredSpeed)
          }
        }
      }
      if(!person&&officer&&actor.dutyState!=='fleeing'&&actor.dutyState!=='evading'){
        const odx=officer.x-actor.x,odz=officer.z-actor.z,ody=Math.abs(officer.y-actor.y)
        const oahead=odx*dirX+odz*dirZ,olateral=Math.abs(odx*dirZ-odz*dirX)
        const inCarLane=actor.kind==='car'&&!officerInSafeZone&&ody<=2.5&&oahead>-1&&oahead<=HORN_WARN_DIST_M&&olateral<actor.halfWidth+1.1
        if(inCarLane){
          // Stage 1: Honk warning before braking hard
          if(oahead>0&&oahead<=HORN_WARN_DIST_M){
            actor.honkingForOfficer=true
            if(actor.officerWarningSince===undefined)actor.officerWarningSince=this.time
            if(actor.lastHornAt===undefined||this.time-actor.lastHornAt>=1.5){
              actor.lastHornAt=this.time
              actor.hornCount=(actor.hornCount??0)+1
              this.onPlayerHorn?.({actor,dist:oahead,speed:actor.speed,time:this.time})
            }
          }
          // Stage 2: Decelerate aggressively after horn; full-stop for calm walking, cap <= 25 km/h if ignoring horn / running
          if(oahead>0&&oahead<=BRAKE_START_DIST_M){
            actor.brakingForOfficer=true
            const warnElapsed=actor.officerWarningSince!==undefined?this.time-actor.officerWarningSince:0
            const ignoringHorn=warnElapsed>=HORN_IGNORE_GRACE_S||oahead<=5.5
            const vulnerable=officerRunning||(!officerWalkingCalmly&&ignoringHorn)
            let cautionCap:number
            let brakeRate:number
            if(!vulnerable){
              cautionCap=oahead<=3.6?0:Math.min(MAX_PLAYER_HIT_SPEED_MS,(oahead-3.5)*0.8)
              brakeRate=9.0
            }else{
              const hitCap=Math.min(maxSpeed,MAX_PLAYER_HIT_SPEED_MS)
              const t=Math.min(1,Math.max(0,(oahead-4)/(BRAKE_START_DIST_M-4)))
              cautionCap=Math.min(hitCap,4.6+(hitCap-4.6)*t)
              brakeRate=oahead<=6?14.0:8.0
            }
            desiredSpeed=actor.speed>cautionCap
              ?Math.max(cautionCap,actor.speed-brakeRate*dt)
              :Math.min(cautionCap,actor.speed+dt*accelRate)
          }
        }else{
          if(oahead<=-2||olateral>actor.halfWidth+1.8)actor.officerWarningSince=undefined
          if(ody<=2.5&&oahead>-1&&oahead<26&&olateral<6.5){
            let cautionCap=maxSpeed
            if(actor.kind==='scooter'&&olateral<actor.halfWidth+1.0&&oahead>0&&oahead<10){
              cautionCap=oahead<=2.4?0:maxSpeed*Math.max(0,(oahead-2.2)/8)
            }else if(olateral<actor.halfWidth+1.1&&oahead>0&&oahead<14){
              cautionCap=maxSpeed*Math.max(0,(oahead-2.5)/14)
            }else{
              const t=Math.min(1,Math.max(0,(oahead-2)/24))
              cautionCap=maxSpeed*(.42+.58*t)
            }
            if(cautionCap<maxSpeed){
              actor.brakingForOfficer=true
              const brakeRate=actor.kind==='car'?5.5:7.5
              desiredSpeed=actor.speed>cautionCap
                ?Math.max(cautionCap,actor.speed-brakeRate*dt)
                :Math.min(cautionCap,actor.speed+dt*accelRate)
            }
          }
        }
      }
      let advance=desiredSpeed*dt
      if(actor.down>0){actor.down-=dt;actor.waitingFor=previousBlocker;return}
      if(actor.arrived){if(!visible?.(actor))actor.leaving=true;return}
      let keepRight=false,passLeft=false
      const safeMinDodge=person?(track.dodgeMin??-WALK_OFFSET):-WALK_OFFSET
      const safeMaxDodge=person?(track.dodgeMax??WALK_OFFSET):WALK_OFFSET
      let minDodge=safeMinDodge,maxDodge=safeMaxDodge
      const previousX=actor.x,previousZ=actor.z
      if(!person&&actor.dutyState!=='fleeing'&&actor.dutyState!=='halted'&&actor.dutyState!=='pulled_over')actor.dodge*=decay
      const left=Math.floor((actor.x-7)/16),right=Math.floor((actor.x+7)/16),top=Math.floor((actor.z-7)/16),bottom=Math.floor((actor.z+7)/16)
      let crossTrafficBlocked=false
      nearby:for(let col=left;col<=right;col++)for(let row=top;row<=bottom;row++){
        const bin=obstacles.get(col*65536+row)
        if(!bin)continue
        for(let index=0;index<bin.length;index++){
        const other=bin[index]
        if(other===actor||Math.abs(other.y-actor.y)>2)continue
        const dx=other.x-actor.x,dz=other.z-actor.z
        if(Math.abs(dx)>7||Math.abs(dz)>7)continue
        const ahead=dx*dirX+dz*dirZ,lateral=Math.abs(dx*dirZ-dz*dirX)
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
        }else{
          const otherIsCar='kind' in other&&other.kind==='car'
          if(actor.violation==='red_light_run'&&otherIsCar&&ahead>0&&ahead<4.2&&lateral<2.5){
            crossTrafficBlocked=true
          }
          const oppositeScooters=actor.kind==='scooter'&&'kind' in other&&other.kind==='scooter'&&Boolean(other.wrongWay)!==reverse
          const minLat=oppositeScooters?.42:(actor.kind==='scooter'||('kind' in other&&other.kind==='scooter'))?(actor.kind==='car'||otherIsCar?1.25:.95):1.8
          const ghostActive=actor.ghostPassUntil!==undefined&&this.time<actor.ghostPassUntil
          const headOnStuck='kind' in other&&Boolean(other.wrongWay)!==reverse&&actor.waitingSince!==undefined&&this.time-actor.waitingSince>=4
          if(!ghostActive&&!headOnStuck&&ahead>0&&lateral<minLat){
            const stopGap=actor.kind==='scooter'&&!otherIsCar?2.8:5
            advance=Math.min(advance,Math.max(0,ahead-stopGap))
            if(advance<1e-6&&'kind' in other)actor.waitingFor=other
            if(!advance)break nearby
          }
        }
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
      if(!person&&!reverse&&this.junctions.has(track.to)&&track.length-actor.dist<9){
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
      const sigPhase=!person&&!reverse&&this.signal.has(track.to)?this.phase(track):'green'
      const distToLine=Math.max(0,track.length-actor.dist)
      const runningRed=actor.kind==='scooter'&&!reverse&&actor.violation==='red_light_run'&&!actor.cited&&this.signal.has(track.to)&&sigPhase==='red'&&!crossTrafficBlocked
      if(!person&&!reverse&&sigPhase!=='green'){
        if(runningRed){
          if(distToLine<=6)actor.redLightActive=true
        }else{
          const gap=Math.max(0,track.length-actor.dist-1)
          if(advance>gap)this.stopped++
          advance=Math.min(advance,gap)
        }
      }
      if(actor.violation==='red_light_run'){
        if(actor.cited){
          actor.redLightActive=false
          actor.redLightTrailDist=undefined
        }else if(actor.redLightTrailDist!==undefined){
          actor.redLightTrailDist+=advance
          if(actor.redLightTrailDist>14){
            actor.redLightActive=false
            actor.redLightTrailDist=undefined
          }
        }else if(!runningRed||distToLine>6){
          actor.redLightActive=false
        }
      }
      if(advance>=dt*.05)actor.waitingSince=undefined
      else actor.waitingSince??=this.time
      actor.speed=advance/dt
      if(reverse)actor.dist-=advance
      else actor.dist+=advance
      if(!person&&advance>0&&nearStatic(actor.x+dirX*advance,actor.z+dirZ*advance)){
        const offset=track.offset+actor.dodge+(reverse?WRONG_WAY_LATERAL_OFFSET:0)
        const next={x:track.start.x+track.dx*actor.dist-track.dz*offset,y:actor.y,z:track.start.z+track.dz*actor.dist+track.dx*offset}
        const yaw=reverse?Math.atan2(-track.dx,-track.dz):track.yaw
        if(resolveContact(next,next.y,yaw,actor.halfWidth,actor.halfLength,staticSolids)){
          actor.speed=0
          actor.dist+=reverse?advance:-advance
          return
        }
      }
      if(person&&actor.dist>=track.length){
        const onward=this.onwardWalk(track)??this.shizijieTurnOrReverse(track)
        if(onward){actor.track=onward.track;actor.dist=onward.dist;this.transitions++}
        else{actor.dist=track.length;actor.speed=0;actor.arrived=true}
      }else if(reverse&&actor.dist<=0){
        const incoming=(this.entries.get(track.from)??[]).filter(prev=>
          !prev.walk&&prev.kind==='nonmotor'&&this.usable(prev)&&prev.from!==track.to&&
          !this.parkingHits(prev).some(hit=>hit.dist>prev.length-12))
        if(!incoming.length){
          actor.dist=0
          this.position(actor)
          if(this.dutyConfig.hiddenLifecycle){
            actor.pendingRecycle=true
            actor.recycleHeadingX=-track.dx
            actor.recycleHeadingZ=-track.dz
            actor.recycleSpeed=Math.max(5.2,actor.speed||6)
            return
          }
          actor.speed=0;actor.leaving=!visible?.(actor);return
        }
        const sameStreetIn=track.street?incoming.filter(prev=>prev.street===track.street):incoming
        const inBase=sameStreetIn.length?sameStreetIn:incoming
        const straight=inBase.filter(prev=>prev.dx*track.dx+prev.dz*track.dz>.7)
        const pool=straight.length?straight:inBase
        actor.track=pool[Math.floor(this.random()*pool.length)]
        actor.dist=actor.track.length
        this.transitions++
      }else if(!reverse&&actor.dist>=track.length){
        const exits=this.exits.get(track.to)??[]
        let choices:Track[]
        if(actor.kind==='car'){
          // IDOK-378: prefer same-street motor exits, but follow connected motor lanes across street-name changes
          const motorExits=exits.filter(next=>this.usable(next)&&!this.parkingHits(next).some(hit=>hit.dist<12)&&!next.walk&&next.to!==track.from&&next.kind!=='nonmotor')
          const sameStreet=track.street?motorExits.filter(next=>next.street===track.street):motorExits
          choices=sameStreet.length?sameStreet:motorExits
        }else{
          // Duty mode strictly confines scooters to nonmotor lanes; regular city traffic prefers real -> virtual nonmotor -> motor,
          // following connected lanes across street-name changes (IDOK-378) whenever same-street exits run out.
          const legal=exits.filter(next=>this.usable(next)&&!this.parkingHits(next).some(hit=>hit.dist<12)&&!next.walk&&next.to!==track.from&&
            (this.dutyConfig.dutyOnly?next.kind==='nonmotor':(next.kind==='nonmotor'||next.kind==='motor')))
          const realNm=legal.filter(next=>next.kind==='nonmotor'&&!next.virtual)
          const sameRealNm=track.street?realNm.filter(next=>next.street===track.street):realNm
          const virtNm=legal.filter(next=>next.kind==='nonmotor'&&next.virtual)
          const sameVirtNm=track.street?virtNm.filter(next=>next.street===track.street):virtNm
          const motorFb=legal.filter(next=>next.kind==='motor')
          const sameMotorFb=track.street?motorFb.filter(next=>next.street===track.street):motorFb
          choices=sameRealNm.length?sameRealNm:realNm.length?realNm:sameVirtNm.length?sameVirtNm:virtNm.length?virtNm:sameMotorFb.length?sameMotorFb:motorFb
        }
        if(!choices.length){
          actor.dist=track.length
          this.position(actor)
          if(this.dutyConfig.hiddenLifecycle){
            actor.pendingRecycle=true
            actor.recycleHeadingX=track.dx
            actor.recycleHeadingZ=track.dz
            actor.recycleSpeed=Math.max(5.5,actor.speed||7)
            return
          }
          actor.speed=0;actor.leaving=!visible?.(actor);return
        }
        if(this.signal.has(track.to)){
          this.crossed++
          this.onCross?.(track,this.time)
          if(runningRed){
            actor.redLightActive=true
            actor.redLightTrailDist=0
          }
        }
        const onward=choices.filter(next=>next.to!==track.from)
        const pool=onward.length?onward:choices
        const straight=pool.filter(next=>next.dx*track.dx+next.dz*track.dz>.88)
        actor.track=straight.length&&this.random()<.85?straight.reduce((best,next)=>Math.abs(next.offset-track.offset)<Math.abs(best.offset-track.offset)?next:best):pool[Math.floor(this.random()*pool.length)]
        actor.dist=0;this.transitions++
      }
      this.position(actor)
      if(person&&actor.track===track&&Math.hypot(actor.x-previousX,actor.z-previousZ)>1e-5)actor.yaw=Math.atan2(actor.x-previousX,actor.z-previousZ)
      // Player collision check: sidewalk & nonmotor lane are 100% car-hit-free; walking calmly rarely gets hit;
      // motor-lane impacts only occur when running or ignoring horn, with impact speed strictly capped <= 25 km/h.
      if(actor.kind==='car'&&officer&&!officerInSafeZone&&this.onPlayerHit&&!actor.leaving&&actor.scale>=.5&&actor.speed>1.2){
        const warnElapsed=actor.officerWarningSince!==undefined?this.time-actor.officerWarningSince:0
        const ignoringHorn=warnElapsed>=HORN_IGNORE_GRACE_S||actor.lastHornAt!==undefined
        const canHit=(officerRunning||!officerWalkingCalmly)&&ignoringHorn
        if(canHit&&this.time-this.lastHitAt>=1.2&&this.time-(actor.lastPlayerHitAt??-Infinity)>=6){
          const hdx=officer.x-actor.x,hdz=officer.z-actor.z,hdy=Math.abs(officer.y-actor.y)
          if(hdy<=2.2){
            const along=hdx*dirX+hdz*dirZ
            const across=Math.abs(hdx*dirZ-hdz*dirX)
            const playerR=.45
            if(along>=-(actor.halfLength+playerR+advance)&&along<=actor.halfLength+playerR&&across<=actor.halfWidth+playerR){
              if(actor.lastHornAt===undefined){
                actor.lastHornAt=this.time
                actor.hornCount=(actor.hornCount??0)+1
                this.onPlayerHorn?.({actor,dist:Math.max(0,along),speed:actor.speed,time:this.time})
              }
              const impactSpeed=Math.min(actor.speed,MAX_PLAYER_HIT_SPEED_MS)
              actor.speed=impactSpeed
              const speedKmh=impactSpeed*3.6
              const severity:HitSeverity=this.dutyConfig.active
                ?'light'
                :impactSpeed>=6.2
                  ?'heavy'
                  :impactSpeed>=3.8
                    ?'medium'
                    :'light'
              const severityScore=this.dutyConfig.active
                ?Math.min(.45,Math.max(.25,.25+(impactSpeed/MAX_PLAYER_HIT_SPEED_MS)*.2))
                :Math.min(1,Math.max(.25,impactSpeed/10))
              const len=Math.hypot(dirX,dirZ)||1
              const dir={x:dirX/len,z:dirZ/len}
              this.lastHitAt=this.time
              actor.lastPlayerHitAt=this.time
              this.stopActor(actor,4.5)
              this.onPlayerHit(severity,dir,{
                severity,
                severityScore,
                dir,
                speed:impactSpeed,
                speedKmh,
                honkedBeforeHit:(actor.hornCount??0)>0,
                actor,
              })
            }
          }
        }
      }
  }
}
