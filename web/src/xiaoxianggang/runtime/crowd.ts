import * as THREE from 'three'
import type { XxgLayout } from '../contract.ts'
import { corridorToAabb, type Aabb2D } from './collision.ts'
import type { RectXZ } from './scene-boxes.ts'

/**
 * 小香港地下街限流人群（自研，不依赖十字街 crowd 模块）。
 * - 上限低：默认 18 人，帧时持续偏高时自动减半（不少于 6）。
 * - 限流生成：每 spawnIntervalS 最多补 1 人，只在离玩家 ≥10m 且不在正前方的节点生成；到寿命后在玩家身后或远处消失。
 * - 沿走廊中心线节点图行走，按行进方向靠右走、偶尔驻足看店，遇玩家侧让减速，与柱子和其他行人保持间距。
 * - 渲染 3 个 InstancedMesh（躯干 / 四肢 / 头），每人约 140 三角，固定 3 次 draw call。
 */
export const XXG_CROWD_MAX = 18
export const XXG_CROWD_MIN_CAP = 6
export const XXG_CROWD_TRIS_PER_AGENT = 140

export interface XxgCrowdOptions {
  readonly layout: XxgLayout
  readonly maxAgents?: number
  readonly spawnIntervalS?: number
  readonly seed?: number
  /** 实际渲染的柱子中心；缺省按 layout 柱网中落在走廊里的柱子。 */
  readonly columns?: readonly { readonly x: number; readonly z: number }[]
  /** Floor areas walkers must keep out of (the exit stairwells): links through them are dropped, lanes beside them narrowed. */
  readonly blocked?: readonly RectXZ[]
}

export interface XxgCrowdPlayer {
  readonly x: number
  readonly z: number
  /** 相机 yaw（看向 (-sin yaw, -cos yaw)）。 */
  readonly yaw: number
}

export interface XxgCrowdMetrics {
  readonly active: number
  readonly cap: number
  readonly maxAgents: number
  readonly spawned: number
  readonly despawned: number
  readonly drawCalls: number
  readonly triangles: number
}

export interface XxgCrowd {
  readonly group: THREE.Group
  step(dtSeconds: number, player: XxgCrowdPlayer): void
  /** 进场时调用：清空并在离玩家较远处预置约 60% 上限的人。 */
  reset(player: XxgCrowdPlayer): void
  getMetrics(): XxgCrowdMetrics
  /** 当前行人位置（测试与调试用）。 */
  getAgentPositions(): readonly { readonly x: number; readonly z: number }[]
  dispose(): void
}

interface NavNode {
  readonly x: number
  readonly z: number
  readonly links: { node: number; halfWidth: number }[]
}

interface Agent {
  x: number
  z: number
  yaw: number
  speed: number
  lanePref: number
  from: number
  to: number
  halfWidth: number
  waypoints: { x: number; z: number }[]
  pauseS: number
  ageS: number
  lifeS: number
  phase: number
  scale: number
  shirt: number
  pants: number
  sleeveSkin: boolean
  skinTone: number
}

const SHIRTS = [0xf2efe8, 0x2b2b2e, 0xd9c7a8, 0xe8b9c3, 0xa9c4dc, 0x6b7f99, 0x8c3b3b, 0xc9d6c0, 0xe9d36b, 0x4f6b58] as const
const PANTS = [0x2a2d33, 0x3d4f6b, 0xd8d0c0, 0x1f1f22, 0x6b6257, 0xece8e0, 0x5a6f8f] as const
const SKIN_TONES = [0xffffff, 0xf3e6dc, 0xe8d6c6, 0xf8ece2] as const
const SKIN = 0xe2b896
const HAIR = 0x1d1a18

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const inside = (b: Aabb2D, x: number, z: number, m = 0) =>
  x >= b.minX - m && x <= b.maxX + m && z >= b.minZ - m && z <= b.maxZ + m

/** Body radius plus the narrowest lane offset (laneFor): a link closer than this to a blocked area is dropped. */
const BLOCKED_CLEAR_M = 0.55

function pointRectDistance(x: number, z: number, r: RectXZ): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX)
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ)
  return Math.hypot(dx, dz)
}

function pointSegmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax
  const vz = bz - az
  const len2 = vx * vx + vz * vz
  const t = len2 > 1e-12 ? Math.min(1, Math.max(0, ((px - ax) * vx + (pz - az) * vz) / len2)) : 0
  return Math.hypot(px - ax - vx * t, pz - az - vz * t)
}

/** Exact distance between segment AB and an axis-aligned rect (0 when they touch). */
export function segmentRectClearance(ax: number, az: number, bx: number, bz: number, r: RectXZ): number {
  // Slab clip: does any part of the segment lie inside the rect?
  let t0 = 0
  let t1 = 1
  const dx = bx - ax
  const dz = bz - az
  for (const [p, d, lo, hi] of [
    [ax, dx, r.minX, r.maxX],
    [az, dz, r.minZ, r.maxZ],
  ] as const) {
    if (Math.abs(d) < 1e-12) {
      if (p < lo || p > hi) {
        t0 = 1
        t1 = 0
      }
      continue
    }
    const u0 = (lo - p) / d
    const u1 = (hi - p) / d
    t0 = Math.max(t0, Math.min(u0, u1))
    t1 = Math.min(t1, Math.max(u0, u1))
  }
  if (t0 <= t1) return 0
  return Math.min(
    pointRectDistance(ax, az, r),
    pointRectDistance(bx, bz, r),
    pointSegmentDistance(r.minX, r.minZ, ax, az, bx, bz),
    pointSegmentDistance(r.maxX, r.minZ, ax, az, bx, bz),
    pointSegmentDistance(r.minX, r.maxZ, ax, az, bx, bz),
    pointSegmentDistance(r.maxX, r.maxZ, ax, az, bx, bz),
  )
}

/** 由走廊中心线、交叉点、端点投影和出口落脚点组成的行走图；blocked 区域（楼梯井）不穿越。 */
export function buildXxgCrowdGraph(layout: XxgLayout, blocked: readonly RectXZ[] = []): NavNode[] {
  const nodes: NavNode[] = []
  const keyOf = (x: number, z: number) => `${Math.round(x * 20)},${Math.round(z * 20)}`
  const index = new Map<string, number>()
  const nodeAt = (x: number, z: number): number => {
    const k = keyOf(x, z)
    const hit = index.get(k)
    if (hit !== undefined) return hit
    nodes.push({ x, z, links: [] })
    index.set(k, nodes.length - 1)
    return nodes.length - 1
  }
  const link = (a: number, b: number, halfWidth: number) => {
    if (a === b) return
    const na = nodes[a]!
    const nb = nodes[b]!
    if (na.links.some(l => l.node === b)) return
    let hw = halfWidth
    for (const r of blocked) {
      const clear = segmentRectClearance(na.x, na.z, nb.x, nb.z, r)
      if (clear < BLOCKED_CLEAR_M) return
      // laneFor keeps lanes within halfWidth - 0.7; keep a body radius (0.3) off the blocked edge.
      hw = Math.min(hw, clear + 0.4)
    }
    na.links.push({ node: b, halfWidth: hw })
    nb.links.push({ node: a, halfWidth: hw })
  }

  const corridors = layout.corridors.map(c => {
    const alongX = Math.abs(c.to.x - c.from.x) >= Math.abs(c.to.z - c.from.z)
    return {
      c,
      box: corridorToAabb(c),
      alongX,
      fixed: alongX ? (c.from.z + c.to.z) * 0.5 : (c.from.x + c.to.x) * 0.5,
      t0: alongX ? Math.min(c.from.x, c.to.x) : Math.min(c.from.z, c.to.z),
      t1: alongX ? Math.max(c.from.x, c.to.x) : Math.max(c.from.z, c.to.z),
      stops: new Set<number>(),
    }
  })
  const pointOn = (k: (typeof corridors)[number], t: number) => (k.alongX ? { x: t, z: k.fixed } : { x: k.fixed, z: t })
  const addStop = (k: (typeof corridors)[number], t: number) => k.stops.add(Math.round(Math.min(k.t1, Math.max(k.t0, t)) * 100) / 100)
  const extraLinks: { ax: number; az: number; bx: number; bz: number; hw: number }[] = []

  for (const k of corridors) {
    addStop(k, k.t0)
    addStop(k, k.t1)
  }
  for (const a of corridors) {
    for (const b of corridors) {
      if (a === b) continue
      if (a.alongX !== b.alongX) {
        // 十字 / T 字交叉：两条中心线交点落在两条走廊范围内
        const px = a.alongX ? b.fixed : a.fixed
        const pz = a.alongX ? a.fixed : b.fixed
        if (inside(a.box, px, pz, 0.05) && inside(b.box, px, pz, 0.05)) {
          addStop(a, a.alongX ? px : pz)
          addStop(b, b.alongX ? px : pz)
        }
      }
      // a 的端点落在 b 里：投影到 b 的中心线并连一条短边（平行重叠的中庭、错位接口）
      for (const t of [a.t0, a.t1]) {
        const e = pointOn(a, t)
        if (!inside(b.box, e.x, e.z, 0.05)) continue
        const tb = b.alongX ? e.x : e.z
        addStop(b, tb)
        const p = pointOn(b, Math.min(b.t1, Math.max(b.t0, tb)))
        if (Math.hypot(p.x - e.x, p.z - e.z) > 0.05) {
          extraLinks.push({ ax: e.x, az: e.z, bx: p.x, bz: p.z, hw: Math.min(a.c.width, b.c.width) * 0.5 })
        }
      }
    }
  }
  for (const ex of layout.exits) {
    for (const k of corridors) {
      if (!inside(k.box, ex.foot.x, ex.foot.z, 0.05)) continue
      const tb = k.alongX ? ex.foot.x : ex.foot.z
      addStop(k, tb)
      const p = pointOn(k, Math.min(k.t1, Math.max(k.t0, tb)))
      if (Math.hypot(p.x - ex.foot.x, p.z - ex.foot.z) > 0.05) {
        extraLinks.push({ ax: ex.foot.x, az: ex.foot.z, bx: p.x, bz: p.z, hw: k.c.width * 0.5 })
      }
    }
  }

  for (const k of corridors) {
    const ts = [...k.stops].sort((p, q) => p - q)
    // 长直段每 ~9m 加一个节点，驻足看店和转向都更自然
    const dense: number[] = []
    for (let i = 0; i < ts.length; i++) {
      dense.push(ts[i]!)
      const next = ts[i + 1]
      if (next === undefined) continue
      const pieces = Math.floor((next - ts[i]!) / 9)
      for (let j = 1; j <= pieces; j++) dense.push(ts[i]! + ((next - ts[i]!) * j) / (pieces + 1))
    }
    for (let i = 0; i + 1 < dense.length; i++) {
      const a = pointOn(k, dense[i]!)
      const b = pointOn(k, dense[i + 1]!)
      if (dense[i + 1]! - dense[i]! < 0.05) continue
      link(nodeAt(a.x, a.z), nodeAt(b.x, b.z), k.c.width * 0.5)
    }
  }
  for (const e of extraLinks) link(nodeAt(e.ax, e.az), nodeAt(e.bx, e.bz), e.hw)
  return nodes
}

function buildHeadGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.115, 1)
  g.scale(0.92, 1.08, 1)
  const pos = g.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  const skin = new THREE.Color(SKIN)
  const hair = new THREE.Color(HAIR)
  for (let i = 0; i < pos.count; i++) {
    // 头顶与后脑是头发（模型朝 +z）
    const isHair = pos.getY(i) > 0.035 || (pos.getZ(i) < -0.04 && pos.getY(i) > -0.06)
    const c = isHair ? hair : skin
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return g
}

export function createXxgCrowd(opts: XxgCrowdOptions): XxgCrowd {
  const maxAgents = Math.max(1, Math.floor(opts.maxAgents ?? XXG_CROWD_MAX))
  const spawnIntervalS = Math.max(0.1, opts.spawnIntervalS ?? 0.9)
  const rand = mulberry32(opts.seed ?? 0x5a17)
  const nodes = buildXxgCrowdGraph(opts.layout, opts.blocked)
  const walkable = nodes.map((n, i) => (n.links.length > 0 ? i : -1)).filter(i => i >= 0)
  const columns: { x: number; z: number }[] = opts.columns ? opts.columns.map(c => ({ x: c.x, z: c.z })) : []
  if (!opts.columns) {
    const corridorBoxes = opts.layout.corridors.map(corridorToAabb)
    for (const cx of opts.layout.columns.xs) {
      for (const cz of opts.layout.columns.zs) {
        if (corridorBoxes.some(b => inside(b, cx, cz, -0.3))) columns.push({ x: cx, z: cz })
      }
    }
  }
  const columnClear = opts.layout.columns.size * 0.5 + 0.38

  const group = new THREE.Group()
  group.name = 'xxg_crowd'

  const torsoGeo = new THREE.BoxGeometry(0.36, 0.6, 0.21)
  torsoGeo.translate(0, 1.13, 0)
  const limbGeo = new THREE.BoxGeometry(0.13, 0.86, 0.14)
  limbGeo.translate(0, -0.43, 0)
  const headGeo = buildHeadGeometry()
  const clothMat = new THREE.MeshStandardMaterial({ name: 'xxg_crowd_cloth', roughness: 0.86, metalness: 0, emissive: '#2a2622' })
  const headMat = new THREE.MeshStandardMaterial({ name: 'xxg_crowd_head', vertexColors: true, roughness: 0.7, metalness: 0, emissive: '#2a2622' })
  const torsoMesh = new THREE.InstancedMesh(torsoGeo, clothMat, maxAgents)
  const limbMesh = new THREE.InstancedMesh(limbGeo, clothMat, maxAgents * 4)
  const headMesh = new THREE.InstancedMesh(headGeo, headMat, maxAgents)
  torsoMesh.name = 'xxg_crowd_torso'
  limbMesh.name = 'xxg_crowd_limbs'
  headMesh.name = 'xxg_crowd_heads'
  for (const m of [torsoMesh, limbMesh, headMesh]) {
    m.frustumCulled = false
    m.count = 0
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    group.add(m)
  }

  const agents: Agent[] = []
  let cap = maxAgents
  let spawnTimer = 0
  let spawned = 0
  let despawned = 0
  let dtEma = 1 / 60
  let disposed = false

  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length) % arr.length]!

  const laneFor = (halfWidth: number, pref: number) => Math.max(0.25, Math.min(pref, halfWidth - 0.7))

  /** 从 from→to 这条边上、按行进方向靠右的车道点。 */
  const lanePoint = (from: NavNode, to: NavNode, at: NavNode, lane: number) => {
    const dx = to.x - from.x
    const dz = to.z - from.z
    const len = Math.hypot(dx, dz) || 1
    // 行进方向 (dx,dz) 的右手侧（俯视 x 右 z 下）：(-dz, dx)
    return { x: at.x + (-dz / len) * lane, z: at.z + (dx / len) * lane }
  }

  const assignEdge = (a: Agent, from: number, to: number) => {
    const nf = nodes[from]!
    const nt = nodes[to]!
    const halfWidth = nf.links.find(l => l.node === to)?.halfWidth ?? 1.6
    const lane = laneFor(halfWidth, a.lanePref)
    a.from = from
    a.to = to
    a.halfWidth = halfWidth
    a.waypoints = [lanePoint(nf, nt, nf, lane), lanePoint(nf, nt, nt, lane)]
  }

  const nextNode = (from: number, at: number): number => {
    const links = nodes[at]!.links
    if (links.length === 1) return links[0]!.node
    const options = links.filter(l => l.node !== from)
    return pick(options).node
  }

  const facingAway = (player: XxgCrowdPlayer, x: number, z: number) => {
    const fx = -Math.sin(player.yaw)
    const fz = -Math.cos(player.yaw)
    const dx = x - player.x
    const dz = z - player.z
    const d = Math.hypot(dx, dz) || 1
    return (fx * dx + fz * dz) / d < 0.25
  }

  const makeAgent = (from: number, to: number, t: number): Agent => {
    const a: Agent = {
      x: 0,
      z: 0,
      yaw: 0,
      speed: 0.9 + rand() * 0.45,
      lanePref: 0.35 + rand() * 1.3,
      from,
      to,
      halfWidth: 1.6,
      waypoints: [],
      pauseS: 0,
      ageS: 0,
      lifeS: 40 + rand() * 50,
      phase: rand() * Math.PI * 2,
      scale: 0.93 + rand() * 0.12,
      shirt: pick(SHIRTS),
      pants: pick(PANTS),
      sleeveSkin: rand() < 0.45,
      skinTone: pick(SKIN_TONES),
    }
    assignEdge(a, from, to)
    const p0 = a.waypoints[0]!
    const p1 = a.waypoints[1]!
    a.x = p0.x + (p1.x - p0.x) * t
    a.z = p0.z + (p1.z - p0.z) * t
    a.yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z)
    a.waypoints.shift()
    return a
  }

  const trySpawn = (player: XxgCrowdPlayer, minDist: number, requireHidden: boolean): boolean => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const from = pick(walkable)
      const n = nodes[from]!
      const to = pick(n.links).node
      const t = rand()
      const m = nodes[to]!
      const x = n.x + (m.x - n.x) * t
      const z = n.z + (m.z - n.z) * t
      const d = Math.hypot(x - player.x, z - player.z)
      if (d < minDist) continue
      if (requireHidden && d < 28 && !facingAway(player, x, z)) continue
      if (agents.some(o => Math.hypot(o.x - x, o.z - z) < 1.2)) continue
      agents.push(makeAgent(from, to, t))
      spawned++
      return true
    }
    return false
  }

  const reset = (player: XxgCrowdPlayer) => {
    agents.length = 0
    spawnTimer = 0
    cap = maxAgents
    dtEma = 1 / 60
    if (walkable.length === 0) return
    const target = Math.round(maxAgents * 0.6)
    for (let i = 0; i < target * 3 && agents.length < target; i++) trySpawn(player, 6, false)
    writeInstances()
  }

  const tmpM = new THREE.Matrix4()
  const tmpQ = new THREE.Quaternion()
  const tmpE = new THREE.Euler(0, 0, 0, 'YXZ')
  const tmpP = new THREE.Vector3()
  const tmpS = new THREE.Vector3()
  const tmpC = new THREE.Color()
  const local = new THREE.Vector3()

  function writeInstances(): void {
    const n = agents.length
    for (let i = 0; i < n; i++) {
      const a = agents[i]!
      const s = a.scale
      const moving = a.pauseS <= 0
      const swing = moving ? Math.sin(a.phase) * 0.42 : 0
      const bob = moving ? Math.abs(Math.cos(a.phase)) * 0.025 : 0
      const cosY = Math.cos(a.yaw)
      const sinY = Math.sin(a.yaw)
      const toWorld = (lx: number, ly: number, lz: number) =>
        local.set(a.x + (lx * cosY + lz * sinY) * s, ly * s + bob, a.z + (-lx * sinY + lz * cosY) * s)

      tmpE.set(0, a.yaw, 0)
      tmpQ.setFromEuler(tmpE)
      tmpP.set(a.x, bob, a.z)
      tmpS.set(s, s, s)
      tmpM.compose(tmpP, tmpQ, tmpS)
      torsoMesh.setMatrixAt(i, tmpM)
      torsoMesh.setColorAt(i, tmpC.setHex(a.shirt))

      tmpP.copy(toWorld(0, 1.6, 0.01))
      headMesh.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS))
      headMesh.setColorAt(i, tmpC.setHex(a.skinTone))

      // 四肢：0/1 腿（裤色），2/3 手臂（袖色或肤色），轴心在髋 / 肩
      const limbs: [number, number, number, number, number, number][] = [
        [-0.09, 0.86, 0, swing, 1, 1],
        [0.09, 0.86, 0, -swing, 1, 1],
        [-0.235, 1.4, 0, -swing * 0.7, 0.62, 0.68],
        [0.235, 1.4, 0, swing * 0.7, 0.62, 0.68],
      ]
      for (let k = 0; k < 4; k++) {
        const [lx, ly, lz, rot, sw, sl] = limbs[k]!
        tmpE.set(rot, a.yaw, 0)
        tmpQ.setFromEuler(tmpE)
        tmpP.copy(toWorld(lx, ly, lz))
        tmpS.set(s * sw, s * sl, s * sw)
        limbMesh.setMatrixAt(i * 4 + k, tmpM.compose(tmpP, tmpQ, tmpS))
        const color = k < 2 ? a.pants : a.sleeveSkin ? SKIN : a.shirt
        limbMesh.setColorAt(i * 4 + k, tmpC.setHex(color))
      }
    }
    torsoMesh.count = n
    headMesh.count = n
    limbMesh.count = n * 4
    for (const m of [torsoMesh, limbMesh, headMesh]) {
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
  }

  const step = (dtSeconds: number, player: XxgCrowdPlayer) => {
    if (disposed || walkable.length === 0) return
    const dt = Math.max(0, Math.min(0.1, Number.isFinite(dtSeconds) ? dtSeconds : 0))
    if (dt <= 0) return
    dtEma += (dt - dtEma) * 0.05
    if (dtEma > 0.04) cap = Math.max(XXG_CROWD_MIN_CAP, Math.floor(maxAgents * 0.5))
    else if (dtEma < 0.025) cap = maxAgents

    // 寿命到或超上限：在玩家身后 / 远处消失
    for (let i = agents.length - 1; i >= 0; i--) {
      const a = agents[i]!
      a.ageS += dt
      const over = agents.length > cap || a.ageS > a.lifeS
      if (!over) continue
      const d = Math.hypot(a.x - player.x, a.z - player.z)
      if (d > 22 || (d >= 10 && facingAway(player, a.x, a.z))) {
        agents.splice(i, 1)
        despawned++
      }
    }

    spawnTimer += dt
    if (spawnTimer >= spawnIntervalS) {
      spawnTimer = 0
      if (agents.length < cap) trySpawn(player, 10, true)
    }

    for (const a of agents) {
      if (a.pauseS > 0) {
        a.pauseS -= dt
        continue
      }
      let target = a.waypoints[0]
      if (!target) {
        // 到节点：选下一条边，先在路口内换到新边的右侧车道再前进；偶尔驻足看店
        assignEdge(a, a.to, nextNode(a.from, a.to))
        if (rand() < 0.18) a.pauseS = 2 + rand() * 3
        target = a.waypoints[0]!
      }
      let dx = target.x - a.x
      let dz = target.z - a.z
      const dist = Math.hypot(dx, dz)
      if (dist < 0.25) {
        a.waypoints.shift()
        continue
      }
      dx /= dist
      dz /= dist
      let speed = a.speed
      let sx = 0
      let sz = 0
      const pdx = a.x - player.x
      const pdz = a.z - player.z
      const pd = Math.hypot(pdx, pdz)
      if (pd < 1.3) {
        // 侧让玩家并减速
        const push = (1.3 - pd) / 1.3
        sx += (pdx / (pd || 1)) * push * 1.6
        sz += (pdz / (pd || 1)) * push * 1.6
        speed *= 0.55
      }
      for (const c of columns) {
        const cdx = a.x - c.x
        const cdz = a.z - c.z
        const cd = Math.hypot(cdx, cdz)
        if (cd < columnClear + 0.3 && cd > 1e-4) {
          const push = (columnClear + 0.3 - cd) / 0.3
          sx += (cdx / cd) * push
          sz += (cdz / cd) * push
        }
      }
      for (const o of agents) {
        if (o === a) continue
        const odx = a.x - o.x
        const odz = a.z - o.z
        const od = Math.hypot(odx, odz)
        if (od < 0.75 && od > 1e-4) {
          const push = (0.75 - od) / 0.75
          sx += (odx / od) * push
          sz += (odz / od) * push
        }
      }
      let vx = dx * speed + sx * 0.8
      let vz = dz * speed + sz * 0.8
      const vlen = Math.hypot(vx, vz)
      const vmax = a.speed * 1.25
      if (vlen > vmax) {
        vx *= vmax / vlen
        vz *= vmax / vlen
      }
      a.x += vx * dt
      a.z += vz * dt
      const wantYaw = Math.atan2(dx, dz)
      let dy = wantYaw - a.yaw
      while (dy > Math.PI) dy -= Math.PI * 2
      while (dy < -Math.PI) dy += Math.PI * 2
      a.yaw += dy * Math.min(1, dt * 6)
      a.phase += (Math.hypot(vx, vz) * dt * Math.PI * 2) / 1.25
    }
    writeInstances()
  }

  const getMetrics = (): XxgCrowdMetrics => ({
    active: agents.length,
    cap,
    maxAgents,
    spawned,
    despawned,
    drawCalls: agents.length > 0 ? 3 : 0,
    triangles: agents.length * XXG_CROWD_TRIS_PER_AGENT,
  })

  const dispose = () => {
    if (disposed) return
    disposed = true
    agents.length = 0
    group.removeFromParent()
    for (const m of [torsoMesh, limbMesh, headMesh]) {
      group.remove(m)
      m.dispose()
    }
    torsoGeo.dispose()
    limbGeo.dispose()
    headGeo.dispose()
    clothMat.dispose()
    headMat.dispose()
  }

  return {
    group,
    step,
    reset,
    getMetrics,
    getAgentPositions: () => agents.map(a => ({ x: a.x, z: a.z })),
    dispose,
  }
}
