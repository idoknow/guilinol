import * as T from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {shareAtmosphere} from '../look/atmosphere'
import {CAR_SCALE} from '../drive/scale'

// IDOK-149 交通车模: low-poly, flat-shaded street traffic in one BatchedMesh draw.
// Every model faces +z (actor yaw = atan2(dx,dz)), stands on y = 0 and carries two vertex
// attributes: `color` (base colour; white where the body takes the per-instance paint) and
// `aMask` = (paint, lamp, flash). Lamps glow a little by day and properly at night (uNight);
// flash = +1 red / -1 blue police lightbar, alternating on uTime.

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

// IDOK-253 电动车：踏板式车身（侧面轮廓挤出，带弧形护腿板）、前大灯 + LED 条、后视镜、后扶手 / 货架，
// 车轮带轮毂；可选前车筐、后外卖箱。骑手戴半盔，女骑手盔下露马尾。
type ScooterOpts={box?:number,basket?:boolean,ponytail?:boolean,pants?:number}
function scooter(bodyColor:number,helmet:number,opts:ScooterOpts={}){
  const k=new Kit(),pants=opts.pants??0x2d3340
  for(const z of [-.58,.6]){
    k.add(new T.CylinderGeometry(.24,.24,.1,12).rotateZ(Math.PI/2),tire,0,.24,z)
    for(const s of [-1,1]){k.add(new T.CylinderGeometry(.14,.14,.012,10).rotateZ(Math.PI/2),rim,s*.056,.24,z);k.add(new T.CylinderGeometry(.05,.05,.02,6).rotateZ(Math.PI/2),barrel,s*.064,.24,z)}
  }
  k.side([[-.78,.42],[-.8,.6],[-.66,.8],[-.1,.8],[.02,.56],[.02,.34],[-.4,.3]],.36,0,bodyColor,NONE,.04)   // rear body
  k.side([[.02,.3],[.02,.4],[.38,.4],[.38,.3]],.32,0,0x34383c)                                            // floorboard
  k.side([[.34,.32],[.62,.36],[.74,.62],[.74,.96],[.62,1.06],[.5,1.02],[.46,.62],[.36,.44]],.42,0,bodyColor,NONE,.05) // leg shield / apron
  k.box(.04,.34,.12,0,.42,.62,0x3b3f42,NONE,-.35)                                                         // fork
  k.box(.3,.06,.22,0,.3,.62,bodyColor);k.box(.26,.05,.2,0,.31,-.62,bodyColor)                             // mudguards
  k.box(.4,.1,.56,0,.84,-.34,0x2e2a28);k.box(.42,.02,.58,0,.8,-.34,0x555049)                              // seat + piping
  k.box(.04,.05,.36,-.2,.86,-.66,chrome);k.box(.04,.05,.36,.2,.86,-.66,chrome);k.box(.42,.05,.04,0,.86,-.84,chrome) // grab rail
  k.box(.62,.04,.05,0,1.1,.58,0x3b3f42);for(const s of [-1,1])k.box(.1,.05,.06,s*.3,1.1,.58,0x1c1d1f)   // handlebar + grips
  for(const s of [-1,1]){k.box(.02,.2,.02,s*.22,1.2,.56,0x3b3f42,NONE,0,0,s*.25);k.box(.1,.06,.03,s*.26,1.31,.56,0x1c1d1f)} // mirrors
  k.box(.22,.11,.06,0,.98,.72,housing);k.box(.16,.07,.06,0,.98,.745,head,LAMP);k.box(.3,.02,.05,0,.9,.74,0xffffff,LAMP) // headlamp + LED strip
  k.box(.16,.07,.05,0,.66,-.79,tail,LAMP);for(const s of [-1,1])k.box(.05,.04,.04,s*.17,.7,-.78,amber,LAMP)
  if(opts.basket){k.box(.34,.02,.26,0,1.0,.86,0x3b3f42);for(const [x,z,w,d] of [[0,.99,.34,.02],[0,.73,.34,.02],[-.17,.86,.02,.26],[.17,.86,.02,.26]] as const)k.box(w,.2,d,x,1.1,z,0x4a4f54)}
  if(opts.box!==undefined){k.box(.44,.4,.42,0,1.08,-.64,opts.box);k.box(.45,.05,.43,0,1.3,-.64,0x23272b);k.box(.3,.08,.01,0,1.12,-.86,0xf4efe2)}
  // Rider: seated, hands on the grips, half helmet.
  for(const s of [-1,1]){
    k.box(.15,.14,.48,s*.12,.94,-.12,pants)                         // thighs
    k.box(.13,.42,.14,s*.15,.68,.18,pants,NONE,.28)                 // shins
    k.box(.13,.08,.24,s*.15,.45,.27,0x1c1c1e)                       // shoes on the floorboard
    k.box(.1,.1,.46,s*.22,1.32,.14,0xffffff,PAINT,.38)              // sleeves
    k.box(.08,.08,.1,s*.3,1.12,.52,skin)                            // hands
  }
  k.box(.42,.56,.26,0,1.32,-.22,0xffffff,PAINT,-.12)                 // jacket, leaning in
  k.box(.44,.08,.27,0,1.06,-.24,0xffffff,PAINT,-.12)                 // jacket hem
  k.box(.1,.08,.1,0,1.64,-.16,skin)                                  // neck
  k.add(new T.IcosahedronGeometry(.13,1),skin,0,1.76,-.12)
  k.add(new T.SphereGeometry(.165,10,5,0,Math.PI*2,0,Math.PI*.52),helmet,0,1.78,-.14)
  k.box(.3,.03,.12,0,1.79,.02,helmet)                                // brim
  if(opts.ponytail){k.box(.09,.22,.09,0,1.66,-.34,hair,NONE,-.3)}
  return k.build()
}

// Far pedestrians (one-draw stand-ins behind the rigged near crowd): age and gender read from the
// silhouette — height, stoop, skirt or trousers, grey hair for elders, backpack for students.
type PersonOpts={height?:number,stoop?:number,skirt?:number,hairColor?:number,bag?:'backpack'|'tote'|'shoulder',shoes?:number}
function person(pants:number,style:'short'|'long'|'pony'|'bun'|'bob',opts:PersonOpts={}){
  const k=new Kit(),h=opts.height??1,hc=opts.hairColor??hair,shoe=opts.shoes??0x222224
  for(const s of [-1,1]){
    if(opts.skirt===undefined)k.box(.15,.8,.17,s*.1,.4,0,pants)
    else k.box(.11,.5,.12,s*.09,.25,0,skin)
    k.box(.15,.08,.26,s*.1,.04,.04,shoe)
    k.box(.1,.56,.12,s*.27,1.11,0,0xffffff,PAINT,0,0,s*.08)
    k.box(.08,.1,.09,s*.29,.8,0,skin)
  }
  if(opts.skirt!==undefined)k.add(new T.CylinderGeometry(.2,.29,.42,8),opts.skirt,0,.66,0)
  k.box(.44,.62,.25,0,1.12,0,0xffffff,PAINT)
  k.box(.12,.08,.12,0,1.46,0,skin)
  k.add(new T.IcosahedronGeometry(.13,1),skin,0,1.58,0)
  const cap=(ext=.5)=>k.add(new T.SphereGeometry(.145,8,4,0,Math.PI*2,0,Math.PI*ext),hc,0,1.6,-.01)
  if(style==='short')cap()
  if(style==='long'){cap(.55);k.box(.3,.34,.1,0,1.45,-.1,hc)}
  if(style==='pony'){cap(.55);k.box(.08,.2,.08,0,1.52,-.15,hc)}
  if(style==='bun'){cap(.55);k.add(new T.IcosahedronGeometry(.07,0),hc,0,1.7,-.1)}
  if(style==='bob'){cap(.6);k.box(.32,.16,.26,0,1.52,-.02,hc)}
  if(opts.bag==='backpack')k.box(.34,.42,.16,0,1.14,-.2,0x3e4a55)
  if(opts.bag==='tote')k.box(.06,.3,.26,.33,.72,0,0xc9b99a)
  if(opts.bag==='shoulder'){k.box(.06,.6,.03,0,1.15,-.12,0x2b2f33,NONE,0,0,.6);k.box(.08,.2,.24,.27,.86,0,0x5a4232)}
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

export type Variant = {geometry:number,paint:T.Color}
type Pool = {ids:number[],weights:number[],paints:{hex:number,w:number}[]}
const pick=<V extends {w:number}>(list:V[],u:number)=>{let total=0;for(const v of list)total+=v.w;u*=total;for(const v of list){if((u-=v.w)<0)return v}return list[list.length-1]}

// Chinese city fleet colours: mostly white / black / silver / grey, a few blues and reds.
const carPaints=[[0xf1f0ec,30],[0x17191c,14],[0xb9bec2,13],[0x6c7276,11],[0x2c4a6e,7],[0x9b2a26,5],[0xc9b99a,5],[0x7a5a45,3],[0x4d6b5a,3],[0xa9c7d4,3],[0xe7dcc2,3],[0x3d4b8a,3]].map(([hex,w])=>({hex,w}))
// Same muted present-day palette as the starter looks (lib/avatar.ts lookPalette tops).
const shirtPaints=[0xe9e7e1,0xeeeae0,0x728795,0xa5bfce,0xacb8a7,0x9b9d99,0x3f5a4c,0x6f8fae,0x9a3f35,0xd8cab0,0x28344a,0x2b2f36].map(hex=>({hex,w:1}))

export function trafficModels(){
  const geometries:T.BufferGeometry[]=[]
  const add=(g:T.BufferGeometry)=>geometries.push(g)-1
  const small=(g:T.BufferGeometry)=>{g.scale(CAR_SCALE,CAR_SCALE,CAR_SCALE);g.computeBoundingSphere();g.computeBoundingBox();return add(g)}
  const sedan=small(car(sedanSpec)),hatch=small(car(hatchSpec)),suv=small(car(suvSpec)),van=small(car(vanSpec)),
    lorry=small(truck()),cab=small(taxi()),patrol=small(police())
  const grey=0xb8b5ae,white=0xdcd9d2
  const scooters=[add(scooter(0xeeece6,0xf0f0ea,{basket:true})),add(scooter(0x8fb4c4,0xd8423a,{ponytail:true})),add(scooter(0x2d3135,0x3e74c4)),
    add(scooter(0x3a3e42,0xe6b23a,{box:0xe6b23a})),add(scooter(0x3a3e42,0x2f7fd0,{box:0x2f7fd0})),add(scooter(0xd9c9a8,0xf2f2ee,{basket:true,ponytail:true,pants:0x5b4a3c}))]
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
    parked:{ids:[sedan,hatch,suv,cab],weights:[42,19,29,10],paints:carPaints},
    car:{ids:[sedan,hatch,suv,van,lorry,cab],weights:[34,17,24,8,5,10],paints:carPaints},
    scooter:{ids:scooters,weights:[3,3,2,2,2,2],paints:shirtPaints},
    person:{ids:people,weights:[4,3,2,2,2,3,3,2,2],paints:shirtPaints},
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
