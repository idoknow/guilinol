import assert from 'node:assert/strict'
import {readFileSync, rmSync} from 'node:fs'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test, {after} from 'node:test'
import {pathToFileURL} from 'node:url'
import {gunzipSync} from 'node:zlib'
import {build} from 'esbuild'

// Bundle TypeScript modules into an isolated temp dir so bare `node --test web/src/traffic-duty/*.test.mjs`
// resolves extensionless bundler imports cleanly without requiring extra loader flags.
const bundleDir = await mkdtemp(join(tmpdir(), 'glol-traffic-duty-test-'))
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
      export {MAIN_DETAIL_LAYER} from './web/src/look/mirror-layer.ts'
      export {isPointInQuietZone} from './web/src/game/quiet-zones.ts'
      export {getState, _resetGameStateForTest} from './web/src/game/state.ts'
      export {getLatestTraffic, stopActor, Traffic} from './web/src/traffic/sim.ts'
      export {trafficModels, resolveTwoWheelSpec} from './web/src/traffic/models.ts'
      export {
        DESKTOP_MAX_SKELETONS,
        MOBILE_MAX_SKELETONS,
        DESKTOP_RIDER_LIMIT,
        MOBILE_RIDER_LIMIT,
        riderSkeletonCost,
        selectWithinSkeletonBudget,
      } from './web/src/traffic/rider-pool.ts'
      export {createTrafficDutyController} from './web/src/traffic-duty/controller.ts'
      export {isCitableViolator, mergeTrafficDutyDecision, resolveTrafficDutyCandidate} from './web/src/traffic-duty/arbiter.ts'
      export {
        createLocalLeaderboardProvider,
        loadLocalLeaderboard,
        setLeaderboardStorageForTest,
        TRAFFIC_DUTY_LEADERBOARD_CORRUPT_KEY,
        TRAFFIC_DUTY_LEADERBOARD_KEY,
      } from './web/src/traffic-duty/leaderboard.ts'
      export {
        ACTIVE_VIOLATIONS,
        DEFAULT_FINE_YUAN,
        DUTY_ZONES,
        formatDutyReportTitle,
        JIEFANG_DUTY_ZONE,
        resolveDutyZone,
        SHIZIJIE_DUTY_ZONE,
        TRAFFIC_DUTY_DURATION_SEC,
        VIOLATION_LABELS,
      } from './web/src/traffic-duty/types.ts'
      export {
        JIEFANG_OFFICER_SPOT,
        mountAllDutyOfficers,
        mountDutyOfficer,
        SHIZIJIE_OFFICER_SPOT,
      } from './web/src/traffic-duty/npc-officer.ts'
      export {
        mountShizijieSignalsOverlay,
        resolveShizijieSignalPhase,
        SHIZIJIE_GANTRIES,
        SHIZIJIE_ORIGIN,
        SHIZIJIE_SIGNAL_NODE_ID,
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
  MAIN_DETAIL_LAYER,
  isPointInQuietZone,
  getState,
  _resetGameStateForTest,
  getLatestTraffic,
  stopActor,
  Traffic,
  trafficModels,
  resolveTwoWheelSpec,
  DESKTOP_MAX_SKELETONS,
  MOBILE_MAX_SKELETONS,
  DESKTOP_RIDER_LIMIT,
  MOBILE_RIDER_LIMIT,
  riderSkeletonCost,
  selectWithinSkeletonBudget,
  createTrafficDutyController,
  isCitableViolator,
  mergeTrafficDutyDecision,
  resolveTrafficDutyCandidate,
  createLocalLeaderboardProvider,
  loadLocalLeaderboard,
  setLeaderboardStorageForTest,
  TRAFFIC_DUTY_LEADERBOARD_CORRUPT_KEY,
  TRAFFIC_DUTY_LEADERBOARD_KEY,
  ACTIVE_VIOLATIONS,
  DEFAULT_FINE_YUAN,
  DUTY_ZONES,
  formatDutyReportTitle,
  JIEFANG_DUTY_ZONE,
  resolveDutyZone,
  SHIZIJIE_DUTY_ZONE,
  TRAFFIC_DUTY_DURATION_SEC,
  VIOLATION_LABELS,
  JIEFANG_OFFICER_SPOT,
  mountAllDutyOfficers,
  SHIZIJIE_OFFICER_SPOT,
  mountShizijieSignalsOverlay,
  resolveShizijieSignalPhase,
  SHIZIJIE_GANTRIES,
  SHIZIJIE_ORIGIN,
  SHIZIJIE_SIGNAL_NODE_ID,
} = await import(pathToFileURL(bundleFile).href)

const cachedGraph = JSON.parse(gunzipSync(readFileSync('public/world/roads/graph.json.gz')).toString('utf8'))

function createMemStorage(opts = {}) {
  const map = new Map()
  let quotaFailCount = opts.quotaFailCount ?? 0
  return {
    map,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      if (quotaFailCount > 0) {
        quotaFailCount--
        const err = new Error('QuotaExceededError')
        err.name = 'QuotaExceededError'
        throw err
      }
      map.set(k, String(v))
    },
    removeItem: k => {
      map.delete(k)
    },
  }
}

function makeSeededRng(seedStart = 284) {
  let seed = seedStart
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
}

test('sim.ts loads 906 nonmotor lanes (incl. 17 Jiefang lanes) + synthesizes virtual fallback without duplicating Jiefang', () => {
  const sim = new Traffic(cachedGraph, makeSeededRng(101))
  const allTracks = [...sim.allTracks()]
  const realNonmotor = allTracks.filter(t => !t.walk && t.kind === 'nonmotor' && !t.virtual)
  const jiefangNonmotor = realNonmotor.filter(t => t.gradeSeparated === 'jiefang')
  const jiefangVirtual = allTracks.filter(t => !t.walk && t.kind === 'nonmotor' && t.virtual && t.gradeSeparated === 'jiefang')
  const virtualNonmotor = allTracks.filter(t => !t.walk && t.kind === 'nonmotor' && t.virtual)

  assert.equal(realNonmotor.length, 906)
  assert.equal(jiefangNonmotor.length, 17)
  assert.equal(jiefangVirtual.length, 0, 'Jiefang Bridge already has 17 real nonmotor lanes and must not duplicate virtual ones')
  assert.ok(virtualNonmotor.length > 1000, 'major motor roads lacking cycleways should get virtual right-edge nonmotor fallback')

  for (const t of realNonmotor) {
    const mx = (t.start.x + t.end.x) * 0.5
    const mz = (t.start.z + t.end.z) * 0.5
    assert.equal(isPointInQuietZone(mx, mz), false, `nonmotor lane ${t.id} should stay outside quiet zones`)
  }
})

test('sim.ts prefers real nonmotor > virtual nonmotor > motor for scooters, keeps cars off nonmotor, and deduplicates Phase 2 coverage', () => {
  const graph = {
    nodes: [
      {id: 1, x: 0, y: 0, z: 0},
      {id: 2, x: 100, y: 0, z: 0},
      {id: 3, x: 200, y: 0, z: 0},
      {id: 4, x: 0, y: 0, z: 80},
      {id: 5, x: 100, y: 0, z: 80},
      {id: 6, x: 200, y: 0, z: 80},
      {id: 10, x: 0, y: 0, z: 86},
      {id: 11, x: 100, y: 0, z: 86},
      {id: 12, x: 200, y: 0, z: 86},
    ],
    lanes: [
      {id: 100, from: 1, to: 2, offset: 1.5, width: 3, kind: 'motor', speedKmh: 40, cls: 'primary', street: 'RoadA'},
      {id: 101, from: 2, to: 3, offset: 1.5, width: 3, kind: 'motor', speedKmh: 40, cls: 'primary', street: 'RoadA'},
      {id: 200, from: 4, to: 5, offset: 1.5, width: 3, kind: 'motor', speedKmh: 40, cls: 'primary', street: 'RoadB'},
      {id: 201, from: 5, to: 6, offset: 1.5, width: 3, kind: 'motor', speedKmh: 40, cls: 'primary', street: 'RoadB'},
      {id: 300, from: 10, to: 11, offset: 0, width: 2.5, kind: 'nonmotor', speedKmh: 20, cls: 'cycleway', street: '@cycleway:10'},
      {id: 301, from: 11, to: 12, offset: 0, width: 2.5, kind: 'nonmotor', speedKmh: 20, cls: 'cycleway', street: '@cycleway:10'},
    ],
    walks: [],
    signals: [],
  }

  const sim = new Traffic(graph, makeSeededRng(42), 100, {
    classes: ['trunk', 'primary', 'secondary'],
    carMin: 2,
    carMax: 4,
    personMin: 0,
    personMax: 0,
  })

  const tracks = [...sim.allTracks()]
  const roadAVirtual = tracks.filter(t => t.street === 'RoadA' && t.kind === 'nonmotor' && t.virtual)
  const roadBVirtual = tracks.filter(t => t.street === 'RoadB' && t.kind === 'nonmotor' && t.virtual)
  assert.equal(roadAVirtual.length, 2, 'RoadA without cycleway gets 2 virtual right-edge nonmotor tracks')
  assert.equal(roadBVirtual.length, 0, 'RoadB with real nonmotor within 6m skips virtual fallback (Phase 2 seamless)')
  assert.ok(roadAVirtual[0].offset > 1.5 && roadAVirtual[0].offset <= 3.0, 'virtual track sits on right edge of RoadA')

  for (let i = 0; i < 60; i++) {
    sim.step(0.05, {x: 100, y: 0, z: 40})
  }

  const cars = sim.actors.filter(a => a.kind === 'car')
  const scooters = sim.actors.filter(a => a.kind === 'scooter')
  assert.ok(cars.length > 0 && scooters.length > 0, 'both cars and scooters spawned')
  assert.ok(cars.every(c => c.track.kind === 'motor'), 'cars never spawn or ride on nonmotor tracks')
  assert.ok(scooters.every(s => s.track.kind === 'nonmotor'), 'scooters prioritize nonmotor tracks (real or virtual)')
  assert.equal(getLatestTraffic(), sim)
})

test('sim.ts duty mode spawns weighted 6 violation types across Jiefang + Shizijie and stopActor halts then resumes', () => {
  const sim = new Traffic(cachedGraph, makeSeededRng(777))
  sim.setDutyConfig({
    active: true,
    zones: DUTY_ZONES.map(z => ({id: z.id, center: z.center, radius: z.radiusM})),
    twoWheelShare: 0.7,
  })

  const camJiefang = {x: -168, y: 152, z: 40}
  const seen = new Set()
  for (let i = 0; i < 120; i++) {
    sim.step(0.05, camJiefang)
    for (const a of sim.actors) if (a.kind === 'scooter' && a.violation) seen.add(a.violation)
  }

  const camShizijie = {x: SHIZIJIE_DUTY_ZONE.center.x, y: 151.3, z: SHIZIJIE_DUTY_ZONE.center.z}
  for (let i = 0; i < 120; i++) {
    sim.step(0.05, camShizijie)
    for (const a of sim.actors) if (a.kind === 'scooter' && a.violation) seen.add(a.violation)
  }

  for (const v of ACTIVE_VIOLATIONS) {
    assert.ok(seen.has(v), `expected violation "${v}" to spawn in dual-zone duty mode, seen: ${[...seen]}`)
  }

  const scooters = sim.actors.filter(a => a.kind === 'scooter')
  assert.ok(scooters.length >= 6, `expected >=6 scooters in Shizijie duty mode, got ${scooters.length}`)
  for (const s of scooters) {
    if (s.violation === 'bike_double') assert.equal(s.vehicleSubtype, 'bicycle')
    else if (s.violation && s.violation !== 'none') assert.equal(s.vehicleSubtype, 'ebike')
  }

  // Verify stopActor halts then resumes
  const target = scooters.find(s => s.violation !== 'none' && !s.leaving)
  assert.ok(target)
  target.speed = 5
  sim.step(0.05, camShizijie)
  assert.equal(stopActor(target, 3.0), true)
  const frozenX = target.x
  const frozenZ = target.z
  for (let i = 0; i < 40; i++) {
    sim.step(0.05, camShizijie)
    assert.equal(target.speed, 0)
    assert.equal(target.x, frozenX)
    assert.equal(target.z, frozenZ)
  }
  for (let i = 0; i < 35; i++) sim.step(0.05, camShizijie)
  assert.equal(target.stoppedUntil, undefined)
})

test('2.0 behaviors: wrong_way travels in reverse without deadlock, red_light_run crosses red signal cleanly, and illegal_mod builds ebike-mounts mesh', () => {
  // Synthetic 2-segment corridor with a signal at node 2 (permanently red at t=0..18 for lane 201)
  const graph = {
    nodes: [
      {id: 1, x: 0, y: 0, z: 0},
      {id: 2, x: 40, y: 0, z: 0},
      {id: 3, x: 80, y: 0, z: 0},
    ],
    lanes: [
      {id: 100, from: 1, to: 2, offset: 0, width: 2.5, kind: 'nonmotor', speedKmh: 22, cls: 'cycleway', street: 'S1'},
      {id: 101, from: 2, to: 3, offset: 0, width: 2.5, kind: 'nonmotor', speedKmh: 22, cls: 'cycleway', street: 'S1'},
    ],
    walks: [],
    signals: [
      {node: 2, group: 2, offset: 0, phases: [{lanes: [999], green: 18, yellow: 3}, {lanes: [100], green: 18, yellow: 3}]},
    ],
  }
  const sim = new Traffic(graph, makeSeededRng(99), 20, {
    classes: ['primary'],
    carMin: 0,
    carMax: 0,
    personMin: 0,
    personMax: 0,
  })
  const tracks = [...sim.allTracks()]
  const t1 = tracks.find(t => t.id === 100)
  const t2 = tracks.find(t => t.id === 101)
  assert.ok(t1 && t2)
  assert.equal(sim.phase(t1, 0), 'red', 'lane 100 starts on red phase')

  // 1) wrong_way actor starts on t2 near dist=4 and must ride backwards onto t1 with reverse yaw & -0.55m offset
  const wrongWayActor = {
    track: t2, dist: 4, speed: 5, kind: 'scooter', down: 0, dodge: 0,
    x: 44, y: 0, z: -0.55, yaw: Math.atan2(-t2.dx, -t2.dz), scale: 1, leaving: false,
    halfWidth: 0.3, halfLength: 0.85, height: 1.5,
    violation: 'wrong_way', vehicleSubtype: 'ebike', wrongWay: true, cited: false,
  }
  // 2) normal compliant scooter approaching red light on t1 -> MUST stop before node 2
  const normalActor = {
    track: t1, dist: 34, speed: 5, kind: 'scooter', down: 0, dodge: 0,
    x: 34, y: 0, z: 0, yaw: t1.yaw, scale: 1, leaving: false,
    halfWidth: 0.3, halfLength: 0.85, height: 1.5,
    violation: 'none', vehicleSubtype: 'ebike', cited: false,
  }
  // 3) red_light_run scooter approaching red light on t1 -> MUST bypass stop line and cross into t2 with redLightActive=true
  const redRunner = {
    track: t1, dist: 36, speed: 5, kind: 'scooter', down: 0, dodge: 0,
    x: 36, y: 0, z: 0, yaw: t1.yaw, scale: 1, leaving: false,
    halfWidth: 0.3, halfLength: 0.85, height: 1.5,
    violation: 'red_light_run', vehicleSubtype: 'ebike', redLightActive: false, cited: false,
  }

  sim.actors.push(wrongWayActor, normalActor, redRunner)
  let redRunnerSawActive = false
  for (let i = 0; i < 40; i++) {
    sim.step(0.05, {x: 40, y: 0, z: 0})
    if (redRunner.redLightActive) redRunnerSawActive = true
  }

  assert.equal(wrongWayActor.track.id, 100, 'wrong_way scooter must reverse-chain seamlessly from t2 into t1')
  assert.ok(wrongWayActor.dist < 38, 'wrong_way scooter keeps advancing backwards along t1')
  assert.ok(Math.abs(wrongWayActor.z - (-0.55)) < 0.05, 'wrong_way scooter maintains -0.55m lateral offset')
  assert.ok(Math.abs(Math.abs(wrongWayActor.yaw - t1.yaw) - Math.PI) < 1e-4, 'wrong_way yaw faces opposite lane direction')

  assert.equal(normalActor.track.id, 100, 'compliant scooter stops at red light')
  assert.ok(normalActor.dist <= 39.05, 'compliant scooter stays behind stop line')

  assert.equal(redRunner.track.id, 101, 'red_light_run scooter bypasses red-light stop gate into intersection')
  assert.equal(redRunnerSawActive, true, 'red_light_run scooter flags redLightActive during violation window')

  // Verify illegal_mod model builds cleanly via ebike-mounts accessories + has glowing LAMP vertices
  const models = trafficModels([])
  const modPair = models.twoWheelVariant('ebike', 'illegal_mod', 0.3, 0.4)
  const normalPair = models.twoWheelVariant('ebike', 'none', 0.1, 0.4)
  assert.notEqual(modPair.bare.geometry, normalPair.bare.geometry, 'illegal_mod gets distinct bare geometry')
  assert.notEqual(modPair.full.geometry, normalPair.full.geometry, 'illegal_mod gets distinct full geometry')
  const modBareGeom = models.geometries[modPair.bare.geometry]
  const normBareGeom = models.geometries[normalPair.bare.geometry]
  assert.ok(
    modBareGeom.attributes.position.count > normBareGeom.attributes.position.count,
    'illegal_mod bare geometry includes mounted ebike-mounts accessories',
  )
  const aMask = modBareGeom.attributes.aMask
  let lampVerts = 0
  for (let i = 0; i < aMask.count; i++) if (aMask.getY(i) > 0.5) lampVerts++
  assert.ok(lampVerts > 0, 'illegal_mod emits LAMP-masked headlight/angel-eye/underglow vertices')
  assert.equal(resolveTwoWheelSpec({kind: 'scooter', x: 0, y: 0, z: 0, yaw: 0, speed: 0, scale: 1, leaving: false, violation: 'illegal_mod'}).subtype, 'ebike')
})

test('Shizijie 4-gantry dynamic signal overlay & dual NPC officers: synced with sim.phase(), zero dynamic lights, culled > 220m', () => {
  const sim = new Traffic(cachedGraph, makeSeededRng(2027))
  assert.equal(sim.hasSignal(SHIZIJIE_SIGNAL_NODE_ID), true, 'graph.json.gz contains Shizijie signal node 626322720')

  // Verify fallback phase matches live sim phase at multiple cycle timestamps (offset=22, 18g+3y / 18g+3y)
  for (const t of [0, 5, 19, 21, 30, 39, 41, 60]) {
    sim.time = t
    const live = resolveShizijieSignalPhase(sim, t)
    const fallback = resolveShizijieSignalPhase(undefined, t)
    assert.equal(live.source, 'sim')
    assert.equal(fallback.source, 'fallback')
    assert.equal(live.ew, fallback.ew, `EW phase mismatch at t=${t}`)
    assert.equal(live.ns, fallback.ns, `NS phase mismatch at t=${t}`)
    assert.notEqual(live.ew === 'green' && live.ns === 'green', true, 'EW and NS must never both be green')
  }

  const scene = new THREE.Scene()
  const overlay = mountShizijieSignalsOverlay(scene, {getTraffic: () => sim})
  const officers = mountAllDutyOfficers(scene, undefined, {proceduralOnly: true})

  try {
    assert.equal(SHIZIJIE_GANTRIES.length, 4)
    assert.equal(overlay.gantryGroups.length, 4)
    // Zero PointLight / SpotLight / DirectionalLight anywhere in overlay or dual officers,
    // and #318 compatibility: all street-level detail meshes sit on MAIN_DETAIL_LAYER (skipped by water reflection camera).
    let dynamicLights = 0
    let detailMeshes = 0
    scene.traverse(obj => {
      if (obj instanceof THREE.Light) dynamicLights++
      if (obj instanceof THREE.Mesh) {
        assert.equal(obj.layers.test({mask: 1 << MAIN_DETAIL_LAYER}), true, `${obj.name || 'mesh'} must sit on MAIN_DETAIL_LAYER (#318)`)
        assert.equal(obj.layers.test({mask: 1}), false, `${obj.name || 'mesh'} must skip default water-mirror layer 0 (#318)`)
        detailMeshes++
      }
    })
    assert.equal(dynamicLights, 0, 'traffic-signals-overlay and npc-officer must add 0 dynamic Three.js lights')
    assert.ok(detailMeshes > 0, 'overlay and dual officers must mount detail meshes')

    // Near Shizijie -> visible; far (> 220 m) -> culled
    sim.time = 20 // local = (20 + 22) % 42 = 0 -> EW green, NS red
    const nearRes = overlay.update({x: SHIZIJIE_ORIGIN.x + 15, z: SHIZIJIE_ORIGIN.z - 10}, 0.05)
    assert.equal(nearRes.visible, true)
    assert.equal(nearRes.ew, 'green')
    assert.equal(nearRes.ns, 'red')
    assert.equal(overlay.group.visible, true)

    sim.time = 39 // local = (39 + 22) % 42 = 19 -> EW yellow, NS red
    const yellowRes = overlay.update({x: SHIZIJIE_ORIGIN.x, z: SHIZIJIE_ORIGIN.z}, 0.05)
    assert.equal(yellowRes.ew, 'yellow')
    assert.equal(yellowRes.ns, 'red')

    sim.time = 45 // local = (45 + 22) % 42 = 25 -> EW red, NS green
    const nsGreen = overlay.update({x: SHIZIJIE_ORIGIN.x, z: SHIZIJIE_ORIGIN.z}, 0.05)
    assert.equal(nsGreen.ew, 'red')
    assert.equal(nsGreen.ns, 'green')

    const farRes = overlay.update({x: JIEFANG_DUTY_ZONE.center.x, z: JIEFANG_DUTY_ZONE.center.z}, 0.05)
    assert.equal(farRes.visible, false)
    assert.equal(overlay.group.visible, false)

    // Both officers positioned at Jiefang & Shizijie and animate cleanly
    assert.ok(Math.hypot(officers.officers.jiefang.position.x - JIEFANG_OFFICER_SPOT.x, officers.officers.jiefang.position.z - JIEFANG_OFFICER_SPOT.z) < 2)
    assert.ok(Math.hypot(officers.officers.shizijie.position.x - SHIZIJIE_OFFICER_SPOT.x, officers.officers.shizijie.position.z - SHIZIJIE_OFFICER_SPOT.z) < 0.01)
    officers.update(0.1, 3.0)
    assert.equal(officers.officers.jiefang.phase(), 'stop')
  } finally {
    overlay.dispose()
    officers.dispose()
  }
})

test('rider-pool skeleton budget strictly enforces <= 16 desktop / <= 8 mobile across dense mixed 2.0 violations', () => {
  assert.equal(DESKTOP_MAX_SKELETONS, 16)
  assert.equal(MOBILE_MAX_SKELETONS, 8)
  assert.equal(DESKTOP_RIDER_LIMIT, 8)
  assert.equal(MOBILE_RIDER_LIMIT, 4)
  assert.equal(riderSkeletonCost('ebike_overload', true), 4)
  assert.equal(riderSkeletonCost('ebike_overload', false), 3)
  assert.equal(riderSkeletonCost('bike_double', false), 2)
  assert.equal(riderSkeletonCost('illegal_mod', false), 1)
  assert.equal(riderSkeletonCost('wrong_way', false), 1)
  assert.equal(riderSkeletonCost('red_light_run', false), 1)

  const denseActors = Array.from({length: 40}, (_, i) => ({
    kind: 'scooter',
    x: (i % 8) * 3,
    y: 151.3,
    z: Math.floor(i / 8) * 3,
    yaw: 0,
    speed: 4,
    scale: 1,
    leaving: false,
    violation: ACTIVE_VIOLATIONS[i % ACTIVE_VIOLATIONS.length],
    vehicleSubtype: i % ACTIVE_VIOLATIONS.length === 1 ? 'bicycle' : 'ebike',
  }))

  const desktopBudget = selectWithinSkeletonBudget(denseActors, {x: 0, z: 0}, false, () => true)
  assert.ok(desktopBudget.usedSkeletons <= 16, `desktop skeletons ${desktopBudget.usedSkeletons} exceeded 16`)
  assert.ok(desktopBudget.selected.length <= 8)

  const mobileBudget = selectWithinSkeletonBudget(denseActors, {x: 0, z: 0}, true, () => true)
  assert.ok(mobileBudget.usedSkeletons <= 8, `mobile skeletons ${mobileBudget.usedSkeletons} exceeded 8`)
  assert.ok(mobileBudget.selected.length <= 4)
})

test('[F] arbiter yields to priority 0-4 locks, cites all 6 violation types within 4.2m, and rejects inactive red_light_run / duplicate / vertical / compliant', () => {
  const dummyTrack = {
    id: 1, from: 1, to: 2, offset: 0, kind: 'nonmotor', speedKmh: 20,
    start: {id: 1, x: 0, y: 152, z: 0}, end: {id: 2, x: 100, y: 152, z: 0},
    dx: 1, dz: 0, yaw: Math.PI / 2, length: 100, walk: false,
  }
  const makeScooter = overrides => ({
    track: dummyTrack, dist: 10, speed: 4, kind: 'scooter', down: 0, dodge: 0,
    x: 0, y: 152, z: 0, yaw: 0, scale: 1, leaving: false, halfWidth: 0.3, halfLength: 0.85, height: 1.5,
    violation: 'no_helmet', vehicleSubtype: 'ebike', cited: false,
    ...overrides,
  })

  const player = {x: 0, y: 152, z: 0}
  const actors = [
    makeScooter({x: 2.0, z: 0, violation: 'none'}),
    makeScooter({x: 2.1, z: 0, violation: 'red_light_run', redLightActive: false}), // legal on green -> ignored
    makeScooter({x: 2.2, z: 0, violation: 'ebike_overload', cited: true}),
    makeScooter({x: 2.4, y: 145, z: 0, violation: 'ebike_overload'}),
    makeScooter({x: 5.5, z: 0, violation: 'ebike_overload'}),
    makeScooter({x: 3.8, z: 0, violation: 'bike_double', vehicleSubtype: 'bicycle'}),
  ]

  const cand = resolveTrafficDutyCandidate(true, {active: true}, actors, player, 4.2, DEFAULT_FINE_YUAN)
  assert.ok(cand)
  assert.equal(cand.violation, 'bike_double')
  assert.equal(cand.fineYuan, 30)
  assert.equal(cand.action, 'whistle_cite')

  // All 6 active violations are citable with expected ¥20/¥30/¥50 fines
  for (const v of ACTIVE_VIOLATIONS) {
    const a = makeScooter({
      x: 2.5,
      violation: v,
      vehicleSubtype: v === 'bike_double' ? 'bicycle' : 'ebike',
      ...(v === 'red_light_run' ? {redLightActive: true} : {}),
    })
    assert.equal(isCitableViolator(a), true, `${v} must be citable`)
    const c = resolveTrafficDutyCandidate(true, {active: true}, [a], player, 4.2, DEFAULT_FINE_YUAN)
    assert.ok(c)
    assert.equal(c.fineYuan, DEFAULT_FINE_YUAN[v])
    assert.equal(c.label, `吹哨劝导 · ${VIOLATION_LABELS[v]} ¥${DEFAULT_FINE_YUAN[v]}`)
  }

  assert.equal(resolveTrafficDutyCandidate(true, {active: true, aboardKind: 'bike'}, actors, player), null)
  assert.equal(resolveTrafficDutyCandidate(true, {active: true, modalOrOverlayBlocked: true}, actors, player), null)
  assert.equal(resolveTrafficDutyCandidate(true, {active: true, nearShop: {shopId: 's1'}}, actors, player), null)
  assert.equal(resolveTrafficDutyCandidate(true, {active: true, nearDownedVehicle: {kind: 'bike'}}, actors, player), null)

  const p4Shop = {priority: 4, action: 'open_shop', label: '进店', disabled: false, shopId: 's1'}
  assert.equal(mergeTrafficDutyDecision(p4Shop, cand).action, 'open_shop', 'Priority 4 shop beats whistle')

  const p5Mount = {priority: 5, action: 'mount_vehicle', label: '骑电动车', disabled: false}
  const merged = mergeTrafficDutyDecision(p5Mount, cand)
  assert.equal(merged.action, 'whistle_cite', 'Whistle overrides roadside mount (Priority 5)')
  assert.equal(merged.label, '吹哨劝导 · 单车双载 ¥30')
})

test('controller + leaderboard handle dual-zone 10-min shift, all 6 violations, anti-farm cited guard, IDOK-153 zero-penalty, corrupt/quota & v1 migration', () => {
  _resetGameStateForTest()
  const store = createMemStorage()
  setLeaderboardStorageForTest(store)

  // Corrupt JSON backup test
  store.setItem(TRAFFIC_DUTY_LEADERBOARD_KEY, '{broken_json')
  const corruptRecovered = loadLocalLeaderboard()
  assert.equal(corruptRecovered.entries.length, 0)
  assert.equal(store.getItem(TRAFFIC_DUTY_LEADERBOARD_CORRUPT_KEY), '{broken_json')

  // Legacy v1 3-key breakdown migrates cleanly with 0s for new 2.0 keys
  store.setItem(
    TRAFFIC_DUTY_LEADERBOARD_KEY,
    JSON.stringify({
      version: 1,
      entries: [{id: 'old1', playerName: '老志愿', totalFineYuan: 50, citedCount: 1, breakdown: {no_helmet: 0, bike_double: 0, ebike_overload: 1}, durationSec: 600, completed: true, achievedAt: 1}],
    }),
  )
  const migrated = loadLocalLeaderboard()
  assert.deepEqual(migrated.entries[0].breakdown, {
    no_helmet: 0, bike_double: 0, ebike_overload: 1, illegal_mod: 0, wrong_way: 0, red_light_run: 0,
  })
  store.removeItem(TRAFFIC_DUTY_LEADERBOARD_KEY)

  const sim = new Traffic(cachedGraph, makeSeededRng(2026))
  // Verify dual-zone detection
  assert.equal(resolveDutyZone({x: -168, y: 152, z: 40})?.id, 'jiefang')
  assert.equal(resolveDutyZone({x: -879.75, y: 151.3, z: -169.63})?.id, 'shizijie')
  assert.equal(resolveDutyZone({x: 2000, y: 152, z: 2000}), null)

  const playerPos = {x: -879.75, y: 151.3, z: -169.63}
  const duty = createTrafficDutyController({
    getPlayerPos: () => playerPos,
    isWalking: () => true,
    getTraffic: () => sim,
    getPlayerName: () => '桂林志愿者',
  })

  try {
    const initSnap = duty.getSnapshot()
    assert.equal(initSnap.durationSec, TRAFFIC_DUTY_DURATION_SEC)
    assert.equal(initSnap.inDutyZone, true)
    assert.equal(initSnap.zoneId, 'shizijie')
    assert.equal(initSnap.zoneName, '十字街')

    duty.startDuty()
    assert.equal(duty.getSnapshot().phase, 'active')
    assert.equal(sim.getDutyConfig().active, true)
    assert.equal(sim.getDutyConfig().zones?.length, 2)

    // Inject all 6 violation types within whistle range (20 + 30 + 50 + 50 + 50 + 50 = 250)
    const dummyTrack = [...sim.allTracks()].find(t => t.kind === 'nonmotor')
    assert.ok(dummyTrack)
    const mk = (violation, vehicleSubtype, dx, extra = {}) => ({
      track: dummyTrack, dist: 5, speed: 5, kind: 'scooter', down: 0, dodge: 0,
      x: playerPos.x + dx, y: playerPos.y, z: playerPos.z, yaw: 0, scale: 1, leaving: false,
      halfWidth: 0.3, halfLength: 0.85, height: 1.5, violation, vehicleSubtype, cited: false,
      ...extra,
    })
    const batch = [
      mk('no_helmet', 'ebike', 1.2),
      mk('bike_double', 'bicycle', 1.6),
      mk('ebike_overload', 'ebike', 2.0),
      mk('illegal_mod', 'ebike', 2.4),
      mk('wrong_way', 'ebike', 2.8, {wrongWay: true}),
      mk('red_light_run', 'ebike', 3.2, {redLightActive: true}),
    ]
    sim.actors.push(...batch)

    const expectedFines = [20, 30, 50, 50, 50, 50]
    for (let i = 0; i < batch.length; i++) {
      const res = duty.triggerWhistle()
      assert.equal(res.ok, true)
      assert.equal(res.fineYuan, expectedFines[i])
      assert.equal(batch[i].cited, true)
    }

    // Anti-farm duplicate guard
    const dupAttempt = duty.triggerWhistle()
    assert.equal(dupAttempt.ok, false)
    assert.equal(dupAttempt.reason, 'already_cited')

    const snap = duty.getSnapshot()
    assert.equal(snap.totalFineYuan, 250)
    assert.equal(snap.citedCount, 6)
    assert.deepEqual(snap.breakdown, {
      no_helmet: 1, bike_double: 1, ebike_overload: 1, illegal_mod: 1, wrong_way: 1, red_light_run: 1,
    })

    // IDOK-153 invariant: player wallet and wanted untouched
    assert.equal(getState().wanted, 0)
    assert.equal(getState().money, 200)

    // Advance 600s -> automatic completion & leaderboard persistence
    for (let i = 0; i < 2400; i++) duty.step(0.25)
    const endSnap = duty.getSnapshot()
    assert.equal(endSnap.phase, 'summary')
    assert.equal(endSnap.remainingSec, 0)
    assert.equal(endSnap.reportTitle, formatDutyReportTitle(250, '十字街'))
    assert.equal(endSnap.lastRecordRank, 1)
    assert.equal(endSnap.isNewRecord, true)
    assert.equal(sim.getDutyConfig().active, false)

    const lb = duty.getLeaderboard()
    assert.equal(lb.bestFineYuan, 250)
    assert.equal(lb.entries[0].playerName, '桂林志愿者')

    // QuotaExceededError resilience
    const quotaStore = createMemStorage({quotaFailCount: 1})
    setLeaderboardStorageForTest(quotaStore)
    const provider = createLocalLeaderboardProvider()
    const rec = provider.record({
      playerName: '新纪录',
      totalFineYuan: 320,
      citedCount: 7,
      breakdown: {no_helmet: 1, bike_double: 1, ebike_overload: 2, illegal_mod: 1, wrong_way: 1, red_light_run: 1},
      durationSec: 600,
      completed: true,
      achievedAt: Date.now(),
    })
    assert.equal(rec.summary.bestFineYuan, 320)
    assert.ok(quotaStore.map.has(TRAFFIC_DUTY_LEADERBOARD_KEY))
  } finally {
    duty.dispose()
    setLeaderboardStorageForTest(null)
  }
})

test('regression guards: zero localStorage reads in 60 step(dt) frames, 0-cite abandon skips leaderboard, dispose resets vest, stopActor fallback avoids stoppedUntil', () => {
  _resetGameStateForTest()
  let getItemCalls = 0
  const baseStore = createMemStorage()
  const spyStore = {
    getItem(k) {
      getItemCalls++
      return baseStore.getItem(k)
    },
    setItem(k, v) {
      baseStore.setItem(k, v)
    },
    removeItem(k) {
      baseStore.removeItem(k)
    },
  }
  setLeaderboardStorageForTest(spyStore)

  const vestHistory = []
  let toastText = ''
  const sim = new Traffic(cachedGraph, makeSeededRng(303))
  const pos = {x: -168, y: 152, z: 40}
  let renderCalls = 0
  const duty = createTrafficDutyController(
    {
      getPlayerPos: () => pos,
      isWalking: () => true,
      getTraffic: () => sim,
      onDutyStateChange: active => vestHistory.push(active),
      onToast: text => {
        toastText = text
      },
    },
    {
      mountDom: true,
      mountUi: () => ({
        render: () => {
          renderCalls++
        },
        openPanel: () => {},
        closePanel: () => {},
        isPanelOpen: () => false,
        dispose: () => {},
      }),
    },
  )

  try {
    const readsAfterInit = getItemCalls
    for (let i = 0; i < 60; i++) duty.step(0.016)
    assert.equal(getItemCalls, readsAfterInit, 'step(dt) hot path must not call leaderboard.load() / getItem')
    assert.ok(renderCalls >= 60)

    duty.startDuty()
    assert.equal(toastText.includes('按 F'), false)
    assert.deepEqual(vestHistory, [true])

    const readsBeforeActive = getItemCalls
    for (let i = 0; i < 60; i++) duty.step(0.016)
    assert.equal(getItemCalls, readsBeforeActive, 'active 60fps step(dt) must trigger 0 storage reads')

    const abandonSnap = duty.abandonDuty()
    assert.equal(abandonSnap.phase, 'summary')
    assert.equal(abandonSnap.lastRecordRank, null)
    assert.equal(abandonSnap.isNewRecord, false)
    assert.equal(duty.getLeaderboard().entries.length, 0, '0-cite abandon must not enter leaderboard')

    duty.startDuty()
    assert.deepEqual(vestHistory, [true, false, true])
    duty.dispose()
    assert.deepEqual(vestHistory, [true, false, true, false])
    assert.equal(sim.getDutyConfig().active, false)

    const orphanActor = {
      track: [...sim.allTracks()].find(t => !t.walk),
      dist: 0, speed: 5, kind: 'scooter', down: 0, dodge: 0,
      x: 0, y: 152, z: 0, yaw: 0, scale: 1, leaving: false, halfWidth: 0.3, halfLength: 0.85, height: 1.5,
    }
    assert.equal(stopActor(orphanActor, 3), true)
    assert.equal(orphanActor.stoppedUntil, undefined)
    assert.ok(orphanActor.holdUntil > performance.now() + 2000)
  } finally {
    setLeaderboardStorageForTest(null)
  }
})

test('sim.ts duty mode respects VISIBLE_SPAWN_MIN (130m) post-warmup with 0 frustum pop-ins on Jiefang Bridge and Shizijie', () => {
  for (const zone of DUTY_ZONES) {
    const sim = new Traffic(cachedGraph, makeSeededRng(888))
    const cam = {x: zone.center.x, y: 152, z: zone.center.z}
    const visible = p => {
      const dx = p.x - cam.x
      const dz = p.z - cam.z
      return dx > 0 && Math.abs(dz) <= dx
    }

    for (let i = 0; i < 40; i++) sim.step(0.05, cam, undefined, visible)

    sim.setDutyConfig({
      active: true,
      zones: DUTY_ZONES.map(z => ({id: z.id, center: z.center, radius: z.radiusM})),
      twoWheelShare: 0.7,
    })

    let prev = new Set(sim.actors)
    let popInsUnder130 = 0
    let totalDutyScootersSeen = 0
    for (let i = 0; i < 800; i++) {
      sim.step(0.05, cam, undefined, visible)
      for (const actor of sim.actors) {
        if (!prev.has(actor)) {
          const dist = Math.hypot(actor.x - cam.x, actor.z - cam.z)
          if (visible(actor) && dist < 130) popInsUnder130++
        }
        if (actor.kind === 'scooter' && !actor.leaving) totalDutyScootersSeen++
      }
      prev = new Set(sim.actors)
    }

    assert.equal(popInsUnder130, 0, `${zone.id} duty spawning post-warmup must produce 0 visible spawns within 130m`)
    assert.ok(totalDutyScootersSeen >= 600, `${zone.id} duty mode sustains steady two-wheel traffic after warmup`)
  }
})

test('design-rules, hotkey & public-web compliance: zero private KeyF, zero emojis, zero gradients, single --ui-serif, zero forbidden terms', () => {
  const dir = new URL('./', import.meta.url)
  const files = [
    'types.ts',
    'leaderboard.ts',
    'whistle.ts',
    'arbiter.ts',
    'controller.ts',
    'ui.ts',
    'ui.css',
    'index.ts',
    'npc-officer.ts',
    'traffic-signals-overlay.ts',
  ]
  // Unicode escapes prevent raw grep audits over web/src/traffic-duty/ from self-matching the test literal
  const forbidden = new RegExp('\\u884c\\u653f\\u5904\\u7f5a|\\u6263\\u5206|\\u8b66\\u5fbd|\\u8b66\\u53f7')
  for (const name of files) {
    const src = readFileSync(new URL(name, dir), 'utf8')
    assert.equal(forbidden.test(src), false, `${name} must not contain forbidden compliance words`)
    assert.equal(/event\.code\s*===?\s*['"]KeyF['"]/.test(src), false, `${name} must not bind private KeyF listener`)
    assert.equal(/linear-gradient|radial-gradient/.test(src), false, `${name} must not use gradients`)
    assert.equal(/小贴士|Tip\b/.test(src), false, `${name} must not contain tip slogans`)
    assert.equal(/\p{Emoji_Presentation}/u.test(src), false, `${name} must not contain emojis`)
    if (name === 'ui.ts') {
      assert.equal(src.includes('rulesHtml.replace'), false, 'ui.ts must not mutate HTML with brittle string replace')
      assert.equal(src.includes('<footer'), false, 'ui.ts must not use <footer> which collides with hud.css fixed footer rule')
    }
    if (name === 'ui.css') {
      assert.equal(src.includes('--ui-serif'), true)
      assert.equal(/PingFang|sans-serif|monospace/.test(src), false, 'ui.css must stick to --ui-serif only')
    }
  }
  const catalogSrc = readFileSync('web/src/game/catalog.ts', 'utf8')
  assert.equal(forbidden.test(catalogSrc), false, 'catalog.ts must not contain forbidden compliance words')
})
