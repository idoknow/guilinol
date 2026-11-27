// Runtime geometric repair for baked GL04 ground & bridge defects (IDOK-431):
// 1. Closes crosswalk-cut rectangular notches & split strips in roadside sidewalks/cycleways/verges
//    while preserving central-median pedestrian openings.
// 2. Stitches open water chasms between parallel bridge decks (e.g. carriageway + flanking footbridge)
//    and extends hanging/unlanded bridge abutments onto dry bank / connecting road surfaces.
// Outputs feed directly into both visual geometry and Rapier3D physics colliders.

type Pair = [number, number]
type StreetPath = [number, ...Pair[][]]
type RoadCtrl = [number, number[]]

export interface StreetRepairResult {
  paths: StreetPath[]
  /** Sidewalk/apron paths rendered flush at crossing grade (+0.065m) without vertical curbs. */
  flushPaths: StreetPath[]
  /** Quantized cm edge keys where bridged sidewalk seams should skip vertical curb walls. */
  skipCurbEdges: Set<string>
  repairedNotches: number
  repairedStripGaps: number
}

export interface BridgeRepairResult {
  deck: Float32Array
  thin: Set<number>
  stitchedTriangles: number
  landedTriangles: number
}

export type KeepoutZone = readonly [number, number, number]

// Landmark bridges that supply their own custom GLB geometry over procedural collision strips.
const LANDMARK_BRIDGE_IDS = new Set(['jiefang_bridge', 'guanyi_bridge', 'lize_bridge', 'huaqiao'])
let bridgeKeepouts: KeepoutZone[] = []

export function setBridgeRepairKeepouts(
  landmarks?: readonly { id: string; position: readonly number[]; sphere?: readonly number[] }[],
) {
  const zones: KeepoutZone[] = []
  for (const lm of landmarks ?? []) {
    if (!LANDMARK_BRIDGE_IDS.has(lm.id)) continue
    const sx = lm.sphere?.[0] ?? 0
    const sz = lm.sphere?.[2] ?? 0
    const r = lm.sphere?.[3] ?? 80
    zones.push([lm.position[0] + sx, lm.position[2] + sz, r])
  }
  bridgeKeepouts = zones
}

export function getBridgeRepairKeepouts(): readonly KeepoutZone[] {
  return bridgeKeepouts
}

export function curbEdgeKeyCm(ax: number, az: number, bx: number, bz: number): string {
  const x1 = Math.round(ax), z1 = Math.round(az)
  const x2 = Math.round(bx), z2 = Math.round(bz)
  return x1 < x2 || (x1 === x2 && z1 < z2)
    ? `${x1},${z1}|${x2},${z2}`
    : `${x2},${z2}|${x1},${z1}`
}

function pointInRingCm(x: number, z: number, ring: readonly Pair[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[j]
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside
  }
  return inside
}

function ringBounds(ring: readonly Pair[]) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const [x, z] of ring) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  return { minX, maxX, minZ, maxZ }
}

function ringSignedArea2(ring: readonly Pair[]): number {
  let sum = 0
  for (let i = 0, n = ring.length; i < n; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % n]
    sum += ax * bz - bx * az
  }
  return sum
}

function onTileBorderCm(ax: number, az: number, bx: number, bz: number): boolean {
  return (
    (ax === bx && (ax <= 1 || ax >= 25599)) ||
    (az === bz && (az <= 1 || az >= 25599))
  )
}

function cleanCollinearRing(ring: Pair[]): Pair[] {
  if (ring.length < 4) return ring.slice()
  const out: Pair[] = []
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], prev = out[out.length - 1]
    if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 1) continue
    out.push([p[0], p[1]])
  }
  while (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1) {
    out.pop()
  }
  return out
}

interface PolyBox {
  shell: Pair[]
  holes: Pair[][]
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

function pointInPolyBox(x: number, z: number, poly: PolyBox): boolean {
  if (x < poly.minX || x > poly.maxX || z < poly.minZ || z > poly.maxZ) return false
  if (!pointInRingCm(x, z, poly.shell)) return false
  for (const h of poly.holes) if (pointInRingCm(x, z, h)) return false
  return true
}

/**
 * Repair baked GL04 street paths inside street-worker:
 *  - Collapses 4.1m crosswalk-cut concave U-notches out of sidewalk shells (kind=1).
 *  - Bridges split cycleway (kind=5), verge (kind=4), and roadside sidewalk (kind=1)
 *    strips across 4.1m crosswalk gaps while keeping central-median openings intact.
 */
export function repairStreetPaths(paths: readonly StreetPath[]): StreetRepairResult {
  const cwCenters: Pair[] = []
  const roads: PolyBox[] = []

  for (const path of paths) {
    const kind = path[0]
    const shell = path[1]
    if (!shell || shell.length < 3) continue
    if (kind === 2) {
      const b = ringBounds(shell)
      const w = b.maxX - b.minX, h = b.maxZ - b.minZ
      if (Math.max(w, h) >= 160 && Math.max(w, h) <= 490 && Math.min(w, h) <= 440) {
        cwCenters.push([(b.minX + b.maxX) * 0.5, (b.minZ + b.maxZ) * 0.5])
      }
    } else if (kind === 0) {
      const [, roadShell, ...roadHoles] = path
      const b = ringBounds(roadShell)
      roads.push({ shell: roadShell, holes: roadHoles, ...b })
    }
  }

  if (!cwCenters.length) {
    return {
      paths: paths as StreetPath[],
      flushPaths: [],
      skipCurbEdges: new Set(),
      repairedNotches: 0,
      repairedStripGaps: 0,
    }
  }

  const nearCrosswalk = (x: number, z: number, radiusCm: number): boolean => {
    const r2 = radiusCm * radiusCm
    for (let i = 0; i < cwCenters.length; i++) {
      const dx = cwCenters[i][0] - x, dz = cwCenters[i][1] - z
      if (dx * dx + dz * dz <= r2) return true
    }
    return false
  }

  const inRoad = (x: number, z: number): boolean => {
    for (let i = 0; i < roads.length; i++) {
      if (pointInPolyBox(x, z, roads[i])) return true
    }
    return false
  }

  const skipCurbEdges = new Set<string>()
  const outPaths: StreetPath[] = []
  const flushPaths: StreetPath[] = []
  let repairedNotches = 0
  let repairedStripGaps = 0

  // Step 1A: Collapse concave rectangular U-notches cut by crosswalk gaps into kind=1 sidewalk rings.
  for (const path of paths) {
    if (path[0] !== 1 || !path[1] || path[1].length < 6) {
      outPaths.push(path)
      continue
    }
    let ring = cleanCollinearRing(path[1])
    let changed = true
    let passes = 0
    while (changed && ring.length >= 6 && passes++ < 16) {
      changed = false
      const n = ring.length
      for (let i = 0; i < n; i++) {
        const A = ring[i]
        const B = ring[(i + 1) % n]
        if (onTileBorderCm(A[0], A[1], B[0], B[1])) continue
        const abx = B[0] - A[0], abz = B[1] - A[1]
        const lenAB = Math.hypot(abx, abz)
        if (lenAB < 25 || lenAB > 320) continue
        const uxAB = abx / lenAB, uzAB = abz / lenAB

        // Walk 1..3 nearly-collinear segments along the notch bottom from B to C.
        let bestEnd = -1
        for (let span = 1; span <= 3 && span + 2 < n; span++) {
          const C = ring[(i + 1 + span) % n]
          const D = ring[(i + 2 + span) % n]
          if (onTileBorderCm(B[0], B[1], C[0], C[1]) || onTileBorderCm(C[0], C[1], D[0], D[1])) break
          const bcx = C[0] - B[0], bcz = C[1] - B[1]
          const lenBC = Math.hypot(bcx, bcz)
          if (lenBC < 260 || lenBC > 560) continue
          const uxBC = bcx / lenBC, uzBC = bcz / lenBC
          // Verify intermediate vertices (if any) stay close to segment B->C
          let collinear = true
          for (let m = 1; m < span; m++) {
            const M = ring[(i + 1 + m) % n]
            const perp = Math.abs((M[0] - B[0]) * (-uzBC) + (M[1] - B[1]) * uxBC)
            if (perp > 18) { collinear = false; break }
          }
          if (!collinear) break

          const cdx = D[0] - C[0], cdz = D[1] - C[1]
          const lenCD = Math.hypot(cdx, cdz)
          if (lenCD < 25 || lenCD > 320) continue
          const uxCD = cdx / lenCD, uzCD = cdz / lenCD

          // Rectangular U-notch checks: AB perp BC, BC perp CD, AB opposite CD, similar depth
          if (Math.abs(uxAB * uxBC + uzAB * uzBC) > 0.28) continue
          if (Math.abs(uxBC * uxCD + uzBC * uzCD) > 0.28) continue
          if (uxAB * uxCD + uzAB * uzCD > -0.86) continue
          if (Math.abs(lenAB - lenCD) > Math.max(65, 0.5 * Math.max(lenAB, lenCD))) continue

          const midADx = (A[0] + D[0]) * 0.5, midADz = (A[1] + D[1]) * 0.5
          const midCx = (A[0] + B[0] + C[0] + D[0]) * 0.25
          const midCz = (A[1] + B[1] + C[1] + D[1]) * 0.25
          const probeOutX = midADx - uxAB * 15, probeOutZ = midADz - uzAB * 15
          const probeInX = (B[0] + C[0]) * 0.5 + uxAB * 25, probeInZ = (B[1] + C[1]) * 0.5 + uzAB * 25

          // Must be a CONCAVE indentation (outside at AD, inside behind BC)
          if (pointInRingCm(midCx, midCz, ring)) continue
          if (pointInRingCm(probeOutX, probeOutZ, ring)) continue
          if (!pointInRingCm(probeInX, probeInZ, ring)) continue

          // Must be next to a crosswalk and NOT encroaching into carriageway
          if (!nearCrosswalk(midCx, midCz, 1300)) continue
          if (inRoad(midCx, midCz) || inRoad(midADx, midADz)) continue

          bestEnd = span
          break
        }

        if (bestEnd > 0) {
          // Remove B..C (indices i+1 through i+1+bestEnd inclusive) so edge goes directly A -> D.
          const removeIdx = new Set<number>()
          for (let k = 1; k <= bestEnd + 1; k++) removeIdx.add((i + k) % n)
          ring = ring.filter((_, idx) => !removeIdx.has(idx))
          repairedNotches++
          changed = true
          break
        }
      }
    }
    const [pKind, , ...pHoles] = path
    outPaths.push(ring.length >= 3 ? [pKind, ring, ...pHoles] : path)
  }

  // Step 1B: Bridge facing cut edges of split cycle (5), verge (4), and sidewalk (1) strips across 4.1m crosswalk gaps.
  interface CutEdge {
    polyIdx: number
    ax: number
    az: number
    bx: number
    bz: number
    mx: number
    mz: number
    nx: number
    nz: number
    tx: number
    tz: number
    len: number
    used: boolean
  }

  const addedPaths: StreetPath[] = []
  // Index existing roadside paving (kind 1, 4, 5) to ensure idempotence and never bridge already-closed edges
  const existingPaving: PolyBox[] = []
  for (const p of outPaths) {
    if ((p[0] !== 1 && p[0] !== 4 && p[0] !== 5) || !p[1] || p[1].length < 3) continue
    const [, pShell, ...pHoles] = p
    existingPaving.push({ shell: pShell, holes: pHoles, ...ringBounds(pShell) })
  }
  const isCoveredPaving = (x: number, z: number): boolean => {
    for (let i = 0; i < existingPaving.length; i++) {
      if (pointInPolyBox(x, z, existingPaving[i])) return true
    }
    return false
  }

  const collectCutEdges = (targetKind: number, minLen: number, maxLen: number): CutEdge[] => {
    const edges: CutEdge[] = []
    for (let pi = 0; pi < outPaths.length; pi++) {
      const p = outPaths[pi]
      if (p[0] !== targetKind || !p[1] || p[1].length < 3) continue
      const shell = p[1]
      const sign = ringSignedArea2(shell) >= 0 ? 1 : -1
      for (let i = 0, n = shell.length; i < n; i++) {
        const [ax, az] = shell[i], [bx, bz] = shell[(i + 1) % n]
        if (onTileBorderCm(ax, az, bx, bz)) continue
        const dx = bx - ax, dz = bz - az
        const len = Math.hypot(dx, dz)
        if (len < minLen || len > maxLen) continue
        const tx = dx / len, tz = dz / len
        // Compute outward normal and confirm by probing 6cm outward
        let nx = sign * tz, nz = -sign * tx
        const mx = (ax + bx) * 0.5, mz = (az + bz) * 0.5
        if (pointInRingCm(mx + nx * 6, mz + nz * 6, shell)) {
          nx = -nx
          nz = -nz
        }
        if (pointInRingCm(mx + nx * 6, mz + nz * 6, shell)) continue
        if (!nearCrosswalk(mx, mz, 1300)) continue
        // Skip edges that already meet adjacent paving (closed seam, not an open crosswalk cutout)
        if (isCoveredPaving(mx + nx * 15, mz + nz * 15)) continue
        edges.push({ polyIdx: pi, ax, az, bx, bz, mx, mz, nx, nz, tx, tz, len, used: false })
      }
    }
    return edges
  }

  for (const [kind, minLen, maxLen] of [[5, 70, 355], [4, 10, 340], [1, 75, 385]] as const) {
    const edges = collectCutEdges(kind, minLen, maxLen)
    for (let i = 0; i < edges.length; i++) {
      const a = edges[i]
      if (a.used) continue
      if (isCoveredPaving(a.mx + a.nx * 15, a.mz + a.nz * 15)) continue
      let bestJ = -1
      let bestScore = Infinity
      for (let j = i + 1; j < edges.length; j++) {
        const b = edges[j]
        if (b.used || b.polyIdx === a.polyIdx) continue
        if (isCoveredPaving(b.mx + b.nx * 15, b.mz + b.nz * 15)) continue
        // Facing opposite outward normals
        if (a.nx * b.nx + a.nz * b.nz > -0.88) continue
        // Similar strip widths
        const ratio = Math.min(a.len, b.len) / Math.max(a.len, b.len)
        if (ratio < 0.62) continue
        const vx = b.mx - a.mx, vz = b.mz - a.mz
        const along = vx * a.nx + vz * a.nz
        if (along < 240 || along > 560) continue
        const lat = Math.abs(vx * a.tx + vz * a.tz)
        if (lat > Math.max(70, 0.4 * Math.max(a.len, b.len))) continue
        const gx = (a.mx + b.mx) * 0.5, gz = (a.mz + b.mz) * 0.5
        if (!nearCrosswalk(gx, gz, 1200)) continue
        // Skip if gap center is already paved (idempotence & avoids overlapping existing strips)
        if (isCoveredPaving(gx, gz)) continue
        // Must NOT lie inside carriageway
        if (inRoad(gx, gz)) continue
        if (inRoad((a.mx + gx) * 0.5, (a.mz + gz) * 0.5) || inRoad((b.mx + gx) * 0.5, (b.mz + gz) * 0.5)) continue

        // Protect central medians (kind=1): medians sit with carriageway on BOTH lateral sides
        if (kind === 1) {
          const probeDist = Math.max(110, a.len * 0.5 + 85)
          const leftInRoad = inRoad(gx + a.tx * probeDist, gz + a.tz * probeDist)
          const rightInRoad = inRoad(gx - a.tx * probeDist, gz - a.tz * probeDist)
          if (leftInRoad && rightInRoad) continue
          // Also check crosswalk zebra bars straddling the gap center directly (medians sit inside zebra bands)
          if (a.len <= 145 && nearCrosswalk(gx, gz, 130)) continue
        }

        const score = Math.abs(along - 410) + lat * 2 + Math.abs(a.len - b.len)
        if (score < bestScore) {
          bestScore = score
          bestJ = j
        }
      }

      if (bestJ < 0) continue
      const b = edges[bestJ]
      a.used = true
      b.used = true

      // Align endpoints by tangent direction so skewed narrow strips never form self-intersecting bowties
      const sameDir = a.tx * b.tx + a.tz * b.tz >= 0
      const q0: Pair = sameDir ? [b.ax, b.az] : [b.bx, b.bz]
      const q1: Pair = sameDir ? [b.bx, b.bz] : [b.ax, b.az]
      const quad: Pair[] = [[a.ax, a.az], [a.bx, a.bz], q1, q0]

      if (kind === 5) {
        addedPaths.push([5, quad])
      } else if (kind === 4) {
        const avgWidth = (a.len + b.len) * 0.5
        if (avgWidth < 55) {
          // Narrow collector verge (e.g. 0.22m): fill flush with asphalt crossing surface
          addedPaths.push([5, quad])
        } else {
          // Wide arterial planted verge (e.g. 2.2m): flush stone pedestrian crossing apron
          flushPaths.push([1, quad])
        }
      } else {
        // Split roadside sidewalk (kind=1): restore continuous sidewalk & suppress interior seam curbs
        addedPaths.push([1, quad])
        skipCurbEdges.add(curbEdgeKeyCm(a.ax, a.az, a.bx, a.bz))
        skipCurbEdges.add(curbEdgeKeyCm(b.ax, b.az, b.bx, b.bz))
      }
      existingPaving.push({ shell: quad, holes: [], ...ringBounds(quad) })
      repairedStripGaps++
    }
  }

  return {
    paths: addedPaths.length ? [...outPaths, ...addedPaths] : outPaths,
    flushPaths,
    skipCurbEdges,
    repairedNotches,
    repairedStripGaps,
  }
}

// ============================================================================
// Part 2: Runtime Bridge Deck Gap Stitching & Hanging Abutment Landing
// ============================================================================

interface Vec3 {
  x: number
  y: number
  z: number
}

interface DeckEdge {
  comp: number
  tri: number
  a: Vec3
  b: Vec3
  mx: number
  my: number
  mz: number
  nx: number
  nz: number
  tx: number
  tz: number
  len: number
  thin: boolean
}

function vKey20(x: number, y: number, z: number): string {
  return `${Math.round(x * 20)},${Math.round(y * 20)},${Math.round(z * 20)}`
}

function vKeyXZ20(x: number, z: number): string {
  return `${Math.round(x * 20)},${Math.round(z * 20)}`
}

function onTileBorderM(ax: number, az: number, bx: number, bz: number): boolean {
  return (
    (ax <= 0.06 && bx <= 0.06) ||
    (ax >= 255.94 && bx >= 255.94) ||
    (az <= 0.06 && bz <= 0.06) ||
    (az >= 255.94 && bz >= 255.94)
  )
}

function pointBorderMask(x: number, z: number): number {
  let mask = 0
  if (x <= 0.06) mask |= 1
  if (x >= 255.94) mask |= 2
  if (z <= 0.06) mask |= 4
  if (z >= 255.94) mask |= 8
  return mask
}

function pushUpTri(out: number[], a: Vec3, b: Vec3, c: Vec3): boolean {
  const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z)
  if (Math.abs(ny) < 1e-4) return false
  if (ny > 0) {
    out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
  } else {
    out.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z)
  }
  return true
}

function evalRoadCtrlLocal([baseMm, deltas]: RoadCtrl, lx: number, lz: number): number {
  const u = lx / 8 + 1, v = lz / 8 + 1
  const ic = Math.min(32, Math.max(1, Math.floor(u))), ir = Math.min(32, Math.max(1, Math.floor(v)))
  const tu = Math.min(1, Math.max(0, u - ic)), tv = Math.min(1, Math.max(0, v - ir))
  const omU = 1 - tu, omV = 1 - tv
  const wu = [(omU * omU * omU) / 6, (3 * tu * tu * tu - 6 * tu * tu + 4) / 6, (-3 * tu * tu * tu + 3 * tu * tu + 3 * tu + 1) / 6, (tu * tu * tu) / 6]
  const wv = [(omV * omV * omV) / 6, (3 * tv * tv * tv - 6 * tv * tv + 4) / 6, (-3 * tv * tv * tv + 3 * tv * tv + 3 * tv + 1) / 6, (tv * tv * tv) / 6]
  let sum = 0
  for (let dr = 0; dr < 4; dr++) {
    const rOff = (ir - 1 + dr) * 35, wr = wv[dr]
    for (let dc = 0; dc < 4; dc++) sum += wr * wu[dc] * deltas[rOff + ic - 1 + dc]
  }
  return (baseMm + sum) / 1000
}

type FrontageBuilding = readonly [number,number,Pair[][],number,number,number,...unknown[]]

export const isRenminTile=(x:number,z:number)=>x===-768&&z===256

function meshHeight(field:Int16Array,east:number,south:number,step:number){
  const column=Math.min(256/step-1,Math.floor(east/step)),row=Math.min(256/step-1,Math.floor(south/step))
  const u=east/step-column,v=south/step-row,stride=step/4,index=(65*row+column)*stride
  const northWest=field[index],northEast=field[index+stride],southWest=field[index+65*stride],southEast=field[index+66*stride]
  return (u+v<=1?northWest+(northEast-northWest)*u+(southWest-northWest)*v:southEast+(southWest-southEast)*(1-u)+(northEast-southEast)*(1-v))/10
}

export function gradeRenminShoulder(tileX:number,tileZ:number,terrain:Int16Array,underlay:Int16Array,water:Int16Array,ctrl:RoadCtrl|null|undefined,buildings:readonly FrontageBuilding[]){
  if(!isRenminTile(tileX,tileZ)||!ctrl)return
  const before=underlay.slice(),step=water.some(value=>value!==-32768)?4:8
  const fronts=buildings.filter(part=>[4042625074,1145105554,435677566].includes(part[5]))
  for(const [base,,[ring]] of fronts){
    const bounds=ringBounds(ring)
    const limit=(east:number,south:number)=>{
      let distance=Infinity
      for(let index=0;index<ring.length;index++){
        const [ax,az]=ring[index], [bx,bz]=ring[(index+1)%ring.length], dx=bx-ax,dz=bz-az
        const along=Math.max(0,Math.min(1,((east*100-ax)*dx+(south*100-az)*dz)/(dx*dx+dz*dz||1)))
        distance=Math.min(distance,Math.hypot(east*100-ax-along*dx,south*100-az-along*dz)/100)
      }
      return base/10+Math.max(0,distance-8)*.075
    }
    const visit=(step:number,apply:(east:number,south:number,cap:number)=>void)=>{
      for(let south=Math.max(step,Math.floor((bounds.minZ/100-44)/step)*step);south<=Math.min(256-step,bounds.maxZ/100+44);south+=step){
        for(let east=Math.max(step,Math.floor((bounds.minX/100-44)/step)*step);east<=Math.min(256-step,bounds.maxX/100+44);east+=step){
          if(water[south/4*65+east/4]===-32768)apply(east,south,limit(east,south))
        }
      }
    }
    visit(4,(east,south,cap)=>{
      const index=south/4*65+east/4,height=Math.round(cap*10)
      terrain[index]=Math.min(terrain[index],height)
      underlay[index]=Math.min(underlay[index],height)
    })
    visit(8,(east,south,cap)=>{
      const index=(south/8+1)*35+east/8+1
      ctrl[1][index]=Math.min(ctrl[1][index],Math.round((cap-.10)*1000)-ctrl[0])
    })
  }
  const after=underlay.slice()
  const lowering=(east:number,south:number)=>meshHeight(before,east,south,step)-meshHeight(after,east,south,step)
  return {lowering,rootHeight:(east:number,south:number,baked:number)=>lowering(east,south)>0?meshHeight(after,east,south,step):baked}
}

function extractDeckComponentsAndOpenEdges(deck: Float32Array, thin: ReadonlySet<number>) {
  const tris = Math.floor(deck.length / 9)
  const parent = new Int32Array(tris)
  for (let i = 0; i < tris; i++) parent[i] = i
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]]
      a = parent[a]
    }
    return a
  }
  const vmap = new Map<string, number>()
  for (let i = 0; i < tris; i++) {
    for (let k = 0; k < 3; k++) {
      const o = i * 9 + k * 3
      const key = vKey20(deck[o], deck[o + 1], deck[o + 2])
      const prev = vmap.get(key)
      if (prev !== undefined) {
        const ra = find(i), rb = find(prev)
        if (ra !== rb) parent[rb] = ra
      } else {
        vmap.set(key, i)
      }
    }
  }

  const compMap = new Map<number, number[]>()
  for (let i = 0; i < tris; i++) {
    const r = find(i)
    let list = compMap.get(r)
    if (!list) { list = []; compMap.set(r, list) }
    list.push(i)
  }

  const compList = [...compMap.values()]
  const compEdges: DeckEdge[][] = []
  const compAxis: Pair[] = []

  for (let ci = 0; ci < compList.length; ci++) {
    const list = compList[ci]
    const emap = new Map<string, { a: number; b: number; c: number; tri: number; cnt: number }>()
    let meanX = 0, meanZ = 0, vc = 0
    for (const ti of list) {
      for (let k = 0; k < 3; k++) {
        const a = ti * 9 + k * 3
        const b = ti * 9 + ((k + 1) % 3) * 3
        const c = ti * 9 + ((k + 2) % 3) * 3
        meanX += deck[a]; meanZ += deck[a + 2]; vc++
        const ka = vKey20(deck[a], deck[a + 1], deck[a + 2])
        const kb = vKey20(deck[b], deck[b + 1], deck[b + 2])
        const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
        const seen = emap.get(id)
        if (seen) seen.cnt++
        else emap.set(id, { a, b, c, tri: ti, cnt: 1 })
      }
    }
    meanX /= Math.max(1, vc); meanZ /= Math.max(1, vc)
    let sxx = 0, sxz = 0, szz = 0
    for (const ti of list) {
      for (let k = 0; k < 3; k++) {
        const dx = deck[ti * 9 + k * 3] - meanX
        const dz = deck[ti * 9 + k * 3 + 2] - meanZ
        sxx += dx * dx; sxz += dx * dz; szz += dz * dz
      }
    }
    const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz)
    compAxis.push([Math.cos(angle), Math.sin(angle)])

    const open: DeckEdge[] = []
    for (const e of emap.values()) {
      if (e.cnt !== 1) continue
      const ax = deck[e.a], ay = deck[e.a + 1], az = deck[e.a + 2]
      const bx = deck[e.b], by = deck[e.b + 1], bz = deck[e.b + 2]
      const cx = deck[e.c], cz = deck[e.c + 2]
      if (onTileBorderM(ax, az, bx, bz)) continue
      const ex = bx - ax, ez = bz - az
      const len = Math.hypot(ex, ez)
      if (len < 0.2) continue
      const tx = ex / len, tz = ez / len
      let nx = -tz, nz = tx
      const mx = (ax + bx) * 0.5, mz = (az + bz) * 0.5
      if ((cx - mx) * nx + (cz - mz) * nz > 0) { nx = -nx; nz = -nz }
      open.push({
        comp: ci,
        tri: e.tri,
        a: { x: ax, y: ay, z: az },
        b: { x: bx, y: by, z: bz },
        mx,
        my: (ay + by) * 0.5,
        mz,
        nx,
        nz,
        tx,
        tz,
        len,
        thin: thin.has(e.tri),
      })
    }
    compEdges.push(open)
  }

  return { compList, compEdges, compAxis }
}

function dedupeSortedChain(pts: Vec3[], axisX: number, axisZ: number): Vec3[] {
  const seen = new Set<string>()
  const unique: { p: Vec3; s: number }[] = []
  for (const p of pts) {
    const k = vKey20(p.x, p.y, p.z)
    if (seen.has(k)) continue
    seen.add(k)
    unique.push({ p, s: p.x * axisX + p.z * axisZ })
  }
  unique.sort((u, v) => u.s - v.s)
  return unique.map(u => u.p)
}

function zipperBridgeChains(chainA: Vec3[], chainB: Vec3[], out: number[]): number {
  if (chainA.length < 2 || chainB.length < 2) return 0
  let i = 0, j = 0, added = 0
  const maxI = chainA.length - 1, maxJ = chainB.length - 1
  while (i < maxI || j < maxJ) {
    if (i === maxI) {
      if (pushUpTri(out, chainA[i], chainB[j], chainB[j + 1])) added++
      j++
    } else if (j === maxJ) {
      if (pushUpTri(out, chainA[i], chainB[j], chainA[i + 1])) added++
      i++
    } else {
      const dA = Math.hypot(chainA[i + 1].x - chainB[j].x, chainA[i + 1].z - chainB[j].z)
      const dB = Math.hypot(chainA[i].x - chainB[j + 1].x, chainA[i].z - chainB[j + 1].z)
      if (dA <= dB) {
        if (pushUpTri(out, chainA[i], chainB[j], chainA[i + 1])) added++
        i++
      } else {
        if (pushUpTri(out, chainA[i], chainB[j], chainB[j + 1])) added++
        j++
      }
    }
  }
  return added
}

/**
 * Runtime repair for GL04 bridge decks:
 *  Phase A: Stitch open water chasms between parallel bridge decks (carriageway <-> flanking footbridge/twin span).
 *  Phase B: Extend hanging/unlanded bridge abutments smoothly onto solid dry bank / connecting road surface.
 */
export function repairBridgeDeck(
  deck: Float32Array,
  thin: Set<number>,
  tileX: number,
  tileZ: number,
  water: Int16Array,
  groundAt: (lx: number, lz: number) => number,
  streetPaths?: readonly StreetPath[],
  roadCtrl?: RoadCtrl | null,
  keepouts: readonly KeepoutZone[] = bridgeKeepouts,
): BridgeRepairResult {
  if (!deck.length) return { deck, thin, stitchedTriangles: 0, landedTriangles: 0 }

  const isWet = (lx: number, lz: number): boolean => {
    const c = Math.min(64, Math.max(0, Math.round(lx / 4)))
    const r = Math.min(64, Math.max(0, Math.round(lz / 4)))
    return water[r * 65 + c] !== -32768
  }

  const isWetNear = (lx: number, lz: number, radCells = 1): boolean => {
    const c0 = Math.min(64, Math.max(0, Math.round(lx / 4)))
    const r0 = Math.min(64, Math.max(0, Math.round(lz / 4)))
    for (let dr = -radCells; dr <= radCells; dr++) {
      const r = r0 + dr
      if (r < 0 || r > 64) continue
      for (let dc = -radCells; dc <= radCells; dc++) {
        const c = c0 + dc
        if (c < 0 || c > 64) continue
        if (water[r * 65 + c] !== -32768) return true
      }
    }
    return false
  }

  const inKeepout = (lx: number, lz: number): boolean => {
    const wx = tileX + lx, wz = tileZ + lz
    for (let i = 0; i < keepouts.length; i++) {
      const [kx, kz, kr] = keepouts[i]
      if ((wx - kx) * (wx - kx) + (wz - kz) * (wz - kz) <= kr * kr) return true
    }
    return false
  }

  // Build quick lookup for road/sidewalk surfaces so abutment extensions land cleanly on roads.
  const pavedPolys: PolyBox[] = []
  if (streetPaths) {
    for (const p of streetPaths) {
      if ((p[0] !== 0 && p[0] !== 1 && p[0] !== 5) || !p[1] || p[1].length < 3) continue
      const [, pShell, ...pHoles] = p
      const b = ringBounds(pShell)
      pavedPolys.push({ shell: pShell, holes: pHoles, ...b })
    }
  }
  const onPavedSurface = (lx: number, lz: number): boolean => {
    const cx = lx * 100, cz = lz * 100
    for (let i = 0; i < pavedPolys.length; i++) {
      if (pointInPolyBox(cx, cz, pavedPolys[i])) return true
    }
    return false
  }
  const roadTopAt = (lx: number, lz: number): number => {
    const g = groundAt(lx, lz)
    const base = roadCtrl ? Math.max(evalRoadCtrlLocal(roadCtrl, lx, lz), g) : g
    return base + 0.045
  }

  const extraTris: number[] = []
  const extraThinFlags: boolean[] = []
  let stitchedTriangles = 0

  // ------------------------------------------------------------------
  // Phase A: Stitch parallel bridge components separated by water chasm
  // Match each open edge ONLY to its nearest facing component so 3+ parallel
  // spans (A | B | C) bridge strictly A<->B and B<->C without overlapping A<->C.
  // ------------------------------------------------------------------
  const { compEdges } = extractDeckComponentsAndOpenEdges(deck, thin)

  const pairMatches = new Map<string, {
    ci: number; cj: number
    matchedA: Set<DeckEdge>; matchedB: Set<DeckEdge>
    wetCount: number; sumNx: number; sumNz: number; anyThin: boolean
  }>()

  for (let ci = 0; ci < compEdges.length; ci++) {
    for (const ea of compEdges[ci]) {
      if (inKeepout(ea.mx, ea.mz)) continue
      let bestSep = Infinity
      let bestCj = -1
      let bestEb: DeckEdge | null = null
      let bestWet = false

      for (let cj = 0; cj < compEdges.length; cj++) {
        if (cj === ci) continue
        for (const eb of compEdges[cj]) {
          if (inKeepout(eb.mx, eb.mz)) continue
          if (ea.nx * eb.nx + ea.nz * eb.nz > -0.88) continue
          if (Math.abs(ea.my - eb.my) > 1.2) continue
          const dx = eb.mx - ea.mx, dz = eb.mz - ea.mz
          const sep = dx * ea.nx + dz * ea.nz
          if (sep < 0.12 || sep > 14.5 || sep >= bestSep) continue
          const along = Math.abs(dx * (-ea.nz) + dz * ea.nx)
          if (along > (ea.len + eb.len) * 0.65 + 2.5) continue
          const qx = (ea.mx + eb.mx) * 0.5, qz = (ea.mz + eb.mz) * 0.5
          const isGapWet = isWet(qx, qz) || isWetNear(qx, qz, 1)
          const pairTouchesBorder =
            pointBorderMask(ea.a.x, ea.a.z) !== 0 ||
            pointBorderMask(ea.b.x, ea.b.z) !== 0 ||
            pointBorderMask(eb.a.x, eb.a.z) !== 0 ||
            pointBorderMask(eb.b.x, eb.b.z) !== 0
          const gq = groundAt(qx, qz)
          if (pairTouchesBorder) {
            // Across a 256m tile seam, only check water directly on the seam midpoint (shared identically by both tiles)
            const aB = pointBorderMask(ea.a.x, ea.a.z) ? ea.a : (pointBorderMask(ea.b.x, ea.b.z) ? ea.b : null)
            const bB = pointBorderMask(eb.a.x, eb.a.z) ? eb.a : (pointBorderMask(eb.b.x, eb.b.z) ? eb.b : null)
            const seamWet = aB && bB ? isWet((aB.x + bB.x) * 0.5, (aB.z + bB.z) * 0.5) : isWet(qx, qz)
            if (!seamWet) continue
          } else if (!isGapWet && ea.my - gq < 1.2) {
            continue
          }
          bestSep = sep
          bestCj = cj
          bestEb = eb
          bestWet = isGapWet
        }
      }

      if (bestCj < 0 || !bestEb) continue
      const lo = Math.min(ci, bestCj), hi = Math.max(ci, bestCj)
      const pKey = `${lo}|${hi}`
      let rec = pairMatches.get(pKey)
      if (!rec) {
        rec = { ci: lo, cj: hi, matchedA: new Set(), matchedB: new Set(), wetCount: 0, sumNx: 0, sumNz: 0, anyThin: false }
        pairMatches.set(pKey, rec)
      }
      if (ci === lo) {
        rec.matchedA.add(ea); rec.matchedB.add(bestEb)
        rec.sumNx += ea.nx; rec.sumNz += ea.nz
      } else {
        rec.matchedA.add(bestEb); rec.matchedB.add(ea)
        rec.sumNx += bestEb.nx; rec.sumNz += bestEb.nz
      }
      if (bestWet) rec.wetCount++
      if (ea.thin || bestEb.thin) rec.anyThin = true
    }
  }

  // Track exact longitudinal span axes learned from stitched parallel bridges
  const stitchedAxes: { mx: number; mz: number; ax: number; az: number }[] = []

  for (const rec of pairMatches.values()) {
    const { ci, cj, matchedA, matchedB, wetCount, sumNx, sumNz, anyThin } = rec
    const edgesA = compEdges[ci], edgesB = compEdges[cj]

    // Strictly require water along the gap (never bridge dry twin highway/rail viaducts!)
    if (matchedA.size < 1 || matchedB.size < 1 || wetCount === 0) continue
    const totalMatchedLen =
      [...matchedA].reduce((s, e) => s + e.len, 0) + [...matchedB].reduce((s, e) => s + e.len, 0)
    if (totalMatchedLen < 3.5) continue

    const nLen = Math.hypot(sumNx, sumNz)
    if (nLen < 1e-4) continue
    const avgNx = sumNx / nLen, avgNz = sumNz / nLen
    const axisX = -avgNz, axisZ = avgNx

    // Expand matched edge sets along contiguous same-normal side edges up to tile borders
    // so skewed bridges crossing a 256m chunk boundary meet seamlessly at the exact border vertices.
    const expandSideEdges = (all: DeckEdge[], seed: Set<DeckEdge>, targetNx: number, targetNz: number) => {
      const verts = new Set<string>()
      for (const e of seed) {
        verts.add(vKey20(e.a.x, e.a.y, e.a.z))
        verts.add(vKey20(e.b.x, e.b.y, e.b.z))
      }
      let grew = true
      while (grew) {
        grew = false
        for (const e of all) {
          if (seed.has(e)) continue
          if (e.nx * targetNx + e.nz * targetNz < 0.90) continue
          const ka = vKey20(e.a.x, e.a.y, e.a.z), kb = vKey20(e.b.x, e.b.y, e.b.z)
          if (verts.has(ka) || verts.has(kb)) {
            const bMaskA = pointBorderMask(e.a.x, e.a.z), bMaskB = pointBorderMask(e.b.x, e.b.z)
            const touchesBorder = bMaskA !== 0 || bMaskB !== 0
            // At 256m tile borders, probe into the gap along the border so wet chasms reach the seam
            // symmetrically on both tiles (dry seams are stripped symmetrically by sharedLoBorder/sharedHiBorder).
            const seamPt = bMaskA !== 0 ? e.a : e.b
            const bMask = bMaskA !== 0 ? bMaskA : bMaskB
            const sx = (bMask & 3) ? seamPt.x : Math.min(256, Math.max(0, seamPt.x + targetNx * 4))
            const sz = (bMask & 12) ? seamPt.z : Math.min(256, Math.max(0, seamPt.z + targetNz * 4))
            const wetOrDrop = touchesBorder
              ? (isWet(seamPt.x, seamPt.z) || isWet(sx, sz))
              : (isWetNear(e.mx, e.mz, 1) || e.my - groundAt(e.mx, e.mz) > 0.45)
            if (wetOrDrop) {
              seed.add(e)
              verts.add(ka); verts.add(kb)
              grew = true
            }
          }
        }
      }
    }
    expandSideEdges(edgesA, matchedA, avgNx, avgNz)
    expandSideEdges(edgesB, matchedB, -avgNx, -avgNz)

    const ptsA: Vec3[] = []
    for (const e of matchedA) ptsA.push(e.a, e.b)
    const ptsB: Vec3[] = []
    for (const e of matchedB) ptsB.push(e.a, e.b)
    let chainA = dedupeSortedChain(ptsA, axisX, axisZ)
    let chainB = dedupeSortedChain(ptsB, axisX, axisZ)
    if (chainA.length < 2 || chainB.length < 2) continue

    // Trim excessive non-border overhang so one much-longer span doesn't pull skewed diagonals
    const sOf = (p: Vec3) => p.x * axisX + p.z * axisZ
    let sharedLoBorder = (pointBorderMask(chainA[0].x, chainA[0].z) & pointBorderMask(chainB[0].x, chainB[0].z)) !== 0
    let sharedHiBorder =
      (pointBorderMask(chainA[chainA.length - 1].x, chainA[chainA.length - 1].z) &
        pointBorderMask(chainB[chainB.length - 1].x, chainB[chainB.length - 1].z)) !== 0
    if (sharedLoBorder && !isWet((chainA[0].x + chainB[0].x) * 0.5, (chainA[0].z + chainB[0].z) * 0.5)) {
      if (chainA.length > 2) chainA = chainA.slice(1)
      if (chainB.length > 2) chainB = chainB.slice(1)
      sharedLoBorder = false
    }
    if (
      sharedHiBorder &&
      !isWet(
        (chainA[chainA.length - 1].x + chainB[chainB.length - 1].x) * 0.5,
        (chainA[chainA.length - 1].z + chainB[chainB.length - 1].z) * 0.5,
      )
    ) {
      if (chainA.length > 2) chainA = chainA.slice(0, -1)
      if (chainB.length > 2) chainB = chainB.slice(0, -1)
      sharedHiBorder = false
    }
    if (!sharedLoBorder) {
      const loCut = Math.max(sOf(chainA[0]), sOf(chainB[0])) - 3.5
      chainA = chainA.filter((p, idx) => idx === chainA.length - 1 || sOf(p) >= loCut || sOf(chainA[idx + 1]) >= loCut)
      chainB = chainB.filter((p, idx) => idx === chainB.length - 1 || sOf(p) >= loCut || sOf(chainB[idx + 1]) >= loCut)
    }
    if (!sharedHiBorder) {
      const hiCut = Math.min(sOf(chainA[chainA.length - 1]), sOf(chainB[chainB.length - 1])) + 3.5
      chainA = chainA.filter((p, idx) => idx === 0 || sOf(p) <= hiCut || sOf(chainA[idx - 1]) <= hiCut)
      chainB = chainB.filter((p, idx) => idx === 0 || sOf(p) <= hiCut || sOf(chainB[idx - 1]) <= hiCut)
    }

    const startLen = extraTris.length
    const added = zipperBridgeChains(chainA, chainB, extraTris)
    if (added > 0) {
      stitchedTriangles += added
      for (let k = 0; k < (extraTris.length - startLen) / 9; k++) extraThinFlags.push(anyThin)
      const midA = chainA[Math.floor(chainA.length / 2)]
      const midB = chainB[Math.floor(chainB.length / 2)]
      stitchedAxes.push({ mx: (midA.x + midB.x) * 0.5, mz: (midA.z + midB.z) * 0.5, ax: axisX, az: axisZ })
    }
  }

  // Merge Phase A additions into intermediate deck before Phase B abutment landing
  const baseTrisCount = Math.floor(deck.length / 9)
  let mergedDeck = deck
  let mergedThin = thin
  if (extraTris.length) {
    mergedDeck = new Float32Array(deck.length + extraTris.length)
    mergedDeck.set(deck)
    mergedDeck.set(extraTris, deck.length)
    mergedThin = new Set(thin)
    for (let k = 0; k < extraThinFlags.length; k++) {
      if (extraThinFlags[k]) mergedThin.add(baseTrisCount + k)
    }
  }

  // ------------------------------------------------------------------
  // Phase B: Land hanging / unlanded bridge abutments onto dry bank/road
  // Uses local topological abutment-corner verification (flanks turn ~90°
  // backward into the bridge) so curved/zigzag footbridge side edges are
  // never mistaken for bridge end-caps.
  // ------------------------------------------------------------------
  const postA = extractDeckComponentsAndOpenEdges(mergedDeck, mergedThin)
  const landTris: number[] = []
  const landThinFlags: boolean[] = []
  let landedTriangles = 0

  for (let ci = 0; ci < postA.compEdges.length; ci++) {
    const openEdges = postA.compEdges[ci]
    if (!openEdges.length) continue

    // Build vertex -> incident open edges adjacency for local flank-corner checking
    const vertEdges = new Map<string, DeckEdge[]>()
    for (const e of openEdges) {
      for (const p of [e.a, e.b]) {
        const k = vKeyXZ20(p.x, p.z)
        let list = vertEdges.get(k)
        if (!list) { list = []; vertEdges.set(k, list) }
        list.push(e)
      }
    }

    // Collect candidate hanging open edges (non-border, over water or steep wet-adjacent bank)
    const hangingEdges: DeckEdge[] = []
    for (const e of openEdges) {
      if (inKeepout(e.mx, e.mz)) continue
      if (e.len < 0.45 || e.len > 26) continue
      if (pointBorderMask(e.a.x, e.a.z) !== 0 || pointBorderMask(e.b.x, e.b.z) !== 0) continue
      const dropA = e.a.y - groundAt(e.a.x, e.a.z)
      const dropM = e.my - groundAt(e.mx, e.mz)
      const dropB = e.b.y - groundAt(e.b.x, e.b.z)
      const isHanging =
        isWet(e.mx, e.mz) ||
        isWet(e.a.x, e.a.z) ||
        isWet(e.b.x, e.b.z) ||
        dropM > 0.40 ||
        Math.max(dropA, dropB) > 0.65
      if (!isHanging) continue
      if (!isWetNear(e.mx, e.mz, 2) && !isWetNear(e.a.x, e.a.z, 2) && !isWetNear(e.b.x, e.b.z, 2)) continue
      hangingEdges.push(e)
    }

    if (!hangingEdges.length) continue

    // Group connected hanging edges with compatible outward normals into abutment cap chains
    const visited = new Uint8Array(hangingEdges.length)
    for (let i = 0; i < hangingEdges.length; i++) {
      if (visited[i]) continue
      const group: DeckEdge[] = [hangingEdges[i]]
      visited[i] = 1
      let expanded = true
      while (expanded) {
        expanded = false
        for (let j = 0; j < hangingEdges.length; j++) {
          if (visited[j]) continue
          const cand = hangingEdges[j]
          if (group.some(g =>
            (g.nx * cand.nx + g.nz * cand.nz > 0.72) &&
            (vKeyXZ20(g.a.x, g.a.z) === vKeyXZ20(cand.a.x, cand.a.z) ||
              vKeyXZ20(g.a.x, g.a.z) === vKeyXZ20(cand.b.x, cand.b.z) ||
              vKeyXZ20(g.b.x, g.b.z) === vKeyXZ20(cand.a.x, cand.a.z) ||
              vKeyXZ20(g.b.x, g.b.z) === vKeyXZ20(cand.b.x, cand.b.z)),
          )) {
            group.push(cand)
            visited[j] = 1
            expanded = true
          }
        }
      }

      // Compute unified outward direction of this cap group
      let dirX = 0, dirZ = 0
      for (const e of group) { dirX += e.nx * e.len; dirZ += e.nz * e.len }
      const dLen = Math.hypot(dirX, dirZ)
      if (dLen < 1e-4) continue
      dirX /= dLen; dirZ /= dLen

      // Local abutment-cap topology verification:
      // Find the two outer end vertices of `group` (degree 1 within `group`).
      // For a TRUE bridge end-cap, BOTH outer vertices must connect to non-group bridge side edges
      // that run backward into the deck (`dot(flankAwayFromCap, -dir) > 0.55`).
      // Side edges of curved/zigzag bridges fail this check because their flanks continue sideways!
      const groupSet = new Set(group)
      const deg = new Map<string, { p: Vec3; count: number }>()
      for (const e of group) {
        for (const p of [e.a, e.b]) {
          const k = vKeyXZ20(p.x, p.z)
          const cur = deg.get(k)
          if (cur) cur.count++; else deg.set(k, { p, count: 1 })
        }
      }
      const outerVerts = [...deg.entries()].filter(([, v]) => v.count === 1)
      if (outerVerts.length !== 2) continue
      let backwardFlanks = 0
      for (const [vk, { p }] of outerVerts) {
        const inc = (vertEdges.get(vk) ?? []).filter(oe => !groupSet.has(oe))
        const hasBackFlank = inc.some(oe => {
          const other = vKeyXZ20(oe.a.x, oe.a.z) === vk ? oe.b : oe.a
          const fx = other.x - p.x, fz = other.z - p.z
          const flen = Math.hypot(fx, fz)
          if (flen < 0.2) return false
          // Flank edge points backward along -dir (into the bridge span), OR continues onto dry abutment cap
          const backDot = (fx * (-dirX) + fz * (-dirZ)) / flen
          return backDot > 0.55
        })
        if (hasBackFlank) backwardFlanks++
      }
      // Require at least BOTH outer corners to turn back, OR 1 back-turning flank + 1 dry-landed cap continuation
      // (the latter occurs when a hanging footbridge + stitched gap meets a dry-landed carriageway cap!).
      if (backwardFlanks < 1) continue
      if (backwardFlanks === 1) {
        // Verify the non-back-turning outer vertex connects to a landed cap edge (facing same outward dir)
        let hasDryCapCont = false
        for (const [vk] of outerVerts) {
          const inc = (vertEdges.get(vk) ?? []).filter(oe => !groupSet.has(oe))
          if (inc.some(oe => oe.nx * dirX + oe.nz * dirZ > 0.75)) hasDryCapCont = true
        }
        if (!hasDryCapCont) continue
      }

      // Trace a clean dry-land/road landing point for each unique vertex in this abutment group
      const landed = new Map<string, { target: Vec3; dist: number } | null>()
      const findLanding = (p: Vec3, allowRoadSnapIfDry: boolean): { target: Vec3; dist: number } | null => {
        const key = vKey20(p.x, p.y, p.z)
        if (landed.has(key)) return landed.get(key)!

        const startDrop = p.y - groundAt(p.x, p.z)
        let firstDryDist = !isWet(p.x, p.z) && startDrop <= 0.25 ? 0 : -1
        let bestDist = -1
        let bestY = p.y

        for (let d = 0.5; d <= 16.0; d += 0.5) {
          const qx = p.x + dirX * d, qz = p.z + dirZ * d
          if (qx < 0.2 || qx > 255.8 || qz < 0.2 || qz > 255.8) break
          if (isWet(qx, qz)) {
            firstDryDist = -1
            continue
          }
          const gy = groundAt(qx, qz)
          const diff = p.y - gy
          if (diff <= 0.28 && diff >= -2.5) {
            if (firstDryDist < 0) firstDryDist = d
            if (onPavedSurface(qx, qz)) {
              const ext = Math.min(16.0, d + 0.8)
              const ex = Math.min(255.8, Math.max(0.2, p.x + dirX * ext))
              const ez = Math.min(255.8, Math.max(0.2, p.z + dirZ * ext))
              bestDist = ext
              // Tuck 1.5cm under asphalt top so bridge apron never casts an overhanging edge step
              bestY = Math.min(p.y, roadTopAt(ex, ez) - 0.015)
              break
            }
            if (bestDist < 0 && d >= firstDryDist + 1.0 && (firstDryDist > 0 || !allowRoadSnapIfDry)) {
              bestDist = d
              bestY = Math.min(p.y, gy + 0.02)
            }
          }
          if (firstDryDist === 0 && d > 3.5) break
          if (bestDist >= 0 && firstDryDist >= 0 && d > firstDryDist + 7.0) break
        }

        const res = bestDist > 0.4
          ? { target: { x: p.x + dirX * bestDist, y: bestY, z: p.z + dirZ * bestDist }, dist: bestDist }
          : (firstDryDist === 0 ? { target: { x: p.x, y: p.y, z: p.z }, dist: 0 } : null)
        landed.set(key, res)
        return res
      }

      for (const e of group) {
        const laRaw = findLanding(e.a, true)
        const lbRaw = findLanding(e.b, true)
        if (!laRaw || !lbRaw) continue
        let la = { target: { ...laRaw.target }, dist: laRaw.dist }
        let lb = { target: { ...lbRaw.target }, dist: lbRaw.dist }
        if (la.dist < 0.4 && lb.dist < 0.4) {
          // If both corners are dry but the edge midpoint hangs over a riverbank pocket, land the edge cleanly.
          if (e.my - groundAt(e.mx, e.mz) > 0.45) {
            const lm = findLanding({ x: e.mx, y: e.my, z: e.mz }, false)
            if (lm && lm.dist >= 0.4 && lm.dist <= 6.0) {
              const dExt = lm.dist
              la = {
                dist: dExt,
                target: { x: e.a.x + dirX * dExt, y: Math.min(e.a.y, groundAt(e.a.x + dirX * dExt, e.a.z + dirZ * dExt) + 0.02), z: e.a.z + dirZ * dExt },
              }
              lb = {
                dist: dExt,
                target: { x: e.b.x + dirX * dExt, y: Math.min(e.b.y, groundAt(e.b.x + dirX * dExt, e.b.z + dirZ * dExt) + 0.02), z: e.b.z + dirZ * dExt },
              }
            } else continue
          } else continue
        }
        if (Math.abs(la.dist - lb.dist) > 12.0) continue

        const maxD = Math.max(la.dist, lb.dist)
        const steps = Math.max(1, Math.ceil(maxD / 2.5))
        let prevA = e.a, prevB = e.b
        for (let s = 1; s <= steps; s++) {
          const t = s / steps
          const nextA: Vec3 = {
            x: e.a.x + (la.target.x - e.a.x) * t,
            y: e.a.y + (la.target.y - e.a.y) * t,
            z: e.a.z + (la.target.z - e.a.z) * t,
          }
          const nextB: Vec3 = {
            x: e.b.x + (lb.target.x - e.b.x) * t,
            y: e.b.y + (lb.target.y - e.b.y) * t,
            z: e.b.z + (lb.target.z - e.b.z) * t,
          }
          const startL = landTris.length
          if (pushUpTri(landTris, prevA, prevB, nextB)) landedTriangles++
          if (pushUpTri(landTris, prevA, nextB, nextA)) landedTriangles++
          for (let k = 0; k < (landTris.length - startL) / 9; k++) landThinFlags.push(e.thin)
          prevA = nextA
          prevB = nextB
        }
      }
    }
  }

  if (!landTris.length) {
    return { deck: mergedDeck, thin: mergedThin, stitchedTriangles, landedTriangles: 0 }
  }

  const finalBase = Math.floor(mergedDeck.length / 9)
  const finalDeck = new Float32Array(mergedDeck.length + landTris.length)
  finalDeck.set(mergedDeck)
  finalDeck.set(landTris, mergedDeck.length)
  const finalThin = new Set(mergedThin)
  for (let k = 0; k < landThinFlags.length; k++) {
    if (landThinFlags[k]) finalThin.add(finalBase + k)
  }

  return { deck: finalDeck, thin: finalThin, stitchedTriangles, landedTriangles }
}
