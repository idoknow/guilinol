import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import { createDefaultDrinksLayout } from '../sim/menu.ts'
import {
  DRINKS_CANDIDATE_IDS,
  DRINKS_SHOP_ANCHORS,
  DRINKS_SHOP_CANDIDATES,
  DRINKS_SHOP_DOORWAY,
  DRINKS_SHOP_INTERIOR,
  DRINKS_STAFF_OPERATION_ZONE,
  DRINKS_STAFF_WORKSTATIONS,
  buildDrinksShopMesh,
  validateAllDrinksBlueprints,
} from './index.ts'

test('双候选蓝图证据完备、门洞 ≥ 2.4m 且室内净面积已扩展容纳员工操作区', () => {
  const reports = validateAllDrinksBlueprints()
  const simLayout = createDefaultDrinksLayout()

  for (const id of DRINKS_CANDIDATE_IDS) {
    const report = reports[id]
    const bp = DRINKS_SHOP_CANDIDATES[id]
    assert.equal(report.valid, true, `${id} blueprint errors: ${report.errors.join(', ')}`)
    assert.ok(report.count >= 25, `${id} expected >= 25 blueprint entries, got ${report.count}`)
    assert.ok(report.countsByTag['实拍可见'] >= 8, `${id} missing 实拍可见 entries`)
    assert.ok(report.countsByTag['推算'] >= 6, `${id} missing 推算 entries`)
    assert.ok(report.countsByTag['无资料'] >= 7, `${id} missing 无资料 entries`)

    assert.ok(bp.map.door_width.valueM >= 2.4, `${id} doorway width must be >= 2.4m, got ${bp.map.door_width.valueM}`)
    assert.ok(bp.map.shop_width.valueM >= simLayout.width, `${id} width must contain sim layout`)
    assert.ok(bp.map.total_depth.valueM >= simLayout.depth + 1.5, `${id} total depth should be enlarged beyond legacy 9.8m`)
    assert.ok(bp.map.interior_depth.valueM >= 9.0, `${id} interior depth must be >= 9.0m to house back kitchen`)
  }

  assert.equal(DRINKS_SHOP_CANDIDATES.poi_zhengyang208.map.facade_podium_storeys.valueM, 1)
  assert.equal(DRINKS_SHOP_CANDIDATES.wangcheng_mall.map.facade_podium_storeys.valueM, 5)
  assert.ok(DRINKS_SHOP_DOORWAY.widthM >= 2.4, `doorway ${DRINKS_SHOP_DOORWAY.widthM}m < 2.4m`)
  assert.ok(DRINKS_SHOP_INTERIOR.areaSqm >= 115, `enlarged interior ${DRINKS_SHOP_INTERIOR.areaSqm}m^2 too small`)
  assert.ok(DRINKS_STAFF_WORKSTATIONS.length >= 10, 'must export staff workstation zones for front + prep + backroom')
})

test('双候选建筑合批后 draw calls ≤ 30、零灯光、门洞 ≥ 2.4m 且全员工与客流动线无阻塞', () => {
  for (const candidate of DRINKS_CANDIDATE_IDS) {
    const built = buildDrinksShopMesh({ candidate })
    const metrics = built.getMetrics()

    assert.equal(metrics.candidate, candidate)
    assert.equal(metrics.lights, 0, `${candidate} must contain zero THREE.Light nodes`)
    assert.ok(metrics.triangles > 600 && metrics.triangles <= 12000, `${candidate} polycount ${metrics.triangles}`)
    assert.ok(metrics.meshes <= 30, `${candidate} expected draw calls (meshes) <= 30, got ${metrics.meshes}`)
    assert.ok(metrics.doorwayWidthM >= 2.4, `${candidate} expected doorwayWidthM >= 2.4, got ${metrics.doorwayWidthM}`)
    assert.equal(metrics.blueprintValid, true)

    const box = new THREE.Box3().setFromObject(built.group)
    assert.ok(box.max.x - box.min.x >= built.interiorBounds.widthM, `${candidate} bounding box must cover enlarged interior`)
    if (candidate === 'wangcheng_mall') {
      assert.ok(box.max.y >= 24.5, `${candidate} expected full 8F Wangcheng host height >= 24.5m, got ${box.max.y}`)
    } else {
      assert.ok(box.max.y >= 4.8 && box.max.y <= 6.0, `${candidate} expected 1F street flagship 4.8..6.0m, got ${box.max.y}`)
    }

    const insideCollider = (x, z) =>
      built.colliders.find(c => x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ)

    // 2.80m 宽正门门洞全段畅通（从左门框内侧到右门框内侧，含前后穿行深度）
    for (let x = built.doorway.minX + 0.12; x <= built.doorway.maxX - 0.12; x += 0.25) {
      for (const z of [built.doorway.z - 0.4, built.doorway.z, built.doorway.z + 0.4]) {
        assert.equal(insideCollider(x, z), undefined, `${candidate} doorway(${x.toFixed(2)},${z}) blocked`)
      }
    }

    const layout = built.layout
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
    assert.equal(insideCollider(layout.storagePos.x, layout.storagePos.z), undefined, `${candidate} storagePos blocked`)
    for (const st of built.workstations) {
      assert.equal(insideCollider(st.staffPos.x, st.staffPos.z), undefined, `${candidate} staff ${st.id} blocked`)
    }
    for (const pt of DRINKS_SHOP_ANCHORS.patrolPoints) {
      assert.equal(insideCollider(pt.x, pt.z), undefined, `${candidate} patrol(${pt.x},${pt.z}) blocked`)
    }
    // 验证后场 1.80m 员工双向走廊全宽无遮挡
    for (let x = -3.6; x <= 4.4; x += 0.8) {
      assert.equal(insideCollider(x, DRINKS_STAFF_OPERATION_ZONE.backAisleZ), undefined, `${candidate} back aisle x=${x} blocked`)
    }

    built.setNight(0)
    const dayExtEmissive = built.materials.exteriorSignAtlasMat.emissiveIntensity
    const dayIntEmissive = built.materials.interiorSignAtlasMat.emissiveIntensity
    built.setNight(1)
    assert.ok(built.materials.exteriorSignAtlasMat.emissiveIntensity > dayExtEmissive + 0.6, `${candidate} night exterior signage emissive boost too weak`)
    assert.ok(built.materials.interiorSignAtlasMat.emissiveIntensity > dayIntEmissive + 0.5, `${candidate} night menu lightbox emissive boost too weak`)
    assert.ok(built.materials.podiumRedMat.emissiveIntensity > 0.4, `${candidate} night red facade should keep warm red glow`)
    built.setCutaway(true)
    built.setCutaway(false)
    built.dispose()
  }
})

test('drinks/shop 源码含 1:1 蜜雪品牌复刻要素、零 mifen 依赖且零 THREE.Light', () => {
  const dir = new URL('.', import.meta.url).pathname
  const texts = ['blueprint.ts', 'materials.ts', 'mesh.ts', 'index.ts'].map(f => readFileSync(join(dir, f), 'utf8'))
  const combined = texts.join('\n')
  assert.match(combined, /蜜雪冰城/)
  assert.match(combined, /雪王/)
  for (const text of texts) {
    assert.equal(/\.\.\/mifen|\/mifen\//.test(text), false, '不应引用 mifen')
    assert.equal(/new THREE\.[A-Za-z]*Light/.test(text), false, '禁止新建 Three Light')
  }
})
