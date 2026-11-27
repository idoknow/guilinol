// IDOK-399 — where the short bollards at a signalised junction stand.
//
// Pure TypeScript: no three.js, no DOM. `bollards.ts` turns the result into one instanced mesh; node
// tests import this file directly.
//
// Signalised junctions usually have a row of low posts along the pavement edge next to the signal
// pole, to keep cars from cutting the corner over the pavement. Nothing in the world data says where
// they are, so they follow the signal heads: a few posts either side of each pole, along the same
// kerb, each one checked against the street surface on its own so a row never runs round a corner,
// across a gap in the kerb or onto a verge.
import {approachHeight, kerbDistance, pieceAt, type HeadPlacement, type SignalApproach, type SurfaceAt} from './signal-approach'

export type Bollard = {
  /** `${approach.key}#${signed index}`, e.g. `'12>34#-2'`: stable across sessions and road-network rebuilds. */
  key: string
  /** Base of the post. `y` is the road height from the world data; the pavement is read at run time. */
  x: number
  y: number
  z: number
  /** Same frame as the signal pole of the approach. */
  yaw: number
}

/** Distance between neighbouring posts along the kerb, metres. */
export const BOLLARD_SPACING = 1.5
/** Posts each side of the pole. */
const PER_SIDE = 2
/** Post centre behind the kerb line: clear of a car's wheel, still on the pavement edge. */
export const BOLLARD_INSET = .4
/** Clear space between two posts: a wheelchair, a pram, a bicycle pushed by hand still gets through. */
export const BOLLARD_MIN_GAP = 1.2
export const BOLLARD_HEIGHT = .75
export const BOLLARD_RADIUS = .07
/** Centre to centre, from the clear gap and the posts' own width. */
const BOLLARD_SEPARATION = BOLLARD_MIN_GAP + 2 * BOLLARD_RADIUS
/** No post right up against the signal pole: the pole's push button and anyone using it need the room. */
const POLE_CLEARANCE = 1.2
/** Closer to the node than this is inside the junction mouth, where the kerb is already curving. */
const BACK_MIN = 2
/** Room left at the far end of the approach, so a post never sits exactly on where its path stops. */
const REACH_MARGIN = .5
/** The kerb has moved this far from where the pole found it: a corner, a lay-by, a driveway. */
const KERB_DRIFT = .75

const SURFACE_ROAD = 0
const SURFACE_GREEN = 4
const SURFACE_GUARDRAIL = 5

/**
 * Pavement, paving, or ground the street tiles say nothing about — which is what lies behind most
 * kerbs in this data: the street surface stops at the kerb and the block beyond is plain ground.
 * Not carriageway, not a fenced strip, and not a planted verge: nobody sets posts in a flower bed.
 */
const standable = (kinds: readonly number[]) =>
  !kinds.includes(SURFACE_ROAD) && !kinds.includes(SURFACE_GUARDRAIL) && !kinds.includes(SURFACE_GREEN)

/**
 * The posts beside one signal pole: up to `PER_SIDE` each way along the kerb, `BOLLARD_SPACING`
 * apart. Each direction stops at the first post whose kerb has moved, or whose spot is road, fence
 * or verge — so the row ends at a corner or a gap instead of carrying on past it.
 *
 * `'pending'`: a street tile under one of the posts has not loaded; ask again later. Nothing is
 * returned piecemeal, so a half-loaded neighbourhood never leaves a row cut short for good.
 */
export function placeBollards(approach: SignalApproach, placement: HeadPlacement, surfaceAt: SurfaceAt): Bollard[] | 'pending' {
  const found: Bollard[] = []
  for (const sign of [-1, 1]) {
    for (let step = 1; step <= PER_SIDE; step++) {
      const back = placement.back + sign * step * BOLLARD_SPACING
      // Out of range only gets worse further out, so the whole direction ends here.
      if (back < BACK_MIN || back > approach.reach - REACH_MARGIN) break
      const kerb = kerbDistance(approach, back, surfaceAt)
      if (kerb === undefined) return 'pending'
      if (!Number.isFinite(kerb) || Math.abs(kerb - placement.kerb) > KERB_DRIFT) break
      const [segment, along] = pieceAt(approach, back)
      const side = segment.right + kerb + BOLLARD_INSET
      const x = segment.endX - segment.headingX * along - segment.headingZ * side
      const z = segment.endZ - segment.headingZ * along + segment.headingX * side
      const kinds = surfaceAt(x, z)
      if (!kinds) return 'pending'
      if (!standable(kinds)) break
      // Only on a bent approach can a post come this close to its own pole; skip it, keep the row.
      if ((x - placement.x) ** 2 + (z - placement.z) ** 2 < POLE_CLEARANCE ** 2) continue
      found.push({key: `${approach.key}#${sign * step}`, x, y: approachHeight(approach, back), z, yaw: placement.yaw})
    }
  }
  return found
}

const CELL = 2
const cellOf = (x: number, z: number) => (Math.floor(x / CELL) + 32768) * 65536 + Math.floor(z / CELL) + 32768

/** Anything in `grid` within `reach` (≤ `CELL`) of a point. */
function anyNear<T extends {x: number, z: number}>(grid: Map<number, T[]>, x: number, z: number, reach: number) {
  const col = Math.floor(x / CELL), row = Math.floor(z / CELL)
  for (let east = col - 1; east <= col + 1; east++) for (let south = row - 1; south <= row + 1; south++) {
    const bin = grid.get((east + 32768) * 65536 + south + 32768)
    if (bin) for (const item of bin) if ((item.x - x) ** 2 + (item.z - z) ** 2 < reach * reach) return true
  }
  return false
}

function binned<T extends {x: number, z: number}>(items: readonly T[]) {
  const grid = new Map<number, T[]>()
  for (const item of items) {
    const key = cellOf(item.x, item.z), bin = grid.get(key)
    if (bin) bin.push(item)
    else grid.set(key, [item])
  }
  return grid
}

/**
 * Drops posts that crowd each other or a signal pole, across approaches too: two approaches meeting
 * at a corner can both reach for the same piece of kerb. In a clash the post with the smaller key
 * stays, so the answer does not depend on the order the approaches were loaded in. Returned in key order.
 */
export function separateBollards(all: readonly Bollard[], poles: readonly {x: number, z: number}[]): Bollard[] {
  const order = [...all].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  const poleGrid = binned(poles)
  const kept: Bollard[] = [], keptGrid = new Map<number, Bollard[]>()
  for (const post of order) {
    if (anyNear(poleGrid, post.x, post.z, POLE_CLEARANCE)) continue
    if (anyNear(keptGrid, post.x, post.z, BOLLARD_SEPARATION)) continue
    kept.push(post)
    const key = cellOf(post.x, post.z), bin = keptGrid.get(key)
    if (bin) bin.push(post)
    else keptGrid.set(key, [post])
  }
  return kept
}

/** Two posts this close (centre to centre) clash. For callers that only re-separate what a change touched. */
export const BOLLARD_CLASH = BOLLARD_SEPARATION
/** A post this close to a signal pole is dropped. */
export const BOLLARD_POLE_CLEARANCE = POLE_CLEARANCE
