// IDOK-399 — verify-only: what is actually drawn under the manhole covers and around the kerb bollards.
// Loaded on demand by the `?verify` probe (`trafficProbe.streetFurnitureAudit`), never in a normal session.
//
// The covers are laid out from the road graph, which knows nothing of the paint baked into the street
// tiles (zebras, stop lines, lane arrows). Whether a cover ended up on paint can only be read off the
// scene, so this casts rays into what is drawn and reports the colour found there.
import * as THREE from 'three'
import {look} from '../look/config'

export type CoverAudit = {
  key: string
  kind: number
  /** Height of the lid as drawn minus the highest drawn surface within a metre of it, at the centre and four points near the rim. `null`: nothing hit. */
  gaps: (number | null)[]
  /** True where the drawn surface under that point is baked road paint rather than asphalt. */
  paint: boolean[]
  /** Names of the meshes found under the cover. */
  under: string[]
}

export type PostAudit = {
  key: string
  /** Post base minus the highest drawn surface under it. `null`: nothing hit. */
  gap: number | null
  /** Names of drawn meshes within `POST_REACH` of the post, between shin and cap height: fences, rails, poles it stands in. */
  touching: string[]
}

/** Paint is this much brighter than asphalt in every channel (linear); the pale kerb stones are not under a cover. */
const PAINT_MATCH = .08
const POST_REACH = .35
const POST_HEIGHTS = [.25, .6]

function nameOf(object: THREE.Object3D) {
  let named: THREE.Object3D | null = object
  while (named && !named.name) named = named.parent
  return named?.name || object.type
}

export function streetFurnitureAudit(
  scene: THREE.Scene,
  coverMesh: THREE.Mesh | undefined,
  covers: Iterable<{key: string, x: number, y: number, z: number, headingX: number, headingZ: number, kind: number, state: string}>,
  postMesh: THREE.Object3D | undefined,
  posts: Iterable<{key: string, x: number, y: number, z: number, state: string}>,
  focus: {x: number, z: number},
  radius = 100,
): {covers: CoverAudit[], posts: PostAudit[]} {
  const raycaster = new THREE.Raycaster()
  raycaster.layers.enableAll()
  const down = new THREE.Vector3(0, -1, 0), origin = new THREE.Vector3(), direction = new THREE.Vector3()
  const paints = [look.streets.surfaces[2], 0xe7b62e].map(hex => new THREE.Color(hex))
  const colour = new THREE.Color()
  // Cars, trees, people and the posts themselves are instanced; the ground and the street furniture baked into tiles are not.
  const drawn: THREE.Object3D[] = []
  scene.traverseVisible(object => {
    if ((object as THREE.Mesh).isMesh && !(object as THREE.InstancedMesh).isInstancedMesh && !(object as THREE.BatchedMesh).isBatchedMesh && object !== coverMesh && object !== postMesh) drawn.push(object)
  })
  const near = (item: {x: number, z: number}) => (item.x - focus.x) ** 2 + (item.z - focus.z) ** 2 <= radius ** 2
  // The cover mesh is never culled, so nothing keeps its bounds current.
  coverMesh?.geometry.computeBoundingSphere()
  coverMesh?.geometry.computeBoundingBox()

  const coverAudits: CoverAudit[] = []
  for (const cover of covers) {
    if (cover.state !== 'drawn' || !near(cover)) continue
    const rightX = -cover.headingZ, rightZ = cover.headingX
    // Centre, then ±0.25 m along and across: inside every kind of cover.
    const points = [[0, 0], [.25, 0], [-.25, 0], [0, .17], [0, -.17]]
    const audit: CoverAudit = {key: cover.key, kind: cover.kind, gaps: [], paint: [], under: []}
    for (const [along, side] of points) {
      raycaster.set(origin.set(cover.x + cover.headingX * along + rightX * side, cover.y + 3, cover.z + cover.headingZ * along + rightZ * side), down)
      raycaster.far = 6
      // `cover.y` is the road graph's height, which can be a hand's width off the drawn road; the lid itself is what counts.
      const lid = coverMesh ? raycaster.intersectObject(coverMesh, false)[0]?.point.y : undefined
      let surface: number | undefined, painted = false
      if (lid !== undefined) for (const hit of raycaster.intersectObjects(drawn, false)) {
        if (Math.abs(hit.point.y - lid) > 1) continue
        if (surface !== undefined && hit.point.y <= surface) continue
        surface = hit.point.y
        const colours = (hit.object as THREE.Mesh).geometry.getAttribute('color')
        painted = false
        if (colours && hit.face) {
          colour.fromBufferAttribute(colours as THREE.BufferAttribute, hit.face.a)
          painted = paints.some(paint => Math.abs(paint.r - colour.r) + Math.abs(paint.g - colour.g) + Math.abs(paint.b - colour.b) < PAINT_MATCH)
        }
        const name = nameOf(hit.object)
        if (!audit.under.includes(name)) audit.under.push(name)
      }
      audit.gaps.push(lid === undefined || surface === undefined ? null : +(lid - surface).toFixed(4))
      audit.paint.push(painted)
    }
    coverAudits.push(audit)
  }

  const postAudits: PostAudit[] = []
  for (const post of posts) {
    if (post.state !== 'drawn' || !near(post)) continue
    const audit: PostAudit = {key: post.key, gap: null, touching: []}
    raycaster.set(origin.set(post.x, post.y + 2, post.z), down)
    raycaster.far = 4
    let surface: number | undefined
    for (const hit of raycaster.intersectObjects(drawn, false)) {
      // Not the awning or the tree crown overhead.
      if (hit.point.y > post.y + .5) continue
      if (surface === undefined || hit.point.y > surface) surface = hit.point.y
    }
    if (surface !== undefined) audit.gap = +(post.y - surface).toFixed(4)
    // Eight rays outwards from the post axis at two heights: anything drawn that close is something the post stands in.
    raycaster.far = POST_REACH
    for (const height of POST_HEIGHTS) for (let step = 0; step < 8; step++) {
      const angle = step * Math.PI / 4
      raycaster.set(origin.set(post.x, post.y + height, post.z), direction.set(Math.cos(angle), 0, Math.sin(angle)))
      for (const hit of raycaster.intersectObjects(drawn, false)) {
        const name = nameOf(hit.object)
        if (!audit.touching.includes(name)) audit.touching.push(name)
      }
    }
    postAudits.push(audit)
  }
  return {covers: coverAudits, posts: postAudits}
}
