import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import { createDefaultDrinksLayout } from '../sim/menu.ts'
import {
  DRINKS_SHOP_BLUEPRINT,
  DRINKS_SHOP_BLUEPRINT_ENTRIES,
  buildDrinksShopMesh,
  validateDrinksBlueprint,
} from './index.ts'

test('blueprint 每个尺寸带有效来源或「实拍可见」「推算」「无资料」标签且数值对齐 layout', () => {
  const report = validateDrinksBlueprint(DRINKS_SHOP_BLUEPRINT_ENTRIES)
  assert.equal(report.valid, true, `blueprint validation errors: ${report.errors.join(', ')}`)
  assert.ok(report.count >= 20, `expected >= 20 blueprint entries, got ${report.count}`)
  assert.ok(report.countsByTag['实拍可见'] >= 3, 'missing 实拍可见 entries from 06_IMG_1395')
  assert.ok(report.countsByTag['推算'] >= 3, 'missing 推算 entries')
  assert.ok(report.countsByTag['无资料'] >= 5, 'missing honest 无资料 entries')

  const layout = createDefaultDrinksLayout()
  assert.equal(DRINKS_SHOP_BLUEPRINT.shop_width.valueM, layout.width)
  assert.equal(DRINKS_SHOP_BLUEPRINT.total_depth.valueM, layout.depth)
})

test('drinks/shop 几何结构对齐营业工位/座位/门洞，零灯光且轻量', () => {
  const built = buildDrinksShopMesh()
  const metrics = built.getMetrics()

  assert.equal(metrics.lights, 0, 'shop mesh must contain zero THREE.Light nodes')
  assert.ok(metrics.triangles > 300 && metrics.triangles <= 12000, `unexpected polycount: ${metrics.triangles}`)
  assert.equal(metrics.blueprintValid, true)

  const layout = built.layout
  const box = new THREE.Box3().setFromObject(built.group)
  assert.ok(box.max.x - box.min.x >= layout.width, 'width must contain layout width')
  assert.ok(box.max.y >= 6.2, `expected 2-storey corner podium height >= 6.2m, got ${box.max.y}`)

  // 确认门洞、点单点、取餐点、座位不落入任何实体碰撞盒
  const insideCollider = (x, z) =>
    built.colliders.find(c => x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ)

  assert.equal(insideCollider(layout.entrance.x, layout.entrance.z), undefined, 'entrance blocked by collider')
  for (const c of layout.cashiers) {
    assert.equal(insideCollider(c.customerPos.x, c.customerPos.z), undefined, `${c.id} customerPos blocked`)
    assert.equal(insideCollider(c.clerkPos.x, c.clerkPos.z), undefined, `${c.id} clerkPos blocked`)
  }
  for (const p of layout.prepStations) {
    assert.equal(insideCollider(p.x, p.z), undefined, `${p.id} prepStation blocked`)
  }
  for (const s of layout.seats) {
    assert.equal(insideCollider(s.x, s.z), undefined, `${s.id} seat blocked`)
  }

  built.setNight(1)
  built.setCutaway(true)
  built.setCutaway(false)
  built.dispose()
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
