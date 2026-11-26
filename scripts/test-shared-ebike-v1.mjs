import assert from 'node:assert/strict'
import {EBIKE_SHARED_MAX_KMH, resolveEbikeProfile, resolvePersonalEbikeProfile} from '../web/src/walk/tuning.ts'
import {createBikeControl} from '../web/src/walk/ride.ts'
import {resolveInteraction} from '../web/src/walk/interact-arbiter.ts'
import {
  registerSharedEbikeUnlockHooks,
  requestSharedEbikeReturn,
  requestSharedEbikeUnlock,
  resetSharedEbikeUnlockHooks,
} from '../web/src/walk/shared-ebike-unlock.ts'
import * as stateMod from '../web/src/game/state.ts'
import * as saveMod from '../web/src/game/save.ts'
import * as commerce from '../web/src/game/commerce.ts'

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

const mem = new MemoryStorage()
globalThis.localStorage = mem

let passed = 0
function check(name, cond, detail = '') {
  if (!cond) {
    console.error(`[FAIL] ${name}${detail ? `: ${detail}` : ''}`)
    process.exitCode = 1
    return
  }
  passed++
  console.log(`[PASS] ${name}${detail ? ` (${detail})` : ''}`)
}

function unlockP(ctrl) {
  ctrl.setPark(false, true)
  ctrl.setKickstand(false, true)
}

// ---------------------------------------------------------------------------
// 1. Tuning nerf & personal isolation
// ---------------------------------------------------------------------------
check('EBIKE_SHARED_MAX_KMH nerfed to 18 km/h', EBIKE_SHARED_MAX_KMH === 18, `cap=${EBIKE_SHARED_MAX_KMH}`)

const sharedProfile = resolveEbikeProfile('shared', {motorLevel: 3, batteryLevel: 3, controllerLevel: 3})
check(
  'shared profile ignores upgrades, disables wheelie, weakens accel & caps gears <= 18',
  !sharedProfile.allowUpgrades &&
    sharedProfile.allowWheelie === false &&
    sharedProfile.wheelieTorqueMul === 0 &&
    sharedProfile.accelMul < 1 &&
    sharedProfile.gears.every(g => g.maxKmh <= 18 && g.wheelieGain === 0 && g.uphillMul >= 1.3),
  `gears=${sharedProfile.gears.map(g => g.maxKmh).join('/')} accelMul=${sharedProfile.accelMul}`,
)

const normalProfile = resolveEbikeProfile('normal', null)
const personalGt = resolvePersonalEbikeProfile('xiangshan_gt', {motorLevel: 3, batteryLevel: 3, controllerLevel: 3})
const personalLight = resolvePersonalEbikeProfile('lijiang_light', null)
check(
  'normal & personal e-bike stats unaffected (42..70 km/h & wheelie enabled)',
  normalProfile.tierMaxKmh === 50 &&
    normalProfile.allowWheelie !== false &&
    personalLight.tierMaxKmh === 42 &&
    personalGt.tierMaxKmh === 70 &&
    personalGt.gears.every(g => g.wheelieGain > 0),
  `normal=${normalProfile.tierMaxKmh} light=${personalLight.tierMaxKmh} gt=${personalGt.tierMaxKmh}`,
)

// ---------------------------------------------------------------------------
// 2. Physics enforcement: cap, sluggish launch, heavy uphill bog, zero wheelie
// ---------------------------------------------------------------------------
const sharedCtrl = createBikeControl()
sharedCtrl.mount(0, 0, 'bike', {vehicleType: 'shared', drainEnabled: false, parkStart: false, autoCrash: false})
unlockP(sharedCtrl)
sharedCtrl.setUpgrades({motorLevel: 3, batteryLevel: 3, controllerLevel: 3})
sharedCtrl.setGear(4)
let sharedLaunch2s = 0
let sharedPeak = 0
let sharedWheeliePeak = 0
for (let i = 0; i < 200; i++) {
  sharedCtrl.steer(1, 0, 0.05, true, {wheelie: 1})
  const kmh = sharedCtrl.speed * 3.6
  if (i === 39) sharedLaunch2s = kmh
  sharedPeak = Math.max(sharedPeak, kmh)
  sharedWheeliePeak = Math.max(sharedWheeliePeak, Math.abs(sharedCtrl.wheelie))
}
check(
  'shared physics capped <= 18.2 km/h & wheelie remains strictly 0 under Space input',
  sharedPeak >= 16 && sharedPeak <= 18.2 && sharedWheeliePeak === 0 && !sharedCtrl.telemetry().upgraded,
  `peak=${sharedPeak.toFixed(1)} wheelie=${sharedWheeliePeak}`,
)

// Steep climb test: shared bogs down noticeably vs personal
const sharedHill = createBikeControl()
sharedHill.mount(0, 0, 'bike', {vehicleType: 'shared', drainEnabled: false, parkStart: false, autoCrash: false})
unlockP(sharedHill)
sharedHill.setGear(4)
for (let i = 0; i < 120; i++) {
  sharedHill.setPitch(0.24, 0, 0.05)
  sharedHill.steer(1, 0, 0.05, true)
}
const sharedUphillKmh = sharedHill.speed * 3.6

const gtCtrl = createBikeControl()
gtCtrl.mount(0, 0, 'bike', {vehicleType: 'normal', modelId: 'xiangshan_gt', drainEnabled: false, parkStart: false, autoCrash: false})
unlockP(gtCtrl)
gtCtrl.setGear(4)
let gtLaunch2s = 0
let gtWheeliePeak = 0
for (let i = 0; i < 120; i++) {
  gtCtrl.steer(1, 0, 0.05, true, {wheelie: 1})
  if (i === 39) gtLaunch2s = gtCtrl.speed * 3.6
  gtWheeliePeak = Math.max(gtWheeliePeak, Math.abs(gtCtrl.wheelie))
}
const gtPeak = gtCtrl.speed * 3.6
check(
  'shared acceleration & climb clearly weaker than personal xiangshan_gt, while personal keeps high speed & wheelie',
  sharedLaunch2s < gtLaunch2s * 0.6 &&
    sharedUphillKmh < sharedPeak &&
    gtPeak > 48 &&
    gtWheeliePeak > 0.15,
  `launch2s shared=${sharedLaunch2s.toFixed(1)} gt=${gtLaunch2s.toFixed(1)} uphill=${sharedUphillKmh.toFixed(1)} gtPeak=${gtPeak.toFixed(1)} gtWheelie=${gtWheeliePeak.toFixed(2)}`,
)

// Downhill coasting clamp & zero extra battery drain for disabled wheelie input on shared e-bikes
const sharedCoast = createBikeControl()
sharedCoast.mount(0, 0, 'bike', {vehicleType: 'shared', drainEnabled: false, parkStart: false, autoCrash: false})
unlockP(sharedCoast)
sharedCoast.setGear(4)
for (let i = 0; i < 120; i++) sharedCoast.steer(1, 0, 0.05, true)
let sharedDownhillPeak = 0
for (let i = 0; i < 120; i++) {
  sharedCoast.setPitch(0, 0.35, 0.05)
  sharedCoast.steer(0, 0, 0.05, true)
  sharedDownhillPeak = Math.max(sharedDownhillPeak, sharedCoast.speed * 3.6)
}
const sharedDrainBase = createBikeControl()
sharedDrainBase.mount(0, 0, 'bike', {vehicleType: 'shared', drainEnabled: true, parkStart: false, autoCrash: false})
unlockP(sharedDrainBase)
sharedDrainBase.setGear(3)
const sharedDrainWheelie = createBikeControl()
sharedDrainWheelie.mount(0, 0, 'bike', {vehicleType: 'shared', drainEnabled: true, parkStart: false, autoCrash: false})
unlockP(sharedDrainWheelie)
sharedDrainWheelie.setGear(3)
for (let i = 0; i < 80; i++) {
  sharedDrainBase.steer(1, 0, 0.05, true, {wheelie: 0})
  sharedDrainWheelie.steer(1, 0, 0.05, true, {wheelie: 1})
}
check(
  'shared bike clamps downhill coasting <= 18.2 km/h & holding wheelie adds 0 battery drain',
  sharedDownhillPeak <= 18.2 && Math.abs(sharedDrainBase.batteryPct - sharedDrainWheelie.batteryPct) < 1e-6,
  `downhillPeak=${sharedDownhillPeak.toFixed(2)} batBase=${sharedDrainBase.batteryPct.toFixed(3)} batWheelie=${sharedDrainWheelie.batteryPct.toFixed(3)}`,
)

// ---------------------------------------------------------------------------
// 3. Atomic ¥2 unlock, strict < ¥2 blocking, anti-double-charge & v2 hooks
// ---------------------------------------------------------------------------
assert.equal(commerce.SHARED_EBIKE_FEE_YUAN, 2)
assert.equal(commerce.SHARED_EBIKE_FREE_SECONDS, 0)

for (const startBalance of [0, 1]) {
  saveMod.resetSaveForTesting(startBalance, mem)
  const blocked = requestSharedEbikeUnlock(
    {bikeId: 'bike_a', sessionKey: `sess_low_${startBalance}`, soloEnabled: true, alreadyUnlocked: false},
    commerce.unlockSharedEbike,
  )
  check(
    `balance ¥${startBalance} strictly refused without negative debit`,
    !blocked.ok &&
      blocked.code === 'INSUFFICIENT_FUNDS' &&
      blocked.charged === 0 &&
      stateMod.getState().money === startBalance &&
      blocked.message.includes('余额不足'),
    `money=${stateMod.getState().money}`,
  )
}

// Boundary ¥2 -> deducts ¥2 atomically -> 0 left -> second ride refused
saveMod.resetSaveForTesting(2, mem)
const boundaryOk = requestSharedEbikeUnlock(
  {bikeId: 'bike_a', sessionKey: 'sess_exact_2', soloEnabled: true, alreadyUnlocked: false},
  commerce.unlockSharedEbike,
)
const replaySame = requestSharedEbikeUnlock(
  {bikeId: 'bike_a', sessionKey: 'sess_exact_2', soloEnabled: true, alreadyUnlocked: false},
  commerce.unlockSharedEbike,
)
const secondBikeAfterZero = requestSharedEbikeUnlock(
  {bikeId: 'bike_b', sessionKey: 'sess_second_0', soloEnabled: true, alreadyUnlocked: false},
  commerce.unlockSharedEbike,
)
check(
  'exact ¥2 pays once atomically (0 balance left), replay does not double-charge, next borrow blocked',
  boundaryOk.ok &&
    boundaryOk.charged === 2 &&
    stateMod.getState().money === 0 &&
    replaySame.ok &&
    replaySame.charged === 0 &&
    !secondBikeAfterZero.ok &&
    secondBikeAfterZero.code === 'INSUFFICIENT_FUNDS' &&
    stateMod.getState().money === 0,
  `money=${stateMod.getState().money}`,
)

// Already-unlocked same ride & dismount re-borrow lifecycle
saveMod.resetSaveForTesting(10, mem)
const ride1 = requestSharedEbikeUnlock(
  {bikeId: 'bike_a', sessionKey: 'sess_life_1', soloEnabled: true, alreadyUnlocked: false},
  commerce.unlockSharedEbike,
)
const crashRemount = requestSharedEbikeUnlock(
  {bikeId: 'bike_a', sessionKey: 'sess_life_1', soloEnabled: true, alreadyUnlocked: true},
  commerce.unlockSharedEbike,
)
const returnDec = requestSharedEbikeReturn({bikeId: 'bike_a', sessionKey: 'sess_life_1', soloEnabled: true})
const ride2AfterLeave = requestSharedEbikeUnlock(
  {bikeId: 'bike_a', sessionKey: 'sess_life_2', soloEnabled: true, alreadyUnlocked: false},
  commerce.unlockSharedEbike,
)
check(
  'crash remount during active session costs ¥0; re-borrowing after leaving/dismounting charges ¥2 again',
  ride1.ok &&
    ride1.charged === 2 &&
    crashRemount.ok &&
    crashRemount.charged === 0 &&
    returnDec.ok &&
    ride2AfterLeave.ok &&
    ride2AfterLeave.charged === 2 &&
    stateMod.getState().money === 6,
  `money=${stateMod.getState().money}`,
)

// Tour mode compatibility + v2 extensibility hook
const tourFallback = requestSharedEbikeUnlock(
  {bikeId: 'bike_a', sessionKey: 'sess_tour', soloEnabled: false, alreadyUnlocked: false},
  commerce.unlockSharedEbike,
)
check('tour mode falls back cleanly without charging wallet', tourFallback.ok && tourFallback.code === 'TOUR_FREE_FALLBACK' && stateMod.getState().money === 6)

let v2HookCalled = false
registerSharedEbikeUnlockHooks({
  beforeUnlock: req => {
    v2HookCalled = true
    return {
      ok: false,
      code: 'BLOCKED',
      charged: 0,
      balanceAfter: 6,
      feeYuan: 2,
      message: '请先用手机扫码确认',
      phase: 'unlocking',
    }
  },
})
const hookedRes = requestSharedEbikeUnlock({bikeId: 'bike_v2', sessionKey: 'v2_1', soloEnabled: true, alreadyUnlocked: false}, commerce.unlockSharedEbike)
resetSharedEbikeUnlockHooks()
check('v2 hook overrides cleanly & restores cleanly', v2HookCalled && !hookedRes.ok && hookedRes.phase === 'unlocking')

// Arbiter labels
const baseCtx = {
  soloEnabled: true,
  active: true,
  modalOrOverlayBlocked: false,
  crashed: false,
  standingUp: false,
  pickingUpKind: null,
  aboardKind: null,
  tourDisembarkQueued: false,
  inQuietZone: false,
  nearDownedVehicle: null,
  nearShop: null,
  nearServiceBay: null,
  nearVehicle: {kind: 'bike', downed: false, distance: 1.8, ownership: 'shared', ebikeTier: 'shared', alreadyUnlocked: false},
  nearBoat: null,
}
const soloSharedPrompt = resolveInteraction(baseCtx)
const soloResumedPrompt = resolveInteraction({...baseCtx, nearVehicle: {...baseCtx.nearVehicle, alreadyUnlocked: true}})
const tourPrompt = resolveInteraction({...baseCtx, soloEnabled: false})
const personalPrompt = resolveInteraction({...baseCtx, nearVehicle: {kind: 'bike', downed: false, distance: 1.8, ownership: 'personal', ebikeTier: 'normal'}})
check(
  'arbiter displays unlock ¥2 prompt in solo, resume label when unlocked, legacy label in tour, personal label for owned',
  soloSharedPrompt.label === '解锁共享电动车（¥2）' &&
    soloResumedPrompt.label === '继续骑共享电车' &&
    tourPrompt.label === '骑电动车' &&
    personalPrompt.label === '骑我的电摩',
  `${soloSharedPrompt.label} | ${soloResumedPrompt.label} | ${tourPrompt.label} | ${personalPrompt.label}`,
)

console.log(`ALL CHECKS PASSED: ${passed}`)
