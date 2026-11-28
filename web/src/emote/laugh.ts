import * as T from 'three'
import {bump, curve, mix, ramp, smooth, vcurve} from './curves.ts'
import {V, leg, palm, setArm, shapeHand, toChest, torso, ypr, type Bind, type Shape, type Target} from './rig.ts'
import {BLADE, FIST, OPEN, POINT, RELAXED, SIDES, ankle, type Choreo, type Extras} from './presets.ts'

// 奶蛙笑 4.25s — gulp of air → four big doubled-over laugh waves (clear finger-point,
// belly clutch, wide flap, right-thigh slap — hands cleanly separated) → dead stop →
// poker face, crisp -56° whip into bow stance with tight vertical blade hand & visible
// chambered hip fist → eyes locked straight at camera (0° head yaw, zero neck tear) → return.

const TURNED = (-56 * Math.PI) / 180
const TURN = curve([
  [0, 0],
  [2.36, 0],
  [2.5, (-48 * Math.PI) / 180],
  [2.62, (-61 * Math.PI) / 180], // crisp whip overshoot...
  [2.76, TURNED], // ...brake cleanly into the lock
  [3.68, TURNED],
  [3.95, -0.44],
  [4.15, -0.04],
  [4.25, 0],
])
/** Spine bow, + forward: bold comic bends & throw-back cackles (no rigid pole posture). */
const LAUGH = curve([
  [0, 0],
  [0.24, -0.1], // big gulp of air
  [0.36, 0.2], // ha!
  [0.5, 0.04],
  [0.62, -0.08],
  [0.74, 0.26], // HA!
  [0.88, 0.06],
  [0.98, -0.07],
  [1.08, 0.28], // ha-
  [1.16, 0.16],
  [1.24, 0.32], // -ha-
  [1.32, 0.2],
  [1.4, 0.36], // -HA
  [1.52, 0.08],
  [1.62, -0.14], // head-back cackle
  [1.78, 0.26],
  [1.92, 0.44], // doubled over slapping right thigh
  [2.06, 0.36],
  [2.16, 0.38],
  [2.24, -0.02], // dead stop
  [2.3, -0.04], // sharp breath, spine straight
  [2.4, -0.025],
  [2.76, -0.035],
  [3.68, -0.035],
  [4.0, -0.005],
  [4.25, 0],
])
const TWIST = curve([
  [0, 0],
  [0.36, 0.07],
  [0.74, -0.08],
  [1.08, 0.08],
  [1.24, -0.05],
  [1.4, 0.09],
  [1.62, 0],
  [1.92, -0.1],
  [2.16, -0.06],
  [2.24, 0],
  [2.4, 0],
  [2.62, -0.06], // chest squares the blade shoulder slightly forward
  [2.76, -0.04],
  [3.68, -0.04],
  [4.1, 0],
  [4.25, 0],
])
const LEAN = curve([
  [0, 0],
  [0.74, 0.05],
  [1.08, -0.05],
  [1.4, 0.06],
  [1.92, -0.07],
  [2.24, 0],
  [4.25, 0],
])
const NOD = curve([
  [0, 0],
  [0.24, -0.22],
  [0.36, 0.14],
  [0.5, -0.1],
  [0.62, -0.22],
  [0.74, 0.16],
  [0.88, -0.08],
  [0.98, -0.2],
  [1.08, 0.16],
  [1.16, 0.04],
  [1.24, 0.16],
  [1.32, 0.04],
  [1.4, 0.18],
  [1.52, -0.12],
  [1.62, -0.32],
  [1.78, 0.08],
  [1.92, 0.24],
  [2.06, 0.14],
  [2.16, 0.18],
  [2.24, -0.04],
  [2.3, -0.06],
  [2.4, -0.02],
  [2.62, 0.05],
  [2.76, 0.08], // chin tucked for the cold stare
  [3.68, 0.08],
  [4.1, 0],
  [4.25, 0],
])
/** Head yaw against the body: tracks the whip cleanly so head faces 0° straight at camera without neck tear. */
const LOOK = curve([
  [0, 0],
  [0.62, 0.06],
  [0.98, -0.07],
  [1.62, 0.08],
  [2.0, -0.06],
  [2.24, 0],
  [2.38, 0],
  [2.52, 0.78], // tracks body turn immediately so neck never over-lags or tears
  [2.64, 1.08], // counters -61° overshoot
  [2.76, 1.02], // counters -56° + -2.3° chest twist → dead-on 0° gaze at camera!
  [3.68, 1.02],
  [3.95, 0.44],
  [4.18, 0],
  [4.25, 0],
])
const CANT = curve([
  [0, 0],
  [0.62, -0.06],
  [1.08, 0.06],
  [1.62, -0.05],
  [1.92, 0.07],
  [2.24, 0],
  [2.4, 0],
  [2.76, 0.04],
  [3.68, 0.04],
  [4.1, 0],
  [4.25, 0],
])
const INHALE = curve([
  [0, 0],
  [0.24, 0.045], // controlled shoulder lift (no spiky deltoid corners)
  [0.34, 0.015],
  [2.14, 0.015],
  [2.24, 0],
  [2.3, 0.028],
  [2.42, 0.008],
  [2.6, 0],
  [4.25, 0],
])
const DROP = curve([
  [0, 0],
  [0.24, 0],
  [0.36, 0.026],
  [0.5, 0.006],
  [0.74, 0.032],
  [0.88, 0.008],
  [1.08, 0.034],
  [1.16, 0.018],
  [1.24, 0.038],
  [1.32, 0.02],
  [1.4, 0.042],
  [1.52, 0.012],
  [1.62, 0.005],
  [1.92, 0.056], // real comic knee buckle
  [2.1, 0.046],
  [2.22, 0.008],
  [2.36, 0.004],
  [2.62, 0.064], // solid grounded bow stance
  [2.76, 0.056],
  [3.68, 0.056],
  [4.1, 0.004],
  [4.25, 0],
])
const PATS = [0.36, 0.74, 1.08, 1.24, 1.4, 1.92, 2.06]
// Left hand stays on the left side of the belly (x > 0) so it NEVER crosses over or fights the right arm.
const BELLY = V(0.068, 1.07, 0.215)
// Right hand slaps the outer-front right thigh cleanly away from the left hand.
const THIGH = V(-0.185, 0.85, 0.145)

const L_WRIST = vcurve([
  [0, 0.238, 0.865, 0.012],
  [0.32, 0.14, 1.02, 0.18],
  [2.38, 0.068, 1.07, 0.215],
  [2.54, 0.13, 1.21, 0.3], // crisp martial arc from belly...
  [2.68, 0.11, 1.275, 0.405], // ...vertical blade driven forward with soft powerful elbow bend
  [2.74, 0.11, 1.28, 0.41],
  [2.82, 0.11, 1.27, 0.392], // checked lock
  [3.68, 0.11, 1.27, 0.392],
  [3.92, 0.22, 1.1, 0.18],
  [4.18, 0.238, 0.865, 0.012],
  [4.25, 0.238, 0.865, 0.012],
])
const L_POLE = vcurve([
  [0, 0.28, -0.1, -1],
  [0.32, 0.9, -0.55, 0.1],
  [2.38, 0.9, -0.55, 0.1],
  [2.58, 0.78, -0.95, -0.15],
  [3.68, 0.78, -0.95, -0.15],
  [4.0, 0.45, -0.4, -0.75],
  [4.25, 0.28, -0.1, -1],
])
const L_FINGERS = vcurve([
  [0, 0.04, -1, 0.1],
  [0.32, -0.95, -0.12, 0.24], // fingers gently wrap belly contour
  [2.38, -0.95, -0.12, 0.24],
  [2.54, -0.2, 0.32, 0.92],
  [2.68, 0.04, 0.26, 0.96], // taut forward-upward karate blade edge
  [3.68, 0.04, 0.26, 0.96],
  [3.95, 0.06, -0.62, 0.65],
  [4.25, 0.04, -1, 0.1],
])
const L_NORMAL = vcurve([
  [0, -0.92, -0.12, 0.36],
  [0.32, -0.12, -0.1, -0.98], // palm faces belly cleanly
  [2.38, -0.12, -0.1, -0.98],
  [2.54, -0.82, -0.08, -0.45],
  [2.68, -0.98, 0.06, 0.18], // vertical knife-hand: palm strictly inward, pinky edge cutting forward
  [3.68, -0.98, 0.06, 0.18],
  [3.95, -0.92, -0.1, 0.3],
  [4.25, -0.92, -0.12, 0.36],
])
const R_WRIST = vcurve([
  [0, -0.238, 0.865, 0.012],
  [0.22, -0.23, 1.08, 0.18],
  [0.32, -0.235, 1.255, 0.375], // angled slightly off-axis so the pointing finger reads cleanly head-on without dark sleeve hole
  [0.88, -0.235, 1.255, 0.375],
  [1.02, -0.32, 1.26, 0.25], // crisp laugh wave (kept upright, no limp wrist!)
  [1.46, -0.32, 1.28, 0.25],
  [1.6, -0.33, 1.38, 0.21], // raised on head-back cackle before thigh slap
  [1.72, -0.28, 1.18, 0.19],
  [2.28, -0.25, 0.96, 0.08],
  [2.4, -0.26, 0.99, 0.06],
  [2.62, -0.275, 1.015, 0.025], // visible chambered hip fist outside the torso silhouette (zero belly clip!)
  [3.68, -0.275, 1.015, 0.025],
  [3.94, -0.255, 0.92, 0.02],
  [4.25, -0.238, 0.865, 0.012],
])
const R_POLE = vcurve([
  [0, -0.28, -0.1, -1],
  [0.32, -0.68, -1, -0.22], // lowered angled elbow hides sleeve cavity cleanly
  [0.88, -0.68, -1, -0.22],
  [1.02, -0.82, -0.85, -0.22],
  [1.72, -0.82, -0.85, -0.22],
  [2.0, -0.55, -0.1, -1],
  [2.4, -0.45, -0.15, -1],
  [2.62, -0.34, -0.22, -1], // elbow pulled cleanly back-out, loaded
  [3.68, -0.34, -0.22, -1],
  [4.25, -0.28, -0.1, -1],
])
const R_FINGERS = vcurve([
  [0, -0.04, -1, 0.1],
  [0.32, 0.24, 0.16, 0.96], // slightly angled-in index finger: razor sharp from both front & 3/4 views
  [0.88, 0.24, 0.16, 0.96],
  [1.02, -0.14, 0.56, 0.82], // upbeat raised wrist during laugh wave (eliminates limp-hand claw)
  [1.46, -0.14, 0.56, 0.82],
  [1.6, -0.15, 0.72, 0.68],
  [1.84, -0.06, -0.62, 0.78], // flat tidy palm slapping outer right thigh
  [2.16, -0.06, -0.62, 0.78],
  [2.32, -0.04, -0.96, 0.2],
  [2.42, -0.04, -0.92, 0.25],
  [2.62, -0.02, 0.06, 0.99],
  [3.68, -0.02, 0.06, 0.99],
  [4.0, -0.04, -0.72, 0.52],
  [4.25, -0.04, -1, 0.1],
])
const R_NORMAL = vcurve([
  [0, 0.92, -0.12, 0.36],
  [0.32, 0.84, -0.5, 0.16], // side-angled fist shows full curled fingers + clean index silhouette head-on
  [0.88, 0.84, -0.5, 0.16],
  [1.02, 0.75, -0.35, 0.55],
  [1.46, 0.75, -0.35, 0.55],
  [1.6, 0.5, -0.55, 0.66],
  [1.84, 0.15, -0.84, -0.5], // palm flat down onto thigh
  [2.16, 0.15, -0.84, -0.5],
  [2.32, 0.88, -0.12, 0.35],
  [2.42, 0.88, -0.12, 0.35],
  [2.62, 0.28, 0.95, 0.06], // palm up under chambered martial fist
  [3.68, 0.28, 0.95, 0.06],
  [4.0, 0.9, 0.3, 0.25],
  [4.25, 0.92, -0.12, 0.36],
])

const STANCE = {l: V(0.03, 0, 0.14), r: V(-0.03, 0, -0.18)} as const

function sample(t: number, set: Target, bind: Bind, out: Extras) {
  const laughing = smooth(t, 0.28, 0.45) * (1 - smooth(t, 2.14, 2.22))
  const stance = smooth(t, 2.42, 2.72) * (1 - smooth(t, 3.7, 4.1))
  const hold = smooth(t, 2.76, 2.88) * (1 - smooth(t, 3.6, 3.72))
  const breath = 0.5 - 0.5 * Math.cos((2 * Math.PI * (t - 2.78)) / 0.88)
  const yaw = TURN(t)
  out.yaw = yaw
  const laugh = LAUGH(t)
  const shudder = 0.022 * Math.sin(2 * Math.PI * 5.6 * t) * laughing
  out.offset
    .set(0, 0, -0.016 * stance)
    .applyAxisAngle(V(0, 1, 0), yaw)
    .add(V(0, -(DROP(t) + 0.004 * breath * hold), 0))
  const pitch = laugh - 0.014 * breath * hold,
    twist = TWIST(t),
    lean = LEAN(t),
    nod = NOD(t) + 0.5 * shudder
  const body = torso(
    set,
    bind,
    bind('pelvis').add(out.offset),
    ypr(yaw, 0.14 * laugh * (1 - stance), 0),
    [
      ypr(twist * 0.3, pitch * 0.25, lean * 0.3),
      ypr(twist * 0.3, pitch * 0.35, lean * 0.3),
      ypr(twist * 0.4, pitch * 0.4 + shudder, lean * 0.4),
    ],
    ypr(LOOK(t) * 0.46, nod * 0.45, CANT(t) * 0.4),
    ypr(LOOK(t) * 0.54, nod * 0.55, CANT(t) * 0.6),
  )

  // Grounded sliding step into bow stance (subtle 2.2cm foot clearance so feet stay anchored, never hovering).
  const pr = smooth(t, 2.38, 2.58) * (1 - smooth(t, 3.74, 3.96)),
    pl = smooth(t, 2.46, 2.7) * (1 - smooth(t, 3.86, 4.1))
  const liftR = 0.022 * Math.sin(Math.PI * ramp(t, 2.38, 2.58)) + 0.02 * Math.sin(Math.PI * ramp(t, 3.74, 3.96)),
    liftL = 0.018 * Math.sin(Math.PI * ramp(t, 2.46, 2.7)) + 0.018 * Math.sin(Math.PI * ramp(t, 3.86, 4.1))
  leg(set, bind, 'r', body, ankle(bind, 'r', TURNED * pr, STANCE.r.clone().multiplyScalar(pr), liftR), TURNED * pr)
  leg(set, bind, 'l', body, ankle(bind, 'l', TURNED * pl, STANCE.l.clone().multiplyScalar(pl), liftL), TURNED * pl)

  // Shoulders: controlled giggle tremor (capped so deltoids never spike), then left shoulder drives forward.
  const giggle = laughing * 0.024 * Math.abs(Math.sin(2 * Math.PI * 4.4 * t)) ** 0.7
  const shrug = INHALE(t) + giggle
  const tremble = (i: number) => 0.06 * Math.sin(2 * Math.PI * 6.3 * t + i * 1.7) * laughing

  for (const [side, s] of SIDES) {
    let wrist: T.Vector3, hand: T.Quaternion, pole: T.Vector3, shape: Shape
    if (s === 1) {
      const onBelly = smooth(t, 0.08, 0.32) * (1 - smooth(t, 2.36, 2.52))
      const pat = PATS.reduce((a, b) => a + bump(t, b - 0.07, 0.06), 0)
      const belly = toChest(body, bind, 'spine_01', BELLY.clone().add(V(0, 0, 0.03 * pat)))
      wrist = L_WRIST(t).lerp(belly, onBelly)
      wrist.z -= 0.004 * bump(t, 3.1, 0.25)
      pole = L_POLE(t)
      hand = palm(1, L_FINGERS(t), L_NORMAL(t))
      const blade = smooth(t, 2.44, 2.64) * (1 - smooth(t, 3.72, 3.94))
      shape = shapeHand(side, hand, {
        curls: RELAXED.map((c, i) => mix(c + 0.22 * onBelly + tremble(i) * 0.6, BLADE[i], blade)),
        spread: mix(-0.04, -0.08, Math.max(onBelly, blade)),
        thumbBend: 0.14,
        blade: Math.max(blade, 0.55 * onBelly), // keeps fingers & thumb neatly closed on belly AND razor-tight on the knife-hand
      })
    } else {
      const pointing = smooth(t, 0.22, 0.32) * (1 - smooth(t, 0.86, 0.96))
      const waving = smooth(t, 0.96, 1.06) * (1 - smooth(t, 1.56, 1.7))
      const slapping = smooth(t, 1.72, 1.84) * (1 - smooth(t, 2.16, 2.28))
      const fist = smooth(t, 2.4, 2.6) * (1 - smooth(t, 3.7, 3.92))
      const jab = bump(t, 0.36, 0.06) + bump(t, 0.74, 0.06)
      const thigh = toChest(body, bind, 'pelvis', THIGH.clone().add(V(0, 0.055 * bump(t, 1.99, 0.07), 0)))
      wrist = R_WRIST(t)
        .add(V(0, -0.01 * jab, 0.042 * jab - 0.008 * bump(t, 2.66, 0.08)))
        .lerp(thigh, slapping)
      pole = R_POLE(t)
      const fingers = R_FINGERS(t)
      fingers.y += 0.28 * Math.sin(2 * Math.PI * 3.2 * (t - 1.0)) * smooth(t, 0.98, 1.06) * (1 - smooth(t, 1.44, 1.54))
      hand = palm(-1, fingers, R_NORMAL(t))
      shape = shapeHand(side, hand, {
        curls: RELAXED.map((c, i) => {
          let v = mix(c + tremble(i + 5) * 0.5, POINT[i], pointing)
          v = mix(v, c + 0.38, waving) // composed half-curled laugh wave (never a splayed ghost claw)
          v = mix(v, OPEN[i] + 0.1, slapping)
          return mix(v, FIST[i], fist)
        }),
        spread: mix(-0.04, -0.08, Math.max(slapping, fist)),
        thumbBend: 0.15,
        tuck: Math.min(1, 0.95 * pointing + fist),
        blade: 0.75 * slapping, // closes the five fingers cleanly together for a solid thigh slap
      })
    }
    const stanceShrug = s === 1 ? 0 : -0.03 * stance,
      stanceReach = s === 1 ? 0.08 * stance : -0.05 * stance
    setArm(set, bind, side, body.D3, {wrist, pole, hand, shape, shrug: shrug + stanceShrug, reach: stanceReach})
  }
}

export const laugh: Choreo = {
  sample,
  face: [
    [0, 'laugh'],
    [2.42, 'serious'],
    [3.86, 'base'],
  ],
}
