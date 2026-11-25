import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import { DRINKS_SITE_CANDIDATES, shopLocalToWorld, SITE } from '../site.ts'
import * as terrainMod from './index.ts'
import { fitDrinksPlot } from './index.ts'

// 实测 public/world GL04 (-768,-256) 在王城商厦北立面附近的真实凹坑标高场近似模型（供离线测试验证下陷填平）
function sampleWangchengRealPitDemY(wx, wz) {
  // 正阳路西侧 plateau ≈ 155.70m，解放东路路面 ≈ 157.10m，而王城商厦北墙脚 (-580..-568, -68..-60) 下陷至 ~152.2..153.8m
  const roadRidge = 157.12 - Math.max(0, wz + 82) * 0.32
  const westPlaza = 155.7 + Math.max(0, -wz - 78) * 0.14
  const pitDepth = 2.6 * Math.exp(-(((wx + 574) / 22) ** 2 + ((wz + 64) / 9.5) ** 2))
  return Math.max(150.4, Math.min(157.2, Math.max(roadRidge, westPlaza) - pitDepth))
}

test('terrain/index.ts 对外只导出 fitDrinksPlot() 且源码零灯光/零 mifen 依赖', () => {
  const exportedKeys = Object.keys(terrainMod).filter(k => k !== 'default')
  assert.deepEqual(exportedKeys, ['fitDrinksPlot'])
  assert.equal(typeof fitDrinksPlot, 'function')

  const dir = new URL('.', import.meta.url).pathname
  for (const file of ['index.ts', 'plot-sampler.ts', 'plot-mesh.ts']) {
    const text = readFileSync(join(dir, file), 'utf8')
    assert.equal(/new THREE\.[A-Za-z]*Light/.test(text), false, `${file} 禁止新建 Three Light`)
    assert.equal(/\.\.\/mifen|\/mifen\//.test(text), false, `${file} 禁止依赖 mifen`)
  }
})

test('site.ts 重核 wangcheng_mall 坐标、13.4°朝向、157.35m标高且默认挂载王城店', () => {
  const mall = DRINKS_SITE_CANDIDATES.wangcheng_mall
  assert.equal(SITE.id, 'wangcheng_mall')
  assert.equal(mall.osmRef, 'way/264901525')
  assert.ok(Math.abs(mall.bearingDeg - 13.4) < 0.05)
  assert.ok(mall.worldX >= -619 && mall.worldX <= -543)
  assert.ok(mall.worldZ >= -71.5 && mall.worldZ <= -3)
  assert.equal(mall.fallbackGroundY, 157.35)
  assert.equal(DRINKS_SITE_CANDIDATES.zhengyang_208.fallbackGroundY, 155.7)
})

test('fitDrinksPlot 填平王城下陷地块：店铺四角与门前人行道离地高差 <= 0.05m，且外缘无悬空缝隙', () => {
  const scene = new THREE.Scene()
  const shopGroup = new THREE.Group()
  const mall = DRINKS_SITE_CANDIDATES.wangcheng_mall

  const plot = fitDrinksPlot({
    site: mall,
    scene,
    shopGroup,
    sampleGroundY: sampleWangchengRealPitDemY,
  })

  // 抬升填平约 3..4m 的王城下陷坑并齐平 157.35m 解放东路人行道
  assert.ok(plot.plotY >= 157.0 && plot.plotY <= 157.5, `unexpected plotY=${plot.plotY}`)
  assert.ok(plot.fillHeightM >= 2.0, `expected pit fill >= 2m, got ${plot.fillHeightM}`)
  assert.equal(shopGroup.position.x, mall.worldX)
  assert.equal(shopGroup.position.y, plot.plotY)
  assert.equal(shopGroup.position.z, mall.worldZ)
  assert.equal(shopGroup.rotation.y, mall.worldYaw)

  // 关键门禁：店铺四角、门洞与门前人行道各点离台基顶面高差 <= 0.05m
  assert.ok(plot.maxCornerGapM <= 0.05, `corner gap ${plot.maxCornerGapM}m > 0.05m`)
  assert.ok(plot.maxSidewalkGapM <= 0.05, `sidewalk gap ${plot.maxSidewalkGapM}m > 0.05m`)
  assert.ok(plot.maxOuterSeamGapM <= 0.05, `outer seam gap ${plot.maxOuterSeamGapM}m > 0.05m`)

  // 校验外缘采样点处 3D 坡面网格真实顶面与周边地表高差 <= 0.05m，且底基深入地表下方（零悬空）
  plot.plinthGroup.updateMatrixWorld(true)
  const ray = new THREE.Raycaster()
  const down = new THREE.Vector3(0, -1, 0)

  for (const s of [...plot.corners, ...plot.sidewalkSamples]) {
    ray.set(new THREE.Vector3(s.worldX, plot.plotY + 2, s.worldZ), down)
    const hit = ray.intersectObject(plot.plinthGroup, true)[0]
    assert.ok(hit, `missing plinth mesh under ${s.id}`)
    const diff = Math.abs(hit.point.y - plot.plotY)
    assert.ok(diff <= 0.05, `${s.id} 离地/台面高差 ${diff.toFixed(4)}m > 0.05m`)
  }

  for (const rim of plot.outerSeamSamples) {
    ray.set(new THREE.Vector3(rim.worldX, plot.plotY + 4, rim.worldZ), down)
    const hit = ray.intersectObject(plot.plinthGroup, true)[0]
    assert.ok(hit, `missing slope seam under ${rim.id}`)
    const terrainY = sampleWangchengRealPitDemY(rim.worldX, rim.worldZ)
    const seamGap = Math.abs(hit.point.y - terrainY)
    assert.ok(seamGap <= 0.05, `${rim.id} 坡面外缘接地面高差 ${seamGap.toFixed(4)}m > 0.05m`)
  }

  const box = new THREE.Box3().setFromObject(plot.plinthGroup)
  assert.ok(box.min.y < plot.groundMinY - 0.5, `plinth footing ${box.min.y} must anchor below terrain ${plot.groundMinY}`)

  // 验证平地 / refit() 也能精确贴合不虚高
  plot.refit(() => 156.2)
  assert.equal(plot.plotY, 156.2)
  assert.equal(shopGroup.position.y, 156.2)
  assert.ok(plot.maxCornerGapM <= 0.05)
  assert.ok(plot.maxSidewalkGapM <= 0.05)

  // 验证门前台阶过渡后路人从解放东路走入店门的高度变化连续平滑
  const roadEdge = shopLocalToWorld(mall, 0.2, 8.2)
  const doorSill = shopLocalToWorld(mall, 0.2, 2.8)
  assert.equal(Math.abs(plot.samplePlotSurfaceY(roadEdge.x, roadEdge.z) - 156.2) <= 0.05, true)
  assert.equal(Math.abs(plot.samplePlotSurfaceY(doorSill.x, doorSill.z) - 156.2) <= 0.05, true)

  plot.dispose()
  assert.equal(scene.children.length, 0)
})
