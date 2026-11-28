// IDOK-599 管理员报错快捷键 P 单元测试：
// 覆盖管理员身份判定、KeyP 冲突仲裁（输入框 / 模态框 / 拍照模式 / 电驴 P 挡 / 汽车无冲突）、
// 弹窗打开后按 P 切换关闭（含 dialog.fb-panel 冒泡 stopPropagation 穿透与防重开）、
// 普通用户行为零回归，以及 hotkeys.ts 管理员专属提示。
import assert from 'node:assert/strict'
import {rmSync} from 'node:fs'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test, {after} from 'node:test'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'

const bundleDir = await mkdtemp(join(tmpdir(), 'glol-admin-keyp-test-'))
const guardBundle = join(bundleDir, 'input-guard.mjs')
const hotkeysBundle = join(bundleDir, 'hotkeys.mjs')
const accountBundle = join(bundleDir, 'account.mjs')

process.once('exit', () => {
  try {
    rmSync(bundleDir, {recursive: true, force: true})
  } catch {
    // ignore
  }
})

const privateStubPlugin = {
  name: 'stub-private-modules',
  setup(b) {
    b.onResolve(
      {filter: /(?:capture-page|session-mark|session-mark-pass|cheat-capture|fingerprint|combat-config\.json|travel-sites\.json)$/},
      args => ({path: args.path, namespace: 'private-stub'}),
    )
    b.onLoad({filter: /.*/, namespace: 'private-stub'}, () => ({
      contents:
        'export default {}; export const registerPageUI = () => {}; export const updatePageUI = () => {};',
      loader: 'js',
    }))
  },
}

const accountStubPlugin = {
  name: 'stub-account-side-effects',
  setup(b) {
    b.onResolve({filter: /(?:\.\.\/telemetry|\.\/avatar-account|\.\.\/game\/cloud-session)$/}, args => ({
      path: args.path,
      namespace: 'account-stub',
    }))
    b.onLoad({filter: /.*/, namespace: 'account-stub'}, () => ({
      contents:
        'export const record = () => {}; export const prefetchAvatar = () => Promise.resolve(); export const accountCharacter = () => Promise.resolve(false); export const setCloudAccount = () => Promise.resolve();',
      loader: 'js',
    }))
  },
}

await Promise.all([
  build({
    entryPoints: ['web/src/walk/input-guard.ts'],
    outfile: guardBundle,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  }),
  build({
    entryPoints: ['web/src/ui/hotkeys.ts'],
    outfile: hotkeysBundle,
    bundle: true,
    format: 'esm',
    platform: 'node',
    loader: {'.css': 'empty', '.svg': 'empty'},
    plugins: [privateStubPlugin],
    logLevel: 'silent',
  }),
  build({
    entryPoints: ['web/src/ui/account.ts'],
    outfile: accountBundle,
    bundle: true,
    format: 'esm',
    platform: 'node',
    define: {'import.meta.env': '{}'},
    loader: {'.css': 'empty', '.svg': 'empty'},
    plugins: [privateStubPlugin, accountStubPlugin],
    logLevel: 'silent',
  }),
])

after(async () => {
  await rm(bundleDir, {recursive: true, force: true})
})

const guard = await import(pathToFileURL(guardBundle).href)
const hotkeys = await import(pathToFileURL(hotkeysBundle).href)

class FakeClassList {
  #classes
  constructor(names = []) {
    this.#classes = new Set(names)
  }
  add(...names) {
    for (const n of names) if (n) this.#classes.add(n)
  }
  remove(...names) {
    for (const n of names) this.#classes.delete(n)
  }
  contains(name) {
    return this.#classes.has(name)
  }
}

function makeFakeElement({tag = 'DIV', classes = [], attrs = {}, parent = null} = {}) {
  const attrMap = new Map(Object.entries(attrs))
  const classList = new FakeClassList(classes)
  const el = {
    tagName: tag.toUpperCase(),
    classList,
    parentElement: parent,
    open: tag.toUpperCase() === 'DIALOG' && attrMap.has('open'),
    hidden: attrMap.has('hidden'),
    hasAttribute(name) {
      if (name === 'open') return this.open || attrMap.has('open')
      if (name === 'hidden') return this.hidden || attrMap.has('hidden')
      return attrMap.has(name)
    },
    getAttribute(name) {
      return attrMap.get(name) ?? null
    },
    setAttribute(name, value = '') {
      attrMap.set(name, String(value))
      if (name === 'open') this.open = true
      if (name === 'hidden') this.hidden = true
    },
    removeAttribute(name) {
      attrMap.delete(name)
      if (name === 'open') this.open = false
      if (name === 'hidden') this.hidden = false
    },
    matches(selector) {
      return selector.split(',').some(part => matchesSingle(this, part.trim()))
    },
    closest(selector) {
      let cur = this
      while (cur) {
        if (cur.matches(selector)) return cur
        cur = cur.parentElement
      }
      return null
    },
    close() {
      this.open = false
      attrMap.delete('open')
      this.onclose?.()
    },
  }
  return el
}

function matchesSingle(el, sel) {
  if (!sel) return false
  let rest = sel
  // Check :not([hidden])
  if (rest.includes(':not([hidden])')) {
    if (el.hasAttribute('hidden')) return false
    rest = rest.replaceAll(':not([hidden])', '')
  }
  // Extract attribute selectors like [open], [contenteditable], [data-story-dialog="1"]
  const attrRegex = /\[([^\]=]+)(?:="([^"]*)")?\]/g
  let m
  while ((m = attrRegex.exec(rest)) !== null) {
    const [, name, expected] = m
    if (!el.hasAttribute(name)) return false
    if (expected !== undefined && el.getAttribute(name) !== expected) return false
  }
  rest = rest.replace(attrRegex, '')
  // Extract tag and classes
  const parts = rest.split('.').filter(Boolean)
  const hasLeadingTag = rest.length > 0 && !rest.startsWith('.')
  if (hasLeadingTag) {
    const tag = parts.shift()
    if (el.tagName !== tag.toUpperCase()) return false
  }
  for (const cls of parts) {
    if (!el.classList.contains(cls)) return false
  }
  return true
}

function makeFakeDoc({dataset = {}, bodyAttrs = [], elements = [], activeElement = null} = {}) {
  const attrSet = new Set(bodyAttrs)
  const list = [...elements]
  const body = {
    dataset: {...dataset},
    hasAttribute(name) {
      return attrSet.has(name)
    },
    setAttribute(name) {
      attrSet.add(name)
    },
    removeAttribute(name) {
      attrSet.delete(name)
    },
  }
  return {
    body,
    activeElement,
    elements: list,
    addElement(el) {
      list.push(el)
      return el
    },
    removeElement(el) {
      const idx = list.indexOf(el)
      if (idx >= 0) list.splice(idx, 1)
    },
    querySelector(selector) {
      return list.find(el => el.matches(selector)) ?? null
    },
    querySelectorAll(selector) {
      return list.filter(el => el.matches(selector))
    },
  }
}

function makeWindowEventBus() {
  const captureListeners = new Map()
  const bubbleListeners = new Map()
  const add = (map, type, fn) => {
    if (!map.has(type)) map.set(type, [])
    map.get(type).push(fn)
  }
  const remove = (map, type, fn) => {
    const arr = map.get(type)
    if (!arr) return
    const idx = arr.indexOf(fn)
    if (idx >= 0) arr.splice(idx, 1)
  }
  return {
    addEventListener(type, fn, capture = false) {
      add(capture ? captureListeners : bubbleListeners, type, fn)
    },
    removeEventListener(type, fn, capture = false) {
      remove(capture ? captureListeners : bubbleListeners, type, fn)
    },
    /**
     * Dispatches capture(window) -> optional target bubble hook (e.g. dialog.stopPropagation()) -> bubble(window).
     */
    dispatch(type, init = {}, onTargetBubble = null) {
      let defaultPrevented = false
      let stopped = false
      let stoppedImmediate = false
      const event = {
        type,
        code: init.code ?? 'KeyP',
        repeat: !!init.repeat,
        shiftKey: !!init.shiftKey,
        altKey: !!init.altKey,
        ctrlKey: !!init.ctrlKey,
        metaKey: !!init.metaKey,
        target: init.target ?? null,
        get defaultPrevented() {
          return defaultPrevented
        },
        preventDefault() {
          defaultPrevented = true
        },
        stopPropagation() {
          stopped = true
        },
        stopImmediatePropagation() {
          stopped = true
          stoppedImmediate = true
        },
      }
      for (const fn of [...(captureListeners.get(type) ?? [])]) {
        if (stoppedImmediate) break
        fn(event)
      }
      if (!stopped && onTargetBubble) {
        onTargetBubble(event)
      }
      if (!stopped) {
        for (const fn of [...(bubbleListeners.get(type) ?? [])]) {
          if (stoppedImmediate) break
          fn(event)
        }
      }
      return event
    },
  }
}

test('admin bare KeyP opens feedback across walk/fly/ebike/car/bicycle/boat, while respecting Shift+P photo & Ctrl/Cmd+P', () => {
  const base = {
    isAdmin: true,
    photoActive: false,
    feedbackOpen: false,
    textInputTarget: false,
    otherModalOpen: false,
    aboard: false,
  }
  assert.equal(guard.resolveKeyPAction(base), 'admin-feedback-open')
  assert.equal(guard.resolveKeyPAction({...base, aboard: true, rideKind: 'bike', rideCrashed: false}), 'admin-feedback-open')
  assert.equal(guard.resolveKeyPAction({...base, aboard: true, rideKind: 'bike', rideCrashed: true}), 'admin-feedback-open')
  assert.equal(guard.resolveKeyPAction({...base, aboard: true, rideKind: 'car'}), 'admin-feedback-open')
  assert.equal(guard.resolveKeyPAction({...base, aboard: true, rideKind: 'bicycle'}), 'admin-feedback-open')
  assert.equal(guard.resolveKeyPAction({...base, aboard: true, rideKind: 'boat'}), 'admin-feedback-open')

  // Admin can still open photo mode with Shift+P or Alt+P, and exits photo mode with bare P
  assert.equal(guard.resolveKeyPAction({...base, shiftKey: true}), 'photo-open')
  assert.equal(guard.resolveKeyPAction({...base, shiftKey: true, aboard: true, rideKind: 'bike'}), 'photo-open')
  assert.equal(guard.resolveKeyPAction({...base, altKey: true}), 'photo-open')
  assert.equal(guard.resolveKeyPAction({...base, photoActive: true}), 'photo-close')

  // Browser print shortcuts never hijacked
  assert.equal(guard.resolveKeyPAction({...base, ctrlKey: true}), 'ignore')
  assert.equal(guard.resolveKeyPAction({...base, metaKey: true}), 'ignore')

  // Repeat / drone RC / feedback aim / pending capture all ignored
  assert.equal(guard.resolveKeyPAction({...base, repeat: true}), 'ignore')
  assert.equal(guard.resolveKeyPAction({...base, droneActive: true}), 'ignore')
  assert.equal(guard.resolveKeyPAction({...base, feedbackAiming: true}), 'ignore')
  assert.equal(guard.resolveKeyPAction({...base, feedbackPending: true}), 'ignore')
})

test('non-admin KeyP preserves original photo & e-bike P-gear behavior with zero regression', () => {
  const base = {
    isAdmin: false,
    photoActive: false,
    feedbackOpen: false,
    textInputTarget: false,
    otherModalOpen: false,
    aboard: false,
  }
  assert.equal(guard.resolveKeyPAction(base), 'photo-open')
  assert.equal(guard.resolveKeyPAction({...base, aboard: true, rideKind: 'car'}), 'photo-open')
  assert.equal(guard.resolveKeyPAction({...base, aboard: true, rideKind: 'bicycle'}), 'photo-open')
  assert.equal(guard.resolveKeyPAction({...base, aboard: true, rideKind: 'bike', rideCrashed: true}), 'photo-open')

  // Upright e-bike yields bare P to P-gear; Shift+P still opens photo; P exits active photo
  assert.equal(guard.resolveKeyPAction({...base, aboard: true, rideKind: 'bike', rideCrashed: false}), 'ebike-park')
  assert.equal(guard.resolveKeyPAction({...base, shiftKey: true, aboard: true, rideKind: 'bike', rideCrashed: false}), 'photo-open')
  assert.equal(guard.resolveKeyPAction({...base, photoActive: true, aboard: true, rideKind: 'bike', rideCrashed: false}), 'photo-close')

  // Non-admin cannot toggle open feedback dialog via P
  assert.equal(guard.resolveKeyPAction({...base, feedbackOpen: true}), 'ignore')

  // Legacy shouldPhotoYieldKeyP compatibility
  assert.equal(guard.shouldPhotoYieldKeyP({photoActive: false, aboard: true, rideKind: 'bike', rideCrashed: false}), true)
  assert.equal(guard.shouldPhotoYieldKeyP({photoActive: false, isAdmin: true, aboard: false}), true)
  assert.equal(guard.shouldPhotoYieldKeyP({photoActive: true, isAdmin: true, aboard: false}), false)
  assert.equal(guard.shouldPhotoYieldKeyP({photoActive: false, isAdmin: true, shiftKey: true, aboard: false}), false)
})

test('DOM guards block KeyP in text inputs, activeElement inputs, title screen, and other overlays', () => {
  const input = makeFakeElement({tag: 'INPUT'})
  const textarea = makeFakeElement({tag: 'TEXTAREA'})
  const select = makeFakeElement({tag: 'SELECT'})
  const editable = makeFakeElement({tag: 'DIV', attrs: {contenteditable: 'true'}})
  const bodyEl = makeFakeElement({tag: 'BODY'})

  const adminDoc = makeFakeDoc({dataset: {userRole: 'admin'}})
  assert.equal(guard.isAdminUserFromDom(adminDoc), true)
  assert.equal(guard.resolveKeyPActionFromDom({target: input}, {doc: adminDoc}), 'ignore')
  assert.equal(guard.resolveKeyPActionFromDom({target: textarea}, {doc: adminDoc}), 'ignore')
  assert.equal(guard.resolveKeyPActionFromDom({target: select}, {doc: adminDoc}), 'ignore')
  assert.equal(guard.resolveKeyPActionFromDom({target: editable}, {doc: adminDoc}), 'ignore')

  // Even if event.target is body/window while activeElement is an input, KeyP must be blocked
  const activeInputDoc = makeFakeDoc({dataset: {userRole: 'admin'}, activeElement: textarea})
  assert.equal(guard.resolveKeyPActionFromDom({target: bodyEl}, {doc: activeInputDoc}), 'ignore')

  // Title screen (data-home) blocks admin KeyP
  const homeDoc = makeFakeDoc({dataset: {userRole: 'admin'}, bodyAttrs: ['data-home']})
  assert.equal(guard.resolveKeyPActionFromDom({target: bodyEl}, {doc: homeDoc}), 'ignore')

  // Settings / map / book / story / shop / indoor modals block admin KeyP
  for (const overlay of [
    makeFakeElement({tag: 'DIV', classes: ['about-mask']}),
    makeFakeElement({tag: 'DIV', classes: ['atlas', 'show']}),
    makeFakeElement({tag: 'SECTION', classes: ['book', 'show']}),
    makeFakeElement({tag: 'DIV', classes: ['shop-overlay', 'show']}),
    makeFakeElement({tag: 'DIALOG', classes: ['account'], attrs: {open: ''}}),
  ]) {
    const doc = makeFakeDoc({dataset: {userRole: 'admin'}, elements: [overlay]})
    assert.equal(guard.resolveKeyPActionFromDom({target: bodyEl}, {doc}), 'ignore')
  }

  const indoorDoc = makeFakeDoc({dataset: {userRole: 'admin', xxgActive: '1'}})
  assert.equal(guard.resolveKeyPActionFromDom({target: bodyEl}, {doc: indoorDoc}), 'ignore')
})

test('bindKeyPShortcuts opens & toggles closed admin feedback even with dialog bubble stopPropagation, without triggering inside inputs', () => {
  const doc = makeFakeDoc({dataset: {userRole: 'admin'}})
  const bus = makeWindowEventBus()
  const bodyEl = makeFakeElement({tag: 'BODY'})

  let photoActive = false
  let photoOpens = 0
  let photoCloses = 0
  let feedbackOpens = 0
  let feedbackCloses = 0
  let fbDialog = null
  let closeBtn = null
  let descInput = null

  const openFeedback = () => {
    feedbackOpens++
    fbDialog = makeFakeElement({tag: 'DIALOG', classes: ['about-panel', 'fb-panel'], attrs: {open: ''}})
    fbDialog.onclose = () => {
      feedbackCloses++
      doc.removeElement(fbDialog)
      fbDialog = null
    }
    closeBtn = makeFakeElement({tag: 'BUTTON', classes: ['about-close'], parent: fbDialog})
    descInput = makeFakeElement({tag: 'TEXTAREA', parent: fbDialog})
    doc.addElement(fbDialog)
  }

  const unbind = hotkeys.bindKeyPShortcuts({
    isAdmin: () => guard.isAdminUserFromDom(doc),
    isDroneActive: () => false,
    isPhotoActive: () => photoActive,
    openPhoto: () => {
      photoOpens++
      photoActive = true
      doc.body.dataset.photo = 'on'
    },
    closePhoto: () => {
      photoCloses++
      photoActive = false
      delete doc.body.dataset.photo
    },
    openFeedback,
    target: bus,
    doc,
  })

  try {
    // 1. Admin presses bare P in gameplay -> opens feedback dialog
    const e1 = bus.dispatch('keydown', {code: 'KeyP', target: bodyEl})
    assert.equal(e1.defaultPrevented, true)
    assert.equal(feedbackOpens, 1)
    assert.equal(photoOpens, 0)
    assert.equal(guard.isFeedbackPanelOpen(doc), true)

    // 2. Typing P inside feedback textarea -> MUST NOT close dialog or preventDefault
    const eType = bus.dispatch('keydown', {code: 'KeyP', target: descInput}, ev => ev.stopPropagation())
    assert.equal(eType.defaultPrevented, false)
    assert.equal(feedbackCloses, 0)
    assert.equal(guard.isFeedbackPanelOpen(doc), true)

    // 3. While submitting (fb-busy) -> MUST NOT close dialog
    fbDialog.classList.add('fb-busy')
    const eBusy = bus.dispatch('keydown', {code: 'KeyP', target: closeBtn}, ev => ev.stopPropagation())
    assert.equal(eBusy.defaultPrevented, false)
    assert.equal(feedbackCloses, 0)
    fbDialog.classList.remove('fb-busy')

    // 4. Another modal (account dialog) open on top of feedback -> MUST NOT close feedback
    const topModal = doc.addElement(makeFakeElement({tag: 'DIALOG', classes: ['account'], attrs: {open: ''}}))
    const eCovered = bus.dispatch('keydown', {code: 'KeyP', target: closeBtn}, ev => ev.stopPropagation())
    assert.equal(eCovered.defaultPrevented, false)
    assert.equal(feedbackCloses, 0)
    doc.removeElement(topModal)

    // 5. Admin presses bare P on non-input element inside feedback dialog -> closes cleanly
    //    even though dialog stops bubble propagation AND does NOT reopen on the same keydown!
    const eClose = bus.dispatch('keydown', {code: 'KeyP', target: closeBtn}, ev => ev.stopPropagation())
    assert.equal(eClose.defaultPrevented, true)
    assert.equal(feedbackCloses, 1)
    assert.equal(feedbackOpens, 1)
    assert.equal(guard.isFeedbackPanelOpen(doc), false)

    // 6. Re-open and test direct window target dispatch (AT_TARGET phase must not close-then-reopen)
    bus.dispatch('keydown', {code: 'KeyP', target: bodyEl})
    assert.equal(feedbackOpens, 2)
    assert.equal(guard.isFeedbackPanelOpen(doc), true)
    bus.dispatch('keydown', {code: 'KeyP', target: bodyEl})
    assert.equal(feedbackCloses, 2)
    assert.equal(feedbackOpens, 2)
    assert.equal(guard.isFeedbackPanelOpen(doc), false)

    // 7. Admin enters photo mode via Shift+P, then exits photo mode via bare P, then opens feedback via bare P
    bus.dispatch('keydown', {code: 'KeyP', shiftKey: true, target: bodyEl})
    assert.equal(photoOpens, 1)
    assert.equal(photoActive, true)
    assert.equal(feedbackOpens, 2)

    bus.dispatch('keydown', {code: 'KeyP', target: bodyEl})
    assert.equal(photoCloses, 1)
    assert.equal(photoActive, false)
    assert.equal(feedbackOpens, 2)

    bus.dispatch('keydown', {code: 'KeyP', target: bodyEl})
    assert.equal(feedbackOpens, 3)
  } finally {
    unbind()
  }
})

test('admin e-bike KeyP yields P-gear to feedback, while non-admin e-bike KeyP still toggles P-gear', () => {
  const doc = makeFakeDoc({
    dataset: {userRole: 'admin', ride: 'bike'},
    bodyAttrs: ['data-aboard'],
  })
  const bus = makeWindowEventBus()
  const bodyEl = makeFakeElement({tag: 'BODY'})

  let parkToggles = 0
  let feedbackOpens = 0
  let photoOpens = 0

  // Simulate web/src/ui/walk.ts listener registered BEFORE play/index.ts
  bus.addEventListener('keydown', event => {
    if (guard.isGlobalHotkeyBlocked(event.target, {doc})) return
    const aboard = doc.body.hasAttribute('data-aboard')
    const crashed = doc.body.dataset.rideCrash === '1'
    if (
      aboard &&
      !event.repeat &&
      event.code === 'KeyP' &&
      doc.body.dataset.ride === 'bike' &&
      !crashed &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !guard.shouldAdminFeedbackClaimKeyPFromDom(event, doc)
    ) {
      parkToggles++
      event.preventDefault()
    }
  })

  const unbind = hotkeys.bindKeyPShortcuts({
    isAdmin: () => guard.isAdminUserFromDom(doc),
    isDroneActive: () => false,
    isPhotoActive: () => false,
    openPhoto: () => { photoOpens++ },
    closePhoto: () => {},
    openFeedback: () => { feedbackOpens++ },
    target: bus,
    doc,
  })

  try {
    // Admin on e-bike presses bare P -> opens feedback, does NOT trigger e-bike P-gear or photo
    bus.dispatch('keydown', {code: 'KeyP', target: bodyEl})
    assert.equal(feedbackOpens, 1)
    assert.equal(parkToggles, 0)
    assert.equal(photoOpens, 0)

    // Switch to normal user -> bare P toggles e-bike P-gear, does NOT open feedback or photo
    delete doc.body.dataset.userRole
    bus.dispatch('keydown', {code: 'KeyP', target: bodyEl})
    assert.equal(feedbackOpens, 1)
    assert.equal(parkToggles, 1)
    assert.equal(photoOpens, 0)

    // Normal user Shift+P on e-bike -> still opens photo mode
    bus.dispatch('keydown', {code: 'KeyP', shiftKey: true, target: bodyEl})
    assert.equal(feedbackOpens, 1)
    assert.equal(parkToggles, 1)
    assert.equal(photoOpens, 1)

    // Normal user off e-bike -> bare P opens photo mode
    doc.body.removeAttribute('data-aboard')
    bus.dispatch('keydown', {code: 'KeyP', target: bodyEl})
    assert.equal(feedbackOpens, 1)
    assert.equal(parkToggles, 1)
    assert.equal(photoOpens, 2)
  } finally {
    unbind()
  }
})

test('hotkeys.ts exposes admin-only KeyP hints and conflict boundary without changing non-admin hints', () => {
  const adminHint = hotkeys.getKeyPHotkeyHint(true)
  assert.equal(adminHint.feedbackKey, 'P')
  assert.equal(adminHint.photoKey, 'Shift+P')
  assert.deepEqual(adminHint.adminGuideRow?.keys, ['P'])
  assert.ok(adminHint.conflictNote?.includes('Shift+P'))
  assert.ok(adminHint.conflictNote?.includes('0'))
  assert.ok(adminHint.conflictNote?.includes('汽车'))

  const userHint = hotkeys.getKeyPHotkeyHint(false)
  assert.equal(userHint.feedbackKey, undefined)
  assert.equal(userHint.photoKey, 'P')
  assert.equal(userHint.adminGuideRow, undefined)
  assert.equal(userHint.conflictNote, undefined)
})

test('account.ts isAdminUser & dataset.userRole mirror admin role and clear on non-admin/logout', async () => {
  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  const prevLocation = globalThis.location
  const prevFetch = globalThis.fetch
  const prevLocalStorage = globalThis.localStorage
  const prevIdle = globalThis.requestIdleCallback

  const mockBody = {dataset: {}}
  globalThis.document = {body: mockBody}
  globalThis.location = {search: '', href: 'http://127.0.0.1/'}
  globalThis.localStorage = {getItem: () => null, setItem() {}, removeItem() {}}
  globalThis.requestIdleCallback = () => 0
  globalThis.window = {
    addEventListener() {},
    requestIdleCallback: globalThis.requestIdleCallback,
    setTimeout,
    clearTimeout,
  }
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      id: 'u-admin',
      uid: 1,
      email: 'admin@example.com',
      nickname: '管理员',
      role: 'admin',
      notify_email: true,
    }),
  })

  try {
    const account = await import(pathToFileURL(accountBundle).href + '?v=admin')
    assert.equal(account.isAdminUser({role: 'admin'}), true)
    assert.equal(account.isAdminUser({role: 'user'}), false)
    assert.equal(account.isAdminUser({}), false)
    assert.equal(account.isAdminUser(null), false)

    await new Promise(resolve => {
      const unsub = account.onUser(user => {
        if (user) {
          unsub()
          resolve()
        }
      })
    })
    assert.equal(account.isCurrentUserAdmin(), true)
    assert.equal(mockBody.dataset.userRole, 'admin')

    // Non-admin user must clear/omit data-user-role
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        id: 'u-player',
        uid: 2,
        email: 'player@example.com',
        nickname: '普通玩家',
        role: 'user',
        notify_email: false,
      }),
    })
    const accountUser = await import(pathToFileURL(accountBundle).href + '?v=user')
    await new Promise(resolve => {
      const unsub = accountUser.onUser(user => {
        if (user) {
          unsub()
          resolve()
        }
      })
    })
    assert.equal(accountUser.isCurrentUserAdmin(), false)
    assert.equal(mockBody.dataset.userRole, undefined)
    await new Promise(resolve => setImmediate(resolve))
  } finally {
    if (prevWindow === undefined) delete globalThis.window
    else globalThis.window = prevWindow
    if (prevDocument === undefined) delete globalThis.document
    else globalThis.document = prevDocument
    if (prevLocation === undefined) delete globalThis.location
    else globalThis.location = prevLocation
    if (prevFetch === undefined) delete globalThis.fetch
    else globalThis.fetch = prevFetch
    if (prevLocalStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = prevLocalStorage
    if (prevIdle === undefined) delete globalThis.requestIdleCallback
    else globalThis.requestIdleCallback = prevIdle
  }
})
