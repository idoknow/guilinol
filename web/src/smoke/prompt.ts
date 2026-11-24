import * as THREE from 'three'

/** Billboard at a fixed reading distance along the player's line of sight. */
export function createSmokePrompt(scene:THREE.Scene,camera:THREE.Camera){
  const canvas=document.createElement('canvas')
  canvas.width=768
  canvas.height=96
  const ctx=canvas.getContext('2d')!
  const map=new THREE.CanvasTexture(canvas)
  map.colorSpace=THREE.SRGBColorSpace
  const material=new THREE.SpriteMaterial({map,transparent:true,depthTest:false,depthWrite:false,fog:false,toneMapped:false})
  const text=new THREE.Sprite(material)
  text.visible=false
  text.frustumCulled=false
  text.renderOrder=100
  text.layers.set(2)
  camera.layers.enable(2)
  if(!camera.parent)scene.add(camera)
  camera.add(text)
  text.name='smoke-prompt'
  let previous=''
  return function update(label:string){
    text.visible=!!label
    if(!label)return
    if(label!==previous){
      // 纯文字、无底板：宣纸白字 + 墨色细描边 + 很淡的投影，任何天色下都读得清；
      // 按键字母（F）用玉色单独标出，一眼看出要按哪个键。
      ctx.clearRect(0,0,768,96)
      ctx.font='600 40px "Noto Serif SC","Source Han Serif SC","Songti SC","STSong",serif'
      ctx.textBaseline='middle'
      ctx.lineJoin='round'
      const parts=label.split(/(F)/)
      const widths=parts.map(part=>ctx.measureText(part).width)
      let x=384-widths.reduce((a,b)=>a+b,0)/2
      parts.forEach((part,i)=>{
        ctx.shadowColor='rgba(10,16,14,.55)'
        ctx.shadowBlur=8
        ctx.lineWidth=5
        ctx.strokeStyle='rgba(20,33,30,.82)'
        ctx.strokeText(part,x,50)
        ctx.shadowBlur=0
        ctx.fillStyle=part==='F'?'#a9e0d1':'#f4efe2'
        ctx.fillText(part,x,50)
        x+=widths[i]
      })
      map.needsUpdate=true
      previous=label
    }
    const height=.23/camera.projectionMatrix.elements[5]
    text.scale.set(8*height,height,1)
    text.position.set(0,0,-1).applyMatrix4(camera.projectionMatrixInverse)
    text.position.multiplyScalar(-1.7/text.position.z)
  }
}
