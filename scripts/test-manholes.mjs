// IDOK-399 stage 5 — unit tests for the manhole covers and kerb gullies: where the road graph puts
// them (wheel tracks, off the lane lines, clear of junctions and signals, spaced apart), the quad each
// one is drawn as, and the runtime that drapes them over the road a few per frame.
// Run: node --import tsx --test scripts/test-manholes.mjs   (part of `npm run verify:street-furniture`)
import assert from 'node:assert/strict'
import {test} from 'node:test'
import * as THREE from 'three'
import {
  MANHOLE_ATLAS_CELLS,
  MANHOLE_CORNERS,
  MANHOLE_GRATE_SPACING,
  MANHOLE_INDICES,
  MANHOLE_JUNCTION_CLEAR,
  MANHOLE_MIN_GAP,
  MANHOLE_SIGNAL_CLEAR,
  MANHOLE_SIZE,
  MANHOLE_SPACING,
  MANHOLE_TRACK_OFFSET,
  MANHOLE_UV_ACROSS,
  MANHOLE_VERTICES,
  manholeCorners,
  manholeHash,
  manholes,
  spacedManholes,
  writeManhole,
} from '../web/src/traffic/manhole-layout.ts'
import {manholeCovers} from '../web/src/traffic/manhole-covers.ts'

// The runtime paints its texture atlas on a canvas once. Node has none: any 2D call is a no-op.
if (typeof globalThis.document === 'undefined') {
  const context = new Proxy({}, {
    get: (target, key) => key in target ? target[key] : () => {},
    set: (target, key, value) => { target[key] = value; return true },
  })
  globalThis.document = {createElement: () => ({width: 0, height: 0, getContext: () => context})}
}

const ROAD = 0, SIDEWALK = 1
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance
/** The same items in another order, the same every run. */
function shuffled(items, seed = 7) {
  const out = [...items]
  for (let index = out.length - 1; index > 0; index--) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    const other = seed % (index + 1);
    [out[index], out[other]] = [out[other], out[index]]
  }
  return out
}
/** Round and square covers, without the gullies. */
const lidsOf = list => list.filter(item => item.kind !== 1)
const gullies = list => list.filter(item => item.kind === 1)
const keys = list => list.map(item => item.key)
/** Distinct values, rounded to the centimetre, sorted. */
const levels = values => [...new Set(values.map(value => Math.round(value * 100) / 100))].sort((a, b) => a - b)
function closestPair(list) {
  let best = {distance: Infinity, a: null, b: null}
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const distance = Math.hypot(list[i].x - list[j].x, list[i].z - list[j].z)
    if (distance < best.distance) best = {distance, a: list[i].key, b: list[j].key}
  }
  return best
}

/** A straight street along +x from `from` to `to`, nodes 1 and 2, with the given lanes (`dir` 1 = 1→2, -1 = 2→1). */
function street(lanes, {from = 0, to = 2000, y = 150, signals = []} = {}) {
  return {
    nodes: [{id: 1, x: from, y, z: 0}, {id: 2, x: to, y, z: 0}],
    lanes: lanes.map(({dir = 1, ...lane}, index) => ({id: 100 + index, kind: 'motor', ...lane, from: dir > 0 ? 1 : 2, to: dir > 0 ? 2 : 1})),
    signals,
  }
}

test('manholeHash: deterministic, integer-only, uniform in [0, 1) and independent across salts', () => {
  const bins = new Array(10).fill(0)
  let product = 0
  for (let a = 0; a < 10000; a++) {
    const value = manholeHash(a, 3, 2)
    assert.ok(value >= 0 && value < 1, `manholeHash(${a}, 3, 2) = ${value} is outside [0, 1)`)
    assert.equal(manholeHash(a, 3, 2), value, 'the same inputs give the same value')
    bins[Math.floor(value * 10)]++
    product += value * manholeHash(a, 3, 3)
  }
  for (const [bin, count] of bins.entries()) assert.ok(count > 900 && count < 1100, `bin ${bin} has ${count} of 10000 (expected about 1000): ${bins}`)
  assert.ok(Math.abs(product / 10000 - .25) < .01, `salts 2 and 3 look correlated: mean product ${product / 10000}`)
  // Inputs are taken as 32-bit integers, so a fractional lane id hashes like its integer part.
  assert.equal(manholeHash(41.9, 2, 3), manholeHash(41, 2, 3))
  assert.notEqual(manholeHash(41, 2, 3), manholeHash(41, 2, 4), 'another salt, another value')
  assert.notEqual(manholeHash(41, 2, 3), manholeHash(41, 3, 3), 'another index, another value')
  // Fixed bits: the same on every machine and every run (murmur3 finaliser, no floating point).
  assert.equal(manholeHash(0, 0, 0), manholeHash(0, 0, 0))
  assert.equal(manholeHash(-5, 7, 1), manholeHash(-5, 7, 1))
})

test('manholes: about one cover every MANHOLE_SPACING and one gully seed every MANHOLE_GRATE_SPACING per lane, 15% square, both wheel tracks', () => {
  // 200 one-way lanes of 450 m on their own, 100 m apart: no lane lines, no junctions, no clashes between lanes.
  const nodes = [], lanes = []
  for (let index = 0; index < 200; index++) {
    nodes.push({id: 2 * index + 1, x: 0, y: 150, z: index * 100}, {id: 2 * index + 2, x: 450, y: 150, z: index * 100})
    lanes.push({id: 1000 + index, from: 2 * index + 1, to: 2 * index + 2, offset: 0, kind: 'motor'})
  }
  const all = manholes({nodes, lanes, signals: []})
  const lids = lidsOf(all), grates = gullies(all)
  assert.equal(lids.length, 200 * 450 / MANHOLE_SPACING, 'a 450 m lane has exactly 10 covers: 450 / 45 has nothing to round')
  const square = lids.filter(item => item.kind === 2).length / lids.length
  assert.ok(square > .11 && square < .19, `square share ${square} (expected about 0.15)`)
  // Width left out: 3 m by default, so the wheel tracks are MANHOLE_TRACK_OFFSET either side of the centre.
  const lateral = lids.map(item => item.z - Math.round(item.z / 100) * 100)
  assert.deepEqual(levels(lateral), [-MANHOLE_TRACK_OFFSET, MANHOLE_TRACK_OFFSET], 'covers sit in a wheel track, never on the centre line of a lone lane')
  const right = lateral.filter(value => value > 0).length / lateral.length
  assert.ok(right > .44 && right < .56, `share in the right wheel track ${right} (expected about 0.5)`)
  // 15 seeds per lane, the few within MANHOLE_MIN_GAP of a cover lose to it.
  assert.ok(grates.length < 200 * 450 / MANHOLE_GRATE_SPACING, 'some gully seeds give way to covers')
  assert.ok(grates.length > 2400, `${grates.length} gully seeds of 3000 left; only those right beside a cover should go`)
  assert.ok(grates.every(item => near(item.z, Math.round(item.z / 100) * 100)), 'gully seeds sit on the lane centre line')
  // Lanes far shorter than the spacing: the count is rounded up or down by a hash, so the mean holds.
  const short = {nodes: [], lanes: [], signals: []}
  for (let index = 0; index < 1000; index++) {
    short.nodes.push({id: 2 * index + 1, x: 0, y: 0, z: index * 50}, {id: 2 * index + 2, x: 22.5, y: 0, z: index * 50})
    short.lanes.push({id: 5000 + index, from: 2 * index + 1, to: 2 * index + 2, offset: 0, kind: 'motor'})
  }
  const shortLids = lidsOf(manholes(short)).length
  assert.ok(shortLids > 440 && shortLids < 560, `1000 lanes of 22.5 m gave ${shortLids} covers (expected about 500)`)
})

test('manholes: deterministic, sorted unique keys, independent of lane and node order', () => {
  const graph = {
    nodes: [
      {id: 1, x: 0, y: 150, z: 0}, {id: 2, x: 300, y: 151, z: 0}, {id: 3, x: 600, y: 152, z: 40},
      {id: 4, x: 300, y: 150, z: 300}, {id: 5, x: 300, y: 150, z: -250},
    ],
    lanes: [
      {id: 11, from: 1, to: 2, width: 3.5, offset: 1.75, kind: 'motor'}, {id: 12, from: 2, to: 1, width: 3.5, offset: 1.75, kind: 'motor'},
      {id: 13, from: 1, to: 2, width: 3.5, offset: 5.25, kind: 'motor'}, {id: 21, from: 2, to: 3, width: 3.2, offset: 1.6, kind: 'motor'},
      {id: 22, from: 3, to: 2, width: 3.2, offset: 1.6, kind: 'motor'}, {id: 31, from: 2, to: 4, offset: 0, kind: 'motor'},
      {id: 41, from: 5, to: 2, width: 3, offset: 1.5, kind: 'motor'}, {id: 42, from: 2, to: 5, width: 3, offset: 1.5, kind: 'motor'},
      {id: 51, from: 1, to: 2, width: 2, offset: 8, kind: 'nonmotor'},
    ],
    signals: [{node: 3}],
  }
  const result = manholes(graph)
  assert.ok(result.length > 30, `expected a few dozen covers, got ${result.length}`)
  assert.deepEqual(manholes(graph), result, 'same graph, same covers')
  assert.deepEqual(manholes({...graph, lanes: [...graph.lanes].reverse(), nodes: [...graph.nodes].reverse()}), result, 'reversed lanes and nodes')
  for (const seed of [1, 2, 3, 7, 11]) {
    assert.deepEqual(manholes({...graph, lanes: shuffled(graph.lanes, seed), nodes: shuffled(graph.nodes, seed + 1)}), result, `shuffled with seed ${seed}`)
  }
  assert.equal(new Set(keys(result)).size, result.length, 'keys are unique')
  for (let index = 1; index < result.length; index++) assert.ok(result[index - 1].key < result[index].key, `not sorted by key at ${index}: ${result[index - 1].key} ≥ ${result[index].key}`)
  for (const item of result) {
    assert.equal(item.key, `${item.x.toFixed(1)},${item.z.toFixed(1)}#${item.kind}`, 'key is the position to 0.1 m and the kind')
    assert.ok(near(Math.hypot(item.headingX, item.headingZ), 1), `${item.key} heading is not a unit vector`)
    // Square covers carry a spin too, but only a round one is drawn turned (see the quad test); a gully never has one.
    assert.ok(item.spin >= 0 && item.spin < Math.PI * 2 && (item.kind !== 1 || item.spin === 0), `${item.key}: spin ${item.spin}`)
  }
  const crowded = closestPair(result)
  assert.ok(crowded.distance >= MANHOLE_MIN_GAP, `${crowded.a} and ${crowded.b} are ${crowded.distance} m apart (< ${MANHOLE_MIN_GAP})`)
  // A road added far away does not change any key here: keys are stable while the same graph is loaded.
  const extended = {...graph, nodes: [...graph.nodes, {id: 8, x: 5000, y: 0, z: 0}, {id: 9, x: 5400, y: 0, z: 0}], lanes: [...graph.lanes, {id: 99, from: 8, to: 9, offset: 0, kind: 'motor'}]}
  const more = manholes(extended)
  assert.deepEqual(more.filter(item => item.x < 4000), result, 'an unrelated road leaves every other cover as it was')
  assert.ok(more.length > result.length)
})

test('manholes: only surface motor lanes long enough, with both nodes known, get covers', () => {
  const nodes = [{id: 1, x: 0, y: 0, z: 0}, {id: 2, x: 500, y: 0, z: 0}, {id: 3, x: 5.9, y: 0, z: 100}, {id: 4, x: 0, y: 0, z: 100}]
  assert.deepEqual(manholes({nodes, signals: [], lanes: [
    {id: 1, from: 1, to: 2, offset: 0, kind: 'motor', gradeSeparated: 'bridge'},
    {id: 2, from: 2, to: 1, offset: 0, kind: 'motor', gradeSeparated: 'tunnel'},
    {id: 3, from: 1, to: 2, offset: 4, kind: 'nonmotor'},
    {id: 4, from: 1, to: 2, offset: 8, kind: 'pedestrian'},
    {id: 5, from: 1, to: 1, offset: 0, kind: 'motor'},
    {id: 6, from: 1, to: 77, offset: 0, kind: 'motor'},
    {id: 7, from: 4, to: 3, offset: 0, kind: 'motor'},
  ]}), [], 'bridges, tunnels, non-motor lanes, loops, lanes to a missing node and lanes under 6 m get nothing')
  // A duplicated node id: the first one counts.
  const first = manholes({nodes: [...nodes, {id: 2, x: 900, y: 0, z: 0}], signals: [], lanes: [{id: 8, from: 1, to: 2, offset: 0, kind: 'motor'}]})
  assert.ok(first.length > 0 && first.every(item => item.x <= 500), 'covers lie on the first node 2 (x = 500), not the duplicate at x = 900')
  // Heights come from the lane profile (`[t, y, t, y, ...]`, t = 0 at `from`), else the two node heights.
  const profiled = manholes({
    nodes: [{id: 1, x: 0, y: 999, z: 0}, {id: 2, x: 500, y: 999, z: 0}], signals: [],
    lanes: [{id: 9, from: 1, to: 2, offset: 0, kind: 'motor', heights: [0, 10, .5, 30, 1, 20]}],
  })
  assert.ok(profiled.length > 5)
  for (const item of profiled) {
    const t = item.x / 500, expected = t <= .5 ? 10 + 40 * t : 30 - 20 * (t - .5)
    assert.ok(near(item.y, expected, 1e-9), `${item.key}: y ${item.y}, expected ${expected} from the profile`)
  }
  const sloped = manholes({nodes: [{id: 1, x: 0, y: 100, z: 0}, {id: 2, x: 500, y: 110, z: 0}], signals: [], lanes: [{id: 9, from: 1, to: 2, offset: 0, kind: 'motor'}]})
  for (const item of sloped) assert.ok(near(item.y, 100 + 10 * item.x / 500, 1e-9), `${item.key}: y ${item.y} not between the node heights`)
})

test('manholes: wheel tracks narrow with the lane — EDGE_KEEP inside the edge, centre line below 0.2 m', () => {
  const lateralOf = width => levels(lidsOf(manholes(street([{offset: 0, width}]))).map(item => item.z))
  assert.deepEqual(lateralOf(undefined), [-1, 1], 'no width: 3 m, full MANHOLE_TRACK_OFFSET')
  assert.deepEqual(lateralOf(0), [-1, 1], 'width 0 is treated as missing')
  assert.deepEqual(lateralOf(4), [-1, 1], 'a wide lane does not push the covers further out')
  assert.deepEqual(lateralOf(2), [-.5, .5], '2 m lane: half the width less 0.5 m')
  assert.deepEqual(lateralOf(1.3), [0], 'a track under 0.2 m is not worth it: on the centre line')
})

test('manholes: standard two-way street — the track by the centre line moves to the lane centre, the kerb-side track stays', () => {
  // Two lanes, 3 m, centres 1.5 m either side of the graph edge (the painted centre line at z = 0).
  const lanes = [{offset: 1.5, width: 3}, {offset: 1.5, width: 3, dir: -1}]
  const twoWay = lidsOf(manholes(street(lanes)))
  assert.ok(twoWay.length > 60)
  assert.deepEqual(levels(twoWay.map(item => Math.abs(item.z))), [1.5, 2.5], 'covers at the lane centre or the kerb-side track, never 0.5 m from the centre line')
  const kerbSide = twoWay.filter(item => near(Math.abs(item.z), 2.5)).length, centred = twoWay.length - kerbSide
  assert.ok(kerbSide > 10 && centred > 10, `both kinds of place should occur: ${kerbSide} kerb-side, ${centred} centred`)
  for (const item of twoWay) assert.ok(Math.abs(item.z) >= .75, `${item.key} within LINE_KEEP of the centre line`)
  // The same lane alone (one-way): every cover keeps the track the hash picked, centre-side ones included.
  const alone = lidsOf(manholes(street([lanes[0]])))
  assert.deepEqual(levels(alone.map(item => item.z)), [.5, 2.5])
  const eastbound = twoWay.filter(item => item.headingX > 0)
  assert.equal(eastbound.length, alone.length, 'the oncoming lane takes no cover of this one away')
  for (const [index, item] of eastbound.entries()) {
    const was = alone[alone.findIndex(other => near(other.x, item.x) && other.kind === item.kind)]
    assert.ok(was, `${item.key} has no counterpart on the one-way street`)
    if (near(was.z, 2.5)) assert.ok(near(item.z, 2.5), `${item.key}: a kerb-side cover moved (${index})`)
    else assert.ok(near(was.z, .5) && near(item.z, 1.5), `${item.key}: a centre-side cover should move to the lane centre`)
  }
})

test('manholes: narrow street with one shared lane each way (offsets -1.2 / +1.2) — off the painted graph edge', () => {
  // Both directions drive one 4.1 m lane whose centre is 1.2 m to the -z side of the graph edge.
  const graph = street([{offset: -1.2, width: 4.1}, {offset: 1.2, width: 4.1, dir: -1}])
  const lids = lidsOf(manholes(graph))
  assert.ok(lids.length > 30)
  assert.deepEqual(levels(lids.map(item => item.z)), [-2.2, -1.2], 'the track 0.2 m off the graph edge is given up for the lane centre')
  for (const item of lids) assert.ok(Math.abs(item.z) >= .75, `${item.key} is within LINE_KEEP of the graph edge`)
  for (const direction of [1, -1]) {
    const these = lids.filter(item => Math.sign(item.headingX) === direction)
    assert.ok(these.some(item => near(item.z, -2.2)) && these.some(item => near(item.z, -1.2)), `direction ${direction}: both the outer track and the centre occur`)
  }
})

test('manholes: one-way street (offset 0) uses both tracks; lanes side by side keep off the line between them', () => {
  const oneWay = lidsOf(manholes(street([{offset: 0, width: 3.5}])))
  assert.deepEqual(levels(oneWay.map(item => item.z)), [-1, 1], 'nothing painted along a one-way edge: both wheel tracks')
  // Two lanes the same way, 3 m wide, centres at 1.5 and 4.5: a dashed line at z = 3.
  const graph = street([{offset: 1.5, width: 3}, {offset: 4.5, width: 3}])
  const lids = lidsOf(manholes(graph))
  const inner = lids.filter(item => item.z < 3), outer = lids.filter(item => item.z > 3)
  assert.deepEqual(levels(inner.map(item => item.z)), [.5, 1.5], 'inner lane: its left track or its centre')
  assert.deepEqual(levels(outer.map(item => item.z)), [4.5, 5.5], 'outer lane: its centre or its right track')
  for (const item of lids) assert.ok(Math.abs(item.z - 3) >= .75, `${item.key} within LINE_KEEP of the lane line at z = 3`)
  // A cycle lane on the same pair of nodes is painted too: its line keeps the motor covers off it.
  const withBikes = lidsOf(manholes(street([{offset: 0, width: 3.5}, {offset: 2.5, width: 1.5, kind: 'nonmotor'}])))
  for (const item of withBikes) assert.ok(Math.abs(item.z - 1.25) >= .75, `${item.key} within LINE_KEEP of the cycle lane line at z = 1.25`)
  assert.deepEqual(levels(withBikes.map(item => item.z)), [-1, 0])
})

test('manholes: junction ends stay clear for MANHOLE_JUNCTION_CLEAR, signalised nodes for MANHOLE_SIGNAL_CLEAR; bends do not', () => {
  // 30 roads, each bending at node b (two neighbours), 200 m apart in z.
  const nodes = [], lanes = []
  for (let road = 0; road < 30; road++) {
    const z = road * 200, a = road * 10 + 1, b = a + 1, c = a + 2
    nodes.push({id: a, x: -300, y: 0, z}, {id: b, x: 0, y: 0, z}, {id: c, x: 300, y: 0, z: z + 20})
    lanes.push({id: a * 10, from: a, to: b, offset: 0, kind: 'motor'}, {id: a * 10 + 1, from: b, to: c, offset: 0, kind: 'motor'})
  }
  const bendAt = item => nodes.find(node => node.id === Math.floor(item.z / 200 + .5) * 10 + 2)
  const fromBend = item => { const node = bendAt(item); return Math.hypot(item.x - node.x, item.z - node.z) }
  const plain = manholes({nodes, lanes, signals: []})
  const closeToBend = plain.filter(item => fromBend(item) < MANHOLE_JUNCTION_CLEAR)
  assert.ok(closeToBend.length > 0, 'a bend in a road keeps no clear zone: some cover lies within 10 m of one')

  // A side arm at every bend makes it a junction: only what lay within 10 m along a lane goes.
  const arms = {nodes: [...nodes], lanes: [...lanes], signals: []}
  for (let road = 0; road < 30; road++) {
    const b = road * 10 + 2, d = road * 10 + 4
    arms.nodes.push({id: d, x: 0, y: 0, z: road * 200 + 60})
    arms.lanes.push({id: d * 10, from: b, to: d, offset: 0, kind: 'motor'})
  }
  const junctioned = manholes(arms)
  const along = item => {
    // Distance along its own lane from the bend node (the lane runs from or to it).
    const node = bendAt(item)
    return Math.abs((item.x - node.x) * item.headingX + (item.z - node.z) * item.headingZ)
  }
  for (const item of junctioned) assert.ok(along(item) >= MANHOLE_JUNCTION_CLEAR - 1e-9, `${item.key} is ${along(item)} m from a junction along its lane`)
  // Covers only: a gully seed that lost to a cover now gone may come back, which is right.
  const main = lidsOf(junctioned).filter(item => item.headingZ < .5)
  assert.deepEqual(keys(main), keys(lidsOf(plain).filter(item => along(item) >= MANHOLE_JUNCTION_CLEAR)), 'no other cover on the main road changes')
  assert.ok(junctioned.some(item => item.headingZ === 1), 'the side arm has covers of its own')

  // A signal at the bend: no cover within 18 m in a straight line, on any lane.
  const signalled = manholes({nodes, lanes, signals: nodes.filter(node => node.id % 10 === 2).map(node => ({node: node.id}))})
  for (const item of signalled) assert.ok(fromBend(item) >= MANHOLE_SIGNAL_CLEAR, `${item.key} is ${fromBend(item)} m from a signalised node`)
  assert.deepEqual(keys(lidsOf(signalled)), keys(lidsOf(plain).filter(item => fromBend(item) >= MANHOLE_SIGNAL_CLEAR)))

  // A signal on a node no lane uses still clears the road beside it; a signal on an unknown node is ignored.
  const beside = street([{offset: 0}], {from: 0, to: 600})
  beside.nodes.push({id: 7, x: 300, y: 0, z: 6})
  const cleared = manholes({...beside, signals: [{node: 7}, {node: 7}, {node: 404}]})
  for (const item of cleared) assert.ok(Math.hypot(item.x - 300, item.z - 6) >= MANHOLE_SIGNAL_CLEAR, `${item.key} within 18 m of the lone signal`)
  assert.deepEqual(keys(lidsOf(cleared)), keys(lidsOf(manholes(beside)).filter(item => Math.hypot(item.x - 300, item.z - 6) >= MANHOLE_SIGNAL_CLEAR)))
})

test('manholes: covers and gullies keep MANHOLE_MIN_GAP from each other on a wide eight-lane two-way road', () => {
  const lanes = []
  for (const dir of [1, -1]) for (let lane = 0; lane < 4; lane++) lanes.push({offset: 1.5 + lane * 3, width: 3, dir})
  const all = manholes(street(lanes, {to: 3000}))
  assert.ok(all.length > 400, `expected several hundred, got ${all.length}`)
  const crowded = closestPair(all)
  assert.ok(crowded.distance >= MANHOLE_MIN_GAP, `${crowded.a} and ${crowded.b} are ${crowded.distance} m apart`)
  // Every cover lies on one of the lanes, in a track the lines leave free or on its centre.
  for (const item of lidsOf(all)) {
    const centre = 1.5 + 3 * Math.round((Math.abs(item.z) - 1.5) / 3)
    assert.ok([0, MANHOLE_TRACK_OFFSET].some(side => near(Math.abs(Math.abs(item.z) - centre), side)), `${item.key} is neither on a lane centre nor in a wheel track`)
    const line = Math.min(...[0, 3, 6, 9].map(at => Math.abs(Math.abs(item.z) - at)))
    assert.ok(line >= .75 - 1e-9, `${item.key} is ${line} m from a lane line (LINE_KEEP 0.75)`)
  }
})

test('spacedManholes: union of two cells — duplicates and crowders go, covers before gullies, then by key, in any order', () => {
  const at = (x, z, kind = 0) => ({key: `${x.toFixed(1)},${z.toFixed(1)}#${kind}`, x, y: 150, z, headingX: 1, headingZ: 0, kind, spin: 0, cell: 'test'})
  const cellA = [at(0, 0), at(10, 0, 1), at(20, 0, 2), at(30, 0)]
  const cellB = [
    at(0, 0), // the same cover loaded with the other cell
    at(1.5, 0), // too close to (0, 0), larger key
    at(11, 0), // a cover beats the gully at (10, 0) although its key is larger
    at(23.1, 0, 1), // 3.1 m from (20, 0): kept
    at(30, 2.5, 2), // too close to (30, 0), larger key
    at(2.9, 50), at(3.05, 50), // either side of a grid line, 0.15 m apart
    at(-.1, 80), at(.1, 80), // either side of zero
  ]
  const union = [...cellA, ...cellB]
  const kept = spacedManholes(union)
  assert.deepEqual(keys(kept), ['-0.1,80.0#0', '0.0,0.0#0', '11.0,0.0#0', '2.9,50.0#0', '20.0,0.0#2', '23.1,0.0#1', '30.0,0.0#0'])
  assert.equal(kept[0].cell, 'test', 'the items given are returned, extra fields and all')
  assert.deepEqual(spacedManholes([...cellB, ...cellA]), kept)
  assert.deepEqual(spacedManholes([...union].reverse()), kept)
  for (const seed of [1, 2, 3, 7]) assert.deepEqual(spacedManholes(shuffled(union, seed)), kept, `shuffled with seed ${seed}`)
  assert.deepEqual(spacedManholes([]), [])
  assert.equal(union.length, 13, 'input left as it was')
  const crowded = closestPair(kept)
  assert.ok(crowded.distance >= MANHOLE_MIN_GAP, `${crowded.a} and ${crowded.b} are ${crowded.distance} m apart`)
})

test('manholeCorners and writeManhole: quad of the kind\'s size, round ones turned by spin, facing up, uvs inside the kind\'s atlas cell', () => {
  assert.equal(MANHOLE_SIZE.length, MANHOLE_ATLAS_CELLS)
  assert.ok(near((MANHOLE_UV_ACROSS[1][1] - MANHOLE_UV_ACROSS[1][0]), MANHOLE_SIZE[1][0] / MANHOLE_SIZE[1][1]), 'the gully strip has the grate\'s own aspect')
  assert.equal(MANHOLE_VERTICES, MANHOLE_CORNERS)
  const heights = [1.1, 1.25, 1.3, 1.15], lift = .015, offset = 2
  for (const kind of [0, 1, 2]) {
    const [across, along] = MANHOLE_SIZE[kind], [uvFrom, uvTo] = MANHOLE_UV_ACROSS[kind]
    for (const heading of [0, Math.PI / 2, .6, -2.1]) for (const spin of [0, 1.23]) {
      const headingX = Math.cos(heading), headingZ = Math.sin(heading)
      const cover = {key: 'k', x: 3.25, y: 1.2, z: -2.75, headingX, headingZ, kind, spin}
      const label = `kind ${kind}, heading ${heading}, spin ${spin}`
      const corners = manholeCorners(cover, new Array(8))
      assert.ok(near((corners[0] + corners[2] + corners[4] + corners[6]) / 4, cover.x) && near((corners[1] + corners[3] + corners[5] + corners[7]) / 4, cover.z), `${label}: centred on the cover`)
      const edge = (a, b) => Math.hypot(corners[b * 2] - corners[a * 2], corners[b * 2 + 1] - corners[a * 2 + 1])
      assert.ok(near(edge(0, 1), across) && near(edge(3, 2), across), `${label}: across ${edge(0, 1)}, expected ${across}`)
      assert.ok(near(edge(1, 2), along) && near(edge(0, 3), along), `${label}: along ${edge(1, 2)}, expected ${along}`)
      // Rear → front runs along the heading, turned by spin for a round cover only.
      const turn = kind === 0 ? heading + spin : heading
      const ax = (corners[6] - corners[0] + corners[4] - corners[2]) / 2 / along, az = (corners[7] - corners[1] + corners[5] - corners[3]) / 2 / along
      assert.ok(near(ax, Math.cos(turn)) && near(az, Math.sin(turn)), `${label}: quad axis (${ax}, ${az})`)
      assert.equal(manholeCorners(cover, new Float32Array(8)).length, 8, 'works into a Float32Array too')

      const positions = new Float32Array((offset + MANHOLE_VERTICES + 1) * 3).fill(NaN)
      const uvs = new Float32Array((offset + MANHOLE_VERTICES + 1) * 2).fill(NaN)
      writeManhole(cover, heights, lift, positions, uvs, offset)
      assert.ok(Number.isNaN(positions[offset * 3 - 1]) && Number.isNaN(positions[(offset + MANHOLE_VERTICES) * 3]), `${label}: positions written outside the quad`)
      assert.ok(Number.isNaN(uvs[offset * 2 - 1]) && Number.isNaN(uvs[(offset + MANHOLE_VERTICES) * 2]), `${label}: uvs written outside the quad`)
      const vertex = corner => new THREE.Vector3().fromArray(positions, (offset + corner) * 3)
      for (let corner = 0; corner < MANHOLE_VERTICES; corner++) {
        const point = vertex(corner), u = uvs[(offset + corner) * 2], v = uvs[(offset + corner) * 2 + 1]
        assert.ok(near(point.x, corners[corner * 2], 1e-5) && near(point.z, corners[corner * 2 + 1], 1e-5), `${label}: corner ${corner} off its place`)
        assert.ok(near(point.y, heights[corner] + lift, 1e-6), `${label}: corner ${corner} at ${point.y}, expected its own height plus lift`)
        assert.ok(u >= kind / MANHOLE_ATLAS_CELLS - 1e-7 && u <= (kind + 1) / MANHOLE_ATLAS_CELLS + 1e-7, `${label}: u ${u} outside cell ${kind}`)
        assert.ok(near(u, (kind + (corner === 0 || corner === 3 ? uvFrom : uvTo)) / MANHOLE_ATLAS_CELLS, 1e-6), `${label}: u ${u} at corner ${corner}`)
        assert.equal(v, corner < 2 ? 0 : 1, `${label}: v at corner ${corner}`)
      }
      for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
        const normal = new THREE.Vector3().crossVectors(vertex(b).sub(vertex(a)), vertex(c).sub(vertex(a)))
        assert.ok(normal.y > 0, `${label}: triangle ${a} ${b} ${c} faces down (normal y ${normal.y})`)
      }
    }
  }
})

// ——— runtime ———

// A straight two-way street along x, kerbs at z = ±kerb; lanes 3 m wide, centres at z = ±1.5.
function scene({from = -200, to = 200, kerb = 3.2, ground = () => 150, blocked, graph} = {}) {
  const root = new THREE.Scene()
  const world = {tiles: true, kerb, ground, calls: 0, surfaceCalls: 0}
  const groundAt = (x, z, reference, car) => {
    world.calls++
    assert.equal(car, true, 'covers ask for the carriageway')
    return world.ground(x, z, reference)
  }
  const surfaceAt = (x, z) => {
    world.surfaceCalls++
    return world.tiles ? [Math.abs(z) < world.kerb ? ROAD : SIDEWALK] : undefined
  }
  const covers = manholeCovers(root, groundAt, surfaceAt, blocked)
  const layout = graph ?? street([{offset: 1.5, width: 3}, {offset: 1.5, width: 3, dir: -1}], {from, to})
  covers.setGraph('0_0', layout)
  const run = (seconds, focus = {x: 0, z: 0}, dt = 1 / 60) => { for (let time = 0; time < seconds; time += dt) covers.update(dt, focus) }
  /** Every quad in the draw range is the quad of one cover the probe calls drawn, and the other way round. */
  const bufferMatchesProbe = () => {
    const position = covers.mesh.geometry.getAttribute('position'), quads = covers.mesh.geometry.drawRange.count / MANHOLE_INDICES
    const left = covers.probe().covers.filter(item => item.state === 'drawn')
    assert.equal(quads, left.length, `${quads} quads in the draw range, ${left.length} covers drawn`)
    for (let quad = 0; quad < quads; quad++) {
      let x = 0, z = 0
      for (let corner = 0; corner < 4; corner++) { x += position.getX(quad * 4 + corner) / 4; z += position.getZ(quad * 4 + corner) / 4 }
      const index = left.findIndex(item => Math.abs(item.x - x) < 1e-3 && Math.abs(item.z - z) < 1e-3)
      assert.ok(index >= 0, `quad ${quad} centred at ${x}, ${z} belongs to no drawn cover`)
      left.splice(index, 1)
    }
  }
  return {root, world, covers, layout, run, bufferMatchesProbe}
}
const within = (item, focus, radius) => (item.x - focus.x) ** 2 + (item.z - focus.z) ** 2 <= radius ** 2

test('manholeCovers: one mesh, nothing drawn before the first look, then at most three covers (12 ground samples) a frame', () => {
  const {root, world, covers, run, layout, bufferMatchesProbe} = scene()
  assert.equal(covers.mesh.parent, root)
  assert.equal(covers.mesh.visible, false)
  assert.deepEqual([covers.probe().drawn, covers.probe().drawCalls], [0, 0])
  assert.equal(covers.probe().total, manholes(layout).length)
  covers.update(1 / 60, {x: 0, z: 0})
  let probe = covers.probe()
  assert.deepEqual([world.calls, probe.samples, probe.drawn], [12, 12, 3], 'three covers, four corners each, in the first frame')
  assert.deepEqual([covers.mesh.visible, probe.drawCalls, covers.mesh.geometry.drawRange.count], [true, 1, 3 * MANHOLE_INDICES])
  assert.ok(covers.mesh.material.isMeshLambertMaterial && covers.mesh.material.polygonOffset && covers.mesh.material.alphaTest > 0, 'lit like the road, biased against z-fighting, cut out by alpha')
  assert.ok(covers.mesh.material.map, 'one texture atlas')
  assert.equal(covers.mesh.userData.noShadowCast, true)
  let most = 0
  for (let frame = 0; frame < 60; frame++) {
    const before = world.calls
    covers.update(1 / 60, {x: 0, z: 0})
    most = Math.max(most, world.calls - before)
  }
  assert.equal(most, 12, 'never more than 3 × 4 ground samples in a frame')
  probe = covers.probe()
  const nearby = probe.covers.filter(item => within(item, {x: 0, z: 0}, 90))
  assert.ok(nearby.length >= 10, `expected a dozen covers within 90 m, got ${nearby.length}`)
  assert.equal(probe.drawn, nearby.length, 'everything within 90 m is draped, nothing further out')
  assert.ok(probe.covers.filter(item => item.state === 'drawn').every(item => within(item, {x: 0, z: 0}, 90)))
  assert.equal(covers.mesh.geometry.drawRange.count, probe.drawn * MANHOLE_INDICES)
  bufferMatchesProbe()
  const position = covers.mesh.geometry.getAttribute('position')
  for (let vertex = 0; vertex < probe.drawn * 4; vertex++) assert.ok(near(position.getY(vertex), 150.011, 1e-4), `vertex ${vertex} at ${position.getY(vertex)}: a lid lies 1.1 cm above the road`)
  run(1, {x: 150, z: 0})
  assert.ok(covers.probe().drawn > nearby.length, 'covers further along are draped when the player gets there')
})

test('manholeCovers: settled after three equal readings a second apart, then read once every eight seconds; a change is picked up', () => {
  const {world, covers, run} = scene()
  run(.5)
  const count = covers.probe().drawn
  assert.ok(count >= 10)
  assert.equal(covers.probe().settled, 0, 'one reading is not trusted')
  run(1)
  assert.equal(covers.probe().settled, 0, 'two readings are not enough')
  run(1)
  assert.equal(covers.probe().settled, count, 'three equal readings: settled')
  assert.equal(world.calls, count * 4 * 3)
  run(6)
  assert.equal(world.calls, count * 4 * 3, 'settled covers are left alone in between')
  run(8)
  assert.equal(world.calls, count * 4 * 4, 'one look per cover per eight seconds')
  assert.equal(covers.probe().samples, world.calls)
  // The road collider moves (a tile reloaded): rewritten at the next look, settling starts again.
  world.ground = () => 150.05
  run(2.2)
  const probe = covers.probe()
  assert.equal(probe.settled, 0)
  assert.ok(probe.covers.filter(item => item.state === 'drawn').every(item => item.heights.every(y => near(y, 150.05, 1e-4))), 'heights read again')
  const position = covers.mesh.geometry.getAttribute('position')
  for (let vertex = 0; vertex < probe.drawn * 4; vertex++) assert.ok(near(position.getY(vertex), 150.061, 1e-4), `vertex ${vertex} not rewritten`)
  run(2.5)
  assert.equal(covers.probe().settled, count)
})

test('manholeCovers: a drawn cover whose road reads out of band keeps its height and backs off to one look per 30 s', () => {
  const {world, covers, run} = scene()
  run(.5); run(1); run(1)
  const count = covers.probe().drawn
  assert.equal(covers.probe().settled, count)
  // A deck loads over the road: the first corner already reads more than 0.6 m off, the other three are not asked.
  world.ground = () => 152
  run(18)
  const calls = world.calls
  run(25)
  assert.equal(world.calls, calls, 'after six wrong readings 1.5 s apart: not asked again for 30 s')
  run(30)
  assert.equal(world.calls, calls + count, 'then one look (one corner) per cover per 30 s')
  const probe = covers.probe()
  assert.equal(probe.drawn, count, 'the covers stay drawn')
  assert.ok(probe.covers.filter(item => item.state === 'drawn').every(item => item.heights.every(y => near(y, 150, 1e-4))), 'at the heights they had')
})

test('manholeCovers: missing tiles wait, a lid on a step or far off the road height is not drawn, an even slope is', () => {
  const late = scene()
  late.world.tiles = false
  late.run(1)
  assert.deepEqual([late.covers.probe().drawn, late.world.calls], [0, 0], 'no ground read before the street surface is known')
  late.world.tiles = true
  late.run(2)
  assert.ok(late.covers.probe().drawn >= 10, 'drawn once the tile is there (looked at again 1.5 s later)')

  const sloped = scene({ground: (x, z) => 150 + .002 * x + .01 * z})
  sloped.run(1)
  const tilted = sloped.covers.probe()
  assert.ok(tilted.drawn >= 10, 'an even slope lies flush under every lid')
  for (const item of tilted.covers.filter(cover => cover.state === 'drawn')) {
    const corners = manholeCorners(item, [])
    item.heights.forEach((y, corner) => assert.ok(near(y, 150 + .002 * corners[corner * 2] + .01 * corners[corner * 2 + 1], 1e-4), `${item.key} corner ${corner}`))
  }

  // One corner of one lid 10 cm up: a kerb under it. That lid stays off, the others are drawn.
  const victim = lidsOf(manholes(street([{offset: 1.5, width: 3}, {offset: 1.5, width: 3, dir: -1}], {from: -200, to: 200}))).find(item => within(item, {x: 0, z: 0}, 60))
  const corner = manholeCorners(victim, [])
  const stepped = scene({ground: (x, z) => Math.hypot(x - corner[0], z - corner[1]) < .01 ? 150.1 : 150})
  stepped.run(3)
  const steppedProbe = stepped.covers.probe()
  assert.equal(steppedProbe.covers.find(item => item.key === victim.key).state, 'waiting', 'the warped lid is not drawn')
  assert.equal(steppedProbe.drawn, tilted.drawn - 1)
  stepped.run(10)
  assert.equal(stepped.covers.probe().covers.find(item => item.key === victim.key).state, 'none', 'given up after six warped readings')

  // A deck over the road (or a pit): readings 5 m off the road height from the graph.
  const deck = scene({ground: x => x < 0 ? 155 : 150})
  deck.run(12)
  const deckProbe = deck.covers.probe()
  assert.ok(deckProbe.covers.filter(item => item.x < -1 && within(item, {x: 0, z: 0}, 90)).every(item => item.state === 'none'), 'under the deck: none after six readings')
  assert.ok(deckProbe.covers.filter(item => item.x > 1 && within(item, {x: 0, z: 0}, 90)).every(item => item.state === 'drawn'))
  deck.world.ground = () => 150
  deck.run(31)
  assert.ok(deck.covers.probe().covers.filter(item => within(item, {x: 0, z: 0}, 90)).every(item => item.state === 'drawn'), 'looked at again every 30 s, drawn once the reading is right')
})

test('manholeCovers: a gully moves once to the kerb on its right and stays there; with no kerb in reach it is dropped', () => {
  const {world, covers, run} = scene({blocked: () => false})
  run(1)
  const drawn = () => covers.probe().covers.filter(item => item.state === 'drawn')
  const grates = gullies(drawn())
  assert.ok(grates.length >= 3, `expected a few gullies near the player, got ${grates.length}`)
  const seeds = new Map(gullies(manholes(scene().layout)).map(item => [item.key, item]))
  for (const grate of grates) {
    // The kerb is 1.7 m right of the seed; it is closed in on to 1/32 m, and the grate sits 0.3 m inside it.
    const seed = seeds.get(grate.key)
    assert.ok(seed && near(grate.x, seed.x), `${grate.key} moved along the lane`)
    assert.ok(Math.abs(grate.z) >= 3.2 - .3 - .25 / 8 && Math.abs(grate.z) < 3.2 - .3, `${grate.key} at z ${grate.z}: expected 0.3 m inside the kerb at ±3.2`)
    // Right of a lane heading +x is +z; of one heading -x, -z.
    assert.equal(Math.sign(grate.z), Math.sign(seed.headingX), `${grate.key} moved to the left of its lane`)
  }
  const placed = new Map(grates.map(item => [item.key, item.z]))
  // The street surface changes later (a wider tile): the parking bays are asked again, the gully stays.
  world.kerb = 3.7
  covers.recheck()
  run(2)
  for (const grate of gullies(drawn())) if (placed.has(grate.key)) assert.equal(grate.z, placed.get(grate.key), `${grate.key} moved again`)

  // Kerb more than 4.25 m away (an inner lane, a square): no gully at all.
  const square = scene({kerb: 20})
  square.run(1)
  const probe = square.covers.probe()
  assert.equal(gullies(probe.covers.filter(item => item.state === 'drawn')).length, 0)
  assert.equal(probe.dead, gullies(probe.covers.filter(item => within(item, {x: 0, z: 0}, 90))).length, 'every nearby gully seed is dead')
  assert.ok(probe.drawn > 5, 'covers are still drawn')
})

test('manholeCovers: covers on parking bays (blocked) are left out and come back when the bays change', () => {
  const bays = {x: 0, calls: [], on: true}
  const blocked = (x, z, margin) => { bays.calls.push(margin); return bays.on && x > bays.x }
  const {covers, run, bufferMatchesProbe} = scene({blocked})
  run(1)
  let probe = covers.probe()
  const nearby = probe.covers.filter(item => within(item, {x: 0, z: 0}, 90))
  assert.ok(bays.calls.length > 0 && bays.calls.every(margin => margin > 0), 'asked with a margin round the bay lines')
  assert.ok(probe.covers.filter(item => item.state === 'drawn').every(item => item.x <= 0), 'nothing drawn on a bay')
  assert.ok(nearby.filter(item => item.x > 0).every(item => item.state === 'none'))
  const left = probe.drawn
  assert.ok(left > 3)
  bays.on = false
  run(1)
  assert.equal(covers.probe().drawn, left, 'not asked again until the bays change')
  covers.recheck()
  run(1)
  assert.equal(covers.probe().drawn, nearby.length, 'bays gone: all drawn')
  // Bays back: drawn covers are taken out of the buffer again.
  bays.on = true
  covers.recheck()
  run(1)
  probe = covers.probe()
  assert.equal(probe.drawn, left)
  assert.equal(covers.mesh.geometry.drawRange.count, left * MANHOLE_INDICES)
  bufferMatchesProbe() // the last drawn cover moved into each gap left
})

test('manholeCovers: a frame scans at most 256 covers for one that is due', () => {
  const graph = street([{offset: 1.5, width: 3}, {offset: 1.5, width: 3, dir: -1}], {from: 0, to: 9000})
  const order = manholes(graph), focus = {x: 8500, z: 0}
  const first = order.findIndex(item => within(item, focus, 90))
  assert.ok(first >= 256, `precondition: the covers near x = 8500 sort after the first 256 keys (first at ${first})`)
  const {covers, world} = scene({graph})
  const frame = Math.floor(first / 256) + 1
  for (let count = 1; count < frame; count++) {
    covers.update(1 / 60, focus)
    assert.deepEqual([covers.probe().drawn, world.calls], [0, 0], `frame ${count} only gets to cover ${count * 256}`)
  }
  covers.update(1 / 60, focus)
  assert.ok(covers.probe().drawn > 0, `frame ${frame} reaches cover ${first}`)
})

// What three.js does with an attribute each rendered frame (`WebGLAttributes.update`): the whole
// array when there are no update ranges, else only the ranges.
function gpu(mesh, name) {
  const state = {buffer: null, attribute: null, version: -1, whole: 0, partial: 0}
  return Object.assign(state, {
    render() {
      const attribute = mesh.geometry.getAttribute(name)
      if (!mesh.visible || !attribute) return
      if (attribute !== state.attribute) {
        Object.assign(state, {attribute, buffer: attribute.array.slice(), version: attribute.version})
        state.whole++
        attribute.onUploadCallback()
      } else if (attribute.version !== state.version) {
        state.version = attribute.version
        if (attribute.updateRanges.length) {
          for (const {start, count} of attribute.updateRanges) state.buffer.set(attribute.array.subarray(start, start + count), start)
          attribute.clearUpdateRanges()
          state.partial++
        } else { state.buffer.set(attribute.array); state.whole++ }
        attribute.onUploadCallback()
      }
    },
    stale() {
      const attribute = mesh.geometry.getAttribute(name), end = mesh.geometry.drawRange.count / MANHOLE_INDICES * MANHOLE_VERTICES * attribute.itemSize
      let stale = 0
      for (let index = 0; index < end; index++) if (state.buffer[index] !== attribute.array[index]) stale++
      return stale
    },
  })
}

test('manholeCovers: what is drawn is what was uploaded — no update ranges before the first whole upload', () => {
  const {world, covers, run} = scene({to: 2000})
  // Covers drawn before anything was rendered: the buffer must go up whole, so no ranges yet.
  run(.2)
  assert.ok(covers.probe().drawn > 3)
  const position = covers.mesh.geometry.getAttribute('position'), uv = covers.mesh.geometry.getAttribute('uv')
  assert.deepEqual([position.updateRanges.length, uv.updateRanges.length], [0, 0], 'no update ranges before the first upload')
  const cards = [gpu(covers.mesh, 'position'), gpu(covers.mesh, 'uv')]
  const frame = focus => { covers.update(1 / 60, focus); for (const card of cards) card.render() }
  frame({x: 0, z: 0})
  for (let count = 0; count < 120; count++) frame({x: count * 5, z: 0})
  assert.deepEqual(cards.map(card => card.stale()), [0, 0])
  assert.deepEqual(cards.map(card => card.whole), [1, 1], 'one whole upload, ranges after that')
  assert.ok(cards[0].partial > 0)
  world.ground = () => 150.2
  for (let count = 0; count < 600; count++) frame({x: 300, z: 0})
  assert.equal(cards[0].stale(), 0)
  assert.equal(cards[0].whole, 1, 'a height correction goes up as a range')
  // A second cell: every cover moves to another place in the buffer; the whole buffer goes up again.
  covers.setGraph('3_0', street([{offset: 1.5, width: 3}, {offset: 1.5, width: 3, dir: -1}], {from: 1900, to: 2600}))
  frame({x: 1950, z: 0})
  assert.deepEqual(cards.map(card => card.stale()), [0, 0], 'no cover left with old vertices on the card')
  for (let count = 0; count < 120; count++) frame({x: 1950 + count, z: 0})
  assert.deepEqual(cards.map(card => card.stale()), [0, 0])
})

test('manholeCovers: two road cells kept, drawn covers stay through a cell change, hide and show', () => {
  const {covers, run} = scene()
  run(1)
  const drawn = covers.probe().drawn, first = covers.probe().total
  assert.ok(drawn > 5)
  const far = from => street([{offset: 1.5, width: 3}, {offset: 1.5, width: 3, dir: -1}], {from, to: from + 300})
  covers.setGraph('9_0', far(4600))
  assert.equal(covers.probe().drawn, drawn, 'still drawn, without a frame of nothing')
  assert.equal(covers.probe().total, first + manholes(far(4600)).length)
  // Back into the first cell: its layout is remembered (the graph passed is not even read again).
  covers.setGraph('0_0', {nodes: [], lanes: [], signals: []})
  assert.equal(covers.probe().total, first + manholes(far(4600)).length)
  covers.setGraph('19_0', far(9800))
  assert.equal(covers.probe().total, first + manholes(far(9800)).length, 'the least recent cell (9_0) is dropped')
  assert.equal(covers.probe().drawn, drawn)
  covers.hide()
  assert.deepEqual([covers.mesh.visible, covers.probe().drawCalls], [false, 0])
  covers.update(1 / 60, {x: 0, z: 0})
  assert.deepEqual([covers.mesh.visible, covers.probe().drawCalls], [true, 1])
  covers.setGraph('29_0', far(15000))
  covers.setGraph('39_0', far(20000))
  assert.deepEqual([covers.probe().drawn, covers.mesh.visible, covers.mesh.geometry.drawRange.count], [0, false, 0], 'both old cells gone')
})
