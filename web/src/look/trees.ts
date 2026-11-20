import * as THREE from 'three'
import treeSpecs from '../../../pipeline/tree-specs.json'
import {look} from './config'

// M2.6-26 Guilin street & waterfront tree models (docs/trees.md, pipeline/trees.py).
// Species order preserves GL04 0..5 and appends 6..10 at the tail:
//   0 camphor, 1 banyan, 2 osmanthus, 3 palm, 4 conifer, 5 shrub,
//   6 virens, 7 bischofia, 8 elaeocarpus, 9 ginkgo, 10 willow.
// `treeGeometry(kind)` returns `{near, mid, far, material}` (compatible with IDOK-72's
// `{near, far, material}` single-BufferGeometry + instanceColor contract).

type Vec3 = [number, number, number]
type PartSpec = Record<string, any>
type VariantSpec = {scale:Vec3, lean:number, tint:Vec3}
type SpeciesSpec = {
  id:number; name:string; zh:string; latin:string
  variants:VariantSpec[]
  near:PartSpec[]; mid:PartSpec[]; far:PartSpec[]
}

const specs = (treeSpecs as unknown as {species:SpeciesSpec[]}).species
export const TREE_SPECIES_COUNT = specs.length

const cLo = new THREE.Color(), cMid = new THREE.Color(), cHi = new THREE.Color(), cTmp = new THREE.Color()
const uVec = new THREE.Vector3(), vVec = new THREE.Vector3(), tVec = new THREE.Vector3(), refVec = new THREE.Vector3()

function shadedTriangles(tris:Vec3[][], cHex:number, litHex:number, darkHex:number, outPos:number[], outCol:number[]) {
  if (!tris.length) return
  let yMin = Infinity, yMax = -Infinity
  const ys = new Float32Array(tris.length)
  for (let i = 0; i < tris.length; i++) {
    const ym = (tris[i][0][1] + tris[i][1][1] + tris[i][2][1]) / 3
    ys[i] = ym
    if (ym < yMin) yMin = ym
    if (ym > yMax) yMax = ym
  }
  const span = Math.max(0.01, yMax - yMin)
  cLo.setHex(darkHex); cMid.setHex(cHex); cHi.setHex(litHex)
  for (let i = 0; i < tris.length; i++) {
    const t = Math.max(0, Math.min(1, (ys[i] - yMin) / span))
    if (t < 0.5) cTmp.copy(cLo).lerp(cMid, t * 2)
    else cTmp.copy(cMid).lerp(cHi, (t - 0.5) * 2)
    const tri = tris[i]
    for (let k = 0; k < 3; k++) {
      outPos.push(tri[k][0], tri[k][1], tri[k][2])
      outCol.push(cTmp.r, cTmp.g, cTmp.b)
    }
  }
}

function evalTube(pts:number[][], sides:number):Vec3[][] {
  const rings:Vec3[][] = []
  for (let i = 0; i < pts.length; i++) {
    const [x, y, z, r] = pts[i]
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(pts.length - 1, i + 1)]
    tVec.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
    if (tVec.lengthSq() > 1e-12) tVec.normalize(); else tVec.set(0, 1, 0)
    refVec.set(Math.abs(tVec.z) > 0.92 ? 1 : 0, 0, Math.abs(tVec.z) > 0.92 ? 0 : 1)
    uVec.crossVectors(tVec, refVec).normalize()
    vVec.crossVectors(tVec, uVec)
    const ring:Vec3[] = []
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a)
      ring.push([x + r * (ca * uVec.x + sa * vVec.x), y + r * (ca * uVec.y + sa * vVec.y), z + r * (ca * uVec.z + sa * vVec.z)])
    }
    rings.push(ring)
  }
  const tris:Vec3[][] = []
  for (let i = 0; i < rings.length - 1; i++) {
    const r0 = rings[i], r1 = rings[i + 1]
    for (let s = 0; s < sides; s++) {
      const sn = (s + 1) % sides
      tris.push([r0[s], r0[sn], r1[sn]], [r0[s], r1[sn], r1[s]])
    }
  }
  return tris
}

function evalTuft([rx, ry, rz]:Vec3, [px, py, pz]:Vec3, yaw:number, seed:number, rings:number, segs:number):Vec3[][] {
  const effRings = Math.max(1, rings - 1)
  const effSegs = rings >= 3 ? Math.max(5, segs - 1) : segs
  const cs = Math.cos(yaw), sn = Math.sin(yaw)
  const xf = (lx:number, ly:number, lz:number):Vec3 => [lx * cs + lz * sn + px, ly + py, -lx * sn + lz * cs + pz]
  const top = xf(0, ry * 0.98, 0), bot = xf(0, -ry * 0.56, 0)
  const bands:Vec3[][] = []
  for (let rIdx = 1; rIdx <= effRings; rIdx++) {
    const v = rIdx / (effRings + 1), phi = (0.5 - v) * Math.PI
    const sy = Math.sin(phi), cy = Math.cos(phi)
    const yLocal = ry * sy * (sy >= 0 ? 0.98 : 0.58)
    const band:Vec3[] = []
    for (let s = 0; s < effSegs; s++) {
      const th = (s / effSegs) * Math.PI * 2
      const lobe = 1 + 0.13 * Math.sin(3 * th + seed * 0.7) + 0.08 * Math.cos(5 * th - seed * 1.3 + rIdx)
      const bumpY = 0.07 * ry * Math.sin(2 * th + seed + rIdx * 1.7)
      band.push(xf(rx * cy * lobe * Math.cos(th), yLocal + bumpY, rz * cy * lobe * Math.sin(th)))
    }
    bands.push(band)
  }
  const tris:Vec3[][] = []
  for (let s = 0; s < effSegs; s++) {
    const sNext = (s + 1) % effSegs
    tris.push([top, bands[0][sNext], bands[0][s]], [bands[bands.length - 1][s], bands[bands.length - 1][sNext], bot])
  }
  for (let b = 0; b < bands.length - 1; b++) {
    const b0 = bands[b], b1 = bands[b + 1]
    for (let s = 0; s < effSegs; s++) {
      const sNext = (s + 1) % effSegs
      tris.push([b0[s], b0[sNext], b1[sNext]], [b0[s], b1[sNext], b1[s]])
    }
  }
  return tris
}

function evalTier(y0:number, y1:number, r0:number, r1:number, segs:number, yaw:number, scallop:number):Vec3[][] {
  const n = segs * 2, yMid = y0 + (y1 - y0) * 0.12
  const botRing:Vec3[] = [], topRing:Vec3[] = []
  for (let i = 0; i < n; i++) {
    const th = yaw + (i / n) * Math.PI * 2, tip = i % 2 === 0
    const rad = r0 * (tip ? 1 + scallop : 1 - scallop * 0.75)
    botRing.push([rad * Math.cos(th), tip ? y0 : yMid, rad * Math.sin(th)])
    topRing.push([r1 * Math.cos(th), y1, r1 * Math.sin(th)])
  }
  const tris:Vec3[][] = []
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n
    if (r1 < 0.08) tris.push([botRing[i], [0, y1, 0], botRing[next]])
    else tris.push([botRing[i], topRing[next], botRing[next]], [botRing[i], topRing[i], topRing[next]])
  }
  return tris
}

function evalFronds([ox, oy, oz]:Vec3, count:number, length:number, width:number, rise:number, droop:number, segs:number):Vec3[][] {
  const tris:Vec3[][] = []
  for (let i = 0; i < count; i++) {
    const tierMul = i % 2 ? 0.86 : 1, yaw = (i / count) * Math.PI * 2 + (i % 2) * 0.18
    const cs = Math.cos(yaw), sn = Math.sin(yaw)
    const wp = (rr:number, yy:number, zz:number):Vec3 => [ox + rr * cs - zz * sn, yy, oz + rr * sn + zz * cs]
    const st:[number, number, number, number][] = []
    for (let s = 0; s <= segs; s++) {
      const u = s / segs
      const r = 0.15 + u * length * tierMul
      const y = oy + Math.sin(u * 2.05) * rise * tierMul - u * u * droop * (i % 2 ? 1.15 : 0.92)
      const w = width * Math.sin(Math.max(0.08, Math.min(0.96, u)) * Math.PI) * (1 - u * 0.35)
      st.push([r, y, w, 0.14 * w])
    }
    for (let s = 0; s < segs; s++) {
      const [r0, y0, w0, f0] = st[s], [r1, y1, w1, f1] = st[s + 1]
      const m0 = wp(r0, y0 + f0, 0), m1 = wp(r1, y1 + f1, 0)
      const l0 = wp(r0, y0, -w0), l1 = wp(r1, y1, -w1)
      const rt0 = wp(r0, y0, w0), rt1 = wp(r1, y1, w1)
      tris.push([l0, m1, m0], [l0, l1, m1], [m0, m1, rt1], [m0, rt1, rt0])
    }
  }
  return tris
}

function evalCurtains([ox, , oz]:Vec3, count:number, innerR:number, outerR:number, topY:number, botY:number, width:number, segs:number):Vec3[][] {
  const tris:Vec3[][] = []
  for (let i = 0; i < count; i++) {
    const yaw = (i / count) * Math.PI * 2 + (i % 3) * 0.11, cs = Math.cos(yaw), sn = Math.sin(yaw)
    const drop = botY + (i % 3) * 0.32
    const wp = (rr:number, yy:number, off:number):Vec3 => [ox + rr * cs - off * sn, yy, oz + rr * sn + off * cs]
    const st:[number, number, number][] = []
    for (let s = 0; s <= segs; s++) {
      const u = s / segs
      const rr = innerR + (outerR - innerR) * Math.sin(u * Math.PI * 0.62)
      const yy = topY + Math.sin(u * 1.2) * 0.35 - Math.pow(u, 1.35) * (topY - drop)
      const ww = width * (0.55 + 0.55 * Math.sin(u * Math.PI)) * (1 - 0.55 * u)
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

function evalCross(part:PartSpec, outPos:number[], outCol:number[]) {
  const tt = part.trunkTop as number, tr = part.trunkR as number
  if (tt > 4.0) {
    const trunkTris:Vec3[][] = []
    for (let axis = 0; axis < 2; axis++) {
      const a:Vec3 = axis === 0 ? [-tr, -0.8, 0] : [0, -0.8, -tr]
      const b:Vec3 = axis === 0 ? [tr, -0.8, 0] : [0, -0.8, tr]
      const c:Vec3 = axis === 0 ? [tr * 0.7, tt, 0] : [0, tt, tr * 0.7]
      const d:Vec3 = axis === 0 ? [-tr * 0.7, tt, 0] : [0, tt, -tr * 0.7]
      trunkTris.push([a, b, c], [a, c, d])
    }
    const tc = part.trunkColor as number
    shadedTriangles(trunkTris, tc, tc, tc, outPos, outCol)
  }
  const prof = part.profile as number[][], crownTris:Vec3[][] = []
  const ya = prof[0][0] * 0.85, wa = prof[0][1] * 0.75
  const ym = prof[1][0], wm = prof[1][1]
  const yt = prof[prof.length - 1][0], wt = prof[prof.length - 1][1]
  for (const [y0, w0, y1, w1] of [[ya, wa, ym, wm], [ym, wm, yt, wt]]) {
    for (let axis = 0; axis < 2; axis++) {
      const a:Vec3 = axis === 0 ? [-w0, y0, 0] : [0, y0, -w0]
      const b:Vec3 = axis === 0 ? [w0, y0, 0] : [0, y0, w0]
      const c:Vec3 = axis === 0 ? [w1, y1, 0] : [0, y1, w1]
      const d:Vec3 = axis === 0 ? [-w1, y1, 0] : [0, y1, -w1]
      crownTris.push([a, b, c], [a, c, d])
    }
  }
  const cy = part.capY as number, cr = part.capR as number
  crownTris.push([[-cr, cy, 0], [0, cy + 0.25, cr], [cr, cy, 0]], [[-cr, cy, 0], [cr, cy, 0], [0, cy + 0.25, -cr]])
  shadedTriangles(crownTris, part.c, part.lit, part.dark, outPos, outCol)
}

function buildGeometry(parts:PartSpec[], neutralWhite = false) {
  const pos:number[] = [], col:number[] = []
  for (const part of parts) {
    const c = neutralWhite && part.op !== 'tube' ? 0x6b8f55 : part.c
    const lit = neutralWhite && part.op !== 'tube' ? 0xa3c96e : part.lit
    const dark = neutralWhite && part.op !== 'tube' ? 0x2d4d31 : part.dark
    if (part.op === 'cross') {
      evalCross(neutralWhite ? {...part, c, lit, dark} : part, pos, col)
      continue
    }
    let tris:Vec3[][] = []
    if (part.op === 'tube') tris = evalTube(part.pts, part.sides)
    else if (part.op === 'tuft') tris = evalTuft(part.r, part.p, part.yaw, part.seed, part.rings, part.segs)
    else if (part.op === 'tier') tris = evalTier(part.y0, part.y1, part.r0, part.r1, part.segs, part.yaw, part.scallop)
    else if (part.op === 'fronds') tris = evalFronds(part.origin, part.count, part.length, part.width, part.rise, part.droop, part.segs)
    else if (part.op === 'curtains') tris = evalCurtains(part.origin, part.count, part.innerR, part.outerR, part.topY, part.botY, part.width, part.segs)
    shadedTriangles(tris, c, lit, dark, pos, col)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.computeVertexNormals()
  return g
}

const material = new THREE.MeshStandardMaterial({vertexColors:true, flatShading:true, roughness:1, metalness:0, side:THREE.DoubleSide})

export const builders = specs.map(spec => () => ({
  near: buildGeometry(spec.near),
  mid: buildGeometry(spec.mid),
  far: buildGeometry(spec.far),
}))

export function treeGeometry(species:number) {
  const builder = builders[species] ?? builders[0]
  const {near, mid, far} = builder()
  return {near, mid, far, material}
}

// Shared LOD1 (2 morphological archetypes: broadleaf crown vs spire/columnar) & LOD2 (1 universal crossed silhouette)
// so 11 species × 3 LODs never exceed baseline draw calls on any WebGL2 device.
const NEUTRAL_BASE = new THREE.Color(0x6b8f55)
const PROXY_META:{midGroup:0|1; midScale:Vec3; farScale:Vec3; proxyTint:THREE.Color}[] = specs.map((spec, idx) => {
  const midGroup:0|1 = (idx === 4 || idx === 8 || idx === 3) ? 1 : 0
  const refMid:[number, number] = midGroup === 1 ? [4.9, 15.1] : [9.2, 11.2]
  const nearGeom = buildGeometry(spec.near)
  nearGeom.computeBoundingBox()
  const bb = nearGeom.boundingBox!
  const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z), h = Math.max(1.2, bb.max.y)
  nearGeom.dispose()
  const leafPart = spec.near.find(p => p.op !== 'tube') ?? spec.near[0]
  const spCol = new THREE.Color(leafPart.c)
  const proxyTint = new THREE.Color(
    spCol.r / Math.max(0.05, NEUTRAL_BASE.r),
    spCol.g / Math.max(0.05, NEUTRAL_BASE.g),
    spCol.b / Math.max(0.05, NEUTRAL_BASE.b),
  )
  return {
    midGroup,
    midScale: [w / refMid[0], h / refMid[1], w / refMid[0]],
    farScale: [w / 9.4, h / 11.3, w / 9.4],
    proxyTint,
  }
})

let cachedShared:{mid:[THREE.BufferGeometry, THREE.BufferGeometry]; far:THREE.BufferGeometry; material:THREE.Material}|null = null
export function sharedProxyAssets() {
  return cachedShared ??= {
    mid: [
      buildGeometry(specs[0].mid, true),
      buildGeometry(specs[4].mid, true),
    ],
    far: buildGeometry(specs[0].far, true),
    material,
  }
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
  outFarMat:THREE.Matrix4,
  outNearTint:THREE.Color,
  outProxyTint:THREE.Color,
):0|1 {
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
  if (Math.abs(variant.lean) > 1e-4) obj.rotateZ(variant.lean)
  const sx = baseScale * variant.scale[0], sy = baseScale * variant.scale[1], sz = baseScale * variant.scale[2]
  obj.scale.set(sx, sy, sz)
  obj.updateMatrix()
  outNearMat.copy(obj.matrix)

  obj.scale.set(sx * meta.midScale[0], sy * meta.midScale[1], sz * meta.midScale[2])
  obj.updateMatrix()
  outMidMat.copy(obj.matrix)

  // Far crossed silhouette stays upright for clean distant skyline reading
  obj.quaternion.copy(slopeQuat)
  obj.rotateY(yawRad)
  obj.scale.set(sx * meta.farScale[0], sy * meta.farScale[1], sz * meta.farScale[2])
  obj.updateMatrix()
  outFarMat.copy(obj.matrix)

  return meta.midGroup
}
const tmpObj = new THREE.Object3D()
