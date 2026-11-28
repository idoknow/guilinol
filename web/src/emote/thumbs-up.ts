import {bump, curve, mix, smooth, vcurve} from './curves.ts'
import {V, leg, palm, setArm, shapeHand, torso, ypr, type Bind, type Target} from './rig.ts'
import {FIST, RELAXED, SIDES, SQUEEZE, ankle, type Choreo, type Extras} from './presets.ts'

// 点赞 4.0s — sink & load → right thumb pops, left answers 0.18s later → two
// pull-and-tap beats with the weight swaying → cheeky head-tilt showcase → unwind.

const BEATS = [1.45, 1.98]
/** Alternating accent: right fires cleanly on beat 0, left fires cleanly on beat 1 (distinct high-low double-tap!). */
const tapSide = (t: number, s: number) =>
  s === -1 ? bump(t, BEATS[0], 0.14) + 0.32 * bump(t, BEATS[1], 0.14) : 0.32 * bump(t, BEATS[0], 0.14) + bump(t, BEATS[1], 0.14)
const drawSide = (t: number, s: number) =>
  s === -1 ? bump(t, BEATS[0] - 0.13, 0.1) : bump(t, BEATS[1] - 0.13, 0.1)
const tapAny = (t: number) => bump(t, BEATS[0], 0.14) + bump(t, BEATS[1], 0.14)
const drawAny = (t: number) => bump(t, BEATS[0] - 0.13, 0.1) + bump(t, BEATS[1] - 0.13, 0.1)
/** The left arm runs 0.22s behind through the initial pop, then catches up before the alternating beats. */
const lag = (t: number) => 0.22 * smooth(t, 0.26, 0.44) * (1 - smooth(t, 1.08, 1.32))

// Arm tables use |x|; each side mirrors them. Kept chest-high & wide so hands never cover the face.
const WRIST = vcurve([
  [0.0, 0.238, 0.865, 0.012],
  [0.2, 0.235, 0.94, 0.055],
  [0.38, 0.228, 1.04, 0.105], // gathered at ribs, elbows soft back
  [0.46, 0.225, 1.015, 0.085], // crisp pre-pop dip
  [0.58, 0.228, 1.285, 0.395], // punchy pop forward-up, clean of chin/cheeks
  [0.7, 0.232, 1.235, 0.345], // settle recoil
  [0.82, 0.234, 1.25, 0.358],
  [2.28, 0.236, 1.248, 0.355],
  [2.52, 0.285, 1.28, 0.332], // showcase: wide proud double thumbs-up framing the smile
  [3.16, 0.288, 1.276, 0.33],
  [3.34, 0.285, 1.22, 0.295], // wrists relax outward first (clear of torso)
  [3.6, 0.278, 1.04, 0.145],
  [3.84, 0.244, 0.878, 0.02],
  [3.93, 0.238, 0.86, 0.005], // soft follow-through
  [4.0, 0.238, 0.865, 0.012],
])
const POLE = vcurve([
  [0.0, 0.28, -0.1, -1],
  [0.4, 0.38, -0.25, -1],
  [0.5, 0.48, -0.7, -0.55],
  [0.62, 0.56, -1, -0.15],
  [2.28, 0.56, -1, -0.15],
  [2.52, 0.68, -1, -0.12],
  [3.16, 0.68, -1, -0.12],
  [3.6, 0.48, -0.65, -0.55],
  [3.9, 0.28, -0.1, -1],
  [4.0, 0.28, -0.1, -1],
])
/** Knuckle direction: wrist cocks down to load, snaps up as the thumb fires, drops cleanly outward on exit. */
const KNUCKLES = vcurve([
  [0.0, 0.04, -1, 0.1],
  [0.38, 0.06, -0.5, 0.88],
  [0.46, 0.06, -0.64, 0.82],
  [0.58, 0.1, 0.34, 0.94],
  [0.7, 0.1, 0.1, 0.98],
  [0.82, 0.1, 0.16, 0.98],
  [2.28, 0.1, 0.14, 0.98],
  [2.52, 0.26, 0.14, 0.95],
  [3.16, 0.26, 0.14, 0.95],
  [3.34, 0.18, -0.22, 0.95],
  [3.62, 0.1, -0.82, 0.52],
  [3.9, 0.04, -1, 0.1],
  [4.0, 0.04, -1, 0.1],
])
const CLOSE = curve([
  [0, 0],
  [0.38, 0.6],
  [0.54, 1],
])
const SHRUG = curve([
  [0, 0],
  [0.38, -0.036], // subtle load sink, never pinching deltoids
  [0.46, -0.04],
  [0.6, 0.022],
  [0.82, 0.008],
  [2.28, 0.008],
  [2.52, 0.016],
  [3.16, 0.014],
  [3.6, 0],
  [4, 0],
])
const REACH = curve([
  [0, 0],
  [0.46, -0.02],
  [0.6, 0.045],
  [0.82, 0.02],
  [2.28, 0.02],
  [2.52, 0.01],
  [3.16, 0.01],
  [3.6, 0],
  [4, 0],
])
const DROP = curve([
  [0, 0],
  [0.38, 0.044], // noticeable springy knee bend to load
  [0.46, 0.048],
  [0.6, 0.01], // bounce up on pop
  [0.84, 0.026],
  [1.06, 0.018],
  [2.28, 0.018],
  [2.52, 0.028],
  [3.16, 0.024],
  [3.55, 0.012],
  [4, 0],
])
const SWAY = curve([
  [0, 0],
  [0.6, 0.014],
  [0.96, -0.016],
  [1.24, 0],
  [1.46, 0.026], // shift right on right-hand accent
  [1.98, -0.026], // shift left on left-hand accent
  [2.58, 0.012],
  [3.22, 0],
  [4, 0],
])
const PITCH = curve([
  [0, 0],
  [0.38, 0.095], // clear anticipation fold
  [0.46, 0.105],
  [0.62, -0.06], // proud chest lift
  [0.86, -0.07],
  [1.3, -0.045],
  [2.28, -0.045],
  [2.52, -0.068],
  [3.16, -0.065],
  [3.45, 0],
  [3.72, 0.032],
  [4, 0],
])
/** Torso twists into each pop & alternating beat so the silhouette feels alive from every angle. */
const YAW = curve([
  [0, 0],
  [0.46, -0.04],
  [0.6, 0.14], // right pop drives chest left
  [0.76, 0.06],
  [0.94, -0.09], // left pop answers right
  [1.18, 0],
  [1.46, 0.12], // right beat
  [1.72, 0],
  [1.98, -0.12], // left beat
  [2.28, 0],
  [2.56, 0.05],
  [3.16, 0.04],
  [3.5, 0],
  [4, 0],
])
const NOD = curve([
  [0, 0],
  [0.38, 0.15],
  [0.46, 0.16],
  [0.58, -0.08],
  [0.82, -0.02],
  [1.0, 0.15], // affirming nod
  [1.16, -0.02],
  [1.32, 0.02],
  [2.28, 0.02],
  [2.44, 0.05],
  [2.6, 0.14],
  [2.78, 0.04],
  [3.16, 0.05],
  [3.48, 0],
  [4, 0],
])
const TILT = curve([
  [0, 0],
  [0.82, -0.06],
  [1.06, 0],
  [1.46, 0.08],
  [1.98, -0.08],
  [2.28, 0],
  [2.52, 0.19], // playful head tilt on showcase
  [3.14, 0.17],
  [3.46, 0],
  [4, 0],
])

function sample(t: number, set: Target, bind: Bind, out: Extras) {
  const breath = Math.sin(2 * Math.PI * 0.95 * t) * smooth(t, 0.82, 1.2) * (1 - smooth(t, 3.3, 3.6))
  const showcase = smooth(t, 2.28, 2.52) * (1 - smooth(t, 3.14, 3.34))
  const sway = SWAY(t)
  const hit = tapAny(t),
    pull = drawAny(t)
  out.offset.set(sway, -(DROP(t) + 0.022 * hit), 0)
  const pitch = PITCH(t) + 0.042 * hit - 0.018 * pull + 0.012 * breath
  const yaw = YAW(t),
    nod = NOD(t) + 0.09 * hit,
    tilt = TILT(t)
  // Hips roll over the loaded leg; spine_01 cancels it so the chest stays balanced.
  const body = torso(
    set,
    bind,
    bind('pelvis').add(out.offset),
    ypr(0, 0, 1.45 * sway),
    [ypr(yaw * 0.25, pitch * 0.25, -1.45 * sway), ypr(yaw * 0.35, pitch * 0.35, 0), ypr(yaw * 0.4, pitch * 0.4, 0)],
    ypr(-yaw * 0.28, nod * 0.4, tilt * 0.35),
    ypr(-yaw * 0.42, nod * 0.6, tilt * 0.65),
  )
  for (const [side] of SIDES) leg(set, bind, side, body, ankle(bind, side), 0)

  for (const [side, s] of SIDES) {
    const tau = s === 1 ? t - lag(t) : t
    const p = tapSide(t, s),
      q = drawSide(t, s)
    const wrist = WRIST(tau, s).add(V(s * 0.016 * p, 0.056 * p - 0.018 * q + 0.005 * breath * showcase, 0.062 * p - 0.032 * q))
    const knuckles = KNUCKLES(tau, s)
    knuckles.y += 0.22 * p - 0.12 * q
    // Angle the fist slightly outward (3/4 profile) so the curled knuckles & upright thumb read cleanly from front and side.
    const hand = palm(s, knuckles, V(-s * 0.86, -0.1, 0.46))
    const closed = CLOSE(tau)
    // Unfurl index → pinky in a ripple while the thumb settles cleanly back to rest.
    const curls = RELAXED.map((open, i) => {
      const finger = Math.floor(i / 3)
      const held = closed * (1 - smooth(t, 3.26 + 0.045 * finger, 3.58 + 0.045 * finger))
      return mix(open, FIST[i], held) + 0.08 * p * SQUEEZE[i] * held
    })
    const up = smooth(tau, 0.46, 0.56) * (1 - smooth(t, 3.22, 3.44))
    const shape = shapeHand(side, hand, {
      curls,
      spread: mix(0.03, -0.07, closed),
      thumbBend: mix(0.14, 0.24, closed),
      up: {weight: up, dir: V(s * (0.06 + 0.18 * showcase), 1, 0.14 - 0.08 * p), bend: 0.09 - 0.06 * p},
    })
    setArm(set, bind, side, body.D3, {
      wrist,
      pole: POLE(tau, s),
      hand,
      shape,
      shrug: SHRUG(tau) + 0.015 * p,
      reach: REACH(tau),
    })
  }
}

export const thumbsUp: Choreo = {
  sample,
  face: [
    [0, 'smile'],
    [0.56, 'thumbs_up'],
    [3.3, 'smile'],
    [3.86, 'base'],
  ],
}
