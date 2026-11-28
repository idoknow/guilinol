import * as THREE from 'three'
import {shareAtmosphere} from './atmosphere'

type Shader = THREE.WebGLProgramParametersWithUniforms

// Liangjiang Airport look (IDOK-514). The generated GLBs keep neutral material slots;
// the final palette lives here so it can be tuned without rebuilding the landmarks.
// Reference: BIAD T2 render (white layered aluminium shells over pale blue-grey glazing)
// and 2014 airside photos (silver-grey aluminium cladding).
const tones:Record<string,{color:string,roughness:number,metalness:number}> = {
  airport_roof_metal:{color:'#f1f2ef',roughness:.38,metalness:.18},
  airport_structure:{color:'#c4cacb',roughness:.5,metalness:.22},
  airport_concrete:{color:'#d6d6d0',roughness:.8,metalness:0},
  airport_red:{color:'#b42f31',roughness:.55,metalness:0},
  airport_door:{color:'#9aa6aa',roughness:.45,metalness:.3},
}

/** Returns true when the material was fully handled (caller must skip nightLit). */
export function airportLook(material:THREE.Material):boolean {
  const name = material.name ?? ''
  if(!name.startsWith('airport_') || !(material instanceof THREE.MeshStandardMaterial)) return false
  const tone = tones[name]
  if(tone){
    material.color.set(tone.color)
    material.roughness = tone.roughness
    material.metalness = tone.metalness
    return false
  }
  if(name !== 'airport_glass_lit') return false
  // Curtain wall: pale sky-tinted glazing by day (a cheap reflection term that brightens
  // toward the top of each pane row), warm interior light by night.
  material.color.set('#9fbccb')
  material.roughness = .22
  material.metalness = .1
  material.onBeforeCompile = (shader:Shader)=>{
    shareAtmosphere(shader)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',`#include <common>
uniform float uNight;`).replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
float skyFacing = clamp(normal.y * .5 + .5, 0., 1.);
vec3 skyGlint = mix(vec3(.30,.39,.45), vec3(.52,.62,.68), skyFacing);
totalEmissiveRadiance = totalEmissiveRadiance * uNight + skyGlint * .32 * (1. - uNight);`)
  }
  material.customProgramCacheKey = ()=>'guilinol-airport-glass'
  return true
}
