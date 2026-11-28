import * as T from 'three'
import {V, aim, axis, palm, type Bind, type Target} from './rig.ts'

// Duty gestures (4 whistle, 5 flag stop, 6 flag pass), carried over unchanged from the
// original single-function sampler so traffic-duty behaviour stays bit-for-bit identical.

function solveArmReach(
  side: string,
  goal: T.Vector3,
  poleDir: T.Vector3,
  bind: Bind,
  handQuat: T.Quaternion,
  handOffset = V(0, 0, 0),
) {
  const shoulder = bind('upperarm_' + side)
  const elbow = bind('lowerarm_' + side)
  const wrist = bind('hand_' + side)
  const wristGoal = goal.clone().sub(handOffset.clone().applyQuaternion(handQuat))
  const humerus = elbow.clone().sub(shoulder)
  const forearm = wrist.clone().sub(elbow)
  const hLen = humerus.length()
  const fLen = forearm.length()
  const reach = wristGoal.clone().sub(shoulder)
  const dist = T.MathUtils.clamp(reach.length(), Math.abs(hLen - fLen) + 0.015, hLen + fLen - 0.004)
  reach.normalize()
  const along = (hLen * hLen - fLen * fLen + dist * dist) / (2 * dist)
  const pole = poleDir.clone().addScaledVector(reach, -poleDir.dot(reach))
  if (pole.lengthSq() < 1e-6) pole.set(side === 'l' ? 1 : -1, -0.5, 0)
  pole.normalize()
  const elbowVec = reach
    .clone()
    .multiplyScalar(along)
    .addScaledVector(pole, Math.sqrt(Math.max(0, hLen * hLen - along * along)))
  const upper = new T.Quaternion().setFromUnitVectors(humerus.normalize(), elbowVec.clone().normalize())
  const forearmVec = reach.clone().multiplyScalar(dist).sub(elbowVec)
  const lower = new T.Quaternion().setFromUnitVectors(forearm.normalize(), forearmVec.normalize())
  return {upper, lower}
}

export function sampleDuty(poseId: 4 | 5 | 6, time: number, set: Target, bind: Bind) {
  const torso =
    poseId === 4
      ? axis(1, 0, 0, 0.04 * Math.sin(time * 8.5))
      : poseId === 5
        ? axis(0, 1, 0, 0.16)
        : axis(0, 1, 0, 0.18 * Math.sin(time * 4.8))
  set('spine_03', torso)
  for (const [side, s] of [
    ['l', 1],
    ['r', -1],
  ] as const) {
    let upper: T.Quaternion, lower: T.Quaternion, hand: T.Quaternion
    if (poseId === 4) {
      // Duty whistle blow: left arm brings chest whistle up to mouth; right arm holds command flag lowered cleanly.
      if (s === 1) {
        const lift = T.MathUtils.smoothstep(time, 0, 0.22)
        const puff = Math.sin(time * 9.5) * 0.008
        const headPos = bind('head')
        const chestStart = V(0.14, headPos.y - 0.36, headPos.z + 0.22)
        const mouthGoal = V(0.055, headPos.y - 0.025 + puff, headPos.z + 0.145)
        const goal = chestStart.lerp(mouthGoal, lift)
        hand = palm(1, V(-0.62, 0.42, 0.62), V(0.28, -0.18, -0.94))
        const solved = solveArmReach('l', goal, V(0.65, -1, -0.18), bind, hand, V(0.045, 0, 0))
        upper = solved.upper
        lower = solved.lower
      } else {
        upper = aim(-1, -0.32, -0.88, 0.34)
        lower = aim(-1, -0.16, -0.58, 0.8)
        hand = palm(-1, V(0, -0.25, 0.95), V(-1, 0, 0))
      }
    } else if (poseId === 5) {
      // Duty flag STOP: left forearm raised with upright open palm toward oncoming traffic; right hand raises flag across chest/front.
      if (s === 1) {
        const pulse = Math.sin(time * 4.2) * 0.03
        upper = aim(1, 0.18, -0.18 + pulse, 0.96)
        lower = aim(1, -0.05, 0.84 + pulse * 0.5, 0.54)
        hand = palm(1, V(0, 1, 0.14), V(0, -0.14, 1))
      } else {
        const steady = Math.sin(time * 4.0) * 0.05
        upper = aim(-1, -0.22, 0.26 + steady, 0.94)
        lower = aim(-1, 0.28, 0.48 + steady, 0.83)
        hand = palm(-1, V(0.32, 0.65, 0.68), V(-1, 0, 0))
      }
    } else {
      // Duty flag PASS: right arm sweeps wide left-to-right guiding vehicles through; left arm stays balanced by hip.
      const wave = Math.sin(time * 4.8)
      if (s === 1) {
        upper = aim(1, 0.34, -0.84, 0.42 - wave * 0.12)
        lower = aim(1, -0.18, -0.38, 0.9)
        hand = palm(1, V(0, 0, 1), V(1, 0, 0))
      } else {
        upper = aim(-1, -0.56 + 0.58 * wave, -0.04 + 0.24 * Math.abs(wave), 0.78)
        lower = aim(-1, -0.34 + 0.62 * wave, 0.36 + 0.2 * wave, 0.74)
        hand = palm(-1, V(-0.2 + 0.45 * wave, 0.25, 0.92), V(-1, 0.15 * wave, 0))
      }
    }
    set('upperarm_' + side, upper, torso)
    set('lowerarm_' + side, lower, upper)
    set('hand_' + side, hand, lower)
    for (const finger of ['index', 'middle', 'ring', 'pinky', 'thumb']) {
      let parent = hand
      for (let i = 1; i <= 3; i++) {
        const bend =
          poseId === 4
            ? s === 1
              ? ['index', 'thumb'].includes(finger)
                ? 0.72
                : 1.08
              : 1.24
            : poseId === 5
              ? s === 1
                ? 0.06
                : 1.24
              : s === -1
                ? 1.24
                : 0.32
        const delta = parent.clone().multiply(axis(0, 0, 1, -s * bend))
        set(finger + '_0' + i + '_' + side, delta, parent)
        parent = delta
      }
    }
  }
}
