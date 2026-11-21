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

export interface ShopDisplayStand {
  readonly id: string
  readonly modelId: 'lijiang_light' | 'city_range' | 'xiangshan_gt'
  /** World showcase plinth center [x, y, z]; runtime Y snaps dynamically to loaded landmark plinth top. */
  readonly pos: [number, number, number]
  /** Subject facing yaw (Three.js -Z forward convention). */
  readonly yaw: number
  /** Plinth elevation above local apron surface (meters). */
  readonly plinthHeight: number
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
  displayStands?: readonly ShopDisplayStand[]
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
    // nikoniko anchor (-974.905, 151.5, -121.586) + EastWing_Main bay 5+6 wall center (48.713, 16.147).
    // triggerPos (+1.95 m) & stagePos (+2.15 m) sit squarely on +0.247 m Zhongshan M. Rd sidewalk inside apron:
    // ~1.0 m inside sidewalk curb, >5.7 m from carriageway, >=7.5 m from Lamp_N, >=17 m from Pylon_E.
    triggerPos: [-924.31, 151.75, -104.93],
    triggerRadius: 3.2,
    hintRadius: 18,
    facingYaw: -1.8348,
    cameraRig: {
      stagePos: [-924.12, 151.75, -104.88],
      stageYaw: 1.3068,
      orbitRadius: 2.4,
      minRadius: 1.8,
      maxRadius: 3.6,
      pitchRad: 0.14,
      targetHeightOffset: 1.05,
      fovDeg: 44,
    },
    quietCheck: true,
    mapMarker: {
      label: '微笑堂服装店',
      badge: '服饰',
      keywords: '微笑堂服装店漓尚服饰买衣服换装衣橱nikoniko',
    },
  },
  {
    shopId: 'shop_shizijie_ebike',
    kind: 'ebike',
    displayName: '漓行电驴行 · 十字街总店',
    brandName: '漓行电驴行',
    landmarkId: 'shizijie',
    // Post-#90 shizijie anchor (-879.750, 151.300, -169.626), NE_ANNEX bays 3+4 wall center local (100.35, 6.82):
    // outward normal n = (-0.2296, +0.9733), tangent u = (+0.9733, +0.2296), cleanly between camphor trees
    // Tree_M (88.0, 6.5) and Tree_E (108.0, 11.2). Runtime Y resolves dynamically via ground/supportAt.
    triggerPos: [-780.05, 151.99, -160.08], // u=0.0, d=+2.8m
    triggerRadius: 3.4,
    hintRadius: 18,
    facingYaw: 2.91, // Three.js -Z facing +n (south-southwest toward Jiefang East Rd)
    cameraRig: {
      // Forward on open sidewalk at d=+4.2m so full 360° orbit never clips NE_ANNEX wall/piers.
      stagePos: [-780.37, 151.99, -158.71],
      // Camera azimuth on street side (-0.92 rad -> classic 3/4 front-side showcase framing with storefront behind).
      stageYaw: -0.92,
      orbitRadius: 3.35,
      minRadius: 2.2,
      maxRadius: 4.5,
      pitchRad: 0.16,
      targetHeightOffset: 0.72,
      fovDeg: 42,
    },
    // Three raised granite exhibition plinths on expanded ne_apron (u = -3.0 / 0.0 / +3.0, d = +1.75m, 3/4 dealership display stance)
    displayStands: [
      {id: 'stand_lijiang_light', modelId: 'lijiang_light', pos: [-782.72, 151.99, -161.79], yaw: 2.18, plinthHeight: 0.16},
      {id: 'stand_city_range', modelId: 'city_range', pos: [-779.80, 151.99, -161.10], yaw: 2.38, plinthHeight: 0.16},
      {id: 'stand_xiangshan_gt', modelId: 'xiangshan_gt', pos: [-776.88, 151.99, -160.41], yaw: 3.64, plinthHeight: 0.16},
    ],
    // u=+1.5, d=+5.2m on open sidewalk next to non-motorized lane; -Z yaw=+1.3391 faces west along Jiefang East Rd
    deliveryBay: {x: -779.14, y: 151.99, z: -157.40, yaw: 1.3391},
    // u=0.0, d=+12.4m on Jiefang East Rd carriageway (vehicles.bin pavement=True), -Z yaw=+1.3391 faces west
    testRideSpawn: {x: -782.25, y: 151.84, z: -150.73, yaw: 1.3391},
    // u=-6.2, d=+3.2m directly in front of dual-gun fast charger at (u=-6.2, d=+1.70), non-overlapping with triggerPos
    serviceBay: {x: -786.17, y: 151.87, z: -161.11, radius: 2.6},
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
    ...(def.displayStands ? {displayStands: def.displayStands.map(st => ({...st, pos: [...st.pos] as [number, number, number]}))} : {}),
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
