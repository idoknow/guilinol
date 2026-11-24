import * as THREE from 'three'
import type {Tile} from './world'
import railStyle from '../../pipeline/railway-style.json'

type Point=[number,number,number]
export type Tunnel={way:number,portals:[Point,Point],length:number,halfWidth:number,clearance:number,approach:number,approachEnds?:[number,number],mouths?:[boolean,boolean],openEnds?:[number,number],openCut?:boolean,joints?:({ring:[number,number][],draw:boolean}|null)[],stations:[number,number][]}

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
  const axes=frame(tunnel), station=axes.station(x,z)
  // At a shared endpoint, projection onto the two normalized axes can
  // round a few micrometres outside both strips.
  if(station<-.00001||station>tunnel.length+.00001||Math.abs(axes.lateral(x,z))>tunnel.halfWidth+.00001){
    for(const [i,joint] of (tunnel.joints??[]).entries()){
      if(!joint)continue
      let positive=false,negative=false
      const ring=joint.ring
      for(let j=0;j<ring.length;j++){
        const [a,b]=ring[j],[c,d]=ring[(j+1)%ring.length],cross=(c-a)*(z-b)-(d-b)*(x-a)
        positive||=cross>.00001;negative||=cross<-.00001
        if(positive&&negative)break
      }
      if(!(positive&&negative))return tunnel.portals[i][1]
    }
    return
  }
  const at=Math.max(0,Math.min(tunnel.length,station))
  const index=tunnel.stations.findIndex(([s])=>s>=at)
  if(index<0)return tunnel.portals[1][1]
  const [end,high]=tunnel.stations[index],[start,low]=tunnel.stations[Math.max(0,index-1)]
  return low+(high-low)*(at-start)/(end-start||1)
}

export function tunnelFloor(tunnels:Tunnel[]|undefined,x:number,z:number,foot:number){
  for(const tunnel of nearbyTunnels(tunnels,x,z)){
    const floor=floorLevel(tunnel,x,z)
    if(floor!==undefined&&foot>=floor-.75&&foot<floor+tunnel.clearance-.25)return floor
  }
}
// Trees from the base map can stand in a portal cutting or inside the bore; the
// world package predates the tunnel, so clear them at load time (IDOK-165).
let registered:Tunnel[]=[]
export function registerTunnels(list:Tunnel[]|undefined){registered=list??[]}
export function treeBlocked(x:number,y:number,z:number){
  for(const tunnel of nearbyTunnels(registered,x,z)){
    const axes=frame(tunnel),at=axes.station(x,z),side=Math.abs(axes.lateral(x,z))
    if(at< -6||at>tunnel.length+6||side>tunnel.halfWidth+3)continue
    const [first,last]=tunnel.openEnds??tunnel.approachEnds??[tunnel.mouths?.[0]===false?0:tunnel.approach,tunnel.mouths?.[1]===false?0:tunnel.approach]
    const open=at<first+2||at>tunnel.length-last-2
    const index=Math.max(0,tunnel.stations.findIndex(([s])=>s>=at)),floor=tunnel.stations[Math.min(index,tunnel.stations.length-1)][1]
    if(open||y<floor+tunnel.clearance+.6)return true
  }
  return false
}

type Plane=(point:Point)=>number
export function joinPortalRoads(tile:Tile,tunnels:Tunnel[],buffers:Float32Array[]){
  for(const tunnel of tunnels){
    const axes=frame(tunnel)
    const stitch=20
    const margin=stitch+12
    for(const [end,portal] of tunnel.portals.entries()){
      if(tunnel.mouths?.[end]===false)continue
      if(portal[0]<tile.x-margin||portal[0]>tile.x+256+margin||portal[2]<tile.z-margin||portal[2]>tile.z+256+margin)continue
      for(const buffer of buffers)for(let index=0;index<buffer.length;index+=3){
        const x=tile.x+buffer[index],z=tile.z+buffer[index+2],s=axes.station(x,z),d=Math.abs(axes.lateral(x,z))
        const inward=portal===tunnel.portals[0]?s:tunnel.length-s
        // Only stitch the surface approach at the mouth. Vertices deeper
        // into the bore can belong to the street crossing above it.
        if(inward< -stitch||inward>4||d>tunnel.halfWidth+4)continue
        const blend=THREE.MathUtils.smoothstep(inward,-stitch,-stitch/5)*(1-THREE.MathUtils.smoothstep(inward,0,4))*(1-THREE.MathUtils.smoothstep(d,tunnel.halfWidth,tunnel.halfWidth+4))
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
  const cuts:{planes:Plane[],roof?:(point:Point)=>number}[]=[]
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
    const [first,last]=tunnel.openEnds??tunnel.approachEnds??[tunnel.mouths?.[0]===false?0:tunnel.approach,tunnel.mouths?.[1]===false?0:tunnel.approach]
    const footprint=(from:number,to:number):Plane[]=>[p=>station(p)-from,p=>to-station(p),p=>width-side(p),p=>width+side(p)]
    for(const [from,to] of [[0,first],[tunnel.length-last,tunnel.length]])if(to>from)cuts.push({planes:footprint(from,to)})
    if((tunnel.approachEnds||tunnel.mouths)&&first+last<tunnel.length){
      // Carry the upper ground mesh over the entire headroom envelope. A
      // shallow DEM triangle across the entrance otherwise blocks the car.
      const roof=(p:Point)=>{
        const at=THREE.MathUtils.clamp(station(p),0,tunnel.length)
        let lo=0,hi=tunnel.stations.length-1
        while(hi-lo>1){const mid=(lo+hi)>>>1;if(tunnel.stations[mid][0]<=at)lo=mid;else hi=mid}
        const [a,y]=tunnel.stations[lo],[b,h]=tunnel.stations[hi]
        return y+(h-y)*(at-a)/(b-a)+head+railStyle.stationLevels.structureDepth-.35
      }
      cuts.push({planes:footprint(first,tunnel.length-last),roof})
    }
    const quad=(points:Point[],part:keyof typeof parts)=>fan(limits.reduce((poly,plane)=>clip(poly,plane),points),parts[part])
    for(const [i,joint] of (tunnel.joints??[]).entries()){
      if(!joint?.draw)continue
      const floor=tunnel.portals[i][1]
      const covered=!tunnel.openCut&&(i===0?first:last)===0&&!tunnel.mouths?.[i]
      const ring=joint.ring.map(([x,z]):Point=>[x-tile.x,floor,z-tile.z])
      const edges=ring.map((a,n)=>[a,ring[(n+1)%ring.length]])
      const winding=Math.sign(edges.reduce((sum,[a,b])=>sum+a[0]*b[2]-a[2]*b[0],0))
      const planes=edges.map(([a,b])=>(p:Point)=>winding*((b[0]-a[0])*(p[2]-a[2])-(b[2]-a[2])*(p[0]-a[0])))
      // The two rectangular strips leave a wedge at a bend. Carry the same
      // headroom cut through that wedge as through either adjoining section.
      cuts.push({planes,roof:covered?()=>floor+head+railStyle.stationLevels.structureDepth-.35:undefined})
      quad(ring,'floor')
      if(covered)quad(ring.map(([x,,z])=>[x,floor+head,z]),'ceiling')
      for(const [a,b] of edges){
        if(side(a)*side(b)<=0)continue
        const top=(p:Point):Point=>[p[0],covered?floor+head:Math.max(floor,groundY(p)),p[2]]
        quad([a,b,top(b),top(a)],covered?'interior':'portal')
      }
    }
    for(let i=1;i<tunnel.stations.length;i++){
      const [a,ay]=tunnel.stations[i-1],[b,by]=tunnel.stations[i]
      const open=(a+b)/2<first||(a+b)/2>tunnel.length-last
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
      for(const [s,y] of [[a,ay]])if(first>0&&Math.abs(s-first)<1e-6||last>0&&Math.abs(s-tunnel.length+last)<1e-6){
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
    for(const {planes,roof} of cuts){
      const remaining:Point[][]=[]
      for(const piece of pieces){
        if(planes.some(plane=>piece.every(p=>plane(p)<=0))){remaining.push(piece);continue}
        if(roof && piece.every(p=>p[1]>=roof(p))){remaining.push(piece);continue}
        let inside=piece
        for(const plane of planes){const outside=clip(inside,p=>-plane(p));if(outside.length>=3)remaining.push(outside);inside=clip(inside,plane)}
        if(roof && inside.length>=3)fan(inside.map(p=>[p[0],Math.max(p[1],roof(p)),p[2]]),vertices)
        changed=true
      }
      pieces=remaining
    }
    if(changed)pieces.forEach(poly=>fan(poly,vertices));else keep.push(...ids)
  }
  ground.setIndex(keep)
  function mesh(values:number[],material:THREE.Material,kind:string){
    const geometry=new THREE.BufferGeometry()
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(values,3))
    geometry.computeVertexNormals()
    const item=new THREE.Mesh(geometry,material)
    item.name=`tunnel_${kind}`;item.userData.kind=kind
    return item
  }
  const collisionMaterial=new THREE.MeshBasicMaterial({side:THREE.DoubleSide})
  function collider(values:number[],kind:string){
    const result=mesh(values,collisionMaterial,kind)
    result.visible=false
    return result
  }
  const palette={floor:0x3b3e42,interior:0xcfc8b8,portal:0xa39d90,band:0x4d7466,
    lane:0xeae3cf,ceiling:0x9c968a,lamp:0xffd9a6}
  function batch(keys:(keyof typeof parts)[],material:THREE.Material,kind:string){
    const positions:number[]=[],colors:number[]=[]
    for(const key of keys){
      const color=new THREE.Color(palette[key])
      for(let i=0;i<parts[key].length;i+=3){
        positions.push(parts[key][i],parts[key][i+1],parts[key][i+2])
        colors.push(color.r,color.g,color.b)
      }
    }
    const result=mesh(positions,material,kind)
    result.geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3))
    return result
  }
  const fringe=mesh(vertices,new THREE.MeshStandardMaterial(),'terrain')
  fringe.geometry.setAttribute('uv',new THREE.Float32BufferAttribute(vertices.flatMap((v,i)=>i%3===0?[v/256,1-vertices[i+2]/256]:[]),2))
  const lining=batch(['floor','interior','portal','band','lane'],
    new THREE.MeshStandardMaterial({side:THREE.DoubleSide,vertexColors:true,roughness:.9}),'lining')
  const lights=batch(['ceiling','lamp'],new THREE.MeshBasicMaterial({side:THREE.DoubleSide,vertexColors:true}),'lighting')
  return {fringe,lining,lights,floor:collider(parts.floor,'road'),interior:collider(parts.interior,'interior'),portal:collider(parts.portal,'portal')}
}
