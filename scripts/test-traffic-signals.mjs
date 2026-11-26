// IDOK-399 — unit tests for the single signal source (`web/src/traffic/signals.ts`).
// Run: node --experimental-strip-types --test scripts/test-traffic-signals.mjs
import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import {test} from 'node:test'
import {gunzipSync} from 'node:zlib'
import {SIGNAL_DRIVER_RANK, SignalClock, SignalPlan} from '../web/src/traffic/signals.ts'
import {Traffic} from '../web/src/traffic/sim.ts'

// The arithmetic `Traffic.phase()` used before the plan existed. Kept here as the reference.
function legacyPhase(signal, lane, time) {
  let local = (time + signal.offset) % signal.phases.reduce((sum, phase) => sum + phase.green + phase.yellow, 0)
  for (const phase of signal.phases) {
    if (local < phase.green + phase.yellow) return !phase.lanes.includes(lane) ? 'red' : local < phase.green ? 'green' : 'yellow'
    local -= phase.green + phase.yellow
  }
  return 'red'
}

const synthetic = [
  {node: 1, group: 1, offset: 0, phases: [{lanes: [10, 11], green: 18, yellow: 3}, {lanes: [12], green: 18, yellow: 3}]},
  {node: 2, group: 2, offset: 22, phases: [{lanes: [20], green: 10, yellow: 2}, {lanes: [21], green: 14, yellow: 3}, {lanes: [22, 20], green: 6, yellow: 3}]},
  {node: 3, group: 3, offset: 7.5, phases: [{lanes: [30], green: 25, yellow: 4}]},
]
const worldGraph = 'public/world/roads/graph.json.gz'
const world = existsSync(worldGraph) ? JSON.parse(gunzipSync(readFileSync(worldGraph))).signals : []

test('SignalPlan.color matches the legacy sim arithmetic for every signal, lane and sampled second', () => {
  const signals = [...synthetic, ...world]
  const plan = new SignalPlan(signals)
  assert.equal(plan.size, signals.length)
  let checked = 0
  for (const signal of signals) {
    const lanes = new Set(signal.phases.flatMap(phase => phase.lanes))
    lanes.add(-1)
    for (let time = 0; time < 260; time += 0.37) {
      for (const lane of lanes) {
        assert.equal(plan.color(signal.node, lane, time), legacyPhase(signal, lane, time), `node ${signal.node} lane ${lane} t=${time}`)
        checked++
      }
    }
  }
  console.log({signals: signals.length, worldSignals: world.length, checked})
})

test('SignalPlan.state reports the serving phase, its colour and the time left', () => {
  const plan = new SignalPlan(synthetic)
  assert.deepEqual({...plan.state(1, 0)}, {phase: 0, color: 'green', remaining: 18, cycle: 42})
  assert.deepEqual({...plan.state(1, 19)}, {phase: 0, color: 'yellow', remaining: 2, cycle: 42})
  assert.deepEqual({...plan.state(1, 21)}, {phase: 1, color: 'green', remaining: 18, cycle: 42})
  assert.deepEqual({...plan.state(1, 42 * 5 + 40)}, {phase: 1, color: 'yellow', remaining: 2, cycle: 42})
  assert.deepEqual({...plan.state(1, -1)}, {phase: 1, color: 'yellow', remaining: 1, cycle: 42}, 'negative time wraps')
  assert.equal(plan.state(99, 0), null)
  assert.equal(plan.color(99, 10, 0), null)
  const own = {phase: 0, color: 'green', remaining: 0, cycle: 0}
  assert.equal(plan.state(2, 0, own), own, 'caller-owned result object is filled and returned')
  assert.equal(plan.state(2, 0), plan.state(3, 0), 'default result is one shared scratch object: no allocation per lookup')
})

test('SignalPlan.add keeps the first programme of a node and ignores unusable ones', () => {
  const plan = new SignalPlan()
  assert.equal(plan.add(synthetic), 3)
  assert.equal(plan.add([{...synthetic[0], offset: 5}, {node: 7, group: 7, offset: 0, phases: []}, {node: 8, group: 8, offset: 0, phases: [{lanes: [1], green: 0, yellow: 0}]}]), 0)
  assert.equal(plan.spec(1).offset, 0)
  assert.deepEqual([...plan.nodeIds()], [1, 2, 3])
})

test('SignalClock takes time from the best-ranked driver that is ticking, never from two', () => {
  const clock = new SignalClock()
  const street = clock.driver(SIGNAL_DRIVER_RANK.street)
  const duty = clock.driver(SIGNAL_DRIVER_RANK.duty)
  const visual = clock.driver(SIGNAL_DRIVER_RANK.visual)
  const near = (expected, label) => assert.ok(Math.abs(clock.now - expected) < 1e-9, `${label}: clock ${clock.now} != ${expected}`)

  for (let frame = 0; frame < 60; frame++) { street.advance(1 / 60); duty.advance(1 / 60); visual.advance(1 / 60) }
  near(1, 'all three ticking → street only')

  for (let frame = 0; frame < 60; frame++) { duty.advance(1 / 60); visual.advance(1 / 60) }
  near(2, 'street gone → duty takes over on the very next frame')

  for (let frame = 0; frame < 60; frame++) visual.advance(1 / 60)
  near(3, 'no sim → visuals keep the clock alive')

  for (let frame = 0; frame < 60; frame++) { visual.advance(1 / 60); street.advance(1 / 60) }
  near(4 + 1 / 60, 'street back, called after the visual driver → at most one frame of overlap')

  assert.equal(street.advance(Number.NaN), true)
  assert.equal(street.advance(-1), true)
  near(4 + 1 / 60, 'bad dt never moves the clock')
})

test('Traffic reads lights at time + signalShift, so every sim can follow the one clock', () => {
  const nodes = [[0, 0], [40, 0], [130, 0], [40, 60]].map(([x, z], id) => ({id, x, y: 0, z}))
  const lanes = [[0, 1], [1, 2], [3, 1]].map(([from, to], id) => ({id, from, to, kind: 'motor', cls: 'primary', offset: 0, speedKmh: 36}))
  const signals = [{node: 1, group: 1, offset: 4, phases: [{lanes: [0], green: 18, yellow: 3}, {lanes: [2], green: 18, yellow: 3}]}]
  const plan = new SignalPlan(signals)
  const a = new Traffic({nodes, lanes, signals, walks: []}, () => .5, 0)
  const b = new Traffic({nodes, lanes, signals, walks: []}, () => .5, 0)
  const clock = new SignalClock()
  b.time = 85 // e.g. a duty sim that pre-rolled on its own
  for (let step = 0; step < 900; step++) {
    clock.now += .05
    a.time += .05; b.time += .05
    a.signalShift = clock.now - a.time
    b.signalShift = clock.now - b.time
    for (const lane of [0, 2]) {
      const expected = plan.color(1, lane, clock.now)
      assert.equal(a.getSignalPhase(lane, 1), expected)
      assert.equal(b.getSignalPhase(lane, 1), expected)
      assert.equal(a.phase({id: lane, to: 1}), expected)
      assert.equal(b.green({id: lane, to: 1}), expected === 'green')
    }
  }
  const bare = new Traffic({nodes, lanes, signals, walks: []}, () => .5, 0)
  bare.time = 30
  assert.equal(bare.signalShift, 0)
  assert.equal(bare.phase({id: 0, to: 1}), legacyPhase(signals[0], 0, 30), 'a sim nobody syncs behaves exactly as before')
  assert.equal(bare.phase({id: 0, to: 1}, 0), 'green', 'explicit time is used as given')
  assert.equal(bare.phase({id: 1, to: 2}), 'green', 'no signal at the node → green')
  assert.equal(bare.getSignalPhase(1, 2), null)
})
