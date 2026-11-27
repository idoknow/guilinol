import assert from 'node:assert/strict'
import test from 'node:test'
import {buildRoadBarriers, resolveRoadBarrierSpec, ROAD_BARRIER_STRIDE} from '../web/src/road-barriers.ts'
import {
  DECOR_KIND_MEDIAN_GREEN_TREES,
  DECOR_KIND_VERGE_METAL_RAIL,
  DECOR_KIND_VERGE_SOFT_DELINEATOR,
  DECOR_KIND_VERGE_TREE_PLANTER,
  isZhongshanLandmarkMedianSuppressed,
  resolveMedianDividerKind,
  resolveVergeDividerKind,
} from '../web/src/road-divider-profiles.ts'

const flat = () => 150

function unpack(arr) {
  const out = []
  for (let i = 0; i < arr.length; i += ROAD_BARRIER_STRIDE) {
    out.push({
      cx: arr[i],
      cy: arr[i + 1],
      cz: arr[i + 2],
      hx: arr[i + 3],
      hy: arr[i + 4],
      hz: arr[i + 5],
      yaw: arr[i + 6],
    })
  }
  return out
}

test('includes blocking kinds 1/2/5/6/7/8 and excludes non-blocking kinds 3/4/9/10/11', () => {
  const decor = [
    [1, 100, 100, 0, 30],
    [2, 200, 200, 0, 30],
    [3, 300, 300, 0, 0],
    [4, 400, 400, 0, 0],
    [5, 500, 500, 0, 40],
    [6, 600, 600, 0, 40],
    [7, 700, 700, 0, 30],
    [8, 800, 800, 0, 28],
    [9, 900, 900, 0, 28],
    [10, 1000, 1000, 0, 31],
    [11, 1100, 1100, 0, 0],
  ]
  const boxes = unpack(buildRoadBarriers(decor, flat))
  assert.equal(boxes.length, 6)
  // kind 1/2 top > 150.195 + 0.62 (defeats walkConfig.step autostep) and overlaps carOverlap [foot+0.34, foot+1.30]
  for (const b of boxes) {
    const bottom = b.cy - b.hy
    const top = b.cy + b.hy
    assert(bottom <= 149.95, `bottom should embed below road: ${bottom}`)
    assert(top >= 151.05, `top should defeat walk autostep (0.62m above +0.195): ${top}`)
    assert(top <= 151.5, `top should stay below camera eye focus on flat ground: ${top}`)
  }
  // kind 5 shifts +0.065 in local Z (heading=0 -> yaw=0 -> +Z), kind 6 shifts -0.065 in local Z
  assert(Math.abs(boxes[2].cz - 50.065) < 1e-4, `kind=5 Z offset mismatch: ${boxes[2].cz}`)
  assert(Math.abs(boxes[3].cz - 59.935) < 1e-4, `kind=6 Z offset mismatch: ${boxes[3].cz}`)
})

test('merges collinear kind 1 and kind 2 median segments while preserving crosswalk gaps', () => {
  // 5 contiguous 3m segments (including a kind=2 banner in the middle) + 3.5m crosswalk gap + 2 contiguous 3m segments
  const decor = [
    [1, 15, 100, 0, 30],
    [1, 45, 100, 0, 30],
    [2, 75, 100, 0, 30],
    [1, 105, 100, 0, 30],
    [1, 135, 100, 0, 30],
    // 3.5m gap from x=15.0 to x=18.5
    [1, 200, 100, 0, 30],
    [1, 230, 100, 0, 30],
  ]
  const boxes = unpack(buildRoadBarriers(decor, flat))
  assert.equal(boxes.length, 2, `expected 2 merged runs across gap, got ${boxes.length}`)
  assert(Math.abs(boxes[0].cx - 7.5) < 1e-3 && Math.abs(boxes[0].hx - 7.5) < 1e-3)
  assert(Math.abs(boxes[1].cx - 21.5) < 1e-3 && Math.abs(boxes[1].hx - 3.0) < 1e-3)
  // Gap [15.0, 18.5] must remain completely open
  assert(boxes[0].cx + boxes[0].hx <= 15.01)
  assert(boxes[1].cx - boxes[1].hx >= 18.49)
})

test('handles angle wrap-around near +/- PI/2 and splits on grade changes', () => {
  // Near vertical heading (+1.57 rad and -1.57 rad are collinear!)
  const decor = [
    [1, 100, 15, 157, 30],
    [1, 100, 45, -157, 30],
  ]
  const boxes = unpack(buildRoadBarriers(decor, flat))
  assert.equal(boxes.length, 1, 'opposite/wrapped half-circle collinear segments should merge')
  assert(Math.abs(boxes[0].hx - 3.0) < 0.05)

  // Steep slope (>0.14m elevation change across adjacent segments) must not over-merge into floating boxes
  const sloped = [
    [1, 15, 100, 0, 30],
    [1, 45, 100, 0, 30],
    [1, 75, 100, 0, 30],
    [1, 105, 100, 0, 30],
  ]
  const slopedBoxes = unpack(buildRoadBarriers(sloped, x => 150 + x * 0.08))
  assert(slopedBoxes.length >= 3, `expected sloped run to split for terrain hug, got ${slopedBoxes.length}`)
})

test('never merges different barrier groups (e.g. kind 5 vs kind 6) or small real openings (>= 0.35m)', () => {
  const decor = [
    [5, 15, 100, 0, 40],
    [5, 59, 100, 0, 40], // center delta = 4.4m, each halfL = 2.02 -> gap = 0.36m > MAX_MERGE_GAP (0.18m)
  ]
  const boxes = unpack(buildRoadBarriers(decor, flat))
  assert.equal(boxes.length, 2, '0.36m cutout gap must remain unbridged')
})

test('resolves Guilin road divider profiles per corridor and updates barrier volumes accordingly', () => {
  // Jiefang East Rd (near Jiefang Bridge): central metal rail + white-grey metal verge guardrail
  const jfHeading = Math.atan2(75, 290)
  assert.equal(resolveMedianDividerKind(-544.3, -83.3, 1, jfHeading), 'median_metal_rail')
  assert.equal(resolveVergeDividerKind(-544.1, -71.9, 5, jfHeading), 'metal_guardrail')
  const jfMedSpec = resolveRoadBarrierSpec(1, -544.3, -83.3, jfHeading)
  const jfVergeSpec = resolveRoadBarrierSpec(5, -544.1, -71.9, jfHeading)
  assert.equal(jfMedSpec?.hz, 0.08)
  assert.equal(jfVergeSpec?.hz, 0.90)

  // Zhongshan Middle Rd north of Shizijie: central crape-myrtle green trees + roadside tree-pit planters
  const zsHeading = Math.atan2(234, -47)
  assert.equal(resolveMedianDividerKind(-838.8, -321.0, 1, zsHeading), 'median_green_trees')
  assert.equal(resolveVergeDividerKind(-854.3, -320.4, 5, zsHeading), 'tree_planter')
  const zsMedSpec = resolveRoadBarrierSpec(1, -838.8, -321.0, zsHeading)
  const zsVergeSpec = resolveRoadBarrierSpec(5, -854.3, -320.4, zsHeading)
  assert.equal(zsMedSpec?.hz, 0.37)
  assert.equal(zsVergeSpec?.hz, 0.56)

  // Lijiang Rd & Huancheng North 2nd Rd: central green trees + hedge_curb verge
  assert.equal(resolveMedianDividerKind(350, 1905, 1, 0), 'median_green_trees')
  assert.equal(resolveVergeDividerKind(350, 1896, 5, 0), 'hedge_curb')
  const ljVergeSpec = resolveRoadBarrierSpec(5, 350, 1896, 0)
  assert.equal(ljVergeSpec?.hz, 0.76)
})

test('narrow old-town streets emit zero rigid barrier walls (soft_delineator) and respect tangent alignment at junctions', () => {
  // Narrow old-town branch (Xinyi / Liumashan Rd): soft_delineator -> no rigid wall collider
  const xyHeading = Math.atan2(60, 35)
  assert.equal(resolveVergeDividerKind(-1718, -625, 5, xyHeading), 'soft_delineator')
  assert.equal(resolveRoadBarrierSpec(5, -1718, -625, xyHeading), null)

  // Adjacent Jiefang West Rd arterial verge (-1000, -208) must NOT be hijacked by narrow-branch rules
  const jfWestHeading = -2.96
  assert.equal(resolveVergeDividerKind(-1000, -208, 5, jfWestHeading), 'metal_guardrail')
  assert.equal(resolveRoadBarrierSpec(5, -1000, -208, jfWestHeading)?.hz, 0.90)

  // Forward-compatible explicit decor kinds 12..15
  assert.equal(resolveRoadBarrierSpec(DECOR_KIND_MEDIAN_GREEN_TREES)?.hz, 0.37)
  assert.equal(resolveRoadBarrierSpec(DECOR_KIND_VERGE_METAL_RAIL)?.hz, 0.52)
  assert.equal(resolveRoadBarrierSpec(DECOR_KIND_VERGE_TREE_PLANTER)?.hz, 0.56)
  assert.equal(resolveRoadBarrierSpec(DECOR_KIND_VERGE_SOFT_DELINEATOR), null)

  // Orthogonal cross street near Zhongshan Rd must not falsely inherit Zhongshan's profile
  const eastWestHeading = 0 // perpendicular to N-S Zhongshan Rd
  assert.equal(resolveMedianDividerKind(-838.8, -321.0, 1, eastWestHeading), 'median_metal_rail')

  // Hand-modeled zhongshan_road.glb central median suppression only triggers inside [-74, 296] along centerline
  assert.equal(isZhongshanLandmarkMedianSuppressed(-955, 76, 1), true)
  assert.equal(isZhongshanLandmarkMedianSuppressed(-838.8, -321.0, 1), false)
  assert.equal(isZhongshanLandmarkMedianSuppressed(-955, 76, 5), false)
})

test('buildRoadBarriers with real chunk origin upgrades Zhongshan median to green-width collider while keeping gaps open', () => {
  const origin = [-1024, -512]
  // Local coords inside (-1024, -512) matching Zhongshan Middle Rd north (-838.8, -321.0)
  const lx = Math.round((-838.8 - origin[0]) * 10)
  const lz = Math.round((-321.0 - origin[1]) * 10)
  const h = Math.round(Math.atan2(234, -47) * 100)
  const decor = [
    [1, lx, lz, h, 30],
    [1, lx - 6, lz + 29, h, 30],
    // 5m crosswalk gap
    [1, lx - 22, lz + 106, h, 30],
  ]
  const boxes = unpack(buildRoadBarriers(decor, flat, origin))
  assert.equal(boxes.length, 2, 'crosswalk gap on Zhongshan green median must stay open')
  assert(Math.abs(boxes[0].hz - 0.37) < 1e-4, `expected green median hz=0.37, got ${boxes[0].hz}`)
})
