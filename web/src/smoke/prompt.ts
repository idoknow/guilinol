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
      ctx.clearRect(0,0,768,96)
      ctx.font='600 42px serif'
      ctx.textAlign='center'
      ctx.textBaseline='middle'
      ctx.shadowColor='#212622'
      ctx.shadowBlur=5
      ctx.fillStyle='#fff8eb'
      ctx.fillText(label,384,48)
      map.needsUpdate=true
      previous=label
    }
    const height=.23/camera.projectionMatrix.elements[5]
    text.scale.set(8*height,height,1)
    text.position.set(0,0,-1).applyMatrix4(camera.projectionMatrixInverse)
    text.position.multiplyScalar(-1.7/text.position.z)
  }
}
