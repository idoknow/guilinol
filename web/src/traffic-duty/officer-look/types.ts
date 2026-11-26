import type * as THREE from 'three'
import type {Avatar} from '../../../../lib/avatar.ts'
import type {EquippedOutfit} from '../../game/catalog.ts'
import type {AvatarRig} from '../../walk/avatar-rig.ts'
import type {CreatorExpression} from '../../walk/creator-face.ts'
import type {AvatarOutfitController} from '../../walk/outfits.ts'

export type OfficerExpressionId = 'serious' | 'smile' | 'remind' | 'thumbs_up'
export type OfficerFaceExpressionId = CreatorExpression

export const OFFICER_EXPRESSION_IDS: readonly OfficerExpressionId[] = Object.freeze([
  'serious',
  'smile',
  'remind',
  'thumbs_up',
])

export const OFFICER_ALL_EXPRESSION_IDS: readonly OfficerFaceExpressionId[] = Object.freeze([
  'neutral',
  'serious',
  'smile',
  'remind',
  'thumbs_up',
])

export function normalizeOfficerExpression(raw?: string | null): OfficerExpressionId {
  if (!raw) return 'serious'
  const key = raw.trim().toLowerCase()
  if (key === 'serious' || key === 'smile' || key === 'remind' || key === 'thumbs_up') {
    return key
  }
  if (key === 'neutral' || key === 'stern' || key === 'strict' || key === 'calm') return 'serious'
  if (key === 'happy' || key === 'warm' || key === 'grin') return 'smile'
  if (key === 'warn' || key === 'speak' || key === 'talk' || key === 'curious' || key === 'alert') {
    return 'remind'
  }
  if (key === 'praise' || key === 'proud' || key === 'handoff' || key === 'good' || key === 'approve') {
    return 'thumbs_up'
  }
  return 'serious'
}

export function normalizeOfficerFaceExpression(raw?: string | null): OfficerFaceExpressionId {
  if (!raw) return 'neutral'
  const key = raw.trim().toLowerCase()
  if (key === 'neutral' || key === 'rest' || key === 'default') return 'neutral'
  return normalizeOfficerExpression(key)
}

export interface ApplyOfficerLookOptions {
  /** Avatar profile passed through the player character pipeline (`OFFICER_AVATAR` by default). */
  avatar?: Avatar
  /** Optional pre-created outfit controller from `styleCharacter(scene, rig, OFFICER_AVATAR)`. */
  outfitController?: AvatarOutfitController | null
  /** Optional uniform outfit override (`OFFICER_UNIFORM_OUTFIT` by default). */
  uniformOutfit?: EquippedOutfit
  /** Optional preloaded `creator-hair.glb` root for offline/Node tests when not loaded via `characterModel`. */
  hairLibraryScene?: THREE.Object3D | null
  /** Initial facial expression (`'neutral' | 'serious' | 'smile' | 'remind' | 'thumbs_up'`). Defaults to `'serious'`. */
  expression?: OfficerFaceExpressionId | string
  /** Optional uniform height scale override; preserves existing figure scale if omitted. */
  scale?: number
  /** Apply natural relaxed gloved finger curl on initial mount (`true` by default). */
  poseHands?: boolean
}

export interface OfficerLookAnchors {
  readonly head: THREE.Object3D
  readonly torso: THREE.Object3D
  readonly belt: THREE.Object3D
  readonly handL: THREE.Object3D
  readonly handR: THREE.Object3D
  readonly upperArmL: THREE.Object3D | null
  readonly upperArmR: THREE.Object3D | null
  readonly footL: THREE.Object3D | null
  readonly footR: THREE.Object3D | null
}

export interface OfficerLookParts {
  readonly bodyMesh: THREE.SkinnedMesh
  readonly headUnit: THREE.Object3D
  readonly faceUnit: THREE.Mesh
  readonly dutyKitUnit: THREE.Mesh
  readonly capMarker: THREE.Object3D
  readonly faceMarker: THREE.Object3D
  readonly radioMarker: THREE.Object3D
  readonly badgeMarker: THREE.Object3D
  readonly whistleChainMarker: THREE.Object3D
  readonly gloveLMarker: THREE.Object3D
  readonly gloveRMarker: THREE.Object3D
}

export interface OfficerLookMetrics {
  readonly triangleCount: number
  readonly meshCount: number
  readonly estimatedDrawCalls: number
  readonly dynamicLightCount: number
  readonly hasCreatorFace: boolean
  readonly hasCreatorHair: boolean
  readonly hasCreatorBodyOutline: boolean
  readonly hasUniformOutfit: boolean
  readonly appliedOutfit: EquippedOutfit | null
  readonly boneMounts: Readonly<{
    cap: string
    dutyKit: string
    radio: string
    badge: string
    whistleChain: string
    gloveL: string
    gloveR: string
    shoeL: string
    shoeR: string
  }>
}

export interface OfficerLookHandle {
  readonly root: THREE.Object3D
  readonly rig: AvatarRig
  readonly outfitController: AvatarOutfitController
  readonly anchors: OfficerLookAnchors
  readonly parts: OfficerLookParts
  getExpression(): OfficerFaceExpressionId
  setExpression(expr: OfficerFaceExpressionId | string): OfficerFaceExpressionId
  /** Applies relaxed gloved hand curl (`'relaxed'`), baton fist (`'grip'`), or crisp upright thumb (`'thumbs_up'`) to finger bones. */
  setHandGesture(mode: 'relaxed' | 'thumbs_up' | 'grip', side?: 'left' | 'right'): void
  /** Raises or releases full chest-high gloved thumbs-up arm + fist + upright thumb pose (`'left'` or `'right'`). */
  poseThumbsUp(active: boolean, side?: 'left' | 'right'): void
  getMetrics(): OfficerLookMetrics
  dispose(): void
}
