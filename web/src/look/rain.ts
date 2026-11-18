import * as THREE from 'three'
import {atmo} from './time'
import {WATER_LAYER} from './water'

// 小雨: light slanted streaks in a 70 m box that wraps around the camera. One draw call, GPU-animated.
export function rain() {
  const count = 5000, box = 70
  const base = new Float32Array(count*2*3), end = new Float32Array(count*2)
  for(let i=0;i<count;i++) {
    const x = Math.random()*box, y = Math.random()*box, z = Math.random()*box
    base.set([x,y,z,x,y,z],i*6); end[i*2+1] = 1
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.BufferAttribute(base,3))
  geometry.setAttribute('aEnd',new THREE.BufferAttribute(end,1))
  const material = new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, fog:false,
    uniforms:{uTime:atmo.uTime,uRain:atmo.uRain,uBox:{value:box},uColor:{value:new THREE.Color(0xdfe7ea)}},
    vertexShader:`uniform float uTime; uniform float uBox; attribute float aEnd; varying float vFade; varying float vEnd;
      void main(){
        vec3 wind = vec3(-1.6, -9.0, 1.1);
        vec3 p = mod(position + wind * uTime - cameraPosition, uBox) + cameraPosition - uBox * .5;
        p -= wind * .055 * aEnd;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vFade = 1.0 - smoothstep(uBox * .2, uBox * .5, length(p - cameraPosition)); vEnd = aEnd;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader:`uniform float uRain; uniform vec3 uColor; varying float vFade; varying float vEnd;
      void main(){ gl_FragColor = vec4(uColor, uRain * vFade * mix(.38, .05, vEnd)); }`,
  })
  const lines = new THREE.LineSegments(geometry,material)
  lines.frustumCulled = false; lines.layers.set(WATER_LAYER); lines.renderOrder = 10
  return Object.assign(lines,{update(){lines.visible = atmo.uRain.value>.02}})
}
