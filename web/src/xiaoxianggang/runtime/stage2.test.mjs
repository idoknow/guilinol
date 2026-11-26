import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'

import { XXG_BUDGET, XXG_PLAYER } from '../contract.ts'
import { XIAOXIANGGANG_B1_LAYOUT as layout } from '../layout/index.ts'
import { buildIndoorCollisionWorld, resolveIndoorMovement } from './collision.ts'
import { XXG_CROWD_MAX, XXG_CROWD_MIN_CAP, buildXxgCrowdGraph, createXxgCrowd } from './crowd.ts'
import {
  buildExitStairGeometry,
  resolveXxgExitStair,
  sampleAllExitStairsFootY,
  sampleExitStairFootY,
  shouldClimbOut,
  xxgStairCurbM,
} from './exit-stairs.ts'
import { XXG_LAMP_SIZE_M, createIndoorGreyboxScene } from './indoor-scene.ts'
import { createXxgIndoorScene } from './controller.ts'
import { XXG_FIRST_SHOPS, classifyXxgShop, resolveAlcoveDepth } from './shop-fitout.ts'

const ceilH = layout.ceilingHeight

/** buildMergedBoxesGeometry 每个盒子 24 个顶点：按顺序还原每个盒子的包围盒。 */
function boxesOf(mesh) {
  const pos = mesh.geometry.getAttribute('position')
  const out = []
  for (let i = 0; i + 24 <= pos.count; i += 24) {
    const b = new THREE.Box3()
    for (let k = 0; k < 24; k++) b.expandByPoint(new THREE.Vector3(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)))
    out.push(b)
  }
  return out
}

function meshByName(scene, name) {
  const m = scene.getObjectByName(name)
  assert.ok(m && m.isMesh, `missing mesh ${name}`)
  return m
}

function rayHits(mesh, origin, dir, far) {
  const rc = new THREE.Raycaster(origin, dir.clone().normalize(), 0, far)
  mesh.material.side = THREE.DoubleSide
  return rc.intersectObject(mesh, false)
}

test('首批三家店覆盖服装 / 小饰品 / 小吃，且都在 B1 布局主街上', () => {
  const cats = new Set()
  for (const [id, first] of Object.entries(XXG_FIRST_SHOPS)) {
    const shop = layout.shops.find(s => s.id === id)
    assert.ok(shop, `layout 缺少 ${id}`)
    assert.ok(shop.name && shop.name.trim().length > 0)
    const corr = layout.corridors.find(c => c.id === shop.frontage)
    assert.equal(corr?.kind, 'main', `${id} 应临主街`)
    assert.equal(classifyXxgShop(shop), first.category)
    cats.add(first.category)
  }
  assert.deepEqual([...cats].sort(), ['accessory', 'apparel', 'snack'])
  assert.equal(classifyXxgShop({ id: 'x', name: '老字号糖水铺' }), 'snack')
  assert.equal(classifyXxgShop({ id: 'x', name: '针织女装' }), 'apparel')
  assert.equal(classifyXxgShop({ id: 'x', name: '潮流眼镜' }), 'accessory')
  // 首批铺面比普通铺面更深，便于从主街看到店内陈列
  assert.ok(resolveAlcoveDepth(0.4, 3.9, false, true) > resolveAlcoveDepth(0.4, 3.9, false, false))
})

test('B1 室内场景：预算内、吊顶在采光井与楼梯井处开洞、方灯落在 600mm 吊顶格中心', () => {
  const h = createIndoorGreyboxScene(layout)
  try {
    assert.ok(h.meshCount <= XXG_BUDGET.indoorDrawCallsMax - 3, `meshCount=${h.meshCount}（需给人群留 3 次 draw call）`)
    assert.ok(h.triangleCount + XXG_CROWD_MAX * 140 <= XXG_BUDGET.indoorTrianglesMax, `tris=${h.triangleCount}`)
    assert.ok(h.textureBytes <= XXG_BUDGET.indoorTextureBytesMax, `tex=${h.textureBytes}`)

    // 2 个中庭采光井 + 4 个出口楼梯井
    assert.equal(h.skylightOpenings.length, 2 + layout.exits.length)
    const ceiling = meshByName(h.scene, 'xxg_ceiling_grid')
    for (const o of h.skylightOpenings) {
      const cx = (o.minX + o.maxX) / 2
      const cz = (o.minZ + o.maxZ) / 2
      assert.equal(rayHits(ceiling, new THREE.Vector3(cx, ceilH + 2, cz), new THREE.Vector3(0, -1, 0), 4).length, 0, `吊顶未开洞 @${cx},${cz}`)
    }
    for (const name of ['xxg_skylight_glass', 'xxg_skylight_frame', 'xxg_globe_lamps', 'xxg_sky_cap', 'xxg_floor_terrazzo']) {
      meshByName(h.scene, name)
    }

    const lamps = boxesOf(meshByName(h.scene, 'xxg_light_cool')).filter(b => {
      const s = b.getSize(new THREE.Vector3())
      return Math.abs(s.x - XXG_LAMP_SIZE_M) < 1e-3 && Math.abs(s.z - XXG_LAMP_SIZE_M) < 1e-3 && s.y < 0.02
    })
    assert.ok(lamps.length >= 60, `嵌入式方灯 ${lamps.length} 盏`)
    const onGrid = v => Math.abs((((v - 0.3) % 0.6) + 0.6) % 0.6) < 1e-3 || Math.abs((((v - 0.3) % 0.6) + 0.6) % 0.6 - 0.6) < 1e-3
    for (const b of lamps) {
      const c = b.getCenter(new THREE.Vector3())
      assert.ok(onGrid(c.x) && onGrid(c.z), `方灯不在吊顶格中心 @${c.x.toFixed(3)},${c.z.toFixed(3)}`)
      for (const o of h.skylightOpenings) {
        assert.ok(!(c.x > o.minX && c.x < o.maxX && c.z > o.minZ && c.z < o.maxZ), '方灯落进采光井')
      }
    }
  } finally {
    h.dispose()
  }
})

test('出口楼梯井敞开：从落脚点朝楼梯看过去没有走廊墙挡住', () => {
  const h = createIndoorGreyboxScene(layout)
  try {
    const wall = meshByName(h.scene, 'xxg_wall_corridor')
    for (const ex of layout.exits) {
      const from = new THREE.Vector3(ex.foot.x, 1.0, ex.foot.z)
      const to = new THREE.Vector3(ex.stair.x, 1.0, ex.stair.z)
      const dir = to.clone().sub(from)
      assert.equal(rayHits(wall, from, dir, dir.length()).length, 0, `${ex.portalId} 楼梯被墙封住`)
    }
  } finally {
    h.dispose()
  }
})

test('出口楼梯：黄色 L 防滑条数量=级数、踏步顶面严格递增、topY 采样一致、draw call 符合预算', () => {
  const h = createIndoorGreyboxScene(layout)
  try {
    // 新增 draw call ≤ 2（仅增 xxg_stair_nosing_yellow 1 个 batch），总静态 meshCount ≤ 40 - 3
    assert.ok(h.meshCount <= XXG_BUDGET.indoorDrawCallsMax - 3, `meshCount=${h.meshCount} > 37`)
    assert.ok(h.meshCount <= 28, `meshCount=${h.meshCount}，相对 26 新增超过 2 个 draw call`)

    const nosingMesh = meshByName(h.scene, 'xxg_stair_nosing_yellow')
    assert.equal(nosingMesh.material.map, null, '黄色防滑条材质不得新增纹理')
    const allNosingBoxes = boxesOf(nosingMesh)
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()

    for (const ex of layout.exits) {
      const stair = resolveXxgExitStair(ex)
      assert.ok(stair.stepCount >= 8, `${ex.portalId} 级数 ${stair.stepCount} < 8`)
      assert.ok(stair.tread >= 0.27 - 1e-6 && stair.tread <= 0.32 + 1e-6, `${ex.portalId} tread=${stair.tread}`)

      const built = buildExitStairGeometry(stair)
      assert.equal(built.stepBoxes.length, stair.stepCount)
      assert.equal(built.nosingTopBoxes.length, stair.stepCount)
      assert.equal(built.nosingFrontBoxes.length, stair.stepCount)

      // 踏步顶面高度单调递增且末级对齐 topY
      let prevTop = 0
      for (const sb of built.stepBoxes) {
        const top = sb.cy + sb.sy * 0.5
        assert.ok(top > prevTop, `${ex.portalId} 踏步顶面高度未递增: ${top} <= ${prevTop}`)
        prevTop = top
      }
      assert.ok(Math.abs(prevTop - stair.topY) < 1e-6, `${ex.portalId} 末级顶面 ${prevTop} != topY ${stair.topY}`)

      // 场景中该出口区域的黄色 L 形防滑条：顶面窄条与前立面窄条各等于级数
      const minX = ex.stair.x - ex.stair.w * 0.5 - 0.05
      const maxX = ex.stair.x + ex.stair.w * 0.5 + 0.05
      const minZ = ex.stair.z - ex.stair.d * 0.5 - 0.05
      const maxZ = ex.stair.z + ex.stair.d * 0.5 + 0.05
      let topStripCount = 0
      let frontStripCount = 0
      for (const b of allNosingBoxes) {
        b.getCenter(center)
        if (center.x < minX || center.x > maxX || center.z < minZ || center.z > maxZ) continue
        b.getSize(size)
        if (size.y < 0.02) topStripCount++
        else frontStripCount++
      }
      assert.equal(topStripCount, stair.stepCount, `${ex.portalId} 顶面防滑条数 ${topStripCount} != ${stair.stepCount}`)
      assert.equal(frontStripCount, stair.stepCount, `${ex.portalId} 立面防滑条数 ${frontStripCount} != ${stair.stepCount}`)

      // sampleExitStairFootY 在楼梯顶平台处与 topY 一致，在落脚点返回 null
      const topPt = stair.alongZ
        ? { x: stair.acrossC, z: stair.endEdge - stair.sign * 0.1 }
        : { x: stair.endEdge - stair.sign * 0.1, z: stair.acrossC }
      const sampledTop = sampleExitStairFootY(stair, topPt.x, topPt.z)
      assert.ok(sampledTop !== null && Math.abs(sampledTop - stair.topY) < 1e-6, `${ex.portalId} topY=${stair.topY}, sampled=${sampledTop}`)
      assert.equal(sampleExitStairFootY(stair, ex.foot.x, ex.foot.z), null, `${ex.portalId} foot 处不应在楼梯上`)

      // 清理临时几何防止测试期显存告警
      for (const g of built.dwarfWallGeos) g.dispose()
      for (const g of built.handrailGeos) g.dispose()
    }
  } finally {
    h.dispose()
  }
})

test('出口楼梯：贴横向慢挪也会在上段离开，碰撞走不上顶部平台，拱座挡住吊顶背面', () => {
  const world = buildIndoorCollisionWorld(layout)
  const maxEyeY = layout.ceilingHeight + 0.3
  const dt = 1 / 60
  for (const ex of layout.exits) {
    const stair = world.exitStairs.find(s => s.portalId === ex.portalId)
    assert.ok(stair, `${ex.portalId} 缺楼梯`)

    // 站上第一级后几乎垂直于楼梯在两侧矮墙间来回走：沿上行方向每秒只挪 0.04m
    let x = stair.startCenter.x + stair.up.x * 0.3
    let z = stair.startCenter.z + stair.up.z * 0.3
    let side = 1
    let triggeredEyeY = null
    for (let i = 0; i < 60 * 120 && triggeredEyeY === null; i++) {
      const upSpeed = 0.04
      const latSpeed = Math.sqrt(XXG_PLAYER.walkSpeed ** 2 - upSpeed ** 2)
      const vx = stair.up.x * upSpeed + stair.right.x * latSpeed * side
      const vz = stair.up.z * upSpeed + stair.right.z * latSpeed * side
      const res = resolveIndoorMovement(world, layout, x, z, vx * dt, vz * dt)
      if (Math.hypot(res.x - x, res.z - z) < latSpeed * dt * 0.5) side = -side
      x = res.x
      z = res.z
      const hit = sampleAllExitStairsFootY(world.exitStairs, x, z)
      assert.ok(res.y + XXG_PLAYER.eyeHeight < maxEyeY, `${ex.portalId} 斜走视线 ${res.y + XXG_PLAYER.eyeHeight} 超过 ${maxEyeY}`)
      if (hit && shouldClimbOut(hit.stair, x, z, hit.footY, vx, vz)) triggeredEyeY = hit.footY + XXG_PLAYER.eyeHeight
    }
    assert.ok(triggeredEyeY !== null, `${ex.portalId} 斜走 120s 没触发离开`)
    assert.ok(triggeredEyeY < maxEyeY, `${ex.portalId} 触发时视线 ${triggeredEyeY}`)

    // 不看离开判定，正对楼梯一直往上走：碰撞把玩家挡在顶部平台之前
    x = ex.foot.x
    z = ex.foot.z
    let peakFootY = 0
    for (let i = 0; i < 60 * 10; i++) {
      const res = resolveIndoorMovement(world, layout, x, z, stair.up.x * XXG_PLAYER.walkSpeed * dt, stair.up.z * XXG_PLAYER.walkSpeed * dt)
      x = res.x
      z = res.z
      peakFootY = Math.max(peakFootY, res.y)
    }
    assert.ok(peakFootY < stair.topY - 0.3, `${ex.portalId} 走到 footY=${peakFootY}，太靠近顶部 ${stair.topY}`)
    assert.ok(peakFootY + XXG_PLAYER.eyeHeight < maxEyeY, `${ex.portalId} 视线 ${peakFootY + XXG_PLAYER.eyeHeight}`)

    // 下楼起点视线 topY + 1.6 低于拱座顶
    const curbTop = layout.ceilingHeight + xxgStairCurbM(stair, layout.ceilingHeight)
    assert.ok(curbTop >= stair.topY + XXG_PLAYER.eyeHeight + 0.1, `${ex.portalId} 拱座顶 ${curbTop} 不够高`)
  }
})

test('人群：行走图连通、上限与限流生成、确定性、不出走廊不穿柱、掉帧降级', () => {
  const graph = buildXxgCrowdGraph(layout)
  const seen = new Set([0])
  const queue = [0]
  while (queue.length) {
    for (const l of graph[queue.pop()].links) if (!seen.has(l.node)) (seen.add(l.node), queue.push(l.node))
  }
  assert.equal(seen.size, graph.length, '行走图不连通')

  const h = createIndoorGreyboxScene(layout)
  const world = buildIndoorCollisionWorld(layout)
  const ex = layout.exits[0]
  const player = { x: ex.foot.x, z: ex.foot.z, yaw: ex.yaw }
  const run = seed => {
    const c = createXxgCrowd({ layout, seed, columns: h.columnCenters })
    c.reset(player)
    const initial = c.getMetrics().active
    assert.ok(initial <= Math.round(XXG_CROWD_MAX * 0.6))
    for (const p of c.getAgentPositions()) assert.ok(Math.hypot(p.x - player.x, p.z - player.z) >= 6, '预置行人贴脸')
    let outside = 0
    let inColumn = 0
    let maxActive = 0
    let prevSpawned = c.getMetrics().spawned
    for (let i = 0; i < 60 * 90; i++) {
      c.step(1 / 60, player)
      const m = c.getMetrics()
      maxActive = Math.max(maxActive, m.active)
      // 0.9s 才放一人：任一帧最多新增 1 人
      assert.ok(m.spawned - prevSpawned <= 1)
      prevSpawned = m.spawned
      if (i % 20 === 0) {
        for (const p of c.getAgentPositions()) {
          if (!world.walkableRegions.some(r => p.x >= r.minX - 0.05 && p.x <= r.maxX + 0.05 && p.z >= r.minZ - 0.05 && p.z <= r.maxZ + 0.05)) outside++
          if (h.columnCenters.some(q => Math.abs(q.x - p.x) < 0.35 && Math.abs(q.z - p.z) < 0.35)) inColumn++
        }
      }
    }
    assert.ok(maxActive <= XXG_CROWD_MAX && maxActive >= 12, `maxActive=${maxActive}`)
    assert.equal(outside, 0, '行人走出走廊')
    assert.equal(inColumn, 0, '行人穿柱')
    const m = c.getMetrics()
    assert.equal(m.drawCalls, 3)
    assert.equal(m.triangles, m.active * 140)
    const snapshot = c.getAgentPositions()
    for (let i = 0; i < 300; i++) c.step(0.06, player)
    const slow = c.getMetrics()
    assert.ok(slow.cap === Math.max(XXG_CROWD_MIN_CAP, Math.floor(XXG_CROWD_MAX / 2)) && slow.active <= XXG_CROWD_MAX, `slow=${JSON.stringify(slow)}`)
    let disposed = 0
    c.group.traverse(o => {
      if (o.isMesh) o.geometry.addEventListener('dispose', () => disposed++)
    })
    c.dispose()
    c.dispose()
    assert.equal(disposed, 3)
    assert.equal(c.group.children.length, 0)
    return snapshot
  }
  try {
    assert.deepEqual(run(11), run(11), '同种子不可复现')
  } finally {
    h.dispose()
  }
})

test('控制器：人群随进场生成、可关闭、计入三角面并随 dispose 释放', () => {
  const on = createXxgIndoorScene({ layout, crowdSeed: 3 })
  const off = createXxgIndoorScene({ layout, crowdMaxAgents: 0 })
  try {
    assert.equal(on.getCrowdMetrics()?.active ?? 0, 0)
    assert.equal(off.getCrowdMetrics(), null)
  } finally {
    on.dispose()
    off.dispose()
  }
  assert.equal(on.getCrowdMetrics(), null)
})
