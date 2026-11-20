import * as T from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'

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

export function vehicleModel(kind:string,paint=0){
  const key=kind+paint
  if(kind==='car'){
    if(!cache.has(key))cache.set(key,buildCarGeometry(paint))
    const mesh=new T.Mesh(cache.get(key),material);mesh.name=kind;return mesh
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
    if(kind==='bike'){
      const color=[0xf3f1e9,0x99c9de,0xe4afbb,0x383c40][paint%4]
      for(const z of [-.53,.53])part(new T.CylinderGeometry(.24,.24,.12,10).rotateZ(Math.PI/2),0x303234,0,.24,z)
      box(.38,.24,1,0,.37,0,color);box(.36,.32,.38,0,.58,.3,color);box(.4,.11,.48,0,.8,.27,0x443e3b)
      box(.18,.56,.14,0,.79,-.45,color);box(.68,.065,.09,0,1.04,-.43,0x474b4b)
      for(const side of [-1,1]){box(.025,.19,.025,side*.29,1.14,-.46,0x535858);box(.13,.08,.04,side*.29,1.25,-.46,0xa8b9bf)}
      for(const side of [-1,1]){box(.03,.2,.28,side*.18,.92,-.65,0x858883);box(.38,.2,.025,0,.92,-.65+side*.14,0x858883)}
    }else if(kind==='bicycle'){
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
  const mesh=new T.Mesh(cache.get(key),material);mesh.name=kind;mesh.userData.paint=paint
  if(kind==='bicycle'){
    const crank=new T.Mesh(getBicycleCrank(),material)
    crank.name='Crank';crank.position.set(0,.29,.05)
    mesh.add(crank)
  }
  return mesh
}

// Four understated Guilin street sedan finishes: pearl ivory, Lijiang slate blue, karst silver, osmanthus burgundy.
const CAR_PAINTS=[0xf0ede6,0x365b77,0x8c949c,0x8f3330] as const

function buildCarGeometry(paint=0):T.BufferGeometry{
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
  for(const side of [-1,1])for(const wz of [-1.34,1.31]){
    const wx=side*.795,wy=.306
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
    box(.045,.092,.062,wx+side*.052,wy+.02,wz-.09,brakeBright)
    for(let s=0;s<5;s++){
      const ang=(s*Math.PI*2)/5+.18,rMid=.10
      const spoke=new T.BoxGeometry(.026,.158,.034);spoke.rotateX(ang)
      emit(spoke,alloy,wx+side*.088,wy+Math.cos(ang)*rMid,wz+Math.sin(ang)*rMid)
    }
    const hub=new T.CylinderGeometry(.044,.048,.030,6);hub.rotateZ(Math.PI/2)
    emit(hub,chrome,wx+side*.092,wy,wz)
  }

  const merged=mergeGeometries(parts,false)
  for(const p of parts)p.dispose()
  merged.computeVertexNormals()
  return merged
}

export type EbikeModPreset = 'stock' | 'ghostfire' | 'neon'

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
}

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

export interface EbikeVisualRig {
  root: T.Group
  crashPivot: T.Group
  leanPivot: T.Group
  wheeliePivot: T.Group
  frontAssembly: T.Group
  frontWheel: T.Group
  rearWheel: T.Group
  seatAnchor: T.Object3D
  modSlots: {
    shell: T.Group
    headlight: T.Group
    underglow: T.Group
    shock: T.Group
    tailWing: T.Group
    exhaust: T.Group
  }
  applyMods: (next: EbikeModPreset | Partial<EbikeModConfig>, basePaint?: number) => void
  update: (state: {
    pos: T.Vector3
    heading: number
    groundPitch: number
    lean: number
    wheelie: number
    steerInput: number
    speed: number
    braking?: boolean
    crashRoll?: number
    crashLift?: number
    dt: number
  }) => void
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

/**
 * Articulated dynamic e-bike rig for active riding:
 * - Wheelie rotates around rear contact patch (0, 0, +0.53) so rear tire stays planted
 * - Lean tilts around ground contact line (0, 0, 0)
 * - Front fork + handlebar steer with rider hand/steer sync; wheels spin with speed
 * - Exposes 6 named visual mod slots (shell, headlight, underglow, shock, tailWing, exhaust)
 */
export function createDynamicEbike(paint = 0, initialMods?: Partial<EbikeModConfig>): EbikeVisualRig {
  const disposables: (T.BufferGeometry | T.Material)[] = []
  const trackG = <G extends T.BufferGeometry>(g: G) => { disposables.push(g); return g }
  const trackM = <M extends T.Material>(m: M) => { disposables.push(m); return m }

  const baseHex = EBIKE_STOCK_PAINTS[((paint % 4) + 4) % 4]
  const bodyMat = trackM(new T.MeshStandardMaterial({color: baseHex, flatShading: true, roughness: .55, metalness: .1}))
  const darkMat = trackM(new T.MeshStandardMaterial({color: 0x2b2e32, flatShading: true, roughness: .85}))
  const seatMat = trackM(new T.MeshStandardMaterial({color: 0x443e3b, flatShading: true, roughness: .9}))
  const alloyMat = trackM(new T.MeshStandardMaterial({color: 0xb6bec4, flatShading: true, roughness: .4, metalness: .45}))
  const mirrorMat = trackM(new T.MeshStandardMaterial({color: 0xa8b9bf, flatShading: true, roughness: .2, metalness: .6}))
  const headMat = trackM(new T.MeshBasicMaterial({color: 0xfff3d4}))
  const tailMat = trackM(new T.MeshBasicMaterial({color: 0xb32622}))
  const dashMat = trackM(new T.MeshBasicMaterial({color: 0x56d8c4}))
  const angelMat = trackM(new T.MeshBasicMaterial({color: 0x72ecff}))
  const glowMat = trackM(new T.MeshBasicMaterial({color: 0xc84bff}))
  const glowFloorMat = trackM(new T.MeshBasicMaterial({color: 0xc84bff, transparent: true, opacity: .24, depthWrite: false, side: T.DoubleSide}))
  const goldMat = trackM(new T.MeshStandardMaterial({color: 0xe3b23c, flatShading: true, roughness: .35, metalness: .55}))
  const accentMat = trackM(new T.MeshStandardMaterial({color: 0x9934d4, flatShading: true, roughness: .45}))

  const root = new T.Group()
  root.name = 'dynamic-ebike'
  const crashPivot = new T.Group()
  const leanPivot = new T.Group()
  const wheeliePivot = new T.Group()
  // Pivot wheelie strictly at rear wheel contact patch (0, 0, +0.53)
  wheeliePivot.position.set(0, 0, .53)
  root.add(crashPivot)
  crashPivot.add(leanPivot)
  leanPivot.add(wheeliePivot)

  const chassis = new T.Group()
  wheeliePivot.add(chassis)

  // Coordinates relative to rear contact patch (z - 0.53)
  const REAR_Z = .53
  const rearWheel = buildWheelGroup(darkMat, alloyMat)
  rearWheel.position.set(0, .24, 0)
  for (const ch of rearWheel.children) if (ch instanceof T.Mesh) trackG(ch.geometry)
  chassis.add(rearWheel)

  const shellSlot = new T.Group(); shellSlot.name = 'mod-shell'
  const deck = makeSolidPart(trackG(new T.BoxGeometry(.38, .22, .96)), bodyMat, 0, .37, -.53)
  const rearBox = makeSolidPart(trackG(new T.BoxGeometry(.36, .32, .38)), bodyMat, 0, .58, .30 - REAR_Z)
  const seat = makeSolidPart(trackG(new T.BoxGeometry(.40, .11, .48)), seatMat, 0, .80, .27 - REAR_Z)
  const footPad = makeSolidPart(trackG(new T.BoxGeometry(.34, .03, .42)), darkMat, 0, .49, -.08 - REAR_Z)
  const rearFender = makeSolidPart(trackG(new T.BoxGeometry(.16, .06, .34)), darkMat, 0, .50, .52 - REAR_Z)
  const tailLamp = makeSolidPart(trackG(new T.BoxGeometry(.16, .06, .04)), tailMat, 0, .63, .51 - REAR_Z)
  shellSlot.add(deck, rearBox)
  chassis.add(shellSlot, seat, footPad, rearFender, tailLamp)

  // Rear shock slot (stock grey struts vs gold nitrogen canister shocks)
  const shockSlot = new T.Group(); shockSlot.name = 'mod-shock'
  for (const side of [-1, 1]) {
    const rod = makeSolidPart(trackG(new T.CylinderGeometry(.022, .022, .34, 6)), alloyMat, side * .14, .46, .42 - REAR_Z)
    rod.rotation.x = -.32
    const canister = makeSolidPart(trackG(new T.CylinderGeometry(.034, .034, .16, 8)), goldMat, side * .16, .52, .45 - REAR_Z)
    canister.name = 'mod-gold-canister'
    canister.rotation.x = -.32
    shockSlot.add(rod, canister)
  }
  chassis.add(shockSlot)

  // Tail wing slot (ghostfire spoiler)
  const tailWingSlot = new T.Group(); tailWingSlot.name = 'mod-tailWing'
  const wingBlade = makeSolidPart(trackG(new T.BoxGeometry(.52, .04, .14)), accentMat, 0, .92, .56 - REAR_Z)
  wingBlade.rotation.x = -.18
  for (const side of [-1, 1]) {
    const fin = makeSolidPart(trackG(new T.BoxGeometry(.035, .13, .16)), bodyMat, side * .22, .85, .51 - REAR_Z)
    tailWingSlot.add(fin)
  }
  tailWingSlot.add(wingBlade)
  chassis.add(tailWingSlot)

  // Exhaust / crash-bar decoration slot
  const exhaustSlot = new T.Group(); exhaustSlot.name = 'mod-exhaust'
  const pipe = makeSolidPart(trackG(new T.CylinderGeometry(.045, .036, .52, 8).rotateX(Math.PI / 2)), alloyMat, .22, .30, .28 - REAR_Z)
  pipe.rotation.x = .16
  const tip = makeSolidPart(trackG(new T.CylinderGeometry(.05, .045, .10, 8).rotateX(Math.PI / 2)), darkMat, .22, .35, .56 - REAR_Z)
  tip.rotation.x = .16
  exhaustSlot.add(pipe, tip)
  chassis.add(exhaustSlot)

  // Underglow slot (attached to leanPivot so ground glow follows lean height cleanly)
  const underglowSlot = new T.Group(); underglowSlot.name = 'mod-underglow'
  for (const side of [-1, 1]) {
    underglowSlot.add(makeSolidPart(trackG(new T.BoxGeometry(.03, .025, .64)), glowMat, side * .18, .24, -.04))
  }
  const glowPatch = makeSolidPart(trackG(new T.PlaneGeometry(.72, 1.35).rotateX(-Math.PI / 2)), glowFloorMat, 0, .015, -.02)
  underglowSlot.add(glowPatch)
  leanPivot.add(underglowSlot)

  // Front steering assembly (stem at z = -0.43 -> relative z = -0.96)
  const frontAssembly = new T.Group()
  frontAssembly.position.set(0, 0, -.43 - REAR_Z)
  wheeliePivot.add(frontAssembly)

  const frontWheel = buildWheelGroup(darkMat, alloyMat)
  frontWheel.position.set(0, .24, -.10)
  for (const ch of frontWheel.children) if (ch instanceof T.Mesh) trackG(ch.geometry)
  const stem = makeSolidPart(trackG(new T.BoxGeometry(.18, .56, .14)), bodyMat, 0, .79, -.02)
  const forkL = makeSolidPart(trackG(new T.CylinderGeometry(.024, .022, .48, 6)), alloyMat, -.09, .45, -.07)
  const forkR = makeSolidPart(trackG(new T.CylinderGeometry(.024, .022, .48, 6)), alloyMat, .09, .45, -.07)
  const bar = makeSolidPart(trackG(new T.BoxGeometry(.68, .055, .075)), darkMat, 0, 1.04, 0)
  const dash = makeSolidPart(trackG(new T.BoxGeometry(.14, .025, .07)), dashMat, 0, 1.08, -.03)
  dash.rotation.x = -.35
  frontAssembly.add(frontWheel, stem, forkL, forkR, bar, dash)
  for (const side of [-1, 1]) {
    frontAssembly.add(
      makeSolidPart(trackG(new T.BoxGeometry(.08, .055, .055)), darkMat, side * .30, 1.04, 0),
      makeSolidPart(trackG(new T.BoxGeometry(.025, .19, .025)), darkMat, side * .29, 1.14, -.03),
      makeSolidPart(trackG(new T.BoxGeometry(.13, .08, .04)), mirrorMat, side * .29, 1.25, -.03),
    )
  }

  const headlightSlot = new T.Group(); headlightSlot.name = 'mod-headlight'
  const headLens = makeSolidPart(trackG(new T.BoxGeometry(.16, .09, .04)), headMat, 0, .74, -.10)
  const angelRing = makeSolidPart(trackG(new T.TorusGeometry(.065, .014, 6, 12)), angelMat, 0, .74, -.12)
  angelRing.name = 'mod-angel-ring'
  headlightSlot.add(headLens, angelRing)
  frontAssembly.add(headlightSlot)

  // Rider seat anchor aligned to vehicle-space (0, 0, +0.23) -> wheeliePivot (0, 0, -0.30)
  const seatAnchor = new T.Object3D()
  seatAnchor.name = 'rider-seat-anchor'
  seatAnchor.position.set(0, 0, .23 - REAR_Z)
  wheeliePivot.add(seatAnchor)

  let wheelSpin = 0
  let currentPaint = paint

  function applyMods(next: EbikeModPreset | Partial<EbikeModConfig>, basePaint = currentPaint) {
    currentPaint = basePaint
    const presetKey: EbikeModPreset = typeof next === 'string' ? next : (next.preset ?? 'stock')
    const baseCfg = EBIKE_MOD_PRESETS[presetKey] ?? EBIKE_MOD_PRESETS.stock
    const cfg: EbikeModConfig = typeof next === 'string' ? baseCfg : {...baseCfg, ...next, preset: presetKey}

    const stockHex = EBIKE_STOCK_PAINTS[((basePaint % 4) + 4) % 4]
    bodyMat.color.setHex(cfg.paintColor ?? stockHex)
    glowMat.color.setHex(cfg.underglowColor)
    glowFloorMat.color.setHex(cfg.underglowColor)
    angelMat.color.setHex(cfg.angelEyeColor)
    accentMat.color.setHex(cfg.angelEyeColor)

    underglowSlot.visible = cfg.underglow
    angelRing.visible = cfg.angelEye
    tailWingSlot.visible = cfg.tailWing
    exhaustSlot.visible = cfg.exhaust
    for (const child of shockSlot.children) {
      if (child.name === 'mod-gold-canister') child.visible = cfg.goldShock
    }
  }

  applyMods(initialMods ?? 'stock', paint)

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
    applyMods,
    update(state) {
      root.position.copy(state.pos)
      root.rotation.set(state.groundPitch, state.heading, 0, 'YXZ')
      const crashRoll = state.crashRoll ?? 0
      crashPivot.rotation.set(0, 0, crashRoll)
      crashPivot.position.set(0, state.crashLift ?? 0, 0)
      leanPivot.rotation.set(0, 0, state.lean)
      wheeliePivot.rotation.set(state.wheelie, 0, 0)
      frontAssembly.rotation.y = -state.steerInput * .42

      const spinDelta = (state.speed * state.dt) / .24
      wheelSpin -= spinDelta
      rearWheel.rotation.x = wheelSpin
      // When wheelieing in air, front wheel coasts slightly slower.
      frontWheel.rotation.x -= state.wheelie > .08 ? spinDelta * .35 : spinDelta

      tailMat.color.setHex(state.braking || state.speed < -.05 ? 0xff4238 : 0x99201c)
    },
    dispose() {
      for (const item of disposables) item.dispose()
      root.removeFromParent()
    },
  }
}
