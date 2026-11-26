import * as THREE from 'three'
import {markAlpha,onMarkTile} from '../session-mark'

export function sessionMarkPass(renderer:THREE.WebGLRenderer){
  const scene=new THREE.Scene(),camera=new THREE.Camera(),texture=new THREE.Texture()
  texture.flipY=false;texture.generateMipmaps=false;texture.minFilter=texture.magFilter=THREE.NearestFilter
  const size=new THREE.Vector2()
  const material=new THREE.ShaderMaterial({uniforms:{tile:{value:texture},height:{value:0},alpha:{value:markAlpha}},
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`uniform sampler2D tile;uniform float height,alpha;void main(){vec2 pixel=vec2(gl_FragCoord.x,height-gl_FragCoord.y);gl_FragColor=vec4(texture2D(tile,(mod(floor(pixel),512.)+.5)/512.).rrr,alpha);}`,
    transparent:true,depthTest:false,depthWrite:false,toneMapped:false})
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);plane.frustumCulled=false;scene.add(plane)
  let ready=false
  onMarkTile(image=>{ready=!!image;if(image){texture.image=image;texture.needsUpdate=true}})
  return ()=>{
    if(!ready)return
    const target=renderer.getRenderTarget(),auto=renderer.autoClear
    try{renderer.autoClear=false;renderer.setRenderTarget(null);material.uniforms.height.value=renderer.getDrawingBufferSize(size).y;renderer.render(scene,camera)}
    finally{renderer.autoClear=auto;renderer.setRenderTarget(target)}
  }
}
