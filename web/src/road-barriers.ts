export const ROAD_BARRIER_STRIDE = 7

interface BarrierSpec {
  group: number
  offZ: number
  hz: number
  padX: number
  topOffset: number
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

// Blocking street decor kinds from pipeline/streets.py & street-worker.ts:
// - kind 1/2: arterial road median white guardrail / banner guardrail (merged together as group 1)
// - kind 5/6: motor/non-motor verge hedge + offset iron fence (kept separate per side)
// - kind 7: planted arterial median hedge
// - kind 8: frontage stone-pillar + iron fence
// Explicitly excluded: kind 3 (parked bikes), 4 (sign pole), 9 (low curb strip), 10 (yellow paint), 11 (single bollard).
// Heights clear walkConfig.step (0.62 m above baseLevel+0.195) while remaining below 3rd-person camera focus (~foot+1.4 m).
function barrierSpec(kind: number): BarrierSpec | null {
  if (kind === 1 || kind === 2) return {group: 1, offZ: 0, hz: .08, padX: 0, topOffset: 1.22}
  if (kind === 5) return {group: 5, offZ: .065, hz: .54, padX: .02, topOffset: 1.10}
  if (kind === 6) return {group: 6, offZ: -.065, hz: .54, padX: .02, topOffset: 1.10}
  if (kind === 7) return {group: 7, offZ: 0, hz: .37, padX: .02, topOffset: 1.10}
  if (kind === 8) return {group: 8, offZ: 0, hz: .14, padX: 0, topOffset: 1.44}
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

/**
 * Extracts compact, collinear-merged Rapier cuboid definitions for blocking road decor in one 256 m chunk.
 * Output stride is ROAD_BARRIER_STRIDE (7): [cx, cy, cz, hx, hy, hz, yaw] in chunk-local X/Z and world Y.
 */
export function buildRoadBarriers(
  decor: readonly (readonly number[])[],
  baseLevel: (x: number, z: number) => number,
): Float32Array {
  if (!decor.length) return new Float32Array(0)
  const raw: RawBarrier[] = []
  for (const item of decor) {
    const kind = item[0], east = item[1], south = item[2], heading = item[3], span = item[4] ?? 0
    const spec = barrierSpec(kind)
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
