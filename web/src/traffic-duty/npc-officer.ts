import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import type {Avatar} from '../../../lib/avatar'
import {OFFICER_UNIFORM_OUTFIT, type EquippedOutfit} from '../game/catalog'
import {avatar as figureConfig} from '../look/avatar'
import {mainDetail} from '../look/mirror-layer'
import {ensureAvatarRig, type AvatarRig} from '../walk/avatar-rig'
import {characterModel, disposeCharacterParts, styleCharacter} from '../walk/character'
import {setCreatorExpression} from '../walk/creator-face'
import {addOutline, streetShading} from '../walk/creator-ink'
import type {AvatarOutfitController} from '../walk/outfits'
import {
  applyOfficerLook,
  type OfficerLookHandle,
} from './officer-look/index.ts'

let sharedIdleClipPromise: Promise<THREE.AnimationClip | null> | null = null
function loadSharedPlayerIdleClip(): Promise<THREE.AnimationClip | null> {
  if (!sharedIdleClipPromise) {
    sharedIdleClipPromise = new GLTFLoader()
      .loadAsync(figureConfig.path)
      .then(gltf => gltf.animations.find(c => c.name === figureConfig.clips.idle) ?? null)
      .catch(() => null)
  }
  return sharedIdleClipPromise
}

/**
 * High-detail original Jiefang Bridge Traffic Officer NPC + compliant persuasion sign post
 * (`web/src/traffic-duty/npc-officer.ts`).
 *
 * Hard public-web compliance:
 *  - ZERO real police emblem / shield / national insignia
 *  - ZERO real police ID numbers
 *  - Compliant civic guidance copy ("解放桥文明交通劝导站")
 *  - Zero dynamic Three.js lights (uses standard material + subtle emissive wand tint)
 */

export const JIEFANG_OFFICER_SPOT = {
  x: -266.2,
  y: 151.85,
  z: 26.2,
  /** -Z forward points WNW across the Jiefang Bridge west head cycleway & entrance. */
  yaw: 0.80,
} as const

/**
 * Shizijie NE refuge island police-kiosk apron (`KIOSK_CENTER = (27.2, -2.4)` in shizijie local space).
 * Verified via `shizijie_layout.islands()`: officer stands 0.80 m in front of kiosk glass,
 * 0.87 m clear of hedge, and 1.25 m inside NE island curb (`>= 0.4 m` margin); sign sits beside at 0.73 m curb margin.
 */
export const SHIZIJIE_OFFICER_SPOT = {
  x: -854.38,
  y: 151.45,
  z: -170.57,
  /** -Z forward faces WSW squarely into Shizijie intersection approaches. */
  yaw: 2.15,
  signX: -853.02,
  signZ: -169.73,
  signYaw: 2.59,
} as const

export type GroundSampler = (x: number, z: number, reference?: number, car?: boolean) => number | undefined

export interface JiefangOfficerOptions {
  x?: number
  y?: number
  z?: number
  yaw?: number
  signX?: number
  signZ?: number
  signYaw?: number
  stationTitle?: string
  groupName?: string
  /** Skip async GLB load (useful in pure Node/unit environments without fetch). */
  proceduralOnly?: boolean
}

export type OfficerVisualState = 'available' | 'talking' | 'handoff' | 'active'

export type OfficerExpressionId = 'serious' | 'smile' | 'remind' | 'thumbs_up'

export const OFFICER_EXPRESSION_IDS: readonly OfficerExpressionId[] = Object.freeze([
  'serious',
  'smile',
  'remind',
  'thumbs_up',
])

export function normalizeOfficerExpression(raw?: string | null): OfficerExpressionId {
  if (raw === 'smile' || raw === 'remind' || raw === 'thumbs_up' || raw === 'serious') return raw
  if (raw === 'handoff') return 'thumbs_up'
  if (raw === 'curious') return 'remind'
  return 'serious'
}

/**
 * Clamps sampled ground elevation to the bridge/sidewalk deck band `[fallbackY - 1.0, fallbackY + 2.5]`.
 * Prevents lower Binjiang Road / riverbank raycasts (~146m) from burying the Jiefang Bridge officer under the deck.
 */
export function resolveDeckGroundY(sampled: number | undefined, fallbackY: number): number {
  if (sampled === undefined || !Number.isFinite(sampled)) return fallbackY
  if (sampled < fallbackY - 1.0 || sampled > fallbackY + 2.5) return fallbackY
  return sampled
}

export interface JiefangOfficerHandle {
  readonly group: THREE.Group
  readonly officerRoot: THREE.Group
  readonly signGroup: THREE.Group
  readonly beaconGroup: THREE.Group
  readonly position: Readonly<{x: number; y: number; z: number}>
  readonly signPosition: Readonly<{x: number; y: number; z: number}>
  readonly phase: () => 'go' | 'stop' | 'guide' | 'watch'
  setDutyState(state: OfficerVisualState): void
  setExpression(expr: OfficerExpressionId | string): void
  setLookTarget(pos: {x: number; y?: number; z: number} | null): void
  headWorld(out?: THREE.Vector3): THREE.Vector3
  update(dt: number, elapsedSec?: number): void
  dispose(): void
}

export interface AllDutyOfficersHandle {
  readonly officers: Readonly<{
    jiefang: JiefangOfficerHandle
    shizijie: JiefangOfficerHandle
  }>
  setJiefangState(state: OfficerVisualState): void
  update(dt: number, elapsedSec?: number): void
  dispose(): void
}

interface ColoredPart {
  geom: THREE.BufferGeometry
  hex: string
}

function mergeColoredMesh(
  parts: readonly ColoredPart[],
  name: string,
  opts?: {doubleSide?: boolean; emissiveHex?: string; emissiveIntensity?: number; roughness?: number},
): THREE.Mesh {
  let total = 0
  const expanded: {pos: THREE.BufferAttribute; norm: THREE.BufferAttribute; col: THREE.Color}[] = []
  for (const part of parts) {
    const g = part.geom.index ? part.geom.toNonIndexed() : part.geom
    if (!g.getAttribute('normal')) g.computeVertexNormals()
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    const norm = g.getAttribute('normal') as THREE.BufferAttribute
    total += pos.count
    expanded.push({pos, norm, col: new THREE.Color(part.hex)})
    if (g !== part.geom) g.dispose()
    part.geom.dispose()
  }

  const posOut = new Float32Array(total * 3)
  const normOut = new Float32Array(total * 3)
  const colOut = new Float32Array(total * 3)
  let offset = 0
  for (const seg of expanded) {
    for (let i = 0; i < seg.pos.count; i++) {
      const idx = (offset + i) * 3
      posOut[idx] = seg.pos.getX(i)
      posOut[idx + 1] = seg.pos.getY(i)
      posOut[idx + 2] = seg.pos.getZ(i)
      normOut[idx] = seg.norm.getX(i)
      normOut[idx + 1] = seg.norm.getY(i)
      normOut[idx + 2] = seg.norm.getZ(i)
      colOut[idx] = seg.col.r
      colOut[idx + 1] = seg.col.g
      colOut[idx + 2] = seg.col.b
    }
    offset += seg.pos.count
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(posOut, 3))
  geom.setAttribute('normal', new THREE.BufferAttribute(normOut, 3))
  geom.setAttribute('color', new THREE.BufferAttribute(colOut, 3))
  geom.computeBoundingBox()
  geom.computeBoundingSphere()

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: opts?.roughness ?? 0.65,
    metalness: 0.1,
    flatShading: true,
    side: opts?.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    ...(opts?.emissiveHex
      ? {emissive: new THREE.Color(opts.emissiveHex), emissiveIntensity: opts.emissiveIntensity ?? 0.55}
      : {}),
  })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.name = name
  return mesh
}

/** Handheld traffic command LED wand merged into 1 single cel-shaded Mesh (`+1` draw call total). */
function buildTrafficWand(): THREE.Group {
  const grp = new THREE.Group()
  grp.name = 'officer_traffic_wand'

  const handle = new THREE.CylinderGeometry(0.014, 0.014, 0.114, 10)
  handle.translate(0, 0.031, 0)
  const pommel = new THREE.SphereGeometry(0.015, 8, 6)
  pommel.translate(0, -0.028, 0)
  const collar = new THREE.CylinderGeometry(0.021, 0.018, 0.022, 10)
  collar.translate(0, 0.098, 0)
  const glowRod = new THREE.CylinderGeometry(0.016, 0.016, 0.255, 10)
  glowRod.translate(0, 0.236, 0)

  const wandMesh = mergeColoredMesh(
    [
      {geom: handle, hex: '#14171d'},
      {geom: pommel, hex: '#14171d'},
      {geom: collar, hex: '#eef3f7'},
      {geom: glowRod, hex: '#f23a24'},
    ],
    'officer_traffic_wand_mesh',
    {roughness: 0.45},
  )
  streetShading(wandMesh.material as THREE.MeshStandardMaterial)
  addOutline(wandMesh, 0.0035)
  grp.add(wandMesh)
  return grp
}

export const OFFICER_AVATAR: Avatar = {
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
}

interface FingerPoseTarget {
  bone: THREE.Object3D
  target: THREE.Quaternion
}

/** Precomputes exact anatomical fist-grip quaternions matching camera-hold.ts bind-space curls. */
function buildOfficerRightGrip(figure: THREE.Object3D): FingerPoseTarget[] {
  const entries: FingerPoseTarget[] = []
  const bindPos = new Map<string, THREE.Vector3>()
  const bindRot = new Map<string, THREE.Quaternion>()
  figure.traverse(node => {
    if (bindRot.size || !(node instanceof THREE.SkinnedMesh)) return
    node.skeleton.bones.forEach((b, i) => {
      const m = new THREE.Matrix4().copy(node.skeleton.boneInverses[i]).invert()
      bindPos.set(b.name, new THREE.Vector3().setFromMatrixPosition(m))
      bindRot.set(b.name, new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(m)))
    })
  })
  if (!bindRot.size) return entries

  const identity = new THREE.Quaternion()
  const axisZ = new THREE.Vector3(0, 0, 1)
  const addJoint = (name: string, parentName: string, delta: THREE.Quaternion, parentDelta: THREE.Quaternion) => {
    const bone = figure.getObjectByName(name)
    const childB = bindRot.get(name)
    const parentB = bindRot.get(parentName)
    if (!bone || !childB || !parentB) return
    const local = parentB
      .clone()
      .invert()
      .multiply(parentDelta.clone().invert())
      .multiply(delta)
      .multiply(childB)
    entries.push({bone, target: local})
  }

  const curls: Record<string, readonly [number, number, number]> = {
    index: [1.18, 1.38, 1.05],
    middle: [1.22, 1.42, 1.08],
    ring: [1.24, 1.42, 1.08],
    pinky: [1.24, 1.36, 1.02],
  }
  for (const [finger, bends] of Object.entries(curls)) {
    let parentDelta = identity.clone()
    let parentName = 'hand_r'
    for (let i = 1; i <= 3; i++) {
      const name = `${finger}_0${i}_r`
      const turn = new THREE.Quaternion().setFromAxisAngle(axisZ, bends[i - 1])
      const delta = parentDelta.clone().multiply(turn)
      addJoint(name, parentName, delta, parentDelta)
      parentDelta = delta
      parentName = name
    }
  }

  const t1 = bindPos.get('thumb_01_r')
  const t2 = bindPos.get('thumb_02_r')
  const t3 = bindPos.get('thumb_03_r')
  const t4 = bindPos.get('thumb_04_leaf_r')
  if (t1 && t2 && t3 && t4) {
    const seg1 = t2.clone().sub(t1).normalize()
    const d1 = new THREE.Quaternion().setFromUnitVectors(seg1, new THREE.Vector3(-0.995, 0.093, -0.040).normalize())
    addJoint('thumb_01_r', 'hand_r', d1, identity)

    const seg2 = t3.clone().sub(t2).applyQuaternion(d1).normalize()
    const d2 = new THREE.Quaternion().setFromUnitVectors(seg2, new THREE.Vector3(-0.754, -0.615, 0.232).normalize()).multiply(d1)
    addJoint('thumb_02_r', 'thumb_01_r', d2, d1)

    const seg3 = t4.clone().sub(t3).applyQuaternion(d2).normalize()
    const d3 = new THREE.Quaternion().setFromUnitVectors(seg3, new THREE.Vector3(0.643, -0.761, 0.086).normalize()).multiply(d2)
    addJoint('thumb_03_r', 'thumb_02_r', d3, d2)
  }
  return entries
}

/**
 * Styles an already-loaded `characterModel(OFFICER_AVATAR)` scene through the unified player pipeline:
 * `ensureAvatarRig(figure)` -> `styleCharacter(figure, rig, OFFICER_AVATAR)` -> `applyEquipped(OFFICER_UNIFORM_OUTFIT)` -> `applyOfficerLook(...)`.
 */
function mountOfficerWithLook(
  figure: THREE.Group,
  expression: OfficerExpressionId,
  includeWand: boolean,
): {
  look: OfficerLookHandle
  outfitController: AvatarOutfitController
  uniformOutfit: EquippedOutfit
  rightGrips: FingerPoseTarget[]
} {
  const rig = ensureAvatarRig(figure)
  const outfitController = styleCharacter(figure, rig, OFFICER_AVATAR)
  const uniformOutfit: EquippedOutfit = {...OFFICER_UNIFORM_OUTFIT}
  outfitController.applyEquipped(uniformOutfit, {ridingEbike: false, autoHelmetOnRide: false})
  setCreatorExpression(figure, expression)

  const look = applyOfficerLook(figure, {
    avatar: OFFICER_AVATAR,
    outfitController,
    uniformOutfit,
    expression,
    scale: 1.03,
    poseHands: true,
  })

  // Enable BOTH Layer 0 and MAIN_DETAIL_LAYER (3) on every node
  figure.traverse(n => {
    n.layers.enable(0)
    n.layers.enable(3)
  })

  const rightGrips: FingerPoseTarget[] = []
  if (includeWand) {
    look.setHandGesture('grip', 'right')
    // Mount baton inside character-aligned `hand_r` palm pocket (`spec.md` §5.2: avoid camera-tilted `attach_hand_r`)
    const rightHandMount = look.anchors.handR
    if (rightHandMount && !rightHandMount.getObjectByName('officer_traffic_wand')) {
      const wand = buildTrafficWand()
      // Exact measured center of curled 4-finger grip channel in `officer_mount_hand_r`:
      // (x = +0.086, y = -0.028), channel axis runs from pinky (+Z) to index (-Z) out the front of the fist!
      wand.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-0.06, 0.14, -0.988).normalize())
      wand.position.set(0.086, -0.028, 0.012)
      wand.traverse(n => {
        n.layers.enable(0)
        n.layers.enable(3)
      })
      rightHandMount.add(wand)
    }
  }
  return {look, outfitController, uniformOutfit, rightGrips}
}

export interface OfficerPortraitModelHandle {
  readonly group: THREE.Group
  setExpression(expr: OfficerExpressionId | string): void
  headWorld(out?: THREE.Vector3): THREE.Vector3
  dispose(): void
}

/**
 * Builds an isolated rigged traffic officer model via the unified player character pipeline
 * (`characterModel` -> `ensureAvatarRig` -> `styleCharacter` -> `applyEquipped(OFFICER_UNIFORM_OUTFIT)` -> `applyOfficerLook`)
 * for offscreen bust/expression portrait rendering.
 */
export async function buildOfficerPortraitModel(): Promise<OfficerPortraitModelHandle> {
  const root = new THREE.Group()
  root.name = 'officer_portrait_root'
  let riggedModel: THREE.Group | null = null
  let rigged: AvatarRig | null = null
  let lookHandle: OfficerLookHandle | null = null
  let outfitCtrl: AvatarOutfitController | null = null
  let thumbsUpPosed = false

  const loaded = await characterModel(OFFICER_AVATAR)
  if (loaded?.scene) {
    const modelScene = loaded.scene
    modelScene.name = 'officer_portrait_rig'
    const applied = mountOfficerWithLook(modelScene, 'serious', false)
    lookHandle = applied.look
    outfitCtrl = applied.outfitController
    rigged = applied.look.rig
    riggedModel = modelScene
    root.add(modelScene)
  }

  function applyExpr(rawExpr: OfficerExpressionId | string): void {
    const isNeutral = typeof rawExpr === 'string' && rawExpr.trim().toLowerCase() === 'neutral'
    const expr = normalizeOfficerExpression(rawExpr)
    if (!rigged || !riggedModel || !lookHandle) return
    const wantThumbs = !isNeutral && expr === 'thumbs_up'
    if (thumbsUpPosed && !wantThumbs) {
      lookHandle.poseThumbsUp(false, 'left')
      thumbsUpPosed = false
    }
    const j = rigged.joints
    j.Hips?.rotation.set(0, 0, 0)
    j.ThighL?.rotation.set(0, 0, -0.02)
    j.ThighR?.rotation.set(0, 0, 0.02)
    j.ShinL?.rotation.set(0, 0, 0)
    j.ShinR?.rotation.set(0, 0, 0)
    j.ArmR?.rotation.set(0.14, 0, 0.14)
    j.ForearmR?.rotation.set(0.32, 0, 0)
    if (wantThumbs) {
      j.Torso?.rotation.set(0.03, -0.05, 0)
      j.Head?.rotation.set(0.03, -0.04, 0.03)
      j.ArmL?.rotation.set(0.12, 0, -0.14)
      j.ForearmL?.rotation.set(0.24, 0, 0)
    } else if (!isNeutral && expr === 'remind') {
      j.Torso?.rotation.set(0.03, 0.04, 0)
      j.Head?.rotation.set(0.04, -0.05, -0.03)
      j.ArmL?.rotation.set(0.14, -0.06, -0.15)
      j.ForearmL?.rotation.set(0.38, 0.04, 0)
    } else if (!isNeutral && expr === 'smile') {
      j.Torso?.rotation.set(0.02, -0.04, 0)
      j.Head?.rotation.set(0.03, 0.04, 0.03)
      j.ArmL?.rotation.set(0.08, 0, -0.14)
      j.ForearmL?.rotation.set(0.24, 0, 0)
    } else {
      j.Torso?.rotation.set(0, 0, 0)
      j.Head?.rotation.set(-0.02, 0.02, 0)
      j.ArmL?.rotation.set(0.06, 0, -0.14)
      j.ForearmL?.rotation.set(0.20, 0, 0)
    }
    lookHandle.setExpression(isNeutral ? 'neutral' : expr)
    if (wantThumbs) {
      lookHandle.poseThumbsUp(true, 'left')
      thumbsUpPosed = true
    } else {
      rigged.syncPose()
    }
    root.updateMatrixWorld(true)
  }

  applyExpr('serious')

  return {
    group: root,
    setExpression: applyExpr,
    headWorld(out = new THREE.Vector3()) {
      const head = lookHandle?.anchors.head ?? rigged?.attachments.head
      if (head) {
        head.getWorldPosition(out)
        out.y += 0.05
        return out
      }
      return out.set(0, 1.62, 0)
    },
    dispose() {
      lookHandle?.dispose()
      lookHandle = null
      outfitCtrl?.dispose()
      outfitCtrl = null
      root.removeFromParent()
      if (riggedModel) {
        disposeCharacterParts(riggedModel)
        riggedModel.traverse(node => {
          if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose()
        })
      }
    },
  }
}

/** Immediate rounded procedural articulated officer shown before figure_m.glb finishes loading (or in headless Node). */
function buildFallbackOfficer(): {root: THREE.Group; armL: THREE.Group; armR: THREE.Group; head: THREE.Group} {
  const root = new THREE.Group()
  root.name = 'officer_fallback'
  const baseParts: ColoredPart[] = []
  for (const s of [-1, 1]) {
    baseParts.push(
      {geom: new THREE.CylinderGeometry(0.07, 0.055, 0.80, 8).translate(s * 0.10, 0.46, 0), hex: '#182538'},
      {geom: new THREE.CylinderGeometry(0.058, 0.058, 0.05, 8).translate(s * 0.10, 0.25, 0), hex: '#f0f5f8'},
      {geom: new THREE.CapsuleGeometry(0.05, 0.11, 2, 6).rotateX(Math.PI / 2).translate(s * 0.10, 0.05, -0.03), hex: '#14181e'},
    )
  }
  baseParts.push(
    {geom: new THREE.CapsuleGeometry(0.16, 0.34, 3, 8).translate(0, 1.14, 0), hex: '#e2f524'},
    {geom: new THREE.CylinderGeometry(0.168, 0.168, 0.06, 10).translate(0, 1.07, 0), hex: '#f0f5f8'},
    {geom: new THREE.CylinderGeometry(0.168, 0.168, 0.06, 10).translate(0, 1.28, 0), hex: '#f0f5f8'},
    {geom: new THREE.CylinderGeometry(0.172, 0.172, 0.05, 10).translate(0, 0.92, 0), hex: '#eef2ee'},
    {geom: new THREE.CylinderGeometry(0.055, 0.06, 0.09, 7).translate(0, 1.44, 0), hex: '#dfb08a'},
  )
  root.add(mergeColoredMesh(baseParts, 'officer_fallback_body'))

  const head = new THREE.Group()
  head.position.set(0, 1.50, 0)
  head.add(
    mergeColoredMesh(
      [
        {geom: new THREE.IcosahedronGeometry(0.12, 1).translate(0, 0.05, 0), hex: '#dfb08a'},
        {geom: new THREE.CylinderGeometry(0.132, 0.112, 0.068, 16).translate(0, 0.172, 0.008), hex: '#f8faf6'},
        {geom: new THREE.CylinderGeometry(0.116, 0.118, 0.044, 16).translate(0, 0.122, 0.012), hex: '#162233'},
        {geom: new THREE.CylinderGeometry(0.145, 0.145, 0.010, 12, 1, false, Math.PI * 0.64, Math.PI * 0.72).translate(0, 0.104, -0.010), hex: '#111822'},
      ],
      'officer_fallback_head',
    ),
  )
  root.add(head)

  const makeArm = (s: -1 | 1, withWand: boolean) => {
    const arm = new THREE.Group()
    arm.position.set(s * 0.21, 1.38, 0)
    arm.add(mergeColoredMesh([
      {geom: new THREE.CylinderGeometry(0.048, 0.040, 0.44, 7).translate(0, -0.22, 0), hex: '#182538'},
      {geom: new THREE.SphereGeometry(0.044, 6, 5).translate(0, -0.46, 0), hex: '#f2f4ef'},
    ], withWand ? 'officer_fallback_arm_r' : 'officer_fallback_arm_l'))
    if (withWand) {
      const wand = buildTrafficWand()
      wand.rotation.set(Math.PI * 0.48, 0, 0)
      wand.position.set(0, -0.46, -0.02)
      arm.add(wand)
    }
    return arm
  }
  const armL = makeArm(-1, false)
  const armR = makeArm(1, true)
  root.add(armL, armR)
  return {root, armL, armR, head}
}

/** Creates high-resolution compliant persuasion sign texture on canvas when DOM exists. */
function buildPersuasionSignTexture(stationTitle = '解放桥文明交通劝导站'): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 640
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // Deep jade-slate panel background
  ctx.fillStyle = '#182825'
  ctx.fillRect(0, 0, 512, 640)

  // Outer lime-yellow border
  ctx.strokeStyle = '#e2f524'
  ctx.lineWidth = 14
  ctx.strokeRect(18, 18, 476, 604)

  // Top header bar
  ctx.fillStyle = '#e2f524'
  ctx.fillRect(25, 25, 462, 110)

  ctx.fillStyle = '#152220'
  ctx.textAlign = 'center'
  ctx.font = 'bold 40px "Noto Serif SC", "PingFang SC", serif'
  ctx.fillText(stationTitle, 256, 76)
  ctx.font = 'bold 22px "Noto Serif SC", "PingFang SC", sans-serif'
  ctx.fillText('GUILIN TRAFFIC PERSUASION POST', 256, 114)

  // Icon 1: Safety Helmet vector icon
  ctx.fillStyle = '#243a35'
  ctx.fillRect(46, 165, 420, 130)
  ctx.fillStyle = '#e6b235'
  ctx.beginPath()
  ctx.arc(110, 232, 34, Math.PI, 0)
  ctx.lineTo(152, 242)
  ctx.lineTo(74, 242)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#eef4f8'
  ctx.font = 'bold 30px "Noto Serif SC", "PingFang SC", serif'
  ctx.textAlign = 'left'
  ctx.fillText('骑行请戴安全头盔', 166, 224)
  ctx.fillStyle = '#a8c2ba'
  ctx.font = '22px "Noto Serif SC", "PingFang SC", serif'
  ctx.fillText('未戴头盔 · 文明劝导提醒', 166, 266)

  // Icon 2: Overload / double-riding warning
  ctx.fillStyle = '#243a35'
  ctx.fillRect(46, 320, 420, 130)
  ctx.strokeStyle = '#d94d3a'
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.arc(110, 385, 32, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(88, 363)
  ctx.lineTo(132, 407)
  ctx.stroke()
  ctx.fillStyle = '#eef4f8'
  ctx.font = 'bold 30px "Noto Serif SC", "PingFang SC", serif'
  ctx.fillText('严禁超载 · 禁止双载', 166, 379)
  ctx.fillStyle = '#a8c2ba'
  ctx.font = '22px "Noto Serif SC", "PingFang SC", serif'
  ctx.fillText('电驴限乘 · 单车一人骑行', 166, 421)

  // Footer banner
  ctx.fillStyle = '#1f332e'
  ctx.fillRect(46, 480, 420, 108)
  ctx.fillStyle = '#e2f524'
  ctx.textAlign = 'center'
  ctx.font = 'bold 32px "Noto Serif SC", "PingFang SC", serif'
  ctx.fillText('文明出行 · 礼让斑马线', 256, 526)
  ctx.fillStyle = '#dce7e3'
  ctx.font = '22px "Noto Serif SC", "PingFang SC", serif'
  ctx.fillText('请走非机动车道 · 志愿劝导站', 256, 566)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** Rounded stadium plinth wrapping both sign uprights cleanly. */
function makeSignPlinth(): THREE.ExtrudeGeometry {
  const hw = 0.37, hh = 0.19, r = 0.08
  const s = new THREE.Shape()
  s.moveTo(-hw + r, -hh)
  s.lineTo(hw - r, -hh)
  s.quadraticCurveTo(hw, -hh, hw, -hh + r)
  s.lineTo(hw, hh - r)
  s.quadraticCurveTo(hw, hh, hw - r, hh)
  s.lineTo(-hw + r, hh)
  s.quadraticCurveTo(-hw, hh, -hw, hh - r)
  s.lineTo(-hw, -hh + r)
  s.quadraticCurveTo(-hw, -hh, -hw + r, -hh)
  const g = new THREE.ExtrudeGeometry(s, {depth: 0.044, steps: 1, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.008, bevelSegments: 1, curveSegments: 3})
  g.rotateX(Math.PI / 2)
  g.translate(0, 0.05, 0)
  return g
}

/** Builds the persuasion stand sign + safety cone + side-mounted triangular guidance flag. */
function buildPersuasionPost(stationTitle = '解放桥文明交通劝导站'): {
  signGroup: THREE.Group
  flagPivot: THREE.Group
  disposables: {dispose(): void}[]
} {
  const signGroup = new THREE.Group()
  signGroup.name = 'traffic_persuasion_sign'
  const disposables: {dispose(): void}[] = []

  // Wide unified rounded plinth enclosing both uprights at x = ±0.28 + upright posts + cone
  const frameParts: ColoredPart[] = [
    {geom: makeSignPlinth(), hex: '#262d34'},
    {geom: new THREE.BoxGeometry(0.68, 0.012, 0.024).translate(0, 0.056, -0.155), hex: '#d8ee1e'},
    {geom: new THREE.CylinderGeometry(0.022, 0.024, 1.54, 8).translate(-0.28, 0.81, 0), hex: '#b8c2c8'},
    {geom: new THREE.CylinderGeometry(0.022, 0.024, 1.54, 8).translate(0.28, 0.81, 0), hex: '#b8c2c8'},
    {geom: new THREE.BoxGeometry(0.62, 0.045, 0.055).translate(0, 1.56, 0), hex: '#182825'},
    {geom: new THREE.BoxGeometry(0.60, 0.025, 0.048).translate(0, 0.82, 0), hex: '#182825'},
    // Safety cone tucked right along sidewalk (+u) beside sign plinth (1.6m clear of tactile strip)
    {geom: new THREE.BoxGeometry(0.32, 0.03, 0.32).translate(0.56, 0.015, 0.02), hex: '#22262b'},
    {geom: new THREE.ConeGeometry(0.13, 0.46, 12).translate(0.56, 0.25, 0.02), hex: '#e86624'},
    {geom: new THREE.CylinderGeometry(0.068, 0.095, 0.09, 12, 1, true).translate(0.56, 0.28, 0.02), hex: '#f4f6f8'},
  ]
  const frameMesh = mergeColoredMesh(frameParts, 'persuasion_post_frame', {doubleSide: true, roughness: 0.6})
  signGroup.add(frameMesh)
  disposables.push(frameMesh.geometry, frameMesh.material as THREE.Material)

  // Sign board (front & back face)
  const boardGeom = new THREE.BoxGeometry(0.54, 0.68, 0.028)
  boardGeom.translate(0, 1.19, 0)
  const tex = buildPersuasionSignTexture(stationTitle)
  const faceMat = new THREE.MeshStandardMaterial({
    color: tex ? 0xffffff : 0x182825,
    ...(tex ? {map: tex} : {}),
    roughness: 0.48,
    metalness: 0.08,
  })
  const sideMat = new THREE.MeshStandardMaterial({color: 0x182825, roughness: 0.6})
  // BoxGeometry material order: +x, -x, +y, -y, +z, -z
  const boardMesh = new THREE.Mesh(boardGeom, [sideMat, sideMat, sideMat, sideMat, faceMat, faceMat])
  boardMesh.name = 'persuasion_sign_board'
  signGroup.add(boardMesh)
  disposables.push(boardGeom, faceMat, sideMat)
  if (tex) disposables.push(tex)

  // Clear outer-side mounted triangular guidance flag extending sideways off the right upright (never hidden by board)
  const flagPivot = new THREE.Group()
  flagPivot.position.set(0.30, 1.48, 0.01)
  const flagTri = new THREE.Shape([
    [0.08, -0.02],
    [0.42, 0.14],
    [0.08, 0.24],
  ].map(([x, y]) => new THREE.Vector2(x, y)))
  const pennantGeom = new THREE.ExtrudeGeometry(flagTri, {depth: 0.008, steps: 1, bevelEnabled: false})
  pennantGeom.rotateZ(-0.24)
  pennantGeom.translate(0.01, 0.06, -0.004)

  const flagMesh = mergeColoredMesh(
    [
      {geom: new THREE.CylinderGeometry(0.009, 0.010, 0.48, 6).rotateZ(-0.24).translate(0.06, 0.16, 0), hex: '#cfd6dc'},
      {geom: pennantGeom, hex: '#f5d226'},
    ],
    'persuasion_yellow_flag',
    {doubleSide: true, roughness: 0.55},
  )
  flagPivot.add(flagMesh)
  signGroup.add(flagPivot)
  disposables.push(flagMesh.geometry, flagMesh.material as THREE.Material)

  return {signGroup, flagPivot, disposables}
}

/** High-contrast 3D overhead locator beacon above the officer's cap (zero dynamic Three.js lights). */
function buildOfficerBeacon(): {beaconGroup: THREE.Group; disposables: {dispose(): void}[]} {
  const beaconGroup = new THREE.Group()
  beaconGroup.name = 'officer_overhead_beacon'
  beaconGroup.position.set(0, 2.22, 0)

  const diamond = new THREE.OctahedronGeometry(0.16, 0)
  diamond.scale(0.85, 1.35, 0.85)
  diamond.translate(0, 0.12, 0)
  const chevron = new THREE.ConeGeometry(0.11, 0.22, 4)
  chevron.rotateX(Math.PI)
  chevron.translate(0, -0.14, 0)
  const beaconCore = mergeColoredMesh(
    [
      {geom: diamond, hex: '#e2f524'},
      {geom: chevron, hex: '#f4efe2'},
    ],
    'officer_overhead_beacon_core',
    {emissiveHex: '#cde61c', emissiveIntensity: 0.45, roughness: 0.4},
  )

  const halo = new THREE.TorusGeometry(0.24, 0.022, 6, 20)
  halo.rotateX(Math.PI / 2)
  halo.translate(0, 0.02, 0)
  const haloMesh = mergeColoredMesh(
    [{geom: halo, hex: '#a9503c'}],
    'officer_overhead_beacon_halo',
    {emissiveHex: '#a9503c', emissiveIntensity: 0.35, roughness: 0.45},
  )

  beaconGroup.add(beaconCore, haloMesh)
  return {
    beaconGroup,
    disposables: [
      beaconCore.geometry,
      beaconCore.material as THREE.Material,
      haloMesh.geometry,
      haloMesh.material as THREE.Material,
    ],
  }
}

export function mountJiefangOfficer(
  scene: THREE.Scene,
  groundAt?: GroundSampler,
  opts?: JiefangOfficerOptions,
): JiefangOfficerHandle {
  // Bridge corridor basis (-18.45 deg): keep officer + sign + cone cleanly on wide inner sidewalk pave (>1.6m clear of tactile strip)
  const bx = opts?.x ?? JIEFANG_OFFICER_SPOT.x
  const bz = opts?.z ?? JIEFANG_OFFICER_SPOT.z
  const tx = 0.9486, tz = 0.3165
  const nx = -0.3165, nz = 0.9486
  const ox = opts?.x !== undefined ? bx : bx + tx * 0.15 + nx * 0.65
  const oz = opts?.z !== undefined ? bz : bz + tz * 0.15 + nz * 0.65
  const yaw = opts?.yaw ?? JIEFANG_OFFICER_SPOT.yaw
  const fallbackY = opts?.y ?? JIEFANG_OFFICER_SPOT.y

  // Sign & safety cone sit cleanly side-by-side along bridge sidewalk east (+tx) on level pave@151.85
  const sx = opts?.signX ?? ox + tx * 1.25
  const sz = opts?.signZ ?? oz + tz * 1.25
  const signYaw = opts?.signYaw ?? -0.18

  const group = new THREE.Group()
  group.name = opts?.groupName ?? 'jiefang_traffic_officer_post'

  const officerRoot = new THREE.Group()
  officerRoot.name = `${group.name}_officer`
  const initY = resolveDeckGroundY(groundAt?.(ox, oz, fallbackY, false), fallbackY)
  officerRoot.position.set(ox, initY, oz)
  officerRoot.rotation.set(0, yaw, 0)
  group.add(officerRoot)

  const fallback = buildFallbackOfficer()
  officerRoot.add(fallback.root)

  const beacon = buildOfficerBeacon()
  officerRoot.add(beacon.beaconGroup)

  const {signGroup, flagPivot, disposables} = buildPersuasionPost(opts?.stationTitle ?? '解放桥文明交通劝导站')
  disposables.push(...beacon.disposables)
  const initSignY = resolveDeckGroundY(groundAt?.(sx, sz, initY, false), initY)
  signGroup.position.set(sx, initSignY, sz)
  signGroup.rotation.set(0, signYaw, 0)
  group.add(signGroup)

  scene.add(group)
  mainDetail(group)

  let riggedModel: THREE.Group | null = null
  let rigged: AvatarRig | null = null
  let lookHandle: OfficerLookHandle | null = null
  let outfitCtrl: AvatarOutfitController | null = null
  let idleMixer: THREE.AnimationMixer | null = null
  let rightGrips: FingerPoseTarget[] = []
  let thumbsUpPosed = false
  let disposed = false
  let clock = 0
  let groundTimer = 0
  let curPhase: 'go' | 'stop' | 'guide' | 'watch' = 'go'
  let visualState: OfficerVisualState = 'available'
  let curExpression: OfficerExpressionId = 'serious'
  let lookTarget: {x: number; y?: number; z: number} | null = null
  let currentYaw = yaw

  if (!opts?.proceduralOnly && typeof fetch === 'function') {
    void Promise.all([characterModel(OFFICER_AVATAR), loadSharedPlayerIdleClip()])
      .then(([loaded, idleClip]) => {
        if (disposed || !loaded?.scene) return
        const modelScene = loaded.scene
        let hasRenderableMesh = false
        modelScene.traverse(node => {
          if (node instanceof THREE.Mesh && node.geometry?.attributes?.position?.count > 0) {
            hasRenderableMesh = true
          }
        })
        if (!hasRenderableMesh) return
        modelScene.name = 'rigged-traffic-officer'
        const applied = mountOfficerWithLook(modelScene, curExpression, true)
        lookHandle = applied.look
        outfitCtrl = applied.outfitController
        rightGrips = applied.rightGrips
        if (idleClip) {
          idleMixer = new THREE.AnimationMixer(modelScene)
          idleMixer.clipAction(idleClip).play()
          idleMixer.update(1.2)
        }
        fallback.root.visible = false
        officerRoot.add(modelScene)
        riggedModel = modelScene
        rigged = applied.look.rig
        applyGesturePose(clock)
      })
      .catch(() => {
        // Keep procedural articulated fallback clearly visible if GLB cannot load
        fallback.root.visible = true
      })
  }

  function applyGesturePose(tCycle: number): void {
    // 8.0 s smooth 4-phase traffic directing cycle
    const t = ((tCycle % 8) + 8) % 8
    let armL: [number, number, number] = [0.05, 0, -0.14]
    let foreL: [number, number, number] = [0.14, 0, 0]
    let armR: [number, number, number] = [0.05, 0, 0.14]
    let foreR: [number, number, number] = [0.18, 0, 0]
    let torso: [number, number, number] = [0, 0, 0]
    let head: [number, number, number] = [0, 0, 0]
    let useThumbsUp = false

    if (visualState === 'handoff' || ((visualState === 'talking') && curExpression === 'thumbs_up')) {
      curPhase = 'guide'
      useThumbsUp = true
      const pulse = Math.sin(tCycle * 3.0) * 0.05
      armL = [0.10, 0, -0.14]
      foreL = [0.22, 0, 0]
      armR = [0.76 + pulse, -0.08, 0.16]
      foreR = [0.35, 0, 0]
      torso = [0.03, 0, 0]
      head = [0.03, 0, 0]
    } else if (visualState === 'talking') {
      curPhase = 'watch'
      const nod = Math.sin(tCycle * 3.4) * 0.06
      const gesture = Math.sin(tCycle * 2.4) * 0.14
      if (curExpression === 'remind') {
        armL = [0.48 + gesture, -0.10, -0.20]
        foreL = [1.05, 0.10, 0.06]
        armR = [0.24, 0, 0.15]
        foreR = [0.38, 0, 0]
        head = [0.07 + nod, Math.sin(tCycle * 1.1) * 0.05, 0]
      } else {
        armL = [0.22 + gesture * 0.6, 0.08, -0.18]
        foreL = [0.46, 0, 0]
        armR = [0.22, 0, 0.15]
        foreR = [0.38, 0, 0]
        head = [nod, Math.sin(tCycle * 1.2) * 0.06, 0]
      }
      torso = [0.02, 0, 0]
    } else if (t < 2.2) {
      curPhase = 'go'
      const u = Math.sin((t / 2.2) * Math.PI)
      const sweep = Math.sin(t * 4.5) * 0.36
      armL = [0.22 * u, 0, -1.18 * u - 0.12]
      foreL = [0.20 * u, 0, 0]
      armR = [1.02 * u, -0.32 * u + sweep, 0.24 * u]
      foreR = [0.82 * u, 0.32 * sweep, 0]
      head = [0, 0.20 * u, 0]
      torso = [0, -0.06 * u, 0]
    } else if (t < 4.0) {
      curPhase = 'stop'
      const u = Math.sin(((t - 2.2) / 1.8) * Math.PI)
      // Clean raised command stop pose within natural shoulder range (zero underarm mesh gap)
      armR = [1.46 * u + 0.10, 0.08 * u, 0.16]
      foreR = [0.46 * u + 0.12, 0, 0]
      armL = [0.08, 0, -0.16]
      foreL = [0.22, 0, 0]
      head = [0, -0.08 * u, 0]
      torso = [-0.02 * u, 0, 0]
    } else if (t < 6.0) {
      curPhase = 'guide'
      const u = Math.sin(((t - 4.0) / 2.0) * Math.PI)
      const wave = Math.sin((t - 4.0) * Math.PI)
      armL = [0.75 * u, 0.45 * wave, -0.78 * u]
      foreL = [0.42 * u, 0, 0]
      armR = [0.38 * u, 0, 0.18]
      foreR = [0.45 * u, 0, 0]
      head = [0, -0.32 * u, 0]
      torso = [0, 0.12 * u, 0]
    } else {
      curPhase = 'watch'
      const breath = Math.sin((t - 6.0) * Math.PI)
      armL = [0.06, 0, -0.15]
      foreL = [0.16, 0, 0]
      armR = [0.18, 0, 0.15]
      foreR = [0.35, 0, 0]
      torso = [-0.02 * breath, 0, 0]
      head = [0.04 * breath, 0.18 * Math.sin((t - 6.0) * 1.5), 0]
    }

    if (rigged && riggedModel) {
      if (lookHandle && !useThumbsUp && thumbsUpPosed) {
        lookHandle.poseThumbsUp(false, 'left')
        thumbsUpPosed = false
      }
      // `r10-officer-guide.md` Red Line 4: When `available` (waiting at bridge head) or `watch`,
      // play the genuine player `idle` clip so left arm & shoulders hang naturally (~5° by trouser seam, never stiff 35° A-pose!)
      // and bend right forearm slightly for relaxed baton carry.
      if (idleMixer && !useThumbsUp && (visualState === 'available' || (visualState === 'active' && curPhase === 'watch'))) {
        curPhase = 'watch'
        // Reset pose first so per-frame forearm delta never accumulates across frames, then sample player `idle` clip!
        rigged.clearPose()
        idleMixer.setTime(0)
        idleMixer.update(1.2 + (tCycle % 4.0))
        const upperR = riggedModel.getObjectByName('upperarm_r')
        const lowerR = riggedModel.getObjectByName('lowerarm_r')
        if (upperR) {
          upperR.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.08))
        }
        if (lowerR) {
          // +X bends right forearm cleanly forward-upward (handR -> [0.24, 0.89, -0.08], well clear of right thigh!)
          lowerR.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.38))
        }
        lookHandle?.setHandGesture('relaxed', 'left')
        lookHandle?.setHandGesture('grip', 'right')
      } else {
        const j = rigged.joints
        j.Hips?.rotation.set(0, 0, 0)
        j.Torso?.rotation.set(...torso)
        j.Head?.rotation.set(...head)
        j.ArmL?.rotation.set(armL[0], armL[1], Math.max(armL[2], curPhase === 'go' || curPhase === 'guide' ? armL[2] : -0.05))
        j.ForearmL?.rotation.set(...foreL)
        j.ArmR?.rotation.set(armR[0], armR[1], Math.min(armR[2], 0.08))
        j.ForearmR?.rotation.set(Math.max(0.28, foreR[0]), foreR[1], foreR[2])
        j.ThighL?.rotation.set(0, 0, -0.02)
        j.ThighR?.rotation.set(0, 0, 0.02)
        j.ShinL?.rotation.set(0, 0, 0)
        j.ShinR?.rotation.set(0, 0, 0)
        if (lookHandle && useThumbsUp) {
          if (!thumbsUpPosed) {
            lookHandle.poseThumbsUp(true, 'left')
            thumbsUpPosed = true
          } else {
            rigged.syncPose()
          }
        } else {
          rigged.syncPose()
        }
        lookHandle?.setHandGesture('grip', 'right')
      }
    } else {
      fallback.armL.rotation.set(armL[0], armL[1], armL[2])
      fallback.armR.rotation.set(armR[0], armR[1], armR[2])
      fallback.head.rotation.set(head[0], head[1], head[2])
    }
  }

  function syncBeacon(tSec: number): void {
    const show = visualState === 'available'
    beacon.beaconGroup.visible = show
    if (show) {
      beacon.beaconGroup.position.y = 2.22 + Math.sin(tSec * 3.2) * 0.08
      beacon.beaconGroup.rotation.y = tSec * 1.35
    }
  }

  function stepLookYaw(dt: number): void {
    let targetYaw = yaw
    if (lookTarget && (visualState === 'talking' || visualState === 'handoff')) {
      const dx = lookTarget.x - officerRoot.position.x
      const dz = lookTarget.z - officerRoot.position.z
      if (dx * dx + dz * dz > 0.09) {
        // Local -Z faces forward -> yaw = atan2(-dx, -dz)
        targetYaw = Math.atan2(-dx, -dz)
      }
    }
    let delta = targetYaw - currentYaw
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    const k = dt > 0 ? Math.min(1, 1 - Math.exp(-9 * dt)) : 1
    currentYaw += delta * k
    officerRoot.rotation.y = currentYaw
  }

  applyGesturePose(0)
  syncBeacon(0)

  return {
    group,
    officerRoot,
    signGroup,
    beaconGroup: beacon.beaconGroup,
    get position() {
      return {x: officerRoot.position.x, y: officerRoot.position.y, z: officerRoot.position.z}
    },
    get signPosition() {
      return {x: signGroup.position.x, y: signGroup.position.y, z: signGroup.position.z}
    },
    phase: () => curPhase,
    setDutyState(state: OfficerVisualState) {
      visualState = state
      if (state === 'handoff') curExpression = 'thumbs_up'
      else if (state === 'available' || state === 'active') curExpression = 'serious'
      lookHandle?.setExpression(curExpression)
      syncBeacon(clock)
      applyGesturePose(clock)
    },
    setExpression(rawExpr: OfficerExpressionId | string) {
      curExpression = normalizeOfficerExpression(rawExpr)
      lookHandle?.setExpression(curExpression)
      applyGesturePose(clock)
    },
    setLookTarget(pos: {x: number; y?: number; z: number} | null) {
      lookTarget = pos ? {x: pos.x, y: pos.y, z: pos.z} : null
      stepLookYaw(0)
    },
    headWorld(out = new THREE.Vector3()) {
      officerRoot.updateMatrixWorld(true)
      const headBone = lookHandle?.anchors.head ?? rigged?.attachments.head ?? fallback.head
      if (headBone) {
        headBone.getWorldPosition(out)
        out.y += 0.05
        return out
      }
      return out.set(officerRoot.position.x, officerRoot.position.y + 1.62, officerRoot.position.z)
    },
    update(dt: number, elapsedSec?: number) {
      if (disposed) return
      const stepDt = Math.max(0, dt)
      clock = elapsedSec ?? clock + stepDt
      stepLookYaw(stepDt)
      applyGesturePose(clock)
      syncBeacon(clock)
      flagPivot.rotation.z = Math.sin(clock * 2.8) * 0.06
      flagPivot.rotation.y = Math.cos(clock * 1.9) * 0.08

      groundTimer -= stepDt
      if (groundAt && groundTimer <= 0) {
        groundTimer = 0.25
        const oy = resolveDeckGroundY(groundAt(ox, oz, fallbackY, false), fallbackY)
        officerRoot.position.y = oy
        const sy = resolveDeckGroundY(groundAt(sx, sz, oy, false), oy)
        signGroup.position.y = sy
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      idleMixer?.stopAllAction()
      idleMixer = null
      lookHandle?.dispose()
      lookHandle = null
      outfitCtrl?.dispose()
      outfitCtrl = null
      group.removeFromParent()
      for (const d of disposables) d.dispose()
      fallback.root.traverse(node => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose()
          for (const m of Array.isArray(node.material) ? node.material : [node.material]) m.dispose()
        }
      })
      if (riggedModel) {
        disposeCharacterParts(riggedModel)
        riggedModel.traverse(node => {
          if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose()
        })
      }
    },
  }
}

export function mountDutyOfficer(
  scene: THREE.Scene,
  zoneId: 'jiefang' | 'shizijie',
  groundAt?: GroundSampler,
  opts?: JiefangOfficerOptions,
): JiefangOfficerHandle {
  if (zoneId === 'shizijie') {
    return mountJiefangOfficer(scene, groundAt, {
      x: SHIZIJIE_OFFICER_SPOT.x,
      y: SHIZIJIE_OFFICER_SPOT.y,
      z: SHIZIJIE_OFFICER_SPOT.z,
      yaw: SHIZIJIE_OFFICER_SPOT.yaw,
      signX: SHIZIJIE_OFFICER_SPOT.signX,
      signZ: SHIZIJIE_OFFICER_SPOT.signZ,
      signYaw: SHIZIJIE_OFFICER_SPOT.signYaw,
      stationTitle: '十字街文明交通劝导站',
      groupName: 'shizijie_traffic_officer_post',
      ...opts,
    })
  }
  return mountJiefangOfficer(scene, groundAt, {
    stationTitle: '解放桥文明交通劝导站',
    groupName: 'jiefang_traffic_officer_post',
    ...opts,
  })
}

export function mountAllDutyOfficers(
  scene: THREE.Scene,
  groundAt?: GroundSampler,
  opts?: Pick<JiefangOfficerOptions, 'proceduralOnly'>,
): AllDutyOfficersHandle {
  const jiefang = mountDutyOfficer(scene, 'jiefang', groundAt, opts)
  const shizijie = mountDutyOfficer(scene, 'shizijie', groundAt, opts)
  return {
    officers: Object.freeze({jiefang, shizijie}),
    setJiefangState(state: OfficerVisualState) {
      jiefang.setDutyState(state)
    },
    update(dt: number, elapsedSec?: number) {
      jiefang.update(dt, elapsedSec)
      shizijie.update(dt, elapsedSec !== undefined ? elapsedSec + 2.5 : undefined)
    },
    dispose() {
      jiefang.dispose()
      shizijie.dispose()
    },
  }
}
