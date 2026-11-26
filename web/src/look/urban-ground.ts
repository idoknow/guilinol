import * as THREE from 'three'
import {look} from './config'
import palette from '../../../pipeline/palette.json'

// IDOK-432: World-space urban ground, riverbank & slope PBR detail system.
// Eliminates flat untextured khaki bare ground (#b3b19c) and raw embankments across all 256m chunks
// and the overview terrain with 0 extra draw calls, seamless world-space coordinates (vFogWorld.xz),
// pure opaque RGB (A=255) mipmapped DataTexture, and strict preservation of out-of-region countryside.

type Shader = THREE.WebGLProgramParametersWithUniforms
const c = (hex:number|string)=>new THREE.Color(hex)

function readInitialEnabled():boolean {
  if(typeof location === 'undefined') return true
  const raw = new URLSearchParams(location.search).get('groundUpgrade')
  if(raw === '0' || raw === 'false') return false
  return true
}

export const groundUpgradeUniforms = {
  uGroundUpgrade: {value: readInitialEnabled() ? 1.0 : 0.0},
}

export function setGroundUpgradeEnabled(on:boolean):void {
  groundUpgradeUniforms.uGroundUpgrade.value = on ? 1.0 : 0.0
}

export function isGroundUpgradeEnabled():boolean {
  return groundUpgradeUniforms.uGroundUpgrade.value > 0.5
}

// Expose a lightweight test/QA handle for headless Before/After comparison without touching main.ts.
if(typeof globalThis !== 'undefined') {
  ;(globalThis as Record<string,unknown>).__glolGroundUpgrade = {
    isEnabled: isGroundUpgradeEnabled,
    setEnabled: setGroundUpgradeEnabled,
  }
}

// Fast deterministic integer hash for tileable periodic value noise (pure JS, works in Node & browser).
function ihash(x:number, y:number, seed:number):number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

function addPeriodicOctave(
  out:Float32Array,
  size:number,
  freqX:number,
  freqY:number,
  amp:number,
  seed:number,
):void {
  const grid = new Float32Array(freqX * freqY)
  for(let gy = 0; gy < freqY; gy++) {
    for(let gx = 0; gx < freqX; gx++) {
      grid[gy * freqX + gx] = ihash(gx, gy, seed) - 0.5
    }
  }
  const ix0 = new Uint16Array(size), ix1 = new Uint16Array(size), fx = new Float32Array(size)
  for(let x = 0; x < size; x++) {
    const u = (x * freqX) / size
    const i = Math.floor(u)
    const t = u - i
    ix0[x] = i % freqX
    ix1[x] = (i + 1) % freqX
    fx[x] = t * t * (3 - 2 * t)
  }
  for(let y = 0; y < size; y++) {
    const v = (y * freqY) / size
    const j = Math.floor(v)
    const t = v - j
    const fy = t * t * (3 - 2 * t)
    const r0 = (j % freqY) * freqX
    const r1 = ((j + 1) % freqY) * freqX
    const row = y * size
    for(let x = 0; x < size; x++) {
      const a = grid[r0 + ix0[x]], b = grid[r0 + ix1[x]]
      const d = grid[r1 + ix0[x]], e = grid[r1 + ix1[x]]
      const top = a + (b - a) * fx[x]
      const bot = d + (e - d) * fx[x]
      out[row + x] += (top + (bot - top) * fy) * amp
    }
  }
}

let cachedTex:THREE.DataTexture | null = null

// Shared 512x512 pure-opaque (A=255) 3-channel detail texture (1 MB VRAM, 0 network requests):
//   R: concrete / granite sand aggregate grain (urban setbacks, bridge deck, asphalt micro-grit)
//   G: organic turf / grass blade tufts & soil mottling (parks, green belts, median strips)
//   B: rough stratified limestone / embankment cobble & cast-concrete formwork grain (slopes, banks, bridge fascia)
//   A: 255 everywhere (never premultiplied, Metal/ANGLE & mobile mipmap safe)
export function sharedGroundDetailTexture():THREE.DataTexture {
  if(cachedTex) return cachedTex
  const size = 512
  const count = size * size
  const stone = new Float32Array(count)
  const grass = new Float32Array(count)
  const rock = new Float32Array(count)

  // R: brushed stone & fine quartz sand aggregate
  addPeriodicOctave(stone, size, 8, 8, 0.24, 11)
  addPeriodicOctave(stone, size, 24, 24, 0.22, 29)
  addPeriodicOctave(stone, size, 64, 64, 0.22, 53)
  addPeriodicOctave(stone, size, 128, 128, 0.18, 97)

  // G: subtropical turf tufts + subtle directional blade clumps + soil dapples
  addPeriodicOctave(grass, size, 6, 6, 0.28, 131)
  addPeriodicOctave(grass, size, 16, 16, 0.24, 173)
  addPeriodicOctave(grass, size, 48, 32, 0.20, 227)
  addPeriodicOctave(grass, size, 128, 96, 0.22, 281)

  // B: horizontally stratified karst limestone / wet embankment / concrete pour texture
  addPeriodicOctave(rock, size, 6, 12, 0.30, 311)
  addPeriodicOctave(rock, size, 16, 36, 0.26, 359)
  addPeriodicOctave(rock, size, 48, 96, 0.22, 419)
  addPeriodicOctave(rock, size, 96, 128, 0.16, 467)

  const rgba = new Uint8Array(count * 4)
  for(let y = 0; y < size; y++) {
    const row = y * size
    for(let x = 0; x < size; x++) {
      const i = row + x
      // Add crisp single-texel micro-grit (mean-zero) so close-up views stay tactile without blotchiness
      const gritR = (ihash(x, y, 521) - 0.5) * 0.18
      const gritG = (ihash(x, y, 613) - 0.5) * 0.16
      const gritB = (ihash(x, y, 709) - 0.5) * 0.14
      const r = Math.max(0.08, Math.min(0.92, 0.5 + stone[i] * 0.85 + gritR))
      const g = Math.max(0.08, Math.min(0.92, 0.5 + grass[i] * 0.88 + gritG))
      const b = Math.max(0.08, Math.min(0.92, 0.5 + rock[i] * 0.90 + gritB))
      const o = i * 4
      rgba[o] = Math.round(r * 255)
      rgba[o + 1] = Math.round(g * 255)
      rgba[o + 2] = Math.round(b * 255)
      rgba[o + 3] = 255
    }
  }

  const tex = new THREE.DataTexture(rgba, size, size, THREE.RGBAFormat, THREE.UnsignedByteType)
  tex.colorSpace = THREE.NoColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.anisotropy = 4
  tex.needsUpdate = true
  cachedTex = tex
  return tex
}

let sharedUniforms:Record<string,THREE.IUniform> | null = null
function getUrbanGroundUniforms():Record<string,THREE.IUniform> {
  if(sharedUniforms) return sharedUniforms
  const ug = look.urbanGround
  sharedUniforms = {
    uUgTex: {value: sharedGroundDetailTexture()},
    uGroundUpgrade: groundUpgradeUniforms.uGroundUpgrade,
    uUgGround: {value: c(palette.ground)},
    uUgGreen: {value: c(palette.green)},
    uUgTrack: {value: c(palette.schoolTrack)},
    uUgCourt: {value: c(palette.schoolCourt)},
    uUgYard: {value: c('#bdbcb5')},
    uUgBareA: {value: c(ug.bareA)},
    uUgBareB: {value: c(ug.bareB)},
    uUgGrassA: {value: c(ug.grassA)},
    uUgGrassB: {value: c(ug.grassB)},
    uUgSoil: {value: c(ug.soil)},
    uUgRockA: {value: c(ug.rockA)},
    uUgRockB: {value: c(ug.rockB)},
  }
  return sharedUniforms
}

// Mount onto urban chunk terrain and overview terrain (call AFTER countryside(material) when present).
export function urbanGround(material:THREE.Material):void {
  const previous = material.onBeforeCompile
  const cache = material.customProgramCacheKey()
  material.customProgramCacheKey = ()=>cache + '-urban-ground-1'
  material.onBeforeCompile = function(shader:Shader, renderer) {
    previous.call(this, shader, renderer)
    Object.assign(shader.uniforms, getUrbanGroundUniforms())
    const hasCountryside = Boolean(shader.uniforms.uRegion)
    const needRainDecl = !shader.fragmentShader.includes('uniform float uRain')

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vUgNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUgNormal = normalize(mat3(modelMatrix) * objectNormal);')

    const insideExpr = hasCountryside
      ? `vec2 ugRuv = (ugW - uRegionBox.xy) / uRegionBox.zw;
         float ugInside = smoothstep(0.08, 0.5, texture2D(uRegion, vec2(ugRuv.x, 1.0 - ugRuv.y)).r);`
      : `float ugInside = 1.0;`

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uUgTex;
uniform float uGroundUpgrade;
${needRainDecl ? 'uniform float uRain;' : ''}
uniform vec3 uUgGround, uUgGreen, uUgTrack, uUgCourt, uUgYard;
uniform vec3 uUgBareA, uUgBareB, uUgGrassA, uUgGrassB, uUgSoil, uUgRockA, uUgRockB;
varying vec3 vUgNormal;
float ugBumpH;
float ugRoughShift;
float ugHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ugMacro(vec2 p){
  float a = sin(p.x * 0.73 + p.y * 0.51) * cos(p.y * 0.67 - p.x * 0.43);
  float b = sin(p.x * 1.91 - p.y * 1.37 + 1.4) * cos(p.x * 1.13 + p.y * 1.79);
  return a * 0.62 + b * 0.38;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
ugBumpH = 0.0;
ugRoughShift = 0.0;
#ifdef USE_FOG
if (uGroundUpgrade > 0.5) {
  vec2 ugW = vFogWorld.xz;
  // Compute world-space pixel footprint once unconditionally to avoid quad derivative divergence.
  vec2 ugFw = max(fwidth(ugW), vec2(0.002));
  ${insideExpr}
  if (ugInside > 0.001) {
    float ugDist = length(vFogWorld - cameraPosition);
    float ugMicroFade = 1.0 - smoothstep(140.0, 380.0, ugDist);
    float ugJointFade = 1.0 - smoothstep(24.0, 82.0, ugDist);
    float ugBumpFade  = 1.0 - smoothstep(26.0, 105.0, ugDist);

    vec3 baseRgb = diffuseColor.rgb;
    float dGround = length(baseRgb - uUgGround);
    float dYard   = length(baseRgb - uUgYard);
    float dRoad   = length(baseRgb - uRoad);
    float dGreen  = length(baseRgb - uUgGreen);
    float dBank   = length(baseRgb - uBank);
    float dTrack  = length(baseRgb - uUgTrack);
    float dCourt  = length(baseRgb - uUgCourt);

    float wTrack = 1.0 - smoothstep(0.04, 0.14, dTrack);
    float wCourt = 1.0 - smoothstep(0.04, 0.14, dCourt);
    float wSpecial = clamp(wTrack + wCourt, 0.0, 1.0);
    float wGreen = (1.0 - smoothstep(0.05, 0.19, dGreen)) * (1.0 - wSpecial);
    float wBank  = (1.0 - smoothstep(0.04, 0.16, dBank)) * (1.0 - wSpecial);
    // Keep baked road underlay untouched beyond 270m so overview distant night street-grid glow stays intact.
    float nearRoadFade = 1.0 - smoothstep(150.0, 270.0, ugDist);
    float wRoadNear = (1.0 - smoothstep(0.04, 0.15, dRoad)) * nearRoadFade * (1.0 - wSpecial);
    float wYard = (1.0 - smoothstep(0.04, 0.14, dYard)) * (1.0 - wSpecial);
    float wBare = clamp((1.0 - smoothstep(0.05, 0.21, dGround)) + wYard * 0.78 + wRoadNear * 0.85, 0.0, 1.0)
      * (1.0 - wGreen) * (1.0 - wBank) * (1.0 - wSpecial);

    // Smooth vertex normal avoids low-poly triangle faceting on riverbanks and slopes.
    float ny = clamp(abs(normalize(vUgNormal).y), 0.0, 1.0);
    float slopeMid   = smoothstep(0.976, 0.905, ny);
    float slopeSteep = smoothstep(0.910, 0.770, ny);

    float m1 = ugMacro(ugW * 0.038);
    float m2 = ugMacro(ugW * 0.125 + 6.7);
    float macro01 = clamp(0.5 + 0.34 * m1 + 0.18 * m2, 0.0, 1.0);

    float gStone = 0.5, gGrass = 0.5, gRock = 0.5;
    if (ugMicroFade > 0.001) {
      vec3 tFine = texture2D(uUgTex, ugW / 5.4).rgb;
      vec2 rotW = mat2(0.8, -0.6, 0.6, 0.8) * ugW;
      vec3 tCoarse = texture2D(uUgTex, rotW / 17.3).rgb;
      gStone = mix(0.5, tFine.r * 0.68 + tCoarse.r * 0.32, ugMicroFade);
      gGrass = mix(0.5, tFine.g * 0.66 + tCoarse.g * 0.34, ugMicroFade);
      // Side-projected coords on steep embankments prevent vertical UV stretching.
      vec2 rockUvSlope = vec2((ugW.x + ugW.y) * 0.7071 / 6.2, vFogWorld.y / 3.0);
      float rockSlope = texture2D(uUgTex, rockUvSlope).b;
      float rockBlend = mix(tFine.b, rockSlope, max(slopeSteep, wBank * 0.65)) * 0.72 + tCoarse.b * 0.28;
      gRock = mix(0.5, rockBlend, ugMicroFade);
    }

    // 1. Urban hardened paving / building setbacks (replaces flat yellow-beige #b3b19c)
    // Restrained architectural 3.2m x 2.4m cast-concrete/granite slabs (faded on slopes so joints never stretch)
    vec3 urbanCol = mix(uUgBareA, uUgBareB, macro01);
    float jointDark = 0.0;
    float slabTone = 0.0;
    float flatJointMask = (1.0 - slopeMid) * ugJointFade;
    if (flatJointMask > 0.001) {
      vec2 pCell = ugW / vec2(3.2, 2.4);
      pCell.x += 0.5 * mod(floor(pCell.y), 2.0);
      vec2 pId = floor(pCell);
      vec2 pEdge = min(fract(pCell), 1.0 - fract(pCell));
      vec2 pFw = ugFw / vec2(3.2, 2.4);
      vec2 pLine = 1.0 - smoothstep(vec2(0.010), vec2(0.010) + pFw * 1.45, pEdge);
      float primaryJoint = max(pLine.x, pLine.y);
      float subFade = 1.0 - smoothstep(14.0, 42.0, ugDist);
      vec2 sCell = ugW / 0.8;
      vec2 sEdge = min(fract(sCell), 1.0 - fract(sCell));
      vec2 sFw = ugFw / 0.8;
      vec2 sLine = 1.0 - smoothstep(vec2(0.014), vec2(0.014) + sFw * 1.45, sEdge);
      float subJoint = max(sLine.x, sLine.y) * subFade * 0.24;
      jointDark = max(primaryJoint * 0.82, subJoint) * flatJointMask;
      slabTone = (ugHash(pId) - 0.5) * 0.055 * flatJointMask;
    }
    urbanCol *= 1.0 + slabTone + (gStone - 0.5) * 0.24 - jointDark * 0.115 + m2 * 0.038;

    // 2. Parks, green belts & grassy slopes (desaturated Guilin subtropical turf, never neon)
    vec3 grassCol = mix(uUgGrassA, uUgGrassB, clamp(macro01 * 0.72 + (gGrass - 0.5) * 0.56, 0.0, 1.0));
    float soilPatch = smoothstep(0.54, 0.82, 0.5 - m2 * 0.34 + (0.5 - gGrass) * 0.64);
    grassCol = mix(grassCol, uUgSoil, soilPatch * 0.36);
    grassCol *= 1.0 + (gGrass - 0.5) * 0.28 + m1 * 0.05;

    // 3. Steep slopes & river embankments (rough karst stone / damp earth, zero vertical smear)
    vec3 rockCol = mix(uUgRockA, uUgRockB, clamp(0.5 + (gRock - 0.5) * 0.96 + m1 * 0.24, 0.0, 1.0));
    rockCol *= mix(1.0, 0.85, wBank);
    rockCol *= 1.0 + (gRock - 0.5) * 0.30;

    // Resolve smooth class & slope blends
    vec3 bareResolved = mix(urbanCol, mix(grassCol, rockCol, 0.45), slopeMid * 0.90);
    bareResolved = mix(bareResolved, rockCol, slopeSteep * 0.92);
    vec3 greenResolved = mix(grassCol, rockCol, slopeSteep * 0.82);
    vec3 bankResolved = mix(rockCol, mix(grassCol, rockCol, 0.56), (1.0 - slopeSteep) * 0.35);

    vec3 targetCol = baseRgb;
    targetCol = mix(targetCol, bareResolved, wBare);
    targetCol = mix(targetCol, greenResolved, wGreen);
    targetCol = mix(targetCol, bankResolved, wBank);

    // Preserve school tracks & sports courts while adding crisp fine texture
    if (wSpecial > 0.01) {
      targetCol *= 1.0 + ((gStone - 0.5) * 0.14 + m2 * 0.025) * wSpecial;
    }

    // Rain darkening on urban paving & embankments for harmony with wet streets
    if (uRain > 0.01) {
      float wetMask = clamp(wBare * (1.0 - slopeMid * 0.5) + wBank * 0.65 + wSpecial * 0.5, 0.0, 1.0);
      targetCol *= mix(1.0, 0.72, uRain * wetMask);
    }

    diffuseColor.rgb = mix(baseRgb, targetCol, ugInside);

    // Per-material roughness variation
    float flatBare = wBare * (1.0 - slopeMid);
    float roughTarget = 0.94;
    roughTarget = mix(roughTarget, 0.84 + (0.5 - gStone) * 0.18 + jointDark * 0.14 - m2 * 0.06, flatBare);
    roughTarget = mix(roughTarget, 0.95 + (0.5 - gGrass) * 0.07, wGreen);
    roughTarget = mix(roughTarget, 0.88 + (0.5 - gRock) * 0.16, max(wBank, slopeSteep * (wBare + wGreen)));
    roughTarget = mix(roughTarget, 0.82 + (0.5 - gStone) * 0.10, wSpecial);
    if (uRain > 0.01) {
      roughTarget *= mix(1.0, 0.56, uRain * clamp(flatBare + wBank * 0.5, 0.0, 1.0));
    }
    ugRoughShift = (roughTarget - 1.0) * ugInside;

    if (ugBumpFade > 0.001) {
      float hUrban = (gStone - 0.5) * 0.52 - jointDark * 0.55;
      float hGrass = (gGrass - 0.5) * 0.68;
      float hRock  = (gRock - 0.5) * 0.92;
      float slopeWeight = max(wBank, slopeSteep * (wBare + wGreen));
      float grassWeight = clamp(wGreen * (1.0 - slopeSteep) + wBare * slopeMid * (1.0 - slopeSteep), 0.0, 1.0);
      float h = hUrban * flatBare + hGrass * grassWeight + hRock * slopeWeight;
      ugBumpH = h * 0.23 * ugBumpFade * ugInside;
    }
  }
}
#endif`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + ugRoughShift, 0.25, 1.0);`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
if (uGroundUpgrade > 0.5) {
  vec3 ugDpx = dFdx(-vViewPosition), ugDpy = dFdy(-vViewPosition);
  float ugHx = dFdx(ugBumpH), ugHy = dFdy(ugBumpH);
  if (abs(ugHx) + abs(ugHy) > 1e-5) {
    vec3 ugR1 = cross(ugDpy, normal), ugR2 = cross(normal, ugDpx);
    float ugDet = dot(ugDpx, ugR1);
    if (abs(ugDet) > 1e-7) {
      normal = normalize(abs(ugDet) * normal - sign(ugDet) * (ugHx * ugR1 + ugHy * ugR2));
    }
  }
}`)
  }
}
