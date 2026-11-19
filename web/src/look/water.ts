import * as THREE from 'three'
import {atmo, env} from './time'
import {look} from './config'

// M3 水是镜子 (docs/style.md 原则 3): a planar mirror of the whole scene, sampled through gentle
// ripples and mixed with a jade body colour by Fresnel. Water meshes live on layer 1 so the mirror
// camera (layer 0 only) never sees them. The mirror target is flagged as an "XR" target so three
// tone-maps and sRGB-encodes into it exactly like the screen — that keeps display-space fog correct
// inside the reflection, and the water shader can mix everything in display space.
export const WATER_LAYER = 1

const mirrorTarget = new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:true})
mirrorTarget.texture.colorSpace = THREE.SRGBColorSpace
;(mirrorTarget as unknown as {isXRRenderTarget:boolean}).isXRRenderTarget = true
const textureMatrix = new THREE.Matrix4()
const body = {value:new THREE.Color()}, sunLight = {value:new THREE.Color()}

export const waterMaterial = new THREE.ShaderMaterial({
  fog:true, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-8,
  uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{tMirror:{value:null},textureMatrix:{value:null},uMirrorLevel:{value:148},uMirrorReady:{value:0}}]),
  vertexShader:`uniform mat4 textureMatrix; uniform float uMirrorLevel; varying vec4 vProj; varying float vMismatch;
    #include <fog_pars_vertex>
    void main(){
      vec3 transformed = position;
      vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
      vec4 world = modelMatrix * vec4(transformed, 1.0);
      vProj = textureMatrix * world;
      // Ponds sit 2–9 m above the 148 m 漓江 mirror plane; their own banks block that mirror, so they
      // fall back to a soft sky reflection instead of a wrong image.
      vMismatch = smoothstep(.4, 1.5, abs(world.y - uMirrorLevel));
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader:`uniform sampler2D tMirror; uniform vec3 uBody; uniform vec3 uSunLight; uniform vec3 uSun;
    uniform float uTime; uniform float uRain; uniform float uNight; uniform float uMirrorReady; varying vec4 vProj; varying float vMismatch;
    #include <fog_pars_fragment>
    float rh(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
    vec2 wave(vec2 p, vec2 d, float f, float a, float s){ float k = dot(p, d) * f + uTime * s; return d * (a * f * cos(k)); }
    void main(){
      vec2 p = vFogWorld.xz;
      float dist = length(vFogWorld - cameraPosition);
      // Calm 漓江: long slow swells plus fine wind ripples, faded out before they alias.
      vec2 g = wave(p, normalize(vec2(1.0, .3)), .21, .06, .55) + wave(p, normalize(vec2(-.45, 1.0)), .37, .035, .8)
             + wave(p, normalize(vec2(.7, -.8)), 1.3, .009, 1.7) + wave(p, normalize(vec2(-.9, -.2)), 2.9, .004, 2.6);
      float fine = 1.0 - smoothstep(.15, .9, fwidth(p.x) + fwidth(p.y));
      g *= mix(.35, 1.0, fine);
      // Rain: expanding rings in a jittered 1.6 m grid.
      if (uRain > .01) {
        for (int i = 0; i < 2; i++) {
          vec2 q = p / 1.6 + float(i) * .5, cell = floor(q);
          vec2 c = cell + .2 + .6 * vec2(rh(cell), rh(cell + 7.1));
          float life = fract(uTime * .9 + rh(cell + 3.3)), r = life * .9;
          vec2 dv = q - c; float d = length(dv);
          float ring = sin((d - r) * 28.0) * exp(-abs(d - r) * 14.0) * (1.0 - life);
          g += (dv / max(d, 1e-3)) * ring * .22 * uRain * fine;
        }
      }
      vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
      vec3 v = normalize(cameraPosition - vFogWorld);
      float cosT = clamp(dot(n, v), 0.0, 1.0);
      float fresnel = mix(.3, 1.0, pow(1.0 - cosT, 3.0)) * (1.0 - .25 * uRain);
      vec2 uv = vProj.xy / vProj.w + n.xz * (.035 + .05 * uRain) * mix(1.0, .35, smoothstep(60.0, 900.0, dist));
      vec3 refl = texture2D(tMirror, clamp(uv, .001, .999)).rgb;
      refl = mix(refl, mix(uHorizon, uBody, .35), max(vMismatch, 1.0 - uMirrorReady));
      vec3 col = mix(uBody, refl, fresnel * .94);
      // Sun / moon glitter on the ripples.
      float spec = pow(max(dot(reflect(-v, n), uSun), 0.0), 220.0);
      col += uSunLight * spec * 1.4;
      gl_FragColor = vec4(col, 1.0);
      #include <fog_fragment>
    }`,
})
Object.assign(waterMaterial.uniforms,atmo,{uBody:body,uSunLight:sunLight})
waterMaterial.uniforms.tMirror.value = mirrorTarget.texture
waterMaterial.uniforms.textureMatrix.value = textureMatrix

type WaterPatch = {x:number; z:number; level:number; box:THREE.Box3}
type FarWaterPatch = {box:THREE.Box3; hidden:boolean}
const live = new Set<WaterPatch>()
let farPatches:FarWaterPatch[] = []

function finish(positions:Float32Array, level:number, x:number, z:number) {
  if(!positions.length) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3))
  geometry.computeBoundingSphere()
  const mesh = new THREE.Mesh(geometry,waterMaterial)
  mesh.layers.set(WATER_LAYER); mesh.userData.level = level; mesh.position.set(x,0,z)
  return mesh
}

// Per-chunk water from the GL0x 65×65 water grid (4 m): a flat quad at the water level for every cell
// touching a wet sample. Positions are shifted into world space so Stream's ChunkBatcher draws all
// loaded river/lake tiles in one draw call.
export function chunkWater(water:Int16Array, x:number, z:number) {
  const positions:number[] = [], counts = new Map<number,number>()
  let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity, minZ=Infinity, maxZ=-Infinity
  for(let row=0;row<64;row++) for(let col=0;col<64;col++) {
    let level = -Infinity, wet = 0
    for(const at of [row*65+col,row*65+col+1,(row+1)*65+col,(row+1)*65+col+1]) if(water[at]!==-32768) {wet++; level = Math.max(level,water[at]/10)}
    if(!wet) continue
    counts.set(level,(counts.get(level)??0)+1)
    const x0=x+col*4,z0=z+row*4,x1=x0+4,z1=z0+4
    if(x0<minX) minX=x0; if(x1>maxX) maxX=x1
    if(level<minY) minY=level; if(level>maxY) maxY=level
    if(z0<minZ) minZ=z0; if(z1>maxZ) maxZ=z1
    positions.push(x0,level,z0, x0,level,z1, x1,level,z0, x1,level,z0, x0,level,z1, x1,level,z1)
  }
  if(!positions.length) return null
  const dominant = [...counts].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? 0
  const box = new THREE.Box3(new THREE.Vector3(minX,minY-.5,minZ),new THREE.Vector3(maxX,maxY+.5,maxZ))
  const patch:WaterPatch = {x, z, level:dominant, box}
  live.add(patch)
  return {positions:Float32Array.from(positions), level:dominant, dispose(){live.delete(patch)}}
}

const srgbLut = Float32Array.from({length:256},(_,i)=>{
  const c = i/255
  return c<=.04045 ? c/12.92 : Math.pow((c+.055)/1.055,2.4)
})

// Far water under the overview terrain: water pixels of overview.png (4 m/px) decide which 32 m cells
// hold water; the underlay grid equals the water level there. Cells under a loaded chunk are hidden.
export async function farWater(manifest:{extent:[number,number,number,number],chunkSize:number,overview:{step:number}}, bitmap:ImageBitmap, underlay:Int16Array) {
  const [left,top,width,depth] = manifest.extent, step = manifest.overview.step, cols = width/step, rows = depth/step
  const canvas = new OffscreenCanvas(bitmap.width,bitmap.height), ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap,0,0); bitmap.close()
  const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data, px = canvas.width/width
  const target = new THREE.Color(look.waterBaked), tr = target.r, tg = target.g, tb = target.b
  const cw = canvas.width, ch = canvas.height
  const wet = (x:number,z:number)=>{
    const i = ((z*px|0)<ch ? (z*px|0) : ch-1)*cw + ((x*px|0)<cw ? (x*px|0) : cw-1) << 2
    return Math.abs(srgbLut[pixels[i]]-tr)+Math.abs(srgbLut[pixels[i+1]]-tg)+Math.abs(srgbLut[pixels[i+2]]-tb)<.06
  }
  const per = manifest.chunkSize/step, positions:number[] = [], ranges = new Map<string,[number,number,FarWaterPatch|null]>()
  const nextFar:FarWaterPatch[] = []
  for(let tz=0;tz<rows;tz+=per) for(let tx=0;tx<cols;tx+=per) {
    const start = positions.length/3
    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity, minZ=Infinity, maxZ=-Infinity
    for(let row=tz;row<Math.min(rows,tz+per);row++) for(let col=tx;col<Math.min(cols,tx+per);col++) {
      const r0 = row*(cols+1)+col, r1 = (row+1)*(cols+1)+col
      const level = Math.min(underlay[r0],underlay[r0+1],underlay[r1],underlay[r1+1])/10
      // 8 m sub-cells (2×2 texels each) so the far river follows its banks instead of 32 m stairs.
      for(let sz=0;sz<step;sz+=8) for(let sx=0;sx<step;sx+=8) {
        const x0=col*step+sx,z0=row*step+sz,x1=x0+8,z1=z0+8
        if(!wet(x0+2,z0+2)&&!wet(x0+6,z0+6)) continue
        if(left+x0<minX) minX=left+x0; if(left+x1>maxX) maxX=left+x1
        if(level<minY) minY=level; if(level>maxY) maxY=level
        if(top+z0<minZ) minZ=top+z0; if(top+z1>maxZ) maxZ=top+z1
        positions.push(x0,level,z0, x0,level,z1, x1,level,z0, x1,level,z0, x0,level,z1, x1,level,z1)
      }
    }
    const count = positions.length/3-start
    const fp:FarWaterPatch|null = count ? {box:new THREE.Box3(new THREE.Vector3(minX,minY-.5,minZ),new THREE.Vector3(maxX,maxY+.5,maxZ)), hidden:false} : null
    if(fp) nextFar.push(fp)
    ranges.set(`${left+tx*step},${top+tz*step}`,[start,count,fp])
  }
  farPatches = nextFar
  const original = Float32Array.from(positions)
  const mesh = finish(original.slice(),148,left,top)!
  const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
  return {mesh,toggle(tile:{x:number,z:number},show:boolean){
    const range = ranges.get(`${tile.x},${tile.z}`); if(!range||!range[1]) return
    const [from,count,fp] = range, array = attr.array as Float32Array
    if(fp) fp.hidden = !show
    if(show) array.set(original.subarray(from*3,(from+count)*3),from*3); else array.fill(0,from*3,(from+count)*3)
    attr.addUpdateRange(from*3,count*3); attr.needsUpdate = true
  }}
}

// Mirror pass: reflect the camera in the plane y = level of the nearest loaded water, oblique-clip
// below it, render at half resolution into the mirror target.
const mirrorCamera = new THREE.PerspectiveCamera(), clip = new THREE.Plane(), q = new THREE.Vector4(), c4 = new THREE.Vector4()
const size = new THREE.Vector2(), target = new THREE.Vector3(), forward = new THREE.Vector3()
const mainFrustum = new THREE.Frustum(), mainProj = new THREE.Matrix4()
let level = 148
export function isWaterInView(camera:THREE.PerspectiveCamera) {
  camera.updateMatrixWorld()
  mainFrustum.setFromProjectionMatrix(mainProj.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse))
  for(const patch of live) if(mainFrustum.intersectsBox(patch.box)) return true
  for(const fp of farPatches) if(!fp.hidden && mainFrustum.intersectsBox(fp.box)) return true
  return false
}
export function currentMirrorLevel(camera:THREE.PerspectiveCamera) {
  let best = Infinity
  for(const patch of live) {
    const d = patch.x+128-camera.position.x, e = patch.z+128-camera.position.z, dist = d*d+e*e
    if(dist<best){best=dist;level=patch.level}
  }
  return level
}
// skip: the first frame is budgeted (≤2 s), so the mirror starts one frame later with a sky-tint fallback.
export function renderMirror(renderer:THREE.WebGLRenderer, scene:THREE.Scene, camera:THREE.PerspectiveCamera, skip=false) {
  body.value.copy(env.water).convertLinearToSRGB()
  sunLight.value.copy(atmo.uSunColor.value).convertLinearToSRGB()
  if(env.night>.5) sunLight.value.setRGB(.5,.55,.65).multiplyScalar(env.night*.6)
  currentMirrorLevel(camera)
  waterMaterial.uniforms.uMirrorLevel.value = level
  if(skip||camera.position.y<level+.2||camera.position.y>4000||!isWaterInView(camera)) {waterMaterial.uniforms.uMirrorReady.value = 0; return}
  waterMaterial.uniforms.uMirrorReady.value = 1
  renderer.getDrawingBufferSize(size)
  const w = Math.max(1,Math.round(size.x*.5)), h = Math.max(1,Math.round(size.y*.5))
  if(mirrorTarget.width!==w||mirrorTarget.height!==h) mirrorTarget.setSize(w,h)
  camera.updateMatrixWorld()
  mirrorCamera.position.set(camera.position.x,2*level-camera.position.y,camera.position.z)
  camera.getWorldDirection(forward)
  target.copy(camera.position).add(forward); target.y = 2*level-target.y
  mirrorCamera.up.set(0,1,0).applyQuaternion(camera.quaternion); mirrorCamera.up.y *= -1
  mirrorCamera.lookAt(target)
  mirrorCamera.far = camera.far; mirrorCamera.updateMatrixWorld()
  mirrorCamera.projectionMatrix.copy(camera.projectionMatrix)
  textureMatrix.set(.5,0,0,.5, 0,.5,0,.5, 0,0,.5,.5, 0,0,0,1)
  textureMatrix.multiply(mirrorCamera.projectionMatrix).multiply(mirrorCamera.matrixWorldInverse)
  // Oblique near plane = water plane (Lengyel), so nothing below the surface leaks into the reflection.
  clip.set(new THREE.Vector3(0,1,0),-level-.05).applyMatrix4(mirrorCamera.matrixWorldInverse)
  c4.set(clip.normal.x,clip.normal.y,clip.normal.z,clip.constant)
  const m = mirrorCamera.projectionMatrix.elements
  q.set((Math.sign(c4.x)+m[8])/m[0],(Math.sign(c4.y)+m[9])/m[5],-1,(1+m[10])/m[14])
  c4.multiplyScalar(2/c4.dot(q))
  m[2]=c4.x; m[6]=c4.y; m[10]=c4.z+1; m[14]=c4.w
  mirrorCamera.projectionMatrixInverse.copy(mirrorCamera.projectionMatrix).invert()
  mirrorCamera.layers.set(0)
  const previous = renderer.getRenderTarget()
  renderer.setRenderTarget(mirrorTarget); renderer.clear(); renderer.render(scene,mirrorCamera)
  renderer.setRenderTarget(previous)
}
