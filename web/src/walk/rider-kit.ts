import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'

/**
 * 骑行者套件（rider kit）
 * ------------------------------------------------------------------
 * 目标：换成「带骨骼角色 + 成品骑行坐姿动画」，手是动画本身握在把手上，
 * 而不是我们用 IK 去猜。这个文件只做三件事：
 *
 *   1. 从 public/rider/*.glb 载入角色 + 动画（文件名匹配 /ride|sit/i 的片段优先）
 *   2. 量出动画第 0 帧两只手的世界坐标 —— 这就是「握点」
 *   3. 反算车把组该怎么缩放/平移，让把手正好落在握点上
 *
 * 用法（下一步接进 walk/index.ts 的骑乘分支）：
 *
 *   const rider = await loadRider('/rider/rider.glb')
 *   if (rider) {
 *     const grips = measureGrips(rider)
 *     alignHandlebar(bikeInstance, grips)   // 车把对齐握点
 *     rider.play('ride')
 *   }
 */

const loader = new GLTFLoader()

export interface RiderGrip {
  hand: 'L' | 'R'
  /** 角色模型空间里的握点 */
  position: THREE.Vector3
  /** 手部朝向（掌心法线方向），用来决定把手轴线 */
  normal: THREE.Vector3
}

export interface Rider {
  root: THREE.Group
  clips: THREE.AnimationClip[]
  gripClips: Record<'ride' | 'idle', THREE.AnimationClip | undefined>
  grips: RiderGrip[]
  mixer(): THREE.AnimationMixer
}

const HAND_L = /^(Hand|Fist|Wrist)[._]?L$/i
const HAND_R = /^(Hand|Fist|Wrist)[._]?R$/i
const INDEX = /^(Index1|Finger1|Thumb1)[._]?L$/i

/** 找骨骼（不同资源的命名带点/不带点，统一去点比较） */
function findBone(root: THREE.Object3D, pattern: RegExp): THREE.Bone | undefined {
  let found: THREE.Bone | undefined
  root.traverse(object => {
    const bone = object as THREE.Bone
    if (!found && bone.isBone && pattern.test(bone.name.replace(/\./g, ''))) found = bone
  })
  return found
}

/** 载入角色；文件名里的 clip 名字随意，内部按关键字挑 */
export async function loadRider(url: string): Promise<Rider | null> {
  try {
    const gltf = await loader.loadAsync(url)
    const root = gltf.scene
    root.updateMatrixWorld(true)
    const clips = gltf.animations ?? []
    const pick = (pattern: RegExp) => clips.find(clip => pattern.test(clip.name))
    const rider: Rider = {
      root,
      clips,
      gripClips: {ride: pick(/ride|sit|driv/i), idle: pick(/idle|stand/i)},
      grips: [],
      mixer: () => new THREE.AnimationMixer(root),
    }
    rider.grips = measureGrips(rider)
    return rider
  } catch (error) {
    // 没有资源是正常状态：调用方回退到现有的程序化坐姿
    console.info('[rider] 没有可用的骑行者资源：', url, error)
    return null
  }
}

/**
 * 量握点：把模型摆到坐姿动画的第 0 帧，取两只 Hand 骨骼的世界坐标。
 * 如果资源里没有动画，就直接用静态姿势量（很多坐姿模型是摆好姿势导出的）。
 */
export function measureGrips(rider: Rider): RiderGrip[] {
  const root = rider.root
  const clip = rider.gripClips.ride
  if (clip) {
    const mixer = new THREE.AnimationMixer(root)
    const action = mixer.clipAction(clip)
    action.play()
    mixer.setTime(0)
    root.updateMatrixWorld(true)
  }
  const result: RiderGrip[] = []
  for (const [hand, pattern] of [['L', HAND_L], ['R', HAND_R]] as const) {
    const bone = findBone(root, pattern)
    if (!bone) continue
    const position = new THREE.Vector3()
    bone.getWorldPosition(position)
    // 掌心法线：用「手腕 → 食指根」的方向做近似，够用来摆正把手
    const index = findBone(root, INDEX)
    const normal = new THREE.Vector3(0, 1, 0)
    if (index) {
      const tip = new THREE.Vector3()
      index.getWorldPosition(tip)
      normal.copy(tip).sub(position).normalize()
    }
    result.push({hand, position, normal})
  }
  return result
}

/**
 * 车把对齐：车身上的把套是两个点，把它平移/缩放到我们量出来的握点。
 * 返回缩放比和偏移，方便写进配置（也可以直接作用在模型上）。
 */
export function alignHandlebar(
  bike: THREE.Object3D,
  grips: RiderGrip[],
  barHalfWidth = 0.318,
): {scale: number; offset: THREE.Vector3; gripDistance: number} | null {
  if (grips.length < 2) return null
  const [a, b] = grips
  const distance = a.position.distanceTo(b.position)
  // 两个握点之间的距离 = 2 * barHalfWidth * scale
  const scale = distance / (barHalfWidth * 2)
  const center = a.position.clone().add(b.position).multiplyScalar(0.5)
  bike.updateMatrixWorld(true)
  const bikeBar = bike.localToWorld(new THREE.Vector3(0, 1.128, 0.3))
  const offset = center.clone().sub(bikeBar)
  return {scale, offset, gripDistance: distance}
}

/** 给套件用：把坐姿动画挂到骨架上播放 */
export function playRide(rider: Rider, speedFactor = 1): THREE.AnimationMixer | null {
  const clip = rider.gripClips.ride
  if (!clip) return null
  const mixer = new THREE.AnimationMixer(rider.root)
  const action = mixer.clipAction(clip)
  action.setLoop(THREE.LoopRepeat, Infinity)
  action.timeScale = speedFactor
  action.play()
  return mixer
}
