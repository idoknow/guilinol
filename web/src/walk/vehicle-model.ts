import {accessories,cowlLamp,steeringZ} from './ebike-mounts'
import {bikeGeometry} from './ebike-geometry'
import * as T from 'three'
import {CAR_SCALE} from '../drive/scale'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import type {TwoWheelHeadlightMode} from './ebike-state-coupling'
import {createHeadlightBeamRig, type HeadlightBeamProbe} from './vehicle-lights.ts'

const material=new T.MeshStandardMaterial({vertexColors:true,flatShading:true})
const cache=new Map<string,T.BufferGeometry>()
const upAxis=new T.Vector3(0,1,0),dirVec=new T.Vector3(),qTmp=new T.Quaternion()
let crankGeom:T.BufferGeometry|null=null

function paintGeom(shape:T.BufferGeometry,color:number,x:number,y:number,z:number){
  shape.translate(x,y,z);const tint=new T.Color(color),colors:number[]=[]
  for(let vertex=0;vertex<shape.attributes.position.count;vertex++)colors.push(tint.r,tint.g,tint.b)
  shape.setAttribute('color',new T.Float32BufferAttribute(colors,3))
  return shape
}

function getBicycleCrank(){
  if(!crankGeom){
    const parts=[
      paintGeom(new T.CylinderGeometry(.014,.014,.15,6).rotateZ(Math.PI/2),0xb8bec2,0,0,0),
      paintGeom(new T.BoxGeometry(.016,.16,.026),0xb8bec2,-.068,.075,0),
      paintGeom(new T.BoxGeometry(.085,.024,.068),0x2b2e30,-.115,.15,0),
      paintGeom(new T.BoxGeometry(.016,.16,.026),0xb8bec2,.068,-.075,0),
      paintGeom(new T.BoxGeometry(.085,.024,.068),0x2b2e30,.115,-.15,0),
    ]
    crankGeom=mergeGeometries(parts);for(const p of parts)p.dispose()
  }
  return crankGeom
}

export interface StaticBikeVisualOptions {
  paintColor?: number
  underglow?: boolean
  underglowColor?: number
  angelEye?: boolean
  angelEyeColor?: number
  goldShock?: boolean
  tailWing?: boolean
  exhaust?: boolean
  windshield?: 'none' | 'clear' | 'tinted'
  topbox?: 'none' | 'commuter' | 'delivery'
  headlightTier?: 0 | 1 | 2
}

export function vehicleModel(kind:string,paint=0,options?:{shared?:boolean;distant?:boolean;visual?:StaticBikeVisualOptions}){
  const isSharedBike=kind==='shared_bike'||(kind==='bike'&&!!options?.shared)
  const effectiveKind=isSharedBike?'shared_bike':kind
  const vis=effectiveKind==='bike'?options?.visual:undefined
  const visKey=vis
    ? `:${vis.paintColor??''}:${vis.windshield??'none'}:${vis.topbox??'none'}:${vis.goldShock?1:0}:${vis.tailWing?1:0}:${vis.exhaust?1:0}:${vis.angelEye?(vis.angelEyeColor??1):0}:${vis.underglow?(vis.underglowColor??1):0}:${vis.headlightTier??0}`
    : ''
  const key=effectiveKind+paint+visKey+(options?.distant?':far':'')
  if(effectiveKind==='car'){
    if(!cache.has(key)){const g=buildCarGeometry(paint);g.scale(CAR_SCALE,CAR_SCALE,CAR_SCALE);g.computeBoundingSphere();g.computeBoundingBox();cache.set(key,g)}
    const mesh=new T.Mesh(cache.get(key),material);mesh.name=kind;mesh.userData.paint=paint;return mesh
  }
  if(!cache.has(key)){
    const parts:T.BufferGeometry[]=[]
    function part(shape:T.BufferGeometry,color:number,x:number,y:number,z:number){parts.push(paintGeom(shape,color,x,y,z))}
    function box(width:number,height:number,depth:number,x:number,y:number,z:number,color:number){part(new T.BoxGeometry(width,height,depth),color,x,y,z)}
    function tube(r:number,x1:number,y1:number,z1:number,x2:number,y2:number,z2:number,color:number,segs=6){
      const dx=x2-x1,dy=y2-y1,dz=z2-z1,len=Math.hypot(dx,dy,dz);if(len<1e-4)return
      const g=new T.CylinderGeometry(r,r,len,segs)
      qTmp.setFromUnitVectors(upAxis,dirVec.set(dx/len,dy/len,dz/len));g.applyQuaternion(qTmp)
      part(g,color,(x1+x2)/2,(y1+y2)/2,(z1+z2)/2)
    }
    if(effectiveKind==='bike'||isSharedBike){
      const color=isSharedBike?EBIKE_SHARED_COLOR:vis?.paintColor??EBIKE_STOCK_PAINTS[((paint%4)+4)%4]
      const shell=bikeGeometry(color,options?.distant)
      shell.setAttribute('uv',new T.BufferAttribute(new Float32Array(shell.attributes.position.count*2),2))
      parts.push(shell)
      if(vis)accessories(vis,color,(_joint,geom,tint)=>part(geom,tint,0,0,0))
    }else if(effectiveKind==='bicycle'){
      // Guilin muted city palette (sage, terracotta, linen ivory, karst slate) — no commercial bike-share brand colors or logos.
      const frameColor=[0x5b8a72,0xc96f53,0xd8cfc0,0x5c6e7e][paint%4]
      const alloy=0xb8bec2,dark=0x2b2e30,saddle=0x423832,basket=0x6f7577,rattan=0xa68963
      for(const z of [-.54,.54]){
        part(new T.TorusGeometry(.304,.026,7,18).rotateY(Math.PI/2),dark,0,.33,z)
        part(new T.TorusGeometry(.272,.011,6,18).rotateY(Math.PI/2),alloy,0,.33,z)
        part(new T.CylinderGeometry(.024,.024,.072,8).rotateZ(Math.PI/2),alloy,0,.33,z)
        for(let s=0;s<4;s++)part(new T.CylinderGeometry(.005,.005,.53,4).rotateX(s*Math.PI/4),0xa5acb0,0,.33,z)
      }
      part(new T.TorusGeometry(.336,.016,5,12,Math.PI*.78).rotateY(Math.PI/2).rotateX(-.22),frameColor,0,.33,.54)
      part(new T.CylinderGeometry(.032,.032,.09,8).rotateZ(Math.PI/2),alloy,0,.29,.05)
      tube(.020,0,.61,-.44,0,.79,-.40,frameColor,7)
      box(.095,.026,.034,0,.61,-.44,frameColor)
      for(const side of [-1,1]){
        tube(.013,side*.038,.61,-.44,side*.044,.33,-.54,frameColor,6)
        tube(.011,side*.036,.29,.05,side*.044,.33,.54,frameColor,5)
        tube(.011,side*.032,.67,.17,side*.044,.33,.54,frameColor,5)
      }
      tube(.017,0,.29,.05,0,.72,.19,frameColor,7)
      tube(.013,0,.72,.19,0,.82,.22,alloy,6)
      tube(.019,0,.64,-.43,0,.29,.05,frameColor,7)
      tube(.016,0,.74,-.41,0,.58,.14,frameColor,7)
      box(.15,.048,.25,0,.835,.22,saddle);box(.075,.038,.10,0,.832,.10,saddle)
      tube(.014,0,.79,-.40,0,.97,-.38,alloy,6);tube(.014,0,.97,-.38,0,.98,-.42,alloy,6)
      tube(.013,-.16,.98,-.42,.16,.98,-.42,alloy,6)
      for(const side of [-1,1]){
        tube(.013,side*.16,.98,-.42,side*.28,.99,-.35,alloy,6)
        tube(.019,side*.20,.984,-.395,side*.29,.992,-.345,saddle,6)
      }
      part(new T.CylinderGeometry(.022,.022,.018,8),0xd4b46a,.13,1.005,-.42)
      part(new T.CylinderGeometry(.082,.082,.012,12).rotateZ(Math.PI/2),0x676c70,.048,.29,.05)
      tube(.008,.048,.36,.05,.048,.35,.54,0x525659,4)
      // Front wire basket
      box(.08,.022,.10,0,.75,-.47,alloy)
      box(.26,.018,.19,0,.74,-.56,rattan)
      for(const ry of [.83,.92]){
        const spread=ry>.88?1:.93
        for(const side of [-1,1]){
          box(.014,.014,.22*spread,side*.15*spread,ry,-.56,basket)
          box(.30*spread,.014,.014,0,ry,-.56+side*.11*spread,basket)
        }
      }
      for(const sx of [-1,1])for(const sz of [-1,1])tube(.008,sx*.13,.74,-.56+sz*.095,sx*.15,.92,-.56+sz*.11,basket,4)
      for(const side of [-1,1]){
        tube(.007,0,.74,-.56+side*.095,0,.92,-.56+side*.11,basket,4)
        tube(.007,side*.13,.74,-.56,side*.15,.92,-.56,basket,4)
      }
    }else if(kind==='raft'||kind==='freeRaft'){
      for(let pole=-3;pole<=3;pole++)part(new T.CylinderGeometry(.1,.12,4.3,8).rotateX(Math.PI/2),0xae905b,pole*.19,.1,0)
      box(1.1,.26,.46,0,.33,0,0x72573e)
    }else if(kind==='rowboat'){
      // Four-Lakes wooden rowboat: 3.40 m x 1.34 m (<= 1.35 m), gunwale/oar top 0.413 m (<= 0.52 m roof even with wave roll), 1 draw call.
      box(.88,.12,1.96,0,.02,0,0x6b4d35)
      box(.64,.12,.62,0,.06,-1.24,0x6b4d35)
      box(.68,.12,.56,0,.06,1.21,0x6b4d35)
      box(.32,.18,.30,0,.17,-1.55,0x856242)
      box(.34,.06,.18,0,.29,-1.61,0xa54032)
      box(.48,.20,.42,0,.16,1.49,0x856242)
      box(.78,.04,1.90,0,.10,0,0xb8956c)
      for(const side of [-1,1]){
        box(.09,.30,1.96,side*.54,.21,0,0x96704c)
        part(new T.BoxGeometry(.09,.28,.76).rotateY(side*.34),0x96704c,side*.41,.22,-1.24)
        part(new T.BoxGeometry(.09,.28,.72).rotateY(-side*.30),0x96704c,side*.43,.22,1.22)
        box(.11,.04,1.98,side*.55,.37,0,0xc4a47a)
        part(new T.BoxGeometry(.05,.045,1.68).rotateY(-side*.04),0xc9ab81,side*.60,.39,.14)
        box(.10,.035,.36,side*.62,.39,.86,0xa54032)
      }
      box(1.04,.08,.36,0,.24,.06,0x72573e)
      box(.92,.07,.30,0,.23,-.68,0x72573e)
    }else if(kind==='boat' && paint===1){
      box(2.2,.34,5.8,0,.16,0,0xf2efe6)
      box(1.96,.49,4.95,0,.58,.04,0x72868b)
      for(const side of [-1,1])for(const station of [-2,-1,0,1,2])box(.06,.49,.07,side*.99,.58,station,0xf2efe6)
      box(2.2,.12,5.3,0,.87,0,0xf5f1e9)
      for(const side of [-1,1])for(const station of [-2,0,2])box(.06,.80,.06,side*.94,1.33,station,0xffeee6)
      box(2.23,.11,4.8,0,1.78,0,0xd799ab)
    }else{
      box(2.2,.38,5.8,0,.13,0,0xe9e6dd);box(1.95,.12,5.4,0,.37,0,0x95724e)
      box(1.4,.28,.42,0,.58,0,0x72573e)
      for(const side of [-1,1])for(const z of [-1.9,0,1.9])box(.11,1.19,.11,side*.88,1.01,z,0xa54032)
      for(const side of [-1,1])part(new T.BoxGeometry(1.25,.12,4.8).rotateZ(-side*.22),0x61666a,side*.58,1.7,0)
    }
    cache.set(key,mergeGeometries(parts));for(const part of parts)part.dispose()
  }
  const mesh=new T.Mesh(cache.get(key),material);mesh.name=kind==='shared_bike'?'bike':kind;mesh.userData.paint=paint;mesh.userData.shared=isSharedBike;mesh.userData.vehicleType=isSharedBike?'shared':kind==='bike'?'normal':kind
  if(effectiveKind==='bicycle'){
    const crank=new T.Mesh(getBicycleCrank(),material)
    crank.name='Crank';crank.position.set(0,.29,.05)
    mesh.add(crank)
  }
  return mesh
}

// Four understated Guilin street sedan finishes: pearl ivory, Lijiang slate blue, karst silver, osmanthus burgundy.
const CAR_PAINTS=[0xf0ede6,0x365b77,0x8c949c,0x8f3330] as const

const CAR_WHEEL_PALETTE={
  underbody:0x191b1d,chrome:0xc5cdd3,alloy:0xcfd5da,alloyInner:0x7c838a,tireRubber:0x26292c,brakeBright:0xe8483e,
}

function appendCarWheelParts(
  emit:(raw:T.BufferGeometry,color:number,x?:number,y?:number,z?:number)=>void,
  box:(w:number,h:number,d:number,x:number,y:number,z:number,color:number)=>void,
  side:-1|1,wx:number,wy:number,wz:number,includeCaliper:boolean,
){
  const {underbody,chrome,alloy,alloyInner,tireRubber,brakeBright}=CAR_WHEEL_PALETTE
  const tireTorus=new T.TorusGeometry(.232,.074,4,10);tireTorus.rotateY(Math.PI/2)
  emit(tireTorus,tireRubber,wx,wy,wz)
  const tread=new T.CylinderGeometry(.244,.244,.195,10,1,true);tread.rotateZ(Math.PI/2)
  emit(tread,tireRubber,wx,wy,wz)
  const rimLip=new T.TorusGeometry(.184,.015,3,8);rimLip.rotateY(Math.PI/2)
  emit(rimLip,alloy,wx+side*.086,wy,wz)
  const barrel=new T.CylinderGeometry(.182,.182,.15,8,1,true);barrel.rotateZ(Math.PI/2)
  emit(barrel,underbody,wx,wy,wz)
  const rotor=new T.CylinderGeometry(.140,.140,.022,7);rotor.rotateZ(Math.PI/2)
  emit(rotor,alloyInner,wx+side*.046,wy,wz)
  if(includeCaliper)box(.045,.092,.062,wx+side*.052,wy+.02,wz-.09,brakeBright)
  for(let s=0;s<5;s++){
    const ang=(s*Math.PI*2)/5+.18,rMid=.10
    const spoke=new T.BoxGeometry(.026,.158,.034);spoke.rotateX(ang)
    emit(spoke,alloy,wx+side*.088,wy+Math.cos(ang)*rMid,wz+Math.sin(ang)*rMid)
  }
  const hub=new T.CylinderGeometry(.044,.048,.030,6);hub.rotateZ(Math.PI/2)
  emit(hub,chrome,wx+side*.092,wy,wz)
}

function buildCarWheelGeometry(side:-1|1):T.BufferGeometry{
  const key=`car_wheel_${side}`
  const existing=cache.get(key)
  if(existing)return existing
  const parts:T.BufferGeometry[]=[]
  const emit=(raw:T.BufferGeometry,color:number,x=0,y=0,z=0)=>{
    const g=raw.index?raw.toNonIndexed():raw
    if(g!==raw)raw.dispose()
    if(x||y||z)g.translate(x,y,z)
    g.deleteAttribute('uv')
    const count=g.attributes.position.count,c=new T.Color(color),colors=new Float32Array(count*3)
    for(let i=0;i<count;i++){colors[i*3]=c.r;colors[i*3+1]=c.g;colors[i*3+2]=c.b}
    g.setAttribute('color',new T.BufferAttribute(colors,3))
    parts.push(g)
  }
  const box=(w:number,h:number,d:number,x:number,y:number,z:number,color:number)=>emit(new T.BoxGeometry(w,h,d),color,x,y,z)
  appendCarWheelParts(emit,box,side,0,0,0,false)
  const merged=mergeGeometries(parts,false)
  for(const p of parts)p.dispose()
  merged.computeVertexNormals()
  cache.set(key,merged)
  return merged
}

function buildCarGeometry(paint=0,includeWheels=true):T.BufferGeometry{
  const bodyHex=CAR_PAINTS[((paint%4)+4)%4]
  const bodyCol=new T.Color(bodyHex)
  const shadeHex=bodyCol.clone().multiplyScalar(.88).getHex()
  const trimDark=0x222528,underbody=0x191b1d,glass=0x20343f,glassTop=0x16242c,pillarBlack=0x1c2024
  const chrome=0xc5cdd3,alloy=0xcfd5da,alloyInner=0x7c838a,tireRubber=0x26292c
  const headlamp=0xf8f4e3,drlIce=0xe3f2f8,amber=0xe59a38,tailRed=0xcc332b,brakeBright=0xe8483e
  const reverseWhite=0xefeee8,mirrorGlass=0xadc3cf,plateBlue=0x2a579e
  const parts:T.BufferGeometry[]=[]

  function emit(raw:T.BufferGeometry,color:number,x=0,y=0,z=0){
    const g=raw.index?raw.toNonIndexed():raw
    if(g!==raw)raw.dispose()
    if(x||y||z)g.translate(x,y,z)
    g.deleteAttribute('uv')
    const count=g.attributes.position.count,c=new T.Color(color),colors=new Float32Array(count*3)
    for(let i=0;i<count;i++){colors[i*3]=c.r;colors[i*3+1]=c.g;colors[i*3+2]=c.b}
    g.setAttribute('color',new T.BufferAttribute(colors,3))
    parts.push(g)
  }

  function box(w:number,h:number,d:number,x:number,y:number,z:number,color:number,rx=0,ry=0,rz=0){
    const g=new T.BoxGeometry(w,h,d)
    if(rx)g.rotateX(rx);if(ry)g.rotateY(ry);if(rz)g.rotateZ(rz)
    emit(g,color,x,y,z)
  }

  function archLift(z:number):[number,number]{
    for(const wz of [-1.34,1.31]){
      const dz=Math.abs(z-wz)
      if(dz<.375){
        const h=Math.sqrt(Math.max(0,.375*.375-dz*dz))
        return [.175+h*1.02,.022*(h/.375)]
      }
    }
    return [0,0]
  }

  const rawStations:[number,number,number,number,number,number,number,number][]=[
    [-2.23,.23,.63,.68,.66,.74,.72,.58],
    [-2.15,.19,.69,.75,.76,.84,.82,.68],
    [-1.96,.18,.75,.80,.82,.89,.86,.75],
    [-1.68,.175,.80,.83,.84,.905,.875,.78],
    [-1.51,.175,.82,.845,.84,.91,.88,.79],
    [-1.34,.175,.835,.86,.84,.91,.885,.795],
    [-1.17,.175,.845,.87,.84,.91,.885,.80],
    [-.98,.17,.855,.88,.84,.91,.885,.80],
    [-.84,.17,.865,.89,.84,.91,.885,.795],
    [-.55,.17,.88,1.16,.84,.91,.88,.72],
    [-.25,.17,.895,1.415,.84,.91,.875,.645],
    [.16,.17,.91,1.445,.84,.91,.875,.645],
    [.58,.17,.925,1.41,.84,.91,.875,.64],
    [.92,.175,.94,1.19,.84,.91,.875,.69],
    [1.14,.18,.95,.98,.84,.91,.88,.76],
    [1.31,.18,.955,.98,.84,.91,.88,.765],
    [1.48,.185,.96,.98,.835,.905,.875,.76],
    [1.68,.19,.965,.985,.825,.895,.865,.75],
    [1.98,.205,.955,.99,.79,.86,.83,.71],
    [2.16,.225,.90,.94,.74,.81,.78,.66],
    [2.23,.26,.80,.85,.65,.72,.69,.57],
  ]

  const stations=rawStations.map(([z,yBot,yBelt,yTop,wBot,wFlank,wBelt,wTop])=>{
    const [archY,flare]=archLift(z)
    const ySill=Math.max(yBot+.04,archY),yWaist=Math.max(ySill+.07,yBelt-.15)
    return {z,yBot,ySill,yWaist,yBelt,yTop,wBot,wFlank:wFlank+flare,wBelt,wTop}
  })

  const rings=stations.map(s=>{
    const z=s.z,crown=s.yTop>1.02?.022:.014
    return [
      [-s.wBot*.55,s.yBot,z],
      [-s.wBot,s.ySill,z],
      [-s.wFlank,(s.ySill+s.yWaist)*.5,z],
      [-s.wFlank,s.yWaist,z],
      [-s.wBelt,s.yBelt,z],
      [-(s.wBelt*.32+s.wTop*.68),(s.yBelt*.35+s.yTop*.65),z],
      [-s.wTop,s.yTop-crown*.45,z],
      [-s.wTop*.42,s.yTop+crown,z],
      [s.wTop*.42,s.yTop+crown,z],
      [s.wTop,s.yTop-crown*.45,z],
      [(s.wBelt*.32+s.wTop*.68),(s.yBelt*.35+s.yTop*.65),z],
      [s.wBelt,s.yBelt,z],
      [s.wFlank,s.yWaist,z],
      [s.wFlank,(s.ySill+s.yWaist)*.5,z],
      [s.wBot,s.ySill,z],
      [s.wBot*.55,s.yBot,z],
    ] as [number,number,number][]
  })

  const shellPos:number[]=[],shellCol:number[]=[],tmpCol=new T.Color()
  function pushTri(a:[number,number,number],b:[number,number,number],c:[number,number,number],hex:number){
    tmpCol.setHex(hex)
    shellPos.push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2])
    for(let i=0;i<3;i++)shellCol.push(tmpCol.r,tmpCol.g,tmpCol.b)
  }
  function pushQuadOut(a:[number,number,number],b:[number,number,number],c:[number,number,number],d:[number,number,number],nx:number,ny:number,nz:number,hex:number){
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2]
    const cx=uy*vz-uz*vy,cy=uz*vx-ux*vz,cz=ux*vy-uy*vx
    if(cx*nx+cy*ny+cz*nz>=0){pushTri(a,b,c,hex);pushTri(a,c,d,hex)}
    else{pushTri(a,c,b,hex);pushTri(a,d,c,hex)}
  }
  function stationAt(z:number){
    if(z<=stations[0].z)return {...stations[0]}
    const last=stations[stations.length-1]
    if(z>=last.z)return {...last}
    for(let i=0;i<stations.length-1;i++){
      const s0=stations[i],s1=stations[i+1]
      if(z<=s1.z){
        const t=(z-s0.z)/Math.max(1e-6,s1.z-s0.z)
        return {
          z,
          yBot:s0.yBot+(s1.yBot-s0.yBot)*t,
          ySill:s0.ySill+(s1.ySill-s0.ySill)*t,
          yWaist:s0.yWaist+(s1.yWaist-s0.yWaist)*t,
          yBelt:s0.yBelt+(s1.yBelt-s0.yBelt)*t,
          yTop:s0.yTop+(s1.yTop-s0.yTop)*t,
          wBot:s0.wBot+(s1.wBot-s0.wBot)*t,
          wFlank:s0.wFlank+(s1.wFlank-s0.wFlank)*t,
          wBelt:s0.wBelt+(s1.wBelt-s0.wBelt)*t,
          wTop:s0.wTop+(s1.wTop-s0.wTop)*t,
        }
      }
    }
    return {...last}
  }
  function roofPt(z:number,xFrac:number,ny:number,nz:number,lift:number):[number,number,number]{
    const s=stationAt(z),crown=s.yTop>1.02?.022:.014,ax=Math.abs(xFrac)
    const yBase=ax<=.42?s.yTop+crown:s.yTop+crown-((ax-.42)/.58)*crown*1.45
    return [xFrac*s.wTop,yBase+ny*lift,z+nz*lift]
  }
  function emitRoofGlass(zStops:number[],wFrac:number,ny:number,nz:number,lift:number,hex:number){
    const xStops=[-wFrac,-wFrac*.42,wFrac*.42,wFrac]
    for(let iz=0;iz<zStops.length-1;iz++){
      const z0=zStops[iz],z1=zStops[iz+1]
      for(let ix=0;ix<xStops.length-1;ix++){
        const x0=xStops[ix],x1=xStops[ix+1]
        pushQuadOut(roofPt(z0,x0,ny,nz,lift),roofPt(z1,x0,ny,nz,lift),roofPt(z1,x1,ny,nz,lift),roofPt(z0,x1,ny,nz,lift),0,ny,nz,hex)
      }
    }
  }
  function sideGlassPt(side:number,z:number,u:number,lift:number):[number,number,number]{
    const s=stationAt(z),crown=s.yTop>1.02?.022:.014
    const w4=s.wBelt,y4=s.yBelt
    const w5=s.wBelt*.32+s.wTop*.68,y5=s.yBelt*.35+s.yTop*.65
    const w6=s.wTop,y6=s.yTop-crown*.45
    let w:number,y:number
    if(u<=.65){const t=u/.65;w=w4+(w5-w4)*t;y=y4+(y5-y4)*t}
    else{const t=(u-.65)/.35;w=w5+(w6-w5)*t;y=y5+(y6-y5)*t}
    return [side*(w+lift*.92),y+lift*.38,z]
  }
  function emitSideWindow(side:number,z0Bot:number,z0Top:number,z1Bot:number,z1Top:number,u0Bot:number,u0Top:number,u1Bot:number,u1Top:number,lift:number,hex:number,cols=4){
    for(let c=0;c<cols;c++){
      const t0=c/cols,t1=(c+1)/cols
      const zb0=z0Bot+(z1Bot-z0Bot)*t0,zt0=z0Top+(z1Top-z0Top)*t0
      const zb1=z0Bot+(z1Bot-z0Bot)*t1,zt1=z0Top+(z1Top-z0Top)*t1
      const ub0=u0Bot+(u1Bot-u0Bot)*t0,ut0=u0Top+(u1Top-u0Top)*t0
      const ub1=u0Bot+(u1Bot-u0Bot)*t1,ut1=u0Top+(u1Top-u0Top)*t1
      const uMid0=ub0<.65&&ut0>.65?.65:(ub0+ut0)*.5
      const uMid1=ub1<.65&&ut1>.65?.65:(ub1+ut1)*.5
      const f0=(uMid0-ub0)/Math.max(1e-5,ut0-ub0),f1=(uMid1-ub1)/Math.max(1e-5,ut1-ub1)
      const zm0=zb0+(zt0-zb0)*f0,zm1=zb1+(zt1-zb1)*f1
      pushQuadOut(sideGlassPt(side,zb0,ub0,lift),sideGlassPt(side,zb1,ub1,lift),sideGlassPt(side,zm1,uMid1,lift),sideGlassPt(side,zm0,uMid0,lift),side,.35,0,hex)
      pushQuadOut(sideGlassPt(side,zm0,uMid0,lift),sideGlassPt(side,zm1,uMid1,lift),sideGlassPt(side,zt1,ut1,lift),sideGlassPt(side,zt0,ut0,lift),side,.35,0,hex)
    }
  }

  const M=rings[0].length
  for(let i=0;i<rings.length-1;i++){
    const r0=rings[i],r1=rings[i+1],zMid=(stations[i].z+stations[i+1].z)*.5
    for(let k=0;k<M;k++){
      const k1=(k+1)%M
      const hex=(k===0||k===14||k===15)?underbody:(k===1||k===13)?(zMid>-1.72&&zMid<1.72?trimDark:shadeHex):(k===2||k===12)?shadeHex:bodyHex
      pushTri(r0[k],r1[k],r1[k1],hex)
      pushTri(r0[k],r1[k1],r0[k1],hex)
    }
  }
  const fCenter:[number,number,number]=[0,.36,stations[0].z]
  for(let k=0;k<M;k++)pushTri(fCenter,rings[0][k],rings[0][(k+1)%M],k===15?underbody:bodyHex)
  const bIdx=rings.length-1,bCenter:[number,number,number]=[0,.36,stations[bIdx].z]
  for(let k=0;k<M;k++)pushTri(bCenter,rings[bIdx][(k+1)%M],rings[bIdx][k],k===15?underbody:bodyHex)

  // Flush-fitted front & rear windshields (following greenhouse loft planes, zero protrusion)
  emitRoofGlass([-.82,-.55,-.26],.89,.80,-.60,.005,pillarBlack)
  emitRoofGlass([-.79,-.55,-.28],.82,.80,-.60,.008,glass)
  emitRoofGlass([-.36,-.28],.81,.80,-.60,.010,glassTop)
  emitRoofGlass([.59,.92,1.12],.87,.83,.55,.005,pillarBlack)
  emitRoofGlass([.62,.92,1.09],.80,.83,.55,.008,glass)
  for(const ix of [-.34,.34]){
    const x0=ix<0?-.34:0,x1=ix<0?0:.34
    pushQuadOut(roofPt(.625,x0,.83,.55,.011),roofPt(.665,x0,.83,.55,.011),roofPt(.665,x1,.83,.55,.011),roofPt(.625,x1,.83,.55,.011),0,.83,.55,brakeBright)
  }

  // Flush-fitted trapezoidal side windows, gloss-black B-pillars, quarter glass, and chrome beltline trim
  for(const side of [-1,1]){
    emitSideWindow(side,-.76,-.26,1.00,.58,.05,.90,.05,.90,.005,pillarBlack,5)
    emitSideWindow(side,-.70,-.23,.07,.07,.11,.84,.11,.84,.008,glass,2)
    emitSideWindow(side,.075,.075,.165,.165,.06,.89,.06,.89,.009,pillarBlack,1)
    emitSideWindow(side,.17,.17,.68,.55,.11,.84,.11,.84,.008,glass,2)
    emitSideWindow(side,.73,.59,.95,.87,.11,.81,.14,.42,.008,glass,2)
    emitSideWindow(side,-.76,-.74,1.00,.98,.025,.068,.025,.068,.010,chrome,4)
  }

  const shellGeom=new T.BufferGeometry()
  shellGeom.setAttribute('position',new T.Float32BufferAttribute(shellPos,3))
  shellGeom.setAttribute('color',new T.Float32BufferAttribute(shellCol,3))
  shellGeom.computeVertexNormals()
  parts.push(shellGeom)

  for(const side of [-1,1])for(const wz of [-1.34,1.31]){
    const arch=new T.CylinderGeometry(.34,.34,.24,8,1,true,-Math.PI/2,Math.PI)
    arch.rotateX(-Math.PI/2);arch.rotateY(Math.PI/2)
    emit(arch,underbody,side*.78,.32,wz)
  }

  // Windshield wipers, flush door handles, dual-tone aerodynamic wing mirrors, and roof fin
  for(const wx of [-.26,.18])box(.40,.014,.020,wx,.905,-.805,trimDark,0,.08,-.04)
  for(const side of [-1,1]){
    for(const hz of [-.10,.56]){
      box(.020,.034,.155,side*.892,.855,hz,pillarBlack)
      box(.028,.024,.165,side*.902,.858,hz,bodyHex)
    }
    box(.065,.038,.09,side*.845,.92,-.64,pillarBlack)
    box(.075,.024,.038,side*.888,.942,-.63,pillarBlack,0,0,side*.16)
    box(.135,.084,.105,side*.945,.962,-.61,bodyHex,.06,side*-.18,0)
    box(.122,.070,.018,side*.944,.962,-.558,mirrorGlass,0,side*-.18,0)
    box(.126,.014,.024,side*.952,.958,-.658,amber,0,side*-.18,0)
  }
  box(.034,.056,.15,0,1.464,.44,bodyHex,-.20)

  // Front grille (emblem-free), splitter, headlamps, and DRLs
  box(.96,.20,.05,0,.53,-2.205,pillarBlack,.08)
  for(const gy of [.475,.53,.585])box(.88,.018,.058,0,gy,-2.212,chrome)
  box(1.16,.11,.05,0,.29,-2.19,underbody)
  box(1.56,.032,.12,0,.195,-2.17,trimDark)
  box(.42,.115,.03,0,.38,-2.225,plateBlue)
  for(const side of [-1,1]){
    const yaw=side*.22
    box(.34,.125,.13,side*.635,.64,-2.165,pillarBlack,.09,yaw,0)
    box(.095,.070,.045,side*.565,.642,-2.222,headlamp,.08,yaw,0)
    box(.090,.066,.045,side*.675,.646,-2.198,headlamp,.08,yaw,0)
    box(.32,.024,.048,side*.63,.698,-2.208,drlIce,.08,yaw,side*-.08)
    box(.060,.062,.052,side*.765,.648,-2.158,amber,.08,yaw,0)
    box(.20,.075,.05,side*.66,.305,-2.195,trimDark,0,yaw,0)
    box(.115,.036,.056,side*.66,.305,-2.212,drlIce,0,yaw,0)
  }

  // Rear deck spoiler, two-tone LED tail lamps, diffuser fins, and twin exhausts
  box(1.36,.032,.09,0,.992,2.02,bodyHex,.18)
  box(1.42,.042,.04,0,.82,2.21,pillarBlack)
  box(.42,.115,.03,0,.66,2.222,plateBlue)
  box(1.46,.13,.08,0,.27,2.185,trimDark,-.12)
  for(const fx of [-.42,-.14,.14,.42])box(.024,.11,.09,fx,.255,2.205,underbody)
  for(const side of [-1,1]){
    const yaw=-side*.20
    box(.38,.13,.12,side*.62,.815,2.155,tailRed,-.06,yaw,0)
    box(.34,.045,.04,side*.61,.85,2.208,brakeBright,-.06,yaw,0)
    box(.24,.032,.042,side*.57,.775,2.21,reverseWhite,-.06,yaw,0)
    box(.22,.024,.03,side*.62,.34,2.205,tailRed,0,yaw,0)
    const pipe=new T.CylinderGeometry(.044,.044,.11,8);pipe.rotateX(Math.PI/2)
    emit(pipe,chrome,side*.54,.235,2.20)
    const bore=new T.CylinderGeometry(.032,.032,.116,6);bore.rotateX(Math.PI/2)
    emit(bore,underbody,side*.54,.235,2.204)
  }

  // 5-spoke alloy wheels with rounded tires, rim lips, brake discs, and calipers
  if(includeWheels){
    for(const side of [-1,1] as const)for(const wz of [-1.34,1.31]){
      appendCarWheelParts(emit,box,side,side*.795,.306,wz,true)
    }
  }

  const merged=mergeGeometries(parts,false)
  for(const p of parts)p.dispose()
  merged.computeVertexNormals()
  return merged
}

export type EbikeModPreset = 'stock' | 'ghostfire' | 'neon'
export type EbikeVehicleKind = 'normal' | 'shared'

export interface EbikeModConfig {
  preset: EbikeModPreset
  paintColor?: number
  underglow: boolean
  underglowColor: number
  angelEye: boolean
  angelEyeColor: number
  goldShock: boolean
  tailWing: boolean
  exhaust: boolean
  windshield?: 'none' | 'clear' | 'tinted'
  topbox?: 'none' | 'commuter' | 'delivery'
  headlightTier?: 0 | 1 | 2
}

export const EBIKE_SHARED_COLOR = 0x5e7680

export const EBIKE_MOD_PRESETS: Record<EbikeModPreset, EbikeModConfig> = {
  stock: {
    preset: 'stock',
    underglow: false,
    underglowColor: 0x3ad6c8,
    angelEye: false,
    angelEyeColor: 0x72ecff,
    goldShock: false,
    tailWing: false,
    exhaust: false,
  },
  ghostfire: {
    preset: 'ghostfire',
    paintColor: 0x5c2e8a,
    underglow: true,
    underglowColor: 0xc84bff,
    angelEye: true,
    angelEyeColor: 0xff4c9a,
    goldShock: true,
    tailWing: true,
    exhaust: true,
  },
  neon: {
    preset: 'neon',
    paintColor: 0x266c7a,
    underglow: true,
    underglowColor: 0x3ef0d8,
    angelEye: true,
    angelEyeColor: 0x58f7ff,
    goldShock: true,
    tailWing: true,
    exhaust: true,
  },
}

const EBIKE_STOCK_PAINTS = [0xf3f1e9, 0x99c9de, 0xe4afbb, 0x383c40] as const

export interface TwoWheelRigState {
  pos: T.Vector3
  heading: number
  groundPitch: number
  longPitch?: number
  lean: number
  wheelie: number
  steerInput: number
  speed: number
  pedalPhase?: number
  braking?: boolean
  brakeLight?: boolean
  crashRoll?: number
  crashLift?: number
  kickstandDown?: boolean
  headlight?: TwoWheelHeadlightMode
  night?: number
  crashed?: boolean
  batteryDepleted?: boolean
  hazard?: boolean
  leftSignalLit?: boolean
  rightSignalLit?: boolean
  dt: number
}

export interface TwoWheelVisualRig {
  root: T.Group
  crashPivot: T.Group
  leanPivot: T.Group
  wheeliePivot: T.Group
  frontAssembly: T.Group
  frontWheel: T.Group
  rearWheel: T.Group
  seatAnchor: T.Object3D
  crank?: T.Group
  update: (state: TwoWheelRigState) => void
  dispose: () => void
}

export interface EbikeDrawCallStats {
  visibleModMeshes: number
  modDrawCallDelta: number
  chassisMods: boolean
  frontMods: boolean
  underglowMods: boolean
}

export interface EbikeVisualRig extends TwoWheelVisualRig {
  modSlots: {
    shell: T.Group
    headlight: T.Group
    underglow: T.Group
    shock: T.Group
    tailWing: T.Group
    exhaust: T.Group
  }
  get vehicleType(): EbikeVehicleKind
  get kickstandAngle(): number
  beamProbe: () => HeadlightBeamProbe
  signalProbe: () => {leftSignalLit: boolean; rightSignalLit: boolean; brakeLight: boolean; signalDrawCalls: number}
  drawCallStats: () => EbikeDrawCallStats
  setVehicleType: (type: EbikeVehicleKind, basePaint?: number) => void
  applyMods: (next: EbikeModPreset | Partial<EbikeModConfig>, basePaint?: number) => void
}

export interface BicycleVisualRig extends TwoWheelVisualRig {
  setPaint: (paint: number) => void
}

export interface CarVisualRig {
  root: T.Group
  smokeGroup: T.Group
  suspensionPivot: T.Group
  setPaint: (paint: number) => void
  triggerImpact: (strength: number) => void
  clearEffects: () => void
  update: (state: {
    pos: T.Vector3
    heading: number
    groundPitch: number
    speed: number
    steerInput: number
    braking: boolean
    reversing: boolean
    dt: number
    dynRoll?: number
    dynPitch?: number
    driftIntensity?: number
    handbrake?: boolean
    headlight?: TwoWheelHeadlightMode
    night?: number
  }) => void
  probe: () => {
    roll: number
    pitch: number
    heave: number
    steerAngle: number
    wheelSpin: number
    rearWheelSpin: number
    braking: boolean
    reversing: boolean
    handbrake: boolean
    smokeActive: number
    headlight: TwoWheelHeadlightMode
    headlightIntensity: number
    beamActive: boolean
    beamDrawCalls: number
  }
  dispose: () => void
}

function makeSolidPart(geom: T.BufferGeometry, mat: T.Material, x = 0, y = 0, z = 0) {
  const m = new T.Mesh(geom, mat)
  m.position.set(x, y, z)
  return m
}

function buildWheelGroup(tireMat: T.Material, rimMat: T.Material) {
  const g = new T.Group()
  const tire = new T.Mesh(new T.CylinderGeometry(.24, .24, .12, 14).rotateZ(Math.PI / 2), tireMat)
  const rim = new T.Mesh(new T.CylinderGeometry(.155, .155, .126, 12).rotateZ(Math.PI / 2), rimMat)
  const spoke1 = new T.Mesh(new T.BoxGeometry(.13, .29, .024), rimMat)
  const spoke2 = new T.Mesh(new T.BoxGeometry(.13, .024, .29), rimMat)
  g.add(tire, rim, spoke1, spoke2)
  return g
}

function coloredRgbaPart(
  raw: T.BufferGeometry,
  colorHex: number,
  alpha: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
) {
  const geom = raw.index ? raw.toNonIndexed() : raw
  if (geom !== raw) raw.dispose()
  geom.deleteAttribute('uv')
  if (rx !== 0) geom.rotateX(rx)
  geom.translate(x, y, z)
  const col = new T.Color(colorHex)
  const count = geom.attributes.position.count
  const rgba = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const o = i * 4
    rgba[o] = col.r
    rgba[o + 1] = col.g
    rgba[o + 2] = col.b
    rgba[o + 3] = alpha
  }
  geom.setAttribute('color', new T.BufferAttribute(rgba, 4))
  return geom
}

function mergeRgbaParts(parts: T.BufferGeometry[]): T.BufferGeometry {
  if (parts.length === 0) return new T.BufferGeometry()
  const merged = mergeGeometries(parts, false)
  for (const part of parts) part.dispose()
  merged?.clearGroups()
  return merged ?? new T.BufferGeometry()
}

/**
 * Articulated dynamic e-bike rig for active riding:
 * - Wheelie rotates around rear contact patch (0, 0, +0.53) so rear tire stays planted
 * - Lean tilts around ground contact line (0, 0, 0)
 * - Weight pivot inside leanPivot conveys brake dive / launch squat without polluting wheelie telemetry
 * - Front fork + handlebar steer with rider hand/steer sync; wheels spin with speed
 * - Optional mods are batched per pivot hierarchy (<= 3 draw calls total over stock)
 */
export function createDynamicEbike(paint = 0, initialMods?: Partial<EbikeModConfig>, initialType: EbikeVehicleKind = 'normal'): EbikeVisualRig {
  const disposables: (T.BufferGeometry | T.Material)[] = []
  const trackG = <G extends T.BufferGeometry>(g: G) => { disposables.push(g); return g }
  const trackM = <M extends T.Material>(m: M) => { disposables.push(m); return m }

  const baseHex = EBIKE_STOCK_PAINTS[((paint % 4) + 4) % 4]
  const bodyMat = trackM(new T.MeshStandardMaterial({color: baseHex, flatShading: true, roughness: .55, metalness: .1}))
  const darkMat = trackM(new T.MeshStandardMaterial({color: 0x2b2e32, flatShading: true, roughness: .85}))
  const alloyMat = trackM(new T.MeshStandardMaterial({color: 0xb6bec4, flatShading: true, roughness: .4, metalness: .45}))
  const headMat = trackM(new T.MeshBasicMaterial({color: 0xfff3d4}))
  const tailMat = trackM(new T.MeshBasicMaterial({color: 0xb32622}))
  const chassisModMat = trackM(new T.MeshStandardMaterial({vertexColors: true, flatShading: true, roughness: .5, metalness: .3}))
  const frontModMat = trackM(new T.MeshStandardMaterial({vertexColors: true, flatShading: true, roughness: .35, metalness: .25, forceSinglePass: true}))
  const underglowModMat = trackM(new T.MeshBasicMaterial({vertexColors: true, transparent: true, depthWrite: false, side: T.FrontSide, forceSinglePass: true}))
  const sharedPartMat = trackM(new T.MeshStandardMaterial({vertexColors: true, flatShading: true, roughness: .65, metalness: .08}))

  const root = new T.Group()
  root.name = 'dynamic-ebike'
  const crashPivot = new T.Group()
  const leanPivot = new T.Group()
  const weightPivot = new T.Group()
  weightPivot.name = 'ebike-weight-pivot'
  const wheeliePivot = new T.Group()
  const REAR_Z = .620
  wheeliePivot.position.z = REAR_Z
  root.add(crashPivot)
  crashPivot.add(leanPivot)
  leanPivot.add(weightPivot)
  weightPivot.add(wheeliePivot)

  const chassis = new T.Group()
  wheeliePivot.add(chassis)

  const bakedMat = trackM(new T.MeshStandardMaterial({vertexColors:true, flatShading:true}))
  function baked(joint: number, y: number, z: number, painted?: boolean) {
    const geometry = trackG(bikeGeometry(0xffffff,false,joint,painted).translate(0,-y,-z))
    return new T.Mesh(geometry,painted ? bodyMat : bakedMat)
  }
  const rearWheel = new T.Group()
  rearWheel.position.set(0,.228,0)
  rearWheel.add(baked(1,.228,REAR_Z))
  chassis.add(rearWheel)
  const shellSlot = new T.Group(); shellSlot.name = 'mod-shell'
  shellSlot.add(baked(3,0,REAR_Z,true), baked(3,0,REAR_Z,false))
  const tailLamp = makeSolidPart(trackG(new T.BoxGeometry(.12,.035,.02)),tailMat,0,.66,.85-REAR_Z)
  chassis.add(shellSlot,tailLamp)

  // Rear shock slot keeps baseline struts; optional gold canisters batch into chassisModMesh.
  const shockSlot = new T.Group(); shockSlot.name = 'mod-shock'
  chassis.add(shockSlot)

  // Named mod slots preserved on the API while visuals merge into <= 3 batched meshes (chassis / front / underglow).
  const tailWingSlot = new T.Group(); tailWingSlot.name = 'mod-tailWing'
  const exhaustSlot = new T.Group(); exhaustSlot.name = 'mod-exhaust'
  const underglowSlot = new T.Group(); underglowSlot.name = 'mod-underglow'
  chassis.add(tailWingSlot, exhaustSlot)
  leanPivot.add(underglowSlot)

  let chassisModGeom: T.BufferGeometry | null = null
  const chassisModMesh = new T.Mesh(new T.BufferGeometry(), chassisModMat)
  chassisModMesh.name = 'ebike-mods-chassis'
  chassisModMesh.visible = false
  chassis.add(chassisModMesh)

  let underglowModGeom: T.BufferGeometry | null = null
  const underglowModMesh = new T.Mesh(new T.BufferGeometry(), underglowModMat)
  underglowModMesh.name = 'ebike-mods-underglow'
  underglowModMesh.visible = false
  underglowSlot.add(underglowModMesh)

  // Front steering assembly (stem at z = -0.43 -> relative z = -0.96)
  const frontAssembly = new T.Group()
  frontAssembly.position.set(0,0,steeringZ-REAR_Z)
  wheeliePivot.add(frontAssembly)

  const frontWheel = new T.Group()
  frontWheel.position.set(0,.228,-.660+.43)
  frontWheel.add(baked(0,.228,-.660))
  frontAssembly.add(frontWheel,baked(2,0,-.43,true),baked(2,0,-.43,false))

  const headlightSlot = new T.Group(); headlightSlot.name = 'mod-headlight'
  const headLens = makeSolidPart(trackG(new T.BoxGeometry(.16, .09, .04)), headMat, 0,cowlLamp.y,cowlLamp.z-steeringZ)
  const beamRig = createHeadlightBeamRig('bike')
  beamRig.group.position.set(0,cowlLamp.y,cowlLamp.z-steeringZ-.03)
  headlightSlot.add(headLens, beamRig.group)
  frontAssembly.add(headlightSlot)

  let frontModGeom: T.BufferGeometry | null = null
  const frontModMesh = new T.Mesh(new T.BufferGeometry(), frontModMat)
  frontModMesh.name = 'ebike-mods-front'
  frontModMesh.visible = false
  frontAssembly.add(frontModMesh)

  // Batched amber turn-signal lamps (zero dynamic lights, 0 draw calls when off, <=2 draw calls when both flashing).
  const signalLeftMat = trackM(new T.MeshBasicMaterial({color: 0xffa824}))
  const signalRightMat = trackM(new T.MeshBasicMaterial({color: 0xffa824}))
  const makeMergedSignalGeom = (side: -1 | 1) => {
    const frontPod = new T.BoxGeometry(.06, .04, .05).translate(side * .155, .71, -.43 - REAR_Z - .09)
    const rearPod = new T.BoxGeometry(.06, .04, .05).translate(side * .15, .63, .51 - REAR_Z)
    const merged = mergeGeometries([frontPod, rearPod], false)
    frontPod.dispose()
    rearPod.dispose()
    return trackG(merged)
  }
  const leftSignalMesh = new T.Mesh(makeMergedSignalGeom(-1), signalLeftMat)
  leftSignalMesh.name = 'ebike-signal-left'
  leftSignalMesh.visible = false
  const rightSignalMesh = new T.Mesh(makeMergedSignalGeom(1), signalRightMat)
  rightSignalMesh.name = 'ebike-signal-right'
  rightSignalMesh.visible = false
  chassis.add(leftSignalMesh, rightSignalMesh)

  // Articulated left side kickstand (stowed back while riding/crashed, swings down when parked).
  const kickstandPivot = new T.Group()
  kickstandPivot.name = 'ebike-kickstand'
  kickstandPivot.position.set(-.15, .25, .14 - REAR_Z)
  const standLeg = makeSolidPart(trackG(new T.BoxGeometry(.026, .27, .026)), darkMat, 0, -.135, 0)
  const standFoot = makeSolidPart(trackG(new T.BoxGeometry(.056, .016, .056)), alloyMat, 0, -.27, 0)
  kickstandPivot.add(standLeg, standFoot)
  kickstandPivot.rotation.set(1.42, 0, 0)
  chassis.add(kickstandPivot)

  // Rider seat anchor aligned to vehicle-space (0, 0, +0.23) -> wheeliePivot (0, 0, -0.30)
  const seatAnchor = new T.Object3D()
  seatAnchor.name = 'rider-seat-anchor'
  seatAnchor.position.set(0, 0, .23 - REAR_Z)
  wheeliePivot.add(seatAnchor)

  // Shared e-bike distinguishing parts: merged front wire basket + merged rear scan lock/battery trim (1 draw call each).
  const sharedTailGroup = new T.Group()
  sharedTailGroup.name = 'shared-tail-lock'
  const sharedTailParts = [
    coloredRgbaPart(new T.BoxGeometry(.20, .13, .05), 0xb5563d, 1, 0, .68, .51 - REAR_Z),
    coloredRgbaPart(new T.BoxGeometry(.10, .07, .02), 0xf5f2ea, 1, 0, .68, .54 - REAR_Z),
    coloredRgbaPart(new T.BoxGeometry(.395, .12, .32), 0x455a63, 1, 0, .38, .02 - REAR_Z),
  ]
  sharedTailGroup.add(new T.Mesh(trackG(mergeRgbaParts(sharedTailParts)), sharedPartMat))
  chassis.add(sharedTailGroup)

  let wheelSpin = 0
  let kickstandBlend = 0
  let hazardClock = 0
  let lastLeftSig = false
  let lastRightSig = false
  let lastBrakeLamp = false
  let currentPaint = paint
  let currentType: EbikeVehicleKind = initialType
  let lastMods: EbikeModPreset | Partial<EbikeModConfig> = initialMods ?? 'stock'

  function rebuildModMeshes(shared: boolean, cfg: EbikeModConfig, resolvedBodyColor: number) {
    const chassisParts:T.BufferGeometry[]=[], frontParts:T.BufferGeometry[]=[], glowParts:T.BufferGeometry[]=[]
    if(!shared)accessories(cfg,resolvedBodyColor,(joint,geometry,color,alpha)=>{
      const origin=joint==='front'?steeringZ:joint==='body'?REAR_Z:0
      const target=joint==='front'?frontParts:joint==='body'?chassisParts:glowParts
      target.push(coloredRgbaPart(geometry,color,alpha,0,0,-origin))
    })
    chassisModGeom?.dispose()
    if (chassisParts.length > 0) {
      chassisModGeom = mergeRgbaParts(chassisParts)
      chassisModMesh.geometry = chassisModGeom
      chassisModMesh.visible = true
    } else {
      chassisModGeom = null
      chassisModMesh.visible = false
    }

    const hasWindshield=cfg.windshield==='clear'||cfg.windshield==='tinted'
    frontModGeom?.dispose()
    if (frontParts.length > 0) {
      frontModGeom = mergeRgbaParts(frontParts)
      frontModMesh.geometry = frontModGeom
      if (frontModMat.transparent !== hasWindshield) {
        frontModMat.transparent = hasWindshield
        frontModMat.depthWrite = !hasWindshield
        frontModMat.needsUpdate = true
      }
      frontModMesh.visible = true
    } else {
      frontModGeom = null
      frontModMesh.visible = false
    }

    if (!shared && cfg.underglow) {
      glowParts.push(coloredRgbaPart(new T.PlaneGeometry(.72, 1.35).rotateX(-Math.PI / 2), cfg.underglowColor, .24, 0, .015, -.02))
    }
    underglowModGeom?.dispose()
    if (glowParts.length > 0) {
      underglowModGeom = mergeRgbaParts(glowParts)
      underglowModMesh.geometry = underglowModGeom
      underglowModMesh.visible = true
    } else {
      underglowModGeom = null
      underglowModMesh.visible = false
    }
  }

  function applyMods(next: EbikeModPreset | Partial<EbikeModConfig>, basePaint = currentPaint) {
    currentPaint = basePaint
    lastMods = next
    const presetKey: EbikeModPreset = typeof next === 'string' ? next : (next.preset ?? 'stock')
    const baseCfg = EBIKE_MOD_PRESETS[presetKey] ?? EBIKE_MOD_PRESETS.stock
    const cfg: EbikeModConfig = typeof next === 'string' ? baseCfg : {...baseCfg, ...next, preset: presetKey}

    const shared = currentType === 'shared'
    sharedTailGroup.visible = shared

    const stockHex = EBIKE_STOCK_PAINTS[((basePaint % 4) + 4) % 4]
    const resolvedBodyColor = shared ? EBIKE_SHARED_COLOR : (cfg.paintColor ?? stockHex)
    bodyMat.color.setHex(resolvedBodyColor)

    underglowSlot.visible = !shared && cfg.underglow
    tailWingSlot.visible = !shared && cfg.tailWing
    exhaustSlot.visible = !shared && cfg.exhaust
    rebuildModMeshes(shared, cfg, resolvedBodyColor)
  }

  function setVehicleType(type: EbikeVehicleKind, basePaint = currentPaint) {
    currentType = type
    applyMods(lastMods, basePaint)
  }

  applyMods(lastMods, paint)

  return {
    root,
    crashPivot,
    leanPivot,
    wheeliePivot,
    frontAssembly,
    frontWheel,
    rearWheel,
    seatAnchor,
    modSlots: {
      shell: shellSlot,
      headlight: headlightSlot,
      underglow: underglowSlot,
      shock: shockSlot,
      tailWing: tailWingSlot,
      exhaust: exhaustSlot,
    },
    get vehicleType() { return currentType },
    get kickstandAngle() { return +(kickstandBlend * .42).toFixed(4) },
    beamProbe: () => beamRig.probe(),
    signalProbe: () => ({
      leftSignalLit: lastLeftSig,
      rightSignalLit: lastRightSig,
      brakeLight: lastBrakeLamp,
      signalDrawCalls: (lastLeftSig ? 1 : 0) + (lastRightSig ? 1 : 0),
    }),
    drawCallStats: () => {
      const chassisMods = chassisModMesh.visible
      const frontMods = frontModMesh.visible
      const underglowMods = underglowModMesh.visible
      const visibleModMeshes = (chassisMods ? 1 : 0) + (frontMods ? 1 : 0) + (underglowMods ? 1 : 0)
      return {
        visibleModMeshes,
        modDrawCallDelta: visibleModMeshes,
        chassisMods,
        frontMods,
        underglowMods,
      }
    },
    setVehicleType,
    applyMods,
    update(state) {
      root.position.copy(state.pos)
      root.rotation.set(state.groundPitch, state.heading, 0, 'YXZ')
      const crashRoll = state.crashRoll ?? 0
      const crashed = !!state.crashed || Math.abs(crashRoll) > .5
      crashPivot.rotation.set(0, 0, crashRoll)
      crashPivot.position.set(0, state.crashLift ?? Math.abs(Math.sin(crashRoll)) * .19, 0)

      const wantStand = !!state.kickstandDown && !crashed
      if (crashed) {
        kickstandBlend = 0
      } else {
        kickstandBlend = state.dt > 0
          ? T.MathUtils.damp(kickstandBlend, wantStand ? 1 : 0, 12, Math.min(.12, state.dt))
          : (wantStand ? 1 : 0)
        if (!wantStand && kickstandBlend < 1e-3) kickstandBlend = 0
      }
      kickstandPivot.rotation.set(
        T.MathUtils.lerp(1.42, .22, kickstandBlend),
        0,
        T.MathUtils.lerp(0, .42, kickstandBlend),
      )

      const standTilt = !crashed && Math.abs(state.lean) < .01 ? -kickstandBlend * .105 : 0
      leanPivot.rotation.set(0, 0, state.lean + standTilt)
      weightPivot.rotation.set(crashed ? 0 : T.MathUtils.clamp(state.longPitch ?? 0, -.12, .12), 0, 0)
      wheeliePivot.position.y = .228 * (1 - Math.cos(state.wheelie))
      wheeliePivot.rotation.set(state.wheelie, 0, 0)
      frontAssembly.rotation.y = -state.steerInput * .42

      const spinDelta = (state.speed * state.dt) / .228
      wheelSpin -= spinDelta
      rearWheel.rotation.x = wheelSpin
      // When wheelieing in air, front wheel coasts slightly slower.
      frontWheel.rotation.x -= state.wheelie > .08 ? spinDelta * .35 : spinDelta

      const hlMode: TwoWheelHeadlightMode = state.headlight ?? 'off'
      headMat.color.setHex(hlMode === 'high' ? 0xffffff : hlMode === 'low' ? 0xfff5d4 : 0xc6c9be)
      beamRig.update({
        mode: hlMode,
        night: state.night ?? 0,
        wheelie: state.wheelie,
        crashed,
        batteryDepleted: !!state.batteryDepleted,
      })

      let leftLit = !!state.leftSignalLit
      let rightLit = !!state.rightSignalLit
      if (state.hazard && state.leftSignalLit === undefined && state.rightSignalLit === undefined) {
        hazardClock += Math.max(0, state.dt)
        const pulseOn = Math.sin(hazardClock * Math.PI * 3.6) >= 0
        leftLit = pulseOn
        rightLit = pulseOn
      } else if (!state.hazard) {
        hazardClock = 0
      }
      leftSignalMesh.visible = leftLit
      rightSignalMesh.visible = rightLit
      lastLeftSig = leftLit
      lastRightSig = rightLit

      const brakeOn = !!(state.brakeLight || state.braking || state.speed < -.05)
      lastBrakeLamp = brakeOn
      tailMat.color.setHex(brakeOn ? 0xff4238 : hlMode !== 'off' ? 0xd03028 : 0x99201c)
    },
    dispose() {
      beamRig.dispose()
      chassisModGeom?.dispose()
      frontModGeom?.dispose()
      underglowModGeom?.dispose()
      chassisModMesh.geometry.dispose()
      frontModMesh.geometry.dispose()
      underglowModMesh.geometry.dispose()
      for (const item of disposables) item.dispose()
      root.removeFromParent()
    },
  }
}

const BICYCLE_PAINTS = [0x5b8a72, 0xc96f53, 0xd8cfc0, 0x5c6e7e] as const

function buildSpokedBicycleWheel(tireMat: T.Material, rimMat: T.Material, trackG: <G extends T.BufferGeometry>(g: G) => G) {
  const g = new T.Group()
  g.add(
    makeSolidPart(trackG(new T.TorusGeometry(.304, .026, 7, 18).rotateY(Math.PI / 2)), tireMat),
    makeSolidPart(trackG(new T.TorusGeometry(.272, .011, 6, 18).rotateY(Math.PI / 2)), rimMat),
    makeSolidPart(trackG(new T.CylinderGeometry(.024, .024, .072, 8).rotateZ(Math.PI / 2)), rimMat),
  )
  for (let s = 0; s < 4; s++) {
    g.add(makeSolidPart(trackG(new T.CylinderGeometry(.005, .005, .53, 4).rotateX(s * Math.PI / 4)), rimMat))
  }
  return g
}

function makeTube(r: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, mat: T.Material, trackG: <G extends T.BufferGeometry>(g: G) => G, segs = 6) {
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1, len = Math.hypot(dx, dy, dz)
  const g = trackG(new T.CylinderGeometry(r, r, Math.max(1e-3, len), segs))
  qTmp.setFromUnitVectors(upAxis, dirVec.set(dx / Math.max(1e-4, len), dy / Math.max(1e-4, len), dz / Math.max(1e-4, len)))
  g.applyQuaternion(qTmp)
  return makeSolidPart(g, mat, (x1 + x2) * .5, (y1 + y2) * .5, (z1 + z2) * .5)
}

/**
 * Articulated dynamic pedal bicycle rig matching static Guilin bicycle proportions:
 * - Wheelie pivots cleanly on rear tire contact patch (0, 0, +0.54)
 * - Front fork, wheel, swept handlebar, bell & rattan basket steer together
 * - Spinning spoked wheels and crank assembly driven by pedaling phase
 * - Crash roll & lift pivot rests frame on asphalt when downed
 */
export function createDynamicBicycle(paint = 0): BicycleVisualRig {
  const disposables: (T.BufferGeometry | T.Material)[] = []
  const trackG = <G extends T.BufferGeometry>(g: G) => { disposables.push(g); return g }
  const trackM = <M extends T.Material>(m: M) => { disposables.push(m); return m }

  const frameMat = trackM(new T.MeshStandardMaterial({color: BICYCLE_PAINTS[((paint % 4) + 4) % 4], flatShading: true, roughness: .55}))
  const alloyMat = trackM(new T.MeshStandardMaterial({color: 0xb8bec2, flatShading: true, roughness: .4, metalness: .45}))
  const darkMat = trackM(new T.MeshStandardMaterial({color: 0x2b2e30, flatShading: true, roughness: .85}))
  const saddleMat = trackM(new T.MeshStandardMaterial({color: 0x423832, flatShading: true, roughness: .9}))
  const basketMat = trackM(new T.MeshStandardMaterial({color: 0x6f7577, flatShading: true, roughness: .75}))
  const rattanMat = trackM(new T.MeshStandardMaterial({color: 0xa68963, flatShading: true, roughness: .85}))
  const bellMat = trackM(new T.MeshStandardMaterial({color: 0xd4b46a, flatShading: true, roughness: .35, metalness: .6}))
  const chainMat = trackM(new T.MeshStandardMaterial({color: 0x525659, flatShading: true, roughness: .7}))

  const root = new T.Group()
  root.name = 'dynamic-bicycle'
  const crashPivot = new T.Group()
  const leanPivot = new T.Group()
  const wheeliePivot = new T.Group()
  const REAR_Z = .54
  wheeliePivot.position.set(0, 0, REAR_Z)
  root.add(crashPivot)
  crashPivot.add(leanPivot)
  leanPivot.add(wheeliePivot)

  const chassis = new T.Group()
  wheeliePivot.add(chassis)

  const rearWheel = buildSpokedBicycleWheel(darkMat, alloyMat, trackG)
  rearWheel.position.set(0, .33, 0)
  chassis.add(rearWheel)

  const fender = makeSolidPart(trackG(new T.TorusGeometry(.336, .016, 5, 12, Math.PI * .78).rotateY(Math.PI / 2).rotateX(-.22)), frameMat, 0, .33, 0)
  const bbShell = makeSolidPart(trackG(new T.CylinderGeometry(.032, .032, .09, 8).rotateZ(Math.PI / 2)), alloyMat, 0, .29, .05 - REAR_Z)
  const seatTube = makeTube(.017, 0, .29, .05 - REAR_Z, 0, .72, .19 - REAR_Z, frameMat, trackG, 7)
  const seatPost = makeTube(.013, 0, .72, .19 - REAR_Z, 0, .82, .22 - REAR_Z, alloyMat, trackG, 6)
  const downTube = makeTube(.019, 0, .64, -.43 - REAR_Z, 0, .29, .05 - REAR_Z, frameMat, trackG, 7)
  const topTube = makeTube(.016, 0, .74, -.41 - REAR_Z, 0, .58, .14 - REAR_Z, frameMat, trackG, 7)
  const saddle = makeSolidPart(trackG(new T.BoxGeometry(.15, .048, .25)), saddleMat, 0, .835, .22 - REAR_Z)
  const saddleNose = makeSolidPart(trackG(new T.BoxGeometry(.075, .038, .10)), saddleMat, 0, .832, .10 - REAR_Z)
  const chainring = makeSolidPart(trackG(new T.CylinderGeometry(.082, .082, .012, 12).rotateZ(Math.PI / 2)), chainMat, .048, .29, .05 - REAR_Z)
  const chainLine = makeTube(.008, .048, .36, .05 - REAR_Z, .048, .35, 0, chainMat, trackG, 4)
  chassis.add(fender, bbShell, seatTube, seatPost, downTube, topTube, saddle, saddleNose, chainring, chainLine)

  for (const side of [-1, 1]) {
    chassis.add(
      makeTube(.011, side * .036, .29, .05 - REAR_Z, side * .044, .33, 0, frameMat, trackG, 5),
      makeTube(.011, side * .032, .67, .17 - REAR_Z, side * .044, .33, 0, frameMat, trackG, 5),
    )
  }

  const crank = new T.Group()
  crank.name = 'Crank'
  crank.position.set(0, .29, .05 - REAR_Z)
  const crankMesh = new T.Mesh(getBicycleCrank(), trackM(new T.MeshStandardMaterial({vertexColors: true, flatShading: true})))
  crank.add(crankMesh)
  chassis.add(crank)

  // Head tube / front steering assembly at z = -0.42 -> relative to REAR_Z = -0.96
  const frontAssembly = new T.Group()
  frontAssembly.position.set(0, 0, -.42 - REAR_Z)
  wheeliePivot.add(frontAssembly)

  const frontWheel = buildSpokedBicycleWheel(darkMat, alloyMat, trackG)
  frontWheel.position.set(0, .33, -.12)
  frontAssembly.add(frontWheel)

  frontAssembly.add(
    makeTube(.020, 0, .61, -.02, 0, .79, .02, frameMat, trackG, 7),
    makeSolidPart(trackG(new T.BoxGeometry(.095, .026, .034)), frameMat, 0, .61, -.02),
    makeTube(.014, 0, .79, .02, 0, .97, .04, alloyMat, trackG, 6),
    makeTube(.014, 0, .97, .04, 0, .98, 0, alloyMat, trackG, 6),
    makeTube(.013, -.16, .98, 0, .16, .98, 0, alloyMat, trackG, 6),
    makeSolidPart(trackG(new T.CylinderGeometry(.022, .022, .018, 8)), bellMat, .13, 1.005, 0),
    makeSolidPart(trackG(new T.BoxGeometry(.08, .022, .10)), alloyMat, 0, .75, -.05),
    makeSolidPart(trackG(new T.BoxGeometry(.26, .018, .19)), rattanMat, 0, .74, -.14),
  )
  for (const side of [-1, 1]) {
    frontAssembly.add(
      makeTube(.013, side * .038, .61, -.02, side * .044, .33, -.12, frameMat, trackG, 6),
      makeTube(.013, side * .16, .98, 0, side * .28, .99, .07, alloyMat, trackG, 6),
      makeTube(.019, side * .20, .984, .025, side * .29, .992, .075, saddleMat, trackG, 6),
    )
  }
  for (const ry of [.83, .92]) {
    const spread = ry > .88 ? 1 : .93
    for (const side of [-1, 1]) {
      frontAssembly.add(
        makeSolidPart(trackG(new T.BoxGeometry(.014, .014, .22 * spread)), basketMat, side * .15 * spread, ry, -.14),
        makeSolidPart(trackG(new T.BoxGeometry(.30 * spread, .014, .014)), basketMat, 0, ry, -.14 + side * .11 * spread),
      )
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    frontAssembly.add(makeTube(.008, sx * .13, .74, -.14 + sz * .095, sx * .15, .92, -.14 + sz * .11, basketMat, trackG, 4))
  }

  const seatAnchor = new T.Object3D()
  seatAnchor.name = 'rider-seat-anchor'
  seatAnchor.position.set(0, 0, .22 - REAR_Z)
  wheeliePivot.add(seatAnchor)

  let wheelSpin = 0

  return {
    root,
    crashPivot,
    leanPivot,
    wheeliePivot,
    frontAssembly,
    frontWheel,
    rearWheel,
    seatAnchor,
    crank,
    setPaint(nextPaint: number) {
      frameMat.color.setHex(BICYCLE_PAINTS[((nextPaint % 4) + 4) % 4])
    },
    update(state) {
      root.position.copy(state.pos)
      root.rotation.set(state.groundPitch, state.heading, 0, 'YXZ')
      const crashRoll = state.crashRoll ?? 0
      crashPivot.rotation.set(0, 0, crashRoll)
      crashPivot.position.set(0, state.crashLift ?? Math.abs(Math.sin(crashRoll)) * .19, 0)
      leanPivot.rotation.set(0, 0, state.lean)
      wheeliePivot.rotation.set(state.wheelie, 0, 0)
      frontAssembly.rotation.y = -state.steerInput * .42

      const spinDelta = (state.speed * state.dt) / .33
      wheelSpin -= spinDelta
      rearWheel.rotation.x = wheelSpin
      frontWheel.rotation.x -= state.wheelie > .08 ? spinDelta * .35 : spinDelta
      if (state.pedalPhase !== undefined) crank.rotation.x = -state.pedalPhase
    },
    dispose() {
      for (const item of disposables) item.dispose()
      root.removeFromParent()
    },
  }
}

/**
 * GTA-style dynamic sedan rig with independent 4-wheel spin, Ackermann front steering,
 * outward lateral suspension roll, brake nose-dive / launch squat, jounce spring & live lamps.
 */
export function createDynamicCar(paint = 0): CarVisualRig {
  const disposables: (T.BufferGeometry | T.Material)[] = []
  const trackG = <G extends T.BufferGeometry>(g: G) => { disposables.push(g); return g }
  const trackM = <M extends T.Material>(m: M) => { disposables.push(m); return m }

  const bodyMat = trackM(new T.MeshStandardMaterial({vertexColors: true, flatShading: true}))
  const wheelMat = trackM(new T.MeshStandardMaterial({vertexColors: true, flatShading: true}))
  const caliperMat = trackM(new T.MeshStandardMaterial({color: CAR_WHEEL_PALETTE.brakeBright, flatShading: true}))
  const brakeLampMat = trackM(new T.MeshBasicMaterial({color: 0x7a1714}))
  const reverseLampMat = trackM(new T.MeshBasicMaterial({color: 0x3b4046}))
  const headLampMat = trackM(new T.MeshBasicMaterial({color: 0xd6d4c8}))

  const bodyCache = new Map<number, T.BufferGeometry>()
  const getBodyGeom = (p: number) => {
    const idx = ((p % 4) + 4) % 4
    let g = bodyCache.get(idx)
    if (!g) {
      g = buildCarGeometry(idx, false)
      bodyCache.set(idx, g)
    }
    return g
  }

  const root = new T.Group()
  root.name = 'dynamic-car'
  root.scale.setScalar(CAR_SCALE)
  const suspensionPivot = new T.Group()
  const CG_Y = .45
  suspensionPivot.position.set(0, CG_Y, 0)
  root.add(suspensionPivot)

  const bodyMesh = new T.Mesh(getBodyGeom(paint), bodyMat)
  bodyMesh.position.set(0, -CG_Y, 0)
  suspensionPivot.add(bodyMesh)

  for (const side of [-1, 1]) {
    const yaw = -side * .20
    const br = makeSolidPart(trackG(new T.BoxGeometry(.345, .048, .022)), brakeLampMat, side * .61, .85 - CG_Y, 2.222)
    br.rotation.set(-.06, yaw, 0)
    const rev = makeSolidPart(trackG(new T.BoxGeometry(.245, .034, .022)), reverseLampMat, side * .57, .775 - CG_Y, 2.222)
    rev.rotation.set(-.06, yaw, 0)
    const hl = makeSolidPart(trackG(new T.BoxGeometry(.22, .072, .024)), headLampMat, side * .62, .645 - CG_Y, -2.232)
    hl.rotation.set(.08, side * .22, 0)
    suspensionPivot.add(br, rev, hl)
  }

  const carBeamRig = createHeadlightBeamRig('car')
  carBeamRig.group.position.set(0, .64 - CG_Y, -2.24)
  suspensionPivot.add(carBeamRig.group)

  const wheelL = buildCarWheelGeometry(-1)
  const wheelR = buildCarWheelGeometry(1)
  const calGeom = trackG(new T.BoxGeometry(.045, .092, .062))

  function mountWheel(side: -1 | 1, wz: number, steerable: boolean) {
    const steerGroup = new T.Group()
    steerGroup.position.set(side * .795, .306, wz)
    const spinMesh = new T.Mesh(side < 0 ? wheelL : wheelR, wheelMat)
    const caliper = makeSolidPart(calGeom, caliperMat, side * .052, .02, -.09)
    steerGroup.add(spinMesh, caliper)
    root.add(steerGroup)
    return {steerGroup, spinMesh, steerable}
  }

  const fl = mountWheel(-1, -1.34, true)
  const fr = mountWheel(1, -1.34, true)
  const rl = mountWheel(-1, 1.31, false)
  const rr = mountWheel(1, 1.31, false)

  // Pooled world-space tire smoke puffs for GTA handbrake / high-slip drifts (zero per-frame allocations).
  const smokeGroup = new T.Group()
  smokeGroup.name = 'car-drift-smoke'
  const smokeGeo = trackG(new T.IcosahedronGeometry(.22, 0))
  const smokePool = Array.from({length: 18}, () => {
    const mat = trackM(new T.MeshBasicMaterial({color: 0xe6e4dc, transparent: true, opacity: 0, depthWrite: false}))
    const mesh = new T.Mesh(smokeGeo, mat)
    mesh.visible = false
    smokeGroup.add(mesh)
    return {mesh, mat, life: 0, maxLife: .55, vx: 0, vy: 0, vz: 0}
  })
  let smokeCursor = 0, smokeCooldown = 0

  let roll = 0, pitch = 0, heave = 0, heaveVel = 0, prevSpeed = 0, wheelSpin = 0, rearWheelSpin = 0, steerAngle = 0
  let lastBraking = false, lastReversing = false, lastHandbrake = false, roadPhase = 0

  function clearEffects() {
    for (const p of smokePool) {
      p.life = 0
      p.mesh.visible = false
      p.mat.opacity = 0
    }
  }

  return {
    root,
    smokeGroup,
    suspensionPivot,
    setPaint(nextPaint: number) {
      bodyMesh.geometry = getBodyGeom(nextPaint)
      roll = pitch = heave = heaveVel = prevSpeed = 0
      clearEffects()
    },
    clearEffects,
    triggerImpact(strength: number) {
      const s = T.MathUtils.clamp(strength, .1, 2.5)
      heaveVel -= .42 * s
      pitch -= .055 * s
      roll += (steerAngle >= 0 ? 1 : -1) * .025 * s
    },
    update(state) {
      const cdt = Math.min(.1, Math.max(1e-4, state.dt))
      root.position.copy(state.pos)
      root.rotation.set(state.groundPitch, state.heading, 0, 'YXZ')

      const accel = T.MathUtils.clamp((state.speed - prevSpeed) / cdt, -18, 18)
      prevSpeed = state.speed
      // Prefer authoritative 2D car physics weight transfer when supplied, fallback to kinematic estimate.
      const latFactor = T.MathUtils.clamp(state.speed * state.steerInput * .14, -1.2, 1.2)
      const targetRoll = state.dynRoll !== undefined ? state.dynRoll : T.MathUtils.clamp(-latFactor * .058, -.078, .078)
      const targetPitch = state.dynPitch !== undefined ? state.dynPitch : T.MathUtils.clamp(accel * .0048, -.048, .048)

      roll = T.MathUtils.damp(roll, targetRoll, 9.5, cdt)
      pitch = T.MathUtils.damp(pitch, targetPitch, 11, cdt)
      roadPhase += Math.abs(state.speed) * cdt * 2.4
      const roadRumble = Math.min(1, Math.abs(state.speed) / 22) * Math.sin(roadPhase) * .006
      // Spring-damper heave bounce (omega=15 rad/s, damp=14)
      heaveVel += (-225 * heave - 14 * heaveVel) * cdt
      heave = T.MathUtils.clamp(heave + heaveVel * cdt, -.09, .09)

      suspensionPivot.position.set(0, CG_Y + heave + roadRumble, 0)
      suspensionPivot.rotation.set(pitch, 0, roll, 'YXZ')

      steerAngle = T.MathUtils.damp(steerAngle, -state.steerInput * .44, 14, cdt)
      fl.steerGroup.rotation.y = steerAngle > 0 ? steerAngle * 1.07 : steerAngle * .93
      fr.steerGroup.rotation.y = steerAngle < 0 ? steerAngle * 1.07 : steerAngle * .93

      const spinDelta = (state.speed * cdt) / .306
      wheelSpin -= spinDelta
      fl.spinMesh.rotation.x = wheelSpin
      fr.spinMesh.rotation.x = wheelSpin
      // Handbrake locks rear wheels while front wheels keep rolling.
      if (!state.handbrake) rearWheelSpin -= spinDelta
      rl.spinMesh.rotation.x = rearWheelSpin
      rr.spinMesh.rotation.x = rearWheelSpin

      // Subtle independent wheel droop/compression compensation against body roll & pitch.
      const baseWheelY = .306
      fl.steerGroup.position.y = baseWheelY + T.MathUtils.clamp(-heave * .25 + roll * .18 - pitch * .22, -.04, .04)
      fr.steerGroup.position.y = baseWheelY + T.MathUtils.clamp(-heave * .25 - roll * .18 - pitch * .22, -.04, .04)
      rl.steerGroup.position.y = baseWheelY + T.MathUtils.clamp(-heave * .25 + roll * .18 + pitch * .22, -.04, .04)
      rr.steerGroup.position.y = baseWheelY + T.MathUtils.clamp(-heave * .25 - roll * .18 + pitch * .22, -.04, .04)

      // Emit world-space rear tire smoke during drift or high-speed handbrake lock.
      const drift = state.driftIntensity ?? 0
      const smoking = drift > .20 || (!!state.handbrake && Math.abs(state.speed) > 4.2)
      smokeCooldown = Math.max(0, smokeCooldown - cdt)
      if (smoking && smokeCooldown <= 0) {
        smokeCooldown = Math.max(.028, .075 - drift * .045)
        const fx = -Math.sin(state.heading), fz = -Math.cos(state.heading)
        const rx = Math.cos(state.heading), rz = -Math.sin(state.heading)
        for (const side of [-1, 1]) {
          const puff = smokePool[smokeCursor++ % smokePool.length]
          puff.life = puff.maxLife = .42 + drift * .28
          puff.mesh.position.set(
            state.pos.x + rx * (side * .78) - fx * 1.34,
            state.pos.y + .14,
            state.pos.z + rz * (side * .78) - fz * 1.34,
          )
          puff.vx = -fx * .4 + (Math.random() - .5) * .6
          puff.vy = .55 + drift * .55
          puff.vz = -fz * .4 + (Math.random() - .5) * .6
          puff.mesh.scale.setScalar(.55 + drift * .35)
          puff.mesh.visible = true
          puff.mat.opacity = Math.min(.52, .22 + drift * .34)
        }
      }
      for (const puff of smokePool) {
        if (puff.life <= 0) continue
        puff.life = Math.max(0, puff.life - cdt)
        const frac = puff.life / puff.maxLife
        if (frac <= 0) {
          puff.mesh.visible = false
          puff.mat.opacity = 0
        } else {
          puff.mesh.position.x += puff.vx * cdt
          puff.mesh.position.y += puff.vy * cdt
          puff.mesh.position.z += puff.vz * cdt
          puff.mesh.scale.setScalar(.55 + (1 - frac) * 1.35)
          puff.mat.opacity = frac * .44
        }
      }

      lastBraking = state.braking
      lastReversing = state.reversing
      lastHandbrake = !!state.handbrake
      const hlMode: TwoWheelHeadlightMode = state.headlight ?? 'off'
      headLampMat.color.setHex(hlMode === 'high' ? 0xffffff : hlMode === 'low' ? 0xfff4d6 : 0xd6d4c8)
      carBeamRig.update({mode: hlMode, night: state.night ?? 0})
      brakeLampMat.color.setHex(state.braking || state.handbrake ? 0xff3b30 : hlMode !== 'off' ? 0xba2822 : 0x7a1714)
      reverseLampMat.color.setHex(state.reversing ? 0xf8fafc : 0x3b4046)
    },
    probe() {
      let smokeActive = 0
      for (const p of smokePool) if (p.life > 0) smokeActive++
      const bp = carBeamRig.probe()
      return {
        roll, pitch, heave, steerAngle, wheelSpin, rearWheelSpin,
        braking: lastBraking, reversing: lastReversing, handbrake: lastHandbrake, smokeActive,
        headlight: bp.mode,
        headlightIntensity: bp.intensity,
        beamActive: bp.beamActive,
        beamDrawCalls: bp.drawCalls,
      }
    },
    dispose() {
      clearEffects()
      carBeamRig.dispose()
      for (const item of disposables) item.dispose()
      for (const g of bodyCache.values()) g.dispose()
      smokeGroup.removeFromParent()
      root.removeFromParent()
    },
  }
}
