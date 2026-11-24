import assert from 'node:assert/strict'
import test from 'node:test'
import {buildRoadBarriers, ROAD_BARRIER_STRIDE} from '../web/src/road-barriers.ts'

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
