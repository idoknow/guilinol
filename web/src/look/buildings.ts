import * as THREE from 'three'
import {look} from './config'

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
  Object.assign(shader.uniforms, {
    uGlass: {value: hex(b.glass)}, uGlassLit: {value: hex(b.glassLit)}, uTimber: {value: hex(b.timber)},
    uShop: {value: hex(b.shop)}, uLine: {value: b.floorLine}, uWindowLight: windowLight,
    uSigns: {value: b.signs.map(hex)}, uWarm: {value: hex(b.windowWarm)},
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
uniform vec3 uSigns[4]; uniform float uLine; uniform float uWindowLight;
varying float vKind; varying float vFloor; varying float vFacade; varying float vRoof; flat varying vec2 vCell;
float facadeHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float box1(float x, float a, float b) { return step(a, x) * step(x, b); }
float winMask; float winHash;`)
    .replace('#include <color_fragment>', `#include <color_fragment>
winMask = 0.; winHash = 0.;
if (vRoof < .5) {
  bool old = vKind > .5 && vKind < 1.5, glazed = vKind > 1.5;
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
  c = mix(c, wall * uLine, 1. - step(.045, fl));                       // slab line at each storey
  vec3 avg = mix(wall, glass, cover) * mix(1., uLine, .045);
  if (f < 0.) { c = wall * .74; avg = c; }                              // plinth below the footprint base
  else if (fi < .5 && !glazed) {                                        // ground-floor shops (R9)
    float front = box1(fl, .08, .64) * box1(bx, .06, .94);
    vec3 sign = uSigns[int(min(3., floor(h * 4.)))];
    c = mix(uShop, mix(uGlassLit, uShop, .4), front);
    c = mix(c, h > .3 ? mix(sign, wall, .15) : wall * .9, box1(fl, .7, .88) * box1(bx, .03, .97));
    avg = mix(uShop, sign, .25); win = front;
  }
  float fw = max(fwidth(u), fwidth(f));
  diffuseColor.rgb = mix(c, avg, smoothstep(.18, .45, fw));
  winMask = win * (1. - smoothstep(.3, .6, fw)); winHash = h;
}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += uWarm * uWindowLight * step(.45, winHash) * mix(.35, 1., winMask);`)
}
buildingMaterial.customProgramCacheKey = () => 'guilinol-facade-1'

// Vertex colours for GL04 building meshes: roofs by kind, parapets and roof boxes keep the wall colour.
const walls = b.walls.map(hex), roofs = b.roofs.map(hex)
export function buildingColor(kind:number, roof:boolean, normalY:number, out:number[], index:number) {
  const set = roof && normalY > .5 ? roofs : walls
  ;(set[kind] ?? set[0]).toArray(out, index)
}
