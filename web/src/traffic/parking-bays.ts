// IDOK-399 — painted parking bays along the kerbs.
//
// Every bay in the loaded parking cells (see `parking-layout.ts`) is three painted lines against the
// kerb — or a box of four where the cars stand out in a wide carriageway — all in one mesh: one draw
// call for the whole town, no per-bay objects. The lines are draped over the road by asking for the
// ground height at the four corners of each bay near the player. A bay is read a few times until
// its heights hold still, then only once in a while in case the ground under it was replaced.
import * as THREE from 'three'
import {vehicleForbiddenAt} from '../game/car-free'
import {look} from '../look/config'
import {mainDetail} from '../look/mirror-layer'
import {BAY_BOX_CLEARANCE, BAY_MOUTH_REACH, BAY_CORNERS, BAY_INDICES, BAY_VERTICES, bayCorners, parkingBays, writeBay, type ParkingBay, type ParkingRow} from './parking-layout'
import type {SurfaceAt} from './signal-approach'

/** Road height under a point, or `undefined` while the ground there has not loaded. `car` asks for the carriageway. */
export type GroundAt = (x: number, z: number, reference: number, car: boolean) => number | undefined

const SURFACE_ROAD = 0
/** Bays further from the player than this are not draped yet: a 10 cm line is under a pixel out there. */
const DRAPE_RADIUS = 110
/** Bays looked at per frame, four ground samples each. */
const LOOKS_PER_FRAME = 4
/** Bays passed over per frame while searching for one that is due, so a frame's work does not grow with the town. */
const SCAN_PER_FRAME = 256
/** Ground or street tile not there yet: look again after this long. */
const RETRY = 1.5
/** A drawn bay is looked at again after this long, until it has read the same `SETTLE_LOOKS` times. */
const RECHECK = 1
/**
 * The road collider of a tile arrives after its terrain — seconds later for a tile further off — and
 * until then the ground sample is the terrain under the road. So one reading is not trusted: a bay
 * counts as settled after the same heights have come back this many times, a second apart, and is
 * still read every `SETTLED_RECHECK` seconds after that, which also covers a tile being reloaded.
 */
const SETTLE_LOOKS = 3
const SETTLED_RECHECK = 8
/** A sample this far from the world data's road height is some other surface (a deck above, a pit below). */
const HEIGHT_BAND = .6
const WRONG_SURFACE_LOOKS = 6
/** After that many wrong readings the bay goes unpainted, and is only looked at again this often. */
const WRONG_SURFACE_RETRY = 30
const SAME_HEIGHT = .004
/** Paint thickness above the road; `polygonOffset` does the rest against z-fighting. */
const LIFT = .012
/** More partial uploads waiting than this and the whole buffer goes up at once instead. */
const UPLOAD_RANGES = 64

type Slot = {
  bay: ParkingBay
  state: 'waiting' | 'drawn' | 'none'
  /** Position among the drawn bays, i.e. where its vertices are. */
  at: number
  heights: Float32Array
  /** Consecutive looks that read the same heights. */
  looks: number
  wrong: number
  /** Not on the carriageway, and never will be: not looked at again. */
  dead: boolean
  surfaceChecked: boolean
  /** The carriageway goes on past the car towards the kerb: four lines instead of three. */
  boxed: boolean
  dueAt: number
}

export type ParkingBayProbe = {
  total: number
  occupied: number
  empty: number
  drawn: number
  /** Drawn bays that are a full box (cars standing out in a wide carriageway). */
  boxed: number
  settled: number
  waiting: number
  none: number
  visible: boolean
  drawCalls: number
  /** Ground samples asked for since start, to check the per-frame budget. */
  samples: number
  bays: (ParkingBay & {state: Slot['state'], boxed: boolean, settled: boolean, heights: number[] | null})[]
}

export function parkingBayLines(scene: THREE.Scene, groundAt: GroundAt, surfaceAt: SurfaceAt, forbidden: (x: number, z: number) => boolean = vehicleForbiddenAt) {
  const material = new THREE.MeshLambertMaterial({color: look.streets.surfaces[2], polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2})
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
  mesh.name = 'G2 parking bays'
  mesh.visible = false
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false
  mesh.userData.noShadowCast = true
  scene.add(mesh)
  mainDetail(mesh)

  let slots = new Map<string, Slot>()
  /** Every bay that has, or may still get, paint. Each is looked at when its `dueAt` comes, if it is near the player. */
  let active: Slot[] = []
  let capacity = 0, drawn = 0, cursor = 0, elapsed = 0, samples = 0
  let position: THREE.BufferAttribute | undefined
  /**
   * The whole position buffer is to go up at the next upload. three.js sends only the update ranges
   * once there is one, so no range may be added until that upload has happened.
   */
  let wholeDirty = true
  const corners = new Float32Array(BAY_CORNERS * 2), sample = new Float32Array(BAY_CORNERS)

  function allocate(bays: number) {
    capacity = 2 ** Math.ceil(Math.log2(Math.max(64, bays)))
    mesh.geometry.dispose()
    const geometry = mesh.geometry = new THREE.BufferGeometry()
    position = new THREE.BufferAttribute(new Float32Array(capacity * BAY_VERTICES * 3), 3)
    position.setUsage(THREE.DynamicDrawUsage)
    position.onUpload(() => { wholeDirty = false })
    wholeDirty = true
    geometry.setAttribute('position', position)
    const normal = new Float32Array(capacity * BAY_VERTICES * 3)
    for (let index = 1; index < normal.length; index += 3) normal[index] = 1
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
    const index = new Uint32Array(capacity * BAY_INDICES)
    for (let quad = 0; quad < capacity * BAY_VERTICES / 4; quad++) index.set([quad * 4, quad * 4 + 1, quad * 4 + 2, quad * 4, quad * 4 + 2, quad * 4 + 3], quad * 6)
    geometry.setIndex(new THREE.BufferAttribute(index, 1))
  }

  function show() {
    mesh.geometry.setDrawRange(0, drawn * BAY_INDICES)
    mesh.visible = drawn > 0
  }

  function uploadAll() {
    position!.clearUpdateRanges()
    position!.needsUpdate = wholeDirty = true
  }

  function write(slot: Slot) {
    writeBay(slot.bay, slot.heights, LIFT, position!.array as Float32Array, slot.at * BAY_VERTICES, slot.boxed)
    if (!wholeDirty) {
      if (position!.updateRanges.length >= UPLOAD_RANGES) uploadAll()
      else position!.addUpdateRange(slot.at * BAY_VERTICES * 3, BAY_VERTICES * 3)
    }
    position!.needsUpdate = true
  }

  /** What the street tile has at `side` metres towards the kerb, `along` metres up the bay: road, not road, or not loaded. */
  function roadBeside(bay: ParkingBay, along: number, side: number) {
    const kinds = surfaceAt(bay.x + bay.headingX * along - bay.headingZ * side, bay.z + bay.headingZ * along + bay.headingX * side)
    return kinds && kinds.includes(SURFACE_ROAD)
  }

  /** Looks at one bay. Returns false when there is nothing more to do for it: it has no paint and never will. */
  function lookAt(slot: Slot): boolean {
    const bay = slot.bay
    if (!slot.surfaceChecked) {
      const centre = roadBeside(bay, 0, 0)
      if (centre === undefined) { slot.dueAt = elapsed + RETRY; return true }
      // An empty bay is a guess between two parked cars: not where cars are kept out.
      let dead = !centre || (!bay.occupied && forbidden(bay.x, bay.z)), boxed = true
      for (let end = 0; end < 3 && !dead; end++) {
        const along = end === 0 ? -bay.rear : end === 1 ? 0 : bay.front
        // Carriageway all along the kerb side of the bay: the car is out in the road, so close the box.
        const beside = roadBeside(bay, along, BAY_BOX_CLEARANCE)
        if (beside === undefined) { slot.dueAt = elapsed + RETRY; return true }
        boxed &&= beside
        if (bay.occupied || !beside) continue
        // Still carriageway where any kerb would have come: the gap between the two cars is a side street.
        const mouth = roadBeside(bay, along, BAY_MOUTH_REACH)
        if (mouth === undefined) { slot.dueAt = elapsed + RETRY; return true }
        dead = mouth
      }
      slot.surfaceChecked = true
      if (dead) { slot.dead = true; slot.state = 'none'; return false }
      slot.boxed = boxed
    }
    bayCorners(bay, corners, slot.boxed)
    for (let corner = 0; corner < BAY_CORNERS; corner++) {
      samples++
      const y = groundAt(corners[corner * 2], corners[corner * 2 + 1], bay.y, true)
      if (y === undefined) { slot.dueAt = elapsed + RETRY; return true }
      if (Math.abs(y - bay.y) > HEIGHT_BAND) {
        // Some other surface (a deck above, terrain before its road arrived). Not given up for good:
        // whatever is there may be replaced, so the bay is read again now and then.
        const given = slot.state !== 'drawn' && ++slot.wrong >= WRONG_SURFACE_LOOKS
        if (given) slot.state = 'none'
        slot.dueAt = elapsed + (given ? WRONG_SURFACE_RETRY : RETRY)
        return true
      }
      sample[corner] = y
    }
    let moved = slot.state !== 'drawn'
    for (let corner = 0; corner < BAY_CORNERS && !moved; corner++) moved = Math.abs(sample[corner] - slot.heights[corner]) > SAME_HEIGHT
    if (moved) {
      if (slot.state !== 'drawn') { slot.state = 'drawn'; slot.at = drawn++; slot.wrong = 0 }
      slot.heights.set(sample)
      slot.looks = 1
      write(slot)
      show()
    } else slot.looks++
    slot.dueAt = elapsed + (slot.looks < SETTLE_LOOKS ? RECHECK : SETTLED_RECHECK)
    return true
  }

  return {
    mesh,
    /** The parked cars of the loaded parking cells. Bays already draped keep their heights. */
    setRows(rows: Iterable<ParkingRow>) {
      const bays = parkingBays(rows), before = slots
      if (bays.length > capacity) allocate(bays.length)
      slots = new Map()
      active = []
      drawn = cursor = 0
      for (const bay of bays) {
        const known = before.get(bay.key)
        const slot: Slot = known && known.bay.rear === bay.rear && known.bay.front === bay.front
          ? known
          : {bay, state: 'waiting', at: -1, heights: new Float32Array(BAY_CORNERS), looks: 0, wrong: 0, dead: false, surfaceChecked: false, boxed: false, dueAt: 0}
        slot.bay = bay
        slots.set(bay.key, slot)
        if (slot.state === 'drawn') {
          slot.at = drawn++
          writeBay(bay, slot.heights, LIFT, position!.array as Float32Array, slot.at * BAY_VERTICES, slot.boxed)
        }
        if (!slot.dead) active.push(slot)
      }
      if (position) uploadAll()
      show()
    },
    /** Drapes a few more bays near `focus` over the road: at most `LOOKS_PER_FRAME` bays, four ground samples each. */
    update(dt: number, focus: {x: number, z: number}) {
      elapsed += dt
      if (!mesh.visible && drawn) mesh.visible = true
      let budget = LOOKS_PER_FRAME
      for (let remaining = Math.min(active.length, SCAN_PER_FRAME); remaining > 0 && budget > 0; remaining--) {
        if (cursor >= active.length) cursor = 0
        const slot = active[cursor]
        if (slot.dueAt > elapsed || (slot.bay.x - focus.x) ** 2 + (slot.bay.z - focus.z) ** 2 > DRAPE_RADIUS ** 2) { cursor++; continue }
        budget--
        if (lookAt(slot)) cursor++
        else { active[cursor] = active[active.length - 1]; active.pop() }
      }
    },
    /** Street traffic is switched off: parked cars go, and so does their paint. The next `update` shows it again. */
    hide() {
      if (mesh.visible) mesh.visible = false
    },
    probe(): ParkingBayProbe {
      const all = [...slots.values()]
      const count = (test: (slot: Slot) => boolean) => all.reduce((sum, slot) => sum + (test(slot) ? 1 : 0), 0)
      return {
        total: all.length, occupied: count(slot => slot.bay.occupied), empty: count(slot => !slot.bay.occupied),
        drawn, boxed: count(slot => slot.state === 'drawn' && slot.boxed), settled: count(slot => slot.state === 'drawn' && slot.looks >= SETTLE_LOOKS),
        waiting: count(slot => slot.state === 'waiting'), none: count(slot => slot.state === 'none'),
        visible: mesh.visible, drawCalls: mesh.visible && mesh.parent === scene && drawn > 0 ? 1 : 0, samples,
        bays: all.map(slot => ({...slot.bay, state: slot.state, boxed: slot.boxed, settled: slot.looks >= SETTLE_LOOKS, heights: slot.state === 'drawn' ? [...slot.heights] : null})),
      }
    },
  }
}
