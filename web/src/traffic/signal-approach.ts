// IDOK-399 — where a signal head stands, worked out from the road graph and the street surface.
//
// Pure TypeScript: no three.js, no DOM. `signal-heads.ts` turns the result into meshes; node tests
// import this file directly.
//
// An *approach* is one carriageway driving into a signalised junction. Each approach gets one head
// on the kerb to the driver's right, a few metres before the junction, facing oncoming traffic.
import type {SignalSpec} from './signals'

export type ApproachNode = {id: number, x: number, y: number, z: number}
export type ApproachLane = {id: number, from: number, to: number, offset: number, kind: string, cls?: string, heights?: number[], gradeSeparated?: string}
export type ApproachGraph = {nodes: ApproachNode[], lanes: ApproachLane[], signals: SignalSpec[]}

/** One straight piece of the carriageway leading to a signal. */
export type ApproachSegment = {
  /** The end nearer the signal. */
  endX: number
  endY: number
  endZ: number
  /** Unit heading of travel, towards the signal. */
  headingX: number
  headingZ: number
  length: number
  /** Lateral offset of the rightmost lane centre from the graph edge, metres, positive = driver's right. */
  right: number
  /** Road height along the piece as `[t, y, t, y, …]`, t from 0 (far end) to 1 (near end). */
  heights?: number[]
}

export type SignalApproach = {
  /** `${fromNode}>${signalNode}` — OSM node ids, stable across road-network rebuilds (lane ids are not). */
  key: string
  node: number
  group: number
  /** One lane of the approach. Every lane of an approach is served by the same phase. */
  lane: number
  lanes: number[]
  /** The signal node, where the lanes end. */
  endX: number
  endZ: number
  cls?: string
  /**
   * The carriageway walked backwards from the signal: the approach's own lanes first, then the one
   * road that feeds them, piece by piece. A pole is only ever placed along this line — never on a
   * straight line projected past where the road actually starts.
   */
  path: ApproachSegment[]
  /** Length of `path`, metres. */
  reach: number
}

/** Kinds reported by the street surface lookup (`world.ts` `buildSurfaceLookup`). */
const SURFACE_ROAD = 0
const SURFACE_GUARDRAIL = 5

/** `undefined` = that street tile has not loaded yet; an empty list = no street surface there. */
export type SurfaceAt = (x: number, z: number) => readonly number[] | undefined

export type HeadPlacement = {
  /** Pole base. */
  x: number
  y: number
  z: number
  /** Rotation about Y that turns local +Z towards oncoming drivers and local +X towards the kerb side. */
  yaw: number
  /** Length of the arm reaching over the road, metres; 0 = the head sits on the pole itself. */
  arm: number
  /** How far before the node the pole stands, and how far right of the rightmost lane centre the kerb is. */
  back: number
  kerb: number
}

/** Roads this small get a head on the pole; wider ones get an arm over the lane. */
const POST_ONLY_CLASSES = new Set(['tertiary', 'residential', 'service', 'unclassified', 'living_street'])
const BACK_FIRST = 5
const BACK_LAST = 41
const BACK_STEP = 2
/** The kerb must run straight for this far, so the pole is past the corner radius. */
const STRAIGHT_RUN = 3
const KERB_FIRST = 1.5
const KERB_LAST = 18
const KERB_STEP = .5
/** A strip narrower than this is a painted or fenced divider, not a place for a pole. */
const KERB_MIN_DEPTH = .75
const POLE_INSET = .75
const ARM_MIN = 3
const ARM_MAX = 6.5
/** A road feeding an approach continues it only if it bends less than this (cosine; about 26°). */
const UPSTREAM_ALIGN = .9
const UPSTREAM_PIECES = 16
/** Distances before the node looked at per call when the caller spreads a scan over several frames. */
const SCAN_STEPS = 2

const carriesTraffic = (lane: ApproachLane) => (lane.kind === 'motor' || lane.kind === 'bus') && !lane.gradeSeparated

/**
 * Every approach into a signalised junction, one per carriageway.
 * Lanes that start inside the same junction (the short links between its nodes) carry no head, and
 * neither do bridge and viaduct lanes: the street surface under a deck says nothing about its kerb.
 */
export function signalApproaches(graph: ApproachGraph, skipGroups?: ReadonlySet<number>): SignalApproach[] {
  const served = new Map<number, {group: number, lanes: Set<number>}>()
  const members = new Map<number, Set<number>>()
  for (const signal of graph.signals) {
    if (served.has(signal.node)) continue
    const lanes = new Set<number>()
    for (const phase of signal.phases) for (const lane of phase.lanes) lanes.add(lane)
    served.set(signal.node, {group: signal.group, lanes})
    let group = members.get(signal.group)
    if (!group) members.set(signal.group, group = new Set())
    group.add(signal.node)
  }
  if (!served.size) return []
  const nodes = new Map<number, ApproachNode>()
  for (const node of graph.nodes) nodes.set(node.id, node)
  // Carriageways by the node they drive into, then by the node they come from.
  const into = new Map<number, Map<number, ApproachSegment>>()
  const approaches = new Map<string, SignalApproach>()
  for (const lane of graph.lanes) {
    if (!carriesTraffic(lane)) continue
    const start = nodes.get(lane.from), end = nodes.get(lane.to)
    if (!start || !end) continue
    let feeds = into.get(lane.to)
    if (!feeds) into.set(lane.to, feeds = new Map())
    let segment = feeds.get(lane.from)
    if (segment) {
      if (lane.offset > segment.right) segment.right = lane.offset
    } else {
      const dx = end.x - start.x, dz = end.z - start.z, length = Math.hypot(dx, dz)
      if (!(length > .5)) continue
      feeds.set(lane.from, segment = {
        endX: end.x, endY: end.y, endZ: end.z, headingX: dx / length, headingZ: dz / length, length,
        right: lane.offset, heights: lane.heights,
      })
    }
    const signal = served.get(lane.to)
    if (!signal || skipGroups?.has(signal.group)) continue
    if (!signal.lanes.has(lane.id) || members.get(signal.group)!.has(lane.from)) continue
    const key = `${lane.from}>${lane.to}`
    const known = approaches.get(key)
    if (known) known.lanes.push(lane.id)
    else approaches.set(key, {
      key, node: lane.to, group: signal.group, lane: lane.id, lanes: [lane.id],
      endX: end.x, endZ: end.z, cls: lane.cls, path: [segment], reach: segment.length,
    })
  }
  // Short approaches: carry on up the one road that feeds them, so the search for a kerb follows the
  // real carriageway. Stop at another signal, at a fork or merge, and at a sharp bend.
  for (const approach of approaches.values()) {
    let from = Number(approach.key.slice(0, approach.key.indexOf('>')))
    const seen = new Set([approach.node, from])
    while (approach.reach < BACK_LAST + STRAIGHT_RUN && approach.path.length < UPSTREAM_PIECES && !served.has(from)) {
      const last = approach.path[approach.path.length - 1]
      let next: ApproachSegment | undefined, nextFrom = 0, aligned = 0
      for (const [origin, segment] of into.get(from) ?? []) {
        if (segment.headingX * last.headingX + segment.headingZ * last.headingZ < UPSTREAM_ALIGN) continue
        aligned++; next = segment; nextFrom = origin
      }
      if (aligned !== 1 || seen.has(nextFrom)) break
      approach.path.push(next!)
      approach.reach += next!.length
      seen.add(from = nextFrom)
    }
  }
  return [...approaches.values()]
}

/** The piece of the approach `back` metres before the node, and how far along it (from its near end) that is. */
function pieceAt(approach: SignalApproach, back: number): [ApproachSegment, number] {
  let before = 0
  for (const segment of approach.path) {
    if (back <= before + segment.length) return [segment, back - before]
    before += segment.length
  }
  const last = approach.path[approach.path.length - 1]
  return [last, last.length]
}

/** Road height `back` metres before the node. Clamped to the far end of the approach. */
export function approachHeight(approach: SignalApproach, back: number): number {
  const [segment, along] = pieceAt(approach, Math.max(0, back))
  const heights = segment.heights
  if (!heights || heights.length < 2) return segment.endY
  const t = Math.min(1, Math.max(0, 1 - along / segment.length))
  for (let index = 2; index < heights.length; index += 2) {
    if (t > heights[index]) continue
    const t0 = heights[index - 2], span = heights[index] - t0
    return span > 0 ? heights[index - 1] + (heights[index + 1] - heights[index - 1]) * (t - t0) / span : heights[index + 1]
  }
  return heights[heights.length - 1]
}

const drivable = (kinds: readonly number[]) => kinds.includes(SURFACE_ROAD) || kinds.includes(SURFACE_GUARDRAIL)

/**
 * Distance from the rightmost lane centre to the kerb, `back` metres before the node.
 * `undefined` = a tile is missing; `NaN` = the lane centre is not on a road there; `Infinity` = no kerb in reach.
 */
function kerbDistance(approach: SignalApproach, back: number, surfaceAt: SurfaceAt): number | undefined {
  const [segment, along] = pieceAt(approach, back)
  const rightX = -segment.headingZ, rightZ = segment.headingX
  const laneX = segment.endX - segment.headingX * along + rightX * segment.right
  const laneZ = segment.endZ - segment.headingZ * along + rightZ * segment.right
  const centre = surfaceAt(laneX, laneZ)
  if (!centre) return undefined
  if (!centre.includes(SURFACE_ROAD)) return NaN
  for (let side = KERB_FIRST; side <= KERB_LAST; side += KERB_STEP) {
    const near = surfaceAt(laneX + rightX * side, laneZ + rightZ * side)
    if (!near) return undefined
    if (drivable(near)) continue
    const deep = surfaceAt(laneX + rightX * (side + KERB_MIN_DEPTH), laneZ + rightZ * (side + KERB_MIN_DEPTH))
    if (!deep) return undefined
    if (!drivable(deep)) return side
  }
  return Infinity
}

/** Where a scan spread over several calls has got to. Start with `{back: 0}`. */
export type PlaceProgress = {back: number}

/**
 * Finds the pole position for an approach: the first spot before the junction where the kerb on the
 * driver's right runs straight. The search never leaves the approach's own carriageway (`path`).
 *
 * - `'pending'`: street tiles around it are still loading; ask again later.
 * - `'none'`: no kerb to stand on (roads missing from the tiles, a square, an approach too short).
 * - `'more'`: only with `progress` — this call looked at `SCAN_STEPS` distances and there are more to
 *   go. Call again with the same `progress`; a scan costs at most a few hundred surface lookups per call.
 */
export function placeSignalHead(approach: SignalApproach, surfaceAt: SurfaceAt, progress?: PlaceProgress): HeadPlacement | 'pending' | 'more' | 'none' {
  let back = Math.max(BACK_FIRST, progress?.back ?? 0)
  const pause = progress ? back + SCAN_STEPS * BACK_STEP : Infinity
  for (; back <= BACK_LAST && back + STRAIGHT_RUN <= approach.reach; back += BACK_STEP) {
    if (progress) progress.back = back
    if (back >= pause) return 'more'
    const kerb = kerbDistance(approach, back, surfaceAt)
    if (kerb === undefined) return 'pending'
    if (!Number.isFinite(kerb)) continue
    const beyond = kerbDistance(approach, back + STRAIGHT_RUN, surfaceAt)
    if (beyond === undefined) return 'pending'
    if (!Number.isFinite(beyond) || Math.abs(beyond - kerb) > 1) continue
    const [segment, along] = pieceAt(approach, back)
    const rightX = -segment.headingZ, rightZ = segment.headingX
    const side = segment.right + kerb + POLE_INSET
    const post = POST_ONLY_CLASSES.has(approach.cls ?? '') || kerb + POLE_INSET < ARM_MIN
    return {
      x: segment.endX - segment.headingX * along + rightX * side,
      y: approachHeight(approach, back),
      z: segment.endZ - segment.headingZ * along + rightZ * side,
      yaw: Math.atan2(-segment.headingX, -segment.headingZ),
      arm: post ? 0 : Math.min(ARM_MAX, kerb + POLE_INSET),
      back, kerb,
    }
  }
  return 'none'
}
