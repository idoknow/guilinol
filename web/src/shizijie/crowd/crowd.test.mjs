import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createShizijieCrowd,
  getActiveSzjCrowdProbe,
  MAX_SHIZIJIE_CROWD_DRAW_CALLS,
  MAX_SHIZIJIE_CROWD_NPCS,
  MAX_SHIZIJIE_CROWD_STEP_MS,
} from './index.ts'
import { evaluateShizijieReport } from '../../../../scripts/verify-shizijie.mjs'

test('k13 硬预算：48 名 B1 NPC 仅增 <=6 drawCalls 且 500 帧 crowd.step 平均耗时 <1.5ms', () => {
  const crowd = createShizijieCrowd({ maxNpcs: 48, seed: 'k13-bench' })
  try {
    const init = crowd.getMetrics()
    assert.equal(init.activeCount, 48)
    assert.ok(init.keeperCount >= 10, `expected >=10 keepers, got ${init.keeperCount}`)
    assert.ok(init.customerCount >= 10, `expected >=10 customers, got ${init.customerCount}`)
    assert.ok(init.walkerCount >= 10, `expected >=10 walkers, got ${init.walkerCount}`)

    const instMeshes = []
    let extraDrawNodes = 0
    crowd.group.traverse(obj => {
      if (obj === crowd.group) return
      if (obj.isInstancedMesh) {
        instMeshes.push(obj)
      } else if (obj.isMesh || obj.isSprite) {
        extraDrawNodes++
      }
    })
    assert.equal(extraDrawNodes, 0)
    assert.ok(instMeshes.length <= MAX_SHIZIJIE_CROWD_DRAW_CALLS, `instancedMeshes=${instMeshes.length} > 6`)
    assert.ok(init.drawCalls > 0 && init.drawCalls <= MAX_SHIZIJIE_CROWD_DRAW_CALLS, `drawCalls=${init.drawCalls}`)
    assert.ok(init.triangles > 0 && init.triangles < 25000, `triangles=${init.triangles}`)

    for (let i = 0; i < 20; i++) crowd.step(1 / 60)

    const t0 = performance.now()
    for (let i = 0; i < 500; i++) {
      crowd.step(1 / 60)
    }
    const avgMs = (performance.now() - t0) / 500
    const after = crowd.getMetrics()
    assert.ok(avgMs < MAX_SHIZIJIE_CROWD_STEP_MS, `avgStepMs=${avgMs.toFixed(4)}ms >= ${MAX_SHIZIJIE_CROWD_STEP_MS}ms`)
    assert.ok(after.avgStepMs < MAX_SHIZIJIE_CROWD_STEP_MS, `metrics.avgStepMs=${after.avgStepMs}ms >= 1.5ms`)
    assert.ok(after.drawCalls <= MAX_SHIZIJIE_CROWD_DRAW_CALLS)
  } finally {
    crowd.dispose()
  }
})

test('三类 NPC 行为真实运转：walker 沿环廊步行、keeper 整理/待客、customer 逛铺不乱漂', () => {
  const crowd = createShizijieCrowd({ maxNpcs: 48, seed: 'k13-behavior' })
  try {
    const before = crowd.getAgentSnapshots()
    for (let i = 0; i < 180; i++) {
      crowd.step(1 / 30)
    }
    const after = crowd.getAgentSnapshots()
    assert.equal(after.length, 48)

    let walkerMoved = 0
    let keeperMaxDrift = 0
    let customerMaxDrift = 0
    for (let i = 0; i < 48; i++) {
      const a = before[i]
      const b = after[i]
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z))
      const d = Math.hypot(b.x - a.x, b.z - a.z)
      if (b.role === 'walker' && d > 1.0) walkerMoved++
      if (b.role === 'keeper') keeperMaxDrift = Math.max(keeperMaxDrift, d)
      if (b.role === 'customer') customerMaxDrift = Math.max(customerMaxDrift, d)
    }
    assert.ok(walkerMoved >= 10, `expected >=10 walkers moving >1m, got ${walkerMoved}`)
    assert.ok(keeperMaxDrift < 1.2, `keeper drifted too far: ${keeperMaxDrift}`)
    assert.ok(customerMaxDrift < 1.5, `customer drifted too far: ${customerMaxDrift}`)
  } finally {
    crowd.dispose()
  }
})

test('直接消费 contract.ts SzjLayout（shops[].npcSpots + walkers[] loop/往返）并硬限 <=48 人', () => {
  const shops = Array.from({ length: 24 }, (_, i) => ({
    id: `shop-${i}`,
    rect: { x: (i % 6) * 5 - 12, z: Math.floor(i / 6) * 6 - 9, w: 3, d: 2.5 },
    npcSpots: [
      { role: 'keeper', pose: i % 2 === 0 ? 'tidy' : 'idle', x: (i % 6) * 5 - 12, z: Math.floor(i / 6) * 6 - 9, yaw: 0 },
      { role: 'customer', pose: i % 3 === 0 ? 'phone' : i % 3 === 1 ? 'chat' : 'browse', x: (i % 6) * 5 - 12, z: Math.floor(i / 6) * 6 - 7.5, yaw: Math.PI },
    ],
  }))
  const crowd = createShizijieCrowd({
    layout: {
      shops: shops.slice(0, 16), // 32 spots
      walkers: [
        { id: 'ring-walk', points: [{ x: -12, z: -12 }, { x: 12, z: -12 }, { x: 12, z: 12 }, { x: -12, z: 12 }], loop: true, count: 10 },
        { id: 'alley-walk', points: [{ x: -8, z: 0 }, { x: 8, z: 0 }], loop: false, count: 10 }, // 32+20=52 -> clamp to 48
      ],
    },
  })
  try {
    const m = crowd.getMetrics()
    assert.equal(m.activeCount, MAX_SHIZIJIE_CROWD_NPCS)
    assert.equal(m.keeperCount, 16)
    assert.equal(m.customerCount, 16)
    assert.equal(m.walkerCount, 16)
    assert.ok(m.drawCalls <= MAX_SHIZIJIE_CROWD_DRAW_CALLS)
    for (let i = 0; i < 60; i++) crowd.step(1 / 30)
    assert.ok(crowd.getMetrics().avgStepMs < MAX_SHIZIJIE_CROWD_STEP_MS)
  } finally {
    crowd.dispose()
  }
})

test('setVisible 与重复 dispose 零泄漏且可安全空转', () => {
  const crowd = createShizijieCrowd({ maxNpcs: 48 })
  crowd.setVisible(false)
  assert.equal(crowd.getMetrics().drawCalls, 0)
  crowd.setVisible(true)
  assert.ok(crowd.getMetrics().drawCalls > 0 && crowd.getMetrics().drawCalls <= 6)

  crowd.dispose()
  crowd.dispose()
  crowd.step(1 / 60)

  const m = crowd.getMetrics()
  assert.equal(m.disposed, true)
  assert.equal(m.activeCount, 0)
  assert.equal(m.drawCalls, 0)
  assert.equal(crowd.group.children.length, 0)
  assert.deepEqual(crowd.getAgentSnapshots(), [])
  assert.equal(getActiveSzjCrowdProbe(), null)
  assert.equal(globalThis.__szjCrowdProbe, undefined)
})

test('live probe 暴露真实指标与可见性切换，且 dispose 彻底清理', () => {
  const crowd = createShizijieCrowd({ maxNpcs: 48, seed: 'k13-probe' })
  try {
    const probe = getActiveSzjCrowdProbe()
    assert.ok(probe)
    assert.equal(globalThis.__szjCrowdProbe, probe)
    assert.equal(probe.isVisible(), true)
    for (let i = 0; i < 30; i++) crowd.step(1 / 60)
    const m = probe.getMetrics()
    assert.equal(m.activeCount, 48)
    assert.equal(m.drawCalls, 6)
    assert.equal(m.stepSamples, 30)
    assert.ok(m.avgStepMs >= 0 && m.avgStepMs < MAX_SHIZIJIE_CROWD_STEP_MS)
    probe.setVisible(false)
    assert.equal(probe.isVisible(), false)
    assert.equal(probe.getMetrics().drawCalls, 0)
    probe.setVisible(true)
    assert.equal(probe.isVisible(), true)
    assert.equal(probe.getMetrics().drawCalls, 6)
  } finally {
    crowd.dispose()
  }
  assert.equal(getActiveSzjCrowdProbe(), null)
  assert.equal(globalThis.__szjCrowdProbe, undefined)
})

test('d1 回归防护：evaluateShizijieReport 严格校验 swapMs<=300、drawCalls/tris 上限与非造假 crowd 采样', () => {
  const mkMouth = (id, overrides = {}) => ({
    id,
    pass: true,
    reasons: [],
    maxEyeDy: 0.018,
    enterSwapMs: 12.5,
    exitSwapMs: 18.2,
    swapMs: 18.2,
    blackFrames: 0,
    indoorDrawCalls: 27,
    indoorTriangles: 42000,
    landingError: 0,
    ...overrides,
  })
  const baseReport = {
    errors: [],
    mouths: {
      nw: mkMouth('nw'),
      ne: mkMouth('ne'),
      se: mkMouth('se'),
      sw: mkMouth('sw'),
    },
    crowd: {
      activeCount: 48,
      drawCalls: 6,
      webglDrawCalls: 6,
      avgStepMs: 0.05,
      stepSamples: 120,
    },
    screenshots: ['nw.png', 'ne.png', 'se.png', 'sw.png'],
  }

  assert.equal(evaluateShizijieReport(baseReport).ok, true)

  const slowSwap = evaluateShizijieReport({
    ...baseReport,
    mouths: { ...baseReport.mouths, ne: mkMouth('ne', { swapMs: 431, exitSwapMs: 431 }) },
  })
  assert.equal(slowSwap.ok, false)
  assert.ok(slowSwap.failures.some(f => f.startsWith('MOUTH_SWAP_MS_EXCEEDED:ne')))

  const fakeStepZero = evaluateShizijieReport({
    ...baseReport,
    crowd: { ...baseReport.crowd, avgStepMs: 0, stepSamples: 0 },
  })
  assert.equal(fakeStepZero.ok, false)
  assert.ok(fakeStepZero.failures.some(f => f.startsWith('CROWD_STEP_UNMEASURED')))

  const overBudgetCalls = evaluateShizijieReport({
    ...baseReport,
    mouths: { ...baseReport.mouths, se: mkMouth('se', { indoorDrawCalls: 61 }) },
    crowd: { ...baseReport.crowd, webglDrawCalls: 7 },
  })
  assert.equal(overBudgetCalls.ok, false)
  assert.ok(overBudgetCalls.failures.some(f => f.startsWith('MOUTH_DRAW_CALLS_EXCEEDED:se')))
  assert.ok(overBudgetCalls.failures.some(f => f.startsWith('CROWD_DRAW_CALLS_EXCEEDED')))
})
