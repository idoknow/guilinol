import * as THREE from 'three'

/**
 * 手写关键帧动画（走路 / 跑步 / 骑行坐姿）
 * ------------------------------------------------------------------
 * 思路：不再每帧用 IK 猜姿势，而是把姿势写成**关键帧**，交给 AnimationMixer 播。
 * 好处：
 *   · 姿势只算一次，播放是常量开销（不会因为相机/速度变化抖动）
 *   · 可以直接用 Hand / 手指骨骼的**四元数**精确控制“手掌扣在把套上”
 *   · 走路、跑步、骑行是同一套机制，参数不同而已
 *
 * 骨骼命名兼容：Quaternius 的 `UpperArm.L` 在 three 里会变成 `UpperArmL`，
 * 这里统一写「去点」的名字。
 */

export type ClipPose = {
  /** 骨骼名（不带点，例如 UpperArmL）→ 欧拉角（弧度，角色自身坐标系） */
  bones: Record<string, [number, number, number]>
  /** 髋部相对静止姿势的位移（米） */
  hips?: [number, number, number]
}

export interface ClipSpec {
  name: string
  /** 循环一圈的时长（秒） */
  duration: number
  /** 关键帧：t 从 0 到 1 */
  keys: {t: number; pose: ClipPose}[]
}

const deg = THREE.MathUtils.degToRad

/** 把「关键帧姿势表」编成 AnimationClip（四元数轨道） */
export function buildClip(rest: Map<string, THREE.Quaternion>, spec: ClipSpec): THREE.AnimationClip {
  const boneNames = new Set<string>()
  for (const key of spec.keys) for (const name of Object.keys(key.pose.bones)) boneNames.add(name)
  const tracks: THREE.KeyframeTrack[] = []
  const euler = new THREE.Euler()
  const quaternion = new THREE.Quaternion()
  for (const name of boneNames) {
    const base = rest.get(name)?.clone() ?? new THREE.Quaternion()
    const times: number[] = []
    const values: number[] = []
    for (const key of spec.keys) {
      const angles = key.pose.bones[name]
      if (!angles) continue
      times.push(key.t * spec.duration)
      euler.set(angles[0], angles[1], angles[2], 'XYZ')
      quaternion.setFromEuler(euler).multiply(base)
      values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
    }
    if (times.length < 2) continue
    tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values))
  }
  return new THREE.AnimationClip(spec.name, spec.duration, tracks)
}

/* ------------------------------------------------------------------ 走路 */
/** 走路：大腿 ±26°、摆动腿屈膝 42°、对侧摆臂 ±26° */
export function walkSpec(): ClipSpec {
  const swing = deg(26), knee = deg(42), arm = deg(26), elbow = deg(18)
  const frame = (sign: number): ClipPose => ({
    bones: {
      UpperLegL: [swing * sign, 0, 0],
      UpperLegR: [-swing * sign, 0, 0],
      LowerLegL: [-deg(10) - knee * Math.max(0, -sign), 0, 0],
      LowerLegR: [-deg(10) - knee * Math.max(0, sign), 0, 0],
      FootL: [-(swing * sign + (-deg(10) - knee * Math.max(0, -sign))) + deg(6), 0, 0],
      FootR: [-(-swing * sign + (-deg(10) - knee * Math.max(0, sign))) + deg(6), 0, 0],
      UpperArmL: [-arm * sign, deg(3), deg(76)],
      UpperArmR: [arm * sign, -deg(3), -deg(76)],
      LowerArmL: [elbow, 0, 0],
      LowerArmR: [elbow, 0, 0],
      Spine: [deg(3), deg(4) * sign, 0],
      Chest: [0, deg(-6) * sign, 0],
    },
    hips: [0, Math.max(0, Math.cos(sign * Math.PI * 0.5)) * 0.02, 0],
  })
  return {
    name: 'walk',
    duration: 0.9,
    keys: [
      {t: 0, pose: frame(0)},
      {t: 0.25, pose: frame(1)},
      {t: 0.5, pose: frame(0)},
      {t: 0.75, pose: frame(-1)},
      {t: 1, pose: frame(0)},
    ],
  }
}

/* ------------------------------------------------------------------ 跑步 */
export function runSpec(): ClipSpec {
  const swing = deg(44), knee = deg(78), arm = deg(40), elbow = deg(70)
  const frame = (sign: number): ClipPose => ({
    bones: {
      UpperLegL: [swing * sign, 0, 0],
      UpperLegR: [-swing * sign, 0, 0],
      LowerLegL: [-deg(18) - knee * Math.max(0, -sign), 0, 0],
      LowerLegR: [-deg(18) - knee * Math.max(0, sign), 0, 0],
      FootL: [-(swing * sign + (-deg(18) - knee * Math.max(0, -sign))) + deg(10), 0, 0],
      FootR: [-(-swing * sign + (-deg(18) - knee * Math.max(0, sign))) + deg(10), 0, 0],
      UpperArmL: [-arm * sign, deg(6), deg(70)],
      UpperArmR: [arm * sign, -deg(6), -deg(70)],
      LowerArmL: [elbow, 0, 0],
      LowerArmR: [elbow, 0, 0],
      Spine: [deg(-12), deg(6) * sign, 0],
      Chest: [0, deg(-8) * sign, 0],
      Head: [deg(9), deg(-3) * sign, 0],
    },
    hips: [0, Math.max(0, Math.cos(sign * Math.PI * 0.5)) * 0.05, 0],
  })
  return {
    name: 'run',
    duration: 0.62,
    keys: [
      {t: 0, pose: frame(0)},
      {t: 0.25, pose: frame(1)},
      {t: 0.5, pose: frame(0)},
      {t: 0.75, pose: frame(-1)},
      {t: 1, pose: frame(0)},
    ],
  }
}

/* -------------------------------------------------------------- 骑行坐姿 */
/**
 * 骑行：屁股坐坐垫、双手扣把、双脚踩踏板。
 * 这里的角度是「角色空间」的，跟车身朝向无关；车把位置由 rideTargets 决定，
 * 靠 upperArm 的 z 轴下垂角 + y 轴内收把手臂送到把套上。
 */
export function rideSpec(): ClipSpec {
  // 手掌朝向：让掌心朝向把手轴线（拇指朝上扣住）
  const palmL: [number, number, number] = [deg(-72), deg(-16), deg(58)]
  const palmR: [number, number, number] = [deg(-72), deg(16), deg(-58)]
  const finger = deg(26)
  const grip = (side: 'L' | 'R'): Record<string, [number, number, number]> => {
    const s = side === 'L' ? 1 : -1
    const bones: Record<string, [number, number, number]> = {}
    for (const name of ['Index', 'Middle', 'Ring', 'Pinky']) {
      bones[`${name}2${side}`] = [finger * s * 0.6, 0, 0]
      bones[`${name}3${side}`] = [finger * s, 0, 0]
      bones[`${name}4${side}`] = [finger * s * 1.2, 0, 0]
    }
    bones[`Thumb2${side}`] = [deg(14) * s, 0, deg(20) * s]
    bones[`Thumb3${side}`] = [deg(18) * s, 0, 0]
    return bones
  }
  const pose: ClipPose = {
    bones: {
      // 腿：大腿前抬、小腿回收，脚掌踩平
      UpperLegL: [deg(78), 0, deg(-4)],
      UpperLegR: [deg(78), 0, deg(4)],
      LowerLegL: [deg(-76), 0, 0],
      LowerLegR: [deg(-76), 0, 0],
      FootL: [deg(-2), 0, 0],
      FootR: [deg(-2), 0, 0],
      // 手臂：前伸 + 内收，肘微屈，手掌扣把
      UpperArmL: [deg(38), deg(14), deg(46)],
      UpperArmR: [deg(38), deg(-14), deg(-46)],
      LowerArmL: [deg(26), 0, 0],
      LowerArmR: [deg(26), 0, 0],
      HandL: palmL,
      HandR: palmR,
      ...grip('L'),
      ...grip('R'),
      // 上身略前倾、抬头看路
      Spine: [deg(8), 0, 0],
      Chest: [deg(5), 0, 0],
      Head: [deg(-8), 0, 0],
    },
    hips: [0, -0.12, 0],
  }
  return {name: 'ride', duration: 1, keys: [{t: 0, pose}, {t: 1, pose}]}
}

/** 一次性生成三套片段 */
export function buildClips(rest: Map<string, THREE.Quaternion>) {
  return {
    walk: buildClip(rest, walkSpec()),
    run: buildClip(rest, runSpec()),
    ride: buildClip(rest, rideSpec()),
  }
}
