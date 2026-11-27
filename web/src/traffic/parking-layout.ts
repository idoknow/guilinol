// IDOK-399 — kerbside parking bays, worked out from the parked-car rows of the world data.
//
// Pure TypeScript: no three.js, no DOM. `parking-bays.ts` turns the result into one mesh; node tests
// import this file directly.
//
// The world data (`roads/parking/<cell>.json.gz`, written by `pipeline/traffic_parking.py`) lists only
// the parked cars. The pipeline walks each kerb in slots 6–7.5 m apart and leaves about half of them
// empty, so a bay is one slot: every parked car stands in one, and a gap of one or two slots between
// two cars on the same kerb is one or two empty bays.

/** One parked car: `[x, y, z, yaw, seed, class]`. Only the first four are read here. */
export type ParkingRow = readonly [x: number, y: number, z: number, yaw: number, ...rest: unknown[]]

export type ParkingBay = {
  /** `x,z` of the bay centre; empty bays end in `~`. Stable while the same rows are loaded. */
  key: string
  /** Bay centre. `y` is the road height from the world data, good to about ±5 cm. */
  x: number
  y: number
  z: number
  /** Unit direction of travel along the kerb. The kerb is on the right of it. */
  headingX: number
  headingZ: number
  /** Metres from the centre back to the rear end line and forward to the front end line. */
  rear: number
  front: number
  /** False for a bay inferred between two parked cars. */
  occupied: boolean
}

/** Slot spacing in the pipeline is 6–7.5 m; positions are rounded to 0.1 m. */
const SLOT_MIN = 6
const SLOT_MAX = 7.5
const SLOT_SLACK = .15
/** Two parked cars at most this many slots apart are joined by empty bays. */
const MAX_SLOTS = 3
/** Rows this close to the same line along the kerb belong to the same kerb. */
const LINE_TOLERANCE = .4
/** Half the length of a bay at the open end of a run. */
const END_HALF = 3

/** Car centre to kerb, metres (`extent - .95` in the pipeline). */
export const BAY_KERB = .95
/** Kerb to the centre of the road-side line. */
export const BAY_WIDTH = 2.2
export const BAY_LINE = .1
/** End lines stop this far short of the kerb, so they stay on the carriageway. */
export const BAY_KERB_GAP = .05
const ROAD_SIDE = BAY_WIDTH - BAY_KERB
const KERB_SIDE = BAY_KERB - BAY_KERB_GAP
/**
 * On a wide street the cars stand out in the carriageway, a lane's width from the kerb, and three
 * lines would leave the bay open towards bare asphalt. Where the carriageway goes on this far from
 * the car centre towards the kerb, the bay is a full box instead: a fourth line on the kerb side, as
 * far from the car as the road-side line. Whether it does is for the caller to find out (`boxed`).
 */
export const BAY_BOX_CLEARANCE = 1.5
/**
 * An empty bay is a guess between two parked cars, and the gap between them may be the mouth of a
 * side street. Carriageway still this far from the bay centre towards the kerb — past any kerb a
 * parked car stands off from — means it is one, and the bay is not painted.
 */
export const BAY_MOUTH_REACH = 4

type Spot = {key: string, x: number, y: number, z: number, along: number, side: number, occupied: boolean}

function slotsBetween(gap: number) {
  for (let slots = 1; slots <= MAX_SLOTS; slots++) {
    if (gap >= slots * SLOT_MIN - SLOT_SLACK && gap <= slots * SLOT_MAX + SLOT_SLACK) return slots
  }
  return 0
}

/**
 * Bays for the given parked cars: one per car, plus the empty ones between cars on the same kerb.
 * Neighbouring bays meet at their end lines, so a kerb reads as one run of boxes. The result does
 * not depend on the order of `rows`, only its own order does.
 */
export function parkingBays(rows: Iterable<ParkingRow>): ParkingBay[] {
  // Cars along one kerb come from one road segment and share its yaw to the last digit.
  const cars = new Map<string, ParkingRow>()
  for (const row of rows) {
    // The same spot listed twice (two cells, two carriageways): one car, whichever order they came in.
    const key = `${row[0]},${row[2]}`, known = cars.get(key)
    if (!known || row[3] < known[3]) cars.set(key, row)
  }
  const kerbs = new Map<number, Spot[]>()
  for (const [key, [x, y, z, yaw]] of cars) {
    const headingX = Math.sin(yaw), headingZ = Math.cos(yaw)
    let spots = kerbs.get(yaw)
    if (!spots) kerbs.set(yaw, spots = [])
    spots.push({key, x, y, z, along: x * headingX + z * headingZ, side: z * headingX - x * headingZ, occupied: true})
  }
  const bays: ParkingBay[] = []
  for (const [yaw, spots] of kerbs) {
    const headingX = Math.sin(yaw), headingZ = Math.cos(yaw)
    spots.sort((a, b) => a.along - b.along || a.side - b.side)
    // Join each car to the next one on its kerb when the gap is a whole number of slots.
    const next = new Int32Array(spots.length).fill(-1), slots = new Uint8Array(spots.length), joined = new Uint8Array(spots.length)
    for (let index = 0; index < spots.length; index++) {
      const spot = spots[index]
      for (let ahead = index + 1; ahead < spots.length; ahead++) {
        const gap = spots[ahead].along - spot.along
        if (gap > MAX_SLOTS * SLOT_MAX + SLOT_SLACK) break
        if (Math.abs(spots[ahead].side - spot.side) > LINE_TOLERANCE) continue
        const count = slotsBetween(gap)
        if (count && !joined[ahead]) {
          next[index] = ahead
          slots[index] = count
          joined[ahead] = 1
        }
        break // the nearest car on this kerb decides
      }
    }
    for (let head = 0; head < spots.length; head++) {
      if (joined[head]) continue
      const run: Spot[] = []
      for (let at = head; at >= 0; at = next[at]) {
        const spot = spots[at]
        run.push(spot)
        if (next[at] < 0) break
        const far = spots[next[at]]
        for (let step = 1; step < slots[at]; step++) {
          const t = step / slots[at]
          const x = spot.x + (far.x - spot.x) * t, z = spot.z + (far.z - spot.z) * t
          run.push({key: `${x.toFixed(1)},${z.toFixed(1)}~`, x, y: spot.y + (far.y - spot.y) * t, z, along: x * headingX + z * headingZ, side: z * headingX - x * headingZ, occupied: false})
        }
      }
      for (let index = 0; index < run.length; index++) {
        const spot = run[index], before = run[index - 1], after = run[index + 1]
        bays.push({
          key: spot.key, x: spot.x, y: spot.y, z: spot.z, headingX, headingZ,
          rear: before ? Math.hypot(spot.x - before.x, spot.z - before.z) / 2 : END_HALF,
          front: after ? Math.hypot(after.x - spot.x, after.z - spot.z) / 2 : END_HALF,
          occupied: spot.occupied,
        })
      }
    }
  }
  return withoutClashes(bays)
}

const CLASH_CELL = 10

/**
 * Where two kerbs meet without a junction between them (a bend, two carriageways drawn on top of
 * each other) the world data parks cars closer than a bay is long, and their boxes would cross.
 * One box of each such pair is left out, so no two painted bays overlap: bays are taken in a fixed
 * order — the ones with a car first, then by key — and a bay crossing one already taken is dropped.
 * A bay next to a dropped one keeps both its end lines, so the run stays closed at the hole.
 */
function withoutClashes(bays: ParkingBay[]) {
  const order = [...bays].sort((a, b) => Number(b.occupied) - Number(a.occupied)
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : a.headingX - b.headingX || a.headingZ - b.headingZ))
  const cells = new Map<string, ParkingBay[]>()
  const kept = new Set<ParkingBay>()
  taking: for (const bay of order) {
    const column = Math.floor(bay.x / CLASH_CELL), row = Math.floor(bay.z / CLASH_CELL)
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const other of cells.get(`${column + dx},${row + dz}`) ?? []) if (baysOverlap(bay, other)) continue taking
    }
    const key = `${column},${row}`, cell = cells.get(key)
    if (cell) cell.push(bay); else cells.set(key, [bay])
    kept.add(bay)
  }
  return bays.filter(bay => kept.has(bay))
}

/**
 * Overlap of two bays by more than a line's width, each taken at its widest (boxed: `ROAD_SIDE` to
 * either side of the car). Bays meeting at an end line do not overlap.
 */
export function baysOverlap(a: ParkingBay, b: ParkingBay) {
  // Separating axes of two rectangles: the heading and the across direction of each.
  const centreX = (bay: ParkingBay) => bay.x + bay.headingX * (bay.front - bay.rear) / 2
  const centreZ = (bay: ParkingBay) => bay.z + bay.headingZ * (bay.front - bay.rear) / 2
  const dx = centreX(b) - centreX(a), dz = centreZ(b) - centreZ(a)
  const lengthA = (a.rear + a.front) / 2, lengthB = (b.rear + b.front) / 2, width = ROAD_SIDE
  const cos = Math.abs(a.headingX * b.headingX + a.headingZ * b.headingZ), sin = Math.abs(a.headingX * b.headingZ - a.headingZ * b.headingX)
  return Math.abs(dx * a.headingX + dz * a.headingZ) < lengthA + lengthB * cos + width * sin - BAY_LINE
    && Math.abs(dz * a.headingX - dx * a.headingZ) < width + lengthB * sin + width * cos - BAY_LINE
    && Math.abs(dx * b.headingX + dz * b.headingZ) < lengthB + lengthA * cos + width * sin - BAY_LINE
    && Math.abs(dz * b.headingX - dx * b.headingZ) < width + lengthA * sin + width * cos - BAY_LINE
}

/** Vertices and indices one bay takes in the line mesh: four quads (rear, road-side, front and kerb-side line). */
export const BAY_VERTICES = 16
export const BAY_INDICES = 24
/** Ground samples per bay: the four corners. */
export const BAY_CORNERS = 4

/**
 * The four corners of a bay as `x, z` pairs: rear-kerb, rear-road, front-road, front-kerb.
 * These are the points whose ground height the lines are draped over.
 */
export function bayCorners(bay: ParkingBay, out: Float32Array | number[], boxed = false) {
  const {x, z, headingX, headingZ, rear, front} = bay
  const rightX = -headingZ, rightZ = headingX, kerbSide = boxed ? ROAD_SIDE : KERB_SIDE
  out[0] = x - headingX * rear + rightX * kerbSide; out[1] = z - headingZ * rear + rightZ * kerbSide
  out[2] = x - headingX * rear - rightX * ROAD_SIDE; out[3] = z - headingZ * rear - rightZ * ROAD_SIDE
  out[4] = x + headingX * front - rightX * ROAD_SIDE; out[5] = z + headingZ * front - rightZ * ROAD_SIDE
  out[6] = x + headingX * front + rightX * kerbSide; out[7] = z + headingZ * front + rightZ * kerbSide
  return out
}

/**
 * Writes one bay's line quads (`BAY_VERTICES` positions) into `positions` at vertex `offset`.
 * `heights` are the ground heights at `bayCorners` (same `boxed`), in that order; `lift` raises the
 * paint off the road. Triangles are `0 1 2, 0 2 3` per quad and face up. Every bay paints both its
 * end lines — where two bays meet the two lines lie on top of each other — so a bay never depends on
 * its neighbour being painted. The kerb-side line of a bay that is not boxed is a zero-area quad, so
 * every bay takes the same room in the buffer.
 */
export function writeBay(bay: ParkingBay, heights: ArrayLike<number>, lift: number, positions: Float32Array, offset: number, boxed = false) {
  const {x, z, headingX, headingZ, rear, front} = bay
  const rightX = -headingZ, rightZ = headingX, half = BAY_LINE / 2, length = rear + front
  const kerbSide = boxed ? ROAD_SIDE : KERB_SIDE, width = ROAD_SIDE + kerbSide, kerbEnd = boxed ? kerbSide + half : kerbSide
  let at = offset * 3
  const vertex = (along: number, side: number) => {
    // Bilinear over the bay rectangle: u runs rear → front, v runs road side → kerb.
    const u = (along + rear) / length, v = (side + ROAD_SIDE) / width
    const roadEdge = heights[1] + (heights[2] - heights[1]) * u, kerbEdge = heights[0] + (heights[3] - heights[0]) * u
    positions[at++] = x + headingX * along + rightX * side
    positions[at++] = roadEdge + (kerbEdge - roadEdge) * v + lift
    positions[at++] = z + headingZ * along + rightZ * side
  }
  const quad = (from: number, to: number, inner: number, outer: number) => {
    vertex(from, inner); vertex(from, outer); vertex(to, outer); vertex(to, inner)
  }
  quad(-rear - half, -rear + half, -ROAD_SIDE - half, kerbEnd)
  quad(-rear + half, front - half, -ROAD_SIDE - half, -ROAD_SIDE + half)
  quad(front - half, front + half, -ROAD_SIDE - half, kerbEnd)
  if (boxed) quad(-rear + half, front - half, kerbSide - half, kerbSide + half)
  else quad(front - half, front - half, -ROAD_SIDE - half, -ROAD_SIDE - half)
}

/** True when `x, z` is inside the bay: rear line to front line, road-side line to the kerb (or to the kerb-side line of a boxed bay). */
export function insideBay(bay: ParkingBay, x: number, z: number, boxed = false) {
  const dx = x - bay.x, dz = z - bay.z
  const along = dx * bay.headingX + dz * bay.headingZ, side = dz * bay.headingX - dx * bay.headingZ
  return along >= -bay.rear && along <= bay.front && side >= -ROAD_SIDE && side <= (boxed ? ROAD_SIDE : BAY_KERB)
}

/**
 * True when `x, z` is within `margin` metres of the bay taken at its widest (boxed: `ROAD_SIDE` to
 * either side of the car), measured square to its sides. Other street furniture painted on the road
 * asks this to keep clear of the bay lines without knowing whether the bay ended up boxed.
 */
export function nearBay(bay: ParkingBay, x: number, z: number, margin: number) {
  const dx = x - bay.x, dz = z - bay.z
  const along = dx * bay.headingX + dz * bay.headingZ, side = dz * bay.headingX - dx * bay.headingZ
  return along >= -bay.rear - margin && along <= bay.front + margin && Math.abs(side) <= ROAD_SIDE + margin
}
