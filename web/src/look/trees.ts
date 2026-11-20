import * as THREE from 'three'
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {look} from './config'
import {shareAtmosphere} from './atmosphere'
import {RENDER_RADIUS_DEFAULT, deriveRangeMetrics} from '../render-range'

// M2.5 tree look (docs/reference.md R2/R4/R8/R11): deep broadleaf canopy that the city sits in.
// Species order follows pipeline/vegetation.json: camphor, banyan, osmanthus, palm, conifer, shrub.
// Every part is baked to vertex colour (crowns shade dark→lit with height, a cheap canopy AO);
// the Forest tints each instance from its seed. Budgets: near ≤ 120 faces, far ≤ 24 faces.
// Trunks start 1.5 m below the origin so slope-planted trees never show a gap on the downhill side.

type Part = {geometry:THREE.BufferGeometry, color:number, lit?:number, dark?:number}
const tmp = new THREE.Color(), lo = new THREE.Color(), hi = new THREE.Color()

function lump(radius:number, squash:number, x:number, y:number, z:number, yaw=0, detail=0) {
  return new THREE.IcosahedronGeometry(radius, detail).scale(1, squash, 1).rotateY(yaw).translate(x, y, z)
}
function trunk(top:number, r0:number, r1:number, sides=5, lean=0) {
  return new THREE.CylinderGeometry(r1, r0, top + 1.5, sides, 1, true).translate(0, (top - 1.5) / 2, 0).rotateZ(lean)
}
function paint(parts:Part[]) {
  const flat = parts.map(({geometry, color, lit, dark}) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry
    g.computeBoundingBox()
    const {min, max} = g.boundingBox!, pos = g.getAttribute('position'), rgb = new Float32Array(pos.count * 3)
    lo.setHex(dark ?? color); hi.setHex(lit ?? color)
    const mid = new THREE.Color(color)
    for (let i = 0; i < pos.count; i += 3) {
      // One colour per face (flat look): shade by the face's mean height inside its part.
      const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3, t = (y - min.y) / Math.max(.01, max.y - min.y)
      if (t < .5) tmp.copy(lo).lerp(mid, t * 2); else tmp.copy(mid).lerp(hi, (t - .5) * 2)
      for (let k = 0; k < 3; k++) tmp.toArray(rgb, (i + k) * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(rgb, 3)); g.deleteAttribute('uv'); g.deleteAttribute('normal')
    return g
  })
  const merged = mergeGeometries(flat)!; merged.computeVertexNormals(); flat.forEach(g => g.dispose()); return merged
}

const t = look.trees
function camphor() { // 香樟: broad rounded crown of three lumps on a short trunk, ~11 m tall
  const leaf = {color:t.camphor, lit:t.camphorLit, dark:t.canopyDark}
  return {
    near: [{geometry:trunk(5, .245, .20, 8), color:t.trunk},
      {...leaf, geometry:lump(4.6, .72, 1.5, 7.4, 0)}, {...leaf, geometry:lump(3.0, .75, 3.4, 6.3, 1.1, 1)},
      {...leaf, geometry:lump(3.0, .8, -.5, 6.6, -1.6, 2)}, {...leaf, geometry:lump(2.5, .8, 1.8, 9.3, -.4, .5)}],
    far: [{...leaf, geometry:lump(5, .72, 1.5, 7.2, 0)}],
  }
}
function rootStrand(x:number, z:number, topY:number, botY:number, rTop:number) {
  return new THREE.ConeGeometry(rTop, topY - botY, 3, 1, true).rotateX(Math.PI).translate(x, (topY + botY) / 2, z)
}
function banyan() { // 榕树: very wide, low dome; fluted root columns by trunk + hanging canopy aerial-root curtains (near = 116 <= 120 faces)
  const leaf = {color:t.banyan, lit:t.banyanLit, dark:t.canopyDark}
  return {
    near: [{geometry:trunk(4.5, .245, .20, 8), color:t.trunk},
      {geometry:rootStrand(1.05, -.38, 4.9, .45, .11), color:t.trunk},
      {geometry:rootStrand(-.45, 1.02, 5.0, .55, .10), color:t.trunk},
      {geometry:rootStrand(2.2, 1.7, 5.7, 2.35, .10), color:t.trunk},
      {geometry:rootStrand(-2.1, 1.9, 5.7, 2.45, .10), color:t.trunk},
      {...leaf, geometry:lump(5.6, .5, 0, 7.6, 0)}, {...leaf, geometry:lump(4, .55, 4.6, 6.8, 1.5, 1)},
      {...leaf, geometry:lump(4, .55, -4.2, 6.9, -2, 2)}, {...leaf, geometry:lump(3.4, .6, -.8, 7.4, 4.4, 3)}],
    far: [{...leaf, geometry:lump(8, .45, 0, 7.2, 0)}],
  }
}
function osmanthus() { // 桂花: small glossy dark tree, single dense crown
  const leaf = {color:t.osmanthus, lit:t.osmanthusLit, dark:t.canopyDark}
  return {
    near: [{geometry:trunk(1.4, .2, .15, 4), color:t.trunk},
      {...leaf, geometry:new THREE.DodecahedronGeometry(2.3).scale(1, 1.15, 1).translate(0, 3.6, 0)},
      {...leaf, geometry:lump(1.5, .9, .9, 4.9, .4, 1)}],
    far: [{...leaf, geometry:lump(2.5, 1.1, 0, 3.7, 0)}],
  }
}
function palm() { // 棕榈/大王椰 (R11/R13): slim grey trunk, seven drooping fronds
  const fronds = (count:number, length:number, bends:number) => {
    const out:THREE.BufferGeometry[] = []
    for (let i = 0; i < count; i++) {
      const pts:number[] = [], w = .9, yaw = i / count * Math.PI * 2 + (i % 2) * .3
      // A frond is a bent strip: root → bend → tip, as 2 triangles per segment.
      const ring = Array.from({length:bends + 1}, (_, s) => {
        const u = s / bends, r = u * length, y = 9.6 + Math.sin(u * 2.2) * 1.3 - u * u * 2.6
        return [r, y, w * (1 - u * .8)]
      })
      for (let s = 0; s < bends; s++) {
        const [r0, y0, w0] = ring[s], [r1, y1, w1] = ring[s + 1]
        pts.push(r0, y0, -w0, r1, y1, -w1, r1, y1 + .05, w1, r0, y0, -w0, r1, y1 + .05, w1, r0, y0, w0)
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      out.push(g.rotateY(yaw))
    }
    return mergeGeometries(out)!
  }
  const leaf = {color:t.palm, lit:t.palmLit, dark:t.palmDark}
  return {
    near: [{geometry:trunk(9.6, .32, .22, 5), color:t.palmTrunk},
      {geometry:new THREE.OctahedronGeometry(.55).translate(0, 9.7, 0), color:t.palmTrunk},
      {...leaf, geometry:fronds(7, 4.6, 2)}],
    far: [{geometry:trunk(9.6, .3, .25, 3), color:t.palmTrunk}, {...leaf, geometry:fronds(5, 4.2, 1)}],
  }
}
function conifer() { // 水杉/柏 (R8): narrow stacked spire, blue-dark green
  const leaf = {color:t.conifer, lit:t.coniferLit, dark:t.canopyDark}
  const tier = (r:number, h:number, y:number, yaw:number) => new THREE.ConeGeometry(r, h, 6, 1, true).rotateY(yaw).translate(0, y, 0)
  return {
    near: [{geometry:trunk(3, .3, .2, 4), color:t.trunk},
      {...leaf, geometry:tier(2.3, 6, 5.5, 0)}, {...leaf, geometry:tier(1.8, 5.4, 9, .5)},
      {...leaf, geometry:tier(1.2, 5, 12.4, 1)}, {...leaf, geometry:tier(.6, 3, 14.6, 1.5)}],
    far: [{...leaf, geometry:new THREE.ConeGeometry(2.2, 13.5, 6, 1, true).translate(0, 8.2, 0)}],
  }
}
function shrub() { // 灌木团: peak scrub and park undergrowth, two low lumps
  const leaf = {color:t.shrub, lit:t.shrubLit, dark:t.canopyDark}
  return {
    near: [{...leaf, geometry:lump(1.6, .75, 0, .7, 0)}, {...leaf, geometry:lump(1.1, .8, 1.2, .5, .5, 1)}],
    far: [{...leaf, geometry:lump(1.8, .7, .3, .6, .2)}],
  }
}

const material = new THREE.MeshStandardMaterial({vertexColors:true, flatShading:true, roughness:1, metalness:0, side:THREE.DoubleSide})
// A screen-door fade writes normal opaque depth while thinning the last band
// of crowns. The forest stops submitting trees at the outer edge of the band.
export const treeFar = deriveRangeMetrics(RENDER_RADIUS_DEFAULT).treeFar
export const treeFarUniform = {value: treeFar}
export function setTreeFar(distance:number) { treeFarUniform.value = distance }
material.onBeforeCompile = shader=>{
  shareAtmosphere(shader)
  shader.uniforms.uTreeFar = treeFarUniform
  shader.fragmentShader=shader.fragmentShader
    .replace('#include <common>','#include <common>\nuniform float uTreeFar;')
    .replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
#ifdef USE_FOG
  float fade = smoothstep(max(60., uTreeFar-120.), uTreeFar, distance(vFogWorld,cameraPosition));
  if(fade > fract(52.9829189 * fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))) discard;
#endif`)
}
const builders = [camphor, banyan, osmanthus, palm, conifer, shrub]
export const speciesCount = builders.length
export function treeGeometry(species:number) {
  const {near, far} = builders[species] ? builders[species]() : camphor()
  return {near:paint(near), far:paint(far), material}
}
