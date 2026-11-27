// IDOK-386 封面「天台 · 漓江暮色」远景烘焙：从发布版世界数据切出机位视野里的真实峰林、象鼻山、日月双塔、水面，
// 压成 public/home/cover-view.bin（封面懒加载，不进任何 JS 包）。世界数据更新后重跑即可：
//   node --import tsx scripts/bake-cover-view.mjs <世界目录：含 manifest.json、peaks.bin>
// 机位：七星区漓江东岸临江一栋高楼楼顶（离水 ~60 m），漓江从脚下转弯向北流去，隔江看象鼻山、双塔、老城和北边峰林。
import {readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {gunzipSync, gzipSync} from 'node:zlib'
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js'
import * as T from 'three'

const world = process.argv[2]
if (!world) throw new Error('用法：node --import tsx scripts/bake-cover-view.mjs <世界目录>')
const OUT = 'public/home/cover-view.bin'
const ORIGIN = [-480, 1840] // 角色站位（世界米：x 东，z 南）
const WEDGE = 122 // 视野中心方位角（度，0 = 东，逆时针；象鼻山 117°，双塔 113°）
const MESH_HALF = 52, MESH_RANGE = 6200, LOD0_RANGE = 2600 // 近中景峰林：真网格
const RIBBON_HALF = 68, RIBBONS = [[6200, 9500, 7800], [9500, 14000, 11500], [14000, 40000, 19000]] // 远景：天际线剪影带
const RIBBON_STEP = 0.08 // 度
const ROOF = 45, EYE = ROOF + 1.6 // 楼顶离地、相机眼高（米）
const MASK_STEP = 16

const manifest = JSON.parse(readFileSync(join(world, 'manifest.json'), 'utf8'))
const [left, top, width, depth] = manifest.extent
const heights = (() => {
  const b = readFileSync(join(world, 'overview.i16'))
  const a = new Int16Array(b.buffer, b.byteOffset, b.length / 2), step = manifest.overview.step, cols = width / step
  return (x, z) => a[Math.round((z - top) / step) * (cols + 1) + Math.round((x - left) / step)] / 10
})()
const ground = heights(ORIGIN[0], ORIGIN[1])
const eye = [ORIGIN[0], ground + EYE, ORIGIN[1]]
const azOf = (x, z) => (Math.atan2(-(z - ORIGIN[1]), x - ORIGIN[0]) * 180) / Math.PI
const offAxis = (x, z) => ((azOf(x, z) - WEDGE + 540) % 360) - 180

// ---------- 峰林：复用游戏 worker 解 peaks.bin（与游戏同一网格） ----------
let decoded
globalThis.self = {postMessage: (o) => (decoded = o)}
await import('../web/src/peaks-worker.ts')
const packed = readFileSync(join(world, 'peaks.bin'))
const entries = manifest.peaks.entries.filter((e) => !e.model)
await globalThis.self.onmessage({
  data: {packed: packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength), entries, palette: Array(7).fill([0.5, 0.5, 0.5]), bareFrom: 0.5, rockShare: 1, jitter: 0.05},
})
const {pos0, pos1, peaks} = decoded
const span = (idx) => {
  let lo = Infinity, hi = -1
  for (const i of idx) (lo = Math.min(lo, i)), (hi = Math.max(hi, i))
  return [lo, hi - lo + 1]
}
const template = (idx) => {
  const [lo] = span(idx)
  return Uint16Array.from(idx, (i) => i - lo)
}
const tmpl0 = template(peaks[0].idx0), tmpl1 = template(peaks[0].idx1)
const mesh = [], ribbonTris = []
for (const p of peaks) {
  const [x, , z] = p.center, d = Math.hypot(x - ORIGIN[0], z - ORIGIN[1]), off = Math.abs(offAxis(x, z))
  if (d < MESH_RANGE && off < MESH_HALF) mesh.push({p, lod: d < LOD0_RANGE ? 0 : 1})
  else if (d >= MESH_RANGE && off < RIBBON_HALF + 3) ribbonTris.push(p)
}
const peakPos = [], peakCenter = [], peakLod = []
const Q = 32 // 峰体顶点：相对峰心，1/32 m
for (const {p, lod} of mesh) {
  const [start, count] = span(lod ? p.idx1 : p.idx0), src = lod ? pos1 : pos0
  const c = [p.center[0] - ORIGIN[0], p.center[1] - ground, p.center[2] - ORIGIN[1]]
  peakCenter.push(...c)
  peakLod.push(lod)
  for (let v = start; v < start + count; v++)
    for (let k = 0; k < 3; k++) peakPos.push(Math.round((src[v * 3 + k] - [ORIGIN[0], ground, ORIGIN[1]][k] - c[k]) * Q))
}

// ---------- 远景天际线：按方位取最大仰角，折算成各带代表距离上的高度 ----------
const bins = Math.round((2 * RIBBON_HALF) / RIBBON_STEP) + 1
const ribbons = RIBBONS.map(([, , at]) => ({at, h: new Float32Array(bins).fill(-1e9)}))
const R_EFF = 6371000 * 1.15
for (const p of ribbonTris) {
  const d = Math.hypot(p.center[0] - ORIGIN[0], p.center[2] - ORIGIN[1])
  const band = RIBBONS.findIndex(([a, b]) => d >= a && d < b)
  if (band < 0) continue
  const [start] = span(p.idx1)
  const tri = p.idx1
  for (let t = 0; t < tri.length; t += 3) {
    const vs = [0, 1, 2].map((k) => tri[t + k])
    for (let a = 0; a <= 4; a++)
      for (let b = 0; a + b <= 4; b++) {
        const w = [a / 4, b / 4, 1 - a / 4 - b / 4]
        let x = 0, y = 0, z = 0
        vs.forEach((v, k) => ((x += pos1[v * 3] * w[k]), (y += pos1[v * 3 + 1] * w[k]), (z += pos1[v * 3 + 2] * w[k])))
        const dist = Math.hypot(x - eye[0], z - eye[2])
        const el = (y - eye[1] - (dist * dist) / (2 * R_EFF)) / dist
        const bin = Math.round((offAxis(x, z) + RIBBON_HALF) / RIBBON_STEP)
        if (bin < 0 || bin >= bins) continue
        const r = ribbons[band], h = el * r.at + EYE
        if (h > r.h[bin]) r.h[bin] = h
      }
  }
  void start
}
// 空隙用相邻值低位填平（地平线以下 4 m），并轻微平滑锯齿
for (const r of ribbons) for (let i = 0; i < bins; i++) if (r.h[i] < -1e8) r.h[i] = -4

// ---------- 地标：象鼻山、日月双塔（游戏同款 glb 的 lod1） ----------
await MeshoptDecoder.ready
function glbParts(file, at, rotation = 0) {
  const b = readFileSync(file), jsonLen = b.readUInt32LE(12)
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString()), bin = b.subarray(20 + jsonLen + 8)
  const SIZE = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4}
  const GET = {5120: ['getInt8', 1, 127], 5121: ['getUint8', 1, 255], 5122: ['getInt16', 2, 32767], 5123: ['getUint16', 2, 65535], 5125: ['getUint32', 4, 1], 5126: ['getFloat32', 4, 1]}
  const views = new Map()
  const view = (i) => {
    if (views.has(i)) return views.get(i)
    const v = json.bufferViews[i], ext = v.extensions?.EXT_meshopt_compression
    let out
    if (ext) {
      out = new Uint8Array(ext.count * ext.byteStride)
      MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, bin.subarray(ext.byteOffset || 0, (ext.byteOffset || 0) + ext.byteLength), ext.mode, ext.filter || 'NONE')
    } else out = bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength)
    views.set(i, out)
    return out
  }
  const accessor = (i) => {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView], raw = view(a.bufferView)
    const [get, size, max] = GET[a.componentType], n = SIZE[a.type], stride = v.byteStride || size * n
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), out = new Float32Array(a.count * n)
    for (let k = 0; k < a.count; k++)
      for (let c = 0; c < n; c++) {
        const x = dv[get]((a.byteOffset || 0) + k * stride + c * size, true)
        out[k * n + c] = a.normalized ? Math.max(x / max, -1) : x
      }
    return out
  }
  const root = new T.Object3D()
  root.position.set(...at)
  root.rotation.y = rotation
  const nodes = json.nodes.map((n) => {
    const o = new T.Object3D()
    o.name = n.name || ''
    if (n.translation) o.position.fromArray(n.translation)
    if (n.rotation) o.quaternion.fromArray(n.rotation)
    if (n.scale) o.scale.fromArray(n.scale)
    o.userData.mesh = n.mesh
    return o
  })
  json.nodes.forEach((n, i) => (n.children || []).forEach((c) => nodes[i].add(nodes[c])))
  for (const i of json.scenes[json.scene || 0].nodes) root.add(nodes[i])
  root.updateMatrixWorld(true)
  const parts = []
  root.getObjectByName('lod1').traverse((o) => {
    if (o.userData.mesh === undefined) return
    for (const p of json.meshes[o.userData.mesh].primitives) {
      const pos = accessor(p.attributes.POSITION), v = new T.Vector3()
      for (let k = 0; k < pos.length; k += 3) v.fromArray(pos, k).applyMatrix4(o.matrixWorld).toArray(pos, k)
      const n = pos.length / 3, col = new Uint8Array(n * 3).fill(255)
      if (p.attributes.COLOR_0 !== undefined) {
        const c = accessor(p.attributes.COLOR_0), w = SIZE[json.accessors[p.attributes.COLOR_0].type]
        for (let k = 0; k < n; k++) for (let j = 0; j < 3; j++) col[k * 3 + j] = Math.round(c[k * w + j] * 255)
      }
      const mat = json.materials[p.material]
      parts.push({lit: !!mat.emissiveFactor, emissive: mat.emissiveFactor ?? null, pos, col, index: Uint16Array.from(accessor(p.indices))})
    }
  })
  return parts
}
const lm = (id) => manifest.landmarks.find((l) => l.id === id)
const elephantEntry = manifest.peaks.entries.find((e) => e.model?.includes('elephant_hill'))
const landmarks = [
  {name: '象鼻山', parts: glbParts('public/landmarks/elephant_hill.glb', [elephantEntry.center[0], elephantEntry.baseHeight, elephantEntry.center[2]])},
  {name: '日月双塔', parts: glbParts('public/landmarks/shanhu_pagodas.glb', lm('shanhu_pagodas').position, lm('shanhu_pagodas').rotation ?? 0)},
]

// ---------- 水面掩码（视野楔形外接框，16 m） ----------
let bx0 = ORIGIN[0], bx1 = ORIGIN[0], bz0 = ORIGIN[1], bz1 = ORIGIN[1]
for (let a = -MESH_HALF; a <= MESH_HALF; a += 2) {
  const r = (((WEDGE + a) * Math.PI) / 180)
  const x = ORIGIN[0] + Math.cos(r) * MESH_RANGE, z = ORIGIN[1] - Math.sin(r) * MESH_RANGE
  ;(bx0 = Math.min(bx0, x)), (bx1 = Math.max(bx1, x)), (bz0 = Math.min(bz0, z)), (bz1 = Math.max(bz1, z))
}
bx0 = Math.max(left, Math.floor((bx0 - 400) / MASK_STEP) * MASK_STEP)
bz0 = Math.max(top, Math.floor((bz0 - 400) / MASK_STEP) * MASK_STEP)
bx1 = Math.min(left + width, bx1 + 400)
bz1 = Math.min(top + depth, bz1 + 400)
const mw = Math.ceil((bx1 - bx0) / MASK_STEP), mh = Math.ceil((bz1 - bz0) / MASK_STEP)
const mask = gunzipSync(Buffer.from(manifest.overview.waterMask, 'base64'))
const wet = (x, z) => {
  const bit = Math.floor((z - top) / 8) * (width / 8) + Math.floor((x - left) / 8)
  return (mask[bit >> 3] & (1 << (bit % 8))) !== 0
}
const water = new Uint8Array(Math.ceil((mw * mh) / 8))
for (let j = 0; j < mh; j++)
  for (let i = 0; i < mw; i++) {
    const x = bx0 + (i + 0.5) * MASK_STEP, z = bz0 + (j + 0.5) * MASK_STEP
    if (wet(x, z)) {
      const bit = j * mw + i
      water[bit >> 3] |= 1 << (bit % 8)
    }
  }
const waterY = 144.6 - ground

// ---------- 打包：JSON 头 + 4 字节对齐的类型化数组 ----------
const blobs = []
let offset = 0
const put = (arr) => {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
  const at = offset
  blobs.push(bytes)
  offset += bytes.length
  const pad = (4 - (offset % 4)) % 4
  if (pad) blobs.push(new Uint8Array(pad)), (offset += pad)
  return {o: at, n: arr.length}
}
const header = {
  version: 1,
  origin: [ORIGIN[0], ground, ORIGIN[1]],
  roof: ROOF,
  wedge: WEDGE,
  waterY,
  peaks: {
    count: mesh.length,
    scale: 1 / Q,
    lods: [
      {verts: span(peaks[0].idx0)[1], index: put(tmpl0)},
      {verts: span(peaks[0].idx1)[1], index: put(tmpl1)},
    ],
    lod: put(Uint8Array.from(peakLod)),
    center: put(Float32Array.from(peakCenter)),
    pos: put(Int16Array.from(peakPos)),
  },
  ribbons: ribbons.map((r) => ({at: r.at, az0: WEDGE - RIBBON_HALF, step: RIBBON_STEP, h: put(Int16Array.from(r.h, (v) => Math.round(v * 10)))})),
  landmarks: landmarks.map((l) => ({
    name: l.name,
    parts: l.parts.map((p) => {
      const rel = Int16Array.from(p.pos, (v, i) => Math.round((v - [ORIGIN[0], ground, ORIGIN[1]][i % 3]) * 16))
      return {lit: p.lit, emissive: p.emissive, scale: 1 / 16, pos: put(rel), col: put(p.col), index: put(p.index)}
    }),
  })),
  water: {x0: bx0 - ORIGIN[0], z0: bz0 - ORIGIN[1], step: MASK_STEP, w: mw, h: mh, bits: put(water)},
}
const head = Buffer.from(JSON.stringify(header))
const headPad = Buffer.alloc((4 - ((head.length + 4) % 4)) % 4, 0x20)
const len = Buffer.alloc(4)
len.writeUInt32LE(head.length + headPad.length)
// 整包 gzip：静态托管不一定压缩 .bin，前端用 DecompressionStream 解
const raw = Buffer.concat([len, head, headPad, ...blobs.map((b) => Buffer.from(b.buffer, b.byteOffset, b.byteLength))])
writeFileSync(OUT, gzipSync(raw, {level: 9}))
const kb = (n) => (n / 1024).toFixed(1) + ' KB'
console.log(`${OUT}: ${kb(raw.length)} → gzip ${kb(gzipSync(raw, {level: 9}).length)}（峰 ${mesh.length}，lod0 ${peakLod.filter((l) => !l).length}；远景带 ${ribbons.length}×${bins}；水面 ${mw}×${mh}）`)
