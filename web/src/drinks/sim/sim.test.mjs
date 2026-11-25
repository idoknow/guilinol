import test from 'node:test'
import assert from 'node:assert/strict'
import { DRINKS_MENU } from '../menu/menu.ts'
import { DRINKS_SHOP_ANCHORS } from '../shop/blueprint.ts'
import { DRINKS_SITE_CANDIDATES, SITE } from '../site.ts'
import { DrinksStaffSession } from '../staff/workflow.ts'
import {
  buildDrinksDistrictCrowdThinning,
  convertCatalogMenuToSim,
  createDrinksSim,
  DRINKS_DOORWAY_CLEARANCE,
  DRINKS_TACTILE_STRIP_BAND,
  isInDoorwayClearance,
  isInTactileStripBand,
  isTerminalOrderStatus,
  layoutFromShopAnchors,
  MAX_DOORWAY_QUEUE,
  MAX_OUTDOOR_CUSTOMERS,
  MAX_PATIO_SEATED,
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

test('店外按片区降密度 + 门洞与盲道永不堵塞（兼容实景 blueprint 锚点）', () => {
  // 1. 片区降密配置校验：王城商厦内圈覆盖门洞+外摆+盲道，正阳路片区独立配额
  const wangchengZone = buildDrinksDistrictCrowdThinning(DRINKS_SITE_CANDIDATES.wangcheng_mall)
  const zhengyangZone = buildDrinksDistrictCrowdThinning(DRINKS_SITE_CANDIDATES.zhengyang_208)
  assert.equal(wangchengZone.districtId, 'wangcheng_mall')
  assert.ok(wangchengZone.innerRadius >= 9.0, `wangcheng innerRadius must clear doorway+patio+tactile strip, got ${wangchengZone.innerRadius}`)
  assert.ok(wangchengZone.outerRadius >= 20 && wangchengZone.maxInOuter <= 2)
  assert.equal(zhengyangZone.districtId, 'zhengyang_208')
  assert.ok(zhengyangZone.innerRadius >= 8.0 && zhengyangZone.maxInOuter <= 3)

  // 2. 使用实景 DRINKS_SHOP_ANCHORS 构造模拟：menuBoardSlots / waitingSpots 应自动避开门洞净空走廊
  const sim = createDrinksSim({
    seed: 'doorway-tactile-clearance',
    anchors: DRINKS_SHOP_ANCHORS,
    now: 0,
    hourOf: () => 19.5,
  })
  const layout = sim.getLayout()
  for (const slot of [...layout.menuBoardSlots, ...layout.waitingSpots]) {
    assert.equal(
      isInDoorwayClearance(slot.x, slot.z, layout.entrance),
      false,
      `layout spot (${slot.x}, ${slot.z}) overlaps 2.8m doorway clearance`,
    )
    assert.equal(isInTactileStripBand(slot.z), false, `layout spot z=${slot.z} overlaps tactile strip`)
  }
  assert.ok(layout.approachLeft.z <= DRINKS_TACTILE_STRIP_BAND.safeMaxZ)
  assert.ok(layout.approachRight.z <= DRINKS_TACTILE_STRIP_BAND.safeMaxZ)

  // 3. 晚高峰连续运行 5 分钟（3000 步），逐帧核查门洞、盲道与店外人数上限
  let maxOutdoor = 0
  let maxPatioSeated = 0
  for (let i = 0; i < 3000; i++) {
    sim.step(0.1)
    const snap = sim.getSnapshot()
    let outdoorCount = 0
    let patioSeated = 0
    for (const cl of snap.clerks) {
      assert.equal(isInTactileStripBand(cl.z), false, `tick ${i}: clerk ${cl.id} stepped onto tactile strip z=${cl.z}`)
    }
    for (const cu of snap.customers) {
      assert.equal(isInTactileStripBand(cu.z), false, `tick ${i}: customer ${cu.id} stepped onto tactile strip z=${cu.z}`)
      assert.ok(cu.z <= DRINKS_TACTILE_STRIP_BAND.safeMaxZ + 1e-6, `tick ${i}: customer ${cu.id} exceeded safeMaxZ (${cu.z})`)
      if (cu.z > layout.entrance.z + 0.1) outdoorCount++
      if (cu.speed === 0 && cu.phase !== 'entering' && cu.phase !== 'leaving') {
        assert.equal(
          isInDoorwayClearance(cu.x, cu.z, layout.entrance),
          false,
          `tick ${i}: stationary customer ${cu.id} (${cu.phase}) blocked doorway at (${cu.x.toFixed(2)}, ${cu.z.toFixed(2)})`,
        )
      }
    }
    for (const s of snap.seats) {
      if (s.zone === 'patio' && (s.state === 'occupied' || s.state === 'reserved')) patioSeated++
    }
    if (outdoorCount > maxOutdoor) maxOutdoor = outdoorCount
    if (patioSeated > maxPatioSeated) maxPatioSeated = patioSeated
    if (i % 50 === 0) {
      const inv = sim.validateInvariants()
      assert.equal(inv.ok, true, `tick ${i} invariant failed: ${inv.errors.join('; ')}`)
    }
  }
  assert.ok(maxPatioSeated <= MAX_PATIO_SEATED, `patio seated ${maxPatioSeated} exceeded ${MAX_PATIO_SEATED}`)
  assert.ok(maxOutdoor <= MAX_OUTDOOR_CUSTOMERS + 2, `outdoor plaza crowd too dense: ${maxOutdoor}`)
  assert.ok(sim.getSnapshot().metrics.ordersCompleted >= 12)
})

test('排队 ≤ 4 人且全程朝向柜台（含单收银队列折弯与路过干扰后自动回正）', () => {
  // 单收银高负载布局：即使 4 人挤向同一收银台也不越过门洞净空线且全部朝向柜台
  const baseSim = createDrinksSim({ seed: 'single-lane-base' })
  const baseLayout = baseSim.getLayout()
  const sim = createDrinksSim({
    seed: 'queue-facing-counter',
    now: 0,
    hourOf: () => 19.5,
    layout: {
      cashiers: [baseLayout.cashiers[1]], // 靠门洞右侧收银台（最严格测试门洞避让）
    },
    maxQueueLength: 8, // 应被硬钳制为 4
  })
  const layout = sim.getLayout()
  const cashier = layout.cashiers[0]

  let observedQueueSamples = 0
  let maxQueue = 0
  for (let i = 0; i < 3000; i++) {
    // 中途模拟普通顾客模式玩家擦肩而过触发让位，再离开验证排队者回正朝向柜台
    if (i >= 900 && i < 930) {
      sim.setPlayerPresence({ active: true, x: cashier.customerPos.x + 0.35, z: cashier.customerPos.z + 0.45 })
    } else if (i === 930) {
      sim.setPlayerPresence(null)
    }

    sim.step(0.1)
    const snap = sim.getSnapshot()
    if (snap.metrics.queueLength > maxQueue) maxQueue = snap.metrics.queueLength
    assert.ok(snap.metrics.queueLength <= MAX_DOORWAY_QUEUE, `tick ${i}: queue ${snap.metrics.queueLength} > 4`)

    for (const cu of snap.customers) {
      if ((cu.phase === 'queuing' || cu.phase === 'ordering') && cu.speed === 0) {
        assert.equal(
          isInDoorwayClearance(cu.x, cu.z, layout.entrance),
          false,
          `tick ${i}: queuing customer ${cu.id} entered doorway clearance (${cu.x.toFixed(2)}, ${cu.z.toFixed(2)})`,
        )
        assert.ok(
          cu.z <= layout.entrance.z - DRINKS_DOORWAY_CLEARANCE.innerDepthM + 0.05,
          `tick ${i}: queuer z=${cu.z.toFixed(2)} encroached doorway buffer`,
        )
        if (cu.interactionKind !== 'remind_cut_in' && cu.interactionKind !== 'queue_yield_player') {
          const dx = cashier.clerkPos.x - cu.x
          const dz = cashier.clerkPos.z - cu.z
          const len = Math.hypot(dx, dz)
          const dot = (Math.sin(cu.yaw) * dx + Math.cos(cu.yaw) * dz) / Math.max(1e-6, len)
          assert.ok(dot >= 0.94, `tick ${i}: queuing customer ${cu.id} not facing counter (dot=${dot.toFixed(3)})`)
          observedQueueSamples++
        }
      }
    }
  }

  assert.ok(maxQueue >= 1 && maxQueue <= 4, `expected realistic queue in [1,4], got ${maxQueue}`)
  assert.ok(observedQueueSamples >= 50, `expected >= 50 stationary counter-facing queue samples, got ${observedQueueSamples}`)
  assert.equal(sim.validateInvariants().ok, true)
})

test('玩家当员工时顾客照常下单（联调 DrinksStaffSession 换装做杯，零插队误报且持续出单）', () => {
  const sim = createDrinksSim({
    seed: 'staff-mode-normal-orders',
    anchors: DRINKS_SHOP_ANCHORS,
    now: 0,
    hourOf: () => 19.5,
  })
  const staff = new DrinksStaffSession({ sim })

  // 1. 玩家在门口应聘上岗进入员工模式
  const recruit = staff.anchors.recruitStandee
  staff.updatePlayerLocalPos(recruit.x, recruit.z + 0.5, Math.PI)
  assert.equal(staff.applyForJob(), true)
  assert.equal(staff.getSnapshot().onDuty, true)
  sim.setPlayerStaffMode(true)
  assert.equal(sim.isPlayerStaffMode(), true)
  assert.equal(sim.getSnapshot().playerOnDuty, true)

  // 2. 员工玩家依次站在收银点单台、制冰台、封口台、出杯叫号台做完 1 杯并持续在岗 5 分钟
  const stations = [
    staff.anchors.orderDesk,
    staff.anchors.prepStations[0],
    staff.anchors.sealStation,
    staff.anchors.pickupCounter,
  ]

  let falseCutInEvents = 0
  let falseGreetEvents = 0
  let staffTicketCompleted = false

  for (let i = 0; i < 3000; i++) {
    const st = stations[Math.floor(i / 250) % stations.length]
    staff.updatePlayerLocalPos(st.x, st.z, st.yaw)
    sim.setPlayerPresence({ active: true, x: st.x, z: st.z, yaw: st.yaw, onDuty: true })

    // 完成 1 轮完整员工接单 -> 加料 -> 封口 -> 出杯叫号
    if (!staffTicketCompleted && i === 120) {
      staff.updatePlayerLocalPos(staff.anchors.orderDesk.x, staff.anchors.orderDesk.z, 0)
      assert.ok(staff.acceptNextOrder())
    }
    if (!staffTicketCompleted && i > 120) {
      const sSnap = staff.getSnapshot()
      if (sSnap.phase === 'shake_cup' || sSnap.phase === 'add_toppings' || sSnap.phase === 'seal_cup') {
        if (sSnap.targetZone) staff.updatePlayerLocalPos(sSnap.targetZone.x, sSnap.targetZone.z, 0)
        staff.holdWork(0.1)
      } else if (sSnap.phase === 'call_pickup') {
        staff.updatePlayerLocalPos(staff.anchors.pickupCounter.x, staff.anchors.pickupCounter.z, 0)
        assert.equal(staff.completeCallPickup(), true)
        staffTicketCompleted = true
      }
    }

    staff.step(0.1)
    sim.step(0.1)

    for (const ev of sim.drainEvents()) {
      if (ev.type === 'player_cut_in_reminded') falseCutInEvents++
      if (ev.type === 'player_greeted') falseGreetEvents++
    }
  }

  const endSnap = sim.getSnapshot()
  assert.equal(staffTicketCompleted, true, 'player staff should complete a full cup during shift')
  assert.equal(staff.getSnapshot().cupsServed, 1)
  assert.equal(falseCutInEvents, 0, 'on-duty player behind counter must never trigger cut-in reminders')
  assert.equal(falseGreetEvents, 0, 'on-duty player must not be greeted as a newly arrived customer')
  assert.ok(
    endSnap.metrics.totalOrdersCreated >= 14,
    `customers must keep ordering normally during staff shift, got totalOrdersCreated=${endSnap.metrics.totalOrdersCreated}`,
  )
  assert.ok(
    endSnap.metrics.ordersCompleted >= 12,
    `customers must keep completing orders during staff shift, got ordersCompleted=${endSnap.metrics.ordersCompleted}`,
  )
  assert.equal(endSnap.metrics.deadlockRecoveries, 0)
  assert.equal(sim.validateInvariants().ok, true)

  // 3. 下班后恢复顾客模式
  assert.equal(staff.resignJob(), true)
  sim.setPlayerStaffMode(false)
  sim.setPlayerPresence({ active: true, x: SITE.id ? 0.2 : 0.2, z: 3.1, onDuty: false })
  assert.equal(sim.isPlayerStaffMode(), false)
  sim.step(0.5)
  assert.ok(sim.drainEvents().some(e => e.type === 'player_greeted'), 'off-duty customer mode should restore greeting')
})
