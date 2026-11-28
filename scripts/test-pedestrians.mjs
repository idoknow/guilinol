import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {gunzipSync} from 'node:zlib'
import {Traffic} from '../web/src/traffic/sim.ts'
import {SignalPlan} from '../web/src/traffic/signals.ts'
import {QUIET_ZONES, isPointInQuietZone, segmentHitsQuietZone} from '../web/src/game/quiet-zones.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function makeSeededRng(seed = 39907) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function makeWalker(track, dist, extra = {}) {
  return {
    track,
    dist,
    x: track.start.x + track.dx * dist,
    y: 0,
    z: track.start.z + track.dz * dist,
    speed: 1.4,
    pace: 1.4,
    kind: 'person',
    down: 0,
    dodge: 0,
    yaw: track.yaw,
    scale: 1,
    leaving: false,
    halfWidth: 0.3,
    halfLength: 0.3,
    height: 1.5,
    ...extra,
  }
}

function makeVehicle(track, dist, kind = 'car', extra = {}) {
  const off = track.offset || 0
  return {
    track,
    dist,
    x: track.start.x + track.dx * dist - track.dz * off,
    y: 0,
    z: track.start.z + track.dz * dist + track.dx * off,
    speed: 5,
    kind,
    down: 0,
    dodge: 0,
    yaw: track.yaw,
    scale: 1,
    leaving: false,
    halfWidth: kind === 'scooter' ? 0.3 : 0.9,
    halfLength: kind === 'scooter' ? 0.85 : 2.1,
    height: 1.5,
    ...extra,
  }
}

/**
 * Signalised 4-way crossroads centred at (0, 0):
 * - Phase 0 (t in [0, 18) green, [18, 21) yellow): East-West traffic (lane 1: (-60,0)->(0,0))
 * - Phase 1 (t in [21, 39) green, [39, 42) yellow): North-South traffic (lane 2: (0,-60)->(0,0))
 * Crossing runs East-West at z = 8 (crossing the North-South carriageway from x = -6 to x = +6).
 * Therefore crossing is GREEN during Phase 0 green [0, 18), YELLOW during [18, 21), RED during Phase 1 [21, 42).
 */
function buildSignalCrossroads({withApproach = true, offset = 0} = {}) {
  const crossingPoints = withApproach
    ? [[-10, 8], [-6, 8], [6, 8], [10, 8]]
    : [[-6.1, 8], [-6, 8], [6, 8], [6.1, 8]]
  const startWalkEnd = withApproach ? -10 : -6
  const endWalkStart = withApproach ? 10 : 6
  return {
    nodes: [
      {id: 1, x: -60, y: 0, z: 0},
      {id: 2, x: 0, y: 0, z: 0},
      {id: 3, x: 60, y: 0, z: 0},
      {id: 4, x: 0, y: 0, z: -60},
      {id: 5, x: 0, y: 0, z: 60},
    ],
    lanes: [
      {
        id: 1, from: 1, to: 2, offset: 0, width: 3.5, kind: 'motor', cls: 'primary', speedKmh: 36, street: '东西路',
        npcWalks: [[-40, 8, startWalkEnd, 8]],
        pedCrossings: [{osm: ['node', 9001], bars: 6, width: 3.6, points: crossingPoints}],
      },
      {
        id: 3, from: 2, to: 3, offset: 0, width: 3.5, kind: 'motor', cls: 'primary', speedKmh: 36, street: '东西路',
        npcWalks: [[endWalkStart, 8, 40, 8]],
      },
      {id: 2, from: 4, to: 2, offset: 0, width: 3.5, kind: 'motor', cls: 'primary', speedKmh: 36, street: '南北路'},
      {id: 4, from: 2, to: 5, offset: 0, width: 3.5, kind: 'motor', cls: 'primary', speedKmh: 36, street: '南北路'},
    ],
    walks: [],
    signals: [
      {
        node: 2,
        group: 2,
        offset,
        phases: [
          {lanes: [1], green: 18, yellow: 3},
          {lanes: [2], green: 18, yellow: 3},
        ],
      },
    ],
    quiet: [],
  }
}

test('pedestrian signal phase matches unified SignalPlan, signalShift, 3-phase and skips 1-phase deadlocks', () => {
  const graph = buildSignalCrossroads({offset: 7})
  const sim = new Traffic(graph, makeSeededRng(1), 0)
  const plan = new SignalPlan(graph.signals)
  const painted = [...sim.allTracks()].find(t => t.walk && t.painted && t.dx > 0)
  assert.ok(painted?.pedSignal, 'painted crossing near signal binds pedSignal')

  // Every second across two full cycles: EW crossing complements NS vehicle phase and mirrors EW vehicle phase.
  for (let t = 0; t < 84; t++) {
    const ewVeh = plan.color(2, 1, t)
    const nsVeh = plan.color(2, 2, t)
    const ewPed = sim.pedestrianPhase(painted, t)
    const apiPed = sim.getPedestrianSignalPhase(2, 1, 0, t)
    const nsPed = sim.getPedestrianSignalPhase(2, 0, 1, t)
    assert.equal(ewPed, apiPed)
    assert.equal(ewPed, ewVeh, `t=${t}: EW crossing should match EW phase (${ewVeh})`)
    assert.equal(nsPed, nsVeh, `t=${t}: NS crossing should match NS phase (${nsVeh})`)
    if (ewPed === 'green') assert.equal(nsVeh, 'red', `t=${t}: conflicting NS traffic must be red when EW ped is green`)
  }

  // signalShift sync: moving sim.signalShift shifts pedestrianPhase identically to sim.phase
  sim.time = 5
  sim.signalShift = 20 // effective t = 25 (with offset 7 -> 32 % 42 -> Phase 1 green, EW red)
  assert.equal(sim.phase({id: 1, to: 2}), 'red')
  assert.equal(sim.pedestrianPhase(painted), 'red')
  sim.signalShift = 35 // effective t = 40 (with offset 7 -> 47 % 42 = 5 -> Phase 0 green, EW green)
  assert.equal(sim.phase({id: 1, to: 2}), 'green')
  assert.equal(sim.pedestrianPhase(painted), 'green')

  // 3-phase signal: only non-conflicting phase yields green
  const triGraph = {
    nodes: [
      {id: 1, x: -50, y: 0, z: 0}, {id: 2, x: 0, y: 0, z: 0},
      {id: 3, x: 0, y: 0, z: -50}, {id: 4, x: -35, y: 0, z: -35},
    ],
    lanes: [
      {id: 1, from: 1, to: 2, offset: 0, kind: 'motor', cls: 'primary', speedKmh: 36, street: 'E'},
      {id: 2, from: 3, to: 2, offset: 0, kind: 'motor', cls: 'primary', speedKmh: 36, street: 'S'},
      {id: 3, from: 4, to: 2, offset: 0, kind: 'motor', cls: 'primary', speedKmh: 36, street: 'D'},
    ],
    walks: [],
    signals: [{node: 2, group: 2, offset: 0, phases: [
      {lanes: [1], green: 10, yellow: 2},
      {lanes: [2], green: 10, yellow: 2},
      {lanes: [3], green: 10, yellow: 2},
    ]}],
    quiet: [],
  }
  const triSim = new Traffic(triGraph, makeSeededRng(2), 0)
  assert.equal(triSim.getPedestrianSignalPhase(2, 1, 0, 5), 'green')
  assert.equal(triSim.getPedestrianSignalPhase(2, 1, 0, 11), 'yellow')
  assert.equal(triSim.getPedestrianSignalPhase(2, 1, 0, 15), 'red')
  assert.equal(triSim.getPedestrianSignalPhase(2, 1, 0, 27), 'red')

  // Single-phase signal must NOT trap pedestrians in permanent red
  const singleGraph = {
    nodes: [{id: 1, x: 0, y: 0, z: -50}, {id: 2, x: 0, y: 0, z: 0}],
    lanes: [{
      id: 1, from: 1, to: 2, offset: 0, kind: 'motor', cls: 'primary', speedKmh: 36, street: 'S',
      pedCrossings: [{osm: ['node', 9002], bars: 4, width: 3, points: [[-8, 6], [-5, 6], [5, 6], [8, 6]]}],
    }],
    walks: [],
    signals: [{node: 2, group: 2, offset: 0, phases: [{lanes: [1], green: 18, yellow: 3}]}],
    quiet: [],
  }
  const singleSim = new Traffic(singleGraph, makeSeededRng(3), 0)
  const singlePainted = [...singleSim.allTracks()].find(t => t.walk && t.painted)
  assert.ok(singlePainted)
  assert.equal(singleSim.pedestrianPhase(singlePainted, 5), null, '1-phase signal leaves crossing unbound to prevent permanent red')
})

test('pedestrians stop at red/yellow crosswalk entry (with and without approach) and cross cleanly on green', () => {
  for (const withApproach of [true, false]) {
    const graph = buildSignalCrossroads({withApproach, offset: 0})
    const sim = new Traffic(graph, makeSeededRng(10), 0)
    // Start at t = 22s (Phase 1 green -> EW crossing RED until t = 42s)
    sim.time = 22
    const approachTrack = [...sim.allTracks()].find(t =>
      t.walk && !t.painted && t.dx > 0 && (withApproach ? Boolean(t.nextLink?.painted) : Math.abs(t.end.x - (-6)) < 0.2),
    )
    assert.ok(approachTrack, `missing entry track (withApproach=${withApproach})`)
    const walker = makeWalker(approachTrack, Math.max(0, approachTrack.length - 2.5))
    sim.actors.push(walker)
    const crossTimes = []
    sim.onPedCross = (_track, time) => crossTimes.push(time)

    // Step through red phase [22s .. 41.5s]: must never enter painted crossing
    let sawWaiting = false
    for (let i = 0; i < 380; i++) {
      sim.step(0.05, {x: 0, y: 1.7, z: 8})
      assert.equal(Boolean(walker.track.painted), false, `withApproach=${withApproach}: entered crossing during red at t=${sim.time.toFixed(2)}`)
      if (walker.waitingForSignal) {
        sawWaiting = true
        assert.equal(walker.waitingAtGate, false, 'signal wait must stay separate from narrow-corridor waitingAtGate')
        assert.ok(walker.speed <= 0.1, `stopped walker speed too high: ${walker.speed}`)
        assert.ok(Math.cos(walker.yaw - Math.PI / 2) > 0.99, 'waiting pedestrian faces across the crosswalk')
      }
    }
    assert.ok(sawWaiting, `withApproach=${withApproach}: expected pedestrian to wait at red`)
    assert.equal(sim.pedCrossed, 0)
    assert.ok(sim.pedStopped > 0)

    // Continue past t = 42s (green starts) -> must enter painted crossing and reach the far sidewalk (x > 10)
    let steppedOnPainted = false
    for (let i = 0; i < 400; i++) {
      sim.step(0.05, {x: 0, y: 1.7, z: 8})
      if (walker.track.painted) steppedOnPainted = true
    }
    assert.ok(steppedOnPainted, `withApproach=${withApproach}: should cross when light turns green`)
    assert.equal(sim.pedCrossed, 1)
    assert.equal(crossTimes.length, 1)
    assert.ok(crossTimes[0] >= 42 - 1e-6, `crossed before green at t=${crossTimes[0]}`)
    assert.ok(walker.x > 10, `expected pedestrian to reach far bank, got x=${walker.x.toFixed(2)}`)
  }
})

test('yellow clearance holds new pedestrians at curb while allowing already-crossing pedestrians to finish', () => {
  const graph = buildSignalCrossroads({withApproach: true, offset: 0})
  const sim = new Traffic(graph, makeSeededRng(20), 0)
  // t = 18.2s -> Phase 0 yellow (EW crossing YELLOW [18, 21), then RED [21, 42))
  sim.time = 18.2
  const approachTrack = [...sim.allTracks()].find(t => t.walk && !t.painted && t.dx > 0 && t.nextLink?.painted)
  const paintedTrack = approachTrack.nextLink
  assert.ok(approachTrack && paintedTrack?.painted)

  const newArrival = makeWalker(approachTrack, approachTrack.length - 1.5)
  const midCrosser = makeWalker(paintedTrack, 4.0)
  sim.actors.push(newArrival, midCrosser)

  for (let i = 0; i < 200; i++) {
    sim.step(0.05, {x: 0, y: 1.7, z: 8})
    assert.equal(Boolean(newArrival.track.painted), false, `new arrival must not enter during yellow/red at t=${sim.time.toFixed(2)}`)
  }
  assert.ok(newArrival.waitingForSignal, 'new arrival waits at curb during yellow/red')
  assert.ok(midCrosser.x > 10 && !midCrosser.track.painted, `already-crossing walker must clear crosswalk, got x=${midCrosser.x.toFixed(2)}`)
})

test('multiple queued pedestrians cross in order without overlap, and stopped red-light cars do not deadlock green walkers', () => {
  const graph = buildSignalCrossroads({withApproach: true, offset: 0})
  const sim = new Traffic(graph, makeSeededRng(30), 0)
  // Start near end of red (t = 37s; green at t = 42s)
  sim.time = 37
  const approachTrack = [...sim.allTracks()].find(t => t.walk && !t.painted && t.dx > 0 && t.nextLink?.painted)
  const nsLane = [...sim.allTracks()].find(t => t.id === 2)
  assert.ok(approachTrack && nsLane)

  // Three pedestrians queue up on approach track, plus a car stopped right behind the NS red stop line near the crosswalk
  const p1 = makeWalker(approachTrack, 2.8)
  const p2 = makeWalker(approachTrack, 1.5)
  const p3 = makeWalker(approachTrack, 0.3)
  // Place a stopped vehicle near the crossing edge (lateral to crosswalk, stopped at red)
  const nsCar = makeVehicle(nsLane, nsLane.length - 1, 'car', {speed: 0})
  nsCar.x = 0; nsCar.z = 5.6 // 2.4m away from z=8 crosswalk centerline (within old 4m freeze radius)
  sim.actors.push(p1, p2, p3, nsCar)

  for (let i = 0; i < 500; i++) {
    sim.step(0.05, {x: 0, y: 1.7, z: 8})
    // Hold nsCar stationary at stop line during EW green to simulate a red-waiting car right next to zebra
    if (sim.time >= 42 && sim.time < 60) {
      nsCar.x = 0; nsCar.z = 5.6; nsCar.speed = 0
    }
    const d12 = Math.hypot(p1.x - p2.x, p1.z - p2.z)
    const d23 = Math.hypot(p2.x - p3.x, p2.z - p3.z)
    assert.ok(d12 >= 0.35 && d23 >= 0.35, `queued pedestrians overlapped: d12=${d12.toFixed(2)} d23=${d23.toFixed(2)}`)
  }
  assert.equal(sim.pedCrossed, 3, 'all 3 queued pedestrians crossed cleanly after green')
  assert.ok(p1.x > 10 && p2.x > 10 && p3.x > 10, `all 3 should reach far sidewalk: ${[p1.x, p2.x, p3.x].map(v => v.toFixed(1))}`)
})

test('curb-waiting pedestrian does not block green carriageway vehicles, and unsignalised crosswalk stays passable', () => {
  const graph = buildSignalCrossroads({withApproach: true, offset: 0})
  const sim = new Traffic(graph, makeSeededRng(31), 0)
  // t = 24s: NS phase (lane 2) is GREEN, EW crossing is RED
  sim.time = 24
  const approachTrack = [...sim.allTracks()].find(t => t.walk && !t.painted && t.dx > 0 && t.nextLink?.painted)
  const nsLane = [...sim.allTracks()].find(t => t.id === 2)
  assert.ok(approachTrack && nsLane)

  // Place pedestrian waiting at curb; car drives south along NS lane (x=0) on green
  const waiter = makeWalker(approachTrack, approachTrack.length - 0.15)
  const car = makeVehicle(nsLane, nsLane.length - 12, 'car', {speed: 8})
  sim.actors.push(waiter, car)
  for (let i = 0; i < 80; i++) sim.step(0.05, {x: 0, y: 1.7, z: 0})
  assert.equal(car.track.id, 4, `NS green car should pass intersection uninterrupted, got track ${car.track.id}`)
  assert.equal(Boolean(waiter.track.painted), false, 'waiter stayed at curb on red')

  // Unsignalised crosswalk (no signals in graph) remains freely passable
  const unsigGraph = buildSignalCrossroads({withApproach: true})
  unsigGraph.signals = []
  const unsigSim = new Traffic(unsigGraph, makeSeededRng(32), 0)
  const uApp = [...unsigSim.allTracks()].find(t => t.walk && !t.painted && t.dx > 0 && t.nextLink?.painted)
  const uWalker = makeWalker(uApp, uApp.length - 1)
  unsigSim.actors.push(uWalker)
  for (let i = 0; i < 320; i++) unsigSim.step(0.05, {x: 0, y: 1.7, z: 8})
  assert.ok(uWalker.x > 10, `unsignalised crossing must stay passable, got x=${uWalker.x.toFixed(2)}`)
})

test('campus quiet zones block motor/nonmotor spawning & entry (forward, reverse, lane-change, encroach) while preserving pedestrian flow', () => {
  // Custom campus quiet zone box [100, -40] .. [180, 40] (5m outer buffer -> [95, -45] .. [185, 45])
  const campusZone = {
    id: 'test_campus',
    name: '测试校园安静区',
    polygon: [[100, -40], [180, -40], [180, 40], [100, 40]],
  }
  const graph = {
    nodes: [
      {id: 1, x: 0, y: 0, z: 0},
      {id: 2, x: 80, y: 0, z: 0},      // outside campus (15m west of 5m buffer)
      {id: 3, x: 140, y: 0, z: 0},     // deep inside campus
      {id: 4, x: 240, y: 0, z: 0},     // east outside campus
      {id: 5, x: 80, y: 0, z: 90},     // south escape route outside campus
      {id: 6, x: 80, y: 0, z: -90},    // north escape route outside campus
    ],
    lanes: [
      // Outside approach leading to junction node 2
      {id: 10, from: 1, to: 2, offset: 0, width: 3.5, kind: 'motor', cls: 'primary', speedKmh: 36, street: '校门路', npcWalks: [[5, 6, 75, 6]]},
      {id: 11, from: 1, to: 2, offset: 3.2, width: 2.0, kind: 'nonmotor', cls: 'cycleway', speedKmh: 22, street: '校门路'},
      // Campus-penetrating motor & nonmotor lanes (MUST block all vehicles, KEEP pedestrians!)
      {id: 20, from: 2, to: 3, offset: 0, width: 3.5, kind: 'motor', cls: 'primary', speedKmh: 36, street: '校园主道', npcWalks: [[105, 6, 175, 6]]},
      {id: 21, from: 2, to: 3, offset: 3.2, width: 2.0, kind: 'nonmotor', cls: 'cycleway', speedKmh: 22, street: '校园主道'},
      {id: 22, from: 3, to: 4, offset: 0, width: 3.5, kind: 'motor', cls: 'primary', speedKmh: 36, street: '校园主道'},
      {id: 23, from: 3, to: 4, offset: 3.2, width: 2.0, kind: 'nonmotor', cls: 'cycleway', speedKmh: 22, street: '校园主道'},
      // Safe detour lanes outside campus from node 2
      {id: 30, from: 2, to: 5, offset: 0, width: 3.5, kind: 'motor', cls: 'primary', speedKmh: 36, street: '环校南路'},
      {id: 31, from: 2, to: 5, offset: 3.2, width: 2.0, kind: 'nonmotor', cls: 'cycleway', speedKmh: 22, street: '环校南路'},
      {id: 32, from: 6, to: 2, offset: 3.2, width: 2.0, kind: 'nonmotor', cls: 'cycleway', speedKmh: 22, street: '环校北路'},
      // Boundary-skimming nonmotor lane 5.8m outside campus polygon (inside buffer if encroachOffset=+1.65 applied!)
      {id: 40, from: 6, to: 5, offset: -14.2, width: 2.0, kind: 'nonmotor', cls: 'cycleway', speedKmh: 22, street: '校外贴边道'},
    ],
    walks: [],
    signals: [],
    quiet: [campusZone],
  }

  // 1) Spawning test: camera centered inside campus -> 0 cars/scooters inside quiet zone, pedestrians still spawn!
  const sim = new Traffic(graph, makeSeededRng(40), 60)
  // Also test duty mode spawning inside quiet zone
  sim.setDutyConfig({active: true, center: {x: 140, z: 0}, radius: 120, desiredCars: 6, desiredScooters: 6})
  let campusPedFrames = 0
  for (let tick = 0; tick < 300; tick++) {
    sim.step(0.05, {x: 140, y: 1.7, z: 0})
    for (const actor of sim.actors) {
      const inQuiet = sim.isPointQuiet(actor.x, actor.z)
      if (actor.kind === 'person') {
        if (inQuiet) campusPedFrames++
      } else {
        assert.equal(inQuiet, false, `vehicle ${actor.kind} entered/spawned in quiet zone at (${actor.x.toFixed(1)}, ${actor.z.toFixed(1)}) on track ${actor.track.id}`)
      }
    }
  }
  assert.ok(campusPedFrames > 200, `campus pedestrian flow must remain active inside quiet zone, got ${campusPedFrames} frames`)

  // 2) Connected-lane entry prevention: car, forward scooter, reverse wrong-way scooter approaching node 2
  const navSim = new Traffic(graph, makeSeededRng(41), 0)
  const motorIn = [...navSim.allTracks()].find(t => t.id === 10 && !t.virtual)
  const nmIn = [...navSim.allTracks()].find(t => t.id === 11)
  const revFromEast = [...navSim.allTracks()].find(t => t.id === 23)
  const skimLane = [...navSim.allTracks()].find(t => t.id === 40)
  assert.ok(motorIn && nmIn && revFromEast && skimLane)
  assert.equal([...navSim.allTracks()].find(t => t.id === 20 && !t.virtual).inQuietZone, true)
  assert.equal([...navSim.allTracks()].find(t => t.id === 21).inQuietZone, true)

  const car = makeVehicle(motorIn, motorIn.length - 5, 'car', {speed: 8})
  const scooter = makeVehicle(nmIn, nmIn.length - 5, 'scooter', {speed: 6})
  // Wrong-way scooter starting outside on lane 30 (from node 2 -> 5) heading backwards to node 2: must NOT enter lane 21 (quiet)
  const safeOutNm = [...navSim.allTracks()].find(t => t.id === 31)
  const wwScooter = makeVehicle(safeOutNm, 4, 'scooter', {speed: 5, wrongWay: true, violation: 'wrong_way', violations: ['wrong_way']})
  // Boundary-skimming scooter with sidewalk encroachOffset (+1.65 toward +X campus wall at x=95):
  // skimLane is from (80,-90)->(80,90) with dx=0,dz=1, offset=-14.2 -> x = 80 - 1*(-14.2) = 94.2? Wait check offset sign: x = start.x - dz * offset = 80 - (-14.2) = 94.2 -> inside!
  // Construct explicit track right outside buffer (x=94.0 -> outside x=95? Wait campus minX=100, buffer=5 -> buffer edge x=95.0; x=94.0 is 1.0m outside buffer, +1.65 pushes to x=95.65 inside!)
  navSim.actors.push(car, scooter, wwScooter)
  for (let tick = 0; tick < 240; tick++) {
    navSim.step(0.05, {x: 80, y: 1.7, z: 0})
    for (const actor of navSim.actors) {
      assert.equal(navSim.isPointQuiet(actor.x, actor.z), false, `${actor.kind} (wrongWay=${actor.wrongWay}) entered quiet zone at (${actor.x.toFixed(1)}, ${actor.z.toFixed(1)}) on track ${actor.track.id}`)
    }
  }
  assert.equal(car.track.id, 30, 'car detoured onto non-quiet lane 30 instead of entering campus lane 20')
  assert.equal(scooter.track.id, 31, 'scooter detoured onto non-quiet lane 31 instead of entering campus lane 21')
  assert.notEqual(wwScooter.track.id, 21, 'wrong-way scooter never entered campus lane 21')

  // 2b) Dead-end road leading ONLY into a campus quiet zone: vehicle stops outside campus and never enters
  const deadEndGraph = {
    nodes: [{id: 1, x: 0, y: 0, z: 0}, {id: 2, x: 80, y: 0, z: 0}, {id: 3, x: 140, y: 0, z: 0}],
    lanes: [
      {id: 10, from: 1, to: 2, offset: 0, width: 3.5, kind: 'motor', cls: 'primary', speedKmh: 36, street: '尽头路'},
      {id: 20, from: 2, to: 3, offset: 0, width: 3.5, kind: 'motor', cls: 'primary', speedKmh: 36, street: '尽头路'},
    ],
    walks: [],
    signals: [],
    quiet: [campusZone],
  }
  const deadSim = new Traffic(deadEndGraph, makeSeededRng(411), 0)
  const deadIn = [...deadSim.allTracks()].find(t => t.id === 10 && !t.virtual)
  const deadCar = makeVehicle(deadIn, 70, 'car', {speed: 8})
  deadSim.actors.push(deadCar)
  for (let tick = 0; tick < 80; tick++) {
    deadSim.step(0.05, {x: 80, y: 1.7, z: 0}, undefined, () => true)
    assert.equal(deadSim.isPointQuiet(deadCar.x, deadCar.z), false, 'dead-end vehicle never enters campus quiet zone')
  }
  assert.equal(deadCar.track.id, 10)
  assert.equal(deadCar.speed, 0)

  // 3) Encroach offset clamp at quiet-zone boundary: track at x = 94.0 (1.0m outside 5m buffer edge x=95.0),
  //    encroachOffset = -1.65 along +normal (x = start.x - dz * offset) -> pushes toward x = 95.65 inside quiet zone -> MUST be clamped!
  const edgeGraph = {
    nodes: [{id: 1, x: 94.0, y: 0, z: -60}, {id: 2, x: 94.0, y: 0, z: 60}],
    lanes: [{id: 1, from: 1, to: 2, offset: 0, width: 2, kind: 'nonmotor', cls: 'cycleway', speedKmh: 22, street: '校外边道'}],
    walks: [],
    signals: [],
    quiet: [campusZone],
  }
  const edgeSim = new Traffic(edgeGraph, makeSeededRng(42), 0)
  const edgeTrack = [...edgeSim.allTracks()][0]
  assert.equal(edgeTrack.inQuietZone, false)
  assert.equal(edgeTrack.nearQuietZone, true)
  const encroacher = makeVehicle(edgeTrack, 10, 'scooter', {
    speed: 5,
    laneCompliant: false,
    encroachmentKind: 'scooter_on_sidewalk',
    encroachOffset: -1.65, // dx=0, dz=1 -> x = 94.0 - 1*(-1.65) = 95.65 (inside x>=95 quiet buffer)
  })
  edgeSim.actors.push(encroacher)
  for (let tick = 0; tick < 80; tick++) {
    edgeSim.step(0.05, {x: 94, y: 1.7, z: 0})
    assert.equal(edgeSim.isPointQuiet(encroacher.x, encroacher.z), false, `encroaching scooter intruded quiet zone at x=${encroacher.x.toFixed(2)}`)
  }
  assert.ok(encroacher.z > -40, 'clamped encroacher still drives along safe lane outside quiet zone')

  // 4) Fallback to built-in QUIET_ZONES when graph.quiet is omitted (e.g. 512m streamed cell files)
  const z0 = QUIET_ZONES[0]
  const qcx = (z0.bbox[0] + z0.bbox[2]) / 2, qcz = (z0.bbox[1] + z0.bbox[3]) / 2
  const cellLikeGraph = {
    nodes: [{id: 1, x: qcx - 40, y: 0, z: qcz}, {id: 2, x: qcx + 40, y: 0, z: qcz}],
    lanes: [{
      id: 1, from: 1, to: 2, offset: 0, width: 3.5, kind: 'motor', cls: 'primary', speedKmh: 36, street: '校园内',
      npcWalks: [[qcx - 30, qcz + 4, qcx + 30, qcz + 4]],
    }],
    walks: [],
    signals: [],
    // quiet intentionally omitted!
  }
  const cellSim = new Traffic(cellLikeGraph, makeSeededRng(43), 40)
  assert.equal(segmentHitsQuietZone(qcx - 40, qcz, qcx + 40, qcz), true)
  let cellPeds = 0
  for (let tick = 0; tick < 120; tick++) {
    cellSim.step(0.05, {x: qcx, y: 1.7, z: qcz})
    for (const actor of cellSim.actors) {
      if (actor.kind === 'person') cellPeds++
      else assert.equal(isPointInQuietZone(actor.x, actor.z), false, `cell fallback failed: ${actor.kind} inside ${z0.id}`)
    }
  }
  assert.ok(cellPeds > 50, 'built-in QUIET_ZONES fallback still preserves pedestrians')
})

test('real Guilin road graph enforces zero vehicles in campus quiet zones while preserving campus pedestrians', () => {
  const graphPath = join(root, 'public/world/roads/graph.json.gz')
  if (!existsSync(graphPath)) return
  const graph = JSON.parse(gunzipSync(readFileSync(graphPath)))
  const sim = new Traffic(graph, makeSeededRng(39977), 100)
  const targetIds = ['chuanshan_tourism', 'tianjiabing', 'longyin_primary', 'lequn_primary', 'guilin_middle', 'wangcheng_teaching']
  let motorFrames = 0, quietViolations = 0, pedFrames = 0, insideQuietPedFrames = 0
  for (const id of targetIds) {
    const zone = QUIET_ZONES.find(z => z.id === id)
    assert.ok(zone)
    const cx = (zone.bbox[0] + zone.bbox[2]) / 2
    const cz = (zone.bbox[1] + zone.bbox[3]) / 2
    sim.actors.length = 0
    for (let tick = 0; tick < 200; tick++) {
      sim.step(0.05, {x: cx, y: 150, z: cz})
      for (const actor of sim.actors) {
        if (actor.kind === 'person') {
          pedFrames++
          if (isPointInQuietZone(actor.x, actor.z)) insideQuietPedFrames++
        } else {
          motorFrames++
          if (isPointInQuietZone(actor.x, actor.z)) quietViolations++
        }
      }
    }
  }
  assert.equal(quietViolations, 0, `vehicles entered real campus quiet zones: ${quietViolations}`)
  assert.ok(pedFrames > 1000, `expected active pedestrian traffic around campuses, got ${pedFrames}`)
  assert.ok(insideQuietPedFrames > 0, `expected campus-sidewalk pedestrians retained inside quiet zones, got ${insideQuietPedFrames}`)
})
