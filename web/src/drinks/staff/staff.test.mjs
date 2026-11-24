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
  isInsideBackstageArea,
  resolveDrinksStaffAnchors,
} from './index.ts'

test('drinks/staff 未修改 walk/outfits.ts 且操作区坐标可对接外部锚点或默认蓝图', () => {
  const defaultAnchors = resolveDrinksStaffAnchors()
  assert.equal(defaultAnchors.recruitStandee.z > 3.0, true)
  assert.equal(defaultAnchors.prepStations.length >= 3, true)
  assert.equal(isInsideBackstageArea(-1.35, -1.8, defaultAnchors), true)
  assert.equal(isInsideBackstageArea(0.2, 4.0, defaultAnchors), false)

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
  fig.add(head, torso)

  const uniform = createStaffUniformController()
  assert.equal(uniform.isEquipped(), false)
  assert.equal(uniform.equip(fig), true)
  assert.equal(uniform.isEquipped(), true)
  assert.ok(head.children.some(c => c.name === 'drinks-staff-uniform-head'))
  assert.ok(torso.children.some(c => c.name === 'drinks-staff-uniform-torso'))
  assert.ok(uniform.getTriangles() > 40 && uniform.getTriangles() < 1200)

  uniform.unequip()
  assert.equal(uniform.isEquipped(), false)
  assert.equal(head.children.length, 0)
  assert.equal(torso.children.length, 0)
  uniform.dispose()
})

test('完整员工动线状态机：应聘 -> 穿工装 -> 接单 -> 加料 -> 封口 -> 叫号 全链路与 BGM/音效触发', () => {
  const sim = createDrinksSim({ seed: 'staff-loop', now: 0, hourOf: () => 15.0 })
  const session = new DrinksStaffSession({ sim })

  // 远离招聘牌无法直接入职
  session.updatePlayerLocalPos(0.2, 6.5)
  assert.equal(session.getSnapshot().nearRecruit, false)
  assert.equal(session.applyForJob(), false)

  // 靠近门口招聘牌出现极简提示，应聘成功并开启 BGM + 换装 + 打卡音效
  session.updatePlayerLocalPos(session.anchors.recruitStandee.x + 0.3, session.anchors.recruitStandee.z + 0.5)
  const nearSnap = session.getSnapshot()
  assert.equal(nearSnap.nearRecruit, true)
  assert.equal(nearSnap.prompt?.kind, 'recruit')
  assert.equal(session.applyForJob(), true)
  assert.equal(session.getSnapshot().onDuty, true)
  assert.equal(session.getSnapshot().uniformEquipped, true)
  assert.equal(session.getSnapshot().bgmPlaying, true)
  assert.equal(session.getSnapshot().phase, 'accept_order')

  // Step 1: 接单
  assert.equal(session.performPrimaryAction(), true)
  const afterAccept = session.getSnapshot()
  assert.equal(afterAccept.phase, 'add_toppings')
  assert.ok(afterAccept.activeTicket)
  assert.equal(afterAccept.activeTicket?.ticketNo, 'S001')

  // Step 2: 持续按住加料（含设备动画进度推进）直到进入封口
  for (let i = 0; i < 12; i++) {
    if (session.getSnapshot().phase !== 'add_toppings') break
    session.holdWork(0.15)
  }
  assert.equal(session.getSnapshot().phase, 'seal_cup')
  assert.equal(session.getSnapshot().activeActionId, 'cup_seal')

  // Step 3: 持续封口直到进入叫号
  for (let i = 0; i < 10; i++) {
    if (session.getSnapshot().phase !== 'seal_cup') break
    session.holdWork(0.15)
  }
  const beforeCall = session.getSnapshot()
  assert.equal(beforeCall.phase, 'call_pickup')
  assert.equal(beforeCall.cupLidSealed, true)

  // Step 4: 叫号出餐
  assert.equal(session.performPrimaryAction(), true)
  const doneSnap = session.getSnapshot()
  assert.equal(doneSnap.cupsServed, 1)
  assert.equal(doneSnap.lastCalledTicketNo, 'S001')
  assert.ok(doneSnap.shiftEarningsYuan > 0)
  assert.equal(doneSnap.phase, 'accept_order')

  const sounds = session.drainSounds()
  assert.ok(sounds.includes('staff_clock_in'))
  assert.ok(sounds.includes('order_chime'))
  assert.ok(sounds.includes('cup_drop'))
  assert.ok(sounds.includes('cup_seal'))
  assert.ok(sounds.includes('label_apply'))
  assert.ok(sounds.includes('call_number'))
  assert.ok(sounds.includes('staff_step_done'))

  // 下班脱装关 BGM
  assert.equal(session.resignJob(), true)
  assert.equal(session.getSnapshot().uniformEquipped, false)
  assert.equal(session.getSnapshot().bgmPlaying, false)
  assert.equal(session.getSnapshot().phase, 'off_duty')
})

test('createDrinksStaffController 驱动 3D 立牌/工装/后台设备、0 动态光源且完整 dispose', () => {
  const scene = new THREE.Scene()
  const figure = new THREE.Group()
  const ctrl = createDrinksStaffController({
    scene,
    container: null,
  })
  ctrl.bindWalker(null, figure)

  const standeePt = ctrl.session.anchors.recruitStandee
  ctrl.setPlayerLocalPos(standeePt.x, standeePt.z + 0.4)
  assert.equal(ctrl.handleKeyDown('KeyE'), true)
  assert.equal(ctrl.getSnapshot().uniformEquipped, true)
  assert.equal(ctrl.uniform.isEquipped(), true)
  assert.equal(ctrl.bgm.isPlaying(), true)

  // Step through 接单 -> 加料 -> 封口 -> 叫号
  assert.equal(ctrl.handleKeyDown('KeyE'), true) // 接单
  ctrl.step(0.05)
  assert.equal(ctrl.handleKeyDown('KeyE'), true) // 加料完成
  ctrl.step(0.05)
  assert.equal(ctrl.handleKeyDown('KeyE'), true) // 封口完成
  ctrl.step(0.05)
  assert.equal(ctrl.handleKeyDown('KeyE'), true) // 叫号出杯
  assert.equal(ctrl.getSnapshot().cupsServed, 1)

  const stageMetrics = ctrl.stage.getMetrics()
  assert.equal(stageMetrics.lights, 0)
  assert.ok(stageMetrics.triangles > 80)

  ctrl.dispose()
  assert.equal(ctrl.group.parent, null)
  assert.equal(ctrl.uniform.isEquipped(), false)
})
