import type * as THREE from 'three'
import {
  SZJ_BUDGET,
  SZJ_FRAME,
  type SzjCorridor,
  type SzjLayout,
  type SzjNpcPose,
  type SzjNpcRole,
  type SzjNpcSpot,
  type SzjShop,
  type SzjWalker,
  type SzjXZ,
} from '../contract.ts'

export const MAX_SHIZIJIE_CROWD_NPCS = SZJ_BUDGET.npcMax
export const MAX_SHIZIJIE_CROWD_DRAW_CALLS = SZJ_BUDGET.npcDrawCallsMax
export const MAX_SHIZIJIE_CROWD_STEP_MS = SZJ_BUDGET.crowdStepMsMax

export type SzjCrowdRole = SzjNpcRole | 'walker'
export type SzjCrowdPose = SzjNpcPose | 'walk'

export type {
  SzjCorridor,
  SzjLayout,
  SzjNpcPose,
  SzjNpcRole,
  SzjNpcSpot,
  SzjShop,
  SzjWalker,
  SzjXZ,
}

export interface SzjCrowdLayoutInput {
  readonly floorY?: number
  readonly corridors?: readonly Pick<SzjCorridor, 'id' | 'kind' | 'points' | 'width'>[]
  readonly shops?: readonly Pick<SzjShop, 'id' | 'rect' | 'npcSpots'>[]
  readonly walkers?: readonly SzjWalker[]
  /** 可选扁平点位输入（无 shops 包裹时兼容）。 */
  readonly npcSpots?: readonly SzjNpcSpot[]
}

export interface SzjCrowdOptions {
  readonly layout?: SzjLayout | SzjCrowdLayoutInput
  readonly maxNpcs?: number
  readonly seed?: number | string
  readonly floorY?: number
}

export interface SzjAgentState {
  readonly id: string
  readonly index: number
  readonly role: SzjCrowdRole
  pose: SzjCrowdPose
  readonly basePose: SzjCrowdPose
  x: number
  y: number
  z: number
  /** 宿主 walkTo 约定朝向：正面看向 (-sin yaw, -cos yaw)。 */
  yaw: number
  homeX: number
  homeZ: number
  homeYaw: number
  speed: number
  walkPhase: number
  actionPhase: number
  stateTimer: number
  stateDuration: number
  heightScale: number
  widthScale: number
  hasProp: boolean
  propColor: string
  shirtColor: string
  pantsColor: string
  skinTint: string
  routeIndex: number
  waypointIndex: number
  loopDirection: 1 | -1
  laneOffset: number
}

export interface SzjAgentSnapshot {
  readonly id: string
  readonly role: SzjCrowdRole
  readonly pose: SzjCrowdPose
  readonly x: number
  readonly y: number
  readonly z: number
  readonly yaw: number
  readonly speed: number
  readonly hasProp: boolean
}

export interface SzjCrowdMetrics {
  readonly activeCount: number
  readonly capacity: number
  readonly keeperCount: number
  readonly customerCount: number
  readonly walkerCount: number
  readonly drawCalls: number
  readonly triangles: number
  readonly lastStepMs: number
  readonly avgStepMs: number
  readonly stepSamples: number
  readonly disposed: boolean
}

export interface SzjCrowdHandle {
  readonly group: THREE.Group
  readonly capacity: number
  step(dtSeconds: number): void
  setVisible(visible: boolean): void
  getMetrics(): SzjCrowdMetrics
  getAgentSnapshots(): readonly SzjAgentSnapshot[]
  dispose(): void
}

export interface SzjCrowdLiveProbe {
  getMetrics(): SzjCrowdMetrics
  setVisible(visible: boolean): void
  isVisible(): boolean
}

export const DEFAULT_INDOOR_FLOOR_Y = SZJ_FRAME.indoorFloorY
