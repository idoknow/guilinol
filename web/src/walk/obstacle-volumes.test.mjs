import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildTianyuanObstacleVolume,
  clampCameraToObstacleVolumes,
  expandVolumeToCuboids,
  isInsideShell,
  resolveObstacleVolumesStep,
  volumeLocalToWorld,
  worldToVolumeLocal,
} from './obstacle-volumes.ts'

const SITE_ORIGIN = [-1139.2, 156.1, -55.5]
const SITE_ROT = 2.83616 - Math.PI
const FOOT_HEIGHT = 1.7
const FOOT_RADIUS = 0.315

function makePos(lx, lz, footOffsetY = 0.04) {
  const [wx, wz] = volumeLocalToWorld(lx, lz, SITE_ORIGIN, SITE_ROT)
  return { x: wx, y: SITE_ORIGIN[1] + footOffsetY + FOOT_HEIGHT * 0.5, z: wz }
}

function pushRepeatedly(volume, startLx, startLz, dirLx, dirLz, steps, stepLen, actor, footOffsetY = 0.04) {
  let pos = makePos(startLx, startLz, footOffsetY)
  let hitCount = 0
  const len = Math.hypot(dirLx, dirLz) || 1
  const ux = dirLx / len
  const uz = dirLz / len
  for (let i = 0; i < steps; i++) {
    const [curLx, curLz] = worldToVolumeLocal(pos.x, pos.z, SITE_ORIGIN, SITE_ROT)
    const next = makePos(curLx + ux * stepLen, curLz + uz * stepLen, footOffsetY)
    const res = resolveObstacleVolumesStep(pos, next, actor, [volume])
    if (res.blocked) hitCount++
    pos = next
  }
  const [endLx, endLz] = worldToVolumeLocal(pos.x, pos.z, SITE_ORIGIN, SITE_ROT)
  return { endLx, endLz, hitCount, inside: isInsideShell(endLx, endLz, volume.shell) }
}

function walkWaypoints(volume, waypoints, actor = { radius: FOOT_RADIUS, height: FOOT_HEIGHT }) {
  let pos = makePos(waypoints[0][0], waypoints[0][1], 0.04)
  for (let w = 1; w < waypoints.length; w++) {
    const [tx, tz] = waypoints[w]
    for (let step = 0; step < 120; step++) {
      const [cx, cz] = worldToVolumeLocal(pos.x, pos.z, SITE_ORIGIN, SITE_ROT)
      const dx = tx - cx
      const dz = tz - cz
      const dist = Math.hypot(dx, dz)
      if (dist <= 0.06) break
      const move = Math.min(dist, 0.08)
      const next = makePos(cx + (dx / dist) * move, cz + (dz / dist) * move, 0.04)
      resolveObstacleVolumesStep(pos, next, actor, [volume])
      pos = next
    }
  }
  const [endLx, endLz] = worldToVolumeLocal(pos.x, pos.z, SITE_ORIGIN, SITE_ROT)
  return { endLx, endLz }
}

test('worldToVolumeLocal and volumeLocalToWorld are exact inverses', () => {
  for (const [lx, lz] of [[0, 0], [1.1, 7.1], [-2.5, 6.2], [-3.2, -6.9], [3.1, 1.5]]) {
    const [wx, wz] = volumeLocalToWorld(lx, lz, SITE_ORIGIN, SITE_ROT)
    const [rx, rz] = worldToVolumeLocal(wx, wz, SITE_ORIGIN, SITE_ROT)
    assert.ok(Math.abs(rx - lx) < 1e-9)
    assert.ok(Math.abs(rz - lz) < 1e-9)
  }
})

test('expandVolumeToCuboids generates wall, fixture, ceiling, and 12 curved-arc cuboids across Lv1-Lv3', () => {
  const lv1 = expandVolumeToCuboids(buildTianyuanObstacleVolume(SITE_ORIGIN, SITE_ROT, 1))
  const lv2 = expandVolumeToCuboids(buildTianyuanObstacleVolume(SITE_ORIGIN, SITE_ROT, 2))
  const lv3 = expandVolumeToCuboids(buildTianyuanObstacleVolume(SITE_ORIGIN, SITE_ROT, 3))
  assert.equal(lv1.filter(c => c.label.startsWith('glass:corner-arc-')).length, 12)
  assert.equal(lv1.filter(c => c.label === 'shell:ceiling').length, 1)
  assert.ok(lv2.length > lv1.length)
  assert.ok(lv3.length > lv2.length)
  for (const c of lv3) {
    assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z))
    assert.ok(c.hx > 0 && c.hy > 0 && c.hz > 0)
  }
})

test('all 3 levels (Lv1/Lv2/Lv3) block walk, sprint, diagonal slide, and jump against every wall/glass/arc from inside', () => {
  const foot = { radius: FOOT_RADIUS, height: FOOT_HEIGHT }
  for (const lv of [1, 2, 3]) {
    const vol = buildTianyuanObstacleVolume(SITE_ORIGIN, SITE_ROT, lv)
    const cases = [
      ['west-hall', -1.5, 2.5, -1, 0],
      ['west-hall-diag', -1.5, 2.5, -0.8, 0.6],
      ['west-kitchen', -1.5, -2.5, -1, 0],
      ['east-hall', 1.5, 4.0, 1, 0],
      ['east-hall-diag', 1.5, 4.0, 0.8, 0.6],
      ['east-kitchen', 1.5, -2.0, 1, 0],
      ['back-kitchen', 0.0, -5.8, 0, -1],
      ['front-west-glass', -0.4, 6.2, 0, 1],
      ['front-east-glass', 2.2, 5.5, 0, 1],
      ['front-east-diag', 2.2, 5.5, 0.6, 1],
      ['arc-0.25', -1.4, 5.0, -Math.sin(0.25), Math.cos(0.25)],
      ['arc-0.78', -1.4, 5.0, -Math.sin(0.78), Math.cos(0.78)],
      ['arc-1.30', -1.4, 5.0, -Math.sin(1.30), Math.cos(1.30)],
    ]
    for (const [name, sx, sz, dx, dz] of cases) {
      for (const [stepLen, jumpY] of [[0.04, 0.04], [0.15, 0.04], [0.15, 1.24]]) {
        const r = pushRepeatedly(vol, sx, sz, dx, dz, 80, stepLen, foot, jumpY)
        assert.equal(r.inside, true, `Lv${lv} ${name} escaped (step=${stepLen}, y=${jumpY}): end=(${r.endLx},${r.endLz})`)
        assert.ok(r.hitCount > 0, `Lv${lv} ${name} should register collision`)
      }
    }
  }
})

test('all 3 levels block outside-in pushes against every non-doorway exterior wall, glass, and curved arc', () => {
  const foot = { radius: FOOT_RADIUS, height: FOOT_HEIGHT }
  for (const lv of [1, 2, 3]) {
    const vol = buildTianyuanObstacleVolume(SITE_ORIGIN, SITE_ROT, lv)
    const outsideCases = [
      ['out-west', -5.2, 2.0, 1, 0],
      ['out-east', 5.0, 2.0, -1, 0],
      ['out-back', 0.0, -8.8, 0, 1],
      ['out-front-west-glass', -0.4, 8.8, 0, -1],
      ['out-front-east-glass', 2.3, 8.8, 0, -1],
      ['out-nw-arc', -4.2, 7.8, 0.707, -0.707],
    ]
    for (const [name, sx, sz, dx, dz] of outsideCases) {
      for (const jumpY of [0.04, 1.24]) {
        const r = pushRepeatedly(vol, sx, sz, dx, dz, 80, 0.15, foot, jumpY)
        assert.equal(r.inside, false, `Lv${lv} ${name} clipped inside (y=${jumpY}): end=(${r.endLx},${r.endLz})`)
        assert.ok(r.hitCount > 0)
      }
    }
  }
})

test('expansion rebuild (Lv1 -> Lv2 -> Lv3) keeps all walls solid and keeps player inside', () => {
  const foot = { radius: FOOT_RADIUS, height: FOOT_HEIGHT }
  const volumes = new Map()
  for (const lv of [1, 2, 3]) {
    const rebuilt = buildTianyuanObstacleVolume(SITE_ORIGIN, SITE_ROT, lv)
    volumes.set(rebuilt.id, rebuilt)

    // Verify wall containment immediately after rebuild
    const wallTest = pushRepeatedly(volumes.get(rebuilt.id), -1.4, 5.0, -0.707, 0.707, 60, 0.15, foot, 1.24)
    assert.equal(wallTest.inside, true, `Lv${lv} post-rebuild arc wall failed`)

    // Verify player standing where Lv2/Lv3 table spawns gets pushed safely INSIDE shop, never outside
    const pos = makePos(-0.6, 5.45, 0.04)
    const next = makePos(-0.6, 5.45, 0.04)
    resolveObstacleVolumesStep(pos, next, foot, volumes.values())
    const [lx, lz] = worldToVolumeLocal(next.x, next.z, SITE_ORIGIN, SITE_ROT)
    assert.equal(isInsideShell(lx, lz, rebuilt.shell), true, `Lv${lv} rebuild pushed player outside`)
  }
})

test('front doorway, kitchen doorway, and all 3 cooking stations (boil, meat, counter) are reachable across Lv1-Lv3', () => {
  const foot = { radius: FOOT_RADIUS, height: FOOT_HEIGHT }
  const STATIONS = {
    boil: [1.75, -2.35],
    meat: [-1.75, -2.8],
    counter: [1.95, 0.72],
  }

  for (const lv of [1, 2, 3]) {
    const vol = buildTianyuanObstacleVolume(SITE_ORIGIN, SITE_ROT, lv)

    // Walk in from outside sidewalk -> front doorway -> front hall -> kitchen doorway -> boil -> meat -> kitchen doorway -> counter -> front doorway -> outside
    const toBoil = walkWaypoints(vol, [
      [1.1, 8.8],
      [1.1, 6.2],
      [1.1, 2.5],
      [-1.0, 2.5],
      [-1.0, 0.8],
      [-1.0, -1.6],
      [1.75, -1.6],
      STATIONS.boil,
    ], foot)
    assert.ok(
      Math.hypot(toBoil.endLx - STATIONS.boil[0], toBoil.endLz - STATIONS.boil[1]) < 0.15,
      `Lv${lv} boil station unreachable: end=(${toBoil.endLx},${toBoil.endLz})`,
    )

    const toMeat = walkWaypoints(vol, [
      STATIONS.boil,
      [1.75, -1.6],
      [-1.75, -1.6],
      STATIONS.meat,
    ], foot)
    assert.ok(
      Math.hypot(toMeat.endLx - STATIONS.meat[0], toMeat.endLz - STATIONS.meat[1]) < 0.15,
      `Lv${lv} meat station unreachable: end=(${toMeat.endLx},${toMeat.endLz})`,
    )

    const toCounter = walkWaypoints(vol, [
      STATIONS.meat,
      [-1.0, -1.6],
      [-1.0, 0.72],
      STATIONS.counter,
    ], foot)
    assert.ok(
      Math.hypot(toCounter.endLx - STATIONS.counter[0], toCounter.endLz - STATIONS.counter[1]) < 0.15,
      `Lv${lv} counter station unreachable: end=(${toCounter.endLx},${toCounter.endLz})`,
    )

    // Walk back out through front doorway
    const backOut = walkWaypoints(vol, [
      STATIONS.counter,
      [-1.0, 0.72],
      [-1.0, 2.5],
      [1.1, 2.5],
      [1.1, 8.8],
    ], foot)
    assert.equal(isInsideShell(backOut.endLx, backOut.endLz, vol.shell), false, `Lv${lv} failed exiting front doorway`)
    assert.ok(backOut.endLz > 8.4)
  }
})

test('partition wall (outside kitchen doorway) and front counter block walking and jumping', () => {
  const vol = buildTianyuanObstacleVolume(SITE_ORIGIN, SITE_ROT, 3)
  const foot = { radius: FOOT_RADIUS, height: FOOT_HEIGHT }

  for (const jumpY of [0.04, 1.24]) {
    const r = pushRepeatedly(vol, 1.5, 2.4, 0, -1, 40, 0.12, foot, jumpY)
    assert.ok(r.endLz >= 1.85 + FOOT_RADIUS - 0.02, `clipped through front counter at y=${jumpY}: endLz=${r.endLz}`)
    assert.ok(r.hitCount > 0)
  }

  for (const jumpY of [0.04, 1.24]) {
    const r = pushRepeatedly(vol, 1.2, 0.72, 0, -1, 40, 0.12, foot, jumpY)
    assert.ok(r.endLz >= 0.15 + FOOT_RADIUS - 0.02, `clipped through partition wall at y=${jumpY}: endLz=${r.endLz}`)
    assert.ok(r.hitCount > 0)
  }
})

test('high-speed car and bike cannot penetrate walls, glass, curved corner, or counter from outside or inside', () => {
  const vol = buildTianyuanObstacleVolume(SITE_ORIGIN, SITE_ROT, 3)
  const car = { radius: 0.86, height: FOOT_HEIGHT, halfWidth: 0.86, halfLength: 2.12, heading: SITE_ROT }
  const bike = { radius: 0.34, height: FOOT_HEIGHT, halfWidth: 0.34, halfLength: 0.82, heading: SITE_ROT }

  // Car cannot enter doorway, glass, side walls, or arc
  for (const [sx, sz, dx, dz] of [[1.1, 11.5, 0, -1], [-4.5, 8.5, 1, -1], [6.0, 2.0, -1, 0], [-6.5, 2.0, 1, 0]]) {
    const r = pushRepeatedly(vol, sx, sz, dx, dz, 30, 0.5, car, 0.04)
    assert.equal(r.inside, false, `car penetrated shop from (${sx},${sz}): end=(${r.endLx},${r.endLz})`)
    assert.ok(r.hitCount > 0)
  }

  // Bike cannot penetrate front glass, arc, or escape walls from inside
  for (const [sx, sz, dx, dz] of [[-0.5, 10.5, 0, -1], [2.4, 10.5, 0, -1], [-4.5, 8.2, 0.707, -0.707]]) {
    const r = pushRepeatedly(vol, sx, sz, dx, dz, 30, 0.33, bike, 0.04)
    assert.equal(r.inside, false, `bike penetrated shop from (${sx},${sz}): end=(${r.endLx},${r.endLz})`)
    assert.ok(r.hitCount > 0)
  }
  const bikeFromInside = pushRepeatedly(vol, 0.5, 4.0, 1, 0, 40, 0.33, bike, 0.04)
  assert.equal(bikeFromInside.inside, true)
  assert.ok(bikeFromInside.hitCount > 0)
})

test('indoor camera clamp prevents camera from poking outside exterior walls, curved arc, or ceiling', () => {
  const vol = buildTianyuanObstacleVolume(SITE_ORIGIN, SITE_ROT, 3)
  const [px, pz] = volumeLocalToWorld(-2.5, 5.8, SITE_ORIGIN, SITE_ROT)
  const playerPos = { x: px, y: SITE_ORIGIN[1] + 0.04, z: pz }

  // Camera pushed outside NW curved arc + above ceiling
  const [cx, cz] = volumeLocalToWorld(-4.8, 7.6, SITE_ORIGIN, SITE_ROT)
  const camPos = { x: cx, y: SITE_ORIGIN[1] + 4.5, z: cz }
  const clamped = clampCameraToObstacleVolumes(playerPos, camPos, 0.22, [vol])
  assert.equal(clamped, true)
  const [outLx, outLz] = worldToVolumeLocal(camPos.x, camPos.z, SITE_ORIGIN, SITE_ROT)
  const outLy = camPos.y - SITE_ORIGIN[1]
  assert.equal(isInsideShell(outLx, outLz, vol.shell), true, `camera still outside shell: (${outLx},${outLz})`)
  assert.ok(outLy <= 3.2 - 0.16 + 1e-6, `camera poked through ceiling: y=${outLy}`)
  assert.ok(Math.hypot(outLx + 1.4, outLz - 5.0) <= 2.1 - 0.04 - 0.22 + 1e-3, 'camera clipped NW curved arc')

  // Player outside storefront: camera must NOT be pulled inside shop
  const [opx, opz] = volumeLocalToWorld(1.1, 8.9, SITE_ORIGIN, SITE_ROT)
  const [ocx, ocz] = volumeLocalToWorld(1.1, 14.0, SITE_ORIGIN, SITE_ROT)
  const outCam = { x: ocx, y: SITE_ORIGIN[1] + 3.0, z: ocz }
  assert.equal(clampCameraToObstacleVolumes({ x: opx, y: SITE_ORIGIN[1], z: opz }, outCam, 0.22, [vol]), false)
})
