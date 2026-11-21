/**
 * Comprehensive deterministic Node unit + integration test suite for Stage 1A (IDOK-122):
 *  1. Unified state machine (`web/src/game/state.ts`) — plan-2.md baseline + incremental fields + events
 *  2. Backward-compatible save engine (`web/src/game/save.ts`) — v1 -> v2 upgrade, `glol.stamps` migration & dual-write,
 *     corrupt JSON backup (`glol.save.v1.corrupt`), tamper clamping (negative money, motorLevel 99 <= 70 km/h),
 *     `activeTestRide` never serialized, QuotaExceededError trim-to-16 retry & rollback, cloud/local lossless merge
 *  3. Atomic commerce & anti-farm reward engine (`web/src/game/commerce.ts` + `catalog.ts`) —
 *     0-yuan / insufficient funds + deficit / 10x rapid clicks dedup (`IN_FLIGHT` / `IDEMPOTENT_REPLAY`) /
 *     `PRICE_MISMATCH` / `ALREADY_OWNED` (charged=0) / `SHARED_UPGRADE_FORBIDDEN` / `UPGRADE_CAP_EXCEEDED` /
 *     `ALREADY_FULL` / `PERSIST_FAILED` zero dirty memory / `creditReward` `ALREADY_CLAIMED` & `missionHistory`
 *  4. Universal shop registry & 24 campus quiet zones (`shops.ts` + `quiet-zones.ts`) —
 *     `libin_middle`, `guilin_middle`, `glmu_dongcheng` + 21 `schoolGround` schools + 5m gate buffer vs shops
 *  5. 7-level `[F]` interaction arbiter (`interact-arbiter.ts`) & `input-guard.ts` overlay guards
 *  6. Real SQLite execution check of `migrations/0001_auth.sql`..`0005_feedback_chat.sql` + `0006_player_saves.sql`
 */
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {build} from 'esbuild'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'

const dir = await mkdtemp(join(tmpdir(), 'glol-commerce-'))
const gameOut = join(dir, 'game.mjs')
const arbiterOut = join(dir, 'arbiter.mjs')
const guardOut = join(dir, 'guard.mjs')

function createMemoryStorage(opts = {}) {
  const map = new Map()
  let quotaFailCount = opts.quotaFailCount ?? 0
  let hardFail = opts.hardFail ?? false
  return {
    map,
    setQuotaFailCount(n) { quotaFailCount = n },
    setHardFail(on) { hardFail = on },
    getItem(k) { return map.has(k) ? map.get(k) : null },
    setItem(k, v) {
      if (hardFail) throw new Error('disk_io_error')
      if (quotaFailCount > 0) {
        quotaFailCount--
        const err = new Error('Quota exceeded')
        err.name = 'QuotaExceededError'
        throw err
      }
      map.set(k, String(v))
    },
    removeItem(k) { map.delete(k) },
  }
}

try {
  await Promise.all([
    build({entryPoints: ['web/src/game/index.ts'], outfile: gameOut, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent'}),
    build({entryPoints: ['web/src/walk/interact-arbiter.ts'], outfile: arbiterOut, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent'}),
    build({entryPoints: ['web/src/walk/input-guard.ts'], outfile: guardOut, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent'}),
  ])

  const game = await import(pathToFileURL(gameOut).href)
  const arbiter = await import(pathToFileURL(arbiterOut).href)
  const guard = await import(pathToFileURL(guardOut).href)

  let passed = 0
  async function test(name, fn) {
    await fn()
    passed++
    console.log(`  ok   ${name}`)
  }

  // --- 1. Unified State Machine & plan-2.md Baseline Compatibility ---
  test('state.ts preserves plan-2.md 6 top-level fields, onState/onEvent/emit, and updateTravel', () => {
    const store = createMemoryStorage()
    game.setSaveStorageForTest(store)
    game._resetGameStateForTest()
    game.loadLocalSave(store)

    const s0 = game.getState()
    assert.equal(s0.mode, 'fly')
    assert.equal(s0.vehicle, null)
    assert.equal(s0.money, 200)
    assert.equal(s0.wanted, 0)
    assert.equal(s0.mission, null)
    assert.equal(s0.zone.quiet, false)
    assert.equal(s0.wardrobe.equipped.top, 'top_default_tee')
    assert.equal(s0.wardrobe.autoHelmetOnRide, true)
    assert.equal(s0.garage.activeVehicleId, null)

    const seenChanged = []
    const offState = game.onState((_, changed) => seenChanged.push([...changed]))
    const seenEvents = []
    const offEvent = game.onEvent(e => seenEvents.push(e))

    game.updateTravel('ebike', {kind: 'ebike', id: 'eb1', speedKmh: 25, gear: 'D', damage: 0}, {quiet: true, name: '桂林中学'})
    assert.equal(game.getState().mode, 'ebike')
    assert.equal(game.getState().vehicle.speedKmh, 25)
    assert.equal(game.getState().zone.quiet, true)
    assert.equal(game.getState().zone.name, '桂林中学')
    assert(seenChanged.some(c => c.includes('mode') && c.includes('vehicle') && c.includes('zone')))

    game.emit({type: 'mission:start', id: 'noodle_1', title: '米粉外卖'})
    assert.equal(seenEvents.length, 1)
    assert.equal(seenEvents[0].type, 'mission:start')
    offState()
    offEvent()
  })

  // --- 2. Save Migration (v1 -> v2, glol.stamps), Corrupt Backup & Anti-Tamper Sanitization ---
  test('glol.save.v1 loads legacy v1 schema + merges glol.stamps non-destructively without silent cash', () => {
    const store = createMemoryStorage()
    store.setItem('glol.stamps', JSON.stringify(['elephant', 'crossing', 'bogus_id']))
    store.setItem(
      'glol.save.v1',
      JSON.stringify({
        money: 950,
        owned: ['lijiang_light', 'future_taxi'],
        spotsFound: ['pagodas'],
        missionsDone: ['errand_1'],
        updatedAt: 1732000000000,
      }),
    )
    game.setSaveStorageForTest(store)
    game._resetGameStateForTest()
    const res = game.loadLocalSave(store)
    assert.equal(res.source, 'local')
    assert.equal(res.save.schemaVersion, 2)
    assert.equal(res.save.money, 950)
    assert.deepEqual(new Set(res.save.spotsFound), new Set(['pagodas', 'elephant', 'crossing']))
    assert.equal(res.save.economy.claimedSpotBounties.length, 0, 'legacy stamps must not auto-inject cash')
    assert.equal(store.getItem('glol.stamps'), JSON.stringify(['elephant', 'crossing', 'bogus_id']), 'old key preserved')
    const vehicles = Object.values(res.save.garage.vehicles)
    assert.equal(vehicles.length, 1)
    assert.equal(vehicles[0].modelId, 'lijiang_light')
    assert(res.save.owned.includes('lijiang_light') && res.save.owned.includes('future_taxi'))
  })

  test('corrupt JSON backs up raw payload to glol.save.v1.corrupt and resets safe defaults', () => {
    const store = createMemoryStorage()
    store.setItem('glol.save.v1', '{not valid json!!!')
    game.setSaveStorageForTest(store)
    game._resetGameStateForTest()
    const res = game.loadLocalSave(store)
    assert.equal(res.source, 'default')
    assert.equal(res.corruptBackedUp, true)
    assert.equal(store.getItem('glol.save.v1.corrupt'), '{not valid json!!!')
    assert.equal(game.getState().money, 200)
  })

  test('tampered localStorage (negative money, motorLevel 99, invalid outfit, test-ride bike) clamps cleanly', () => {
    const store = createMemoryStorage()
    store.setItem(
      'glol.save.v1',
      JSON.stringify({
        schemaVersion: 2,
        money: -99999,
        owned: ['lijiang_light'],
        spotsFound: [],
        missionsDone: [],
        updatedAt: 1732000000000,
        wardrobe: {
          ownedItemIds: ['top_default_tee'],
          ownedPresetIds: [],
          equipped: {top: 'top_night_moto', bottom: 'unknown_pants', shoes: 'shoes_default_sneaker', hat: 'hat_none', bag: 'bag_none'},
          autoHelmetOnRide: true,
        },
        garage: {
          activeVehicleId: 'v1',
          vehicles: {
            v1: {
              id: 'v1',
              modelId: 'lijiang_light',
              purchasedAt: 1732000000000,
              batteryPct: 180,
              durabilityPct: -50,
              odometerKm: -12,
              upgrades: {motorLevel: 99, controllerLevel: 99, batteryLevel: 99},
              visual: {preset: 'stock'},
            },
            'test-ride:xiangshan_gt': {
              id: 'test-ride:xiangshan_gt',
              modelId: 'xiangshan_gt',
              purchasedAt: 1732000000000,
              batteryPct: 100,
              durabilityPct: 100,
              odometerKm: 0,
              upgrades: {motorLevel: 3, controllerLevel: 3, batteryLevel: 3},
              visual: {preset: 'neon'},
            },
          },
        },
      }),
    )
    game.setSaveStorageForTest(store)
    game._resetGameStateForTest()
    const res = game.loadLocalSave(store)
    assert.equal(res.save.money, 0)
    assert.equal(res.save.wardrobe.equipped.top, 'top_default_tee', 'unowned item falls back to starter')
    assert.equal(res.save.wardrobe.equipped.bottom, 'bottom_default_pants')
    assert.equal(Object.keys(res.save.garage.vehicles).length, 1, 'test-ride instance stripped')
    const bike = res.save.garage.vehicles.v1
    assert.equal(bike.batteryPct, 100)
    assert.equal(bike.durabilityPct, 0)
    assert.equal(bike.odometerKm, 0)
    assert.deepEqual(bike.upgrades, {motorLevel: 1, controllerLevel: 1, batteryLevel: 2})
    const profile = game.resolvePersonalEbikeProfile(bike.modelId, {motorLevel: 99, controllerLevel: 99, batteryLevel: 99})
    assert(profile.tierMaxKmh <= 50, `lijiang_light must clamp <= 50 km/h, got ${profile.tierMaxKmh}`)
    const gtProfile = game.resolvePersonalEbikeProfile('xiangshan_gt', {motorLevel: 99, controllerLevel: 99, batteryLevel: 99})
    assert(gtProfile.tierMaxKmh <= 70, `xiangshan_gt must clamp <= 70 km/h, got ${gtProfile.tierMaxKmh}`)
  })

  // --- 3. Atomic Purchase & Reward Anti-Farm Engine ---
  test('executePurchase enforces insufficient funds, 0-yuan, 10x dedup, price mismatch, already-owned & rollback', () => {
    const store = createMemoryStorage()
    game.setSaveStorageForTest(store)
    game._resetGameStateForTest()
    game.loadLocalSave(store) // starts at ¥200

    // Insufficient funds (T1 preset ¥480 vs ¥200 -> deficit ¥280)
    const noMoney = game.executePurchase({
      shopId: 'shop_nikoniko_apparel',
      itemType: 'outfit_preset',
      itemId: 'outfit_guilin_hoodie',
      expectedPrice: 480,
      idempotencyKey: 'buy_t1_poor',
    })
    assert.equal(noMoney.ok, false)
    assert.equal(noMoney.code, 'INSUFFICIENT_FUNDS')
    assert.equal(noMoney.charged, 0)
    assert.equal(noMoney.deficit, 280)
    assert.equal(game.getState().money, 200)

    // Stale UI price mismatch
    const stale = game.executePurchase({
      shopId: 'shop_nikoniko_apparel',
      itemType: 'outfit_preset',
      itemId: 'outfit_guilin_hoodie',
      expectedPrice: 1,
      idempotencyKey: 'buy_t1_stale',
    })
    assert.equal(stale.ok, false)
    assert.equal(stale.code, 'PRICE_MISMATCH')
    assert.equal(stale.expectedPrice, 480)

    // Credit rewards: 1 errand (¥180) + 1 noodle (¥300) = +¥480 -> balance ¥680
    const r1 = game.creditReward({source: 'mission_errand', refId: 'errand_1', amount: 180, firstClearOnly: true, idempotencyKey: 'rew_e1'})
    assert.equal(r1.ok, true)
    assert.equal(r1.balanceAfter, 380)
    // Duplicate firstClear claim blocked
    const r1Dup = game.creditReward({source: 'mission_errand', refId: 'errand_1', amount: 180, firstClearOnly: true, idempotencyKey: 'rew_e1_2'})
    assert.equal(r1Dup.ok, false)
    assert.equal(r1Dup.code, 'ALREADY_CLAIMED')
    // Spot bounty claimed once + dual-written to glol.stamps
    const sb1 = game.creditReward({source: 'spot_bounty', refId: 'crossing', amount: 120, idempotencyKey: 'spot_crossing_1'})
    assert.equal(sb1.ok, true)
    assert.equal(sb1.balanceAfter, 500)
    assert(JSON.parse(store.getItem('glol.stamps')).includes('crossing'))
    const sb1Dup = game.creditReward({source: 'spot_bounty', refId: 'crossing', amount: 120, idempotencyKey: 'spot_crossing_2'})
    assert.equal(sb1Dup.ok, false)
    assert.equal(sb1Dup.code, 'ALREADY_CLAIMED')

    // In-flight synchronous lock blocks re-entry
    const lockedRes = game._withInFlightLockForTest('outfit_preset:outfit_guilin_hoodie:', () =>
      game.executePurchase({
        shopId: 'shop_nikoniko_apparel',
        itemType: 'outfit_preset',
        itemId: 'outfit_guilin_hoodie',
        expectedPrice: 480,
        idempotencyKey: 'buy_t1_locked',
      }),
    )
    assert.equal(lockedRes.ok, false)
    assert.equal(lockedRes.code, 'IN_FLIGHT')

    // 10 rapid double-clicks with same idempotencyKey charge ONLY ONCE
    const results = []
    for (let i = 0; i < 10; i++) {
      results.push(
        game.executePurchase({
          shopId: 'shop_nikoniko_apparel',
          itemType: 'outfit_preset',
          itemId: 'outfit_guilin_hoodie',
          expectedPrice: 480,
          idempotencyKey: 'buy_t1_click_burst',
        }),
      )
    }
    assert.equal(results[0].ok, true)
    assert.equal(results[0].code, 'OK')
    assert.equal(results[0].charged, 480)
    assert.equal(results[0].balanceAfter, 20)
    for (let i = 1; i < 10; i++) {
      assert.equal(results[i].ok, true)
      assert.equal(results[i].code, 'IDEMPOTENT_REPLAY')
      assert.equal(results[i].charged, 0)
    }
    assert.equal(game.getState().money, 20)

    // New idempotency key for already-owned preset returns ALREADY_OWNED & charged=0
    const rebuy = game.executePurchase({
      shopId: 'shop_nikoniko_apparel',
      itemType: 'outfit_preset',
      itemId: 'outfit_guilin_hoodie',
      expectedPrice: 480,
      idempotencyKey: 'buy_t1_again',
    })
    assert.equal(rebuy.ok, true)
    assert.equal(rebuy.code, 'ALREADY_OWNED')
    assert.equal(rebuy.charged, 0)

    // 0-yuan item (free default preset already owned -> ALREADY_OWNED; slow_charge on drained bike -> OK charged 0)
    game.creditReward({source: 'mission_delivery', refId: 'noodle_bonus', amount: 10000, idempotencyKey: 'fund_test_bikes'})
    const buyBike = game.executePurchase({
      shopId: 'shop_shizijie_ebike',
      itemType: 'ebike_model',
      itemId: 'lijiang_light',
      expectedPrice: 1800,
      idempotencyKey: 'buy_lijiang_light',
    })
    assert.equal(buyBike.ok, true)
    assert.equal(buyBike.charged, 1800)
    assert(buyBike.createdVehicleId)
    const bikeId = buyBike.createdVehicleId

    // Shared vehicle upgrade forbidden
    const sharedMod = game.executePurchase({
      shopId: 'shop_shizijie_ebike',
      itemType: 'ebike_upgrade',
      itemId: 'motor:1',
      targetVehicleId: 'shared:street_01',
      expectedPrice: 600,
      idempotencyKey: 'mod_shared_fail',
    })
    assert.equal(sharedMod.ok, false)
    assert.equal(sharedMod.code, 'SHARED_UPGRADE_FORBIDDEN')

    // Exceeding lijiang_light motor cap (max Lv1 -> motor:2 rejected)
    const overCap = game.executePurchase({
      shopId: 'shop_shizijie_ebike',
      itemType: 'ebike_upgrade',
      itemId: 'motor:2',
      targetVehicleId: bikeId,
      expectedPrice: 1200,
      idempotencyKey: 'mod_over_cap',
    })
    assert.equal(overCap.ok, false)
    assert.equal(overCap.code, 'UPGRADE_CAP_EXCEEDED')

    // Service ALREADY_FULL on fresh 100% bike
    const fullSvc = game.executePurchase({
      shopId: 'shop_shizijie_ebike',
      itemType: 'ebike_service',
      itemId: 'fast_charge',
      targetVehicleId: bikeId,
      expectedPrice: 20,
      idempotencyKey: 'svc_already_full',
    })
    assert.equal(fullSvc.ok, true)
    assert.equal(fullSvc.code, 'ALREADY_FULL')
    assert.equal(fullSvc.charged, 0)

    // Drain battery & damage durability -> 0-yuan slow_charge works, then ¥20 fast_charge & ¥80 full_repair work
    game.updatePersonalVehicleTelemetry(bikeId, {batteryPct: 30, durabilityPct: 50}, true)
    const slowCharge = game.executePurchase({
      shopId: 'shop_shizijie_ebike',
      itemType: 'ebike_service',
      itemId: 'slow_charge',
      targetVehicleId: bikeId,
      expectedPrice: 0,
      idempotencyKey: 'svc_slow_free',
    })
    assert.equal(slowCharge.ok, true)
    assert.equal(slowCharge.charged, 0)
    assert.equal(game.getState().garage.vehicles[bikeId].batteryPct, 80)

    const fastCharge = game.executePurchase({
      shopId: 'shop_shizijie_ebike',
      itemType: 'ebike_service',
      itemId: 'fast_charge',
      targetVehicleId: bikeId,
      expectedPrice: 20,
      idempotencyKey: 'svc_fast_20',
    })
    assert.equal(fastCharge.ok, true)
    assert.equal(fastCharge.charged, 20)
    assert.equal(game.getState().garage.vehicles[bikeId].batteryPct, 100)

    const repair = game.executePurchase({
      shopId: 'shop_shizijie_ebike',
      itemType: 'ebike_service',
      itemId: 'full_repair',
      targetVehicleId: bikeId,
      expectedPrice: 80,
      idempotencyKey: 'svc_repair_80',
    })
    assert.equal(repair.ok, true)
    assert.equal(repair.charged, 80)
    assert.equal(game.getState().garage.vehicles[bikeId].durabilityPct, 100)

    // QuotaExceededError first failure trims ring & succeeds; double failure rolls back memory cleanly!
    const balBeforeQuota = game.getState().money
    store.setQuotaFailCount(1)
    const retryOk = game.executePurchase({
      shopId: 'shop_shizijie_ebike',
      itemType: 'ebike_upgrade',
      itemId: 'motor:1',
      targetVehicleId: bikeId,
      expectedPrice: 600,
      idempotencyKey: 'quota_retry_ok',
    })
    assert.equal(retryOk.ok, true)
    assert.equal(game.getState().money, balBeforeQuota - 600)

    const balBeforeRollback = game.getState().money
    store.setQuotaFailCount(2)
    const rollbackRes = game.executePurchase({
      shopId: 'shop_shizijie_ebike',
      itemType: 'ebike_model',
      itemId: 'city_range',
      expectedPrice: 3600,
      idempotencyKey: 'quota_hard_fail',
    })
    assert.equal(rollbackRes.ok, false)
    assert.equal(rollbackRes.code, 'PERSIST_FAILED')
    assert.equal(game.getState().money, balBeforeRollback, 'memory balance must not mutate on persist failure')
    assert.equal(
      Object.values(game.getState().garage.vehicles).some(v => v.modelId === 'city_range'),
      false,
      'unpersisted vehicle must not leak into memory',
    )
    store.setQuotaFailCount(0)
  })

  test('cloud/local save merge performs lossless set union + keeps higher vehicle upgrades + validates 64 KiB cap', () => {
    const local = game.createDefaultSave(2000)
    local.money = 1200
    local.spotsFound = ['elephant', 'crossing']
    local.wardrobe.ownedItemIds.push('top_guilin_hoodie')
    local.garage.vehicles.v_local = {
      id: 'v_local',
      modelId: 'lijiang_light',
      purchasedAt: 1000,
      batteryPct: 80,
      durabilityPct: 90,
      odometerKm: 12.5,
      upgrades: {motorLevel: 1, controllerLevel: 0, batteryLevel: 1},
      visual: game.createDefaultVisualForModel('lijiang_light'),
    }

    const cloud = game.createDefaultSave(1500)
    cloud.money = 900
    cloud.spotsFound = ['pagodas', 'crossing']
    cloud.wardrobe.ownedItemIds.push('top_linen_shirt')
    cloud.economy.txHistoryRing.push({
      txId: 'tx_cloud_only_reward',
      idempotencyKey: 'k_cloud_rew',
      kind: 'reward',
      delta: 180,
      balanceAfter: 900,
      refId: 'errand_1',
      at: 1400,
    })
    cloud.garage.vehicles.v_cloud = {
      id: 'v_cloud',
      modelId: 'lijiang_light',
      purchasedAt: 900,
      batteryPct: 95,
      durabilityPct: 100,
      odometerKm: 2,
      upgrades: {motorLevel: 0, controllerLevel: 0, batteryLevel: 0},
      visual: game.createDefaultVisualForModel('lijiang_light'),
    }

    const merged = game.mergeCloudAndLocalSave(local, cloud, 3000)
    assert.deepEqual(new Set(merged.spotsFound), new Set(['elephant', 'crossing', 'pagodas']))
    assert(merged.wardrobe.ownedItemIds.includes('top_guilin_hoodie'))
    assert(merged.wardrobe.ownedItemIds.includes('top_linen_shirt'))
    assert.equal(Object.keys(merged.garage.vehicles).length, 1)
    assert.equal(merged.garage.vehicles.v_local.upgrades.motorLevel, 1)
    assert.equal(merged.money, 1380)
    assert.equal(game.validateCloudPayload(merged).ok, true)
  })

  // --- 4. Shop Registry & 25 Campus Quiet Zones ---
  test('quiet zones cover all 25 campuses (incl. libin_middle, guilin_middle, glmu_dongcheng, wangcheng_teaching) + 5m buffer; shops & duxiu public plaza outside', () => {
    assert.equal(game.QUIET_ZONES.length, 25)
    const ids = new Set(game.QUIET_ZONES.map(z => z.id))
    assert(ids.has('libin_middle'), 'libin_middle must be in QUIET_ZONES')
    assert(ids.has('guilin_middle'), 'guilin_middle must be in QUIET_ZONES')
    assert(ids.has('glmu_dongcheng'), 'glmu_dongcheng must be in QUIET_ZONES')
    assert(ids.has('wangcheng_teaching'), 'wangcheng_teaching inner courtyard must be in QUIET_ZONES')

    // Inside libin_middle, guilin_middle, and wangcheng_teaching inner courtyard
    assert.equal(game.isPointInQuietZone(-540, 80), true)
    assert.equal(game.isPointInQuietZone(-1260, -350), true)
    assert.equal(game.isPointInQuietZone(-661.6, -604.6), true)
    // Duxiu Peak public trail (-525, -595) and Zhengyang Gate public plaza remain open
    assert.equal(game.isPointInQuietZone(-525, -595), false)
    assert.equal(game.isPointInQuietZone(-565, -455), false)

    // Registered shops have locked canonical names & pass quietCheck
    const apparel = game.getShop('shop_nikoniko_apparel')
    const ebike = game.getShop('shop_shizijie_ebike')
    assert.equal(apparel?.displayName, '漓尚服饰 · 微笑堂店')
    assert.equal(ebike?.displayName, '漓行电驴行 · 十字街总店')
    assert.equal(game.isPointInQuietZone(apparel.triggerPos[0], apparel.triggerPos[2]), false)
    assert.equal(game.isPointInQuietZone(ebike.triggerPos[0], ebike.triggerPos[2]), false)
    assert.equal(game.isPointInQuietZone(ebike.deliveryBay.x, ebike.deliveryBay.z), false)
    assert.equal(game.isPointInQuietZone(ebike.testRideSpawn.x, ebike.testRideSpawn.z), false)
    assert.equal(game.isPointInQuietZone(ebike.serviceBay.x, ebike.serviceBay.z), false)

    // Registering a shop inside a quiet zone throws
    assert.throws(() =>
      game.registerShop({
        ...apparel,
        shopId: 'shop_illegal_campus',
        triggerPos: [-540, 151.5, 80],
      }),
    )
  })

  // --- 5. 7-Level [F] Interaction Arbiter & Input Guard ---
  test('interact-arbiter enforces strict 7-level priority short-circuit (modal > lock > aboard > downed > shop > vehicle > boat)', () => {
    const base = {
      active: true,
      modalOrOverlayBlocked: false,
      crashed: false,
      standingUp: false,
      pickingUpKind: null,
      aboardKind: null,
      inQuietZone: false,
      nearDownedVehicle: null,
      nearShop: {shopId: 'shop_nikoniko_apparel', brandName: '漓尚服饰', displayName: '漓尚服饰 · 微笑堂店', distance: 1.8},
      nearServiceBay: null,
      nearVehicle: {kind: 'bike', downed: false, distance: 2.0, ownership: 'shared', ebikeTier: 'shared'},
      nearBoat: {kind: 'free_boat', label: '划竹筏 · 解放桥', distance: 3.0},
    }

    // Priority 0: Shop/modal open blocks F completely
    const p0 = arbiter.resolveInteraction({...base, modalOrOverlayBlocked: true})
    assert.equal(p0.priority, 0)
    assert.equal(p0.action, 'none')
    assert.equal(p0.label, '')

    // Priority 1: Crash / standup / pickup lock
    const p1 = arbiter.resolveInteraction({...base, pickingUpKind: 'bike'})
    assert.equal(p1.priority, 1)
    assert.equal(p1.action, 'pickup_busy')
    assert.equal(p1.disabled, true)

    // Priority 2: Riding at shop entrance ONLY dismounts + returns soft hint, NEVER opens shop
    const p2 = arbiter.resolveInteraction({...base, aboardKind: 'bike'})
    assert.equal(p2.priority, 2)
    assert.equal(p2.action, 'dismount')
    assert.equal(p2.label, '下车')
    assert.equal(p2.softHint, '先按 F 下车再进店')

    // Priority 3: Downed bike near shop doorway takes priority over shop
    const p3 = arbiter.resolveInteraction({
      ...base,
      nearDownedVehicle: {kind: 'bike', downed: true, distance: 2.1},
    })
    assert.equal(p3.priority, 3)
    assert.equal(p3.action, 'pickup_downed')
    assert.equal(p3.label, '扶起电动车')

    // Priority 4: On foot in shop trigger suppresses shared vehicle parked 2.0m away!
    const p4 = arbiter.resolveInteraction(base)
    assert.equal(p4.priority, 4)
    assert.equal(p4.action, 'open_shop')
    assert.equal(p4.shopId, 'shop_nikoniko_apparel')
    assert.equal(p4.label, '进店 · 漓尚服饰')

    // Quiet zone blocks shop trigger -> falls through to vehicle mount (Priority 5)
    const p4Quiet = arbiter.resolveInteraction({...base, inQuietZone: true})
    assert.equal(p4Quiet.priority, 5)
    assert.equal(p4Quiet.action, 'mount_vehicle')

    // Priority 5: Personal bike displays '骑我的电摩', roadside bike keeps legacy '骑电动车'
    const p5Personal = arbiter.resolveInteraction({
      ...base,
      nearShop: null,
      nearVehicle: {kind: 'bike', downed: false, distance: 2.2, ownership: 'personal', ebikeTier: 'normal'},
    })
    assert.equal(p5Personal.priority, 5)
    assert.equal(p5Personal.label, '骑我的电摩')

    const p5Shared = arbiter.resolveInteraction({...base, nearShop: null})
    assert.equal(p5Shared.priority, 5)
    assert.equal(p5Shared.label, '骑电动车')

    // Priority 6: Water dock fallback
    const p6 = arbiter.resolveInteraction({...base, nearShop: null, nearVehicle: null})
    assert.equal(p6.priority, 6)
    assert.equal(p6.action, 'board_boat')
  })

  test('input-guard blocks global hotkeys & touch camera drag when shop/wardrobe/garage overlay is open', () => {
    const mockDoc = {
      body: {
        dataset: {shopOpen: '1'},
        hasAttribute: () => false,
      },
      querySelector: sel => (sel.includes('.shop-overlay.show') ? {} : null),
    }
    assert.equal(guard.isShopOverlayOpen(mockDoc), true)
    assert.equal(guard.isModalOrOverlayOpen(mockDoc), true)
    assert.equal(guard.isGlobalHotkeyBlocked(null, {doc: mockDoc}), true)

    const mockTarget = {
      closest: sel => (sel.includes('.shop-overlay') ? {} : null),
    }
    assert.equal(
      guard.isTouchInControlZone({
        clientX: 200,
        clientY: 200,
        innerWidth: 390,
        innerHeight: 844,
        panelVisible: false,
        photoOn: false,
        aboard: false,
        target: mockTarget,
      }),
      true,
    )
  })

  // --- 6. SQL Migration Compatibility (0001..0006 in real SQLite) ---
  test('migrations/0006_player_saves.sql applies cleanly atop 0001..0005 in SQLite & enforces unique idempotency + cascade', () => {
    const sqlFiles = [
      'migrations/0001_auth.sql',
      'migrations/0002_feedback.sql',
      'migrations/0003_admin.sql',
      'migrations/0004_feedback_view.sql',
      'migrations/0005_feedback_chat.sql',
      'migrations/0006_player_saves.sql',
    ]
    const pyCheck = `
import sqlite3, sys
conn = sqlite3.connect(':memory:')
conn.execute('PRAGMA foreign_keys = ON')
for path in sys.argv[1:]:
    conn.executescript(open(path, encoding='utf-8').read())
conn.execute("INSERT INTO users(id,email,nickname,salt,digest) VALUES('u1','a@b.c','Tester','s','d')")
conn.execute("INSERT INTO player_saves(user_id,schema_version,revision,payload_json,client_updated_at,updated_at) VALUES('u1',2,1,'{}',100,100)")
conn.execute("INSERT INTO player_ledger_txns(tx_id,user_id,idempotency_key,kind,delta,balance_after,ref_id,created_at) VALUES('t1','u1','idem1','purchase',-480,20,'outfit',100)")
try:
    conn.execute("INSERT INTO player_ledger_txns(tx_id,user_id,idempotency_key,kind,delta,balance_after,ref_id,created_at) VALUES('t2','u1','idem1','purchase',-480,20,'outfit',101)")
    raise AssertionError('duplicate idempotency_key should fail')
except sqlite3.IntegrityError:
    pass
conn.execute("DELETE FROM users WHERE id='u1'")
assert conn.execute("SELECT count(*) FROM player_saves").fetchone()[0] == 0
assert conn.execute("SELECT count(*) FROM player_ledger_txns").fetchone()[0] == 0
print('SQLITE_OK')
`
    const out = execFileSync('python3', ['-c', pyCheck, ...sqlFiles], {encoding: 'utf8'}).trim()
    assert.equal(out, 'SQLITE_OK')
  })

  // --- 7. Verify zero private KeyF listener remains in vehicles.ts ---
  await test('vehicles.ts no longer attaches a private window KeyF listener', async () => {
    const src = await readFile('web/src/walk/vehicles.ts', 'utf8')
    assert.equal(src.includes("event.code==='KeyF'"), false, 'private KeyF listener must be removed from vehicles.ts')
  })

  console.log(`\nALL ${passed} COMMERCE FOUNDATION CHECKS PASSED`)
} finally {
  await rm(dir, {recursive: true, force: true})
}
