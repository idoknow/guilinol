import * as THREE from 'three'
import {look} from './config'
import {nightBridge} from './night'
import {groundUpgradeUniforms,sharedGroundDetailTexture} from './urban-ground'

// 石桥: the GL03 deck is a top surface only. Give it a stone colour and a fascia hanging from every
// open edge so bridges read as solid slabs from the bank. Visual only — collision stays the deck.
const top = new THREE.Color(), side = new THREE.Color()
export const bridgeMaterial = new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0,side:THREE.DoubleSide})
nightBridge(bridgeMaterial)

// IDOK-432: World-space concrete/asphalt deck & cast-concrete fascia shader upgrade (0 extra draw calls,
// preserves bridgeGeometry topology and nightBridge Jiefang stripes & edge lamps).
{
  const previous = bridgeMaterial.onBeforeCompile
  const cache = bridgeMaterial.customProgramCacheKey()
  bridgeMaterial.customProgramCacheKey = ()=>cache + '-deck-tex-1'
  const uBrLegacyTop = {value: new THREE.Color(0xc4bca8)}
  const uBrLegacySide = {value: new THREE.Color(0x938d7e)}
  const uBrLegacyAsphalt = {value: new THREE.Color('#42454a')}
  const uBrAsphalt = {value: new THREE.Color(look.streets.surfaces[0])}
  bridgeMaterial.onBeforeCompile = function(shader, renderer) {
    previous.call(this, shader, renderer)
    Object.assign(shader.uniforms, {
      uBrTex: {value: sharedGroundDetailTexture()},
      uGroundUpgrade: groundUpgradeUniforms.uGroundUpgrade,
      uBrLegacyTop,
      uBrLegacySide,
      uBrLegacyAsphalt,
      uBrAsphalt,
    })
    const needRainDecl = !shader.fragmentShader.includes('uniform float uRain')
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBrNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBrNormal = normalize(mat3(modelMatrix) * objectNormal);')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uBrTex;
uniform float uGroundUpgrade;
${needRainDecl ? 'uniform float uRain;' : ''}
uniform vec3 uBrLegacyTop, uBrLegacySide, uBrLegacyAsphalt, uBrAsphalt;
varying vec3 vBrNormal;
float brBumpH;
float brRoughTarget;
float brSkyFill;
float brHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
brBumpH = 0.0;
brRoughTarget = 1.0;
brSkyFill = 0.0;
#ifdef USE_FOG
{
  bool brIsAsphalt = vEdge < -0.5;
  float brUp = smoothstep(0.45, 0.78, abs(normalize(vBrNormal).y));
  if (uGroundUpgrade < 0.5) {
    // Restore exact pre-upgrade flat vertex colours for pixel-aligned Before/After verification.
    diffuseColor.rgb = brIsAsphalt ? uBrLegacyAsphalt : mix(uBrLegacySide, uBrLegacyTop, brUp);
  } else {
    vec2 bw = vFogWorld.xz;
    vec2 bwFw = max(fwidth(bw), vec2(0.002));
    float bDist = length(vFogWorld - cameraPosition);
    float bMicroFade = 1.0 - smoothstep(140.0, 380.0, bDist);
    float bJointFade = 1.0 - smoothstep(45.0, 145.0, bDist);
    float bBumpFade  = 1.0 - smoothstep(30.0, 120.0, bDist);

    float bMacro = sin(bw.x * 0.08 + bw.y * 0.06) * cos(bw.y * 0.09 - bw.x * 0.05) * 0.65
      + sin(bw.x * 0.24 - bw.y * 0.19) * 0.35;

    float gStone = 0.5, gRock = 0.5;
    if (bMicroFade > 0.001) {
      vec3 tf = texture2D(uBrTex, bw / 4.2).rgb;
      vec2 rw = mat2(0.8, -0.6, 0.6, 0.8) * bw;
      vec3 tc = texture2D(uBrTex, rw / 14.0).rgb;
      gStone = mix(0.5, tf.r * 0.70 + tc.r * 0.30, bMicroFade);
      vec2 sideUv = vec2((bw.x + bw.y) * 0.7071 / 4.6, vFogWorld.y / 2.2);
      float sideGrain = texture2D(uBrTex, sideUv).b;
      gRock = mix(0.5, sideGrain * 0.72 + tc.b * 0.28, bMicroFade);
    }

    if (brIsAsphalt && brUp > 0.5) {
      // Bridge carriageway: refined dark-slate urban asphalt + periodic transverse expansion seams
      vec3 col = uBrAsphalt;
      float agg = (gStone - 0.5) * 0.30 + bMacro * 0.065;
      // Bridge deck expansion joints every 12 m
      float jx = bw.x / 12.0, jz = bw.y / 12.0;
      float ex = min(fract(jx), 1.0 - fract(jx)), ez = min(fract(jz), 1.0 - fract(jz));
      float seamX = 1.0 - smoothstep(0.005, 0.005 + (bwFw.x / 12.0) * 1.5, ex);
      float seamZ = 1.0 - smoothstep(0.005, 0.005 + (bwFw.y / 12.0) * 1.5, ez);
      float expJoint = max(seamX, seamZ) * bJointFade;
      col *= 1.0 + agg - expJoint * 0.26;
      if (uRain > 0.01) col *= mix(1.0, ${look.streets.wetDarken.toFixed(2)}, uRain);
      diffuseColor.rgb = col;
      brRoughTarget = clamp(0.80 + (0.5 - gStone) * 0.20 - bMacro * 0.08 - expJoint * 0.15, 0.42, 0.96);
      if (uRain > 0.01) brRoughTarget *= mix(1.0, 0.52, uRain);
      brBumpH = ((gStone - 0.5) * 0.55 - expJoint * 0.9) * 0.24 * bBumpFade;
    } else if (brUp > 0.5) {
      // Bridge top deck: weathered architectural concrete/tarmac deck (harmonizes with urban asphalt roads,
      // distinct from pedestrian plaza tiles) with 6 m structural deck expansion seams & aggregate texture
      vec3 col = diffuseColor.rgb;
      vec2 jCell = bw / 6.0;
      vec2 jEdge = min(fract(jCell), 1.0 - fract(jCell));
      vec2 jFw = bwFw / 6.0;
      vec2 jLn = 1.0 - smoothstep(vec2(0.007), vec2(0.007) + jFw * 1.45, jEdge);
      float deckSeam = max(jLn.x, jLn.y) * bJointFade;
      // Subtle poured-bay tonal variation + brushed road-deck aggregate & macro wheel-wear patina
      float bayVar = (brHash(floor(jCell)) - 0.5) * 0.055 * bJointFade;
      float wear = (gStone - 0.5) * 0.28 + bMacro * 0.065;
      col *= 1.0 + bayVar + wear - deckSeam * 0.22;
      if (uRain > 0.01) col *= mix(1.0, 0.62, uRain);
      diffuseColor.rgb = col;
      brRoughTarget = clamp(0.80 + (0.5 - gStone) * 0.18 + deckSeam * 0.10 - bMacro * 0.07, 0.42, 0.96);
      if (uRain > 0.01) brRoughTarget *= mix(1.0, 0.52, uRain);
      brBumpH = ((gStone - 0.5) * 0.58 - deckSeam * 0.85) * 0.22 * bBumpFade;
    } else {
      // Bridge fascia side beam: cast-in-place architectural concrete, formwork joints & water-stain weathering
      vec3 col = diffuseColor.rgb;
      float along = (bw.x + bw.y) * 0.7071;
      float formCoord = along / 2.4;
      float fEdge = min(fract(formCoord), 1.0 - fract(formCoord));
      float fFw = (bwFw.x + bwFw.y) * 0.35 / 2.4;
      float formSeam = (1.0 - smoothstep(0.012, 0.012 + max(fFw, 0.002) * 1.5, fEdge)) * bJointFade;
      // Top coping reveal band near vEdge ~ 0.84 + subtle damp darkening toward bottom (vEdge -> 0)
      float copingReveal = (1.0 - smoothstep(0.018, 0.048, abs(vEdge - 0.84))) * bJointFade;
      float copingLight = smoothstep(0.84, 0.98, vEdge) * 0.07;
      float dampBottom = mix(0.84, 1.0, smoothstep(0.0, 0.55, vEdge));
      float runnel = (gRock - 0.5) * 0.30 + (gStone - 0.5) * 0.14;
      col *= (1.0 + copingLight + runnel + bMacro * 0.04 - formSeam * 0.20 - copingReveal * 0.18) * dampBottom;
      diffuseColor.rgb = col;
      brRoughTarget = clamp(0.88 + (0.5 - gRock) * 0.14 + formSeam * 0.08, 0.60, 0.98);
      brBumpH = ((gRock - 0.5) * 0.72 - formSeam * 0.75 - copingReveal * 0.65) * 0.22 * bBumpFade;
      // Subtle daytime sky-bounce indirect lift so shaded vertical concrete girders never crush to pure black
      brSkyFill = 0.032;
    }
  }
}
#endif`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
if (uGroundUpgrade > 0.5) { roughnessFactor = clamp(brRoughTarget, 0.35, 1.0); }`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
if (uGroundUpgrade > 0.5) {
  vec3 brDpx = dFdx(-vViewPosition), brDpy = dFdy(-vViewPosition);
  float brHx = dFdx(brBumpH), brHy = dFdy(brBumpH);
  if (abs(brHx) + abs(brHy) > 1e-5) {
    vec3 brR1 = cross(brDpy, normal), brR2 = cross(normal, brDpx);
    float brDet = dot(brDpx, brR1);
    if (abs(brDet) > 1e-7) {
      normal = normalize(abs(brDet) * normal - sign(brDet) * (brHx * brR1 + brHy * brR2));
    }
  }
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (uGroundUpgrade > 0.5 && brSkyFill > 0.0) {
  totalEmissiveRadiance += diffuseColor.rgb * brSkyFill * (1.0 - uNight);
}`)
  }
}

const asphaltColor=new THREE.Color(look.streets.surfaces[0])
export function bridgeGeometry(deck:Float32Array,thin:Set<number>,asphalt:number[],pavedTops?:Set<number>) {
  top.set(look.bridgeTop); side.set(look.bridgeSide)
  const key = (at:number)=>`${Math.round(deck[at]*20)},${Math.round(deck[at+1]*20)},${Math.round(deck[at+2]*20)}`
  const edges = new Map<string,[number,number,number]>()
  for(let tri=0;tri<deck.length/9;tri++) for(let corner=0;corner<3;corner++) {
    const a = tri*9+corner*3, b = tri*9+(corner+1)%3*3, ka = key(a), kb = key(b)
    const id = ka<kb?`${ka}|${kb}`:`${kb}|${ka}`, seen = edges.get(id)
    if(seen) seen[2]++; else edges.set(id,[a,b,1])
  }
  const open = [...edges.values()].filter(edge=>edge[2]===1)
  const positions = new Float32Array(deck.length-(pavedTops?.size??0)*9+open.length*18), colors = new Float32Array(positions.length), edge = new Float32Array(positions.length/3)
  const road=new Set(asphalt)
  let out=0
  for(let at=0;at<deck.length;at+=9){
    if(pavedTops?.has(at/9))continue
    const paved=road.has(at/9)
    for(let coord=at;coord<at+9;coord+=3){
      positions[out]=deck[coord];positions[out+1]=deck[coord+1];positions[out+2]=deck[coord+2];
      (paved?asphaltColor:top).toArray(colors,out);if(paved)edge[out/3]=-1;out+=3
    }
  }
  for(const [a,b] of open) {
    const depth = thin.has(Math.floor(a/9))?.6:look.bridgeDepth
    const ax=deck[a],ay=deck[a+1],az=deck[a+2],bx=deck[b],by=deck[b+1],bz=deck[b+2]
    for(const [x,y,z] of [[ax,ay,az],[bx,by-depth,bz],[bx,by,bz],[ax,ay,az],[ax,ay-depth,az],[bx,by-depth,bz]]) {
      positions[out]=x;positions[out+1]=y;positions[out+2]=z;side.toArray(colors,out);edge[out/3]=y===ay||y===by?1:0;out+=3
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3))
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3))
  geometry.setAttribute('aEdge',new THREE.BufferAttribute(edge,1))
  geometry.computeVertexNormals()
  return geometry
}
