// IDOK-399 — unit tests for the kerbside parking bays: which bays the parked-car rows give, where
// their lines are, and that the lines end up on the road without work left running per frame.
// Run: node --import tsx --test scripts/test-parking-bays.mjs   (part of `npm run verify:parking-bays`)
import assert from 'node:assert/strict'
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {test} from 'node:test'
import {gunzipSync} from 'node:zlib'
import * as THREE from 'three'
import {parkingBayLines} from '../web/src/traffic/parking-bays.ts'
import {BAY_BOX_CLEARANCE, BAY_MOUTH_REACH, BAY_INDICES, BAY_KERB, BAY_LINE, BAY_VERTICES, BAY_WIDTH, bayCorners, baysOverlap, insideBay, parkingBays, writeBay} from '../web/src/traffic/parking-layout.ts'

const ROAD = 0, SIDEWALK = 1
const roadSide = BAY_WIDTH - BAY_KERB
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance
/** The same rows in another order, the same every run. */
function shuffled(rows, seed = 7) {
  const out = [...rows]
  for (let index = out.length - 1; index > 0; index--) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    const other = seed % (index + 1);
    [out[index], out[other]] = [out[other], out[index]]
  }
  return out
}
const shapes = bays => bays.map(bay => `${bay.key} ${bay.rear} ${bay.front} ${bay.occupied}`).sort()

// A kerb running east (yaw = π/2: heading +x, kerb on the +z side). Cars at the given distances along it.
const EAST = Math.PI / 2
const kerb = (alongs, z = 0, yaw = EAST, y = 150) => alongs.map(along => [
  +(Math.sin(yaw) * along - Math.cos(yaw) * z).toFixed(1), y, +(Math.cos(yaw) * along + Math.sin(yaw) * z).toFixed(1), yaw, 1, 'residential'])

test('parkingBays: one bay per car, empty bays in one- and two-slot gaps, meeting end to end', () => {
  const bays = parkingBays(kerb([0, 6.5, 19.5, 40, 100]))
  // 0 and 6.5 are neighbours; 6.5 → 19.5 is two slots (one empty bay); 19.5 → 40 is three slots (two
  // empty bays); 40 → 100 is too far to say anything about.
  assert.deepEqual(bays.map(bay => [bay.x, bay.occupied]), [[0, true], [6.5, true], [13, false], [19.5, true], [26.3, false], [33.2, false], [40, true], [100, true]]
    .map(([x, occupied], index) => [index === 4 || index === 5 ? bays[index].x : x, occupied]))
  assert.ok(near(bays[4].x, 19.5 + 20.5 / 3) && near(bays[5].x, 19.5 + 41 / 3), 'empty bays are spread evenly over the gap')
  assert.deepEqual([bays[0].rear, bays[6].front, bays[7].rear, bays[7].front], [3, 3, 3, 3], 'open ends are half a 6 m bay')
  for (let index = 0; index < 6; index++) {
    const bay = bays[index], next = bays[index + 1]
    assert.ok(near(bay.x + bay.front, next.x - next.rear), `bay ${index} ends where bay ${index + 1} starts`)
    assert.ok(bay.rear + bay.front >= 5.9 && bay.rear + bay.front <= 7.6, 'a bay is one slot long')
  }
  assert.equal(new Set(bays.map(bay => bay.key)).size, bays.length)
  assert.ok(bays.filter(bay => !bay.occupied).every(bay => bay.key.endsWith('~')))
  assert.deepEqual([bays[0].headingX, Math.round(bays[0].headingZ * 1e9)], [1, 0])
})

test('parkingBays: other kerbs, odd gaps and duplicate rows do not join', () => {
  // Same direction, 5 m to the side: another street. Opposite direction: the other side of the street.
  const parallel = parkingBays([...kerb([0, 6.5]), ...kerb([3, 9.5], 5)])
  assert.equal(parallel.length, 4)
  assert.equal(parallel.filter(bay => bay.rear === 3).length, 2, 'two runs of two')
  const opposite = parkingBays([...kerb([0]), ...kerb([-6.5], 0, EAST + Math.PI)])
  assert.deepEqual(opposite.map(bay => [bay.rear, bay.front]), [[3, 3], [3, 3]])
  // 9 m is neither one slot nor two: two separate bays, which still do not overlap.
  const odd = parkingBays(kerb([0, 9]))
  assert.deepEqual(odd.map(bay => [bay.rear, bay.front]), [[3, 3], [3, 3]])
  assert.equal(parkingBays([...kerb([0]), ...kerb([0])]).length, 1, 'the same row twice is one bay')
  // The same spot under two headings (two carriageways, two cells): one bay, the same one either way round.
  const twice = [...kerb([0]), ...kerb([0], 0, EAST + 1)]
  assert.deepEqual(parkingBays(twice), parkingBays(twice.reverse()))
  assert.equal(parkingBays(twice).length, 1)
  assert.deepEqual(parkingBays([]), [])
})

test('parkingBays: works along any heading', () => {
  for (const yaw of [0, .7, 2.1, -1.3, Math.PI]) {
    const bays = parkingBays(kerb([0, 7, 14, 28], 12, yaw))
    assert.equal(bays.length, 5, `yaw ${yaw}`)
    assert.equal(bays.filter(bay => !bay.occupied).length, 1)
    for (const bay of bays) {
      // The kerb is to the right of travel; with x east and z south that is (-headingZ, headingX).
      assert.ok(insideBay(bay, bay.x - bay.headingZ * (BAY_KERB - .01), bay.z + bay.headingX * (BAY_KERB - .01)))
      assert.ok(!insideBay(bay, bay.x - bay.headingZ * (BAY_KERB + .1), bay.z + bay.headingX * (BAY_KERB + .1)), 'the pavement is outside')
      assert.ok(insideBay(bay, bay.x + bay.headingZ * (BAY_WIDTH - BAY_KERB - .01), bay.z - bay.headingX * (BAY_WIDTH - BAY_KERB - .01)))
      assert.ok(!insideBay(bay, bay.x + bay.headingX * (bay.front + .1), bay.z + bay.headingZ * (bay.front + .1)))
    }
  }
})

test('parkingBays: boxes that would cross are left out, the guessed one first', () => {
  // Two carriageways drawn on top of each other: cars facing opposite ways 0.6 m apart. One box stays.
  const stacked = parkingBays([...kerb([0, 6.5]), [.3, 150, .6, EAST + Math.PI, 1, 'residential']])
  assert.deepEqual(stacked.map(bay => bay.key), ['0,0', '6.5,0'])
  // A car of another street stands where the empty bay between two cars would be: no empty bay there.
  const crossingRows = [...kerb([0, 6.5, 19.5]), [13.4, 150, .8, .3, 1, 'residential']]
  const crossing = parkingBays(crossingRows)
  assert.deepEqual(crossing.map(bay => bay.key), ['0,0', '6.5,0', '19.5,0', '13.4,0.8'])
  const [first, second, third, other] = crossing
  assert.ok(!baysOverlap(first, second) && !baysOverlap(second, third), 'bays sharing an end line do not count as crossing')
  assert.ok(!baysOverlap(second, other) && !baysOverlap(third, other))
  // A bend: the last car of one segment and the first of the next, 3 m apart at an angle.
  const bendRows = [...kerb([0]), [2.5, 150, 1.8, EAST - .6, 1, 'residential']]
  const bend = parkingBays(bendRows)
  assert.equal(bend.length, 1)
  // Which box of a pair goes does not depend on the order the cells were loaded in.
  for (const rows of [[...kerb([0, 6.5]), [.3, 150, .6, EAST + Math.PI, 1, 'residential']], crossingRows, bendRows]) {
    for (const seed of [1, 2, 3]) assert.deepEqual(shapes(parkingBays(shuffled(rows, seed))), shapes(parkingBays(rows)))
    assert.deepEqual(shapes(parkingBays([...rows].reverse())), shapes(parkingBays(rows)))
  }
})

test('writeBay: flat-lying quads on the sampled ground, facing up — three lines at the kerb, four out in the road', () => {
  for (const yaw of [EAST, .4, -2]) for (const boxed of [false, true]) {
    const [first, second] = parkingBays(kerb([0, 6.5], 0, yaw))
    for (const bay of [first, second]) {
      // The road is a tilted plane; the corner samples come from it.
      const plane = (x, z) => 150 + .03 * x - .02 * z
      const corners = bayCorners(bay, [], boxed), heights = [0, 1, 2, 3].map(corner => plane(corners[corner * 2], corners[corner * 2 + 1]))
      const positions = new Float32Array((BAY_VERTICES + 2) * 3).fill(NaN)
      writeBay(bay, heights, .01, positions, 1, boxed)
      assert.ok(Number.isNaN(positions[2]) && Number.isNaN(positions[(BAY_VERTICES + 1) * 3]), 'writes its 16 vertices and nothing else')
      const vertex = index => new THREE.Vector3().fromArray(positions, (1 + index) * 3)
      let area = 0
      for (let quad = 0; quad < BAY_VERTICES / 4; quad++) {
        for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
          const normal = new THREE.Vector3().crossVectors(vertex(quad * 4 + b).sub(vertex(quad * 4 + a)), vertex(quad * 4 + c).sub(vertex(quad * 4 + a)))
          assert.ok(normal.y >= 0, 'faces up')
          area += normal.length() / 2
        }
      }
      for (let index = 0; index < BAY_VERTICES; index++) {
        const point = vertex(index)
        assert.ok(near(point.y, plane(point.x, point.z) + .01, 1e-3), 'on the road, lifted by the paint thickness')
        const dx = point.x - bay.x, dz = point.z - bay.z
        const along = dx * bay.headingX + dz * bay.headingZ, side = dz * bay.headingX - dx * bay.headingZ
        assert.ok(along >= -bay.rear - BAY_LINE && along <= bay.front + BAY_LINE && side >= BAY_KERB - BAY_WIDTH - BAY_LINE)
        // Open bays stop short of the kerb; a boxed one reaches as far to the kerb side as to the road side, and no further than the road was checked.
        assert.ok(boxed ? side <= roadSide + BAY_LINE / 2 + 1e-6 && side < BAY_BOX_CLEARANCE : side < BAY_KERB, `kerb side ${side}`)
      }
      // Both end lines and the road-side line on every bay, the kerb-side line only when boxed.
      const length = bay.rear + bay.front, across = boxed ? 2 * roadSide + BAY_LINE : BAY_WIDTH - .05 + BAY_LINE / 2
      assert.ok(near(area, BAY_LINE * (2 * across + (length - BAY_LINE) * (boxed ? 2 : 1)), .01), `painted area ${area}`)
      assert.ok(insideBay(bay, bay.x - bay.headingZ * 1.2, bay.z + bay.headingX * 1.2, true) && !insideBay(bay, bay.x - bay.headingZ * 1.2, bay.z + bay.headingX * 1.2), 'a boxed bay is wider on the kerb side')
    }
  }
})

// A straight street with the kerb at z = +0.95 from the car centres (or `kerbAt`); cars along x, heading east.
// `mouth` is a stretch of x where a side street opens through the kerb.
function street({rows = kerb([0, 6.5, 19.5]), road = 150.06, ground = 150, forbidden = () => false, kerbAt = .95, mouth} = {}) {
  const scene = new THREE.Scene()
  const world = {tiles: true, colliders: 'road', calls: 0, road}
  const groundAt = (x, z, reference, car) => {
    world.calls++
    assert.equal(car, true, 'asks for the carriageway')
    return world.colliders === 'none' ? undefined : world.colliders === 'road' ? world.road : ground
  }
  const surfaceAt = (x, z) => world.tiles && (world.tilesUpTo === undefined || z <= world.tilesUpTo)
    ? [z <= kerbAt || (mouth && x >= mouth[0] && x <= mouth[1]) ? ROAD : SIDEWALK] : undefined
  const lines = parkingBayLines(scene, groundAt, surfaceAt, forbidden)
  lines.setRows(rows)
  const run = (seconds, focus = {x: 0, z: 0}, dt = 1 / 60) => { for (let time = 0; time < seconds; time += dt) lines.update(dt, focus) }
  const heights = () => {
    const position = lines.mesh.geometry.getAttribute('position'), drawn = lines.mesh.geometry.drawRange.count / BAY_INDICES
    return [...position.array.slice(0, drawn * BAY_VERTICES * 3)].filter((_, index) => index % 3 === 1)
  }
  return {scene, world, lines, run, heights}
}

test('parkingBayLines: one mesh, drawn once the ground under a bay is known', () => {
  const {scene, world, lines, run, heights} = street()
  assert.equal(lines.mesh.parent, scene)
  assert.equal(lines.mesh.visible, false, 'nothing to draw before the first look')
  assert.equal(lines.probe().drawCalls, 0)
  lines.update(1 / 60, {x: 0, z: 0})
  let probe = lines.probe()
  assert.deepEqual([probe.total, probe.occupied, probe.empty, probe.drawn], [4, 3, 1, 4])
  assert.equal(world.calls, 16, 'four bays, four corners each, in the first frame')
  assert.equal(lines.mesh.visible, true)
  assert.equal(probe.drawCalls, 1)
  assert.equal(lines.mesh.geometry.drawRange.count, 4 * BAY_INDICES)
  assert.ok(heights().every(y => near(y, 150.06 + .012, 1e-4)), 'paint sits on the road')
  assert.ok(lines.mesh.material.isMeshLambertMaterial && lines.mesh.material.polygonOffset, 'lit like the road, biased against z-fighting')
  assert.equal(lines.mesh.userData.noShadowCast, true)
  // Looked at again a second apart until the same heights have come back three times ...
  run(3)
  probe = lines.probe()
  assert.equal(probe.settled, 4)
  assert.equal(world.calls, 48)
  // ... and after that only once every eight seconds.
  run(6)
  assert.equal(world.calls, 48, 'settled bays are left alone in between')
  run(64)
  assert.equal(world.calls, 48 + 8 * 16, 'one look per bay per eight seconds')
  assert.equal(lines.probe().samples, world.calls)
})

test('parkingBayLines: a full box where the carriageway goes on past the cars, three lines at the kerb', () => {
  const sides = lines => {
    const position = lines.mesh.geometry.getAttribute('position').array, drawn = lines.mesh.geometry.drawRange.count / BAY_INDICES
    let most = -Infinity
    for (let index = 0; index < drawn * BAY_VERTICES; index++) most = Math.max(most, position[index * 3 + 2])
    return most
  }
  // Kerb where the pipeline puts it, and a little further off: lines stop short of the pavement.
  for (const kerbAt of [.95, 1.2, BAY_BOX_CLEARANCE - .01]) {
    const {lines, run} = street({kerbAt})
    run(.1)
    assert.deepEqual([lines.probe().drawn, lines.probe().boxed], [4, 0], `kerb at ${kerbAt}`)
    assert.ok(sides(lines) < .95)
    assert.ok(lines.probe().bays.every(bay => bay.boxed === false))
  }
  // A lane's width of carriageway between the cars and the kerb: a fourth line closes each bay.
  for (const kerbAt of [BAY_BOX_CLEARANCE + .01, 2.45]) {
    const {lines, run} = street({kerbAt})
    run(.1)
    assert.deepEqual([lines.probe().drawn, lines.probe().boxed], [4, 4], `kerb at ${kerbAt}`)
    assert.ok(near(sides(lines), roadSide + BAY_LINE / 2, 1e-5), 'kerb-side line as far from the car as the road-side line')
    assert.ok(lines.probe().bays.every(bay => bay.boxed === true))
  }
  // The street tile beside the bay is not there yet: no guessing, the bay waits for it.
  const {world, lines, run} = street({kerbAt: 2.45})
  world.tilesUpTo = 1
  run(1)
  assert.deepEqual([lines.probe().drawn, lines.probe().waiting, world.calls], [0, 4, 0])
  world.tilesUpTo = undefined
  run(2)
  assert.deepEqual([lines.probe().drawn, lines.probe().boxed], [4, 4])
  // Rows reloaded: a known bay stays boxed without asking again.
  lines.setRows(kerb([0, 6.5, 19.5]))
  assert.deepEqual([lines.probe().drawn, lines.probe().boxed], [4, 4])
  assert.ok(near(sides(lines), roadSide + BAY_LINE / 2, 1e-5))
})

test('parkingBayLines: a first reading taken before the road collider arrived is corrected', () => {
  const {world, lines, run, heights} = street()
  world.colliders = 'ground'
  run(.5)
  assert.ok(heights().every(y => near(y, 150.012, 1e-4)), 'terrain under the road: all there is to read so far')
  world.colliders = 'road'
  run(1.5)
  assert.ok(heights().every(y => near(y, 150.072, 1e-4)), 'rewritten at road height on the next look')
  assert.equal(lines.probe().settled, 0, 'and the count towards settling starts again')
  run(3)
  assert.equal(lines.probe().settled, 4)
  // A far tile's road collider can take longer than that: the slow re-read picks it up.
  world.colliders = 'ground'
  run(6.5)
  assert.ok(heights().every(y => near(y, 150.012, 1e-4)))
  assert.equal(lines.probe().settled, 0)
  world.colliders = 'road'
  run(4)
  assert.ok(heights().every(y => near(y, 150.072, 1e-4)), 'corrected, however late the road arrives')
  assert.equal(lines.probe().settled, 4)
})

test('parkingBayLines: budget, radius and missing data', () => {
  // 40 cars in a row: 40 bays. Four are looked at per frame.
  const rows = kerb(Array.from({length: 40}, (_, index) => index * 6.5))
  const {world, lines, run} = street({rows})
  lines.update(1 / 60, {x: 0, z: 0})
  assert.equal(world.calls, 16)
  assert.equal(lines.probe().drawn, 4)
  run(.2)
  // 110 m of kerb is 17 bays ahead of a player standing at the first one.
  assert.equal(lines.probe().drawn, 17, 'bays out of sight of a 10 cm line are left for later')
  run(1, {x: 39 * 6.5, z: 0})
  assert.equal(lines.probe().drawn, 34, 'and draped when the player gets there')

  // Street tile not loaded: one lookup per bay, then left alone for a while.
  const late = street()
  late.world.tiles = false
  late.run(1)
  assert.deepEqual([late.lines.probe().drawn, late.world.calls], [0, 0])
  late.world.tiles = true
  late.run(1)
  assert.equal(late.lines.probe().drawn, 4)

  // Ground not loaded (or the player not in the world yet): bays wait, however long it takes.
  const noGround = street()
  noGround.world.colliders = 'none'
  noGround.run(30)
  assert.deepEqual([noGround.lines.probe().waiting, noGround.lines.probe().none], [4, 0])
  assert.ok(noGround.world.calls <= 4 * 21, `one sample per bay per retry, got ${noGround.world.calls}`)
  noGround.world.colliders = 'road'
  noGround.run(2)
  assert.equal(noGround.lines.probe().drawn, 4)
})

test('parkingBayLines: no bay off the road, under a deck, or guessed into a car-free zone', () => {
  // Cars whose spot is not carriageway in the street tiles (world data and tiles out of step).
  const off = street({rows: kerb([0, 6.5], 3)})
  off.run(1)
  assert.deepEqual([off.lines.probe().none, off.lines.probe().drawn, off.world.calls], [2, 0, 0])
  // The sample is a deck far above the road height in the world data: retried a few times, then left unpainted.
  const deck = street({road: 158})
  deck.run(20)
  assert.deepEqual([deck.lines.probe().none, deck.lines.probe().drawn], [4, 0])
  const calls = deck.world.calls
  deck.run(20)
  assert.ok(deck.world.calls - calls <= 4, 'an unpainted bay is read once in a long while, one sample')
  // Not for good: what was read may have been a tile on its way in.
  deck.world.road = 150.06
  deck.run(31)
  assert.deepEqual([deck.lines.probe().none, deck.lines.probe().drawn], [0, 4])
  // The empty bay between two parked cars falls in a car-free zone: the cars keep theirs, the guess goes.
  const zone = street({rows: kerb([0, 13]), forbidden: x => x > 4 && x < 9})
  zone.run(1)
  const probe = zone.lines.probe()
  assert.deepEqual([probe.total, probe.drawn, probe.none], [3, 2, 1])
  assert.equal(probe.bays.find(bay => bay.state === 'none').occupied, false)
  // The gap between two parked cars is the mouth of a side street: no bay painted across it.
  for (const kerbAt of [.95, 2.45]) {
    const side = street({rows: kerb([0, 13]), kerbAt, mouth: [4, 9]})
    side.run(1)
    const bays = side.lines.probe().bays
    assert.deepEqual(bays.map(bay => [bay.occupied, bay.state]), [[true, 'drawn'], [false, 'none'], [true, 'drawn']], `kerb at ${kerbAt}`)
    const calls = side.world.calls
    side.run(60)
    assert.ok(side.world.calls > calls && (side.world.calls - calls) % 8 === 0, 'only the two painted bays are read again, the mouth never')
    assert.equal(side.lines.probe().none, 1)
    // A car that is parked there keeps its bay.
    const parked = street({rows: kerb([0, 6.5, 13]), kerbAt, mouth: [4, 9]})
    parked.run(1)
    assert.deepEqual([parked.lines.probe().drawn, parked.lines.probe().none], [3, 0])
  }
  assert.ok(BAY_MOUTH_REACH > 2.5 + .95, 'past the kerb of the widest street cars are parked on')
})

// What three.js does with the position attribute each rendered frame (`WebGLAttributes.update`): the
// whole array when there are no update ranges, else only the ranges.
function gpu(lines) {
  const state = {buffer: null, attribute: null, version: -1, whole: 0, partial: 0}
  return Object.assign(state, {
    render() {
      const position = lines.mesh.geometry.getAttribute('position')
      if (!lines.mesh.visible || !position) return
      if (position !== state.attribute) {
        Object.assign(state, {attribute: position, buffer: position.array.slice(), version: position.version})
        state.whole++
        position.onUploadCallback()
      } else if (position.version !== state.version) {
        state.version = position.version
        if (position.updateRanges.length) {
          for (const {start, count} of position.updateRanges) state.buffer.set(position.array.subarray(start, start + count), start)
          position.clearUpdateRanges()
          state.partial++
        } else { state.buffer.set(position.array); state.whole++ }
        position.onUploadCallback()
      }
    },
    stale() {
      const array = lines.mesh.geometry.getAttribute('position').array, end = lines.mesh.geometry.drawRange.count / BAY_INDICES * BAY_VERTICES * 3
      let stale = 0
      for (let index = 0; index < end; index++) if (state.buffer[index] !== array[index]) stale++
      return stale
    },
  })
}

test('parkingBayLines: what is drawn is what was uploaded', () => {
  const north = kerb([0, 6.5], 20, 0), east = kerb([0, 6.5])
  const {world, lines} = street({rows: [...east, ...north]})
  const card = gpu(lines), frame = () => { lines.update(1 / 60, {x: 0, z: 0}); card.render() }
  for (let count = 0; count < 30; count++) frame()
  assert.ok(lines.probe().drawn >= 2)
  assert.equal(card.stale(), 0)
  // Steady state: one bay's heights change, one bay's worth of buffer goes up.
  const before = {whole: card.whole, partial: card.partial}
  world.road = 150.2
  for (let count = 0; count < 600; count++) frame()
  assert.equal(card.stale(), 0)
  assert.equal(card.whole, before.whole, 'no whole-buffer upload for a height correction')
  assert.ok(card.partial > before.partial)
  // New rows move every bay to another place in the buffer, and in the same frame a new bay near
  // the player is written: the whole buffer has to go up, not just that one bay.
  lines.setRows([...kerb([-13, -6.5]), ...north, ...east])
  frame()
  assert.equal(card.stale(), 0, 'no bay left with its old vertices on the card')
  assert.equal(card.whole, before.whole + 1)
  for (let count = 0; count < 120; count++) frame()
  assert.equal(card.stale(), 0)
  // Many bays written between two rendered frames (a hidden tab): still all there afterwards.
  const long = street({rows: kerb(Array.from({length: 120}, (_, index) => index * 6.5))})
  const longCard = gpu(long.lines)
  long.lines.update(1 / 60, {x: 0, z: 0}); longCard.render()
  for (let count = 0; count < 200; count++) long.lines.update(1 / 60, {x: (count % 100) * 7, z: 0})
  longCard.render()
  assert.ok(long.lines.probe().drawn > 64)
  assert.equal(longCard.stale(), 0)
  // A bigger town than the buffer: a new attribute, uploaded whole.
  long.lines.setRows(kerb(Array.from({length: 300}, (_, index) => index * 6.5)))
  for (let count = 0; count < 5; count++) { long.lines.update(1 / 60, {x: 0, z: 0}); longCard.render() }
  assert.equal(longCard.stale(), 0)
})

test('parkingBayLines: a frame looks through a bounded part of the town', () => {
  // 300 bays in a row, the player at the far end: the near ones are past the first frame's reach.
  const rows = kerb(Array.from({length: 300}, (_, index) => index * 6.5))
  const {lines, run} = street({rows})
  const focus = {x: 299 * 6.5, z: 0}
  lines.update(1 / 60, focus)
  assert.equal(lines.probe().drawn, 0, 'the first 256 are all far away')
  lines.update(1 / 60, focus)
  assert.equal(lines.probe().drawn, 4, 'the next frame carries on from there')
  run(.2, focus)
  assert.equal(lines.probe().drawn, 17)
})

test('parkingBayLines: new rows keep what is known, hide and show', () => {
  const {world, lines, run, heights} = street()
  run(4)
  assert.equal(world.calls, 48)
  // The player crosses into the next parking cell: same cars plus one more street.
  lines.setRows([...kerb([0, 6.5, 19.5]), ...kerb([200, 206.5])])
  assert.deepEqual([lines.probe().total, lines.probe().drawn, lines.probe().settled], [6, 4, 4])
  assert.ok(heights().every(y => near(y, 150.072, 1e-4)), 'still drawn, without a frame of nothing')
  run(2)
  assert.equal(world.calls, 48, 'known bays are not sampled again; the new street is out of range')
  // A car joins the run: the bay next to it changes shape and is looked at afresh.
  lines.setRows(kerb([0, 6.5, 19.5, 26]))
  run(3)
  assert.deepEqual([lines.probe().total, lines.probe().drawn, lines.probe().settled], [5, 5, 5])
  assert.equal(world.calls, 48 + 2 * 12, 'only the changed bay and the new one')
  lines.hide()
  assert.deepEqual([lines.mesh.visible, lines.probe().drawCalls], [false, 0])
  lines.update(1 / 60, {x: 0, z: 0})
  assert.equal(lines.mesh.visible, true)
  lines.setRows([])
  assert.deepEqual([lines.mesh.visible, lines.probe().total, lines.mesh.geometry.drawRange.count], [false, 0, 0])
})

test('parkingBays: the whole town — every car in its own bay, no two bays overlap', {skip: !existsSync('public/world/roads/parking/index.json') && 'no world data in this checkout (public/world/roads/parking)'}, () => {
  const dir = 'public/world/roads/parking'
  const rows = readdirSync(dir).filter(name => name.endsWith('.json.gz')).flatMap(name => JSON.parse(gunzipSync(readFileSync(`${dir}/${name}`))))
  assert.ok(rows.length > 1000)
  const bays = parkingBays(rows)
  const occupied = bays.filter(bay => bay.occupied)
  const cars = new Set(rows.map(row => `${row[0]},${row[2]}`)).size
  // All but the few cars the world data parks into each other (see `withoutClashes`).
  assert.ok(occupied.length <= cars && occupied.length >= cars * .998, `${occupied.length} bays for ${cars} parked cars`)
  assert.equal(new Set(bays.map(bay => bay.key)).size, bays.length)
  const empty = bays.length - occupied.length
  assert.ok(empty > occupied.length * .15 && empty < occupied.length, `empty bays: ${empty} for ${occupied.length} cars`)
  const grid = new Map()
  for (const bay of bays) {
    assert.ok(bay.rear >= 2.9 && bay.rear <= 3.85 && bay.front >= 2.9 && bay.front <= 3.85, `bay ${bay.key}: ${bay.rear} + ${bay.front}`)
    const cell = `${Math.floor(bay.x / 16)},${Math.floor(bay.z / 16)}`
    if (!grid.has(cell)) grid.set(cell, [])
    grid.get(cell).push(bay)
  }
  const crossing = []
  for (const bay of bays) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const other of grid.get(`${Math.floor(bay.x / 16) + dx},${Math.floor(bay.z / 16) + dz}`) ?? []) {
        if (other !== bay && (insideBay(other, bay.x, bay.z) || baysOverlap(bay, other))) crossing.push(`${bay.key} / ${other.key}`)
      }
    }
  }
  assert.deepEqual(crossing, [], 'no two painted bays cross')
  // Cells arrive in any order: the bays are the same.
  assert.deepEqual(shapes(parkingBays(shuffled(rows))), shapes(bays))
})
