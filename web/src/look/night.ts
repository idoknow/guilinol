import * as THREE from 'three'
import {look} from './config'
import {shareAtmosphere} from './atmosphere'
import {atmo} from './time'

// M3 夜景: everything here is emissive driven by atmo.uNight (0 day → 1 night), so the same
// materials carry day and night; lights also show up in the water mirror for free.
const c = (v:number)=>new THREE.Color(v)
type Shader = THREE.WebGLProgramParametersWithUniforms

// 山体泛光: Guilin floodlights its hills at night. Warm or jade wash from the foot, fading by 40% height;
// colour picked per peak from its position so neighbouring hills differ.
export function nightPeaks(material:THREE.Material) {
  material.onBeforeCompile = (shader:Shader)=>{
    shareAtmosphere(shader)
    Object.assign(shader.uniforms,{uWarm:{value:c(look.peakUplightWarm)},uJade:{value:c(look.peakUplightJade)}})
    shader.vertexShader = shader.vertexShader.replace('#include <common>',`#include <common>
attribute float aHeight; attribute float aPick; varying float vUp; varying float vPick;`).replace('#include <begin_vertex>',`#include <begin_vertex>
vUp = aHeight; vPick = aPick;`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',`#include <common>
uniform float uNight; uniform vec3 uWarm; uniform vec3 uJade; varying float vUp; varying float vPick;`)
      .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
totalEmissiveRadiance += (vPick > .55 ? uJade : uWarm) * uNight * .09 * (1. - smoothstep(.0, .6, vUp)) * step(.25, vPick);`)
  }
  material.customProgramCacheKey = ()=>'guilinol-peaks-night'
}


// Phase 2 湿路面 (shared by street surfaces and landmark paving): rain darkens the ground; at night each
// lamp pool (22 m grid, \`cell\`/\`f\`) mirrors as a long streak pointing at the camera, half of them tinted
// by a neon colour. Needs vFogWorld, uRain, uNight, uLamp, uNeon[6] and \`flatG\` (1 on level ground).
const WET_GLSL = `if (uRain > .01) {
    diffuseColor.rgb *= mix(1., ${look.streets.wetDarken.toFixed(2)}, uRain);
    vec2 vd = normalize(vFogWorld.xz - cameraPosition.xz + 1e-4);
    float along = dot(f, vd), across = dot(f, vec2(-vd.y, vd.x));
    float near = 1. - smoothstep(60., 260., length(vFogWorld.xz - cameraPosition.xz));
    float streak = exp(-across * across / .0011) * smoothstep(-.48, -.12, along) * (1. - smoothstep(-.02, .06, along));
    float cellHash = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
    vec3 tint = cellHash > .5 ? uNeon[int(min(5., floor(fract(cellHash * 9.7) * 6.)))] : uLamp;
    totalEmissiveRadiance += tint * uRain * uNight * flatG * (streak * 1.2 * near + .01);
  }`

// Street surfaces: pools of sodium light every ~22 m plus a faint wash; lamp heads (the .32×.42 boxes
// in the street furniture batch) glow.
export function nightStreets(surface:THREE.Material, furniture:THREE.Material) {
  surface.onBeforeCompile = (shader:Shader)=>{
    shareAtmosphere(shader); shader.uniforms.uLamp = {value:c(look.roadLight)}
    shader.uniforms.uNeon = {value:look.buildings.neon.map(c)}
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',`#include <common>
uniform float uNight; uniform vec3 uLamp; uniform float uRain; uniform vec3 uNeon[6];`).replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
#ifdef USE_FOG
{ vec2 cell = floor(vFogWorld.xz / 22.), f = vFogWorld.xz / 22. - cell - .5;
  vec2 bridgeDelta=vFogWorld.xz-vec2(-1598.667,-184.880);
  float station=dot(bridgeDelta,vec2(.96815,.25038));
  if(vSurface<.5 && station>65. && station<71. && abs(dot(bridgeDelta,vec2(-.25038,.96815)))<7.4)
    diffuseColor.rgb=vec3(.37,.095,.075);
  float pool = 1. - smoothstep(.06, .4, length(f));
  // Only the walking surfaces catch lamp light; embankment faces stay dark.
  vec3 gn = normalize(cross(dFdx(vFogWorld), dFdy(vFogWorld)));
  float flatG = smoothstep(.75, .95, abs(gn.y));
  totalEmissiveRadiance += uLamp * uNight * (.055 + .42 * pool) * flatG * (1. - .35 * uRain * step(vSurface, 1.5));
  if (vSurface < 1.5) { ${WET_GLSL} }
  }
#endif`)
  }
  surface.customProgramCacheKey = ()=>'guilinol-street-night-3'
  furniture.onBeforeCompile = (shader:Shader)=>{
    shareAtmosphere(shader); shader.uniforms.uLamp = {value:c(look.roadLight)}
    shader.vertexShader = shader.vertexShader.replace('#include <common>',`#include <common>
varying float vLamp;`).replace('#include <begin_vertex>',`#include <begin_vertex>
vLamp = 0.;
#ifdef USE_INSTANCING
{ float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);
  vLamp = step(abs(sx - .32), .02) * step(abs(sy - .42), .02); }
#endif`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',`#include <common>
uniform float uNight; uniform vec3 uLamp; varying float vLamp;`).replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
totalEmissiveRadiance += uLamp * uNight * vLamp * 4.;`)
  }
  furniture.customProgramCacheKey = ()=>'guilinol-furniture-night'
}

// Overview / chunk ground textures: baked road colour lights up faintly so the far city reads as a
// grid of streets at night.
const road = c(0xd8d2c1)
export function nightGround(material:THREE.Material) {
  material.onBeforeCompile = (shader:Shader)=>{
    shareAtmosphere(shader); Object.assign(shader.uniforms,{uRoad:{value:road},uLamp:{value:c(look.roadLight)},
      uBaked:{value:c(look.waterBaked)},uBank:{value:c(look.waterBank)}})
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',`#include <common>
uniform float uNight; uniform vec3 uRoad; uniform vec3 uLamp; uniform vec3 uBaked; uniform vec3 uBank;`).replace('#include <map_fragment>',`#include <map_fragment>
// The real water surface (look/water.ts) covers the river; baked water texels that still show are on
// the bank slope, so paint them as wet earth instead of a teal fringe.
{ vec3 w = abs(diffuseColor.rgb - uBaked); diffuseColor.rgb = mix(uBank, diffuseColor.rgb, smoothstep(.03, .1, w.r + w.g + w.b)); }`).replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
{ vec3 d = abs(diffuseColor.rgb - uRoad); float isRoad = 1. - smoothstep(.04, .12, d.r + d.g + d.b);
  totalEmissiveRadiance += uLamp * uNight * isRoad * .12; }`)
  }
  material.customProgramCacheKey = ()=>'guilinol-ground-night'
}

// 桥灯: aEdge is 1 along the top of each bridge fascia → a row of lamps every 4 m plus a warm wash.
export function nightBridge(material:THREE.Material) {
  material.onBeforeCompile = (shader:Shader)=>{
    shareAtmosphere(shader); shader.uniforms.uLamp = {value:c(look.bridgeLamp)}
    shader.vertexShader = shader.vertexShader.replace('#include <common>',`#include <common>
attribute float aEdge; varying float vEdge;`).replace('#include <begin_vertex>',`#include <begin_vertex>
vEdge = aEdge;`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',`#include <common>
uniform float uNight; uniform vec3 uLamp; varying float vEdge;`).replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
#ifdef USE_FOG
{ float along = fract((vFogWorld.x + vFogWorld.z) / 4.);
  if(vEdge < -.5 && distance(vFogWorld.xz,vec2(-1598.667,-184.880)) < 80.) {
    vec2 delta=vFogWorld.xz-vec2(-1598.667,-184.880);
    vec2 axis=vec2(.96815,.25038);
    float across=dot(delta,vec2(-axis.y,axis.x));
    float stripe=abs(mod(across+1.8,3.6)-1.8);
    if(abs(across)<6. && stripe<.09 && mod(dot(delta,axis),8.)<4.) diffuseColor.rgb=vec3(.8);
  }
  float lamp = smoothstep(.82, .95, vEdge) * (1. - smoothstep(.08, .2, abs(along - .5)));
  totalEmissiveRadiance += uLamp * uNight * (lamp * 3. + max(vEdge,0.) * max(vEdge,0.) * .3); }
#endif`)
  }
  material.customProgramCacheKey = ()=>'guilinol-bridge-night'
}
// Landmark materials named `*_lit` carry an emissive factor. Day stays unlit; night multiplies it by uNight.
export function nightLit(material:THREE.Material) {
  // Phase 2: landmark sign atlases (`*_signs`) light up in their own colours as neon at night;
  // curtain glass gets a faint interior glow so commercial blocks are not black slabs.
  const name = material.name ?? ''
  if(/_signs$/i.test(name) || /curtain_glass$/i.test(name)) {
    const gain = /_signs$/i.test(name) ? 2.4 : .35
    material.onBeforeCompile = (shader:Shader)=>{
      shareAtmosphere(shader)
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>',`#include <common>
uniform float uNight;`).replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
totalEmissiveRadiance += pow(diffuseColor.rgb, vec3(1.25)) * uNight * ${gain.toFixed(2)};`)
    }
    material.customProgramCacheKey = ()=>`guilinol-neon-${gain}`
    return
  }
  if(/(^|_)(surfaces|pave|atlas)$/i.test(name)) { landmarkNight(material); return }
  if(!name.endsWith('_lit')) return
  material.onBeforeCompile = (shader:Shader)=>{
    shareAtmosphere(shader)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',`#include <common>
uniform float uNight;`).replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
totalEmissiveRadiance *= uNight;`)
  }
  material.customProgramCacheKey = ()=>'guilinol-lit'
}

export {atmo}

// Phase 2: landmark atlas materials (A_/B_surfaces, paving, *_atlas) join the street night — level faces get
// the same lamp pools and wet streaks as the streets; dark glazing texels on walls light warm per 3 m cell
// so modelled frontages read as an inhabited street instead of black slabs.
function landmarkNight(material:THREE.Material) {
  material.onBeforeCompile = (shader:Shader)=>{
    shareAtmosphere(shader)
    Object.assign(shader.uniforms,{uLamp:{value:c(look.roadLight)},uNeon:{value:look.buildings.neon.map(c)},uWarm:{value:c(look.buildings.windowWarm)}})
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',`#include <common>
uniform float uNight; uniform vec3 uLamp; uniform float uRain; uniform vec3 uNeon[6]; uniform vec3 uWarm;`).replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
#ifdef USE_FOG
{ vec2 cell = floor(vFogWorld.xz / 22.), f = vFogWorld.xz / 22. - cell - .5;
  vec3 gn = normalize(cross(dFdx(vFogWorld), dFdy(vFogWorld)));
  float flatG = smoothstep(.75, .95, abs(gn.y));
  float pool = 1. - smoothstep(.06, .4, length(f));
  totalEmissiveRadiance += uLamp * uNight * (.045 + .36 * pool) * flatG * (1. - .35 * uRain);
  if (flatG > .5) { ${WET_GLSL} }
  else {
    float lum = dot(diffuseColor.rgb, vec3(.299, .587, .114));
    float glazing = (1. - smoothstep(.1, .17, lum)) * step(diffuseColor.r + .03, diffuseColor.b);
    vec3 wc = floor(vec3(vFogWorld.x + vFogWorld.z, vFogWorld.y, vFogWorld.x - vFogWorld.z) / 3.);
    float lit = step(.5, fract(sin(dot(wc, vec3(12.9898, 78.233, 37.719))) * 43758.5453));
    totalEmissiveRadiance += uWarm * uNight * glazing * lit * .7;
  } }
#endif`)
  }
  material.customProgramCacheKey = ()=>'guilinol-landmark-night-2'
}
