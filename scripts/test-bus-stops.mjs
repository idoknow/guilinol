// IDOK-399 stage 5b — unit tests for the bus stop signs and shelters: reading the file and indexing it,
// which stops are drawn (nearest 24, 170 m in / 190 m out), where the shelter and its feet go on either
// side of the pole, collision boxes that leave the front open, the Shizijie precinct, standing on the
// ground (highest foot, each column to its own ground, no shelter on a step), the name atlas and the
// name layout, and the runtime's per-frame budgets.
// Run: node --import tsx --test scripts/test-bus-stops.mjs   (`npm run verify:bus-stops`)
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import * as THREE from 'three'
import {
  BACK_COLUMN_Z, BURIED, DRAWN_PER_FRAME, FASCIA_UNITS, FRONT_COLUMN_Z, LANDS_PER_FRAME, LOAD_ATTEMPTS, LOAD_RETRY,
  MAX_FOOT_SPREAD, MAX_SHOWN, NAMES_PER_FRAME, NameAtlas, RECYCLE_RADIUS, SHELTER_BACK, SHELTER_FRONT, SHELTER_LENGTH,
  SHELTER_OFFSET, SHOW_RADIUS, SIGN_THICK, FACE_LIFT, StopIndex, blockedAt, fitUnits, layoutFasciaName, layoutFlagName,
  parseBusStops, selectStops, shelterBase, shelterFeet, shelterOutline, splitName, stopSolids, textUnits, toWorld,
} from '../web/src/traffic/bus-stop-layout.ts'
import {GROUND_REFERENCE, SETTLE_LOOKS, busStops} from '../web/src/traffic/bus-stops.ts'
import {resolveContact} from '../web/src/traffic/contact.ts'
import {SHIZIJIE_DECOR_EXCLUSION_POLY, SHIZIJIE_ORIGIN, pointInRelPoly, toShizijieRel} from '../web/src/shizijie-zone.ts'

const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance
const flush = () => new Promise(resolve => setImmediate(resolve))
const file = rows => ({version: 1, osm: 'test', world: 'test', license: 'test', stops: rows})

// Pole at the origin facing +z (yaw 0: n = +z, t = +x), shelter along +x; one facing +x with its shelter on the −t side; a bare pole.
const A = [0, 0, 0, 1, 1, '七星公园', 'Qixing Park']
const B = [20, 0, Math.PI / 2, 1, -1, '电子科大信息科技学院', '']
const C = [0, 40, 0, 0, 0, '', '']
const E = [175, 0, 0, 0, 0, '远处', '']
const D = [300, 0, 0, 1, 1, '更远', '']
const SHIZIJIE = [SHIZIJIE_ORIGIN[0], SHIZIJIE_ORIGIN[1], 0, 1, 1, '十字街', '']

// ——— file and index ———

test('parse: rows to stops, frames from yaw, malformed rows skipped, Shizijie precinct left to its own model', () => {
  assert.equal(parseBusStops(null), null)
  assert.equal(parseBusStops({version: 2, stops: []}), null)
  const parsed = parseBusStops(file([A, B, ['x'], [1, 2], [NaN, 0, 0, 0, 0, '', ''], SHIZIJIE, C]))
  assert.deepEqual(parsed.stops.map(stop => stop.id), [0, 1, 6], 'ids are row indices')
  assert.deepEqual(parsed.excluded, [`${SHIZIJIE[0].toFixed(2)},${SHIZIJIE[1].toFixed(2)}`])
  const [a, b, c] = parsed.stops
  assert.equal(a.key, '0.00,0.00')
  assert.deepEqual([a.shelter, a.side, a.name, a.en, c.shelter, c.name], [true, 1, '七星公园', 'Qixing Park', false, ''])
  assert.ok(near(a.nx, 0) && near(a.nz, 1) && near(a.tx, 1) && near(a.tz, 0), 'yaw 0: n = +z, t = +x')
  assert.ok(near(b.nx, 1) && near(b.nz, 0) && near(b.tx, 0) && near(b.tz, -1), 'yaw π/2: n = +x, t = −z')
  assert.equal(b.side, -1)
  for (const stop of parsed.stops) assert.ok(near(stop.tx * stop.nx + stop.tz * stop.nz, 0) && near(Math.hypot(stop.tx, stop.tz), 1))
  // three's rotation.y: local +X → (cos, −sin), local +Z → (sin, cos).
  const object = new THREE.Object3D(); object.rotation.y = b.yaw; object.updateMatrixWorld()
  const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(object.quaternion), localZ = new THREE.Vector3(0, 0, 1).applyQuaternion(object.quaternion)
  assert.ok(near(localX.x, b.tx) && near(localX.z, b.tz) && near(localZ.x, b.nx) && near(localZ.z, b.nz))
})

test('parse: the real file (219 rows, every excluded stop inside the Shizijie polygon, names lay out)', () => {
  const data = JSON.parse(readFileSync(new URL('../public/street-furniture/bus-stops.json', import.meta.url), 'utf8'))
  const parsed = parseBusStops(data)
  assert.ok(parsed)
  assert.equal(parsed.stops.length + parsed.excluded.length, data.stops.length)
  assert.equal(data.stops.length, 219)
  for (const key of parsed.excluded) {
    const [x, z] = key.split(',').map(Number), [rx, rz] = toShizijieRel(x, z)
    assert.ok(pointInRelPoly(rx, rz, SHIZIJIE_DECOR_EXCLUSION_POLY), key)
  }
  for (const stop of parsed.stops) {
    const flag = layoutFlagName(stop.name, stop.en)
    assert.ok(flag.lines.length <= 2)
    for (const line of flag.lines) assert.ok(textUnits(line.text) * line.size <= 7 + 1e-6, `${stop.name}: "${line.text}" fits the panel`)
    if (flag.en) assert.ok(textUnits(flag.en.text) * flag.en.size <= 7 + 1e-6, `${stop.en} fits`)
    const fascia = layoutFasciaName(stop.name)
    if (fascia) assert.ok(textUnits(fascia.text) * fascia.size <= FASCIA_UNITS + 1e-6, `${stop.name} fits the fascia`)
    assert.equal(flag.icon, !stop.name)
  }
})

test('index: 64 m grid, visit returns exactly the stops within the radius', () => {
  let seed = 11
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const rows = Array.from({length: 400}, () => [random() * 2000 - 1000, random() * 2000 - 1000, 0, 0, 0, '', ''])
  const {stops} = parseBusStops(file(rows)), index = new StopIndex(stops)
  for (const [x, z, radius] of [[0, 0, 170], [-999, 999, 190], [313.7, -64, 64], [0, 0, 0.5]]) {
    const got = []
    index.visit(x, z, radius, stop => got.push(stop.id))
    const expected = stops.filter(stop => Math.hypot(stop.x - x, stop.z - z) <= radius).map(stop => stop.id)
    assert.deepEqual(got.sort((p, q) => p - q), expected.sort((p, q) => p - q))
  }
})

test('select: nearest first, at most 24, new ones within 170 m, drawn ones kept to 190 m', () => {
  const rows = [E, D, A, B, C]
  const {stops} = parseBusStops(file(rows)), index = new StopIndex(stops)
  const out = [], distance = new Float64Array(rows.length)
  const shown = new Set()
  selectStops(index, 0, 0, stop => shown.has(stop), out, distance)
  assert.deepEqual(out.map(stop => stop.name), ['七星公园', '电子科大信息科技学院', ''], 'E at 175 m is not taken up, D at 300 m never')
  shown.add(stops.find(stop => stop.name === '远处'))
  selectStops(index, 0, 0, stop => shown.has(stop), out, distance)
  assert.deepEqual(out.map(stop => stop.name), ['七星公园', '电子科大信息科技学院', '', '远处'], 'already drawn at 175 m: kept')
  selectStops(index, -20, 0, stop => shown.has(stop), out, distance)
  assert.ok(!out.some(stop => stop.name === '远处'), 'drawn but 195 m away: let go')
  assert.equal(SHOW_RADIUS, 170); assert.equal(RECYCLE_RADIUS, 190)
  // 60 stops in a 10 m grid: the 24 nearest, sorted, ties broken by id.
  const grid = parseBusStops(file(Array.from({length: 60}, (_, i) => [(i % 10) * 10, Math.floor(i / 10) * 10, 0, 0, 0, '', ''])))
  const many = new StopIndex(grid.stops)
  selectStops(many, 0, 0, () => false, out, new Float64Array(60))
  assert.equal(out.length, MAX_SHOWN)
  const d = stop => Math.hypot(stop.x, stop.z)
  for (let i = 1; i < out.length; i++) assert.ok(d(out[i - 1]) < d(out[i]) || (d(out[i - 1]) === d(out[i]) && out[i - 1].id < out[i].id))
  const worst = d(out.at(-1))
  assert.ok(grid.stops.filter(stop => d(stop) < worst).every(stop => out.includes(stop)), 'nothing nearer left out')
})

// ——— shelter geometry ———

test('shelter: 2.6 m along t on the side given, front 1.0 m behind the kerb, 4.2 × 1.5 m, feet inside the outline', () => {
  const {stops: [a, b]} = parseBusStops(file([A, B]))
  for (const stop of [a, b]) {
    const outline = shelterOutline(stop), feet = shelterFeet(stop)
    const alongs = outline.map(corner => corner.along), outs = outline.map(corner => corner.out)
    assert.ok(near(Math.max(...alongs) - Math.min(...alongs), SHELTER_LENGTH) && near(Math.max(...outs) - Math.min(...outs), 1.5))
    assert.ok(near((Math.max(...alongs) + Math.min(...alongs)) / 2, stop.side * SHELTER_OFFSET), 'centre side × 2.6 m from the pole')
    // The pole stands 0.6 m behind the kerb; the shelter front is 1.0 m behind it, so 0.4 m behind the pole.
    assert.ok(near(Math.max(...outs), -0.4) && near(SHELTER_FRONT, -0.4) && near(SHELTER_BACK, -1.9))
    for (const foot of feet) {
      assert.ok(Math.min(...alongs) < foot.along && foot.along < Math.max(...alongs) && SHELTER_BACK < foot.out && foot.out < SHELTER_FRONT)
      assert.ok(Math.sign(foot.along) === stop.side, 'all four feet on the shelter side of the pole')
    }
    assert.ok(near(feet[0].out, BACK_COLUMN_Z) && near(feet[1].out, BACK_COLUMN_Z) && near(feet[2].out, FRONT_COLUMN_Z) && near(feet[3].out, FRONT_COLUMN_Z))
    assert.ok(Math.abs(feet[0].along) < Math.abs(feet[1].along) && Math.abs(feet[3].along) < Math.abs(feet[2].along), 'feet 0 and 3 nearer the pole')
  }
  // World positions: A faces +z with its shelter towards +x; B faces +x with its shelter towards −t = +z.
  const target = {x: 0, z: 0}
  toWorld(a, SHELTER_OFFSET, -1.15, target); assert.ok(near(target.x, 2.6) && near(target.z, -1.15))
  toWorld(b, -SHELTER_OFFSET, -1.15, target); assert.ok(near(target.x, 20 - 1.15) && near(target.z, 2.6))
})

test('collision boxes: pole, back panel, front columns, bench, end panel; the front between the columns stays open', () => {
  for (const side of [1, -1]) {
    const stop = {side, shelter: true}, solids = stopSolids(stop)
    assert.deepEqual(solids.map(solid => solid.part), ['pole', 'panel', 'column', 'column', 'bench', 'end'])
    assert.deepEqual(stopSolids({side, shelter: false}).map(solid => solid.part), ['pole'])
    // A walker of 0.3 m radius steps in from the kerb anywhere between the front columns (0.6 and 4.6 m) and reaches the bench.
    for (let along = 1.0; along <= 4.2; along += 0.1) for (let out = 0; out >= -1.05; out -= 0.05) {
      assert.ok(!blockedAt(solids.slice(1), side * along, out, 0.3), `side ${side}: open at ${along.toFixed(2)}, ${out.toFixed(2)}`)
    }
    assert.ok(blockedAt(solids, side * 2.6, -1.85), 'back panel')
    assert.ok(blockedAt(solids, side * 2.6, -1.6), 'bench')
    assert.ok(blockedAt(solids, side * 4.6, -1.3), 'end panel at the far end')
    assert.ok(!blockedAt(solids, side * 0.6, -1.3), 'the end at the pole is open')
    assert.ok(blockedAt(solids, 0, 0), 'pole')
  }
})

test('stand: the highest foot, feet more than 0.45 m apart get no shelter', () => {
  assert.deepEqual(shelterBase([150, 150.2, 150.1, 150.05]), {base: 150.2, spread: shelterBase([150, 150.2, 150.1, 150.05]).spread, ok: true})
  assert.ok(near(shelterBase([150, 150.2, 150.1, 150.05]).spread, 0.2))
  assert.equal(shelterBase([150, 150 + MAX_FOOT_SPREAD, 150, 150]).ok, true)
  assert.equal(shelterBase([150, 150.46, 150, 150]).ok, false)
})

// ——— names ———

test('names: 7 characters full size, up to 10 smaller on one line, longer on two, brackets on a small line, cut with …', () => {
  assert.deepEqual(splitName('十字街中心广场(桂林市口腔医院)'), {main: '十字街中心广场', sub: '桂林市口腔医院'})
  assert.deepEqual(splitName('南门桥（南）'), {main: '南门桥', sub: '南'})
  assert.deepEqual(layoutFlagName('七星公园').lines, [{text: '七星公园', size: 1}])
  assert.deepEqual(layoutFlagName('七星公园东门站').lines, [{text: '七星公园东门站', size: 1}])
  const ten = layoutFlagName('电子科大信息科技学院')
  assert.equal(ten.lines.length, 1); assert.ok(near(ten.lines[0].size, 0.7))
  const long = layoutFlagName('十字街中心广场(桂林市口腔医院)')
  assert.deepEqual(long.lines, [{text: '十字街中心广场', size: 1}])
  assert.deepEqual(long.sub, {text: '（桂林市口腔医院）', size: 0.5})
  const twelve = layoutFlagName('桂林市第一人民医院东院区')
  assert.equal(twelve.lines.length, 2)
  assert.equal(twelve.lines.map(line => line.text).join(''), '桂林市第一人民医院东院区')
  assert.ok(textUnits(twelve.lines[0].text) >= textUnits(twelve.lines[1].text))
  const huge = layoutFlagName('一二三四五六七八九十一二三四五六七八九十一二')
  assert.equal(huge.lines.length, 2)
  assert.ok(huge.lines[1].text.endsWith('…'))
  for (const line of huge.lines) assert.ok(textUnits(line.text) <= 9 + 1e-9)
  const empty = layoutFlagName('', '')
  assert.deepEqual(empty, {icon: true, lines: [], sub: null, en: null}, 'no name: the pictogram, no made-up name')
  assert.equal(layoutFasciaName(''), null)
  assert.deepEqual(layoutFlagName('桂林北站', 'Guilin North Railway Station').en.text, 'Guilin North Railway Station')
  const english = layoutFlagName('站', 'A very long English name for a bus stop that cannot fit on the sign at all').en
  assert.ok(english.text.endsWith('…') && textUnits(english.text) * english.size <= 7 + 1e-6)
  assert.deepEqual(layoutFasciaName('七星公园'), {text: '七星公园', size: 1})
  const fascia = layoutFasciaName('十字街中心广场(桂林市口腔医院)')
  assert.equal(fascia.text, '十字街中心广场（桂林市口腔医院）')
  assert.ok(fascia.size < 1 && textUnits(fascia.text) * fascia.size <= FASCIA_UNITS + 1e-6)
  assert.ok(layoutFasciaName('一二三四五六七八九十一二三四五六七八九十').text.endsWith('…'))
  assert.equal(fitUnits('abc', 5), 'abc')
  assert.ok(near(textUnits('ab七'), 2.1))
})

test('atlas: free cells first, then the least recently used unpinned; pinned cells never taken; names kept until then', () => {
  const atlas = new NameAtlas(3)
  assert.deepEqual([atlas.acquire('a', 1), atlas.acquire('b', 2), atlas.acquire('c', 3)], [0, 1, 2])
  assert.equal(atlas.acquire('d', 4), -1, 'all pinned')
  atlas.markPainted(0, 'a'); atlas.markPainted(1, 'b')
  atlas.release('b', 5); atlas.release('a', 6)
  assert.equal(atlas.acquire('d', 7), 1, 'b let go first: its cell')
  assert.equal(atlas.isPainted(1, 'd'), false, 'a taken cell is painted afresh')
  assert.equal(atlas.acquire('a', 8), 0, 'a comes back to its own cell…')
  assert.equal(atlas.isPainted(0, 'a'), true, '…with its name still painted')
  assert.equal(atlas.cellFor('b'), -1)
  assert.deepEqual(atlas.occupancy(), {capacity: 3, used: 3, pinned: 3, painted: 1})
  atlas.markPainted(2, 'zzz')
  assert.equal(atlas.isPainted(2, 'zzz'), false, 'only the cell owner can be marked')
})

// ——— runtime ———

/** A town of stops on fake ground. `walked(x, z)` / `driven(x, z)` / `drawn(x, z, near)` stand in for the collider and `drawn-ground.ts`. */
function town({rows = [A, B, C, E, D], walked = () => 150, driven = () => undefined, drawn, load} = {}) {
  const scene = new THREE.Scene()
  const world = {walked, driven, drawn, calls: 0, drawnCalls: 0, loads: 0}
  const groundAt = (x, z, reference, car) => {
    world.calls++
    assert.equal(reference, GROUND_REFERENCE)
    return car ? world.driven(x, z) : world.walked(x, z)
  }
  const drawnAt = drawn && ((x, z, nearY) => { world.drawnCalls++; return world.drawn(x, z, nearY) })
  const stops = busStops(scene, groundAt, drawnAt, {canvas: null, load: load ?? (() => { world.loads++; return Promise.resolve(file(rows)) })})
  let focus = {x: 0, z: 0}
  const frame = (at = focus) => { focus = at; stops.update(1 / 60, at) }
  const run = (seconds, at) => { for (let time = 0; time < seconds; time += 1 / 60) frame(at) }
  const start = async () => { frame(); await flush(); frame() }
  const byName = name => stops.probe().stops.find(stop => stop.name === name)
  return {scene, world, stops, frame, run, start, byName}
}

/** Vertices of one slot's solid geometry: [x, y, z] list. */
function slotVertices(stops, slot, from = 0, to = stops.vertices.stride) {
  const p = stops.mesh.geometry.getAttribute('position').array, out = []
  for (let v = slot * stops.vertices.stride + from; v < slot * stops.vertices.stride + to; v++) out.push([p[v * 3], p[v * 3 + 1], p[v * 3 + 2]])
  return out
}

test('runtime: nothing before the file arrives; two meshes, at most three draw calls; loaded once', async () => {
  let resolve
  const {scene, world, stops, frame} = town({load: () => { world.loads++; return new Promise(done => { resolve = done }) }})
  assert.deepEqual(scene.children.map(child => child.name), ['G2 bus stops', 'G2 bus stop names'])
  assert.ok(stops.mesh.material.vertexColors && stops.mesh.geometry.getAttribute('color'))
  assert.equal(stops.mesh.userData.noShadowCast, true)
  for (let i = 0; i < 30; i++) frame()
  assert.equal(world.loads, 1, 'one request while it is on its way')
  assert.deepEqual([stops.mesh.visible, stops.faces.visible, stops.probe().drawn, stops.probe().load, world.calls], [false, false, 0, 'loading', 0])
  resolve(file([A, B, C]))
  await flush()
  for (let i = 0; i < 300; i++) frame()
  const probe = stops.probe()
  assert.equal(probe.load, 'ready')
  assert.equal(probe.drawn, 3)
  assert.ok(probe.drawCalls >= 1 && probe.drawCalls <= 3)
  assert.deepEqual(probe.meshes, ['G2 bus stops', 'G2 bus stop names'])
  assert.equal(world.loads, 1)
})

test('runtime: a failed download is retried 10 s later, five times in all, one warning', async () => {
  const warn = console.warn, warnings = []
  console.warn = (...args) => warnings.push(args)
  try {
    const times = []
    let clock = 0
    const {stops} = town({load: () => { times.push(clock); return Promise.reject(new Error('offline')) }})
    for (; clock < 120; clock++) { stops.update(1, {x: 0, z: 0}); await flush() }
    assert.equal(times.length, LOAD_ATTEMPTS)
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= LOAD_RETRY, `retry ${i} after ${times[i] - times[i - 1]} s`)
    assert.equal(warnings.length, 1)
    assert.equal(stops.probe().load, 'failed')
    assert.equal(stops.mesh.visible, false)
  } finally { console.warn = warn }
})

test('runtime: per frame at most 2 stops stood up (12 ground reads), 2 drawn-ground reads, 1 name painted', async () => {
  const rows = Array.from({length: 40}, (_, i) => [(i % 8) * 12, Math.floor(i / 8) * 15, 0, i % 2, 1, `站${i}`, ''])
  const {world, stops, frame, start} = town({rows, walked: (x, z) => 150 + x * 0.001 + z * 0.002, drawn: (x, z, y) => y - 0.05})
  await start()
  let painted = stops.probe().atlas.painted
  for (let i = 0; i < 1200; i++) {
    const calls = world.calls, drawnCalls = world.drawnCalls
    frame()
    assert.ok(world.calls - calls <= LANDS_PER_FRAME * 6, `frame ${i}: ${world.calls - calls} ground reads`)
    assert.ok(world.drawnCalls - drawnCalls <= DRAWN_PER_FRAME, `frame ${i}: ${world.drawnCalls - drawnCalls} drawn reads`)
    const now = stops.probe().atlas.painted
    assert.ok(now - painted <= NAMES_PER_FRAME, `frame ${i}: ${now - painted} names painted`)
    painted = now
  }
  const probe = stops.probe()
  assert.equal(probe.shown, MAX_SHOWN, '24 nearest of 40')
  assert.equal(probe.settled, MAX_SHOWN, 'all settled in 20 s')
  assert.equal(probe.atlas.pinned, MAX_SHOWN)
  assert.ok(probe.atlas.used <= 32)
  assert.ok(probe.stops.every(stop => stop.named))
  // Settled: only the 8 s rechecks, a handful of reads a second.
  const before = world.calls
  for (let i = 0; i < 600; i++) frame()
  assert.ok((world.calls - before) / 10 < 24 * 6 / 8 + 6, `${(world.calls - before) / 10} reads/s once settled`)
})

test('runtime: pole on the collider (or the drawn ground within 0.6 m), shelter on its highest foot, columns down to their own ground', async () => {
  // Ground rising 5 cm a metre towards +x: A's feet at x 0.6 and 4.6 differ by 0.2 m.
  const {stops, run, start, byName} = town({rows: [A], walked: x => 150 + 0.05 * x})
  await start()
  run(6)
  const a = byName('七星公园')
  assert.equal(a.state, 'drawn'); assert.equal(a.shelterState, 'up'); assert.ok(a.settled)
  assert.ok(near(a.y, 150), 'pole base on the collider')
  const heights = a.corners.map(corner => corner.y)
  assert.ok(near(heights[0], 150.03, 1e-9) && near(heights[1], 150.23, 1e-9))
  for (const corner of a.corners) assert.ok(near(corner.bottom, corner.y - BURIED), 'each column 0.3 m under its own ground')
  // In the geometry: the lowest vertex under each foot is 0.3 m under that foot's ground; the shelter top rides on the highest foot.
  const shelter = slotVertices(stops, a.slot, stops.vertices.pole)
  for (const corner of a.corners) {
    const under = shelter.filter(([x, , z]) => Math.abs(x - corner.x) < 0.06 && Math.abs(z - corner.z) < 0.06)
    assert.ok(under.length > 0)
    assert.ok(near(Math.min(...under.map(v => v[1])), corner.y - BURIED, 1e-4), `foot at ${corner.x.toFixed(2)}`)
  }
  const top = Math.max(...shelter.map(v => v[1]))
  assert.ok(top > 150.23 + 2.45 && top < 150.23 + 2.75, 'roof from the highest foot')
  const poleVerts = slotVertices(stops, a.slot, 0, stops.vertices.pole)
  assert.ok(near(Math.min(...poleVerts.map(v => v[1])), 150 - BURIED, 1e-4), 'pole 0.3 m under its base')
  assert.ok(near(Math.max(...poleVerts.map(v => v[1])), 150 + 2.78, 1e-4), 'pole and cap 2.78 m')

  const drawn = town({rows: [A], walked: () => 150, drawn: (x, z, y) => y - 0.08})
  await drawn.start(); drawn.run(8)
  const d = drawn.byName('七星公园')
  assert.ok(near(d.y, 149.92) && near(d.support, 150), 'drawn ground 8 cm under the collider: stands on it')
  assert.ok(d.corners.every(corner => near(corner.y, 149.92)))
  const far = town({rows: [A], walked: () => 150, drawn: (x, z, y) => y - 0.7})
  await far.start(); far.run(8)
  assert.ok(near(far.byName('七星公园').y, 150), 'more than 0.6 m off: the collider')
})

test('runtime: feet on a step more than 0.45 m: the sign only, no shelter, no shelter solids', async () => {
  const {stops, run, start, byName} = town({rows: [A], walked: (x, z) => z < -1 ? 149.4 : 150})
  await start()
  run(6)
  const a = byName('七星公园')
  assert.equal(a.state, 'drawn'); assert.equal(a.shelterState, 'skipped'); assert.ok(a.settled)
  assert.ok(near(a.spread, 0.6))
  const shelter = slotVertices(stops, a.slot, stops.vertices.pole)
  assert.ok(shelter.every(v => v[0] === 0 && v[1] === 0 && v[2] === 0), 'shelter range collapsed')
  const solids = []
  stops.near(0, 0, solid => solids.push(solid))
  assert.equal(solids.length, 1, 'only the pole')
})

test('runtime: geometry faces outwards on both sides; name faces 2 mm proud, read away from the pole on +t and towards it on −t', async () => {
  const {stops, run, start, byName} = town({rows: [A, B]})
  await start()
  run(6)
  const position = stops.mesh.geometry.getAttribute('position'), normal = stops.mesh.geometry.getAttribute('normal')
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3()
  let checked = 0
  for (let v = 0; v < position.count; v += 3) {
    a.fromBufferAttribute(position, v); b.fromBufferAttribute(position, v + 1); c.fromBufferAttribute(position, v + 2)
    const face = b.clone().sub(a).cross(c.clone().sub(a))
    if (face.length() < 1e-8) continue
    n.fromBufferAttribute(normal, v)
    assert.ok(face.normalize().dot(n) > 0.5, `triangle ${v / 3} winds against its normal`)
    checked++
  }
  assert.ok(checked > 900, `${checked} triangles of ${position.count / 3}, indexed ${!!stops.mesh.geometry.index}`)
  const faces = stops.faces.geometry
  const fp = faces.getAttribute('position'), fn = faces.getAttribute('normal')
  for (const name of ['七星公园', '电子科大信息科技学院']) {
    const stop = byName(name), parsed = parseBusStops(file([name === '七星公园' ? A : B])).stops[0]
    const base = stop.slot * 7 * 4
    for (let quad = 0; quad < 7; quad++) {
      const v0 = new THREE.Vector3().fromBufferAttribute(fp, base + quad * 4), v1 = new THREE.Vector3().fromBufferAttribute(fp, base + quad * 4 + 1), v2 = new THREE.Vector3().fromBufferAttribute(fp, base + quad * 4 + 2)
      const facing = v1.clone().sub(v0).cross(v2.clone().sub(v0)).normalize()
      assert.ok(facing.dot(new THREE.Vector3().fromBufferAttribute(fn, base + quad * 4)) > 0.99, `${name} quad ${quad}`)
      const right = v1.clone().sub(v0).normalize()
      const along = (vector, x, z) => vector.x * x + vector.z * z
      if (quad < 3) {
        assert.ok(near(along(v0.clone().sub(new THREE.Vector3(parsed.x, 0, parsed.z)), parsed.tx, parsed.tz), SIGN_THICK / 2 + FACE_LIFT, 1e-5), 'face +t 2 mm proud')
        assert.ok(along(right, parsed.nx, parsed.nz) < -0.99, 'face +t reads away from the pole')
      } else if (quad < 6) {
        assert.ok(near(along(v0.clone().sub(new THREE.Vector3(parsed.x, 0, parsed.z)), parsed.tx, parsed.tz), -(SIGN_THICK / 2 + FACE_LIFT), 1e-5))
        assert.ok(along(right, parsed.nx, parsed.nz) > 0.99, 'face −t reads towards the pole')
      } else {
        assert.ok(along(facing, parsed.nx, parsed.nz) > 0.99, 'fascia faces the lane')
        assert.ok(along(right, parsed.tx, parsed.tz) > 0.99, 'and reads along +t')
      }
    }
  }
})

test('runtime: solids for contact, the shelter front open, hidden stops block nothing', async () => {
  const {stops, run, start} = town({rows: [A]})
  await start()
  run(6)
  const source = (x, z, visit) => stops.near(x, z, visit)
  const at = (x, z) => ({x, y: 150, z})
  // A walker 0.25 m wide coming in from the kerb, under the roof, in front of the bench.
  for (const [x, z] of [[2.6, 0.3], [2.6, -0.5], [1.2, -0.9], [4.0, -1.0], [2.6, -1.05]]) {
    const point = at(x, z)
    assert.equal(resolveContact(point, 150, 0, 0.25, 0, source), false, `free at ${x}, ${z}`)
  }
  for (const [x, z, what] of [[2.6, -1.6, 'bench'], [2.6, -1.95, 'back panel'], [0, 0.1, 'pole'], [4.6, -0.4, 'front column']]) {
    const point = at(x, z)
    assert.equal(resolveContact(point, 150, 0, 0.25, 0, source), true, what)
  }
  const solids = []
  stops.near(2, -1, solid => solids.push(solid))
  assert.equal(solids.length, 6)
  for (const solid of solids) assert.ok(solid.y <= 150 && solid.y + solid.height >= 150.43)
  stops.hide()
  const hidden = []
  stops.near(2, -1, solid => hidden.push(solid))
  assert.equal(hidden.length, 0)
  assert.equal(stops.mesh.visible, false)
  stops.update(1 / 60, {x: 0, z: 0})
  assert.equal(stops.mesh.visible, true, 'the next update shows them again')
})

test('runtime: 170 m in, 190 m out as the walker moves; let-go stops give up their solids and atlas pin', async () => {
  const {stops, run, start, byName} = town()
  await start()
  run(2, {x: 0, z: 0})
  assert.equal(byName('远处'), undefined, '175 m: not yet')
  run(2, {x: 10, z: 0})
  assert.ok(byName('远处'), '165 m: taken up')
  run(2, {x: 0, z: 0})
  assert.ok(byName('远处'), '175 m: kept')
  run(2, {x: -20, z: 0})
  assert.equal(byName('远处'), undefined, '195 m: let go')
  assert.equal(byName('更远'), undefined)
  const pinned = stops.probe().atlas.pinned
  assert.equal(pinned, stops.probe().stops.filter(stop => stop.name).length)
  run(2, {x: 5000, z: 0})
  assert.deepEqual([stops.probe().shown, stops.probe().drawn, stops.probe().atlas.pinned, stops.mesh.visible], [0, 0, 0, false])
  const solids = []
  stops.near(0, 0, solid => solids.push(solid))
  assert.equal(solids.length, 0)
})

test('runtime: settling as the bollards — three equal readings, a settled stop ignores one wild reading', async () => {
  let ground = 150
  const {stops, frame, run, start, byName} = town({rows: [A], walked: () => ground})
  await start()
  frame()
  assert.equal(byName('七星公园').settled, false)
  run(4)
  assert.equal(byName('七星公园').settled, true)
  assert.ok(SETTLE_LOOKS === 3)
  ground = 152
  // Up to 8 s to the next recheck, then 1.5 s apart: fewer than six wild readings, so no 30 s back-off yet.
  run(5)
  assert.ok(near(byName('七星公园').y, 150), 'a 2 m jump is not followed at once')
  ground = 150.1
  run(10)
  assert.ok(near(byName('七星公园').y, 150.1), 'a small change is')
  void stops
})

test('runtime: one column foot reading far off does not take a settled shelter down', async () => {
  let wild = false
  // The foot furthest along +x of the shelter of A reads 2 m up once the shelter has settled.
  const {run, start, byName} = town({rows: [A], walked: x => wild && x > 4 ? 152 : 150})
  await start()
  run(4)
  assert.equal(byName('七星公园').shelterState, 'up')
  assert.equal(byName('七星公园').settled, true)
  wild = true
  run(20)
  const stop = byName('七星公园')
  assert.equal(stop.shelterState, 'up', 'still standing')
  assert.ok(stop.corners.every(corner => near(corner.y, 150)), 'on the ground it settled on')
})

test('runtime: a name is shown in the frame its canvas goes to the GPU, not before (no older name of a reused cell)', async () => {
  // A canvas that takes every 2D call; `CanvasTexture.version` counts the uploads asked for.
  const ctx = new Proxy({}, {get: (_, key) => key === 'measureText' ? text => ({width: [...String(text)].length * 10}) : () => {}, set: () => true})
  const canvas = {width: 0, height: 0, getContext: () => ctx}
  const rows = Array.from({length: 12}, (_, i) => [(i % 4) * 12, Math.floor(i / 4) * 15, 0, 0, 0, `站${i}`, ''])
  const scene = new THREE.Scene()
  const stops = busStops(scene, () => 150, undefined, {canvas: () => canvas, load: () => Promise.resolve(file(rows))})
  const frame = () => stops.update(1 / 60, {x: 0, z: 0})
  frame(); await flush(); frame()
  assert.ok(stops.texture, 'a texture over the canvas')
  let named = new Set(), sawLate = false
  for (let i = 0; i < 600; i++) {
    const version = stops.texture.version, paintedBefore = stops.probe().atlas.painted
    frame()
    const probe = stops.probe(), now = new Set(probe.stops.filter(stop => stop.named).map(stop => stop.key))
    const fresh = [...now].filter(key => !named.has(key))
    if (fresh.length) assert.ok(stops.texture.version > version, `frame ${i}: ${fresh.length} name(s) shown without an upload`)
    if (probe.atlas.painted > paintedBefore && stops.texture.version === version) sawLate = true
    named = now
  }
  assert.ok(sawLate, 'some names were painted between uploads (the upload is throttled)')
  assert.equal(named.size, 12, 'all shown in the end')
})
