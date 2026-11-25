import { RECRUIT_STANDEE_LOCAL_ANCHOR } from '../props/index.ts'
import { getDrinksBlueprint, type DrinksCandidateId } from '../shop/index.ts'
import type { DrinkShopLayout, PrepStationKind, ShopAnchorsLike } from '../sim/types.ts'

export interface StaffZonePoint {
  readonly x: number
  readonly z: number
  readonly yaw: number
  readonly y?: number
}

export interface StaffStationZone extends StaffZonePoint {
  readonly id: string
  readonly kind: PrepStationKind
  readonly label: string
}

export interface StaffBackstageBounds {
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
}

export interface DrinksStaffAnchors {
  readonly candidate: DrinksCandidateId
  readonly frontCounterHeightM: number
  readonly prepBarHeightM: number
  readonly recruitStandee: StaffZonePoint
  readonly orderDesk: StaffZonePoint
  readonly shakeStation: StaffZonePoint
  readonly prepStations: readonly StaffStationZone[]
  readonly sealStation: StaffZonePoint
  readonly pickupCounter: StaffZonePoint
  readonly pickupCupSlot: StaffZonePoint
  readonly backstageBounds: StaffBackstageBounds
  readonly shopInteriorBounds: StaffBackstageBounds
}

export interface ShopWorkZonesInput {
  recruitStandee?: Partial<StaffZonePoint>
  orderDesk?: Partial<StaffZonePoint>
  shakeStation?: Partial<StaffZonePoint>
  sealStation?: Partial<StaffZonePoint>
  pickupCounter?: Partial<StaffZonePoint>
  pickupCupSlot?: Partial<StaffZonePoint>
  prepBarHeightM?: number
  frontCounterHeightM?: number
  prepStations?: readonly { id?: string; kind: PrepStationKind; x: number; z: number; yaw?: number; y?: number; label?: string }[]
  backstageBounds?: Partial<StaffBackstageBounds>
  shopInteriorBounds?: Partial<StaffBackstageBounds>
}

const STATION_LABELS: Record<PrepStationKind, string> = {
  lemon_ice: '鲜果碎冰区',
  tea_shake: '萃茶摇茶区',
  cream_top: '冰淇淋奶浆区',
}

/**
 * 解析门店内部员工操作区坐标（shop-local 米制）：
 * 优先兼容外部传入的 Hy2 门店操作区坐标或 `sim.getLayout()`，缺失时自动回落至 `shop/blueprint.ts` 精确尺寸。
 */
export function resolveDrinksStaffAnchors(opts?: {
  candidate?: DrinksCandidateId
  shopAnchors?: ShopWorkZonesInput | ShopAnchorsLike | null
  layout?: Partial<DrinkShopLayout> | null
}): DrinksStaffAnchors {
  const candidate = opts?.candidate ?? 'wangcheng_mall'
  const bp = getDrinksBlueprint(candidate).map
  const frontH = bp.front_counter_height?.valueM ?? 0.96
  const prepH = bp.prep_bar_height?.valueM ?? 0.88

  const rawShop = opts?.shopAnchors as (ShopWorkZonesInput & Partial<ShopAnchorsLike>) | undefined
  const layout = opts?.layout

  const firstCashierClerk = layout?.cashiers?.[0]?.clerkPos ?? rawShop?.cashiers?.[0]?.clerkPos
  // Player stands cleanly beside the stationary NPC cashier (auxiliary register slot) to prevent avatar overlap
  const orderDesk: StaffZonePoint = {
    x: rawShop?.orderDesk?.x ?? (firstCashierClerk ? firstCashierClerk.x + 0.78 : -1.45),
    z: rawShop?.orderDesk?.z ?? firstCashierClerk?.z ?? -1.05,
    yaw: rawShop?.orderDesk?.yaw ?? firstCashierClerk?.yaw ?? 0,
    y: rawShop?.orderDesk?.y ?? (rawShop?.frontCounterHeightM ?? frontH),
  }

  const rawPrep = rawShop?.prepStations ?? layout?.prepStations
  const prepStations: StaffStationZone[] =
    rawPrep && rawPrep.length > 0
      ? rawPrep.map((s, idx) => ({
          id: 'id' in s && typeof s.id === 'string' ? s.id : `prep_${s.kind}_${idx}`,
          kind: s.kind,
          label: 'label' in s && typeof s.label === 'string' ? s.label : STATION_LABELS[s.kind],
          x: s.x,
          z: s.z,
          yaw: typeof s.yaw === 'number' ? s.yaw : Math.PI,
          y: 'y' in s && typeof s.y === 'number' ? s.y : prepH,
        }))
      : [
          { id: 'prep_lemon_1', kind: 'lemon_ice', label: STATION_LABELS.lemon_ice, x: -3.2, z: -2.45, yaw: Math.PI, y: prepH },
          { id: 'prep_tea_1', kind: 'tea_shake', label: STATION_LABELS.tea_shake, x: -1.35, z: -2.45, yaw: Math.PI, y: prepH },
          { id: 'prep_tea_2', kind: 'tea_shake', label: STATION_LABELS.tea_shake, x: 0.5, z: -2.45, yaw: Math.PI, y: prepH },
          { id: 'prep_cream_1', kind: 'cream_top', label: STATION_LABELS.cream_top, x: 2.25, z: -2.45, yaw: Math.PI, y: prepH },
        ]

  const teaStation = prepStations.find(s => s.kind === 'tea_shake') ?? prepStations[0]!
  const shakeStation: StaffZonePoint = {
    x: rawShop?.shakeStation?.x ?? teaStation.x,
    z: rawShop?.shakeStation?.z ?? teaStation.z,
    yaw: rawShop?.shakeStation?.yaw ?? Math.PI,
    y: rawShop?.shakeStation?.y ?? prepH,
  }
  // Place portable sealer station cleanly in the open bay between tea_1 and tea_2 (no overlap with static shop sealer)
  const sealStation: StaffZonePoint = {
    x: rawShop?.sealStation?.x ?? (teaStation.x + 0.94),
    z: rawShop?.sealStation?.z ?? teaStation.z,
    yaw: rawShop?.sealStation?.yaw ?? Math.PI,
    y: rawShop?.sealStation?.y ?? prepH,
  }

  const pickupClerk = layout?.pickupClerkPos ?? rawShop?.pickupClerkPos
  const pickupCounter: StaffZonePoint = {
    x: rawShop?.pickupCounter?.x ?? pickupClerk?.x ?? 2.35,
    z: rawShop?.pickupCounter?.z ?? pickupClerk?.z ?? -1.05,
    yaw: rawShop?.pickupCounter?.yaw ?? pickupClerk?.yaw ?? 0,
    y: rawShop?.pickupCounter?.y ?? frontH,
  }

  const slot0 = layout?.pickupSlots?.[0] ?? rawShop?.pickupSlots?.[0]
  const slot1 = layout?.pickupSlots?.[1] ?? rawShop?.pickupSlots?.[1]
  // Midpoint between baked static red decorative cups so handoff cup never overlaps static mesh
  const freePickupX =
    slot0 && slot1 ? (slot0.x + slot1.x) * 0.5 : slot0 ? slot0.x - 0.36 : 1.92
  const pickupCupSlot: StaffZonePoint = {
    x: rawShop?.pickupCupSlot?.x ?? freePickupX,
    z: rawShop?.pickupCupSlot?.z ?? -0.4,
    yaw: rawShop?.pickupCupSlot?.yaw ?? Math.PI,
    y: rawShop?.pickupCupSlot?.y ?? frontH + 0.03,
  }

  const recruitStandee: StaffZonePoint = {
    x: rawShop?.recruitStandee?.x ?? RECRUIT_STANDEE_LOCAL_ANCHOR.x,
    z: rawShop?.recruitStandee?.z ?? RECRUIT_STANDEE_LOCAL_ANCHOR.z,
    yaw: rawShop?.recruitStandee?.yaw ?? RECRUIT_STANDEE_LOCAL_ANCHOR.yaw,
  }

  const backstageBounds: StaffBackstageBounds = {
    minX: rawShop?.backstageBounds?.minX ?? -4.4,
    maxX: rawShop?.backstageBounds?.maxX ?? 4.1,
    minZ: rawShop?.backstageBounds?.minZ ?? -3.0,
    maxZ: rawShop?.backstageBounds?.maxZ ?? -0.78,
  }

  const shopInteriorBounds: StaffBackstageBounds = {
    minX: rawShop?.shopInteriorBounds?.minX ?? -6.6,
    maxX: rawShop?.shopInteriorBounds?.maxX ?? 6.6,
    minZ: rawShop?.shopInteriorBounds?.minZ ?? -6.4,
    maxZ: rawShop?.shopInteriorBounds?.maxZ ?? 2.8,
  }

  return {
    candidate,
    frontCounterHeightM: rawShop?.frontCounterHeightM ?? frontH,
    prepBarHeightM: rawShop?.prepBarHeightM ?? prepH,
    recruitStandee,
    orderDesk,
    shakeStation,
    prepStations,
    sealStation,
    pickupCounter,
    pickupCupSlot,
    backstageBounds,
    shopInteriorBounds,
  }
}

export function pickPrepStationAnchor(anchors: DrinksStaffAnchors, kind: PrepStationKind): StaffStationZone {
  return anchors.prepStations.find(s => s.kind === kind) ?? anchors.prepStations[0]!
}

export function isInsideBackstageArea(x: number, z: number, anchors: DrinksStaffAnchors): boolean {
  const b = anchors.backstageBounds
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ
}

export function isInsideShopInterior(x: number, z: number, anchors: DrinksStaffAnchors): boolean {
  const b = anchors.shopInteriorBounds
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ
}

export function distanceXZ(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz)
}
