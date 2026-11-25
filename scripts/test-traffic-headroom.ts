import assert from 'node:assert/strict'
import {Traffic, type Graph} from '../web/src/traffic/sim'

const nodes = [0, 30, 60].map((x, id) => ({x, y: 0, z: 0, id}))
const approach: Graph['lanes'][number] = {
  id: 1, from: 0, to: 1, cls: 'primary', kind: 'motor',
  street: 'fixture', speedKmh: 30, offset: 0,
}
const bore = {...approach, id: 2, from: 1, to: 2, clearance: 3.5}
const camera = {x: 0, y: 0, z: 0}

for (const height of [3.2, 3.21]) {
  function create(lanes: Graph['lanes']) {
    const sim = new Traffic({nodes, lanes, signals: [], walks: []}, () => .1)
    sim.prepareMotor = actor => { actor.height = height }
    sim.step(1 / 60, camera)
    return sim
  }
  assert.equal(create([bore]).actors.length > 0, height <= 3.2)
  const sim = create([approach, bore])
  const car = sim.actors[0]
  assert.equal(car.track.id, approach.id)
  car.dist = car.track.length - .001
  car.speed = 5
  sim.step(1 / 60, camera)
  assert.equal(car.track.id === bore.id, height <= 3.2)
  if (height > 3.2) assert.equal(car.leaving, true)
}
