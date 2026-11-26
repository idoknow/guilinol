import type * as THREE from 'three'
import type { SzjCorridor } from '../contract.ts'

export type SzjCeilingStyle = 'baffle' | 'grille'

export type SzjAtmosPresetName = 'real-guilin' | 'day-rush' | 'evening-warm'

/**
 * Quantified ceiling & atmosphere parameters (overridable directly from docs/shizijie/reality-spec.md).
 */
export interface SzjAtmosRealitySpec {
  readonly ceilingStyle: SzjCeilingStyle
  /** Transverse baffle pitch along corridors (meters). */
  readonly baffleSpacingM: number
  /** Single baffle blade vertical depth (meters). */
  readonly baffleDepthM: number
  /** Single baffle blade thickness (meters). */
  readonly baffleThicknessM: number
  /** Open-cell grille longitudinal rib count when `ceilingStyle === 'grille'`. */
  readonly grilleLongitudinalRibs: number
  /** Primary anodized aluminium baffle hex color. */
  readonly baffleColor: string
  /** Secondary subtle accent tint for ring concourse baffles. */
  readonly baffleRingColor: string
  /** Recessed acoustic plenum & shadow-reveal trim hex color. */
  readonly plenumColor: string
  /** Exposed galvanized HVAC duct hex color. */
  readonly ductColor: string
  /** Exposed industrial steel cable tray hex color. */
  readonly cableTrayColor: string
  /** Fire sprinkler head finish hex color. */
  readonly sprinklerColor: string
  /** Linear LED diffuser cool-neutral color (5000K-ish concourse). */
  readonly linearLampColor: string
  /** Linear LED emissive intensity. */
  readonly linearLampIntensity: number
  /** Recessed warm downlight color (3200K-3500K accent pools). */
  readonly downlightColor: string
  /** Downlight emissive intensity. */
  readonly downlightIntensity: number
  /** Matte dark troffer housing color around lamps. */
  readonly lampHousingColor: string
  /** Subtle warm cove/shopfront wall-wash tint. */
  readonly coveWashColor: string
  /** Cove wash additive opacity (`0..0.35`). */
  readonly coveWashOpacity: number
  /** Hemisphere light sky/ceiling tint. */
  readonly hemiSkyColor: string
  /** Hemisphere light terrazzo ground bounce tint. */
  readonly hemiGroundColor: string
  readonly hemiIntensity: number
  readonly ambientColor: string
  readonly ambientIntensity: number
  readonly keyLightColor: string
  readonly keyLightIntensity: number
  /** Clustered local point lights along ring concourse (capped <= 6 total). */
  readonly ringPointColor: string
  readonly ringPointIntensity: number
  readonly ringPointDistance: number
  /** Daylight fill point lights near stairwell threshold landings. */
  readonly stairDaylightColor: string
  readonly stairDaylightIntensity: number
  readonly stairDaylightDistance: number
  /** Atmospheric depth fog color & exponential density. */
  readonly fogColor: string
  readonly fogDensity: number
  /** Indoor background color behind stairwell skylight openings. */
  readonly backgroundColor: string
  /** Optional stairwell shaft exclusion padding in meters (default `0.55`). */
  readonly stairShaftPadM: number
}

export interface SzjAtmosOptions {
  /** Base preset name (default `'real-guilin'`). */
  readonly preset?: SzjAtmosPresetName
  /** Partial overrides (e.g. calibrated numbers from reality-spec.md). */
  readonly spec?: Partial<SzjAtmosRealitySpec>
  /** Indoor floor elevation in meters (default `SZJ_FRAME.indoorFloorY`). */
  readonly floorY?: number
  /** Whether to include the Three.js light rig inside `group` (default `true`). */
  readonly includeLights?: boolean
}

export interface SzjAtmosLayerMetric {
  readonly name: string
  readonly drawCalls: number
  readonly triangles: number
  readonly instances: number
}

export interface SzjAtmosMetrics {
  readonly drawCalls: number
  readonly triangles: number
  readonly instances: number
  readonly lightCount: number
  readonly geometryCount: number
  readonly materialCount: number
  readonly minElementY: number
  readonly maxElementY: number
  readonly breakdown: readonly SzjAtmosLayerMetric[]
}

export interface CorridorSpan {
  readonly corridorId: string
  readonly kind: SzjCorridor['kind']
  readonly width: number
  readonly ax: number
  readonly az: number
  readonly bx: number
  readonly bz: number
  readonly midX: number
  readonly midZ: number
  readonly dx: number
  readonly dz: number
  readonly rightX: number
  readonly rightZ: number
  readonly len: number
  readonly yaw: number
}

export interface SzjCeilingHandle {
  readonly group: THREE.Group
  readonly spec: SzjAtmosRealitySpec
  getMetrics(): SzjAtmosMetrics
  isDisposed(): boolean
  dispose(): void
}

export interface SzjLightingRigHandle {
  readonly group: THREE.Group
  readonly lights: readonly THREE.Light[]
  readonly spec: SzjAtmosRealitySpec
  applyAtmosphere(scene: THREE.Scene): () => void
  applySpec(spec: Partial<SzjAtmosRealitySpec>): void
  step(dtSec: number): void
  getMetrics(): SzjAtmosMetrics
  isDisposed(): boolean
  dispose(): void
}

export interface SzjAtmosHandle {
  readonly group: THREE.Group
  readonly ceiling: SzjCeilingHandle
  readonly lighting: SzjLightingRigHandle
  readonly lights: readonly THREE.Light[]
  applyAtmosphere(scene: THREE.Scene): () => void
  applyPreset(preset: SzjAtmosPresetName | Partial<SzjAtmosRealitySpec>): void
  step(dtSec: number): void
  getMetrics(): SzjAtmosMetrics
  isDisposed(): boolean
  dispose(): void
}
