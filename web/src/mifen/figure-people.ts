import * as THREE from 'three'
import {clone} from 'three/addons/utils/SkeletonUtils.js'
import type {Avatar} from '../../../lib/avatar'
import {avatar as figureSpec} from '../look/avatar'
import {randomPasserby, type Age} from '../traffic/crowd'
import {blendPasserbyWeights, syncPasserbyActions} from '../traffic/crowd-anim'
import {ensureAvatarRig, type AvatarJointHandle, type AvatarRig} from '../walk/avatar-rig'

/**
 * 米粉店里的人（顾客、表叔）与街上路人、玩家同一套角色：figure.glb + 创建角色的脸/发型/穿搭。
 * 店里原有的动作代码按「面朝 +z 的方块人」写关节角；这里统一把它们换算到角色骨骼（角色空间面朝 −z）。
 */
export type FigureLook = Avatar & {height: number; girth: number; hairTint?: string}

export interface FigureTemplate {
  scene: THREE.Group
  clips: THREE.AnimationClip[]
}

const WALK_STRIDE = 1.65 // m/s，walk 片段的设计步速（与 traffic/crowd.ts 一致）

export function loadFigureTemplate(look: FigureLook): Promise<FigureTemplate> {
  return import('../walk/character').then(async mod => {
    const model = await mod.previewCharacter(look)
    const hair = model.scene.userData.creatorHair as THREE.Object3D | undefined
    model.scene.userData = {}
    if (look.hairTint) {
      hair?.traverse(node => {
        if (node instanceof THREE.Mesh) (node.material as THREE.MeshStandardMaterial).color.set(look.hairTint!)
      })
    }
    model.scene.scale.set(look.girth * look.height, look.height, look.girth * look.height)
    return {scene: model.scene, clips: model.animations}
  })
}

export interface FigureInstance {
  /** 外层容器：已转 180°，与店里原有角色同样面朝本地 +z */
  holder: THREE.Group
  rig: AvatarRig
  mixer: THREE.AnimationMixer
  walk?: THREE.AnimationAction
  idle?: THREE.AnimationAction
  /** 站立时骨盆离脚底高度（含身高缩放） */
  pelvisY: number
  /** 站立时肩高与上臂/小臂长度（含身高缩放），用来把手摆到碗边 */
  arm: {shoulderY: number; upper: number; fore: number}
  dispose(): void
}

export function instantiateFigure(t: FigureTemplate): FigureInstance {
  const instance = clone(t.scene) as THREE.Group
  const holder = new THREE.Group()
  holder.name = 'mifen.figure'
  holder.rotation.y = Math.PI
  holder.add(instance)
  // ensureAvatarRig 会把根节点缩放归 1，身高/胖瘦挪到外层容器上
  holder.scale.copy(instance.scale)
  const rig = ensureAvatarRig(instance)
  const mixer = new THREE.AnimationMixer(instance)
  const clip = (name: string) => t.clips.find(item => item.name === name)
  const walkClip = clip(figureSpec.clips.walk)
  const idleClip = clip(figureSpec.clips.idle)
  const walk = walkClip ? mixer.clipAction(walkClip).setLoop(THREE.LoopRepeat, Infinity) : undefined
  const idle = idleClip ? mixer.clipAction(idleClip).setLoop(THREE.LoopRepeat, Infinity) : undefined
  if (idle) idle.time = Math.random() * idle.getClip().duration
  syncPasserbyActions(walk, idle, 0)
  rig.clearPose()
  holder.updateMatrixWorld(true)
  const pelvis = instance.getObjectByName('pelvis')
  const pelvisY = pelvis ? pelvis.getWorldPosition(new THREE.Vector3()).y : 0.9
  const at = (name: string) => instance.getObjectByName(name)?.getWorldPosition(new THREE.Vector3())
  const shoulder = at('upperarm_r')
  const elbow = at('lowerarm_r')
  const wrist = at('hand_r')
  const arm =
    shoulder && elbow && wrist
      ? {shoulderY: shoulder.y, upper: shoulder.distanceTo(elbow), fore: elbow.distanceTo(wrist)}
      : {shoulderY: pelvisY * 1.5, upper: 0.28, fore: 0.26}
  // 先求一帧，新生成的人不露 T-Pose
  mixer.update(0)
  return {
    holder,
    rig,
    mixer,
    walk,
    idle,
    pelvisY,
    arm,
    dispose() {
      mixer.stopAllAction()
      instance.traverse(node => {
        if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose()
      })
      holder.removeFromParent()
    },
  }
}

/** 上臂前抬 armX 时，小臂屈多少能让手腕落在 wristY 高度（肩高可另给，如坐下后） */
export function solveForearm(inst: FigureInstance, armX: number, wristY: number, shoulderY = inst.arm.shoulderY): number {
  const {upper, fore} = inst.arm
  const elbowY = shoulderY - upper * Math.cos(armX)
  const total = Math.acos(THREE.MathUtils.clamp((elbowY - wristY) / fore, -0.3, 0.95))
  return THREE.MathUtils.clamp(total - armX, 0.3, 1.6)
}

/** 店里旧关节角（面朝 +z、左块在 −x）换到角色关节（面朝 −z）：x、z 取反，左右互换由调用方处理。 */
export function setJoint(joint: AvatarJointHandle | undefined, x: number, y: number, z: number): void {
  joint?.rotation.set(-x, y, -z)
}

/** 空手站立/走路：交给 walk/idle 片段（与街上路人同一套混合）。 */
export function driveFigureClips(
  inst: FigureInstance,
  state: {mode: 'clip' | 'pose'; walkWeight: number},
  speed: number,
  dt: number,
): void {
  if (state.mode !== 'clip') {
    inst.rig.clearPose()
    state.mode = 'clip'
  }
  state.walkWeight = blendPasserbyWeights(state.walkWeight, speed > 0.15, dt)
  inst.walk?.setEffectiveTimeScale(THREE.MathUtils.clamp(speed / WALK_STRIDE, 0.45, 1.25))
  syncPasserbyActions(inst.walk, inst.idle, state.walkWeight)
  inst.mixer.update(dt)
}

/** 顾客角色模板池：按年龄段预热，生成顾客时同步取用，与街上路人同源。 */
export function createFigurePool(perAge: number, seed: number) {
  const ages: Age[] = ['student', 'young', 'middle', 'elder']
  const ready = new Map<Age, FigureTemplate[]>()
  let state = seed >>> 0
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
  let disposed = false
  for (const age of ages) {
    ready.set(age, [])
    for (let i = 0; i < perAge; i++) {
      loadFigureTemplate(randomPasserby(random, age))
        .then(t => {
          if (!disposed) ready.get(age)!.push(t)
        })
        .catch(error => console.warn('mifen figure unavailable', error))
    }
  }
  return {
    take(age: Age): FigureTemplate | undefined {
      const own = ready.get(age)!
      const list = own.length ? own : ages.map(a => ready.get(a)!).find(l => l.length)
      return list?.[Math.floor(Math.random() * list.length)]
    },
    dispose() {
      disposed = true
      ready.clear()
    },
  }
}
