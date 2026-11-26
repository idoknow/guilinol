import * as THREE from 'three'
import type {Avatar} from '../../../lib/avatar'
import {avatar as figureConfig} from '../look/avatar'
import {ensureAvatarRig, type AvatarRig} from '../walk/avatar-rig'
import {characterModel, styleCharacter} from '../walk/character'
import {OUTFIT_ZONE, partitionCityWalkerGeometry} from '../walk/outfits'

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

export type GroundSampler = (x: number, z: number, reference?: number, car?: boolean) => number | undefined

export interface JiefangOfficerOptions {
  x?: number
  y?: number
  z?: number
  yaw?: number
  /** Skip async GLB load (useful in pure Node/unit environments without fetch). */
  proceduralOnly?: boolean
}

export interface JiefangOfficerHandle {
  readonly group: THREE.Group
  readonly officerRoot: THREE.Group
  readonly signGroup: THREE.Group
  readonly position: Readonly<{x: number; y: number; z: number}>
  readonly signPosition: Readonly<{x: number; y: number; z: number}>
  readonly phase: () => 'go' | 'stop' | 'guide' | 'watch'
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

/** Original traffic director white-top cap with abstract Guilin diamond badge (no real police emblem/ID). */
function buildOfficerCap(): THREE.Mesh {
  const crown = new THREE.CylinderGeometry(0.132, 0.114, 0.068, 18)
  crown.scale(1, 1, 1.08)
  crown.translate(0, 0.172, 0.008)

  const band = new THREE.CylinderGeometry(0.116, 0.118, 0.044, 18)
  band.scale(1, 1, 1.12)
  band.translate(0, 0.122, 0.012)

  const piping = new THREE.CylinderGeometry(0.120, 0.120, 0.012, 18)
  piping.scale(1, 1, 1.12)
  piping.translate(0, 0.146, 0.012)

  const brim = new THREE.CylinderGeometry(0.118, 0.132, 0.012, 16, 1, false, Math.PI * 0.65, Math.PI * 0.70)
  brim.rotateX(0.16)
  brim.translate(0, 0.104, -0.025)

  const strap = new THREE.BoxGeometry(0.228, 0.012, 0.014)
  strap.translate(0, 0.112, -0.112)

  // Original Guilin bridge diamond geometric ornament (not a police shield)
  const badge = new THREE.OctahedronGeometry(0.019, 0)
  badge.scale(0.85, 1.15, 0.4)
  badge.translate(0, 0.156, -0.122)

  // Undercut dark nape/sideburn hair rim tucked naturally under peaked cap edge
  const napeHair = new THREE.CylinderGeometry(0.109, 0.100, 0.056, 16, 1, false, -Math.PI * 0.65, Math.PI * 1.30)
  napeHair.scale(1, 1, 1.12)
  napeHair.translate(0, 0.072, 0.015)

  return mergeColoredMesh(
    [
      {geom: crown, hex: '#f4f6f2'},
      {geom: band, hex: '#162233'},
      {geom: piping, hex: '#d8ee1e'},
      {geom: brim, hex: '#111822'},
      {geom: strap, hex: '#d4b46a'},
      {geom: badge, hex: '#209c8e'},
      {geom: napeHair, hex: '#1d1917'},
    ],
    'officer_traffic_cap',
    {roughness: 0.55},
  )
}

/** Original high-vis waist belt, Sam Browne diagonal sash, shoulder straps & radio mic (no badge/ID). */
function buildOfficerDutyGear(): THREE.Mesh {
  const parts: ColoredPart[] = []

  // Waist duty belt
  const belt = new THREE.CylinderGeometry(0.168, 0.172, 0.048, 16)
  belt.scale(1.06, 1, 0.78)
  belt.translate(0, -0.135, 0.004)
  parts.push({geom: belt, hex: '#eef2ee'})

  // Brushed alloy belt buckle
  const buckle = new THREE.BoxGeometry(0.056, 0.052, 0.016)
  buckle.translate(0, -0.135, -0.132)
  parts.push({geom: buckle, hex: '#cfd6dc'})

  // Sleek flush epaulets seated right at measured attach_torso shoulder seam (y=0.330..0.342, z=+0.016) so bottom embeds 1cm cleanly into shoulder mesh
  for (const s of [-1, 1]) {
    const ep = new THREE.BoxGeometry(0.088, 0.016, 0.044)
    ep.rotateZ(-s * 0.16)
    ep.translate(s * 0.152, 0.330, 0.016)
    parts.push({geom: ep, hex: '#142030'})
    const bar = new THREE.BoxGeometry(0.068, 0.009, 0.022)
    bar.rotateZ(-s * 0.16)
    bar.translate(s * 0.158, 0.339, 0.016)
    parts.push({geom: bar, hex: '#d8ee1e'})
    const btn = new THREE.CylinderGeometry(0.010, 0.010, 0.008, 8)
    btn.rotateZ(-s * 0.16)
    btn.translate(s * 0.114, 0.344, 0.016)
    parts.push({geom: btn, hex: '#eef3f8'})
  }

  // Left-shoulder communication mic (cleanly clears diagonal chest sash)
  const mic = new THREE.BoxGeometry(0.036, 0.058, 0.028)
  mic.translate(-0.11, 0.18, -0.11)
  parts.push({geom: mic, hex: '#20262e'})

  return mergeColoredMesh(parts, 'officer_duty_gear', {roughness: 0.55})
}

/** Handheld traffic command LED wand: matte black handle/collar separated from emissive red rod. */
function buildTrafficWand(): THREE.Group {
  const grp = new THREE.Group()
  grp.name = 'officer_traffic_wand'

  // Matte black grip & high collar (collar sits at +0.098 cleanly above closed index/thumb knuckles)
  const handle = new THREE.CylinderGeometry(0.014, 0.014, 0.114, 10)
  handle.translate(0, 0.031, 0)
  const pommel = new THREE.SphereGeometry(0.015, 8, 6)
  pommel.translate(0, -0.028, 0)
  const collar = new THREE.CylinderGeometry(0.021, 0.018, 0.022, 10)
  collar.translate(0, 0.098, 0)
  const gripMesh = mergeColoredMesh(
    [
      {geom: handle, hex: '#14171d'},
      {geom: pommel, hex: '#14171d'},
      {geom: collar, hex: '#eef3f7'},
    ],
    'officer_traffic_wand_grip',
    {roughness: 0.45},
  )

  const glowRod = new THREE.CylinderGeometry(0.016, 0.016, 0.255, 10)
  glowRod.translate(0, 0.236, 0)
  const rodMesh = mergeColoredMesh(
    [{geom: glowRod, hex: '#f03522'}],
    'officer_traffic_wand_rod',
    {emissiveHex: '#ff3814', emissiveIntensity: 0.45, roughness: 0.4},
  )

  grp.add(gripMesh, rodMesh)
  return grp
}

const OFFICER_AVATAR: Avatar = {
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

function buildOfficerLeftCurl(figure: THREE.Object3D): FingerPoseTarget[] {
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
    const local = parentB.clone().invert().multiply(parentDelta.clone().invert()).multiply(delta).multiply(childB)
    entries.push({bone, target: local})
  }
  for (const finger of ['index', 'middle', 'ring', 'pinky'] as const) {
    let parentDelta = identity.clone()
    let parentName = 'hand_l'
    for (let i = 1; i <= 3; i++) {
      const name = `${finger}_0${i}_l`
      const turn = new THREE.Quaternion().setFromAxisAngle(axisZ, i === 1 ? -0.45 : -0.58)
      const delta = parentDelta.clone().multiply(turn)
      addJoint(name, parentName, delta, parentDelta)
      parentDelta = delta
      parentName = name
    }
  }
  const t1 = bindPos.get('thumb_01_l')
  const t2 = bindPos.get('thumb_02_l')
  const t3 = bindPos.get('thumb_03_l')
  const t4 = bindPos.get('thumb_04_leaf_l')
  if (t1 && t2 && t3 && t4) {
    // Align relaxed left thumb downward alongside palm/index (+0.85 along hand axis -> straight down beside leg when lowered)
    const seg1 = t2.clone().sub(t1).normalize()
    const d1 = new THREE.Quaternion().setFromUnitVectors(seg1, new THREE.Vector3(0.85, -0.12, 0.50).normalize())
    addJoint('thumb_01_l', 'hand_l', d1, identity)

    const seg2 = t3.clone().sub(t2).applyQuaternion(d1).normalize()
    const d2 = new THREE.Quaternion().setFromUnitVectors(seg2, new THREE.Vector3(0.80, -0.18, 0.57).normalize()).multiply(d1)
    addJoint('thumb_02_l', 'thumb_01_l', d2, d1)

    const seg3 = t4.clone().sub(t3).applyQuaternion(d2).normalize()
    const d3 = new THREE.Quaternion().setFromUnitVectors(seg3, new THREE.Vector3(0.72, -0.24, 0.65).normalize()).multiply(d2)
    addJoint('thumb_03_l', 'thumb_02_l', d3, d2)
  }
  return entries
}

/** Razor-sharp per-pixel GLSL uniform shader so vest, reflective strips, navy pants, boots & white gloves have zero vertex blur. */
function installOfficerClothShader(mat: THREE.Material): void {
  const std = mat as THREE.MeshStandardMaterial
  if (!std.userData?.clothing || std.userData.officerUniformHooked) return
  std.userData.officerUniformHooked = true
  const prevCompile = std.onBeforeCompile
  std.customProgramCacheKey = () => 'creator-cloth-officer'
  std.onBeforeCompile = (shader, renderer) => {
    prevCompile.call(std, shader, renderer)
    if (!shader.fragmentShader.includes('vec3 keyDir =')) return
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 keyDir =',
      `{
        float ax = abs(rest.x);
        bool vFront = rest.z > 0.0;
        vec3 oNavy  = vec3(0.008, 0.016, 0.036);
        vec3 oVest  = vec3(0.690, 0.855, 0.014);
        vec3 oSilv  = vec3(0.860, 0.905, 0.945);
        vec3 oGlove = vec3(0.895, 0.912, 0.875);
        vec3 oBoot  = vec3(0.007, 0.009, 0.014);
        if (rest.y < 0.138 && ax < 0.25) {
          diffuseColor.rgb = oBoot;
        } else if (zone < 0.5 && ax > 0.720 && rest.y > 1.32 && rest.y < 1.54) {
          diffuseColor.rgb = oGlove;
        } else if (zone > 0.5 && zone < 1.5) {
          if (rest.y > 1.385 && ax > 0.090 && ax < 0.225 && rest.z > -0.095 && rest.z < 0.035) {
            if (ax > 0.098 && ax < 0.132 && rest.z > -0.055 && rest.z < 0.015) diffuseColor.rgb = oSilv;
            else if (ax >= 0.138 && ax < 0.214 && rest.z > -0.055 && rest.z < 0.012) diffuseColor.rgb = oVest;
            else diffuseColor.rgb = oNavy;
          } else if (ax > 0.184) {
            if (ax > 0.720) diffuseColor.rgb = oGlove;
            else if (ax > 0.696) diffuseColor.rgb = oSilv;
            else diffuseColor.rgb = oNavy;
          } else if (rest.y < 1.032) {
            diffuseColor.rgb = oNavy;
          } else if ((vFront && rest.y > 1.375 + 0.08 * min(1.0, ax / 0.075)) || (!vFront && ax < 0.088 && rest.y > 1.430)) {
            diffuseColor.rgb = oNavy;
          } else if (vFront && ax < 0.007 && rest.y >= 1.032) {
            diffuseColor.rgb = vec3(0.50, 0.55, 0.60);
          } else if ((rest.y >= 1.088 && rest.y <= 1.128) || (rest.y >= 1.248 && rest.y <= 1.288) || (ax > 0.086 && ax < 0.122 && rest.y > 1.288 && rest.y < 1.485)) {
            diffuseColor.rgb = oSilv;
          } else {
            diffuseColor.rgb = oVest;
          }
        } else if (zone > 1.5 && zone < 2.5) {
          if (rest.y > 0.945 && rest.y < 0.992) {
            diffuseColor.rgb = (vFront && ax < 0.030) ? vec3(0.68, 0.72, 0.76) : oGlove;
          } else if (ax > 0.152 && abs(rest.z + 0.014) < 0.012) {
            diffuseColor.rgb = vec3(0.032, 0.056, 0.095);
          } else {
            diffuseColor.rgb = oNavy;
          }
        } else if (zone > 2.5) {
          diffuseColor.rgb = oBoot;
        }
      }
      vec3 keyDir =`,
    )
  }
  std.needsUpdate = true
}

/** Applies compliant traffic officer uniform colors, cap, cropped hair, gear & hand-gripped baton. */
function applyOfficerUniformColors(figure: THREE.Group, rig: AvatarRig): FingerPoseTarget[] {
  const skinned = rig.skinnedMesh
  if (!skinned) return []
  const part = partitionCityWalkerGeometry(skinned)
  if (part) skinned.geometry.setDrawRange(0, part.bodyIndexCount)

  const uniforms = (skinned.material as THREE.Material).userData?.clothing
  if (uniforms && part) {
    if (!skinned.geometry.hasAttribute('clothZone')) {
      const ids = Float32Array.from(part.zones, z =>
        z === OUTFIT_ZONE.TOP_PRIMARY || z === OUTFIT_ZONE.TOP_SLEEVE || z === OUTFIT_ZONE.TOP_TRIM || z === OUTFIT_ZONE.TOP_INNER
          ? 1
          : z === OUTFIT_ZONE.BOTTOM_MAIN || z === OUTFIT_ZONE.BOTTOM_BELT
            ? 2
            : z === OUTFIT_ZONE.SHOES_UPPER || z === OUTFIT_ZONE.SHOES_ACCENT || z === OUTFIT_ZONE.SHOES_SOLE
              ? 3
              : 0,
      )
      skinned.geometry.setAttribute('clothZone', new THREE.BufferAttribute(ids, 1))
    }
    uniforms.schoolTop.value = 0
    uniforms.skinTone.value.set('#dfb08a')
    uniforms.sleeve.value = 1
    uniforms.shortHem.value = 0
    uniforms.sandal.value = 0
    uniforms.pattern.value = 0
    uniforms.legStripe.value = 0
    installOfficerClothShader(skinned.material as THREE.Material)
  }

  const head = rig.attachments.head
  if (head) {
    const hair = head.getObjectByName('creator-hair')
    if (hair) {
      hair.visible = true
      hair.scale.set(0.94, 0.80, 0.94)
      hair.position.set(0, -0.015, 0.010)
    }
    head.add(buildOfficerCap())
  }
  const torso = rig.attachments.torso
  if (torso) torso.add(buildOfficerDutyGear())

  const rightHand = rig.attachmentAt?.('hand_r')
  if (rightHand) {
    const wand = buildTrafficWand()
    // Coaxial with IDOK-281 palm grip pocket pinky->index axis in attach_hand_r local space
    wand.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.151, 0.974, 0.171).normalize())
    wand.position.set(-0.006, 0, -0.012)
    rightHand.add(wand)
  }
  figure.scale.setScalar(figureConfig.scale * 1.03)
  return [...buildOfficerRightGrip(figure), ...buildOfficerLeftCurl(figure)]
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
  head.add(mergeColoredMesh([{geom: new THREE.IcosahedronGeometry(0.12, 1).translate(0, 0.05, 0), hex: '#dfb08a'}], 'officer_fallback_head'))
  head.add(buildOfficerCap())
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
function buildPersuasionSignTexture(): THREE.CanvasTexture | null {
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
  ctx.fillText('解放桥文明交通劝导站', 256, 76)
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

/** Builds the Jiefang Bridge persuasion stand sign + safety cone + side-mounted triangular guidance flag. */
function buildPersuasionPost(): {
  signGroup: THREE.Group
  flagPivot: THREE.Group
  disposables: {dispose(): void}[]
} {
  const signGroup = new THREE.Group()
  signGroup.name = 'jiefang_persuasion_sign'
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
  const tex = buildPersuasionSignTexture()
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
  const sx = ox + tx * 1.25
  const sz = oz + tz * 1.25

  const group = new THREE.Group()
  group.name = 'jiefang_traffic_officer_post'

  const officerRoot = new THREE.Group()
  officerRoot.name = 'jiefang_traffic_officer'
  const initY = groundAt?.(ox, oz, fallbackY, false) ?? fallbackY
  officerRoot.position.set(ox, initY, oz)
  officerRoot.rotation.set(0, yaw, 0)
  group.add(officerRoot)

  const fallback = buildFallbackOfficer()
  officerRoot.add(fallback.root)

  const {signGroup, flagPivot, disposables} = buildPersuasionPost()
  const initSignY = groundAt?.(sx, sz, initY, false) ?? initY
  signGroup.position.set(sx, initSignY, sz)
  signGroup.rotation.set(0, -0.18, 0)
  group.add(signGroup)

  scene.add(group)

  let riggedModel: THREE.Group | null = null
  let rigged: AvatarRig | null = null
  let fingerGrips: FingerPoseTarget[] = []
  let disposed = false
  let clock = 0
  let groundTimer = 0
  let curPhase: 'go' | 'stop' | 'guide' | 'watch' = 'go'

  if (!opts?.proceduralOnly && typeof fetch === 'function') {
    void characterModel(OFFICER_AVATAR)
      .then(loaded => {
        if (disposed || !loaded) return
        const modelScene = loaded.scene
        modelScene.name = 'rigged-traffic-officer'
        const avatarRig = ensureAvatarRig(modelScene)
        styleCharacter(modelScene, avatarRig, OFFICER_AVATAR)
        fingerGrips = applyOfficerUniformColors(modelScene, avatarRig)
        fallback.root.visible = false
        officerRoot.add(modelScene)
        riggedModel = modelScene
        rigged = avatarRig
        applyGesturePose(clock)
      })
      .catch(() => {
        // Keep procedural articulated fallback in environments without asset server
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

    if (t < 2.2) {
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
      const j = rigged.joints
      j.Hips?.rotation.set(0, 0, 0)
      j.Torso?.rotation.set(...torso)
      j.Head?.rotation.set(...head)
      j.ArmL?.rotation.set(...armL)
      j.ForearmL?.rotation.set(...foreL)
      j.ArmR?.rotation.set(...armR)
      j.ForearmR?.rotation.set(...foreR)
      j.ThighL?.rotation.set(0, 0, -0.03)
      j.ThighR?.rotation.set(0, 0, 0.03)
      j.ShinL?.rotation.set(0, 0, 0)
      j.ShinR?.rotation.set(0, 0, 0)
      rigged.syncPose()
      for (const fg of fingerGrips) fg.bone.quaternion.copy(fg.target)
    } else {
      fallback.armL.rotation.set(armL[0], armL[1], armL[2])
      fallback.armR.rotation.set(armR[0], armR[1], armR[2])
      fallback.head.rotation.set(head[0], head[1], head[2])
    }
  }

  applyGesturePose(0)

  return {
    group,
    officerRoot,
    signGroup,
    get position() {
      return {x: officerRoot.position.x, y: officerRoot.position.y, z: officerRoot.position.z}
    },
    get signPosition() {
      return {x: signGroup.position.x, y: signGroup.position.y, z: signGroup.position.z}
    },
    phase: () => curPhase,
    update(dt: number, elapsedSec?: number) {
      if (disposed) return
      clock = elapsedSec ?? clock + Math.max(0, dt)
      applyGesturePose(clock)
      flagPivot.rotation.z = Math.sin(clock * 2.8) * 0.06
      flagPivot.rotation.y = Math.cos(clock * 1.9) * 0.08

      groundTimer -= Math.max(0, dt)
      if (groundAt && groundTimer <= 0) {
        groundTimer = 0.25
        const oy = groundAt(ox, oz, fallbackY, false)
        if (oy !== undefined && Number.isFinite(oy)) officerRoot.position.y = oy
        const sy = groundAt(sx, sz, oy ?? fallbackY, false)
        if (sy !== undefined && Number.isFinite(sy)) signGroup.position.y = sy
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      group.removeFromParent()
      for (const d of disposables) d.dispose()
      fallback.root.traverse(node => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose()
          for (const m of Array.isArray(node.material) ? node.material : [node.material]) m.dispose()
        }
      })
      riggedModel?.traverse(node => {
        if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose()
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose()
          for (const m of Array.isArray(node.material) ? node.material : [node.material]) m.dispose()
        }
      })
    },
  }
}
