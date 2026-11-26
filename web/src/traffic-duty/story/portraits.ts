/**
 * 解放桥交警与玩家高精保真 3D（1-to-4 细分 + Taubin 无膨胀平滑 + 赛璐珞墨线暖金边光）头像渲染（web/src/traffic-duty/story/portraits.ts）
 *
 * - 弃用易产生球肩/肿脸与面部破面蜘蛛纹的外凸 PN 控点：改用「线性 1-to-4 细分 + 折痕锁定 Taubin 无膨胀平滑（λ=+0.38, μ=-0.39）」；
 * - 眼嘴叠层严格按贴合面局部前推并保持与底层皮肤清净间隙，彻底杜绝鼻梁/嘴角蜘蛛网细线；
 * - 2× 超采样（1024×1152 -> 512×576）渲染：带视角轮廓暗部内勾线 + 5px 浑厚外墨线 + 暖橙金边缘光 + 暗青玉聚光底纹；
 * - 玩家装扮同步：戴帽贴合耳前真鬓角、斜挎胸带+扣具贴服前胸、`top_guochao_pankou` 立体朱砂鎏金盘扣、女号柔和长睫眼型、值班背心实时联动。
 */

import * as THREE from 'three'
import {defaultAvatar, type Avatar} from '../../../../lib/avatar'
import {DEFAULT_EQUIPPED_OUTFIT, starterOutfit, type EquippedOutfit} from '../../game/catalog'
import {getState} from '../../game/state'
import {characterModel, currentAvatar, disposeCharacterParts, styleCharacter} from '../../walk/character'
import {setCreatorExpression} from '../../walk/creator-face'
import {ensureAvatarRig} from '../../walk/avatar-rig'
import {
  buildOfficerPortraitModel,
  normalizeOfficerExpression,
  type OfficerExpressionId,
} from '../npc-officer'

export type OfficerPortraitExpression = OfficerExpressionId

export const OFFICER_PORTRAIT_EXPRESSIONS: readonly OfficerPortraitExpression[] = Object.freeze([
  'serious',
  'smile',
  'remind',
  'thumbs_up',
])

export interface DutyPortraitBundle {
  readonly officer: Record<OfficerPortraitExpression, string>
  readonly player: string
  readonly outfitKey: string
  readonly source: 'webgl' | 'mock' | 'canvas'
}

export interface PortraitRendererHooks {
  renderOfficerPortraits?: () => Promise<Record<OfficerPortraitExpression, string>>
  renderPlayerPortrait?: (outfitKey: string, avatar: Avatar, equipped: EquippedOutfit) => Promise<string>
  getPlayerAvatar?: () => Avatar | null | undefined
  getPlayerOutfit?: () => Partial<EquippedOutfit> | null | undefined
}

export interface DutyStoryPortraitManager {
  ensureReady(forcePlayerRefresh?: boolean): Promise<DutyPortraitBundle>
  refreshPlayerIfChanged(): Promise<DutyPortraitBundle | null>
  getCurrent(): DutyPortraitBundle | null
  getOfficerUrl(expr?: string | null): string | null
  getPlayerUrl(): string | null
  getOutfitKey(): string
  isReady(): boolean
  subscribe(listener: (bundle: DutyPortraitBundle) => void): () => void
  dispose(): void
}

export const PORTRAIT_W = 512
export const PORTRAIT_H = 576
const PORTRAIT_SSAA = 2

export interface PortraitStudioLightingConfig {
  readonly exposure: number
  readonly hemiIntensity: number
  readonly keyIntensity: number
  readonly fillIntensity: number
  readonly rimIntensity: number
  readonly keyDirView: readonly [number, number, number]
  readonly shadowMul: readonly [number, number, number]
  readonly shadowAdd: readonly [number, number, number]
  readonly midMul: readonly [number, number, number]
  readonly midAdd: readonly [number, number, number]
  readonly litMul: number
  readonly litAdd: readonly [number, number, number]
  readonly backdropCenterHex: string
  readonly backdropMidHex: string
  readonly backdropEdgeHex: string
}

/** Legacy r8/k51 studio config retained as quantitative regression baseline (was dark/cool-grey on player portraits). */
export const LEGACY_PORTRAIT_STUDIO_CONFIG: Readonly<PortraitStudioLightingConfig> = Object.freeze({
  exposure: 1.24,
  hemiIntensity: 2.0,
  keyIntensity: 2.35,
  fillIntensity: 1.65,
  rimIntensity: 1.8,
  keyDirView: Object.freeze([-0.46, 0.66, 0.59] as const),
  shadowMul: Object.freeze([0.72, 0.78, 0.8] as const),
  shadowAdd: Object.freeze([0, 0, 0] as const),
  midMul: Object.freeze([0.98, 0.98, 0.96] as const),
  midAdd: Object.freeze([0, 0, 0] as const),
  litMul: 1.08,
  litAdd: Object.freeze([0.025, 0.022, 0.014] as const),
  backdropCenterHex: '#305048',
  backdropMidHex: '#223a37',
  backdropEdgeHex: '#192a29',
})

/** Calibrated r10 bright warm studio config: eliminates dark/grey player portrait cast & aligns with player-pipeline officer. */
export const PORTRAIT_STUDIO_CONFIG: Readonly<PortraitStudioLightingConfig> = Object.freeze({
  exposure: 1.36,
  hemiIntensity: 2.45,
  keyIntensity: 2.85,
  fillIntensity: 2.15,
  rimIntensity: 1.95,
  keyDirView: Object.freeze([-0.28, 0.42, 0.86] as const),
  shadowMul: Object.freeze([0.88, 0.86, 0.83] as const),
  shadowAdd: Object.freeze([0.022, 0.018, 0.012] as const),
  midMul: Object.freeze([1.12, 1.1, 1.07] as const),
  midAdd: Object.freeze([0.026, 0.022, 0.015] as const),
  litMul: 1.24,
  litAdd: Object.freeze([0.046, 0.038, 0.026] as const),
  backdropCenterHex: '#3d675c',
  backdropMidHex: '#2a4a43',
  backdropEdgeHex: '#1f3533',
})

function smoothstepNum(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Pure CPU evaluator matching the portrait cel shader + Neutral tone exposure curve for deterministic brightness tests. */
export function evaluatePortraitShadingLuminance(
  cfg: Readonly<PortraitStudioLightingConfig>,
  albedoRgb: readonly [number, number, number],
  normalView: readonly [number, number, number] = [0, 0.1, 0.995],
): number {
  const nLen = Math.hypot(normalView[0], normalView[1], normalView[2]) || 1
  const nx = normalView[0] / nLen
  const ny = normalView[1] / nLen
  const nz = normalView[2] / nLen
  const kLen = Math.hypot(cfg.keyDirView[0], cfg.keyDirView[1], cfg.keyDirView[2]) || 1
  const ndl = nx * (cfg.keyDirView[0] / kLen) + ny * (cfg.keyDirView[1] / kLen) + nz * (cfg.keyDirView[2] / kLen)
  const sha = smoothstepNum(-0.28, 0.14, ndl)
  const hi = smoothstepNum(0.58, 0.9, ndl)
  const rgb: [number, number, number] = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const a = albedoRgb[c]!
    const sh = a * cfg.shadowMul[c]! + cfg.shadowAdd[c]!
    const md = a * cfg.midMul[c]! + cfg.midAdd[c]!
    const lt = Math.min(1.0, a * cfg.litMul + cfg.litAdd[c]!)
    const cel = sh + (md - sh) * sha
    const out = (cel + (lt - cel) * (hi * 0.55)) * cfg.exposure
    const tone = out / (1 + out) // monotonic shoulder matching filmic/neutral compression
    rgb[c] = Math.pow(Math.max(0, Math.min(1, tone)), 1 / 2.2)
  }
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

export interface PortraitCameraPose {
  readonly fov: number
  readonly position: readonly [number, number, number]
  readonly lookAt: readonly [number, number, number]
}

/** Deterministic portrait framing anchored to actual head height & cap/hair top so r10 player-pipeline officer and player match cleanly. */
export function computePortraitCameraPose(
  kind: 'officer' | 'player',
  metrics: {headY: number; topY: number; expr?: OfficerPortraitExpression},
): PortraitCameraPose {
  const fov = 22.5
  const tanHalf = Math.tan(((fov * 0.5) * Math.PI) / 180)
  const safeHeadY = Number.isFinite(metrics.headY) ? metrics.headY : 1.6
  const safeTopY = Number.isFinite(metrics.topY)
    ? Math.min(2.14, Math.max(safeHeadY + 0.14, metrics.topY))
    : safeHeadY + 0.22
  const isThumbsUp = kind === 'officer' && metrics.expr === 'thumbs_up'
  const isRemind = kind === 'officer' && metrics.expr === 'remind'
  const headroom = kind === 'officer' ? 0.058 : 0.056
  const belowHead = isThumbsUp ? 0.44 : isRemind ? 0.35 : kind === 'officer' ? 0.34 : 0.34
  const frameTopY = safeTopY + headroom
  const frameBotY = safeHeadY - belowHead
  const minDist = isThumbsUp ? 2.00 : isRemind ? 1.64 : kind === 'officer' ? 1.60 : 1.58
  const neededDist = ((frameTopY - frameBotY) * 0.5) / tanHalf
  const dist = Math.max(minDist, Math.min(2.30, neededDist))
  const halfSpan = dist * tanHalf
  const aimY = frameTopY - halfSpan
  const shiftX = kind === 'officer' ? (isThumbsUp ? -0.105 : -0.014) : 0.018
  return {
    fov,
    position: [shiftX, aimY + 0.024, -dist],
    lookAt: [shiftX * (kind === 'officer' ? 0.92 : 0.7), aimY, 0],
  }
}

export interface FingerProportionReport {
  readonly bodyHeightM: number
  readonly leftForearmM: number
  readonly rightForearmM: number
  readonly leftLengths: Readonly<Record<string, number>>
  readonly rightLengths: Readonly<Record<string, number>>
  readonly maxFingerLengthM: number
  readonly maxFingerToHeightRatio: number
  readonly maxLeftRightDeltaM: number
}

/** Measures real left/right finger chain lengths relative to avatar body height to catch stretched-finger regressions. */
export function measureRigFingerProportions(root: THREE.Object3D): FingerProportionReport {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const bodyHeightM = Number.isFinite(box.max.y - box.min.y) && box.max.y - box.min.y > 0.5 ? box.max.y - box.min.y : 1.75
  const wp = (name: string): THREE.Vector3 | null => {
    const node = root.getObjectByName(name)
    if (!node) return null
    return node.getWorldPosition(new THREE.Vector3())
  }
  const distBetween = (a: string, b: string): number => {
    const pa = wp(a)
    const pb = wp(b)
    return pa && pb ? pa.distanceTo(pb) : 0
  }
  const measureSide = (side: 'l' | 'r'): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky'] as const) {
      const p1 = wp(`${f}_01_${side}`)
      const p2 = wp(`${f}_02_${side}`)
      const p3 = wp(`${f}_03_${side}`)
      const p4 = wp(`${f}_04_leaf_${side}`)
      let len = 0
      if (p1 && p2) len += p1.distanceTo(p2)
      if (p2 && p3) len += p2.distanceTo(p3)
      if (p3 && p4) len += p3.distanceTo(p4)
      out[f] = +len.toFixed(5)
    }
    return out
  }
  const leftLengths = measureSide('l')
  const rightLengths = measureSide('r')
  let maxFingerLengthM = 0
  let maxLeftRightDeltaM = 0
  for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky'] as const) {
    maxFingerLengthM = Math.max(maxFingerLengthM, leftLengths[f] ?? 0, rightLengths[f] ?? 0)
    maxLeftRightDeltaM = Math.max(maxLeftRightDeltaM, Math.abs((leftLengths[f] ?? 0) - (rightLengths[f] ?? 0)))
  }
  return {
    bodyHeightM: +bodyHeightM.toFixed(4),
    leftForearmM: +distBetween('lowerarm_l', 'hand_l').toFixed(4),
    rightForearmM: +distBetween('lowerarm_r', 'hand_r').toFixed(4),
    leftLengths,
    rightLengths,
    maxFingerLengthM: +maxFingerLengthM.toFixed(5),
    maxFingerToHeightRatio: +(maxFingerLengthM / bodyHeightM).toFixed(5),
    maxLeftRightDeltaM: +maxLeftRightDeltaM.toFixed(5),
  }
}

export function normalizePortraitExpr(raw?: string | null): OfficerPortraitExpression {
  return normalizeOfficerExpression(raw)
}

/** Checks whether a portrait URL is blank or a legacy toy inline SVG placeholder. */
export function isPlaceholderPortrait(url: string | null | undefined): boolean {
  if (typeof url !== 'string' || url.trim().length < 16) return true
  const trimmed = url.trim().toLowerCase()
  if (trimmed.startsWith('data:image/svg+xml')) return true
  if (trimmed.includes('<svg') || trimmed.includes('placeholder')) return true
  return false
}

export function normalizeEquippedOutfit(
  raw?: Partial<EquippedOutfit> | null,
  avatar?: Avatar | null,
): EquippedOutfit {
  const base = avatar ? starterOutfit(avatar.look) : DEFAULT_EQUIPPED_OUTFIT
  return {
    top: raw?.top || base.top,
    bottom: raw?.bottom || base.bottom,
    shoes: raw?.shoes || base.shoes,
    hat: raw?.hat || base.hat || 'hat_none',
    bag: raw?.bag || base.bag || 'bag_none',
  }
}

export function resolveCurrentPlayerAppearance(hooks?: Pick<PortraitRendererHooks, 'getPlayerAvatar' | 'getPlayerOutfit'>): {
  avatar: Avatar
  equipped: EquippedOutfit
  outfitKey: string
} {
  let avatar: Avatar | null | undefined = hooks?.getPlayerAvatar?.()
  if (!avatar && typeof localStorage !== 'undefined') {
    avatar = currentAvatar()
  }
  const safeAvatar = avatar ?? defaultAvatar()

  const explicitOutfit = hooks?.getPlayerOutfit?.()
  let rawOutfit = explicitOutfit
  if (!rawOutfit && typeof window !== 'undefined') {
    try {
      rawOutfit = getState().wardrobe?.equipped
    } catch {
      rawOutfit = undefined
    }
  }
  let equipped = normalizeEquippedOutfit(rawOutfit, safeAvatar)
  const onDutyActive =
    !explicitOutfit &&
    typeof document !== 'undefined' &&
    document.body?.dataset?.tdDutyActive === '1'
  if (onDutyActive) {
    equipped = {
      ...equipped,
      top: 'top_traffic_volunteer',
      hat: equipped.hat && equipped.hat !== 'hat_none' ? equipped.hat : 'hat_traffic_cap',
    }
  }
  const outfitKey = computePlayerOutfitSignature(safeAvatar, equipped)
  return {avatar: safeAvatar, equipped, outfitKey}
}

export function computePlayerOutfitSignature(
  avatar?: Partial<Avatar> | null,
  equipped?: Partial<EquippedOutfit> | null,
): string {
  const a = avatar ?? {}
  const e = equipped ?? {}
  return JSON.stringify({
    body: a.body ?? 'm',
    skin: a.skin ?? 2,
    face: a.face ?? 1,
    brows: a.brows ?? 0,
    eyes: a.eyes ?? 0,
    hair: a.hair ?? 'm_crop',
    hairColor: a.hairColor ?? 0,
    look: a.look ?? 'basic',
    top: e.top ?? DEFAULT_EQUIPPED_OUTFIT.top,
    bottom: e.bottom ?? DEFAULT_EQUIPPED_OUTFIT.bottom,
    shoes: e.shoes ?? DEFAULT_EQUIPPED_OUTFIT.shoes,
    hat: e.hat ?? DEFAULT_EQUIPPED_OUTFIT.hat,
    bag: e.bag ?? DEFAULT_EQUIPPED_OUTFIT.bag,
  })
}

let portraitMaterialSeq = 0

function fmtVec3(v: readonly [number, number, number]): string {
  return `vec3(${v[0].toFixed(4)}, ${v[1].toFixed(4)}, ${v[2].toFixed(4)})`
}

/**
 * Shared r10 creator-pipeline studio cel shader for BOTH officer and player portraits.
 * Preserves authentic low-poly `creator-face`, `creator-hair`, `creator-body-outline`, and Neon `outfits.ts`
 * GLSL uniform/vest layers while applying calibrated warm bright `PORTRAIT_STUDIO_CONFIG` cel lighting.
 */
function applyPortraitStudioShading(root: THREE.Object3D): () => void {
  const cfg = PORTRAIT_STUDIO_CONFIG
  const keyVec = fmtVec3(cfg.keyDirView)
  const shMul = fmtVec3(cfg.shadowMul)
  const shAdd = fmtVec3(cfg.shadowAdd)
  const mdMul = fmtVec3(cfg.midMul)
  const mdAdd = fmtVec3(cfg.midAdd)
  const ltAdd = fmtVec3(cfg.litAdd)
  const ltMul = cfg.litMul.toFixed(4)
  const hiddenOutlines: THREE.Object3D[] = []

  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    const name = node.name || ''
    if (name.includes('outline')) {
      // Hide inverted-hull 3D outlines in close-up studio portraits (prevents chest lanyard / armpit z-clipping);
      // 2x SSAA compositePortraitWithGoldenRimAndInk renders clean outer & inset comic ink contours.
      hiddenOutlines.push(node)
      node.visible = false
      return
    }
    if (name === 'rest-face' || name.startsWith('officer-expr-')) {
      node.position.z = Math.min(node.position.z, -0.0005)
      node.renderOrder = 3
      return
    }
    const mats = Array.isArray(node.material) ? node.material : [node.material]
    for (const mat of mats) {
      if (!(mat instanceof THREE.MeshStandardMaterial) || mat.userData._portraitStudioShaded) continue
      mat.userData._portraitStudioShaded = true
      const prevCompile = mat.onBeforeCompile
      const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.call(mat) : 'std'
      const tag = `${prevKey}-r10-studio-cel-${++portraitMaterialSeq}`
      mat.customProgramCacheKey = () => tag
      const rimWeight = name.includes('hair') ? '0.0' : '0.38'
      mat.onBeforeCompile = (shader, renderer) => {
        prevCompile.call(mat, shader, renderer)
        const celBlock = `
        vec3 _pN = normalize(normal);
        vec3 _pV = normalize(vViewPosition);
        vec3 _pKey = normalize(${keyVec});
        vec3 _pRim = normalize(vec3(0.72, 0.44, -0.53));
        float _pNdl = dot(_pN, _pKey);
        float _pSha = smoothstep(-0.28, 0.14, _pNdl);
        float _pHi = smoothstep(0.58, 0.90, _pNdl);
        vec3 _pShadow = diffuseColor.rgb * ${shMul} + ${shAdd};
        vec3 _pMid = diffuseColor.rgb * ${mdMul} + ${mdAdd};
        vec3 _pLit = min(vec3(1.0), diffuseColor.rgb * ${ltMul} + ${ltAdd});
        vec3 _pCel = mix(_pShadow, _pMid, _pSha);
        _pCel = mix(_pCel, _pLit, _pHi * 0.55);
        float _pNdv = clamp(dot(_pN, _pV), 0.0, 1.0);
        float _pFresnel = pow(1.0 - _pNdv, 2.35);
        float _pRimSide = smoothstep(-0.08, 0.65, dot(_pN, _pRim));
        float _pTopRim = smoothstep(0.22, 0.86, _pN.y) * 0.34;
        vec3 _pRimCol = vec3(1.0, 0.91, 0.66) * _pFresnel * max(_pRimSide, _pTopRim) * ${rimWeight};
        outgoingLight = (length(totalEmissiveRadiance) > 0.16) ? outgoingLight : (_pCel + totalEmissiveRadiance + _pRimCol);
        #include <opaque_fragment>`
        if (shader.fragmentShader.includes('outgoingLight = diffuseColor.rgb * band')) {
          shader.fragmentShader = shader.fragmentShader.replace(
            /outgoingLight\s*=\s*diffuseColor\.rgb\s*\*\s*band[^;]*;\s*#include <opaque_fragment>/,
            celBlock,
          )
        } else {
          shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', celBlock)
        }
      }
      mat.needsUpdate = true
    }
  })
  return () => {
    for (const o of hiddenOutlines) o.visible = true
  }
}

function rotateBoneWorld(bone: THREE.Object3D, worldAxis: THREE.Vector3, rad: number): void {
  if (!bone.parent) return
  bone.parent.updateMatrixWorld(true)
  const pwq = bone.parent.getWorldQuaternion(new THREE.Quaternion())
  const bwq = bone.getWorldQuaternion(new THREE.Quaternion())
  const dq = new THREE.Quaternion().setFromAxisAngle(worldAxis.clone().normalize(), rad)
  bone.quaternion.copy(pwq.clone().invert().multiply(dq).multiply(bwq))
  bone.updateMatrixWorld(true)
}

function aimBoneWorld(bone: THREE.Object3D, child: THREE.Object3D, targetWorldDir: THREE.Vector3): void {
  if (!bone.parent) return
  bone.parent.updateMatrixWorld(true)
  const p0 = bone.getWorldPosition(new THREE.Vector3())
  const p1 = child.getWorldPosition(new THREE.Vector3())
  const curDir = p1.sub(p0)
  if (curDir.lengthSq() < 1e-10) return
  curDir.normalize()
  const dq = new THREE.Quaternion().setFromUnitVectors(curDir, targetWorldDir.clone().normalize())
  const pwq = bone.parent.getWorldQuaternion(new THREE.Quaternion())
  const bwq = bone.getWorldQuaternion(new THREE.Quaternion())
  bone.quaternion.copy(pwq.clone().invert().multiply(dq).multiply(bwq))
  bone.updateMatrixWorld(true)
}

/**
 * Refines the isolated offscreen portrait clone's `thumbs_up` left hand/fingers in exact world space
 * while preserving `buildOfficerPortraitModel()`'s verified forward-chest arm placement.
 * Keeps thumb upright (slightly outward away from shoulder), tucks thumb metacarpal forward into the palm
 * for natural proportions, and tightly clusters & curls the 4 fingers into a compact closed fist.
 */
function refineOfficerThumbsUpPortraitPose(root: THREE.Object3D): void {
  root.updateMatrixWorld(true)
  const handL = root.getObjectByName('hand_l')
  if (!handL) return

  // Turn fist into clean 3/4 thumbs-up profile (knuckles facing front-left, palm tucked inward)
  rotateBoneWorld(handL, new THREE.Vector3(0, 1, 0), -0.52)
  rotateBoneWorld(handL, new THREE.Vector3(0, 0, 1), -0.16)

  // Cluster index/middle/ring/pinky tightly together vertically & curl inward cleanly into the palm
  const fistCurlConfigs: readonly [string, number][] = [
    ['index', -0.26],
    ['middle', -0.08],
    ['ring', 0.10],
    ['pinky', 0.28],
  ]
  for (const [finger, yPull] of fistCurlConfigs) {
    const b1 = root.getObjectByName(`${finger}_01_l`)
    const b2 = root.getObjectByName(`${finger}_02_l`)
    const b3 = root.getObjectByName(`${finger}_03_l`)
    const b4 = root.getObjectByName(`${finger}_04_leaf_l`)
    if (b1 && b2) aimBoneWorld(b1, b2, new THREE.Vector3(0.62, yPull, 0.74))
    if (b2 && b3) aimBoneWorld(b2, b3, new THREE.Vector3(-0.35, yPull * 0.4, 0.92))
    if (b3 && b4) aimBoneWorld(b3, b4, new THREE.Vector3(-0.85, 0.0, 0.52))
  }

  // Tuck thumb_01_l (metacarpal) forward along palm so only thumb_02/03 rise upright cleanly away from shoulder
  const t1 = root.getObjectByName('thumb_01_l')
  const t2 = root.getObjectByName('thumb_02_l')
  const t3 = root.getObjectByName('thumb_03_l')
  const t4 = root.getObjectByName('thumb_04_leaf_l')
  if (t1 && t2) aimBoneWorld(t1, t2, new THREE.Vector3(-0.08, 0.06, -0.99))
  if (t2 && t3) aimBoneWorld(t2, t3, new THREE.Vector3(-0.14, 0.86, -0.49))
  if (t3 && t4) aimBoneWorld(t3, t4, new THREE.Vector3(-0.18, 0.97, -0.16))
  root.updateMatrixWorld(true)
}

/** Paints `mifen/story/uncle` emerald-slate spotlight halo + 5px bold outer ink silhouette & warm gold rim light. */
function compositePortraitWithGoldenRimAndInk(
  glCanvas: HTMLCanvasElement,
  rimDirX: number,
  outCtx: CanvasRenderingContext2D,
): void {
  const glW = glCanvas.width
  const glH = glCanvas.height

  // 1. Brighter warm jade spotlight backdrop (never muddy/grey so both player and officer portraits read crisp)
  outCtx.fillStyle = PORTRAIT_STUDIO_CONFIG.backdropEdgeHex
  outCtx.fillRect(0, 0, PORTRAIT_W, PORTRAIT_H)
  const spot = outCtx.createRadialGradient(
    PORTRAIT_W * 0.50,
    PORTRAIT_H * 0.40,
    PORTRAIT_W * 0.08,
    PORTRAIT_W * 0.50,
    PORTRAIT_H * 0.45,
    Math.max(PORTRAIT_W, PORTRAIT_H) * 0.78,
  )
  spot.addColorStop(0, PORTRAIT_STUDIO_CONFIG.backdropCenterHex)
  spot.addColorStop(0.50, PORTRAIT_STUDIO_CONFIG.backdropMidHex)
  spot.addColorStop(0.86, PORTRAIT_STUDIO_CONFIG.backdropEdgeHex)
  spot.addColorStop(1, '#192c2b')
  outCtx.fillStyle = spot
  outCtx.fillRect(0, 0, PORTRAIT_W, PORTRAIT_H)

  const auraX = rimDirX > 0 ? PORTRAIT_W * 0.28 : PORTRAIT_W * 0.72
  const aura = outCtx.createRadialGradient(auraX, PORTRAIT_H * 0.42, 10, auraX, PORTRAIT_H * 0.44, PORTRAIT_W * 0.44)
  aura.addColorStop(0, 'rgba(248, 188, 86, 0.22)')
  aura.addColorStop(0.6, 'rgba(220, 152, 68, 0.08)')
  aura.addColorStop(1, 'rgba(220, 152, 68, 0)')
  outCtx.fillStyle = aura
  outCtx.fillRect(0, 0, PORTRAIT_W, PORTRAIT_H)

  let seed = 0x51a7c3
  outCtx.fillStyle = 'rgba(248, 244, 232, 0.022)'
  for (let i = 0; i < 720; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const gx = ((seed >>> 16) % PORTRAIT_W) | 0
    seed = (seed * 1664525 + 1013904223) >>> 0
    const gy = ((seed >>> 16) % PORTRAIT_H) | 0
    outCtx.fillRect(gx, gy, 1.5, 1.5)
  }

  // 2. Smooth anti-aliased outer dilated comic ink boundary (`4.6px` SSAA -> ~2.3px crisp silhouette ink)
  const inkCanvas = document.createElement('canvas')
  inkCanvas.width = glW
  inkCanvas.height = glH
  const inkCtx = inkCanvas.getContext('2d')!
  const radius = 4.6
  const ringCount = 20
  for (let i = 0; i < ringCount; i++) {
    const a = (i * Math.PI * 2) / ringCount
    inkCtx.drawImage(glCanvas, Math.cos(a) * radius, Math.sin(a) * radius)
  }
  inkCtx.globalCompositeOperation = 'source-in'
  inkCtx.fillStyle = '#15191c'
  inkCtx.fillRect(0, 0, glW, glH)

  // 3. Crisp 2.2px inset ink contour along outer bright silhouette edges
  const insetInkCanvas = document.createElement('canvas')
  insetInkCanvas.width = glW
  insetInkCanvas.height = glH
  const insetCtx = insetInkCanvas.getContext('2d')!
  insetCtx.drawImage(glCanvas, 0, 0)
  insetCtx.globalCompositeOperation = 'source-in'
  insetCtx.fillStyle = '#171b1f'
  insetCtx.fillRect(0, 0, glW, glH)
  insetCtx.globalCompositeOperation = 'destination-out'
  const erodeR = 2.2
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = glW
  maskCanvas.height = glH
  const mCtx = maskCanvas.getContext('2d')!
  mCtx.drawImage(glCanvas, 0, 0)
  mCtx.globalCompositeOperation = 'destination-in'
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI * 2) / 8
    mCtx.drawImage(glCanvas, Math.cos(a) * erodeR, Math.sin(a) * erodeR)
  }
  insetCtx.drawImage(maskCanvas, 0, 0)

  // 4. Directional inner warm orange-gold rim highlight along backlit silhouette contour
  const rimCanvas = document.createElement('canvas')
  rimCanvas.width = glW
  rimCanvas.height = glH
  const rimCtx = rimCanvas.getContext('2d')!
  rimCtx.drawImage(glCanvas, 0, 0)
  rimCtx.globalCompositeOperation = 'destination-out'
  rimCtx.drawImage(glCanvas, rimDirX * 16, 7)
  rimCtx.globalCompositeOperation = 'source-in'
  const rGrad = rimCtx.createLinearGradient(0, 0, glW, glH)
  rGrad.addColorStop(0, '#fff4bd')
  rGrad.addColorStop(0.55, '#ffc24b')
  rGrad.addColorStop(1, '#e89132')
  rimCtx.fillStyle = rGrad
  rimCtx.fillRect(0, 0, glW, glH)

  outCtx.drawImage(inkCanvas, 0, 0, PORTRAIT_W, PORTRAIT_H)
  outCtx.drawImage(glCanvas, 0, 0, PORTRAIT_W, PORTRAIT_H)
  outCtx.save()
  outCtx.globalCompositeOperation = 'screen'
  outCtx.globalAlpha = 0.88
  outCtx.drawImage(rimCanvas, 0, 0, PORTRAIT_W, PORTRAIT_H)
  outCtx.restore()
  outCtx.drawImage(insetInkCanvas, 0, 0, PORTRAIT_W, PORTRAIT_H)
}

function buildStudioScene(): {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  dispose: () => void
} {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(22.5, PORTRAIT_W / PORTRAIT_H, 0.25, 12)
  // Enable ALL render layers (Layer 0 + MAIN_DETAIL_LAYER 3) so Carbon's mainDetail officer meshes always render cleanly
  camera.layers.enableAll()
  const hemi = new THREE.HemisphereLight(0xffffff, 0xb8d4c8, PORTRAIT_STUDIO_CONFIG.hemiIntensity)
  const key = new THREE.DirectionalLight(0xfff8ee, PORTRAIT_STUDIO_CONFIG.keyIntensity)
  key.position.set(-0.9, 2.2, -3.6)
  const fill = new THREE.DirectionalLight(0xfff4ea, PORTRAIT_STUDIO_CONFIG.fillIntensity)
  fill.position.set(1.4, 1.5, -3.4)
  const rim = new THREE.DirectionalLight(0xfff0c8, PORTRAIT_STUDIO_CONFIG.rimIntensity)
  rim.position.set(2.4, 2.2, 2.4)
  scene.add(hemi, key, fill, rim)
  return {
    scene,
    camera,
    dispose() {
      hemi.dispose()
      key.dispose()
      fill.dispose()
      rim.dispose()
    },
  }
}

async function createOffscreenStudioRenderer(): Promise<{
  render(scene: THREE.Scene, camera: THREE.Camera, rimDirX: number): string
  dispose(): void
} | null> {
  if (typeof document === 'undefined') return null
  const glW = PORTRAIT_W * PORTRAIT_SSAA
  const glH = PORTRAIT_H * PORTRAIT_SSAA
  const glCanvas = document.createElement('canvas')
  glCanvas.width = glW
  glCanvas.height = glH

  const outCanvas = document.createElement('canvas')
  outCanvas.width = PORTRAIT_W
  outCanvas.height = PORTRAIT_H
  const outCtx = outCanvas.getContext('2d')
  if (!outCtx) return null
  outCtx.imageSmoothingEnabled = true
  outCtx.imageSmoothingQuality = 'high'

  let renderer: THREE.WebGLRenderer | null = null
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: glCanvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })
  } catch {
    return null
  }
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(1)
  renderer.setSize(glW, glH, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = PORTRAIT_STUDIO_CONFIG.exposure

  return {
    render(scene, camera, rimDirX) {
      renderer!.render(scene, camera)
      compositePortraitWithGoldenRimAndInk(glCanvas, rimDirX, outCtx)
      return outCanvas.toDataURL('image/png')
    },
    dispose() {
      try {
        renderer?.dispose()
        renderer?.forceContextLoss()
      } catch {
        // ignore GL context teardown error
      }
      renderer = null
    },
  }
}

async function renderOfficerPortraitsWebgl(): Promise<Record<OfficerPortraitExpression, string>> {
  const gl = await createOffscreenStudioRenderer()
  if (!gl) throw new Error('Offscreen WebGL portrait renderer unavailable')
  const studio = buildStudioScene()
  const model = await buildOfficerPortraitModel()
  let revertShading: (() => void) | null = null
  try {
    model.group.rotation.y = 0.26
    revertShading = applyPortraitStudioShading(model.group)
    studio.scene.add(model.group)

    const result = {} as Record<OfficerPortraitExpression, string>
    const headPos = new THREE.Vector3()
    for (const expr of OFFICER_PORTRAIT_EXPRESSIONS) {
      model.setExpression(expr)
      // Sync player-pipeline creator-face geometry (brow/eye/mouth) for the r10 unified officer model
      setCreatorExpression(model.group, expr)
      if (expr === 'thumbs_up') {
        refineOfficerThumbsUpPortraitPose(model.group)
      }
      model.group.updateMatrixWorld(true)
      model.headWorld(headPos)
      const box = new THREE.Box3().setFromObject(model.group)
      const pose = computePortraitCameraPose('officer', {
        headY: headPos.y,
        topY: box.max.y,
        expr,
      })
      studio.camera.fov = pose.fov
      studio.camera.position.set(pose.position[0], pose.position[1], pose.position[2])
      studio.camera.lookAt(pose.lookAt[0], pose.lookAt[1], pose.lookAt[2])
      studio.camera.updateProjectionMatrix()
      result[expr] = gl.render(studio.scene, studio.camera, +1)
    }
    return result
  } finally {
    revertShading?.()
    model.dispose()
    studio.dispose()
    gl.dispose()
  }
}

async function renderPlayerPortraitWebgl(
  _outfitKey: string,
  avatar: Avatar,
  equipped: EquippedOutfit,
): Promise<string> {
  const gl = await createOffscreenStudioRenderer()
  if (!gl) throw new Error('Offscreen WebGL player portrait renderer unavailable')
  const studio = buildStudioScene()
  const loaded = await characterModel(avatar)
  const fig = loaded.scene
  let revertShading: (() => void) | null = null
  try {
    fig.name = 'player_portrait_rig'
    const rig = ensureAvatarRig(fig)
    const outfitCtrl = styleCharacter(fig, rig, avatar)
    outfitCtrl.applyEquipped(equipped, {ridingEbike: false, autoHelmetOnRide: false})
    setCreatorExpression(fig, 'smile')

    rig.joints.Hips?.rotation.set(0, 0, 0)
    rig.joints.Torso?.rotation.set(0.02, 0.04, 0)
    rig.joints.Head?.rotation.set(0.02, -0.05, 0.02)
    rig.joints.ArmL?.rotation.set(0.08, 0, -0.14)
    rig.joints.ForearmL?.rotation.set(0.22, 0, 0)
    rig.joints.ArmR?.rotation.set(0.08, 0, 0.14)
    rig.joints.ForearmR?.rotation.set(0.22, 0, 0)
    rig.syncPose()

    fig.rotation.y = -0.26
    revertShading = applyPortraitStudioShading(fig)
    studio.scene.add(fig)
    fig.updateMatrixWorld(true)

    const headWorldPos = new THREE.Vector3(0, 1.60, 0)
    rig.attachments.head?.getWorldPosition(headWorldPos)
    const box = new THREE.Box3().setFromObject(fig)
    const pose = computePortraitCameraPose('player', {
      headY: headWorldPos.y,
      topY: box.max.y,
    })
    studio.camera.fov = pose.fov
    studio.camera.position.set(pose.position[0], pose.position[1], pose.position[2])
    studio.camera.lookAt(pose.lookAt[0], pose.lookAt[1], pose.lookAt[2])
    studio.camera.updateProjectionMatrix()
    return gl.render(studio.scene, studio.camera, -1)
  } finally {
    revertShading?.()
    fig.removeFromParent()
    disposeCharacterParts(fig)
    studio.dispose()
    gl.dispose()
  }
}

export function createDutyStoryPortraitManager(hooks: PortraitRendererHooks = {}): DutyStoryPortraitManager {
  const customMode = Boolean(hooks.renderOfficerPortraits || hooks.renderPlayerPortrait)
  let officerUrls: Record<OfficerPortraitExpression, string> | null = null
  let officerPromise: Promise<Record<OfficerPortraitExpression, string>> | null = null
  const playerCache = new Map<string, string>()
  let lastOutfitKey = resolveCurrentPlayerAppearance(hooks).outfitKey
  let lastBundle: DutyPortraitBundle | null = null
  const listeners = new Set<(bundle: DutyPortraitBundle) => void>()
  let disposed = false
  let queue: Promise<unknown> = Promise.resolve()

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task, task)
    queue = next.catch(() => undefined)
    return next
  }

  function emitIfReady(): DutyPortraitBundle | null {
    if (!officerUrls) return null
    const playerUrl = playerCache.get(lastOutfitKey)
    if (!playerUrl) return null
    const next: DutyPortraitBundle = {
      officer: {...officerUrls},
      player: playerUrl,
      outfitKey: lastOutfitKey,
      source: customMode ? 'mock' : 'webgl',
    }
    lastBundle = next
    for (const fn of listeners) fn(next)
    return next
  }

  async function ensureOfficer(): Promise<Record<OfficerPortraitExpression, string>> {
    if (officerUrls) return officerUrls
    if (!officerPromise) {
      const fn = hooks.renderOfficerPortraits ?? renderOfficerPortraitsWebgl
      officerPromise = enqueue(fn)
        .then(res => {
          officerUrls = res
          return res
        })
        .catch(err => {
          officerPromise = null
          throw err
        })
    }
    return officerPromise
  }

  async function ensurePlayer(force = false): Promise<string> {
    const app = resolveCurrentPlayerAppearance(hooks)
    lastOutfitKey = app.outfitKey
    if (!force) {
      const hit = playerCache.get(app.outfitKey)
      if (hit) return hit
    }
    const fn = hooks.renderPlayerPortrait ?? renderPlayerPortraitWebgl
    const url = await enqueue(() => fn(app.outfitKey, app.avatar, app.equipped))
    playerCache.set(app.outfitKey, url)
    return url
  }

  return {
    async ensureReady(forcePlayerRefresh = false): Promise<DutyPortraitBundle> {
      if (disposed) throw new Error('Portrait manager disposed')
      await Promise.all([ensureOfficer(), ensurePlayer(forcePlayerRefresh)])
      const ready = emitIfReady()
      if (!ready) throw new Error('Portraits unavailable')
      return ready
    },

    async refreshPlayerIfChanged(): Promise<DutyPortraitBundle | null> {
      if (disposed) return null
      const app = resolveCurrentPlayerAppearance(hooks)
      if (app.outfitKey === lastOutfitKey && playerCache.has(app.outfitKey) && officerUrls) {
        return lastBundle
      }
      lastOutfitKey = app.outfitKey
      await Promise.all([ensureOfficer(), ensurePlayer(false)])
      return emitIfReady()
    },

    getCurrent: () => lastBundle,
    getOfficerUrl: (expr?: string | null) => {
      if (!officerUrls) return null
      return officerUrls[normalizePortraitExpr(expr)] ?? officerUrls.serious
    },
    getPlayerUrl: () => playerCache.get(lastOutfitKey) ?? null,
    getOutfitKey: () => lastOutfitKey,
    isReady: () => Boolean(officerUrls && playerCache.has(lastOutfitKey)),
    subscribe(listener) {
      listeners.add(listener)
      if (lastBundle) listener(lastBundle)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      disposed = true
      listeners.clear()
      playerCache.clear()
      officerUrls = null
      lastBundle = null
    },
  }
}
