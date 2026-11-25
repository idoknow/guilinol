export type XZPoint = readonly [number, number]

// World XZ origin of the `shizijie` landmark anchor in pipeline/landmarks.json.
export const SHIZIJIE_ORIGIN: XZPoint = [-879.7502021582604, -169.62604470000713]

// World-space AABB encompassing all Shizijie intersection & approach zones (with safety padding).
const ZONE_WORLD_MIN_X = SHIZIJIE_ORIGIN[0] - 135
const ZONE_WORLD_MAX_X = SHIZIJIE_ORIGIN[0] + 150
const ZONE_WORLD_MIN_Z = SHIZIJIE_ORIGIN[1] - 135
const ZONE_WORLD_MAX_Z = SHIZIJIE_ORIGIN[1] + 125

/** Returns true when a square terrain/street chunk overlaps the Shizijie zone. */
export function touchesShizijieTile(originX: number, originZ: number, tileSize = 256): boolean {
  return (
    originX <= ZONE_WORLD_MAX_X &&
    originX + tileSize >= ZONE_WORLD_MIN_X &&
    originZ <= ZONE_WORLD_MAX_Z &&
    originZ + tileSize >= ZONE_WORLD_MIN_Z
  )
}

// No surface crosswalk zone around Shizijie (IDOK-301 underground passage replaces all 4 surface crossings).
// Nearest legitimate surface crosswalks live at rel z <= -196.9 m (North) and rel x <= -217.5 m (West).
export const SHIZIJIE_NO_CROSSWALK_POLY: readonly XZPoint[] = [
  [-120, -50], [-52, -50], [-30, -110], [55, -110],
  [55, -40], [125, -30], [125, 55], [40, 55],
  [30, 105], [-65, 105], [-65, 45], [-120, 45],
]

// Precinct footprint overlapping `shizijie.glb` (IDOK-410-A), bounded cleanly short of `zhongshan_road.glb` (z >= +93.6).
// Visual legacy `decor` kinds 1, 2, 4, 5, 6, 7 are suppressed inside this polygon to avoid double-modeling.
export const SHIZIJIE_DECOR_EXCLUSION_POLY: readonly XZPoint[] = [
  [-92, -55], [-55, -55], [-45, -92], [65, -92],
  [65, -45], [138, -25], [138, 60], [65, 60],
  [45, 92], [-65, 92], [-65, 55], [-92, 45],
]

// Pedestrians/NPCs inside Shizijie must stay strictly outside all carriageways, right-turn slip lanes,
// medians, and isolated inner refuge islands; edges track the inner-curb side of the 4 outer sidewalks.
export const SHIZIJIE_NO_PED_CORE_POLY: readonly XZPoint[] = [
  [4.6, -86.5], [-6.3, -46.2], [-7.2, -46.1], [-12.6, -27.0], [-15.3, -24.9], [-19.2, -22.3],
  [-46.5, -28.2], [-70.0, -32.0], [-76.1, -34.6], [-102.0, -39.5],
  [-102.0, -0.5],
  [-76.3, 3.3], [-65.4, 14.0], [-40.6, 19.4], [-37.6, 24.0], [-34.1, 31.4],
  [-40.3, 48.2], [-39.0, 52.3], [-48.9, 81.0],
  [-10.0, 82.0],
  [-3.2, 64.5], [0.2, 62.4], [6.0, 46.7], [8.6, 39.5], [13.4, 36.2], [23.2, 31.1],
  [28.8, 28.7], [41.0, 31.4], [43.0, 29.7], [85.0, 40.2],
  [85.0, 9.8],
  [55.5, 2.5], [43.4, -0.1], [40.6, -2.9], [38.8, -5.8], [34.0, -13.2],
  [28.8, -19.0], [27.9, -21.4], [26.8, -24.3], [30.4, -36.6], [43.3, -86.5],
]

// Outer sidewalk curb lines (nudged ~0.3 m sidewalk-side) used to emit gap-free physical `roadBarriers`
// closing crosswalk/corner openings without intersecting any motor, nonmotor, or T-alley lane (e.g. Culture Palace Rd).
export const SHIZIJIE_CURB_BARRIER_POLYLINES: readonly (readonly XZPoint[])[] = [
  [[-98.0, -40.0], [-76.4, -35.3], [-70.2, -32.6], [-46.6, -29.0], [-19.5, -23.1], [-15.7, -25.7], [-13.2, -27.4], [-7.6, -46.4], [3.9, -86.4]],
  [[43.8, -86.4], [30.9, -36.6], [28.6, -21.3], [29.5, -18.9], [34.6, -13.0], [39.3, -6.2], [41.4, -3.2], [44.0, -0.8], [55.9, 1.8], [111.8, 15.7], [124.0, 18.7]],
  [[-13.4, 92.8], [-3.8, 64.8], [-0.4, 62.7], [5.5, 47.0], [8.4, 40.1], [13.5, 36.8], [23.3, 31.8], [28.8, 29.4], [40.9, 32.1], [43.0, 30.4], [85.5, 40.9]],
  [[103.5, 45.2], [124.0, 50.3]],
  [[-102.0, -1.0], [-76.7, 3.9], [-65.8, 14.7], [-41.2, 20.1], [-40.0, 21.4], [-38.4, 24.4], [-37.0, 26.9], [-35.5, 29.5], [-34.8, 31.6], [-40.9, 48.3], [-39.7, 52.3], [-48.6, 79.5]],
]

export function toShizijieRel(worldX: number, worldZ: number): [number, number] {
  return [worldX - SHIZIJIE_ORIGIN[0], worldZ - SHIZIJIE_ORIGIN[1]]
}

export function pointInRelPoly(rx: number, rz: number, poly: readonly XZPoint[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1]
    const xj = poly[j][0], zj = poly[j][1]
    if ((zi > rz) !== (zj > rz) && rx < ((xj - xi) * (rz - zi)) / (zj - zi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function orient2d(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
}

function segmentsIntersect(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): boolean {
  if (
    Math.max(ax, bx) < Math.min(cx, dx) || Math.min(ax, bx) > Math.max(cx, dx) ||
    Math.max(az, bz) < Math.min(cz, dz) || Math.min(az, bz) > Math.max(cz, dz)
  ) return false
  const d1 = orient2d(cx, cz, dx, dz, ax, az)
  const d2 = orient2d(cx, cz, dx, dz, bx, bz)
  const d3 = orient2d(ax, az, bx, bz, cx, cz)
  const d4 = orient2d(ax, az, bx, bz, dx, dz)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }
  const onSeg = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) =>
    Math.abs(orient2d(px, pz, qx, qz, rx, rz)) < 1e-7 &&
    rx >= Math.min(px, qx) - 1e-7 && rx <= Math.max(px, qx) + 1e-7 &&
    rz >= Math.min(pz, qz) - 1e-7 && rz <= Math.max(pz, qz) + 1e-7
  return onSeg(cx, cz, dx, dz, ax, az) || onSeg(cx, cz, dx, dz, bx, bz) || onSeg(ax, az, bx, bz, cx, cz) || onSeg(ax, az, bx, bz, dx, dz)
}

export function segmentIntersectsRelPoly(
  rx0: number, rz0: number,
  rx1: number, rz1: number,
  poly: readonly XZPoint[],
): boolean {
  if (pointInRelPoly(rx0, rz0, poly) || pointInRelPoly(rx1, rz1, poly)) return true
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segmentsIntersect(rx0, rz0, rx1, rz1, poly[j][0], poly[j][1], poly[i][0], poly[i][1])) {
      return true
    }
  }
  return false
}

export function isInShizijieNoPedZone(worldX: number, worldZ: number): boolean {
  const rx = worldX - SHIZIJIE_ORIGIN[0]
  const rz = worldZ - SHIZIJIE_ORIGIN[1]
  if (rx < -105 || rx > 88 || rz < -88 || rz > 84) return false
  return pointInRelPoly(rx, rz, SHIZIJIE_NO_PED_CORE_POLY)
}

export function segmentHitsShizijieNoPedZone(
  x0: number, z0: number,
  x1: number, z1: number,
): boolean {
  const rx0 = x0 - SHIZIJIE_ORIGIN[0], rz0 = z0 - SHIZIJIE_ORIGIN[1]
  const rx1 = x1 - SHIZIJIE_ORIGIN[0], rz1 = z1 - SHIZIJIE_ORIGIN[1]
  if (
    Math.max(rx0, rx1) < -105 || Math.min(rx0, rx1) > 88 ||
    Math.max(rz0, rz1) < -88 || Math.min(rz0, rz1) > 84
  ) return false
  return segmentIntersectsRelPoly(rx0, rz0, rx1, rz1, SHIZIJIE_NO_PED_CORE_POLY)
}

export function isNearShizijiePrecinct(worldX: number, worldZ: number, pad = 20): boolean {
  const rx = worldX - SHIZIJIE_ORIGIN[0]
  const rz = worldZ - SHIZIJIE_ORIGIN[1]
  return rx >= -110 - pad && rx <= 138 + pad && rz >= -95 - pad && rz <= 95 + pad
}

/** Projects a point strictly outside `SHIZIJIE_NO_PED_CORE_POLY` along its nearest outer curb edge. */
export function clampOutsideShizijieNoPedZone(
  worldX: number, worldZ: number, margin = 0.3,
): [number, number] {
  const rx = worldX - SHIZIJIE_ORIGIN[0]
  const rz = worldZ - SHIZIJIE_ORIGIN[1]
  if (rx < -105 || rx > 88 || rz < -88 || rz > 84) return [worldX, worldZ]
  if (!pointInRelPoly(rx, rz, SHIZIJIE_NO_PED_CORE_POLY)) return [worldX, worldZ]

  let bestDistSq = Infinity
  let bestX = rx
  let bestZ = rz
  let bestNx = 0
  let bestNz = 0
  const poly = SHIZIJIE_NO_PED_CORE_POLY
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j][0], az = poly[j][1]
    const bx = poly[i][0], bz = poly[i][1]
    const dx = bx - ax, dz = bz - az
    const lenSq = dx * dx + dz * dz
    if (lenSq < 1e-8) continue
    const t = Math.max(0, Math.min(1, ((rx - ax) * dx + (rz - az) * dz) / lenSq))
    const px = ax + dx * t
    const pz = az + dz * t
    const dSq = (rx - px) * (rx - px) + (rz - pz) * (rz - pz)
    if (dSq < bestDistSq) {
      bestDistSq = dSq
      bestX = px
      bestZ = pz
      const len = Math.sqrt(lenSq)
      // Pick the unit normal direction that actually exits `poly`.
      const nx = -dz / len, nz = dx / len
      if (!pointInRelPoly(px + nx * 0.15, pz + nz * 0.15, poly)) {
        bestNx = nx; bestNz = nz
      } else {
        bestNx = -nx; bestNz = -nz
      }
    }
  }
  return [
    SHIZIJIE_ORIGIN[0] + bestX + bestNx * margin,
    SHIZIJIE_ORIGIN[1] + bestZ + bestNz * margin,
  ]
}

export function isShizijieDecorSuppressed(worldX: number, worldZ: number, kind: number): boolean {
  if (kind !== 1 && kind !== 2 && kind !== 4 && kind !== 5 && kind !== 6 && kind !== 7) return false
  const rx = worldX - SHIZIJIE_ORIGIN[0]
  const rz = worldZ - SHIZIJIE_ORIGIN[1]
  if (rx < -95 || rx > 140 || rz < -95 || rz > 95) return false
  return pointInRelPoly(rx, rz, SHIZIJIE_DECOR_EXCLUSION_POLY)
}

/**
 * Matches only surface crosswalk zebra bars (`w ≈ 0.48 m, l ≈ 3.80 m, area ≈ 1.82 m²`) inside
 * `SHIZIJIE_NO_CROSSWALK_POLY` while preserving longitudinal lane lines (`w <= 0.40 m`),
 * stop lines (`l >= 4.65 m`), speed-limit digits (`area <= 0.30 m²`), and distant crosswalks.
 */
export function isShizijieCrosswalkRing(ringLocalPts: readonly XZPoint[], originX: number, originZ: number): boolean {
  const n = ringLocalPts.length
  if (n < 4 || n > 12) return false

  let cx = 0, cz = 0, area2 = 0
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ringLocalPts[i][0], zi = ringLocalPts[i][1]
    const xj = ringLocalPts[j][0], zj = ringLocalPts[j][1]
    cx += xi
    cz += zi
    area2 += xj * zi - xi * zj
  }
  cx = cx / n + originX - SHIZIJIE_ORIGIN[0]
  cz = cz / n + originZ - SHIZIJIE_ORIGIN[1]
  if (cx < -125 || cx > 130 || cz < -115 || cz > 110) return false
  if (!pointInRelPoly(cx, cz, SHIZIJIE_NO_CROSSWALK_POLY)) return false

  const area = Math.abs(area2) * 0.5
  if (area < 1.2 || area > 2.5) return false

  // Find longest edge to establish oriented bounding box axes.
  let ux = 1, uz = 0, maxEdgeSq = 0
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const dx = ringLocalPts[i][0] - ringLocalPts[j][0]
    const dz = ringLocalPts[i][1] - ringLocalPts[j][1]
    const dSq = dx * dx + dz * dz
    if (dSq > maxEdgeSq) {
      maxEdgeSq = dSq
      const len = Math.sqrt(dSq)
      ux = dx / len
      uz = dz / len
    }
  }
  if (maxEdgeSq < 1e-6) return false

  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
  for (const [x, z] of ringLocalPts) {
    const u = x * ux + z * uz
    const v = -x * uz + z * ux
    if (u < minU) minU = u
    if (u > maxU) maxU = u
    if (v < minV) minV = v
    if (v > maxV) maxV = v
  }
  const eu = maxU - minU
  const ev = maxV - minV
  const w = Math.min(eu, ev)
  const l = Math.max(eu, ev)
  return w >= 0.38 && w <= 0.62 && l >= 3.1 && l <= 4.35
}
