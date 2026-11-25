import {MathUtils, Matrix4, Object3D, Quaternion, SkinnedMesh, Vector3} from 'three'

const up = new Vector3(0, 1, 0)
const ROT_Y_PI = new Quaternion().setFromAxisAngle(up, Math.PI)

/** Default chest-relative wrist target (metres): right side of chest, never crossing midline. */
export const DEFAULT_CAMERA_HOLD_AIM: {readonly forward: number; readonly up: number; readonly side: number} = {
  forward: 0.30,
  up: 0.15,
  side: 0.18,
}

/** Bind-space offset from `hand_r` wrist joint into the right palm grip hollow (-X fingers, -Y palm, +Z thumb). */
const PALM_BIND_OFFSET = new Vector3(-0.078, -0.036, 0.004)

/**
 * Natural ergonomic right-hand grip orientation delta in bind space (+Z forward, -X right, +Y up):
 * - fingers extend forward along the forearm (gentle natural cant),
 * - palm faces inward (+X) cradling the camera grip,
 * - back of hand faces outward (-X) and thumb sits on top (+Y).
 */
export const CAMERA_HAND_GRIP_DELTA = (() => {
  const fingers = new Vector3(0.12, 0.22, 1).normalize()
  const palmNormal = new Vector3(1, 0.14, -0.12).normalize()
  const x = fingers.clone().negate()
  const y = palmNormal.clone().negate()
  y.addScaledVector(x, -y.dot(x)).normalize()
  const z = new Vector3().crossVectors(x, y)
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z))
})()

/** Bind-pose rotation of a bone in character space (root = identity), from the skin's inverse bind matrices. */
export function bindRotation(figure: Object3D, bone: Object3D) {
  let found: Quaternion | undefined
  figure.traverse((node) => {
    if (found || !(node instanceof SkinnedMesh)) return
    const index = node.skeleton.bones.indexOf(bone as never)
    if (index < 0) return
    const bind = new Matrix4().copy(node.skeleton.boneInverses[index]).invert()
    found = new Quaternion().setFromRotationMatrix(bind)
  })
  return found
}

/**
 * Local position and rotation for `attach_hand_r` under `hand_r` so that:
 * - the camera grip sits inside the right palm pocket (not at the wrist joint),
 * - when `hand_r` is in its natural ergonomic grip (`CAMERA_HAND_GRIP_DELTA`), the anchor aims
 *   `-Z` straight forward (lens forward), `+Y` up (top plate), and `+X` right (right-hand grip).
 */
export function cameraAnchorLocalPose(handBind: Quaternion): {position: Vector3; quaternion: Quaternion} {
  const invBind = handBind.clone().invert()
  const position = PALM_BIND_OFFSET.clone().applyQuaternion(invBind)
  const quaternion = invBind.clone().multiply(CAMERA_HAND_GRIP_DELTA.clone().invert()).multiply(ROT_Y_PI)
  return {position, quaternion}
}

interface FingerGripEntry {
  bone: Object3D
  base: Quaternion
  target: Quaternion
}

function buildRightFingerGrip(figure: Object3D): FingerGripEntry[] {
  const entries: FingerGripEntry[] = []
  const bindPos = new Map<string, Vector3>()
  const bindRot = new Map<string, Quaternion>()
  figure.traverse((node) => {
    if (bindRot.size || !(node instanceof SkinnedMesh)) return
    node.skeleton.bones.forEach((b, i) => {
      const m = new Matrix4().copy(node.skeleton.boneInverses[i]).invert()
      bindPos.set(b.name, new Vector3().setFromMatrixPosition(m))
      bindRot.set(b.name, new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(m)))
    })
  })
  if (!bindRot.size) return entries

  const handBind = bindRot.get('hand_r')
  if (!handBind) return entries
  const identity = new Quaternion()
  const axisZ = new Vector3(0, 0, 1)

  const addJoint = (name: string, parentName: string, delta: Quaternion, parentDelta: Quaternion) => {
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
    entries.push({bone, base: bone.quaternion.clone(), target: local})
  }

  // Four fingers curl smoothly toward the palm (RotZ(+bend) in right-hand bind space).
  // Index curves cleanly onto the top shutter button; middle/ring/pinky wrap around the grip.
  const curls: Record<string, readonly [number, number, number]> = {
    index: [0.58, 0.78, 0.56],
    middle: [0.88, 1.02, 0.72],
    ring: [0.94, 1.06, 0.74],
    pinky: [0.98, 1.04, 0.70],
  }
  for (const [finger, bends] of Object.entries(curls)) {
    let parentDelta = identity.clone()
    let parentName = 'hand_r'
    for (let i = 1; i <= 3; i++) {
      const name = `${finger}_0${i}_r`
      const turn = new Quaternion().setFromAxisAngle(axisZ, bends[i - 1])
      const delta = parentDelta.clone().multiply(turn)
      addJoint(name, parentName, delta, parentDelta)
      parentDelta = delta
      parentName = name
    }
  }

  // Thumb tucks cleanly inward/forward onto the rear thumb rest without poking outward in high-angle views.
  const t1 = bindPos.get('thumb_01_r')
  const t2 = bindPos.get('thumb_02_r')
  const t3 = bindPos.get('thumb_03_r')
  const t4 = bindPos.get('thumb_04_leaf_r')
  if (t1 && t2 && t3 && t4) {
    const seg1 = t2.clone().sub(t1).normalize()
    const goal1 = new Vector3(-0.80, -0.56, 0.20).normalize()
    const d1 = new Quaternion().setFromUnitVectors(seg1, goal1)
    addJoint('thumb_01_r', 'hand_r', d1, identity)

    const seg2 = t3.clone().sub(t2).applyQuaternion(d1).normalize()
    const goal2 = new Vector3(-0.68, -0.72, 0.12).normalize()
    const d2 = new Quaternion().setFromUnitVectors(seg2, goal2).multiply(d1)
    addJoint('thumb_02_r', 'thumb_01_r', d2, d1)

    const seg3 = t4.clone().sub(t3).applyQuaternion(d2).normalize()
    const goal3 = new Vector3(-0.46, -0.88, 0.06).normalize()
    const d3 = new Quaternion().setFromUnitVectors(seg3, goal3).multiply(d2)
    addJoint('thumb_03_r', 'thumb_02_r', d3, d2)
  }

  return entries
}

export function cameraHoldLayer(figure: Object3D) {
  const bone = (name: string) => figure.getObjectByName(name)!
  const shoulder = bone('upperarm_r'), elbow = bone('lowerarm_r'), wrist = bone('hand_r')
  const left = bone('upperarm_l'), chest = bone('spine_02')
  const joints = [shoulder, elbow, wrist].filter(Boolean)
  const rest = joints.map(joint => joint.quaternion.clone()), base = rest.map(rotation => rotation.clone())
  const fingers = buildRightFingerGrip(figure)
  const target = new Vector3(), origin = new Vector3(), bend = new Vector3(), end = new Vector3()
  const right = new Vector3(), forward = new Vector3(), axis = new Vector3(), pole = new Vector3()
  const from = new Vector3(), to = new Vector3(), pivot = new Vector3()
  const foreAxis = new Vector3(), curBack = new Vector3(), tgtBack = new Vector3(), crossTmp = new Vector3()
  const leftH = new Vector3(), fwdH = new Vector3(), basisMat = new Matrix4()
  const rotation = new Quaternion(), parent = new Quaternion(), swing = new Quaternion(), elbowWorld = new Quaternion()
  const handBind = wrist && bindRotation(figure, wrist)
  const lowerBindInv = elbow && bindRotation(figure, elbow)?.clone().invert()
  const handBindInv = handBind?.clone().invert()
  // Natural right-hand grip orientation in the upright body-heading frame (leftH, up, fwdH):
  // stays horizon-level and anatomically aligned with the forearm across idle/walk/run/sprint.
  const handGripInBody = CAMERA_HAND_GRIP_DELTA.clone().multiply(handBind ?? new Quaternion())
  let applied = false
  function reset() {
    if (applied) {
      joints.forEach((joint, index) => joint.quaternion.copy(base[index]))
      for (const entry of fingers) entry.bone.quaternion.copy(entry.base)
    }
    applied = false
  }
  function aimBone(joint: Object3D, child: Object3D, point: Vector3) {
    joint.getWorldPosition(pivot)
    child.getWorldPosition(from).sub(pivot).normalize()
    to.subVectors(point, pivot).normalize()
    swing.setFromUnitVectors(from, to)
    joint.getWorldQuaternion(rotation).premultiply(swing)
    joint.quaternion.copy(joint.parent!.getWorldQuaternion(parent).invert().multiply(rotation))
  }
  function apply(blend: number, aim: {forward: number; up: number; side: number}) {
    if (!blend || joints.length !== 3 || !left || !chest) return
    joints.forEach((joint, index) => { base[index].copy(joint.quaternion); joint.quaternion.copy(rest[index]) })
    for (const entry of fingers) entry.base.copy(entry.bone.quaternion)
    applied = true
    shoulder.getWorldPosition(origin)
    right.subVectors(origin, left.getWorldPosition(pivot)).normalize()
    // Avatars face +Z in bind space; right × up points behind the back (IDOK-238), so forward = up × right.
    forward.crossVectors(up, right).normalize()
    chest.getWorldPosition(target).addScaledVector(forward, aim.forward).addScaledVector(up, aim.up).addScaledVector(right, aim.side)
    elbow.getWorldPosition(bend); wrist.getWorldPosition(end)
    const upper = origin.distanceTo(bend), lower = bend.distanceTo(end)
    axis.subVectors(target, origin)
    const distance = MathUtils.clamp(axis.length(), Math.abs(upper - lower) + 1e-6, upper + lower - 1e-6)
    if (axis.lengthSq() < 1e-12) axis.copy(forward)
    axis.normalize()
    pole.copy(up).negate().addScaledVector(right, .38)
    pole.addScaledVector(axis, -axis.dot(pole))
    if (pole.lengthSq() < 1e-10) pole.copy(forward).addScaledVector(axis, -axis.dot(forward))
    const along = (upper * upper - lower * lower + distance * distance) / (2 * distance)
    bend.copy(origin).addScaledVector(axis, along).addScaledVector(pole.normalize(), Math.sqrt(Math.max(0, upper * upper - along * along)))
    end.copy(origin).addScaledVector(axis, distance)
    aimBone(shoulder, elbow, bend); aimBone(elbow, wrist, end)

    // Natural ergonomic hand world orientation in the upright body-heading frame (no 180° wrist reversal,
    // and level lens even when torso leans forward during run/sprint).
    leftH.set(-right.x, 0, -right.z)
    if (leftH.lengthSq() < 1e-8) leftH.set(-right.x, -right.y, -right.z)
    leftH.normalize()
    fwdH.crossVectors(leftH, up).normalize()
    rotation.setFromRotationMatrix(basisMat.makeBasis(leftH, up, fwdH)).multiply(handGripInBody)

    // Share 65% of axial forearm supination onto lowerarm_r around the elbow→wrist axis to avoid wrist skin pinch.
    if (lowerBindInv && handBindInv) {
      elbow.getWorldPosition(pivot)
      wrist.getWorldPosition(from)
      foreAxis.subVectors(from, pivot)
      if (foreAxis.lengthSq() > 1e-10) {
        foreAxis.normalize()
        elbow.getWorldQuaternion(elbowWorld)
        curBack.copy(up).applyQuaternion(lowerBindInv).applyQuaternion(elbowWorld)
        curBack.addScaledVector(foreAxis, -foreAxis.dot(curBack))
        tgtBack.copy(up).applyQuaternion(handBindInv).applyQuaternion(rotation)
        tgtBack.addScaledVector(foreAxis, -foreAxis.dot(tgtBack))
        if (curBack.lengthSq() > 1e-8 && tgtBack.lengthSq() > 1e-8) {
          curBack.normalize(); tgtBack.normalize()
          const sinA = foreAxis.dot(crossTmp.crossVectors(curBack, tgtBack))
          const cosA = MathUtils.clamp(curBack.dot(tgtBack), -1, 1)
          const roll = Math.atan2(sinA, cosA) * 0.65
          swing.setFromAxisAngle(foreAxis, roll)
          elbowWorld.premultiply(swing)
          elbow.quaternion.copy(elbow.parent!.getWorldQuaternion(parent).invert().multiply(elbowWorld))
        }
      }
    }

    wrist.quaternion.copy(wrist.parent!.getWorldQuaternion(parent).invert().multiply(rotation))
    for (const entry of fingers) entry.bone.quaternion.copy(entry.target)
    if (blend < 1) {
      joints.forEach((joint, index) => joint.quaternion.slerp(base[index], 1 - blend))
      for (const entry of fingers) entry.bone.quaternion.slerp(entry.base, 1 - blend)
    }
  }
  return {apply, reset, target}
}
