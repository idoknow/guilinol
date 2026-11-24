import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import { createDefaultDrinksLayout } from '../sim/menu.ts'
import {
  DRINKS_CANDIDATE_IDS,
  DRINKS_SHOP_CANDIDATES,
  buildDrinksShopMesh,
  validateAllDrinksBlueprints,
} from './index.ts'

test('双候选蓝图每条尺寸均含有效「实拍可见」「推算」「无资料」标签与来源且数值对齐 layout', () => {
  const reports = validateAllDrinksBlueprints()
  const layout = createDefaultDrinksLayout()

  for (const id of DRINKS_CANDIDATE_IDS) {
    const report = reports[id]
    const bp = DRINKS_SHOP_CANDIDATES[id]
    assert.equal(report.valid, true, `${id} blueprint errors: ${report.errors.join(', ')}`)
    assert.ok(report.count >= 25, `${id} expected >= 25 blueprint entries, got ${report.count}`)
    assert.ok(report.countsByTag['实拍可见'] >= 4, `${id} missing 实拍可见 entries`)
    assert.ok(report.countsByTag['推算'] >= 5, `${id} missing 推算 entries`)
    assert.ok(report.countsByTag['无资料'] >= 15, `${id} missing honest 无资料 entries`)

    assert.equal(bp.map.shop_width.valueM, layout.width)
    assert.equal(bp.map.total_depth.valueM, layout.depth)
  }

  assert.equal(DRINKS_SHOP_CANDIDATES.poi_zhengyang208.map.facade_podium_storeys.valueM, 1)
  assert.equal(DRINKS_SHOP_CANDIDATES.wangcheng_mall.map.facade_podium_storeys.valueM, 3)
})

test('双候选点位几何结构对齐营业工位/座位/门洞/候餐点，零灯光且合并后轻量', () => {
  for (const candidate of DRINKS_CANDIDATE_IDS) {
    const built = buildDrinksShopMesh({ candidate })
    const metrics = built.getMetrics()

    assert.equal(metrics.candidate, candidate)
    assert.equal(metrics.lights, 0, `${candidate} must contain zero THREE.Light nodes`)
    assert.ok(metrics.triangles > 300 && metrics.triangles <= 12000, `${candidate} polycount ${metrics.triangles}`)
    assert.ok(metrics.meshes <= 60, `${candidate} expected batched draw meshes <= 60, got ${metrics.meshes}`)
    assert.equal(metrics.blueprintValid, true)

    const layout = built.layout
    const box = new THREE.Box3().setFromObject(built.group)
    assert.ok(box.max.x - box.min.x >= layout.width, `${candidate} width must contain layout`)
    if (candidate === 'wangcheng_mall') {
      assert.ok(box.max.y >= 14.5, `${candidate} expected full host podium >= 14.5m, got ${box.max.y}`)
    } else {
      assert.ok(box.max.y >= 4.4 && box.max.y <= 5.5, `${candidate} expected 1F pavilion 4.4..5.5m, got ${box.max.y}`)
    }

    const insideCollider = (x, z) =>
      built.colliders.find(c => x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ)

    assert.equal(insideCollider(layout.entrance.x, layout.entrance.z), undefined, `${candidate} entrance blocked`)
    // 验证从西入口到正门走廊不撞到门前立像
    for (let t = 0; t <= 1; t += 0.1) {
      const px = layout.approachLeft.x + (layout.entrance.x - layout.approachLeft.x) * t
      const pz = layout.approachLeft.z + (layout.entrance.z - layout.approachLeft.z) * t
      assert.equal(insideCollider(px, pz), undefined, `${candidate} approach path(${px.toFixed(2)},${pz.toFixed(2)}) blocked`)
    }
    for (const c of layout.cashiers) {
      assert.equal(insideCollider(c.customerPos.x, c.customerPos.z), undefined, `${candidate} ${c.id} customer blocked`)
      assert.equal(insideCollider(c.clerkPos.x, c.clerkPos.z), undefined, `${candidate} ${c.id} clerk blocked`)
    }
    for (const p of layout.prepStations) {
      assert.equal(insideCollider(p.x, p.z), undefined, `${candidate} ${p.id} prep blocked`)
    }
    for (const w of layout.waitingSpots) {
      assert.equal(insideCollider(w.x, w.z), undefined, `${candidate} wait(${w.x},${w.z}) blocked`)
    }
    for (const s of layout.seats) {
      assert.equal(insideCollider(s.x, s.z), undefined, `${candidate} ${s.id} seat blocked`)
    }

    built.setNight(1)
    built.setCutaway(true)
    built.setCutaway(false)
    built.dispose()
  }
})

test('drinks/shop 源码零 mifen 依赖且零真实商业商标字样', () => {
  const dir = new URL('.', import.meta.url).pathname
  for (const file of ['blueprint.ts', 'materials.ts', 'mesh.ts', 'index.ts']) {
    const text = readFileSync(join(dir, file), 'utf8')
    assert.equal(/\.\.\/mifen|\/mifen\//.test(text), false, `${file} 不应引用 mifen`)
    assert.equal(/蜜雪|Mixue|雪王/.test(text), false, `${file} 不应含真实商业商标`)
    assert.equal(/new THREE\.[A-Za-z]*Light/.test(text), false, `${file} 禁止新建 Three Light`)
  }
})
