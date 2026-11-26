import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Works natively under Node 22 `node --test` AND under `vitest run` when VITEST=true.
const test = process.env.VITEST
  ? (await import('vitest')).test
  : (await import('node:test')).default

import {
  STAIR_PRESETS,
  applyStairCameraPose,
  applyStairLimbPose,
  computeStairLimbPose,
  createScriptedStairTraversal,
  createStairEyeSmoother,
  createStairLocomotionAdapter,
  createStairPlacementFromEndpoints,
  normalizeStairProfile,
  projectWorldToStair,
  sampleStairProfile,
  stairLocalToWorld,
  validateStairProfile,
} from './index.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DT_60FPS = 1 / 60

test('StairProfile validation and normalization across curbs, stoops, flights, and mid-landings', () => {
  assert.deepEqual(validateStairProfile(STAIR_PRESETS.curb), [])
  assert.deepEqual(validateStairProfile(STAIR_PRESETS.stoop), [])
  assert.deepEqual(validateStairProfile(STAIR_PRESETS.buildingFlight), [])
  assert.deepEqual(validateStairProfile(STAIR_PRESETS.underpassDescent), [])

  assert.ok(validateStairProfile({ riser: 0, tread: 0.3, count: 4 }).length > 0)
  assert.ok(validateStairProfile({ riser: 0.15, tread: -0.2, count: 4 }).length > 0)
  assert.ok(validateStairProfile({ riser: 0.15, tread: 0.3, count: 0 }).length > 0)
  assert.ok(validateStairProfile({ riser: 0.15, tread: 0.3, count: 4, midLanding: { afterStep: 4, length: 1 } }).length > 0)

  const desc = normalizeStairProfile({ ...STAIR_PRESETS.underpassDescent, baseY: 151.3 })
  assert.equal(desc.count, 28)
  assert.ok(Math.abs(desc.totalRise - 4.2) < 1e-9)
  assert.ok(Math.abs(desc.endY - (151.3 - 4.2)) < 1e-9)
  assert.ok(Math.abs(desc.totalRun - (0.6 + 28 * 0.3 + 0.8)) < 1e-9)

  // With ample landings, peakSlope equals exact geometric slope -riser/tread.
  assert.ok(Math.abs(desc.flights[0].peakSlope - (-0.15 / 0.3)) < 1e-9)

  const withMid = normalizeStairProfile({
    riser: 0.16,
    tread: 0.3,
    count: 20,
    landing: { entry: 0.8, exit: 0.8 },
    midLanding: { afterStep: 10, length: 1.4 },
    direction: 'down',
    baseY: 10,
  })
  assert.equal(withMid.flights.length, 2)
  assert.ok(withMid.flights[0].shoulderOutEnd <= withMid.flights[1].shoulderInStart + 1e-9)
  assert.ok(Math.abs(sampleStairProfile(withMid, 0).height - 10) < 1e-9)
  assert.ok(Math.abs(sampleStairProfile(withMid, withMid.totalRun).height - (10 - 3.2)) < 1e-9)
})

test('strictly monotonic height on ascent and descent (curb, stoop, full flight, mid-landing, zero-landing)', () => {
  const cases = [
    { name: 'curb-up', profile: STAIR_PRESETS.curb },
    { name: 'curb-down-zero-landing', profile: { riser: 0.16, tread: 0.3, count: 1, landing: 0, direction: 'down', baseY: 5 } },
    { name: 'stoop-up', profile: STAIR_PRESETS.stoop },
    { name: 'stoop-down', profile: { ...STAIR_PRESETS.stoop, direction: 'down', baseY: 2 } },
    { name: 'building-up', profile: STAIR_PRESETS.buildingFlight },
    { name: 'underpass-down', profile: { ...STAIR_PRESETS.underpassDescent, baseY: 151.3 } },
    {
      name: 'mid-landing-up',
      profile: {
        riser: 0.15,
        tread: 0.3,
        count: 24,
        landing: 0.7,
        midLanding: { afterStep: 12, length: 1.2 },
        direction: 'up',
        baseY: 0,
      },
    },
    {
      name: 'mid-landing-down',
      profile: {
        riser: 0.15,
        tread: 0.3,
        count: 24,
        landing: 0.7,
        midLanding: { afterStep: 12, length: 1.2 },
        direction: 'down',
        baseY: 100,
      },
    },
  ]

  const SAMPLES = 2000
  for (const tc of cases) {
    const norm = normalizeStairProfile(tc.profile)
    const isUp = norm.direction === 'up'
    let prev = sampleStairProfile(norm, 0)
    assert.ok(Math.abs(prev.height - norm.baseY) < 1e-9, `${tc.name}: start height mismatch`)

    for (let i = 1; i <= SAMPLES; i++) {
      const s = (norm.totalRun * i) / SAMPLES
      const cur = sampleStairProfile(norm, s)
      if (isUp) {
        assert.ok(cur.height >= prev.height - 1e-12, `${tc.name}: non-monotonic dip at s=${s}`)
        assert.ok(cur.slope >= -1e-12, `${tc.name}: negative slope on ascent at s=${s}`)
      } else {
        assert.ok(cur.height <= prev.height + 1e-12, `${tc.name}: non-monotonic rise at s=${s}`)
        assert.ok(cur.slope <= 1e-12, `${tc.name}: positive slope on descent at s=${s}`)
      }
      prev = cur
    }
    assert.ok(Math.abs(prev.height - norm.endY) < 1e-9, `${tc.name}: end height mismatch`)
  }
})

test('continuous derivative (C¹/C²) at all shoulder transitions and zero slope at landing boundaries', () => {
  const profiles = [
    { ...STAIR_PRESETS.underpassDescent, baseY: 151.3 },
    STAIR_PRESETS.buildingFlight,
    { riser: 0.16, tread: 0.3, count: 1, landing: 0, direction: 'up', baseY: 0 },
    {
      riser: 0.15,
      tread: 0.28,
      count: 20,
      landing: { entry: 0.5, exit: 0.9 },
      midLanding: { afterStep: 10, length: 1.3 },
      direction: 'down',
      baseY: 50,
    },
  ]

  const h = 1e-4
  for (const raw of profiles) {
    const norm = normalizeStairProfile(raw)
    // Endpoints meet flat ground with zero slope.
    assert.equal(sampleStairProfile(norm, 0).slope, 0)
    assert.equal(sampleStairProfile(norm, norm.totalRun).slope, 0)

    const knots = []
    for (const f of norm.flights) {
      knots.push(f.shoulderInStart, f.flightStart, f.shoulderInEnd, f.shoulderOutStart, f.flightEnd, f.shoulderOutEnd)
    }

    for (const k of knots) {
      const leftS = Math.max(0, k - h)
      const rightS = Math.min(norm.totalRun, k + h)
      const sCenter = sampleStairProfile(norm, k)
      const sLeft = sampleStairProfile(norm, leftS)
      const sRight = sampleStairProfile(norm, rightS)

      // Analytical slope continuity across knot
      assert.ok(Math.abs(sCenter.slope - sLeft.slope) < 5e-3, `slope jump left at knot ${k}`)
      assert.ok(Math.abs(sRight.slope - sCenter.slope) < 5e-3, `slope jump right at knot ${k}`)

      // Finite-difference left/right derivative agreement at interior knots
      if (k > h && k < norm.totalRun - h) {
        const leftDeriv = (sCenter.height - sLeft.height) / h
        const rightDeriv = (sRight.height - sCenter.height) / h
        assert.ok(
          Math.abs(leftDeriv - rightDeriv) < 1e-3,
          `derivative discontinuity at knot ${k}: left=${leftDeriv}, right=${rightDeriv}`,
        )
        assert.ok(
          Math.abs(leftDeriv - sCenter.slope) < 1e-3,
          `left finite diff disagrees with analytical slope at knot ${k}`,
        )
        assert.ok(
          Math.abs(rightDeriv - sCenter.slope) < 1e-3,
          `right finite diff disagrees with analytical slope at knot ${k}`,
        )
      }
    }
  }
})

test('per-frame Δy <= 0.08m at 60fps across interactive smoothing, brisk walking, and abrupt perturbations', () => {
  const profiles = [
    { ...STAIR_PRESETS.underpassDescent, baseY: 151.3 },
    STAIR_PRESETS.buildingFlight,
    STAIR_PRESETS.stoop,
    STAIR_PRESETS.curb,
  ]

  for (const raw of profiles) {
    const norm = normalizeStairProfile(raw)
    const isUp = norm.direction === 'up'
    // Test walking speeds up to brisk 3.2 m/s
    for (const speed of [1.2, 2.0, 3.2]) {
      const smoother = createStairEyeSmoother({ eyeOffset: 1.6 })
      const startSample = sampleStairProfile(norm, 0)
      let prevEyeY = smoother.reset(startSample.height).eyeY

      const totalSteps = Math.ceil((norm.totalRun / speed) / DT_60FPS) + 30
      let maxAbsDy = 0

      for (let i = 1; i <= totalSteps; i++) {
        const s = Math.min(norm.totalRun, i * DT_60FPS * speed)
        const sample = sampleStairProfile(norm, s)
        const st = smoother.step(sample, DT_60FPS)
        const dy = st.eyeY - prevEyeY
        maxAbsDy = Math.max(maxAbsDy, Math.abs(dy))

        assert.ok(Math.abs(dy) <= 0.08 + 1e-12, `Δy exceeded 0.08m (${dy}) at speed=${speed}`)
        if (isUp) {
          assert.ok(dy >= -1e-12, `eye height dipped on ascent (dy=${dy})`)
        } else {
          assert.ok(dy <= 1e-12, `eye height bounced up on descent (dy=${dy})`)
        }
        prevEyeY = st.eyeY
      }
      assert.ok(maxAbsDy <= 0.08)
    }
  }

  // Abrupt 1.0m teleport spike still clamped strictly to <= 0.08m per frame
  const spikeSmoother = createStairEyeSmoother({ eyeOffset: 1.6, smoothTauSec: 0.001, maxDeltaYPerFrame: 0.08 })
  spikeSmoother.reset(0)
  const targetSample = sampleStairProfile({ riser: 1.0, tread: 1.0, count: 1, direction: 'up' }, 1.0)
  const next = spikeSmoother.step(targetSample, DT_60FPS)
  assert.ok(Math.abs(next.lastDeltaY) <= 0.08 + 1e-12)
})

test('scripted mode: monotonic eyeY, per-frame Δy <= 0.08m at 60fps, and lands within 1e-3 of final point', () => {
  const placements = [
    {
      name: 'descent-yaw-72deg',
      placement: {
        origin: { x: -902.25, y: 151.3, z: -208.43 },
        yawRad: (72 * Math.PI) / 180,
        profile: { ...STAIR_PRESETS.underpassDescent, baseY: 151.3 },
      },
      startLateral: 0.65,
    },
    {
      name: 'ascent-yaw-neg131deg',
      placement: {
        origin: { x: -925.95, y: 147.1, z: -148.13 },
        yawRad: (-131.2 * Math.PI) / 180,
        profile: { ...STAIR_PRESETS.underpassDescent, direction: 'up', baseY: 147.1 },
      },
      startLateral: -0.5,
    },
    {
      name: 'zero-landing-steep-flight',
      placement: {
        origin: { x: 12, y: 3, z: -4 },
        yawRad: -0.785,
        profile: { riser: 0.18, tread: 0.25, count: 16, landing: 0, direction: 'down', baseY: 3 },
      },
      startLateral: 0.3,
    },
    {
      name: 'curb-step-up',
      placement: {
        origin: { x: 0, y: 0, z: 0 },
        yawRad: 0,
        profile: STAIR_PRESETS.curb,
      },
      startLateral: 0,
    },
  ]

  for (const tc of placements) {
    const traversal = createScriptedStairTraversal({
      profile: tc.placement.profile,
      placement: tc.placement,
      speed: 1.5,
      eyeOffset: 1.6,
      startLateral: tc.startLateral,
      targetLateral: 0,
    })

    const isUp = (tc.placement.profile.direction ?? 'up') === 'up'
    const expectedEnd = traversal.getEndPoint()
    let prev = traversal.getState()
    let maxAbsDy = 0
    let frames = 0

    while (!traversal.isDone() && frames < 2000) {
      const cur = traversal.step(DT_60FPS)
      frames++
      const dy = cur.eyeY - prev.eyeY
      maxAbsDy = Math.max(maxAbsDy, Math.abs(dy))

      assert.ok(Math.abs(dy) <= 0.08 + 1e-12, `${tc.name}: frame ${frames} Δy=${dy} > 0.08m`)
      if (isUp) {
        assert.ok(dy >= -1e-12, `${tc.name}: non-monotonic eyeY dip at frame ${frames} (dy=${dy})`)
        assert.ok(cur.position.y >= prev.position.y - 1e-12, `${tc.name}: footY dip at frame ${frames}`)
      } else {
        assert.ok(dy <= 1e-12, `${tc.name}: non-monotonic eyeY rise at frame ${frames} (dy=${dy})`)
        assert.ok(cur.position.y <= prev.position.y + 1e-12, `${tc.name}: footY rise at frame ${frames}`)
      }
      prev = cur
    }

    assert.equal(traversal.isDone(), true, `${tc.name}: traversal did not complete`)
    assert.ok(maxAbsDy <= 0.08 + 1e-12)

    const endDist = Math.hypot(
      prev.position.x - expectedEnd.x,
      prev.position.y - expectedEnd.y,
      prev.position.z - expectedEnd.z,
    )
    assert.ok(endDist < 1e-3, `${tc.name}: landing position error ${endDist} >= 1e-3`)
    assert.ok(Math.abs(prev.eyeY - (expectedEnd.y + 1.6)) < 1e-3, `${tc.name}: final eyeY mismatch`)
    assert.equal(prev.pitchBiasRad, 0, `${tc.name}: final pitch bias did not settle to 0`)
  }
})

test('world<->local projection round-trip and createStairPlacementFromEndpoints exactness', () => {
  const start = { x: -120.5, y: 151.3, z: 42.25 }
  const end = { x: -112.1, y: 147.1, z: 47.8 }
  const placement = createStairPlacementFromEndpoints(start, end, {
    targetRiser: 0.15,
    landing: { entry: 0.5, exit: 0.7 },
    width: 3.4,
  })
  const norm = normalizeStairProfile(placement.profile)

  const worldStart = stairLocalToWorld(placement, 0, 0)
  const worldEnd = stairLocalToWorld(placement, norm.totalRun, 0)
  assert.ok(Math.hypot(worldStart.x - start.x, worldStart.y - start.y, worldStart.z - start.z) < 1e-9)
  assert.ok(Math.hypot(worldEnd.x - end.x, worldEnd.y - end.y, worldEnd.z - end.z) < 1e-9)

  for (const [s, lat] of [[0, 0], [2.4, 0.75], [norm.totalRun * 0.5, -1.1], [norm.totalRun, 0.2]]) {
    const wp = stairLocalToWorld(placement, s, lat)
    const proj = projectWorldToStair(placement, wp)
    assert.ok(Math.abs(proj.rawS - s) < 1e-9)
    assert.ok(Math.abs(proj.lateral - lat) < 1e-9)
    assert.equal(proj.inBounds, true)
  }
})

test('adapter applies camera + limb pose cleanly and resets to zero on flat landings', () => {
  const makeJoint = () => {
    const rot = {
      x: 0,
      y: 0,
      z: 0,
      set(x, y, z) {
        this.x = x
        this.y = y
        this.z = z
      },
    }
    return { rotation: rot }
  }
  const joints = {
    Torso: makeJoint(),
    ThighL: makeJoint(),
    ThighR: makeJoint(),
    ShinL: makeJoint(),
    ShinR: makeJoint(),
    ArmL: makeJoint(),
    ArmR: makeJoint(),
    ForearmL: makeJoint(),
    ForearmR: makeJoint(),
  }
  const camera = {
    pos: [0, 0, 0],
    position: {
      set(x, y, z) {
        camera.pos = [x, y, z]
      },
    },
    rotation: { x: 0, y: 0 },
  }

  // Flat landing produces zero procedural stair weight
  const flatSample = sampleStairProfile(STAIR_PRESETS.underpassDescent, 0)
  assert.equal(computeStairLimbPose(flatSample, { speed: 1.5 }).weight, 0)

  // Mid-flight produces non-zero climb/descend limb articulation
  const midSample = sampleStairProfile(STAIR_PRESETS.buildingFlight, 3.0)
  const midPose = computeStairLimbPose(midSample, { speed: 1.5 })
  assert.ok(midPose.weight > 0.9)
  assert.ok(midPose.torsoPitchX > 0)
  applyStairLimbPose(joints, midPose)
  assert.ok(joints.Torso.rotation.x > 0)

  // Adapter scripted mode drives camera to final endpoint and returns to idle
  const adapter = createStairLocomotionAdapter({ eyeOffset: 1.6 })
  const placement = createStairPlacementFromEndpoints({ x: 0, y: 4.2, z: 0 }, { x: 0, y: 0, z: -9.8 }, { landing: 0.6 })
  adapter.startScripted({ profile: placement.profile, placement, speed: 1.6 })
  assert.equal(adapter.getMode(), 'scripted')

  let lastResult = null
  for (let i = 0; i < 1000 && adapter.getMode() === 'scripted'; i++) {
    lastResult = adapter.stepScripted(DT_60FPS, camera, joints)
  }
  assert.equal(adapter.getMode(), 'idle')
  assert.equal(lastResult?.frame.done, true)
  assert.ok(Math.hypot(camera.pos[0] - 0, camera.pos[1] - 1.6, camera.pos[2] - -9.8) < 1e-3)

  // Apply helper directly works with basePitchRad
  applyStairCameraPose(camera, { eyePosition: { x: 1, y: 2, z: 3 }, yawRad: 0.5, pitchBiasRad: -0.1 }, { basePitchRad: 0.05 })
  assert.deepEqual(camera.pos, [1, 2, 3])
  assert.ok(Math.abs(camera.rotation.x - -0.05) < 1e-12)
  assert.equal(camera.rotation.y, 0.5)

  // Interactive free-walk mode + reset lifecycle
  const interactiveRes = adapter.stepInteractive(placement, { x: 0, y: 2.1, z: -4.9 }, DT_60FPS, 1.5, joints)
  assert.equal(adapter.getMode(), 'interactive')
  assert.equal(interactiveRes.inBounds, true)
  assert.ok(interactiveRes.sample.slope < 0)
  assert.ok(interactiveRes.limbPose.weight > 0.8)
  adapter.reset()
  assert.equal(adapter.getMode(), 'idle')
  assert.equal(adapter.stepScripted(DT_60FPS), null)

  // Pure progress sampler agrees with endpoints
  const pureTraversal = createScriptedStairTraversal({ profile: placement.profile, placement, speed: 1.5 })
  const atStart = pureTraversal.sampleAtProgress(0)
  const atEnd = pureTraversal.sampleAtProgress(1)
  assert.ok(Math.abs(atStart.position.y - 4.2) < 1e-9)
  assert.ok(Math.abs(atEnd.position.y - 0) < 1e-9)
  assert.equal(atEnd.done, true)
})

test('structural compatibility with elevation-keyed { landingTop, landingFoot } profiles', () => {
  const elevationKeyed = {
    riser: 0.15,
    tread: 0.3,
    count: 28,
    width: 3.4,
    landingTop: 0.6,
    landingFoot: 1.5,
  }
  assert.deepEqual(validateStairProfile(elevationKeyed), [])
  assert.ok(validateStairProfile({ ...elevationKeyed, landingTop: -0.1 }).length > 0)
  assert.ok(validateStairProfile({ ...elevationKeyed, landingFoot: -0.2 }).length > 0)

  const down = normalizeStairProfile({ ...elevationKeyed, direction: 'down', baseY: 4.2 })
  assert.deepEqual(down.landing, { entry: 0.6, exit: 1.5 })
  assert.ok(Math.abs(down.totalRun - (0.6 + 28 * 0.3 + 1.5)) < 1e-9)
  assert.ok(Math.abs(sampleStairProfile(down, 0).height - 4.2) < 1e-9)
  assert.ok(Math.abs(sampleStairProfile(down, down.totalRun).height - 0) < 1e-9)

  const up = normalizeStairProfile({ ...elevationKeyed, direction: 'up', baseY: 0 })
  assert.deepEqual(up.landing, { entry: 1.5, exit: 0.6 })
  assert.ok(Math.abs(up.totalRun - (1.5 + 28 * 0.3 + 0.6)) < 1e-9)
  assert.ok(Math.abs(sampleStairProfile(up, 0).height - 0) < 1e-9)
  assert.ok(Math.abs(sampleStairProfile(up, up.totalRun).height - 4.2) < 1e-9)
})

test('module has zero coupling to shizijie, xiaoxianggang, mifen, or DOM globals', () => {
  const tsFiles = fs.readdirSync(__dirname).filter(f => f.endsWith('.ts'))
  assert.ok(tsFiles.length >= 4)
  for (const file of tsFiles) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8')
    assert.equal(/shizijie|xiaoxianggang|mifen|十字街|小香港/i.test(src), false, `${file} must not reference specific landmarks`)
    assert.equal(/\b(window|document)\b/.test(src), false, `${file} must not depend on DOM globals`)
  }
})
