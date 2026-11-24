import { DRINKS_MENU, type DrinkCatalogItem } from '../menu/menu.ts'
import type {
  DrinkMenuItem,
  DrinkPrepStepSim,
  DrinkShopLayout,
  InventoryItemDef,
  PrepStationKind,
  ShopAnchorsLike,
} from './types.ts'

export const PREP_STATION_MAP: Readonly<
  Record<
    PrepStationKind,
    {
      stationKind: PrepStationKind
      label: string
      equipmentName: string
    }
  >
> = {
  lemon_ice: {
    stationKind: 'lemon_ice',
    label: '鲜果捣冰台',
    equipmentName: '制冰机与鲜柠檬切片缸',
  },
  tea_shake: {
    stationKind: 'tea_shake',
    label: '萃茶雪克台',
    equipmentName: '双筒萃茶桶与封口机',
  },
  cream_top: {
    stationKind: 'cream_top',
    label: '奶浆甜品台',
    equipmentName: '冰淇淋机与黑糖珍珠锅',
  },
}

export const DEFAULT_INVENTORY_DEFS: readonly InventoryItemDef[] = [
  { id: 'cup', name: '标准杯盖吸管', unit: '套', binCapacity: 120, initialBin: 100, lowThreshold: 25, backroomCapacity: 1600, initialBackroom: 1200 },
  { id: 'ice', name: '制冰块槽', unit: '勺', binCapacity: 180, initialBin: 150, lowThreshold: 35, backroomCapacity: 2400, initialBackroom: 1800 },
  { id: 'lemon', name: '鲜切柠檬', unit: '片', binCapacity: 140, initialBin: 110, lowThreshold: 28, backroomCapacity: 1400, initialBackroom: 1100 },
  { id: 'tea_base', name: '现煮茶汤桶', unit: '份', binCapacity: 160, initialBin: 130, lowThreshold: 32, backroomCapacity: 1800, initialBackroom: 1400 },
  { id: 'milk', name: '冷藏牛乳', unit: '份', binCapacity: 140, initialBin: 110, lowThreshold: 28, backroomCapacity: 1600, initialBackroom: 1200 },
  { id: 'syrup', name: '蔗糖风味浆', unit: '泵', binCapacity: 160, initialBin: 130, lowThreshold: 30, backroomCapacity: 1800, initialBackroom: 1400 },
  { id: 'pearls', name: '琥珀珍珠桶', unit: '勺', binCapacity: 120, initialBin: 95, lowThreshold: 24, backroomCapacity: 1200, initialBackroom: 900 },
  { id: 'fruit_pulp', name: '鲜果泥料盒', unit: '勺', binCapacity: 120, initialBin: 95, lowThreshold: 24, backroomCapacity: 1200, initialBackroom: 900 },
  { id: 'ice_cream', name: '奶浆冰淇淋机', unit: '份', binCapacity: 120, initialBin: 95, lowThreshold: 24, backroomCapacity: 1200, initialBackroom: 900 },
  { id: 'coffee', name: '现磨浓缩液', unit: '份', binCapacity: 100, initialBin: 80, lowThreshold: 20, backroomCapacity: 1000, initialBackroom: 800 },
]

export const INVENTORY_DEF_BY_ID: Readonly<Record<string, InventoryItemDef>> = Object.fromEntries(
  DEFAULT_INVENTORY_DEFS.map(def => [def.id, def]),
)

export function convertCatalogItemToSim(
  item: DrinkCatalogItem,
  inventoryById: Readonly<Record<string, InventoryItemDef>> = INVENTORY_DEF_BY_ID,
): DrinkMenuItem {
  if (!item || typeof item.id !== 'string' || !item.id.trim()) {
    throw new Error('Missing catalog item id')
  }
  if (!item.name || !item.name.trim()) {
    throw new Error(`Missing catalog item name for ${item.id}`)
  }
  if (!Number.isFinite(item.price) || item.price <= 0) {
    throw new Error(`Invalid price for ${item.id}: ${String(item.price)}`)
  }
  if (!(item.stationKind in PREP_STATION_MAP)) {
    throw new Error(`Missing station mapping for ${item.id}: ${String(item.stationKind)}`)
  }
  if (!Number.isFinite(item.durationSec) || item.durationSec <= 0) {
    throw new Error(`Invalid durationSec for ${item.id}: ${String(item.durationSec)}`)
  }
  if (!Number.isFinite(item.prepSec) || Math.abs(item.prepSec - item.durationSec) > 1e-4) {
    throw new Error(`Duration mismatch for ${item.id}: prepSec=${item.prepSec} vs durationSec=${item.durationSec}`)
  }

  const rawSteps = item.steps
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    throw new Error(`Missing prep steps mapping for ${item.id}`)
  }
  let stepDurationSum = 0
  const steps: DrinkPrepStepSim[] = rawSteps.map((s, idx) => {
    if (!s || !s.id || !s.label) {
      throw new Error(`Invalid step[${idx}] in ${item.id}`)
    }
    if (!(s.stationKind in PREP_STATION_MAP)) {
      throw new Error(`Missing step station mapping in ${item.id}.${s.id}: ${String(s.stationKind)}`)
    }
    if (!Number.isFinite(s.durationSec) || s.durationSec <= 0) {
      throw new Error(`Invalid step duration in ${item.id}.${s.id}: ${String(s.durationSec)}`)
    }
    stepDurationSum += s.durationSec
    return {
      id: s.id,
      label: s.label,
      stationKind: s.stationKind,
      durationSec: s.durationSec,
    }
  })

  if (Math.abs(stepDurationSum - item.durationSec) > 1e-4) {
    throw new Error(`Step duration sum mismatch for ${item.id}: sum=${stepDurationSum} vs durationSec=${item.durationSec}`)
  }

  const ingEntries = Object.entries(item.ingredients ?? {})
  if (ingEntries.length === 0) {
    throw new Error(`Missing ingredients mapping for ${item.id}`)
  }
  const ingredients: Record<string, number> = {}
  for (const [ingId, qty] of ingEntries) {
    if (!(ingId in inventoryById)) {
      throw new Error(`Missing inventory mapping for ${item.id}: ingredient '${ingId}'`)
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`Invalid ingredient amount for ${item.id}.${ingId}: ${String(qty)}`)
    }
    ingredients[ingId] = qty
  }

  return {
    id: item.id,
    name: item.name,
    category: item.category,
    price: item.price,
    prepSec: item.durationSec,
    stationKind: item.stationKind,
    cupColor: item.cupColor,
    accentColor: item.accentColor,
    ingredients,
    steps,
    sipsCount: Math.max(1, Math.floor(item.sipsCount || 4)),
    hot: Boolean(item.hot),
  }
}

export function convertCatalogMenuToSim(
  catalog: readonly DrinkCatalogItem[] = DRINKS_MENU,
  inventoryDefs: readonly InventoryItemDef[] = DEFAULT_INVENTORY_DEFS,
): DrinkMenuItem[] {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    throw new Error('Catalog menu cannot be empty')
  }
  const inventoryById: Record<string, InventoryItemDef> = Object.fromEntries(
    inventoryDefs.map(def => [def.id, def]),
  )
  const seenIds = new Set<string>()
  return catalog.map(item => {
    if (seenIds.has(item.id)) {
      throw new Error(`Duplicate catalog item id: ${item.id}`)
    }
    seenIds.add(item.id)
    return convertCatalogItemToSim(item, inventoryById)
  })
}

export const DEFAULT_DRINKS_MENU: readonly DrinkMenuItem[] = convertCatalogMenuToSim(DRINKS_MENU)

export function validateLayoutForMenu(layout: DrinkShopLayout, menu: readonly DrinkMenuItem[]): void {
  if (!layout.cashiers.length) throw new Error('Layout missing cashiers')
  if (!layout.prepStations.length) throw new Error('Layout missing prepStations')
  if (!layout.pickupSlots.length) throw new Error('Layout missing pickupSlots')
  if (!layout.waitingSpots.length) throw new Error('Layout missing waitingSpots')
  if (!layout.seats.length) throw new Error('Layout missing seats')

  const stationKinds = new Set(layout.prepStations.map(s => s.kind))
  for (const item of menu) {
    if (!stationKinds.has(item.stationKind)) {
      throw new Error(`Layout missing prep station kind '${item.stationKind}' required by ${item.id}`)
    }
  }
}

export function layoutFromShopAnchors(anchors: ShopAnchorsLike): DrinkShopLayout {
  if (!anchors || !anchors.entrance || !anchors.cashiers?.length || !anchors.prepStations?.length) {
    throw new Error('Invalid shop anchors: missing entrance, cashiers, or prepStations')
  }
  const width = anchors.width ?? 11.4
  const depth = anchors.depth ?? 9.8
  return {
    width,
    depth,
    entrance: { ...anchors.entrance },
    approachLeft: anchors.approachLeft ? { ...anchors.approachLeft } : { x: -7.6, z: 4.6 },
    approachRight: anchors.approachRight ? { ...anchors.approachRight } : { x: 7.8, z: 4.6 },
    menuBoardSlots: anchors.menuBoardSlots?.length
      ? anchors.menuBoardSlots.map(s => ({ ...s }))
      : [
          { x: -2.05, z: 3.18, yaw: Math.PI },
          { x: -1.1, z: 2.02, yaw: Math.PI },
          { x: 1.25, z: 2.02, yaw: Math.PI },
          { x: 2.3, z: 3.18, yaw: Math.PI },
        ],
    cashiers: anchors.cashiers.map(c => ({
      id: c.id,
      clerkPos: { ...c.clerkPos },
      customerPos: { ...c.customerPos },
      queueAnchor: { ...c.queueAnchor },
      queueDir: { ...c.queueDir },
    })),
    prepStations: anchors.prepStations.map(s => ({ ...s })),
    pickupSlots: anchors.pickupSlots.map(s => ({ ...s })),
    pickupClerkPos: { ...anchors.pickupClerkPos },
    waitingSpots: anchors.waitingSpots.map(s => ({ ...s })),
    seats: anchors.seats.map(s => ({ ...s })),
    storagePos: { ...anchors.storagePos },
    patrolPoints: anchors.patrolPoints.map(p => ({ ...p })),
  }
}

/**
 * 离线测试夹具布局（仅作测试夹具或外部 `shop/anchors.ts` 未注入时的兜底）。
 */
export function createDrinksLayoutFixture(overrides?: Partial<DrinkShopLayout>): DrinkShopLayout {
  const base: DrinkShopLayout = {
    width: 11.4,
    depth: 9.8,
    entrance: { x: 0.2, z: 2.8 },
    approachLeft: { x: -7.6, z: 4.95 },
    approachRight: { x: 7.8, z: 4.95 },
    menuBoardSlots: [
      { x: -1.7, z: 2.05, yaw: Math.PI },
      { x: -0.55, z: 2.05, yaw: Math.PI },
      { x: 0.55, z: 2.05, yaw: Math.PI },
      { x: 1.65, z: 2.05, yaw: Math.PI },
    ],
    cashiers: [
      {
        id: 'cashier_left',
        clerkPos: { x: -2.55, z: -0.92, yaw: 0 },
        customerPos: { x: -2.55, z: 0.14, yaw: Math.PI },
        queueAnchor: { x: -2.55, z: 1.08 },
        queueDir: { x: 0, z: 1.02 },
      },
      {
        id: 'cashier_right',
        clerkPos: { x: -0.35, z: -0.92, yaw: 0 },
        customerPos: { x: -0.35, z: 0.14, yaw: Math.PI },
        queueAnchor: { x: -0.35, z: 1.08 },
        queueDir: { x: 0, z: 1.02 },
      },
    ],
    prepStations: [
      { id: 'prep_lemon_1', kind: 'lemon_ice', x: -3.2, z: -2.35, yaw: Math.PI },
      { id: 'prep_tea_1', kind: 'tea_shake', x: -1.35, z: -2.35, yaw: Math.PI },
      { id: 'prep_tea_2', kind: 'tea_shake', x: 0.5, z: -2.35, yaw: Math.PI },
      { id: 'prep_cream_1', kind: 'cream_top', x: 2.25, z: -2.35, yaw: Math.PI },
    ],
    pickupClerkPos: { x: 2.35, z: -0.92, yaw: 0 },
    pickupSlots: [
      { x: 1.4, z: 0.18, yaw: Math.PI },
      { x: 2.25, z: 0.18, yaw: Math.PI },
      { x: 3.1, z: 0.18, yaw: Math.PI },
      { x: 3.9, z: 0.18, yaw: Math.PI },
    ],
    waitingSpots: [
      { x: 1.35, z: 1.15, yaw: Math.PI },
      { x: 2.25, z: 1.15, yaw: Math.PI },
      { x: 3.15, z: 1.15, yaw: Math.PI },
      { x: 4.0, z: 1.15, yaw: Math.PI },
      { x: 1.65, z: 2.05, yaw: Math.PI },
      { x: 2.6, z: 2.05, yaw: Math.PI },
      { x: 3.55, z: 2.05, yaw: Math.PI },
      { x: 4.45, z: 2.05, yaw: Math.PI },
    ],
    seats: [
      { id: 'seat_in_1', zone: 'indoor', x: -4.65, z: 0.35, yaw: Math.PI * 0.5 },
      { id: 'seat_in_2', zone: 'indoor', x: -4.65, z: 1.5, yaw: Math.PI * 0.5 },
      { id: 'seat_in_3', zone: 'indoor', x: -3.45, z: 0.95, yaw: -Math.PI * 0.5 },
      { id: 'seat_in_4', zone: 'indoor', x: 4.75, z: 0.45, yaw: -Math.PI * 0.5 },
      { id: 'seat_in_5', zone: 'indoor', x: 4.75, z: 1.45, yaw: -Math.PI * 0.5 },
      { id: 'seat_in_6', zone: 'indoor', x: 4.75, z: 2.25, yaw: -Math.PI * 0.5 },
      { id: 'seat_out_1', zone: 'patio', x: -3.75, z: 3.6, yaw: 0 },
      { id: 'seat_out_2', zone: 'patio', x: -2.85, z: 3.6, yaw: 0 },
      { id: 'seat_out_3', zone: 'patio', x: 2.65, z: 3.6, yaw: 0 },
      { id: 'seat_out_4', zone: 'patio', x: 3.55, z: 3.6, yaw: 0 },
    ],
    storagePos: { x: -4.4, z: -3.15, yaw: -Math.PI * 0.5 },
    patrolPoints: [
      { x: -3.8, z: -1.55, yaw: 0 },
      { x: -1.45, z: -1.65, yaw: 0 },
      { x: 0.55, z: -1.65, yaw: 0 },
      { x: 3.55, z: -1.45, yaw: 0 },
    ],
  }

  if (!overrides) return base
  return {
    ...base,
    ...overrides,
    cashiers: overrides.cashiers ?? base.cashiers,
    prepStations: overrides.prepStations ?? base.prepStations,
    pickupSlots: overrides.pickupSlots ?? base.pickupSlots,
    waitingSpots: overrides.waitingSpots ?? base.waitingSpots,
    seats: overrides.seats ?? base.seats,
    menuBoardSlots: overrides.menuBoardSlots ?? base.menuBoardSlots,
    patrolPoints: overrides.patrolPoints ?? base.patrolPoints,
  }
}

/**
 * @deprecated 仅作测试夹具与兼容旧 `shop/mesh.ts` 调用，正式接入请改传 `shop/anchors.ts`。
 */
export function createDefaultDrinksLayout(overrides?: Partial<DrinkShopLayout>): DrinkShopLayout {
  return createDrinksLayoutFixture(overrides)
}
