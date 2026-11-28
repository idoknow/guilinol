import assert from 'node:assert/strict'
import test from 'node:test'
import {
  KICKSTAND,
  buildKickstandGeometry,
  chooseTipSide,
  createTipOver,
  kickstandDeployCurve,
  kickstandFootY,
  resolveDismountSupport,
  resolveKickstandStrict,
  stepKickstandBlend,
  stepTipOver,
  tipLift,
} from './kickstand.ts'
import {vehicleModel} from './vehicle-model.ts'

test('resolveKickstandStrict honors explicit query override and defaults strict off in verify mode', () => {
  assert.equal(resolveKickstandStrict({verify: false, param: null}), true)
  assert.equal(resolveKickstandStrict({verify: true, param: null}), false)
  assert.equal(resolveKickstandStrict({verify: true, param: '1'}), true)
  assert.equal(resolveKickstandStrict({verify: false, param: '0'}), false)
})

test('resolveDismountSupport distinguishes bicycle, strict off, deployed stand, and unsupported tip-over', () => {
  assert.equal(resolveDismountSupport({kind: 'bicycle', kickstandDown: false, strict: true}), 'auto_stand')
  assert.equal(resolveDismountSupport({kind: 'bike', kickstandDown: false, strict: false}), 'auto_stand')
  assert.equal(resolveDismountSupport({kind: 'bike', kickstandDown: true, strict: true}), 'stand')
  assert.equal(resolveDismountSupport({kind: 'bike', kickstandDown: false, strict: true}), 'tip_over')
})

test('chooseTipSide falls away from player when clear, switches when player is far, and wall-leans when boxed in', () => {
  // Heading 0 => bike faces -Z, right is +X, left is -X.
  // Player stands on left (-0.8, 0) => away side is right (+X, side = +1).
  const awayRight = chooseTipSide({
    heading: 0,
    bike: {x: 0, z: 0},
    player: {x: -0.8, z: 0},
    awayFree: true,
    towardFree: true,
    playerDist: 0.8,
  })
  assert.equal(awayRight.side, 1)
  assert.equal(awayRight.wallLean, false)
  assert.equal(awayRight.restRoll, KICKSTAND.layRollRad)

  // Player stands on right (+0.8, 0) => away side is left (-X, side = -1).
  const awayLeft = chooseTipSide({
    heading: 0,
    bike: {x: 0, z: 0},
    player: {x: 0.8, z: 0},
    awayFree: true,
    towardFree: true,
    playerDist: 0.8,
  })
  assert.equal(awayLeft.side, -1)
  assert.equal(awayLeft.wallLean, false)

  // Away side blocked & player close (< 1.1m) => wall lean on away side, never clips player
  const wallLean = chooseTipSide({
    heading: 0,
    bike: {x: 0, z: 0},
    player: {x: -0.8, z: 0},
    awayFree: false,
    towardFree: true,
    playerDist: 0.8,
  })
  assert.equal(wallLean.side, 1)
  assert.equal(wallLean.wallLean, true)
  assert.equal(wallLean.restRoll, KICKSTAND.wallLeanRollRad)

  // Away side blocked & player well clear (>= 1.1m) & toward side free => falls safely to free side
  const flipFree = chooseTipSide({
    heading: 0,
    bike: {x: 0, z: 0},
    player: {x: -1.4, z: 0},
    awayFree: false,
    towardFree: true,
    playerDist: 1.4,
  })
  assert.equal(flipFree.side, -1)
  assert.equal(flipFree.wallLean, false)
})

test('inverted-pendulum tip-over falls naturally in ~0.7-1.4s with bounce impulse and settles to rest', () => {
  const sim = createTipOver(0.02, 0.3)
  assert.equal(sim.phase, 'teeter')

  const impacts = []
  let restAt = -1
  const dt = 1 / 60
  for (let i = 1; i <= 180; i++) {
    const res = stepTipOver(sim, dt)
    if (res && typeof res === 'object') impacts.push({t: i * dt, ...res})
    if (res === 'rest') {
      restAt = i * dt
      break
    }
  }

  assert.ok(impacts.length >= 1, `expected ground contact impulse, got ${JSON.stringify(impacts)}`)
  assert.ok(impacts[0].impact > 0.35 && impacts[0].impact <= 1, `unexpected primary impact ${impacts[0].impact}`)
  assert.ok(restAt > 0.5 && restAt < 1.8, `expected realistic tip-over settle time, got ${restAt.toFixed(3)}s`)
  assert.equal(sim.phase, 'rest')
  assert.equal(sim.roll, KICKSTAND.layRollRad)
  assert.ok(tipLift(sim.roll) >= 0.24 && tipLift(sim.roll) <= 0.29)
  assert.equal(tipLift(0), 0)
})

test('kickstand blend snaps on dt=0 and advances smoothly with overshoot curve', () => {
  assert.equal(stepKickstandBlend(0, true, 0), 1)
  assert.equal(stepKickstandBlend(1, false, 0), 0)
  const mid = stepKickstandBlend(0, true, KICKSTAND.deploySec * 0.5)
  assert.ok(mid > 0.45 && mid < 0.55)
  const peak = kickstandDeployCurve(0.75, true)
  assert.ok(peak > 1.0 && peak <= 1 + KICKSTAND.overshoot * 2)
  assert.equal(kickstandDeployCurve(1, true), 1)
  assert.equal(kickstandDeployCurve(0, false), 0)
})

test('kickstandFootY sits flush on ground at +7 deg resting lean and geometry builds cleanly', () => {
  const footY = kickstandFootY(KICKSTAND.leanRad)
  assert.ok(Math.abs(footY) < 0.01, `expected kickstand foot sole within 1cm of y=0, got ${footY.toFixed(4)}m`)

  const dynGeom = buildKickstandGeometry(false)
  const staticGeom = buildKickstandGeometry(true)
  assert.ok(dynGeom.attributes.position.count > 40)
  assert.ok(dynGeom.attributes.color.count === dynGeom.attributes.position.count)
  assert.ok(staticGeom.boundingBox && staticGeom.boundingBox.min.x < -0.22)
  assert.ok(staticGeom.index, 'kickstand geometry preserves index buffer for static bike shell merge')
  dynGeom.dispose()
  staticGeom.dispose()

  const parkedWithStand = vehicleModel('bike', 0, {kickstand: true})
  const parkedNoStand = vehicleModel('bike', 0, {kickstand: false})
  assert.ok(parkedWithStand.geometry?.attributes?.position?.count > parkedNoStand.geometry?.attributes?.position?.count)
})
