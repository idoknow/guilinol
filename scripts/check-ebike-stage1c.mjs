#!/usr/bin/env node
/**
 * Stage 1C (IDOK-124) automated verification suite:
 *  - 3-tier personal e-bike tuning & speed caps (<= 50 / 60 / 70 km/h), low-durability scaling (<40% -> 0.9x)
 *  - Deterministic P-gear unlock (Q stays P, E & brake clamp D3/S->D2 & preserve D1, Digit4->S)
 *  - Purchase -> garage persistence -> reload -> upgrades/visuals/telemetry -> service -> shared isolation
 *  - Static redlines: 0x72d5b0 de-branded in BOTH vehicle-model.ts & look/config.ts, bikeCoordStates cleanup,
 *    landscape .vehicle-action CSS, endTestRide crash cleanup, zero new Three.js dynamic lights.
 */
import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'

const root = process.cwd()
const tmp = await mkdtemp(path.join(root, '.tmp-ebike-s1c-'))
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
  constructor() { this.map = new Map() }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem(k, v) { this.map.set(k, String(v)) }
  removeItem(k) { this.map.delete(k) }
}

try {
  await build({
    entryPoints: [
      path.join(root, 'web/src/walk/tuning.ts'),
      path.join(root, 'web/src/walk/ride.ts'),
      path.join(root, 'web/src/game/save.ts'),
      path.join(root, 'web/src/game/state.ts'),
      path.join(root, 'web/src/game/commerce.ts'),
      path.join(root, 'web/src/game/catalog.ts'),
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

  const tuning = await import(pathToFileURL(path.join(tmp, 'walk/tuning.js')).href)
  const ride = await import(pathToFileURL(path.join(tmp, 'walk/ride.js')).href)
  const save = await import(pathToFileURL(path.join(tmp, 'game/save.js')).href)
  const state = await import(pathToFileURL(path.join(tmp, 'game/state.js')).href)
  const commerce = await import(pathToFileURL(path.join(tmp, 'game/commerce.js')).href)
  const catalog = await import(pathToFileURL(path.join(tmp, 'game/catalog.js')).href)

  // 1. 3-tier personal e-bike tuning speed caps & low-durability scaling
  const pLightStock = tuning.resolvePersonalEbikeProfile('lijiang_light', null, 100)
  const pLightMax = tuning.resolvePersonalEbikeProfile('lijiang_light', {motorLevel: 3, controllerLevel: 3, batteryLevel: 3}, 100)
  const pCityMax = tuning.resolvePersonalEbikeProfile('city_range', {motorLevel: 3, controllerLevel: 3, batteryLevel: 3}, 100)
  const pGtMax = tuning.resolvePersonalEbikeProfile('xiangshan_gt', {motorLevel: 3, controllerLevel: 3, batteryLevel: 3}, 100)
  const pGtWorn = tuning.resolvePersonalEbikeProfile('xiangshan_gt', {motorLevel: 3, controllerLevel: 3, batteryLevel: 3}, 30)

  check(
    'personal 3-tier speed caps strictly clamp <= 50 / 60 / 70 km/h',
    pLightStock.tierMaxKmh === 42 &&
      pLightMax.tierMaxKmh <= 50 &&
      pCityMax.tierMaxKmh <= 60 &&
      pGtMax.tierMaxKmh <= 70 &&
      pLightMax.tierMaxKmh < pCityMax.tierMaxKmh &&
      pCityMax.tierMaxKmh < pGtMax.tierMaxKmh,
    `${pLightMax.tierMaxKmh}/${pCityMax.tierMaxKmh}/${pGtMax.tierMaxKmh} km/h`,
  )
  check(
    'personal model upgrade levels clamp to model ceiling & durability <40% scales accel by 0.9x',
    pLightMax.upgrades.motorLevel === 1 &&
      pLightMax.upgrades.controllerLevel === 1 &&
      pLightMax.upgrades.batteryLevel === 2 &&
      Math.abs(pGtWorn.accelMul / pGtMax.accelMul - 0.9) < 1e-6,
    `ratio=${(pGtWorn.accelMul / pGtMax.accelMul).toFixed(3)}`,
  )

  // 2. Deterministic P-gear unlock in ride.ts
  const ctrl = ride.createBikeControl()
  ctrl.mount(0, 0, 'bike', {vehicleType: 'normal', modelId: 'xiangshan_gt', parkStart: false, drainEnabled: false})
  assert.equal(ctrl.profile.tierLabel, '象山疾风电摩')
  ctrl.setGear(4)
  assert.equal(ctrl.gear, 4)
  ctrl.setPark(true, true)
  assert.equal(ctrl.parkLocked, true)
  const qRet = ctrl.shiftGear(-1)
  const stayedLockedOnQ = qRet === 0 && ctrl.parkLocked === true

  ctrl.shiftGear(1)
  const recoveredToD2FromS = ctrl.parkLocked === false && ctrl.gear === 2 && ctrl.telemetry().gearLabel === 'D2'

  ctrl.setGear(3)
  ctrl.setPark(true, true)
  ctrl.shiftGear(1)
  const recoveredToD2FromD3 = ctrl.parkLocked === false && ctrl.gear === 2 && ctrl.telemetry().gearLabel === 'D2'

  ctrl.setGear(1)
  ctrl.setPark(true, true)
  ctrl.shiftGear(1)
  const stayedD1FromD1 = ctrl.parkLocked === false && ctrl.gear === 1 && ctrl.telemetry().gearLabel === 'D1'

  ctrl.setGear(4)
  ctrl.setPark(true, true)
  ctrl.setGear(4)
  const explicitDigit4 = ctrl.parkLocked === false && ctrl.gear === 4 && ctrl.telemetry().gearLabel === 'S'

  ctrl.setPark(true, true)
  for (let i = 0; i < 4; i++) ctrl.steer(-1, 0, 0.05, true)
  const brakeUnlockClampedD2 = ctrl.parkLocked === false && ctrl.gear === 2 && ctrl.telemetry().gearLabel === 'D2'

  ctrl.setVehicleType('shared')
  const sharedResetsModel =
    ctrl.vehicleType === 'shared' &&
    ctrl.profile.allowUpgrades === false &&
    ctrl.profile.allowWheelie === false &&
    ctrl.profile.tierMaxKmh <= 18

  check(
    'P-gear unlock deterministic: Q stays P; E & brake clamp D3/S->D2 & preserve D1; Digit4->S; shared isolates model',
    stayedLockedOnQ &&
      recoveredToD2FromS &&
      recoveredToD2FromD3 &&
      stayedD1FromD1 &&
      explicitDigit4 &&
      brakeUnlockClampedD2 &&
      sharedResetsModel,
    JSON.stringify({stayedLockedOnQ, recoveredToD2FromS, recoveredToD2FromD3, stayedD1FromD1, explicitDigit4, brakeUnlockClampedD2, sharedResetsModel}),
  )

  // 3. Purchase -> Persist -> Reload -> Telemetry -> Service -> Shared Isolation
  const mem = new MemoryStorage()
  globalThis.localStorage = mem
  save.resetSaveForTesting(12000, mem)

  const buy = commerce.executePurchase({
    shopId: 'shop_shizijie_ebike',
    itemType: 'ebike_model',
    itemId: 'city_range',
    expectedPrice: 3600,
    idempotencyKey: 's1c_buy_city_1',
  })
  const vid = buy.createdVehicleId
  assert.ok(buy.ok && vid)

  const upg = commerce.executePurchase({
    shopId: 'shop_shizijie_ebike',
    itemType: 'ebike_upgrade',
    itemId: 'motor:2',
    targetVehicleId: vid,
    expectedPrice: 1200,
    idempotencyKey: 's1c_upg_motor2',
  })
  const vis = commerce.executePurchase({
    shopId: 'shop_shizijie_ebike',
    itemType: 'ebike_visual',
    itemId: 'visual:topbox_delivery',
    targetVehicleId: vid,
    expectedPrice: 450,
    idempotencyKey: 's1c_vis_box',
  })
  const sharedBlocked = commerce.executePurchase({
    shopId: 'shop_shizijie_ebike',
    itemType: 'ebike_upgrade',
    itemId: 'motor:1',
    targetVehicleId: 'shared',
    expectedPrice: 600,
    idempotencyKey: 's1c_shared_deny',
  })
  commerce.updatePersonalVehicleTelemetry(vid, {batteryPct: 40, durabilityPct: 5, deltaOdometerKm: 1.25}, true)

  // Reload from storage to prove durability floor (15%) & mods persist cleanly across reload
  save.reloadSaveFromStorage()
  const reloaded = state.getState().garage.vehicles[vid]
  check(
    'personal e-bike purchase, mods, visual, telemetry & durability floor (>=15%) survive reload; shared mod denied',
    upg.ok &&
      vis.ok &&
      !sharedBlocked.ok &&
      reloaded?.modelId === 'city_range' &&
      reloaded?.upgrades.motorLevel === 2 &&
      reloaded?.visual.topbox === 'delivery' &&
      reloaded?.batteryPct === 40 &&
      reloaded?.durabilityPct === 15 &&
      reloaded?.odometerKm >= 1.25,
    `bat=${reloaded?.batteryPct} dur=${reloaded?.durabilityPct} odo=${reloaded?.odometerKm}`,
  )

  // Service restore
  const svcPrice = catalog.calcFullServiceCost(reloaded.batteryPct, reloaded.durabilityPct)
  const svcRes = commerce.executePurchase({
    shopId: 'shop_shizijie_ebike',
    itemType: 'ebike_service',
    itemId: 'full_service',
    targetVehicleId: vid,
    expectedPrice: svcPrice,
    idempotencyKey: 's1c_svc_1',
  })
  const svcAlreadyFull = commerce.executePurchase({
    shopId: 'shop_shizijie_ebike',
    itemType: 'ebike_service',
    itemId: 'full_service',
    targetVehicleId: vid,
    expectedPrice: 0,
    idempotencyKey: 's1c_svc_2',
  })
  check(
    'service restores 100/100 and guards repeat ALREADY_FULL',
    svcRes.ok &&
      svcPrice <= 100 &&
      state.getState().garage.vehicles[vid].batteryPct === 100 &&
      state.getState().garage.vehicles[vid].durabilityPct === 100 &&
      svcAlreadyFull.code === 'ALREADY_FULL',
    `svcPrice=¥${svcPrice}`,
  )

  // Shared ride unlock v1 atomic fee: strictly reject < ¥2 (never negative, never free), deduct ¥2 once when >= ¥2
  save.resetSaveForTesting(1, mem)
  const deniedUnlock = commerce.unlockSharedEbike({sessionKey: 's1c_low_bal'})
  const lowFee = commerce.chargeSharedRideFee('s1c_low_bal_legacy')
  save.resetSaveForTesting(5, mem)
  const paidUnlock = commerce.unlockSharedEbike({sessionKey: 's1c_paid_bal'})
  const paidReplay = commerce.unlockSharedEbike({sessionKey: 's1c_paid_bal'})
  check(
    'shared ride v1 blocks < ¥2 strictly, atomically deducts ¥2 once when >= ¥2, and preserves idempotency',
    !deniedUnlock.ok &&
      deniedUnlock.code === 'INSUFFICIENT_FUNDS' &&
      lowFee.fallbackFree === false &&
      lowFee.charged === 0 &&
      paidUnlock.ok &&
      paidUnlock.charged === 2 &&
      paidReplay.code === 'IDEMPOTENT_REPLAY' &&
      paidReplay.charged === 0 &&
      state.getState().money === 3,
  )

  // 4. Static redline & hygiene checks
  const [vmSrc, lookSrc, walkCss, vehiclesSrc, walkIdxSrc] = await Promise.all([
    readFile(path.join(root, 'web/src/walk/vehicle-model.ts'), 'utf8'),
    readFile(path.join(root, 'web/src/look/config.ts'), 'utf8'),
    readFile(path.join(root, 'web/src/ui/walk.css'), 'utf8'),
    readFile(path.join(root, 'web/src/walk/vehicles.ts'), 'utf8'),
    readFile(path.join(root, 'web/src/walk/index.ts'), 'utf8'),
  ])

  check(
    'shared e-bike de-branded: 0 occurrences of 0x72d5b0 and slate 0x5e7680 applied in BOTH vehicle-model.ts & look/config.ts',
    !/72d5b0/i.test(vmSrc) && !/72d5b0/i.test(lookSrc) && /5e7680/i.test(vmSrc) && /5e7680/i.test(lookSrc),
  )
  check(
    'vehicles.ts detachMeshFromCells cleans cells, bikeStates & bikeCoordStates and preserves dataset.ebikeTier',
    vehiclesSrc.includes('bikeCoordStates.delete') &&
      vehiclesSrc.includes('bikeStates.delete(mesh)') &&
      vehiclesSrc.includes('mesh.parent?.remove(mesh)') &&
      vehiclesSrc.includes('button.dataset.ebikeTier'),
  )
  check(
    'walk/index.ts clears crashSession before endTestRide and wires personal crash damage + delivery modelId',
    walkIdxSrc.includes('crashSession=null') &&
      walkIdxSrc.includes('rides.applyPersonalCrashDamage') &&
      walkIdxSrc.includes('modelId:rides.bikeModelId??undefined'),
  )
  check(
    'walk.css landscape mobile .vehicle-action avoids center character & .ride-hud',
    walkCss.includes('bottom:calc(82px + env(safe-area-inset-bottom))') &&
      walkCss.includes('left:calc(50% - 32px)'),
  )
  check(
    '0 new Three.js dynamic lights added in Stage 1C files',
    !/(SpotLight|PointLight|RectAreaLight)/.test(vehiclesSrc) &&
      !/(SpotLight|PointLight|RectAreaLight)/.test(walkIdxSrc),
  )

  console.log(`\nSTAGE 1C EBIKE CHECK: ${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    console.error('Failures:\n- ' + failures.join('\n- '))
    process.exitCode = 1
  }
} finally {
  await rm(tmp, {recursive: true, force: true})
}
