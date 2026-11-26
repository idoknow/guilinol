import { Vector3, type Object3D } from 'three'
import type { AvatarRig, AvatarJointName } from '../walk/avatar-rig'
import type { Fighter, Phase } from './state'
const point = new Vector3()
function groundDrop(rig: AvatarRig, root: Object3D, fallback: number) {
  root.updateWorldMatrix(true, false)
  const ground = root.matrixWorld.elements[13] - rig.soleOffset
  let lowest = Infinity
  for (const { joint, points } of rig.footProbes) {
    joint.updateWorldMatrix(true, false)
    for (const probe of points) lowest = Math.min(lowest, point.copy(probe).applyMatrix4(joint.matrixWorld).y)
  }
  for (const name of ['calf_l', 'calf_r', 'hand_l', 'hand_r']) {
    const bone = root.getObjectByName(name)
    if (bone)
      lowest = Math.min(lowest, bone.getWorldPosition(point).y - (name.startsWith('calf') ? 0.065 : 0.055))
  }
  return Number.isFinite(lowest) ? lowest - ground : fallback
}
export function pose(rig: AvatarRig, f: Fighter, phase: Phase, t: number, yaw: number, root?: Object3D) {
  const set = (name: AvatarJointName, x: number, y = 0, z = 0) => rig.joints[name]?.rotation.set(x, y, z)
  let drop = 0
  rig.batch?.(true)
  try {
    if (phase === 'stagger') {
      const u = (t - f.struck) / (f.heavy ? 410 : 280)
      // 受击：轻击 0.45 rad、重击 0.75 rad 的后仰/侧晃，头再多甩一点，看得出挨了一下
      const recoil = Math.sin(Math.PI * Math.sqrt(Math.min(1, u))) * (f.heavy ? 0.75 : 0.45)
      set('Torso', recoil * Math.cos(f.dir - yaw), 0, -recoil * Math.sin(f.dir - yaw))
      set('Head', 0.5 * recoil * Math.cos(f.dir - yaw), 0, -0.5 * recoil * Math.sin(f.dir - yaw))
    } else if (['windup', 'strike', 'recover'].includes(phase)) {
      const age = t - f.punched,
        left = f.side === 'l',
        sign = left ? 1 : -1
      const extend = age < 100 ? (age / 100) * 0.35 : age < 160 ? 1 : Math.max(0, 1 - (age - 160) / 180)
      set('Torso', -0.09 * extend, sign * 0.28 * extend)
      // 出拳：此骨架大臂 x 为负 = 向前抬（正值是往后上方甩，看起来像举手）。命中帧抬到肩高（-1.45），
      // 前摇时大臂先抬一半，小臂保持伸直（肘部弯向未在 GPU 上核对前不加屈肘）
      set(left ? 'ArmL' : 'ArmR', -1.45 * extend, sign * (f.kind === 'hook' ? 0.55 : 0.12) * extend)
      set(left ? 'ForearmL' : 'ForearmR', 0)
    } else if (phase === 'reviving') {
      const lift = Math.min(1, (1 - f.assistProgress) * 4)
      set('Torso', -0.85 * lift)
      set('ThighL', 0.55)
      set('ThighR', 0.55)
      set('ShinL', -0.8)
      set('ShinR', -0.8)
      set('ArmL', 1.2 * lift)
      set('ArmR', 1.2 * lift)
      drop = 0.18 * lift
    } else if (phase !== 'idle') {
      const weight =
        phase === 'falling'
          ? Math.min(1, (t - f.fallen) / 320)
          : phase === 'rising'
            ? f.riseWeight * Math.max(0, 1 - (t - f.risen) / 420)
            : 1
      const w = weight * (phase === 'being_revived' ? 1 - 0.45 * f.progress : 1)
      const step = phase === 'crawling' ? Math.sin(t * 0.008) * 0.19 : 0
      set('Hips', -0.92 * w)
      set('Torso', -0.46 * w)
      set('Head', 0.38 * w)
      set('ThighL', 1.25 * w + step)
      set('ThighR', 1.25 * w - step)
      set('ShinL', -1.95 * w)
      set('ShinR', -1.95 * w)
      set('ArmL', 1.52 * w - step)
      set('ArmR', 1.52 * w + step)
      drop = 0.58 * w
    }
  } finally {
    rig.batch?.(false)
  }
  return drop && root ? groundDrop(rig, root, drop) : drop
}
