import * as T from 'three'

// Bind-space (+Z forward, +Y up, +X character left) posing helpers. A "delta" is the
// bone's absolute bind-space rotation: world = delta · bindWorld. Bake-time only.

export type Target = (name: string, delta: T.Quaternion, parent?: T.Quaternion) => void
export type Bind = (name: string) => T.Vector3

export const V = (x: number, y: number, z: number) => new T.Vector3(x, y, z)
export const identity = new T.Quaternion()
export const axis = (x: number, y: number, z: number, a: number) =>
  new T.Quaternion().setFromAxisAngle(V(x, y, z), a)
/** Yaw (+left) · pitch (+forward) · roll (+right), relative to the parent frame. */
export const ypr = (yaw: number, pitch: number, roll: number) =>
  axis(0, 1, 0, yaw).multiply(axis(1, 0, 0, pitch)).multiply(axis(0, 0, 1, roll))
export const sideSign = (side: string) => (side === 'l' ? 1 : -1)

export function aim(side: number, x: number, y: number, z: number) {
  return new T.Quaternion().setFromUnitVectors(V(side, 0, 0), V(x, y, z).normalize())
}
/** Hand delta whose fingers run along `fingers` with the palm facing `normal`. */
export function palm(side: number, fingers: T.Vector3, normal: T.Vector3) {
  const x = fingers.clone().normalize().multiplyScalar(side)
  const y = normal.clone().negate()
  y.addScaledVector(x, -y.dot(x))
  if (y.lengthSq() < 1e-6) y.set(0, 1, 0).addScaledVector(x, -x.y)
  y.normalize()
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, x.clone().cross(y)))
}

/** Two-bone arm solve from an explicit shoulder; elbow bends toward `poleDir`. */
export function armIK(side: string, shoulder: T.Vector3, goal: T.Vector3, poleDir: T.Vector3, bind: Bind) {
  const elbow = bind('lowerarm_' + side),
    wrist = bind('hand_' + side)
  const humerus = elbow.clone().sub(bind('upperarm_' + side)),
    forearm = wrist.clone().sub(elbow)
  const reach = goal.clone().sub(shoulder),
    raw = reach.length()
  const hLen = humerus.length(),
    fLen = forearm.length()
  const distance = T.MathUtils.clamp(raw, Math.abs(hLen - fLen) + 0.015, hLen + fLen - 0.004)
  reach.normalize()
  const along = (humerus.lengthSq() - forearm.lengthSq() + distance * distance) / (2 * distance)
  const pole = poleDir.clone()
  pole.addScaledVector(reach, -pole.dot(reach))
  if (pole.lengthSq() < 1e-8) pole.set(sideSign(side), -0.5, 0).addScaledVector(reach, -reach.x * sideSign(side))
  pole.normalize()
  const end = distance === raw ? goal.clone().sub(shoulder) : reach.clone().multiplyScalar(distance)
  const offset = reach
    .multiplyScalar(along)
    .addScaledVector(pole, Math.sqrt(Math.max(0, humerus.lengthSq() - along * along)))
  const upper = new T.Quaternion().setFromUnitVectors(humerus.normalize(), offset.clone().normalize())
  const lower = new T.Quaternion().setFromUnitVectors(forearm.normalize(), end.sub(offset).normalize())
  return {upper, lower}
}

/** Hand the forearm a share of the wrist roll so the skin twists along the bone, not at the wrist. */
export function shareTwist(lower: T.Quaternion, hand: T.Quaternion, side: string, bind: Bind, amount: number) {
  if (amount === 0) return lower.clone()
  const f = bind('hand_' + side).sub(bind('lowerarm_' + side)).normalize()
  const r = lower.clone().invert().multiply(hand)
  const along = r.x * f.x + r.y * f.y + r.z * f.z
  const twist = new T.Quaternion(f.x * along, f.y * along, f.z * along, r.w)
  if (twist.lengthSq() < 1e-10) return lower.clone()
  twist.normalize()
  if (twist.w < 0) twist.set(-twist.x, -twist.y, -twist.z, -twist.w)
  return lower.clone().multiply(new T.Quaternion().slerp(twist, amount))
}

export interface Body {
  P: T.Quaternion
  D1: T.Quaternion
  D3: T.Quaternion
  pelvis: T.Vector3
  p1: T.Vector3
  p3: T.Vector3
}

/** Pelvis → spine ×3 → neck → head, each relative rotation applied in its parent's posed frame. */
export function torso(
  set: Target,
  bind: Bind,
  pelvis: T.Vector3,
  P: T.Quaternion,
  spine: readonly [T.Quaternion, T.Quaternion, T.Quaternion],
  neck: T.Quaternion,
  head: T.Quaternion,
  withPelvis = true,
): Body {
  const D1 = P.clone().multiply(spine[0]),
    D2 = D1.clone().multiply(spine[1]),
    D3 = D2.clone().multiply(spine[2])
  const Dn = D3.clone().multiply(neck),
    Dh = Dn.clone().multiply(head)
  if (withPelvis) set('pelvis', P)
  set('spine_01', D1, P)
  set('spine_02', D2, D1)
  set('spine_03', D3, D2)
  set('neck_01', Dn, D3)
  set('head', Dh, Dn)
  const b0 = bind('pelvis'),
    b1 = bind('spine_01'),
    b2 = bind('spine_02'),
    b3 = bind('spine_03')
  const p1 = pelvis.clone().add(b1.clone().sub(b0).applyQuaternion(P))
  const p2 = p1.clone().add(b2.clone().sub(b1).applyQuaternion(D1))
  const p3 = p2.clone().add(b3.sub(b2).applyQuaternion(D2))
  return {P, D1, D3, pelvis, p1, p3}
}

/** Converts a point authored in a posed bone's bind frame into chest-local (spine_03 at bind) space. */
export function toChest(body: Body, bind: Bind, frame: 'pelvis' | 'spine_01', point: T.Vector3) {
  const [delta, origin] = frame === 'pelvis' ? [body.P, body.pelvis] : [body.D1, body.p1]
  const world = point.clone().sub(bind(frame)).applyQuaternion(delta).add(origin)
  return world.sub(body.p3).applyQuaternion(body.D3.clone().invert()).add(bind('spine_03'))
}

/** Planted two-bone leg: hip follows the posed pelvis, ankle lands on `ankle`, foot stays flat. */
export function leg(set: Target, bind: Bind, side: string, body: Body, ankle: T.Vector3, footYaw: number) {
  const s = sideSign(side)
  const bh = bind('thigh_' + side),
    bk = bind('calf_' + side),
    ba = bind('foot_' + side)
  const hip = bh.clone().sub(bind('pelvis')).applyQuaternion(body.P).add(body.pelvis)
  const k0 = bk.clone().sub(bh),
    s0 = ba.sub(bk)
  const L1 = k0.length(),
    L2 = s0.length()
  const reach = ankle.clone().sub(hip)
  const D = T.MathUtils.clamp(reach.length(), Math.abs(L1 - L2) + 0.001, L1 + L2 - 0.0005)
  reach.normalize()
  const Y = axis(0, 1, 0, footYaw)
  const pole = V(s * 0.12, 0, 1).applyQuaternion(Y)
  pole.addScaledVector(reach, -pole.dot(reach)).normalize()
  const along = (L1 * L1 - L2 * L2 + D * D) / (2 * D)
  const knee = reach.clone().multiplyScalar(along).addScaledVector(pole, Math.sqrt(Math.max(0, L1 * L1 - along * along)))
  const shin = reach.multiplyScalar(D).sub(knee)
  const thigh = new T.Quaternion().setFromUnitVectors(k0.applyQuaternion(Y).normalize(), knee.normalize()).multiply(Y)
  const calf = new T.Quaternion().setFromUnitVectors(s0.applyQuaternion(Y).normalize(), shin.normalize()).multiply(Y)
  set('thigh_' + side, thigh, body.P)
  set('calf_' + side, calf, thigh)
  set('foot_' + side, Y, calf)
}

export const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const
/** 12 curls: [index×3, middle×3, ring×3, pinky×3]. */
export type Curls = readonly number[]
export interface Digits {
  curls: Curls
  /** + fans the fingers apart, − presses them together. */
  spread: number
  thumbBend: number
  /** Thumb pointing along `upDir` (thumbs-up). */
  up?: {weight: number; dir: T.Vector3; bend: number}
  /** Thumb folded over curled fingers (fist). */
  tuck?: number
  /** Thumb laid straight along the index (blade hand). */
  blade?: number
}
export const curlMix = (a: Curls, b: Curls, w: number) => a.map((v, i) => v + (b[i] - v) * w)
export const curlAdd = (a: Curls, k: number, per?: Curls) => a.map((v, i) => v + k * (per ? per[i] : 1))

const FAN = {index: 1, middle: 0.3, ring: -0.4, pinky: -1} as const
// Per-finger convergence offsets that cancel the mesh's native bind splay (~3.8 cm) into a seamless knife-hand blade.
const BLADE_CLOSE = {index: 0.3, middle: 0.08, ring: -0.17, pinky: -0.38} as const
const THUMB_BIND = (s: number) => V(s * 0.76, -0.46, 0.44).normalize()

/** Hand-relative joint rotations: delta(joint) = hand · shape[joint]. */
export type Shape = Map<string, T.Quaternion>

export function shapeHand(side: string, hand: T.Quaternion, d: Digits): Shape {
  const s = sideSign(side),
    shape: Shape = new Map()
  const bladeAmt = d.blade ?? 0
  FINGERS.forEach((finger, f) => {
    const yaw0 = -s * d.spread * FAN[finger] + s * bladeAmt * BLADE_CLOSE[finger]
    let rel = axis(0, 1, 0, yaw0)
    for (let i = 1; i <= 3; i++) {
      if (i === 2 && bladeAmt > 0 && (finger === 'index' || finger === 'pinky')) {
        rel = rel.clone().multiply(axis(0, 1, 0, s * bladeAmt * (finger === 'index' ? 0.08 : -0.09)))
      }
      rel = rel.clone().multiply(axis(0, 0, 1, -s * d.curls[f * 3 + i - 1]))
      shape.set(finger + '_0' + i, rel)
    }
  })
  let rel = new T.Quaternion()
  const handInv = hand.clone().invert()
  // In the T-pose bind frame, the thumb leans heavily toward the palm (-Y, ~31°),
  // which pokes straight into the thighs/belly when the palm faces inward. Align the
  // resting thumb closer to the index side so idle/transition frames stay clean.
  const restThumb01 = new T.Quaternion().setFromUnitVectors(THUMB_BIND(s), V(s * 0.87, -0.14, 0.47).normalize())
  const baseThumb: T.Quaternion[] = []
  rel = restThumb01.clone()
  for (let i = 1; i <= 3; i++) {
    if (i > 1) rel = rel.clone().multiply(axis(0, 0, 1, -s * d.thumbBend * 0.72))
    else rel = rel.clone().multiply(axis(0, 0, 1, -s * d.thumbBend * 0.35))
    baseThumb.push(rel.clone())
  }
  const upThumb: T.Quaternion[] = []
  if (d.up && d.up.weight > 0) {
    let u = new T.Quaternion().setFromUnitVectors(
      V(s * 0.78, -0.46, 0.43).normalize(),
      d.up.dir.clone().applyQuaternion(handInv).normalize(),
    )
    for (let i = 1; i <= 3; i++) {
      if (i > 1) u = u.clone().multiply(axis(0, 0, 1, -s * d.up.bend))
      upThumb.push(u.clone())
    }
  }
  const tuckThumb: T.Quaternion[] = []
  if (d.tuck) {
    // Wrap the thumb flush across the curled index & middle phalanges so it sits tightly on the fist.
    const targets = [V(s * 0.96, -0.22, 0.08), V(s * 0.45, -0.35, -0.82), V(-s * 0.15, -0.1, -0.98)]
    for (let i = 0; i < 3; i++) tuckThumb.push(new T.Quaternion().setFromUnitVectors(THUMB_BIND(s), targets[i].normalize()))
  }
  const bladeThumb: T.Quaternion[] = []
  if (bladeAmt > 0) {
    // Align all three thumb segments snugly along the side of the index finger (zero outward splay).
    const targets = [V(s * 0.97, 0.1, 0.16), V(s * 0.98, 0.04, 0.04), V(s * 0.99, -0.02, -0.05)]
    for (let i = 0; i < 3; i++) bladeThumb.push(new T.Quaternion().setFromUnitVectors(THUMB_BIND(s), targets[i].normalize()))
  }
  for (let i = 1; i <= 3; i++) {
    const q = baseThumb[i - 1].clone()
    if (d.up && d.up.weight > 0) q.slerp(upThumb[i - 1], d.up.weight)
    if (d.tuck) q.slerp(tuckThumb[i - 1], d.tuck)
    if (bladeAmt > 0) q.slerp(bladeThumb[i - 1], bladeAmt)
    shape.set('thumb_0' + i, q)
  }
  return shape
}

export function blendShape(a: Shape, b: Shape, w: number): Shape {
  if (w <= 0) return a
  if (w >= 1) return b
  const out: Shape = new Map()
  for (const [k, q] of a) out.set(k, q.clone().slerp(b.get(k)!, w))
  return out
}

/** Writes all 15 digit joints. `frame` is the chest delta every arm rotation is carried by. */
export function setHand(set: Target, side: string, frame: T.Quaternion, hand: T.Quaternion, shape: Shape, absolute?: Shape) {
  const H = frame.clone().multiply(hand)
  for (const finger of [...FINGERS, 'thumb']) {
    let parent = H
    for (let i = 1; i <= 3; i++) {
      const key = finger + '_0' + i
      const local = absolute?.get(key) ?? hand.clone().multiply(shape.get(key)!)
      const delta = frame.clone().multiply(local)
      set(key + '_' + side, delta, parent)
      parent = delta
    }
  }
}

export interface ArmPose {
  /** Wrist goal, chest-local bind space. */
  wrist: T.Vector3
  pole: T.Vector3
  hand: T.Quaternion
  shape: Shape
  absolute?: Shape
  /** Clavicle lift and protraction in radians. */
  shrug: number
  reach: number
  /** Share of the wrist roll carried by the forearm (default 0.4). */
  twist?: number
}

/** Clavicle → arm → hand → fingers, all rigidly carried by the chest delta `D3`. */
export function setArm(set: Target, bind: Bind, side: string, D3: T.Quaternion, pose: ArmPose) {
  const s = sideSign(side)
  const clav = axis(0, 0, 1, s * pose.shrug).multiply(axis(0, 1, 0, -s * pose.reach))
  const cb = bind('clavicle_' + side)
  const shoulder =
    pose.shrug === 0 && pose.reach === 0
      ? bind('upperarm_' + side)
      : bind('upperarm_' + side).sub(cb).applyQuaternion(clav).add(cb)
  const {upper, lower} = armIK(side, shoulder, pose.wrist, pose.pole, bind)
  const forearm = shareTwist(lower, pose.hand, side, bind, pose.twist ?? 0.4)
  const C = D3.clone().multiply(clav),
    U = D3.clone().multiply(upper),
    L = D3.clone().multiply(forearm)
  set('clavicle_' + side, C, D3)
  set('upperarm_' + side, U, C)
  set('lowerarm_' + side, L, U)
  set('hand_' + side, D3.clone().multiply(pose.hand), L)
  setHand(set, side, D3, pose.hand, pose.shape, pose.absolute)
}
