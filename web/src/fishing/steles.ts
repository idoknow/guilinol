import * as THREE from 'three'
import shores from './shores.json'
import type {ObstacleVolumeSpec} from '../walk/obstacle-volumes'

type Section={topCount:{nickname:string,count:number}[],topLegendary:{nickname:string,count:number}[]}
type Boards={zone:Section,global:Section}
const SANS='"PingFang SC","HarmonyOS Sans SC","Noto Sans CJK SC","Source Han Sans SC","Microsoft YaHei",system-ui,sans-serif'
/** 现代电子看板：深色屏幕 + 青色标题栏 + 排名条，自发光（夜里也清楚）。 */
export function drawBoard(canvas:HTMLCanvasElement,title:string,section?:Section){
  const g=canvas.getContext('2d')!,W=canvas.width,H=canvas.height
  const bg=g.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#0c1a1d');bg.addColorStop(1,'#08121a');g.fillStyle=bg;g.fillRect(0,0,W,H)
  // 细网点，像 LED 屏
  g.fillStyle='rgba(255,255,255,.025)';for(let y=0;y<H;y+=4)for(let x=(y/4)%2*2;x<W;x+=4)g.fillRect(x,y,1,1)
  const text=(t:string,x:number,y:number,size:number,color:string,weight='700',align:CanvasTextAlign='left')=>{g.font=`${weight} ${size}px ${SANS}`;g.textAlign=align;g.textBaseline='middle';g.fillStyle=color;g.fillText(t,x,y)}
  // 标题栏
  const head=g.createLinearGradient(0,0,W,0);head.addColorStop(0,'#14b8a6');head.addColorStop(1,'#20d6c1');g.fillStyle=head;g.fillRect(0,0,W,100)
  const short=title.replace('漓江·','').replace(/榜$/,'')
  g.fillStyle='#06201d';g.beginPath();g.arc(52,50,26,0,Math.PI*2);g.fill();text('钓',52,52,30,'#20d6c1','800','center')
  text(short.length>8?short.slice(0,8)+'…':short,92,40,36,'#06201d','800')
  text(title==='全服榜'?'全服钓鱼排行':'本钓点排行',92,76,22,'rgba(6,32,29,.78)','600')
  let y=116
  const row=(rank:number,name:string,value:string,top:boolean,legend=false)=>{
    const h=legend?44:top?46:38
    g.fillStyle=rank%2?'rgba(255,255,255,.04)':'rgba(255,255,255,.07)';g.fillRect(24,y,W-48,h-6)
    const medal=['#ffc53d','#d9dde3','#e09a5a'][rank-1]
    if(top&&medal){g.fillStyle=medal;g.beginPath();g.arc(56,y+(h-6)/2,17,0,Math.PI*2);g.fill();text(String(rank),56,y+(h-6)/2+1,20,'#10161a','800','center')}
    else text(String(rank),56,y+(h-6)/2,22,'rgba(246,244,239,.6)','700','center')
    const n=name.length>9?name.slice(0,9)+'…':name
    text(n,90,y+(h-6)/2,top?26:23,top?'#f6f4ef':'rgba(246,244,239,.88)',top?'700':'500')
    text(value,W-40,y+(h-6)/2,top?25:22,legend?'#ffc53d':'#20d6c1','800','right');y+=h
  }
  const label=(t:string,sub:string)=>{text(t,28,y+20,28,'#20d6c1','800');text(sub,W-28,y+22,19,'rgba(246,244,239,.5)','500','right');y+=46}
  const empty=(t:string)=>{text(t,W/2,y+26,24,'rgba(246,244,239,.45)','500','center');y+=60}
  label('上鱼榜','前 10 名')
  if(!section)empty('正在读取…');else if(!section.topCount.length)empty('暂无记录 · 快来抢第一');else section.topCount.slice(0,10).forEach((r,i)=>row(i+1,r.nickname,`${r.count} 尾`,i<3))
  y+=10;label('传说鱼榜','前 3 名')
  if(!section)empty('正在读取…');else if(!section.topLegendary.length)empty('还没有人钓到传说鱼');else section.topLegendary.slice(0,3).forEach((r,i)=>row(i+1,r.nickname,`${r.count} 尾`,true,true))
  // 底部跑马灯条
  g.fillStyle='rgba(32,214,193,.18)';g.fillRect(0,H-40,W,40);text('网上桂林 · 钓鱼排行 · 每 5 分钟刷新',W/2,H-20,20,'rgba(246,244,239,.75)','600','center')
}

let frameMat:THREE.MeshStandardMaterial|undefined,metalMat:THREE.MeshStandardMaterial|undefined,glowMat:THREE.MeshBasicMaterial|undefined
/** 现代电子看板：两根金属立柱 + 深灰外框 + 自发光屏幕 + 顶部灯条 + 底座；屏幕在正面（+z）。 */
export function steleModel(texture:THREE.Texture){
  frameMat??=new THREE.MeshStandardMaterial({color:0x2a3134,roughness:.45,metalness:.6})
  metalMat??=new THREE.MeshStandardMaterial({color:0x9aa4a8,roughness:.3,metalness:.85})
  glowMat??=new THREE.MeshBasicMaterial({color:0x7ff5e6,toneMapped:false})
  const group=new THREE.Group()
  const add=(geo:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z=0)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);group.add(m);return m}
  add(new THREE.BoxGeometry(1.5,.16,.6),frameMat,0,.08)
  for(const x of [-.62,.62])add(new THREE.CylinderGeometry(.045,.05,2.45,12),metalMat,x,1.3)
  add(new THREE.BoxGeometry(1.3,2.0,.12),frameMat,0,1.5)
  // 屏幕：自发光贴图（MeshBasic 不受光照，夜里一样亮）
  const screen=new THREE.Mesh(new THREE.PlaneGeometry(1.2,1.9),new THREE.MeshBasicMaterial({map:texture,toneMapped:false}));screen.position.set(0,1.5,.061);group.add(screen)
  // 顶部灯条 + 侧边细灯
  add(new THREE.BoxGeometry(1.3,.05,.14),glowMat,0,2.52)
  for(const x of [-.66,.66])add(new THREE.BoxGeometry(.02,1.9,.02),glowMat,x,1.5,.065)
  return group
}

export function createSteles(scene:THREE.Scene,addCollider?:(spec:ObstacleVolumeSpec)=>void){
  const groups=shores.map(zone=>{
    const signs=zone.steles.map(({kind,x,y,z,yaw})=>{
      const title=kind==='zone'?zone.name+'榜':'全服榜',canvas=document.createElement('canvas');canvas.width=512;canvas.height=810
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace
      const mesh=steleModel(texture);mesh.name=`stele-${zone.id}-${kind}`;mesh.position.set(x,y,z);mesh.rotation.y=yaw;scene.add(mesh)
      addCollider?.({id:mesh.name,origin:[x,y,z],rotationY:yaw,boxes:[{minX:-.6,maxX:.6,minZ:-.2,maxZ:.2,minY:0,maxY:2.2}]})
      const update=(boards?:Boards)=>{drawBoard(canvas,title,boards?.[kind as keyof Boards]);texture.needsUpdate=true};update();return {x,z,update}
    });return {zone:zone.id,signs,next:0}
  })
  return {tick(x:number,z:number){const now=performance.now();for(const group of groups){
    if(now<group.next||!group.signs.some(sign=>(sign.x-x)**2+(sign.z-z)**2<=3600))continue
    group.next=now+300000;void fetch(`/api/fishing/boards?zone=${group.zone}`).then(async response=>{
      if(response.ok){const boards=await response.json();group.signs.forEach(sign=>sign.update(boards))}
    }).catch(()=>{})
  }}}
}
