import {hits} from '../input/keymap'
import {isGlobalHotkeyBlocked} from '../walk/input-guard'
import {emotes, emotesEnabled} from './emotes'
import './wheel.css'

const icons = [
  'M8 20H4V10h4zm3 0V10l4-7q3 0 1 6h5l-2 11z',
  'M6 20V9q0-2 2 0l2 4V4q1-2 2 0v7l2-8q2-1 2 1l-1 10 3-3q3-1 1 3l-4 6z',
  'M3 9q3-6 7 0m4 0q4-6 7 0M4 13q8 4 16 0-7 16-16 0z',
]
export function emoteWheel(allowed: () => boolean, play: (id: number) => void) {
  const overlay = document.createElement('div'),
    disc = document.createElement('div'),
    toggle = document.createElement('button')
  overlay.className = 'emote-overlay'
  disc.className = 'emote-disc'
  toggle.className = 'emote-toggle'
  toggle.type = 'button'
  toggle.textContent = '表情'
  toggle.hidden = true
  overlay.hidden = true
  overlay.append(disc)
  document.body.append(toggle, overlay)
  const slots = Array.from({length: 8}, (_, i) => {
    const a = (i * Math.PI) / 4,
      button = document.createElement('button'),
      entry = emotes[i]
    button.type = 'button'
    button.className = 'emote-slot'
    button.disabled = !entry
    button.style.left = 50 + 35 * Math.sin(a) + '%'
    button.style.top = 50 - 35 * Math.cos(a) + '%'
    button.setAttribute('aria-label', entry?.label ?? '空位')
    if (entry) button.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + icons[i] + '"/></svg>'
    button.onclick = () => choose(i)
    disc.append(button)
    return button
  })
  const label = document.createElement('span')
  label.className = 'emote-label'
  disc.append(label)
  let selected = -1,
    last = 1,
    timer = 0,
    dx = 0,
    dy = 0
  function select(i: number) {
    selected = i
    slots.forEach((slot, n) => slot.classList.toggle('selected', n === i))
    label.textContent = i < 0 ? '表情' : (emotes[i]?.label ?? '空位')
  }
  function close() {
    clearTimeout(timer)
    timer = 0
    overlay.hidden = true
  }
  function choose(i: number) {
    const entry = emotes[i]
    if (entry && allowed()) {
      last = entry.id
      play(last)
    }
    close()
  }
  function open() {
    if (!allowed() || !emotesEnabled()) return
    overlay.hidden = false
    dx = dy = 0
    select(-1)
  }
  function angle(x: number, y: number) {
    return Math.hypot(x, y) < 18 ? -1 : (Math.round((Math.atan2(x, -y) * 4) / Math.PI) + 8) % 8
  }
  function pointer(event: PointerEvent) {
    const box = disc.getBoundingClientRect()
    if (document.pointerLockElement) {
      dx += event.movementX
      dy += event.movementY
    } else {
      dx = event.clientX - box.left - box.width / 2
      dy = event.clientY - box.top - box.height / 2
    }
    select(angle(dx, dy))
  }
  window.addEventListener('pointermove', (event) => {
    if (!overlay.hidden) pointer(event)
  })
  overlay.onpointerdown = (event) => {
    if (event.target === overlay) {
      close()
      return
    }
    if ((event.target as Element).closest('.emote-slot')) return
    pointer(event)
    choose(selected)
  }
  toggle.onclick = open
  window.addEventListener('keydown', (event) => {
    if (!allowed() || !emotesEnabled() || isGlobalHotkeyBlocked(event.target) || !hits(event.code, 'emote'))
      return
    event.preventDefault()
    if (!timer && !event.repeat) timer = window.setTimeout(open, 200)
  })
  window.addEventListener('keyup', (event) => {
    if (!hits(event.code, 'emote') || !timer) return
    if (!allowed() || isGlobalHotkeyBlocked(event.target) || !emotesEnabled()) {
      close()
      return
    }
    if (overlay.hidden) play(last)
    else choose(selected)
    close()
  })
  window.addEventListener('blur', close)
  return {
    open,
    close,
    get shown() {
      return !overlay.hidden
    },
    get ready() {
      return allowed() && emotesEnabled()
    },
    sync() {
      const visible = allowed() && emotesEnabled()
      if (toggle.hidden === visible) toggle.hidden = !visible
      if (!visible && (timer || !overlay.hidden)) close()
    },
  }
}
