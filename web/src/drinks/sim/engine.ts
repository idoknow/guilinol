import {
  convertCatalogMenuToSim,
  createDrinksLayoutFixture,
  DEFAULT_DRINKS_MENU,
  DEFAULT_INVENTORY_DEFS,
  layoutFromShopAnchors,
  validateLayoutForMenu,
} from './menu.ts'
import { createSeededRng } from './prng.ts'
import {
  getDrinksTrafficProfile,
  MAX_CONCURRENT_CUSTOMERS,
  MAX_DOORWAY_QUEUE,
  normalizeHour,
} from './traffic.ts'
import type {
  CancelPlayerOrderResult,
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
  InteractionBubbleKind,
  InteractionGesture,
  InventoryBinState,
  InventoryItemDef,
  InvariantCheckResult,
  OrderSnapshot,
  OrderStatus,
  PlacePlayerOrderRequest,
  PlacePlayerOrderResult,
  PlayerPresenceInput,
  Point2D,
  SeatOccupancyState,
  SeatSnapshot,
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
  waypoints: Point2D[]
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
  cleaningSeatId: string | null
  restockStage: 'to_storage' | 'picking' | 'to_bar' | 'refilling'
  holdingCup: boolean
  holdingCupColor: string | null
  holdingCrate: boolean
  patrolIndex: number
  actionLabel: string
  activeStepLabel: string | null
  pendingAfterWalk: ClerkState | null
  interactionKind: InteractionBubbleKind | null
  interactionGesture: InteractionGesture
  interactionTimer: number
  interactionTextVar: string | null
  cashChangeText: string | null
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
  groupId: string | null
  chatPartnerId: string | null
  holdingCup: boolean
  cupDrinkId: string | null
  cupColor: string | null
  cameraProp: boolean
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
  interactionKind: InteractionBubbleKind | null
  interactionGesture: InteractionGesture
  interactionTimer: number
  interactionTextVar: string | null
  urgedOnce: boolean
  tookPhotoOnce: boolean
  chatCooldown: number
  yieldCooldown: number
  complainHoldTimer: number
  handoverHoldTimer: number
  chatHoldTimer: number
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
  activeStepLabel: string | null
  createdAtSec: number
  prepStartedAtSec: number | null
  readyAtSec: number | null
  finishedAtSec: number | null
  ingredientsDeducted: boolean
}

interface InternalSeat {
  id: string
  zone: 'indoor' | 'patio'
  x: number
  z: number
  yaw: number
  state: SeatOccupancyState
  occupantId: string | null
  dirtyCupColor: string | null
  dirtySinceSec: number
  cleaningClerkId: string | null
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
  'cancelled_by_player',
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

function resolveMenu(
  menuOpt: CreateDrinksSimOptions['menu'],
  inventoryDefs: readonly InventoryItemDef[],
): DrinkMenuItem[] {
  if (!menuOpt) {
    return inventoryDefs === DEFAULT_INVENTORY_DEFS
      ? [...DEFAULT_DRINKS_MENU]
      : convertCatalogMenuToSim(undefined, inventoryDefs)
  }
  const raw = Array.isArray(menuOpt)
    ? menuOpt
    : 'items' in menuOpt && Array.isArray(menuOpt.items)
      ? menuOpt.items
      : []
  if (raw.length === 0) {
    throw new Error('Menu cannot be empty')
  }
  const invIds = new Set(inventoryDefs.map(d => d.id))
  return raw.map((item, idx) => {
    if (!item.id) throw new Error(`Menu item[${idx}] missing id`)
    for (const ingId of Object.keys(item.ingredients ?? {})) {
      if (!invIds.has(ingId)) {
        throw new Error(`Missing inventory mapping for custom menu item '${item.id}': '${ingId}'`)
      }
    }
    return {
      ...item,
      prepSec: Math.max(0.5, Number.isFinite(item.prepSec) ? item.prepSec : 3.0),
      ingredients: { ...item.ingredients },
    }
  })
}

function resolveStepLabel(item: DrinkMenuItem, elapsed: number): string | null {
  if (!item.steps?.length) return null
  let acc = 0
  for (const s of item.steps) {
    acc += s.durationSec
    if (elapsed <= acc) return s.label
  }
  return item.steps[item.steps.length - 1]!.label
}

export function createDrinksSim(options: CreateDrinksSimOptions = {}): DrinksSim {
  const baseDefs: readonly InventoryItemDef[] = options.inventoryDefs?.length
    ? options.inventoryDefs
    : DEFAULT_INVENTORY_DEFS
  const menu = resolveMenu(options.menu, baseDefs)
  const menuById = new Map<string, DrinkMenuItem>(menu.map(item => [item.id, item]))
  const layout: DrinkShopLayout = options.anchors
    ? layoutFromShopAnchors(options.anchors)
    : createDrinksLayoutFixture(options.layout)
  validateLayoutForMenu(layout, menu)

  const rng = createSeededRng(options.seed)

  let simTimeSec = Number.isFinite(options.now) ? Number(options.now) : 0
  const hourOfFn = options.hourOf ?? ((t: number) => normalizeHour(10 + t / 3600))
  const open24h = Boolean(options.open24h)
  const rejectPlayerWhenClosed = Boolean(options.rejectPlayerWhenClosed)
  const autoRestockSupply = options.autoRestockSupply !== false
  const maxCustomers = Math.max(1, Math.min(MAX_CONCURRENT_CUSTOMERS, Math.floor(options.maxCustomers ?? MAX_CONCURRENT_CUSTOMERS)))
  const maxQueueLength = Math.max(1, Math.min(MAX_DOORWAY_QUEUE, Math.floor(options.maxQueueLength ?? MAX_DOORWAY_QUEUE)))
  const clerkCount = Math.max(2, Math.min(CLERK_PROFILES.length, Math.floor(options.clerkCount ?? 5)))
  const playerUnclaimedTimeoutSec = Math.max(15, options.playerUnclaimedTimeoutSec ?? 180)

  let accumulator = 0
  let nextCustSeq = 1
  let nextGroupSeq = 1
  let nextOrderSeq = 1
  let spawnBudget = 0
  let lastSupplierHourBucket = -1
  let totalRevenue = 0
  let totalArrivals = 0
  let totalOrdersCreated = 0
  let ordersCompleted = 0
  let ordersCancelled = 0
  let ordersCancelledByPlayer = 0
  let ordersAbandonedQueue = 0
  let ordersAbandonedWait = 0
  let ordersAbandonedUnclaimed = 0
  let restockCount = 0
  let tablesCleanedCount = 0
  let deadlockRecoveries = 0
  let peakConcurrentPeople = clerkCount
  const hourlyArrivals = new Array<number>(24).fill(0)
  const hourlyOrders = new Array<number>(24).fill(0)

  let playerPresence: PlayerPresenceInput | null = null
  let playerGreetCooldown = 0
  let cutInRemindCooldown = 0

  const inventory = new Map<string, InventoryBinState>()
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

  let minObservedInventory = Infinity
  function trackMinInventory(): void {
    for (const bin of inventory.values()) {
      if (bin.binAmount < minObservedInventory) minObservedInventory = bin.binAmount
      if (bin.backroomAmount < minObservedInventory) minObservedInventory = bin.backroomAmount
    }
  }
  trackMinInventory()

  const seats: InternalSeat[] = layout.seats.map(s => ({
    id: s.id,
    zone: s.zone,
    x: s.x,
    z: s.z,
    yaw: s.yaw,
    state: 'free',
    occupantId: null,
    dirtyCupColor: null,
    dirtySinceSec: 0,
    cleaningClerkId: null,
  }))
  const seatById = new Map<string, InternalSeat>(seats.map(s => [s.id, s]))

  const clerks: InternalClerk[] = []
  for (let i = 0; i < clerkCount; i++) {
    const profile = CLERK_PROFILES[i]!
    const homePos: DirectedSpot =
      i === 0
        ? layout.cashiers[0]!.clerkPos
        : i === 1
          ? layout.prepStations[0]!
          : i === 2
            ? layout.prepStations[2 % layout.prepStations.length]!
            : i === 3
              ? { x: 3.55, z: -1.35, yaw: 0 }
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
      waypoints: [],
      moveSpeed: 2.35,
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
      cleaningSeatId: null,
      restockStage: 'to_storage',
      holdingCup: false,
      holdingCupColor: null,
      holdingCrate: false,
      patrolIndex: i % layout.patrolPoints.length,
      actionLabel: '待命',
      activeStepLabel: null,
      pendingAfterWalk: null,
      interactionKind: null,
      interactionGesture: 'none',
      interactionTimer: 0,
      interactionTextVar: null,
      cashChangeText: null,
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

  function setClerkInteraction(
    clerk: InternalClerk,
    kind: InteractionBubbleKind | null,
    gesture: InteractionGesture,
    durationSec = 1.6,
    textVar: string | null = null,
  ): void {
    clerk.interactionKind = kind
    clerk.interactionGesture = gesture
    clerk.interactionTimer = durationSec
    clerk.interactionTextVar = textVar
  }

  function setCustomerInteraction(
    cust: InternalCustomer,
    kind: InteractionBubbleKind | null,
    gesture: InteractionGesture,
    durationSec = 1.6,
    textVar: string | null = null,
  ): void {
    cust.interactionKind = kind
    cust.interactionGesture = gesture
    cust.interactionTimer = durationSec
    cust.interactionTextVar = textVar
  }

  function releaseClerkClaims(clerk: InternalClerk): void {
    if (clerk.targetBinId) {
      const bin = inventory.get(clerk.targetBinId)
      if (bin) bin.restocking = false
    }
    if (clerk.cleaningSeatId) {
      const seat = seatById.get(clerk.cleaningSeatId)
      if (seat && seat.cleaningClerkId === clerk.id) {
        seat.cleaningClerkId = null
      }
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
    clerk.cleaningSeatId = null
    clerk.holdingCup = false
    clerk.holdingCupColor = null
    clerk.holdingCrate = false
    clerk.pendingAfterWalk = null
    clerk.taskElapsedSec = 0
    clerk.actionTimer = 0
    clerk.activeStepLabel = null
    clerk.cashChangeText = null
    if (clerk.interactionTimer <= 0) {
      clerk.interactionKind = null
      clerk.interactionGesture = 'none'
      clerk.interactionTextVar = null
    }
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

  function countTotalQueue(): number {
    let n = 0
    for (const c of customers) {
      if (c.phase === 'queuing' || c.phase === 'ordering') n++
    }
    return n
  }

  function getQueuePosition(cashierIndex: number, slot: number): Point2D {
    const lane = layout.cashiers[cashierIndex] ?? layout.cashiers[0]!
    const stagger = slot === 0 ? 0 : slot % 2 === 1 ? -0.24 : 0.24
    const maxQueueZ = layout.entrance.z - 0.65
    return {
      x: lane.queueAnchor.x + lane.queueDir.x * slot + stagger,
      z: Math.min(maxQueueZ, lane.queueAnchor.z + lane.queueDir.z * slot),
    }
  }

  function routeCustomerWaypoints(fromX: number, fromZ: number, toX: number, toZ: number): Point2D[] {
    const doorX = layout.entrance.x
    const doorZ = layout.entrance.z
    const clearX = Math.max(doorX - 0.28, Math.min(doorX + 0.28, doorX + (toX - doorX) * 0.15))
    const outZ = doorZ + 1.35 // 4.15m: safely past open outward glass door leaves (z <= 3.73)
    const inZ = doorZ - 0.58 // 2.22m: safely inside behind doorway sill
    const wps: Point2D[] = []

    const fromOutside = fromZ > doorZ + 0.15
    const toOutside = toZ > doorZ + 0.15
    const isFromPatioSeat = fromOutside && fromZ < 4.0 && Math.abs(fromX - doorX) > 1.3
    const isToPatioSeat = toOutside && toZ < 4.0 && Math.abs(toX - doorX) > 1.3

    if (fromOutside && !toOutside) {
      if (isFromPatioSeat) {
        const outerX = fromX < doorX ? fromX - 0.85 : fromX + 0.85
        wps.push({ x: outerX, z: 4.85 })
      }
      wps.push({ x: clearX, z: outZ })
      wps.push({ x: clearX, z: inZ })
    } else if (!fromOutside && toOutside) {
      wps.push({ x: clearX, z: inZ })
      wps.push({ x: clearX, z: outZ })
      if (isToPatioSeat) {
        const outerX = toX < doorX ? toX - 0.85 : toX + 0.85
        wps.push({ x: outerX, z: 4.85 })
        wps.push({ x: outerX, z: toZ })
      } else {
        wps.push({ x: clearX, z: doorZ + 2.05 })
      }
    }

    wps.push({ x: toX, z: toZ })
    return wps
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
          c.waypoints = routeCustomerWaypoints(c.x, c.z, pos.x, pos.z)
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

  function pickFreeSeat(): InternalSeat | null {
    const free = seats.filter(s => s.state === 'free')
    if (!free.length) return null
    return rng.pick(free, free[0]!)
  }

  function releaseCustomerSeat(c: InternalCustomer): void {
    if (!c.seatId) return
    const seat = seatById.get(c.seatId)
    c.seatId = null
    if (!seat) return
    if (seat.occupantId === c.id) {
      seat.occupantId = null
      if (c.holdingCup && seat.state === 'occupied') {
        seat.state = 'dirty'
        seat.dirtyCupColor = c.cupColor || '#f6df6e'
        seat.dirtySinceSec = simTimeSec
      } else {
        seat.state = 'free'
        seat.dirtyCupColor = null
      }
    }
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
      activeStepLabel: opts.item.steps?.[0]?.label ?? null,
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
      else if (nextStatus === 'cancelled_by_player') ordersCancelledByPlayer++
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
    releaseCustomerSeat(c)
    c.phase = 'leaving'
    c.angry = angry
    c.cameraProp = false
    c.waitingSpotIndex = -1
    c.cashierIndex = -1
    c.queueSlot = -1
    const exitApproach = c.leaveSide < 0 ? layout.approachLeft : layout.approachRight
    const exitZ = exitApproach.z + rng.range(-0.2, 0.2)
    c.waypoints = routeCustomerWaypoints(c.x, c.z, exitApproach.x, exitZ)
    if (angry && c.waypoints.length > 0) {
      c.yaw = yawBetween(c.x, c.z, c.waypoints[0]!.x, c.waypoints[0]!.z)
    }
    c.finalYaw = null
    refreshQueuePositions()
  }

  function createSingleCustomer(
    hour: number,
    roleKind: CustomerRoleKind,
    side: -1 | 1,
    offsetZ: number,
    groupId: string | null,
    partnerId: string | null,
  ): InternalCustomer {
    const pal = ROLE_PALETTES[roleKind]
    const spawnBase = side < 0 ? layout.approachLeft : layout.approachRight
    const menuSlot = rng.pick(layout.menuBoardSlots, layout.menuBoardSlots[0]!)
    const patienceMax = rng.range(pal.patience[0], pal.patience[1])
    const desiredItem = pickMenuPreference(roleKind, hour)
    const id = `cust_${nextCustSeq++}`
    const name = `${rng.pick(SURNAMES, '陈')}${rng.pick(ROLE_TITLES[roleKind], '顾客')}`
    const spawnX = spawnBase.x
    const spawnZ = spawnBase.z + offsetZ
    const targetX = menuSlot.x + rng.range(-0.18, 0.18)
    const targetZ = menuSlot.z + rng.range(-0.12, 0.12)

    const cust: InternalCustomer = {
      id,
      name,
      roleKind,
      phase: 'entering',
      x: spawnX,
      z: spawnZ,
      yaw: side < 0 ? Math.PI * 0.5 : -Math.PI * 0.5,
      speed: 0,
      moveSpeed: rng.range(pal.speed[0], pal.speed[1]),
      waypoints: routeCustomerWaypoints(spawnX, spawnZ, targetX, targetZ),
      finalYaw: menuSlot.yaw,
      stateTimer: 0,
      stateDuration: rng.range(2.0, 4.0),
      patienceSec: patienceMax,
      patienceMaxSec: patienceMax,
      cashierIndex: -1,
      queueSlot: -1,
      seatId: null,
      waitingSpotIndex: -1,
      waitingOrderId: null,
      desiredItemId: desiredItem.id,
      groupId,
      chatPartnerId: partnerId,
      holdingCup: false,
      cupDrinkId: null,
      cupColor: null,
      cameraProp: false,
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
      interactionKind: null,
      interactionGesture: 'none',
      interactionTimer: 0,
      interactionTextVar: null,
      urgedOnce: false,
      tookPhotoOnce: false,
      chatCooldown: rng.range(1.5, 4.0),
      yieldCooldown: 0,
      complainHoldTimer: 0,
      handoverHoldTimer: 0,
      chatHoldTimer: 0,
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
    return cust
  }

  function spawnCustomerOrPair(hour: number, roleWeights: Record<CustomerRoleKind, number>): void {
    if (customers.length >= maxCustomers) return
    const roles: CustomerRoleKind[] = ['student', 'office', 'tourist', 'local', 'rider']
    const weights = roles.map(r => roleWeights[r] ?? 1)
    const roleKind = rng.weightedPick(roles, weights, 'student')
    const side: -1 | 1 = rng.next() < 0.5 ? -1 : 1

    const canPair =
      (roleKind === 'student' || roleKind === 'tourist' || roleKind === 'local') &&
      customers.length + 2 <= maxCustomers &&
      rng.next() < 0.34

    if (canPair) {
      const groupId = `grp_${nextGroupSeq++}`
      const a = createSingleCustomer(hour, roleKind, side, -0.25, groupId, null)
      const b = createSingleCustomer(hour, roleKind, side, 0.35, groupId, a.id)
      a.chatPartnerId = b.id
      b.wantsSeat = true
    } else {
      createSingleCustomer(hour, roleKind, side, rng.range(-0.35, 0.35), null, null)
    }
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

  function buildClerkWalkWaypoints(fromX: number, fromZ: number, toX: number, toZ: number): Point2D[] {
    const wps: Point2D[] = []
    const counterMinX = -3.7
    const counterMaxX = 4.1
    const counterZ = -0.38
    const doorX = layout.entrance.x
    const doorZ = layout.entrance.z

    let curX = fromX
    let curZ = fromZ

    // Crossing from outside patio back inside -> route through open doorway clear of door leaves & tables
    if (curZ > doorZ + 0.15 && toZ < doorZ - 0.15) {
      if (curZ < 4.0 && Math.abs(curX - doorX) > 1.3) {
        wps.push({ x: curX < doorX ? curX - 0.85 : curX + 0.85, z: 4.85 })
      }
      wps.push({ x: doorX, z: doorZ + 1.35 })
      wps.push({ x: doorX, z: doorZ - 0.58 })
      curX = doorX
      curZ = doorZ - 0.58
    }

    // Crossing front service counter -> route cleanly around nearest open end (-4.25 or +4.45)
    if ((curZ < counterZ && toZ > counterZ) || (curZ > counterZ && toZ < counterZ)) {
      const goWest = toX < 0 || (curZ > counterZ && curX < 0)
      const passX = goWest ? counterMinX - 0.55 : counterMaxX + 0.4
      wps.push({ x: passX, z: curZ < counterZ ? -0.95 : 0.25 })
      wps.push({ x: passX, z: toZ > counterZ ? 0.25 : -0.95 })
      curX = passX
      curZ = toZ > counterZ ? 0.25 : -0.95
    }

    // Crossing from indoor hall out to patio -> route through open doorway clear of door leaves & tables
    if (curZ < doorZ - 0.15 && toZ > doorZ + 0.15) {
      wps.push({ x: doorX, z: doorZ - 0.58 })
      wps.push({ x: doorX, z: doorZ + 1.35 })
      if (toZ < 4.0 && Math.abs(toX - doorX) > 1.3) {
        const outerX = toX < doorX ? toX - 0.85 : toX + 0.85
        wps.push({ x: outerX, z: 4.85 })
        wps.push({ x: outerX, z: toZ })
      }
    }

    wps.push({ x: toX, z: toZ })
    return wps
  }

  function startClerkWalk(clerk: InternalClerk, x: number, z: number, yaw: number, nextState: ClerkState, label: string): void {
    clerk.targetX = x
    clerk.targetZ = z
    clerk.targetYaw = yaw
    clerk.waypoints = buildClerkWalkWaypoints(clerk.x, clerk.z, x, z)
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

  function findDirtySeat(): InternalSeat | null {
    for (const seat of seats) {
      if (seat.state === 'dirty' && !seat.cleaningClerkId) {
        return seat
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
        if (dist <= 0.55) {
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
    const dirtySeat = findDirtySeat()

    const assignRestock = (bin: InventoryBinState): boolean => {
      bin.restocking = true
      clerk.targetBinId = bin.id
      clerk.restockStage = 'to_storage'
      clerk.holdingCrate = false
      setClerkInteraction(clerk, 'restock', 'none', 1.4, bin.name)
      startClerkWalk(clerk, layout.storagePos.x, layout.storagePos.z, layout.storagePos.yaw, 'restocking', `补料·${bin.name}`)
      return true
    }

    const assignCashier = (work: { customer: InternalCustomer; laneIdx: number }): boolean => {
      const lane = layout.cashiers[work.laneIdx]!
      clerk.activeCustomerId = work.customer.id
      clerk.targetCashierIndex = work.laneIdx
      clerk.actionDuration = rng.range(2.4, 3.2)
      clerk.actionTimer = 0
      const custItem = (work.customer.desiredItemId && menuById.get(work.customer.desiredItemId)) || menu[0]!
      const payBill = custItem.price <= 5 ? 10 : 20
      clerk.cashChangeText = payBill > custItem.price ? `¥${payBill - custItem.price}` : '扫码'
      work.customer.phase = 'ordering'
      work.customer.speed = 0
      work.customer.yaw = lane.customerPos.yaw
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
      clerk.activeStepLabel = ord.item.steps?.[0]?.label ?? null
      startClerkWalk(clerk, station.x, station.z, station.yaw, 'making', `制作·${ord.item.name}`)
      return true
    }

    const assignCleanTable = (seat: InternalSeat): boolean => {
      seat.cleaningClerkId = clerk.id
      clerk.cleaningSeatId = seat.id
      clerk.actionDuration = 1.6
      clerk.actionTimer = 0
      const standX = seat.x - Math.sin(seat.yaw) * 0.25
      const standZ = seat.z - Math.cos(seat.yaw) * 0.25
      startClerkWalk(clerk, standX, standZ, seat.yaw, 'cleaning_table', '收桌')
      return true
    }

    const findNearestDirtySeat = (indoorOnly: boolean): InternalSeat | null => {
      for (const s of seats) {
        if (s.state === 'dirty' && !s.cleaningClerkId && (!indoorOnly || s.zone === 'indoor')) return s
      }
      return null
    }

    if (clerk.role === 'cashier') {
      if (cashierWork && assignCashier(cashierWork)) return
      if (prepWork && assignMake(prepWork)) return
      if (needBin && assignRestock(needBin)) return
      const indoorDirty = findNearestDirtySeat(true)
      if (indoorDirty && assignCleanTable(indoorDirty)) return
    } else if (clerk.role === 'maker') {
      if (prepWork && assignMake(prepWork)) return
      if (cashierWork && assignCashier(cashierWork)) return
      if (needBin && assignRestock(needBin)) return
    } else if (clerk.role === 'runner') {
      if (prepWork && assignMake(prepWork)) return
      if (dirtySeat && assignCleanTable(dirtySeat)) return
      if (needBin && assignRestock(needBin)) return
      if (cashierWork && assignCashier(cashierWork)) return
    } else {
      if (needBin && assignRestock(needBin)) return
      if (dirtySeat && assignCleanTable(dirtySeat)) return
      if (prepWork && assignMake(prepWork)) return
      if (cashierWork && assignCashier(cashierWork)) return
    }

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

    if (clerk.role === 'patrol' || rng.next() < 0.08) {
      clerk.patrolIndex = (clerk.patrolIndex + 1) % layout.patrolPoints.length
      const pt = layout.patrolPoints[clerk.patrolIndex]!
      clerk.actionDuration = rng.range(1.5, 2.8)
      clerk.actionTimer = 0
      startClerkWalk(clerk, pt.x, pt.z, pt.yaw, 'patrolling', '巡台')
    }
  }

  function stepClerks(dt: number): void {
    for (const clerk of clerks) {
      if (clerk.interactionTimer > 0) {
        clerk.interactionTimer = Math.max(0, clerk.interactionTimer - dt)
        if (clerk.interactionTimer === 0) {
          clerk.interactionKind = null
          clerk.interactionGesture = 'none'
          clerk.interactionTextVar = null
        }
      }

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
        const wp = clerk.waypoints[0] ?? { x: clerk.targetX, z: clerk.targetZ }
        const arrived = moveEntityToward(clerk, wp.x, wp.z, clerk.moveSpeed, dt)
        if (arrived) {
          if (clerk.waypoints.length > 0) clerk.waypoints.shift()
          if (clerk.waypoints.length === 0) {
            clerk.yaw = clerk.targetYaw
            const nextState = clerk.pendingAfterWalk ?? 'idle'
            clerk.pendingAfterWalk = null
            clerk.state = nextState
            clerk.actionTimer = 0
            if (nextState === 'taking_order' && clerk.activeCustomerId) {
              const cust = customers.find(c => c.id === clerk.activeCustomerId)
              if (cust && cust.phase === 'ordering') {
                const custItem = (cust.desiredItemId && menuById.get(cust.desiredItemId)) || menu[0]!
                setClerkInteraction(clerk, 'order_ask', 'talk', 1.5)
                setCustomerInteraction(cust, 'order_reply', 'talk', 1.5, custItem.name)
              }
            }
          }
        }
        continue
      }

      if (clerk.state === 'patrolling') {
        clerk.speed = 0
        clerk.actionTimer += dt
        if (findWaitingCashierCustomer() || findClaimableQueuedOrder() || findNeededRestockBin() || findDirtySeat()) {
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

      if (clerk.state === 'cleaning_table') {
        clerk.speed = 0
        const seat = clerk.cleaningSeatId ? seatById.get(clerk.cleaningSeatId) : undefined
        if (!seat || seat.state !== 'dirty') {
          releaseClerkClaims(clerk)
          clerk.state = 'idle'
          continue
        }
        setClerkInteraction(clerk, 'clean_table', 'clean_wipe', 0.4)
        clerk.actionTimer += dt
        if (clerk.actionTimer >= clerk.actionDuration) {
          seat.state = 'free'
          seat.dirtyCupColor = null
          seat.occupantId = null
          seat.cleaningClerkId = null
          tablesCleanedCount++
          emitEvent({
            type: 'table_cleaned',
            timeSec: simTimeSec,
            clerkId: clerk.id,
            detail: seat.id,
          })
          releaseClerkClaims(clerk)
          clerk.state = 'idle'
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
        const halfDur = clerk.actionDuration * 0.5
        if (clerk.actionTimer < halfDur && clerk.actionTimer + dt >= halfDur) {
          setClerkInteraction(clerk, 'make_change', 'give_change', halfDur + 0.3, clerk.cashChangeText)
          setCustomerInteraction(cust, 'receive_change', 'receive_change', halfDur + 0.3)
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
        ord.activeStepLabel = resolveStepLabel(ord.item, ord.prepElapsedSec)
        clerk.activeStepLabel = ord.activeStepLabel
        if (!clerk.interactionKind) {
          setClerkInteraction(clerk, 'making', 'none', 0.6)
        }

        if (ord.prepElapsedSec >= ord.prepDurationSec) {
          if (ord.source === 'npc') {
            const cust = customers.find(c => c.id === ord.customerId)
            if (!cust || cust.phase === 'leaving') {
              finishOrder(ord, 'abandoned_unclaimed')
              releaseClerkClaims(clerk)
              clerk.state = 'idle'
              continue
            }
          }
          const slot = layout.pickupSlots[ord.pickupSlotIndex >= 0 ? ord.pickupSlotIndex : 0] ?? layout.pickupSlots[0]!
          let callX = Math.max(1.35, Math.min(3.55, (layout.pickupClerkPos.x + slot.x) * 0.5))
          for (const other of clerks) {
            if (other.id === clerk.id) continue
            const ox = other.state === 'walking' ? other.targetX : other.x
            const oz = other.state === 'walking' ? other.targetZ : other.z
            if (Math.hypot(callX - ox, layout.pickupClerkPos.z - oz) < 0.9) {
              callX = callX < 2.4 ? Math.min(3.55, ox + 0.95) : Math.max(1.35, ox - 0.95)
            }
          }
          clerk.holdingCup = true
          clerk.holdingCupColor = ord.item.cupColor
          startClerkWalk(
            clerk,
            callX,
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
        if (!ord || isTerminalOrderStatus(ord.status)) {
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
          clerk.holdingCup = true
          clerk.holdingCupColor = ord.item.cupColor
          setClerkInteraction(clerk, 'call_number', 'greet_wave', 0.9, ord.ticketNo)
          emitEvent({
            type: 'order_called',
            timeSec: simTimeSec,
            orderId: ord.id,
            ticketNo: ord.ticketNo,
            customerId: ord.customerId,
            clerkId: clerk.id,
            itemName: ord.item.name,
          })
          // Wake customer immediately for look-up animation
          const waitCust = customers.find(c => c.waitingOrderId === ord.id)
          if (waitCust && waitCust.phase === 'waiting_pickup') {
            waitCust.yaw = yawBetween(waitCust.x, waitCust.z, layout.pickupClerkPos.x, layout.pickupClerkPos.z)
            setCustomerInteraction(waitCust, 'look_up_called', 'look_up', 0.85)
          }
        }
        if (clerk.actionTimer >= 0.6 && clerk.actionTimer - dt < 0.6) {
          setClerkInteraction(clerk, 'handover_cup', 'handover_cup', 0.95, ord.item.name)
        }
        clerk.actionTimer += dt
        if (clerk.actionTimer >= 1.45) {
          clerk.holdingCup = false
          clerk.holdingCupColor = null
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
        setClerkInteraction(clerk, 'restock', 'none', 0.5, bin.name)
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

  function stepPairAndSocialInteractions(dt: number): void {
    for (const c of customers) {
      if (c.interactionTimer > 0) {
        c.interactionTimer = Math.max(0, c.interactionTimer - dt)
        if (c.interactionTimer === 0) {
          c.interactionKind = null
          c.interactionGesture = 'none'
          c.interactionTextVar = null
          c.cameraProp = false
        }
      }
      if (c.chatCooldown > 0) c.chatCooldown = Math.max(0, c.chatCooldown - dt)
      if (c.yieldCooldown > 0) c.yieldCooldown = Math.max(0, c.yieldCooldown - dt)
    }

    // Pair chatting when two partners are stationary near each other in same zone
    for (const a of customers) {
      if (!a.chatPartnerId || a.chatCooldown > 0 || a.interactionTimer > 0) continue
      if (a.phase === 'entering' || a.phase === 'ordering' || a.phase === 'leaving' || a.phase === 'picking_up') continue
      if (a.waypoints.length > 0) continue
      const b = customers.find(x => x.id === a.chatPartnerId)
      if (!b || b.waypoints.length > 0) continue
      if (b.phase === 'entering' || b.phase === 'ordering' || b.phase === 'leaving' || b.phase === 'picking_up') continue
      const sameZone = (a.z < layout.entrance.z - 0.3 && b.z < layout.entrance.z - 0.3) || (a.z > layout.entrance.z + 1.1 && b.z > layout.entrance.z + 1.1)
      if (!sameZone) continue
      const d = Math.hypot(a.x - b.x, a.z - b.z)
      if (d >= 0.55 && d <= 2.15) {
        a.yaw = yawBetween(a.x, a.z, b.x, b.z)
        b.yaw = yawBetween(b.x, b.z, a.x, a.z)
        a.chatHoldTimer = 2.0
        b.chatHoldTimer = 2.0
        setCustomerInteraction(a, 'chat_pair_a', 'chat_nod', 2.4)
        setCustomerInteraction(b, 'chat_pair_b', 'chat_nod', 2.4)
        a.chatCooldown = 8
        b.chatCooldown = 8
      }
    }
  }

  function stepPlayerInteractions(): void {
    if (!playerPresence || !playerPresence.active) return
    const px = playerPresence.x
    const pz = playerPresence.z
    const nearRadius = playerPresence.nearRadius ?? 4.8

    // 1. Clerk greets player when approaching shop entrance/counter (prefer free/closest front clerk)
    const shopCenterX = layout.entrance.x
    const shopCenterZ = (layout.entrance.z + layout.cashiers[0]!.customerPos.z) * 0.5
    const distShop = Math.hypot(px - shopCenterX, pz - shopCenterZ)
    if (distShop <= nearRadius && playerGreetCooldown <= 0) {
      let bestClerk: InternalClerk | null = null
      let bestScore = Infinity
      for (const cl of clerks) {
        const d = Math.hypot(cl.x - px, cl.z - pz)
        const statePenalty = cl.state === 'idle' || cl.state === 'patrolling' ? 0 : cl.state === 'taking_order' ? 1.5 : 3.0
        const score = d + statePenalty
        if (score < bestScore) {
          bestScore = score
          bestClerk = cl
        }
      }
      if (bestClerk) {
        bestClerk.yaw = yawBetween(bestClerk.x, bestClerk.z, px, pz)
        setClerkInteraction(bestClerk, 'clerk_greet_player', 'greet_wave', 2.8)
        playerGreetCooldown = 10
        emitEvent({
          type: 'player_greeted',
          timeSec: simTimeSec,
          clerkId: bestClerk.id,
        })
      }
    }

    // 2. Cut-in reminder if player stands right in front of an occupied cashier queue
    if (cutInRemindCooldown <= 0) {
      for (let laneIdx = 0; laneIdx < layout.cashiers.length; laneIdx++) {
        const lane = layout.cashiers[laneIdx]!
        const dCashier = Math.hypot(px - lane.customerPos.x, pz - lane.customerPos.z)
        if (dCashier <= 1.15) {
          const laneQueued = customers.filter(c => c.phase === 'queuing' && c.cashierIndex === laneIdx)
          if (laneQueued.length >= 1) {
            const firstQueuer = laneQueued[0]!
            firstQueuer.yaw = yawBetween(firstQueuer.x, firstQueuer.z, px, pz)
            setCustomerInteraction(firstQueuer, 'remind_cut_in', 'remind_gesture', 2.2)
            cutInRemindCooldown = 7
            emitEvent({
              type: 'player_cut_in_reminded',
              timeSec: simTimeSec,
              customerId: firstQueuer.id,
            })
            break
          }
        }
      }
    }

    // 3. Queuing/standing NPCs yield space smoothly when player walks close
    for (const c of customers) {
      if (c.phase !== 'queuing' && c.phase !== 'waiting_pickup') continue
      const dx = c.x - px
      const dz = c.z - pz
      const dist = Math.hypot(dx, dz)
      if (dist > 0.05 && dist < 1.55 && c.yieldCooldown <= 0) {
        const sidePush = 0.36
        const nx = dx / dist
        const nz = dz / dist
        c.x += nx * sidePush
        c.z = Math.max(0.05, c.z + nz * sidePush)
        c.yaw = yawBetween(c.x, c.z, px, pz)
        setCustomerInteraction(c, 'queue_yield_player', 'yield_step', 2.0)
        c.yieldCooldown = 4.5
      }
    }
  }

  function stepCustomers(dt: number, isOpen: boolean): void {
    for (let i = customers.length - 1; i >= 0; i--) {
      const c = customers[i]!

      if (c.complainHoldTimer > 0) {
        c.complainHoldTimer = Math.max(0, c.complainHoldTimer - dt)
        c.speed = 0
        if (c.complainHoldTimer === 0) {
          sendCustomerLeaving(c, true)
        }
        continue
      }

      if (c.chatHoldTimer > 0) {
        c.chatHoldTimer = Math.max(0, c.chatHoldTimer - dt)
        c.speed = 0
        continue
      }

      if (c.handoverHoldTimer > 0) {
        c.handoverHoldTimer = Math.max(0, c.handoverHoldTimer - dt)
        c.speed = 0
        if (c.handoverHoldTimer > 0) continue
      }

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
          // Tourists sometimes snap a quick facade photo while browsing
          if (c.roleKind === 'tourist' && !c.tookPhotoOnce && rng.next() < 0.45) {
            c.tookPhotoOnce = true
            c.cameraProp = true
            setCustomerInteraction(c, 'take_photo', 'take_photo', 2.0)
          }
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
          const totalQueue = countTotalQueue()
          const maxPerLane = Math.max(1, Math.ceil(maxQueueLength / Math.max(1, layout.cashiers.length)))
          if (totalQueue >= maxQueueLength || laneLen >= maxPerLane) {
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
          c.x += c.x < 0 ? 0.68 : -0.68
          sendCustomerLeaving(c, true)
          setCustomerInteraction(c, 'complain_leave', 'angry_stamp', 2.4)
        }
        continue
      }

      if (c.phase === 'ordering') {
        continue
      }

      if (c.phase === 'waiting_pickup') {
        const ord = c.waitingOrderId ? ordersById.get(c.waitingOrderId) : undefined
        if (!ord || ord.status === 'cancelled_out_of_stock' || ord.status === 'cancelled_by_player') {
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
        const ratio = c.patienceSec / Math.max(1, c.patienceMaxSec)
        if (ratio < 0.58 && !c.urgedOnce && c.waypoints.length === 0) {
          c.urgedOnce = true
          c.yaw = yawBetween(c.x, c.z, layout.pickupClerkPos.x, layout.pickupClerkPos.z)
          setCustomerInteraction(c, 'urge_order', 'urge_wave', 2.0)
          const maker = clerks.find(cl => cl.state === 'making' || cl.role === 'maker')
          if (maker && maker.interactionTimer <= 0) {
            setClerkInteraction(maker, 'clerk_reassure', 'talk', 1.4)
          }
        }
        if (c.patienceSec <= 0 && ord.status === 'queued') {
          finishOrder(ord, 'abandoned_wait')
          c.x += c.x < layout.entrance.x ? 0.55 : -0.55
          sendCustomerLeaving(c, true)
          setCustomerInteraction(c, 'complain_leave', 'angry_stamp', 2.4)
        }
        continue
      }

      if (c.phase === 'picking_up') {
        if (c.waypoints.length > 0) continue
        const ord = c.waitingOrderId ? ordersById.get(c.waitingOrderId) : undefined
        if (ord && ord.status === 'ready_for_pickup') {
          // Handover pause so 递杯 & 接杯 gesture is clearly rendered before leaving pickup
          if (!c.holdingCup) {
            finishOrder(ord, 'completed')
            c.holdingCup = true
            c.cupDrinkId = ord.item.id
            c.cupColor = ord.item.cupColor
            c.sipsLeft = ord.item.sipsCount ?? 4
            c.sipProgress = 0
            c.yaw = yawBetween(c.x, c.z, layout.pickupClerkPos.x, layout.pickupClerkPos.z)
            setCustomerInteraction(c, 'receive_cup', 'receive_cup', 1.1)
            c.handoverHoldTimer = 0.75
            continue
          }
        }
        c.waitingOrderId = null
        if (!c.tookPhotoOnce && (c.roleKind === 'tourist' || c.roleKind === 'student') && rng.next() < 0.25) {
          c.tookPhotoOnce = true
          c.cameraProp = true
          setCustomerInteraction(c, 'take_photo', 'take_photo', 2.0)
        }
        const freeSeat = c.wantsSeat ? pickFreeSeat() : null
        if (freeSeat) {
          freeSeat.state = 'reserved'
          freeSeat.occupantId = c.id
          c.phase = 'claiming_seat'
          c.seatId = freeSeat.id
          c.waypoints = routeCustomerWaypoints(c.x, c.z, freeSeat.x, freeSeat.z)
          c.finalYaw = freeSeat.yaw
          setCustomerInteraction(c, 'claim_seat', 'claim_wave', 1.6)
        } else {
          sendCustomerLeaving(c, false)
        }
        continue
      }

      if (c.phase === 'claiming_seat') {
        if (c.waypoints.length > 0) continue
        const seat = c.seatId ? seatById.get(c.seatId) : undefined
        if (!seat) {
          sendCustomerLeaving(c, false)
          continue
        }
        seat.state = 'occupied'
        c.phase = 'seated'
        c.stateTimer = 0
        c.stateDuration = rng.range(16, 30)
        setCustomerInteraction(c, 'claim_seat', 'claim_wave', 1.1)
        continue
      }

      if (c.phase === 'seated') {
        if (c.waypoints.length > 0) continue
        c.stateTimer += dt
        const totalSips = Math.max(1, c.sipsLeft || 4)
        const ratio = Math.min(1, c.stateTimer / Math.max(1, c.stateDuration))
        c.sipProgress = (c.stateTimer * 0.45) % 1
        c.sipsLeft = Math.max(0, Math.ceil((1 - ratio) * totalSips))
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

  function applyClerkSeparation(dt: number): void {
    const minSep = 0.88
    const minSepSq = minSep * minSep
    const pushRate = Math.min(1, 6.5 * dt)
    const applyPush = (cl: InternalClerk, px: number, pz: number) => {
      const clampBack = (cl.state === 'idle' || cl.state === 'patrolling') || (cl.pendingAfterWalk !== 'cleaning_table' && cl.z <= -0.75)
      cl.x += px
      cl.z = clampBack ? Math.min(-0.78, cl.z + pz) : cl.z + pz
    }
    for (let i = 0; i < clerks.length; i++) {
      const a = clerks[i]!
      for (let j = i + 1; j < clerks.length; j++) {
        const b = clerks[j]!
        const dx = b.x - a.x
        const dz = b.z - a.z
        const dSq = dx * dx + dz * dz
        if (dSq < minSepSq) {
          const dist = Math.sqrt(dSq)
          const nx = dist > 1e-4 ? dx / dist : 1
          const nz = dist > 1e-4 ? dz / dist : 0
          const overlap = (minSep - dist) * pushRate
          const aMovable = a.state === 'idle' || a.state === 'patrolling' || (a.state === 'walking' && a.z <= -0.75)
          const bMovable = b.state === 'idle' || b.state === 'patrolling' || (b.state === 'walking' && b.z <= -0.75)
          if (aMovable && bMovable) {
            applyPush(a, -nx * overlap * 0.5, -nz * overlap * 0.5)
            applyPush(b, nx * overlap * 0.5, nz * overlap * 0.5)
          } else if (aMovable) {
            applyPush(a, -nx * overlap, -nz * overlap)
          } else if (bMovable) {
            applyPush(b, nx * overlap, nz * overlap)
          }
        }
      }
    }
  }

  function applyCustomerSeparation(dt: number): void {
    const minSep = 0.86
    const minSepSq = minSep * minSep
    const pushRate = 4.2 * dt
    const doorX = layout.entrance.x
    const doorZ = layout.entrance.z
    const clampCustomerWall = (c: InternalCustomer) => {
      if (c.z < -0.02) c.z = -0.02
      const inDoorOpening = c.x >= doorX - 0.52 && c.x <= doorX + 0.52
      if (!inDoorOpening && Math.abs(c.z - doorZ) < 0.34) {
        c.z = c.z < doorZ ? doorZ - 0.34 : doorZ + 0.34
      }
    }
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
            clampCustomerWall(a)
          }
          if (b.phase !== 'ordering') {
            b.x += nx * overlap
            b.z += nz * overlap
            clampCustomerWall(b)
          }
          // Head-on yield gesture when two moving walkers meet
          if (a.speed > 0.25 && b.speed > 0.25 && a.yieldCooldown <= 0 && b.yieldCooldown <= 0) {
            const dot = Math.sin(a.yaw) * Math.sin(b.yaw) + Math.cos(a.yaw) * Math.cos(b.yaw)
            if (dot < -0.15) {
              b.x += -nz * 0.24
              b.z += nx * 0.24
              clampCustomerWall(b)
              setCustomerInteraction(b, 'yield_way', 'yield_step', 1.0)
              b.yieldCooldown = 4.5
              a.yieldCooldown = 4.5
            }
          }
        }
      }
    }
  }

  function stepUnclaimedOrders(): void {
    for (let oi = activeOrdersList.length - 1; oi >= 0; oi--) {
      const ord = activeOrdersList[oi]!
      if (ord.status !== 'ready_for_pickup' || ord.readyAtSec === null) continue
      const timeout = ord.source === 'player' ? playerUnclaimedTimeoutSec : 120
      if (simTimeSec - ord.readyAtSec >= timeout) {
        finishOrder(ord, 'abandoned_unclaimed')
        const cust = customers.find(c => c.id === ord.customerId)
        if (cust && cust.phase !== 'leaving') {
          sendCustomerLeaving(cust, true)
        }
      }
    }
  }

  function stepStaleDirtySeats(): void {
    for (const seat of seats) {
      if (seat.state === 'dirty' && !seat.cleaningClerkId && simTimeSec - seat.dirtySinceSec > 28) {
        seat.state = 'free'
        seat.dirtyCupColor = null
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
    if (playerGreetCooldown > 0) playerGreetCooldown = Math.max(0, playerGreetCooldown - dt)
    if (cutInRemindCooldown > 0) cutInRemindCooldown = Math.max(0, cutInRemindCooldown - dt)

    const hour = currentHour()
    const traffic = getDrinksTrafficProfile(hour, open24h)
    maybeScheduledSupplierDelivery(hour)

    if (traffic.isOpen) {
      const nonLeavingCount = customers.filter(c => c.phase !== 'leaving').length
      const rateScale = nonLeavingCount < traffic.targetCustomers ? 1.85 : 0.35
      spawnBudget += (traffic.arrivalsPerMin / 60) * dt * rateScale
      while (spawnBudget >= 1) {
        spawnBudget -= 1
        spawnCustomerOrPair(hour, traffic.roleWeights)
      }
    } else {
      spawnBudget = 0
    }

    stepClerks(dt)
    applyClerkSeparation(dt)
    stepCustomers(dt, traffic.isOpen)
    stepPairAndSocialInteractions(dt)
    stepPlayerInteractions()
    applyCustomerSeparation(dt)
    stepUnclaimedOrders()
    stepStaleDirtySeats()

    const totalPeople = clerks.length + customers.length
    if (totalPeople > peakConcurrentPeople) {
      peakConcurrentPeople = totalPeople
    }
  }

  function computeQueuePositionMap(): Map<string, number> {
    const posMap = new Map<string, number>()
    let pos = 1
    for (const ord of activeOrdersList) {
      if (ord.status === 'queued' || ord.status === 'preparing') {
        posMap.set(ord.id, pos++)
      }
    }
    return posMap
  }

  function toOrderSnapshot(ord: InternalOrder, queuePosMap?: Map<string, number>): OrderSnapshot {
    const qPos = queuePosMap ? queuePosMap.get(ord.id) ?? 0 : ord.status === 'queued' || ord.status === 'preparing' ? 1 : 0
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
      queuePosition: qPos,
      stationId: ord.stationId,
      clerkId: ord.clerkId,
      pickupSlotIndex: ord.pickupSlotIndex,
      progress:
        ord.status === 'ready_for_pickup' || ord.status === 'completed'
          ? 1
          : Math.min(1, ord.prepElapsedSec / Math.max(0.01, ord.prepDurationSec)),
      activeStepLabel: ord.activeStepLabel,
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
    const qMap = computeQueuePositionMap()
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
      cleaningSeatId: c.cleaningSeatId,
      activeStepLabel: c.activeStepLabel,
      actionLabel: c.actionLabel,
      interactionKind: c.interactionKind,
      interactionGesture: c.interactionGesture,
      interactionTextVar: c.interactionTextVar,
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
      groupId: c.groupId,
      chatPartnerId: c.chatPartnerId,
      holdingCup: c.holdingCup,
      cupDrinkId: c.cupDrinkId,
      cupColor: c.cupColor,
      cameraProp: c.cameraProp,
      sipsLeft: c.sipsLeft,
      sipProgress: c.sipProgress,
      patienceRatio: Math.max(0, Math.min(1, c.patienceSec / Math.max(1, c.patienceMaxSec))),
      angry: c.angry,
      shirtColor: c.shirtColor,
      pantsColor: c.pantsColor,
      skinColor: c.skinColor,
      hairColor: c.hairColor,
      variant: c.variant,
      interactionKind: c.interactionKind,
      interactionGesture: c.interactionGesture,
      interactionTextVar: c.interactionTextVar,
    }))
    const orderSnaps = orders.map(o => toOrderSnapshot(o, qMap))
    const seatSnaps: SeatSnapshot[] = seats.map(s => ({
      id: s.id,
      zone: s.zone,
      x: s.x,
      z: s.z,
      yaw: s.yaw,
      state: s.state,
      occupantId: s.occupantId,
      dirtyCupColor: s.dirtyCupColor,
    }))
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
      seats: seatSnaps,
      inventory: invObj,
      metrics: {
        totalArrivals,
        totalOrdersCreated,
        ordersCompleted,
        ordersCancelled,
        ordersCancelledByPlayer,
        ordersAbandonedQueue,
        ordersAbandonedWait,
        ordersAbandonedUnclaimed,
        activeCustomers: customers.length,
        activeClerks: clerks.length,
        activeOrders,
        queueLength,
        totalRevenue,
        restockCount,
        tablesCleanedCount,
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

    setPlayerPresence(player: PlayerPresenceInput | null): void {
      playerPresence = player ? { ...player } : null
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
          order: toOrderSnapshot(existing, computeQueuePositionMap()),
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
        order: toOrderSnapshot(ord, computeQueuePositionMap()),
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

    cancelPlayerOrder(orderIdOrKey: string): CancelPlayerOrderResult {
      const resolvedId = orderIdByKey.get(orderIdOrKey) ?? orderIdOrKey
      const ord = ordersById.get(resolvedId)
      if (!ord) {
        return { ok: false, code: 'ORDER_NOT_FOUND', refundable: false }
      }
      if (ord.source !== 'player') {
        return { ok: false, code: 'NOT_PLAYER_ORDER', order: toOrderSnapshot(ord), refundable: false }
      }
      if (isTerminalOrderStatus(ord.status)) {
        return { ok: false, code: 'ALREADY_FINISHED', order: toOrderSnapshot(ord), refundable: false }
      }
      if (ord.clerkId) {
        const clerk = clerks.find(c => c.id === ord.clerkId)
        if (clerk) {
          releaseClerkClaims(clerk)
          clerk.state = 'idle'
          clerk.actionLabel = '待命'
        }
      }
      finishOrder(ord, 'cancelled_by_player')
      return { ok: true, code: 'OK', order: toOrderSnapshot(ord), refundable: true }
    },

    getSnapshot,

    getOrder(orderIdOrKey: string): OrderSnapshot | null {
      const resolvedId = orderIdByKey.get(orderIdOrKey) ?? orderIdOrKey
      const ord = ordersById.get(resolvedId)
      return ord ? toOrderSnapshot(ord, computeQueuePositionMap()) : null
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
      if (customers.length > maxCustomers) {
        errors.push(`customers.length ${customers.length} exceeded maxCustomers ${maxCustomers}`)
      }
      const liveQueue = countTotalQueue()
      if (liveQueue > maxQueueLength) {
        errors.push(`queueLength ${liveQueue} exceeded maxQueueLength ${maxQueueLength}`)
      }
      return { ok: errors.length === 0, errors }
    },
  }
}
