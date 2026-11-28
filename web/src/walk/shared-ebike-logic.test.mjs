import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SHARED_TURN_SLIP_CONFIG,
  SHARED_EBIKE_COMP_COOLDOWN_MS,
  SHARED_EBIKE_COMP_DAILY_CAP,
  SHARED_EBIKE_COMPENSATION_COPY,
  SHARED_EBIKE_COMPENSATION_REASON,
  SHARED_EBIKE_COMPENSATION_YUAN,
  SHARED_EBIKE_MAX_KMH,
  SHARED_EBIKE_SLIP_PROBABILITY,
  clampHeadlightForVehicle,
  createSharedTurnSlipDetector,
  evaluateSharedEbikeCompEligibility,
  isSharedEbikeGearLocked,
  isSharedHeadlightSwitchLocked,
  localDayKey,
} from './shared-ebike-logic.ts'
import {EBIKE_SHARED_MAX_KMH, resolveEbikeProfile} from './tuning.ts'
import {createBikeControl} from './ride.ts'
import {
  registerSharedEbikeUnlockHooks,
  requestSharedEbikeUnlock,
  resetSharedEbikeUnlockHooks,
} from './shared-ebike-unlock.ts'
import {resolveInteraction} from './interact-arbiter.ts'
import * as saveMod from '../game/save.ts'
import * as stateMod from '../game/state.ts'
import * as commerce from '../game/commerce.ts'

class MemoryStorage {
  #map = new Map()
  getItem(k) { return this.#map.has(k) ? this.#map.get(k) : null }
  setItem(k, v) { this.#map.set(k, String(v)) }
  removeItem(k) { this.#map.delete(k) }
  clear() { this.#map.clear() }
}

if (!globalThis.window) {
  globalThis.window = new EventTarget()
}
if (!globalThis.CustomEvent) {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, init) {
      super(type)
      this.detail = init?.detail
    }
  }
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('shared e-bike real-life locks: 25 km/h cap, single gear D, no shifting, no high-beam toggle', () => {
  assert.equal(SHARED_EBIKE_MAX_KMH, 25)
  assert.equal(EBIKE_SHARED_MAX_KMH, 25)
  assert.equal(SHARED_EBIKE_COMPENSATION_YUAN, 200)
  assert.equal(SHARED_EBIKE_COMPENSATION_COPY, '商家对于你的不幸感到糟糕的赔偿')

  assert.equal(isSharedEbikeGearLocked('bike', 'shared'), true)
  assert.equal(isSharedEbikeGearLocked('bike', 'normal'), false)
  assert.equal(isSharedEbikeGearLocked('bicycle', 'normal'), false)

  assert.equal(isSharedHeadlightSwitchLocked('bike', 'shared'), true)
  assert.equal(isSharedHeadlightSwitchLocked('bicycle', 'normal'), true)
  assert.equal(isSharedHeadlightSwitchLocked('bike', 'normal'), false)

  assert.equal(clampHeadlightForVehicle('bike', 'shared', 'high'), 'low')
  assert.equal(clampHeadlightForVehicle('bike', 'shared', 'low'), 'low')
  assert.equal(clampHeadlightForVehicle('bicycle', 'normal', 'high'), 'off')
  assert.equal(clampHeadlightForVehicle('bike', 'normal', 'high'), 'high')

  const profile = resolveEbikeProfile('shared', {motorLevel: 3, controllerLevel: 3, batteryLevel: 3})
  assert.equal(profile.tierMaxKmh, 25)
  assert.equal(profile.defaultGear, 1)
  assert.equal(profile.gears.length, 1)
  assert.equal(profile.gears[0].label, 'D')
  assert.equal(profile.gears[0].maxKmh, 25)

  const bike = createBikeControl()
  bike.mount(0, 0, 'bike', {vehicleType: 'shared', autoCrash: false, drainEnabled: false, parkStart: true, envHour: 12})
  // Shifting or pressing Digit1..4 while parked on shared e-bike MUST NOT unlock P-gear or change gear.
  assert.equal(bike.parkLocked, true)
  bike.setGear(1)
  bike.setGear(4)
  bike.shiftGear(1)
  assert.equal(bike.parkLocked, true, 'gear keys must not unlock P-gear on shared e-bike')
  assert.equal(bike.gear, 1)
  assert.equal(bike.gearCount, 1)

  // Brake / P unlocks cleanly into single gear D (max 25 km/h)
  bike.setPark(false, true)
  assert.equal(bike.parkLocked, false)
  assert.equal(bike.telemetry().gearLabel, 'D')
  assert.equal(bike.telemetry().maxKmh, 25)

  bike.setGear(4)
  bike.shiftGear(1)
  bike.shiftGear(-1)
  assert.equal(bike.gear, 1)
  assert.equal(bike.telemetry().gearLabel, 'D')

  // Full throttle caps strictly at 25 km/h with zero wheelie
  let peakKmh = 0
  for (let i = 0; i < 200; i++) {
    bike.steer(1, 0, 0.05, true, {wheelie: 1})
    peakKmh = Math.max(peakKmh, bike.speed * 3.6)
  }
  assert(peakKmh >= 22 && peakKmh <= 25.2, `expected shared peak near 25 km/h, got ${peakKmh.toFixed(2)}`)
  assert.equal(bike.wheelie, 0)

  // Shared e-bike cannot toggle high beam, and manual presses do NOT freeze night auto-light
  assert.equal(bike.headlight, 'off')
  assert.equal(bike.cycleHeadlight(), 'off')
  assert.equal(bike.setHeadlight('high', true), 'off')
  assert.equal(bike.setHeadlight('low', true), 'off')
  bike.setEnvironmentHour(21)
  assert.equal(bike.headlight, 'low', 'night auto single-state base light must still turn on')
  assert.equal(bike.cycleHeadlight(), 'low', 'cycling headlight at night must stay locked on low, never high')
  assert.equal(bike.setHeadlight('high', true), 'low')
  bike.setEnvironmentHour(10)
  assert.equal(bike.headlight, 'off', 'daytime auto-off must still work because headlightManual stayed false')

  // Shared bicycle also locks headlight switching (stays off)
  const ped = createBikeControl()
  ped.mount(0, 0, 'bicycle', {autoCrash: false, envHour: 21})
  assert.equal(ped.headlight, 'off')
  assert.equal(ped.cycleHeadlight(), 'off')
  assert.equal(ped.setHeadlight('high', true), 'off')
  assert.equal(ped.setHeadlight('low', true), 'off')

  // Personal / normal e-bike still shifts gears & cycles off -> low -> high -> off
  const personal = createBikeControl()
  personal.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: false, drainEnabled: false, parkStart: false, envHour: 12})
  assert.equal(personal.gearCount, 4)
  personal.setGear(4)
  assert.equal(personal.gear, 4)
  assert.equal(personal.cycleHeadlight(), 'low')
  assert.equal(personal.cycleHeadlight(), 'high')
  assert.equal(personal.cycleHeadlight(), 'off')
})

test('turn-event detector rolls at most once per deliberate turn (never 60fps re-roll), handles grace/speed/wiggle/cooldown', () => {
  let rolls = 0
  const det = createSharedTurnSlipDetector({
    rng: () => {
      rolls++
      return 0.5
    },
  })

  // 1. Mount grace window (3.0s): turning during first 3s must NOT roll
  for (let i = 0; i < 150; i++) {
    det.step({dt: 1 / 60, speed: 5.5, steerInput: 1, dYaw: -0.025, isSharedEbike: true, enabled: true})
  }
  assert.equal(rolls, 0, 'turns during 3s mount grace window must not roll')

  // Advance past 3s straight
  for (let i = 0; i < 60; i++) {
    det.step({dt: 1 / 60, speed: 5.5, steerInput: 0, dYaw: 0, isSharedEbike: true, enabled: true})
  }
  assert.equal(rolls, 0, 'straight riding must never roll')

  // 2. Low forward speed (< 2.2 m/s) or reversing must never roll
  for (let i = 0; i < 60; i++) {
    det.step({dt: 1 / 60, speed: 1.5, steerInput: 1, dYaw: -0.03, isSharedEbike: true, enabled: true})
    det.step({dt: 1 / 60, speed: -2.8, steerInput: 1, dYaw: -0.03, isSharedEbike: true, enabled: true})
  }
  assert.equal(rolls, 0, 'low speed and reverse turning must not roll')

  // 3. Micro-taps / zig-zag wiggle below minTurnYawRad must NOT accumulate into a roll
  for (let i = 0; i < 40; i++) {
    const dir = i % 2 === 0 ? 1 : -1
    det.step({dt: 1 / 60, speed: 5.5, steerInput: dir * 0.8, dYaw: -dir * 0.02, isSharedEbike: true, enabled: true})
  }
  assert.equal(rolls, 0, 'rapid wiggle/oscillation must not accumulate signed yaw into a turn')

  // 4. Holding a continuous right turn for 5 full seconds at 60fps (300 frames!) must roll EXACTLY ONCE
  for (let i = 0; i < 300; i++) {
    const res = det.step({dt: 1 / 60, speed: 6.0, steerInput: 1, dYaw: -0.025, isSharedEbike: true, enabled: true})
    assert.equal(res.slipped, false)
  }
  assert.equal(rolls, 1, '5 seconds continuous turn at 60fps must trigger exactly 1 roll, not 300')

  // 5. Straighten out for 0.3s, wait remaining cooldown, then execute a second left turn -> rolls ONCE more
  for (let i = 0; i < 150; i++) {
    det.step({dt: 1 / 60, speed: 6.0, steerInput: 0, dYaw: 0, isSharedEbike: true, enabled: true})
  }
  for (let i = 0; i < 60; i++) {
    det.step({dt: 1 / 60, speed: 6.0, steerInput: -1, dYaw: 0.025, isSharedEbike: true, enabled: true})
  }
  assert.equal(rolls, 2, 'second distinct turn after straightening + cooldown must roll once')
})

test('1% turn-slip probability boundary & Monte Carlo 100,000-turn distribution verification', () => {
  // Exact boundary check: < 0.01 slips, >= 0.01 safe
  const detHit = createSharedTurnSlipDetector({mountGraceSec: 0, rng: () => 0.009999})
  const detMiss = createSharedTurnSlipDetector({mountGraceSec: 0, rng: () => 0.01})
  let hit = false
  let miss = false
  for (let i = 0; i < 30; i++) {
    if (detHit.step({dt: 1 / 60, speed: 6.0, steerInput: 1, dYaw: -0.025, isSharedEbike: true, enabled: true}).slipped) hit = true
    if (detMiss.step({dt: 1 / 60, speed: 6.0, steerInput: 1, dYaw: -0.025, isSharedEbike: true, enabled: true}).slipped) miss = true
  }
  assert.equal(hit, true, 'rng=0.009999 must trigger slip (< 0.01)')
  assert.equal(miss, false, 'rng=0.01 must NOT trigger slip (exact 1% open upper bound)')

  // Monte Carlo: 100,000 independent turns with deterministic PRNG
  const prng = mulberry32(20261127)
  const detMc = createSharedTurnSlipDetector({
    mountGraceSec: 0,
    cooldownSec: 0,
    straightResetSec: 0.05,
    minTurnHoldSec: 0.05,
    minTurnYawRad: 0.1,
    rng: prng,
  })
  const TARGET_TURNS = 100_000
  let slips = 0
  let totalRolls = 0
  for (let t = 0; t < TARGET_TURNS; t++) {
    const dir = t % 2 === 0 ? 1 : -1
    // Complete one deliberate turn in 4 frames (4 * 0.02s = 0.08s, 4 * 0.04 = 0.16 rad)
    for (let f = 0; f < 4; f++) {
      const r = detMc.step({dt: 0.02, speed: 6.0, steerInput: dir, dYaw: -dir * 0.04, isSharedEbike: true, enabled: true})
      if (r.rolled) totalRolls++
      if (r.slipped) slips++
    }
    // Straighten out (4 frames = 0.08s > straightResetSec)
    for (let f = 0; f < 4; f++) {
      detMc.step({dt: 0.02, speed: 6.0, steerInput: 0, dYaw: 0, isSharedEbike: true, enabled: true})
    }
  }
  assert.equal(totalRolls, TARGET_TURNS, 'every distinct turn must produce exactly 1 roll')
  const empiricalRate = slips / totalRolls
  assert(
    empiricalRate >= 0.0085 && empiricalRate <= 0.0115,
    `expected ~1% slip rate over ${TARGET_TURNS} turns, got ${(empiricalRate * 100).toFixed(3)}% (${slips}/${totalRolls})`,
  )
  assert.equal(DEFAULT_SHARED_TURN_SLIP_CONFIG.slipProbability, SHARED_EBIKE_SLIP_PROBABILITY)
})

test('ride.ts distinguishes shared_turn_slip from manual hard-brake slip and hooks IDOK-540 ebike_slip knockdown', () => {
  const bike = createBikeControl()
  bike.mount(0, 0, 'bike', {
    vehicleType: 'shared',
    autoCrash: true,
    drainEnabled: false,
    parkStart: false,
    sharedSlipEnabled: true,
    sharedSlipMountGraceSec: 0,
    sharedSlipRng: () => 0.005,
  })
  // Accelerate straight above 2.2 m/s
  for (let i = 0; i < 30; i++) bike.steer(1, 0, 0.05, true)
  assert.equal(bike.crashPhase, 'none')
  assert(bike.speed >= 2.2)

  // Turn right -> triggers shared_turn_slip
  for (let i = 0; i < 30; i++) {
    bike.steer(1, 1, 0.05, true)
    if (bike.crashPhase !== 'none') break
  }
  assert.equal(bike.crashPhase, 'sliding')
  assert.equal(bike.crashState.reason, 'slip')
  assert.equal(bike.crashState.cause, 'shared_turn_slip')
  assert.equal(bike.crashState.knockdown.kind, 'ebike_slip')
  assert.equal(bike.crashState.knockdown.variant, 'bike_slide')
  assert.equal(bike.telemetry().crashCause, 'shared_turn_slip')

  // Manual hard-brake slip on normal/shared bike must NOT set crashCause = 'shared_turn_slip' (anti-farm!)
  const manualBike = createBikeControl()
  manualBike.mount(0, 0, 'bike', {
    vehicleType: 'shared',
    autoCrash: true,
    drainEnabled: false,
    parkStart: false,
    sharedSlipEnabled: false,
  })
  for (let i = 0; i < 60; i++) manualBike.steer(1, 0, 0.05, true)
  manualBike.triggerSlip({side: 1})
  assert.equal(manualBike.crashState.reason, 'slip')
  assert.equal(manualBike.crashState.cause, '', 'manual triggerSlip must NOT masquerade as shared_turn_slip')
})

test('damaged shared e-bike lockout in unlock flow and interact-arbiter priority', () => {
  let hookCalled = false
  registerSharedEbikeUnlockHooks({
    beforeUnlock: () => {
      hookCalled = true
      return {ok: true, code: 'OK', charged: 0, balanceAfter: 999, feeYuan: 0, message: '', phase: 'active'}
    },
  })
  const damagedSolo = requestSharedEbikeUnlock({
    bikeId: 'bay_1',
    sessionKey: 's_dmg_1',
    soloEnabled: true,
    alreadyUnlocked: true,
    damaged: true,
  })
  const damagedTour = requestSharedEbikeUnlock({
    bikeId: 'bay_1',
    sessionKey: 's_dmg_2',
    soloEnabled: false,
    alreadyUnlocked: false,
    damaged: true,
  })
  resetSharedEbikeUnlockHooks()

  assert.equal(hookCalled, false, 'DAMAGED check must short-circuit before custom hooks')
  assert.equal(damagedSolo.ok, false)
  assert.equal(damagedSolo.code, 'DAMAGED')
  assert.equal(damagedSolo.charged, 0)
  assert.equal(damagedTour.ok, false)
  assert.equal(damagedTour.code, 'DAMAGED')

  const baseCtx = {
    soloEnabled: true,
    active: true,
    modalOrOverlayBlocked: false,
    crashed: false,
    standingUp: false,
    pickingUpKind: null,
    aboardKind: null,
    inQuietZone: false,
    nearDownedVehicle: null,
    nearShop: null,
    nearServiceBay: null,
    nearVehicle: null,
    nearDamagedVehicle: {kind: 'bike', downed: true, damaged: true, distance: 1.5, ownership: 'shared', ebikeTier: 'shared'},
    nearBoat: null,
  }
  const onlyDamaged = resolveInteraction(baseCtx)
  assert.equal(onlyDamaged.action, 'damaged_vehicle')
  assert.equal(onlyDamaged.label, '已损坏 · 无法骑行')

  // Healthy neighboring vehicle ALWAYS wins over damaged bike
  const withHealthy = resolveInteraction({
    ...baseCtx,
    nearVehicle: {kind: 'bike', downed: false, distance: 3.1, ownership: 'shared', ebikeTier: 'shared'},
  })
  assert.equal(withHealthy.action, 'mount_vehicle')
  assert.equal(withHealthy.label, '解锁共享电动车（¥2）')
})

test('compensation ledger credits +¥200 persistently, enforces permanent bay claim + 10m cooldown + 2/day cap, and merges cleanly', () => {
  const mem = new MemoryStorage()
  globalThis.localStorage = mem
  saveMod.resetSaveForTesting(100, mem)

  const events = []
  const off = stateMod.onEvent(ev => events.push(ev))
  const t0 = new Date(2026, 10, 27, 10, 0, 0).getTime()

  // 1st payout succeeds (+¥200) without polluting missionsDone
  const r1 = commerce.creditSharedEbikeCompensation({bikeKey: '100,200', nowMs: t0})
  assert.equal(r1.ok, true)
  assert.equal(r1.code, 'OK')
  assert.equal(r1.credited, 200)
  assert.equal(r1.balanceAfter, 300)
  assert.equal(stateMod.getState().money, 300)
  assert.equal(saveMod.getActiveSaveSnapshot().missionsDone.length, 0, 'compensation must not pollute missionsDone')
  assert.deepEqual(saveMod.getActiveSaveSnapshot().economy.claimedSharedEbikeComp, ['100,200'])
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'money:change')
  assert.equal(events[0].delta, 200)
  assert.equal(events[0].reason, SHARED_EBIKE_COMPENSATION_REASON)

  // Same bay immediately rejected
  const dup = commerce.creditSharedEbikeCompensation({bikeKey: '100,200', nowMs: t0 + SHARED_EBIKE_COMP_COOLDOWN_MS + 1000})
  assert.equal(dup.ok, false)
  assert.equal(dup.code, 'ALREADY_CLAIMED')

  // Different bay within 10 min cooldown rejected
  const cool = commerce.creditSharedEbikeCompensation({bikeKey: '110,210', nowMs: t0 + 60_000})
  assert.equal(cool.ok, false)
  assert.equal(cool.code, 'COOLDOWN')

  // Different bay after 10 min succeeds (2nd of the day)
  const r2 = commerce.creditSharedEbikeCompensation({bikeKey: '110,210', nowMs: t0 + SHARED_EBIKE_COMP_COOLDOWN_MS})
  assert.equal(r2.ok, true)
  assert.equal(r2.balanceAfter, 500)

  // 3rd bay same calendar day hits daily cap (max 2/day)
  const cap = commerce.creditSharedEbikeCompensation({
    bikeKey: '120,220',
    nowMs: t0 + SHARED_EBIKE_COMP_COOLDOWN_MS * 2,
  })
  assert.equal(cap.ok, false)
  assert.equal(cap.code, 'DAILY_CAP')
  assert.equal(SHARED_EBIKE_COMP_DAILY_CAP, 2)

  // Next calendar day resets daily cap, while original bay '100,200' remains permanently claimed even after >70 tx ring overflow!
  for (let i = 0; i < 70; i++) {
    commerce.unlockSharedEbike({sessionKey: `ring_flush_${i}`, feeYuan: 2})
  }
  const nextDayMs = new Date(2026, 10, 28, 10, 0, 0).getTime()
  const stillClaimed = commerce.creditSharedEbikeCompensation({bikeKey: '100,200', nowMs: nextDayMs})
  assert.equal(stillClaimed.ok, false)
  assert.equal(stillClaimed.code, 'ALREADY_CLAIMED', 'permanent bay claim must survive txHistoryRing eviction')

  const nextDayOk = commerce.creditSharedEbikeCompensation({bikeKey: '120,220', nowMs: nextDayMs})
  assert.equal(nextDayOk.ok, true)
  assert.equal(nextDayOk.credited, 200)

  // Persist reload & cloud merge integrity
  const reloaded = saveMod.loadLocalSave(mem).save
  assert(reloaded.economy.claimedSharedEbikeComp.includes('100,200'))
  assert(reloaded.economy.claimedSharedEbikeComp.includes('120,220'))
  assert.equal(reloaded.economy.sharedEbikeCompState.dayKey, localDayKey(nextDayMs))
  assert.equal(reloaded.economy.sharedEbikeCompState.dayCount, 1)

  const cloudCopy = saveMod.cloneSave(reloaded)
  cloudCopy.economy.claimedSharedEbikeComp = ['999,999']
  const merged = saveMod.mergeCloudAndLocalSave(reloaded, cloudCopy, nextDayMs + 1000)
  assert(merged.economy.claimedSharedEbikeComp.includes('100,200'))
  assert(merged.economy.claimedSharedEbikeComp.includes('999,999'))

  // Pure eligibility helper check & 512-entry sanitize cap
  const elig = evaluateSharedEbikeCompEligibility(['a'], 'b', {lastAt: t0, dayKey: localDayKey(t0), dayCount: 1}, t0 + 1000)
  assert.equal(elig.allowed, false)
  assert.equal(elig.reason, 'cooldown')

  const bloated = saveMod.cloneSave(reloaded)
  bloated.economy.claimedSharedEbikeComp = Array.from({length: 600}, (_, i) => `bay_${i}`)
  const sanitizedBloated = saveMod.sanitizeSave(bloated, nextDayMs + 2000).save
  assert.equal(sanitizedBloated.economy.claimedSharedEbikeComp.length, 512)
  assert.equal(sanitizedBloated.economy.claimedSharedEbikeComp[0], 'bay_88')
  assert.equal(sanitizedBloated.economy.claimedSharedEbikeComp[511], 'bay_599')

  off()
})
