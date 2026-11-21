import {isPointInQuietZone} from './quiet-zones'

export type ShopKind = 'clothing' | 'ebike'

export interface ShopCameraRig {
  /** World [x, y, z] center of the 360° display stage (Y is dynamically ground-sampled at runtime) */
  readonly stagePos: readonly [number, number, number]
  readonly stageYaw: number
  readonly orbitRadius: number
  readonly minRadius: number
  readonly maxRadius: number
  readonly pitchRad: number
  readonly targetHeightOffset: number
  readonly fovDeg: number
}

export interface ShopTriggerDef {
  readonly shopId: string
  readonly kind: ShopKind
  /** Unified original Guilin brand name (reconciled across IDOK-122/126/127/128, zero real trademarks) */
  readonly brandName: string
  readonly displayName: string
  readonly landmarkId: string
  readonly triggerPos: readonly [number, number, number]
  readonly triggerRadius: number
  readonly hintRadius: number
  readonly facingYaw: number
  readonly cameraRig: ShopCameraRig
  readonly deliveryBay?: {readonly x: number; readonly y: number; readonly z: number; readonly yaw: number}
  readonly testRideSpawn?: {readonly x: number; readonly y: number; readonly z: number; readonly yaw: number}
  readonly serviceBay?: {readonly x: number; readonly y: number; readonly z: number; readonly radius: number}
  readonly quietCheck: true
  readonly mapMarker: {
    readonly label: string
    readonly badge: string
    readonly keywords: string
  }
}

/**
 * Exact audited coordinates reconciled from Hy2 + Multica-Neon reviews (IDOK-126 / IDOK-127):
 * - `shop_nikoniko_apparel`（「漓尚衣坊」）: nikoniko EastWing_Main bay 5+6 apron (+2.30 m outside wall, 5.72 m off carriageway)
 * - `shop_shizijie_ebike`（「榕城电行」）: shizijie NE_ANNEX bay 3+4 widened apron (+2.80 m trigger, +4.20 m 360° orbit stagePos zero wall-clip)
 * All Y coordinates are nominal baselines; runtime always samples `ground(x, z)` dynamically.
 */
export const SHOP_REGISTRY: readonly ShopTriggerDef[] = [
  {
    shopId: 'shop_nikoniko_apparel',
    kind: 'clothing',
    brandName: '漓尚衣坊',
    displayName: '漓尚衣坊 · 微笑堂店',
    landmarkId: 'nikoniko',
    triggerPos: [-923.97, 151.5, -104.84],
    triggerRadius: 3.2,
    hintRadius: 18,
    facingYaw: -1.8348,
    cameraRig: {
      stagePos: [-923.4, 151.5, -104.68],
      stageYaw: 1.3068,
      orbitRadius: 2.5,
      minRadius: 1.9,
      maxRadius: 3.5,
      pitchRad: 0.14,
      targetHeightOffset: 1.05,
      fovDeg: 44,
    },
    quietCheck: true,
    mapMarker: {
      label: '漓尚衣坊',
      badge: '服饰',
      keywords: '服装店买衣服微笑堂换装衣橱漓尚衣坊',
    },
  },
  {
    shopId: 'shop_shizijie_ebike',
    kind: 'ebike',
    brandName: '榕城电行',
    displayName: '榕城电行 · 十字街总店',
    landmarkId: 'shizijie',
    triggerPos: [-780.04, 151.3, -160.08],
    triggerRadius: 3.2,
    hintRadius: 20,
    facingYaw: 2.9099,
    cameraRig: {
      // Positioned at d=+4.20 m from NE_ANNEX south wall (u=0) so 360° orbitRadius=2.65 m stays >= 1.55 m outside columns.
      stagePos: [-780.36, 151.3, -158.71],
      stageYaw: -0.2317,
      orbitRadius: 2.65,
      minRadius: 1.9,
      maxRadius: 3.6,
      pitchRad: 0.2,
      targetHeightOffset: 0.72,
      fovDeg: 42,
    },
    deliveryBay: {x: -779.13, y: 151.3, z: -157.4, yaw: 1.3391},
    testRideSpawn: {x: -782.25, y: 151.3, z: -150.73, yaw: 1.3391},
    serviceBay: {x: -786.17, y: 151.3, z: -161.12, radius: 2.6},
    quietCheck: true,
    mapMarker: {
      label: '榕城电行',
      badge: '电摩',
      keywords: '电动车店买电摩十字街改装试驾充电榕城电行',
    },
  },
]

export const SHOP_MAP: ReadonlyMap<string, ShopTriggerDef> = new Map(SHOP_REGISTRY.map(s => [s.shopId, s]))

export interface NearbyShopHit {
  shop: ShopTriggerDef
  kind: 'shop' | 'service'
  distance: number
  inReach: boolean
  quietBlocked: boolean
}

export function findNearbyShopOrService(x: number, z: number, footY?: number): NearbyShopHit | null {
  let best: NearbyShopHit | null = null
  for (const shop of SHOP_REGISTRY) {
    const [tx, ty, tz] = shop.triggerPos
    const dyOk = footY === undefined || Math.abs(ty - footY) <= 3.0
    if (dyOk) {
      const dist = Math.hypot(tx - x, tz - z)
      if (dist <= shop.hintRadius && (!best || dist < best.distance)) {
        best = {
          shop,
          kind: 'shop',
          distance: dist,
          inReach: dist <= shop.triggerRadius,
          quietBlocked: shop.quietCheck && isPointInQuietZone(x, z),
        }
      }
    }
    if (shop.serviceBay) {
      const sb = shop.serviceBay
      const sDyOk = footY === undefined || Math.abs(sb.y - footY) <= 3.0
      if (sDyOk) {
        const sDist = Math.hypot(sb.x - x, sb.z - z)
        if (sDist <= shop.hintRadius && (!best || (sDist <= sb.radius && (!best.inReach || sDist < best.distance)) || (!best.inReach && sDist < best.distance))) {
          best = {
            shop,
            kind: 'service',
            distance: sDist,
            inReach: sDist <= sb.radius,
            quietBlocked: shop.quietCheck && isPointInQuietZone(x, z),
          }
        }
      }
    }
  }
  return best
}
