import * as THREE from 'three'
import type {Tile} from './world'

type Point=[number,number,number]
export type Tunnel={way:number,portals:[Point,Point],length:number,halfWidth:number,clearance:number,approach:number,stations:[number,number][]}

function frame(tunnel:Tunnel){
  const [start,end]=tunnel.portals, ux=(end[0]-start[0])/tunnel.length,uz=(end[2]-start[2])/tunnel.length
  return {station:(x:number,z:number)=>(x-start[0])*ux+(z-start[2])*uz,
    lateral:(x:number,z:number)=>-(x-start[0])*uz+(z-start[2])*ux,
    point:(at:number,offset:number,y:number):Point=>[start[0]+at*ux-offset*uz,y,start[2]+at*uz+offset*ux]}
}
export function tunnelFloor(tunnels:Tunnel[]|undefined,x:number,z:number,foot:number){
  for(const tunnel of tunnels??[]){
    const axes=frame(tunnel), at=axes.station(x,z)
    if(at<0||at>tunnel.length||Math.abs(axes.lateral(x,z))>tunnel.halfWidth)continue
    const index=tunnel.stations.findIndex(([s])=>s>=at), [end,high]=tunnel.stations[index], [start,low]=tunnel.stations[Math.max(0,index-1)]
    const floor=low+(high-low)*(at-start)/(end-start||1)
    if(foot>=floor-.75&&foot<floor+tunnel.clearance-.25)return floor
  }
  return undefined
}

// Trees from the base map can stand in a portal cutting or inside the bore; the
// world package predates the tunnel, so clear them at load time (IDOK-165).
let registered:Tunnel[]=[]
export function registerTunnels(list:Tunnel[]|undefined){registered=list??[]}
export function treeBlocked(x:number,y:number,z:number){
  for(const tunnel of registered){
    const axes=frame(tunnel),at=axes.station(x,z),side=Math.abs(axes.lateral(x,z))
    if(at< -6||at>tunnel.length+6||side>tunnel.halfWidth+3)continue
    const open=at<tunnel.approach+2||at>tunnel.length-tunnel.approach-2
    const index=Math.max(0,tunnel.stations.findIndex(([s])=>s>=at)),floor=tunnel.stations[Math.min(index,tunnel.stations.length-1)][1]
    if(open||y<floor+tunnel.clearance+.6)return true
  }
  return false
}

type Plane=(point:Point)=>number
export function joinPortalRoads(tile:Tile,tunnels:Tunnel[],buffers:Float32Array[]){
  for(const tunnel of tunnels){
    const axes=frame(tunnel)
    for(const portal of tunnel.portals){
      if(portal[0]<tile.x-32||portal[0]>tile.x+288||portal[2]<tile.z-32||portal[2]>tile.z+288)continue
      for(const buffer of buffers)for(let index=0;index<buffer.length;index+=3){
        const x=tile.x+buffer[index],z=tile.z+buffer[index+2],s=axes.station(x,z),d=Math.abs(axes.lateral(x,z))
        const inward=portal===tunnel.portals[0]?s:tunnel.length-s
        if(inward< -20||inward>30||d>tunnel.halfWidth+4)continue
        const blend=THREE.MathUtils.smoothstep(inward,-20,-4)*(1-THREE.MathUtils.smoothstep(d,tunnel.halfWidth,tunnel.halfWidth+4))
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
    const [start,end]=tunnel.portals,pad=tunnel.halfWidth+1
    if(Math.max(start[0],end[0])+pad<tile.x||Math.min(start[0],end[0])-pad>tile.x+256||Math.max(start[2],end[2])+pad<tile.z||Math.min(start[2],end[2])-pad>tile.z+256)continue
    const axes=frame(tunnel),width=tunnel.halfWidth,head=tunnel.clearance
    function local(s:number,d:number,y:number){const p=axes.point(s,d,y);p[0]-=tile.x;p[2]-=tile.z;return p}
    const station=(p:Point)=>axes.station(p[0]+tile.x,p[2]+tile.z),side=(p:Point)=>axes.lateral(p[0]+tile.x,p[2]+tile.z)
    for(const [from,to] of [[0,tunnel.approach],[tunnel.length-tunnel.approach,tunnel.length]])cuts.push([p=>station(p)-from,p=>to-station(p),p=>width-side(p),p=>width+side(p)])
    const quad=(points:Point[],part:keyof typeof parts)=>fan(limits.reduce((poly,plane)=>clip(poly,plane),points),parts[part])
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
  const looks:Record<string,THREE.Material>={
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
