import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GEARBOX,
  createCarGearbox,
  createCarRollaway,
  resolveCarStrict,
  stepCarRollaway,
} from './car-gearbox.ts'

test('resolveCarStrict honors query override and defaults strict off in verify mode', () => {
  assert.equal(resolveCarStrict({verify: false, param: null}), true)
  assert.equal(resolveCarStrict({verify: true, param: null}), false)
  assert.equal(resolveCarStrict({verify: true, param: '1'}), true)
  assert.equal(resolveCarStrict({verify: false, param: '0'}), false)
})

test('strict car gearbox boots off + P, requires ignition before shifting, and blocks throttle when off/P', () => {
  const gb = createCarGearbox({strict: true})
  gb.resetForMount()
  assert.equal(gb.ignitionState, 'off')
  assert.equal(gb.selector, 'P')
  assert.equal(gb.displayGear(1), 'P')

  // Throttle while off is blocked and emits ignition hint
  const pOff = gb.pedals(1, 0, 0.05)
  assert.equal(pOff.forward, 0)
  assert.equal(pOff.holdBrake, true)
  assert.equal(pOff.hint?.type, 'reject')

  // Shifting while engine off is rejected
  const shOff = gb.shift('D', {speedMs: 0})
  assert.equal(shOff.ok, false)
  assert.equal(shOff.reason, 'engine_off')

  // Crank ignition -> completes after GEARBOX.crankSec
  const crankRes = gb.ignition(true)
  assert.equal(crankRes.ok, true)
  assert.equal(gb.ignitionState, 'cranking')
  assert.ok(gb.crankDimFactor >= 0.55 && gb.crankDimFactor < 1)

  let started = false
  for (let i = 0; i < 20; i++) {
    const ev = gb.tick(0.05)
    if (ev && ev.type === 'engine_started') started = true
  }
  assert.equal(started, true)
  assert.equal(gb.ignitionState, 'on')
  assert.equal(gb.crankDimFactor, 1)

  // Throttle in P still holds brake and does not move
  const pPark = gb.pedals(1, 0, 0.05)
  assert.equal(pPark.forward, 0)
  assert.equal(pPark.holdBrake, true)
  assert.ok(pPark.revThrottle > 0)
})

test('electronic column stalk lever transitions cleanly and enforces speed interlocks', () => {
  const gb = createCarGearbox({strict: true})
  gb.resetForMount({ignition: 'on', selector: 'P'})

  // Down from P -> D
  const toD = gb.lever('down', {speedMs: 0})
  assert.equal(toD.ok, true)
  assert.equal(gb.selector, 'D')
  assert.equal(gb.displayGear(3), 'D3')

  // Reject P at high speed
  const hiP = gb.shift('P', {speedMs: 5.0})
  assert.equal(hiP.ok, false)
  assert.equal(hiP.reason, 'speed_too_high')

  // Reject D -> R directly at high speed
  const hiR = gb.shift('R', {speedMs: 3.0})
  assert.equal(hiR.ok, false)
  assert.equal(hiR.reason, 'speed_too_high')

  // Up from D -> N -> R at standstill
  assert.equal(gb.lever('up', {speedMs: 0}).ok, true)
  assert.equal(gb.selector, 'N')
  assert.equal(gb.lever('up', {speedMs: 0}).ok, true)
  assert.equal(gb.selector, 'R')
  assert.equal(gb.reverseLamp(), true)

  // Down from R -> N -> D
  assert.equal(gb.lever('down', {speedMs: 0}).ok, true)
  assert.equal(gb.selector, 'N')
  assert.equal(gb.lever('down', {speedMs: 0}).ok, true)
  assert.equal(gb.selector, 'D')
  assert.equal(gb.reverseLamp(), false)

  // Reject ignition off while moving
  const hiOff = gb.ignition(false, 2.5)
  assert.equal(hiOff.ok, false)
  assert.equal(hiOff.reason, 'speed_too_high')
  assert.equal(gb.ignition(false, 0).ok, true)
  assert.equal(gb.ignitionState, 'off')
})

test('D gear creeps gently without auto-reversing on S; legacy mode passes pedals straight through', () => {
  const gb = createCarGearbox({strict: true})
  gb.resetForMount({ignition: 'on', selector: 'D'})

  const creep = gb.pedals(0, 0, 1 / 60)
  assert.ok(creep.forward > 0 && creep.forward <= GEARBOX.creepPedal + 1e-6)

  // Holding S at standstill never reverses in D
  let gotHint = false
  for (let i = 0; i < 45; i++) {
    const res = gb.pedals(-1, 0, 1 / 60)
    assert.equal(res.forward, 0)
    assert.equal(res.holdBrake, true)
    if (res.hint?.action === 'reverse_hint') gotHint = true
  }
  assert.equal(gotHint, true)

  // Legacy mode passes everything unchanged
  const legacy = createCarGearbox({strict: false})
  legacy.resetForMount()
  assert.equal(legacy.pedals(0.75, 0).forward, 0.75)
  assert.equal(legacy.pedals(-1, 0).forward, -1)
  assert.equal(legacy.planDismount(0.1), 'safe')
})

test('dismount planning and rollaway simulation enforce distance cap, water stop, wall stop, and player OBB stop', () => {
  const gb = createCarGearbox({strict: true})
  gb.resetForMount({ignition: 'on', selector: 'D'})
  assert.equal(gb.planDismount(0), 'creep_fwd')
  gb.shift('R', {speedMs: 0})
  assert.equal(gb.planDismount(0), 'creep_rev')
  gb.shift('N', {speedMs: 0})
  assert.equal(gb.planDismount(0), 'unsecured_flat')
  assert.equal(gb.planDismount(0.08), 'coast')
  gb.shift('P', {speedMs: 0})
  assert.equal(gb.planDismount(0), 'auto_off')
  gb.ignition(false, 0)
  assert.equal(gb.planDismount(0), 'safe')

  const openProbe = {
    segmentBlocked: () => false,
    isWet: () => false,
    supportY: () => 0,
    playerPos: () => ({x: 10, z: 10}),
  }

  // 1. D creep caps cleanly via EPB at <= 2.2m
  const creepSim = createCarRollaway({plan: 'creep_fwd', x: 0, y: 0, z: 0, heading: 0, pitch: 0})
  let stopReason = ''
  for (let i = 0; i < 300 && creepSim.active; i++) {
    stopReason = stepCarRollaway(creepSim, 1 / 60, openProbe)
  }
  assert.equal(stopReason, 'epb')
  assert.ok(creepSim.distance > 0.5 && creepSim.distance <= GEARBOX.rollawayMaxCreepDistM + 0.05)

  // 2. Water detection halts before bumper enters water
  const waterSim = createCarRollaway({plan: 'creep_fwd', x: 0, y: 0, z: 0, heading: 0, pitch: 0})
  const waterProbe = {...openProbe, isWet: (_x, z) => z < -2.6}
  let waterStop = ''
  for (let i = 0; i < 200 && waterSim.active; i++) {
    waterStop = stepCarRollaway(waterSim, 1 / 60, waterProbe)
  }
  assert.equal(waterStop, 'water')
  assert.ok(waterSim.z > -0.6)

  // 3. Wall detection stops with impact flag
  const wallSim = createCarRollaway({plan: 'creep_fwd', x: 0, y: 0, z: 0, heading: 0, pitch: 0})
  const wallProbe = {...openProbe, segmentBlocked: (_x0, _z0, _x1, z1) => z1 < -2.5}
  let wallStop = ''
  for (let i = 0; i < 200 && wallSim.active; i++) {
    wallStop = stepCarRollaway(wallSim, 1 / 60, wallProbe)
  }
  assert.equal(wallStop, 'wall')
  assert.equal(wallSim.impactTriggered, true)

  // 4. Player standing ahead stops rollaway cleanly
  const playerSim = createCarRollaway({plan: 'creep_fwd', x: 0, y: 0, z: 0, heading: 0, pitch: 0})
  const playerProbe = {...openProbe, playerPos: () => ({x: 0, z: -2.9})}
  let playerStop = ''
  for (let i = 0; i < 200 && playerSim.active; i++) {
    playerStop = stepCarRollaway(playerSim, 1 / 60, playerProbe)
  }
  assert.equal(playerStop, 'player')
})
