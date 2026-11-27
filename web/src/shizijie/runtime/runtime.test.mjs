import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'

import {
  SZJ_BUDGET,
  SZJ_CONTRACT_VERSION,
  SZJ_FRAME,
  SZJ_PLAYER,
  SZJ_STAIRWELLS,
  SZJ_STAIR_IDS,
  SZJ_TRANSITIONS,
  canTransition,
  getStairwell,
  indoorToWorld,
  layoutNpcCount,
  mountLazyShizijie,
  stairLocalToIndoor,
  validateSzjLayout,
  yawFacing,
} from '../index.ts'
import { SHIZIJIE_B1_LAYOUT } from '../layout/index.ts'
import { buildSzjWayfinding, followSigns } from '../wayfinding/index.ts'
import {
  buildContractDerivedSzjLayout,
  buildSzjCollisionWorld,
  createSzjIndoorScene,
  createSzjIndoorSceneContent,
  createSzjRuntimeStateMachine,
  resolveSzjIndoorMovement,
} from './index.ts'
import { runHeadlessFourMouthVerification } from './verify-headless.mjs'
import { SZJ_B1_CEILING_H, SZJ_LANDING, SZJ_ORIGIN, SZJ_STAIR, SZJ_WELLS, szjGroundStairwells } from '../frame.ts'
import { SZJ_STAIR_DOOR, szjDoorCentre } from '../look/stairwell-geometry.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test('k4: runtime, entry.ts, and index.ts contain zero coordinate literals outside contract.ts', () => {
  assert.equal(SZJ_CONTRACT_VERSION, 1)

  const filesToScan = [
    path.join(__dirname, '..', 'entry.ts'),
    path.join(__dirname, '..', 'index.ts'),
    ...fs
      .readdirSync(__dirname)
      .filter(f => f.endsWith('.ts'))
      .map(f => path.join(__dirname, f)),
  ]

  // Banned world/local stairwell coordinate literals from contract.ts / shizijie_underpass.py
  const bannedCoordRegex =
    /(?:-879\.75|-169\.62|151\.3\b|-22\.5\b|-38\.8\b|43\.0\b|-23\.0\b|22\.5\b|46\.5\b|-46\.2\b|21\.5\b|-158\.0\b|-131\.2\b|-902\.25|-208\.42|-836\.75|-192\.62|-857\.25|-123\.12|-925\.95|-148\.12)/
  // Banned hardcoded { x: <num>, z: <num> } object coordinate literals
  const bannedObjectCoordRegex = /\{\s*x\s*:\s*-?\d+(?:\.\d+)?\s*,\s*z\s*:\s*-?\d+(?:\.\d+)?\s*\}/

  for (const filePath of filesToScan) {
    const src = fs.readFileSync(filePath, 'utf8')
    const rel = path.relative(path.join(__dirname, '..'), filePath)
    assert.equal(
      bannedCoordRegex.test(src),
      false,
      `${rel} must not contain hardcoded world/stairwell coordinate literals`,
    )
    assert.equal(
      bannedObjectCoordRegex.test(src),
      false,
      `${rel} must not contain { x: number, z: number } coordinate literals`,
    )
  }

  // Both SHIZIJIE_B1_LAYOUT and fallback layout pass validateSzjLayout with 0 errors
  assert.deepEqual(validateSzjLayout(SHIZIJIE_B1_LAYOUT), [])
  const fallback = buildContractDerivedSzjLayout()
  assert.deepEqual(validateSzjLayout(fallback), [])
  assert.ok(fallback.shops.length >= 24 && fallback.shops.length <= 36)
  assert.ok(layoutNpcCount(fallback) <= SZJ_BUDGET.npcMax)
})

test('state machine enforces SZJ_TRANSITIONS, surface walk-in trigger, and exit cooldown hysteresis', () => {
  const states = Object.keys(SZJ_TRANSITIONS)
  for (const from of states) {
    for (const to of states) {
      const m = createSzjRuntimeStateMachine(SZJ_STAIRWELLS, 1500)
      if (from === 'idle') m.transitionTo('idle')
      else if (from === 'entering') {
        m.transitionTo('idle')
        m.transitionTo('entering')
      } else if (from === 'inside') {
        m.transitionTo('idle')
        m.transitionTo('entering')
        m.transitionTo('inside')
      } else if (from === 'exiting') {
        m.transitionTo('idle')
        m.transitionTo('entering')
        m.transitionTo('inside')
        m.transitionTo('exiting')
      } else if (from === 'disposed') {
        m.dispose()
      }
      assert.equal(m.getState(), from)
      const allowed = canTransition(from, to) || (from === to && (to === 'idle' || to === 'disposed'))
      assert.equal(m.transitionTo(to), allowed, `transition ${from} -> ${to}`)
    }
  }

  const sm = createSzjRuntimeStateMachine(SZJ_STAIRWELLS, 1500)
  sm.transitionTo('idle')
  const ne = getStairwell('ne')
  const insideMouthWorld = indoorToWorld(
    stairLocalToIndoor(ne, { x: 0, z: -ne.length * 0.5 + 0.3 }),
  )

  // Moving outward does NOT trigger entry
  const outRes = sm.detectSurfaceEntry(
    { x: insideMouthWorld.x, y: ne.groundY, z: insideMouthWorld.z },
    { x: -ne.inward.x, z: -ne.inward.z },
    1000,
  )
  assert.equal(outRes.triggeredStair, null)

  // Moving inward triggers entry
  const inRes = sm.detectSurfaceEntry(
    { x: insideMouthWorld.x, y: ne.groundY, z: insideMouthWorld.z },
    { x: ne.inward.x, z: ne.inward.z },
    1000,
  )
  assert.equal(inRes.triggeredStair?.id, 'ne')

  // Cooldown blocks immediate re-trigger until 1500ms elapses
  sm.markStairExitCooldown('ne', 2000, 1500)
  const coolBlocked = sm.detectSurfaceEntry(
    { x: insideMouthWorld.x, y: ne.groundY, z: insideMouthWorld.z },
    { x: ne.inward.x, z: ne.inward.z },
    3000,
  )
  assert.equal(coolBlocked.triggeredStair, null)

  const coolExpired = sm.detectSurfaceEntry(
    { x: insideMouthWorld.x, y: ne.groundY, z: insideMouthWorld.z },
    { x: ne.inward.x, z: ne.inward.z },
    3600,
  )
  assert.equal(coolExpired.triggeredStair?.id, 'ne')
})

test('k5 & k6: headless 4-mouth walk down the street ramp swaps into B1 and back with no camera jump, Δy <= 0.08m, 0 black frames, drawCalls <= 60, tris <= 200k', async () => {
  const report = await runHeadlessFourMouthVerification({ outDir: '/tmp/szj-headless-verify' })
  assert.equal(report.ok, true, `Headless failures: ${report.failures.join('; ')}`)
  assert.deepEqual(report.summary.mouthsVerified, ['nw', 'ne', 'se', 'sw'])
  assert.ok(report.summary.maxPerFrameEyeDyM <= SZJ_BUDGET.eyeDyPerFrameMax)
  assert.equal(report.summary.totalBlackFrames, 0)
  assert.ok(report.summary.maxLandingErrorM < SZJ_BUDGET.landingErrorMax)
  assert.ok(report.summary.indoorDrawCalls <= SZJ_BUDGET.indoorDrawCallsMax)
  assert.ok(report.summary.indoorDrawCalls > 0)
  assert.ok(report.summary.indoorTriangles <= SZJ_BUDGET.indoorTrianglesMax)
  assert.ok(report.summary.indoorTriangles > 1000)
  assert.ok(report.summary.indoorTextureBytes <= SZJ_BUDGET.indoorTextureBytesMax)
  assert.ok(report.summary.npcCount > 0 && report.summary.npcCount <= SZJ_BUDGET.npcMax)
  assert.equal(report.summary.worldCameraPreserved, true)
  assert.equal(report.summary.zeroLeaksAfterDispose, true)
})

test('indoor collision confines elevated stairwells, blocks corridor walls without tunneling, and enters shop bays', () => {
  const world = buildSzjCollisionWorld(SHIZIJIE_B1_LAYOUT, SZJ_PLAYER.radius, SZJ_PLAYER.eyeHeight)
  const nw = getStairwell('nw')

  // Mid-stair lateral push of 10m cannot fall off the side of the stairwell
  const midStair = stairLocalToIndoor(nw, { x: 0, z: 0 })
  const sideX = Math.cos(nw.yaw) * 10
  const sideZ = -Math.sin(nw.yaw) * 10
  const clampedStair = resolveSzjIndoorMovement(
    world,
    SHIZIJIE_B1_LAYOUT,
    midStair.x,
    midStair.z,
    SZJ_FRAME.depth * 0.5,
    sideX,
    sideZ,
  )
  assert.equal(clampedStair.hitWall, true)
  assert.equal(clampedStair.activeStair?.id, 'nw')
  assert.ok(clampedStair.footY > 1.0, 'remains elevated on stairwell rather than dropping to y=0')

  // Large 25m dash from B1 concourse stays strictly inside layout bounds
  const foot = nw.footIndoor
  const dashed = resolveSzjIndoorMovement(world, SHIZIJIE_B1_LAYOUT, foot.x, foot.z, 0, 25, -25)
  assert.equal(dashed.hitWall, true)
  assert.ok(
    dashed.x >= SHIZIJIE_B1_LAYOUT.bounds.minX &&
      dashed.x <= SHIZIJIE_B1_LAYOUT.bounds.maxX &&
      dashed.z >= SHIZIJIE_B1_LAYOUT.bounds.minZ &&
      dashed.z <= SHIZIJIE_B1_LAYOUT.bounds.maxZ,
  )

  // Every shop interior center is reachable
  const sampleShop = SHIZIJIE_B1_LAYOUT.shops[0]
  const insideShop = resolveSzjIndoorMovement(
    world,
    SHIZIJIE_B1_LAYOUT,
    sampleShop.rect.x,
    sampleShop.rect.z,
    0,
    0,
    0,
  )
  assert.equal(insideShop.activeShopId, sampleShop.id)
})

test('scene content disposes every geometry, material, texture, and crowd pool cleanly', () => {
  const handle = createSzjIndoorSceneContent(SHIZIJIE_B1_LAYOUT)
  assert.ok(handle.meshCount <= SZJ_BUDGET.indoorDrawCallsMax)
  assert.ok(handle.triangleCount <= SZJ_BUDGET.indoorTrianglesMax)
  assert.ok(handle.textureBytes <= SZJ_BUDGET.indoorTextureBytesMax)
  assert.ok(handle.npcCount > 0 && handle.npcCount <= SZJ_BUDGET.npcMax)

  let disposedGeoms = 0
  handle.scene.traverse(obj => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.addEventListener('dispose', () => {
        disposedGeoms += 1
      })
    }
  })

  handle.dispose()
  handle.dispose()
  assert.equal(handle.isDisposed(), true)
  assert.ok(disposedGeoms >= 15)
})

test('mountLazyShizijie exposes clean read-only probe and szj-ui.css obeys theme token rules', async () => {
  const cssText = fs.readFileSync(path.join(__dirname, 'szj-ui.css'), 'utf8')
  assert.equal(/提示|Tip|小贴士|linear-gradient|[!！]|[\p{Emoji_Presentation}]/u.test(cssText), false)
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(cssText), false)
  assert.match(cssText, /body\[data-szj-active="1"\]\s+\.gl-mission-entry/)
  assert.match(cssText, /body\[data-szj-active="1"\]\s+\.gl-mission-hud/)
  assert.match(cssText, /body\[data-szj-active="1"\]\s+\.hud-me/)
  assert.match(cssText, /body\[data-szj-active="1"\]\s+\.sky-ui/)
  assert.match(cssText, /body\[data-szj-active="1"\]\s+\.render-entry/)
  assert.match(cssText, /body\[data-szj-active="1"\]\s+\.dock/)

  const worldCamera = new THREE.PerspectiveCamera(55, 16 / 9, 1, 2000)
  const renderer = {
    info: { render: { calls: 0 }, reset() {} },
    render() {
      this.info.render.calls = 22
    },
  }
  const lazy = mountLazyShizijie(
    {
      renderer,
      worldCamera,
      bodyFlag: 'szjActive',
      getWalker: () => ({
        position: { x: SZJ_FRAME.originWorld.x, y: SZJ_FRAME.surfaceY, z: SZJ_FRAME.originWorld.z },
        velocity: { x: 0, z: 0 },
      }),
      suspendWorld() {},
      resumeWorldAt: async () => true,
    },
  )

  const probeKeys = Object.keys(lazy.getProbe())
  for (const banned of ['forceEnter', 'forceExit', 'teleportIndoor', 'grantFunds', 'skipTransition', 'debugScene']) {
    assert.equal(probeKeys.includes(banned), false)
  }

  assert.equal(await lazy.enter('sw'), true)
  assert.equal(lazy.isIndoor(), true)
  assert.equal(lazy.render(), true)
  const probeState = lazy.getProbe().getState()
  const playerYaw = probeState.player?.yaw ?? 0
  assert.ok(Math.abs(yawFacing(getStairwell('sw').inward) - playerYaw) < 1e-4)
  assert.ok((probeState.signs?.inWorldSignCount ?? 0) > 0)
  assert.equal(probeState.signs?.inWorldSignCount, probeState.signs?.wayfindingSignCount)
  assert.equal(probeState.signs?.wallWayfindingPlaqueCount, 0)
  lazy.dispose()
  assert.equal(lazy.isIndoor(), false)
})

test('k11 & k12: ceiling-hung wayfinding signs match wayfinding output 1:1, >=1 sign in view at all 4 entrances, 0 old wall plaques, and atmos+PBR within drawCall/tri/swap budgets', async () => {
  const wf = buildSzjWayfinding(SHIZIJIE_B1_LAYOUT)
  const content = createSzjIndoorSceneContent(SHIZIJIE_B1_LAYOUT)
  try {
    // 1) In-world sign count strictly equals wayfinding output, with twin suspension rods & 2 faces per sign
    assert.equal(content.wayfindingBatch.signCount, wf.signs.length)
    assert.equal(content.wayfindingBatch.boxMesh.count, wf.signs.length)
    assert.equal(content.wayfindingBatch.rodMesh.count, wf.signs.length * 2)
    assert.equal(content.getHangingSigns().length, wf.signs.length)

    // 2) Zero old wall-plaque wayfinding signs remain; green safety-exit plaques are preserved
    assert.equal(content.wallWayfindingPlaqueCount, 0)
    assert.equal(content.safetyExitPlaqueCount, SZJ_STAIRWELLS.length * 2)
    const meshNames = []
    content.scene.traverse(obj => {
      if (obj instanceof THREE.Mesh) meshNames.push(obj.name)
    })
    assert.ok(meshNames.includes('szj-wayfinding-boxes'))
    assert.ok(meshNames.includes('szj-wayfinding-rods'))
    assert.ok(meshNames.includes('szj-wayfinding-faces'))
    assert.ok(meshNames.includes('szj-safety-exit-plaques'))
    assert.ok(meshNames.includes('szj-atmos-baffles'))
    assert.ok(meshNames.includes('szj-atmos-linear-lamps'))

    // 3) Every in-scene hanging sign passes followSigns to all 4 exits
    for (const sg of content.getHangingSigns()) {
      for (const exitId of SZJ_STAIR_IDS) {
        const res = followSigns(content.wayfinding, { chainId: sg.chainId, offset: sg.chainOffset }, exitId)
        assert.equal(res.ok, true, `${sg.id} -> ${exitId} failed: ${res.reason}`)
      }
    }

    // 4) Budget checks (k11 + atmos k9 + look k6)
    assert.ok(content.meshCount <= SZJ_BUDGET.indoorDrawCallsMax, `drawCalls ${content.meshCount} > 60`)
    assert.ok(content.triangleCount <= SZJ_BUDGET.indoorTrianglesMax, `tris ${content.triangleCount} > 200k`)
    assert.ok(content.textureBytes <= SZJ_BUDGET.indoorTextureBytesMax, `texBytes ${content.textureBytes} > 8MiB`)
    const atmosMetrics = content.atmos.getMetrics()
    assert.ok(atmosMetrics.drawCalls <= 12 && atmosMetrics.drawCalls > 0)
    assert.ok(atmosMetrics.triangles <= 40000 && atmosMetrics.triangles > 0)
  } finally {
    content.dispose()
    assert.equal(content.atmos.isDisposed(), true)
  }

  // 5) Headless 4-entrance verification: swapMs <= 300ms and >= 1 sign in view after entering each entrance
  const report = await runHeadlessFourMouthVerification({ outDir: '/tmp/szj-headless-k12' })
  assert.equal(report.ok, true, `Headless k11/k12 failures: ${report.failures.join('; ')}`)
  assert.equal(report.summary.inWorldSignCount, wf.signs.length)
  assert.equal(report.summary.wallWayfindingPlaqueCount, 0)
  for (const m of report.mouths) {
    assert.ok(m.metrics.drawCalls <= SZJ_BUDGET.indoorDrawCallsMax)
    assert.ok(m.metrics.triangles <= SZJ_BUDGET.indoorTrianglesMax)
    assert.ok(m.metrics.lastSwapMs <= SZJ_BUDGET.swapMsMax)
    assert.ok(m.footVisibleSignCount >= 1, `${m.stairId} expected >=1 sign in view, got ${m.footVisibleSignCount}`)
  }
})

test('frame.ts well rows mirror the contract and pipeline STAIRWELLS, and the host ramp ends on the B1 landing', () => {
  assert.equal(SZJ_ORIGIN.x, SZJ_FRAME.originWorld.x)
  assert.equal(SZJ_ORIGIN.z, SZJ_FRAME.originWorld.z)
  assert.equal(SZJ_B1_CEILING_H, SHIZIJIE_B1_LAYOUT.ceilingHeight)
  const py = fs.readFileSync(path.join(__dirname, '../../../../pipeline/shizijie_underpass.py'), 'utf8')
  assert.deepEqual(SZJ_WELLS.map(w => w.id), [...SZJ_STAIR_IDS])
  for (const w of SZJ_WELLS) {
    const st = getStairwell(w.id)
    assert.deepEqual([st.indoor.x, st.indoor.z, st.yawDeg, st.width, st.length], [w.x, w.z, w.yawDeg, w.width, w.length])
    assert.equal(st.groundY, w.grade)
    const row = py.slice(py.indexOf(`'shizijie_stair_${w.id}'`)).slice(0, 400)
    assert.match(row, new RegExp(`'shizijie': \\(${w.x.toFixed(1)}, ${w.z.toFixed(1)}\\)`), `${w.id} centre`)
    assert.match(row, new RegExp(`'yawDeg': ${w.yawDeg.toFixed(1)},`), `${w.id} yaw`)
    assert.match(row, new RegExp(`'width': ${w.width.toFixed(1)},`), `${w.id} width`)
    assert.match(row, new RegExp(`'length': ${w.length.toFixed(1)},`), `${w.id} length`)
  }
  assert.ok(SZJ_STAIR.count * SZJ_STAIR.tread <= SZJ_WELLS[0].length)
  assert.ok(SZJ_LANDING.exit < SZJ_LANDING.enter && SZJ_LANDING.enter < SZJ_LANDING.door, 'exit < enter < door hysteresis')
  for (const g of szjGroundStairwells()) {
    const bottom = g.grade - g.riser / 2 - (g.riser / g.tread) * (g.zTop - g.land)
    assert.ok(bottom <= g.grade - g.depth, `${g.id}: ramp reaches the B1 floor before the door`)
    assert.ok(g.land < g.zBack, `${g.id}: landing runs past the hole under the grade`)
  }
})

test('B1 roller shutters sit on the door line and roll fully up', () => {
  const content = createSzjIndoorSceneContent(SHIZIJIE_B1_LAYOUT)
  try {
    for (const st of SZJ_STAIRWELLS) {
      let mesh = null
      content.scene.traverse(o => {
        if (o.name === `szj-stair-shutter-${st.id}`) mesh = o
      })
      assert.ok(mesh, `${st.id} shutter`)
      const c = szjDoorCentre(st)
      assert.ok(Math.hypot(mesh.position.x - c.x, mesh.position.z - c.z) < 1e-6)
      assert.ok(Math.abs(mesh.position.y - (SZJ_FRAME.indoorFloorY + SZJ_STAIR_DOOR.height)) < 1e-6)
      content.setStairDoorOpen(st.id, 0.5)
      assert.ok(mesh.visible && Math.abs(mesh.scale.y - 0.5) < 1e-9)
      content.setStairDoorOpen(st.id, 1)
      assert.equal(mesh.visible, false)
      content.setStairDoorOpen(st.id, 0)
      assert.ok(mesh.visible && mesh.scale.y === 1)
    }
  } finally {
    content.dispose()
  }
})
