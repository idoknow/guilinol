// IDOK-399 — the height of the ground as it is drawn, for the kerb bollards.
//
// The posts stand on the walking collider, which beside a street can ride a hand's width above the
// ground that is drawn (the collider is finer than the 2 000-triangle ground mesh of a tile). The two
// things drawn at a post are read here, without ray casts and without touching the scene graph beyond
// its direct children:
//
// - The ground mesh of each street tile (`world.ts` `detail`: the first child of the tile group, an
//   unnamed `Mesh` on a 256 × 256 `PlaneGeometry` with a textured `MeshStandardMaterial`; the group is
//   added straight to the scene at `(tile.x, 0, tile.z)`). It is a regular grid, read the way
//   `walk/physics.ts` reads it. Where a tunnel or underpass cut triangles out of it, or a platform ramp
//   replaced some (`platform-access.ts`), the grid triangles that are left are looked up once per index
//   buffer. A cell that was cut away or replaced reads nothing.
// - The street surface layer (`batch.ts` `StaticLayerBatch` with `streetSurfaceMat`: pavements, roads,
//   paint, draped up to 0.195 m above the ground mesh). One merged mesh for all tiles; its
//   `userData.tileSlices()` says which triangles belong to which tile. The triangles of a tile are put
//   into 8 m buckets once, a few thousand per call, so a reading is a handful of triangle tests.
//
// Anything else (bridges, tunnel fringes, landmark models) is not read: a post there falls back to
// the collider, as before.
import * as THREE from 'three'

/**
 * Highest drawn ground or street surface at `(x, z)` within `DRAWN_REACH` of `near`.
 * `undefined`: not known yet (a tile or its street surface still being taken in) — ask again later;
 * `null`: nothing drawn there that can be read.
 */
export type DrawnGroundAt = (x: number, z: number, near: number) => number | null | undefined

const TILE = 256
/** What counts as the ground at a point: the same band the posts accept around their collider (`bollards.ts` `HEIGHT_BAND`). A wider reach lets a deck edge 0.8 m up hide the pavement under it. */
export const DRAWN_REACH = .6
/** Street triangles put into buckets per call: estimated at about 0.1 ms on a desktop, under 1 ms on a phone at a quarter of the speed. */
export const BUCKET_PER_CALL = 2048
/** Bucket entries written per call: a long triangle lies in many buckets, so the triangle count alone does not bound the work. */
export const BUCKET_WRITES_PER_CALL = 8192
const BUCKET = 8
const BUCKETS = TILE / BUCKET
/** Scene children are looked through again at most this often (ms) when a point has no tile. */
const REFRESH_MS = 2000
/** A tile's street surface joins the merged layer a little after its ground; until then a street-less tile is not believed. */
const STREET_WAIT_MS = 2000
const EDGE = 1e-6

type GroundTile = {x: number, z: number, group: THREE.Object3D, mesh: THREE.Mesh, seenAt: number}
type Slice = {tile: {x: number, z: number}, vertexStart: number, count: number, indices: ArrayLike<number> | null}
type Buckets = {indices: ArrayLike<number> | null, count: number, done: number, cells: (number[] | undefined)[]}

/** The ground mesh of a street tile, as `world.ts` builds it; anything else is not. */
function groundOf(object: THREE.Object3D): THREE.Mesh | undefined {
  if (!(object as THREE.Group).isGroup || object.name || object.position.y !== 0) return
  const mesh = object.children[0] as THREE.Mesh | undefined
  if (!mesh?.isMesh || mesh.name || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh) return
  const geometry = mesh.geometry as THREE.PlaneGeometry, material = mesh.material as THREE.MeshStandardMaterial
  if (geometry.type !== 'PlaneGeometry' || geometry.parameters.width !== TILE || geometry.parameters.height !== TILE) return
  if (geometry.parameters.widthSegments !== geometry.parameters.heightSegments || !geometry.index) return
  if (!material?.isMeshStandardMaterial || !material.map) return
  if (mesh.position.x !== 0 || mesh.position.y !== 0 || mesh.position.z !== 0) return
  return mesh
}

/** Height of triangle `a b c` (xyz triples) at `(x, z)`, or `undefined` when the point is outside it in plan. */
function heightIn(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, x: number, z: number) {
  const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
  if (Math.abs(den) < 1e-9) return
  const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den
  const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den
  const w = 1 - u - v
  if (u < -EDGE || v < -EDGE || w < -EDGE) return
  return u * ay + v * by + w * cy
}

export function drawnGround(scene: THREE.Scene, streetMaterial: THREE.Material, now = () => performance.now()): DrawnGroundAt {
  let grounds: GroundTile[] = []
  let streets: THREE.Mesh | undefined
  let refreshedAt = -Infinity
  const buckets = new Map<object, Buckets>()
  /** Per index buffer of a ground mesh that is not in `PlaneGeometry` order: where each grid triangle is, -1 if gone. */
  const lookups = new WeakMap<object, Int32Array>()

  function refresh() {
    refreshedAt = now()
    const before = new Map(grounds.map(item => [item.group, item]))
    grounds = []
    streets = undefined
    for (const child of scene.children) {
      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material === streetMaterial && typeof child.userData.tileSlices === 'function') { streets = child as THREE.Mesh; continue }
      const mesh = groundOf(child)
      if (mesh) grounds.push(before.get(child) ?? {x: child.position.x, z: child.position.z, group: child, mesh, seenAt: refreshedAt})
    }
  }

  function tileAt(x: number, z: number) {
    for (let pass = 0; pass < 2; pass++) {
      for (const item of grounds) {
        if (x < item.x || x >= item.x + TILE || z < item.z || z >= item.z + TILE) continue
        if (item.group.parent === scene && item.group.children[0] === item.mesh) return item
      }
      if (pass || now() - refreshedAt < REFRESH_MS) return
      refresh()
    }
  }

  /** Ground mesh height at a point of its tile; `null` where that cell was cut out (a tunnel mouth) or replaced (a platform ramp). */
  function groundY(tile: GroundTile, x: number, z: number) {
    const geometry = tile.mesh.geometry as THREE.PlaneGeometry, position = geometry.getAttribute('position'), index = geometry.index
    if (!index || (position as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) return null
    const segments = geometry.parameters.widthSegments, stride = segments + 1, step = TILE / segments
    if (position.count < stride * stride) return null
    const lx = x - tile.x, lz = z - tile.z
    const col = Math.min(segments - 1, Math.max(0, Math.floor(lx / step))), row = Math.min(segments - 1, Math.max(0, Math.floor(lz / step)))
    const cell = row * segments + col, ids = index.array, triangles = Math.floor(index.count / 3)
    /** Grid order of the triangle at `t` (two per cell, `PlaneGeometry` order); anything not of the grid sorts last. */
    const order = (t: number) => {
      const first = ids[t * 3], second = ids[t * 3 + 1], third = ids[t * 3 + 2]
      if (first >= stride * stride) return Infinity
      if (second === first + stride && third === first + 1) return 2 * (Math.floor(first / stride) * segments + first % stride)
      if (second === first + 1 && third === first + 1 - stride && first >= stride) {
        const corner = first - stride
        return 2 * (Math.floor(corner / stride) * segments + corner % stride) + 1
      }
      return Infinity
    }
    // Uncut tiles: the cell's two triangles are where `PlaneGeometry` put them. Cut or refined ones: looked up.
    let first = 2 * cell, second = first + 1
    if (second >= triangles || order(first) !== first || order(second) !== second) {
      let lookup = lookups.get(index)
      if (!lookup) {
        lookup = new Int32Array(2 * segments * segments).fill(-1)
        for (let t = 0; t < triangles; t++) {
          const which = order(t)
          if (which < lookup.length) lookup[which] = t
        }
        lookups.set(index, lookup)
      }
      first = lookup[2 * cell]; second = lookup[2 * cell + 1]
    }
    const p = position.array
    for (const t of [first, second]) {
      if (t < 0) continue
      const i = ids[t * 3] * 3, j = ids[t * 3 + 1] * 3, k = ids[t * 3 + 2] * 3
      const y = heightIn(p[i], p[i + 1], p[i + 2], p[j], p[j + 1], p[j + 2], p[k], p[k + 1], p[k + 2], lx, lz)
      if (y !== undefined) return y
    }
    // Neither triangle of the cell is there, or the point is on neither: cut away or replaced, something else is drawn there.
    return null
  }

  function sliceOf(tile: GroundTile): Slice | undefined {
    // The merged layer joins the scene with the first tiles; one that was not there at the last look is looked for again.
    if (streets?.parent !== scene && now() - refreshedAt >= REFRESH_MS) refresh()
    const slices = (streets?.parent === scene ? streets.userData.tileSlices?.() : undefined) as Slice[] | undefined
    if (!slices) return
    for (const slice of slices) if (slice.tile.x === tile.x && slice.tile.z === tile.z) return slice
  }

  /** Street surface height at a point, `null` if none within reach, `undefined` while the tile's buckets are being filled. */
  function streetY(tile: GroundTile, x: number, z: number, near: number) {
    const slice = sliceOf(tile)
    if (!slice) {
      for (const key of buckets.keys()) if ((key as Slice['tile']).x === tile.x && (key as Slice['tile']).z === tile.z) buckets.delete(key)
      return now() - tile.seenAt < STREET_WAIT_MS ? undefined : null
    }
    const position = streets!.geometry.getAttribute('position')
    if (!position || (position as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) return null
    const p = position.array, base = slice.vertexStart, ids = slice.indices
    const vertex = (corner: number) => (base + (ids ? ids[corner] : corner)) * 3
    let entry = buckets.get(slice.tile)
    if (!entry || entry.indices !== ids || entry.count !== slice.count) {
      // A tile reloaded: start over. Tiles that are gone are dropped as they are found.
      for (const key of buckets.keys()) if (!(streets!.userData.tileSlices() as Slice[]).some(item => item.tile === key)) buckets.delete(key)
      entry = {indices: ids, count: slice.count, done: 0, cells: new Array(BUCKETS * BUCKETS)}
      buckets.set(slice.tile, entry)
    }
    const triangles = Math.floor(slice.count / 3)
    if (entry.done < triangles) {
      const end = Math.min(triangles, entry.done + BUCKET_PER_CALL)
      let t = entry.done
      for (let writes = 0; t < end && writes < BUCKET_WRITES_PER_CALL; t++) {
        const i = vertex(t * 3), j = vertex(t * 3 + 1), k = vertex(t * 3 + 2)
        const x0 = Math.min(p[i], p[j], p[k]) - tile.x, x1 = Math.max(p[i], p[j], p[k]) - tile.x
        const z0 = Math.min(p[i + 2], p[j + 2], p[k + 2]) - tile.z, z1 = Math.max(p[i + 2], p[j + 2], p[k + 2]) - tile.z
        const c0 = Math.max(0, Math.floor(x0 / BUCKET)), c1 = Math.min(BUCKETS - 1, Math.floor(x1 / BUCKET))
        const r0 = Math.max(0, Math.floor(z0 / BUCKET)), r1 = Math.min(BUCKETS - 1, Math.floor(z1 / BUCKET))
        for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) (entry.cells[row * BUCKETS + col] ??= []).push(t)
        writes += Math.max(0, r1 - r0 + 1) * Math.max(0, c1 - c0 + 1)
      }
      entry.done = t
      if (t < triangles) return undefined
    }
    const col = Math.min(BUCKETS - 1, Math.max(0, Math.floor((x - tile.x) / BUCKET))), row = Math.min(BUCKETS - 1, Math.max(0, Math.floor((z - tile.z) / BUCKET)))
    let best: number | null = null
    for (const t of entry.cells[row * BUCKETS + col] ?? []) {
      const i = vertex(t * 3), j = vertex(t * 3 + 1), k = vertex(t * 3 + 2)
      const y = heightIn(p[i], p[i + 1], p[i + 2], p[j], p[j + 1], p[j + 2], p[k], p[k + 1], p[k + 2], x, z)
      if (y !== undefined && Math.abs(y - near) <= DRAWN_REACH && (best === null || y > best)) best = y
    }
    return best
  }

  return (x, z, near) => {
    const tile = tileAt(x, z)
    if (!tile) return undefined
    const street = streetY(tile, x, z, near)
    if (street === undefined) return undefined
    const ground = groundY(tile, x, z)
    // The ground was cut away here (tunnel mouth, underpass): what is drawn instead is not read.
    if (ground === null) return null
    const top = Math.abs(ground - near) <= DRAWN_REACH ? ground : null
    if (street !== null && (top === null || street > top)) return street
    return top
  }
}
