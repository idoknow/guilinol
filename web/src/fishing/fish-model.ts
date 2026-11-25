import * as THREE from 'three'

// 27 种鱼的程序化模型（IDOK-336）。不下载外部素材：每种鱼按物种照片的轮廓、斑纹、鳍形写成一组参数，
// 运行时生成。身体 64×40 段（约 5k 三角形），加上鳍、眼、须，检视模型约 6–7k 面；
// 同一套参数也用来出图鉴缩略图。颜色写进顶点色，材质只有身体 / 鳍 / 眼三种。

type Pattern = 'none'|'bars'|'stripes'|'spots'|'reticulate'|'mottled'|'scales'|'saddles'
type Tail = 'fork'|'deep'|'square'|'round'|'lunate'|'shark'|'spade'
type Fin = {from:number,to:number,h:number,shape?:'tri'|'long'|'sail'|'finlets'|'rear'}
export type FishLook = {
  len:number, h:number, w:number, peak?:number, head?:number, ped?:number,
  back:number, belly:number, fin:number, tailFin?:number, pc?:number,
  pattern:Pattern, n?:number, shine?:number,
  dorsal:Fin, dorsal2?:Fin, anal?:Fin, tail:Tail, tailSize?:number, pect?:number, pectWide?:boolean,
  barbels?:number, snout?:'long'|'shark'|'pike'|'up'|'blunt', eye?:number,
}

// len 为参考体长（米），检视时显示比例尺；h = 最大体高 / 体长，w = 体宽 / 体高。
export const looks: Record<string,FishLook> = {
  '001':{len:.32,h:.38,w:.42,back:0x58644f,belly:0xd9d6c2,fin:0x6d6a58,pc:0x3e4636,pattern:'bars',n:8,dorsal:{from:.24,to:.86,h:.15,shape:'long'},anal:{from:.66,to:.86,h:.11},tail:'square',pect:.12},
  '002':{len:.16,h:.21,w:.5,back:0x7d8a8c,belly:0xf1f1ec,fin:0xc9cbc2,pattern:'none',shine:.7,dorsal:{from:.42,to:.55,h:.11},anal:{from:.62,to:.82,h:.07},tail:'deep',snout:'up'},
  '003':{len:.07,h:.3,w:.45,back:0xa48d4c,belly:0xf0e4b8,fin:0xd9a54a,pc:0x23231d,pattern:'bars',n:5,dorsal:{from:.38,to:.6,h:.14},anal:{from:.6,to:.78,h:.1},tail:'fork',eye:1.3},
  '004':{len:.28,h:.27,w:.45,back:0x6f7f7b,belly:0xeef0ea,fin:0xc8483a,tailFin:0xd2402d,pattern:'scales',shine:.6,dorsal:{from:.38,to:.52,h:.14},anal:{from:.64,to:.8,h:.08},tail:'deep'},
  '005':{len:.8,h:.3,w:.55,peak:.38,head:.42,back:0x5a5f5c,belly:0xd8d4c6,fin:0x6b6c64,pc:0x2f3330,pattern:'mottled',dorsal:{from:.44,to:.56,h:.12},anal:{from:.66,to:.8,h:.08},tail:'deep',eye:.8},
  '006':{len:.9,h:.23,w:.62,back:0x2d3333,belly:0x8c918b,fin:0x1e2322,pattern:'scales',shine:.2,dorsal:{from:.38,to:.52,h:.11},anal:{from:.66,to:.8,h:.07},tail:'fork',snout:'blunt'},
  '007':{len:.7,h:.25,w:.5,back:0x5d6b6a,belly:0xf1f2ee,fin:0x8d9693,pc:0x262c2c,pattern:'stripes',n:7,shine:.6,dorsal:{from:.24,to:.42,h:.14,shape:'tri'},dorsal2:{from:.46,to:.66,h:.1},anal:{from:.66,to:.8,h:.08},tail:'square',pect:.1},
  '008':{len:.45,h:.21,w:.6,back:0x56646b,belly:0xe9ecea,fin:0x8b9497,pc:0x485760,pattern:'stripes',n:6,shine:.5,dorsal:{from:.3,to:.38,h:.1,shape:'tri'},dorsal2:{from:.56,to:.64,h:.08},anal:{from:.62,to:.74,h:.07},tail:'fork',snout:'blunt'},
  '009':{len:.6,h:.19,w:.55,back:0x67704c,belly:0xe5e2cb,fin:0x8a8358,pc:0x2b3020,pattern:'saddles',n:7,dorsal:{from:.24,to:.44,h:.12,shape:'tri'},dorsal2:{from:.48,to:.7,h:.1},anal:{from:.66,to:.82,h:.08},tail:'fork',snout:'pike',eye:1.2},
  '010':{len:.06,h:.34,w:.4,back:0xa8262c,belly:0xf09a86,fin:0xc23a35,pc:0x2a1514,pattern:'spots',n:2,shine:.5,dorsal:{from:.4,to:.56,h:.13},anal:{from:.62,to:.76,h:.09},tail:'fork',eye:1.3},
  '011':{len:.3,h:.12,w:.85,peak:.3,ped:.55,back:0x8a8c79,belly:0xd8d6c0,fin:0x9a9884,pattern:'none',dorsal:{from:.4,to:.88,h:.06,shape:'finlets'},anal:{from:.8,to:.92,h:.06},tail:'round',pect:.13,pectWide:true,snout:'blunt',eye:.9},
  '012':{len:.23,h:.24,w:.45,back:0x2b2522,belly:0x5a4e45,fin:0x3d3531,pc:0x8d8270,pattern:'none',dorsal:{from:.72,to:.86,h:.08,shape:'rear'},anal:{from:.66,to:.86,h:.08},tail:'fork',tailSize:.7,snout:'long',eye:.6},
  '013':{len:.7,h:.2,w:.45,back:0x6c7e88,belly:0xf3f4f2,fin:0xb7bdbd,pattern:'scales',shine:.8,dorsal:{from:.44,to:.54,h:.13},anal:{from:.58,to:.84,h:.07},tail:'deep',snout:'up'},
  '014':{len:.45,h:.2,w:.7,back:0xe2b95d,belly:0xf4e6bf,fin:0xb48a3a,pc:0x6b4425,pattern:'reticulate',n:14,dorsal:{from:.3,to:.42,h:.14,shape:'tri'},anal:{from:.62,to:.84,h:.08},tail:'fork',barbels:3,snout:'blunt',eye:.7},
  '015':{len:.55,h:.15,w:.8,peak:.32,ped:.55,back:0x6e5a3c,belly:0xc9b58c,fin:0x6a5536,pc:0x2a2117,pattern:'bars',n:6,dorsal:{from:.45,to:.88,h:.07,shape:'finlets'},anal:{from:.8,to:.92,h:.07},tail:'round',pect:.15,pectWide:true,snout:'blunt'},
  '016':{len:.6,h:.33,w:.55,peak:.4,back:0x80703a,belly:0xe8d49a,fin:0x8a6a36,tailFin:0xa06a3a,pattern:'scales',n:1,shine:.9,dorsal:{from:.34,to:.72,h:.12,shape:'long'},anal:{from:.68,to:.8,h:.09},tail:'fork',barbels:2},
  '017':{len:.9,h:.16,w:.65,peak:.55,ped:.5,back:0x4e5d34,belly:0xe5e1c4,fin:0x6b6838,pc:0xc9c68d,pattern:'spots',n:3,dorsal:{from:.74,to:.86,h:.1,shape:'rear'},anal:{from:.74,to:.86,h:.09},tail:'fork',snout:'pike'},
  '018':{len:.1,h:.2,w:.7,back:0x5f5440,belly:0xb8a989,fin:0x6c5d44,pc:0x2b241a,pattern:'mottled',dorsal:{from:.72,to:.82,h:.08,shape:'rear'},anal:{from:.62,to:.85,h:.12},tail:'round',pect:.38,pectWide:true,snout:'up',eye:1.4},
  '019':{len:1.0,h:.14,w:.9,peak:.25,ped:.5,back:0x3b3c3a,belly:0xb9b5a8,fin:0x2f302e,pc:0x272826,pattern:'mottled',dorsal:{from:.3,to:.9,h:.06,shape:'long'},anal:{from:.52,to:.9,h:.06,shape:'long'},tail:'round',barbels:4,snout:'blunt',eye:.6},
  '020':{len:.8,h:.3,w:.6,back:0x6a4b33,belly:0xcbb18f,fin:0x5e432f,pc:0xe5d0a8,pattern:'spots',n:4,dorsal:{from:.24,to:.78,h:.1,shape:'long'},anal:{from:.66,to:.82,h:.1},tail:'round',pect:.14,eye:.8},
  '021':{len:.18,h:.18,w:.65,peak:.4,back:0x1d4a7d,belly:0x6c9cc6,fin:0x1f3e66,pc:0x8fd2ff,pattern:'spots',n:1,shine:.6,dorsal:{from:.3,to:.9,h:.07,shape:'long'},anal:{from:.55,to:.9,h:.07,shape:'long'},tail:'round',snout:'blunt'},
  '022':{len:.9,h:.24,w:.45,peak:.45,back:0xd9dad3,belly:0xf7f6f0,fin:0xd6d0bc,pattern:'scales',n:1,shine:1,dorsal:{from:.66,to:.92,h:.09,shape:'rear'},anal:{from:.56,to:.92,h:.09,shape:'rear'},tail:'round',tailSize:.8,barbels:2,snout:'up'},
  '023':{len:.8,h:.24,w:.55,back:0x6b5a2c,belly:0xe6cf8e,fin:0x8a7038,pc:0x2a1a12,pattern:'spots',n:2,dorsal:{from:.36,to:.5,h:.12},dorsal2:{from:.76,to:.8,h:.04},anal:{from:.66,to:.78,h:.08},tail:'square'},
  '024':{len:1.4,h:.17,w:.7,peak:.4,ped:.4,back:0x6b7680,belly:0xeef0f0,fin:0x5d6870,pattern:'none',dorsal:{from:.3,to:.44,h:.15,shape:'tri'},dorsal2:{from:.7,to:.76,h:.05,shape:'tri'},anal:{from:.72,to:.78,h:.04},tail:'shark',tailSize:1.3,pect:.2,snout:'shark',eye:.6},
  '025':{len:.9,h:.22,w:.52,back:0x3c5566,belly:0xf1f2ee,fin:0x56656c,pc:0x161a1d,pattern:'spots',n:1,shine:.8,dorsal:{from:.36,to:.5,h:.12},dorsal2:{from:.76,to:.8,h:.04},anal:{from:.66,to:.78,h:.08},tail:'square'},
  '026':{len:1.0,h:.24,w:.5,back:0x6d7a78,belly:0xf1f1ec,fin:0xb8432c,tailFin:0xa2361f,pc:0x1f2324,pattern:'stripes',n:6,shine:.8,dorsal:{from:.38,to:.52,h:.15,shape:'tri'},anal:{from:.66,to:.8,h:.08},tail:'deep',tailSize:1.2},
  '027':{len:1.5,h:.25,w:.48,back:0x5a6f7c,belly:0xf5f6f2,fin:0x9aa4a6,pattern:'scales',n:1,shine:1,dorsal:{from:.44,to:.56,h:.15,shape:'sail'},anal:{from:.64,to:.78,h:.1},tail:'deep',tailSize:1.25,snout:'up',eye:1.5},
}

const color=new THREE.Color(),tmp=new THREE.Color(),tmp2=new THREE.Color()
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t)}
function rng(seed:number){return ()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32)}

/** 身体外形：t 0 = 吻端，1 = 尾柄。返回半高、半宽、中心线 y。 */
function profile(look:FishLook){
  const peak=look.peak??.36, head=look.head??.55, ped=look.ped??.32, H=look.h/2, W=H*look.w
  const shape=(t:number)=>t<peak?Math.pow(Math.sin(Math.PI/2*t/peak),head):ped+(1-ped)*Math.pow(Math.cos(Math.PI/2*(t-peak)/(1-peak)),1.15)
  const up=look.snout==='up'?.35:look.snout==='shark'?-.2:0
  return {
    hh:(t:number)=>H*shape(t)*(look.snout==='pike'&&t<.2?.75+.25*t/.2:1),
    ww:(t:number)=>W*shape(t)*(look.snout==='shark'&&t<.2?1.15:1),
    cy:(t:number)=>up*H*Math.pow(Math.max(0,1-t/peak),2),
  }
}

function patternShade(look:FishLook,t:number,v:number,a:number,spots:number[][]){
  // 返回 0..1：花纹颜色在该点的覆盖度；v 0 腹 → 1 背
  const n=look.n??6
  switch(look.pattern){
    case 'bars':{const m=.5+.5*Math.cos(2*Math.PI*n*(t-.12));return t>.12&&t<.95&&v>.25?smooth(.55,.85,m)*.85:0}
    case 'saddles':{const m=.5+.5*Math.cos(2*Math.PI*n*(t-.15));return t>.15&&t<.95?smooth(.6,.9,m)*smooth(.45,.85,v):0}
    case 'stripes':{const m=Math.abs(((v*n*.5+.25)%1)-.5);return v>.3&&v<.92&&t>.2?smooth(.16,.06,m)*.9:0}
    case 'spots':case 'reticulate':{
      let best=9,second=9
      for(const [st,sv,r] of spots){const d=Math.hypot((st-t)*2.6,sv-v)/r;if(d<best){second=best;best=d}else if(d<second)second=d}
      if(look.pattern==='reticulate')return v>.12?smooth(.04,.13,second-best)*.92:0
      return smooth(1,.75,best)*(v>.2?1:.3)
    }
    case 'mottled':{const m=Math.sin(t*31+Math.sin(a*3)*2)*Math.sin(v*17+t*9)+Math.sin(t*13-v*11);return smooth(.4,1.2,m)*smooth(.2,.7,v)*.8}
    default:return 0
  }
}

function bodyGeometry(look:FishLook){
  const S=64,R=40,{hh,ww,cy}=profile(look)
  const pos:number[]=[],col:number[]=[],idx:number[]=[]
  const back=new THREE.Color(look.back),belly=new THREE.Color(look.belly),pc=new THREE.Color(look.pc??0x222222)
  const r=rng(Number(Object.keys(looks).find(k=>looks[k]===look)??7)*977)
  const count=look.pattern==='reticulate'?(look.n??12)*3:look.pattern==='spots'?Math.round(40*(look.n??2)):0
  const spots=Array.from({length:count},()=>[.12+.85*r(),.1+.9*r(),look.pattern==='reticulate'?.16:.018+.03*(look.n??2)*r()])
  for(let i=0;i<=S;i++){
    const t=i/S, x=.5-t, h=hh(t), w=ww(t), c=cy(t)
    for(let j=0;j<=R;j++){
      const a=j/R*Math.PI*2, s=Math.sin(a), k=Math.cos(a)
      const y=c+h*s*(s<0?.92:1), z=w*k
      pos.push(x,y,z)
      const v=(s+1)/2
      color.copy(belly).lerp(back,smooth(.3,.78,v))
      // 鳃盖：头后一道浅暗线；侧线：一条极淡的亮线
      if(t>.19&&t<.215)color.multiplyScalar(.82)
      if(Math.abs(v-.66)<.012&&t>.22)color.lerp(tmp.set(0xffffff),.12)
      const p=patternShade(look,t,v,a,spots);if(p>0)color.lerp(pc,p)
      if(look.pattern==='scales'){
        const n=look.n===1?14:26,cu=t*n,cv=v*n*.45+(Math.floor(cu)%2)*.5,fu=cu%1,fv=cv%1
        const edge=Math.min(fu,1-fu,fv,1-fv)
        tmp2.copy(color).multiplyScalar(.78);if(t>.2&&t<.97)color.lerp(tmp2,smooth(.12,.02,edge)*(look.n===1?.9:.5))
        if(look.n===1&&t>.2&&t<.97)color.lerp(tmp.set(0xffffff),.12*Math.sin(Math.floor(cu)*7.1+Math.floor(cv)*3.3)**2)
      }
      col.push(color.r,color.g,color.b)
    }
  }
  for(let i=0;i<S;i++)for(let j=0;j<R;j++){const a=i*(R+1)+j,b=a+R+1;idx.push(a,b,a+1,b,b+1,a+1)}
  const g=new THREE.BufferGeometry()
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3))
  g.setIndex(idx);g.computeVertexNormals();return g
}

/** 一片鳍：沿 base 点列向 tip 点列铺条带，顶点色做出鳍条明暗。 */
function finStrip(base:THREE.Vector3[],tip:THREE.Vector3[],tint:number,rays=true){
  const pos:number[]=[],col:number[]=[],idx:number[]=[],c=new THREE.Color(tint)
  base.forEach((b,i)=>{
    const t=tip[i],ray=rays&&i%2?.82:1
    pos.push(b.x,b.y,b.z,t.x,t.y,t.z)
    color.copy(c).multiplyScalar(.85*ray);col.push(color.r,color.g,color.b)
    color.copy(c).lerp(tmp.set(0xffffff),.18).multiplyScalar(ray);col.push(color.r,color.g,color.b)
    if(i)idx.push(2*i-2,2*i-1,2*i,2*i-1,2*i+1,2*i)
  })
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3))
  g.setIndex(idx);g.computeVertexNormals();return g
}

function dorsalFin(look:FishLook,fin:Fin,bottom:boolean){
  const {hh,cy}=profile(look),K=fin.shape==='finlets'?40:16,base:THREE.Vector3[]=[],tip:THREE.Vector3[]=[],sign=bottom?-1:1
  for(let i=0;i<=K;i++){
    const u=i/K,t=fin.from+(fin.to-fin.from)*u,y=cy(t)+sign*hh(t)*(bottom?.9:.97)
    let h:number
    switch(fin.shape){
      case 'long':h=fin.h*(.55+.45*Math.sin(Math.PI*Math.min(1,u*1.4+.1)));break
      case 'sail':h=fin.h*(u<.15?u/.15:1-.6*(u-.15))+(u>.85?fin.h*1.8*(u-.85)/.15:0);break
      case 'finlets':{const f=(u*9)%1;h=fin.h*(f<.6?f/.6:0)*1;break}
      case 'rear':h=fin.h*Math.pow(Math.sin(Math.PI*u),.6)*(.6+.6*u);break
      default:h=fin.h*Math.pow(Math.sin(Math.PI*Math.min(1,u*1.15)),.7)*(1-.45*u)
    }
    h*=look.h/.25*.5+.5
    base.push(new THREE.Vector3(.5-t,y,0));tip.push(new THREE.Vector3(.5-t-h*.45,y+sign*h,0))
  }
  return finStrip(base,tip,look.fin)
}

function tailFin(look:FishLook){
  const {hh,cy}=profile(look),ped=hh(1),x0=-.5,y0=cy(1),S=(look.tailSize??1)*Math.max(.11,look.h*.55),T=S*1.05
  const K=24,base:THREE.Vector3[]=[],tip:THREE.Vector3[]=[]
  // 外缘：从上叶尖经缺刻到下叶尖，按尾型给出 (dx, dy)
  const edge=(u:number):[number,number]=>{ // u 0 上 → 1 下
    const s=1-2*u, a=Math.abs(s)
    switch(look.tail){
      case 'round':return [-T*.9*Math.sqrt(Math.max(0,1-s*s*.8)),S*.8*s]
      case 'square':return [-T*(.82+.08*a),S*.85*s]
      case 'spade':return [-T*(1-.4*a),S*.6*s]
      case 'lunate':return [-T*(.45+.55*Math.pow(a,1.6)),S*1.1*s]
      case 'shark':return s>0?[-T*1.4*Math.pow(s,.7)-.02,S*.75*Math.pow(s,.9)]:[-T*.5*Math.pow(-s,.8),S*.55*s]
      case 'deep':return [-T*(.35+.75*Math.pow(a,.9)),S*s]
      default:return [-T*(.55+.45*Math.pow(a,1.2)),S*.95*s]
    }
  }
  for(let i=0;i<=K;i++){const u=i/K,s=1-2*u,[dx,dy]=edge(u);base.push(new THREE.Vector3(x0+.004,y0+ped*.9*s,0));tip.push(new THREE.Vector3(x0+dx,y0+dy,0))}
  return finStrip(base,tip,look.tailFin??look.fin)
}

function sideFin(look:FishLook,t:number,size:number,down:boolean,side:1|-1,wide=false){
  const {hh,ww,cy}=profile(look),x=.5-t,y=cy(t)-hh(t)*(down?.85:.35),z=ww(t)*(down?.5:.92)*side
  const K=8,base:THREE.Vector3[]=[],tip:THREE.Vector3[]=[],L=size*(look.h/.25*.4+.6)
  for(let i=0;i<=K;i++){const u=i/K
    base.push(new THREE.Vector3(x-u*L*.18,y,z))
    const r=L*(wide?.9+.2*Math.sin(Math.PI*u):1-.5*u)
    tip.push(new THREE.Vector3(x-u*L*.18-r*.8,y-r*(down?.5:.35)+u*L*.15,z+side*r*(wide?.55:.3)))
  }
  return finStrip(base,tip,look.fin)
}

const cache=new Map<string,THREE.Group>()
/** 检视 / 缩略图用的完整模型，长 1 个单位，头朝 +x。 */
export function buildFish(id:string){
  const hit=cache.get(id);if(hit)return hit.clone()
  const look=looks[id]??looks['001'],group=new THREE.Group();group.name='fish-'+id
  const shine=look.shine??.25
  const bodyMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.55-.3*shine,metalness:.08+.35*shine})
  const finMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.7,metalness:0,side:THREE.DoubleSide,transparent:true,opacity:.88,depthWrite:false})
  const add=(g:THREE.BufferGeometry,m:THREE.Material,name:string)=>{const mesh=new THREE.Mesh(g,m);mesh.name=name;group.add(mesh);return mesh}
  add(bodyGeometry(look),bodyMat,'body')
  add(dorsalFin(look,look.dorsal,false),finMat,'dorsal')
  if(look.dorsal2)add(dorsalFin(look,look.dorsal2,false),finMat,'dorsal2')
  if(look.anal)add(dorsalFin(look,look.anal,true),finMat,'anal')
  add(tailFin(look),finMat,'tail')
  for(const side of [1,-1] as const){
    add(sideFin(look,.27,look.pect??.1,false,side,look.pectWide),finMat,'pectoral')
    add(sideFin(look,.5,(look.pect??.1)*.7,true,side),finMat,'pelvic')
  }
  const {hh,ww,cy}=profile(look),et=look.snout==='long'?.14:.1,er=.022*(look.eye??1)*(look.h/.25*.3+.7)
  const eyeWhite=new THREE.MeshStandardMaterial({color:look.snout==='shark'?0x1a1d1f:0xd8c98a,roughness:.25,metalness:.1})
  const pupil=new THREE.MeshStandardMaterial({color:0x050607,roughness:.05,metalness:.3})
  for(const side of [1,-1]){
    const eye=new THREE.Mesh(new THREE.SphereGeometry(er,16,12),eyeWhite),p=new THREE.Mesh(new THREE.SphereGeometry(er*.6,12,8),pupil)
    eye.position.set(.5-et,cy(et)+hh(et)*.28,ww(et)*.78*side);p.position.copy(eye.position).add(new THREE.Vector3(0,0,er*.55*side))
    eye.name=p.name='eye';group.add(eye,p)
  }
  if(look.snout==='long'){ // 象鼻鱼：下弯的长吻
    const curve=new THREE.QuadraticBezierCurve3(new THREE.Vector3(.49,cy(0),0),new THREE.Vector3(.6,cy(0)-.01,0),new THREE.Vector3(.66,cy(0)-.07,0))
    add(new THREE.TubeGeometry(curve,12,hh(.05)*.45,8),bodyMat,'snout')
  }
  if(look.barbels){
    const barbMat=new THREE.MeshStandardMaterial({color:new THREE.Color(look.back).multiplyScalar(.7),roughness:.6})
    for(let i=0;i<look.barbels;i++)for(const side of [1,-1]){
      const len=.12+.1*(i===0?1:0),y=cy(0)-hh(.03)*(.2+.3*i)
      const curve=new THREE.QuadraticBezierCurve3(new THREE.Vector3(.495,y,.01*side),new THREE.Vector3(.5+len*.3,y-len*.2,len*.4*side),new THREE.Vector3(.5-len*.2,y-len*.5,len*.6*side))
      add(new THREE.TubeGeometry(curve,10,.0035,5),barbMat,'barbel')
    }
  }
  cache.set(id,group);return group.clone()
}

export function triangleCount(object:THREE.Object3D){
  let n=0;object.traverse(o=>{const g=(o as THREE.Mesh).geometry;if(g)n+=(g.index?g.index.count:g.attributes.position.count)/3});return n
}

// 图鉴 / 背包缩略图：共用一个离屏渲染器，按鱼种缓存 dataURL；空闲 4 秒后释放 GL 上下文。
const thumbs=new Map<string,string>()
let thumbRenderer:THREE.WebGLRenderer|undefined,idle=0
export function fishThumb(id:string){
  const hit=thumbs.get(id);if(hit)return hit
  if(!thumbRenderer){thumbRenderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});thumbRenderer.setSize(192,96,false);thumbRenderer.outputColorSpace=THREE.SRGBColorSpace}
  const scene=new THREE.Scene(),cam=new THREE.PerspectiveCamera(22,2,.1,20),fish=buildFish(id)
  scene.add(fish,new THREE.HemisphereLight(0xfff8ec,0x30403c,2.2));const sun=new THREE.DirectionalLight(0xffffff,1.6);sun.position.set(.6,1.4,2);scene.add(sun)
  fish.rotation.y=-.22;fish.rotation.x=.06;const box=new THREE.Box3().setFromObject(fish),mid=box.getCenter(new THREE.Vector3());fish.position.sub(mid)
  cam.position.set(0,.02,Math.max(1.5,(box.max.x-box.min.x)*1.55));cam.lookAt(0,0,0)
  thumbRenderer.render(scene,cam);const url=thumbRenderer.domElement.toDataURL('image/png');thumbs.set(id,url)
  clearTimeout(idle);idle=window.setTimeout(()=>{thumbRenderer?.dispose();thumbRenderer?.forceContextLoss();thumbRenderer=undefined},4000)
  return url
}
