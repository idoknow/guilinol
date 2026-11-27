// IDOK-399 — manhole covers and kerb gullies on the carriageway, worked out from the road graph.
//
// Pure TypeScript: no three.js, no DOM. `manhole-covers.ts` turns the result into one mesh; node tests
// import this file directly.
//
// The world data has no utility network, so the covers are a plausible scatter, not a survey: each
// motor lane gets round (and now and then square) covers in its wheel tracks about every 45 m, and
// gully seeds about every 30 m that the runtime moves out to the kerb on the right once it can see
// the street surface. Everything comes from integer hashes of the lane id, so the same graph gives
// the same covers on every machine, whatever order its lanes come in.

/** 0 round cast-iron cover, 1 kerb gully grate, 2 square cover. */
export type ManholeKind = 0 | 1 | 2

export type Manhole = {
  /** `x,z` rounded to 0.1 m, then `#kind`. Stable while the same graph is loaded. */
  key: string
  /** Cover centre; for a gully (kind 1) the seed on the lane centre line, before it is moved to the kerb. */
  x: number
  /** Road height from the world data's lane profile. */
  y: number
  z: number
  /** Unit direction of travel of the lane it sits in. */
  headingX: number
  headingZ: number
  kind: ManholeKind
  /** Turn of a round cover about its centre, radians (only kind 0 reads it: a round lid lies any way round). */
  spin: number
}

export type ManholeGraph = {
  nodes: {id: number, x: number, y: number, z: number}[]
  lanes: {id: number, from: number, to: number, width?: number, offset: number, kind: string, cls?: string, heights?: number[], gradeSeparated?: unknown}[]
  signals: {node: number}[]
}

/** Expected distance between covers (kinds 0 and 2) along one lane, metres. */
export const MANHOLE_SPACING = 45
/** Expected distance between gully seeds along one lane. */
export const MANHOLE_GRATE_SPACING = 30
/** No cover closer than this along the lane to an end that is a junction: the junction box stays clean. */
export const MANHOLE_JUNCTION_CLEAR = 10
/**
 * No cover closer than this to a signalised node in a straight line. The stop line and the zebra sit
 * half a road width plus 3 m out from the node; a cover on them would fight the paint.
 */
export const MANHOLE_SIGNAL_CLEAR = 18
/** No two covers closer than this: a real street does not put two lids side by side. */
export const MANHOLE_MIN_GAP = 3
/**
 * Covers sit this far to one side of the lane centre, in a wheel track: the centre carries the speed
 * numbers and arrows, the edges the lane lines.
 */
export const MANHOLE_TRACK_OFFSET = 1

/** Quad size per kind, `[across, along]` metres. The round one includes its concrete seat ring. */
export const MANHOLE_SIZE: readonly (readonly [across: number, along: number])[] = [[.8, .8], [.45, .75], [.6, .6]]
/** The texture is one row of three square cells, one per kind. */
export const MANHOLE_ATLAS_CELLS = 3
/**
 * Part of its cell, across, that each kind's quad maps to (`[from, to]` of the cell width; all of it
 * along). The gully is 0.6 as wide as it is long, so its picture fills only the middle 0.6 of its
 * square cell and the uvs take just that strip: no texels wasted on stretching, none transparent.
 */
export const MANHOLE_UV_ACROSS: readonly (readonly [from: number, to: number])[] = [[0, 1], [.2, .8], [0, 1]]

export const MANHOLE_VERTICES = 4
export const MANHOLE_INDICES = 6
/** Ground samples per cover: the four corners. */
export const MANHOLE_CORNERS = 4

const MIN_LANE = 6
const DEFAULT_WIDTH = 3
/** A cover stays this far inside the lane edge (half the round lid plus a little) when the lane is narrow. */
const EDGE_KEEP = .5
/** Track offsets smaller than this are not worth the hash: the cover goes on the centre line. */
const TRACK_MIN = .2
/**
 * A cover's centre stays this far from the line between two lanes of one road (the centre line of a
 * two-way street above all): half the lid, half the line, and the few decimetres by which the paint
 * baked into the street tiles strays from the graph.
 */
const LINE_KEEP = .75
const SQUARE_SHARE = .15
const SALT_COUNT = 1, SALT_ALONG = 2, SALT_SIDE = 3, SALT_KIND = 4, SALT_SPIN = 5, SALT_GRATE_COUNT = 6, SALT_GRATE_ALONG = 7

function fmix(h: number) {
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  return h ^ (h >>> 16)
}

/**
 * Uniform in [0, 1) from three integers. Integer-only (murmur3's finaliser), so every JavaScript
 * engine gives the same bits — unlike the usual `fract(sin(x) * 43758)`.
 */
export function manholeHash(a: number, b: number, salt: number) {
  let h = fmix(Math.imul(salt | 0, 0x9e3779b1) ^ (a | 0))
  h = fmix(h ^ Math.imul((b | 0) + 1, 0x85ebca77))
  return (h >>> 0) / 4294967296
}

/** Height of the lane profile at `t` (0 at `from`, 1 at `to`); the two node heights when there is no profile. */
function laneHeight(heights: number[] | undefined, startY: number, endY: number, t: number) {
  if (!heights || heights.length < 2) return startY + (endY - startY) * t
  if (t <= heights[0]) return heights[1]
  for (let index = 2; index < heights.length; index += 2) {
    if (t > heights[index]) continue
    const t0 = heights[index - 2], span = heights[index] - t0
    return span > 0 ? heights[index - 1] + (heights[index + 1] - heights[index - 1]) * (t - t0) / span : heights[index + 1]
  }
  return heights[heights.length - 1]
}

type Candidate = Manhole & {lane: number, index: number}

/** Covers before gullies, then by key; the rest only breaks ties between candidates that round alike. */
function priority(a: Manhole, b: Manhole) {
  return Number(a.kind === 1) - Number(b.kind === 1)
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    || a.x - b.x || a.z - b.z || a.headingX - b.headingX || a.headingZ - b.headingZ || a.spin - b.spin
}

const keyOf = (x: number, z: number, kind: ManholeKind) => `${x.toFixed(1)},${z.toFixed(1)}#${kind}`

/**
 * Drops covers closer than `MANHOLE_MIN_GAP` to one taken before them — covers before gullies, then
 * by key, so the outcome does not depend on the input order — and returns the rest sorted by key.
 * A grid of gap-sized cells keeps it linear. Also used on the union of two loaded cells.
 */
export function spacedManholes<T extends Manhole>(covers: readonly T[]): T[] {
  const order = [...covers].sort(priority)
  const cells = new Map<string, T[]>(), kept: T[] = [], gap2 = MANHOLE_MIN_GAP ** 2
  taking: for (const cover of order) {
    const column = Math.floor(cover.x / MANHOLE_MIN_GAP), row = Math.floor(cover.z / MANHOLE_MIN_GAP)
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const other of cells.get(`${column + dx},${row + dz}`) ?? []) {
        if ((other.x - cover.x) ** 2 + (other.z - cover.z) ** 2 < gap2) continue taking
      }
    }
    const key = `${column},${row}`, cell = cells.get(key)
    if (cell) cell.push(cover); else cells.set(key, [cover])
    kept.push(cover)
  }
  return kept.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : priority(a, b))
}

/** Covers and gully seeds for one road graph, sorted by key. Lanes whose nodes are missing are left out. */
export function manholes(graph: ManholeGraph): Manhole[] {
  const nodes = new Map<number, ManholeGraph['nodes'][number]>()
  for (const node of graph.nodes) if (!nodes.has(node.id)) nodes.set(node.id, node)
  const lanes = graph.lanes.filter(lane => lane.kind === 'motor' && !lane.gradeSeparated && lane.from !== lane.to && nodes.has(lane.from) && nodes.has(lane.to))
  // A node with three different neighbours is where roads meet; with two it is only a bend in one road,
  // and a road does not keep its covers away from its own bends.
  const neighbours = new Map<number, Set<number>>()
  const link = (a: number, b: number) => {
    let set = neighbours.get(a)
    if (!set) neighbours.set(a, set = new Set())
    set.add(b)
  }
  for (const lane of lanes) { link(lane.from, lane.to); link(lane.to, lane.from) }
  const signalled = new Set<number>()
  const signalCells = new Map<string, {x: number, z: number}[]>()
  for (const signal of graph.signals) {
    const node = nodes.get(signal.node)
    if (signalled.has(signal.node)) continue
    signalled.add(signal.node)
    if (!node) continue
    const key = `${Math.floor(node.x / MANHOLE_SIGNAL_CLEAR)},${Math.floor(node.z / MANHOLE_SIGNAL_CLEAR)}`, cell = signalCells.get(key)
    if (cell) cell.push(node); else signalCells.set(key, [node])
  }
  const junction = (id: number) => signalled.has(id) || (neighbours.get(id)?.size ?? 0) >= 3
  const nearSignal = (x: number, z: number) => {
    const column = Math.floor(x / MANHOLE_SIGNAL_CLEAR), row = Math.floor(z / MANHOLE_SIGNAL_CLEAR)
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const node of signalCells.get(`${column + dx},${row + dz}`) ?? []) {
        if ((node.x - x) ** 2 + (node.z - z) ** 2 < MANHOLE_SIGNAL_CLEAR ** 2) return true
      }
    }
    return false
  }

  // Every lane of one road, whatever it carries, by its pair of nodes: where two of them meet there is a painted line.
  const roads = new Map<string, ManholeGraph['lanes']>()
  const roadKey = (from: number, to: number) => from < to ? `${from}>${to}` : `${to}>${from}`
  for (const lane of graph.lanes) {
    const key = roadKey(lane.from, lane.to), road = roads.get(key)
    if (road) road.push(lane); else roads.set(key, [lane])
  }

  const candidates: Candidate[] = []
  for (const lane of lanes) {
    const start = nodes.get(lane.from)!, end = nodes.get(lane.to)!
    const dx = end.x - start.x, dz = end.z - start.z, length = Math.hypot(dx, dz)
    if (!(length >= MIN_LANE)) continue
    const headingX = dx / length, headingZ = dz / length, rightX = -headingZ, rightZ = headingX
    const offset = Number.isFinite(lane.offset) ? lane.offset : 0
    const originX = start.x + rightX * offset, originZ = start.z + rightZ * offset
    const width = lane.width && lane.width > 0 ? lane.width : DEFAULT_WIDTH
    let track = Math.min(MANHOLE_TRACK_OFFSET, width / 2 - EDGE_KEEP)
    if (track < TRACK_MIN) track = 0
    // Lane lines, as offsets from this lane's centre (positive = its right).
    const lines: number[] = []
    let twoWay = false
    for (const other of roads.get(roadKey(lane.from, lane.to))!) {
      if (other.from !== lane.from) twoWay = true
      if (other === lane || !Number.isFinite(other.offset)) continue
      const across = (other.from === lane.from ? other.offset : -other.offset) - offset
      if (Math.abs(across) > .1) lines.push(across / 2)
    }
    // The centre line of a two-way road is painted along the graph edge itself — also on the narrow
    // streets whose two directions share one lane beside it.
    if (twoWay) lines.push(-offset)
    const offLines = (side: number) => lines.every(line => Math.abs(side - line) >= LINE_KEEP)
    const clearFrom = junction(lane.from), clearTo = junction(lane.to)
    const place = (kind: ManholeKind, along: number, side: number, spin: number, index: number) => {
      if (clearFrom && along < MANHOLE_JUNCTION_CLEAR) return
      if (clearTo && length - along < MANHOLE_JUNCTION_CLEAR) return
      const x = originX + headingX * along + rightX * side, z = originZ + headingZ * along + rightZ * side
      if (nearSignal(x, z)) return
      const y = laneHeight(lane.heights, start.y, end.y, along / length)
      candidates.push({key: keyOf(x, z, kind), x, y, z, headingX, headingZ, kind, spin, lane: lane.id, index})
    }
    // Rounding the expected count up or down by a hash keeps the mean right on lanes far shorter than the spacing.
    const covers = Math.floor(length / MANHOLE_SPACING + manholeHash(lane.id, 0, SALT_COUNT))
    for (let index = 0; index < covers; index++) {
      const along = (index + .15 + .7 * manholeHash(lane.id, index, SALT_ALONG)) / covers * length
      // The wheel track the hash picks, unless a lane line runs under it: then the middle of the lane.
      const wheel = manholeHash(lane.id, index, SALT_SIDE) < .5 ? -track : track
      const side = offLines(wheel) ? wheel : 0
      const kind: ManholeKind = manholeHash(lane.id, index, SALT_KIND) < SQUARE_SHARE ? 2 : 0
      place(kind, along, side, manholeHash(lane.id, index, SALT_SPIN) * Math.PI * 2, index)
    }
    const grates = Math.floor(length / MANHOLE_GRATE_SPACING + manholeHash(lane.id, 0, SALT_GRATE_COUNT))
    for (let index = 0; index < grates; index++) {
      place(1, (index + .15 + .7 * manholeHash(lane.id, index, SALT_GRATE_ALONG)) / grates * length, 0, 0, covers + index)
    }
  }
  candidates.sort((a, b) => priority(a, b) || a.lane - b.lane || a.index - b.index)
  return spacedManholes(candidates).map(({lane: _lane, index: _index, ...cover}) => cover)
}

/** Unit along-axis of the quad: the heading, turned by `spin` for a round cover. */
function axis(m: Manhole, out: Float32Array) {
  if (m.kind !== 0 || !m.spin) { out[0] = m.headingX; out[1] = m.headingZ; return }
  const cos = Math.cos(m.spin), sin = Math.sin(m.spin)
  out[0] = m.headingX * cos - m.headingZ * sin
  out[1] = m.headingZ * cos + m.headingX * sin
}

const scratchAxis = new Float32Array(2)
const scratchCorners = new Float32Array(MANHOLE_CORNERS * 2)

/**
 * The four corners of a cover's quad as `x, z` pairs: rear-left, rear-right, front-right, front-left
 * (rear/front along the quad's axis, right = `-axisZ, axisX`). In that order the triangles `0 1 2,
 * 0 2 3` face up. These are the points whose ground height the quad is draped over.
 */
export function manholeCorners<T extends Float32Array | number[]>(m: Manhole, out: T): T {
  axis(m, scratchAxis)
  const alongX = scratchAxis[0], alongZ = scratchAxis[1], rightX = -alongZ, rightZ = alongX
  const [across, along] = MANHOLE_SIZE[m.kind], a = across / 2, l = along / 2
  out[0] = m.x - alongX * l - rightX * a; out[1] = m.z - alongZ * l - rightZ * a
  out[2] = m.x - alongX * l + rightX * a; out[3] = m.z - alongZ * l + rightZ * a
  out[4] = m.x + alongX * l + rightX * a; out[5] = m.z + alongZ * l + rightZ * a
  out[6] = m.x + alongX * l - rightX * a; out[7] = m.z + alongZ * l - rightZ * a
  return out
}

/**
 * Writes one cover's quad (`MANHOLE_VERTICES` vertices) at vertex `offset`: positions over the
 * ground `heights` at `manholeCorners` (same order), each corner its own, raised by `lift`; uvs on
 * the kind's cell of the 1×3 atlas, `u` left → right across the quad, `v` rear → front.
 */
export function writeManhole(m: Manhole, heights: ArrayLike<number>, lift: number, positions: Float32Array, uvs: Float32Array, offset: number) {
  manholeCorners(m, scratchCorners)
  const [from, to] = MANHOLE_UV_ACROSS[m.kind]
  const left = (m.kind + from) / MANHOLE_ATLAS_CELLS, right = (m.kind + to) / MANHOLE_ATLAS_CELLS
  for (let corner = 0; corner < MANHOLE_CORNERS; corner++) {
    const at = (offset + corner) * 3, uv = (offset + corner) * 2
    positions[at] = scratchCorners[corner * 2]
    positions[at + 1] = heights[corner] + lift
    positions[at + 2] = scratchCorners[corner * 2 + 1]
    uvs[uv] = corner === 0 || corner === 3 ? left : right
    uvs[uv + 1] = corner < 2 ? 0 : 1
  }
}
