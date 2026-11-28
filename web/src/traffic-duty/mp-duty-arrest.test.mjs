import assert from 'node:assert/strict'
import {rmSync} from 'node:fs'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test, {after} from 'node:test'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'

const bundleDir = await mkdtemp(join(tmpdir(), 'glol-mp-duty-arrest-test-'))
process.once('exit', () => {
  try {
    rmSync(bundleDir, {recursive: true, force: true})
  } catch {
    // ignore
  }
})

function createMockDom() {
  const winTarget = new EventTarget()
  const store = new Map()
  const toasts = []

  class MockElement {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase()
      this.nodeType = 1
      this.dataset = {}
      this.style = {}
      this.children = []
      this.parentElement = null
      this.hidden = false
      this.open = false
      this.disabled = false
      this.textContent = ''
      this.className = ''
      this.isContentEditable = false
      this._attrs = new Map()
      this._listeners = new Map()
      const self = this
      this.classList = {
        add(...names) {
          const set = new Set(self.className.split(/\s+/).filter(Boolean))
          for (const n of names) set.add(n)
          self.className = [...set].join(' ')
        },
        remove(...names) {
          const set = new Set(self.className.split(/\s+/).filter(Boolean))
          for (const n of names) set.delete(n)
          self.className = [...set].join(' ')
        },
        contains(n) {
          return self.className.split(/\s+/).includes(n)
        },
        toggle(n, force) {
          const has = this.contains(n)
          const next = force === undefined ? !has : Boolean(force)
          if (next) this.add(n)
          else this.remove(n)
          return next
        },
      }
    }
    setAttribute(k, v) {
      this._attrs.set(k, String(v))
      if (k === 'open') this.open = true
      if (k === 'hidden') this.hidden = true
      if (k === 'contenteditable') this.isContentEditable = v !== 'false'
    }
    hasAttribute(k) {
      return this._attrs.has(k)
    }
    removeAttribute(k) {
      this._attrs.delete(k)
      if (k === 'open') this.open = false
      if (k === 'hidden') this.hidden = false
    }
    getAttribute(k) {
      return this._attrs.get(k) ?? null
    }
    append(...nodes) {
      for (const n of nodes) this.appendChild(n)
    }
    appendChild(node) {
      if (node && typeof node === 'object') {
        node.parentElement = this
        this.children.push(node)
      }
      return node
    }
    remove() {
      if (!this.parentElement) return
      const idx = this.parentElement.children.indexOf(this)
      if (idx >= 0) this.parentElement.children.splice(idx, 1)
      this.parentElement = null
    }
    get isConnected() {
      return this === body || this === head || Boolean(this.parentElement)
    }
    addEventListener(type, fn) {
      const list = this._listeners.get(type) ?? []
      list.push(fn)
      this._listeners.set(type, list)
    }
    removeEventListener(type, fn) {
      const list = this._listeners.get(type)
      if (!list) return
      const idx = list.indexOf(fn)
      if (idx >= 0) list.splice(idx, 1)
    }
    dispatchEvent(ev) {
      const handler = this[`on${ev.type}`]
      if (typeof handler === 'function') handler.call(this, ev)
      const list = this._listeners.get(ev.type) ?? []
      for (const fn of [...list]) fn(ev)
      return !ev.defaultPrevented
    }
    showModal() {
      this.open = true
    }
    close() {
      this.open = false
    }
    _matches(sel) {
      for (const part of sel.split(',').map((s) => s.trim())) {
        if (!part) continue
        if (part.startsWith('.')) {
          const cls = part.split(':')[0].slice(1)
          const notHidden = part.includes(':not([hidden])')
          if (this.classList.contains(cls) && (!notHidden || !this.hidden)) return true
        } else if (part === '[contenteditable]' && this.isContentEditable) {
          return true
        } else if (part === 'dialog[open]' && this.tagName === 'DIALOG' && this.open) {
          return true
        } else if (part.startsWith('[data-')) {
          const m = /^\[data-([^=\]]+)(?:="([^"]*)")?\]/.exec(part)
          if (m) {
            const camel = m[1].replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())
            if (camel in this.dataset && (m[2] === undefined || this.dataset[camel] === m[2])) return true
          }
        } else if (this.tagName === part.toUpperCase()) {
          return true
        }
      }
      return false
    }
    closest(sel) {
      let cur = this
      while (cur) {
        if (cur._matches(sel)) return cur
        cur = cur.parentElement
      }
      return null
    }
    querySelector(sel) {
      for (const child of this.children) {
        if (child._matches(sel)) return child
        const nested = child.querySelector(sel)
        if (nested) return nested
      }
      return null
    }
    querySelectorAll(sel) {
      const out = []
      for (const child of this.children) {
        if (child._matches(sel)) out.push(child)
        out.push(...child.querySelectorAll(sel))
      }
      return out
    }
    getBoundingClientRect() {
      return {left: 0, top: 0, width: 120, height: 40, right: 120, bottom: 40}
    }
  }

  const head = new MockElement('head')
  const body = new MockElement('body')
  const doc = {
    head,
    body,
    activeElement: null,
    createElement: (tag) => new MockElement(tag),
    getElementById: () => null,
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
  }

  const mockWindow = Object.assign(winTarget, {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    innerWidth: 1280,
    innerHeight: 720,
    location: {protocol: 'http:', host: '127.0.0.1:4173', search: ''},
    matchMedia: () => ({matches: false, addEventListener() {}, removeEventListener() {}}),
  })
  mockWindow.addEventListener('walk:toast', (ev) => toasts.push(ev.detail))

  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }

  return {MockElement, mockWindow, doc, body, storage, toasts}
}

const origGlobals = {
  window: globalThis.window,
  document: globalThis.document,
  localStorage: globalThis.localStorage,
  location: globalThis.location,
  WebSocket: globalThis.WebSocket,
  fetch: globalThis.fetch,
  addEventListener: globalThis.addEventListener,
  removeEventListener: globalThis.removeEventListener,
}

const dom = createMockDom()
globalThis.window = dom.mockWindow
globalThis.document = dom.doc
globalThis.localStorage = dom.storage
globalThis.location = dom.mockWindow.location
globalThis.addEventListener = (...args) => dom.mockWindow.addEventListener(...args)
globalThis.removeEventListener = (...args) => dom.mockWindow.removeEventListener(...args)
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ticket: 'idok500.mock.ticket'}),
})

class MockSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances = []

  constructor(url) {
    this.url = url
    this.readyState = MockSocket.CONNECTING
    this.bufferedAmount = 0
    this.sent = []
    this.closed = null
    this.onopen = null
    this.onmessage = null
    this.onclose = null
    this.onerror = null
    MockSocket.instances.push(this)
    queueMicrotask(() => {
      if (this.readyState !== MockSocket.CONNECTING) return
      this.readyState = MockSocket.OPEN
      this.onopen?.()
    })
  }
  send(raw) {
    this.sent.push(JSON.parse(raw))
  }
  emitServer(msg) {
    this.onmessage?.({data: JSON.stringify(msg)})
  }
  close(code = 1000, reason = '') {
    if (this.readyState >= MockSocket.CLOSING) return
    this.readyState = MockSocket.CLOSED
    this.closed = {code, reason}
    this.onclose?.({code, reason})
  }
}
globalThis.WebSocket = MockSocket

const bundlePath = join(bundleDir, 'sut.mjs')
await build({
  stdin: {
    contents: `
      export * as THREE from 'three'
      export {createTrafficDutyController} from './web/src/traffic-duty/controller.ts'
      export {mountTrafficDutyUi} from './web/src/traffic-duty/ui.ts'
      export {bindDutyKeyboard, createDutyKeysController} from './web/src/traffic-duty/duty-keys.ts'
      export {JIEFANG_DUTY_ZONE, SHIZIJIE_DUTY_ZONE, clampToBridgeDutyBounds, isInBridgeDutyBounds} from './web/src/traffic-duty/types.ts'
      export {createInteractArbiter} from './web/src/walk/interact-arbiter.ts'
      export {bindTravel, enterLanding, prepareTravel, travelTarget} from './web/src/mp-travel.ts'
      export {attachNet} from './web/src/net.ts'
      export {__setMockUser} from './web/src/ui/account.ts'
      export {Traffic} from './web/src/traffic/sim.ts'
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  loader: {'.css': 'empty'},
  plugins: [
    {
      name: 'mp-test-stubs',
      setup(buildCtx) {
        buildCtx.onResolve({filter: /travel-sites\.json$/}, () => ({path: 'stub:travel-sites', namespace: 'stub'}))
        buildCtx.onResolve({filter: /combat-config\.json$/}, () => ({path: 'stub:combat-config', namespace: 'stub'}))
        buildCtx.onResolve({filter: /fingerprint$/}, () => ({path: 'stub:fingerprint', namespace: 'stub'}))
        buildCtx.onResolve({filter: /cheat-capture$/}, () => ({path: 'stub:cheat-capture', namespace: 'stub'}))
        buildCtx.onResolve({filter: /ui\/account(\.ts)?$/}, () => ({path: 'stub:account', namespace: 'stub'}))
        buildCtx.onResolve({filter: /net-players(\.ts)?$/}, () => ({path: 'stub:net-players', namespace: 'stub'}))
        buildCtx.onResolve({filter: /mp-roster(\.ts)?$/}, () => ({path: 'stub:mp-roster', namespace: 'stub'}))
        buildCtx.onResolve({filter: /chat-store(\.ts)?$/}, () => ({path: 'stub:chat-store', namespace: 'stub'}))

        buildCtx.onLoad({filter: /.*/, namespace: 'stub'}, (args) => {
          if (args.path === 'stub:travel-sites') {
            return {
              contents: JSON.stringify({
                'spot:elephant': [-685, 1182],
                'spot:bridge': [-185, 35],
                'spot:xiaoyao': [-235, -120],
                'dock:dock-jiefang': [-164, 162],
                'shop:shop_shizijie_ebike': [-780.05, -160.08],
                'traffic-duty:bridge': [-268.5, 24.8],
                'traffic-duty:crossing': [-855.47, -171.47],
              }),
              loader: 'json',
            }
          }
          if (args.path === 'stub:combat-config') {
            return {
              contents: JSON.stringify({
                hpMax: 100,
                damage: {jab: 8, hook: 15},
                zone: {head: 1.5, body: 1},
                comboWindowMs: 850,
                punchCooldownMs: {jab: 350, hook: 650},
                cooldownSlackMs: 120,
                reachM: 0.9,
                networkMarginM: 0.4,
                downSeconds: 15,
                reviveHoldSeconds: 3,
                reviveDecayPerSec: 0.5,
                reviveHpRatio: 0.4,
                selfRiseHpRatio: 0.3,
                regenDelaySeconds: 8,
                regenPerSec: 3,
                crawlSpeed: 0.6,
                reviveRangeM: 1.6,
                reviveMoveM: 0.3,
                overheadBarHideSeconds: 5,
              }),
              loader: 'json',
            }
          }
          if (args.path === 'stub:fingerprint') {
            return {contents: `export const fingerprint = () => '0123456789abcdef'; export const deviceSummary = () => 'MockTest';`, loader: 'ts'}
          }
          if (args.path === 'stub:cheat-capture') {
            return {contents: `export type CaptureClientContext = Record<string, unknown>; export type CheatCapturePacket = {id: string; token: string}; export function triggerCheatCapture() {}`, loader: 'ts'}
          }
          if (args.path === 'stub:account') {
            return {
              contents: `
                let currentUser = null;
                const subs = new Set();
                export function onUser(fn) { subs.add(fn); fn(currentUser); return () => subs.delete(fn); }
                export function __setMockUser(u) { currentUser = u; for (const fn of subs) fn(currentUser); }
              `,
              loader: 'ts',
            }
          }
          if (args.path === 'stub:net-players') {
            return {
              contents: `
                export function players() {
                  const list = [];
                  return {list: () => list, clear: () => { list.length = 0 }, remove() {}, add() {}, move() {}, reconcile() {}, combat() {}, helping() {}, reveal() {}, tick() {}, emote() {}, avatar() {}, probe: () => []};
                }
              `,
              loader: 'ts',
            }
          }
          if (args.path === 'stub:mp-roster') {
            return {contents: `export function setRoster() {} export function clearRoster() {}`, loader: 'ts'}
          }
          if (args.path === 'stub:chat-store') {
            return {contents: `export function bindChat() {} export function receiveChat() {} export function setChatSelf() {}`, loader: 'ts'}
          }
          return {contents: '', loader: 'ts'}
        })
      },
    },
  ],
})

const mod = await import(pathToFileURL(bundlePath).href)
const THREE = mod.THREE

after(() => {
  globalThis.window = origGlobals.window
  globalThis.document = origGlobals.document
  globalThis.localStorage = origGlobals.localStorage
  globalThis.location = origGlobals.location
  globalThis.WebSocket = origGlobals.WebSocket
  globalThis.fetch = origGlobals.fetch
  globalThis.addEventListener = origGlobals.addEventListener
  globalThis.removeEventListener = origGlobals.removeEventListener
})

function keyEvent(code, target = null, type = 'keydown', repeat = false) {
  const ev = new Event(type, {cancelable: true})
  let defaultPrevented = false
  let stopped = false
  Object.defineProperty(ev, 'target', {value: target, configurable: true})
  Object.defineProperty(ev, 'code', {value: code, configurable: true})
  Object.defineProperty(ev, 'repeat', {value: repeat, configurable: true})
  Object.defineProperty(ev, 'defaultPrevented', {get: () => defaultPrevented, configurable: true})
  Object.defineProperty(ev, 'stopped', {get: () => stopped, configurable: true})
  ev.preventDefault = () => {
    defaultPrevented = true
  }
  ev.stopPropagation = () => {
    stopped = true
  }
  ev.stopImmediatePropagation = () => {
    stopped = true
  }
  return ev
}

test('IDOK-500 (1/4): 桥面 bounds 仅收 footY 且支持 emitHostClamp=false 防物理子步重入，非解放桥班次不误夹回', () => {
  const deckY = mod.JIEFANG_DUTY_ZONE.teleport.y
  // Foot Y matches deck -> clamped.y stays within [deckY - 1.1, deckY + 4.5] without upward drift
  let playerPos = {x: mod.JIEFANG_DUTY_ZONE.teleport.x, y: deckY, z: mod.JIEFANG_DUTY_ZONE.teleport.z}
  const hostClamps = []
  const toasts = []
  const ctrl = mod.createTrafficDutyController(
    {
      getPlayerPos: () => playerPos,
      isWalking: () => true,
      onDutyBoundaryClamp: (clamped) => hostClamps.push({...clamped}),
      onToast: (t) => toasts.push(t),
    },
    {autoMountUi: false},
  )

  // Complete officer briefing -> enter active shift on Jiefang bridge
  ctrl.startOfficerBriefing()
  ctrl.skipStory()
  assert.equal(ctrl.getSnapshot().phase, 'active')

  // Simulate moving out of bridge boundary by foot position (should trigger boundary clamp with preserved footY)
  const farOutFoot = {x: mod.JIEFANG_DUTY_ZONE.teleport.x - 160, y: deckY + 0.1, z: mod.JIEFANG_DUTY_ZONE.teleport.z}
  const rNoEmit = ctrl.clampPlayerPos(farOutFoot, {emitHostClamp: false})
  assert.equal(rNoEmit.clamped, true)
  assert.equal(hostClamps.length, 0, 'physics substep emitHostClamp=false must not re-enter host.onDutyBoundaryClamp')
  assert.ok(Math.abs(rNoEmit.pos.y - (deckY + 0.1)) < 0.01, `footY preserved without +0.85m lift: got ${rNoEmit.pos.y}`)

  // Regression check: passing capsule center (footY + 0.85) would drift upward relative to ground deck
  const clampedCenter = mod.clampToBridgeDutyBounds({x: farOutFoot.x, y: deckY + 0.85, z: farOutFoot.z})
  assert.ok(clampedCenter.clamped.y - deckY > 0.8, 'raw capsule center retains +0.85m offset confirming footPosition caller requirement')

  // Host-emitting clamp path calls callback once
  const rEmit = ctrl.clampPlayerPos(farOutFoot)
  assert.equal(rEmit.clamped, true)
  assert.equal(hostClamps.length, 1)

  ctrl.dispose()

  // Shizijie crossing shift must NOT clamp or abandon when standing at Shizijie coordinates
  playerPos = {x: mod.SHIZIJIE_DUTY_ZONE.teleport.x, y: mod.SHIZIJIE_DUTY_ZONE.teleport.y, z: mod.SHIZIJIE_DUTY_ZONE.teleport.z}
  const crossingHostClamps = []
  const ctrlCrossing = mod.createTrafficDutyController(
    {
      getPlayerPos: () => playerPos,
      isWalking: () => true,
      onDutyBoundaryClamp: (c) => crossingHostClamps.push(c),
    },
    {autoMountUi: false},
  )
  ctrlCrossing.startOfficerBriefing()
  ctrlCrossing.skipStory()
  assert.equal(ctrlCrossing.getSnapshot().phase, 'active')
  assert.equal(ctrlCrossing.getSnapshot().zoneId, 'shizijie')
  ctrlCrossing.step(0.1)
  assert.equal(ctrlCrossing.getSnapshot().phase, 'active')
  assert.equal(crossingHostClamps.length, 0, 'Shizijie crossing shift must never clamp against Jiefang bridge bounds')
  ctrlCrossing.dispose()
})

test('IDOK-500 (2/4): 执勤态 KeyE 不误触联机扶人，capture 热键放行聊天框/.chat-input/弹窗/倒地输入', () => {
  dom.body.dataset.tdDutyActive = '1'
  dom.body.dataset.duty = 'active'
  delete dom.body.dataset.tdKnockdown
  delete dom.body.dataset.kdDown
  dom.doc.activeElement = null

  let rescues = 0
  let cites = 0
  const arbiter = mod.createInteractArbiter({
    getContext: () => ({
      soloEnabled: false,
      active: true,
      modalOrOverlayBlocked: false,
      crashed: false,
      standingUp: false,
      pickingUpKind: null,
      aboardKind: null,
      inQuietZone: false,
      nearDownedVehicle: null,
      nearShop: null,
      nearServiceBay: null,
      nearTrafficViolator: {label: '拦停违规电动车', violation: 'no_helmet', fineYuan: 20, action: 'whistle_cite'},
      nearDutyOfficer: null,
      nearVehicle: null,
      nearBoat: null,
    }),
    onOpenShop: () => {},
    onOpenService: () => {},
    onVehicleOrBoatInteract: () => {},
    onWhistleCite: () => {
      cites++
    },
    startRescue: () => {
      rescues++
      return true
    },
    stopRescue: () => {},
  })

  // KeyE during active duty must NOT trigger MP rescue even when callback returns true
  const evE = keyEvent('KeyE')
  dom.mockWindow.dispatchEvent(evE)
  assert.equal(rescues, 0, 'KeyE must not start MP rescue during active duty')

  // KeyF during active duty triggers whistle_cite cleanly
  const evF = keyEvent('KeyF')
  dom.mockWindow.dispatchEvent(evF)
  assert.equal(cites, 1, 'KeyF during duty cites violator cleanly')

  // When off-duty, KeyE triggers MP rescue normally
  delete dom.body.dataset.tdDutyActive
  delete dom.body.dataset.duty
  const evEOff = keyEvent('KeyE')
  dom.mockWindow.dispatchEvent(evEOff)
  assert.equal(rescues, 1, 'KeyE resumes normal MP rescue when off duty')
  arbiter.dispose()

  // bindDutyKeyboard capture guard: ignore editable targets, .chat-input, open dialog, knockdown
  const gestures = []
  const dutyKeys = mod.createDutyKeysController({
    isDutyActive: () => true,
    getPlayerPos: () => ({x: -268.5, y: 151.86, z: 24.8}),
    getActors: () => [],
    playGesture: (k) => gestures.push(k),
  })
  const bound = mod.bindDutyKeyboard(dom.mockWindow, dutyKeys, () => true)

  const chatInput = new dom.MockElement('input')
  chatInput.classList.add('chat-input')
  dom.body.appendChild(chatInput)
  dom.doc.activeElement = chatInput
  const chatKey = keyEvent('KeyQ', chatInput)
  dom.mockWindow.dispatchEvent(chatKey)
  assert.equal(gestures.length, 0, '.chat-input focus must bypass duty whistle Q')
  assert.equal(chatKey.defaultPrevented, false)
  assert.equal(chatKey.stopped, false)
  dom.doc.activeElement = null
  chatInput.remove()

  dom.body.dataset.tdKnockdown = '1'
  const kdKey = keyEvent('KeyE', dom.body)
  dom.mockWindow.dispatchEvent(kdKey)
  assert.equal(kdKey.defaultPrevented, false)
  delete dom.body.dataset.tdKnockdown

  const dialogEl = new dom.MockElement('dialog')
  dialogEl.showModal()
  dom.body.appendChild(dialogEl)
  const dlgKey = keyEvent('KeyQ', dom.body)
  dom.mockWindow.dispatchEvent(dlgKey)
  assert.equal(gestures.length, 0, 'open modal dialog must bypass duty hotkeys')
  dialogEl.remove()

  // Outside chat/modal/knockdown: Q whistle fires cleanly
  const liveKey = keyEvent('KeyQ', dom.body)
  dom.mockWindow.dispatchEvent(liveKey)
  assert.deepEqual(gestures, ['whistle'])
  assert.equal(liveKey.defaultPrevented, true)

  // Keyup on KeyE inside editable target still releases flag_stop without leaving flag held
  dom.mockWindow.dispatchEvent(keyEvent('KeyE', dom.body))
  dom.doc.activeElement = chatInput
  dom.mockWindow.dispatchEvent(keyEvent('KeyE', chatInput, 'keyup'))
  assert.deepEqual(gestures, ['whistle', 'flag_stop'])
  dom.doc.activeElement = null
  bound.dispose()
})

test('IDOK-500 (3/4): 中距(24..200m)预检断连与远距(>200m)放行及 precheck+target 优先级', async () => {
  dom.toasts.length = 0

  // 1) prepareTravel must honor reply.leave EVEN when target is matched
  let leftDelay = 0
  let resumed = false
  const perm = await mod.prepareTravel(
    'traffic-duty:bridge',
    -268.5,
    24.8,
    async (target) => {
      assert.equal(target, 'traffic-duty:bridge')
      return {ok: true, leave: true, rejoinAfterMs: 3000}
    },
    (delay) => {
      leftDelay = delay
      return () => {
        resumed = true
      }
    },
  )
  assert.equal(leftDelay, 3000)
  assert.equal(typeof perm, 'function')
  perm()
  assert.equal(resumed, true)

  // 2) Full attachNet WebSocket integration across <=24m, 24..200m (84.1m spot:bridge->traffic-duty:bridge), mp-teleport, and >200m
  MockSocket.instances.length = 0
  let currentPose = {x: -185, y: 152, z: 35, yaw: 0, v: 0, gr: 1}
  const setbacks = []
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera()
  const net = mod.attachNet(
    scene,
    [],
    () => currentPose,
    () => ({}),
    camera,
    () => ({act: 'walk', detail: ''}),
    () => {},
    (x, y, z) => setbacks.push({x, y, z}),
  )
  mod.__setMockUser({id: 'user-1', uid: 10001, nickname: '交警测试'})

  // Wait for async fetch(/api/rt/ticket) -> WebSocket open
  for (let i = 0; i < 20 && MockSocket.instances.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 5))
  }
  const ws1 = MockSocket.instances.at(-1)
  assert.ok(ws1, 'WebSocket should connect after mock login')
  await new Promise((r) => setTimeout(r, 5))
  ws1.emitServer({t: 'welcome', me: {id: 'p1', uid: 10001, name: '交警测试', hp: 100, dn: 0, progress: 0}, online: 1, players: []})
  assert.equal(net.status().state, 'online')

  // a) Short range <=24m: allowed immediately without travel RPC
  const sentBeforeShort = ws1.sent.length
  const shortOk = await mod.enterLanding('traffic-duty', -195, 35, async () => true)
  assert.equal(shortOk, true)
  assert.equal(ws1.sent.slice(sentBeforeShort).filter((m) => m.t === 'travel').length, 0)

  const mpCheck = mod.enterLanding('mp-teleport', -138, 51, async () => assert.fail('precheck refused'))
  const localRequest=ws1.sent.at(-1)
  assert.equal(localRequest.precheck,true);assert.equal(localRequest.target,null)
  ws1.emitServer({t:'travel_result',seq:localRequest.seq,ok:false,code:'combat'})
  assert.equal(await mpCheck,false)
  assert.equal(net.status().state, 'online')

  // c) Medium range 24..200m: spot:bridge (-185, 35) -> traffic-duty:bridge (-268.5, 24.8) = 84.1m
  let landedMed = false
  const medPromise = mod.enterLanding('traffic-duty:bridge', -268.5, 24.8, async () => {
    currentPose = {x: -268.5, y: 151.86, z: 24.8, yaw: -2.34, v: 0, gr: 1}
    landedMed = true
    return true
  })
  const travelReq = ws1.sent.findLast((m) => m.t === 'travel')
  assert.equal(travelReq.precheck, true, '24..200m teleport must send precheck=true')
  assert.equal(travelReq.target, 'traffic-duty:bridge', 'known medium-distance site survives the precheck disconnect')
  assert.equal(travelReq.reason, 'traffic-duty')

  // Simulate server precheckLeave reply with tiny rejoin window so test finishes fast
  ws1.emitServer({t: 'travel_result', seq: travelReq.seq, ok: true, leave: true, rejoinAfterMs: 30})
  const medResult = await medPromise
  assert.equal(medResult, true)
  assert.equal(landedMed, true)
  assert.equal(ws1.closed?.reason, 'stop', 'medium-range precheck must cleanly close socket during landing')

  // During landingPaused window: >24m teleport rejected with cooldown toast
  const blockedCooldown = await mod.enterLanding('traffic-duty:crossing', -855.47, -171.47, async () => true)
  assert.equal(blockedCooldown, false)
  assert.equal(dom.toasts.at(-1), '传送冷却中，请稍后')

  // Wait for rejoinAfterMs -> reconnects cleanly at Jiefang bridge
  for (let i = 0; i < 30 && MockSocket.instances.length < 2; i++) {
    await new Promise((r) => setTimeout(r, 10))
  }
  const ws2 = MockSocket.instances.at(-1)
  assert.ok(ws2 && ws2 !== ws1, 'socket must reconnect after rejoinAfterMs')
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(ws2.sent.find(m=>m.t==='join')?.arrival,'travel')
  ws2.emitServer({t: 'welcome', me: {id: 'p1', uid: 10001, name: '交警测试', hp: 100, dn: 0, progress: 0}, online: 1, players: []})
  assert.equal(net.status().state, 'online')
  assert.equal(await mod.enterLanding('geolocation',3000,2400,()=>assert.fail('unknown site')),false)

  // d) Long range >200m to known site: Jiefang bridge (-268.5, 24.8) -> Shizijie crossing (-855.47, -171.47)
  const farPromise = mod.enterLanding('traffic-duty:crossing', -855.47, -171.47, async () => true)
  const farReq = ws2.sent.findLast((m) => m.t === 'travel')
  assert.equal(farReq.target, 'traffic-duty:crossing', '>200m must send resolved target id without precheck disconnect')
  assert.equal(farReq.precheck, undefined)
  ws2.emitServer({t: 'travel_result', seq: farReq.seq, ok: true, code: 'ok'})
  assert.equal(await farPromise, true)

  // e) Server setback invokes onSetback cleanly
  ws2.emitServer({t: 'setback', x: -260, y: 152, z: 25, kind: 'speed'})
  assert.deepEqual(setbacks, [{x: -260, y: 152, z: 25}])

  net.dispose()
})

test('IDOK-500 (4/4): 远距点击去交警岗在传送被拒时不误弹"正在前往"提示', async () => {
  const container = new dom.MockElement('div')
  dom.body.appendChild(container)
  const toasts = []
  let tpResult = false

  const ctrl = mod.createTrafficDutyController(
    {
      getPlayerPos: () => ({x: -685, y: 152, z: 1182}), // far from bridge
      isWalking: () => true,
      mountContainer: container,
      onTeleportToBridge: async () => tpResult,
      onToast: (t) => toasts.push(t),
    },
    {mountUi: mod.mountTrafficDutyUi, autoMountUi: true},
  )

  ctrl.openPanel('duty')
  const marker = container.querySelector('[data-td-officer-marker="1"]')
  assert.ok(marker, 'officer marker mounted')
  marker.dispatchEvent({type: 'click'})
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(toasts.includes('正在前往解放桥交警岗，靠近后按 F 对话'), false, 'failed teleport must not toast misleading success')

  tpResult = true
  marker.dispatchEvent({type: 'click'})
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(toasts.includes('正在前往解放桥交警岗，靠近后按 F 对话'), true)

  ctrl.dispose()
  container.remove()
})

test('IDOK-500 (5/5): 开单拦截保留车辆静止不滑走（pullOverViolator 对 halted/pulled_over 续停）且十字街岗可正常开单', async () => {
  const sim = new mod.Traffic(
    {
      nodes: [
        {id: 1, x: -275, y: 151.86, z: 25},
        {id: 2, x: -235, y: 151.86, z: 25},
      ],
      lanes: [
        {id: 10, from: 1, to: 2, kind: 'nonmotor', cls: 'cycleway', speedKmh: 20, width: 3, offset: 0},
      ],
      signals: [],
    },
    () => 0.5,
  )
  const track = [...sim.allTracks()][0]
  assert.ok(track)
  const makeScooter = (id, dist, dutyState) => ({
    id,
    track,
    dist,
    speed: dutyState === 'normal' ? 4.5 : 0,
    kind: 'scooter',
    down: 0,
    dodge: 0,
    x: track.start.x + track.dx * dist,
    y: 151.86,
    z: track.start.z + track.dz * dist,
    yaw: track.yaw,
    scale: 1,
    leaving: false,
    halfWidth: 0.3,
    halfLength: 0.85,
    height: 1.5,
    violation: 'no_helmet',
    violations: ['no_helmet'],
    vehicleSubtype: 'ebike',
    cited: false,
    dutyState,
    haltedByDuty: dutyState !== 'normal',
  })

  // 1) Normal actor transitions to pulling_over when pullOverViolator is explicitly called
  const normalScooter = makeScooter('s_normal', 5, 'normal')
  sim.actors.push(normalScooter)
  assert.equal(sim.pullOverViolator(normalScooter, 30), true)
  assert.equal(normalScooter.dutyState, 'pulling_over')

  // 2) Already-halted or pulled_over actor stays halted with extended stoppedUntil (never driven forward mid-ticket)
  const haltedScooter = makeScooter('s_halted', 8, 'halted')
  const startX = haltedScooter.x
  sim.actors.push(haltedScooter)
  assert.equal(sim.pullOverViolator(haltedScooter, 30), true)
  assert.equal(haltedScooter.dutyState, 'halted')
  assert.ok((haltedScooter.stoppedUntil ?? 0) > sim.time)

  const pulledScooter = makeScooter('s_pulled', 12, 'pulled_over')
  sim.actors.push(pulledScooter)
  assert.equal(sim.pullOverViolator(pulledScooter, 30), true)
  assert.equal(pulledScooter.dutyState, 'pulled_over')
  assert.ok((pulledScooter.stoppedUntil ?? 0) > sim.time)

  // Controller intercept on a moving scooter halts it in place even when onViolatorPulledOver delegates to sim.pullOverViolator
  const rider = makeScooter('s_catch', 16, 'normal')
  const xCatch = rider.x
  sim.actors.push(rider)
  let releasedTerminal
  const ctrl = mod.createTrafficDutyController(
    {
      getPlayerPos: () => ({x: rider.x + 1.0, y: 151.86, z: rider.z}),
      isWalking: () => true,
      trafficBridge: {
        getTraffic: () => sim,
        getActors: () => [rider],
        stopActor: (actor, dur) => sim.stopActor(actor, dur),
        onViolatorPulledOver: (actor, dur) => sim.pullOverViolator(actor, dur),
      },
      fineTerminal: {
        openFineTerminal: async (req) => {
          // Step simulation while terminal is open: rider MUST remain stopped beside officer
          for (let i = 0; i < 40; i++) sim.step(0.05, {x: rider.x, y: 151.86, z: rider.z})
          return {issued: true, fineYuan: req.fineYuan, receiptNo: 'GL-STAY-1'}
        },
      },
    },
    {autoMountUi: false},
  )
  ctrl.startOfficerBriefing()
  ctrl.skipStory()
  const res = await ctrl.interceptViolator()
  assert.equal(res.ok, true)
  assert.ok(Math.hypot(rider.x - xCatch, rider.z - track.start.z) < 0.05, 'caught violator must stay halted during fine terminal print')
  assert.equal(haltedScooter.x, startX)
  ctrl.dispose()

  // 3) Shizijie crossing active duty must allow [F] cite inside Shizijie zone without being rejected by Jiefang bounds
  const sjTp = mod.SHIZIJIE_DUTY_ZONE.teleport
  const sjTarget = makeScooter('s_shizijie', 6, 'halted')
  sjTarget.x = sjTp.x + 1.1
  sjTarget.y = sjTp.y
  sjTarget.z = sjTp.z
  const sjCtrl = mod.createTrafficDutyController(
    {
      getPlayerPos: () => ({x: sjTp.x, y: sjTp.y, z: sjTp.z}),
      isWalking: () => true,
      trafficBridge: {
        getActors: () => [sjTarget],
        stopActor: () => true,
      },
      fineTerminal: {
        openFineTerminal: async (req) => ({issued: true, fineYuan: req.fineYuan, receiptNo: 'GL-SJ-1'}),
      },
    },
    {autoMountUi: false},
  )
  sjCtrl.startOfficerBriefing()
  sjCtrl.skipStory()
  assert.equal(sjCtrl.getInteractCandidate()?.action, 'whistle_cite', 'Shizijie duty [F] must detect nearby violator')
  const sjRes = await sjCtrl.interact()
  assert.equal(sjRes.ok, true)
  assert.equal(sjCtrl.getSnapshot().citedCount, 1)
  sjCtrl.dispose()
})
