import {
  computeStairLimbPose,
  createScriptedStairTraversal,
  createStairEyeSmoother,
  type ScriptedStairTraversal,
  type StairEyeSmoother,
} from './motion.ts'
import { projectWorldToStair } from './profile.ts'
import type {
  CameraLike,
  JointMapLike,
  ScriptedStairFrame,
  ScriptedStairOptions,
  StairEyeSmootherOptions,
  StairEyeState,
  StairLimbPose,
  StairPlacement,
  StairSample,
  Vec3,
} from './types.ts'

export interface ApplyStairCameraOptions {
  /** Base user look pitch (radians) added on top of `frame.pitchBiasRad`. Defaults to `0`. */
  readonly basePitchRad?: number
  /** Whether to lock camera yaw to the stair's travel `yawRad`. Defaults to `true`. */
  readonly applyYaw?: boolean
}

/** Applies a `ScriptedStairFrame` directly to any Three.js-compatible camera object. */
export function applyStairCameraPose(
  camera: CameraLike,
  frame: Pick<ScriptedStairFrame, 'eyePosition' | 'yawRad' | 'pitchBiasRad'>,
  opts: ApplyStairCameraOptions = {},
): void {
  camera.position.set(frame.eyePosition.x, frame.eyePosition.y, frame.eyePosition.z)
  if (camera.rotation) {
    if (opts.applyYaw ?? true) {
      camera.rotation.y = frame.yawRad
    }
    camera.rotation.x = (opts.basePitchRad ?? 0) + frame.pitchBiasRad
  }
}

/**
 * Blends a procedural `StairLimbPose` onto a Guilin OL `AvatarJointMap`-compatible rig.
 * Safe no-op when `pose.weight === 0` or joints are partially missing.
 */
export function applyStairLimbPose(
  joints: JointMapLike,
  pose: StairLimbPose,
  extraWeight = 1,
): void {
  const w = Math.max(0, Math.min(1, extraWeight)) * pose.weight
  if (w <= 1e-5) return

  const blendX = (handle: { rotation: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown } } | undefined, targetX: number): void => {
    if (!handle) return
    const nextX = handle.rotation.x + (targetX - handle.rotation.x) * w
    handle.rotation.set(nextX, handle.rotation.y, handle.rotation.z)
  }

  blendX(joints.Torso, pose.torsoPitchX)
  blendX(joints.ThighL, pose.thighLX)
  blendX(joints.ThighR, pose.thighRX)
  blendX(joints.ShinL, pose.shinLX)
  blendX(joints.ShinR, pose.shinRX)
  blendX(joints.ArmL, pose.armLX)
  blendX(joints.ArmR, pose.armRX)
  blendX(joints.ForearmL, pose.forearmLX)
  blendX(joints.ForearmR, pose.forearmRX)
}

export type StairAdapterMode = 'idle' | 'interactive' | 'scripted'

export interface StairInteractiveStepResult {
  readonly mode: 'interactive'
  readonly inBounds: boolean
  readonly sample: StairSample
  readonly eyeState: StairEyeState
  readonly limbPose: StairLimbPose
}

export interface StairScriptedStepResult {
  readonly mode: 'scripted'
  readonly frame: ScriptedStairFrame
  readonly limbPose: StairLimbPose
}

export interface StairLocomotionAdapter {
  getMode(): StairAdapterMode
  /** Starts locked-input scripted traversal (e.g. stairwell entry/exit). */
  startScripted(opts: ScriptedStairOptions): ScriptedStairFrame
  /** Advances scripted traversal by `dtSec`. Returns `null` if not currently in scripted mode. */
  stepScripted(dtSec: number, camera?: CameraLike, joints?: JointMapLike): StairScriptedStepResult | null
  /** Samples & smooths eye height + limb pose for interactive free walking over any `StairPlacement`. */
  stepInteractive(
    placement: StairPlacement,
    worldPos: Vec3,
    dtSec: number,
    speed?: number,
    joints?: JointMapLike,
  ): StairInteractiveStepResult
  /** Cancels any active scripted traversal and resets smoothing state. */
  reset(): void
}

/**
 * Small stateful adapter uniting interactive stair sampling + eye smoothing + scripted stairwell playback.
 * Designed to drop directly into any indoor/outdoor controller without coupling to a specific landmark.
 */
export function createStairLocomotionAdapter(
  smootherOpts: StairEyeSmootherOptions = {},
): StairLocomotionAdapter {
  const smoother: StairEyeSmoother = createStairEyeSmoother(smootherOpts)
  let mode: StairAdapterMode = 'idle'
  let scripted: ScriptedStairTraversal | null = null
  let scriptedSpeed = 1.45

  return {
    getMode: () => mode,

    startScripted(opts: ScriptedStairOptions): ScriptedStairFrame {
      scripted = createScriptedStairTraversal(opts)
      scriptedSpeed = opts.speed ?? 1.45
      mode = 'scripted'
      return scripted.getState()
    },

    stepScripted(
      dtSec: number,
      camera?: CameraLike,
      joints?: JointMapLike,
    ): StairScriptedStepResult | null {
      if (mode !== 'scripted' || !scripted) return null
      const frame = scripted.step(dtSec)
      const limbPose = computeStairLimbPose(frame.sample, {
        speed: frame.done ? 0 : scriptedSpeed,
      })
      if (camera) {
        applyStairCameraPose(camera, frame)
      }
      if (joints) {
        applyStairLimbPose(joints, limbPose)
      }
      if (frame.done) {
        mode = 'idle'
      }
      return {
        mode: 'scripted',
        frame,
        limbPose,
      }
    },

    stepInteractive(
      placement: StairPlacement,
      worldPos: Vec3,
      dtSec: number,
      speed = 1.45,
      joints?: JointMapLike,
    ): StairInteractiveStepResult {
      mode = 'interactive'
      scripted = null
      const proj = projectWorldToStair(placement, worldPos)
      const eyeState = smoother.step(proj.sample, dtSec)
      const limbPose = computeStairLimbPose(proj.sample, { speed })
      if (joints && proj.inBounds) {
        applyStairLimbPose(joints, limbPose)
      }
      return {
        mode: 'interactive',
        inBounds: proj.inBounds,
        sample: proj.sample,
        eyeState,
        limbPose,
      }
    },

    reset(): void {
      mode = 'idle'
      scripted = null
      smoother.reset(0, 0)
    },
  }
}
