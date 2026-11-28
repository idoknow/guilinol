/**
 * City-wide road traffic markings generator implementing Chinese GB 5768 standards
 * with Guilin street-level fidelity and triangle-draping over rendered road surfaces.
 */

export interface RoadMarkingNode {
  id: number
  x: number
  z: number
}

export interface RoadMarkingLane {
  from: number
  to: number
  kind: 'motor' | 'bus' | 'nonmotor'
  cls: string
  offset: number
  width?: number
  oneway: boolean
  gradeSeparated?: 'linear' | 'jiefang'
}

export interface RoadMarkingSignal {
  node: number
  group?: number
}

export interface RoadMarkingBusStop {
  x: number
  z: number
  yaw: number
  side: number
}

export interface RoadMarkingGraph {
  nodes: RoadMarkingNode[]
  lanes: RoadMarkingLane[]
  signals: RoadMarkingSignal[]
  busStops?: RoadMarkingBusStop[]
}

export interface SchoolMarkingZone {
  x: number
  z: number
  radius?: number
}

export interface RoadMarkingBuildInput {
  origin: readonly [number, number]
  xyz: number[]
  rgb: number[]
  surfaceKinds: number[]
  alongVals: number[]
  roadTriOffsets: readonly number[]
  cycleTriOffsets: readonly number[]
  obstacleTriOffsets?: readonly number[]
  legacyKind2: readonly [number, ...[number, number][][]][]
  decor: readonly number[][]
  roadGraph?: RoadMarkingGraph | null
  shizijieCheck?: boolean
  shouldSuppressCrosswalk?: (ringMeters: readonly (readonly [number, number])[]) => boolean
  schoolZones?: readonly SchoolMarkingZone[]
}

export interface RoadMarkingBuildResult {
  emittedTriangles: number
  replacedDecor10: boolean
}

type Pt = readonly [number, number]
type RGB = readonly [number, number, number]

// Linear RGB equivalents for canonical repo traffic paint colors (matches THREE.Color(sRGB)):
// sRGB 0xebe7dc -> (235/255, 231/255, 220/255) linearized; sRGB 0xe7b62e -> traffic yellow.
function srgbChannelToLinear(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
function hexToLinearRGB(hex: number): [number, number, number] {
  return [
    srgbChannelToLinear((hex >> 16) & 255),
    srgbChannelToLinear((hex >> 8) & 255),
    srgbChannelToLinear(hex & 255),
  ]
}

export const PAINT_WHITE: RGB = hexToLinearRGB(0xebe7dc)
export const PAINT_YELLOW: RGB = hexToLinearRGB(0xe7b62e)
export const PAINT_WAIT_RED: RGB = hexToLinearRGB(0xa6443d)
export const PAINT_WAIT_YELLOW: RGB = hexToLinearRGB(0xdcb243)

const MARKING_LIFT_M = 0.006
const SCHOOL_MESH_LIFT_M = 0.0085
const TILE_SIZE = 256
const GRID_CELL = 8
const GRID_COLS = TILE_SIZE / GRID_CELL // 32

// Canonical Guilin landmark & school coordinates in world meters (from manifest.json / pipeline).
const SHIZIJIE_CENTER: Pt = [-879.75, -169.63]
const SHIZIJIE_ISLAND_R = 14
const LIZE_BRIDGE_DECK: { x: number; z: number; r: number } = { x: -1598.67, z: -184.88, r: 50 }
const GUANYI_BRIDGE_DECK: { x: number; z: number; r: number } = { x: -1510.94, z: -365.73, r: 34 }
const JIEFANG_BRIDGE_BOX = { minX: -398, maxX: 90, minZ: -55, maxZ: 130 }
const JIEFANG_PORTAL_X = -444
const ZHONGSHAN_PLANTER_BOX = { minX: -992, maxX: -888, minZ: -112, maxZ: 218 }

export const DEFAULT_SCHOOL_ZONES: readonly SchoolMarkingZone[] = [
  { x: -1362.8, z: 1.5, radius: 18 }, // 奎光学校门前（横跨 99_38 / 99_39，按世界坐标无缝对齐单一完整网格）
  { x: -1270, z: 1374, radius: 22 }, // 民族中学
]

const CLS_RANK: Record<string, number> = {
  trunk: 8,
  primary: 7,
  secondary: 6,
  tertiary: 5,
  unclassified: 4,
  residential: 3,
  living_street: 2,
  service: 1,
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function hypot2(dx: number, dz: number): number {
  return Math.hypot(dx, dz)
}

interface TriData {
  x0: number; y0: number; z0: number
  x1: number; y1: number; z1: number
  x2: number; y2: number; z2: number
  ux: number; uz: number
  vx: number; vz: number
  det: number
  sign: number
  minX: number; maxX: number; minZ: number; maxZ: number
}

class SpatialTriGrid {
  readonly tris: TriData[] = []
  readonly bins: number[][]
  readonly seen: Int32Array
  private stamp = 0

  constructor(xyz: readonly number[], offsets: readonly number[]) {
    this.bins = Array.from({ length: GRID_COLS * GRID_COLS }, () => [])
    for (let i = 0; i < offsets.length; i++) {
      const o = offsets[i]
      const x0 = xyz[o], y0 = xyz[o + 1], z0 = xyz[o + 2]
      const x1 = xyz[o + 3], y1 = xyz[o + 4], z1 = xyz[o + 5]
      const x2 = xyz[o + 6], y2 = xyz[o + 7], z2 = xyz[o + 8]
      const ux = x1 - x0, uz = z1 - z0
      const vx = x2 - x0, vz = z2 - z0
      const det = ux * vz - uz * vx
      if (Math.abs(det) < 1e-7) continue
      const minX = Math.min(x0, x1, x2), maxX = Math.max(x0, x1, x2)
      const minZ = Math.min(z0, z1, z2), maxZ = Math.max(z0, z1, z2)
      if (maxX < 0 || minX > TILE_SIZE || maxZ < 0 || minZ > TILE_SIZE) continue
      const idx = this.tris.length
      this.tris.push({
        x0, y0, z0, x1, y1, z1, x2, y2, z2,
        ux, uz, vx, vz, det, sign: det > 0 ? 1 : -1,
        minX, maxX, minZ, maxZ,
      })
      const c0 = clamp(Math.floor(minX / GRID_CELL), 0, GRID_COLS - 1)
      const c1 = clamp(Math.floor(maxX / GRID_CELL), 0, GRID_COLS - 1)
      const r0 = clamp(Math.floor(minZ / GRID_CELL), 0, GRID_COLS - 1)
      const r1 = clamp(Math.floor(maxZ / GRID_CELL), 0, GRID_COLS - 1)
      for (let r = r0; r <= r1; r++) {
        const base = r * GRID_COLS
        for (let c = c0; c <= c1; c++) this.bins[base + c].push(idx)
      }
    }
    this.seen = new Int32Array(this.tris.length)
  }

  get count(): number {
    return this.tris.length
  }

  queryBox(minX: number, minZ: number, maxX: number, maxZ: number, out: number[]): void {
    out.length = 0
    if (maxX < 0 || minX > TILE_SIZE || maxZ < 0 || minZ > TILE_SIZE || !this.tris.length) return
    const c0 = clamp(Math.floor(minX / GRID_CELL), 0, GRID_COLS - 1)
    const c1 = clamp(Math.floor(maxX / GRID_CELL), 0, GRID_COLS - 1)
    const r0 = clamp(Math.floor(minZ / GRID_CELL), 0, GRID_COLS - 1)
    const r1 = clamp(Math.floor(maxZ / GRID_CELL), 0, GRID_COLS - 1)
    const st = ++this.stamp
    for (let r = r0; r <= r1; r++) {
      const base = r * GRID_COLS
      for (let c = c0; c <= c1; c++) {
        const bin = this.bins[base + c]
        for (let i = 0; i < bin.length; i++) {
          const ti = bin[i]
          if (this.seen[ti] === st) continue
          this.seen[ti] = st
          const t = this.tris[ti]
          if (t.maxX < minX || t.minX > maxX || t.maxZ < minZ || t.minZ > maxZ) continue
          out.push(ti)
        }
      }
    }
  }

  containsPoint(x: number, z: number): boolean {
    if (x < 0 || x > TILE_SIZE || z < 0 || z > TILE_SIZE || !this.tris.length) return false
    const c = clamp(Math.floor(x / GRID_CELL), 0, GRID_COLS - 1)
    const r = clamp(Math.floor(z / GRID_CELL), 0, GRID_COLS - 1)
    const bin = this.bins[r * GRID_COLS + c]
    for (let i = 0; i < bin.length; i++) {
      const t = this.tris[bin[i]]
      if (x < t.minX || x > t.maxX || z < t.minZ || z > t.maxZ) continue
      const dx = x - t.x0, dz = z - t.z0
      const u = (dx * t.vz - dz * t.vx) / t.det
      const v = (t.ux * dz - t.uz * dx) / t.det
      if (u >= -1e-4 && v >= -1e-4 && u + v <= 1 + 1e-4) return true
    }
    return false
  }

  maxHeightAt(x: number, z: number): number | null {
    if (x < 0 || x > TILE_SIZE || z < 0 || z > TILE_SIZE || !this.tris.length) return null
    const c = clamp(Math.floor(x / GRID_CELL), 0, GRID_COLS - 1)
    const r = clamp(Math.floor(z / GRID_CELL), 0, GRID_COLS - 1)
    const bin = this.bins[r * GRID_COLS + c]
    let bestY: number | null = null
    for (let i = 0; i < bin.length; i++) {
      const t = this.tris[bin[i]]
      if (x < t.minX || x > t.maxX || z < t.minZ || z > t.maxZ) continue
      const dx = x - t.x0, dz = z - t.z0
      const u = (dx * t.vz - dz * t.vx) / t.det
      const v = (t.ux * dz - t.uz * dx) / t.det
      if (u >= -1e-4 && v >= -1e-4 && u + v <= 1 + 1e-4) {
        const y = t.y0 + u * (t.y1 - t.y0) + v * (t.y2 - t.y0)
        if (bestY === null || y > bestY) bestY = y
      }
    }
    return bestY
  }

  /**
   * Intersect scan line P(t) = (cx + t*rx, cz + t*rz), t in [tMin, tMax],
   * returning sorted merged solid intervals [a, b] lying inside triangles of this grid.
   */
  scanLineIntervals(
    cx: number,
    cz: number,
    rx: number,
    rz: number,
    tMin: number,
    tMax: number,
    candBuf: number[],
  ): [number, number][] {
    const ax = cx + tMin * rx, az = cz + tMin * rz
    const bx = cx + tMax * rx, bz = cz + tMax * rz
    this.queryBox(Math.min(ax, bx) - 0.1, Math.min(az, bz) - 0.1, Math.max(ax, bx) + 0.1, Math.max(az, bz) + 0.1, candBuf)
    if (!candBuf.length) return []

    const raw: [number, number][] = []
    for (let k = 0; k < candBuf.length; k++) {
      const tr = this.tris[candBuf[k]]
      let lo = tMin, hi = tMax
      const verts: readonly [number, number, number, number][] = [
        [tr.x0, tr.z0, tr.x1, tr.z1],
        [tr.x1, tr.z1, tr.x2, tr.z2],
        [tr.x2, tr.z2, tr.x0, tr.z0],
      ]
      let ok = true
      for (let e = 0; e < 3; e++) {
        const [ex0, ez0, ex1, ez1] = verts[e]
        const edx = ex1 - ex0, edz = ez1 - ez0
        const p0 = (edx * (cz - ez0) - edz * (cx - ex0)) * tr.sign
        const dp = (edx * rz - edz * rx) * tr.sign
        if (Math.abs(dp) < 1e-8) {
          if (p0 < -1e-5) { ok = false; break }
        } else {
          const hit = -p0 / dp
          if (dp > 0) lo = Math.max(lo, hit)
          else hi = Math.min(hi, hit)
          if (lo > hi + 1e-5) { ok = false; break }
        }
      }
      if (ok && hi - lo > 0.02) raw.push([lo, hi])
    }
    if (!raw.length) return []
    raw.sort((a, b) => a[0] - b[0])
    const merged: [number, number][] = [raw[0]]
    for (let i = 1; i < raw.length; i++) {
      const top = merged[merged.length - 1]
      if (raw[i][0] <= top[1] + 0.08) {
        if (raw[i][1] > top[1]) top[1] = raw[i][1]
      } else {
        merged.push(raw[i])
      }
    }
    return merged
  }
}

function clipConvexPolyToEdge(
  poly: [number, number][],
  ax: number, az: number, bx: number, bz: number, sign: number,
  out: [number, number][],
): void {
  out.length = 0
  if (poly.length < 3) return
  const edx = bx - ax, edz = bz - az
  let prev = poly[poly.length - 1]
  let prevSide = (edx * (prev[1] - az) - edz * (prev[0] - ax)) * sign
  let prevIn = prevSide >= -1e-6

  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]
    const curSide = (edx * (cur[1] - az) - edz * (cur[0] - ax)) * sign
    const curIn = curSide >= -1e-6
    if (curIn !== prevIn) {
      const denom = prevSide - curSide
      const t = Math.abs(denom) > 1e-9 ? clamp(prevSide / denom, 0, 1) : 0.5
      out.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])])
    }
    if (curIn) out.push(cur)
    prev = cur
    prevSide = curSide
    prevIn = curIn
  }
}

/**
 * Fan-triangulate an arbitrary simple polygon (with optional holes avoided for convex marks)
 * into convex triangles or ear-clipped simple polygon before Sutherland-Hodgman triangle clipping.
 */
function triangulateSimpleRing(pts: readonly Pt[]): [Pt, Pt, Pt][] {
  const n = pts.length
  if (n < 3) return []
  if (n === 3) return [[pts[0], pts[1], pts[2]]]
  if (n === 4) {
    // Check if strictly convex quad (all cross products same sign)
    let sign = 0, convex = true
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) & 3], c = pts[(i + 2) & 3]
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
      if (Math.abs(cr) > 1e-7) {
        const s = cr > 0 ? 1 : -1
        if (!sign) sign = s
        else if (s !== sign) { convex = false; break }
      }
    }
    if (convex) return [[pts[0], pts[1], pts[2]], [pts[0], pts[2], pts[3]]]
  }
  // Simple ear-clipping for small marking polygons (arrows, bike icons, chevrons).
  let area2 = 0
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n]
    area2 += a[0] * b[1] - b[0] * a[1]
  }
  const idx = Array.from({ length: n }, (_, i) => i)
  if (area2 < 0) idx.reverse()

  const out: [Pt, Pt, Pt][] = []
  let guard = 0
  while (idx.length > 3 && guard++ < n * 4) {
    let clipped = false
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k - 1 + idx.length) % idx.length]
      const i1 = idx[k]
      const i2 = idx[(k + 1) % idx.length]
      const a = pts[i0], b = pts[i1], c = pts[i2]
      const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
      if (cr <= 1e-8) continue
      let empty = true
      for (let m = 0; m < idx.length; m++) {
        const im = idx[m]
        if (im === i0 || im === i1 || im === i2) continue
        const p = pts[im]
        const c1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
        const c2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0])
        const c3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0])
        if (c1 >= -1e-7 && c2 >= -1e-7 && c3 >= -1e-7) { empty = false; break }
      }
      if (empty) {
        out.push([a, b, c])
        idx.splice(k, 1)
        clipped = true
        break
      }
    }
    if (!clipped) break
  }
  if (idx.length === 3) out.push([pts[idx[0]], pts[idx[1]], pts[idx[2]]])
  return out
}

class MarkingEmitter {
  private readonly cand: number[] = []
  private readonly obsCand: number[] = []
  private readonly bufA: [number, number][] = []
  private readonly bufB: [number, number][] = []
  private readonly roadGrid: SpatialTriGrid
  private readonly cycleGrid: SpatialTriGrid
  private readonly obstacleGrid: SpatialTriGrid
  private readonly xyz: number[]
  private readonly rgb: number[]
  private readonly surfaceKinds: number[]
  private readonly alongVals: number[]
  emittedTriangles = 0

  constructor(
    roadGrid: SpatialTriGrid,
    cycleGrid: SpatialTriGrid,
    obstacleGrid: SpatialTriGrid,
    xyz: number[],
    rgb: number[],
    surfaceKinds: number[],
    alongVals: number[],
  ) {
    this.roadGrid = roadGrid
    this.cycleGrid = cycleGrid
    this.obstacleGrid = obstacleGrid
    this.xyz = xyz
    this.rgb = rgb
    this.surfaceKinds = surfaceKinds
    this.alongVals = alongVals
  }

  private drapeConvexOnGrid(
    pts: readonly Pt[],
    grid: SpatialTriGrid,
    liftY: number,
    color: RGB,
  ): void {
    if (!grid.count || pts.length < 3) return
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (let i = 0; i < pts.length; i++) {
      const x = pts[i][0], z = pts[i][1]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    if (maxX < 0 || minX > TILE_SIZE || maxZ < 0 || minZ > TILE_SIZE) return

    grid.queryBox(minX, minZ, maxX, maxZ, this.cand)
    if (!this.cand.length) return

    const cr = color[0], cg = color[1], cb = color[2]
    const hasMulti = this.cand.length > 1
    const hasObs = this.obstacleGrid.count > 0
    for (let k = 0; k < this.cand.length; k++) {
      const tr = grid.tris[this.cand[k]]
      this.bufA.length = 0
      for (let i = 0; i < pts.length; i++) this.bufA.push([pts[i][0], pts[i][1]])
      clipConvexPolyToEdge(this.bufA, tr.x0, tr.z0, tr.x1, tr.z1, tr.sign, this.bufB)
      if (this.bufB.length < 3) continue
      clipConvexPolyToEdge(this.bufB, tr.x1, tr.z1, tr.x2, tr.z2, tr.sign, this.bufA)
      if (this.bufA.length < 3) continue
      clipConvexPolyToEdge(this.bufA, tr.x2, tr.z2, tr.x0, tr.z0, tr.sign, this.bufB)
      const n = this.bufB.length
      if (n < 3) continue

      let area2 = 0
      let sumX = 0, sumZ = 0
      for (let i = 0; i < n; i++) {
        const a = this.bufB[i], b = this.bufB[(i + 1) % n]
        area2 += a[0] * b[1] - b[0] * a[1]
        sumX += a[0]
        sumZ += a[1]
      }
      if (Math.abs(area2) < 4e-5) continue

      const cenX = sumX / n, cenZ = sumZ / n
      const cu = ((cenX - tr.x0) * tr.vz - (cenZ - tr.z0) * tr.vx) / tr.det
      const cv = (tr.ux * (cenZ - tr.z0) - tr.uz * (cenX - tr.z0)) / tr.det
      const yCen = tr.y0 + cu * (tr.y1 - tr.y0) + cv * (tr.y2 - tr.y0)

      // Top-surface-only draping: skip lower overlapped road/cycleway layers under a higher k0/k5 patch
      if (hasMulti) {
        let occluded = false
        for (let m = 0; m < this.cand.length; m++) {
          if (m === k) continue
          const tr2 = grid.tris[this.cand[m]]
          if (cenX < tr2.minX || cenX > tr2.maxX || cenZ < tr2.minZ || cenZ > tr2.maxZ) continue
          const dx2 = cenX - tr2.x0, dz2 = cenZ - tr2.z0
          const u2 = (dx2 * tr2.vz - dz2 * tr2.vx) / tr2.det
          const v2 = (tr2.ux * dz2 - tr2.uz * dx2) / tr2.det
          if (u2 >= -1e-4 && v2 >= -1e-4 && u2 + v2 <= 1 + 1e-4) {
            const y2 = tr2.y0 + u2 * (tr2.y1 - tr2.y0) + v2 * (tr2.y2 - tr2.y0)
            if (y2 > yCen + 0.0005 && y2 < yCen + 0.25) {
              occluded = true
              break
            }
          }
        }
        if (occluded) continue
      }

      // Obstacle shield: skip markings whose clipped centroid sits under a raised curb/island/planter bed
      if (hasObs) {
        const obsY = this.obstacleGrid.maxHeightAt(cenX, cenZ)
        if (obsY !== null && obsY > yCen + 0.04 && obsY < yCen + 1.0) continue
      }

      const ys = new Array<number>(n)
      for (let i = 0; i < n; i++) {
        const vx = this.bufB[i][0], vz = this.bufB[i][1]
        const px = vx - tr.x0, pz = vz - tr.z0
        const u = (px * tr.vz - pz * tr.vx) / tr.det
        const v = (tr.ux * pz - tr.uz * px) / tr.det
        let yBase = tr.y0 + u * (tr.y1 - tr.y0) + v * (tr.y2 - tr.y0)
        if (hasMulti) {
          for (let m = 0; m < this.cand.length; m++) {
            if (m === k) continue
            const tr2 = grid.tris[this.cand[m]]
            if (vx < tr2.minX || vx > tr2.maxX || vz < tr2.minZ || vz > tr2.maxZ) continue
            const dx2 = vx - tr2.x0, dz2 = vz - tr2.z0
            const u2 = (dx2 * tr2.vz - dz2 * tr2.vx) / tr2.det
            const v2 = (tr2.ux * dz2 - tr2.uz * dx2) / tr2.det
            if (u2 >= -1e-4 && v2 >= -1e-4 && u2 + v2 <= 1 + 1e-4) {
              const y2 = tr2.y0 + u2 * (tr2.y1 - tr2.y0) + v2 * (tr2.y2 - tr2.y0)
              if (y2 > yBase && y2 - yBase < 0.08) yBase = y2
            }
          }
        }
        ys[i] = yBase + liftY
      }
      const p0x = this.bufB[0][0], p0y = ys[0], p0z = this.bufB[0][1]
      for (let i = 1; i + 1 < n; i++) {
        let p1x = this.bufB[i][0], p1y = ys[i], p1z = this.bufB[i][1]
        let p2x = this.bufB[i + 1][0], p2y = ys[i + 1], p2z = this.bufB[i + 1][1]
        const ny = (p1z - p0z) * (p2x - p0x) - (p1x - p0x) * (p2z - p0z)
        if (Math.abs(ny) < 2e-5) continue
        if (ny < 0) {
          let t = p1x; p1x = p2x; p2x = t
          t = p1y; p1y = p2y; p2y = t
          t = p1z; p1z = p2z; p2z = t
        }
        this.xyz.push(p0x, p0y, p0z, p1x, p1y, p1z, p2x, p2y, p2z)
        this.rgb.push(cr, cg, cb, cr, cg, cb, cr, cg, cb)
        this.surfaceKinds.push(2, 2, 2)
        this.alongVals.push(0, 0, 0)
        this.emittedTriangles++
      }
    }
  }

  drapeQuad(
    p0: Pt, p1: Pt, p2: Pt, p3: Pt,
    target: 'road' | 'cycle' | 'both',
    color: RGB,
    liftY = MARKING_LIFT_M,
  ): void {
    const pts = [p0, p1, p2, p3]
    if (target === 'road' || target === 'both') this.drapeConvexOnGrid(pts, this.roadGrid, liftY, color)
    if (target === 'cycle' || target === 'both') this.drapeConvexOnGrid(pts, this.cycleGrid, liftY, color)
  }

  drapeStrip(
    ax: number, az: number, bx: number, bz: number,
    rx: number, rz: number,
    halfWidth: number,
    target: 'road' | 'cycle' | 'both',
    color: RGB,
    liftY = MARKING_LIFT_M,
  ): void {
    const ox = rx * halfWidth, oz = rz * halfWidth
    if (this.obstacleGrid.count > 0) {
      const len = hypot2(bx - ax, bz - az)
      if (len > 1.8) {
        this.obstacleGrid.queryBox(
          Math.min(ax, bx) - halfWidth - 0.5,
          Math.min(az, bz) - halfWidth - 0.5,
          Math.max(ax, bx) + halfWidth + 0.5,
          Math.max(az, bz) + halfWidth + 0.5,
          this.obsCand,
        )
        if (this.obsCand.length > 0) {
          const nSeg = Math.ceil(len / 1.2)
          for (let i = 0; i < nSeg; i++) {
            const f0 = i / nSeg, f1 = (i + 1) / nSeg
            const x0 = ax + (bx - ax) * f0, z0 = az + (bz - az) * f0
            const x1 = ax + (bx - ax) * f1, z1 = az + (bz - az) * f1
            this.drapeQuad([x0 - ox, z0 - oz], [x1 - ox, z1 - oz], [x1 + ox, z1 + oz], [x0 + ox, z0 + oz], target, color, liftY)
          }
          return
        }
      }
    }
    this.drapeQuad(
      [ax - ox, az - oz],
      [bx - ox, bz - oz],
      [bx + ox, bz + oz],
      [ax + ox, az + oz],
      target,
      color,
      liftY,
    )
  }

  drapePolygon(
    pts: readonly Pt[],
    target: 'road' | 'cycle' | 'both',
    color: RGB,
    liftY = MARKING_LIFT_M,
  ): void {
    const tris = triangulateSimpleRing(pts)
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i]
      if (target === 'road' || target === 'both') this.drapeConvexOnGrid(t, this.roadGrid, liftY, color)
      if (target === 'cycle' || target === 'both') this.drapeConvexOnGrid(t, this.cycleGrid, liftY, color)
    }
  }
}

interface TurnFlags {
  straight: boolean
  left: boolean
  right: boolean
}

interface GraphEdge {
  id: string
  u: number
  v: number
  ax: number; az: number
  bx: number; bz: number
  len: number
  ux: number; uz: number // forward unit tangent u->v
  rx: number; rz: number // right unit normal (-uz, ux)
  cls: string
  clsRank: number
  isTwoWay: boolean
  forwardOnly: boolean // true if oneway road
}

/**
 * Local shape polygons for GB 5768 road markings expressed in local (along, right) meters
 * where +along points in direction of travel and +right points to driver's right.
 */
function transformLocalPoly(
  cx: number, cz: number, ux: number, uz: number, rx: number, rz: number,
  pts: readonly Pt[],
): Pt[] {
  return pts.map(([a, r]) => [cx + ux * a + rx * r, cz + uz * a + rz * r] as const)
}

function emitArrow(
  emitter: MarkingEmitter,
  cx: number, cz: number, ux: number, uz: number, rx: number, rz: number,
  type: 'straight' | 'left' | 'right' | 'straight_left' | 'straight_right',
  target: 'road' | 'cycle' = 'road',
): void {
  const sh = 0.13
  const placeQuad = (localPts: readonly Pt[]) =>
    emitter.drapePolygon(transformLocalPoly(cx, cz, ux, uz, rx, rz, localPts), target, PAINT_WHITE)

  if (type === 'straight' || type === 'straight_left' || type === 'straight_right') {
    placeQuad([[-2.2, -sh], [0.85, -sh], [0.85, sh], [-2.2, sh]])
    placeQuad([[0.85, -0.48], [2.15, 0], [0.85, 0.48]])
  } else {
    // Trunk stops smoothly into curve shoulder
    placeQuad([[-2.2, -sh], [0.15, -sh], [0.15, sh], [-2.2, sh]])
  }
  const emitSideBranch = (signR: -1 | 1) => {
    // Smooth sweeping diagonal branch + aligned arrowhead per GB 5768 (no cramped T-stub)
    const b0 = type === 'left' || type === 'right' ? -0.15 : -0.60
    const da = 1.05, dr = 0.78 * signR
    const len = Math.hypot(da, dr)
    const bx = da / len, br = dr / len
    const nx = -br, nr = bx // perpendicular in (along, right)
    const tipA = b0 + da * 1.05, tipR = signR * 0.05 + dr * 1.05
    placeQuad([
      [b0 - nx * sh, signR * 0.05 - nr * sh],
      [tipA - nx * sh, tipR - nr * sh],
      [tipA + nx * sh, tipR + nr * sh],
      [b0 + nx * sh, signR * 0.05 + nr * sh],
    ])
    const headBaseA = tipA - bx * 0.14, headBaseR = tipR - br * 0.14
    const headApexA = tipA + bx * 0.96, headApexR = tipR + br * 0.96
    placeQuad([
      [headBaseA - nx * 0.40, headBaseR - nr * 0.40],
      [headApexA, headApexR],
      [headBaseA + nx * 0.40, headBaseR + nr * 0.40],
    ])
  }
  if (type === 'left' || type === 'straight_left') emitSideBranch(-1)
  if (type === 'right' || type === 'straight_right') emitSideBranch(1)
}

/** Draw clean GB 5768 bicycle & directional arrow ground icon inside a non-motor lane. */
function emitBikeIcon(
  emitter: MarkingEmitter,
  cx: number, cz: number, ux: number, uz: number, rx: number, rz: number,
  target: 'cycle' | 'road',
): void {
  const wheelPts = (wa: number, wr: number, rad = 0.24): Pt[] => {
    const out: Pt[] = []
    for (let i = 0; i < 8; i++) {
      const ang = (i * Math.PI) / 4
      out.push([wa + Math.cos(ang) * rad, wr + Math.sin(ang) * rad * 0.72])
    }
    return out
  }
  const emitRing = (wa: number, wr: number) => {
    const outer = wheelPts(wa, wr, 0.24)
    const inner = wheelPts(wa, wr, 0.16)
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) & 7
      emitter.drapePolygon(
        transformLocalPoly(cx, cz, ux, uz, rx, rz, [outer[i], outer[j], inner[j], inner[i]]),
        target,
        PAINT_WHITE,
      )
    }
  }
  // Rear wheel (-0.42), front wheel (+0.42) along +travel; slight width along right
  emitRing(-0.42, 0)
  emitRing(0.42, 0)
  // Frame bars: rear-to-saddle, saddle-to-stem, pedal-to-stem, stem-to-front-hub
  const bar = (a0: number, r0: number, a1: number, r1: number, hw = 0.04) => {
    const da = a1 - a0, dr = r1 - r0, l = Math.hypot(da, dr)
    if (l < 1e-4) return
    const na = (-dr / l) * hw, nr = (da / l) * hw
    emitter.drapePolygon(
      transformLocalPoly(cx, cz, ux, uz, rx, rz, [
        [a0 - na, r0 - nr], [a1 - na, r1 - nr], [a1 + na, r1 + nr], [a0 + na, r0 + nr],
      ]),
      target,
      PAINT_WHITE,
    )
  }
  bar(-0.42, 0, -0.08, -0.18) // chainstay/seatstay
  bar(-0.18, -0.26, 0.22, -0.22) // top tube
  bar(0.20, -0.28, 0.42, 0) // fork
  bar(-0.42, 0, -0.02, -0.02) // lower stay
  // Forward chevron arrow head in front (+0.95m..+1.35m)
  emitter.drapePolygon(
    transformLocalPoly(cx, cz, ux, uz, rx, rz, [
      [0.85, -0.28], [1.18, 0], [0.85, 0.28], [0.95, 0.28], [1.34, 0], [0.95, -0.28],
    ]),
    target,
    PAINT_WHITE,
  )
}

/** Draw yellow cross-hatched no-parking mesh box (黄色网状线) over [s0..s1] x [t0..t1]. */
function emitYellowMeshBox(
  emitter: MarkingEmitter,
  ax: number, az: number, ux: number, uz: number, rx: number, rz: number,
  s0: number, s1: number, t0: number, t1: number,
  worldAlongOffset = 0,
  capStart = true,
  capEnd = true,
  liftY = SCHOOL_MESH_LIFT_M,
): void {
  const wLine = 0.11 // half-width -> 0.22m frame bars
  const p = (s: number, t: number): Pt => [ax + ux * s + rx * t, az + uz * s + rz * t]
  // Longitudinal rails & optional end caps (omit internal cap across split nodes so box stays single & unbroken)
  emitter.drapeQuad(p(s0, t0), p(s1, t0), p(s1, t0 + wLine * 2), p(s0, t0 + wLine * 2), 'road', PAINT_YELLOW, liftY)
  emitter.drapeQuad(p(s0, t1 - wLine * 2), p(s1, t1 - wLine * 2), p(s1, t1), p(s0, t1), 'road', PAINT_YELLOW, liftY)
  if (capStart) emitter.drapeQuad(p(s0, t0), p(s0 + wLine * 2, t0), p(s0 + wLine * 2, t1), p(s0, t1), 'road', PAINT_YELLOW, liftY)
  if (capEnd) emitter.drapeQuad(p(s1 - wLine * 2, t0), p(s1, t0), p(s1, t1), p(s1 - wLine * 2, t1), 'road', PAINT_YELLOW, liftY)

  // Internal 45-degree crisscross grid inside [s0..s1] x [t0+w, t1-w], world-anchored across seams
  const inS0 = capStart ? s0 + wLine * 1.5 : s0, inS1 = capEnd ? s1 - wLine * 1.5 : s1
  const inT0 = t0 + wLine * 1.5, inT1 = t1 - wLine * 1.5
  const spanT = inT1 - inT0
  if (spanT < 1.2 || inS1 - inS0 < 0.8) return

  const clipDiag = (c: number, slope: number) => {
    // World-invariant lattice: t = slope * (s - c) avoids any dependence on curb-cropped inT0 across tile boundaries
    const pts: [number, number][] = []
    const sAtT0 = c + inT0 / slope, sAtT1 = c + inT1 / slope
    for (const sc of [inS0, inS1, sAtT0, sAtT1]) {
      const tc = slope * (sc - c)
      if (sc >= inS0 - 1e-4 && sc <= inS1 + 1e-4 && tc >= inT0 - 1e-4 && tc <= inT1 + 1e-4) {
        if (!pts.some(([ps, pt]) => Math.hypot(ps - sc, pt - tc) < 0.05)) pts.push([sc, tc])
      }
    }
    if (pts.length !== 2) return
    const ds = pts[1][0] - pts[0][0], dt = pts[1][1] - pts[0][1]
    const l = Math.hypot(ds, dt)
    if (l < 0.4) return
    const ns = (-dt / l) * 0.085, nt = (ds / l) * 0.085
    emitter.drapeQuad(
      p(pts[0][0] - ns, pts[0][1] - nt),
      p(pts[1][0] - ns, pts[1][1] - nt),
      p(pts[1][0] + ns, pts[1][1] + nt),
      p(pts[0][0] + ns, pts[0][1] + nt),
      'road',
      PAINT_YELLOW,
      liftY,
    )
  }
  const pitch = 2.0
  const maxAbsT = Math.max(Math.abs(inT0), Math.abs(inT1))
  const worldCMin = (worldAlongOffset + inS0) - maxAbsT
  const worldCMax = (worldAlongOffset + inS1) + maxAbsT
  const kStart = Math.floor(worldCMin / pitch)
  const kEnd = Math.ceil(worldCMax / pitch)
  for (let k = kStart; k <= kEnd; k++) {
    const c = k * pitch - worldAlongOffset
    clipDiag(c, 1)
    clipDiag(c, -1)
  }
}

function inBox(x: number, z: number, b: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean {
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ
}

function isBridgeExcluded(wx: number, wz: number): boolean {
  if (inBox(wx, wz, JIEFANG_BRIDGE_BOX)) return true
  if (hypot2(wx - LIZE_BRIDGE_DECK.x, wz - LIZE_BRIDGE_DECK.z) < LIZE_BRIDGE_DECK.r) return true
  if (hypot2(wx - GUANYI_BRIDGE_DECK.x, wz - GUANYI_BRIDGE_DECK.z) < GUANYI_BRIDGE_DECK.r) return true
  return false
}

function minDistToRectPoints(ring: readonly Pt[]): { minW: number; maxL: number; area: number; cx: number; cz: number; ux: number; uz: number; fill: number } | null {
  if (ring.length < 4 || ring.length > 10) return null
  let minArea = Infinity, bestW = 0, bestL = 0, bux = 1, buz = 0
  let sumX = 0, sumZ = 0, signedArea2 = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    sumX += a[0]; sumZ += a[1]
    signedArea2 += a[0] * b[1] - b[0] * a[1]
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz)
    if (len < 1e-4) continue
    const ux = dx / len, uz = dz / len
    let pMin = Infinity, pMax = -Infinity, qMin = Infinity, qMax = -Infinity
    for (let j = 0; j < ring.length; j++) {
      const pr = ring[j][0] * ux + ring[j][1] * uz
      const qr = -ring[j][0] * uz + ring[j][1] * ux
      if (pr < pMin) pMin = pr; if (pr > pMax) pMax = pr
      if (qr < qMin) qMin = qr; if (qr > qMax) qMax = qr
    }
    const w = pMax - pMin, h = qMax - qMin
    if (w * h < minArea) {
      minArea = w * h
      if (w >= h) { bestL = w; bestW = h; bux = ux; buz = uz }
      else { bestL = h; bestW = w; bux = -uz; buz = ux }
    }
  }
  const area = Math.abs(signedArea2) * 0.5
  if (minArea <= 1e-5) return null
  return {
    minW: bestW, maxL: bestL, area,
    cx: sumX / ring.length, cz: sumZ / ring.length,
    ux: bux, uz: buz,
    fill: area / minArea,
  }
}

interface LegacyCrosswalkCluster {
  cx: number
  cz: number
  bars: { ring: Pt[]; obb: NonNullable<ReturnType<typeof minDistToRectPoints>> }[]
}

function extractLegacyCrosswalks(
  legacyKind2: RoadMarkingBuildInput['legacyKind2'],
  origin: readonly [number, number],
  shouldSuppressCrosswalk?: (ring: readonly Pt[]) => boolean,
): LegacyCrosswalkCluster[] {
  const bars: { ring: Pt[]; obb: NonNullable<ReturnType<typeof minDistToRectPoints>> }[] = []
  for (let i = 0; i < legacyKind2.length; i++) {
    const entry = legacyKind2[i]
    if (!entry[1] || entry[1].length < 4) continue
    const ring: Pt[] = entry[1].map(([xCm, zCm]) => [xCm / 100, zCm / 100] as const)
    if (shouldSuppressCrosswalk && shouldSuppressCrosswalk(ring)) continue
    const obb = minDistToRectPoints(ring)
    if (!obb || obb.fill < 0.72) continue
    if (obb.minW >= 0.36 && obb.minW <= 0.85 && obb.maxL >= 2.2 && obb.maxL <= 5.5) {
      if (isBridgeExcluded(origin[0] + obb.cx, origin[1] + obb.cz)) continue
      bars.push({ ring, obb })
    }
  }
  // Group orientation-compatible bars within 3.2m of each other so perpendicular crosswalks never merge into an L-cluster
  const used = new Uint8Array(bars.length)
  const clusters: LegacyCrosswalkCluster[] = []
  for (let i = 0; i < bars.length; i++) {
    if (used[i]) continue
    used[i] = 1
    const q = [bars[i]]
    let head = 0
    while (head < q.length) {
      const cur = q[head++]
      for (let j = 0; j < bars.length; j++) {
        if (used[j]) continue
        const dot = Math.abs(bars[j].obb.ux * cur.obb.ux + bars[j].obb.uz * cur.obb.uz)
        if (dot < 0.88) continue
        if (hypot2(bars[j].obb.cx - cur.obb.cx, bars[j].obb.cz - cur.obb.cz) < 3.2) {
          used[j] = 1
          q.push(bars[j])
        }
      }
    }
    if (q.length < 2) continue
    let sx = 0, sz = 0
    for (let k = 0; k < q.length; k++) { sx += q[k].obb.cx; sz += q[k].obb.cz }
    clusters.push({ cx: sx / q.length, cz: sz / q.length, bars: q })
  }
  return clusters
}

function subtractIntervals(start: number, end: number, skips: readonly [number, number][]): [number, number][] {
  let active: [number, number][] = start < end ? [[start, end]] : []
  for (let i = 0; i < skips.length && active.length; i++) {
    const [a, b] = skips[i]
    if (b <= start || a >= end) continue
    const next: [number, number][] = []
    for (let j = 0; j < active.length; j++) {
      const [s0, s1] = active[j]
      if (b <= s0 || a >= s1) { next.push([s0, s1]); continue }
      if (a > s0 + 0.15) next.push([s0, Math.min(a, s1)])
      if (b < s1 - 0.15) next.push([Math.max(b, s0), s1])
    }
    active = next
  }
  return active
}

function hasMedianDecorNear(
  decor: readonly number[][],
  wx: number, wz: number, rx: number, rz: number,
  tMin: number, tMax: number, maxAlong = 14,
): boolean {
  for (let i = 0; i < decor.length; i++) {
    const k = decor[i][0]
    if (k !== 1 && k !== 2 && k !== 7) continue
    const dx = decor[i][1] / 10 - wx, dz = decor[i][2] / 10 - wz
    const perp = dx * rx + dz * rz
    if (perp < tMin || perp > tMax) continue
    const along = Math.abs(-dx * rz + dz * rx)
    if (along <= maxAlong) return true
  }
  return false
}

function collectDecor10Boxes(
  decor: readonly number[][],
  origin: readonly [number, number],
  schoolZones: readonly SchoolMarkingZone[] = [],
): { cx: number; cz: number; halfL: number }[] {
  const pts: { x: number; z: number }[] = []
  for (let i = 0; i < decor.length; i++) {
    if (decor[i][0] === 10) pts.push({ x: decor[i][1] / 10, z: decor[i][2] / 10 })
  }
  const used = new Uint8Array(pts.length)
  const clusters: { cx: number; cz: number; halfL: number }[] = []
  for (let i = 0; i < pts.length; i++) {
    if (used[i]) continue
    used[i] = 1
    const group = [pts[i]]
    let head = 0
    while (head < group.length) {
      const c = group[head++]
      for (let j = 0; j < pts.length; j++) {
        if (!used[j] && hypot2(pts[j].x - c.x, pts[j].z - c.z) < 4.5) {
          used[j] = 1
          group.push(pts[j])
        }
      }
    }
    let sx = 0, sz = 0
    for (const p of group) { sx += p.x; sz += p.z }
    const cx = sx / group.length
    const cz = sz / group.length
    const wx = origin[0] + cx, wz = origin[1] + cz
    // Avoid duplicating any configured canonical school zone (prevents z=0 tile-seam double box at Kuiguang)
    if (schoolZones.some(z => hypot2(wx - z.x, wz - z.z) < (z.radius ?? 18) + 16)) continue
    let maxD = 5.0
    for (const p of group) maxD = Math.max(maxD, hypot2(p.x - cx, p.z - cz) + 2.5)
    const halfL = clamp(maxD, 5.5, 9.0)
    clusters.push({ cx, cz, halfL })
  }
  return clusters
}

function buildGraphEdges(
  origin: readonly [number, number],
  graph: RoadMarkingGraph,
): {
  nodeMap: Map<number, Pt>
  edges: GraphEdge[]
  allOutByNode: Map<number, { to: number; ux: number; uz: number; clsRank: number; oneway: boolean }[]>
  allInByNode: Map<number, { from: number; ux: number; uz: number; clsRank: number; oneway: boolean }[]>
  signalNodes: Set<number>
  signalGroupByNode: Map<number, number>
} {
  const nodeMap = new Map<number, Pt>()
  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i]
    nodeMap.set(n.id, [n.x - origin[0], n.z - origin[1]])
  }
  const signalNodes = new Set<number>()
  const signalGroupByNode = new Map<number, number>()
  for (let i = 0; i < graph.signals.length; i++) {
    const s = graph.signals[i]
    signalNodes.add(s.node)
    if (s.group !== undefined) signalGroupByNode.set(s.node, s.group)
  }

  // Group directed edges (u,v) collapsing multi-lane records on same node pair
  const directed = new Map<string, { u: number; v: number; cls: string; clsRank: number; oneway: boolean; gs?: string }>()
  const allOutByNode = new Map<number, { to: number; ux: number; uz: number; clsRank: number; oneway: boolean }[]>()
  const allInByNode = new Map<number, { from: number; ux: number; uz: number; clsRank: number; oneway: boolean }[]>()

  for (let i = 0; i < graph.lanes.length; i++) {
    const l = graph.lanes[i]
    if (l.kind === 'nonmotor' || l.gradeSeparated === 'jiefang') continue
    const nu = nodeMap.get(l.from), nv = nodeMap.get(l.to)
    if (!nu || !nv) continue
    const dx = nv[0] - nu[0], dz = nv[1] - nu[1]
    const len = Math.hypot(dx, dz)
    if (len < 0.8) continue
    const r = CLS_RANK[l.cls] ?? 3
    const k = `${l.from}_${l.to}`
    const prev = directed.get(k)
    if (!prev || r > prev.clsRank) {
      directed.set(k, { u: l.from, v: l.to, cls: l.cls, clsRank: r, oneway: l.oneway, gs: l.gradeSeparated })
    }
  }

  for (const d of directed.values()) {
    const nu = nodeMap.get(d.u)!, nv = nodeMap.get(d.v)!
    const dx = nv[0] - nu[0], dz = nv[1] - nu[1], len = Math.hypot(dx, dz)
    const ux = dx / len, uz = dz / len
    let outs = allOutByNode.get(d.u)
    if (!outs) { outs = []; allOutByNode.set(d.u, outs) }
    if (!outs.some(o => o.to === d.v)) outs.push({ to: d.v, ux, uz, clsRank: d.clsRank, oneway: d.oneway })
    let ins = allInByNode.get(d.v)
    if (!ins) { ins = []; allInByNode.set(d.v, ins) }
    if (!ins.some(o => o.from === d.u)) ins.push({ from: d.u, ux, uz, clsRank: d.clsRank, oneway: d.oneway })
  }

  // Merge (u->v) and (v->u) when undirected/two-way
  const edges: GraphEdge[] = []
  const consumed = new Set<string>()
  for (const [k, d] of directed) {
    if (consumed.has(k)) continue
    const revKey = `${d.v}_${d.u}`
    const rev = directed.get(revKey)
    const twoWay = !d.oneway || !!rev
    if (twoWay) {
      consumed.add(k)
      consumed.add(revKey)
    } else {
      consumed.add(k)
    }
    const useRev = twoWay && d.u > d.v && !!rev
    const u = useRev ? d.v : d.u
    const v = useRev ? d.u : d.v
    const nu = nodeMap.get(u)!, nv = nodeMap.get(v)!
    // Skip edges well outside tile + 28m junction margin
    const minX = Math.min(nu[0], nv[0]), maxX = Math.max(nu[0], nv[0])
    const minZ = Math.min(nu[1], nv[1]), maxZ = Math.max(nu[1], nv[1])
    if (maxX < -28 || minX > TILE_SIZE + 28 || maxZ < -28 || minZ > TILE_SIZE + 28) continue
    const dx = nv[0] - nu[0], dz = nv[1] - nu[1], len = Math.hypot(dx, dz)
    const ux = dx / len, uz = dz / len
    const cls = rev && rev.clsRank > d.clsRank ? rev.cls : d.cls
    edges.push({
      id: `${u}_${v}`,
      u, v,
      ax: nu[0], az: nu[1], bx: nv[0], bz: nv[1],
      len, ux, uz, rx: -uz, rz: ux,
      cls, clsRank: Math.max(d.clsRank, rev?.clsRank ?? 0),
      isTwoWay: twoWay,
      forwardOnly: !twoWay,
    })
  }

  return { nodeMap, edges, allOutByNode, allInByNode, signalNodes, signalGroupByNode }
}

function inferTurnsAtNode(
  nodeId: number,
  ux: number, uz: number,
  nodeMap: Map<number, Pt>,
  allOutByNode: Map<number, { to: number; ux: number; uz: number; clsRank: number; oneway: boolean }[]>,
  signalGroupByNode: Map<number, number>,
): TurnFlags {
  const flags: TurnFlags = { straight: false, left: false, right: false }
  const originPt = nodeMap.get(nodeId)
  if (!originPt) return { straight: true, left: false, right: false }
  const targetGroup = signalGroupByNode.get(nodeId)

  // BFS at most 2 hops across short junction box edges (< 28m) or same signal group
  // so multi-node divided-arterial signal boxes see straight + left + right!
  const visited = new Map<number, number>([[nodeId, 0]])
  const queue: number[] = [nodeId]
  let head = 0
  while (head < queue.length) {
    const nid = queue[head++]
    const depth = visited.get(nid)!
    const npt = nodeMap.get(nid)
    if (!npt) continue
    const outs = allOutByNode.get(nid) ?? []
    for (let i = 0; i < outs.length; i++) {
      const o = outs[i]
      const tpt = nodeMap.get(o.to)
      if (!tpt) continue
      const hopLen = hypot2(tpt[0] - npt[0], tpt[1] - npt[1])
      const dot = ux * o.ux + uz * o.uz
      const cross = ux * o.uz - uz * o.ux // + is RIGHT turn in XZ (East x South = +1)
      if (dot < -0.75) continue // U-turn / back onto opposite edge
      if (dot > 0.84) flags.straight = true
      else if (cross <= -0.46) flags.left = true
      else if (cross >= 0.46) flags.right = true

      const inSameBox = targetGroup !== undefined && signalGroupByNode.get(o.to) === targetGroup
      const shortHop = hopLen <= 28 && hypot2(tpt[0] - originPt[0], tpt[1] - originPt[1]) <= 36
      if (depth < 2 && (inSameBox || shortHop) && !visited.has(o.to)) {
        visited.set(o.to, depth + 1)
        queue.push(o.to)
      }
    }
  }
  if (!flags.straight && !flags.left && !flags.right) flags.straight = true
  return flags
}

function chooseArrowTypes(nLanes: number, turns: TurnFlags): ('straight' | 'left' | 'right' | 'straight_left' | 'straight_right' | null)[] {
  if (nLanes <= 0) return []
  if (nLanes === 1) {
    if (turns.left && !turns.straight && !turns.right) return ['left']
    if (turns.right && !turns.straight && !turns.left) return ['right']
    if (turns.left && turns.straight && !turns.right) return ['straight_left']
    if (turns.right && turns.straight && !turns.left) return ['straight_right']
    return ['straight']
  }
  const res = new Array<'straight' | 'left' | 'right' | 'straight_left' | 'straight_right' | null>(nLanes).fill('straight')
  if (nLanes === 2) {
    res[0] = turns.left ? (turns.straight ? 'straight_left' : 'left') : 'straight'
    res[1] = turns.right ? (turns.straight ? 'straight_right' : 'right') : 'straight'
    return res
  }
  // nLanes >= 3
  res[0] = turns.left ? 'left' : 'straight'
  if (!turns.straight && turns.left && nLanes >= 3) res[1] = 'left'
  res[nLanes - 1] = turns.right ? (turns.straight && nLanes === 3 ? 'straight_right' : 'right') : 'straight'
  if (!turns.straight && !turns.left && turns.right) {
    for (let i = 0; i < nLanes; i++) res[i] = 'right'
  }
  return res
}

function nodeCrossingInfo(
  nodeId: number,
  ux: number, uz: number, // outgoing toward nodeId (incoming direction)
  clsRankEdge: number,
  nodeMap: Map<number, Pt>,
  allInByNode: Map<number, { from: number; ux: number; uz: number; clsRank: number; oneway: boolean }[]>,
  allOutByNode: Map<number, { to: number; ux: number; uz: number; clsRank: number; oneway: boolean }[]>,
  signalNodes: Set<number>,
): { isControlled: boolean; isMinorYieldOnly: boolean; crossHalfEst: number } {
  const isSig = signalNodes.has(nodeId)
  const ins = allInByNode.get(nodeId) ?? []
  const outs = allOutByNode.get(nodeId) ?? []
  let maxCrossRank = 0
  let maxCrossHalf = 4.5
  let hasCrossArm = false
  let nonServiceArms = 0

  const considerArm = (ax: number, az: number, rank: number) => {
    const dot = Math.abs(ax * ux + az * uz)
    // True cross street meets at >= 44 deg (|dot| < 0.72), ignoring <=42 deg slip-lane Y-merges!
    if (dot < 0.72) {
      hasCrossArm = true
      if (rank > maxCrossRank) maxCrossRank = rank
      const estHalf = rank >= 8 ? 11.0 : rank >= 7 ? 8.5 : rank >= 6 ? 6.5 : rank >= 5 ? 5.5 : 4.0
      if (estHalf > maxCrossHalf) maxCrossHalf = estHalf
    }
    if (rank >= 2) nonServiceArms++
  }

  for (let i = 0; i < ins.length; i++) considerArm(-ins[i].ux, -ins[i].uz, ins[i].clsRank)
  for (let i = 0; i < outs.length; i++) considerArm(outs[i].ux, outs[i].uz, outs[i].clsRank)

  if (isSig) return { isControlled: true, isMinorYieldOnly: false, crossHalfEst: maxCrossHalf }
  if (!hasCrossArm) return { isControlled: false, isMinorYieldOnly: false, crossHalfEst: 0 }
  // Tiny service driveway joining a major road: stop the service alley, don't break the main arterial.
  if (maxCrossRank <= 2 && clsRankEdge >= 5) {
    return { isControlled: false, isMinorYieldOnly: false, crossHalfEst: 0 }
  }
  if (clsRankEdge <= 2 && maxCrossRank >= 5) {
    return { isControlled: true, isMinorYieldOnly: true, crossHalfEst: maxCrossHalf }
  }
  const isJunction = nonServiceArms >= 2 && (maxCrossRank >= 5 || clsRankEdge >= 5)
  return { isControlled: isJunction, isMinorYieldOnly: false, crossHalfEst: maxCrossHalf }
}

interface CrossSectionSample {
  s: number
  tL: number
  tR: number
  w: number
  cycleRight: [number, number] | null
  cycleLeft: [number, number] | null
  auxRight: [number, number] | null
  auxLeft: [number, number] | null
  hasMedianLeft: boolean
}

const CLS_MAX_W: Record<string, number> = {
  trunk: 16.5,
  primary: 15.5,
  secondary: 14.5,
  tertiary: 14.0,
  unclassified: 12.0,
  residential: 10.5,
  living_street: 7.5,
  service: 7.5,
}

interface JunctionCore {
  cx: number
  cz: number
  r: number
  group?: number
}

function buildJunctionCores(
  origin: readonly [number, number],
  graph: RoadMarkingGraph,
  nodeMap: Map<number, Pt>,
  allInByNode: Map<number, { from: number; ux: number; uz: number; clsRank: number; oneway: boolean }[]>,
  allOutByNode: Map<number, { to: number; ux: number; uz: number; clsRank: number; oneway: boolean }[]>,
  signalNodes: Set<number>,
  legacyClusters: readonly LegacyCrosswalkCluster[],
): JunctionCore[] {
  const cores: JunctionCore[] = []
  const byGroup = new Map<number, Pt[]>()
  for (let i = 0; i < graph.signals.length; i++) {
    const s = graph.signals[i]
    const pt = nodeMap.get(s.node)
    if (!pt) continue
    const g = s.group ?? s.node
    let arr = byGroup.get(g)
    if (!arr) { arr = []; byGroup.set(g, arr) }
    arr.push(pt)
  }
  for (const [group, pts] of byGroup) {
    let sx = 0, sz = 0
    for (const p of pts) { sx += p[0]; sz += p[1] }
    const cx = sx / pts.length, cz = sz / pts.length
    let maxD = 0
    for (const p of pts) maxD = Math.max(maxD, hypot2(p[0] - cx, p[1] - cz))
    cores.push({ cx, cz, r: maxD > 1 ? maxD + 9.5 : 11.5, group })
  }

  // Non-signal multi-arm or divided crossing-box junctions (e.g. Jiefang W 626322719+2642187999, Lequn 2303787938)
  const candNodes: { nid: number; pt: Pt; maxR: number }[] = []
  for (const [nid, pt] of nodeMap) {
    if (signalNodes.has(nid)) continue
    if (cores.some(c => hypot2(c.cx - pt[0], c.cz - pt[1]) < c.r + 4)) continue
    const ins = allInByNode.get(nid) ?? []
    const outs = allOutByNode.get(nid) ?? []
    const dirs: { ax: number; az: number; rank: number }[] = []
    for (const i of ins) dirs.push({ ax: -i.ux, az: -i.uz, rank: i.clsRank })
    for (const o of outs) dirs.push({ ax: o.ux, az: o.uz, rank: o.clsRank })
    const uniqueDirs: { ax: number; az: number; rank: number }[] = []
    for (const d of dirs) {
      if (!uniqueDirs.some(u => u.ax * d.ax + u.az * d.az > 0.90)) uniqueDirs.push(d)
    }
    const maxR = uniqueDirs.length ? Math.max(...uniqueDirs.map(d => d.rank)) : 0
    // Ignore shallow <=42 deg merge/diverge ramp forks; keep true >=44 deg crossings or legacy-crosswalk intersections
    let hasCross = false
    for (let i = 0; i < uniqueDirs.length; i++) {
      for (let j = i + 1; j < uniqueDirs.length; j++) {
        if (Math.abs(uniqueDirs[i].ax * uniqueDirs[j].ax + uniqueDirs[i].az * uniqueDirs[j].az) < 0.72) {
          hasCross = true
          break
        }
      }
      if (hasCross) break
    }
    const nearLegacyCW = uniqueDirs.length >= 2 && hasCross && legacyClusters.some(cl => hypot2(cl.cx - pt[0], cl.cz - pt[1]) < 24)
    if (maxR >= 5 && hasCross && (uniqueDirs.filter(d => d.rank >= 3).length >= 3 || nearLegacyCW)) {
      candNodes.push({ nid, pt, maxR })
    }
  }

  // Cluster closely paired cross nodes (< 20m apart, e.g. divided carriageway crossings) into unified junction cores
  const usedCand = new Uint8Array(candNodes.length)
  for (let i = 0; i < candNodes.length; i++) {
    if (usedCand[i]) continue
    usedCand[i] = 1
    const q = [candNodes[i]]
    let head = 0
    while (head < q.length) {
      const cur = q[head++]
      for (let j = 0; j < candNodes.length; j++) {
        if (!usedCand[j] && hypot2(candNodes[j].pt[0] - cur.pt[0], candNodes[j].pt[1] - cur.pt[1]) < 20) {
          usedCand[j] = 1
          q.push(candNodes[j])
        }
      }
    }
    let sx = 0, sz = 0, maxR = 5
    for (const c of q) { sx += c.pt[0]; sz += c.pt[1]; maxR = Math.max(maxR, c.maxR) }
    const cx = sx / q.length, cz = sz / q.length
    let maxD = 0
    for (const c of q) maxD = Math.max(maxD, hypot2(c.pt[0] - cx, c.pt[1] - cz))
    const crossHalf = maxR >= 8 ? 9.5 : maxR >= 7 ? 8.0 : 6.0
    cores.push({ cx, cz, r: maxD > 1 ? maxD + crossHalf + 2.5 : crossHalf + 4.5 })
  }
  void origin
  return cores
}

function lineCircleInterval(
  ax: number, az: number, ux: number, uz: number, len: number,
  cx: number, cz: number, r: number,
): [number, number] | null {
  const dx = ax - cx, dz = az - cz
  const b = dx * ux + dz * uz
  const c = dx * dx + dz * dz - r * r
  const disc = b * b - c
  if (disc <= 0) return null
  const sq = Math.sqrt(disc)
  const s0 = Math.max(0, -b - sq), s1 = Math.min(len, -b + sq)
  return s1 - s0 > 0.25 ? [s0, s1] : null
}

function hasRaisedObstacleBetween(
  obstacleGrid: SpatialTriGrid,
  roadGrid: SpatialTriGrid,
  px: number, pz: number,
  rx: number, rz: number,
  t0: number, t1: number,
  candBuf: number[],
): boolean {
  if (!obstacleGrid.count || t1 - t0 < 0.25) return false
  const obsInts = obstacleGrid.scanLineIntervals(px, pz, rx, rz, t0 + 0.1, t1 - 0.1, candBuf)
  for (let i = 0; i < obsInts.length; i++) {
    const [oa, ob] = obsInts[i]
    if (ob - oa < 0.2) continue
    const midT = 0.5 * (oa + ob)
    const mx = px + rx * midT, mz = pz + rz * midT
    const oy = obstacleGrid.maxHeightAt(mx, mz)
    const ry = roadGrid.maxHeightAt(mx, mz)
    if (oy !== null && (ry === null || oy > ry + 0.04)) return true
  }
  return false
}

function sampleEdgeProfile(
  e: GraphEdge,
  allEdges: readonly GraphEdge[],
  roadGrid: SpatialTriGrid,
  cycleGrid: SpatialTriGrid,
  obstacleGrid: SpatialTriGrid,
  decor: readonly number[][],
): CrossSectionSample[] {
  // Restrict sampling window to the segment inside [-8, TILE_SIZE+8] so edges straddling tile seams get dense local samples
  let sMin = 0, sMax = e.len
  const loBound = -8, hiBound = TILE_SIZE + 8
  for (const [p0, dp] of [[e.ax, e.ux], [e.az, e.uz]] as const) {
    if (Math.abs(dp) < 1e-6) {
      if (p0 < loBound || p0 > hiBound) return []
    } else {
      const t1 = (loBound - p0) / dp, t2 = (hiBound - p0) / dp
      sMin = Math.max(sMin, Math.min(t1, t2))
      sMax = Math.min(sMax, Math.max(t1, t2))
    }
  }
  if (sMax - sMin < 0.8) return []
  const nSteps = Math.max(5, Math.min(48, Math.ceil((sMax - sMin) / 3.0)))
  const rawSamples: CrossSectionSample[] = []
  const candBuf: number[] = []
  const maxW = CLS_MAX_W[e.cls] ?? 13.0

  // Pre-collect OPPOSING carriageways running alongside `e` (dot < -0.78) to split merged multi-carriageway k0 polygons
  // without letting same-direction right-turn slip ramps pinch `tR`!
  const parallelOpposing: GraphEdge[] = []
  for (let i = 0; i < allEdges.length; i++) {
    const o = allEdges[i]
    if (o.id === e.id) continue
    if (o.ux * e.ux + o.uz * e.uz > -0.78) continue
    const dMax = Math.min(hypot2(o.ax - e.ax, o.az - e.az), hypot2(o.bx - e.ax, o.bz - e.az))
    if (dMax > Math.max(e.len, o.len) + 35) continue
    parallelOpposing.push(o)
  }

  for (let i = 0; i <= nSteps; i++) {
    const s = sMin + ((sMax - sMin) * i) / nSteps
    const px = e.ax + e.ux * s, pz = e.az + e.uz * s
    const roadInts = roadGrid.scanLineIntervals(px, pz, e.rx, e.rz, -26, 26, candBuf)
    let chosen: [number, number] | null = null
    let bestDist = 3.2
    for (let j = 0; j < roadInts.length; j++) {
      const [a, b] = roadInts[j]
      if (a <= 0.1 && b >= -0.1) { chosen = [a, b]; break }
      const d = Math.min(Math.abs(a), Math.abs(b))
      if (d < bestDist) { bestDist = d; chosen = [a, b] }
    }
    if (!chosen) continue
    let [tL, tR] = chosen
    let hasMedianLeft = false

    // 1) Split merged k0 polygons across central guardrails / roadside barriers (decor 1,2,5,6,7)
    for (let di = 0; di < decor.length; di++) {
      const dk = decor[di][0]
      if (dk !== 1 && dk !== 2 && dk !== 5 && dk !== 6 && dk !== 7) continue
      const dx = decor[di][1] / 10 - px, dz = decor[di][2] / 10 - pz
      const along = dx * e.ux + dz * e.uz
      if (Math.abs(along) > 5.0) continue
      const perp = dx * e.rx + dz * e.rz
      if (perp > tL && perp < -0.45) {
        tL = Math.max(tL, perp + 0.35)
        if (dk === 1 || dk === 2 || dk === 7) hasMedianLeft = true
      } else if (perp < tR && perp > 0.45) {
        tR = Math.min(tR, perp - 0.35)
      }
    }

    // 2) Split merged k0 across opposing carriageways sitting inside the same road polygon
    if (e.forwardOnly) {
      for (let ni = 0; ni < parallelOpposing.length; ni++) {
        const o = parallelOpposing[ni]
        const sProj = ((px - o.ax) * o.ux + (pz - o.az) * o.uz)
        if (sProj < -1 || sProj > o.len + 1) continue
        const ox = o.ax + o.ux * sProj, oz = o.az + o.uz * sProj
        const tO = (ox - px) * e.rx + (oz - pz) * e.rz
        if (tO < -1.8 && tO > tL - 1.5) {
          tL = Math.max(tL, 0.5 * tO + 0.30)
          hasMedianLeft = true
        }
      }
      // Prevent one-way intersection flares / plaza bends from dragging tL far into opposite roadway
      if (tR > 1.5 && tL < -(tR + 1.4)) tL = -tR
    }
    // 3) Pull curb edges inward past raised sidewalks / corner slip islands / planter beds intersecting [tL, tR]
    if (obstacleGrid.count) {
      const obsInts = obstacleGrid.scanLineIntervals(px, pz, e.rx, e.rz, tL, tR, candBuf)
      for (let oi = 0; oi < obsInts.length; oi++) {
        const [oa, ob] = obsInts[oi]
        const midT = 0.5 * (oa + ob)
        const mx = px + e.rx * midT, mz = pz + e.rz * midT
        const oy = obstacleGrid.maxHeightAt(mx, mz)
        const ry = roadGrid.maxHeightAt(mx, mz)
        if (oy === null || (ry !== null && oy <= ry + 0.04)) continue
        if (oa <= tL + 0.45 && ob < -0.3) tL = Math.max(tL, ob + 0.15)
        else if (ob >= tR - 0.45 && oa > 0.3) tR = Math.min(tR, oa - 0.15)
      }
    }
    if (tR - tL < 2.2) continue

    const cycInts = cycleGrid.scanLineIntervals(px, pz, e.rx, e.rz, tL - 8, tR + 12, candBuf)
    let cycleRight: [number, number] | null = null
    let cycleLeft: [number, number] | null = null
    for (let j = 0; j < cycInts.length; j++) {
      const [ca, cb] = cycInts[j]
      if (ca >= tR - 0.3 && cb - ca >= 1.4 && (!cycleRight || ca < cycleRight[0])) cycleRight = [ca, cb]
      if (cb <= tL + 0.3 && cb - ca >= 1.4 && (!cycleLeft || cb > cycleLeft[1])) cycleLeft = [ca, cb]
    }
    const hasMappedEdgeInSpan = (ra: number, rb: number): boolean => {
      const spanMidT = 0.5 * (ra + rb)
      const cxS = px + e.rx * spanMidT, czS = pz + e.rz * spanMidT
      for (let ei = 0; ei < allEdges.length; ei++) {
        const oe = allEdges[ei]
        if (oe.id === e.id) continue
        if (Math.abs(oe.ux * e.ux + oe.uz * e.uz) < 0.78) continue
        const sProj = (cxS - oe.ax) * oe.ux + (czS - oe.az) * oe.uz
        if (sProj < -1.5 || sProj > oe.len + 1.5) continue
        const qx = oe.ax + oe.ux * sProj, qz = oe.az + oe.uz * sProj
        const tProj = (qx - px) * e.rx + (qz - pz) * e.rz
        if (tProj >= ra - 1.2 && tProj <= rb + 1.2) return true
      }
      return false
    }
    let auxRight: [number, number] | null = null
    let auxLeft: [number, number] | null = null
    for (let j = 0; j < roadInts.length; j++) {
      const [ra, rb] = roadInts[j]
      if (ra > tR + 0.4 && ra <= tR + 6.5 && rb - ra >= 2.0 && rb - ra <= 6.2 && !auxRight && !hasMappedEdgeInSpan(ra, rb)) auxRight = [ra, rb]
      if (rb < tL - 0.4 && rb >= tL - 6.5 && rb - ra >= 2.0 && rb - ra <= 6.2 && !auxLeft && !hasMappedEdgeInSpan(ra, rb)) auxLeft = [ra, rb]
    }
    if (e.forwardOnly && !hasMedianLeft) {
      if (hasMedianDecorNear(decor, px, pz, e.rx, e.rz, tL - 3.6, tL + 0.4, 14)) {
        hasMedianLeft = true
      } else {
        for (let j = 0; j < roadInts.length; j++) {
          const [ra, rb] = roadInts[j]
          if (rb < tL - 0.15 && tL - rb <= 5.5 && rb - ra >= 4.0) { hasMedianLeft = true; break }
        }
      }
    }
    rawSamples.push({ s, tL, tR, w: tR - tL, cycleRight, cycleLeft, auxRight, auxLeft, hasMedianLeft })
  }

  // Filter out stations flared across intersections and lock nominal [nomTL, nomTR] so lines never bend diagonally
  let valid = rawSamples.filter(st => st.w <= maxW)
  if (valid.length < 2 && parallelOpposing.length && e.clsRank >= 6) valid = rawSamples.filter(st => st.w <= maxW + 3.5)
  if (valid.length < 2 && e.clsRank >= 6) valid = rawSamples.filter(st => st.w <= maxW + 3.5)
  if (valid.length < 2) return []
  const widths = valid.map(st => st.w).sort((a, b) => a - b)
  const q25W = widths[Math.floor(widths.length * 0.25)]
  // If service/living_street hits an intersecting wide arterial, skip it cleanly
  if (e.clsRank <= 2 && q25W > 7.5) return []

  const clean = valid.filter(st => st.w <= q25W + 1.8)
  const baseSet = clean.length ? clean : valid
  const tLs = baseSet.map(st => st.tL).sort((a, b) => a - b)
  const tRs = baseSet.map(st => st.tR).sort((a, b) => a - b)
  let nomTL = tLs[tLs.length >> 1]
  let nomTR = tRs[tRs.length >> 1]
  // Clamp short <12m one-way intersection connector flares or Jiefang bridgehead tapers to realistic carriageway bounds
  if (e.forwardOnly && ((e.len < 12.0 && nomTR - nomTL > 9.4) || (parallelOpposing.length && nomTR - nomTL > 12.0))) {
    nomTL = Math.max(nomTL, -4.75)
    nomTR = Math.min(nomTR, 4.75)
  }
  const nomW = nomTR - nomTL

  // Clamp outward intersection-mouth flares (>0.22m beyond nominal) while never pushing a curb edge outward past the real raw k0 edge
  for (let i = 0; i < rawSamples.length; i++) {
    const st = rawSamples[i]
    if (st.tL < nomTL - 0.22 || st.tL > nomTL + 0.65) st.tL = nomTL
    if (st.tR > nomTR + 0.22 || st.tR < nomTR - 0.65) st.tR = nomTR
    st.w = Math.max(2.0, st.tR - st.tL)
  }
  return rawSamples
}

function medianWidth(samples: readonly CrossSectionSample[]): number {
  if (!samples.length) return 0
  const arr = samples.map(s => s.w).sort((a, b) => a - b)
  return arr[arr.length >> 1]
}

function buildGoreMarkings(
  origin: readonly [number, number],
  edges: readonly GraphEdge[],
  allOutByNode: Map<number, { to: number; ux: number; uz: number; clsRank: number; oneway: boolean }[]>,
  allInByNode: Map<number, { from: number; ux: number; uz: number; clsRank: number; oneway: boolean }[]>,
  nodeMap: Map<number, Pt>,
  roadGrid: SpatialTriGrid,
  emitter: MarkingEmitter,
): { cx: number; cz: number; r: number }[] {
  const goreZones: { cx: number; cz: number; r: number }[] = []
  const checkedNodes = new Set<number>()
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    if (!e.forwardOnly || e.clsRank < 6) continue
    for (const nid of [e.u, e.v]) {
      if (checkedNodes.has(nid)) continue
      checkedNodes.add(nid)
      const pt = nodeMap.get(nid)
      if (!pt || pt[0] < -10 || pt[0] > TILE_SIZE + 10 || pt[1] < -10 || pt[1] > TILE_SIZE + 10) continue
      if (isBridgeExcluded(origin[0] + pt[0], origin[1] + pt[1])) continue

      const checkPair = (arms: { from?: number; to?: number; ux: number; uz: number; clsRank: number; oneway: boolean }[], signAway: number) => {
        if (arms.length !== 2 || !arms[0].oneway || !arms[1].oneway) return
        // Require real >=6m arms at the split/merge node (skip short 2m intersection stubs)
        for (const arm of arms) {
          const otherId = signAway > 0 ? arm.to : arm.from
          const op = otherId !== undefined ? nodeMap.get(otherId) : undefined
          if (!op || hypot2(op[0] - pt[0], op[1] - pt[1]) < 6.0) return
        }
        const a0 = { ux: arms[0].ux * signAway, uz: arms[0].uz * signAway }
        const a1 = { ux: arms[1].ux * signAway, uz: arms[1].uz * signAway }
        const dot = a0.ux * a1.ux + a0.uz * a1.uz
        if (dot < 0.55 || dot > 0.985) return // 10..56 deg diverge/merge nose
        const bux = (a0.ux + a1.ux) * 0.5, buz = (a0.uz + a1.uz) * 0.5
        const bl = Math.hypot(bux, buz)
        if (bl < 1e-4) return
        const ux = bux / bl, uz = buz / bl, rx = -uz, rz = ux
        const halfSpreadTan = Math.sqrt(Math.max(0.01, (1 - dot) / (1 + dot)))
        const goreLen = clamp(3.0 / halfSpreadTan, 7.0, 14.0)
        // Verify wedge apex has continuous road triangles inside and does not cross non-incident active carriageways
        if (!roadGrid.containsPoint(pt[0] + ux * 5, pt[1] + uz * 5)) return
        for (let d = 3.5; d <= goreLen; d += 3.0) {
          const gx = pt[0] + ux * d, gz = pt[1] + uz * d
          for (let ei = 0; ei < edges.length; ei++) {
            const oe = edges[ei]
            if (oe.u === nid || oe.v === nid || oe.clsRank < 3) continue
            const sProj = clamp((gx - oe.ax) * oe.ux + (gz - oe.az) * oe.uz, 0, oe.len)
            if (hypot2(gx - (oe.ax + oe.ux * sProj), gz - (oe.az + oe.uz * sProj)) < 2.4) return
          }
        }
        // Outer white V-lines
        const tipX = pt[0] + ux * 1.6, tipZ = pt[1] + uz * 1.6
        goreZones.push({ cx: tipX + ux * (goreLen * 0.52), cz: tipZ + uz * (goreLen * 0.52), r: goreLen * 0.62 + 1.5 })
        const endSpread = goreLen * halfSpreadTan
        const lEndX = tipX + ux * goreLen - rx * endSpread, lEndZ = tipZ + uz * goreLen - rz * endSpread
        const rEndX = tipX + ux * goreLen + rx * endSpread, rEndZ = tipZ + uz * goreLen + rz * endSpread
        const lDx = lEndX - tipX, lDz = lEndZ - tipZ, lL = Math.hypot(lDx, lDz) || 1
        const rDx = rEndX - tipX, rDz = rEndZ - tipZ, rL = Math.hypot(rDx, rDz) || 1
        emitter.drapeStrip(tipX, tipZ, lEndX, lEndZ, -lDz / lL, lDx / lL, 0.10, 'road', PAINT_WHITE)
        emitter.drapeStrip(tipX, tipZ, rEndX, rEndZ, -rDz / rL, rDx / rL, 0.10, 'road', PAINT_WHITE)
        // Base closing bar
        const bDx = rEndX - lEndX, bDz = rEndZ - lEndZ, bL = Math.hypot(bDx, bDz) || 1
        emitter.drapeStrip(lEndX, lEndZ, rEndX, rEndZ, -bDz / bL, bDx / bL, 0.10, 'road', PAINT_WHITE)
        // V-chevrons inside wedge
        for (let d = 3.2; d < goreLen - 0.8; d += 1.6) {
          const sp = d * halfSpreadTan * 0.86
          if (sp < 0.25) continue
          const ax = tipX + ux * (d - 0.6), az = tipZ + uz * (d - 0.6)
          const lx = tipX + ux * (d + 0.5) - rx * sp, lz = tipZ + uz * (d + 0.5) - rz * sp
          const rrx = tipX + ux * (d + 0.5) + rx * sp, rrz = tipZ + uz * (d + 0.5) + rz * sp
          const clDx = lx - ax, clDz = lz - az, clL = Math.hypot(clDx, clDz) || 1
          const crDx = rrx - ax, crDz = rrz - az, crL = Math.hypot(crDx, crDz) || 1
          emitter.drapeStrip(ax, az, lx, lz, -clDz / clL, clDx / clL, 0.16, 'road', PAINT_WHITE)
          emitter.drapeStrip(ax, az, rrx, rrz, -crDz / crL, crDx / crL, 0.16, 'road', PAINT_WHITE)
        }
      }
      checkPair(allOutByNode.get(nid) ?? [], 1)
      checkPair(allInByNode.get(nid) ?? [], -1)
    }
  }
  return goreZones
}

function buildFallbackMarkings(
  origin: readonly [number, number],
  legacyKind2: RoadMarkingBuildInput['legacyKind2'],
  decor: readonly number[][],
  roadGrid: SpatialTriGrid,
  emitter: MarkingEmitter,
  shouldSuppressCrosswalk?: (ring: readonly Pt[]) => boolean,
): boolean {
  const clusters = extractLegacyCrosswalks(legacyKind2, origin, shouldSuppressCrosswalk)
  for (let i = 0; i < clusters.length; i++) {
    for (let j = 0; j < clusters[i].bars.length; j++) {
      emitter.drapePolygon(clusters[i].bars[j].ring, 'both', PAINT_WHITE)
    }
  }
  const candBuf: number[] = []
  const decor10 = collectDecor10Boxes(decor, origin)
  for (let i = 0; i < decor10.length; i++) {
    const b = decor10[i]
    const rawPts = decor.filter(d => d[0] === 10 && hypot2(d[1] / 10 - b.cx, d[2] / 10 - b.cz) < b.halfL)
    if (rawPts.length >= 2) {
      let maxD = 0, ax = b.cx, az = b.cz, bx = b.cx + 1, bz = b.cz
      for (const p of rawPts) for (const q of rawPts) {
        const d = hypot2((p[1] - q[1]) / 10, (p[2] - q[2]) / 10)
        if (d > maxD) { maxD = d; ax = p[1] / 10; az = p[2] / 10; bx = q[1] / 10; bz = q[2] / 10 }
      }
      const l = hypot2(bx - ax, bz - az) || 1
      const ux = (bx - ax) / l, uz = (bz - az) / l, rx = -uz, rz = ux
      const ints = roadGrid.scanLineIntervals(b.cx, b.cz, rx, rz, -16, 16, candBuf)
      if (ints.length) {
        const span = ints.find(([t0, t1]) => t0 <= 0.5 && t1 >= -0.5) ?? ints[0]
        emitYellowMeshBox(emitter, b.cx, b.cz, ux, uz, rx, rz, -b.halfL, b.halfL, span[0] + 0.25, span[1] - 0.25)
      }
    }
  }
  for (let i = 0; i < legacyKind2.length; i++) {
    const entry = legacyKind2[i]
    if (!entry[1] || entry[1].length < 4) continue
    const ring: Pt[] = entry[1].map(([xCm, zCm]) => [xCm / 100, zCm / 100] as const)
    if (shouldSuppressCrosswalk && shouldSuppressCrosswalk(ring)) continue
    const obb = minDistToRectPoints(ring)
    if (!obb) continue
    if (isBridgeExcluded(origin[0] + obb.cx, origin[1] + obb.cz)) continue
    if (obb.minW >= 0.36 && obb.minW <= 0.85 && obb.maxL >= 2.2 && obb.maxL <= 5.5) continue
    // Split thin longitudinal stripes into dashed lines when long
    if (obb.minW <= 0.28 && obb.maxL >= 8.0 && obb.fill > 0.72) {
      const rx = -obb.uz, rz = obb.ux
      const isNearMedian = hasMedianDecorNear(decor, obb.cx, obb.cz, rx, rz, -5, 5, 12)
      if (isNearMedian) {
        for (let s = -obb.maxL * 0.5; s < obb.maxL * 0.5; s += 6.0) {
          const s1 = Math.min(obb.maxL * 0.5, s + 2.0)
          if (s1 - s > 0.4) {
            emitter.drapeStrip(
              obb.cx + obb.ux * s, obb.cz + obb.uz * s,
              obb.cx + obb.ux * s1, obb.cz + obb.uz * s1,
              rx, rz, 0.075, 'road', PAINT_WHITE,
            )
          }
        }
        continue
      }
    }
    emitter.drapePolygon(ring, 'road', PAINT_WHITE)
  }
  return decor10.length > 0
}

export function buildRoadMarkings(input: RoadMarkingBuildInput): RoadMarkingBuildResult {
  const {
    origin, xyz, rgb, surfaceKinds, alongVals,
    roadTriOffsets, cycleTriOffsets, obstacleTriOffsets = [], legacyKind2, decor, roadGraph,
    shouldSuppressCrosswalk, schoolZones = DEFAULT_SCHOOL_ZONES,
  } = input

  const roadGrid = new SpatialTriGrid(xyz, roadTriOffsets)
  const cycleGrid = new SpatialTriGrid(xyz, cycleTriOffsets)
  const obstacleGrid = new SpatialTriGrid(xyz, obstacleTriOffsets)
  if (!roadGrid.count && !cycleGrid.count) {
    return { emittedTriangles: 0, replacedDecor10: false }
  }

  const emitter = new MarkingEmitter(roadGrid, cycleGrid, obstacleGrid, xyz, rgb, surfaceKinds, alongVals)
  if (!roadGraph || !roadGraph.lanes.length || !roadGraph.nodes.length) {
    const replaced = buildFallbackMarkings(origin, legacyKind2, decor, roadGrid, emitter, shouldSuppressCrosswalk)
    return { emittedTriangles: emitter.emittedTriangles, replacedDecor10: replaced }
  }

  const { nodeMap, edges, allOutByNode, allInByNode, signalNodes, signalGroupByNode } = buildGraphEdges(origin, roadGraph)
  const legacyClusters = extractLegacyCrosswalks(legacyKind2, origin, shouldSuppressCrosswalk)
  const junctionCores = buildJunctionCores(origin, roadGraph, nodeMap, allInByNode, allOutByNode, signalNodes, legacyClusters)
  const consumedClusters = new Uint8Array(legacyClusters.length)
  const candBuf: number[] = []
  const placedStopZones: { x: number; z: number }[] = []
  const placedCrossZones: { x: number; z: number }[] = []
  const placedSchoolBoxes: { si: number; x: number; z: number; ux: number; uz: number; halfL: number }[] = []
  const hasRawDecor10 = decor.some(d => d[0] === 10)
  const decor10Boxes = collectDecor10Boxes(decor, origin, schoolZones)
  const activeSchoolBoxes: { cx: number; cz: number; halfL: number; anchorX: number; anchorZ: number }[] = []
  for (let i = 0; i < schoolZones.length; i++) {
    const sx = schoolZones[i].x - origin[0], sz = schoolZones[i].z - origin[1]
    if (sx < -25 || sx > TILE_SIZE + 25 || sz < -25 || sz > TILE_SIZE + 25) continue
    activeSchoolBoxes.push({ cx: sx, cz: sz, halfL: 17.5, anchorX: schoolZones[i].x, anchorZ: schoolZones[i].z })
  }
  for (const b of decor10Boxes) {
    if (!activeSchoolBoxes.some(s => hypot2(s.cx - b.cx, s.cz - b.cz) < 25)) {
      activeSchoolBoxes.push({ ...b, anchorX: origin[0] + b.cx, anchorZ: origin[1] + b.cz })
    }
  }

  // Build ramp gores BEFORE edge passes so every gore wedge automatically excludes colliding longitudinal lines
  const goreZones = buildGoreMarkings(origin, edges, allOutByNode, allInByNode, nodeMap, roadGrid, emitter)

  // Emit each school gate yellow cross-hatched mesh zone ONCE across clsRank>=3 arterials (clipped by roadGrid directly, seamless at tile seams & z=0)
  for (let si = 0; si < activeSchoolBoxes.length; si++) {
    const sb = activeSchoolBoxes[si]
    if (placedSchoolBoxes.some(p => hypot2(p.x - sb.cx, p.z - sb.cz) < 35)) continue
    if (junctionCores.some(c => hypot2(sb.cx - c.cx, sb.cz - c.cz) < c.r + 4)) continue
    let sumUx = 0, sumUz = 0
    for (let ei = 0; ei < edges.length; ei++) {
      const e = edges[ei]
      if (e.clsRank < 3) continue
      const along = (sb.cx - e.ax) * e.ux + (sb.cz - e.az) * e.uz
      if (along < -sb.halfL - 20 || along > e.len + sb.halfL + 20) continue
      const perp = Math.abs((sb.cx - e.ax) * e.rx + (sb.cz - e.az) * e.rz)
      if (perp > 22) continue
      const sign = (e.uz > 1e-4 || (Math.abs(e.uz) <= 1e-4 && e.ux >= 0)) ? 1 : -1
      const w = e.clsRank * (1 + Math.max(0, Math.min(e.len, along + sb.halfL) - Math.max(0, along - sb.halfL)))
      sumUx += sign * e.ux * w
      sumUz += sign * e.uz * w
    }
    const uLen = Math.hypot(sumUx, sumUz)
    if (uLen < 1e-5) continue
    const ux = sumUx / uLen, uz = sumUz / uLen
    const rx = -uz, rz = ux
    let bestSpan: [number, number] | null = null
    for (const sOff of [0, -6, 6, -12, 12]) {
      const ints = roadGrid.scanLineIntervals(sb.cx + ux * sOff, sb.cz + uz * sOff, rx, rz, -18, 18, candBuf)
      const hit = ints.find(([a, b]) => a <= 7.5 && b >= -7.5 && b - a >= 4.0)
      if (hit) { bestSpan = hit; break }
    }
    if (!bestSpan) continue
    const coreExcludes: [number, number][] = []
    for (let ci = 0; ci < junctionCores.length; ci++) {
      const c = junctionCores[ci]
      const hit = lineCircleInterval(sb.cx - ux * sb.halfL, sb.cz - uz * sb.halfL, ux, uz, sb.halfL * 2, c.cx, c.cz, c.r + 2.0)
      if (hit) coreExcludes.push([hit[0] - sb.halfL, hit[1] - sb.halfL])
    }
    const cleanSpans = subtractIntervals(-sb.halfL, sb.halfL, coreExcludes)
    if (!cleanSpans.length) continue
    placedSchoolBoxes.push({ si, x: sb.cx, z: sb.cz, ux, uz, halfL: sb.halfL })
    const sbWorldOffset = ((origin[0] + sb.cx - sb.anchorX) * ux + (origin[1] + sb.cz - sb.anchorZ) * uz)
    const t0 = bestSpan[0] + 0.30, t1 = bestSpan[1] - 0.30
    if (t1 - t0 >= 3.0) {
      for (const [s0, s1] of cleanSpans) {
        if (s1 - s0 < 1.2) continue
        emitYellowMeshBox(emitter, sb.cx, sb.cz, ux, uz, rx, rz, s0, s1, t0, t1, sbWorldOffset, s0 <= -sb.halfL + 0.05, s1 >= sb.halfL - 0.05)
      }
    }
  }

  const drawnAuxStrips: { x: number; z: number }[] = []
  const drawnWaitPockets: { x: number; z: number }[] = []

  const coreHasRightArm = (e: GraphEdge, c: JunctionCore, sProjMid: number): boolean => {
    const pxProj = e.ax + e.ux * sProjMid, pzProj = e.az + e.uz * sProjMid
    return edges.some(oe => {
      if (oe.id === e.id || oe.clsRank <= 1) return false
      if (Math.abs(oe.ux * e.ux + oe.uz * e.uz) > 0.85) return false
      const dU = hypot2(oe.ax - c.cx, oe.az - c.cz) <= c.r + 5.0
      const dV = hypot2(oe.bx - c.cx, oe.bz - c.cz) <= c.r + 5.0
      if (!dU && !dV) return false
      const farX = dU ? oe.bx : oe.ax, farZ = dU ? oe.bz : oe.az
      const midOx = 0.5 * (oe.ax + oe.bx), midOz = 0.5 * (oe.az + oe.bz)
      return ((farX - pxProj) * e.rx + (farZ - pzProj) * e.rz) > 3.5 ||
        ((midOx - pxProj) * e.rx + (midOz - pzProj) * e.rz) > 3.5
    })
  }

  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei]
    const midX = (e.ax + e.bx) * 0.5, midZ = (e.az + e.bz) * 0.5
    const midWX = origin[0] + midX
    const midWZ = origin[1] + midZ
    if (isBridgeExcluded(midWX, midWZ)) continue

    // Skip internal links inside multi-node intersections, junction-core chords, or corner slip loops;
    // on divided continuous T-tops where no arm exits to +rx, preserve only the continuous outer right curb line.
    const uGrp = signalGroupByNode.get(e.u), vGrp = signalGroupByNode.get(e.v)
    if (uGrp !== undefined && vGrp === uGrp) continue
    const inCore = junctionCores.find(c =>
      hypot2(e.ax - c.cx, e.az - c.cz) <= c.r + 1.5 && hypot2(e.bx - c.cx, e.bz - c.cz) <= c.r + 1.5
    )
    if (inCore) {
      if (e.forwardOnly && e.clsRank >= 4 && !coreHasRightArm(e, inCore, e.len * 0.5)) {
        const coreProf = sampleEdgeProfile(e, edges, roadGrid, cycleGrid, obstacleGrid, decor)
        if (coreProf.length >= 2) {
          const wNom = medianWidth(coreProf)
          const rInset = wNom >= 3.6 ? 0.60 : 0.30
          const skipsC: [number, number][] = []
          for (const cl of legacyClusters) {
            const al = (cl.cx - e.ax) * e.ux + (cl.cz - e.az) * e.uz
            if (al >= -2.5 && al <= e.len + 2.5 && Math.abs((cl.cx - e.ax) * e.rx + (cl.cz - e.az) * e.rz) < wNom) skipsC.push([al - 2.2, al + 2.2])
          }
          for (const cw of placedCrossZones) {
            const al = (cw.x - e.ax) * e.ux + (cw.z - e.az) * e.uz
            if (al >= -2.5 && al <= e.len + 2.5 && Math.abs((cw.x - e.ax) * e.rx + (cw.z - e.az) * e.rz) < wNom) skipsC.push([al - 2.2, al + 2.2])
          }
          for (const [a0, b0] of subtractIntervals(0, e.len, skipsC)) {
            if (b0 - a0 < 0.8) continue
            const pA = [e.ax + e.ux * a0, e.az + e.uz * a0], pB = [e.ax + e.ux * b0, e.az + e.uz * b0]
            const tA = coreProf[0].tR - rInset, tB = coreProf[coreProf.length - 1].tR - rInset
            emitter.drapeStrip(pA[0] + e.rx * tA, pA[1] + e.rz * tA, pB[0] + e.rx * tB, pB[1] + e.rz * tB, e.rx, e.rz, 0.075, 'road', PAINT_WHITE)
          }
        }
      }
      continue
    }
    if (e.isTwoWay && e.len < 24 && e.clsRank >= 6 && (
      junctionCores.some(c => c.group !== undefined && hypot2(midX - c.cx, midZ - c.cz) < 68) ||
      hypot2(midWX - SHIZIJIE_CENTER[0], midWZ - SHIZIJIE_CENTER[1]) < 72
    )) continue
    // Skip tiny corner service slip chords next to intersections (prevents stray corner dashes at Qixing etc.)
    if (e.clsRank <= 1 && e.len < 22 && junctionCores.some(c => hypot2(midX - c.cx, midZ - c.cz) < c.r + 50)) continue

    const profile = sampleEdgeProfile(e, edges, roadGrid, cycleGrid, obstacleGrid, decor)
    if (profile.length < 2) continue
    const nomW = medianWidth(profile)
    if (nomW < 3.4) continue

    let endCtrl = nodeCrossingInfo(e.v, e.ux, e.uz, e.clsRank, nodeMap, allInByNode, allOutByNode, signalNodes)
    let startCtrl = e.isTwoWay
      ? nodeCrossingInfo(e.u, -e.ux, -e.uz, e.clsRank, nodeMap, allInByNode, allOutByNode, signalNodes)
      : { isControlled: false, isMinorYieldOnly: false, crossHalfEst: 0 }

    // 1-hop JunctionCore lookahead for short terminal stubs stopping just outside a controlled core
    const checkOneHopCore = (nid: number, uxDir: number, uzDir: number, atEnd: boolean) => {
      const outs = atEnd ? (allOutByNode.get(nid) ?? []) : (allInByNode.get(nid) ?? [])
      for (const arm of outs) {
        const nextId = atEnd ? (arm as { to: number }).to : (arm as { from: number }).from
        const armUx = atEnd ? arm.ux : -arm.ux, armUz = atEnd ? arm.uz : -arm.uz
        if (armUx * uxDir + armUz * uzDir < 0.78) continue
        const pCur = nodeMap.get(nid), pNxt = nodeMap.get(nextId)
        if (!pCur || !pNxt || hypot2(pNxt[0] - pCur[0], pNxt[1] - pCur[1]) > 20.0) continue
        const core = junctionCores.find(c => hypot2(pNxt[0] - c.cx, pNxt[1] - c.cz) <= c.r - 0.5)
        if (core) return { core, pCur }
      }
      return null
    }
    const endHop = !endCtrl.isControlled && e.clsRank >= 3 ? checkOneHopCore(e.v, e.ux, e.uz, true) : null
    if (endHop) endCtrl = { isControlled: true, isMinorYieldOnly: false, crossHalfEst: Math.max(5.5, endHop.core.r * 0.45) }
    const startHop = e.isTwoWay && !startCtrl.isControlled && e.clsRank >= 3 ? checkOneHopCore(e.u, -e.ux, -e.uz, false) : null
    if (startHop) startCtrl = { isControlled: true, isMinorYieldOnly: false, crossHalfEst: Math.max(5.5, startHop.core.r * 0.45) }

    const skipZones: [number, number][] = []
    const curbOuterSkipZones: [number, number][] = []
    for (let ci = 0; ci < junctionCores.length; ci++) {
      const c = junctionCores[ci]
      // For outgoing legs from multi-node signal cores, add crosswalk clearance so lines never stab through exit crosswalks
      const uNearOut = !startCtrl.isControlled && hypot2(e.ax - c.cx, e.az - c.cz) < c.r + 12.0
      const vNearOut = !endCtrl.isControlled && !e.isTwoWay && hypot2(e.bx - c.cx, e.bz - c.cz) < c.r + 12.0
      const rUse = (c.group !== undefined && (uNearOut || vNearOut)) ? c.r + 9.5 : c.r
      const hit = lineCircleInterval(e.ax, e.az, e.ux, e.uz, e.len, c.cx, c.cz, rUse)
      if (hit) {
        skipZones.push(hit)
        if (coreHasRightArm(e, c, 0.5 * (hit[0] + hit[1]))) curbOuterSkipZones.push(hit)
      }
    }
    for (let gi = 0; gi < goreZones.length; gi++) {
      const hit = lineCircleInterval(e.ax, e.az, e.ux, e.uz, e.len, goreZones[gi].cx, goreZones[gi].cz, goreZones[gi].r)
      if (hit) {
        skipZones.push(hit)
        curbOuterSkipZones.push(hit)
      }
    }
    // Symmetric clip at Jiefang Bridge West portal so East & West carriageways stop together cleanly off the bridge deck
    if (midWZ >= JIEFANG_BRIDGE_BOX.minZ - 15 && midWZ <= JIEFANG_BRIDGE_BOX.maxZ &&
      Math.max(origin[0] + e.ax, origin[0] + e.bx) > JIEFANG_PORTAL_X && Math.min(origin[0] + e.ax, origin[0] + e.bx) < -360 &&
      Math.abs(e.ux) > 0.1) {
      const sPortal = (JIEFANG_PORTAL_X - (origin[0] + e.ax)) / e.ux
      const pSpan: [number, number] = e.ux > 0 ? [Math.max(0, sPortal), e.len] : [0, Math.min(e.len, sPortal)]
      skipZones.push(pSpan)
      curbOuterSkipZones.push(pSpan)
    }

    // Determine exact setback distance outside junction cores for crosswalk & stop line
    const computeEndSetback = (ctrl: ReturnType<typeof nodeCrossingInfo>, atEnd: boolean, hop: { core: JunctionCore; pCur: Pt } | null): { crossDist: number; stopDist: number; trim: number } => {
      if (!ctrl.isControlled) return { crossDist: 0, stopDist: 0, trim: 0 }
      let dOpen = (hop && hop.core.group === undefined) ? 0 : ctrl.crossHalfEst * 0.72
      const nid = atEnd ? e.v : e.u
      const npt = nodeMap.get(nid)
      const hitCore = hop ? hop.core : (npt ? junctionCores.find(c => hypot2(npt[0] - c.cx, npt[1] - c.cz) <= c.r) : undefined)
      if (hitCore) {
        const hit = lineCircleInterval(e.ax, e.az, e.ux, e.uz, e.len, hitCore.cx, hitCore.cz, hitCore.r)
        if (hit) dOpen = Math.max(dOpen, atEnd ? (e.len - hit[0]) : hit[1])
        else if (hop && npt) {
          const dCoreToNode = Math.max(0, hitCore.r - hypot2(npt[0] - hitCore.cx, npt[1] - hitCore.cz))
          const pad = hop.core.group === undefined ? 0.5 : 2.0
          dOpen = dCoreToNode > 0.5 ? Math.min(2.5, dCoreToNode + pad) : 0
        }
      }
      if (ctrl.isMinorYieldOnly) {
        const stopDist = clamp(dOpen + 1.2, 4.0, e.len * 0.4)
        return { crossDist: 0, stopDist, trim: stopDist }
      }
      const cwDepth = e.clsRank >= 7 ? 3.8 : 3.4
      const crossDist = clamp(dOpen + cwDepth * 0.5 + 0.5, hop ? 3.0 : 4.5, 22.0)
      const stopDist = crossDist + cwDepth * 0.5 + 2.3
      return { crossDist, stopDist, trim: stopDist }
    }

    const endSB = computeEndSetback(endCtrl, true, endHop)
    const startSB = computeEndSetback(startCtrl, false, startHop)
    if (startSB.trim + endSB.trim >= e.len - 0.5 && !endCtrl.isControlled && !startCtrl.isControlled) continue

    const midP = (s: number): Pt => [e.ax + e.ux * s, e.az + e.uz * s]
    const interpAt = (s: number): CrossSectionSample => {
      if (s <= profile[0].s) return profile[0]
      if (s >= profile[profile.length - 1].s) return profile[profile.length - 1]
      for (let i = 1; i < profile.length; i++) {
        if (profile[i].s >= s) {
          const a = profile[i - 1], b = profile[i]
          const f = (s - a.s) / Math.max(1e-5, b.s - a.s)
          return {
            s,
            tL: a.tL + (b.tL - a.tL) * f,
            tR: a.tR + (b.tR - a.tR) * f,
            w: a.w + (b.w - a.w) * f,
            cycleRight: a.cycleRight ?? b.cycleRight,
            cycleLeft: a.cycleLeft ?? b.cycleLeft,
            auxRight: a.auxRight ?? b.auxRight,
            auxLeft: a.auxLeft ?? b.auxLeft,
            hasMedianLeft: a.hasMedianLeft || b.hasMedianLeft,
          }
        }
      }
      return profile[profile.length - 1]
    }

    // 1. Place Crosswalk & Stop Line at End (u -> v approach)
    const placeApproachControl = (atEnd: boolean, ctrl: ReturnType<typeof nodeCrossingInfo>, sb: ReturnType<typeof computeEndSetback>) => {
      if (!ctrl.isControlled) return
      let sCross = atEnd ? e.len - sb.crossDist : sb.crossDist
      const dirSign = atEnd ? 1 : -1 // direction traveling TOWARD controlled intersection
      const ux = e.ux * dirSign, uz = e.uz * dirSign
      const rx = -uz, rz = ux
      const cwDepth = e.clsRank >= 7 ? 3.8 : 3.4

      // Consume legacy crosswalk clusters near this approach/core so no stale overlapping second crosswalk is ever emitted.
      let preserveLegacyCluster: LegacyCrosswalkCluster | null = null
      const nidCtrl = atEnd ? e.v : e.u
      const ctrlPt = nodeMap.get(nidCtrl)
      const hitCoreCtrl = ctrlPt ? junctionCores.find(c => hypot2(ctrlPt[0] - c.cx, ctrlPt[1] - c.cz) <= c.r + 3) : undefined
      const distLo = e.forwardOnly && e.clsRank >= 5 ? -5.0 : 2.0
      const maxPerp = e.forwardOnly && e.clsRank >= 5 ? Math.max(nomW * 1.45, 9.0) : nomW * 0.95
      for (let ci = 0; ci < legacyClusters.length; ci++) {
        const cl = legacyClusters[ci]
        const alongCl = (cl.cx - e.ax) * e.ux + (cl.cz - e.az) * e.uz
        const perpCl = Math.abs((cl.cx - e.ax) * e.rx + (cl.cz - e.az) * e.rz)
        const distFromNode = atEnd ? e.len - alongCl : alongCl
        if (perpCl < maxPerp && distFromNode >= distLo && distFromNode <= 26.0) {
          const avgW = cl.bars.reduce((s, b) => s + b.obb.minW, 0) / cl.bars.length
          if (avgW >= 0.60) {
            preserveLegacyCluster = cl
            sCross = clamp(alongCl, 1.2, e.len - 1.2)
          }
          consumedClusters[ci] = 1
        } else if (hitCoreCtrl && hypot2(cl.cx - hitCoreCtrl.cx, cl.cz - hitCoreCtrl.cz) < hitCoreCtrl.r + 18.0 && perpCl < nomW * 1.4 && distFromNode >= -4.0 && distFromNode <= 28.0) {
          consumedClusters[ci] = 1
        }
      }

      const sStop = !ctrl.isMinorYieldOnly && sb.crossDist > 0
        ? (atEnd ? sCross - (cwDepth * 0.5 + 2.3) : sCross + (cwDepth * 0.5 + 2.3))
        : (atEnd ? e.len - sb.stopDist : sb.stopDist)

      // Emit or preserve crosswalk (avoiding duplicate placement across tightly split node pairs)
      if (!ctrl.isMinorYieldOnly && sb.crossDist > 0 && sCross > 1 && sCross < e.len - 1) {
        const cwPt = midP(sCross)
        const nearExistingCW = placedCrossZones.some(z => hypot2(z.x - cwPt[0], z.z - cwPt[1]) < 13.5)
        if (preserveLegacyCluster && !nearExistingCW) {
          placedCrossZones.push({ x: cwPt[0], z: cwPt[1] })
          for (const b of preserveLegacyCluster.bars) emitter.drapePolygon(b.ring, 'both', PAINT_WHITE)
        } else if (!nearExistingCW) {
          const cwRingSample: Pt[] = [
            [cwPt[0] - e.rx * (nomW * 0.4), cwPt[1] - e.rz * (nomW * 0.4)],
            [cwPt[0] + e.rx * (nomW * 0.4), cwPt[1] + e.rz * (nomW * 0.4)],
            [cwPt[0] + ux * 1.5 + e.rx * (nomW * 0.4), cwPt[1] + uz * 1.5 + e.rz * (nomW * 0.4)],
            [cwPt[0] + ux * 1.5 - e.rx * (nomW * 0.4), cwPt[1] + uz * 1.5 - e.rz * (nomW * 0.4)],
          ]
          const suppressed = shouldSuppressCrosswalk ? shouldSuppressCrosswalk(cwRingSample) : false
          if (!suppressed) {
            placedCrossZones.push({ x: cwPt[0], z: cwPt[1] })
            const samp = interpAt(sCross)
            const bridgeLeftCycle = samp.cycleLeft && samp.cycleLeft[1] >= samp.tL - 1.6 &&
              !hasRaisedObstacleBetween(obstacleGrid, roadGrid, cwPt[0], cwPt[1], e.rx, e.rz, samp.cycleLeft[1], samp.tL, candBuf)
            const bridgeRightCycle = samp.cycleRight && samp.cycleRight[0] <= samp.tR + 1.6 &&
              !hasRaisedObstacleBetween(obstacleGrid, roadGrid, cwPt[0], cwPt[1], e.rx, e.rz, samp.tR, samp.cycleRight[0], candBuf)
            let tSpanL = bridgeLeftCycle && samp.cycleLeft ? samp.cycleLeft[0] + 0.25 : samp.tL + 0.25
            const tSpanR = bridgeRightCycle && samp.cycleRight ? samp.cycleRight[1] - 0.25 : samp.tR - 0.25
            let medSkipT: [number, number] | null = null
            // On divided one-way paired carriageways, extend zebra crossing across adjacent opposing carriageway while jumping central median planters
            if (e.forwardOnly) {
              const rInts = roadGrid.scanLineIntervals(cwPt[0], cwPt[1], e.rx, e.rz, -26, 26, candBuf)
              let adjOpp: [number, number] | null = null
              for (let j = 0; j < rInts.length; j++) {
                const [ra, rb] = rInts[j]
                if (rb < samp.tL + 0.15 && samp.tL - rb <= 5.5 && rb - ra >= 3.2 && (!adjOpp || rb > adjOpp[1])) {
                  adjOpp = [ra, rb]
                }
              }
              if (adjOpp) {
                tSpanL = adjOpp[0] + 0.25
                const hasMedObstacles = hasMedianDecorNear(decor, cwPt[0], cwPt[1], e.rx, e.rz, adjOpp[1] - 0.2, samp.tL + 0.2, 3.0)
                if (hasMedObstacles && samp.tL - adjOpp[1] > 0.35) {
                  medSkipT = [adjOpp[1] - 0.2, samp.tL + 0.2]
                }
              }
            }
            for (let t = tSpanL + 0.35; t <= tSpanR - 0.35; t += 1.05) {
              if (medSkipT && t >= medSkipT[0] && t <= medSkipT[1]) continue
              const bx = cwPt[0] + e.rx * t, bz = cwPt[1] + e.rz * t
              if (obstacleGrid.count) {
                const obsY = obstacleGrid.maxHeightAt(bx, bz)
                const roadY = roadGrid.maxHeightAt(bx, bz) ?? cycleGrid.maxHeightAt(bx, bz)
                if (obsY !== null && (roadY === null || obsY > roadY + 0.04)) continue
              }
              const ax = bx - ux * (cwDepth * 0.5), az = bz - uz * (cwDepth * 0.5)
              const cx2 = bx + ux * (cwDepth * 0.5), cz2 = bz + uz * (cwDepth * 0.5)
              if (shouldSuppressCrosswalk) {
                const barRing: Pt[] = [
                  [ax - e.rx * 0.225, az - e.rz * 0.225],
                  [cx2 - e.rx * 0.225, cz2 - e.rz * 0.225],
                  [cx2 + e.rx * 0.225, cz2 + e.rz * 0.225],
                  [ax + e.rx * 0.225, az + e.rz * 0.225],
                ]
                if (shouldSuppressCrosswalk(barRing)) continue
              }
              emitter.drapeStrip(ax, az, cx2, cz2, e.rx, e.rz, 0.225, 'both', PAINT_WHITE)
            }
          }
        }
        const cwSkip: [number, number] = [sCross - cwDepth * 0.5 - 0.6, sCross + cwDepth * 0.5 + 0.6]
        const stopEndSkip: [number, number] = atEnd
          ? [Math.min(sStop, sCross - cwDepth * 0.5), e.len]
          : [0, Math.max(sStop, sCross + cwDepth * 0.5)]
        skipZones.push(cwSkip, stopEndSkip)
        curbOuterSkipZones.push(cwSkip)
        if (!hitCoreCtrl || coreHasRightArm(e, hitCoreCtrl, sCross)) curbOuterSkipZones.push(stopEndSkip)
      }

      if (sStop > 1.5 && sStop < e.len - 1.5) {
        const samp = interpAt(sStop)
        const sp = midP(sStop)
        if (!placedStopZones.some(z => hypot2(z.x - sp[0], z.z - sp[1]) < 3.5)) {
          placedStopZones.push({ x: sp[0], z: sp[1] })
          const tMid = 0.5 * (samp.tL + samp.tR)
          const tMin = e.isTwoWay ? (atEnd ? tMid + 0.08 : samp.tL + 0.24) : samp.tL + 0.24
          const tMax = e.isTwoWay ? (atEnd ? samp.tR - 0.24 : tMid - 0.08) : samp.tR - 0.24
          if (tMax - tMin >= 2.2) {
            emitter.drapeStrip(
              sp[0] + e.rx * tMin, sp[1] + e.rz * tMin,
              sp[0] + e.rx * tMax, sp[1] + e.rz * tMax,
              ux, uz, 0.17, 'road', PAINT_WHITE,
            )
          }

          // Directional turn arrows upstream of stop line (single crisp set outside junction cores)
          const segClear = atEnd ? sStop - startSB.trim : e.len - endSB.trim - sStop
          const halfWApp = e.isTwoWay ? (atEnd ? samp.tR - tMid : tMid - samp.tL) : samp.w
          const nIn = halfWApp < 4.5 ? 1 : clamp(Math.round(halfWApp / 3.2), 2, 5)
          const finalIn = nIn > 1 && halfWApp / nIn < 2.65 ? nIn - 1 : nIn
          const wAxMid = origin[0] + sp[0], wAzMid = origin[1] + sp[1]
          const isZsCorridor = inBox(wAxMid, wAzMid, ZHONGSHAN_PLANTER_BOX) && finalIn >= 4
          const effectiveIn = isZsCorridor ? finalIn - 1 : finalIn
          if (!ctrl.isMinorYieldOnly && segClear >= 12.0 && (effectiveIn >= 2 || e.clsRank >= 6)) {
            const nid = atEnd ? e.v : e.u
            const turns = inferTurnsAtNode(nid, ux, uz, nodeMap, allOutByNode, signalGroupByNode)
            const arrowList = chooseArrowTypes(effectiveIn, turns)
            const sA = atEnd ? sStop - 7.5 : sStop + 7.5
            if (sA >= 2 && sA <= e.len - 2) {
              const sAInfo = interpAt(sA)
              const tStartL = e.isTwoWay ? (atEnd ? 0.5 * (sAInfo.tL + sAInfo.tR) : sAInfo.tL) : sAInfo.tL
              const wBaseSpan = e.isTwoWay ? (atEnd ? sAInfo.tR - tStartL : 0.5 * (sAInfo.tL + sAInfo.tR) - sAInfo.tL) : sAInfo.w
              const wLaneSpan = isZsCorridor ? wBaseSpan * (effectiveIn / finalIn) : wBaseSpan
              const aPt = midP(sA)
              if (!junctionCores.some(c => hypot2(aPt[0] - c.cx, aPt[1] - c.cz) < c.r + 3)) {
                for (let li = 0; li < effectiveIn; li++) {
                  const arrType = arrowList[li]
                  if (!arrType) continue
                  const tCenter = e.isTwoWay && !atEnd
                    ? (0.5 * (sAInfo.tL + sAInfo.tR)) - wLaneSpan * ((li + 0.5) / effectiveIn)
                    : tStartL + wLaneSpan * ((li + 0.5) / effectiveIn)
                  const acx = aPt[0] + e.rx * tCenter, acz = aPt[1] + e.rz * tCenter
                  if (isBridgeExcluded(origin[0] + acx, origin[1] + acz)) continue
                  emitArrow(emitter, acx, acz, ux, uz, rx, rz, arrType, 'road')
                }
              }
            }
          }
        }
      }
    }

    placeApproachControl(true, endCtrl, endSB)
    if (e.isTwoWay) placeApproachControl(false, startCtrl, startSB)

    // Keep curb-side outer edge lines >= 0.60m inside the kerb so they never cross 0.30m ± 0.17m gully grates
    const curbEdgeInset = nomW >= 3.6 ? 0.60 : 0.25
    const rightEdgeInset = curbEdgeInset
    const leftEdgeInset = curbEdgeInset

    // Mid-block legacy crosswalks only (strictly outside any junction core / approach control zone); preserve ungraphed leg clusters
    for (let ci = 0; ci < legacyClusters.length; ci++) {
      const cl = legacyClusters[ci]
      const nearAnyCore = junctionCores.some(c => hypot2(cl.cx - c.cx, cl.cz - c.cz) < c.r + 22.0)
      if (nearAnyCore) continue
      const along = (cl.cx - e.ax) * e.ux + (cl.cz - e.az) * e.uz
      const perp = Math.abs((cl.cx - e.ax) * e.rx + (cl.cz - e.az) * e.rz)
      if (along >= 0 && along <= e.len && perp <= 15.0) {
        skipZones.push([along - 2.6, along + 2.6])
        curbOuterSkipZones.push([along - 2.6, along + 2.6])
        if (perp <= nomW * 0.78 && !consumedClusters[ci]) {
          consumedClusters[ci] = 1
          if (!placedCrossZones.some(z => hypot2(z.x - cl.cx, z.z - cl.cz) < 12.0) && !placedStopZones.some(z => hypot2(z.x - cl.cx, z.z - cl.cz) < 22.0)) {
            placedCrossZones.push({ x: cl.cx, z: cl.cz })
            for (const b of cl.bars) emitter.drapePolygon(b.ring, 'both', PAINT_WHITE)
            // Ensure a stop bar sits cleanly upstream on true mid-block crosswalks
            if (along > 6 && along < e.len - 6) {
              const sStopMid = along - 3.8
              const mp = midP(sStopMid)
              if (!placedStopZones.some(z => hypot2(z.x - mp[0], z.z - mp[1]) < 4.5)) {
                placedStopZones.push({ x: mp[0], z: mp[1] })
                const sp = interpAt(sStopMid)
                const tA = e.isTwoWay ? 0.5 * (sp.tL + sp.tR) + 0.08 : sp.tL + leftEdgeInset
                const tB = sp.tR - rightEdgeInset
                if (tB - tA >= 2.2) {
                  emitter.drapeStrip(mp[0] + e.rx * tA, mp[1] + e.rz * tA, mp[0] + e.rx * tB, mp[1] + e.rz * tB, e.ux, e.uz, 0.17, 'road', PAINT_WHITE)
                }
              }
            }
          }
        }
      }
    }

    // 2. Break longitudinal lines on clsRank>=3 roads cleanly around placed school yellow mesh boxes
    const worldPhaseBase = (origin[0] + e.ax) * e.ux + (origin[1] + e.az) * e.uz
    if (e.clsRank >= 3) {
      for (let pi = 0; pi < placedSchoolBoxes.length; pi++) {
        const psb = placedSchoolBoxes[pi]
        const along = (psb.x - e.ax) * e.ux + (psb.z - e.az) * e.uz
        const perp = Math.abs((psb.x - e.ax) * e.rx + (psb.z - e.az) * e.rz)
        if (along >= -psb.halfL - 1 && along <= e.len + psb.halfL + 1 && perp <= nomW + 6) {
          const sbSkip: [number, number] = [along - psb.halfL - 0.5, along + psb.halfL + 0.5]
          skipZones.push(sbSkip)
          curbOuterSkipZones.push(sbSkip)
        }
      }
    }

    // 3. Bus Stop Yellow Dashed Bay Boxes (公交停靠站标线) along edge
    const busBaySkips: [number, number][] = []
    if (roadGraph.busStops?.length && nomW >= 6.0) {
      for (let bi = 0; bi < roadGraph.busStops.length; bi++) {
        const st = roadGraph.busStops[bi]
        const lx = st.x - origin[0], lz = st.z - origin[1]
        const along = (lx - e.ax) * e.ux + (lz - e.az) * e.uz
        const perp = (lx - e.ax) * e.rx + (lz - e.az) * e.rz
        if (along < startSB.trim + 8 || along > e.len - endSB.trim - 8 || Math.abs(perp) > nomW * 0.9 + 5.5) continue
        const samp = interpAt(along)
        const onRightSide = perp >= 0
        if (!e.isTwoWay && !onRightSide) continue
        const bS0 = Math.max(startSB.trim + 2, along - 8.5), bS1 = Math.min(e.len - endSB.trim - 2, along + 8.5)
        if (bS1 - bS0 < 10) continue
        busBaySkips.push([bS0 - 0.3, bS1 + 0.3])
        const tOuter = onRightSide ? samp.tR - rightEdgeInset : samp.tL + leftEdgeInset
        const tInner = onRightSide ? tOuter - 2.35 : tOuter + 2.35
        for (let ds = bS0; ds < bS1; ds += 2.2) {
          const ds1 = Math.min(bS1, ds + 1.3)
          const pa = midP(ds), pb = midP(ds1)
          emitter.drapeStrip(pa[0] + e.rx * tInner, pa[1] + e.rz * tInner, pb[0] + e.rx * tInner, pb[1] + e.rz * tInner, e.rx, e.rz, 0.10, 'road', PAINT_YELLOW)
        }
        const pStart = midP(bS0), pEnd = midP(bS1)
        emitter.drapeStrip(pStart[0] + e.rx * tOuter, pStart[1] + e.rz * tOuter, pStart[0] + e.rx * tInner, pStart[1] + e.rz * tInner, e.ux, e.uz, 0.10, 'road', PAINT_YELLOW)
        emitter.drapeStrip(pEnd[0] + e.rx * tOuter, pEnd[1] + e.rz * tOuter, pEnd[0] + e.rx * tInner, pEnd[1] + e.rz * tInner, e.ux, e.uz, 0.10, 'road', PAINT_YELLOW)
      }
    }

    // 4. Longitudinal Centerlines, Same-Direction Lane Dividers & Edge Lines
    const sStart = startSB.trim, sEnd = e.len - endSB.trim
    const hasTTopContinuousCurb = e.forwardOnly && e.clsRank >= 4 &&
      ((endHop && !coreHasRightArm(e, endHop.core, e.len)) || (startHop && !coreHasRightArm(e, startHop.core, 0)))
    if (sEnd - sStart < 1.0) {
      if (hasTTopContinuousCurb) {
        for (const [a0, b0] of subtractIntervals(0, e.len, curbOuterSkipZones)) {
          if (b0 - a0 < 0.8) continue
          const pa = midP(a0), pb = midP(b0)
          const ta = interpAt(a0).tR - rightEdgeInset, tb = interpAt(b0).tR - rightEdgeInset
          emitter.drapeStrip(pa[0] + e.rx * ta, pa[1] + e.rz * ta, pb[0] + e.rx * tb, pb[1] + e.rz * tb, e.rx, e.rz, 0.075, 'road', PAINT_WHITE)
        }
      }
      continue
    }
    const cleanSegments = subtractIntervals(sStart, sEnd, skipZones)
    if (!cleanSegments.length) continue

    const isZhongshan = inBox(midWX, midWZ, ZHONGSHAN_PLANTER_BOX)
    const isNarrow = nomW < 5.6 || (e.clsRank <= 2 && nomW < 6.5)

    const emitLinePass = (
      tFn: (samp: CrossSectionSample) => number,
      halfWidth: number,
      color: RGB,
      dashLen: number,
      gapLen: number,
      segMin: number,
      segMax: number,
      target: 'road' | 'cycle' = 'road',
      extraSkips?: readonly [number, number][],
      baseSkips: readonly [number, number][] = skipZones,
    ) => {
      const combSkips = extraSkips?.length ? [...baseSkips, ...extraSkips] : baseSkips
      const subSegs = subtractIntervals(segMin, segMax, combSkips)
      for (let si = 0; si < subSegs.length; si++) {
        const [a0, b0] = subSegs[si]
        if (b0 - a0 < 0.35) continue
        if (dashLen <= 0) {
          const knots = [a0]
          for (let pi = 0; pi < profile.length; pi++) {
            if (profile[pi].s > a0 + 0.4 && profile[pi].s < b0 - 0.4) knots.push(profile[pi].s)
          }
          knots.push(b0)
          for (let ki = 1; ki < knots.length; ki++) {
            const sa = knots[ki - 1], sb = knots[ki]
            const pa = midP(sa), pb = midP(sb)
            const ta = tFn(interpAt(sa)), tb = tFn(interpAt(sb))
            if (Number.isFinite(ta) && Number.isFinite(tb)) {
              emitter.drapeStrip(pa[0] + e.rx * ta, pa[1] + e.rz * ta, pb[0] + e.rx * tb, pb[1] + e.rz * tb, e.rx, e.rz, halfWidth, target, color)
            }
          }
        } else {
          const period = dashLen + gapLen
          const firstK = Math.floor((worldPhaseBase + a0) / period)
          for (let k = firstK; ; k++) {
            const dStart = k * period - worldPhaseBase
            const dEnd = dStart + dashLen
            if (dStart >= b0 - 0.1) break
            const s0 = Math.max(a0, dStart), s1 = Math.min(b0, dEnd)
            if (s1 - s0 >= 0.45) {
              const pa = midP(s0), pb = midP(s1)
              const ta = tFn(interpAt(s0)), tb = tFn(interpAt(s1))
              if (Number.isFinite(ta) && Number.isFinite(tb)) {
                emitter.drapeStrip(pa[0] + e.rx * ta, pa[1] + e.rz * ta, pb[0] + e.rx * tb, pb[1] + e.rz * tb, e.rx, e.rz, halfWidth, target, color)
              }
            }
          }
        }
      }
    }

    if (e.isTwoWay) {
      if (isNarrow) {
        // GB 5768: <5.6m shared narrow street has no centerline; omit curb-hugging edge lines to stay clear of kerb gully grates
      } else {
        const is4Plus = nomW >= 10.6
        if (is4Plus) {
          // Double yellow solid centerline (双黄实线)
          emitLinePass(sp => 0.5 * (sp.tL + sp.tR) - 0.15, 0.072, PAINT_YELLOW, 0, 0, sStart, sEnd)
          emitLinePass(sp => 0.5 * (sp.tL + sp.tR) + 0.15, 0.072, PAINT_YELLOW, 0, 0, sStart, sEnd)
        } else {
          // 2-lane or 3-lane two-way: yellow solid within 28m of controlled ends, yellow dashed mid-block
          const endApproach = endCtrl.isControlled ? Math.max(sStart, sEnd - 28) : sEnd
          const startApproach = startCtrl.isControlled ? Math.min(sEnd, sStart + 28) : sStart
          if (startApproach > sStart) {
            emitLinePass(sp => 0.5 * (sp.tL + sp.tR), 0.075, PAINT_YELLOW, 0, 0, sStart, startApproach)
          }
          if (endApproach < sEnd) {
            emitLinePass(sp => 0.5 * (sp.tL + sp.tR), 0.075, PAINT_YELLOW, 0, 0, endApproach, sEnd)
          }
          if (endApproach - startApproach > 1.0) {
            emitLinePass(sp => 0.5 * (sp.tL + sp.tR), 0.075, PAINT_YELLOW, 4.0, 6.0, startApproach, endApproach)
          }
        }

        // Subdivide each half if >= 5.3m (2+ motor lanes per direction)
        const halfW = nomW * 0.5
        const nDir = halfW >= 8.5 ? 3 : halfW >= 5.3 ? 2 : 1
        for (const side of [-1, 1] as const) {
          for (let li = 1; li < nDir; li++) {
            const frac = li / nDir
            const tLane = (sp: CrossSectionSample) => {
              const tMid = 0.5 * (sp.tL + sp.tR)
              return side > 0 ? tMid + (sp.tR - tMid) * frac : tMid - (tMid - sp.tL) * frac
            }
            const approachFrom = side > 0
              ? (endCtrl.isControlled ? Math.max(sStart, sEnd - 28) : sEnd)
              : (startCtrl.isControlled ? Math.min(sEnd, sStart + 28) : sStart)
            if (side > 0) {
              if (approachFrom > sStart) emitLinePass(tLane, 0.068, PAINT_WHITE, 2.0, 4.0, sStart, approachFrom)
              if (sEnd > approachFrom) emitLinePass(tLane, 0.072, PAINT_WHITE, 0, 0, approachFrom, sEnd)
            } else {
              if (approachFrom > sStart) emitLinePass(tLane, 0.072, PAINT_WHITE, 0, 0, sStart, approachFrom)
              if (sEnd > approachFrom) emitLinePass(tLane, 0.068, PAINT_WHITE, 2.0, 4.0, approachFrom, sEnd)
            }
          }
        }
        // Motor/non-motor divider or outer white edge line on wide two-way streets (clear of curb gully grates & hedge overhangs)
        if (nomW >= 9.0 && !profile[0].cycleRight) {
          emitLinePass(sp => sp.tL + leftEdgeInset, 0.072, PAINT_WHITE, 0, 0, sStart, sEnd)
          emitLinePass(sp => sp.tR - rightEdgeInset, 0.072, PAINT_WHITE, 0, 0, sStart, sEnd, 'road', undefined, curbOuterSkipZones)
        } else if (e.clsRank >= 4) {
          emitLinePass(sp => sp.tL + leftEdgeInset, 0.068, PAINT_WHITE, 0, 0, sStart, sEnd)
          emitLinePass(sp => sp.tR - rightEdgeInset, 0.068, PAINT_WHITE, 0, 0, sStart, sEnd, 'road', undefined, curbOuterSkipZones)
        }
      }
    } else {
      // ONE-WAY CARRIAGEWAY (including divided paired trunk/primary/secondary carriageways, Rongyin, Binjiang)
      // Near Shizijie core (<70m), only major cardinal divided arterials (len >= 32m) keep yellow left edge; plaza slip arcs stay white
      const inSzjPlaza = hypot2(midWX - SHIZIJIE_CENTER[0], midWZ - SHIZIJIE_CENTER[1]) < 70
      const hasMed = profile.some(p => p.hasMedianLeft) && (!inSzjPlaza || e.len >= 32.0)
      const nLanes = nomW < 4.5 ? 1 : clamp(Math.round(nomW / 3.2), 2, 5)
      const finalN = nLanes > 1 && nomW / nLanes < 2.65 ? nLanes - 1 : nLanes
      const dashLen = e.clsRank >= 8 ? 3.0 : 2.0
      const gapLen = e.clsRank >= 8 ? 5.0 : 4.0
      const solidStart = endCtrl.isControlled ? Math.max(sStart, sEnd - 28) : sEnd

      // Left edge line: yellow/white 0.28m beside physical central median (no gullies); 0.60m clear of outer curb otherwise
      const leftEdgeActual = hasMed ? 0.28 : leftEdgeInset
      emitLinePass(sp => sp.tL + leftEdgeActual, 0.078, hasMed ? PAINT_YELLOW : PAINT_WHITE, 0, 0, sStart, sEnd)
      // Right edge line (white solid motor edge, clear of curb gullies & hedge overhang, breaking around yellow bus bay boxes & right-arm openings)
      const curbS0 = hasTTopContinuousCurb ? 0 : sStart
      const curbS1 = hasTTopContinuousCurb ? e.len : sEnd
      emitLinePass(sp => sp.tR - rightEdgeInset, 0.075, PAINT_WHITE, 0, 0, curbS0, curbS1, 'road', busBaySkips, curbOuterSkipZones)

      for (let li = 1; li < finalN; li++) {
        // On Zhongshan Middle Rd where planters occupy the outermost mid-block lane divider, omit it consistently across block & approach
        const isPlanterDivider = isZhongshan && finalN >= 4 && li === finalN - 1
        if (isPlanterDivider) continue
        const frac = li / finalN
        const tDiv = (sp: CrossSectionSample) => sp.tL + (sp.tR - sp.tL) * frac
        if (solidStart > sStart) {
          emitLinePass(tDiv, 0.068, PAINT_WHITE, dashLen, gapLen, sStart, solidStart, 'road', busBaySkips)
        }
        if (sEnd > solidStart) {
          emitLinePass(tDiv, 0.072, PAINT_WHITE, 0, 0, solidStart, sEnd, 'road', busBaySkips)
        }
      }
      // Mid-block straight directional arrows on undivided one-way multi-lane streets (Binjiang/Rongyin clarity)
      if (!hasMed && finalN >= 3 && sEnd - sStart >= 45) {
        const sMid = 0.5 * (sStart + sEnd)
        const mp = midP(sMid)
        if (subtractIntervals(sMid - 3, sMid + 3, skipZones).length === 1 && !junctionCores.some(c => hypot2(mp[0] - c.cx, mp[1] - c.cz) < c.r + 8)) {
          const sp = interpAt(sMid)
          for (let li = 0; li < finalN; li++) {
            const tC = sp.tL + sp.w * ((li + 0.5) / finalN)
            emitArrow(emitter, mp[0] + e.rx * tC, mp[1] + e.rz * tC, e.ux, e.uz, e.rx, e.rz, 'straight', 'road')
          }
        }
      }
    }

    // 5. Exclusive Cycleway (kind=5) & Auxiliary Frontage Lane (flanking k0) Bike Icons
    if (!isZhongshan) {
      for (const side of ['R', 'L'] as const) {
        const hasCyc = profile.some(p => (side === 'R' ? p.cycleRight : p.cycleLeft) !== null)
        const hasAux = !hasCyc && profile.some(p => (side === 'R' ? p.auxRight : p.auxLeft) !== null)
        if (!hasCyc && !hasAux) continue
        if (side === 'L' && !e.isTwoWay && hasCyc) {
          // Check if opposite road already exists on left (skip duplicate stamp on opposing cycleway unless no opposite road)
          if (profile.some(p => p.hasMedianLeft)) continue
        }
        const target: 'cycle' | 'road' = hasCyc ? 'cycle' : 'road'
        const getSpan = (sp: CrossSectionSample) =>
          side === 'R' ? (sp.cycleRight ?? sp.auxRight) : (sp.cycleLeft ?? sp.auxLeft)
        const dirTravel = e.isTwoWay && side === 'L' ? -1 : 1
        // Aux frontage lanes get clean white edge lines (0.60m clear of both flanking curbs so kerb gullies never overlap)
        if (hasAux) {
          emitLinePass(sp => { const s = getSpan(sp); return s && s[1] - s[0] >= 2.8 ? s[0] + 0.60 : NaN }, 0.068, PAINT_WHITE, 0, 0, sStart, sEnd, 'road')
          emitLinePass(sp => { const s = getSpan(sp); return s && s[1] - s[0] >= 2.8 ? s[1] - 0.60 : NaN }, 0.068, PAINT_WHITE, 0, 0, sStart, sEnd, 'road')
        }
        for (let s = sStart + 10; s <= sEnd - 8; s += 32) {
          if (subtractIntervals(s - 1.5, s + 1.5, skipZones).length !== 1) continue
          const sp = interpAt(s)
          const span = getSpan(sp)
          if (!span || span[1] - span[0] < 1.7) continue
          const tC = 0.5 * (span[0] + span[1])
          const mp = midP(s)
          const bx = mp[0] + e.rx * tC, bz = mp[1] + e.rz * tC
          if (drawnAuxStrips.some(p => hypot2(p.x - bx, p.z - bz) < 12)) continue
          drawnAuxStrips.push({ x: bx, z: bz })
          emitBikeIcon(emitter, bx, bz, e.ux * dirTravel, e.uz * dirTravel, e.rx * dirTravel, e.rz * dirTravel, target)
        }
      }
    }

    // 6. Shizijie Outer Approach Red-Yellow Non-Motorized Waiting Pockets (strictly clear of shrub planters & corner slip islands)
    const hasObstacleBox = (cx: number, cz: number, planterR = 4.2, railR = 1.4): boolean => {
      for (let di = 0; di < decor.length; di++) {
        const dk = decor[di][0]
        if (dk < 1 || dk > 9) continue
        const r = (dk === 5 || dk === 6 || dk === 9) ? planterR : railR
        if (hypot2(decor[di][1] / 10 - cx, decor[di][2] / 10 - cz) < r) return true
      }
      if (obstacleGrid.count) {
        const oy = obstacleGrid.maxHeightAt(cx, cz)
        const ry = cycleGrid.maxHeightAt(cx, cz) ?? roadGrid.maxHeightAt(cx, cz)
        if (oy !== null && (ry === null || oy > ry + 0.04)) return true
      }
      return false
    }
    const isClearWaitBox = (pA: Pt, pB: Pt, t0: number, t1: number, pR = 4.2, rR = 1.4): boolean => {
      const tM = 0.5 * (t0 + t1)
      const pM: Pt = [0.5 * (pA[0] + pB[0]), 0.5 * (pA[1] + pB[1])]
      return !hasObstacleBox(pM[0] + e.rx * tM, pM[1] + e.rz * tM, pR, rR) &&
        !hasObstacleBox(pA[0] + e.rx * t0, pA[1] + e.rz * t0, pR - 0.2, rR - 0.2) &&
        !hasObstacleBox(pA[0] + e.rx * t1, pA[1] + e.rz * t1, pR - 0.2, rR - 0.2) &&
        !hasObstacleBox(pB[0] + e.rx * t0, pB[1] + e.rz * t0, pR - 0.2, rR - 0.2) &&
        !hasObstacleBox(pB[0] + e.rx * t1, pB[1] + e.rz * t1, pR - 0.2, rR - 0.2)
    }
    if (hypot2(midWX - SHIZIJIE_CENTER[0], midWZ - SHIZIJIE_CENTER[1]) < 95 && endCtrl.isControlled && signalNodes.has(e.v) && e.clsRank >= 6 && e.len >= 32.0) {
      const sStop = e.len - endSB.stopDist
      for (const sTry of [sStop - 2.2, e.len - 22, e.len - 26, e.len - 30, e.len - 34, e.len - 38, e.len - 42, e.len - 46]) {
        if (sTry < 4 || sTry > e.len - 4) continue
        const pMid = midP(sTry)
        const dPlaza = hypot2(origin[0] + pMid[0] - SHIZIJIE_CENTER[0], origin[1] + pMid[1] - SHIZIJIE_CENTER[1])
        if (dPlaza < 22 || dPlaza > 65) continue
        const sp = interpAt(sTry)
        let pocketSpan: [number, number] | null = null
        let pocketTarget: 'cycle' | 'road' = 'cycle'
        const p0 = midP(sTry - 2.2), p1 = midP(sTry + 2.0)
        const cycRight = cycleGrid.scanLineIntervals(pMid[0], pMid[1], e.rx, e.rz, sp.tR - 0.5, sp.tR + 15, candBuf)
        for (const cand of cycRight) {
          if (cand[0] < sp.tR - 0.5 || cand[1] - cand[0] < 1.5) continue
          const tC0 = cand[0] + 0.14, tC1 = Math.min(cand[1] - 0.14, cand[0] + 3.4)
          if (tC1 - tC0 >= 1.3 && isClearWaitBox(p0, p1, tC0, tC1, 3.4, 1.1)) {
            pocketSpan = cand; pocketTarget = 'cycle'; break
          }
        }
        if (!pocketSpan) {
          const auxScans = roadGrid.scanLineIntervals(pMid[0], pMid[1], e.rx, e.rz, sp.tR + 0.6, sp.tR + 15, candBuf)
          const candList = sp.auxRight ? [...auxScans, sp.auxRight] : auxScans
          for (const cand of candList) {
            if (cand[0] < sp.tR + 0.6 || cand[1] - cand[0] < 1.8 || cand[1] - cand[0] > 5.5) continue
            const tC0 = cand[0] + 0.16, tC1 = Math.min(cand[1] - 0.16, cand[0] + 3.4)
            if (tC1 - tC0 >= 1.4 && isClearWaitBox(p0, p1, tC0, tC1, 4.2, 1.4)) {
              pocketSpan = cand; pocketTarget = 'road'; break
            }
          }
        }
        if (pocketSpan && pocketSpan[1] - pocketSpan[0] >= 1.6) {
          const tC0 = pocketSpan[0] + 0.16, tC1 = Math.min(pocketSpan[1] - 0.16, pocketSpan[0] + 3.4)
          const bx0 = p0[0] + e.rx * tC0, bz0 = p0[1] + e.rz * tC0
          const bx1 = p1[0] + e.rx * tC1, bz1 = p1[1] + e.rz * tC1
          const checkGrid = pocketTarget === 'cycle' ? cycleGrid : roadGrid
          if (tC1 - tC0 >= 1.4 && checkGrid.containsPoint(0.5 * (bx0 + bx1), 0.5 * (bz0 + bz1)) && !drawnWaitPockets.some(p => hypot2(p.x - bx0, p.z - bz0) < 10)) {
            drawnWaitPockets.push({ x: bx0, z: bz0 })
            emitter.drapeQuad(
              [p0[0] + e.rx * tC0, p0[1] + e.rz * tC0],
              [p1[0] + e.rx * tC0, p1[1] + e.rz * tC0],
              [p1[0] + e.rx * tC1, p1[1] + e.rz * tC1],
              [p0[0] + e.rx * tC1, p0[1] + e.rz * tC1],
              pocketTarget,
              PAINT_WAIT_RED,
              MARKING_LIFT_M + 0.002,
            )
            emitter.drapeStrip(
              p1[0] + e.rx * tC0, p1[1] + e.rz * tC0,
              p1[0] + e.rx * tC1, p1[1] + e.rz * tC1,
              e.ux, e.uz, 0.24, pocketTarget, PAINT_WAIT_YELLOW, MARKING_LIFT_M + 0.003,
            )
            break
          }
        }
      }
    }
  }

  // Drape unconsumed legacy crosswalk clusters strictly outside core centers & existing edges, and synthesize ungraphed arm approach markings
  for (let i = 0; i < legacyClusters.length; i++) {
    if (consumedClusters[i]) continue
    const cl = legacyClusters[i]
    if (junctionCores.some(c => hypot2(cl.cx - c.cx, cl.cz - c.cz) < Math.max(4.0, c.r - 1.0))) continue
    if (placedStopZones.some(z => hypot2(cl.cx - z.x, cl.cz - z.z) < 9.5)) continue
    if (placedCrossZones.some(z => hypot2(cl.cx - z.x, cl.cz - z.z) < 12.0)) continue
    for (const b of cl.bars) emitter.drapePolygon(b.ring, 'both', PAINT_WHITE)
    placedCrossZones.push({ x: cl.cx, z: cl.cz })
    const nearCore = junctionCores.find(c => hypot2(cl.cx - c.cx, cl.cz - c.cz) < c.r + 22.0)
    const barObb = cl.bars[0]?.obb
    if (nearCore && barObb) {
      const dxC = cl.cx - nearCore.cx, dzC = cl.cz - nearCore.cz
      const sign = barObb.ux * dxC + barObb.uz * dzC >= 0 ? 1 : -1
      const ux = barObb.ux * sign, uz = barObb.uz * sign
      const rx = -uz, rz = ux
      const pts: { s: number; tL: number; tR: number }[] = []
      for (let s = 3.8; s <= 68; s += 2.5) {
        const px = cl.cx + ux * s, pz = cl.cz + uz * s
        if (px < 1 || px > TILE_SIZE - 1 || pz < 1 || pz > TILE_SIZE - 1) break
        if (edges.some(pe => {
          const al = (px - pe.ax) * pe.ux + (pz - pe.az) * pe.uz
          const tC = clamp(al, 0, pe.len)
          return hypot2(px - (pe.ax + pe.ux * tC), pz - (pe.az + pe.uz * tC)) < 8.5
        })) break
        const rInts = roadGrid.scanLineIntervals(px, pz, rx, rz, -14, 14, candBuf)
        const span = rInts.find(([a, b]) => a <= 0.3 && b >= -0.3 && b - a >= 3.8 && b - a <= 15.5)
        if (!span) break
        pts.push({ s, tL: span[0], tR: span[1] })
      }
      if (pts.length >= 2) {
        const s0Pts = pts[0]
        const wAvg = pts.reduce((sum, p) => sum + (p.tR - p.tL), 0) / pts.length
        const tMid0 = 0.5 * (s0Pts.tL + s0Pts.tR)
        const spX = cl.cx + ux * s0Pts.s, spZ = cl.cz + uz * s0Pts.s
        const tMinStop = s0Pts.tL + 0.25
        const tMaxStop = wAvg >= 5.2 ? tMid0 - 0.08 : s0Pts.tR - 0.28
        if (tMaxStop - tMinStop >= 2.0) {
          emitter.drapeStrip(spX + rx * tMinStop, spZ + rz * tMinStop, spX + rx * tMaxStop, spZ + rz * tMaxStop, ux, uz, 0.17, 'road', PAINT_WHITE)
          placedStopZones.push({ x: spX, z: spZ })
        }
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1], b = pts[k]
          const ax = cl.cx + ux * a.s, az = cl.cz + uz * a.s
          const bx = cl.cx + ux * b.s, bz = cl.cz + uz * b.s
          const mA = 0.5 * (a.tL + a.tR), mB = 0.5 * (b.tL + b.tR)
          if (wAvg >= 5.2) emitter.drapeStrip(ax + rx * mA, az + rz * mA, bx + rx * mB, bz + rz * mB, rx, rz, 0.072, 'road', PAINT_YELLOW)
          if (wAvg >= 5.0) {
            emitter.drapeStrip(ax + rx * (a.tL + 0.60), az + rz * (a.tL + 0.60), bx + rx * (b.tL + 0.60), bz + rz * (b.tL + 0.60), rx, rz, 0.068, 'road', PAINT_WHITE)
            emitter.drapeStrip(ax + rx * (a.tR - 0.60), az + rz * (a.tR - 0.60), bx + rx * (b.tR - 0.60), bz + rz * (b.tR - 0.60), rx, rz, 0.068, 'road', PAINT_WHITE)
          }
        }
      }
    }
  }

  // Fallback legacy stripes strictly on unmapped corridors clear of edges & junction cores + synthesize left/right edges on unmapped arterials
  const drawnFallbackCarriageways: { cx: number; cz: number; ux: number; uz: number }[] = []
  for (let i = 0; i < legacyKind2.length; i++) {
    const entry = legacyKind2[i]
    if (!entry[1] || entry[1].length < 4) continue
    const ring: Pt[] = entry[1].map(([xCm, zCm]) => [xCm / 100, zCm / 100] as const)
    if (shouldSuppressCrosswalk && shouldSuppressCrosswalk(ring)) continue
    const obb = minDistToRectPoints(ring)
    if (!obb) continue
    if (obb.minW >= 0.36 && obb.minW <= 0.85 && obb.maxL >= 2.2 && obb.maxL <= 5.5) continue
    const wcx = origin[0] + obb.cx, wcz = origin[1] + obb.cz
    if (isBridgeExcluded(wcx, wcz) || hypot2(wcx - (-280), wcz - 5) < 165) continue
    // Exclude Jiefang W bridge-abutment diagonal portal slivers (-428..-415, -55..-25)
    if (wcx >= -428 && wcx <= -398 && wcz >= -55 && wcz <= -25) continue

    // Long thin legacy road dividers (e.g. ungraphed 85m Jiefang E corridor): trim cleanly outside mapped edges/cores instead of all-or-nothing drop
    if (obb.minW <= 0.30 && obb.maxL >= 8.0 && obb.fill > 0.70) {
      const halfL = obb.maxL * 0.5
      const excludeSpans: [number, number][] = []
      const pushCircleExclude = (cx: number, cz: number, r: number) => {
        const hit = lineCircleInterval(obb.cx - obb.ux * halfL, obb.cz - obb.uz * halfL, obb.ux, obb.uz, obb.maxL, cx, cz, r)
        if (hit) excludeSpans.push([hit[0] - halfL, hit[1] - halfL])
      }
      for (const c of junctionCores) pushCircleExclude(c.cx, c.cz, c.r + 16.0)
      for (const z of placedStopZones) pushCircleExclude(z.x, z.z, 18.0)
      for (const pe of edges) {
        const p0x = obb.cx - obb.ux * halfL, p0z = obb.cz - obb.uz * halfL
        let inS = false, segA = 0
        for (let tS = 0; tS <= obb.maxL + 0.1; tS += 4.0) {
          const sC = Math.min(obb.maxL, tS)
          const sx = p0x + obb.ux * sC, sz = p0z + obb.uz * sC
          const alongPe = (sx - pe.ax) * pe.ux + (sz - pe.az) * pe.uz
          const tc = clamp(alongPe, 0, pe.len)
          const hitPe = alongPe >= -6 && alongPe <= pe.len + 6 && hypot2(sx - (pe.ax + pe.ux * tc), sz - (pe.az + pe.uz * tc)) < 12.5
          if (hitPe && !inS) { inS = true; segA = Math.max(0, sC - 4.0) }
          else if (!hitPe && inS) { inS = false; excludeSpans.push([segA - halfL, sC - halfL]) }
        }
        if (inS) excludeSpans.push([segA - halfL, halfL])
      }
      const cleanSpans = subtractIntervals(-halfL, halfL, excludeSpans)
      const rx = -obb.uz, rz = obb.ux
      const worldPhase = wcx * obb.ux + wcz * obb.uz
      const period = 6.0
      for (const [spanA, spanB] of cleanSpans) {
        if (spanB - spanA < 10.0) continue
        const firstK = Math.floor((worldPhase + spanA) / period)
        for (let k = firstK; ; k++) {
          const s = k * period - worldPhase
          if (s >= spanB - 0.2) break
          const s0 = Math.max(spanA, s), s1 = Math.min(spanB, s + 2.0)
          if (s1 - s0 > 0.4) {
            emitter.drapeStrip(obb.cx + obb.ux * s0, obb.cz + obb.uz * s0, obb.cx + obb.ux * s1, obb.cz + obb.uz * s1, rx, rz, 0.072, 'road', PAINT_WHITE)
          }
        }
        // For ungraphed divided arterial segments (e.g. Jiefang E Rd), add left yellow median & right white curb edges
        if (spanB - spanA >= 16.0) {
          const spanMid = 0.5 * (spanA + spanB)
          const mx = obb.cx + obb.ux * spanMid, mz = obb.cz + obb.uz * spanMid
          const ints = roadGrid.scanLineIntervals(mx, mz, rx, rz, -14, 14, candBuf)
          const cwSpan = ints.find(([a, b]) => a <= 0.2 && b >= -0.2 && b - a >= 5.5 && b - a <= 14.5)
          if (cwSpan) {
            const midT = 0.5 * (cwSpan[0] + cwSpan[1])
            const cwX = mx + rx * midT, cwZ = mz + rz * midT
            const dup = drawnFallbackCarriageways.some(dc =>
              Math.abs(dc.ux * obb.ux + dc.uz * obb.uz) > 0.9 &&
              Math.abs((cwX - dc.cx) * rx + (cwZ - dc.cz) * rz) < 6.0 &&
              Math.abs((cwX - dc.cx) * obb.ux + (cwZ - dc.cz) * obb.uz) < (spanB - spanA) * 0.6,
            )
            if (!dup) {
              drawnFallbackCarriageways.push({ cx: cwX, cz: cwZ, ux: obb.ux, uz: obb.uz })
              const medLeft = hasMedianDecorNear(decor, mx, mz, rx, rz, cwSpan[0] - 3.6, cwSpan[0] + 0.5, 14) ||
                ints.some(([ra, rb]) => rb < cwSpan[0] - 0.15 && cwSpan[0] - rb <= 5.5 && rb - ra >= 4.0)
              const medRight = hasMedianDecorNear(decor, mx, mz, rx, rz, cwSpan[1] - 0.5, cwSpan[1] + 3.6, 14) ||
                ints.some(([ra, rb]) => ra > cwSpan[1] + 0.15 && ra - cwSpan[1] <= 5.5 && rb - ra >= 4.0)
              const edgeL = cwSpan[0] + (medLeft ? 0.28 : 0.60)
              const edgeR = cwSpan[1] - (medRight ? 0.28 : 0.60)
              emitter.drapeStrip(obb.cx + obb.ux * spanA + rx * edgeL, obb.cz + obb.uz * spanA + rz * edgeL, obb.cx + obb.ux * spanB + rx * edgeL, obb.cz + obb.uz * spanB + rz * edgeL, rx, rz, 0.075, 'road', medLeft ? PAINT_YELLOW : PAINT_WHITE)
              emitter.drapeStrip(obb.cx + obb.ux * spanA + rx * edgeR, obb.cz + obb.uz * spanA + rz * edgeR, obb.cx + obb.ux * spanB + rx * edgeR, obb.cz + obb.uz * spanB + rz * edgeR, rx, rz, 0.075, 'road', medRight ? PAINT_YELLOW : PAINT_WHITE)
            }
          }
        }
      }
      continue
    }

    if (junctionCores.some(c => hypot2(obb.cx - c.cx, obb.cz - c.cz) < c.r + 16.0)) continue
    if (placedStopZones.some(z => hypot2(obb.cx - z.x, obb.cz - z.z) < 18.0)) continue
    // Reject ANY non-divider polygon whose centroid OR any ring vertex falls inside a mapped roadGraph corridor or junction core
    const touchesMapped = ring.some(pt =>
      junctionCores.some(c => hypot2(pt[0] - c.cx, pt[1] - c.cz) < c.r + 14.0) ||
      edges.some(pe => {
        const along = (pt[0] - pe.ax) * pe.ux + (pt[1] - pe.az) * pe.uz
        if (along < -6 || along > pe.len + 6) return false
        const t = clamp(along, 0, pe.len)
        return hypot2(pt[0] - (pe.ax + pe.ux * t), pt[1] - (pe.az + pe.uz * t)) < 12.5
      }),
    ) || edges.some(pe => {
      const along = (obb.cx - pe.ax) * pe.ux + (obb.cz - pe.az) * pe.uz
      if (along < -8 || along > pe.len + 8) return false
      const t = clamp(along, 0, pe.len)
      return hypot2(obb.cx - (pe.ax + pe.ux * t), obb.cz - (pe.az + pe.uz * t)) < 14.5
    })
    if (touchesMapped) continue
    emitter.drapePolygon(ring, 'road', PAINT_WHITE)
  }

  void candBuf
  return {
    emittedTriangles: emitter.emittedTriangles,
    replacedDecor10: hasRawDecor10 && placedSchoolBoxes.length > 0,
  }
}
