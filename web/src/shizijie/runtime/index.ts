export {
  normalizeAngleRad,
  type CreateSzjIndoorSceneOptions,
  type SzjAtmosMetrics,
  type SzjAtmosPresetName,
  type SzjAtmosRealitySpec,
  type SzjCrowdMetrics,
  type SzjExtendedIndoorScene,
  type SzjHangingSign,
  type SzjPlayerSnapshot,
  type SzjSignRuntimeMetrics,
  type SzjWayfinding,
} from './types.ts'

export { buildContractDerivedSzjLayout } from './fallback-layout.ts'

export {
  buildSzjCollisionWorld,
  clampSzjPitch,
  closestPointOnCorridor,
  closestPointOnSegment,
  detectActiveSzjShop,
  getStairSpeedScale,
  isValidStairId,
  locateStairwellAt,
  rectToAabb,
  resolveSzjIndoorMovement,
  type Aabb2D,
  type CapsuleSegment2D,
  type SzjIndoorCollisionWorld,
  type SzjIndoorMoveResult,
} from './collision.ts'

export {
  createSzjIndoorSceneContent,
  type CreateSzjIndoorSceneMeshOptions,
  type SzjIndoorSceneHandle,
} from './indoor-scene.ts'

export {
  createSzjRuntimeStateMachine,
  type SzjRuntimeStateMachine,
} from './state-machine.ts'

export { createSzjIndoorScene } from './controller.ts'
export { SZJ_STAIRWELLS } from '../contract.ts'
