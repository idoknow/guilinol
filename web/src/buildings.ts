import * as THREE from 'three'
import type {Wall} from './wall-occlusion'
import {buildingColor} from './look/buildings'
import {getBuildingOverride, type BuildingOverride} from './city-upgrade/state'

type Pair=[number,number]
type Vertex=[number,number,number]
export type Building=[number,number,Pair[][],number,number,number,number[],Pair[],number,boolean?,Vertex?]

function orientedRectFromLoop(loop:Pair[]):{center:THREE.Vector2; along:THREE.Vector2; side:THREE.Vector2; halfLen:number; halfWid:number}|null{
  if(loop.length<3)return null
  let bestArea=Infinity, best:{center:THREE.Vector2; along:THREE.Vector2; side:THREE.Vector2; halfLen:number; halfWid:number}|null=null
  const pts=loop.map(([x,z])=>new THREE.Vector2(x/100,z/100))
  for(let i=0;i<pts.length;i++){
    const a=pts[i], b=pts[(i+1)%pts.length]
    const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy)
    if(len<0.5)continue
    const ux=dx/len, uy=dy/len, vx=-uy, vy=ux
    let minU=Infinity, maxU=-Infinity, minV=Infinity, maxV=-Infinity
    for(const p of pts){
      const pu=p.x*ux+p.y*uy, pv=p.x*vx+p.y*vy
      if(pu<minU)minU=pu; if(pu>maxU)maxU=pu
      if(pv<minV)minV=pv; if(pv>maxV)maxV=pv
    }
    const w=maxU-minU, d=maxV-minV, area=w*d
    if(area>4 && area<bestArea){
      bestArea=area
      const cu=(minU+maxU)*0.5, cv=(minV+maxV)*0.5
      const center=new THREE.Vector2(cu*ux+cv*vx, cu*uy+cv*vy)
      if(w>=d) best={center, along:new THREE.Vector2(ux,uy), side:new THREE.Vector2(vx,vy), halfLen:w*0.5, halfWid:d*0.5}
      else best={center, along:new THREE.Vector2(vx,vy), side:new THREE.Vector2(-ux,-uy), halfLen:d*0.5, halfWid:w*0.5}
    }
  }
  return best
}

export function buildingGeometry(
  positions:Int16Array,
  normals:Int8Array,
  indices:Uint32Array,
  parts:Building[],
  tileX?:number,
  tileZ?:number,
){
  const xyz=Array.from(positions,(v,i)=>v/(i%3===1?10:100)),normal=Array.from(normals,v=>v/127),faces=Array.from(indices)
  const count=xyz.length/3,kinds=new Array<number>(count),floor=new Array<number>(count),facade=new Array<number>(count),roofs=new Array<number>(count)
  const customTint:Array<number|undefined>=new Array(count)
  const trim:number[] = [], occlusion:number[] = []
  const occluders:Wall[]=[]
  let cursor=0
  for(let partIdx=0;partIdx<parts.length;partIdx++){
    const part=parts[partIdx]
    const [base,origTop,loops,origKind,origFloors,seed,anchor,rectangle,complex,raised,walkPlane]=part
    const startVertex=cursor
    const ov:BuildingOverride|undefined = !walkPlane && tileX!==undefined && tileZ!==undefined ? getBuildingOverride(tileX,tileZ,partIdx) : undefined
    const baseY=base/10
    const level=ov ? baseY+ov.h : origTop/10
    const floors=ov ? ov.f : origFloors
    // Keep collision rings top & floor count synced when city-upgrade CMAB height override is active
    if(ov){ part[1]=Math.round(level*10); part[4]=floors }
    const hasShop=!!ov && ov.s>=0
    const kind=ov ? (hasShop ? 32 + ov.u + ov.s*8 : 16 + ov.u) : origKind
    const aviation=origKind>=5&&origKind<=7
    const roofTint=ov ? (ov.r===1 ? 0x50575a : ov.r===2 ? 0x2f6c56 : ov.r===3 ? 0x747779 : 0x6f7274) : aviation ? 0xa4a8a5 : undefined
    const wallTint=ov ? ov.c : aviation ? 0xd6d9d5 : undefined

    function tag(index:number,isRoof:number,f:number,u:number,tintHex?:number){
      kinds[index]=kind;floor[index]=f;facade[index]=u;roofs[index]=isRoof
      if(tintHex!==undefined)customTint[index]=tintHex
    }
    function face(corners:Vertex[], details=false, tintHex?:number){
      const start=xyz.length/3,points=corners.map(p=>new THREE.Vector3(...p))
      const n=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize()
      for(const p of corners){tag(xyz.length/3,1,floors,0,tintHex??roofTint);xyz.push(...p);normal.push(n.x,n.y,n.z)}
      for(let i=1;i+1<corners.length;i++)(details?trim:faces).push(start,start+i,start+i+1)
    }
    function addBox(cx:number,y0:number,cz:number,sx:number,sy:number,sz:number,tintHex:number,details=true){
      const hx=sx*0.5, hz=sz*0.5, y1=y0+sy
      const lid:Vertex[]=[[cx-hx,y1,cz-hz],[cx-hx,y1,cz+hz],[cx+hx,y1,cz+hz],[cx+hx,y1,cz-hz]]
      face(lid,details,tintHex)
      for(let i=0;i<4;i++){const a=lid[i],b=lid[(i+1)%4];face([a,[a[0],y0,a[2]],[b[0],y0,b[2]],b],details,tintHex)}
    }

    // 1) Roof cap vertices (elevate to CMAB level if overridden)
    for(const loop of loops)for(let i=0;i<loop.length;i++){
      if(ov) xyz[3*cursor+1]=level
      tag(cursor++,1,floors,0,roofTint)
    }

    // 2) Wall quads
    for(const loop of loops){let u=0
      for(let i=0;i<loop.length;i++){
        const [x,z]=loop[i].map(v=>v/100),[ex,ez]=loop[(i+1)%loop.length].map(v=>v/100),len=Math.hypot(ex-x,ez-z)
        const at=cursor*3
        if(cursor+3>=count || normals[at+1]!==0 ||
           positions[at]!==loop[i][0] || positions[at+2]!==loop[i][1] ||
           positions[at+6]!==loop[(i+1)%loop.length][0] ||
           positions[at+8]!==loop[(i+1)%loop.length][1])continue
        // GL04 packs each opaque quad as 0:bottom A, 1:top A, 2:top B, 3:bottom B
        if(ov){
          xyz[at+4]=level
          xyz[at+7]=level
        }
        const low=Math.max(xyz[at+1],xyz[at+10])
        const high=Math.min(xyz[at+4],xyz[at+7])
        if(len>=3&&high-low>=2)occluders.push([x,z,ex,ez,low,high])
        // Viewer-right along outward normal N is Up x N = (nz, 0, -nx). Flip U when edge runs R->L so details read L->R!
        const flipU = ov !== undefined && ((ex - x) * normals[at + 2] - (ez - z) * normals[at]) < 0
        for(const end of [false,false,true,true]){
          const index=cursor++, height=xyz[3*index+1]-baseY
          // Ground floor shopfront occupies exact 3.8m -> vFloor [0..1]; upper storeys 3.1m each
          const fVal=hasShop ? (height<=3.8 ? height/3.8 : 1+(height-3.8)/3.1) : height/3.1
          const uVal=end?u+len:u
          tag(index,0,fVal,flipU?-uVal:uVal,wallTint)
          const k=end?(i+1)%loop.length:i
          const prev=loop[(k+loop.length-1)%loop.length], next=loop[(k+1)%loop.length], corner=loop[k]
          const cross=(corner[0]-prev[0])*(next[1]-corner[1])-(corner[1]-prev[1])*(next[0]-corner[0])
          occlusion[index]=(height<.1?.90:1)*(cross<0?.97:1)
        }
        u+=len
        const isEdgeClipped=(x===ex&&(x===0||x===256))||(z===ez&&(z===0||z===256))
        if(ov && (ov.r===0||ov.r===3) && !isEdgeClipped){
          const ph=ov.r===3 ? 1.25 : 1.05
          face([[x,level,z],[x,level+ph,z],[ex,level+ph,ez],[ex,level,ez]],true,wallTint)
          const dx=ex-x, dz=ez-z, l=len||1, inX=-dz/l*0.26, inZ=dx/l*0.26
          face([[x,level+ph,z],[x+inX,level+ph,z+inZ],[ex+inX,level+ph,ez+inZ],[ex,level+ph,ez]],true,0x8a8c8d)
        } else if(!ov && (!origKind||aviation) && !isEdgeClipped){
          face([[x,level,z],[x,level+.9,z],[ex,level+.9,ez],[ex,level,ez]],true)
        }
      }
    }
    if(walkPlane){
      const [dx,dz,intercept]=walkPlane
      for(let i=startVertex;i<cursor;i++){
        const at=i*3
        xyz[at+1]+=dx*xyz[at]+dz*xyz[at+2]+intercept-level
        if(normal[at+1]>0){const length=Math.hypot(dx,1,dz);normal[at]=-dx/length;normal[at+1]=1/length;normal[at+2]=-dz/length}
      }
      continue
    }
    if(raised){
      const contours=loops.map(loop=>loop.map(([x,z])=>new THREE.Vector2(x/100,z/100)))
      const vertices=contours.flat()
      for(const triangle of THREE.ShapeUtils.triangulateShape(contours[0],contours.slice(1))){
        face(triangle.map(i=>[vertices[i].x,baseY,vertices[i].y]))
      }
    }

    // 3) Rooftop details / pitched & green-glazed roofs
    if(ov){
      let cx=0, cz=0
      if(anchor.length){ [cx,cz]=anchor.map(v=>v/100) }
      else if(loops[0]?.length){
        for(const p of loops[0]){ cx+=p[0]/100; cz+=p[1]/100 }
        cx/=loops[0].length; cz/=loops[0].length
      }
      const inTile=cx>=2 && cx<=254 && cz>=2 && cz<=254
      if(inTile && (ov.r===1 || ov.r===2)){
        const obb=orientedRectFromLoop(loops[0])
        if(obb && obb.halfWid>=2.0 && obb.halfLen>=2.5){
          const {center,along,side,halfLen,halfWid}=obb
          const hl=halfLen+0.55, hw=halfWid+0.55
          const pt=(x:number,y:number,z:number):Vertex=>[center.x+x*along.x+z*side.x,y,center.y+x*along.y+z*side.y]
          const ridge=Math.max(0, hl-(ov.r===2 ? Math.min(hw,hl) : hw*0.35))
          const rh=level+Math.min(4.8, hw*Math.tan((26+seed%5)*Math.PI/180))
          const a=pt(-hl,level,-hw), b=pt(hl,level,-hw), c=pt(hl,level,hw), d=pt(-hl,level,hw)
          const st=pt(-ridge,rh,0), en=pt(ridge,rh,0)
          const rt=ov.r===2 ? 0x2c6d56 : 0x4b5156
          face([a,b,en,st],false,rt); face([d,st,en,c],false,rt); face([a,st,d],false,rt); face([b,c,en],false,rt)
          continue
        }
      }
      if(inTile && (ov.r===0 || ov.r===3)){
        const pw=2.8+(seed%3)*0.6, pd=3.2+((seed>>2)%3)*0.6, ph=ov.r===3 ? 2.8 : 2.3
        addBox(cx-0.8, level, cz-0.6, pw, ph, pd, wallTint??0xdcdad2, true)
        addBox(cx-0.8, level+ph, cz-0.6, pw+0.24, 0.16, pd+0.24, 0x626668, true)
        addBox(cx+2.1, level+0.5, cz+1.3, 1.3, 1.45, 1.3, 0xbec4c8, true)
        if((seed>>3)%2===0){
          addBox(cx-2.4, level+0.3, cz+1.7, 1.8, 0.75, 1.1, 0x3b4858, true)
        }
      }
      continue
    }

    if(aviation&&anchor.length){
      addBox(anchor[0]/100,level,anchor[1]/100,1.6,.85,1.3,0x818c8c)
    }
    if(!anchor.length||origKind>=3)continue
    const [cx,cz]=anchor.map(v=>v/100)
    if(!origKind){for(let box=0;box<seed%3;box++){
      const x=cx+box*2-1,z=cz-1,h=level+1.7
      const lid:Vertex[]=[[x,h,z],[x,h,z+1.6],[x+1.6,h,z+1.6],[x+1.6,h,z]];face(lid,true)
      for(let i=0;i<4;i++){const a=lid[i],b=lid[(i+1)%4];face([a,[a[0],level,a[2]],[b[0],level,b[2]],b],true)}
    }continue}
    const corners=rectangle.map(([x,z])=>new THREE.Vector2(cx+x/100,cz+z/100)),length=(i:number)=>corners[i].distanceTo(corners[(i+1)%4])
    if(length(0)<length(1))corners.push(corners.shift()!)
    const along=corners[1].clone().sub(corners[0]).normalize(),side=corners[3].clone().sub(corners[0]).normalize()
    const center=corners[0].clone().lerp(corners[2],.5),halfWidth=length(1)/2+.6,halfLength=length(0)/2+.6
    function pt(x:number,y:number,z:number):Vertex{return [center.x+x*along.x+z*side.x,y,center.y+x*along.y+z*side.y]}
    const ridge=halfLength-(complex||origKind===2?Math.min(halfWidth,halfLength):0),height=level+halfWidth*Math.tan((28+seed%5)*Math.PI/180)
    const a=pt(-halfLength,level,-halfWidth),b=pt(halfLength,level,-halfWidth),c=pt(halfLength,level,halfWidth),d=pt(-halfLength,level,halfWidth)
    const start=pt(-ridge,height,0),end=pt(ridge,height,0)
    face([a,b,end,start]);face([d,start,end,c]);face([a,start,d]);face([b,c,end])
  }
  const geom=new THREE.BufferGeometry(),colors:number[]=new Array(kinds.length*3)
  const tmpColor=new THREE.Color()
  kinds.forEach((kind,i)=>{
    if(customTint[i]!==undefined){
      tmpColor.setHex(customTint[i]!).toArray(colors,i*3)
    }else{
      buildingColor(kind,!!roofs[i],normal[3*i+1],colors,i*3)
    }
    const shade=occlusion[i]??1
    for(let channel=0;channel<3;channel++)colors[i*3+channel]*=shade
  })
  geom.userData.occluders=occluders
  geom.userData.farIndexCount=faces.length
  for(const [name,values,size] of [['position',xyz,3],['normal',normal,3],['color',colors,3],['aFloor',floor,1],['aFacade',facade,1]] as const)
    geom.setAttribute(name,new THREE.Float32BufferAttribute(values,size))
  geom.setAttribute('aKind',new THREE.Uint8BufferAttribute(kinds,1));geom.setAttribute('aRoof',new THREE.Uint8BufferAttribute(roofs,1));geom.setIndex(faces.concat(trim));return geom
}
