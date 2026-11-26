export {
  STAIR_PRESETS,
  createStairPlacementFromEndpoints,
  normalizeStairProfile,
  projectWorldToStair,
  sampleStairProfile,
  stairBasisXZ,
  stairLocalToWorld,
  validateStairProfile,
} from './profile.ts'
export type { CreatePlacementFromEndpointsOptions } from './profile.ts'

export {
  computeStairLimbPose,
  createScriptedStairTraversal,
  createStairEyeSmoother,
} from './motion.ts'
export type {
  ComputeStairLimbPoseOptions,
  ScriptedStairTraversal,
  StairEyeSmoother,
} from './motion.ts'

export {
  applyStairCameraPose,
  applyStairLimbPose,
  createStairLocomotionAdapter,
} from './adapter.ts'
export type {
  ApplyStairCameraOptions,
  StairAdapterMode,
  StairInteractiveStepResult,
  StairLocomotionAdapter,
  StairScriptedStepResult,
} from './adapter.ts'

export type {
  CameraLike,
  JointHandleLike,
  JointMapLike,
  JointRotationLike,
  NormalizedStairProfile,
  ScriptedStairFrame,
  ScriptedStairOptions,
  StairDirection,
  StairEyeSmootherOptions,
  StairEyeState,
  StairFlightSegment,
  StairLanding,
  StairLimbPose,
  StairMidLanding,
  StairPlacement,
  StairProfile,
  StairSample,
  StairWorldProjection,
  StairZone,
  Vec3,
} from './types.ts'
