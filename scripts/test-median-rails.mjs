import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import {emitVergeCurbWalls} from '../web/src/curb-returns.ts'
import {medianRails, sampleChainAt, traceDividerChains} from '../web/src/median-rails.ts'
import {
  emitOpeningEndCap,
  emitRoadDividers,
  emitSoftDelineatorPost,
  extractCollectorSoftDelineators,
  GUILIN_DIVIDER_CORRIDORS,
  matchDividerCorridor,
} from '../web/src/road-divider-profiles.ts'
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
  const vergeMid = cases[1].decor.filter(d => d[0] === 5)[1]
  const sampleBeds = [[vergeMid[1], vergeMid[2], vergeMid[3], 1]]
  emitRoadDividers(
    cases[1].decor,
    [],
    () => false,
    () => 150,
    cases[1].origin,
    (x, y, z, w, h, d, yaw, tint) => zsBoxes.push({x, y, z, w, h, d, yaw, hex: tint?.getHex?.()}),
    palette,
    sampleBeds,
  )
  const treePits = zsBoxes.filter(b => Math.abs(b.w - 1.66) < 0.01 && Math.abs(b.d - 1.66) < 0.01)
  const redwoodWalls = zsBoxes.filter(b => b.hex === 0x6f4433)
  assert(treePits.length >= 1, 'expected at least 1 framed tree pit on Zhongshan verge chain')
  for (const pit of treePits) {
    for (const wall of redwoodWalls) {
      const dist = Math.hypot(wall.x - pit.x, wall.z - pit.z)
      assert(dist >= wall.w * 0.5 + 0.85, `redwood planter pierced tree pit: dist=${dist}, wallW=${wall.w}`)
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

test('emitOpeningEndCap has strictly continuous vertical intervals (zero air gaps) and aligns with raised +0.195 rail top', () => {
  for (const style of ['rail', 'green', 'verge']) {
    for (const surfaceOff of [0.045, 0.195]) {
      const boxes = []
      emitOpeningEndCap(
        20, 20, 1, 0, 0,
        () => 150,
        (x, y, z, w, h, d, yaw, tint) => boxes.push({minY: y - h * 0.5, maxY: y + h * 0.5, w, h, d, hex: tint?.getHex?.()}),
        style, 1, surfaceOff,
      )
      assert(boxes.length >= 3, `expected >= 3 end-cap parts for style=${style}`)
      boxes.sort((a, b) => a.minY - b.minY)
      const surfaceY = 150 + surfaceOff
      assert(boxes[0].minY <= surfaceY && boxes[0].maxY >= surfaceY + 0.10, `base must embed into surface and rise >= 10 cm above ${surfaceY}`)
      let coveredMaxY = boxes[0].maxY
      for (let i = 1; i < boxes.length; i++) {
        assert(
          boxes[i].minY <= coveredMaxY - 0.005,
          `vertical air gap detected in style=${style} surfaceOff=${surfaceOff}: part ${i} minY=${boxes[i].minY} > prev maxY=${coveredMaxY}`,
        )
        coveredMaxY = Math.max(coveredMaxY, boxes[i].maxY)
      }
      if (style === 'rail') {
        // Top cap must reach/align with top rail (surfaceY + 0.9225)
        assert(coveredMaxY >= surfaceY + 0.92 && coveredMaxY <= surfaceY + 0.98, `rail end-cap top ${coveredMaxY} misaligned with rail top ${surfaceY + 0.9225}`)
      }
    }
  }
})

test('emitMedianMetalRailChain keeps cast-iron plinths visible above +0.195 medians with zero plinth-post gap', () => {
  const raisedMedianPath = [4, [[1000, 1940], [2600, 1940], [2600, 2060], [1000, 2060]]] // raised kind=4 band y=+0.195 covering x=[10..26], z=[19.4..20.6]
  // Chain starts at tile border (x=0.1 -> plain border post) and spans raised median up to open end at x=22
  const decor = [
    [1, 16, 200, 0, 30],
    [1, 115, 200, 0, 30],
    [1, 145, 200, 0, 30],
    [1, 175, 200, 0, 30],
    [1, 205, 200, 0, 30],
  ]
  const boxes = []
  const pal = {
    railing: new THREE.Color(0xd9d5ca),
    stoneLight: new THREE.Color(0xa6a39a),
    stoneMid: new THREE.Color(0x8c8981),
    bannerRed: new THREE.Color(0xc23b33),
    hedge: new THREE.Color(0x486544),
    iron: new THREE.Color(0x42624e),
  }
  emitRoadDividers(
    decor,
    [raisedMedianPath],
    () => false,
    () => 150,
    [-768, -256], // Jiefang East Rd -> median_metal_rail
    (x, y, z, w, h, d, yaw, tint) => boxes.push({x, y, z, minY: y - h * 0.5, maxY: y + h * 0.5, w, h, d, hex: tint?.getHex?.()}),
    pal,
  )
  const plinths = boxes.filter(b => b.hex === 0x3a4044)
  const whitePosts = boxes.filter(b => b.hex === 0xe4e3dd && b.w < 0.1 && b.h > 0.7)
  assert(plinths.length >= 4, `expected plinths on intermediate & border posts, got ${plinths.length}`)
  assert(whitePosts.length >= 3, `expected white rail posts, got ${whitePosts.length}`)
  for (const post of whitePosts) {
    const matchPlinth = plinths.find(p => Math.hypot(p.x - post.x, p.z - post.z) < 0.05)
    assert.ok(matchPlinth, `white post at (${post.x.toFixed(2)}, ${post.z.toFixed(2)}) missing cast-iron plinth`)
    const onRaised = post.x >= 10 && post.x <= 26
    const surfY = 150 + (onRaised ? 0.195 : 0.045)
    assert(matchPlinth.maxY >= surfY + 0.10, `plinth top ${matchPlinth.maxY} buried below surface ${surfY}`)
    assert(post.minY <= matchPlinth.maxY - 0.01, `air gap between plinth top ${matchPlinth.maxY} and post bottom ${post.minY}`)
  }
})

test('emitSoftDelineatorPost exposes black rubber base above +0.195 collector kind=4 verges with zero base-post gap', () => {
  const boxes = []
  emitSoftDelineatorPost(
    15, 20, 0,
    () => 150,
    (x, y, z, w, h, d, yaw, tint) => boxes.push({minY: y - h * 0.5, maxY: y + h * 0.5, w, h, d, hex: tint?.getHex?.()}),
    0.195,
  )
  const rubberBase = boxes.find(b => b.hex === 0x2c3034)
  const orangePost = boxes.find(b => b.hex === 0xd95626)
  assert.ok(rubberBase && orangePost, 'expected rubber base and orange post')
  const vergeTopY = 150.195
  assert(rubberBase.minY <= vergeTopY && rubberBase.maxY >= vergeTopY + 0.07, `rubber base [${rubberBase.minY}, ${rubberBase.maxY}] buried under +0.195 top`)
  assert(orangePost.minY <= rubberBase.maxY - 0.01, `gap between rubber base top ${rubberBase.maxY} and orange post bottom ${orangePost.minY}`)
})

test('emitRoadDividers clears native GL04 tree beds across tree_planter, metal_guardrail, hedge_curb & median_green_trees', () => {
  const pal = {
    railing: new THREE.Color(0xd9d5ca),
    stoneLight: new THREE.Color(0xa6a39a),
    stoneMid: new THREE.Color(0x8c8981),
    bannerRed: new THREE.Color(0xc23b33),
    hedge: new THREE.Color(0x486544),
    iron: new THREE.Color(0x42624e),
  }

  // 1) Zhongshan Middle Rd north (tree_planter): native beds at s=6m and s=14m -> redwood planters cut cleanly, 0 duplicate fake trees!
  const zsOrigin = [-1024, -512]
  const zsH = Math.round(Math.atan2(234, -47) * 100)
  const dx = Math.cos(zsH / 100), dz = Math.sin(zsH / 100)
  const zsDecor = []
  for (let i = 0; i < 6; i++) {
    const lx = 170 + dx * (i * 4 + 2)
    const lz = 180 + dz * (i * 4 + 2)
    zsDecor.push([5, Math.round(lx * 10), Math.round(lz * 10), zsH, 40])
  }
  const zsBeds = [
    [Math.round((170 + dx * 6) * 10), Math.round((180 + dz * 6) * 10), zsH, 1],
    [Math.round((170 + dx * 14) * 10), Math.round((180 + dz * 14) * 10), zsH, 1],
  ]
  const zsBoxes = []
  emitRoadDividers(
    zsDecor, [], () => false, () => 150, zsOrigin,
    (x, y, z, w, h, d, yaw, tint) => zsBoxes.push({x, y, z, w, h, d, hex: tint?.getHex?.()}),
    pal, zsBeds,
  )
  // Zero synthetic whitewashed trunks (0xdcd9cf) should spawn where native beds exist every 8 m
  const fakeTrunks = zsBoxes.filter(b => b.hex === 0xdcd9cf)
  assert.equal(fakeTrunks.length, 0, `must not duplicate fake trees on native bed stations, got ${fakeTrunks.length}`)
  // Redwood planters must stay completely clear of both native bed coordinates
  const redwood = zsBoxes.filter(b => b.hex === 0x6f4433)
  assert(redwood.length >= 2, 'expected redwood planters in clear bays between native trees')
  for (const bed of zsBeds) {
    const bx = bed[0] / 10, bz = bed[1] / 10
    for (const wall of redwood) {
      const dist = Math.hypot(wall.x - bx, wall.z - bz)
      assert(dist >= wall.w * 0.5 + 0.72, `redwood planter pierced native tree bed (${bx},${bz}): dist=${dist}, wallW=${wall.w}`)
    }
  }

  // 2) Jiefang East Rd (metal_guardrail): guardrail offset to motor-lane edge (-0.86 m) clears centerline native tree beds (even 1.2x banyans)
  const jfOrigin = [-768, -256]
  const jfH = Math.round(Math.atan2(75, 290) * 100)
  const jdx = Math.cos(jfH / 100), jdz = Math.sin(jfH / 100)
  const jfDecor = []
  for (let i = 0; i < 4; i++) {
    jfDecor.push([5, Math.round((200 + jdx * (i * 4 + 2)) * 10), Math.round((180 + jdz * (i * 4 + 2)) * 10), jfH, 40])
  }
  const jfBed = [[Math.round((200 + jdx * 8) * 10), Math.round((180 + jdz * 8) * 10), jfH, 1]]
  const jfBoxes = []
  emitRoadDividers(
    jfDecor, [], () => false, () => 150, jfOrigin,
    (x, y, z, w, h, d, yaw, tint) => jfBoxes.push({x, y, z, w, h, d, hex: tint?.getHex?.()}),
    pal, jfBed,
  )
  const bx = jfBed[0][0] / 10, bz = jfBed[0][1] / 10
  for (const b of jfBoxes) {
    // Check lateral distance from rail beam/post centerline to tree trunk centerline >= 0.72 m
    const angle = -jfH / 100
    const nx = Math.sin(angle), nz = Math.cos(angle)
    const lat = Math.abs((b.x - bx) * nx + (b.z - bz) * nz)
    assert(lat >= 0.72, `Jiefang metal guardrail pierced centerline native tree bed: lat=${lat.toFixed(3)}m`)
  }

  // 3) Lijiang Rd verge (hedge_curb): BOTH hedge AND motor-side dark-iron fence break cleanly around every native bed (0 fence-through-trunk)
  const ljOrigin = [256, 1792]
  const ljVergeDecor = []
  for (let i = 0; i < 6; i++) ljVergeDecor.push([5, 1600 + i * 40, 1047, 0, 40])
  const ljVergeBeds = [
    [1680, 1047, 0, 1],
    [1760, 1047, 0, 1],
  ]
  const ljVergeBoxes = []
  emitRoadDividers(
    ljVergeDecor, [], () => false, () => 150, ljOrigin,
    (x, y, z, w, h, d, yaw, tint) => ljVergeBoxes.push({x, y, z, w, h, d, hex: tint?.getHex?.()}),
    pal, ljVergeBeds,
  )
  const ironRails = ljVergeBoxes.filter(b => b.hex === pal.iron.getHex() && b.h < 0.1)
  const vergeHedges = ljVergeBoxes.filter(b => b.hex === 0x2f532e && b.h > 0.35)
  assert(ironRails.length >= 2, `expected segmented iron garden fence bays around native trees, got ${ironRails.length}`)
  for (const bed of ljVergeBeds) {
    const tbx = bed[0] / 10
    for (const ir of ironRails) {
      assert(Math.abs(ir.x - tbx) >= ir.w * 0.5 + 0.85, `Lijiang iron fence pierced native tree trunk at x=${tbx}: rail (${ir.x}, w=${ir.w})`)
    }
    for (const hg of vergeHedges) {
      assert(Math.abs(hg.x - tbx) >= hg.w * 0.5 + 0.85, `Lijiang verge hedge pierced native tree trunk at x=${tbx}: hedge (${hg.x}, w=${hg.w})`)
    }
  }

  // 4) Lijiang Rd central green trees: geodesic polyhedral crape-myrtle trees (0 boxy cube crowns) + hedge cutouts around tree wells
  const ljMedDecor = []
  for (let i = 0; i < 6; i++) ljMedDecor.push([1, 1000 + i * 30, 1130, 0, 30])
  const ljBoxes = []
  const ljTris = []
  emitRoadDividers(
    ljMedDecor, [], () => false, () => 150, ljOrigin,
    (x, y, z, w, h, d, yaw, tint) => ljBoxes.push({x, y, z, w, h, d, hex: tint?.getHex?.()}),
    pal, [],
    (ax, ay, az, bx0, by0, bz0, cx, cy, cz, r, g, b) => ljTris.push({ax, ay, az, bx0, by0, bz0, cx, cy, cz, r, g, b}),
  )
  // Must emit genuine geodesic polyhedral triangles (>= 400 tris per tree) and ZERO boxy canopy cubes above y0 + 1.5 m
  assert(ljTris.length >= 400, `expected geodesic polyhedral crape-myrtle triangles (>=400), got ${ljTris.length}`)
  const boxyCanopies = ljBoxes.filter(b => b.y > 151.5)
  assert.equal(boxyCanopies.length, 0, `must not emit boxy cube canopy blocks when emitTri is provided, got ${boxyCanopies.length}`)
  const medWells = ljBoxes.filter(b => b.hex === 0x4e4437)
  const medHedges = ljBoxes.filter(b => b.hex === 0x2f532e && b.h < 0.5 && b.d > 0.55)
  assert(medWells.length >= 1, 'expected dedicated soil tree well on Lijiang median')
  for (const well of medWells) {
    for (const hg of medHedges) {
      assert(Math.abs(hg.x - well.x) >= hg.w * 0.5 + 0.45, `Lijiang median hedge pierced tree well: dx=${Math.abs(hg.x - well.x)}, w=${hg.w}`)
    }
  }
})

test('every corridor in GUILIN_DIVIDER_CORRIDORS is reachable (no shadowed dead-code corridors)', () => {
  for (const c of GUILIN_DIVIDER_CORRIDORS) {
    const midIdx = Math.floor((c.polyline.length - 1) / 2)
    const [ax, az] = c.polyline[midIdx]
    const [bx, bz] = c.polyline[midIdx + 1]
    const mx = (ax + bx) * 0.5, mz = (az + bz) * 0.5
    const heading = Math.atan2(bz - az, bx - ax)
    const matched = matchDividerCorridor(mx, mz, heading)
    assert.equal(matched?.id, c.id, `corridor ${c.id} shadowed at midpoint (${mx},${mz}) by ${matched?.id}`)
  }
})
