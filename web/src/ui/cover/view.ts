// 读 public/home/cover-view.bin（scripts/bake-cover-view.mjs 烘焙，整包 gzip）：机位视野里的真实峰林、
// 远景天际线、象鼻山/日月双塔网格、水面掩码。坐标统一换成场景坐标（水面 y = 0）。

import {hillFrame, stampHillWater} from './hill'

type Slice = {o: number; n: number}
interface Header {
  version: number
  origin: [number, number, number]
  roof: number
  wedge: number
  waterY: number
  peaks: {count: number; scale: number; lods: {verts: number; index: Slice}[]; lod: Slice; center: Slice; pos: Slice}
  ribbons: {at: number; az0: number; step: number; h: Slice}[]
  landmarks: {name: string; parts: {lit: boolean; emissive: number[] | null; scale: number; pos: Slice; col: Slice; index: Slice}[]}[]
  water: {x0: number; z0: number; step: number; w: number; h: number; bits: Slice}
}

export interface MeshData {
  pos: Float32Array
  col?: Uint8Array
  index: Uint16Array | Uint32Array
}
export interface ViewData {
  /** 地面高（水面 0）与楼顶高 */
  ground: number
  roof: number
  /** 峰林合并网格（已在场景坐标）+ 每座峰的中心与水平半径（城市布点避让） */
  peaks: MeshData & {spots: {x: number; z: number; r: number; top: number; base: number; start: number; count: number}[]}
  ribbons: {at: number; az0: number; step: number; h: Float32Array}[]
  landmarks: {name: string; parts: (MeshData & {lit: boolean; emissive: number[] | null})[]}[]
  /** 水面：field = 掩码模糊后的 0..1 场（格心采样），> .5 为水；岸线、地面挖空、布点都用它，三者一致 */
  water: {x0: number; z0: number; step: number; w: number; h: number; field: Float32Array}
}

/** 原始 16 m 二值掩码 → 两遍 3×3 盒式模糊（≈ σ 18 m）：锯齿岸线变圆滑，1–2 格的碎水洼消失 */
function smoothWater(bits: Uint8Array, w: number, h: number) {
  let a = Float32Array.from({length: w * h}, (_, i) => (bits[i >> 3] >> (i & 7)) & 1)
  const b = new Float32Array(w * h)
  for (let pass = 0; pass < 4; pass++) {
    const horiz = pass % 2 === 0
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        let s = 0
        for (let k = -1; k <= 1; k++) {
          const x = horiz ? Math.min(w - 1, Math.max(0, i + k)) : i, y = horiz ? j : Math.min(h - 1, Math.max(0, j + k))
          s += a[y * w + x]
        }
        b[j * w + i] = s / 3
      }
    a = Float32Array.from(b)
  }
  return a
}

export async function loadView(url: string, signal: AbortSignal): Promise<ViewData> {
  const res = await fetch(url, {signal})
  if (!res.ok || !res.body) throw Error('cover-view ' + res.status)
  const buf = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  const n = new DataView(buf).getUint32(0, true)
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n))) as Header
  const base = 4 + n
  const i16 = (s: Slice) => new Int16Array(buf, base + s.o, s.n)
  const u16 = (s: Slice) => new Uint16Array(buf, base + s.o, s.n)
  const u8 = (s: Slice) => new Uint8Array(buf, base + s.o, s.n)
  const f32 = (s: Slice) => new Float32Array(buf, base + s.o, s.n)
  // 路面至少高出水面 1.6 m（丰水期江景）：烘焙点的游戏地面比水面还低 0.7 m，照搬就整城泡水
  const y0 = Math.max(-head.waterY, 1.6)

  // ---------- 峰林：模板索引 × 每峰偏移 ----------
  const P = head.peaks, lods = u8(P.lod), centers = f32(P.center), raw = i16(P.pos)
  const tmpl = P.lods.map((l) => u16(l.index))
  // 烘焙包里个别峰心是 NaN（游戏数据缺高度）：整座跳过
  const ok = Array.from({length: P.count}, (_, k) => [0, 1, 2].every((i) => Number.isFinite(centers[k * 3 + i])))
  let verts = 0, idx = 0
  lods.forEach((l, k) => ok[k] && ((verts += P.lods[l].verts), (idx += tmpl[l].length)))
  const pos = new Float32Array(verts * 3), index = new Uint32Array(idx)
  const spots: ViewData['peaks']['spots'] = []
  let v = 0, o = 0, src = 0
  for (let k = 0; k < P.count; k++) {
    const l = lods[k], n = P.lods[l].verts
    if (!ok[k]) {
      src += n
      continue
    }
    const cx = centers[k * 3], cy = centers[k * 3 + 1] + y0, cz = centers[k * 3 + 2]
    const start = v
    let r = 0, top = 0, base = Infinity
    for (let i = 0; i < n; i++, v++, src++) {
      const x = raw[src * 3] * P.scale, y = raw[src * 3 + 1] * P.scale, z = raw[src * 3 + 2] * P.scale
      pos[v * 3] = cx + x
      pos[v * 3 + 1] = cy + y
      pos[v * 3 + 2] = cz + z
      top = Math.max(top, cy + y)
      base = Math.min(base, cy + y)
      if (cy + y < y0 + 25) r = Math.max(r, Math.hypot(x, z))
    }
    for (const t of tmpl[l]) index[o++] = start + t
    spots.push({x: cx, z: cz, r: r || 60, top, base, start, count: n})
  }

  const water = {...head.water, field: smoothWater(u8(head.water.bits), head.water.w, head.water.h)}
  const hill = head.landmarks.find((l) => l.name === '象鼻山')
  if (hill) stampHillWater(water, hillFrame(hill.parts.map((p) => ({pos: Float32Array.from(i16(p.pos), (x) => x * p.scale)}))))

  return {
    ground: y0,
    roof: y0 + head.roof,
    peaks: {pos, index, spots},
    ribbons: head.ribbons.map((r) => ({at: r.at, az0: r.az0, step: r.step, h: Float32Array.from(i16(r.h), (h) => h / 10 + y0)})),
    landmarks: head.landmarks.map((l) => ({
      name: l.name,
      parts: l.parts.map((p) => ({
        lit: p.lit,
        emissive: p.emissive,
        pos: Float32Array.from(i16(p.pos), (x, i) => x * p.scale + (i % 3 === 1 ? y0 : 0)),
        col: u8(p.col),
        index: u16(p.index),
      })),
    })),
    water,
  }
}

/** 水面场双线性取值（与地面 shader 的线性采样一致）；掩码范围外 = 0 */
export function waterAt(w: ViewData['water'], x: number, z: number) {
  const fx = (x - w.x0) / w.step - 0.5, fz = (z - w.z0) / w.step - 0.5
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j
  const at = (a: number, b: number) => (a < 0 || b < 0 || a >= w.w || b >= w.h ? 0 : w.field[b * w.w + a])
  const top = at(i, j) + (at(i + 1, j) - at(i, j)) * tx, bot = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx
  return top + (bot - top) * tz
}

/** 场景坐标 (x, z) 是否水面 */
export const wetAt = (w: ViewData['water'], x: number, z: number) => waterAt(w, x, z) > 0.5
