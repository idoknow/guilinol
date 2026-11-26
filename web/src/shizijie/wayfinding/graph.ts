/**
 * 十字街 B1 走廊图：把 SzjLayout.corridors 的折线中心线拆成无向图。
 *
 * - 共点（≤ SZJ_GRAPH_TUNING.mergeTol）合并为同一节点；
 * - 线段真相交处切分并连通；
 * - 折线端点落在另一条线段上（≤ snapTol）视为 T 形接驳，切分被接驳线段；
 * - 4 个楼梯口落脚点（contract footIndoor）吸附进图，作为出口节点。
 * 纯函数，无 three 依赖。
 */
import { SZJ_STAIR_IDS, getStairwell, type SzjLayout, type SzjStairId, type SzjXZ } from '../contract.ts'

export const SZJ_GRAPH_TUNING = {
  /** 节点合并容差（m）。 */
  mergeTol: 0.4,
  /** T 形接驳吸附容差（m）。 */
  snapTol: 0.6,
  /** 出口落脚点吸附进图的最大距离（m）。 */
  exitSnapMax: 1.0,
  /** 判断路口转向时，沿走廊往前看的距离（m）。 */
  headingProbe: 3,
} as const

export interface SzjGraphNode {
  readonly id: number
  readonly x: number
  readonly z: number
  /** 若是楼梯口落脚点。 */
  stairId?: SzjStairId
}

export interface SzjGraphEdge {
  readonly id: number
  readonly a: number
  readonly b: number
  readonly length: number
  readonly corridorId: string
  readonly width: number
}

/** 两个端点之间、中间只经过 2 度节点的一段走廊。 */
export interface SzjChain {
  readonly id: number
  /** 节点序列，nodes[0] = 起点 A，nodes[last] = 终点 B。 */
  readonly nodes: readonly number[]
  /** 每段边（与 nodes 相邻对对应）。 */
  readonly edges: readonly number[]
  /** 累计长度，cum[0] = 0，cum[last] = length。 */
  readonly cum: readonly number[]
  readonly length: number
}

export interface SzjCorridorGraph {
  readonly nodes: readonly SzjGraphNode[]
  readonly edges: readonly SzjGraphEdge[]
  /** 邻接：节点 → [{ edge, to }]。 */
  readonly adj: readonly (readonly { edge: number; to: number }[])[]
  readonly chains: readonly SzjChain[]
  /** 节点 → 以它为端点的 chain 列表（含方向：start=true 表示节点是 chain 的 A 端）。 */
  readonly nodeChains: readonly (readonly { chain: number; start: boolean }[])[]
  readonly exitNode: Readonly<Record<SzjStairId, number>>
  /** 端点（度 ≠ 2 或出口）。 */
  readonly terminal: readonly boolean[]
  /** 路口：度 ≥ 3。 */
  readonly decision: readonly boolean[]
}

interface RawSeg {
  ax: number
  az: number
  bx: number
  bz: number
  corridorId: string
  width: number
  ts: number[]
}

function segIntersect(s: RawSeg, t: RawSeg): { u: number; v: number } | null {
  const rx = s.bx - s.ax
  const rz = s.bz - s.az
  const qx = t.bx - t.ax
  const qz = t.bz - t.az
  const den = rx * qz - rz * qx
  if (Math.abs(den) < 1e-12) return null
  const px = t.ax - s.ax
  const pz = t.az - s.az
  const u = (px * qz - pz * qx) / den
  const v = (px * rz - pz * rx) / den
  if (u < -1e-9 || u > 1 + 1e-9 || v < -1e-9 || v > 1 + 1e-9) return null
  return { u: Math.min(1, Math.max(0, u)), v: Math.min(1, Math.max(0, v)) }
}

function projectT(s: RawSeg, x: number, z: number): { t: number; d: number } {
  const rx = s.bx - s.ax
  const rz = s.bz - s.az
  const l2 = rx * rx + rz * rz
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - s.ax) * rx + (z - s.az) * rz) / l2)) : 0
  return { t, d: Math.hypot(s.ax + rx * t - x, s.az + rz * t - z) }
}

/** 由布局构建走廊图。确定性：同一布局多次调用结果逐位相同。 */
export function buildSzjCorridorGraph(layout: SzjLayout): SzjCorridorGraph {
  const T = SZJ_GRAPH_TUNING
  const segs: RawSeg[] = []
  for (const c of layout.corridors) {
    for (let i = 0; i + 1 < c.points.length; i++) {
      const p = c.points[i]
      const q = c.points[i + 1]
      if (Math.hypot(q.x - p.x, q.z - p.z) < 1e-6) continue
      segs.push({ ax: p.x, az: p.z, bx: q.x, bz: q.z, corridorId: c.id, width: c.width, ts: [0, 1] })
    }
  }
  // 出口落脚点也作为切分点吸附到最近线段
  const exitFoot: Record<string, SzjXZ> = {}
  for (const id of SZJ_STAIR_IDS) {
    const f = getStairwell(id).footIndoor
    exitFoot[id] = f
    let best = -1
    let bt = 0
    let bd = Infinity
    segs.forEach((s, i) => {
      const r = projectT(s, f.x, f.z)
      if (r.d < bd) {
        bd = r.d
        best = i
        bt = r.t
      }
    })
    if (best < 0 || bd > T.exitSnapMax) throw new Error(`出口 ${id} 落脚点离走廊 ${bd.toFixed(2)}m，超过 ${T.exitSnapMax}m`)
    segs[best].ts.push(bt)
  }
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i]
      const t = segs[j]
      const hit = segIntersect(s, t)
      if (hit) {
        s.ts.push(hit.u)
        t.ts.push(hit.v)
      }
      for (const [x, z] of [[s.ax, s.az], [s.bx, s.bz]]) {
        const r = projectT(t, x, z)
        if (r.d <= T.snapTol) t.ts.push(r.t)
      }
      for (const [x, z] of [[t.ax, t.az], [t.bx, t.bz]]) {
        const r = projectT(s, x, z)
        if (r.d <= T.snapTol) s.ts.push(r.t)
      }
    }
  }
  // 节点：贪心合并
  const nodes: SzjGraphNode[] = []
  const nodeOf = (x: number, z: number): number => {
    for (const n of nodes) if (Math.hypot(n.x - x, n.z - z) <= T.mergeTol) return n.id
    nodes.push({ id: nodes.length, x, z })
    return nodes.length - 1
  }
  // 先放出口点，使出口节点坐标 = 契约落脚点
  const exitNode = {} as Record<SzjStairId, number>
  for (const id of SZJ_STAIR_IDS) {
    const n = nodeOf(exitFoot[id].x, exitFoot[id].z)
    nodes[n].stairId = id
    exitNode[id] = n
  }
  const edgeKey = new Map<string, number>()
  const edges: SzjGraphEdge[] = []
  for (const s of segs) {
    const ts = [...new Set(s.ts.map(t => Math.round(t * 1e9) / 1e9))].sort((a, b) => a - b)
    let prev = -1
    for (const t of ts) {
      const n = nodeOf(s.ax + (s.bx - s.ax) * t, s.az + (s.bz - s.az) * t)
      if (prev >= 0 && prev !== n) {
        const a = Math.min(prev, n)
        const b = Math.max(prev, n)
        const key = `${a}-${b}`
        const length = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z)
        const old = edgeKey.get(key)
        if (old === undefined) {
          edgeKey.set(key, edges.length)
          edges.push({ id: edges.length, a, b, length, corridorId: s.corridorId, width: s.width })
        } else if (s.width > edges[old].width) {
          edges[old] = { ...edges[old], corridorId: s.corridorId, width: s.width }
        }
      }
      prev = n
    }
  }
  const adj: { edge: number; to: number }[][] = nodes.map(() => [])
  for (const e of edges) {
    adj[e.a].push({ edge: e.id, to: e.b })
    adj[e.b].push({ edge: e.id, to: e.a })
  }
  const terminal = nodes.map((n, i) => adj[i].length !== 2 || n.stairId !== undefined)
  const decision = nodes.map((_, i) => adj[i].length >= 3)
  // chains
  const chains: SzjChain[] = []
  const usedEdge = new Set<number>()
  const walk = (start: number, first: { edge: number; to: number }): void => {
    const ns = [start]
    const es: number[] = []
    const cum = [0]
    let cur = start
    let step = first
    for (;;) {
      usedEdge.add(step.edge)
      es.push(step.edge)
      cum.push(cum[cum.length - 1] + edges[step.edge].length)
      ns.push(step.to)
      cur = step.to
      if (terminal[cur] || cur === start) break
      const nxt = adj[cur].find(o => o.edge !== step.edge)
      if (!nxt || usedEdge.has(nxt.edge)) break
      step = nxt
    }
    chains.push({ id: chains.length, nodes: ns, edges: es, cum, length: cum[cum.length - 1] })
  }
  for (let i = 0; i < nodes.length; i++) {
    if (!terminal[i]) continue
    for (const o of adj[i]) if (!usedEdge.has(o.edge)) walk(i, o)
  }
  // 纯环（无端点）兜底：把环上任一节点当端点
  for (const e of edges) {
    if (usedEdge.has(e.id)) continue
    terminal[e.a] = true
    for (const o of adj[e.a]) if (!usedEdge.has(o.edge)) walk(e.a, o)
  }
  const nodeChains: { chain: number; start: boolean }[][] = nodes.map(() => [])
  for (const c of chains) {
    nodeChains[c.nodes[0]].push({ chain: c.id, start: true })
    nodeChains[c.nodes[c.nodes.length - 1]].push({ chain: c.id, start: false })
  }
  return { nodes, edges, adj, chains, nodeChains, exitNode, terminal, decision }
}

/** chain 上偏移 s 处的坐标与该处走廊前进方向（A→B 单位向量）以及所在边。 */
export function chainPointAt(g: SzjCorridorGraph, c: SzjChain, s: number): { x: number; z: number; dir: SzjXZ; edge: number } {
  const ss = Math.min(c.length, Math.max(0, s))
  let i = 0
  while (i + 1 < c.edges.length && c.cum[i + 1] < ss) i++
  const a = g.nodes[c.nodes[i]]
  const b = g.nodes[c.nodes[i + 1]]
  const len = c.cum[i + 1] - c.cum[i]
  const t = len > 0 ? (ss - c.cum[i]) / len : 0
  const dx = b.x - a.x
  const dz = b.z - a.z
  const l = Math.hypot(dx, dz) || 1
  return { x: a.x + dx * t, z: a.z + dz * t, dir: { x: dx / l, z: dz / l }, edge: c.edges[i] }
}

/**
 * 从 chain 的某一端出发、沿 chain 往里看 probe 米的朝向（单位向量，离开端点方向）。
 * fromStart=true 表示从 A 端往 B 看。
 */
export function chainHeadingFrom(g: SzjCorridorGraph, c: SzjChain, fromStart: boolean, probe: number = SZJ_GRAPH_TUNING.headingProbe): SzjXZ {
  const s0 = fromStart ? 0 : c.length
  const s1 = fromStart ? Math.min(c.length, probe) : Math.max(0, c.length - probe)
  const p0 = chainPointAt(g, c, s0)
  const p1 = chainPointAt(g, c, s1)
  const dx = p1.x - p0.x
  const dz = p1.z - p0.z
  const l = Math.hypot(dx, dz) || 1
  return { x: dx / l, z: dz / l }
}

/** 单源最短路（Dijkstra），返回距离与朝源的下一跳节点。 */
export function shortestTo(g: SzjCorridorGraph, target: number): { dist: Float64Array; next: Int32Array } {
  const n = g.nodes.length
  const dist = new Float64Array(n).fill(Infinity)
  const next = new Int32Array(n).fill(-1)
  const done = new Uint8Array(n)
  dist[target] = 0
  for (;;) {
    let u = -1
    let best = Infinity
    for (let i = 0; i < n; i++) {
      if (!done[i] && dist[i] < best) {
        best = dist[i]
        u = i
      }
    }
    if (u < 0) break
    done[u] = 1
    for (const o of g.adj[u]) {
      const d = best + g.edges[o.edge].length
      if (d < dist[o.to] - 1e-9) {
        dist[o.to] = d
        next[o.to] = u
      }
    }
  }
  return { dist, next }
}
