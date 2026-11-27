import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import {emitVergeCurbWalls} from '../web/src/curb-returns.ts'
import {medianRails, sampleChainAt, traceDividerChains} from '../web/src/median-rails.ts'
import {emitRoadDividers, extractCollectorSoftDelineators} from '../web/src/road-divider-profiles.ts'
import {sampleDividerSpanGrade} from '../web/src/roadbed-clearance.ts'

function geometry(decor) {
  const legs=[],posts=[]
  medianRails(decor,()=>false,(start,end,banner)=>legs.push([start,end,banner]),point=>posts.push([point.x,point.z]))
  return {legs,posts}
}

test('bend shares one endpoint; posts follow chainage, not panel centres',()=>{
  const {legs,posts}=geometry([[1,10,0,0,20,0,0,200,0],[2,20,15,157,30,200,0,200,300]])
  assert.equal(legs[0][1],legs[1][0]);assert.equal(legs[1][2],true)
  assert.deepEqual(posts.sort(),[[0,0],[1,0],[2,0],[2,1],[2,2],[2,3]].sort())
})

test('legacy spans weld quantization noise, never span a crosswalk',()=>{
  const {legs,posts}=geometry([[1,15,0,0,30],[1,46,0,0,30],[1,115,0,0,30],[6,80,0,0,40]])
  assert.equal(legs.length,3);assert.equal(legs[0][1],legs[1][0]);assert.notEqual(legs[1][1],legs[2][0]);assert.ok(posts.every(([x])=>x<=6.1||x>=10))
})

test('precise crossing edges do not get legacy endpoint tolerance',()=>{
  const {legs}=geometry([[1,10,0,0,20,0,0,200,0],[1,30,0,0,20,208,0,400,0]])
  assert.notEqual(legs[0][1],legs[1][0]);assert.equal(legs[1][0].x,2.08)
})

test('traceDividerChains detects true roadway openings vs 256 m tile borders and preserves gaps', () => {
  const chains = traceDividerChains([
    // Chain 1 starts on tile border (x=0.1) and stops at a crosswalk opening (x=6.0)
    {group: 'median_metal_rail', rawKind: 1, sideSign: 0, banner: false, startX: 0.1, startZ: 40, endX: 3.0, endZ: 40, exact: false},
    {group: 'median_metal_rail', rawKind: 1, sideSign: 0, banner: false, startX: 3.1, startZ: 40, endX: 6.0, endZ: 40, exact: false},
    // 4.0 m crosswalk gap [6.0 .. 10.0]
    // Chain 2 has both ends open inside chunk [10.0 .. 16.0]
    {group: 'median_metal_rail', rawKind: 1, sideSign: 0, banner: false, startX: 10.0, startZ: 40, endX: 13.0, endZ: 40, exact: false},
    {group: 'median_metal_rail', rawKind: 2, sideSign: 0, banner: true, startX: 13.05, startZ: 40, endX: 16.0, endZ: 40, exact: false},
  ])
  assert.equal(chains.length, 2)
  const borderChain = chains.find(c => Math.min(c.legs[0].start.x, c.legs.at(-1).end.x) < 1)
  const innerChain = chains.find(c => c !== borderChain)
  assert.ok(borderChain && innerChain)
  assert.equal(borderChain.startOpen && borderChain.endOpen, false, 'tile-border end must not be flagged as open cap')
  assert.equal(borderChain.startOpen || borderChain.endOpen, true, 'crosswalk end must be flagged as open cap')
  assert.equal(innerChain.startOpen, true)
  assert.equal(innerChain.endOpen, true)
  const mid = sampleChainAt(innerChain, innerChain.totalLength * 0.5)
  assert(Math.abs(mid.x - 13.0) < 0.1)
})

test('emitVergeCurbWalls adds granite curb faces around kind=4 verges while skipping tile edges & bridged seams', () => {
  const emitted = []
  const loop = [{x: 0, y: 10}, {x: 12, y: 10}, {x: 12, y: 12.2}, {x: 0, y: 12.2}]
  const skip = new Set(['1200,1000|1200,1220'])
  const quads = emitVergeCurbWalls(
    [loop],
    (x, z, off) => new THREE.Vector3(x, 150 + off, z),
    () => 150,
    (a, b, c, kind, vertical) => emitted.push({a, b, c, kind, vertical}),
    {
      topOffset: 0.195,
      bottomOffset: 0.045,
      skipCurbEdges: skip,
      edgeKeyCm: (ax, az, bx, bz) => {
        const x1 = Math.round(ax), z1 = Math.round(az), x2 = Math.round(bx), z2 = Math.round(bz)
        return x1 < x2 || (x1 === x2 && z1 < z2) ? `${x1},${z1}|${x2},${z2}` : `${x2},${z2}|${x1},${z1}`
      },
    },
  )
  // Two 12 m edges (each 3 steps -> 6 quads), west border edge skipped, east seam edge skipped
  assert.equal(quads, 6)
  assert.equal(emitted.length, 12)
  assert.ok(emitted.every(t => t.kind === 1 && t.vertical === true))
})

test('extractCollectorSoftDelineators places bollards only on narrow collector verges and clears ends/arterials', () => {
  const narrowVerge = [4, [[1000, 2000], [3000, 2000], [3000, 2022], [1000, 2022]]] // 20m x 0.22m
  const wideArterialVerge = [4, [[1000, 4000], [3000, 4000], [3000, 4220], [1000, 4220]]] // 20m x 2.2m
  const posts = extractCollectorSoftDelineators([narrowVerge, wideArterialVerge], [])
  assert(posts.length >= 4 && posts.length <= 6, `expected 4..6 bollards along 20m collector verge, got ${posts.length}`)
  // End margins >= 1.8m kept clear of junctions/crosswalks; all posts stay near z=20.11 (never on wide verge z=41.1)
  assert.ok(posts.every(p => p.x >= 11.8 && p.x <= 28.2 && Math.abs(p.z - 20.11) < 0.2))
  // Nearby existing arterial decor suppresses duplicate bollards
  const suppressed = extractCollectorSoftDelineators([narrowVerge], [[15, 20.1]])
  assert(suppressed.length < posts.length)
})

test('emitRoadDividers avoids streets.ts uSlogan & batch.ts isProceduralShopBox magic dimensions on all divider styles', () => {
  const boxes = []
  const box = (x, y, z, w, h, d, yaw = 0, tint = null, pitch = 0) => boxes.push({x, y, z, w, h, d, yaw, tint, pitch})
  const palette = {
    railing: new THREE.Color(0xd9d5ca),
    stoneLight: new THREE.Color(0xa6a39a),
    stoneMid: new THREE.Color(0x8c8981),
    bannerRed: new THREE.Color(0xc23b33),
    hedge: new THREE.Color(0x486544),
    iron: new THREE.Color(0x42624e),
  }
  // Test all 4 corridors: Jiefang East (metal rail + metal guardrail), Zhongshan N (green trees + tree planter),
  // Lijiang (green trees + hedge curb), Taiping narrow (soft delineator)
  const cases = [
    {origin: [-768, -256], decor: [[1, 2200, 1720, 25, 30], [2, 2229, 1727, 25, 30], [5, 2230, 1840, 25, 40]]},
    {origin: [-1024, -512], decor: [
      [1, 1850, 1910, 177, 30], [1, 1844, 1939, 177, 30], [1, 1838, 1968, 177, 30], [1, 1832, 1997, 177, 30], [1, 1826, 2026, 177, 30],
      [5, 1700, 1916, 177, 40], [5, 1692, 1955, 177, 40], [5, 1684, 1994, 177, 40], [5, 1676, 2033, 177, 40],
    ]},
    {origin: [256, 1792], decor: [[1, 940, 1130, 0, 30], [1, 970, 1130, 0, 30], [5, 940, 1040, 0, 40], [5, 980, 1040, 0, 40]]},
    {origin: [-1280, -256], decor: [[5, 2300, 380, 14, 40]]},
  ]
  for (const c of cases) {
    emitRoadDividers(c.decor, [], () => false, () => 150, c.origin, box, palette)
  }
  assert(boxes.length > 40, `expected rich divider boxes emitted, got ${boxes.length}`)
  for (const b of boxes) {
    // Check batch.ts isProceduralShopBox exclusions
    const shopMatch =
      (Math.abs(b.h - 0.12) < 0.015 && Math.abs(b.d - 1.1) < 0.08) ||
      (Math.abs(b.h - 0.53) < 0.02 && Math.abs(b.d - 0.12) < 0.02) ||
      (Math.abs(b.h - 2.32) < 0.05 && Math.abs(b.d - 0.06) < 0.015) ||
      (Math.abs(b.h - 0.035) < 0.008 && Math.abs(b.d - 0.03) < 0.008)
    assert.equal(shopMatch, false, `divider box collides with batch.ts shop filter: ${JSON.stringify(b)}`)
    // Check streets.ts train-warning uSlogan exclusion (0.08 x 0.55)
    const trainMatch = Math.abs(b.w - 0.08) < 0.001 && Math.abs(b.h - 0.55) < 0.001
    assert.equal(trainMatch, false, `divider box collides with train-warning slogan shader: ${JSON.stringify(b)}`)
  }
  // Verify sampleDividerSpanGrade embeds slopes cleanly
  const grade = sampleDividerSpanGrade(0, 0, 4, 0, x => 150 + x * 0.06)
  assert(grade.pitch > 0.05 && grade.embedDepth >= 0.05)

  // Verify redwood planters never pierce framed tree-pit centers on Zhongshan Middle Rd
  const zsBoxes = []
  emitRoadDividers(
    cases[1].decor,
    [],
    () => false,
    () => 150,
    cases[1].origin,
    (x, y, z, w, h, d, yaw, tint) => zsBoxes.push({x, y, z, w, h, d, yaw, hex: tint?.getHex?.()}),
    palette,
  )
  const treePits = zsBoxes.filter(b => Math.abs(b.w - 1.48) < 0.01 && Math.abs(b.d - 1.48) < 0.01)
  const redwoodWalls = zsBoxes.filter(b => b.hex === 0x6f4433)
  assert(treePits.length >= 1, 'expected at least 1 framed tree pit on Zhongshan verge chain')
  for (const pit of treePits) {
    for (const wall of redwoodWalls) {
      const dist = Math.hypot(wall.x - pit.x, wall.z - pit.z)
      assert(dist >= wall.w * 0.5 + 0.72, `redwood planter pierced tree pit: dist=${dist}, wallW=${wall.w}`)
    }
  }

  // Verify arterial central median suppresses overlapping narrow kind=4 collector soft bollards
  const narrowNearMedian = [4, [[1000, 2000], [3000, 2000], [3000, 2022], [1000, 2022]]]
  const medDecor = [[1, 150, 201, 0, 30], [1, 180, 201, 0, 30], [1, 210, 201, 0, 30], [1, 240, 201, 0, 30]]
  const medBoxes = []
  emitRoadDividers(
    medDecor,
    [narrowNearMedian],
    () => false,
    () => 150,
    [-768, -256],
    (x, y, z, w, h, d, yaw, tint) => medBoxes.push({hex: tint?.getHex?.()}),
    palette,
  )
  assert.equal(medBoxes.filter(b => b.hex === 0xd95626).length, 0, 'collector orange bollards must not leak onto arterial central median')
})
