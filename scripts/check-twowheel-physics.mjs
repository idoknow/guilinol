// Deterministic Node physics & state-machine verification for web/src/walk/ride.ts + config.ts.
// Tests:
//  1. Tactile manual gears on normal e-bike (D1/D2/D3/S), shared e-bike (40 km/h cap), and pedal bicycle (1挡/2挡/3挡)
//  2. Launch torque differentiation & realistic longitudinal coasting inertia
//  3. Hair-trigger crash detection (lowside without Shift, wet grip drop, wheelie loopout, wall/obstacle impact) on e-bike & bicycle
//  4. Strict multi-phase recovery state machine: sliding -> downed -> rider_rising -> bike_down (stays on side!) -> approach -> picking_up -> compliant reset
import {build} from 'esbuild'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'

const dir = await mkdtemp(join(tmpdir(), 'glol-twowheel-'))
const outfile = join(dir, 'ride-bundle.mjs')

try {
  await build({
    entryPoints: ['web/src/walk/ride.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    plugins: [{
      name: 'stub-rapier',
      setup(b) {
        b.onResolve({filter: /^@dimforge\/rapier3d-compat$/}, () => ({path: 'rapier-stub', namespace: 'stub'}))
        b.onLoad({filter: /.*/, namespace: 'stub'}, () => ({contents: 'export default { Ray: class {} }', loader: 'js'}))
      },
    }],
    logLevel: 'silent',
  })

  const {createBikeControl} = await import(pathToFileURL(outfile).href)
  const failures = []
  const check = (label, cond, detail = '') => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
    if (!cond) failures.push(`${label}${detail ? `: ${detail}` : ''}`)
  }

  // 1. E-bike manual gears (D1..S) distinct speed & launch feel + upgrades + shared fleet cap
  const eb = createBikeControl()
  eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false})
  check('default mount ebike gear is D2 (25 km/h)', eb.gear === 2 && eb.telemetry().gearLabel === 'D2' && eb.telemetry().maxKmh === 25)

  const ebikePeaks = {}
  const launchSpdAt08s = {}
  for (const [g, label] of [[1, 'D1'], [2, 'D2'], [3, 'D3'], [4, 'S']]) {
    eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false})
    eb.setGear(g)
    let spd = 0
    for (let i = 0; i < 16; i++) spd = eb.steer(1, 0, 0.05, true) // 0.8s launch feel
    launchSpdAt08s[label] = +(spd * 3.6).toFixed(2)
    for (let i = 0; i < 120; i++) spd = eb.steer(1, 0, 0.05, true)
    ebikePeaks[label] = +(spd * 3.6).toFixed(1)
  }
  check(
    'ebike gears step cleanly D1 < D2 < D3 < S',
    ebikePeaks.D1 <= 16.2 && ebikePeaks.D2 <= 25.1 && ebikePeaks.D3 > 36 && ebikePeaks.S > 48 &&
    ebikePeaks.D1 < ebikePeaks.D2 && ebikePeaks.D2 < ebikePeaks.D3 && ebikePeaks.D3 < ebikePeaks.S,
    JSON.stringify(ebikePeaks),
  )
  check(
    'ebike launch torque scales S > D3 > D2 > D1',
    launchSpdAt08s.S > launchSpdAt08s.D3 && launchSpdAt08s.D3 > launchSpdAt08s.D2 && launchSpdAt08s.D2 > launchSpdAt08s.D1,
    JSON.stringify(launchSpdAt08s),
  )

  // Shared fleet capped at 40 km/h on S & blocks upgrades
  eb.mount(0, 0, 'bike', {vehicleType: 'shared', autoCrash: true, drainEnabled: false})
  eb.setUpgrades({motorLevel: 3, controllerLevel: 3})
  eb.setGear(4)
  for (let i = 0; i < 120; i++) eb.steer(1, 0, 0.05, true)
  check('shared bike capped at 40 km/h & rejects mods', +(eb.speed * 3.6).toFixed(1) <= 40.2 && !eb.telemetry().upgraded, `${(eb.speed * 3.6).toFixed(1)} km/h`)

  // 2. Pedal bicycle real 3-speed manual gears (1挡 / 2挡 / 3挡)
  const ped = createBikeControl()
  ped.mount(0, 0, 'bicycle', {autoCrash: true})
  check('bicycle mounts at default 2挡 (21 km/h)', ped.gear === 2 && ped.gearCount === 3 && ped.telemetry().gearLabel === '2挡')
  const pedPeaks = {}
  const pedLaunch = {}
  for (const g of [1, 2, 3]) {
    ped.mount(0, 0, 'bicycle', {autoCrash: true})
    ped.setGear(g)
    let spd = 0
    for (let i = 0; i < 16; i++) spd = ped.steer(1, 0, 0.05, true)
    pedLaunch[g] = +(spd * 3.6).toFixed(2)
    for (let i = 0; i < 140; i++) spd = ped.steer(1, 0, 0.05, true)
    pedPeaks[g] = +(spd * 3.6).toFixed(1)
  }
  check(
    'bicycle 3 gears scale 1挡 < 2挡 < 3挡 top speed & 1挡 launches quickest',
    pedPeaks[1] < pedPeaks[2] && pedPeaks[2] < pedPeaks[3] && pedPeaks[3] > 27 && pedLaunch[1] > pedLaunch[2] && pedLaunch[2] > pedLaunch[3],
    `peaks=${JSON.stringify(pedPeaks)} launch=${JSON.stringify(pedLaunch)}`,
  )

  // Coasting inertia check (from 25 km/h D2, after 2.0s freewheel keeps > 60% speed)
  eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false})
  for (let i = 0; i < 80; i++) eb.steer(1, 0, 0.05, true)
  const vStart = eb.speed
  for (let i = 0; i < 40; i++) eb.steer(0, 0, 0.05, true) // 2.0s coast
  const vCoast2s = eb.speed
  check('realistic coasting inertia retains > 65% speed at 2.0s', vCoast2s / vStart > 0.65 && vCoast2s < vStart, `${vStart.toFixed(2)} -> ${vCoast2s.toFixed(2)} m/s`)

  // 3a. Brief lane tap in D2 steers smoothly without false crash; sustained sharp D2/D3 turn triggers lowside without Shift
  eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false})
  eb.setGear(2)
  for (let i = 0; i < 60; i++) eb.steer(1, 0, 0.05, true)
  for (let i = 0; i < 4; i++) eb.steer(1, 0.7, 0.05, true) // 0.2s quick lane correction
  check('brief 0.2s lane tap at D2 steers cleanly without false crash', eb.crashPhase === 'none', `lean=${eb.lean.toFixed(2)}`)

  eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false})
  eb.setGear(3)
  eb.setVehicleWorldPos(10, 150, 20)
  for (let i = 0; i < 50; i++) eb.steer(1, 0, 0.05, true)
  let lowsideAt = -1
  for (let i = 0; i < 30; i++) {
    eb.steer(1, 1, 0.05, true) // sustained sharp turn without tuck
    if (eb.crashPhase !== 'none') { lowsideAt = i; break }
  }
  check('ebike D3 sustained sharp corner triggers lowside without Shift', lowsideAt >= 2 && eb.crashState.reason === 'lowside', `ticks=${lowsideAt}, reason=${eb.crashState.reason}`)

  // 3b. Wet road lowside happens even sooner
  eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false})
  eb.setGear(2)
  eb.setSurfaceCondition({wet: true})
  for (let i = 0; i < 40; i++) eb.steer(1, 0, 0.05, true)
  let wetCrash = false
  for (let i = 0; i < 30; i++) {
    eb.steer(1, .85, 0.05, true)
    if (eb.crashPhase !== 'none') { wetCrash = true; break }
  }
  check('wet surface lowers grip and triggers easy D2 lowside', wetCrash && eb.crashState.reason === 'lowside', `grip=${eb.gripLimitRad.toFixed(2)}`)

  // 3c. Easy wheelie loopout on BOTH e-bike and bicycle
  eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false})
  eb.setGear(3)
  for (let i = 0; i < 30; i++) eb.steer(1, 0, 0.05, true)
  let ebikeLoopout = false
  for (let i = 0; i < 30; i++) {
    eb.steer(1, 0, 0.05, true, {wheelie: true})
    if (eb.crashState.reason === 'loopout') { ebikeLoopout = true; break }
  }
  check('ebike wheelie hold hits loopout easily', ebikeLoopout)

  ped.mount(0, 0, 'bicycle', {autoCrash: true})
  ped.setGear(1)
  for (let i = 0; i < 20; i++) ped.steer(1, 0, 0.05, true)
  let pedLoopout = false
  for (let i = 0; i < 30; i++) {
    ped.steer(1, 0, 0.05, true, {wheelie: true})
    if (ped.crashState.reason === 'loopout') { pedLoopout = true; break }
  }
  check('bicycle wheelie hold hits loopout easily', pedLoopout)

  // 3d. Easy wall/obstacle impact crash (>= 3.2 m/s ebike, >= 2.8 m/s bicycle)
  eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false})
  eb.setGear(2)
  for (let i = 0; i < 25; i++) eb.steer(1, 0, 0.05, true) // ~4+ m/s
  const hitRes = eb.resolveMove({
    pos: {x: 0, y: 150, z: 0},
    next: {x: 0, z: -0.2},
    move: {x: 0, z: -0.02},
    heading: 0,
    speed: eb.speed,
    step: 1 / 60,
    pavement: () => true,
    insideHouse: () => true,
    blockedAt: () => false,
    collisionKind: () => 'building',
    stopBike: () => eb.stop(),
    dampBike: s => eb.dampSpeed(s),
    capOffRoad: (s, l) => eb.capSpeed(s, l),
  })
  check('ebike moderate wall collision (D2) triggers impact crash', hitRes.blocked && eb.crashState.reason === 'impact', `reason=${eb.crashState.reason}`)

  // 4. Full state machine on bicycle: crash -> sliding -> downed -> rider rises FIRST while bike stays sideways -> too far blocked -> approach -> pick up upright -> compliant reset
  ped.mount(0, 0, 'bicycle', {autoCrash: true})
  ped.setGear(3)
  ped.setVehicleWorldPos(50, 150, 80)
  for (let i = 0; i < 55; i++) ped.steer(1, 0, 0.05, true)
  for (let i = 0; i < 30; i++) {
    ped.steer(1, 1, 0.05, true)
    if (ped.crashPhase !== 'none') break
  }
  check('bicycle crashes on sharp high-speed 3挡 turn', ped.crashPhase === 'sliding' && ped.crashState.bikeIsDown)

  // Premature pickup rejected before rider stands up
  const earlyPickup = ped.startPickup()
  check('pickup rejected while sliding/downed', !earlyPickup.ok && earlyPickup.reason === 'rider_must_stand_first', earlyPickup.reason)

  // Step slide to downed
  for (let i = 0; i < 30 && ped.crashPhase === 'sliding'; i++) ped.stepCrash(0.05, {autoStand: false})
  check('settled to downed with separated rider & bike on side', ped.crashPhase === 'downed' && ped.crashState.distToBike > 0.6 && Math.abs(ped.crashState.bikeRoll) > 1.35, `dist=${ped.crashState.distToBike.toFixed(2)}, roll=${ped.crashState.bikeRoll.toFixed(2)}`)

  // Rider rises FIRST while bike REMAINS lying sideways
  check('standUp starts rider_rising', ped.standUp() && ped.crashPhase === 'rider_rising')
  for (let i = 0; i < 20 && ped.crashPhase === 'rider_rising'; i++) ped.stepCrash(0.05)
  check(
    'after rider finishes rising -> bike_down (rider on foot, bike STILL sideways)',
    ped.crashPhase === 'bike_down' && ped.crashState.riderOnFoot && ped.crashState.bikeIsDown && Math.abs(ped.crashState.bikeRoll) > 1.35,
    `phase=${ped.crashPhase}, roll=${ped.crashState.bikeRoll.toFixed(2)}`,
  )

  // Move rider far away -> pickup blocked until walking near
  ped.setRiderWorldPos(ped.crashState.bikePos.x + 5.0, 150, ped.crashState.bikePos.z)
  const farPickup = ped.startPickup()
  check('pickup blocked when rider walks > 2.4m away from downed bike', !farPickup.ok && farPickup.reason === 'too_far', `dist=${farPickup.distance?.toFixed(2)}`)

  // Walk close to pickup spot -> pickup succeeds & resets bicycle to default 2挡
  ped.setRiderWorldPos(ped.crashState.pickupSpot.x, 150, ped.crashState.pickupSpot.z)
  const nearPickup = ped.startPickup()
  check('pickup succeeds when standing rider approaches downed bike', nearPickup.ok && ped.crashPhase === 'picking_up')
  for (let i = 0; i < 20 && ped.crashPhase === 'picking_up'; i++) ped.stepCrash(0.05)
  check(
    'pickup completes -> bike upright, crash cleared, gear reset to default 2挡',
    ped.crashPhase === 'none' && ped.crashState.justRecoveredToRide && ped.gear === 2 && ped.crashState.bikeRoll === 0,
    `gear=${ped.gear}, roll=${ped.crashState.bikeRoll}`,
  )

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:\n- ` + failures.join('\n- '))
    process.exitCode = 1
  } else {
    console.log('\nall two-wheel physics & crash state-machine cases passed')
  }
} finally {
  await rm(dir, {recursive: true, force: true})
}
