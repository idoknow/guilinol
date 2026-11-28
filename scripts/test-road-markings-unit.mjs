import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRoadMarkings,
  PAINT_WHITE,
  PAINT_YELLOW,
} from '../web/src/road-markings.ts'
import {streetGeometry} from '../web/src/street-worker.ts'
import {SHIZIJIE_ORIGIN, isShizijieCrosswalkRing} from '../web/src/shizijie-zone.ts'

function colorDistSq(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
}

/** Build a flat/sloped rectangular surface quad in tile-local coords split into two triangles. */
function pushQuadTris(xyz, offsets, x0, z0, x1, z1, yFn = () => 0.045) {
  const pushTri = (ax, az, bx, bz, cx, cz) => {
    offsets.push(xyz.length)
    xyz.push(ax, yFn(ax, az), az, bx, yFn(bx, bz), bz, cx, yFn(cx, cz), cz)
  }
  pushTri(x0, z0, x0, z1, x1, z0)
  pushTri(x1, z0, x0, z1, x1, z1)
}

function emittedTriangles(xyz, rgb, surfaceKinds, startTriIdx) {
  const tris = []
  for (let o = startTriIdx; o < xyz.length; o += 9) {
    const k = surfaceKinds[o / 3]
    if (k !== 2) continue
    const ys = [xyz[o + 1], xyz[o + 4], xyz[o + 7]]
    const xs = [xyz[o], xyz[o + 3], xyz[o + 6]]
    const zs = [xyz[o + 2], xyz[o + 5], xyz[o + 8]]
    const col = [rgb[o], rgb[o + 1], rgb[o + 2]]
    const isWhite = colorDistSq(col, PAINT_WHITE) < 1e-3
    const isYellow = colorDistSq(col, PAINT_YELLOW) < 1e-3
    tris.push({
      xs, ys, zs,
      cx: (xs[0] + xs[1] + xs[2]) / 3,
      cy: (ys[0] + ys[1] + ys[2]) / 3,
      cz: (zs[0] + zs[1] + zs[2]) / 3,
      col, isWhite, isYellow,
    })
  }
  return tris
}

test('two-way 2-lane street emits yellow dashed mid-block, solid near junction, and half-width stop line', () => {
  const xyz = [], rgb = [], surfaceKinds = [], alongVals = []
  const roadTriOffsets = [], cycleTriOffsets = []
  // 8m-wide N-S road along x=100 (x in [96..104], z in [10..150]) + E-W cross arm around z=150
  pushQuadTris(xyz, roadTriOffsets, 96, 10, 104, 150)
  pushQuadTris(xyz, roadTriOffsets, 70, 145, 130, 155)
  const baseStart = xyz.length

  const graph = {
    nodes: [
      {id: 1, x: 100, z: 10},
      {id: 2, x: 100, z: 150},
      {id: 3, x: 70, z: 150},
      {id: 4, x: 130, z: 150},
    ],
    lanes: [
      {from: 1, to: 2, kind: 'motor', cls: 'secondary', offset: 1.5, oneway: false},
      {from: 2, to: 1, kind: 'motor', cls: 'secondary', offset: 1.5, oneway: false},
      {from: 2, to: 3, kind: 'motor', cls: 'secondary', offset: 1.5, oneway: false},
      {from: 2, to: 4, kind: 'motor', cls: 'secondary', offset: 1.5, oneway: false},
    ],
    signals: [{node: 2, group: 2}],
  }

  const res = buildRoadMarkings({
    origin: [0, 0],
    xyz, rgb, surfaceKinds, alongVals,
    roadTriOffsets, cycleTriOffsets,
    legacyKind2: [], decor: [], roadGraph: graph,
  })
  assert.ok(res.emittedTriangles > 20)

  const tris = emittedTriangles(xyz, rgb, surfaceKinds, baseStart)
  // Every emitted triangle lies strictly at y = 0.045 + 0.006 = 0.051
  for (const t of tris) {
    assert.ok(Math.abs(t.cy - 0.051) < 1e-4, `expected y=0.051, got ${t.cy}`)
    const onMain = t.cx >= 95.99 && t.cx <= 104.01 && t.cz >= 9.99 && t.cz <= 155.01
    const onCross = t.cz >= 144.99 && t.cz <= 155.01 && t.cx >= 69.99 && t.cx <= 130.01
    assert.ok(onMain || onCross, `no marking outside carriageway: (${t.cx.toFixed(2)},${t.cz.toFixed(2)})`)
  }

  // Yellow centerline exists near center x=100, both mid-block and approach
  const yellowCenter = tris.filter(t => t.isYellow && Math.abs(t.cx - 100) < 0.3)
  assert.ok(yellowCenter.length >= 4, 'expected yellow centerline on 2-lane two-way road')

  // Mid-block dashed gap check around z=40..90: ensure yellow centerlines don't cover 100% continuously (4m dash / 6m gap)
  const midYellowZ = yellowCenter.filter(t => t.cz >= 45 && t.cz <= 75)
  const zSpread = new Set(midYellowZ.map(t => Math.floor(t.cz)))
  assert.ok(zSpread.size < 25, `expected dashed yellow gaps mid-block, got ${zSpread.size} occupied meters`)

  // Stop bar near junction (z ~ 132..140) on approaching direction (u=1 -> v=2 going +Z: driver's right is -X in XZ -> [tMid..tR]? Wait: dir=(0,1) -> rx=-1,rz=0 -> right is x<100!)
  // Right half for +Z travel is x in [96..100]
  const stopBars = tris.filter(t => t.isWhite && t.cz > 125 && t.cz < 142 && t.xs.some(x => x < 99) && !t.xs.some(x => x > 100.2))
  assert.ok(stopBars.length >= 2, 'expected half-width white stop line on approaching lanes only')
})

test('4-lane undivided two-way road emits double yellow centerline and narrow alley emits none', () => {
  // 1) 12.8m wide 4-lane two-way
  const xyz = [], rgb = [], surfaceKinds = [], alongVals = []
  const roadTriOffsets = [], cycleTriOffsets = []
  pushQuadTris(xyz, roadTriOffsets, 93.6, 20, 106.4, 180)
  const baseStart = xyz.length

  const graph4 = {
    nodes: [{id: 1, x: 100, z: 20}, {id: 2, x: 100, z: 180}],
    lanes: [
      {from: 1, to: 2, kind: 'motor', cls: 'primary', offset: 1.5, oneway: false},
      {from: 2, to: 1, kind: 'motor', cls: 'primary', offset: 1.5, oneway: false},
    ],
    signals: [],
  }
  buildRoadMarkings({
    origin: [0, 0], xyz, rgb, surfaceKinds, alongVals,
    roadTriOffsets, cycleTriOffsets, legacyKind2: [], decor: [], roadGraph: graph4,
  })
  const tris4 = emittedTriangles(xyz, rgb, surfaceKinds, baseStart)
  const leftYellow = tris4.some(t => t.isYellow && t.cx < 99.95 && t.cx > 99.7)
  const rightYellow = tris4.some(t => t.isYellow && t.cx > 100.05 && t.cx < 100.3)
  assert.ok(leftYellow && rightYellow, 'expected double yellow lines on 4-lane undivided road')

  // Same-dir white lane dividers near +/-3.2m
  const whiteInner = tris4.some(t => t.isWhite && Math.abs(Math.abs(t.cx - 100) - 3.2) < 0.35)
  assert.ok(whiteInner, 'expected same-direction white dashed dividers at +-3.2m')

  // 2) Narrow 4.2m residential lane -> ZERO yellow lines
  const xyzN = [], rgbN = [], skN = [], alN = [], rtN = [], ctN = []
  pushQuadTris(xyzN, rtN, 97.9, 20, 102.1, 140)
  const baseN = xyzN.length
  const graphNarrow = {
    nodes: [{id: 1, x: 100, z: 20}, {id: 2, x: 100, z: 140}],
    lanes: [{from: 1, to: 2, kind: 'motor', cls: 'residential', offset: 0, oneway: false}],
    signals: [],
  }
  buildRoadMarkings({
    origin: [0, 0], xyz: xyzN, rgb: rgbN, surfaceKinds: skN, alongVals: alN,
    roadTriOffsets: rtN, cycleTriOffsets: ctN, legacyKind2: [], decor: [], roadGraph: graphNarrow,
  })
  const trisN = emittedTriangles(xyzN, rgbN, skN, baseN)
  assert.equal(trisN.filter(t => t.isYellow).length, 0, 'narrow <5.6m street must NOT have yellow centerline per GB 5768')
})

test('sloped road draping & curb clipping reject sidewalk spillover and match slope elevation + 0.006m', () => {
  const xyz = [], rgb = [], surfaceKinds = [], alongVals = []
  const roadTriOffsets = [], cycleTriOffsets = []
  // Road x in [95..105], sidewalk intentionally absent from roadTriOffsets! Slope: y = 10 + 0.05 * z
  const slopeY = (_x, z) => 10 + 0.05 * z
  pushQuadTris(xyz, roadTriOffsets, 95, 20, 105, 160, slopeY)
  // Cycleway x in [107..110], height 0.060 + 0.05 * z
  pushQuadTris(xyz, cycleTriOffsets, 107, 20, 110, 160, (_x, z) => 10.015 + 0.05 * z)
  const baseStart = xyz.length

  const graph = {
    nodes: [{id: 1, x: 100, z: 20}, {id: 2, x: 100, z: 160}, {id: 3, x: 75, z: 160}, {id: 4, x: 130, z: 160}],
    lanes: [
      {from: 1, to: 2, kind: 'motor', cls: 'trunk', offset: 0, oneway: true},
      {from: 2, to: 3, kind: 'motor', cls: 'trunk', offset: 0, oneway: true},
      {from: 2, to: 4, kind: 'motor', cls: 'trunk', offset: 0, oneway: true},
    ],
    signals: [{node: 2, group: 2}],
  }
  buildRoadMarkings({
    origin: [0, 0], xyz, rgb, surfaceKinds, alongVals,
    roadTriOffsets, cycleTriOffsets, legacyKind2: [], decor: [], roadGraph: graph,
  })
  const tris = emittedTriangles(xyz, rgb, surfaceKinds, baseStart)
  assert.ok(tris.length > 30)

  let hasBikeIconOnCycle = false
  for (let o = baseStart; o < xyz.length; o += 9) {
    for (let k = 0; k < 3; k++) {
      const vx = xyz[o + k * 3], vy = xyz[o + k * 3 + 1], vz = xyz[o + k * 3 + 2]
      const onCycle = vx >= 106.99
      if (onCycle) hasBikeIconOnCycle = true
      const expected = (onCycle ? 10.015 : 10) + 0.05 * vz + 0.006
      assert.ok(Math.abs(vy - expected) < 1e-4, `drape Y mismatch at (${vx.toFixed(2)},${vz.toFixed(2)}): got ${vy}, want ${expected}`)
      assert.ok((vx >= 94.99 && vx <= 105.01) || (vx >= 106.99 && vx <= 110.01), `clipped outside road/cycle: x=${vx}`)
    }
  }
  assert.ok(hasBikeIconOnCycle, 'expected bicycle icon draped onto cycleway')
})

test('Shizijie no-crosswalk suppression & synthetic verify-shizijie-order compatibility', () => {
  // 1) Pure crosswalk-only inside SHIZIJIE_NO_CROSSWALK_POLY -> outputs 0 positions & 0 road (identical contract)
  const localRing = [[-190, -24], [190, -24], [190, 24], [-190, 24]]
  const tileOrigin = [Math.floor(SHIZIJIE_ORIGIN[0] / 256) * 256, Math.floor(SHIZIJIE_ORIGIN[1] / 256) * 256]
  const shift = [
    Math.round((SHIZIJIE_ORIGIN[0] - tileOrigin[0]) * 100),
    Math.round((SHIZIJIE_ORIGIN[1] - tileOrigin[1]) * 100),
  ]
  const ringInTile = localRing.map(([dx, dz]) => [shift[0] + dx, shift[1] + dz])
  const syntheticStreets = [[[2, ringInTile]], [], []]
  const resEmpty = streetGeometry(
    syntheticStreets,
    () => 0,
    [], [], () => 0, undefined, new Set(), tileOrigin,
  )
  assert.equal(resEmpty.positions.length, 0)
  assert.equal(resEmpty.road.length, 0)

  // 2) Full roadGraph running through Shizijie core still emits 0 crosswalk triangles inside SHIZIJIE_NO_CROSSWALK_POLY
  const ox = tileOrigin[0], oz = tileOrigin[1]
  const lx = SHIZIJIE_ORIGIN[0] - ox, lz = SHIZIJIE_ORIGIN[1] - oz
  const xyz = [], rgb = [], sk = [], al = [], rt = [], ct = []
  pushQuadTris(xyz, rt, lx - 6, lz - 60, lx + 6, lz + 60)
  pushQuadTris(xyz, rt, lx - 60, lz - 6, lx + 60, lz + 6)
  const base = xyz.length
  const szGraph = {
    nodes: [
      {id: 1, x: SHIZIJIE_ORIGIN[0], z: SHIZIJIE_ORIGIN[1] + 55},
      {id: 2, x: SHIZIJIE_ORIGIN[0], z: SHIZIJIE_ORIGIN[1]},
      {id: 3, x: SHIZIJIE_ORIGIN[0] - 55, z: SHIZIJIE_ORIGIN[1]},
      {id: 4, x: SHIZIJIE_ORIGIN[0] + 55, z: SHIZIJIE_ORIGIN[1]},
    ],
    lanes: [
      {from: 1, to: 2, kind: 'motor', cls: 'trunk', offset: 0, oneway: true},
      {from: 2, to: 3, kind: 'motor', cls: 'primary', offset: 0, oneway: true},
      {from: 2, to: 4, kind: 'motor', cls: 'primary', offset: 0, oneway: true},
    ],
    signals: [{node: 2, group: 2}],
  }
  const szBase = xyz.length
  const withSuppress = buildRoadMarkings({
    origin: tileOrigin,
    xyz, rgb, surfaceKinds: sk, alongVals: al,
    roadTriOffsets: rt, cycleTriOffsets: ct,
    legacyKind2: [[2, ringInTile]],
    decor: [],
    roadGraph: szGraph,
    shizijieCheck: true,
    shouldSuppressCrosswalk: ring => isShizijieCrosswalkRing(ring, ox, oz),
  })
  const xyzUn=[], rgbUn=[], skUn=[], alUn=[], rtUn=[], ctUn=[]
  pushQuadTris(xyzUn, rtUn, lx - 6, lz - 60, lx + 6, lz + 60)
  pushQuadTris(xyzUn, rtUn, lx - 60, lz - 6, lx + 60, lz + 6)
  const withoutSuppress = buildRoadMarkings({
    origin: tileOrigin,
    xyz: xyzUn, rgb: rgbUn, surfaceKinds: skUn, alongVals: alUn,
    roadTriOffsets: rtUn, cycleTriOffsets: ctUn,
    legacyKind2: [[2, ringInTile]],
    decor: [],
    roadGraph: szGraph,
    shizijieCheck: false,
  })
  assert.ok(withSuppress.emittedTriangles < withoutSuppress.emittedTriangles,
    `Shizijie crosswalk suppression should omit crosswalk bars (${withSuppress.emittedTriangles} < ${withoutSuppress.emittedTriangles})`)
  assert.ok(xyz.length > szBase, 'expected stop lines and lane lines still emitted outside crosswalk suppression')
})

test('decor kind=10 school gate triggers yellow cross-hatch box without floating decor10 collision', () => {
  // Simulate Kuiguang gate tile at (-1536, -256) with local road along (-1357.8, 3.1)->(-1324.1, -80.6) -> local (178.2, 259.1)->(211.9, 175.4)
  const origin = [-1536, -256]
  const xyz = [], rgb = [], sk = [], al = [], rt = [], ct = []
  // 12m-wide road corridor around (178.2, 259.1) -> (211.9, 175.4)
  const ax = 178.2, az = 259.1, bx = 211.9, bz = 175.4
  const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, rx = -uz * 6, rz = ux * 6
  const pushStrip = (x0, z0, x1, z1) => {
    rt.push(xyz.length); xyz.push(x0 - rx, 0.045, z0 - rz, x0 + rx, 0.045, z0 + rz, x1 + rx, 0.045, z1 + rz)
    rt.push(xyz.length); xyz.push(x0 - rx, 0.045, z0 - rz, x1 + rx, 0.045, z1 + rz, x1 - rx, 0.045, z1 - rz)
  }
  pushStrip(ax, az, bx, bz)
  const base = xyz.length
  const graph = {
    nodes: [{id: 1, x: -1357.8, z: 3.1}, {id: 2, x: -1324.1, z: -80.6}],
    lanes: [{from: 1, to: 2, kind: 'motor', cls: 'tertiary', offset: 0, oneway: true}],
    signals: [],
  }
  const decor = [
    [10, 1786, 2441, -40, 31],
    [10, 1778, 2462, 117, 31],
  ]
  const res = buildRoadMarkings({
    origin, xyz, rgb, surfaceKinds: sk, alongVals: al,
    roadTriOffsets: rt, cycleTriOffsets: ct,
    legacyKind2: [], decor, roadGraph: graph,
  })
  assert.equal(res.replacedDecor10, true)
  const tris = emittedTriangles(xyz, rgb, sk, base)
  const yellowBox = tris.filter(t => t.isYellow && t.cz > 235 && t.cz < 254)
  assert.ok(yellowBox.length >= 8, 'expected draped yellow cross-hatched mesh box at Kuiguang gate')
})

test('junction cores suppress internal crossing lines, service arterial crossings, and flared endpoint skewing', () => {
  const xyz = [], rgb = [], sk = [], al = [], rt = [], ct = []
  pushQuadTris(xyz, rt, 95.5, 10, 104.5, 200)
  pushQuadTris(xyz, rt, 70, 110, 130, 135)
  const base = xyz.length

  const graph = {
    nodes: [
      {id: 1, x: 100, z: 10},
      {id: 2, x: 100, z: 112},
      {id: 3, x: 100, z: 128},
      {id: 4, x: 100, z: 200},
      {id: 5, x: 75, z: 60},
      {id: 6, x: 125, z: 60},
    ],
    lanes: [
      {from: 1, to: 2, kind: 'motor', cls: 'primary', offset: 0, oneway: true},
      {from: 2, to: 3, kind: 'motor', cls: 'primary', offset: 0, oneway: true},
      {from: 3, to: 4, kind: 'motor', cls: 'primary', offset: 0, oneway: true},
      {from: 5, to: 6, kind: 'motor', cls: 'service', offset: 0, oneway: false},
    ],
    signals: [{node: 2, group: 99}, {node: 3, group: 99}],
  }

  buildRoadMarkings({
    origin: [0, 0], xyz, rgb, surfaceKinds: sk, alongVals: al,
    roadTriOffsets: rt, cycleTriOffsets: ct,
    legacyKind2: [], decor: [], roadGraph: graph,
  })
  const tris = emittedTriangles(xyz, rgb, sk, base)
  assert.ok(tris.length > 10)
  for (const t of tris) {
    assert.ok(t.cx >= 95.4 && t.cx <= 104.6, `marking leaked outside nominal corridor: (${t.cx.toFixed(2)},${t.cz.toFixed(2)})`)
    assert.ok(t.cz < 114 || t.cz > 126, `marking entered signal box interior at z=${t.cz.toFixed(2)}`)
  }
  const crossAt60 = tris.filter(t => Math.abs(t.cz - 60) < 0.8 && Math.abs(t.cx - 100) < 0.6)
  assert.equal(crossAt60.length, 0, 'service road crossing arterial must not draw centerline markings across z=60')
})

test('top-surface draping elevates above lower k0 seams and obstacleGrid blocks raised islands', () => {
  const xyz = [], rgb = [], sk = [], al = [], rt = [], ct = [], ot = []
  // Lower k0 road at y=0.045m, overlapping upper k0 patch at y=0.060m across z in [60, 140], and raised k4 grass island at y=0.195m over x in [103.5, 108], z in [75, 95]
  const pushRect = (offs, x0, x1, z0, z1, y) => {
    offs.push(xyz.length); xyz.push(x0, y, z0, x0, y, z1, x1, y, z1)
    offs.push(xyz.length); xyz.push(x0, y, z0, x1, y, z1, x1, y, z0)
  }
  pushRect(rt, 96, 104, 10, 180, 0.045)
  pushRect(rt, 96, 104, 60, 140, 0.060)
  pushRect(ot, 103.2, 107.0, 75, 95, 0.195)
  const base = xyz.length

  const graph = {
    nodes: [{id: 1, x: 100, z: 15}, {id: 2, x: 100, z: 175}],
    lanes: [{from: 1, to: 2, kind: 'motor', cls: 'primary', offset: 0, oneway: true}],
    signals: [],
  }
  buildRoadMarkings({
    origin: [0, 0], xyz, rgb, surfaceKinds: sk, alongVals: al,
    roadTriOffsets: rt, cycleTriOffsets: ct, obstacleTriOffsets: ot,
    legacyKind2: [], decor: [], roadGraph: graph,
  })
  const ysOverlap = []
  for (let i = base; i < xyz.length; i += 9) {
    const cz = (xyz[i + 2] + xyz[i + 5] + xyz[i + 8]) / 3
    if (cz > 65 && cz < 135) ysOverlap.push(xyz[i + 1], xyz[i + 4], xyz[i + 7])
  }
  assert.ok(ysOverlap.length > 0)
  for (const y of ysOverlap) {
    assert.ok(y >= 0.065, `expected overlapped marking draped onto upper k0 layer (>=0.065m), got ${y}`)
  }
})

test('ungraphed junction leg preserves legacy crosswalk bars outside mapped edges', () => {
  const xyz = [], rgb = [], sk = [], al = [], rt = [], ct = []
  pushQuadTris(xyz, rt, 110, 10, 130, 210)
  pushQuadTris(xyz, rt, 40, 110, 200, 130)
  const base = xyz.length
  // Mapped edges ONLY on E & S; W leg is ungraphed but has legacy kind=2 crosswalk bars around x=100, z=120
  const graph = {
    nodes: [{id: 1, x: 120, z: 120}, {id: 2, x: 200, z: 120}, {id: 3, x: 120, z: 205}],
    lanes: [
      {from: 1, to: 2, kind: 'motor', cls: 'secondary', offset: 0, oneway: false},
      {from: 2, to: 1, kind: 'motor', cls: 'secondary', offset: 0, oneway: false},
      {from: 1, to: 3, kind: 'motor', cls: 'secondary', offset: 0, oneway: false},
      {from: 3, to: 1, kind: 'motor', cls: 'secondary', offset: 0, oneway: false},
    ],
    signals: [],
  }
  const cwBar = zCenter => [2, [
    [9800, Math.round((zCenter - 0.25) * 100)],
    [10200, Math.round((zCenter - 0.25) * 100)],
    [10200, Math.round((zCenter + 0.25) * 100)],
    [9800, Math.round((zCenter + 0.25) * 100)],
  ]]
  buildRoadMarkings({
    origin: [0, 0], xyz, rgb, surfaceKinds: sk, alongVals: al,
    roadTriOffsets: rt, cycleTriOffsets: ct,
    legacyKind2: [cwBar(116), cwBar(118), cwBar(120), cwBar(122)],
    decor: [], roadGraph: graph,
  })
  const tris = emittedTriangles(xyz, rgb, sk, base)
  const wLegTris = tris.filter(t => t.cx < 103 && t.cz > 114 && t.cz < 124)
  assert.ok(wLegTris.length >= 4, 'expected ungraphed W leg crosswalk bars preserved')
})

test('curb-side white edge lines stay clear of kerb gully grate zone (>= 0.50m inset)', () => {
  const xyz = [], rgb = [], sk = [], al = [], rt = [], ct = []
  pushQuadTris(xyz, rt, 94, 0, 106, 120)
  const base = xyz.length
  const graph = {
    nodes: [{id: 1, x: 100, z: 10}, {id: 2, x: 100, z: 110}],
    lanes: [
      {from: 1, to: 2, kind: 'motor', cls: 'secondary', offset: 3, oneway: false},
      {from: 2, to: 1, kind: 'motor', cls: 'secondary', offset: -3, oneway: false},
    ],
    signals: [],
  }
  buildRoadMarkings({
    origin: [0, 0], xyz, rgb, surfaceKinds: sk, alongVals: al,
    roadTriOffsets: rt, cycleTriOffsets: ct,
    legacyKind2: [], decor: [], roadGraph: graph,
  })
  const whiteMidBlock = emittedTriangles(xyz, rgb, sk, base).filter(
    t => t.cz > 30 && t.cz < 90 && t.isWhite
  )
  assert.ok(whiteMidBlock.length >= 2, 'expected white mid-block edge lines')
  for (const t of whiteMidBlock) {
    assert.ok(t.cx <= 99.9 || t.cx <= 105.50, `right curb line too close to kerb: cx=${t.cx}`)
    assert.ok(t.cx >= 100.1 || t.cx >= 94.50, `left curb line too close to kerb: cx=${t.cx}`)
    // Ensure triangles along outer curbs [94.0..94.48] and [105.52..106.0] remain free of outer edge paint
    assert.ok(!(t.cx > 94.02 && t.cx < 94.48), `left gully zone [0.02..0.48m] hit at cx=${t.cx}`)
    assert.ok(!(t.cx > 105.52 && t.cx < 105.98), `right gully zone [0.02..0.48m] hit at cx=${t.cx}`)
  }
})

test('adjacent parallel mapped carriageway never draws duplicate aux edge lines on partner span', () => {
  const xyz = [], rgb = [], sk = [], al = [], rt = [], ct = []
  pushQuadTris(xyz, rt, 94, 10, 99, 130)
  pushQuadTris(xyz, rt, 101, 10, 106, 130)
  const base = xyz.length
  const graph = {
    nodes: [
      {id: 1, x: 96.5, z: 10}, {id: 2, x: 96.5, z: 130},
      {id: 3, x: 103.5, z: 130}, {id: 4, x: 103.5, z: 10},
    ],
    lanes: [
      {from: 1, to: 2, kind: 'motor', cls: 'primary', offset: 0, oneway: true},
      {from: 3, to: 4, kind: 'motor', cls: 'primary', offset: 0, oneway: true},
    ],
    signals: [],
  }
  buildRoadMarkings({
    origin: [0, 0], xyz, rgb, surfaceKinds: sk, alongVals: al,
    roadTriOffsets: rt, cycleTriOffsets: ct,
    legacyKind2: [], decor: [], roadGraph: graph,
  })
  // Neither carriageway should draw white markings at 0.24m inside partner curb (x in [101.18..101.30] or [98.70..98.82])
  const midWhite = emittedTriangles(xyz, rgb, sk, base).filter(t => t.cz > 30 && t.cz < 110 && t.isWhite)
  assert.ok(midWhite.length >= 2, 'expected partner outer white curb markings')
  for (const t of midWhite) {
    assert.ok(!(t.cx > 101.15 && t.cx < 101.35), `duplicate aux left line drawn at partner median curb: cx=${t.cx}`)
    assert.ok(!(t.cx > 98.65 && t.cx < 98.85), `duplicate aux right line drawn at partner median curb: cx=${t.cx}`)
  }
})
