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
  const qArmL = new THREE.Quaternion()
  const qArmR = new THREE.Quaternion()
  const qForearmL = new THREE.Quaternion()
  const qForearmR = new THREE.Quaternion()
  const qThighL = new THREE.Quaternion()
  const qThighR = new THREE.Quaternion()
  const qShinL = new THREE.Quaternion()
  const qShinR = new THREE.Quaternion()

  const worldQuats = new Map<THREE.Object3D, THREE.Quaternion>()

  function setBoneFromCharDelta(name: string, charDelta: THREE.Quaternion, preDrop: THREE.Quaternion | null) {
    const rest = boneRestMap.get(name)
    if (!rest) return
    const bone = rest.bone
    const parent = bone.parent
    let parentCharWorld = parent ? worldQuats.get(parent) : undefined
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
    worldQuats.set(bone, targetWorld.clone())
  }

  function applyBones() {
    if (!proceduralActive) return
    worldQuats.clear()
    for (const r of allRestBones) {
      r.bone.position.copy(r.position)
      r.bone.quaternion.copy(r.quaternion)
      r.bone.scale.copy(r.scale)
    }
    if (armature) worldQuats.set(armature, armature.quaternion)
    const rootBone = boneRestMap.get('root')
    if (rootBone) worldQuats.set(rootBone.bone, rootBone.worldRestQuat)

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

    setBoneFromCharDelta('clavicle_l', qSpine3, null)
    const charUpperL = new THREE.Quaternion().copy(qSpine3).multiply(qArmL)
    setBoneFromCharDelta('upperarm_l', charUpperL, Q_DROP_L)
    const charLowerL = new THREE.Quaternion().copy(charUpperL).multiply(qForearmL)
    setBoneFromCharDelta('lowerarm_l', charLowerL, Q_DROP_L)
    setBoneFromCharDelta('hand_l', charLowerL, Q_DROP_L)

    setBoneFromCharDelta('clavicle_r', qSpine3, null)
    const charUpperR = new THREE.Quaternion().copy(qSpine3).multiply(qArmR)
    setBoneFromCharDelta('upperarm_r', charUpperR, Q_DROP_R)
    const charLowerR = new THREE.Quaternion().copy(charUpperR).multiply(qForearmR)
    setBoneFromCharDelta('lowerarm_r', charLowerR, Q_DROP_R)
    setBoneFromCharDelta('hand_r', charLowerR, Q_DROP_R)

    const charThighL = new THREE.Quaternion().copy(qHips).multiply(qThighL)
    setBoneFromCharDelta('thigh_l', charThighL, null)
    const charCalfL = new THREE.Quaternion().copy(charThighL).multiply(qShinL)
    setBoneFromCharDelta('calf_l', charCalfL, null)
    setBoneFromCharDelta('foot_l', charCalfL, null)
    setBoneFromCharDelta('ball_l', charCalfL, null)

    const charThighR = new THREE.Quaternion().copy(qHips).multiply(qThighR)
    setBoneFromCharDelta('thigh_r', charThighR, null)
    const charCalfR = new THREE.Quaternion().copy(charThighR).multiply(qShinR)
    setBoneFromCharDelta('calf_r', charCalfR, null)
    setBoneFromCharDelta('foot_r', charCalfR, null)
    setBoneFromCharDelta('ball_r', charCalfR, null)
  }

  function restoreRestPose() {
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
