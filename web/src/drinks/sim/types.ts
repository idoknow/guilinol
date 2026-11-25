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

/**
 * Structural anchor contract compatible with `drinks/shop/anchors.ts`.
 */
export interface ShopAnchorsLike {
  width?: number
  depth?: number
  entrance: Point2D
  approachLeft?: Point2D
  approachRight?: Point2D
  menuBoardSlots?: readonly DirectedSpot[]
  cashiers: readonly CashierSpot[]
  prepStations: readonly PrepStationSpot[]
  pickupSlots: readonly DirectedSpot[]
  pickupClerkPos: DirectedSpot
  waitingSpots: readonly DirectedSpot[]
  seats: readonly SeatSpot[]
  storagePos: DirectedSpot
  patrolPoints: readonly DirectedSpot[]
}

export interface DrinkPrepStepSim {
  id: string
  label: string
  stationKind: PrepStationKind
  durationSec: number
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
  steps?: readonly DrinkPrepStepSim[]
  sipsCount?: number
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

export type InteractionBubbleKind =
  | 'order_ask'
  | 'order_reply'
  | 'make_change'
  | 'receive_change'
  | 'handover_cup'
  | 'receive_cup'
  | 'call_number'
  | 'look_up_called'
  | 'urge_order'
  | 'clerk_reassure'
  | 'complain_leave'
  | 'take_photo'
  | 'chat_pair_a'
  | 'chat_pair_b'
  | 'yield_way'
  | 'claim_seat'
  | 'clean_table'
  | 'clerk_greet_player'
  | 'queue_yield_player'
  | 'remind_cut_in'
  | 'restock'
  | 'making'

export type InteractionGesture =
  | 'none'
  | 'talk'
  | 'give_change'
  | 'receive_change'
  | 'handover_cup'
  | 'receive_cup'
  | 'look_up'
  | 'urge_wave'
  | 'angry_stamp'
  | 'take_photo'
  | 'chat_nod'
  | 'yield_step'
  | 'claim_wave'
  | 'clean_wipe'
  | 'greet_wave'
  | 'remind_gesture'

export type ClerkRole = 'cashier' | 'maker' | 'runner' | 'patrol'

export type ClerkState =
  | 'idle'
  | 'walking'
  | 'taking_order'
  | 'making'
  | 'calling'
  | 'restocking'
  | 'cleaning_table'
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
  cleaningSeatId: string | null
  activeStepLabel: string | null
  actionLabel: string
  interactionKind: InteractionBubbleKind | null
  interactionGesture: InteractionGesture
  interactionTextVar: string | null
}

export type CustomerRoleKind = 'student' | 'office' | 'tourist' | 'local' | 'rider'

export type CustomerPhase =
  | 'entering'
  | 'browsing_menu'
  | 'queuing'
  | 'ordering'
  | 'waiting_pickup'
  | 'picking_up'
  | 'claiming_seat'
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
  groupId: string | null
  chatPartnerId: string | null
  holdingCup: boolean
  cupDrinkId: string | null
  cupColor: string | null
  cameraProp: boolean
  sipsLeft: number
  sipProgress: number
  patienceRatio: number
  angry: boolean
  shirtColor: string
  pantsColor: string
  skinColor: string
  hairColor: string
  variant: number
  interactionKind: InteractionBubbleKind | null
  interactionGesture: InteractionGesture
  interactionTextVar: string | null
}

export type OrderSource = 'npc' | 'player'

export type OrderStatus =
  | 'queued'
  | 'preparing'
  | 'ready_for_pickup'
  | 'completed'
  | 'cancelled_out_of_stock'
  | 'cancelled_by_player'
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
  queuePosition: number
  stationId: string | null
  clerkId: string | null
  pickupSlotIndex: number
  progress: number
  activeStepLabel: string | null
  createdAtSec: number
  prepStartedAtSec: number | null
  readyAtSec: number | null
  finishedAtSec: number | null
}

export type SeatOccupancyState = 'free' | 'reserved' | 'occupied' | 'dirty'

export interface SeatSnapshot {
  id: string
  zone: 'indoor' | 'patio'
  x: number
  z: number
  yaw: number
  state: SeatOccupancyState
  occupantId: string | null
  dirtyCupColor: string | null
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
  | 'table_cleaned'
  | 'player_greeted'
  | 'player_cut_in_reminded'

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
  ordersCancelledByPlayer: number
  ordersAbandonedQueue: number
  ordersAbandonedWait: number
  ordersAbandonedUnclaimed: number
  activeCustomers: number
  activeClerks: number
  activeOrders: number
  queueLength: number
  totalRevenue: number
  restockCount: number
  tablesCleanedCount: number
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
  seats: SeatSnapshot[]
  inventory: Record<string, InventoryBinState>
  metrics: DrinksSimMetrics
}

export interface PlayerPresenceInput {
  active: boolean
  x: number
  z: number
  yaw?: number
  nearRadius?: number
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

export interface CancelPlayerOrderResult {
  ok: boolean
  code: 'OK' | 'ORDER_NOT_FOUND' | 'ALREADY_FINISHED' | 'NOT_PLAYER_ORDER'
  order?: OrderSnapshot
  refundable: boolean
}

export interface InvariantCheckResult {
  ok: boolean
  errors: string[]
}

export interface CreateDrinksSimOptions {
  menu?: readonly DrinkMenuItem[] | { items: readonly DrinkMenuItem[] }
  inventoryDefs?: readonly InventoryItemDef[]
  anchors?: ShopAnchorsLike
  layout?: Partial<DrinkShopLayout>
  seed?: number | string
  now?: number
  hourOf?: (simTimeSec: number) => number
  clerkCount?: number
  open24h?: boolean
  rejectPlayerWhenClosed?: boolean
  autoRestockSupply?: boolean
  /** Hard-clamped to <= 8 (MAX_CONCURRENT_CUSTOMERS) to prevent indoor/outdoor crowding. */
  maxCustomers?: number
  /** Hard-clamped to <= 4 (MAX_DOORWAY_QUEUE) across all cashier/doorway queues. */
  maxQueueLength?: number
  playerUnclaimedTimeoutSec?: number
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
  setPlayerPresence(player: PlayerPresenceInput | null): void
  placePlayerOrder(req: PlacePlayerOrderRequest): PlacePlayerOrderResult
  collectPlayerOrder(orderIdOrKey: string): CollectPlayerOrderResult
  cancelPlayerOrder(orderIdOrKey: string, reason?: string): CancelPlayerOrderResult
  getSnapshot(): DrinksSimSnapshot
  getOrder(orderIdOrKey: string): OrderSnapshot | null
  getMenu(): readonly DrinkMenuItem[]
  getLayout(): DrinkShopLayout
  drainEvents(): DrinksSimEvent[]
  validateInvariants(): InvariantCheckResult
}
