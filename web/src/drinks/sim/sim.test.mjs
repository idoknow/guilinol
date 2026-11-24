import test from 'node:test'
import assert from 'node:assert/strict'
import { createDrinksSim, isTerminalOrderStatus, SIM_FAST_FORWARD_TOLERANCE } from './index.ts'

test('无玩家模拟 24 小时：客流有明显峰谷、订单全部有结局、无死锁、无负库存', () => {
  const sim = createDrinksSim({
    seed: 'wangcheng-24h-check',
    now: 0,
    hourOf: t => (t / 3600) % 24,
  })

  // Simulate full 24h in 10-minute slices so we observe inventory & concurrency across the day
  const samples = []
  for (let m = 0; m < 144; m++) {
    const snap = sim.fastForward(600)
    samples.push(snap)
    const invCheck = sim.validateInvariants()
    assert.equal(invCheck.ok, true, `invariant failed at t=${snap.timeSec}: ${invCheck.errors.join('; ')}`)
  }

  const endSnap = samples[samples.length - 1]
  assert.ok(endSnap)
  const m = endSnap.metrics

  // 1. Peak vs valley in hourly arrivals
  const nightArrivals = m.hourlyArrivals.slice(0, 7).reduce((a, b) => a + b, 0)
  const peakHourly = Math.max(...m.hourlyArrivals)
  const afternoonArrivals = m.hourlyArrivals.slice(14, 18).reduce((a, b) => a + b, 0)
  const eveningArrivals = m.hourlyArrivals.slice(19, 22).reduce((a, b) => a + b, 0)
  const morningArrivals = m.hourlyArrivals.slice(8, 11).reduce((a, b) => a + b, 0)

  assert.equal(nightArrivals, 0, `expected closed night valley (00:00-06:59), got ${nightArrivals}`)
  assert.ok(peakHourly >= 45, `expected strong peak hour arrivals >= 45, got ${peakHourly}`)
  assert.ok(afternoonArrivals > morningArrivals, `afternoon (${afternoonArrivals}) should exceed morning (${morningArrivals})`)
  assert.ok(eveningArrivals > morningArrivals, `evening (${eveningArrivals}) should exceed morning (${morningArrivals})`)
  assert.ok(m.peakConcurrentPeople >= 24, `expected big shop peak concurrency >= 24, got ${m.peakConcurrentPeople}`)

  // 2. All orders reach a terminal state (closed at 23:30 drains all orders by 24:00)
  assert.ok(m.totalOrdersCreated > 300, `expected >300 daily orders, got ${m.totalOrdersCreated}`)
  assert.equal(m.activeOrders, 0, `expected 0 active orders at 24:00, got ${m.activeOrders}`)
  for (const ord of endSnap.orders) {
    assert.equal(isTerminalOrderStatus(ord.status), true, `order ${ord.id} stuck in ${ord.status}`)
  }
  assert.ok(m.ordersCompleted > m.totalOrdersCreated * 0.85, `expected high completion rate, got ${m.ordersCompleted}/${m.totalOrdersCreated}`)

  // 3. No deadlocks, no negative inventory, positive revenue & restocks
  assert.equal(m.deadlockRecoveries, 0, 'expected 0 deadlock recoveries')
  assert.ok(m.minObservedInventory >= 0, `negative inventory observed: ${m.minObservedInventory}`)
  assert.ok(m.restockCount > 0, 'expected clerks to patrol & restock bins over 24h')
  assert.ok(m.totalRevenue > 1500, `expected substantial daily revenue, got ${m.totalRevenue}`)
})

test('断料边界：有限后厨库存耗尽时零负库存且订单优雅取消结单', () => {
  const sim = createDrinksSim({
    seed: 'low-stock-boundary',
    now: 0,
    hourOf: () => 15.0,
    autoRestockSupply: false,
    inventoryDefs: [
      { id: 'cup', name: '杯', unit: '个', binCapacity: 10, initialBin: 2, lowThreshold: 1, backroomCapacity: 10, initialBackroom: 1 },
      { id: 'ice', name: '冰', unit: '勺', binCapacity: 20, initialBin: 4, lowThreshold: 2, backroomCapacity: 20, initialBackroom: 2 },
      { id: 'lemon', name: '柠檬', unit: '片', binCapacity: 20, initialBin: 4, lowThreshold: 2, backroomCapacity: 20, initialBackroom: 2 },
      { id: 'syrup', name: '糖浆', unit: '泵', binCapacity: 20, initialBin: 4, lowThreshold: 2, backroomCapacity: 20, initialBackroom: 2 },
    ],
    menu: [
      {
        id: 'ice_lemon_water',
        name: '冰鲜柠檬水',
        category: 'lemonade',
        price: 4,
        prepSec: 1.5,
        stationKind: 'lemon_ice',
        cupColor: '#f6df6e',
        accentColor: '#ffffff',
        ingredients: { cup: 1, ice: 2, lemon: 2, syrup: 1 },
      },
    ],
  })

  for (let i = 0; i < 6; i++) {
    sim.placePlayerOrder({ menuItemId: 'ice_lemon_water', orderKey: `finite_${i}` })
  }
  const snap = sim.fastForward(400)
  assert.equal(sim.validateInvariants().ok, true)
  assert.ok(snap.metrics.minObservedInventory >= 0)
  assert.ok(snap.metrics.ordersCancelled > 0)
  for (const ord of snap.orders) {
    assert.equal(isTerminalOrderStatus(ord.status), true, `order ${ord.id} not terminal: ${ord.status}`)
  }
})

test('重复 orderKey 幂等：只出一单，绝不重复建单或扣库存', () => {
  const sim = createDrinksSim({
    seed: 'idempotent-order-key',
    now: 0,
    hourOf: () => 14.5,
  })

  const invBefore = sim.getSnapshot().inventory
  const r1 = sim.placePlayerOrder({
    menuItemId: 'ice_lemon_water',
    quantity: 2,
    orderKey: 'wx_order_10086',
    customerName: '老板',
  })
  assert.equal(r1.ok, true)
  assert.equal(r1.created, true)
  assert.equal(r1.idempotentReplay, false)
  assert.ok(r1.order)

  const r2 = sim.placePlayerOrder({
    menuItemId: 'ice_lemon_water',
    quantity: 2,
    orderKey: 'wx_order_10086',
    customerName: '老板',
  })
  assert.equal(r2.ok, true)
  assert.equal(r2.created, false)
  assert.equal(r2.idempotentReplay, true)
  assert.equal(r2.code, 'IDEMPOTENT_REPLAY')
  assert.equal(r2.order?.id, r1.order?.id)

  // Different payload with same orderKey still returns original order without creating a second one
  const r3 = sim.placePlayerOrder({
    menuItemId: 'pearl_milk_tea',
    quantity: 5,
    orderKey: 'wx_order_10086',
  })
  assert.equal(r3.created, false)
  assert.equal(r3.order?.id, r1.order?.id)
  assert.equal(r3.order?.itemId, 'ice_lemon_water')

  const snap = sim.getSnapshot()
  const playerOrders = snap.orders.filter(o => o.orderKey === 'wx_order_10086')
  assert.equal(playerOrders.length, 1)

  // Step until player's order is ready and collect it
  for (let i = 0; i < 600; i++) {
    sim.step(0.1)
    if (sim.getOrder('wx_order_10086')?.status === 'ready_for_pickup') break
  }
  const readyOrd = sim.getOrder('wx_order_10086')
  assert.equal(readyOrd?.status, 'ready_for_pickup')

  const collected = sim.collectPlayerOrder('wx_order_10086')
  assert.equal(collected.ok, true)
  assert.equal(collected.order?.status, 'completed')

  // Lemon stock deducted only for 2 units (4 lemons) minus/plus any NPC activity checked via invariant
  const invAfter = sim.getSnapshot().inventory
  assert.ok(invAfter.lemon.binAmount <= invBefore.lemon.binAmount)
  assert.equal(sim.validateInvariants().ok, true)
})

test('快进与逐帧误差在声明阈值内', () => {
  const durationSec = 900 // 15 minutes of busy afternoon rush
  const simFrame = createDrinksSim({
    seed: 'determinism-check',
    now: 0,
    hourOf: t => 15.0 + t / 3600,
  })
  const simFast = createDrinksSim({
    seed: 'determinism-check',
    now: 0,
    hourOf: t => 15.0 + t / 3600,
  })

  // Frame-by-frame at 60 FPS (with mild realistic frame jitter around 1/60s)
  let elapsed = 0
  let frameIdx = 0
  while (elapsed < durationSec) {
    const jitter = ((frameIdx % 5) - 2) * 0.0005
    const dt = Math.min(durationSec - elapsed, 1 / 60 + jitter)
    simFrame.step(dt)
    elapsed += dt
    frameIdx++
  }

  // Fast-forward in one call
  const fastSnap = simFast.fastForward(durationSec)
  const frameSnap = simFrame.getSnapshot()

  const timeDrift = Math.abs(frameSnap.timeSec - fastSnap.timeSec)
  const orderDiffRatio =
    Math.abs(frameSnap.metrics.totalOrdersCreated - fastSnap.metrics.totalOrdersCreated) /
    Math.max(1, fastSnap.metrics.totalOrdersCreated)
  const revDiffRatio =
    Math.abs(frameSnap.metrics.totalRevenue - fastSnap.metrics.totalRevenue) /
    Math.max(1, fastSnap.metrics.totalRevenue)

  assert.ok(
    timeDrift <= SIM_FAST_FORWARD_TOLERANCE.maxTimeDriftSec,
    `timeDrift ${timeDrift} > ${SIM_FAST_FORWARD_TOLERANCE.maxTimeDriftSec}`,
  )
  assert.ok(
    orderDiffRatio <= SIM_FAST_FORWARD_TOLERANCE.maxOrdersDiffRatio,
    `orderDiffRatio ${orderDiffRatio} > ${SIM_FAST_FORWARD_TOLERANCE.maxOrdersDiffRatio}`,
  )
  assert.ok(
    revDiffRatio <= SIM_FAST_FORWARD_TOLERANCE.maxRevenueRelativeDiff,
    `revDiffRatio ${revDiffRatio} > ${SIM_FAST_FORWARD_TOLERANCE.maxRevenueRelativeDiff}`,
  )
  assert.equal(simFrame.validateInvariants().ok, true)
  assert.equal(simFast.validateInvariants().ok, true)
})
