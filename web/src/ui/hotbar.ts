import {smokeEnabled} from '../citizen/use-item'
import {getActiveSaveSnapshot} from '../game/save'
import './hotbar.css'
import {camera} from '../gear/cameras'
import {onPrefs, prefs} from './prefs'

// 物品栏（IDOK-238）：徒步时屏幕底部居中的两格——空手 / 相机。
// 默认空手；按 1 / 2 或点格子切换。只有选中「相机」时手上才拿机身、右臂才抬到胸前。
// 每次进游戏都从空手开始，不记忆。

export type HotbarSlot = 'hand' | 'camera' | 'smoke' | 'fishing'

let slot: HotbarSlot = 'hand'
let bar: HTMLElement | null = null
let fishingButton:HTMLButtonElement|null=null
export function showFishingSlot(near:boolean){if(fishingButton&&fishingButton.hidden===near)fishingButton.hidden=!near}

/** street-hud 在徒步时写 data-ride=foot，骑车 / 开车 / 坐船时写交通工具种类。 */
export function riding() {
  const ride = document.body.dataset.ride
  return !!ride && ride !== 'foot'
}

export function hotbarSlot(): HotbarSlot {
  return slot
}

export function selectSlot(next: HotbarSlot) {
  if (slot === 'fishing' && next !== slot) window.dispatchEvent(new Event('fishing:cancel'))
  if (slot === 'smoke' && next !== slot) window.dispatchEvent(new Event('smoke:cancel'))
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
  if (!on && slot === 'fishing') selectSlot('hand')
  if (!bar) return
  if (bar.hidden === !on) return
  bar.hidden = !on
  if (on) document.body.dataset.hotbar = 'on'
  else delete document.body.dataset.hotbar
}

// IDOK-542: every slot's picture is a 刻线小像 drawn in CSS (hotbar.css .hotbar-slot::before, ico-*.svg masks picked by
// data-slot / data-shop / data-act): 空手 ico-hand、相机 ico-camera、香烟 ico-smoke、香烟铺 ico-shop、鱼竿 ico-rod、遥控器 ico-remote.
// No inline SVG here; the <span> name stays for the selected slot and for 「丢弃」.
export function mountHotbar() {
  if (bar) return
  bar = document.createElement('nav')
  bar.className = 'hotbar'
  bar.hidden = true
  bar.setAttribute('aria-label', '物品栏')
  bar.innerHTML = `
    <button type="button" class="hotbar-slot" data-slot="hand" title="空手（1）" aria-label="空手（1）">
      <kbd>1</kbd><span>空手</span>
    </button>
    <button type="button" class="hotbar-slot" data-slot="camera" title="相机（2）" aria-label="相机（2）">
      <kbd>2</kbd><span>相机</span>
    </button>`
  if (smokeEnabled()) {
    bar.insertAdjacentHTML('beforeend', `<button type="button" class="hotbar-slot" data-slot="smoke" title="香烟（3）" aria-label="香烟（3）"><kbd>3</kbd><b class="pack-count"></b><span>香烟</span></button><button type="button" class="hotbar-slot hotbar-shop" data-shop="smoke" title="香烟铺" aria-label="香烟铺"><span>香烟铺</span></button>`)
    const count = bar.querySelector('.pack-count')!
    const refresh = () => {
      const n = getActiveSaveSnapshot().packs.length
      count.textContent = String(n)
      count.classList.toggle('empty', n === 0)
    }
    refresh()
    window.addEventListener('glol:save-written',refresh)
    bar.querySelector('[data-shop]')!.addEventListener('click',()=>window.dispatchEvent(new Event('smoke:shop')))
  }
  bar.insertAdjacentHTML('beforeend',`<button hidden type="button" class="hotbar-slot hotbar-rod" data-slot="fishing" title="鱼竿（4）" aria-label="鱼竿（4）"><kbd>4</kbd><span>鱼竿</span></button>`)
  // IDOK-526: 无人机遥控器 —— 只有场上停着一台无人机时才出现，点它直接进遥控画面。
  bar.insertAdjacentHTML('beforeend',`<button hidden type="button" class="hotbar-slot hotbar-drone" data-act="drone" title="无人机遥控器（5）" aria-label="无人机遥控器（5）"><kbd>5</kbd><span>遥控器</span></button>`)
  const droneButton = bar.querySelector<HTMLButtonElement>('.hotbar-drone')!
  fishingButton=bar.querySelector('[data-slot=fishing]')
  for (const button of Array.from(bar.querySelectorAll<HTMLButtonElement>('.hotbar-slot'))) {
    button.addEventListener('pointerdown', event => event.preventDefault())
    if (button.dataset.slot) button.addEventListener('click', () => {
      if (button.dataset.slot === 'smoke') window.dispatchEvent(new Event('smoke:slot'))
      else if(button.dataset.slot==='fishing')window.dispatchEvent(new Event('fishing:slot'))
      else selectSlot(button.dataset.slot as HotbarSlot)
    })
  }
  window.addEventListener('keydown', event => {
    if (!bar || bar.hidden || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
    if (riding()) return // 骑行时 1–4 是档位
    const target = event.target as HTMLElement | null
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
    if (document.body.dataset.shopOpen) return
    if (event.code === 'Digit3' && smokeEnabled()) window.dispatchEvent(new Event('smoke:slot'))
    else if (event.code === 'Digit1') selectSlot('hand')
    else if (event.code === 'Digit2') selectSlot('camera')
    else if (event.code === 'Digit4') window.dispatchEvent(new Event('fishing:slot'))
    else if (event.code === 'Digit5' && droneButton && !droneButton.hidden) window.dispatchEvent(new Event('drone:rc'))
  })
  // 遥控器格子的显隐由无人机模式在放置 / 收回 / 进出遥控时广播。
  const syncDrone = (info?:{placed?:boolean; rc?:boolean}) => {
    if (!droneButton) return
    const placed = info ? !!info.placed : droneButton.dataset.placed === '1'
    droneButton.hidden = !placed
    droneButton.dataset.placed = String(placed)
    const rc = !!info?.rc
    droneButton.classList.toggle('on', rc)
    droneButton.title = rc ? '遥控中（5）' : '无人机遥控器（5）'
    droneButton.setAttribute('aria-pressed', String(rc))
    if (rc) selectSlot('hand')
  }
  window.addEventListener('drone:slot', event => syncDrone((event as CustomEvent<{placed:boolean; rc:boolean}>).detail))
  droneButton.addEventListener('pointerdown', event => event.preventDefault())
  droneButton.addEventListener('click', () => window.dispatchEvent(new Event('drone:rc')))
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

export function showSmokeDiscard(on:boolean){
  const button=bar?.querySelector<HTMLButtonElement>('[data-slot=smoke]')
  if(!button || button.dataset.discard===String(on))return
  button.dataset.discard=String(on)
  button.setAttribute('aria-label',on?'丢弃香烟':'香烟')
  button.querySelector('span')!.textContent=on?'丢弃':'香烟'
}
