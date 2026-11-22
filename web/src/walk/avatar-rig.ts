import * as THREE from 'three'

export const AVATAR_JOINT_NAMES = [
  'Hips', 'Torso', 'Head',
  'ArmL', 'ArmR', 'ForearmL', 'ForearmR',
  'ThighL', 'ThighR', 'ShinL', 'ShinR',
] as const

export type AvatarJointName = (typeof AVATAR_JOINT_NAMES)[number]

export interface AvatarJointRotation {
  x: number
  y: number
  z: number
  set(x: number, y: number, z: number): unknown
}

export interface AvatarJointHandle {
  rotation: AvatarJointRotation
}

export type AvatarJointMap = Record<AvatarJointName, AvatarJointHandle | undefined>

export interface FootProbe {
  joint: THREE.Object3D
  points: THREE.Vector3[]
}

export interface AvatarAttachments {
  head?: THREE.Object3D
  torso?: THREE.Object3D
}

export interface AvatarAdditivePose {
  joints?: Partial<Record<AvatarJointName, [number, number, number]>>
  headLook?: [number, number, number]
  pelvisShift?: [number, number, number]
}

export interface AvatarGaitStrides {
  leftLegFwd: number
  rightLegFwd: number
  legAdvance: number
  stepOpen: number
}

export interface AvatarRig {
  isSkinned: boolean
  skinnedMesh?: THREE.SkinnedMesh
  traveller?: THREE.Object3D
  joints: AvatarJointMap
  attachments: AvatarAttachments
  attachmentAt?(boneName: string): THREE.Object3D | undefined
  soleOffset: number
  footProbes: FootProbe[]
  clearPose(): void
  syncPose(): void
  applyAdditive(pose: AvatarAdditivePose): void
  clearAdditive(): void
  measureGaitStrides(): AvatarGaitStrides
}

interface BoneRest {
  bone: THREE.Object3D
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
  worldRestQuat: THREE.Quaternion
}

const ARMS_DROP_ANGLE = Math.PI * 0.48
const Q_DROP_L = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ARMS_DROP_ANGLE)
const Q_DROP_R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ARMS_DROP_ANGLE)
const Q_IDENTITY = new THREE.Quaternion()

const _euler = new THREE.Euler(0, 0, 0, 'XYZ')
const _qTmp = new THREE.Quaternion()
const _qParentInv = new THREE.Quaternion()
const _vA = new THREE.Vector3()

function eulerToQuat(x: number, y: number, z: number, out = new THREE.Quaternion()): THREE.Quaternion {
  _euler.set(x, y, z, 'XYZ')
  return out.setFromEuler(_euler)
}

function buildFootProbesForSkinned(root: THREE.Group, skinned: THREE.SkinnedMesh): {soleOffset: number; footProbes: FootProbe[]} {
  const geom = skinned.geometry
  const posAttr = geom.getAttribute('position')
  if (!posAttr) return {soleOffset: 0, footProbes: []}

  const skinIdxAttr = geom.getAttribute('skinIndex')
  const skinWgtAttr = geom.getAttribute('skinWeight')
  const skeleton = skinned.skeleton
  const targetBones = new Set(['foot_l', 'ball_l', 'foot_r', 'ball_r'])

  root.updateMatrixWorld(true)
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const vWorld = new THREE.Vector3()
  let minY = Infinity
  const perBone = new Map<THREE.Object3D, THREE.Vector3[]>()
  const boneWorldInv = new Map<THREE.Object3D, THREE.Matrix4>()

  for (let i = 0; i < posAttr.count; i++) {
    vWorld.fromBufferAttribute(posAttr, i).applyMatrix4(skinned.matrixWorld).applyMatrix4(rootInv)
    if (vWorld.y < minY) minY = vWorld.y
  }
  const soleCutoff = minY + 0.03

  if (skinIdxAttr && skinWgtAttr && skeleton) {
    for (let i = 0; i < posAttr.count; i++) {
      vWorld.fromBufferAttribute(posAttr, i).applyMatrix4(skinned.matrixWorld)
      const figY = _vA.copy(vWorld).applyMatrix4(rootInv).y
      if (figY > soleCutoff) continue

      let bestBoneIdx = Math.round(skinIdxAttr.getX(i))
      let bestWeight = skinWgtAttr.getX(i)
      const comps = [
        [skinIdxAttr.getY(i), skinWgtAttr.getY(i)],
        [skinIdxAttr.getZ(i), skinWgtAttr.getZ(i)],
        [skinIdxAttr.getW(i), skinWgtAttr.getW(i)],
      ]
      for (const [bIdx, w] of comps) {
        if (w > bestWeight) {
          bestWeight = w
          bestBoneIdx = Math.round(bIdx)
        }
      }
      const bone = skeleton.bones[bestBoneIdx]
      if (!bone || !targetBones.has(bone.name)) continue
      let inv = boneWorldInv.get(bone)
      if (!inv) {
        inv = new THREE.Matrix4().copy(bone.matrixWorld).invert()
        boneWorldInv.set(bone, inv)
      }
      let list = perBone.get(bone)
      if (!list) {
        list = []
        perBone.set(bone, list)
      }
      list.push(vWorld.clone().applyMatrix4(inv))
    }
  }

  const footProbes: FootProbe[] = []
  for (const [joint, pts] of perBone) {
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity, bz0 = Infinity, bz1 = -Infinity
    for (const p of pts) {
      if (p.x < bx0) bx0 = p.x; if (p.x > bx1) bx1 = p.x
      if (p.y < by0) by0 = p.y; if (p.y > by1) by1 = p.y
      if (p.z < bz0) bz0 = p.z; if (p.z > bz1) bz1 = p.z
    }
    if (Number.isFinite(bx0)) {
      const midY = (by0 + by1) * 0.5
      footProbes.push({
        joint,
        points: [
          new THREE.Vector3(bx0, midY, bz0),
          new THREE.Vector3(bx1, midY, bz0),
          new THREE.Vector3(bx0, midY, bz1),
          new THREE.Vector3(bx1, midY, bz1),
        ],
      })
    }
  }
  return {
    soleOffset: Number.isFinite(minY) ? Math.max(0, -minY) : 0,
    footProbes,
  }
}

/**
 * Prepares `figure_a.glb` (or preserves legacy `figure.glb`) for walk/run/crouch/jump and
 * vehicle riding/driving/rowing/crash poses using exact character-space quaternion retargeting.
 */
export function ensureAvatarRig(root: THREE.Group, tintHex: string | null = null): AvatarRig {
  const existing = root.userData.avatarRig as AvatarRig | undefined
  if (existing) return existing

  let skinnedMesh: THREE.SkinnedMesh | undefined
  root.traverse(node => {
    if (node instanceof THREE.SkinnedMesh && !skinnedMesh) skinnedMesh = node
  })

  if (!skinnedMesh || !root.getObjectByName('pelvis')) {
    const legacyJoints = Object.fromEntries(
      AVATAR_JOINT_NAMES.map(name => [name, root.getObjectByName(name)]),
    ) as AvatarJointMap
    const metrics = (root.userData.footMetrics as {soleOffset: number; footProbes: FootProbe[]} | undefined) ?? {soleOffset: 0, footProbes: []}
    const legacyRig: AvatarRig = {
      isSkinned: false,
      skinnedMesh: root.userData.skinned as THREE.SkinnedMesh | undefined,
      traveller: root.getObjectByName('Traveller'),
      joints: legacyJoints,
      attachments: {
        head: root.getObjectByName('Head') ?? root.getObjectByName('head') ?? root,
        torso: root.getObjectByName('Torso') ?? root.getObjectByName('spine_02') ?? root,
      },
      soleOffset: metrics.soleOffset,
      footProbes: metrics.footProbes,
      clearPose() {
        for (const name of AVATAR_JOINT_NAMES) legacyJoints[name]?.rotation.set(0, 0, 0)
      },
      syncPose() {},
      applyAdditive(pose) {
        if (!pose.joints) return
        for (const [name, angles] of Object.entries(pose.joints)) {
          const j = legacyJoints[name as AvatarJointName]
          if (j && angles) j.rotation.set(angles[0], angles[1], angles[2])
        }
        if (pose.headLook && legacyJoints.Head) {
          legacyJoints.Head.rotation.set(pose.headLook[0], pose.headLook[1], pose.headLook[2])
        }
      },
      clearAdditive() {
        for (const name of AVATAR_JOINT_NAMES) legacyJoints[name]?.rotation.set(0, 0, 0)
      },
      measureGaitStrides() {
        const tl = legacyJoints.ThighL?.rotation.x ?? 0
        const tr = legacyJoints.ThighR?.rotation.x ?? 0
        return {leftLegFwd: tl, rightLegFwd: tr, legAdvance: THREE.MathUtils.clamp((tl - tr) * 1.4, -1, 1), stepOpen: Math.abs(tl - tr)}
      },
    }
    root.userData.avatarRig = legacyRig
    return legacyRig
  }

  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.scale.setScalar(1)

  let traveller = root.getObjectByName('Traveller')
  const armature = root.getObjectByName('Armature')
  if (!traveller) {
    traveller = new THREE.Group()
    traveller.name = 'Traveller'
    const children = [...root.children]
    for (const child of children) traveller.add(child)
    root.add(traveller)
  }

  // `figure_a.glb` is authored facing +Z; game local character forward is -Z.
  // Rotating the inner Armature by Math.PI preserves -Z convention across walking, riding, cars and boats.
  if (armature && !armature.userData.facingFlipped) {
    armature.rotation.y += Math.PI
    armature.userData.facingFlipped = true
  }

  root.traverse(node => {
    if (node instanceof THREE.SkinnedMesh) {
      node.frustumCulled = false
      if (tintHex) {
        const mats = Array.isArray(node.material) ? node.material : [node.material]
        for (const m of mats) {
          if (m && 'color' in m && m.color instanceof THREE.Color) m.color.set(tintHex)
        }
      }
    }
  })

  root.updateMatrixWorld(true)
  const {soleOffset, footProbes} = buildFootProbesForSkinned(root, skinnedMesh)
  root.userData.skinned = skinnedMesh
  root.userData.footMetrics = {soleOffset, footProbes}

  // Capture clean bind rest transforms in character-local space (root identity).
  const rootWorldInv = new THREE.Quaternion().copy(root.getWorldQuaternion(new THREE.Quaternion())).invert()
  const boneRestMap = new Map<string, BoneRest>()
  const allRestBones: BoneRest[] = []
  const skeletonRoot = root.getObjectByName('root') ?? armature ?? root
  skeletonRoot.traverse(node => {
    if (node === skeletonRoot && node === root) return
    if (node instanceof THREE.Mesh) return
    if (node.userData?.isAttachmentAnchor) return
    const worldQ = node.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootWorldInv)
    const entry: BoneRest = {
      bone: node,
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
      worldRestQuat: worldQ,
    }
    boneRestMap.set(node.name, entry)
    allRestBones.push(entry)
  })

  const state: Record<AvatarJointName, [number, number, number]> = {
    Hips: [0, 0, 0],
    Torso: [0, 0, 0],
    Head: [0, 0, 0],
    ArmL: [0, 0, 0],
    ArmR: [0, 0, 0],
    ForearmL: [0, 0, 0],
    ForearmR: [0, 0, 0],
    ThighL: [0, 0, 0],
    ThighR: [0, 0, 0],
    ShinL: [0, 0, 0],
    ShinR: [0, 0, 0],
  }

  let proceduralActive = false
  const qHips = new THREE.Quaternion()
  const qTorso = new THREE.Quaternion()
  const qS1 = new THREE.Quaternion()
  const qS2 = new THREE.Quaternion()
  const qS3 = new THREE.Quaternion()
  const qSpine1 = new THREE.Quaternion()
  const qSpine2 = new THREE.Quaternion()
  const qSpine3 = new THREE.Quaternion()
  const qNeck = new THREE.Quaternion()
  const qHeadFull = new THREE.Quaternion()
  const qHeadDelta = new THREE.Quaternion()
  const qClavL = new THREE.Quaternion()
  const qClavR = new THREE.Quaternion()
  const qArmL = new THREE.Quaternion()
  const qArmR = new THREE.Quaternion()
  const qForearmL = new THREE.Quaternion()
  const qForearmR = new THREE.Quaternion()
  const qThighL = new THREE.Quaternion()
  const qThighR = new THREE.Quaternion()
  const qShinL = new THREE.Quaternion()
  const qShinR = new THREE.Quaternion()
  const qCharUpperL = new THREE.Quaternion()
  const qCharLowerL = new THREE.Quaternion()
  const qCharUpperR = new THREE.Quaternion()
  const qCharLowerR = new THREE.Quaternion()
  const qCharThighL = new THREE.Quaternion()
  const qCharCalfL = new THREE.Quaternion()
  const qCharThighR = new THREE.Quaternion()
  const qCharCalfR = new THREE.Quaternion()

  const worldQuats = new Map<THREE.Object3D, THREE.Quaternion>()
  const worldQuatsValid = new Set<THREE.Object3D>()
  const additivePool = new Map<THREE.Object3D, {bone: THREE.Object3D; pos: THREE.Vector3; quat: THREE.Quaternion; active: boolean}>()
  const additiveActiveList: Array<{bone: THREE.Object3D; pos: THREE.Vector3; quat: THREE.Quaternion; active: boolean}> = []
  const addOrigCharQ = new Map<THREE.Object3D, THREE.Quaternion>()
  const addNewCharQ = new Map<THREE.Object3D, THREE.Quaternion>()
  const addOrigCharValid = new Set<THREE.Object3D>()
  const addNewCharValid = new Set<THREE.Object3D>()
  const _qArmChar = new THREE.Quaternion()
  const _qTargetChar = new THREE.Quaternion()
  const _addPos = new THREE.Vector3()
  const _addDelta = new THREE.Quaternion()
  const _addStabilize = new THREE.Quaternion()
  const _addNeckDelta = new THREE.Quaternion()
  const _addHeadRem = new THREE.Quaternion()
  const strideOut: AvatarGaitStrides = {leftLegFwd: 0, rightLegFwd: 0, legAdvance: 0, stepOpen: 0}

  function poolCopyQuat(
    pool: Map<THREE.Object3D, THREE.Quaternion>,
    valid: Set<THREE.Object3D>,
    key: THREE.Object3D,
    src: THREE.Quaternion,
  ): THREE.Quaternion {
    let q = pool.get(key)
    if (!q) {
      q = new THREE.Quaternion()
      pool.set(key, q)
    }
    q.copy(src)
    valid.add(key)
    return q
  }

  function poolMulQuat(
    pool: Map<THREE.Object3D, THREE.Quaternion>,
    valid: Set<THREE.Object3D>,
    key: THREE.Object3D,
    a: THREE.Quaternion,
    b: THREE.Quaternion,
  ): THREE.Quaternion {
    let q = pool.get(key)
    if (!q) {
      q = new THREE.Quaternion()
      pool.set(key, q)
    }
    q.copy(a).multiply(b)
    valid.add(key)
    return q
  }

  function getArmatureCharQuat(): THREE.Quaternion {
    if (!armature) return Q_IDENTITY
    const q = _qArmChar.set(0, 0, 0, 1)
    let cur: THREE.Object3D | null = armature
    while (cur && cur !== root) {
      q.premultiply(cur.quaternion)
      cur = cur.parent
    }
    return q
  }

  function clearAdditiveLayer() {
    if (additiveActiveList.length === 0) return
    for (let i = 0; i < additiveActiveList.length; i++) {
      const saved = additiveActiveList[i]
      saved.bone.position.copy(saved.pos)
      saved.bone.quaternion.copy(saved.quat)
      saved.active = false
    }
    additiveActiveList.length = 0
  }

  function setBoneFromCharDelta(name: string, charDelta: THREE.Quaternion, preDrop: THREE.Quaternion | null) {
    const rest = boneRestMap.get(name)
    if (!rest) return
    const bone = rest.bone
    const parent = bone.parent
    let parentCharWorld = parent && worldQuatsValid.has(parent) ? worldQuats.get(parent) : undefined
    if (!parentCharWorld && parent) {
      if (armature && parent === armature) {
        parentCharWorld = armature.quaternion
      } else {
        const parentRest = boneRestMap.get(parent.name)
        parentCharWorld = parentRest ? parentRest.worldRestQuat : Q_IDENTITY
      }
    }
    const baseParentQ = parentCharWorld ?? Q_IDENTITY
    const targetWorld = _qTmp.copy(charDelta)
    if (preDrop) targetWorld.multiply(preDrop)
    targetWorld.multiply(rest.worldRestQuat)

    _qParentInv.copy(baseParentQ).invert()
    bone.quaternion.copy(_qParentInv).multiply(targetWorld)
    poolCopyQuat(worldQuats, worldQuatsValid, bone, targetWorld)
  }

  function applyBones() {
    if (!proceduralActive) return
    clearAdditiveLayer()
    worldQuatsValid.clear()
    for (const r of allRestBones) {
      r.bone.position.copy(r.position)
      r.bone.quaternion.copy(r.quaternion)
      r.bone.scale.copy(r.scale)
    }
    if (armature) poolCopyQuat(worldQuats, worldQuatsValid, armature, armature.quaternion)
    const rootBone = boneRestMap.get('root')
    if (rootBone) poolCopyQuat(worldQuats, worldQuatsValid, rootBone.bone, rootBone.worldRestQuat)

    eulerToQuat(state.Hips[0], state.Hips[1], state.Hips[2], qHips)
    eulerToQuat(state.Torso[0], state.Torso[1], state.Torso[2], qTorso)
    eulerToQuat(state.Head[0], state.Head[1], state.Head[2], qHeadDelta)
    eulerToQuat(state.ArmL[0], state.ArmL[1], state.ArmL[2], qArmL)
    eulerToQuat(state.ArmR[0], state.ArmR[1], state.ArmR[2], qArmR)
    eulerToQuat(state.ForearmL[0], state.ForearmL[1], state.ForearmL[2], qForearmL)
    eulerToQuat(state.ForearmR[0], state.ForearmR[1], state.ForearmR[2], qForearmR)
    eulerToQuat(state.ThighL[0], state.ThighL[1], state.ThighL[2], qThighL)
    eulerToQuat(state.ThighR[0], state.ThighR[1], state.ThighR[2], qThighR)
    eulerToQuat(state.ShinL[0], state.ShinL[1], state.ShinL[2], qShinL)
    eulerToQuat(state.ShinR[0], state.ShinR[1], state.ShinR[2], qShinR)

    setBoneFromCharDelta('pelvis', qHips, null)

    qS1.copy(Q_IDENTITY).slerp(qTorso, 0.25)
    qS2.copy(Q_IDENTITY).slerp(qTorso, 0.65)
    qS3.copy(qTorso)
    qSpine1.copy(qHips).multiply(qS1)
    qSpine2.copy(qHips).multiply(qS2)
    qSpine3.copy(qHips).multiply(qS3)
    setBoneFromCharDelta('spine_01', qSpine1, null)
    setBoneFromCharDelta('spine_02', qSpine2, null)
    setBoneFromCharDelta('spine_03', qSpine3, null)

    qNeck.copy(Q_IDENTITY).slerp(qHeadDelta, 0.35).premultiply(qSpine3)
    qHeadFull.copy(qSpine3).multiply(qHeadDelta)
    setBoneFromCharDelta('neck_01', qNeck, null)
    setBoneFromCharDelta('head', qHeadFull, null)

    // Couple subtle collarbone reach & shoulder lift to upper-arm elevation/spread (verified -Y/-Z left, +Y/+Z right).
    const clavLShrug = Math.max(0, state.ArmL[0]) * 0.08 + Math.max(0, -state.ArmL[2]) * 0.14
    const clavRShrug = Math.max(0, state.ArmR[0]) * 0.08 + Math.max(0, state.ArmR[2]) * 0.14
    eulerToQuat(0, -state.ArmL[0] * 0.12, -clavLShrug, qClavL)
    eulerToQuat(0, state.ArmR[0] * 0.12, clavRShrug, qClavR)

    setBoneFromCharDelta('clavicle_l', _qTmp.copy(qSpine3).multiply(qClavL), null)
    qCharUpperL.copy(qSpine3).multiply(qArmL)
    setBoneFromCharDelta('upperarm_l', qCharUpperL, Q_DROP_L)
    qCharLowerL.copy(qCharUpperL).multiply(qForearmL)
    setBoneFromCharDelta('lowerarm_l', qCharLowerL, Q_DROP_L)
    setBoneFromCharDelta('hand_l', qCharLowerL, Q_DROP_L)

    setBoneFromCharDelta('clavicle_r', _qTmp.copy(qSpine3).multiply(qClavR), null)
    qCharUpperR.copy(qSpine3).multiply(qArmR)
    setBoneFromCharDelta('upperarm_r', qCharUpperR, Q_DROP_R)
    qCharLowerR.copy(qCharUpperR).multiply(qForearmR)
    setBoneFromCharDelta('lowerarm_r', qCharLowerR, Q_DROP_R)
    setBoneFromCharDelta('hand_r', qCharLowerR, Q_DROP_R)

    qCharThighL.copy(qHips).multiply(qThighL)
    setBoneFromCharDelta('thigh_l', qCharThighL, null)
    qCharCalfL.copy(qCharThighL).multiply(qShinL)
    setBoneFromCharDelta('calf_l', qCharCalfL, null)
    setBoneFromCharDelta('foot_l', qCharCalfL, null)
    setBoneFromCharDelta('ball_l', qCharCalfL, null)

    qCharThighR.copy(qHips).multiply(qThighR)
    setBoneFromCharDelta('thigh_r', qCharThighR, null)
    qCharCalfR.copy(qCharThighR).multiply(qShinR)
    setBoneFromCharDelta('calf_r', qCharCalfR, null)
    setBoneFromCharDelta('foot_r', qCharCalfR, null)
    setBoneFromCharDelta('ball_r', qCharCalfR, null)
  }

  function restoreRestPose() {
    clearAdditiveLayer()
    proceduralActive = false
    for (const r of allRestBones) {
      r.bone.position.copy(r.position)
      r.bone.quaternion.copy(r.quaternion)
      r.bone.scale.copy(r.scale)
    }
    for (const name of AVATAR_JOINT_NAMES) {
      state[name][0] = 0
      state[name][1] = 0
      state[name][2] = 0
    }
  }

  const ADDITIVE_CHAIN = [
    'root', 'pelvis', 'spine_01', 'spine_02', 'spine_03',
    'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
    'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
    'neck_01', 'head',
    'thigh_l', 'calf_l', 'foot_l',
    'thigh_r', 'calf_r', 'foot_r',
  ] as const
  const ZERO_EULER: [number, number, number] = [0, 0, 0]

  function buildCharQuatMap() {
    addOrigCharValid.clear()
    addNewCharValid.clear()
    const armQ = getArmatureCharQuat()
    if (armature) {
      poolCopyQuat(addOrigCharQ, addOrigCharValid, armature, armQ)
      poolCopyQuat(addNewCharQ, addNewCharValid, armature, armQ)
    }
    for (const name of ADDITIVE_CHAIN) {
      const b = boneRestMap.get(name)?.bone
      if (!b) continue
      const pQ = (b.parent && addOrigCharValid.has(b.parent) ? addOrigCharQ.get(b.parent) : undefined) ?? Q_IDENTITY
      const cq = poolMulQuat(addOrigCharQ, addOrigCharValid, b, pQ, b.quaternion)
      poolCopyQuat(addNewCharQ, addNewCharValid, b, cq)
    }
  }

  function applyCharDeltaBone(name: string, charDelta: THREE.Quaternion, posShiftChar?: THREE.Vector3) {
    const b = boneRestMap.get(name)?.bone
    if (!b || !b.parent) return
    let saved = additivePool.get(b)
    if (!saved) {
      saved = {bone: b, pos: b.position.clone(), quat: b.quaternion.clone(), active: false}
      additivePool.set(b, saved)
    }
    if (!saved.active) {
      saved.pos.copy(b.position)
      saved.quat.copy(b.quaternion)
      saved.active = true
      additiveActiveList.push(saved)
    }
    const origLocalQ = saved.quat
    const parentNewQ = (addNewCharValid.has(b.parent) ? addNewCharQ.get(b.parent) : undefined) ?? Q_IDENTITY
    _qTargetChar.copy(charDelta).multiply(parentNewQ).multiply(origLocalQ)
    _qParentInv.copy(parentNewQ).invert()
    b.quaternion.copy(_qParentInv).multiply(_qTargetChar)
    poolCopyQuat(addNewCharQ, addNewCharValid, b, _qTargetChar)

    if (posShiftChar) {
      const shiftLocal = _vA.copy(posShiftChar).applyQuaternion(_qParentInv)
      b.position.copy(saved.pos).add(shiftLocal)
    }

    // Re-sync immediate descendants along chain even if they have identity delta.
    for (const child of b.children) {
      if (addOrigCharValid.has(child)) {
        poolMulQuat(addNewCharQ, addNewCharValid, child, _qTargetChar, child.quaternion)
      }
    }
  }

  function applyAdditivePose(pose: AvatarAdditivePose) {
    if (proceduralActive) return
    clearAdditiveLayer()
    buildCharQuatMap()

    const j = pose.joints ?? {}
    const hipsE = j.Hips ?? ZERO_EULER
    const torsoE = j.Torso ?? ZERO_EULER
    const armLE = j.ArmL ?? ZERO_EULER
    const armRE = j.ArmR ?? ZERO_EULER
    const foreLE = j.ForearmL ?? ZERO_EULER
    const foreRE = j.ForearmR ?? ZERO_EULER
    const thighLE = j.ThighL ?? ZERO_EULER
    const thighRE = j.ThighR ?? ZERO_EULER
    const shinLE = j.ShinL ?? ZERO_EULER
    const shinRE = j.ShinR ?? ZERO_EULER

    eulerToQuat(hipsE[0], hipsE[1], hipsE[2], qHips)
    const pShift = pose.pelvisShift ? _addPos.set(pose.pelvisShift[0], pose.pelvisShift[1], pose.pelvisShift[2]) : undefined
    applyCharDeltaBone('pelvis', qHips, pShift)

    eulerToQuat(torsoE[0], torsoE[1], torsoE[2], qTorso)
    eulerToQuat(torsoE[0] * 0.22, torsoE[1] * 0.22, torsoE[2] * 0.22, qS1)
    eulerToQuat(torsoE[0] * 0.38, torsoE[1] * 0.38, torsoE[2] * 0.38, qS2)
    eulerToQuat(torsoE[0] * 0.40, torsoE[1] * 0.40, torsoE[2] * 0.40, qS3)
    applyCharDeltaBone('spine_01', qS1)
    applyCharDeltaBone('spine_02', qS2)
    applyCharDeltaBone('spine_03', qS3)

    // Clavicles lift/pull subtly with breath and arm swing.
    const breathRise = Math.max(0, torsoE[0]) * 0.35
    eulerToQuat(0, -armLE[0] * 0.14, -(breathRise + Math.max(0, armLE[0]) * 0.08 + Math.max(0, -armLE[2]) * 0.14), qClavL)
    eulerToQuat(0, armRE[0] * 0.14, breathRise + Math.max(0, armRE[0]) * 0.08 + Math.max(0, armRE[2]) * 0.14, qClavR)
    applyCharDeltaBone('clavicle_l', qClavL)
    eulerToQuat(armLE[0], armLE[1], armLE[2], qArmL)
    applyCharDeltaBone('upperarm_l', qArmL)
    eulerToQuat(foreLE[0], foreLE[1], foreLE[2], qForearmL)
    applyCharDeltaBone('lowerarm_l', qForearmL)

    applyCharDeltaBone('clavicle_r', qClavR)
    eulerToQuat(armRE[0], armRE[1], armRE[2], qArmR)
    applyCharDeltaBone('upperarm_r', qArmR)
    eulerToQuat(foreRE[0], foreRE[1], foreRE[2], qForearmR)
    applyCharDeltaBone('lowerarm_r', qForearmR)

    // Stabilize part of spine additive roll/yaw when turning head toward look target.
    const spine3 = boneRestMap.get('spine_03')?.bone
    const spineOrig = spine3 && addOrigCharValid.has(spine3) ? addOrigCharQ.get(spine3) : undefined
    const spineNew = spine3 && addNewCharValid.has(spine3) ? addNewCharQ.get(spine3) : undefined
    _addStabilize.copy(Q_IDENTITY)
    if (spineOrig && spineNew) {
      _addDelta.copy(spineNew).multiply(_qTmp.copy(spineOrig).invert())
      _addStabilize.copy(Q_IDENTITY).slerp(_addDelta.invert(), 0.52)
    }

    const hl = pose.headLook ?? ZERO_EULER
    const hd = j.Head ?? ZERO_EULER
    const headBone = boneRestMap.get('head')?.bone
    const headAnchor = attachments.head
    let clipFixPitch = 0, clipFixYaw = 0
    if (headBone && headAnchor && headAnchor.parent === headBone) {
      const headOrig = addOrigCharValid.has(headBone) ? addOrigCharQ.get(headBone) : undefined
      const qRawHeadAnchor = _qTmp.copy(headOrig ?? Q_IDENTITY).multiply(headAnchor.quaternion)
      const fwdRaw = _vA.set(0, 0, -1).applyQuaternion(qRawHeadAnchor)
      const rawClipPitch = Math.asin(THREE.MathUtils.clamp(fwdRaw.y, -1, 1))
      const rawClipYaw = Math.atan2(-fwdRaw.x, -fwdRaw.z)
      clipFixPitch = rawClipPitch < -0.7 ? THREE.MathUtils.clamp(-rawClipPitch * 0.25, 0, 0.22) : THREE.MathUtils.clamp(-rawClipPitch * 0.62, -0.06, 0.24)
      clipFixYaw = THREE.MathUtils.clamp(-rawClipYaw * 0.65, -0.18, 0.18)
    }
    eulerToQuat(hl[0] + hd[0] + clipFixPitch, hl[1] + hd[1] + clipFixYaw, hl[2] + hd[2], qHeadDelta)
    qHeadFull.copy(qHeadDelta).multiply(_addStabilize)
    _addNeckDelta.copy(Q_IDENTITY).slerp(qHeadFull, 0.40)
    _addHeadRem.copy(qHeadFull).multiply(_qTmp.copy(_addNeckDelta).invert())
    applyCharDeltaBone('neck_01', _addNeckDelta)
    applyCharDeltaBone('head', _addHeadRem)

    eulerToQuat(thighLE[0], thighLE[1], thighLE[2], qThighL)
    applyCharDeltaBone('thigh_l', qThighL)
    eulerToQuat(shinLE[0], shinLE[1], shinLE[2], qShinL)
    applyCharDeltaBone('calf_l', qShinL)

    eulerToQuat(thighRE[0], thighRE[1], thighRE[2], qThighR)
    applyCharDeltaBone('thigh_r', qThighR)
    eulerToQuat(shinRE[0], shinRE[1], shinRE[2], qShinR)
    applyCharDeltaBone('calf_r', qShinR)
  }

  function measureGaitStrides(): AvatarGaitStrides {
    const thighL = boneRestMap.get('thigh_l')?.bone
    const calfL = boneRestMap.get('calf_l')?.bone
    const footL = boneRestMap.get('foot_l')?.bone
    const thighR = boneRestMap.get('thigh_r')?.bone
    const calfR = boneRestMap.get('calf_r')?.bone
    const footR = boneRestMap.get('foot_r')?.bone
    if (!thighL || !calfL || !footL || !thighR || !calfR || !footR) {
      strideOut.leftLegFwd = 0
      strideOut.rightLegFwd = 0
      strideOut.legAdvance = 0
      strideOut.stepOpen = 0
      return strideOut
    }
    buildCharQuatMap()
    const legFwd = (th: THREE.Object3D, cf: THREE.Object3D, ft: THREE.Object3D) => {
      const qTh = (addOrigCharValid.has(th) ? addOrigCharQ.get(th) : undefined) ?? Q_IDENTITY
      const qCf = (addOrigCharValid.has(cf) ? addOrigCharQ.get(cf) : undefined) ?? Q_IDENTITY
      const seg1 = _vA.copy(cf.position).applyQuaternion(qTh).z
      const seg2 = _addPos.copy(ft.position).applyQuaternion(qCf).z
      return -(seg1 + seg2)
    }
    const leftLegFwd = legFwd(thighL, calfL, footL)
    const rightLegFwd = legFwd(thighR, calfR, footR)
    const diff = leftLegFwd - rightLegFwd
    strideOut.leftLegFwd = leftLegFwd
    strideOut.rightLegFwd = rightLegFwd
    strideOut.legAdvance = THREE.MathUtils.clamp(diff / 0.48, -1, 1)
    strideOut.stepOpen = Math.abs(diff)
    return strideOut
  }

  function makeJointHandle(name: AvatarJointName): AvatarJointHandle {
    const arr = state[name]
    const rotation: AvatarJointRotation = {
      get x() { return arr[0] },
      set x(v: number) { arr[0] = v; proceduralActive = true; applyBones() },
      get y() { return arr[1] },
      set y(v: number) { arr[1] = v; proceduralActive = true; applyBones() },
      get z() { return arr[2] },
      set z(v: number) { arr[2] = v; proceduralActive = true; applyBones() },
      set(x: number, y: number, z: number) {
        arr[0] = x; arr[1] = y; arr[2] = z
        proceduralActive = true
        applyBones()
      },
    }
    return {rotation}
  }

  const joints = Object.fromEntries(
    AVATAR_JOINT_NAMES.map(name => [name, makeJointHandle(name)]),
  ) as AvatarJointMap

  // Create axis-aligned attachment anchors under `head` and `spine_02` (compensating native bone roll/tilt to -Z forward).
  function ensureBoneAttachmentAnchor(boneName: string, fallbackName: string, anchorName: string): THREE.Object3D | undefined {
    const rest = boneRestMap.get(boneName) ?? boneRestMap.get(fallbackName)
    if (!rest) return undefined
    const existing = rest.bone.children.find(c => c.name === anchorName && c.userData?.isAttachmentAnchor)
    if (existing) return existing
    const anchor = new THREE.Group()
    anchor.name = anchorName
    anchor.userData.isAttachmentAnchor = true
    anchor.quaternion.copy(rest.worldRestQuat).invert()
    rest.bone.add(anchor)
    return anchor
  }

  const attachments: AvatarAttachments = {
    head: ensureBoneAttachmentAnchor('head', 'neck_01', 'attach_head'),
    torso: ensureBoneAttachmentAnchor('spine_02', 'spine_03', 'attach_torso'),
  }

  const rig: AvatarRig = {
    isSkinned: true,
    skinnedMesh,
    traveller,
    joints,
    attachments,
    attachmentAt: name => ensureBoneAttachmentAnchor(name, name, 'attach_' + name),
    soleOffset,
    footProbes,
    clearPose: restoreRestPose,
    syncPose: applyBones,
    applyAdditive: applyAdditivePose,
    clearAdditive: clearAdditiveLayer,
    measureGaitStrides,
  }
  root.userData.avatarRig = rig
  return rig
}

export function getAvatarJoint(figure: THREE.Group, name: AvatarJointName): AvatarJointHandle | undefined {
  const rig = figure.userData.avatarRig as AvatarRig | undefined
  if (rig) return rig.joints[name]
  return figure.getObjectByName(name)
}

export function getAvatarJoints(figure: THREE.Group): AvatarJointMap {
  const rig = figure.userData.avatarRig as AvatarRig | undefined
  if (rig) return rig.joints
  return Object.fromEntries(AVATAR_JOINT_NAMES.map(name => [name, figure.getObjectByName(name)])) as AvatarJointMap
}

export function clearAvatarPose(figure: THREE.Group) {
  const rig = figure.userData.avatarRig as AvatarRig | undefined
  if (rig) {
    rig.clearPose()
    return
  }
  for (const name of AVATAR_JOINT_NAMES) figure.getObjectByName(name)?.rotation.set(0, 0, 0)
}
