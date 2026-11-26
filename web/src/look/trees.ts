import * as THREE from 'three'
import {treeCards} from './tree-cards'
import {shareAtmosphere} from './atmosphere'
import treeSpecs from '../../../pipeline/tree-specs.json'
import {look} from './config'
import {RENDER_RADIUS_DEFAULT, deriveRangeMetrics} from '../render-range'

type Vec3 = [number, number, number]
type VariantSpec = {scale:Vec3; lean:number; tint:Vec3}
type PartSpec = Record<string, any>
type SpeciesSpec = {id:number; name:string; zh:string; latin:string; variants:VariantSpec[]; near:PartSpec[]; mid:PartSpec[]; far:PartSpec[]}

const specs = (treeSpecs as unknown as {species:SpeciesSpec[]}).species
export const TREE_SPECIES_COUNT = specs.length

const tmpC0 = new THREE.Color(), tmpC1 = new THREE.Color(), tmpC2 = new THREE.Color(), tmpOut = new THREE.Color()
const tmpObj = new THREE.Object3D()

// Standard outward-facing unit icosahedron + 1-level geodesic subdivision (42 verts, 80 tris)
const PHI = (1 + Math.sqrt(5)) / 2
const ICO_RAW:Vec3[] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
]
const ICO_VERTS:Vec3[] = ICO_RAW.map(([x, y, z]) => {
  const ln = Math.hypot(x, y, z)
  return [x / ln, y / ln, z / ln]
})
const ICO_FACES:[number, number, number][] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
]

function subdivideIco(verts:Vec3[], faces:[number, number, number][]) {
  const vOut:Vec3[] = verts.slice()
  const cache = new Map<string, number>()
  const mid = (i:number, j:number) => {
    const key = i < j ? `${i}_${j}` : `${j}_${i}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const [ax, ay, az] = vOut[i], [bx, by, bz] = vOut[j]
    const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5
    const ln = Math.hypot(mx, my, mz)
    const idx = vOut.length
    vOut.push([mx / ln, my / ln, mz / ln])
    cache.set(key, idx)
    return idx
  }
  const fOut:[number, number, number][] = []
  for (const [a, b, c] of faces) {
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a)
    fOut.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
  }
  return {verts:vOut, faces:fOut}
}

const ICO_1 = subdivideIco(ICO_VERTS, ICO_FACES)

function evalBlob([rx, ry, rz]:Vec3, [px, py, pz]:Vec3, yaw:number, seed:number, subdiv:number, jitter = 0.15):Vec3[][] {
  const verts = subdiv >= 1 ? ICO_1.verts : ICO_VERTS
  const faces = subdiv >= 1 ? ICO_1.faces : ICO_FACES
  const cy = Math.cos(yaw), sy = Math.sin(yaw)
  const pts:Vec3[] = verts.map(([ux, uy, uz]) => {
    const d1 = Math.sin(seed * 1.73 + ux * 3.17 + uy * 2.63 + uz * 3.53)
    const d2 = Math.cos(seed * 2.91 - ux * 4.31 + uy * 3.79 - uz * 2.87)
    const disp = 1 + jitter * (0.62 * d1 + 0.38 * d2)
    const lx = ux * rx * disp, ly = uy * ry * disp, lz = uz * rz * disp
    return [lx * cy + lz * sy + px, ly + py, -lx * sy + lz * cy + pz]
  })
  return faces.map(([a, b, c]) => [pts[a], pts[b], pts[c]])
}

function evalTube(pts:number[][], sides:number):Vec3[][] {
  const rings:Vec3[][] = [], n = pts.length
  for (let i = 0; i < n; i++) {
    const [cx, cy, cz, r] = pts[i]
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(n - 1, i + 1)]
    let tx = p1[0] - p0[0], ty = p1[1] - p0[1], tz = p1[2] - p0[2]
    const tl = Math.hypot(tx, ty, tz) || 1
    tx /= tl; ty /= tl; tz /= tl
    const upX = Math.abs(ty) > 0.92 ? 1 : 0, upY = Math.abs(ty) > 0.92 ? 0 : 1
    let ux = -tz * upY, uy = tz * upX, uz = tx * upY - ty * upX
    const ul = Math.hypot(ux, uy, uz) || 1
    ux /= ul; uy /= ul; uz /= ul
    const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux
    const ring:Vec3[] = []
    for (let s = 0; s < sides; s++) {
      const ang = (s / sides) * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang)
      ring.push([cx + r * (ca * ux + sa * vx), cy + r * (ca * uy + sa * vy), cz + r * (ca * uz + sa * vz)])
    }
    rings.push(ring)
  }
  const tris:Vec3[][] = []
  for (let i = 0; i < n - 1; i++) {
    const r0 = rings[i], r1 = rings[i + 1]
    for (let s = 0; s < sides; s++) {
      const sn = (s + 1) % sides
      tris.push([r0[s], r0[sn], r1[sn]], [r0[s], r1[sn], r1[s]])
    }
  }
  return tris
}

function evalBundles(clusters:any[]):Vec3[][] {
  const tris:Vec3[][] = []
  for (let ci = 0; ci < clusters.length; ci++) {
    const cl = clusters[ci]
    const [ox, oy, oz] = cl.p as Vec3
    const sp = cl.spread as number, r = cl.r as number, lengths = cl.lengths as number[]
    for (let k = 0; k < lengths.length; k++) {
      const ln = lengths[k]
      const ang = (k / lengths.length) * Math.PI * 2 + ci * 0.7
      const dx = Math.cos(ang) * sp, dz = Math.sin(ang) * sp
      const sx = Math.sin(ci * 1.9 + k * 2.3) * 0.10, sz = Math.cos(ci * 1.5 + k * 2.7) * 0.10
      tris.push(...evalTube([
        [ox + dx * 0.45, oy + 0.15, oz + dz * 0.45, r],
        [ox + dx + sx * 0.5, oy - ln * 0.52, oz + dz + sz * 0.5, r * 0.68],
        [ox + dx * 1.15 + sx, oy - ln, oz + dz * 1.15 + sz, r * 0.28],
      ], 3))
    }
  }
  return tris
}

function evalWhorl(y:number, r:number, thick:number, lift:number, lobes:number, yaw:number, seed:number):Vec3[][] {
  const tris:Vec3[][] = []
  for (let i = 0; i < lobes; i++) {
    const ang = yaw + (i / lobes) * Math.PI * 2 + Math.sin(seed + i * 1.7) * 0.08
    const cs = Math.cos(ang), sn = Math.sin(ang)
    const rl = r * (0.90 + 0.16 * Math.sin(seed * 1.3 + i * 2.5))
    const w = rl * 0.44
    const pBaseTop:Vec3 = [cs * 0.12, y + thick * 0.52, sn * 0.12]
    const pBaseBot:Vec3 = [cs * 0.12, y - thick * 0.28, sn * 0.12]
    const pMidL:Vec3 = [cs * rl * 0.56 - sn * w, y + lift * 0.35, sn * rl * 0.56 + cs * w]
    const pMidR:Vec3 = [cs * rl * 0.56 + sn * w, y + lift * 0.35, sn * rl * 0.56 - cs * w]
    const pMidTop:Vec3 = [cs * rl * 0.52, y + thick * 0.42 + lift * 0.35, sn * rl * 0.52]
    const pTip:Vec3 = [cs * rl, y + lift, sn * rl]
    tris.push(
      [pBaseTop, pMidR, pMidTop], [pBaseTop, pMidTop, pMidL],
      [pMidTop, pMidR, pTip], [pMidTop, pTip, pMidL],
      [pBaseBot, pMidL, pTip], [pBaseBot, pTip, pMidR],
    )
  }
  return tris
}

function evalFronds([ox, oy, oz]:Vec3, count:number, length:number, width:number, rise:number, droop:number, segs:number, phase = 0):Vec3[][] {
  const tris:Vec3[][] = []
  for (let i = 0; i < count; i++) {
    const yaw = phase + (i / count) * Math.PI * 2 + (i % 2) * 0.10, cs = Math.cos(yaw), sn = Math.sin(yaw)
    const L = length * (0.94 + (i % 3) * 0.05)
    const wp = (rr:number, yy:number, lat:number):Vec3 => [ox + rr * cs - lat * sn, yy, oz + rr * sn + lat * cs]
    const st:[number, number, number, number][] = []
    for (let s = 0; s <= segs; s++) {
      const u = s / segs
      const rr = L * (0.88 * Math.sin(u * Math.PI * 0.58) + 0.12 * u)
      const yy = oy + Math.sin(u * Math.PI * 0.52) * rise - Math.pow(u, 2.15) * droop
      const ww = width * Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.88) * (1 - 0.25 * u * u) + 0.04
      st.push([rr, yy, ww, 0.14 * ww])
    }
    for (let s = 0; s < segs; s++) {
      const [r0, y0, w0, f0] = st[s], [r1, y1, w1, f1] = st[s + 1]
      const l0 = wp(r0, y0 - f0, -w0), m0 = wp(r0, y0 + f0 * 0.5, 0), rt0 = wp(r0, y0 - f0, w0)
      const l1 = wp(r1, y1 - f1, -w1), m1 = wp(r1, y1 + f1 * 0.5, 0), rt1 = wp(r1, y1 - f1, w1)
      tris.push([l0, m0, m1], [l0, m1, l1], [m0, rt0, rt1], [m0, rt1, m1])
    }
  }
  return tris
}

function evalStrands([ox, , oz]:Vec3, count:number, innerR:number, outerR:number, topY:number, arch:number, botY:number, width:number, segs:number, phase = 0):Vec3[][] {
  const tris:Vec3[][] = []
  for (let i = 0; i < count; i++) {
    const yaw = phase + (i / count) * Math.PI * 2 + Math.sin(i * 2.1) * 0.08, cs = Math.cos(yaw), sn = Math.sin(yaw)
    const drop = botY + (i % 4) * 0.22
    const rEnd = outerR * (0.88 + (i % 3) * 0.08)
    const twist = (i % 2 === 0) ? 0.55 : -0.55, ct = Math.cos(twist), stAng = Math.sin(twist)
    const wp = (rr:number, yy:number, off:number):Vec3 => {
      const rxD = off * stAng * 0.35, tzD = off * ct
      return [ox + (rr + rxD) * cs - tzD * sn, yy, oz + (rr + rxD) * sn + tzD * cs]
    }
    const st:[number, number, number][] = []
    for (let s = 0; s <= segs; s++) {
      const u = s / segs
      const rr = innerR + (rEnd - innerR) * (1 - Math.pow(1 - u, 1.7))
      const yy = topY * (1 - Math.pow(u, 1.45)) + drop * Math.pow(u, 1.45) + Math.sin(u * Math.PI) * arch * (1 - u * 0.65)
      const ww = width * (0.45 + 0.65 * Math.sin(u * Math.PI * 0.75)) * (1 - 0.72 * u) + 0.015
      st.push([rr, yy, ww])
    }
    for (let s = 0; s < segs; s++) {
      const [r0, y0, w0] = st[s], [r1, y1, w1] = st[s + 1]
      const a0 = wp(r0, y0, -w0), b0 = wp(r0, y0, w0), a1 = wp(r1, y1, -w1), b1 = wp(r1, y1, w1)
      tris.push([a0, b0, b1], [a0, b1, a1])
    }
  }
  return tris
}

function triNormal(a:Vec3, b:Vec3, c:Vec3):Vec3 {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2]
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2]
  const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx
  const ln = Math.hypot(nx, ny, nz) || 1
  return [nx / ln, ny / ln, nz / ln]
}

function evalPart(part:PartSpec):{tris:Vec3[][]; isWood:boolean} {
  const op = part.op as string
  if (op === 'tube') return {tris:evalTube(part.pts, part.sides), isWood:true}
  if (op === 'bundles') return {tris:evalBundles(part.clusters), isWood:true}
  if (op === 'blob') return {tris:evalBlob(part.r, part.p, part.yaw, part.seed, part.subdiv, part.jitter ?? 0.15), isWood:false}
  if (op === 'whorl') return {tris:evalWhorl(part.y, part.r, part.thick, part.lift, part.lobes, part.yaw, part.seed), isWood:false}
  if (op === 'fronds') return {tris:evalFronds(part.origin, part.count, part.length, part.width, part.rise, part.droop, part.segs, part.phase ?? 0), isWood:false}
  if (op === 'strands') return {tris:evalStrands(part.origin, part.count, part.innerR, part.outerR, part.topY, part.arch, part.botY, part.width, part.segs, part.phase ?? 0), isWood:false}
  return {tris:[], isWood:false}
}

function buildGeometry(parts:PartSpec[], neutralWhite = false) {
  const evaluated = parts.map(part => ({part, ...evalPart(part)}))
  let cYmin = Infinity, cYmax = -Infinity
  for (const item of evaluated) {
    if (item.isWood) continue
    for (const [a, b, c] of item.tris) {
      cYmin = Math.min(cYmin, a[1], b[1], c[1])
      cYmax = Math.max(cYmax, a[1], b[1], c[1])
    }
  }
  if (!Number.isFinite(cYmin)) { cYmin = 0; cYmax = 1 }
  const cSpan = Math.max(0.5, cYmax - cYmin)

  const pos:number[] = [], col:number[] = []
  for (const {part, tris, isWood} of evaluated) {
    if (!tris.length) continue
    const cHex = neutralWhite && !isWood ? 0x6b8f55 : (part.c as number)
    const litHex = neutralWhite && !isWood ? 0xa3c96e : (part.lit as number)
    const darkHex = neutralWhite && !isWood ? 0x2d4d31 : (part.dark as number)
    tmpC0.setHex(darkHex); tmpC1.setHex(cHex); tmpC2.setHex(litHex)

    if (isWood) {
      let wMin = Infinity, wMax = -Infinity
      for (const [a, b, c] of tris) {
        const ym = (a[1] + b[1] + c[1]) / 3
        if (ym < wMin) wMin = ym
        if (ym > wMax) wMax = ym
      }
      const wSpan = Math.max(0.2, wMax - wMin)
      for (const [a, b, c] of tris) {
        const ym = (a[1] + b[1] + c[1]) / 3
        const [nx, ny, nz] = triNormal(a, b, c)
        const sun = Math.max(0, Math.min(1, (-0.45 * nx + 0.35 * ny + 0.55 * nz) * 0.5 + 0.5))
        const t = 0.45 * ((ym - wMin) / wSpan) + 0.55 * sun
        if (t < 0.5) tmpOut.copy(tmpC0).lerp(tmpC1, t * 2)
        else tmpOut.copy(tmpC1).lerp(tmpC2, (t - 0.5) * 2)
        pos.push(...a, ...b, ...c)
        col.push(tmpOut.r, tmpOut.g, tmpOut.b, tmpOut.r, tmpOut.g, tmpOut.b, tmpOut.r, tmpOut.g, tmpOut.b)
      }
    } else {
      for (const [a, b, c] of tris) {
        const ym = (a[1] + b[1] + c[1]) / 3
        const [, ny] = triNormal(a, b, c)
        const hT = Math.max(0, Math.min(1, (ym - cYmin) / cSpan))
        const nT = ny * 0.5 + 0.5
        const t = Math.max(0, Math.min(1, 0.58 * hT + 0.42 * nT))
        if (t < 0.5) tmpOut.copy(tmpC0).lerp(tmpC1, t * 2)
        else tmpOut.copy(tmpC1).lerp(tmpC2, (t - 0.5) * 2)
        pos.push(...a, ...b, ...c)
        col.push(tmpOut.r, tmpOut.g, tmpOut.b, tmpOut.r, tmpOut.g, tmpOut.b, tmpOut.r, tmpOut.g, tmpOut.b)
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.computeVertexNormals()
  return g
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
    .replace('#include <opaque_fragment>',`#if NUM_HEMI_LIGHTS > 0
  outgoingLight = max(outgoingLight, diffuseColor.rgb * hemisphereLights[0].skyColor * ${look.treeShadeFloor.toFixed(3)});
#endif
#include <opaque_fragment>`)
  if(!shader.fragmentShader.includes('hemisphereLights[0].skyColor'))throw Error('Tree shade floor did not patch the fragment shader')
}

export const builders = specs.map(spec => () => ({
  near: buildGeometry(spec.near),
  mid: buildGeometry(spec.mid),
  far: buildGeometry(spec.far),
}))

export function treeNearAsset(species:number) {
  return {geometry:buildGeometry(specs[species].near),material}
}

export function treeGeometry(species:number) {
  const builder = builders[species] ?? builders[0]
  const {near, mid, far} = builder()
  return {near, mid, far, material}
}

// 4 organic 3D proxy archetypes for LOD1 & LOD2:
//   0: wide dome broadleaf (camphor/banyan/virens/bischofia/willow/shrub)
//   1: upright ovoid/columnar broadleaf (osmanthus/elaeocarpus/ginkgo)
//   2: narrow conical spire (conifer)
//   3: tall-stemmed fan/royal palm (palm)
const NEUTRAL_BASE = new THREE.Color(0x6b8f55)
const ARCHETYPE_SPECIES:[number, number, number, number] = [0, 8, 4, 3]

function measureBounds(parts:PartSpec[]):[number, number] {
  const g = buildGeometry(parts)
  g.computeBoundingBox()
  const bb = g.boundingBox!
  const w = Math.max(0.5, bb.max.x - bb.min.x, bb.max.z - bb.min.z)
  const h = Math.max(1.0, bb.max.y)
  g.dispose()
  return [w, h]
}

const REF_MID = ARCHETYPE_SPECIES.map(idx => measureBounds(specs[idx].mid))


const PROXY_META:{group:0|1|2|3; midScale:Vec3; proxyTint:THREE.Color}[] = specs.map((spec, idx) => {
  const group:0|1|2|3 = idx === 3 ? 3 : idx === 4 ? 2 : (idx === 2 || idx === 8 || idx === 9) ? 1 : 0
  const [w, h] = measureBounds(spec.near)
  const [rmW, rmH] = REF_MID[group]
  const leafPart = spec.near.find(p => p.op !== 'tube' && p.op !== 'bundles') ?? spec.near[0]
  const spCol = new THREE.Color(leafPart.c)
  const proxyTint = idx === 3 ? new THREE.Color(1, 1, 1) : new THREE.Color(
    spCol.r / Math.max(0.05, NEUTRAL_BASE.r),
    spCol.g / Math.max(0.05, NEUTRAL_BASE.g),
    spCol.b / Math.max(0.05, NEUTRAL_BASE.b),
  )
  return {
    group,
    midScale: [w / rmW, h / rmH, w / rmW],
    proxyTint,
  }
})

function makeSharedProxies() {
  const mid = ARCHETYPE_SPECIES.map(idx => buildGeometry(specs[idx].mid, idx !== 3))
  return {mid, far:mid.map(mesh => treeCards(mesh, material)), material}
}

let cachedShared:ReturnType<typeof makeSharedProxies> | undefined
export function sharedProxyAssets() {
  return cachedShared ??= makeSharedProxies()
}

export function applyTreeVariant(
  species:number,
  seed:number,
  baseScale:number,
  yawRad:number,
  slopeQuat:THREE.Quaternion,
  x:number, y:number, z:number,
  outNearMat:THREE.Matrix4,
  outMidMat:THREE.Matrix4,
  outNearTint:THREE.Color,
  outProxyTint:THREE.Color,
):0|1|2|3 {
  const sp = specs[species] ?? specs[0]
  const meta = PROXY_META[species] ?? PROXY_META[0]
  const variant = sp.variants[seed % sp.variants.length]
  const j = look.trees.treeJitter
  const h = ((seed * 37) % 256) / 255 - 0.5
  const v = ((seed * 101) % 256) / 255 - 0.5
  outNearTint.setRGB(
    (1 + v * j * 2 + h * j) * variant.tint[0],
    (1 + v * j * 2) * variant.tint[1],
    (1 + v * j * 2 - h * j * 1.5) * variant.tint[2],
  )
  outProxyTint.copy(outNearTint).multiply(meta.proxyTint)

  const obj = tmpObj
  obj.position.set(x, y, z)
  obj.quaternion.copy(slopeQuat)
  obj.rotateY(yawRad)
  if (Math.abs(variant.lean) > 1e-4) obj.rotateZ(-variant.lean)
  const sx = baseScale * variant.scale[0], sy = baseScale * variant.scale[1], sz = baseScale * variant.scale[2]
  obj.scale.set(sx, sy, sz)
  obj.updateMatrix()
  outNearMat.copy(obj.matrix)

  obj.scale.set(sx * meta.midScale[0], sy * meta.midScale[1], sz * meta.midScale[2])
  obj.updateMatrix()
  outMidMat.copy(obj.matrix)

  return meta.group
}
