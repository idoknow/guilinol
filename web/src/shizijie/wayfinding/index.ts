/**
 * 十字街 B1 天花板吊挂导视牌：唯一数据源（纯函数，无 three 依赖）。
 *
 * 输入：SzjLayout（走廊折线 + 楼梯口），输出 SzjHangingSign[]：
 *   - 每个路口（度 ≥ 3）在每条来向走廊上距路口 approachM 处挂一块「路口牌」；
 *   - 走廊沿线按 ≤ maxSpacingM 补「沿线牌」，端头（死胡同 / 出口）距最近牌 ≤ endGapM；
 *   - 楼梯口落脚点附近的牌标为「门厅牌」；
 *   - 每块牌两面，各面朝向一个行进方向；每面列出「沿这个方向走」能到的出口：
 *     箭头 = 在下一个路口的转向（相对行进方向），距离 = 最短路总长。
 *   - 某面没有任何出口在前方时，列出最近出口并标「掉头」(back)，不留空面。
 * Carbon 渲染、Hy2 生成图集文字都只读这里；Neon 的 verify 用 followSigns 做真人式跟牌模拟。
 */
import { SZJ_STAIR_IDS, getStairwell, indoorToStairLocal, type SzjLayout, type SzjStairId, type SzjXZ } from '../contract.ts'
import {
  SZJ_GRAPH_TUNING,
  buildSzjCorridorGraph,
  chainHeadingFrom,
  chainPointAt,
  shortestTo,
  type SzjChain,
  type SzjCorridorGraph,
} from './graph.ts'

export * from './graph.ts'

export const SZJ_WAYFINDING_VERSION = 1 as const

/** 吊牌几何与布点参数。 */
export const SZJ_SIGN_SPEC = {
  /** 牌底离地（m）。 */
  bottomY: 2.3,
  /** 牌高 = min(maxHeight, baseHeight + rowHeight × 行数, ceiling − ceilingClearMin − bottomY)，topY ≤ 2.87m 严避 2.895m+ 吊顶格栅、喷淋与灯具。 */
  baseHeight: 0.3,
  rowHeight: 0.14,
  maxHeight: 0.58,
  /** 牌顶离天花板至少留出（m），用于吊杆。 */
  ceilingClearMin: 0.12,
  /** 牌宽 = min(maxWidth, 走廊宽 − sideClear·2)；主环宽廊自动拓宽至 4.24m 支持双出口单行大字并排。 */
  maxWidth: 4.24,
  minWidth: 1.2,
  sideClear: 0.4,
  /** 灯箱厚度（m）。 */
  depth: 0.1,
  /** 吊杆间距占牌宽比例（两根吊杆在 ±rodInset·width/2）。 */
  rodInset: 0.8,
  /** 每面最多行数（= 出口数）。 */
  maxRows: 4,
  /** 路口牌距路口（m）。两头都是路口且长度 < 2·approachM + minGapM 的短走廊只在中点挂一块。 */
  approachM: 3,
  /** 沿线相邻牌最大间距（m）。 */
  maxSpacingM: 15,
  /** 死胡同 / 出口端头到最近牌的最大距离（m）。 */
  endGapM: 7.5,
  /** 同一条 chain 上两块牌最小间距（m），更近则合并。不同走廊的路口牌不合并，保证每个来向都有牌。 */
  minGapM: 2.5,
  /** 楼梯占地外扩（m）：此范围内不挂牌（梯井上方无吊顶）。 */
  stairKeepOut: 0.5,
  /** 距出口落脚点 ≤ 该值的牌标为门厅牌。 */
  vestibuleM: 6,
  /** 牌面距离取整（m）。 */
  distanceRoundM: 5,
} as const

export type SzjArrow = 'straight' | 'slight-left' | 'left' | 'sharp-left' | 'slight-right' | 'right' | 'sharp-right' | 'back'

/** 箭头 → 相对行进方向的转角中心（度，正 = 右转）。 */
export const SZJ_ARROW_DEG: Readonly<Record<SzjArrow, number>> = {
  straight: 0,
  'slight-right': 45,
  right: 90,
  'sharp-right': 150,
  'slight-left': -45,
  left: -90,
  'sharp-left': -150,
  back: 180,
}

export const SZJ_ARROW_GLYPH: Readonly<Record<SzjArrow, string>> = {
  straight: '↑',
  'slight-right': '↗',
  right: '→',
  'sharp-right': '↘',
  'slight-left': '↖',
  left: '←',
  'sharp-left': '↙',
  back: '↓',
}

/** 出口在牌面上的写法：编号 + 地标名。 */
export const SZJ_EXIT_NAMES: Readonly<Record<SzjStairId, { code: string; name: string; en: string }>> = {
  nw: { code: 'NW', name: '南方大厦', en: 'Nanfang Bldg' },
  ne: { code: 'NE', name: '解放东路', en: 'Jiefang Rd E' },
  se: { code: 'SE', name: '文化大厦', en: 'Culture Bldg' },
  sw: { code: 'SW', name: '微笑堂', en: 'Niko Niko Do' },
}

export interface SzjSignRow {
  readonly stairId: SzjStairId
  readonly code: string
  readonly name: string
  readonly en: string
  readonly arrow: SzjArrow
  readonly glyph: string
  /** 在下一个路口的精确转角（度，正 = 右）；直达或掉头时为 0 / 180。 */
  readonly turnDeg: number
  /** 最短路距离（m，未取整）。 */
  readonly distanceM: number
  /** 牌面显示的距离（m，按 distanceRoundM 取整，最小 distanceRoundM）。 */
  readonly shownM: number
  /** 中文牌面整行，如「← NW出口 南方大厦 35m」。 */
  readonly text: string
}

export interface SzjSignFace {
  /** +1：读者沿 chain A→B 方向走；−1：B→A。 */
  readonly side: 1 | -1
  /** 读者行进方向（单位向量，室内坐标）。 */
  readonly travelDir: SzjXZ
  /** 把默认法线 +Z 的 PlaneGeometry 设 rotation.y = yaw，牌面即朝向读者（法线 = −travelDir）。 */
  readonly yaw: number
  /** 按距离升序；1~maxRows 行，永不为空。 */
  readonly rows: readonly SzjSignRow[]
}

export type SzjSignKind = 'junction' | 'run' | 'vestibule'

export interface SzjHangingSign {
  readonly id: string
  readonly kind: SzjSignKind
  /** 中心（室内坐标）。 */
  readonly x: number
  readonly z: number
  readonly bottomY: number
  readonly height: number
  readonly width: number
  readonly depth: number
  /** 吊杆顶 = 天花板高度。 */
  readonly rodTopY: number
  /** 两根吊杆在牌局部 x = ±rodX。 */
  readonly rodX: number
  /** 所在走廊（取该处最宽的那条）。 */
  readonly corridorId: string
  readonly chainId: number
  /** 在 chain 上距 A 端的偏移（m）。 */
  readonly chainOffset: number
  /** faces[0].side = +1，faces[1].side = −1。 */
  readonly faces: readonly [SzjSignFace, SzjSignFace]
}

export interface SzjWayfinding {
  readonly version: typeof SZJ_WAYFINDING_VERSION
  readonly graph: SzjCorridorGraph
  readonly signs: readonly SzjHangingSign[]
  /** 出口 → 每个节点到该出口的最短距离与下一跳。 */
  readonly routes: Readonly<Record<SzjStairId, { dist: Float64Array; next: Int32Array }>>
  /** 每条 chain 上的牌（按 chainOffset 升序）。 */
  readonly signsByChain: readonly (readonly SzjHangingSign[])[]
}

function signedTurnDeg(inDir: SzjXZ, outDir: SzjXZ): number {
  // right of travel dir d = (-d.z, d.x)（Y 朝上，看向 -Z 时右手 = +X）
  const cross = outDir.x * -inDir.z + outDir.z * inDir.x
  const dot = outDir.x * inDir.x + outDir.z * inDir.z
  return (Math.atan2(cross, dot) * 180) / Math.PI
}

export function classifyTurn(deg: number): SzjArrow {
  const a = Math.abs(deg)
  if (a <= 22.5) return 'straight'
  if (a <= 67.5) return deg > 0 ? 'slight-right' : 'slight-left'
  if (a <= 135) return deg > 0 ? 'right' : 'left'
  return deg > 0 ? 'sharp-right' : 'sharp-left'
}

/** 某 chain 在节点 n 处的「离开 n」朝向；chain 两端都是 n（环）时由 start 区分。 */
function leaveHeading(g: SzjCorridorGraph, c: SzjChain, start: boolean): SzjXZ {
  return chainHeadingFrom(g, c, start)
}

/**
 * 沿 chain c 朝 side 方向到达端点后，若要去 stairId：返回在该端点的出向 chain（含方向）与转角。
 * 端点就是目标出口 → { arrive: true }。
 */
export function turnAtChainEnd(
  wf: Pick<SzjWayfinding, 'graph' | 'routes'>,
  c: SzjChain,
  side: 1 | -1,
  stairId: SzjStairId,
): { arrive: true } | { arrive: false; chain: number; start: boolean; turnDeg: number } | null {
  const g = wf.graph
  const end = side === 1 ? c.nodes[c.nodes.length - 1] : c.nodes[0]
  if (end === g.exitNode[stairId]) return { arrive: true }
  const hop = wf.routes[stairId].next[end]
  if (hop < 0) return null
  const arriveDir = leaveHeading(g, c, side !== 1)
  const inDir = { x: -arriveDir.x, z: -arriveDir.z }
  for (const nc of g.nodeChains[end]) {
    const c2 = g.chains[nc.chain]
    if (c2.id === c.id && nc.start === (side !== 1)) continue
    const firstHop = nc.start ? c2.nodes[1] : c2.nodes[c2.nodes.length - 2]
    if (firstHop !== hop) continue
    return { arrive: false, chain: c2.id, start: nc.start, turnDeg: signedTurnDeg(inDir, leaveHeading(g, c2, nc.start)) }
  }
  return null
}

function roundShown(d: number): number {
  const r = SZJ_SIGN_SPEC.distanceRoundM
  return Math.max(r, Math.round(d / r) * r)
}

function makeRow(stairId: SzjStairId, arrow: SzjArrow, turnDeg: number, distanceM: number): SzjSignRow {
  const n = SZJ_EXIT_NAMES[stairId]
  const shownM = roundShown(distanceM)
  const glyph = SZJ_ARROW_GLYPH[arrow]
  const verb = arrow === 'back' ? '（掉头）' : ''
  return { stairId, code: n.code, name: n.name, en: n.en, arrow, glyph, turnDeg, distanceM, shownM, text: `${glyph} ${n.code}出口 ${n.name} ${shownM}m${verb}` }
}

function inStairKeepOut(p: SzjXZ): boolean {
  for (const id of SZJ_STAIR_IDS) {
    const st = getStairwell(id)
    const l = indoorToStairLocal(st, p)
    const m = SZJ_SIGN_SPEC.stairKeepOut
    if (Math.abs(l.x) <= st.width / 2 + m && Math.abs(l.z) <= st.length / 2 + m) return true
  }
  return false
}

/** chain 上的布点偏移（未去重）。 */
function chainOffsets(g: SzjCorridorGraph, c: SzjChain): number[] {
  const S = SZJ_SIGN_SPEC
  const L = c.length
  const a = c.nodes[0]
  const b = c.nodes[c.nodes.length - 1]
  const fixed: number[] = []
  if (g.decision[a] && g.decision[b] && L < S.approachM * 2 + S.minGapM) {
    // 两头都是路口、又短到放不下两块牌：中点一块，两面分别给两个路口的转向
    fixed.push(L / 2)
  } else {
    if (g.decision[a]) fixed.push(Math.min(S.approachM, L / 2))
    if (g.decision[b]) fixed.push(L - Math.min(S.approachM, L / 2))
  }
  fixed.sort((x, y) => x - y)
  const out: number[] = []
  // 端头（非路口）：距端头 ≤ endGapM
  const lo = g.decision[a] ? null : 0
  const hi = g.decision[b] ? null : L
  const pts = [...fixed]
  if (pts.length === 0) {
    if (L <= S.endGapM * 2) pts.push(L / 2)
    else pts.push(Math.min(S.endGapM, L / 2), Math.max(L - S.endGapM, L / 2))
  } else {
    if (lo !== null && pts[0] - lo > S.endGapM) pts.unshift(Math.min(S.endGapM, pts[0] / 2))
    if (hi !== null && hi - pts[pts.length - 1] > S.endGapM) pts.push(Math.max(L - S.endGapM, (pts[pts.length - 1] + L) / 2))
  }
  pts.sort((x, y) => x - y)
  for (let i = 0; i < pts.length; i++) {
    out.push(pts[i])
    if (i + 1 < pts.length) {
      const gap = pts[i + 1] - pts[i]
      const k = Math.ceil(gap / S.maxSpacingM)
      for (let j = 1; j < k; j++) out.push(pts[i] + (gap * j) / k)
    }
  }
  return out
}

/** 由布局生成全部吊牌。确定性。 */
export function buildSzjWayfinding(layout: SzjLayout): SzjWayfinding {
  const S = SZJ_SIGN_SPEC
  const g = buildSzjCorridorGraph(layout)
  const routes = {} as Record<SzjStairId, { dist: Float64Array; next: Int32Array }>
  for (const id of SZJ_STAIR_IDS) routes[id] = shortestTo(g, g.exitNode[id])
  const base = { graph: g, routes }
  const signs: SzjHangingSign[] = []
  const signsByChain: SzjHangingSign[][] = g.chains.map(() => [])
  const ceiling = layout.ceilingHeight
  for (const c of g.chains) {
    const kept: number[] = []
    for (const s of chainOffsets(g, c)) {
      const p = chainPointAt(g, c, s)
      if (inStairKeepOut(p)) continue
      if (kept.some(k => Math.abs(k - s) < S.minGapM)) continue
      kept.push(s)
    }
    for (const s of kept) {
      const p = chainPointAt(g, c, s)
      const a = c.nodes[0]
      const b = c.nodes[c.nodes.length - 1]
      const faceRows: Record<1 | -1, SzjSignRow[]> = { 1: [], [-1]: [] }
      for (const id of SZJ_STAIR_IDS) {
        const r = routes[id]
        const viaB = c.length - s + r.dist[b]
        const viaA = s + r.dist[a]
        if (!Number.isFinite(viaA) && !Number.isFinite(viaB)) continue
        const side: 1 | -1 = viaB <= viaA ? 1 : -1
        const dist = Math.min(viaA, viaB)
        const t = turnAtChainEnd(base, c, side, id)
        if (!t) continue
        const deg = t.arrive ? 0 : t.turnDeg
        faceRows[side].push(makeRow(id, t.arrive ? 'straight' : classifyTurn(deg), deg, dist))
      }
      for (const side of [1, -1] as const) {
        faceRows[side].sort((x, y) => x.distanceM - y.distanceM)
        if (faceRows[side].length === 0) {
          const other = faceRows[(side === 1 ? -1 : 1) as 1 | -1]
          if (other.length) faceRows[side].push(makeRow(other[0].stairId, 'back', 180, other[0].distanceM))
        }
        faceRows[side] = faceRows[side].slice(0, S.maxRows)
      }
      const rows = Math.max(1, faceRows[1].length, faceRows[-1].length)
      const height = Math.min(S.maxHeight, S.baseHeight + S.rowHeight * rows, ceiling - S.ceilingClearMin - S.bottomY)
      const corridorWidth = g.edges[p.edge].width
      const maxCorridorWidth = corridorWidth >= 5.2 ? S.maxWidth : Math.min(2.8, S.maxWidth)
      const width = Math.max(S.minWidth, Math.min(maxCorridorWidth, corridorWidth - S.sideClear * 2))
      const face = (side: 1 | -1): SzjSignFace => {
        const d = side === 1 ? p.dir : { x: -p.dir.x, z: -p.dir.z }
        return { side, travelDir: d, yaw: Math.atan2(-d.x, -d.z), rows: faceRows[side] }
      }
      const nearExit = SZJ_STAIR_IDS.some(id => {
        const f = g.nodes[g.exitNode[id]]
        return Math.hypot(f.x - p.x, f.z - p.z) <= S.vestibuleM
      })
      const nearJunction = (g.decision[a] && s <= S.approachM + 1e-6) || (g.decision[b] && c.length - s <= S.approachM + 1e-6)
      const sign: SzjHangingSign = {
        id: `szj-sign-${String(signs.length + 1).padStart(3, '0')}`,
        kind: nearExit ? 'vestibule' : nearJunction ? 'junction' : 'run',
        x: p.x,
        z: p.z,
        bottomY: S.bottomY,
        height,
        width,
        depth: S.depth,
        rodTopY: ceiling,
        rodX: (width / 2) * S.rodInset,
        corridorId: g.edges[p.edge].corridorId,
        chainId: c.id,
        chainOffset: s,
        faces: [face(1), face(-1)],
      }
      signs.push(sign)
      signsByChain[c.id].push(sign)
    }
  }
  for (const list of signsByChain) list.sort((x, y) => x.chainOffset - y.chainOffset)
  return { version: SZJ_WAYFINDING_VERSION, graph: g, signs, routes, signsByChain }
}

// ---------------------------------------------------------------------------
// 跟牌模拟：只看牌面箭头和眼前走廊几何走，不读最短路表。验收与 verify 都用它。
// ---------------------------------------------------------------------------

export interface SzjFollowResult {
  readonly ok: boolean
  readonly reason: 'arrived' | 'loop' | 'missing-row' | 'dead-end' | 'no-match' | 'no-sign' | 'step-cap'
  readonly walkedM: number
  readonly signsRead: number
}

/** 从 chain 上一点（chainId, offset）出发，跟着吊牌走到 stairId。 */
export function followSigns(wf: SzjWayfinding, start: { chainId: number; offset: number }, stairId: SzjStairId, stepCap = 400): SzjFollowResult {
  const g = wf.graph
  // 1) 走到最近的一块牌（沿走廊距离），模拟「抬头找最近的牌」
  const seedDist = new Float64Array(g.nodes.length).fill(Infinity)
  const c0 = g.chains[start.chainId]
  seedDist[c0.nodes[0]] = start.offset
  seedDist[c0.nodes[c0.nodes.length - 1]] = Math.min(seedDist[c0.nodes[c0.nodes.length - 1]], c0.length - start.offset)
  const done = new Uint8Array(g.nodes.length)
  for (;;) {
    let u = -1
    let best = Infinity
    for (let i = 0; i < g.nodes.length; i++) if (!done[i] && seedDist[i] < best) { best = seedDist[i]; u = i }
    if (u < 0) break
    done[u] = 1
    for (const o of g.adj[u]) {
      const d = best + g.edges[o.edge].length
      if (d < seedDist[o.to]) seedDist[o.to] = d
    }
  }
  let target: SzjHangingSign | null = null
  let targetD = Infinity
  for (const sg of wf.signs) {
    const c = g.chains[sg.chainId]
    let d = Math.min(seedDist[c.nodes[0]] + sg.chainOffset, seedDist[c.nodes[c.nodes.length - 1]] + c.length - sg.chainOffset)
    if (sg.chainId === start.chainId) d = Math.min(d, Math.abs(sg.chainOffset - start.offset))
    if (d < targetD) { targetD = d; target = sg }
  }
  if (!target) return { ok: false, reason: 'missing-row', walkedM: 0, signsRead: 0 }
  let walked = targetD
  let read = 0
  const seen = new Set<string>()
  let sign: SzjHangingSign = target
  // 2) 读牌 → 走 → 读牌
  for (let step = 0; step < stepCap; step++) {
    read++
    let row: SzjSignRow | undefined
    let face: SzjSignFace | undefined
    for (const f of sign.faces) {
      const r = f.rows.find(x => x.stairId === stairId && x.arrow !== 'back')
      if (r) { row = r; face = f }
    }
    if (!row || !face) return { ok: false, reason: 'missing-row', walkedM: walked, signsRead: read }
    const key = `${sign.id}:${face.side}`
    if (seen.has(key)) return { ok: false, reason: 'loop', walkedM: walked, signsRead: read }
    seen.add(key)
    let chain = g.chains[sign.chainId]
    let side = face.side
    let offset = sign.chainOffset
    let arrow: SzjArrow | null = row.arrow
    for (;;) {
      // 前方同一 chain 上下一块牌
      const list = wf.signsByChain[chain.id]
      const ahead = side === 1 ? list.find(x => x.chainOffset > offset + 1e-9) : [...list].reverse().find(x => x.chainOffset < offset - 1e-9)
      if (ahead) {
        walked += Math.abs(ahead.chainOffset - offset)
        sign = ahead
        break
      }
      walked += side === 1 ? chain.length - offset : offset
      const end = side === 1 ? chain.nodes[chain.nodes.length - 1] : chain.nodes[0]
      if (end === g.exitNode[stairId]) return { ok: true, reason: 'arrived', walkedM: walked, signsRead: read }
      // 在端点按箭头选出向：可选的出向里，与箭头角最接近者
      const arriveDir = chainHeadingFrom(g, chain, side !== 1)
      const inDir = { x: -arriveDir.x, z: -arriveDir.z }
      const options = g.nodeChains[end].filter(nc => !(nc.chain === chain.id && nc.start === (side !== 1)))
      if (options.length === 0) return { ok: false, reason: 'dead-end', walkedM: walked, signsRead: read }
      // 到了路口却没有牌给的指示：真人会迷路，判失败（不猜）
      if (arrow === null && options.length > 1) return { ok: false, reason: 'no-sign', walkedM: walked, signsRead: read }
      const want = SZJ_ARROW_DEG[arrow ?? 'straight']
      let pick = options[0]
      let pickErr = Infinity
      for (const o of options) {
        const deg = signedTurnDeg(inDir, chainHeadingFrom(g, g.chains[o.chain], o.start))
        const err = Math.abs(((deg - want + 540) % 360) - 180)
        if (err < pickErr) { pickErr = err; pick = o }
      }
      if (pickErr > 67.5) return { ok: false, reason: 'no-match', walkedM: walked, signsRead: read }
      chain = g.chains[pick.chain]
      side = pick.start ? 1 : -1
      offset = pick.start ? 0 : chain.length
      // 过了路口，旧指示作废，必须见到下一块牌
      arrow = null
    }
  }
  return { ok: false, reason: 'step-cap', walkedM: walked, signsRead: read }
}

/** 走廊网络上任一点到最近吊牌的最大沿走廊距离（m）。精确计算（分段线性）。 */
export function maxDistanceToNearestSign(wf: SzjWayfinding): number {
  const g = wf.graph
  const n = g.nodes.length
  const dist = new Float64Array(n).fill(Infinity)
  for (const sg of wf.signs) {
    const c = g.chains[sg.chainId]
    const a = c.nodes[0]
    const b = c.nodes[c.nodes.length - 1]
    dist[a] = Math.min(dist[a], sg.chainOffset)
    dist[b] = Math.min(dist[b], c.length - sg.chainOffset)
  }
  const done = new Uint8Array(n)
  for (;;) {
    let u = -1
    let best = Infinity
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i }
    if (u < 0) break
    done[u] = 1
    for (const o of g.adj[u]) {
      const d = best + g.edges[o.edge].length
      if (d < dist[o.to]) dist[o.to] = d
    }
  }
  let worst = 0
  for (const c of g.chains) {
    // chain 上的牌把 chain 切成若干区间；区间两端值已知，取区间内最大值
    const da = dist[c.nodes[0]]
    const db = dist[c.nodes[c.nodes.length - 1]]
    const offs = wf.signsByChain[c.id].map(s => s.chainOffset)
    const knots: { s: number; v: number }[] = [{ s: 0, v: da }, ...offs.map(s => ({ s, v: 0 })), { s: c.length, v: db }]
    for (let i = 0; i + 1 < knots.length; i++) {
      const p = knots[i]
      const q = knots[i + 1]
      const L = q.s - p.s
      // f(t) = min(p.v + t, q.v + L − t)，最大值 (p.v + q.v + L) / 2（夹在端点值之间）
      const peak = Math.abs(p.v - q.v) >= L ? Math.max(p.v, q.v) : (p.v + q.v + L) / 2
      worst = Math.max(worst, peak)
    }
  }
  return worst
}

