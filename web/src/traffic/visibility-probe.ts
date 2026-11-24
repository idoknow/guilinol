import * as THREE from 'three'

export function motorPixelCounts(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.Camera){
  const proxy=scene.getObjectByName('G2 traffic') as THREE.InstancedMesh
  const visuals=scene.getObjectByName('G2 traffic visuals') as THREE.BatchedMesh
  const size=renderer.getDrawingBufferSize(new THREE.Vector2()),target=new THREE.WebGLRenderTarget(size.x,size.y)
  const original=visuals.material,previousTarget=renderer.getRenderTarget()
  const ids=new THREE.MeshBasicMaterial({toneMapped:false,fog:false})
  ids.onBeforeCompile=shader=>{
    shader.vertexShader='flat varying int actorSlot;\n'+shader.vertexShader.replace('#include <batching_vertex>',`#include <batching_vertex>
      actorSlot=int(getIndirectIndex(gl_DrawID))+1;`)
    shader.fragmentShader='flat varying int actorSlot;\n'+shader.fragmentShader.replace('#include <dithering_fragment>',`gl_FragColor=vec4(1.,0.,float(min(actorSlot,255))/255.,1.);`)
  }
  try{
    visuals.material=ids;renderer.setRenderTarget(target);renderer.render(scene,camera)
    const pixels=new Uint8Array(size.x*size.y*4),counts=new Uint32Array(proxy.count+1)
    renderer.readRenderTargetPixels(target,0,0,size.x,size.y,pixels)
    for(let offset=0;offset<pixels.length;offset+=4)if(pixels[offset]===255&&pixels[offset+1]===0&&pixels[offset+2]<=proxy.count)counts[pixels[offset+2]]++
    return (proxy.userData.allMotors as number[]).map(index=>({index,pixels:counts[index+1]}))
  }finally{visuals.material=original;renderer.setRenderTarget(previousTarget);target.dispose();ids.dispose()}
}
export function pixelVisible(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.Camera){
  return motorPixelCounts(renderer,scene,camera).filter(hit=>hit.pixels>=6).map(hit=>hit.index)
}
