import {before, after, test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import * as THREE from 'three'

const threeEntryUrl = import.meta.resolve('three')

function createEventHub() {
  const map = new Map()
  return {
    addEventListener(type, fn, opts) {
      let list = map.get(type)
      if (!list) {
        list = []
        map.set(type, list)
      }
      list.push({fn, once: Boolean(opts && typeof opts === 'object' ? opts.once : false)})
    },
    removeEventListener(type, fn) {
      const list = map.get(type)
      if (!list) return
      map.set(type, list.filter((item) => item.fn !== fn))
    },
    dispatchEvent(ev) {
      const list = [...(map.get(ev.type) ?? [])]
      for (const item of list) {
        if (item.once) this.removeEventListener(ev.type, item.fn)
        item.fn(ev)
      }
      return true
    },
  }
}

function createMockElement(tag = 'div') {
  const hub = createEventHub()
  const attrs = new Map()
  const classes = new Set()
  const childrenBySelector = new Map()
  const styleProps = new Map()
  const style = new Proxy(
    {
      setProperty(k, v) {
        styleProps.set(k, String(v))
      },
    },
    {
      set(target, prop, value) {
        target[prop] = value
        return true
      },
    },
  )
  return {
    tagName: tag.toUpperCase(),
    className: '',
    hidden: false,
    textContent: '',
    innerHTML: '',
    isContentEditable: false,
    dataset: {},
    style,
    onclick: null,
    onpointerdown: null,
    onlostpointercapture: null,
    classList: {
      toggle(name, force) {
        if (force === undefined) {
          if (classes.has(name)) {
            classes.delete(name)
            return false
          }
          classes.add(name)
          return true
        }
        if (force) classes.add(name)
        else classes.delete(name)
        return Boolean(force)
      },
      contains(name) {
        return classes.has(name)
      },
    },
    setAttribute(k, v) {
      attrs.set(k, String(v))
    },
    getAttribute(k) {
      return attrs.get(k) ?? null
    },
    hasAttribute(k) {
      return attrs.has(k)
    },
    closest() {
      return null
    },
    setPointerCapture() {},
    animate() {
      return {onfinish: null}
    },
    remove() {},
    append() {},
    querySelector(sel) {
      if (!childrenBySelector.has(sel)) {
        childrenBySelector.set(sel, createMockElement(sel.includes('btn') ? 'button' : 'div'))
      }
      return childrenBySelector.get(sel)
    },
    ...hub,
  }
}

const origGlobals = {
  window: globalThis.window,
  document: globalThis.document,
  localStorage: globalThis.localStorage,
  AudioContext: globalThis.AudioContext,
  innerWidth: globalThis.innerWidth,
  innerHeight: globalThis.innerHeight,
  perfNow: performance.now.bind(performance),
}

let tempDir
let bundleMod
let mockWindow
let mockBody
let appendedRoots = []
let nowMs = 10000

before(async () => {
  const store = new Map()
  mockWindow = createEventHub()
  mockBody = createMockElement('body')
  mockBody.append = (node) => {
    appendedRoots.push(node)
  }
  globalThis.window = mockWindow
  globalThis.document = {
    body: mockBody,
    activeElement: null,
    createElement: (tag) => createMockElement(tag),
    querySelector: () => null,
  }
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      store.set(k, String(v))
    },
    removeItem: (k) => {
      store.delete(k)
    },
  }
  globalThis.AudioContext = class MockAudioContext {
    state = 'suspended'
    resume() {
      this.state = 'running'
      return Promise.resolve()
    }
  }
  globalThis.innerWidth = 1280
  globalThis.innerHeight = 720
  performance.now = () => nowMs

  tempDir = await mkdtemp(join(tmpdir(), 'glol-duty-gate-'))
  const barrelPath = join(tempDir, 'barrel.ts')
  const cwd = process.cwd()
  await writeFile(
    barrelPath,
    [
      `export {combatController, isPunchBlockedByDuty} from ${JSON.stringify(join(cwd, 'web/src/combat/controller.ts'))}`,
      `export {setBinding, resetBindings} from ${JSON.stringify(join(cwd, 'web/src/input/keymap.ts'))}`,
      `export {SmokeSession, isSmokeBlockedByDuty, DUTY_NO_SMOKING_TOAST} from ${JSON.stringify(join(cwd, 'web/src/smoke/session.ts'))}`,
      `export {BRANDS} from ${JSON.stringify(join(cwd, 'web/src/smoke/data.ts'))}`,
    ].join('\n'),
    'utf8',
  )
  const outfile = join(tempDir, 'bundle.mjs')
  await build({
    entryPoints: [barrelPath],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    loader: {'.css': 'empty'},
    plugins: [
      {
        name: 'resolve-externals',
        setup(buildCtx) {
          buildCtx.onResolve({filter: /^three$/}, () => ({path: threeEntryUrl, external: true}))
        },
      },
    ],
    external: ['three/*', threeEntryUrl],
  })
  bundleMod = await import(pathToFileURL(outfile).href)
})

after(async () => {
  performance.now = origGlobals.perfNow
  globalThis.window = origGlobals.window
  globalThis.document = origGlobals.document
  globalThis.localStorage = origGlobals.localStorage
  globalThis.AudioContext = origGlobals.AudioContext
  globalThis.innerWidth = origGlobals.innerWidth
  globalThis.innerHeight = origGlobals.innerHeight
  if (tempDir) await rm(tempDir, {recursive: true, force: true})
})

function setDutyFlags(opts = {}) {
  delete mockBody.dataset.duty
  delete mockBody.dataset.tdDutyActive
  if (opts.duty !== undefined) mockBody.dataset.duty = opts.duty
  if (opts.tdDutyActive !== undefined) mockBody.dataset.tdDutyActive = opts.tdDutyActive
}

function mountCombatHarness() {
  appendedRoots = []
  const canvas = createMockElement('canvas')
  const figure = new THREE.Group()
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100)
  camera.position.set(0, 1.6, 3)
  camera.lookAt(0, 1, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  const packets = []
  let peerList = []
  let allowed = true
  const rig = {
    joints: {},
    footProbes: [],
    soleOffset: 0,
    clearPose() {},
    batch() {},
    attachmentAt() {
      return undefined
    },
  }
  const ctrl = bundleMod.combatController({
    canvas,
    figure,
    camera,
    rig,
    allowed: () => allowed,
    peers: () => peerList,
    send: (p) => packets.push(p),
    onDown: () => {},
    align: () => true,
  })
  const uiRoot = appendedRoots.at(-1)
  const punchBtn = uiRoot.querySelector('.cb-btn-punch')
  const reviveBtn = uiRoot.querySelector('.cb-btn-revive')
  return {
    ctrl,
    canvas,
    packets,
    punchBtn,
    reviveBtn,
    setPeers(next) {
      peerList = next
    },
    setAllowed(v) {
      allowed = v
    },
  }
}

test('k33 执勤时禁用出拳（Mouse0 / 重绑按键 / 移动端拳键 / 进行中蓄力），非执勤正常出拳', () => {
  const h = mountCombatHarness()
  bundleMod.resetBindings()

  // 1) duty='active' 执勤态：左键、按键、拳键全部拦停且隐藏拳键
  setDutyFlags({duty: 'active'})
  assert.equal(bundleMod.isPunchBlockedByDuty(), true)
  h.ctrl.tick(false)
  assert.equal(h.punchBtn.hidden, true, '执勤时应隐藏移动端出拳按钮')

  h.canvas.dispatchEvent({type: 'pointerdown', button: 0, pointerType: 'mouse', clientX: 100, clientY: 100, timeStamp: 1000, pointerId: 1})
  mockWindow.dispatchEvent({type: 'pointerup', target: h.canvas, timeStamp: 1050, pointerId: 1})
  h.punchBtn.onclick()

  // 即使将 punch 重绑为非执勤冲突键 KeyP，执勤态也必须拦停
  bundleMod.setBinding('punch', 'KeyP')
  mockWindow.dispatchEvent({type: 'keydown', code: 'KeyP', repeat: false, target: mockBody})
  assert.equal(h.packets.length, 0, 'duty=active 时所有出拳入口不得发包')
  assert.equal(h.ctrl.f.phase(nowMs, false), 'idle')

  // 2) 仅 tdDutyActive='1' 同样拦停
  setDutyFlags({tdDutyActive: '1'})
  assert.equal(bundleMod.isPunchBlockedByDuty(), true)
  h.ctrl.tick(false)
  assert.equal(h.punchBtn.hidden, true)
  h.punchBtn.onclick()
  mockWindow.dispatchEvent({type: 'keydown', code: 'KeyP', repeat: false, target: mockBody})
  assert.equal(h.packets.length, 0, 'tdDutyActive=1 时不得出拳')

  // 3) 非执勤重绑 KeyP 出拳可正常触发，恢复默认 Mouse0 也正常触发（windup + 100ms 后 punch）
  setDutyFlags({})
  assert.equal(bundleMod.isPunchBlockedByDuty(), false)
  h.ctrl.tick(false)
  assert.equal(h.punchBtn.hidden, false, '非执勤时应显示出拳按钮')

  mockWindow.dispatchEvent({type: 'keydown', code: 'KeyP', repeat: false, target: mockBody})
  assert.equal(h.packets.length, 1, '非执勤按重绑拳键应发出 windup')
  assert.equal(h.packets[0].t, 'windup')
  nowMs += 120
  h.ctrl.tick(false)
  assert.equal(h.packets.length, 2)
  assert.equal(h.packets[1].t, 'punch')

  bundleMod.resetBindings()
  nowMs += 1000
  h.packets.length = 0
  h.canvas.dispatchEvent({type: 'pointerdown', button: 0, pointerType: 'mouse', clientX: 120, clientY: 120, timeStamp: 2000, pointerId: 2})
  mockWindow.dispatchEvent({type: 'pointerup', target: h.canvas, timeStamp: 2040, pointerId: 2})
  assert.equal(h.packets.length, 1)
  assert.equal(h.packets[0].t, 'windup')
  assert.equal(h.ctrl.f.phase(nowMs, false), 'windup')

  nowMs += 120
  h.ctrl.tick(false)
  assert.equal(h.packets.length, 2)
  assert.equal(h.packets[1].t, 'punch')

  // 4) 蓄力途中进入执勤：pending 必须被撤销，不发出 punch
  nowMs += 1000
  h.packets.length = 0
  h.punchBtn.onclick()
  assert.equal(h.packets.length, 1)
  assert.equal(h.packets[0].t, 'windup')
  setDutyFlags({duty: 'active'})
  nowMs += 120
  h.ctrl.tick(false)
  assert.equal(h.packets.length, 1, '蓄力期间进入执勤应取消待发 punch')
})

test('k33 执勤期间扶人救援（start / stop / 救援键）仍可正常使用', () => {
  const h = mountCombatHarness()
  nowMs += 2000
  setDutyFlags({duty: 'active', tdDutyActive: '1'})
  h.setPeers([
    {id: 'peer-down-1', dn: true, x: 0.65, y: 0, z: 0, yaw: 0, progress: 0},
  ])

  h.ctrl.tick(false)
  assert.equal(h.punchBtn.hidden, true, '执勤时出拳键保持隐藏')
  assert.equal(h.reviveBtn.hidden, false, '执勤时靠近倒地者仍可显示救援键')

  const started = h.ctrl.start()
  assert.equal(started, true, '执勤时 start() 扶人救援必须返回 true')
  assert.deepEqual(h.packets, [{t: 'rescue-start', id: 'peer-down-1'}])

  h.ctrl.stop()
  assert.deepEqual(h.packets, [
    {t: 'rescue-start', id: 'peer-down-1'},
    {t: 'rescue-stop'},
  ])
})

test('k33 执勤时禁用香烟：SmokeSession 禁点禁吸 + walk/index.ts 切槽拦停与执勤瞬间自动收烟', async () => {
  const brand = bundleMod.BRANDS[0].id

  // 1) 非执勤：SmokeSession 正常点烟、推进到 sealed 并撕开
  setDutyFlags({})
  assert.equal(bundleMod.isSmokeBlockedByDuty(), false)
  const s = new bundleMod.SmokeSession(() => 0.5)
  assert.equal(s.start(brand, 20, false), true)
  assert.equal(s.active, true)
  s.advance(1.0)
  assert.equal(s.phase, 'sealed')
  assert.equal(s.act(() => true, () => true), true)
  assert.equal(s.phase, 'tear')

  // 2) 执勤开启（duty='active'）：进行中香烟 act() 立刻熄灭停止，且新开 start() 返回 false
  s.advance(1.0)
  assert.equal(s.phase, 'open')
  setDutyFlags({duty: 'active'})
  assert.equal(bundleMod.isSmokeBlockedByDuty(), true)
  assert.equal(s.act(() => true, () => true), false, '执勤态 act() 必须拦截')
  assert.equal(s.active, false, '执勤态 act() 应立即熄灭/收烟')
  assert.equal(s.start(brand, 20, false), false, 'duty=active 时不能点烟')

  // 3) 仅 tdDutyActive='1' 同样禁点烟
  setDutyFlags({tdDutyActive: '1'})
  assert.equal(bundleMod.isSmokeBlockedByDuty(), true)
  assert.equal(s.start(brand, 20, true), false, 'tdDutyActive=1 时不能点烟')
  assert.equal(bundleMod.DUTY_NO_SMOKING_TOAST, '执勤中禁止吸烟')

  // 4) 核验 walk/index.ts 接入：chooseSmoke / openSmokeShop / smokeAction / setTrafficVolunteerMode / tick
  const walkSrc = await readFile('web/src/walk/index.ts', 'utf8')
  const chooseIdx = walkSrc.indexOf('function chooseSmoke()')
  const chooseBody = walkSrc.slice(chooseIdx, chooseIdx + 420)
  const guardPos = chooseBody.indexOf('isDutyScopeActive()')
  const selectSmokePos = chooseBody.indexOf("selectSlot('smoke')")
  assert(guardPos > 0 && selectSmokePos > 0 && guardPos < selectSmokePos, "chooseSmoke 必须在 selectSlot('smoke') 之前拦截执勤态")
  assert(chooseBody.includes('notifyDutyNoSmoking()'), 'chooseSmoke 执勤拦截应弹出「执勤中禁止吸烟」提示')

  const volIdx = walkSrc.indexOf('setTrafficVolunteerMode(on:boolean)')
  const volBody = walkSrc.slice(volIdx, volIdx + 360)
  assert(volBody.includes('if(on)cancelSmokeForDuty(true)'), 'setTrafficVolunteerMode(true) 进入执勤瞬间必须自动收烟并切回空手')

  const tickSmokeIdx = walkSrc.indexOf("if(isDutyScopeActive()){\n      if(cigarette.active||hotbarSlot()==='smoke')")
  assert(tickSmokeIdx > 0, 'tick() 兜底执勤态自动收烟并退出 smoke 槽位')
})
