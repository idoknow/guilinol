import * as THREE from 'three'
import {look} from './config'
import {tileMaterial} from './tiles'
import {shareAtmosphere} from './atmosphere'

// M2.5 facades (docs/reference.md R2/R6/R9/R12): procedural windows, floor lines and a ground-floor
// shop band drawn from the GL04 wall attributes — no textures. aFloor = storeys above the footprint
// base (3.1 m each), aFacade = metres along the wall, aKind 0 white-tile flat / 1 grey-tile old / 2 glazed.
// Pattern fades to its average colour once a bay or storey is under a few pixels, so distant blocks
// do not shimmer. uWindowLight (0–1) is the M3 night hook: lit windows glow warm, picked by hash.

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
uniform vec3 uGlass; uniform vec3 uGlassLit; uniform vec3 uTimber; uniform vec3 uShop; uniform vec3 uWarm;
uniform vec3 uSigns[6]; uniform vec3 uNeon[6]; uniform vec3 uShopGlow; uniform float uLine; uniform float uWindowLight;
varying float vKind; varying float vFloor; varying float vFacade; varying float vRoof; flat varying vec2 vCell;
float facadeHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float box1(float x, float a, float b) { return step(a, x) * step(x, b); }
float winMask; float winHash; vec3 neonGlow;`)
    .replace('#include <color_fragment>', `#include <color_fragment>
winMask = 0.; winHash = 0.; neonGlow = vec3(0.);
if (vRoof < .5) {
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
    // White-tile blocks: long strip windows; ~1 in 5 bays is a balcony (lighter, set back).
    win = box1(fl, .34, .8) * box1(bx, .05, .95); cover = .41;
    if (h > .8) glass = mix(wall * .78, glass, box1(fl, .34, .62));
  }
  vec3 c = mix(wall, glass, win);
  // Phase 2 竖招牌: ~1 in 6 street bays carries a vertical lightbox sign over floors 2–4, split into
  // stacked character boxes; painted by day, neon at night.
  float bayHash = facadeHash(vec3(bi, 7., vCell.x * 7. + vCell.y * 131.));
  if (!glazed && !school && vKind < 3.5 && bayHash > .83 && f > 1.15 && f < 3.9) {
    float blade = box1(bx, .43, .57) * step(.14, fract(f * 2.));
    int bladeIdx = int(min(5., floor(fract(bayHash * 13.7) * 6.)));
    c = mix(c, mix(uSigns[bladeIdx], vec3(1.), .12), blade);
    neonGlow += uNeon[bladeIdx] * blade * 1.5 + uNeon[bladeIdx] * .05;
  }
  c = mix(c, wall * uLine, 1. - step(.045, fl));                       // slab line at each storey
  vec3 avg = mix(wall, glass, cover) * mix(1., uLine, .045);
  if (f < 0.) { c = wall * .74; avg = c; }                              // plinth below the footprint base
  else if (vKind > 3.5) {
    // Pale masonry piers and full-height turquoise glazing beside the end bays.
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
  else if (fi < .5 && !glazed) {                                        // ground-floor shops (R9)
    float front = box1(fl, .08, .64) * box1(bx, .06, .94);
    int signIdx = int(min(5., floor(fract(h * 7.31) * 6.)));
    vec3 sign = uSigns[signIdx];
    float band = box1(fl, .7, .88) * box1(bx, .03, .97) * step(.3, h);
    c = mix(uShop, mix(uGlassLit, uShop, .4), front);
    c = mix(c, h > .3 ? mix(sign, wall, .08) : wall * .9, box1(fl, .7, .88) * box1(bx, .03, .97));
    avg = mix(uShop, sign, .25); win = front;
    // Night: sign band lights as neon (brighter border tube), shopfront glass glows warm white.
    float tube = band * max(box1(fl, .7, .72) + box1(fl, .86, .88), box1(bx, .03, .05) + box1(bx, .95, .97));
    neonGlow += uNeon[signIdx] * (band * 1.1 + tube * 2.2) + uShopGlow * front * .6 + uNeon[signIdx] * .12;
  }
  float fw = max(fwidth(u), fwidth(f));
  neonGlow *= 1. - .8 * smoothstep(.18, .45, fw);                      // far blocks: soft average glow, no shimmer
  diffuseColor.rgb = mix(c, avg, smoothstep(.18, .45, fw));
  // Lit share: exact window shapes up close, the bay's average glass cover once windows blur.
  winMask = mix(win, cover, smoothstep(.18, .45, fw)); winHash = h;
}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += uWarm * uWindowLight * step(.45, winHash) * winMask + neonGlow * uWindowLight;`)
}
buildingMaterial.customProgramCacheKey = () => 'guilinol-facade-2'
tileMaterial(buildingMaterial,true)

// Vertex colours for GL04 building meshes: roofs by kind, parapets and roof boxes keep the wall colour.
const walls = b.walls.map(hex), roofs = b.roofs.map(hex)
export function buildingColor(kind:number, roof:boolean, normalY:number, out:number[], index:number) {
  const set = roof && normalY > .5 ? roofs : walls
  ;(set[kind] ?? set[0]).toArray(out, index)
}
