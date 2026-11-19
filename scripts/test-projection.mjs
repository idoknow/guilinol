import assert from 'node:assert/strict'
import test from 'node:test'
import {ll2xz, xz2ll} from '../lib/projection.ts'

test('projection matches pipeline/common.py at opposite corners and a non-grid point', () => {
  for (const [x,z,lat,lon] of [
    [-3072,-3328,25.310097491272813,110.2694811405168],
    [121.5,-725,25.28655669506394,110.30120704473542],
    [3072,3328,25.24990250872719,110.33051885948319],
  ]) {
    const world = ll2xz(lat,lon), coordinates = xz2ll(x,z)
    assert.ok(Math.hypot(world.x-x,world.z-z) < 0.5)
    assert.ok(Math.hypot(coordinates.lat-lat,coordinates.lon-lon)*112000 < 0.5)
  }
})
