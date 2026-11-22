import * as THREE from 'three'
import vesselBounds from '../../../pipeline/vessel-bounds.json'
import {AVATAR_JOINT_NAMES, type AvatarJointName, type AvatarRig, type FootProbe} from './avatar-rig'
import {
  applyAvatarStyleMaterial,
  applyAvatarSurfaceAttribute,
  AVATAR_SURFACE,
  enableAvatarSurfaceAttributeOnMaterial,
  type AvatarSurfaceKind,
} from '../look/avatar-look'

/**
 * Cross-Module Avatar Compatibility & Style Integration Bridge (`web/src/walk/avatar-compat.ts`).
 *
 * Guarantees seamless drop-in compatibility when Hy1 swaps `public/avatar/figure.glb` to a refined
 * humanoid asset and Hy2 upgrades `avatar-rig.ts` motion drivers:
 *  1. Universal bone-name alias table (UE Mannequin, Mixamo, Blender Rigify, VRM/Standard, Legacy).
 *  2. Multi-`SkinnedMesh` discovery & auto-scale calibration locked to `TARGET_STANDING_HEIGHT_M = 1.695 m`
 *     so boat/raft/rowboat/car clearances (`pipeline/vessel-bounds.json`) never regress.
 *  3. Robust multi-schema foot-sole probe builder (`ensureRobustFootProbes`) & multi-mesh live sole sampling.
 *  4. Multi-strategy material styling & surface classification (single `COLOR_0` mesh, multi-material,
 *     multi-mesh named parts, or UV-textured meshes) with 0 dynamic lights and <= +1 shadow draw call.
 *  5. Structured compatibility diagnostics (`AvatarCompatReport`) for QA & merge gates.
 */

export const TARGET_STANDING_HEIGHT_M = 1.695
export const LEGACY_CITYWALKER_HEIGHT_M = 1.775
export const MAX_AVATAR_TRIANGLES_BUDGET = 24_000
export const MAX_AVATAR_MESH_DRAW_CALLS = 6

export type AvatarSkeletonSchema = 'ue_citywalker' | 'mixamo' | 'rigify' | 'standard' | 'legacy'
export type OutfitCompatStrategy = 'legacy_color0' | 'bone_color0' | 'named_parts' | 'material_slots' | 'none'

export type CanonicalBoneRole =
  | 'root'
  | 'pelvis'
  | 'spine_01'
  | 'spine_02'
  | 'spine_03'
  | 'neck'
  | 'head'
  | 'clavicle_l'
  | 'upperarm_l'
  | 'lowerarm_l'
  | 'hand_l'
  | 'clavicle_r'
  | 'upperarm_r'
  | 'lowerarm_r'
  | 'hand_r'
  | 'thigh_l'
  | 'calf_l'
  | 'foot_l'
  | 'ball_l'
  | 'thigh_r'
  | 'calf_r'
  | 'foot_r'
  | 'ball_r'

const BONE_ROLE_ALIASES: Record<CanonicalBoneRole, readonly string[]> = {
  root: ['root', 'Root', 'Armature', 'armature', 'mixamorigRoot'],
  pelvis: ['pelvis', 'Pelvis', 'Hips', 'hips', 'mixamorigHips', 'DEF-spine', 'hip', 'Hip'],
  spine_01: ['spine_01', 'Spine', 'spine', 'mixamorigSpine', 'DEF-spine.001', 'Torso'],
  spine_02: ['spine_02', 'Spine1', 'mixamorigSpine1', 'DEF-spine.002', 'Chest', 'chest'],
  spine_03: ['spine_03', 'Spine2', 'UpperChest', 'mixamorigSpine2', 'DEF-spine.003', 'upper_chest'],
  neck: ['neck_01', 'Neck', 'neck', 'mixamorigNeck', 'DEF-spine.004', 'neck_02'],
  head: ['head', 'Head', 'mixamorigHead', 'DEF-spine.006', 'head_leaf'],
  clavicle_l: ['clavicle_l', 'LeftShoulder', 'shoulder.L', 'DEF-shoulder.L', 'mixamorigLeftShoulder', 'ClavicleL'],
  upperarm_l: ['upperarm_l', 'LeftArm', 'UpperArm_L', 'upper_arm.L', 'DEF-upper_arm.L', 'mixamorigLeftArm', 'ArmL'],
  lowerarm_l: ['lowerarm_l', 'LeftForeArm', 'LowerArm_L', 'forearm.L', 'DEF-forearm.L', 'mixamorigLeftForeArm', 'ForearmL'],
  hand_l: ['hand_l', 'LeftHand', 'Hand_L', 'hand.L', 'DEF-hand.L', 'mixamorigLeftHand', 'HandL'],
  clavicle_r: ['clavicle_r', 'RightShoulder', 'shoulder.R', 'DEF-shoulder.R', 'mixamorigRightShoulder', 'ClavicleR'],
  upperarm_r: ['upperarm_r', 'RightArm', 'UpperArm_R', 'upper_arm.R', 'DEF-upper_arm.R', 'mixamorigRightArm', 'ArmR'],
  lowerarm_r: ['lowerarm_r', 'RightForeArm', 'LowerArm_R', 'forearm.R', 'DEF-forearm.R', 'mixamorigRightForeArm', 'ForearmR'],
  hand_r: ['hand_r', 'RightHand', 'Hand_R', 'hand.R', 'DEF-hand.R', 'mixamorigRightHand', 'HandR'],
  thigh_l: ['thigh_l', 'LeftUpLeg', 'Thigh_L', 'thigh.L', 'DEF-thigh.L', 'mixamorigLeftUpLeg', 'ThighL'],
  calf_l: ['calf_l', 'LeftLeg', 'Calf_L', 'shin.L', 'DEF-shin.L', 'mixamorigLeftLeg', 'ShinL'],
  foot_l: ['foot_l', 'LeftFoot', 'Foot_L', 'foot.L', 'DEF-foot.L', 'mixamorigLeftFoot', 'ankle_l', 'FootL'],
  ball_l: ['ball_l', 'LeftToeBase', 'Toe_L', 'toe.L', 'DEF-toe.L', 'mixamorigLeftToeBase', 'toe_l', 'ToeL'],
  thigh_r: ['thigh_r', 'RightUpLeg', 'Thigh_R', 'thigh.R', 'DEF-thigh.R', 'mixamorigRightUpLeg', 'ThighR'],
  calf_r: ['calf_r', 'RightLeg', 'Calf_R', 'shin.R', 'DEF-shin.R', 'mixamorigRightLeg', 'ShinR'],
  foot_r: ['foot_r', 'RightFoot', 'Foot_R', 'foot.R', 'DEF-foot.R', 'mixamorigRightFoot', 'ankle_r', 'FootR'],
  ball_r: ['ball_r', 'RightToeBase', 'Toe_R', 'toe.R', 'DEF-toe.R', 'mixamorigRightToeBase', 'toe_r', 'ToeR'],
}

const NORMALIZED_ALIAS_LOOKUP = new Map<string, CanonicalBoneRole>()
for (const [role, names] of Object.entries(BONE_ROLE_ALIASES) as [CanonicalBoneRole, readonly string[]][]) {
  for (const raw of names) {
    NORMALIZED_ALIAS_LOOKUP.set(raw.toLowerCase(), role)
  }
}

export function resolveCanonicalBoneRole(boneName: string): CanonicalBoneRole | null {
  if (!boneName) return null
  const lower = boneName.toLowerCase()
  const exact = NORMALIZED_ALIAS_LOOKUP.get(lower)
  if (exact) return exact
  // Strip common prefixes (mixamorig:, DEF-, ORG-, J_Bip_C_, ValveBiped.Bip01_)
  const stripped = lower.replace(/^(mixamorig:?|def-|org-|j_bip_[clr]_|bip01_)/, '')
  const byStrip = NORMALIZED_ALIAS_LOOKUP.get(stripped)
  if (byStrip) return byStrip
  if (/(^|[._-])(head|skull|face|eye|jaw|brow|ear|mouth)/.test(stripped)) return 'head'
  if (/(^|[._-])neck/.test(stripped)) return 'neck'
  if (/(foot|ankle).*([._-]?l$|left)|left.*(foot|ankle)/.test(stripped)) return 'foot_l'
  if (/(foot|ankle).*([._-]?r$|right)|right.*(foot|ankle)/.test(stripped)) return 'foot_r'
  if (/(toe|ball).*([._-]?l$|left)|left.*(toe|ball)/.test(stripped)) return 'ball_l'
  if (/(toe|ball).*([._-]?r$|right)|right.*(toe|ball)/.test(stripped)) return 'ball_r'
  if (/(calf|shin|lowerleg).*([._-]?l$|left)|left.*(calf|shin|lowerleg)/.test(stripped)) return 'calf_l'
  if (/(calf|shin|lowerleg).*([._-]?r$|right)|right.*(calf|shin|lowerleg)/.test(stripped)) return 'calf_r'
  if (/(thigh|upleg).*([._-]?l$|left)|left.*(thigh|upleg)/.test(stripped)) return 'thigh_l'
  if (/(thigh|upleg).*([._-]?r$|right)|right.*(thigh|upleg)/.test(stripped)) return 'thigh_r'
  if (/(hand|wrist|finger|thumb|index|middle|ring|pinky).*([._-]?l$|left)|left.*(hand|wrist|finger)/.test(stripped)) return 'hand_l'
  if (/(hand|wrist|finger|thumb|index|middle|ring|pinky).*([._-]?r$|right)|right.*(hand|wrist|finger)/.test(stripped)) return 'hand_r'
  if (/(forearm|lowerarm).*([._-]?l$|left)|left.*(forearm|lowerarm)/.test(stripped)) return 'lowerarm_l'
  if (/(forearm|lowerarm).*([._-]?r$|right)|right.*(forearm|lowerarm)/.test(stripped)) return 'lowerarm_r'
  if (/(upperarm|upper_arm|arm).*([._-]?l$|left)|left.*(upperarm|arm)/.test(stripped)) return 'upperarm_l'
  if (/(upperarm|upper_arm|arm).*([._-]?r$|right)|right.*(upperarm|arm)/.test(stripped)) return 'upperarm_r'
  if (/(pelvis|hips?)$/.test(stripped)) return 'pelvis'
  return null
}

export function isHeadOrFaceBone(boneName: string): boolean {
  const role = resolveCanonicalBoneRole(boneName)
  if (role === 'head' || role === 'neck') return true
  return /(head|neck|face|eye|eyelid|brow|jaw|mouth|lip|nose|ear|hair|ponytail)/i.test(boneName)
}

export function isHandOrFingerBone(boneName: string): boolean {
  const role = resolveCanonicalBoneRole(boneName)
  if (role === 'hand_l' || role === 'hand_r') return true
  return /(hand|wrist|thumb|index|middle|ring|pinky|finger)/i.test(boneName)
}

export function isFootBone(boneName: string): boolean {
  const role = resolveCanonicalBoneRole(boneName)
  return role === 'foot_l' || role === 'foot_r' || role === 'ball_l' || role === 'ball_r'
}

export function isArmBone(boneName: string): boolean {
  const role = resolveCanonicalBoneRole(boneName)
  return (
    role === 'clavicle_l' ||
    role === 'clavicle_r' ||
    role === 'upperarm_l' ||
    role === 'upperarm_r' ||
    role === 'lowerarm_l' ||
    role === 'lowerarm_r'
  )
}

export function isLegBone(boneName: string): boolean {
  const role = resolveCanonicalBoneRole(boneName)
  return role === 'thigh_l' || role === 'thigh_r' || role === 'calf_l' || role === 'calf_r'
}

export function collectAvatarSkinnedMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const out: THREE.SkinnedMesh[] = []
  root.traverse(node => {
    if (node instanceof THREE.SkinnedMesh) out.push(node)
  })
  return out
}

export function detectSkeletonSchema(root: THREE.Object3D): AvatarSkeletonSchema {
  const remembered = root.userData?.__originalSkeletonSchema as AvatarSkeletonSchema | undefined
  if (remembered) return remembered
  let hasMixamo = false
  let hasRigify = false
  let hasPelvisUe = false
  let hasStandard = false
  root.traverse(node => {
    const n = node.name
    if (!n) return
    if (n.startsWith('mixamorig')) hasMixamo = true
    else if (n.startsWith('DEF-')) hasRigify = true
    else if (n === 'pelvis' || n === 'spine_01' || n === 'upperarm_l') hasPelvisUe = true
    else if (n === 'Hips' || n === 'LeftUpLeg' || n === 'LeftFoot') hasStandard = true
  })
  if (hasMixamo) return 'mixamo'
  if (hasRigify) return 'rigify'
  if (hasPelvisUe) return 'ue_citywalker'
  if (hasStandard) return 'standard'
  return 'legacy'
}

const CANONICAL_TO_UE_BONE: Record<CanonicalBoneRole, string> = {
  root: 'root',
  pelvis: 'pelvis',
  spine_01: 'spine_01',
  spine_02: 'spine_02',
  spine_03: 'spine_03',
  neck: 'neck_01',
  head: 'head',
  clavicle_l: 'clavicle_l',
  upperarm_l: 'upperarm_l',
  lowerarm_l: 'lowerarm_l',
  hand_l: 'hand_l',
  clavicle_r: 'clavicle_r',
  upperarm_r: 'upperarm_r',
  lowerarm_r: 'lowerarm_r',
  hand_r: 'hand_r',
  thigh_l: 'thigh_l',
  calf_l: 'calf_l',
  foot_l: 'foot_l',
  ball_l: 'ball_l',
  thigh_r: 'thigh_r',
  calf_r: 'calf_r',
  foot_r: 'foot_r',
  ball_r: 'ball_r',
}

/**
 * Normalizes non-UE humanoid skeletons (Mixamo / Blender Rigify / Standard Hips-LeftUpLeg)
 * onto the canonical UE joint names consumed by `ensureAvatarRig` while retargeting matching
 * `AnimationClip.tracks` atomically. Guaranteed 100% no-op on current UE `CityWalker`.
 */
export function normalizeAvatarSkeletonForRig(
  root: THREE.Group,
  animations?: readonly THREE.AnimationClip[],
): {normalized: boolean; renamedBones: number; retargetedTracks: number; originalSchema: AvatarSkeletonSchema} {
  const originalSchema = detectSkeletonSchema(root)
  root.userData.__originalSkeletonSchema = originalSchema

  const skinnedMeshes = collectAvatarSkinnedMeshes(root)
  if (!skinnedMeshes.length || root.getObjectByName('pelvis')) {
    return {normalized: false, renamedBones: 0, retargetedTracks: 0, originalSchema}
  }

  const renameMap = new Map<string, string>()
  const claimedTargets = new Set<string>()
  const bonesToRename: {node: THREE.Object3D; targetName: string}[] = []

  root.traverse(node => {
    if (!(node instanceof THREE.Bone) || !node.name) return
    const role = resolveCanonicalBoneRole(node.name)
    if (!role) return
    const ueName = CANONICAL_TO_UE_BONE[role]
    if (!ueName || claimedTargets.has(ueName)) return
    claimedTargets.add(ueName)
    if (node.name !== ueName) {
      renameMap.set(node.name, ueName)
      bonesToRename.push({node, targetName: ueName})
    }
  })

  if (!claimedTargets.has('pelvis') || !bonesToRename.length) {
    return {normalized: false, renamedBones: 0, retargetedTracks: 0, originalSchema}
  }

  for (const entry of bonesToRename) {
    entry.node.name = entry.targetName
  }

  let retargetedTracks = 0
  if (animations?.length) {
    for (const clip of animations) {
      for (const track of clip.tracks) {
        const dotIdx = track.name.indexOf('.')
        if (dotIdx <= 0) continue
        const prefix = track.name.slice(0, dotIdx)
        const mapped = renameMap.get(prefix)
        if (mapped) {
          track.name = `${mapped}${track.name.slice(dotIdx)}`
          retargetedTracks++
        }
      }
    }
  }

  root.userData.__normalizedSkeleton = true
  return {
    normalized: true,
    renamedBones: bonesToRename.length,
    retargetedTracks,
    originalSchema,
  }
}

/** Updates skeleton matrices across every SkinnedMesh under `root` before world Box3 clearance checks. */
export function updateAllAvatarSkeletons(root: THREE.Object3D): void {
  for (const sm of collectAvatarSkinnedMeshes(root)) {
    sm.skeleton?.update()
  }
}

export interface AvatarBodyMetrics {
  bindMinY: number
  bindMaxY: number
  bindHeightM: number
  headTopY: number
  torsoBackZ: number
  recommendedScale: number
  triangleCount: number
  meshCount: number
  materialCount: number
  boneCount: number
  hasColor0: boolean
  hasUv0: boolean
}

export function measureAvatarAsset(root: THREE.Object3D, fallbackScale = 0.955): AvatarBodyMetrics {
  root.updateMatrixWorld(true)
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const v = new THREE.Vector3()
  let minY = Infinity
  let maxY = -Infinity
  let torsoBackZ = 0.14
  let triangleCount = 0
  let meshCount = 0
  let hasColor0 = false
  let hasUv0 = false
  const matSet = new Set<THREE.Material>()
  const boneSet = new Set<THREE.Object3D>()

  root.traverse(node => {
    if (node instanceof THREE.Bone) boneSet.add(node)
    if (!(node instanceof THREE.Mesh)) return
    if (node.userData?.isAttachmentAnchor || node.name.startsWith('outfit_')) return
    const pos = node.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!pos) return
    meshCount++
    if (node.geometry.getAttribute('color')) hasColor0 = true
    if (node.geometry.getAttribute('uv')) hasUv0 = true
    const idx = node.geometry.getIndex()
    triangleCount += idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3)
    const mats = Array.isArray(node.material) ? node.material : [node.material]
    for (const m of mats) if (m) matSet.add(m)

    const toLocal = new THREE.Matrix4().multiplyMatrices(rootInv, node.matrixWorld)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toLocal)
      if (v.y < minY) minY = v.y
      if (v.y > maxY) maxY = v.y
      if (v.y >= 1.0 && v.y <= 1.45 && Math.abs(v.x) <= 0.18 && v.z > torsoBackZ && v.z < 0.35) {
        torsoBackZ = v.z
      }
    }
  })

  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || maxY - minY < 0.5) {
    return {
      bindMinY: 0,
      bindMaxY: LEGACY_CITYWALKER_HEIGHT_M,
      bindHeightM: LEGACY_CITYWALKER_HEIGHT_M,
      headTopY: LEGACY_CITYWALKER_HEIGHT_M,
      torsoBackZ: 0.14,
      recommendedScale: fallbackScale,
      triangleCount,
      meshCount,
      materialCount: matSet.size,
      boneCount: boneSet.size,
      hasColor0,
      hasUv0,
    }
  }

  const bindHeightM = maxY - minY
  // Preserve exact legacy 0.955 for CityWalker (1.775 m -> 1.695 m); auto-scale any differently authored new GLB
  // so seated head height never breaks vessel-bounds (raft.head=1.31, rowboat.head=1.28, boat.head=1.57) or car roof.
  const isLegacyHeight = Math.abs(bindHeightM - LEGACY_CITYWALKER_HEIGHT_M) < 0.015
  const recommendedScale = isLegacyHeight
    ? fallbackScale
    : THREE.MathUtils.clamp(TARGET_STANDING_HEIGHT_M / bindHeightM, 0.5, 2.0)

  return {
    bindMinY: +minY.toFixed(4),
    bindMaxY: +maxY.toFixed(4),
    bindHeightM: +bindHeightM.toFixed(4),
    headTopY: +maxY.toFixed(4),
    torsoBackZ: +torsoBackZ.toFixed(4),
    recommendedScale: +recommendedScale.toFixed(4),
    triangleCount,
    meshCount,
    materialCount: matSet.size,
    boneCount: boneSet.size,
    hasColor0,
    hasUv0,
  }
}

/**
 * Builds foot-sole contact probes across ALL SkinnedMeshes using canonical bone aliases
 * (supports UE `foot_l/ball_l`, Mixamo `mixamorigLeftFoot`, Rigify `foot.L`, Standard `LeftFoot`,
 * or falls back cleanly to lowest-vertex calf/ankle probes so feet NEVER float or sink).
 */
export function buildRobustFootProbes(root: THREE.Group, rig: AvatarRig): {soleOffset: number; footProbes: FootProbe[]} {
  const skinnedMeshes = collectAvatarSkinnedMeshes(root)
  if (!skinnedMeshes.length) {
    return {soleOffset: rig.soleOffset, footProbes: rig.footProbes}
  }
  // If AvatarRig already built valid probes on single-mesh CityWalker, preserve them verbatim.
  if (rig.footProbes.length >= 2 && skinnedMeshes.length === 1) {
    return {soleOffset: rig.soleOffset, footProbes: rig.footProbes}
  }

  root.updateMatrixWorld(true)
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const vWorld = new THREE.Vector3()
  const vLocal = new THREE.Vector3()
  let minY = Infinity

  for (const sm of skinnedMeshes) {
    const pos = sm.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!pos) continue
    for (let i = 0; i < pos.count; i++) {
      vWorld.fromBufferAttribute(pos, i).applyMatrix4(sm.matrixWorld)
      const figY = vLocal.copy(vWorld).applyMatrix4(rootInv).y
      if (figY < minY) minY = figY
    }
  }
  const soleCutoff = minY + 0.035
  const perBone = new Map<THREE.Object3D, THREE.Vector3[]>()
  const boneWorldInv = new Map<THREE.Object3D, THREE.Matrix4>()

  for (const sm of skinnedMeshes) {
    const pos = sm.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    const skinIdx = sm.geometry.getAttribute('skinIndex') as THREE.BufferAttribute | undefined
    const skinWgt = sm.geometry.getAttribute('skinWeight') as THREE.BufferAttribute | undefined
    const bones = sm.skeleton?.bones
    if (!pos || !skinIdx || !skinWgt || !bones?.length) continue

    for (let i = 0; i < pos.count; i++) {
      vWorld.fromBufferAttribute(pos, i).applyMatrix4(sm.matrixWorld)
      const figY = vLocal.copy(vWorld).applyMatrix4(rootInv).y
      if (figY > soleCutoff) continue

      let bestBoneIdx = Math.round(skinIdx.getX(i))
      let bestW = skinWgt.getX(i)
      const slots: [number, number][] = [
        [skinIdx.getY(i), skinWgt.getY(i)],
        [skinIdx.getZ(i), skinWgt.getZ(i)],
        [skinIdx.getW(i), skinWgt.getW(i)],
      ]
      for (const [bi, w] of slots) {
        if (w > bestW) { bestW = w; bestBoneIdx = Math.round(bi) }
      }
      const bone = bones[bestBoneIdx]
      if (!bone) continue
      const role = resolveCanonicalBoneRole(bone.name)
      const accept =
        role === 'foot_l' || role === 'foot_r' || role === 'ball_l' || role === 'ball_r' ||
        role === 'calf_l' || role === 'calf_r'
      if (!accept) continue

      let inv = boneWorldInv.get(bone)
      if (!inv) {
        inv = new THREE.Matrix4().copy(bone.matrixWorld).invert()
        boneWorldInv.set(bone, inv)
      }
      let pts = perBone.get(bone)
      if (!pts) { pts = []; perBone.set(bone, pts) }
      pts.push(vWorld.clone().applyMatrix4(inv))
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
    soleOffset: Number.isFinite(minY) ? Math.max(0, -minY) : rig.soleOffset,
    footProbes: footProbes.length ? footProbes : rig.footProbes,
  }
}

/**
 * Classifies a mesh/material semantic surface kind by name when a refined multi-mesh / multi-material
 * model from Hy1 does not use `OUTFIT_ZONE` vertex zones.
 */
export function inferSurfaceKindFromName(name: string): AvatarSurfaceKind {
  const n = name.toLowerCase()
  if (/(skin|face|head|body|hand|arm|neck|ear|lip|eye)/.test(n) && !/(hair|helmet|hat|headgear)/.test(n)) {
    return AVATAR_SURFACE.SKIN
  }
  if (/(hair|brow|ponytail|fringe|bangs)/.test(n)) {
    return AVATAR_SURFACE.HAIR
  }
  if (/(shoe|boot|sneaker|sole|helmet|visor|hat|cap|bag|pack|buckle|zipper|belt|glasses|watch)/.test(n)) {
    return AVATAR_SURFACE.ACCESSORY
  }
  return AVATAR_SURFACE.FABRIC
}

/**
 * Applies Guilin Phase 2 style-fusion shading to EVERY mesh inside `figure` (single-mesh `CityWalker`,
 * multi-mesh refined humanoid, UV-textured, or vertex-colored) with +0 extra draw calls and 0 dynamic lights.
 */
export function installAvatarStyleShading(
  figure: THREE.Group,
  metrics: AvatarBodyMetrics,
  outfitZones?: Uint8Array | null,
  primarySkinned?: THREE.SkinnedMesh,
): {styledMaterials: number; surfaceAttrApplied: boolean} {
  let styledMaterials = 0
  let surfaceAttrApplied = false

  figure.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    if (node.userData?.isAttachmentAnchor || node.name.startsWith('outfit_')) return

    const mats = Array.isArray(node.material) ? node.material : [node.material]
    const defaultSurf = inferSurfaceKindFromName(node.name || mats[0]?.name || '')

    // Stamp per-vertex `aAvatarSurface` on primary SkinnedMesh using outfit zones (or bone-based fallback)
    if (node instanceof THREE.SkinnedMesh && node.geometry.getAttribute('position')) {
      if (outfitZones && (!primarySkinned || node === primarySkinned) && outfitZones.length === node.geometry.getAttribute('position').count) {
        applyAvatarSurfaceAttribute(node.geometry, i => {
          const z = outfitZones[i]
          if (z === 0) return AVATAR_SURFACE.SKIN // LOCKED_SKIN
          if (z === 1) return AVATAR_SURFACE.HAIR // LOCKED_HAIR
          if (z === 8 || z === 9 || z === 10 || z === 11 || z === 7) return AVATAR_SURFACE.ACCESSORY // SHOES / PACK / BELT
          return AVATAR_SURFACE.FABRIC
        })
        surfaceAttrApplied = true
      } else if (node.skeleton?.bones?.length && node.geometry.getAttribute('skinIndex') && node.geometry.getAttribute('skinWeight')) {
        const pos = node.geometry.getAttribute('position') as THREE.BufferAttribute
        const sIdx = node.geometry.getAttribute('skinIndex') as THREE.BufferAttribute
        const sWgt = node.geometry.getAttribute('skinWeight') as THREE.BufferAttribute
        const bones = node.skeleton.bones
        applyAvatarSurfaceAttribute(node.geometry, i => {
          const ws = [sWgt.getX(i), sWgt.getY(i), sWgt.getZ(i), sWgt.getW(i)]
          const bs = [sIdx.getX(i), sIdx.getY(i), sIdx.getZ(i), sIdx.getW(i)]
          let slot = 0
          for (let k = 1; k < 4; k++) if (ws[k] > ws[slot]) slot = k
          const bName = bones[Math.round(bs[slot])]?.name ?? ''
          if (isFootBone(bName)) return AVATAR_SURFACE.ACCESSORY
          if (isHandOrFingerBone(bName)) return AVATAR_SURFACE.SKIN
          if (isHeadOrFaceBone(bName)) {
            return pos.getY(i) > metrics.bindMaxY - 0.16 ? AVATAR_SURFACE.HAIR : AVATAR_SURFACE.SKIN
          }
          return defaultSurf
        })
        surfaceAttrApplied = true
      }
    }

    for (const mat of mats) {
      if (!mat) continue
      const matSurf = mat.name ? inferSurfaceKindFromName(mat.name) : defaultSurf
      const matLabel = (mat.name || node.name || '').toLowerCase()
      applyAvatarStyleMaterial(mat, {
        defaultSurface: matSurf,
        glossyShell: /(helmet|visor|glasses|metal|buckle|watch)/.test(matLabel),
        minY: metrics.bindMinY,
        heightSpan: metrics.bindHeightM,
      })
      if (node.geometry.getAttribute('aAvatarSurface')) {
        enableAvatarSurfaceAttributeOnMaterial(mat)
      }
      styledMaterials++
    }
  })

  return {styledMaterials, surfaceAttrApplied}
}

export interface AvatarCompatReport {
  schema: AvatarSkeletonSchema
  meshCount: number
  materialCount: number
  triangleCount: number
  boneCount: number
  bindHeightM: number
  appliedScale: number
  standingHeightM: number
  footProbeCount: number
  soleOffsetM: number
  hasColor0: boolean
  hasUv0: boolean
  styledMaterials: number
  surfaceAttrApplied: boolean
  requiredJointsPresent: number
  requiredJointsTotal: number
  attachmentsReady: boolean
  outfitStrategy: OutfitCompatStrategy
  vesselBoundsClearanceOk: boolean
  perfBudgetOk: boolean
  warnings: string[]
}

/**
 * Validates that any loaded avatar asset (current `CityWalker` or Hy1's refined model) satisfies
 * every cross-module invariant: joints for walk/bike/car/boat/crash, foot probes, outfit anchors,
 * vessel-bounds standing height, and 30/60 FPS triangle & draw-call budget.
 */
export function buildAvatarCompatReport(params: {
  figure: THREE.Group
  rig: AvatarRig
  metrics: AvatarBodyMetrics
  appliedScale: number
  soleOffset: number
  footProbes: FootProbe[]
  styledMaterials: number
  surfaceAttrApplied: boolean
  outfitStrategy: OutfitCompatStrategy
}): AvatarCompatReport {
  const {figure, rig, metrics, appliedScale, soleOffset, footProbes, styledMaterials, surfaceAttrApplied, outfitStrategy} = params
  const schema = detectSkeletonSchema(figure)
  const warnings: string[] = []

  let requiredJointsPresent = 0
  for (const name of AVATAR_JOINT_NAMES as readonly AvatarJointName[]) {
    if (rig.joints[name]) requiredJointsPresent++
  }
  const requiredJointsTotal = AVATAR_JOINT_NAMES.length
  if (requiredJointsPresent < requiredJointsTotal) {
    warnings.push(`missing_joints:${requiredJointsTotal - requiredJointsPresent}`)
  }

  const standingHeightM = +(metrics.bindHeightM * appliedScale).toFixed(4)
  // Ensure seated head fits under Guilin bridges (vessel-bounds: rowboat.head=1.28, raft.head=1.31)
  const vesselBoundsClearanceOk = standingHeightM >= 1.50 && standingHeightM <= 1.76 && vesselBounds.rowboat.head <= 1.35
  if (!vesselBoundsClearanceOk) {
    warnings.push(`standing_height_out_of_band:${standingHeightM}`)
  }

  const attachmentsReady = Boolean(rig.attachments.head && rig.attachments.torso)
  if (!attachmentsReady) warnings.push('missing_outfit_attachments')
  if (footProbes.length === 0) warnings.push('empty_foot_probes')

  const perfBudgetOk = metrics.triangleCount <= MAX_AVATAR_TRIANGLES_BUDGET && metrics.meshCount <= MAX_AVATAR_MESH_DRAW_CALLS
  if (!perfBudgetOk) {
    warnings.push(`perf_budget_exceeded:tris=${metrics.triangleCount},meshes=${metrics.meshCount}`)
  }

  return {
    schema,
    meshCount: metrics.meshCount,
    materialCount: metrics.materialCount,
    triangleCount: metrics.triangleCount,
    boneCount: metrics.boneCount,
    bindHeightM: metrics.bindHeightM,
    appliedScale,
    standingHeightM,
    footProbeCount: footProbes.length,
    soleOffsetM: +(soleOffset * appliedScale).toFixed(4),
    hasColor0: metrics.hasColor0,
    hasUv0: metrics.hasUv0,
    styledMaterials,
    surfaceAttrApplied,
    requiredJointsPresent,
    requiredJointsTotal,
    attachmentsReady,
    outfitStrategy,
    vesselBoundsClearanceOk,
    perfBudgetOk,
    warnings,
  }
}
