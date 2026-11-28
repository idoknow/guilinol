import * as T from 'three'
import {V, palm, type Bind, type Curls, type Target} from './rig.ts'
import type {FaceCue} from './face.ts'

/** Per-sample values the runtime layers on top of the baked rotations. */
export interface Extras {
  /** Whole-body yaw; re-applied at the waist (spine_01) while walking. */
  yaw: number
  /** Pelvis translation in bind space (standing only). */
  offset: T.Vector3
  /** Index/middle root squeeze for the closed seal. */
  seal: number
  /** Weight for pelvis/spine_01/spine_02 (lets the seal lock hand those back untouched). */
  core: number
}

export interface Choreo {
  sample: (t: number, set: Target, bind: Bind, out: Extras) => void
  face: readonly FaceCue[]
}

// Index, middle, ring, pinky — three joints each.
export const RELAXED: Curls = [0.22, 0.28, 0.18, 0.28, 0.34, 0.22, 0.34, 0.38, 0.26, 0.4, 0.42, 0.3]
export const OPEN: Curls = [0.08, 0.1, 0.06, 0.1, 0.12, 0.07, 0.12, 0.13, 0.08, 0.15, 0.15, 0.1]
// Deep curl (~275° total) so fingertips press solidly into the palm with zero hollow gap even palm-up.
export const FIST: Curls = [1.62, 1.72, 1.38, 1.66, 1.76, 1.4, 1.7, 1.78, 1.42, 1.72, 1.8, 1.44]
export const POINT: Curls = [0.03, 0.04, 0.02, 1.66, 1.76, 1.4, 1.7, 1.78, 1.42, 1.72, 1.8, 1.44]
export const BLADE: Curls = [0.02, 0.03, 0.02, 0.02, 0.03, 0.02, 0.03, 0.04, 0.03, 0.04, 0.05, 0.04]
/** Pinky curls a touch more than the index when the fist squeezes. */
export const SQUEEZE: Curls = [0.6, 0.5, 0.4, 0.8, 0.7, 0.5, 0.9, 0.8, 0.6, 1, 0.9, 0.7]

/** Arms hanging softly outside the thighs, matching the idle silhouette with zero thigh/hip clip. */
export const REST = {
  wrist: (s: number) => V(s * 0.238, 0.865, 0.012),
  pole: (s: number) => V(s * 0.28, -0.1, -1),
  hand: (s: number) => palm(s, V(s * 0.04, -1, 0.1), V(-s * 0.92, -0.12, 0.36)),
}

/** Bind-space ankle, optionally stepped/turned around the pelvis and lifted. */
export function ankle(bind: Bind, side: string, yaw = 0, stance = V(0, 0, 0), lift = 0) {
  const pivot = bind('pelvis')
  pivot.y = 0
  const a = bind('foot_' + side)
  const local = a.clone().sub(pivot).add(stance).applyAxisAngle(V(0, 1, 0), yaw)
  return local.add(pivot).setY(a.y + lift)
}

export const SIDES = [
  ['r', -1],
  ['l', 1],
] as const
