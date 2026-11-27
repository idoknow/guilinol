/**
 * 十字街 open stairwells as plain numbers, so the host's small ground-stairwells chunk can cut the terrain and lay
 * the ramp collider before tiles stream without pulling in the B1 runtime. contract.ts builds its stairwells from
 * the same rows.
 *
 * Rows mirror pipeline/shizijie_underpass.py STAIRWELLS (centre in 十字街 local = indoor x/z, yaw, width, length);
 * `grade` is the measured street walking height at each mouth (m, world y). Stair-local frame: +z runs from the
 * street mouth (z = -length/2) down to the bottom nosing (z = +length/2) and on to the B1 door.
 */
import type { GroundStairwell } from '../tunnels'

export const SZJ_ORIGIN = { x: -879.7502021582604, z: -169.62604470000713 } as const

/** Street grade to B1 floor (m). */
export const SZJ_DEPTH = 4.2

/** B1 ceiling height (m), web/src/shizijie/layout/shizijie-b1.layout.json ceilingHeight; the landing collar sits on it. */
export const SZJ_B1_CEILING_H = 3.15

export const SZJ_STAIR = { riser: 0.15, tread: 0.3, count: 28, footRun: 1.5 } as const

/** Stations on the bottom landing, measured from the bottom nosing (stair-local z = length/2 + value). */
export const SZJ_LANDING = {
  /** B1 roller shutter line: end of the street-side landing; indoors it rolls up as the player nears. */
  door: 1.25,
  /** Going down: the world walker swaps into B1 past this line. */
  enter: 0.65,
  /** Coming up: the B1 player swaps back to the street walker before this line. */
  exit: 0.35,
} as const

export interface SzjWellRow {
  readonly id: 'nw' | 'ne' | 'se' | 'sw'
  readonly x: number
  readonly z: number
  readonly yawDeg: number
  readonly width: number
  readonly length: number
  readonly grade: number
}

export const SZJ_WELLS: readonly SzjWellRow[] = [
  { id: 'nw', x: -22.5, z: -38.8, yawDeg: 72, width: 3.4, length: 9, grade: 151.44 },
  { id: 'ne', x: 43, z: -23, yawDeg: -45, width: 3.4, length: 9, grade: 151.45 },
  { id: 'se', x: 22.5, z: 46.5, yawDeg: -158, width: 3.4, length: 9, grade: 151.41 },
  { id: 'sw', x: -46.2, z: 21.5, yawDeg: -131.2, width: 3.2, length: 8.8, grade: 151.45 },
]

/**
 * Host terrain cut + ramp collider. GroundStairwell descends towards its -z, so the yaw turns half a circle:
 * the hole opens at the first nosing (the top landing stays street) and ends at the bottom nosing, while the
 * ramp and its walls run on under the grade to the B1 door.
 */
export function szjGroundStairwells(): GroundStairwell[] {
  const S = SZJ_STAIR
  return SZJ_WELLS.map(w => {
    const hl = w.length / 2
    return {
      id: `szj-${w.id}`, x: SZJ_ORIGIN.x + w.x, z: SZJ_ORIGIN.z + w.z, grade: w.grade,
      yaw: w.yawDeg * (Math.PI / 180) + Math.PI,
      halfWidth: w.width / 2, zTop: hl - (w.length - S.count * S.tread), zBack: -hl - 0.03,
      depth: SZJ_DEPTH, riser: S.riser, tread: S.tread, land: -hl - SZJ_LANDING.door,
    }
  })
}
