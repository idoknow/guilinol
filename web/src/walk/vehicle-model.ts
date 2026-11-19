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
  const mesh=new T.Mesh(cache.get(key),material);mesh.name=kind
  if(kind==='bicycle'){
    const crank=new T.Mesh(getBicycleCrank(),material)
    crank.name='Crank';crank.position.set(0,.29,.05)
    mesh.add(crank)
  }
  return mesh
}
