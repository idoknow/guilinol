#!/usr/bin/env node
// IDOK-275 — procedural DJI fleet → public/models/drones/<id>.glb + manifest.json
//
// Conventions (contract with web/src/drone/models.ts, IDOK-255):
//   1 unit = 1 m, nose looks down -Z, top = +Y, right = +X, origin = fuselage centre.
//   Animated nodes keep the procedural names: prop_1..N (spun about local +Y), gimbal (pitched about
//   local X), lens, gear. FlyCart also exposes cargo_box (hidden in winch mode) and winch (hook point).
//   manifest.drones[id].offset drops the model so the landing gear touches the ground at the rig's
//   landed height (root sits at ground + 0.8 × spec.height, see web/src/drone/flight.ts).
// Budgets: ≤ 150 KB per GLB, FlyCart ≤ 300 KB. Factors-only PBR, no textures.
//
// Usage: node scripts/drone-models.mjs            # build all (then: node scripts/drone-models-render.mjs for 3-view sheets)
//        node scripts/drone-models.mjs --check    # build + print stats only (no write)

import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const OUT = path.resolve(import.meta.dirname, '../public/models/drones')
const { PI, sin, cos, abs, sign, hypot } = Math
const KB = 1000

// Landed root height = 0.8 × spec.height (web/src/drone/specs.ts) and per-model file budgets.
const SPEC = {
  mavic4pro: { height: 0.15, budget: 150 * KB },
  mini5pro: { height: 0.09, budget: 150 * KB },
  air3s: { height: 0.11, budget: 150 * KB },
  fpv: { height: 0.12, budget: 150 * KB },
  flycart200: { height: 1.05, budget: 300 * KB },
}

// ---------------------------------------------------------------- geometry helpers

function clean(g) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k)
  if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()])
  g.clearGroups()
  return g
}
const rbox = (w, h, d, r, seg = 1) => clean(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) - 1e-6))
const box = (w, h, d) => clean(new THREE.BoxGeometry(w, h, d))
const sphere = (r, ws = 10, hs = 6) => clean(new THREE.SphereGeometry(r, ws, hs))
function axisify(g, axis) {
  if (axis === 'z') g.rotateX(PI / 2) // +Y → +Z
  else if (axis === '-z') g.rotateX(-PI / 2) // +Y → -Z
  else if (axis === 'x') g.rotateZ(-PI / 2)
  else if (axis === '-x') g.rotateZ(PI / 2)
  else if (axis === '-y') g.rotateX(PI)
  return g
}
function cyl(r, h, seg = 12, axis = 'y', rBottom = r, caps = 'both') {
  const parts = [clean(new THREE.CylinderGeometry(r, rBottom, h, seg, 1, true))]
  if (caps === 'top' || caps === 'both') parts.push(clean(new THREE.CircleGeometry(r, seg).rotateX(-PI / 2).translate(0, h / 2, 0)))
  if (caps === 'both') parts.push(clean(new THREE.CircleGeometry(rBottom, seg).rotateX(PI / 2).translate(0, -h / 2, 0)))
  return axisify(mergeGeometries(parts, false), axis)
}
const disc = (r, seg = 12, axis = 'y') => axisify(clean(new THREE.CircleGeometry(r, seg).rotateX(-PI / 2)), axis)
// Horizontal ring (duct lip / propeller shroud): torus laid into the XZ plane and dropped at `pos`.
const torus = (r, tube, pos = [0, 0, 0], radial = 24, tubular = 6) =>
  clean(new THREE.TorusGeometry(r, tube, tubular, radial).rotateX(PI / 2)).translate(...pos)
// Lathe around +Y; profile = [[radius, y], …] bottom → top.
function lathe(profile, seg = 16, axis = 'y') {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-5), y)), seg)
  return axisify(clean(g), axis)
}
// Ring of a superellipse section: half-width w/2, upper half-height top, lower half-height bot.
function ringPts(s, N) {
  const n = s.n ?? 2.6, pts = []
  for (let i = 0; i < N; i++) {
    const t = (2 * PI * i) / N, c = cos(t), si = sin(t)
    let x = (s.w / 2) * sign(c) * abs(c) ** (2 / n)
    let y = (si >= 0 ? s.top : s.bot) * sign(si) * abs(si) ** (2 / n)
    if (s.rot) { const cr = cos(s.rot), sr = sin(s.rot); [x, y] = [x * cr - y * sr, x * sr + y * cr] }
    pts.push([x + (s.x ?? 0), y + (s.y ?? 0)])
  }
  return pts
}
// Smooth skin through cross-sections along Z (sections sorted by z, any order accepted), flat caps.
function loft(sections, N = 20, caps = [true, true]) {
  const S = [...sections].sort((a, b) => a.z - b.z)
  const pos = [], idx = []
  for (const s of S) for (const [x, y] of ringPts(s, N)) pos.push(x, y, s.z)
  for (let k = 0; k < S.length - 1; k++) {
    for (let j = 0; j < N; j++) {
      const a = k * N + j, a1 = k * N + ((j + 1) % N), b = a + N, b1 = a1 + N
      idx.push(a, a1, b1, a, b1, b)
    }
  }
  const cap = (k, front) => {
    const s = S[k], base = pos.length / 3
    for (const [x, y] of ringPts(s, N)) pos.push(x, y, s.z)
    pos.push(s.x ?? 0, (s.y ?? 0) + ((s.top - s.bot) / 2) * 0.5, s.z)
    const c = base + N
    for (let j = 0; j < N; j++) {
      const p = base + j, p1 = base + ((j + 1) % N)
      if (front) idx.push(c, p, p1)
      else idx.push(c, p1, p)
    }
  }
  if (caps[0]) cap(0, false)
  if (caps[1]) cap(S.length - 1, true)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}
// Orient a geometry authored along +Z from z=0 (scaled to unit length via `along`) between a → b.
function orient(g, a, b, roll = 0) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b)
  const dir = B.clone().sub(A), len = dir.length()
  dir.normalize()
  const up = abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const m = new THREE.Matrix4().lookAt(B, A, up) // z axis → (B − A)
  if (roll) g.rotateZ(roll)
  g.scale(1, 1, len)
  g.applyMatrix4(m)
  g.translate(...A.toArray())
  return g
}
// Rectangular-ish tapered beam a → b (w/h at each end), superellipse section.
function beam(a, b, wA, hA, wB = wA, hB = hA, n = 4, N = 12) {
  const g = loft([{ z: 0, w: wA, top: hA / 2, bot: hA / 2, n }, { z: 1, w: wB, top: hB / 2, bot: hB / 2, n }], N)
  return orient(g, a, b)
}
// Round tube a → b.
const tube = (a, b, r, seg = 8, rB = r) => beam(a, b, 2 * r, 2 * r, 2 * rB, 2 * rB, 2, seg)
// One propeller blade along +X from hub, chord along Z, pitched (dir = ±1 for CW / CCW).
function blade(R, hub, chordRoot, chordMax, chordTip, thick, dir = 1, pitchRoot = 0.42, pitchTip = 0.14) {
  const ts = [0, 0.18, 0.45, 0.75, 0.94, 1]
  const chord = t => (t < 0.45 ? chordRoot + (chordMax - chordRoot) * (t / 0.45) : chordMax + (chordTip - chordMax) * ((t - 0.45) / 0.55)) * (t === 1 ? 0.35 : 1)
  const sec = ts.map(t => ({ z: hub + (R - hub) * t, w: chord(t), top: thick * (1 - 0.6 * t), bot: thick * 0.45 * (1 - 0.6 * t), n: 2, rot: dir * (pitchRoot + (pitchTip - pitchRoot) * t), x: dir * 0.18 * chord(t) * t }))
  const g = loft(sec, 8, [true, true])
  g.rotateY(PI / 2) // z (radius) → +x ; ring x (chord) → -z
  return g
}
// Two-blade prop + spinner. Blades lie in y ≈ 0 of the prop node.
function propeller(R, opts = {}) {
  const { dir = 1, chord = R * 0.16, thick = R * 0.025, hubR = R * 0.09 } = opts
  const parts = []
  for (let i = 0; i < 2; i++) {
    const b = blade(R, hubR * 0.8, chord * 0.55, chord, chord * 0.55, thick, dir)
    b.rotateY(i * PI)
    parts.push(b)
  }
  parts.push(lathe([[hubR, -hubR * 0.25], [hubR, hubR * 0.2], [hubR * 0.7, hubR * 0.55], [0, hubR * 0.7]], 10))
  return mergeGeometries(parts, false)
}
// Outrunner motor: base flange + bell + cap, base at y = 0.
function motor(r, h, seg = 14) {
  return lathe([[0, 0], [r * 1.05, 0], [r * 1.05, h * 0.25], [r * 0.92, h * 0.3], [r, h * 0.35], [r, h * 0.9], [r * 0.75, h], [0, h]], seg)
}

// ---------------------------------------------------------------- model builder

const hex = h => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map(v => +(v / 255).toFixed(4))
const css = s => hex(parseInt(s.slice(1), 16))

class Model {
  constructor(id, materials) {
    this.id = id
    this.materials = materials // key → {color:[srgb], metallic, roughness, emissive?}
    this.groups = new Map([[id, { parent: null, pos: [0, 0, 0], parts: new Map() }]])
  }
  group(name, pos = [0, 0, 0], parent = this.id) {
    if (!this.groups.has(parent)) throw new Error(`${this.id}: unknown parent ${parent}`)
    this.groups.set(name, { parent, pos, parts: new Map() })
    return name
  }
  add(group, mat, geom, pos = [0, 0, 0], rot = [0, 0, 0]) {
    if (!this.materials[mat]) throw new Error(`${this.id}: unknown material ${mat}`)
    const grp = this.groups.get(group)
    if (!grp) throw new Error(`${this.id}: unknown group ${group}`)
    const g = geom.clone()
    if (rot[0] || rot[1] || rot[2]) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)))
    g.translate(...pos)
    if (!grp.parts.has(mat)) grp.parts.set(mat, [])
    grp.parts.get(mat).push(g)
    return this
  }
  // Mirror helper: add at +x and the X-mirrored copy at −x.
  addSym(group, mat, geom, pos = [0, 0, 0]) {
    this.add(group, mat, geom, pos)
    const m = geom.clone().scale(-1, 1, 1)
    flipWinding(m)
    this.add(group, mat, m, [-pos[0], pos[1], pos[2]])
    return this
  }
  build() {
    const mats = {}
    for (const [k, d] of Object.entries(this.materials)) {
      mats[k] = new THREE.MeshStandardMaterial({ name: `${this.id}-${k}`, color: new THREE.Color().setRGB(...d.color, THREE.SRGBColorSpace), metalness: d.metallic, roughness: d.roughness })
      if (d.emissive) mats[k].emissive = new THREE.Color().setRGB(...d.emissive, THREE.SRGBColorSpace)
    }
    const nodes = new Map()
    for (const [name, g] of this.groups) {
      const o = new THREE.Group()
      o.name = name
      o.position.set(...g.pos)
      nodes.set(name, o)
      for (const [mat, geoms] of g.parts) {
        const joined = mergeGeometries(geoms, false)
        if (!joined) throw new Error(`${this.id}/${name}/${mat}: merge failed`)
        const merged = mergeVertices(joined, 1e-5)
        const mesh = new THREE.Mesh(merged, mats[mat])
        // Mesh names must never start with "prop" — the rig spins every node matching /^prop/.
        mesh.name = `m-${name}-${mat}`
        o.add(mesh)
      }
    }
    for (const [name, g] of this.groups) if (g.parent) nodes.get(g.parent).add(nodes.get(name))
    return nodes.get(this.id)
  }
}
function flipWinding(g) {
  const ix = g.index.array
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t }
  g.index.needsUpdate = true
  return g
}

// ---------------------------------------------------------------- GLB writer (node TRS + emissive)

function writeGLB(root, file) {
  const json = { asset: { version: '2.0', generator: 'guilinol scripts/drone-models.mjs' }, extensionsUsed: ['KHR_mesh_quantization'], extensionsRequired: ['KHR_mesh_quantization'], scene: 0, scenes: [{ nodes: [0] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] }
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
    const out = { name: m.name, pbrMetallicRoughness: { baseColorFactor: [m.color.r, m.color.g, m.color.b, 1], metallicFactor: m.metalness, roughnessFactor: m.roughness } }
    if (m.emissive && (m.emissive.r || m.emissive.g || m.emissive.b)) out.emissiveFactor = [m.emissive.r, m.emissive.g, m.emissive.b]
    json.materials.push(out)
    matIndex.set(m, json.materials.length - 1)
    return json.materials.length - 1
  }
  const visit = obj => {
    const idx = json.nodes.length
    const node = { name: obj.name }
    json.nodes.push(node)
    if (obj.position.lengthSq() > 0) node.translation = obj.position.toArray().map(v => +v.toFixed(5))
    if (obj.isMesh) {
      // KHR_mesh_quantization: positions → normalised int16 around the mesh bbox (the node carries
      // the dequantising translation + scale), normals → normalised int8. 12 B/vertex instead of 24.
      const g = obj.geometry
      g.computeBoundingBox()
      const bb = g.boundingBox
      const c = bb.getCenter(new THREE.Vector3()), h = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5)
      for (const k of ['x', 'y', 'z']) h[k] = Math.max(h[k], 1e-5)
      const vcount = g.attributes.position.count
      const P = g.attributes.position, N = g.attributes.normal
      const pos = new Int16Array(vcount * 4), nor = new Int8Array(vcount * 4)
      const n = new THREE.Vector3()
      for (let i = 0; i < vcount; i++) {
        pos[i * 4] = Math.round(((P.getX(i) - c.x) / h.x) * 32767)
        pos[i * 4 + 1] = Math.round(((P.getY(i) - c.y) / h.y) * 32767)
        pos[i * 4 + 2] = Math.round(((P.getZ(i) - c.z) / h.z) * 32767)
        // normals live in quantised space: the node's non-uniform scale is undone by the normal matrix
        n.set(N.getX(i) * h.x, N.getY(i) * h.y, N.getZ(i) * h.z).normalize()
        nor[i * 4] = Math.round(n.x * 127); nor[i * 4 + 1] = Math.round(n.y * 127); nor[i * 4 + 2] = Math.round(n.z * 127)
      }
      let qmin = [32767, 32767, 32767], qmax = [-32767, -32767, -32767]
      for (let i = 0; i < vcount; i++) for (let k = 0; k < 3; k++) { qmin[k] = Math.min(qmin[k], pos[i * 4 + k]); qmax[k] = Math.max(qmax[k], pos[i * 4 + k]) }
      const idxArr = vcount > 65535 ? new Uint32Array(g.index.array) : new Uint16Array(g.index.array)
      const pv = push(pos, 34962), nv = push(nor, 34962), iv = push(idxArr, 34963)
      json.bufferViews[pv].byteStride = 8
      json.bufferViews[nv].byteStride = 4
      json.accessors.push({ bufferView: pv, componentType: 5122, normalized: true, count: vcount, type: 'VEC3', min: qmin, max: qmax })
      json.accessors.push({ bufferView: nv, componentType: 5120, normalized: true, count: vcount, type: 'VEC3' })
      json.accessors.push({ bufferView: iv, componentType: vcount > 65535 ? 5125 : 5123, count: idxArr.length, type: 'SCALAR' })
      const a = json.accessors.length
      json.meshes.push({ name: obj.name, primitives: [{ attributes: { POSITION: a - 3, NORMAL: a - 2 }, indices: a - 1, material: material(obj.material) }] })
      node.translation = c.toArray().map(v => +v.toFixed(6))
      node.scale = h.toArray().map(v => +v.toFixed(6))
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
  if (file) fs.writeFileSync(file, out)
  return total
}

// ---------------------------------------------------------------- shared materials

const GLASS = { color: hex(0x0a0d12), metallic: 0.85, roughness: 0.08 }
const ROTOR = { color: hex(0x24272b), metallic: 0.05, roughness: 0.55 }
const LED_RED = { color: hex(0xff3b24), metallic: 0, roughness: 0.4, emissive: hex(0xff3b24) }
const LED_GREEN = { color: hex(0x3cff7a), metallic: 0, roughness: 0.4, emissive: hex(0x2fe06a) }

// ---------------------------------------------------------------- folding consumer quad (Mavic / Air / Mini)
//
// One builder, three silhouettes: fuselage lofted from superellipse sections, front arms swing out
// high from the shoulders, rear arms come out low and climb to the motors, little legs under the
// front motors and fins under the rear ones. The gimbal head is per model.

function foldingQuad(id, o) {
  const m = new Model(id, {
    shell: { color: css(o.shell), metallic: 0.15, roughness: 0.48 },
    dark: { color: css(o.dark), metallic: 0.1, roughness: 0.72 },
    metal: { color: css(o.metal), metallic: 0.8, roughness: 0.32 },
    accent: { color: css(o.accent), metallic: 0.55, roughness: 0.35 },
    glass: GLASS, rotor: ROTOR, red: LED_RED, green: LED_GREEN,
  })
  const L = o.length, W = o.width, H = o.height, s = o.scale
  // fuselage: tail (+z) → nose (−z)
  m.add(id, 'shell', loft([
    { z: L * 0.5, w: W * 0.5, top: H * 0.22, bot: H * 0.2, y: H * 0.02, n: 2.6 },
    { z: L * 0.43, w: W * 0.82, top: H * 0.38, bot: H * 0.36, y: H * 0.04, n: 3 },
    { z: L * 0.24, w: W * 0.98, top: H * 0.5, bot: H * 0.44, y: H * 0.06, n: 3.2 },
    { z: 0, w: W, top: H * 0.54, bot: H * 0.46, y: H * 0.06, n: 3.2 },
    { z: -L * 0.24, w: W * 0.95, top: H * 0.5, bot: H * 0.44, y: H * 0.03, n: 3.2 },
    { z: -L * 0.4, w: W * 0.8, top: H * 0.38, bot: H * 0.4, y: -H * 0.01, n: 3 },
    { z: -L * 0.5, w: W * 0.52, top: H * 0.2, bot: H * 0.28, y: -H * 0.06, n: 2.6 },
  ], 24))
  const topY = H * 0.6
  // battery lid: raised panel on the rear top + the two release latches on the flanks
  m.add(id, 'dark', loft([
    { z: L * 0.385, w: W * 0.62, top: H * 0.02, bot: H * 0.02, n: 4 },
    { z: -L * 0.025, w: W * 0.7, top: H * 0.02, bot: H * 0.02, n: 4 },
  ], 16), [0, topY - H * 0.05, 0])
  m.add(id, 'shell', loft([
    { z: L * 0.37, w: W * 0.58, top: H * 0.025, bot: H * 0.02, n: 4 },
    { z: -L * 0.01, w: W * 0.66, top: H * 0.025, bot: H * 0.02, n: 4 },
  ], 16), [0, topY - H * 0.045, 0])
  m.addSym(id, 'dark', rbox(0.004 * s, H * 0.18, L * 0.12, 0.0015 * s), [W * 0.5, H * 0.12, L * 0.18])
  // vents on the flanks
  for (let i = 0; i < 3; i++) m.addSym(id, 'dark', box(0.0015 * s, H * 0.06, L * 0.07), [W * 0.495, -H * 0.12 + i * H * 0.1, -L * 0.12])
  // vision sensors: forward pair on the nose, upward fisheyes, downward pair, rear pair
  for (const sx of [-1, 1]) {
    m.add(id, 'glass', disc(0.0055 * s, 12, '-z'), [sx * W * 0.17, H * 0.12, -L * 0.5 + 0.004 * s])
    m.add(id, 'dark', cyl(0.0075 * s, 0.002 * s, 12, '-z'), [sx * W * 0.17, H * 0.12, -L * 0.5 + 0.003 * s])
    m.add(id, 'glass', disc(0.0045 * s, 12, 'z'), [sx * W * 0.14, H * 0.18, L * 0.5 - 0.003 * s])
    m.add(id, 'glass', disc(0.005 * s, 12, '-y'), [sx * W * 0.16, -H * 0.43, -L * 0.1])
  }
  m.add(id, 'glass', lathe([[0.009 * s, 0], [0.008 * s, 0.003 * s], [0.004 * s, 0.006 * s], [0, 0.0065 * s]], 12), [0, topY - H * 0.08, -L * 0.3])
  // tail status LED
  m.add(id, 'green', rbox(W * 0.16, H * 0.05, 0.003 * s, 0.001 * s), [0, H * 0.02, L * 0.5 + 0.001])

  // arms + motors + props
  const hubs = [
    { side: 1, front: true, root: [W * 0.4, H * 0.18, -L * 0.22], hub: o.frontHub },
    { side: -1, front: true, root: [-W * 0.4, H * 0.18, -L * 0.22], hub: [-o.frontHub[0], o.frontHub[1], o.frontHub[2]] },
    { side: 1, front: false, root: [W * 0.38, -H * 0.24, L * 0.3], hub: o.rearHub },
    { side: -1, front: false, root: [-W * 0.38, -H * 0.24, L * 0.3], hub: [-o.rearHub[0], o.rearHub[1], o.rearHub[2]] },
  ]
  m.group('gear')
  // Order matches the procedural rig: [+x,+z] [+x,−z] [−x,+z] [−x,−z] → prop_1..4.
  const order = [hubs[2], hubs[0], hubs[3], hubs[1]]
  order.forEach((h, i) => {
    const mr = o.motorR, mh = o.motorH
    const [hx, hy, hz] = h.hub
    const armEnd = [hx, hy - mh * 0.05, hz]
    m.add(id, 'shell', beam(h.root, armEnd, o.armW, o.armH, o.armW * 0.8, o.armH * 0.85, 3.5, 12))
    // motor pod wraps the arm tip
    m.add(id, 'shell', lathe([[mr * 1.25, -mh * 0.35], [mr * 1.35, -mh * 0.05], [mr * 1.15, mh * 0.08], [0, mh * 0.1]], 14), [hx, hy, hz])
    m.add(id, 'metal', motor(mr, mh), [hx, hy + mh * 0.08, hz])
    // nav LED under each motor pod: red front, green rear
    m.add(id, h.front ? 'red' : 'green', sphere(mr * 0.35, 8, 4), [hx, hy - mh * 0.35, hz])
    const p = m.group(`prop_${i + 1}`, [hx, hy + mh * 1.12, hz])
    m.add(p, 'rotor', propeller(o.propR, { dir: i % 2 ? -1 : 1, chord: o.propR * 0.17 }))
    // landing: slim legs under the front motors, short fins under the rear arms
    const foot = o.footY
    if (h.front) {
      m.add('gear', 'dark', beam([hx * 0.97, hy - mh * 0.3, hz + 0.004 * s], [hx * 0.95, foot + 0.004 * s, hz + 0.008 * s], 0.007 * s, 0.016 * s, 0.005 * s, 0.009 * s, 3, 10))
      m.add('gear', 'dark', sphere(0.0055 * s, 8, 5), [hx * 0.95, foot + 0.004 * s, hz + 0.008 * s])
    } else {
      const fx = hx * 0.86, fz = hz - 0.01 * s
      m.add('gear', 'dark', beam([fx, hy - mh * 0.2, fz], [fx, foot + 0.003 * s, fz + 0.012 * s], 0.006 * s, 0.022 * s, 0.004 * s, 0.012 * s, 4, 10))
    }
  })
  o.gimbal(m, id)
  return m
}

function mavic4pro() {
  const s = 1
  const m = foldingQuad('mavic4pro', {
    shell: '#4a4e54', dark: '#24272c', metal: '#8d949c', accent: '#c8b48a', scale: s,
    length: 0.25, width: 0.1, height: 0.078,
    frontHub: [0.168, 0.024, -0.118], rearHub: [0.172, 0.004, 0.128],
    armW: 0.016, armH: 0.012, motorR: 0.016, motorH: 0.019, propR: 0.135, footY: -0.07,
    gimbal(m, id) {
      // Infinity gimbal: a round camera drum hung under the nose, three cameras behind one face.
      m.group('gimbal', [0, -0.006, -0.11])
      m.add('gimbal', 'dark', rbox(0.034, 0.012, 0.024, 0.004), [0, 0.004, 0])
      m.add('gimbal', 'metal', cyl(0.01, 0.008, 12), [0, -0.004, 0])
      m.add('gimbal', 'dark', beam([0.006, -0.006, 0], [0.04, -0.024, -0.014], 0.008, 0.01, 0.007, 0.009, 4, 10))
      m.add('gimbal', 'metal', cyl(0.009, 0.006, 12, 'x'), [0.038, -0.026, -0.016])
      m.add('gimbal', 'shell', loft([
        { z: 0.004, w: 0.05, top: 0.025, bot: 0.025, n: 2 },
        { z: -0.002, w: 0.066, top: 0.033, bot: 0.033, n: 2 },
        { z: -0.032, w: 0.068, top: 0.034, bot: 0.034, n: 2 },
        { z: -0.038, w: 0.062, top: 0.031, bot: 0.031, n: 2 },
      ], 24), [0, -0.026, -0.012])
      m.group('lens', [0, -0.026, -0.05], 'gimbal')
      m.add('lens', 'dark', disc(0.03, 24, '-z'), [0, 0, 0.0005])
      // main 4/3 Hasselblad: big barrel with the gold ring
      m.add('lens', 'metal', lathe([[0.0135, 0], [0.0135, 0.004], [0.011, 0.005], [0.0095, 0.0045]], 18, '-z'), [-0.007, 0.004, 0])
      m.add('lens', 'accent', lathe([[0.0145, -0.0005], [0.0145, 0.0015], [0.0135, 0.0015]], 18, '-z'), [-0.007, 0.004, 0])
      m.add('lens', 'glass', lathe([[0.0095, 0.0045], [0.006, 0.006], [0, 0.0064]], 14, '-z'), [-0.007, 0.004, 0])
      // 70 mm + 168 mm tele, stacked to the right
      for (const [y, r] of [[0.011, 0.0058], [-0.006, 0.0072]]) {
        m.add('lens', 'metal', cyl(r, 0.003, 14, '-z'), [0.015, y, -0.0015])
        m.add('lens', 'glass', disc(r * 0.72, 14, '-z'), [0.015, y, -0.0031])
      }
    },
  })
  return { model: m, gearBottom: -0.07 }
}

function mini5pro() {
  const m = foldingQuad('mini5pro', {
    shell: '#6b7078', dark: '#2b2e33', metal: '#9aa2ab', accent: '#d8dde3', scale: 0.7,
    length: 0.155, width: 0.066, height: 0.056,
    frontHub: [0.118, 0.018, -0.086], rearHub: [0.106, 0.016, 0.096],
    armW: 0.011, armH: 0.008, motorR: 0.0105, motorH: 0.013, propR: 0.078, footY: -0.04,
    gimbal(m) {
      // one big 1-inch camera in a rounded cube, carried by a yoke on both sides
      m.group('gimbal', [0, 0.0, -0.072])
      m.add('gimbal', 'dark', rbox(0.026, 0.008, 0.016, 0.003), [0, 0.002, 0])
      for (const sx of [-1, 1]) {
        m.add('gimbal', 'dark', beam([sx * 0.008, -0.002, 0], [sx * 0.022, -0.016, -0.01], 0.005, 0.006, 0.004, 0.006, 4, 8))
        m.add('gimbal', 'metal', cyl(0.0055, 0.004, 12, sx > 0 ? 'x' : '-x'), [sx * 0.022, -0.02, -0.012])
      }
      m.add('gimbal', 'shell', rbox(0.036, 0.032, 0.03, 0.009, 3), [0, -0.02, -0.014])
      m.group('lens', [0, -0.02, -0.029], 'gimbal')
      m.add('lens', 'metal', lathe([[0.0115, 0], [0.0115, 0.003], [0.009, 0.004]], 18, '-z'))
      m.add('lens', 'accent', lathe([[0.0122, -0.0004], [0.0122, 0.0012], [0.0115, 0.0012]], 18, '-z'))
      m.add('lens', 'glass', lathe([[0.009, 0.004], [0.005, 0.0052], [0, 0.0056]], 14, '-z'))
    },
  })
  return { model: m, gearBottom: -0.04 }
}

function air3s() {
  const m = foldingQuad('air3s', {
    shell: '#5a5e66', dark: '#26292e', metal: '#8f979f', accent: '#b9c0c8', scale: 0.88,
    length: 0.215, width: 0.088, height: 0.068,
    frontHub: [0.138, 0.02, -0.1], rearHub: [0.142, 0.004, 0.112],
    armW: 0.014, armH: 0.01, motorR: 0.0135, motorH: 0.016, propR: 0.104, footY: -0.058,
    gimbal(m) {
      // Air's signature: two equal cameras side by side in a wide pill, plus the LiDAR window above
      m.add('air3s', 'glass', rbox(0.03, 0.009, 0.004, 0.003), [0, -0.003, -0.107])
      m.group('gimbal', [0, -0.004, -0.096])
      m.add('gimbal', 'dark', rbox(0.03, 0.01, 0.02, 0.003), [0, 0.003, 0])
      m.add('gimbal', 'dark', beam([0.006, -0.004, 0], [0.034, -0.022, -0.012], 0.007, 0.009, 0.006, 0.008, 4, 10))
      m.add('gimbal', 'metal', cyl(0.008, 0.005, 12, 'x'), [0.034, -0.024, -0.014])
      m.add('gimbal', 'shell', rbox(0.062, 0.034, 0.036, 0.011, 3), [0, -0.024, -0.016])
      m.group('lens', [0, -0.024, -0.034], 'gimbal')
      for (const x of [-0.014, 0.014]) {
        m.add('lens', 'metal', lathe([[0.0105, 0], [0.0105, 0.003], [0.008, 0.0038]], 18, '-z'), [x, 0, 0])
        m.add('lens', 'glass', lathe([[0.008, 0.0038], [0.0045, 0.005], [0, 0.0054]], 14, '-z'), [x, 0, 0])
      }
      m.add('lens', 'accent', rbox(0.006, 0.002, 0.0015, 0.0006), [0, -0.012, 0.0004])
    },
  })
  return { model: m, gearBottom: -0.058 }
}

// ---------------------------------------------------------------- FPV 穿越机 (IDOK-458)
//
// Four ducted props on a wide X frame. The ducts — a torus ring plus an accent lip around each
// propeller — are what read as 穿越机 at a glance, so they get a real mesh instead of a painted band.

function fpv() {
  const id = 'fpv'
  const m = new Model(id, {
    shell: { color: css('#343a42'), metallic: 0.25, roughness: 0.4 },
    dark: { color: css('#15181c'), metallic: 0.2, roughness: 0.62 },
    duct: { color: css('#22262c'), metallic: 0.15, roughness: 0.55 },
    metal: { color: css('#7f8792'), metallic: 0.85, roughness: 0.3 },
    accent: { color: css('#e0553f'), metallic: 0.15, roughness: 0.45 },
    glass: GLASS, rotor: { color: hex(0x191c20), metallic: 0.1, roughness: 0.5 }, red: LED_RED, green: LED_GREEN,
  })
  // fuselage: a narrow pod that tapers both ways, nose (−z) dropped for the camera stack
  m.add(id, 'shell', loft([
    { z: 0.11, w: 0.05, top: 0.02, bot: 0.018, y: 0.012, n: 2.6 },
    { z: 0.09, w: 0.088, top: 0.032, bot: 0.03, y: 0.014, n: 3 },
    { z: 0.04, w: 0.108, top: 0.04, bot: 0.038, y: 0.012, n: 3.4 },
    { z: -0.03, w: 0.104, top: 0.038, bot: 0.036, y: 0.008, n: 3.4 },
    { z: -0.085, w: 0.082, top: 0.028, bot: 0.03, y: 0.0, n: 3 },
    { z: -0.115, w: 0.05, top: 0.016, bot: 0.02, y: -0.008, n: 2.6 },
  ], 22))
  // battery lid with the red release catch, plus a top GPS mast
  m.add(id, 'dark', rbox(0.062, 0.016, 0.08, 0.005, 2), [0, 0.048, 0.06])
  m.add(id, 'accent', rbox(0.03, 0.006, 0.008, 0.002), [0, 0.058, 0.028])
  m.add(id, 'dark', rbox(0.022, 0.014, 0.022, 0.004, 2), [0, 0.058, 0.012])
  // camera pod: tilted nose block, big front window, single-axis gimbal drum below
  m.add(id, 'dark', rbox(0.052, 0.038, 0.062, 0.008, 2), [0, 0.026, -0.118], [-0.34, 0, 0])
  m.add(id, 'glass', disc(0.016, 18, '-z'), [0, 0.035, -0.148])
  m.add(id, 'metal', cyl(0.019, 0.008, 16, '-z'), [0, 0.035, -0.145])
  // downward vision pair + the LED strip under the tail
  for (const sx of [-1, 1]) m.add(id, 'glass', disc(0.0055, 12, '-y'), [sx * 0.028, -0.03, -0.05])
  m.add(id, 'green', rbox(0.026, 0.006, 0.004, 0.002), [0, -0.024, 0.108])
  m.add(id, 'accent', sphere(0.005, 8, 4), [0, 0.028, 0.075])

  // ducted props: [+x,+z] [+x,−z] [−x,+z] [−x,−z] → prop_1..4, same order as the procedural rig
  const hubs = [[0.155, 0.016, 0.125], [0.163, 0.014, -0.132], [-0.155, 0.016, 0.125], [-0.163, 0.014, -0.132]]
  m.group('gear')
  for (const h of hubs) {
    const [hx, hy, hz] = h
    // arm: a flat carbon plate from the fuselage shoulder out to the duct
    m.add(id, 'shell', beam([hx * 0.28, hy - 0.002, hz * 0.3], [hx * 0.86, hy, hz * 0.9], 0.03, 0.009, 0.024, 0.008, 3, 10))
    // duct: the ring the propeller sits in, plus the accent lip on top
    m.add(id, 'duct', torus(0.098, 0.0075, [hx, hy, hz], 24, 8))
    m.add(id, 'accent', torus(0.1045, 0.0035, [hx, hy + 0.004, hz], 24, 6))
    m.add(id, 'dark', lathe([[0.03, -0.028], [0.032, -0.008], [0.026, 0.0], [0, 0.002]], 14), [hx, hy, hz])
    m.add(id, 'metal', motor(0.017, 0.018), [hx, hy + 0.002, hz])
    m.add(id, hz < 0 ? 'red' : 'green', sphere(0.006, 8, 4), [hx, hy - 0.03, hz])
    // skid rail under each duct — a cinewhoop lands on the ducts, not on legs
    m.add('gear', 'metal', beam([hx * 0.62, -0.046, hz * 0.95], [hx * 0.62, -0.06, hz * 1.06], 0.016, 0.008, 0.014, 0.008, 3, 8))
  }
  hubs.forEach((h, i) => {
    const p = m.group(`prop_${i + 1}`, [h[0], h[1] + 0.012, h[2]])
    m.add(p, 'rotor', propeller(0.092, { dir: i % 2 ? -1 : 1, chord: 0.02, hubR: 0.011 }))
  })

  // camera gimbal under the nose: pitch motor + rounded cube + wide prime
  m.group('gimbal', [0, -0.026, -0.098])
  m.add('gimbal', 'metal', cyl(0.011, 0.009, 14), [0, 0.006, 0])
  m.add('gimbal', 'dark', rbox(0.04, 0.034, 0.034, 0.009, 3), [0, -0.014, -0.008])
  m.add('gimbal', 'accent', rbox(0.042, 0.004, 0.03, 0.0015), [0, 0.004, -0.008])
  m.group('lens', [0, -0.014, -0.026], 'gimbal')
  m.add('lens', 'metal', lathe([[0.0135, 0], [0.0135, 0.003], [0.0115, 0.004]], 18, '-z'))
  m.add('lens', 'glass', lathe([[0.0115, 0.004], [0.007, 0.0058], [0, 0.0062]], 14, '-z'))
  return { model: m, gearBottom: -0.062 }
}

// ---------------------------------------------------------------- FlyCart 200

function flycart200() {
  const id = 'flycart200'
  const m = new Model(id, {
    shell: { color: css('#4a5049'), metallic: 0.2, roughness: 0.55 },
    dark: { color: css('#20241f'), metallic: 0.15, roughness: 0.75 },
    carbon: { color: css('#1a1c1b'), metallic: 0.35, roughness: 0.4 },
    metal: { color: css('#8a9187'), metallic: 0.85, roughness: 0.32 },
    accent: { color: css('#e08a2e'), metallic: 0.1, roughness: 0.5 },
    glass: GLASS, rotor: { color: hex(0x15171a), metallic: 0.2, roughness: 0.45 }, red: LED_RED, green: LED_GREEN,
  })
  // fuselage: a stout pod, nose (−z) a little lower than the tail
  m.add(id, 'shell', loft([
    { z: 0.56, w: 0.4, top: 0.1, bot: 0.1, y: 0.02, n: 2.8 },
    { z: 0.5, w: 0.64, top: 0.17, bot: 0.15, y: 0.02, n: 3.2 },
    { z: 0.25, w: 0.74, top: 0.21, bot: 0.17, y: 0.02, n: 3.6 },
    { z: -0.2, w: 0.74, top: 0.2, bot: 0.17, y: 0.01, n: 3.6 },
    { z: -0.47, w: 0.62, top: 0.15, bot: 0.15, y: -0.01, n: 3.2 },
    { z: -0.56, w: 0.4, top: 0.08, bot: 0.1, y: -0.03, n: 2.8 },
  ], 24))
  // orange cheat lines along the flanks + nose band
  for (const sx of [-1, 1]) m.add(id, 'accent', beam([sx * 0.372, 0.06, 0.38], [sx * 0.372, 0.04, -0.36], 0.012, 0.035, 0.012, 0.03, 4, 8))
  // battery bay: two DB2000 packs with orange carry handles
  for (const sx of [-1, 1]) {
    m.add(id, 'dark', rbox(0.24, 0.13, 0.4, 0.03, 2), [sx * 0.135, 0.255, 0.06])
    m.add(id, 'accent', tube([sx * 0.135, 0.33, -0.06], [sx * 0.135, 0.33, 0.18], 0.012, 8))
    for (const sz of [-0.06, 0.18]) m.add(id, 'accent', tube([sx * 0.135, 0.31, sz], [sx * 0.135, 0.335, sz], 0.012, 8))
  }
  // mmWave radar (nose + tail) and vision pairs
  m.add(id, 'glass', rbox(0.2, 0.08, 0.02, 0.02), [0, 0.0, -0.555])
  m.add(id, 'glass', rbox(0.16, 0.06, 0.02, 0.02), [0, 0.02, 0.555])
  for (const sx of [-1, 1]) m.add(id, 'glass', disc(0.022, 12, '-z'), [sx * 0.17, 0.08, -0.5])
  m.add(id, 'metal', rbox(0.3, 0.03, 0.4, 0.01), [0, -0.165, 0])

  // four arms, coaxial motor pairs: upper props prop_1..4, lower props prop_5..8
  const D = 0.72
  const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]]
  corners.forEach(([sx, sz], i) => {
    const root = [sx * 0.3, 0.06, sz * 0.36], hub = [sx * D, 0.1, sz * D]
    m.add(id, 'dark', rbox(0.12, 0.1, 0.12, 0.025, 2), root)
    m.add(id, 'accent', cyl(0.05, 0.02, 14, 'y'), [root[0] + sx * 0.06, 0.06 + 0.015, root[2] + sz * 0.06], [0, 0, 0])
    m.add(id, 'carbon', tube(root, [hub[0] * 0.97, hub[1], hub[2] * 0.97], 0.045, 12, 0.04))
    // folding joint
    const j = [sx * 0.44, 0.075, sz * 0.48]
    m.add(id, 'dark', tube([j[0] - sx * 0.035, j[1], j[2] - sz * 0.035], [j[0] + sx * 0.035, j[1], j[2] + sz * 0.035], 0.055, 12))
    m.add(id, 'accent', tube([j[0] - sx * 0.008, j[1], j[2] - sz * 0.008], [j[0] + sx * 0.008, j[1], j[2] + sz * 0.008], 0.057, 12))
    // coaxial nacelle
    m.add(id, 'dark', loft([
      { z: -0.17, w: 0.09, top: 0.045, bot: 0.045, n: 2 },
      { z: -0.12, w: 0.13, top: 0.065, bot: 0.065, n: 2 },
      { z: 0.12, w: 0.13, top: 0.065, bot: 0.065, n: 2 },
      { z: 0.17, w: 0.09, top: 0.045, bot: 0.045, n: 2 },
    ], 16).rotateX(PI / 2), hub)
    m.add(id, 'metal', motor(0.085, 0.07, 18), [hub[0], hub[1] + 0.17, hub[2]])
    m.add(id, 'metal', motor(0.085, 0.07, 18).rotateX(PI), [hub[0], hub[1] - 0.17, hub[2]])
    m.add(id, sz < 0 ? 'red' : 'green', sphere(0.022, 8, 5), [hub[0] * 0.86, hub[1] - 0.04, hub[2] * 0.86])
    const up = m.group(`prop_${i + 1}`, [hub[0], hub[1] + 0.255, hub[2]])
    m.add(up, 'rotor', propeller(0.62, { dir: i % 2 ? -1 : 1, chord: 0.11, thick: 0.014, hubR: 0.06 }))
    const lo = m.group(`prop_${i + 5}`, [hub[0], hub[1] - 0.255, hub[2]])
    m.add(lo, 'rotor', propeller(0.62, { dir: i % 2 ? 1 : -1, chord: 0.11, thick: 0.014, hubR: 0.06 }).rotateX(PI))
  })

  // skid gear
  m.group('gear')
  const footY = -0.62, sx0 = 0.43
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      m.add('gear', 'carbon', tube([sx * 0.27, -0.13, sz * 0.3], [sx * sx0, footY + 0.02, sz * 0.36], 0.028, 10, 0.024))
      m.add('gear', 'dark', rbox(0.07, 0.06, 0.07, 0.015), [sx * 0.27, -0.14, sz * 0.3])
    }
    // skid tube with upturned ends
    m.add('gear', 'metal', tube([sx * sx0, footY + 0.022, -0.5], [sx * sx0, footY + 0.022, 0.5], 0.022, 10))
    m.add('gear', 'metal', tube([sx * sx0, footY + 0.022, -0.5], [sx * sx0, footY + 0.08, -0.6], 0.022, 10, 0.02))
    m.add('gear', 'metal', tube([sx * sx0, footY + 0.022, 0.5], [sx * sx0, footY + 0.08, 0.6], 0.022, 10, 0.02))
    for (const sz of [-1, 1]) m.add('gear', 'dark', rbox(0.06, 0.04, 0.1, 0.012), [sx * sx0, footY + 0.022, sz * 0.36])
  }
  m.add('gear', 'carbon', tube([-sx0, footY + 0.13, 0.36], [sx0, footY + 0.13, 0.36], 0.016, 8))
  m.add('gear', 'carbon', tube([-sx0, footY + 0.13, -0.36], [sx0, footY + 0.13, -0.36], 0.016, 8))

  // cargo box (box mode) — hidden by the rig when something hangs on the winch
  m.group('cargo_box', [0, -0.39, 0.02])
  m.add('cargo_box', 'shell', rbox(0.56, 0.34, 0.72, 0.04, 2))
  m.add('cargo_box', 'dark', rbox(0.58, 0.04, 0.74, 0.012), [0, 0.15, 0])
  for (const sx of [-1, 1]) {
    m.add('cargo_box', 'accent', rbox(0.012, 0.08, 0.06, 0.004), [sx * 0.283, 0.08, -0.2])
    m.add('cargo_box', 'accent', rbox(0.012, 0.08, 0.06, 0.004), [sx * 0.283, 0.08, 0.2])
    for (let k = 0; k < 4; k++) m.add('cargo_box', 'dark', box(0.004, 0.2, 0.008), [sx * 0.281, -0.03, -0.24 + k * 0.16])
  }

  // winch (winch mode): drum under the belly, the node origin is the hook
  m.group('winch', [0, -0.31, 0.02])
  m.add('winch', 'dark', rbox(0.2, 0.06, 0.2, 0.02), [0, 0.11, 0])
  m.add('winch', 'metal', cyl(0.06, 0.16, 16, 'x'), [0, 0.05, 0])
  m.add('winch', 'accent', cyl(0.064, 0.02, 16, 'x'), [0.07, 0.05, 0])
  m.add('winch', 'accent', cyl(0.064, 0.02, 16, 'x'), [-0.07, 0.05, 0])

  // downward gimbal camera on the nose
  m.group('gimbal', [0, -0.15, -0.5])
  m.add('gimbal', 'dark', rbox(0.07, 0.03, 0.06, 0.01), [0, -0.005, 0])
  m.add('gimbal', 'shell', sphere(0.05, 16, 10), [0, -0.06, 0])
  m.group('lens', [0, -0.06, -0.048], 'gimbal')
  m.add('lens', 'metal', cyl(0.024, 0.008, 16, '-z'))
  m.add('lens', 'glass', disc(0.018, 16, '-z'), [0, 0, -0.0042])
  return { model: m, gearBottom: footY }
}

// ---------------------------------------------------------------- main

function stats(root) {
  let tris = 0, verts = 0
  const mats = new Set()
  root.traverse(o => { if (o.isMesh) { tris += o.geometry.index.count / 3; verts += o.geometry.attributes.position.count; mats.add(o.material.name) } })
  root.updateMatrixWorld(true)
  const bb = new THREE.Box3().setFromObject(root)
  return { tris, verts, materials: mats.size, size: bb.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(4)), min: bb.min.toArray().map(v => +v.toFixed(4)), max: bb.max.toArray().map(v => +v.toFixed(4)) }
}

const check = process.argv.includes('--check')
const manifest = { version: 1, generator: 'scripts/drone-models.mjs', drones: {} }
let failed = false
if (!check) fs.mkdirSync(OUT, { recursive: true })
const PROPS = { mavic4pro: 4, mini5pro: 4, air3s: 4, fpv: 4, flycart200: 8 }
for (const make of [mavic4pro, mini5pro, air3s, fpv, flycart200]) {
  const { model, gearBottom } = make()
  const root = model.build()
  const s = stats(root)
  const names = []
  root.traverse(o => names.push(o.name))
  const need = ['gimbal', 'lens', 'gear', ...Array.from({ length: PROPS[model.id] }, (_, i) => `prop_${i + 1}`)]
  if (model.id === 'flycart200') need.push('cargo_box', 'winch')
  for (const n of need) if (!names.includes(n)) { console.error(`${model.id}: missing node ${n}`); failed = true }
  const spinning = names.filter(n => /^prop/i.test(n))
  if (spinning.length !== PROPS[model.id]) { console.error(`${model.id}: ${spinning.length} nodes match /^prop/ (want ${PROPS[model.id]})`); failed = true }
  const bytes = writeGLB(root, check ? null : path.join(OUT, `${model.id}.glb`))
  const { height, budget } = SPEC[model.id]
  if (bytes > budget) { console.error(`${model.id}: ${bytes} B > ${budget} B budget`); failed = true }
  const lift = +(-0.8 * height - gearBottom).toFixed(4)
  manifest.drones[model.id] = { scale: 1, rot: [0, 0, 0], offset: [0, lift, 0], tris: s.tris, materials: s.materials, bytes, size: s.size, bboxMin: s.min, bboxMax: s.max }
  console.log(`${model.id.padEnd(11)} tris=${String(s.tris).padStart(5)} verts=${String(s.verts).padStart(5)} mats=${s.materials} ${(bytes / 1024).toFixed(1).padStart(6)} KiB  size=${s.size.join('×')} m  offsetY=${lift}`)
}
if (!check) fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
if (failed) process.exit(1)
