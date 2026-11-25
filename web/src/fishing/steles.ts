import * as THREE from 'three'
import shores from './shores.json'
import type {ObstacleVolumeSpec} from '../walk/obstacle-volumes'

type Section={topCount:{nickname:string,count:number}[],topLegendary:{nickname:string,count:number}[]}
type Boards={zone:Section,global:Section}
export function drawBoard(canvas:HTMLCanvasElement,title:string,section?:Section){
  const ctx=canvas.getContext('2d')!
  ctx.fillStyle='#eee';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#222';ctx.font='20px sans-serif'
  const lines=[title]
  for(const [label,entries] of [['上鱼数',section?.topCount],['传说鱼',section?.topLegendary]] as const){
    lines.push(label,...(entries?.length?entries.map((row,index)=>`${index+1}. ${row.nickname} · ${row.count}`):[section?'暂无记录':'等候榜单']))
  }
  lines.forEach((line,index)=>ctx.fillText(line,8,25+index*30,canvas.width-16))
}
export function steleModel(texture:THREE.Texture){
  const group=new THREE.Group(),body=new THREE.Mesh(new THREE.BoxGeometry(1.2,2.2,.4),new THREE.MeshStandardMaterial())
  body.position.y=1.1;group.add(body)
  const face=new THREE.Mesh(new THREE.PlaneGeometry(1.16,2.16),new THREE.MeshBasicMaterial({map:texture}));face.position.set(0,1.1,.201);group.add(face);return group
}
export function createSteles(scene:THREE.Scene,addCollider?:(spec:ObstacleVolumeSpec)=>void){
  const groups=shores.map(zone=>{
    const signs=zone.steles.map(({kind,x,y,z,yaw})=>{
      const title=kind==='zone'?zone.name+'榜':'全服榜',canvas=document.createElement('canvas');canvas.width=256;canvas.height=512
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
