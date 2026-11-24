import { createDefaultDrinksLayout, DEFAULT_DRINKS_MENU, DEFAULT_INVENTORY_DEFS } from './menu.ts'
import { createSeededRng } from './prng.ts'
import { getDrinksTrafficProfile, normalizeHour } from './traffic.ts'
import type {
  ClerkRole,
  ClerkSnapshot,
  ClerkState,
  CollectPlayerOrderResult,
  CreateDrinksSimOptions,
  CustomerPhase,
  CustomerRoleKind,
  CustomerSnapshot,
  DirectedSpot,
  DrinkMenuItem,
  DrinkShopLayout,
  DrinksSim,
  DrinksSimEvent,
  DrinksSimSnapshot,
  InventoryBinState,
  InventoryItemDef,
  InvariantCheckResult,
  OrderSnapshot,
  OrderStatus,
  PlacePlayerOrderRequest,
  PlacePlayerOrderResult,
  Point2D,
} from './types.ts'

export const SIM_FIXED_DT = 0.1
export const SIM_FAST_FORWARD_TOLERANCE = {
  maxTimeDriftSec: SIM_FIXED_DT + 1e-6,
  maxRevenueRelativeDiff: 0.02,
  maxOrdersDiffRatio: 0.02,
} as const

interface InternalClerk {
  id: string
  name: string
  role: ClerkRole
  state: ClerkState
  x: number
  z: number
  yaw: number
  speed: number
  targetX: number
  targetZ: number
  targetYaw: number
  moveSpeed: number
  homePos: DirectedSpot
  actionTimer: number
  actionDuration: number
  taskElapsedSec: number
  activeCustomerId: string | null
  activeOrderId: string | null
  targetStationId: string | null
  targetStationIndex: number
  targetCashierIndex: number
  targetBinId: string | null
  restockStage: 'to_storage' | 'picking' | 'to_bar' | 'refilling'
  holdingCup: boolean
  holdingCupColor: string | null
  holdingCrate: boolean
  patrolIndex: number
  actionLabel: string
  pendingAfterWalk: ClerkState | null
}

interface InternalCustomer {
  id: string
  name: string
  roleKind: CustomerRoleKind
  phase: CustomerPhase
  x: number
  z: number
  yaw: number
  speed: number
  moveSpeed: number
  waypoints: Point2D[]
  finalYaw: number | null
  stateTimer: number
  stateDuration: number
  patienceSec: number
  patienceMaxSec: number
  cashierIndex: number
  queueSlot: number
  seatId: string | null
  waitingSpotIndex: number
  waitingOrderId: string | null
  desiredItemId: string | null
  holdingCup: boolean
  cupDrinkId: string | null
  cupColor: string | null
  sipsLeft: number
  sipProgress: number
  wantsSeat: boolean
  angry: boolean
  leaveSide: -1 | 1
  shirtColor: string
  pantsColor: string
  skinColor: string
  hairColor: string
  variant: number
}

interface InternalOrder {
  id: string
  ticketNo: string
  orderKey: string
  source: 'npc' | 'player'
  customerId: string
  customerName: string
  item: DrinkMenuItem
  quantity: number
  unitPrice: number
  totalPrice: number
  status: OrderStatus
  stationId: string | null
  clerkId: string | null
  pickupSlotIndex: number
  prepElapsedSec: number
  prepDurationSec: number
  createdAtSec: number
  prepStartedAtSec: number | null
  readyAtSec: number | null
  finishedAtSec: number | null
  ingredientsDeducted: boolean
}

const CLERK_PROFILES: readonly { id: string; name: string; role: ClerkRole }[] = [
  { id: 'clerk_1', name: '小雪', role: 'cashier' },
  { id: 'clerk_2', name: '阿柠', role: 'maker' },
  { id: 'clerk_3', name: '阿茶', role: 'maker' },
  { id: 'clerk_4', name: '小冰', role: 'runner' },
  { id: 'clerk_5', name: '阿糖', role: 'patrol' },
]

const SURNAMES = ['陈', '李', '王', '黄', '周', '唐', '韦', '莫', '覃', '梁', '廖', '张', '赵', '林'] as const
const ROLE_TITLES: Record<CustomerRoleKind, readonly string[]> = {
  student: ['同学', '学妹', '学弟'],
  office: ['先生', '女士', '主管'],
  tourist: ['游客', '旅友', '达人'],
  local: ['街坊', '大姐', '大哥'],
  rider: ['骑手', '小哥'],
}

const ROLE_PALETTES: Record<CustomerRoleKind, { shirts: readonly string[]; pants: readonly string[]; patience: [number, number]; speed: [number, number] }> = {
  student: {
    shirts: ['#70a5d8', '#eef1f6', '#7cb394', '#f2b880', '#9ab3d6'],
    pants: ['#2b3648', '#424c5c', '#232830'],
    patience: [62, 85],
    speed: [1.55, 1.8],
  },
  office: {
    shirts: ['#384558', '#d7e0ea', '#4a647c', '#7c8d9e'],
    pants: ['#20242a', '#2e343e', '#464a52'],
    patience: [42, 60],
    speed: [1.75, 2.05],
  },
  tourist: {
    shirts: ['#e8a24a', '#5da89b', '#e26f64', '#ece5d6', '#6fa4d4'],
    pants: ['#4b5868', '#96876f', '#353d47'],
    patience: [70, 95],
    speed: [1.35, 1.6],
  },
  local: {
    shirts: ['#c8b594', '#6d8272', '#82776c', '#dde2de'],
    pants: ['#34383f', '#524b41', '#272c33'],
    patience: [78, 105],
    speed: [1.35, 1.55],
  },
  rider: {
    shirts: ['#2978c2', '#e4a41c', '#2b8f68'],
    pants: ['#1f2329', '#2b3038'],
    patience: [40, 56],
    speed: [1.95, 2.25],
  },
}

const SKIN_TONES = ['#f3d7bf', '#e9c3a1', '#dcb08a', '#c99772'] as const
const HAIR_COLORS = ['#1b1a1a', '#2e2219', '#4a3022', '#3c3330'] as const

const TERMINAL_ORDER_STATUSES = new Set<OrderStatus>([
  'completed',
  'cancelled_out_of_stock',
  'abandoned_queue',
  'abandoned_wait',
  'abandoned_unclaimed',
])

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.has(status)
}

function yawBetween(x0: number, z0: number, x1: number, z1: number): number {
  const dx = x1 - x0
  const dz = z1 - z0
  if (dx * dx + dz * dz < 1e-8) return 0
  return Math.atan2(dx, dz)
}

function normalizeMenu(menuOpt: CreateDrinksSimOptions['menu']): DrinkMenuItem[] {
  const raw = Array.isArray(menuOpt)
    ? menuOpt
    : menuOpt && 'items' in menuOpt && Array.isArray(menuOpt.items)
      ? menuOpt.items
      : DEFAULT_DRINKS_MENU
  const items = raw.length ? raw : DEFAULT_DRINKS_MENU
  return items.map((item, idx) => ({
    id: item.id || `drink_${idx + 1}`,
    name: item.name || `饮品 ${idx + 1}`,
    category: item.category ?? 'tea_shake',
    price: Math.max(1, Number.isFinite(item.price) ? item.price : 6),
    prepSec: Math.max(0.5, Number.isFinite(item.prepSec) ? item.prepSec : 3.0),
    stationKind: item.stationKind ?? 'tea_shake',
    cupColor: item.cupColor || '#f2c864',
    accentColor: item.accentColor || '#ffffff',
    ingredients: { ...(item.ingredients ?? { cup: 1 }) },
    hot: item.hot,
  }))
}

export function createDrinksSim(options: CreateDrinksSimOptions = {}): DrinksSim {
  const menu = normalizeMenu(options.menu)
  const menuById = new Map<string, DrinkMenuItem>(menu.map(item => [item.id, item]))
  const layout = createDefaultDrinksLayout(options.layout)
  const rng = createSeededRng(options.seed)

  let simTimeSec = Number.isFinite(options.now) ? Number(options.now) : 0
  const hourOfFn =
    options.hourOf ?? ((t: number) => normalizeHour(10 + t / 3600))
  const open24h = Boolean(options.open24h)
  const rejectPlayerWhenClosed = Boolean(options.rejectPlayerWhenClosed)
  const autoRestockSupply = options.autoRestockSupply !== false
  const maxCustomers = Math.max(6, Math.min(40, Math.floor(options.maxCustomers ?? 26)))
  const clerkCount = Math.max(2, Math.min(CLERK_PROFILES.length, Math.floor(options.clerkCount ?? 5)))

  let accumulator = 0
  let nextCustSeq = 1
  let nextOrderSeq = 1
  let spawnBudget = 0
  let lastSupplierHourBucket = -1
  let totalRevenue = 0
  let totalArrivals = 0
  let totalOrdersCreated = 0
  let ordersCompleted = 0
  let ordersCancelled = 0
  let ordersAbandonedQueue = 0
  let ordersAbandonedWait = 0
  let ordersAbandonedUnclaimed = 0
  let restockCount = 0
  let deadlockRecoveries = 0
  let peakConcurrentPeople = clerkCount
  const hourlyArrivals = new Array<number>(24).fill(0)
  const hourlyOrders = new Array<number>(24).fill(0)

  const inventory = new Map<string, InventoryBinState>()
  const baseDefs: readonly InventoryItemDef[] = options.inventoryDefs?.length
    ? options.inventoryDefs
    : DEFAULT_INVENTORY_DEFS
  for (const def of baseDefs) {
    inventory.set(def.id, {
      id: def.id,
      name: def.name,
      unit: def.unit,
      binAmount: Math.max(0, def.initialBin),
      binCapacity: Math.max(1, def.binCapacity),
      lowThreshold: Math.max(1, def.lowThreshold),
      backroomAmount: Math.max(0, def.initialBackroom),
      backroomCapacity: Math.max(def.binCapacity, def.backroomCapacity),
      restocking: false,
    })
  }
  for (const item of menu) {
    for (const ingId of Object.keys(item.ingredients)) {
      if (!inventory.has(ingId)) {
        inventory.set(ingId, {
          id: ingId,
          name: ingId,
          unit: '份',
          binAmount: 100,
          binCapacity: 120,
          lowThreshold: 20,
          backroomAmount: 1200,
          backroomCapacity: 1600,
          restocking: false,
        })
      }
    }
  }

  let minObservedInventory = Infinity
  function trackMinInventory(): void {
    for (const bin of inventory.values()) {
      if (bin.binAmount < minObservedInventory) minObservedInventory = bin.binAmount
      if (bin.backroomAmount < minObservedInventory) minObservedInventory = bin.backroomAmount
    }
  }
  trackMinInventory()

  const clerks: InternalClerk[] = []
  for (let i = 0; i < clerkCount; i++) {
    const profile = CLERK_PROFILES[i]!
    const homePos: DirectedSpot =
      i === 0
        ? layout.cashiers[0]!.clerkPos
        : i === 1
          ? layout.prepStations[1 % layout.prepStations.length]!
          : i === 2
            ? layout.prepStations[2 % layout.prepStations.length]!
            : i === 3
              ? layout.pickupClerkPos
              : layout.patrolPoints[0]!
    clerks.push({
      id: profile.id,
      name: profile.name,
      role: profile.role,
      state: 'idle',
      x: homePos.x,
      z: homePos.z,
      yaw: homePos.yaw,
      speed: 0,
      targetX: homePos.x,
      targetZ: homePos.z,
      targetYaw: homePos.yaw,
      moveSpeed: 2.3,
      homePos: { ...homePos },
      actionTimer: 0,
      actionDuration: 1,
      taskElapsedSec: 0,
      activeCustomerId: null,
      activeOrderId: null,
      targetStationId: null,
      targetStationIndex: -1,
      targetCashierIndex: i === 0 ? 0 : -1,
      targetBinId: null,
      restockStage: 'to_storage',
      holdingCup: false,
      holdingCupColor: null,
      holdingCrate: false,
      patrolIndex: i % layout.patrolPoints.length,
      actionLabel: '待命',
      pendingAfterWalk: null,
    })
  }

  const customers: InternalCustomer[] = []
  const orders: InternalOrder[] = []
  const activeOrdersList: InternalOrder[] = []
  const ordersById = new Map<string, InternalOrder>()
  const orderIdByKey = new Map<string, string>()
  const events: DrinksSimEvent[] = []
  const occupiedPickupSlots = new Set<number>()

  function currentHour(): number {
    return normalizeHour(hourOfFn(simTimeSec))
  }

  function emitEvent(ev: DrinksSimEvent): void {
    events.push(ev)
    if (events.length > 400) {
      events.splice(0, events.length - 400)
    }
  }

  function releaseClerkClaims(clerk: InternalClerk): void {
    if (clerk.targetBinId) {
      const bin = inventory.get(clerk.targetBinId)
      if (bin) bin.restocking = false
    }
    if (clerk.activeOrderId) {
      const ord = ordersById.get(clerk.activeOrderId)
      if (ord && ord.clerkId === clerk.id) {
        ord.clerkId = null
      }
    }
    clerk.activeCustomerId = null
    clerk.activeOrderId = null
    clerk.targetStationId = null
    clerk.targetStationIndex = -1
    clerk.targetCashierIndex = -1
    clerk.targetBinId = null
    clerk.holdingCup = false
    clerk.holdingCupColor = null
    clerk.holdingCrate = false
    clerk.pendingAfterWalk = null
    clerk.taskElapsedSec = 0
    clerk.actionTimer = 0
  }

  function canAffordIngredientsInBin(item: DrinkMenuItem, quantity: number): { ok: boolean; missingBinId?: string } {
    for (const [ingId, perUnit] of Object.entries(item.ingredients)) {
      const need = perUnit * quantity
      if (need <= 0) continue
      const bin = inventory.get(ingId)
      if (!bin || bin.binAmount < need) {
        return { ok: false, missingBinId: ingId }
      }
    }
    return { ok: true }
  }

  function hasPotentialSupply(item: DrinkMenuItem, quantity: number): boolean {
    for (const [ingId, perUnit] of Object.entries(item.ingredients)) {
      const need = perUnit * quantity
      if (need <= 0) continue
      const bin = inventory.get(ingId)
      if (!bin) return false
      if (bin.binAmount + bin.backroomAmount < need && !autoRestockSupply) {
        return false
      }
    }
    return true
  }

  function consumeIngredientsAtomic(item: DrinkMenuItem, quantity: number): boolean {
    const check = canAffordIngredientsInBin(item, quantity)
    if (!check.ok) return false
    for (const [ingId, perUnit] of Object.entries(item.ingredients)) {
      const need = perUnit * quantity
      if (need <= 0) continue
      const bin = inventory.get(ingId)!
      bin.binAmount = Math.max(0, bin.binAmount - need)
    }
    trackMinInventory()
    return true
  }

  function countQueueInLane(cashierIndex: number): number {
    let n = 0
    for (const c of customers) {
      if ((c.phase === 'queuing' || c.phase === 'ordering') && c.cashierIndex === cashierIndex) n++
    }
    return n
  }

  function getQueuePosition(cashierIndex: number, slot: number): Point2D {
    const lane = layout.cashiers[cashierIndex] ?? layout.cashiers[0]!
    const stagger = slot === 0 ? 0 : slot % 2 === 1 ? -0.24 : 0.24
    return {
      x: lane.queueAnchor.x + lane.queueDir.x * slot + stagger,
      z: lane.queueAnchor.z + lane.queueDir.z * slot,
    }
  }

  function refreshQueuePositions(): void {
    for (let laneIdx = 0; laneIdx < layout.cashiers.length; laneIdx++) {
      const lane = layout.cashiers[laneIdx]!
      const laneCusts = customers
        .filter(c => c.cashierIndex === laneIdx && (c.phase === 'queuing' || c.phase === 'ordering'))
        .sort((a, b) => a.queueSlot - b.queueSlot)
      laneCusts.forEach((c, idx) => {
        c.queueSlot = idx
        if (c.phase === 'queuing') {
          const pos = idx === 0 ? lane.customerPos : getQueuePosition(laneIdx, idx - 1)
          c.waypoints = [{ x: pos.x, z: pos.z }]
          c.finalYaw = lane.customerPos.yaw
        }
      })
    }
  }

  function pickBestCashierLane(): number {
    let bestIdx = 0
    let bestLoad = Infinity
    for (let i = 0; i < layout.cashiers.length; i++) {
      const load = countQueueInLane(i)
      if (load < bestLoad) {
        bestLoad = load
        bestIdx = i
      }
    }
    return bestIdx
  }

  function pickFreeWaitingSpot(): number {
    const used = new Set<number>()
    for (const c of customers) {
      if (c.phase === 'waiting_pickup' && c.waitingSpotIndex >= 0) used.add(c.waitingSpotIndex)
    }
    for (let i = 0; i < layout.waitingSpots.length; i++) {
      if (!used.has(i)) return i
    }
    return rng.int(0, layout.waitingSpots.length)
  }

  function pickFreeSeat(): number {
    const used = new Set<string>()
    for (const c of customers) {
      if (c.seatId) used.add(c.seatId)
    }
    const freeIndices: number[] = []
    layout.seats.forEach((s, idx) => {
      if (!used.has(s.id)) freeIndices.push(idx)
    })
    if (!freeIndices.length) return -1
    return rng.pick(freeIndices, freeIndices[0]!)
  }

  function pickPickupSlot(): number {
    for (let i = 0; i < layout.pickupSlots.length; i++) {
      if (!occupiedPickupSlots.has(i)) return i
    }
    return 0
  }

  function pickMenuPreference(roleKind: CustomerRoleKind, hour: number): DrinkMenuItem {
    const weights = menu.map(item => {
      let w = 1.0
      if (roleKind === 'student' && item.price <= 7) w *= 1.8
      if (roleKind === 'office' && item.category === 'coffee') w *= 2.4
      if (roleKind === 'tourist' && item.category === 'fruit_tea') w *= 2.2
      if (roleKind === 'local' && (item.category === 'lemonade' || item.category === 'milk_tea')) w *= 1.7
      if (hour >= 12 && hour <= 17 && (item.category === 'lemonade' || item.category === 'ice_cream')) w *= 1.9
      if (hour >= 19 && (item.category === 'milk_tea' || item.category === 'fruit_tea')) w *= 1.6
      return w
    })
    return rng.weightedPick(menu, weights, menu[0]!)
  }

  function createOrderRecord(opts: {
    orderKey: string
    source: 'npc' | 'player'
    customerId: string
    customerName: string
    item: DrinkMenuItem
    quantity: number
  }): InternalOrder {
    const id = `ord_${nextOrderSeq}`
    const letter = opts.source === 'player' ? 'P' : 'A'
    const ticketNo = `${letter}${String(nextOrderSeq).padStart(3, '0')}`
    nextOrderSeq++
    const qty = Math.max(1, Math.floor(opts.quantity))
    const order: InternalOrder = {
      id,
      ticketNo,
      orderKey: opts.orderKey,
      source: opts.source,
      customerId: opts.customerId,
      customerName: opts.customerName,
      item: opts.item,
      quantity: qty,
      unitPrice: opts.item.price,
      totalPrice: opts.item.price * qty,
      status: 'queued',
      stationId: null,
      clerkId: null,
      pickupSlotIndex: -1,
      prepElapsedSec: 0,
      prepDurationSec: opts.item.prepSec * (1 + (qty - 1) * 0.45),
      createdAtSec: simTimeSec,
      prepStartedAtSec: null,
      readyAtSec: null,
      finishedAtSec: null,
      ingredientsDeducted: false,
    }
    orders.push(order)
    activeOrdersList.push(order)
    ordersById.set(order.id, order)
    orderIdByKey.set(order.orderKey, order.id)
    totalOrdersCreated++
    const hBucket = Math.floor(currentHour()) % 24
    hourlyOrders[hBucket] = (hourlyOrders[hBucket] ?? 0) + 1
    emitEvent({
      type: 'order_created',
      timeSec: simTimeSec,
      orderId: order.id,
      ticketNo: order.ticketNo,
      customerId: order.customerId,
      itemName: order.item.name,
    })
    return order
  }

  function finishOrder(order: InternalOrder, nextStatus: OrderStatus): void {
    if (isTerminalOrderStatus(order.status)) return
    order.status = nextStatus
    order.finishedAtSec = simTimeSec
    const activeIdx = activeOrdersList.indexOf(order)
    if (activeIdx >= 0) activeOrdersList.splice(activeIdx, 1)
    if (order.pickupSlotIndex >= 0) {
      occupiedPickupSlots.delete(order.pickupSlotIndex)
      order.pickupSlotIndex = -1
    }
    order.clerkId = null
    if (nextStatus === 'completed') {
      ordersCompleted++
      totalRevenue = Math.round((totalRevenue + order.totalPrice) * 100) / 100
      emitEvent({
        type: 'order_completed',
        timeSec: simTimeSec,
        orderId: order.id,
        ticketNo: order.ticketNo,
        customerId: order.customerId,
        itemName: order.item.name,
      })
    } else {
      if (nextStatus === 'cancelled_out_of_stock') ordersCancelled++
      else if (nextStatus === 'abandoned_queue') ordersAbandonedQueue++
      else if (nextStatus === 'abandoned_wait') ordersAbandonedWait++
      else if (nextStatus === 'abandoned_unclaimed') ordersAbandonedUnclaimed++
      emitEvent({
        type: 'order_failed',
        timeSec: simTimeSec,
        orderId: order.id,
        ticketNo: order.ticketNo,
        customerId: order.customerId,
        detail: nextStatus,
      })
    }
  }

  function sendCustomerLeaving(c: InternalCustomer, angry: boolean): void {
    c.phase = 'leaving'
    c.angry = angry
    c.seatId = null
    c.waitingSpotIndex = -1
    c.cashierIndex = -1
    c.queueSlot = -1
    const exitApproach = c.leaveSide < 0 ? layout.approachLeft : layout.approachRight
    const wps: Point2D[] = []
    if (c.z < layout.entrance.z + 0.15) {
      wps.push({ x: layout.entrance.x + c.leaveSide * 0.35, z: layout.entrance.z + 0.8 })
    }
    wps.push({ x: exitApproach.x, z: exitApproach.z + rng.range(-0.35, 0.35) })
    c.waypoints = wps
    c.finalYaw = null
    refreshQueuePositions()
  }

  function spawnCustomer(hour: number, roleWeights: Record<CustomerRoleKind, number>): void {
    if (customers.length >= maxCustomers) return
    const roles: CustomerRoleKind[] = ['student', 'office', 'tourist', 'local', 'rider']
    const weights = roles.map(r => roleWeights[r] ?? 1)
    const roleKind = rng.weightedPick(roles, weights, 'student')
    const pal = ROLE_PALETTES[roleKind]
    const side: -1 | 1 = rng.next() < 0.5 ? -1 : 1
    const spawnBase = side < 0 ? layout.approachLeft : layout.approachRight
    const menuSlot = rng.pick(layout.menuBoardSlots, layout.menuBoardSlots[0]!)
    const patienceMax = rng.range(pal.patience[0], pal.patience[1])
    const desiredItem = pickMenuPreference(roleKind, hour)
    const id = `cust_${nextCustSeq++}`
    const name = `${rng.pick(SURNAMES, '陈')}${rng.pick(ROLE_TITLES[roleKind], '顾客')}`

    const cust: InternalCustomer = {
      id,
      name,
      roleKind,
      phase: 'entering',
      x: spawnBase.x,
      z: spawnBase.z + rng.range(-0.4, 0.4),
      yaw: side < 0 ? Math.PI * 0.5 : -Math.PI * 0.5,
      speed: 0,
      moveSpeed: rng.range(pal.speed[0], pal.speed[1]),
      waypoints: [
        { x: layout.entrance.x + side * 0.3, z: layout.entrance.z + 0.6 },
        { x: menuSlot.x + rng.range(-0.18, 0.18), z: menuSlot.z + rng.range(-0.12, 0.12) },
      ],
      finalYaw: menuSlot.yaw,
      stateTimer: 0,
      stateDuration: rng.range(2.2, 4.4),
      patienceSec: patienceMax,
      patienceMaxSec: patienceMax,
      cashierIndex: -1,
      queueSlot: -1,
      seatId: null,
      waitingSpotIndex: -1,
      waitingOrderId: null,
      desiredItemId: desiredItem.id,
      holdingCup: false,
      cupDrinkId: null,
      cupColor: null,
      sipsLeft: 0,
      sipProgress: 0,
      wantsSeat: roleKind === 'tourist' ? rng.next() < 0.85 : roleKind === 'local' ? rng.next() < 0.78 : rng.next() < 0.62,
      angry: false,
      leaveSide: side === 1 ? -1 : 1,
      shirtColor: rng.pick(pal.shirts, '#6ea8d9'),
      pantsColor: rng.pick(pal.pants, '#2b3648'),
      skinColor: rng.pick(SKIN_TONES, '#e9c3a1'),
      hairColor: rng.pick(HAIR_COLORS, '#1b1a1a'),
      variant: rng.int(0, 4),
    }

    customers.push(cust)
    totalArrivals++
    const hBucket = Math.floor(hour) % 24
    hourlyArrivals[hBucket] = (hourlyArrivals[hBucket] ?? 0) + 1
    emitEvent({
      type: 'customer_entered',
      timeSec: simTimeSec,
      customerId: cust.id,
      detail: cust.roleKind,
    })
  }

  function moveEntityToward(
    ent: { x: number; z: number; yaw: number; speed: number },
    tx: number,
    tz: number,
    maxSpeed: number,
    dt: number,
  ): boolean {
    const dx = tx - ent.x
    const dz = tz - ent.z
    const dist = Math.hypot(dx, dz)
    if (dist <= 0.06) {
      ent.x = tx
      ent.z = tz
      ent.speed = 0
      return true
    }
    const step = Math.min(dist, maxSpeed * dt)
    ent.x += (dx / dist) * step
    ent.z += (dz / dist) * step
    ent.yaw = yawBetween(0, 0, dx, dz)
    ent.speed = step / Math.max(1e-6, dt)
    return dist - step <= 0.06
  }

  function startClerkWalk(clerk: InternalClerk, x: number, z: number, yaw: number, nextState: ClerkState, label: string): void {
    clerk.targetX = x
    clerk.targetZ = z
    clerk.targetYaw = yaw
    clerk.pendingAfterWalk = nextState
    clerk.state = 'walking'
    clerk.taskElapsedSec = 0
    clerk.actionLabel = label
  }

  function pickStationForOrder(item: DrinkMenuItem): number {
    const busyStations = new Set<number>()
    for (const c of clerks) {
      if (c.targetStationIndex >= 0) busyStations.add(c.targetStationIndex)
    }
    for (let i = 0; i < layout.prepStations.length; i++) {
      if (layout.prepStations[i]!.kind === item.stationKind && !busyStations.has(i)) return i
    }
    for (let i = 0; i < layout.prepStations.length; i++) {
      if (!busyStations.has(i)) return i
    }
    return 0
  }

  function findNeededRestockBin(): InventoryBinState | null {
    // Urgent: ingredient missing for a queued order!
    for (const ord of activeOrdersList) {
      if (ord.status !== 'queued') continue
      const check = canAffordIngredientsInBin(ord.item, ord.quantity)
      if (!check.ok && check.missingBinId) {
        const bin = inventory.get(check.missingBinId)
        if (bin && !bin.restocking && (bin.backroomAmount > 0 || autoRestockSupply)) {
          return bin
        }
      }
    }
    // Routine: any bin below lowThreshold
    for (const bin of inventory.values()) {
      if (!bin.restocking && bin.binAmount <= bin.lowThreshold && (bin.backroomAmount > 0 || autoRestockSupply)) {
        return bin
      }
    }
    return null
  }

  function findClaimableQueuedOrder(): InternalOrder | null {
    for (const ord of activeOrdersList) {
      if (ord.status === 'queued' && !ord.clerkId) {
        if (canAffordIngredientsInBin(ord.item, ord.quantity).ok) {
          return ord
        }
      }
    }
    return null
  }

  function findWaitingCashierCustomer(): { customer: InternalCustomer; laneIdx: number } | null {
    const claimed = new Set<string>()
    for (const cl of clerks) {
      if (cl.activeCustomerId) claimed.add(cl.activeCustomerId)
    }
    for (let laneIdx = 0; laneIdx < layout.cashiers.length; laneIdx++) {
      const head = customers.find(
        c => c.phase === 'queuing' && c.cashierIndex === laneIdx && c.queueSlot === 0 && !claimed.has(c.id),
      )
      if (head) {
        const lane = layout.cashiers[laneIdx]!
        const dist = Math.hypot(head.x - lane.customerPos.x, head.z - lane.customerPos.z)
        if (dist <= 0.45) {
          return { customer: head, laneIdx }
        }
      }
    }
    return null
  }

  function assignClerkTask(clerk: InternalClerk): void {
    const needBin = findNeededRestockBin()
    const cashierWork = findWaitingCashierCustomer()
    const prepWork = findClaimableQueuedOrder()

    const assignRestock = (bin: InventoryBinState): boolean => {
      bin.restocking = true
      clerk.targetBinId = bin.id
      clerk.restockStage = 'to_storage'
      clerk.holdingCrate = false
      startClerkWalk(clerk, layout.storagePos.x, layout.storagePos.z, layout.storagePos.yaw, 'restocking', `补料·${bin.name}`)
      return true
    }

    const assignCashier = (work: { customer: InternalCustomer; laneIdx: number }): boolean => {
      const lane = layout.cashiers[work.laneIdx]!
      clerk.activeCustomerId = work.customer.id
      clerk.targetCashierIndex = work.laneIdx
      clerk.actionDuration = rng.range(1.8, 2.8)
      clerk.actionTimer = 0
      work.customer.phase = 'ordering'
      work.customer.speed = 0
      startClerkWalk(clerk, lane.clerkPos.x, lane.clerkPos.z, lane.clerkPos.yaw, 'taking_order', '点单')
      return true
    }

    const assignMake = (ord: InternalOrder): boolean => {
      const stIdx = pickStationForOrder(ord.item)
      const station = layout.prepStations[stIdx]!
      ord.clerkId = clerk.id
      ord.stationId = station.id
      clerk.activeOrderId = ord.id
      clerk.targetStationIndex = stIdx
      clerk.targetStationId = station.id
      startClerkWalk(clerk, station.x, station.z, station.yaw, 'making', `制作·${ord.item.name}`)
      return true
    }

    // Priority routing per role, with full cross-training fallback so no lane/station starves
    if (clerk.role === 'cashier') {
      if (cashierWork && assignCashier(cashierWork)) return
      if (prepWork && assignMake(prepWork)) return
      if (needBin && assignRestock(needBin)) return
    } else if (clerk.role === 'maker') {
      if (prepWork && assignMake(prepWork)) return
      if (cashierWork && assignCashier(cashierWork)) return
      if (needBin && assignRestock(needBin)) return
    } else if (clerk.role === 'patrol' || clerk.role === 'runner') {
      if (needBin && assignRestock(needBin)) return
      if (prepWork && assignMake(prepWork)) return
      if (cashierWork && assignCashier(cashierWork)) return
    }

    // Check if any queued order is blocked on stock and cancel only if impossible to supply
    for (let oi = activeOrdersList.length - 1; oi >= 0; oi--) {
      const ord = activeOrdersList[oi]!
      if (ord.status === 'queued' && !ord.clerkId && !hasPotentialSupply(ord.item, ord.quantity)) {
        finishOrder(ord, 'cancelled_out_of_stock')
        const cust = customers.find(c => c.id === ord.customerId)
        if (cust && cust.phase === 'waiting_pickup') {
          sendCustomerLeaving(cust, true)
        }
      }
    }

    // Otherwise patrol counter periodically when open
    if (clerk.role === 'patrol' || rng.next() < 0.08) {
      clerk.patrolIndex = (clerk.patrolIndex + 1) % layout.patrolPoints.length
      const pt = layout.patrolPoints[clerk.patrolIndex]!
      clerk.actionDuration = rng.range(1.5, 3.0)
      clerk.actionTimer = 0
      startClerkWalk(clerk, pt.x, pt.z, pt.yaw, 'patrolling', '巡台')
    }
  }

  function stepClerks(dt: number): void {
    for (const clerk of clerks) {
      if (clerk.state !== 'idle') {
        clerk.taskElapsedSec += dt
        if (clerk.taskElapsedSec > 75) {
          releaseClerkClaims(clerk)
          clerk.state = 'idle'
          clerk.actionLabel = '待命'
          deadlockRecoveries++
        }
      }

      if (clerk.state === 'idle') {
        clerk.speed = 0
        assignClerkTask(clerk)
        continue
      }

      if (clerk.state === 'walking') {
        const arrived = moveEntityToward(clerk, clerk.targetX, clerk.targetZ, clerk.moveSpeed, dt)
        if (arrived) {
          clerk.yaw = clerk.targetYaw
          const nextState = clerk.pendingAfterWalk ?? 'idle'
          clerk.pendingAfterWalk = null
          clerk.state = nextState
          clerk.actionTimer = 0
        }
        continue
      }

      if (clerk.state === 'patrolling') {
        clerk.speed = 0
        clerk.actionTimer += dt
        // Interrupt patrol immediately if urgent work appears
        if (findWaitingCashierCustomer() || findClaimableQueuedOrder() || findNeededRestockBin()) {
          clerk.state = 'idle'
          clerk.taskElapsedSec = 0
          continue
        }
        if (clerk.actionTimer >= clerk.actionDuration) {
          clerk.state = 'idle'
          clerk.taskElapsedSec = 0
          clerk.actionLabel = '待命'
        }
        continue
      }

      if (clerk.state === 'taking_order') {
        clerk.speed = 0
        const cust = customers.find(c => c.id === clerk.activeCustomerId)
        if (!cust || cust.phase !== 'ordering') {
          releaseClerkClaims(clerk)
          clerk.state = 'idle'
          continue
        }
        clerk.actionTimer += dt
        if (clerk.actionTimer >= clerk.actionDuration) {
          const item = (cust.desiredItemId && menuById.get(cust.desiredItemId)) || menu[0]!
          const orderKey = `npc:${cust.id}:${nextOrderSeq}`
          const ord = createOrderRecord({
            orderKey,
            source: 'npc',
            customerId: cust.id,
            customerName: cust.name,
            item,
            quantity: 1,
          })
          cust.waitingOrderId = ord.id
          cust.phase = 'waiting_pickup'
          cust.cashierIndex = -1
          cust.queueSlot = -1
          cust.patienceSec = Math.max(cust.patienceSec, 65)
          cust.patienceMaxSec = Math.max(cust.patienceMaxSec, 65)
          const waitIdx = pickFreeWaitingSpot()
          cust.waitingSpotIndex = waitIdx
          const waitPos = layout.waitingSpots[waitIdx] ?? layout.waitingSpots[0]!
          cust.waypoints = [{ x: waitPos.x, z: waitPos.z }]
          cust.finalYaw = waitPos.yaw
          refreshQueuePositions()

          releaseClerkClaims(clerk)
          clerk.state = 'idle'
          clerk.actionLabel = '待命'
        }
        continue
      }

      if (clerk.state === 'making') {
        clerk.speed = 0
        const ord = clerk.activeOrderId ? ordersById.get(clerk.activeOrderId) : undefined
        if (!ord || isTerminalOrderStatus(ord.status)) {
          releaseClerkClaims(clerk)
          clerk.state = 'idle'
          continue
        }
        if (ord.status === 'queued') {
          const ok = consumeIngredientsAtomic(ord.item, ord.quantity)
          if (!ok) {
            // Ingredient was grabbed by another maker while walking; release & let restock run
            releaseClerkClaims(clerk)
            clerk.state = 'idle'
            continue
          }
          ord.ingredientsDeducted = true
          ord.status = 'preparing'
          ord.prepStartedAtSec = simTimeSec
          emitEvent({
            type: 'order_preparing',
            timeSec: simTimeSec,
            orderId: ord.id,
            ticketNo: ord.ticketNo,
            clerkId: clerk.id,
            itemName: ord.item.name,
          })
        }

        ord.prepElapsedSec += dt
        if (ord.prepElapsedSec >= ord.prepDurationSec) {
          // If NPC customer already abandoned while preparing, mark unclaimed terminal cleanly
          if (ord.source === 'npc') {
            const cust = customers.find(c => c.id === ord.customerId)
            if (!cust || cust.phase === 'leaving') {
              finishOrder(ord, 'abandoned_unclaimed')
              releaseClerkClaims(clerk)
              clerk.state = 'idle'
              continue
            }
          }
          clerk.holdingCup = true
          clerk.holdingCupColor = ord.item.cupColor
          startClerkWalk(
            clerk,
            layout.pickupClerkPos.x,
            layout.pickupClerkPos.z,
            layout.pickupClerkPos.yaw,
            'calling',
            `叫号·${ord.ticketNo}`,
          )
        }
        continue
      }

      if (clerk.state === 'calling') {
        clerk.speed = 0
        const ord = clerk.activeOrderId ? ordersById.get(clerk.activeOrderId) : undefined
        if (!ord) {
          releaseClerkClaims(clerk)
          clerk.state = 'idle'
          continue
        }
        if (clerk.actionTimer === 0 && ord.status === 'preparing') {
          const slotIdx = pickPickupSlot()
          occupiedPickupSlots.add(slotIdx)
          ord.pickupSlotIndex = slotIdx
          ord.status = 'ready_for_pickup'
          ord.readyAtSec = simTimeSec
          clerk.holdingCup = false
          clerk.holdingCupColor = null
          emitEvent({
            type: 'order_called',
            timeSec: simTimeSec,
            orderId: ord.id,
            ticketNo: ord.ticketNo,
            customerId: ord.customerId,
            clerkId: clerk.id,
            itemName: ord.item.name,
          })
        }
        clerk.actionTimer += dt
        if (clerk.actionTimer >= 0.9) {
          releaseClerkClaims(clerk)
          clerk.state = 'idle'
          clerk.actionLabel = '待命'
        }
        continue
      }

      if (clerk.state === 'restocking') {
        clerk.speed = 0
        const bin = clerk.targetBinId ? inventory.get(clerk.targetBinId) : undefined
        if (!bin) {
          releaseClerkClaims(clerk)
          clerk.state = 'idle'
          continue
        }
        if (clerk.restockStage === 'to_storage') {
          clerk.restockStage = 'picking'
          clerk.actionTimer = 0
        } else if (clerk.restockStage === 'picking') {
          clerk.actionTimer += dt
          if (clerk.actionTimer >= 1.1) {
            clerk.holdingCrate = true
            clerk.restockStage = 'to_bar'
            const targetStation = layout.prepStations[0]!
            startClerkWalk(clerk, targetStation.x + 0.6, targetStation.z + 0.6, Math.PI, 'restocking', `上料·${bin.name}`)
          }
        } else if (clerk.restockStage === 'to_bar') {
          clerk.restockStage = 'refilling'
          clerk.actionTimer = 0
        } else {
          clerk.actionTimer += dt
          if (clerk.actionTimer >= 1.2) {
            if (autoRestockSupply && bin.backroomAmount < bin.binCapacity) {
              bin.backroomAmount = bin.backroomCapacity
            }
            const needed = Math.max(0, bin.binCapacity - bin.binAmount)
            const transfer = Math.min(needed, bin.backroomAmount)
            bin.binAmount += transfer
            bin.backroomAmount = Math.max(0, bin.backroomAmount - transfer)
            trackMinInventory()
            restockCount++
            emitEvent({
              type: 'restock_done',
              timeSec: simTimeSec,
              clerkId: clerk.id,
              detail: bin.id,
            })
            releaseClerkClaims(clerk)
            clerk.state = 'idle'
            clerk.actionLabel = '待命'
          }
        }
      }
    }
  }

  function applyCustomerSeparation(dt: number): void {
    const minSep = 0.84
    const minSepSq = minSep * minSep
    const pushRate = 4.2 * dt
    for (let i = 0; i < customers.length; i++) {
      const a = customers[i]!
      if (a.phase === 'seated' && a.waypoints.length === 0) continue
      for (let j = i + 1; j < customers.length; j++) {
        const b = customers[j]!
        if (b.phase === 'seated' && b.waypoints.length === 0) continue
        const dx = b.x - a.x
        const dz = b.z - a.z
        const dSq = dx * dx + dz * dz
        if (dSq < minSepSq) {
          const dist = Math.sqrt(dSq)
          const nx = dist > 1e-4 ? dx / dist : 1
          const nz = dist > 1e-4 ? dz / dist : 0
          const overlap = (minSep - dist) * 0.5 * Math.min(1, pushRate)
          if (a.phase !== 'ordering') {
            a.x -= nx * overlap
            a.z -= nz * overlap
            if (a.z < -0.02) a.z = -0.02
          }
          if (b.phase !== 'ordering') {
            b.x += nx * overlap
            b.z += nz * overlap
            if (b.z < -0.02) b.z = -0.02
          }
        }
      }
    }
  }

  function stepCustomers(dt: number, isOpen: boolean): void {
    for (let i = customers.length - 1; i >= 0; i--) {
      const c = customers[i]!

      if (c.waypoints.length > 0) {
        const wp = c.waypoints[0]!
        const arrived = moveEntityToward(c, wp.x, wp.z, c.moveSpeed, dt)
        if (arrived) {
          c.waypoints.shift()
          if (c.waypoints.length === 0 && c.finalYaw !== null) {
            c.yaw = c.finalYaw
            c.finalYaw = null
          }
        }
      } else {
        c.speed = 0
      }

      if (c.phase === 'entering') {
        if (c.waypoints.length === 0) {
          c.phase = 'browsing_menu'
          c.stateTimer = 0
        }
        continue
      }

      if (c.phase === 'browsing_menu') {
        if (c.waypoints.length > 0) continue
        c.stateTimer += dt
        if (c.stateTimer >= c.stateDuration) {
          if (!isOpen) {
            sendCustomerLeaving(c, false)
            continue
          }
          const laneIdx = pickBestCashierLane()
          const laneLen = countQueueInLane(laneIdx)
          if (laneLen >= 6) {
            sendCustomerLeaving(c, false)
            continue
          }
          c.phase = 'queuing'
          c.cashierIndex = laneIdx
          c.queueSlot = laneLen
          refreshQueuePositions()
        }
        continue
      }

      if (c.phase === 'queuing') {
        c.patienceSec -= dt * (1 + Math.max(0, c.queueSlot - 1) * 0.08)
        if (c.patienceSec <= 0) {
          ordersAbandonedQueue++
          sendCustomerLeaving(c, true)
        }
        continue
      }

      if (c.phase === 'ordering') {
        // Clerk drives transition to waiting_pickup
        continue
      }

      if (c.phase === 'waiting_pickup') {
        const ord = c.waitingOrderId ? ordersById.get(c.waitingOrderId) : undefined
        if (!ord || ord.status === 'cancelled_out_of_stock') {
          sendCustomerLeaving(c, true)
          continue
        }
        if (ord.status === 'ready_for_pickup') {
          c.phase = 'picking_up'
          c.waitingSpotIndex = -1
          const slot = layout.pickupSlots[ord.pickupSlotIndex] ?? layout.pickupSlots[0]!
          c.waypoints = [{ x: slot.x, z: slot.z }]
          c.finalYaw = slot.yaw
          continue
        }
        c.patienceSec -= dt * 0.6
        if (c.patienceSec <= 0 && ord.status === 'queued') {
          finishOrder(ord, 'abandoned_wait')
          sendCustomerLeaving(c, true)
        }
        continue
      }

      if (c.phase === 'picking_up') {
        if (c.waypoints.length > 0) continue
        const ord = c.waitingOrderId ? ordersById.get(c.waitingOrderId) : undefined
        if (ord && ord.status === 'ready_for_pickup') {
          finishOrder(ord, 'completed')
          c.holdingCup = true
          c.cupDrinkId = ord.item.id
          c.cupColor = ord.item.cupColor
          c.sipsLeft = 4
          c.sipProgress = 0
        }
        c.waitingOrderId = null
        const freeSeatIdx = c.wantsSeat ? pickFreeSeat() : -1
        if (freeSeatIdx >= 0) {
          const seat = layout.seats[freeSeatIdx]!
          c.phase = 'seated'
          c.seatId = seat.id
          c.stateTimer = 0
          c.stateDuration = rng.range(18, 34)
          c.waypoints = [{ x: seat.x, z: seat.z }]
          c.finalYaw = seat.yaw
        } else {
          sendCustomerLeaving(c, false)
        }
        continue
      }

      if (c.phase === 'seated') {
        if (c.waypoints.length > 0) continue
        c.stateTimer += dt
        const ratio = Math.min(1, c.stateTimer / Math.max(1, c.stateDuration))
        c.sipProgress = (c.stateTimer * 0.45) % 1
        c.sipsLeft = Math.max(0, Math.ceil((1 - ratio) * 4))
        if (c.stateTimer >= c.stateDuration) {
          sendCustomerLeaving(c, false)
        }
        continue
      }

      if (c.phase === 'leaving') {
        if (c.holdingCup) {
          c.sipProgress = (simTimeSec * 0.4) % 1
        }
        if (c.waypoints.length === 0) {
          emitEvent({
            type: 'customer_left',
            timeSec: simTimeSec,
            customerId: c.id,
            detail: c.angry ? 'angry' : 'satisfied',
          })
          customers.splice(i, 1)
        }
      }
    }
  }

  function stepUnclaimedOrders(): void {
    for (let oi = activeOrdersList.length - 1; oi >= 0; oi--) {
      const ord = activeOrdersList[oi]!
      if (ord.status !== 'ready_for_pickup' || ord.readyAtSec === null) continue
      const timeout = ord.source === 'player' ? 300 : 120
      if (simTimeSec - ord.readyAtSec >= timeout) {
        finishOrder(ord, 'abandoned_unclaimed')
        const cust = customers.find(c => c.id === ord.customerId)
        if (cust && cust.phase !== 'leaving') {
          sendCustomerLeaving(cust, true)
        }
      }
    }
  }

  function maybeScheduledSupplierDelivery(hour: number): void {
    if (!autoRestockSupply) return
    const bucket = Math.floor(hour)
    if (bucket === lastSupplierHourBucket) return
    lastSupplierHourBucket = bucket
    if (bucket === 6 || bucket === 14) {
      for (const bin of inventory.values()) {
        bin.backroomAmount = bin.backroomCapacity
      }
    }
  }

  function tickFixed(dt: number): void {
    simTimeSec += dt
    const hour = currentHour()
    const traffic = getDrinksTrafficProfile(hour, open24h)
    maybeScheduledSupplierDelivery(hour)

    if (traffic.isOpen) {
      const nonLeavingCount = customers.filter(c => c.phase !== 'leaving').length
      const rateScale = nonLeavingCount < traffic.targetCustomers ? 1.85 : 0.35
      spawnBudget += (traffic.arrivalsPerMin / 60) * dt * rateScale
      while (spawnBudget >= 1) {
        spawnBudget -= 1
        spawnCustomer(hour, traffic.roleWeights)
      }
    } else {
      spawnBudget = 0
    }

    stepClerks(dt)
    stepCustomers(dt, traffic.isOpen)
    applyCustomerSeparation(dt)
    stepUnclaimedOrders()

    const totalPeople = clerks.length + customers.length
    if (totalPeople > peakConcurrentPeople) {
      peakConcurrentPeople = totalPeople
    }
  }

  function toOrderSnapshot(ord: InternalOrder): OrderSnapshot {
    return {
      id: ord.id,
      ticketNo: ord.ticketNo,
      orderKey: ord.orderKey,
      source: ord.source,
      customerId: ord.customerId,
      customerName: ord.customerName,
      itemId: ord.item.id,
      itemName: ord.item.name,
      cupColor: ord.item.cupColor,
      quantity: ord.quantity,
      unitPrice: ord.unitPrice,
      totalPrice: ord.totalPrice,
      status: ord.status,
      stationId: ord.stationId,
      clerkId: ord.clerkId,
      pickupSlotIndex: ord.pickupSlotIndex,
      progress: ord.status === 'ready_for_pickup' || ord.status === 'completed'
        ? 1
        : Math.min(1, ord.prepElapsedSec / Math.max(0.01, ord.prepDurationSec)),
      createdAtSec: ord.createdAtSec,
      prepStartedAtSec: ord.prepStartedAtSec,
      readyAtSec: ord.readyAtSec,
      finishedAtSec: ord.finishedAtSec,
    }
  }

  function getSnapshot(): DrinksSimSnapshot {
    const hour = currentHour()
    const traffic = getDrinksTrafficProfile(hour, open24h)
    const invObj: Record<string, InventoryBinState> = {}
    for (const [k, v] of inventory.entries()) {
      invObj[k] = { ...v }
    }
    const clerkSnaps: ClerkSnapshot[] = clerks.map(c => ({
      id: c.id,
      name: c.name,
      role: c.role,
      state: c.state,
      x: c.x,
      z: c.z,
      yaw: c.yaw,
      speed: c.speed,
      progress: c.actionDuration > 0 ? Math.min(1, c.actionTimer / c.actionDuration) : 0,
      holdingCup: c.holdingCup,
      holdingCupColor: c.holdingCupColor,
      holdingCrate: c.holdingCrate,
      activeOrderId: c.activeOrderId,
      targetStationId: c.targetStationId,
      actionLabel: c.actionLabel,
    }))
    const customerSnaps: CustomerSnapshot[] = customers.map(c => ({
      id: c.id,
      name: c.name,
      roleKind: c.roleKind,
      phase: c.phase,
      x: c.x,
      z: c.z,
      yaw: c.yaw,
      speed: c.speed,
      seated: c.phase === 'seated' && c.waypoints.length === 0,
      seatId: c.seatId,
      waitingOrderId: c.waitingOrderId,
      desiredItemId: c.desiredItemId,
      holdingCup: c.holdingCup,
      cupDrinkId: c.cupDrinkId,
      cupColor: c.cupColor,
      sipsLeft: c.sipsLeft,
      sipProgress: c.sipProgress,
      patienceRatio: Math.max(0, Math.min(1, c.patienceSec / Math.max(1, c.patienceMaxSec))),
      angry: c.angry,
      shirtColor: c.shirtColor,
      pantsColor: c.pantsColor,
      skinColor: c.skinColor,
      hairColor: c.hairColor,
      variant: c.variant,
    }))
    const orderSnaps = orders.map(toOrderSnapshot)
    const activeOrders = activeOrdersList.length
    const queueLength = customers.reduce((n, c) => n + (c.phase === 'queuing' || c.phase === 'ordering' ? 1 : 0), 0)

    return {
      timeSec: simTimeSec,
      hour,
      phase: traffic.phase,
      isOpen: traffic.isOpen,
      clerks: clerkSnaps,
      customers: customerSnaps,
      orders: orderSnaps,
      inventory: invObj,
      metrics: {
        totalArrivals,
        totalOrdersCreated,
        ordersCompleted,
        ordersCancelled,
        ordersAbandonedQueue,
        ordersAbandonedWait,
        ordersAbandonedUnclaimed,
        activeCustomers: customers.length,
        activeClerks: clerks.length,
        activeOrders,
        queueLength,
        totalRevenue,
        restockCount,
        deadlockRecoveries,
        minObservedInventory: Number.isFinite(minObservedInventory) ? minObservedInventory : 0,
        peakConcurrentPeople,
        hourlyArrivals: [...hourlyArrivals],
        hourlyOrders: [...hourlyOrders],
      },
    }
  }

  return {
    fixedDt: SIM_FIXED_DT,
    fastForwardTolerance: { ...SIM_FAST_FORWARD_TOLERANCE },

    step(dtSec: number): void {
      if (!Number.isFinite(dtSec) || dtSec <= 0) return
      accumulator += dtSec
      while (accumulator + 1e-9 >= SIM_FIXED_DT) {
        accumulator = Math.max(0, accumulator - SIM_FIXED_DT)
        tickFixed(SIM_FIXED_DT)
      }
    },

    fastForward(durationSec: number): DrinksSimSnapshot {
      if (Number.isFinite(durationSec) && durationSec > 0) {
        accumulator += durationSec
        while (accumulator + 1e-9 >= SIM_FIXED_DT) {
          accumulator = Math.max(0, accumulator - SIM_FIXED_DT)
          tickFixed(SIM_FIXED_DT)
        }
      }
      return getSnapshot()
    },

    placePlayerOrder(req: PlacePlayerOrderRequest): PlacePlayerOrderResult {
      if (!req || typeof req.orderKey !== 'string' || !req.orderKey.trim()) {
        return { ok: false, code: 'INVALID_ORDER_KEY', created: false, idempotentReplay: false }
      }
      const existingId = orderIdByKey.get(req.orderKey)
      if (existingId) {
        const existing = ordersById.get(existingId)!
        return {
          ok: true,
          code: 'IDEMPOTENT_REPLAY',
          created: false,
          idempotentReplay: true,
          order: toOrderSnapshot(existing),
        }
      }
      if (rejectPlayerWhenClosed && !getDrinksTrafficProfile(currentHour(), open24h).isOpen) {
        return { ok: false, code: 'SHOP_CLOSED', created: false, idempotentReplay: false }
      }
      const item = menuById.get(req.menuItemId)
      if (!item) {
        return { ok: false, code: 'UNKNOWN_ITEM', created: false, idempotentReplay: false }
      }
      const qty = req.quantity ?? 1
      if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
        return { ok: false, code: 'INVALID_QUANTITY', created: false, idempotentReplay: false }
      }
      const ord = createOrderRecord({
        orderKey: req.orderKey,
        source: 'player',
        customerId: req.customerId || 'player',
        customerName: req.customerName || '玩家',
        item,
        quantity: qty,
      })
      return {
        ok: true,
        code: 'OK',
        created: true,
        idempotentReplay: false,
        order: toOrderSnapshot(ord),
      }
    },

    collectPlayerOrder(orderIdOrKey: string): CollectPlayerOrderResult {
      const resolvedId = orderIdByKey.get(orderIdOrKey) ?? orderIdOrKey
      const ord = ordersById.get(resolvedId)
      if (!ord) {
        return { ok: false, code: 'ORDER_NOT_FOUND' }
      }
      if (isTerminalOrderStatus(ord.status)) {
        return { ok: false, code: 'ALREADY_FINISHED', order: toOrderSnapshot(ord), item: ord.item }
      }
      if (ord.status !== 'ready_for_pickup') {
        return { ok: false, code: 'NOT_READY', order: toOrderSnapshot(ord), item: ord.item }
      }
      finishOrder(ord, 'completed')
      return { ok: true, code: 'OK', order: toOrderSnapshot(ord), item: ord.item }
    },

    getSnapshot,

    getOrder(orderIdOrKey: string): OrderSnapshot | null {
      const resolvedId = orderIdByKey.get(orderIdOrKey) ?? orderIdOrKey
      const ord = ordersById.get(resolvedId)
      return ord ? toOrderSnapshot(ord) : null
    },

    getMenu(): readonly DrinkMenuItem[] {
      return menu
    },

    getLayout(): DrinkShopLayout {
      return layout
    },

    drainEvents(): DrinksSimEvent[] {
      const out = [...events]
      events.length = 0
      return out
    },

    validateInvariants(): InvariantCheckResult {
      const errors: string[] = []
      for (const bin of inventory.values()) {
        if (bin.binAmount < 0 || !Number.isFinite(bin.binAmount)) {
          errors.push(`negative or invalid binAmount on ${bin.id}: ${bin.binAmount}`)
        }
        if (bin.backroomAmount < 0 || !Number.isFinite(bin.backroomAmount)) {
          errors.push(`negative or invalid backroomAmount on ${bin.id}: ${bin.backroomAmount}`)
        }
      }
      if (minObservedInventory < 0) {
        errors.push(`minObservedInventory dropped below 0: ${minObservedInventory}`)
      }
      const seenKeys = new Set<string>()
      for (const ord of orders) {
        if (seenKeys.has(ord.orderKey)) {
          errors.push(`duplicate orderKey in orders: ${ord.orderKey}`)
        }
        seenKeys.add(ord.orderKey)
      }
      if (deadlockRecoveries > 0) {
        errors.push(`deadlockRecoveries > 0: ${deadlockRecoveries}`)
      }
      return { ok: errors.length === 0, errors }
    },
  }
}
