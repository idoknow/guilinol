import * as T from 'three'
import {curve, easeOut, smooth} from './curves.ts'
import {
  V,
  axis,
  blendShape,
  curlMix,
  leg,
  palm,
  setArm,
  shapeHand,
  torso,
  ypr,
  type Bind,
  type Shape,
  type Target,
} from './rig.ts'
import {OPEN, RELAXED, REST, SIDES, ankle, type Choreo, type Extras} from './presets.ts'

// 以下犯上 3.0s — sink & cock the wrists → hands carve in and click into the seal
// (locked 0.44–0.65s, covering the t=0.5 geometry test) → shoulders gather the breath →
// whole upper body presses the seal forward with a held tremor → unhook, release, stand.

const thumbJoint = (link: number, side: string) => 'thumb_' + (link === 4 ? '04_leaf' : '0' + link) + '_' + side

interface Seal {
  hand: T.Quaternion
  wrist: T.Vector3
  pole: T.Vector3
  absolute: Shape
  relative: Shape
}

/** The approved seal, computed exactly as before so the locked frames stay bit-identical. */
function sealPose(side: string, s: number, bind: Bind): Seal {
  const up = s === -1
  const hand = palm(s, V(0, up ? 1 : -1, 0), V(0, 0, up ? 1 : -1))
  // Place the thumb roots first, then solve the elbow around the shoulder–wrist line.
  // This keeps both thumbs together even though the two palms face opposite ways.
  const thumbOffset = bind('thumb_01_' + side)
    .sub(bind('hand_' + side))
    .applyQuaternion(hand)
  const wrist = V(s * 0.06723232, 1.34 + s * 0.00623384, 0.3).sub(thumbOffset)
  const absolute: Shape = new Map()
  for (const finger of ['index', 'middle', 'ring', 'pinky', 'thumb']) {
    let parent = hand
    for (let i = 1; i <= 3; i++) {
      const bend =
        finger === 'thumb'
          ? 0.17
          : finger === 'ring' || finger === 'pinky'
            ? [1.55, 1.55, 1.1][i - 1]
            : 0.025
      let delta = parent.clone().multiply(axis(0, 0, 1, -s * bend))
      if ((finger === 'ring' || finger === 'pinky') && i === 1) {
        // Tilt the flexion plane around bind +X so the curled ring & pinky fold strictly INSIDE the palm width (never poking out past the ulnar edge).
        const inwardRoll = finger === 'pinky' ? 0.34 : 0.16
        delta = parent.clone().multiply(axis(1, 0, 0, -inwardRoll)).multiply(axis(0, 0, 1, -s * bend))
      }
      if (finger === 'thumb') {
        const segment = bind(thumbJoint(i + 1, side)).sub(bind(thumbJoint(i, side)))
        // Smooth progressive hook arc across all 3 phalanges (avoids a harsh 90° snap at the tip)
        // while keeping right thumb strictly in front of left with >3mm surface clearance.
        const rightBind = V(-Math.abs(segment.x), segment.y, segment.z)
        const from = palm(1, rightBind, V(0, -1, 0))
        const dir = i === 1 ? V(1, -0.06, 0.45) : i === 2 ? V(0.94, 0.32, -0.14) : V(0.2, 0.98, 0.03)
        const to = palm(1, dir, V(0, 0, 1))
        delta.copy(to).multiply(from.invert())
        if (s === 1) delta.multiply(axis(1, 0, 0, Math.PI))
      }
      if (finger === 'index' || finger === 'middle') {
        const convergence = finger === 'index' ? [0.145, 0.115, 0.165] : [-0.105, -0.095, -0.125]
        delta
          .copy(hand)
          .multiply(axis(0, 1, 0, s * convergence[i - 1]))
          .multiply(axis(0, 0, 1, -s * 0.025))
      }
      absolute.set(finger + '_0' + i, delta)
      parent = delta
    }
  }
  const inverse = hand.clone().invert()
  const relative: Shape = new Map([...absolute].map(([k, q]) => [k, inverse.clone().multiply(q)] as const))
  // Natural angled left elbow + forearm twist sharing eliminates both the deltoid lump and harsh 90° wrist fold.
  return {hand, wrist, pole: up ? V(s * 0.62, -1, -0.12) : V(s * 0.88, -0.4, -0.26), absolute, relative}
}

const bezier = (a: T.Vector3, c: T.Vector3, b: T.Vector3, u: number) =>
  a
    .clone()
    .multiplyScalar((1 - u) * (1 - u))
    .addScaledVector(c, 2 * u * (1 - u))
    .addScaledVector(b, u * u)

/** spine_01/02 hand back to the idle chain while the seal is locked (see Extras.core). */
const CORE = curve([
  [0, 1],
  [0.28, 1],
  [0.4, 0],
  [0.66, 0],
  [0.8, 1],
  [3, 1],
])
/** Lower spine share of the press; zero wherever CORE < 1. */
const LOW = curve([
  [0, 0],
  [0.14, 0.032],
  [0.28, 0],
  [0.8, 0],
  [0.98, -0.02],
  [1.24, -0.024],
  [1.56, 0.04],
  [1.86, 0.075], // heavy forward authority press
  [2.25, 0.075],
  [2.38, 0.062],
  [2.64, 0.015],
  [3, 0],
])
const CHEST = curve([
  [0, 0],
  [0.14, 0.03],
  [0.3, -0.018],
  [0.4, 0],
  [0.445, 0.018], // the "click" jolt
  [0.47, 0],
  [0.65, 0],
  [0.98, -0.032], // breathe in, chest lifts
  [1.24, -0.035],
  [1.56, 0.042],
  [1.86, 0.078], // deep press forward
  [2.25, 0.078],
  [2.38, 0.064],
  [2.64, 0.015],
  [3, 0],
])
/** Subtle dramatic torso angling after the t=0.5 lock (zero during 0.40–0.66). */
const ANGLE = curve([
  [0, 0],
  [0.66, 0],
  [0.98, 0.15], // slight side-eye sizing-up turn
  [1.24, 0.14],
  [1.62, -0.08], // square and press into camera
  [2.25, -0.08],
  [2.58, 0],
  [3, 0],
])
const NOD = curve([
  [0, 0],
  [0.14, 0.16], // brows down
  [0.34, 0.07],
  [0.44, 0.11],
  [0.5, 0.06],
  [0.65, 0.06],
  [0.98, -0.04],
  [1.24, -0.06], // chin up, sizing them up
  [1.56, -0.08],
  [1.86, -0.11], // chin tucked against the forward torso press: cold glare straight at camera
  [2.25, -0.11],
  [2.4, -0.08],
  [2.7, 0.02],
  [3, 0],
])
const LOOK = curve([
  [0, 0],
  [0.65, 0],
  [0.98, -0.14], // eyes stay locked on camera while chest angles slightly
  [1.24, -0.13],
  [1.62, 0.07],
  [2.25, 0.07],
  [2.58, 0],
  [3, 0],
])
const CANT = curve([
  [0, 0],
  [0.65, 0],
  [0.98, -0.09],
  [1.24, -0.08],
  [1.6, 0.04],
  [2.25, 0.04],
  [2.6, 0],
  [3, 0],
])
const SHRUG = curve([
  [0, 0],
  [0.14, -0.04],
  [0.3, 0],
  [0.4, 0],
  [0.445, -0.012],
  [0.47, 0],
  [0.65, 0],
  [0.98, 0.03], // controlled breath lift, no shoulder lump
  [1.24, 0.034],
  [1.56, 0.012],
  [1.86, -0.015],
  [2.25, -0.015],
  [2.4, 0],
  [3, 0],
])
const REACH = curve([
  [0, 0],
  [0.65, 0],
  [0.98, 0.03],
  [1.24, 0.035],
  [1.56, 0.012],
  [1.86, 0],
  [3, 0],
])
const DROP = curve([
  [0, 0],
  [0.15, 0.036],
  [0.4, 0.036],
  [0.445, 0.044],
  [0.5, 0.036],
  [0.65, 0.034],
  [1.24, 0.028],
  [1.86, 0.066], // deep grounded horse stance under the press
  [2.25, 0.068],
  [2.4, 0.056],
  [2.82, 0.008],
  [3, 0],
])
/** Rigid forward drive of the whole seal (both wrists, identical offset). */
const PUSH = curve([
  [0, 0],
  [0.65, 0],
  [1.24, -0.012],
  [1.86, 0.052],
  [2.25, 0.055],
  [2.38, 0.044],
  [2.62, 0],
  [3, 0],
])
const SQUEEZE = curve([
  [0, 0],
  [0.3, 0],
  [0.42, 1],
  [2.44, 1],
  [2.58, 0],
  [3, 0],
])

function sample(t: number, set: Target, bind: Bind, out: Extras) {
  out.core = CORE(t)
  out.seal = SQUEEZE(t)
  out.offset.set(0, -DROP(t), 0)
  const breath = 0.008 * Math.sin(2 * Math.PI * 0.7 * (t - 0.65)) * smooth(t, 0.7, 0.95) * (1 - smooth(t, 2.3, 2.5))
  const tremor =
    0.0025 *
    (Math.sin(2 * Math.PI * 7.3 * t) + 0.6 * Math.sin(2 * Math.PI * 11.1 * t + 1.3)) *
    smooth(t, 1.8, 1.95) *
    (1 - smooth(t, 2.2, 2.3))
  const low = LOW(t) * 0.5,
    angle = ANGLE(t),
    nod = NOD(t)
  const body = torso(
    set,
    bind,
    bind('pelvis').add(out.offset),
    new T.Quaternion(),
    [ypr(angle * 0.3, low, 0), ypr(angle * 0.35, low, 0), ypr(angle * 0.35, CHEST(t) + breath + tremor, 0)],
    ypr(LOOK(t) * 0.38, nod * 0.32, CANT(t) * 0.32),
    ypr(LOOK(t) * 0.62, nod * 0.68, CANT(t) * 0.68),
    false,
  )
  for (const [side] of SIDES) leg(set, bind, side, body, ankle(bind, side), 0)

  const push = PUSH(t),
    drive = V(0, -0.22 * push, push)
  for (const [side, s] of SIDES) {
    const sealed = sealPose(side, s, bind)
    const front = s === -1 ? 1 : -1 // the right hand always travels in front of the left
    // Coiled martial-arts prep near the ribs (natural bent elbows, soft curled fingers) instead of robotic splayed arms.
    const cockWrist = V(s * 0.255, 1.03, 0.085),
      cockPole = V(s * 0.6, -0.45, -0.8),
      cockHand = palm(s, V(s * 0.2, -0.65, 0.72), V(-s * 0.85, -0.15, 0.45))
    let wrist: T.Vector3, pole: T.Vector3, hand: T.Quaternion, shape: Shape
    let absolute: Shape | undefined
    if (t < 0.18) {
      // Sink and gather wrists close to the ribs with composed fingers.
      const k = smooth(t, 0, 0.16)
      wrist = REST.wrist(s).lerp(cockWrist, k)
      pole = REST.pole(s).lerp(cockPole, k)
      hand = REST.hand(s).slerp(cockHand, k)
      shape = shapeHand(side, hand, {curls: curlMix(RELAXED, OPEN, 0.35 * k), spread: 0.02, thumbBend: 0.16})
    } else if (t < 0.44) {
      // Carve a crisp short arc in (right hand over, left from below), hooks formed while separated in depth.
      const u = easeOut(t, 0.18, 0.4, 3)
      const sep = 0.034 * (1 - easeOut(t, 0.33, 0.44, 2))
      const bulge = s === -1 ? V(s * 0.04, 0.11, 0.05) : V(s * 0.04, -0.06, 0.04)
      const mid = cockWrist.clone().add(sealed.wrist).multiplyScalar(0.5).add(bulge)
      wrist = bezier(cockWrist, mid, sealed.wrist, u).add(V(0, 0, front * sep))
      pole = cockPole.clone().lerp(sealed.pole, u)
      hand = cockHand.clone().slerp(sealed.hand, smooth(t, 0.18, 0.38))
      shape = blendShape(shapeHand(side, hand, {curls: RELAXED, spread: 0.03, thumbBend: 0.16}), sealed.relative, smooth(t, 0.24, 0.38))
    } else if (t <= 2.38) {
      // Locked: the seal rides the chest rigidly; shoulders and the push re-solve the elbows only.
      wrist = sealed.wrist.clone().add(drive)
      pole = sealed.pole
      hand = sealed.hand
      shape = sealed.relative
      absolute = sealed.absolute
    } else {
      // Unhook cleanly in depth first, smoothly transition hands to composed sweep outward (no stretched thumb spikes), then return to rest.
      const sep = 0.036 * easeOut(t, 2.38, 2.5, 2)
      const anchor = sealed.wrist.clone().add(drive).add(V(0, 0, front * sep))
      wrist = bezier(anchor, V(s * 0.3, 1.12, 0.18), REST.wrist(s), smooth(t, 2.46, 2.96))
      pole = sealed.pole.clone().lerp(REST.pole(s), smooth(t, 2.46, 2.9))
      const open = palm(s, V(s * 0.25, -0.75, 0.6), V(-s * 0.8, -0.25, 0.45))
      hand = sealed.hand.clone().slerp(open, smooth(t, 2.42, 2.66)).slerp(REST.hand(s), smooth(t, 2.66, 2.96))
      const relaxed = shapeHand(side, hand, {curls: RELAXED, spread: 0.03, thumbBend: 0.15})
      // Unfold the hooked thumb quickly right as the hands separate so it never stretches like a chopstick.
      shape = new Map()
      for (const [key, q] of sealed.relative) {
        const w = key.startsWith('thumb')
          ? smooth(t, 2.39, 2.52)
          : key.startsWith('index') || key.startsWith('middle')
            ? smooth(t, 2.44, 2.64)
            : smooth(t, 2.48, 2.72)
        shape.set(key, q.clone().slerp(relaxed.get(key)!, w))
      }
    }
    setArm(set, bind, side, body.D3, {
      wrist,
      pole,
      hand,
      shape,
      absolute,
      shrug: SHRUG(t),
      reach: REACH(t),
      twist: 0.42,
    })
  }
}

export const seal: Choreo = {
  sample,
  face: [
    [0.05, 'serious'],
    [2.62, 'base'],
  ],
}
