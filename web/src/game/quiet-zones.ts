import rawZones from './quiet-zones-data.json'

export interface QuietZoneEntry {
  readonly id: string
  readonly name: string
  readonly schoolGround: boolean
  /** [minX, minZ, maxX, maxZ] in world XZ metres */
  readonly bbox: readonly [number, number, number, number]
  /** Closed or open polygon ring of [x, z] vertices in world metres */
  readonly polygon: readonly (readonly [number, number])[]
}

export interface QuietZoneCheck {
  quiet: boolean
  id?: string
  name?: string
}

/** 5 m perimeter buffer outside every school gate/fence (IDOK-123 / IDOK-128 gate). */
export const QUIET_ZONE_MARGIN_M = 5

export const QUIET_ZONES: readonly QuietZoneEntry[] = rawZones as unknown as QuietZoneEntry[]

function pointInPolygon(x: number, z: number, poly: readonly (readonly [number, number])[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1]
    const xj = poly[j][0], zj = poly[j][1]
    const intersects = (zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-12) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function pointToSegmentDistSq(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const lenSq = dx * dx + dz * dz
  if (lenSq <= 1e-9) {
    const ex = px - ax, ez = pz - az
    return ex * ex + ez * ez
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq))
  const cx = ax + t * dx
  const cz = az + t * dz
  const ex = px - cx, ez = pz - cz
  return ex * ex + ez * ez
}

function distToPolygonEdgeSq(x: number, z: number, poly: readonly (readonly [number, number])[]): number {
  let best = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const d2 = pointToSegmentDistSq(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1])
    if (d2 < best) best = d2
  }
  return best
}

/**
 * Checks whether world coordinate (x, z) falls inside any of the 25 Guilin school quiet zones
 * (21 `schoolGround: true` campuses + `libin_middle` + `guilin_middle` + `glmu_dongcheng` +
 * `wangcheng_teaching` inner courtyard), expanded outward by `marginM` (default 5 m).
 */
export function getQuietZoneAt(x: number, z: number, marginM = QUIET_ZONE_MARGIN_M): QuietZoneCheck {
  const m = Math.max(0, marginM)
  const m2 = m * m
  for (const zone of QUIET_ZONES) {
    const [minX, minZ, maxX, maxZ] = zone.bbox
    if (x < minX - m || x > maxX + m || z < minZ - m || z > maxZ + m) continue
    if (pointInPolygon(x, z, zone.polygon)) return {quiet: true, id: zone.id, name: zone.name}
    if (m > 0 && distToPolygonEdgeSq(x, z, zone.polygon) <= m2) {
      return {quiet: true, id: zone.id, name: zone.name}
    }
  }
  return {quiet: false}
}

export function isPointInQuietZone(x: number, z: number, marginM = QUIET_ZONE_MARGIN_M): boolean {
  return getQuietZoneAt(x, z, marginM).quiet
}

export function distanceToNearestQuietZone(x: number, z: number): {id: string; name: string; distanceM: number} {
  let bestId = ''
  let bestName = ''
  let bestDist = Infinity
  for (const zone of QUIET_ZONES) {
    if (pointInPolygon(x, z, zone.polygon)) {
      return {id: zone.id, name: zone.name, distanceM: 0}
    }
    const d = Math.sqrt(distToPolygonEdgeSq(x, z, zone.polygon))
    if (d < bestDist) {
      bestDist = d
      bestId = zone.id
      bestName = zone.name
    }
  }
  return {id: bestId, name: bestName, distanceM: +bestDist.toFixed(2)}
}
