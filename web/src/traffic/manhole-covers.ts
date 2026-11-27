// IDOK-399 — manhole covers and kerb gullies on the carriageway.
//
// Every cover of the loaded road cells (see `manhole-layout.ts`) is one textured quad, all in one mesh
// with one small picture atlas: one draw call for the whole town. Like the parking bays, a cover is
// draped over the road by asking for the ground height at its four corners once it is near the player,
// read a few times until the heights hold still, then only once in a while.
//
// The layout only knows the road graph. Whether a cover really lies on carriageway — and where the
// kerb is that a gully belongs against — is read off the street surface here, once per cover.
import * as THREE from 'three'
import {mainDetail} from '../look/mirror-layer'
import {MANHOLE_ATLAS_CELLS, MANHOLE_CORNERS, MANHOLE_INDICES, MANHOLE_VERTICES, manholeCorners, manholes, spacedManholes, writeManhole, type Manhole, type ManholeGraph} from './manhole-layout'
import type {GroundAt} from './parking-bays'
import type {SurfaceAt} from './signal-approach'

const SURFACE_ROAD = 0
const SURFACE_GUARDRAIL = 5
/** Covers further from the player than this are not draped yet: a 70 cm lid is a few pixels out there. */
const DRAPE_RADIUS = 90
/** Covers looked at per frame, four ground samples each. */
const LOOKS_PER_FRAME = 3
/** Covers passed over per frame while searching for one that is due. */
const SCAN_PER_FRAME = 256
const RETRY = 1.5
const RECHECK = 1
/** See `parking-bays.ts`: the road collider of a tile arrives after its terrain, so one reading is not trusted. */
const SETTLE_LOOKS = 3
const SETTLED_RECHECK = 8
const HEIGHT_BAND = .6
const WRONG_SURFACE_LOOKS = 6
const WRONG_SURFACE_RETRY = 30
const SAME_HEIGHT = .004
/** A lid lies flush; one corner this much off the plane of the others is a kerb or a step under the quad. */
const MAX_WARP = .05
/** Above the road, and a hair under the parking paint, which may run over a lid but not under it. */
const LIFT = .011
const UPLOAD_RANGES = 64
/** Road cells whose covers are kept: the one the player is in and the one just left. */
const CELLS_KEPT = 2
/** Clear space between a cover and the painted lines of a parking bay. */
const BAY_MARGIN = .45
/** A gully seed sits on its lane centre; the kerb is looked for this far to the right of it. */
const GULLY_FIRST = .75
/** Short of the next lane over: only the lane against the kerb gets the gully. */
const GULLY_LAST = 4.25
const GULLY_STEP = .25
/** Not road for this far past the kerb line: a pavement, not a painted or fenced strip. */
const GULLY_KERB_DEPTH = .6
/** Grate centre this far in from the kerb line: its edge a hand's width off the kerb stone. */
const GULLY_INSET = .3
const ATLAS_CELL = 256

type Slot = {
  /** As drawn: for a gully, moved from its seed to the kerb once the street surface was read. */
  cover: Manhole
  state: 'waiting' | 'drawn' | 'none'
  /** Position among the drawn covers, i.e. where its vertices are. */
  at: number
  heights: Float32Array
  looks: number
  wrong: number
  /** Not on the carriageway (or no kerb for a gully), and never will be: not looked at again. */
  dead: boolean
  /** A gully that has been moved from its seed to the kerb. */
  atKerb: boolean
  /** The street surface under it has been read and it has its final place. */
  placed: boolean
  /** Left out for a parking bay; looked at again when the bays change. */
  blocked: boolean
  dueAt: number
}

export type ManholeCoverProbe = {
  total: number
  drawn: number
  settled: number
  waiting: number
  none: number
  dead: number
  visible: boolean
  drawCalls: number
  /** Ground samples asked for since start, to check the per-frame budget. */
  samples: number
  covers: (Manhole & {state: Slot['state'], settled: boolean, heights: number[] | null})[]
}

/** One buffer that is sent whole the first time and in pieces after. three.js sends only the update ranges once there is one. */
function dynamic(array: Float32Array, itemSize: number) {
  const attribute = new THREE.BufferAttribute(array, itemSize)
  attribute.setUsage(THREE.DynamicDrawUsage)
  let whole = true
  attribute.onUpload(() => { whole = false })
  const all = () => {
    attribute.clearUpdateRanges()
    attribute.needsUpdate = whole = true
  }
  return {
    attribute, all,
    range(start: number, count: number) {
      if (whole) return
      if (attribute.updateRanges.length >= UPLOAD_RANGES) return all()
      attribute.addUpdateRange(start, count)
      attribute.needsUpdate = true
    },
  }
}

/**
 * The three lids, drawn once: a round cast-iron cover in its concrete seat, a kerb gully grate and a
 * square two-leaf cover. Greys only — the look pipeline lights and grades them with the road.
 */
function atlas() {
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_CELL * MANHOLE_ATLAS_CELLS
  canvas.height = ATLAS_CELL
  const ctx = canvas.getContext('2d')!
  const size = ATLAS_CELL, half = size / 2
  const iron = '#62666a', relief = '#7f8489', groove = '#26282a', seat = '#9a978f'

  // Round cover: 0.8 m cell, 0.70 m lid. Everything outside the seat ring stays transparent.
  ctx.save()
  ctx.translate(half, half)
  const disc = (radius: number, fill: string) => { ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill() }
  disc(half - 1, seat)
  disc(114, groove)
  disc(110, iron)
  ctx.save()
  ctx.beginPath(); ctx.arc(0, 0, 92, 0, Math.PI * 2); ctx.clip()
  ctx.fillStyle = relief
  // Anti-slip studs in a square grid, as on the common municipal lid.
  for (let x = -99; x < 100; x += 22) for (let y = -99; y < 100; y += 22) ctx.fillRect(x + 4, y + 4, 13, 13)
  ctx.restore()
  ctx.lineWidth = 5; ctx.strokeStyle = relief
  ctx.beginPath(); ctx.arc(0, 0, 100, 0, Math.PI * 2); ctx.stroke()
  disc(30, iron)
  ctx.lineWidth = 4
  ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.stroke()
  ctx.fillStyle = relief; ctx.fillRect(-16, -3, 32, 6)
  ctx.fillStyle = groove
  for (const x of [-78, 78]) { ctx.beginPath(); ctx.arc(x, 0, 6, 0, Math.PI * 2); ctx.fill() }
  ctx.restore()

  // Gully grate: the middle 0.6 of the cell across (0.45 m), all of it along (0.75 m). The rest is
  // filled with frame colour so the smaller mip levels do not pull in transparency.
  ctx.save()
  ctx.translate(size, 0)
  ctx.fillStyle = iron; ctx.fillRect(0, 0, size, size)
  const left = size * .2, wide = size * .6
  ctx.fillStyle = relief; ctx.fillRect(left + 5, 5, wide - 10, size - 10)
  ctx.fillStyle = iron; ctx.fillRect(left + 12, 12, wide - 24, size - 24)
  ctx.fillStyle = '#121314'
  // Slots across the flow, two columns with a rib between.
  for (let y = 22; y < size - 30; y += 24) for (const x of [left + 20, left + wide / 2 + 5]) ctx.fillRect(x, y, wide / 2 - 25, 13)
  ctx.restore()

  // Square cover: 0.6 m, two leaves with a diamond tread and a lifting slot each.
  ctx.save()
  ctx.translate(size * 2, 0)
  ctx.fillStyle = groove; ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = seat; ctx.fillRect(3, 3, size - 6, size - 6)
  ctx.fillStyle = groove; ctx.fillRect(14, 14, size - 28, size - 28)
  for (const x of [18, half + 2]) {
    ctx.fillStyle = iron; ctx.fillRect(x, 18, half - 20, size - 36)
    ctx.save()
    ctx.beginPath(); ctx.rect(x + 6, 24, half - 32, size - 48); ctx.clip()
    ctx.strokeStyle = relief; ctx.lineWidth = 4
    for (let offset = -size; offset < size * 2; offset += 20) {
      ctx.beginPath(); ctx.moveTo(x + offset, 18); ctx.lineTo(x + offset + size, 18 + size); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(x + offset + size, 18); ctx.lineTo(x + offset, 18 + size); ctx.stroke()
    }
    ctx.restore()
    ctx.fillStyle = groove; ctx.fillRect(x + (half - 20) / 2 - 14, half - 4, 28, 8)
  }
  ctx.restore()

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  // Seen at a shallow angle from a car or on foot: without this the lids smear into grey ovals.
  texture.anisotropy = 8
  return texture
}

export function manholeCovers(scene: THREE.Scene, groundAt: GroundAt, surfaceAt: SurfaceAt, blocked?: (x: number, z: number, margin: number) => boolean) {
  const material = new THREE.MeshLambertMaterial({map: atlas(), alphaTest: .5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2})
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
  mesh.name = 'G2 manhole covers'
  mesh.visible = false
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false
  mesh.userData.noShadowCast = true
  scene.add(mesh)
  mainDetail(mesh)

  /** Layout per road cell, newest last. */
  const cells = new Map<string, Manhole[]>()
  let slots = new Map<string, Slot>()
  /** Every cover that has, or may still get, a lid. Each is looked at when its `dueAt` comes, if it is near the player. */
  let active: Slot[] = []
  /** Drawn covers by vertex position, so one taken away can be filled with the last. */
  let shown: Slot[] = []
  let capacity = 0, cursor = 0, elapsed = 0, samples = 0
  let position: ReturnType<typeof dynamic> | undefined, uv: ReturnType<typeof dynamic> | undefined
  const corners = new Float32Array(MANHOLE_CORNERS * 2), sample = new Float32Array(MANHOLE_CORNERS)

  function allocate(covers: number) {
    capacity = 2 ** Math.ceil(Math.log2(Math.max(64, covers)))
    mesh.geometry.dispose()
    const geometry = mesh.geometry = new THREE.BufferGeometry()
    position = dynamic(new Float32Array(capacity * MANHOLE_VERTICES * 3), 3)
    uv = dynamic(new Float32Array(capacity * MANHOLE_VERTICES * 2), 2)
    geometry.setAttribute('position', position.attribute)
    geometry.setAttribute('uv', uv.attribute)
    const normal = new Float32Array(capacity * MANHOLE_VERTICES * 3)
    for (let index = 1; index < normal.length; index += 3) normal[index] = 1
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
    const index = new Uint32Array(capacity * MANHOLE_INDICES)
    for (let quad = 0; quad < capacity; quad++) index.set([quad * 4, quad * 4 + 1, quad * 4 + 2, quad * 4, quad * 4 + 2, quad * 4 + 3], quad * 6)
    geometry.setIndex(new THREE.BufferAttribute(index, 1))
  }

  function show() {
    mesh.geometry.setDrawRange(0, shown.length * MANHOLE_INDICES)
    mesh.visible = shown.length > 0
  }

  function write(slot: Slot) {
    writeManhole(slot.cover, slot.heights, LIFT, position!.attribute.array as Float32Array, uv!.attribute.array as Float32Array, slot.at * MANHOLE_VERTICES)
    position!.range(slot.at * MANHOLE_VERTICES * 3, MANHOLE_VERTICES * 3)
    uv!.range(slot.at * MANHOLE_VERTICES * 2, MANHOLE_VERTICES * 2)
  }

  /** Takes a drawn cover away: the last drawn one moves into its place. */
  function undraw(slot: Slot) {
    const last = shown[shown.length - 1]
    if (last !== slot) {
      last.at = slot.at
      shown[slot.at] = last
      write(last)
    }
    shown.pop()
    slot.at = -1
    slot.state = 'none'
    slot.looks = 0
    show()
  }

  /** `true` carriageway, `false` anything else, `undefined` the tile is not there yet. A fenced divider is not a place for a lid. */
  function road(x: number, z: number) {
    const kinds = surfaceAt(x, z)
    return kinds && kinds.includes(SURFACE_ROAD) && !kinds.includes(SURFACE_GUARDRAIL)
  }

  /** Centre and four corners on the carriageway? `undefined` while a tile is missing. */
  function onRoad(cover: Manhole) {
    const centre = road(cover.x, cover.z)
    if (!centre) return centre
    manholeCorners(cover, corners)
    for (let corner = 0; corner < MANHOLE_CORNERS; corner++) {
      const there = road(corners[corner * 2], corners[corner * 2 + 1])
      if (!there) return there
    }
    return true
  }

  /**
   * Moves a gully from its seed on the lane centre to the kerb on the right. `false`: no kerb within
   * reach (an inner lane, a square); `undefined`: a tile is missing.
   */
  function toKerb(slot: Slot) {
    const seed = slot.cover, rightX = -seed.headingZ, rightZ = seed.headingX
    const centre = road(seed.x, seed.z)
    if (!centre) return centre
    for (let side = GULLY_FIRST; side <= GULLY_LAST; side += GULLY_STEP) {
      const near = surfaceAt(seed.x + rightX * side, seed.z + rightZ * side)
      if (!near) return undefined
      if (near.includes(SURFACE_ROAD) || near.includes(SURFACE_GUARDRAIL)) continue
      const deep = surfaceAt(seed.x + rightX * (side + GULLY_KERB_DEPTH), seed.z + rightZ * (side + GULLY_KERB_DEPTH))
      if (!deep) return undefined
      if (deep.includes(SURFACE_ROAD) || deep.includes(SURFACE_GUARDRAIL)) continue
      // Close in on the kerb line between the last road sample and this one.
      let inner = side - GULLY_STEP, kerb = side
      for (let pass = 0; pass < 3; pass++) {
        const middle = (inner + kerb) / 2, kinds = surfaceAt(seed.x + rightX * middle, seed.z + rightZ * middle)
        if (!kinds) return undefined
        if (kinds.includes(SURFACE_ROAD) || kinds.includes(SURFACE_GUARDRAIL)) inner = middle
        else kerb = middle
      }
      const out = inner - GULLY_INSET
      slot.cover = {...seed, x: seed.x + rightX * out, z: seed.z + rightZ * out}
      slot.atKerb = true
      return true
    }
    return false
  }

  /** Looks at one cover. Returns false when there is nothing more to do for it. */
  function lookAt(slot: Slot): boolean {
    if (!slot.placed) {
      // A gully that has been to the kerb once keeps its place; only the bays are asked again.
      const moved = slot.cover.kind !== 1 || slot.atKerb ? true : toKerb(slot)
      const fits = moved && onRoad(slot.cover)
      if (moved === undefined || fits === undefined) { slot.dueAt = elapsed + RETRY; return true }
      if (!fits) {
        if (slot.state === 'drawn') undraw(slot)
        slot.dead = true
        slot.state = 'none'
        return false
      }
      slot.placed = true
      slot.blocked = Boolean(blocked?.(slot.cover.x, slot.cover.z, BAY_MARGIN))
      if (slot.blocked) {
        if (slot.state === 'drawn') undraw(slot)
        slot.state = 'none'
        return false
      }
    }
    const cover = slot.cover
    manholeCorners(cover, corners)
    for (let corner = 0; corner < MANHOLE_CORNERS; corner++) {
      samples++
      const y = groundAt(corners[corner * 2], corners[corner * 2 + 1], cover.y, true)
      if (y === undefined) { slot.dueAt = elapsed + RETRY; return true }
      if (Math.abs(y - cover.y) > HEIGHT_BAND) {
        const given = ++slot.wrong >= WRONG_SURFACE_LOOKS
        if (given && slot.state !== 'drawn') slot.state = 'none'
        slot.dueAt = elapsed + (given ? WRONG_SURFACE_RETRY : RETRY)
        return true
      }
      sample[corner] = y
    }
    // Opposite corners of a flat quad add up the same. A kerb or a step under one corner would stand the lid on edge.
    if (Math.abs(sample[0] + sample[2] - sample[1] - sample[3]) > MAX_WARP) {
      const given = ++slot.wrong >= WRONG_SURFACE_LOOKS
      if (given && slot.state !== 'drawn') slot.state = 'none'
      slot.dueAt = elapsed + (given ? WRONG_SURFACE_RETRY : RETRY)
      return true
    }
    slot.wrong = 0
    let moved = slot.state !== 'drawn'
    for (let corner = 0; corner < MANHOLE_CORNERS && !moved; corner++) moved = Math.abs(sample[corner] - slot.heights[corner]) > SAME_HEIGHT
    if (moved) {
      if (slot.state !== 'drawn') { slot.state = 'drawn'; slot.at = shown.length; shown.push(slot); slot.wrong = 0 }
      slot.heights.set(sample)
      slot.looks = 1
      write(slot)
      show()
    } else slot.looks++
    slot.dueAt = elapsed + (slot.looks < SETTLE_LOOKS ? RECHECK : SETTLED_RECHECK)
    return true
  }

  function rebuild() {
    const lists = [...cells.values()]
    const covers = lists.length === 1 ? lists[0] : spacedManholes(lists.flat()), before = slots
    if (covers.length > capacity) allocate(covers.length)
    slots = new Map()
    active = []
    shown = []
    cursor = 0
    for (const cover of covers) {
      const slot: Slot = before.get(cover.key)
        ?? {cover, state: 'waiting', at: -1, heights: new Float32Array(MANHOLE_CORNERS), looks: 0, wrong: 0, dead: false, atKerb: false, placed: false, blocked: false, dueAt: 0}
      slots.set(cover.key, slot)
      if (slot.state === 'drawn') {
        slot.at = shown.length
        shown.push(slot)
        writeManhole(slot.cover, slot.heights, LIFT, position!.attribute.array as Float32Array, uv!.attribute.array as Float32Array, slot.at * MANHOLE_VERTICES)
      }
      if (!slot.dead && !slot.blocked) active.push(slot)
    }
    position?.all()
    uv?.all()
    show()
  }

  return {
    mesh,
    /**
     * Call when a road cell becomes the active one. The covers of the cell just left are kept, so
     * the street behind the player does not go bare at a cell edge; covers already draped stay put.
     */
    setGraph(cell: string, graph: ManholeGraph) {
      const known = cells.get(cell) ?? manholes(graph)
      cells.delete(cell)
      cells.set(cell, known)
      while (cells.size > CELLS_KEPT) cells.delete(cells.keys().next().value!)
      rebuild()
    },
    /** The parking bays changed: every cover is checked against them again, drawn or not. */
    recheck() {
      if (!blocked) return
      active = []
      cursor = 0
      for (const slot of slots.values()) {
        if (slot.dead) continue
        slot.placed = slot.blocked = false
        if (slot.state === 'none') { slot.state = 'waiting'; slot.wrong = 0 }
        slot.dueAt = 0
        active.push(slot)
      }
    },
    /** Drapes a few more covers near `focus` over the road: at most `LOOKS_PER_FRAME` covers, four ground samples each. */
    update(dt: number, focus: {x: number, z: number}) {
      elapsed += dt
      if (!mesh.visible && shown.length) mesh.visible = true
      let budget = LOOKS_PER_FRAME
      for (let remaining = Math.min(active.length, SCAN_PER_FRAME); remaining > 0 && budget > 0; remaining--) {
        if (cursor >= active.length) cursor = 0
        const slot = active[cursor]
        if (slot.dueAt > elapsed || (slot.cover.x - focus.x) ** 2 + (slot.cover.z - focus.z) ** 2 > DRAPE_RADIUS ** 2) { cursor++; continue }
        budget--
        if (lookAt(slot)) cursor++
        else { active[cursor] = active[active.length - 1]; active.pop() }
      }
    },
    /** Street traffic is switched off: the covers go with it. The next `update` shows them again. */
    hide() {
      if (mesh.visible) mesh.visible = false
    },
    probe(): ManholeCoverProbe {
      const all = [...slots.values()]
      const count = (test: (slot: Slot) => boolean) => all.reduce((sum, slot) => sum + (test(slot) ? 1 : 0), 0)
      return {
        total: all.length, drawn: shown.length, settled: count(slot => slot.state === 'drawn' && slot.looks >= SETTLE_LOOKS),
        waiting: count(slot => slot.state === 'waiting'), none: count(slot => slot.state === 'none'), dead: count(slot => slot.dead),
        visible: mesh.visible, drawCalls: mesh.visible && mesh.parent === scene && shown.length > 0 ? 1 : 0, samples,
        covers: all.map(slot => ({...slot.cover, state: slot.state, settled: slot.looks >= SETTLE_LOOKS, heights: slot.state === 'drawn' ? [...slot.heights] : null})),
      }
    },
  }
}
