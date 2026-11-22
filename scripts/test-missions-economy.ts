import assert from 'node:assert/strict'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length() { return this.map.size }
  clear() { this.map.clear() }
  getItem(key: string) { return this.map.get(key) ?? null }
  key(index: number) { return [...this.map.keys()][index] ?? null }
  removeItem(key: string) { this.map.delete(key) }
  setItem(key: string, value: string) { this.map.set(key, String(value)) }
}

const memStorage = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', {value: memStorage, configurable: true})

const {QUIET_ZONES, findQuietZoneAt, isPointInQuietZones} = await import('../web/src/game/quiet-zones')
const {getCarFreeAt,vehicleForbiddenAt} = await import('../web/src/game/car-free')
const {MISSIONS, auditMissionsAgainstQuietZones} = await import('../web/src/missions')
const catalog = await import('../web/src/game/catalog')
const saveMod = await import('../web/src/game/save')
const stateMod = await import('../web/src/game/state')
const commerce = await import('../web/src/game/commerce')
const {MissionRunnerEngine} = await import('../web/src/game/missions')

// ---------------------------------------------------------------------------
// 1. Quiet Zones & Static Mission Audit (all 25 Guilin campuses + 5m buffer)
// ---------------------------------------------------------------------------
assert.equal(QUIET_ZONES.length, 25, `expected 25 quiet zones, got ${QUIET_ZONES.length}`)
assert.ok(QUIET_ZONES.some(z => z.id === 'libin_middle'), 'libin_middle must be included')
assert.ok(QUIET_ZONES.some(z => z.id === 'guilin_middle'), 'guilin_middle must be included')
assert.ok(QUIET_ZONES.some(z => z.id === 'glmu_dongcheng'), 'glmu_dongcheng must be included')
assert.ok(QUIET_ZONES.some(z => z.id === 'wangcheng_teaching'), 'wangcheng_teaching inner zone must be included')

const violations = auditMissionsAgainstQuietZones()
assert.deepEqual(violations, [], `mission quiet violations: ${JSON.stringify(violations)}`)

assert.equal(isPointInQuietZones(-541, 76), true, 'libin_middle interior must be quiet')
assert.equal(findQuietZoneAt(-541, 76)?.id, 'libin_middle')
assert.equal(isPointInQuietZones(-1231, -370), true, 'guilin_middle interior must be quiet')
assert.equal(findQuietZoneAt(-1231, -370)?.id, 'guilin_middle')
assert.equal(isPointInQuietZones(690, -1400), true, 'glmu_dongcheng interior must be quiet')
assert.equal(findQuietZoneAt(690, -1400)?.id, 'glmu_dongcheng')
assert.equal(isPointInQuietZones(-666, -605), true, 'wangcheng_teaching courtyard must be quiet')
assert.equal(findQuietZoneAt(-666, -565.6)?.id, 'wangcheng_teaching', '5m outward gate buffer must block 3m outside southern border (-568.6)')
assert.equal(isPointInQuietZones(-588, -212), false, 'wangcheng spawn plaza must NOT be quiet')
assert.equal(isPointInQuietZones(-525, -595), false, 'duxiu public spot must NOT be quiet')
console.log('[OK] 1. Quiet zones (25/25) & static mission JSON audit (0 violations)')

// ---------------------------------------------------------------------------
// 2. Save v1/v2 Migration, Legacy Stamps Idempotency & Corrupt Recovery
// ---------------------------------------------------------------------------
memStorage.clear()
memStorage.setItem(saveMod.LEGACY_STAMPS_KEY, JSON.stringify(['duxiu', 'elephant']))
saveMod.reloadSaveFromStorage()
assert.deepEqual(stateMod.getState().spotsFound, ['duxiu', 'elephant'], 'legacy stamps imported to spotsFound')
assert.equal(stateMod.getState().money, 200, 'boot migration must NEVER silently pay money')
assert.equal(saveMod.getActiveSaveSnapshot().saveMeta.migratedLegacyStamps, true)

// Reload again: money remains 200, no duplicate payout
saveMod.reloadSaveFromStorage()
assert.equal(stateMod.getState().money, 200)

// Spot bounty claim: pays ¥120 once, then ALREADY_CLAIMED forever
const spotRes1 = commerce.claimSpotBounty('duxiu')
assert.equal(spotRes1.ok, true)
assert.equal(spotRes1.credited, 120)
assert.equal(spotRes1.balanceAfter, 320)
const spotRes2 = commerce.claimSpotBounty('duxiu')
assert.equal(spotRes2.ok, false)
assert.equal(spotRes2.code, 'ALREADY_CLAIMED')
assert.equal(stateMod.getState().money, 320)

// Corrupt save triggers backup & safe reset
memStorage.setItem(saveMod.SAVE_STORAGE_KEY, '{not_valid_json!!!')
saveMod.reloadSaveFromStorage()
assert.equal(stateMod.getState().money, 200)
assert.equal(memStorage.getItem(saveMod.SAVE_CORRUPT_BACKUP_KEY), '{not_valid_json!!!')

// v1 legacy schema migration (with owned + spotsClaimed + firstClearClaimed)
memStorage.clear()
memStorage.setItem(saveMod.SAVE_STORAGE_KEY, JSON.stringify({
  money: 520,
  owned: ['lijiang_light'],
  spotsFound: ['elephant'],
  missionsDone: ['errand-01'],
  spotsClaimed: ['elephant'],
  firstClearClaimed: ['errand-01'],
  updatedAt: 123456,
}))
saveMod.reloadSaveFromStorage()
assert.equal(stateMod.getState().money, 520)
assert.equal(Object.values(saveMod.getActiveSaveSnapshot().garage.vehicles)[0]?.modelId, 'lijiang_light')
assert.equal(commerce.claimSpotBounty('elephant').code, 'ALREADY_CLAIMED')
assert.equal(commerce.hasClaimedMissionFirstClear('errand-01'), true)

// Value bounds clamping
const clamped = saveMod.sanitizeSave({
  schemaVersion: 2,
  money: -99999,
  garage: {
    activeVehicleId: 'v1',
    vehicles: {
      v1: {id: 'v1', modelId: 'lijiang_light', batteryPct: 250, durabilityPct: -40, upgrades: {motorLevel: 99, controllerLevel: -1, batteryLevel: 8}},
    },
  },
})
assert.equal(clamped.save.money, 0)
assert.equal(clamped.save.garage.vehicles.v1.batteryPct, 100)
assert.equal(clamped.save.garage.vehicles.v1.durabilityPct, 0)
assert.equal(clamped.save.garage.vehicles.v1.upgrades.motorLevel, 1, 'lijiang_light motor capped at 1')
assert.equal(clamped.save.garage.vehicles.v1.upgrades.batteryLevel, 2, 'lijiang_light battery capped at 2')
console.log('[OK] 2. Save migration, legacy stamps idempotency, corrupt backup & bounds clamp')

// ---------------------------------------------------------------------------
// 3. Locked Commerce Pricing, Idempotency & Progression Curve
// ---------------------------------------------------------------------------
assert.equal(catalog.DEFAULT_START_MONEY, 200)
assert.equal(commerce.SPOT_BOUNTY_YUAN, 120)
assert.equal(commerce.SHARED_EBIKE_FEE_YUAN, 3)
assert.equal(commerce.SHARED_EBIKE_FREE_SECONDS, 120)
assert.equal(catalog.OUTFIT_PRESETS_BY_ID.outfit_guilin_hoodie.price, 480)
assert.equal(catalog.OUTFIT_PRESETS_BY_ID.outfit_rider_vest.price, 960)
assert.equal(catalog.OUTFIT_PRESETS_BY_ID.outfit_guochao_pankou.price, 1680)
assert.equal(catalog.PERSONAL_EBIKE_MODELS.lijiang_light.price, 1800)
assert.equal(catalog.PERSONAL_EBIKE_MODELS.city_range.price, 3600)
assert.equal(catalog.PERSONAL_EBIKE_MODELS.xiangshan_gt.price, 6800)
assert.equal(catalog.EBIKE_SERVICE_CATALOG.fast_charge.fixedPrice, 20)
assert.equal(catalog.EBIKE_SERVICE_CATALOG.full_repair.fixedPrice, 80)

saveMod.resetSaveForTesting(200)
const mismatch = commerce.executePurchase({
  shopId: 'shop_nikoniko_apparel',
  itemType: 'outfit_preset',
  itemId: 'outfit_guilin_hoodie',
  expectedPrice: 1,
  idempotencyKey: 'buy_tamper',
})
assert.equal(mismatch.code, 'PRICE_MISMATCH')
assert.equal(stateMod.getState().money, 200)

const poor = commerce.executePurchase({
  shopId: 'shop_nikoniko_apparel',
  itemType: 'outfit_preset',
  itemId: 'outfit_guilin_hoodie',
  expectedPrice: 480,
  idempotencyKey: 'buy_poor',
})
assert.equal(poor.code, 'INSUFFICIENT_FUNDS')
assert.equal(poor.deficit, 280)

const sharedUpgrade = commerce.executePurchase({
  shopId: 'shop_shizijie_ebike',
  itemType: 'ebike_upgrade',
  itemId: 'motor:1',
  targetVehicleId: 'shared_ebike',
  expectedPrice: 600,
  idempotencyKey: 'buy_shared_mod',
})
assert.equal(sharedUpgrade.code, 'SHARED_UPGRADE_FORBIDDEN')

// Simulate economic curve: start ¥200 -> 1 errand (¥180) + 1 noodle (¥300) = ¥680 (>= ¥480 T1 outfit in 2 runs!)
const runner = new MissionRunnerEngine()
const runMissionToEnd = (missionId: string, opts?: {freezeMidway?: boolean}) => {
  const def = MISSIONS.find(m => m.id === missionId)!
  const startRes = runner.start(missionId, {x: -588, z: -212})
  assert.equal(startRes.ok, true, `start ${missionId}`)
  for (let i = 0; i < def.steps.length; i++) {
    const st = def.steps[i]
    if (opts?.freezeMidway && i === 0) {
      stateMod.setActiveShopState({shopId: 'shop_nikoniko_apparel', kind: 'clothing', openedAt: Date.now()})
      const before = runner.getSnapshot().timerRemaining
      runner.step({dt: 0.1, x: -588, z: -212, mode: 'foot', speedMs: 0, braking: false, parkLocked: false, crashPhase: 'none'})
      runner.step({dt: 0.1, x: -588, z: -212, mode: 'foot', speedMs: 0, braking: false, parkLocked: false, crashPhase: 'none'})
      assert.equal(runner.getSnapshot().timerRemaining, before, 'timer must freeze when activeShop != null')
      stateMod.setActiveShopState(null)
    }
    runner.step({
      dt: 0.05,
      x: st.at[0],
      z: st.at[1],
      mode: missionId === 'errand-01' ? 'foot' : 'ebike',
      speedMs: 5,
      braking: false,
      parkLocked: false,
      crashPhase: 'none',
    })
  }
}

for(const [x,z] of [[-588,-212],[-578,-206]]){
  assert.equal(getCarFreeAt(x,z),'东西巷');assert.ok(vehicleForbiddenAt(x,z));assert.equal(findQuietZoneAt(x,z),null)
}
assert.equal(getCarFreeAt(-632.2,46.9),'正阳步行街')
runMissionToEnd('errand-01')
assert.equal(stateMod.getState().money, 380, '200 + 180 first clear')
runMissionToEnd('noodle-01', {freezeMidway: true})
assert.equal(stateMod.getState().money, 680, '380 + 300 full soup noodle-01 => affords T1 ¥480 in 2 missions')

// Buy T1 outfit + verify idempotency replay & already-owned guard
const buyT1 = commerce.executePurchase({
  shopId: 'shop_nikoniko_apparel',
  itemType: 'outfit_preset',
  itemId: 'outfit_guilin_hoodie',
  expectedPrice: 480,
  idempotencyKey: 'buy_t1_1',
})
assert.equal(buyT1.ok, true)
assert.equal(buyT1.charged, 480)
assert.equal(buyT1.balanceAfter, 200)
assert.equal(stateMod.getState().wardrobe.equipped.top, 'top_guilin_hoodie')

const replayT1 = commerce.executePurchase({
  shopId: 'shop_nikoniko_apparel',
  itemType: 'outfit_preset',
  itemId: 'outfit_guilin_hoodie',
  expectedPrice: 480,
  idempotencyKey: 'buy_t1_1',
})
assert.equal(replayT1.code, 'IDEMPOTENT_REPLAY')
assert.equal(replayT1.charged, 0)

const dupT1 = commerce.executePurchase({
  shopId: 'shop_nikoniko_apparel',
  itemType: 'outfit_preset',
  itemId: 'outfit_guilin_hoodie',
  expectedPrice: 480,
  idempotencyKey: 'buy_t1_2',
})
assert.equal(dupT1.code, 'ALREADY_OWNED')
assert.equal(dupT1.charged, 0)

// Repeat clear payout check (anti-farming): errand-01 repeat pays ¥80, not ¥180
runMissionToEnd('errand-01')
assert.equal(stateMod.getState().money, 280, 'repeat errand-01 must pay ¥80 (44.4%), not full ¥180')
assert.equal(saveMod.getActiveSaveSnapshot().economy.missionHistory['errand-01'].count, 2)

// Continue earning to verify 5~8 missions buys first personal ebike (¥1,800):
runMissionToEnd('errand-02') // +220 => 500
runMissionToEnd('noodle-02') // +400 => 900
runMissionToEnd('noodle-03') // +520 => 1420
commerce.claimSpotBounty('duxiu') // +120 => 1540
commerce.claimSpotBounty('elephant') // +120 => 1660
runMissionToEnd('noodle-01') // repeat +180 => 1840
assert.ok(stateMod.getState().money >= 1800, `expected >= 1800 in ~6 runs+spots, got ${stateMod.getState().money}`)

const buyEbike = commerce.executePurchase({
  shopId: 'shop_shizijie_ebike',
  itemType: 'ebike_model',
  itemId: 'lijiang_light',
  expectedPrice: 1800,
  idempotencyKey: 'buy_first_ebike',
})
assert.equal(buyEbike.ok, true)
assert.ok(buyEbike.createdVehicleId)
assert.equal(
  commerce.executePurchase({
    shopId: 'shop_shizijie_ebike',
    itemType: 'ebike_upgrade',
    itemId: 'motor:2',
    targetVehicleId: buyEbike.createdVehicleId,
    expectedPrice: 1200,
    idempotencyKey: 'mod_cap_test',
  }).code,
  'UPGRADE_CAP_EXCEEDED',
)
console.log('[OK] 3. Commerce pricing, idempotency, anti-farming & progression curve (2-3 runs T1, 6 runs first bike)')

// ---------------------------------------------------------------------------
// 4. MissionRunnerEngine: Quiet Gate, Crash Edge-Trigger, Cooldown, Freeze, Cleanup
// ---------------------------------------------------------------------------
saveMod.resetSaveForTesting(200)
const mRunner = new MissionRunnerEngine()

// Cannot accept mission inside school quiet zone
assert.equal(mRunner.start('noodle-01', {x: -541, z: 76}).reason, 'QUIET_ZONE_BLOCKED')

// Accept noodle-01 outside quiet zone
assert.equal(mRunner.start('noodle-01', {x: -588, z: -212}).ok, true)

// Move to pickup step first
const n1 = MISSIONS.find(m => m.id === 'noodle-01')!
mRunner.step({dt: 0.05, x: n1.steps[0].at[0], z: n1.steps[0].at[1], mode: 'ebike', speedMs: 4, braking: false, parkLocked: false, crashPhase: 'none'})
assert.equal(mRunner.getSnapshot().stepIndex, 1)

// Establish prevSpeed = 9 m/s while cruising upright, wait out initial 0.85s brake cooldown
for (let i = 0; i < 12; i++) {
  mRunner.step({dt: 0.1, x: -588, z: -212, mode: 'ebike', speedMs: 9, braking: false, parkLocked: false, crashPhase: 'none'})
}
assert.equal(mRunner.getSnapshot().soup, 1.0, 'smooth cruising keeps soup at 1.0')

// Hard brake 9 -> 1 m/s in 0.1s (decel 80 m/s^2) triggers single -10% deduction
mRunner.step({dt: 0.1, x: -588, z: -212, mode: 'ebike', speedMs: 1, braking: true, parkLocked: false, crashPhase: 'none'})
assert.equal(mRunner.getSnapshot().soup, 0.9, 'hard brake deducts 10%')

// Second hard brake within 0.85s cooldown must NOT stack
mRunner.step({dt: 0.1, x: -588, z: -212, mode: 'ebike', speedMs: 9, braking: false, parkLocked: false, crashPhase: 'none'})
mRunner.step({dt: 0.1, x: -588, z: -212, mode: 'ebike', speedMs: 0, braking: true, parkLocked: false, crashPhase: 'none'})
assert.equal(mRunner.getSnapshot().soup, 0.9, 'brake within 0.85s cooldown must not stack')

// Edge-triggered crash: 20 frames of crash + standup + pickup MUST only deduct ONE -25% (0.9 -> 0.65)
for (let i = 0; i < 10; i++) {
  mRunner.step({dt: 0.05, x: -588, z: -212, mode: 'ebike', speedMs: i === 0 ? 12 : 0, braking: true, parkLocked: false, crashPhase: 'crashed'})
}
for (let i = 0; i < 10; i++) {
  mRunner.step({dt: 0.05, x: -588, z: -212, mode: 'ebike', speedMs: 0, braking: false, parkLocked: false, crashPhase: i < 5 ? 'standing_up' : 'picking_up'})
}
assert.equal(mRunner.getSnapshot().soup, 0.65, 'crash recovery animation must NOT per-frame drain soup')

// Timer freeze checks (P gear & fly)
const timerBeforeFreeze = mRunner.getSnapshot().timerRemaining!
for (let i = 0; i < 10; i++) {
  mRunner.step({dt: 0.1, x: -588, z: -212, mode: 'ebike', speedMs: 0, braking: false, parkLocked: true, crashPhase: 'none'})
}
assert.equal(mRunner.getSnapshot().timerRemaining, timerBeforeFreeze, 'P gear freezes non-race timer')
for (let i = 0; i < 10; i++) {
  mRunner.step({dt: 0.1, x: -588, z: -212, mode: 'fly', speedMs: 25, braking: false, parkLocked: false, crashPhase: 'none'})
}
assert.equal(mRunner.getSnapshot().timerRemaining, timerBeforeFreeze, 'fly mode freezes non-race timer')

// Car/boat deceleration must NOT trigger bike soup spill
mRunner.step({dt: 0.1, x: -588, z: -212, mode: 'car', speedMs: 15, braking: false, parkLocked: false, crashPhase: 'none'})
mRunner.step({dt: 0.1, x: -588, z: -212, mode: 'car', speedMs: 0, braking: true, parkLocked: false, crashPhase: 'none'})
assert.equal(mRunner.getSnapshot().soup, 0.65, 'car braking does not trigger ebike soup spill')

// Single-exit abandon clears state.mission cleanly & allows immediate re-accept
assert.equal(mRunner.abandon(), true)
assert.equal(stateMod.getState().mission, null)
assert.equal(mRunner.start('noodle-01', {x: -588, z: -212}).ok, true)

// Timeout failure clears state.mission cleanly and allows re-accept
for (let i = 0; i < 2000; i++) {
  if (!stateMod.getState().mission) break
  mRunner.step({dt: 0.1, x: -588, z: -212, mode: 'foot', speedMs: 0, braking: false, parkLocked: false, crashPhase: 'none'})
}
assert.equal(stateMod.getState().mission, null, 'timeout conclude() clears mission HUD state')
assert.equal(mRunner.getSnapshot().lastOutcome?.outcome, 'failed')
assert.equal(mRunner.start('noodle-01', {x: -588, z: -212}).ok, true, 'can cleanly re-accept after timeout')

// Payout scaling with city_range delivery box (25% less brake spill)
saveMod.resetSaveForTesting(4000)
const buyDeliveryBike = commerce.executePurchase({
  shopId: 'shop_shizijie_ebike',
  itemType: 'ebike_model',
  itemId: 'city_range',
  expectedPrice: 3600,
  idempotencyKey: 'buy_city_range',
})
assert.equal(buyDeliveryBike.ok, true)
stateMod.updateTravel('ebike', {
  kind: 'ebike',
  id: buyDeliveryBike.createdVehicleId!,
  speedKmh: 0,
  damage: 0,
  ownership: 'personal',
  modelId: 'city_range',
})
mRunner.abandon()
mRunner.start('noodle-01', {x: -588, z: -212})
for (let i = 0; i < 10; i++) {
  mRunner.step({dt: 0.1, x: -588, z: -212, mode: 'ebike', speedMs: 9, braking: false, parkLocked: false, crashPhase: 'none'})
}
mRunner.step({dt: 0.1, x: -588, z: -212, mode: 'ebike', speedMs: 1, braking: true, parkLocked: false, crashPhase: 'none'})
assert.equal(mRunner.getSnapshot().soup, 0.925, 'city_range delivery box reduces 10% spill by 25% -> 7.5%')

// Shared ride fee when < ¥3 triggers free fallback instead of negative balance
saveMod.resetSaveForTesting(2)
const feeRes = commerce.chargeSharedRideFee('test_session_1')
assert.equal(feeRes.fallbackFree, true)
assert.equal(feeRes.charged, 0)
assert.equal(stateMod.getState().money, 2)

console.log('[OK] 4. MissionRunnerEngine state machine, soup protection, timer freeze & cleanup')
// Exercise the full catalog through the production runner and wallet.
for (const line of ['taxi', 'race']) {
  const orders = MISSIONS.filter(def => def.line === line)
  assert.equal(orders.length, 3)
  for (const def of orders) {
    const runner = new MissionRunnerEngine()
    const frame = {dt: 0.1, speedMs: 20, braking: false, parkLocked: false, crashPhase: 'none', mode: 'car'} as const
    const balance = stateMod.getState().money
    assert.equal(runner.start(def.id, {x: def.giver[0], z: def.giver[1]}).ok, true)
    for (const [index, step] of def.steps.entries()) {
      const [x, z] = step.at
      assert.equal(vehicleForbiddenAt(x, z), false, `${def.id} step ${index} must allow cars`)
      runner.step({...frame, x, z, mode: 'foot'})
      runner.step({...frame, x, z, frozen: true})
      assert.equal(runner.getSnapshot().stepIndex, index)
      if (index === 1) {
        const [lastX, lastZ] = def.steps.length > 2 ? def.steps[def.steps.length - 1].at : def.giver
        for (let tick = 0; tick < 100; tick++) runner.step({...frame, x: lastX, z: lastZ})
        assert.equal(runner.getSnapshot().stepIndex, index, 'later stop cannot skip current target')
      }
      runner.step({...frame, x, z})
    }
    const result = runner.getSnapshot().lastOutcome
    assert.equal(result?.outcome, 'completed')
    // Ten seconds at 20 m/s add ¥16 in distance and ¥1 in time.
    const payout = def.reward + (line === 'taxi' ? 17 : 0)
    assert.equal(result?.payout, payout)
    saveMod.reloadSaveFromStorage()
    assert.equal(stateMod.getState().money, balance + payout)
    if (line === 'race') assert.ok(result!.elapsedSeconds! > 10)
  }
}
console.log('[OK] 5. All six driving orders, vehicle access, ordered gates, taximeter, race time & saved payouts')
console.log('ALL MISSION & ECONOMY TESTS PASSED')
