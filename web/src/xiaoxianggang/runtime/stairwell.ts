/**
 * The indoor half of the four walk-in stairwells: geometry mirroring pipeline/landmarks/central_square.py
 * _underground_portal, walk and solid regions for the indoor collider, and the sliding B1 glass doors.
 *
 * Well-local frame is the one in frame.ts: x across the well, +z toward the street opening, -z down to the B1 door.
 * Indoor y = height above street grade + XXG_STAIRWELL.depth, so the landing and the B1 floor sit at y = 0.
 */
import * as THREE from 'three'
import { XXG_AXIS_YAW, XXG_PORTAL_SPECS, XXG_STAIRWELL, type XxgPortalId } from '../frame.ts'
import { buildMergedBoxesGeometry, orientedBar, type BoxSpec, type RectXZ } from './scene-boxes.ts'

const W = XXG_STAIRWELL
const WALL_T = 0.36
/** Parapet height above grade. */
const WALL_TOP = 1.08
/** Underside of the treads and walls, relative to grade. */
const BASE = -W.depth - 0.3
const OUTER_X = W.halfWidth + WALL_T
const FRONT_Z = 4.3
const BACK_OUTER_Z = W.zBack - WALL_T
const BACK_Z = W.zBack - WALL_T * 0.5
const Z_BOT = W.zTop - (W.risers - 1) * W.tread
const SLOPE_END = Z_BOT - W.tread
const VESTIBULE_M = 3
/** Stair mass the indoor walker cannot enter: everything above the landing. */
const STAIR_SOLID_Z = -2.7

export const XXG_WELL_DOOR = {
  frameW: 0.08,
  sillH: 0.04,
  stileW: 0.06,
  gap: 0.01,
  leafT: 0.04,
  /** Each leaf slides this far into the wall pocket. */
  slideM: 1.08,
  /** Full open or close time. */
  travelS: 0.45,
  /** The doors open while the player is within this distance of the door centre. */
  triggerM: 2.2,
} as const

const LEAF_W = W.doorHalfWidth - XXG_WELL_DOOR.frameW - (XXG_WELL_DOOR.gap + XXG_WELL_DOOR.stileW)
const LEAF_H = W.doorHeight - XXG_WELL_DOOR.frameW - XXG_WELL_DOOR.sillH

export interface XxgIndoorWell {
  readonly index: number
  readonly portalId: XxgPortalId
  /** Well centre in indoor coordinates. */
  readonly cx: number
  readonly cz: number
  /** Local to indoor rotation (Object3D.rotation.y convention); also the indoor yaw facing down the stairs. */
  readonly psi: number
  /** Walls included: the B1 ceiling and floor are cut here. */
  readonly footprint: RectXZ
  /** Clear opening between the walls. */
  readonly interior: RectXZ
  /** Largest B1 lobby in front of the door; only built where no corridor reaches the door (see wellVestibule). */
  readonly vestibule: RectXZ
  /** Door centre on the B1 floor. */
  readonly door: { readonly x: number; readonly z: number }
}

export interface XxgWellPose {
  readonly well: XxgIndoorWell
  /** Well-local position. */
  readonly lx: number
  readonly lz: number
}

function makeWell(index: number, portalId: XxgPortalId, cx: number, cz: number, psi: number): XxgIndoorWell {
  const base = { index, portalId, cx, cz, psi }
  const door = toIndoor(base, 0, BACK_Z)
  return {
    ...base,
    footprint: localRect(base, -OUTER_X, OUTER_X, BACK_OUTER_Z, FRONT_Z),
    interior: localRect(base, -W.halfWidth, W.halfWidth, W.zBack, W.zTop),
    vestibule: localRect(base, -W.halfWidth, W.halfWidth, BACK_OUTER_Z - VESTIBULE_M, BACK_OUTER_Z),
    door,
  }
}

type WellFrame = Pick<XxgIndoorWell, 'cx' | 'cz' | 'psi'>

/** Well-local (lx, lz) to indoor (x, z). */
export function toIndoor(w: WellFrame, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(w.psi)
  const s = Math.sin(w.psi)
  return { x: w.cx + lx * c + lz * s, z: w.cz - lx * s + lz * c }
}

/** Indoor (x, z) to well-local (lx, lz). */
export function toWellLocal(w: WellFrame, x: number, z: number): { x: number; z: number } {
  const c = Math.cos(w.psi)
  const s = Math.sin(w.psi)
  const dx = x - w.cx
  const dz = z - w.cz
  return { x: dx * c - dz * s, z: dx * s + dz * c }
}

/** Axis-aligned indoor rect of a well-local box (the wells are turned by quarter turns). */
export function localRect(w: WellFrame, lx0: number, lx1: number, lz0: number, lz1: number): RectXZ {
  const a = toIndoor(w, lx0, lz0)
  const b = toIndoor(w, lx1, lz1)
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) }
}

let cachedWells: readonly XxgIndoorWell[] | null = null

/** The four wells in indoor coordinates, in XXG_PORTAL_SPECS order. */
export function xxgIndoorWells(): readonly XxgIndoorWell[] {
  if (!cachedWells) {
    cachedWells = Object.freeze(
      XXG_PORTAL_SPECS.map((p, i) => makeWell(i, p.id, p.along, p.across, p.yaw - XXG_AXIS_YAW - Math.PI / 2)),
    )
  }
  return cachedWells
}

/**
 * The B1 lobby actually built in front of the door, or null when a corridor already reaches the door: the door
 * then opens straight into that corridor instead of into a dead-end recess with side pockets.
 */
export function wellVestibule(w: XxgIndoorWell, corridors: readonly RectXZ[]): RectXZ | null {
  const p = toIndoor(w, 0, BACK_OUTER_Z - 0.05)
  const reached = corridors.some(c => p.x > c.minX && p.x < c.maxX && p.z > c.minZ && p.z < c.maxZ)
  return reached ? null : w.vestibule
}

/** The well whose footprint or vestibule holds the indoor point, with its local position. */
export function locateInWell(x: number, z: number, wells: readonly XxgIndoorWell[] = xxgIndoorWells()): XxgWellPose | null {
  for (const well of wells) {
    const l = toWellLocal(well, x, z)
    if (Math.abs(l.x) <= OUTER_X && l.z >= BACK_OUTER_Z - VESTIBULE_M && l.z <= FRONT_Z) return { well, lx: l.x, lz: l.z }
  }
  return null
}

/** Distance from an indoor point to the nearest well landing centre. */
export function distanceToNearestLanding(x: number, z: number, wells: readonly XxgIndoorWell[] = xxgIndoorWells()): number {
  let best = Infinity
  for (const w of wells) {
    const p = toIndoor(w, 0, (W.zBack + Z_BOT) * 0.5)
    best = Math.min(best, Math.hypot(x - p.x, z - p.z))
  }
  return best
}

export interface XxgWellRegion extends RectXZ {
  readonly id: string
}

/**
 * Indoor walk and solid regions. Walkable: the landing, the doorway and the B1 vestibule where one is built.
 * Solid: side walls, back-wall piers and the whole stair flight above the landing, so a B1 corridor that runs
 * under the well cannot lead onto the stairs.
 */
export function wellCollisionRegions(
  w: XxgIndoorWell,
  corridors: readonly RectXZ[],
): { walk: XxgWellRegion[]; solid: XxgWellRegion[] } {
  const hw = W.halfWidth
  const jamb = W.doorHalfWidth - XXG_WELL_DOOR.frameW
  const id = `well-${w.portalId}`
  const r = (suffix: string, lx0: number, lx1: number, lz0: number, lz1: number): XxgWellRegion => ({
    id: `${id}-${suffix}`,
    ...localRect(w, lx0, lx1, lz0, lz1),
  })
  const walk = [r('landing', -hw, hw, W.zBack, STAIR_SOLID_Z - 0.15), r('doorway', -jamb, jamb, BACK_OUTER_Z - 0.87, W.zBack + 0.77)]
  const vestibule = wellVestibule(w, corridors)
  if (vestibule) walk.push({ id: `${id}-vestibule`, ...vestibule })
  return {
    walk,
    solid: [
      r('wall-l', -OUTER_X, -hw, BACK_OUTER_Z, FRONT_Z),
      r('wall-r', hw, OUTER_X, BACK_OUTER_Z, FRONT_Z),
      r('pier-l', -hw, -jamb, BACK_OUTER_Z, W.zBack),
      r('pier-r', jamb, hw, BACK_OUTER_Z, W.zBack),
      r('stairs', -hw, hw, STAIR_SOLID_Z, FRONT_Z),
    ],
  }
}

/** Current footprint of the two glass leaves (open = 0 closed .. 1 fully in the wall pocket). */
export function doorLeafRects(w: XxgIndoorWell, open: number): XxgWellRegion[] {
  const d = XXG_WELL_DOOR
  const inner = d.gap + open * d.slideM
  const out: XxgWellRegion[] = []
  for (const side of [-1, 1] as const) {
    const a = side * inner
    const b = side * (inner + d.stileW + LEAF_W)
    out.push({ id: `well-${w.portalId}-door-${side < 0 ? 'l' : 'r'}`, ...localRect(w, Math.min(a, b), Math.max(a, b), BACK_Z - 0.06, BACK_Z + 0.06) })
  }
  return out
}

/** Door easing: smoothstep of the linear travel progress. */
export function doorOpenFraction(progress: number): number {
  const t = Math.min(1, Math.max(0, progress))
  return t * t * (3 - 2 * t)
}

export interface XxgWellGeometryBuckets {
  /** Granite: treads, landing, walls, piers, lintel. */
  readonly stone: BoxSpec[]
  /** Bronze nosing strip on each tread edge. */
  readonly nosing: BoxSpec[]
  /** Aluminium: door frame, handrails, brackets, sign pylons. */
  readonly frame: THREE.BufferGeometry[]
  /** Dark sign plates. */
  readonly dark: BoxSpec[]
  /** Warm lit strips under the handrails. */
  readonly lit: THREE.BufferGeometry[]
  /** Green safety exit signs over the B1 side of the door. */
  readonly exitSigns: THREE.BufferGeometry[]
}

/** Adds one well's static geometry to the scene buckets. */
export function buildIndoorWellGeometry(w: XxgIndoorWell, out: XxgWellGeometryBuckets): void {
  const D = W.depth
  const c = Math.cos(w.psi)
  const s = Math.sin(w.psi)
  /** Well-local box: (lx, lz) centre, y bottom relative to grade, sizes along local x / y / z. */
  const box = (lx: number, yRel: number, lz: number, sx: number, sy: number, sz: number): BoxSpec => {
    const p = toIndoor(w, lx, lz)
    return { cx: p.x, cy: yRel + D + sy * 0.5, cz: p.z, sx: Math.abs(c) * sx + Math.abs(s) * sz, sy, sz: Math.abs(s) * sx + Math.abs(c) * sz }
  }
  const pt = (lx: number, yRel: number, lz: number) => {
    const p = toIndoor(w, lx, lz)
    return new THREE.Vector3(p.x, yRel + D, p.z)
  }
  const hw = W.halfWidth
  const wellW = hw * 2
  const yB1 = -D
  const noseW = 0.05
  const nose = (lz: number, top: number) => out.nosing.push(box(0, top - 0.016, lz, wellW, 0.02, noseW))

  // Top slab at the street edge, 24 treads, the landing.
  out.stone.push(box(0, BASE, (W.zTop + FRONT_Z) * 0.5, wellW, -BASE, FRONT_Z - W.zTop))
  nose(W.zTop + noseW * 0.5 - 0.003, 0)
  for (let i = 0; i < W.risers - 1; i++) {
    const top = -(i + 1) * W.riser
    const outer = W.zTop - i * W.tread
    const inner = outer - W.tread
    out.stone.push(box(0, BASE, (outer + inner) * 0.5, wellW, top - BASE, W.tread))
    nose(inner + noseW * 0.5 - 0.003, top)
  }
  out.stone.push(box(0, BASE, (W.zBack + Z_BOT) * 0.5, wellW, yB1 - BASE, Z_BOT - W.zBack))

  // Side walls and back wall up to the parapet; the door opening stays clear.
  const doorTop = yB1 + W.doorHeight
  const pierW = hw - W.doorHalfWidth
  for (const sx of [-1, 1]) {
    out.stone.push(box(sx * (hw + WALL_T * 0.5), BASE, (BACK_OUTER_Z + FRONT_Z) * 0.5, WALL_T, WALL_TOP - BASE, FRONT_Z - BACK_OUTER_Z))
    out.stone.push(box(sx * (W.doorHalfWidth + pierW * 0.5), BASE, BACK_Z, pierW, doorTop - BASE, WALL_T))
  }
  out.stone.push(box(0, BASE, BACK_Z, W.doorHalfWidth * 2, yB1 - BASE, WALL_T))
  out.stone.push(box(0, doorTop, BACK_Z, wellW, WALL_TOP - doorTop, WALL_T))

  // Door frame: jambs, head, sill (the leaves are dynamic, see createWellDoors).
  const d = XXG_WELL_DOOR
  const frame: BoxSpec[] = []
  const innerW = W.doorHalfWidth * 2 - d.frameW * 2
  for (const sx of [-1, 1]) frame.push(box(sx * (W.doorHalfWidth - d.frameW * 0.5), yB1, BACK_Z, d.frameW, W.doorHeight, 0.12))
  frame.push(box(0, doorTop - d.frameW, BACK_Z, innerW, d.frameW, 0.12))
  frame.push(box(0, yB1, BACK_Z, innerW, d.sillH, 0.12))
  // Sign pylons on the back wall.
  for (const sx of [-1, 1]) frame.push(box(sx * (hw + WALL_T * 0.5), WALL_TOP, BACK_Z, 0.14, 3.1 - WALL_TOP, 0.14))
  out.frame.push(buildMergedBoxesGeometry(frame).geom)

  // Handrails 0.90 m over the nosing line, wall brackets, lit strip on the wall face below.
  const railX = hw - 0.1
  const railBack = W.zBack + 0.12
  for (const sx of [-1, 1]) {
    const rx = sx * railX
    out.frame.push(orientedBar(pt(rx, 0.9, W.zTop), pt(rx, yB1 + 0.9, SLOPE_END), 0.04))
    out.frame.push(orientedBar(pt(rx, yB1 + 0.9, SLOPE_END), pt(rx, yB1 + 0.9, railBack), 0.04))
    for (const frac of [0.04, 0.36, 0.68, 1.0]) {
      const bz = W.zTop + (SLOPE_END - W.zTop) * frac
      const by = 0.9 + yB1 * frac
      out.frame.push(orientedBar(pt(rx, by, bz), pt(sx * hw, by, bz), 0.024))
    }
    const lx = sx * (hw - 0.025)
    out.lit.push(orientedBar(pt(lx, 0.73, W.zTop), pt(lx, yB1 + 0.73, SLOPE_END), 0.05))
    out.lit.push(orientedBar(pt(lx, yB1 + 0.73, SLOPE_END), pt(lx, yB1 + 0.73, railBack), 0.05))
  }

  // Sign plate over the door on the stair side, the street sign box on the pylons.
  out.dark.push(box(0, doorTop + 0.15, W.zBack + 0.02, W.doorHalfWidth * 2, 0.5, 0.04))
  out.dark.push(box(0, 2.55, BACK_Z, 5.26, 0.88, 0.24))

  // Safety exit sign on the B1 face of the lintel, facing the vestibule.
  const sign = new THREE.PlaneGeometry(0.88, 0.28)
  sign.rotateY(w.psi + Math.PI)
  const sp = toIndoor(w, 0, BACK_OUTER_Z - 0.008)
  sign.translate(sp.x, 2.7, sp.z)
  out.exitSigns.push(sign)
}

export interface XxgWellDoors {
  readonly glass: THREE.Mesh
  readonly frame: THREE.Mesh
  readonly triangles: number
  /** Moves both leaves of one well; open 0 = closed, 1 = in the wall pocket. */
  setOpen(wellIndex: number, open: number): void
  dispose(): void
}

interface LeafRange {
  readonly start: number
  readonly count: number
  readonly dx: number
  readonly dz: number
}

/** Both leaves of every well as two dynamic meshes (glass, aluminium stile and pulls): two draw calls in total. */
export function createWellDoors(
  wells: readonly XxgIndoorWell[],
  glassMat: THREE.Material,
  frameMat: THREE.Material,
): XxgWellDoors {
  const d = XXG_WELL_DOOR
  const D = W.depth
  const glassParts: THREE.BufferGeometry[] = []
  const frameParts: THREE.BufferGeometry[] = []
  const glassRanges: LeafRange[][] = wells.map(() => [])
  const frameRanges: LeafRange[][] = wells.map(() => [])
  let glassCursor = 0
  let frameCursor = 0
  for (const w of wells) {
    const c = Math.cos(w.psi)
    const s = Math.sin(w.psi)
    const box = (lx: number, yRel: number, lz: number, sx: number, sy: number, sz: number): BoxSpec => {
      const p = toIndoor(w, lx, lz)
      return { cx: p.x, cy: yRel + D + sy * 0.5, cz: p.z, sx: Math.abs(c) * sx + Math.abs(s) * sz, sy, sz: Math.abs(s) * sx + Math.abs(c) * sz }
    }
    const yLeaf = -D + d.sillH
    for (const side of [-1, 1] as const) {
      const slide = toIndoor({ cx: 0, cz: 0, psi: w.psi }, side, 0)
      const glass = buildMergedBoxesGeometry([box(side * (d.gap + d.stileW + LEAF_W * 0.5), yLeaf, BACK_Z, LEAF_W, LEAF_H, d.leafT)]).geom
      const metal: BoxSpec[] = [box(side * (d.gap + d.stileW * 0.5), yLeaf, BACK_Z, d.stileW, LEAF_H, 0.08)]
      for (const face of [-1, 1]) metal.push(box(side * 0.16, -D + 0.85, BACK_Z + face * 0.08, 0.024, 0.6, 0.024))
      const frame = buildMergedBoxesGeometry(metal).geom
      const gc = glass.getAttribute('position').count
      const fc = frame.getAttribute('position').count
      glassRanges[w.index]!.push({ start: glassCursor, count: gc, dx: slide.x, dz: slide.z })
      frameRanges[w.index]!.push({ start: frameCursor, count: fc, dx: slide.x, dz: slide.z })
      glassCursor += gc
      frameCursor += fc
      glassParts.push(glass)
      frameParts.push(frame)
    }
  }
  const glassMerged = mergeForDoors(glassParts)
  const frameMerged = mergeForDoors(frameParts)
  const glass = new THREE.Mesh(glassMerged.geom, glassMat)
  const frame = new THREE.Mesh(frameMerged.geom, frameMat)
  for (const [mesh, name] of [[glass, 'xxg_well_door_glass'], [frame, 'xxg_well_door_frame']] as const) {
    mesh.name = name
    mesh.frustumCulled = false
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
  }
  const glassBase = Float32Array.from((glassMerged.geom.getAttribute('position') as THREE.BufferAttribute).array)
  const frameBase = Float32Array.from((frameMerged.geom.getAttribute('position') as THREE.BufferAttribute).array)
  const current = wells.map(() => 0)

  const apply = (geom: THREE.BufferGeometry, base: Float32Array, ranges: readonly LeafRange[], shift: number) => {
    const attr = geom.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    for (const r of ranges) {
      for (let i = r.start; i < r.start + r.count; i++) {
        arr[i * 3] = base[i * 3]! + r.dx * shift
        arr[i * 3 + 2] = base[i * 3 + 2]! + r.dz * shift
      }
    }
    attr.needsUpdate = true
  }

  return {
    glass,
    frame,
    triangles: glassMerged.triangles + frameMerged.triangles,
    setOpen(wellIndex, open) {
      const f = Math.min(1, Math.max(0, open))
      if (Math.abs((current[wellIndex] ?? -1) - f) < 1e-4) return
      current[wellIndex] = f
      const shift = f * d.slideM
      apply(glass.geometry, glassBase, glassRanges[wellIndex] ?? [], shift)
      apply(frame.geometry, frameBase, frameRanges[wellIndex] ?? [], shift)
    },
    dispose() {
      glass.geometry.dispose()
      frame.geometry.dispose()
    },
  }
}

function mergeForDoors(parts: THREE.BufferGeometry[]): { geom: THREE.BufferGeometry; triangles: number } {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let offset = 0
  for (const part of parts) {
    const pos = part.getAttribute('position')
    const norm = part.getAttribute('normal')
    const uv = part.getAttribute('uv')
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i))
      normals.push(norm.getX(i), norm.getY(i), norm.getZ(i))
      uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0)
    }
    const idx = part.getIndex()
    if (idx) for (let i = 0; i < idx.count; i++) indices.push(offset + idx.getX(i))
    else for (let i = 0; i < pos.count; i++) indices.push(offset + i)
    offset += pos.count
    part.dispose()
  }
  const geom = new THREE.BufferGeometry()
  const posAttr = new THREE.Float32BufferAttribute(positions, 3)
  posAttr.setUsage(THREE.DynamicDrawUsage)
  geom.setAttribute('position', posAttr)
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geom.setIndex(indices)
  geom.computeBoundingSphere()
  return { geom, triangles: Math.floor(indices.length / 3) }
}
