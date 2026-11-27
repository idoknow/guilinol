// IDOK-399 — verify-only: how far the painted parking bays sit above what is actually drawn under them.
// Loaded on demand by the `?verify` probe (`trafficProbe.parkingBayGaps`), never in a normal session.
import * as THREE from 'three'
import {BAY_KERB, BAY_WIDTH, type ParkingBay} from './parking-layout'

export type ParkingBayGap = {
  key: string
  occupied: boolean
  /** Paint height minus the highest drawn surface within a metre of it, at the road-side line, at the rear line and (boxed bays) at the kerb-side line. `null`: no paint or no surface hit there. */
  gaps: (number | null)[]
  /** Names of the meshes found under the paint. */
  under: string[]
}

/**
 * How often the line mesh is really drawn: counts its draws over `frames` animation frames, and the
 * most in any one of them. One per frame is the budget; more means some other pass (a mirror, a
 * second camera) picked it up.
 */
export function parkingBayDraws(lines: THREE.Mesh, frames = 30): Promise<{frames: number, draws: number, mostPerFrame: number}> {
  return new Promise(resolve => {
    const before = lines.onBeforeRender
    let draws = 0, counted = 0, seen = -1, mostPerFrame = 0
    lines.onBeforeRender = function (...args) { draws++; before.apply(this, args) }
    const step = () => {
      // The first callback only marks where a frame starts; the game renders once between two of them.
      if (seen >= 0) mostPerFrame = Math.max(mostPerFrame, draws - counted)
      else draws = 0
      counted = draws
      if (++seen < frames) return void requestAnimationFrame(step)
      lines.onBeforeRender = before
      resolve({frames, draws, mostPerFrame})
    }
    requestAnimationFrame(step)
  })
}

/**
 * Casts a ray down through each drawn bay near `focus` and compares the paint with the visible scene
 * (not the colliders the paint was draped over). Negative gap: something is drawn over the line —
 * about -8 mm where it crosses a marking baked into the street tile (those sit 2 cm above the road),
 * more than that and the line is buried.
 */
export function parkingBayGaps(scene: THREE.Scene, lines: THREE.Mesh, bays: Iterable<ParkingBay & {state: string, boxed: boolean}>, focus: {x: number, z: number}, radius = 100): ParkingBayGap[] {
  const raycaster = new THREE.Raycaster()
  raycaster.layers.enableAll()
  const down = new THREE.Vector3(0, -1, 0), origin = new THREE.Vector3()
  const roadSide = BAY_WIDTH - BAY_KERB
  // The line mesh is never culled, so nothing keeps its bounds current.
  lines.geometry.computeBoundingSphere()
  lines.geometry.computeBoundingBox()
  // Parked cars, trees and people are instanced; the ground under the paint is not.
  const ground: THREE.Object3D[] = []
  scene.traverseVisible(object => {
    if ((object as THREE.Mesh).isMesh && !(object as THREE.InstancedMesh).isInstancedMesh && object !== lines) ground.push(object)
  })
  const result: ParkingBayGap[] = []
  for (const bay of bays) {
    if (bay.state !== 'drawn' || (bay.x - focus.x) ** 2 + (bay.z - focus.z) ** 2 > radius ** 2) continue
    const rightX = -bay.headingZ, rightZ = bay.headingX, middle = (bay.front - bay.rear) / 2
    const points = [
      [bay.x + bay.headingX * middle - rightX * roadSide, bay.z + bay.headingZ * middle - rightZ * roadSide],
      [bay.x - bay.headingX * bay.rear - rightX * roadSide / 2, bay.z - bay.headingZ * bay.rear - rightZ * roadSide / 2],
    ]
    if (bay.boxed) points.push([bay.x + bay.headingX * middle + rightX * roadSide, bay.z + bay.headingZ * middle + rightZ * roadSide])
    const gap: ParkingBayGap = {key: bay.key, occupied: bay.occupied, gaps: [], under: []}
    for (const [x, z] of points) {
      raycaster.set(origin.set(x, bay.y + 3, z), down)
      raycaster.far = 6
      const paint = raycaster.intersectObject(lines, false)[0]?.point.y
      let surface: number | undefined
      if (paint !== undefined) {
        for (const hit of raycaster.intersectObjects(ground, false)) {
          if (Math.abs(hit.point.y - paint) > 1) continue
          if (surface === undefined || hit.point.y > surface) surface = hit.point.y
          let named: THREE.Object3D | null = hit.object
          while (named && !named.name) named = named.parent
          const name = named?.name || hit.object.type
          if (!gap.under.includes(name)) gap.under.push(name)
        }
      }
      gap.gaps.push(paint === undefined || surface === undefined ? null : +(paint - surface).toFixed(4))
    }
    result.push(gap)
  }
  return result
}
