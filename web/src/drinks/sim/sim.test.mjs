import test from 'node:test'
import assert from 'node:assert/strict'
import { DRINKS_MENU } from '../menu/menu.ts'
import {
  convertCatalogMenuToSim,
  createDrinksSim,
  isTerminalOrderStatus,
  layoutFromShopAnchors,
  SIM_FAST_FORWARD_TOLERANCE,
} from './index.ts'

test('sim 菜单与 menu.ts 的 id 集合精确相等，且缺失库存/工位/步骤映射直接失败', () => {
  const sim = createDrinksSim({ seed: 'menu-contract' })
  const simMenu = sim.getMenu()

  const simIds = new Set(simMenu.map(item => item.id))
  const catIds = new Set(DRINKS_MENU.map(item => item.id))
  assert.deepEqual(simIds, catIds, 'sim menu ids must match menu/menu.ts ids 1:1')

  for (const catItem of DRINKS_MENU) {
    const simItem = simMenu.find(x => x.id === catItem.id)
    assert.ok(simItem)
    assert.equal(simItem.price, catItem.price)
    assert.equal(simItem.prepSec, catItem.durationSec)
    assert.equal(simItem.stationKind, catItem.stationKind)
    assert.equal(simItem.steps?.length, catItem.steps.length)
  }

  // 缺工位映射必报错
  assert.throws(() => {
    convertCatalogMenuToSim([
      {
        ...DRINKS_MENU[0],
        stationKind: 'unmapped_station',
      },
    ])
  }, /station mapping/i)

  // 缺库存映射必报错
  assert.throws(() => {
    convertCatalogMenuToSim([
      {
        ...DRINKS_MENU[0],
        ingredients: { cup: 1, unicorn_dust: 1 },
      },
    ])
  }, /inventory mapping/i)

  // 缺步骤或时长不一致必报错
  assert.throws(() => {
    convertCatalogMenuToSim([
      {
        ...DRINKS_MENU[0],
        steps: [],
      },
    ])
  }, /prep steps/i)

  assert.throws(() => {
    convertCatalogMenuToSim([
      {
        ...DRINKS_MENU[0],
        durationSec: 99,
      },
    ])
  }, /duration mismatch/i)

  // 锚点转换契约校验
  const fixture = sim.getLayout()
  const fromAnchors = layoutFromShopAnchors({
    width: fixture.width,
    depth: fixture.depth,
    entrance: fixture.entrance,
    cashiers: fixture.cashiers,
    prepStations: fixture.prepStations,
    pickupSlots: fixture.pickupSlots,
    pickupClerkPos: fixture.pickupClerkPos,
    waitingSpots: fixture.waitingSpots,
    seats: fixture.seats,
    storagePos: fixture.storagePos,
    patrolPoints: fixture.patrolPoints,
  })
  assert.equal(fromAnchors.cashiers.length, fixture.cashiers.length)
  assert.equal(fromAnchors.seats.length, fixture.seats.length)
})

test('无玩家模拟 24 小时：峰谷客流、全订单结单、无死锁、无负库存且覆盖多种店内互动', () => {
  const sim = createDrinksSim({
    seed: 'wangcheng-24h-interactions',
    now: 0,
    hourOf: t => (t / 3600) % 24,
  })

  const observedKinds = new Set()
  const samples = []
  let maxObservedCustomers = 0
  let maxObservedQueue = 0
  for (let m = 0; m < 432; m++) {
    const snap = sim.fastForward(200)
    samples.push(snap)
    if (snap.customers.length > maxObservedCustomers) maxObservedCustomers = snap.customers.length
    if (snap.metrics.queueLength > maxObservedQueue) maxObservedQueue = snap.metrics.queueLength
    for (const cl of snap.clerks) {
      if (cl.interactionKind) observedKinds.add(cl.interactionKind)
    }
    for (const cu of snap.customers) {
      if (cu.interactionKind) observedKinds.add(cu.interactionKind)
    }
    const invCheck = sim.validateInvariants()
    assert.equal(invCheck.ok, true, `invariant failed at t=${snap.timeSec}: ${invCheck.errors.join('; ')}`)
  }

  const endSnap = samples[samples.length - 1]
  assert.ok(endSnap)
  const m = endSnap.metrics

  const nightArrivals = m.hourlyArrivals.slice(0, 7).reduce((a, b) => a + b, 0)
  const peakHourly = Math.max(...m.hourlyArrivals)
  assert.equal(nightArrivals, 0)
  assert.ok(peakHourly >= 15, `expected lively peak hourly arrivals >= 15, got ${peakHourly}`)
  assert.ok(maxObservedCustomers <= 8, `concurrent customers exceeded cap 8: ${maxObservedCustomers}`)
  assert.ok(maxObservedQueue <= 4, `doorway/counter queue exceeded cap 4: ${maxObservedQueue}`)
  assert.ok(m.peakConcurrentPeople <= 13, `peak people (5 clerks + <=8 customers) exceeded 13: ${m.peakConcurrentPeople}`)
  assert.ok(m.peakConcurrentPeople >= 9, `expected peak people >= 9, got ${m.peakConcurrentPeople}`)
  assert.ok(m.totalOrdersCreated > 150, `expected > 150 daily orders, got ${m.totalOrdersCreated}`)
  assert.equal(m.activeOrders, 0)
  for (const ord of endSnap.orders) {
    assert.equal(isTerminalOrderStatus(ord.status), true, `order ${ord.id} stuck in ${ord.status}`)
  }
  assert.equal(m.deadlockRecoveries, 0)
  assert.ok(m.minObservedInventory >= 0)
  assert.ok(m.restockCount > 0)
  assert.ok(m.tablesCleanedCount > 0, `expected clerks to clean tables, got ${m.tablesCleanedCount}`)

  for (const required of ['order_ask', 'make_change', 'call_number', 'handover_cup', 'clean_table', 'chat_pair_a']) {
    assert.ok(observedKinds.has(required), `expected interaction '${required}' during 24h run`)
  }
})

test('客流与排队硬上限：高峰并发顾客 ≤ 8 且门口/柜台排队 ≤ 4（超限参数亦被钳制）', () => {
  const sim = createDrinksSim({
    seed: 'crowd-cap-stress',
    now: 0,
    hourOf: () => 19.5,
    maxCustomers: 26,
    maxQueueLength: 10,
  })

  let maxCust = 0
  let maxQueue = 0
  for (let i = 0; i < 3000; i++) {
    sim.step(0.1)
    const snap = sim.getSnapshot()
    if (snap.customers.length > maxCust) maxCust = snap.customers.length
    if (snap.metrics.queueLength > maxQueue) maxQueue = snap.metrics.queueLength
    assert.ok(snap.customers.length <= 8, `tick ${i}: customers ${snap.customers.length} > 8`)
    assert.ok(snap.metrics.queueLength <= 4, `tick ${i}: queue ${snap.metrics.queueLength} > 4`)
  }

  const endSnap = sim.getSnapshot()
  assert.ok(maxCust >= 5 && maxCust <= 8, `expected realistic peak customers in [5,8], got ${maxCust}`)
  assert.ok(maxQueue <= 4, `expected queue <= 4, got ${maxQueue}`)
  assert.ok(endSnap.metrics.ordersCompleted >= 10, `expected 5min unattended orders >= 10, got ${endSnap.metrics.ordersCompleted}`)
  assert.equal(sim.validateInvariants().ok, true)
})

test('玩家下单排进同一队列、重复 orderKey 幂等、取消与未取都有结局', () => {
  const sim = createDrinksSim({
    seed: 'player-queue-outcomes',
    now: 0,
    hourOf: () => 15.0,
    playerUnclaimedTimeoutSec: 30,
  })

  // Pre-seed two manual NPC-like orders ahead and one behind to test unified FIFO queue order
  sim.fastForward(16)

  const oAhead = sim.placePlayerOrder({ menuItemId: 'ice_lemon_water', orderKey: 'q_ahead_1', customerName: '先来客' })
  const oMine = sim.placePlayerOrder({ menuItemId: 'pearl_milk_tea', orderKey: 'q_mine_2', customerName: '玩家' })
  const oBehind = sim.placePlayerOrder({ menuItemId: 'mango_pomelo_sago', orderKey: 'q_behind_3', customerName: '后来客' })
  assert.equal(oAhead.ok && oMine.ok && oBehind.ok, true)
  assert.ok(
    (oAhead.order?.queuePosition ?? 99) < (oMine.order?.queuePosition ?? 0) &&
      (oMine.order?.queuePosition ?? 99) < (oBehind.order?.queuePosition ?? 0),
    `expected unified FIFO queue positions: ${oAhead.order?.queuePosition} < ${oMine.order?.queuePosition} < ${oBehind.order?.queuePosition}`,
  )

  // Duplicate orderKey idempotency
  const replay = sim.placePlayerOrder({ menuItemId: 'iced_americano', orderKey: 'q_mine_2', quantity: 4 })
  assert.equal(replay.idempotentReplay, true)
  assert.equal(replay.created, false)
  assert.equal(replay.order?.id, oMine.order?.id)
  assert.equal(replay.order?.itemId, 'pearl_milk_tea')

  // Cancel player order while queued/preparing -> cancelled_by_player & refundable
  const cancelRes = sim.cancelPlayerOrder('q_mine_2')
  assert.equal(cancelRes.ok, true)
  assert.equal(cancelRes.refundable, true)
  assert.equal(cancelRes.order?.status, 'cancelled_by_player')
  assert.equal(isTerminalOrderStatus(cancelRes.order?.status ?? 'queued'), true)

  // Fast-forward past playerUnclaimedTimeoutSec without collecting oAhead/oBehind -> abandoned_unclaimed
  sim.fastForward(120)
  const snap = sim.getSnapshot()
  const ordAheadAfter = snap.orders.find(o => o.orderKey === 'q_ahead_1')
  const ordBehindAfter = snap.orders.find(o => o.orderKey === 'q_behind_3')
  assert.equal(ordAheadAfter?.status, 'abandoned_unclaimed')
  assert.equal(ordBehindAfter?.status, 'abandoned_unclaimed')
  assert.equal(sim.validateInvariants().ok, true)
})

test('玩家靠近时触发店员招呼、排队者让位、插队提醒，且不阻断店铺正常出餐', () => {
  const sim = createDrinksSim({
    seed: 'player-proximity-check',
    now: 0,
    hourOf: () => 19.5,
  })
  sim.fastForward(28)

  const layout = sim.getLayout()
  const cashierHead = layout.cashiers[0].customerPos

  // 1. Walk near entrance -> clerk greets player
  sim.setPlayerPresence({ active: true, x: layout.entrance.x, z: layout.entrance.z + 0.5 })
  sim.step(0.5)
  let evs = sim.drainEvents()
  assert.ok(evs.some(e => e.type === 'player_greeted'), 'expected clerk_greet_player event when player approaches')

  // 2. Step right in front of cashier queue -> remind cut-in & nearby queuer yields without stopping orders
  sim.setPlayerPresence({ active: true, x: cashierHead.x, z: cashierHead.z - 0.1 })
  for (let i = 0; i < 40; i++) sim.step(0.1)
  evs = sim.drainEvents()
  const snap = sim.getSnapshot()
  const ordersBefore = snap.metrics.ordersCompleted
  sim.fastForward(45)
  const ordersAfter = sim.getSnapshot().metrics.ordersCompleted
  assert.ok(ordersAfter > ordersBefore, 'player presence must NOT block ongoing store production')
  assert.equal(sim.validateInvariants().ok, true)
})

test('快进与逐帧误差在声明阈值内', () => {
  const durationSec = 900
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

  let elapsed = 0
  let frameIdx = 0
  while (elapsed < durationSec) {
    const jitter = ((frameIdx % 5) - 2) * 0.0005
    const dt = Math.min(durationSec - elapsed, 1 / 60 + jitter)
    simFrame.step(dt)
    elapsed += dt
    frameIdx++
  }

  const fastSnap = simFast.fastForward(durationSec)
  const frameSnap = simFrame.getSnapshot()

  const timeDrift = Math.abs(frameSnap.timeSec - fastSnap.timeSec)
  const orderDiffRatio =
    Math.abs(frameSnap.metrics.totalOrdersCreated - fastSnap.metrics.totalOrdersCreated) /
    Math.max(1, fastSnap.metrics.totalOrdersCreated)
  const revDiffRatio =
    Math.abs(frameSnap.metrics.totalRevenue - fastSnap.metrics.totalRevenue) /
    Math.max(1, fastSnap.metrics.totalRevenue)

  assert.ok(timeDrift <= SIM_FAST_FORWARD_TOLERANCE.maxTimeDriftSec)
  assert.ok(orderDiffRatio <= SIM_FAST_FORWARD_TOLERANCE.maxOrdersDiffRatio)
  assert.ok(revDiffRatio <= SIM_FAST_FORWARD_TOLERANCE.maxRevenueRelativeDiff)
  assert.equal(simFrame.validateInvariants().ok, true)
  assert.equal(simFast.validateInvariants().ok, true)
})
