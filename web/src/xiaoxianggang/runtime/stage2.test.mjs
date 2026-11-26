import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'

import { XXG_BUDGET, XXG_PLAYER } from '../contract.ts'
import { XIAOXIANGGANG_B1_LAYOUT as layout } from '../layout/index.ts'
import { buildIndoorCollisionWorld, corridorToAabb, resolveIndoorMovement } from './collision.ts'
import { XXG_CROWD_MAX, XXG_CROWD_MIN_CAP, buildXxgCrowdGraph, createXxgCrowd } from './crowd.ts'
import { toIndoor, toWellLocal, wellVestibule, xxgIndoorWells } from './stairwell.ts'
import { XXG_STAIRWELL } from '../frame.ts'
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

    // 2 个中庭采光井 + 4 个楼梯井
    assert.equal(h.skylightOpenings.length, 2 + xxgIndoorWells().length)
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

test('楼梯井敞开：门直通 B1 走廊不留死胡同，井底平台抬头看得到整段楼梯直到街面，没有走廊墙或吊顶挡住', () => {
  const h = createIndoorGreyboxScene(layout)
  try {
    const wall = meshByName(h.scene, 'xxg_wall_corridor')
    const ceiling = meshByName(h.scene, 'xxg_ceiling_grid')
    const W = XXG_STAIRWELL
    for (const w of xxgIndoorWells()) {
      const front = toIndoor(w, 0, W.zBack - 1.6)
      const from = new THREE.Vector3(front.x, 1.0, front.z)
      const door = new THREE.Vector3(w.door.x, 1.0, w.door.z)
      const dir = door.clone().sub(from)
      assert.equal(rayHits(wall, from, dir, dir.length()).length, 0, `${w.portalId} 门前到门被墙封住`)
      // 四个门都开在走廊里，不补门厅；出门沿走廊至少一侧 8m 内没墙，不是三面墙的凹槽。
      assert.equal(wellVestibule(w, layout.corridors.map(corridorToAabb)), null, `${w.portalId} 门外补了门厅`)
      const side = toIndoor(w, 1, W.zBack - 1.6)
      const along = new THREE.Vector3(side.x - front.x, 0, side.z - front.z)
      const clear = [along, along.clone().negate(), dir.clone().negate().setY(0).normalize()].map(d => {
        const hit = rayHits(wall, from, d, 8)
        return hit.length ? hit[0].distance : 8
      })
      assert.ok(Math.max(...clear) >= 8, `${w.portalId} 出门三面都是墙 ${clear.map(c => c.toFixed(1)).join('/')}`)

      const landing = toIndoor(w, 0, -3.55)
      const top = toIndoor(w, 0, W.zTop)
      const eye = new THREE.Vector3(landing.x, XXG_PLAYER.eyeHeight, landing.z)
      const street = new THREE.Vector3(top.x, W.depth + XXG_PLAYER.eyeHeight, top.z)
      const up = street.clone().sub(eye)
      for (const m of [wall, ceiling]) {
        assert.equal(rayHits(m, eye, up, up.length()).length, 0, `${w.portalId} 平台看楼梯被 ${m.name} 挡住`)
      }
    }
  } finally {
    h.dispose()
  }
})

test('楼梯井几何：每井 25 条铜色防滑条、两扇玻璃门各一次 draw call、静态 draw call 给人群留余量', () => {
  const h = createIndoorGreyboxScene(layout)
  try {
    assert.ok(h.meshCount <= XXG_BUDGET.indoorDrawCallsMax - 3, `meshCount=${h.meshCount} > 37`)
    const nosingMesh = meshByName(h.scene, 'xxg_stair_nosing_bronze')
    assert.equal(nosingMesh.material.map, null, '防滑条不得新增纹理')
    const nosings = boxesOf(nosingMesh)
    const c = new THREE.Vector3()
    for (const w of xxgIndoorWells()) {
      const inWell = nosings.filter(b => {
        b.getCenter(c)
        const l = toWellLocal(w, c.x, c.z)
        return Math.abs(l.x) < 0.1 && l.z > XXG_STAIRWELL.zBottom - 0.2 && l.z < XXG_STAIRWELL.zTop + 0.2
      })
      assert.equal(inWell.length, XXG_STAIRWELL.risers, `${w.portalId} 防滑条 ${inWell.length}`)
      // Nosing tops climb one riser per tread from the landing up to the street grade.
      const tops = inWell.map(b => b.max.y).sort((a, b) => a - b)
      for (let i = 1; i < tops.length; i++) assert.ok(Math.abs(tops[i] - tops[i - 1] - XXG_STAIRWELL.riser) < 1e-3)
      assert.ok(Math.abs(tops.at(-1) - XXG_STAIRWELL.depth - 0.004) < 1e-3, `${w.portalId} 顶级防滑条 ${tops.at(-1)}`)
    }
    for (const name of ['xxg_well_door_glass', 'xxg_well_door_frame', 'xxg_stair_granite', 'xxg_exit_signs']) meshByName(h.scene, name)
    h.wellDoors.setOpen(0, 1)
    h.wellDoors.setOpen(0, 0)
  } finally {
    h.dispose()
  }
})

test('楼梯井碰撞：B1 里乱走进不了楼梯段和侧墙，最多踩到末级踏步前沿', () => {
  const world = buildIndoorCollisionWorld(layout)
  const r = XXG_PLAYER.radius
  const W = XXG_STAIRWELL
  let seed = 7
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  for (const w of xxgIndoorWells()) {
    const front = toIndoor(w, 0, W.zBack - 1.6)
    let x = front.x
    let z = front.z
    let yaw = rand() * Math.PI * 2
    let reachedLanding = false
    for (let i = 0; i < 4000; i++) {
      if (rand() < 0.08) yaw = rand() * Math.PI * 2
      // Bias toward the door so the walk keeps testing the well, not the far corridors.
      const toDoor = Math.atan2(w.door.x - x, w.door.z - z)
      const heading = rand() < 0.35 ? toDoor : yaw
      const res = resolveIndoorMovement(world, layout, x, z, Math.sin(heading) * 0.12, Math.cos(heading) * 0.12)
      x = res.x
      z = res.z
      const l = toWellLocal(w, x, z)
      const inFootprint = x > w.footprint.minX && x < w.footprint.maxX && z > w.footprint.minZ && z < w.footprint.maxZ
      if (!inFootprint) continue
      assert.ok(Math.abs(l.x) <= W.halfWidth - r + 1e-3, `${w.portalId} 进了侧墙 lx=${l.x}`)
      // The flight solid starts one tread above the last nosing; the controller hands over to the street at exitZ long before.
      assert.ok(l.z <= W.zBottom + W.tread / 2 + 1e-3, `${w.portalId} 上了楼梯段 lz=${l.z}`)
      if (l.z >= W.exitZ) reachedLanding = true
    }
    assert.ok(reachedLanding, `${w.portalId} 随机走没到过井底平台`)
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
