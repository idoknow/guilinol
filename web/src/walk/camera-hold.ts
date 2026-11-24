import {MathUtils, Matrix4, Object3D, Quaternion, SkinnedMesh, Vector3} from 'three'

const up = new Vector3(0, 1, 0)
// Camera props hang on an anchor that cancels the hand's bind rotation and point their lens down the
// anchor's -Z. Avatars face +Z, so the anchor is turned half a turn about Y: lens forward, screen to the
// player (gear/hand.ts adds the small downward tilt on the prop itself).
const holdFrame = new Quaternion().setFromAxisAngle(up, Math.PI)

/** Bind-pose rotation of a bone in character space (root = identity), from the skin's inverse bind matrices. */
function bindRotation(figure: Object3D, bone: Object3D) {
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

export function cameraHoldLayer(figure: Object3D) {
  const bone = (name: string) => figure.getObjectByName(name)!
  const shoulder = bone('upperarm_r'), elbow = bone('lowerarm_r'), wrist = bone('hand_r')
  const left = bone('upperarm_l'), chest = bone('spine_02')
  const joints = [shoulder, elbow, wrist].filter(Boolean)
  const rest = joints.map(joint => joint.quaternion.clone()), base = rest.map(rotation => rotation.clone())
  const target = new Vector3(), origin = new Vector3(), bend = new Vector3(), end = new Vector3()
  const right = new Vector3(), forward = new Vector3(), axis = new Vector3(), pole = new Vector3()
  const from = new Vector3(), to = new Vector3(), pivot = new Vector3()
  const rotation = new Quaternion(), parent = new Quaternion(), swing = new Quaternion()
  // Wrist relative to the chest: chest⁻¹(bind) · holdFrame · hand(bind). Constant per body, so the grip
  // rides the chest through every gait clip (IDOK-220) and the lens always looks where the body faces.
  const chestBind = chest && bindRotation(figure, chest), handBind = wrist && bindRotation(figure, wrist)
  const grip = chestBind && handBind
    ? chestBind.clone().invert().multiply(holdFrame).multiply(handBind).normalize()
    : new Quaternion(.011904, .632748, -.537671, .557119).normalize()
  let applied = false
  function reset() {
    if (applied) joints.forEach((joint, index) => joint.quaternion.copy(base[index]))
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
    applied = true
    shoulder.getWorldPosition(origin)
    right.subVectors(origin, left.getWorldPosition(pivot)).normalize()
    // Avatars face +Z; right × up points behind the back (IDOK-238), so forward = up × right.
    forward.crossVectors(up, right).normalize()
    chest.getWorldPosition(target).addScaledVector(forward, aim.forward).addScaledVector(up, aim.up).addScaledVector(right, aim.side)
    elbow.getWorldPosition(bend); wrist.getWorldPosition(end)
    const upper = origin.distanceTo(bend), lower = bend.distanceTo(end)
    axis.subVectors(target, origin)
    const distance = MathUtils.clamp(axis.length(), Math.abs(upper - lower) + 1e-6, upper + lower - 1e-6)
    if (axis.lengthSq() < 1e-12) axis.copy(forward)
    axis.normalize()
    pole.copy(up).negate().addScaledVector(right, .35)
    pole.addScaledVector(axis, -axis.dot(pole))
    if (pole.lengthSq() < 1e-10) pole.copy(forward).addScaledVector(axis, -axis.dot(forward))
    const along = (upper * upper - lower * lower + distance * distance) / (2 * distance)
    bend.copy(origin).addScaledVector(axis, along).addScaledVector(pole.normalize(), Math.sqrt(Math.max(0, upper * upper - along * along)))
    end.copy(origin).addScaledVector(axis, distance)
    aimBone(shoulder, elbow, bend); aimBone(elbow, wrist, end)
    chest.getWorldQuaternion(rotation).multiply(grip)
    wrist.quaternion.copy(wrist.parent!.getWorldQuaternion(parent).invert().multiply(rotation))
    if (blend < 1) joints.forEach((joint, index) => joint.quaternion.slerp(base[index], 1 - blend))
  }
  return {apply, reset, target}
}
