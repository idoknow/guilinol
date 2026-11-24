import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createDrinksSim } from '../sim/index.ts'
import {
  createDrinksNpcRenderer,
  DEFAULT_DRINKS_NPC_SKIN,
  DRINKS_DIALOGUE_COPY,
  resolveInteractionBadge,
} from './index.ts'

test('短气泡文案表与 skin 解耦：全互动类型皆有<=8字短台词且随 skin 生效', () => {
  const skinA = { ...DEFAULT_DRINKS_NPC_SKIN, shopBrandName: '王城冰茶铺', greetingLine: '欢迎光临！' }
  const skinB = {
    ...DEFAULT_DRINKS_NPC_SKIN,
    shopBrandName: '漓江鲜饮',
    greetingLine: '漓江鲜饮欢迎',
    dialogueOverrides: {
      call_number: ['请取{var}'],
    },
  }

  for (const kind of Object.keys(DRINKS_DIALOGUE_COPY)) {
    const b = resolveInteractionBadge(kind, skinA, 'A012', 0)
    assert.ok(b, `missing badge for ${kind}`)
    assert.ok(b.text.length >= 2 && b.text.length <= 8, `badge '${b.text}' for ${kind} must be short (<=8 chars)`)
  }

  const greetB = resolveInteractionBadge('clerk_greet_player', skinB, null, 0)
  assert.equal(greetB?.text, '漓江鲜饮欢迎')
  const callB = resolveInteractionBadge('call_number', skinB, 'P009', 0)
  assert.equal(callB?.text, '请取P009')
})

test('DrinksNpcRenderer 驱动 30 人同屏、短气泡数量封顶、0 光源且可正常释放', () => {
  const scene = new THREE.Scene()
  const sim = createDrinksSim({
    seed: 'npc-unit-30-interactions',
    now: 0,
    hourOf: () => 19.5,
    clerkCount: 5,
    maxCustomers: 26,
  })

  for (let i = 0; i < 140; i++) {
    sim.fastForward(2)
    const snap = sim.getSnapshot()
    if (snap.clerks.length + snap.customers.length >= 30) break
  }

  const renderer = createDrinksNpcRenderer({
    scene,
    sim,
    maxNpcs: 48,
    maxVisibleBadges: 6,
    showBadges: false,
  })

  for (let f = 0; f < 30; f++) {
    sim.step(1 / 60)
    renderer.step(1 / 60, new THREE.Vector3(3, 5, 11))
  }

  const m = renderer.getMetrics()
  assert.ok(m.activeTotal >= 30, `expected >= 30 active NPCs, got ${m.activeTotal}`)
  assert.equal(m.clerksCount, 5)
  assert.ok(m.customersCount >= 25)
  assert.equal(m.visibleCount, m.activeTotal)
  assert.ok(m.visibleBadgeCount <= 6)
  assert.ok(m.lastUpdateMs < 20)

  let lightCount = 0
  renderer.group.traverse(obj => {
    if ('isLight' in obj && obj.isLight) lightCount++
  })
  assert.equal(lightCount, 0)

  renderer.setSkin({ clerkApronColor: '#2563eb', greetingLine: '换肤招呼' })
  renderer.step(1 / 60)
  renderer.dispose()
  assert.equal(renderer.group.parent, null)
})
