// IDOK-544 载具操控台单测：覆盖电车（个人/共享锁速锁灯/边撑）、汽车（点火/PRND/未挂P挡提醒/踏板/喇叭）、
// 小船（罗盘/航速/船灯/舵桨/画舫乘客态）以及每帧同状态零 DOM 写入红线。
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createVehicleControls} from './vehicle-controls.ts'

class FakeClassList {
  #set = new Set()
  constructor(init = '') {
    for (const c of init.split(/\s+/).filter(Boolean)) this.#set.add(c)
  }
  add(...names) { for (const n of names) if (n) this.#set.add(n) }
  remove(...names) { for (const n of names) this.#set.delete(n) }
  contains(name) { return this.#set.has(name) }
  toggle(name, force) {
    const next = force === undefined ? !this.#set.has(name) : !!force
    if (next) this.#set.add(name); else this.#set.delete(name)
    return next
  }
  toString() { return [...this.#set].join(' ') }
}

class FakeStyle {
  #props = new Map()
  setProperty(name, value) { this.#props.set(name, String(value)) }
  getPropertyValue(name) { return this.#props.get(name) ?? '' }
}

class FakeEl {
  tagName
  ownerDocument
  children = []
  parentElement = null
  style = new FakeStyle()
  hidden = false
  #attrs = new Map()
  #classList = new FakeClassList()
  #listeners = new Map()
  #text = ''
  constructor(doc, tag) {
    this.ownerDocument = doc
    this.tagName = tag.toUpperCase()
  }
  get className() { return this.#classList.toString() }
  set className(v) { this.#classList = new FakeClassList(String(v ?? '')) }
  get classList() { return this.#classList }
  get firstChild() { return this.children[0] ?? null }
  get textContent() {
    if (!this.children.length) return this.#text
    return this.children.map(c => (typeof c === 'string' ? c : c.textContent)).join('')
  }
  set textContent(v) {
    this.children = []
    this.#text = String(v ?? '')
  }
  append(...kids) {
    for (const k of kids) {
      if (typeof k === 'string') this.children.push(k)
      else { k.parentElement = this; this.children.push(k) }
    }
  }
  prepend(...kids) {
    for (let i = kids.length - 1; i >= 0; i--) {
      const k = kids[i]
      if (typeof k === 'string') this.children.unshift(k)
      else { k.parentElement = this; this.children.unshift(k) }
    }
  }
  removeChild(child) {
    const idx = this.children.indexOf(child)
    if (idx >= 0) this.children.splice(idx, 1)
    if (child && typeof child === 'object') child.parentElement = null
    return child
  }
  setAttribute(name, value) { this.#attrs.set(name, String(value)) }
  getAttribute(name) { return this.#attrs.has(name) ? this.#attrs.get(name) : null }
  removeAttribute(name) { this.#attrs.delete(name) }
  addEventListener(type, fn) {
    const list = this.#listeners.get(type) ?? []
    list.push(fn)
    this.#listeners.set(type, list)
  }
  removeEventListener(type, fn) {
    const list = this.#listeners.get(type)
    if (!list) return
    const idx = list.indexOf(fn)
    if (idx >= 0) list.splice(idx, 1)
  }
  dispatch(type, ev = {}) {
    const event = {preventDefault() {}, stopPropagation() {}, pointerId: 1, ...ev}
    for (const fn of [...(this.#listeners.get(type) ?? [])]) fn(event)
  }
  setPointerCapture() {}
}

function createFakeEnv() {
  const winListeners = new Map()
  const events = []
  const toasts = []
  let nowMs = 1000
  const doc = {
    body: null,
    createElement(tag) { return new FakeEl(doc, tag) },
  }
  doc.body = new FakeEl(doc, 'body')
  const win = {
    addEventListener(type, fn) {
      const list = winListeners.get(type) ?? []
      list.push(fn)
      winListeners.set(type, list)
    },
    removeEventListener(type, fn) {
      const list = winListeners.get(type)
      if (!list) return
      const idx = list.indexOf(fn)
      if (idx >= 0) list.splice(idx, 1)
    },
    dispatchEvent(ev) {
      events.push({type: ev.type, detail: ev.detail})
      for (const fn of [...(winListeners.get(ev.type) ?? [])]) fn(ev)
      return true
    },
    setTimeout() { return 1 },
    clearTimeout() {},
  }
  const hud = doc.createElement('div')
  const panel = doc.createElement('div')
  const wheelie = doc.createElement('button')
  const vc = createVehicleControls({
    hud, panel, doc, win, body: doc.body, wheelieButton: wheelie,
    now: () => nowMs,
    toast: (text, ms) => toasts.push({text, ms}),
    expose: false,
  })
  return {doc, win, hud, panel, wheelie, vc, events, toasts, advance(ms) { nowMs += ms }}
}

function makeEbikeSnap(over = {}) {
  return {
    vehicleType: 'normal',
    vehicleLabel: '普通电动车',
    vehicleBadge: '电摩',
    gear: 2,
    gearCount: 4,
    gearLabel: 'D2',
    gearHint: '合规',
    maxKmh: 25,
    speed: 5.5,
    kmh: 20,
    battery: 84,
    lowBattery: false,
    criticalBattery: false,
    batteryDepleted: false,
    lean: 0.05,
    leanLimit: 0.48,
    leanDangerRatio: 0.1,
    crashRisk: 0.1,
    wheelie: 0,
    steerInput: 0,
    tucking: false,
    braking: false,
    parkLocked: false,
    kickstandDown: false,
    headlight: 'low',
    turnSignal: 'off',
    leftSignalLit: false,
    rightSignalLit: false,
    hazard: false,
    blinkOn: false,
    hornActive: false,
    cruiseControl: false,
    crashPhase: 'none',
    crashReason: '',
    crashSide: 1,
    crashElapsed: 0,
    recoverProgress: 0,
    modPreset: 'stock',
    ...over,
  }
}

function makeCarSnap(over = {}) {
  return {
    mode: 'street',
    modeIndex: 2,
    modeLabel: '街道',
    maxKmh: 75,
    gear: 1,
    gearLabel: 'D1',
    rpm: 2400,
    rpmRatio: 0.38,
    speed: 0,
    kmh: 0,
    vLong: 0,
    vLat: 0,
    velX: 0,
    velZ: 0,
    yawRate: 0,
    slipAngle: 0,
    driftIntensity: 0,
    handbrake: false,
    braking: false,
    reversing: false,
    shifting: false,
    dynRoll: 0,
    dynPitch: 0,
    impactStrength: 0,
    damage: 0,
    gtaPhysics: true,
    ...over,
  }
}

test('personal vs shared e-bike: kickstand, headlight lock, 25 km/h cap & zero redundant DOM writes', () => {
  const {hud, panel, vc, toasts, events} = createFakeEnv()
  const personal = makeEbikeSnap({kickstandDown: true, parkLocked: true, headlight: 'high'})
  vc.syncRide(personal, 'bike')

  assert.equal(hud.getAttribute('data-vc-ride'), 'bike')
  assert.equal(hud.getAttribute('data-vc-tier'), 'personal')
  assert.equal(vc.refs.kickstand.getAttribute('data-state'), 'down')
  assert.equal(vc.refs.light.getAttribute('data-mode'), 'high')
  assert.equal(vc.refs.light.getAttribute('data-locked'), null)
  assert.equal(vc.lightLocked(), false)
  assert.equal(vc.refs.gear.textContent, 'P')
  assert.equal(vc.refs.speed.textContent, '20 km/h')
  assert.equal(vc.refs.batPct.textContent, '84%')

  // Hot-path: identical frame must cause 0 DOM mutations
  vc.writer.reset()
  vc.syncRide(personal, 'bike')
  assert.equal(vc.writer.count, 0, 'identical e-bike telemetry must perform 0 DOM writes')

  // Kickstand click emits kickstandToggle pulse & hook event
  vc.refs.kickstand.dispatch('click')
  const pulses = vc.consumePulses()
  assert.equal(pulses.kickstandToggle, true)
  assert.equal(events.at(-1)?.detail?.action, 'kickstand')

  // Switch to shared e-bike: tier=shared, headlight locked, 25 km/h lock badge shown
  const shared = makeEbikeSnap({vehicleType: 'shared', vehicleBadge: '共享', vehicleLabel: '共享电动车', maxKmh: 18, headlight: 'low', kickstandDown: false, parkLocked: false})
  vc.syncRide(shared, 'bike')
  assert.equal(hud.getAttribute('data-vc-tier'), 'shared')
  assert.equal(panel.getAttribute('data-vc-tier'), 'shared')
  assert.equal(vc.isShared(), true)
  assert.equal(vc.lightLocked(), true)
  assert.equal(vc.refs.light.getAttribute('data-locked'), '1')
  assert.equal(vc.refs.light.getAttribute('aria-disabled'), 'true')
  assert.equal(vc.refs.cap.textContent, '25 km/h 锁速')

  vc.lockedPress('light', 'click')
  assert.equal(toasts.at(-1)?.text, '共享电单车车灯由平台锁定，不能手动切换')
  assert.equal(events.at(-1)?.detail?.action, 'light-locked')

  // External hook can override shared speed cap (IDOK-545)
  vc.patch({sharedSpeedCapKmh: 25})
  vc.syncRide(shared, 'bike')
  assert.equal(vc.refs.capNum.textContent, '25')
  vc.dispose()
})

test('car cockpit: ignition toggle, throttle gating, PRND selector, not-in-P warning & pedal axes', () => {
  const {hud, vc, toasts, events, advance} = createFakeEnv()
  const hookLog = []
  vc.setHooks({
    onIgnitionToggle: (on, src) => hookLog.push(['ign', on, src]),
    onCarGearSelect: (g, src) => hookLog.push(['gear', g, src]),
  })

  const parked = makeCarSnap({kmh: 0, speed: 0, gear: 1, gearLabel: 'D1'})
  vc.syncCar(parked, 'low')
  assert.equal(hud.getAttribute('data-vc-ride'), 'car')
  assert.equal(vc.engineOn, true)
  assert.equal(vc.refs.prnd.getAttribute('data-sel'), 'P')
  assert.equal(vc.refs.light.getAttribute('data-mode'), 'low')

  // Hot-path: identical car frame performs 0 DOM writes
  vc.writer.reset()
  vc.syncCar(parked, 'low')
  assert.equal(vc.writer.count, 0, 'identical car telemetry must perform 0 DOM writes')

  // Shift to D & trigger not-in-P warning
  vc.selectCarGear('D', 'click')
  assert.equal(vc.refs.prnd.getAttribute('data-sel'), 'D')
  assert.deepEqual(hookLog.at(-1), ['gear', 'D', 'click'])

  vc.triggerNotInPWarn(1500)
  assert.equal(vc.refs.prnd.getAttribute('data-warn-p'), '1')
  assert.equal(vc.refs.warn.hidden, false)

  // Shifting back to P clears warning immediately
  vc.selectCarGear('P', 'click')
  assert.equal(vc.refs.prnd.getAttribute('data-warn-p'), null)
  assert.equal(vc.refs.warn.hidden, true)

  // Ignition OFF blocks gas when stopped, emits hint once, still allows brake when coasting
  assert.equal(vc.toggleIgnition('key'), false)
  assert.equal(vc.engineOn, false)
  assert.equal(hud.getAttribute('data-engine'), 'off')
  assert.equal(vc.gateForward(1), 0)
  assert.equal(toasts.length, 1)
  assert.equal(vc.gateForward(1), 0)
  assert.equal(toasts.length, 1, 'toast should not spam on held gas')

  // Coasting car with engine off still permits braking
  vc.syncCar(makeCarSnap({kmh: 18, speed: 5}), 'low')
  assert.equal(vc.gateForward(-1), -1)
  assert.equal(vc.gateForward(1), 0)

  // Pedal pointer hold drives virtual forward axis
  vc.toggleIgnition('click')
  vc.thumbs.gas.dispatch('pointerdown', {pointerId: 7})
  assert.deepEqual(vc.axes(), {forward: 1, right: 0})
  vc.thumbs.gas.dispatch('pointerup', {pointerId: 7})
  assert.deepEqual(vc.axes(), {forward: 0, right: 0})

  // External patch overrides gear & notInPWarn (IDOK-546 integration)
  vc.patch({gear: 'R', notInPWarn: true})
  assert.equal(vc.refs.prnd.getAttribute('data-sel'), 'R')
  assert.equal(vc.refs.prnd.getAttribute('data-warn-p'), '1')
  assert.ok(events.some(e => e.detail?.action === 'ignition'))
  advance(3000)
  vc.dispose()
})

test('boat cockpit: compass heading, speed km/h, shore status, boat lantern, helm axes & tour boat mode', () => {
  const {hud, panel, vc, events} = createFakeEnv()
  const boatSnap = {
    probe: {
      kind: 'freeRaft', x: 0, y: 0, waterY: 0, z: 0,
      heading: Math.PI / 2, speed: 2.5, vLong: 2.5, vLat: 0, vx: 0, vz: 0,
      blocked: false, reason: '', blockReason: '', clearance: 4.0, toast: '',
    },
    heading: Math.PI / 2,
    speed: 2.5,
    freeKind: 'freeRaft',
    isTourBoat: false,
  }
  vc.syncBoat(boatSnap)
  assert.equal(hud.getAttribute('data-vc-ride'), 'boat')
  assert.equal(hud.getAttribute('data-vc-tier'), 'boat')
  assert.equal(hud.getAttribute('data-vc-free'), 'freeRaft')
  assert.equal(panel.getAttribute('data-vc-free'), 'freeRaft')
  assert.equal(vc.refs.boatKind.textContent, '竹筏')
  assert.equal(vc.refs.boatSpeedNum.textContent, '9.0')
  assert.equal(vc.refs.compass.style.getPropertyValue('--vc-compass-deg'), '90deg')
  assert.equal(vc.refs.boatStatus.textContent, '通航')

  // Hot-path: identical boat frame performs 0 DOM writes
  vc.writer.reset()
  vc.syncBoat(boatSnap)
  assert.equal(vc.writer.count, 0, 'identical boat telemetry must perform 0 DOM writes')

  // Boat lantern toggle
  assert.equal(vc.toggleBoatLight('key'), true)
  assert.equal(vc.refs.boatLight.getAttribute('aria-pressed'), 'true')
  assert.equal(vc.consumePulses().boatLightToggle, true)
  assert.equal(events.at(-1)?.detail?.action, 'boat-light')

  // Helm touch holds produce combined forward + steer axes
  vc.thumbs.row.dispatch('pointerdown', {pointerId: 11})
  vc.thumbs.stbd.dispatch('pointerdown', {pointerId: 12})
  assert.deepEqual(vc.axes(), {forward: 1, right: 1})
  vc.thumbs.stbd.dispatch('pointerup', {pointerId: 12})
  vc.thumbs.port.dispatch('pointerdown', {pointerId: 13})
  assert.deepEqual(vc.axes(), {forward: 1, right: -1})
  vc.resetHolds()
  assert.deepEqual(vc.axes(), {forward: 0, right: 0})

  // Low bridge / blocked status
  vc.syncBoat({
    ...boatSnap,
    probe: {...boatSnap.probe, blocked: true, reason: 'bridge', blockReason: 'bridge'},
  })
  assert.equal(vc.refs.boatStatus.textContent, '低桥')
  assert.equal(vc.refs.boatStatus.getAttribute('data-state'), 'warn')

  // Tour boat passenger mode
  vc.syncBoat({probe: null, heading: 0, speed: null, freeKind: null, isTourBoat: true})
  assert.equal(hud.getAttribute('data-vc-tier'), 'tour')
  assert.equal(vc.isTourBoat(), true)
  assert.equal(vc.refs.boatKind.textContent, '画舫')
  assert.equal(vc.refs.boatSpeedNum.textContent, '—')
  assert.equal(vc.refs.boatStatus.textContent, '随船游览')
  vc.dispose()
})

test('IDOK-546 integration: strict carGearbox & 3D boat lantern sync without flicker or redundant writes', () => {
  const {hud, vc} = createFakeEnv()
  const parked = makeCarSnap({kmh: 0, speed: 0, gear: 1, gearLabel: 'P'})

  // Strict carGearbox starts OFF in P; UI reflects off state and delegates throttle gating to carGearbox.pedals
  vc.syncCar(parked, 'off', {carGearbox: {strict: true, ignition: 'off', selector: 'P'}})
  assert.equal(vc.engineOn, false)
  assert.equal(hud.getAttribute('data-engine'), 'off')
  assert.equal(vc.refs.prnd.getAttribute('data-sel'), 'P')
  assert.equal(vc.gateForward(1), 1, 'strict carGearbox receives raw pedal forward for autoDrive / reject hints')

  // Clicking ignition emits pulse without optimistic state flip
  vc.refs.ignition.dispatch('click')
  assert.equal(vc.consumePulses().ignitionToggle, true)
  assert.equal(vc.engineOn, false)

  // Cranking -> On -> D transitions
  vc.syncCar(parked, 'low', {carGearbox: {strict: true, ignition: 'cranking', selector: 'P'}})
  assert.equal(hud.getAttribute('data-engine'), 'cranking')
  assert.equal(vc.refs.state.textContent, '点火启动中…')

  vc.syncCar(parked, 'low', {carGearbox: {strict: true, ignition: 'on', selector: 'P'}})
  assert.equal(vc.engineOn, true)
  assert.equal(hud.getAttribute('data-engine'), 'on')

  // Clicking D button emits carGearSelect pulse; carGearbox drives confirmed selector
  vc.refs.prndButtons[3].dispatch('click')
  assert.equal(vc.consumePulses().carGearSelect, 'D')
  assert.equal(vc.refs.prnd.getAttribute('data-sel'), 'P')
  vc.syncCar(makeCarSnap({kmh: 0, speed: 0, gear: 1, gearLabel: 'D1'}), 'low', {carGearbox: {strict: true, ignition: 'on', selector: 'D'}})
  assert.equal(vc.refs.prnd.getAttribute('data-sel'), 'D')

  vc.writer.reset()
  vc.syncCar(makeCarSnap({kmh: 0, speed: 0, gear: 1, gearLabel: 'D1'}), 'low', {carGearbox: {strict: true, ignition: 'on', selector: 'D'}})
  assert.equal(vc.writer.count, 0, 'identical strict carGearbox frame must perform 0 DOM writes')

  // Boat lantern lightOn sync from IDOK-546 boatLightProbe()
  const boatSnap = {probe: null, heading: 0, speed: 1.5, freeKind: 'rowboat', isTourBoat: false, lightOn: true}
  vc.syncBoat(boatSnap)
  assert.equal(vc.refs.boatLight.getAttribute('aria-pressed'), 'true')
  vc.writer.reset()
  vc.syncBoat(boatSnap)
  assert.equal(vc.writer.count, 0, 'identical boat lightOn frame must perform 0 DOM writes')
  vc.syncBoat({...boatSnap, lightOn: false})
  assert.equal(vc.refs.boatLight.getAttribute('aria-pressed'), 'false')
  vc.dispose()
})
