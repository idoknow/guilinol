import * as THREE from 'three'
import {look} from './config'
import {tileMaterial} from './tiles'
import {shareAtmosphere} from './atmosphere'
import {cityUpgradeUniforms} from '../city-upgrade/state'

// M2.5 facades (docs/reference.md R2/R6/R9/R12) + Guilin City-Upgrade 12-Layer WebGL2 PBR Array (vKind >= 16).
// vKind < 16 keeps original procedural GL04 shader bit-for-bit untouched.
// vKind >= 16 indexes 3 pure opaque RGB DataArrayTextures (albedo, norm+height, rough+lit+sign) with GLSL sRGB decode.

const b = look.buildings
export const windowLight = {value: 0}
export const buildingMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: look.roughness, metalness: look.metalness, side: THREE.DoubleSide,
})
const hex = (v:number) => new THREE.Color(v)
buildingMaterial.onBeforeCompile = shader => {
  shareAtmosphere(shader)
  Object.assign(shader.uniforms, {
    uGlass: {value: hex(b.glass)}, uGlassLit: {value: hex(b.glassLit)}, uTimber: {value: hex(b.timber)},
    uShop: {value: hex(b.shop)}, uLine: {value: b.floorLine}, uWindowLight: windowLight,
    uSigns: {value: b.signs.map(hex)}, uNeon: {value: b.neon.map(hex)}, uShopGlow: {value: hex(b.shopGlow)}, uWarm: {value: hex(b.windowWarm)},
    uCityUpgradeEnabled: cityUpgradeUniforms.uCityUpgradeEnabled,
    uFacadeReady: cityUpgradeUniforms.uFacadeReady,
    uFacadeAlbedo: cityUpgradeUniforms.uFacadeAlbedo,
    uFacadeNormH: cityUpgradeUniforms.uFacadeNormH,
    uFacadeProps: cityUpgradeUniforms.uFacadeProps,
  })
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
attribute float aKind; attribute float aFloor; attribute float aFacade; attribute float aRoof;
varying float vKind; varying float vFloor; varying float vFacade; varying float vRoof; flat varying vec2 vCell;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
vKind = aKind; vFloor = aFloor; vFacade = aFacade; vRoof = aRoof;
vec4 bw = modelMatrix * vec4(position, 1.); vCell = floor(bw.xz / 23.);`)
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
precision highp sampler2DArray;
uniform vec3 uGlass; uniform vec3 uGlassLit; uniform vec3 uTimber; uniform vec3 uShop; uniform vec3 uWarm;
uniform vec3 uSigns[6]; uniform vec3 uNeon[6]; uniform vec3 uShopGlow; uniform float uLine; uniform float uWindowLight;
uniform float uCityUpgradeEnabled;
uniform bool uFacadeReady;
uniform sampler2DArray uFacadeAlbedo;
uniform sampler2DArray uFacadeNormH;
uniform sampler2DArray uFacadeProps;
varying float vKind; varying float vFloor; varying float vFacade; varying float vRoof; flat varying vec2 vCell;
float facadeHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float box1(float x, float a, float b) { return step(a, x) * step(x, b); }
float spMacroNoise(vec3 p) {
  float a = sin(p.x * 0.085 + p.z * 0.063) * cos(p.z * 0.091 - p.y * 0.14);
  float b = sin(p.x * 0.23 - p.y * 0.31 + p.z * 0.19);
  return 0.65 * a + 0.35 * b;
}
float winMask; float winHash; vec3 neonGlow;
bool spActive; float spRough; vec3 spTanNorm; vec2 spUvDeriv; float spGlass; vec3 spExtraEmissive;`)
    .replace('#include <color_fragment>', `#include <color_fragment>
winMask = 0.; winHash = 0.; neonGlow = vec3(0.);
spActive = false; spRough = -1.; spTanNorm = vec3(0., 0., 1.); spUvDeriv = vec2(0.); spGlass = 0.; spExtraEmissive = vec3(0.);
if (vRoof < .5) {
  if (vKind >= 15.5 && uFacadeReady && uCityUpgradeEnabled > 0.5) {
    spActive = true;
    bool hasShop = vKind >= 31.5;
    float upperLayer = hasShop ? mod(floor(vKind - 31.5), 8.0) : floor(vKind - 15.5);
    float shopLayer = hasShop ? (8.0 + floor((vKind - 31.5) / 8.0)) : upperLayer;
    bool isGroundShop = hasShop && vFloor >= -0.05 && vFloor < 1.0;
    float layer = clamp(isGroundShop ? shopLayer : upperLayer, 0.0, 11.0);
    float bayW = isGroundShop ? 6.4 : 6.0;
    vec2 contUv = vec2(vFacade / bayW, -vFloor);
    vec2 baseUv = vec2(vFacade / bayW, 1.0 - fract(max(0.0, vFloor)));
    spUvDeriv = contUv;

    // Near-field subtle single-step relief parallax using continuous UV derivatives (zero floor-seam spikes!)
    vec2 sampleUv = baseUv;
    #ifdef USE_FOG
    float camDist = distance(vFogWorld, cameraPosition);
    float nearFade = 1.0 - smoothstep(45.0, 115.0, camDist);
    if (nearFade > 0.01) {
      float h0 = texture(uFacadeNormH, vec3(baseUv, layer)).b;
      vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
      vec2 duvx = dFdx(contUv), duvy = dFdy(contUv);
      float det = duvx.x * duvy.y - duvx.y * duvy.x;
      if (abs(det) > 1e-6) {
        vec3 T = normalize((dpx * duvy.y - dpy * duvx.y) / det);
        vec3 B = normalize((-dpx * duvy.x + dpy * duvx.x) / det);
        vec3 V = normalize(-vViewPosition);
        vec2 pDir = vec2(dot(V, T), dot(V, B));
        float pScale = (0.72 - h0) * 0.022 * nearFade;
        sampleUv = baseUv - clamp(pDir * pScale, vec2(-0.022), vec2(0.022));
      }
    }
    #endif

    // All 3 strips are 100% opaque RGB (A=255) so Canvas 2D never premultiplies any channel.
    vec4 albTex = texture(uFacadeAlbedo, vec3(sampleUv, layer));
    vec4 normH = texture(uFacadeNormH, vec3(sampleUv, layer));
    vec4 props = texture(uFacadeProps, vec3(sampleUv, layer));
    // Decode sRGB -> linear explicitly because DataArrayTexture uses RGBA8 for WebGL2 mipmap safety
    vec3 albLin = pow(max(albTex.rgb, vec3(0.0)), vec3(2.2));
    vec2 nxy = normH.rg * 2.0 - 1.0;
    spTanNorm = vec3(nxy, sqrt(max(0.04, 1.0 - dot(nxy, nxy))));
    spRough = props.r;
    // Disjoint roughness bands: glass [0.14..0.20], untinted trim/shutters/signs [0.34..0.47], masonry [0.60..0.96]
    spGlass = 1.0 - smoothstep(0.21, 0.27, props.r);
    float signMask = props.b;
    float wallTintMask = smoothstep(0.50, 0.58, props.r) * (1.0 - signMask);

    // Wall tint multiplies ONLY masonry pixels, keeping glass/frames/shutters/burgundy/signs crisp
    vec3 col = mix(albLin, albLin * diffuseColor.rgb, wallTintMask);

    float bayIdx = floor(vFacade / (bayW * 0.5));
    float fi = floor(max(0.0, vFloor));
    float unitHash = facadeHash(vec3(bayIdx, fi, vCell.x * 11.0 + vCell.y * 137.0));
    float bldgHash = facadeHash(vec3(vCell.x, vCell.y, 19.3));
    if (signMask > 0.35) {
      vec3 signRgb = col * (0.94 + 0.16 * unitHash);
      col = signRgb;
      spExtraEmissive += signRgb * signMask * uWindowLight * 1.28;
    }

    // World-space macro anti-tiling weathering + ground-contact AO
    #ifdef USE_FOG
    float macro = spMacroNoise(vFogWorld);
    col *= 1.0 + macro * (0.06 * wallTintMask + 0.015);
    #endif
    float groundAo = mix(0.84, 1.0, smoothstep(0.0, 0.38, vFloor));
    col *= groundAo;
    if (vFloor < 0.0) { col = diffuseColor.rgb * 0.66; spGlass = 0.0; spRough = 0.90; }

    // Subtle daytime atmospheric sky-bounce lift so narrow shaded Guilin alley walls keep crisp detail
    spExtraEmissive += col * (0.045 * (1.0 - uWindowLight));

    // Day per-window sky/curtain reflection variation so glass never reads flat
    if (spGlass > 0.25) {
      vec3 skyRefl = mix(vec3(0.24, 0.42, 0.54), vec3(0.46, 0.64, 0.72), unitHash);
      float dayRefl = (1.0 - uWindowLight) * (0.16 + 0.22 * unitHash);
      col = mix(col, skyRefl, spGlass * dayRefl);
    }

    // Night per-window randomized warm amber (70%) / cool TV-office (30%) interior glow + bright ground shops
    float litProb = isGroundShop ? 0.92 : (0.46 + 0.32 * bldgHash);
    float isLit = step(1.0 - litProb, unitHash);
    vec3 roomTint = isGroundShop
      ? vec3(1.0, 0.87, 0.64)
      : mix(vec3(1.0, 0.76, 0.42), vec3(0.68, 0.86, 1.0), step(0.70, fract(unitHash * 17.3)));
    float roomPower = isGroundShop ? 2.25 : (1.55 + 0.95 * fract(unitHash * 7.1));
    spExtraEmissive += roomTint * props.g * isLit * roomPower * uWindowLight;

    diffuseColor.rgb = col;
  } else {
    bool old = vKind > .5 && vKind < 1.5, glazed = vKind > 1.5 && vKind < 2.5, school = vKind > 2.5 && vKind < 3.5;
    float bay = old ? 2.8 : glazed ? 2.4 : 3.6;
    float f = vFloor, fl = fract(f), fi = floor(f), u = vFacade / bay, bx = fract(u), bi = floor(u);
    float h = facadeHash(vec3(bi, fi, vCell.x * 7. + vCell.y * 131.));
    vec3 wall = diffuseColor.rgb;
    vec3 glass = mix(uGlass, uGlassLit, h * h);
    float win = 0., cover = 0.;
    if (old) { win = box1(fl, .34, .74) * box1(bx, .3, .7); glass = mix(uTimber, uGlass, .35); cover = .16; }
    else if (glazed) { win = box1(fl, .28, .8) * box1(bx, .22, .78); cover = .29; }
    else {
      win = box1(fl, .34, .8) * box1(bx, .05, .95); cover = .41;
      if (h > .8) glass = mix(wall * .78, glass, box1(fl, .34, .62));
    }
    vec3 c = mix(wall, glass, win);
    float bayHash = facadeHash(vec3(bi, 7., vCell.x * 7. + vCell.y * 131.));
    if (!glazed && !school && vKind < 3.5 && bayHash > .83 && f > 1.15 && f < 3.9) {
      float blade = box1(bx, .43, .57) * step(.14, fract(f * 2.));
      int bladeIdx = int(min(5., floor(fract(bayHash * 13.7) * 6.)));
      c = mix(c, mix(uSigns[bladeIdx], vec3(1.), .12), blade);
      neonGlow += uNeon[bladeIdx] * blade * 1.5 + uNeon[bladeIdx] * .05;
    }
    c = mix(c, wall * uLine, 1. - step(.045, fl));
    vec3 avg = mix(wall, glass, cover) * mix(1., uLine, .045);
    if (f < 0.) { c = wall * .74; avg = c; }
    else if (vKind > 3.5 && vKind < 15.5) {
      float strip = box1(fract(vFacade / 34.), .055, .14);
      win = max(strip, box1(fl, .31, .85) * box1(bx, .15, .85));
      glass = mix(glass, vec3(.23, .51, .52), strip);
      c = mix(wall, glass, win);
      c = mix(c, wall * 1.17, max(box1(bx, .92, .99), box1(fl, .92, .98)) * (1. - strip));
      cover = .42; avg = mix(wall, glass, cover);
    }
    else if (school) {
      c = mix(c, uGlass, box1(fl,.12,.19));
      c = mix(c, wall, box1(fl,.2,.46)*max(step(.94,fract(u*4.)),box1(fl,.42,.45)));
    }
    else if (fi < .5 && !glazed) {
      float front = box1(fl, .08, .64) * box1(bx, .06, .94);
      int signIdx = int(min(5., floor(fract(h * 7.31) * 6.)));
      vec3 sign = uSigns[signIdx];
      float band = box1(fl, .7, .88) * box1(bx, .03, .97) * step(.3, h);
      c = mix(uShop, mix(uGlassLit, uShop, .4), front);
      c = mix(c, h > .3 ? mix(sign, wall, .08) : wall * .9, box1(fl, .7, .88) * box1(bx, .03, .97));
      avg = mix(uShop, sign, .25); win = front;
      float tube = band * max(box1(fl, .7, .72) + box1(fl, .86, .88), box1(bx, .03, .05) + box1(bx, .95, .97));
      neonGlow += uNeon[signIdx] * (band * 1.1 + tube * 2.2) + uShopGlow * front * .6 + uNeon[signIdx] * .12;
    }
    float fw = max(fwidth(u), fwidth(f));
    neonGlow *= 1. - .8 * smoothstep(.18, .45, fw);
    diffuseColor.rgb = mix(c, avg, smoothstep(.18, .45, fw));
    winMask = mix(win, cover, smoothstep(.18, .45, fw)); winHash = h;
  }
} else if (vKind >= 15.5) {
  #ifdef USE_FOG
  diffuseColor.rgb *= 1.0 + spMacroNoise(vFogWorld * 1.3) * 0.08;
  #endif
}`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
if (spActive && spRough >= 0.0) { roughnessFactor = clamp(spRough, 0.08, 0.96); }`)
    .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
if (spActive) {
  #ifdef USE_FOG
  float nFade = 1.0 - smoothstep(60.0, 150.0, distance(vFogWorld, cameraPosition));
  if (nFade > 0.01) {
    vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
    vec2 duvx = dFdx(spUvDeriv), duvy = dFdy(spUvDeriv);
    float det = duvx.x * duvy.y - duvx.y * duvy.x;
    if (abs(det) > 1e-7) {
      vec3 T = normalize((dpx * duvy.y - dpy * duvx.y) / det);
      vec3 B = normalize((-dpx * duvy.x + dpy * duvx.x) / det);
      vec3 tn = normalize(vec3(spTanNorm.xy * (0.48 * nFade), max(0.35, spTanNorm.z)));
      vec3 perturbed = normalize(T * tn.x + B * tn.y + normal * tn.z);
      if (dot(perturbed, normal) > 0.15) normal = perturbed;
    }
  }
  #endif
}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (spActive) {
  totalEmissiveRadiance += spExtraEmissive;
} else {
  totalEmissiveRadiance += uWarm * uWindowLight * step(.45, winHash) * winMask + neonGlow * uWindowLight;
}`)
}
buildingMaterial.customProgramCacheKey = () => 'guilinol-facade-city-upgrade-1'
tileMaterial(buildingMaterial,true)

// Vertex colours for GL04 building meshes: roofs by kind, parapets and roof boxes keep the wall colour.
const walls = b.walls.map(hex), roofs = b.roofs.map(hex)
export function buildingColor(kind:number, roof:boolean, normalY:number, out:number[], index:number) {
  const set = roof && normalY > .5 ? roofs : walls
  ;(set[kind] ?? set[0]).toArray(out, index)
}
