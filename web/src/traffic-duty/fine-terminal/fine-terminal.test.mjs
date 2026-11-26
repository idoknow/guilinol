import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import * as THREE from 'three'

import {MAIN_DETAIL_LAYER} from '../../look/mirror-layer.ts'
import {DEFAULT_FINE_YUAN} from '../types.ts'
import {createCitationLedger} from '../handover/index.ts'
import {
  R8_DEFAULT_FINE_YUAN,
  TERMINAL_OVERLAY_CSS,
  computeFineLineItems,
  computeFineYuanStack,
  createFineTerminalModel,
  createFineTerminalSession,
  deriveSimulatedPlateNo,
  getActiveFineTerminalSession,
  isFineTerminalBusy,
  openFineTerminal,
  playTerminalStuffInHandSound,
  playTerminalTakeOutSound,
  playTerminalTearPaperSound,
} from './index.ts'

test('fine-terminal 3-stage flow (input -> printing -> deliver) yields { issued: true } and enforces strict order', async () => {
  const phases = []
  const session = createFineTerminalSession({
    headless: true,
    violation: 'no_helmet',
    fineYuan: 20,
    plateNo: '桂C·电模0821',
    officerBadgeId: 'GL-AUX-108',
    printDurationSec: 1.0,
    deliverDurationSec: 0,
    onPhaseChange(phase) {
      phases.push(phase)
    },
  })

  assert.equal(session.getPhase(), 'input')
  assert.equal(session.confirmDeliver(), false)

  assert.equal(session.setViolation('ebike_overload', true), true)
  assert.equal(session.getSnapshot().fineYuan, DEFAULT_FINE_YUAN.ebike_overload)
  assert.equal(session.setFineYuan(35), true)
  assert.equal(session.setPlateNo('  桂C·电模9527 '), true)
  assert.equal(session.setNote('解放桥南侧非机动车道'), true)

  assert.equal(session.confirmInput(), true)
  assert.equal(session.getPhase(), 'printing')
  assert.equal(session.setPlateNo('非法篡改'), false)
  assert.equal(session.setFineYuan(100), false)
  session.step(0.45)
  assert.equal(session.getPhase(), 'printing')
  assert.ok(session.getSnapshot().printProgress > 0.4 && session.getSnapshot().printProgress < 0.5)
  assert.equal(session.confirmDeliver(), false)

  // Finish printing -> automatic tear-off -> deliver
  session.step(0.65)
  assert.equal(session.getPhase(), 'deliver')
  assert.equal(session.getSnapshot().printProgress, 1)
  assert.equal(session.getSnapshot().paperTornOff, true)

  // Hand over printed slip -> done -> resolves { issued: true }
  assert.equal(session.confirmDeliver(), true)
  const result = await session.result
  assert.equal(result.issued, true)
  if (result.issued) {
    assert.equal(result.violation, 'ebike_overload')
    assert.equal(result.violationLabel, '电驴超载')
    assert.equal(result.fineYuan, 35)
    assert.equal(result.plateNo, '桂C·电模9527')
    assert.equal(result.zoneName, '解放桥')
    assert.equal(result.officerBadgeId, 'GL-AUX-108')
    assert.ok(result.receiptNo.startsWith('JLQ-'))
    assert.ok(result.qrPayload.includes('GL-AUX-108'))
    assert.equal(result.note, '解放桥南侧非机动车道')
    assert.equal(result.citationRecord.heldInHand, true)
  }
  assert.deepEqual(phases, ['printing', 'deliver', 'done'])
})

test('fine-terminal enforces <= 1.5m handover distance and rejects second ticket on same vehicle', async () => {
  const ledger = createCitationLedger()
  const toasts = []
  const violator = {
    x: 10,
    y: 0,
    z: 10,
    yaw: 0,
    speed: 0,
    scale: 1,
    leaving: false,
    kind: 'scooter',
    violation: 'no_helmet',
    vehicleSubtype: 'ebike',
  }
  let playerPos = {x: 10, y: 0, z: 12.2} // 2.2m > 1.5m

  const s1 = createFineTerminalSession({
    headless: true,
    actor: violator,
    ledger,
    getPlayerPos: () => playerPos,
    printDurationSec: 0.2,
    deliverDurationSec: 0,
    onToast: msg => toasts.push(msg),
  })

  assert.equal(s1.confirmInput(), true)
  s1.step(0.3)
  assert.equal(s1.getPhase(), 'deliver')

  // Over 1.5m -> cannot deliver
  assert.equal(s1.confirmDeliver(), false)
  assert.equal(s1.getPhase(), 'deliver')
  assert.ok(s1.getSnapshot().deliverError?.includes('1.5m'))

  // Walk within 1.5m -> delivers cleanly
  playerPos = {x: 10, y: 0, z: 11.2} // 1.2m <= 1.5m
  assert.equal(s1.confirmDeliver(), true)
  const res1 = await s1.result
  assert.equal(res1.issued, true)
  assert.equal(violator.cited, true)

  // Second ticket on same vehicle is immediately rejected with 「已开过罚单」
  toasts.length = 0
  const s2 = createFineTerminalSession({
    headless: true,
    actor: violator,
    ledger,
    onToast: msg => toasts.push(msg),
  })
  const res2 = await s2.result
  assert.equal(res2.issued, false)
  if (!res2.issued) {
    assert.equal(res2.reason, 'already_cited')
    assert.equal(res2.message, '已开过罚单')
  }
  assert.deepEqual(toasts, ['已开过罚单'])
})

test('fine-terminal cancel settles { issued: false } from input, printing, and deliver phases', async () => {
  const s1 = createFineTerminalSession({headless: true, violation: 'bike_double'})
  s1.cancel('cancelled')
  const r1 = await s1.result
  assert.equal(r1.issued, false)
  if (!r1.issued) {
    assert.equal(r1.reason, 'cancelled')
    assert.equal(r1.lastPhase, 'input')
  }

  const s2 = createFineTerminalSession({headless: true, violation: 'wrong_way', printDurationSec: 1.0})
  s2.confirmInput()
  s2.step(0.3)
  s2.cancel()
  const r2 = await s2.result
  assert.equal(r2.issued, false)
  if (!r2.issued) {
    assert.equal(r2.reason, 'cancelled')
    assert.equal(r2.lastPhase, 'printing')
  }

  const s3 = createFineTerminalSession({headless: true, violation: 'red_light_run', printDurationSec: 0.2})
  s3.confirmInput()
  s3.step(0.5)
  assert.equal(s3.getPhase(), 'deliver')
  s3.cancel()
  const r3 = await s3.result
  assert.equal(r3.issued, false)
  if (!r3.issued) {
    assert.equal(r3.reason, 'cancelled')
    assert.equal(r3.lastPhase, 'deliver')
  }
})

test('openFineTerminal single-active-session & simulated plate generation work cleanly', async () => {
  const first = openFineTerminal({headless: true, violation: 'no_helmet', fineYuan: 20})
  assert.equal(getActiveFineTerminalSession(), first.session)
  assert.equal(isFineTerminalBusy(), true)

  const second = openFineTerminal({
    headless: true,
    violation: 'illegal_mod',
    printDurationSec: 0.2,
    deliverDurationSec: 0.1,
  })
  const firstRes = await first
  assert.equal(firstRes.issued, false)
  if (!firstRes.issued) assert.equal(firstRes.reason, 'superseded')

  second.session.confirmInput()
  second.session.step(0.3)
  assert.equal(second.session.getPhase(), 'deliver')
  second.session.confirmDeliver()
  second.session.step(0.2)
  const secondRes = await second
  assert.equal(secondRes.issued, true)
  if (secondRes.issued) {
    assert.equal(secondRes.violation, 'illegal_mod')
    assert.equal(secondRes.fineYuan, DEFAULT_FINE_YUAN.illegal_mod)
  }
  assert.equal(getActiveFineTerminalSession(), null)
  assert.equal(isFineTerminalBusy(), false)

  assert.ok(deriveSimulatedPlateNo(undefined, 'bicycle', 3).includes('单车·模'))
  assert.ok(deriveSimulatedPlateNo(undefined, 'ebike', 3).includes('桂C·电模'))
  assert.equal(playTerminalTakeOutSound(), false)
  assert.equal(playTerminalTearPaperSound(), false)
})

test('createFineTerminalModel uses mainDetail layer 3, zero dynamic lights, and prints badge + QR metadata', () => {
  const model = createFineTerminalModel()
  assert.equal(model.dynamicLightCount, 0)
  assert.equal(model.cutterMesh.name, 'fine-terminal-serrated-cutter')
  assert.equal(model.beltClipMesh.name, 'fine-terminal-belt-clip')

  let lightCount = 0
  let meshCount = 0
  const layerMaskExpected = 1 << MAIN_DETAIL_LAYER
  model.group.traverse(obj => {
    if ('isLight' in obj && obj.isLight) lightCount++
    if ('isMesh' in obj && obj.isMesh) meshCount++
    assert.equal(obj.layers.mask, layerMaskExpected)
  })
  assert.equal(lightCount, 0)
  assert.ok(meshCount >= 16)

  const baseSnap = {
    violationLabel: '未戴头盔',
    fineYuan: 20,
    plateNo: '桂C·电模1001',
    receiptNo: 'JLQ-0001',
    officerBadgeId: 'GL-AUX-77',
  }
  model.update({...baseSnap, phase: 'input', printProgress: 0, deliverProgress: 0})
  assert.equal(model.receiptMesh.visible, false)

  model.update({...baseSnap, phase: 'printing', printProgress: 0.5, deliverProgress: 0})
  assert.equal(model.receiptMesh.visible, true)
  const midScaleY = model.receiptMesh.scale.y
  model.update({...baseSnap, phase: 'printing', printProgress: 1.0, deliverProgress: 0})
  assert.ok(model.receiptMesh.scale.y > midScaleY)

  const meta = model.getReceiptMeta()
  assert.equal(meta.officerBadgeId, 'GL-AUX-77')
  assert.equal(meta.qrMatrix.length, 21)
  assert.equal(meta.qrMatrix[0][0], true)

  const parent = new THREE.Group()
  parent.add(model.group)
  model.dispose()
  assert.equal(model.group.parent, null)
})

test('fine-terminal CSS and copy obey repo design-rules (0 gradients, 0 emoji, no local /Users/ leak)', () => {
  const cssFile = readFileSync(new URL('./terminal.css', import.meta.url), 'utf8')
  const forbidden = new RegExp('\\u884c\\u653f\\u5904\\u7f5a|\\u6263\\u5206|\\u8b66\\u5fbd|\\u8b66\\u53f7')
  for (const css of [cssFile, TERMINAL_OVERLAY_CSS]) {
    assert.equal(/gradient/i.test(css), false, 'CSS must contain zero gradients')
    assert.equal(/backdrop-filter/i.test(css), false, 'CSS must contain zero backdrop-filter')
    assert.ok(css.includes('--ui-serif'))
    assert.ok(css.includes('#a9503c'))
  }
  const sourceFiles = ['types.ts', 'audio.ts', 'model.ts', 'engine.ts', 'ui.ts', 'index.ts']
  for (const f of sourceFiles) {
    const content = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')
    assert.equal(content.includes('/Users/'), false, `${f} must not contain /Users/ paths`)
    assert.equal(forbidden.test(content), false, `${f} must not contain forbidden terms`)
    assert.equal(/event\.code\s*===?\s*['"]KeyF['"]/.test(content), false, `${f} must not hardcode event.code === 'KeyF'`)
    assert.equal(
      /\p{Emoji_Presentation}/u.test(content),
      false,
      `${f} must not contain emojis`,
    )
  }
})

test('r8-2 & r8-3: ebike_overload + no_helmet stacks 2 line items + total ¥70, fixes d44 floating paper, and stuffs nearest hand', async () => {
  assert.equal(R8_DEFAULT_FINE_YUAN.ebike_overload, 20)
  assert.equal(R8_DEFAULT_FINE_YUAN.no_helmet, 50)
  assert.equal(R8_DEFAULT_FINE_YUAN.illegal_mod, 100)
  assert.equal(computeFineYuanStack(['ebike_overload', 'no_helmet']), 70)

  const items = computeFineLineItems(['ebike_overload', 'no_helmet'])
  assert.deepEqual(
    items.map(it => ({violation: it.violation, label: it.label, fineYuan: it.fineYuan})),
    [
      {violation: 'ebike_overload', label: '电驴超载', fineYuan: 20},
      {violation: 'no_helmet', label: '未戴头盔', fineYuan: 50},
    ],
  )

  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200)
  const model = createFineTerminalModel()
  camera.add(model.group)
  assert.ok(model.holsterStrapMesh, 'rounded terminal must include leather belt holster strap')
  assert.equal(model.holsterStrapMesh.name, 'fine-terminal-holster-strap')

  const violatorRoot = new THREE.Group()
  violatorRoot.position.set(0, 0, 1.0)
  const leftBone = new THREE.Bone()
  leftBone.name = 'attach_hand_l'
  leftBone.position.set(-0.28, 1.05, -0.25)
  const rightBone = new THREE.Bone()
  rightBone.name = 'attach_hand_r'
  rightBone.position.set(0.28, 1.05, -0.25)
  violatorRoot.add(leftBone, rightBone)
  violatorRoot.updateMatrixWorld(true)

  const violator = {
    x: 0,
    y: 0,
    z: 1.0,
    yaw: 0,
    speed: 0,
    scale: 1,
    leaving: false,
    kind: 'scooter',
    violation: 'ebike_overload',
    violations: ['ebike_overload', 'no_helmet'],
    vehicleSubtype: 'ebike',
  }
  const ledger = createCitationLedger()
  let playerPos = {x: -0.55, y: 0, z: 0.35} // closer to left hand (-0.28, 1.05, 0.75)

  const session = createFineTerminalSession({
    headless: true,
    actor: violator,
    ledger,
    getPlayerPos: () => playerPos,
    getActorHandBone: (_actor, side) => (side === 'left' ? leftBone : rightBone),
    violatorObject3D: violatorRoot,
    printDurationSec: 0.2,
    deliverDurationSec: 0,
  })

  const snap0 = session.getSnapshot()
  assert.deepEqual(snap0.violations, ['ebike_overload', 'no_helmet'])
  assert.equal(snap0.lineItems.length, 2)
  assert.equal(snap0.fineYuan, 70)

  // Toggle illegal_mod (+100 -> 170) then toggle off (-> 70)
  assert.equal(session.toggleViolation('illegal_mod'), true)
  assert.equal(session.getSnapshot().fineYuan, 170)
  assert.equal(session.toggleViolation('illegal_mod'), true)
  assert.equal(session.getSnapshot().fineYuan, 70)

  session.confirmInput()
  session.step(0.1)
  model.update(session.getSnapshot())
  assert.equal(model.group.visible, true)
  assert.equal(model.receiptMesh.visible, true)
  assert.deepEqual(model.getReceiptMeta().printedLines, ['电驴超载  ¥20', '未戴头盔  ¥50'])
  assert.equal(model.getReceiptMeta().totalLine, '合计  ¥70')

  // Tear-off into 'deliver' phase -> d44 fix: camera-mounted terminal & paper MUST hide immediately!
  session.step(0.2)
  assert.equal(session.getPhase(), 'deliver')
  assert.equal(session.getSnapshot().paperTornOff, true)
  model.update(session.getSnapshot())
  assert.equal(model.group.visible, false, 'd44 fix: terminal root on camera must hide once paper is torn off')
  assert.equal(model.receiptMesh.visible, false, 'd44 fix: no detached receipt mesh may float in sky after tear-off')

  assert.equal(session.confirmDeliver(), true)
  const out = await session.result
  assert.equal(out.issued, true)
  if (out.issued) {
    assert.deepEqual(out.violations, ['ebike_overload', 'no_helmet'])
    assert.equal(out.lineItems.length, 2)
    assert.equal(out.fineYuan, 70)
    assert.equal(out.handedSide, 'left')
    assert.equal(out.citationRecord.handedSide, 'left')
  }
  assert.equal(playTerminalStuffInHandSound(), false)
  model.dispose()
})
