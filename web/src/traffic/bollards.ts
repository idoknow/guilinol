// IDOK-399 — the short posts along the pavement edge beside each signal pole.
//
// Where they stand comes from `bollard-layout.ts`, which follows the signal heads: a few posts either
// side of every pole, along the same kerb. This file waits for the heads to find their kerbs, stands
// the posts on the pavement (its height is read from the ground, like the parking paint), draws them
// as one instanced mesh — one draw call for the whole town — and makes them solid for the player.
import * as THREE from 'three'
import {mainDetail} from '../look/mirror-layer'
import {BOLLARD_HEIGHT, BOLLARD_RADIUS, placeBollards, separateBollards, type Bollard} from './bollard-layout'
import {SolidGrid, type Solid} from './contact'
import type {GroundAt} from './parking-bays'
import type {HeadPlacement, SignalApproach, SurfaceAt} from './signal-approach'

/** The signal heads, as far as the posts need them. */
export type BollardHeads = {
  readonly revision: number
  placed(visit: (approach: SignalApproach, placement: HeadPlacement) => void): void
}

/** Posts of one road cell: a few hundred at most. Any beyond this are left out rather than reallocating mid-game. */
const CAPACITY = 1024
/** Poles further than this have no street tiles under them yet. */
const PLACE_RADIUS = 420
/** Kerb checks per frame: one pole's posts, a few dozen surface lookups. */
const PLACES_PER_FRAME = 1
const PLACE_RETRY = 1.5
/** Posts further from the player than this are not stood up yet. */
const DRAPE_RADIUS = 140
/** Posts looked at per frame, one ground sample each. */
const LOOKS_PER_FRAME = 4
const SCAN_PER_FRAME = 256
const RETRY = 1.5
const RECHECK = 1
/** See `parking-bays.ts`: the pavement collider of a tile arrives after its terrain, so one reading is not trusted. */
const SETTLE_LOOKS = 3
const SETTLED_RECHECK = 8
/** The pavement is a kerb's height above the road; more than this from the road is a deck or a pit. */
const HEIGHT_BAND = .6
const WRONG_SURFACE_LOOKS = 6
const WRONG_SURFACE_RETRY = 30
const SAME_HEIGHT = .004
/**
 * The post and its collar carry on this far below the pavement. A slope never shows daylight under
 * them, and neither does the hand's width by which the walking collider can ride above the paving
 * that is drawn (the blocks beside a street are draped over coarser ground than they show).
 */
const BURIED = .3
const SIDES = 10
const BODY_HEX = 0x4a5057
const CAP_HEX = 0x5c636b
/** The reflective band: the yellow of the road's own yellow lines. */
const BAND_HEX = 0xe7b62e
/** A little wider than the post, so a wheel or a shoulder stops just short of it. */
const SOLID_HALF = BOLLARD_RADIUS + .02

type Slot = {
  post: Bollard
  state: 'waiting' | 'drawn' | 'none'
  /** Instance index while drawn. */
  at: number
  /** Pavement height under it. */
  y: number
  looks: number
  wrong: number
  dueAt: number
  solid?: Solid
  release?: () => void
}

export type BollardProbe = {
  total: number
  drawn: number
  settled: number
  waiting: number
  none: number
  /** Poles whose posts have not been worked out yet (street tiles still loading). */
  pending: number
  visible: boolean
  drawCalls: number
  posts: (Bollard & {state: Slot['state'], settled: boolean})[]
}

/** One post about its own axis, base at the origin: collar, body, yellow band, domed cap. */
function postGeometry() {
  const parts: {geometry: THREE.BufferGeometry, hex: number}[] = [
    {geometry: new THREE.CylinderGeometry(BOLLARD_RADIUS, BOLLARD_RADIUS, BOLLARD_HEIGHT + BURIED, SIDES, 1, true).translate(0, (BOLLARD_HEIGHT - BURIED) / 2, 0), hex: BODY_HEX},
    {geometry: new THREE.CylinderGeometry(BOLLARD_RADIUS + .025, BOLLARD_RADIUS + .035, .03 + BURIED, SIDES).translate(0, (.03 - BURIED) / 2, 0), hex: BODY_HEX},
    {geometry: new THREE.CylinderGeometry(BOLLARD_RADIUS + .004, BOLLARD_RADIUS + .004, .1, SIDES, 1, true).translate(0, BOLLARD_HEIGHT - .17, 0), hex: BAND_HEX},
    {geometry: new THREE.SphereGeometry(BOLLARD_RADIUS, SIDES, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, .55, 1).translate(0, BOLLARD_HEIGHT, 0), hex: CAP_HEX},
  ]
  const position: number[] = [], normal: number[] = [], color: number[] = []
  const tint = new THREE.Color()
  for (const part of parts) {
    const flat = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry
    const positions = flat.getAttribute('position'), normals = flat.getAttribute('normal')
    tint.setHex(part.hex)
    for (let index = 0; index < positions.count; index++) {
      position.push(positions.getX(index), positions.getY(index), positions.getZ(index))
      normal.push(normals.getX(index), normals.getY(index), normals.getZ(index))
      color.push(tint.r, tint.g, tint.b)
    }
    if (flat !== part.geometry) flat.dispose()
    part.geometry.dispose()
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3))
  return geometry
}

export function bollards(scene: THREE.Scene, groundAt: GroundAt, surfaceAt: SurfaceAt) {
  const mesh = new THREE.InstancedMesh(postGeometry(), new THREE.MeshLambertMaterial({vertexColors: true}), CAPACITY)
  mesh.name = 'G2 bollards'
  mesh.count = 0
  mesh.visible = false
  // Instances come and go; nothing keeps the bounds current, and the posts are spread over the whole cell anyway.
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.userData.noShadowCast = true
  scene.add(mesh)
  mainDetail(mesh)

  /** Kerb checks are kept for the session: junctions do not move, and a cell swap should not redo them. */
  const resolved = new Map<string, Bollard[]>()
  let current: {approach: SignalApproach, placement: HeadPlacement}[] = []
  let pending: {approach: SignalApproach, placement: HeadPlacement, retryAt: number}[] = []
  let slots = new Map<string, Slot>()
  let active: Slot[] = []
  let shown: Slot[] = []
  let seen = -1, dirty = false, placeCursor = 0, cursor = 0, elapsed = 0
  const solids = new SolidGrid()
  const matrix = new THREE.Matrix4()

  function stand(slot: Slot) {
    mesh.setMatrixAt(slot.at, matrix.makeTranslation(slot.post.x, slot.y, slot.post.z))
    mesh.instanceMatrix.needsUpdate = true
    slot.release?.()
    slot.solid = {x: slot.post.x, y: slot.y, z: slot.post.z, yaw: 0, halfWidth: SOLID_HALF, halfLength: SOLID_HALF, height: BOLLARD_HEIGHT}
    slot.release = solids.add(slot.solid)
  }

  function show() {
    mesh.count = shown.length
    mesh.visible = shown.length > 0
  }

  /** The set of posts changed (a pole found its kerb, a cell swap): keep what is still there, drop the rest. */
  function reconcile() {
    dirty = false
    const all: Bollard[] = []
    for (const {approach} of current) for (const post of resolved.get(approach.key) ?? []) all.push(post)
    const posts = separateBollards(all, current.map(item => item.placement)), before = slots
    if (posts.length > CAPACITY) posts.length = CAPACITY
    slots = new Map()
    active = []
    shown = []
    cursor = 0
    for (const post of posts) {
      const slot: Slot = before.get(post.key) ?? {post, state: 'waiting', at: -1, y: post.y, looks: 0, wrong: 0, dueAt: 0}
      before.delete(post.key)
      slots.set(post.key, slot)
      active.push(slot)
      if (slot.state !== 'drawn') continue
      slot.at = shown.length
      shown.push(slot)
      mesh.setMatrixAt(slot.at, matrix.makeTranslation(post.x, slot.y, post.z))
    }
    for (const gone of before.values()) gone.release?.()
    mesh.instanceMatrix.needsUpdate = true
    show()
  }

  function lookAt(slot: Slot) {
    const post = slot.post
    // What a walker stands on and what a wheel rests on: beside a kerb the lower of the two is the paving as drawn.
    const walked = groundAt(post.x, post.z, post.y, false), driven = groundAt(post.x, post.z, post.y, true)
    if (walked === undefined) { slot.dueAt = elapsed + RETRY; return }
    const y = driven !== undefined && driven < walked && walked - driven < HEIGHT_BAND ? driven : walked
    if (Math.abs(y - post.y) > HEIGHT_BAND) {
      const given = ++slot.wrong >= WRONG_SURFACE_LOOKS
      if (given && slot.state !== 'drawn') slot.state = 'none'
      slot.dueAt = elapsed + (given ? WRONG_SURFACE_RETRY : RETRY)
      return
    }
    slot.wrong = 0
    if (slot.state !== 'drawn' || Math.abs(y - slot.y) > SAME_HEIGHT) {
      if (slot.state !== 'drawn') { slot.state = 'drawn'; slot.at = shown.length; shown.push(slot); slot.wrong = 0 }
      slot.y = y
      slot.looks = 1
      stand(slot)
      show()
    } else slot.looks++
    slot.dueAt = elapsed + (slot.looks < SETTLE_LOOKS ? RECHECK : SETTLED_RECHECK)
  }

  return {
    mesh,
    /** Call every frame before `update`: picks up poles the signal heads have placed since last time. Cheap when nothing changed. */
    sync(heads: BollardHeads) {
      if (heads.revision === seen) return
      seen = heads.revision
      current = []
      heads.placed((approach, placement) => { current.push({approach, placement}) })
      pending = current.filter(item => !resolved.has(item.approach.key)).map(item => ({...item, retryAt: 0}))
      placeCursor = 0
      dirty = true
    },
    /** Works out the posts of one more pole near `focus`, and stands a few more posts on the pavement. */
    update(dt: number, focus: {x: number, z: number}) {
      elapsed += dt
      let places = PLACES_PER_FRAME
      for (let tries = pending.length; tries > 0 && places > 0; tries--) {
        if (placeCursor >= pending.length) placeCursor = 0
        const {approach, placement, retryAt} = pending[placeCursor]
        if (retryAt > elapsed || (placement.x - focus.x) ** 2 + (placement.z - focus.z) ** 2 > PLACE_RADIUS ** 2) { placeCursor++; continue }
        places--
        const result = placeBollards(approach, placement, surfaceAt)
        if (result === 'pending') { pending[placeCursor++].retryAt = elapsed + PLACE_RETRY; continue }
        resolved.set(approach.key, result)
        pending.splice(placeCursor, 1)
        if (result.length) dirty = true
      }
      if (dirty) reconcile()
      if (!mesh.visible && shown.length) mesh.visible = true
      let budget = LOOKS_PER_FRAME
      for (let remaining = Math.min(active.length, SCAN_PER_FRAME); remaining > 0 && budget > 0; remaining--) {
        if (cursor >= active.length) cursor = 0
        const slot = active[cursor++]
        if (slot.dueAt > elapsed || (slot.post.x - focus.x) ** 2 + (slot.post.z - focus.z) ** 2 > DRAPE_RADIUS ** 2) continue
        budget--
        lookAt(slot)
      }
    },
    /** Posts near a point, for contact resolution. Hidden posts do not block anything. */
    near(x: number, z: number, visit: (solid: Solid) => void) {
      if (mesh.visible) solids.near(x, z, visit)
    },
    /** Street traffic is switched off: the posts go with the signal poles. The next `update` shows them again. */
    hide() {
      if (mesh.visible) mesh.visible = false
    },
    probe(): BollardProbe {
      const all = [...slots.values()]
      const count = (test: (slot: Slot) => boolean) => all.reduce((sum, slot) => sum + (test(slot) ? 1 : 0), 0)
      return {
        total: all.length, drawn: shown.length, settled: count(slot => slot.state === 'drawn' && slot.looks >= SETTLE_LOOKS),
        waiting: count(slot => slot.state === 'waiting'), none: count(slot => slot.state === 'none'), pending: pending.length,
        visible: mesh.visible, drawCalls: mesh.visible && mesh.parent === scene && shown.length > 0 ? 1 : 0,
        posts: all.map(slot => ({...slot.post, y: slot.state === 'drawn' ? slot.y : slot.post.y, state: slot.state, settled: slot.looks >= SETTLE_LOOKS})),
      }
    },
  }
}
