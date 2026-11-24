/**
 * Shared keyboard & touch conflict guards across walking, riding, driving, photo mode, map, and UI modals.
 * Ensures:
 *  - Typing in input/textarea/select/contenteditable or open dialogs/title screen never triggers world hotkeys.
 *  - `KeyP` yields cleanly to e-bike P-gear while riding an e-bike (photo remains openable via Shift+P or HUD button,
 *    and `KeyP` always exits photo mode when already open).
 *  - Touch taps inside mobile controls / HUD overlays never leak into canvas camera rotation or pinch zoom.
 */

const TEXT_INPUT_SELECTOR = 'input,textarea,select,[contenteditable]'
const MODAL_OVERLAY_SELECTOR = 'dialog[open],.about-mask:not([hidden]),.atlas.show,.book.show,.shop-overlay.show,.wardrobe-overlay.show,.garage-overlay.show,.mifen-story-dialog:not([hidden]),[data-story-dialog="1"]:not([hidden])'
const TOUCH_UI_SELECTOR = '.walk-ui,.ride-hud,.vehicle-action,.dock,.sky-ui,.render-entry,.hud-me,.shop-overlay,.wardrobe-overlay,.garage-overlay,.mission-hud,.gl-mission-entry,.gl-mission-hud,.mission-board,.st-phone,.st-phone-btn,.mp-roster,.hud-stats,.mifen-story-dialog,.mifen-story-skip,.chat-dock'

export function isShopOverlayOpen(doc: Document = document): boolean {
  return doc.body.dataset.shopOpen === '1' || !!doc.querySelector('.shop-overlay.show,.wardrobe-overlay.show,.garage-overlay.show')
}

export function isStoryDialogueOpen(doc: Document = document): boolean {
  return doc.body.dataset.mifenStoryActive === '1' || !!doc.querySelector('.mifen-story-dialog:not([hidden]),[data-story-dialog="1"]:not([hidden])')
}

export function isTextInputTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false
  return !!(target as Element).closest(TEXT_INPUT_SELECTOR)
}

export function isModalOrOverlayOpen(doc: Document = document): boolean {
  if (doc.body.hasAttribute('data-home')) return true
  if (doc.body.dataset.shopOpen === '1') return true
  if (doc.body.dataset.mifenStoryActive === '1') return true
  return !!doc.querySelector(MODAL_OVERLAY_SELECTOR)
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

export interface PhotoKeyPContext {
  photoActive: boolean
  shiftKey?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  aboard: boolean
  rideKind?: string
  rideCrashed?: boolean
}

/**
 * Resolves the `KeyP` conflict between global Photo Mode and e-bike P-gear park lock:
 *  - When photo mode is already active, `KeyP` always closes it.
 *  - Modifier combos (`Shift+P` / `Alt+P`) still open photo mode even while riding.
 *  - Bare `KeyP` while mounted on an upright e-bike yields to P-gear instead of opening photo mode.
 */
export function shouldPhotoYieldKeyP(ctx: PhotoKeyPContext): boolean {
  if (ctx.photoActive) return false
  if (ctx.shiftKey || ctx.altKey || ctx.ctrlKey || ctx.metaKey) return false
  return ctx.aboard && ctx.rideKind === 'bike' && !ctx.rideCrashed
}

export function shouldPhotoYieldKeyPFromDom(event: KeyboardEvent, photoActive: boolean, doc: Document = document): boolean {
  return shouldPhotoYieldKeyP({
    photoActive,
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
}

/**
 * Returns true when a touch start falls on an interactive HUD control or inside the protected
 * thumb-control gutters (bottom-left joystick / bottom-right action cluster) so canvas drag/pinch ignores it.
 */
export function isTouchInControlZone(ctx: TouchZoneContext): boolean {
  if (ctx.target && typeof (ctx.target as Element).closest === 'function') {
    if ((ctx.target as Element).closest(TOUCH_UI_SELECTOR)) return true
  }
  if (!ctx.panelVisible || ctx.photoOn) return false
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
