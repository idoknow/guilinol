import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import { createDrinksSim } from '../sim/index.ts'
import {
  DrinksStaffSession,
  createDrinksStaffController,
  createStaffUniformController,
  dispose,
  enterStaff,
  exitStaff,
  isInsideBackstageArea,
  isInsideShopInterior,
  mount,
  pickPrepStationAnchor,
  resolveDrinksStaffAnchors,
} from './index.ts'

test('drinks/staff 未修改 walk/outfits.ts 且操作区坐标可对接外部锚点或默认蓝图', () => {
  const defaultAnchors = resolveDrinksStaffAnchors()
  assert.equal(defaultAnchors.recruitStandee.z > 3.0, true)
  assert.equal(defaultAnchors.prepStations.length >= 3, true)
  assert.equal(isInsideBackstageArea(-1.35, -1.8, defaultAnchors), true)
  assert.equal(isInsideBackstageArea(0.2, 4.0, defaultAnchors), false)
  assert.equal(isInsideShopInterior(0.2, 1.5, defaultAnchors), true)
  assert.equal(isInsideShopInterior(0.2, 4.5, defaultAnchors), false)

  const custom = resolveDrinksStaffAnchors({
    shopAnchors: {
      orderDesk: { x: -2.1, z: -1.1, yaw: 0 },
      pickupCounter: { x: 2.8, z: -1.1, yaw: 0 },
      prepBarHeightM: 0.92,
    },
  })
  assert.equal(custom.orderDesk.x, -2.1)
  assert.equal(custom.pickupCounter.x, 2.8)
  assert.equal(custom.prepBarHeightM, 0.92)

  // Verify staff/ never imports or depends on walk/outfits.ts
  const dir = new URL('.', import.meta.url).pathname
  for (const f of ['anchors.ts', 'uniform.ts', 'workflow.ts', 'station-rigs.ts', 'staff-hud.ts', 'controller.ts']) {
    const src = readFileSync(join(dir, f), 'utf8')
    assert.equal(/from\s+['"][^'"]*walk\/outfits/.test(src), false, `${f} 不得引入 walk/outfits.ts`)
  }
})

test('员工服穿戴器在独立骨骼锚点叠加帽子与黑红围裙并可干净脱卸释放', () => {
  const fig = new THREE.Group()
  const head = new THREE.Group()
  head.name = 'Head'
  const torso = new THREE.Group()
  torso.name = 'Torso'
  const armL = new THREE.Group()
  armL.name = 'ArmL'
  const armR = new THREE.Group()
  armR.name = 'ArmR'
  torso.add(armL, armR)
  fig.add(head, torso)

  const uniform = createStaffUniformController()
  assert.equal(uniform.isEquipped(), false)
  assert.equal(uniform.equip(fig), true)
  assert.equal(uniform.isEquipped(), true)
  assert.ok(head.children.some(c => c.name === 'drinks-staff-uniform-head'))
  assert.ok(torso.children.some(c => c.name === 'drinks-staff-uniform-torso'))
  assert.ok(armL.children.some(c => c.name === 'drinks-staff-uniform-sleeve-l'))
  assert.ok(armR.children.some(c => c.name === 'drinks-staff-uniform-sleeve-r'))
  assert.ok(uniform.getTriangles() > 40 && uniform.getTriangles() < 1200)

  uniform.unequip()
  assert.equal(uniform.isEquipped(), false)
  assert.equal(head.children.length, 0)
  assert.equal(torso.children.some(c => c.name === 'drinks-staff-uniform-torso'), false)
  assert.equal(armL.children.length, 0)
  assert.equal(armR.children.length, 0)
  uniform.dispose()
})

test('完整五步员工动线、做错反馈与三连单节奏：接单 -> 摇杯 -> 加料 -> 封口 -> 叫号', () => {
  const sim = createDrinksSim({ seed: 'staff-loop-5step', now: 0, hourOf: () => 15.0 })
  const session = new DrinksStaffSession({ sim })

  // 远离招聘牌尝试应聘会触发做错反馈
  session.updatePlayerLocalPos(0.2, 6.5)
  assert.equal(session.getSnapshot().nearRecruit, false)
  assert.equal(session.applyForJob(), false)
  assert.equal(session.getSnapshot().mistakeCount, 1)

  // 靠近门口招聘牌应聘成功
  session.updatePlayerLocalPos(session.anchors.recruitStandee.x + 0.3, session.anchors.recruitStandee.z + 0.5)
  assert.equal(session.applyForJob(), true)
  assert.equal(session.getSnapshot().phase, 'accept_order')

  const servedNames = []
  for (let orderIdx = 0; orderIdx < 3; orderIdx++) {
    // 1. 走到收银台接单
    const desk = session.anchors.orderDesk
    session.updatePlayerLocalPos(desk.x, desk.z)
    assert.equal(session.performPrimaryAction(), true)
    const afterAccept = session.getSnapshot()
    assert.equal(afterAccept.phase, 'shake_cup')
    assert.ok(afterAccept.activeTicket)
    servedNames.push(afterAccept.activeTicket.itemName)

    // 第一单测试做错反馈：接完单没走去摇杯台就站在收银台原地按操作 / 错按封口
    if (orderIdx === 0) {
      assert.equal(session.performPrimaryAction(), false)
      const errSnap = session.getSnapshot()
      assert.equal(errSnap.lastMistake?.code, 'wrong_station')
      assert.equal(session.performStationAction('seal_cup'), false)
      assert.equal(session.getSnapshot().lastMistake?.code, 'wrong_step')
    }

    // 2. 走到摇茶台按住摇杯（带动效进度与摇晃音效）
    const shakePt = session.anchors.shakeStation
    session.updatePlayerLocalPos(shakePt.x, shakePt.z)
    for (let i = 0; i < 12; i++) {
      if (session.getSnapshot().phase !== 'shake_cup') break
      session.holdWork(0.12)
    }
    assert.equal(session.getSnapshot().phase, 'add_toppings')

    // 3. 走到对应配料台加料
    const prepPt = pickPrepStationAnchor(session.anchors, session.getSnapshot().activeTicket.stationKind)
    session.updatePlayerLocalPos(prepPt.x, prepPt.z)
    for (let i = 0; i < 14; i++) {
      if (session.getSnapshot().phase !== 'add_toppings') break
      session.holdWork(0.12)
    }
    assert.equal(session.getSnapshot().phase, 'seal_cup')
    assert.equal(session.getSnapshot().activeActionId, 'cup_seal')

    // 4. 走到封口机封口
    const sealPt = session.anchors.sealStation
    session.updatePlayerLocalPos(sealPt.x, sealPt.z)
    for (let i = 0; i < 12; i++) {
      if (session.getSnapshot().phase !== 'seal_cup') break
      session.holdWork(0.12)
    }
    assert.equal(session.getSnapshot().phase, 'call_pickup')
    assert.equal(session.getSnapshot().cupLidSealed, true)

    // 5. 走到取餐台叫号出杯
    const pickPt = session.anchors.pickupCounter
    session.updatePlayerLocalPos(pickPt.x, pickPt.z)
    assert.equal(session.performPrimaryAction(), true)
    assert.equal(session.getSnapshot().cupsServed, orderIdx + 1)
    assert.equal(session.getSnapshot().streakCount, orderIdx + 1)
  }

  // 三连单至少覆盖两款以上不同饮品，避免连单单调重复
  assert.notEqual(servedNames[0], servedNames[1])
  assert.notEqual(servedNames[1], servedNames[2])

  const sounds = session.drainSounds()
  assert.ok(sounds.includes('staff_clock_in'))
  assert.ok(sounds.includes('action_reject'))
  assert.ok(sounds.includes('order_chime'))
  assert.ok(sounds.includes('shaker_shake'))
  assert.ok(sounds.includes('cup_seal'))
  assert.ok(sounds.includes('label_apply'))
  assert.ok(sounds.includes('call_number'))
  assert.ok(sounds.filter(s => s === 'staff_step_done').length >= 9)

  // 下班脱装关 BGM
  assert.equal(session.resignJob(), true)
  assert.equal(session.getSnapshot().uniformEquipped, false)
  assert.equal(session.getSnapshot().bgmPlaying, false)
  assert.equal(session.getSnapshot().phase, 'off_duty')
})

test('冻结 API (mount/enterStaff/exitStaff/dispose)、手部骨骼摆动、BGM进出店淡入淡出与零残留释放', () => {
  const scene = new THREE.Scene()
  const figure = new THREE.Group()
  const torso = new THREE.Group()
  torso.name = 'Torso'
  const head = new THREE.Group()
  head.name = 'Head'
  const armL = new THREE.Group()
  armL.name = 'ArmL'
  const armR = new THREE.Group()
  armR.name = 'ArmR'
  const forearmL = new THREE.Group()
  forearmL.name = 'ForearmL'
  const forearmR = new THREE.Group()
  forearmR.name = 'ForearmR'
  armL.add(forearmL)
  armR.add(forearmR)
  torso.add(armL, armR)
  figure.add(torso, head)

  const ctrl = mount({
    scene,
    container: null,
  })
  ctrl.bindWalker(null, figure)

  // 冻结入口函数兼容 createDrinksStaffController 并可显式进出员工状态
  assert.equal(typeof createDrinksStaffController, 'function')
  assert.equal(enterStaff(ctrl, { force: true }), true)
  assert.equal(ctrl.getSnapshot().uniformEquipped, true)
  assert.equal(ctrl.uniform.isEquipped(), true)
  assert.equal(ctrl.bgm.isPlaying(), true)

  // 进店时 BGM 平滑淡入至 1.0；出店后平滑淡出至 0.0
  ctrl.setPlayerLocalPos(0.2, 1.2)
  for (let i = 0; i < 6; i++) ctrl.step(0.2)
  assert.equal(ctrl.bgm.getStats().insideShop, true)
  assert.equal(ctrl.bgm.getStats().fadeLevel, 1)

  ctrl.setPlayerLocalPos(0.2, 5.2)
  for (let i = 0; i < 6; i++) ctrl.step(0.2)
  assert.equal(ctrl.bgm.getStats().insideShop, false)
  assert.equal(ctrl.bgm.getStats().fadeLevel, 0)

  // 返回店内接单并依次推完五步，确认摇杯阶段手臂产生显著摆动，做错时头部/右手产生拒绝姿态
  ctrl.setPlayerLocalPos(ctrl.session.anchors.orderDesk.x, ctrl.session.anchors.orderDesk.z)
  assert.equal(ctrl.handleKeyDown('KeyE'), true) // accept -> shake_cup
  assert.equal(ctrl.getSnapshot().phase, 'shake_cup')

  ctrl.setPlayerLocalPos(ctrl.session.anchors.sealStation.x, ctrl.session.anchors.sealStation.z)
  assert.equal(ctrl.handleKeyDown('KeyE'), false) // 站错工位（未摇杯先去封口机）触发做错！
  ctrl.step(0.05)
  assert.ok(Math.abs(head.rotation.y) > 0.05)
  assert.ok(ctrl.audio.getStats().playedCounts.action_reject >= 1)

  ctrl.setPlayerLocalPos(ctrl.session.anchors.shakeStation.x, ctrl.session.anchors.shakeStation.z)
  ctrl.step(0.1)
  assert.ok(armR.rotation.x > 0.5) // 摇杯前抬双臂手部动效 (+X 前举)
  assert.equal(ctrl.handleKeyDown('KeyE'), true) // shake_cup -> add_toppings

  const prepPt = pickPrepStationAnchor(ctrl.session.anchors, ctrl.getSnapshot().activeTicket.stationKind)
  ctrl.setPlayerLocalPos(prepPt.x, prepPt.z)
  assert.equal(ctrl.handleKeyDown('KeyE'), true) // add_toppings -> seal_cup

  ctrl.setPlayerLocalPos(ctrl.session.anchors.sealStation.x, ctrl.session.anchors.sealStation.z)
  assert.equal(ctrl.handleKeyDown('KeyE'), true) // seal_cup -> call_pickup

  ctrl.setPlayerLocalPos(ctrl.session.anchors.pickupCounter.x, ctrl.session.anchors.pickupCounter.z)
  assert.equal(ctrl.handleKeyDown('KeyE'), true) // call_pickup -> cupsServed=1
  assert.equal(ctrl.getSnapshot().cupsServed, 1)

  const stageMetrics = ctrl.stage.getMetrics()
  assert.equal(stageMetrics.lights, 0)
  assert.ok(stageMetrics.triangles > 80)

  assert.equal(exitStaff(ctrl), true)
  assert.equal(armR.rotation.x, 0)
  assert.equal(head.rotation.y, 0)

  dispose(ctrl)
  assert.equal(ctrl.group.parent, null)
  assert.equal(ctrl.uniform.isEquipped(), false)
})
