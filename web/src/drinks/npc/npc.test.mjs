import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createDrinksSim } from '../sim/index.ts'
import { createDrinksNpcRenderer } from './index.ts'

test('DrinksNpcRenderer drives 30 NPCs with 0 lights, fast CPU update, and clean dispose', () => {
  const scene = new THREE.Scene()
  const sim = createDrinksSim({
    seed: 'npc-unit-30',
    now: 0,
    hourOf: () => 19.5,
    clerkCount: 5,
    maxCustomers: 26,
  })

  for (let i = 0; i < 120; i++) {
    sim.fastForward(2)
    const snap = sim.getSnapshot()
    if (snap.clerks.length + snap.customers.length >= 30) break
  }

  const renderer = createDrinksNpcRenderer({
    scene,
    sim,
    maxNpcs: 48,
    showBadges: false,
  })

  for (let f = 0; f < 30; f++) {
    sim.step(1 / 60)
    renderer.step(1 / 60, new THREE.Vector3(5, 5, 10))
  }

  const m = renderer.getMetrics()
  assert.ok(m.activeTotal >= 30, `expected >= 30 active NPCs, got ${m.activeTotal}`)
  assert.equal(m.clerksCount, 5)
  assert.ok(m.customersCount >= 25)
  assert.equal(m.visibleCount, m.activeTotal)
  assert.ok(m.lastUpdateMs < 20, `expected fast CPU update < 20ms, got ${m.lastUpdateMs}ms`)

  let lightCount = 0
  renderer.group.traverse(obj => {
    if ('isLight' in obj && obj.isLight) lightCount++
  })
  assert.equal(lightCount, 0)

  renderer.setSkin({ clerkApronColor: '#2563eb' })
  renderer.step(1 / 60)
  renderer.dispose()
  assert.equal(renderer.group.parent, null)
})
