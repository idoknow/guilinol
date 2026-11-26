import * as THREE from 'three'
import shores from './shores.json'

// 钓点地标（IDOK-336）：岸点上方悬一枚青色「钓」字圆印，160 m 内可见，越近越清楚，轻轻上下浮动；
// 正在钓鱼时隐藏。用固定屏幕尺寸的 Sprite，穿过树冠也看得见，和小地图上的钓点同一个样子。
function texture(){
  const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d')!
  g.fillStyle='rgba(15,42,39,.55)';g.beginPath();g.arc(64,66,58,0,Math.PI*2);g.fill()
  g.fillStyle='#20d6c1';g.strokeStyle='#f4efe2';g.lineWidth=6;g.beginPath();g.arc(64,62,50,0,Math.PI*2);g.fill();g.stroke()
  g.fillStyle='#0f2a27';g.font='700 64px "Noto Serif SC","Source Han Serif SC","Songti SC",serif';g.textAlign='center';g.textBaseline='middle';g.fillText('钓',64,66)
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t
}
export function fishingMarks(scene:THREE.Scene){
  // 与景点印章同一层（layer 2，play/index.ts 的 MARK_LAYER）：光影管线把这一层单独叠在画面上
  const material=new THREE.SpriteMaterial({map:texture(),sizeAttenuation:false,depthTest:false,fog:false,transparent:true,toneMapped:false})
  const marks=shores.map(w=>{const s=new THREE.Sprite(material.clone());s.name='fishing-mark-'+w.id;s.renderOrder=20;s.layers.set(2);s.scale.setScalar(.055)
    s.position.set(w.spot.x,w.spot.target[1]+4.5,w.spot.z);s.visible=false;scene.add(s);return {s,base:s.position.y}})
  let clock=0
  return {marks,tick(x:number,z:number,dt:number,fishing:boolean,playerY=-Infinity){
    clock+=dt
    for(const m of marks){const d=Math.hypot(m.s.position.x-x,m.s.position.z-z)
      m.s.visible=!fishing&&d<160
      if(!m.s.visible)continue
      ;(m.s.material as THREE.SpriteMaterial).opacity=Math.min(1,Math.max(.35,(160-d)/80))
      // 岸点通常比水面高好几米：玩家走近时以玩家脚下高度为准，浮在头顶上方
      const y=Math.max(m.base,playerY+3.2);m.s.position.y=y+Math.sin(clock*2+m.base)*.25}
  }}
}
