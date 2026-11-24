import * as THREE from 'three'
import {clone} from 'three/addons/utils/SkeletonUtils.js'
import {browNames, eyeNames, faceNames, hairStyles, looks, type Avatar} from '../../../lib/avatar'
import {starterOutfit} from '../game/catalog'
import {touchUi} from '../ui/input-mode'
import {avatar as figureConfig} from '../look/avatar'
import {ensureAvatarRig, type AvatarRig} from '../walk/avatar-rig'
import {characterModel, styleCharacter} from '../walk/character'
import {createEbikeGripPose} from '../walk/ebike-grip'
import {steeringZ} from '../walk/ebike-mounts'
import type {TrafficViolation, TwoWheelActorLike, TwoWheelSubtype} from './models'
import {resolveTwoWheelSpec} from './models'

/**
 * Near-camera articulated two-wheel rider pool (`web/src/traffic/rider-pool.ts`).
 *
 * Reuses `figure_m.glb` / `figure_f.glb` + `outfits.ts` (helmet vs exposed hair)
 * for up to 8 riders on desktop / 4 on mobile within 60 m, leaving far or
 * capped actors to the BatchedMesh rounded low-poly stand-ins.
 */

type RiderTemplate = {
  scene: THREE.Group
  hasHelmet: boolean
  isKidSuitable: boolean
}

type RiderSlotSpec = {
  templateIdx: number
  scale: number
  x: number
  y: number
  z: number
  ry: number
  pose: 'ebike_driver' | 'ebike_child_front' | 'ebike_child_mid' | 'ebike_passenger' | 'bicycle_driver' | 'bicycle_crossbar'
}

type RiderUnit = {
  slot: THREE.Group
  root: THREE.Group
  rig: AvatarRig
  pose: RiderSlotSpec['pose']
  baseY: number
  scale: number
}

type RiderView = {
  root: THREE.Group
  frame: THREE.Group
  signature: string
  units: RiderUnit[]
  placed: boolean
  pedalPhase: number
}

const RIDER_LOOKS: readonly (typeof looks)[number][] = [
  'basic', 'hoodie', 'shell', 'denim', 'plaid', 'knit', 'track', 'outdoor', 'sport',
]
const KID_LOOKS: readonly (typeof looks)[number][] = ['campus', 'track', 'sport', 'hoodie']
const MAX_RIDER_DIST_SQ = 60 ** 2

const _qTmp = new THREE.Quaternion()
const _qOrient = new THREE.Quaternion()
const _qFingerStep = new THREE.Quaternion()
const _qParentFinger = new THREE.Quaternion()
const _qTargetRot = new THREE.Quaternion()
const _vDir = new THREE.Vector3()
const _vGoal = new THREE.Vector3()
const _vUp = new THREE.Vector3(0, 1, 0)
const _vShoulder = new THREE.Vector3()
const _vElbow = new THREE.Vector3()
const _vPalm = new THREE.Vector3()
const _vTarget = new THREE.Vector3()
const _vAxis = new THREE.Vector3()
const _vBend = new THREE.Vector3()
const _vElbowTgt = new THREE.Vector3()
const _vFrom = new THREE.Vector3()
const _vTo = new THREE.Vector3()
const _vCollar = new THREE.Vector3()
const _vReach = new THREE.Vector3()
const _qParentInv = new THREE.Quaternion()
const _qWrist = new THREE.Quaternion()
const _qDelta = new THREE.Quaternion()
const _overhandL = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0)),
)
const _overhandR = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0)),
)

function aimBoneWorld(bone: THREE.Object3D, origin: THREE.Vector3, end: THREE.Vector3, goal: THREE.Vector3): void {
  if (!bone.parent) return
  _qParentInv.copy(bone.parent.getWorldQuaternion(_qDelta)).invert()
  _vFrom.subVectors(end, origin).applyQuaternion(_qParentInv).normalize()
  _vTo.subVectors(goal, origin).applyQuaternion(_qParentInv).normalize()
  bone.quaternion.premultiply(_qDelta.setFromUnitVectors(_vFrom, _vTo))
}

const FINGER_DIGITS = ['index', 'middle', 'ring', 'pinky', 'thumb'] as const
const FINGER_DIRS_STD: readonly (readonly [number, number, number])[] = [
  [0.88, 0.48, 0],
  [0.57, -0.82, 0],
  [-0.30, -0.95, 0],
]
const FINGER_DIRS_THUMB: readonly (readonly [number, number, number])[] = [
  [0.84, 0.31, 0.44],
  [0.16, 0.68, -0.72],
  [-0.40, 0.32, -0.86],
]

function curlHandFingers(figure: THREE.Object3D, side: 'l' | 'r', strength = 1.0): void {
  const sign = side === 'r' ? 1 : -1
  for (const digit of FINGER_DIGITS) {
    const directions = digit === 'thumb' ? FINGER_DIRS_THUMB : FINGER_DIRS_STD
    _qParentFinger.identity()
    for (let index = 0; index < directions.length; index++) {
      const joint = figure.getObjectByName(`${digit}_0${index + 1}_${side}`)
      if (!joint) break
      const [down, forward, inward] = directions[index]
      _qOrient.copy(_qParentFinger).multiply(joint.quaternion)
      _vDir.copy(_vUp).applyQuaternion(_qOrient)
      _vGoal.set(-sign * down, forward, inward).normalize()
      _qOrient.premultiply(_qFingerStep.setFromUnitVectors(_vDir, _vGoal))
      _qTargetRot.copy(_qParentFinger).invert().multiply(_qOrient)
      joint.quaternion.slerp(_qTargetRot, strength)
      _qParentFinger.copy(_qOrient)
    }
  }
}

function snapBicycleGrip(figure: THREE.Object3D, frame: THREE.Object3D): void {
  frame.updateMatrixWorld(true)
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 'l' : 'r'
    const sign = i === 0 ? -1 : 1
    const overhand = i === 0 ? _overhandL : _overhandR
    const upper = figure.getObjectByName(`upperarm_${side}`)
    const lower = figure.getObjectByName(`lowerarm_${side}`)
    const hand = figure.getObjectByName(`hand_${side}`)
    if (!upper || !lower || !hand) continue
    upper.getWorldPosition(_vShoulder)
    lower.getWorldPosition(_vElbow)
    hand.getWorldPosition(_vPalm)
    // Exact bicycle grip position in frame (-Z forward) coordinates (matches vehicle-model.ts L104-105)
    frame.localToWorld(_vTarget.set(sign * 0.245, 0.992, -0.37))
    const upperLength = _vShoulder.distanceTo(_vElbow)
    const lowerLength = _vElbow.distanceTo(_vPalm)
    const shortfall = _vShoulder.distanceTo(_vTarget) - upperLength - lowerLength
    const clavicle = upper.parent
    if (shortfall > 0 && clavicle) {
      clavicle.getWorldPosition(_vCollar)
      _vReach.subVectors(_vTarget, _vShoulder).setLength(Math.min(0.14, shortfall * 1.35)).add(_vShoulder)
      aimBoneWorld(clavicle, _vCollar, _vShoulder, _vReach)
      upper.getWorldPosition(_vShoulder)
      lower.getWorldPosition(_vElbow)
    }
    _vAxis.subVectors(_vTarget, _vShoulder)
    const distance = Math.max(
      Math.abs(upperLength - lowerLength) + 1e-6,
      Math.min(_vAxis.length(), upperLength + lowerLength - 1e-6),
    )
    _vAxis.normalize()
    const along = (distance * distance + upperLength * upperLength - lowerLength * lowerLength) / (2 * distance)
    _vBend.subVectors(_vElbow, _vShoulder).addScaledVector(_vAxis, -_vBend.dot(_vAxis)).normalize()
    _vElbowTgt
      .copy(_vShoulder)
      .addScaledVector(_vAxis, along)
      .addScaledVector(_vBend, Math.sqrt(Math.max(0, upperLength * upperLength - along * along)))
    aimBoneWorld(upper, _vShoulder, _vElbow, _vElbowTgt)
    lower.getWorldPosition(_vElbow)
    hand.getWorldPosition(_vPalm)
    aimBoneWorld(lower, _vElbow, _vPalm, _vTarget)
    lower.getWorldQuaternion(_qWrist).invert().multiply(frame.getWorldQuaternion(_qTmp)).multiply(overhand)
    hand.quaternion.copy(_qWrist)
    curlHandFingers(figure, side, 1.0)
  }
}

function solvePedalIK(phase: number, riderScale = 0.9168): [number, number] {
  // Exact ankle IK matching static BatchedMesh bicycle crank pads (Left TOP y=0.452, Right BOT y=0.152, z=0.05)
  const ratio = riderScale / 0.9168
  const hipY = 0.823 * ratio + 0.046
  const L1 = 0.359 * ratio
  const L2 = 0.382 * ratio
  const dy = (0.440 + 0.138 * Math.cos(phase)) * ratio - hipY
  const dz = (0.095 - 0.010 * Math.cos(phase) - 0.045 * Math.sin(phase)) - 0.23
  const d = THREE.MathUtils.clamp(Math.hypot(dy, dz), 0.22, (L1 + L2) * 0.96)
  const alpha = Math.atan2(-dz, -dy)
  const cosKnee = THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1)
  const beta = Math.acos(THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1))
  return [alpha + beta, -(Math.PI - Math.acos(cosKnee))]
}

function setPose(
  rig: AvatarRig,
  pose: RiderSlotSpec['pose'],
  pedalPhase = 0,
  moving = true,
  riderScale = 1,
  frame?: THREE.Group,
  figure?: THREE.Group,
  wideLegs = false,
): void {
  const j = rig.joints
  const flare = wideLegs ? 0.24 : 0.02
  if (pose === 'ebike_driver') {
    j.Hips?.rotation.set(0, 0, 0)
    j.Torso?.rotation.set(-0.09, 0, 0)
    j.Head?.rotation.set(-0.02, 0, 0)
    j.ArmL?.rotation.set(0.92, 0, -0.05)
    j.ArmR?.rotation.set(0.92, 0, 0.05)
    j.ForearmL?.rotation.set(0.36, 0, 0)
    j.ForearmR?.rotation.set(0.36, 0, 0)
    j.ThighL?.rotation.set(1.22, 0, -flare)
    j.ThighR?.rotation.set(1.22, 0, flare)
    j.ShinL?.rotation.set(-1.42, 0, 0)
    j.ShinR?.rotation.set(-1.42, 0, 0)
  } else if (pose === 'ebike_child_front') {
    // Tall standing floorboard posture so chin/face sit completely clear above 1.13m handlebar stem
    j.Hips?.rotation.set(0, 0, 0)
    j.Torso?.rotation.set(-0.04, 0, 0)
    j.Head?.rotation.set(-0.06, 0.16, 0)
    j.ArmL?.rotation.set(0.46, -0.22, 0.08)
    j.ArmR?.rotation.set(0.46, 0.22, -0.08)
    j.ForearmL?.rotation.set(0.56, 0, 0)
    j.ForearmR?.rotation.set(0.56, 0, 0)
    j.ThighL?.rotation.set(0.08, 0, -0.05)
    j.ThighR?.rotation.set(0.08, 0, 0.05)
    j.ShinL?.rotation.set(-0.08, 0, 0)
    j.ShinR?.rotation.set(-0.08, 0, 0)
  } else if (pose === 'ebike_child_mid') {
    // Seated in middle saddle slot leaning torso cleanly past driver's +X shoulder (zero waist clip, all 4 heads visible)
    j.Hips?.rotation.set(0, 0, 0)
    j.Torso?.rotation.set(0.02, -0.08, -0.34)
    j.Head?.rotation.set(0.02, 0.14, 0.10)
    j.ArmL?.rotation.set(0.36, -0.06, -0.14)
    j.ArmR?.rotation.set(0.36, 0.06, 0.14)
    j.ForearmL?.rotation.set(0.48, 0, 0)
    j.ForearmR?.rotation.set(0.48, 0, 0)
    j.ThighL?.rotation.set(1.12, 0, -0.03)
    j.ThighR?.rotation.set(1.12, 0, 0.03)
    j.ShinL?.rotation.set(-1.34, 0, 0)
    j.ShinR?.rotation.set(-1.34, 0, 0)
  } else if (pose === 'ebike_passenger') {
    // Sits cleanly upright on rear rack hugging waist, legs tucked against body
    j.Hips?.rotation.set(0, 0, 0)
    j.Torso?.rotation.set(0.04, 0, -0.10)
    j.Head?.rotation.set(0.02, -0.12, 0.04)
    j.ArmL?.rotation.set(0.38, -0.12, -0.10)
    j.ArmR?.rotation.set(0.38, 0.12, 0.10)
    j.ForearmL?.rotation.set(0.55, 0, 0)
    j.ForearmR?.rotation.set(0.55, 0, 0)
    j.ThighL?.rotation.set(1.12, 0, -0.18)
    j.ThighR?.rotation.set(1.12, 0, 0.18)
    j.ShinL?.rotation.set(-1.26, 0, 0)
    j.ShinR?.rotation.set(-1.26, 0, 0)
  } else if (pose === 'bicycle_driver') {
    // Lock feet strictly onto static BatchedMesh crank phase 0 (Left TOP 12:00, Right BOT 6:00) so shoes never float off pedals
    const [tl, sl] = solvePedalIK(0, riderScale)
    const [tr, sr] = solvePedalIK(Math.PI, riderScale)
    j.Hips?.rotation.set(0, 0, 0)
    j.Torso?.rotation.set(-0.24, 0, 0)
    j.Head?.rotation.set(0.10, 0, 0)
    j.ArmL?.rotation.set(0.84, 0, -0.04)
    j.ArmR?.rotation.set(0.84, 0, 0.04)
    j.ForearmL?.rotation.set(0.42, 0, 0)
    j.ForearmR?.rotation.set(0.42, 0, 0)
    j.ThighL?.rotation.set(tl, 0, -0.05)
    j.ThighR?.rotation.set(tr, 0, 0.05)
    j.ShinL?.rotation.set(sl, 0, 0)
    j.ShinR?.rotation.set(sr, 0, 0)
  } else if (pose === 'bicycle_crossbar') {
    // Rear rack passenger holding driver's waist, legs straddling rear wheel cleanly
    j.Hips?.rotation.set(0, 0, 0)
    j.Torso?.rotation.set(-0.08, 0, 0)
    j.Head?.rotation.set(0.02, 0.16, 0)
    j.ArmL?.rotation.set(0.48, -0.20, 0.06)
    j.ArmR?.rotation.set(0.48, 0.20, -0.06)
    j.ForearmL?.rotation.set(0.68, 0, 0)
    j.ForearmR?.rotation.set(0.68, 0, 0)
    j.ThighL?.rotation.set(1.06, 0, -0.22)
    j.ThighR?.rotation.set(1.06, 0, 0.22)
    j.ShinL?.rotation.set(-1.18, 0, 0)
    j.ShinR?.rotation.set(-1.18, 0, 0)
  }
  rig.syncPose()

  if (figure) {
    if (pose === 'ebike_driver' && frame) {
      let steering = frame.getObjectByName('__rider-ebike-steering')
      if (!steering) {
        steering = new THREE.Object3D()
        steering.name = '__rider-ebike-steering'
        steering.position.set(0, 0, steeringZ)
        frame.add(steering)
      }
      frame.updateMatrixWorld(true)
      createEbikeGripPose(figure)(steering, 1.0)
    } else if (pose === 'bicycle_driver' && frame) {
      snapBicycleGrip(figure, frame)
    } else {
      curlHandFingers(figure, 'l', 0.85)
      curlHandFingers(figure, 'r', 0.85)
    }
  }
}

export function riderPool(
  scene: THREE.Scene,
  camera: THREE.Camera,
  groundAt?: (x: number, z: number, y: number, car: boolean) => number | undefined,
) {
  const mobile = touchUi()
  const LIMIT = mobile ? 4 : 8
  const MAX_SKELETONS = mobile ? 8 : 16
  const POOL = 12
  const templates: (Promise<RiderTemplate> | undefined)[] = new Array(POOL)
  const ready: (RiderTemplate | undefined)[] = new Array(POOL)
  const assigned = new WeakMap<object, {driverIdx: number; fourOnOverload: boolean; crossbarSide: -1 | 1}>()
  const active = new Map<TwoWheelActorLike, RiderView>()

  const getActorMeta = (actor: TwoWheelActorLike) => {
    let meta = assigned.get(actor)
    if (!meta) {
      meta = {
        driverIdx: Math.floor(Math.random() * POOL),
        fourOnOverload: Math.random() < 0.5,
        crossbarSide: Math.random() < 0.5 ? -1 : 1,
      }
      assigned.set(actor, meta)
    }
    return meta
  }

  let seed = 0x51a7
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(random() * arr.length)]

  // Slots 0..7 prewarmed immediately: even indices wear helmets, odd indices expose full hairstyles; 2/5/7 are kid-suitable.
  function makeLook(index: number): {avatar: Avatar; helmet: boolean; kid: boolean} {
    const helmet = index % 2 === 0
    const kid = index % 3 === 2 || index === 7
    const body: 'm' | 'f' = random() < 0.5 ? 'm' : 'f'
    const look = kid ? pick(KID_LOOKS) : pick(RIDER_LOOKS)
    const styles = hairStyles[body]
    const hair = styles[Math.floor(random() * styles.length)] as Avatar['hair']
    return {
      helmet,
      kid,
      avatar: {
        v: 1,
        body,
        skin: [0, 1, 1, 2, 2, 3, 4][Math.floor(random() * 7)],
        face: Math.floor(random() * faceNames.length),
        brows: Math.floor(random() * browNames.length),
        eyes: Math.floor(random() * eyeNames.length),
        hair,
        hairColor: [0, 0, 0, 1, 1, 2, 3][Math.floor(random() * 7)],
        look,
        createdAt: 1,
      },
    }
  }

  function template(index: number): RiderTemplate | undefined {
    if (!templates[index]) {
      const spec = makeLook(index)
      templates[index] = characterModel(spec.avatar)
        .then(model => {
          const rig = ensureAvatarRig(model.scene)
          const controller = styleCharacter(model.scene, rig, spec.avatar)
          const equipped = starterOutfit(spec.avatar.look)
          controller.applyEquipped(
            {...equipped, hat: spec.helmet ? 'hat_rider_helmet' : 'hat_none'},
            {ridingEbike: spec.helmet, autoHelmetOnRide: spec.helmet},
          )
          model.scene.userData = {}
          const entry: RiderTemplate = {
            scene: model.scene,
            hasHelmet: spec.helmet,
            isKidSuitable: spec.kid,
          }
          ready[index] = entry
          return entry
        })
      templates[index]!.catch(err => {
        templates[index] = undefined
        console.warn('Traffic rider template unavailable', err)
      })
    }
    return ready[index]
  }

  // Prewarm first 8 templates at boot (even=helmet, odd=no-helmet, 2/5/7=kid-friendly)
  for (let i = 0; i < Math.min(8, POOL); i++) void template(i)

  function pickTemplateIndex(wantHelmet: boolean, wantKid = false, exclude?: Set<number>): number | undefined {
    const matches: number[] = []
    for (let i = 0; i < POOL; i++) {
      if (exclude?.has(i)) continue
      const t = ready[i]
      if (!t) continue
      if (t.hasHelmet === wantHelmet && (!wantKid || t.isKidSuitable)) matches.push(i)
    }
    if (matches.length) return matches[Math.floor(Math.random() * matches.length)]
    for (let i = 0; i < POOL; i++) {
      if (exclude?.has(i)) continue
      const t = ready[i]
      if (t && t.hasHelmet === wantHelmet) return i
    }
    for (let i = 0; i < POOL; i++) {
      const t = ready[i]
      if (t && t.hasHelmet === wantHelmet) return i
    }
    return undefined
  }

  function planSpecs(
    actor: TwoWheelActorLike,
    subtype: TwoWheelSubtype,
    violation: TrafficViolation,
  ): RiderSlotSpec[] | undefined {
    const meta = getActorMeta(actor)

    if (subtype === 'bicycle') {
      const used = new Set<number>()
      const driverTpl = pickTemplateIndex(false, false, used)
      if (driverTpl === undefined) return undefined
      used.add(driverTpl)
      if (violation === 'bike_double') {
        const passTpl = pickTemplateIndex(false, false, used)
        if (passTpl === undefined) return undefined
        return [
          {templateIdx: driverTpl, scale: figureConfig.scale * 0.96, x: 0, y: 0.046, z: 0.23, ry: 0, pose: 'bicycle_driver'},
          {
            templateIdx: passTpl,
            scale: figureConfig.scale * 0.88,
            x: 0,
            y: -0.04,
            z: 0.50,
            ry: 0,
            pose: 'bicycle_crossbar',
          },
        ]
      }
      return [{templateIdx: driverTpl, scale: figureConfig.scale * 0.96, x: 0, y: 0.046, z: 0.23, ry: 0, pose: 'bicycle_driver'}]
    }

    // E-bike variants (distinct template index per rider so outfits/hairstyles never clone-twin)
    if (violation === 'ebike_overload') {
      const used = new Set<number>()
      const frontChildTpl = pickTemplateIndex(false, true, used)
      if (frontChildTpl === undefined) return undefined
      used.add(frontChildTpl)
      const driverTpl = pickTemplateIndex(false, false, used)
      if (driverTpl === undefined) return undefined
      used.add(driverTpl)
      const rearTpl = pickTemplateIndex(false, false, used)
      if (rearTpl === undefined) return undefined
      used.add(rearTpl)
      if (meta.fourOnOverload) {
        const midChildTpl = pickTemplateIndex(false, true, used)
        if (midChildTpl === undefined) return undefined
        return [
          {templateIdx: frontChildTpl, scale: 0.68, x: 0, y: 0.265, z: -0.20, ry: 0, pose: 'ebike_child_front'},
          {templateIdx: driverTpl, scale: figureConfig.scale * 0.96, x: 0, y: 0.02, z: 0.10, ry: 0, pose: 'ebike_driver'},
          {templateIdx: midChildTpl, scale: 0.72, x: 0.05, y: 0.34, z: 0.37, ry: 0, pose: 'ebike_child_mid'},
          {templateIdx: rearTpl, scale: figureConfig.scale * 0.90, x: 0.05, y: 0.08, z: 0.63, ry: 0, pose: 'ebike_passenger'},
        ]
      }
      return [
        {templateIdx: frontChildTpl, scale: 0.68, x: 0, y: 0.265, z: -0.18, ry: 0, pose: 'ebike_child_front'},
        {templateIdx: driverTpl, scale: figureConfig.scale * 0.97, x: 0, y: 0.02, z: 0.16, ry: 0, pose: 'ebike_driver'},
        {templateIdx: rearTpl, scale: figureConfig.scale * 0.90, x: 0, y: 0.02, z: 0.54, ry: 0, pose: 'ebike_passenger'},
      ]
    }

    const wantHelmet = violation !== 'no_helmet'
    const preferred = ready[meta.driverIdx]
    const driverTpl = preferred && preferred.hasHelmet === wantHelmet ? meta.driverIdx : pickTemplateIndex(wantHelmet)
    if (driverTpl === undefined) return undefined
    return [{templateIdx: driverTpl, scale: figureConfig.scale * 0.96, x: 0, y: 0.0, z: 0.23, ry: 0, pose: 'ebike_driver'}]
  }

  function release(actor: TwoWheelActorLike, view: RiderView): void {
    active.delete(actor)
    view.root.removeFromParent()
    view.root.traverse(node => {
      if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose()
    })
  }

  function build(actor: TwoWheelActorLike, subtype: TwoWheelSubtype, violation: TrafficViolation): RiderView | undefined {
    // Ensure remaining templates lazily warm up when needed
    for (let i = 0; i < POOL; i++) if (!templates[i]) { void template(i); break }
    const specs = planSpecs(actor, subtype, violation)
    if (!specs) return undefined

    const root = new THREE.Group()
    root.name = 'G2 traffic rider'
    // Vehicle models in walk/ (-Z forward) face opposite of traffic/sim (+Z forward)
    const frame = new THREE.Group()
    frame.rotation.y = Math.PI
    root.add(frame)

    const initialPedal = 0
    const units: RiderUnit[] = []
    for (const s of specs) {
      const tpl = ready[s.templateIdx]
      if (!tpl) continue
      const slot = new THREE.Group()
      slot.position.set(s.x, s.y, s.z)
      slot.rotation.set(0, s.ry, 0)
      slot.scale.setScalar(s.scale)
      frame.add(slot)

      const inst = clone(tpl.scene) as THREE.Group
      // IMPORTANT: Call ensureAvatarRig BEFORE adding/moving slot transforms (ensureAvatarRig resets root transforms!)
      const rig = ensureAvatarRig(inst)
      slot.add(inst)
      setPose(rig, s.pose, initialPedal, actor.speed > 0.15, s.scale, frame, inst, violation === 'ebike_overload')
      units.push({slot, root: inst, rig, pose: s.pose, baseY: s.y, scale: s.scale})
    }
    scene.add(root)
    const view: RiderView = {
      root,
      frame,
      signature: `${subtype}:${violation}`,
      units,
      placed: false,
      pedalPhase: initialPedal,
    }
    active.set(actor, view)
    return view
  }

  return {
    /**
     * Selects near two-wheel actors (<60 m) enforcing both vehicle limit (8 desktop / 4 mobile)
     * and total rigged skeleton budget (<= 16 desktop / <= 8 mobile); overflow cleanly stays on BatchedMesh stand-ins.
     */
    select(actors: readonly TwoWheelActorLike[]) {
      const cx = camera.position.x, cz = camera.position.z
      const candidates = actors
        .filter(a => a.kind === 'scooter' && !a.down && (a.x - cx) ** 2 + (a.z - cz) ** 2 < MAX_RIDER_DIST_SQ)
        .sort((a, b) => (a.x - cx) ** 2 + (a.z - cz) ** 2 - ((b.x - cx) ** 2 + (b.z - cz) ** 2))
      const near: TwoWheelActorLike[] = []
      let usedSkeletons = 0
      for (const a of candidates) {
        if (near.length >= LIMIT) break
        const {violation} = resolveTwoWheelSpec(a)
        const cost = violation === 'ebike_overload' ? (getActorMeta(a).fourOnOverload ? 4 : 3) : violation === 'bike_double' ? 2 : 1
        if (usedSkeletons + cost > MAX_SKELETONS) continue
        near.push(a)
        usedSkeletons += cost
      }
      const keep = new Set<TwoWheelActorLike>(near)
      for (const [actor, view] of active) {
        if (!keep.has(actor)) release(actor, view)
      }
      const shown = new Set<object>()
      for (const actor of near) {
        const {subtype, violation} = resolveTwoWheelSpec(actor)
        const sig = `${subtype}:${violation}`
        const existing = active.get(actor)
        if (existing && existing.signature !== sig) release(actor, existing)
        if (active.has(actor) || build(actor, subtype, violation)) shown.add(actor)
      }
      return shown
    },
    animate(
      dt: number,
      lag: number,
      onSync?: (actor: TwoWheelActorLike, x: number, y: number, z: number, yaw: number, scale: number) => void,
    ) {
      for (const [actor, view] of active) {
        const px = actor.x + Math.sin(actor.yaw) * actor.speed * lag
        const pz = actor.z + Math.cos(actor.yaw) * actor.speed * lag
        const py = groundAt?.(px, pz, actor.y, false) ?? actor.y
        const scale = Math.max(0.001, actor.scale)
        view.root.position.set(px, py, pz)
        view.root.rotation.y = actor.yaw
        view.root.scale.setScalar(scale)
        view.placed = true
        onSync?.(actor, px, py, pz, actor.yaw, scale)
        // Lock bicycle legs onto static BatchedMesh crank phase 0 so shoes always rest cleanly on physical pedals
      }
    },
    clear() {
      for (const [actor, view] of active) release(actor, view)
    },
    get count() {
      return active.size
    },
    get skeletonCount() {
      let n = 0
      for (const v of active.values()) n += v.units.length
      return n
    },
    get maxSkeletons() {
      return MAX_SKELETONS
    },
    get limit() {
      return LIMIT
    },
    probe: () =>
      [...active.entries()].map(([actor, v]) => ({
        signature: v.signature,
        riderCount: v.units.length,
        x: +v.root.position.x.toFixed(2),
        y: +v.root.position.y.toFixed(2),
        z: +v.root.position.z.toFixed(2),
        yaw: +v.root.rotation.y.toFixed(3),
        violation: actor.violation ?? 'none',
        subtype: actor.vehicleSubtype ?? 'ebike',
      })),
  }
}
