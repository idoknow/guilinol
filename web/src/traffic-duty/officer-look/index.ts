import * as THREE from 'three'
import type {Avatar} from '../../../../lib/avatar.ts'
import {OFFICER_UNIFORM_OUTFIT, type EquippedOutfit} from '../../game/catalog.ts'
import {mainDetail} from '../../look/mirror-layer.ts'
import {AVATAR_JOINT_NAMES, ensureAvatarRig} from '../../walk/avatar-rig.ts'
import {characterModel, hairstyle, styleCharacter} from '../../walk/character.ts'
import {getCreatorExpression, setCreatorExpression} from '../../walk/creator-face.ts'
import {streetShading} from '../../walk/creator-ink.ts'
import {OUTFIT_ZONE, partitionCityWalkerGeometry, type AvatarOutfitController} from '../../walk/outfits.ts'
import {
  buildFallbackPoliceCap,
  buildOfficerFingerPoses,
  buildOfficerUpperDutyKit,
  ensureCharacterAlignedBoneMount,
} from './geometry-kit.ts'
import {
  OFFICER_ALL_EXPRESSION_IDS,
  OFFICER_EXPRESSION_IDS,
  normalizeOfficerExpression,
  normalizeOfficerFaceExpression,
  type ApplyOfficerLookOptions,
  type OfficerExpressionId,
  type OfficerFaceExpressionId,
  type OfficerLookHandle,
  type OfficerLookMetrics,
} from './types.ts'

export {
  OFFICER_ALL_EXPRESSION_IDS,
  OFFICER_EXPRESSION_IDS,
  normalizeOfficerExpression,
  normalizeOfficerFaceExpression,
  type ApplyOfficerLookOptions,
  type OfficerExpressionId,
  type OfficerFaceExpressionId,
  type OfficerLookAnchors,
  type OfficerLookHandle,
  type OfficerLookMetrics,
  type OfficerLookParts,
} from './types.ts'

export const DEFAULT_OFFICER_AVATAR: Avatar = Object.freeze({
  v: 1,
  body: 'm',
  skin: 2,
  face: 1,
  brows: 0,
  eyes: 0,
  hair: 'm_crop',
  hairColor: 0,
  look: 'basic',
  createdAt: 1,
})

export function resolveOfficerUniformOutfit(): EquippedOutfit {
  return {...OFFICER_UNIFORM_OUTFIT}
}

/**
 * Canonical player-pipeline loader for Traffic Officer NPC & Portraits (`r10-officer-guide.md` §2):
 * `characterModel(OFFICER_AVATAR)` -> `ensureAvatarRig(fig)` -> `styleCharacter(fig, rig, OFFICER_AVATAR)`
 * -> `outfit.applyEquipped(OFFICER_UNIFORM_OUTFIT, {ridingEbike: false, autoHelmetOnRide: false})`
 * -> `setCreatorExpression(fig, expr)` -> `applyOfficerLook(...)`.
 */
export async function loadStyledOfficerCharacter(
  avatar: Avatar = DEFAULT_OFFICER_AVATAR,
  options?: Omit<ApplyOfficerLookOptions, 'avatar' | 'outfitController'>,
): Promise<{
  scene: THREE.Group
  rig: ReturnType<typeof ensureAvatarRig>
  outfitController: AvatarOutfitController
  look: OfficerLookHandle
}> {
  const loaded = await characterModel(avatar)
  const fig = loaded.scene as THREE.Group
  const rig = ensureAvatarRig(fig)
  const outfitController = styleCharacter(fig, rig, avatar)
  const uniform = options?.uniformOutfit ?? resolveOfficerUniformOutfit()
  outfitController.applyEquipped(uniform, {ridingEbike: false, autoHelmetOnRide: false})
  const initExpr = options?.expression ? normalizeOfficerFaceExpression(options.expression) : 'serious'
  setCreatorExpression(fig, initExpr)
  const look = applyOfficerLook(fig, {
    ...options,
    avatar,
    outfitController,
    uniformOutfit: uniform,
    expression: initExpr,
  })
  return {scene: fig, rig, outfitController, look}
}

const ACTIVE_HANDLES = new WeakMap<THREE.Object3D, OfficerLookHandle>()
const HAND_BONE_RE = /^(hand_[lr]|(thumb|index|middle|ring|pinky)_0[123]_[lr])$/

function findPrimarySkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null
  root.traverse(node => {
    if (found) return
    if (
      node instanceof THREE.SkinnedMesh &&
      node.name !== 'creator-body-outline' &&
      node.name !== 'creator-skirt' &&
      node.name !== 'officer_limb_accents'
    ) {
      found = node
    }
  })
  return found
}

/**
 * Strips ONLY stale legacy procedural officer meshes while NEVER removing any player creator pipeline nodes:
 * `creator-face`, `creator-hair`, `creator-body-outline`, `creator-outline`, `creator-skirt`, and `starterDetails` are strictly preserved!
 */
function stripLegacyCharacterOverlays(root: THREE.Object3D): void {
  const legacyNames = new Set([
    'officer_traffic_cap_group',
    'officer_duty_gear',
    'officer_thumbsup_fist_pad',
    'officer_r9_thumb_sculpt',
    'officer_r9_fist_roll',
    'officer_temple_seal_-1',
    'officer_temple_seal_1',
    'officer_face_rig',
    'officer_vest_unit',
    'officer_belt_unit',
    'officer_limb_accents',
  ])
  const toRemove: THREE.Object3D[] = []
  root.traverse(node => {
    if (
      legacyNames.has(node.name) ||
      node.name.startsWith('officer_thumb_sleeve_') ||
      node.name.startsWith('officer-expr-')
    ) {
      toRemove.push(node)
    }
  })
  for (const obj of toRemove) {
    obj.removeFromParent()
  }
}

function buildFallbackCreatorHair(avatar: Avatar): THREE.Group {
  const grp = new THREE.Group()
  grp.name = 'creator-hair'
  const dome = new THREE.SphereGeometry(0.104, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62)
  dome.translate(0, 0.088, 0.008)
  const pos = dome.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  colors.fill(0.5)
  dome.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const mat = new THREE.MeshStandardMaterial({
    color: avatar.hairColor === 0 ? '#1b1a1a' : '#2e2219',
    roughness: 0.68,
    flatShading: true,
    vertexColors: true,
  })
  streetShading(mat)
  const mesh = new THREE.Mesh(dome, mat)
  grp.add(mesh)
  return grp
}

function ensurePlayerPipelineStyled(
  rootGroup: THREE.Group,
  rig: ReturnType<typeof ensureAvatarRig>,
  bodyMesh: THREE.SkinnedMesh,
  avatar: Avatar,
  uniform: EquippedOutfit,
  existingController?: AvatarOutfitController | null,
  hairLibraryScene?: THREE.Object3D | null,
): AvatarOutfitController {
  const hasFace = Boolean(rootGroup.getObjectByName('creator-face'))
  const hasOutline = Boolean(rootGroup.getObjectByName('creator-body-outline'))
  const hasHair = Boolean(rootGroup.getObjectByName('creator-hair') || rootGroup.userData.creatorHair)
  const cachedController =
    existingController ?? (rootGroup.userData.officerOutfitController as AvatarOutfitController | undefined)

  if (cachedController && hasFace && hasOutline && hasHair) {
    cachedController.applyEquipped(uniform, {ridingEbike: false, autoHelmetOnRide: false})
    return cachedController
  }

  const mat = bodyMesh.material as THREE.MeshStandardMaterial
  if (!mat?.userData?.clothing) {
    bodyMesh.geometry = bodyMesh.geometry.clone()
    const clonedMat =
      mat instanceof THREE.MeshStandardMaterial
        ? mat.clone()
        : new THREE.MeshStandardMaterial({vertexColors: true})
    streetShading(clonedMat, true)
    bodyMesh.material = clonedMat
  }

  if (!rootGroup.getObjectByName('creator-hair') && !rootGroup.userData.creatorHair) {
    if (hairLibraryScene && hairLibraryScene.getObjectByName(avatar.hair)) {
      rootGroup.userData.creatorHair = hairstyle(avatar, hairLibraryScene)
    } else {
      rootGroup.userData.creatorHair = buildFallbackCreatorHair(avatar)
    }
  }

  const ctrl = cachedController ?? styleCharacter(rootGroup, rig, avatar)
  rootGroup.userData.officerOutfitController = ctrl
  ctrl.applyEquipped(uniform, {ridingEbike: false, autoHelmetOnRide: false})
  return ctrl
}

/**
 * Colors `#389` sculpted hands & tapered fingers matte cloth white (`#f2f2ee`, `r10-officer-guide.md` §4)
 * with subtle `#e4e7ec` cuff edge directly on `bodyMesh` (`+0` extra draw calls, outlined by `creator-body-outline`
 * with `_olHand` thin contour, zero clipping across all finger curls!).
 */
function paintMatteWhiteClothGloves(
  figureRoot: THREE.Object3D,
  bodyMesh: THREE.SkinnedMesh,
  partZones: Uint8Array | undefined,
): void {
  const colAttr = bodyMesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined
  const posAttr = bodyMesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const si = bodyMesh.geometry.getAttribute('skinIndex') as THREE.BufferAttribute | undefined
  const sw = bodyMesh.geometry.getAttribute('skinWeight') as THREE.BufferAttribute | undefined
  if (!colAttr || !posAttr || !si || !sw) return

  const cGloveCloth = new THREE.Color('#f2f2ee')
  const cGloveCuff = new THREE.Color('#e3e6ea')
  const bones = bodyMesh.skeleton?.bones ?? []

  for (let i = 0; i < colAttr.count; i++) {
    const z = partZones ? partZones[i] : OUTFIT_ZONE.LOCKED_SKIN
    if (z !== OUTFIT_ZONE.LOCKED_SKIN) continue

    const ax = Math.abs(posAttr.getX(i))
    let bestIdx = si.getX(i)
    let bestW = sw.getX(i)
    if (sw.getY(i) > bestW) {
      bestIdx = si.getY(i)
      bestW = sw.getY(i)
    }
    if (sw.getZ(i) > bestW) {
      bestIdx = si.getZ(i)
      bestW = sw.getZ(i)
    }
    if (sw.getW(i) > bestW) {
      bestIdx = si.getW(i)
    }
    const bName = bones[Math.round(bestIdx)]?.name ?? ''
    if (HAND_BONE_RE.test(bName) || ax > 0.720) {
      colAttr.setXYZ(i, cGloveCloth.r, cGloveCloth.g, cGloveCloth.b)
    } else if (ax >= 0.706 && ax <= 0.720) {
      colAttr.setXYZ(i, cGloveCuff.r, cGloveCuff.g, cGloveCuff.b)
    }
  }
  colAttr.needsUpdate = true
  figureRoot.userData.officerUniformActive = true
}

function findParentBoneName(node: THREE.Object3D | null): string {
  let cur: THREE.Object3D | null = node
  while (cur) {
    if ((cur as THREE.Bone).isBone || /^(head|spine_\d+|pelvis|hand_[lr]|upperarm_[lr]|foot_[lr])$/.test(cur.name)) {
      return cur.name
    }
    cur = cur.parent
  }
  return ''
}

function countModelMetrics(root: THREE.Object3D): {
  triangleCount: number
  meshCount: number
  estimatedDrawCalls: number
  dynamicLightCount: number
} {
  let triangleCount = 0
  let meshCount = 0
  let estimatedDrawCalls = 0
  let dynamicLightCount = 0

  root.traverse(node => {
    if ('isLight' in node && (node as THREE.Light).isLight) {
      dynamicLightCount++
    }
    if (!(node instanceof THREE.Mesh) || !node.visible) return
    let anc: THREE.Object3D | null = node.parent
    while (anc && anc !== root) {
      if (!anc.visible) return
      anc = anc.parent
    }
    meshCount++
    const mats = Array.isArray(node.material) ? node.material : [node.material]
    estimatedDrawCalls += Math.max(1, mats.length)

    const g = node.geometry
    const idx = g.getIndex()
    const drawCount = g.drawRange.count
    if (idx) {
      const effectiveIdx = Number.isFinite(drawCount) ? Math.min(idx.count, drawCount) : idx.count
      triangleCount += Math.floor(effectiveIdx / 3)
    } else {
      const pos = g.getAttribute('position')
      if (pos) {
        const effectiveVerts = Number.isFinite(drawCount) ? Math.min(pos.count, drawCount) : pos.count
        triangleCount += Math.floor(effectiveVerts / 3)
      }
    }
  })

  return {triangleCount, meshCount, estimatedDrawCalls, dynamicLightCount}
}

export function applyOfficerLook(
  figureRoot: THREE.Object3D,
  options?: ApplyOfficerLookOptions,
): OfficerLookHandle {
  const prev = ACTIVE_HANDLES.get(figureRoot)
  if (prev) prev.dispose()

  const rootGroup = figureRoot as THREE.Group
  const savedScale = figureRoot.scale.clone()
  const rig = ensureAvatarRig(rootGroup)
  if (typeof options?.scale === 'number' && Number.isFinite(options.scale) && options.scale > 0) {
    figureRoot.scale.setScalar(options.scale)
  } else if (savedScale.lengthSq() > 0 && Math.abs(savedScale.x - 1) > 1e-4) {
    figureRoot.scale.copy(savedScale)
  }

  stripLegacyCharacterOverlays(figureRoot)

  const bodyMesh = rig.skinnedMesh ?? findPrimarySkinnedMesh(figureRoot)
  if (!bodyMesh) {
    throw new Error('applyOfficerLook requires a rigged figure GLB containing a SkinnedMesh')
  }

  const savedJoints = AVATAR_JOINT_NAMES.map(name => {
    const rot = rig.joints[name]?.rotation
    return [name, rot ? ([rot.x, rot.y, rot.z] as const) : null] as const
  })
  const hadPose = savedJoints.some(([, r]) => r !== null && (r[0] !== 0 || r[1] !== 0 || r[2] !== 0))
  rig.clearPose()
  figureRoot.updateMatrixWorld(true)

  const avatar = options?.avatar ?? DEFAULT_OFFICER_AVATAR
  const uniform = options?.uniformOutfit ?? resolveOfficerUniformOutfit()
  const outfitController = ensurePlayerPipelineStyled(
    rootGroup,
    rig,
    bodyMesh,
    avatar,
    uniform,
    options?.outfitController,
    options?.hairLibraryScene,
  )

  const partInfo = partitionCityWalkerGeometry(bodyMesh)
  paintMatteWhiteClothGloves(figureRoot, bodyMesh, partInfo?.zones)

  const prevApplyEquipped = outfitController.applyEquipped.bind(outfitController)
  outfitController.applyEquipped = (nextEquipped, opts) => {
    prevApplyEquipped(nextEquipped, opts)
    paintMatteWhiteClothGloves(figureRoot, bodyMesh, partInfo?.zones)
  }

  const fingerPoses = buildOfficerFingerPoses(figureRoot, bodyMesh)

  const headBone = figureRoot.getObjectByName('head') ?? rig.attachments.head ?? figureRoot
  const spine3Bone =
    figureRoot.getObjectByName('spine_03') ??
    figureRoot.getObjectByName('spine_02') ??
    rig.attachments.torso ??
    figureRoot
  const pelvisBone =
    figureRoot.getObjectByName('pelvis') ??
    figureRoot.getObjectByName('spine_01') ??
    spine3Bone
  const handLBone = figureRoot.getObjectByName('hand_l') ?? figureRoot
  const handRBone = figureRoot.getObjectByName('hand_r') ?? figureRoot
  const upperArmLBone = figureRoot.getObjectByName('upperarm_l') ?? null
  const upperArmRBone = figureRoot.getObjectByName('upperarm_r') ?? null
  const footLBone = figureRoot.getObjectByName('foot_l') ?? null
  const footRBone = figureRoot.getObjectByName('foot_r') ?? null

  const headMount = ensureCharacterAlignedBoneMount(figureRoot, headBone, 'officer_mount_head')
  const torsoMount = ensureCharacterAlignedBoneMount(figureRoot, spine3Bone, 'officer_mount_spine_03')
  const beltMount = ensureCharacterAlignedBoneMount(figureRoot, pelvisBone, 'officer_mount_pelvis')
  const gloveLMount = ensureCharacterAlignedBoneMount(figureRoot, handLBone, 'officer_mount_hand_l')
  const gloveRMount = ensureCharacterAlignedBoneMount(figureRoot, handRBone, 'officer_mount_hand_r')

  // Prefer Neon's `outfit_hat_traffic_police_cap` mounted on `rig.attachments.head` (keeps `fitHairUnderPoliceCap` sideburns!)
  const outfitSnap = outfitController.getSnapshot()
  let outfitHatMesh: THREE.Object3D | null = null
  if (outfitSnap.attachedHat && rig.attachments.head) {
    for (const child of rig.attachments.head.children) {
      if (child.visible && child.name.startsWith('outfit_hat_')) {
        outfitHatMesh = child
        break
      }
    }
  }

  let fallbackCapBuilt: ReturnType<typeof buildFallbackPoliceCap> | null = null
  let activeCapObject: THREE.Object3D
  let capMarker: THREE.Object3D
  if (outfitHatMesh) {
    activeCapObject = outfitHatMesh
    capMarker = new THREE.Object3D()
    capMarker.name = 'officer_peaked_cap'
    headMount.add(capMarker)
  } else {
    fallbackCapBuilt = buildFallbackPoliceCap(bodyMesh, headMount)
    headMount.add(fallbackCapBuilt.mesh)
    activeCapObject = fallbackCapBuilt.mesh
    capMarker = fallbackCapBuilt.mesh
    const hairObj = figureRoot.getObjectByName('creator-hair')
    if (hairObj) hairObj.visible = false
  }

  const faceGroup = figureRoot.getObjectByName('creator-face')
  const restFaceMesh = (faceGroup?.getObjectByName('rest-face') ?? null) as THREE.Mesh | null
  if (!faceGroup || !restFaceMesh) {
    throw new Error('applyOfficerLook requires creator-face (rest-face) from styleCharacter pipeline')
  }

  const dutyKitBuilt = buildOfficerUpperDutyKit(bodyMesh, torsoMount)
  torsoMount.add(dutyKitBuilt.mesh)

  const radioMarker = new THREE.Object3D()
  radioMarker.name = 'officer_walkie_talkie'
  radioMarker.position.set(-0.132, 0.188, -0.036)
  torsoMount.add(radioMarker)

  const badgeMarker = new THREE.Object3D()
  badgeMarker.name = 'officer_chest_badge'
  badgeMarker.position.set(-0.066, 0.048, -0.115)
  torsoMount.add(badgeMarker)

  const whistleChainMarker = new THREE.Object3D()
  whistleChainMarker.name = 'officer_whistle_chain'
  whistleChainMarker.position.set(0.082, 0.112, -0.095)
  torsoMount.add(whistleChainMarker)

  const gloveLMarker = new THREE.Object3D()
  gloveLMarker.name = 'officer_glove_l'
  gloveLMount.add(gloveLMarker)

  const gloveRMarker = new THREE.Object3D()
  gloveRMarker.name = 'officer_glove_r'
  gloveRMount.add(gloveRMarker)

  mainDetail(figureRoot)

  let leftHandMode: 'relaxed' | 'thumbs_up' | 'grip' =
    options?.expression && normalizeOfficerFaceExpression(options.expression) === 'thumbs_up' ? 'thumbs_up' : 'relaxed'
  let rightHandMode: 'relaxed' | 'thumbs_up' | 'grip' = 'relaxed'

  const applyFingerList = (list: typeof fingerPoses.left, mode: 'relaxed' | 'thumbs_up' | 'grip') => {
    for (const item of list) {
      item.bone.quaternion.copy(
        mode === 'thumbs_up' ? item.thumbsUpQuat : mode === 'grip' ? item.gripQuat : item.relaxedQuat,
      )
    }
  }

  let currentExpression: OfficerFaceExpressionId = options?.expression
    ? normalizeOfficerFaceExpression(options.expression)
    : 'serious'
  let handGestureSide: 'left' | 'right' = 'left'
  let armThumbsUpActive = false
  setCreatorExpression(figureRoot, currentExpression)

  const syncActiveFingers = () => {
    if (options?.poseHands === false) return
    applyFingerList(fingerPoses.left, leftHandMode)
    applyFingerList(fingerPoses.right, rightHandMode)
    if (armThumbsUpActive) {
      const armList = handGestureSide === 'left' ? fingerPoses.armThumbsUpLeft : fingerPoses.armThumbsUpRight
      for (const item of armList) {
        item.bone.quaternion.copy(item.targetQuat)
      }
    }
  }

  const prevSyncPose = rig.syncPose.bind(rig)
  rig.syncPose = () => {
    prevSyncPose()
    syncActiveFingers()
  }

  if (hadPose) {
    for (const [name, rot] of savedJoints) {
      if (rot) rig.joints[name]?.rotation.set(rot[0], rot[1], rot[2])
    }
    rig.syncPose()
  } else {
    syncActiveFingers()
  }
  figureRoot.updateMatrixWorld(true)

  let disposed = false

  const handle: OfficerLookHandle = {
    root: figureRoot,
    rig,
    outfitController,
    anchors: Object.freeze({
      head: headMount,
      torso: torsoMount,
      belt: beltMount,
      handL: gloveLMount,
      handR: gloveRMount,
      upperArmL: upperArmLBone,
      upperArmR: upperArmRBone,
      footL: footLBone,
      footR: footRBone,
    }),
    parts: Object.freeze({
      bodyMesh,
      headUnit: activeCapObject,
      faceUnit: restFaceMesh,
      dutyKitUnit: dutyKitBuilt.mesh,
      capMarker,
      faceMarker: faceGroup,
      radioMarker,
      badgeMarker,
      whistleChainMarker,
      gloveLMarker,
      gloveRMarker,
    }),
    getExpression: () => getCreatorExpression(figureRoot),
    setExpression(expr: OfficerFaceExpressionId | string): OfficerFaceExpressionId {
      currentExpression = normalizeOfficerFaceExpression(expr)
      setCreatorExpression(figureRoot, currentExpression)
      leftHandMode = currentExpression === 'thumbs_up' ? 'thumbs_up' : 'relaxed'
      if (currentExpression !== 'thumbs_up') armThumbsUpActive = false
      syncActiveFingers()
      return currentExpression
    },
    setHandGesture(mode: 'relaxed' | 'thumbs_up' | 'grip', side: 'left' | 'right' = 'left') {
      if (side === 'left') leftHandMode = mode
      else rightHandMode = mode
      syncActiveFingers()
    },
    poseThumbsUp(active: boolean, side: 'left' | 'right' = 'left') {
      armThumbsUpActive = active
      handGestureSide = side
      if (side === 'left') leftHandMode = active ? 'thumbs_up' : 'relaxed'
      else rightHandMode = active ? 'thumbs_up' : 'relaxed'
      if (!active) {
        for (const item of [...fingerPoses.armThumbsUpLeft, ...fingerPoses.armThumbsUpRight]) {
          item.bone.quaternion.copy(item.restQuat)
        }
        prevSyncPose()
      }
      syncActiveFingers()
      figureRoot.updateMatrixWorld(true)
    },
    getMetrics(): OfficerLookMetrics {
      const m = countModelMetrics(figureRoot)
      const applied = (figureRoot.userData.appliedOutfit as EquippedOutfit | undefined) ?? null
      return {
        ...m,
        hasCreatorFace: Boolean(figureRoot.getObjectByName('creator-face')),
        hasCreatorHair: Boolean(figureRoot.getObjectByName('creator-hair')),
        hasCreatorBodyOutline: Boolean(figureRoot.getObjectByName('creator-body-outline')),
        hasUniformOutfit: Boolean(applied && figureRoot.userData.officerUniformActive),
        appliedOutfit: applied ? {...applied} : null,
        boneMounts: Object.freeze({
          cap: findParentBoneName(activeCapObject),
          dutyKit: findParentBoneName(dutyKitBuilt.mesh),
          radio: findParentBoneName(radioMarker),
          badge: findParentBoneName(badgeMarker),
          whistleChain: findParentBoneName(whistleChainMarker),
          gloveL: findParentBoneName(gloveLMarker),
          gloveR: findParentBoneName(gloveRMarker),
          shoeL: footLBone?.name ?? 'foot_l',
          shoeR: footRBone?.name ?? 'foot_r',
        }),
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      ACTIVE_HANDLES.delete(figureRoot)
      rig.syncPose = prevSyncPose
      outfitController.applyEquipped = prevApplyEquipped
      for (const item of [
        ...fingerPoses.left,
        ...fingerPoses.right,
        ...fingerPoses.armThumbsUpLeft,
        ...fingerPoses.armThumbsUpRight,
      ]) {
        item.bone.quaternion.copy(item.restQuat)
      }
      setCreatorExpression(figureRoot, 'neutral')
      radioMarker.removeFromParent()
      badgeMarker.removeFromParent()
      whistleChainMarker.removeFromParent()
      gloveLMarker.removeFromParent()
      gloveRMarker.removeFromParent()
      if (capMarker !== activeCapObject) capMarker.removeFromParent()
      fallbackCapBuilt?.dispose()
      dutyKitBuilt.dispose()
    },
  }

  figureRoot.userData.officerLook = handle
  ACTIVE_HANDLES.set(figureRoot, handle)
  return handle
}
