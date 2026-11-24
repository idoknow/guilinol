import type * as THREE from 'three'
import type { DrinksSim, InteractionBubbleKind } from '../sim/types.ts'

export interface DrinksNpcSkinConfig {
  shopBrandName: string
  greetingLine?: string
  dialogueOverrides?: Partial<Record<InteractionBubbleKind, readonly string[]>>
  clerkShirtColor: string
  clerkApronColor: string
  clerkCapColor: string
  clerkPantsColor: string
  cupBrandBandColor: string
}

export interface DrinksNpcRendererOptions {
  scene: THREE.Scene
  sim: DrinksSim
  skin?: Partial<DrinksNpcSkinConfig>
  maxNpcs?: number
  maxVisibleBadges?: number
  showBadges?: boolean
  worldOrigin?: readonly [number, number, number]
  worldYaw?: number
  sampleGroundY?: (wx: number, wz: number) => number
}

export interface DrinksNpcMetrics {
  activeTotal: number
  clerksCount: number
  customersCount: number
  visibleCount: number
  visibleBadgeCount: number
  holdingCupCount: number
  seatedCount: number
  dirtySeatsCount: number
  drawCallLayers: number
  lastUpdateMs: number
  peakTotal: number
}

export interface DrinksNpcRenderer {
  readonly group: THREE.Group
  step(dtSec: number, cameraPos?: THREE.Vector3): void
  getMetrics(): DrinksNpcMetrics
  setSkin(skin: Partial<DrinksNpcSkinConfig>): void
  dispose(): void
}
