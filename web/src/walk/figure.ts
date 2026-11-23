import * as THREE from 'three'
import {AVATAR_KEY, defaultAvatar, sanitizeAvatar, type Avatar} from '../../../lib/avatar'
import {characterModel, disposeCharacterParts, styleCharacter} from './character'
import {ensureAvatarRig, type AvatarRig} from './avatar-rig'
import type {AvatarOutfitController} from './outfits'
import {starterOutfit} from '../game/catalog'
import {SMOKE_ANCHORS} from '../smoke/anchors'

/**
 * 游戏内人物：把上游角色系统（figure_m/f.glb + avatar-rig 骨骼 + 穿搭）包成
 * walk/index.ts 需要的那一小撮接口（root / pose / setHeadHidden / headPosition / dispose），
 * 语义与旧 look/character 的 Character 保持一致，方便逐步替换。
 *
 * 动画分两层：
 *   1) 基础层：GLB 自带的 idle / walk 剪辑，按权重交叉淡入淡出（素材只有这两个 + wave）。
 *   2) 叠加层：跑 / 跳 / 蹲 / 骑 没有剪辑，用「角色空间」的旋转和朝向在 mixer.update() 之后
 *      改写骨骼。注意不能走 avatar-rig 的 joints：它每次都把全部骨骼重置回 rest 再按状态写，
 *      和剪辑混用会把走路姿势整个清掉；这里只对自己关心的骨骼做增量。
 */
export interface FigurePose {
  moving: boolean
  /** 期望速度（m/s），决定步频和是否进跑姿 */
  speed: number
  grounded: boolean
  crouch?: boolean
  /** 骑青桂电车 / 坐船：坐姿 + 手前伸扶把 */
  riding?: boolean
  /** 车上绑定点（车把/脚踏的世界坐标），有就用来把手脚精确对上去 */
  ride?: RideAnchors
  /** 抽烟：左手举烟盒、右手举打火机/夹烟 */
  smoke?: SmokePose
  /** 倒地（摔倒 / 血量归零）：趴在地上；给数字表示权重（踉跄时用 0.6 左右） */
  down?: boolean | number
  /** 出拳：0..1 的瞬时权重，右臂向前打 */
  punch?: number
}

/** 抽烟姿势的几条权重，全部 0..1；由 smoke/session.ts 的 SmokeView 提供 */
export interface SmokePose {
  /** 右臂抬起来的总权重（夹着烟，0 = 手放下去） */
  hold: number
  /** 左手举烟盒的权重：只在「取烟 → 点着」这一小段是 1 */
  carry: number
  /** 点烟动作：右手把打火机凑上去 */
  light: number
  /** 正在吸：右手把烟送到嘴边 */
  puff: number
}

export interface RideAnchors {
  gripL?: THREE.Vector3
  gripR?: THREE.Vector3
  deckL?: THREE.Vector3
  deckR?: THREE.Vector3
}

export interface Figure {
  root: THREE.Group
  rig: AvatarRig
  avatar: Avatar
  pose(dt: number, state: FigurePose): void
  setHeadHidden(on: boolean): void
  setRiderView(on: boolean): void
  /** 头骨的世界坐标（第一人称相机用） */
  headPosition(out: THREE.Vector3): THREE.Vector3
  /** 某根骨骼在当前姿势下、人物根节点的局部坐标；没有这根骨骼返回 null */
  jointLocal(name: string, out: THREE.Vector3): THREE.Vector3 | null
  /** 骨骼相对人物根节点的旋转（夹烟要对齐手指） */
  jointQuat(name: string, out: THREE.Quaternion): THREE.Quaternion | null
  /** 嘴在人物根节点局部坐标里的位置（抽烟的点烟/吸动作要对它） */
  mouthLocal(out: THREE.Vector3): THREE.Vector3
  dispose(): void
}

/** 读当前玩家外形：上游角色页写的就是这个键 */
export function readAvatar(): Avatar {
  try {
    return sanitizeAvatar(JSON.parse(localStorage.getItem(AVATAR_KEY) ?? 'null')) ?? defaultAvatar()
  } catch {
    return defaultAvatar()
  }
}

/** 人物资源只有 walk / idle / wave 三个剪辑（没有 run / jump / crouch）。 */
const CLIP_SPEED = 3.2
/** 头骨原点到眼睛的高度（角色空间，米） */
const EYE_ABOVE_HEAD = 0.1
const HEAD_HIDDEN_SCALE = 0.001
/** 超过这个速度用跑姿（走路 4、跑步 9） */
const RUN_SPEED = 6

// 角色空间的方向约定：-Z 前、+Y 上、+X 右（ensureAvatarRig 已把模型翻到 -Z 朝前）
const AXIS_X = new THREE.Vector3(1, 0, 0)
const AXIS_Y = new THREE.Vector3(0, 1, 0)

/** 叠加层用到的骨骼名（缺哪个就跳过哪个，不影响其它） */
const OVERLAY_BONES = [
  'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r',
  // 手指：模型自带 40 根指骨，但目前只有拇指有蒙皮权重（index/middle/ring/pinky 是 0 顶点），
  // 所以这里挂上去后只有拇指会动——夹烟先靠它，食指等补权重后自动跟进。
  'thumb_01_l', 'thumb_02_l', 'thumb_03_l', 'thumb_01_r', 'thumb_02_r', 'thumb_03_r',
  'index_01_l', 'index_02_l', 'index_01_r', 'index_02_r',
] as const

export async function createFigure(avatar: Avatar = readAvatar()): Promise<Figure> {
  const model = await characterModel(avatar)
  const root = model.scene
  // 方便调试/测试读当前人物用的是哪份外形
  root.userData.avatar = avatar
  // ensureAvatarRig 会把 figure_*.glb 的 +Z 朝向翻到游戏用的 -Z，并建好头/躯干挂点和脚底探针
  const rig = ensureAvatarRig(root)
  const outfits: AvatarOutfitController = styleCharacter(root, rig, avatar)
  outfits.applyEquipped(starterOutfit(avatar.look))

  const mixer = new THREE.AnimationMixer(root)
  const clip = (name: string) => model.animations.find((item) => item.name === name)
  const walkClip = clip('walk')
  const idleClip = clip('idle') ?? walkClip
  const walk = walkClip ? mixer.clipAction(walkClip) : undefined
  const idle = idleClip ? mixer.clipAction(idleClip) : undefined
  walk?.play()
  idle?.play()
  walk?.setEffectiveWeight(0)
  idle?.setEffectiveWeight(1)

  const head = root.getObjectByName('head')
  const neck = root.getObjectByName('neck_01')
  const headScale = head?.scale.clone()
  const neckScale = neck?.scale.clone()
  const hidden = new THREE.Vector3(HEAD_HIDDEN_SCALE, HEAD_HIDDEN_SCALE, HEAD_HIDDEN_SCALE)
  const scratch = new THREE.Vector3()
  // 隐藏前记下「头骨原点在 neck_01 局部空间的位置」：隐藏时脖子会被缩放，
  // 之后算第一人称相机就只能靠这份静息偏移 + 脖子世界的旋转，不然镜头会跟着缩到脖子根。
  const headInNeck = new THREE.Vector3()
  if (head && neck) {
    root.updateMatrixWorld(true)
    head.getWorldPosition(headInNeck)
    neck.worldToLocal(headInNeck)
  }
  const neckMatrix = new THREE.Matrix4()
  const neckPos = new THREE.Vector3()
  const neckQuat = new THREE.Quaternion()
  const ONE = new THREE.Vector3(1, 1, 1)

  // —— 叠加层用的骨骼表（一次查好，避免每帧按名字遍历） ——
  const bones = new Map<string, THREE.Object3D>()
  for (const name of OVERLAY_BONES) {
    const bone = root.getObjectByName(name)
    if (bone) bones.set(name, bone)
  }

  // 骨骼长度（静息姿态量一次）：两段 IK 要用它算肘/膝位置，骨骼长度是固定的
  const boneLength = new Map<string, number>()
  {
    const pa = new THREE.Vector3()
    const pb = new THREE.Vector3()
    const measure = (name: string, child: string) => {
      const a = bones.get(name)
      const b = bones.get(child)
      if (!a || !b) return
      a.getWorldPosition(pa)
      b.getWorldPosition(pb)
      const length = pa.distanceTo(pb)
      if (length > 1e-3) boneLength.set(name, length)
    }
    for (const side of ['l', 'r']) {
      measure('upperarm_' + side, 'lowerarm_' + side)
      measure('lowerarm_' + side, 'hand_' + side)
      measure('thigh_' + side, 'calf_' + side)
      measure('calf_' + side, 'foot_' + side)
    }
  }
  // 调试用：IK 能不能够到目标，看这个就知道
  root.userData.boneLength = Object.fromEntries(boneLength)

  const qRoot = new THREE.Quaternion()
  const rootQuatScratch = new THREE.Quaternion()
  const qParent = new THREE.Quaternion()
  const qParentInv = new THREE.Quaternion()
  const qDelta = new THREE.Quaternion()
  const qBlend = new THREE.Quaternion()
  const qLocal = new THREE.Quaternion()
  const Q_IDENTITY = new THREE.Quaternion()
  const axisWorld = new THREE.Vector3()
  const dirCurrent = new THREE.Vector3()
  const dirTarget = new THREE.Vector3()
  const dirAim = new THREE.Vector3()
  const posBone = new THREE.Vector3()
  const posChild = new THREE.Vector3()

  /** 骨骼当前世界四元数（矩阵是渲染后才更新的，这里主动刷新祖先） */
  const worldQuat = (bone: THREE.Object3D, out: THREE.Quaternion) => bone.getWorldQuaternion(out)

  /** 把角色空间的向量转到世界空间（人物整体有 yaw 旋转，每帧缓存一次 root 朝向） */
  function charToWorld(v: THREE.Vector3, out: THREE.Vector3) {
    return out.copy(v).applyQuaternion(qRoot)
  }

  /** 绕「角色空间轴」旋转某根骨骼（weight 用来淡入淡出） */
  function spin(name: string, axisChar: THREE.Vector3, angle: number, weight: number) {
    const bone = bones.get(name)
    if (!bone || !bone.parent || weight <= 0 || Math.abs(angle) < 1e-4) return
    charToWorld(axisChar, axisWorld).normalize()
    qLocal.copy(bone.quaternion)
    worldQuat(bone.parent, qParent)
    qDelta.setFromAxisAngle(axisWorld, angle * weight)
    qParentInv.copy(qParent).invert()
    // local' = parentW⁻¹ · Δ · parentW · local（qLocal 先存好原值，别被自己覆盖）
    bone.quaternion.copy(qParentInv).multiply(qDelta).multiply(qParent).multiply(qLocal)
  }

  /** 核心：把骨骼转到「世界空间里的某个方向」上（骨骼朝向用「骨骼→子骨骼」定义） */
  function aimDir(name: string, dirWorld: THREE.Vector3, weight: number, childName?: string) {
    const bone = bones.get(name)
    if (!bone || !bone.parent || weight <= 0) return
    const child = (childName && bones.get(childName)) || bone.children[0]
    if (!child) return
    bone.getWorldPosition(posBone)
    child.getWorldPosition(posChild)
    dirCurrent.copy(posChild).sub(posBone)
    if (dirCurrent.lengthSq() < 1e-8) return
    dirCurrent.normalize()
    qDelta.setFromUnitVectors(dirCurrent, dirWorld)
    qBlend.copy(Q_IDENTITY).slerp(qDelta, Math.min(1, weight))
    if (qBlend.angleTo(Q_IDENTITY) < 1e-4) return
    qLocal.copy(bone.quaternion)
    worldQuat(bone.parent, qParent)
    qParentInv.copy(qParent).invert()
    bone.quaternion.copy(qParentInv).multiply(qBlend).multiply(qParent).multiply(qLocal)
  }

  /** 让骨骼指向角色空间里的某个方向 */
  function aim(name: string, dirChar: THREE.Vector3, weight: number, childName?: string) {
    charToWorld(dirChar, dirTarget).normalize()
    aimDir(name, dirTarget, weight, childName)
  }

  /** 让骨骼指向世界空间里的某个点（骑车时把双手/双脚对到车把和踏板上） */
  function aimAt(name: string, targetWorld: THREE.Vector3, weight: number, childName?: string) {
    const bone = bones.get(name)
    if (!bone) return
    bone.getWorldPosition(posBone)
    // 注意：方向要单独存，别写回 targetWorld（调用方可能传的就是共享 scratch，
    // 之前把「方向」当「点」再减一次骨骼坐标，腿就歪到侧面去了）
    dirAim.copy(targetWorld).sub(posBone)
    if (dirAim.lengthSq() < 1e-8) return
    dirAim.normalize()
    aimDir(name, dirAim, weight, childName)
  }

  // —— 两段 IK：只「朝那个方向伸」手会离车把还有 30 cm，必须弯肘/弯膝才能真正贴上去 ——
  const ikAxis = new THREE.Vector3()
  const ikPoleAxis = new THREE.Vector3()
  const ikPole = new THREE.Vector3()
  const ikJoint = new THREE.Vector3()
  const ikShoulder = new THREE.Vector3()

  /** 让 upper→lower 两段骨骼够到 target，并把 lower 的末端（child）精确放到 target 上 */
  function reachTwoBone(upperName: string, lowerName: string, childName: string, target: THREE.Vector3, poleChar: THREE.Vector3, weight: number) {
    const upper = bones.get(upperName)
    const lower = bones.get(lowerName)
    const l1 = boneLength.get(upperName) ?? 0
    const l2 = boneLength.get(lowerName) ?? 0
    if (!upper || !lower || !l1 || !l2 || weight <= 0) return
    upper.getWorldPosition(ikShoulder)
    const dx = target.x - ikShoulder.x, dy = target.y - ikShoulder.y, dz = target.z - ikShoulder.z
    const raw = Math.hypot(dx, dy, dz)
    if (raw < 1e-4) return
    // 超出臂长就伸直（外推），太近就把关节撑开
    const d = Math.min(l1 + l2 - 0.005, Math.max(Math.abs(l1 - l2) + 0.005, raw))
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    const bulge = Math.sqrt(Math.max(0, l1 * l1 - along * along))
    ikAxis.set(dx, dy, dz).normalize()
    charToWorld(poleChar, ikPoleAxis).normalize()
    // 极向量去掉沿轴的分量，得到「往哪边弯」
    ikPole.copy(ikPoleAxis).addScaledVector(ikAxis, -ikPoleAxis.dot(ikAxis))
    if (ikPole.lengthSq() < 1e-6) {
      ikPole.set(0, 1, 0).addScaledVector(ikAxis, -ikAxis.y)
      if (ikPole.lengthSq() < 1e-6) ikPole.set(1, 0, 0).addScaledVector(ikAxis, -ikAxis.x)
    }
    ikPole.normalize()
    // 肘/膝位置 = 肩/髋 + 轴×along + 极向量×bulge
    ikJoint.copy(ikShoulder).addScaledVector(ikAxis, along).addScaledVector(ikPole, bulge)
    aimAt(upperName, ikJoint, weight, lowerName)
    aimAt(lowerName, target, weight, childName)
  }

  // —— 各状态权重（平滑过渡） ——
  let blend = 0
  const layer = {run: 0, air: 0, crouch: 0, ride: 0, smoke: 0, smokeCarry: 0, smokeLight: 0, smokePuff: 0, down: 0}
  // 蹲下时要把人物整体压低，否则光是弯腿会让脚离地（像悬空半蹲）
  const traveller = rig.traveller ?? root
  const canDrop = traveller !== root
  let drop = 0
  /** 鞋底补偿：模型静息包围盒底若低于原点，就把人整体抬起来，别让鞋插进地面 */
  const footLift = (() => {
    try {
      root.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(root)
      if (!Number.isFinite(box.min.y)) return 0.02
      return Math.min(0.12, Math.max(0, -box.min.y) + 0.015)
    } catch {
      return 0.02
    }
  })()
  const ease = (cur: number, target: number, dt: number, rate = 9) =>
    cur + (target - cur) * Math.min(1, Math.max(0, dt) * rate)

  function pose(dt: number, state: FigurePose) {
    const d = Math.min(0.1, Math.max(0, dt))
    // 基础层：idle / walk 权重交叉。
    // 腾空时把走路剪辑几乎压掉——否则「走路摆腿」和「空中收腿」叠在一起，跳起来像在抽筋。
    const moving = state.moving && !state.riding
    // 倒地时压掉走路/跑步的底子，否则瘫倒的人还在迈腿
    const downNow = typeof state.down === 'number' ? state.down : state.down ? 1 : 0
    const locomotion = !moving || downNow > 0.4 ? 0 : state.grounded ? 1 : 0.12
    blend = ease(blend, locomotion, d)
    walk?.setEffectiveWeight(blend)
    idle?.setEffectiveWeight(1 - blend)
    if (walk) walk.timeScale = THREE.MathUtils.clamp(state.speed / CLIP_SPEED, 0.6, 2.8)
    mixer.update(d)

    // 叠加层：先取一次人物朝向，把角色空间的轴/方向转到世界空间
    // 注意：倒地时整个身体是绕 Traveller 转的，所以「角色空间」要用 Traveller 的朝向，
    // 否则手臂/腿的方向是相对站姿算的，躺下后会指向奇怪的方向
    traveller.getWorldQuaternion(qRoot)

    // 叠加层权重
    layer.ride = ease(layer.ride, state.riding ? 1 : 0, d, 6)
    // 蹲下：一旦蹲下去就保持住。远端玩家的 gr 是 10 Hz 上报的，偶尔会漏一拍，
    // 如果这里严格要求 grounded，对方会看到你「一蹲一站」地抖。
    const wantCrouch = !!state.crouch && !state.riding
    layer.crouch = ease(layer.crouch, wantCrouch && (state.grounded || layer.crouch > 0.5) ? 1 : 0, d, 8)
    layer.air = ease(layer.air, !state.grounded && !state.riding ? 1 : 0, d, 12)
    layer.run = ease(layer.run, !state.riding && state.grounded && state.moving && state.speed >= RUN_SPEED ? 1 : 0, d, 8)

    if (layer.ride > 0.001) poseRide(layer.ride, state.ride)
    if (layer.crouch > 0.001) poseCrouch(layer.crouch)
    if (layer.air > 0.001) poseAir(layer.air)
    if (layer.run > 0.001) poseRun(layer.run)
    // 抽烟放在最后：它要用手部 IK 精确把手放到烟盒/打火机/嘴边，压过其它层的摆臂
    layer.smoke = ease(layer.smoke, state.smoke?.hold ?? 0, d, 8)
    layer.smokeCarry = ease(layer.smokeCarry, state.smoke?.carry ?? 0, d, 6)
    layer.smokeLight = ease(layer.smokeLight, state.smoke?.light ?? 0, d, 14)
    layer.smokePuff = ease(layer.smokePuff, state.smoke?.puff ?? 0, d, 18)
    if (layer.smoke > 0.002 || layer.smokeCarry > 0.002) {
      poseSmoke(layer.smoke, layer.smokeCarry, layer.smokeLight, layer.smokePuff)
    }
    // 倒地：整体绕脚踝轴躺到地上 + 关节瘫下来（塌腰、屈膝、手臂散开）
    const downWant = typeof state.down === 'number' ? Math.max(0, Math.min(1, state.down)) : state.down ? 1 : 0
    layer.down = ease(layer.down, downWant, d, downWant > layer.down ? 6 : 3)
    if (layer.down > 0.01) poseCollapse(layer.down)
    // 出拳：右臂快速向前
    const punch = Math.max(0, Math.min(1, state.punch ?? 0))
    if (punch > 0.01 && layer.down < 0.5) {
      aim('upperarm_r', new THREE.Vector3(0.16, 0.02, -1), punch, 'lowerarm_r')
      aim('lowerarm_r', new THREE.Vector3(0.08, 0.02, -1), punch, 'hand_r')
      spin('spine_01', AXIS_X, -0.06 * punch, 1)
      spin('spine_02', AXIS_Y, 0.22 * punch, 1)
    }

    // 调试用：当前各叠加层权重 + 有没有拿到车上绑定点
    root.userData.layers = {...layer, riding: !!state.riding, anchors: !!state.ride, grips: !!state.ride?.gripL}

    // 蹲下的整体压低（只动视觉容器 Traveller，不影响碰撞胶囊）+ 鞋底补偿
    drop = ease(drop, layer.crouch * -0.34, d, 10)
    if (canDrop) {
      // 躺下时把身体抬一点，免得半个身子陷进地里
      traveller.position.y = drop + footLift + 0.03 * layer.down
      // 倒地不用转到 90°：转到 78° 时肩膀/头已经贴地，留一点角度看着更自然
      // 权重归零就硬置 0：缓动尾巴残留的角度会让角色「一直斜着站不起来」
      traveller.rotation.x = layer.down < 0.02 ? 0 : -Math.PI * 0.47 * layer.down
    }
  }

  /** 跑步：上身前倾、抬头、屈肘摆臂（腿部节奏交给剪辑 + 稍快的步频） */
  function poseRun(w: number) {
    spin('spine_01', AXIS_X, -0.12, w)
    spin('spine_02', AXIS_X, -0.1, w)
    spin('spine_03', AXIS_X, -0.06, w)
    spin('neck_01', AXIS_X, 0.1, w)
    spin('head', AXIS_X, 0.14, w)
    spin('lowerarm_l', AXIS_X, -0.85, w)
    spin('lowerarm_r', AXIS_X, -0.85, w)
    spin('upperarm_l', AXIS_X, 0.2, w)
    spin('upperarm_r', AXIS_X, 0.2, w)
  }

  /** 跳跃：前腿收起、后腿拖在身后、手臂往上带（素材没有 jump 剪辑，全靠叠加层） */
  function poseAir(w: number) {
    aim('thigh_l', new THREE.Vector3(-0.06, -0.6, -0.8), 0.95 * w, 'calf_l')
    aim('calf_l', new THREE.Vector3(0, -0.66, 0.75), 0.95 * w, 'foot_l')
    aim('thigh_r', new THREE.Vector3(0.06, -0.86, 0.5), 0.8 * w, 'calf_r')
    aim('calf_r', new THREE.Vector3(0, -0.95, 0.3), 0.7 * w, 'foot_r')
    spin('spine_01', AXIS_X, -0.12, w)
    spin('neck_01', AXIS_X, 0.12, w)
    spin('upperarm_l', AXIS_X, 0.8, w)
    spin('upperarm_r', AXIS_X, 0.8, w)
    spin('lowerarm_l', AXIS_X, -0.6, w)
    spin('lowerarm_r', AXIS_X, -0.6, w)
  }

  /** 蹲下：屈髋屈膝、上身前倾 */
  function poseCrouch(w: number) {
    aim('thigh_l', new THREE.Vector3(0, -0.6, -0.8), 0.95 * w, 'calf_l')
    aim('thigh_r', new THREE.Vector3(0, -0.6, -0.8), 0.95 * w, 'calf_r')
    aim('calf_l', new THREE.Vector3(0, -0.85, 0.62), 0.95 * w, 'foot_l')
    aim('calf_r', new THREE.Vector3(0, -0.85, 0.62), 0.95 * w, 'foot_r')
    spin('spine_01', AXIS_X, -0.22, w)
    spin('spine_02', AXIS_X, -0.16, w)
    spin('neck_01', AXIS_X, 0.2, w)
  }

  // 角色空间 +X 是「角色的右手边」（forward=-Z、up=+Y ⇒ right=+X），
  // 所以左右手脚要按绑定点在这个方向上的符号分配，不能按 gripL/gripR 的名字——
  // 车模型是 +Z 朝前，rideTargets 里的 gripL 其实落在角色右手边，按名字接就会双臂交叉。
  const _rightAxis = new THREE.Vector3()
  const _sideA = new THREE.Vector3()
  const _sideB = new THREE.Vector3()

  /** 世界点在角色左右方向上的符号（>0 = 角色右手边） */
  function lateralOf(point: THREE.Vector3, from?: THREE.Object3D) {
    _rightAxis.set(1, 0, 0).applyQuaternion(qRoot)
    if (from) from.getWorldPosition(_sideA)
    else _sideA.setFromMatrixPosition(root.matrixWorld)
    return _sideB.copy(point).sub(_sideA).dot(_rightAxis)
  }

  /** 把一副左右绑定点按角色左右分好（只有一个时给最近的那一侧） */
  function splitSides(a?: THREE.Vector3, b?: THREE.Vector3, from?: THREE.Object3D) {
    if (!a && !b) return {left: undefined, right: undefined}
    if (!a || !b) {
      const only = (a ?? b)!
      return lateralOf(only, from) <= 0 ? {left: only, right: undefined} : {left: undefined, right: only}
    }
    return lateralOf(a, from) <= 0 ? {left: a, right: b} : {left: b, right: a}
  }

  // 极向量（角色空间）：肘往下外侧弯，膝往前上方弯
  const POLE_ELBOW_L = new THREE.Vector3(-0.85, -1, 0.15)
  const POLE_ELBOW_R = new THREE.Vector3(0.85, -1, 0.15)
  const POLE_KNEE_L = new THREE.Vector3(-0.25, 0.6, -0.85)
  const POLE_KNEE_R = new THREE.Vector3(0.25, 0.6, -0.85)

  /** 骑车/坐船：坐在车座上、脚踩踏板、双手扶把（手脚用两段 IK 真正绑到车上） */
  function poseRide(w: number, anchors?: RideAnchors) {
    const chest = bones.get('spine_02') ?? bones.get('spine_01')
    const pelvis = bones.get('pelvis')
    const hands = splitSides(anchors?.gripL, anchors?.gripR, chest)
    const feet = splitSides(anchors?.deckL, anchors?.deckR, pelvis)
    // 先倾上身：肩和髋的位置定下来，后面 IK 才不会差一截
    spin('spine_01', AXIS_X, -0.16, w)
    spin('spine_02', AXIS_X, -0.1, w)
    spin('neck_01', AXIS_X, 0.16, w)
    // 腿：脚精确踩到踏板
    if (feet.left) reachTwoBone('thigh_l', 'calf_l', 'foot_l', feet.left, POLE_KNEE_L, w)
    else {
      aim('thigh_l', new THREE.Vector3(-0.1, -0.55, -0.83), 0.95 * w, 'calf_l')
      aim('calf_l', new THREE.Vector3(-0.08, -1, 0.12), 0.95 * w, 'foot_l')
    }
    if (feet.right) reachTwoBone('thigh_r', 'calf_r', 'foot_r', feet.right, POLE_KNEE_R, w)
    else {
      aim('thigh_r', new THREE.Vector3(0.1, -0.55, -0.83), 0.95 * w, 'calf_r')
      aim('calf_r', new THREE.Vector3(0.08, -1, 0.12), 0.95 * w, 'foot_r')
    }
    // 手：手精确贴到握把（之前只对齐方向，手掌离车把还有 30 cm）
    if (hands.left) reachTwoBone('upperarm_l', 'lowerarm_l', 'hand_l', hands.left, POLE_ELBOW_L, w)
    else {
      aim('upperarm_l', new THREE.Vector3(-0.28, -0.5, -0.82), 0.85 * w, 'lowerarm_l')
      aim('lowerarm_l', new THREE.Vector3(-0.16, -0.3, -0.94), 0.9 * w, 'hand_l')
    }
    if (hands.right) reachTwoBone('upperarm_r', 'lowerarm_r', 'hand_r', hands.right, POLE_ELBOW_R, w)
    else {
      aim('upperarm_r', new THREE.Vector3(0.28, -0.5, -0.82), 0.85 * w, 'lowerarm_r')
      aim('lowerarm_r', new THREE.Vector3(0.16, -0.3, -0.94), 0.9 * w, 'hand_r')
    }
  }

  // —— 抽烟：左手托烟盒、右手举打火机 / 夹烟 / 送到嘴边 ——
  // 目标点写在角色空间里，靠 Traveller 的世界矩阵换算，蹲下时手臂也跟着一起下沉。
  const smokeFramePos = new THREE.Vector3()
  const smokeFrameQuat = new THREE.Quaternion()
  const smokeA = new THREE.Vector3()
  const smokeHold = new THREE.Vector3()
  const smokeLightPoint = new THREE.Vector3()
  const smokeMouthPoint = new THREE.Vector3()
  const smokeOffset = new THREE.Vector3()
  const mouthOffset = SMOKE_ANCHORS.mouthFromHead.clone()
  const fallbackMouth = new THREE.Vector3(0, 1.55, -0.09)

  /** 角色空间的点 → 世界坐标 */
  function smokeToWorld(point: THREE.Vector3, out: THREE.Vector3) {
    traveller.getWorldPosition(smokeFramePos)
    traveller.getWorldQuaternion(smokeFrameQuat)
    return out.copy(point).applyQuaternion(smokeFrameQuat).add(smokeFramePos)
  }

  /** 嘴的世界坐标：头骨原点 + 一小段角色空间偏移 */
  function mouthWorld(out: THREE.Vector3) {
    const target = head ?? bones.get('head')
    if (!target) return smokeToWorld(fallbackMouth, out)
    traveller.getWorldQuaternion(smokeFrameQuat)
    target.getWorldPosition(out)
    out.add(smokeOffset.copy(mouthOffset).applyQuaternion(smokeFrameQuat))
    return out
  }

  /**
   * 抽烟的姿势：两条手臂各走各的权重。
   * @param hold  右臂（夹烟/举打火机）
   * @param carry 左臂（举烟盒，点着之后就收回去）
   */
  function poseSmoke(hold: number, carry: number, light: number, puff: number) {
    const w = Math.min(1, Math.max(0, hold))
    const trunk = Math.max(w, Math.min(1, Math.max(0, carry)))
    // 上身前倾一点、低头看烟
    spin('spine_01', AXIS_X, -0.05, trunk)
    spin('spine_02', AXIS_X, -0.04, trunk)
    spin('neck_01', AXIS_X, 0.14, w)
    spin('head', AXIS_X, 0.1, w)
    // 左手：托着烟盒（点着之后权重归零，手臂回到走路摆动）
    if (carry > 0.002) {
      smokeToWorld(SMOKE_ANCHORS.packL, smokeA)
      reachTwoBone('upperarm_l', 'lowerarm_l', 'hand_l', smokeA, POLE_ELBOW_L, Math.min(1, carry) * 0.95)
    }
    if (w <= 0.002) return
    // 右手：夹烟 → 举打火机 → 送到嘴边，三个目标点按权重插值
    smokeToWorld(SMOKE_ANCHORS.smokeR, smokeHold)
    smokeToWorld(SMOKE_ANCHORS.lighterR, smokeLightPoint)
    mouthWorld(smokeMouthPoint)
    // 手指夹着烟，不是把拳头怼到嘴上：再往前下方挪一点
    traveller.getWorldQuaternion(smokeFrameQuat)
    smokeMouthPoint.add(smokeOffset.set(0, -0.03, -0.045).applyQuaternion(smokeFrameQuat))
    smokeHold.lerp(smokeLightPoint, Math.min(1, Math.max(0, light))).lerp(smokeMouthPoint, Math.min(1, Math.max(0, puff)))
    reachTwoBone('upperarm_r', 'lowerarm_r', 'hand_r', smokeHold, POLE_ELBOW_R, w * 0.95)
    // 拇指收起来捏住烟：模型里只有拇指有蒙皮权重（index 系列是 0 顶点），
    // 所以「夹」这个动作目前只能靠拇指完成，食指补权重后这里再补一份即可。
    const pinch = Math.min(1, Math.max(0, puff * 0.6 + light * 0.5 + w * 0.35))
    spin('thumb_01_r', AXIS_X, -0.55 * pinch, pinch)
    spin('thumb_02_r', AXIS_X, -0.4 * pinch, pinch)
    spin('thumb_03_r', AXIS_X, -0.25 * pinch, pinch)
    spin('index_01_r', AXIS_X, -0.5 * pinch, pinch)
    spin('index_02_r', AXIS_X, -0.45 * pinch, pinch)
  }

  /**
   * 瘫倒：光把身体转 90° 只是「硬翻一块板」。这里把关节也塌下去——
   * 塌腰、屈膝（小腿朝上翻）、双臂散在身侧、头歪着，读起来才是倒地。
   * 方向都是「身体空间」：躯干已经被 Traveller 转成横的，+Y 相当于朝前。
   */
  function poseCollapse(w: number) {
    const k = Math.min(1, Math.max(0, w))
    // 躯干：骨盆后倾 + 脊柱一节节塌
    spin('pelvis', AXIS_X, 0.2 * k, k)
    spin('spine_01', AXIS_X, -0.26 * k, k)
    spin('spine_02', AXIS_X, -0.2 * k, k)
    spin('spine_03', AXIS_X, 0.1 * k, k)
    spin('neck_01', AXIS_X, 0.32 * k, k)
    spin('head', AXIS_Y, 0.22 * k, k)
    // 腿：左腿屈得厉害（小腿朝上翻），右腿半伸，膝盖略微外开
    // 腿大体顺着身体摊开（身体已经横过来了，所以 -Y 就是「往远处平铺」），
    // 膝盖只留一点弯，脚才能落在地面上而不是插进地里或翘到空中
    aim('thigh_l', new THREE.Vector3(-0.34, -0.92, -0.2), 0.95 * k, 'calf_l')
    // 左腿膝盖弓起来（脚抬离地面），右腿摊平 —— 这样躺着才不像立正
    aim('calf_l', new THREE.Vector3(-0.24, -0.84, 0.47), 0.9 * k, 'foot_l')
    aim('thigh_r', new THREE.Vector3(0.38, -0.9, -0.2), 0.9 * k, 'calf_r')
    aim('calf_r', new THREE.Vector3(0.18, -0.95, 0.24), 0.85 * k, 'foot_r')
    // 手臂：垂在身侧，前臂往里收一点（不是立正时那种贴身）
    aim('upperarm_l', new THREE.Vector3(-0.78, -0.5, -0.36), 0.92 * k, 'lowerarm_l')
    aim('lowerarm_l', new THREE.Vector3(-0.42, -0.3, -0.72), 0.95 * k, 'hand_l')
    aim('upperarm_r', new THREE.Vector3(0.74, -0.56, -0.36), 0.92 * k, 'lowerarm_r')
    aim('lowerarm_r', new THREE.Vector3(0.38, -0.32, -0.7), 0.95 * k, 'hand_r')
  }

  function setHeadHidden(on: boolean) {
    // 只有一个 SkinnedMesh，没法按部件隐藏。做法是把 head 和 neck_01 一起缩到几乎为 0：
    // 只缩 head 会在第一人称里留下一截「脖子」杵在画面下方（用户反馈过）。
    if (head && headScale) head.scale.copy(on ? hidden : headScale)
    if (neck && neckScale) neck.scale.copy(on ? hidden : neckScale)
  }

  /** 某根骨骼在当前姿势下的人物根节点局部坐标 */
  function jointLocal(name: string, out: THREE.Vector3) {
    const bone = bones.get(name) ?? (name === 'head' ? head : undefined)
    if (!bone) return null
    bone.getWorldPosition(out)
    root.worldToLocal(out)
    return out
  }

  /**
   * 某根骨骼在当前姿势下、相对人物根节点的旋转（夹烟要用它把烟对齐手指）。
   * 没有它就只能在固定方向摆烟，手一抬烟就横着穿出手背。
   */
  function jointQuat(name: string, out: THREE.Quaternion) {
    const bone = bones.get(name) ?? (name === 'head' ? head : undefined)
    if (!bone) return null
    bone.getWorldQuaternion(out)
    root.getWorldQuaternion(rootQuatScratch)
    out.premultiply(rootQuatScratch.invert())
    return out
  }

  /** 嘴在人物根节点局部坐标里的位置 */
  function mouthLocal(out: THREE.Vector3) {
    mouthWorld(out)
    root.worldToLocal(out)
    return out
  }

  function headPosition(out: THREE.Vector3) {
    if (!head) return out.copy(root.position)
    if (neck && neckScale) {
      // 用脖子的世界位置/旋转 + 静息缩放还原「没隐藏时头骨在哪」
      neck.getWorldPosition(neckPos)
      neck.getWorldQuaternion(neckQuat)
      neckMatrix.compose(neckPos, neckQuat, neckScale)
      out.copy(headInNeck).applyMatrix4(neckMatrix)
    } else {
      head.getWorldPosition(out)
    }
    const scale = root.getWorldScale(scratch).y || 1
    out.y += EYE_ABOVE_HEAD * scale
    return out
  }

  function dispose() {
    mixer.stopAllAction()
    mixer.uncacheRoot(root)
    outfits.dispose()
    disposeCharacterParts(root)
    root.removeFromParent()
  }

  return {
    root,
    rig,
    avatar,
    pose,
    setHeadHidden,
    // 骑行视角：相机本来就在头前方，藏掉头部就够（车身不遮挡）
    setRiderView: setHeadHidden,
    headPosition,
    jointLocal,
    jointQuat,
    mouthLocal,
    dispose,
  }
}

/** 调试/测试：读出两段骨骼的长度（IK 能不能够到目标一眼就看出来） */
export function figureBoneLengths(figure: Figure) {
  const rig = figure.rig
  const bones = rig.skinnedMesh?.skeleton?.bones ?? []
  const at = (name: string) => bones.find(bone => bone.name === name)
  const out: Record<string, number> = {}
  for (const [a, b] of [
    ['upperarm_l', 'lowerarm_l'], ['lowerarm_l', 'hand_l'],
    ['upperarm_r', 'lowerarm_r'], ['lowerarm_r', 'hand_r'],
    ['thigh_l', 'calf_l'], ['calf_l', 'foot_l'],
    ['thigh_r', 'calf_r'], ['calf_r', 'foot_r'],
  ] as const) {
    const one = at(a)
    const two = at(b)
    if (!one || !two) continue
    out[a] = +one.position.distanceTo(two.position).toFixed(3)
  }
  return out
}
