/**
 * Shared keyboard & touch conflict guards across walking, riding, driving, photo mode, map, and UI modals.
 * Ensures:
 *  - Typing in input/textarea/select/contenteditable or open dialogs/title screen never triggers world hotkeys.
 *  - `KeyP` conflict priority:
 *      1. Text inputs / other modals / drone RC never trigger world `KeyP` actions.
 *      2. When photo mode is already active, `KeyP` always exits photo mode (both admins and players).
 *      3. Signed-in admins pressing bare `KeyP` open/toggle the feedback/bug-report dialog across walking/flying/riding/driving
 *         (admins can still open photo mode via `Shift+P` or the HUD button, and toggle e-bike P-gear via `0` or the HUD button;
 *         sedans do not bind `KeyP` for P-gear so driving has no key conflict).
 *      4. Non-admin players pressing bare `KeyP` while riding an upright e-bike yield to e-bike P-gear
 *         (photo remains openable via `Shift+P` or HUD button); otherwise bare `KeyP` opens photo mode.
 *  - Touch taps inside mobile controls / HUD overlays never leak into canvas camera rotation or pinch zoom.
 */

const TEXT_INPUT_SELECTOR = 'input,textarea,select,[contenteditable]'
const BASE_MODAL_OVERLAY_SELECTOR = 'dialog[open],.about-mask:not([hidden]),.atlas.show,.book.show,.shop-overlay.show,.wardrobe-overlay.show,.garage-overlay.show,.fx-drawer:not([hidden]),.mifen-story-dialog:not([hidden]),[data-story-dialog="1"]:not([hidden]),.td-story-dialog:not([hidden]),.drinks-order-panel:not([hidden])'
const MODAL_OVERLAY_SELECTOR = `${BASE_MODAL_OVERLAY_SELECTOR},.td-fine-terminal:not([hidden])`
const TOUCH_UI_SELECTOR = '.hotbar,.smoke-hint,.walk-ui,.ride-hud,.vehicle-action,.dock,.sky-ui,.render-entry,.hud-me,.shop-overlay,.wardrobe-overlay,.garage-overlay,.fishing-ui,.fx-drawer,.nav-card,.mission-hud,.gl-mission-entry,.gl-mission-hud,.mission-board,.st-phone,.st-phone-btn,.mp-roster,.hud-stats,.mifen-story-dialog,.mifen-story-skip,.chat-dock,.drinks-panel,.drinks-hold-hud,.drinks-pickup-hud,.td-entry,.td-bar,.td-officer-marker,.td-signal-dock,.td-bounds-banner,.td-story-dialog,.td-story-letterbox,.td-fine-terminal,.td-fine-fallback,.td-duty-keys-dock,.td-duty-key-btn,.td-whistle-btn,.td-panel,.knockdown-hud'

export function isShopOverlayOpen(doc: Document = document): boolean {
  return doc.body.dataset.shopOpen === '1' || !!doc.querySelector('.shop-overlay.show,.wardrobe-overlay.show,.garage-overlay.show')
}

export function isStoryDialogueOpen(doc: Document = document): boolean {
  return (
    doc.body.dataset.mifenStoryActive === '1' ||
    doc.body.dataset.tdStoryActive === '1' ||
    !!doc.querySelector('.mifen-story-dialog:not([hidden]),[data-story-dialog="1"]:not([hidden]),.td-story-dialog:not([hidden])')
  )
}

export function isKnockdownActive(doc: Document = document): boolean {
  return doc.body.dataset.tdKnockdown === '1' || !!doc.querySelector('.knockdown-hud:not([hidden])')
}

export function isFineTerminalDelivering(doc: Document = document): boolean {
  return doc.body.dataset.tdTerminalPhase === 'deliver' || doc.body.dataset.tdHandoverDeliver === '1'
}

export function isTextInputTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false
  return !!(target as Element).closest(TEXT_INPUT_SELECTOR)
}

/**
 * 小香港 / 十字街 indoor scenes: the walker is held, but they are not menus. Movement keys and pointer lock carry
 * across the stairwell swap so the street walk resumes mid-stride on the way out.
 */
export function isIndoorSceneActive(doc: Document = document): boolean {
  return doc.body.dataset.xxgActive === '1' || doc.body.dataset.szjActive === '1'
}

function hasBodyModalFlag(doc: Document, options?: {ignoreIndoor?: boolean}): boolean {
  if (doc.body.hasAttribute('data-home')) return true
  if (doc.body.dataset.shopOpen === '1') return true
  if (doc.body.dataset.fishMenu === '1') return true
  if (doc.body.dataset.mifenStoryActive === '1') return true
  if (!options?.ignoreIndoor && isIndoorSceneActive(doc)) return true
  if (doc.body.dataset.tdStoryActive === '1') return true
  if (doc.body.dataset.drinksUiOpen === '1') return true
  const delivering = isFineTerminalDelivering(doc)
  if (doc.body.dataset.tdTerminalOpen === '1' && !delivering) return true
  return false
}

export function isModalOrOverlayOpen(doc: Document = document, options?: {ignoreIndoor?: boolean}): boolean {
  if (hasBodyModalFlag(doc, options)) return true
  return overlayElementPresent(doc, isFineTerminalDelivering(doc))
}

function hasOtherModalOrOverlayOpen(doc: Document, exclude: Element): boolean {
  if (hasBodyModalFlag(doc)) return true
  const selector = isFineTerminalDelivering(doc) ? BASE_MODAL_OVERLAY_SELECTOR : MODAL_OVERLAY_SELECTOR
  if (typeof doc.querySelectorAll === 'function') {
    const nodes = doc.querySelectorAll(selector)
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i] !== exclude) return true
    }
    return false
  }
  const found = doc.querySelector(selector)
  return !!found && found !== exclude
}

// The selector scan walks the whole document, and walking, riding, HUD and interaction code ask
// several times a frame. The answer can only change when the DOM changes, so it is kept until a
// MutationObserver reports a change that could matter. `takeRecords()` is read on every call, which
// makes a change from earlier in the same task visible at once — no frame of stale state.
// Only the live page document is cached; a test double passed as `doc` is scanned every time.
//
// This is only sound while the selectors are built from tags, classes, ids, attributes and `:not()`:
// those change through element or attribute mutations, which the observer sees. A state pseudo-class
// (`:checked`, `:popover-open`, `:focus-within`, `:has()` …) changes without a mutation record and
// would be served stale. `npm run verify:hot-paths` rejects one.
/** The selectors `isModalOrOverlayOpen` scans for: [while the fine terminal is delivering, otherwise]. */
export const MODAL_OVERLAY_SELECTORS: readonly [string, string] = [BASE_MODAL_OVERLAY_SELECTOR, MODAL_OVERLAY_SELECTOR]
type OverlayScan = {doc: Document, observer: MutationObserver, stale: boolean, base: boolean | null, full: boolean | null}
let overlayScan: OverlayScan | null = null
/** Attributes the overlay selectors test, read off the selectors themselves so the two cannot drift apart. */
const OVERLAY_SELECTOR_ATTRIBUTES = [...new Set([
  'class',
  ...(MODAL_OVERLAY_SELECTOR.includes('#') ? ['id'] : []),
  ...Array.from(MODAL_OVERLAY_SELECTOR.matchAll(/\[\s*([\w-]+)/g), match => match[1]),
])]
const ELEMENT_NODE = 1

/**
 * Whether any of these DOM changes could open or close an overlay. Two kinds cannot, and both happen
 * every frame: a HUD label swapping its text node, and a HUD element being handed the value it
 * already has (`button.hidden = true` again), which still queues a record.
 */
function canChangeOverlays(records: readonly MutationRecord[]): boolean {
  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    if (record.type === 'attributes') {
      const name = record.attributeName
      if (!name || (record.target as Element).getAttribute(name) !== record.oldValue) return true
      continue
    }
    if (record.type !== 'childList') return true
    const {addedNodes, removedNodes} = record
    for (let node = 0; node < addedNodes.length; node++) if (addedNodes[node].nodeType === ELEMENT_NODE) return true
    for (let node = 0; node < removedNodes.length; node++) if (removedNodes[node].nodeType === ELEMENT_NODE) return true
  }
  return false
}
let overlayScans = 0

/** How many full-document overlay scans have run; for perf probes and tests. */
export function overlayScanCount(): number {
  return overlayScans
}

function overlayElementPresent(doc: Document, baseOnly: boolean): boolean {
  const selector = baseOnly ? BASE_MODAL_OVERLAY_SELECTOR : MODAL_OVERLAY_SELECTOR
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || doc !== document) {
    overlayScans++
    return !!doc.querySelector(selector)
  }
  if (!overlayScan || overlayScan.doc !== doc) {
    overlayScan?.observer.disconnect()
    const scan: OverlayScan = {doc, observer: new MutationObserver(records => { if (canChangeOverlays(records)) scan.stale = true }), stale: true, base: null, full: null}
    scan.observer.observe(doc, {subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: OVERLAY_SELECTOR_ATTRIBUTES})
    overlayScan = scan
  }
  const scan = overlayScan
  if (canChangeOverlays(scan.observer.takeRecords())) scan.stale = true
  if (scan.stale) {
    scan.stale = false
    scan.base = scan.full = null
  }
  const cached = baseOnly ? scan.base : scan.full
  if (cached !== null) return cached
  overlayScans++
  const present = !!doc.querySelector(selector)
  if (baseOnly) scan.base = present
  else scan.full = present
  return present
}

export function isGlobalHotkeyBlocked(
  target: EventTarget | null,
  options?: {allowPhoto?: boolean; doc?: Document},
): boolean {
  const doc = options?.doc ?? document
  if (isTextInputTarget(target)) return true
  if (isModalOrOverlayOpen(doc)) return true
  if (!options?.allowPhoto && doc.body.dataset.photo === 'on') return true
  return false
}

export function isAdminUserFromDom(doc: Document = document): boolean {
  return doc.body?.dataset?.userRole === 'admin'
}

export function isFeedbackPanelOpen(doc: Document = document): boolean {
  const dialog = doc.querySelector<HTMLDialogElement>('dialog.fb-panel')
  return !!dialog && (dialog.open === true || (typeof dialog.hasAttribute === 'function' && dialog.hasAttribute('open')))
}

export function closeOpenFeedbackDialog(doc: Document = document): boolean {
  const dialog = doc.querySelector<HTMLDialogElement>('dialog.fb-panel[open]')
    ?? (isFeedbackPanelOpen(doc) ? doc.querySelector<HTMLDialogElement>('dialog.fb-panel') : null)
  if (!dialog || dialog.classList?.contains('fb-busy')) return false
  if (dialog.dataset) dialog.dataset.fbClosing = '1'
  if (typeof dialog.close === 'function') dialog.close()
  else dialog.removeAttribute?.('open')
  return true
}

export interface PhotoKeyPContext {
  photoActive: boolean
  isAdmin?: boolean
  shiftKey?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  aboard: boolean
  rideKind?: string
  rideCrashed?: boolean
}

export interface AdminKeyPClaimContext {
  isAdmin: boolean
  photoActive?: boolean
  shiftKey?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
}

/**
 * Whether bare `KeyP` is reserved for the signed-in admin's feedback/bug-report shortcut
 * rather than e-bike P-gear or opening photo mode.
 */
export function shouldAdminFeedbackClaimKeyP(ctx: AdminKeyPClaimContext): boolean {
  if (!ctx.isAdmin || ctx.photoActive) return false
  return !(ctx.shiftKey || ctx.altKey || ctx.ctrlKey || ctx.metaKey)
}

export function shouldAdminFeedbackClaimKeyPFromDom(
  event: Pick<KeyboardEvent, 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>,
  doc: Document = document,
  options?: {isAdmin?: boolean; photoActive?: boolean},
): boolean {
  return shouldAdminFeedbackClaimKeyP({
    isAdmin: options?.isAdmin ?? isAdminUserFromDom(doc),
    photoActive: options?.photoActive ?? doc.body?.dataset?.photo === 'on',
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
  })
}

/**
 * Resolves the `KeyP` conflict between Admin Feedback, global Photo Mode, and e-bike P-gear park lock:
 *  - When photo mode is already active, `KeyP` always closes it.
 *  - Modifier combos (`Shift+P` / `Alt+P`) still open photo mode even for admins or while riding an e-bike.
 *  - Signed-in admins yield bare `KeyP` from photo mode to the admin feedback dialog (across walking/flying/riding/driving).
 *  - Non-admin bare `KeyP` while mounted on an upright e-bike yields to P-gear instead of opening photo mode.
 */
export function shouldPhotoYieldKeyP(ctx: PhotoKeyPContext): boolean {
  if (ctx.photoActive) return false
  if (ctx.shiftKey || ctx.altKey || ctx.ctrlKey || ctx.metaKey) return false
  if (ctx.isAdmin) return true
  return ctx.aboard && ctx.rideKind === 'bike' && !ctx.rideCrashed
}

export function shouldPhotoYieldKeyPFromDom(
  event: KeyboardEvent,
  photoActive: boolean,
  doc: Document = document,
  options?: {isAdmin?: boolean},
): boolean {
  return shouldPhotoYieldKeyP({
    photoActive,
    isAdmin: options?.isAdmin ?? isAdminUserFromDom(doc),
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    aboard: doc.body.hasAttribute('data-aboard'),
    rideKind: doc.body.dataset.ride,
    rideCrashed: doc.body.dataset.rideCrash === '1',
  })
}

export type KeyPAction =
  | 'admin-feedback-open'
  | 'admin-feedback-close'
  | 'photo-open'
  | 'photo-close'
  | 'ebike-park'
  | 'ignore'

export interface KeyPActionContext {
  isAdmin: boolean
  photoActive: boolean
  feedbackOpen: boolean
  feedbackPending?: boolean
  feedbackBusy?: boolean
  feedbackAiming?: boolean
  droneActive?: boolean
  textInputTarget: boolean
  otherModalOpen: boolean
  repeat?: boolean
  shiftKey?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  aboard: boolean
  rideKind?: string
  rideCrashed?: boolean
}

/**
 * Single conflict-resolution arbiter for `event.code === 'KeyP'`:
 *  1. Repeat / text-input focus / drone RC / pending feedback capture -> `'ignore'`.
 *  2. Feedback dialog already open: bare `KeyP` by an admin closes it unless busy or covered by another modal.
 *  3. Any other modal/overlay or browser shortcut (`Ctrl+P` / `Cmd+P`) -> `'ignore'`.
 *  4. Active photo mode -> `'photo-close'` (keeps photo exit intuitive for both admins and normal users).
 *  5. Signed-in admin bare `KeyP` (all non-modal gameplay states, including walking/flying/riding/driving) ->
 *     `'admin-feedback-open'` (or `'ignore'` while `.fb-aim-bar` re-capture aim mode is active).
 *     Admins open photo mode via `Shift+P` / `Alt+P` or the HUD button, and toggle e-bike P-gear via `0` or the HUD button.
 *     Sedans do not bind `KeyP` for P-gear (`Q`/`E` + HUD `P·R·N·D`), so driving has zero overlap.
 *  6. Non-admin players keep the exact legacy behavior (`'ebike-park'` on upright e-bike, else `'photo-open'`).
 */
export function resolveKeyPAction(ctx: KeyPActionContext): KeyPAction {
  if (ctx.repeat || ctx.textInputTarget || ctx.droneActive || ctx.feedbackPending) return 'ignore'
  const hasModifier = !!(ctx.shiftKey || ctx.altKey || ctx.ctrlKey || ctx.metaKey)
  if (ctx.feedbackOpen) {
    if (ctx.isAdmin && !hasModifier && !ctx.otherModalOpen && !ctx.feedbackBusy) {
      return 'admin-feedback-close'
    }
    return 'ignore'
  }
  if (ctx.otherModalOpen || ctx.ctrlKey || ctx.metaKey) return 'ignore'
  if (ctx.photoActive) return 'photo-close'
  if (ctx.isAdmin && !hasModifier) {
    return ctx.feedbackAiming ? 'ignore' : 'admin-feedback-open'
  }
  if (shouldPhotoYieldKeyP({...ctx, isAdmin: false})) return 'ebike-park'
  return 'photo-open'
}

export function resolveKeyPActionFromDom(
  event: Pick<KeyboardEvent, 'target' | 'repeat' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>,
  options?: {photoActive?: boolean; isAdmin?: boolean; droneActive?: boolean; doc?: Document},
): KeyPAction {
  const doc = options?.doc ?? document
  const photoActive = options?.photoActive ?? doc.body?.dataset?.photo === 'on'
  const isAdmin = options?.isAdmin ?? isAdminUserFromDom(doc)
  const textInputTarget = isTextInputTarget(event.target) || isTextInputTarget(doc.activeElement ?? null)
  const fbPanel = doc.querySelector<HTMLDialogElement>('dialog.fb-panel')
  const fbClosing = fbPanel?.dataset?.fbClosing === '1'
  const feedbackOpen = !!fbPanel && !fbClosing && (fbPanel.open === true || (typeof fbPanel.hasAttribute === 'function' && fbPanel.hasAttribute('open')))
  const feedbackPending = !!fbPanel && !feedbackOpen && !fbClosing
  const feedbackBusy = feedbackOpen && !!fbPanel.classList?.contains('fb-busy')
  const feedbackAiming = !fbPanel && !!doc.querySelector('.fb-aim-bar')
  const otherModalOpen = feedbackOpen ? hasOtherModalOrOverlayOpen(doc, fbPanel) : isModalOrOverlayOpen(doc)

  return resolveKeyPAction({
    isAdmin,
    photoActive,
    feedbackOpen,
    feedbackPending,
    feedbackBusy,
    feedbackAiming,
    droneActive: options?.droneActive,
    textInputTarget,
    otherModalOpen,
    repeat: event.repeat,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    aboard: doc.body.hasAttribute('data-aboard'),
    rideKind: doc.body.dataset.ride,
    rideCrashed: doc.body.dataset.rideCrash === '1',
  })
}

/** Bottom-right corner (px from the right/bottom edges) left open for drag-to-look; stays inside the button arc in walk.css. */
const LOOK_CORNER_PORTRAIT = {right: 136, bottom: 148}
const LOOK_CORNER_LANDSCAPE = {right: 120, bottom: 118}

export interface TouchZoneContext {
  clientX: number
  clientY: number
  innerWidth: number
  innerHeight: number
  panelVisible: boolean
  photoOn: boolean
  aboard: boolean
  target?: EventTarget | null
  /**
   * IDOK-256: live rects of the visible thumb controls (stick first). With presets, button size and left-hand mode
   * the cluster moves, so when they are given the guard follows them instead of the fixed right-hand geometry below.
   */
  controls?: {left: number; top: number; right: number; bottom: number; stick?: boolean}[]
}

/** Gutter (px) around a button, and around the stick, that still counts as a near-miss rather than a camera drag. */
const BUTTON_GUTTER = 14
const STICK_GUTTER = 40

/**
 * Returns true when a touch start falls on an interactive HUD control or inside the protected
 * thumb-control gutters (bottom-left joystick / bottom-right action cluster) so canvas drag/pinch ignores it.
 */
export function isTouchInControlZone(ctx: TouchZoneContext): boolean {
  if (ctx.target && typeof (ctx.target as Element).closest === 'function') {
    if ((ctx.target as Element).closest(TOUCH_UI_SELECTOR)) return true
  }
  if (!ctx.panelVisible || ctx.photoOn) return false
  if (ctx.controls?.length) {
    return ctx.controls.some(rect => {
      const pad = rect.stick ? STICK_GUTTER : BUTTON_GUTTER
      return ctx.clientX >= rect.left - pad && ctx.clientX <= rect.right + pad && ctx.clientY >= rect.top - pad && ctx.clientY <= rect.bottom + pad
    })
  }
  // Bottom-left virtual joystick zone
  if (ctx.clientX < ctx.innerWidth * .45 && ctx.clientY > ctx.innerHeight * .55) return true
  // Bottom-right jump/run/view or wheelie/gear/tuck thumb gutter (slot D reaches ~245 px in from the right while riding).
  const rightGuard = ctx.aboard ? 250 : 215
  const bottomGuard = Math.min(280, ctx.innerHeight * .5)
  const fromRight = ctx.innerWidth - ctx.clientX, fromBottom = ctx.innerHeight - ctx.clientY
  if (fromRight < rightGuard && fromBottom < bottomGuard) {
    // IDOK-171: the look stick is gone; the corner it used (inside the 跃/远近/跑/蹲 arc) is free drag-to-look canvas.
    const corner = ctx.innerHeight <= 500 ? LOOK_CORNER_LANDSCAPE : LOOK_CORNER_PORTRAIT
    return !(fromRight < corner.right && fromBottom < corner.bottom)
  }
  return false
}
