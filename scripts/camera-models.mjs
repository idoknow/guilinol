#!/usr/bin/env node
// IDOK-183 — procedural camera bodies → public/models/cameras/<id>.glb + manifest.json
//
// Conventions (shared with the camera system in IDOK-182):
//   1 unit = 1 m, lens looks down -Z, top = +Y, right-hand grip = +X,
//   origin = grip point (mirrorless: grip centre, action: body centre,
//   pocket: middle of handle, thumb: body centre).
// Each model: ≤ 2500 triangles, ≤ 3 PBR materials (factors only, no textures).
// Nodes: <id> (root) → body / lens / screen / controls / details …
//
// Usage: node scripts/camera-models.mjs            # build all
//        node scripts/camera-models.mjs --check    # build + print stats only (no write)

import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const OUT = path.resolve(import.meta.dirname, '../public/models/cameras')
const MAX_TRIS = 2500
const MAX_MATS = 3
const { PI } = Math

// ---------------------------------------------------------------- geometry helpers

function clean(g) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k)
  if (!g.index) {
    const n = g.attributes.position.count
    g.setIndex([...Array(n).keys()])
  }
  g.clearGroups()
  return g
}
const rbox = (w, h, d, r, seg = 1) => clean(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) - 1e-6))
const box = (w, h, d) => clean(new THREE.BoxGeometry(w, h, d))
function axisify(g, axis) {
  if (axis === 'z') g.rotateX(PI / 2) // cylinder top (+Y) → -Z? rotateX(+90°) maps +Y → +Z
  else if (axis === '-z') g.rotateX(-PI / 2) // +Y → -Z
  else if (axis === 'x') g.rotateZ(-PI / 2) // +Y → +X
  else if (axis === '-x') g.rotateZ(PI / 2)
  else if (axis === '-y') g.rotateX(PI)
  return g
}
// Cylinder along `axis`; only the outward (top) cap by default — the other end is buried in the body.
function cyl(r, h, seg = 16, axis = 'y', rBottom = r, caps = 'top') {
  const parts = [clean(new THREE.CylinderGeometry(r, rBottom, h, seg, 1, true))]
  if (caps !== 'none') parts.push(clean(new THREE.CircleGeometry(r, seg).rotateX(-PI / 2).rotateY(PI / seg).translate(0, h / 2, 0)))
  if (caps === 'both') parts.push(clean(new THREE.CircleGeometry(rBottom, seg).rotateX(PI / 2).rotateY(PI / seg).translate(0, -h / 2, 0)))
  return axisify(mergeGeometries(parts, false), axis)
}
const cyl2 = (r, h, seg, axis, rBottom = r) => cyl(r, h, seg, axis, rBottom, 'both')
// Flat dark disc (holes, LEDs, screws seen from afar) facing along `axis`.
const disc = (r, seg = 6, axis = 'y') => axisify(clean(new THREE.CircleGeometry(r, seg).rotateX(-PI / 2)), axis)
// Rounded-rectangle plate: w×h in XY, extruded d along Z (cheap alternative to RoundedBoxGeometry).
function plate(w, h, d, r, curve = 2) {
  const s = new THREE.Shape()
  const x = -w / 2, y = -h / 2
  r = Math.min(r, w / 2, h / 2)
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y)
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: curve })
  g.translate(0, 0, -d / 2)
  return clean(g)
}
const tube = (r, h, seg = 16, axis = 'y') => axisify(clean(new THREE.CylinderGeometry(r, r, h, seg, 1, true)), axis)
const torus = (R, r, rs = 6, ts = 12, arc = 2 * PI) => clean(new THREE.TorusGeometry(R, r, rs, ts, arc))
// Knurled ring: alternate rim vertices in/out, flat-shaded so ribs read in low light.
function ribbed(r, h, seg, depth, axis = 'y') {
  const g = new THREE.CylinderGeometry(r, r, h, seg, 1, false)
  const p = g.attributes.position
  const step = (2 * PI) / seg
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i)
    const rad = Math.hypot(x, z)
    if (rad < r * 0.98) continue
    const a = Math.atan2(x, z)
    const k = Math.round(a / step)
    const rr = k % 2 === 0 ? r : r - depth
    p.setX(i, Math.sin(a) * rr)
    p.setZ(i, Math.cos(a) * rr)
  }
  const flat = g.toNonIndexed()
  flat.computeVertexNormals()
  return axisify(clean(flat), axis)
}
// Lathe around the optical axis; profile = [[radius, distance-in-front-of-mount], …].
function lensLathe(profile, seg, zStart) {
  const pts = profile.map(([r, d]) => new THREE.Vector2(r, d))
  const g = new THREE.LatheGeometry(pts, seg)
  // Lathe axis is +Y; map +Y → -Z (distance in front of mount)
  g.rotateX(-PI / 2)
  g.translate(0, 0, zStart)
  return clean(g)
}
function halfSphere(r, ws = 16, hs = 4, bottom = true) {
  const g = new THREE.SphereGeometry(r, ws, hs, 0, 2 * PI, bottom ? PI / 2 : 0, PI / 2)
  return clean(g)
}

// ---------------------------------------------------------------- model builder

class Model {
  constructor(id, materials) {
    this.id = id
    this.materials = materials // { key: {name, color:[r,g,b], metallic, roughness} }
    this.parts = new Map() // group → mat → [geom]
  }
  add(group, mat, geom, pos = [0, 0, 0], rot = [0, 0, 0], scale) {
    if (!this.materials[mat]) throw new Error(`${this.id}: unknown material ${mat}`)
    const g = geom.clone()
    if (scale) g.scale(...scale)
    if (rot[0] || rot[1] || rot[2]) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)))
    g.translate(...pos)
    if (!this.parts.has(group)) this.parts.set(group, new Map())
    const m = this.parts.get(group)
    if (!m.has(mat)) m.set(mat, [])
    m.get(mat).push(g)
    return this
  }
  // returns a THREE.Group hierarchy (also used for stats)
  build(offset = [0, 0, 0]) {
    const root = new THREE.Group()
    root.name = this.id
    const mats = {}
    for (const [k, d] of Object.entries(this.materials)) {
      mats[k] = new THREE.MeshStandardMaterial({ name: d.name, color: new THREE.Color().setRGB(...d.color, THREE.SRGBColorSpace), metalness: d.metallic, roughness: d.roughness })
    }
    for (const [group, byMat] of this.parts) {
      const meshes = []
      for (const [mat, geoms] of byMat) {
        const merged = mergeGeometries(geoms, false)
        if (!merged) throw new Error(`${this.id}/${group}/${mat}: merge failed`)
        merged.translate(-offset[0], -offset[1], -offset[2])
        const mesh = new THREE.Mesh(merged, mats[mat])
        mesh.name = byMat.size === 1 ? group : `${group}_${mat}`
        meshes.push(mesh)
      }
      if (meshes.length === 1) root.add(meshes[0])
      else {
        const g = new THREE.Group()
        g.name = group
        meshes.forEach(m => g.add(m))
        root.add(g)
      }
    }
    return root
  }
}

// ---------------------------------------------------------------- GLB writer (no FileReader needed)

function writeGLB(root, file) {
  const json = { asset: { version: '2.0', generator: 'guilinol scripts/camera-models.mjs' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] }
  const chunks = []
  let byteLength = 0
  const matIndex = new Map()
  const push = (typed, target) => {
    const pad = (4 - (byteLength % 4)) % 4
    if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad }
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength)
    chunks.push(bytes)
    json.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, target })
    byteLength += bytes.byteLength
    return json.bufferViews.length - 1
  }
  const material = m => {
    if (matIndex.has(m)) return matIndex.get(m)
    json.materials.push({
      name: m.name,
      pbrMetallicRoughness: { baseColorFactor: [m.color.r, m.color.g, m.color.b, 1], metallicFactor: m.metalness, roughnessFactor: m.roughness },
    })
    matIndex.set(m, json.materials.length - 1)
    return json.materials.length - 1
  }
  const visit = obj => {
    const idx = json.nodes.length
    const node = { name: obj.name }
    json.nodes.push(node)
    if (obj.isMesh) {
      const g = obj.geometry
      const pos = new Float32Array(g.attributes.position.array)
      const nor = new Float32Array(g.attributes.normal.array)
      g.computeBoundingBox()
      const bb = g.boundingBox
      const vcount = g.attributes.position.count
      const idxArr = vcount > 65535 ? new Uint32Array(g.index.array) : new Uint16Array(g.index.array)
      const pv = push(pos, 34962), nv = push(nor, 34962), iv = push(idxArr, 34963)
      json.accessors.push({ bufferView: pv, componentType: 5126, count: vcount, type: 'VEC3', min: bb.min.toArray(), max: bb.max.toArray() })
      json.accessors.push({ bufferView: nv, componentType: 5126, count: vcount, type: 'VEC3' })
      json.accessors.push({ bufferView: iv, componentType: vcount > 65535 ? 5125 : 5123, count: idxArr.length, type: 'SCALAR' })
      const a = json.accessors.length
      json.meshes.push({ name: obj.name, primitives: [{ attributes: { POSITION: a - 3, NORMAL: a - 2 }, indices: a - 1, material: material(obj.material) }] })
      node.mesh = json.meshes.length - 1
    }
    if (obj.children.length) node.children = obj.children.map(visit)
    return idx
  }
  visit(root)
  const bin = new Uint8Array(byteLength + ((4 - (byteLength % 4)) % 4))
  let o = 0
  for (const c of chunks) { bin.set(c, o); o += c.byteLength }
  json.buffers.push({ byteLength: bin.byteLength })
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  const jpad = (4 - (jsonBytes.length % 4)) % 4
  if (jpad) { const t = new Uint8Array(jsonBytes.length + jpad).fill(0x20); t.set(jsonBytes); jsonBytes = t }
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length
  const out = Buffer.alloc(total)
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8)
  out.writeUInt32LE(jsonBytes.length, 12); out.writeUInt32LE(0x4e4f534a, 16); Buffer.from(jsonBytes).copy(out, 20)
  const b0 = 20 + jsonBytes.length
  out.writeUInt32LE(bin.length, b0); out.writeUInt32LE(0x004e4942, b0 + 4); Buffer.from(bin).copy(out, b0 + 8)
  fs.writeFileSync(file, out)
  return total
}

// ---------------------------------------------------------------- materials

// material colours are authored as sRGB hex; build() converts to linear (glTF baseColorFactor is linear)
const hexToSrgb = hex => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(v => +(v / 255).toFixed(4))

const GLASS = { name: 'glass', color: hexToSrgb(0x366899), metallic: 0.22, roughness: 0.12 }

// ---------------------------------------------------------------- mirrorless (full-frame, 55 mm standard zoom)

function mirrorless() {
  const m = new Model('mirrorless', {
    shell: { name: 'shell_graphite', color: hexToSrgb(0x565e69), metallic: 0.08, roughness: 0.48 },
    metal: { name: 'metal_silver', color: hexToSrgb(0xe6ebf2), metallic: 0.20, roughness: 0.28 },
    glass: GLASS,
  })
  // design frame: slab centred x=0; grip on +X; origin moved to the grip centre at the end
  // --- body shell
  m.add('body', 'shell', rbox(0.120, 0.070, 0.038, 0.006), [0, -0.0075, 0.011]) // y -0.0425..0.0275, z -0.008..0.030
  m.add('body', 'metal', box(0.116, 0.0055, 0.036), [0, 0.0252, 0.011]) // brushed silver top-plate trim
  m.add('body', 'shell', rbox(0.030, 0.064, 0.038, 0.009), [0.045, -0.0105, -0.011]) // grip, z -0.030..0.008
  m.add('body', 'shell', rbox(0.044, 0.015, 0.034, 0.004), [-0.012, 0.0335, 0.011]) // EVF hump y 0.026..0.041
  m.add('body', 'shell', plate(0.026, 0.020, 0.006, 0.004), [-0.012, 0.031, 0.032]) // eyecup → z 0.035
  m.add('body', 'shell', plate(0.020, 0.024, 0.004, 0.004), [0.049, 0.010, 0.031]) // rear thumb rest
  // seams (dark grooves)
  m.add('body', 'glass', box(0.088, 0.0006, 0.0004), [-0.014, 0.019, -0.0081]) // top-plate seam, front
  m.add('body', 'glass', box(0.118, 0.0006, 0.0004), [0, 0.019, 0.0301]) // top-plate seam, back
  m.add('body', 'glass', box(0.0004, 0.0006, 0.036), [-0.0601, 0.019, 0.011]) // seam, left side
  m.add('body', 'glass', box(0.0004, 0.040, 0.0006), [0.0601, -0.012, 0.002]) // card door seam on grip side
  m.add('body', 'glass', box(0.0004, 0.0006, 0.020), [0.0601, 0.008, 0.012])
  m.add('body', 'glass', box(0.0004, 0.0006, 0.020), [0.0601, -0.032, 0.012])

  // --- lens mount + 55 mm standard zoom (Ø64 × 70 mm), optical axis at (-0.012, -0.006)
  const LX = -0.012, LY = -0.006
  m.add('details', 'metal', cyl(0.0312, 0.0045, 24, '-z', 0.0312, 'none'), [LX, LY, -0.0095]) // bayonet ring (side only)
  const z0 = -0.011
  m.add('lens', 'shell', lensLathe([
    [0.0302, 0], [0.0302, 0.011], [0.0296, 0.050], [0.0318, 0.0515], [0.0318, 0.068],
    [0.0300, 0.070], [0.0256, 0.070], [0.0249, 0.066],
  ], 24, z0), [LX, LY, 0])
  m.add('lens', 'shell', ribbed(0.032, 0.022, 32, 0.0011, 'z'), [LX, LY, z0 - 0.022]) // zoom ring
  m.add('lens', 'shell', ribbed(0.0312, 0.014, 40, 0.0007, 'z'), [LX, LY, z0 - 0.0425]) // focus ring
  m.add('lens', 'metal', cyl(0.0310, 0.0052, 24, 'z', 0.0310, 'none'), [LX, LY, z0 - 0.0095]) // mount-side silver band
  m.add('lens', 'metal', cyl(0.0326, 0.0052, 24, 'z', 0.0326, 'none'), [LX, LY, z0 - 0.0535]) // front silver trim ring
  m.add('lens', 'glass', halfSphere(0.0249, 16, 2, false), [LX, LY, z0 - 0.066], [-PI / 2, 0, 0], [1, 0.25, 1]) // front element (domed)
  m.add('lens', 'metal', box(0.0012, 0.003, 0.0008), [LX, LY + 0.0322, z0 - 0.0105]) // index mark
  // --- controls (top)
  m.add('controls', 'metal', cyl(0.0068, 0.0016, 16), [0.046, 0.0222, -0.017]) // on/off collar
  m.add('controls', 'metal', box(0.005, 0.0016, 0.003), [0.053, 0.0222, -0.012]) // collar lever
  m.add('controls', 'metal', cyl(0.0042, 0.0034, 12), [0.046, 0.0247, -0.017]) // shutter
  m.add('controls', 'metal', ribbed(0.0065, 0.004, 16, 0.0006), [0.045, 0.0175, -0.031]) // front dial (in grip)
  m.add('controls', 'metal', ribbed(0.0075, 0.0042, 20, 0.0006), [0.049, 0.0296, 0.022]) // rear dial (top-right)
  m.add('controls', 'metal', ribbed(0.0095, 0.0065, 24, 0.0007), [-0.043, 0.0305, 0.012]) // exposure / mode dial
  m.add('controls', 'metal', disc(0.0082, 16), [-0.043, 0.0339, 0.012]) // dial cap
  m.add('controls', 'metal', box(0.0008, 0.0008, 0.004), [-0.043, 0.0342, 0.0085]) // dial index
  m.add('controls', 'shell', cyl(0.0035, 0.0018, 10), [0.030, 0.0284, 0.004]) // C1
  m.add('controls', 'metal', cyl(0.0028, 0.0016, 10), [0.024, 0.0284, 0.018]) // movie record
  m.add('controls', 'shell', cyl(0.0035, 0.0016, 10, '-z'), [-0.0505, -0.012, -0.0085]) // lens release
  // --- controls (rear)
  m.add('controls', 'metal', cyl(0.0028, 0.0025, 8, 'z'), [0.036, 0.004, 0.0312]) // AF joystick
  m.add('controls', 'shell', ribbed(0.0095, 0.0018, 24, 0.0005, 'z'), [0.041, -0.018, 0.0308]) // control wheel
  m.add('controls', 'metal', disc(0.0042, 12, 'z'), [0.041, -0.018, 0.0320]) // centre button
  for (const [x, y] of [[0.052, -0.003], [0.053, -0.034], [0.029, -0.035], [0.028, 0.016]]) m.add('controls', 'shell', cyl(0.0030, 0.0018, 8, 'z'), [x, y, 0.0306])
  // --- screen (LCD on a bezel) + EVF window
  m.add('screen', 'shell', plate(0.078, 0.054, 0.003, 0.003), [-0.017, -0.012, 0.0313])
  m.add('screen', 'glass', box(0.072, 0.048, 0.0008), [-0.017, -0.012, 0.0331])
  m.add('screen', 'glass', box(0.017, 0.012, 0.0008), [-0.012, 0.0315, 0.0352]) // EVF eyepiece
  m.add('screen', 'glass', disc(0.0018, 8, 'z'), [0.003, 0.0335, 0.0351]) // eye sensor
  // --- hot shoe
  m.add('details', 'metal', box(0.020, 0.0012, 0.019), [-0.012, 0.0411, 0.012])
  m.add('details', 'metal', box(0.0016, 0.0018, 0.019), [-0.0215, 0.0420, 0.012])
  m.add('details', 'metal', box(0.0016, 0.0018, 0.019), [-0.0025, 0.0420, 0.012])
  for (let i = 0; i < 3; i++) m.add('details', 'glass', box(0.0008, 0.0002, 0.003), [-0.015 + i * 0.003, 0.0418, 0.009]) // contacts
  // mic holes on the hump front
  for (let i = 0; i < 3; i++) for (const x0 of [-0.020, -0.0084]) m.add('details', 'glass', disc(0.0006, 6, '-z'), [x0 + i * 0.0022, 0.0365, -0.0061])
  // AF-assist lamp
  m.add('details', 'glass', cyl(0.0026, 0.0010, 10, '-z'), [0.024, 0.012, -0.0083])
  // strap lugs (both sides) — metal loop through a boss
  for (const s of [-1, 1]) {
    m.add('details', 'shell', box(0.003, 0.008, 0.008), [s * 0.0605, 0.016, 0.011])
    m.add('details', 'metal', torus(0.0034, 0.0008, 4, 8), [s * 0.0632, 0.016, 0.011])
  }
  // port door, left side + latch slot
  m.add('details', 'shell', plate(0.026, 0.036, 0.0024, 0.0015), [-0.0598, -0.014, 0.011], [0, PI / 2, 0])
  m.add('details', 'glass', box(0.0006, 0.0006, 0.004), [-0.0611, -0.014, 0.011])
  // bottom: tripod socket, 4 screws, battery door seam
  m.add('details', 'metal', disc(0.0055, 12, '-y'), [LX, -0.04255, 0.011])
  m.add('details', 'glass', disc(0.0030, 10, '-y'), [LX, -0.0426, 0.011])
  for (const [x, z] of [[-0.052, -0.004], [-0.052, 0.026], [0.020, 0.026], [-0.030, 0.026]]) m.add('details', 'metal', disc(0.0012, 6, '-y'), [x, -0.04255, z])
  m.add('details', 'glass', box(0.0006, 0.0004, 0.030), [0.030, -0.0427, -0.011])

  // grip point = centre of the grip block
  return { model: m, origin: [0.045, -0.0105, -0.011] }
}

// ---------------------------------------------------------------- action cam (65 × 45 × 30)

function action() {
  const m = new Model('action', {
    shell: { name: 'shell_graphite', color: hexToSrgb(0x565e6a), metallic: 0.08, roughness: 0.46 },
    accent: { name: 'accent_red', color: hexToSrgb(0xf2463a), metallic: 0.05, roughness: 0.32 },
    glass: GLASS,
  })
  const W = 0.065, H = 0.045, D = 0.030
  m.add('body', 'shell', rbox(W, H, D, 0.005, 2), [0, 0, 0])
  // seam band around the body (front / back shell split)
  m.add('body', 'glass', box(W - 0.006, 0.0005, 0.0005), [0, H / 2 - 0.0002, -0.006])
  m.add('body', 'glass', box(W - 0.006, 0.0005, 0.0005), [0, -H / 2 + 0.0002, -0.006])
  // lens: square housing + round barrel + domed glass, offset to the right (+X, seen from behind)
  const LX = 0.0135, LY = 0.0035
  m.add('lens', 'shell', rbox(0.031, 0.031, 0.006, 0.004), [LX, LY, -D / 2 - 0.001])
  m.add('lens', 'shell', cyl(0.0125, 0.0045, 28, 'z', 0.0135), [LX, LY, -D / 2 - 0.006])
  m.add('lens', 'glass', cyl(0.0102, 0.0010, 28, 'z'), [LX, LY, -D / 2 - 0.0085])
  m.add('lens', 'glass', halfSphere(0.0085, 20, 3, false), [LX, LY, -D / 2 - 0.009], [-PI / 2, 0, 0], [1, 0.55, 1])
  m.add('lens', 'accent', torus(0.0118, 0.0024, 5, 28), [LX, LY, -D / 2 - 0.0076]) // signature bold red trim ring
  for (const [dx, dy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) m.add('lens', 'glass', cyl(0.0008, 0.0005, 6, '-z'), [LX + dx * 0.0125, LY + dy * 0.0125, -D / 2 - 0.0041]) // cover screws
  // front status screen
  m.add('screen', 'glass', box(0.019, 0.019, 0.0008), [-0.017, 0.004, -D / 2 - 0.0002])
  // rear touch screen
  m.add('screen', 'glass', box(0.054, 0.037, 0.0008), [0, 0, D / 2 + 0.0002])
  // controls: top shutter / record + side power/mode
  m.add('controls', 'accent', cyl(0.0058, 0.0008, 20), [0.016, H / 2 + 0.0002, 0.002])
  m.add('controls', 'shell', cyl(0.0046, 0.0018, 20), [0.016, H / 2 + 0.0008, 0.002])
  m.add('controls', 'shell', cyl(0.0040, 0.0016, 14, 'x'), [W / 2 + 0.0006, 0.009, 0.002]) // power/mode
  // record LEDs (front, top, back)
  m.add('details', 'accent', cyl(0.0012, 0.0006, 8, '-z'), [-0.026, 0.017, -D / 2 - 0.0001])
  m.add('details', 'accent', cyl(0.0010, 0.0006, 8), [-0.024, H / 2 + 0.0001, -0.009])
  m.add('details', 'accent', cyl(0.0010, 0.0006, 8, 'z'), [-0.028, 0.0195, D / 2 + 0.0001])
  // mic holes (top)
  for (let i = 0; i < 4; i++) m.add('details', 'glass', cyl(0.0005, 0.0004, 6), [-0.006 - i * 0.002, H / 2 + 0.0001, 0.006])
  // heat-sink slots on +X side
  for (let i = 0; i < 6; i++) m.add('details', 'glass', box(0.0006, 0.0014, 0.018), [W / 2 + 0.0004, 0.0 - i * 0.0034, 0.0])
  m.add('details', 'shell', plate(0.022, 0.024, 0.0008, 0.002), [W / 2 + 0.0002, -0.0085, 0], [0, PI / 2, 0]) // vent plate (slots sit on it)
  // port door, -X side (with latch + seam)
  m.add('details', 'shell', rbox(0.0016, 0.034, 0.022, 0.0007), [-W / 2 - 0.0004, -0.001, 0])
  m.add('details', 'accent', box(0.0008, 0.006, 0.003), [-W / 2 - 0.0012, 0.008, 0]) // door latch
  m.add('details', 'glass', box(0.0006, 0.0004, 0.022), [-W / 2 - 0.0009, -0.0185, 0])
  // bottom: magnetic quick-release plate + folding mount fingers + 1/4" socket
  m.add('details', 'glass', rbox(0.040, 0.0010, 0.022, 0.0005), [0, -H / 2 - 0.0002, 0])
  for (const s of [-1, 1]) m.add('details', 'shell', rbox(0.0032, 0.0022, 0.016, 0.0008), [s * 0.0055, -H / 2 - 0.0015, 0])
  m.add('details', 'shell', cyl(0.0012, 0.015, 8, 'x'), [0, -H / 2 - 0.0016, 0.006]) // hinge pin
  m.add('details', 'shell', cyl(0.0042, 0.0008, 16, '-y'), [0, -H / 2 - 0.0008, -0.007])
  m.add('details', 'glass', cyl(0.0028, 0.0010, 12, '-y'), [0, -H / 2 - 0.0010, -0.007])
  for (const [x, z] of [[-0.016, -0.008], [0.016, -0.008], [-0.016, 0.008], [0.016, 0.008]]) m.add('details', 'shell', cyl(0.0009, 0.0004, 6, '-y'), [x, -H / 2 - 0.0008, z])
  return { model: m, origin: [0, 0, 0] }
}

// ---------------------------------------------------------------- pocket gimbal cam (handle Ø26 × 90)

function pocket() {
  const m = new Model('pocket', {
    shell: { name: 'shell_charcoal', color: hexToSrgb(0x545c67), metallic: 0.08, roughness: 0.44 },
    metal: { name: 'metal_silver', color: hexToSrgb(0xe8edf4), metallic: 0.18, roughness: 0.26 },
    glass: GLASS,
  })
  // handle: y -0.045 … 0.045, origin mid-handle
  const R = 0.013
  m.add('body', 'shell', cyl(R, 0.0845, 24), [0, 0.00275, 0])
  m.add('body', 'shell', halfSphere(R, 24, 3, true), [0, -0.0398, 0], [0, 0, 0], [1, 0.4, 1])
  m.add('body', 'metal', cyl(R + 0.0005, 0.0036, 24), [0, 0.0432, 0]) // top silver collar ring
  m.add('body', 'glass', tube(R + 0.0001, 0.0006, 24), [0, -0.020, 0]) // shell seam
  // user-facing (+Z) panel: screen + joystick + two buttons
  m.add('screen', 'shell', rbox(0.019, 0.026, 0.004, 0.002), [0, 0.0255, 0.0112])
  m.add('screen', 'glass', box(0.016, 0.022, 0.0006), [0, 0.0255, 0.0134])
  m.add('controls', 'shell', cyl(0.0042, 0.0016, 14, 'z'), [0, 0.0055, 0.0124])
  m.add('controls', 'metal', cyl(0.0024, 0.0028, 10, 'z'), [0, 0.0055, 0.0140]) // joystick
  m.add('controls', 'metal', cyl(0.0030, 0.0018, 12, 'z'), [-0.0048, -0.0060, 0.0122]) // record
  m.add('controls', 'shell', cyl(0.0030, 0.0018, 12, 'z'), [0.0048, -0.0060, 0.0122]) // function
  m.add('controls', 'glass', cyl(0.0010, 0.0006, 8, 'z'), [0.0048, -0.0060, 0.0132]) // button dot
  // details: mic holes, USB-C, lanyard hole, 1/4" socket, rubber side
  for (let i = 0; i < 3; i++) m.add('details', 'glass', cyl(0.0005, 0.0004, 6, '-z'), [-0.002 + i * 0.002, 0.036, -R])
  m.add('details', 'glass', rbox(0.0090, 0.0006, 0.0032, 0.0012), [0, -0.0449, 0.002]) // USB-C on bottom
  m.add('details', 'metal', cyl(0.0035, 0.0006, 14, '-y'), [0, -0.0449, -0.0055])
  m.add('details', 'shell', torus(0.0022, 0.0007, 5, 10), [R - 0.0005, -0.036, 0]) // lanyard loop
  m.add('details', 'glass', box(0.0010, 0.030, 0.0006), [-R + 0.0003, -0.005, 0]) // side shell seam
  // gimbal: pan (Y) at handle top → roll (Z) behind head → tilt (X) beside head
  m.add('gimbal', 'shell', cyl(0.0105, 0.0055, 24), [0, 0.0475, 0]) // pan motor
  m.add('gimbal', 'metal', cyl(0.0114, 0.0028, 24), [0, 0.0458, 0]) // pan joint ring
  m.add('gimbal', 'metal', rbox(0.0095, 0.010, 0.013, 0.002), [0, 0.054, 0.010]) // pan → roll riser
  m.add('gimbal', 'shell', cyl(0.0068, 0.0075, 20, 'z'), [0, 0.060, 0.0175]) // roll motor
  m.add('gimbal', 'metal', cyl(0.0076, 0.0026, 20, 'z'), [0, 0.060, 0.0134]) // roll joint ring
  m.add('gimbal', 'metal', rbox(0.023, 0.0072, 0.0072, 0.0018), [0.009, 0.060, 0.0195]) // arm (roll → side)
  m.add('gimbal', 'metal', rbox(0.0072, 0.013, 0.023, 0.0018), [0.0185, 0.064, 0.009]) // arm (side → tilt)
  m.add('gimbal', 'shell', cyl(0.0068, 0.0040, 20, 'x'), [0.0175, 0.067, 0]) // tilt motor
  m.add('gimbal', 'metal', cyl(0.0076, 0.0028, 20, 'x'), [0.0148, 0.067, 0]) // tilt joint ring
  // camera head (26 mm cube) + lens
  m.add('lens', 'shell', rbox(0.026, 0.026, 0.026, 0.004, 2), [0, 0.067, 0])
  m.add('lens', 'shell', cyl(0.0100, 0.0024, 24, 'z', 0.0110), [0, 0.067, -0.0140])
  m.add('lens', 'metal', torus(0.0094, 0.0018, 4, 24), [0, 0.067, -0.0151])
  m.add('lens', 'glass', cyl(0.0080, 0.0006, 24, 'z'), [0, 0.067, -0.0149])
  m.add('lens', 'glass', halfSphere(0.0060, 16, 2, false), [0, 0.067, -0.0151], [-PI / 2, 0, 0], [1, 0.35, 1])
  m.add('lens', 'glass', cyl(0.0009, 0.0004, 6, '-z'), [-0.0095, 0.0765, -0.0131]) // ToF / mic
  return { model: m, origin: [0, 0, 0] }
}

// ---------------------------------------------------------------- thumb cam (50 × 30 × 15)

function thumb() {
  const m = new Model('thumb', {
    shell: { name: 'shell_white', color: hexToSrgb(0xf4f3ef), metallic: 0.0, roughness: 0.36 },
    accent: { name: 'accent_slate', color: hexToSrgb(0x282d36), metallic: 0.14, roughness: 0.36 },
    glass: GLASS,
  })
  const W = 0.052, H = 0.031, D = 0.017
  m.add('body', 'shell', rbox(W, H, D, 0.0075, 3), [0, 0, 0])
  // front: bold dark lens housing (−X seen from behind) so white body + dark eye pops even against light shirts
  const LX = -0.0125
  m.add('lens', 'accent', cyl(0.0106, 0.0034, 28, '-z'), [LX, 0.0008, -D / 2 - 0.0012])
  m.add('lens', 'glass', cyl(0.0078, 0.0012, 24, '-z'), [LX, 0.0008, -D / 2 - 0.0026])
  m.add('lens', 'glass', halfSphere(0.0066, 16, 2, false), [LX, 0.0008, -D / 2 - 0.0028], [-PI / 2, 0, 0], [1, 0.42, 1])
  m.add('lens', 'shell', torus(0.0088, 0.0006, 4, 28), [LX, 0.0008, -D / 2 - 0.0025]) // crisp white lens lip
  // single dark button + perimeter contrast rim
  m.add('controls', 'accent', cyl(0.0060, 0.0012, 20, '-z'), [0.0125, 0.0008, -D / 2 - 0.0004])
  m.add('controls', 'shell', cyl(0.0044, 0.0016, 20, '-z'), [0.0125, 0.0008, -D / 2 - 0.0008])
  // status window on top edge (named screen — no LCD on this body)
  m.add('screen', 'glass', rbox(0.010, 0.0006, 0.0035, 0.0002), [0.006, H / 2 - 0.0001, -0.0005])
  m.add('details', 'glass', cyl(0.0007, 0.0004, 8), [0.0135, H / 2 - 0.0001, -0.0005]) // LED
  // mic holes + speaker grille + charging pins
  for (let i = 0; i < 3; i++) m.add('details', 'glass', cyl(0.00045, 0.0004, 6), [-0.004 - i * 0.0018, H / 2 - 0.0002, 0.001])
  for (const x of [-0.003, 0.003]) m.add('details', 'accent', cyl(0.0008, 0.0004, 8, '-y'), [x, -H / 2 + 0.0001, 0])
  // dark perimeter edge trim so white capsule separates cleanly from light shirts
  m.add('details', 'accent', box(W - 0.012, 0.0018, 0.0024), [0, H / 2 - 0.0004, 0.0015])
  m.add('details', 'accent', box(W - 0.012, 0.0018, 0.0024), [0, -H / 2 + 0.0004, 0.0015])
  // magnetic clip on the back (+Z): plate separated by a gap, bridged at the top
  m.add('clip', 'accent', rbox(0.040, 0.023, 0.0022, 0.0035, 2), [0, -0.0010, D / 2 + 0.0016 + 0.0011])
  m.add('clip', 'accent', rbox(0.026, 0.0040, 0.0052, 0.0012), [0, H / 2 - 0.0035, D / 2 + 0.0012])
  m.add('clip', 'glass', plate(0.016, 0.008, 0.0004, 0.003), [0, 0.001, D / 2 + 0.0040]) // magnet pad
  for (let i = 0; i < 4; i++) m.add('clip', 'glass', box(0.024, 0.0005, 0.0003), [0, -0.0065 - i * 0.0013, D / 2 + 0.0040]) // grip ridges
  return { model: m, origin: [0, 0, 0] }
}

// ---------------------------------------------------------------- main

function stats(root) {
  let tris = 0
  const mats = new Set()
  root.traverse(o => { if (o.isMesh) { tris += o.geometry.index.count / 3; mats.add(o.material.name) } })
  root.updateMatrixWorld(true)
  const bb = new THREE.Box3().setFromObject(root)
  return { tris, materials: mats.size, size: bb.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(4)), min: bb.min.toArray().map(v => +v.toFixed(4)), max: bb.max.toArray().map(v => +v.toFixed(4)) }
}

const check = process.argv.includes('--check')
const manifest = {}
let failed = false
fs.mkdirSync(OUT, { recursive: true })
for (const make of [mirrorless, action, pocket, thumb]) {
  const { model, origin } = make()
  const root = model.build(origin)
  const s = stats(root)
  const names = []
  root.traverse(o => names.push(o.name))
  for (const need of ['body', 'lens', 'screen']) if (!names.includes(need)) { console.error(`${model.id}: missing node ${need}`); failed = true }
  if (s.tris > MAX_TRIS) { console.error(`${model.id}: ${s.tris} tris > ${MAX_TRIS}`); failed = true }
  if (s.materials > MAX_MATS) { console.error(`${model.id}: ${s.materials} materials > ${MAX_MATS}`); failed = true }
  let bytes = 0
  if (!check) bytes = writeGLB(root, path.join(OUT, `${model.id}.glb`))
  manifest[model.id] = { scale: 1, handOffset: [0, 0, 0], handRot: [0, 0, 0], tris: s.tris, materials: s.materials, size: s.size, bboxMin: s.min, bboxMax: s.max }
  console.log(`${model.id.padEnd(10)} tris=${String(s.tris).padStart(4)} mats=${s.materials} size=${s.size.join('×')} m  min=${s.min} max=${s.max}${bytes ? `  ${(bytes / 1024).toFixed(1)} KiB` : ''}`)
}
if (!check) fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
if (failed) process.exit(1)
