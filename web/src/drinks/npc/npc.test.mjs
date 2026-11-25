import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { DRINKS_SHOP_ANCHORS } from '../shop/blueprint.ts'
import { shopLocalToWorld, SITE, worldToShopLocal } from '../site.ts'
import {
  createDrinksSim,
  isInDoorwayClearance,
  isInTactileStripBand,
} from '../sim/index.ts'
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

test('DrinksNpcRenderer 适配降人流上限（并发顾客 ≤ 8、排队 ≤ 4）、短气泡封顶、0 光源且可正常释放', () => {
  const scene = new THREE.Scene()
  const sim = createDrinksSim({
    seed: 'npc-unit-crowd-cap',
    now: 0,
    hourOf: () => 19.5,
    clerkCount: 5,
    maxCustomers: 8,
  })

  let maxObservedCustomers = 0
  let maxObservedQueue = 0
  for (let i = 0; i < 120; i++) {
    sim.fastForward(2)
    const snap = sim.getSnapshot()
    if (snap.customers.length > maxObservedCustomers) maxObservedCustomers = snap.customers.length
    if (snap.metrics.queueLength > maxObservedQueue) maxObservedQueue = snap.metrics.queueLength
  }

  const renderer = createDrinksNpcRenderer({
    scene,
    sim,
    maxNpcs: 20,
    maxVisibleBadges: 4,
    showBadges: false,
  })

  for (let f = 0; f < 30; f++) {
    sim.step(1 / 60)
    renderer.step(1 / 60, new THREE.Vector3(3, 5, 11))
  }

  const m = renderer.getMetrics()
  assert.equal(m.clerksCount, 5)
  assert.ok(maxObservedCustomers >= 5 && maxObservedCustomers <= 8, `expected peak customers in [5,8], got ${maxObservedCustomers}`)
  assert.ok(maxObservedQueue <= 4, `expected queue <= 4, got ${maxObservedQueue}`)
  assert.ok(m.customersCount <= 8, `expected rendered customers <= 8, got ${m.customersCount}`)
  assert.ok(m.activeTotal >= 8 && m.activeTotal <= 13, `expected activeTotal in [8,13], got ${m.activeTotal}`)
  assert.equal(m.visibleCount, m.activeTotal)
  assert.ok(m.visibleBadgeCount <= 4)
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

test('王城实景坐标系下渲染校验：排队顾客世界矩阵朝向柜台、门洞与盲道零遮挡、员工模式照常出单', () => {
  const scene = new THREE.Scene()
  const sim = createDrinksSim({
    seed: 'npc-wangcheng-facing-clearance',
    anchors: DRINKS_SHOP_ANCHORS,
    now: 0,
    hourOf: () => 19.5,
    clerkCount: 5,
    maxCustomers: 8,
  })
  const layout = sim.getLayout()

  const renderer = createDrinksNpcRenderer({
    scene,
    sim,
    worldOrigin: [SITE.worldX, SITE.fallbackGroundY, SITE.worldZ],
    worldYaw: SITE.worldYaw,
    sampleGroundY: () => SITE.fallbackGroundY,
    maxNpcs: 20,
    maxVisibleBadges: 4,
    showBadges: false,
  })

  // 开启员工模式并站于前吧台后侧，验证渲染位姿不受影响且顾客持续下单
  sim.setPlayerStaffMode(true)
  sim.setPlayerPresence({ active: true, x: -1.45, z: -1.05, yaw: 0, onDuty: true })

  const rootInstMesh = renderer.group.children.find(obj => obj instanceof THREE.InstancedMesh)
  assert.ok(rootInstMesh, 'expected InstancedMesh on DrinksNpcRenderer.group')

  const mat = new THREE.Matrix4()
  const fwd = new THREE.Vector3()
  let verifiedWorldQueueFaces = 0

  for (let tick = 0; tick < 600; tick++) {
    sim.step(0.2)
    // 连推数帧让渲染平滑插值收敛到仿真目标位姿
    renderer.step(0.25, new THREE.Vector3(SITE.worldX, SITE.fallbackGroundY + 3, SITE.worldZ + 8))
    renderer.step(0.25, new THREE.Vector3(SITE.worldX, SITE.fallbackGroundY + 3, SITE.worldZ + 8))

    const snap = sim.getSnapshot()
    assert.ok(snap.metrics.queueLength <= 4)

    for (let ci = 0; ci < snap.customers.length; ci++) {
      const cu = snap.customers[ci]
      const instIdx = snap.clerks.length + ci
      rootInstMesh.getMatrixAt(instIdx, mat)
      const wx = mat.elements[12]
      const wz = mat.elements[14]
      const local = worldToShopLocal(SITE, wx, wz)

      assert.equal(
        isInTactileStripBand(local.z),
        false,
        `rendered customer ${cu.id} intruded tactile strip at local z=${local.z.toFixed(2)}`,
      )

      if (cu.speed === 0 && cu.phase !== 'entering' && cu.phase !== 'leaving') {
        assert.equal(
          isInDoorwayClearance(local.x, local.z, layout.entrance),
          false,
          `rendered stationary customer ${cu.id} (${cu.phase}) blocked doorway at (${local.x.toFixed(2)}, ${local.z.toFixed(2)})`,
        )
      }

      if (
        (cu.phase === 'queuing' || cu.phase === 'ordering') &&
        cu.speed === 0 &&
        cu.interactionKind !== 'remind_cut_in' &&
        cu.interactionKind !== 'queue_yield_player'
      ) {
        const lane = layout.cashiers[cu.cashierIndex] ?? layout.cashiers[0]
        // InstancedMesh 局部 +Z 即人物正前方，取旋转后世界朝向与所排收银台世界方向点积
        fwd.set(0, 0, 1).transformDirection(mat)
        const fLen = Math.hypot(fwd.x, fwd.z)
        const counterWorld = shopLocalToWorld(SITE, lane.clerkPos.x, lane.clerkPos.z)
        const toCx = counterWorld.x - wx
        const toCz = counterWorld.z - wz
        const cLen = Math.hypot(toCx, toCz)
        const dot = (fwd.x * toCx + fwd.z * toCz) / Math.max(1e-6, fLen * cLen)
        assert.ok(
          dot >= 0.9,
          `rendered queuing customer ${cu.id} world mesh not facing counter (dot=${dot.toFixed(3)})`,
        )
        verifiedWorldQueueFaces++
      }
    }
  }

  const endSnap = sim.getSnapshot()
  assert.ok(verifiedWorldQueueFaces >= 15, `expected >= 15 world-space counter-facing checks, got ${verifiedWorldQueueFaces}`)
  assert.ok(endSnap.metrics.ordersCompleted >= 5, `expected continuous orders during staff mode, got ${endSnap.metrics.ordersCompleted}`)
  assert.equal(sim.validateInvariants().ok, true)

  renderer.dispose()
  assert.equal(renderer.group.parent, null)
})
