import type {
  SzjAtmosMetrics,
  SzjAtmosPresetName,
  SzjAtmosRealitySpec,
} from '../atmos/index.ts'
import type {
  SzjIndoorScene,
  SzjLayout,
  SzjShop,
  SzjStairId,
} from '../contract.ts'
import type { SzjCrowdMetrics } from '../crowd/index.ts'
import type { SzjHangingSign, SzjWayfinding } from '../wayfinding/index.ts'

export type {
  SzjAtmosMetrics,
  SzjAtmosPresetName,
  SzjAtmosRealitySpec,
  SzjCrowdMetrics,
  SzjHangingSign,
  SzjWayfinding,
}

export interface SzjPlayerSnapshot {
  readonly x: number
  readonly footY: number
  readonly eyeY: number
  readonly z: number
  readonly yaw: number
  readonly pitch: number
  readonly ceilingClearanceM: number
  readonly activeStairId: SzjStairId | null
  readonly activeShopId: string | null
  readonly collisionContacts: number
}

export interface SzjSignRuntimeMetrics {
  readonly wayfindingSignCount: number
  readonly inWorldSignCount: number
  readonly faceCount: number
  readonly rodCount: number
  readonly drawCalls: number
  readonly triangles: number
  readonly wallWayfindingPlaqueCount: number
  readonly safetyExitPlaqueCount: number
  readonly visibleSignIds: readonly string[]
  readonly visibleSignCount: number
}

export interface CreateSzjIndoorSceneOptions {
  readonly layout?: SzjLayout
  readonly now?: () => number
  readonly maxNpcs?: number
  readonly seed?: string | number
  readonly atmosPreset?: SzjAtmosPresetName
  readonly atmosSpec?: Partial<SzjAtmosRealitySpec>
}

export interface SzjExtendedIndoorScene extends SzjIndoorScene {
  renderFrame(): boolean
  getPlayerSnapshot(): SzjPlayerSnapshot
  getCrowdMetrics(): SzjCrowdMetrics | null
  getAtmosMetrics(): SzjAtmosMetrics | null
  getWayfinding(): SzjWayfinding
  getHangingSigns(): readonly SzjHangingSign[]
  getVisibleHangingSigns(maxDistM?: number): readonly SzjHangingSign[]
  getSignMetrics(): SzjSignRuntimeMetrics
  getLayout(): SzjLayout
  getActiveShop(): SzjShop | null
}

export function normalizeAngleRad(rad: number): number {
  const twoPi = Math.PI * 2
  return ((((rad + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI
}
