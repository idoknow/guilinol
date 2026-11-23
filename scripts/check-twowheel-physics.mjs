// Deterministic Node physics, boundary-safety & real-ebike state-machine gate for ride.ts + config.ts.
// Default mode verifies core mechanics and logs a V2 readiness matrix (`pending_v2` before Hy2/Hy1 lands).
// Pass `--strict-v2` (or CI env STRICT_TWOWHEEL_V2=1) to enforce all Round-2 gates as hard failures.
import {build} from 'esbuild'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'

const STRICT_V2 = process.argv.includes('--strict-v2') || process.env.STRICT_TWOWHEEL_V2 === '1'
const RIDE_ENTRY = process.env.RIDE_ENTRY || 'web/src/walk/ride.ts'
const dir = await mkdtemp(join(tmpdir(), 'glol-twowheel-'))
const outfile = join(dir, 'ride-bundle.mjs')

const firstDefined = (obj, keys) => {
  if (!obj || typeof obj !== 'object') return undefined
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k]
  }
  return undefined
}

function readExtendedState(ctrl) {
  const t = ctrl.telemetry?.() ?? {}
  return {
    raw: t,
    fatalLeanRad: firstDefined(t, ['mandatoryFallLeanRad', 'effectiveFallLeanRad', 'fatalLeanRad', 'crashLeanRad', 'leanCrashRad']),
    leanRateDegPerSec: firstDefined(t, ['leanRateDegPerSec']),
    leanDangerRatio: firstDefined(t, ['leanDangerRatio']),
    parked: firstDefined(t, ['parkLocked', 'parkGear', 'parked', 'pGear', 'isParked', 'parkLock']),
    kickstand: firstDefined(t, ['kickstandDown', 'kickstand', 'sideStand', 'sideStandDown']),
    throttleBlockedByPark: firstDefined(t, ['throttleBlockedByPark']),
    parkWarnSeq: firstDefined(t, ['parkWarnSeq']),
    headlight: firstDefined(t, ['headlight', 'headlightMode', 'lightMode', 'light']),
    taillight: firstDefined(t, ['taillight', 'tailLight']),
    brakeLight: firstDefined(t, ['brakeLight', 'brakeLamp', 'tailBrake']),
    turnSignal: firstDefined(t, ['turnSignal', 'blinker', 'indicator']),
    leftSignalLit: firstDefined(t, ['leftSignalLit']),
    rightSignalLit: firstDefined(t, ['rightSignalLit']),
    blinkOn: firstDefined(t, ['blinkOn', 'turnBlinkOn']),
    hazard: firstDefined(t, ['hazard', 'hazardLights', 'doubleFlash']),
    cruise: firstDefined(t, ['cruiseControl', 'cruise', 'cruiseActive']),
    cruiseKmh: firstDefined(t, ['cruiseTargetKmh', 'cruiseKmh']),
    hornCount: firstDefined(t, ['hornSeq', 'hornCount', 'hornTriggers']),
    hornActive: firstDefined(t, ['hornActive', 'honking', 'horn']),
  }
}

function releaseDrivable(ctrl) {
  const ext = readExtendedState(ctrl)
  if (ext.parked === true) {
    ctrl.setPark?.(false, true) ?? ctrl.setParked?.(false) ?? ctrl.togglePark?.(true) ?? ctrl.steer(0, 0, 0.05, true, {park: false, parkToggle: true})
  }
  if (ext.kickstand === true) {
    ctrl.setKickstand?.(false) ?? ctrl.toggleKickstand?.() ?? ctrl.steer(0, 0, 0.05, true, {kickstand: false, kickstandToggle: true})
  }
}

function measureCornerWindow(ctrl, {gear, accelTicks, holdTicks, steerAmt, tuck = false, wet = false, offRoad = false, braking = false, kind = 'bike', vehicleType = 'normal'}) {
  ctrl.mount(0, 0, kind, {vehicleType, autoCrash: true, drainEnabled: false, parkStart: false})
  releaseDrivable(ctrl)
  ctrl.setGear(gear)
  ctrl.setSurfaceCondition?.({wet, offRoad})
  for (let i = 0; i < accelTicks; i++) ctrl.steer(1, 0, 0.05, true)
  const vStart = ctrl.speed
  let maxLean = 0
  let maxLeanRate = 0
  let leanAt015 = 0
  let crashAtTick = -1
  let crashReason = ''
  let prevTickLean = Math.abs(ctrl.lean)
  let crashPrevLean = 0
  let crashLean = 0
  let limitAtEnd = ctrl.gripLimitRad
  for (let i = 0; i < holdTicks; i++) {
    ctrl.steer(braking ? -1 : 1, steerAmt, 0.05, true, {tuck})
    const absLean = Math.abs(ctrl.lean)
    const tel = readExtendedState(ctrl)
    if (absLean > maxLean) maxLean = absLean
    if (typeof tel.leanRateDegPerSec === 'number' && tel.leanRateDegPerSec > maxLeanRate) {
      maxLeanRate = tel.leanRateDegPerSec
    }
    if (i === 2) leanAt015 = absLean
    limitAtEnd = ctrl.gripLimitRad
    if (ctrl.crashPhase !== 'none') {
      crashAtTick = i + 1
      crashReason = ctrl.crashState.reason
      crashPrevLean = prevTickLean
      crashLean = absLean
      break
    }
    prevTickLean = absLean
  }
  return {
    vStart: +vStart.toFixed(2),
    kmh: Math.round(vStart * 3.6),
    leanRate015: +(leanAt015 / 0.15).toFixed(3),
    maxLeanRateDegS: +maxLeanRate.toFixed(1),
    maxLean: +maxLean.toFixed(4),
    survivedSec: crashAtTick > 0 ? +(crashAtTick * 0.05).toFixed(2) : +(holdTicks * 0.05).toFixed(2),
    crashed: crashAtTick > 0,
    crashReason,
    crashPrevLean: +crashPrevLean.toFixed(4),
    crashLean: +crashLean.toFixed(4),
    gripLimitRad: +limitAtEnd.toFixed(4),
  }
}

try {
  await build({
    entryPoints: [RIDE_ENTRY],
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
  const pendingV2 = []

  const check = (label, cond, detail = '') => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
    if (!cond) failures.push(`${label}${detail ? `: ${detail}` : ''}`)
  }
  const checkV2 = (label, cond, detail = '') => {
    if (STRICT_V2) return check(label, cond, detail)
    console.log(`${cond ? 'ok  ' : 'PEND'} ${label}${detail ? ` (${detail})` : ''}`)
    if (!cond) pendingV2.push(`${label}${detail ? `: ${detail}` : ''}`)
  }

  // Ensure bike mounts cleanly past any P-gear/kickstand lock for core kinematics
  const ensureDrivable = releaseDrivable

  // 1. E-bike & Bicycle Gears + Launch Torque + Coasting
  const eb = createBikeControl()
  eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false, parkStart: false})
  ensureDrivable(eb)
  check('default mount ebike gear is D2 (25 km/h)', eb.gear === 2 && eb.telemetry().gearLabel === 'D2' && eb.telemetry().maxKmh === 25)

  const ebikePeaks = {}
  const launchSpdAt08s = {}
  for (const [g, label] of [[1, 'D1'], [2, 'D2'], [3, 'D3'], [4, 'S']]) {
    eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false, parkStart: false})
    ensureDrivable(eb)
    eb.setGear(g)
    let spd = 0
    for (let i = 0; i < 16; i++) spd = eb.steer(1, 0, 0.05, true)
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

  eb.mount(0, 0, 'bike', {vehicleType: 'shared', autoCrash: true, drainEnabled: false, parkStart: false})
  ensureDrivable(eb)
  eb.setUpgrades({motorLevel: 3, controllerLevel: 3})
  eb.setGear(4)
  for (let i = 0; i < 120; i++) eb.steer(1, 0, 0.05, true)
  check('shared bike capped at 40 km/h & rejects mods', +(eb.speed * 3.6).toFixed(1) <= 40.2 && !eb.telemetry().upgraded, `${(eb.speed * 3.6).toFixed(1)} km/h`)

  const ped = createBikeControl()
  ped.mount(0, 0, 'bicycle', {autoCrash: true})
  ensureDrivable(ped)
  check('bicycle mounts at default 2挡 (21 km/h)', ped.gear === 2 && ped.gearCount === 3 && ped.telemetry().gearLabel === '2挡')
  const pedPeaks = {}
  const pedLaunch = {}
  for (const g of [1, 2, 3]) {
    ped.mount(0, 0, 'bicycle', {autoCrash: true})
    ensureDrivable(ped)
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

  eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false, parkStart: false})
  ensureDrivable(eb)
  for (let i = 0; i < 80; i++) eb.steer(1, 0, 0.05, true)
  const vStart = eb.speed
  for (let i = 0; i < 40; i++) eb.steer(0, 0, 0.05, true)
  const vCoast2s = eb.speed
  check('realistic coasting inertia retains > 65% speed at 2.0s', vCoast2s / vStart > 0.65 && vCoast2s < vStart, `${vStart.toFixed(2)} -> ${vCoast2s.toFixed(2)} m/s`)

  // 2. Speed-Lean Curve, Low-Speed Controllability, Sub-Fatal Non-Death & Mandatory Fall Angle
  const lowD1 = measureCornerWindow(eb, {gear: 1, accelTicks: 24, holdTicks: 70, steerAmt: 1})
  const midD2 = measureCornerWindow(eb, {gear: 2, accelTicks: 60, holdTicks: 60, steerAmt: 1})
  const midD3 = measureCornerWindow(eb, {gear: 3, accelTicks: 70, holdTicks: 60, steerAmt: 1, tuck: false})
  const carveD3 = measureCornerWindow(eb, {gear: 3, accelTicks: 70, holdTicks: 60, steerAmt: 0.75, tuck: false})
  const highS = measureCornerWindow(eb, {gear: 4, accelTicks: 80, holdTicks: 60, steerAmt: 1, tuck: false})
  const carveS = measureCornerWindow(eb, {gear: 4, accelTicks: 80, holdTicks: 60, steerAmt: 0.75, tuck: false})
  const highSTuck = measureCornerWindow(eb, {gear: 4, accelTicks: 80, holdTicks: 50, steerAmt: 1, tuck: true})
  const d2WetNormal = measureCornerWindow(eb, {gear: 2, accelTicks: 50, holdTicks: 50, steerAmt: 0.75, wet: true, tuck: false})
  const d3WetNormal = measureCornerWindow(eb, {gear: 3, accelTicks: 70, holdTicks: 50, steerAmt: 1, wet: true, tuck: false})
  const d3OffRoadNormal = measureCornerWindow(eb, {gear: 3, accelTicks: 70, holdTicks: 50, steerAmt: 1, offRoad: true, tuck: false})
  const d2WetTuck = measureCornerWindow(eb, {gear: 3, accelTicks: 60, holdTicks: 50, steerAmt: 1, wet: true, tuck: true})
  // Regression: S-gear full-lock non-tuck turn + light brake tap (0.15s) must never instant-lowside
  eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false, parkStart: false})
  ensureDrivable(eb)
  eb.setGear(4)
  for (let i = 0; i < 80; i++) eb.steer(1, 0, 0.05, true)
  for (let i = 0; i < 25; i++) eb.steer(1, 1, 0.05, true)
  for (let i = 0; i < 3; i++) eb.steer(-1, 1, 0.05, true)
  const sBrakeTapCrashed = eb.crashPhase !== 'none'
  const sBrakeTapLean = +Math.abs(eb.lean).toFixed(4)
  const sBrakeTapLimit = +eb.gripLimitRad.toFixed(4)
  const pedLow = measureCornerWindow(ped, {kind: 'bicycle', gear: 1, accelTicks: 28, holdTicks: 60, steerAmt: 1})
  const pedMid = measureCornerWindow(ped, {kind: 'bicycle', gear: 2, accelTicks: 55, holdTicks: 50, steerAmt: 1, tuck: false})
  const pedHighNoTuck = measureCornerWindow(ped, {kind: 'bicycle', gear: 3, accelTicks: 75, holdTicks: 50, steerAmt: 1, tuck: false})
  const pedFatal = measureCornerWindow(ped, {kind: 'bicycle', gear: 3, accelTicks: 75, holdTicks: 50, steerAmt: 1, tuck: true})

  const leanRateRatio = lowD1.leanRate015 > 0 ? +(highS.leanRate015 / lowD1.leanRate015).toFixed(2) : 0
  checkV2(
    'low-speed D1 lean stays gentle (<=0.75 rad/s) & full-lock cornering >= 3.5s never false-crashes',
    !lowD1.crashed && lowD1.survivedSec >= 3.5 && lowD1.leanRate015 <= 0.75,
    JSON.stringify(lowD1),
  )
  checkV2(
    'speed-scaled lean rate: D1 < D2 < D3 < S & high-speed S >= 2.0x D1',
    leanRateRatio >= 2.0 && midD2.leanRate015 > lowD1.leanRate015 && midD3.leanRate015 > midD2.leanRate015 && highS.leanRate015 > midD3.leanRate015,
    `D1=${lowD1.leanRate015}, D2=${midD2.leanRate015}, D3=${midD3.leanRate015}, S=${highS.leanRate015} rad/s, ratio=${leanRateRatio}x`,
  )
  checkV2(
    'D2 compliant cruise normal full-lock turn >= 2.5s stays below fatal angle & never false-crashes',
    !midD2.crashed && midD2.survivedSec >= 2.5 && midD2.maxLean < midD2.gripLimitRad,
    JSON.stringify(midD2),
  )
  checkV2(
    'D3/S moderate carve (75% steer) stays below fatal angle without false crash',
    !carveD3.crashed && carveD3.maxLean < carveD3.gripLimitRad && !carveS.crashed && carveS.maxLean < carveS.gripLimitRad,
    `D3=${JSON.stringify(carveD3)} S=${JSON.stringify(carveS)}`,
  )
  checkV2(
    'high-speed D3/S non-tuck full-lock turn >= 2.5s stays controllable without false crash (leanMax < mandatoryFallLeanRad)',
    !midD3.crashed && midD3.survivedSec >= 2.5 && !highS.crashed && highS.survivedSec >= 2.5 && highS.maxLean < highS.gripLimitRad,
    `D3=${JSON.stringify(midD3)} S=${JSON.stringify(highS)}`,
  )
  checkV2(
    'S-gear non-tuck corner light brake tap & D3 wet/off-road full-lock never instant-crash',
    !sBrakeTapCrashed && !d3WetNormal.crashed && !d3OffRoadNormal.crashed,
    `sBrakeTap=${sBrakeTapCrashed}(lean=${sBrakeTapLean}<${sBrakeTapLimit}), d3Wet=${d3WetNormal.crashed}, d3Off=${d3OffRoadNormal.crashed}`,
  )
  checkV2(
    'wet moderate carve without crossing fatal angle stays upright; wet high-speed deep tuck triggers lowside',
    !d2WetNormal.crashed && d2WetNormal.survivedSec >= 2.0 && d2WetTuck.crashed && d2WetTuck.crashReason === 'lowside' && d2WetTuck.gripLimitRad < highSTuck.gripLimitRad && d2WetTuck.gripLimitRad >= 0.30,
    `wetNormal=${JSON.stringify(d2WetNormal)} wetTuck=${JSON.stringify(d2WetTuck)}`,
  )
  checkV2(
    'mandatory fatal lean threshold is clear (>=0.45 rad dry) and never false-crashes before reaching limit',
    [lowD1, midD2, midD3, carveD3, highS, carveS, highSTuck, d2WetNormal, d2WetTuck, pedLow, pedMid, pedHighNoTuck, pedFatal].every(r =>
      r.crashed
        ? (r.crashReason === 'lowside' && r.crashLean >= r.gripLimitRad * 0.98 && r.crashPrevLean < r.gripLimitRad)
        : (r.maxLean < r.gripLimitRad)
    ) && highSTuck.crashed && highSTuck.gripLimitRad >= 0.45,
    JSON.stringify(highSTuck),
  )
  checkV2(
    'bicycle 1挡/2挡 normal turn never false-crashes; 3挡 extreme tuck crosses fatal lean lowside',
    !pedLow.crashed && !pedMid.crashed && pedFatal.crashed && pedFatal.crashReason === 'lowside',
    `low=${pedLow.crashed}, mid=${pedMid.crashed}, 3noTuck=${pedHighNoTuck.crashed}@${pedHighNoTuck.survivedSec}s, fatal=${pedFatal.crashReason}@${pedFatal.crashLean}`,
  )

  // 3. Wheelie (IDOK-153: max 52°, never falls from holding it straight, tips over only on hard / fast turns) & wall impact
  const MAX_WHEELIE = 52 * Math.PI / 180
  const wheelieRun = (ctrl, kind, gear, accelTicks, steer, {rampTicks = 0, holdTicks = 80} = {}) => {
    ctrl.mount(0, 0, kind, {vehicleType: 'normal', autoCrash: true, drainEnabled: false, parkStart: false})
    ensureDrivable(ctrl)
    ctrl.setGear(gear)
    for (let i = 0; i < accelTicks; i++) ctrl.steer(1, 0, 0.05, true)
    let early = 0, peak = 0
    for (let i = 0; i < 40; i++) {
      ctrl.steer(1, 0, 0.05, true, {wheelie: true})
      if (i === 9) early = ctrl.wheelie
      peak = Math.max(peak, ctrl.wheelie)
    }
    let reason = '', at = -1
    for (let i = 0; i < holdTicks; i++) {
      const st = rampTicks ? steer * Math.min(1, (i + 1) / rampTicks) : steer
      ctrl.steer(1, st, 0.05, true, {wheelie: true})
      peak = Math.max(peak, ctrl.wheelie)
      if (ctrl.crashState.reason) { reason = ctrl.crashState.reason; at = i * 0.05; break }
    }
    return {early, peak, reason, at, kmh: ctrl.speed * 3.6}
  }
  const straightS = wheelieRun(eb, 'bike', 4, 60, 0, {holdTicks: 200})
  check('ebike S-gear wheelie held straight 12 s never crashes and caps at 52°',
    !straightS.reason && straightS.peak <= MAX_WHEELIE + 1e-6 && straightS.peak >= MAX_WHEELIE - 0.01, JSON.stringify(straightS))
  const gentleD3 = wheelieRun(eb, 'bike', 3, 30, 0, {holdTicks: 1})
  check('ebike wheelie is gentle: < 0.4 rad after 0.5 s of holding (D3)', gentleD3.early < 0.4, `wheelie@0.5s=${gentleD3.early.toFixed(3)}`)
  const halfD2 = wheelieRun(eb, 'bike', 2, 60, 0.5)
  check('ebike D2 wheelie + half-lock turn (25 km/h) stays up', !halfD2.reason, JSON.stringify(halfD2))
  const fullD2 = wheelieRun(eb, 'bike', 2, 60, 1)
  check('ebike D2 wheelie + sudden full-lock turn tips over (lowside)', fullD2.reason === 'lowside' && fullD2.at >= 0.2, JSON.stringify(fullD2))
  const fastHalf = wheelieRun(eb, 'bike', 4, 80, 0.5)
  check('ebike S-gear 50 km/h wheelie + half-lock turn tips over', fastHalf.reason === 'lowside', JSON.stringify(fastHalf))
  const slowFull = wheelieRun(eb, 'bike', 1, 30, 0.7, {rampTicks: 20})
  check('ebike D1 slow wheelie + 70% lock eased in over 1 s, held 4 s, survives', !slowFull.reason, JSON.stringify(slowFull))
  const pedStraight = wheelieRun(ped, 'bicycle', 2, 60, 0, {holdTicks: 200})
  check('bicycle wheelie held straight never crashes, max 52°', !pedStraight.reason && pedStraight.peak <= MAX_WHEELIE + 1e-6, JSON.stringify(pedStraight))
  const pedFull = wheelieRun(ped, 'bicycle', 2, 60, 1)
  check('bicycle wheelie + sudden full-lock turn tips over', pedFull.reason === 'lowside', JSON.stringify(pedFull))

  eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false, parkStart: false})
  ensureDrivable(eb)
  eb.setGear(2)
  for (let i = 0; i < 25; i++) eb.steer(1, 0, 0.05, true)
  const modWallSpd = eb.speed
  const modHitRes = eb.resolveMove({
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
  const modCrashed = modHitRes.blocked && eb.crashState.reason === 'impact'
  eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false, parkStart: false})
  ensureDrivable(eb)
  eb.setGear(2)
  for (let i = 0; i < 65; i++) eb.steer(1, 0, 0.05, true)
  const cruiseWallSpd = eb.speed
  const cruiseHitRes = eb.resolveMove({
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
  check('ebike cruise wall collision (D2 ~25 km/h) triggers impact crash', cruiseHitRes.blocked && eb.crashState.reason === 'impact', `speed=${(cruiseWallSpd * 3.6).toFixed(1)} km/h, reason=${eb.crashState.reason}`)
  checkV2('ebike moderate urban wall collision (~15 km/h) triggers impact crash', modCrashed, `modSpeed=${(modWallSpd * 3.6).toFixed(1)} km/h, crashed=${modCrashed}`)

  // 3b. Collision-kind obstacles (trees/rails/solids) at mid/high speed >= 35 km/h trigger impact crash even across substeps; slow nudges stop safely
  eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false, parkStart: false})
  ensureDrivable(eb)
  eb.setGear(3)
  for (let i = 0; i < 40; i++) eb.steer(1, 0, 0.05, true)
  const treeSpd = eb.speed
  const treeHitRes = eb.resolveMove({
    pos: {x: 0, y: 150, z: 0},
    next: {x: 0, z: -0.22},
    move: {x: 0, z: -0.22}, // > 0.35 * speed * step (substep hit on tree/rail)
    heading: 0,
    speed: eb.speed,
    step: 1 / 60,
    pavement: () => true,
    insideHouse: () => false,
    blockedAt: () => false,
    collisionBlocked: true,
    collisionKind: () => 'collision',
    stopBike: () => eb.stop(),
    dampBike: s => eb.dampSpeed(s),
    capOffRoad: (s, l) => eb.capSpeed(s, l),
  })
  check('ebike >=35 km/h substep collision (tree/rail) triggers impact crash', treeHitRes.blocked && treeHitRes.reason === 'collision' && eb.crashState.reason === 'impact', `speed=${(treeSpd * 3.6).toFixed(1)} km/h, reason=${eb.crashState.reason}`)

  eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false, parkStart: false})
  ensureDrivable(eb)
  const slowNoCrash = eb.tryImpactCrash(8 / 3.6)
  const fastSolidCrash = eb.tryImpactCrash(36 / 3.6)
  check('tryImpactCrash ignores slow 8 km/h nudge and triggers impact at 36 km/h solid collision', !slowNoCrash && fastSolidCrash && eb.crashPhase === 'sliding' && eb.crashState.reason === 'impact', `slow=${slowNoCrash}, fast=${fastSolidCrash}, phase=${eb.crashPhase}`)

  // 4. Rider-First Recovery State Machine (crash -> sliding -> downed -> rider_rising -> bike_down -> pickup)
  ped.mount(0, 0, 'bicycle', {autoCrash: true})
  ensureDrivable(ped)
  ped.setGear(3)
  ped.setVehicleWorldPos(50, 150, 80)
  for (let i = 0; i < 55; i++) ped.steer(1, 0, 0.05, true)
  for (let i = 0; i < 30; i++) {
    ped.steer(1, 1, 0.05, true, {tuck: true})
    if (ped.crashPhase !== 'none') break
  }
  if (ped.crashPhase === 'none') ped.triggerCrash('lowside', 1)
  check('bicycle enters sliding with bike down', ped.crashPhase === 'sliding' && ped.crashState.bikeIsDown)

  const earlyPickup = ped.startPickup()
  check('pickup rejected while sliding/downed', !earlyPickup.ok && earlyPickup.reason === 'rider_must_stand_first', earlyPickup.reason)

  for (let i = 0; i < 30 && ped.crashPhase === 'sliding'; i++) ped.stepCrash(0.05, {autoStand: false})
  check('settled to downed with separated rider & bike on side', ped.crashPhase === 'downed' && ped.crashState.distToBike > 0.6 && Math.abs(ped.crashState.bikeRoll) > 1.35)

  check('standUp starts rider_rising', ped.standUp() && ped.crashPhase === 'rider_rising')
  for (let i = 0; i < 20 && ped.crashPhase === 'rider_rising'; i++) ped.stepCrash(0.05)
  check(
    'after rider rises -> bike_down (rider on foot, bike STILL sideways)',
    ped.crashPhase === 'bike_down' && ped.crashState.riderOnFoot && ped.crashState.bikeIsDown && Math.abs(ped.crashState.bikeRoll) > 1.35,
  )

  ped.setRiderWorldPos(ped.crashState.bikePos.x + 5.0, 150, ped.crashState.bikePos.z)
  const farPickup = ped.startPickup()
  check('pickup blocked when rider walks > 2.4m away from downed bike', !farPickup.ok && farPickup.reason === 'too_far')

  ped.setRiderWorldPos(ped.crashState.pickupSpot.x, 150, ped.crashState.pickupSpot.z)
  const nearPickup = ped.startPickup()
  check('pickup succeeds when standing rider approaches downed bike', nearPickup.ok && ped.crashPhase === 'picking_up')
  for (let i = 0; i < 20 && ped.crashPhase === 'picking_up'; i++) ped.stepCrash(0.05)
  check('pickup completes -> bike upright, crash cleared, gear reset to default 2挡', ped.crashPhase === 'none' && ped.crashState.justRecoveredToRide && ped.gear === 2 && ped.crashState.bikeRoll === 0)

  // 5. Real E-bike Telemetry & Functional State Machine Gate (P gear, kickstand, lights, turn/hazard, horn, cruise)
  eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false})
  const initExt = readExtendedState(eb)
  const hasRealEbikeProto = initExt.parked !== undefined && initExt.kickstand !== undefined && initExt.headlight !== undefined && initExt.turnSignal !== undefined

  if (!hasRealEbikeProto) {
    checkV2('real e-bike P-gear/kickstand/lights/turn/hazard/horn/cruise telemetry contract', false, 'telemetry fields missing on ride.ts baseline')
  } else {
    // 5a. Default non-verify mount starts in P-gear + kickstand down; throttle blocked with warning
    const warn0 = initExt.parkWarnSeq ?? 0
    for (let i = 0; i < 8; i++) eb.steer(1, 0, 0.05, true)
    const afterParkThrottle = readExtendedState(eb)
    checkV2(
      'default mount enters P-gear & blocks throttle with anti-misuse guard',
      initExt.parked === true && initExt.kickstand === true && initExt.raw.gearLabel === 'P' &&
      eb.speed === 0 && afterParkThrottle.throttleBlockedByPark === true && (afterParkThrottle.parkWarnSeq ?? 1) > warn0,
      `parked=${initExt.parked}, label=${initExt.raw.gearLabel}, speed=${eb.speed}, blocked=${afterParkThrottle.throttleBlockedByPark}`,
    )

    // 5b. Unlock via brake hold (S >= 0.08s), gear select, and explicit toggle + high-speed lockout
    for (let i = 0; i < 4; i++) eb.steer(-1, 0, 0.05, true)
    const unlockedByBrake = readExtendedState(eb)
    for (let i = 0; i < 20; i++) eb.steer(1, 0, 0.05, true)
    const spdDuringMove = eb.speed
    const highSpdParkLocked = eb.setPark?.(true, true) ?? false
    for (let i = 0; i < 24 && eb.speed > 0.05; i++) eb.steer(-1, 0, 0.05, true)
    eb.setPark?.(true, true)
    const stationaryPark = readExtendedState(eb)
    eb.shiftGear?.(1)
    const unlockedByShiftUp = readExtendedState(eb)
    eb.setPark?.(true, true)
    eb.setGear(2)
    const unlockedByGear = readExtendedState(eb)
    checkV2(
      'P-gear unlocks via brake/gear/shift-up (no skip past D2), retracts kickstand, and refuses lock at riding speed',
      unlockedByBrake.parked === false && unlockedByBrake.kickstand === false &&
      spdDuringMove > 2.0 && highSpdParkLocked === false &&
      stationaryPark.parked === true && stationaryPark.kickstand === true && stationaryPark.brakeLight === true &&
      unlockedByShiftUp.parked === false && unlockedByShiftUp.raw.gearLabel === 'D2' &&
      unlockedByGear.parked === false && unlockedByGear.raw.gearLabel === 'D2',
      `brakeUnlock=${unlockedByBrake.parked}, highSpdLock=${highSpdParkLocked}, statPark=${stationaryPark.parked}, shiftUp=${unlockedByShiftUp.raw.gearLabel}, gearUnlock=${unlockedByGear.parked}`,
    )

    // 5c. Bicycle never gets P-gear locked
    ped.mount(0, 0, 'bicycle', {autoCrash: true})
    checkV2('bicycle does not enter P-gear lock', readExtendedState(ped).parked === false)

    // 5d. Headlight cycle (off -> low -> high -> off), taillight, night auto-lowbeam, empty battery cutoff & brake light
    eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false, parkStart: false, envHour: 20})
    const nightInitLight = readExtendedState(eb).headlight
    eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false, parkStart: false})
    const lights = []
    const tails = []
    for (let i = 0; i < 4; i++) {
      const ext = readExtendedState(eb)
      lights.push(ext.headlight)
      tails.push(ext.taillight)
      eb.cycleHeadlight?.() ?? eb.cycleLight?.() ?? eb.steer(0, 0, 0.05, true, {headlightCycle: true})
    }
    eb.setBattery(0)
    eb.steer(1, 0, 0.05, true)
    const emptyLight = readExtendedState(eb).headlight
    eb.cycleHeadlight?.()
    const emptyBlocked = readExtendedState(eb).headlight === 'off'
    eb.setBattery(100)
    checkV2(
      'headlight cycles off/low/high with taillight, night auto-lowbeam, and 0%-battery cutoff',
      nightInitLight === 'low' && new Set(lights.slice(0, 3)).size === 3 && lights[3] === lights[0] &&
      tails[0] === false && tails[1] === true && tails[2] === true && emptyLight === 'off' && emptyBlocked,
      `night=${nightInitLight}, lights=${JSON.stringify(lights)}, empty=${emptyLight}`,
    )

    for (let i = 0; i < 20; i++) eb.steer(1, 0, 0.05, true)
    eb.steer(-1, 0, 0.05, true)
    const brakeOn = readExtendedState(eb).brakeLight === true
    eb.steer(1, 0, 0.05, true)
    const brakeOff = readExtendedState(eb).brakeLight === false
    checkV2('brake light illuminates under braking & clears on throttle', brakeOn && brakeOff, `on=${brakeOn}, off=${brakeOff}`)

    // 5e. Turn signal ('left'/'right'/'off'), blink pulse, hazard dual-flash, and auto-cancel after turn
    eb.setTurnSignal?.('left') ?? eb.steer(0, 0, 0.05, true, {turnLeftToggle: true})
    const leftSet = readExtendedState(eb).turnSignal
    const blinkSamples = []
    for (let i = 0; i < 12; i++) {
      eb.steer(1, 0, 0.05, true)
      const s = readExtendedState(eb)
      blinkSamples.push({blink: s.blinkOn, l: s.leftSignalLit, r: s.rightSignalLit})
    }
    const leftBlinked = blinkSamples.some(s => s.l === true && s.r === false) && blinkSamples.some(s => s.l === false)
    eb.setHazard?.(true) ?? eb.steer(0, 0, 0.05, true, {hazardToggle: true})
    let hazBothLit = false
    for (let i = 0; i < 12; i++) {
      eb.steer(1, 0, 0.05, true)
      const s = readExtendedState(eb)
      if (s.leftSignalLit && s.rightSignalLit) hazBothLit = true
    }
    const hazOn = readExtendedState(eb).hazard === true
    eb.setHazard?.(false)
    checkV2(
      'turn signal & hazard toggle and blink cleanly',
      leftSet === 'left' && leftBlinked && hazOn && hazBothLit && readExtendedState(eb).hazard === false,
      `leftSet=${leftSet}, leftBlinked=${leftBlinked}, hazBothLit=${hazBothLit}`,
    )

    eb.setTurnSignal?.('left')
    for (let i = 0; i < 24; i++) eb.steer(1, -1, 0.05, true)
    for (let i = 0; i < 24; i++) eb.steer(1, 0, 0.05, true)
    const sigAfterStraight = readExtendedState(eb).turnSignal
    checkV2('turn indicator auto-cancels after returning straight', sigAfterStraight === 'off' || sigAfterStraight === 0, `turnSignal=${sigAfterStraight}`)

    // 5f. Horn pulse & release + cruise control min-speed gate, hold & brake cancel
    eb.mount(0, 0, 'bike', {vehicleType: 'normal', autoCrash: true, drainEnabled: false, parkStart: false})
    const horn0 = readExtendedState(eb).hornCount ?? 0
    eb.pulseHorn?.() ?? eb.steer(0, 0, 0.05, true, {horn: true})
    const hornDuring = readExtendedState(eb)
    for (let i = 0; i < 6; i++) eb.steer(0, 0, 0.05, true)
    const hornAfter = readExtendedState(eb)
    checkV2(
      'horn pulse increments seq & clears after pulse duration',
      (hornDuring.hornCount ?? 0) > horn0 && hornDuring.hornActive === true && hornAfter.hornActive === false,
      `seq=${horn0}->${hornDuring.hornCount}, active=${hornDuring.hornActive}->${hornAfter.hornActive}`,
    )

    const lowCruiseRejected = eb.setCruise?.(true, true) === false
    const pedCruiseRejected = ped.setCruise?.(true, true) === false
    eb.setGear(2)
    for (let i = 0; i < 40; i++) eb.steer(1, 0, 0.05, true)
    eb.setCruise?.(true, true) ?? eb.steer(0, 0, 0.05, true, {cruiseToggle: true})
    const cruiseEngaged = readExtendedState(eb).cruise === true
    const vCruise0 = eb.speed
    for (let i = 0; i < 30; i++) eb.steer(0, 0, 0.05, true)
    const vCruiseHold = eb.speed
    eb.steer(-1, 0, 0.05, true)
    const cruiseExited = readExtendedState(eb).cruise === false
    checkV2(
      'cruise control rejects stationary/bicycle, holds speed hands-off & disengages on brake',
      lowCruiseRejected && pedCruiseRejected && cruiseEngaged && vCruiseHold >= vCruise0 * 0.92 && cruiseExited,
      `lowRej=${lowCruiseRejected}, pedRej=${pedCruiseRejected}, engaged=${cruiseEngaged}, ${vCruise0.toFixed(2)}->${vCruiseHold.toFixed(2)}, exited=${cruiseExited}`,
    )

    // 5g. Crash triggers hazard flashers and full recovery clears hazard/turn/park locks
    eb.triggerCrash('lowside', 1)
    const crashHazardOn = readExtendedState(eb).hazard === true
    for (let i = 0; i < 30 && eb.crashPhase === 'sliding'; i++) eb.stepCrash(0.05, {autoStand: false})
    eb.standUp()
    for (let i = 0; i < 20 && eb.crashPhase === 'rider_rising'; i++) eb.stepCrash(0.05)
    eb.setRiderWorldPos(eb.crashState.pickupSpot.x, 0, eb.crashState.pickupSpot.z)
    eb.startPickup()
    for (let i = 0; i < 20 && eb.crashPhase === 'picking_up'; i++) eb.stepCrash(0.05)
    const recoveredExt = readExtendedState(eb)
    checkV2(
      'crash enables hazard lights & full pickup recovery resets hazard/turn/park cleanly',
      crashHazardOn && recoveredExt.hazard === false && recoveredExt.turnSignal === 'off' && recoveredExt.parked === false,
      `crashHaz=${crashHazardOn}, recHaz=${recoveredExt.hazard}, recTurn=${recoveredExt.turnSignal}, recPark=${recoveredExt.parked}`,
    )
  }

  console.log('\nTWOWHEEL QUANTITATIVE MATRIX:', JSON.stringify({
    strictV2: STRICT_V2,
    lowD1,
    midD2,
    midD3,
    carveD3,
    highS,
    carveS,
    highSTuck,
    d2WetNormal,
    d2WetTuck,
    leanRateRatio,
    pedLow,
    pedMid,
    pedHighNoTuck,
    pedFatal,
    pendingV2Count: pendingV2.length,
  }, null, 2))

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:\n- ` + failures.join('\n- '))
    process.exitCode = 1
  } else if (pendingV2.length) {
    console.log(`\nCORE PASSED (${pendingV2.length} V2 boundary/feature gate(s) pending Round-2 implementation; run with --strict-v2 to enforce):`)
    for (const p of pendingV2) console.log(`  - ${p}`)
  } else {
    console.log('\nall two-wheel physics, boundary safety & V2 feature gates passed')
  }
} finally {
  await rm(dir, {recursive: true, force: true})
}
