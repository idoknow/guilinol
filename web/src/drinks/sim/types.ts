export type DrinkDayPhase = 'closed' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night'

export type DrinkCategory = 'lemonade' | 'milk_tea' | 'fruit_tea' | 'coffee' | 'ice_cream'

export type PrepStationKind = 'lemon_ice' | 'tea_shake' | 'cream_top'

export interface Point2D {
  x: number
  z: number
}

export interface DirectedSpot extends Point2D {
  yaw: number
}

export interface SeatSpot extends DirectedSpot {
  id: string
  zone: 'indoor' | 'patio'
}

export interface PrepStationSpot extends DirectedSpot {
  id: string
  kind: PrepStationKind
}

export interface CashierSpot {
  id: string
  clerkPos: DirectedSpot
  customerPos: DirectedSpot
  queueAnchor: Point2D
  queueDir: Point2D
}

export interface DrinkShopLayout {
  width: number
  depth: number
  entrance: Point2D
  approachLeft: Point2D
  approachRight: Point2D
  menuBoardSlots: DirectedSpot[]
  cashiers: CashierSpot[]
  prepStations: PrepStationSpot[]
  pickupSlots: DirectedSpot[]
  pickupClerkPos: DirectedSpot
  waitingSpots: DirectedSpot[]
  seats: SeatSpot[]
  storagePos: DirectedSpot
  patrolPoints: DirectedSpot[]
}

export interface DrinkMenuItem {
  id: string
  name: string
  category: DrinkCategory
  price: number
  prepSec: number
  stationKind: PrepStationKind
  cupColor: string
  accentColor: string
  ingredients: Record<string, number>
  hot?: boolean
}

export interface InventoryItemDef {
  id: string
  name: string
  unit: string
  binCapacity: number
  initialBin: number
  lowThreshold: number
  backroomCapacity: number
  initialBackroom: number
}

export interface InventoryBinState {
  id: string
  name: string
  unit: string
  binAmount: number
  binCapacity: number
  lowThreshold: number
  backroomAmount: number
  backroomCapacity: number
  restocking: boolean
}

export type ClerkRole = 'cashier' | 'maker' | 'runner' | 'patrol'

export type ClerkState =
  | 'idle'
  | 'walking'
  | 'taking_order'
  | 'making'
  | 'calling'
  | 'restocking'
  | 'patrolling'

export interface ClerkSnapshot {
  id: string
  name: string
  role: ClerkRole
  state: ClerkState
  x: number
  z: number
  yaw: number
  speed: number
  progress: number
  holdingCup: boolean
  holdingCupColor: string | null
  holdingCrate: boolean
  activeOrderId: string | null
  targetStationId: string | null
  actionLabel: string
}

export type CustomerRoleKind = 'student' | 'office' | 'tourist' | 'local' | 'rider'

export type CustomerPhase =
  | 'entering'
  | 'browsing_menu'
  | 'queuing'
  | 'ordering'
  | 'waiting_pickup'
  | 'picking_up'
  | 'seated'
  | 'leaving'

export interface CustomerSnapshot {
  id: string
  name: string
  roleKind: CustomerRoleKind
  phase: CustomerPhase
  x: number
  z: number
  yaw: number
  speed: number
  seated: boolean
  seatId: string | null
  waitingOrderId: string | null
  desiredItemId: string | null
  holdingCup: boolean
  cupDrinkId: string | null
  cupColor: string | null
  sipsLeft: number
  sipProgress: number
  patienceRatio: number
  angry: boolean
  shirtColor: string
  pantsColor: string
  skinColor: string
  hairColor: string
  variant: number
}

export type OrderSource = 'npc' | 'player'

export type OrderStatus =
  | 'queued'
  | 'preparing'
  | 'ready_for_pickup'
  | 'completed'
  | 'cancelled_out_of_stock'
  | 'abandoned_queue'
  | 'abandoned_wait'
  | 'abandoned_unclaimed'

export interface OrderSnapshot {
  id: string
  ticketNo: string
  orderKey: string
  source: OrderSource
  customerId: string
  customerName: string
  itemId: string
  itemName: string
  cupColor: string
  quantity: number
  unitPrice: number
  totalPrice: number
  status: OrderStatus
  stationId: string | null
  clerkId: string | null
  pickupSlotIndex: number
  progress: number
  createdAtSec: number
  prepStartedAtSec: number | null
  readyAtSec: number | null
  finishedAtSec: number | null
}

export type DrinksSimEventType =
  | 'customer_entered'
  | 'customer_left'
  | 'order_created'
  | 'order_preparing'
  | 'order_called'
  | 'order_completed'
  | 'order_failed'
  | 'restock_done'

export interface DrinksSimEvent {
  type: DrinksSimEventType
  timeSec: number
  orderId?: string
  ticketNo?: string
  customerId?: string
  clerkId?: string
  itemName?: string
  detail?: string
}

export interface DrinksSimMetrics {
  totalArrivals: number
  totalOrdersCreated: number
  ordersCompleted: number
  ordersCancelled: number
  ordersAbandonedQueue: number
  ordersAbandonedWait: number
  ordersAbandonedUnclaimed: number
  activeCustomers: number
  activeClerks: number
  activeOrders: number
  queueLength: number
  totalRevenue: number
  restockCount: number
  deadlockRecoveries: number
  minObservedInventory: number
  peakConcurrentPeople: number
  hourlyArrivals: number[]
  hourlyOrders: number[]
}

export interface DrinksSimSnapshot {
  timeSec: number
  hour: number
  phase: DrinkDayPhase
  isOpen: boolean
  clerks: ClerkSnapshot[]
  customers: CustomerSnapshot[]
  orders: OrderSnapshot[]
  inventory: Record<string, InventoryBinState>
  metrics: DrinksSimMetrics
}

export interface PlacePlayerOrderRequest {
  menuItemId: string
  quantity?: number
  orderKey: string
  customerName?: string
  customerId?: string
}

export interface PlacePlayerOrderResult {
  ok: boolean
  code: 'OK' | 'IDEMPOTENT_REPLAY' | 'INVALID_ORDER_KEY' | 'UNKNOWN_ITEM' | 'INVALID_QUANTITY' | 'SHOP_CLOSED'
  created: boolean
  idempotentReplay: boolean
  order?: OrderSnapshot
}

export interface CollectPlayerOrderResult {
  ok: boolean
  code: 'OK' | 'ORDER_NOT_FOUND' | 'NOT_READY' | 'ALREADY_FINISHED'
  order?: OrderSnapshot
  item?: DrinkMenuItem
}

export interface InvariantCheckResult {
  ok: boolean
  errors: string[]
}

export interface CreateDrinksSimOptions {
  menu?: readonly DrinkMenuItem[] | { items: readonly DrinkMenuItem[] }
  inventoryDefs?: readonly InventoryItemDef[]
  layout?: Partial<DrinkShopLayout>
  seed?: number | string
  now?: number
  hourOf?: (simTimeSec: number) => number
  clerkCount?: number
  open24h?: boolean
  rejectPlayerWhenClosed?: boolean
  autoRestockSupply?: boolean
  maxCustomers?: number
}

export interface DrinksSim {
  readonly fixedDt: number
  readonly fastForwardTolerance: {
    maxTimeDriftSec: number
    maxRevenueRelativeDiff: number
    maxOrdersDiffRatio: number
  }
  step(dtSec: number): void
  fastForward(durationSec: number): DrinksSimSnapshot
  placePlayerOrder(req: PlacePlayerOrderRequest): PlacePlayerOrderResult
  collectPlayerOrder(orderIdOrKey: string): CollectPlayerOrderResult
  getSnapshot(): DrinksSimSnapshot
  getOrder(orderIdOrKey: string): OrderSnapshot | null
  getMenu(): readonly DrinkMenuItem[]
  getLayout(): DrinkShopLayout
  drainEvents(): DrinksSimEvent[]
  validateInvariants(): InvariantCheckResult
}
