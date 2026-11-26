import * as THREE from 'three'
import {onTile} from './session-mark'

export function sessionMarkPass(renderer: THREE.WebGLRenderer) {
  const uniforms = {tile:{value:null as THREE.Texture|null}, height:{value:0}, ratio:{value:1}}
  const material = new THREE.ShaderMaterial({uniforms, transparent:true, depthTest:false, depthWrite:false,
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`uniform sampler2D tile; uniform float height, ratio;
      void main(){vec2 pixel=vec2(gl_FragCoord.x,height-gl_FragCoord.y)/ratio;
        gl_FragColor=vec4(texture2D(tile,pixel/512.).rgb,.12);}`})
  const scene = new THREE.Scene(), camera = new THREE.Camera()
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2,2),material)
  quad.frustumCulled=false; scene.add(quad)
  onTile(image => {
    uniforms.tile.value?.dispose(); uniforms.tile.value=null
    if (!image) return
    const texture = new THREE.Texture(image)
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping
    texture.flipY=false; texture.generateMipmaps=false
    texture.minFilter=texture.magFilter=THREE.NearestFilter; texture.needsUpdate=true
    uniforms.tile.value=texture
  })
  return () => {
    if (!uniforms.tile.value) return
    uniforms.height.value=renderer.domElement.height; uniforms.ratio.value=renderer.getPixelRatio()
    const clear=renderer.autoClear
    renderer.autoClear=false
    try { renderer.render(scene,camera) } finally { renderer.autoClear=clear }
  }
}
