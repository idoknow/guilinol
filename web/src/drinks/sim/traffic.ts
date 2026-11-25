import type { CustomerRoleKind, DrinkDayPhase, DrinksDistrictCrowdThinning, Point2D } from './types.ts'

export interface TrafficProfile {
  phase: DrinkDayPhase
  isOpen: boolean
  /** Expected new arrivals per simulated minute. */
  arrivalsPerMin: number
  /** Target customer concurrency (clerks are additive). */
  targetCustomers: number
  roleWeights: Record<CustomerRoleKind, number>
}

export function normalizeHour(hour: number): number {
  if (!Number.isFinite(hour)) return 12
  return ((hour % 24) + 24) % 24
}

export function getDrinkDayPhase(hour: number, open24h = false): DrinkDayPhase {
  const h = normalizeHour(hour)
  if (!open24h && (h < 7.5 || h >= 23.5)) return 'closed'
  if (h >= 7.5 && h < 11.2) return 'morning'
  if (h >= 11.2 && h < 14.0) return 'midday'
  if (h >= 14.0 && h < 17.8) return 'afternoon'
  if (h >= 17.8 && h < 22.0) return 'evening'
  return 'night'
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t))
}

interface TrafficKeyframe {
  hour: number
  arrivalsPerMin: number
  targetCustomers: number
}

export const MAX_CONCURRENT_CUSTOMERS = 8
export const MAX_DOORWAY_QUEUE = 4
export const MAX_OUTDOOR_CUSTOMERS = 3
export const MAX_PATIO_SEATED = 2

/**
 * 2.80m 宽玻璃双开正门无遮挡净空走廊（相对 entrance 中心点）：
 * - halfWidthM = 1.55m -> 覆盖 [-1.35, +1.75]（门洞 [-1.20, +1.60] + 两侧 0.15m 余量）
 * - innerDepthM = 1.05m -> 门内至 z = 1.75m 禁止静止停留/排队
 * - outerDepthM = 1.55m -> 门外至 z = 4.35m（避让外开玻璃门扇 z <= 4.01m）
 */
export const DRINKS_DOORWAY_CLEARANCE = Object.freeze({
  halfWidthM: 1.55,
  innerDepthM: 1.05,
  outerDepthM: 1.55,
})

/**
 * 解放东路门前黄色盲道 [39]（局部 z ∈ [+5.50, +6.05]）禁占区：
 * 门店所有顾客/店员活动与外摆路径均限制在 safeMaxZ (5.22m) 以南，绝不占用盲道。
 */
export const DRINKS_TACTILE_STRIP_BAND = Object.freeze({
  minZ: 5.4,
  maxZ: 6.2,
  safeMaxZ: 5.22,
})

export function isInDoorwayClearance(x: number, z: number, entrance: Point2D): boolean {
  return (
    Math.abs(x - entrance.x) <= DRINKS_DOORWAY_CLEARANCE.halfWidthM &&
    z >= entrance.z - DRINKS_DOORWAY_CLEARANCE.innerDepthM &&
    z <= entrance.z + DRINKS_DOORWAY_CLEARANCE.outerDepthM
  )
}

export function isInTactileStripBand(z: number): boolean {
  return z >= DRINKS_TACTILE_STRIP_BAND.minZ && z <= DRINKS_TACTILE_STRIP_BAND.maxZ
}

export const DRINKS_DISTRICT_THINNING_DEFAULTS: Readonly<
  Record<string, { readonly outerRadius: number; readonly innerRadius: number; readonly maxInOuter: number }>
> = Object.freeze({
  // 王城商厦北侧转角（解放东路+十字街）：内圈 9.5m 覆盖门洞、外摆与盲道 [39]，外圈 24m 最多保留 2 名路人
  wangcheng_mall: Object.freeze({ innerRadius: 9.5, outerRadius: 24, maxInOuter: 2 }),
  // 正阳路步行街片区：内圈 8.5m 净空，外圈 20m 最多保留 3 名路人
  zhengyang_208: Object.freeze({ innerRadius: 8.5, outerRadius: 20, maxInOuter: 3 }),
})

export function buildDrinksDistrictCrowdThinning(site: {
  readonly id?: string
  readonly worldX: number
  readonly worldZ: number
}): DrinksDistrictCrowdThinning {
  const districtId = site.id && site.id in DRINKS_DISTRICT_THINNING_DEFAULTS ? site.id : 'wangcheng_mall'
  const preset = DRINKS_DISTRICT_THINNING_DEFAULTS[districtId]!
  return {
    districtId,
    x: site.worldX,
    z: site.worldZ,
    innerRadius: preset.innerRadius,
    outerRadius: preset.outerRadius,
    maxInOuter: preset.maxInOuter,
  }
}

// Balanced Wangcheng beverage shop traffic curve:
// Keeps shop lively with steady turnover while strictly respecting the comfortable
// indoor/outdoor crowd cap (<= 8 concurrent customers, <= 4 doorway/counter queue).
const TRAFFIC_KEYS: readonly TrafficKeyframe[] = [
  { hour: 0.0, arrivalsPerMin: 0.0, targetCustomers: 0 },
  { hour: 7.49, arrivalsPerMin: 0.0, targetCustomers: 0 },
  { hour: 7.5, arrivalsPerMin: 1.4, targetCustomers: 2 },
  { hour: 9.0, arrivalsPerMin: 2.2, targetCustomers: 3 },
  { hour: 10.5, arrivalsPerMin: 3.0, targetCustomers: 4 },
  { hour: 12.5, arrivalsPerMin: 4.8, targetCustomers: 6 },
  { hour: 14.0, arrivalsPerMin: 4.5, targetCustomers: 6 },
  { hour: 15.5, arrivalsPerMin: 5.8, targetCustomers: 7 },
  { hour: 17.5, arrivalsPerMin: 4.8, targetCustomers: 6 },
  { hour: 19.5, arrivalsPerMin: 6.4, targetCustomers: 8 },
  { hour: 21.0, arrivalsPerMin: 5.0, targetCustomers: 6 },
  { hour: 22.3, arrivalsPerMin: 2.4, targetCustomers: 3 },
  { hour: 23.49, arrivalsPerMin: 0.9, targetCustomers: 2 },
  { hour: 23.5, arrivalsPerMin: 0.0, targetCustomers: 0 },
  { hour: 24.0, arrivalsPerMin: 0.0, targetCustomers: 0 },
]

export function getDrinksTrafficProfile(hour: number, open24h = false): TrafficProfile {
  const h = normalizeHour(hour)
  const phase = getDrinkDayPhase(h, open24h)
  const isOpen = phase !== 'closed'

  let arrivalsPerMin = 0
  let targetCustomers = 0

  if (isOpen) {
    let idx = 0
    while (idx + 1 < TRAFFIC_KEYS.length && TRAFFIC_KEYS[idx + 1]!.hour <= h) {
      idx++
    }
    const k0 = TRAFFIC_KEYS[idx]!
    const k1 = TRAFFIC_KEYS[Math.min(idx + 1, TRAFFIC_KEYS.length - 1)]!
    const span = Math.max(0.001, k1.hour - k0.hour)
    const t = (h - k0.hour) / span
    arrivalsPerMin = lerp(k0.arrivalsPerMin, k1.arrivalsPerMin, t)
    targetCustomers = Math.min(MAX_CONCURRENT_CUSTOMERS, Math.round(lerp(k0.targetCustomers, k1.targetCustomers, t)))

    if (open24h && (h < 7.5 || h >= 23.5)) {
      arrivalsPerMin = 0.45
      targetCustomers = 2
    }
  }

  let roleWeights: Record<CustomerRoleKind, number>
  switch (phase) {
    case 'morning':
      roleWeights = { student: 2.4, office: 3.2, tourist: 1.2, local: 1.4, rider: 1.5 }
      break
    case 'midday':
      roleWeights = { student: 2.8, office: 2.5, tourist: 2.2, local: 1.3, rider: 2.4 }
      break
    case 'afternoon':
      roleWeights = { student: 3.0, office: 1.8, tourist: 3.4, local: 1.6, rider: 2.2 }
      break
    case 'evening':
      roleWeights = { student: 2.4, office: 1.4, tourist: 3.8, local: 2.4, rider: 2.0 }
      break
    case 'night':
      roleWeights = { student: 1.8, office: 1.0, tourist: 2.5, local: 2.0, rider: 2.2 }
      break
    default:
      roleWeights = { student: 1, office: 1, tourist: 1, local: 1, rider: 1 }
      break
  }

  return {
    phase,
    isOpen,
    arrivalsPerMin,
    targetCustomers,
    roleWeights,
  }
}
