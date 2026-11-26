import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'

import {
  XXG_BUDGET,
  XXG_CONTRACT_VERSION,
  XXG_FRAME,
  XXG_PLAYER,
  XXG_PORTALS,
  XXG_PORTAL_IDS,
  XXG_PORTAL_TRIGGER,
  XXG_TIMING,
  XXG_TRANSITIONS,
  canTransition,
  getPortal,
  indoorToWorld,
  mountLazyXiaoxianggang,
  portalLanding,
  rotateLocal,
  shouldEnterPortal,
  validateXxgLayout,
  worldToIndoor,
  worldToPortalLocal,
} from '../index.ts'
import {
  STAGE1_GREYBOX_LAYOUT,
  assertValidXxgLayout,
  buildIndoorCollisionWorld,
  clampIndoorPitch,
  createIndoorGreyboxScene,
  createXxgIndoorScene,
  createXxgRuntimeStateMachine,
  findTriggeredExit,
  resolveIndoorMovement,
} from './index.ts'
import { resolveXxgExitStair } from './exit-stairs.ts'
import { normalizeAngleRad } from './types.ts'
import { XIAOXIANGGANG_B1_LAYOUT } from '../layout/index.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createMockDomEnvironment() {
  const windowListeners = new Map()
  const makeElement = tag => ({
    tagName: String(tag).toUpperCase(),
    className: '',
    type: '',
    rel: '',
    href: '',
    hidden: false,
    textContent: '',
    dataset: {},
    attributes: new Map(),
    children: [],
    parentNode: null,
    listeners: new Map(),
    offsetWidth: 1280,
    classList: {
      _set: new Set(),
      add(...names) {
        for (const n of names) this._set.add(n)
      },
      remove(...names) {
        for (const n of names) this._set.delete(n)
      },
      contains(n) {
        return this._set.has(n)
      },
    },
    setAttribute(k, v) {
      this.attributes.set(k, String(v))
    },
    getAttribute(k) {
      return this.attributes.get(k) ?? null
    },
    hasAttribute(k) {
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
        if (camel in this.dataset) return true
      }
      return this.attributes.has(k)
    },
    append(...nodes) {
      for (const n of nodes) {
        if (n.parentNode) n.parentNode.removeChild(n)
        n.parentNode = this
        this.children.push(n)
      }
    },
    removeChild(child) {
      const idx = this.children.indexOf(child)
      if (idx >= 0) {
        this.children.splice(idx, 1)
        child.parentNode = null
      }
    },
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this)
    },
    contains(other) {
      let cur = other
      while (cur) {
        if (cur === this) return true
        cur = cur.parentNode
      }
      return false
    },
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set())
      this.listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      this.listeners.get(type)?.delete(fn)
    },
    click() {
      for (const fn of this.listeners.get('click') ?? []) fn({ target: this })
    },
    querySelector(sel) {
      if (sel === 'link[data-xxg-style="1"]') {
        return this.children.find(c => c.tagName === 'LINK' && c.dataset.xxgStyle === '1') ?? null
      }
      return null
    },
  })

  const head = makeElement('head')
  const body = makeElement('body')
  body.append(makeElement('canvas'))

  const mockDocument = {
    head,
    body,
    pointerLockElement: null,
    createElement: tag => makeElement(tag),
  }

  const keyFor = (type, capture) => `${type}:${Boolean(capture)}`
  const mockWindow = {
    addEventListener(type, fn, opts) {
      const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture)
      const k = keyFor(type, capture)
      if (!windowListeners.has(k)) windowListeners.set(k, new Set())
      windowListeners.get(k).add(fn)
    },
    removeEventListener(type, fn, opts) {
      const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture)
      windowListeners.get(keyFor(type, capture))?.delete(fn)
    },
    dispatchKey(type, code, extra = {}) {
      const evt = {
        code,
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        target: body,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true
        },
        ...extra,
      }
      for (const capture of [true, false]) {
        for (const fn of windowListeners.get(keyFor(type, capture)) ?? []) fn(evt)
      }
      return evt
    },
    totalListenerCount() {
      let sum = 0
      for (const set of windowListeners.values()) sum += set.size
      return sum
    },
  }

  return { mockDocument, mockWindow, head, body }
}

function withMockGlobals(env, fn) {
  const prevWin = globalThis.window
  const prevDoc = globalThis.document
  globalThis.window = env.mockWindow
  globalThis.document = env.mockDocument
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prevWin === undefined) delete globalThis.window
      else globalThis.window = prevWin
      if (prevDoc === undefined) delete globalThis.document
      else globalThis.document = prevDoc
    })
}

function createCountingRenderer() {
  return {
    info: {
      render: { calls: 0 },
      reset() {
        this.render.calls = 0
      },
    },
    render(scene) {
      let meshes = 0
      scene.traverse(n => {
        if (n instanceof THREE.Mesh && n.visible) meshes++
      })
      this.info.render.calls = meshes
    },
  }
}

test('Stage 1 greybox layout & coordinate frame strictly conform to contract.ts v1', () => {
  assert.equal(XXG_CONTRACT_VERSION, 1)
  assert.deepEqual(validateXxgLayout(STAGE1_GREYBOX_LAYOUT), [])
  assert.equal(STAGE1_GREYBOX_LAYOUT.shops.length, 2, 'Stage 1 skeleton must provide 2 empty shop bays')
  assert.equal(STAGE1_GREYBOX_LAYOUT.exits.length, 4)

  for (const p of XXG_PORTALS) {
    assert.equal(p.groundY, XXG_FRAME.surfaceY)
    const roundTrip = worldToIndoor(indoorToWorld(p.indoor))
    assert.ok(Math.hypot(roundTrip.x - p.indoor.x, roundTrip.z - p.indoor.z) < 1e-9)

    const landing = portalLanding(p)
    const landingLocal = worldToPortalLocal(p, landing)
    assert.ok(Math.abs(landingLocal.x) < 1e-6)
    assert.ok(Math.abs(landingLocal.z - XXG_PORTAL_TRIGGER.landingZ) < 1e-6)
  }

  assert.throws(() => assertValidXxgLayout({ ...STAGE1_GREYBOX_LAYOUT, version: 2 }), /version/)
  assert.throws(() => assertValidXxgLayout({ ...STAGE1_GREYBOX_LAYOUT, ceilingHeight: 1.8 }), /ceilingHeight/)
})

test('runtime state machine enforces XXG_TRANSITIONS, portal walk-in trigger, and exit cooldown hysteresis', () => {
  const sm = createXxgRuntimeStateMachine(XXG_PORTALS, 1500)
  assert.equal(sm.getState(), 'unmounted')

  // Illegal transitions from unmounted must fail cleanly without throwing
  assert.equal(sm.transitionTo('entering'), false)
  assert.equal(sm.transitionTo('inside'), false)
  assert.equal(sm.transitionTo('exiting'), false)

  assert.equal(sm.transitionTo('idle'), true)
  assert.equal(sm.getState(), 'idle')

  for (const portal of XXG_PORTALS) {
    // Stationary player on stairs (vel = 0) must NOT auto-trigger entry
    const stepPos = {
      x: portal.world.x + rotateLocal({ x: 0, z: 2.2 }, portal.yaw).x,
      y: portal.groundY + 0.875,
      z: portal.world.z + rotateLocal({ x: 0, z: 2.2 }, portal.yaw).z,
    }
    assert.equal(shouldEnterPortal(portal, stepPos, { x: 0, z: 0 }), false)
    assert.equal(sm.detectSurfaceEntry(stepPos, { x: 0, z: 0 }, 1000).triggeredPortal, null)

    // Walking inward across thresholdZ <= 3.0 triggers entry
    const inwardVel = { x: portal.inward.x * 1.5, z: portal.inward.z * 1.5 }
    const trig = sm.detectSurfaceEntry(stepPos, inwardVel, 1000)
    assert.equal(trig.triggeredPortal?.id, portal.id)

    // Cooldown suppresses immediate bounce re-entry, then re-arms after cooldown expires
    sm.markPortalExitCooldown(portal.id, 2000, 1500)
    assert.equal(sm.detectSurfaceEntry(stepPos, inwardVel, 2800).triggeredPortal, null)
    assert.equal(sm.detectSurfaceEntry(stepPos, inwardVel, 3600).triggeredPortal?.id, portal.id)
  }

  // Verify transition table parity with contract.ts
  for (const [from, allowed] of Object.entries(XXG_TRANSITIONS)) {
    for (const candidate of ['unmounted', 'idle', 'entering', 'inside', 'exiting', 'disposed']) {
      assert.equal(canTransition(from, candidate), allowed.includes(candidate))
    }
  }

  sm.dispose()
  assert.equal(sm.getState(), 'disposed')
  assert.equal(sm.transitionTo('idle'), false)
})

test('indoor collision blocks walls (zero tunneling), slides smoothly, enters both empty shop bays, and triggers exits', () => {
  const world = buildIndoorCollisionWorld(STAGE1_GREYBOX_LAYOUT)
  const r = XXG_PLAYER.radius

  // 1. Massive impulse into East corridor wall at (-22, -20) must never tunnel past halfWidth - r (-22 + 2.6 - 0.3 = -19.7)
  const wallStop = resolveIndoorMovement(world, STAGE1_GREYBOX_LAYOUT, -22, -20, 45.0, 0)
  assert.equal(wallStop.hitWall, true)
  assert.ok(Math.abs(wallStop.x - (-22 + 2.6 - r)) < 1e-4, `clamped x=${wallStop.x}`)
  assert.ok(wallStop.ceilingClearanceM >= 1.45)

  // 2. Diagonal push into East wall slides cleanly along Z
  const slide = resolveIndoorMovement(world, STAGE1_GREYBOX_LAYOUT, wallStop.x, -20, 2.5, 4.0)
  assert.equal(slide.hitWall, true)
  assert.ok(Math.abs(slide.x - (-22 + 2.6 - r)) < 1e-4)
  assert.ok(slide.z > -16.5, `expected smooth slide along corridor, got z=${slide.z}`)

  // 3. Walk into Empty Shop Bay 1 (shop-s1-east-01 at x=-17.3, z=-12.5) and stop at its rear wall
  const enterBay1 = resolveIndoorMovement(world, STAGE1_GREYBOX_LAYOUT, -22, -12.5, 5.2, 0)
  assert.equal(enterBay1.activeShopId, 'shop-s1-east-01')
  const hitBay1Back = resolveIndoorMovement(world, STAGE1_GREYBOX_LAYOUT, enterBay1.x, -12.5, 25.0, 0)
  const expectedRear1 = -17.3 + 4.2 * 0.5 - r
  assert.equal(hitBay1Back.hitWall, true)
  assert.ok(Math.abs(hitBay1Back.x - expectedRear1) < 1e-4)

  // 4. Walk into Empty Shop Bay 2 (shop-s1-west-02 at x=-73.5, z=8.5) and stop at its rear wall
  const enterBay2 = resolveIndoorMovement(world, STAGE1_GREYBOX_LAYOUT, -78, 8.5, 5.0, 0)
  assert.equal(enterBay2.activeShopId, 'shop-s1-west-02')
  const hitBay2Back = resolveIndoorMovement(world, STAGE1_GREYBOX_LAYOUT, enterBay2.x, 8.5, 25.0, 0)
  const expectedRear2 = -73.5 + 4.2 * 0.5 - r
  assert.equal(hitBay2Back.hitWall, true)
  assert.ok(Math.abs(hitBay2Back.x - expectedRear2) < 1e-4)

  // 5. Stairwell solid obstacle push-out & exit trigger directionality
  const e2Exit = STAGE1_GREYBOX_LAYOUT.exits.find(e => e.portalId === 'E2')
  assert.equal(findTriggeredExit(STAGE1_GREYBOX_LAYOUT, e2Exit.foot.x, e2Exit.foot.z, 0, 1.5), null, 'walking inward must not exit')
  assert.equal(
    findTriggeredExit(STAGE1_GREYBOX_LAYOUT, e2Exit.foot.x, e2Exit.foot.z, 0, -1.5)?.portalId,
    'E2',
    'walking toward E2 stair must trigger exit',
  )

  assert.equal(clampIndoorPitch(world, 3.0), world.maxPitchRad)
  assert.equal(clampIndoorPitch(world, -3.0), world.minPitchRad)
})

test('greybox scene stays well under 40 draw calls and disposes every geometry, material, and texture', () => {
  const handle = createIndoorGreyboxScene(STAGE1_GREYBOX_LAYOUT)
  assert.ok(handle.meshCount > 0 && handle.meshCount <= XXG_BUDGET.indoorDrawCallsMax, `meshCount=${handle.meshCount}`)
  assert.ok(handle.triangleCount > 0 && handle.triangleCount <= XXG_BUDGET.indoorTrianglesMax)
  assert.ok(handle.textureBytes <= XXG_BUDGET.indoorTextureBytesMax)
  assert.ok(handle.scene.background instanceof THREE.Color)
  assert.ok(handle.scene.background.r > 0.5, 'indoor background must never be black')

  let disposedGeoms = 0
  let disposedMats = 0
  let disposedTexs = 0
  handle.scene.traverse(obj => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.addEventListener('dispose', () => disposedGeoms++)
      obj.material.addEventListener('dispose', () => disposedMats++)
      if (obj.material.map) {
        obj.material.map.addEventListener('dispose', () => disposedTexs++)
      }
    }
  })

  const expectedGeoms = handle.geometryCount
  const expectedMats = handle.materialCount
  handle.dispose()
  assert.equal(handle.isDisposed(), true)
  assert.equal(handle.scene.children.length, 0)
  assert.equal(disposedGeoms, expectedGeoms)
  assert.equal(disposedMats, expectedMats)
  assert.ok(disposedTexs >= 1)
})

test('repeated enter/exit cycles across all 4 portals leave zero DOM/scene residue and preserve worldCamera', async () => {
  const env = createMockDomEnvironment()
  await withMockGlobals(env, async () => {
    const worldCamera = new THREE.PerspectiveCamera(55, 16 / 9, 1.0, 2000)
    worldCamera.position.set(-850, 156, 205)
    const initialWorldCamPos = worldCamera.position.toArray()
    const renderer = createCountingRenderer()

    let worldSuspended = false
    const landings = []
    let veilOpens = 0
    let veilDones = 0

    const hostCtx = {
      renderer,
      worldCamera,
      bodyFlag: 'xxgActive',
      getWalker: () => null,
      openVeil() {
        veilOpens++
        return {
          async done() {
            veilDones++
          },
        }
      },
      suspendWorld() {
        worldSuspended = true
      },
      async resumeWorldAt(point) {
        worldSuspended = false
        landings.push(point)
        return true
      },
    }

    const indoor = createXxgIndoorScene({ layout: STAGE1_GREYBOX_LAYOUT, veilFadeInMs: 0, reenterCooldownMs: 50 })
    assert.equal(indoor.state, 'unmounted')
    assert.equal(await indoor.enter('E1'), false)
    assert.equal(await indoor.exit(), false)

    await indoor.mount(hostCtx)
    await indoor.mount(hostCtx) // idempotent repeat mount
    assert.equal(indoor.state, 'idle')

    const bodyChildrenAfterMount = env.body.children.length
    const sceneChildrenAfterMount = indoor.scene.children[0].children.length

    // 8 full enter -> walk -> collide -> render -> exit cycles across E1, E2, W1, W2
    for (let i = 0; i < 8; i++) {
      const pid = XXG_PORTAL_IDS[i % XXG_PORTAL_IDS.length]
      assert.equal(await indoor.enter(pid), true)
      assert.equal(indoor.state, 'inside')
      assert.equal(worldSuspended, true)
      assert.equal(env.body.dataset.xxgActive, '1')
      // worldCamera is never mutated (first-person uses indoor.camera)
      assert.deepEqual(worldCamera.position.toArray(), initialWorldCamPos)
      assert.equal(indoor.getPlayerSnapshot().descending, true)
      assert.ok(indoor.camera.position.y > XXG_PLAYER.eyeHeight, '首帧应位于楼梯顶上方')

      // Reject concurrent enter while already inside
      assert.equal(await indoor.enter('W2'), false)

      // 跑完脚本下楼后再验证正常移动与碰墙
      for (let f = 0; f < 240 && indoor.getPlayerSnapshot().descending; f++) {
        indoor.step(0.05)
      }
      assert.equal(indoor.getPlayerSnapshot().descending, false)
      assert.ok(Math.abs(indoor.camera.position.y - XXG_PLAYER.eyeHeight) < 0.02)

      // Move & collide against side wall
      env.mockWindow.dispatchKey('keydown', 'KeyW')
      for (let f = 0; f < 6; f++) indoor.step(0.05)
      env.mockWindow.dispatchKey('keyup', 'KeyW')
      env.mockWindow.dispatchKey('keydown', 'KeyD')
      for (let f = 0; f < 36; f++) indoor.step(0.05)
      env.mockWindow.dispatchKey('keyup', 'KeyD')

      assert.equal(indoor.renderFrame(), true)
      const m = indoor.getMetrics()
      assert.ok(m.drawCalls > 0 && m.drawCalls <= XXG_BUDGET.indoorDrawCallsMax)
      assert.ok(m.lastSwapMs <= XXG_BUDGET.swapMsMax)
      assert.equal(m.lastBlackFrames, 0)
      assert.ok(indoor.getPlayerSnapshot().collisionContacts > 0)

      assert.equal(await indoor.exit(), true)
      assert.equal(indoor.state, 'idle')
      assert.equal(worldSuspended, false)
      assert.equal(env.body.dataset.xxgActive, undefined)
      assert.equal(env.body.dataset.xxgIndoor, undefined)
      assert.equal(env.body.children.length, bodyChildrenAfterMount, 'zero residual DOM nodes across cycles')
      assert.equal(indoor.scene.children[0].children.length, sceneChildrenAfterMount, 'zero residual scene nodes across cycles')

      const expected = portalLanding(getPortal(pid))
      const actual = landings.at(-1)
      assert.ok(Math.hypot(actual.x - expected.x, actual.z - expected.z) < 1e-6)
      assert.ok(Math.abs(actual.yaw - expected.yaw) < 1e-6)
    }

    assert.equal(veilOpens, 16)
    assert.equal(veilDones, 16)
    indoor.dispose()
  })
})

test('default createXxgIndoorScene loads full 53-shop B1 layout with PBR materials within budget', async () => {
  const env = createMockDomEnvironment()
  await withMockGlobals(env, async () => {
    const renderer = createCountingRenderer()
    const worldCamera = new THREE.PerspectiveCamera(55, 16 / 9, 1, 2000)
    const indoor = createXxgIndoorScene({ veilFadeInMs: 0, reenterCooldownMs: 50 })
    await indoor.mount({
      renderer,
      worldCamera,
      bodyFlag: 'xxgActive',
      getWalker: () => null,
      openVeil: () => ({ done: async () => {} }),
      suspendWorld() {},
      resumeWorldAt: async () => true,
    })
    assert.equal(indoor.getLayout().shops.length, 53)
    for (const pid of XXG_PORTAL_IDS) {
      assert.equal(await indoor.enter(pid), true)
      assert.equal(indoor.renderFrame(), true)
      const metrics = indoor.getMetrics()
      assert.ok(metrics.drawCalls >= 10 && metrics.drawCalls <= XXG_BUDGET.indoorDrawCallsMax, `drawCalls=${metrics.drawCalls}`)
      assert.ok(metrics.textureBytes <= XXG_BUDGET.indoorTextureBytesMax)
      for (let f = 0; f < 240 && indoor.getPlayerSnapshot().descending; f++) {
        indoor.step(0.05)
      }
      assert.equal(indoor.getPlayerSnapshot().descending, false, `${pid} descent must complete`)
      const contactsBefore = indoor.getPlayerSnapshot().collisionContacts
      const collideKey = pid === 'W2' ? 'KeyA' : 'KeyD'
      env.mockWindow.dispatchKey('keydown', collideKey)
      for (let f = 0; f < 40; f++) indoor.step(0.05)
      env.mockWindow.dispatchKey('keyup', collideKey)
      assert.ok(indoor.getPlayerSnapshot().collisionContacts > contactsBefore, `${pid} wall collision must engage`)
      assert.equal(await indoor.exit(), true)
    }
    indoor.dispose()
  })
})

test('出口楼梯：进场脚本下楼锁输入、落脚点交还控制、下段侧移后退不离开、上段触发离开且每帧 ΔeyeY ≤ 0.08', async () => {
  const env = createMockDomEnvironment()
  const hadNode = 'Node' in globalThis
  if (!hadNode) globalThis.Node = class {}
  try {
    await withMockGlobals(env, async () => {
      let t = 0
      const indoor = createXxgIndoorScene({ veilFadeInMs: 0, reenterCooldownMs: 0, crowdMaxAgents: 0, now: () => t })
      await indoor.mount({
        renderer: createCountingRenderer(),
        worldCamera: new THREE.PerspectiveCamera(55, 16 / 9, 1, 2000),
        bodyFlag: 'xxgActive',
        getWalker: () => null,
        openVeil: () => ({ done: async () => {} }),
        suspendWorld() {},
        resumeWorldAt: async () => true,
      })
      const settle = () => new Promise(r => setTimeout(r, 5))

      const e1 = indoor.getLayout().exits.find(e => e.portalId === 'E1')
      const e1Stair = resolveXxgExitStair(e1)
      const progressOf = snap =>
        (snap.x - e1Stair.startCenter.x) * e1Stair.up.x + (snap.z - e1Stair.startCenter.z) * e1Stair.up.z

      // ① 进场后 descending=true，采集无按键基准轨迹（10 帧）
      assert.equal(await indoor.enter('E1'), true)
      const startSnap = indoor.getPlayerSnapshot()
      assert.equal(startSnap.descending, true)
      assert.ok(Math.abs(startSnap.y - e1Stair.topY) < 1e-3, '起点脚底高度应为 topY')
      assert.ok(startSnap.pitch < -0.25, '起点俯角应朝下约 -18°')
      for (let f = 0; f < 10; f++) {
        t += 50
        indoor.step(0.05)
      }
      const refSnap10 = indoor.getPlayerSnapshot()
      assert.equal(refSnap10.descending, true)
      assert.equal(await indoor.exit(), true)

      // 重新进场：下楼期间按 W/D/E + 拖拽视角不产生任何额外移动或偏航
      assert.equal(await indoor.enter('E1'), true)
      let prevEyeY = indoor.getPlayerSnapshot().eyeY
      let maxDeltaEyeY = 0
      const stepTracked = (dt = 0.05) => {
        t += dt * 1000
        indoor.step(dt)
        const curEyeY = indoor.getPlayerSnapshot().eyeY
        maxDeltaEyeY = Math.max(maxDeltaEyeY, Math.abs(curEyeY - prevEyeY))
        prevEyeY = curEyeY
      }

      env.mockWindow.dispatchKey('keydown', 'KeyW')
      env.mockWindow.dispatchKey('keydown', 'KeyD')
      env.mockWindow.dispatchKey('keydown', 'KeyE')
      env.mockWindow.dispatchKey('pointerdown', '', { button: 0, clientX: 0, clientY: 0 })
      env.mockWindow.dispatchKey('pointermove', '', { clientX: 200, clientY: -120 })
      env.mockWindow.dispatchKey('pointerup', '')
      for (let f = 0; f < 10; f++) stepTracked(0.05)
      env.mockWindow.dispatchKey('keyup', 'KeyW')
      env.mockWindow.dispatchKey('keyup', 'KeyD')
      env.mockWindow.dispatchKey('keyup', 'KeyE')

      const lockedSnap10 = indoor.getPlayerSnapshot()
      assert.equal(indoor.state, 'inside', '下楼期间按 E 不能触发离开')
      assert.equal(lockedSnap10.descending, true)
      assert.equal(lockedSnap10.x, refSnap10.x, '下楼期间按 W/D 不得偏离脚本 X')
      assert.equal(lockedSnap10.z, refSnap10.z, '下楼期间按 W/D 不得偏离脚本 Z')
      assert.equal(lockedSnap10.yaw, refSnap10.yaw, '下楼期间拖拽不得改变 yaw')
      assert.equal(lockedSnap10.pitch, refSnap10.pitch, '下楼期间拖拽不得改变 pitch')

      // ② 下楼完成后落在 exit.foot 附近、yaw ≈ exit.yaw、eyeY ≈ 1.6
      for (let f = 0; f < 240 && indoor.getPlayerSnapshot().descending; f++) {
        stepTracked(0.05)
      }
      const landed = indoor.getPlayerSnapshot()
      assert.equal(landed.descending, false)
      assert.ok(Math.hypot(landed.x - e1.foot.x, landed.z - e1.foot.z) < 0.05, `落点偏离 foot: ${landed.x},${landed.z}`)
      assert.ok(Math.abs(landed.y) < 1e-3, `落点脚底高应为 0，实际 ${landed.y}`)
      assert.ok(Math.abs(landed.eyeY - XXG_PLAYER.eyeHeight) < 0.02, `落点 eyeY=${landed.eyeY}`)
      assert.ok(Math.abs(normalizeAngleRad(landed.yaw - e1.yaw)) < 0.02, `落点 yaw=${landed.yaw}`)
      assert.ok(Math.abs(landed.pitch) < 0.02, `落点 pitch=${landed.pitch}`)

      // 转身面朝 E1 楼梯上行方向
      const deltaYaw = normalizeAngleRad(e1Stair.upYaw - landed.yaw)
      env.mockWindow.dispatchKey('pointerdown', '', { button: 0, clientX: 0, clientY: 0 })
      env.mockWindow.dispatchKey('pointermove', '', { clientX: -deltaYaw / 0.0026, clientY: 0 })
      env.mockWindow.dispatchKey('pointerup', '')

      // ④ 走上楼梯下段后侧移/后退不触发离开
      env.mockWindow.dispatchKey('keydown', 'KeyW')
      for (let f = 0; f < 60 && indoor.state === 'inside'; f++) {
        stepTracked(0.05)
        const s = progressOf(indoor.getPlayerSnapshot())
        if (s >= Math.min(0.6, e1Stair.runLen * 0.25)) break
      }
      env.mockWindow.dispatchKey('keyup', 'KeyW')
      assert.equal(indoor.state, 'inside')
      assert.ok(indoor.getPlayerSnapshot().y > 0.02, '应已踏上楼梯下段')

      for (const code of ['KeyA', 'KeyD', 'KeyS']) {
        env.mockWindow.dispatchKey('keydown', code)
        for (let f = 0; f < 6 && indoor.state === 'inside'; f++) stepTracked(0.05)
        env.mockWindow.dispatchKey('keyup', code)
        assert.equal(indoor.state, 'inside', `楼梯下段按 ${code} 不应触发离开`)
      }

      // ③ 面朝楼梯按住 W 走上去，在楼梯上段触发 exiting，触发瞬间 eyeY < 2.9 + 0.3 且 progress < 楼梯长度
      env.mockWindow.dispatchKey('keydown', 'KeyW')
      for (let f = 0; f < 120 && indoor.state === 'inside'; f++) {
        stepTracked(0.05)
      }
      env.mockWindow.dispatchKey('keyup', 'KeyW')
      assert.equal(indoor.state, 'exiting', '沿楼梯上行应在楼梯上段触发离开')

      const exitSnap = indoor.getPlayerSnapshot()
      const exitProgress = progressOf(exitSnap)
      assert.ok(
        exitSnap.eyeY < indoor.getLayout().ceilingHeight + 0.3,
        `触发离开时 eyeY=${exitSnap.eyeY} 必须 < ${indoor.getLayout().ceilingHeight + 0.3}`,
      )
      assert.ok(exitProgress > 0 && exitProgress < e1Stair.runLen, `触发点 progress=${exitProgress} 应 < ${e1Stair.runLen}`)

      // ⑤ 全程每帧 eyeY 变化 ≤ 0.08m
      assert.ok(maxDeltaEyeY <= 0.08 + 1e-9, `单帧最大 eyeY 变化 ${maxDeltaEyeY} 超过 0.08m`)

      await settle()
      assert.equal(indoor.state, 'idle')
      indoor.dispose()
    })
  } finally {
    if (!hadNode) delete globalThis.Node
  }
})

test('dispose from any state (including mid-inside) releases GPU resources, DOM, and window listeners with zero leaks', async () => {
  const env = createMockDomEnvironment()
  await withMockGlobals(env, async () => {
    const renderer = createCountingRenderer()
    const worldCamera = new THREE.PerspectiveCamera(55, 16 / 9, 1, 2000)

    for (let round = 0; round < 3; round++) {
      const indoor = createXxgIndoorScene({ veilFadeInMs: 0 })
      await indoor.mount({
        renderer,
        worldCamera,
        bodyFlag: 'xxgActive',
        getWalker: () => null,
        openVeil: () => ({ done: async () => {} }),
        suspendWorld() {},
        resumeWorldAt: async () => true,
      })
      assert.equal(await indoor.enter('W1'), true)
      assert.equal(indoor.state, 'inside')
      assert.equal(env.body.dataset.xxgActive, '1')

      let disposedGeoms = 0
      let disposedMats = 0
      indoor.scene.traverse(n => {
        if (n instanceof THREE.Mesh) {
          n.geometry.addEventListener('dispose', () => disposedGeoms++)
          n.material.addEventListener('dispose', () => disposedMats++)
        }
      })

      indoor.dispose()
      indoor.dispose() // idempotent second dispose
      assert.equal(indoor.state, 'disposed')
      assert.equal(indoor.scene.children.length, 0)
      assert.ok(disposedGeoms >= 8)
      assert.ok(disposedMats >= 8)
      assert.equal(env.body.dataset.xxgActive, undefined)
      assert.equal(env.body.dataset.xxgIndoor, undefined)
      assert.equal(env.body.children.length, 1, 'only original host canvas remains in body')
      assert.equal(env.head.children.length, 0, 'injected stylesheet link removed')
      assert.equal(env.mockWindow.totalListenerCount(), 0, 'zero leaked window listeners')
      assert.equal(await indoor.enter('W1'), false)
      assert.equal(indoor.renderFrame(), false)
      indoor.step(0.05)
    }
  })
})

test('mountLazyXiaoxianggang prefetches on portal proximity, renders Hy1 B1 layout <= 40 calls, and obeys UI rules', async () => {
  const cssText = fs.readFileSync(path.join(__dirname, 'xxg-ui.css'), 'utf8')
  assert.equal(/提示|Tip|小贴士|linear-gradient|[!！]|[\p{Emoji_Presentation}]/u.test(cssText), false)
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(cssText), false)

  // Verify runtime directory contains no duplicate legacy implementations
  const runtimeFiles = fs.readdirSync(__dirname)
  for (const legacy of ['contract-scene.ts', 'host-bridge.ts', 'stage1-contract-layout.json']) {
    assert.equal(runtimeFiles.includes(legacy), false, `legacy file ${legacy} must not exist`)
  }

  const env = createMockDomEnvironment()
  await withMockGlobals(env, async () => {
    const renderer = createCountingRenderer()
    const worldCamera = new THREE.PerspectiveCamera(55, 16 / 9, 1, 2000)
    const lazy = mountLazyXiaoxianggang(
      {
        renderer,
        worldCamera,
        bodyFlag: 'xxgActive',
        getWalker: () => null,
        openVeil: () => ({ done: async () => {} }),
        suspendWorld() {},
        resumeWorldAt: async () => true,
      },
      { layout: XIAOXIANGGANG_B1_LAYOUT, veilFadeInMs: 0 },
    )

    const probeKeys = Object.keys(lazy.getProbe())
    for (const banned of ['forceEnter', 'forceExit', 'teleportIndoor', 'grantFunds', 'skipTransition', 'debugScene']) {
      assert.equal(probeKeys.includes(banned), false)
    }

    assert.equal(await lazy.enter('E2'), true)
    assert.equal(lazy.isIndoor(), true)
    assert.equal(lazy.render(), true)
    assert.ok(lazy.getProbe().getMetrics().drawCalls <= XXG_BUDGET.indoorDrawCallsMax)
    assert.equal(await lazy.exit(), true)
    assert.equal(lazy.isIndoor(), false)
    lazy.dispose()
    assert.equal(env.mockWindow.totalListenerCount(), 0)
  })
})
