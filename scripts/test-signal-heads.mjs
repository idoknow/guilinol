// IDOK-399 — unit tests for the city signal heads: which approaches get one, where the pole stands,
// which way it faces, and that the lenses show what the signal source says.
// Run: node --import tsx --test scripts/test-signal-heads.mjs   (part of `npm run verify:signal-heads`)
import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import {test} from 'node:test'
import {gunzipSync} from 'node:zlib'
import * as THREE from 'three'
import {approachHeight, placeSignalHead, signalApproaches} from '../web/src/traffic/signal-approach.ts'
import {LANDMARK_SIGNAL_GROUPS, signalHeads} from '../web/src/traffic/signal-heads.ts'
import {SIGNAL_DRIVER_RANK, SIGNAL_LENS_HEX, citySignalClock, citySignals} from '../web/src/traffic/signals.ts'

const ROAD = 0, SIDEWALK = 1, GREEN = 4, GUARDRAIL = 5

// A crossroads at the origin. Node 100 is the signal; 101 is a second node of the same junction.
// West arm: two lanes driving east into 100. North arm: one lane driving south into 100.
const graph = {
  nodes: [
    {id: 100, x: 0, y: 150, z: 0}, {id: 101, x: 0, y: 150, z: 6},
    {id: 1, x: -60, y: 152, z: 0}, {id: 2, x: 0, y: 150, z: -40}, {id: 3, x: 60, y: 150, z: 0},
    {id: 4, x: 0, y: 158, z: 50},
  ],
  lanes: [
    {id: 10, from: 1, to: 100, offset: -1.5, kind: 'motor', cls: 'primary', heights: [0, 152, .5, 151, 1, 150]},
    {id: 11, from: 1, to: 100, offset: 1.5, kind: 'motor', cls: 'primary', heights: [0, 152, .5, 151, 1, 150]},
    {id: 12, from: 2, to: 100, offset: 0, kind: 'motor', cls: 'residential'},
    {id: 13, from: 100, to: 3, offset: 0, kind: 'motor', cls: 'primary'}, // drives away: no head
    {id: 14, from: 101, to: 100, offset: 0, kind: 'motor', cls: 'primary'}, // link inside the junction: no head
    {id: 15, from: 3, to: 100, offset: 0, kind: 'nonmotor', cls: 'primary'}, // cycle lane: no head
    {id: 16, from: 3, to: 100, offset: 0, kind: 'motor', cls: 'primary'}, // not in any phase: no head
    {id: 17, from: 4, to: 100, offset: 0, kind: 'motor', cls: 'trunk', gradeSeparated: 'linear'}, // viaduct: no head
  ],
  signals: [
    {node: 100, group: 7, offset: 0, phases: [{lanes: [10, 11, 15], green: 18, yellow: 3}, {lanes: [12, 14, 17], green: 18, yellow: 3}]},
    {node: 101, group: 7, offset: 0, phases: [{lanes: [], green: 18, yellow: 3}]},
  ],
}

// Street surface for that crossroads: both roads 10 m wide, corners cut at 45° over 7 m, pavement elsewhere.
function crossroads(x, z) {
  const ax = Math.abs(x), az = Math.abs(z)
  if (ax <= 5 || az <= 5) return [ROAD]
  if (ax + az <= 17) return [ROAD]
  return [SIDEWALK]
}

test('signalApproaches: one per carriageway driving into the junction, nothing else', () => {
  const approaches = signalApproaches(graph)
  assert.deepEqual(approaches.map(approach => approach.key), ['1>100', '2>100'])
  const [west, north] = approaches
  assert.deepEqual(west.lanes, [10, 11])
  assert.equal(west.path.length, 1)
  assert.equal(west.path[0].right, 1.5, 'the rightmost lane decides where the kerb search starts')
  assert.deepEqual([west.path[0].headingX, west.path[0].headingZ, west.reach], [1, 0, 60])
  assert.deepEqual([north.path[0].headingX, north.path[0].headingZ, north.reach], [0, 1, 40])
  assert.equal(west.group, 7)
  assert.deepEqual(signalApproaches(graph, new Set([7])), [], 'landmark junctions are skipped by group')
  assert.deepEqual(signalApproaches({...graph, signals: []}), [])
})

test('approachHeight follows the lane height profile', () => {
  const [west, north] = signalApproaches(graph)
  assert.equal(approachHeight(west, 0), 150)
  assert.equal(approachHeight(west, 30), 151)
  assert.equal(approachHeight(west, 45), 151.5)
  assert.equal(approachHeight(west, 500), 152, 'clamped to the lane start')
  assert.equal(approachHeight(north, 12), 150, 'no profile: the node height')
})

test('placeSignalHead: on the kerb to the driver\'s right, past the corner, facing oncoming traffic', () => {
  const [west, north] = signalApproaches(graph)
  const head = placeSignalHead(west, crossroads)
  assert.equal(typeof head, 'object')
  // Heading east, so the driver's right is +z. The corner cut ends 12 m before the node.
  assert.ok(head.back >= 9 && head.back <= 15, `back ${head.back}`)
  assert.ok(head.z > 5 && head.z < 8, `z ${head.z}`)
  assert.ok(!crossroads(head.x, head.z).includes(ROAD), 'the pole is off the carriageway')
  assert.equal(head.x, -head.back)
  assert.ok(Math.abs(head.y - approachHeight(west, head.back)) < 1e-9)
  // Local +Z (the lens side) must point back along the lane, local +X towards the kerb side.
  const faceX = Math.sin(head.yaw), faceZ = Math.cos(head.yaw), sideX = Math.cos(head.yaw), sideZ = -Math.sin(head.yaw)
  assert.ok(Math.abs(faceX + 1) < 1e-9 && Math.abs(faceZ) < 1e-9, 'faces west, towards drivers heading east')
  assert.ok(Math.abs(sideX) < 1e-9 && Math.abs(sideZ - 1) < 1e-9)
  // The arm reaches back over the road and ends above the rightmost lane.
  assert.ok(head.arm >= 3 && head.arm <= 6.5, `arm ${head.arm}`)
  assert.ok(Math.abs(head.z - head.arm - 1.5) < 1e-9, 'arm tip over the centre of the rightmost lane')

  const post = placeSignalHead(north, crossroads)
  assert.equal(post.arm, 0, 'small roads get the head on the pole')
  assert.ok(post.x < -5 && !crossroads(post.x, post.z).includes(ROAD), 'heading south, the right is −x')
  assert.ok(Math.abs(Math.cos(post.yaw) + 1) < 1e-9, 'faces north')
})

test('placeSignalHead: waits for missing tiles, gives up where there is no kerb', () => {
  const [west] = signalApproaches(graph)
  assert.equal(placeSignalHead(west, () => undefined), 'pending')
  assert.equal(placeSignalHead(west, (x, z) => x < -10 ? undefined : crossroads(x, z)), 'pending', 'a half-loaded neighbourhood is not final')
  assert.equal(placeSignalHead(west, () => [ROAD]), 'none', 'a square with no kerb in reach')
  assert.equal(placeSignalHead(west, () => []), 'none', 'a bridge deck: the lane itself is not on street surface')
  assert.equal(placeSignalHead(west, () => [SIDEWALK]), 'none')
})

test('placeSignalHead: dividers and fences inside the road are not kerbs', () => {
  const [west] = signalApproaches(graph)
  // A fenced 0.5 m divider at z 3.5–4, a painted 0.5 m verge at z 6–6.5, the real kerb at z 9.
  const divided = (x, z) => {
    if (Math.abs(x) <= 5) return [ROAD]
    if (z >= 3.5 && z < 4) return [ROAD, GUARDRAIL].slice(1)
    if (z >= 6 && z < 6.5) return [GREEN]
    return Math.abs(z) < 9 ? [ROAD] : [SIDEWALK]
  }
  const head = placeSignalHead(west, divided)
  assert.equal(typeof head, 'object')
  assert.ok(head.z >= 9.5 && head.z <= 10.5, `pole behind the real kerb, z ${head.z}`)
  assert.equal(head.arm, 6.5, 'arm length is capped')
})

// A short last link into the signal, fed by a road that bends away: 4 m due east into node 200, and
// before that 60 m coming in at `bend` degrees. The road surface is everything within 5 m of that line.
function bentRoad(bend, extra = {nodes: [], lanes: []}) {
  const angle = bend * Math.PI / 180, far = {x: -4 - 60 * Math.cos(angle), z: -60 * Math.sin(angle)}
  const road = {
    nodes: [{id: 200, x: 0, y: 150, z: 0}, {id: 21, x: -4, y: 150, z: 0}, {id: 22, x: far.x, y: 156, z: far.z}, ...extra.nodes],
    lanes: [
      {id: 30, from: 21, to: 200, offset: 0, kind: 'motor', cls: 'primary'},
      {id: 31, from: 22, to: 21, offset: 1.5, kind: 'motor', cls: 'primary', heights: [0, 156, 1, 150]},
      {id: 32, from: 22, to: 21, offset: -1.5, kind: 'motor', cls: 'primary', heights: [0, 156, 1, 150]},
      ...extra.lanes,
    ],
    signals: [{node: 200, group: 8, offset: 0, phases: [{lanes: [30], green: 18, yellow: 3}]}, ...(extra.signals ?? [])],
  }
  const fromLine = (x, z) => {
    const toSegment = (ax, az, bx, bz) => {
      const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)))
      return Math.hypot(x - ax - t * (bx - ax), z - az - t * (bz - az))
    }
    return Math.min(toSegment(far.x, far.z, -4, 0), toSegment(-4, 0, 0, 0))
  }
  return {road, fromLine, surface: (x, z) => fromLine(x, z) <= 5 ? [ROAD] : [SIDEWALK]}
}

test('short approaches: the kerb search follows the road that feeds them, never a line projected past the lane', () => {
  const {road, fromLine, surface} = bentRoad(20)
  const [approach] = signalApproaches(road)
  assert.equal(approach.path.length, 2, 'the 4 m link plus the road feeding it')
  assert.ok(Math.abs(approach.reach - 64) < 1e-9)
  assert.equal(approach.path[1].right, 1.5, 'the feeding road has its own rightmost lane')
  const head = placeSignalHead(approach, surface)
  assert.equal(typeof head, 'object')
  assert.ok(head.back > 4, 'further back than the link is long')
  const off = fromLine(head.x, head.z)
  assert.ok(off > 5.5 && off < 6.5, `pole just behind the kerb of the real road, ${off.toFixed(2)} m from its centre line`)
  const angle = 20 * Math.PI / 180
  assert.ok(Math.abs(Math.sin(head.yaw) + Math.cos(angle)) < 1e-9 && Math.abs(Math.cos(head.yaw) + Math.sin(angle)) < 1e-9, 'faces drivers on the feeding road')
  // Right of a driver heading (cos, sin) is (−sin, cos).
  const along = head.back - 4, laneX = -4 - along * Math.cos(angle), laneZ = -along * Math.sin(angle)
  assert.ok(Math.abs((head.x - laneX) * -Math.sin(angle) + (head.z - laneZ) * Math.cos(angle) - off) < 1e-6, 'on the driver\'s right')
  assert.ok(Math.abs(head.arm - (off - 1.5)) < 1e-6, 'arm tip over the rightmost lane of the feeding road')
  assert.ok(Math.abs(head.y - (150 + along / 60 * 6)) < 1e-9, 'height from the feeding road\'s profile')
  assert.ok(Math.abs(approachHeight(approach, 500) - 156) < 1e-9, 'clamped to the far end of the path')

  // Nothing unambiguous to follow: the approach stays as short as its own lane and gets no head.
  const stops = [
    ['a sharp bend', bentRoad(40)],
    ['a merge of two roads', bentRoad(10, {nodes: [{id: 23, x: -60, y: 150, z: 8}], lanes: [{id: 33, from: 23, to: 21, offset: 0, kind: 'motor', cls: 'primary'}]})],
    ['another signal upstream', bentRoad(10, {nodes: [], lanes: [], signals: [{node: 21, group: 9, offset: 0, phases: [{lanes: [31, 32], green: 18, yellow: 3}]}]})],
    ['a viaduct upstream', (() => { const bent = bentRoad(10); for (const lane of bent.road.lanes) if (lane.from === 22) lane.gradeSeparated = 'linear'; return bent })()],
  ]
  for (const [why, {road: other, surface: otherSurface}] of stops) {
    const short = signalApproaches(other).find(candidate => candidate.key === '21>200')
    assert.equal(short.path.length, 1, why)
    assert.equal(short.reach, 4, why)
    assert.equal(placeSignalHead(short, otherSurface), 'none', `${why}: too short for a pole, and not extended in a straight line`)
  }
})

test('placeSignalHead with progress: a few distances per call, same answer, missing tiles do not restart the scan', () => {
  const [west] = signalApproaches(graph)
  const whole = placeSignalHead(west, crossroads)
  let lookups = 0, worst = 0, calls = 0
  const progress = {back: 0}
  let result
  do {
    lookups = 0
    result = placeSignalHead(west, (x, z) => { lookups++; return crossroads(x, z) }, progress)
    worst = Math.max(worst, lookups); calls++
  } while (result === 'more')
  assert.deepEqual(result, whole)
  assert.ok(calls > 1, 'the scan was spread over several calls')
  // No kerb anywhere is the most expensive case.
  const square = {back: 0}
  let squareCalls = 0
  do {
    lookups = 0
    result = placeSignalHead(west, () => { lookups++; return [ROAD] }, square)
    worst = Math.max(worst, lookups); squareCalls++
  } while (result === 'more')
  assert.equal(result, 'none')
  assert.ok(worst <= 300, `at most ${worst} surface lookups in one call`)
  assert.ok(squareCalls >= 9, 'the full range takes several calls')

  // Tiles west of x = −12 are missing: the scan stops there and picks up at the same distance later.
  const waiting = {back: 0}
  const halfLoaded = (x, z) => x < -12 ? undefined : crossroads(x, z)
  do result = placeSignalHead(west, halfLoaded, waiting); while (result === 'more')
  assert.equal(result, 'pending')
  const reached = waiting.back
  assert.ok(reached >= 9, `got as far as ${reached} m before the missing tile`)
  const backs = []
  do result = placeSignalHead(west, (x, z) => { if (z === 1.5) backs.push(-x); return crossroads(x, z) }, waiting); while (result === 'more')
  assert.deepEqual(result, whole)
  assert.ok(Math.min(...backs) >= reached, 'distances already ruled out are not looked at again')
})

test('signal heads mesh: two draw calls, lenses follow the signal source, buffers only touched on change', () => {
  citySignals.add(graph.signals)
  citySignalClock.reset(0)
  const driver = citySignalClock.driver(SIGNAL_DRIVER_RANK.street)
  const scene = new THREE.Scene()
  const heads = signalHeads(scene, crossroads)
  assert.equal(scene.children.length, 1)
  assert.equal(heads.group.children.length, 2, 'poles + lenses: two draw calls for the whole town')
  assert.ok(heads.group.children.every(mesh => mesh.layers.mask === 1 << 3), 'main-detail layer')
  const [poles, lenses] = heads.group.children
  heads.setApproaches(signalApproaches(graph))
  assert.equal(heads.probe().heads.length, 0, 'nothing is placed until the first update')
  for (let frame = 0; frame < 40; frame++) { driver.advance(.05); heads.update(.05, {x: 0, z: 0}) }
  let probe = heads.probe()
  assert.deepEqual([probe.total, probe.pending, probe.none, probe.heads.length], [2, 0, 0, 2])
  assert.equal(probe.visible, true)
  assert.deepEqual(probe.heads.map(head => [head.key, head.shown, head.truth]), [['1>100', 'green', 'green'], ['2>100', 'red', 'red']])
  assert.ok(poles.geometry.drawRange.count > 0 && lenses.geometry.drawRange.count === 2 * 3 * 12 * 3)

  // Where the lit lens actually is: above the rightmost lane, on the side facing oncoming traffic.
  const west = probe.heads[0], position = lenses.geometry.getAttribute('position'), colour = lenses.geometry.getAttribute('color')
  const lit = new THREE.Color(SIGNAL_LENS_HEX.green.lit), centre = new THREE.Vector3(), vertex = new THREE.Vector3()
  let count = 0
  for (let index = 0; index < 108; index++) {
    if (Math.abs(colour.getX(index) - lit.r) + Math.abs(colour.getY(index) - lit.g) + Math.abs(colour.getZ(index) - lit.b) > 1e-4) continue
    centre.add(vertex.fromBufferAttribute(position, index)); count++
  }
  assert.equal(count, 36, 'exactly one lens of the head is lit')
  centre.divideScalar(count)
  assert.ok(Math.abs(centre.z - 1.5) < .05, `lens over the lane centre, z ${centre.z}`)
  assert.ok(centre.x < west.x - .1 && centre.x > west.x - .5, 'lens on the face towards oncoming drivers')
  assert.ok(centre.y > west.y + 5 && centre.y < west.y + 6, `green is the bottom lens, y ${centre.y - west.y}`)
  // Every pole vertex stays between the pole and the arm tip: the stretch moved the head, not the pole.
  const polePosition = poles.geometry.getAttribute('position')
  let minZ = Infinity, maxZ = -Infinity
  for (let index = 0; index < poles.geometry.drawRange.count; index++) {
    vertex.fromBufferAttribute(polePosition, index)
    if (Math.abs(vertex.x - west.x) > 1) continue
    minZ = Math.min(minZ, vertex.z); maxZ = Math.max(maxZ, vertex.z)
  }
  assert.ok(Math.abs(maxZ - (west.z + .11)) < .02 && Math.abs(minZ - (west.z - west.arm - .25)) < .02, `arm spans ${minZ}..${maxZ}`)

  // No change in the lights: no buffer upload.
  const version = colour.version
  for (let frame = 0; frame < 100; frame++) { driver.advance(.05); heads.update(.05, {x: 0, z: 0}) }
  assert.equal(colour.version, version, 'colour buffer is untouched while no light changes')
  // Through a whole cycle the buffer always equals the source.
  const seen = new Set()
  for (let frame = 0; frame < 900; frame++) {
    driver.advance(.05); heads.update(.05, {x: 0, z: 0})
    for (const head of heads.probe().heads) { assert.equal(head.shown, head.truth); seen.add(`${head.key} ${head.shown}`) }
  }
  assert.equal(seen.size, 6, 'both heads went through red, yellow and green')
  assert.ok(colour.version > version && colour.version - version <= 12, `one upload per change, got ${colour.version - version}`)

  // A cell swap keeps the kerb scans; hiding and showing follow street traffic.
  let scans = 0
  const counting = signalHeads(new THREE.Scene(), (x, z) => { scans++; return crossroads(x, z) })
  counting.setApproaches(signalApproaches(graph))
  for (let frame = 0; frame < 40; frame++) counting.update(.05, {x: 0, z: 0})
  const first = scans
  counting.setApproaches(signalApproaches(graph))
  for (let frame = 0; frame < 40; frame++) counting.update(.05, {x: 0, z: 0})
  assert.equal(scans, first, 'placements are remembered across cell swaps')
  assert.equal(counting.probe().heads.length, 2)
  // The pole is an obstacle for the player while it is shown, and only then.
  const solids = []
  heads.near(west.x, west.z, solid => solids.push(solid))
  assert.ok(solids.some(solid => solid.x === west.x && solid.z === west.z && solid.height > 7 && solid.halfWidth < .2), 'pole blocks the player')
  heads.hide()
  assert.equal(heads.group.visible, false)
  solids.length = 0
  heads.near(west.x, west.z, solid => solids.push(solid))
  assert.equal(solids.length, 0, 'hidden poles block nothing')
  heads.update(.05, {x: 0, z: 0})
  assert.equal(heads.group.visible, true)
  heads.setApproaches([])
  heads.update(.05, {x: 0, z: 0})
  assert.equal(heads.group.visible, false, 'no junction in the cell: nothing to draw')
  // Tiles that are not there yet: each approach is looked at once, then left alone for a while.
  let lookups = 0, loaded = false
  const streaming = signalHeads(new THREE.Scene(), (x, z) => { lookups++; return loaded ? crossroads(x, z) : undefined })
  streaming.setApproaches(signalApproaches(graph))
  for (let frame = 0; frame < 56; frame++) streaming.update(.05, {x: 0, z: 0}) // 2.8 s: a first look and one retry each
  assert.deepEqual([streaming.probe().pending, streaming.probe().heads.length], [2, 0])
  assert.ok(lookups >= 2 && lookups <= 4, `${lookups} lookups in 2.8 s while nothing has loaded`)
  loaded = true
  for (let frame = 0; frame < 80; frame++) streaming.update(.05, {x: 0, z: 0})
  assert.deepEqual([streaming.probe().pending, streaming.probe().heads.map(head => head.key).sort()], [0, ['1>100', '2>100']], 'both stand once the tiles are in')
  // Far approaches wait for the player to come near.
  counting.setApproaches(signalApproaches({...graph, nodes: graph.nodes.map(node => node.id === 1 ? {...node, id: 9} : node), lanes: graph.lanes.map(lane => lane.from === 1 ? {...lane, from: 9} : lane)}))
  for (let frame = 0; frame < 40; frame++) counting.update(.05, {x: 5000, z: 0})
  assert.deepEqual([counting.probe().pending, counting.probe().heads.length], [1, 1])
})

const worldGraph = 'public/world/roads/graph.json.gz'
test('world road network: every approach has one phase, keys are unique, landmark junction is left alone', {skip: !existsSync(worldGraph)}, () => {
  const world = JSON.parse(gunzipSync(readFileSync(worldGraph)))
  const all = signalApproaches(world), approaches = signalApproaches(world, LANDMARK_SIGNAL_GROUPS)
  assert.ok(approaches.length > 100, `approaches ${approaches.length}`)
  assert.equal(new Set(approaches.map(approach => approach.key)).size, approaches.length)
  assert.ok(all.length > approaches.length && approaches.every(approach => !LANDMARK_SIGNAL_GROUPS.has(approach.group)))
  const specs = new Map(world.signals.map(signal => [signal.node, signal]))
  for (const approach of approaches) {
    const phases = new Set()
    for (const lane of approach.lanes) specs.get(approach.node).phases.forEach((phase, index) => { if (phase.lanes.includes(lane)) phases.add(index) })
    assert.equal(phases.size, 1, `approach ${approach.key} is served by phases ${[...phases]}: one head cannot show it`)
    assert.ok(approach.path.every(piece => Math.abs(Math.hypot(piece.headingX, piece.headingZ) - 1) < 1e-9))
    assert.ok(Math.abs(approach.reach - approach.path.reduce((sum, piece) => sum + piece.length, 0)) < 1e-9)
    // A pole can only stand along the approach's own carriageway, so every approach must have room for one.
    assert.ok(approach.reach >= 8, `approach ${approach.key} is ${approach.reach.toFixed(1)} m long with no single road feeding it`)
    for (let index = 1; index < approach.path.length; index++) {
      const near = approach.path[index - 1], far = approach.path[index]
      assert.ok(Math.hypot(far.endX - (near.endX - near.headingX * near.length), far.endZ - (near.endZ - near.headingZ * near.length)) < 1e-6, `approach ${approach.key}: pieces join end to end`)
      assert.ok(far.headingX * near.headingX + far.headingZ * near.headingZ >= .9, `approach ${approach.key}: no sharp bend`)
    }
  }
  console.log({approaches: approaches.length, junctions: new Set(approaches.map(approach => approach.group)).size, landmark: all.length - approaches.length})
})
