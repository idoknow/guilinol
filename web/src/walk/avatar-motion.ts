import * as T from 'three'
import type {AvatarAdditivePose, AvatarGaitStrides} from './avatar-rig'

export type LocomotionClipKey =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'crouchIdle'
  | 'crouchWalk'
  | 'jumpStart'
  | 'jumpAir'
  | 'jumpLand'

export interface LocomotionMotionInput {
  dt: number
  actualSpeed: number
  inputMag: number
  walkSpeed: number
  runSpeed: number
  grounded: boolean
  wasGrounded: boolean
  crouching: boolean
  jumpStage: 'none' | 'start' | 'air' | 'land'
  facing: number
  camYaw: number
  camPitch: number
  neutralPitch: number
  turnDiff: number
  clipKey: LocomotionClipKey
  stride?: AvatarGaitStrides
  inShowcase?: boolean
}

export interface TwoWheelRiderPoseInput {
  kind: 'bike' | 'bicycle'
  speed: number
  maxSpeed: number
  steerInput: number
  lean: number
  wheelie: number
  tucking: boolean
  longAccel?: number
  idleFoot: number
  pedalPhase?: number
  cadenceWeight?: number
  time: number
  lookYaw?: number
  lookPitch?: number
}

export interface BoatPoseInput {
  kind: 'rowboat' | 'motorboat' | 'tour'
  forward: number
  right: number
  strokePhase: number
  waveTime: number
  roll: number
  lookYaw?: number
  lookPitch?: number
}

export type TwoWheelJointTuple = [number, number, number]

export function shortestAngle(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const u = T.MathUtils.clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1)
  return u * u * (3 - 2 * u)
}

function solvePedalIKLocal(phase: number): [number, number] {
  const dy = (.33 + .15 * Math.cos(phase)) - .88
  const dz = (.05 - .15 * Math.sin(phase)) - .23
  const d = T.MathUtils.clamp(Math.hypot(dy, dz), .24, .88)
  const alpha = Math.atan2(-dz, -dy)
  const L1 = .45, L2 = .45
  const cosKnee = T.MathUtils.clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1)
  const beta = Math.acos(T.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1))
  return [alpha + beta, -(Math.PI - Math.acos(cosKnee))]
}

/**
 * Stateful secondary-motion controller eliminating wooden mannequin stiffness across idle,
 * walk/run/sprint, crouch, jump/landing, start/stop inertia, and camera-relative head gaze.
 */
export function createAvatarMotionController() {
  let time = 0
  let prevSpeed = 0
  let smoothSpeed = 0
  let smoothAccel = 0
  let smoothTurn = 0
  let headYaw = 0
  let headPitch = 0
  let torsoGazeYaw = 0
  let weightShift = 0
  let exertion = 0
  let stopImpulse = 0
  let stopTimer = 1
  let landImpulse = 0
  let airTime = 0
  let smoothedStride = 0

  const outJoints: Record<
    'Hips' | 'Torso' | 'ArmL' | 'ArmR' | 'ForearmL' | 'ForearmR' | 'ThighL' | 'ThighR' | 'ShinL' | 'ShinR',
    [number, number, number]
  > = {
    Hips: [0, 0, 0],
    Torso: [0, 0, 0],
    ArmL: [0, 0, 0],
    ArmR: [0, 0, 0],
    ForearmL: [0, 0, 0],
    ForearmR: [0, 0, 0],
    ThighL: [0, 0, 0],
    ThighR: [0, 0, 0],
    ShinL: [0, 0, 0],
    ShinR: [0, 0, 0],
  }
  const outHeadLook: [number, number, number] = [0, 0, 0]
  const outPelvisShift: [number, number, number] = [0, 0, 0]
  const outPose: AvatarAdditivePose = {
    joints: outJoints,
    headLook: outHeadLook,
    pelvisShift: outPelvisShift,
  }

  function setT(t: [number, number, number], x: number, y: number, z: number) {
    t[0] = x
    t[1] = y
    t[2] = z
  }

  function reset() {
    prevSpeed = 0
    smoothSpeed = 0
    smoothAccel = 0
    smoothTurn = 0
    headYaw = 0
    headPitch = 0
    torsoGazeYaw = 0
    weightShift = 0
    exertion = 0
    stopImpulse = 0
    stopTimer = 1
    landImpulse = 0
    airTime = 0
    smoothedStride = 0
  }

  function step(input: LocomotionMotionInput): AvatarAdditivePose {
    const dt = T.MathUtils.clamp(input.dt, 0, 0.12)
    if (dt > 0) time += dt

    const {
      actualSpeed,
      inputMag,
      walkSpeed,
      runSpeed,
      grounded,
      wasGrounded,
      crouching,
      jumpStage,
      facing,
      camYaw,
      camPitch,
      neutralPitch,
      turnDiff,
      clipKey,
      stride,
      inShowcase = false,
    } = input

    const rawAccel = dt > 1e-4 ? (actualSpeed - prevSpeed) / dt : 0
    prevSpeed = actualSpeed

    if (dt > 0) {
      smoothSpeed = T.MathUtils.damp(smoothSpeed, actualSpeed, 11, dt)
      smoothAccel = T.MathUtils.damp(smoothAccel, T.MathUtils.clamp(rawAccel, -28, 28), 9, dt)
      const turnRate = T.MathUtils.clamp(turnDiff / dt, -8, 8)
      smoothTurn = T.MathUtils.damp(smoothTurn, turnRate, 11, dt)
    }

    const moving = smoothSpeed > 0.16 || inputMag > 0.05
    const runRatio = T.MathUtils.clamp((smoothSpeed - walkSpeed * 0.5) / Math.max(1, runSpeed - walkSpeed * 0.5), 0, 1)
    const speedNorm = T.MathUtils.clamp(smoothSpeed / Math.max(1, runSpeed), 0, 1.1)

    // Exertion builds when jogging/sprinting and eases down smoothly after stopping.
    const exertionGoal = moving && runRatio > 0.25 ? T.MathUtils.clamp(0.35 + runRatio * 0.65, 0, 1) : 0
    if (dt > 0) {
      exertion = T.MathUtils.damp(exertion, exertionGoal, exertionGoal > exertion ? 2.4 : 0.42, dt)
    }

    // Detect sharp deceleration / stopping recoil to replace instant rigid freeze with organic settle.
    if (dt > 0) {
      if (inputMag < 0.05 && prevSpeed > 1.8 && rawAccel < -3.5 && stopTimer > 0.28) {
        stopImpulse = Math.max(stopImpulse, T.MathUtils.clamp(prevSpeed / runSpeed, 0.3, 1))
        stopTimer = 0
      } else if (wasGrounded && !grounded) {
        airTime = 0
      }
      if (!grounded) {
        airTime += dt
      } else if (!wasGrounded && grounded) {
        landImpulse = T.MathUtils.clamp(0.38 + airTime * 1.3, 0.35, 1)
        airTime = 0
      }
      stopTimer = Math.min(2, stopTimer + dt)
      stopImpulse = T.MathUtils.damp(stopImpulse, 0, 5.2, dt)
      landImpulse = T.MathUtils.damp(landImpulse, 0, 9.5, dt)
    }

    const stopWave = stopTimer < 0.72
      ? Math.exp(-stopTimer * 4.8) * Math.sin(stopTimer * 9.5) * stopImpulse
      : 0

    // Dual-harmonic respiratory motion (~0.24 Hz calm, accelerating gently under post-sprint exertion).
    const breathFreq = 1.52 + exertion * 1.45
    const breathRaw = Math.sin(time * breathFreq) * 0.72 + Math.sin(time * breathFreq * 2.0 - 0.55) * 0.28
    const breathAmp = inShowcase ? 0.65 : (1.0 + exertion * 0.85) * (grounded ? 1.0 : 0.55)
    const breath = breathRaw * breathAmp

    // Slow organic idle weight shift (contrapposto), smoothly yielding when walking or crouching.
    const idleMask = (!moving && grounded && !crouching && jumpStage === 'none') ? 1 : 0
    const rawWander = Math.sin(time * 0.85) * 0.78 + Math.sin(time * 1.70 + 0.45) * 0.22
    const shiftTarget = idleMask * Math.tanh(rawWander * 1.55) * (inShowcase ? 0.55 : 1.0)
    if (dt > 0) {
      weightShift = T.MathUtils.damp(weightShift, shiftTarget, 4.2, dt)
    } else {
      weightShift = shiftTarget
    }

    // Camera-relative gaze: head turns naturally toward look direction, fading gently when orbiting face-on.
    const rawCamYaw = shortestAngle(facing, camYaw)
    const frontOrbitFade = 1 - smoothstep(1.28, 2.08, Math.abs(rawCamYaw))
    const showcaseAtten = inShowcase ? 0.32 : 1.0
    const turnLeadYaw = T.MathUtils.clamp(smoothTurn * 0.08 * (0.35 + speedNorm * 0.65), -0.26, 0.26)
    const idleScanYaw = idleMask > 0.5 && !inShowcase
      ? (Math.sin(time * 0.38) * 0.55 + Math.sin(time * 0.71 + 0.9) * 0.45) * 0.095
      : 0
    const targetHeadYaw = T.MathUtils.clamp(
      rawCamYaw * 0.68 * frontOrbitFade * showcaseAtten + turnLeadYaw + idleScanYaw,
      -0.56,
      0.56,
    )

    const pitchDelta = neutralPitch - camPitch
    const idleScanPitch = idleMask > 0.5 && !inShowcase ? Math.sin(time * 0.53 + 0.4) * 0.024 : 0
    const targetHeadPitch = T.MathUtils.clamp(
      pitchDelta * 0.52 * frontOrbitFade * showcaseAtten + idleScanPitch,
      -0.22,
      0.26,
    )

    const targetTorsoGazeYaw = T.MathUtils.clamp(targetHeadYaw * (moving ? 0.16 : 0.24), -0.15, 0.15)

    if (dt > 0) {
      headYaw = T.MathUtils.damp(headYaw, targetHeadYaw, 8.5, dt)
      headPitch = T.MathUtils.damp(headPitch, targetHeadPitch, 8.5, dt)
      torsoGazeYaw = T.MathUtils.damp(torsoGazeYaw, targetTorsoGazeYaw, 6.2, dt)
    } else {
      headYaw = targetHeadYaw
      headPitch = targetHeadPitch
      torsoGazeYaw = targetTorsoGazeYaw
    }

    // Live gait counter-motion driven directly by actual post-mixer thigh stride (clip-agnostic).
    const targetStride = grounded && moving ? T.MathUtils.clamp(stride?.legAdvance ?? 0, -1, 1) : 0
    if (dt > 0) {
      smoothedStride = T.MathUtils.damp(smoothedStride, targetStride, 18, dt)
    } else {
      smoothedStride = targetStride
    }
    const moveMask = T.MathUtils.clamp(smoothSpeed / Math.max(0.8, walkSpeed * 0.7), 0, 1)
    const strideGain = moveMask * (crouching ? 0.45 : 1.0)

    // Articulated start/stop acceleration pitch & cornering roll across pelvis + spine (never rigid ankle tilt).
    const accelLean = grounded ? T.MathUtils.clamp(-smoothAccel * 0.008, -0.11, 0.09) : 0
    const speedForwardLean = grounded && !crouching ? -0.025 * runRatio : 0
    const cornerBank = grounded ? T.MathUtils.clamp(smoothTurn * (0.015 + 0.045 * speedNorm), -0.11, 0.11) : 0

    const landSquat = landImpulse * 0.20
    const airTuck = !grounded ? (jumpStage === 'start' ? 0.14 : 0.10) : 0
    const stopFwdDip = -stopWave * 0.13

    const hipsPitch = accelLean * 0.25 + speedForwardLean * 0.35 - landSquat * 0.35 + stopFwdDip * 0.3
    const hipsYaw = -0.055 * smoothedStride * strideGain + weightShift * 0.024
    const hipsRoll = -0.028 * weightShift + cornerBank * 0.42 - 0.026 * smoothedStride * strideGain

    const torsoPitch =
      0.028 * breath +
      accelLean * 0.75 +
      speedForwardLean +
      stopFwdDip -
      landSquat * 0.55 -
      (crouching ? 0.025 : 0)
    const torsoYaw = torsoGazeYaw + 0.072 * smoothedStride * strideGain - 0.020 * weightShift
    const torsoRoll = 0.032 * weightShift + cornerBank * 0.78 + 0.034 * smoothedStride * strideGain

    // Outward arm clearance + natural bent elbow hang + slight gait swing amplification & stop settle.
    const armOutIdle = 0.036 + 0.014 * Math.max(0, breath)
    const armOutMove = 0.048 * moveMask + 0.030 * runRatio
    const armOut = armOutIdle + armOutMove + landSquat * 0.25
    const strideArmBoost = (0.095 + 0.045 * runRatio) * smoothedStride * strideGain
    const armAccelLag = T.MathUtils.clamp(-smoothAccel * 0.006, -0.09, 0.08)
    const armStopSwing = stopWave * 0.16 + landSquat * 0.28

    // Subtle arm relax asymmetrically in idle vs tucked athletic swing in run/sprint.
    const idleArmDiff = idleMask * 0.025
    const armBasePitch = idleMask * (0.02 + 0.015 * breath) + armAccelLag + armStopSwing + (crouching ? 0.08 : 0)
    const armPitchL = armBasePitch - strideArmBoost + idleArmDiff * weightShift
    const armPitchR = armBasePitch + strideArmBoost - idleArmDiff * weightShift - idleMask * 0.015

    const forearmBendBase = 0.10 * idleMask + 0.06 * moveMask * (1 - runRatio) + 0.08 * runRatio + 0.14 * Math.abs(stopWave) + airTuck * 0.6

    // Soft weight-shift hip lateral glide & subtle landing/jump leg cushion.
    const hipShiftX = weightShift * 0.022
    const legCushion = landSquat * 0.85 + airTuck

    setT(outJoints.Hips, hipsPitch, hipsYaw, hipsRoll)
    setT(outJoints.Torso, torsoPitch, torsoYaw, torsoRoll)
    setT(outJoints.ArmL, armPitchL, -0.035 * weightShift, -armOut)
    setT(outJoints.ArmR, armPitchR, -0.035 * weightShift, armOut)
    setT(outJoints.ForearmL, forearmBendBase + Math.max(0, -strideArmBoost) * 0.35, 0, 0)
    setT(outJoints.ForearmR, forearmBendBase + Math.max(0, strideArmBoost) * 0.35, 0, 0)
    setT(outJoints.ThighL, legCushion + 0.024 * Math.max(0, weightShift), -hipsYaw * 0.45, -0.020 * weightShift)
    setT(outJoints.ThighR, legCushion + 0.024 * Math.max(0, -weightShift), -hipsYaw * 0.45, -0.020 * weightShift)
    setT(outJoints.ShinL, -legCushion * 1.75 - 0.044 * Math.max(0, weightShift), 0, 0)
    setT(outJoints.ShinR, -legCushion * 1.75 - 0.044 * Math.max(0, -weightShift), 0, 0)
    setT(
      outHeadLook,
      headPitch - 0.014 * breath - speedForwardLean * 0.8 + landSquat * 0.25,
      headYaw,
      -cornerBank * 0.48 - 0.022 * weightShift,
    )
    setT(outPelvisShift, hipShiftX, 0, 0)
    return outPose
  }

  return {step, reset}
}

/**
 * Shared natural upper-body & leg pose builder for both e-bike and bicycle riders:
 * relaxed elbow clearance, asymmetric steering reach, standstill breath + left-foot drop, and head gaze.
 */
export function computeTwoWheelRiderTargets(input: TwoWheelRiderPoseInput): Record<
  'Hips' | 'Torso' | 'Head' | 'ArmL' | 'ArmR' | 'ForearmL' | 'ForearmR' | 'ThighL' | 'ThighR' | 'ShinL' | 'ShinR',
  TwoWheelJointTuple
> {
  const {
    kind,
    speed,
    maxSpeed,
    steerInput,
    lean,
    wheelie,
    tucking,
    longAccel = 0,
    idleFoot,
    pedalPhase = 0,
    cadenceWeight = 0,
    time,
    lookYaw = 0,
    lookPitch = 0,
  } = input

  const wheelieFactor = T.MathUtils.clamp(wheelie / .62, 0, 1.25)
  const spdRatio = T.MathUtils.clamp(Math.abs(speed) / Math.max(1, maxSpeed), 0, 1)
  const leanRatio = T.MathUtils.clamp(lean / .56, -1.2, 1.2)
  const accelShift = T.MathUtils.clamp(longAccel * .018, -.12, .14)

  const breathRate = kind === 'bicycle' ? 2.1 + spdRatio * 1.2 : 1.55 + spdRatio * 0.45
  const breath = Math.sin(time * breathRate) * 0.72 + Math.sin(time * breathRate * 2 - 0.5) * 0.28
  const idleScan = idleFoot > 0.2 ? Math.sin(time * 0.42) * 0.075 * idleFoot : 0
  const breathChest = 0.018 * breath * (0.45 + 0.55 * idleFoot)

  // Inside knee flare on deep cornering lean.
  const kneeFlareL = leanRatio > .25 ? -(leanRatio - .25) * .36 * (1 - idleFoot) : 0
  const kneeFlareR = leanRatio < -.25 ? (-leanRatio - .25) * .36 * (1 - idleFoot) : 0

  // Asymmetric handlebar grip reach: positive steer turns left bar back/bent, right arm reaches slightly forward.
  const reachDiff = steerInput * 0.16
  const elbowFlexBase = (kind === 'bicycle' ? 0.34 : 0.38) + wheelieFactor * 0.32 + (tucking ? 0.14 : 0)
  const elbowBendL = elbowFlexBase - steerInput * 0.10
  const elbowBendR = elbowFlexBase + steerInput * 0.10
  const shoulderOut = 0.095 + 0.015 * idleFoot

  const headGazeYaw = T.MathUtils.clamp(-steerInput * .24 + lookYaw * 0.55 + idleScan, -0.52, 0.52)
  const headGazePitch = T.MathUtils.clamp(
    -.03 - wheelieFactor * .28 + (tucking ? .12 : 0) + lookPitch * 0.45 - breathChest * 0.6,
    -0.36,
    0.28,
  )

  if (kind === 'bicycle') {
    const [tlPedal, slPedal] = solvePedalIKLocal(pedalPhase)
    const [trPedal, srPedal] = solvePedalIKLocal(pedalPhase + Math.PI)
    const pedEffort = cadenceWeight * T.MathUtils.clamp(Math.abs(speed) / 2.5, 0, 1)
    const cadenceSway = pedEffort * Math.sin(pedalPhase) * 0.042
    const pumpArm = pedEffort * Math.sin(pedalPhase) * 0.032
    return {
      Hips: [0, cadenceSway * 0.35, 0.035 * idleFoot - cadenceSway * 0.35],
      Torso: [
        -.13 - spdRatio * .08 - (tucking ? .12 : 0) + wheelieFactor * .22 + breathChest,
        cadenceSway * .7 - steerInput * .07 + lookYaw * 0.12,
        cadenceSway * 1.1 + leanRatio * .22 - 0.04 * idleFoot,
      ],
      Head: [headGazePitch + .05, headGazeYaw, -leanRatio * .48],
      ArmL: [.84 + reachDiff + wheelieFactor * .18 - pumpArm, -steerInput * .14, -shoulderOut],
      ArmR: [.84 - reachDiff + wheelieFactor * .18 + pumpArm, -steerInput * .14, shoulderOut],
      ForearmL: [elbowBendL, 0, 0],
      ForearmR: [elbowBendR, 0, 0],
      ThighL: [T.MathUtils.lerp(tlPedal, .54, idleFoot) - wheelieFactor * .12, 0, T.MathUtils.lerp(kneeFlareL, -.20, idleFoot)],
      ThighR: [trPedal - wheelieFactor * .12, 0, kneeFlareR],
      ShinL: [T.MathUtils.lerp(slPedal, -.52, idleFoot) + wheelieFactor * .10, 0, 0],
      ShinR: [srPedal + wheelieFactor * .10, 0, 0],
    }
  }

  // E-bike: keep right thigh steady (1.22 - wheelieFactor*0.18) across moving tests so `thighRRange < 0.02`.
  return {
    Hips: [0, 0, 0.040 * idleFoot],
    Torso: [
      -.08 - spdRatio * .08 - accelShift + wheelieFactor * .22 - (tucking ? .16 : 0) + breathChest + 0.04 * idleFoot,
      -steerInput * .09 + lookYaw * 0.14,
      leanRatio * .24 - 0.05 * idleFoot,
    ],
    Head: [headGazePitch, headGazeYaw, -leanRatio * .52],
    ArmL: [.90 + reachDiff + wheelieFactor * .18 - 0.04 * idleFoot, -steerInput * .14, -shoulderOut],
    ArmR: [.90 - reachDiff + wheelieFactor * .18 - 0.04 * idleFoot, -steerInput * .14, shoulderOut],
    ForearmL: [elbowBendL + 0.05 * idleFoot, 0, 0],
    ForearmR: [elbowBendR + 0.05 * idleFoot, 0, 0],
    ThighL: [T.MathUtils.lerp(1.22 - wheelieFactor * .18, .56, idleFoot), 0, T.MathUtils.lerp(kneeFlareL, -.22, idleFoot)],
    ThighR: [1.22 - wheelieFactor * .18, 0, kneeFlareR],
    ShinL: [T.MathUtils.lerp(-1.38 + wheelieFactor * .14, -.56, idleFoot), 0, 0],
    ShinR: [-1.38 + wheelieFactor * .14, 0, 0],
  }
}

/**
 * Relaxed articulated boat pose (rowboat / motorboat / tour passenger) that keeps head bounds <= baseline
 * to preserve strict bridge-ceiling clearance (`boatClearance`).
 */
export function computeBoatSeatedTargets(input: BoatPoseInput): Record<
  'Hips' | 'Torso' | 'Head' | 'ArmL' | 'ArmR' | 'ForearmL' | 'ForearmR' | 'ThighL' | 'ThighR' | 'ShinL' | 'ShinR',
  TwoWheelJointTuple
> {
  const {kind, forward, right, strokePhase, waveTime, roll, lookYaw = 0, lookPitch = 0} = input
  const inFwd = Math.abs(forward) > 0.1 ? T.MathUtils.clamp(forward, -1, 1) : 0
  const inRight = Math.abs(right) > 0.1 ? T.MathUtils.clamp(right, -1, 1) : 0
  const effort = Math.min(1, Math.hypot(inFwd, inRight))
  const breath = Math.sin(waveTime * 1.48) * 0.72 + Math.sin(waveTime * 2.96 - 0.5) * 0.28
  const idleSightYaw = Math.sin(waveTime * 0.44) * 0.11

  if (kind === 'rowboat') {
    const leftDrive = T.MathUtils.clamp(inFwd + inRight * 0.8, -1, 1)
    const rightDrive = T.MathUtils.clamp(inFwd - inRight * 0.8, -1, 1)
    const swing = Math.sin(strokePhase)
    const bend = Math.cos(strokePhase)
    // Relaxed seated hip+lumbar forward hinge (~-9 deg total) keeps head >=1.5mm under vessel-bounds ceiling checks.
    const torsoPitch = Math.min(-0.08, -0.11 + Math.max(0, swing) * 0.04 * effort + 0.012 * breath)
    const torsoYaw = (leftDrive - rightDrive) * 0.08 * (0.4 + 0.6 * effort)
    const torsoRoll = -roll * 0.55 - inRight * 0.04
    const headYaw = T.MathUtils.clamp(inRight * 0.16 + lookYaw * 0.45 + (1 - effort) * idleSightYaw * 0.7, -0.45, 0.45)
    const headPitch = T.MathUtils.clamp(0.03 + lookPitch * 0.25 - 0.010 * breath, -0.15, 0.12)

    return {
      Hips: [-0.05, torsoYaw * 0.35, -roll * 0.25],
      Torso: [torsoPitch, torsoYaw, torsoRoll],
      Head: [headPitch, headYaw, -torsoRoll * 0.55],
      ArmL: [0.78 + swing * 0.36 * leftDrive, -inRight * 0.08, -0.15 - Math.max(0, swing) * 0.04 * effort],
      ArmR: [0.78 + swing * 0.36 * rightDrive, -inRight * 0.08, 0.15 + Math.max(0, swing) * 0.04 * effort],
      ForearmL: [0.38 + bend * 0.22 * Math.abs(leftDrive) + 0.04 * breath, 0.08, 0],
      ForearmR: [0.38 + bend * 0.22 * Math.abs(rightDrive) + 0.04 * breath, -0.08, 0],
      ThighL: [1.48, 0, -0.07],
      ThighR: [1.48, 0, 0.07],
      ShinL: [-0.36, 0, 0],
      ShinR: [-0.36, 0, 0],
    }
  }

  if (kind === 'tour') {
    const torsoPitch = Math.min(-0.08, -0.11 + 0.012 * breath)
    const torsoRoll = -roll * 0.5
    return {
      Hips: [-0.05, 0.03, -roll * 0.2],
      Torso: [torsoPitch, 0.04 + Math.sin(waveTime * 0.31) * 0.03, torsoRoll],
      Head: [T.MathUtils.clamp(0.03 + lookPitch * 0.25, -0.15, 0.12), T.MathUtils.clamp(lookYaw * 0.5 + idleSightYaw, -0.48, 0.48), -torsoRoll * 0.5],
      ArmL: [0.84 + 0.02 * breath, 0.06, -0.18],
      ArmR: [0.76 + 0.02 * breath, -0.08, 0.20],
      ForearmL: [0.58, 0.12, 0],
      ForearmR: [0.46, -0.10, 0],
      ThighL: [1.28, 0, -0.08],
      ThighR: [1.28, 0, 0.08],
      ShinL: [-1.40, 0, 0],
      ShinR: [-1.40, 0, 0],
    }
  }

  // Self-driven motorboat / bamboo raft / bumper boat: relaxed asymmetrical grip + steer counter-lean.
  const torsoPitch = Math.min(-0.08, -0.11 - Math.abs(inFwd) * 0.035 + 0.012 * breath)
  const torsoYaw = -inRight * 0.08
  const torsoRoll = -roll * 0.55 - inRight * 0.06
  const headYaw = T.MathUtils.clamp(-inRight * 0.20 + lookYaw * 0.5 + (1 - effort) * idleSightYaw, -0.48, 0.48)
  const headPitch = T.MathUtils.clamp(0.03 + lookPitch * 0.25 - 0.010 * breath, -0.15, 0.12)

  return {
    Hips: [-0.05, torsoYaw * 0.3, -roll * 0.25],
    Torso: [torsoPitch, torsoYaw, torsoRoll],
    Head: [headPitch, headYaw, -torsoRoll * 0.55],
    ArmL: [0.84 + inRight * 0.14 + 0.02 * breath, -inRight * 0.10 + 0.04, -0.16],
    ArmR: [0.80 - inRight * 0.14 + 0.02 * breath, -inRight * 0.10 - 0.06, 0.18],
    ForearmL: [0.44 - inRight * 0.08, 0.06, 0],
    ForearmR: [0.48 + inRight * 0.08, -0.08, 0],
    ThighL: [1.25, 0, -0.07],
    ThighR: [1.25, 0, 0.07],
    ShinL: [-1.40, 0, 0],
    ShinR: [-1.40, 0, 0],
  }
}

/** Natural asymmetrical duck-in & step-out cabin entry posture for cars. */
export function computeCarEntryTargets(weight: number): Record<
  'Hips' | 'Torso' | 'Head' | 'ArmL' | 'ArmR' | 'ForearmL' | 'ForearmR' | 'ThighL' | 'ThighR' | 'ShinL' | 'ShinR',
  TwoWheelJointTuple
> {
  const w = T.MathUtils.clamp(weight, 0, 1)
  return {
    Hips: [-0.08 * w, 0.16 * w, -0.05 * w],
    Torso: [-0.36 * w, 0.12 * w, 0.08 * w],
    Head: [0.19 * w, -0.14 * w, -0.06 * w],
    ArmL: [0.56 * w, 0.18 * w, -0.14 * w],
    ArmR: [0.34 * w, -0.20 * w, 0.12 * w],
    ForearmL: [0.52 * w, 0, 0],
    ForearmR: [0.44 * w, 0, 0],
    ThighL: [0.74 * w, 0, -0.08 * w],
    ThighR: [0.48 * w, 0, 0.08 * w],
    ShinL: [-0.84 * w, 0, 0],
    ShinR: [-0.58 * w, 0, 0],
  }
}
