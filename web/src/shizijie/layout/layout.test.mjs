import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SZJ_BUDGET,
  SZJ_LAYOUT_LIMITS,
  SZJ_PLAYER,
  SZJ_STAIR_IDS,
  SZJ_STAIR_SPEC,
  getStairwell,
  indoorToStairLocal,
  layoutNpcCount,
  rectHitsStair,
  validateSzjLayout,
} from '../contract.ts'
import { SZJ_SIGN_ATLAS_RECTS } from '../look/palette.ts'
import {
  SHIZIJIE_B1_LAYOUT,
  SZJ_ARCHITECTURAL_META,
  assertValidSzjLayout,
  closestDistanceToSegment2D,
} from './index.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../../..')

function rectsOverlap2D(a, b, eps = 0.001) {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w - eps * 2 && Math.abs(a.z - b.z) * 2 < a.d + b.d - eps * 2
}

function pointToRectDistance(px, pz, r) {
  const cx = Math.max(r.x - r.w * 0.5, Math.min(px, r.x + r.w * 0.5))
  const cz = Math.max(r.z - r.d * 0.5, Math.min(pz, r.z + r.d * 0.5))
  return Math.hypot(px - cx, pz - cz)
}

function segSegIntersect(p0, p1, p2, p3) {
  const [x1, y1] = p0
  const [x2, y2] = p1
  const [x3, y3] = p2
  const [x4, y4] = p3
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(den) < 1e-12) return false
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

function rectToSegmentDistance(r, a, b) {
  const rx0 = r.x - r.w * 0.5
  const rx1 = r.x + r.w * 0.5
  const rz0 = r.z - r.d * 0.5
  const rz1 = r.z + r.d * 0.5
  if ((a.x >= rx0 && a.x <= rx1 && a.z >= rz0 && a.z <= rz1) || (b.x >= rx0 && b.x <= rx1 && b.z >= rz0 && b.z <= rz1)) {
    return 0
  }
  const edges = [
    [[rx0, rz0], [rx1, rz0]],
    [[rx1, rz0], [rx1, rz1]],
    [[rx1, rz1], [rx0, rz1]],
    [[rx0, rz1], [rx0, rz0]],
  ]
  for (const [e0, e1] of edges) {
    if (segSegIntersect([a.x, a.z], [b.x, b.z], e0, e1)) return 0
  }
  let best = Infinity
  best = Math.min(best, pointToRectDistance(a.x, a.z, r), pointToRectDistance(b.x, b.z, r))
  for (const [cx, cz] of [[rx0, rz0], [rx1, rz0], [rx1, rz1], [rx0, rz1]]) {
    best = Math.min(best, closestDistanceToSegment2D({ x: cx, z: cz }, a, b))
  }
  return best
}

function rectToCorridorEdgeDistance(r, corridor) {
  let best = Infinity
  for (let i = 0; i + 1 < corridor.points.length; i++) {
    best = Math.min(best, rectToSegmentDistance(r, corridor.points[i], corridor.points[i + 1]))
  }
  return best - corridor.width * 0.5
}

function pointToCorridorDistance(p, corridor) {
  let best = Infinity
  for (let i = 0; i + 1 < corridor.points.length; i++) {
    best = Math.min(best, closestDistanceToSegment2D(p, corridor.points[i], corridor.points[i + 1]))
  }
  return best
}

function segmentToSegmentDistance2D(a0, a1, b0, b1) {
  if (segSegIntersect([a0.x, a0.z], [a1.x, a1.z], [b0.x, b0.z], [b1.x, b1.z])) return 0
  return Math.min(
    closestDistanceToSegment2D(a0, b0, b1),
    closestDistanceToSegment2D(a1, b0, b1),
    closestDistanceToSegment2D(b0, a0, a1),
    closestDistanceToSegment2D(b1, a0, a1),
  )
}

function corridorsTouch2D(c1, c2) {
  const reach = (c1.width + c2.width) * 0.5 + 0.05
  for (let i = 0; i + 1 < c1.points.length; i++) {
    for (let j = 0; j + 1 < c2.points.length; j++) {
      if (segmentToSegmentDistance2D(c1.points[i], c1.points[i + 1], c2.points[j], c2.points[j + 1]) <= reach) {
        return true
      }
    }
  }
  return false
}

test('k9: contract validateSzjLayout 返回 [] 且 JSON 与 TS 导出逐位一致', () => {
  const jsonPath = path.join(__dirname, 'shizijie-b1.layout.json')
  const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  assert.deepEqual(validateSzjLayout(parsed), [])
  assert.deepEqual(validateSzjLayout(SHIZIJIE_B1_LAYOUT), [])
  assert.deepEqual(SHIZIJIE_B1_LAYOUT, parsed)
  assert.doesNotThrow(() => assertValidSzjLayout(SHIZIJIE_B1_LAYOUT))
})

test('k10-stairs: 4座出口与 SZJ_STAIRWELLS 误差 <= 0.01m，落地可走且走廊零穿刺上行梯井', () => {
  const layout = SHIZIJIE_B1_LAYOUT
  assert.equal(layout.exits.length, SZJ_STAIR_IDS.length)

  for (const id of SZJ_STAIR_IDS) {
    const st = getStairwell(id)
    const ex = layout.exits.find(e => e.stairId === id)
    assert.ok(ex, `missing exit ${id}`)
    assert.ok(Math.hypot(ex.center.x - st.indoor.x, ex.center.z - st.indoor.z) <= 0.01)
    assert.ok(Math.hypot(ex.foot.x - st.footIndoor.x, ex.foot.z - st.footIndoor.z) <= 0.01)
    assert.ok(Math.abs(ex.yaw - st.yaw) <= SZJ_LAYOUT_LIMITS.yawMatchEps)

    // footIndoor 必须落在某条 main 走廊净宽区内（留出玩家半径）
    const landingMain = layout.corridors.find(
      c => c.kind === 'main' && pointToCorridorDistance(st.footIndoor, c) <= c.width * 0.5 - SZJ_PLAYER.radius,
    )
    assert.ok(landingMain, `stair ${id} footIndoor (${st.footIndoor.x}, ${st.footIndoor.z}) not inside main corridor`)

    // 从 footIndoor 往前看 2.2m 也必须在走廊内（不撞墙）
    const ahead = { x: st.footIndoor.x + st.inward.x * 2.2, z: st.footIndoor.z + st.inward.z * 2.2 }
    const openAhead = layout.corridors.some(c => pointToCorridorDistance(ahead, c) <= c.width * 0.5 - SZJ_PLAYER.radius)
    assert.ok(openAhead, `stair ${id} forward sightline (${ahead.x.toFixed(2)}, ${ahead.z.toFixed(2)}) blocked`)

    // 确认踏步几何与 SZJ_STAIR_SPEC 一致
    assert.equal(st.profile.count, SZJ_STAIR_SPEC.count)
    assert.equal(st.profile.riser, SZJ_STAIR_SPEC.riser)
    assert.equal(st.profile.tread, SZJ_STAIR_SPEC.tread)

    // 确认没有走廊侵入任何楼梯井的中上段梯道
    for (const c of layout.corridors) {
      const hwC = c.width * 0.5
      for (let i = 0; i + 1 < c.points.length; i++) {
        const a = c.points[i]
        const b = c.points[i + 1]
        for (let k = 0; k <= 30; k++) {
          const t = k / 30
          const pt = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
          const l = indoorToStairLocal(st, pt)
          if (l.z >= -st.length * 0.5 && l.z <= st.length * 0.5 - 0.2) {
            const dxBox = Math.max(0, Math.abs(l.x) - st.width * 0.5)
            assert.ok(dxBox >= hwC - 0.05, `corridor ${c.id} seg[${i}] intrudes stair ${id} ramp (dxBox=${dxBox.toFixed(2)} < hw=${hwC})`)
          }
        }
      }
    }
  }
})

test('k10-shops: 24~36家铺位互不重叠、全品类覆盖、紧贴frontage、零侵廊/零压梯且对齐look图集', () => {
  const layout = SHIZIJIE_B1_LAYOUT
  assert.ok(layout.shops.length >= 24 && layout.shops.length <= 36, `shop count=${layout.shops.length}`)
  const corrById = new Map(layout.corridors.map(c => [c.id, c]))
  const cats = new Set()

  for (let i = 0; i < layout.shops.length; i++) {
    const a = layout.shops[i]
    cats.add(a.category)
    assert.ok(a.lookKey && a.lookKey in SZJ_SIGN_ATLAS_RECTS, `shop ${a.id} missing/unknown lookKey=${a.lookKey}`)
    for (let j = i + 1; j < layout.shops.length; j++) {
      assert.equal(rectsOverlap2D(a.rect, layout.shops[j].rect, SZJ_LAYOUT_LIMITS.overlapEpsilon), false)
    }
    const front = corrById.get(a.frontage)
    assert.ok(front, `missing frontage ${a.frontage}`)
    const edgeDist = rectToCorridorEdgeDistance(a.rect, front)
    assert.ok(edgeDist >= 0.04 && edgeDist <= 0.85, `shop ${a.id} edgeDist=${edgeDist.toFixed(3)} to ${a.frontage}`)

    for (const c of layout.corridors) {
      const clear = rectToCorridorEdgeDistance(a.rect, c)
      assert.ok(clear >= 0.04, `shop ${a.id} intrudes corridor ${c.id} (clear=${clear.toFixed(3)})`)
    }
    for (const id of SZJ_STAIR_IDS) {
      assert.equal(rectHitsStair(a.rect, getStairwell(id), SZJ_LAYOUT_LIMITS.stairClearance), false)
    }
  }
  assert.equal(cats.size, 9, `expected all 9 SzjShopCategory covered, got ${[...cats].join(',')}`)
})

test('k10-npc & connectivity: npcSpot+walkers <= 48、柱网零阻塞且全20条OSM走廊网络单连通', () => {
  const layout = SHIZIJIE_B1_LAYOUT
  const spotSum = layout.shops.reduce((s, sh) => s + sh.npcSpots.length, 0)
  const walkerSum = layout.walkers.reduce((s, w) => s + w.count, 0)
  const totalNpc = layoutNpcCount(layout)
  assert.ok(spotSum <= 48, `spotSum=${spotSum}`)
  assert.ok(totalNpc <= SZJ_BUDGET.npcMax, `totalNpc=${totalNpc}`)
  assert.equal(spotSum + walkerSum, totalNpc)

  const halfCol = layout.columns.size * 0.5
  for (const cx of layout.columns.xs) {
    for (const cz of layout.columns.zs) {
      const colRect = { x: cx, z: cz, w: layout.columns.size, d: layout.columns.size }
      for (const c of layout.corridors) {
        assert.ok(rectToCorridorEdgeDistance(colRect, c) >= 0.15, `col (${cx},${cz}) too close to corridor ${c.id}`)
      }
      for (const s of layout.shops) {
        assert.equal(rectsOverlap2D(colRect, s.rect, 0.01), false, `col (${cx},${cz}) hits shop ${s.id}`)
      }
      for (const id of SZJ_STAIR_IDS) {
        const st = getStairwell(id)
        assert.equal(rectHitsStair(colRect, st, 0.5), false, `col (${cx},${cz}) hits stair ${id}`)
        assert.ok(Math.hypot(st.footIndoor.x - cx, st.footIndoor.z - cz) > halfCol + 1.2)
      }
    }
  }

  // BFS 走廊图单连通校验
  const n = layout.corridors.length
  const adj = Array.from({ length: n }, () => [])
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (corridorsTouch2D(layout.corridors[i], layout.corridors[j])) {
        adj[i].push(j)
        adj[j].push(i)
      }
    }
  }
  const vis = new Set([0])
  const q = [0]
  while (q.length > 0) {
    const u = q.shift()
    for (const v of adj[u]) {
      if (!vis.has(v)) {
        vis.add(v)
        q.push(v)
      }
    }
  }
  assert.equal(vis.size, n, `corridor graph disconnected: ${vis.size}/${n}`)

  // 源码纯粹性 + 文档/平面图存在性
  const indexText = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8')
  assert.equal(/from\s+['"]three['"]/.test(indexText), false)
  assert.equal(/\.\.\/runtime|\/runtime\//.test(indexText), false)
  assert.ok(SZJ_ARCHITECTURAL_META.zones.length >= 5)

  const docPath = path.join(REPO_ROOT, 'docs/shizijie/layout.md')
  assert.equal(fs.existsSync(docPath), true, `missing layout doc ${docPath}`)

  const pngPath = path.join(__dirname, 'shizijie-b1-floorplan.png')
  assert.equal(fs.existsSync(pngPath), true, `missing floorplan PNG ${pngPath}`)
  const buf = fs.readFileSync(pngPath)
  assert.ok(buf.byteLength > 50_000)
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
})
