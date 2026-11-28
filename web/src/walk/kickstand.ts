import * as T from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Two-wheel side kickstand geometry, kinematics, dismount support policy,
 * and inverted-pendulum tip-over physics (IDOK-546).
 *
 * Pure deterministic math & self-contained geometry builder so both the live
 * dynamic e-bike rig, static parked batches, and Node unit tests share one
 * exact source of truth with zero per-frame heap allocations.
 */

export const KICKSTAND = {
  /** Leftward resting roll angle (+Z in right-handed -Z forward space) when supported on the left side stand (~7.0 deg). */
  leanRad: 0.1222,
  /** Kickstand pivot position in bike chassis coordinates (left side beneath floorboard). */
  pivot: [-0.15, 0.25, 0.14] as readonly [number, number, number],
  /** Pivot-to-foot-sole length calibrated so the footpad meets y = 0.000m at +7.0 deg lean. */
  legLength: 0.2465,
  /** Pivot Euler X/Z when stowed back along the swingarm (rad). */
  stowedRotX: -1.42,
  stowedRotZ: 0,
  /** Pivot Euler X/Z when deployed outward-left and slightly rearward (rad). */
  deployedRotX: -0.22,
  deployedRotZ: -0.42,
  /** Tactile deploy / retract durations (seconds). */
  deploySec: 0.22,
  retractSec: 0.16,
  /** Slight ease-out-back overshoot when latching deployed. */
  overshoot: 0.06,
  /** Full side-lay roll magnitude on flat pavement (rad, ~82 deg). */
  layRollRad: 1.43,
  /** Partial lean angle when blocked by a nearby wall/curb (rad, ~24 deg). */
  wallLeanRollRad: 0.42,
} as const

export type DismountSupport = 'stand' | 'auto_stand' | 'tip_over'

export interface KickstandStrictContext {
  verify: boolean
  param: string | null
}

/**
 * Resolves whether dismounting an e-bike without the kickstand down causes a tip-over.
 * `?kickstandStrict=1|0` always wins; default is true for players and false in `?verify` regression scripts.
 */
export function resolveKickstandStrict(ctx: KickstandStrictContext): boolean {
  if (ctx.param === '1' || ctx.param === 'true') return true
  if (ctx.param === '0' || ctx.param === 'false') return false
  return !ctx.verify
}

/**
 * Determines how a two-wheeler behaves the moment the rider dismounts.
 * - Pedal bicycles auto-stand cleanly.
 * - E-bikes (personal & shared) tip over when `strict` is active and the side kickstand is retracted.
 */
export function resolveDismountSupport(p: {
  kind: 'bike' | 'bicycle'
  kickstandDown: boolean
  strict: boolean
}): DismountSupport {
  if (p.kind === 'bicycle') return 'auto_stand'
  if (!p.strict) return 'auto_stand'
  return p.kickstandDown ? 'stand' : 'tip_over'
}

export interface ChooseTipSideParams {
  heading: number
  bike: {x: number; z: number}
  player: {x: number; z: number}
  /** True when the side away from the player has >= ~0.95m horizontal clearance. */
  awayFree: boolean
  /** True when the side toward the player has >= ~0.95m horizontal clearance. */
  towardFree: boolean
  /** Horizontal distance (m) between bike center and standing player. */
  playerDist: number
}

export interface TipSideChoice {
  /** +1 = fall to bike's left (-X, roll > 0); -1 = fall to bike's right (+X, roll < 0). Matches `roll = -side * sim.roll` convention where side=-1 => +roll (left), side=+1 => -roll (right). */
  side: -1 | 1
  /** Final resting roll magnitude (rad). */
  restRoll: number
  /** True if a wall/curb arrests the fall early into a leaning rest (still flagged downed & pickable). */
  wallLean: boolean
}

/**
 * Picks which side an unsupported bike falls toward:
 *  1. Prefer falling AWAY from the dismounted player so the chassis never clips through the player.
 *  2. If the away side is blocked by a wall:
 *     - if the player stands well clear (>= 1.1m) and the toward side is free, fall to the free side;
 *     - otherwise lean against the wall at `wallLeanRollRad` (0.42 rad) so it never clips into walls or the player.
 *
 * Sign convention matches `walk/index.ts` `DownedBikeEntry`: `mesh.rotation.z = -side * rollMag`.
 * In right-handed (-Z forward, +X right) coords, +Z rotation leans bike LEFT (-X), -Z rotation leans RIGHT (+X).
 * Therefore `side = -1` tips LEFT (-X) and `side = +1` tips RIGHT (+X).
 */
export function chooseTipSide(p: ChooseTipSideParams): TipSideChoice {
  const rx = Math.cos(p.heading)
  const rz = -Math.sin(p.heading)
  const toPlayerDotRight = (p.player.x - p.bike.x) * rx + (p.player.z - p.bike.z) * rz
  // Player on left (dot < 0) => away is right (side = +1). Player on right (dot >= 0) => away is left (side = -1).
  const awaySide: -1 | 1 = toPlayerDotRight < 0 ? 1 : -1
  const towardSide: -1 | 1 = awaySide === 1 ? -1 : 1

  if (p.awayFree) {
    return {side: awaySide, restRoll: KICKSTAND.layRollRad, wallLean: false}
  }
  if (p.towardFree && p.playerDist >= 1.1) {
    return {side: towardSide, restRoll: KICKSTAND.layRollRad, wallLean: false}
  }
  return {side: awaySide, restRoll: KICKSTAND.wallLeanRollRad, wallLean: true}
}

export type TipOverPhase = 'teeter' | 'falling' | 'settle' | 'rest'

export interface TipOverSim {
  phase: TipOverPhase
  t: number
  roll: number
  vel: number
  hop: number
  restRoll: number
  bounces: number
}

export type TipOverStepResult = 0 | {impact: number; bounce: number} | 'rest'

const GRAVITY_OVER_H = 9.81 / 0.56
const PENDULUM_DAMP = 0.4
const TEETER_SEC = 0.12
const SUBSTEP_DT = 1 / 120
const RESTITUTION = 0.22
const SETTLE_VEL_EPS = 0.25
const HOP_INITIAL_M = 0.012
const HOP_TAU_SEC = 0.08

/** Creates a deterministic inverted-pendulum tip-over simulation for an unsupported e-bike. */
export function createTipOver(initialLean: number, speedMs: number, restRoll: number = KICKSTAND.layRollRad): TipOverSim {
  const safeRest = Math.max(0.2, Math.min(1.52, restRoll))
  const startRoll = Math.min(safeRest * 0.45, Math.max(0.045, Math.abs(initialLean)))
  const startVel = 0.35 + 0.30 * Math.min(Math.max(0, Math.abs(speedMs)), 3)
  return {
    phase: 'teeter',
    t: 0,
    roll: startRoll,
    vel: startVel,
    hop: 0,
    restRoll: safeRest,
    bounces: 0,
  }
}

/**
 * Advances the tip-over simulation in place (zero allocations on steady ticks).
 * Returns:
 *  - `0` during normal progression
 *  - `{impact, bounce}` on ground contact impulses (0..1 strength)
 *  - `'rest'` once the chassis settles cleanly onto the pavement/wall
 */
export function stepTipOver(s: TipOverSim, dt: number): TipOverStepResult {
  if (s.phase === 'rest') return 'rest'
  const clamped = Math.min(0.12, Math.max(0, dt))
  if (clamped <= 0) return 0

  let remaining = clamped
  let impactStrength = 0
  let impactBounce = 0

  while (remaining > 1e-6 && s.phase !== 'rest') {
    const h = Math.min(SUBSTEP_DT, remaining)
    remaining -= h
    s.t += h

    if (s.hop > 1e-5) {
      s.hop *= Math.exp(-h / HOP_TAU_SEC)
      if (s.hop < 1e-4) s.hop = 0
    }

    if (s.phase === 'teeter') {
      // Brief ~0.12s balance hesitation (+/- 0.6 deg sway) giving the rider time to step clear.
      const u = Math.min(1, s.t / TEETER_SEC)
      const wobble = Math.sin(u * Math.PI * 2.5) * 0.0105 * (1 - u * 0.4)
      s.roll = Math.max(0.035, 0.045 + u * 0.02 + wobble)
      if (s.t >= TEETER_SEC) {
        s.phase = 'falling'
      }
      continue
    }

    // Inverted pendulum acceleration: theta'' = (g / h_cg) * sin(theta) - c * theta'
    const acc = GRAVITY_OVER_H * Math.sin(Math.max(0.04, s.roll)) - PENDULUM_DAMP * s.vel
    s.vel += acc * h
    s.roll += s.vel * h

    if (s.roll >= s.restRoll) {
      s.roll = s.restRoll
      const impactVel = Math.max(0, s.vel)
      const strength = Math.max(0.05, Math.min(1, impactVel / 5.5))
      s.bounces++
      if (impactVel >= SETTLE_VEL_EPS && s.bounces <= 3) {
        s.vel = -RESTITUTION * impactVel
        s.phase = 'settle'
        if (s.bounces === 1) s.hop = HOP_INITIAL_M * Math.max(0.5, strength)
        else s.hop = Math.max(s.hop, HOP_INITIAL_M * 0.32 * strength)
        if (strength > impactStrength) {
          impactStrength = strength
          impactBounce = s.bounces
        }
      } else {
        s.vel = 0
        s.hop = 0
        s.phase = 'rest'
        if (s.bounces === 1 && strength > impactStrength) {
          impactStrength = strength
          impactBounce = 1
        }
      }
    } else if (s.phase === 'settle' && s.roll < s.restRoll * 0.72) {
      s.roll = s.restRoll * 0.72
      if (s.vel < 0) s.vel = 0
    }
  }

  if (impactStrength > 0) return {impact: +impactStrength.toFixed(4), bounce: impactBounce}
  if (s.phase === 'rest') return 'rest'
  return 0
}

/**
 * Computes vertical chassis lift (m) as roll approaches horizontal so handlebars & pedals rest
 * cleanly on the pavement instead of clipping underground.
 */
export function tipLift(roll: number, hop = 0): number {
  const u = Math.max(0, Math.min(1, Math.abs(roll) / KICKSTAND.layRollRad))
  const s = u * u * (3 - 2 * u)
  return 0.265 * Math.pow(s, 1.35) + Math.max(0, hop)
}

/**
 * Advances kickstand deployment blend (0 = stowed, 1 = deployed) with crisp spring timing.
 * When `dt <= 0`, snaps directly to target for deterministic unit tests and teleport sync.
 */
export function stepKickstandBlend(cur: number, down: boolean, dt: number): number {
  const target = down ? 1 : 0
  if (dt <= 0) return target
  const clampedDt = Math.min(0.12, dt)
  const duration = down ? KICKSTAND.deploySec : KICKSTAND.retractSec
  const rate = 1 / Math.max(0.04, duration)
  const delta = target - cur
  if (Math.abs(delta) <= rate * clampedDt) return target
  return Math.max(0, Math.min(1, cur + Math.sign(delta) * rate * clampedDt))
}

/**
 * Maps linear kickstand blend [0..1] into a tactile curved factor with slight latch overshoot when deploying.
 */
export function kickstandDeployCurve(blend: number, deploying: boolean): number {
  const u = Math.max(0, Math.min(1, blend))
  if (u <= 0 || u >= 1) return u
  if (!deploying) return u * u
  // Smooth ease-out-back peaking at 1 + overshoot around u ~= 0.78 then settling to 1.0
  const inv = 1 - u
  const c1 = KICKSTAND.overshoot * 14
  const c3 = c1 + 1
  return 1 + c3 * (-inv * inv * inv) + c1 * (inv * inv)
}

/**
 * Pure kinematic calculation of the deployed kickstand footpad sole height in world Y
 * when the chassis is leaning at `leanRad` around +Z (positive = leaning left toward the stand).
 * Calibrated so `|kickstandFootY(KICKSTAND.leanRad)| < 0.01`.
 */
export function kickstandFootY(leanRad: number = KICKSTAND.leanRad): number {
  const [px, py] = KICKSTAND.pivot
  const L = KICKSTAND.legLength
  const sinZ = Math.sin(KICKSTAND.deployedRotZ) // negative => extends to -X (left)
  const cosZ = Math.cos(KICKSTAND.deployedRotZ)
  const cosX = Math.cos(KICKSTAND.deployedRotX)

  // Local tip (0, -L, 0) transformed by Euler('XYZ'): Rx(rotX) * Rz(rotZ) * (0, -L, 0)
  // Rz(rotZ) * (0, -L, 0) = (L * sinZ, -L * cosZ, 0)
  // Rx(rotX) preserves x and scales y by cos(rotX)
  const footLocalX = px + L * sinZ
  const footLocalY = py - L * cosZ * cosX

  // Chassis rolled by +leanRad around +Z: y' = x * sin(lean) + y * cos(lean)
  return footLocalX * Math.sin(leanRad) + footLocalY * Math.cos(leanRad)
}

function paintGeometry(geom: T.BufferGeometry, colorTop: number, colorBottom?: number): T.BufferGeometry {
  const pos = geom.attributes.position
  const count = pos.count
  const colors = new Float32Array(count * 3)
  const top = new T.Color(colorTop)
  const bot = colorBottom !== undefined ? new T.Color(colorBottom) : top

  let minY = Infinity
  let maxY = -Infinity
  if (colorBottom !== undefined) {
    for (let i = 0; i < count; i++) {
      const y = pos.getY(i)
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const spanY = Math.max(1e-4, maxY - minY)
  const tmp = new T.Color()
  for (let i = 0; i < count; i++) {
    if (colorBottom !== undefined) {
      const t = (pos.getY(i) - minY) / spanY
      tmp.copy(bot).lerp(top, t)
    } else {
      tmp.copy(top)
    }
    colors[i * 3] = tmp.r
    colors[i * 3 + 1] = tmp.g
    colors[i * 3 + 2] = tmp.b
  }
  geom.setAttribute('color', new T.BufferAttribute(colors, 3))
  if (!geom.attributes.uv) {
    geom.setAttribute('uv', new T.BufferAttribute(new Float32Array(count * 2), 2))
  }
  geom.computeVertexNormals()
  return geom
}

/**
 * Builds a single merged vertex-colored BufferGeometry for the articulated side kickstand:
 *  - Tapered steel leg with subtle vertical AO gradient (0x3a4046 -> 0x23262a)
 *  - Machined pivot bolt (0xa8b0b4) + return spring rod (0x9aa3a8)
 *  - Wide rubber footpad (0x1b1c1e) with dual anti-slip tread ribs angled to sit flush on pavement
 *
 * When `deployed === false`, geometry lives in pivot-local coordinates (for dynamic `kickstandPivot`).
 * When `deployed === true`, geometry is pre-rotated to the deployed stance and translated to chassis
 * coordinates so static parked e-bike shells merge it at 0 extra draw calls.
 */
export function buildKickstandGeometry(deployed: boolean): T.BufferGeometry {
  const parts: T.BufferGeometry[] = []
  const legLen = KICKSTAND.legLength - 0.011

  // Tapered main steel strut (origin at pivot, extending down along -Y)
  const strut = new T.CylinderGeometry(0.0145, 0.011, legLen, 8)
  strut.translate(0, -legLen * 0.5, 0)
  parts.push(paintGeometry(strut, 0x3a4046, 0x23262a))

  // Pivot mounting clevis & alloy bolt
  const bolt = new T.CylinderGeometry(0.021, 0.021, 0.032, 8)
  bolt.rotateZ(Math.PI / 2)
  parts.push(paintGeometry(bolt, 0xa8b0b4, 0x828a90))

  // Side return spring rod parallel to upper strut
  const spring = new T.CylinderGeometry(0.0048, 0.0048, 0.115, 6)
  spring.rotateZ(0.11)
  spring.translate(0.014, -0.062, 0.014)
  parts.push(paintGeometry(spring, 0x9aa3a8))

  // Small kick-tab toe spur halfway down the leg so the player can clearly recognize the side stand
  const spur = new T.CylinderGeometry(0.006, 0.0055, 0.055, 6)
  spur.rotateZ(Math.PI / 2 - 0.18)
  spur.translate(-0.028, -0.148, 0.008)
  parts.push(paintGeometry(spur, 0x5c646c))

  // Broad rubber footpad angled opposite deployed rotation so the sole lies parallel to flat ground at +7 deg lean
  const padEuler = new T.Euler(-KICKSTAND.deployedRotX, 0, -KICKSTAND.deployedRotZ - KICKSTAND.leanRad, 'XYZ')
  const padMat = new T.Matrix4().makeRotationFromEuler(padEuler)
  const padOffset = new T.Matrix4().makeTranslation(0, -KICKSTAND.legLength + 0.007, 0)
  padMat.premultiply(padOffset)

  const padBase = new T.BoxGeometry(0.072, 0.014, 0.048)
  padBase.applyMatrix4(padMat)
  parts.push(paintGeometry(padBase, 0x222427, 0x151618))

  for (const ribZ of [-0.012, 0.012]) {
    const rib = new T.BoxGeometry(0.064, 0.005, 0.007)
    rib.translate(0, -0.007, ribZ)
    rib.applyMatrix4(padMat)
    parts.push(paintGeometry(rib, 0x161719))
  }

  const merged = mergeGeometries(parts, false)
  for (const part of parts) part.dispose()
  if (!merged) throw new Error('Failed to merge kickstand geometry')

  if (deployed) {
    const [px, py, pz] = KICKSTAND.pivot
    const euler = new T.Euler(KICKSTAND.deployedRotX, 0, KICKSTAND.deployedRotZ, 'XYZ')
    const m = new T.Matrix4().makeRotationFromEuler(euler)
    m.setPosition(px, py, pz)
    merged.applyMatrix4(m)
  }

  merged.computeBoundingSphere()
  merged.computeBoundingBox()
  return merged
}
