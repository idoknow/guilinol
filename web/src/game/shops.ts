/**
 * Universal Shop Trigger Registry (`web/src/game/shops.ts`).
 *
 * Declarative registry for Guilin commercial venues (IDOK-121 / IDOK-122 / IDOK-126 / IDOK-127):
 *  - `shop_nikoniko_apparel`: 漓尚服饰 · 微笑堂店 (Weixiaotang Plaza east/NE apron, clear of canopies & camphor trees)
 *  - `shop_shizijie_ebike`: 漓行电驴行 · 十字街总店 (Shizijie NE_ANNEX Jiefang East apron, clear of camphor trees at (88,6.5)/(108,11.2))
 *
 * Enforces `quietCheck: true` on both registration and runtime proximity queries.
 * Stage 2B/2C can fine-tune coordinates via `updateShopTrigger()` without touching interaction or transaction logic.
 */

import {isPointInQuietZone} from './quiet-zones'

export type ShopKind = 'clothing' | 'ebike'

export interface ShopCameraRig {
  /** Showcase center point (world meters). */
  stagePos: [number, number, number]
  /** Initial subject facing yaw (radians). */
  stageYaw: number
  /** Default spherical orbit radius (meters). */
  orbitRadius: number
  minRadius: number
  maxRadius: number
  /** Camera elevation pitch (radians, default 0.14..0.24). */
  pitchRad: number
  /** Vertical focus offset above stagePos.y (avatar ~1.05m, e-bike ~0.72m). */
  targetHeightOffset: number
  fovDeg: number
}

export interface ShopTriggerDef {
  shopId: string
  kind: ShopKind
  displayName: string
  brandName: string
  landmarkId: string
  triggerPos: [number, number, number]
  triggerRadius: number
  hintRadius: number
  facingYaw: number
  cameraRig: ShopCameraRig
  deliveryBay?: {x: number; y: number; z: number; yaw: number}
  testRideSpawn?: {x: number; y: number; z: number; yaw: number}
  serviceBay?: {x: number; y: number; z: number; radius: number}
  quietCheck: true
  mapMarker: {
    label: string
    badge: string
    keywords: string
  }
}

export interface NearbyShopHit {
  shop: ShopTriggerDef
  distance: number
  dy: number
  inReach: boolean
}

export interface NearbyServiceBayHit {
  shop: ShopTriggerDef
  distance: number
  dy: number
  bay: NonNullable<ShopTriggerDef['serviceBay']>
}

const DEFAULT_SHOPS: readonly ShopTriggerDef[] = [
  {
    shopId: 'shop_nikoniko_apparel',
    kind: 'clothing',
    displayName: '漓尚服饰 · 微笑堂店',
    brandName: '漓尚服饰',
    landmarkId: 'nikoniko',
    // nikoniko world origin (-974.91, 151.5, -121.59) + local (+55.2, 0, -6.0) on open east-wing granite apron,
    // >12m away from NE canopies (52.5,-18.5)/(46.2,-23.8) and >22m away from north camphor trees.
    triggerPos: [-919.71, 151.5, -127.59],
    triggerRadius: 3.2,
    hintRadius: 18,
    facingYaw: -1.52,
    cameraRig: {
      stagePos: [-920.91, 151.5, -127.59],
      stageYaw: -1.52,
      orbitRadius: 3.3,
      minRadius: 2.1,
      maxRadius: 4.8,
      pitchRad: 0.16,
      targetHeightOffset: 1.05,
      fovDeg: 44,
    },
    quietCheck: true,
    mapMarker: {
      label: '漓尚服饰',
      badge: '服饰',
      keywords: '微笑堂服装店漓尚服饰买衣服换装衣橱',
    },
  },
  {
    shopId: 'shop_shizijie_ebike',
    kind: 'ebike',
    displayName: '漓行电驴行 · 十字街总店',
    brandName: '漓行电驴行',
    landmarkId: 'shizijie',
    // shizijie world origin (-879.75, 151.5, -169.63) + NE_ANNEX midpoint local (97.6, 0, 10.6),
    // cleanly centered ~10m between camphor trees at local (88.0, 6.5) and (108.0, 11.2).
    triggerPos: [-782.15, 151.5, -159.03],
    triggerRadius: 3.4,
    hintRadius: 18,
    facingYaw: 2.91,
    cameraRig: {
      stagePos: [-782.5, 151.5, -160.2],
      stageYaw: 2.91,
      orbitRadius: 3.8,
      minRadius: 2.4,
      maxRadius: 5.6,
      pitchRad: 0.2,
      targetHeightOffset: 0.72,
      fovDeg: 45,
    },
    deliveryBay: {x: -787.2, y: 151.5, z: -157.8, yaw: -1.34},
    testRideSpawn: {x: -776.5, y: 151.5, z: -156.2, yaw: -1.34},
    serviceBay: {x: -797.5, y: 151.5, z: -163.2, radius: 3.2},
    quietCheck: true,
    mapMarker: {
      label: '漓行电驴行',
      badge: '电摩',
      keywords: '十字街电动车行漓行电驴行买车试驾改装充电维修',
    },
  },
]

const registry = new Map<string, ShopTriggerDef>()

function assertShopOutsideQuietZones(def: ShopTriggerDef): void {
  if (!def.quietCheck) throw new Error(`Shop ${def.shopId} must enable quietCheck: true`)
  if (isPointInQuietZone(def.triggerPos[0], def.triggerPos[2])) {
    throw new Error(`Shop trigger ${def.shopId} falls inside a campus quiet zone`)
  }
  if (def.deliveryBay && isPointInQuietZone(def.deliveryBay.x, def.deliveryBay.z)) {
    throw new Error(`Shop deliveryBay ${def.shopId} falls inside a campus quiet zone`)
  }
  if (def.testRideSpawn && isPointInQuietZone(def.testRideSpawn.x, def.testRideSpawn.z)) {
    throw new Error(`Shop testRideSpawn ${def.shopId} falls inside a campus quiet zone`)
  }
  if (def.serviceBay && isPointInQuietZone(def.serviceBay.x, def.serviceBay.z)) {
    throw new Error(`Shop serviceBay ${def.shopId} falls inside a campus quiet zone`)
  }
}

export function registerShop(def: ShopTriggerDef): ShopTriggerDef {
  assertShopOutsideQuietZones(def)
  const frozen: ShopTriggerDef = {
    ...def,
    triggerPos: [...def.triggerPos] as [number, number, number],
    cameraRig: {
      ...def.cameraRig,
      stagePos: [...def.cameraRig.stagePos] as [number, number, number],
    },
    ...(def.deliveryBay ? {deliveryBay: {...def.deliveryBay}} : {}),
    ...(def.testRideSpawn ? {testRideSpawn: {...def.testRideSpawn}} : {}),
    ...(def.serviceBay ? {serviceBay: {...def.serviceBay}} : {}),
    mapMarker: {...def.mapMarker},
  }
  registry.set(def.shopId, frozen)
  return frozen
}

for (const shop of DEFAULT_SHOPS) registerShop(shop)

export function getShop(shopId: string): ShopTriggerDef | undefined {
  return registry.get(shopId)
}

export function listShops(): readonly ShopTriggerDef[] {
  return [...registry.values()]
}

/** Allows Stage 2B/2C landmarks to update exact coordinates without changing core registry keys. */
export function updateShopTrigger(
  shopId: string,
  patch: Partial<Pick<ShopTriggerDef, 'triggerPos' | 'triggerRadius' | 'hintRadius' | 'facingYaw' | 'cameraRig' | 'deliveryBay' | 'testRideSpawn' | 'serviceBay'>>,
): ShopTriggerDef | null {
  const existing = registry.get(shopId)
  if (!existing) return null
  return registerShop({
    ...existing,
    ...patch,
    cameraRig: patch.cameraRig ? {...existing.cameraRig, ...patch.cameraRig} : existing.cameraRig,
    quietCheck: true,
  })
}

export const SHOP_REGISTRY: ReadonlyMap<string, ShopTriggerDef> = registry

const MAX_SHOP_VERTICAL_DY = 1.6

/**
 * Finds the nearest reachable shop trigger at world position `(x, y, z)`.
 * Automatically blocks triggers if the player is inside a campus quiet zone.
 */
export function findNearbyShopTrigger(
  x: number,
  z: number,
  footY?: number,
  opts?: {includeHintOnly?: boolean; playerInQuietZone?: boolean},
): NearbyShopHit | null {
  if (opts?.playerInQuietZone || isPointInQuietZone(x, z)) return null
  let best: NearbyShopHit | null = null
  for (const shop of registry.values()) {
    const dx = shop.triggerPos[0] - x
    const dz = shop.triggerPos[2] - z
    const dist = Math.hypot(dx, dz)
    const dy = footY !== undefined ? Math.abs(shop.triggerPos[1] - footY) : 0
    if (footY !== undefined && dy > MAX_SHOP_VERTICAL_DY) continue
    const inReach = dist <= shop.triggerRadius
    const limit = opts?.includeHintOnly ? shop.hintRadius : shop.triggerRadius
    if (dist > limit) continue
    if (!best || (inReach && !best.inReach) || (inReach === best.inReach && dist < best.distance)) {
      best = {shop, distance: dist, dy, inReach}
    }
  }
  return best
}

/**
 * Finds the nearest reachable shop charging / repair service bay at world position `(x, y, z)`.
 */
export function findNearbyServiceBay(
  x: number,
  z: number,
  footY?: number,
  opts?: {playerInQuietZone?: boolean},
): NearbyServiceBayHit | null {
  if (opts?.playerInQuietZone || isPointInQuietZone(x, z)) return null
  let best: NearbyServiceBayHit | null = null
  for (const shop of registry.values()) {
    const bay = shop.serviceBay
    if (!bay) continue
    const dist = Math.hypot(bay.x - x, bay.z - z)
    const dy = footY !== undefined ? Math.abs(bay.y - footY) : 0
    if (footY !== undefined && dy > MAX_SHOP_VERTICAL_DY) continue
    if (dist > bay.radius) continue
    if (!best || dist < best.distance) {
      best = {shop, distance: dist, dy, bay}
    }
  }
  return best
}
