import * as T from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {shareAtmosphere} from '../look/atmosphere'

// IDOK-149 交通车模: low-poly, flat-shaded street traffic in one BatchedMesh draw.
// Every model faces +z (actor yaw = atan2(dx,dz)), stands on y = 0 and carries two vertex
// attributes: `color` (base colour; white where the body takes the per-instance paint) and
// `aMask` = (paint, lamp, flash). Lamps glow a little by day and properly at night (uNight);
// flash = +1 red / -1 blue police lightbar, alternating on uTime.

type Mask = readonly [number,number,number]
const NONE:Mask=[0,0,0],PAINT:Mask=[1,0,0],LAMP:Mask=[0,1,0],RED:Mask=[0,.4,1],BLUE:Mask=[0,.4,-1]
type Pt = [number,number]

const tire=0x1d1f22,rim=0xb4bbc1,glass=0x1f2c34,trim=0x25282b,grille=0x16181a,head=0xf3efdf,tail=0xc22d27,
  amber=0xe39a35,plateBlue=0x2a579e,plateGreen=0x7cc48c,plateYellow=0xe2b23a,skin=0xd9a986,hair=0x1d1a19

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
  pane(a:Pt,b:Pt,width:number,trimEnds:number,color:number,front:boolean,out=.05,mask:Mask=NONE,thick=.025){
    const dz=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dz,dy)
    let ny=-dz/len,nz=dy/len
    if(ny*.3+nz*(front?1:-1)<0){ny=-ny;nz=-nz}
    // Box long (y) axis rotated onto the edge direction (dy,dz).
    const g=new T.BoxGeometry(width,len-2*trimEnds,thick).rotateX(Math.atan2(dz,dy))
    return this.add(g,color,0,(a[1]+b[1])/2+ny*out,(a[0]+b[0])/2+nz*out,mask)
  }
  wheel(r:number,w:number,x:number,z:number,hub=rim){
    this.add(new T.CylinderGeometry(r,r,w,12).rotateZ(Math.PI/2),tire,x,r,z)
    this.add(new T.CylinderGeometry(r*.58,r*.58,w+.02,8).rotateZ(Math.PI/2),hub,x,r,z)
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

function car(spec:CarSpec,extra?:(kit:Kit,spec:CarSpec)=>void){
  const k=new Kit(),{W,r,lower,cabin}=spec
  const body=spec.body??0xffffff,cab=spec.cab??body,mask=spec.mask??PAINT,cabMask=spec.cab!==undefined?NONE:mask
  const front=Math.max(...lower.map(p=>p[0])),rear=Math.min(...lower.map(p=>p[0]))
  const cw=W-.2,[rb,rt,ft,fb]=cabin,belt=Math.min(rb[1],fb[1]),roof=Math.max(rt[1],ft[1])
  k.side(lower,W,0,body,mask,.06)
  k.side(cabin,cw,0,cab,cabMask,.04)
  // Glasshouse: windscreen, rear screen, side glass with door pillars.
  k.pane(fb,ft,cw*.9,.05,glass,true,.045)
  k.pane(rb,rt,cw*.9,.05,glass,false,.045)
  const gy0=belt+.07,gy1=roof-.08
  const gz=(y:number,front:boolean)=>front?lerpZ(fb,ft,y)-.08:lerpZ(rb,rt,y)+.08
  const glassPts:Pt[]=[[gz(gy0,false),gy0],[gz(gy1,false),gy1],[gz(gy1,true),gy1],[gz(gy0,true),gy0]]
  for(const s of [-1,1]){
    k.side(glassPts,.02,s*(cw/2+.045),glass)
    for(const p of spec.pillars??[(gz(gy0,true)+gz(gy0,false))/2-.1])k.box(.03,gy1-gy0+.02,.09,s*(cw/2+.06),(gy0+gy1)/2,p,cab,cabMask)
    // Mirrors at the A-pillar foot, door handles, dark rocker strip.
    k.box(.16,.09,.12,s*(W/2+.07),belt+.06,fb[0]-.12,body,mask)
    k.box(.04,.03,1.6,s*(W/2+.012),.36,(spec.wf+spec.wr)/2,trim)
    for(const z of spec.pillars??[(gz(gy0,true)+gz(gy0,false))/2])k.box(.02,.03,.14,s*(W/2+.07),belt-.1,z+.32,trim)
    if(spec.cladding)for(const z of [spec.wf,spec.wr])k.box(.04,.1,2*r+.18,s*(W/2+.025),2*r+.02,z,trim)
    if(spec.rails)k.box(.05,.05,(ft[0]-rt[0])*.92,s*(cw/2-.12),roof+.07,(ft[0]+rt[0])/2,0x2c2f32)
  }
  // Nose: grille, headlamps, bumper, plate. Tail: lamps, bumper, plate.
  const lw=spec.lampW??.34
  k.box(W*.42,.14,.06,0,spec.headY-.1,front+.02,grille)
  for(const s of [-1,1]){
    k.box(lw,.1,.08,s*(W/2-lw/2-.06),spec.headY,front-.01,head,LAMP)
    k.box(.12,.05,.06,s*(W/2-.08),spec.headY-.1,front-.01,amber,LAMP)
    k.box(lw,.12,.08,s*(W/2-lw/2-.05),spec.tailY,rear+.01,tail,LAMP)
  }
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

function scooter(bodyColor:number,helmet:number,box?:number){
  const k=new Kit()
  for(const z of [-.58,.6]){k.add(new T.CylinderGeometry(.24,.24,.11,10).rotateZ(Math.PI/2),tire,0,.24,z);k.add(new T.CylinderGeometry(.12,.12,.13,8).rotateZ(Math.PI/2),rim,0,.24,z)}
  k.box(.36,.22,1.05,0,.36,0,bodyColor)                    // floor + battery
  k.box(.34,.36,.42,0,.58,-.34,bodyColor)                  // rear body under the seat
  k.box(.38,.1,.5,0,.8,-.32,0x2e2a28)                      // seat
  k.box(.3,.62,.16,0,.72,.48,bodyColor,NONE,-.25)          // leg shield / steering column
  k.box(.62,.05,.06,0,1.08,.56,0x3b3f42)                   // handlebar
  k.box(.18,.1,.06,0,.98,.66,head,LAMP);k.box(.16,.07,.05,0,.64,-.57,tail,LAMP)
  k.box(.08,.16,.18,0,.26,.6,bodyColor)                    // front mudguard
  if(box!==undefined){k.box(.44,.4,.42,0,1.06,-.62,box);k.box(.45,.05,.43,0,1.28,-.62,0x23272b)}
  // Rider: seated, hands on the bar, helmet on (mandatory in Guilin, and it reads well from afar).
  for(const s of [-1,1]){
    k.box(.15,.14,.48,s*.12,.92,-.1,0x2d3340)                       // thighs
    k.box(.13,.42,.14,s*.15,.68,.2,0x2d3340,NONE,.28)               // shins
    k.box(.13,.08,.22,s*.15,.48,.28,0x1c1c1e)                       // shoes
    k.box(.1,.1,.5,s*.22,1.3,.16,0xffffff,PAINT,.35)                // arms
    k.box(.08,.08,.08,s*.29,1.1,.48,skin)
  }
  k.box(.42,.56,.26,0,1.3,-.2,0xffffff,PAINT,-.12)                   // torso, leaning in
  k.add(new T.IcosahedronGeometry(.13,0),skin,0,1.7,-.12)
  k.add(new T.SphereGeometry(.16,8,5,0,Math.PI*2,0,Math.PI*.55),helmet,0,1.71,-.14)
  k.box(.26,.05,.06,0,1.66,.02,0x2b3136)                             // visor
  return k.build()
}

function person(pants:number,style:'short'|'long'|'hat'|'bag'){
  const k=new Kit()
  for(const s of [-1,1]){
    k.box(.15,.8,.17,s*.1,.4,0,pants)
    k.box(.15,.08,.26,s*.1,.04,.04,0x222224)
    k.box(.1,.56,.12,s*.27,1.11,0,0xffffff,PAINT,0,0,s*.08)
    k.box(.08,.1,.09,s*.29,.8,0,skin)
  }
  k.box(.44,.62,.25,0,1.12,0,0xffffff,PAINT)
  k.box(.12,.08,.12,0,1.46,0,skin)
  k.add(new T.IcosahedronGeometry(.13,0),skin,0,1.58,0)
  if(style==='short')k.add(new T.SphereGeometry(.14,8,4,0,Math.PI*2,0,Math.PI*.5),hair,0,1.6,-.01)
  if(style==='long'){k.add(new T.SphereGeometry(.145,8,4,0,Math.PI*2,0,Math.PI*.55),hair,0,1.6,-.01);k.box(.3,.34,.1,0,1.45,-.1,hair)}
  if(style==='bag'){k.add(new T.SphereGeometry(.14,8,4,0,Math.PI*2,0,Math.PI*.5),0x5a4232,0,1.6,-.01);k.box(.34,.4,.16,0,1.16,-.2,0x3e4a55)}
  if(style==='hat'){k.add(new T.SphereGeometry(.14,8,4,0,Math.PI*2,0,Math.PI*.5),hair,0,1.6,-.01);k.add(new T.ConeGeometry(.36,.2,10),0xc9a764,0,1.76,0)} // 斗笠
  return k.build()
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

export type Variant = {geometry:number,paint:T.Color}
type Pool = {ids:number[],weights:number[],paints:{hex:number,w:number}[]}
const pick=<V extends {w:number}>(list:V[],u:number)=>{let total=0;for(const v of list)total+=v.w;u*=total;for(const v of list){if((u-=v.w)<0)return v}return list[list.length-1]}

// Chinese city fleet colours: mostly white / black / silver / grey, a few blues and reds.
const carPaints=[[0xf1f0ec,30],[0x17191c,14],[0xb9bec2,13],[0x6c7276,11],[0x2c4a6e,7],[0x9b2a26,5],[0xc9b99a,5],[0x7a5a45,3],[0x4d6b5a,3],[0xa9c7d4,3],[0xe7dcc2,3],[0x3d4b8a,3]].map(([hex,w])=>({hex,w}))
const shirtPaints=[0xe9e5dc,0x2b2f36,0x4e6c8f,0xb8463b,0x6d8f5d,0xd9b44a,0x8a6fa6,0xd8d8d8,0x2f6e74,0xc77a8b].map(hex=>({hex,w:1}))

export function trafficModels(){
  const geometries:T.BufferGeometry[]=[]
  const add=(g:T.BufferGeometry)=>geometries.push(g)-1
  const sedan=add(car(sedanSpec)),hatch=add(car(hatchSpec)),suv=add(car(suvSpec)),van=add(car(vanSpec)),
    lorry=add(truck()),cab=add(taxi()),patrol=add(police())
  const scooters=[add(scooter(0xeeece6,0xf0f0ea)),add(scooter(0x8fb4c4,0xd8423a)),add(scooter(0x2d3135,0x3e74c4)),
    add(scooter(0x3a3e42,0xe6b23a,0xe6b23a)),add(scooter(0x3a3e42,0x2f7fd0,0x2f7fd0))]
  const people=[add(person(0x22262e,'short')),add(person(0x6b5a48,'long')),add(person(0x3a4250,'hat')),add(person(0x2b2d33,'bag')),add(person(0x8f8a80,'short'))]
  const pools:Record<'car'|'scooter'|'person'|'parked',Pool>={
    parked:{ids:[sedan,hatch,suv,cab],weights:[42,19,29,10],paints:carPaints},
    car:{ids:[sedan,hatch,suv,van,lorry,cab],weights:[34,17,24,8,5,10],paints:carPaints},
    scooter:{ids:scooters,weights:[3,3,2,2,2],paints:shirtPaints},
    person:{ids:people,weights:[3,3,1,2,2],paints:shirtPaints},
  }
  const plain=new T.Color(1,1,1)
  const variant=(kind:keyof typeof pools,u:number,v:number):Variant=>{
    const pool=pools[kind],geometry=pick(pool.ids.map((id,i)=>({id,w:pool.weights[i]})),u).id
    return {geometry,paint:geometry===cab||geometry===patrol?plain:new T.Color(pick(pool.paints,v).hex)}
  }
  return {geometries,variant,police:patrol}
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
