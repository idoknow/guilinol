import * as THREE from 'three'
import type {Tile} from './world'

export type Point=[number,number,number]
import * as station from './station-tunnels'
export type Tunnel=station.Tunnel
export {floorLevel,nearbyTunnels} from './station-tunnels'
export type GroundCutout={
  id:string,corner?:string,kind?:string,center:Point,yaw:number,width:number,length:number,
  topY:number,floorY:number,polygon:[number,number][]
}
/** Open stairwell drawn by a landmark: the host only cuts terrain and adds an invisible stepped-ramp 'road' collider
 * (ground-stairwells.ts). `land` extends the bottom landing under the grade to that local z and walls the well in
 * invisibly (sides and that end). */
export type GroundStairwell={id:string,x:number,z:number,grade:number,yaw:number,halfWidth:number,zTop:number,zBack:number,depth:number,riser:number,tread:number,land?:number}
export type ShizijieCorridor={way?:number,id?:string,points:[number,number][],halfWidth:number}
export type ShizijieShutter={x:number,z:number,yaw:number,width:number,height:number,code:string}
export type ShizijieShop={x:number,z:number,yaw:number,width:number,height:number,name:string,accent:string,glow:string,index:number}
export type ShizijieUnderpass={
  id:string,center:Point,floorY:number,ceilingHeight:number,
  ringPolygon:[number,number][],ringHalfWidth:number,
  corridors:ShizijieCorridor[],connectors:ShizijieCorridor[],
  stairs:(GroundCutout&{label?:string,mouth:Point,deep:Point})[],
  shutters:ShizijieShutter[],shops:ShizijieShop[]
}
export type ShizijieLandmarkEntrance={
  id?:string,corner?:string,label?:string,
  center?:Point,mouth?:Point,deep?:Point,
  worldMouth?:Point,worldDeep?:Point,
  surface?:Point|[number,number]|{x:number,y?:number,z:number},
  underground?:Point|[number,number]|{x:number,y?:number,z:number},
  position?:Point|[number,number]|{x:number,y?:number,z:number},
  yaw?:number,yawRad?:number,width?:number,length?:number,topY?:number,floorY?:number,
  polygon?:[number,number][],cutoutPolygon?:[number,number][],
}
export type ShizijieLandmarkUnderground={
  id?:string,origin?:Point,originWorld?:Point,center?:Point,
  floorY:number,worldFloorY?:number,ceilingHeight?:number,
  entrances:ShizijieLandmarkEntrance[],
  walkPolygon:[number,number][],
  ringPolygon?:[number,number][],ringHalfWidth?:number,
  corridors?:ShizijieCorridor[],connectors?:ShizijieCorridor[],
  shutters?:ShizijieShutter[],shops?:ShizijieShop[],
}
export type ShizijieUndergroundZone={
  cutouts:GroundCutout[],
  underpass:ShizijieUnderpass,
  walkPolygon:[number,number][],
}
export const SHIZIJIE_LANDMARK_ORIGIN:Point=[-879.7502,151.3,-169.626]

function frame(tunnel:Tunnel){
  const [start,end]=tunnel.portals, ux=(end[0]-start[0])/tunnel.length,uz=(end[2]-start[2])/tunnel.length
  return {station:(x:number,z:number)=>(x-start[0])*ux+(z-start[2])*uz,
    lateral:(x:number,z:number)=>-(x-start[0])*uz+(z-start[2])*ux,
    point:(at:number,offset:number,y:number):Point=>[start[0]+at*ux-offset*uz,y,start[2]+at*uz+offset*ux]}
}
export function tunnelFloor(tunnels:Tunnel[]|undefined,x:number,z:number,foot:number){
  const local=station.nearbyTunnels(tunnels,x,z)
  for(const tunnel of local){
    if(tunnel.nodes){
      const floor=station.floorLevel(tunnel,x,z)
      if(floor!==undefined&&foot>=floor-.75&&foot<floor+tunnel.clearance-.25)return floor
      continue
    }
    const axes=frame(tunnel), at=axes.station(x,z)
    if(at<0||at>tunnel.length||Math.abs(axes.lateral(x,z))>tunnel.halfWidth)continue
    const index=tunnel.stations.findIndex(([s])=>s>=at), [end,high]=tunnel.stations[index], [start,low]=tunnel.stations[Math.max(0,index-1)]
    const floor=low+(high-low)*(at-start)/(end-start||1)
    if(foot>=floor-.75&&foot<floor+tunnel.clearance-.25)return floor
  }
  return undefined
}

function pointInPolygon(x:number,z:number,poly:[number,number][]){
  let inside=false
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const [xi,zi]=poly[i],[xj,zj]=poly[j]
    if(((zi>z)!==(zj>z))&&(x<(xj-xi)*(z-zi)/((zj-zi)||1e-9)+xi))inside=!inside
  }
  return inside
}

function distToSegments(x:number,z:number,pts:[number,number][]){
  let best=Infinity
  for(let i=1;i<pts.length;i++){
    const [ax,az]=pts[i-1],[bx,bz]=pts[i],dx=bx-ax,dz=bz-az,len2=dx*dx+dz*dz||1
    const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/len2))
    best=Math.min(best,Math.hypot(x-(ax+t*dx),z-(az+t*dz)))
  }
  return best
}

function toWorldXZ(pt:readonly [number,number],origin:Point):[number,number]{
  return Math.hypot(pt[0],pt[1])<250?[pt[0]+origin[0],pt[1]+origin[2]]:[pt[0],pt[1]]
}
function toWorldY(y:number,originY:number){
  return Math.abs(y)<50?originY+y:y
}
function parsePoint3(raw:unknown,origin:Point,defaultY:number):Point|null{
  if(Array.isArray(raw)&&raw.length>=2&&Number.isFinite(raw[0])&&Number.isFinite(raw[1])){
    if(raw.length>=3&&Number.isFinite(raw[2])){
      const [wx,wz]=toWorldXZ([raw[0],raw[2]],origin)
      return [wx,toWorldY(raw[1],origin[1]),wz]
    }
    const [wx,wz]=toWorldXZ([raw[0],raw[1]],origin)
    return [wx,defaultY,wz]
  }
  if(raw&&typeof raw==='object'&&'x' in raw&&'z' in raw){
    const obj=raw as {x:number,y?:number,z:number}
    if(!Number.isFinite(obj.x)||!Number.isFinite(obj.z))return null
    const [wx,wz]=toWorldXZ([obj.x,obj.z],origin)
    const wy=typeof obj.y==='number'&&Number.isFinite(obj.y)?toWorldY(obj.y,origin[1]):defaultY
    return [wx,wy,wz]
  }
  return null
}
function nearestPolygonPoint(x:number,z:number,poly:[number,number][]):[number,number]{
  let best:[number,number]=poly[0],bestD=Infinity
  for(let i=0;i<poly.length;i++){
    const [ax,az]=poly[i],[bx,bz]=poly[(i+1)%poly.length],dx=bx-ax,dz=bz-az,len2=dx*dx+dz*dz||1
    const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/len2))
    const px=ax+t*dx,pz=az+t*dz,d=Math.hypot(x-px,z-pz)
    if(d<bestD){bestD=d;best=[px,pz]}
  }
  return best
}

/** Parse and normalize `public/landmarks/shizijie.json` `underground` metadata into world-space cutouts + walkable zone. */
export function parseShizijieLandmarkUnderground(raw:unknown):ShizijieUndergroundZone|null{
  if(!raw||typeof raw!=='object')return null
  const container=raw as {underground?:unknown}
  const src=(container.underground&&typeof container.underground==='object'?container.underground:raw) as Partial<ShizijieLandmarkUnderground>
  if(typeof src.floorY!=='number'||!Number.isFinite(src.floorY))return null
  if(!Array.isArray(src.entrances)||src.entrances.length<2)return null
  const rawPoly=Array.isArray(src.walkPolygon)&&src.walkPolygon.length>=3?src.walkPolygon:src.ringPolygon
  if(!Array.isArray(rawPoly)||rawPoly.length<3)return null
  const rawOrigin=Array.isArray(src.originWorld)&&src.originWorld.length>=3
    ?src.originWorld
    :Array.isArray(src.origin)&&src.origin.length>=3?src.origin:null
  const origin:Point=rawOrigin
    ?[rawOrigin[0],rawOrigin[1],rawOrigin[2]]
    :SHIZIJIE_LANDMARK_ORIGIN
  const floorY=typeof src.worldFloorY==='number'&&Number.isFinite(src.worldFloorY)
    ?src.worldFloorY
    :toWorldY(src.floorY,origin[1])
  const ceilingHeight=typeof src.ceilingHeight==='number'&&Number.isFinite(src.ceilingHeight)?src.ceilingHeight:3.15
  const walkPolygon:[number,number][]=rawPoly.map(p=>toWorldXZ(p,origin))
  const ringPolygon:[number,number][]=Array.isArray(src.ringPolygon)&&src.ringPolygon.length>=3
    ?src.ringPolygon.map(p=>toWorldXZ(p,origin))
    :walkPolygon
  const center=parsePoint3(src.center,origin,origin[1])??[
    walkPolygon.reduce((s,p)=>s+p[0],0)/walkPolygon.length,
    origin[1],
    walkPolygon.reduce((s,p)=>s+p[1],0)/walkPolygon.length,
  ]
  const stairs:(GroundCutout&{label?:string,mouth:Point,deep:Point})[]=[]
  const cutouts:GroundCutout[]=[]
  for(let i=0;i<src.entrances.length;i++){
    const e=src.entrances[i]
    if(!e||typeof e!=='object')continue
    const topY=typeof e.topY==='number'&&Number.isFinite(e.topY)?toWorldY(e.topY,origin[1]):origin[1]
    const eFloorY=typeof e.floorY==='number'&&Number.isFinite(e.floorY)?toWorldY(e.floorY,origin[1]):floorY
    const mouth=parsePoint3(e.worldMouth??e.mouth??e.surface,origin,topY)
    const deep=parsePoint3(e.worldDeep??e.deep??e.underground,origin,eFloorY)
    const width=typeof e.width==='number'&&Number.isFinite(e.width)?e.width:3.4
    const givenYaw=typeof e.yawRad==='number'&&Number.isFinite(e.yawRad)?e.yawRad:e.yaw
    let centerPt:Point,yaw:number,length:number,resolvedMouth:Point,resolvedDeep:Point
    if(mouth&&deep){
      const dx=deep[0]-mouth[0],dz=deep[2]-mouth[2]
      length=typeof e.length==='number'&&Number.isFinite(e.length)?e.length:Math.max(6,Math.hypot(dx,dz))
      yaw=typeof givenYaw==='number'&&Number.isFinite(givenYaw)?givenYaw:Math.atan2(dx,dz)
      centerPt=[(mouth[0]+deep[0])*.5,mouth[1],(mouth[2]+deep[2])*.5]
      resolvedMouth=[mouth[0],mouth[1],mouth[2]]
      resolvedDeep=[deep[0],eFloorY,deep[2]]
    }else{
      const base=parsePoint3(e.center??e.position,origin,topY)
      if(!base)continue
      length=typeof e.length==='number'&&Number.isFinite(e.length)?e.length:9.0
      const toward=nearestPolygonPoint(base[0],base[2],walkPolygon)
      yaw=typeof givenYaw==='number'&&Number.isFinite(givenYaw)?givenYaw:Math.atan2(toward[0]-base[0],toward[1]-base[2])
      const hl=length*.5,s=Math.sin(yaw),c=Math.cos(yaw)
      centerPt=[base[0],topY,base[2]]
      resolvedMouth=[base[0]-hl*s,topY,base[2]-hl*c]
      resolvedDeep=[base[0]+hl*s,eFloorY,base[2]+hl*c]
    }
    const hw=width*.5,hl=length*.5,c=Math.cos(yaw),s=Math.sin(yaw)
    const toXZ=(lx:number,lz:number):[number,number]=>[centerPt[0]+lx*c+lz*s,centerPt[2]-lx*s+lz*c]
    const rawCutPoly=Array.isArray(e.cutoutPolygon)&&e.cutoutPolygon.length>=3?e.cutoutPolygon:e.polygon
    const polygon:[number,number][]=Array.isArray(rawCutPoly)&&rawCutPoly.length>=3
      ?rawCutPoly.map(p=>toWorldXZ(p,origin))
      :[toXZ(-hw,-hl),toXZ(hw,-hl),toXZ(hw,hl),toXZ(-hw,hl)]
    const cutout:GroundCutout={
      id:e.id??`shizijie_ug_entrance_${i}`,
      corner:e.corner,
      kind:'shizijie-stair',
      center:centerPt,
      yaw,width,length,
      topY:resolvedMouth[1],
      floorY:resolvedDeep[1],
      polygon,
    }
    cutouts.push(cutout)
    stairs.push({...cutout,label:e.label,mouth:resolvedMouth,deep:resolvedDeep})
  }
  if(stairs.length<2)return null
  const corridors:ShizijieCorridor[]=(src.corridors??[]).map(seg=>({...seg,points:seg.points.map(p=>toWorldXZ(p,origin))}))
  const connectors:ShizijieCorridor[]=src.connectors?.length
    ?src.connectors.map(seg=>({...seg,points:seg.points.map(p=>toWorldXZ(p,origin))}))
    :stairs.map(st=>{
      const target=nearestPolygonPoint(st.deep[0],st.deep[2],walkPolygon)
      return {id:st.id,halfWidth:Math.max(2.0,st.width*.55),points:[[st.deep[0],st.deep[2]],target]}
    })
  const underpass:ShizijieUnderpass={
    id:src.id??'shizijie_landmark_underground',
    center,floorY,ceilingHeight,
    ringPolygon,
    ringHalfWidth:typeof src.ringHalfWidth==='number'&&Number.isFinite(src.ringHalfWidth)?src.ringHalfWidth:2.8,
    corridors,connectors,stairs,
    shutters:(src.shutters??[]).map(sh=>Math.abs(sh.x)<200&&Math.abs(sh.z)<200?{...sh,x:sh.x+origin[0],z:sh.z+origin[2]}:sh),
    shops:(src.shops??[]).map(sp=>Math.abs(sp.x)<200&&Math.abs(sp.z)<200?{...sp,x:sp.x+origin[0],z:sp.z+origin[2]}:sp),
  }
  return {cutouts,underpass,walkPolygon}
}

function queryUnderpassFloor(cutouts:GroundCutout[],ug:ShizijieUnderpass|undefined,walkPoly:[number,number][]|undefined,x:number,z:number,foot:number){
  // Strict inclusion invariant: cuts ⊂ underpassFloor ⊂ parts.floor ('road' collider)
  for(const c of cutouts){
    const dx=x-c.center[0],dz=z-c.center[2],cos=Math.cos(c.yaw),sin=Math.sin(c.yaw)
    const lx=dx*cos-dz*sin,lz=dx*sin+dz*cos
    if(Math.abs(lx)<=c.width*.5+.06&&lz>=-c.length*.5-.25&&lz<=c.length*.5+.55){
      const t=THREE.MathUtils.clamp((lz+c.length*.5)/(c.length||1),0,1)
      const floor=c.topY+(c.floorY-c.topY)*t
      if(foot>=floor-.95&&foot<=c.topY+.8)return floor
    }
  }
  if(ug&&foot>=ug.floorY-.95&&foot<=ug.floorY+ug.ceilingHeight+.4){
    if(pointInPolygon(x,z,ug.ringPolygon)||distToSegments(x,z,ug.ringPolygon)<=ug.ringHalfWidth)return ug.floorY
    if(walkPoly&&walkPoly!==ug.ringPolygon&&pointInPolygon(x,z,walkPoly))return ug.floorY
    for(const seg of [...ug.corridors,...ug.connectors]){
      if(distToSegments(x,z,seg.points)<=seg.halfWidth+.08)return ug.floorY
    }
  }
  return undefined
}

// Landmark stairwells live in a lazy chunk; tile and tree builds await it, the per-frame queries just skip until then.
let wells:typeof import('./ground-stairwells')|undefined
export const groundStairwellsReady=import('./ground-stairwells').then(kit=>{wells=kit},error=>console.error(error))

/** True on a landmark open-stairwell ramp (open to the sky, unlike the covered underpass). */
export const openWellAt=(x:number,z:number,foot:number)=>wells?.floorAt(x,z,foot)!==undefined

/** Query pedestrian underpass floor elevation (Shizijie 4 stairwells + 15-way ring concourse + shizijie.json underground). Excludes motor-vehicle tunnels. */

export function underpassFloor(cutouts:GroundCutout[]|undefined,underpass:ShizijieUnderpass|undefined,x:number,z:number,foot:number){
  const well=wells?.floorAt(x,z,foot)
  if(well!==undefined)return well
  const primary=queryUnderpassFloor(cutouts??registeredCutouts,underpass??registeredUnderpass,undefined,x,z,foot)
  if(primary!==undefined)return primary
  if(registeredLandmarkUnderground){
    return queryUnderpassFloor(
      registeredLandmarkUnderground.cutouts,
      registeredLandmarkUnderground.underpass,
      registeredLandmarkUnderground.walkPolygon,
      x,z,foot,
    )
  }
  return undefined
}

/** Check whether `(x, z, foot)` lies inside any walkable Shizijie underground zone or stairwell. */
export function isWalkableUnderground(x:number,z:number,foot:number){
  return underpassFloor(undefined,undefined,x,z,foot)!==undefined
}

// Trees from the base map can stand in a portal cutting or inside the bore; the
// world package predates the tunnel, so clear them at load time (IDOK-165).
let registered:Tunnel[]=[]
let registeredCutouts:GroundCutout[]=[]
let registeredUnderpass:ShizijieUnderpass|undefined
let registeredLandmarkUnderground:ShizijieUndergroundZone|null=null
let landmarkUndergroundPromise:Promise<ShizijieUndergroundZone|null>|null=null

export function registerShizijieUnderground(raw:unknown):ShizijieUndergroundZone|null{
  const parsed=parseShizijieLandmarkUnderground(raw)
  registeredLandmarkUnderground=parsed
  return parsed
}
export function getRegisteredShizijieUnderground(){
  return registeredLandmarkUnderground
}
export function loadShizijieUnderground(url='/landmarks/shizijie.json'):Promise<ShizijieUndergroundZone|null>{
  if(registeredLandmarkUnderground)return Promise.resolve(registeredLandmarkUnderground)
  if(landmarkUndergroundPromise)return landmarkUndergroundPromise
  if(typeof fetch!=='function')return Promise.resolve(null)
  landmarkUndergroundPromise=fetch(url)
    .then(res=>res.ok?res.json():null)
    .then(data=>data?registerShizijieUnderground(data):null)
    .catch(()=>null)
  return landmarkUndergroundPromise
}
export function registerTunnels(list:Tunnel[]|undefined,cutouts?:GroundCutout[],underpass?:ShizijieUnderpass){
  registered=list??[]
  if(cutouts!==undefined)registeredCutouts=cutouts
  if(underpass!==undefined)registeredUnderpass=underpass
  if(typeof window!=='undefined'&&typeof fetch==='function'&&/^https?:/.test(window.location?.protocol??'')){
    void loadShizijieUnderground()
  }
}
export function treeBlocked(x:number,y:number,z:number){
  for(const tunnel of station.nearbyTunnels(registered,x,z)){
    const axes=frame(tunnel),at=axes.station(x,z),side=Math.abs(axes.lateral(x,z))
    if(at< -6||at>tunnel.length+6||side>tunnel.halfWidth+3)continue
    const open=at<tunnel.approach+2||at>tunnel.length-tunnel.approach-2
    const index=Math.max(0,tunnel.stations.findIndex(([s])=>s>=at)),floor=tunnel.stations[Math.min(index,tunnel.stations.length-1)][1]
    if(open||y<floor+tunnel.clearance+.6)return true
  }
  const allCutouts=registeredLandmarkUnderground
    ?[...registeredCutouts,...registeredLandmarkUnderground.cutouts]
    :registeredCutouts
  for(const c of allCutouts){
    const dx=x-c.center[0],dz=z-c.center[2],cos=Math.cos(c.yaw),sin=Math.sin(c.yaw)
    const lx=dx*cos-dz*sin,lz=dx*sin+dz*cos
    if(Math.abs(lx)<=c.width*.5+1.8&&Math.abs(lz)<=c.length*.5+2.0)return true
  }
  return wells?.blocksTree(x,z)??false
}

export type Plane=(point:Point)=>number
export function joinPortalRoads(tile:Tile,tunnels:Tunnel[],buffers:Float32Array[]){
  for(const tunnel of tunnels){
    if(tunnel.nodes)continue
    const axes=frame(tunnel)
    for(const portal of tunnel.portals){
      if(portal[0]<tile.x-32||portal[0]>tile.x+288||portal[2]<tile.z-32||portal[2]>tile.z+288)continue
      for(const buffer of buffers)for(let index=0;index<buffer.length;index+=3){
        const x=tile.x+buffer[index],z=tile.z+buffer[index+2],s=axes.station(x,z),d=Math.abs(axes.lateral(x,z))
        const inward=portal===tunnel.portals[0]?s:tunnel.length-s
        // Only stitch the surface approach at the mouth. Vertices deeper
        // into the bore can belong to the street crossing above it.
        if(inward< -20||inward>4||d>tunnel.halfWidth+4)continue
        const blend=THREE.MathUtils.smoothstep(inward,-20,-4)*(1-THREE.MathUtils.smoothstep(inward,0,4))*(1-THREE.MathUtils.smoothstep(d,tunnel.halfWidth,tunnel.halfWidth+4))
        const target=tunnelFloor([tunnel],x,z,portal[1])??portal[1]
        buffer[index+1]+=blend*(target-.02-buffer[index+1])
      }
    }
  }
}
/** Pieces of a polygon left outside every convex cut (planes >= 0 inside), or null when no cut touches it. */
export function carve(poly:Point[],cuts:Plane[][]){
  let pieces=[poly],changed=false
  for(const planes of cuts){
    const remaining:Point[][]=[]
    for(const piece of pieces){
      if(planes.some(plane=>piece.every(p=>plane(p)<=0))){remaining.push(piece);continue}
      let inside=piece
      for(const plane of planes){const outside=clip(inside,p=>-plane(p));if(outside.length>=3)remaining.push(outside);inside=clip(inside,plane)}
      changed=true
    }
    pieces=remaining
  }
  return changed?pieces:null
}
/** Open the street surface and walk soups over landmark stairwells (ground-stairwells.ts). */
export function cutStairwellStreets(tile:Tile,streets:{road:Float32Array,sidewalk:Float32Array,surface:THREE.BufferGeometry|null}){
  wells?.cutStreets(tile,streets)
}
function clip(poly:Point[],plane:Plane){
  const result:Point[]=[]
  for(let index=0;index<poly.length;index++){
    const a=poly[index],b=poly[(index+1)%poly.length],da=plane(a),db=plane(b)
    if(da>=0)result.push(a)
    if((da<0)!==(db<0))result.push(a.map((value,k)=>value+(b[k]-value)*da/(da-db)) as Point)
  }
  return result
}
export function fan(poly:Point[],out:number[]){for(let at=2;at<poly.length;at++)out.push(...poly[0],...poly[at-1],...poly[at])}

export function carvePaving(surface:THREE.BufferGeometry,cuts:Plane[][]){
  const flat=surface.index?surface.toNonIndexed():surface
  const attrs=Object.entries(flat.attributes).sort(([name])=>name==='position'?-1:0)
  const stride=attrs.reduce((sum,[,attr])=>sum+attr.itemSize,0),out:number[]=[]
  for(let start=0;start<flat.getAttribute('position').count;start+=3){
    const triangle=[0,1,2].map(offset=>attrs.flatMap(([,attr])=>Array.from({length:attr.itemSize},(_,i)=>attr.getComponent(start+offset,i))) as Point)
    for(const polygon of carve(triangle,cuts)??[triangle])fan(polygon,out)
  }
  const result=new THREE.BufferGeometry()
  let offset=0
  for(const [name,attr] of attrs){
    const data=Float32Array.from({length:out.length/stride*attr.itemSize},(_,i)=>out[Math.floor(i/attr.itemSize)*stride+offset+i%attr.itemSize])
    result.setAttribute(name,new THREE.BufferAttribute(data,attr.itemSize));offset+=attr.itemSize
  }
  if(flat!==surface)flat.dispose()
  surface.dispose();return result
}

let cachedShopMat:THREE.MeshBasicMaterial|null=null
function getShopAtlasMaterial(shops:ShizijieShop[]){
  if(cachedShopMat)return cachedShopMat
  if(typeof document==='undefined'){
    cachedShopMat=new THREE.MeshBasicMaterial({color:0xf3e8d2,side:THREE.DoubleSide})
    return cachedShopMat
  }
  // 1024x1024 shared atlas: rows 0..3 = 16 glowing shops (4x4), bottom band = corrugated shutter + signboard
  const canvas=document.createElement('canvas')
  canvas.width=1024;canvas.height=1024
  const ctx=canvas.getContext('2d')!
  ctx.fillStyle='#1f242c';ctx.fillRect(0,0,1024,1024)
  // Top 16 cells (4 cols x 4 rows, each 256 x 204 px, total 816 px high)
  const cellW=256,cellH=204
  for(let i=0;i<16;i++){
    const spec=shops[i]??{name:`小香港商铺 ${i+1}`,accent:'#1565c0',glow:'#bbdefb'}
    const cx=(i%4)*cellW,cy=Math.floor(i/4)*cellH
    // Header signboard box
    ctx.fillStyle=spec.accent
    ctx.fillRect(cx+6,cy+6,cellW-12,48)
    ctx.strokeStyle='#ffe082';ctx.lineWidth=3
    ctx.strokeRect(cx+8,cy+8,cellW-16,44)
    ctx.fillStyle='#ffffff';ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle'
    ctx.fillText(spec.name,cx+cellW/2,cy+30,cellW-24)
    // Bright lit showcase window interior gradient (self-illuminated, 0 dynamic lights)
    const grad=ctx.createLinearGradient(0,cy+58,0,cy+cellH-10)
    grad.addColorStop(0,spec.glow)
    grad.addColorStop(0.55,'#fffdf7')
    grad.addColorStop(1,'#e2d8c8')
    ctx.fillStyle=grad
    ctx.fillRect(cx+10,cy+58,cellW-20,cellH-68)
    // Display shelves & silhouette props inside window
    ctx.fillStyle='rgba(35,35,45,0.28)'
    ctx.fillRect(cx+22,cy+98,cellW-44,6)
    ctx.fillRect(cx+22,cy+136,cellW-44,6)
    ctx.fillStyle='rgba(40,42,50,0.45)'
    ctx.fillRect(cx+36,cy+144,44,50)
    ctx.fillRect(cx+168,cy+144,52,50)
    ctx.strokeStyle='#424952';ctx.lineWidth=6
    ctx.strokeRect(cx+10,cy+58,cellW-20,cellH-68)
  }
  // Bottom shutter & plate band (y = 820..1024): corrugated galvanized steel + header plate
  const sy=820,sh=204
  ctx.fillStyle='#68707a';ctx.fillRect(0,sy,512,sh)
  for(let y=sy+44;y<1024;y+=12){
    ctx.fillStyle='#7b8490';ctx.fillRect(8,y,496,6)
    ctx.fillStyle='#4a515a';ctx.fillRect(8,y+6,496,5)
  }
  ctx.fillStyle='#1f2630';ctx.fillRect(10,sy+8,492,34)
  ctx.fillStyle='#ffd54f';ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle'
  ctx.fillText('RESERVED · 小香港招租 XH',256,sy+25)
  // Exit direction fascia tile (x=512..1024, y=820..1024)
  ctx.fillStyle='#0d3b2e';ctx.fillRect(512,sy,512,sh)
  ctx.strokeStyle='#80cbc4';ctx.lineWidth=4;ctx.strokeRect(520,sy+10,496,sh-20)
  ctx.fillStyle='#e0f2f1';ctx.font='bold 34px sans-serif'
  ctx.fillText('↑ 出口 EXIT · 十字街',768,sy+sh/2)

  const tex=new THREE.CanvasTexture(canvas)
  tex.colorSpace=THREE.SRGBColorSpace
  tex.flipY=true
  cachedShopMat=new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide})
  return cachedShopMat
}

export function tunnelGeometry(
  tile:Tile,ground:THREE.PlaneGeometry,tunnels:Tunnel[],
  panels:import('./railways').CrossingPanel[]=[],
  groundCutouts?:GroundCutout[],underpass?:ShizijieUnderpass,
){
  const local=station.nearbyTunnels(tunnels,tile.x,tile.z)
  if(local.some(t=>t.nodes)){
    const mesh=station.tunnelGeometry(tile,ground,local,panels)
    if(mesh)return {...mesh,fringe:undefined}
  }
  tunnels=local.filter(t=>!t.nodes)
  const baseCutouts=groundCutouts??registeredCutouts
  const extraCutouts=(registeredLandmarkUnderground?.cutouts??[]).filter(
    ec=>!baseCutouts.some(bc=>Math.hypot(bc.center[0]-ec.center[0],bc.center[2]-ec.center[2])<3.0),
  )
  const cutouts=extraCutouts.length?[...baseCutouts,...extraCutouts]:baseCutouts
  const ug=underpass??registeredUnderpass??registeredLandmarkUnderground?.underpass
  const extraWalkPoly=underpass||registeredUnderpass?registeredLandmarkUnderground?.walkPolygon:undefined
  const parts={floor:[] as number[],interior:[] as number[],portal:[] as number[],band:[] as number[],lamp:[] as number[],lane:[] as number[],ceiling:[] as number[],ghost:[] as number[]}
  const shopPos:number[]=[],shopUv:number[]=[]
  const cuts:Plane[][]=[]
  const limits:Plane[]=[p=>p[0],p=>256-p[0],p=>p[2],p=>256-p[2]]
  const heights=ground.getAttribute('position'), cells=ground.parameters.widthSegments
  function groundY(point:Point){
    const x=THREE.MathUtils.clamp(point[0]/256*cells,0,cells),z=THREE.MathUtils.clamp(point[2]/256*cells,0,cells)
    const col=Math.min(cells-1,Math.floor(x)),row=Math.min(cells-1,Math.floor(z)),u=x-col,v=z-row,idx=row*(cells+1)+col
    const a=heights.getY(idx),b=heights.getY(idx+1),c=heights.getY(idx+cells+1),d=heights.getY(idx+cells+2)
    return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v)
  }
  const quad=(points:Point[],part:keyof typeof parts)=>fan(limits.reduce((poly,plane)=>clip(poly,plane),points),parts[part])

  for(const tunnel of tunnels){
    const [start,end]=tunnel.portals,pad=tunnel.halfWidth+1
    if(Math.max(start[0],end[0])+pad<tile.x||Math.min(start[0],end[0])-pad>tile.x+256||Math.max(start[2],end[2])+pad<tile.z||Math.min(start[2],end[2])-pad>tile.z+256)continue
    const axes=frame(tunnel),width=tunnel.halfWidth,head=tunnel.clearance
    function local(s:number,d:number,y:number){const p=axes.point(s,d,y);p[0]-=tile.x;p[2]-=tile.z;return p}
    const station=(p:Point)=>axes.station(p[0]+tile.x,p[2]+tile.z),side=(p:Point)=>axes.lateral(p[0]+tile.x,p[2]+tile.z)
    for(const [from,to] of [[0,tunnel.approach],[tunnel.length-tunnel.approach,tunnel.length]])cuts.push([p=>station(p)-from,p=>to-station(p),p=>width-side(p),p=>width+side(p)])
    for(let i=1;i<tunnel.stations.length;i++){
      const [a,ay]=tunnel.stations[i-1],[b,by]=tunnel.stations[i]
      const open=(a+b)/2<tunnel.approach||(a+b)/2>tunnel.length-tunnel.approach
      const al=local(a,-width,ay),ar=local(a,width,ay),bl=local(b,-width,by),br=local(b,width,by)
      quad([al,ar,br,bl],'floor')
      const top=(p:Point):Point=>[p[0],open?Math.max(p[1],groundY(p)):p[1]+head,p[2]]
      quad([al,bl,top(bl),top(al)],open?'portal':'interior');quad([br,ar,top(ar),top(br)],open?'portal':'interior')
      if(!open)quad([top(al),top(bl),top(br),top(ar)],'ceiling')
      if(!open){
        // 青绿 glazed-tile dado, warm lamp strips and a dashed centre line (IDOK-165 visual pass)
        const inset=width-.04
        quad([local(a,-inset,ay),local(b,-inset,by),local(b,-inset,by+1.3),local(a,-inset,ay+1.3)],'band')
        quad([local(b,inset,by),local(a,inset,ay),local(a,inset,ay+1.3),local(b,inset,by+1.3)],'band')
        for(const d of [-inset+.02,inset-.02])quad([local(a,d,ay+head-.95),local(b,d,by+head-.95),local(b,d,by+head-.8),local(a,d,ay+head-.8)],'lamp')
      }
      if(Math.floor(a/6)%2===0)quad([local(a,-.08,ay+.03),local(a,.08,ay+.03),local(b,.08,by+.03),local(b,-.08,by+.03)],'lane')
      for(const [s,y] of [[a,ay]])if(Math.abs(s-tunnel.approach)<1e-6||Math.abs(s-tunnel.length+tunnel.approach)<1e-6){
        const l=local(s,-width,y+head),r=local(s,width,y+head)
        quad([l,r,[r[0],Math.max(r[1]+.16,groundY(r)),r[2]],[l[0],Math.max(l[1]+.16,groundY(l)),l[2]]],'portal')
      }
    }
  }

  // Terrain cutouts for surface stairwell openings (clipped cleanly via half-planes in tile local frame)
  for(const c of cutouts){
    if(c.center[0]+16<tile.x||c.center[0]-16>tile.x+256||c.center[2]+16<tile.z||c.center[2]-16>tile.z+256)continue
    const cos=Math.cos(c.yaw),sin=Math.sin(c.yaw),cx=c.center[0]-tile.x,cz=c.center[2]-tile.z
    const hw=c.width*.5+.02,hl=c.length*.5+.02
    const lx=(p:Point)=>(p[0]-cx)*cos-(p[2]-cz)*sin
    const lz=(p:Point)=>(p[0]-cx)*sin+(p[2]-cz)*cos
    cuts.push([p=>lx(p)+hw,p=>hw-lx(p),p=>lz(p)+hl,p=>hl-lz(p)])

    // Build smooth walkable underground staircase ramp & shaft walls inside the cutout
    const toTile=(x:number,y:number,z:number):Point=>[cx+x*cos+z*sin,y,cz-x*sin+z*cos]
    const w=c.width,hwr=w*.5,fwr=hwr+.12,hlr=c.length*.5,head=3.1
    // Flush mouth & deep landing aprons keep 'road' collider strictly wider than underpassFloor() bounds
    quad([toTile(-fwr,c.topY-.015,-hlr-.65),toTile(fwr,c.topY-.015,-hlr-.65),toTile(fwr,c.topY,-hlr),toTile(-fwr,c.topY,-hlr)],'floor')
    quad([toTile(-fwr,c.floorY,hlr),toTile(fwr,c.floorY,hlr),toTile(fwr,c.floorY,hlr+.9),toTile(-fwr,c.floorY,hlr+.9)],'floor')
    const nSegs=12
    for(let i=0;i<nSegs;i++){
      const t0=i/nSegs,t1=(i+1)/nSegs
      const z0=-hlr+c.length*t0,z1=-hlr+c.length*t1
      const y0=c.topY+(c.floorY-c.topY)*t0,y1=c.topY+(c.floorY-c.topY)*t1
      // Walkable ramp floor (Rapier 'road')
      quad([toTile(-fwr,y0,z0),toTile(fwr,y0,z0),toTile(fwr,y1,z1),toTile(-fwr,y1,z1)],'floor')
      // Side retaining walls up to street grade or +3.1m
      const wt0=Math.max(y0+head,c.topY+.05),wt1=Math.max(y1+head,c.topY+.05)
      quad([toTile(-hwr,y0,z0),toTile(-hwr,y1,z1),toTile(-hwr,wt1,z1),toTile(-hwr,wt0,z0)],'interior')
      quad([toTile(hwr,y1,z1),toTile(hwr,y0,z0),toTile(hwr,wt0,z0),toTile(hwr,wt1,z1)],'interior')
      // Green glazed dado wall band & glowing warm handrail strip along stairs
      quad([toTile(-hwr+.03,y0,z0),toTile(-hwr+.03,y1,z1),toTile(-hwr+.03,y1+1.1,z1),toTile(-hwr+.03,y0+1.1,z0)],'band')
      quad([toTile(hwr-.03,y1,z1),toTile(hwr-.03,y0,z0),toTile(hwr-.03,y0+1.1,z0),toTile(hwr-.03,y1+1.1,z1)],'band')
      quad([toTile(-hwr+.05,y0+0.92,z0),toTile(-hwr+.05,y1+0.92,z1),toTile(-hwr+.05,y1+1.0,z1),toTile(-hwr+.05,y0+1.0,z0)],'lamp')
      quad([toTile(hwr-.05,y1+0.92,z1),toTile(hwr-.05,y0+0.92,z0),toTile(hwr-.05,y0+1.0,z0),toTile(hwr-.05,y1+1.0,z1)],'lamp')
      // Visual stair tread steps (24 steps) inside non-colliding band + warm riser markers
      for(let sub=0;sub<2;sub++){
        const st0=t0+(t1-t0)*(sub/2),st1=t0+(t1-t0)*((sub+1)/2)
        const sz0=-hlr+c.length*st0,sz1=-hlr+c.length*st1
        const sy=c.topY+(c.floorY-c.topY)*st1
        const prevY=c.topY+(c.floorY-c.topY)*st0
        quad([toTile(-hwr+.04,prevY,sz0),toTile(hwr-.04,prevY,sz0),toTile(hwr-.04,sy,sz0),toTile(-hwr+.04,sy,sz0)],'band')
        quad([toTile(-hwr+.04,sy,sz0),toTile(hwr-.04,sy,sz0),toTile(hwr-.04,sy,sz1),toTile(-hwr+.04,sy,sz1)],'band')
        quad([toTile(-hwr+.2,sy+.01,sz0),toTile(hwr-.2,sy+.01,sz0),toTile(hwr-.2,sy+.01,sz0+.05),toTile(-hwr+.2,sy+.01,sz0+.05)],'lane')
      }
    }
    // End wall behind stair entry & soffit bulkhead where deep stair enters corridor
    quad([toTile(-hwr,c.topY,hlr),toTile(hwr,c.topY,hlr),toTile(hwr,c.floorY+head,hlr),toTile(-hwr,c.floorY+head,hlr)],'portal')
  }

  // Landmark stairwells: exact terrain hole + invisible ramp profile and walls.
  const stairwellParts=wells?.tileWells(tile)
  if(stairwellParts){cuts.push(...stairwellParts.cuts);for(const q of stairwellParts.quads)quad(q,'ghost')}

  // Shizijie "小香港" -4.2m underground concourse (15-way OSM network, central ring atrium, 16 shutters + 16 lit shops)
  if(ug&&ug.center[0]+90>=tile.x&&ug.center[0]-90<=tile.x+256&&ug.center[2]+90>=tile.z&&ug.center[2]-90<=tile.z+256){
    const fy=ug.floorY,cy=fy+ug.ceilingHeight
    const ringWorld=ug.ringPolygon
    const ringVec2=ringWorld.map(([x,z])=>new THREE.Vector2(x,z))
    const ringTris=THREE.ShapeUtils.triangulateShape(ringVec2,[])
    for(const [a,b,c] of ringTris){
      const pa:Point=[ringWorld[a][0]-tile.x,fy,ringWorld[a][1]-tile.z]
      const pb:Point=[ringWorld[b][0]-tile.x,fy,ringWorld[b][1]-tile.z]
      const pc:Point=[ringWorld[c][0]-tile.x,fy,ringWorld[c][1]-tile.z]
      fan([pa,pb,pc],parts.floor)
      const ca:Point=[pa[0],cy,pa[2]],cb:Point=[pb[0],cy,pb[2]],cc:Point=[pc[0],cy,pc[2]]
      fan([ca,cc,cb],parts.ceiling)
    }

    // Helper: check if a wall midpoint is inside the ring atrium OR another walkable corridor/connector
    const allPassages=[...ug.corridors,...ug.connectors]
    const inCutout=(wx:number,wz:number,pad=0)=>{
      for(const st of ug.stairs){
        const dx=wx-st.center[0],dz=wz-st.center[2],cos=Math.cos(st.yaw),sin=Math.sin(st.yaw)
        if(Math.abs(dx*cos-dz*sin)<=st.width*.5+pad&&Math.abs(dx*sin+dz*cos)<=st.length*.5+pad)return true
      }
      return false
    }
    const nearBooth=(wx:number,wz:number)=>
      ug.shops.some(sp=>Math.hypot(wx-sp.x,wz-sp.z)<2.2)||ug.shutters.some(sh=>Math.hypot(wx-sh.x,wz-sh.z)<2.2)
    const wallOpenAt=(wx:number,wz:number,skipIndex:number)=>{
      if(pointInPolygon(wx,wz,ringWorld))return true
      if(nearBooth(wx,wz))return true
      for(let i=0;i<allPassages.length;i++){
        if(i===skipIndex)continue
        if(distToSegments(wx,wz,allPassages[i].points)<allPassages[i].halfWidth+.2)return true
      }
      return inCutout(wx,wz,.4)
    }

    // Extrude corridors + stair connectors (floor, ceiling, dado, warm LEDs, subdivided wall checks so junctions never seal!)
    const emitDisk=(cxW:number,czW:number,r:number)=>{
      const fPts:Point[]=[],cPts:Point[]=[]
      for(let s=0;s<8;s++){
        const a=s*Math.PI/4
        const px=cxW+Math.cos(a)*r-tile.x,pz=czW+Math.sin(a)*r-tile.z
        fPts.push([px,fy,pz])
        cPts.push([px,cy,pz])
      }
      fan(limits.reduce((poly,plane)=>clip(poly,plane),fPts),parts.floor)
      if(!inCutout(cxW,czW,.2))fan(limits.reduce((poly,plane)=>clip(poly,plane),cPts.reverse()),parts.ceiling)
    }
    allPassages.forEach((seg,pIdx)=>{
      const hw=seg.halfWidth,fhw=hw+.18
      for(const [vx,vz] of seg.points)emitDisk(vx,vz,fhw)
      for(let i=1;i<seg.points.length;i++){
        const [ax,az]=seg.points[i-1],[bx,bz]=seg.points[i],dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz)
        if(len<.2)continue
        const tx=dx/len,tz=dz/len,nx=-tz,nz=tx
        const pt=(x:number,z:number,y:number):Point=>[x-tile.x,y,z-tile.z]
        const al=pt(ax-nx*fhw,az-nz*fhw,fy),ar=pt(ax+nx*fhw,az+nz*fhw,fy)
        const bl=pt(bx-nx*fhw,bz-nz*fhw,fy),br=pt(bx+nx*fhw,bz+nz*fhw,fy)
        quad([al,ar,br,bl],'floor')
        const panels=Math.max(1,Math.ceil(len/3.0))
        for(let p=0;p<panels;p++){
          const f0=p/panels,f1=(p+1)/panels
          const sax=ax+dx*f0,saz=az+dz*f0,sbx=ax+dx*f1,sbz=az+dz*f1
          const pmx=(sax+sbx)*.5,pmz=(saz+sbz)*.5
          if(!inCutout(pmx,pmz,0)){
            quad([pt(sax-nx*fhw,saz-nz*fhw,cy),pt(sbx-nx*fhw,sbz-nz*fhw,cy),pt(sbx+nx*fhw,sbz+nz*fhw,cy),pt(sax+nx*fhw,saz+nz*fhw,cy)],'ceiling')
            // Center warm ceiling LED light strip
            quad([pt(sax-nx*.22,saz-nz*.22,cy-.03),pt(sax+nx*.22,saz+nz*.22,cy-.03),pt(sbx+nx*.22,sbz+nz*.22,cy-.03),pt(sbx-nx*.22,sbz-nz*.22,cy-.03)],'lamp')
          }
          for(const sgn of [-1,1]){
            const off=sgn*(hw+.1)
            if(wallOpenAt(pmx+nx*off,pmz+nz*off,pIdx)||wallOpenAt(sax+nx*off,saz+nz*off,pIdx)||wallOpenAt(sbx+nx*off,sbz+nz*off,pIdx))continue
            const wl0=pt(sax+sgn*nx*hw,saz+sgn*nz*hw,fy),wl1=pt(sbx+sgn*nx*hw,sbz+sgn*nz*hw,fy)
            const wh0:Point=[wl0[0],cy,wl0[2]],wh1:Point=[wl1[0],cy,wl1[2]]
            if(sgn<0){
              quad([wl0,wl1,wh1,wh0],'interior')
              quad([pt(sax+sgn*nx*(hw-.03),saz+sgn*nz*(hw-.03),fy),pt(sbx+sgn*nx*(hw-.03),sbz+sgn*nz*(hw-.03),fy),pt(sbx+sgn*nx*(hw-.03),sbz+sgn*nz*(hw-.03),fy+1.2),pt(sax+sgn*nx*(hw-.03),saz+sgn*nz*(hw-.03),fy+1.2)],'band')
            }else{
              quad([wl1,wl0,wh0,wh1],'interior')
              quad([pt(sbx+sgn*nx*(hw-.03),sbz+sgn*nz*(hw-.03),fy),pt(sax+sgn*nx*(hw-.03),saz+sgn*nz*(hw-.03),fy),pt(sax+sgn*nx*(hw-.03),saz+sgn*nz*(hw-.03),fy+1.2),pt(sbx+sgn*nx*(hw-.03),sbz+sgn*nz*(hw-.03),fy+1.2)],'band')
            }
          }
        }
      }
    })

    // Ring perimeter wall (skipped where stair/corridor passages enter) + continuous floor/ceiling apron
    for(let i=0;i<ringWorld.length;i++){
      const [ax,az]=ringWorld[i],[bx,bz]=ringWorld[(i+1)%ringWorld.length]
      const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz)
      if(len<.2)continue
      const nx=-dz/len,nz=dx/len,mx=(ax+bx)*.5,mz=(az+bz)*.5
      // Outward vector away from ug center
      const sign=(mx-ug.center[0])*nx+(mz-ug.center[2])*nz>=0?1:-1
      const ox=nx*sign,oz=nz*sign
      const p=(x:number,y:number,z:number):Point=>[x-tile.x,y,z-tile.z]
      // Always emit outer floor & ceiling apron out to +3.2m so ring-to-corridor seams never drop
      quad([p(ax,fy,az),p(bx,fy,bz),p(bx+ox*3.2,fy,bz+oz*3.2),p(ax+ox*3.2,fy,az+oz*3.2)],'floor')
      quad([p(ax,cy,az),p(ax+ox*3.2,cy,az+oz*3.2),p(bx+ox*3.2,cy,bz+oz*3.2),p(bx,cy,bz)],'ceiling')
      if(allPassages.some(seg=>distToSegments(mx+ox*2.0,mz+oz*2.0,seg.points)<seg.halfWidth+1.1))continue
      quad([p(ax+ox*3.1,fy,az+oz*3.1),p(bx+ox*3.1,fy,bz+oz*3.1),p(bx+ox*3.1,cy,bz+oz*3.1),p(ax+ox*3.1,cy,az+oz*3.1)],'interior')
      quad([p(ax+ox*1.6,cy-.04,az+oz*1.6),p(bx+ox*1.6,cy-.04,bz+oz*1.6),p(bx+ox*1.9,cy-.04,bz+oz*1.9),p(ax+ox*1.9,cy-.04,az+oz*1.9)],'lamp')
    }

    if(extraWalkPoly&&extraWalkPoly.length>=3){
      const ewVec=extraWalkPoly.map(([x,z])=>new THREE.Vector2(x,z))
      for(const [a,b,c] of THREE.ShapeUtils.triangulateShape(ewVec,[])){
        const pa:Point=[extraWalkPoly[a][0]-tile.x,fy,extraWalkPoly[a][1]-tile.z]
        const pb:Point=[extraWalkPoly[b][0]-tile.x,fy,extraWalkPoly[b][1]-tile.z]
        const pc:Point=[extraWalkPoly[c][0]-tile.x,fy,extraWalkPoly[c][1]-tile.z]
        fan(limits.reduce((poly,plane)=>clip(poly,plane),[pa,pb,pc]),parts.floor)
      }
    }

    // 4 structural octagonal terrazzo columns in atrium hall around central core
    for(const [ox,oz] of [[-7.2,-6.8],[7.2,-6.8],[7.2,6.8],[-7.2,6.8]]){
      const ccx=ug.center[0]+ox-tile.x,ccz=ug.center[2]+oz-tile.z,r=.68,rb=r+.015
      for(let s=0;s<8;s++){
        const a0=s*Math.PI/4,a1=(s+1)*Math.PI/4
        const p0:Point=[ccx+Math.cos(a0)*r,fy,ccz+Math.sin(a0)*r],p1:Point=[ccx+Math.cos(a1)*r,fy,ccz+Math.sin(a1)*r]
        const b0:Point=[ccx+Math.cos(a0)*rb,fy,ccz+Math.sin(a0)*rb],b1:Point=[ccx+Math.cos(a1)*rb,fy,ccz+Math.sin(a1)*rb]
        quad([p0,p1,[p1[0],cy,p1[2]],[p0[0],cy,p0[2]]],'interior')
        quad([b0,b1,[b1[0],fy+1.2,b1[2]],[b0[0],fy+1.2,b0[2]]],'band')
      }
    }

    // Helper for textured UV quad into shopPos/shopUv + backing wall collider in parts.interior
    const addBayQuad=(p0:Point,p1:Point,p2:Point,p3:Point,u0:number,v0:number,u1:number,v1:number)=>{
      shopPos.push(...p0,...p1,...p2,...p0,...p2,...p3)
      shopUv.push(u0,v0,u1,v0,u1,v1,u0,v0,u1,v1,u0,v1)
      quad([p0,p1,p2,p3],'interior')
    }

    // 16 Reserved Corrugated Shutter Bays (XH-01 .. XH-16)
    for(const sh of ug.shutters){
      const c=Math.cos(sh.yaw),s=Math.sin(sh.yaw),cx=sh.x-tile.x,cz=sh.z-tile.z,hw=sh.width*.5
      const toPt=(lx:number,y:number,lz:number):Point=>[cx+lx*c+lz*s,y,cz-lx*s+lz*c]
      addBayQuad(toPt(-hw,fy,0),toPt(hw,fy,0),toPt(hw,fy+sh.height,0),toPt(-hw,fy+sh.height,0),0.002,0.002,0.498,0.198)
    }

    // 16 Self-Illuminated Shell Shops (shared 1024x1024 canvas atlas, 0 dynamic lights!)
    for(const sp of ug.shops){
      const c=Math.cos(sp.yaw),s=Math.sin(sp.yaw),cx=sp.x-tile.x,cz=sp.z-tile.z,hw=sp.width*.5
      const toPt=(lx:number,y:number,lz:number):Point=>[cx+lx*c+lz*s,y,cz-lx*s+lz*c]
      const col=sp.index%4,row=Math.floor(sp.index/4)
      const u0=col*0.25+0.004,u1=(col+1)*0.25-0.004
      // Canvas pixel row y -> GL texture V = 1 - y/1024
      const vTop=1-(row*204)/1024-0.002,vBot=1-((row+1)*204)/1024+0.002
      addBayQuad(toPt(-hw,fy,0),toPt(hw,fy,0),toPt(hw,fy+sp.height,0),toPt(-hw,fy+sp.height,0),u0,vBot,u1,vTop)
    }

    // Exit wayfinding illuminated fascia plaques at each stair bottom
    for(const st of ug.stairs){
      const cx=st.deep[0]-tile.x,cz=st.deep[2]-tile.z,c=Math.cos(st.yaw),s=Math.sin(st.yaw)
      const toPt=(lx:number,y:number,lz:number):Point=>[cx+lx*c+lz*s,y,cz-lx*s+lz*c]
      const p0=toPt(-1.45,fy+2.45,.05),p1=toPt(1.45,fy+2.45,.05),p2=toPt(1.45,fy+3.05,.05),p3=toPt(-1.45,fy+3.05,.05)
      shopPos.push(...p0,...p1,...p2,...p0,...p2,...p3)
      shopUv.push(0.505,0.005,0.995,0.005,0.995,0.195,0.505,0.005,0.995,0.195,0.505,0.195)
    }
  }

  if(!parts.floor.length&&!parts.ghost.length&&!cuts.length)return null
  const pos=ground.getAttribute('position'),index=ground.index!,vertices:number[]=[],keep:number[]=[]
  for(let at=0;at<index.count;at+=3){
    const ids=[0,1,2].map(off=>index.getX(at+off)),pieces=carve(ids.map(id=>[pos.getX(id),pos.getY(id),pos.getZ(id)]),cuts)
    if(pieces)pieces.forEach(poly=>fan(poly,vertices));else keep.push(...ids)
  }
  ground.setIndex(keep)
  const looks:Record<string,THREE.Material>={
    road:new THREE.MeshStandardMaterial({side:THREE.DoubleSide,color:0x4b4e52,roughness:.88}),
    interior:new THREE.MeshStandardMaterial({side:THREE.DoubleSide,color:0xd8d2c5,roughness:.85}),
    portal:new THREE.MeshStandardMaterial({side:THREE.DoubleSide,color:0xa39d90,roughness:.92}),
    band:new THREE.MeshStandardMaterial({side:THREE.DoubleSide,color:0x3f6d63,roughness:.55}),
    ceiling:new THREE.MeshBasicMaterial({side:THREE.DoubleSide,color:0xe5dfd3}),
    lamp:new THREE.MeshBasicMaterial({side:THREE.DoubleSide,color:0xfff1cf}),
    lane:new THREE.MeshStandardMaterial({side:THREE.DoubleSide,color:0xf2ead6,roughness:.7}),
    terrain:new THREE.MeshStandardMaterial({side:THREE.DoubleSide,color:0x888888}),
  }
  function mesh(values:number[],kind:string){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(values,3));geometry.computeVertexNormals()
    const item=new THREE.Mesh(geometry,looks[kind]);item.name=`tunnel_${kind}`;item.userData.kind=kind;return item
  }
  const fringe=mesh(vertices,'terrain');fringe.geometry.setAttribute('uv',new THREE.Float32BufferAttribute(vertices.flatMap((v,i)=>i%3===0?[v/256,1-vertices[i+2]/256]:[]),2))
  const lampMesh=mesh(parts.lamp,'lamp')
  if(shopPos.length&&ug){
    const shopGeo=new THREE.BufferGeometry()
    shopGeo.setAttribute('position',new THREE.Float32BufferAttribute(shopPos,3))
    shopGeo.setAttribute('uv',new THREE.Float32BufferAttribute(shopUv,2))
    const shopMesh=new THREE.Mesh(shopGeo,getShopAtlasMaterial(ug.shops))
    shopMesh.name='shizijie_xiaoxianggang_shops'
    lampMesh.add(shopMesh)
  }
  const ghost=parts.ghost.length?mesh(parts.ghost,'road'):undefined
  if(ghost){ghost.visible=false;ghost.name='tunnel_stairwell_ramp'}
  return {fringe,floor:mesh(parts.floor,'road'),interior:mesh(parts.interior,'interior'),portal:mesh(parts.portal,'portal'),
    band:mesh(parts.band,'band'),ceiling:mesh(parts.ceiling,'ceiling'),lamp:lampMesh,lane:mesh(parts.lane,'lane'),ghost}
}
