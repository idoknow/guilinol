import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {gunzipSync} from 'node:zlib'
import {isPointInQuietZone} from '../game/quiet-zones.ts'
import {getState, _resetGameStateForTest} from '../game/state.ts'
import {getLatestTraffic, stopActor, Traffic} from '../traffic/sim.ts'
import {createTrafficDutyController} from './controller.ts'
import {
  mergeTrafficDutyDecision,
  resolveTrafficDutyCandidate,
} from './arbiter.ts'
import {
  createLocalLeaderboardProvider,
  loadLocalLeaderboard,
  setLeaderboardStorageForTest,
  TRAFFIC_DUTY_LEADERBOARD_CORRUPT_KEY,
  TRAFFIC_DUTY_LEADERBOARD_KEY,
} from './leaderboard.ts'
import {
  DEFAULT_FINE_YUAN,
  formatDutyReportTitle,
  JIEFANG_DUTY_ZONE,
  TRAFFIC_DUTY_DURATION_SEC,
} from './types.ts'

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
  const graph = JSON.parse(gunzipSync(readFileSync('public/world/roads/graph.json.gz')).toString('utf8'))
  const sim = new Traffic(graph, makeSeededRng(101))
  const allTracks = [...sim.allTracks()]
  const realNonmotor = allTracks.filter(t => !t.walk && t.kind === 'nonmotor' && !t.virtual)
  const jiefangNonmotor = realNonmotor.filter(t => t.gradeSeparated === 'jiefang')
  const jiefangVirtual = allTracks.filter(t => !t.walk && t.kind === 'nonmotor' && t.virtual && t.gradeSeparated === 'jiefang')
  const virtualNonmotor = allTracks.filter(t => !t.walk && t.kind === 'nonmotor' && t.virtual)

  assert.equal(realNonmotor.length, 906)
  assert.equal(jiefangNonmotor.length, 17)
  assert.equal(jiefangVirtual.length, 0, 'Jiefang Bridge already has 17 real nonmotor lanes and must not duplicate virtual ones')
  assert.ok(virtualNonmotor.length > 1000, 'major motor roads lacking cycleways should get virtual right-edge nonmotor fallback')

  // None of the 906 real nonmotor tracks enter campus quiet zones
  for (const t of realNonmotor) {
    const mx = (t.start.x + t.end.x) * 0.5
    const mz = (t.start.z + t.end.z) * 0.5
    assert.equal(isPointInQuietZone(mx, mz), false, `nonmotor lane ${t.id} should stay outside quiet zones`)
  }
})

test('sim.ts prefers real nonmotor > virtual nonmotor > motor for scooters, keeps cars off nonmotor, and deduplicates Phase 2 coverage', () => {
  // Synthetic corridor with:
  //  - Street A (from 1->2->3): motor only -> gets virtual right-edge nonmotor fallback
  //  - Street B (from 4->5->6): motor + parallel real nonmotor (10->11->12, 6m right) -> NO duplicate virtual track
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

test('sim.ts duty mode spawns weighted 3 violation types on Jiefang Bridge and stopActor halts then resumes', () => {
  const graph = JSON.parse(gunzipSync(readFileSync('public/world/roads/graph.json.gz')).toString('utf8'))
  const sim = new Traffic(graph, makeSeededRng(777))
  sim.setDutyConfig({
    active: true,
    center: JIEFANG_DUTY_ZONE.center,
    radius: JIEFANG_DUTY_ZONE.radiusM,
    weights: {none: 10, no_helmet: 40, ebike_overload: 30, bike_double: 20},
    twoWheelShare: 0.7,
  })

  const cam = {x: -168, y: 152, z: 40}
  for (let i = 0; i < 60; i++) {
    sim.step(0.05, cam)
  }

  const scooters = sim.actors.filter(a => a.kind === 'scooter')
  assert.ok(scooters.length >= 6, `expected >=6 scooters in Jiefang duty mode, got ${scooters.length}`)
  const seen = new Set(scooters.map(s => s.violation))
  assert.ok(seen.has('no_helmet') && seen.has('ebike_overload') && seen.has('bike_double'), `missing violation types: ${[...seen]}`)
  for (const s of scooters) {
    if (s.violation === 'bike_double') assert.equal(s.vehicleSubtype, 'bicycle')
    if (s.violation === 'no_helmet' || s.violation === 'ebike_overload') assert.equal(s.vehicleSubtype, 'ebike')
  }

  // Pick a scooter and call stopActor(actor, 3)
  const target = scooters.find(s => s.violation !== 'none')
  assert.ok(target)
  target.speed = 5
  sim.step(0.05, cam)
  const ok = stopActor(target, 3.0)
  assert.equal(ok, true)
  const frozenX = target.x
  const frozenZ = target.z
  for (let i = 0; i < 40; i++) {
    sim.step(0.05, cam)
    assert.equal(target.speed, 0)
    assert.equal(target.x, frozenX)
    assert.equal(target.z, frozenZ)
  }
  // Advance past 3.0s stop duration (another 35 ticks = 1.75s, total 3.75s)
  for (let i = 0; i < 35; i++) {
    sim.step(0.05, cam)
  }
  assert.equal(target.stoppedUntil, undefined)
  assert.ok(target.speed > 0 || Math.hypot(target.x - frozenX, target.z - frozenZ) > 0, 'actor resumes moving after stop duration')
})

test('[F] arbiter yields to priority 0-4 locks, wins over mount/none within 3.5-4.5m, and rejects duplicate/vertical/compliant actors', () => {
  const dummyTrack = {
    id: 1, from: 1, to: 2, offset: 0, kind: 'nonmotor', speedKmh: 20,
    start: {id: 1, x: 0, y: 152, z: 0}, end: {id: 2, x: 100, y: 152, z: 0},
    dx: 1, dz: 0, yaw: Math.PI / 2, length: 100, walk: false,
  }
  const makeScooter = (overrides) => ({
    track: dummyTrack, dist: 10, speed: 4, kind: 'scooter', down: 0, dodge: 0,
    x: 0, y: 152, z: 0, yaw: 0, scale: 1, leaving: false, halfWidth: 0.3, halfLength: 0.85, height: 1.5,
    violation: 'no_helmet', vehicleSubtype: 'ebike', cited: false,
    ...overrides,
  })

  const player = {x: 0, y: 152, z: 0}
  const actors = [
    makeScooter({x: 2.0, z: 0, violation: 'none'}), // compliant -> ignored
    makeScooter({x: 2.2, z: 0, violation: 'ebike_overload', cited: true}), // already cited -> ignored
    makeScooter({x: 2.4, y: 145, z: 0, violation: 'ebike_overload'}), // under-bridge -> ignored
    makeScooter({x: 5.5, z: 0, violation: 'ebike_overload'}), // > 4.2m -> out of range
    makeScooter({x: 3.8, z: 0, violation: 'bike_double', vehicleSubtype: 'bicycle'}), // valid within 4.2m!
  ]

  const cand = resolveTrafficDutyCandidate(true, {active: true}, actors, player, 4.2, DEFAULT_FINE_YUAN)
  assert.ok(cand)
  assert.equal(cand.violation, 'bike_double')
  assert.equal(cand.fineYuan, 30)
  assert.equal(cand.action, 'whistle_cite')

  // Blocked by aboard / downed / shop / modal
  assert.equal(resolveTrafficDutyCandidate(true, {active: true, aboardKind: 'bike'}, actors, player), null)
  assert.equal(resolveTrafficDutyCandidate(true, {active: true, modalOrOverlayBlocked: true}, actors, player), null)
  assert.equal(resolveTrafficDutyCandidate(true, {active: true, nearShop: {shopId: 's1'}}, actors, player), null)
  assert.equal(resolveTrafficDutyCandidate(true, {active: true, nearDownedVehicle: {kind: 'bike'}}, actors, player), null)

  // Merging with base interact-arbiter decisions
  const p4Shop = {priority: 4, action: 'open_shop', label: '进店', disabled: false, shopId: 's1'}
  assert.equal(mergeTrafficDutyDecision(p4Shop, cand).action, 'open_shop', 'Priority 4 shop beats whistle')

  const p5Mount = {priority: 5, action: 'mount_vehicle', label: '骑电动车', disabled: false}
  const merged = mergeTrafficDutyDecision(p5Mount, cand)
  assert.equal(merged.action, 'whistle_cite', 'Whistle overrides roadside mount (Priority 5)')
  assert.equal(merged.label, '吹哨劝导 · 单车双载 ¥30')
})

test('controller + leaderboard handle 10-min shift, anti-farm cited guard, IDOK-153 zero-penalty, localStorage Top-N & corrupt/quota resilience', () => {
  _resetGameStateForTest()
  const store = createMemStorage()
  setLeaderboardStorageForTest(store)

  // Corrupt JSON backup test
  store.setItem(TRAFFIC_DUTY_LEADERBOARD_KEY, '{broken_json')
  const corruptRecovered = loadLocalLeaderboard()
  assert.equal(corruptRecovered.entries.length, 0)
  assert.equal(store.getItem(TRAFFIC_DUTY_LEADERBOARD_CORRUPT_KEY), '{broken_json')

  const graph = JSON.parse(gunzipSync(readFileSync('public/world/roads/graph.json.gz')).toString('utf8'))
  const sim = new Traffic(graph, makeSeededRng(2026))
  const playerPos = {x: -168, y: 152, z: 40}
  const duty = createTrafficDutyController({
    getPlayerPos: () => playerPos,
    isWalking: () => true,
    getTraffic: () => sim,
    getPlayerName: () => '桂林志愿者',
  })

  try {
    assert.equal(duty.getSnapshot().durationSec, TRAFFIC_DUTY_DURATION_SEC)
    assert.equal(duty.getSnapshot().inDutyZone, true)

    duty.startDuty()
    assert.equal(duty.getSnapshot().phase, 'active')
    assert.equal(sim.getDutyConfig().active, true)

    // Inject 3 violators within whistle range (20 + 30 + 50 = 100)
    const dummyTrack = [...sim.allTracks()].find(t => t.kind === 'nonmotor')
    assert.ok(dummyTrack)
    const mk = (violation, vehicleSubtype, dx) => ({
      track: dummyTrack, dist: 5, speed: 5, kind: 'scooter', down: 0, dodge: 0,
      x: playerPos.x + dx, y: playerPos.y, z: playerPos.z, yaw: 0, scale: 1, leaving: false,
      halfWidth: 0.3, halfLength: 0.85, height: 1.5, violation, vehicleSubtype, cited: false,
    })
    const a1 = mk('no_helmet', 'ebike', 2.0)
    const a2 = mk('bike_double', 'bicycle', 3.0)
    const a3 = mk('ebike_overload', 'ebike', 3.9)
    sim.actors.push(a1, a2, a3)

    const r1 = duty.triggerWhistle()
    assert.equal(r1.ok, true)
    assert.equal(r1.fineYuan, 20)
    assert.equal(a1.cited, true)

    // Move away from a2/a3 and ensure a1 cannot be cited twice
    playerPos.x = -166.5
    a2.x = 0
    a3.x = 0
    const dupAttempt = duty.triggerWhistle()
    assert.equal(dupAttempt.ok, false)
    assert.equal(dupAttempt.reason, 'already_cited')

    // Cite a2 (¥30) and a3 (¥50)
    a2.x = playerPos.x + 1.5
    const r2 = duty.triggerWhistle()
    assert.equal(r2.ok, true)
    assert.equal(r2.fineYuan, 30)

    a3.x = playerPos.x + 2.2
    const r3 = duty.triggerWhistle()
    assert.equal(r3.ok, true)
    assert.equal(r3.fineYuan, 50)

    const snap = duty.getSnapshot()
    assert.equal(snap.totalFineYuan, 100)
    assert.equal(snap.citedCount, 3)
    assert.deepEqual(snap.breakdown, {no_helmet: 1, bike_double: 1, ebike_overload: 1})

    // IDOK-153 invariant: player wallet and wanted untouched
    assert.equal(getState().wanted, 0)
    assert.equal(getState().money, 200)

    // Advance 600s -> automatic completion & leaderboard persistence
    for (let i = 0; i < 2400; i++) {
      duty.step(0.25)
    }
    const endSnap = duty.getSnapshot()
    assert.equal(endSnap.phase, 'summary')
    assert.equal(endSnap.remainingSec, 0)
    assert.equal(endSnap.reportTitle, formatDutyReportTitle(100))
    assert.equal(endSnap.lastRecordRank, 1)
    assert.equal(endSnap.isNewRecord, true)
    assert.equal(sim.getDutyConfig().active, false)

    const lb = duty.getLeaderboard()
    assert.equal(lb.bestFineYuan, 100)
    assert.equal(lb.entries[0].playerName, '桂林志愿者')

    // QuotaExceededError resilience
    const quotaStore = createMemStorage({quotaFailCount: 1})
    setLeaderboardStorageForTest(quotaStore)
    const provider = createLocalLeaderboardProvider()
    const rec = provider.record({
      playerName: '新纪录',
      totalFineYuan: 250,
      citedCount: 6,
      breakdown: {no_helmet: 2, bike_double: 1, ebike_overload: 3},
      durationSec: 600,
      completed: true,
      achievedAt: Date.now(),
    })
    assert.equal(rec.summary.bestFineYuan, 250)
    assert.ok(quotaStore.map.has(TRAFFIC_DUTY_LEADERBOARD_KEY))
  } finally {
    duty.dispose()
    setLeaderboardStorageForTest(null)
  }
})

test('design-rules & hotkey compliance: zero private KeyF, zero emojis, zero gradients, single --ui-serif font', () => {
  const dir = new URL('./', import.meta.url)
  const files = ['types.ts', 'leaderboard.ts', 'whistle.ts', 'arbiter.ts', 'controller.ts', 'ui.ts', 'ui.css', 'index.ts']
  for (const name of files) {
    const src = readFileSync(new URL(name, dir), 'utf8')
    assert.equal(/event\.code\s*===?\s*['"]KeyF['"]/.test(src), false, `${name} must not bind private KeyF listener`)
    assert.equal(/linear-gradient|radial-gradient/.test(src), false, `${name} must not use gradients`)
    assert.equal(/小贴士|Tip\b/.test(src), false, `${name} must not contain tip slogans`)
    assert.equal(/\p{Emoji_Presentation}/u.test(src), false, `${name} must not contain emojis`)
    if (name === 'ui.css') {
      assert.equal(src.includes('--ui-serif'), true)
      assert.equal(/PingFang|sans-serif|monospace/.test(src), false, 'ui.css must stick to --ui-serif only')
    }
  }
})
