import test from 'node:test'
import assert from 'node:assert/strict'
import {Traffic} from '../web/src/traffic/sim.ts'
import {canRoute} from '../web/src/traffic/narrow.ts'

function makeCar(track, dist, extra = {}) {
  return {
    track,
    dist,
    x: track.start.x + track.dx * dist - track.dz * (track.offset || 0),
    y: 0,
    z: track.start.z + track.dz * dist + track.dx * (track.offset || 0),
    speed: 0,
    kind: 'car',
    down: 0,
    dodge: 0,
    yaw: track.yaw,
    scale: 1,
    leaving: false,
    halfWidth: 0.9,
    halfLength: 2.1,
    height: 1.5,
    ...extra,
  }
}

test('fleeUntil clears and resets dutyState when officer leaves duty, cites, or timer expires', () => {
  const graph = {
    nodes: [{id: 1, x: 0, y: 0, z: 0}, {id: 2, x: 160, y: 0, z: 0}],
    lanes: [{id: 10, from: 1, to: 2, kind: 'nonmotor', cls: 'primary', street: '测试路', offset: 0, speedKmh: 25}],
    walks: [],
    signals: [],
  }
  const sim = new Traffic(graph, () => 0.5, 0)
  const track = [...sim.allTracks()][0]
  const scooter = makeCar(track, 20, {
    kind: 'scooter',
    halfWidth: 0.3,
    halfLength: 0.85,
    violation: 'no_helmet',
    violations: ['no_helmet'],
    cited: false,
    dutyState: 'normal',
    speed: 4,
  })
  sim.actors.push(scooter)
  sim.setDutyOfficer({active: true, pos: {x: 30, y: 0, z: 0}, running: false})
  sim.step(0.05, {x: 30, y: 1.7, z: 0})
  assert.ok(scooter.fleeUntil !== undefined, 'violator enters fleeing/evading upon spotting officer')
  assert.ok(scooter.dutyState === 'fleeing' || scooter.dutyState === 'evading')

  // Case 1: officer leaves duty before fleeUntil expires -> must immediately clear fleeing state
  sim.setDutyOfficer(null)
  sim.step(0.05, {x: 30, y: 1.7, z: 0})
  assert.equal(scooter.fleeUntil, undefined, 'fleeUntil cleared when officer deactivates')
  assert.equal(scooter.dutyState, 'normal', 'dutyState reset to normal when officer deactivates')

  // Case 2: re-trigger fleeing, then cite violator -> must clear fleeing state even with officer active
  scooter.dist = 20; scooter.x = 20
  sim.setDutyOfficer({active: true, pos: {x: 30, y: 0, z: 0}, running: false})
  sim.step(0.05, {x: 30, y: 1.7, z: 0})
  assert.ok(scooter.fleeUntil !== undefined)
  sim.notifyViolatorCited(scooter)
  sim.step(0.05, {x: 30, y: 1.7, z: 0})
  assert.equal(scooter.fleeUntil, undefined, 'fleeUntil cleared after citation')
  assert.equal(scooter.dutyState, 'normal', 'dutyState reset after citation')
})

test('1 Hz starvation pass rescues all simultaneously starved vehicles in one tick', () => {
  const graph = {
    nodes: [{id: 1, x: 0, y: 0, z: 0}, {id: 2, x: 100, y: 0, z: 0}],
    lanes: [{id: 1, from: 1, to: 2, kind: 'motor', cls: 'primary', street: 'A', offset: 0, speedKmh: 36}],
    walks: [],
    signals: [],
  }
  const sim = new Traffic(graph, () => 0.5, 0)
  const track = [...sim.allTracks()][0]
  // Blocker parked with waitingSince=undefined (e.g., player/held), two starved vehicles waiting >= 18s behind it.
  const blocker = makeCar(track, 60, {stoppedUntil: 999})
  const starvedA = makeCar(track, 55, {waitingFor: blocker, waitingSince: 0})
  const starvedB = makeCar(track, 50, {waitingFor: blocker, waitingSince: 0})
  sim.actors.push(blocker, starvedA, starvedB)
  sim.time = 20
  // Step once when checkWaitsAt (0) <= time (20); both starved cars stay blocked behind blocker/each other,
  // place them on separate parallel lanes behind separate non-waiting blockers so both directly wait on a non-waiting blocker.
  const graph2 = {
    nodes: [
      {id: 1, x: 0, y: 0, z: 0}, {id: 2, x: 100, y: 0, z: 0},
      {id: 3, x: 0, y: 0, z: 20}, {id: 4, x: 100, y: 0, z: 20},
    ],
    lanes: [
      {id: 1, from: 1, to: 2, kind: 'motor', cls: 'primary', street: 'A', offset: 0, speedKmh: 36},
      {id: 2, from: 3, to: 4, kind: 'motor', cls: 'primary', street: 'B', offset: 0, speedKmh: 36},
    ],
    walks: [],
    signals: [],
  }
  const sim2 = new Traffic(graph2, () => 0.5, 0)
  const [t1, t2] = [...sim2.allTracks()]
  const b1 = makeCar(t1, 60, {stoppedUntil: 999})
  const b2 = makeCar(t2, 60, {stoppedUntil: 999})
  const s1 = makeCar(t1, 55, {waitingSince: 0})
  const s2 = makeCar(t2, 55, {waitingSince: 0})
  sim2.actors.push(b1, s1, b2, s2)
  sim2.time = 20
  sim2.step(0.05, {x: 50, y: 1.7, z: 10})
  assert.equal(s1.leaving, true, 'first starved vehicle rescued on the same 1 Hz pass')
  assert.equal(s2.leaving, true, 'second starved vehicle also rescued on the same 1 Hz pass')

  // In hiddenLifecycle mode, rescuing a starved car must NOT cascade to a follower waiting on it in the same tick.
  const simHl = new Traffic(graph, () => 0.5, 0)
  simHl.setDutyConfig({
    active: true,
    hiddenLifecycle: {
      bridgeEndDistance: () => 100,
      minBridgeEndDistM: 10,
      minPlayerDistM: 10,
      frustumMinDistM: 10,
    },
  })
  const hlTrack = [...simHl.allTracks()][0]
  const hlBlocker = makeCar(hlTrack, 70, {stoppedUntil: 999})
  const hlLead = makeCar(hlTrack, 65, {waitingSince: 0})
  const hlTail = makeCar(hlTrack, 60, {waitingSince: 0})
  simHl.actors.push(hlBlocker, hlLead, hlTail)
  simHl.time = 20
  simHl.step(0.05, {x: 60, y: 1.7, z: 0})
  assert.ok((hlLead.ghostPassUntil ?? 0) > simHl.time, 'lead starved car gets ghostPassUntil')
  assert.equal(hlTail.ghostPassUntil, undefined, 'queued follower does not cascade ghostPass in the same tick')
})

test('smooth kinematic braking slows gradually before red light and never crosses red/yellow', () => {
  const graph = {
    nodes: [{id: 1, x: 0, y: 0, z: 0}, {id: 2, x: 80, y: 0, z: 0}, {id: 3, x: 160, y: 0, z: 0}],
    lanes: [
      {id: 1, from: 1, to: 2, kind: 'motor', cls: 'primary', street: '主路', offset: 0, speedKmh: 43.2},
      {id: 2, from: 2, to: 3, kind: 'motor', cls: 'primary', street: '主路', offset: 0, speedKmh: 43.2},
      {id: 3, from: 3, to: 2, kind: 'motor', cls: 'primary', street: '横路', offset: 0, speedKmh: 36},
    ],
    walks: [],
    signals: [{node: 2, group: 2, offset: 0, phases: [{lanes: [3], green: 20, yellow: 3}, {lanes: [1], green: 20, yellow: 3}]}],
  }
  const sim = new Traffic(graph, () => 0.5, 0)
  const lane1 = [...sim.allTracks()].find(t => t.id === 1)
  const car = makeCar(lane1, 45, {speed: 12})
  sim.actors.push(car)
  let crossedOnRed = false
  sim.onCross = () => { crossedOnRed = true }
  const speeds = []
  for (let i = 0; i < 160; i++) {
    sim.step(0.05, {x: 80, y: 1.7, z: 0})
    speeds.push(car.speed)
  }
  assert.equal(crossedOnRed, false, 'never crosses red stop line')
  assert.ok(car.dist <= lane1.length - 1 + 1e-6, `stopped behind stop line: dist=${car.dist}`)
  assert.ok(sim.stopped > 0, 'records stop ticks while held at red')
  // Check that deceleration happened smoothly over multiple intermediate speeds (not 12 -> 0 in 1 tick)
  const intermediate = speeds.filter(s => s > 1 && s < 10)
  assert.ok(intermediate.length >= 10, `expected smooth braking frames, got ${intermediate.length}`)
  assert.equal(speeds[speeds.length - 1], 0, 'comes to full stop at line')
})

test('smooth car-following eases speed down behind stopped lead vehicle without overlap', () => {
  const graph = {
    nodes: [{id: 1, x: 0, y: 0, z: 0}, {id: 2, x: 120, y: 0, z: 0}],
    lanes: [{id: 1, from: 1, to: 2, kind: 'motor', cls: 'primary', street: '主路', offset: 0, speedKmh: 43.2}],
    walks: [],
    signals: [],
  }
  const sim = new Traffic(graph, () => 0.5, 0)
  const track = [...sim.allTracks()][0]
  const leader = makeCar(track, 60, {stoppedUntil: 10})
  const follower = makeCar(track, 40, {speed: 12})
  sim.actors.push(leader, follower)
  const speeds = []
  for (let i = 0; i < 80; i++) {
    sim.step(0.05, {x: 60, y: 1.7, z: 0})
    speeds.push(follower.speed)
    assert.ok(leader.dist - follower.dist >= 5 - 1e-5, `maintained >= 5m stopGap: ${leader.dist - follower.dist}`)
  }
  const intermediate = speeds.filter(s => s > 1 && s < 10)
  assert.ok(intermediate.length >= 8, `expected smooth car-following braking, got ${intermediate.length}`)
  assert.equal(follower.speed, 0, 'stops cleanly behind leader')
})

test('pooled obstacles and compacted queues leave no phantom blockers after despawn/vehicle removal', () => {
  const graph = {
    nodes: [{id: 1, x: 0, y: 0, z: 0}, {id: 2, x: 80, y: 0, z: 0}],
    lanes: [{id: 1, from: 1, to: 2, kind: 'motor', cls: 'primary', street: '主路', offset: 0, speedKmh: 36}],
    walks: [],
    signals: [],
  }
  const sim = new Traffic(graph, () => 0.5, 0)
  const track = [...sim.allTracks()][0]
  const car = makeCar(track, 20, {speed: 5})
  sim.actors.push(car)
  // Place player vehicle directly in front at x=25 for 10 ticks -> car stops
  for (let i = 0; i < 10; i++) sim.step(0.05, {x: 25, y: 1.7, z: 0}, {x: 25, y: 0, z: 0})
  const stoppedDist = car.dist
  assert.ok(stoppedDist <= 20.1, 'blocked by player vehicle')
  // Remove player vehicle -> pooled obstacle bin must be completely cleared so car drives past x=25
  for (let i = 0; i < 80; i++) sim.step(0.05, {x: 25, y: 1.7, z: 0})
  assert.ok(car.dist > 30, `car resumed past removed player vehicle: dist=${car.dist}`)
})

test('exit selection preserves 6-tier scooter priority and offset tie-breaking', () => {
  const graph = {
    nodes: [
      {id: 1, x: 0, y: 0, z: 0},
      {id: 2, x: 40, y: 0, z: 0},
      {id: 3, x: 80, y: 0, z: 0},
    ],
    lanes: [
      {id: 10, from: 1, to: 2, kind: 'nonmotor', cls: 'primary', street: '中山路', offset: 1, speedKmh: 25},
      {id: 20, from: 2, to: 3, kind: 'motor', cls: 'primary', street: '中山路', offset: 1, speedKmh: 40},
      {id: 21, from: 2, to: 3, kind: 'nonmotor', cls: 'primary', street: '其他路', offset: 1, speedKmh: 25},
      {id: 22, from: 2, to: 3, kind: 'nonmotor', cls: 'primary', street: '中山路', offset: 4, speedKmh: 25},
      {id: 23, from: 2, to: 3, kind: 'nonmotor', cls: 'primary', street: '中山路', offset: 1.2, speedKmh: 25},
    ],
    walks: [],
    signals: [],
  }
  const sim = new Traffic(graph, () => 0.1, 0) // < 0.85 -> prefers straight & closest |offset|
  const entry = [...sim.allTracks()].find(t => t.id === 10)
  const scooter = makeCar(entry, 39.8, {kind: 'scooter', speed: 6, halfWidth: 0.3, halfLength: 0.85})
  sim.actors.push(scooter)
  sim.step(0.1, {x: 40, y: 1.7, z: 0})
  assert.equal(scooter.track.id, 23, 'picks same-street real nonmotor lane with closest lateral offset')
})

test('canRoute exclude parameter matches filtered actors and inherit preserves camera state', () => {
  // 12 stations (0..22 m): wide bays at 0 and 11 (>= 850 mm), 18 m narrow pinch in between (needsAdmission=true)
  const samples = Array.from({length: 12}, (_, i) => (i === 0 || i === 11 ? [500, 500] : [300, 300]))
  const profile = [samples, [[0, 11]]]
  const corrFwd = {profile, length: 22, direction: 1, origin: 0}
  const corrRev = {profile, length: 22, direction: -1, origin: 22}
  const selfWalker = {track: {corridor: corrRev, length: 22}, dist: 10, arrived: false, leaving: false}
  // Without exclude, selfWalker appears oncoming to corrFwd; with exclude=selfWalker, allowed!
  assert.equal(canRoute(corrFwd, 0, [selfWalker]), false)
  assert.equal(canRoute(corrFwd, 0, [selfWalker], selfWalker), true)

  const graph = {
    nodes: [{id: 1, x: 0, y: 0, z: 0}, {id: 2, x: 80, y: 0, z: 0}],
    lanes: [{id: 1, from: 1, to: 2, kind: 'motor', cls: 'primary', street: 'A', offset: 0, speedKmh: 36}],
    walks: [],
    signals: [],
  }
  const simA = new Traffic(graph, () => 0.5, 0)
  simA.step(0.05, {x: 40, y: 1.7, z: 0})
  simA.time = 10 // past initial warmup
  simA.step(0.05, {x: 41, y: 1.7, z: 0})
  const simB = new Traffic(graph, () => 0.5, 0)
  simB.inherit(simA)
  simB.step(0.05, {x: 42, y: 1.7, z: 0})
  // If hasLastCamera was lost on inherit, warmUntil would jump to ~11.25 (> 10.1)
  assert.ok(simB.time > 10 && simB.actors.length === 0)
})
