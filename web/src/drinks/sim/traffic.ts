import type { CustomerRoleKind, DrinkDayPhase } from './types.ts'

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

// Authentic Wangcheng flagship beverage traffic curve:
// Deep valley overnight (0 after 23:30), gentle morning ramp, lunch bump,
// strong afternoon tea peak (15:00), and flagship evening street-stroll peak (19:30-20:30).
const TRAFFIC_KEYS: readonly TrafficKeyframe[] = [
  { hour: 0.0, arrivalsPerMin: 0.0, targetCustomers: 0 },
  { hour: 7.49, arrivalsPerMin: 0.0, targetCustomers: 0 },
  { hour: 7.5, arrivalsPerMin: 1.5, targetCustomers: 4 },
  { hour: 9.0, arrivalsPerMin: 3.2, targetCustomers: 7 },
  { hour: 10.5, arrivalsPerMin: 4.5, targetCustomers: 10 },
  { hour: 12.5, arrivalsPerMin: 10.5, targetCustomers: 18 },
  { hour: 14.0, arrivalsPerMin: 9.5, targetCustomers: 17 },
  { hour: 15.5, arrivalsPerMin: 16.5, targetCustomers: 24 },
  { hour: 17.5, arrivalsPerMin: 11.0, targetCustomers: 18 },
  { hour: 19.5, arrivalsPerMin: 19.0, targetCustomers: 25 },
  { hour: 21.0, arrivalsPerMin: 14.5, targetCustomers: 21 },
  { hour: 22.3, arrivalsPerMin: 5.5, targetCustomers: 9 },
  { hour: 23.49, arrivalsPerMin: 1.2, targetCustomers: 3 },
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
    targetCustomers = Math.round(lerp(k0.targetCustomers, k1.targetCustomers, t))

    if (open24h && (h < 7.5 || h >= 23.5)) {
      arrivalsPerMin = 0.45
      targetCustomers = 3
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
