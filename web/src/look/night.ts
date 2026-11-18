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

// Street surfaces: pools of sodium light every ~22 m plus a faint wash; lamp heads (the .32×.42 boxes
// in the street furniture batch) glow.
export function nightStreets(surface:THREE.Material, furniture:THREE.Material) {
  surface.onBeforeCompile = (shader:Shader)=>{
    shareAtmosphere(shader); shader.uniforms.uLamp = {value:c(look.roadLight)}
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',`#include <common>
uniform float uNight; uniform vec3 uLamp;`).replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
#ifdef USE_FOG
{ vec2 cell = floor(vFogWorld.xz / 22.), f = vFogWorld.xz / 22. - cell - .5;
  float pool = 1. - smoothstep(.05, .32, length(f));
  // Only the walking surfaces catch lamp light; embankment faces stay dark.
  vec3 gn = normalize(cross(dFdx(vFogWorld), dFdy(vFogWorld)));
  totalEmissiveRadiance += uLamp * uNight * (.035 + .2 * pool) * smoothstep(.75, .95, abs(gn.y)); }
#endif`)
  }
  surface.customProgramCacheKey = ()=>'guilinol-street-night'
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
totalEmissiveRadiance += uLamp * uNight * vLamp * 2.2;`)
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
  float lamp = smoothstep(.82, .95, vEdge) * (1. - smoothstep(.08, .2, abs(along - .5)));
  totalEmissiveRadiance += uLamp * uNight * (lamp * 3. + vEdge * vEdge * .3); }
#endif`)
  }
  material.customProgramCacheKey = ()=>'guilinol-bridge-night'
}
export {atmo}
