import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'

import {MAIN_DETAIL_LAYER} from '../look/mirror-layer.ts'
import {
  JIEFANG_BRIDGE_DECK_BOUNDS,
  JIEFANG_CROSS_SECTION,
  JIEFANG_LANE_CENTERLINES,
  JIEFANG_RAILING_GAP_RANGES,
  JIEFANG_RAILING_MAX_X,
  JIEFANG_RAILING_MIN_X,
  JIEFANG_RAILING_SPAN_RANGES,
  JIEFANG_RAILING_TRACKS,
  buildJiefangRailingObstacleVolume,
  classifyJiefangCrossSectionZ,
  createJiefangRailingsVisual,
  evaluateJiefangDutyInteractionZone,
  isLocalXInJiefangRailingGap,
  isOnJiefangBridgeDeck,
  jiefangBridgeLocalToWorld,
  jiefangDeckRoadLocalY,
  jiefangDeckWorldY,
  worldToJiefangBridgeLocal,
} from './jiefang-railings.ts'

test('JIEFANG_CROSS_SECTION strictly separates non-overlapping sidewalk, nonmotor, motor & median bands', () => {
  const {bands} = JIEFANG_CROSS_SECTION
  assert.equal(bands.length, 11)
  assert.equal(bands[0].minZ, JIEFANG_CROSS_SECTION.minZ)
  assert.equal(bands[bands.length - 1].maxZ, JIEFANG_CROSS_SECTION.maxZ)

  for (let i = 0; i < bands.length; i++) {
    const b = bands[i]
    assert.ok(b.minZ < b.maxZ, `band ${b.id} must have minZ < maxZ`)
    assert.ok(Math.abs((b.maxZ - b.minZ) - b.widthM) < 1e-4, `band ${b.id} widthM mismatch`)
    if (i > 0) {
      assert.equal(bands[i - 1].maxZ, b.minZ, `adjacent bands ${bands[i - 1].id} and ${b.id} must meet without overlap or gap`)
    }
  }

  // Sidewalk, nonmotor & motor bands must have strictly positive pairwise separation (no boundary equality/overlap)
  const trafficBands = [
    JIEFANG_CROSS_SECTION.northSidewalk,
    JIEFANG_CROSS_SECTION.northNonmotor,
    JIEFANG_CROSS_SECTION.northMotor,
    JIEFANG_CROSS_SECTION.southMotor,
    JIEFANG_CROSS_SECTION.southNonmotor,
    JIEFANG_CROSS_SECTION.southSidewalk,
  ]
  for (let i = 1; i < trafficBands.length; i++) {
    assert.ok(
      trafficBands[i - 1].maxZ < trafficBands[i].minZ,
      `${trafficBands[i - 1].id} overlaps/touches ${trafficBands[i].id}`,
    )
  }

  // Validate role classification & nonmotor vs light-gray sidewalk distinction (tactile -16.93 is on sidewalk, not nonmotor!)
  assert.equal(classifyJiefangCrossSectionZ(-18.9), 'sidewalk')
  assert.equal(classifyJiefangCrossSectionZ(-16.93), 'sidewalk')
  assert.equal(classifyJiefangCrossSectionZ(-14.06), 'nonmotor')
  assert.equal(classifyJiefangCrossSectionZ(-12.0), 'railing')
  assert.equal(classifyJiefangCrossSectionZ(-6.0), 'motor')
  assert.equal(classifyJiefangCrossSectionZ(0.0), 'median')
  assert.equal(classifyJiefangCrossSectionZ(6.0), 'motor')
  assert.equal(classifyJiefangCrossSectionZ(12.0), 'railing')
  assert.equal(classifyJiefangCrossSectionZ(14.06), 'nonmotor')
  assert.equal(classifyJiefangCrossSectionZ(16.93), 'sidewalk')
  assert.equal(classifyJiefangCrossSectionZ(22.5), 'outside')

  // Lane centerlines fall cleanly inside their matching cross-section band
  assert.equal(JIEFANG_LANE_CENTERLINES.length, 8)
  for (const lane of JIEFANG_LANE_CENTERLINES) {
    assert.equal(classifyJiefangCrossSectionZ(lane.localZ), lane.kind)
  }
})

test('Jiefang railings 3D builder emits 3 continuous gap-free tracks (1.0~1.2m height), instanced mainDetail meshes & zero dynamic lights', () => {
  const vis = createJiefangRailingsVisual()
  assert.equal(vis.trackCount, 3)
  assert.equal(vis.spanCount, 1)
  assert.equal(vis.gapCount, 0)
  assert.equal(JIEFANG_RAILING_GAP_RANGES.length, 0)
  assert.equal(JIEFANG_RAILING_SPAN_RANGES.length, 1)
  assert.equal(JIEFANG_RAILING_MIN_X, JIEFANG_BRIDGE_DECK_BOUNDS.minX)
  assert.equal(JIEFANG_RAILING_MAX_X, JIEFANG_BRIDGE_DECK_BOUNDS.maxX)
  assert.equal(JIEFANG_RAILING_SPAN_RANGES[0].minX, -140.5)
  assert.equal(JIEFANG_RAILING_SPAN_RANGES[0].maxX, 140.5)
  assert.equal(vis.dynamicLightCount, 0)
  assert.equal(JIEFANG_RAILING_TRACKS.map((t) => t.z).join(','), '-12,0,12')

  for (const track of JIEFANG_RAILING_TRACKS) {
    assert.ok(
      track.colliderHeight >= 1.0 && track.colliderHeight <= 1.2,
      `${track.id} colliderHeight=${track.colliderHeight} must be within [1.0, 1.2]m`,
    )
  }

  for (const probeX of [-140, -115, -98, -50, 0, 60, 125, 140]) {
    assert.equal(isLocalXInJiefangRailingGap(probeX), false)
  }

  // Collider boxes form continuous gap-free runs from -140.5 to +140.5 on all 3 tracks and standable top matches 1.0~1.2m
  const vol = buildJiefangRailingObstacleVolume()
  for (const track of JIEFANG_RAILING_TRACKS) {
    const tBoxes = vol.boxes.filter((b) => b.label?.startsWith(`${track.id}:`)).sort((a, b) => a.minX - b.minX)
    assert.ok(tBoxes.length >= 20)
    assert.equal(tBoxes[0].minX, -140.5)
    assert.equal(tBoxes[tBoxes.length - 1].maxX, 140.5)
    for (let i = 0; i < tBoxes.length; i++) {
      const b = tBoxes[i]
      assert.equal(b.standOnTop, true)
      if (i > 0) {
        assert.ok(Math.abs(tBoxes[i - 1].maxX - b.minX) < 1e-6, `gap detected on ${track.id} at ${b.minX}`)
      }
      const midX = (b.minX + b.maxX) * 0.5
      const hMid = (b.maxY ?? 0) - jiefangDeckRoadLocalY(midX)
      const hStart = (b.maxY ?? 0) - jiefangDeckRoadLocalY(b.minX)
      const hEnd = (b.maxY ?? 0) - jiefangDeckRoadLocalY(b.maxX)
      assert.ok(hMid >= 1.0 && hMid <= 1.2, `${track.id} mid height ${hMid} out of [1.0, 1.2]`)
      assert.ok(Math.min(hStart, hEnd) >= 1.0 && Math.max(hStart, hEnd) <= 1.2, `${track.id} endpoint heights [${hStart}, ${hEnd}] out of [1.0, 1.2]`)
    }
  }

  let lightCount = 0
  let instancedCount = 0
  let totalNodes = 0
  const layerMaskExpected = 1 << MAIN_DETAIL_LAYER

  vis.group.traverse((obj) => {
    totalNodes++
    if ('isLight' in obj && obj.isLight) lightCount++
    if ('isInstancedMesh' in obj && obj.isInstancedMesh) instancedCount++
    assert.equal(obj.layers.mask, layerMaskExpected, `${obj.name} must reside on MAIN_DETAIL_LAYER=${MAIN_DETAIL_LAYER}`)
  })

  assert.equal(lightCount, 0, 'railings group must contain zero dynamic lights')
  assert.equal(instancedCount, 6)
  assert.ok(totalNodes >= 7)
  assert.ok(vis.instanceCounts.posts > 300)
  assert.ok(vis.instanceCounts.pickets > 1800)

  // Verify bridge deck slope climbs toward east approach ramp [16..111]
  assert.ok(jiefangDeckRoadLocalY(105) > jiefangDeckRoadLocalY(0) + 1.0)
  assert.ok(jiefangDeckRoadLocalY(-98) > jiefangDeckRoadLocalY(0) + 0.3)

  vis.dispose()
})

test('Jiefang bridge duty interaction scope allows bridge deck (incl. officer spot) and blocks off-bridge/underpass', () => {
  // Officer station world coords from npc-officer.ts: (-266.2, 151.85, 26.2)
  const officerPos = {x: -266.2, y: 151.85, z: 26.2}
  const [officerLx, officerLz] = worldToJiefangBridgeLocal(officerPos.x, officerPos.z)
  assert.ok(officerLx >= -101 && officerLx <= -95, `officer lx=${officerLx} should stay at west bridgehead`)
  assert.ok(officerLz > 16.175 && officerLz < JIEFANG_BRIDGE_DECK_BOUNDS.maxZ)

  const officerStatus = evaluateJiefangDutyInteractionZone(officerPos)
  assert.equal(officerStatus.onBridge, true)
  assert.equal(officerStatus.canInteract, true)
  assert.equal(officerStatus.distanceOutsideM, 0)
  assert.ok(officerStatus.statusText.includes('正在值班'))

  // Midspan roadway
  const [mx, mz] = jiefangBridgeLocalToWorld(0, 5.0)
  assert.equal(isOnJiefangBridgeDeck({x: mx, y: jiefangDeckWorldY(mx, mz), z: mz}), true)

  // Under bridge (same x/z but ground elevation 146.5m) -> blocked!
  const underStatus = evaluateJiefangDutyInteractionZone({x: mx, y: 146.5, z: mz})
  assert.equal(underStatus.onBridge, false)
  assert.equal(underStatus.canInteract, false)
  assert.ok(underStatus.distanceOutsideM > 3.0)
  assert.ok(underStatus.statusText.includes('正在值班'))

  // Beyond east approach head (lx = +155) -> blocked!
  const [ex, ez] = jiefangBridgeLocalToWorld(155, 4.0)
  const offEast = evaluateJiefangDutyInteractionZone({x: ex, y: jiefangDeckWorldY(ex, ez), z: ez})
  assert.equal(offEast.onBridge, false)
  assert.equal(offEast.canInteract, false)
  assert.ok(offEast.distanceOutsideM > 14.0)

  // Outside parapet width (lz = 24.0) -> blocked!
  const [sx, sz] = jiefangBridgeLocalToWorld(10, 24.0)
  assert.equal(isOnJiefangBridgeDeck({x: sx, y: jiefangDeckWorldY(sx, sz), z: sz}), false)
})
