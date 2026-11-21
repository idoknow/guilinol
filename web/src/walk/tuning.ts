/**
 * Pure-data configuration tables and helpers for two-wheel tiers (normal/shared e-bike & bicycle),
 * tactile manual gears, consumption physics, low-battery limp protection, crash thresholds, and upgrade hooks.
 * Kept dependency-free so physics (`ride.ts`), HUD/FX (`ebike-fx.ts`), and unit tests can share it cleanly.
 */

export type EbikeVehicleType = 'normal' | 'shared'
export type EbikeTier = EbikeVehicleType
export type PersonalEbikeTierId = 'lijiang_light' | 'city_range' | 'xiangshan_gt'
export type EbikeBatteryStatus = 'normal' | 'low' | 'critical' | 'empty'

export interface EbikeGearProfile {
  readonly id: number
  readonly label: string
  readonly hint: string
  readonly maxKmh: number
  readonly accelScale: number
  readonly launchTorque: number
  readonly throttleExp: number
  readonly leanScale: number
  readonly wheelieGain: number
  readonly uphillMul: number
  readonly drainScale: number
}

export interface EbikeUpgradeMods {
  motorLevel?: number
  controllerLevel?: number
  batteryLevel?: number
  topKmhBonus?: number
  accelMul?: number
  capacityScale?: number
  drainMul?: number
  maxCapKmh?: number
}

export interface NormalizedEbikeUpgrades {
  motorLevel: number
  controllerLevel: number
  batteryLevel: number
  topKmhBonus: number
  accelMul: number
  capacityScale: number
  drainMul: number
}

export interface ResolvedEbikeProfile {
  vehicleType: EbikeVehicleType
  tier: EbikeVehicleType
  isShared: boolean
  tierLabel: string
  badge: string
  stockMaxKmh: number
  tierMaxKmh: number
  compliantCapKmh: number
  defaultGear: number
  allowUpgrades: boolean
  capacityScale: number
  accelMul: number
  drainMul: number
  wheelieTorqueMul: number
  gears: readonly EbikeGearProfile[]
  upgrades: NormalizedEbikeUpgrades
  upgraded: boolean
}

export const EBIKE_COMPLIANT_CAP_KMH = 25
export const EBIKE_DEFAULT_GEAR = 2
export const BICYCLE_DEFAULT_GEAR = 2
export const EBIKE_STANDARD_MAX_KMH = 50
export const EBIKE_SHARED_MAX_KMH = 40
/** Hard anti-tunneling top-speed ceiling for personal upgraded e-bikes (IDOK-91 gate <= 70 km/h). */
export const EBIKE_UPGRADE_MAX_KMH = 70

export const bicycleGearConfigs: readonly EbikeGearProfile[] = [
  {id: 1, label: '1挡', hint: '爬坡', maxKmh: 14, accelScale: 1.42, launchTorque: 1.55, throttleExp: 1.05, leanScale: .76, wheelieGain: 1.15, uphillMul: .52, drainScale: 0},
  {id: 2, label: '2挡', hint: '巡航', maxKmh: 21, accelScale: 1.00, launchTorque: 1.00, throttleExp: 1.00, leanScale: .95, wheelieGain: .76,  uphillMul: 1.00, drainScale: 0},
  {id: 3, label: '3挡', hint: '冲刺', maxKmh: 29, accelScale: .80,  launchTorque: .64,  throttleExp: .90,  leanScale: 1.18, wheelieGain: .48,  uphillMul: 1.38, drainScale: 0},
]

export const ebikeTierConfigs: Record<EbikeVehicleType, {
  tierLabel: string
  badge: string
  stockMaxKmh: number
  allowUpgrades: boolean
  capacityScale: number
  gears: readonly EbikeGearProfile[]
}> = {
  normal: {
    tierLabel: '普通电车',
    badge: '电摩',
    stockMaxKmh: EBIKE_STANDARD_MAX_KMH,
    allowUpgrades: true,
    capacityScale: 1,
    gears: [
      {id: 1, label: 'D1', hint: '经济', maxKmh: 16, accelScale: .56, launchTorque: .60, throttleExp: 1.40, leanScale: .72, wheelieGain: .26, uphillMul: 1.15, drainScale: .52},
      {id: 2, label: 'D2', hint: '合规', maxKmh: EBIKE_COMPLIANT_CAP_KMH, accelScale: .96, launchTorque: .94, throttleExp: 1.12, leanScale: .92, wheelieGain: .64, uphillMul: 1.00, drainScale: .90},
      {id: 3, label: 'D3', hint: '提速', maxKmh: 38, accelScale: 1.42, launchTorque: 1.38, throttleExp: .94,  leanScale: 1.14, wheelieGain: 1.06, uphillMul: .86, drainScale: 1.65},
      {id: 4, label: 'S',  hint: '运动', maxKmh: EBIKE_STANDARD_MAX_KMH, accelScale: 1.86, launchTorque: 1.82, throttleExp: .78, leanScale: 1.32, wheelieGain: 1.46, uphillMul: .72, drainScale: 3.10},
    ],
  },
  shared: {
    tierLabel: '共享电车',
    badge: '共享',
    stockMaxKmh: EBIKE_SHARED_MAX_KMH,
    allowUpgrades: false,
    capacityScale: .72,
    gears: [
      {id: 1, label: 'D1', hint: '缓行', maxKmh: 15, accelScale: .54, launchTorque: .58, throttleExp: 1.42, leanScale: .70, wheelieGain: .22, uphillMul: 1.20, drainScale: .58},
      {id: 2, label: 'D2', hint: '合规', maxKmh: EBIKE_COMPLIANT_CAP_KMH, accelScale: .92, launchTorque: .90, throttleExp: 1.14, leanScale: .90, wheelieGain: .56, uphillMul: 1.00, drainScale: .95},
      {id: 3, label: 'D3', hint: '畅行', maxKmh: 33, accelScale: 1.22, launchTorque: 1.18, throttleExp: .98,  leanScale: 1.08, wheelieGain: .88, uphillMul: .90, drainScale: 1.65},
      {id: 4, label: 'S',  hint: '极速', maxKmh: EBIKE_SHARED_MAX_KMH, accelScale: 1.48, launchTorque: 1.42, throttleExp: .86, leanScale: 1.22, wheelieGain: 1.12, uphillMul: .80, drainScale: 2.75},
    ],
  },
}

/** Battery consumption & low-battery limp thresholds (normalized 0..100%). */
export const ebikeBatteryConfig = {
  idleDrainPerSec: .002,
  cruiseDrainPerSec: .028,
  speedAeroDrainPerSec: .032,
  accelDrainPerAccel: .055,
  accelNoiseThreshold: .5,
  wheelieDrainPerSec: .32,
  cornerLeanDrainPerSec: .14,
  tuckDrainPerSec: .10,
  climbDrainPerSlope: 4.5,
  regenOnBrakePerSec: .018,
  lowThresholdPct: 20,
  criticalThresholdPct: 10,
  lowCapKmh: 22,
  criticalCapKmh: 16,
  emptyCapKmh: 10,
  lowAccelMul: .72,
  emptyAccelMul: .50,
}

const clampLevel = (v: number | undefined) => Math.max(0, Math.min(3, Math.round(Number.isFinite(v) ? v! : 0)))
const posFactor = (v: number | undefined, fallback = 1) => Number.isFinite(v) && v! > 0 ? v! : fallback

/** Maps static paint index (`paint % 4 === 1` -> shared fleet) or explicit metadata to `'shared' | 'normal'`. */
export function resolveEbikeKind(paint: number, explicitType?: unknown): EbikeVehicleType {
  if (explicitType === 'shared') return 'shared'
  if (explicitType === 'normal' || explicitType === 'standard' || explicitType === 'private') return 'normal'
  return ((paint % 4) + 4) % 4 === 1 ? 'shared' : 'normal'
}

export const resolveEbikeTier = resolveEbikeKind

/** Derives effective gear speed caps, acceleration scaling, and pack capacity from tier + upgrades. */
export function resolveEbikeProfile(vehicleType: EbikeVehicleType, mods?: EbikeUpgradeMods | null): ResolvedEbikeProfile {
  const base = ebikeTierConfigs[vehicleType]
  if (!base.allowUpgrades) {
    return {
      vehicleType,
      tier: vehicleType,
      isShared: true,
      tierLabel: base.tierLabel,
      badge: base.badge,
      stockMaxKmh: base.stockMaxKmh,
      tierMaxKmh: base.stockMaxKmh,
      compliantCapKmh: EBIKE_COMPLIANT_CAP_KMH,
      defaultGear: EBIKE_DEFAULT_GEAR,
      allowUpgrades: false,
      capacityScale: base.capacityScale,
      accelMul: 1,
      drainMul: 1,
      wheelieTorqueMul: 1,
      gears: base.gears,
      upgrades: {motorLevel: 0, controllerLevel: 0, batteryLevel: 0, topKmhBonus: 0, accelMul: 1, capacityScale: 1, drainMul: 1},
      upgraded: false,
    }
  }

  const motorLevel = clampLevel(mods?.motorLevel)
  const controllerLevel = clampLevel(mods?.controllerLevel)
  const batteryLevel = clampLevel(mods?.batteryLevel)
  const topKmhBonus = Number.isFinite(mods?.topKmhBonus) ? Math.max(0, mods!.topKmhBonus!) : 0
  const accelMul = posFactor(mods?.accelMul) * (1 + motorLevel * .09 + controllerLevel * .07)
  const capacityScale = base.capacityScale * posFactor(mods?.capacityScale) * (1 + batteryLevel * .35)
  const drainMul = posFactor(mods?.drainMul) * (1 + motorLevel * .08 - batteryLevel * .05)
  const ceiling = Number.isFinite(mods?.maxCapKmh)
    ? Math.max(base.stockMaxKmh, Math.min(EBIKE_UPGRADE_MAX_KMH, mods!.maxCapKmh!))
    : EBIKE_UPGRADE_MAX_KMH
  const extraKmh = motorLevel * 4 + controllerLevel * 5 + topKmhBonus
  const tierMaxKmh = Math.min(ceiling, base.stockMaxKmh + extraKmh)
  const d3Extra = Math.max(0, tierMaxKmh - base.stockMaxKmh) * .45
  const gears: EbikeGearProfile[] = base.gears.map(g =>
    g.id === 4 ? {...g, maxKmh: tierMaxKmh}
      : g.id === 3 && d3Extra > 0 ? {...g, maxKmh: +(g.maxKmh + d3Extra).toFixed(1)}
        : g,
  )
  const upgraded = motorLevel > 0 || controllerLevel > 0 || batteryLevel > 0 || topKmhBonus > 0
  return {
    vehicleType,
    tier: vehicleType,
    isShared: false,
    tierLabel: base.tierLabel,
    badge: base.badge,
    stockMaxKmh: base.stockMaxKmh,
    tierMaxKmh,
    compliantCapKmh: EBIKE_COMPLIANT_CAP_KMH,
    defaultGear: EBIKE_DEFAULT_GEAR,
    allowUpgrades: true,
    capacityScale,
    accelMul,
    drainMul: Math.max(.55, drainMul),
    wheelieTorqueMul: 1 + motorLevel * .10 + controllerLevel * .08,
    gears,
    upgrades: {
      motorLevel,
      controllerLevel,
      batteryLevel,
      topKmhBonus,
      accelMul: posFactor(mods?.accelMul),
      capacityScale: posFactor(mods?.capacityScale),
      drainMul: posFactor(mods?.drainMul),
    },
    upgraded,
  }
}

export interface PersonalEbikeTuningSpec {
  readonly id: PersonalEbikeTierId
  readonly tierLabel: string
  readonly badge: string
  readonly stockGearsKmh: readonly [number, number, number, number]
  readonly hardCapKmh: number
  readonly baseCapacityScale: number
  readonly baseAccelMul: number
  readonly baseDrainMul: number
  readonly maxMotorLevel: 1 | 2 | 3
  readonly maxControllerLevel: 1 | 2 | 3
  readonly maxBatteryLevel: 2 | 3
}

export const personalEbikeTuningConfigs: Record<PersonalEbikeTierId, PersonalEbikeTuningSpec> = {
  lijiang_light: {
    id: 'lijiang_light',
    tierLabel: '漓江小轻骑',
    badge: '轻骑',
    stockGearsKmh: [16, 25, 36, 42],
    hardCapKmh: 50,
    baseCapacityScale: 1.05,
    baseAccelMul: 1.0,
    baseDrainMul: 0.95,
    maxMotorLevel: 1,
    maxControllerLevel: 1,
    maxBatteryLevel: 2,
  },
  city_range: {
    id: 'city_range',
    tierLabel: '城心续航摩',
    badge: '续航',
    stockGearsKmh: [16, 25, 38, 50],
    hardCapKmh: 60,
    baseCapacityScale: 1.45,
    baseAccelMul: 1.1,
    baseDrainMul: 0.85,
    maxMotorLevel: 2,
    maxControllerLevel: 2,
    maxBatteryLevel: 3,
  },
  xiangshan_gt: {
    id: 'xiangshan_gt',
    tierLabel: '象山疾风电摩',
    badge: '旗舰',
    stockGearsKmh: [18, 25, 42, 55],
    hardCapKmh: EBIKE_UPGRADE_MAX_KMH,
    baseCapacityScale: 1.65,
    baseAccelMul: 1.22,
    baseDrainMul: 0.95,
    maxMotorLevel: 3,
    maxControllerLevel: 3,
    maxBatteryLevel: 3,
  },
}

/**
 * Resolves a personal 3-tier e-bike profile (`lijiang_light` / `city_range` / `xiangshan_gt`)
 * into the standard `ResolvedEbikeProfile` consumed by `ride.ts`, clamping every upgrade axis
 * to the model's ceiling and strictly enforcing `<= EBIKE_UPGRADE_MAX_KMH (70 km/h)`.
 */
export function resolvePersonalEbikeProfile(
  modelId: PersonalEbikeTierId,
  mods?: EbikeUpgradeMods | null,
  durabilityPct = 100,
): ResolvedEbikeProfile {
  const spec = personalEbikeTuningConfigs[modelId]
  const baseNormal = ebikeTierConfigs.normal
  const motorLevel = Math.min(spec.maxMotorLevel, clampLevel(mods?.motorLevel))
  const controllerLevel = Math.min(spec.maxControllerLevel, clampLevel(mods?.controllerLevel))
  const batteryLevel = Math.min(spec.maxBatteryLevel, clampLevel(mods?.batteryLevel))
  const topKmhBonus = Number.isFinite(mods?.topKmhBonus) ? Math.max(0, mods!.topKmhBonus!) : 0
  const lowConditionMul = durabilityPct < 40 ? 0.9 : 1.0
  const accelMul = spec.baseAccelMul * posFactor(mods?.accelMul) * (1 + motorLevel * 0.09 + controllerLevel * 0.07) * lowConditionMul
  const capacityScale = spec.baseCapacityScale * posFactor(mods?.capacityScale) * (1 + batteryLevel * 0.35)
  const drainMul = Math.max(0.55, spec.baseDrainMul * posFactor(mods?.drainMul) * (1 + motorLevel * 0.08 - batteryLevel * 0.05))
  const hardCeiling = Math.min(EBIKE_UPGRADE_MAX_KMH, spec.hardCapKmh)
  const stockS = spec.stockGearsKmh[3]
  const extraKmh = motorLevel * 4 + controllerLevel * 5 + topKmhBonus
  const tierMaxKmh = Math.min(hardCeiling, stockS + extraKmh)
  const d3Extra = Math.max(0, tierMaxKmh - stockS) * 0.45
  const gears: EbikeGearProfile[] = baseNormal.gears.map((g, idx) => {
    const stockCap = spec.stockGearsKmh[idx] ?? g.maxKmh
    if (g.id === 4) return {...g, maxKmh: tierMaxKmh}
    if (g.id === 3) return {...g, maxKmh: +(Math.min(tierMaxKmh - 2, stockCap + d3Extra)).toFixed(1)}
    return {...g, maxKmh: stockCap}
  })
  const upgraded = motorLevel > 0 || controllerLevel > 0 || batteryLevel > 0 || topKmhBonus > 0
  return {
    vehicleType: 'normal',
    tier: 'normal',
    isShared: false,
    tierLabel: spec.tierLabel,
    badge: spec.badge,
    stockMaxKmh: stockS,
    tierMaxKmh,
    compliantCapKmh: EBIKE_COMPLIANT_CAP_KMH,
    defaultGear: EBIKE_DEFAULT_GEAR,
    allowUpgrades: true,
    capacityScale,
    accelMul,
    drainMul,
    wheelieTorqueMul: (1 + motorLevel * 0.1 + controllerLevel * 0.08) * lowConditionMul,
    gears,
    upgrades: {
      motorLevel,
      controllerLevel,
      batteryLevel,
      topKmhBonus,
      accelMul: posFactor(mods?.accelMul),
      capacityScale: posFactor(mods?.capacityScale),
      drainMul: posFactor(mods?.drainMul),
    },
    upgraded,
  }
}
