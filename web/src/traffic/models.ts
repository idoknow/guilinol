import * as T from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {shareAtmosphere} from '../look/atmosphere'
import {CAR_SCALE} from '../drive/scale'
import {bikeGeometry} from '../walk/ebike-geometry'
import {vehicleModel} from '../walk/vehicle-model'

// IDOK-149 / IDOK-283 交通车模: low-poly, flat-shaded street traffic in one BatchedMesh draw.
// Every model faces +z (actor yaw = atan2(dx,dz)), stands on y = 0 and carries two vertex
// attributes: `color` (base colour; white where the body takes the per-instance paint) and
// `aMask` = (paint, lamp, flash). Lamps glow a little by day and properly at night (uNight);
// flash = +1 red / -1 blue police lightbar, alternating on uTime.

export type TrafficViolation = 'none' | 'no_helmet' | 'ebike_overload' | 'bike_double'
export type TwoWheelSubtype = 'ebike' | 'bicycle'

export interface TwoWheelActorLike {
  kind: 'car' | 'scooter' | 'person'
  x: number
  y: number
  z: number
  yaw: number
  speed: number
  scale: number
  leaving: boolean
  down?: number
  vehicleSubtype?: TwoWheelSubtype
  violation?: TrafficViolation
  stoppedUntil?: number
  cited?: boolean
}

export function resolveTwoWheelSpec(actor: TwoWheelActorLike): {subtype: TwoWheelSubtype; violation: TrafficViolation} {
  const violation: TrafficViolation = actor.violation ?? 'none'
  const subtype: TwoWheelSubtype = actor.vehicleSubtype ?? (violation === 'bike_double' ? 'bicycle' : 'ebike')
  return {subtype, violation}
}

type Mask = readonly [number,number,number]
const NONE:Mask=[0,0,0],PAINT:Mask=[1,0,0],LAMP:Mask=[0,1,0],RED:Mask=[0,.4,1],BLUE:Mask=[0,.4,-1]
type Pt = [number,number]

const tire=0x1d1f22,rim=0xb4bbc1,glass=0x1f2c34,trim=0x25282b,grille=0x16181a,head=0xf3efdf,tail=0xc22d27,
  amber=0xe39a35,chrome=0xc3c8cc,barrel=0x34383d,sheen=0x587283,housing=0x2a2e33,plateBlue=0x2a579e,plateGreen=0x7cc48c,plateYellow=0xe2b23a,skin=0xd9a986,hair=0x1d1a19

class Kit {
  parts:T.BufferGeometry[]=[]
  add(raw:T.BufferGeometry,color:number,x=0,y=0,z=0,mask:Mask=NONE){
    const g=raw.index?raw.toNonIndexed():raw
    if(g!==raw)raw.dispose()
    g.deleteAttribute('uv')
    if(x||y||z)g.translate(x,y,z)
    const n=g.attributes.position.count,c=new T.Color(color),col=new Float32Array(n*3),m=new Float32Array(n*3)
    for(let i=0;i<n;i++){col.set([c.r,c.g,c.b],i*3);m.set(mask,i*3)}
    g.setAttribute('color',new T.BufferAttribute(col,3));g.setAttribute('aMask',new T.BufferAttribute(m,3))
    this.parts.push(g);return g
  }
  addColored(raw:T.BufferGeometry,rotateY=0,classify?:(r:number,g:number,b:number,x:number,y:number,z:number)=>{color?:[number,number,number],mask:Mask}){
    const g=raw.index?raw.toNonIndexed():raw.clone()
    g.deleteAttribute('uv')
    if(rotateY)g.rotateY(rotateY)
    if(!g.attributes.normal)g.computeVertexNormals()
    const pos=g.attributes.position,src=g.attributes.color,n=pos.count
    const col=new Float32Array(n*3),m=new Float32Array(n*3)
    for(let i=0;i<n;i++){
      const r=src?src.getX(i):1,gr=src?src.getY(i):1,b=src?src.getZ(i):1
      const res=classify?.(r,gr,b,pos.getX(i),pos.getY(i),pos.getZ(i))
      if(res?.color)col.set(res.color,i*3);else col.set([r,gr,b],i*3)
      m.set(res?.mask??NONE,i*3)
    }
    g.setAttribute('color',new T.BufferAttribute(col,3));g.setAttribute('aMask',new T.BufferAttribute(m,3))
    this.parts.push(g);return g
  }
  limb(rTop:number,rBot:number,x1:number,y1:number,z1:number,x2:number,y2:number,z2:number,color:number,mask:Mask=NONE,segs=7){
    const dx=x2-x1,dy=y2-y1,dz=z2-z1,len=Math.hypot(dx,dy,dz)
    if(len<1e-4)return
    const g=new T.CylinderGeometry(rTop,rBot,len,segs)
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),new T.Vector3(dx/len,dy/len,dz/len)))
    this.add(g,color,(x1+x2)/2,(y1+y2)/2,(z1+z2)/2,mask)
    this.add(new T.SphereGeometry(rTop,6,4),color,x2,y2,z2,mask)
  }
  capsule(r:number,len:number,x:number,y:number,z:number,color:number,mask:Mask=NONE,rx=0,ry=0,rz=0){
    const g=new T.CapsuleGeometry(r,Math.max(.01,len),3,7)
    if(rx)g.rotateX(rx);if(ry)g.rotateY(ry);if(rz)g.rotateZ(rz)
    return this.add(g,color,x,y,z,mask)
  }
  box(w:number,h:number,d:number,x:number,y:number,z:number,color:number,mask:Mask=NONE,rx=0,ry=0,rz=0){
    const g=new T.BoxGeometry(w,h,d)
    if(rx)g.rotateX(rx);if(ry)g.rotateY(ry);if(rz)g.rotateZ(rz)
    return this.add(g,color,x,y,z,mask)
  }
  // Side silhouette (z,y) extruded across the car, chamfered edges; centred on x.
  side(points:Pt[],width:number,x:number,color:number,mask:Mask=NONE,bevel=0){
    const shape=new T.Shape(points.map(([z,y])=>new T.Vector2(z,y)))
    const depth=Math.max(.005,width-2*bevel)
    const g=new T.ExtrudeGeometry(shape,{depth,steps:1,bevelEnabled:bevel>0,bevelThickness:bevel,bevelSize:bevel,bevelSegments:1,curveSegments:1})
    g.translate(0,0,-depth/2);g.rotateY(-Math.PI/2)
    return this.add(g,color,x,0,0,mask)
  }
  // Thin panel lying on the edge a→b of a side profile, pushed outward (front: +z, rear: −z).
  pane(a:Pt,b:Pt,width:number,trimEnds:number,color:number,front:boolean,out=.05,mask:Mask=NONE,thick=.025,from=0,to=1){
    if(from||to<1){const at=(t:number):Pt=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];[a,b]=[at(from),at(to)]}
    const dz=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dz,dy)
    let ny=-dz/len,nz=dy/len
    if(ny*.3+nz*(front?1:-1)<0){ny=-ny;nz=-nz}
    // Box long (y) axis rotated onto the edge direction (dy,dz).
    const g=new T.BoxGeometry(width,len-2*trimEnds,thick).rotateX(Math.atan2(dz,dy))
    return this.add(g,color,0,(a[1]+b[1])/2+ny*out,(a[0]+b[0])/2+nz*out,mask)
  }
  // IDOK-253 精模轮：14 段胎、深色轮辋筒、5 辐、亮色轮圈和轮毂盖，外侧朝车外
  wheel(r:number,w:number,x:number,z:number,hub=rim,spokes=5){
    const s=Math.sign(x)||1,face=x+s*w/2,turn=s*Math.PI/2
    this.add(new T.CylinderGeometry(r,r,w,14).rotateZ(Math.PI/2),tire,x,r,z)
    this.add(new T.CylinderGeometry(r*.64,r*.64,.016,12).rotateZ(Math.PI/2),barrel,face+s*.006,r,z)
    this.add(new T.RingGeometry(r*.55,r*.66,12,1).rotateY(turn),hub,face+s*.016,r,z)
    for(let i=0;i<spokes;i++)this.add(new T.BoxGeometry(.016,r*.5,r*.16).translate(0,r*.3,0).rotateX(i*Math.PI*2/spokes),hub,face+s*.018,r,z)
    this.add(new T.CylinderGeometry(r*.16,r*.16,.03,8).rotateZ(Math.PI/2),hub,face+s*.02,r,z)
  }
  // Wheel-arch lip: half ring over the tyre, flush with the body side.
  arch(r:number,x:number,z:number,color=trim,width=.08){
    const s=Math.sign(x)||1
    this.add(new T.RingGeometry(r+.04,r+.04+width,10,1,0,Math.PI).rotateY(s*Math.PI/2),color,x,r,z)
  }
  build(){
    const g=mergeGeometries(this.parts)!
    for(const p of this.parts)p.dispose()
    g.computeBoundingSphere();g.computeBoundingBox();return g
  }
}

const lerpZ=(a:Pt,b:Pt,y:number)=>a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1])

type CarSpec = {
  W:number,r:number,wf:number,wr:number,lower:Pt[],cabin:[Pt,Pt,Pt,Pt],
  headY:number,tailY:number,body?:number,cab?:number,mask?:Mask,plate?:number,
  pillars?:number[],cladding?:boolean,rails?:boolean,lampW?:number
}

// Distance stand-in (IDOK-253 LOD): body + cabin + glass + lamps + plain wheels, ~350 tris.
function liteCar(spec:CarSpec,body=0xffffff,mask:Mask=PAINT,extra?:(kit:Kit)=>void){
  const k=new Kit(),{W,r,lower,cabin}=spec,[rb,rt,ft,fb]=cabin,cw=W-.2
  const front=Math.max(...lower.map(p=>p[0])),rear=Math.min(...lower.map(p=>p[0]))
  k.side(lower,W,0,body,mask);k.side(cabin,cw,0,body,mask)
  k.pane(fb,ft,cw*.9,.05,glass,true,.045);k.pane(rb,rt,cw*.9,.05,glass,false,.045)
  for(const s of [-1,1]){
    k.side(cabin.map(([z,y])=>[z+(z>0?-.12:.12),y+(y>1.2?-.08:.07)] as Pt),.02,s*(cw/2+.03),glass)
    k.box(.34,.1,.06,s*(W/2-.25),spec.headY,front,head,LAMP);k.box(.34,.12,.06,s*(W/2-.24),spec.tailY,rear,tail,LAMP)
    for(const z of [spec.wf,spec.wr])k.add(new T.CylinderGeometry(r,r,.24,8).rotateZ(Math.PI/2),tire,s*(W/2-.15),r,z)
  }
  extra?.(k)
  return k.build()
}

function car(spec:CarSpec,extra?:(kit:Kit,spec:CarSpec)=>void){
  const k=new Kit(),{W,r,lower,cabin}=spec
  const body=spec.body??0xffffff,cab=spec.cab??body,mask=spec.mask??PAINT,cabMask=spec.cab!==undefined?NONE:mask
  const front=Math.max(...lower.map(p=>p[0])),rear=Math.min(...lower.map(p=>p[0]))
  const cw=W-.2,[rb,rt,ft,fb]=cabin,belt=Math.min(rb[1],fb[1]),roof=Math.max(rt[1],ft[1])
  k.side(lower,W,0,body,mask,.06)
  k.side(cabin,cw,0,cab,cabMask,.04)
  // Glasshouse: windscreen, rear screen, side glass with door pillars; a lighter sky band across the top
  // of each screen and a diagonal sheen on the side glass read as reflections from street distance.
  k.pane(fb,ft,cw*.9,.05,glass,true,.045)
  k.pane(fb,ft,cw*.86,.02,sheen,true,.052,NONE,.02,.62,.9)
  k.pane(rb,rt,cw*.9,.05,glass,false,.045)
  k.pane(rb,rt,cw*.84,.02,sheen,false,.052,NONE,.02,.66,.9)
  const gy0=belt+.07,gy1=roof-.08
  const gz=(y:number,front:boolean)=>front?lerpZ(fb,ft,y)-.08:lerpZ(rb,rt,y)+.08
  const glassPts:Pt[]=[[gz(gy0,false),gy0],[gz(gy1,false),gy1],[gz(gy1,true),gy1],[gz(gy0,true),gy0]]
  const midZ=(gz(gy0,true)+gz(gy0,false))/2,pillars=spec.pillars??[midZ-.1]
  for(const s of [-1,1]){
    k.side(glassPts,.02,s*(cw/2+.045),glass)
    for(const [lo,hi] of [[-.62,-.3],[.3,.5]])
      k.side([[midZ+lo,gy0+.03],[midZ+lo+.34,gy1-.03],[midZ+hi+.34,gy1-.03],[midZ+hi,gy0+.03]],.012,s*(cw/2+.058),sheen)
    for(const p of pillars)k.box(.03,gy1-gy0+.02,.09,s*(cw/2+.06),(gy0+gy1)/2,p,cab,cabMask)
    k.box(.015,.025,gz(gy0,true)-gz(gy0,false),s*(cw/2+.066),gy0-.015,midZ,chrome)              // chrome window line
    // Mirrors (black base, body-colour cap), door handles, door seams, dark rocker strip.
    k.box(.05,.06,.08,s*(W/2+.02),belt+.05,fb[0]-.1,housing)
    k.box(.16,.1,.12,s*(W/2+.1),belt+.07,fb[0]-.14,body,mask)
    k.box(.04,.03,1.6,s*(W/2+.012),.36,(spec.wf+spec.wr)/2,trim)
    for(const z of pillars.map(p=>p+.1))k.box(.02,.03,.14,s*(W/2+.07),belt-.1,z+.32,chrome)
    for(const z of [fb[0]-.02,...pillars,spec.wr+r+.14])k.box(.012,belt-.48,.014,s*(W/2+.004),(belt+.44)/2,z,housing)
    for(const z of [spec.wf,spec.wr])k.arch(r,s*(W/2+.004),z,trim,spec.cladding?.12:.07)
    if(spec.rails)k.box(.05,.05,(ft[0]-rt[0])*.92,s*(cw/2-.12),roof+.07,(ft[0]+rt[0])/2,0x2c2f32)
  }
  k.box(.07,.06,.2,0,roof+.03,rt[0]+.22,housing)                                                 // shark-fin antenna
  for(const s of [-1,1])k.box(.5,.02,.03,s*.28,fb[1]+.05,fb[0]+.03,housing,NONE,0,s*.12)         // wipers
  // Nose: slatted grille, lamp clusters (dark housing, lens, LED strip), fog lamps, bumper, plate.
  // Tail: through-type light bar + corner clusters, bumper, plate.
  const lw=spec.lampW??.34
  k.box(W*.42,.14,.06,0,spec.headY-.1,front+.02,grille)
  for(const dy of [-.04,0,.04])k.box(W*.4,.012,.02,0,spec.headY-.1+dy,front+.055,chrome)
  for(const s of [-1,1]){
    k.box(lw+.04,.14,.07,s*(W/2-lw/2-.06),spec.headY,front-.02,housing)
    k.box(lw*.55,.08,.08,s*(W/2-lw*.38-.08),spec.headY,front-.005,head,LAMP)
    k.box(lw,.02,.08,s*(W/2-lw/2-.06),spec.headY+.055,front-.003,0xffffff,LAMP)
    k.box(.12,.05,.06,s*(W/2-.08),spec.headY-.1,front-.01,amber,LAMP)
    k.box(.12,.05,.05,s*(W/2-.28),.44,front+.01,head,LAMP)
    k.box(lw,.12,.08,s*(W/2-lw/2-.05),spec.tailY,rear+.01,tail,LAMP)
    k.box(.1,.05,.06,s*(W/2-.12),spec.tailY-.1,rear+.01,amber,LAMP)
  }
  k.box(W*.86,.035,.06,0,spec.tailY+.07,rear-.005,tail,LAMP)
  k.box(W+.04,.16,.12,0,.36,front-.03,trim);k.box(W+.04,.16,.12,0,.36,rear+.03,trim)
  k.box(.44,.13,.03,0,.5,front+.04,spec.plate??plateBlue);k.box(.44,.13,.03,0,.56,rear-.04,spec.plate??plateBlue)
  k.wheel(r,.24,-(W/2-.15),spec.wf);k.wheel(r,.24,W/2-.15,spec.wf)
  k.wheel(r,.24,-(W/2-.15),spec.wr);k.wheel(r,.24,W/2-.15,spec.wr)
  extra?.(k,spec)
  return k.build()
}

const sedanSpec:CarSpec={W:1.8,r:.33,wf:1.45,wr:-1.38,headY:.8,tailY:.82,
  lower:[[-2.34,.3],[-2.38,.66],[-2.28,.9],[-1.4,.96],[1.1,.95],[2.12,.83],[2.37,.64],[2.33,.3]],
  cabin:[[-1.48,.94],[-.78,1.43],[.42,1.45],[1.2,.94]]}
const hatchSpec:CarSpec={W:1.76,r:.31,wf:1.3,wr:-1.26,headY:.8,tailY:.9,plate:plateGreen,
  lower:[[-1.99,.3],[-2.02,.7],[-1.96,.94],[.92,.95],[1.78,.85],[2.01,.66],[1.98,.3]],
  cabin:[[-1.93,.93],[-1.8,1.47],[.25,1.51],[.98,.94]]}
const suvSpec:CarSpec={W:1.88,r:.37,wf:1.42,wr:-1.38,headY:.92,tailY:1,cladding:true,rails:true,
  lower:[[-2.33,.4],[-2.37,.8],[-2.3,1.08],[1.02,1.1],[2.08,1],[2.36,.82],[2.32,.4]],
  cabin:[[-2.24,1.07],[-2.08,1.65],[.55,1.68],[1.1,1.09]]}
const vanSpec:CarSpec={W:1.66,r:.29,wf:1.38,wr:-1.28,headY:.86,tailY:1.05,lampW:.26,pillars:[.62,-.55,-1.45],
  lower:[[-2.08,.3],[-2.1,.98],[1.82,.98],[2.08,.86],[2.1,.3]],
  cabin:[[-2.06,.96],[-2.02,1.86],[1.38,1.87],[2.0,1.0]]}

function truck(){
  const k=new Kit(),W=1.94,r=.38
  k.box(1.1,.25,5.2,0,.62,-.25,0x222427)                                    // ladder chassis
  const cab:Pt[]=[[1.25,.55],[1.25,2.22],[2.2,2.24],[2.7,1.42],[2.8,.55]]
  k.side(cab,W,0,0xffffff,PAINT,.05)
  k.pane([2.7,1.42],[2.2,2.24],W*.86,.05,glass,true,.05)
  for(const s of [-1,1]){
    k.side([[1.42,1.45],[1.42,2.08],[2.14,2.1],[2.55,1.45]],.02,s*(W/2+.03),glass)
    k.box(.12,.1,.1,s*(W/2+.14),1.8,2.35,trim);k.box(.04,.28,.04,s*(W/2+.08),1.7,2.35,trim)
    k.box(.3,.12,.08,s*(W/2-.25),.95,2.81,head,LAMP);k.box(.24,.14,.06,s*(W/2-.18),.82,-2.86,tail,LAMP)
  }
  k.box(W*.5,.28,.06,0,1.1,2.82,grille);k.box(W+.04,.2,.14,0,.62,2.8,trim)
  k.box(2.04,2.3,3.95,0,1.98,-.8,0xdfe1e0)                                   // aluminium box body
  for(const z of [-2.2,-1.4,-.6,.2])for(const s of [-1,1])k.box(.02,2.2,.06,s*1.03,1.98,z,0xb3b8bb)
  k.box(2.06,.1,3.97,0,3.1,-.8,0xb3b8bb);k.box(2.06,.12,3.97,0,.87,-.8,0x9da3a7)
  for(const s of [-1,1])k.box(.02,.32,2.6,s*1.035,1.95,-.6,0x2f7d6e)            // jade side stripe
  k.box(.44,.22,.03,0,.62,2.89,plateYellow);k.box(.44,.22,.03,0,.98,-2.8,plateYellow)
  for(const s of [-1,1]){k.wheel(r,.26,s*(W/2-.17),2.05);k.wheel(r,.24,s*(W/2-.13),-1.7);k.wheel(r,.24,s*(W/2-.39),-1.7)}
  return k.build()
}

// IDOK-283 电动车/单车精模复用（ebike-geometry + vehicle-model）+ 圆润低面人形骑手替身（零方块）
function appendEbikeMesh(k:Kit,far:boolean,deliveryBox?:number){
  const painted=bikeGeometry(0xffffff,far,undefined,true)
  k.addColored(painted,Math.PI,()=>({color:[1,1,1],mask:PAINT}))
  painted.dispose()
  const base=bikeGeometry(0xffffff,far,undefined,false)
  k.addColored(base,Math.PI,(r,g,b,_x,y,z)=>{
    const isLamp=(r>.68&&g>.68&&b>.68&&z>.35&&(y>.95||y<.75))||(r>.3&&g<.05&&b<.05&&z<-.7)
    return {mask:isLamp?LAMP:NONE}
  })
  base.dispose()
  if(deliveryBox!==undefined){
    const shape=new T.Shape([
      [-.16,-.15],[.16,-.15],[.18,0],[.16,.16],[-.16,.16],[-.18,0],
    ].map(([z,y])=>new T.Vector2(z,y)))
    const boxGeom=new T.ExtrudeGeometry(shape,{depth:.36,steps:1,bevelEnabled:true,bevelThickness:.025,bevelSize:.022,bevelSegments:1,curveSegments:2})
    boxGeom.translate(0,0,-.18);boxGeom.rotateY(-Math.PI/2)
    k.add(boxGeom,deliveryBox,0,.92,-.66)
    k.capsule(.025,.34,0,1.11,-.66,0x23272b,NONE,0,0,Math.PI/2)
  }
}

const BICYCLE_KEY_COLOR=new T.Color(0x5b8a72)
function appendBicycleMesh(k:Kit,far:boolean,rearRack=false){
  if(far){
    for(const z of [-.54,.54]){
      k.add(new T.TorusGeometry(.304,.026,5,10).rotateY(Math.PI/2),tire,0,.33,z)
      k.add(new T.TorusGeometry(.26,.012,4,10).rotateY(Math.PI/2),rim,0,.33,z)
    }
    k.limb(.02,.02,0,.29,-.05,0,.72,-.19,0xffffff,PAINT,5)
    k.limb(.02,.02,0,.64,.43,0,.29,-.05,0xffffff,PAINT,5)
    k.limb(.018,.018,0,.74,.41,0,.58,-.14,0xffffff,PAINT,5)
    k.limb(.02,.02,0,.61,.44,0,.97,.38,0xffffff,PAINT,5)
    k.limb(.014,.014,-.24,.98,.38,.24,.98,.38,rim,NONE,5)
    k.capsule(.05,.18,0,.84,-.22,0x423832,NONE,Math.PI/2)
    k.capsule(.10,.08,0,.83,.56,0xa68963,NONE)
    if(rearRack){
      k.capsule(.075,.28,0,.70,-.48,0x25292d,NONE,Math.PI/2)
      k.limb(.014,.014,0,.70,-.38,0,.33,-.54,0x25292d,NONE,5)
    }
    return
  }
  const mesh=vehicleModel('bicycle',0)
  mesh.updateMatrixWorld(true)
  mesh.traverse(obj=>{
    if(!(obj instanceof T.Mesh))return
    const geom=obj.geometry.clone()
    geom.applyMatrix4(obj.matrixWorld)
    k.addColored(geom,Math.PI,(r,g,b)=>{
      const dr=r-BICYCLE_KEY_COLOR.r,dg=g-BICYCLE_KEY_COLOR.g,db=b-BICYCLE_KEY_COLOR.b
      // Tighten match threshold to 0.0005 so only bike frame (#5b8a72) takes paint, preserving basket & chainring
      return dr*dr+dg*dg+db*db<.0005?{color:[1,1,1],mask:PAINT}:{mask:NONE}
    })
    geom.dispose()
  })
  if(rearRack){
    // Tubular rear luggage rack & cushioned passenger pad at +Z-forward rear z in [-0.64, -0.34], y ~ 0.70
    for(const s of [-1,1]){
      k.limb(.011,.011,s*.085,.70,-.34,s*.085,.70,-.64,0x2b2e30,NONE,5)
      k.limb(.010,.010,s*.085,.70,-.62,s*.048,.33,-.54,0x2b2e30,NONE,5)
      k.limb(.010,.010,s*.085,.70,-.36,s*.042,.67,-.19,0x2b2e30,NONE,5)
      k.capsule(.016,.065,s*.11,.33,-.54,0x1f2326,NONE,0,0,Math.PI/2)
    }
    k.capsule(.068,.24,0,.72,-.49,0x332c28,NONE,Math.PI/2)
  }
}

type StandinRiderOpts={
  x:number,y:number,z:number,scale?:number,ry?:number,
  jacket:number,pants:number,helmet?:number,hairStyle?:'short'|'pony'|'long',hairTint?:number,
  pose:'ebike'|'child_front'|'rear_passenger'|'bicycle'|'crossbar'
}
function addRoundedStandinRider(k:Kit,o:StandinRiderOpts,far=false){
  const s=o.scale??1,hc=o.hairTint??hair,shoe=0x1e2024
  const tk=new Kit()
  const noHelmHair=0x33261e
  if(o.pose==='child_front'){
    for(const side of [-1,1]){
      tk.limb(.058,.048,side*.08,.48,0,side*.08,.06,0,o.pants)
      tk.capsule(.045,.09,side*.08,.04,.03,shoe,NONE,Math.PI/2)
      tk.limb(.046,.038,side*.16,1.24,0,side*.14,.92,.20,o.jacket)
      tk.add(new T.SphereGeometry(.038,6,4),skin,side*.14,.92,.22)
    }
    tk.capsule(.12,.34,0,1.08,0,o.jacket,NONE,.06)
    tk.capsule(.10,.12,0,.86,0,o.pants)
    tk.add(new T.IcosahedronGeometry(.118,1),skin,0,1.44,.03)
    tk.add(new T.SphereGeometry(.120,8,4,0,Math.PI*2,0,Math.PI*.44),noHelmHair,0,1.48,-.005)
  }else if(o.pose==='rear_passenger'){
    for(const side of [-1,1]){
      tk.limb(.068,.056,side*.12,.86,.02,side*.18,.68,.30,o.pants)
      tk.limb(.054,.044,side*.18,.68,.30,side*.20,.35,.18,o.pants)
      tk.capsule(.048,.11,side*.20,.33,.21,shoe,NONE,Math.PI/2)
      tk.limb(.048,.04,side*.18,1.30,0,side*.20,1.04,.30,o.jacket)
      tk.add(new T.SphereGeometry(.04,6,4),skin,side*.20,1.04,.32)
    }
    tk.capsule(.135,.38,0,1.12,.04,o.jacket,NONE,.10)
    tk.capsule(.115,.14,0,.86,0,o.pants)
    tk.add(new T.IcosahedronGeometry(.122,1),skin,0,1.52,.07)
    if(o.helmet!==undefined){
      tk.add(new T.SphereGeometry(.152,10,5,0,Math.PI*2,0,Math.PI*.56),o.helmet,0,1.55,.06)
      tk.capsule(.028,.15,0,1.54,.19,0x1d2329,NONE,0,0,Math.PI/2)
    }else{
      const hr=o.hairTint??noHelmHair
      tk.add(new T.SphereGeometry(.122,8,4,0,Math.PI*2,0,Math.PI*.44),hr,0,1.56,.045)
      if(o.hairStyle==='pony')tk.capsule(.04,.18,0,1.48,-.12,hr,NONE,-.45)
      else if(o.hairStyle==='long')tk.capsule(.095,.24,0,1.40,-.07,hr,NONE,-.15)
    }
  }else if(o.pose==='crossbar'){
    // Sideways crossbar passenger (local +X faces outward from bike side)
    for(const side of [-1,1]){
      tk.limb(.062,.05,side*.08,.76,0,side*.08,.74,.32,o.pants)
      tk.limb(.05,.04,side*.08,.74,.32,side*.08,.36,.32,o.pants)
      tk.capsule(.045,.1,side*.08,.33,.36,shoe,NONE,Math.PI/2)
      tk.limb(.046,.038,side*.16,1.22,0,side*.14,.92,.20,o.jacket)
    }
    tk.capsule(.125,.36,0,1.06,0,o.jacket,NONE,.06)
    tk.capsule(.105,.12,0,.80,0,o.pants)
    tk.add(new T.IcosahedronGeometry(.118,1),skin,0,1.44,.04)
    tk.add(new T.SphereGeometry(.120,8,4,0,Math.PI*2,0,Math.PI*.44),noHelmHair,0,1.48,.015)
  }else{
    const isBike=o.pose==='bicycle',spread=isBike?.14:.15,handY=isBike?.98:1.12,handZ=isBike?.58:.48,footY=isBike?.36:.32,footZ=isBike?.28:.38
    for(const side of [-1,1]){
      tk.limb(.068,.056,side*.10,.86,0,side*spread,.64,.30,o.pants)
      tk.limb(.054,.044,side*spread,.64,.30,side*spread,footY,footZ,o.pants)
      tk.capsule(.048,.11,side*spread,footY-.02,footZ+.04,shoe,NONE,Math.PI/2)
      tk.limb(.048,.04,side*.19,1.32,.04,side*.24,handY,handZ,o.jacket)
      tk.add(new T.SphereGeometry(.04,6,4),skin,side*.24,handY,handZ+.02)
    }
    tk.capsule(.138,.38,0,1.14,.04,o.jacket,NONE,.16)
    tk.capsule(.118,.14,0,.88,0,o.pants)
    tk.add(new T.IcosahedronGeometry(.124,1),skin,0,1.53,.11)
    if(o.helmet!==undefined){
      tk.add(new T.SphereGeometry(.155,10,5,0,Math.PI*2,0,Math.PI*.56),o.helmet,0,1.56,.095)
      tk.capsule(.032,.16,0,1.545,.225,0x1d2329,NONE,0,0,Math.PI/2)
    }else{
      const hr=o.hairTint??noHelmHair
      tk.add(new T.SphereGeometry(.125,8,4,0,Math.PI*2,0,Math.PI*.43),hr,0,1.57,.07)
      if(o.hairStyle==='pony')tk.capsule(.044,.19,0,1.49,-.085,hr,NONE,-.45)
      else if(o.hairStyle==='long')tk.capsule(.098,.25,0,1.40,-.035,hr,NONE,-.15)
    }
  }
  const g=tk.build()
  if(s!==1)g.scale(s,s,s)
  if(o.ry)g.rotateY(o.ry)
  g.translate(o.x,o.y,o.z)
  k.addColored(g)
  g.dispose()
}

type ScooterStandinOpts={
  subtype:TwoWheelSubtype,violation:TrafficViolation,jacket:number,pants:number,
  helmet?:number,hairStyle?:'short'|'pony'|'long',box?:number,far?:boolean
}
function scooter(opts:ScooterStandinOpts){
  const k=new Kit(),far=!!opts.far
  if(opts.subtype==='bicycle'){
    const doubleBike=opts.violation==='bike_double'
    appendBicycleMesh(k,far,doubleBike)
    addRoundedStandinRider(k,{x:0,y:.03,z:-.22,scale:.93,jacket:opts.jacket,pants:opts.pants,hairStyle:opts.hairStyle,pose:'bicycle'},far)
    if(doubleBike){
      // Rear carrier passenger gripping driver's waist cleanly clear of rear wheel and front handlebars
      addRoundedStandinRider(k,{x:0,y:-.04,z:-.50,scale:.88,jacket:0x728795,pants:0x2b2f36,hairStyle:'short',pose:'rear_passenger'},far)
    }
    return k.build()
  }
  appendEbikeMesh(k,far,opts.violation==='ebike_overload'?undefined:opts.box)
  if(opts.violation==='ebike_overload'){
    addRoundedStandinRider(k,{x:0,y:.27,z:.19,scale:.66,jacket:0xe9c46a,pants:0x2d3340,pose:'child_front'},far)
    addRoundedStandinRider(k,{x:0,y:.02,z:-.16,scale:.94,jacket:opts.jacket,pants:opts.pants,hairStyle:opts.hairStyle,pose:'ebike'},far)
    addRoundedStandinRider(k,{x:0,y:.02,z:-.52,scale:.90,jacket:0x8fb4c4,pants:0x262b33,hairStyle:'pony',pose:'rear_passenger'},far)
  }else{
    addRoundedStandinRider(k,{
      x:0,y:0,z:-.23,scale:.94,jacket:opts.jacket,pants:opts.pants,
      helmet:opts.violation==='no_helmet'?undefined:opts.helmet,hairStyle:opts.hairStyle,pose:'ebike',
    },far)
  }
  return k.build()
}

function twoWheelBare(subtype:TwoWheelSubtype,far:boolean,box?:number,rearRack=false){
  const k=new Kit()
  if(subtype==='bicycle')appendBicycleMesh(k,far,rearRack)
  else appendEbikeMesh(k,far,box)
  return k.build()
}

// Far pedestrians (one-draw stand-ins behind the rigged near crowd): age and gender read from the
// silhouette — height, stoop, skirt or trousers, grey hair for elders, backpack for students.
type PersonOpts={height?:number,stoop?:number,skirt?:number,hairColor?:number,bag?:'backpack'|'tote'|'shoulder',shoes?:number}
function person(pants:number,style:'short'|'long'|'pony'|'bun'|'bob',opts:PersonOpts={}){
  const k=new Kit(),h=opts.height??1,hc=opts.hairColor??hair,shoe=opts.shoes??0x222224
  k.capsule(.148,.12,0,.90,0,opts.skirt??pants,NONE)
  for(const s of [-1,1]){
    if(opts.skirt===undefined)k.limb(.076,.06,s*.1,.93,0,s*.1,.06,0,pants)
    else k.limb(.058,.045,s*.09,.72,0,s*.09,.06,0,skin)
    k.capsule(.052,.11,s*.1,.04,.04,shoe,NONE,Math.PI/2)
    // Bring shoulder root inward to s*0.165 (embedding inside 0.16 torso capsule) with spherical shoulder cap
    k.add(new T.SphereGeometry(.054,6,4),0xffffff,s*.165,1.38,0,PAINT)
    k.limb(.050,.038,s*.165,1.38,0,s*.25,.86,0,0xffffff,PAINT)
    k.add(new T.SphereGeometry(.04,6,4),skin,s*.25,.82,0)
  }
  if(opts.skirt!==undefined)k.add(new T.CylinderGeometry(.2,.29,.42,8),opts.skirt,0,.66,0)
  k.capsule(.16,.34,0,1.14,0,0xffffff,PAINT)
  k.add(new T.CylinderGeometry(.055,.06,.08,7),skin,0,1.46,0)
  k.add(new T.IcosahedronGeometry(.13,1),skin,0,1.58,0)
  const cap=(ext=.5)=>k.add(new T.SphereGeometry(.145,8,4,0,Math.PI*2,0,Math.PI*ext),hc,0,1.6,-.01)
  if(style==='short')cap()
  if(style==='long'){cap(.55);k.capsule(.10,.26,0,1.42,-.09,hc)}
  if(style==='pony'){cap(.55);k.capsule(.04,.16,0,1.50,-.15,hc,NONE,-.4)}
  if(style==='bun'){cap(.55);k.add(new T.IcosahedronGeometry(.07,0),hc,0,1.7,-.1)}
  if(style==='bob'){cap(.6);k.capsule(.12,.10,0,1.52,-.02,hc,NONE,0,0,Math.PI/2)}
  if(opts.bag==='backpack'){k.capsule(.12,.22,0,1.14,-.18,0x3e4a55);k.capsule(.08,.12,0,1.08,-.23,0x2d3640)}
  if(opts.bag==='tote')k.capsule(.05,.22,.32,.72,0,0xc9b99a)
  if(opts.bag==='shoulder'){k.limb(.02,.02,-.18,1.42,-.08,.24,.88,-.08,0x2b2f33);k.capsule(.06,.16,.27,.86,0,0x5a4232)}
  const g=k.build()
  if(opts.stoop){g.translate(0,-.9,0);g.rotateX(opts.stoop);g.translate(0,.9,0)}
  if(h!==1)g.scale(h,h,h)
  g.computeBoundingSphere();g.computeBoundingBox()
  return g
}

const taxi=()=>car({...sedanSpec,body:0x2f8a7c,cab:0xece6d6,mask:NONE},k=>{
  k.box(.62,.16,.26,0,1.57,-.1,0xf2d36b,LAMP);k.box(.66,.04,.3,0,1.48,-.1,0x2b2f33)
  for(const s of [-1,1])k.box(.03,.12,3.3,s*.925,.72,0,0xece6d6)            // cream waist line
})
const police=()=>car({...sedanSpec,body:0xf2f2ee,cab:0xf2f2ee,mask:NONE},k=>{
  for(const s of [-1,1]){k.box(.03,.2,3.9,s*.935,.66,0,0x1f4f9c);k.box(.03,.05,3.9,s*.935,.79,0,0xf2f2ee)}
  k.box(1.1,.06,.3,0,1.5,-.2,0x2b2f33)
  k.box(.5,.11,.26,-.27,1.58,-.2,0xe8342e,RED);k.box(.5,.11,.26,.27,1.58,-.2,0x2f62e8,BLUE)
  k.box(.6,.1,.03,0,.72,-2.4,0x1f4f9c)
})

// IDOK-253 街车精模：scripts/build-traffic-cars.mjs 烘焙的四款车身（去尾翼、改比例、无车标），
// 按材质槽上我们自己的扁平配色；车身槽吃每车随机车漆，车灯槽夜里发光。
export type CarMesh={name:string,groups:{slot:number,positions:Float32Array}[]}
const CAR_SLOTS:[number,Mask][]=[
  [0xffffff,PAINT],[0xf1f0ec,NONE],[glass,NONE],[0xc9d3d8,NONE],[head,LAMP],[tail,LAMP],
  [grille,NONE],[tire,NONE],[rim,NONE],[trim,NONE],[chrome,NONE],
]
export async function loadCarMeshes(url='/models/traffic-cars.bin'):Promise<CarMesh[]>{
  const response=await fetch(url);if(!response.ok)throw Error(`traffic cars: ${response.status}`)
  const view=new DataView(await response.arrayBuffer())
  if(String.fromCharCode(...[0,1,2,3].map(i=>view.getUint8(i)))!=='GLCR')throw Error('traffic cars: bad header')
  let at=8;const cars:CarMesh[]=[]
  for(let c=0,count=view.getUint16(6,true);c<count;c++){
    const length=view.getUint8(at++);const name=new TextDecoder().decode(new Uint8Array(view.buffer,at,length));at+=length
    const groups:CarMesh['groups']=[]
    const groupCount=view.getUint16(at,true);at+=2
    for(let g=0;g<groupCount;g++){
      const slot=view.getUint8(at),vertices=view.getUint32(at+1,true);at+=5
      const positions=new Float32Array(vertices*3);for(let i=0;i<positions.length;i++,at+=2)positions[i]=view.getInt16(at,true)/1000
      groups.push({slot,positions})
    }
    cars.push({name,groups})
  }
  return cars
}
function bakedCar(mesh:CarMesh,body?:number,extra?:(k:Kit)=>void){
  const k=new Kit()
  for(const {slot,positions} of mesh.groups){
    const [color,mask]=CAR_SLOTS[slot]??[trim,NONE],g=new T.BufferGeometry()
    g.setAttribute('position',new T.BufferAttribute(positions.slice(),3));g.computeVertexNormals()
    k.add(g,slot===0&&body!==undefined?body:color,0,0,0,slot===0&&body!==undefined?NONE:mask)
  }
  extra?.(k)
  return k.build()
}

export type Variant = {geometry:number,paint:T.Color}
export type TwoWheelVariantPair = {full:Variant,bare:Variant}
type Pool = {ids:number[],weights:number[],paints:{hex:number,w:number}[]}
const pick=<V extends {w:number}>(list:V[],u:number)=>{let total=0;for(const v of list)total+=v.w;u*=total;for(const v of list){if((u-=v.w)<0)return v}return list[list.length-1]}

// Chinese city fleet colours: mostly white / black / silver / grey, a few blues and reds.
const carPaints=[[0xf1f0ec,30],[0x17191c,14],[0xb9bec2,13],[0x6c7276,11],[0x2c4a6e,7],[0x9b2a26,5],[0xc9b99a,5],[0x7a5a45,3],[0x4d6b5a,3],[0xa9c7d4,3],[0xe7dcc2,3],[0x3d4b8a,3]].map(([hex,w])=>({hex,w}))
// Same muted present-day palette as the starter looks (lib/avatar.ts lookPalette tops).
const shirtPaints=[0xe9e7e1,0xeeeae0,0x728795,0xa5bfce,0xacb8a7,0x9b9d99,0x3f5a4c,0x6f8fae,0x9a3f35,0xd8cab0,0x28344a,0x2b2f36].map(hex=>({hex,w:1}))
const ebikePaints=[[0xf3f1e9,28],[0x99c9de,18],[0xe4afbb,12],[0x383c40,20],[0x5e7680,14],[0x209c8e,8]].map(([hex,w])=>({hex,w}))
const bicyclePaints=[0x5b8a72,0xc96f53,0xd8cfc0,0x5c6e7e].map(hex=>({hex,w:1}))

export function trafficModels(cars:CarMesh[]=[]){
  const geometries:T.BufferGeometry[]=[]
  const add=(g:T.BufferGeometry)=>geometries.push(g)-1
  const small=(g:T.BufferGeometry)=>{g.scale(CAR_SCALE,CAR_SCALE,CAR_SCALE);g.computeBoundingSphere();g.computeBoundingBox();return add(g)}
  const sedan=small(car(sedanSpec)),hatch=small(car(hatchSpec)),suv=small(car(suvSpec)),van=small(car(vanSpec)),
    lorry=small(truck()),patrol=small(police())
  // 行驶车用精模（同屏只有几辆），停放车用 @far 轻量版（一屏可能上百辆）
  const taxiSign=(k:Kit)=>{k.box(.6,.15,.26,0,1.52,-.25,0xf2d36b,LAMP);k.box(.64,.04,.3,0,1.44,-.25,0x2b2f33)}
  const bake=(name:string,fallback:number,body?:number,extra?:(k:Kit)=>void)=>{const mesh=cars.find(item=>item.name===name);return mesh?small(bakedCar(mesh,body,extra)):fallback}
  const cabFallback=small(taxi())
  const saloon=bake('saloon',sedan),mini=bake('mini',hatch),coupe=bake('coupe',sedan),sport=bake('sport',sedan),
    cab=bake('saloon',cabFallback,0x2f8a7c,taxiSign)            // 出租车：同款车身，桂林出租车青绿色 + 顶灯
  // 远处（>75 m）换轻量替身；近处用精模。far[geometry] = 替身 id
  const liteSedan=small(liteCar(sedanSpec)),liteHatch=small(liteCar(hatchSpec)),
    liteCab=small(liteCar(sedanSpec,0x2f8a7c,NONE,k=>k.box(.6,.15,.26,0,1.57,-.1,0xf2d36b,LAMP)))
  const far:Record<number,number>={[saloon]:liteSedan,[mini]:liteHatch,[coupe]:liteSedan,[sport]:liteSedan,[cab]:liteCab}

  // E-bike & shared bicycle bare meshes (for near rigged rider-pool) + stand-in rider meshes + >75 m LODs
  const ebikeBare=add(twoWheelBare('ebike',false)),ebikeFarBare=add(twoWheelBare('ebike',true))
  const ebikeDeliveryBare=add(twoWheelBare('ebike',false,0x29343b)),ebikeDeliveryFarBare=add(twoWheelBare('ebike',true,0x29343b))
  const bicycleBare=add(twoWheelBare('bicycle',false)),bicycleFarBare=add(twoWheelBare('bicycle',true))
  const bicycleDoubleBare=add(twoWheelBare('bicycle',false,undefined,true)),bicycleDoubleFarBare=add(twoWheelBare('bicycle',true,undefined,true))

  const ebikeHelmA=add(scooter({subtype:'ebike',violation:'none',jacket:0x465460,pants:0x2d3340,helmet:0xf0f0ea}))
  const ebikeHelmB=add(scooter({subtype:'ebike',violation:'none',jacket:0x3f5a4c,pants:0x2b2f36,helmet:0xd8423a,hairStyle:'pony'}))
  const ebikeHelmBox=add(scooter({subtype:'ebike',violation:'none',jacket:0xd98a2b,pants:0x252a30,helmet:0xe6b235,box:0x29343b}))
  const ebikeNoHelmA=add(scooter({subtype:'ebike',violation:'no_helmet',jacket:0x728795,pants:0x2a2c30,hairStyle:'short'}))
  const ebikeNoHelmB=add(scooter({subtype:'ebike',violation:'no_helmet',jacket:0x9a3f35,pants:0x28344a,hairStyle:'long'}))
  const ebikeOverload=add(scooter({subtype:'ebike',violation:'ebike_overload',jacket:0x5b6c7a,pants:0x2d3340,hairStyle:'short'}))

  const ebikeFarHelm=add(scooter({subtype:'ebike',violation:'none',jacket:0x465460,pants:0x2d3340,helmet:0xf0f0ea,far:true}))
  const ebikeFarHelmBox=add(scooter({subtype:'ebike',violation:'none',jacket:0xd98a2b,pants:0x252a30,helmet:0xe6b235,box:0x29343b,far:true}))
  const ebikeFarNoHelm=add(scooter({subtype:'ebike',violation:'no_helmet',jacket:0x728795,pants:0x2a2c30,hairStyle:'short',far:true}))
  const ebikeFarOverload=add(scooter({subtype:'ebike',violation:'ebike_overload',jacket:0x5b6c7a,pants:0x2d3340,hairStyle:'short',far:true}))

  const bikeSoloA=add(scooter({subtype:'bicycle',violation:'none',jacket:0xe9e7e1,pants:0x2d3340,hairStyle:'short'}))
  const bikeSoloB=add(scooter({subtype:'bicycle',violation:'none',jacket:0x6f8fae,pants:0x2a2c30,hairStyle:'pony'}))
  const bikeDouble=add(scooter({subtype:'bicycle',violation:'bike_double',jacket:0xa5bfce,pants:0x2d3340,hairStyle:'short'}))

  const bikeFarSolo=add(scooter({subtype:'bicycle',violation:'none',jacket:0xe9e7e1,pants:0x2d3340,hairStyle:'short',far:true}))
  const bikeFarDouble=add(scooter({subtype:'bicycle',violation:'bike_double',jacket:0xa5bfce,pants:0x2d3340,hairStyle:'short',far:true}))

  Object.assign(far,{
    [ebikeBare]:ebikeFarBare,[ebikeDeliveryBare]:ebikeDeliveryFarBare,[bicycleBare]:bicycleFarBare,[bicycleDoubleBare]:bicycleDoubleFarBare,
    [ebikeHelmA]:ebikeFarHelm,[ebikeHelmB]:ebikeFarHelm,[ebikeHelmBox]:ebikeFarHelmBox,
    [ebikeNoHelmA]:ebikeFarNoHelm,[ebikeNoHelmB]:ebikeFarNoHelm,[ebikeOverload]:ebikeFarOverload,
    [bikeSoloA]:bikeFarSolo,[bikeSoloB]:bikeFarSolo,[bikeDouble]:bikeFarDouble,
  })

  const grey=0xb8b5ae,white=0xdcd9d2
  const scooters=[ebikeHelmA,ebikeHelmB,ebikeHelmBox]
  const people=[
    add(person(0x22262e,'short')),                                          // 青年男
    add(person(0x6b5a48,'long',{bag:'shoulder'})),                          // 青年女
    add(person(0x3a4250,'pony',{skirt:0x2b3240})),                          // 青年女，裙装
    add(person(0x2b2d33,'short',{height:.88,bag:'backpack',shoes:0xe9e7e1})), // 学生
    add(person(0x2b3a5a,'pony',{height:.86,bag:'backpack',shoes:0xe9e7e1})),  // 女学生
    add(person(0x8f8a80,'short',{bag:'tote'})),                             // 中年男
    add(person(0x4a4038,'bob',{bag:'tote'})),                               // 中年女
    add(person(0x5a5650,'short',{height:.95,stoop:.12,hairColor:white})),   // 老年男
    add(person(0x3d3a44,'bun',{height:.93,stoop:.1,hairColor:grey,bag:'tote'})), // 老年女
  ]
  const pools:Record<'car'|'scooter'|'person'|'parked',Pool>={
    parked:{ids:[saloon,mini,coupe,sport,suv,cab],weights:[30,16,8,8,26,10],paints:carPaints},
    car:{ids:[saloon,mini,coupe,sport,suv,van,lorry,cab],weights:[26,14,8,8,18,8,5,10],paints:carPaints},
    scooter:{ids:scooters,weights:[3,3,2],paints:ebikePaints},
    person:{ids:people,weights:[4,3,2,2,2,3,3,2,2],paints:shirtPaints},
  }
  const plain=new T.Color(1,1,1)
  const variant=(kind:keyof typeof pools,u:number,v:number):Variant=>{
    const pool=pools[kind],geometry=pick(pool.ids.map((id,i)=>({id,w:pool.weights[i]})),u).id
    return {geometry,paint:geometry===cab||geometry===patrol?plain:new T.Color(pick(pool.paints,v).hex)}
  }
  const twoWheelVariant=(subtype:TwoWheelSubtype,violation:TrafficViolation,u:number,v:number):TwoWheelVariantPair=>{
    if(subtype==='bicycle'){
      const paint=new T.Color(pick(bicyclePaints,v).hex)
      const dbl=violation==='bike_double'
      const fullGeom=dbl?bikeDouble:(u<.5?bikeSoloA:bikeSoloB)
      return {full:{geometry:fullGeom,paint},bare:{geometry:dbl?bicycleDoubleBare:bicycleBare,paint}}
    }
    const paint=new T.Color(pick(ebikePaints,v).hex)
    if(violation==='ebike_overload')return {full:{geometry:ebikeOverload,paint},bare:{geometry:ebikeBare,paint}}
    if(violation==='no_helmet')return {full:{geometry:u<.5?ebikeNoHelmA:ebikeNoHelmB,paint},bare:{geometry:ebikeBare,paint}}
    const hasBox=u>.7
    return {full:{geometry:hasBox?ebikeHelmBox:(u<.35?ebikeHelmA:ebikeHelmB),paint},bare:{geometry:hasBox?ebikeDeliveryBare:ebikeBare,paint}}
  }
  return {geometries,variant,twoWheelVariant,police:patrol,far}
}

export function trafficMaterial(){
  const material=new T.MeshStandardMaterial({vertexColors:true,flatShading:true,roughness:.62,metalness:.08})
  material.onBeforeCompile=shader=>{
    shareAtmosphere(shader)
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
attribute vec3 aMask; varying vec2 vLamp;`).replace('#include <color_vertex>',`vColor = vec3(1.0);
#ifdef USE_COLOR
vColor *= color;
#endif
#ifdef USE_BATCHING_COLOR
vColor = mix(vColor, vColor * getBatchingColor( getIndirectIndex( gl_DrawID ) ).rgb, aMask.x);
#endif
vLamp = aMask.yz;`)
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
uniform float uNight; uniform float uTime; varying vec2 vLamp;`).replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
{ float beat = sin(uTime * 13.);
  totalEmissiveRadiance += vColor * (vLamp.x * (.18 + uNight * 1.6) + max(0., vLamp.y * beat) * 2.4); }`)
  }
  material.customProgramCacheKey=()=>'guilinol-traffic-models'
  return material
}
