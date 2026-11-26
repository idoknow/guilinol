import assert from 'node:assert/strict'
import {readFileSync, rmSync} from 'node:fs'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test, {after} from 'node:test'
import {pathToFileURL} from 'node:url'
import {gunzipSync} from 'node:zlib'
import {build} from 'esbuild'

const bundleDir = await mkdtemp(join(tmpdir(), 'glol-duty-traffic-test-'))
const bundleFile = join(bundleDir, 'sut.mjs')
process.once('exit', () => {
  try {
    rmSync(bundleDir, {recursive: true, force: true})
  } catch {
    // ignore
  }
})

await build({
  stdin: {
    contents: `
      export * as THREE from 'three'
      export {trafficEnabled} from './web/src/game/play-mode.ts'
      export {getActorViolations, stopActor, Traffic} from './web/src/traffic/sim.ts'
      export {resolveTwoWheelSpec, trafficModels} from './web/src/traffic/models.ts'
      export {
        classifyJiefangCrossSectionZone,
        createDutyTraffic,
        getActiveDutyTraffic,
        getActorHandBone,
        getDutyTrafficExclusionZone,
        getJiefangCrossSection,
        isDutyTrafficActive,
        isOnJiefangApproachCorridor,
        JIEFANG_APPROACH_MIN_DIST_M,
        JIEFANG_DUTY_CENTER,
        JIEFANG_DUTY_RADIUS_M,
        JIEFANG_HIDDEN_FRUSTUM_MAX_DIST_M,
        JIEFANG_HIDDEN_PLAYER_MIN_DIST_M,
        JIEFANG_PULLOVER_OUTER_ABS_Z,
        jiefangBridgeEndDistanceM,
        receiveDutyTicket,
        sliceDutySubgraph,
      } from './web/src/traffic/duty-traffic.ts'
      export {
        JIEFANG_CROSS_SECTION,
        isOnJiefangBridgeDeck,
        jiefangBridgeLocalToWorld,
        jiefangDeckWorldY,
        worldToJiefangBridgeLocal,
      } from './web/src/traffic-duty/jiefang-railings.ts'
      export {
        mountShizijieSignalsOverlay,
        SHIZIJIE_ORIGIN,
      } from './web/src/traffic-duty/traffic-signals-overlay.ts'
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  outfile: bundleFile,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  logLevel: 'silent',
})

after(async () => {
  await rm(bundleDir, {recursive: true, force: true})
})

if (typeof globalThis.addEventListener !== 'function') globalThis.addEventListener = () => {}
if (typeof globalThis.matchMedia !== 'function') globalThis.matchMedia = () => ({matches: false})

const {
  THREE,
  trafficEnabled,
  getActorViolations,
  stopActor,
  Traffic,
  resolveTwoWheelSpec,
  trafficModels,
  classifyJiefangCrossSectionZone,
  createDutyTraffic,
  getActiveDutyTraffic,
  getActorHandBone,
  getDutyTrafficExclusionZone,
  getJiefangCrossSection,
  isDutyTrafficActive,
  isOnJiefangApproachCorridor,
  JIEFANG_APPROACH_MIN_DIST_M,
  JIEFANG_CROSS_SECTION,
  isOnJiefangBridgeDeck,
  jiefangBridgeLocalToWorld,
  jiefangDeckWorldY,
  worldToJiefangBridgeLocal,
  JIEFANG_DUTY_CENTER,
  JIEFANG_DUTY_RADIUS_M,
  JIEFANG_HIDDEN_FRUSTUM_MAX_DIST_M,
  JIEFANG_HIDDEN_PLAYER_MIN_DIST_M,
  JIEFANG_PULLOVER_OUTER_ABS_Z,
  jiefangBridgeEndDistanceM,
  receiveDutyTicket,
  sliceDutySubgraph,
  mountShizijieSignalsOverlay,
  SHIZIJIE_ORIGIN,
} = await import(pathToFileURL(bundleFile).href)

const jiefangCellGraph = JSON.parse(gunzipSync(readFileSync('public/world/roads/-1_0.json.gz')).toString('utf8'))

function makeSeededRng(seedStart = 2026) {
  let seed = seedStart
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
}

function makeStraightCorridorGraph() {
  return {
    nodes: [
      {id: 1, x: 0, y: 151.7, z: 0},
      {id: 2, x: 120, y: 151.7, z: 0},
      {id: 3, x: 240, y: 151.7, z: 0},
    ],
    lanes: [
      {id: 10, from: 1, to: 2, offset: 0, width: 3.5, kind: 'motor', speedKmh: 45, cls: 'primary', street: 'BridgeMain'},
      {id: 11, from: 2, to: 3, offset: 0, width: 3.5, kind: 'motor', speedKmh: 45, cls: 'primary', street: 'BridgeMain'},
      {id: 20, from: 1, to: 2, offset: 5.0, width: 2.2, kind: 'nonmotor', speedKmh: 26, cls: 'cycleway', street: 'BridgeBike'},
      {id: 21, from: 1, to: 2, offset: 7.2, width: 2.2, kind: 'nonmotor', speedKmh: 26, cls: 'cycleway', street: 'BridgeBike'},
      {id: 22, from: 2, to: 3, offset: 5.0, width: 2.2, kind: 'nonmotor', speedKmh: 26, cls: 'cycleway', street: 'BridgeBike'},
      {id: 23, from: 2, to: 3, offset: 7.2, width: 2.2, kind: 'nonmotor', speedKmh: 26, cls: 'cycleway', street: 'BridgeBike'},
    ],
    walks: [],
    signals: [],
  }
}

test('non-solo mode (global city traffic OFF): dutyTraffic spawns >= 8 vehicles and >= 2 violators in Jiefang 240m zone within 30s and tears down cleanly on stop', async () => {
  // Confirm non-solo ('tour') mode has main-city traffic disabled
  assert.equal(trafficEnabled('tour', null), false, 'non-solo tour mode disables main-city traffic')

  const duty = createDutyTraffic({
    graph: jiefangCellGraph,
    random: makeSeededRng(777),
  })

  try {
    await duty.start()
    assert.equal(duty.isActive(), true)
    assert.equal(isDutyTrafficActive(), true)
    assert.ok(duty.getTraffic(), 'getTraffic() must expose live duty Traffic instance')
    assert.equal(getActiveDutyTraffic(), duty.getTraffic())

    const playerOnBridge = {x: -264.7, y: 151.7, z: 26.5}
    // Step 30 seconds of simulated duty time (600 ticks @ 0.05s)
    for (let i = 0; i < 600; i++) {
      duty.step(0.05, playerOnBridge, {officerActive: true})
    }

    const actorsInZone = duty.getActors().filter(a => {
      if (a.leaving || a.kind === 'person') return false
      const d = Math.hypot(a.x - JIEFANG_DUTY_CENTER.x, a.z - JIEFANG_DUTY_CENTER.z)
      return d <= JIEFANG_DUTY_RADIUS_M
    })
    const carsInZone = actorsInZone.filter(a => a.kind === 'car')
    const scootersInZone = actorsInZone.filter(a => a.kind === 'scooter')
    const violatorsInZone = scootersInZone.filter(a => a.violation && a.violation !== 'none')

    assert.ok(actorsInZone.length >= 8, `expected >= 8 vehicles inside Jiefang 240m zone within 30s, got ${actorsInZone.length}`)
    assert.ok(carsInZone.length >= 2, `expected motor cars on Jiefang Bridge, got ${carsInZone.length}`)
    assert.ok(scootersInZone.length >= 4, `expected two-wheelers on Jiefang Bridge, got ${scootersInZone.length}`)
    assert.ok(violatorsInZone.length >= 1 && violatorsInZone.length <= 2, `expected 1..2 restrained violators inside Jiefang zone within 30s, got ${violatorsInZone.length}`)
    assert.ok(violatorsInZone.length / actorsInZone.length <= 0.15, `expected violator share <= 15%, got ${(violatorsInZone.length / actorsInZone.length * 100).toFixed(1)}%`)
    assert.equal(
      violatorsInZone.filter(a => a.violation === 'red_light_run').length,
      0,
      'Jiefang bridge duty must not spawn red_light_run on signal-free bridge deck',
    )

    const stats = duty.getStats()
    assert.equal(stats.active, true)
    assert.ok(stats.total >= 8)
    assert.ok(stats.violators >= 1 && stats.violators <= 2)
  } finally {
    duty.stop()
  }

  assert.equal(duty.isActive(), false)
  assert.equal(isDutyTrafficActive(), false)
  assert.equal(duty.getTraffic(), undefined)
  assert.equal(duty.getActors().length, 0)
  assert.equal(getDutyTrafficExclusionZone(), null)
})

test('duty-mode automatic deceleration: approaching vehicle slows down near auxiliary police officer', () => {
  const graph = makeStraightCorridorGraph()
  const simOffDuty = new Traffic(graph, makeSeededRng(11), 10, {classes: ['primary'], carMin: 0, carMax: 0, personMin: 0, personMax: 0})
  const simOnDuty = new Traffic(graph, makeSeededRng(11), 10, {classes: ['primary'], carMin: 0, carMax: 0, personMin: 0, personMax: 0})

  const trackA = [...simOffDuty.allTracks()].find(t => t.id === 10)
  const trackB = [...simOnDuty.allTracks()].find(t => t.id === 10)
  assert.ok(trackA && trackB)

  const mkCar = track => ({
    track, dist: 12, speed: 10.5, kind: 'car', down: 0, dodge: 0,
    x: 12, y: 151.7, z: 0, yaw: track.yaw, scale: 1, leaving: false,
    halfWidth: 0.9, halfLength: 2.1, height: 1.5,
  })
  const carA = mkCar(trackA)
  const carB = mkCar(trackB)
  simOffDuty.actors.push(carA)
  simOnDuty.actors.push(carB)

  // Officer stands on side apron 2.4m off motor lane centerline at x=30
  simOnDuty.setDutyOfficer({pos: {x: 30, y: 151.7, z: 2.4}, active: true})

  let sawBraking = false
  for (let i = 0; i < 30; i++) {
    simOffDuty.step(0.05, {x: 30, y: 151.7, z: 0})
    simOnDuty.step(0.05, {x: 30, y: 151.7, z: 0})
    if (carB.brakingForOfficer) sawBraking = true
  }

  assert.equal(sawBraking, true, 'car approaching on-duty auxiliary police must flag brakingForOfficer')
  assert.ok(
    carB.speed < carA.speed * 0.75,
    `expected duty-mode car (${carB.speed.toFixed(2)} m/s) to decelerate clearly below off-duty car (${carA.speed.toFixed(2)} m/s)`,
  )
})

test('motor-lane collision: player stepping into active carriageway triggers onPlayerHit(severity, dir) with unit direction and post-hit brake', async () => {
  const graph = makeStraightCorridorGraph()
  const hits = []
  const duty = createDutyTraffic({
    graph,
    center: {x: 60, z: 0},
    radiusM: 200,
    desiredCars: 0,
    desiredScooters: 0,
    random: makeSeededRng(22),
  })
  const unsub = duty.onPlayerHit((severity, dir, ev) => {
    hits.push({severity, severityScore: ev.severityScore, dir, speed: ev.speed, actorKind: ev.actor.kind})
  })

  try {
    await duty.start()
    const sim = duty.getTraffic()
    assert.ok(sim)
    sim.actors.length = 0
    const motorTrack = [...sim.allTracks()].find(t => t.id === 10)
    assert.ok(motorTrack)

    // Car moving at 9.5 m/s, 4.2m behind player standing directly on motor lane centerline
    const fastCar = {
      track: motorTrack, dist: 35.8, speed: 9.5, kind: 'car', down: 0, dodge: 0,
      x: 35.8, y: 151.7, z: 0, yaw: motorTrack.yaw, scale: 1, leaving: false,
      halfWidth: 0.9, halfLength: 2.1, height: 1.5,
    }
    sim.actors.push(fastCar)

    const playerInMotorLane = {x: 40, y: 151.7, z: 0.1}
    for (let i = 0; i < 30; i++) {
      duty.step(0.05, playerInMotorLane, {officerActive: true})
    }

    assert.equal(hits.length, 1, 'collision should emit exactly 1 onPlayerHit event (debounced by cooldown)')
    assert.ok(['light', 'medium', 'heavy'].includes(hits[0].severity), `unexpected severity: ${hits[0].severity}`)
    assert.ok(hits[0].severityScore >= 0.25 && hits[0].severityScore <= 1, 'severityScore must lie in [0.25, 1] for knockdown.ts')
    assert.ok(Math.abs(Math.hypot(hits[0].dir.x, hits[0].dir.z) - 1) < 1e-4, 'impact direction dir must be normalized')
    assert.ok(hits[0].dir.x > 0.9, `expected +X impact push direction, got (${hits[0].dir.x}, ${hits[0].dir.z})`)
    assert.equal(hits[0].actorKind, 'car')
    assert.ok(fastCar.stoppedUntil > sim.time, 'hitting vehicle should emergency-stop briefly after impact')
  } finally {
    unsub()
    duty.stop()
  }
})

test('violator spots auxiliary police within 8~15m and accelerates to flee/evade; whistle/flag commandHalt stops violators probabilistically', () => {
  const graph = makeStraightCorridorGraph()
  const sim = new Traffic(graph, makeSeededRng(33), 20, {classes: ['primary'], carMin: 0, carMax: 0, personMin: 0, personMax: 0})
  const laneInner = [...sim.allTracks()].find(t => t.id === 20)
  const laneOuter = [...sim.allTracks()].find(t => t.id === 21)
  assert.ok(laneInner && laneOuter)

  // Violator starts 12m away from auxiliary police officer standing near laneInner (offset 5.0)
  const violator = {
    track: laneInner, dist: 18, speed: 6.0, kind: 'scooter', down: 0, dodge: 0,
    x: 18, y: 151.7, z: 5.0, yaw: laneInner.yaw, scale: 1, leaving: false,
    halfWidth: 0.3, halfLength: 0.85, height: 1.5,
    violation: 'no_helmet', vehicleSubtype: 'ebike', cited: false, dutyState: 'normal',
  }
  sim.actors.push(violator)

  const officerPos = {x: 30, y: 151.7, z: 4.4}
  sim.setDutyOfficer({pos: officerPos, active: true})

  let peakSpeed = 0
  let evaded = false
  for (let i = 0; i < 25; i++) {
    sim.step(0.05, officerPos)
    peakSpeed = Math.max(peakSpeed, violator.speed)
    if (violator.dutyState === 'fleeing' || violator.dutyState === 'evading') evaded = true
  }

  assert.equal(evaded, true, 'violator within 8~15m of auxiliary police must enter fleeing/evading state')
  assert.ok(peakSpeed > 7.4, `fleeing violator must accelerate above normal scooter speed (7 m/s), peaked at ${peakSpeed.toFixed(2)} m/s`)
  assert.equal(violator.track.id, 21, 'when adjacent nonmotor lane is free, violator changes lane away from officer')

  // Whistle/flag halt: probability=0 -> keeps fleeing; probability=1 -> pulls over and stops
  const ignoreRes = sim.commandHalt({x: violator.x, y: violator.y, z: violator.z}, {kind: 'flag', rangeM: 18, haltProbability: 0})
  assert.equal(ignoreRes.halted.length, 0)
  assert.equal(ignoreRes.fled.length, 1)
  assert.equal(violator.dutyState, 'fleeing')

  const haltRes = sim.commandHalt({x: violator.x, y: violator.y, z: violator.z}, {kind: 'whistle', rangeM: 18, haltProbability: 1, stopDurationSec: 10})
  assert.equal(haltRes.halted.length, 1)
  assert.equal(violator.dutyState, 'halted')
  assert.equal(violator.haltedByDuty, true)
  assert.equal(violator.speed, 0)
  assert.ok(violator.stoppedUntil > sim.time + 8)

  // Probabilistic check across 20 violators
  sim.actors.length = 0
  for (let i = 0; i < 20; i++) {
    sim.actors.push({
      track: laneInner, dist: 25 + i * 0.4, speed: 6, kind: 'scooter', down: 0, dodge: 0,
      x: 25 + i * 0.4, y: 151.7, z: 5.0, yaw: laneInner.yaw, scale: 1, leaving: false,
      halfWidth: 0.3, halfLength: 0.85, height: 1.5,
      violation: 'illegal_mod', vehicleSubtype: 'ebike', cited: false, dutyState: 'normal',
    })
  }
  const mixRes = sim.commandHalt({x: 30, y: 151.7, z: 5.0}, {kind: 'whistle', rangeM: 20, haltProbability: 0.65, random: makeSeededRng(505)})
  assert.equal(mixRes.affected, 20)
  assert.ok(mixRes.halted.length > 0 && mixRes.fled.length > 0, `expected probabilistic split, got halted=${mixRes.halted.length}, fled=${mixRes.fled.length}`)
})

test('bridge deck bounds (jiefang-railings single source), solo-mode exclusion zone, and independent traffic-signals-overlay clock without global traffic', () => {
  // Bridge deck bounds keep interaction cleanly on Jiefang Bridge (excluding under-bridge road & distant city)
  assert.equal(isOnJiefangBridgeDeck({x: -264.7, y: 151.7, z: 26.5}), true, 'west bridgehead officer post is on bridge')
  assert.equal(isOnJiefangBridgeDeck({x: -168, y: 151.3, z: 40}), true, 'mid-bridge deck is on bridge')
  assert.equal(isOnJiefangBridgeDeck({x: -60, y: 152.5, z: 76}), true, 'east bridgehead is on bridge')
  assert.equal(isOnJiefangBridgeDeck({x: -296, y: 146.5, z: 32}), false, 'under-bridge riverfront road is excluded')
  assert.equal(isOnJiefangBridgeDeck({x: -879.75, y: 151.3, z: -169.63}), false, 'Shizijie is outside Jiefang Bridge')

  // Independent traffic-signals-overlay ticks through full cycle even with NO global city Traffic instance
  const scene = new THREE.Scene()
  const overlay = mountShizijieSignalsOverlay(scene, {getTraffic: () => undefined})
  try {
    const phasesSeen = new Set()
    for (let i = 0; i < 200; i++) {
      const res = overlay.update({x: SHIZIJIE_ORIGIN.x + 10, z: SHIZIJIE_ORIGIN.z - 10}, 0.25)
      assert.equal(res.visible, true)
      phasesSeen.add(`${res.ew}:${res.ns}`)
    }
    assert.equal(overlay.isIndependentClockActive(), true)
    assert.ok(phasesSeen.has('green:red') && phasesSeen.has('yellow:red') && phasesSeen.has('red:green') && phasesSeen.has('red:yellow'))
    overlay.setEnabled(false)
    const disabledRes = overlay.update({x: SHIZIJIE_ORIGIN.x, z: SHIZIJIE_ORIGIN.z}, 0.1)
    assert.equal(disabledRes.visible, false)
  } finally {
    overlay.dispose()
  }

  // Global Traffic respects external exclusion zone so solo mode never double-spawns on Jiefang Bridge
  const globalSim = new Traffic(jiefangCellGraph, makeSeededRng(88))
  globalSim.setExternalExclusion({center: JIEFANG_DUTY_CENTER, radius: JIEFANG_DUTY_RADIUS_M})
  for (let i = 0; i < 40; i++) {
    globalSim.step(0.05, {x: JIEFANG_DUTY_CENTER.x, y: 151.7, z: JIEFANG_DUTY_CENTER.z})
  }
  const leakedInside = globalSim.actors.filter(
    a => Math.hypot(a.x - JIEFANG_DUTY_CENTER.x, a.z - JIEFANG_DUTY_CENTER.z) <= JIEFANG_DUTY_RADIUS_M,
  )
  assert.equal(leakedInside.length, 0, 'global Traffic must not duplicate actors inside active duty exclusion zone')
})

test('start() idempotency: repeated start() calls (in-flight and post-start x5) return same Promise and preserve Traffic instance & actor count', async () => {
  let loadCalls = 0
  let releaseGraph
  const graphGate = new Promise(resolve => {
    releaseGraph = resolve
  })

  const duty = createDutyTraffic({
    loadGraph: async () => {
      loadCalls++
      await graphGate
      return jiefangCellGraph
    },
    random: makeSeededRng(909),
  })

  try {
    // Concurrent in-flight start() calls must coalesce onto the exact same Promise
    const pA = duty.start()
    const pB = duty.start()
    const pC = duty.start()
    assert.strictEqual(pA, pB, 'concurrent in-flight start() must return the exact same Promise')
    assert.strictEqual(pA, pC, 'third concurrent in-flight start() must return the exact same Promise')
    releaseGraph()
    await Promise.all([pA, pB, pC])
    assert.equal(loadCalls, 1, 'loadGraph must be called exactly once across concurrent start() calls')

    const playerOnBridge = {x: -264.7, y: 151.7, z: 26.5}
    for (let i = 0; i < 200; i++) {
      duty.step(0.05, playerOnBridge, {officerActive: true})
    }

    const simBefore = duty.getTraffic()
    const countBefore = duty.getActors().length
    assert.ok(simBefore, 'Traffic instance must exist after start()')
    assert.ok(countBefore >= 8, `expected >= 8 vehicles before repeated start(), got ${countBefore}`)

    // Repeated start() 5 consecutive times while already running must NOT stop/rebuild traffic
    for (let i = 0; i < 5; i++) {
      const pAgain = duty.start()
      assert.strictEqual(pAgain, pA, `repeated start() #${i + 1} must return the exact same Promise`)
      await pAgain
      assert.strictEqual(duty.getTraffic(), simBefore, `Traffic instance must not change on repeated start() #${i + 1}`)
      assert.equal(duty.getActors().length, countBefore, `actor count must not drop or reset on repeated start() #${i + 1}`)
    }
    assert.equal(loadCalls, 1)

    // Only stop() tears down traffic; a subsequent start() creates a new Promise & Traffic instance
    duty.stop()
    assert.equal(duty.isActive(), false)
    assert.equal(duty.getTraffic(), undefined)
    assert.equal(duty.getActors().length, 0)

    const pRestart = duty.start()
    assert.notStrictEqual(pRestart, pA, 'start() after stop() must create a fresh Promise')
    await pRestart
    assert.ok(duty.getTraffic() && duty.getTraffic() !== simBefore)

    // dispose() also cleanly tears down traffic & actors
    duty.dispose()
    assert.equal(duty.isActive(), false)
    assert.equal(duty.getTraffic(), undefined)
    assert.equal(duty.getActors().length, 0)
  } finally {
    duty.stop()
  }
})

test('Jiefang bridge-deck-only spawn filter: 0 off-deck violators (under-bridge Binjiang Rd excluded) and >= 8 on-deck vehicles within 30s', async () => {
  const duty = createDutyTraffic({
    graph: jiefangCellGraph,
    random: makeSeededRng(2027),
  })

  try {
    await duty.start()
    const playerOnBridge = {x: -264.7, y: 151.7, z: 26.5}

    let peakUnderBridgeViolators = 0
    let peakUnderBridgeVehicles = 0
    let maxOnDeckVehicles = 0
    let maxOnDeckViolators = 0

    // Step full 30 seconds (600 ticks @ 0.05s) and inspect every tick
    for (let i = 0; i < 600; i++) {
      duty.step(0.05, playerOnBridge, {officerActive: true})
      const activeVehicles = duty.getActors().filter(a => !a.leaving && !a.pendingRecycle && a.kind !== 'person')
      const onDeck = activeVehicles.filter(a => isOnJiefangBridgeDeck(a))
      const offCorridor = activeVehicles.filter(a => !isOnJiefangApproachCorridor(a))
      const onDeckViolators = onDeck.filter(a => a.kind === 'scooter' && a.violation && a.violation !== 'none')
      const offCorridorViolators = offCorridor.filter(a => a.kind === 'scooter' && a.violation && a.violation !== 'none')

      if (onDeck.length > maxOnDeckVehicles) maxOnDeckVehicles = onDeck.length
      if (onDeckViolators.length > maxOnDeckViolators) maxOnDeckViolators = onDeckViolators.length
      if (offCorridor.length > peakUnderBridgeVehicles) peakUnderBridgeVehicles = offCorridor.length
      if (offCorridorViolators.length > peakUnderBridgeViolators) peakUnderBridgeViolators = offCorridorViolators.length
    }

    const finalActive = duty.getActors().filter(a => !a.leaving && !a.pendingRecycle && a.kind !== 'person')
    const finalOnDeck = finalActive.filter(a => isOnJiefangBridgeDeck(a))
    const finalOffCorridorViolators = finalActive.filter(
      a => !isOnJiefangApproachCorridor(a) && a.kind === 'scooter' && a.violation && a.violation !== 'none',
    )

    assert.equal(peakUnderBridgeViolators, 0, `expected 0 under-bridge/off-corridor violators across 30s, got peak ${peakUnderBridgeViolators}`)
    assert.equal(finalOffCorridorViolators.length, 0, 'final snapshot must have 0 under-bridge/off-corridor violators')
    assert.equal(peakUnderBridgeVehicles, 0, `expected 0 under-bridge/off-corridor vehicles across 30s, got peak ${peakUnderBridgeVehicles}`)
    assert.ok(finalOnDeck.length >= 8, `expected >= 8 on-deck vehicles at 30s, got ${finalOnDeck.length}`)
    assert.ok(maxOnDeckVehicles >= 8, `expected peak >= 8 on-deck vehicles within 30s, got ${maxOnDeckVehicles}`)
    assert.ok(maxOnDeckViolators >= 1 && maxOnDeckViolators <= 2, `expected 1..2 on-deck violators within 30s, got ${maxOnDeckViolators}`)
  } finally {
    duty.stop()
  }
})

test('height-aware bridge deck filter rejects under-bridge lanes directly below deck XZ and blocks under-bridge sampleGround dips', async () => {
  // Construct synthetic under-bridge lanes 100% INSIDE Jiefang Bridge XZ bounds but at low riverfront Y=146.5m,
  // plus a bridge-height lane with an intermediate profile dip to Y=146.5m between quarter samples.
  const [ax, az] = jiefangBridgeLocalToWorld(-50, 14)
  const [bx, bz] = jiefangBridgeLocalToWorld(50, 14)
  const [mx0, mz0] = jiefangBridgeLocalToWorld(-40, 6)
  const [mx1, mz1] = jiefangBridgeLocalToWorld(40, 6)
  const syntheticUnderBridgeIds = new Set([990001, 990002, 990003])
  const augmentedGraph = {
    ...jiefangCellGraph,
    nodes: [
      ...jiefangCellGraph.nodes,
      {id: 990101, x: ax, y: 146.5, z: az},
      {id: 990102, x: bx, y: 146.5, z: bz},
      {id: 990103, x: mx0, y: 146.5, z: mz0},
      {id: 990104, x: mx1, y: 146.5, z: mz1},
      {id: 990105, x: ax, y: 151.8, z: az},
      {id: 990106, x: bx, y: 151.8, z: bz},
    ],
    lanes: [
      ...jiefangCellGraph.lanes,
      {id: 990001, from: 990101, to: 990102, offset: 0, width: 2.2, kind: 'nonmotor', speedKmh: 25, cls: 'cycleway', street: 'UnderBridgeBinjiang'},
      {id: 990002, from: 990103, to: 990104, offset: 0, width: 3.5, kind: 'motor', speedKmh: 40, cls: 'primary', street: 'UnderBridgeMotor'},
      {
        id: 990003,
        from: 990105,
        to: 990106,
        offset: 0,
        width: 2.2,
        kind: 'nonmotor',
        speedKmh: 25,
        cls: 'cycleway',
        street: 'DippedProfileLane',
        heights: [0, 151.8, 0.12, 146.5, 1, 151.8],
      },
    ],
  }

  const slicedDeckOnly = sliceDutySubgraph(augmentedGraph, JIEFANG_DUTY_CENTER, JIEFANG_DUTY_RADIUS_M, true)
  const leakedSynthetic = slicedDeckOnly.lanes.filter(l => syntheticUnderBridgeIds.has(l.id))
  assert.equal(leakedSynthetic.length, 0, 'height filter must exclude under-bridge & mid-span-dipped lanes inside bridge XZ')
  assert.ok(slicedDeckOnly.lanes.length >= 20, `expected real elevated Jiefang Bridge lanes kept, got ${slicedDeckOnly.lanes.length}`)

  // Even if sampleGround erroneously raycasts to under-bridge road Y=146.5m, deckSafeSampleGround keeps all actors elevated
  const duty = createDutyTraffic({
    graph: augmentedGraph,
    sampleGround: () => 146.5,
    random: makeSeededRng(3031),
  })
  try {
    await duty.start()
    const playerOnBridge = {x: -264.7, y: 151.7, z: 26.5}
    let peakUnderBridge = 0
    let peakUnderBridgeViolators = 0
    for (let i = 0; i < 600; i++) {
      duty.step(0.05, playerOnBridge, {officerActive: true})
      for (const a of duty.getActors()) {
        if (a.leaving || a.pendingRecycle || a.kind === 'person') continue
        if (!isOnJiefangApproachCorridor(a)) {
          peakUnderBridge++
          if (a.kind === 'scooter' && a.violation && a.violation !== 'none') peakUnderBridgeViolators++
        }
      }
    }
    const finalOnDeck = duty.getActors().filter(a => !a.leaving && !a.pendingRecycle && a.kind !== 'person' && isOnJiefangBridgeDeck(a))
    const finalViolators = duty.getActors().filter(a => !a.leaving && !a.pendingRecycle && a.kind === 'scooter' && !a.cited && a.violation && a.violation !== 'none')
    assert.equal(peakUnderBridge, 0, 'hostile under-bridge sampleGround must never pull vehicles below deck/approach elevation')
    assert.equal(peakUnderBridgeViolators, 0, 'hostile under-bridge sampleGround must produce 0 under-bridge violators')
    assert.ok(finalOnDeck.length >= 8, `expected >= 8 on-deck vehicles, got ${finalOnDeck.length}`)
    assert.ok(finalViolators.length >= 1 && finalViolators.length <= 2, `expected 1..2 violators, got ${finalViolators.length}`)
  } finally {
    duty.stop()
  }
})

test('k36: 60s bridge cross-section & violator throttle: 0 two-wheelers on sidewalk, cars only on motor lanes, violator share <= 15%, concurrent <= 2, >= 20s respawn cooldown after cite', async () => {
  const duty = createDutyTraffic({
    graph: jiefangCellGraph,
    random: makeSeededRng(2028),
  })
  const xs = getJiefangCrossSection()

  try {
    await duty.start()
    const [ox, oz] = jiefangBridgeLocalToWorld(-97.5, 18.0)
    const officerOnSidewalk = {x: ox, y: jiefangDeckWorldY(ox, oz), z: oz}

    let peakSidewalkTwoWheelers = 0
    let peakNonMotorCars = 0
    let peakViolators = 0
    let peakViolatorShare = 0
    let peakVehicles = 0
    let citedAtTime = -1
    let earlyViolatorSpawnedAfterCite = false

    // Step full 60 seconds (1200 ticks @ 0.05s)
    for (let i = 0; i < 1200; i++) {
      duty.step(0.05, officerOnSidewalk, {officerActive: true})
      const sim = duty.getTraffic()
      const active = duty.getActors().filter(a => !a.leaving && a.kind !== 'person')
      let sidewalkTwoWheelers = 0
      let nonMotorCars = 0
      let violators = 0

      for (const a of active) {
        const onDeck = isOnJiefangBridgeDeck(a)
        const zone = classifyJiefangCrossSectionZone(a)
        const [, lz] = worldToJiefangBridgeLocal(a.x, a.z)
        if (a.kind === 'scooter') {
          if (zone === 'sidewalk' || lz <= xs.northSidewalk.maxZ || lz >= xs.southSidewalk.minZ) {
            sidewalkTwoWheelers++
          }
          if (onDeck) {
            assert.equal(zone, 'nonmotor', `on-deck two-wheeler must stay strictly inside black asphalt nonmotor lane, got zone=${zone} lz=${lz.toFixed(2)}`)
          }
          if (!a.cited && a.violation && a.violation !== 'none') violators++
        } else if (a.kind === 'car') {
          if (onDeck && zone !== 'motor') nonMotorCars++
        }
      }

      if (sidewalkTwoWheelers > peakSidewalkTwoWheelers) peakSidewalkTwoWheelers = sidewalkTwoWheelers
      if (nonMotorCars > peakNonMotorCars) peakNonMotorCars = nonMotorCars
      if (violators > peakViolators) peakViolators = violators
      if (active.length > peakVehicles) peakVehicles = active.length
      if (active.length > 0) {
        const share = violators / active.length
        if (share > peakViolatorShare) peakViolatorShare = share
      }

      // Catch/cite the first active violator once traffic is steady, then verify >= 20s respawn cooldown
      if (citedAtTime < 0 && i >= 200 && violators > 0) {
        const target = active.find(a => a.kind === 'scooter' && !a.cited && a.violation && a.violation !== 'none')
        if (target) {
          duty.notifyViolatorCited(target)
          citedAtTime = sim.time
        }
      } else if (citedAtTime >= 0 && sim.time - citedAtTime < 19.95) {
        for (const a of active) {
          if (a.kind === 'scooter' && !a.cited && a.violation && a.violation !== 'none' && !a._seenBeforeCite) {
            earlyViolatorSpawnedAfterCite = true
          }
        }
      }

      if (citedAtTime < 0) {
        for (const a of active) {
          if (a.kind === 'scooter' && a.violation && a.violation !== 'none') a._seenBeforeCite = true
        }
      }
    }

    assert.equal(peakSidewalkTwoWheelers, 0, `expected 0 two-wheelers on sidewalk across 60s, got ${peakSidewalkTwoWheelers}`)
    assert.equal(peakNonMotorCars, 0, `expected 0 cars outside motor carriageway across 60s, got ${peakNonMotorCars}`)
    assert.ok(peakVehicles >= 10, `expected >= 10 active bridge vehicles, got ${peakVehicles}`)
    assert.ok(peakViolators <= 2, `expected <= 2 concurrent violators, got ${peakViolators}`)
    assert.ok(peakViolatorShare <= 0.15 + 1e-9, `expected violator share <= 15%, got ${(peakViolatorShare * 100).toFixed(2)}%`)
    assert.ok(citedAtTime > 0, 'test must exercise citing a real violator to verify 20s respawn cooldown')
    assert.equal(earlyViolatorSpawnedAfterCite, false, 'no new violator may spawn within 20s after citing one')
  } finally {
    duty.stop()
  }
})

test('k37: 0 hits standing 60s on sidewalk or nonmotor lane; on motor lane car honks first then decelerates and hits at <= 25 km/h', async () => {
  // Part A: Standing 60s on Jiefang sidewalk AND 60s on Jiefang nonmotor lane -> 0 hits
  const [swX, swZ] = jiefangBridgeLocalToWorld(-40, 18.0)
  const sidewalkPos = {x: swX, y: jiefangDeckWorldY(swX, swZ), z: swZ}
  const [nmX, nmZ] = jiefangBridgeLocalToWorld(-40, 14.05)
  const nonmotorPos = {x: nmX, y: jiefangDeckWorldY(nmX, nmZ), z: nmZ}

  assert.equal(classifyJiefangCrossSectionZone(sidewalkPos), 'sidewalk')
  assert.equal(classifyJiefangCrossSectionZone(nonmotorPos), 'nonmotor')

  for (const [label, pos] of [['sidewalk', sidewalkPos], ['nonmotor', nonmotorPos]]) {
    const hits = []
    const duty = createDutyTraffic({
      graph: jiefangCellGraph,
      random: makeSeededRng(label === 'sidewalk' ? 3031 : 3032),
      onPlayerHit: (_sev, _dir, ev) => hits.push(ev),
    })
    try {
      await duty.start()
      for (let i = 0; i < 1200; i++) {
        duty.step(0.05, pos, {officerActive: true})
      }
      assert.equal(hits.length, 0, `standing 60s on ${label} must incur 0 hits, got ${hits.length}`)
    } finally {
      duty.stop()
    }
  }

  // Part B: Calm walking on motor lane -> car honks & brakes to full stop (0 hits)
  {
    const graph = makeStraightCorridorGraph()
    const hits = []
    const horns = []
    const duty = createDutyTraffic({
      graph,
      center: {x: 60, z: 0},
      radiusM: 200,
      desiredCars: 0,
      desiredScooters: 0,
      random: makeSeededRng(3033),
      onPlayerHit: (_sev, _dir, ev) => hits.push(ev),
      onPlayerHorn: ev => horns.push(ev),
    })
    try {
      await duty.start()
      const sim = duty.getTraffic()
      sim.actors.length = 0
      const motorTrack = [...sim.allTracks()].find(t => t.id === 10)
      const car = {
        track: motorTrack, dist: 15, speed: 11.5, kind: 'car', down: 0, dodge: 0,
        x: 15, y: 151.7, z: 0, yaw: motorTrack.yaw, scale: 1, leaving: false,
        halfWidth: 0.9, halfLength: 2.1, height: 1.5,
      }
      sim.actors.push(car)
      for (let i = 0; i < 120; i++) {
        duty.step(0.05, {x: 42, y: 151.7, z: 0}, {officerActive: true, officerRunning: false})
      }
      assert.ok(horns.length >= 1, 'car approaching calm walking player on motor lane must honk')
      assert.equal(hits.length, 0, 'calm walking player on motor lane must not be hit when car has braking distance')
      assert.ok(car.speed < 0.2, `car must brake to full stop for walking player, remaining speed=${car.speed.toFixed(2)}`)
    } finally {
      duty.stop()
    }
  }

  // Part C: Player on motor lane ignoring horn / running -> honks FIRST, then decelerates, impact speed <= 25 km/h
  {
    const graph = makeStraightCorridorGraph()
    const hits = []
    const horns = []
    const duty = createDutyTraffic({
      graph,
      center: {x: 60, z: 0},
      radiusM: 200,
      desiredCars: 0,
      desiredScooters: 0,
      random: makeSeededRng(3034),
      onPlayerHit: (_sev, _dir, ev) => hits.push({time: duty.getTraffic().time, ...ev}),
      onPlayerHorn: ev => horns.push({...ev}),
    })
    try {
      await duty.start()
      const sim = duty.getTraffic()
      sim.actors.length = 0
      const motorTrack = [...sim.allTracks()].find(t => t.id === 10)
      const initialSpeed = 11.5 // 41.4 km/h
      const car = {
        track: motorTrack, dist: 16, speed: initialSpeed, kind: 'car', down: 0, dodge: 0,
        x: 16, y: 151.7, z: 0, yaw: motorTrack.yaw, scale: 1, leaving: false,
        halfWidth: 0.9, halfLength: 2.1, height: 1.5,
      }
      sim.actors.push(car)

      let firstBrakeTime = null
      for (let i = 0; i < 160; i++) {
        duty.step(0.05, {x: 44, y: 151.7, z: 0}, {officerActive: true, officerRunning: true})
        if (firstBrakeTime === null && car.brakingForOfficer) firstBrakeTime = sim.time
      }

      assert.ok(horns.length >= 1, 'car approaching player on motor lane must honk first')
      assert.ok(firstBrakeTime !== null, 'car must actively decelerate before impact')
      assert.equal(hits.length, 1, `expected 1 impact when player ignores horn in motor lane, got ${hits.length}`)
      assert.ok(horns[0].time < firstBrakeTime, `horn (${horns[0].time.toFixed(2)}s) must happen strictly before brake start (${firstBrakeTime.toFixed(2)}s)`)
      assert.ok(firstBrakeTime < hits[0].time, `deceleration (${firstBrakeTime.toFixed(2)}s) must occur before hit (${hits[0].time.toFixed(2)}s)`)
      assert.equal(hits[0].honkedBeforeHit, true, 'hit event must confirm horn sounded before impact')
      assert.equal(hits[0].severity, 'light', `duty motor-lane hit must be gentle 'light' bump, got ${hits[0].severity}`)
      assert.ok(hits[0].severityScore >= 0.25 && hits[0].severityScore <= 0.45, `gentle hit severityScore must be in [0.25, 0.45], got ${hits[0].severityScore}`)
      assert.ok(hits[0].speed < initialSpeed, `car must decelerate below initial ${initialSpeed} m/s, got ${hits[0].speed.toFixed(2)} m/s`)
      assert.ok(hits[0].speedKmh <= 25, `impact speed must be <= 25 km/h, got ${hits[0].speedKmh.toFixed(2)} km/h`)
      const stats = duty.getStats()
      assert.ok(stats.warningHorns >= 1, `expected stats.warningHorns >= 1, got ${stats.warningHorns}`)
      assert.equal(stats.lastHitSeverity, 'light')
      assert.ok(stats.lastHitSpeedKmh !== null && stats.lastHitSpeedKmh <= 25)
    } finally {
      duty.stop()
    }
  }
})

test('k35/k36/k37 multi-seed stress & extreme evasion clamp: 0 sidewalk/motor two-wheelers, 0 nonmotor cars, <=15% & <=2 violators, >=20s cooldown via actor.cited=true', async () => {
  const seeds = [101, 404, 2029, 8888, 9999]
  for (const seed of seeds) {
    const duty = createDutyTraffic({
      graph: jiefangCellGraph,
      random: makeSeededRng(seed),
    })
    try {
      await duty.start()
      const [ox, oz] = jiefangBridgeLocalToWorld(-20, -14.065)
      const officerOnNorthNonmotor = {x: ox, y: jiefangDeckWorldY(ox, oz), z: oz}
      const hits = []
      const unsub = duty.onPlayerHit((_s, _d, ev) => hits.push(ev))

      let citedAt = -1
      let spawnedDuringCooldown = false
      const seenBeforeCite = new Set()

      for (let i = 0; i < 900; i++) {
        // Periodically issue whistle halts/flee commands to stress lateral dodge + wrong-way offset clamping
        if (i === 180 || i === 360) {
          duty.commandHalt(officerOnNorthNonmotor, {kind: 'whistle', rangeM: 30, haltProbability: 0, random: () => 0.99})
        }
        duty.step(0.05, officerOnNorthNonmotor, {officerActive: true})
        const sim = duty.getTraffic()
        const active = duty.getActors().filter(a => !a.leaving && a.kind !== 'person')
        let violators = 0
        for (const a of active) {
          const onDeck = isOnJiefangBridgeDeck(a)
          const [, lz] = worldToJiefangBridgeLocal(a.x, a.z)
          if (a.kind === 'scooter') {
            const band = lz >= 0 ? JIEFANG_CROSS_SECTION.southNonmotor : JIEFANG_CROSS_SECTION.northNonmotor
            assert.ok(
              lz >= band.safeMinZ - 1e-3 && lz <= band.safeMaxZ + 1e-3,
              `seed=${seed} scooter escaped black nonmotor safe band [${band.safeMinZ}, ${band.safeMaxZ}]: lz=${lz.toFixed(3)}`,
            )
            if (onDeck) assert.equal(classifyJiefangCrossSectionZone(a), 'nonmotor')
            if (!a.cited && a.violation && a.violation !== 'none') violators++
          } else if (a.kind === 'car') {
            if (onDeck) assert.equal(classifyJiefangCrossSectionZone(a), 'motor', `seed=${seed} car left motor lane: lz=${lz.toFixed(3)}`)
          }
        }
        assert.ok(violators <= 2, `seed=${seed} tick=${i}: concurrent violators ${violators} > 2`)
        if (active.length > 0) {
          assert.ok(
            violators / active.length <= 0.15 + 1e-9,
            `seed=${seed} tick=${i}: violator share ${(violators / active.length * 100).toFixed(2)}% > 15% (${violators}/${active.length})`,
          )
        }
        // Test controller.ts natural citation path (direct actor.cited = true without explicit notifyViolatorCited call)
        if (citedAt < 0 && i >= 220 && violators > 0) {
          const v = active.find(a => a.kind === 'scooter' && !a.cited && a.violation && a.violation !== 'none')
          if (v) {
            for (const x of active) {
              if (x.kind === 'scooter' && x.violation && x.violation !== 'none') seenBeforeCite.add(x)
            }
            v.cited = true
            citedAt = sim.time
          }
        } else if (citedAt >= 0 && sim.time - citedAt < 19.95) {
          for (const a of active) {
            if (a.kind === 'scooter' && !a.cited && a.violation && a.violation !== 'none' && !seenBeforeCite.has(a)) {
              spawnedDuringCooldown = true
            }
          }
        }
      }

      unsub()
      assert.equal(hits.length, 0, `seed=${seed}: standing on north nonmotor lane must incur 0 hits`)
      assert.ok(citedAt > 0, `seed=${seed}: expected at least 1 violator to cite within 45s`)
      assert.equal(spawnedDuringCooldown, false, `seed=${seed}: direct actor.cited=true must enforce >= 20s respawn cooldown`)
      const stats = duty.getStats()
      assert.equal(stats.sidewalkTwoWheelers, 0)
      assert.equal(stats.nonmotorLaneCars, 0)
      assert.ok(stats.violatorRatio <= 0.15 + 1e-9)
    } finally {
      duty.stop()
    }
  }
})

test('k36/k37 post-cooldown respawn (>=20s resumes) and fleeing scooter yields to officer on nonmotor lane without hit', async () => {
  const duty = createDutyTraffic({
    graph: jiefangCellGraph,
    random: makeSeededRng(4242),
  })
  const hits = []
  const unsub = duty.onPlayerHit((_s, _d, ev) => hits.push(ev))
  try {
    await duty.start()
    const [ox, oz] = jiefangBridgeLocalToWorld(-30, 14.065)
    const officerOnSouthNm = {x: ox, y: jiefangDeckWorldY(ox, oz), z: oz}

    // Warm up until at least one uncited violator exists
    let firstViolator = null
    for (let i = 0; i < 400 && !firstViolator; i++) {
      duty.step(0.05, officerOnSouthNm, {officerActive: true})
      firstViolator = duty.getActors().find(a => !a.leaving && a.kind === 'scooter' && !a.cited && a.violation && a.violation !== 'none') ?? null
    }
    assert.ok(firstViolator, 'expected initial violator on Jiefang Bridge')

    // Cite ALL currently active uncited violators so active uncited violators drop to 0
    const sim = duty.getTraffic()
    for (const a of duty.getActors()) {
      if (!a.leaving && a.kind === 'scooter' && !a.cited && a.violation && a.violation !== 'none') {
        a.cited = true
      }
    }
    // Step 1 tick to latch cooldown, then verify 0 new uncited violators for 19.8s
    duty.step(0.05, officerOnSouthNm, {officerActive: true})
    const citeTime = sim.time
    assert.ok(duty.getStats().violatorCooldownRemainingSec >= 19.5, 'cooldown must latch >= 20s after citing')

    let earlyNew = 0
    for (let i = 0; i < 395; i++) {
      duty.step(0.05, officerOnSouthNm, {officerActive: true})
      const uncited = duty.getActors().filter(a => !a.leaving && a.kind === 'scooter' && !a.cited && a.violation && a.violation !== 'none')
      if (sim.time - citeTime < 19.9 && uncited.length > 0) earlyNew++
    }
    assert.equal(earlyNew, 0, 'must spawn 0 new violators during 20s cooldown')

    // Step another 45s after cooldown expires -> replacement violator should respawn cleanly within caps
    let respawnedAfterCooldown = false
    for (let i = 0; i < 900; i++) {
      duty.step(0.05, officerOnSouthNm, {officerActive: true})
      const st = duty.getStats()
      assert.ok(st.violators <= 2 && st.violatorRatio <= 0.15 + 1e-9)
      if (st.violators >= 1) respawnedAfterCooldown = true
    }
    assert.equal(respawnedAfterCooldown, true, 'after >= 20s cooldown expires, a new violator must be able to respawn')
    assert.equal(hits.length, 0, 'standing on south nonmotor lane across full cycle must incur 0 hits')
  } finally {
    unsub()
    duty.stop()
  }
})

test('k56-1: flag pull-over (E) turns on blinker, decelerates to ±15.2m outer nonmotor curb with speed=0, looks at officer, and emits onViolatorPulledOver', async () => {
  const pulledEvents = []
  const duty = createDutyTraffic({
    graph: jiefangCellGraph,
    desiredCars: 0,
    desiredScooters: 0,
    random: makeSeededRng(5601),
    onViolatorPulledOver: ev => pulledEvents.push(ev),
  })

  try {
    await duty.start()
    const sim = duty.getTraffic()
    sim.actors.length = 0

    const nonmotorTracks = [...sim.allTracks()].filter(t => t.kind === 'nonmotor' && !t.walk)
    const southTrack = nonmotorTracks.find(t => {
      const [, lz] = worldToJiefangBridgeLocal((t.start.x + t.end.x) * 0.5, (t.start.z + t.end.z) * 0.5)
      return lz > 12 && t.length > 15
    })
    const northTrack = nonmotorTracks.find(t => {
      const [, lz] = worldToJiefangBridgeLocal((t.start.x + t.end.x) * 0.5, (t.start.z + t.end.z) * 0.5)
      return lz < -12 && t.length > 15
    })
    assert.ok(southTrack && northTrack, 'both south and north Jiefang nonmotor tracks must exist')

    const makeViolator = (id, track) => {
      const dist = track.length * 0.25
      const x = track.start.x + track.dx * dist
      const z = track.start.z + track.dz * dist
      const y = jiefangDeckWorldY(x, z)
      return {
        id,
        track,
        dist,
        speed: 6.2,
        kind: 'scooter',
        down: 0,
        dodge: 0,
        x,
        y,
        z,
        yaw: track.yaw,
        scale: 1,
        leaving: false,
        halfWidth: 0.3,
        halfLength: 0.85,
        height: 1.5,
        violation: 'no_helmet',
        vehicleSubtype: 'ebike',
        cited: false,
        dutyState: 'normal',
      }
    }

    const vSouth = makeViolator('viol_south_1', southTrack)
    const vNorth = makeViolator('viol_north_1', northTrack)
    sim.actors.push(vSouth, vNorth)

    const resS = duty.commandHalt({x: vSouth.x, y: vSouth.y, z: vSouth.z}, {kind: 'flag', rangeM: 10})
    const resN = duty.commandHalt({x: vNorth.x, y: vNorth.y, z: vNorth.z}, {kind: 'flag', rangeM: 10})
    assert.equal(resS.halted.length, 1)
    assert.equal(resN.halted.length, 1)
    assert.equal(vSouth.dutyState, 'pulling_over')
    assert.equal(vSouth.blinker, 'right')
    assert.equal(vNorth.dutyState, 'pulling_over')
    assert.equal(vNorth.blinker, 'right')

    for (let i = 0; i < 60; i++) {
      duty.step(0.05, {x: vSouth.x, y: vSouth.y, z: vSouth.z + 2.0}, {officerActive: true})
    }

    for (const [label, actor, expectedSign] of [['south', vSouth, 1], ['north', vNorth, -1]]) {
      const [, lz] = worldToJiefangBridgeLocal(actor.x, actor.z)
      assert.equal(actor.dutyState, 'pulled_over', `${label} violator must reach pulled_over state`)
      assert.equal(actor.speed, 0, `${label} violator speed must be 0 after pull-over`)
      assert.equal(actor.lookAtOfficer, true, `${label} violator must turn head toward officer while stopped`)
      assert.equal(actor.blinker, 'right', `${label} violator blinker stays on while pulled over`)
      assert.ok(
        Math.abs(lz - expectedSign * JIEFANG_PULLOVER_OUTER_ABS_Z) <= 0.12,
        `${label} violator must stop at outer nonmotor edge ${expectedSign * JIEFANG_PULLOVER_OUTER_ABS_Z}m, got lz=${lz.toFixed(3)}m`,
      )
      assert.equal(
        classifyJiefangCrossSectionZone(actor),
        'nonmotor',
        `${label} pulled-over violator must stay on black asphalt nonmotor lane, never sidewalk`,
      )
    }

    assert.equal(pulledEvents.length, 2, `onViolatorPulledOver must fire once per pulled-over violator, got ${pulledEvents.length}`)
    assert.ok(pulledEvents.some(e => e.actorId === 'viol_south_1' && e.side === 'south'))
    assert.ok(pulledEvents.some(e => e.actorId === 'viol_north_1' && e.side === 'north'))
  } finally {
    duty.stop()
  }
})

test('k56-2: getActorHandBone(actorId, "right") returns valid node; receiveTicket attaches ticket until actor cleanup, emits onTicketReceived, rides slowly for 3s then resumes normal speed', async () => {
  const receivedEvents = []
  const duty = createDutyTraffic({
    graph: jiefangCellGraph,
    desiredCars: 0,
    desiredScooters: 0,
    random: makeSeededRng(5602),
    onTicketReceived: ev => receivedEvents.push(ev),
  })

  try {
    await duty.start()
    const sim = duty.getTraffic()
    sim.actors.length = 0

    const southTrack = [...sim.allTracks()].find(t => {
      if (t.kind !== 'nonmotor' || t.walk || t.length < 30) return false
      const [, lz] = worldToJiefangBridgeLocal((t.start.x + t.end.x) * 0.5, (t.start.z + t.end.z) * 0.5)
      return lz > 12
    })
    assert.ok(southTrack)

    const x0 = southTrack.start.x + southTrack.dx * 4
    const z0 = southTrack.start.z + southTrack.dz * 4
    const violator = {
      id: 'viol_handover_1',
      track: southTrack,
      dist: 4,
      speed: 5.5,
      kind: 'scooter',
      down: 0,
      dodge: 0,
      x: x0,
      y: jiefangDeckWorldY(x0, z0),
      z: z0,
      yaw: southTrack.yaw,
      scale: 1,
      leaving: false,
      halfWidth: 0.3,
      halfLength: 0.85,
      height: 1.5,
      violation: 'ebike_overload',
      vehicleSubtype: 'ebike',
      cited: false,
      dutyState: 'normal',
    }
    sim.actors.push(violator)

    duty.commandHalt({x: violator.x, y: violator.y, z: violator.z}, {kind: 'flag', rangeM: 10})
    for (let i = 0; i < 60; i++) duty.step(0.05, {x: violator.x, y: violator.y, z: violator.z + 2.5}, {officerActive: true})
    assert.equal(violator.dutyState, 'pulled_over')
    assert.equal(violator.speed, 0)

    const handBone = duty.getActorHandBone('viol_handover_1', 'right')
    const handBoneGlobal = getActorHandBone('viol_handover_1', 'right')
    assert.ok(handBone instanceof THREE.Object3D, 'getActorHandBone must return a valid THREE.Object3D')
    assert.strictEqual(handBone, handBoneGlobal, 'global getActorHandBone must resolve the same hand node')

    const slipMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.12), new THREE.MeshBasicMaterial({color: 0xffffff}))
    slipMesh.name = 'carbon_handover_ticket'
    const res = receiveDutyTicket('viol_handover_1', {ticketId: 'TKT-5602', ticketObject: slipMesh})
    assert.equal(res.ok, true)
    assert.strictEqual(slipMesh.parent, handBone, 'ticket must be attached to violator right hand bone')
    assert.equal(receivedEvents.length, 1, 'onTicketReceived must fire once')
    assert.equal(receivedEvents[0].actorId, 'viol_handover_1')
    assert.equal(violator.cited, true)
    assert.equal(violator.holdingReceipt, true)
    assert.equal(violator.ticketReceiveAnimActive, true, 'reach-out receive animation must activate immediately')

    const dup = duty.receiveTicket('viol_handover_1', {ticketId: 'TKT-DUP'})
    assert.equal(dup.ok, false)
    assert.equal(dup.reason, 'already_cited')

    const farOfficer = {x: violator.x, y: violator.y, z: violator.z + 18}
    for (let i = 0; i < 30; i++) duty.step(0.05, farOfficer, {officerActive: true})
    assert.ok(violator.speed > 0.5 && violator.speed <= 2.35, `during first 3s after ticket, speed must be slow departure (<=2.35 m/s), got ${violator.speed.toFixed(2)}`)
    assert.strictEqual(slipMesh.parent, handBone, 'ticket must remain held on right hand while leaving slowly')

    for (let i = 0; i < 60; i++) duty.step(0.05, farOfficer, {officerActive: true})
    assert.ok(violator.speed >= 4.0, `after 3s slow departure, violator must resume normal cruising speed (>=4.0 m/s), got ${violator.speed.toFixed(2)}`)
    assert.strictEqual(slipMesh.parent, handBone, 'ticket must stay attached on right hand until vehicle is cleaned up')

    sim.actors.length = 0
    duty.step(0.05, farOfficer, {officerActive: true})
    assert.equal(slipMesh.parent, null, 'ticket must detach once vehicle is cleaned up')
    assert.equal(duty.getActorHandBone('viol_handover_1', 'right'), null, 'getActorHandBone must return null after actor cleanup')
  } finally {
    duty.stop()
  }
})

test('k56-3: whistle surrender probability for fleeing violators is 40% ± 5%, surrendered violators pull over to curb, and non-violators are unaffected', () => {
  const graph = makeStraightCorridorGraph()
  const rng = makeSeededRng(5603)
  const sim = new Traffic(graph, rng, 20, {classes: ['primary'], carMin: 0, carMax: 0, personMin: 0, personMax: 0})
  const laneInner = [...sim.allTracks()].find(t => t.id === 20)
  assert.ok(laneInner)

  const lawAbiding = {
    id: 'clean_1',
    track: laneInner,
    dist: 20,
    speed: 6.0,
    kind: 'scooter',
    down: 0,
    dodge: 0,
    x: 20,
    y: 151.7,
    z: 5.0,
    yaw: laneInner.yaw,
    scale: 1,
    leaving: false,
    halfWidth: 0.3,
    halfLength: 0.85,
    height: 1.5,
    violation: 'none',
    vehicleSubtype: 'ebike',
    cited: false,
    dutyState: 'normal',
  }
  sim.actors.push(lawAbiding)
  const cleanRes = sim.commandHalt({x: 24, y: 151.7, z: 5.0}, {kind: 'whistle', rangeM: 12, random: rng})
  assert.equal(cleanRes.affected, 0)
  assert.equal(lawAbiding.dutyState, 'normal')
  assert.equal(lawAbiding.whistleSlowUntil, undefined)

  const TRIALS = 2000
  let surrendered = 0
  for (let i = 0; i < TRIALS; i++) {
    sim.actors.length = 0
    const fleeingViolator = {
      id: `flee_${i}`,
      track: laneInner,
      dist: 20,
      speed: 8.5,
      kind: 'scooter',
      down: 0,
      dodge: 0,
      x: 20,
      y: 151.7,
      z: 5.0,
      yaw: laneInner.yaw,
      scale: 1,
      leaving: false,
      halfWidth: 0.3,
      halfLength: 0.85,
      height: 1.5,
      violation: 'no_helmet',
      vehicleSubtype: 'ebike',
      cited: false,
      dutyState: 'fleeing',
      fleeUntil: sim.time + 6,
    }
    sim.actors.push(fleeingViolator)
    const res = sim.commandHalt({x: 24, y: 151.7, z: 5.0}, {kind: 'whistle', rangeM: 12, random: rng})
    if (res.halted.length === 1) {
      surrendered++
      assert.equal(fleeingViolator.dutyState, 'pulling_over', 'surrendered fleeing violator must begin pulling over')
      assert.equal(fleeingViolator.blinker, 'right', 'surrendered violator must turn on right blinker')
    } else {
      assert.equal(res.fled.length, 1)
      assert.equal(fleeingViolator.dutyState, 'fleeing')
    }
  }
  const rate = surrendered / TRIALS
  assert.ok(
    rate >= 0.35 && rate <= 0.45,
    `expected whistle surrender rate in 40% ± 5% [0.35, 0.45], got ${(rate * 100).toFixed(2)}% (${surrendered}/${TRIALS})`,
  )
})

test('k56-4: bridge onTicketReceived succeeds once when ledger already set actor.cited=true, clears wall-clock holdUntil on release/ticket, and blocks duplicate handover', async () => {
  const receivedEvents = []
  const duty = createDutyTraffic({
    graph: jiefangCellGraph,
    desiredCars: 0,
    desiredScooters: 0,
    random: makeSeededRng(5604),
    onTicketReceived: ev => receivedEvents.push(ev),
  })

  try {
    await duty.start()
    const sim = duty.getTraffic()
    sim.actors.length = 0

    const southTrack = [...sim.allTracks()].find(t => {
      if (t.kind !== 'nonmotor' || t.walk || t.length < 30) return false
      const [, lz] = worldToJiefangBridgeLocal((t.start.x + t.end.x) * 0.5, (t.start.z + t.end.z) * 0.5)
      return lz > 12
    })
    assert.ok(southTrack)

    const x0 = southTrack.start.x + southTrack.dx * 4
    const z0 = southTrack.start.z + southTrack.dz * 4
    const violator = {
      id: 'viol_bridge_handshake',
      track: southTrack,
      dist: 4,
      speed: 5.5,
      kind: 'scooter',
      down: 0,
      dodge: 0,
      x: x0,
      y: jiefangDeckWorldY(x0, z0),
      z: z0,
      yaw: southTrack.yaw,
      scale: 1,
      leaving: false,
      halfWidth: 0.3,
      halfLength: 0.85,
      height: 1.5,
      violation: 'no_helmet',
      vehicleSubtype: 'ebike',
      cited: false,
      dutyState: 'normal',
    }
    sim.actors.push(violator)

    // Standalone stopActor without Traffic ref sets wall-clock holdUntil; releaseViolator must clear it
    stopActor(violator, 45)
    assert.ok((violator.holdUntil ?? 0) > performance.now())
    assert.equal(duty.releaseViolator(violator), true)
    assert.equal(violator.holdUntil, undefined)

    // Pull over via bridge overload, then simulate ledger.record() marking actor.cited = true before onTicketReceived bridge call
    assert.equal(duty.onViolatorPulledOver(violator, 45), true)
    for (let i = 0; i < 60; i++) duty.step(0.05, {x: violator.x, y: violator.y, z: violator.z + 2.5}, {officerActive: true})
    assert.equal(violator.dutyState, 'pulled_over')
    assert.equal(violator.speed, 0)

    const handBone = duty.getActorHandBone(violator, 'right')
    assert.ok(handBone instanceof THREE.Object3D)
    const slipMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.12), new THREE.MeshBasicMaterial({color: 0xffffff}))
    slipMesh.name = 'duty-receipt-slip'
    violator.cited = true
    violator.holdUntil = performance.now() + 30000

    duty.onTicketReceived(violator, {ticketId: 'JLQ-5604', fineYuan: 5, violation: 'no_helmet', ticketObject: slipMesh})
    assert.equal(receivedEvents.length, 1, 'onTicketReceived bridge must fire once even after ledger set actor.cited=true')
    assert.equal(violator.ticketReceived, true)
    assert.equal(violator.ticketReceiveAnimActive, true)
    assert.equal(violator.holdUntil, undefined, 'receiveTicket must clear wall-clock holdUntil so slow departure proceeds')
    assert.strictEqual(slipMesh.parent, handBone)

    // Second bridge invocation on same violator must be strictly ignored
    duty.onTicketReceived(violator, {ticketId: 'JLQ-5604-DUP'})
    assert.equal(receivedEvents.length, 1, 'duplicate onTicketReceived bridge call must not fire twice')

    const farOfficer = {x: violator.x, y: violator.y, z: violator.z + 20}
    for (let i = 0; i < 30; i++) duty.step(0.05, farOfficer, {officerActive: true})
    assert.ok(violator.speed > 0.5 && violator.speed <= 2.35, `expected slow departure speed in (0.5, 2.35], got ${violator.speed.toFixed(2)}`)
    for (let i = 0; i < 60; i++) duty.step(0.05, farOfficer, {officerActive: true})
    assert.ok(violator.speed >= 4.0, `expected resumed normal speed >= 4.0, got ${violator.speed.toFixed(2)}`)
  } finally {
    duty.stop()
  }
})

test('k62-1: 600s simulation keeps ALL spawn & recycle points >= 60m beyond bridge ends, >= 90m from player, 0 in-frustum within 120m, continuous bridge flow, and stacked ebike_overload+no_helmet', async () => {
  const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 600)
  const frustum = new THREE.Frustum()
  const proj = new THREE.Matrix4()
  const pt = new THREE.Vector3()

  const events = []
  const spawnedViolators = []
  const duty = createDutyTraffic({
    graph: jiefangCellGraph,
    random: makeSeededRng(6201),
    onActorSpawn: ev => {
      events.push(ev)
      if (ev.kind === 'scooter' && ev.actor.violation && ev.actor.violation !== 'none') {
        spawnedViolators.push({
          id: ev.actorId,
          violation: ev.actor.violation,
          violations: [...(ev.actor.violations ?? [])],
        })
      }
    },
    onActorDespawn: ev => {
      events.push(ev)
    },
  })

  try {
    await duty.start()

    // Check every pre-roll spawn too: must be >= 60m beyond bridge ends (>= 124.5m from every bridge point!)
    for (const ev of events) {
      assert.ok(
        ev.bridgeEndDistM >= JIEFANG_APPROACH_MIN_DIST_M - 1e-6,
        `pre-roll ${ev.type} too close to bridge end: ${ev.bridgeEndDistM.toFixed(2)}m < 60m`,
      )
    }

    // Patrol player across Jiefang Bridge (west officer post, mid-span, east bridgehead) while panning camera down both approaches
    const patrolSpots = [
      {lx: -97.5, lz: 17.5, lookLx: -260, lookLz: 10}, // west officer post staring straight down West approach
      {lx: -135, lz: 16.5, lookLx: -280, lookLz: 0},   // near West bridge edge staring straight West
      {lx: 0, lz: 17.0, lookLx: 240, lookLz: 0},       // mid-bridge looking East
      {lx: 130, lz: -17.0, lookLx: 280, lookLz: -10},  // near East bridge edge staring straight East
    ]

    let runtimeSpawns = 0
    let runtimeDespawns = 0
    let onDeckSamples = 0
    let onDeckSum = 0
    let minOnDeckAfterWarm = Infinity
    let maxViolatorShare = 0
    let maxConcurrentViolators = 0
    const startEventCount = events.length

    // 600s = 12,000 ticks @ 0.05s
    for (let tick = 0; tick < 12000; tick++) {
      const phaseIdx = Math.floor(tick / 3000) % patrolSpots.length
      const spot = patrolSpots[phaseIdx]
      const [px, pz] = jiefangBridgeLocalToWorld(spot.lx, spot.lz)
      const py = jiefangDeckWorldY(px, pz)
      const playerPos = {x: px, y: py, z: pz}
      const [tx, tz] = jiefangBridgeLocalToWorld(spot.lookLx, spot.lookLz)
      camera.position.set(px, py + 1.65, pz)
      camera.lookAt(tx, py + 1.2, tz)
      camera.updateMatrixWorld()
      proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      frustum.setFromProjectionMatrix(proj)
      const visible = p => frustum.containsPoint(pt.set(p.x, p.y + 0.7, p.z))

      const beforeLen = events.length
      duty.step(0.05, playerPos, {officerActive: true, cameraPos: playerPos, visible})

      // Audit every spawn/despawn emitted on this tick
      for (let k = beforeLen; k < events.length; k++) {
        const ev = events[k]
        if (ev.type === 'spawn') runtimeSpawns++
        else runtimeDespawns++
        const endDist = jiefangBridgeEndDistanceM(ev.pos)
        const pDist = Math.hypot(ev.pos.x - playerPos.x, ev.pos.z - playerPos.z)
        const inF = visible(ev.pos)
        assert.ok(
          endDist >= JIEFANG_APPROACH_MIN_DIST_M - 1e-6,
          `tick=${tick} ${ev.type} at bridgeEndDist=${endDist.toFixed(2)}m < 60m`,
        )
        assert.ok(
          pDist >= JIEFANG_HIDDEN_PLAYER_MIN_DIST_M - 1e-6,
          `tick=${tick} ${ev.type} at playerDist=${pDist.toFixed(2)}m < 90m`,
        )
        assert.equal(
          inF && pDist <= JIEFANG_HIDDEN_FRUSTUM_MAX_DIST_M,
          false,
          `tick=${tick} ${ev.type} occurred inside camera frustum within 120m (dist=${pDist.toFixed(2)}m)`,
        )
      }

      if (tick % 20 === 0) {
        const live = duty.getActors().filter(a => !a.leaving && !a.pendingRecycle && a.kind !== 'person')
        const onDeck = live.filter(a => isOnJiefangBridgeDeck(a))
        const uncitedViolators = live.filter(a => a.kind === 'scooter' && !a.cited && a.violation && a.violation !== 'none')
        onDeckSamples++
        onDeckSum += onDeck.length
        if (tick >= 200 && onDeck.length < minOnDeckAfterWarm) minOnDeckAfterWarm = onDeck.length
        if (uncitedViolators.length > maxConcurrentViolators) maxConcurrentViolators = uncitedViolators.length
        if (live.length > 0) {
          const share = uncitedViolators.length / live.length
          if (share > maxViolatorShare) maxViolatorShare = share
        }
        // Periodically cite a passing violator on deck so traffic turns over many violator samples over 600s
        if (tick > 0 && tick % 600 === 0 && uncitedViolators.length > 0) {
          duty.notifyViolatorCited(uncitedViolators[0])
        }
      }
    }

    const avgOnDeck = onDeckSum / Math.max(1, onDeckSamples)
    const lstats = duty.getLifecycleStats()
    assert.ok(runtimeSpawns >= 60, `expected continuous bridge turnover (>=60 runtime spawns in 600s), got ${runtimeSpawns}`)
    assert.ok(runtimeDespawns >= 60, `expected continuous bridge turnover (>=60 runtime despawns in 600s), got ${runtimeDespawns}`)
    assert.ok(events.length > startEventCount, 'runtime lifecycle events must be recorded')
    assert.ok(lstats.minSpawnBridgeEndDistM !== null && lstats.minSpawnBridgeEndDistM >= 60, `minSpawnBridgeEndDistM=${lstats.minSpawnBridgeEndDistM} < 60`)
    assert.ok(lstats.minDespawnBridgeEndDistM !== null && lstats.minDespawnBridgeEndDistM >= 60, `minDespawnBridgeEndDistM=${lstats.minDespawnBridgeEndDistM} < 60`)
    assert.ok(lstats.minSpawnPlayerDistM !== null && lstats.minSpawnPlayerDistM >= 90, `minSpawnPlayerDistM=${lstats.minSpawnPlayerDistM} < 90`)
    assert.ok(lstats.minDespawnPlayerDistM !== null && lstats.minDespawnPlayerDistM >= 90, `minDespawnPlayerDistM=${lstats.minDespawnPlayerDistM} < 90`)
    assert.equal(lstats.frustumViolations120m, 0, `expected 0 in-frustum spawns/despawns within 120m, got ${lstats.frustumViolations120m}`)
    assert.ok(avgOnDeck >= 8, `expected continuous average >= 8 on-deck vehicles over 600s, got ${avgOnDeck.toFixed(1)}`)
    assert.ok(minOnDeckAfterWarm >= 4, `expected bridge never empty over 600s, got minOnDeck=${minOnDeckAfterWarm}`)
    assert.ok(maxConcurrentViolators <= 2, `violator cap must stay <= 2, got ${maxConcurrentViolators}`)
    assert.ok(maxViolatorShare <= 0.15 + 1e-9, `violator share must stay <= 15%, got ${(maxViolatorShare * 100).toFixed(2)}%`)

    // Multi-violation check: among overloaded e-bikes spawned in 600s, at least a subset has ['ebike_overload', 'no_helmet']
    const overloads = spawnedViolators.filter(v => v.violation === 'ebike_overload')
    const stackedOverloads = overloads.filter(
      v => v.violations.length === 2 && v.violations[0] === 'ebike_overload' && v.violations[1] === 'no_helmet',
    )
    assert.ok(overloads.length >= 2, `expected >= 2 ebike_overload violators over 600s, got ${overloads.length}`)
    assert.ok(
      stackedOverloads.length >= 1,
      `expected at least 1 stacked ['ebike_overload', 'no_helmet'] violator among ${overloads.length} overloads, got ${stackedOverloads.length}`,
    )
  } finally {
    duty.stop()
  }
})

test('k62-2: frustum deferral blocks all spawns & recycles inside 120m frustum when player stands at bridge edge staring down approach', async () => {
  const duty = createDutyTraffic({
    graph: jiefangCellGraph,
    random: makeSeededRng(6202),
  })
  const badEvents = []
  try {
    await duty.start()
    // Player stands right at West bridge edge (lx=-140m); hostile visible() reports EVERY point within 120m as inside frustum!
    const [px, pz] = jiefangBridgeLocalToWorld(-140.0, 14.0)
    const playerPos = {x: px, y: jiefangDeckWorldY(px, pz), z: pz}
    const alwaysInFrustum = () => true

    const unsubA = duty.onActorSpawn(ev => {
      if (ev.bridgeEndDistM < 60 || (ev.playerDistM ?? 0) < 90 || (ev.inFrustum && (ev.cameraDistM ?? 0) <= 120)) {
        badEvents.push(ev)
      }
    })
    const unsubB = duty.onActorDespawn(ev => {
      if (ev.bridgeEndDistM < 60 || (ev.playerDistM ?? 0) < 90 || (ev.inFrustum && (ev.cameraDistM ?? 0) <= 120)) {
        badEvents.push(ev)
      }
    })
    try {
      for (let i = 0; i < 2400; i++) {
        duty.step(0.05, playerPos, {officerActive: true, cameraPos: playerPos, visible: alwaysInFrustum})
      }
    } finally {
      unsubA()
      unsubB()
    }

    const lstats = duty.getLifecycleStats()
    assert.equal(badEvents.length, 0, `expected 0 forbidden spawns/despawns under always-in-frustum stress, got ${badEvents.length}`)
    assert.equal(lstats.frustumViolations120m, 0)
    assert.ok(lstats.deferredSpawns >= 1, `expected frustum gate to defer near-frustum spawn attempts, got deferredSpawns=${lstats.deferredSpawns}`)
    assert.ok(lstats.despawns >= 10, `departing vehicles must still cleanly recycle once past 120m, got ${lstats.despawns}`)
  } finally {
    duty.stop()
  }
})

test('k62-3: multi-violation actor.violations[] compatibility, visual no-helmet model distinction on ebike_overload, and left/right hand ticket attachment', async () => {
  // 1) Visual model distinction: ebike_overload + no_helmet uses bare-head geometry; ebike_overload alone uses helmeted geometry
  const models = trafficModels([])
  const stackedActor = {
    kind: 'scooter', x: 0, y: 0, z: 0, yaw: 0, speed: 5, scale: 1, leaving: false,
    vehicleSubtype: 'ebike', violation: 'ebike_overload', violations: ['ebike_overload', 'no_helmet'],
  }
  const singleOverloadActor = {
    kind: 'scooter', x: 0, y: 0, z: 0, yaw: 0, speed: 5, scale: 1, leaving: false,
    vehicleSubtype: 'ebike', violation: 'ebike_overload', violations: ['ebike_overload'],
  }
  const specStacked = resolveTwoWheelSpec(stackedActor)
  const specSingle = resolveTwoWheelSpec(singleOverloadActor)
  assert.deepEqual(specStacked.violations, ['ebike_overload', 'no_helmet'])
  assert.equal(specStacked.noHelmet, true)
  assert.deepEqual(specSingle.violations, ['ebike_overload'])
  assert.equal(specSingle.noHelmet, false)
  assert.deepEqual(getActorViolations(stackedActor), ['ebike_overload', 'no_helmet'])
  assert.deepEqual(getActorViolations({violation: 'none'}), [])

  const varStacked = models.twoWheelVariant('ebike', 'ebike_overload', 0.4, 0.4, specStacked.noHelmet)
  const varSingle = models.twoWheelVariant('ebike', 'ebike_overload', 0.4, 0.4, specSingle.noHelmet)
  assert.notEqual(
    varStacked.full.geometry,
    varSingle.full.geometry,
    'ebike_overload + no_helmet must render distinct no-helmet 3D geometry vs helmeted ebike_overload',
  )
  for (const g of models.geometries) g.dispose()

  // 2) Left-hand & right-hand ticket handover support (r8-3 nearest-hand prep)
  const duty = createDutyTraffic({
    graph: jiefangCellGraph,
    desiredCars: 0,
    desiredScooters: 0,
    random: makeSeededRng(6203),
  })
  try {
    await duty.start()
    const sim = duty.getTraffic()
    sim.actors.length = 0
    const southTrack = [...sim.allTracks()].find(t => t.kind === 'nonmotor' && !t.walk && t.length > 20)
    assert.ok(southTrack)
    const viol = {
      id: 'viol_left_hand_1',
      track: southTrack,
      dist: 5,
      speed: 0,
      kind: 'scooter',
      down: 0,
      dodge: 0,
      x: southTrack.start.x,
      y: southTrack.start.y,
      z: southTrack.start.z,
      yaw: southTrack.yaw,
      scale: 1,
      leaving: false,
      halfWidth: 0.3,
      halfLength: 0.85,
      height: 1.5,
      violation: 'ebike_overload',
      violations: ['ebike_overload', 'no_helmet'],
      vehicleSubtype: 'ebike',
      cited: false,
      dutyState: 'pulled_over',
    }
    sim.actors.push(viol)

    const leftBone = duty.getActorHandBone('viol_left_hand_1', 'left')
    const rightBone = duty.getActorHandBone('viol_left_hand_1', 'right')
    assert.ok(leftBone instanceof THREE.Object3D && rightBone instanceof THREE.Object3D)
    assert.notStrictEqual(leftBone, rightBone)

    const slip = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.12), new THREE.MeshBasicMaterial({color: 0xffffff}))
    const res = duty.receiveTicket('viol_left_hand_1', {ticketId: 'TKT-LEFT', handSide: 'left', ticketObject: slip})
    assert.equal(res.ok, true)
    assert.strictEqual(slip.parent, leftBone, 'left-hand delivery must attach ticket to left hand bone')
    assert.equal(viol.heldTicketHandSide, 'left')
  } finally {
    duty.stop()
  }
})
