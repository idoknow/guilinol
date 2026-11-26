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
      export {
        loadLocalSave,
        resetSaveForTesting,
        SAVE_STORAGE_KEY,
        setSaveStorageForTest,
      } from './web/src/game/save.ts'
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
      export {mountTrafficDutyUi} from './web/src/traffic-duty/ui.ts'
      export {
        createFineTerminalSession,
        mountFineTerminalOverlay,
      } from './web/src/traffic-duty/fine-terminal/index.ts'
      export {
        findOfficerInteractCandidate,
        isCitableViolator,
        mergeTrafficDutyDecision,
        resolveTrafficDutyCandidate,
      } from './web/src/traffic-duty/arbiter.ts'
      export {
        createLocalLeaderboardProvider,
        loadLocalLeaderboard,
        setLeaderboardStorageForTest,
        TRAFFIC_DUTY_LEADERBOARD_CORRUPT_KEY,
        TRAFFIC_DUTY_LEADERBOARD_KEY,
      } from './web/src/traffic-duty/leaderboard.ts'
      export {
        ACTIVE_VIOLATIONS,
        clampToBridgeDutyBounds,
        computeCommissionYuan,
        computeFineYuan,
        computeFineYuanStack,
        DEFAULT_FINE_YUAN,
        DUTY_ZONES,
        formatDutyReportTitle,
        formatViolationBreakdownFormula,
        formatViolationFormula,
        formatViolationStackLabel,
        isInBridgeDutyBounds,
        JIEFANG_BRIDGE_DECK_BOUNDS,
        JIEFANG_DUTY_BOUNDS_WARNING,
        JIEFANG_DUTY_ZONE,
        PLAYER_COMMISSION_RATE,
        resolveActorViolations,
        resolveDutyTeleportDeckY,
        resolveDutyZone,
        SHIZIJIE_DUTY_ZONE,
        TRAFFIC_DUTY_DURATION_SEC,
        VIOLATION_LABELS,
      } from './web/src/traffic-duty/types.ts'
      export {jiefangDeckWorldY} from './web/src/traffic-duty/jiefang-railings.ts'
      export {
        JIEFANG_OFFICER_SPOT,
        mountAllDutyOfficers,
        mountDutyOfficer,
        resolveDeckGroundY,
        SHIZIJIE_OFFICER_SPOT,
      } from './web/src/traffic-duty/npc-officer.ts'
      export {resolveInteraction, createInteractArbiter} from './web/src/walk/interact-arbiter.ts'
      export {resolveWalkGearKeyDelta} from './web/src/ui/walk.ts'
      export {
        bindDutyKeyboard,
        createDutyKeysController,
        shouldSuppressRideGearKey,
      } from './web/src/traffic-duty/duty-keys.ts'
      export {
        DUPLICATE_CITATION_MESSAGE,
        HANDOVER_MAX_DISTANCE_M,
        createCitationLedger,
        getViolatorHeldReceipt,
      } from './web/src/traffic-duty/handover/index.ts'
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
  loader: {'.css': 'empty'},
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
  loadLocalSave,
  resetSaveForTesting,
  SAVE_STORAGE_KEY,
  setSaveStorageForTest,
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
  mountTrafficDutyUi,
  createFineTerminalSession,
  mountFineTerminalOverlay,
  findOfficerInteractCandidate,
  isCitableViolator,
  mergeTrafficDutyDecision,
  resolveTrafficDutyCandidate,
  createLocalLeaderboardProvider,
  loadLocalLeaderboard,
  setLeaderboardStorageForTest,
  TRAFFIC_DUTY_LEADERBOARD_CORRUPT_KEY,
  TRAFFIC_DUTY_LEADERBOARD_KEY,
  ACTIVE_VIOLATIONS,
  clampToBridgeDutyBounds,
  computeCommissionYuan,
  computeFineYuan,
  computeFineYuanStack,
  DEFAULT_FINE_YUAN,
  DUTY_ZONES,
  formatDutyReportTitle,
  formatViolationBreakdownFormula,
  formatViolationFormula,
  formatViolationStackLabel,
  isInBridgeDutyBounds,
  JIEFANG_BRIDGE_DECK_BOUNDS,
  JIEFANG_DUTY_BOUNDS_WARNING,
  JIEFANG_DUTY_ZONE,
  PLAYER_COMMISSION_RATE,
  resolveActorViolations,
  resolveDutyTeleportDeckY,
  resolveDutyZone,
  SHIZIJIE_DUTY_ZONE,
  TRAFFIC_DUTY_DURATION_SEC,
  VIOLATION_LABELS,
  jiefangDeckWorldY,
  JIEFANG_OFFICER_SPOT,
  mountAllDutyOfficers,
  resolveDeckGroundY,
  SHIZIJIE_OFFICER_SPOT,
  resolveInteraction,
  createInteractArbiter,
  resolveWalkGearKeyDelta,
  bindDutyKeyboard,
  createDutyKeysController,
  shouldSuppressRideGearKey,
  DUPLICATE_CITATION_MESSAGE,
  HANDOVER_MAX_DISTANCE_M,
  createCitationLedger,
  getViolatorHeldReceipt,
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
    weights: {
      none: 12,
      no_helmet: 15,
      ebike_overload: 15,
      bike_double: 15,
      illegal_mod: 15,
      wrong_way: 14,
      red_light_run: 14,
    },
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

    // Officer visibility & deck-height clamp: bogus lower-bank height (146.2m) is rejected; beacon toggles cleanly
    assert.equal(resolveDeckGroundY(146.2, 151.85), 151.85)
    assert.equal(resolveDeckGroundY(151.72, 151.85), 151.72)
    assert.equal(resolveDeckGroundY(undefined, 151.85), 151.85)
    assert.equal(officers.officers.jiefang.beaconGroup.visible, true)
    officers.setJiefangState('active')
    assert.equal(officers.officers.jiefang.beaconGroup.visible, false)
    officers.setJiefangState('available')
    assert.equal(officers.officers.jiefang.beaconGroup.visible, true)

    const lowerBankScene = new THREE.Scene()
    const deckGuarded = mountAllDutyOfficers(lowerBankScene, () => 146.2, {proceduralOnly: true})
    try {
      assert.equal(deckGuarded.officers.jiefang.position.y, JIEFANG_OFFICER_SPOT.y, 'Jiefang officer must stay on bridge deck and never sink to 146.2m riverbank')
      deckGuarded.update(0.3, 1.0)
      assert.equal(deckGuarded.officers.jiefang.position.y, JIEFANG_OFFICER_SPOT.y)
    } finally {
      deckGuarded.dispose()
    }
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
  assert.equal(cand.fineYuan, 50)
  assert.equal(cand.action, 'whistle_cite')

  // All 6 active violations are citable with calibrated r8-2 fines (50 / illegal_mod 100 / ebike_overload 20)
  const expectedTable = {
    no_helmet: 50,
    bike_double: 50,
    ebike_overload: 20,
    illegal_mod: 100,
    wrong_way: 50,
    red_light_run: 50,
  }
  for (const v of ACTIVE_VIOLATIONS) {
    assert.equal(DEFAULT_FINE_YUAN[v], expectedTable[v], `${v} default fine must match r8-2 rule`)
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
    assert.equal(c.label, `拦截开单 · ${VIOLATION_LABELS[v]} ¥${DEFAULT_FINE_YUAN[v]}`)
  }

  assert.equal(resolveTrafficDutyCandidate(true, {active: true, aboardKind: 'bike'}, actors, player), null)
  assert.equal(resolveTrafficDutyCandidate(true, {active: true, modalOrOverlayBlocked: true}, actors, player), null)
  assert.equal(resolveTrafficDutyCandidate(true, {active: true, nearShop: {shopId: 's1'}}, actors, player), null)
  assert.equal(resolveTrafficDutyCandidate(true, {active: true, nearDownedVehicle: {kind: 'bike'}}, actors, player), null)

  // Idle state near Jiefang officer yields talk_officer candidate; overrides Priority 5 mount, yields to Priority 4 shop
  const nearOfficerPos = {x: JIEFANG_DUTY_ZONE.spot.x - 1.5, y: JIEFANG_DUTY_ZONE.spot.y, z: JIEFANG_DUTY_ZONE.spot.z}
  const talkCand = resolveTrafficDutyCandidate(false, {active: true}, [], nearOfficerPos, 4.2, DEFAULT_FINE_YUAN, {
    canTalkOfficer: true,
    officerPos: JIEFANG_DUTY_ZONE.spot,
  })
  assert.ok(talkCand)
  assert.equal(talkCand.action, 'talk_officer')
  assert.equal(talkCand.violation, 'officer_briefing')
  assert.equal(findOfficerInteractCandidate({x: -100, y: 151.85, z: 40}, JIEFANG_DUTY_ZONE.spot), null)

  const p4Shop = {priority: 4, action: 'open_shop', label: '进店', disabled: false, shopId: 's1'}
  assert.equal(mergeTrafficDutyDecision(p4Shop, cand).action, 'open_shop', 'Priority 4 shop beats whistle')
  assert.equal(mergeTrafficDutyDecision(p4Shop, talkCand).action, 'open_shop', 'Priority 4 shop beats officer talk')

  const p5Mount = {priority: 5, action: 'mount_vehicle', label: '骑电动车', disabled: false}
  const merged = mergeTrafficDutyDecision(p5Mount, cand)
  assert.equal(merged.action, 'whistle_cite', 'Intercept overrides roadside mount (Priority 5)')
  assert.equal(merged.label, '拦截开单 · 单车双载 ¥50')
  const mergedTalk = mergeTrafficDutyDecision(p5Mount, talkCand)
  assert.equal(mergedTalk.action, 'talk_officer', 'Officer briefing overrides roadside mount (Priority 5)')
})

test('story-gated duty start, gear handover, electronic fine terminal (issue vs cancel), bridge bounds clamp, signals & leaderboard', async () => {
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
  // Verify dual-zone detection & Jiefang Bridge duty perimeter bounds
  assert.equal(resolveDutyZone({x: -168, y: 152, z: 40})?.id, 'jiefang')
  assert.equal(resolveDutyZone({x: -879.75, y: 151.3, z: -169.63})?.id, 'shizijie')
  assert.equal(resolveDutyZone({x: 2000, y: 152, z: 2000}), null)
  assert.equal(isInBridgeDutyBounds(JIEFANG_DUTY_ZONE.spot), true, 'officer spot sits inside Jiefang Bridge duty bounds')
  assert.equal(isInBridgeDutyBounds({x: -168, y: 151.7, z: 40}), true, 'bridge midspan sits inside duty bounds')
  assert.equal(isInBridgeDutyBounds({x: -879.75, y: 151.3, z: -169.63}), false, 'Shizijie sits outside Jiefang Bridge duty bounds')
  assert.equal(isInBridgeDutyBounds({x: -266, y: 146.0, z: 26}), false, 'lower riverbank sits outside bridge deck altitude band')

  const playerPos = {x: JIEFANG_DUTY_ZONE.spot.x - 1.8, y: JIEFANG_DUTY_ZONE.spot.y, z: JIEFANG_DUTY_ZONE.spot.z - 1.2}
  const gearLog = []
  const gestureLog = []
  const trafficEvents = []
  const knockdownLog = []
  const clampLog = []
  let hitHandler = null
  let nextTerminalOutcome = {issued: false, cancelled: true}
  const terminalRequests = []

  const duty = createTrafficDutyController({
    getPlayerPos: () => playerPos,
    isWalking: () => true,
    getTraffic: () => sim,
    getPlayerName: () => '桂林志愿者',
    trafficBridge: {
      start: () => trafficEvents.push('start'),
      stop: () => trafficEvents.push('stop'),
      getTraffic: () => sim,
      onPlayerHit: cb => {
        hitHandler = cb
        return () => {
          hitHandler = null
        }
      },
    },
    fineTerminal: {
      openFineTerminal: async req => {
        terminalRequests.push(req)
        return nextTerminalOutcome
      },
    },
    propsBridge: {
      grantGear: g => gearLog.push(g),
      clearGear: () => gearLog.push({hasWhistle: false, hasFlag: false}),
      playGesture: k => gestureLog.push(k),
    },
    knockdownBridge: {
      triggerKnockdown: (kind, dir, severity) => knockdownLog.push({kind, dir, severity}),
      isDown: () => false,
    },
    onDutyBoundaryClamp: (clamped, warning) => clampLog.push({clamped, warning}),
  })

  try {
    const initSnap = duty.getSnapshot()
    assert.equal(initSnap.durationSec, TRAFFIC_DUTY_DURATION_SEC)
    assert.equal(initSnap.inDutyZone, true)
    assert.equal(initSnap.inBridgeBounds, true)
    assert.equal(initSnap.zoneId, 'jiefang')
    assert.equal(initSnap.gear.hasWhistle, false)
    assert.equal(initSnap.gear.hasFlag, false)

    // 1) Cannot start duty directly without talking to the Jiefang officer
    const blockedStart = duty.startDuty()
    assert.equal(blockedStart.phase, 'idle', 'startDuty() must be blocked before officer dialogue completes')
    assert.equal(blockedStart.gear.hasWhistle, false)
    assert.equal(blockedStart.gear.hasFlag, false)
    assert.equal(sim.getDutyConfig().active, false)
    assert.equal(trafficEvents.length, 0)

    // 2) Talk to officer via unified [F] candidate -> cancel does NOT grant gear or start duty
    const officerCand = duty.getInteractCandidate()
    assert.ok(officerCand)
    assert.equal(officerCand.action, 'talk_officer')
    const openRes = await duty.interact()
    assert.equal(openRes.ok, true)
    assert.equal(openRes.action, 'talk_officer')
    assert.equal(duty.isStoryOpen(), true)
    assert.equal(duty.getSnapshot().phase, 'idle')
    assert.equal(duty.cancelStory(), true)
    assert.equal(duty.getSnapshot().phase, 'idle')
    assert.equal(duty.getSnapshot().gear.hasWhistle, false)

    // 3) Complete officer briefing dialogue -> grants whistle & flag and activates Jiefang duty
    await duty.interact()
    duty.advanceStory() // 0 -> 1
    duty.advanceStory() // 1 -> 2 (choices)
    assert.equal(duty.chooseStoryOption('ask_rules'), true) // 2 -> 3
    duty.advanceStory() // 3 -> 4
    duty.advanceStory() // 4 -> 5 (grantGear: true)
    assert.equal(duty.getSnapshot().gear.hasWhistle, true)
    assert.equal(duty.getSnapshot().gear.hasFlag, true)
    assert.equal(duty.getSnapshot().phase, 'idle', 'duty starts only after confirming final briefing line')
    duty.advanceStory() // finishes beat -> enters active duty!

    const activeSnap = duty.getSnapshot()
    assert.equal(activeSnap.phase, 'active')
    assert.equal(activeSnap.briefingDone, true)
    assert.equal(activeSnap.gear.hasWhistle, true)
    assert.equal(activeSnap.gear.hasFlag, true)
    assert.equal(sim.getDutyConfig().active, true)
    assert.deepEqual(trafficEvents, ['start'])
    assert.equal(gearLog.some(g => g.hasWhistle && g.hasFlag), true)

    // 4) Traffic hit bridge forwards directly into Hy2's knockdown bridge
    assert.equal(typeof hitHandler, 'function')
    hitHandler(0.85, {x: 1, z: 0})
    assert.equal(knockdownLog.length, 1)
    assert.equal(knockdownLog[0].kind, 'vehicle_hit')
    assert.equal(knockdownLog[0].severity, 0.85)

    // 5) Inject all 6 violation types within intercept range (5 + 10 + 15 + 20 + 15 + 20 = 85)
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

    // Whistle halts nearest violator (batch[0]) and locks pending citation until ticket is issued
    const sigRes = duty.triggerSignal('whistle')
    assert.equal(sigRes.ok, true)
    assert.equal(sigRes.affectedCount, 1)
    assert.equal(duty.getSnapshot().hasPendingCitation, true)
    // Cannot halt a second violator before issuing the pending ticket!
    const blockedFlag = duty.triggerSignal('flag_stop')
    assert.equal(blockedFlag.ok, false)
    assert.equal(blockedFlag.reason, 'pending_citation')
    assert.equal(duty.triggerSignal('flag_go').ok, true)
    assert.deepEqual(gestureLog.slice(0, 2), ['whistle', 'flag_go'])

    // 6) Intercept calls openFineTerminal: CANCEL must NOT cite or count fine!
    nextTerminalOutcome = {issued: false, cancelled: true}
    const cancelRes = await duty.interceptViolator()
    assert.equal(cancelRes.ok, false)
    assert.equal(cancelRes.reason, 'terminal_cancelled')
    assert.equal(terminalRequests.length, 1)
    assert.equal(terminalRequests[0].violation, 'no_helmet')
    assert.equal(batch[0].cited, false, 'cancelled fine terminal must leave actor uncited')
    assert.equal(duty.getSnapshot().totalFineYuan, 0, 'cancelled fine terminal must count 0 yuan')
    assert.equal(duty.getSnapshot().citedCount, 0)
    assert.equal(duty.getSnapshot().hasPendingCitation, true, 'cancelled ticket keeps pending lock on halted violator')

    // 7) Intercept with ISSUED terminal counts fine (r8-2: 50+50+20+100+50+50 = 320) & marks cited for all 6 violations
    const expectedFines = [50, 50, 20, 100, 50, 50]
    for (let i = 0; i < batch.length; i++) {
      nextTerminalOutcome = {issued: true, fineYuan: expectedFines[i], ticketId: `GL-00${i + 1}`}
      const res = await duty.interceptViolator()
      assert.equal(res.ok, true)
      assert.equal(res.fineYuan, expectedFines[i])
      assert.equal(res.ticketId, `GL-00${i + 1}`)
      assert.equal(batch[i].cited, true)
      assert.equal(duty.getSnapshot().hasPendingCitation, false)
    }

    // Anti-farm duplicate guard
    const dupAttempt = await duty.interceptViolator()
    assert.equal(dupAttempt.ok, false)
    assert.equal(dupAttempt.reason, 'already_cited')

    const snap = duty.getSnapshot()
    assert.equal(snap.totalFineYuan, 320)
    assert.equal(snap.pendingEarningsYuan, 32)
    assert.equal(snap.citedCount, 6)
    assert.deepEqual(snap.breakdown, {
      no_helmet: 1, bike_double: 1, ebike_overload: 1, illegal_mod: 1, wrong_way: 1, red_light_run: 1,
    })

    // 8) Bridge perimeter enforcement while active: stepping off Jiefang Bridge clamps & warns "正在值班"
    assert.ok(JIEFANG_BRIDGE_DECK_BOUNDS.minX < 0 && JIEFANG_BRIDGE_DECK_BOUNDS.maxX > 0)
    const outsidePos = {x: -420, y: 151.7, z: -60}
    const clampedOut = duty.clampPlayerPos(outsidePos)
    assert.equal(clampedOut.clamped, true)
    assert.equal(isInBridgeDutyBounds(clampedOut.pos), true)
    assert.equal(clampedOut.warning, JIEFANG_DUTY_BOUNDS_WARNING)
    assert.ok(clampedOut.warning.includes('正在值班'))
    assert.ok(clampLog.length >= 1)

    const {clamped: pureClamped, outOfBounds} = clampToBridgeDutyBounds(outsidePos)
    assert.equal(outOfBounds, true)
    assert.equal(isInBridgeDutyBounds(pureClamped), true)

    // IDOK-153 & r8-2 invariant: player wallet untouched before officer off-duty check-in, wanted stays 0
    assert.equal(getState().wanted, 0)
    assert.equal(getState().money, 200)

    // Advance 600s -> automatic completion & leaderboard persistence (wallet still untouched until check-in)
    for (let i = 0; i < 2400; i++) duty.step(0.25)
    const endSnap = duty.getSnapshot()
    assert.equal(endSnap.phase, 'summary')
    assert.equal(endSnap.remainingSec, 0)
    assert.equal(endSnap.reportTitle, formatDutyReportTitle(320, '解放桥'))
    assert.equal(endSnap.lastRecordRank, 1)
    assert.equal(endSnap.isNewRecord, true)
    assert.equal(endSnap.gear.hasWhistle, false, 'shift summary clears duty gear')
    assert.equal(endSnap.gear.hasFlag, false)
    assert.equal(getState().money, 200, 'timeout summary without officer check-in must not auto-credit wallet')
    assert.equal(sim.getDutyConfig().active, false)
    assert.deepEqual(trafficEvents, ['start', 'stop'])

    const lb = duty.getLeaderboard()
    assert.equal(lb.bestFineYuan, 320)
    assert.equal(lb.entries[0].playerName, '桂林志愿者')

    // QuotaExceededError resilience
    const quotaStore = createMemStorage({quotaFailCount: 1})
    setLeaderboardStorageForTest(quotaStore)
    const provider = createLocalLeaderboardProvider()
    const rec = provider.record({
      playerName: '新纪录',
      totalFineYuan: 420,
      citedCount: 7,
      breakdown: {no_helmet: 1, bike_double: 1, ebike_overload: 2, illegal_mod: 1, wrong_way: 1, red_light_run: 1},
      durationSec: 600,
      completed: true,
      achievedAt: Date.now(),
    })
    assert.equal(rec.summary.bestFineYuan, 420)
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
  const pos = {x: -168, y: 151.7, z: 40}
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
      mountDom: false,
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

    // Complete briefing via skipStory() to enter active shift
    assert.equal(duty.startOfficerBriefing('briefing_intro'), true)
    assert.equal(duty.skipStory(), true)
    assert.equal(duty.getSnapshot().phase, 'active')
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

    // Re-briefing starts second shift; dispose() resets vest and deactivates traffic duty mode
    assert.equal(duty.startOfficerBriefing('briefing_repeat'), true)
    assert.equal(duty.skipStory(), true)
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

test('S6 & S2 regressions: 100 step() frames call trafficBridge.start strictly once without wiping actors; [F] opens fine terminal; Jiefang teleport lands on bridge deck ±0.5m facing officer', async () => {
  _resetGameStateForTest()
  const store = createMemStorage()
  setLeaderboardStorageForTest(store)

  // S2 teleport deck elevation & officer visibility contract
  const tp = JIEFANG_DUTY_ZONE.teleport
  assert.equal(typeof tp.y, 'number', 'JIEFANG_DUTY_ZONE.teleport must carry explicit bridge deck elevation y')
  const roadDeckY = jiefangDeckWorldY(tp.x, tp.z)
  assert.ok(Math.abs(tp.y - roadDeckY) <= 0.5, `teleport.y (${tp.y}) must sit within ±0.5m of bridge deck (${roadDeckY})`)
  assert.equal(resolveDutyTeleportDeckY(146.5, tp.y), tp.y, 'lower Binjiang Road sample (146.5m) must be rejected')
  assert.equal(resolveDutyTeleportDeckY(151.84, tp.y), 151.84, 'upper bridge landmark sample (151.84m) must be accepted')
  const landedPos = {x: tp.x, y: tp.y + 0.875, z: tp.z}
  assert.equal(isInBridgeDutyBounds(landedPos), true, 'teleported player on bridge deck must be inside duty bounds')

  // S6 async trafficBridge lifecycle regression: start() called strictly once across 100 step() frames even when sim resolves asynchronously & changes instance
  const simA = new Traffic(cachedGraph, makeSeededRng(404))
  const simB = new Traffic(cachedGraph, makeSeededRng(505))
  const nonmotorTrack = [...simA.allTracks()].find(t => t.kind === 'nonmotor')
  assert.ok(nonmotorTrack)

  const violator = {
    track: nonmotorTrack,
    dist: 8,
    speed: 3.5,
    kind: 'scooter',
    down: 0,
    dodge: 0,
    x: tp.x + 1.4,
    y: tp.y,
    z: tp.z + 0.4,
    yaw: 0,
    scale: 1,
    leaving: false,
    halfWidth: 0.3,
    halfLength: 0.85,
    height: 1.5,
    violation: 'no_helmet',
    vehicleSubtype: 'ebike',
    cited: false,
  }

  let startCalls = 0
  let stopCalls = 0
  let liveSim = undefined
  let liveActors = []
  let terminalOpens = 0

  const duty = createTrafficDutyController({
    getPlayerPos: () => landedPos,
    isWalking: () => true,
    projectToScreen: () => ({x: 640, y: 300, visible: true}),
    trafficBridge: {
      start: () => {
        startCalls++
        // Simulate real duty-traffic bug if start() were mistakenly re-invoked: wiping actors on restart
        if (startCalls > 1) {
          liveActors = []
          liveSim = undefined
        }
      },
      stop: () => {
        stopCalls++
        liveActors = []
        liveSim = undefined
      },
      getTraffic: () => liveSim,
      getActors: () => liveActors,
    },
    fineTerminal: {
      openFineTerminal: async req => {
        terminalOpens++
        return {issued: true, fineYuan: req.fineYuan, receiptNo: `GL-S6-${terminalOpens}`}
      },
    },
  })

  try {
    // At teleport landing spot: overhead officer marker visible and [F] opens officer dialogue
    const preSnap = duty.getSnapshot()
    assert.equal(preSnap.inBridgeBounds, true)
    assert.equal(preSnap.officerScreen?.visible, true)
    assert.ok(preSnap.officerDistanceM !== null && preSnap.officerDistanceM <= 5.0)
    const talkCand = duty.getInteractCandidate()
    assert.equal(talkCand?.action, 'talk_officer')

    const openTalk = await duty.interact()
    assert.equal(openTalk.ok, true)
    assert.equal(duty.isStoryOpen(), true)
    assert.equal(duty.skipStory(), true)
    assert.equal(duty.getSnapshot().phase, 'active')
    assert.equal(startCalls, 1)
    assert.equal(stopCalls, 0)

    // Run 100 step() frames:
    //  - Frames 0..4: async traffic load still pending (liveSim = undefined)
    //  - Frame 5: simA becomes ready with 10 actors (incl. nearby violator)
    //  - Frame 50: sim instance changes to simB (must only call setDutyConfig, NEVER trafficBridge.start())
    for (let f = 0; f < 100; f++) {
      if (f === 5) {
        liveSim = simA
        liveActors = [violator, ...Array.from({length: 9}, (_, i) => ({...violator, x: tp.x + 15 + i * 2, violation: 'none'}))]
      }
      if (f === 50) {
        liveSim = simB
      }
      duty.step(0.016)
      if (f >= 5) {
        assert.equal(liveActors.length, 10, `frame ${f}: active actors must never be wiped to 0 during step()`)
      }
    }

    assert.equal(startCalls, 1, 'trafficBridge.start() must be called strictly once across 100 active step() frames')
    assert.equal(stopCalls, 0, 'trafficBridge.stop() must not be called while shift is active')
    assert.equal(simA.getDutyConfig().active, true)
    assert.equal(simB.getDutyConfig().active, true)

    // Near violator: [F] reliably finds candidate and opens fine terminal
    const violCand = duty.getInteractCandidate()
    assert.equal(violCand?.action, 'whistle_cite')
    assert.equal(violCand?.actor, violator)
    const citeRes = await duty.interact()
    assert.equal(citeRes.ok, true)
    assert.equal(terminalOpens, 1)
    assert.equal(violator.cited, true)
    assert.equal(duty.getSnapshot().citedCount, 1)
    assert.equal(duty.getSnapshot().totalFineYuan, 50)

    // Stop is called once on abandon/finish
    duty.abandonDuty()
    assert.equal(stopCalls, 1)
  } finally {
    duty.dispose()
    setLeaderboardStorageForTest(null)
  }
})

test('k40 pacing & anti-farm: r8-2 fine rules, same vehicle cannot be fined twice, and cannot halt/intercept next vehicle until pending ticket finishes', async () => {
  _resetGameStateForTest()
  const store = createMemStorage()
  setLeaderboardStorageForTest(store)

  // 1) All default fines match r8-2 table (50 / illegal_mod 100 / ebike_overload 20)
  assert.equal(DEFAULT_FINE_YUAN.no_helmet, 50)
  assert.equal(DEFAULT_FINE_YUAN.bike_double, 50)
  assert.equal(DEFAULT_FINE_YUAN.wrong_way, 50)
  assert.equal(DEFAULT_FINE_YUAN.red_light_run, 50)
  assert.equal(DEFAULT_FINE_YUAN.illegal_mod, 100)
  assert.equal(DEFAULT_FINE_YUAN.ebike_overload, 20)

  const sim = new Traffic(cachedGraph, makeSeededRng(612))
  const track = [...sim.allTracks()].find(t => t.kind === 'nonmotor')
  assert.ok(track)
  const playerPos = {x: JIEFANG_DUTY_ZONE.spot.x - 1.5, y: JIEFANG_DUTY_ZONE.spot.y, z: JIEFANG_DUTY_ZONE.spot.z - 1.0}
  const actorA = {
    track, dist: 5, speed: 4, kind: 'scooter', down: 0, dodge: 0,
    x: playerPos.x + 1.5, y: playerPos.y, z: playerPos.z, yaw: 0, scale: 1, leaving: false,
    halfWidth: 0.3, halfLength: 0.85, height: 1.5, violation: 'no_helmet', vehicleSubtype: 'ebike', cited: false,
  }
  const actorB = {
    track, dist: 6, speed: 4, kind: 'scooter', down: 0, dodge: 0,
    x: playerPos.x + 2.2, y: playerPos.y, z: playerPos.z, yaw: 0, scale: 1, leaving: false,
    halfWidth: 0.3, halfLength: 0.85, height: 1.5, violation: 'illegal_mod', vehicleSubtype: 'ebike', cited: false,
  }
  const actors = [actorA, actorB]
  let resolveTerminal = null

  const duty = createTrafficDutyController({
    getPlayerPos: () => playerPos,
    isWalking: () => true,
    getActors: () => actors,
    getTraffic: () => sim,
    fineTerminal: {
      openFineTerminal: () =>
        new Promise(resolve => {
          resolveTerminal = resolve
        }),
    },
  })

  try {
    duty.startOfficerBriefing('briefing_intro')
    duty.skipStory()
    assert.equal(duty.getSnapshot().phase, 'active')

    // 2) Halt actorA via whistle -> actorB cannot be halted or targeted while actorA ticket is pending
    const halt1 = duty.triggerSignal('whistle')
    assert.equal(halt1.ok, true)
    assert.equal(duty.getSnapshot().hasPendingCitation, true)
    assert.equal(duty.triggerSignal('whistle').reason, 'pending_citation')
    assert.equal(duty.triggerSignal('flag_stop').reason, 'pending_citation')

    // Move actorB even closer than actorA -> candidate MUST remain locked to actorA!
    actorB.x = playerPos.x + 0.6
    assert.equal(duty.getInteractCandidate()?.actor, actorA)

    // 3) Open fine terminal for actorA (still open, not issued yet) -> cannot intercept actorB or blow whistle
    const pendingPromise = duty.interceptViolator()
    assert.equal(duty.isTerminalOpen(), true)
    assert.equal(duty.getInteractCandidate(), null)
    assert.equal((await duty.interceptViolator()).reason, 'terminal_open')
    assert.equal(duty.triggerSignal('whistle').reason, 'terminal_open')

    // Finish issuing ticket for actorA
    resolveTerminal({issued: true, fineYuan: DEFAULT_FINE_YUAN.no_helmet, receiptNo: 'GL-K40-1'})
    const resA = await pendingPromise
    assert.equal(resA.ok, true)
    assert.equal(resA.fineYuan, 50)
    assert.equal(actorA.cited, true)
    assert.equal(duty.getSnapshot().hasPendingCitation, false)

    // 4) Same vehicle (actorA) cannot be fined a second time, even if external code resets actorA.cited = false
    actorA.cited = false
    actorB.x = playerPos.x + 12 // move actorB out of [F] range so only actorA is nearby
    const candAfterA = duty.getInteractCandidate()
    assert.notEqual(candAfterA?.action, 'whistle_cite', 'already-cited actorA must not be offered as whistle_cite again')
    assert.equal(candAfterA?.action, 'talk_officer', 'when no uncited violator is nearby near officer, [F] offers off-duty check-in')
    assert.equal(candAfterA?.isOffDutyReport, true)
    const secondTryA = await duty.interceptViolator()
    assert.equal(secondTryA.ok, false)
    assert.equal(secondTryA.reason, 'already_cited')

    // 5) Once actorA's ticket is done, actorB CAN be halted and ticketed normally
    actorB.x = playerPos.x + 1.4
    assert.equal(duty.triggerSignal('flag_stop').ok, true)
    const pB = duty.interceptViolator()
    resolveTerminal({issued: true, fineYuan: DEFAULT_FINE_YUAN.illegal_mod, receiptNo: 'GL-K40-2'})
    const resB = await pB
    assert.equal(resB.ok, true)
    assert.equal(resB.fineYuan, 100)
    assert.equal(duty.getSnapshot().citedCount, 2)
    assert.equal(duty.getSnapshot().totalFineYuan, 150)
  } finally {
    duty.dispose()
    setLeaderboardStorageForTest(null)
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
    'story/script.ts',
    'story/director.ts',
    'story/index.ts',
    'story/dialogue.css',
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
    if (name === 'types.ts') {
      assert.equal(/JIEFANG_BRIDGE_BOUNDS\s*=\s*Object\.freeze/.test(src), false, 'types.ts must delegate bridge deck bounds to jiefang-railings.ts')
    }
    if (name === 'ui.ts') {
      assert.equal(src.includes('rulesHtml.replace'), false, 'ui.ts must not mutate HTML with brittle string replace')
      assert.equal(src.includes('<footer'), false, 'ui.ts must not use <footer> which collides with hud.css fixed footer rule')
      assert.equal(src.includes('data-td-action="start"'), false, 'ui.ts must not expose direct startDuty bypass button')
    }
    if (name === 'ui.css' || name === 'story/dialogue.css') {
      assert.equal(src.includes('--ui-serif'), true)
      assert.equal(/backdrop-filter/.test(src), false, `${name} must use solid jade without backdrop-filter`)
      assert.equal(/PingFang|sans-serif|monospace/.test(src), false, `${name} must stick to --ui-serif only`)
    }
  }
  const catalogSrc = readFileSync('web/src/game/catalog.ts', 'utf8')
  assert.equal(forbidden.test(catalogSrc), false, 'catalog.ts must not contain forbidden compliance words')
})

test('k58 (1/3): on duty & walking on foot, Q and E never shift gears and route exclusively to duty whistle/flag', () => {
  // 1) Pure walk gear resolver: on duty + on foot (even if ride flag is stale) -> Q/E strictly return 0
  assert.equal(
    resolveWalkGearKeyDelta('KeyQ', {dutyActive: true, ridingTwoWheel: true, drivingCar: false, aboard: false}),
    0,
    'KeyQ must not shift down while on duty on foot',
  )
  assert.equal(
    resolveWalkGearKeyDelta('KeyE', {dutyActive: true, ridingTwoWheel: true, drivingCar: false, aboard: false}),
    0,
    'KeyE must not shift up while on duty on foot',
  )
  assert.equal(
    resolveWalkGearKeyDelta('KeyQ', {dutyActive: true, ridingTwoWheel: false, drivingCar: true, aboard: false}),
    0,
    'KeyQ must not shift car mode while on duty on foot',
  )
  assert.equal(
    resolveWalkGearKeyDelta('KeyE', {dutyActive: true, ridingTwoWheel: false, drivingCar: true, aboard: false}),
    0,
    'KeyE must not shift car mode while on duty on foot',
  )

  // Off-duty aboard two-wheeler or car -> Q/E still shift gears normally
  assert.equal(
    resolveWalkGearKeyDelta('KeyE', {dutyActive: false, ridingTwoWheel: true, drivingCar: false, aboard: true}),
    1,
  )
  assert.equal(
    resolveWalkGearKeyDelta('KeyQ', {dutyActive: false, ridingTwoWheel: true, drivingCar: false, aboard: true}),
    -1,
  )
  assert.equal(
    resolveWalkGearKeyDelta('KeyE', {dutyActive: false, ridingTwoWheel: false, drivingCar: true, aboard: true}),
    1,
  )
  assert.equal(
    resolveWalkGearKeyDelta('KeyQ', {dutyActive: false, ridingTwoWheel: false, drivingCar: true, aboard: true}),
    -1,
  )
  assert.equal(shouldSuppressRideGearKey('KeyQ', true), true)
  assert.equal(shouldSuppressRideGearKey('KeyE', true), true)
  assert.equal(shouldSuppressRideGearKey('KeyQ', false), false)

  // 2) Capture-phase keyboard routing: Q/E consumed by dutyKeys while on duty, downstream ride gear listener never fires
  const listeners = {keydown: [], keyup: []}
  const fakeWin = {
    addEventListener(type, fn) {
      listeners[type]?.push(fn)
    },
    removeEventListener(type, fn) {
      const arr = listeners[type]
      if (!arr) return
      const idx = arr.indexOf(fn)
      if (idx >= 0) arr.splice(idx, 1)
    },
  }
  const violator = {
    kind: 'scooter',
    x: 0,
    y: 151.8,
    z: 5,
    yaw: 0,
    speed: 6,
    scale: 1,
    leaving: false,
    violation: 'no_helmet',
    cited: false,
    dutyState: 'normal',
  }
  const dk = createDutyKeysController({
    isDutyActive: () => true,
    getPlayerPos: () => ({x: 0, y: 151.8, z: 0}),
    getPlayerForward: () => ({x: 0, z: 1}),
    getActors: () => [violator],
    ledger: createCitationLedger(),
    sound: false,
  })
  const binding = bindDutyKeyboard(fakeWin, dk, () => true)
  let leakedGearShift = 0
  fakeWin.addEventListener('keydown', ev => {
    if (ev.code === 'KeyQ' || ev.code === 'KeyE') leakedGearShift++
  })

  const dispatch = (type, code) => {
    let stopped = false
    const ev = {
      code,
      repeat: false,
      preventDefault() {},
      stopPropagation() {
        stopped = true
      },
      stopImmediatePropagation() {
        stopped = true
      },
    }
    for (const fn of [...listeners[type]]) {
      fn(ev)
      if (stopped) break
    }
  }

  try {
    dispatch('keydown', 'KeyQ')
    assert.equal(leakedGearShift, 0, 'KeyQ on duty must never leak to ride gear shift listener')
    assert.ok(violator.speed < 6, 'KeyQ whistle slows violator within 12m')

    dispatch('keydown', 'KeyE')
    dispatch('keyup', 'KeyE')
    assert.equal(leakedGearShift, 0, 'KeyE on duty must never leak to ride gear shift listener')
    assert.equal(violator.speed, 0, 'KeyE short press pulls over violator ahead within 8m')
  } finally {
    binding.dispose()
  }
})

test('k58 (2/3): [F] arbiter enforces strict priority handover > fine ticket > talk officer > other interactions', async () => {
  const baseCtx = {
    soloEnabled: true,
    active: true,
    modalOrOverlayBlocked: false,
    crashed: false,
    standingUp: false,
    pickingUpKind: null,
    aboardKind: null,
    inQuietZone: false,
    nearDownedVehicle: null,
    nearTicketHandover: {label: '递交罚单', distance: 1.1, canDeliverNow: true},
    nearTrafficViolator: {label: '拦截开单 · 未戴头盔 ¥50', violation: 'no_helmet', fineYuan: 50, action: 'whistle_cite'},
    nearDutyOfficer: {label: '与解放桥交警对话 · 领取执勤任务', distance: 2.1},
    nearShop: {shopId: 'shop1', brandName: '米粉店', displayName: '米粉店', distance: 1.8},
    nearServiceBay: {shopId: 'svc1', displayName: '保养点', distance: 2.0},
    nearVehicle: {kind: 'bike', downed: false, distance: 1.5},
    nearBoat: {kind: 'free_boat', label: '登船', distance: 2.2},
  }

  // 1) All present -> handover wins
  const d1 = resolveInteraction(baseCtx)
  assert.equal(d1.action, 'handover_ticket')

  // 2) No handover -> fine ticket wins over officer talk & shop/vehicle
  const d2 = resolveInteraction({...baseCtx, nearTicketHandover: null})
  assert.equal(d2.action, 'whistle_cite')

  // 3) No handover, no fine ticket -> talk officer wins over shop/vehicle/boat
  const d3 = resolveInteraction({...baseCtx, nearTicketHandover: null, nearTrafficViolator: null})
  assert.equal(d3.action, 'talk_officer')

  // 4) No duty candidates -> falls through to shop > service > vehicle > boat
  const d4 = resolveInteraction({...baseCtx, nearTicketHandover: null, nearTrafficViolator: null, nearDutyOfficer: null})
  assert.equal(d4.action, 'open_shop')
  const d5 = resolveInteraction({...baseCtx, nearTicketHandover: null, nearTrafficViolator: null, nearDutyOfficer: null, nearShop: null, nearServiceBay: null})
  assert.equal(d5.action, 'mount_vehicle')

  // 5) Arbiter trigger dispatches onHandoverTicket first
  const invoked = []
  let currentCtx = {...baseCtx}
  const arbiter = createInteractArbiter({
    getContext: () => currentCtx,
    onHandoverTicket: () => invoked.push('handover'),
    onWhistleCite: () => invoked.push('cite'),
    onTalkOfficer: () => invoked.push('officer'),
    onOpenShop: () => invoked.push('shop'),
    onOpenService: () => invoked.push('service'),
    onVehicleOrBoatInteract: () => invoked.push('vehicle'),
  })
  try {
    arbiter.trigger()
    currentCtx = {...baseCtx, nearTicketHandover: null}
    arbiter.trigger()
    currentCtx = {...baseCtx, nearTicketHandover: null, nearTrafficViolator: null}
    arbiter.trigger()
    assert.deepEqual(invoked, ['handover', 'cite', 'officer'])
  } finally {
    arbiter.dispose()
  }
})

test('k58 (3/3): 3-way mutual exclusion (knockdown / story / fine terminal), story camera lock & Neon hooks', async () => {
  _resetGameStateForTest()
  const store = createMemStorage()
  setLeaderboardStorageForTest(store)

  const sim = new Traffic(cachedGraph, makeSeededRng(909))
  const track = [...sim.allTracks()].find(t => t.kind === 'nonmotor')
  assert.ok(track)
  const playerPos = {x: JIEFANG_DUTY_ZONE.spot.x - 1.5, y: JIEFANG_DUTY_ZONE.spot.y, z: JIEFANG_DUTY_ZONE.spot.z - 1.0}
  const violator = {
    track,
    dist: 5,
    speed: 4,
    kind: 'scooter',
    down: 0,
    dodge: 0,
    x: playerPos.x + 1.1,
    y: playerPos.y,
    z: playerPos.z,
    yaw: 0,
    scale: 1,
    leaving: false,
    halfWidth: 0.3,
    halfLength: 0.85,
    height: 1.5,
    violation: 'no_helmet',
    vehicleSubtype: 'ebike',
    cited: false,
  }

  let knockedDown = false
  let hitCallback = null
  const knockdownTriggers = []
  const cameraLockLog = []
  const pulledOverLog = []
  const ticketReceivedLog = []
  const handBoneLookups = []
  let resolveTerminal = null
  let terminalDelivering = false
  let confirmDeliverCalls = 0
  const mockHandBone = new THREE.Object3D()
  mockHandBone.name = 'attach_hand_r'

  const duty = createTrafficDutyController({
    getPlayerPos: () => playerPos,
    isWalking: () => true,
    getActors: () => [violator],
    getTraffic: () => sim,
    onCameraControlChange: locked => cameraLockLog.push(locked),
    trafficBridge: {
      getTraffic: () => sim,
      getActors: () => [violator],
      onPlayerHit: cb => {
        hitCallback = cb
        return () => {
          hitCallback = null
        }
      },
      onViolatorPulledOver: (actor, dur) => pulledOverLog.push({actor, dur}),
      onTicketReceived: (actor, receipt) => ticketReceivedLog.push({actor, receipt}),
      getActorHandBone: actor => {
        handBoneLookups.push(actor)
        return mockHandBone
      },
    },
    fineTerminal: {
      openFineTerminal: req => {
        assert.equal(req.violatorObject3D, mockHandBone, 'openFineTerminal must receive Neon actor hand bone')
        return new Promise(resolve => {
          resolveTerminal = resolve
        })
      },
      isDelivering: () => terminalDelivering,
      getTargetActor: () => violator,
      confirmDeliver: () => {
        confirmDeliverCalls++
        return true
      },
    },
    knockdownBridge: {
      triggerKnockdown: (kind, dir, severity) => knockdownTriggers.push({kind, dir, severity}),
      isDown: () => knockedDown,
    },
  })

  try {
    // A) When KNOCKDOWN is active -> neither story nor fine terminal can open
    knockedDown = true
    assert.equal(duty.isKnockdownActive(), true)
    assert.equal(duty.canOpenStory(), false)
    assert.equal(duty.startOfficerBriefing('briefing_intro'), false, 'story must be blocked during knockdown')
    assert.equal(duty.isStoryOpen(), false)
    assert.equal(duty.getInteractCandidate(), null)
    knockedDown = false

    // B) When STORY is active -> camera locks (pausing 3rd-person follow), neither knockdown nor fine terminal can open
    assert.equal(duty.canOpenStory(), true)
    assert.equal(duty.startOfficerBriefing('briefing_intro'), true)
    assert.equal(duty.isStoryOpen(), true)
    assert.equal(duty.isCameraLocked(), true, 'story must lock camera to pause 3rd-person follow')
    assert.equal(duty.canStartKnockdown(), false, 'knockdown must be blocked during story')
    assert.equal(duty.canOpenFineTerminal(), false, 'fine terminal must be blocked during story')
    const citeWhileStory = await duty.interceptViolator()
    assert.equal(citeWhileStory.ok, false)

    // Complete story -> enters active duty & releases camera lock
    assert.equal(duty.skipStory(), true)
    assert.equal(duty.getSnapshot().phase, 'active')
    assert.equal(duty.isCameraLocked(), false, 'camera lock releases cleanly when story closes')
    assert.equal(cameraLockLog[0], true)
    assert.equal(cameraLockLog[cameraLockLog.length - 1], false)

    // While active + KNOCKDOWN -> fine terminal & story both blocked
    knockedDown = true
    assert.equal(duty.canOpenFineTerminal(), false)
    assert.equal(duty.canOpenStory(), false)
    assert.equal(duty.startOfficerBriefing('briefing_repeat'), false)
    assert.equal((await duty.interceptViolator()).reason, 'knockdown_active')
    assert.equal(duty.triggerSignal('whistle').reason, 'knockdown_active')
    knockedDown = false

    // C) When FINE TERMINAL is active -> neither knockdown nor story can open
    const citePromise = duty.interceptViolator()
    assert.equal(duty.isTerminalOpen(), true)
    assert.equal(pulledOverLog.length, 1, 'intercepting violator notifies Neon onViolatorPulledOver')
    assert.equal(handBoneLookups.length, 1, 'intercepting violator queries Neon getActorHandBone')
    assert.equal(duty.canStartKnockdown(), false, 'knockdown must be blocked while fine terminal is open')
    assert.equal(duty.canOpenStory(), false, 'story must be blocked while fine terminal is open')
    assert.equal(duty.startOfficerBriefing('briefing_repeat'), false)

    // Incoming vehicle hit during open fine terminal must NOT trigger knockdown!
    assert.equal(typeof hitCallback, 'function')
    hitCallback(0.9, {x: 1, z: 0})
    assert.equal(knockdownTriggers.length, 0, 'vehicle hit must not trigger knockdown while fine terminal is active')

    // Entering deliver stage prioritizes handover on [F] while still blocking story & knockdown
    terminalDelivering = true
    assert.equal(duty.isHandoverReady(), true)
    assert.equal(duty.canStartKnockdown(), false)
    assert.equal(duty.canOpenStory(), false)
    const handoverCand = duty.getInteractCandidate()
    assert.equal(handoverCand?.action, 'handover_ticket')
    const deliverRes = await duty.interact()
    assert.equal(deliverRes.ok, true)
    assert.equal(deliverRes.action, 'handover_ticket')
    assert.equal(confirmDeliverCalls, 1)
    terminalDelivering = false

    // Resolve issued ticket -> notifies Neon onTicketReceived
    resolveTerminal({issued: true, fineYuan: 50, receiptNo: 'JLQ-K58-0001', plateNo: '桂C·电模1234'})
    const issuedRes = await citePromise
    assert.equal(issuedRes.ok, true)
    assert.equal(ticketReceivedLog.length, 1, 'completed citation notifies Neon onTicketReceived')
    assert.equal(ticketReceivedLog[0].actor, violator)
    assert.equal(ticketReceivedLog[0].receipt?.ticketId, 'JLQ-K58-0001')

    // After terminal finishes -> knockdown can trigger again when hit
    assert.equal(duty.canStartKnockdown(), true)
    hitCallback(0.75, {x: 0, z: 1})
    assert.equal(knockdownTriggers.length, 1)
  } finally {
    duty.dispose()
    setLeaderboardStorageForTest(null)
  }
})

test('d39 & d41 regressions: keyboard Q/E triggers 3D duty gestures & releaseViolator; story camera exit restores exact original FOV', () => {
  _resetGameStateForTest()
  const store = createMemStorage()
  setLeaderboardStorageForTest(store)

  // 1) d41: story.open() modifies camera.fov before next follow() frame; walk/index.ts must keep pre-story FOV and never overwrite restored 55 deg
  const walkSrc = readFileSync('web/src/walk/index.ts', 'utf8')
  assert.equal(
    /if\(externalCam\)\{\s*if\(!wasCameraExternal\)savedExternalFov=camera\.fov/.test(walkSrc),
    false,
    'walk/index.ts must not sample already-narrowed story FOV inside if(externalCam)',
  )
  assert.equal(walkSrc.includes('lastFollowFov=camera.fov'), true, 'walk/index.ts must track lastFollowFov during normal follow frames')
  assert.equal(walkSrc.includes('dutyFlagHoldMode'), true, 'walk/index.ts must preserve active duty flagMode against syncFromEmoteId(0)')

  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.08, 2000)
  cam.position.set(-270, 153.5, 22)
  const playerPos = {x: JIEFANG_DUTY_ZONE.spot.x - 1.4, y: JIEFANG_DUTY_ZONE.spot.y, z: JIEFANG_DUTY_ZONE.spot.z - 1.2}
  const violator = {
    kind: 'scooter',
    x: playerPos.x,
    y: playerPos.y,
    z: playerPos.z - 4.0,
    yaw: 0,
    speed: 6,
    pace: 5.5,
    scale: 1,
    leaving: false,
    violation: 'no_helmet',
    cited: false,
    dutyState: 'normal',
  }

  const gestures = []
  const pulledOver = []
  const released = []
  const flagModes = []
  const fakeProps = {
    whistleGroup: new THREE.Group(),
    flagGroup: new THREE.Group(),
    printerGroup: new THREE.Group(),
    handSlipGroup: new THREE.Group(),
    setVisible() {},
    setWhistleVisible() {},
    setFlagVisible() {},
    setPrinterVisible() {},
    setWhistleAlwaysAtMouth() {},
    setWhistleBlowing() {},
    triggerWhistlePulse() {},
    setFlagMode(m) {
      flagModes.push(m)
    },
    setPrinterMode() {},
    setPrintProgress() {},
    tearOffSlip() {},
    clearHandSlip() {},
    isFlagSuppressedByTicket: () => false,
    syncFromEmoteId() {},
    update() {},
    getProbe: () => ({}),
    dispose() {},
  }

  const duty = createTrafficDutyController(
    {
      getPlayerPos: () => playerPos,
      getPlayerForward: () => ({x: 0, z: -1}),
      isWalking: () => true,
      getActors: () => [violator],
      camera: cam,
      trafficBridge: {
        getActors: () => [violator],
        onViolatorPulledOver: (actor, dur) => {
          pulledOver.push({actor, dur})
          actor.dutyState = 'pulling_over'
          actor.blinker = 'right'
          return true
        },
        releaseViolator: actor => {
          released.push(actor)
          actor.dutyState = 'normal'
          actor.blinker = 'none'
          return true
        },
      },
      propsBridge: {
        playGesture: kind => gestures.push(kind),
        getHandle: () => fakeProps,
      },
    },
    {mountDom: false},
  )

  try {
    // Simulate walk/index.ts follow() FOV guard around story.open() -> story.skip()
    let wasCameraExternal = false
    let lastFollowFov = cam.fov
    const simulateFollowFrame = () => {
      const externalCam = duty.isCameraLocked()
      if (externalCam) {
        wasCameraExternal = true
        return
      }
      if (wasCameraExternal) {
        wasCameraExternal = false
        if (Math.abs(cam.fov - lastFollowFov) > 0.1) {
          cam.fov = lastFollowFov
          cam.updateProjectionMatrix()
        }
      } else {
        lastFollowFov = cam.fov
      }
    }

    simulateFollowFrame()
    assert.equal(lastFollowFov, 55)

    // story.open() immediately narrows FOV before next follow() frame
    assert.equal(duty.startOfficerBriefing('briefing_intro'), true)
    assert.equal(duty.isCameraLocked(), true)
    assert.ok(cam.fov < 52, `story wide shot should narrow FOV, got ${cam.fov}`)
    simulateFollowFrame()
    assert.equal(lastFollowFov, 55, 'externalCam frame must never overwrite lastFollowFov with narrowed story FOV')

    // Complete story -> camRig.end() restores 55, follow() must preserve 55 exactly (0 deg drift)
    assert.equal(duty.skipStory(), true)
    assert.equal(duty.isCameraLocked(), false)
    simulateFollowFrame()
    assert.ok(Math.abs(cam.fov - 55) < 1e-6, `FOV must return to exact 55 after story exit, got ${cam.fov}`)

    // 2) d39: real keyboard path via dutyKeys.handleKeyDown / handleKeyUp / step triggers 3D playGesture + Neon pullOver/release
    const dk = duty.getDutyKeys()
    assert.equal(dk.handleKeyDown('KeyQ', false), true)
    assert.deepEqual(gestures, ['whistle'], 'keyboard KeyQ must trigger whistle gesture once')

    assert.equal(dk.handleKeyDown('KeyE', false), true)
    assert.equal(dk.handleKeyUp('KeyE'), true)
    assert.deepEqual(gestures, ['whistle', 'flag_stop'], 'short KeyE must trigger flag_stop gesture once')
    assert.equal(pulledOver.length, 1, 'short KeyE must call Neon onViolatorPulledOver')
    assert.equal(violator.blinker, 'right')
    assert.equal(flagModes[flagModes.length - 1], 'stop')

    // Long KeyE (>= 0.6s) via duty.step() triggers flag_go gesture + Neon releaseViolator
    assert.equal(dk.handleKeyDown('KeyE', false), true)
    duty.step(0.25)
    duty.step(0.25)
    duty.step(0.2)
    assert.equal(dk.handleKeyUp('KeyE'), true)
    assert.deepEqual(gestures, ['whistle', 'flag_stop', 'flag_go'], 'long KeyE must trigger flag_go gesture once')
    assert.equal(released.length, 1, 'long KeyE must call Neon releaseViolator')
    assert.equal(violator.blinker, 'none')
    assert.equal(flagModes[flagModes.length - 1], 'pass')
  } finally {
    duty.dispose()
    setLeaderboardStorageForTest(null)
  }
})

test('k64 (r8-2): fine rules (50/100/20 + stacked 70), 10% pending commission untouched until officer off-duty check-in, single payout, and duplicate guard', async () => {
  resetSaveForTesting(200)
  const store = createMemStorage()
  setLeaderboardStorageForTest(store)

  // 1) Pure fine calculation & multi-violation stacking
  assert.equal(PLAYER_COMMISSION_RATE, 0.1)
  assert.equal(computeFineYuan('no_helmet'), 50)
  assert.equal(computeFineYuan('bike_double'), 50)
  assert.equal(computeFineYuan('wrong_way'), 50)
  assert.equal(computeFineYuan('red_light_run'), 50)
  assert.equal(computeFineYuan('illegal_mod'), 100)
  assert.equal(computeFineYuan('ebike_overload'), 20)
  assert.equal(computeFineYuan('none'), 0)
  assert.equal(computeFineYuanStack(['ebike_overload', 'no_helmet']), 70)
  assert.equal(computeFineYuanStack(['ebike_overload', 'no_helmet', 'illegal_mod']), 170)
  assert.equal(computeFineYuanStack(['no_helmet', 'no_helmet', 'none']), 50)
  assert.equal(computeFineYuanStack([]), 0)
  assert.equal(computeCommissionYuan(220), 22)
  assert.equal(computeCommissionYuan(70), 7)
  assert.equal(formatViolationStackLabel(['ebike_overload', 'no_helmet']), '电驴超载+未戴头盔')
  assert.deepEqual(
    resolveActorViolations({violation: 'ebike_overload', violations: ['ebike_overload', 'no_helmet', 'ebike_overload']}),
    ['ebike_overload', 'no_helmet'],
  )
  assert.deepEqual(
    resolveActorViolations({violation: 'red_light_run', redLightActive: false}),
    [],
  )

  const sim = new Traffic(cachedGraph, makeSeededRng(2028))
  const track = [...sim.allTracks()].find(t => t.kind === 'nonmotor')
  assert.ok(track)
  const playerPos = {x: JIEFANG_DUTY_ZONE.spot.x - 1.5, y: JIEFANG_DUTY_ZONE.spot.y, z: JIEFANG_DUTY_ZONE.spot.z - 1.0}
  const mkScooter = (dx, extra) => ({
    track,
    dist: 5,
    speed: 4,
    kind: 'scooter',
    down: 0,
    dodge: 0,
    x: playerPos.x + dx,
    y: playerPos.y,
    z: playerPos.z,
    yaw: 0,
    scale: 1,
    leaving: false,
    halfWidth: 0.3,
    halfLength: 0.85,
    height: 1.5,
    vehicleSubtype: 'ebike',
    cited: false,
    ...extra,
  })

  // 3 vehicles: ¥50 (no_helmet) + ¥100 (illegal_mod) + ¥70 (ebike_overload + no_helmet) = ¥220 -> 10% = ¥22
  const v1 = mkScooter(1.2, {violation: 'no_helmet'})
  const v2 = mkScooter(1.8, {violation: 'illegal_mod'})
  const v3 = mkScooter(2.4, {violation: 'ebike_overload', violations: ['ebike_overload', 'no_helmet']})
  const v4 = mkScooter(2.8, {violation: 'illegal_mod'})
  let actors = [v1, v2, v3]
  const openedReqs = []
  let offDutySession = null
  const toasts = []

  const duty = createTrafficDutyController(
    {
      getPlayerPos: () => playerPos,
      isWalking: () => true,
      getActors: () => actors,
      getTraffic: () => sim,
      onToast: text => toasts.push(text),
      fineTerminal: {
        openFineTerminal: async req => {
          openedReqs.push(req)
          return {
            issued: true,
            fineYuan: req.fineYuan,
            violations: req.violations,
            receiptNo: `GL-K64-${openedReqs.length}`,
          }
        },
      },
      onOpenOffDutyStory: (settlement, callbacks) => {
        offDutySession = {settlement, callbacks}
        return true
      },
    },
    {
      mountDom: true,
      mountUi: () => ({
        render() {},
        openPanel() {},
        closePanel() {},
        isPanelOpen: () => false,
        dispose() {},
      }),
    },
  )

  try {
    assert.equal(getState().money, 200, 'starting wallet balance is 200')
    assert.equal(duty.startOfficerBriefing('briefing_intro'), true)
    assert.equal(duty.skipStory(), true)
    assert.equal(duty.getSnapshot().phase, 'active')

    // 2) Issue 3 tickets (50 + 100 + 70 = 220): wallet MUST remain unchanged at 200; pendingEarningsYuan === 22
    const r1 = await duty.interceptViolator()
    assert.equal(r1.ok, true)
    assert.equal(r1.fineYuan, 50)
    assert.equal(getState().money, 200)

    const r2 = await duty.interceptViolator()
    assert.equal(r2.ok, true)
    assert.equal(r2.fineYuan, 100)
    assert.equal(getState().money, 200)

    const r3 = await duty.interceptViolator()
    assert.equal(r3.ok, true)
    assert.equal(r3.fineYuan, 70)
    assert.deepEqual(r3.violations, ['ebike_overload', 'no_helmet'])
    assert.deepEqual(openedReqs[2].violations, ['ebike_overload', 'no_helmet'])
    assert.equal(openedReqs[2].violationLabel, '电驴超载+未戴头盔')
    assert.equal(openedReqs[2].fineYuan, 70)

    const midSnap = duty.getSnapshot()
    assert.equal(midSnap.citedCount, 3)
    assert.equal(midSnap.totalFineYuan, 220)
    assert.equal(midSnap.pendingEarningsYuan, 22, 'pendingEarningsYuan must equal totalFineYuan * 10%')
    assert.equal(midSnap.settledEarningsYuan, 0)
    assert.equal(midSnap.stackedCitationCount, 1)
    assert.equal(getState().money, 200, 'player wallet must remain untouched after issuing 3 tickets before off-duty check-in')

    const preSettlement = duty.getShiftSettlement()
    assert.equal(preSettlement.citedCount, 3)
    assert.equal(preSettlement.totalFineYuan, 220)
    assert.equal(preSettlement.commissionRate, 0.1)
    assert.equal(preSettlement.pendingEarningsYuan, 22)
    assert.equal(preSettlement.earningsYuan, 22)
    assert.equal(preSettlement.stackedCitationCount, 1)
    assert.equal(preSettlement.settled, false)

    // 3) Duplicate citation guard: same stacked vehicle v3 cannot be fined a second time
    v3.cited = false
    const dupRes = await duty.interceptViolator()
    assert.equal(dupRes.ok, false)
    assert.equal(dupRes.reason, 'already_cited')
    assert.equal(duty.getSnapshot().totalFineYuan, 220)
    assert.equal(getState().money, 200)

    // 4) Bounds warning with mounted UI avoids duplicate host.onToast ghosting (d45/k59 regression)
    const toastCountBeforeClamp = toasts.length
    const clampedRes = duty.clampPlayerPos({x: -420, y: 151.7, z: -60})
    assert.equal(clampedRes.clamped, true)
    assert.equal(clampedRes.warning, JIEFANG_DUTY_BOUNDS_WARNING)
    assert.equal(toasts.length, toastCountBeforeClamp, 'mounted UI uses .td-bounds-banner without duplicate walk:toast')

    // 5) Check out off-duty with officer via [F]: opens off-duty dialogue -> wallet STILL 200 until onSettled()
    const offDutyCand = duty.getInteractCandidate()
    assert.ok(offDutyCand)
    assert.equal(offDutyCand.action, 'talk_officer')
    assert.equal(offDutyCand.isOffDutyReport, true)
    const talkOffRes = await duty.interact()
    assert.equal(talkOffRes.ok, true)
    assert.equal(talkOffRes.action, 'talk_officer')
    assert.ok(offDutySession, 'off-duty story must open with ShiftSettlement')
    assert.equal(offDutySession.settlement.totalFineYuan, 220)
    assert.equal(offDutySession.settlement.pendingEarningsYuan, 22)
    assert.equal(duty.isStoryOpen(), true)
    assert.equal(getState().money, 200, 'wallet must not be credited before off-duty onSettled fires')

    // Complete off-duty dialogue -> wallet increases ONCE by 22 (200 -> 222), pendingEarningsYuan resets to 0
    offDutySession.callbacks.onSettled()
    assert.equal(getState().money, 222, 'wallet must increase by 10% commission (22) upon officer off-duty check-in')
    const afterSettle = duty.getSnapshot()
    assert.equal(afterSettle.phase, 'summary')
    assert.equal(afterSettle.pendingEarningsYuan, 0)
    assert.equal(afterSettle.settledEarningsYuan, 22)
    assert.equal(duty.getShiftSettlement().settled, true)

    // Idempotency guard: re-invoking onSettled or completeOffDutySettlement MUST NOT double-pay
    offDutySession.callbacks.onSettled()
    const secondSettle = duty.completeOffDutySettlement()
    assert.equal(secondSettle.alreadySettled, true)
    assert.equal(secondSettle.creditedYuan, 0)
    assert.equal(getState().money, 222, 'repeated off-duty settlement must never double-credit wallet')

    // 6) Direct abandonDuty() without reporting to officer MUST NOT credit wallet
    actors = [v4]
    assert.equal(duty.startOfficerBriefing('briefing_repeat'), true)
    assert.equal(duty.skipStory(), true)
    const r4 = await duty.interceptViolator()
    assert.equal(r4.ok, true)
    assert.equal(r4.fineYuan, 100)
    assert.equal(duty.getSnapshot().pendingEarningsYuan, 10)
    assert.equal(getState().money, 222)
    const abandonSnap = duty.abandonDuty()
    assert.equal(abandonSnap.phase, 'summary')
    assert.equal(abandonSnap.pendingEarningsYuan, 0)
    assert.equal(abandonSnap.settledEarningsYuan, 0)
    assert.equal(getState().money, 222, 'abandonDuty without officer check-in must not credit wallet')
  } finally {
    duty.dispose()
    setLeaderboardStorageForTest(null)
  }

  // 7) Real Hy1 story.openOffDuty integration (no mock hook): real off_duty beat recites stats & pays wallet ONCE on completion
  const realStoryStore = createMemStorage()
  setLeaderboardStorageForTest(realStoryStore)
  const v5 = mkScooter(1.5, {violation: 'ebike_overload', violations: ['ebike_overload', 'no_helmet']})
  const realDuty = createTrafficDutyController({
    getPlayerPos: () => playerPos,
    isWalking: () => true,
    getActors: () => [v5],
    getTraffic: () => sim,
    fineTerminal: {
      openFineTerminal: async req => ({
        issued: true,
        fineYuan: req.fineYuan,
        violations: req.violations,
        receiptNo: 'GL-K64-REAL-1',
      }),
    },
  })
  try {
    assert.equal(realDuty.startOfficerBriefing('briefing_intro'), true)
    assert.equal(realDuty.skipStory(), true)
    const issued = await realDuty.interceptViolator()
    assert.equal(issued.ok, true)
    assert.equal(issued.fineYuan, 70)
    assert.equal(realDuty.getSnapshot().pendingEarningsYuan, 7)
    assert.equal(getState().money, 222, 'wallet stays 222 before real off_duty story settles')

    // [F] near officer opens real Hy1 off_duty story beat
    const offRes = await realDuty.interact()
    assert.equal(offRes.ok, true)
    assert.equal(offRes.action, 'talk_officer')
    assert.equal(realDuty.isStoryOpen(), true)
    assert.equal(realDuty.getStorySnapshot().beatId, 'off_duty')
    assert.equal(getState().money, 222, 'wallet stays 222 while real off_duty story is open')

    // Completing real off_duty story triggers onSettled ONCE -> wallet 222 -> 229, pending -> 0
    assert.equal(realDuty.skipStory(), true)
    assert.equal(realDuty.isStoryOpen(), false)
    assert.equal(realDuty.getSnapshot().phase, 'summary')
    assert.equal(realDuty.getSnapshot().pendingEarningsYuan, 0)
    assert.equal(realDuty.getSnapshot().settledEarningsYuan, 7)
    assert.equal(getState().money, 229, 'real story.openOffDuty onSettled credits 10% commission (7) exactly once')
    assert.equal(realDuty.completeOffDutySettlement().alreadySettled, true)
    assert.equal(getState().money, 229)
  } finally {
    realDuty.dispose()
    setLeaderboardStorageForTest(null)
  }
})

function createMockBrowserDom() {
  const listeners = new Map()
  const allById = new Map()
  const makeNode = tag => {
    const classes = new Set()
    const attrs = new Map()
    const nodeListeners = new Map()
    const node = {
      tagName: String(tag).toUpperCase(),
      children: [],
      parentNode: null,
      hidden: false,
      disabled: false,
      open: false,
      type: '',
      value: '',
      style: {},
      dataset: new Proxy(
        {},
        {
          set(target, prop, val) {
            target[prop] = String(val)
            const attrName = 'data-' + String(prop).replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)
            attrs.set(attrName, String(val))
            return true
          },
          deleteProperty(target, prop) {
            delete target[prop]
            const attrName = 'data-' + String(prop).replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)
            attrs.delete(attrName)
            return true
          },
        },
      ),
      _id: '',
      get id() {
        return this._id
      },
      set id(v) {
        this._id = String(v)
        if (this._id) allById.set(this._id, node)
      },
      _textContent: '',
      get textContent() {
        if (this.children.length === 0) return this._textContent
        return this._textContent + this.children.map(c => c.textContent).join('')
      },
      set textContent(v) {
        this._textContent = String(v ?? '')
        this.children.length = 0
      },
      innerHTML: '',
      get className() {
        return [...classes].join(' ')
      },
      set className(v) {
        classes.clear()
        for (const tok of String(v).split(/\s+/).filter(Boolean)) classes.add(tok)
      },
      classList: {
        add: (...toks) => toks.forEach(t => t && classes.add(t)),
        remove: (...toks) => toks.forEach(t => classes.delete(t)),
        toggle: (t, force) => {
          const next = force !== undefined ? Boolean(force) : !classes.has(t)
          if (next) classes.add(t)
          else classes.delete(t)
          return next
        },
        contains: t => classes.has(t),
      },
      setAttribute(k, v) {
        attrs.set(k, String(v))
      },
      getAttribute(k) {
        return attrs.get(k) ?? null
      },
      hasAttribute(k) {
        return attrs.has(k)
      },
      append(...nodes) {
        for (const n of nodes) {
          if (n && typeof n === 'object') {
            n.parentNode = node
            node.children.push(n)
          }
        }
      },
      appendChild(child) {
        if (child && typeof child === 'object') {
          child.parentNode = node
          node.children.push(child)
        }
        return child
      },
      replaceChildren(...nodes) {
        node.children.length = 0
        node._textContent = ''
        node.append(...nodes)
      },
      remove() {
        if (node.parentNode) {
          const idx = node.parentNode.children.indexOf(node)
          if (idx >= 0) node.parentNode.children.splice(idx, 1)
          node.parentNode = null
        }
      },
      addEventListener(type, fn) {
        if (!nodeListeners.has(type)) nodeListeners.set(type, [])
        nodeListeners.get(type).push(fn)
      },
      removeEventListener(type, fn) {
        const arr = nodeListeners.get(type)
        if (!arr) return
        const idx = arr.indexOf(fn)
        if (idx >= 0) arr.splice(idx, 1)
      },
      getContext() {
        return null
      },
      showModal() {
        node.open = true
      },
      close() {
        node.open = false
      },
      closest() {
        return null
      },
      querySelector(sel) {
        return node.querySelectorAll(sel)[0] ?? null
      },
      querySelectorAll(sel) {
        const matches = []
        const visit = cur => {
          for (const ch of cur.children) {
            if (matchesSelector(ch, sel)) matches.push(ch)
            visit(ch)
          }
        }
        visit(node)
        return matches
      },
    }
    return node
  }
  const matchesSelector = (el, sel) => {
    const s = sel.trim()
    const attrEq = s.match(/^\[([a-zA-Z0-9-]+)="([^"]*)"\]$/)
    if (attrEq) return el.getAttribute(attrEq[1]) === attrEq[2]
    const attrHas = s.match(/^\[([a-zA-Z0-9-]+)\]$/)
    if (attrHas) return el.hasAttribute(attrHas[1])
    if (s.startsWith('.')) return el.classList.contains(s.slice(1))
    return el.tagName === s.toUpperCase()
  }
  const head = makeNode('head')
  const body = makeNode('body')
  const doc = {
    head,
    body,
    activeElement: null,
    pointerLockElement: null,
    exitPointerLock() {},
    createElement: tag => makeNode(tag),
    getElementById: id => allById.get(id) ?? null,
    querySelector: sel => body.querySelector(sel),
    querySelectorAll: sel => body.querySelectorAll(sel),
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(fn)
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type)
      if (!arr) return
      const idx = arr.indexOf(fn)
      if (idx >= 0) arr.splice(idx, 1)
    },
  }
  return {doc, body}
}

test('k77 (r9): HUD实时显示开单数/罚款合计/待领10%（50+100+20+70=240->24），数罪并罚罚单DOM逐项展示，下岗交差一次入账且清零', async () => {
  resetSaveForTesting(200)
  const store = createMemStorage()
  setLeaderboardStorageForTest(store)

  assert.equal(formatViolationFormula(['ebike_overload', 'no_helmet']), '¥20+¥50=¥70')
  assert.equal(formatViolationBreakdownFormula(['ebike_overload', 'no_helmet']), '电驴超载¥20+未戴头盔¥50=¥70')

  const {doc, body} = createMockBrowserDom()
  const prevDoc = globalThis.document
  globalThis.document = doc
  // The global [F] prompt (walk/vehicles.ts) as the interact arbiter leaves it when it picks the officer.
  const fPrompt = doc.createElement('button')
  fPrompt.className = 'vehicle-action'
  fPrompt.dataset.interactAction = 'talk_officer'
  body.append(fPrompt)

  const sim = new Traffic(cachedGraph, makeSeededRng(2029))
  const track = [...sim.allTracks()].find(t => t.kind === 'nonmotor')
  assert.ok(track)
  const playerPos = {x: JIEFANG_DUTY_ZONE.spot.x - 1.4, y: JIEFANG_DUTY_ZONE.spot.y, z: JIEFANG_DUTY_ZONE.spot.z - 0.8}
  const mkScooter = (dx, extra) => ({
    track,
    dist: 5,
    speed: 4,
    kind: 'scooter',
    down: 0,
    dodge: 0,
    x: playerPos.x + dx,
    y: playerPos.y,
    z: playerPos.z,
    yaw: 0,
    scale: 1,
    leaving: false,
    halfWidth: 0.3,
    halfLength: 0.85,
    height: 1.5,
    vehicleSubtype: 'ebike',
    cited: false,
    ...extra,
  })

  // 4 tickets: 50 + 100 + 20 + 70 = 240 -> 10% pending = 24 (all within 1.5m handover range)
  const t50 = mkScooter(0.8, {violation: 'no_helmet'})
  const t100 = mkScooter(1.0, {violation: 'illegal_mod'})
  const t20 = mkScooter(1.2, {violation: 'ebike_overload'})
  const t70 = mkScooter(1.4, {violation: 'ebike_overload', violations: ['ebike_overload', 'no_helmet']})
  const actors = [t50, t100, t20, t70]
  const toasts = []
  const capturedTerminalDomTexts = []
  const ledger = createCitationLedger()

  const duty = createTrafficDutyController(
    {
      getPlayerPos: () => playerPos,
      isWalking: () => true,
      getActors: () => actors,
      getTraffic: () => sim,
      projectToScreen: () => ({x: 640, y: 280, visible: true}),
      mountContainer: body,
      onToast: msg => toasts.push(msg),
      fineTerminal: {
        openFineTerminal: async req => {
          const session = createFineTerminalSession({
            headless: false,
            sound: false,
            actor: req.actor,
            violation: req.violation,
            violations: req.violations,
            fineYuan: req.fineYuan,
            zoneName: req.zoneName,
            ledger,
            printDurationSec: 0.1,
            deliverDurationSec: 0,
            getPlayerPos: () => playerPos,
          })
          const mountedOverlay = mountFineTerminalOverlay(session, {
            headless: false,
            sound: false,
            mountContainer: body,
            actor: req.actor,
            violation: req.violation,
            violations: req.violations,
          })
          // Capture DOM across input -> printing -> deliver for the stacked ticket
          const readTerminalDom = () => {
            const termEl = body.querySelector('.td-fine-terminal')
            return {
              fullText: termEl?.textContent ?? '',
              stackBanner: termEl?.querySelector('[data-td-stacked-banner="1"]')?.textContent ?? '',
              overloadRow: termEl?.querySelector('[data-td-fine-item="ebike_overload"]')?.textContent ?? '',
              noHelmetRow: termEl?.querySelector('[data-td-fine-item="no_helmet"]')?.textContent ?? '',
              totalRow: termEl?.querySelector('[data-td-fine-total="1"]')?.textContent ?? '',
            }
          }
          const inputDom = readTerminalDom()
          session.confirmInput()
          mountedOverlay.updateDom()
          session.step(0.05)
          mountedOverlay.updateDom()
          const printingDom = readTerminalDom()
          session.step(0.1)
          mountedOverlay.updateDom()
          const deliverDom = readTerminalDom()
          if ((req.violations?.length ?? 0) > 1) {
            capturedTerminalDomTexts.push({inputDom, printingDom, deliverDom})
          }
          session.confirmDeliver()
          const res = await session.result
          mountedOverlay.cleanup()
          return res
        },
      },
    },
    {mountDom: true, mountUi: mountTrafficDutyUi},
  )

  try {
    assert.equal(getState().money, 200)
    assert.equal(duty.startOfficerBriefing('briefing_intro'), true)
    assert.equal(duty.skipStory(), true)
    assert.equal(duty.getSnapshot().phase, 'active')

    // Issue 50, 100, 20 first
    assert.equal((await duty.interceptViolator()).fineYuan, 50)
    assert.equal((await duty.interceptViolator()).fineYuan, 100)
    assert.equal((await duty.interceptViolator()).fineYuan, 20)

    // Before issuing 70 (stacked ebike_overload + no_helmet): halt toast & [F] candidate MUST show 数罪并罚 + ¥20+¥50=¥70
    const halt70 = duty.triggerSignal('whistle')
    assert.equal(halt70.ok, true)
    assert.equal(
      toasts.some(t => t.includes('数罪并罚') && t.includes('电驴超载¥20+未戴头盔¥50=¥70')),
      true,
      'halting stacked violator must show 数罪并罚 with itemized ¥20+¥50=¥70',
    )
    const cand70 = duty.getInteractCandidate()
    assert.ok(cand70)
    assert.equal(cand70.action, 'whistle_cite')
    assert.equal(cand70.fineYuan, 70)
    assert.equal(cand70.label.includes('数罪并罚'), true)
    assert.equal(cand70.label.includes('电驴超载¥20+未戴头盔¥50=¥70'), true)

    // Issue 70 ticket -> verify real FineTerminal DOM contains 数罪并罚 and itemized ¥20 / ¥50 / ¥70 in all phases
    const res70 = await duty.interceptViolator()
    assert.equal(res70.ok, true)
    assert.equal(res70.fineYuan, 70)
    assert.equal(capturedTerminalDomTexts.length, 1)
    const {inputDom, printingDom, deliverDom} = capturedTerminalDomTexts[0]
    for (const domSnap of [inputDom, printingDom, deliverDom]) {
      assert.equal(domSnap.stackBanner, '数罪并罚 · ¥20+¥50=¥70')
      assert.equal(domSnap.overloadRow, '电驴超载¥20')
      assert.equal(domSnap.noHelmetRow, '未戴头盔¥50')
      assert.equal(domSnap.totalRow, '数罪并罚合计（2项）¥70')
      assert.equal(domSnap.fullText.includes('数罪并罚'), true)
    }

    // Verify HUD DOM real-time stats: count=4, fine=240, pending 10%=24, wallet UNCHANGED at 200
    const snapAfter4 = duty.getSnapshot()
    assert.equal(snapAfter4.citedCount, 4)
    assert.equal(snapAfter4.totalFineYuan, 240)
    assert.equal(snapAfter4.pendingEarningsYuan, 24)
    assert.equal(getState().money, 200, 'wallet must NOT increase before off-duty check-in')

    const barEl = body.querySelector('[data-td-bar="1"]')
    assert.ok(barEl && !barEl.hidden, 'active HUD bar must be visible')
    assert.equal(barEl.querySelector('[data-td-stat="count"]')?.textContent, '开单 4 单')
    assert.equal(barEl.querySelector('[data-td-stat="fine"]')?.textContent, '罚款 ¥240')
    const earnEl = barEl.querySelector('[data-td-stat="earnings"]')
    assert.equal(earnEl?.textContent, '待领10% ¥24')
    assert.equal(earnEl?.classList.contains('is-nonzero'), true)
    // IDOK-468: next to the officer the [F] prompt is the only 下岗交差 — bar button and overhead marker step aside.
    const reportBarBtn = barEl.querySelector('[data-td-action="report-off-duty"]')
    assert.equal(reportBarBtn?.textContent, '下岗交差')
    assert.equal(reportBarBtn?.hidden, true, 'bar 下岗交差 yields to the [F] prompt within talking range')
    // When the arbiter gives [F] to something else (下车 / 上车), the bar button is the only 下岗交差 left, so it stays.
    fPrompt.dataset.interactAction = 'dismount'
    duty.step(0.016)
    assert.equal(reportBarBtn?.hidden, false, 'bar 下岗交差 stays while [F] shows another action')
    fPrompt.dataset.interactAction = 'talk_officer'
    duty.step(0.016)
    assert.equal(reportBarBtn?.hidden, true)

    const markerEl = body.querySelector('[data-td-officer-marker="1"]')
    assert.ok(markerEl && markerEl.hidden, 'overhead officer marker yields to the [F] prompt within talking range')

    // Walk to officer -> [F] shows 「下岗交差」 -> real Hy1 openOffDuty -> settles ONCE (+24) and zeros pending
    const offCand = duty.getInteractCandidate()
    assert.ok(offCand)
    assert.equal(offCand.action, 'talk_officer')
    assert.equal(offCand.isOffDutyReport, true)
    assert.equal(offCand.label.includes('下岗交差'), true)
    assert.equal(offCand.label, '下岗交差 ¥24')

    const openOff = await duty.interact()
    assert.equal(openOff.ok, true)
    assert.equal(duty.isStoryOpen(), true)
    assert.equal(duty.getStorySnapshot().beatId, 'off_duty')
    assert.equal(getState().money, 200, 'wallet remains 200 while openOffDuty dialogue is open')

    assert.equal(duty.skipStory(), true)
    assert.equal(getState().money, 224, 'wallet increases ONCE by 24 (240 * 10%) after off-duty settlement')
    assert.equal(duty.getSnapshot().pendingEarningsYuan, 0)
    assert.equal(duty.getSnapshot().settledEarningsYuan, 24)
    assert.equal(duty.getSnapshot().phase, 'summary')

    // Re-settling is strictly idempotent
    const again = duty.completeOffDutySettlement()
    assert.equal(again.alreadySettled, true)
    assert.equal(again.creditedYuan, 0)
    assert.equal(getState().money, 224)
  } finally {
    duty.dispose()
    setLeaderboardStorageForTest(null)
    globalThis.document = prevDoc
  }
})

test('k9: 模拟页面刷新后再开同金额班次仍正常到账（shiftNonce 防跨刷新撞键）、左手递单完整记 handedSide=left、HUD 与 types.ts 单源公式一致', async () => {
  // 1) Cross-reload same-amount shift payout test with persistent glol.save.v1 + real module re-import (globalShiftUid resets to 0)
  const persistedSaveStore = createMemStorage()
  const lbStore = createMemStorage()
  setSaveStorageForTest(persistedSaveStore)
  setLeaderboardStorageForTest(lbStore)
  resetSaveForTesting(200, persistedSaveStore)

  const sim1 = new Traffic(cachedGraph, makeSeededRng(3101))
  const track1 = [...sim1.allTracks()].find(t => t.kind === 'nonmotor')
  assert.ok(track1)
  const playerPos = {x: JIEFANG_DUTY_ZONE.spot.x - 1.4, y: JIEFANG_DUTY_ZONE.spot.y, z: JIEFANG_DUTY_ZONE.spot.z - 0.8}
  const makeScooter = (track, dx, extra) => ({
    track,
    dist: 5,
    speed: 0,
    kind: 'scooter',
    down: 0,
    dodge: 0,
    x: playerPos.x + dx,
    y: playerPos.y,
    z: playerPos.z,
    yaw: 0,
    scale: 1,
    leaving: false,
    halfWidth: 0.3,
    halfLength: 0.85,
    height: 1.5,
    vehicleSubtype: 'ebike',
    cited: false,
    ...extra,
  })

  // Shift 1 (pre-reload): 2 tickets = ¥50 + ¥50 = ¥100 -> 10% = ¥10
  const shift1Actors = [
    makeScooter(track1, 0.9, {violation: 'no_helmet'}),
    makeScooter(track1, 1.2, {violation: 'wrong_way'}),
  ]
  const duty1 = createTrafficDutyController({
    getPlayerPos: () => playerPos,
    isWalking: () => true,
    getActors: () => shift1Actors,
    getTraffic: () => sim1,
    fineTerminal: {
      openFineTerminal: async req => ({
        issued: true,
        fineYuan: req.fineYuan,
        violations: req.violations,
        receiptNo: `GL-K9-S1-${req.violation}`,
      }),
    },
  })

  try {
    assert.equal(getState().money, 200)
    assert.equal(duty1.startOfficerBriefing('briefing_intro'), true)
    assert.equal(duty1.skipStory(), true)
    assert.equal((await duty1.interceptViolator()).fineYuan, 50)
    assert.equal((await duty1.interceptViolator()).fineYuan, 50)
    assert.equal(duty1.getSnapshot().totalFineYuan, 100)
    assert.equal(duty1.getSnapshot().pendingEarningsYuan, computeCommissionYuan(100))
    assert.equal(getState().money, 200)

    const off1 = await duty1.interact()
    assert.equal(off1.ok, true)
    assert.equal(duty1.skipStory(), true)
    assert.equal(getState().money, 210, 'pre-reload shift 1 must credit +10 (200 -> 210)')
    assert.equal(duty1.getSnapshot().pendingEarningsYuan, 0)
  } finally {
    duty1.dispose()
  }

  const savedAfterShift1 = JSON.parse(persistedSaveStore.getItem(SAVE_STORAGE_KEY))
  assert.equal(savedAfterShift1.money, 210)
  assert.equal(savedAfterShift1.economy.txHistoryRing.length, 1)
  const shift1TxKey = savedAfterShift1.economy.txHistoryRing[0].idempotencyKey
  assert.ok(shift1TxKey.startsWith('traffic_duty_settle:'), `unexpected key ${shift1TxKey}`)

  // Simulate true page reload: fresh module evaluation resets in-memory `globalShiftUid` back to 0,
  // while `localStorage['glol.save.v1']` keeps Shift 1's money (210) and txHistoryRing!
  const reloaded = await import(`${pathToFileURL(bundleFile).href}?k9reload=${Date.now()}`)
  reloaded.setSaveStorageForTest(persistedSaveStore)
  reloaded.setLeaderboardStorageForTest(lbStore)
  const loaded = reloaded.loadLocalSave(persistedSaveStore)
  assert.equal(loaded.save.money, 210)
  assert.equal(reloaded.getState().money, 210)

  const sim2 = new reloaded.Traffic(cachedGraph, makeSeededRng(3102))
  const track2 = [...sim2.allTracks()].find(t => t.kind === 'nonmotor')
  assert.ok(track2)
  // Shift 2 (post-reload): EXACT SAME amount/count (2 tickets = ¥100 -> 10% = ¥10)
  const shift2Actors = [
    makeScooter(track2, 0.9, {violation: 'no_helmet'}),
    makeScooter(track2, 1.2, {violation: 'wrong_way'}),
  ]
  const duty2 = reloaded.createTrafficDutyController({
    getPlayerPos: () => playerPos,
    isWalking: () => true,
    getActors: () => shift2Actors,
    getTraffic: () => sim2,
    fineTerminal: {
      openFineTerminal: async req => ({
        issued: true,
        fineYuan: req.fineYuan,
        violations: req.violations,
        receiptNo: `GL-K9-S2-${req.violation}`,
      }),
    },
  })

  try {
    assert.equal(duty2.startOfficerBriefing('briefing_intro'), true)
    assert.equal(duty2.skipStory(), true)
    assert.equal((await duty2.interceptViolator()).fineYuan, 50)
    assert.equal((await duty2.interceptViolator()).fineYuan, 50)
    assert.equal(duty2.getSnapshot().totalFineYuan, 100)
    assert.equal(duty2.getSnapshot().pendingEarningsYuan, 10)
    assert.equal(reloaded.getState().money, 210, 'wallet stays 210 before post-reload off-duty settlement')

    const off2 = await duty2.interact()
    assert.equal(off2.ok, true)
    assert.equal(duty2.skipStory(), true)

    assert.equal(
      reloaded.getState().money,
      220,
      'post-reload identical-amount shift MUST credit +10 > 0 via unique shiftNonce (210 -> 220)',
    )
    assert.equal(duty2.getSnapshot().pendingEarningsYuan, 0)
    assert.equal(duty2.getSnapshot().settledEarningsYuan, 10)

    // Intra-shift duplicate settlement remains strictly idempotent
    const dupSettle = duty2.completeOffDutySettlement()
    assert.equal(dupSettle.alreadySettled, true)
    assert.equal(dupSettle.creditedYuan, 0)
    assert.equal(reloaded.getState().money, 220)

    const savedAfterShift2 = JSON.parse(persistedSaveStore.getItem(SAVE_STORAGE_KEY))
    assert.equal(savedAfterShift2.money, 220)
    assert.equal(savedAfterShift2.economy.txHistoryRing.length, 2)
    assert.notEqual(
      savedAfterShift2.economy.txHistoryRing[1].idempotencyKey,
      shift1TxKey,
      'post-reload shiftNonce must produce distinct idempotencyKey',
    )
  } finally {
    duty2.dispose()
    reloaded.setSaveStorageForTest(null)
    reloaded.setLeaderboardStorageForTest(null)
  }

  // 2) Left-hand handover full controller -> fine-terminal -> receipt-model -> trafficBridge pipeline
  //    + HUD & stacked formula consistency against types.ts single source of truth
  const {doc, body} = createMockBrowserDom()
  const prevDoc = globalThis.document
  globalThis.document = doc
  setSaveStorageForTest(null)
  resetSaveForTesting(200)
  setLeaderboardStorageForTest(createMemStorage())

  const violatorRoot = new THREE.Group()
  violatorRoot.position.set(playerPos.x + 1.0, playerPos.y, playerPos.z)
  const leftBone = new THREE.Bone()
  leftBone.name = 'attach_hand_l'
  // Place left hand closer to player (world x = playerPos.x + 0.65) and right hand farther (world x = playerPos.x + 1.35)
  leftBone.position.set(-0.35, 1.05, 0)
  const rightBone = new THREE.Bone()
  rightBone.name = 'attach_hand_r'
  rightBone.position.set(0.35, 1.05, 0)
  violatorRoot.add(leftBone, rightBone)
  violatorRoot.updateMatrixWorld(true)

  const leftTarget = makeScooter(track1, 1.0, {
    violation: 'ebike_overload',
    violations: ['ebike_overload', 'no_helmet'],
  })
  // Second left-hand actor exercising controller fallback attachReceiptToViolator when existingHeld is not pre-mounted
  const leftFallbackTarget = makeScooter(track1, 1.2, {
    violation: 'illegal_mod',
  })
  const fallbackLeftBone = new THREE.Bone()
  fallbackLeftBone.name = 'attach_hand_l'
  const fallbackRightBone = new THREE.Bone()
  fallbackRightBone.name = 'attach_hand_r'
  const receivedReceipts = []
  const queriedBoneSides = []
  const localLedger = createCitationLedger()

  const dutyLeft = createTrafficDutyController(
    {
      getPlayerPos: () => playerPos,
      isWalking: () => true,
      getActors: () => [leftTarget, leftFallbackTarget],
      getTraffic: () => sim1,
      mountContainer: body,
      trafficBridge: {
        getTraffic: () => sim1,
        getActors: () => [leftTarget, leftFallbackTarget],
        getActorHandBone: (actor, side) => {
          queriedBoneSides.push({actor, side})
          if (actor === leftFallbackTarget) return side === 'left' ? fallbackLeftBone : fallbackRightBone
          return side === 'left' ? leftBone : rightBone
        },
        onTicketReceived: (actor, receipt) => {
          receivedReceipts.push({actor, receipt})
        },
      },
      fineTerminal: {
        openFineTerminal: async req => {
          if (req.actor === leftFallbackTarget) {
            return {
              issued: true,
              fineYuan: req.fineYuan,
              violations: req.violations,
              handedSide: 'left',
              receiptNo: 'GL-K9-LEFT-FALLBACK',
              citationRecord: {
                ticketId: 'GL-K9-LEFT-FALLBACK',
                vehicleKey: 'veh:left-fallback',
                plateNo: '桂C·电模9998',
                violation: 'illegal_mod',
                violations: ['illegal_mod'],
                violationLabel: '非法改装',
                fineYuan: req.fineYuan,
                officerBadgeId: 'GL-JLQ-01',
                qrPayload: 'GLOL-SIM://DUTY/GL-K9-LEFT-FALLBACK',
                zoneName: '解放桥',
                note: '',
                issuedAtMs: Date.now(),
                heldInHand: true,
                handedSide: 'left',
              },
            }
          }
          const session = createFineTerminalSession({
            headless: false,
            sound: false,
            actor: req.actor,
            violation: req.violation,
            violations: req.violations,
            fineYuan: req.fineYuan,
            zoneName: req.zoneName,
            ledger: localLedger,
            printDurationSec: 0.1,
            deliverDurationSec: 0,
            getPlayerPos: () => playerPos,
            violatorObject3D: violatorRoot,
            getActorHandBone: (actor, side) => (side === 'left' ? leftBone : rightBone),
          })
          const overlay = mountFineTerminalOverlay(session, {
            headless: false,
            sound: false,
            mountContainer: body,
            actor: req.actor,
            violation: req.violation,
            violations: req.violations,
          })
          const bannerText = body.querySelector('[data-td-stacked-banner="1"]')?.textContent ?? ''
          assert.equal(
            bannerText,
            `数罪并罚 · ${formatViolationFormula(['ebike_overload', 'no_helmet'])}`,
            'fine-terminal DOM stacked formula must match types.ts formatViolationFormula',
          )
          session.confirmInput()
          session.step(0.2)
          assert.equal(session.confirmDeliver(), true)
          const res = await session.result
          overlay.cleanup()
          return res
        },
      },
    },
    {mountDom: true, mountUi: mountTrafficDutyUi},
  )

  try {
    assert.equal(dutyLeft.startOfficerBriefing('briefing_intro'), true)
    assert.equal(dutyLeft.skipStory(), true)

    // Verify arbiter candidate label matches types.ts formatViolationBreakdownFormula
    const cand = dutyLeft.getInteractCandidate()
    assert.equal(
      cand?.label,
      `拦截开单 · 数罪并罚 ${formatViolationBreakdownFormula(['ebike_overload', 'no_helmet'])}`,
    )

    // Ticket 1: left-hand handover through real FineTerminalSession
    const res1 = await dutyLeft.interceptViolator()
    assert.equal(res1.ok, true)
    assert.equal(res1.fineYuan, computeFineYuanStack(['ebike_overload', 'no_helmet']))
    assert.equal(res1.handedSide, 'left', 'WhistleCiteResult must record handedSide="left"')
    const held1 = getViolatorHeldReceipt(leftTarget)
    assert.ok(held1)
    assert.equal(held1.side, 'left', 'held receipt attachment side must be left')
    assert.equal(held1.mountedNode, leftBone, 'receipt must mount on left hand bone')
    assert.equal(held1.record.handedSide, 'left', 'citation record must persist handedSide="left"')
    assert.equal(receivedReceipts[0].receipt?.handedSide, 'left')
    assert.equal(leftBone.children.some(c => c.name === 'duty-receipt-slip'), true)
    assert.equal(rightBone.children.some(c => c.name === 'duty-receipt-slip'), false)

    // Ticket 2: controller fallback attachReceiptToViolator preserves left side instead of defaulting to right
    const res2 = await dutyLeft.interceptViolator()
    assert.equal(res2.ok, true)
    assert.equal(res2.fineYuan, DEFAULT_FINE_YUAN.illegal_mod)
    assert.equal(res2.handedSide, 'left', 'controller fallback attach must preserve handedSide="left"')
    const held2 = getViolatorHeldReceipt(leftFallbackTarget)
    assert.ok(held2)
    assert.equal(held2.side, 'left')
    assert.equal(held2.mountedNode, fallbackLeftBone)
    assert.equal(receivedReceipts[1].receipt?.handedSide, 'left')
    assert.equal(
      queriedBoneSides.some(q => q.actor === leftFallbackTarget && q.side === 'left'),
      true,
      'controller must query trafficBridge.getActorHandBone(actor, "left")',
    )

    // Verify HUD pending earnings matches types.ts computeCommissionYuan(70 + 100 = 170) === 17
    const expectedTotal = computeFineYuanStack(['ebike_overload', 'no_helmet']) + DEFAULT_FINE_YUAN.illegal_mod
    const expectedPending = computeCommissionYuan(expectedTotal)
    assert.equal(expectedTotal, 170)
    assert.equal(expectedPending, 17)
    const barEl = body.querySelector('[data-td-bar="1"]')
    assert.equal(barEl?.querySelector('[data-td-stat="fine"]')?.textContent, `罚款 ¥${expectedTotal}`)
    assert.equal(barEl?.querySelector('[data-td-stat="earnings"]')?.textContent, `待领10% ¥${expectedPending}`)
  } finally {
    dutyLeft.dispose()
    setLeaderboardStorageForTest(null)
    setSaveStorageForTest(null)
    globalThis.document = prevDoc
  }
})
