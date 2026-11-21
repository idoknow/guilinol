import type {NearbyShopHit, ShopTriggerDef} from '../game/shops'

export type InteractActionKind =
  | 'none'
  | 'dismount_car'
  | 'dismount_bike'
  | 'dismount_free_boat'
  | 'disembark_route'
  | 'pickup_downed'
  | 'open_shop'
  | 'open_service'
  | 'mount_car'
  | 'mount_bike'
  | 'mount_free_boat'
  | 'board_route'

export interface NearbyVehicleCandidate {
  kind: 'car' | 'bike' | 'bicycle'
  downed: boolean
  distance: number
  ownership?: 'shared' | 'personal' | 'test_ride'
  vehicleType?: 'shared' | 'normal'
  modelName?: string
}

export interface InteractArbitrationContext {
  active: boolean
  modalOrShopOpen: boolean
  crashBusy: boolean // standUpSession || pickupSession || crashedRide
  crashedRide?: boolean
  pickupText?: string
  aboard: {
    car: boolean
    bike: boolean
    freeBoat: boolean
    route: boolean
    disembarkQueued?: boolean
  }
  nearbyShop: NearbyShopHit | null
  nearbyVehicle: NearbyVehicleCandidate | null
  nearbyFreeBoat: {name: string; kind: string; distance: number} | null
  nearbyRoute: {start: string; distance: number} | null
}

export interface InteractDecision {
  action: InteractActionKind
  label: string
  hintToast?: string
  shop?: ShopTriggerDef
  ebikeTierAttr?: 'shared' | 'normal'
  ownershipAttr?: 'shared' | 'personal' | 'test_ride'
  suppressVehicleHintRing: boolean
}

/**
 * Unified 7-level single-consumer `[F]` interaction arbiter (IDOK-122 / IDOK-124 / IDOK-128).
 * Strict short-circuit priority:
 *   0. Modal / shop / overlay open -> block all world `[F]`
 *   1. Crash stand-up / pickup animation busy -> lock `[F]`
 *   2. Aboard any vehicle/boat -> dismount ONLY (never enter shop while mounted!)
 *   3. On foot near downed two-wheeler -> prioritize pickup
 *   4. On foot inside shop or service bay trigger -> prioritize shop/service (suppresses roadside shared bike within 4.2 m)
 *   5. On foot near mountable vehicle -> mount (personal bike prioritized in `vehicles.ts` with +0.6 m bias)
 *   6. On foot near free boat or cruise dock -> board boat
 */
export function resolveInteractDecision(ctx: InteractArbitrationContext): InteractDecision {
  if (!ctx.active || ctx.modalOrShopOpen) {
    return {action: 'none', label: '', suppressVehicleHintRing: true}
  }
  if (ctx.crashBusy) {
    return {
      action: 'none',
      label: ctx.pickupText ?? '',
      suppressVehicleHintRing: true,
    }
  }

  // Priority 2: Aboard a vehicle or boat -> dismount only
  if (ctx.aboard.car) {
    return {
      action: 'dismount_car',
      label: '下车',
      hintToast: ctx.nearbyShop?.inReach ? '请先按 F 下车再进店' : undefined,
      suppressVehicleHintRing: true,
    }
  }
  if (ctx.aboard.bike) {
    if (ctx.crashedRide) {
      return {action: 'none', label: '', suppressVehicleHintRing: true}
    }
    return {
      action: 'dismount_bike',
      label: '下车',
      hintToast: ctx.nearbyShop?.inReach ? '请先按 F 下车再进店' : undefined,
      suppressVehicleHintRing: true,
    }
  }
  if (ctx.aboard.freeBoat) {
    return {action: 'dismount_free_boat', label: '靠岸下船', suppressVehicleHintRing: true}
  }
  if (ctx.aboard.route) {
    return {
      action: 'disembark_route',
      label: ctx.aboard.disembarkQueued ? '下一站下船' : '下站下船',
      suppressVehicleHintRing: true,
    }
  }

  // Priority 3: On foot near downed two-wheeler -> pickup before shop
  if (ctx.nearbyVehicle && ctx.nearbyVehicle.downed) {
    const label = ctx.nearbyVehicle.kind === 'bicycle' ? '扶起单车' : '扶起电动车'
    return {
      action: 'pickup_downed',
      label,
      ebikeTierAttr: ctx.nearbyVehicle.kind === 'bike' ? ctx.nearbyVehicle.vehicleType : undefined,
      ownershipAttr: ctx.nearbyVehicle.ownership,
      suppressVehicleHintRing: false,
    }
  }

  // Priority 4: On foot inside shop or service bay trigger -> suppress nearby roadside bike mount
  if (ctx.nearbyShop && ctx.nearbyShop.inReach) {
    if (ctx.nearbyShop.quietBlocked) {
      return {
        action: 'none',
        label: '',
        hintToast: '校园安静区内暂不可进店交互',
        suppressVehicleHintRing: true,
      }
    }
    if (ctx.nearbyShop.kind === 'service') {
      return {
        action: 'open_service',
        label: `充电保养 · ${ctx.nearbyShop.shop.brandName}`,
        shop: ctx.nearbyShop.shop,
        suppressVehicleHintRing: true,
      }
    }
    return {
      action: 'open_shop',
      label: `进店 · ${ctx.nearbyShop.shop.brandName}`,
      shop: ctx.nearbyShop.shop,
      suppressVehicleHintRing: true,
    }
  }

  // Priority 5: On foot near mountable vehicle
  if (ctx.nearbyVehicle) {
    if (ctx.nearbyVehicle.kind === 'car') {
      return {action: 'mount_car', label: '开车', suppressVehicleHintRing: false}
    }
    if (ctx.nearbyVehicle.kind === 'bicycle') {
      return {action: 'mount_bike', label: '骑单车', suppressVehicleHintRing: false}
    }
    const own = ctx.nearbyVehicle.ownership ?? (ctx.nearbyVehicle.vehicleType === 'shared' ? 'shared' : 'shared')
    const label =
      own === 'personal'
        ? `骑我的电摩${ctx.nearbyVehicle.modelName ? ` · ${ctx.nearbyVehicle.modelName}` : ''}`
        : own === 'test_ride'
          ? '继续试驾'
          : ctx.nearbyVehicle.vehicleType === 'shared'
            ? '骑共享电车'
            : '骑电动车'
    return {
      action: 'mount_bike',
      label,
      ebikeTierAttr: ctx.nearbyVehicle.vehicleType,
      ownershipAttr: own,
      suppressVehicleHintRing: false,
    }
  }

  // Priority 6: Free boat / cruise dock
  const preferFree =
    !!ctx.nearbyFreeBoat &&
    (!ctx.nearbyRoute || ctx.nearbyFreeBoat.distance + 1 < ctx.nearbyRoute.distance)
  if (preferFree && ctx.nearbyFreeBoat) {
    const prefix = ctx.nearbyFreeBoat.kind === 'freeRaft' ? '划竹筏 · ' : '划小船 · '
    return {
      action: 'mount_free_boat',
      label: prefix + ctx.nearbyFreeBoat.name,
      suppressVehicleHintRing: false,
    }
  }
  if (ctx.nearbyRoute) {
    return {
      action: 'board_route',
      label: `上船 · ${ctx.nearbyRoute.start}`,
      suppressVehicleHintRing: false,
    }
  }

  return {action: 'none', label: '', suppressVehicleHintRing: false}
}
