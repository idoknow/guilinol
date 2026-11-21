#!/usr/bin/env node
/**
 * Stage 1A (IDOK-122) + Stage 1C (IDOK-124) comprehensive automated verification suite.
 * Compiles pure TypeScript game/walk modules into a temp ESM dir via esbuild (already installed by Vite)
 * and asserts every contract invariant in docs/commerce-shops-spec.md.
 */
import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'

const root = process.cwd()
const tmp = await mkdtemp(path.join(root, '.tmp-commerce-s1-'))
let passed = 0
const failures = []

function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`)
  } else {
    failures.push(`${name}${detail ? `: ${detail}` : ''}`)
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`)
  }
}

class MemoryStorage {
  constructor() { this.map = new Map(); this.failWrite = false }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem(k, v) {
    if (this.failWrite) throw new Error('QuotaExceededError')
    this.map.set(k, String(v))
  }
  removeItem(k) { this.map.delete(k) }
}

try {
  await build({
    entryPoints: [
      path.join(root, 'web/src/game/quiet-zones.ts'),
      path.join(root, 'web/src/game/catalog.ts'),
      path.join(root, 'web/src/game/state.ts'),
      path.join(root, 'web/src/game/commerce.ts'),
      path.join(root, 'web/src/game/shops.ts'),
      path.join(root, 'web/src/walk/interact-arbiter.ts'),
      path.join(root, 'web/src/walk/tuning.ts'),
      path.join(root, 'web/src/walk/ride.ts'),
    ],
    outdir: tmp,
    outbase: path.join(root, 'web/src'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    external: ['three', '@dimforge/rapier3d-compat'],
    splitting: true,
    logLevel: 'silent',
  })

  const quiet = await import(pathToFileURL(path.join(tmp, 'game/quiet-zones.js')).href)
  const catalog = await import(pathToFileURL(path.join(tmp, 'game/catalog.js')).href)
  const state = await import(pathToFileURL(path.join(tmp, 'game/state.js')).href)
  const commerce = await import(pathToFileURL(path.join(tmp, 'game/commerce.js')).href)
  const shops = await import(pathToFileURL(path.join(tmp, 'game/shops.js')).href)
  const arbiter = await import(pathToFileURL(path.join(tmp, 'walk/interact-arbiter.js')).href)
  const tuning = await import(pathToFileURL(path.join(tmp, 'walk/tuning.js')).href)
  const ride = await import(pathToFileURL(path.join(tmp, 'walk/ride.js')).href)

  // 1. Quiet Zones (25 schools + 5m margin)
  check('quiet zones contains exactly 25 Guilin schools', quiet.QUIET_ZONES.length === 25, `count=${quiet.QUIET_ZONES.length}`)
  const ids = new Set(quiet.QUIET_ZONES.map(z => z.id))
  check(
    'quiet zones explicitly includes libin_middle, guilin_middle, glmu_dongcheng & wangcheng_teaching',
    ids.has('libin_middle') && ids.has('guilin_middle') && ids.has('glmu_dongcheng') && ids.has('wangcheng_teaching'),
  )
  check('libin_middle center (-540, 80) is quiet', quiet.isPointInQuietZone(-540, 80) === true)
  check('guilin_middle center (-1250, -350) is quiet', quiet.isPointInQuietZone(-1250, -350) === true)
  check('glmu_dongcheng center (700, -1400) is quiet', quiet.isPointInQuietZone(700, -1400) === true)
  check('wangcheng_teaching inner courtyard (-661, -604) is quiet', quiet.isPointInQuietZone(-661, -604) === true)
  check('duxiu scenic spot (-525, -595) & Zhengyang spawn (-588, -212) stay non-quiet', !quiet.isPointInQuietZone(-525, -595) && !quiet.isPointInQuietZone(-588, -212))

  // 2. Shops Registry & Original Branding
  const apparelShop = shops.SHOP_MAP.get('shop_nikoniko_apparel')
  const ebikeShop = shops.SHOP_MAP.get('shop_shizijie_ebike')
  check(
    'shop registry locks unified original names 漓尚衣坊 & 榕城电行',
    apparelShop?.brandName === '漓尚衣坊' && ebikeShop?.brandName === '榕城电行',
    `${apparelShop?.brandName} / ${ebikeShop?.brandName}`,
  )
  const allShopPointsNonQuiet = [
    apparelShop.triggerPos,
    apparelShop.cameraRig.stagePos,
    ebikeShop.triggerPos,
    ebikeShop.cameraRig.stagePos,
    [ebikeShop.deliveryBay.x, ebikeShop.deliveryBay.y, ebikeShop.deliveryBay.z],
    [ebikeShop.testRideSpawn.x, ebikeShop.testRideSpawn.y, ebikeShop.testRideSpawn.z],
    [ebikeShop.serviceBay.x, ebikeShop.serviceBay.y, ebikeShop.serviceBay.z],
  ].every(([x, , z]) => !quiet.isPointInQuietZone(x, z))
  check('all shop triggers, stages, delivery/testRide/service bays are outside 25 quiet zones', allShopPointsNonQuiet)

  // 3. Save v1 migration, legacy glol.stamps merge, corrupt backup & tamper clamp
  const store = new MemoryStorage()
  state.setSaveStorageForTest(store)
  store.setItem('glol.stamps', JSON.stringify(['elephant', 'crossing']))
  const load1 = state.loadSaveFromStorage(store)
  check(
    'legacy glol.stamps merges losslessly into spotsFound and keeps glol.stamps intact',
    load1.migratedFrom === 'glol.stamps' &&
      state.getState().spotsFound.includes('elephant') &&
      state.getState().spotsFound.includes('crossing') &&
      state.getState().money === 200 &&
      JSON.parse(store.getItem('glol.stamps')).includes('elephant'),
  )

  store.setItem('glol.save.v1', '{broken-json')
  const loadCorrupt = state.loadSaveFromStorage(store)
  check(
    'corrupt glol.save.v1 backs up to glol.save.v1.corrupt and recovers safe default',
    loadCorrupt.corrupted === true &&
      store.getItem('glol.save.v1.corrupt') === '{broken-json' &&
      state.getState().money === 200,
  )

  store.setItem('glol.save.v1', JSON.stringify({
    schemaVersion: 2,
    money: -5000,
    garage: {
      activeVehicleId: 'bike1',
      vehicles: {
        bike1: {id: 'bike1', modelId: 'lijiang_light', batteryPct: 999, durabilityPct: 1, upgrades: {motorLevel: 99, controllerLevel: 99, batteryLevel: 99}},
        'test-ride:xiangshan_gt': {id: 'test-ride:xiangshan_gt', modelId: 'xiangshan_gt', batteryPct: 100, durabilityPct: 100},
      },
    },
  }))
  state.loadSaveFromStorage(store)
  const sanitized = state.getState()
  const b1 = sanitized.garage.vehicles.bike1
  check(
    'tampered save clamps negative money, battery/durability, model upgrade caps & strips test-ride',
    sanitized.money === 0 &&
      b1.batteryPct === 100 &&
      b1.durabilityPct === 15 &&
      b1.upgrades.motorLevel === 1 &&
      b1.upgrades.controllerLevel === 1 &&
      b1.upgrades.batteryLevel === 2 &&
      !sanitized.garage.vehicles['test-ride:xiangshan_gt'],
  )

  // 4. Atomic Commerce: creditReward, outfit piece + partial-set diff, idempotency, rollback
  state.resetStateForTest(200)
  store.map.clear()
  const r1 = commerce.creditReward({source: 'spot_bounty', refId: 'crossing', amount: 120, firstClearOnly: true, idempotencyKey: 'spot_crossing_1'})
  const r2 = commerce.creditReward({source: 'spot_bounty', refId: 'crossing', amount: 120, firstClearOnly: true, idempotencyKey: 'spot_crossing_2'})
  check('spot bounty credits ¥120 once and rejects duplicate claim', r1.ok && r1.balanceAfter === 320 && !r2.ok && r2.code === 'ALREADY_CLAIMED' && state.getState().money === 320)

  const failBuy = commerce.executePurchase({shopId: 'shop_nikoniko_apparel', itemType: 'outfit_preset', itemId: 'outfit_guilin_hoodie', expectedPrice: 480, idempotencyKey: 'buy_fail_1'})
  check('insufficient funds rejects purchase with deficit and 0 balance change', !failBuy.ok && failBuy.code === 'INSUFFICIENT_FUNDS' && failBuy.deficit === 160 && state.getState().money === 320)

  // Buy 1 piece (¥220) then verify partial-set bundle diff quote
  const pieceBuy = commerce.executePurchase({shopId: 'shop_nikoniko_apparel', itemType: 'outfit_item', itemId: 'top_guilin_hoodie', expectedPrice: 220, idempotencyKey: 'piece_1'})
  const pieceReplay = commerce.executePurchase({shopId: 'shop_nikoniko_apparel', itemType: 'outfit_item', itemId: 'top_guilin_hoodie', expectedPrice: 220, idempotencyKey: 'piece_1'})
  const pieceAlready = commerce.executePurchase({shopId: 'shop_nikoniko_apparel', itemType: 'outfit_item', itemId: 'top_guilin_hoodie', expectedPrice: 220, idempotencyKey: 'piece_2'})
  const partialQuote = catalog.computeOutfitPresetQuote('outfit_guilin_hoodie', state.getState().wardrobe.ownedItemIds)
  check(
    'outfit piece buy, idempotent replay, ALREADY_OWNED & partial-set discount all work',
    pieceBuy.ok && pieceBuy.charged === 220 &&
      pieceReplay.code === 'IDEMPOTENT_REPLAY' && pieceReplay.charged === 0 &&
      pieceAlready.code === 'ALREADY_OWNED' && pieceAlready.charged === 0 &&
      partialQuote.price > 0 && partialQuote.price < 480 &&
      state.getState().money === 100,
    `partialPrice=¥${partialQuote.price}`,
  )

  // Storage failure atomic rollback
  commerce.creditReward({source: 'mission_delivery', refId: 'noodle_1', amount: 1800, firstClearOnly: true, idempotencyKey: 'm_noodle_1'})
  const beforeFailMoney = state.getState().money
  store.failWrite = true
  const rollbackBuy = commerce.executePurchase({shopId: 'shop_shizijie_ebike', itemType: 'ebike_model', itemId: 'lijiang_light', expectedPrice: 1800, idempotencyKey: 'ebike_fail_persist'})
  store.failWrite = false
  check(
    'persist failure atomically rolls back money & garage',
    !rollbackBuy.ok && rollbackBuy.code === 'PERSIST_FAILED' &&
      state.getState().money === beforeFailMoney &&
      Object.keys(state.getState().garage.vehicles).length === 0,
  )

  // 5. Personal 3-tier E-bike buy, shared upgrade block, upgrade cap, visual mods & service
  const buyLight = commerce.executePurchase({shopId: 'shop_shizijie_ebike', itemType: 'ebike_model', itemId: 'lijiang_light', expectedPrice: 1800, idempotencyKey: 'ebike_light_1'})
  const vid = buyLight.createdVehicleId
  check('personal lijiang_light purchase succeeds and persists in garage', buyLight.ok && !!vid && state.getState().garage.activeVehicleId === vid)

  const sharedModAttempt = commerce.executePurchase({shopId: 'shop_shizijie_ebike', itemType: 'ebike_upgrade', itemId: 'motor:1', targetVehicleId: 'shared', expectedPrice: 320, idempotencyKey: 'shared_mod_1'})
  const overCapAttempt = commerce.executePurchase({shopId: 'shop_shizijie_ebike', itemType: 'ebike_upgrade', itemId: 'motor:3', targetVehicleId: vid, expectedPrice: 1200, idempotencyKey: 'over_cap_1'})
  const bannedAeroAttempt = commerce.executePurchase({shopId: 'shop_shizijie_ebike', itemType: 'ebike_visual', itemId: 'preset:ghostfire', targetVehicleId: vid, expectedPrice: 580, idempotencyKey: 'banned_aero_1'})
  check(
    'shared upgrade forbidden, model cap enforced & model visual restrictions enforced',
    sharedModAttempt.code === 'SHARED_UPGRADE_FORBIDDEN' &&
      overCapAttempt.code === 'UPGRADE_CAP_EXCEEDED' &&
      bannedAeroAttempt.code === 'VISUAL_NOT_ALLOWED',
  )

  // Service ALREADY_FULL then damaged/low-battery service
  const fullSvc = commerce.executePurchase({shopId: 'shop_shizijie_ebike', itemType: 'ebike_service', itemId: 'full_service', targetVehicleId: vid, expectedPrice: 0, idempotencyKey: 'svc_full_0'})
  state.syncPersonalVehicleTelemetry(vid, {batteryPct: 35, durabilityPct: 50}, true)
  const expectedSvcPrice = catalog.calcFullServiceCost(35, 50)
  const doSvc = commerce.executePurchase({shopId: 'shop_shizijie_ebike', itemType: 'ebike_service', itemId: 'full_service', targetVehicleId: vid, expectedPrice: expectedSvcPrice, idempotencyKey: 'svc_full_1'})
  check(
    'service returns ALREADY_FULL at 100/100 and restores 100/100 atomically when depleted',
    fullSvc.code === 'ALREADY_FULL' && fullSvc.charged === 0 &&
      doSvc.ok && doSvc.charged === expectedSvcPrice &&
      state.getState().garage.vehicles[vid].batteryPct === 100 &&
      state.getState().garage.vehicles[vid].durabilityPct === 100,
    `svcPrice=¥${expectedSvcPrice}`,
  )

  // Shared rental fee + low-balance non-negative guard
  state.resetStateForTest(2)
  const rentLow = commerce.chargeSharedBikeRental('rent_low_1')
  check('shared rental refuses negative balance when money < ¥3', !rentLow.ok && rentLow.code === 'INSUFFICIENT_FUNDS' && state.getState().money === 2)

  // 6. Personal 3-Tier Tuning Speed Caps (<= 50 / 60 / 70 km/h)
  const pLightMax = tuning.resolvePersonalEbikeProfile('lijiang_light', {motorLevel: 3, controllerLevel: 3, batteryLevel: 3})
  const pCityMax = tuning.resolvePersonalEbikeProfile('city_range', {motorLevel: 3, controllerLevel: 3, batteryLevel: 3})
  const pGtMax = tuning.resolvePersonalEbikeProfile('xiangshan_gt', {motorLevel: 3, controllerLevel: 3, batteryLevel: 3})
  check(
    'personal 3-tier speed caps strictly clamp <= 50 / 60 / 70 km/h',
    pLightMax.tierMaxKmh <= 50 && pCityMax.tierMaxKmh <= 60 && pGtMax.tierMaxKmh <= 70 &&
      pLightMax.tierMaxKmh < pCityMax.tierMaxKmh && pCityMax.tierMaxKmh < pGtMax.tierMaxKmh,
    `${pLightMax.tierMaxKmh}/${pCityMax.tierMaxKmh}/${pGtMax.tierMaxKmh} km/h`,
  )

  // 7. Unified [F] Arbiter Priorities
  const nearApparel = {shop: apparelShop, kind: 'shop', distance: 1.8, inReach: true, quietBlocked: false}
  const nearRoadBike = {kind: 'bike', downed: false, distance: 1.5, ownership: 'shared', vehicleType: 'shared'}
  const nearDowned = {kind: 'bike', downed: true, distance: 2.0, ownership: 'shared', vehicleType: 'shared'}

  const dModal = arbiter.resolveInteractDecision({active: true, modalOrShopOpen: true, crashBusy: false, aboard: {car: false, bike: false, freeBoat: false, route: false}, nearbyShop: nearApparel, nearbyVehicle: nearRoadBike, nearbyFreeBoat: null, nearbyRoute: null})
  const dAboard = arbiter.resolveInteractDecision({active: true, modalOrShopOpen: false, crashBusy: false, aboard: {car: false, bike: true, freeBoat: false, route: false}, nearbyShop: nearApparel, nearbyVehicle: null, nearbyFreeBoat: null, nearbyRoute: null})
  const dDowned = arbiter.resolveInteractDecision({active: true, modalOrShopOpen: false, crashBusy: false, aboard: {car: false, bike: false, freeBoat: false, route: false}, nearbyShop: nearApparel, nearbyVehicle: nearDowned, nearbyFreeBoat: null, nearbyRoute: null})
  const dShop = arbiter.resolveInteractDecision({active: true, modalOrShopOpen: false, crashBusy: false, aboard: {car: false, bike: false, freeBoat: false, route: false}, nearbyShop: nearApparel, nearbyVehicle: nearRoadBike, nearbyFreeBoat: null, nearbyRoute: null})
  check(
    '[F] arbiter priority: modal blocks > aboard dismount-only w/ hint > downed pickup > shop suppresses roadside bike',
    dModal.action === 'none' &&
      dAboard.action === 'dismount_bike' && !!dAboard.hintToast &&
      dDowned.action === 'pickup_downed' &&
      dShop.action === 'open_shop' && dShop.label.includes('漓尚衣坊'),
  )

  // 8. IDOK-124 P-gear + E/Q/Digit/Brake Deterministic Recovery
  const ctrl = ride.createBikeControl()
  ctrl.mount(0, 0, 'bike', {vehicleType: 'normal', modelId: 'xiangshan_gt', parkStart: false, drainEnabled: false})
  ctrl.setGear(4) // S gear
  assert.equal(ctrl.gear, 4)
  ctrl.setPark(true, true)
  assert.equal(ctrl.parkLocked, true)
  ctrl.shiftGear(-1) // Q while in P -> stays locked!
  const stayedLockedOnQ = ctrl.parkLocked === true
  ctrl.shiftGear(1) // E from P after S gear -> unlocks into safe D2!
  const recoveredToD2FromS = ctrl.parkLocked === false && ctrl.gear === 2 && ctrl.telemetry().gearLabel === 'D2'

  ctrl.setGear(3) // D3
  ctrl.setPark(true, true)
  ctrl.shiftGear(1) // E from P after D3 -> unlocks into safe D2!
  const recoveredToD2FromD3 = ctrl.parkLocked === false && ctrl.gear === 2 && ctrl.telemetry().gearLabel === 'D2'

  ctrl.setGear(1) // D1
  ctrl.setPark(true, true)
  ctrl.shiftGear(1) // E from P after D1 -> stays D1!
  const stayedD1FromD1 = ctrl.parkLocked === false && ctrl.gear === 1 && ctrl.telemetry().gearLabel === 'D1'

  ctrl.setGear(4)
  ctrl.setPark(true, true)
  ctrl.setGear(4) // Explicit Digit4 -> unlocks into S!
  const explicitDigit4 = ctrl.parkLocked === false && ctrl.gear === 4 && ctrl.telemetry().gearLabel === 'S'

  ctrl.setPark(true, true)
  for (let i = 0; i < 4; i++) ctrl.steer(-1, 0, 0.05, true) // Brake unlock from S -> clamps to D2
  const brakeUnlockClampedD2 = ctrl.parkLocked === false && ctrl.gear === 2 && ctrl.telemetry().gearLabel === 'D2'

  check(
    'IDOK-124 P-gear recovery: Q stays locked; E & brake clamp D3/S->D2, keep D1->D1; Digit4 unlocks to S',
    stayedLockedOnQ && recoveredToD2FromS && recoveredToD2FromD3 && stayedD1FromD1 && explicitDigit4 && brakeUnlockClampedD2,
    JSON.stringify({stayedLockedOnQ, recoveredToD2FromS, recoveredToD2FromD3, stayedD1FromD1, explicitDigit4, brakeUnlockClampedD2}),
  )

  // 9. Static Hygiene & Layout Gates
  const [vmSrc, lookSrc, walkCss, inputGuardSrc, shopUiSrc] = await Promise.all([
    readFile(path.join(root, 'web/src/walk/vehicle-model.ts'), 'utf8'),
    readFile(path.join(root, 'web/src/look/config.ts'), 'utf8'),
    readFile(path.join(root, 'web/src/ui/walk.css'), 'utf8'),
    readFile(path.join(root, 'web/src/walk/input-guard.ts'), 'utf8'),
    readFile(path.join(root, 'web/src/ui/shop-ui.ts'), 'utf8'),
  ])
  check('shared_bike de-branded (0 occurrences of mint 0x72d5b0)', !/72d5b0/i.test(vmSrc) && !/72d5b0/i.test(lookSrc))
  check('landscape mobile .vehicle-action positioned at bottom:calc(82px...) cleanly above 2-row .ride-hud', walkCss.includes('bottom:calc(82px + env(safe-area-inset-bottom))'))
  check('input-guard blocks .shop-overlay.show / data-shop-open', inputGuardSrc.includes('.shop-overlay.show') && inputGuardSrc.includes('shopOpen'))
  check('shop UI introduces 0 new Three.js dynamic lights', !/(SpotLight|PointLight|RectAreaLight)/.test(shopUiSrc))

  console.log(`\nSTAGE 1 COMMERCE & EBIKE CHECK: ${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    console.error('Failures:\n- ' + failures.join('\n- '))
    process.exitCode = 1
  }
} finally {
  await rm(tmp, {recursive: true, force: true})
}
