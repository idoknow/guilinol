import * as THREE from 'three'
import shores from './shores.json'
import type {ObstacleVolumeSpec} from '../walk/obstacle-volumes'

type Section={topCount:{nickname:string,count:number}[],topLegendary:{nickname:string,count:number}[]}
type Boards={zone:Section,global:Section}
const SERIF='"Noto Serif SC","Source Han Serif SC","Songti SC","STSong",serif'
/** 碑文：青石底上刻金字（浅金字 + 暗色内阴影，像凿出来再描金），上方标题 + 朱印「钓」，下面两段榜单。 */
export function drawBoard(canvas:HTMLCanvasElement,title:string,section?:Section){
  const g=canvas.getContext('2d')!,W=canvas.width,H=canvas.height
  const bg=g.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#3e4a48');bg.addColorStop(1,'#33403e');g.fillStyle=bg;g.fillRect(0,0,W,H)
  // 石纹斑点
  for(let i=0;i<1800;i++){const x=(Math.sin(i*12.9898)*43758.5453%1+1)%1*W,y=(Math.sin(i*78.233)*12543.21%1+1)%1*H,a=.04+((i*37)%11)/180
    g.fillStyle=i%3?`rgba(255,255,255,${a})`:`rgba(0,0,0,${a})`;g.fillRect(x,y,1.5+(i%3),1.5+(i%2))}
  // 内框：双线阴刻
  const frame=(inset:number,width:number,color:string)=>{g.strokeStyle=color;g.lineWidth=width;g.strokeRect(inset,inset,W-2*inset,H-2*inset)}
  frame(18,3,'rgba(0,0,0,.45)');frame(20,1.5,'rgba(217,195,138,.55)');frame(30,1,'rgba(217,195,138,.3)')
  const carve=(text:string,x:number,y:number,size:number,weight='600',align:CanvasTextAlign='center',color='#dcc68c')=>{
    g.font=`${weight} ${size}px ${SERIF}`;g.textAlign=align;g.textBaseline='middle'
    g.fillStyle='rgba(0,0,0,.6)';g.fillText(text,x+1.5,y+2)
    g.fillStyle=color;g.fillText(text,x,y)
  }
  // 标题 + 朱印
  const short=title.replace('漓江·','')
  carve(short.length>7?short.slice(0,7):short,W/2,92,short.length>6?54:62,'700')
  g.fillStyle='#a9503c';g.fillRect(W/2-26,138,52,52);g.strokeStyle='#d0694c';g.lineWidth=2;g.strokeRect(W/2-22,142,44,44)
  g.font=`700 34px ${SERIF}`;g.textAlign='center';g.textBaseline='middle';g.fillStyle='#f4efe2';g.fillText('钓',W/2,166)
  const line=(y:number)=>{g.strokeStyle='rgba(217,195,138,.45)';g.lineWidth=1.5;g.beginPath();g.moveTo(60,y);g.lineTo(W-60,y);g.stroke()}
  let y=232
  const block=(label:string,entries:Section['topCount']|undefined,limit:number,unit:string)=>{
    line(y-26);carve(label,W/2,y+4,36,'700','center','#e8d9a8');y+=58
    if(!entries){carve('榜单读取中',W/2,y,26,'400','center','rgba(220,198,140,.7)');y+=50;return}
    if(!entries.length){carve('虚位以待',W/2,y,28,'400','center','rgba(220,198,140,.75)');y+=50;return}
    entries.slice(0,limit).forEach((row,index)=>{
      const top=index<3,size=top?30:26
      carve(['壹','贰','叁','肆','伍','陆','柒','捌','玖','拾'][index],70,y,size,'700','left',top?'#f0d27a':'#cdb986')
      const name=row.nickname.length>8?row.nickname.slice(0,8)+'…':row.nickname
      carve(name,120,y,size,top?'700':'500','left')
      carve(`${row.count}${unit}`,W-64,y,size-2,'500','right','#cdb986');y+=top?46:40
    })
    y+=18
  }
  block('上鱼榜',section?.topCount,10,' 尾')
  block('传说榜',section?.topLegendary,3,' 尾')
}

function stoneTexture(){
  const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d')!
  g.fillStyle='#dfe5e3';g.fillRect(0,0,256,256)
  for(let i=0;i<5000;i++){const v=150+((i*7919)%80);g.fillStyle=`rgba(${v},${v+6},${v+4},.45)`;g.fillRect((i*73)%256,(i*151)%256,2,2)}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;return t
}
let stone:THREE.MeshStandardMaterial|undefined,stoneDark:THREE.MeshStandardMaterial|undefined
/** 青灰石碑：两级碑座、微收分的碑身、弧顶碑帽带出檐；碑文贴在正面（+z）。 */
export function steleModel(texture:THREE.Texture){
  stone??=new THREE.MeshStandardMaterial({color:0x8e9b98,map:stoneTexture(),roughness:.88,metalness:0})
  stoneDark??=new THREE.MeshStandardMaterial({color:0x66726f,map:stone.map,roughness:.9})
  const group=new THREE.Group()
  const add=(geo:THREE.BufferGeometry,mat:THREE.Material,y:number)=>{const m=new THREE.Mesh(geo,mat);m.position.y=y;m.castShadow=m.receiveShadow=true;group.add(m);return m}
  add(new THREE.BoxGeometry(1.75,.22,.82),stoneDark,.11)
  add(new THREE.BoxGeometry(1.5,.2,.64),stone,.32)
  const body=new THREE.CylinderGeometry(.5,.5,2.1,4,1,false,Math.PI/4);body.scale(1.6971,1,.5091)
  add(body,stone,1.47)
  // 碑身正面的碑心（略凹的平板）
  add(new THREE.BoxGeometry(1.12,1.92,.04),stoneDark,1.47).position.z=.185
  // 碑帽：圆弧顶 + 出檐
  add(new THREE.BoxGeometry(1.42,.12,.5),stoneDark,2.58)
  const shape=new THREE.Shape();shape.moveTo(-.7,0);shape.quadraticCurveTo(-.7,.34,0,.36);shape.quadraticCurveTo(.7,.34,.7,0);shape.closePath()
  const arch=new THREE.ExtrudeGeometry(shape,{depth:.44,bevelEnabled:true,bevelThickness:.02,bevelSize:.02,bevelSegments:2,curveSegments:16});arch.translate(0,0,-.22)
  add(arch,stone,2.64)
  const face=new THREE.Mesh(new THREE.PlaneGeometry(1.06,1.86),new THREE.MeshStandardMaterial({map:texture,roughness:.8}));face.position.set(0,1.47,.207);group.add(face)
  return group
}

export function createSteles(scene:THREE.Scene,addCollider?:(spec:ObstacleVolumeSpec)=>void){
  const groups=shores.map(zone=>{
    const signs=zone.steles.map(({kind,x,y,z,yaw})=>{
      const title=kind==='zone'?zone.name+'榜':'全服榜',canvas=document.createElement('canvas');canvas.width=512;canvas.height=900
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
