import test from 'node:test'
import assert from 'node:assert/strict'
import { SZJ_STAIR_IDS, getStairwell, indoorToStairLocal, validateSzjLayout } from '../contract.ts'
import { SHIZIJIE_B1_LAYOUT } from '../layout/index.ts'
import {
  SZJ_SIGN_SPEC,
  buildSzjWayfinding,
  classifyTurn,
  followSigns,
  maxDistanceToNearestSign,
} from './index.ts'

const wf = buildSzjWayfinding(SHIZIJIE_B1_LAYOUT)
const g = wf.graph

function lcg(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function randomPoints(n, seed) {
  const rnd = lcg(seed)
  const total = g.chains.reduce((a, c) => a + c.length, 0)
  const out = []
  for (let i = 0; i < n; i++) {
    let t = rnd() * total
    let ci = 0
    while (ci < g.chains.length - 1 && t > g.chains[ci].length) {
      t -= g.chains[ci].length
      ci++
    }
    out.push({ chainId: ci, offset: Math.min(t, g.chains[ci].length) })
  }
  return out
}

test('布局合法、图连通、4 个出口节点 = 契约落脚点', () => {
  assert.deepEqual(validateSzjLayout(SHIZIJIE_B1_LAYOUT), [])
  for (const id of SZJ_STAIR_IDS) {
    const n = g.nodes[g.exitNode[id]]
    const f = getStairwell(id).footIndoor
    assert.ok(Math.hypot(n.x - f.x, n.z - f.z) < 1e-9, `${id} 出口节点偏离落脚点`)
    const unreachable = [...wf.routes[id].dist].filter(d => !Number.isFinite(d)).length
    assert.equal(unreachable, 0, `${id} 有 ${unreachable} 个节点不可达`)
  }
})

test('k2 跟牌模拟：200 随机点 × 4 出口全部到达，0 环路', () => {
  const pts = randomPoints(200, 20261125)
  const fails = []
  let walked = 0
  for (const p of pts) {
    for (const id of SZJ_STAIR_IDS) {
      const r = followSigns(wf, p, id)
      walked += r.walkedM
      if (!r.ok) fails.push({ p, id, reason: r.reason })
    }
  }
  console.log(`follow: runs=${pts.length * 4} fails=${fails.length} loops=${fails.filter(f => f.reason === 'loop').length} avgWalk=${(walked / (pts.length * 4)).toFixed(1)}m`)
  assert.deepEqual(fails, [])
})

test('跟牌模拟（穷举）：从每块牌每一面出发去每个出口都到达', () => {
  const fails = []
  for (const s of wf.signs) {
    for (const id of SZJ_STAIR_IDS) {
      const r = followSigns(wf, { chainId: s.chainId, offset: s.chainOffset }, id)
      if (!r.ok) fails.push(`${s.id}->${id}:${r.reason}`)
    }
  }
  assert.deepEqual(fails, [])
})

test('跟牌路程不绕远：平均 ≤ 最短路 × 1.25', () => {
  const pts = randomPoints(200, 7)
  let ratioSum = 0
  let n = 0
  for (const p of pts) {
    const c = g.chains[p.chainId]
    for (const id of SZJ_STAIR_IDS) {
      const r = followSigns(wf, p, id)
      const d = wf.routes[id].dist
      const best = Math.min(p.offset + d[c.nodes[0]], c.length - p.offset + d[c.nodes[c.nodes.length - 1]])
      if (best > 5) {
        ratioSum += r.walkedM / best
        n++
      }
    }
  }
  const avg = ratioSum / n
  console.log(`detour ratio avg=${avg.toFixed(3)} over ${n} runs`)
  assert.ok(avg <= 1.25, `平均绕路比 ${avg}`)
})

test('k2 覆盖：走廊网络任一点到最近吊牌 ≤ 15m', () => {
  const worst = maxDistanceToNearestSign(wf)
  console.log(`coverage: signs=${wf.signs.length} maxNetworkDist=${worst.toFixed(2)}m`)
  assert.ok(worst <= 15, `最远 ${worst}m`)
})

test('每个路口的每个来向都有路口牌（≤ approachM）', () => {
  const missing = []
  for (let n = 0; n < g.nodes.length; n++) {
    if (!g.decision[n]) continue
    for (const nc of g.nodeChains[n]) {
      const c = g.chains[nc.chain]
      const S = SZJ_SIGN_SPEC
      const short = g.decision[c.nodes[0]] && g.decision[c.nodes[c.nodes.length - 1]] && c.length < S.approachM * 2 + S.minGapM
      const lim = short ? c.length / 2 : S.approachM
      const has = wf.signsByChain[c.id].some(s => (nc.start ? s.chainOffset : c.length - s.chainOffset) <= lim + 1e-6)
      if (!has) missing.push(`node${n}/chain${c.id}`)
    }
  }
  assert.deepEqual(missing, [])
})

test('吊牌几何：挂天花板、不进梯井、不出界、两面各 1~4 行', () => {
  const ceil = SHIZIJIE_B1_LAYOUT.ceilingHeight
  const b = SHIZIJIE_B1_LAYOUT.bounds
  const ids = new Set()
  for (const s of wf.signs) {
    assert.ok(!ids.has(s.id))
    ids.add(s.id)
    assert.equal(s.bottomY, 2.3)
    assert.equal(s.rodTopY, ceil)
    assert.ok(s.bottomY + s.height <= 2.88 + 1e-9, `${s.id} 超出 2.88m 防穿模净空红线`)
    assert.ok(s.bottomY + s.height <= ceil - SZJ_SIGN_SPEC.ceilingClearMin + 1e-9, `${s.id} 顶到天花板`)
    assert.ok(s.width >= SZJ_SIGN_SPEC.minWidth && s.width <= SZJ_SIGN_SPEC.maxWidth)
    assert.ok(s.x >= b.minX && s.x <= b.maxX && s.z >= b.minZ && s.z <= b.maxZ)
    for (const id of SZJ_STAIR_IDS) {
      const st = getStairwell(id)
      const l = indoorToStairLocal(st, s)
      assert.ok(!(Math.abs(l.x) <= st.width / 2 && Math.abs(l.z) <= st.length / 2), `${s.id} 在 ${id} 梯井内`)
    }
    assert.equal(s.faces[0].side, 1)
    assert.equal(s.faces[1].side, -1)
    for (const f of s.faces) {
      assert.ok(f.rows.length >= 1 && f.rows.length <= 4, `${s.id} 面行数 ${f.rows.length}`)
      // 法线 (sin yaw, cos yaw) = −travelDir
      assert.ok(Math.abs(Math.sin(f.yaw) + f.travelDir.x) < 1e-9 && Math.abs(Math.cos(f.yaw) + f.travelDir.z) < 1e-9)
      for (let i = 1; i < f.rows.length; i++) assert.ok(f.rows[i - 1].distanceM <= f.rows[i].distanceM)
      for (const r of f.rows) assert.match(r.text, /^[↑↗→↘↖←↙↓] (NW|NE|SE|SW)出口 \S+ \d+m/)
    }
    // 两面合起来恰好覆盖 4 个出口（掉头行除外）
    const listed = new Set(s.faces.flatMap(f => f.rows.filter(r => r.arrow !== 'back').map(r => r.stairId)))
    assert.equal(listed.size, 4, `${s.id} 只列了 ${[...listed]}`)
  }
})

test('转向分档与确定性', () => {
  assert.equal(classifyTurn(0), 'straight')
  assert.equal(classifyTurn(30), 'slight-right')
  assert.equal(classifyTurn(-90), 'left')
  assert.equal(classifyTurn(170), 'sharp-right')
  const again = buildSzjWayfinding(SHIZIJIE_B1_LAYOUT)
  assert.deepEqual(
    again.signs.map(s => [s.id, s.x, s.z, s.faces.map(f => f.rows.map(r => r.text))]),
    wf.signs.map(s => [s.id, s.x, s.z, s.faces.map(f => f.rows.map(r => r.text))]),
  )
})
