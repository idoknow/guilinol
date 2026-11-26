import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import {registerHooks} from 'node:module'
import {fileURLToPath} from 'node:url'
import * as THREE from 'three'

import {createDutyProps} from '../../gear/duty-props.ts'
import {
  ACTIONS,
  DUTY_ACTION_IDS,
  binding,
  bindingLabel,
  getDutyCardRows,
  getDutyGuideKeyGroup,
  hits,
} from '../../input/keymap.ts'
import {MAIN_DETAIL_LAYER} from '../../look/mirror-layer.ts'
import {
  DUTY_FLAG_RELEASE_HOLD_SEC,
  DUTY_FLAG_STOP_RANGE_M,
  DUTY_TICKET_DELIVER_RANGE_M,
  DUTY_WHISTLE_RADIUS_M,
  bindDutyKeyboard,
  createDutyKeysController,
  mountDutyTouchButtons,
  shouldSuppressRideGearKey,
  syncDutyKeysIntoPanels,
} from '../duty-keys.ts'
import {
  DUPLICATE_CITATION_MESSAGE,
  HANDOVER_STAGE_LABELS,
  createCitationLedger,
  createReceiptSlipModel,
  generateSimulatedQrMatrix,
  getViolatorHeldReceipt,
  isViolatorHoldingReceipt,
  startHandoverWorkflow,
} from './index.ts'

function makeMockActor(overrides = {}) {
  return {
    track: {id: 11, kind: 'nonmotor', dx: 0, dz: 1, length: 120, start: {x: 0, y: 0, z: 0}, end: {x: 0, y: 0, z: 120}},
    dist: 20,
    speed: 0,
    pace: 4.5,
    kind: 'scooter',
    down: 0,
    dodge: 0,
    x: 0,
    y: 10,
    z: 2.2,
    yaw: 0,
    scale: 1,
    leaving: false,
    halfWidth: 0.35,
    halfLength: 0.9,
    height: 1.5,
    violation: 'no_helmet',
    vehicleSubtype: 'ebike',
    dutyState: 'halted',
    haltedByDuty: true,
    ...overrides,
  }
}

function makeMockDomForPanels() {
  const makeEl = (tag, className = '') => {
    const listeners = new Map()
    const classes = new Set(className.split(/\s+/).filter(Boolean))
    const attrs = new Map()
    const el = {
      tagName: tag.toUpperCase(),
      get className() {
        return [...classes].join(' ')
      },
      set className(v) {
        classes.clear()
        for (const token of String(v).split(/\s+/).filter(Boolean)) classes.add(token)
      },
      classList: {
        add: (...tokens) => tokens.forEach(t => t && classes.add(t)),
        remove: (...tokens) => tokens.forEach(t => classes.delete(t)),
        toggle: (t, force) => {
          const next = force !== undefined ? Boolean(force) : !classes.has(t)
          if (next) classes.add(t)
          else classes.delete(t)
          return next
        },
        contains: t => classes.has(t),
      },
      dataset: {},
      hidden: false,
      disabled: false,
      innerHTML: '',
      textContent: '',
      children: [],
      ownerDocument: null,
      setAttribute(k, v) {
        attrs.set(k, String(v))
      },
      getAttribute(k) {
        return attrs.get(k) ?? null
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, [])
        listeners.get(type).push(fn)
      },
      dispatch(type) {
        for (const fn of listeners.get(type) ?? []) fn({})
      },
      append(...nodes) {
        for (const n of nodes) this.children.push(n)
      },
      appendChild(child) {
        this.children.push(child)
        return child
      },
      remove() {},
      querySelector(sel) {
        if (sel === '.keys-ctx') return this._ctx ?? null
        if (sel === '.keys-list') return this._list ?? null
        if (sel === 'section[data-duty-keys-group="1"]') {
          return this.children.find(c => c.dataset?.dutyKeysGroup === '1') ?? null
        }
        if (sel === '[data-duty-feature="1"]') {
          return this.children.find(c => c.dataset?.dutyFeature === '1') ?? null
        }
        return null
      },
    }
    return el
  }

  const keysCard = makeEl('section', 'keys-card')
  keysCard._ctx = makeEl('span', 'keys-ctx')
  keysCard._ctx.textContent = '步行'
  keysCard._list = makeEl('ul', 'keys-list')
  keysCard._list.innerHTML = '<li><kbd>W</kbd>走路</li>'

  const keyGrid = makeEl('div', 'guide-keygrid')
  const featureList = makeEl('ul', 'guide-features')
  const body = makeEl('body')

  const doc = {
    body,
    head: makeEl('head'),
    createElement(tag) {
      const e = makeEl(tag)
      e.ownerDocument = doc
      return e
    },
    getElementById() {
      return null
    },
    querySelector(sel) {
      if (sel === '.keys-card') return keysCard
      if (sel === '.guide-sheet .guide-keygrid') return keyGrid
      if (sel === '.guide-sheet .guide-features') return featureList
      return null
    },
  }
  body.ownerDocument = doc

  return {doc, body, keysCard, keyGrid, featureList}
}

test('6-stage workflow runs strictly: 拿出 → 输入 → 吐纸 → 撕下 → 递交 → 对方接住, types char-by-char, re-holsters printer, and mounts slip onto Neon hand bone', () => {
  const ledger = createCitationLedger()
  const officerFigure = new THREE.Group()
  const dutyProps = createDutyProps(officerFigure)

  // Before opening ticket: printer is holstered on belt, whistle is at mouth
  assert.equal(dutyProps.getProbe().printerMode, 'holstered')
  assert.equal(dutyProps.getProbe().whistleMode, 'mouth')
  assert.ok(dutyProps.getProbe().whistleToMouthDist < 0.01)

  // Violator 3D rig with upper/lower arm and Neon hand bone node
  const violatorRoot = new THREE.Group()
  const upperArmR = new THREE.Group()
  upperArmR.name = 'upperarm_r'
  const lowerArmR = new THREE.Group()
  lowerArmR.name = 'lowerarm_r'
  const neonHandBone = new THREE.Bone()
  neonHandBone.name = 'hand_r'
  upperArmR.add(lowerArmR)
  lowerArmR.add(neonHandBone)
  violatorRoot.add(upperArmR)

  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500)
  camera.position.set(0, 11.6, -2.5)

  let playerPos = {x: 0, y: 10, z: 0}
  const violator = makeMockActor({x: 0, y: 10, z: 2.3, violation: 'ebike_overload'})
  const observedLabels = []

  const {started, workflow} = startHandoverWorkflow(
    {
      actor: violator,
      plateNo: '桂C·电模3068',
      officerBadgeId: 'GL-AUX-302',
      takeOutDurationSec: 0.2,
      charTypeIntervalSec: 0.04,
      printDurationSec: 0.8,
      deliverDurationSec: 0.3,
      getPlayerPos: () => playerPos,
      violatorObject3D: violatorRoot,
      resolveViolatorHandBone: () => neonHandBone,
      camera,
      onStageChange(_stage, snap) {
        observedLabels.push(snap.stageLabel)
      },
    },
    {ledger, dutyProps},
  )

  assert.equal(started, true)
  assert.equal(workflow.getStage(), 'take_out')
  assert.equal(HANDOVER_STAGE_LABELS[workflow.getStage()], '拿出')
  assert.equal(dutyProps.getProbe().printerMode, 'in_hand')
  assert.equal(dutyProps.getProbe().flagVisible, false, 'command flag must be stowed while holding printer')

  // Cannot skip stages
  assert.equal(workflow.confirmInput().ok, false)
  assert.equal(workflow.tearOff().ok, false)
  assert.equal(workflow.deliver().ok, false)
  assert.equal(workflow.completeReceive().ok, false)

  // 1 -> 2: 拿出 -> 输入 (character-by-character typing into screen!)
  workflow.step(0.25)
  assert.equal(workflow.getStage(), 'input')
  assert.equal(workflow.getSnapshot().typing.typedChars, 0)

  workflow.step(0.13) // ~3 chars typed
  const midTyping = workflow.getSnapshot().typing
  assert.ok(midTyping.typedChars >= 3 && !midTyping.completed)
  assert.equal(midTyping.typedPlateNo, '桂C·电模3068'.slice(0, midTyping.typedChars))
  assert.equal(typeof midTyping.activeKeyIndex, 'number')

  workflow.step(1.2) // finishes typing plate + violation + fine
  assert.equal(workflow.getSnapshot().typing.completed, true)
  assert.equal(workflow.getSnapshot().typing.typedPlateNo, '桂C·电模3068')
  assert.equal(workflow.getSnapshot().typing.typedViolationLabel, '电驴超载')

  assert.equal(workflow.setFineYuan(30), true)
  assert.equal(workflow.setNote('解放桥北向非机动车道劝导'), true)
  assert.equal(workflow.tearOff().ok, false)

  // 2 -> 3: 输入 -> 吐纸
  assert.equal(workflow.confirmInput().ok, true)
  assert.equal(workflow.getStage(), 'printing')
  workflow.step(0.4)
  assert.equal(workflow.getStage(), 'printing')
  assert.ok(workflow.getSnapshot().printProgress > 0.45 && workflow.getSnapshot().printProgress < 0.55)
  assert.equal(workflow.tearOff().ok, false)

  workflow.step(0.5)
  assert.equal(workflow.getSnapshot().printProgress, 1)

  // 3 -> 4: 吐纸 -> 撕下 (printer re-holsters onto belt, slip held in right hand)
  assert.equal(workflow.tearOff().ok, true)
  assert.equal(workflow.getStage(), 'tear_off')
  assert.equal(workflow.getSnapshot().printerHolsteredOnBelt, true)
  assert.equal(dutyProps.getProbe().printerMode, 'holstered')
  assert.equal(dutyProps.getProbe().handSlipVisible, true)
  assert.equal(dutyProps.getProbe().whistleMode, 'mouth')

  // Over 1.5m (currently 2.3m) -> cannot deliver!
  const farTry = workflow.deliver()
  assert.equal(farTry.ok, false)
  assert.equal(farTry.reason, 'too_far')
  assert.equal(workflow.getStage(), 'tear_off')

  // Walk within 1.5m (1.1m) -> 4 -> 5: 撕下 -> 递交 (violator reaches arm out + camera closeup)
  playerPos = {x: 0, y: 10, z: 1.2}
  const nearDeliver = workflow.deliver()
  assert.equal(nearDeliver.ok, true)
  assert.equal(workflow.getStage(), 'deliver')
  assert.ok(upperArmR.rotation.x < -0.1, 'violator reaches arm forward during handover')
  assert.equal(workflow.getSnapshot().closeup.active, true)
  assert.ok(camera.fov < 55)

  // 5 -> 6: 递交 -> 对方接住
  workflow.step(0.35)
  assert.equal(workflow.getStage(), 'received')

  const finalSnap = workflow.getSnapshot()
  assert.deepEqual(finalSnap.stageHistory, [
    'take_out',
    'input',
    'printing',
    'tear_off',
    'deliver',
    'received',
  ])
  assert.deepEqual(finalSnap.stageLabelHistory, [
    '拿出',
    '输入',
    '吐纸',
    '撕下',
    '递交',
    '对方接住',
  ])
  assert.deepEqual(observedLabels, [
    '拿出',
    '输入',
    '吐纸',
    '撕下',
    '递交',
    '对方接住',
  ])

  // Violator holds the receipt slip directly on Neon's hand_r bone!
  assert.equal(isViolatorHoldingReceipt(violator), true)
  const held = getViolatorHeldReceipt(violator)
  assert.ok(held)
  assert.equal(held.anchorBoneName, 'hand_r')
  assert.equal(held.mountedNode, neonHandBone)
  assert.equal(held.model.group.parent, neonHandBone)
  assert.equal(held.model.officerBadgeId, 'GL-AUX-302')
  assert.equal(held.model.qrMatrix.length, 21)
  assert.equal(dutyProps.getProbe().handSlipVisible, false)

  held.detach()
  dutyProps.dispose()
})

test('during ticketing: flag waving (E) is disabled while mouth whistle (Q) remains active', () => {
  const ledger = createCitationLedger()
  const figure = new THREE.Group()
  const dutyProps = createDutyProps(figure)
  const playerPos = {x: 0, y: 10, z: 0}

  const haltedTarget = makeMockActor({x: 0, y: 10, z: 1.3, speed: 0, violation: 'no_helmet', haltedByDuty: true})
  const nearbyViolator = makeMockActor({
    x: 2,
    y: 10,
    z: 6,
    speed: 6.0,
    violation: 'wrong_way',
    dutyState: 'normal',
    haltedByDuty: false,
  })
  const normalRider = makeMockActor({
    x: -2,
    y: 10,
    z: 5,
    speed: 5.5,
    violation: 'none',
    dutyState: 'normal',
    haltedByDuty: false,
  })

  const controller = createDutyKeysController({
    isDutyActive: () => true,
    getPlayerPos: () => playerPos,
    getPlayerForward: () => ({x: 0, z: 1}),
    getActors: () => [haltedTarget, nearbyViolator, normalRider],
    ledger,
    dutyProps,
    random: () => 0.2,
  })

  const startRes = controller.pressTicket()
  assert.equal(startRes.ok, true)
  assert.equal(startRes.action, 'start_ticket')
  assert.equal(controller.isTicketing(), true)

  const wf = controller.getActiveWorkflow()
  assert.ok(wf)

  const checkFlagBlockedAndWhistleAllowed = () => {
    assert.equal(controller.isFlagEnabled(), false)
    assert.equal(controller.isWhistleEnabled(), true)
    assert.equal(controller.getAvailability().flag.enabled, false)
    assert.equal(controller.getAvailability().whistle.enabled, true)

    const shortFlag = controller.pressFlagShort()
    assert.equal(shortFlag.ok, false)
    assert.equal(shortFlag.reason, 'disabled_while_ticketing')

    const longFlag = controller.pressFlagLongRelease()
    assert.equal(longFlag.ok, false)
    assert.equal(longFlag.reason, 'disabled_while_ticketing')

    nearbyViolator.speed = 6.0
    const whistleRes = controller.pressWhistle()
    assert.equal(whistleRes.ok, true)
    assert.ok(nearbyViolator.speed < 6.0, 'violator within 12m slows down when whistle blown mid-ticket')
    assert.equal(normalRider.speed, 5.5, 'non-violator is completely unaffected by whistle')
    assert.equal(dutyProps.getProbe().whistleMode, 'mouth')
  }

  assert.equal(wf.getStage(), 'take_out')
  checkFlagBlockedAndWhistleAllowed()

  wf.finishTakeOut()
  assert.equal(wf.getStage(), 'input')
  checkFlagBlockedAndWhistleAllowed()

  wf.confirmInput()
  assert.equal(wf.getStage(), 'printing')
  checkFlagBlockedAndWhistleAllowed()

  wf.step(1.2)
  wf.tearOff()
  assert.equal(wf.getStage(), 'tear_off')
  checkFlagBlockedAndWhistleAllowed()

  const deliverRes = controller.pressTicket()
  assert.equal(deliverRes.ok, true)
  controller.step(0.5)
  assert.equal(controller.isTicketing(), false)
  assert.equal(controller.isFlagEnabled(), true)

  dutyProps.dispose()
})

test('over 1.5m cannot hand over; same vehicle cannot be fined a second time; ledger serializes, restores, and net-syncs', () => {
  const ledger = createCitationLedger()
  const toasts = []
  let playerPos = {x: 0, y: 10, z: 0}
  const violator = makeMockActor({
    x: 0,
    y: 10,
    z: 2.0,
    speed: 0,
    violation: 'illegal_mod',
    haltedByDuty: true,
    citationKey: 'net_ebike_8801',
  })

  const controller = createDutyKeysController({
    isDutyActive: () => true,
    getPlayerPos: () => playerPos,
    getPlayerForward: () => ({x: 0, z: 1}),
    getActors: () => [violator],
    ledger,
    onToast: msg => toasts.push(msg),
  })

  const s = controller.pressTicket()
  assert.equal(s.ok, true)
  const wf = s.workflow
  assert.ok(wf)
  wf.finishTakeOut()
  assert.equal(wf.setPlateNo('桂C·电模8801'), true)
  wf.confirmInput()
  wf.step(1.5)
  wf.tearOff()
  assert.equal(wf.getStage(), 'tear_off')

  // Over 1.5m -> F key is dimmed and cannot deliver
  assert.equal(controller.getAvailability().ticket.enabled, false)
  const tooFar1 = controller.pressTicket()
  assert.equal(tooFar1.ok, false)
  assert.equal(tooFar1.reason, 'too_far_to_deliver')

  playerPos = {x: 0, y: 10, z: 0.49} // 1.51m
  assert.equal(controller.pressTicket().ok, false)
  assert.equal(wf.getStage(), 'tear_off')

  // Walk within 1.5m (1.45m) -> F key lights up and delivers!
  playerPos = {x: 0, y: 10, z: 0.55}
  assert.ok(Math.hypot(violator.x - playerPos.x, violator.z - playerPos.z) <= DUTY_TICKET_DELIVER_RANGE_M)
  assert.equal(controller.getAvailability().ticket.enabled, true)
  assert.equal(controller.getAvailability().ticket.lit, true)
  const okDeliver = controller.pressTicket()
  assert.equal(okDeliver.ok, true)
  assert.equal(okDeliver.action, 'deliver_ticket')
  controller.step(0.5)
  assert.equal(wf.getStage(), 'received')
  assert.equal(isViolatorHoldingReceipt(violator), true)

  // Same vehicle second ticket -> rejected with 「已开过罚单」
  toasts.length = 0
  const secondTry = controller.pressTicket()
  assert.equal(secondTry.ok, false)
  assert.equal(secondTry.reason, 'already_cited')
  assert.equal(secondTry.message, DUPLICATE_CITATION_MESSAGE)
  assert.ok(toasts.includes('已开过罚单'))

  // 1) Local serialize -> restore
  const rawJson = ledger.serialize()
  const restoredLedger = createCitationLedger()
  assert.equal(restoredLedger.restore(rawJson), 1)
  assert.equal(restoredLedger.hasCited('net_ebike_8801'), true)

  // 2) Multiplayer network sync packet -> idempotent merge prevents second fine on remote client
  const netPacketStr = ledger.serializeNetSync('officer_alpha')
  const parsedNet = JSON.parse(netPacketStr)
  assert.equal(parsedNet.type, 'glol.duty.citation.sync.v1')
  assert.equal(parsedNet.senderId, 'officer_alpha')

  const remotePeerLedger = createCitationLedger()
  assert.equal(remotePeerLedger.mergeNetSyncPayload(netPacketStr), 1)
  assert.equal(remotePeerLedger.mergeNetSyncPayload(netPacketStr), 0, 'duplicate packet merge is idempotent')

  const remoteReplicaActor = makeMockActor({
    x: 0,
    y: 10,
    z: 1.2,
    speed: 0,
    cited: false,
    citationKey: 'net_ebike_8801',
  })
  const peerAttempt = startHandoverWorkflow({actor: remoteReplicaActor}, {ledger: remotePeerLedger})
  assert.equal(peerAttempt.started, false)
  assert.equal(peerAttempt.rejection?.reason, 'already_cited')
  assert.equal(peerAttempt.rejection?.message, '已开过罚单')
})

test('Q whistle (12m slow/flee-stop, normal unaffected) and E flag (short <=8m stop, long 0.6s release) obey exact specs', () => {
  const ledger = createCitationLedger()
  const playerPos = {x: 0, y: 10, z: 0}

  const normalNear = makeMockActor({x: 1, y: 10, z: 5, speed: 7.0, violation: 'none', haltedByDuty: false, dutyState: 'normal'})
  const violatorIn12m = makeMockActor({x: -2, y: 10, z: 10, speed: 8.0, violation: 'no_helmet', haltedByDuty: false, dutyState: 'normal'})
  const fleeingIn12m = makeMockActor({x: 2, y: 10, z: 9, speed: 9.0, violation: 'wrong_way', haltedByDuty: false, dutyState: 'fleeing'})
  const violatorBeyond12m = makeMockActor({x: 0, y: 10, z: 14.5, speed: 8.0, violation: 'bike_double', haltedByDuty: false, dutyState: 'normal'})

  const controller = createDutyKeysController({
    isDutyActive: () => true,
    getPlayerPos: () => playerPos,
    getPlayerForward: () => ({x: 0, z: 1}),
    getActors: () => [normalNear, violatorIn12m, fleeingIn12m, violatorBeyond12m],
    ledger,
    fleeHaltProbability: 0.7,
    random: () => 0.3,
  })

  assert.equal(DUTY_WHISTLE_RADIUS_M, 12)
  assert.equal(DUTY_FLAG_STOP_RANGE_M, 8)
  assert.equal(DUTY_FLAG_RELEASE_HOLD_SEC, 0.6)

  const wRes = controller.pressWhistle()
  assert.equal(wRes.ok, true)
  assert.equal(normalNear.speed, 7.0)
  assert.equal(violatorBeyond12m.speed, 8.0)
  assert.ok(violatorIn12m.speed < 8.0 && violatorIn12m.speed > 0)
  assert.equal(fleeingIn12m.speed, 0)
  assert.equal(fleeingIn12m.haltedByDuty, true)

  const aheadTarget = makeMockActor({x: 0.5, y: 10, z: 6.5, speed: 6.4, pace: 6.4, violation: 'no_helmet', haltedByDuty: false, dutyState: 'normal'})
  const behindTarget = makeMockActor({x: 0, y: 10, z: -4.0, speed: 6.0, violation: 'no_helmet', haltedByDuty: false, dutyState: 'normal'})
  const ctrlFlag = createDutyKeysController({
    isDutyActive: () => true,
    getPlayerPos: () => playerPos,
    getPlayerForward: () => ({x: 0, z: 1}),
    getActors: () => [aheadTarget, behindTarget],
    ledger,
  })

  ctrlFlag.handleKeyDown('KeyE')
  ctrlFlag.step(0.2)
  ctrlFlag.handleKeyUp('KeyE')
  assert.equal(aheadTarget.speed, 0)
  assert.equal(aheadTarget.haltedByDuty, true)
  assert.equal(behindTarget.speed, 6.0)
  assert.equal(ctrlFlag.getLastHaltedActor(), aheadTarget)

  ctrlFlag.handleKeyDown('KeyE')
  ctrlFlag.step(0.62)
  ctrlFlag.handleKeyUp('KeyE')
  assert.equal(aheadTarget.haltedByDuty, false)
  assert.ok(aheadTarget.speed >= 6.0)
  assert.equal(ctrlFlag.getLastHaltedActor(), null)

  // Regression guard for S5: short/long E holds flagMode ('stop'/'pass') across subsequent syncFromEmoteId(0) frames!
  const propFig = new THREE.Group()
  const props = createDutyProps(propFig)
  const gestures = []
  const ctrlWithProps = createDutyKeysController({
    isDutyActive: () => true,
    getPlayerPos: () => playerPos,
    getPlayerForward: () => ({x: 0, z: 1}),
    getActors: () => [aheadTarget],
    dutyProps: props,
    playGesture: g => gestures.push(g),
  })
  ctrlWithProps.handleKeyDown('KeyE')
  ctrlWithProps.step(0.1)
  ctrlWithProps.handleKeyUp('KeyE')
  props.syncFromEmoteId(0)
  props.update(0.016)
  assert.equal(props.getProbe().flagMode, 'stop', 'flagMode must stay stop across next frame syncFromEmoteId(0)')
  assert.ok(gestures.includes('flag_stop'))

  ctrlWithProps.handleKeyDown('KeyE')
  ctrlWithProps.step(0.65)
  ctrlWithProps.handleKeyUp('KeyE')
  props.syncFromEmoteId(0)
  props.update(0.016)
  assert.equal(props.getProbe().flagMode, 'pass', 'flagMode must stay pass across next frame syncFromEmoteId(0)')
  assert.ok(gestures.includes('flag_go'))
  props.dispose()
})

test('keymap.ts has Q/E/F, F1 + bottom-center bar display lit/dim & mobile 3-buttons, and active duty blocks Q/E bike gear shifts', () => {
  // 1) keymap.ts contains Q, E, F duty actions
  assert.deepEqual(DUTY_ACTION_IDS, ['dutyWhistle', 'dutyFlag', 'dutyTicket'])
  assert.deepEqual(binding('dutyWhistle'), ['KeyQ'])
  assert.deepEqual(binding('dutyFlag'), ['KeyE'])
  assert.deepEqual(binding('dutyTicket'), ['KeyF'])
  assert.equal(bindingLabel('dutyWhistle'), 'Q')
  assert.equal(bindingLabel('dutyFlag'), 'E')
  assert.equal(bindingLabel('dutyTicket'), 'F')
  assert.equal(hits('KeyQ', 'dutyWhistle'), true)
  assert.equal(hits('KeyE', 'dutyFlag'), true)
  assert.equal(hits('KeyF', 'dutyTicket'), true)

  const actionIds = new Set(ACTIONS.map(a => a.id))
  assert.ok(actionIds.has('dutyWhistle') && actionIds.has('dutyFlag') && actionIds.has('dutyTicket'))
  assert.equal(getDutyGuideKeyGroup().rows.length, 3)
  assert.ok(getDutyCardRows().length >= 6)

  // 2) F1 .guide-sheet & bottom-left .keys-card display Q, E, F
  const {doc, body, keysCard, keyGrid} = makeMockDomForPanels()
  syncDutyKeysIntoPanels(doc, true)
  assert.equal(keysCard._ctx.textContent, '执勤')
  const dutySec = keyGrid.querySelector('section[data-duty-keys-group="1"]')
  assert.ok(dutySec)
  assert.ok(dutySec.innerHTML.includes('<kbd>Q</kbd>'))
  assert.ok(dutySec.innerHTML.includes('<kbd>E</kbd>'))
  assert.ok(dutySec.innerHTML.includes('<kbd>F</kbd>'))

  // 3) Bottom-center dock lights up or dims per availability, and switches to 3 mobile buttons in touch mode
  let isPhone = false
  let actors = []
  const barCtrl = createDutyKeysController({
    isDutyActive: () => true,
    getPlayerPos: () => ({x: 0, y: 10, z: 0}),
    getPlayerForward: () => ({x: 0, z: 1}),
    getActors: () => actors,
  })
  const bottomDock = mountDutyTouchButtons(body, barCtrl, {touchMode: () => isPhone})
  assert.equal(bottomDock.element.children.length, 3)
  const [btnQ, btnE, btnF] = bottomDock.element.children
  // No stopped violator nearby -> F is dimmed/disabled, Q and E are enabled
  assert.equal(btnQ.disabled, false)
  assert.equal(btnE.disabled, false)
  assert.equal(btnF.disabled, true)
  assert.equal(btnF.dataset.state, 'dim')

  // Stopped violator within 4m -> F lights up; switch to mobile touch mode -> switches to is-touch-mode 3 buttons
  actors = [makeMockActor({x: 0, y: 10, z: 1.4, speed: 0, violation: 'no_helmet', haltedByDuty: true})]
  isPhone = true
  bottomDock.sync()
  assert.equal(bottomDock.element.classList.contains('is-touch-mode'), true)
  assert.equal(btnF.disabled, false)
  assert.equal(btnF.dataset.state, 'lit')
  bottomDock.dispose()

  // 4) While on duty, Q and E NEVER trigger bicycle/ebike gear shifting
  assert.equal(shouldSuppressRideGearKey('KeyQ', true), true)
  assert.equal(shouldSuppressRideGearKey('KeyE', true), true)
  assert.equal(shouldSuppressRideGearKey('KeyQ', false), false)

  let dutyActive = true
  let gearDelta = 0
  const captureListeners = new Map()
  const bubbleListeners = new Map()
  const mockWindow = {
    addEventListener(type, fn, capture) {
      const bucket = capture ? captureListeners : bubbleListeners
      if (!bucket.has(type)) bucket.set(type, [])
      bucket.get(type).push(fn)
    },
    removeEventListener(type, fn, capture) {
      const bucket = capture ? captureListeners : bubbleListeners
      const arr = bucket.get(type) ?? []
      const idx = arr.indexOf(fn)
      if (idx >= 0) arr.splice(idx, 1)
    },
    dispatchKey(type, code) {
      let stopped = false
      const ev = {
        code,
        repeat: false,
        preventDefault() {},
        stopPropagation() {
          stopped = true
        },
        stopImmediatePropagation() {
          stopped = true
        },
      }
      for (const fn of captureListeners.get(type) ?? []) {
        fn(ev)
        if (stopped) return
      }
      for (const fn of bubbleListeners.get(type) ?? []) {
        fn(ev)
        if (stopped) return
      }
    },
  }

  mockWindow.addEventListener(
    'keydown',
    ev => {
      if (ev.code === 'KeyE') gearDelta += 1
      else if (ev.code === 'KeyQ') gearDelta -= 1
    },
    false,
  )

  const bound = bindDutyKeyboard(mockWindow, barCtrl, () => dutyActive)
  mockWindow.dispatchKey('keydown', 'KeyQ')
  mockWindow.dispatchKey('keyup', 'KeyQ')
  mockWindow.dispatchKey('keydown', 'KeyE')
  mockWindow.dispatchKey('keyup', 'KeyE')
  assert.equal(gearDelta, 0)

  dutyActive = false
  mockWindow.dispatchKey('keydown', 'KeyE')
  assert.equal(gearDelta, 1)
  bound.dispose()
})

test('k54 real guide.ts F1 panel integration: pressing F1 opens .guide-sheet and renders Q, E, F duty keys in both play and keys tabs', async () => {
  // Enable bundler-style extensionless TS resolution and CSS stubbing so real web/src/ui/guide.ts runs directly in Node
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.endsWith('.css')) {
        return {url: new URL(specifier, context.parentURL).href, shortCircuit: true}
      }
      if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z0-9]+$/i.test(specifier)) {
        const candidateUrl = new URL(`${specifier}.ts`, context.parentURL)
        if (existsSync(fileURLToPath(candidateUrl))) {
          return {url: candidateUrl.href, shortCircuit: true}
        }
      }
      return nextResolve(specifier, context)
    },
    load(url, context, nextLoad) {
      if (url.endsWith('.css')) {
        return {format: 'module', source: 'export default {}', shortCircuit: true}
      }
      return nextLoad(url, context)
    },
  })

  // Minimal DOM environment for real web/src/ui/guide.ts mountGuide() + F1 keydown + openGuide('keys')
  const keydownHandlers = []
  const makeNode = (tag = 'div') => {
    const classes = new Set()
    const attrs = new Map()
    const listeners = new Map()
    const node = {
      tagName: tag.toUpperCase(),
      id: '',
      hidden: false,
      innerHTML: '',
      textContent: '',
      scrollTop: 0,
      dataset: {},
      style: {},
      offsetWidth: 320,
      offsetHeight: 200,
      children: [],
      onclick: null,
      classList: {
        add: (...t) => t.forEach(x => x && classes.add(x)),
        remove: (...t) => t.forEach(x => classes.delete(x)),
        toggle: (t, f) => {
          const on = f !== undefined ? Boolean(f) : !classes.has(t)
          if (on) classes.add(t)
          else classes.delete(t)
          return on
        },
        contains: t => classes.has(t),
      },
      set className(v) {
        classes.clear()
        String(v).split(/\s+/).filter(Boolean).forEach(x => classes.add(x))
      },
      get className() {
        return [...classes].join(' ')
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: k => attrs.get(k) ?? null,
      hasAttribute: k => attrs.has(k) || (k.startsWith('data-') && node.dataset[k.slice(5)] !== undefined),
      addEventListener: (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, [])
        listeners.get(type).push(fn)
      },
      focus() {},
      remove() {},
      append(...items) {
        this.children.push(...items)
      },
      appendChild(item) {
        this.children.push(item)
        return item
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] ?? null
      },
      querySelectorAll(sel) {
        const out = []
        if (sel === '.keys-head') out.push(node._keysHead)
        else if (sel === '.keys-ctx') out.push(node._keysCtx)
        else if (sel === '.keys-list') out.push(node._keysList)
        else if (sel === '.keys-more') out.push(node._keysMore)
        else if (sel === '.about-close') out.push(node._closeBtn)
        else if (sel === '.guide-replay') out.push(node._replayBtn)
        else if (sel === '.guide-foot') out.push(node._foot)
        else if (sel === '.guide-body') out.push(node._guideBody)
        else if (sel === '[data-tab=keys]') out.push(node._tabKeys)
        else if (sel === '[data-tab]') out.push(node._tabPlay, node._tabKeys)
        for (const c of this.children) {
          if (sel === '.guide-sheet' && c.classList?.contains('guide-mask')) out.push(c)
          if (sel === '.keys-card' && c.classList?.contains('keys-card')) out.push(c)
        }
        return out.filter(Boolean)
      },
    }
    return node
  }

  const body = makeNode('body')
  body.dataset.mode = 'walk'
  body.dataset.duty = 'active'

  const storageMap = new Map()
  const prevGlobals = {
    document: globalThis.document,
    window: globalThis.window,
    matchMedia: globalThis.matchMedia,
    localStorage: globalThis.localStorage,
    addEventListener: globalThis.addEventListener,
    MutationObserver: globalThis.MutationObserver,
  }

  globalThis.localStorage = {
    getItem: k => storageMap.get(k) ?? null,
    setItem: (k, v) => storageMap.set(k, String(v)),
  }
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  }
  globalThis.addEventListener = (type, fn) => {
    if (type === 'keydown') keydownHandlers.push(fn)
  }
  globalThis.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}})
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 800,
    matchMedia: globalThis.matchMedia,
    dispatchEvent() {},
    addEventListener: globalThis.addEventListener,
  }
  globalThis.document = {
    documentElement: {hasAttribute: () => false},
    body,
    createElement(tag) {
      const n = makeNode(tag)
      // Hydrate internal sub-elements created via innerHTML in guide.ts
      Object.defineProperty(n, 'innerHTML', {
        get() {
          return this._rawHtml ?? ''
        },
        set(html) {
          this._rawHtml = String(html)
          if (n.classList.contains('keys-card')) {
            n._keysHead = makeNode('button')
            n._keysCtx = makeNode('span')
            n._keysList = makeNode('ul')
            n._keysMore = makeNode('button')
          } else if (n.classList.contains('guide-mask')) {
            n._closeBtn = makeNode('button')
            n._replayBtn = makeNode('button')
            n._foot = makeNode('div')
            n._guideBody = makeNode('div')
            n._tabPlay = makeNode('button')
            n._tabPlay.dataset.tab = 'play'
            n._tabKeys = makeNode('button')
            n._tabKeys.dataset.tab = 'keys'
          }
        },
      })
      return n
    },
    querySelector: sel => body.querySelector(sel),
  }

  try {
    const guideMod = await import('../../ui/guide.ts')
    guideMod.mountGuide({autoTour: false})

    // Bottom-left .keys-card renders 执勤 context with Q, E, F from keymap.ts
    const mountedCard = body.children.find(c => c.classList.contains('keys-card'))
    assert.ok(mountedCard)
    assert.equal(mountedCard._keysCtx.textContent, '执勤')
    assert.ok(mountedCard._keysList.innerHTML.includes('<kbd>Q</kbd>'))
    assert.ok(mountedCard._keysList.innerHTML.includes('<kbd>E</kbd>'))
    assert.ok(mountedCard._keysList.innerHTML.includes('<kbd>F</kbd>'))

    // Dispatch real F1 keydown -> opens F1 .guide-sheet panel ('play' tab) showing Q, E, F
    let prevented = false
    for (const h of keydownHandlers) {
      h({
        code: 'F1',
        repeat: false,
        shiftKey: false,
        target: body,
        preventDefault() {
          prevented = true
        },
      })
    }
    assert.equal(prevented, true)
    const sheetMask = body.children.find(c => c.classList.contains('guide-mask'))
    assert.ok(sheetMask, 'pressing F1 must mount and open .guide-sheet')
    assert.equal(sheetMask.hidden, false)
    assert.ok(sheetMask._guideBody.innerHTML.includes('解放桥辅警执勤'))
    assert.ok(sheetMask._guideBody.innerHTML.includes('<kbd>Q</kbd>'))
    assert.ok(sheetMask._guideBody.innerHTML.includes('<kbd>E</kbd>'))
    assert.ok(sheetMask._guideBody.innerHTML.includes('<kbd>F</kbd>'))

    // Switch F1 panel to 'keys' tab -> renders 辅警执勤 group with Q, E, F
    guideMod.openGuide('keys')
    const keysHtml = sheetMask._guideBody.innerHTML
    assert.ok(keysHtml.includes('<h3>辅警执勤</h3>'))
    assert.ok(keysHtml.includes('<kbd>Q</kbd>'))
    assert.ok(keysHtml.includes('<kbd>E</kbd>'))
    assert.ok(keysHtml.includes('<kbd>F</kbd>'))
  } finally {
    globalThis.document = prevGlobals.document
    globalThis.window = prevGlobals.window
    globalThis.matchMedia = prevGlobals.matchMedia
    globalThis.localStorage = prevGlobals.localStorage
    globalThis.addEventListener = prevGlobals.addEventListener
    globalThis.MutationObserver = prevGlobals.MutationObserver
  }
})

test('receipt 3D slip model prints fictional officer badge + valid 21x21 QR finder patterns and obeys compliance rules', () => {
  const qr = generateSimulatedQrMatrix('GLOL-SIM://TEST/001')
  assert.equal(qr.length, 21)
  assert.equal(qr[0][0], true)
  assert.equal(qr[3][3], true)
  assert.equal(qr[0][20], true)
  assert.equal(qr[20][0], true)

  const slip = createReceiptSlipModel({
    receiptNo: 'JLQ-2330-0009',
    plateNo: '桂C·电模2048',
    violationLabel: '未戴头盔',
    fineYuan: 20,
    officerBadgeId: 'GL-AUX-909',
  })
  assert.equal(slip.dynamicLightCount, 0)
  assert.equal(slip.officerBadgeId, 'GL-AUX-909')
  const expectedLayerMask = 1 << MAIN_DETAIL_LAYER
  slip.group.traverse(obj => {
    assert.equal('isLight' in obj && obj.isLight, false)
    assert.equal(obj.layers.mask, expectedLayerMask)
  })
  slip.dispose()

  const forbidden = new RegExp('\\u884c\\u653f\\u5904\\u7f5a|\\u6263\\u5206|\\u8b66\\u5fbd|\\u8b66\\u53f7')
  const filesToAudit = [
    new URL('./types.ts', import.meta.url),
    new URL('./ledger.ts', import.meta.url),
    new URL('./receipt-model.ts', import.meta.url),
    new URL('./camera-closeup.ts', import.meta.url),
    new URL('./workflow.ts', import.meta.url),
    new URL('./index.ts', import.meta.url),
    new URL('../duty-keys.ts', import.meta.url),
    new URL('../../gear/duty-props.ts', import.meta.url),
    new URL('../../input/keymap.ts', import.meta.url),
  ]
  for (const url of filesToAudit) {
    const src = readFileSync(url, 'utf8')
    assert.equal(forbidden.test(src), false, `${url.pathname} must contain zero forbidden words`)
    assert.equal(src.includes('/Users/'), false, `${url.pathname} must not leak local /Users/ paths`)
    assert.equal(/linear-gradient|radial-gradient/i.test(src), false, `${url.pathname} must contain zero gradients`)
    assert.equal(/\p{Emoji_Presentation}/u.test(src), false, `${url.pathname} must contain zero emojis`)
    assert.equal(/event\.code\s*===?\s*['"]KeyF['"]/.test(src), false, `${url.pathname} must route F through keymap.hits`)
  }
})

test('r8-2 & r8-3: multi-violation (ebike_overload + no_helmet = ¥70) itemizes 2 lines and persists in CitationLedger', () => {
  const ledger = createCitationLedger()
  const officerFigure = new THREE.Group()
  const dutyProps = createDutyProps(officerFigure)

  // Verify upgraded leather holster & retaining strap probe
  const p0 = dutyProps.getProbe()
  const strapPivot = dutyProps.holsterGroup.getObjectByName('holster_strap_pivot')
  assert.ok(dutyProps.holsterGroup, 'dutyProps must expose leather belt holster group')
  assert.ok(strapPivot, 'holster must include pivoting retaining strap')
  assert.equal(dutyProps.holsterGroup.name, 'duty_printer_belt_holster')
  assert.equal(p0.holsterStrapVisible, true, 'retaining strap visible on holster')
  assert.equal(strapPivot.rotation.x, 0, 'retaining strap clasps closed when holstered')

  const rightBone = new THREE.Bone()
  rightBone.name = 'attach_hand_r'
  const violator = makeMockActor({
    x: 0,
    y: 10,
    z: 1.1,
    violation: 'ebike_overload',
    violations: ['ebike_overload', 'no_helmet'],
  })

  const {started, workflow} = startHandoverWorkflow(
    {
      actor: violator,
      plateNo: '桂C·电模7070',
      officerBadgeId: 'GL-AUX-808',
      takeOutDurationSec: 0.1,
      printDurationSec: 0.2,
      deliverDurationSec: 0.1,
      getPlayerPos: () => ({x: 0.4, y: 10, z: 0.4}),
      getActorHandBone: () => rightBone,
    },
    {ledger, dutyProps},
  )
  assert.equal(started, true)
  assert.ok(strapPivot.rotation.x < -0.5, 'strap swings open when printer taken out')

  const snap0 = workflow.getSnapshot()
  assert.deepEqual(snap0.violations, ['ebike_overload', 'no_helmet'])
  assert.equal(snap0.lineItems.length, 2)
  assert.equal(snap0.lineItems[0].label, '电驴超载')
  assert.equal(snap0.lineItems[0].fineYuan, 20)
  assert.equal(snap0.lineItems[1].label, '未戴头盔')
  assert.equal(snap0.lineItems[1].fineYuan, 50)
  assert.equal(snap0.fineYuan, 70)

  workflow.step(0.15)
  assert.equal(workflow.confirmInput().ok, true)
  workflow.step(0.25)
  assert.equal(workflow.tearOff().ok, true)
  assert.equal(strapPivot.rotation.x, 0, 'strap re-clasps when printer re-holsters on belt')
  assert.equal(workflow.deliver().ok, true)
  workflow.step(0.15)
  assert.equal(workflow.getStage(), 'received')

  const held = getViolatorHeldReceipt(violator)
  assert.ok(held)
  assert.deepEqual(held.model.printedLines, ['电驴超载  ¥20', '未戴头盔  ¥50'])
  assert.equal(held.model.totalLine, '合计  ¥70')

  const restored = createCitationLedger()
  restored.restore(ledger.serialize())
  const rec = restored.getRecord(violator)
  assert.ok(rec)
  assert.deepEqual(rec.violations, ['ebike_overload', 'no_helmet'])
  assert.equal(rec.lineItems?.length, 2)
  assert.equal(rec.fineYuan, 70)

  held.detach()
  dutyProps.dispose()
})

test('r8-3: nearest-hand stuffing mounts on left or right hand bone (< 0.05m) with 0 drift across 5s of movement', () => {
  function buildTwoHandedViolatorRig(worldX, worldY, worldZ) {
    const root = new THREE.Group()
    root.position.set(worldX, worldY, worldZ)
    const upperL = new THREE.Group()
    upperL.name = 'upperarm_l'
    const lowerL = new THREE.Group()
    lowerL.name = 'lowerarm_l'
    const handL = new THREE.Bone()
    handL.name = 'attach_hand_l'
    handL.position.set(-0.28, 1.05, -0.25)
    upperL.add(lowerL)
    lowerL.add(handL)

    const upperR = new THREE.Group()
    upperR.name = 'upperarm_r'
    const lowerR = new THREE.Group()
    lowerR.name = 'lowerarm_r'
    const handR = new THREE.Bone()
    handR.name = 'attach_hand_r'
    handR.position.set(0.28, 1.05, -0.25)
    upperR.add(lowerR)
    lowerR.add(handR)

    root.add(upperL, upperR)
    root.updateMatrixWorld(true)
    return {root, handL, handR}
  }

  for (const expectedSide of ['left', 'right']) {
    const ledger = createCitationLedger()
    const rig = buildTwoHandedViolatorRig(10, 151.8, 20)
    const actor = makeMockActor({
      x: 10,
      y: 151.8,
      z: 20,
      yaw: 0,
      violations: ['ebike_overload', 'no_helmet'],
    })
    // Stand closer to left (-0.65) or right (+0.65) side of the halted rider (within 1.5m)
    const playerPos = {
      x: expectedSide === 'left' ? 9.35 : 10.65,
      y: 151.8,
      z: 19.3,
    }

    const {started, workflow} = startHandoverWorkflow(
      {
        actor,
        takeOutDurationSec: 0.05,
        printDurationSec: 0.1,
        deliverDurationSec: 0.05,
        getPlayerPos: () => playerPos,
        violatorObject3D: rig.root,
        getActorHandBone: (_a, side) => (side === 'left' ? rig.handL : rig.handR),
      },
      {ledger},
    )
    assert.equal(started, true)
    workflow.step(0.08)
    assert.equal(workflow.confirmInput().ok, true)
    workflow.step(0.15)
    assert.equal(workflow.tearOff().ok, true)
    assert.equal(workflow.deliver().ok, true)
    workflow.step(0.1)
    assert.equal(workflow.getStage(), 'received')

    const targetBone = expectedSide === 'left' ? rig.handL : rig.handR
    const held = getViolatorHeldReceipt(actor)
    assert.ok(held, `violator must hold stuffed receipt (${expectedSide})`)
    assert.equal(held.side, expectedSide)
    assert.equal(held.mountedNode, targetBone)
    assert.equal(held.model.group.parent, targetBone)
    assert.equal(actor.heldTicketHandSide, expectedSide)

    // Simulate 5.0 seconds (100 steps x 0.05s) of continuous riding, turning, and wrist sway
    const slipWorld = new THREE.Vector3()
    const boneWorld = new THREE.Vector3()
    let initialDist = -1
    let maxDist = 0
    for (let stepIdx = 0; stepIdx <= 100; stepIdx++) {
      const t = stepIdx * 0.05
      rig.root.position.set(10 + Math.sin(t * 0.7) * 4.2, 151.8 + Math.cos(t * 1.5) * 0.04, 20 + t * 5.2)
      rig.root.rotation.y = Math.sin(t * 0.6) * 0.85
      targetBone.rotation.set(Math.sin(t * 3.1) * 0.15, Math.cos(t * 2.3) * 0.1, 0)
      rig.root.updateMatrixWorld(true)

      held.model.group.getWorldPosition(slipWorld)
      targetBone.getWorldPosition(boneWorld)
      const dist = slipWorld.distanceTo(boneWorld)
      if (initialDist < 0) initialDist = dist
      if (dist > maxDist) maxDist = dist

      assert.ok(
        dist < 0.05,
        `[${expectedSide}] frame t=${t.toFixed(2)}s: receipt-to-hand distance ${dist.toFixed(4)}m must stay < 0.05m`,
      )
      assert.ok(
        Math.abs(dist - initialDist) < 1e-6,
        `[${expectedSide}] frame t=${t.toFixed(2)}s: receipt drifted by ${Math.abs(dist - initialDist)}m`,
      )
    }
    assert.ok(maxDist > 0 && maxDist < 0.05)
    held.detach()
  }
})
