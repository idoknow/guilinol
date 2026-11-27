// IDOK-399 stage 5b — bus stop signs and shelters: the pure part.
//
// No three.js, no DOM. `bus-stops.ts` draws what this works out; node tests import this file directly.
//
// The stops come from `public/street-furniture/bus-stops.json` (`pipeline/bus_stops.py`): one row per
// stop, `[x, z, yaw, shelter, side, name, en]`. `x, z` is the sign pole (0.6 m behind the kerb), `yaw`
// is three's `rotation.y` of the stop's own frame: local +X runs along the kerb (`t`), local +Z points
// at the carriageway (`n`). A shelter, where there is one, stands `side × 2.6 m` along `t` from the pole,
// its front 1.0 m behind the kerb, 4.2 m long and 1.5 m deep. Stops inside a building or with no lane
// within 8 m were dropped when the file was made.
import {SHIZIJIE_DECOR_EXCLUSION_POLY, pointInRelPoly, toShizijieRel} from '../shizijie-zone'

export type BusStop = {
  /** Row index in the file: stable for one file. */
  id: number
  /** `x,z` to the centimetre: stable across files as long as the stop does not move. */
  key: string
  x: number
  z: number
  yaw: number
  shelter: boolean
  /** Which way along `t` the shelter lies from the pole. */
  side: 1 | -1
  name: string
  en: string
  /** `t` (along the kerb, local +X) and `n` (towards the lane, local +Z). */
  tx: number
  tz: number
  nx: number
  nz: number
}

export const BUS_STOPS_URL = './street-furniture/bus-stops.json'

/** At most this many stops drawn at once, the nearest ones. */
export const MAX_SHOWN = 24
/** A stop further than this is not taken up… */
export const SHOW_RADIUS = 170
/** …and one already drawn is let go only beyond this, so a walker on the edge does not make it blink. */
export const RECYCLE_RADIUS = 190
/** Spatial index cell, metres. */
export const INDEX_CELL = 64
/** Stops stood on the ground per frame (one pole and four shelter feet each). */
export const LANDS_PER_FRAME = 2
/** Drawn-ground readings per frame (`drawn-ground.ts`). */
export const DRAWN_PER_FRAME = 2
/** Station names painted into the atlas per frame. */
export const NAMES_PER_FRAME = 1
/** Retry a failed download after this long (s), this many times in all. */
export const LOAD_RETRY = 10
export const LOAD_ATTEMPTS = 5

// ——— dimensions (metres) ———

export const POLE_RADIUS = .045
export const POLE_HEIGHT = 2.75
export const SIGN_WIDTH = .62
export const SIGN_HEIGHT = .86
export const SIGN_THICK = .04
export const SIGN_BOTTOM = 1.85
export const SIGN_FRAME = .02
/** The sign hangs off the pole towards the pavement (−n); its inner edge this far from the pole axis. */
export const SIGN_INNER = .06
/** Header (blue), name panel (white), bottom band (orange), as shares of the face inside the frame. */
export const SIGN_HEADER = .28
export const SIGN_FOOT = .1
/** Text faces stand this far proud of the board (plus a polygon offset): no z-fighting up close. */
export const FACE_LIFT = .002

export const SHELTER_LENGTH = 4.2
export const SHELTER_DEPTH = 1.5
export const SHELTER_OFFSET = 2.6
/** Pole is 0.6 m behind the kerb, the shelter front 1.0 m: the front is 0.4 m behind the pole, along −n. */
export const SHELTER_FRONT = -.4
export const SHELTER_BACK = SHELTER_FRONT - SHELTER_DEPTH
export const SHELTER_EAVE = 2.45
export const ROOF_PITCH = 4 * Math.PI / 180
export const ROOF_THICK = .07
export const ROOF_OVERHANG = .25
export const FASCIA_HEIGHT = .22
/** Column centres along `t`, from the shelter centre; back columns (0.09 m) and front columns (0.06 m), along `n` from the pole. */
export const COLUMN_HALF_SPAN = 2.0
export const BACK_COLUMN = .09
export const FRONT_COLUMN = .06
export const BACK_COLUMN_Z = SHELTER_BACK + .07
export const FRONT_COLUMN_Z = SHELTER_FRONT - .06
/** Lightbox back panel: between the back columns, this high. */
export const PANEL_BOTTOM = .5
export const PANEL_TOP = 1.9
export const PANEL_THICK = .06
export const BENCH_LENGTH = 2.6
export const BENCH_SEAT = .44
export const BENCH_DEPTH = .38
/** Bench back edge just in front of the panel. */
export const BENCH_BACK = BACK_COLUMN_Z + PANEL_THICK / 2 + .01
/** End panel at the far end (away from the pole), this deep from the back columns. */
export const END_PANEL_DEPTH = .75
/** Columns and pole carry on this far below their own ground. */
export const BURIED = .3
/** Four feet further apart in height than this: no shelter, only the sign. */
export const MAX_FOOT_SPREAD = .45

const SURFACE_ROAD = 0
const SURFACE_GUARDRAIL = 5

/** A stop's local point (`along` t, `out` n) in world x, z. */
export function toWorld(stop: BusStop, along: number, out: number, target: {x: number, z: number}) {
  target.x = stop.x + along * stop.tx + out * stop.nx
  target.z = stop.z + along * stop.tz + out * stop.nz
  return target
}

/**
 * Parses the file. Rows that are not well-formed are skipped, as are stops in the Shizijie landmark
 * precinct (its own shelters are part of the landmark model). `null`: not this file's format at all.
 */
export function parseBusStops(data: unknown): {stops: BusStop[], excluded: string[]} | null {
  if (!data || typeof data !== 'object') return null
  const {version, stops: rows} = data as {version?: unknown, stops?: unknown}
  if (version !== 1 || !Array.isArray(rows)) return null
  const stops: BusStop[] = [], excluded: string[] = []
  for (let id = 0; id < rows.length; id++) {
    const row = rows[id]
    if (!Array.isArray(row) || row.length < 5) continue
    const [x, z, yaw, shelter, side, name, en] = row
    if (![x, z, yaw].every(value => typeof value === 'number' && Number.isFinite(value))) continue
    const key = `${(x as number).toFixed(2)},${(z as number).toFixed(2)}`
    const [rx, rz] = toShizijieRel(x as number, z as number)
    if (pointInRelPoly(rx, rz, SHIZIJIE_DECOR_EXCLUSION_POLY)) { excluded.push(key); continue }
    const nx = Math.sin(yaw as number), nz = Math.cos(yaw as number)
    stops.push({
      id, key, x: x as number, z: z as number, yaw: yaw as number,
      shelter: shelter === 1 || shelter === true, side: side === -1 ? -1 : 1,
      name: typeof name === 'string' ? name.trim() : '', en: typeof en === 'string' ? en.trim() : '',
      tx: nz, tz: -nx, nx, nz,
    })
  }
  return {stops, excluded}
}

/** Stops binned on a 64 m grid. */
export class StopIndex {
  readonly stops: readonly BusStop[]
  private bins = new Map<number, BusStop[]>()
  constructor(stops: readonly BusStop[], readonly cell = INDEX_CELL) {
    this.stops = stops
    for (const stop of stops) {
      const key = this.keyOf(Math.floor(stop.x / cell), Math.floor(stop.z / cell)), bin = this.bins.get(key)
      if (bin) bin.push(stop)
      else this.bins.set(key, [stop])
    }
  }
  private keyOf(col: number, row: number) { return (col + 32768) * 65536 + row + 32768 }
  /** Every stop within `radius` of a point (no allocation). */
  visit(x: number, z: number, radius: number, callback: (stop: BusStop, distanceSq: number) => void) {
    const cell = this.cell, r2 = radius * radius
    const c0 = Math.floor((x - radius) / cell), c1 = Math.floor((x + radius) / cell)
    const r0 = Math.floor((z - radius) / cell), r1 = Math.floor((z + radius) / cell)
    for (let col = c0; col <= c1; col++) for (let row = r0; row <= r1; row++) {
      const bin = this.bins.get(this.keyOf(col, row))
      if (!bin) continue
      for (let i = 0; i < bin.length; i++) {
        const stop = bin[i], d2 = (stop.x - x) ** 2 + (stop.z - z) ** 2
        if (d2 <= r2) callback(stop, d2)
      }
    }
  }
}

/**
 * The stops to draw around `(x, z)`, nearest first, into `out` (cleared first): those already drawn
 * (`isShown`) stay up to `RECYCLE_RADIUS`, new ones are taken up to `SHOW_RADIUS`, at most `MAX_SHOWN`.
 * `distance` is scratch indexed by `stop.id` (length ≥ the number of rows). No allocation once `out` has grown.
 */
export function selectStops(
  index: StopIndex, x: number, z: number, isShown: (stop: BusStop) => boolean, out: BusStop[], distance: Float64Array,
  max = MAX_SHOWN, show = SHOW_RADIUS, recycle = RECYCLE_RADIUS,
) {
  out.length = 0
  const show2 = show * show
  index.visit(x, z, recycle, (stop, d2) => {
    if (d2 > show2 && !isShown(stop)) return
    distance[stop.id] = d2
    // Insertion into a short sorted list: ties by id, so the answer does not depend on the bin order.
    let at = out.length
    out.push(stop)
    while (at > 0) {
      const before = out[at - 1], bd = distance[before.id]
      if (bd < d2 || (bd === d2 && before.id < stop.id)) break
      out[at] = before
      at--
    }
    out[at] = stop
  })
  if (out.length > max) out.length = max
  return out
}

// ——— shelter footprint ———

export type Foot = {along: number, out: number}

/** The four column feet in the stop's frame: back-near, back-far, front-far, front-near ("near" = towards the pole). */
export function shelterFeet(stop: Pick<BusStop, 'side'>): Foot[] {
  const centre = stop.side * SHELTER_OFFSET, near = centre - stop.side * COLUMN_HALF_SPAN, far = centre + stop.side * COLUMN_HALF_SPAN
  return [{along: near, out: BACK_COLUMN_Z}, {along: far, out: BACK_COLUMN_Z}, {along: far, out: FRONT_COLUMN_Z}, {along: near, out: FRONT_COLUMN_Z}]
}

/** The shelter's plan outline (roof without its front/back overhang) in the stop's frame, same corner order. */
export function shelterOutline(stop: Pick<BusStop, 'side'>): Foot[] {
  const centre = stop.side * SHELTER_OFFSET, half = SHELTER_LENGTH / 2
  const near = centre - stop.side * half, far = centre + stop.side * half
  return [{along: near, out: SHELTER_BACK}, {along: far, out: SHELTER_BACK}, {along: far, out: SHELTER_FRONT}, {along: near, out: SHELTER_FRONT}]
}

/** Where a shelter stands: the highest foot (nothing hangs in the air), unless the feet are too far apart in height. */
export function shelterBase(feet: ArrayLike<number>): {base: number, spread: number, ok: boolean} {
  let low = Infinity, high = -Infinity
  for (let i = 0; i < feet.length; i++) { low = Math.min(low, feet[i]); high = Math.max(high, feet[i]) }
  const spread = high - low
  return {base: high, spread, ok: Number.isFinite(spread) && spread <= MAX_FOOT_SPREAD + 1e-9}
}

/**
 * Collision boxes in the stop's frame (centre along/out, half extents along t / along n, bottom and
 * height above the base): the sign pole, and for a shelter its back panel (with the back columns), the
 * two front columns, the bench and the end panel. The front, between the front columns, stays open.
 */
export type LocalSolid = {along: number, out: number, halfAlong: number, halfOut: number, bottom: number, height: number, part: 'pole' | 'panel' | 'column' | 'bench' | 'end'}

export function stopSolids(stop: Pick<BusStop, 'side' | 'shelter'>, withShelter = stop.shelter): LocalSolid[] {
  const solids: LocalSolid[] = [{along: 0, out: 0, halfAlong: POLE_RADIUS + .015, halfOut: POLE_RADIUS + .015, bottom: 0, height: POLE_HEIGHT, part: 'pole'}]
  if (!withShelter) return solids
  const s = stop.side, centre = s * SHELTER_OFFSET, roof = SHELTER_EAVE
  solids.push({along: centre, out: BACK_COLUMN_Z, halfAlong: COLUMN_HALF_SPAN + BACK_COLUMN / 2, halfOut: BACK_COLUMN / 2 + .01, bottom: 0, height: roof, part: 'panel'})
  for (const sign of [-1, 1]) solids.push({along: centre + sign * COLUMN_HALF_SPAN, out: FRONT_COLUMN_Z, halfAlong: FRONT_COLUMN / 2 + .01, halfOut: FRONT_COLUMN / 2 + .01, bottom: 0, height: roof, part: 'column'})
  solids.push({along: centre, out: BENCH_BACK + BENCH_DEPTH / 2, halfAlong: BENCH_LENGTH / 2, halfOut: BENCH_DEPTH / 2, bottom: 0, height: BENCH_SEAT, part: 'bench'})
  solids.push({along: centre + s * COLUMN_HALF_SPAN, out: BACK_COLUMN_Z + END_PANEL_DEPTH / 2, halfAlong: .03, halfOut: END_PANEL_DEPTH / 2, bottom: 0, height: PANEL_TOP, part: 'end'})
  return solids
}

/** A local point inside any of the boxes (plan only, with `margin`). */
export function blockedAt(solids: readonly LocalSolid[], along: number, out: number, margin = 0) {
  return solids.some(solid => Math.abs(along - solid.along) <= solid.halfAlong + margin && Math.abs(out - solid.out) <= solid.halfOut + margin)
}

// ——— station names ———

export type NameLine = {text: string, size: number}
/** `icon`: no name, the panel shows the bus pictogram only. Sizes are shares of a full glyph (7 to the panel width). */
export type FlagLayout = {icon: boolean, lines: NameLine[], sub: NameLine | null, en: NameLine | null}

/** Full-size glyphs across the flag's name panel. */
export const FLAG_UNITS = 7
/** Up to this many a single line just gets smaller; beyond, two lines. */
const FLAG_ONE_LINE = 10
/** At most this many units on each of two lines. */
const FLAG_TWO_LINE = 9
const SUB_SIZE = .5
const EN_SIZE = .45
const EN_MIN = .34
/** Full-size glyphs along the shelter's fascia band; longer names get smaller down to `FASCIA_LONGEST`, then are cut. */
export const FASCIA_UNITS = 12
const FASCIA_LONGEST = 18
const ELLIPSIS = '…'

/** Width of a glyph in units of a CJK glyph: half for Latin letters, digits and ASCII punctuation. */
function glyphUnits(char: string) {
  const code = char.codePointAt(0) ?? 0
  return code < 0x2e80 ? .55 : 1
}

export function textUnits(text: string) {
  let units = 0
  for (const char of text) units += glyphUnits(char)
  return units
}

/** `text` cut to fit `max` units, an ellipsis included when anything was cut. */
export function fitUnits(text: string, max: number) {
  if (textUnits(text) <= max + 1e-9) return text
  let out = '', units = glyphUnits(ELLIPSIS)
  for (const char of text) {
    const width = glyphUnits(char)
    if (units + width > max + 1e-9) break
    out += char
    units += width
  }
  return out + ELLIPSIS
}

/** A name and what is in its brackets: `十字街中心广场(桂林市口腔医院)` → `十字街中心广场`, `桂林市口腔医院`. */
export function splitName(name: string): {main: string, sub: string} {
  const clean = name.trim()
  const open = clean.search(/[(（]/)
  if (open <= 0) return {main: clean, sub: ''}
  const rest = clean.slice(open + 1), close = rest.search(/[)）]/)
  return {main: clean.slice(0, open).trim(), sub: (close < 0 ? rest : rest.slice(0, close)).trim()}
}

/** The longest start of `text` that fits `max` units, no ellipsis. */
function takeUnits(text: string, max: number) {
  let out = '', units = 0
  for (const char of text) {
    units += glyphUnits(char)
    if (units > max + 1e-9) break
    out += char
  }
  return out
}

/** Splits `text` into two lines as even in width as possible (the first line no shorter than the second). */
function halves(text: string): [string, string] {
  const chars = Array.from(text), total = textUnits(text)
  let units = 0, best = 1, bestOff = Infinity
  for (let cut = 1; cut < chars.length; cut++) {
    units += glyphUnits(chars[cut - 1])
    const off = Math.abs(units - total / 2) - (units >= total / 2 ? 1e-6 : 0)
    if (off < bestOff) { bestOff = off; best = cut }
  }
  return [chars.slice(0, best).join(''), chars.slice(best).join('')]
}

/** The flag sign's name panel. */
export function layoutFlagName(name: string, en = ''): FlagLayout {
  const english = en.trim()
  const enLine = (): NameLine | null => {
    if (!english) return null
    const max = FLAG_UNITS / EN_SIZE, units = textUnits(english)
    if (units <= max) return {text: english, size: EN_SIZE}
    const size = Math.max(EN_MIN, EN_SIZE * max / units)
    return {text: fitUnits(english, FLAG_UNITS / size), size}
  }
  const {main, sub} = splitName(name)
  if (!main) return {icon: true, lines: [], sub: null, en: enLine()}
  const units = textUnits(main)
  let lines: NameLine[]
  if (units <= FLAG_UNITS) lines = [{text: main, size: 1}]
  else if (units <= FLAG_ONE_LINE) lines = [{text: main, size: FLAG_UNITS / units}]
  else {
    let [first, second] = halves(main)
    if (textUnits(first) > FLAG_TWO_LINE || textUnits(second) > FLAG_TWO_LINE) {
      first = takeUnits(main, FLAG_TWO_LINE)
      second = fitUnits(Array.from(main).slice(Array.from(first).length).join(''), FLAG_TWO_LINE)
    }
    const size = Math.min(1, FLAG_UNITS / Math.max(textUnits(first), textUnits(second)))
    lines = [{text: first, size}, {text: second, size}]
  }
  const subLine = sub ? {text: fitUnits(`（${sub}）`, FLAG_UNITS / SUB_SIZE), size: SUB_SIZE} : null
  return {icon: false, lines, sub: subLine, en: enLine()}
}

/** The shelter's fascia band: one line, the full name; `null` for a stop with no name. */
export function layoutFasciaName(name: string): NameLine | null {
  const {main, sub} = splitName(name)
  if (!main) return null
  const text = sub ? `${main}（${sub}）` : main, units = textUnits(text)
  if (units <= FASCIA_UNITS) return {text, size: 1}
  if (units <= FASCIA_LONGEST) return {text, size: FASCIA_UNITS / units}
  return {text: fitUnits(text, FASCIA_LONGEST), size: FASCIA_UNITS / FASCIA_LONGEST}
}

// ——— the name atlas ———

/** One 1024 × 1024 canvas: 32 flag cells (160 × 140), the shared header, the no-name panel, colour swatches, 32 fascia cells (256 × 23). */
export const ATLAS_SIZE = 1024
export const ATLAS_CELLS = 32
const FLAG_W = 160, FLAG_H = 140, FLAG_COLS = 6
const FASCIA_W = 256, FASCIA_H = 23, FASCIA_COLS = 4, FASCIA_TOP = FLAG_H * 6
export type Rect = {x: number, y: number, w: number, h: number}
export const flagCellRect = (cell: number): Rect => ({x: (cell % FLAG_COLS) * FLAG_W, y: Math.floor(cell / FLAG_COLS) * FLAG_H, w: FLAG_W, h: FLAG_H})
export const fasciaCellRect = (cell: number): Rect => ({x: (cell % FASCIA_COLS) * FASCIA_W, y: FASCIA_TOP + Math.floor(cell / FASCIA_COLS) * FASCIA_H, w: FASCIA_W, h: FASCIA_H})
/** Flag cells 32 + 33 side by side: the blue header with the pictogram and 公交站, the same on every sign. */
export const HEADER_RECT: Rect = {x: flagCellRect(32).x, y: flagCellRect(32).y, w: FLAG_W * 2, h: FLAG_H}
/** Flag cell 34: the name panel of a stop with no name (pictogram only), also shown until a name is painted. */
export const ICON_RECT: Rect = flagCellRect(34)
const SWATCH_X = FLAG_W * FLAG_COLS
export const SWATCH_ORANGE: Rect = {x: SWATCH_X, y: 0, w: ATLAS_SIZE - SWATCH_X, h: FLAG_H}
export const SWATCH_BLUE: Rect = {x: SWATCH_X, y: FLAG_H, w: ATLAS_SIZE - SWATCH_X, h: FLAG_H}
/** Physical size of each textured face, for drawing at the right aspect. */
export const SIGN_FACE_WIDTH = SIGN_WIDTH - 2 * SIGN_FRAME
export const SIGN_FACE_HEIGHT = SIGN_HEIGHT - 2 * SIGN_FRAME
export const FASCIA_TEXT_HEIGHT = FASCIA_HEIGHT - 2 * .025
export const FASCIA_TEXT_WIDTH = FASCIA_TEXT_HEIGHT * FASCIA_W / FASCIA_H

/** `rect` in texture coordinates (`flipY`: v runs up), shrunk by `inset` pixels. */
export function uvOf(rect: Rect, inset = 0): [number, number, number, number] {
  return [(rect.x + inset) / ATLAS_SIZE, 1 - (rect.y + rect.h - inset) / ATLAS_SIZE, (rect.x + rect.w - inset) / ATLAS_SIZE, 1 - (rect.y + inset) / ATLAS_SIZE]
}

/**
 * Which stop's name is in which atlas cell. A drawn stop pins its cell; a stop let go leaves its name
 * in place, so walking back does not repaint it, until the cell is needed: free cells first, then the
 * least recently used unpinned one. No allocation after construction except the key map's own.
 */
export class NameAtlas {
  readonly capacity: number
  private cellOf = new Map<string, number>()
  private keys: (string | null)[]
  private painted: (string | null)[]
  private pinned: Uint8Array
  private used: Float64Array
  constructor(capacity = ATLAS_CELLS) {
    this.capacity = capacity
    this.keys = new Array(capacity).fill(null)
    this.painted = new Array(capacity).fill(null)
    this.pinned = new Uint8Array(capacity)
    this.used = new Float64Array(capacity).fill(-Infinity)
  }
  /** The cell for `key`, pinned; −1 when every cell is pinned by another stop. */
  acquire(key: string, now: number) {
    let cell = this.cellOf.get(key)
    if (cell === undefined) {
      cell = -1
      let oldest = Infinity
      for (let i = 0; i < this.capacity; i++) {
        if (this.keys[i] === null) { cell = i; break }
        if (!this.pinned[i] && this.used[i] < oldest) { oldest = this.used[i]; cell = i }
      }
      if (cell < 0) return -1
      const previous = this.keys[cell]
      if (previous !== null) this.cellOf.delete(previous)
      this.keys[cell] = key
      this.painted[cell] = null
      this.cellOf.set(key, cell)
    }
    this.pinned[cell] = 1
    this.used[cell] = now
    return cell
  }
  /** The stop is no longer drawn: its cell may be taken, its name stays until then. */
  release(key: string, now: number) {
    const cell = this.cellOf.get(key)
    if (cell === undefined) return
    this.pinned[cell] = 0
    this.used[cell] = now
  }
  isPainted(cell: number, key: string) { return cell >= 0 && this.painted[cell] === key }
  markPainted(cell: number, key: string) { if (this.keys[cell] === key) this.painted[cell] = key }
  cellFor(key: string) { return this.cellOf.get(key) ?? -1 }
  occupancy() {
    let used = 0, pinned = 0, painted = 0
    for (let i = 0; i < this.capacity; i++) {
      if (this.keys[i] !== null) used++
      if (this.pinned[i]) pinned++
      if (this.painted[i] !== null) painted++
    }
    return {capacity: this.capacity, used, pinned, painted}
  }
}

/** Plan check used by the browser verify: a point is on the carriageway or a guardrail per the street tiles. */
export const onCarriageway = (kinds: readonly number[] | undefined | null) => !!kinds && (kinds.includes(SURFACE_ROAD) || kinds.includes(SURFACE_GUARDRAIL))
