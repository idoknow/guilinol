// IDOK-399 stage 5 — unit tests for the kerb bollards beside the signal poles: where the posts of one
// pole go (along its kerb, on pavement only, the row ending at a corner or a gap), how posts of
// different poles are thinned, and the runtime that stands them on the ground a few per frame.
// Run: node --import tsx --test scripts/test-bollards.mjs   (part of `npm run verify:street-furniture`)
import assert from 'node:assert/strict'
import {test} from 'node:test'
import * as THREE from 'three'
import {
  BOLLARD_CLASH,
  BOLLARD_HEIGHT,
  BOLLARD_INSET,
  BOLLARD_MIN_GAP,
  BOLLARD_POLE_CLEARANCE,
  BOLLARD_RADIUS,
  BOLLARD_SPACING,
  placeBollards,
  separateBollards,
} from '../web/src/traffic/bollard-layout.ts'
import {bollards} from '../web/src/traffic/bollards.ts'
import {approachHeight, placeSignalHead} from '../web/src/traffic/signal-approach.ts'

const ROAD = 0, SIDEWALK = 1, GREEN = 4, GUARDRAIL = 5
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
const keysOf = posts => posts.map(post => post.key).sort()

// An approach driving +x into a signal node at x = shift + 60. Its rightmost lane centre is at z = 1.5
// (right of +x is +z); 3 m of carriageway right of that, then 4 m of pavement, then nothing in the tiles.
const LANE_RIGHT = 1.5, KERB = 3, PAVEMENT = 4
const KERB_Z = LANE_RIGHT + KERB, POST_Z = KERB_Z + BOLLARD_INSET
function approachAt(shift = 0, key = '10>20', extra = {}) {
  return {
    key, node: 20, group: 1, lane: 100, lanes: [100], endX: shift + 60, endZ: 0, cls: 'primary',
    path: [{endX: shift + 60, endY: 150, endZ: 0, headingX: 1, headingZ: 0, length: 60, right: LANE_RIGHT}],
    reach: 60,
    ...extra,
  }
}
/** Carriageway, then pavement (`outside` beyond it), then nothing the tiles know of. */
const kerbside = ({kerbAt = () => KERB, outside = () => [SIDEWALK]} = {}) => (x, z) => {
  const right = z - LANE_RIGHT, kerb = kerbAt(x)
  if (right < kerb) return [ROAD]
  if (right < kerb + PAVEMENT) return outside(x, z)
  return []
}
const baseSurface = kerbside()
function pole(approach = approachAt(), surfaceAt = baseSurface) {
  const placement = placeSignalHead(approach, surfaceAt)
  assert.equal(typeof placement, 'object', `precondition: the signal head finds its kerb (got ${placement})`)
  return placement
}

test('placeBollards: two posts each side of the pole along its kerb, BOLLARD_INSET behind it, BOLLARD_SPACING apart', () => {
  const approach = approachAt(), placement = pole(approach)
  // The pole: 5 m before the node, kerb 3 m from the lane centre, 0.75 m behind the kerb.
  assert.deepEqual([placement.back, placement.kerb, placement.x, placement.z], [5, KERB, 55, KERB_Z + .75])
  const posts = placeBollards(approach, placement, baseSurface)
  assert.ok(Array.isArray(posts), `expected posts, got ${posts}`)
  // Toward the node first (back 3.5, 2), then away from it (6.5, 8).
  const z = +POST_Z.toFixed(9)
  assert.deepEqual(posts.map(post => [post.key, post.x, +post.z.toFixed(9)]), [
    ['10>20#-1', 56.5, z], ['10>20#-2', 58, z], ['10>20#1', 53.5, z], ['10>20#2', 52, z],
  ])
  assert.deepEqual(placeBollards(approach, placement, baseSurface), posts, 'same input, same posts')
  for (const post of posts) {
    assert.deepEqual(baseSurface(post.x, post.z), [SIDEWALK], `${post.key} stands on the pavement`)
    assert.equal(post.y, 150, `${post.key} y is the road height`)
    assert.equal(post.yaw, placement.yaw, `${post.key} faces like the pole`)
    const fromPole = Math.hypot(post.x - placement.x, post.z - placement.z)
    assert.ok(fromPole >= BOLLARD_POLE_CLEARANCE, `${post.key} is ${fromPole} m from its pole`)
  }
  for (const side of ['-', '']) {
    const [inner, outer] = [posts.find(post => post.key === `10>20#${side}1`), posts.find(post => post.key === `10>20#${side}2`)]
    const centres = Math.hypot(inner.x - outer.x, inner.z - outer.z)
    assert.ok(near(centres, BOLLARD_SPACING), `side ${side || '+'}: ${centres} m between centres`)
    assert.ok(centres - 2 * BOLLARD_RADIUS >= BOLLARD_MIN_GAP, `side ${side || '+'}: clear gap ${centres - 2 * BOLLARD_RADIUS} m < BOLLARD_MIN_GAP`)
  }
  // Nothing beyond two a side, whatever the kerb is like.
  assert.ok(posts.filter(post => post.key.includes('#-')).length <= 2 && posts.filter(post => !post.key.includes('#-')).length <= 2)
  // The separation the runtime applies across poles is narrower than the row's own spacing: a row is never thinned by it.
  assert.ok(near(BOLLARD_CLASH, BOLLARD_MIN_GAP + 2 * BOLLARD_RADIUS))
  assert.ok(BOLLARD_SPACING > BOLLARD_CLASH)
  assert.deepEqual(separateBollards(posts, [placement]).map(post => post.key), keysOf(posts))
})

test('placeBollards: the row stops 2 m from the node (junction mouth) and 0.5 m short of the end of the approach', () => {
  const approach = approachAt()
  // A pole 4 m from the node: the second post toward it would be 1 m out, inside the junction mouth.
  const close = {...pole(approach), back: 4, x: 56}
  assert.deepEqual(keysOf(placeBollards(approach, close, baseSurface)), ['10>20#-1', '10>20#1', '10>20#2'])
  // An approach only 7.4 m long: the post 8 m back would be past its end.
  const short = approachAt(0, '10>20', {reach: 7.4})
  assert.deepEqual(keysOf(placeBollards(short, pole(approach), baseSurface)), ['10>20#-1', '10>20#-2', '10>20#1'])
})

test('placeBollards: \'pending\' while a tile under the kerb scan or a post is missing — never a part row', () => {
  const approach = approachAt(), placement = pole(approach)
  // The tile west of x = 53 is not there: the kerb scan for the post 8 m back (x = 52) cannot be done.
  assert.equal(placeBollards(approach, placement, (x, z) => x < 53 ? undefined : baseSurface(x, z)), 'pending', 'even though three posts could be placed')
  // Only the spot of post #1 (x = 53.5, z = 4.9) is missing; the kerb scan never looks there.
  const hole = (x, z) => Math.abs(x - 53.5) < .05 && Math.abs(z - POST_Z) < .05 ? undefined : baseSurface(x, z)
  assert.equal(placeBollards(approach, placement, hole), 'pending')
  // Once the tile is there, the whole row.
  assert.equal(placeBollards(approach, placement, baseSurface).length, 4)
})

test('placeBollards: posts stand where the surface is not carriageway (0), guardrail (5) or verge (4) — bare ground included; the row ends at the first that is', () => {
  const approach = approachAt(), placement = pole(approach)
  // Override what the tiles say right under post #-1 (x = 56.5); the kerb scan never samples there.
  const under = kinds => (x, z) => Math.abs(x - 56.5) < .05 && Math.abs(z - POST_Z) < .05 ? kinds : baseSurface(x, z)
  const all = ['10>20#-1', '10>20#-2', '10>20#1', '10>20#2'], away = ['10>20#1', '10>20#2']
  for (const [kinds, expected] of [
    [[SIDEWALK], all], [[], all], [[2], all], [[3], all], [[6], all], [[SIDEWALK, 3], all],
    [[GREEN], away], [[GUARDRAIL], away], [[ROAD], away], [[SIDEWALK, GUARDRAIL], away], [[SIDEWALK, GREEN], away], [[SIDEWALK, ROAD], away],
  ]) {
    const posts = placeBollards(approach, placement, under(kinds))
    assert.deepEqual(keysOf(posts), expected, `surface [${kinds}] under #-1: #-2 goes with it, the other side stays`)
  }
  // The block behind the kerb is plain ground the street tiles say nothing about (an empty list): posts as usual.
  const bare = kerbside({outside: () => []})
  assert.deepEqual(keysOf(placeBollards(approach, pole(approach, bare), bare)), all)
  // A planted verge behind the kerb on the far side of the pole (x < 54.5): only the row toward the node.
  const verge = kerbside({outside: x => x < 54.5 ? [GREEN] : [SIDEWALK]})
  const posts = placeBollards(approach, pole(approach, verge), verge)
  assert.deepEqual(keysOf(posts), ['10>20#-1', '10>20#-2'])
  for (const post of posts) assert.deepEqual(verge(post.x, post.z), [SIDEWALK])
})

test('placeBollards: a kerb that moves more than KERB_DRIFT (0.75 m) ends the row; a smaller shift is followed', () => {
  const approach = approachAt()
  for (const [label, kerbAt] of [
    ['carriageway 2 m wider toward the node (a flare)', x => x > 55.5 ? KERB + 2 : KERB],
    ['no kerb within 18 m toward the node (a square)', x => x > 55.5 ? 40 : KERB],
  ]) {
    const surfaceAt = kerbside({kerbAt}), placement = pole(approach, surfaceAt)
    assert.equal(placement.kerb, KERB, `${label}: precondition, the pole is on the straight kerb`)
    assert.deepEqual(keysOf(placeBollards(approach, placement, surfaceAt)), ['10>20#1', '10>20#2'], label)
  }
  // The lane centre itself is off the road toward the node: no kerb to measure, the row stops.
  const offRoad = (x, z) => x > 55.5 && z < 3 ? [SIDEWALK] : baseSurface(x, z)
  assert.deepEqual(keysOf(placeBollards(approach, pole(approach), offRoad)), ['10>20#1', '10>20#2'])
  // Half a metre wider: still the same kerb; the posts follow it.
  const nudged = kerbside({kerbAt: x => x > 55.5 ? KERB + .5 : KERB})
  const posts = placeBollards(approach, pole(approach, nudged), nudged)
  assert.deepEqual(keysOf(posts), ['10>20#-1', '10>20#-2', '10>20#1', '10>20#2'])
  for (const post of posts) assert.ok(near(post.z, (post.x > 55.5 ? KERB_Z + .5 : KERB_Z) + BOLLARD_INSET), `${post.key} at z ${post.z}: BOLLARD_INSET behind its own kerb`)
})

test('placeBollards: a post that would crowd its own pole is skipped, the row carries on', () => {
  const approach = approachAt()
  // The pole as found, moved next to where #-1 goes (as on a bent approach).
  const crowded = {...pole(approach), x: 56.5, z: POST_Z + .5}
  const posts = placeBollards(approach, crowded, baseSurface)
  assert.deepEqual(keysOf(posts), ['10>20#-2', '10>20#1', '10>20#2'])
  for (const post of posts) assert.ok(Math.hypot(post.x - crowded.x, post.z - crowded.z) >= BOLLARD_POLE_CLEARANCE, `${post.key} crowds the pole`)
})

test('placeBollards: post height follows the approach profile; a path in pieces gives the same posts as one piece', () => {
  const profiled = approachAt(0, '10>20', {path: [{...approachAt().path[0], heights: [0, 140, 1, 150]}]})
  const posts = placeBollards(profiled, pole(profiled), baseSurface)
  assert.equal(posts.length, 4)
  for (const post of posts) {
    const back = 60 - post.x
    assert.ok(near(post.y, approachHeight(profiled, back), 1e-9), `${post.key}: y ${post.y}`)
    assert.ok(near(post.y, 140 + 10 * (1 - back / 60), 1e-9), `${post.key}: y ${post.y}, expected the profile 140 → 150 toward the node`)
  }
  // The same straight approach as two pieces: 4 m next to the node, then 56 m.
  const pieces = approachAt(0, '10>20', {path: [
    {endX: 60, endY: 150, endZ: 0, headingX: 1, headingZ: 0, length: 4, right: LANE_RIGHT},
    {endX: 56, endY: 150, endZ: 0, headingX: 1, headingZ: 0, length: 56, right: LANE_RIGHT},
  ]})
  const split = placeBollards(pieces, pole(pieces), baseSurface)
  assert.deepEqual(split.map(post => [post.key, post.x.toFixed(9), post.z.toFixed(9)]), placeBollards(approachAt(), pole(), baseSurface).map(post => [post.key, post.x.toFixed(9), post.z.toFixed(9)]))
})

test('separateBollards: smaller key wins a clash, posts near any pole go, across grid cells and zero; order does not matter', () => {
  const post = (key, x, z = 5) => ({key, x, y: 150, z, yaw: -Math.PI / 2})
  const all = [
    post('9>20#1', 10 + BOLLARD_CLASH - .1), // clashes with 1>20#1, larger key: dropped
    post('1>20#1', 10),
    post('3>20#1', 20),
    post('4>20#1', 20 + BOLLARD_CLASH + .05), // just clear of 3>20#1: kept
    post('2>20#1', 30 + BOLLARD_POLE_CLEARANCE - .05), // too close to the pole at x = 30
    post('2>20#2', 30 + BOLLARD_POLE_CLEARANCE + .05), // clear of it
    post('7>20#1', 40.5), // clashes with 6>20#1 in the next grid cell
    post('6>20#1', 39.5),
    post('5>20#-1', 50),
    post('8>20#1', -.4, -60), post('8>20#2', .4, -60), // either side of zero: clash
  ]
  const poles = [{x: 30, z: 5}, {x: 80, z: 5}]
  const kept = separateBollards(all, poles)
  assert.deepEqual(kept.map(item => item.key), ['1>20#1', '2>20#2', '3>20#1', '4>20#1', '5>20#-1', '6>20#1', '8>20#1'])
  for (let index = 1; index < kept.length; index++) assert.ok(kept[index - 1].key < kept[index].key, 'returned in key order')
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      const apart = Math.hypot(kept[i].x - kept[j].x, kept[i].z - kept[j].z)
      assert.ok(apart >= BOLLARD_CLASH && apart - 2 * BOLLARD_RADIUS >= BOLLARD_MIN_GAP, `${kept[i].key} and ${kept[j].key} only ${apart} m apart`)
    }
    for (const pole of poles) assert.ok(Math.hypot(kept[i].x - pole.x, kept[i].z - pole.z) >= BOLLARD_POLE_CLEARANCE, `${kept[i].key} crowds a pole`)
  }
  assert.deepEqual(separateBollards([...all].reverse(), [...poles].reverse()), kept)
  for (const seed of [1, 2, 3, 7]) assert.deepEqual(separateBollards(shuffled(all, seed), shuffled(poles, seed + 10)), kept, `shuffled with seed ${seed}`)
  assert.equal(all[0].key, '9>20#1', 'input left as it was')
  assert.deepEqual(separateBollards([], poles), [])
  // Without poles the post by the pole stays — and then its neighbour 0.1 m on clashes with it.
  assert.deepEqual(separateBollards(all, []).map(item => item.key), ['1>20#1', '2>20#1', '3>20#1', '4>20#1', '5>20#-1', '6>20#1', '8>20#1'])
})

// ——— runtime ———

/** Signal heads as the posts see them: a revision and the placed poles. */
function headsOf(items) {
  const heads = {revision: 1, visits: 0, items, placed(visit) { heads.visits++; for (const {approach, placement} of heads.items) visit(approach, placement) }}
  return heads
}
/** `drawn`: a stand-in for `drawn-ground.ts` (height of the ground as drawn); left out, the posts get no such reader. */
function town({shifts = [0], walked = () => 150.15, driven = () => 150.12, drawn} = {}) {
  const scene = new THREE.Scene()
  const world = {tiles: true, walked, driven, drawn, calls: 0, surfaceCalls: 0, drawnCalls: 0}
  const groundAt = (x, z, reference, car) => {
    world.calls++
    assert.equal(reference, 150, 'asked near the road height of the approach')
    return car ? world.driven(x, z) : world.walked(x, z)
  }
  const surfaceAt = (x, z) => { world.surfaceCalls++; return world.tiles ? baseSurface(x, z) : undefined }
  const drawnAt = drawn && ((x, z, near) => { world.drawnCalls++; return world.drawn(x, z, near) })
  const posts = bollards(scene, groundAt, surfaceAt, drawnAt)
  const heads = headsOf(shifts.map((shift, index) => {
    const approach = approachAt(shift, `${index + 1}>20`)
    return {approach, placement: pole(approach)}
  }))
  const frame = (focus = {x: 55, z: 0}) => { posts.sync(heads); posts.update(1 / 60, focus) }
  const run = (seconds, focus) => { for (let time = 0; time < seconds; time += 1 / 60) frame(focus) }
  /** Base of each drawn instance, from the instance matrices. */
  const bases = () => {
    const matrix = new THREE.Matrix4(), out = []
    for (let index = 0; index < posts.mesh.count; index++) {
      posts.mesh.getMatrixAt(index, matrix)
      out.push([+matrix.elements[12].toFixed(3), +matrix.elements[13].toFixed(3), +matrix.elements[14].toFixed(3)].join())
    }
    return out.sort()
  }
  const drawnBases = () => posts.probe().posts.filter(post => post.state === 'drawn').map(post => [+post.x.toFixed(3), +post.y.toFixed(3), +post.z.toFixed(3)].join()).sort()
  return {scene, world, posts, heads, frame, run, bases, drawnBases}
}

test('bollards: one instanced mesh; one pole worked out per frame, at most four posts (eight ground reads) stood up per frame', () => {
  const {scene, world, posts, heads, frame, bases, drawnBases} = town({shifts: [0, 30, -40]})
  assert.ok(posts.mesh.isInstancedMesh)
  assert.equal(posts.mesh.parent, scene)
  assert.deepEqual([posts.mesh.count, posts.mesh.visible, posts.probe().drawCalls], [0, false, 0])
  assert.ok(posts.mesh.material.vertexColors && posts.mesh.geometry.getAttribute('color'), 'one material, colours per vertex')
  assert.equal(posts.mesh.userData.noShadowCast, true)
  posts.sync(heads)
  assert.deepEqual([posts.probe().pending, posts.probe().total], [3, 0])
  for (const [count, expected] of [[1, 4], [2, 8], [3, 12]]) {
    const before = world.calls
    frame()
    const probe = posts.probe()
    assert.deepEqual([probe.pending, probe.total, probe.drawn], [3 - count, expected, expected], `frame ${count}: one more pole, its four posts stood up`)
    assert.equal(world.calls - before, 8, `frame ${count}: four posts, a walking and a driving read each`)
    assert.deepEqual([posts.mesh.count, posts.mesh.visible, probe.drawCalls], [expected, true, 1])
  }
  assert.equal(heads.visits, 1, 'the poles are read once per revision of the heads')
  let most = 0
  for (let count = 0; count < 300; count++) {
    const before = world.calls
    frame()
    most = Math.max(most, world.calls - before)
  }
  assert.ok(most <= 8, `${most} ground reads in one frame`)
  assert.deepEqual(bases(), drawnBases(), 'the instance matrices hold exactly the posts the probe calls drawn')
  const probe = posts.probe()
  for (let i = 0; i < probe.posts.length; i++) for (let j = i + 1; j < probe.posts.length; j++) {
    const a = probe.posts[i], b = probe.posts[j]
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) - 2 * BOLLARD_RADIUS >= BOLLARD_MIN_GAP, `${a.key} and ${b.key} too close`)
  }
  for (const item of probe.posts) for (const {placement} of heads.items) {
    assert.ok(Math.hypot(item.x - placement.x, item.z - placement.z) >= BOLLARD_POLE_CLEARANCE, `${item.key} crowds a pole`)
  }
})

test('bollards: the base is the lower of the walking and the driving ground, when they are within 0.6 m', () => {
  for (const [label, walked, driven, expected] of [
    ['driving ground a little lower (the paving as drawn)', 150.15, 150.12, 150.12],
    ['no driving ground there', 150.15, undefined, 150.15],
    ['driving ground 0.65 m lower: something else (a pit, an underpass)', 150.15, 149.5, 150.15],
    ['driving ground higher', 150.1, 150.3, 150.1],
  ]) {
    const {posts, run, bases} = town({walked: () => walked, driven: () => driven})
    run(.1)
    const probe = posts.probe()
    assert.equal(probe.drawn, 4, label)
    for (const post of probe.posts) assert.ok(near(post.y, expected, 1e-9), `${label}: ${post.key} at ${post.y}, expected ${expected}`)
    assert.ok(bases().every(base => near(+base.split(',')[1], expected, 1e-3)), `${label}: instance matrices at ${bases()}`)
  }
  // No walking ground yet: nothing stood up, asked again 1.5 s later.
  const late = town({walked: () => undefined})
  late.run(1)
  assert.deepEqual([late.posts.probe().drawn, late.posts.probe().waiting], [0, 4])
  const reads = late.world.calls
  late.world.walked = () => 150.15
  late.run(1)
  assert.equal(late.posts.probe().drawn, 4)
  assert.ok(late.world.calls > reads)
  // A deck 2 m above the road: never stood up, given up after six readings, retried every 30 s.
  const deck = town({walked: () => 152, driven: () => 152})
  deck.run(10)
  assert.deepEqual([deck.posts.probe().drawn, deck.posts.probe().none], [0, 4])
  deck.world.walked = () => 150.15
  deck.run(30)
  assert.equal(deck.posts.probe().drawn, 4, 'a later right reading stands it up')
})

test('bollards: post and collar carry on BURIED (0.3 m) below the base; the cap is BOLLARD_HEIGHT up', () => {
  const {posts} = town()
  const geometry = posts.mesh.geometry
  geometry.computeBoundingBox()
  assert.ok(near(geometry.boundingBox.min.y, -.3, 1e-6), `lowest vertex at ${geometry.boundingBox.min.y}`)
  assert.ok(geometry.boundingBox.max.y > BOLLARD_HEIGHT && geometry.boundingBox.max.y < BOLLARD_HEIGHT + BOLLARD_RADIUS, `top at ${geometry.boundingBox.max.y}`)
  const position = geometry.getAttribute('position'), radii = new Set()
  for (let index = 0; index < position.count; index++) {
    if (near(position.getY(index), -.3, 1e-6)) radii.add(Math.hypot(position.getX(index), position.getZ(index)).toFixed(3))
  }
  assert.ok(radii.has(BOLLARD_RADIUS.toFixed(3)), `the post body reaches down to -0.3 (radii there: ${[...radii]})`)
  assert.ok(radii.has((BOLLARD_RADIUS + .035).toFixed(3)), `the collar reaches down to -0.3 (radii there: ${[...radii]})`)
  assert.ok(Math.max(...[...radii].map(Number)) <= BOLLARD_RADIUS + .035 + 1e-9, 'nothing wider than the collar under the pavement')
})

test('bollards: settled after three equal readings a second apart, then read once every eight seconds; a change is picked up', () => {
  const {world, posts, run} = town()
  run(.1)
  assert.deepEqual([posts.probe().drawn, posts.probe().settled, world.calls], [4, 0, 8])
  run(1)
  assert.equal(posts.probe().settled, 0)
  run(1)
  assert.deepEqual([posts.probe().settled, world.calls], [4, 24], 'three equal readings: settled')
  run(6)
  assert.equal(world.calls, 24, 'settled posts are left alone in between')
  run(8)
  assert.equal(world.calls, 32, 'one look per post per eight seconds')
  world.walked = () => 150.2
  world.driven = () => 150.25
  run(2.2)
  assert.equal(posts.probe().settled, 0, 'a new height starts the count again')
  assert.ok(posts.probe().posts.every(post => near(post.y, 150.2, 1e-9)))
  run(2.5)
  assert.equal(posts.probe().settled, 4)
})

test('bollards: a drawn post whose ground reads out of band keeps its height and backs off to one look per 30 s', () => {
  const {world, posts, run} = town()
  run(.1); run(1); run(1)
  assert.equal(posts.probe().settled, 4)
  // A deck loads over the kerb: every reading is now more than 0.6 m from the road.
  world.walked = () => 152
  world.driven = () => 152
  run(18)
  const calls = world.calls
  run(25)
  assert.equal(world.calls, calls, 'after six wrong readings 1.5 s apart: not asked again for 30 s')
  run(30)
  assert.equal(world.calls, calls + 8, 'then one look per post per 30 s')
  assert.ok(posts.probe().posts.every(post => post.state === 'drawn' && near(post.y, 150.12, 1e-9)), 'the posts stay where they stood')
  // The deck goes: the next look is taken at face value again.
  world.walked = () => 150.15
  world.driven = () => 150.12
  run(31)
  world.walked = () => 152
  world.driven = () => 152
  const again = world.calls
  run(8 + 1.5 * 2)
  assert.ok(world.calls - again >= 16, 'a good reading in between starts the count of wrong ones afresh')
})

test('bollards: poles wait for their tiles and the player; posts beyond 140 m are not stood up; kerb checks are kept for the session', () => {
  const {world, posts, heads, frame, run} = town()
  world.tiles = false
  frame()
  assert.deepEqual([posts.probe().pending, posts.probe().total], [1, 0], 'street tile missing: the pole stays pending')
  const asked = world.surfaceCalls
  run(1)
  assert.equal(world.surfaceCalls, asked, 'not asked again for 1.5 s')
  world.tiles = true
  run(1)
  assert.deepEqual([posts.probe().pending, posts.probe().total, posts.probe().drawn], [0, 4, 4])
  // A new revision of the heads with the same poles: nothing is worked out again.
  const surfaceCalls = world.surfaceCalls
  heads.revision++
  run(1)
  assert.equal(world.surfaceCalls, surfaceCalls, 'resolved poles are not checked again')
  assert.deepEqual([heads.visits, posts.probe().drawn], [2, 4])
  // The pole is gone from the heads (a cell change): so are its posts, and they stop blocking.
  heads.items = []
  heads.revision++
  frame()
  assert.deepEqual([posts.probe().total, posts.mesh.count, posts.mesh.visible], [0, 0, false])
  const touched = []
  posts.near(55, POST_Z, solid => touched.push(solid))
  assert.equal(touched.length, 0)

  // Player 300 m away: the pole (within 420 m) is worked out, its posts (beyond 140 m) wait.
  const far = town()
  far.run(1, {x: 355, z: 0})
  assert.deepEqual([far.posts.probe().total, far.posts.probe().drawn, far.world.calls], [4, 0, 0])
  far.run(.1, {x: 100, z: 0})
  assert.equal(far.posts.probe().drawn, 4)
  // 500 m away: not even the pole.
  const farther = town()
  farther.run(1, {x: 555, z: 0})
  assert.deepEqual([farther.posts.probe().pending, farther.world.surfaceCalls], [1, 0])
})

test('bollards: two poles reaching for the same kerb — the posts of the smaller key stay', () => {
  const scene = new THREE.Scene()
  const posts = bollards(scene, () => 150.1, baseSurface)
  const a = approachAt(0, '2>20'), b = approachAt(0, '1>20')
  const heads = headsOf([{approach: a, placement: pole(a)}, {approach: b, placement: pole(b)}])
  for (let count = 0; count < 10; count++) { posts.sync(heads); posts.update(1 / 60, {x: 55, z: 0}) }
  assert.deepEqual(keysOf(posts.probe().posts), ['1>20#-1', '1>20#-2', '1>20#1', '1>20#2'])
  assert.equal(posts.probe().drawn, 4)
})

test('bollards: solid for the player while shown; hide and show', () => {
  const {posts, run, frame} = town()
  run(.1)
  const touched = []
  posts.near(53.5, POST_Z, solid => touched.push(solid))
  assert.equal(touched.length, 4, 'all four posts are in the contact grid cell')
  for (const solid of touched) {
    assert.ok(solid.halfWidth > BOLLARD_RADIUS && solid.halfWidth < BOLLARD_RADIUS + .05, `half width ${solid.halfWidth}`)
    assert.deepEqual([solid.y, solid.height], [150.12, BOLLARD_HEIGHT], 'from the base up the height of a post')
  }
  posts.hide()
  assert.deepEqual([posts.mesh.visible, posts.probe().drawCalls], [false, 0])
  const hidden = []
  posts.near(53.5, POST_Z, solid => hidden.push(solid))
  assert.equal(hidden.length, 0, 'hidden posts block nothing')
  frame()
  assert.deepEqual([posts.mesh.visible, posts.probe().drawCalls], [true, 1])
})

// ——— the ground as drawn ———

/** Every post's base, rounded to the millimetre. */
const basesOf = posts => posts.probe().posts.map(post => +post.y.toFixed(3))

test('bollards: with a drawn-ground reading the base is the ground as drawn; none, or more than 0.6 m off the collider, and it is the collider', () => {
  // Collider: walking 150.15, driving 150.12 → 150.12, as before.
  for (const [label, drawn, expected] of [
    ['drawn ground 17 cm below the collider (coarse ground mesh beside the kerb)', 149.95, 149.95],
    ['drawn ground a little above the collider (a drawn pavement)', 150.3, 150.3],
    ['nothing drawn that can be read (null)', null, 150.12],
    ['drawn ground 0.72 m below: something else (a pit, a tunnel floor) — ignored', 149.4, 150.12],
    ['drawn ground 0.68 m above: something else (a deck) — ignored', 150.8, 150.12],
  ]) {
    const {posts, run, bases} = town({drawn: () => drawn})
    run(1)
    assert.equal(posts.probe().drawn, 4, label)
    assert.ok(posts.probe().posts.every(post => near(post.y, expected, 1e-9) && near(post.support, 150.12, 1e-9)), `${label}: bases ${basesOf(posts)}`)
    assert.ok(bases().every(base => near(+base.split(',')[1], expected, 1e-3)), `${label}: instance matrices at ${bases()}`)
    assert.equal(posts.probe().onDrawn, expected === 150.12 ? 0 : 4, label)
    // The collider: from the lower of drawn base and collider to a post's height above the higher.
    const touched = []
    posts.near(53.5, POST_Z, solid => touched.push(solid))
    assert.equal(touched.length, 4)
    for (const solid of touched) {
      assert.ok(near(solid.y, Math.min(expected, 150.12), 1e-9), `${label}: collider from ${solid.y}`)
      assert.ok(near(solid.y + solid.height, Math.max(expected, 150.12) + BOLLARD_HEIGHT, 1e-9), `${label}: collider top ${solid.y + solid.height}`)
      assert.ok(solid.y + solid.height >= 150.12 + BOLLARD_HEIGHT - 1e-9, `${label}: a player on the collider meets as tall a post as before`)
    }
  }
})

test('bollards: no drawn-ground reader, or one that never knows — the posts stand on the collider and do not move', () => {
  const plain = town()
  plain.run(3)
  assert.deepEqual(basesOf(plain.posts), [150.12, 150.12, 150.12, 150.12])
  assert.equal(plain.posts.probe().onDrawn, 0)
  // A tile that never arrives: asked once a frame for 5 s (one post a frame), then left to the 30 s recheck.
  const {world, posts, frame, run} = town({drawn: () => undefined})
  const seen = new Set()
  for (let time = 0; time < 6; time += 1 / 60) { frame(); for (const y of basesOf(posts)) seen.add(y) }
  assert.deepEqual([...seen], [150.12], 'never anywhere but on the collider, never hidden')
  assert.equal(posts.probe().drawn, 4)
  const calls = world.drawnCalls
  assert.ok(calls > 0 && calls <= 6 * 60 + 1, `${calls} drawn-ground reads in 6 s`)
  run(20)
  assert.equal(world.drawnCalls, calls, 'given up: not asked again before 30 s')
  // The tile turns up: the first look 30 s after giving up stands the posts on it.
  world.drawn = () => 149.95
  run(18)
  assert.deepEqual(basesOf(posts), [149.95, 149.95, 149.95, 149.95])
})

test('bollards: a drawn reading still being taken in — the post waits on the collider, then moves down once', () => {
  let ready = false
  const {world, posts, frame} = town({drawn: () => ready ? 149.95 : undefined})
  const heights = new Map()
  for (let time = 0; time < 4; time += 1 / 60) {
    if (time > 1) ready = true
    frame()
    for (const post of posts.probe().posts) {
      if (post.state !== 'drawn') continue
      const list = heights.get(post.key) ?? []
      if (list.at(-1) !== +post.y.toFixed(3)) list.push(+post.y.toFixed(3))
      heights.set(post.key, list)
    }
  }
  assert.equal(heights.size, 4)
  for (const [key, list] of heights) assert.deepEqual(list, [150.12, 149.95], `${key}: ${list}`)
  assert.ok(world.drawnCalls <= 4 * 60 + 4, `${world.drawnCalls} reads`)
})

test('bollards: the wait for a reading starts afresh after the player was away — no 30 s lock on the collider', () => {
  let ready = false
  const {world, posts, run} = town({drawn: () => ready ? 149.95 : undefined})
  run(2)
  assert.deepEqual(basesOf(posts), [150.12, 150.12, 150.12, 150.12])
  // Away for longer than DRAWN_WAIT (5 s), then back with the tile still being taken in for a second.
  run(7, {x: 55, z: 400})
  run(1)
  ready = true
  run(3)
  assert.deepEqual(basesOf(posts), [149.95, 149.95, 149.95, 149.95], `${world.drawnCalls} reads`)
})

test('bollards: at most one drawn-ground reading per frame, the eight collider reads unchanged', () => {
  const {world, posts, frame} = town({shifts: [0, 30, -40], drawn: () => 149.95})
  let mostDrawn = 0, mostGround = 0
  for (let count = 0; count < 600; count++) {
    const drawnBefore = world.drawnCalls, groundBefore = world.calls
    frame()
    mostDrawn = Math.max(mostDrawn, world.drawnCalls - drawnBefore)
    mostGround = Math.max(mostGround, world.calls - groundBefore)
  }
  assert.equal(mostDrawn, 1, 'one drawn-ground reading a frame')
  assert.ok(mostGround <= 8, `${mostGround} collider reads in one frame`)
  const probe = posts.probe()
  assert.deepEqual([probe.drawn, probe.onDrawn, probe.settled], [12, 12, 12], 'all twelve on the drawn ground and settled within 10 s')
  assert.equal(world.drawnCalls, 12, 'one reading per post')
})

test('bollards: settled posts keep their drawn reading; read again only when the collider moves or after 30 s', () => {
  const {world, posts, run} = town({drawn: () => 149.95})
  run(.1); run(1); run(1)
  assert.deepEqual([posts.probe().settled, posts.probe().onDrawn, world.drawnCalls, world.calls], [4, 4, 4, 24], 'three equal readings: settled, one drawn read each')
  run(24)
  assert.deepEqual([world.drawnCalls, posts.probe().settled], [4, 4], 'the eight-second collider rechecks do not read the drawn ground again')
  run(10)
  assert.equal(world.drawnCalls, 8, 'the first recheck 30 s after the reading reads it once more')
  assert.equal(posts.probe().settled, 4, 'the same reading: still settled')
  // The collider moves (a late tile): the drawn ground is read again at the next look and followed.
  world.walked = () => 150.2
  world.driven = () => 150.25
  world.drawn = () => 150.03
  run(6.5)
  assert.equal(world.drawnCalls, 12)
  assert.ok(posts.probe().posts.every(post => near(post.y, 150.03, 1e-9) && near(post.support, 150.2, 1e-9)), `bases ${basesOf(posts)}`)
  assert.equal(posts.probe().settled, 0, 'a new height starts the count again')
  run(3)
  assert.deepEqual([posts.probe().settled, world.drawnCalls], [4, 12])
})

test('bollards: a deck over the kerb still backs the posts off to 30 s; the drawn ground is not read for it', () => {
  const {world, posts, run} = town({drawn: () => 149.95})
  run(.1); run(1); run(1)
  world.walked = () => 152
  world.driven = () => 152
  const before = world.drawnCalls
  run(60)
  assert.equal(world.drawnCalls, before, 'out-of-band collider readings do not ask for the drawn ground')
  assert.ok(posts.probe().posts.every(post => post.state === 'drawn' && near(post.y, 149.95, 1e-9)), 'the posts stay where they stood')
})

// ——— drawn-ground.ts ———

/** A street tile's ground as `world.ts` builds it: a group at the tile corner, its first child an unnamed textured 256 m plane. */
function groundTile(x, z, segments, height) {
  const geometry = new THREE.PlaneGeometry(256, 256, segments, segments)
  geometry.rotateX(-Math.PI / 2).translate(128, 0, 128)
  const position = geometry.getAttribute('position'), step = 256 / segments
  for (let row = 0; row <= segments; row++) for (let col = 0; col <= segments; col++) position.setY(row * (segments + 1) + col, height(col * step, row * step))
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({map: new THREE.Texture()}))
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  group.add(mesh)
  group.updateMatrixWorld(true)
  return {group, mesh}
}
const hilly = (lx, lz) => 150 + lx * .013 - lz * .007 + Math.sin(lx * .31) * .4 + Math.cos(lz * .17) * .3
const gentle = (lx, lz) => 150 + lx * .013 - lz * .007
/** Highest hit of a ray straight down through `objects`: what is drawn there. */
function rayDown(objects, x, z) {
  const raycaster = new THREE.Raycaster(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0))
  const hits = raycaster.intersectObjects(objects, false)
  return hits.length ? Math.max(...hits.map(hit => hit.point.y)) : undefined
}
/** The street surface layer: one merged mesh, world positions, `tileSlices` per tile (non-indexed, like most tiles). */
function streetLayer(material, slices) {
  const positions = [], out = []
  for (const {tile, triangles} of slices) {
    const vertexStart = positions.length / 3
    for (const triangle of triangles) positions.push(...triangle.flat())
    out.push({tile, vertexStart, count: positions.length / 3 - vertexStart, indices: null, farCount: 0})
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const mesh = new THREE.Mesh(geometry, material)
  mesh.userData.tileSlices = () => out
  mesh.updateMatrixWorld(true)
  return mesh
}
/** A pavement strip draped 0.195 m over the ground, cut into many small triangles (more than one bucketing pass). */
function pavement(tileX, tileZ, height, {x0 = 40, x1 = 200, z0 = 100, z1 = 104, step = .25} = {}) {
  const triangles = []
  for (let x = x0; x < x1; x += step) for (let z = z0; z < z1; z += step) {
    const at = (px, pz) => [tileX + px, height(px, pz) + .195, tileZ + pz]
    triangles.push([at(x, z), at(x, z + step), at(x + step, z)], [at(x, z + step), at(x + step, z + step), at(x + step, z)])
  }
  return triangles
}

test('drawnGround: reads a tile ground mesh exactly as a ray down through it would; ignores what is not a tile ground', async () => {
  const {drawnGround} = await import('../web/src/traffic/drawn-ground.ts')
  for (const segments of [32, 64]) {
    const scene = new THREE.Scene(), street = new THREE.MeshStandardMaterial({side: THREE.DoubleSide})
    const {group, mesh} = groundTile(256, 512, segments, hilly)
    // Lookalikes that are not a tile ground: named, a box, a plane of another size.
    const named = groundTile(0, 512, segments, hilly)
    named.mesh.name = 'landmark lawn'
    const box = new THREE.Group()
    box.position.set(512, 0, 512)
    box.add(new THREE.Mesh(new THREE.BoxGeometry(256, 1, 256), new THREE.MeshStandardMaterial({map: new THREE.Texture()})))
    const small = new THREE.Group()
    small.position.set(256, 0, 768)
    small.add(new THREE.Mesh(new THREE.PlaneGeometry(64, 64, 4, 4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({map: new THREE.Texture()})))
    scene.add(group, named.group, box, small)
    let clock = 0
    const drawnAt = drawnGround(scene, street, () => clock)
    assert.equal(drawnAt(300, 600, 150), undefined, 'ground found, street layer not seen yet: wait')
    clock = 2500
    let seed = 3
    for (let count = 0; count < 200; count++) {
      seed = (seed * 1103515245 + 12345) % 2147483648
      const x = 256 + (seed % 25600) / 100, z = 512 + (Math.floor(seed / 25600) % 25600) / 100
      const expected = rayDown([mesh], x, z), got = drawnAt(x, z, expected)
      assert.ok(typeof got === 'number' && near(got, expected, 1e-4), `${segments} segments at ${x}, ${z}: ${got} vs ray ${expected}`)
    }
    assert.equal(drawnAt(300, 600, 100), null, 'nothing within a metre of the asked height')
    for (const [x, z] of [[100, 600], [600, 600], [300, 800]]) assert.equal(drawnAt(x, z, 150), undefined, `${x}, ${z}: no tile ground there`)
    // The tile unloads: its ground is no longer read.
    scene.remove(group)
    assert.equal(drawnAt(300, 600, 150), undefined)
  }
})

test('drawnGround: a ground mesh with triangles cut out (tunnel mouth) is still read where it is drawn, nothing where it is cut', async () => {
  const {drawnGround} = await import('../web/src/traffic/drawn-ground.ts')
  const scene = new THREE.Scene(), street = new THREE.MeshStandardMaterial({side: THREE.DoubleSide})
  const {group, mesh} = groundTile(0, 0, 32, hilly)
  const index = mesh.geometry.index.array, keep = []
  // Cut cells in rows 10–12, columns 5–20 (both triangles), and the second triangle of cell (col 3, row 25).
  const cut = (cell, half) => {
    const col = cell % 32, row = Math.floor(cell / 32)
    return (row >= 10 && row <= 12 && col >= 5 && col <= 20) || (cell === 25 * 32 + 3 && half === 1)
  }
  for (let t = 0; t < index.length / 3; t++) if (!cut(t >> 1, t & 1)) keep.push(index[t * 3], index[t * 3 + 1], index[t * 3 + 2])
  mesh.geometry.setIndex(keep)
  scene.add(group, streetLayer(street, []))
  let clock = 0
  const drawnAt = drawnGround(scene, street, () => clock)
  assert.equal(drawnAt(1, 1, 150), undefined)
  clock = 5000
  let hits = 0, holes = 0
  for (let x = .5; x < 256; x += 3.7) for (let z = .5; z < 256; z += 3.3) {
    const expected = rayDown([mesh], x, z), got = drawnAt(x, z, expected ?? 150)
    if (expected === undefined) {
      holes++
      assert.equal(got, null, `${x}, ${z}: cut away, nothing read`)
    } else {
      hits++
      assert.ok(typeof got === 'number' && near(got, expected, 1e-4), `${x}, ${z}: ${got} vs ray ${expected}`)
    }
  }
  assert.ok(hits > 4000 && holes > 50, `${hits} drawn, ${holes} cut`)
})

test('drawnGround: the street surface layer is read on top of the ground, bucketed a few thousand triangles per reading', async () => {
  const {drawnGround, BUCKET_PER_CALL, DRAWN_REACH} = await import('../web/src/traffic/drawn-ground.ts')
  const scene = new THREE.Scene(), street = new THREE.MeshStandardMaterial({side: THREE.DoubleSide})
  const left = groundTile(-256, 0, 32, gentle), right = groundTile(0, 0, 32, gentle)
  const strip = pavement(0, 0, gentle)
  assert.ok(strip.length > BUCKET_PER_CALL * 2, `${strip.length} triangles: several bucketing passes`)
  // Another tile first in the merged buffer, so this tile's triangles start part-way in.
  const layer = streetLayer(street, [{tile: {x: -256, z: 0}, triangles: pavement(-256, 0, gentle, {x0: 10, x1: 20})}, {tile: {x: 0, z: 0}, triangles: strip}])
  scene.add(left.group, right.group, layer)
  const drawnAt = drawnGround(scene, street, () => 0)
  let waits = 0
  while (drawnAt(120, 102, 151) === undefined) assert.ok(++waits < 30, 'bucketing finishes')
  assert.equal(waits, Math.ceil(strip.length / BUCKET_PER_CALL) - 1, 'one bucketing pass per reading')
  for (const [x, z] of [[120.1, 102.3], [41.7, 100.2], [199.9, 103.9], [77, 101]]) {
    const expected = rayDown([right.mesh, layer], x, z), got = drawnAt(x, z, expected)
    assert.ok(near(got, expected, 1e-4) && near(got, gentle(x, z) + .195, 1e-3), `pavement at ${x}, ${z}: ${got} vs ray ${expected}`)
  }
  for (const [x, z] of [[120, 110], [30, 102], [210, 50]]) {
    const expected = rayDown([right.mesh, layer], x, z), got = drawnAt(x, z, expected)
    assert.ok(near(got, expected, 1e-4) && near(got, gentle(x, z), 1e-3), `bare ground at ${x}, ${z}: ${got} vs ray ${expected}`)
  }
  // The other tile is read from its own part of the buffer (small: bucketed in one pass).
  const west = rayDown([left.mesh, layer], -256 + 15, 102)
  assert.ok(near(drawnAt(-256 + 15, 102, west), west, 1e-4) && near(west, gentle(15, 102) + .195, 1e-3))
  // A surface more than DRAWN_REACH (0.6 m) from the asked height is something else: only the ground is returned.
  const ground = rayDown([right.mesh], 120, 102)
  assert.equal(DRAWN_REACH, .6)
  assert.ok(near(drawnAt(120, 102, ground - .5), ground, 1e-4), 'pavement 0.7 m above the asked height: ground only')
  // A deck edge 0.8 m up does not hide the pavement under it: neither is the other's business.
  assert.ok(near(drawnAt(120, 102, ground + .195 + .5), ground + .195, 1e-4), 'asked 0.5 m above the pavement: the pavement')
  assert.equal(drawnAt(120, 102, ground + 1.2), null, 'nothing drawn within reach of the asked height')
})

test('drawnGround: a ground mesh with triangles replaced part-way (platform ramp) is read everywhere else; the replaced cells read nothing', async () => {
  const {drawnGround} = await import('../web/src/traffic/drawn-ground.ts')
  const {refinePlatformTerrain} = await import('../web/src/platform-access.ts')
  const scene = new THREE.Scene(), street = new THREE.MeshStandardMaterial({side: THREE.DoubleSide})
  const {group, mesh} = groundTile(0, 0, 32, hilly)
  const index = mesh.geometry.index.array, position = mesh.geometry.getAttribute('position'), faces = [], replaced = new Set()
  // Cells (col 4–9, row 6): each triangle replaced by three (split at its centroid), so everything after shifts in the index buffer.
  for (let col = 4; col <= 9; col++) for (const half of [0, 1]) {
    const t = 2 * (6 * 32 + col) + half, ids = [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]]
    const [a, b, c] = ids.map(id => [position.getX(id), position.getY(id), position.getZ(id)])
    const m = [0, 1, 2].map(axis => (a[axis] + b[axis] + c[axis]) / 3)
    faces.push([ids, [a, b, m, b, c, m, c, a, m]])
    replaced.add(6 * 32 + col)
  }
  refinePlatformTerrain(mesh.geometry, faces)
  assert.equal(mesh.geometry.index.count / 3, 2 * 32 * 32 + 12 * 2)
  scene.add(group, streetLayer(street, []))
  let clock = 0
  const drawnAt = drawnGround(scene, street, () => clock)
  assert.equal(drawnAt(1, 1, 150), undefined)
  clock = 5000
  let hits = 0, ramps = 0
  for (let x = .5; x < 256; x += 3.7) for (let z = .5; z < 256; z += 3.3) {
    const expected = rayDown([mesh], x, z), got = drawnAt(x, z, expected)
    if (replaced.has(Math.floor(z / 8) * 32 + Math.floor(x / 8))) {
      ramps++
      assert.equal(got, null, `${x}, ${z}: replaced, nothing read`)
    } else {
      hits++
      assert.ok(typeof got === 'number' && near(got, expected, 1e-4), `${x}, ${z}: ${got} vs ray ${expected}`)
    }
  }
  assert.ok(hits > 5000 && ramps > 20, `${hits} drawn, ${ramps} replaced`)
})

test('drawnGround: a street surface layer that joins the scene after the ground is found, and read', async () => {
  const {drawnGround} = await import('../web/src/traffic/drawn-ground.ts')
  const scene = new THREE.Scene(), street = new THREE.MeshStandardMaterial({side: THREE.DoubleSide})
  const {group, mesh} = groundTile(0, 0, 32, gentle)
  scene.add(group)
  let clock = 0
  const drawnAt = drawnGround(scene, street, () => clock)
  const ground = rayDown([mesh], 120, 102)
  assert.equal(drawnAt(120, 102, ground), undefined, 'no street surface yet: not believed for two seconds')
  clock = 2500
  assert.ok(near(drawnAt(120, 102, ground), ground, 1e-4), 'still none: the ground')
  scene.add(streetLayer(street, [{tile: {x: 0, z: 0}, triangles: pavement(0, 0, gentle, {x0: 110, x1: 130})}]))
  clock = 5000
  let got, waits = 0
  while ((got = drawnAt(120, 102, ground)) === undefined) assert.ok(++waits < 30, 'bucketing finishes')
  assert.ok(near(got, ground + .195, 1e-4), `the pavement once the layer is there: ${got}`)
})

test('drawnGround: bucketing is bounded by bucket entries written too — long triangles take more passes', async () => {
  const {drawnGround, BUCKET_WRITES_PER_CALL} = await import('../web/src/traffic/drawn-ground.ts')
  const scene = new THREE.Scene(), street = new THREE.MeshStandardMaterial({side: THREE.DoubleSide})
  const {group} = groundTile(0, 0, 32, () => 150)
  // Twenty triangles, each over the whole tile: 32 × 32 buckets apiece.
  const sheet = height => [[1, height, 1], [1, height, 510], [510, height, 1]]
  const layer = streetLayer(street, [{tile: {x: 0, z: 0}, triangles: Array.from({length: 20}, (_, index) => sheet(150.1 + index * .01))}])
  scene.add(group, layer)
  const drawnAt = drawnGround(scene, street, () => 0)
  let got, waits = 0
  while ((got = drawnAt(60, 60, 150)) === undefined) assert.ok(++waits < 30, 'bucketing finishes')
  assert.equal(waits, Math.ceil(20 / (BUCKET_WRITES_PER_CALL / 1024)) - 1, 'eight whole-tile triangles per pass')
  assert.ok(near(got, 150.29, 1e-4), `the highest sheet: ${got}`)
})
