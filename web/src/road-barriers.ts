import {
  DECOR_KIND_MEDIAN_GREEN_TREES,
  DECOR_KIND_VERGE_METAL_RAIL,
  DECOR_KIND_VERGE_SOFT_DELINEATOR,
  DECOR_KIND_VERGE_TREE_PLANTER,
  resolveMedianDividerKind,
  resolveVergeDividerKind,
  type RoadDividerKind,
} from './road-divider-profiles.ts'
import {isShizijieDecorSuppressed, SHIZIJIE_CURB_BARRIER_POLYLINES, SHIZIJIE_ORIGIN, touchesShizijieTile} from './shizijie-zone.ts'

export const ROAD_BARRIER_STRIDE = 7

export interface BarrierSpec {
  group: number
  offZ: number
  hz: number
  padX: number
  topOffset: number
  profile?: RoadDividerKind | 'stone_fence'
}

interface RawBarrier {
  group: number
  a: number
  tx: number
  tz: number
  nx: number
  nz: number
  cx: number
  cz: number
  halfL: number
  hz: number
  minBaseY: number
  maxBaseY: number
  topOffset: number
}

// Blocking street decor kinds from pipeline/streets.py & road-divider-profiles.ts:
// - kind 1/2: arterial road median -> resolved per Guilin corridor to median_metal_rail (group 1) or median_green_trees (group 7)
// - kind 5/6: motor/non-motor verge -> resolved per Guilin corridor to hedge_curb / metal_guardrail / tree_planter / soft_delineator
//   (soft_delineator & marking_only intentionally omit rigid barrier cuboids so narrow streets never trap vehicles/pedestrians)
// - kind 7 / 12: planted arterial median hedge / crape-myrtle tree strip (group 7)
// - kind 8: frontage stone-pillar + iron fence (group 8)
// - kind 13/14/15: forward-compatible explicit verge profile codes
// Explicitly excluded: kind 3 (parked bikes), 4 (sign pole), 9 (low curb strip), 10 (yellow paint), 11 (single bollard).
// Heights clear walkConfig.step (0.62 m above baseLevel+0.195) while remaining below 3rd-person camera focus (~foot+1.4 m).
export function resolveRoadBarrierSpec(
  kind: number,
  worldX?: number,
  worldZ?: number,
  headingRad?: number,
): BarrierSpec | null {
  const hasWorld = worldX !== undefined && worldZ !== undefined

  if (kind === 1 || kind === 2 || kind === 7 || kind === DECOR_KIND_MEDIAN_GREEN_TREES) {
    const profile = hasWorld
      ? resolveMedianDividerKind(worldX, worldZ, kind, headingRad)
      : (kind === 7 || kind === DECOR_KIND_MEDIAN_GREEN_TREES ? 'median_green_trees' : 'median_metal_rail')
    if (profile === 'median_green_trees') {
      return {group: 7, offZ: 0, hz: .37, padX: .02, topOffset: 1.12, profile}
    }
    return {group: 1, offZ: 0, hz: .08, padX: 0, topOffset: 1.22, profile}
  }

  if (
    kind === 5 || kind === 6 ||
    kind === DECOR_KIND_VERGE_METAL_RAIL ||
    kind === DECOR_KIND_VERGE_TREE_PLANTER ||
    kind === DECOR_KIND_VERGE_SOFT_DELINEATOR
  ) {
    // Legacy synthetic unit tests without world origin keep exact historical side offset (+/- 0.065, hz 0.54)
    if (!hasWorld) {
      if (kind === DECOR_KIND_VERGE_SOFT_DELINEATOR) return null
      if (kind === DECOR_KIND_VERGE_METAL_RAIL) return {group: 5, offZ: 0, hz: .52, padX: .02, topOffset: 1.16, profile: 'metal_guardrail'}
      if (kind === DECOR_KIND_VERGE_TREE_PLANTER) return {group: 5, offZ: 0, hz: .56, padX: .02, topOffset: 1.15, profile: 'tree_planter'}
      return kind === 5
        ? {group: 5, offZ: .065, hz: .54, padX: .02, topOffset: 1.10, profile: 'hedge_curb'}
        : {group: 6, offZ: -.065, hz: .54, padX: .02, topOffset: 1.10, profile: 'hedge_curb'}
    }
    const profile = resolveVergeDividerKind(worldX, worldZ, kind, headingRad)
    if (profile === 'soft_delineator' || profile === 'marking_only') return null
    const groupBase = kind === 6 ? 6 : 5
    if (profile === 'metal_guardrail') {
      // Covers motor-side white-grey guardrail (-0.86 m) and central tree verge seamlessly
      return {group: groupBase + 10, offZ: 0, hz: .90, padX: .02, topOffset: 1.16, profile}
    }
    if (profile === 'tree_planter') {
      return {group: groupBase + 20, offZ: 0, hz: .56, padX: .02, topOffset: 1.15, profile}
    }
    // hedge_curb: granite curb + layered shrub hedge + motor-side garden fence (-0.74 m)
    return {group: groupBase, offZ: 0, hz: .76, padX: .02, topOffset: 1.12, profile}
  }

  if (kind === 8) return {group: 8, offZ: 0, hz: .14, padX: 0, topOffset: 1.44, profile: 'stone_fence'}
  return null
}

const COS_MAX_ANGLE = Math.cos(.025)
const MAX_LATERAL_DRIFT = .08
// Quantization in pipeline/streets.py rounds anchors to 0.1 m, so touching segments can have <= 0.15 m gap.
// Keeping merge gap <= 0.18 m guarantees every real gap (crosswalks, intersections, cutouts >= 0.3 m) stays open.
const MAX_MERGE_GAP = .18
const MAX_MERGED_LENGTH = 24
const MAX_GRADE_DELTA = .14
const BOTTOM_EMBED = .10

function normalizeHalfCircle(angle: number): number {
  let a = angle % Math.PI
  if (a <= -Math.PI / 2) a += Math.PI
  else if (a > Math.PI / 2) a -= Math.PI
  return a
}

function clipSegmentToChunk(ax: number, az: number, bx: number, bz: number): [number, number, number, number] | null {
  let t0 = 0, t1 = 1
  const dx = bx - ax, dz = bz - az
  for (const [p, q] of [[-dx, ax], [dx, 256 - ax], [-dz, az], [dz, 256 - az]] as const) {
    if (Math.abs(p) < 1e-8) {
      if (q < 0) return null
    } else {
      const r = q / p
      if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r }
      else { if (r < t0) return null; if (r < t1) t1 = r }
    }
  }
  if (t1 <= t0) return null
  return [ax + t0 * dx, az + t0 * dz, ax + t1 * dx, az + t1 * dz]
}

/**
 * Extracts compact, collinear-merged Rapier cuboid definitions for blocking road decor in one 256 m chunk.
 * Output stride is ROAD_BARRIER_STRIDE (7): [cx, cy, cz, hx, hy, hz, yaw] in chunk-local X/Z and world Y.
 */
export function buildRoadBarriers(
  decor: readonly (readonly number[])[],
  baseLevel: (x: number, z: number) => number,
  origin?: readonly [number, number],
): Float32Array {
  const addShizijieCurbs = !!origin && touchesShizijieTile(origin[0], origin[1])
  if (!decor.length && !addShizijieCurbs) return new Float32Array(0)
  const raw: RawBarrier[] = []
  for (const item of decor) {
    const kind = item[0], east = item[1], south = item[2], heading = item[3], span = item[4] ?? 0
    const wx = origin ? origin[0] + east / 10 : undefined
    const wz = origin ? origin[1] + south / 10 : undefined
    if (addShizijieCurbs && wx !== undefined && wz !== undefined && isShizijieDecorSuppressed(wx, wz, kind)) continue
    const spec = resolveRoadBarrierSpec(kind, wx, wz, heading / 100)
    if (!spec) continue
    const length = span / 10 + spec.padX * 2
    if (length < .1) continue
    const angle = -heading / 100
    // Bake asymmetric verge fence offset into the cuboid center before half-circle angle normalization.
    const cx = east / 10 + spec.offZ * Math.sin(angle)
    const cz = south / 10 + spec.offZ * Math.cos(angle)
    const a = normalizeHalfCircle(angle)
    const tx = Math.cos(a), tz = -Math.sin(a)
    const nx = Math.sin(a), nz = Math.cos(a)
    const halfL = length * .5
    const yMid = baseLevel(cx, cz)
    const yA = baseLevel(cx - tx * halfL, cz - tz * halfL)
    const yB = baseLevel(cx + tx * halfL, cz + tz * halfL)
    raw.push({
      group: spec.group,
      a,
      tx,
      tz,
      nx,
      nz,
      cx,
      cz,
      halfL,
      hz: spec.hz,
      minBaseY: Math.min(yMid, yA, yB),
      maxBaseY: Math.max(yMid, yA, yB),
      topOffset: spec.topOffset,
    })
  }
  if (addShizijieCurbs && origin) {
    // Seal sidewalk-to-carriageway/cycleway edges continuously around Shizijie (IDOK-412)
    // so foot/sprint/jump cannot cross roadway gaps; `physics.ts` trims slices overlapped by landmarks.
    for (const poly of SHIZIJIE_CURB_BARRIER_POLYLINES) {
      for (let i = 1; i < poly.length; i++) {
        const ax = SHIZIJIE_ORIGIN[0] + poly[i - 1][0] - origin[0]
        const az = SHIZIJIE_ORIGIN[1] + poly[i - 1][1] - origin[1]
        const bx = SHIZIJIE_ORIGIN[0] + poly[i][0] - origin[0]
        const bz = SHIZIJIE_ORIGIN[1] + poly[i][1] - origin[1]
        const clipped = clipSegmentToChunk(ax, az, bx, bz)
        if (!clipped) continue
        const [sx, sz, ex, ez] = clipped
        const segLen = Math.hypot(ex - sx, ez - sz)
        if (segLen < .15) continue
        const pieces = Math.max(1, Math.ceil(segLen / 8))
        for (let k = 0; k < pieces; k++) {
          const u0 = k / pieces, u1 = (k + 1) / pieces
          const px0 = sx + (ex - sx) * u0, pz0 = sz + (ez - sz) * u0
          const px1 = sx + (ex - sx) * u1, pz1 = sz + (ez - sz) * u1
          const len = Math.hypot(px1 - px0, pz1 - pz0)
          if (len < .1) continue
          const ux = (px1 - px0) / len, uz = (pz1 - pz0) / len
          const a = normalizeHalfCircle(-Math.atan2(uz, ux))
          const tx = Math.cos(a), tz = -Math.sin(a)
          const nx = Math.sin(a), nz = Math.cos(a)
          const cx = (px0 + px1) * .5, cz = (pz0 + pz1) * .5
          const halfL = len * .5 + .10
          const yMid = baseLevel(cx, cz), yA = baseLevel(px0, pz0), yB = baseLevel(px1, pz1)
          raw.push({
            group: 9,
            a,
            tx,
            tz,
            nx,
            nz,
            cx,
            cz,
            halfL,
            hz: .12,
            minBaseY: Math.min(yMid, yA, yB),
            maxBaseY: Math.max(yMid, yA, yB),
            topOffset: 1.28,
          })
        }
      }
    }
  }
  if (!raw.length) return new Float32Array(0)

  const used = new Uint8Array(raw.length)
  const out: number[] = []
  for (let i = 0; i < raw.length; i++) {
    if (used[i]) continue
    used[i] = 1
    const seed = raw[i]
    const {tx, tz, nx, nz} = seed
    let minT = -seed.halfL
    let maxT = seed.halfL
    let sumDn = 0
    let sumW = seed.halfL * 2
    let minBaseY = seed.minBaseY
    let maxBaseY = seed.maxBaseY

    let extended = true
    while (extended) {
      extended = false
      for (let j = 0; j < raw.length; j++) {
        if (used[j]) continue
        const s = raw[j]
        if (s.group !== seed.group) continue
        if (Math.abs(s.tx * tx + s.tz * tz) < COS_MAX_ANGLE) continue
        const dx = s.cx - seed.cx, dz = s.cz - seed.cz
        const dn = dx * nx + dz * nz
        if (Math.abs(dn) > MAX_LATERAL_DRIFT) continue
        const dt = dx * tx + dz * tz
        const sMin = dt - s.halfL, sMax = dt + s.halfL
        if (sMin > maxT + MAX_MERGE_GAP || sMax < minT - MAX_MERGE_GAP) continue
        const nextMin = Math.min(minT, sMin)
        const nextMax = Math.max(maxT, sMax)
        if (nextMax - nextMin > MAX_MERGED_LENGTH) continue
        const nextMinY = Math.min(minBaseY, s.minBaseY)
        const nextMaxY = Math.max(maxBaseY, s.maxBaseY)
        if (nextMaxY - nextMinY > MAX_GRADE_DELTA) continue
        minT = nextMin
        maxT = nextMax
        minBaseY = nextMinY
        maxBaseY = nextMaxY
        const weight = s.halfL * 2
        sumDn += dn * weight
        sumW += weight
        used[j] = 1
        extended = true
      }
    }

    const midT = (minT + maxT) * .5
    const avgDn = sumDn / sumW
    const cx = seed.cx + tx * midT + nx * avgDn
    const cz = seed.cz + tz * midT + nz * avgDn
    const hx = (maxT - minT) * .5
    const bottomY = minBaseY - BOTTOM_EMBED
    const topY = maxBaseY + seed.topOffset
    const cy = (bottomY + topY) * .5
    const hy = (topY - bottomY) * .5
    out.push(cx, cy, cz, hx, hy, seed.hz, seed.a)
  }
  return Float32Array.from(out)
}
