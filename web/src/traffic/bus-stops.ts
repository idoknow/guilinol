// IDOK-399 stage 5b — bus stop signs and shelters.
//
// Where the stops are comes from `public/street-furniture/bus-stops.json`, fetched the first time the
// module is asked to update; `bus-stop-layout.ts` indexes it and works out every piece in the stop's
// own frame. This file draws the nearest 24 stops in two draw calls for the whole town:
//
// - one merged `Mesh` with a fixed vertex range per drawn stop (pole + flag sign, and the shelter
//   where there is one), vertex colours, the same Lambert material as the kerb bollards. A merged mesh
//   rather than instances so every shelter column can reach down to its own ground;
// - one merged `Mesh` of textured faces (both faces of each flag sign, the shelter's fascia band)
//   reading a 1024 × 1024 canvas atlas of station names, painted one name a frame.
//
// Heights: like `bollards.ts`, the pole and each of the four shelter feet are read from the collider,
// then from the ground as drawn (`drawn-ground.ts`) where that is within 0.6 m of it, two stops a frame.
// A shelter stands at its highest foot; each column reaches 0.3 m under its own ground. Feet more than
// 0.45 m apart in height get no shelter, only the sign.
import * as THREE from 'three'
import {mainDetail} from '../look/mirror-layer'
import {
  ATLAS_SIZE, BACK_COLUMN, BACK_COLUMN_Z, BENCH_BACK, BENCH_DEPTH, BENCH_LENGTH, BENCH_SEAT, BURIED, BUS_STOPS_URL,
  COLUMN_HALF_SPAN, DRAWN_PER_FRAME, END_PANEL_DEPTH, FACE_LIFT, FASCIA_HEIGHT, FASCIA_TEXT_HEIGHT, FASCIA_TEXT_WIDTH, FLAG_UNITS,
  FRONT_COLUMN, FRONT_COLUMN_Z, HEADER_RECT, ICON_RECT, LANDS_PER_FRAME, LOAD_ATTEMPTS, LOAD_RETRY, MAX_SHOWN, NAMES_PER_FRAME,
  NameAtlas, PANEL_BOTTOM, PANEL_THICK, PANEL_TOP, POLE_HEIGHT, POLE_RADIUS, ROOF_OVERHANG, ROOF_PITCH, ROOF_THICK,
  SHELTER_EAVE, SHELTER_FRONT, SHELTER_LENGTH, SHELTER_OFFSET, SIGN_BOTTOM, SIGN_FACE_HEIGHT, SIGN_FACE_WIDTH, SIGN_FOOT,
  SIGN_FRAME, SIGN_HEADER, SIGN_HEIGHT, SIGN_INNER, SIGN_THICK, SIGN_WIDTH, SWATCH_BLUE, SWATCH_ORANGE, StopIndex,
  fasciaCellRect, flagCellRect, layoutFasciaName, layoutFlagName, parseBusStops, selectStops, shelterBase, shelterFeet,
  shelterOutline, stopSolids, toWorld, uvOf, type BusStop, type LocalSolid, type Rect,
} from './bus-stop-layout'
import {SolidGrid, type Solid} from './contact'
import type {DrawnGroundAt} from './drawn-ground'
import type {GroundAt} from './parking-bays'

/**
 * Reference height handed to the collider: far below anything, so a deck, bridge or landmark overhead
 * is never taken — the stop stands on the pavement, road or ground under it (`walk/support.ts`).
 */
export const GROUND_REFERENCE = -1000
/** See `bollards.ts`: one collider reading is not trusted until it repeats. */
export const SETTLE_LOOKS = 3
const RETRY = 1.5
const RECHECK = 1
const SETTLED_RECHECK = 8
/** A drawn-ground reading this far from the collider is not the surface the stop stands on (a deck above, a cut below). */
const HEIGHT_BAND = .6
/** A settled stop whose pole reading jumps further than `HEIGHT_BAND` keeps its height; after this many such readings it is read only every 30 s. */
const WRONG_SURFACE_LOOKS = 6
const WRONG_SURFACE_RETRY = 30
const SAME_HEIGHT = .004
const DRAWN_RECHECK = 30
const DRAWN_WAIT = 5
/** The set of stops is worked out again this often (s), or when the focus moved this far (m). */
const SELECT_EVERY = .5
const SELECT_MOVE = 8
/** Painted names are sent to the GPU at most this often (s): a 1024² upload is not free on a phone. */
const UPLOAD_EVERY = .5
/** Points read per stop: the pole, then the four shelter feet. */
const POINTS = 5

const POLE_HEX = 0x474d54
const FRAME_HEX = 0x3a3f45
const STEEL_HEX = 0x3c4248
const ROOF_HEX = 0xd9dde0
const SOFFIT_HEX = 0xc9ced2
const BLUE_HEX = 0x1f5aa6
const PANEL_HEX = 0xe9edf0
const MULLION_HEX = 0xcdd3d8
const WOOD_HEX = 0xa9794a
const BLUE = '#1f5aa6', ORANGE = '#e7a12e', INK = '#2b3036', SUB_INK = '#4a5057', EN_INK = '#7d848c'
const FONT = '"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif'

/** Vertex tags of the shelter template: a column foot reaching down to its own ground, or a bench leg to the lowest. */
const TAG_NONE = -1, TAG_LOW = 4

type Template = {position: Float32Array, normal: Float32Array, color: Float32Array, tag: Int8Array, count: number}

/** Triangle soup in the stop's frame (x along t, y up, z along n), one colour per triangle. */
class Builder {
  position: number[] = []; normal: number[] = []; color: number[] = []; tag: number[] = []
  private tint = new THREE.Color()
  private a = new THREE.Vector3(); private b = new THREE.Vector3(); private c = new THREE.Vector3()
  triangle(p: number[][], hex: number, tags: number[], normals?: number[][]) {
    this.tint.setHex(hex)
    let n = normals
    if (!n) {
      this.a.fromArray(p[0]); this.b.fromArray(p[1]).sub(this.a); this.c.fromArray(p[2]).sub(this.a)
      const face = this.b.cross(this.c).normalize().toArray()
      n = [face, face, face]
    }
    for (let i = 0; i < 3; i++) {
      this.position.push(p[i][0], p[i][1], p[i][2])
      this.normal.push(n[i][0], n[i][1], n[i][2])
      this.color.push(this.tint.r, this.tint.g, this.tint.b)
      this.tag.push(tags[i])
    }
  }
  /** Counter-clockwise seen from outside. */
  quad(p: number[][], hex: number, tags = [TAG_NONE, TAG_NONE, TAG_NONE, TAG_NONE], normals?: number[][]) {
    this.triangle([p[0], p[1], p[2]], hex, [tags[0], tags[1], tags[2]], normals && [normals[0], normals[1], normals[2]])
    this.triangle([p[0], p[2], p[3]], hex, [tags[0], tags[2], tags[3]], normals && [normals[0], normals[2], normals[3]])
  }
  /** Eight corners, bottom 0–3 then top 4–7, each `(x0,z0) (x1,z0) (x1,z1) (x0,z1)`. */
  prism(c: number[][], hex: number, {bottomTag = TAG_NONE, under = hex, skipBottom = false} = {}) {
    const t = bottomTag, n = TAG_NONE
    this.quad([c[4], c[7], c[6], c[5]], hex)
    if (!skipBottom) this.quad([c[0], c[1], c[2], c[3]], under, [t, t, t, t])
    this.quad([c[3], c[2], c[6], c[7]], hex, [t, t, n, n])
    this.quad([c[1], c[0], c[4], c[5]], hex, [t, t, n, n])
    this.quad([c[2], c[1], c[5], c[6]], hex, [t, t, n, n])
    this.quad([c[0], c[3], c[7], c[4]], hex, [t, t, n, n])
  }
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, hex: number, options?: {bottomTag?: number, under?: number, skipBottom?: boolean}) {
    this.prism([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], hex, options)
  }
  /** A slab whose underside follows `bottom(z)` (the pitched roof and its trims). */
  slab(x0: number, x1: number, z0: number, z1: number, bottom: (z: number) => number, thick: number, hex: number, under = hex) {
    const b0 = bottom(z0), b1 = bottom(z1)
    this.prism([[x0, b0, z0], [x1, b0, z0], [x1, b1, z1], [x0, b1, z1], [x0, b0 + thick, z0], [x1, b0 + thick, z0], [x1, b1 + thick, z1], [x0, b1 + thick, z1]], hex, {under})
  }
  /** An eight-sided upright with smooth sides and a flat top. */
  octagon(radius: number, y0: number, y1: number, hex: number, top = true) {
    const ring = (y: number) => Array.from({length: 9}, (_, i) => { const a = i / 8 * Math.PI * 2 + Math.PI / 8; return [Math.cos(a) * radius, y, Math.sin(a) * radius] })
    const low = ring(y0), high = ring(y1)
    for (let i = 0; i < 8; i++) {
      const n0 = [low[i][0] / radius, 0, low[i][2] / radius], n1 = [low[i + 1][0] / radius, 0, low[i + 1][2] / radius]
      this.quad([low[i + 1], low[i], high[i], high[i + 1]], hex, undefined, [n1, n0, n0, n1])
    }
    if (top) for (let i = 0; i < 8; i++) this.triangle([[0, y1, 0], high[i + 1], high[i]], hex, [TAG_NONE, TAG_NONE, TAG_NONE])
  }
  done(): Template {
    return {position: new Float32Array(this.position), normal: new Float32Array(this.normal), color: new Float32Array(this.color), tag: Int8Array.from(this.tag), count: this.tag.length}
  }
}

/** Underside of the roof at `out` along n: 2.45 m at the front edge, rising 4° towards the back. */
const ROOF_FRONT = SHELTER_FRONT + ROOF_OVERHANG
export const roofUnderside = (out: number) => SHELTER_EAVE + (ROOF_FRONT - out) * Math.tan(ROOF_PITCH)
const FASCIA_OUT = ROOF_FRONT + .03, FASCIA_IN = ROOF_FRONT - .01
const FASCIA_BOTTOM = SHELTER_EAVE - .08, FASCIA_TOP = FASCIA_BOTTOM + FASCIA_HEIGHT
const SIGN_OUT0 = -SIGN_INNER, SIGN_OUT1 = -SIGN_INNER - SIGN_WIDTH

/** Pole and flag sign, base at the origin; the pole carries on `BURIED` under it. */
function poleTemplate() {
  const b = new Builder()
  b.octagon(POLE_RADIUS, -BURIED, POLE_HEIGHT, POLE_HEX, false)
  b.octagon(POLE_RADIUS + .006, POLE_HEIGHT, POLE_HEIGHT + .03, FRAME_HEX)
  b.octagon(POLE_RADIUS + .02, -BURIED, .04, FRAME_HEX)
  b.box(-SIGN_THICK / 2, SIGN_THICK / 2, SIGN_BOTTOM, SIGN_BOTTOM + SIGN_HEIGHT, SIGN_OUT1, SIGN_OUT0, FRAME_HEX)
  for (const y of [SIGN_BOTTOM + .08, SIGN_BOTTOM + SIGN_HEIGHT - .1]) b.box(-.012, .012, y, y + .04, SIGN_OUT0 - .008, -POLE_RADIUS + .01, FRAME_HEX)
  return b.done()
}

/** The shelter for `side = +1` (it lies along +t from the pole); mirrored for −1 when written. */
function shelterTemplate() {
  const b = new Builder()
  const centre = SHELTER_OFFSET, x0 = centre - SHELTER_LENGTH / 2, x1 = centre + SHELTER_LENGTH / 2
  // The roof overhangs the back of the shelter (back columns sit 0.07 m inside it) by 0.25 m.
  const roofBack = BACK_COLUMN_Z - .07 - ROOF_OVERHANG
  const near = centre - COLUMN_HALF_SPAN, far = centre + COLUMN_HALF_SPAN
  // Columns: back-near (foot 0), back-far (1), front-far (2), front-near (3); each foot reaches its own ground.
  const column = (x: number, z: number, size: number, foot: number) =>
    b.box(x - size / 2, x + size / 2, -BURIED, roofUnderside(z) + .01, z - size / 2, z + size / 2, STEEL_HEX, {bottomTag: foot})
  column(near, BACK_COLUMN_Z, BACK_COLUMN, 0)
  column(far, BACK_COLUMN_Z, BACK_COLUMN, 1)
  column(far, FRONT_COLUMN_Z, FRONT_COLUMN, 2)
  column(near, FRONT_COLUMN_Z, FRONT_COLUMN, 3)
  // Roof: pale top, a shade darker underneath, dark trims at the back and the ends, the blue fascia at the front.
  b.slab(x0, x1, roofBack, ROOF_FRONT, roofUnderside, ROOF_THICK, ROOF_HEX, SOFFIT_HEX)
  b.slab(x0, x1, roofBack - .03, roofBack + .01, z => roofUnderside(z) - .03, ROOF_THICK + .05, STEEL_HEX)
  for (const x of [x0 - .015, x1 - .015]) b.slab(x, x + .03, roofBack, ROOF_FRONT, z => roofUnderside(z) - .03, ROOF_THICK + .05, STEEL_HEX)
  b.box(x0 - .015, x1 + .015, FASCIA_BOTTOM + .025, FASCIA_TOP - .025, FASCIA_IN, FASCIA_OUT, BLUE_HEX)
  b.box(x0 - .015, x1 + .015, FASCIA_BOTTOM, FASCIA_BOTTOM + .025, FASCIA_IN, FASCIA_OUT + .004, STEEL_HEX)
  b.box(x0 - .015, x1 + .015, FASCIA_TOP - .025, FASCIA_TOP, FASCIA_IN, FASCIA_OUT + .004, STEEL_HEX)
  // Lightbox back panel between the back columns: dark rails, pale face, two faint joints (three panes).
  const px0 = near + BACK_COLUMN / 2, px1 = far - BACK_COLUMN / 2, pz0 = BACK_COLUMN_Z - PANEL_THICK / 2, pz1 = BACK_COLUMN_Z + PANEL_THICK / 2
  b.box(px0, px1, PANEL_BOTTOM, PANEL_BOTTOM + .06, pz0, pz1, STEEL_HEX)
  b.box(px0, px1, PANEL_TOP - .06, PANEL_TOP, pz0, pz1, STEEL_HEX)
  b.box(px0, px1, PANEL_BOTTOM + .06, PANEL_TOP - .06, pz0 + .01, pz1 - .01, PANEL_HEX)
  for (const share of [1 / 3, 2 / 3]) {
    const x = px0 + (px1 - px0) * share
    b.box(x - .006, x + .006, PANEL_BOTTOM + .06, PANEL_TOP - .06, pz0 + .009, pz1 - .009, MULLION_HEX)
  }
  // End panel at the far end, same make, from the back column forward.
  const ez0 = BACK_COLUMN_Z + BACK_COLUMN / 2, ez1 = BACK_COLUMN_Z + END_PANEL_DEPTH
  b.box(far - .02, far + .02, PANEL_BOTTOM, PANEL_BOTTOM + .06, ez0, ez1, STEEL_HEX)
  b.box(far - .02, far + .02, PANEL_TOP - .06, PANEL_TOP, ez0, ez1, STEEL_HEX)
  b.box(far - .02, far + .02, PANEL_BOTTOM, PANEL_TOP, ez1 - .04, ez1, STEEL_HEX)
  b.box(far - .015, far + .015, PANEL_BOTTOM + .06, PANEL_TOP - .06, ez0, ez1 - .04, PANEL_HEX)
  // Bench: three wooden slats on three steel frames; the legs reach the lowest foot's ground.
  const bx0 = centre - BENCH_LENGTH / 2, bx1 = centre + BENCH_LENGTH / 2, front = BENCH_BACK + BENCH_DEPTH
  const slat = (BENCH_DEPTH - .04) / 3
  for (let i = 0; i < 3; i++) b.box(bx0, bx1, BENCH_SEAT - .035, BENCH_SEAT, BENCH_BACK + i * (slat + .02), BENCH_BACK + i * (slat + .02) + slat, WOOD_HEX)
  for (const x of [bx0 + .12, centre, bx1 - .12]) {
    for (const z of [BENCH_BACK + .02, front - .06]) b.box(x - .02, x + .02, -BURIED, BENCH_SEAT - .035, z, z + .04, STEEL_HEX, {bottomTag: TAG_LOW})
    b.box(x - .02, x + .02, BENCH_SEAT - .07, BENCH_SEAT - .035, BENCH_BACK + .02, front - .02, STEEL_HEX)
  }
  return b.done()
}

/** Textured faces per stop: flag face +t (header, name, band), flag face −t (same), fascia. */
const QUADS = 7
const QUAD_VERTS = 4

/** One buffer that is sent whole the first time and in pieces after (as `manhole-covers.ts`). */
function dynamic(array: Float32Array, itemSize: number) {
  const attribute = new THREE.BufferAttribute(array, itemSize)
  attribute.setUsage(THREE.DynamicDrawUsage)
  let whole = true
  attribute.onUpload(() => { whole = false })
  return {
    attribute,
    range(start: number, count: number) {
      if (whole) return
      // Too many pieces: the whole buffer once, and nothing more is listed until that went out (a piece added after
      // the list was cleared would be the only thing sent).
      if (attribute.updateRanges.length >= 64) { attribute.clearUpdateRanges(); attribute.needsUpdate = whole = true; return }
      attribute.addUpdateRange(start, count)
      attribute.needsUpdate = true
    },
  }
}

type ShelterState = 'off' | 'waiting' | 'up' | 'skipped'

type Slot = {
  index: number
  stop: BusStop | null
  state: 'waiting' | 'drawn'
  shelter: ShelterState
  /** World x, z of the five points: pole, then feet 0–3. */
  px: Float64Array
  pz: Float64Array
  /** Collider under each point; NaN until read. */
  support: Float64Array
  drawn: (number | null | undefined)[]
  drawnFor: Float64Array
  drawnAt: Float64Array
  drawnSince: Float64Array
  /** What the geometry was last written with: pole base, shelter base, the four foot bases. */
  poleY: number
  shelterY: number
  feet: Float64Array
  spread: number
  looks: number
  wrong: number
  dueAt: number
  wants: boolean
  distanceSq: number
  /** Atlas cell (−1: no name), and whether the faces show the painted name yet. */
  cell: number
  showsName: boolean
  /** The name is on the canvas and waits for the texture to go to the GPU: the faces switch to it with that upload, not before. */
  painted: boolean
  local: LocalSolid[]
  solids: Solid[]
  releases: ((() => void) | undefined)[]
}

export type BusStopProbe = {
  /** `idle | loading | ready | failed`, download attempts so far. */
  load: string
  attempts: number
  total: number
  excluded: string[]
  shown: number
  drawn: number
  settled: number
  visible: boolean
  drawCalls: number
  meshes: string[]
  atlas: {capacity: number, used: number, pinned: number, painted: number, texture: boolean}
  focus: {x: number, z: number} | null
  stops: {
    /** `slot`: which vertex range of the two meshes the stop is written to (`STRIDE` / 7 quads per slot). */
    key: string, slot: number, x: number, z: number, yaw: number, side: 1 | -1, shelter: boolean, shelterState: ShelterState, name: string,
    state: Slot['state'], y: number | null, support: number | null, settled: boolean, spread: number | null, cell: number, named: boolean,
    /** Shelter column feet (world): ground the foot stands on (`y`), the collider there, and the bottom of the column. */
    corners: {x: number, z: number, y: number | null, support: number | null, bottom: number | null}[]
    /** Shelter outline corners (world, plan): for the carriageway and building checks. */
    outline: {x: number, z: number}[]
  }[]
}

export type BusStopOptions = {
  /** Fetches and parses the file; defaults to `fetch(BUS_STOPS_URL)`. */
  load?: () => Promise<unknown>
  /** A 2D canvas for the name atlas; defaults to a DOM canvas where there is a DOM. `null`: no names (tests). */
  canvas?: (() => HTMLCanvasElement | OffscreenCanvas | null) | null
}

function defaultCanvas() {
  if (typeof document !== 'undefined') return document.createElement('canvas')
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(ATLAS_SIZE, ATLAS_SIZE)
  return null
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** A bus seen from the front, `h` tall, centred at `(cx, cy)`. */
function drawBus(ctx: Ctx, cx: number, cy: number, h: number, ink: string, paper: string) {
  const w = h * .8, x = cx - w / 2, y = cy - h / 2
  ctx.fillStyle = ink
  roundRect(ctx, x, y, w, h * .86, w * .16); ctx.fill()
  ctx.fillRect(x - w * .09, y + h * .14, w * .06, h * .16)
  ctx.fillRect(x + w * 1.03, y + h * .14, w * .06, h * .16)
  roundRect(ctx, x + w * .1, y + h * .8, w * .2, h * .2, w * .05); ctx.fill()
  roundRect(ctx, x + w * .7, y + h * .8, w * .2, h * .2, w * .05); ctx.fill()
  ctx.fillStyle = paper
  roundRect(ctx, x + w * .22, y + h * .05, w * .56, h * .07, h * .02); ctx.fill()
  roundRect(ctx, x + w * .09, y + h * .17, w * .82, h * .36, w * .06); ctx.fill()
  for (const lx of [.2, .8]) { ctx.beginPath(); ctx.arc(x + w * lx, y + h * .68, w * .075, 0, Math.PI * 2); ctx.fill() }
  ctx.fillRect(x + w * .36, y + h * .655, w * .28, h * .05)
}

/** `text` centred at `(cx, baseline)`, squeezed sideways if it would be wider than `max`. */
function fitText(ctx: Ctx, text: string, cx: number, baseline: number, px: number, max: number, ink: string) {
  ctx.font = `600 ${Math.max(1, Math.round(px * 10) / 10)}px ${FONT}`
  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const width = ctx.measureText(text).width
  if (width <= max) { ctx.fillText(text, cx, baseline); return }
  ctx.save()
  ctx.translate(cx, baseline)
  ctx.scale(max / width, 1)
  ctx.fillText(text, 0, 0)
  ctx.restore()
}

/**
 * `drawnAt` (optional, `drawn-ground.ts`): height of the ground as drawn. Without it, or where it reads
 * nothing or more than 0.6 m from the collider, the stops stand on the collider.
 */
export function busStops(scene: THREE.Scene, groundAt: GroundAt, drawnAt?: DrawnGroundAt, options: BusStopOptions = {}) {
  const pole = poleTemplate(), shelter = shelterTemplate()
  const STRIDE = pole.count + shelter.count
  const vertexCount = STRIDE * MAX_SHOWN
  const positions = dynamic(new Float32Array(vertexCount * 3), 3), normals = dynamic(new Float32Array(vertexCount * 3), 3)
  const colours = new Float32Array(vertexCount * 3)
  for (let slot = 0; slot < MAX_SHOWN; slot++) {
    colours.set(pole.color, slot * STRIDE * 3)
    colours.set(shelter.color, (slot * STRIDE + pole.count) * 3)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', positions.attribute)
  geometry.setAttribute('normal', normals.attribute)
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({vertexColors: true}))
  mesh.name = 'G2 bus stops'

  const faceCount = MAX_SHOWN * QUADS * QUAD_VERTS
  const facePositions = dynamic(new Float32Array(faceCount * 3), 3), faceNormals = dynamic(new Float32Array(faceCount * 3), 3), faceUvs = dynamic(new Float32Array(faceCount * 2), 2)
  const faceIndex = new Uint16Array(MAX_SHOWN * QUADS * 6)
  for (let quad = 0; quad < MAX_SHOWN * QUADS; quad++) faceIndex.set([0, 1, 2, 0, 2, 3].map(i => quad * 4 + i), quad * 6)
  const faceGeometry = new THREE.BufferGeometry()
  faceGeometry.setAttribute('position', facePositions.attribute)
  faceGeometry.setAttribute('normal', faceNormals.attribute)
  faceGeometry.setAttribute('uv', faceUvs.attribute)
  faceGeometry.setIndex(new THREE.BufferAttribute(faceIndex, 1))

  const canvas = options.canvas === null ? null : (options.canvas ?? defaultCanvas)()
  if (canvas) { canvas.width = ATLAS_SIZE; canvas.height = ATLAS_SIZE }
  const ctx = ((canvas as HTMLCanvasElement | null)?.getContext('2d') ?? null) as Ctx | null
  const texture = canvas && ctx ? new THREE.CanvasTexture(canvas as HTMLCanvasElement) : undefined
  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace
    // three.js clamps this to what the GPU offers: the smaller of 4 and the renderer's maximum.
    texture.anisotropy = 4
    texture.generateMipmaps = true
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
  }
  const faceMaterial = new THREE.MeshLambertMaterial({map: texture ?? null, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2})
  const faces = new THREE.Mesh(faceGeometry, faceMaterial)
  faces.name = 'G2 bus stop names'
  for (const item of [mesh, faces]) {
    item.visible = false
    // A few dozen stops across the town and vertex ranges that come and go: bounds would never be current.
    item.frustumCulled = false
    item.matrixAutoUpdate = false
    item.userData.noShadowCast = true
    // Nothing should pick these up as ground or as an obstacle by ray: verify audits ask for them by name.
    item.raycast = () => {}
    scene.add(item)
    mainDetail(item)
  }

  // A request that hangs counts as failed after 15 s, so the retries still run.
  const load = options.load ?? (() => fetch(BUS_STOPS_URL, {signal: AbortSignal.timeout(15_000)}).then(response => { if (!response.ok) throw Error(`bus stops: ${response.status}`); return response.json() }))
  let loadState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle', attempts = 0, retryAt = 0
  let index: StopIndex | undefined, excluded: string[] = []
  let slotOf = new Int16Array(0), distance = new Float64Array(0)
  const wanted: BusStop[] = []
  const atlas = new NameAtlas()
  const solids = new SolidGrid()
  let elapsed = 0, selectedAt = -Infinity, selectX = NaN, selectZ = NaN, cursor = 0, drawnBudget = 0, drawnCount = 0
  let atlasReady = false, textureDirty = false, uploadAt = 0, hidden = false
  let lastFocus: {x: number, z: number} | null = null

  const pool: Slot[] = Array.from({length: MAX_SHOWN}, (_, index): Slot => ({
    index, stop: null, state: 'waiting', shelter: 'off',
    px: new Float64Array(POINTS), pz: new Float64Array(POINTS), support: new Float64Array(POINTS).fill(NaN),
    drawn: new Array(POINTS).fill(undefined), drawnFor: new Float64Array(POINTS).fill(NaN), drawnAt: new Float64Array(POINTS), drawnSince: new Float64Array(POINTS).fill(-1),
    poleY: NaN, shelterY: NaN, feet: new Float64Array(4).fill(NaN), spread: NaN,
    looks: 0, wrong: 0, dueAt: 0, wants: false, distanceSq: 0, cell: -1, showsName: false, painted: false,
    local: [], solids: Array.from({length: 6}, () => ({x: 0, y: 0, z: 0, yaw: 0, halfWidth: 0, halfLength: 0, height: 0})), releases: new Array(6).fill(undefined),
  }))
  const scratch = {x: 0, z: 0}

  // ——— geometry ———

  function collapse(attribute: ReturnType<typeof dynamic>, start: number, count: number, itemSize: number) {
    attribute.attribute.array.fill(0, start * itemSize, (start + count) * itemSize)
    attribute.range(start * itemSize, count * itemSize)
  }

  /** Writes the pole and (when up) the shelter of a slot; collapses what is not drawn. */
  function writeSolid(slot: Slot) {
    const stop = slot.stop, start = slot.index * STRIDE
    if (!stop || slot.state !== 'drawn') { collapse(positions, start, STRIDE, 3); collapse(normals, start, STRIDE, 3); return }
    const p = positions.attribute.array as Float32Array, n = normals.attribute.array as Float32Array
    const {x, z, tx, tz, nx, nz} = stop
    let o = start * 3
    for (let v = 0, i = 0; v < pole.count; v++, i += 3, o += 3) {
      const lx = pole.position[i], ly = pole.position[i + 1], lz = pole.position[i + 2]
      p[o] = x + lx * tx + lz * nx; p[o + 1] = slot.poleY + ly; p[o + 2] = z + lx * tz + lz * nz
      const ax = pole.normal[i], az = pole.normal[i + 2]
      n[o] = ax * tx + az * nx; n[o + 1] = pole.normal[i + 1]; n[o + 2] = ax * tz + az * nz
    }
    if (slot.shelter === 'up') {
      const side = stop.side, low = Math.min(slot.feet[0], slot.feet[1], slot.feet[2], slot.feet[3])
      for (let t = 0; t < shelter.count; t += 3) for (let k = 0; k < 3; k++) {
        // Mirrored for side −1: x flips, so each triangle is written the other way round to stay front-facing.
        const v = t + (side > 0 ? k : k === 0 ? 0 : 3 - k), i = v * 3
        const lx = shelter.position[i] * side, lz = shelter.position[i + 2], tag = shelter.tag[v]
        const y = tag === TAG_NONE ? slot.shelterY + shelter.position[i + 1] : (tag === TAG_LOW ? low : slot.feet[tag]) - BURIED
        p[o] = x + lx * tx + lz * nx; p[o + 1] = y; p[o + 2] = z + lx * tz + lz * nz
        const ax = shelter.normal[i] * side, az = shelter.normal[i + 2]
        n[o] = ax * tx + az * nx; n[o + 1] = shelter.normal[i + 1]; n[o + 2] = ax * tz + az * nz
        o += 3
      }
    } else { p.fill(0, o, o + shelter.count * 3); n.fill(0, o, o + shelter.count * 3) }
    positions.range(start * 3, STRIDE * 3)
    normals.range(start * 3, STRIDE * 3)
  }

  /** Corners of one textured quad (bottom-left, bottom-right, top-right, top-left as seen) in the stop frame. */
  function writeQuad(slot: Slot, quad: number, along: number[], up: number[], out: number[], normalAlong: number, normalOut: number) {
    const stop = slot.stop!, base = slot.index * QUADS * QUAD_VERTS + quad * QUAD_VERTS
    const p = facePositions.attribute.array as Float32Array, n = faceNormals.attribute.array as Float32Array
    for (let corner = 0; corner < 4; corner++) {
      const o = (base + corner) * 3
      toWorld(stop, along[corner], out[corner], scratch)
      p[o] = scratch.x; p[o + 1] = up[corner]; p[o + 2] = scratch.z
      n[o] = normalAlong * stop.tx + normalOut * stop.nx; n[o + 1] = 0; n[o + 2] = normalAlong * stop.tz + normalOut * stop.nz
    }
  }

  const FACE_X = SIGN_THICK / 2 + FACE_LIFT
  const FACE_OUT0 = SIGN_OUT0 - SIGN_FRAME, FACE_OUT1 = SIGN_OUT1 + SIGN_FRAME
  const FACE_Y0 = SIGN_BOTTOM + SIGN_FRAME, FACE_Y3 = SIGN_BOTTOM + SIGN_HEIGHT - SIGN_FRAME
  const FACE_Y1 = FACE_Y0 + SIGN_FACE_HEIGHT * SIGN_FOOT, FACE_Y2 = FACE_Y3 - SIGN_FACE_HEIGHT * SIGN_HEADER
  const BANDS = [[FACE_Y2, FACE_Y3], [FACE_Y1, FACE_Y2], [FACE_Y0, FACE_Y1]]
  const along4 = [0, 0, 0, 0], up4 = [0, 0, 0, 0], out4 = [0, 0, 0, 0]

  function writeFaces(slot: Slot) {
    const start = slot.index * QUADS * QUAD_VERTS
    if (!slot.stop || slot.state !== 'drawn') { collapse(facePositions, start, QUADS * QUAD_VERTS, 3); return }
    for (let face = 0; face < 2; face++) {
      // Face +t is read from +t: its right hand points along −n, away from the pole; face −t the other way.
      const sign = face === 0 ? 1 : -1, left = face === 0 ? FACE_OUT0 : FACE_OUT1, right = face === 0 ? FACE_OUT1 : FACE_OUT0
      for (let band = 0; band < 3; band++) {
        const [y0, y1] = BANDS[band]
        along4.fill(sign * FACE_X)
        up4[0] = up4[1] = slot.poleY + y0; up4[2] = up4[3] = slot.poleY + y1
        out4[0] = out4[3] = left; out4[1] = out4[2] = right
        writeQuad(slot, face * 3 + band, along4, up4, out4, sign, 0)
      }
    }
    if (slot.shelter === 'up') {
      const centre = slot.stop.side * SHELTER_OFFSET, half = FASCIA_TEXT_WIDTH / 2, y0 = slot.shelterY + FASCIA_BOTTOM + .025
      along4[0] = along4[3] = centre - half; along4[1] = along4[2] = centre + half
      up4[0] = up4[1] = y0; up4[2] = up4[3] = y0 + FASCIA_TEXT_HEIGHT
      out4.fill(FASCIA_OUT + FACE_LIFT)
      writeQuad(slot, 6, along4, up4, out4, 0, 1)
    } else (facePositions.attribute.array as Float32Array).fill(0, (start + 6 * QUAD_VERTS) * 3, (start + QUADS * QUAD_VERTS) * 3)
    facePositions.range(start * 3, QUADS * QUAD_VERTS * 3)
    faceNormals.range(start * 3, QUADS * QUAD_VERTS * 3)
  }

  function setUv(slot: Slot, quad: number, rect: Rect, inset: number) {
    const [u0, v0, u1, v1] = uvOf(rect, inset), uv = faceUvs.attribute.array as Float32Array
    const o = (slot.index * QUADS * QUAD_VERTS + quad * QUAD_VERTS) * 2
    uv[o] = u0; uv[o + 1] = v0; uv[o + 2] = u1; uv[o + 3] = v0; uv[o + 4] = u1; uv[o + 5] = v1; uv[o + 6] = u0; uv[o + 7] = v1
  }

  /** Points the slot's faces at its painted name, or at the pictogram panel and a plain blue band until then. */
  function writeUvs(slot: Slot) {
    const named = slot.cell >= 0 && slot.showsName
    for (let face = 0; face < 2; face++) {
      setUv(slot, face * 3, HEADER_RECT, .5)
      setUv(slot, face * 3 + 1, named ? flagCellRect(slot.cell) : ICON_RECT, .5)
      setUv(slot, face * 3 + 2, SWATCH_ORANGE, 16)
    }
    setUv(slot, 6, named ? fasciaCellRect(slot.cell) : SWATCH_BLUE, named ? .5 : 16)
    faceUvs.range(slot.index * QUADS * QUAD_VERTS * 2, QUADS * QUAD_VERTS * 2)
  }

  // ——— the name atlas ———

  const GLYPH = flagCellRect(0).w * .86 / FLAG_UNITS

  function paintBase() {
    atlasReady = true
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, ATLAS_SIZE, fasciaCellRect(0).y)
    ctx.fillStyle = BLUE; ctx.fillRect(0, fasciaCellRect(0).y, ATLAS_SIZE, ATLAS_SIZE - fasciaCellRect(0).y)
    ctx.fillStyle = ORANGE; ctx.fillRect(SWATCH_ORANGE.x, SWATCH_ORANGE.y, SWATCH_ORANGE.w, SWATCH_ORANGE.h)
    ctx.fillStyle = BLUE; ctx.fillRect(SWATCH_BLUE.x, SWATCH_BLUE.y, SWATCH_BLUE.w, SWATCH_BLUE.h)
    // Header: drawn in its physical proportions (0.58 × 0.23 m), squeezed into the 320 × 140 cell.
    const h = HEADER_RECT.h, wide = h * SIGN_FACE_WIDTH / (SIGN_FACE_HEIGHT * SIGN_HEADER)
    ctx.fillStyle = BLUE; ctx.fillRect(HEADER_RECT.x, HEADER_RECT.y, HEADER_RECT.w, HEADER_RECT.h)
    ctx.setTransform(HEADER_RECT.w / wide, 0, 0, 1, HEADER_RECT.x, HEADER_RECT.y)
    const px = h * .44
    ctx.font = `600 ${px}px ${FONT}`
    const label = '公交站', width = Math.min(ctx.measureText(label).width, wide * .55), icon = h * .58, gap = h * .14
    const left = (wide - (icon * .8 + gap + width)) / 2
    drawBus(ctx, left + icon * .4, h / 2, icon, '#ffffff', BLUE)
    ctx.setTransform(HEADER_RECT.w / wide, 0, 0, 1, HEADER_RECT.x, HEADER_RECT.y)
    fitText(ctx, label, left + icon * .8 + gap + width / 2, h / 2 + px * .36, px, width, '#ffffff')
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#ffffff'; ctx.fillRect(ICON_RECT.x, ICON_RECT.y, ICON_RECT.w, ICON_RECT.h)
    drawBus(ctx, ICON_RECT.x + ICON_RECT.w / 2, ICON_RECT.y + ICON_RECT.h / 2, ICON_RECT.h * .5, BLUE, '#ffffff')
    textureDirty = true
  }

  function paintName(slot: Slot) {
    const stop = slot.stop!, cell = slot.cell
    if (ctx) {
      const flag = flagCellRect(cell), layout = layoutFlagName(stop.name, stop.en)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = '#ffffff'; ctx.fillRect(flag.x, flag.y, flag.w, flag.h)
      const rows: {text: string, px: number, ink: string}[] = []
      for (const line of layout.lines) rows.push({text: line.text, px: GLYPH * line.size, ink: INK})
      if (layout.sub) rows.push({text: layout.sub.text, px: GLYPH * layout.sub.size, ink: SUB_INK})
      if (layout.en) rows.push({text: layout.en.text, px: GLYPH * layout.en.size, ink: EN_INK})
      const iconH = layout.icon ? flag.h * .42 : 0
      const total = rows.reduce((sum, row) => sum + row.px * 1.22, 0) + iconH
      let y = flag.y + (flag.h - total) / 2
      if (layout.icon) { drawBus(ctx, flag.x + flag.w / 2, y + iconH / 2, iconH * .92, BLUE, '#ffffff'); y += iconH }
      for (const row of rows) {
        fitText(ctx, row.text, flag.x + flag.w / 2, y + row.px * 1.03, row.px, flag.w * .9, row.ink)
        y += row.px * 1.22
      }
      const band = fasciaCellRect(cell), line = layoutFasciaName(stop.name)
      ctx.fillStyle = BLUE; ctx.fillRect(band.x, band.y, band.w, band.h)
      if (line) { const px = band.h * .76 * line.size; fitText(ctx, line.text, band.x + band.w / 2, band.y + band.h / 2 + px * .37, px, band.w * .94, '#ffffff') }
      textureDirty = true
    }
    atlas.markPainted(cell, stop.key)
    // Without a texture there is nothing to wait for.
    if (texture) slot.painted = true
    else { slot.showsName = true; writeUvs(slot) }
  }

  // ——— heights ———

  const pointsOf = (slot: Slot) => slot.stop?.shelter ? POINTS : 1

  function baseOf(slot: Slot, point: number) {
    const drawn = slot.drawn[point], support = slot.support[point]
    return typeof drawn === 'number' && Math.abs(drawn - support) <= HEIGHT_BAND ? drawn : support
  }

  function wantsDrawn(slot: Slot, point: number) {
    if (Number.isNaN(slot.support[point])) return false
    return slot.drawn[point] === undefined || Math.abs(slot.support[point] - slot.drawnFor[point]) > SAME_HEIGHT || elapsed - slot.drawnAt[point] >= DRAWN_RECHECK
  }

  /** Drawn-ground readings for the slot's points that need one, while the frame has any left. */
  function readDrawn(slot: Slot) {
    slot.wants = false
    if (!drawnAt) return
    for (let point = 0; point < pointsOf(slot); point++) {
      if (!wantsDrawn(slot, point)) continue
      if (drawnBudget <= 0) { slot.wants = true; return }
      drawnBudget--
      let value = drawnAt(slot.px[point], slot.pz[point], slot.support[point])
      if (value === undefined) {
        if (slot.drawnSince[point] < 0) slot.drawnSince[point] = elapsed
        if (elapsed - slot.drawnSince[point] < DRAWN_WAIT) { slot.wants = true; return }
        value = slot.drawn[point] === undefined ? null : slot.drawn[point]
      }
      slot.drawnSince[point] = -1
      slot.drawn[point] = value
      slot.drawnFor[point] = slot.support[point]
      slot.drawnAt[point] = elapsed
    }
  }

  /** Bases from the readings; true when anything drawn moved (the slot is then written again). */
  function settle(slot: Slot) {
    const stop = slot.stop!
    let moved = false
    const poleY = baseOf(slot, 0)
    if (slot.state !== 'drawn' || Math.abs(poleY - slot.poleY) > SAME_HEIGHT) moved = true
    slot.poleY = poleY
    let next: ShelterState = 'off'
    if (stop.shelter) {
      let read = true
      for (let k = 1; k < POINTS; k++) if (Number.isNaN(slot.support[k])) read = false
      if (!read) next = slot.shelter === 'up' ? 'up' : 'waiting'
      else {
        for (let k = 0; k < 4; k++) {
          const y = baseOf(slot, k + 1)
          if (!(Math.abs(y - slot.feet[k]) <= SAME_HEIGHT)) moved = true
          slot.feet[k] = y
        }
        const {base, spread, ok} = shelterBase(slot.feet)
        slot.spread = spread
        next = ok ? 'up' : 'skipped'
        if (ok && !(Math.abs(base - slot.shelterY) <= SAME_HEIGHT)) moved = true
        if (ok) slot.shelterY = base
      }
    }
    if (next !== slot.shelter) moved = true
    slot.shelter = next
    return moved
  }

  /** Stops written this frame; where the catch-up readings carry on next frame. */
  let stood = 0, wantsCursor = 0

  function stand(slot: Slot) {
    const stop = slot.stop!
    stood++
    if (slot.state !== 'drawn') { slot.state = 'drawn'; drawnCount++ }
    writeSolid(slot)
    writeFaces(slot)
    for (let i = 0; i < slot.releases.length; i++) { slot.releases[i]?.(); slot.releases[i] = undefined }
    // From the lower of drawn base and collider up to the full height above the higher, as the bollards.
    const support = slot.support[0], poleSolid = slot.solids[0], local = slot.local
    let low = Math.min(slot.poleY, support)
    Object.assign(poleSolid, {x: stop.x, z: stop.z, y: low, yaw: stop.yaw, halfWidth: local[0].halfAlong, halfLength: local[0].halfOut, height: POLE_HEIGHT + Math.abs(slot.poleY - support)})
    slot.releases[0] = solids.add(poleSolid)
    if (slot.shelter !== 'up') return
    low = Infinity
    for (let k = 0; k < 4; k++) low = Math.min(low, slot.feet[k], slot.support[k + 1])
    for (let i = 1; i < local.length; i++) {
      const part = local[i], solid = slot.solids[i]
      toWorld(stop, part.along, part.out, scratch)
      Object.assign(solid, {x: scratch.x, z: scratch.z, y: low, yaw: stop.yaw, halfWidth: part.halfAlong, halfLength: part.halfOut, height: slot.shelterY - low + part.height})
      slot.releases[i] = solids.add(solid)
    }
  }

  function lookAt(slot: Slot) {
    const stop = slot.stop!
    const walked = groundAt(stop.x, stop.z, GROUND_REFERENCE, false)
    if (walked === undefined) { slot.dueAt = elapsed + RETRY; return }
    // The pole stands on the pavement like the columns: the walking collider. (The driving one reads the ground
    // under a pavement slab, 0.3 m down: a pole left there where nothing drawn can be read would be sunk.)
    const y = walked
    // A settled stop does not follow a reading far from where it stands (a tile reloading, a stray collider).
    if (slot.state === 'drawn' && slot.looks >= SETTLE_LOOKS && Math.abs(y - slot.support[0]) > HEIGHT_BAND) {
      slot.dueAt = elapsed + (++slot.wrong >= WRONG_SURFACE_LOOKS ? WRONG_SURFACE_RETRY : RETRY)
      return
    }
    slot.wrong = 0
    let moved = !(Math.abs(y - slot.support[0]) <= SAME_HEIGHT)
    slot.support[0] = y
    if (stop.shelter) for (let k = 0; k < 4; k++) {
      const foot = groundAt(slot.px[k + 1], slot.pz[k + 1], GROUND_REFERENCE, false)
      if (foot === undefined) continue
      // As the pole: a settled column does not follow one reading far from where it stands.
      if (slot.state === 'drawn' && slot.looks >= SETTLE_LOOKS && Math.abs(foot - slot.support[k + 1]) > HEIGHT_BAND) continue
      if (!(Math.abs(foot - slot.support[k + 1]) <= SAME_HEIGHT)) moved = true
      slot.support[k + 1] = foot
    }
    readDrawn(slot)
    if (settle(slot) || moved) { slot.looks = 1; stand(slot) }
    else slot.looks++
    const open = slot.shelter === 'waiting'
    slot.dueAt = elapsed + (open ? RETRY : slot.looks < SETTLE_LOOKS ? RECHECK : SETTLED_RECHECK)
  }

  // ——— which stops ———

  const isShown = (stop: BusStop) => slotOf[stop.id] >= 0

  function free(slot: Slot) {
    const stop = slot.stop!
    for (let i = 0; i < slot.releases.length; i++) { slot.releases[i]?.(); slot.releases[i] = undefined }
    if (stop.name) atlas.release(stop.key, elapsed)
    if (slot.state === 'drawn') drawnCount--
    slotOf[stop.id] = -1
    slot.stop = null
    slot.state = 'waiting'
    slot.painted = false
    writeSolid(slot)
    writeFaces(slot)
  }

  function assign(slot: Slot, stop: BusStop) {
    slot.stop = stop
    slotOf[stop.id] = slot.index
    slot.state = 'waiting'
    slot.shelter = stop.shelter ? 'waiting' : 'off'
    slot.px[0] = stop.x; slot.pz[0] = stop.z
    const feet = shelterFeet(stop)
    for (let k = 0; k < 4; k++) { toWorld(stop, feet[k].along, feet[k].out, scratch); slot.px[k + 1] = scratch.x; slot.pz[k + 1] = scratch.z }
    slot.support.fill(NaN); slot.drawn.fill(undefined); slot.drawnFor.fill(NaN); slot.drawnAt.fill(0); slot.drawnSince.fill(-1)
    slot.poleY = slot.shelterY = slot.spread = NaN; slot.feet.fill(NaN)
    slot.looks = 0; slot.wrong = 0; slot.dueAt = 0; slot.wants = false
    slot.local = stopSolids(stop, stop.shelter)
    slot.cell = stop.name ? atlas.acquire(stop.key, elapsed) : -1
    // A cell painted but not sent yet (the canvas goes up at most twice a second) is shown with that upload.
    const had = atlas.isPainted(slot.cell, stop.key)
    slot.showsName = had && !(texture && textureDirty)
    slot.painted = had && !slot.showsName
    writeUvs(slot)
  }

  let mark = new Uint32Array(0), generation = 0

  /** The nearest stops around `focus`: drawn ones no longer among them are let go, new ones take a free slot. */
  function select(focus: {x: number, z: number}) {
    selectedAt = elapsed; selectX = focus.x; selectZ = focus.z
    generation = (generation + 1) >>> 0 || 1
    selectStops(index!, focus.x, focus.z, isShown, wanted, distance)
    for (let i = 0; i < wanted.length; i++) mark[wanted[i].id] = generation
    for (let i = 0; i < MAX_SHOWN; i++) { const slot = pool[i]; if (slot.stop && mark[slot.stop.id] !== generation) free(slot) }
    for (let i = 0; i < wanted.length; i++) {
      const stop = wanted[i]
      if (slotOf[stop.id] < 0) {
        let slot: Slot | undefined
        for (let j = 0; j < MAX_SHOWN && !slot; j++) if (!pool[j].stop) slot = pool[j]
        if (!slot) break
        assign(slot, stop)
      }
      pool[slotOf[stop.id]].distanceSq = distance[stop.id]
    }
  }

  function ready(parsed: {stops: BusStop[], excluded: string[]}) {
    index = new StopIndex(parsed.stops)
    excluded = parsed.excluded
    const rows = parsed.stops.reduce((most, stop) => Math.max(most, stop.id + 1), 0)
    slotOf = new Int16Array(rows).fill(-1)
    distance = new Float64Array(rows)
    mark = new Uint32Array(rows)
    loadState = 'ready'
  }

  function startLoad() {
    if (loadState !== 'idle' || elapsed < retryAt) return
    loadState = 'loading'
    attempts++
    let pending: Promise<unknown>
    try { pending = Promise.resolve(load()) } catch (error) { pending = Promise.reject(error) }
    pending.then(data => {
      const parsed = parseBusStops(data)
      if (!parsed) throw Error('bus stops: not a version 1 file')
      ready(parsed)
    }).catch(error => {
      if (attempts >= LOAD_ATTEMPTS) { loadState = 'failed'; console.warn('Bus stops unavailable', error) }
      else { loadState = 'idle'; retryAt = elapsed + LOAD_RETRY }
    })
  }

  function show() {
    const visible = drawnCount > 0 && !hidden
    mesh.visible = visible
    faces.visible = visible
  }

  return {
    mesh,
    faces,
    texture,
    /** Vertices per slot in `mesh` (pole and sign first, then the shelter); `faces` has 7 quads per slot. */
    vertices: {stride: STRIDE, pole: pole.count, shelter: shelter.count},
    /** Loads the stops the first time; then keeps the nearest 24 around `focus` stood on the ground. */
    update(dt: number, focus: {x: number, z: number}) {
      elapsed += dt
      hidden = false
      if (loadState !== 'ready') { startLoad(); show(); return }
      lastFocus = focus
      let paints = NAMES_PER_FRAME
      if (!atlasReady) { paintBase(); paints-- }
      if (elapsed - selectedAt >= SELECT_EVERY || (focus.x - selectX) ** 2 + (focus.z - selectZ) ** 2 > SELECT_MOVE ** 2) select(focus)
      let budget = LANDS_PER_FRAME
      drawnBudget = DRAWN_PER_FRAME
      stood = 0
      for (let remaining = MAX_SHOWN; remaining > 0 && budget > 0; remaining--) {
        if (cursor >= MAX_SHOWN) cursor = 0
        const slot = pool[cursor++]
        if (!slot.stop || slot.dueAt > elapsed) continue
        budget--
        lookAt(slot)
      }
      // Stops whose drawn-ground readings did not fit last time: as many more as the frame has left.
      // They take turns (one still waiting for its tile does not keep the others from theirs), and a frame
      // writes no more stops than it lands.
      for (let i = 0; i < MAX_SHOWN && drawnBudget > 0 && stood < LANDS_PER_FRAME; i++) {
        if (wantsCursor >= MAX_SHOWN) wantsCursor = 0
        const slot = pool[wantsCursor++]
        if (!slot.stop || !slot.wants || Number.isNaN(slot.support[0])) continue
        readDrawn(slot)
        if (settle(slot)) { slot.looks = 1; slot.dueAt = elapsed + RECHECK; stand(slot) }
      }
      // One name a frame, nearest first.
      for (; paints > 0; paints--) {
        let best: Slot | undefined
        for (let i = 0; i < MAX_SHOWN; i++) { const slot = pool[i]; if (slot.stop && slot.cell >= 0 && !slot.showsName && !slot.painted && (!best || slot.distanceSq < best.distanceSq)) best = slot }
        if (!best) break
        paintName(best)
      }
      if (texture && textureDirty && elapsed >= uploadAt) {
        texture.needsUpdate = true; textureDirty = false; uploadAt = elapsed + UPLOAD_EVERY
        // The faces turn to their names in the frame the canvas goes up: never to a cell the GPU still has an older name in.
        for (let i = 0; i < MAX_SHOWN; i++) { const slot = pool[i]; if (slot.stop && slot.painted) { slot.painted = false; slot.showsName = true; writeUvs(slot) } }
      }
      show()
    },
    /** Stop parts near a point, for contact resolution. Hidden stops block nothing. */
    near(x: number, z: number, visit: (solid: Solid) => void) {
      if (mesh.visible) solids.near(x, z, visit)
    },
    /** Street traffic is switched off: the stops go with it. The next `update` shows them again. */
    hide() {
      hidden = true
      if (mesh.visible) mesh.visible = false
      if (faces.visible) faces.visible = false
    },
    probe(): BusStopProbe {
      const active = pool.filter(slot => slot.stop)
      const settledOf = (slot: Slot) => slot.state === 'drawn' && slot.looks >= SETTLE_LOOKS && slot.shelter !== 'waiting'
      return {
        load: loadState, attempts, total: index?.stops.length ?? 0, excluded: [...excluded],
        shown: active.length, drawn: drawnCount, settled: active.filter(settledOf).length,
        visible: mesh.visible, drawCalls: mesh.visible && drawnCount > 0 ? (faces.visible ? 2 : 1) : 0,
        meshes: [mesh.name, faces.name],
        atlas: {...atlas.occupancy(), texture: !!texture},
        focus: lastFocus && {x: lastFocus.x, z: lastFocus.z},
        stops: active.map(slot => {
          const stop = slot.stop!, drawn = slot.state === 'drawn', up = drawn && slot.shelter === 'up'
          return {
            key: stop.key, slot: slot.index, x: stop.x, z: stop.z, yaw: stop.yaw, side: stop.side, shelter: stop.shelter, shelterState: slot.shelter, name: stop.name,
            state: slot.state, y: drawn ? slot.poleY : null, support: drawn ? slot.support[0] : null, settled: settledOf(slot),
            spread: Number.isNaN(slot.spread) ? null : slot.spread, cell: slot.cell, named: slot.showsName,
            corners: stop.shelter ? [0, 1, 2, 3].map(k => ({
              x: slot.px[k + 1], z: slot.pz[k + 1], y: Number.isNaN(slot.feet[k]) ? null : slot.feet[k],
              support: Number.isNaN(slot.support[k + 1]) ? null : slot.support[k + 1], bottom: up ? slot.feet[k] - BURIED : null,
            })) : [],
            outline: stop.shelter ? shelterOutline(stop).map(corner => ({...toWorld(stop, corner.along, corner.out, {x: 0, z: 0})})) : [],
          }
        }),
      }
    },
  }
}
