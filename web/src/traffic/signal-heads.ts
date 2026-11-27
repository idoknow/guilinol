// IDOK-399 — signal heads at every signalised junction in town.
//
// One pole per approach (see `signal-approach.ts`), all poles in one mesh and all lenses in another:
// two draw calls for the whole city, no per-head objects, no lights. Lens colours come from
// `citySignals` on the one `citySignalClock` and are rewritten only when a light changes.
import * as THREE from 'three'
import {mainDetail} from '../look/mirror-layer'
import {SolidGrid, type Solid} from './contact'
import {SIGNAL_LENS_HEX, citySignalClock, citySignals} from './signals'
import {placeSignalHead, type HeadPlacement, type PlaceProgress, type SignalApproach, type SurfaceAt} from './signal-approach'

/** Junctions whose signals belong to a landmark model and are lit by their own overlay. */
export const LANDMARK_SIGNAL_GROUPS: ReadonlySet<number> = new Set([
  626322720, // 十字街 — gantries in the landmark, lit by `traffic-duty/traffic-signals-overlay.ts`
])

const POLE_HEX = 0x3a4046
const HOUSING_HEX = 0x16191d
const ARM_POLE_HEIGHT = 7.2
const ARM_Y = 6.9
const ARM_HEAD_Y = 6.05
const POST_POLE_HEIGHT = 3.75
const POST_HEAD_Y = 3.05
const HOUSING = {width: .5, height: 1.3, depth: .24}
const LENS_RADIUS = .14
const LENS_SEGMENTS = 12
const LENS_GAP = .4
/** Lens order inside a head, top to bottom; also the value of `shown`. 3 = all dark. */
const LENS_ORDER = ['red', 'yellow', 'green'] as const
/** Vertices of one head's three lens discs. */
const LENS_VERTICES = LENS_SEGMENTS * 3 * LENS_ORDER.length
const DARK = 3
/** Tiles further than this have not streamed in; do not bother scanning for a kerb there yet. */
const PLACE_RADIUS = 420
const PLACE_INTERVAL = .1
/** An approach whose tiles were not there is left alone this long before the next look. */
const PLACE_RETRY = 1.5

type Template = {position: Float32Array, normal: Float32Array, color: Float32Array, onArm: Uint8Array, count: number}

/** Flattens parts into one vertex list. Vertices of `onArm` parts slide outwards with the arm length. */
function template(parts: {geometry: THREE.BufferGeometry, hex: number, onArm?: boolean | ((x: number) => boolean)}[]): Template {
  const position: number[] = [], normal: number[] = [], color: number[] = [], onArm: number[] = []
  const tint = new THREE.Color()
  for (const part of parts) {
    const flat = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry
    const positions = flat.getAttribute('position'), normals = flat.getAttribute('normal')
    tint.setHex(part.hex)
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index)
      position.push(x, positions.getY(index), positions.getZ(index))
      normal.push(normals.getX(index), normals.getY(index), normals.getZ(index))
      color.push(tint.r, tint.g, tint.b)
      onArm.push((typeof part.onArm === 'function' ? part.onArm(x) : part.onArm) ? 1 : 0)
    }
    if (flat !== part.geometry) flat.dispose()
    part.geometry.dispose()
  }
  return {position: new Float32Array(position), normal: new Float32Array(normal), color: new Float32Array(color), onArm: new Uint8Array(onArm), count: onArm.length}
}

// Local frame of a head: origin at the pole base, +Y up, +Z towards oncoming drivers, +X towards the
// kerb side. The arm reaches over the road along −X; templates are built with a 1 m arm.
function buildTemplates() {
  const housing = (x: number, y: number, z: number) =>
    new THREE.BoxGeometry(HOUSING.width, HOUSING.height, HOUSING.depth).translate(x, y, z)
  const lenses = (x: number, y: number, z: number) => LENS_ORDER.map((_, index) =>
    ({geometry: new THREE.CircleGeometry(LENS_RADIUS, LENS_SEGMENTS).translate(x, y + (1 - index) * LENS_GAP, z), hex: 0, onArm: true}))
  const armFront = HOUSING.depth / 2 + .06, postFront = .09 + HOUSING.depth
  return {
    arm: template([
      {geometry: new THREE.CylinderGeometry(.075, .11, ARM_POLE_HEIGHT + .5, 8).translate(0, (ARM_POLE_HEIGHT - .5) / 2, 0), hex: POLE_HEX},
      {geometry: new THREE.CylinderGeometry(.055, .055, 1, 6).rotateZ(Math.PI / 2).translate(-.5, ARM_Y, 0), hex: POLE_HEX, onArm: x => x < -.5},
      {geometry: new THREE.BoxGeometry(.07, ARM_Y - ARM_HEAD_Y - HOUSING.height / 2, .07).translate(-1, (ARM_Y + ARM_HEAD_Y + HOUSING.height / 2) / 2, 0), hex: POLE_HEX, onArm: true},
      {geometry: housing(-1, ARM_HEAD_Y, .06), hex: HOUSING_HEX, onArm: true},
    ]),
    armLens: template(lenses(-1, ARM_HEAD_Y, armFront + .006)),
    post: template([
      {geometry: new THREE.CylinderGeometry(.07, .09, POST_POLE_HEIGHT + .5, 8).translate(0, (POST_POLE_HEIGHT - .5) / 2, 0), hex: POLE_HEX},
      {geometry: housing(0, POST_HEAD_Y, .09 + HOUSING.depth / 2), hex: HOUSING_HEX},
    ]),
    postLens: template(lenses(0, POST_HEAD_Y, postFront + .006).map(part => ({...part, onArm: false}))),
  }
}

type Head = {approach: SignalApproach, placement: HeadPlacement, slot: number}

export type SignalHeadProbe = {
  total: number
  pending: number
  /** Approaches with no kerb to stand on (bridge decks, tunnels). */
  none: number
  /** Approaches without a head: still waiting for street tiles, or given up. */
  unplaced: {key: string, x: number, z: number, state: 'pending' | 'none'}[]
  visible: boolean
  /** Meshes of the head group the renderer will draw: 2 while any head is shown, else 0. */
  drawCalls: number
  /** `shown` is read back from the lens colour buffer; `truth` is the city signal source at this instant. */
  heads: {key: string, node: number, group: number, lane: number, x: number, y: number, z: number, yaw: number, arm: number, back: number, kerb: number, shown: string, truth: string | null}[]
}

export function signalHeads(scene: THREE.Scene, surfaceAt: SurfaceAt) {
  const templates = buildTemplates()
  const structureVertices = Math.max(templates.arm.count, templates.post.count)
  const group = new THREE.Group()
  group.name = 'G2 signal heads'
  const structure = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({vertexColors: true}))
  structure.name = 'signal poles'
  const lens = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({vertexColors: true}))
  lens.name = 'signal lenses'
  group.add(structure, lens)
  group.visible = false
  scene.add(group)
  mainDetail(group)

  const lit = LENS_ORDER.map(name => new THREE.Color(SIGNAL_LENS_HEX[name].lit))
  const off = LENS_ORDER.map(name => new THREE.Color(SIGNAL_LENS_HEX[name].off))
  /** Kerb scans are kept for the session: junctions do not move, and a cell swap should not redo them. */
  const resolved = new Map<string, HeadPlacement | 'none'>()
  let approaches: SignalApproach[] = []
  let pending: {approach: SignalApproach, progress: PlaceProgress, retryAt: number}[] = []
  /** How far each unfinished kerb scan has got, kept across cell swaps like `resolved`. */
  const scans = new Map<string, PlaceProgress>()
  let heads: Head[] = []
  let shown = new Uint8Array(0)
  let structureUsed = 0
  let cursor = 0, placeTimer = 0, elapsed = 0
  let lensColor: THREE.BufferAttribute | undefined
  /** The poles as obstacles for the player on foot and at the wheel. Street NPCs never leave their lanes and paths. */
  const poles = new SolidGrid()

  function allocate(capacity: number) {
    for (const [mesh, vertices, shaded] of [[structure, capacity * structureVertices, true], [lens, capacity * LENS_VERTICES, false]] as const) {
      mesh.geometry.dispose()
      const geometry = mesh.geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3))
      if (shaded) geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3))
      geometry.setDrawRange(0, 0)
      geometry.boundingSphere = new THREE.Sphere()
    }
    lensColor = lens.geometry.getAttribute('color') as THREE.BufferAttribute
    lensColor.setUsage(THREE.DynamicDrawUsage)
    shown = new Uint8Array(capacity).fill(255)
    heads = []
    structureUsed = 0
    poles.clear()
  }

  function write(mesh: THREE.Mesh, source: Template, at: number, placement: HeadPlacement, withColor: boolean) {
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    const normal = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
    const cos = Math.cos(placement.yaw), sin = Math.sin(placement.yaw), slide = placement.arm - 1
    const out = position.array, outNormal = normal?.array
    for (let index = 0; index < source.count; index++) {
      const from = index * 3, to = (at + index) * 3
      const x = source.position[from] - source.onArm[index] * slide, z = source.position[from + 2]
      out[to] = placement.x + x * cos + z * sin
      out[to + 1] = placement.y + source.position[from + 1]
      out[to + 2] = placement.z - x * sin + z * cos
      if (!outNormal) continue
      const nx = source.normal[from], nz = source.normal[from + 2]
      outNormal[to] = nx * cos + nz * sin
      outNormal[to + 1] = source.normal[from + 1]
      outNormal[to + 2] = -nx * sin + nz * cos
    }
    position.addUpdateRange(at * 3, source.count * 3); position.needsUpdate = true
    if (normal) { normal.addUpdateRange(at * 3, source.count * 3); normal.needsUpdate = true }
    if (withColor) {
      const color = mesh.geometry.getAttribute('color') as THREE.BufferAttribute
      ;(color.array as Float32Array).set(source.color, at * 3)
      color.addUpdateRange(at * 3, source.count * 3); color.needsUpdate = true
    }
  }

  function add(approach: SignalApproach, placement: HeadPlacement) {
    const slot = heads.length
    const withArm = placement.arm > 0
    const body = withArm ? templates.arm : templates.post
    write(structure, body, structureUsed, placement, true)
    structureUsed += body.count
    write(lens, withArm ? templates.armLens : templates.postLens, slot * LENS_VERTICES, placement, false)
    heads.push({approach, placement, slot})
    poles.add({x: placement.x, y: placement.y, z: placement.z, yaw: placement.yaw, halfWidth: .11, halfLength: .11, height: withArm ? ARM_POLE_HEIGHT : POST_POLE_HEIGHT})
    structure.geometry.setDrawRange(0, structureUsed)
    lens.geometry.setDrawRange(0, heads.length * LENS_VERTICES)
    // One sphere around every pole, so the pair of meshes is culled when the town's lights are behind the camera.
    let x = 0, y = 0, z = 0
    for (const head of heads) { x += head.placement.x; y += head.placement.y; z += head.placement.z }
    const sphere = structure.geometry.boundingSphere!
    sphere.center.set(x / heads.length, y / heads.length, z / heads.length)
    sphere.radius = 0
    for (const head of heads) sphere.radius = Math.max(sphere.radius, Math.hypot(head.placement.x - sphere.center.x, head.placement.y - sphere.center.y, head.placement.z - sphere.center.z) + 12)
    lens.geometry.boundingSphere!.copy(sphere)
  }

  function paint(head: Head, state: number) {
    shown[head.slot] = state
    const array = lensColor!.array as Float32Array
    for (let which = 0; which < LENS_ORDER.length; which++) {
      const color = which === state ? lit[which] : off[which]
      const start = (head.slot * LENS_VERTICES + which * LENS_SEGMENTS * 3) * 3
      for (let at = start; at < start + LENS_SEGMENTS * 9; at += 3) { array[at] = color.r; array[at + 1] = color.g; array[at + 2] = color.b }
    }
    // Ranges pile up while the lights are off screen (nothing is uploaded then); past one per head, send the lot.
    if (lensColor!.updateRanges.length >= heads.length) lensColor!.clearUpdateRanges()
    else lensColor!.addUpdateRange(head.slot * LENS_VERTICES * 3, LENS_VERTICES * 3)
    lensColor!.needsUpdate = true
  }

  const stateOf = (head: Head) => {
    const color = citySignals.color(head.approach.node, head.approach.lane, citySignalClock.now)
    return color ? LENS_ORDER.indexOf(color) : DARK
  }

  return {
    group,
    /** Call when a road cell becomes the active one. Heads already placed for approaches still present stay put. */
    setApproaches(next: SignalApproach[]) {
      approaches = next
      allocate(next.length)
      pending = []
      for (const approach of next) {
        const known = resolved.get(approach.key)
        if (!known) {
          let progress = scans.get(approach.key)
          if (!progress) scans.set(approach.key, progress = {back: 0})
          pending.push({approach, progress, retryAt: 0})
        }
        else if (known !== 'none') add(approach, known)
      }
      cursor = 0
    },
    /** Every frame while street traffic is shown. `focus` is the player (or camera) position. */
    update(dt: number, focus: {x: number, z: number}) {
      elapsed += dt
      placeTimer -= dt
      if (placeTimer <= 0 && pending.length) {
        placeTimer = PLACE_INTERVAL
        // One short piece of one kerb scan per interval: round-robin over approaches whose tiles can
        // have streamed in, staying with an approach until its scan is through.
        for (let tries = pending.length; tries > 0; tries--) {
          const index = cursor % pending.length, {approach, progress, retryAt} = pending[index]
          cursor = index + 1
          if (retryAt > elapsed || (approach.endX - focus.x) ** 2 + (approach.endZ - focus.z) ** 2 > PLACE_RADIUS ** 2) continue
          const result = placeSignalHead(approach, surfaceAt, progress)
          if (result === 'more') cursor = index
          else if (result === 'pending') pending[index].retryAt = elapsed + PLACE_RETRY
          else {
            resolved.set(approach.key, result)
            scans.delete(approach.key)
            pending.splice(index, 1)
            cursor = index
            if (result !== 'none') add(approach, result)
          }
          break
        }
      }
      for (let index = 0; index < heads.length; index++) {
        const state = stateOf(heads[index])
        if (state !== shown[index]) paint(heads[index], state)
      }
      const visible = heads.length > 0
      if (group.visible !== visible) group.visible = visible
    },
    /** Poles near a point, for contact resolution. Hidden poles do not block anything. */
    near(x: number, z: number, visit: (solid: Solid) => void) {
      if (group.visible) poles.near(x, z, visit)
    },
    /** Street traffic is switched off: no lights either. The next `update` shows them again. */
    hide() {
      if (group.visible) group.visible = false
    },
    probe(): SignalHeadProbe {
      return {
        total: approaches.length, pending: pending.length,
        none: approaches.reduce((count, approach) => count + (resolved.get(approach.key) === 'none' ? 1 : 0), 0),
        unplaced: approaches.filter(approach => resolved.get(approach.key) === 'none' || !resolved.has(approach.key))
          .map(approach => ({key: approach.key, x: approach.endX, z: approach.endZ, state: resolved.has(approach.key) ? 'none' as const : 'pending' as const})),
        visible: group.visible, drawCalls: group.visible && group.parent === scene ? group.children.filter(child => child.visible).length : 0,
        heads: heads.map(head => {
          // Which lens is bright in the buffer the GPU draws from — not the bookkeeping in `shown`.
          const array = lensColor!.array as Float32Array
          const bright = LENS_ORDER.filter((_, which) => {
            const at = (head.slot * LENS_VERTICES + which * LENS_SEGMENTS * 3) * 3
            return Math.abs(array[at] - lit[which].r) + Math.abs(array[at + 1] - lit[which].g) + Math.abs(array[at + 2] - lit[which].b) < 1e-4
          })
          return {
            key: head.approach.key, node: head.approach.node, group: head.approach.group, lane: head.approach.lane, ...head.placement,
            shown: bright.length === 1 ? bright[0] : bright.length ? bright.join('+') : 'dark',
            truth: citySignals.color(head.approach.node, head.approach.lane, citySignalClock.now),
          }
        }),
      }
    },
  }
}
