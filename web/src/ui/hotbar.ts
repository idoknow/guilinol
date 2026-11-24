import './hotbar.css'
import {camera} from '../gear/cameras'
import {onPrefs, prefs} from './prefs'

// 物品栏（IDOK-238）：徒步时屏幕底部居中的两格——空手 / 相机。
// 默认空手；按 1 / 2 或点格子切换。只有选中「相机」时手上才拿机身、右臂才抬到胸前。
// 每次进游戏都从空手开始，不记忆。

export type HotbarSlot = 'hand' | 'camera'

let slot: HotbarSlot = 'hand'
let bar: HTMLElement | null = null

/** street-hud 在徒步时写 data-ride=foot，骑车 / 开车 / 坐船时写交通工具种类。 */
export function riding() {
  const ride = document.body.dataset.ride
  return !!ride && ride !== 'foot'
}

export function hotbarSlot(): HotbarSlot {
  return slot
}

export function selectSlot(next: HotbarSlot) {
  slot = next
  if (!bar) return
  for (const button of Array.from(bar.querySelectorAll<HTMLButtonElement>('.hotbar-slot'))) {
    const on = button.dataset.slot === slot
    button.classList.toggle('on', on)
    button.setAttribute('aria-pressed', String(on))
  }
}

/** 每帧调用：只在徒步、且没有被拍照 / 相机包 / 骑行等界面占用时显示。 */
export function showHotbar(on: boolean) {
  if (!bar) return
  if (bar.hidden === !on) return
  bar.hidden = !on
  if (on) document.body.dataset.hotbar = 'on'
  else delete document.body.dataset.hotbar
}

const HAND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12.5V6.2a1.3 1.3 0 0 1 2.6 0v5.3M10.6 11V4.8a1.3 1.3 0 0 1 2.6 0V11m0-.4V5.6a1.3 1.3 0 0 1 2.6 0v6.2m0-3.4a1.3 1.3 0 0 1 2.6 0v5.4c0 4-2.6 6.7-6.3 6.7-2.6 0-4-1.1-5.5-3.3l-2.3-3.4a1.4 1.4 0 0 1 2.2-1.7L8 14.3"/></svg>'
const CAMERA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.2h3.2l1.6-2.2h6.4l1.6 2.2H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.2a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.4" r="3.4"/></svg>'

export function mountHotbar() {
  if (bar) return
  bar = document.createElement('nav')
  bar.className = 'hotbar'
  bar.hidden = true
  bar.setAttribute('aria-label', '物品栏')
  bar.innerHTML = `
    <button type="button" class="hotbar-slot" data-slot="hand" title="空手（1）" aria-label="空手（1）">
      <kbd>1</kbd>${HAND_ICON}<span>空手</span>
    </button>
    <button type="button" class="hotbar-slot" data-slot="camera" title="相机（2）" aria-label="相机（2）">
      <kbd>2</kbd>${CAMERA_ICON}<span>相机</span>
    </button>`
  for (const button of Array.from(bar.querySelectorAll<HTMLButtonElement>('.hotbar-slot'))) {
    // 不抢焦点：点完格子 WASD 还能继续走。
    button.addEventListener('pointerdown', event => event.preventDefault())
    button.addEventListener('click', () => selectSlot(button.dataset.slot as HotbarSlot))
  }
  window.addEventListener('keydown', event => {
    if (!bar || bar.hidden || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
    if (riding()) return // 骑行时 1–4 是档位
    const target = event.target as HTMLElement | null
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
    if (event.code === 'Digit1') selectSlot('hand')
    else if (event.code === 'Digit2') selectSlot('camera')
  })
  const label = () => {
    const name = camera(prefs().gear.equipped)?.name
    const camButton = bar?.querySelector<HTMLButtonElement>('[data-slot=camera]')
    if (camButton) camButton.title = name ? `相机 · ${name}（2）` : '相机（2）'
  }
  label()
  onPrefs(label)
  document.body.append(bar)
  selectSlot(slot)
}
