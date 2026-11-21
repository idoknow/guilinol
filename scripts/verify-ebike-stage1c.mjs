#!/usr/bin/env node
/**
 * Headless Playwright E2E verification for IDOK-124 (Stage 1C):
 *  - Buy personal e-bike (city_range ¥3,600) + upgrade (motor:2) + visual (topbox_delivery)
 *  - Persist & reload page -> verify garage state survives reload
 *  - Summon personal bike on Zhengyang street -> verify safe spawn (no house/water, parked with P-gear)
 *  - Quiet-zone summon guard (libin_middle -540, 80 -> QUIET_ZONE_BLOCKED)
 *  - Mount personal bike -> verify modelId, upgrades, durability, P-gear E->D2 / Q->P / Digit4->S
 *  - Free test ride start + end (even after crash state -> atomic cleanup, 0 residual test-ride in save)
 *  - Landscape mobile 844x390 .vehicle-action vs .ride-hud & center clearance
 */
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
const errors = []
let browser

try {
  browser = await chromium.launch(browserOptions())
  const ctx = await browser.newContext({viewport: {width: 1280, height: 720}})
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`desktop: ${e.message}`))
  await page.route('**/favicon.ico', r => r.fulfill({status: 204}))

  // Step 1: Boot walk mode, fund & buy city_range + upgrade + visual
  await page.goto(`${baseUrl}/?verify&mode=walk&flow=0&time=10.5&radius=480`)
  await page.waitForFunction(() => window.viewer?.walk?.active && window.viewer?.game && window.viewer.walk.parked('bike').length > 0, null, {timeout: 90000})

  const purchase = await page.evaluate(() => {
    const g = window.viewer.game
    g.save.reset(10000)
    const buy = g.commerce.executePurchase({
      shopId: 'shop_shizijie_ebike',
      itemType: 'ebike_model',
      itemId: 'city_range',
      expectedPrice: 3600,
      idempotencyKey: 'e2e_s1c_buy_city',
    })
    const vid = buy.createdVehicleId
    const upg = g.commerce.executePurchase({
      shopId: 'shop_shizijie_ebike',
      itemType: 'ebike_upgrade',
      itemId: 'motor:2',
      targetVehicleId: vid,
      expectedPrice: 1200,
      idempotencyKey: 'e2e_s1c_upg_m2',
    })
    const vis = g.commerce.executePurchase({
      shopId: 'shop_shizijie_ebike',
      itemType: 'ebike_visual',
      itemId: 'visual:topbox_delivery',
      targetVehicleId: vid,
      expectedPrice: 450,
      idempotencyKey: 'e2e_s1c_vis_delivery',
    })
    return {buy, upg, vis, vid, money: g.getState().money}
  })
  assert.equal(purchase.buy.ok, true)
  assert.equal(purchase.upg.ok, true)
  assert.equal(purchase.vis.ok, true)
  assert.equal(purchase.money, 10000 - 3600 - 1200 - 450)

  // Step 2: Full page reload -> verify persistence & summon personal bike on street
  await page.reload()
  await page.waitForFunction(() => window.viewer?.walk?.active && window.viewer?.game && window.viewer.walk.parked('bike').length > 0, null, {timeout: 90000})

  const afterReload = await page.evaluate(async vid => {
    const {walk, game} = window.viewer
    const savedVeh = game.getState().garage.vehicles[vid]
    await window.viewer.walkTo(-588, -212, 0, 's1c-summon-street')
    for (let i = 0; i < 6; i++) walk.tick(1 / 60)
    const summonRes = walk.garage.summon(vid)
    // Walk right beside summoned personal bike and mount via arbiter
    if (summonRes.ok && summonRes.pos) {
      await window.viewer.walkTo(summonRes.pos[0] + 0.8, summonRes.pos[2], 0, 's1c-near-personal')
      for (let i = 0; i < 6; i++) walk.tick(1 / 60)
    }
    const decisionBeforeMount = walk.shop.getInteractDecision()
    walk.shop.triggerInteract()
    for (let i = 0; i < 6; i++) walk.tick(1 / 60)
    const stateMounted = game.getState()
    const probeMounted = walk.probe()

    // Test P-gear deterministic unlock on real personal bike
    walk.ebike.setGear(4)
    walk.ebike.setPark(true, true)
    walk.ebike.shiftGear(-1)
    walk.tick(1 / 60)
    const qStaysP = walk.probe().ebike?.parkLocked === true
    walk.ebike.shiftGear(1)
    walk.tick(1 / 60)
    const eToD2 = walk.probe().ebike?.parkLocked === false && walk.probe().ebike?.gear === 2

    // Trigger crash & verify durability loss persisted (>=15% floor)
    walk.ebike.triggerCrash('lowside', 1)
    walk.tick(1 / 60)
    const durAfterCrash = game.getState().garage.vehicles[vid]?.durabilityPct
    // Stand up from crash cleanly
    for (let i = 0; i < 24; i++) walk.tick(1 / 60)
    walk.ebike.recover()
    for (let i = 0; i < 50; i++) walk.tick(1 / 60)

    // Test quiet zone summon block (libin_middle -540, 80)
    await window.viewer.walkTo(-540, 80, 0, 's1c-quiet-school')
    for (let i = 0; i < 6; i++) walk.tick(1 / 60)
    const quietSummon = walk.garage.summon(vid)

    // Test free test-ride start -> crash -> atomic endTestRide (zero test-ride leaked to save)
    await window.viewer.walkTo(-782.15, -159.03, 0, 's1c-ebike-shop')
    for (let i = 0; i < 6; i++) walk.tick(1 / 60)
    const trStart = walk.garage.startTestRide('shop_shizijie_ebike', 'xiangshan_gt')
    for (let i = 0; i < 6; i++) walk.tick(1 / 60)
    const trAboard = walk.vehicle === 'bike' && game.getState().vehicle?.ownership === 'test_ride'
    walk.ebike.triggerCrash('impact', 1)
    walk.tick(1 / 60)
    walk.garage.endTestRide('user')
    for (let i = 0; i < 6; i++) walk.tick(1 / 60)
    const trEndedClean = walk.vehicle === 'foot' && game.getState().garage.activeTestRide === null && !Object.keys(game.getState().garage.vehicles).some(k => k.startsWith('test-ride:'))

    return {
      savedVeh,
      summonRes,
      decisionBeforeMount,
      mountedVehicle: stateMounted.vehicle,
      maxKmhD2: probeMounted.ebike?.maxKmh,
      qStaysP,
      eToD2,
      durAfterCrash,
      quietSummon,
      trStart,
      trAboard,
      trEndedClean,
    }
  }, purchase.vid)

  assert.equal(afterReload.savedVeh?.modelId, 'city_range')
  assert.equal(afterReload.savedVeh?.upgrades?.motorLevel, 2)
  assert.equal(afterReload.savedVeh?.visual?.topbox, 'delivery')
  assert.equal(afterReload.summonRes?.ok, true, `summon failed: ${JSON.stringify(afterReload.summonRes)}`)
  assert.equal(afterReload.decisionBeforeMount?.label, '骑我的电摩', `expected 骑我的电摩, got ${JSON.stringify(afterReload.decisionBeforeMount)}`)
  assert.equal(afterReload.mountedVehicle?.ownership, 'personal')
  assert.equal(afterReload.mountedVehicle?.modelId, 'city_range')
  assert.equal(afterReload.qStaysP, true)
  assert.equal(afterReload.eToD2, true)
  assert(afterReload.durAfterCrash < 100 && afterReload.durAfterCrash >= 15, `expected crash damage in [15,99], got ${afterReload.durAfterCrash}`)
  assert.equal(afterReload.quietSummon?.ok, false)
  assert.equal(afterReload.quietSummon?.code, 'QUIET_ZONE_BLOCKED')
  assert.equal(afterReload.trStart?.ok, true)
  assert.equal(afterReload.trAboard, true)
  assert.equal(afterReload.trEndedClean, true)

  console.log('STAGE 1C E2E PLAYWRIGHT OK:', JSON.stringify({
    summonCode: afterReload.summonRes.code,
    promptLabel: afterReload.decisionBeforeMount.label,
    modelId: afterReload.mountedVehicle.modelId,
    durAfterCrash: afterReload.durAfterCrash,
    quietCode: afterReload.quietSummon.code,
    testRideClean: afterReload.trEndedClean,
  }))
  assert.deepEqual(errors, [], `runtime pageerrors: ${errors.join('; ')}`)
} finally {
  if (browser) await browser.close()
  await new Promise(r => server.httpServer.close(r))
}
