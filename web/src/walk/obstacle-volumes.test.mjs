import test from 'node:test'
import assert from 'node:assert/strict'

import {
  JIEFANG_RAILING_VOLUME_ID,
  buildJiefangRailingObstacleVolume,
  buildTianyuanObstacleVolume,
  clampCameraToObstacleVolumes,
  createDefaultCityObstacleVolumes,
  expandVolumeToCuboids,
  isInsideShell,
  resolveObstacleVolumesStep,
  volumeLocalToWorld,
  withDefaultCityObstacleVolumes,
  worldToVolumeLocal,
} from './obstacle-volumes.ts'
import R from '@dimforge/rapier3d-compat'
import {
  JIEFANG_BRIDGE_ORIGIN,
  JIEFANG_BRIDGE_ROTATION_Y,
  JIEFANG_RAILING_TRACKS,
  jiefangDeckRoadLocalY,
} from '../traffic-duty/jiefang-railings.ts'

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

function makeBridgePos(lx, lz, aboveRoadY = 0.0) {
  const [wx, wz] = volumeLocalToWorld(lx, lz, JIEFANG_BRIDGE_ORIGIN, JIEFANG_BRIDGE_ROTATION_Y)
  const roadLocalY = jiefangDeckRoadLocalY(lx)
  return {
    x: wx,
    y: JIEFANG_BRIDGE_ORIGIN[1] + roadLocalY + aboveRoadY + FOOT_HEIGHT * 0.5,
    z: wz,
  }
}

test('Jiefang bridge railings volume continuously blocks walk/vehicles across full span while lowered ~1.1m top is jumpable & standable', async () => {
  const defaults = createDefaultCityObstacleVolumes()
  assert.equal(defaults.length, 1)
  assert.equal(defaults[0].id, JIEFANG_RAILING_VOLUME_ID)
  const merged = withDefaultCityObstacleVolumes([])
  assert.equal(merged.length, 1)
  assert.equal(withDefaultCityObstacleVolumes(merged).length, 1)

  const vol = buildJiefangRailingObstacleVolume()
  assert.equal(vol.shell, undefined)
  assert.ok(vol.boxes.length >= 40)

  const foot = { radius: FOOT_RADIUS, height: FOOT_HEIGHT }

  // Continuous closed railings across full [-140.5, +140.5] span (including former gaps -98, 0, 125) block walking and low hops
  for (const testX of [-138, -115, -98, -50, 0, 60, 125, 138]) {
    for (const track of JIEFANG_RAILING_TRACKS) {
      const railZ = track.z
      assert.ok(track.colliderHeight >= 1.0 && track.colliderHeight <= 1.2)
      let pos = makeBridgePos(testX, railZ - 1.2)
      let hits = 0
      for (let s = 0; s < 25; s++) {
        const [clx, clz] = worldToVolumeLocal(pos.x, pos.z, JIEFANG_BRIDGE_ORIGIN, JIEFANG_BRIDGE_ROTATION_Y)
        const next = makeBridgePos(clx, clz + 0.12)
        const res = resolveObstacleVolumesStep(pos, next, foot, [vol])
        if (res.blocked) hits++
        pos = next
      }
      const [, endLz] = worldToVolumeLocal(pos.x, pos.z, JIEFANG_BRIDGE_ORIGIN, JIEFANG_BRIDGE_ROTATION_Y)
      assert.ok(hits > 0, `railZ=${railZ} at lx=${testX} did not block walker`)
      assert.ok(endLz < railZ, `walker crossed continuous barrier railZ=${railZ} at lx=${testX}: endLz=${endLz}`)

      // Low hop (+0.55m) still blocks crossing
      const lowHop0 = makeBridgePos(testX, railZ - 0.9, 0.55)
      const lowHop1 = makeBridgePos(testX, railZ + 0.9, 0.55)
      assert.equal(resolveObstacleVolumesStep(lowHop0, lowHop1, foot, [vol]).blocked, true)

      // Full jump reaching top surface (>= colliderHeight) allows stepping onto and over the railing top
      const topY = track.colliderHeight
      const topStep0 = makeBridgePos(testX, railZ - 0.5, topY)
      const topStep1 = makeBridgePos(testX, railZ, topY)
      const topStep2 = makeBridgePos(testX, railZ + 0.5, topY)
      assert.equal(resolveObstacleVolumesStep(topStep0, topStep1, foot, [vol]).blocked, false, `failed stepping onto top of ${track.id} at lx=${testX}`)
      assert.equal(resolveObstacleVolumesStep(topStep1, topStep2, foot, [vol]).blocked, false, `failed stepping across top of ${track.id} at lx=${testX}`)
    }
  }

  // Real Rapier CharacterController + obstacle-volumes simulation: jump onto railing top, stand steadily, then cross to opposite lane
  await R.init()
  const world = new R.World({ x: 0, y: -20, z: 0 })
  const controller = world.createCharacterController(0.025)
  controller.setMaxSlopeClimbAngle((52 * Math.PI) / 180)
  controller.setMinSlopeSlideAngle((52 * Math.PI) / 180)
  controller.enableAutostep(0.62, 0.08, false)
  controller.enableSnapToGround(0.65)
  const shape = new R.Capsule(FOOT_HEIGHT / 2 - 0.29, 0.29)
  const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, 0))
  const capsule = world.createCollider(new R.ColliderDesc(shape), body)

  // Mount bridge road slab (top at roadY) + expanded railing cuboids matching physics.ts
  for (let x0 = -140; x0 < 140; x0 += 2) {
    const x1 = x0 + 2
    const ry = (jiefangDeckRoadLocalY(x0) + jiefangDeckRoadLocalY(x1)) * 0.5
    const [wx, wz] = volumeLocalToWorld((x0 + x1) * 0.5, 0, JIEFANG_BRIDGE_ORIGIN, JIEFANG_BRIDGE_ROTATION_Y)
    const hy = 0.25
    const halfYaw = JIEFANG_BRIDGE_ROTATION_Y * 0.5
    world.createCollider(
      R.ColliderDesc.cuboid(1.05, hy, 21.5)
        .setTranslation(wx, JIEFANG_BRIDGE_ORIGIN[1] + ry - hy, wz)
        .setRotation({ x: 0, y: Math.sin(halfYaw), z: 0, w: Math.cos(halfYaw) }),
    )
  }
  for (const c of expandVolumeToCuboids(vol)) {
    const halfYaw = c.yaw * 0.5
    world.createCollider(
      R.ColliderDesc.cuboid(c.hx, c.hy, c.hz)
        .setTranslation(c.x, c.y, c.z)
        .setRotation({ x: 0, y: Math.sin(halfYaw), z: 0, w: Math.cos(halfYaw) }),
    )
  }
  world.step()

  const stepDt = 1 / 60
  const jumpV0 = Math.sqrt(2 * 20 * 1.2) // walkConfig: gravity=-20, jump=1.2
  const runJumpDemo = (startLx, track) => {
    const roadY0 = JIEFANG_BRIDGE_ORIGIN[1] + jiefangDeckRoadLocalY(startLx)
    const [sx, sz] = volumeLocalToWorld(startLx, track.z - 0.85, JIEFANG_BRIDGE_ORIGIN, JIEFANG_BRIDGE_ROTATION_Y)
    let pos = { x: sx, y: roadY0 + FOOT_HEIGHT * 0.5 + 0.025, z: sz }
    body.setTranslation(pos, true)
    body.setNextKinematicTranslation(pos)
    world.step()

    // Phase 1: grounded walk forward hits railing (blocked before crossing track.z)
    for (let f = 0; f < 40; f++) {
      const fx = Math.sin(JIEFANG_BRIDGE_ROTATION_Y) * 1.65 * stepDt
      const fz = Math.cos(JIEFANG_BRIDGE_ROTATION_Y) * 1.65 * stepDt
      controller.computeColliderMovement(capsule, { x: fx, y: -28 * stepDt, z: fz })
      const m = controller.computedMovement()
      const next = { x: pos.x + m.x, y: pos.y + m.y, z: pos.z + m.z }
      resolveObstacleVolumesStep(pos, next, { radius: 0.315, height: FOOT_HEIGHT }, [vol])
      pos = next
      body.setNextKinematicTranslation(pos)
      world.step()
    }
    const [, blockedLz] = worldToVolumeLocal(pos.x, pos.z, JIEFANG_BRIDGE_ORIGIN, JIEFANG_BRIDGE_ROTATION_Y)
    assert.ok(blockedLz < track.z, `grounded walk crossed ${track.id} at lx=${startLx}: ${blockedLz}`)

    // Phase 2: jump up onto railing top and release input on arrival -> lands & stands stably on top!
    let vy = jumpV0
    let stoodFrames = 0
    for (let f = 0; f < 90; f++) {
      vy += (vy > 0 ? -20 : -28) * stepDt
      const [, curLz] = worldToVolumeLocal(pos.x, pos.z, JIEFANG_BRIDGE_ORIGIN, JIEFANG_BRIDGE_ROTATION_Y)
      const speedZ = curLz < track.z ? 1.65 : 0
      const desired = {
        x: Math.sin(JIEFANG_BRIDGE_ROTATION_Y) * speedZ * stepDt,
        y: vy * stepDt,
        z: Math.cos(JIEFANG_BRIDGE_ROTATION_Y) * speedZ * stepDt,
      }
      controller.computeColliderMovement(capsule, desired)
      const m = controller.computedMovement()
      const next = { x: pos.x + m.x, y: pos.y + m.y, z: pos.z + m.z }
      resolveObstacleVolumesStep(pos, next, { radius: 0.315, height: FOOT_HEIGHT }, [vol])
      if (vy <= 0 && controller.computedGrounded()) vy = 0
      pos = next
      body.setNextKinematicTranslation(pos)
      world.step()
      const [lxNow, lzNow] = worldToVolumeLocal(pos.x, pos.z, JIEFANG_BRIDGE_ORIGIN, JIEFANG_BRIDGE_ROTATION_Y)
      const footAboveDeck = pos.y - FOOT_HEIGHT * 0.5 - (JIEFANG_BRIDGE_ORIGIN[1] + jiefangDeckRoadLocalY(lxNow))
      if (controller.computedGrounded() && Math.abs(lzNow - track.z) <= 0.35 && footAboveDeck >= track.colliderHeight - 0.06) {
        stoodFrames++
      }
    }
    assert.ok(stoodFrames >= 10, `player failed to stand stably on top of ${track.id} at lx=${startLx}: stoodFrames=${stoodFrames}`)

    // Phase 3: continue walking off railing top onto opposite lane
    for (let f = 0; f < 50; f++) {
      vy = controller.computedGrounded() ? 0 : vy - 28 * stepDt
      const desired = {
        x: Math.sin(JIEFANG_BRIDGE_ROTATION_Y) * 1.65 * stepDt,
        y: (vy - 2) * stepDt,
        z: Math.cos(JIEFANG_BRIDGE_ROTATION_Y) * 1.65 * stepDt,
      }
      controller.computeColliderMovement(capsule, desired)
      const m = controller.computedMovement()
      const next = { x: pos.x + m.x, y: pos.y + m.y, z: pos.z + m.z }
      resolveObstacleVolumesStep(pos, next, { radius: 0.315, height: FOOT_HEIGHT }, [vol])
      pos = next
      body.setNextKinematicTranslation(pos)
      world.step()
    }
    const [, afterCrossLz] = worldToVolumeLocal(pos.x, pos.z, JIEFANG_BRIDGE_ORIGIN, JIEFANG_BRIDGE_ROTATION_Y)
    assert.ok(afterCrossLz > track.z + 0.45, `failed crossing over ${track.id} at lx=${startLx}: afterCrossLz=${afterCrossLz}`)
  }

  // Verify on flat deck (-50, -98) AND steepest east ramp (+80) across side & center median railings!
  for (const testX of [-98, -50, 80]) {
    for (const track of JIEFANG_RAILING_TRACKS) {
      runJumpDemo(testX, track)
    }
  }
  world.free()

  // Vehicles (ebike / car) cannot cross solid railing; continuous span blocks everywhere
  const scooter = { radius: 0.34, height: 1.55, halfWidth: 0.34, halfLength: 0.92, heading: 0 }
  for (const vx of [-98, -40, 60]) {
    const s0 = makeBridgePos(vx, 13.4, 0)
    const s1 = makeBridgePos(vx, 10.2, 0)
    const sRes = resolveObstacleVolumesStep(s0, s1, scooter, [vol])
    assert.equal(sRes.blocked, true, `scooter crossed gapless railing at lx=${vx}`)
    const [, sEndZ] = worldToVolumeLocal(s1.x, s1.z, JIEFANG_BRIDGE_ORIGIN, JIEFANG_BRIDGE_ROTATION_Y)
    assert.ok(sEndZ > 12.0, `scooter crossed south motor/nonmotor barrier at lx=${vx}: ${sEndZ}`)
  }

  // Under-bridge ground walker (well below deckY) must NOT be blocked by upper bridge deck railings
  const [ux, uz] = volumeLocalToWorld(-40, -12.6, JIEFANG_BRIDGE_ORIGIN, JIEFANG_BRIDGE_ROTATION_Y)
  const [tx, tz] = volumeLocalToWorld(-40, -11.4, JIEFANG_BRIDGE_ORIGIN, JIEFANG_BRIDGE_ROTATION_Y)
  const underRes = resolveObstacleVolumesStep(
    { x: ux, y: 147.2, z: uz },
    { x: tx, y: 147.2, z: tz },
    foot,
    [vol],
  )
  assert.equal(underRes.blocked, false)

  // Expanded Rapier cuboids keep zero overlaps with JIEFANG_OFFICER_SPOT (-266.2, 151.85, 26.2)
  const cuboids = expandVolumeToCuboids(vol)
  assert.equal(cuboids.length, vol.boxes.length)
  for (const c of cuboids) {
    const dCenter = Math.hypot(c.x - -266.2, c.z - 26.2)
    assert.ok(dCenter > 4.0, `cuboid ${c.label} too close to JIEFANG_OFFICER_SPOT (${dCenter}m)`)
  }
})
