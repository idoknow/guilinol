/**
 * 小香港 frame and open-stairwell geometry: pure numbers only, so the host main chunk can register the
 * terrain holes before tiles stream while the indoor runtime stays lazy.
 *
 * Mirrors pipeline/landmarks/central_square.py (XXG_STAIR_* / XXG_PORTAL_AXIAL); scripts/xiaoxianggang/xxg-scripts.test.mjs
 * keeps both in step.
 *
 * Portal-local frame (Object3D.rotation.y = portal yaw): x = across the well, +z = street side of the opening,
 * -z = walking down towards the B1 door. Heights below are relative to the street grade.
 */
import type { GroundStairwell } from '../tunnels'

export interface XxgXZ {
  readonly x: number
  readonly z: number
}

export const XXG_FRAME = {
  units: 'm',
  anchorWorld: { x: -845, z: 232 },
  axisE: { x: 0.938, z: 0.346 },
  axisS: { x: -0.346, z: 0.938 },
  /** World street grade at the four openings (m). */
  surfaceY: 153.868,
  /** Indoor floor y; B1 world height is surfaceY - XXG_STAIRWELL.depth. */
  indoorFloorY: 0,
} as const

export const XXG_AXIS_YAW = Math.atan2(-0.938, -0.346)

/** One stair flight shared by the landmark model, the terrain cut, the ramp collider and the indoor diorama. */
export const XXG_STAIRWELL = {
  /** Street grade to B1 floor. */
  depth: 4.2,
  risers: 25,
  riser: 0.168,
  tread: 0.3,
  /** Top nosing: the first riser drops here, at the street edge of the opening. */
  zTop: 4.05,
  /** Last nosing onto the bottom landing (zTop - 24 treads). */
  zBottom: -3.15,
  /** Inner face of the back wall that holds the B1 door. */
  zBack: -3.97,
  /** Clear half width between the side walls. */
  halfWidth: 2.27,
  doorHalfWidth: 1.6,
  doorHeight: 2.5,
  /** Going down: swap to the indoor scene once the walker is on the landing past this line. */
  enterZ: -3.45,
  /** Coming up: swap back to the world once the walker is on the landing past this line. */
  exitZ: -3.25,
  /** First-person view blend runs over this foot depth below grade (m). */
  blendStart: 0.6,
  blendFull: 3.4,
} as const

export type XxgPortalId = 'E1' | 'E2' | 'W1' | 'W2'

export interface XxgPortalSpec {
  readonly id: XxgPortalId
  readonly label: string
  /** Plaza axial coordinates of the well centre (= indoor x, z). */
  readonly along: number
  readonly across: number
  readonly yaw: number
}

export const XXG_PORTAL_SPECS: readonly XxgPortalSpec[] = [
  { id: 'E1', label: '东南入口', along: -22, across: 26.5, yaw: XXG_AXIS_YAW },
  { id: 'E2', label: '东北入口', along: -22, across: -26.5, yaw: XXG_AXIS_YAW + Math.PI },
  { id: 'W1', label: '西南入口', along: -78, across: 19.5, yaw: XXG_AXIS_YAW },
  { id: 'W2', label: '西北入口', along: -78, across: -19.5, yaw: XXG_AXIS_YAW },
]

/** Indoor (x, z) to world (x, z); bit-identical to pipeline _ax_pt. */
export function indoorToWorld(p: XxgXZ): XxgXZ {
  const { anchorWorld: a, axisE: e, axisS: s } = XXG_FRAME
  return { x: a.x + p.x * e.x + p.z * s.x, z: a.z + p.x * e.z + p.z * s.z }
}

/** World (x, z) to indoor (x, z): exact inverse of [E S]. */
export function worldToIndoor(p: XxgXZ): XxgXZ {
  const { anchorWorld: a, axisE: e, axisS: s } = XXG_FRAME
  const det = e.x * s.z - s.x * e.z
  const dx = p.x - a.x
  const dz = p.z - a.z
  return { x: (s.z * dx - s.x * dz) / det, z: (-e.z * dx + e.x * dz) / det }
}

/** Local (x, z) under Object3D.rotation.y = yaw, as an offset in the parent frame (pipeline Builder._xf). */
export function rotateLocal(local: XxgXZ, yaw: number): XxgXZ {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return { x: local.x * c + local.z * s, z: -local.x * s + local.z * c }
}

/** Host walkTo / camera.rotation.y convention: the camera looks along (-sin yaw, -cos yaw). */
export function yawFacing(dir: XxgXZ): number {
  return Math.atan2(-dir.x, -dir.z)
}

/** Walk line height (relative to grade) at portal-local lz: through the tread centres, flat on apron and landing. */
export function stairwellFloorY(lz: number): number {
  const w = XXG_STAIRWELL
  const y = -w.riser / 2 - (w.riser / w.tread) * (w.zTop - lz)
  return Math.min(0, Math.max(-w.depth, y))
}

/** 0 on the street, 1 on the landing: how far the camera has moved from third person into the walker's eyes. */
export function stairwellViewBlend(depthBelowGrade: number): number {
  const w = XXG_STAIRWELL
  const t = Math.min(1, Math.max(0, (depthBelowGrade - w.blendStart) / (w.blendFull - w.blendStart)))
  return t * t * (3 - 2 * t)
}

/** The four wells in world space for the host terrain cut and ramp collider. */
export function xxgGroundStairwells(): GroundStairwell[] {
  const w = XXG_STAIRWELL
  return XXG_PORTAL_SPECS.map(p => {
    const c = indoorToWorld({ x: p.along, z: p.across })
    return {
      id: `xxg-${p.id}`, x: c.x, z: c.z, grade: XXG_FRAME.surfaceY, yaw: p.yaw,
      halfWidth: w.halfWidth, zTop: w.zTop, zBack: w.zBack, depth: w.depth, riser: w.riser, tread: w.tread,
    }
  })
}
