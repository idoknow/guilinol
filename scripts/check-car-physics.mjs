// Deterministic Node physics verification for GTA-grade car dynamics (web/src/walk/car.ts + config.ts + vehicle-model.ts).
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'

const dir = await mkdtemp(join(tmpdir(), 'glol-gtacar-'))
const carOut = join(dir, 'car-bundle.mjs')
const modelOut = join(dir, 'model-bundle.mjs')

const rapierStub = {
  name: 'stub-rapier',
  setup(b) {
    b.onResolve({filter: /^@dimforge\/rapier3d-compat$/}, () => ({path: 'rapier-stub', namespace: 'stub'}))
    b.onLoad({filter: /.*/, namespace: 'stub'}, () => ({contents: 'export default { Ray: class {} }', loader: 'js'}))
  },
}

try {
  await Promise.all([
    build({entryPoints: ['web/src/walk/car.ts'], outfile: carOut, bundle: true, format: 'esm', platform: 'node', plugins: [rapierStub], logLevel: 'silent'}),
    build({entryPoints: ['web/src/walk/vehicle-model.ts'], outfile: modelOut, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent'}),
  ])

  const {createCarControl} = await import(pathToFileURL(carOut).href)
  const {createDynamicCar} = await import(pathToFileURL(modelOut).href)
  const T = await import('three')

  const DT = 1 / 60
  function stepMany(ctrl, frames, fwd, right, handbrake = false) {
    for (let i = 0; i < frames; i++) ctrl.steer(fwd, right, DT, true, {handbrake})
  }

  const results = []
  function test(name, fn) {
    fn()
    results.push(name)
    console.log(`  ok   ${name}`)
  }

  test('standstill steering produces zero pivot rotation', () => {
    const c = createCarControl()
    c.mount(0, 0, {mode: 'street', gtaPhysics: true})
    stepMany(c, 30, 0, 1, false)
    assert.equal(c.heading, 0)
    assert.equal(c.speed, 0)
  })

  test('classic verify compliant mode caps at 40 km/h and stops cleanly on wall hit', () => {
    const c = createCarControl()
    c.mount(0, 0, {mode: 'cruise', gtaPhysics: false})
    stepMany(c, 300, 1, 0, false)
    const tel = c.telemetry()
    assert(tel.speed >= 10.5 && tel.speed <= 40 / 3.6 + 1e-3, `cruise speed out of bounds: ${tel.speed}`)
    assert.equal(tel.mode, 'cruise')
    const res = c.resolveMove({
      pos: {x: 0, y: 1.7 / 2, z: 0}, next: {x: 0, z: -0.2}, move: {x: 0, z: -0.2},
      heading: c.heading, speed: c.speed, step: DT,
      motorPavement: () => true, insideHouse: () => true, carBlockedAt: () => true,
      collisionKind: () => 'building', stopCar: () => c.stop(), dampCar: s => c.dampSpeed(s),
    })
    assert.equal(res.blocked, true)
    assert.equal(res.speed, 0)
  })

  test('3 drive modes unlock 40 / 75 / 108 km/h and 5-speed auto upshift D1->D5', () => {
    const c = createCarControl()
    c.mount(0, 0, {mode: 'cruise', gtaPhysics: true})
    stepMany(c, 360, 1, 0)
    const cruiseKmh = c.telemetry().kmh
    assert(cruiseKmh >= 38 && cruiseKmh <= 41, `cruise kmh=${cruiseKmh}`)

    c.setMode('street')
    stepMany(c, 360, 1, 0)
    const streetTel = c.telemetry()
    assert(streetTel.kmh >= 72 && streetTel.kmh <= 76, `street kmh=${streetTel.kmh}`)
    assert(streetTel.gear >= 4, `expected street gear>=4, got D${streetTel.gear}`)

    c.setMode('sport')
    const seenGears = new Set([streetTel.gear])
    for (let i = 0; i < 420; i++) {
      c.steer(1, 0, DT, true)
      seenGears.add(c.gear)
    }
    const sportTel = c.telemetry()
    assert(sportTel.kmh >= 103 && sportTel.kmh <= 109, `sport kmh=${sportTel.kmh}`)
    assert(sportTel.gear === 5 && seenGears.has(5), `expected D5 in sport mode, got D${sportTel.gear}`)
    assert(sportTel.rpm > 4500, `expected high rpm, got ${sportTel.rpm}`)
  })

  test('low-speed Ackermann turning radius stays in [4.6, 6.2]m & reverse sign matches', () => {
    const c = createCarControl()
    c.mount(0, 0, {mode: 'street', gtaPhysics: true})
    stepMany(c, 30, 0, -1)
    stepMany(c, 16, 1, -1)
    const h0 = c.heading
    c.steer(1, -1, DT, true)
    const omega = Math.abs(c.heading - h0) / DT
    const radius = c.speed / omega
    assert(radius >= 4.6 && radius <= 6.2, `turnRadius=${radius.toFixed(2)}m`)

    c.stop()
    stepMany(c, 20, -1, 0)
    stepMany(c, 45, -1, 0)
    assert(c.speed < -2.0 && c.gear === -1 && c.telemetry().gearLabel === 'R', `reverse failed: spd=${c.speed}`)
    const rh0 = c.heading
    stepMany(c, 24, -1, 1)
    const rDelta = Math.atan2(Math.sin(c.heading - rh0), Math.cos(c.heading - rh0))
    assert(rDelta > .04, `reverse right-steer heading delta=${rDelta}`)
  })

  test('Space handbrake induces GTA lateral drift slip, outward body roll & smooth recovery', () => {
    const c = createCarControl()
    c.mount(0, 0, {mode: 'street', gtaPhysics: true})
    stepMany(c, 180, 1, 0)
    let maxSlip = 0, maxDrift = 0, maxRoll = 0
    for (let i = 0; i < 42; i++) {
      c.steer(.6, 1, DT, true, {handbrake: true})
      const t = c.telemetry()
      maxSlip = Math.max(maxSlip, Math.abs(t.slipAngle))
      maxDrift = Math.max(maxDrift, t.driftIntensity)
      maxRoll = Math.max(maxRoll, Math.abs(t.dynRoll))
    }
    assert(maxSlip > .18, `drift slipAngle=${maxSlip.toFixed(3)}`)
    assert(maxDrift > .45, `driftIntensity=${maxDrift.toFixed(3)}`)
    assert(maxRoll > .05, `outward roll=${maxRoll.toFixed(3)}`)

    stepMany(c, 60, .4, 0, false)
    assert(Math.abs(c.vLat) < .5, `drift recovery |vLat|=${Math.abs(c.vLat).toFixed(3)}`)
  })

  test('weight transfer: launch squat (+dynPitch) and hard brake nose-dive (-dynPitch)', () => {
    const c = createCarControl()
    c.mount(0, 0, {mode: 'sport', gtaPhysics: true})
    let maxSquat = 0
    for (let i = 0; i < 45; i++) {
      c.steer(1, 0, DT, true)
      maxSquat = Math.max(maxSquat, c.dynPitch)
    }
    assert(maxSquat > .025, `launch squat=${maxSquat.toFixed(4)}`)

    stepMany(c, 90, 1, 0)
    let minDive = 0
    for (let i = 0; i < 24; i++) {
      c.steer(-1, 0, DT, true)
      minDive = Math.min(minDive, c.dynPitch)
    }
    assert(minDive < -.035, `brake nose-dive=${minDive.toFixed(4)}`)
  })

  test('high-speed wall impact produces momentum rebound, impact pulse & damage', () => {
    const c = createCarControl()
    c.mount(0, 0, {mode: 'street', gtaPhysics: true})
    stepMany(c, 180, 1, 0)
    assert(c.speed > 14, `pre-impact speed=${c.speed}`)
    const res = c.resolveMove({
      pos: {x: 0, y: 1.7 / 2, z: 0}, next: {x: 0, z: -0.3}, move: {x: 0, z: -0.3},
      heading: c.heading, speed: c.speed, step: DT,
      motorPavement: () => true, insideHouse: () => true, carBlockedAt: () => true,
      collisionKind: () => 'building', stopCar: () => c.stop(), dampCar: s => c.dampSpeed(s),
    })
    assert.equal(res.blocked, true)
    assert(res.speed < -1.0, `rebound speed=${res.speed}`)
    assert(c.consumeImpactPulse() > .5, 'expected strong impact pulse')
    assert(c.telemetry().damage > 0, 'expected cumulative impact damage > 0')
  })

  test('CarVisualRig rear wheel lock on handbrake + world drift smoke emission + impact jounce', () => {
    const rig = createDynamicCar(1)
    const pos = new T.Vector3(0, 150, 0)
    rig.update({pos, heading: 0, groundPitch: 0, speed: 12, steerInput: .5, braking: false, reversing: false, dynRoll: .08, dynPitch: .03, driftIntensity: .7, handbrake: true, dt: .05})
    const p1 = rig.probe()
    const rearBefore = p1.rearWheelSpin
    const frontBefore = p1.wheelSpin
    rig.update({pos, heading: .1, groundPitch: 0, speed: 12, steerInput: .5, braking: false, reversing: false, dynRoll: .08, dynPitch: .03, driftIntensity: .7, handbrake: true, dt: .05})
    const p2 = rig.probe()
    assert.equal(p2.rearWheelSpin, rearBefore, 'rear wheels must lock during handbrake drift')
    assert(p2.wheelSpin !== frontBefore, 'front wheels must keep rolling during handbrake')
    assert(p2.smokeActive > 0, `expected active drift smoke puffs, got ${p2.smokeActive}`)
    rig.triggerImpact(1.4)
    rig.update({pos, heading: .1, groundPitch: 0, speed: 0, steerInput: 0, braking: true, reversing: false, dynRoll: 0, dynPitch: -.05, driftIntensity: 0, handbrake: false, dt: .05})
    assert(rig.probe().heave < -.005, `expected impact heave compression, got ${rig.probe().heave}`)
    rig.dispose()
  })

  console.log(`\nALL ${results.length} GTA CAR PHYSICS & RIG CHECKS PASSED`)
} finally {
  await rm(dir, {recursive: true, force: true})
}
