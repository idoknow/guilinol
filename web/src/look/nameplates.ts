import * as THREE from 'three'

const overlay=new THREE.Scene(), size=new THREE.Vector2(),depth={value:null as THREE.Texture|null}
const labels=new Map<THREE.Sprite,THREE.Sprite>()
export function registerNameplate(source:THREE.Sprite){
  source.material.toneMapped=false
  const material=source.material.clone();material.depthTest=false
  material.onBeforeCompile=shader=>{
    shader.uniforms.sceneDepth=depth;shader.uniforms.canvasSize={value:size}
    shader.fragmentShader=`uniform sampler2D sceneDepth; uniform vec2 canvasSize;\n${shader.fragmentShader}`.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
      if(gl_FragCoord.z > texture2D(sceneDepth,gl_FragCoord.xy/canvasSize).r+0.000001) discard;`)
  }
  const copy=new THREE.Sprite(material);copy.matrixAutoUpdate=false;labels.set(source,copy);overlay.add(copy)
}
export function removeNameplate(source:THREE.Sprite){const copy=labels.get(source);if(copy){copy.removeFromParent();copy.material.dispose();labels.delete(source)}}
export function renderWithLabels(renderer:THREE.WebGLRenderer,camera:THREE.Camera,texture:THREE.Texture,draw:()=>void){
  if(!labels.size){draw();return}
  const visible:THREE.Sprite[]=[]
  for(const [source,copy] of labels){
    copy.visible=source.visible&&!!source.parent?.visible
    if(!copy.visible)continue
    source.updateWorldMatrix(true,false);copy.matrix.copy(source.matrixWorld);copy.matrixWorldNeedsUpdate=true
    copy.material.opacity=source.material.opacity;visible.push(source);source.visible=false
  }
  try{draw();if(visible.length){depth.value=texture;renderer.getDrawingBufferSize(size);renderer.setRenderTarget(null);renderer.render(overlay,camera)}}
  finally{for(const source of visible)source.visible=true}
}
