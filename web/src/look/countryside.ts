import * as THREE from 'three'
import {look} from './config'
import {inRegion, type Region} from '../../../lib/play-region'

type Shader = THREE.WebGLProgramParametersWithUniforms
const c = (hex:number)=>new THREE.Color(hex)

// IDOK-200 区外郊野. Outside the play region nothing is built, so the ground would show the bare
// baked plain. Paint it as 桂林 countryside instead — a patchwork of paddy / fallow / vegetable
// plots with clumps of wood — fading in over ~150 m beyond the smooth region boundary, so the
// edge reads as "town gives way to fields". The same pass runs on the overview terrain and on
// boundary chunks (whose square tiles extend past the polygon), keyed by world position, so the
// visible edge follows the polygon rather than the 256 m tile grid.
let shared: {uniforms:Record<string,THREE.IUniform>; region:Region; chunk:number} | null = null

function regionMask(region:Region, extent:[number,number,number,number], step:number) {
  const [left,top,width,depth] = extent
  // 32 m per texel; the blur gives the ~150 m fade.
  const w = Math.round(width/step*4), h = Math.round(depth/step*4)
  const canvas = new OffscreenCanvas(w,h)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'; ctx.fillRect(0,0,w,h)
  ctx.filter = 'blur(2.5px)'
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  region.local.forEach(([x,z],i)=>{
    const px=(x-left)/width*w, py=(z-top)/depth*h
    if(i)ctx.lineTo(px,py); else ctx.moveTo(px,py)
  })
  ctx.closePath(); ctx.fill()
  const texture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement)
  texture.colorSpace = THREE.NoColorSpace
  texture.minFilter = texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  return texture
}

export function setupCountryside(region:Region, extent:[number,number,number,number], step:number, chunk:number) {
  const p = look.countryside
  shared = {region, chunk, uniforms:{
    uRegion:{value:regionMask(region,extent,step)},
    uRegionBox:{value:new THREE.Vector4(extent[0],extent[1],extent[2],extent[3])},
    uPaddy:{value:c(p.paddy)}, uPaddyYoung:{value:c(p.paddyYoung)}, uFallow:{value:c(p.fallow)},
    uVeg:{value:c(p.vegetable)}, uWood:{value:c(p.wood)}, uWoodDark:{value:c(p.woodDark)},
  }}
}

// Chunks wholly inside the polygon never show countryside; skip the extra shader work there.
export function touchesCountryside(x:number, z:number) {
  if(!shared)return false
  const s=shared.chunk, pad=200
  for(const [dx,dz] of [[-pad,-pad],[s+pad,-pad],[-pad,s+pad],[s+pad,s+pad],[s/2,-pad],[s/2,s+pad],[-pad,s/2],[s+pad,s/2]])
    if(!inRegion({bbox:[0,0,0,0],region:shared.region},x+dx,z+dz))return true
  return false
}

export function countryside(material:THREE.Material) {
  if(!shared)return
  const uniforms = shared.uniforms
  const base = material.onBeforeCompile.bind(material)
  material.onBeforeCompile = (shader:Shader, renderer)=>{
    base(shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',`#include <common>
uniform sampler2D uRegion; uniform vec4 uRegionBox;
uniform vec3 uPaddy, uPaddyYoung, uFallow, uVeg, uWood, uWoodDark;
float csHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float csNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(csHash(i), csHash(i+vec2(1,0)), f.x), mix(csHash(i+vec2(0,1)), csHash(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <map_fragment>',`#include <map_fragment>
#ifdef USE_FOG
{ vec2 w = vFogWorld.xz;
  vec2 ruv = (w - uRegionBox.xy) / uRegionBox.zw;
  float outside = 1. - smoothstep(.08, .5, texture2D(uRegion, vec2(ruv.x, 1. - ruv.y)).r);
  if(outside > 0.) {
    // Plots on a slightly rotated, gently warped grid; each field picks a crop from its hash.
    vec2 q = mat2(.94, -.34, .34, .94) * w / vec2(110., 70.);
    vec2 cell = floor(q + .45 * vec2(csNoise(w/520.), csNoise(w/520. + 9.)));
    float h = csHash(cell);
    vec3 crop = h < .42 ? uPaddy : h < .68 ? uPaddyYoung : h < .88 ? uVeg : uFallow;
    crop *= .95 + .1 * csHash(cell + 3.1);
    // Field fade with distance so far plots melt into one green rather than shimmering.
    float far = smoothstep(1500., 4500., length(w - cameraPosition.xz));
    crop = mix(crop, (uPaddy + uPaddyYoung + uVeg) / 3., far * .7);
    // Wood clumps: villages' 风水林 and hedgerows on a slow noise field.
    float wood = smoothstep(.5, .6, csNoise(w/380.) * .6 + csNoise(w/110.) * .4);
    // Fields only on the flat valley floor; slopes and hilltops are wooded.
    vec3 fn = normalize(cross(dFdx(vFogWorld), dFdy(vFogWorld)));
    wood = max(wood, smoothstep(.06, .16, 1. - abs(fn.y)));
    vec3 trees = mix(uWoodDark, uWood, csNoise(w/35.));
    vec3 land = mix(crop, trees, wood);
    // Keep baked water (the bank pass below relies on it).
    vec3 d = abs(diffuseColor.rgb - uBaked);
    float keep = 1. - smoothstep(.03, .1, d.r + d.g + d.b);
    diffuseColor.rgb = mix(diffuseColor.rgb, land, outside * (1. - keep));
  } }
#endif`)
  }
  const key = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = ()=>key()+'-countryside'
}
