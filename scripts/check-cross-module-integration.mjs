// Deterministic Node integration check for the 3 cross-module problem domains on local/play-all:
//  1. Keyboard/touch conflict guards (KeyP photo vs P-gear, touch control zones)
//  2. Two-wheel crash/standup/pickup <-> P-gear/kickstand/hazard state coupling
//  3. Night headlight beam rendering performance (zero dynamic Three.js lights, <=2 draw calls, wheelie/crash/battery/night curves)
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import * as T from 'three'

const dir = await mkdtemp(join(tmpdir(), 'glol-xmod-'))
const guardOut = join(dir, 'input-guard.mjs')
const couplingOut = join(dir, 'coupling.mjs')
const modelOut = join(dir, 'vehicle-model.mjs')

try {
  await Promise.all([
    build({entryPoints: ['web/src/walk/input-guard.ts'], outfile: guardOut, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent'}),
    build({entryPoints: ['web/src/walk/ebike-state-coupling.ts'], outfile: couplingOut, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent'}),
    build({entryPoints: ['web/src/walk/vehicle-model.ts'], outfile: modelOut, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent'}),
  ])

  const guard = await import(pathToFileURL(guardOut).href)
  const coupling = await import(pathToFileURL(couplingOut).href)
  const {createDynamicEbike, createDynamicCar} = await import(pathToFileURL(modelOut).href)

  let passed = 0
  function test(name, fn) {
    fn()
    passed++
    console.log(`  ok   ${name}`)
  }

  // --- 1. KeyP & Touch Conflict Guards ---
  test('KeyP yields to e-bike P-gear when aboard upright bike without modifiers', () => {
    assert.equal(guard.shouldPhotoYieldKeyP({photoActive: false, aboard: true, rideKind: 'bike', rideCrashed: false}), true)
    // Shift+P still opens photo mode while riding
    assert.equal(guard.shouldPhotoYieldKeyP({photoActive: false, shiftKey: true, aboard: true, rideKind: 'bike'}), false)
    // KeyP ALWAYS exits active photo mode
    assert.equal(guard.shouldPhotoYieldKeyP({photoActive: true, aboard: true, rideKind: 'bike'}), false)
    // On foot / car / bicycle / boat / crashed bike: KeyP still controls photo mode
    assert.equal(guard.shouldPhotoYieldKeyP({photoActive: false, aboard: false}), false)
    assert.equal(guard.shouldPhotoYieldKeyP({photoActive: false, aboard: true, rideKind: 'car'}), false)
    assert.equal(guard.shouldPhotoYieldKeyP({photoActive: false, aboard: true, rideKind: 'bicycle'}), false)
    assert.equal(guard.shouldPhotoYieldKeyP({photoActive: false, aboard: true, rideKind: 'bike', rideCrashed: true}), false)
  })

  test('Touch control zone guard shields left joystick & right riding buttons without blocking center camera drag', () => {
    const base = {innerWidth: 390, innerHeight: 844, panelVisible: true, photoOn: false, aboard: true}
    // Bottom-left joystick gutter blocked
    assert.equal(guard.isTouchInControlZone({...base, clientX: 80, clientY: 740}), true)
    // Bottom-right riding action buttons (+gear/-gear/wheelie/tuck) blocked
    assert.equal(guard.isTouchInControlZone({...base, clientX: 240, clientY: 780}), true)
    // Center/upper viewport open for 1-finger orbit & 2-finger pinch zoom
    assert.equal(guard.isTouchInControlZone({...base, clientX: 200, clientY: 360}), false)
    // IDOK-171: the look stick is gone, so its old corner pad drags the camera again (portrait & landscape)
    assert.equal(guard.isTouchInControlZone({...base, aboard: false, clientX: 330, clientY: 790}), false)
    assert.equal(guard.isTouchInControlZone({innerWidth: 844, innerHeight: 390, panelVisible: true, photoOn: false, aboard: false, clientX: 790, clientY: 330}), false)
    // ...while the button gutter just above/left of it still swallows sloppy taps
    assert.equal(guard.isTouchInControlZone({...base, aboard: false, clientX: 250, clientY: 700}), true)
    // Photo mode opens full canvas for orbit
    assert.equal(guard.isTouchInControlZone({...base, photoOn: true, clientX: 80, clientY: 740}), false)
  })

  // --- 2. Crash/StandUp/Pickup <-> P-gear/Kickstand/Hazard State Coupling ---
  test('Mount obeys verify compatibility, auto-enables low beam at night, and blocks high-speed P/kickstand', () => {
    let st = coupling.createInitialTwoWheelOpState()
    st = coupling.resolveTwoWheelTransition(st, {type: 'mount', kind: 'bike', verifyMode: true, nightLevel: 0}).state
    assert.equal(st.parkLocked, false)
    assert.equal(st.kickstandDown, false)
    assert.equal(st.headlight, 'off')

    const nightMount = coupling.resolveTwoWheelTransition(st, {type: 'mount', kind: 'bike', verifyMode: false, nightLevel: 0.85}).state
    assert.equal(nightMount.headlight, 'low')

    // Reject P-gear and kickstand at riding speed
    const hiPark = coupling.resolveTwoWheelTransition(st, {type: 'toggle_park', kind: 'bike', speedMs: 6.5, crashLocked: false})
    assert.equal(hiPark.changed, false)
    assert.equal(hiPark.rejectedReason, 'speed_too_high')
    const hiStand = coupling.resolveTwoWheelTransition(st, {type: 'toggle_kickstand', kind: 'bike', speedMs: 4.0, crashLocked: false})
    assert.equal(hiStand.changed, false)
    assert.equal(hiStand.rejectedReason, 'speed_too_high')

    // Stationary side-stand power cutoff couples kickstand <-> P-gear bidirectionally
    const standDown = coupling.resolveTwoWheelTransition(st, {type: 'toggle_kickstand', kind: 'bike', speedMs: 0, crashLocked: false}).state
    assert.equal(standDown.kickstandDown, true)
    assert.equal(standDown.parkLocked, true)
    assert.equal(coupling.isDriveLockedByParkOrStand(standDown), true)

    const parkOff = coupling.resolveTwoWheelTransition(standDown, {type: 'toggle_park', kind: 'bike', speedMs: 0, crashLocked: false}).state
    assert.equal(parkOff.parkLocked, false)
    assert.equal(parkOff.kickstandDown, false)
    assert.equal(coupling.isDriveLockedByParkOrStand(parkOff), false)
  })

  test('Crash -> StandUp -> Pickup -> Upright preserves kickstand retraction while downed and parks cleanly on pickup', () => {
    let st = coupling.resolveTwoWheelTransition(coupling.createInitialTwoWheelOpState(), {
      type: 'mount', kind: 'bike', verifyMode: false, nightLevel: 0.9,
    }).state

    // Crash: kickstand retracts, P-gear off, hazard ON
    st = coupling.resolveTwoWheelTransition(st, {type: 'crash', kind: 'bike'}).state
    assert.equal(st.kickstandDown, false)
    assert.equal(st.parkLocked, false)
    assert.equal(st.hazard, true)

    // P-gear & kickstand toggle blocked while crashed
    const crashPark = coupling.resolveTwoWheelTransition(st, {type: 'toggle_park', kind: 'bike', speedMs: 0, crashLocked: true})
    assert.equal(crashPark.changed, false)
    assert.equal(crashPark.rejectedReason, 'crash_locked')

    // StandUp: bike stays down with hazard ON and kickstand stowed
    st = coupling.resolveTwoWheelTransition(st, {type: 'standup', kind: 'bike'}).state
    assert.equal(st.kickstandDown, false)
    assert.equal(st.hazard, true)

    // Pickup animation roll interpolates smoothly from -1.43 to kickstand rest angle (-0.105)
    assert.equal(coupling.computePickupRoll(-1.43, 0, true), -1.43)
    assert(Math.abs(coupling.computePickupRoll(-1.43, 1, true) - coupling.KICKSTAND_REST_ROLL_RAD) < 1e-6)

    // Pickup complete: upright on foot -> hazard OFF, kickstand DOWN, P-gear ON, headlight OFF
    st = coupling.resolveTwoWheelTransition(st, {type: 'pickup_complete', kind: 'bike'}).state
    assert.equal(st.hazard, false)
    assert.equal(st.kickstandDown, true)
    assert.equal(st.parkLocked, true)
    assert.equal(st.headlight, 'off')
  })

  // --- 3. Night Headlight Beam Rendering Performance & Visual Rig ---
  test('E-bike & Car rigs use ZERO dynamic Three.js lights (no shader recompilation hitch) and <=2 draw calls', () => {
    const ebike = createDynamicEbike(0)
    const car = createDynamicCar(0)

    const countLights = root => {
      let n = 0
      root.traverse(obj => { if (obj.isLight) n++ })
      return n
    }
    assert.equal(countLights(ebike.root), 0, 'ebike rig must not inject dynamic Three.js lights')
    assert.equal(countLights(car.root), 0, 'car rig must not inject dynamic Three.js lights')

    const pos = new T.Vector3()
    // Off state => 0 draw calls
    ebike.update({pos, heading: 0, groundPitch: 0, lean: 0, wheelie: 0, steerInput: 0, speed: 0, headlight: 'off', night: 1, dt: 0})
    assert.equal(ebike.beamProbe().drawCalls, 0)
    assert.equal(ebike.beamProbe().beamActive, false)

    // Night low vs high progression, strictly <= 2 draw calls
    ebike.update({pos, heading: 0, groundPitch: 0, lean: 0, wheelie: 0, steerInput: 0, speed: 5, headlight: 'low', night: 1, dt: 0.05})
    const lowNight = ebike.beamProbe()
    ebike.update({pos, heading: 0, groundPitch: 0, lean: 0, wheelie: 0, steerInput: 0, speed: 5, headlight: 'high', night: 1, dt: 0.05})
    const highNight = ebike.beamProbe()
    ebike.update({pos, heading: 0, groundPitch: 0, lean: 0, wheelie: 0, steerInput: 0, speed: 5, headlight: 'high', night: 0, dt: 0.05})
    const highDay = ebike.beamProbe()

    assert(lowNight.beamActive && lowNight.drawCalls === 2)
    assert(highNight.beamActive && highNight.drawCalls === 2)
    assert(highNight.intensity > lowNight.intensity, `high (${highNight.intensity}) should exceed low (${lowNight.intensity})`)
    assert(highNight.intensity > highDay.intensity * 2.5, `night beam (${highNight.intensity}) should far exceed daytime (${highDay.intensity})`)

    // Wheelie fades road pool off cleanly; crash hides pool & dims cone
    ebike.update({pos, heading: 0, groundPitch: 0, lean: 0, wheelie: 0.45, steerInput: 0, speed: 6, headlight: 'high', night: 1, dt: 0.05})
    assert.equal(ebike.beamProbe().poolVisible, false)
    assert.equal(ebike.beamProbe().drawCalls, 1)

    ebike.update({pos, heading: 0, groundPitch: 0, lean: 0, wheelie: 0, steerInput: 0, speed: 0, headlight: 'high', night: 1, crashed: true, crashRoll: -1.4, kickstandDown: true, dt: 0})
    assert.equal(ebike.beamProbe().poolVisible, false)
    assert(ebike.beamProbe().intensity < highNight.intensity * 0.4)
    assert.equal(ebike.kickstandAngle, 0, 'kickstand must stay stowed when crashed')

    // Upright parked deploys kickstand smoothly
    ebike.update({pos, heading: 0, groundPitch: 0, lean: 0, wheelie: 0, steerInput: 0, speed: 0, headlight: 'off', night: 1, crashed: false, kickstandDown: true, dt: 0})
    assert(ebike.kickstandAngle > 0.38, `expected deployed kickstandAngle > 0.38, got ${ebike.kickstandAngle}`)

    // Battery depleted dims beam
    ebike.update({pos, heading: 0, groundPitch: 0, lean: 0, wheelie: 0, steerInput: 0, speed: 2, headlight: 'high', night: 1, batteryDepleted: true, dt: 0.05})
    assert(ebike.beamProbe().intensity < highNight.intensity * 0.5)

    // Batched amber turn signals: 0 idle draw calls, 1 draw call single-side, 2 draw calls hazard, 0 dynamic lights
    ebike.update({pos, heading: 0, groundPitch: 0, lean: 0, wheelie: 0, steerInput: 0, speed: 4, headlight: 'off', night: 1, leftSignalLit: false, rightSignalLit: false, dt: 0.05})
    assert.equal(ebike.signalProbe().signalDrawCalls, 0)
    ebike.update({pos, heading: 0, groundPitch: 0, lean: 0, wheelie: 0, steerInput: 0, speed: 4, headlight: 'off', night: 1, leftSignalLit: true, rightSignalLit: false, dt: 0.05})
    assert.equal(ebike.signalProbe().leftSignalLit, true)
    assert.equal(ebike.signalProbe().rightSignalLit, false)
    assert.equal(ebike.signalProbe().signalDrawCalls, 1)
    ebike.update({pos, heading: 0, groundPitch: 0, lean: 0, wheelie: 0, steerInput: 0, speed: 0, headlight: 'off', night: 1, leftSignalLit: true, rightSignalLit: true, brakeLight: true, dt: 0.05})
    assert.equal(ebike.signalProbe().signalDrawCalls, 2)
    assert.equal(ebike.signalProbe().brakeLight, true)
    assert.equal(countLights(ebike.root), 0, 'signals must not inject dynamic Three.js lights')

    // Car twin-headlamp beams also use strictly <= 2 draw calls (merged twin cone + 1 pool)
    car.update({pos, heading: 0, groundPitch: 0, speed: 10, steerInput: 0, braking: false, reversing: false, headlight: 'off', night: 1, dt: 0.05})
    assert.equal(car.probe().beamDrawCalls, 0)
    car.update({pos, heading: 0, groundPitch: 0, speed: 10, steerInput: 0, braking: false, reversing: false, headlight: 'high', night: 1, dt: 0.05})
    assert.equal(car.probe().beamDrawCalls, 2)
    assert(car.probe().beamActive && car.probe().headlightIntensity > 0.3)

    ebike.dispose()
    car.dispose()
  })

  console.log(`\nALL ${passed} CROSS-MODULE INTEGRATION CHECKS PASSED`)
} finally {
  await rm(dir, {recursive: true, force: true})
}
