import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js'
import {buildClips} from './clips'

// 角色模型：Quaternius 模块化人物（CC0，public/avatar/packs/）。
// 每份 GLB 里有四块可拆的蒙皮网格 —— <套装>_Head / _Body / _Legs / _Feet，
// 正好对应「角色 / 上衣 / 裤子 / 鞋子」，四块共用同一套骨骼命名，可以跨套装拼装。
//
// 动作是程序化的：所有转动都换算到“角色自身坐标系”再写进骨骼局部位姿，
// 与骨骼原始局部轴无关，所以角色朝任何方向都不会拧；位移量按骨架缩放换算，避免放大 100 倍。

export type PieceKind = 'Head' | 'Body' | 'Legs' | 'Feet'
export interface PieceRef {
  /** public/avatar/packs/ 下的文件名（不含 .glb） */
  pack: string
  kind: PieceKind
}

export interface RideTargets {
  /** 坐垫（屁股位置，世界坐标） */
  seat: THREE.Vector3
  gripL: THREE.Vector3
  gripR: THREE.Vector3
  deckL: THREE.Vector3
  deckR: THREE.Vector3
  /** 车头朝向（世界坐标，水平方向单位向量） */
  forward: THREE.Vector3
}

export interface PoseState {
  moving: boolean
  speed: number
  grounded: boolean
  riding?: boolean
  /** 蹲下（走路时按住 Ctrl） */
  crouch?: boolean
  /** 骑车时的坐垫 / 车把 / 踏板目标 */
  ride?: RideTargets
}

const loader = new GLTFLoader()
const cache = new Map<string, Promise<THREE.Group>>()

export function loadPack(pack: string) {
  let pending = cache.get(pack)
  if (!pending) {
    pending = loader.loadAsync(`./avatar/packs/${pack}.glb`).then(gltf => gltf.scene)
    cache.set(pack, pending)
  }
  return pending
}

export interface Character {
  root: THREE.Group
  pose(dt: number, state: PoseState): void
  readonly height: number
  dispose(): void
  /** 骑行者视角：只留腿和脚（头/上身隐藏，避免挡镜头） */
  setRiderView(on: boolean): void
  /** 走路第一人称：只隐藏头部 */
  setHeadHidden(on: boolean): void
  /** 头骨的世界坐标（第一人称相机用） */
  headPosition(out: THREE.Vector3): THREE.Vector3
}

const PIECE_RE = /_(Head|Body|Legs|Feet)(_\d+)?$/

export const FACES = [
  {id: 'men_casual', gender: 'male' as const, name: '桂生', pack: 'modular_men_Casual'},
  {id: 'men_worker', gender: 'male' as const, name: '漓客', pack: 'modular_men_Worker'},
  {id: 'men_adventurer', gender: 'male' as const, name: '阿岩', pack: 'modular_men_Adventurer'},
  {id: 'women_casual', gender: 'female' as const, name: '湘灵', pack: 'modular_women_Casual'},
  {id: 'women_worker', gender: 'female' as const, name: '阿桂', pack: 'modular_women_Worker'},
  {id: 'women_adventurer', gender: 'female' as const, name: '月牙', pack: 'modular_women_Adventurer'},
]

export const TOPS = [
  {id: 'men_casual', name: '短袖 T 恤', pack: 'modular_men_Casual'},
  {id: 'men_worker', name: '工装背心', pack: 'modular_men_Worker'},
  {id: 'men_adventurer', name: '探险外套', pack: 'modular_men_Adventurer'},
  {id: 'men_farmer', name: '田园衬衫', pack: 'modular_men_Farmer'},
  {id: 'women_casual', name: '针织上衣', pack: 'modular_women_Casual'},
  {id: 'women_worker', name: '工装短袖', pack: 'modular_women_Worker'},
  {id: 'women_adventurer', name: '探险外套', pack: 'modular_women_Adventurer'},
  {id: 'women_formal', name: '衬衫外套', pack: 'modular_women_Formal'},
]

export const PANTS = [
  {id: 'men_casual', name: '休闲长裤', pack: 'modular_men_Casual'},
  {id: 'men_worker', name: '工装长裤', pack: 'modular_men_Worker'},
  {id: 'men_adventurer', name: '越野裤', pack: 'modular_men_Adventurer'},
  {id: 'men_farmer', name: '布裤', pack: 'modular_men_Farmer'},
  {id: 'women_casual', name: '修身长裤', pack: 'modular_women_Casual'},
  {id: 'women_worker', name: '工装长裤', pack: 'modular_women_Worker'},
  {id: 'women_adventurer', name: '越野裤', pack: 'modular_women_Adventurer'},
  {id: 'women_formal', name: '西裤', pack: 'modular_women_Formal'},
]

export const SHOES = [
  {id: 'men_casual', name: '运动鞋', pack: 'modular_men_Casual'},
  {id: 'men_worker', name: '工作靴', pack: 'modular_men_Worker'},
  {id: 'men_adventurer', name: '登山靴', pack: 'modular_men_Adventurer'},
  {id: 'men_farmer', name: '布鞋', pack: 'modular_men_Farmer'},
  {id: 'women_casual', name: '小白鞋', pack: 'modular_women_Casual'},
  {id: 'women_worker', name: '短靴', pack: 'modular_women_Worker'},
  {id: 'women_adventurer', name: '登山靴', pack: 'modular_women_Adventurer'},
  {id: 'women_formal', name: '皮鞋', pack: 'modular_women_Formal'},
]

export async function createCharacter(pieces: PieceRef[], height = 1.7): Promise<Character> {
  const templates = await Promise.all(pieces.map(piece => loadPack(piece.pack)))
  const scenes = templates.map(template => cloneSkinned(template) as THREE.Group)
  const root = new THREE.Group()
  root.name = 'character'
  // 模型原始朝 +Z，转向 -Z 放在内层；外层 root.rotation.y 留给游戏控制朝向。
  const inner = new THREE.Group()
  inner.name = 'character-inner'
  inner.rotation.y = Math.PI
  root.add(inner)

  scenes.forEach((scene, index) => {
    const kind = pieces[index].kind
    scene.traverse(object => {
      const mesh = object as THREE.SkinnedMesh
      if (!mesh.isSkinnedMesh) return
      const match = mesh.name.match(PIECE_RE)
      mesh.visible = !!match && match[1] === kind
      mesh.userData.pieceKind = match?.[1]
      mesh.userData.pieceOwn = match?.[1] === kind
      mesh.frustumCulled = false
      mesh.castShadow = false
      mesh.receiveShadow = false
    })
    inner.add(scene)
  })

  // 赛璐璐（卡通）着色：4 阶色阶 toon 材质
  const gradient = new THREE.DataTexture(new Uint8Array([92, 168, 232, 255]), 4, 1, THREE.RedFormat)
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter
  gradient.generateMipmaps = false
  gradient.needsUpdate = true
  root.traverse(object => {
    const mesh = object as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    const source = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
    const toon = new THREE.MeshToonMaterial({
      color: source?.color ? source.color.clone() : new THREE.Color(0xffffff),
      gradientMap: gradient,
    })
    if (source?.map) {
      toon.map = source.map
      toon.map.colorSpace = THREE.SRGBColorSpace
    }
    mesh.material = toon
  })
  /* ---------------------------------------------------- 躯干 / 手臂 拆分 */
  const ARM_BONE = /(Shoulder|UpperArm|LowerArm|Hand|Index|Middle|Ring|Pinky|Thumb)/
  /** 按蒙皮权重把一块 _Body 拆成「躯干」和「手臂」两块，共用同一副骨架 */
  function splitArms(mesh: THREE.SkinnedMesh) {
    const geometry = mesh.geometry as THREE.BufferGeometry
    const skinIndex = geometry.getAttribute('skinIndex')
    const skinWeight = geometry.getAttribute('skinWeight')
    if (!skinIndex || !skinWeight) return null
    const bones = mesh.skeleton.bones
    const armBone = bones.map(bone => ARM_BONE.test(bone.name.replace(/\./g, '')))
    const isArm = (vertex: number) => {
      let arm = 0, all = 0
      for (let k = 0; k < 4; k++) {
        const weight = skinWeight.getComponent(vertex, k)
        if (weight <= 0.01) continue
        all += weight
        if (armBone[skinIndex.getComponent(vertex, k)]) arm += weight
      }
      return all > 0 && arm / all > 0.5
    }
    const index = geometry.index
    const triangleCount = index ? index.count / 3 : geometry.getAttribute('position').count / 3
    const torso: number[] = [], arms: number[] = []
    for (let tri = 0; tri < triangleCount; tri++) {
      const a = index ? index.getX(tri * 3) : tri * 3
      const b = index ? index.getX(tri * 3 + 1) : tri * 3 + 1
      const c = index ? index.getX(tri * 3 + 2) : tri * 3 + 2
      const votes = (isArm(a) ? 1 : 0) + (isArm(b) ? 1 : 0) + (isArm(c) ? 1 : 0)
      if (votes >= 2) arms.push(a, b, c)
      else torso.push(a, b, c)
    }
    if (!arms.length || !torso.length) return null
    const make = (indices: number[]) => {
      const part = new THREE.BufferGeometry()
      // 属性直接共享，只有索引不同 —— 不额外吃内存
      for (const name of Object.keys(geometry.attributes)) part.setAttribute(name, geometry.getAttribute(name))
      part.setIndex(indices)
      part.boundingSphere = geometry.boundingSphere?.clone() ?? null
      return part
    }
    const parts: {geometry: THREE.BufferGeometry; kind: string}[] = [
      {geometry: make(torso), kind: 'Torso'},
      {geometry: make(arms), kind: 'Body'},
    ]
    const created: THREE.SkinnedMesh[] = []
    for (const part of parts) {
      const piece = new THREE.SkinnedMesh(part.geometry, mesh.material)
      piece.name = `${mesh.name}_${part.kind}`
      piece.position.copy(mesh.position)
      piece.quaternion.copy(mesh.quaternion)
      piece.scale.copy(mesh.scale)
      piece.bindMode = mesh.bindMode
      piece.frustumCulled = false
      piece.castShadow = false
      piece.receiveShadow = false
      piece.userData.pieceKind = part.kind
      piece.userData.pieceOwn = true
      mesh.parent?.add(piece)
      piece.bind(mesh.skeleton, mesh.bindMatrix)
      created.push(piece)
    }
    mesh.visible = false
    return created
  }
  // —— 赛璐璐描边：把可见网格复制一层，黑壳稍微放大一点、只画背面，
  // 露出来的一圈就是轮廓线（法线外扩在这批蒙皮网格上会把顶点打飞，所以用整体缩放）。
  const outlineMaterial = new THREE.MeshBasicMaterial({color: 0x14110f, side: THREE.BackSide})
  for (const scene of scenes) {
    const shell = cloneSkinned(scene) as THREE.Group
    let visible = false
    shell.traverse(object => {
      const mesh = object as THREE.SkinnedMesh
      if (!mesh.isSkinnedMesh || !mesh.visible) return
      visible = true
      mesh.userData.pieceKind = (mesh.name.match(PIECE_RE)?.[1] ?? undefined)
      mesh.userData.pieceOwn = false
      mesh.userData.isShell = true
      mesh.material = outlineMaterial
      mesh.frustumCulled = false
    })
    if (!visible) continue
    shell.scale.setScalar(1.018)
    shell.position.y = -0.012
    inner.add(shell)
  }
  // 骑行第一人称要把躯干藏掉、只留手臂：先按权重把 _Body 拆成两块
  {
    const bodies: THREE.SkinnedMesh[] = []
    root.traverse(object => {
      const mesh = object as THREE.SkinnedMesh
      if (mesh.isSkinnedMesh && mesh.visible && mesh.userData.pieceKind === 'Body') bodies.push(mesh)
    })
    for (const body of bodies) splitArms(body)
  }

  // 骨骼表（四份套装同骨架，按名字聚合）
  const byName = new Map<string, {bone: THREE.Bone; rest: THREE.Quaternion; restPos: THREE.Vector3}[]>()
  root.traverse(object => {
    const bone = object as THREE.Bone
    if (!bone.isBone) return
    const key = bone.name.replace(/\./g, '')
    const list = byName.get(key) ?? []
    list.push({bone, rest: bone.quaternion.clone(), restPos: bone.position.clone()})
    byName.set(key, list)
  })

  // —— 手写关键帧片段：走路/跑步/骑行都用 AnimationClip 播，不再每帧算 IK
  const restQ = new Map<string, THREE.Quaternion>()
  for (const [name, list] of byName) restQ.set(name, list[0].rest.clone())
  const clips = buildClips(restQ)
  const mixers = scenes.map(scene => new THREE.AnimationMixer(scene))
  const actions = mixers.map(mixer => ({
    walk: mixer.clipAction(clips.walk),
    run: mixer.clipAction(clips.run),
    ride: mixer.clipAction(clips.ride),
  }))
  for (const set of actions) for (const action of Object.values(set)) {
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.enabled = true
    action.setEffectiveWeight(0)
    action.play()
  }
  const weights = {walk: 0, run: 0, ride: 0}
  // 统一身高：骨骼跨度估身高（骨架根带 100 倍缩放，几何包围盒不可用）
  root.updateMatrixWorld(true)
  const probe = new THREE.Vector3()
  let minY = Infinity, maxY = -Infinity
  for (const list of byName.values()) {
    for (const {bone} of list) {
      bone.getWorldPosition(probe)
      if (probe.y < minY) minY = probe.y
      if (probe.y > maxY) maxY = probe.y
    }
  }
  const span = Math.max(0.001, maxY - minY)
  const scale = height / (span * 1.15)
  root.scale.setScalar(scale)
  root.position.y = -minY * scale - height * 0.03
  root.updateMatrixWorld(true)

  // 骨骼位移量要换回骨骼局部单位（骨架根是 100 倍缩放），否则髋部会瞬移好几米。
  let armatureScale = 1
  root.traverse(object => {
    if (object.name === 'CharacterArmature' && object.scale.x) armatureScale = object.scale.x
  })
  const posUnit = 1 / armatureScale

  const lookup = (name: string) => byName.get(name.replace(/\./g, ''))
  const rootQ = new THREE.Quaternion()
  const rootInvQ = new THREE.Quaternion()
  const charQ = new THREE.Quaternion()
  const turnQ = new THREE.Quaternion()
  const parentQ = new THREE.Quaternion()
  const invParentQ = new THREE.Quaternion()
  const deg = THREE.MathUtils.degToRad

  /** 在“角色自身坐标系”里转某根骨头（换算到世界，再写进局部姿态）。 */
  const turn = (name: string, x = 0, y = 0, z = 0) => {
    const list = lookup(name)
    if (!list?.length || (!x && !y && !z)) return
    root.getWorldQuaternion(rootQ)
    rootInvQ.copy(rootQ).invert()
    charQ.setFromEuler(new THREE.Euler(x, y, z))
    turnQ.copy(rootQ).multiply(charQ).multiply(rootInvQ)
    for (const {bone} of list) {
      const parent = bone.parent
      if (!parent) continue
      parent.updateWorldMatrix(true, false)
      parent.getWorldQuaternion(parentQ)
      invParentQ.copy(parentQ).invert()
      bone.quaternion.premultiply(invParentQ.multiply(turnQ).multiply(parentQ))
    }
  }

  const worldAxis = new THREE.Vector3()
  const tmpA = new THREE.Vector3()
  const tmpB = new THREE.Vector3()
  const tmpC = new THREE.Vector3()
  const handPos = new THREE.Vector3()
  const bodyPos = new THREE.Vector3()

  /** 绕世界空间任意轴转某根骨头（用于手腕/手指的精确朝向）。 */
  const pivot = (name: string, axis: THREE.Vector3, angle: number) => {
    const list = lookup(name)
    if (!list?.length || !angle) return
    const q = new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), angle)
    for (const {bone} of list) {
      const parent = bone.parent
      if (!parent) continue
      parent.updateWorldMatrix(true, false)
      parent.getWorldQuaternion(parentQ)
      invParentQ.copy(parentQ).invert()
      bone.quaternion.premultiply(invParentQ.multiply(q).multiply(parentQ))
    }
  }

  /**
   * 手腕内扣：让掌心朝向同侧大腿（而不是朝前或朝外）。
   * 做法是先量出手掌当前的法线，再绕“手指方向”转过差值——比写死角度稳。
   */
  const alignPalms = () => {
    root.updateMatrixWorld(true)
    root.getWorldPosition(bodyPos)
    for (const side of ['L', 'R'] as const) {
      const hand = lookup(`Hand.${side}`)?.[0]?.bone
      const index = lookup(`Index1.${side}`)?.[0]?.bone
      const pinky = lookup(`Pinky1.${side}`)?.[0]?.bone ?? lookup(`Ring1.${side}`)?.[0]?.bone
      if (!hand || !index || !pinky) continue
      hand.getWorldPosition(handPos)
      index.getWorldPosition(tmpA)
      pinky.getWorldPosition(tmpB)
      const finger = tmpA.clone().sub(handPos).normalize()
      const normal = new THREE.Vector3().crossVectors(tmpA.clone().sub(handPos), tmpB.clone().sub(handPos)).normalize()
      // 目标：掌心朝身体中线（水平方向上从手部指向身体的方向）
      const inward = new THREE.Vector3(bodyPos.x - handPos.x, 0, bodyPos.z - handPos.z)
      if (inward.lengthSq() < 1e-6) inward.set(side === 'L' ? 1 : -1, 0, 0)
      inward.normalize()
      // 在垂直于手指的平面里求旋转角
      const n = normal.clone().addScaledVector(finger, -normal.dot(finger))
      const t = inward.clone().addScaledVector(finger, -inward.dot(finger))
      if (n.lengthSq() < 1e-6 || t.lengthSq() < 1e-6) continue
      n.normalize()
      t.normalize()
      const angle = Math.atan2(tmpC.crossVectors(n, t).dot(finger), n.dot(t))
      pivot(`Hand.${side}`, finger, angle)
    }
    root.updateMatrixWorld(true)
  }

  /** 手指自然半握：每节指骨往掌心方向屈一点。 */
  const curlFingers = (amount = 0.22) => {
    for (const side of ['L', 'R'] as const) {
      const hand = lookup(`Hand.${side}`)?.[0]?.bone
      const index = lookup(`Index1.${side}`)?.[0]?.bone
      const pinky = lookup(`Pinky1.${side}`)?.[0]?.bone ?? lookup(`Ring1.${side}`)?.[0]?.bone
      if (!hand || !index || !pinky) continue
      hand.getWorldPosition(handPos)
      index.getWorldPosition(tmpA)
      pinky.getWorldPosition(tmpB)
      const finger = tmpA.clone().sub(handPos).normalize()
      const normal = new THREE.Vector3().crossVectors(tmpA.clone().sub(handPos), tmpB.clone().sub(handPos)).normalize()
      const axis = new THREE.Vector3().crossVectors(finger, normal).normalize()
      for (const prefix of ['Index', 'Middle', 'Ring', 'Pinky']) {
        for (let joint = 1; joint <= 4; joint++) {
          const bone = lookup(`${prefix}${joint}.${side}`)?.[0]?.bone
          if (bone) pivot(bone.name, axis, amount)
        }
      }
      const thumb2 = lookup(`Thumb2.${side}`)?.[0]?.bone
      const thumb3 = lookup(`Thumb3.${side}`)?.[0]?.bone
      if (thumb2) pivot(thumb2.name, axis, amount * 0.6)
      if (thumb3) pivot(thumb3.name, axis, amount * 0.6)
    }
  }
  /* ---------------------------------------------------------------- 两骨 IK */
  const charA = new THREE.Vector3()
  const charB = new THREE.Vector3()
  const charC = new THREE.Vector3()
  const charT = new THREE.Vector3()
  const axisTmp = new THREE.Vector3()
  const toChar = (bone: THREE.Bone, out: THREE.Vector3) => {
    bone.getWorldPosition(out)
    return root.worldToLocal(out)
  }
  const charAxisToWorld = (axis: THREE.Vector3) => axis.applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()))

  /**
   * 把 upper→lower→(末端子骨) 这条两段链摆到 target（角色空间）。
   * bend 指定屈曲方向（角色空间的单位向量，比如腿的“膝盖朝前”）。
   */
  const ik2 = (upperName: string, lowerName: string, target: THREE.Vector3, bend: THREE.Vector3) => {
    const upper = lookup(upperName)?.[0]?.bone
    const lower = lookup(lowerName)?.[0]?.bone
    if (!upper || !lower) return
    const end = lower.children.find((child: THREE.Object3D) => (child as THREE.Bone).isBone) as THREE.Bone | undefined
    if (!end) return
    root.updateMatrixWorld(true)
    const p0 = toChar(upper, new THREE.Vector3())
    const p1 = toChar(lower, new THREE.Vector3())
    const p2 = toChar(end, new THREE.Vector3())
    const l1 = p0.distanceTo(p1)
    const l2 = p1.distanceTo(p2)
    charT.copy(target)
    const reach = charT.clone().sub(p0)
    let d = reach.length()
    d = THREE.MathUtils.clamp(d, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01)
    const dirTarget = reach.normalize()
    // 1) 整条链先指向目标
    const dirNow = p2.clone().sub(p0).normalize()
    axisTmp.crossVectors(dirNow, dirTarget)
    if (axisTmp.lengthSq() > 1e-8) {
      const angle = Math.acos(THREE.MathUtils.clamp(dirNow.dot(dirTarget), -1, 1))
      pivot(upperName, charAxisToWorld(axisTmp.normalize()), angle)
    }
    // 2) 余弦定理屈中间关节
    root.updateMatrixWorld(true)
    const gamma = Math.acos(THREE.MathUtils.clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1))
    const beta = Math.acos(THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1))
    const bendAxis = new THREE.Vector3().crossVectors(dirTarget, bend).normalize()
    if (bendAxis.lengthSq() > 1e-6) {
      const worldAxis = charAxisToWorld(bendAxis)
      pivot(upperName, worldAxis, -beta)
      pivot(lowerName, worldAxis, Math.PI - gamma)
    }
  }
  const hipsBones = lookup('Hips') ?? []
  const hipsRest = hipsBones[0]?.restPos.clone()

  let phase = 0
  let clock = 0

  const pose = (dt: number, state: PoseState) => {
    clock += dt
    // —— 片段驱动：目标权重 → 阻尼过渡 → mixer.update
    const target = state.riding
      ? {walk: 0, run: 0, ride: 1}
      : !state.moving
        ? {walk: 0, run: 0, ride: 0}
        : state.speed > 6.2
          ? {walk: 0, run: 1, ride: 0}
          : {walk: 1, run: 0, ride: 0}
    const blend = Math.min(1, dt * 10)
    for (const key of ['walk', 'run', 'ride'] as const) weights[key] += (target[key] - weights[key]) * blend
    for (const set of actions) for (const key of ['walk', 'run', 'ride'] as const) set[key].setEffectiveWeight(weights[key])
    const speedScale = state.riding ? 1 : Math.max(0.4, Math.min(2.2, state.speed / 1.6))
    for (const set of actions) {
      set.walk.timeScale = speedScale
      set.run.timeScale = Math.max(0.6, Math.min(2, state.speed / 4))
      set.ride.timeScale = 1
    }
    for (const mixer of mixers) mixer.update(dt)
    if (state.riding) {
      // 骑行姿势完全由 ride 片段决定；这里只把人物根部对到坐垫上
      if (state.ride) {
        const seat = state.ride.seat
        root.position.set(seat.x, seat.y - 0.91, seat.z)
      }
      return
    }
    for (const list of byName.values()) {
      for (const entry of list) {
        entry.bone.quaternion.copy(entry.rest)
        entry.bone.position.copy(entry.restPos)
      }
    }
    if (hipsRest) for (const {bone} of hipsBones) bone.position.copy(hipsRest)
    root.updateMatrixWorld(true)

    // 双臂从 T-pose 垂到体侧：绕角色前后轴（Z）转，左臂向 -X 收、右臂向 +X 收
    const armDown = deg(76)
    // 手腕绕竖直轴内旋：掌心转向大腿（否则掌心朝前、手指外翻，像在比划）
    const wristIn = deg(84)
    // 两条手臂各自摆动（左臂参数和右臂不一样，否则就是“顺拐”——两边同向前后甩）
    const arms = (swingL: number, swingR: number, elbowL: number, elbowR: number, out = deg(3)) => {
      turn('UpperArm.L', swingL, out, armDown)
      turn('UpperArm.R', swingR, -out, -armDown)
      turn('LowerArm.L', elbowL, 0, 0)
      turn('LowerArm.R', elbowR, 0, 0)
      // 手腕朝向下面用 alignPalms() 按“掌心朝向大腿”自动算，这里不再写死角度
      void wristIn
    }
    const legs = (thighL: number, thighR: number, kneeL: number, kneeR: number, ankleL = 0, ankleR = 0) => {
      turn('UpperLeg.L', thighL, 0, 0)
      turn('UpperLeg.R', thighR, 0, 0)
      turn('LowerLeg.L', kneeL, 0, 0)
      turn('LowerLeg.R', kneeR, 0, 0)
      // 脚掌保持水平：抵消大腿+小腿的累积俯仰
      turn('Foot.L', -(thighL + kneeL) + ankleL, 0, 0)
      turn('Foot.R', -(thighR + kneeR) + ankleR, 0, 0)
    }

    const finish = () => {
      alignPalms()
      curlFingers(state.moving && state.speed > 6.2 ? 0.5 : 0.22)
      root.updateMatrixWorld(true)
    }

    if (state.riding) {
      const ride = state.ride
      if (ride) {
        // 骑行：屁股坐坐垫、双手握把、双脚踩踏板，全部用两骨 IK 对齐到真实车身的点
        const forward = ride.forward.clone().setY(0).normalize()
        const side = new THREE.Vector3(0, 1, 0).cross(forward).normalize()
        root.updateMatrixWorld(true)
        ik2('UpperLeg.L', 'LowerLeg.L', root.worldToLocal(ride.deckL.clone()), forward)
        ik2('UpperLeg.R', 'LowerLeg.R', root.worldToLocal(ride.deckR.clone()), forward)
        ik2('UpperArm.L', 'LowerArm.L', root.worldToLocal(ride.gripL.clone()), side)
        ik2('UpperArm.R', 'LowerArm.R', root.worldToLocal(ride.gripR.clone()), side.clone().negate())
        turn('Spine', deg(9), 0, 0)
        turn('Chest', deg(5), 0, 0)
        turn('Head', deg(-10), 0, 0)
        alignPalms()
        curlFingers(0.6)
        root.updateMatrixWorld(true)
      } else {
        for (const {bone} of hipsBones) bone.position.y = hipsRest ? hipsRest.y - 0.05 * posUnit : 0
        legs(deg(80), deg(80), deg(-74), deg(-74))
        arms(deg(24), deg(24), deg(30), deg(30), deg(6))
      }
      return
    }

    if (state.crouch) {
      for (const {bone} of hipsBones) bone.position.y = hipsRest ? hipsRest.y - 0.32 * posUnit : 0
      legs(deg(82), deg(82), deg(-92), deg(-92), deg(10), deg(10))
      turn('Spine', deg(18), 0, 0)
      turn('Chest', deg(6), 0, 0)
      turn('Head', deg(-14), 0, 0)
      arms(deg(-16), deg(-16), deg(48), deg(48), deg(8))
      finish()
      return
    }

    if (!state.grounded) {
      legs(deg(38), deg(8), deg(-58), deg(-16), deg(8), deg(12))
      arms(deg(-24), deg(-24), deg(36), deg(36), deg(14))
      turn('Spine', deg(-4), 0, 0)
      finish()
      return
    }

    if (!state.moving) {
      phase += dt * 1.4
      const breathe = Math.sin(phase) * deg(1.5)
      legs(deg(1.5), deg(1.5), deg(-3), deg(-3))
      arms(0, 0, deg(10) + breathe, deg(10) + breathe, deg(3))
      turn('Spine', breathe * 0.3, 0, 0)
      turn('Chest', breathe, 0, 0)
      turn('Head', 0, Math.sin(phase * 0.4) * deg(3), 0)
      finish()
      return
    }

    const running = state.speed > 6.2
    phase += dt * state.speed * (running ? 1.55 : 1.9)
    const swing = Math.sin(phase)
    const opposite = Math.sin(phase + Math.PI)

    if (!running) {
      // 走路：大腿 ±26°，摆动腿屈膝 42°，双臂反向摆 26°
      const thighL = deg(26) * swing
      const thighR = deg(26) * opposite
      const kneeL = -deg(10) - deg(42) * Math.max(0, -swing)
      const kneeR = -deg(10) - deg(42) * Math.max(0, -opposite)
      legs(thighL, thighR, kneeL, kneeR, deg(6), deg(6))
      // 左臂与左腿反向：左腿向前(+swing)时左臂向后；右臂同理相反
      arms(-deg(26) * swing, -deg(26) * opposite, deg(16) + deg(12) * Math.max(0, -swing), deg(16) + deg(12) * Math.max(0, -opposite), deg(3))
      turn('Spine', deg(3), deg(4) * swing, 0)
      turn('Chest', 0, deg(-6) * swing, 0)
      turn('Head', 0, deg(-2) * swing, 0)
      if (hipsRest) for (const {bone} of hipsBones) bone.position.y = hipsRest.y - 0.012 * posUnit + 0.02 * posUnit * Math.max(0, Math.cos(phase))
      finish()
      return
    }

    // 跑步：大腿 ±44°、屈膝 78°、前倾 12°、手臂大摆
    const thighL = deg(44) * swing
    const thighR = deg(44) * opposite
    const kneeL = -deg(18) - deg(78) * Math.max(0, -swing)
    const kneeR = -deg(18) - deg(78) * Math.max(0, -opposite)
    legs(thighL, thighR, kneeL, kneeR, deg(10), deg(10))
    arms(-deg(40) * swing, -deg(40) * opposite, deg(62) + deg(16) * Math.max(0, -swing), deg(62) + deg(16) * Math.max(0, -opposite), deg(6))
    turn('Spine', deg(-12) + deg(2) * Math.abs(swing), deg(6) * swing, 0)
    turn('Chest', 0, deg(-8) * swing, 0)
    turn('Head', deg(9), deg(-3) * swing, 0)
    if (hipsRest) {
      for (const {bone} of hipsBones) {
        bone.position.y = hipsRest.y - 0.03 * posUnit + 0.05 * posUnit * Math.max(0, Math.cos(phase))
        bone.position.x = hipsRest.x + 0.01 * posUnit * Math.sin(phase)
      }
    }
  }

  return {
    root,
    pose,
    headPosition(out: THREE.Vector3) {
      const head = lookup('Head')?.[0]?.bone
      if (!head) return out.copy(root.position)
      head.updateWorldMatrix(true, false)
      return head.getWorldPosition(out)
    },
    setHeadHidden(on: boolean) {
      root.traverse(object => {
        const mesh = object as THREE.Mesh
        if (mesh.userData?.pieceKind === 'Head') mesh.visible = !on
      })
    },
    setRiderView(on: boolean) {
      // 连描边黑壳一起处理：只隐藏模型不隐藏壳，镜头就会钻进一层黑壳里
      root.traverse(object => {
        const mesh = object as THREE.Mesh
        const kind = mesh.userData?.pieceKind as PieceKind | undefined
        if (!kind) return
        // 骑行视角里连描边黑壳一起藏掉，否则躯干的壳会糊在镜头前
        mesh.visible = on ? !mesh.userData.isShell && (kind === 'Body' || kind === 'Legs' || kind === 'Feet') : !!mesh.userData.pieceOwn
      })
    },
    height,
    dispose() {
      root.removeFromParent()
    },
  }
}

export function clipsReady() {
  return Promise.resolve()
}
