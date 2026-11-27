// IDOK-470: free-flight streaming focus. Run: node --import tsx --test scripts/test-flight-focus.mjs
import assert from 'node:assert/strict'
import {test} from 'node:test'
import * as THREE from 'three'
import {flightFocus} from '../web/src/flight-focus.ts'

const RADIUS = 480
function cameraAt(eye, look) {
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(...eye)
  camera.lookAt(...look)
  camera.updateMatrixWorld()
  return camera
}
const shift = (camera, focus) => Math.hypot(focus.x - camera.position.x, focus.z - camera.position.z)

test('high oblique view streams around a point toward the view centre, capped at 60% of the radius', () => {
  const camera = cameraAt([0, 560, 0], [0, 150, 620])
  const focus = flightFocus(camera, 150, RADIUS)
  assert.ok(focus.z > 0 && Math.abs(focus.x) < 1e-6)
  assert.equal(Math.round(shift(camera, focus)), RADIUS * .6)
  assert.ok(620 - focus.z <= RADIUS, 'view centre must fall inside the load radius')
})

test('low flight never moves the focus further than the height above ground', () => {
  const camera = cameraAt([0, 180, 0], [400, 150, 0])
  const focus = flightFocus(camera, 150, RADIUS)
  assert.ok(shift(camera, focus) <= 30 + 1e-6)
})

test('a steep view stops at the point it meets the ground', () => {
  const camera = cameraAt([0, 400, 0], [0, 100, 100])
  assert.ok(Math.abs(flightFocus(camera, 100, RADIUS).z - 100) < 1e-6)
})

test('straight down, unknown ground or below ground keeps the camera position', () => {
  const down = cameraAt([10, 400, 20], [10, 0, 20])
  assert.deepEqual(flightFocus(down, 100, RADIUS).toArray(), [10, 400, 20])
  const oblique = cameraAt([10, 400, 20], [300, 100, 300])
  assert.deepEqual(flightFocus(oblique, undefined, RADIUS).toArray(), [10, 400, 20])
  assert.deepEqual(flightFocus(oblique, 500, RADIUS).toArray(), [10, 400, 20])
})

test('looking above the horizon is still capped', () => {
  const camera = cameraAt([0, 300, 0], [-1000, 400, 0])
  const focus = flightFocus(camera, 100, RADIUS)
  assert.ok(focus.x < 0 && shift(camera, focus) <= RADIUS * .6 + 1e-6)
})
