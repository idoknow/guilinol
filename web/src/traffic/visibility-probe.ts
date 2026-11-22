import * as THREE from 'three'

export function pixelVisible(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.Camera){
  const mesh=scene.getObjectByName('G2 traffic') as THREE.InstancedMesh
  const size=renderer.getDrawingBufferSize(new THREE.Vector2())
  const target=new THREE.WebGLRenderTarget(size.x,size.y)
  const original=mesh.material,previousTarget=renderer.getRenderTarget()
  const ids=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,
    vertexShader:`uniform mat4 modelViewMatrix,projectionMatrix;in vec3 position;in mat4 instanceMatrix;flat out int actor;void main(){actor=gl_InstanceID+1;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader:`precision highp float;flat in int actor;out vec4 color;void main(){color=vec4(1.,0.,float(actor)/255.,1.);}`})
  try{
    mesh.material=ids;renderer.setRenderTarget(target);renderer.render(scene,camera)
    const pixels=new Uint8Array(size.x*size.y*4),counts=new Uint32Array(mesh.count+1)
    renderer.readRenderTargetPixels(target,0,0,size.x,size.y,pixels)
    for(let offset=0;offset<pixels.length;offset+=4)if(pixels[offset]===255&&pixels[offset+1]===0&&pixels[offset+2]<=mesh.count)counts[pixels[offset+2]]++
    return (mesh.userData.motorIds as number[]).filter(index=>counts[index+1]>=6)
  }finally{mesh.material=original;renderer.setRenderTarget(previousTarget);target.dispose();ids.dispose()}
}
