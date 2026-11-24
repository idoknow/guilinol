import * as THREE from 'three'
import type {Tile} from './world'

type Point=[number,number,number]
type Joint={ring?:[number,number][],offsets?:string,draw:boolean,cap?:boolean}
export type Tunnel={way:number,generated?:boolean,gradedAccess?:boolean,portals:[Point,Point],length:number,halfWidth:number,endWidths?:[number,number],clearance:number,approach:number,openEnds?:[number,number],mouths?:[boolean,boolean],joints?:(Joint|null)[],stations?:[number,number][],stationHeights?:string,knotHeights?:string}

// Generated strips use three fixed easing samples per interval. Keep distant
// strips encoded in the manifest and unpack only a visited strip's levels.
type StationProfile = {count:number;at:(index:number)=>[number,number]}
const profiles = new WeakMap<Tunnel,StationProfile>()
const easingFractions=[0,.06,.94]
function profile(tunnel:Tunnel):StationProfile {
  let value=profiles.get(tunnel)
  if(value)return value
  if(tunnel.stations){
    const values=tunnel.stations
    value={count:values.length,at:index=>values[index]}
  }else{
    const bytes=atob(tunnel.knotHeights??tunnel.stationHeights!)
    const view=new DataView(Uint8Array.from(bytes,c=>c.charCodeAt(0)).buffer)
    const count=tunnel.knotHeights?(view.byteLength/4-1)*3+1:view.byteLength/4
    const last=count-1,step=tunnel.length/(last/3)
    value={count,at:index=>{
      if(index===last)return [tunnel.length,tunnel.portals[1][1]]
      const interval=Math.floor(index/3),phase=index%3
      const x=Math.round(step*(interval+easingFractions[phase])*1e5)/1e5
      if(!tunnel.knotHeights)return [x,view.getInt32(index*4,true)/1e5]
      const a=view.getInt32(interval*4,true),b=view.getInt32((interval+1)*4,true)
      const eased=phase===0?0:phase===1?.03/.94:.91/.94
      return [x,Math.round(a+(b-a)*eased)/1e5]
    }}
  }
  profiles.set(tunnel,value)
  return value
}

function jointRing(joint:Joint,center:Point){
  if(joint.ring)return joint.ring
  const bytes=Uint8Array.from(atob(joint.offsets!),c=>c.charCodeAt(0))
  const view=new DataView(bytes.buffer),ring:[number,number][]=[]
  for(let i=0;i<bytes.length;i+=8)ring.push([center[0]+view.getInt32(i,true)/10000,center[2]+view.getInt32(i+4,true)/10000])
  joint.ring=ring
  return ring
}

function halfWidthAt(t:Tunnel,s:number){
  if(!t.endWidths)return t.halfWidth
  const run=Math.min(8,t.length/2)
  return t.halfWidth+(t.endWidths[0]-t.halfWidth)*(1-THREE.MathUtils.smoothstep(s,0,run))
    +(t.endWidths[1]-t.halfWidth)*THREE.MathUtils.smoothstep(s,t.length-run,t.length)
}

function openEnd(tunnel:Tunnel,index:number){
  return tunnel.openEnds?.[index]??(tunnel.mouths?.[index]===false?0:tunnel.approach)
}

function frame(tunnel:Tunnel){
  const [start,end]=tunnel.portals, ux=(end[0]-start[0])/tunnel.length,uz=(end[2]-start[2])/tunnel.length
  return {station:(x:number,z:number)=>(x-start[0])*ux+(z-start[2])*uz,
    lateral:(x:number,z:number)=>-(x-start[0])*uz+(z-start[2])*ux,
    point:(at:number,offset:number,y:number):Point=>[start[0]+at*ux-offset*uz,y,start[2]+at*uz+offset*ux]}
}
const binsByList=new WeakMap<Tunnel[],Map<string,Tunnel[]>>()
export function nearbyTunnels(list:Tunnel[]|undefined,x:number,z:number){
  if(!list||list.length<8)return list??[]
  let bins=binsByList.get(list)
  if(!bins){
    bins=new Map()
    for(const tunnel of list){
      const [a,b]=tunnel.portals,pad=tunnel.halfWidth+32
      for(let i=Math.floor((Math.min(a[0],b[0])-pad)/256);i<=Math.floor((Math.max(a[0],b[0])+pad)/256);i++)
        for(let j=Math.floor((Math.min(a[2],b[2])-pad)/256);j<=Math.floor((Math.max(a[2],b[2])+pad)/256);j++){
          const key=i+','+j
          if(!bins.has(key))bins.set(key,[])
          bins.get(key)!.push(tunnel)
        }
    }
    binsByList.set(list,bins)
  }
  return bins.get(Math.floor(x/256)+','+Math.floor(z/256))??[]
}

export function floorLevel(tunnel:Tunnel,x:number,z:number){
  const axes=frame(tunnel),at=axes.station(x,z)
  if(at<0||at>tunnel.length||Math.abs(axes.lateral(x,z))>halfWidthAt(tunnel,at)){
    for(const [i,joint] of (tunnel.joints??[]).entries()){
      if(!joint)continue
      let positive=false,negative=false
      const ring=jointRing(joint,tunnel.portals[i])
      for(let j=0;j<ring.length;j++){
        const [a,b]=ring[j],[c,d]=ring[(j+1)%ring.length],cross=(c-a)*(z-b)-(d-b)*(x-a)
        positive||=cross>.00001;negative||=cross<-.00001
        if(positive&&negative)break
      }
      if(!(positive&&negative))return tunnel.portals[i][1]
    }
    return
  }
  const values=profile(tunnel)
  let lo=0,hi=values.count-1
  while(hi-lo>1){const mid=(lo+hi)>>>1;if(values.at(mid)[0]<=at)lo=mid;else hi=mid}
  const [a,low]=values.at(lo),[b,high]=values.at(hi)
  return low+(high-low)*(at-a)/(b-a)
}
export function tunnelFloor(tunnels:Tunnel[]|undefined,x:number,z:number,foot:number){
  for(const tunnel of nearbyTunnels(tunnels,x,z)){
    const floor=floorLevel(tunnel,x,z)
    if(floor!==undefined&&foot>=floor-.75&&foot<floor+tunnel.clearance-.25)return floor
  }
  return undefined
}

// Trees from the base map can stand in a portal cutting or inside the bore; the
// world package predates the tunnel, so clear them at load time (IDOK-165).
let registered:Tunnel[]=[]
export function registerTunnels(list:Tunnel[]|undefined){registered=list??[]}
export function treeBlocked(x:number,y:number,z:number){
  for(const tunnel of nearbyTunnels(registered,x,z)){
    const axes=frame(tunnel),at=axes.station(x,z),side=Math.abs(axes.lateral(x,z))
    if(at< -6||at>tunnel.length+6||side>tunnel.halfWidth+3)continue
    const open=(openEnd(tunnel,0)>0&&at<openEnd(tunnel,0)+2)||(openEnd(tunnel,1)>0&&at>tunnel.length-openEnd(tunnel,1)-2)
    const values=profile(tunnel)
    let lo=0,hi=values.count-1
    while(lo<hi){const mid=(lo+hi)>>>1;if(values.at(mid)[0]<at)lo=mid+1;else hi=mid}
    const floor=values.at(lo)[1]
    if(open||y<floor+tunnel.clearance+.6)return true
  }
  return false
}

type Plane=(point:Point)=>number
export function joinPortalRoads(tile:Tile,tunnels:Tunnel[],buffers:Float32Array[]){
  for(const tunnel of tunnels){
    if(tunnel.gradedAccess)continue
    const axes=frame(tunnel)
    for(const [index,portal] of tunnel.portals.entries()){
      if(tunnel.mouths?.[index]===false)continue
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
function clip(poly:Point[],plane:Plane){
  const result:Point[]=[]
  for(let index=0;index<poly.length;index++){
    const a=poly[index],b=poly[(index+1)%poly.length],da=plane(a),db=plane(b)
    if(da>=0)result.push(a)
    if((da<0)!==(db<0))result.push(a.map((value,k)=>value+(b[k]-value)*da/(da-db)) as Point)
  }
  return result
}
function fan(poly:Point[],out:number[]){for(let at=2;at<poly.length;at++)out.push(...poly[0],...poly[at-1],...poly[at])}

export function tunnelGeometry(tile:Tile,ground:THREE.PlaneGeometry,tunnels:Tunnel[]){
  const local=station.nearbyTunnels(tunnels,tile.x,tile.z)
  if(local.some(t=>t.nodes)){
    const mesh=station.tunnelGeometry(tile,ground,local)
    if(mesh)return {...mesh,fringe:undefined}
  }
  tunnels=local.filter(t=>!t.nodes)
  const parts={floor:[] as number[],interior:[] as number[],portal:[] as number[],band:[] as number[],lamp:[] as number[],lane:[] as number[],ceiling:[] as number[]}
  const cuts:Plane[][]=[]
  const limits:Plane[]=[p=>p[0],p=>256-p[0],p=>p[2],p=>256-p[2]]
  const heights=ground.getAttribute('position'), cells=ground.parameters.widthSegments
  function groundY(point:Point){
    const x=THREE.MathUtils.clamp(point[0]/256*cells,0,cells),z=THREE.MathUtils.clamp(point[2]/256*cells,0,cells)
    const col=Math.min(cells-1,Math.floor(x)),row=Math.min(cells-1,Math.floor(z)),u=x-col,v=z-row,idx=row*(cells+1)+col
    const a=heights.getY(idx),b=heights.getY(idx+1),c=heights.getY(idx+cells+1),d=heights.getY(idx+cells+2)
    return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v)
  }
  for(const tunnel of tunnels){
    const [start,end]=tunnel.portals,pad=Math.max(...(tunnel.endWidths??[tunnel.halfWidth]))+1
    if(Math.max(start[0],end[0])+pad<tile.x||Math.min(start[0],end[0])-pad>tile.x+256||Math.max(start[2],end[2])+pad<tile.z||Math.min(start[2],end[2])-pad>tile.z+256)continue
    const axes=frame(tunnel),width=tunnel.halfWidth,head=tunnel.clearance
    function local(s:number,d:number,y:number){const p=axes.point(s,d,y);p[0]-=tile.x;p[2]-=tile.z;return p}
    const station=(p:Point)=>axes.station(p[0]+tile.x,p[2]+tile.z),side=(p:Point)=>axes.lateral(p[0]+tile.x,p[2]+tile.z)
    for(const [from,to] of [[0,openEnd(tunnel,0)],[tunnel.length-openEnd(tunnel,1),tunnel.length]])if(to>from)cuts.push([p=>station(p)-from,p=>to-station(p),p=>halfWidthAt(tunnel,station(p))-side(p),p=>halfWidthAt(tunnel,station(p))+side(p)])
    const quad=(points:Point[],part:keyof typeof parts)=>fan(limits.reduce((poly,plane)=>clip(poly,plane),points),parts[part])
    for(const [i,joint] of (tunnel.joints??[]).entries()){
      if(!joint?.draw)continue
      const floor=tunnel.portals[i][1],ring=jointRing(joint,tunnel.portals[i])
      if(joint.cap&&openEnd(tunnel,i)>0){
        const cx=ring.reduce((sum,p)=>sum+p[0],0)/ring.length
        const cz=ring.reduce((sum,p)=>sum+p[1],0)/ring.length
        cuts.push(ring.map(([x,z],j)=>{
          const [ex,ez]=ring[(j+1)%ring.length]
          const side=Math.sign((ex-x)*(cz-z)-(ez-z)*(cx-x))
          return p=>side*((ex-x)*(p[2]+tile.z-z)-(ez-z)*(p[0]+tile.x-x))
        }))
      }
      quad(ring.map(([x,z])=>[x-tile.x,floor,z-tile.z]),'floor')
      if(!tunnel.mouths?.[i]&&!openEnd(tunnel,i))quad(ring.map(([x,z])=>[x-tile.x,floor+head,z-tile.z]),'ceiling')
    }
    const values=profile(tunnel)
    for(let i=1;i<values.count;i++){
      const [a,ay]=values.at(i-1),[b,by]=values.at(i)
      const open=((a+b)/2<openEnd(tunnel,0))||((a+b)/2>tunnel.length-openEnd(tunnel,1))
      const wa=halfWidthAt(tunnel,a),wb=halfWidthAt(tunnel,b)
      const al=local(a,-wa,ay),ar=local(a,wa,ay),bl=local(b,-wb,by),br=local(b,wb,by)
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
      for(const [s,y] of [[a,ay]])if((tunnel.mouths?.[0]!==false&&Math.abs(s-openEnd(tunnel,0))<1e-6)||(tunnel.mouths?.[1]!==false&&Math.abs(s-tunnel.length+openEnd(tunnel,1))<1e-6)){
        const l=local(s,-width,y+head),r=local(s,width,y+head)
        quad([l,r,[r[0],Math.max(r[1]+.16,groundY(r)),r[2]],[l[0],Math.max(l[1]+.16,groundY(l)),l[2]]],'portal')
      }
    }
  }
  if(!parts.floor.length)return null
  const pos=ground.getAttribute('position'),index=ground.index!,vertices:number[]=[],keep:number[]=[]
  for(let at=0;at<index.count;at+=3){
    const ids=[0,1,2].map(off=>index.getX(at+off)),triangle=ids.map(id=>[pos.getX(id),pos.getY(id),pos.getZ(id)] as Point)
    let pieces=[triangle],changed=false
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
    if(changed)pieces.forEach(poly=>fan(poly,vertices));else keep.push(...ids)
  }
  ground.setIndex(keep)
  const looks:Record<string,THREE.MeshStandardMaterial|THREE.MeshBasicMaterial>={
    road:new THREE.MeshStandardMaterial({side:THREE.DoubleSide,color:0x3b3e42,roughness:.95}),
    interior:new THREE.MeshStandardMaterial({side:THREE.DoubleSide,color:0xcfc8b8,roughness:.9}),
    portal:new THREE.MeshStandardMaterial({side:THREE.DoubleSide,color:0xa39d90,roughness:.92}),
    band:new THREE.MeshStandardMaterial({side:THREE.DoubleSide,color:0x4d7466,roughness:.6}),
    ceiling:new THREE.MeshBasicMaterial({side:THREE.DoubleSide,color:0x9c968a}),
    lamp:new THREE.MeshBasicMaterial({side:THREE.DoubleSide,color:0xffd9a6}),
    lane:new THREE.MeshStandardMaterial({side:THREE.DoubleSide,color:0xeae3cf,roughness:.8}),
    terrain:new THREE.MeshStandardMaterial({side:THREE.DoubleSide,color:0x888888}),
  }
  function mesh(values:number[],kind:string){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(values,3));geometry.computeVertexNormals()
    const item=new THREE.Mesh(geometry,looks[kind]);item.name=`tunnel_${kind}`;item.userData.kind=kind;return item
  }
  const fringe=mesh(vertices,'terrain');fringe.geometry.setAttribute('uv',new THREE.Float32BufferAttribute(vertices.flatMap((v,i)=>i%3===0?[v/256,1-vertices[i+2]/256]:[]),2))
  return {fringe,floor:mesh(parts.floor,'road'),interior:mesh(parts.interior,'interior'),portal:mesh(parts.portal,'portal'),
    band:mesh(parts.band,'band'),ceiling:mesh(parts.ceiling,'ceiling'),lamp:mesh(parts.lamp,'lamp'),lane:mesh(parts.lane,'lane')}
}
