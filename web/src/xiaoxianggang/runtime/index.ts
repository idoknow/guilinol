export {
  STAGE1_GREYBOX_LAYOUT,
  assertValidXxgLayout,
  normalizeAngleRad,
  type CreateXxgIndoorSceneOptions,
  type XxgExtendedIndoorScene,
  type XxgPlayerSnapshot,
} from './types.ts'

export {
  buildIndoorCollisionWorld,
  clampIndoorPitch,
  corridorToAabb,
  detectActiveShop,
  rectToAabb,
  resolveIndoorMovement,
  type Aabb2D,
  type IndoorCollisionWorld,
  type IndoorMoveResult,
  type WalkableRegion2D,
} from './collision.ts'

export {
  createIndoorGreyboxScene,
  type IndoorGreyboxSceneHandle,
} from './indoor-scene.ts'

export {
  createXxgRuntimeStateMachine,
  type XxgRuntimeStateMachine,
} from './state-machine.ts'

export {
  XXG_WELL_DOOR,
  distanceToNearestLanding,
  doorLeafRects,
  locateInWell,
  xxgIndoorWells,
  type XxgIndoorWell,
} from './stairwell.ts'

export { createXxgIndoorScene } from './controller.ts'
export { XXG_PORTALS } from '../contract.ts'
