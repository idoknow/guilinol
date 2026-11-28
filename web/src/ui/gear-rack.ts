import {CAMERAS, BODY_IDS, focalLabel, type BodyId, type CameraBody} from '../gear/cameras'
import {prefs, setPrefs} from './prefs'

// 装备面板（IDOK-182）：四台机身的"相机包"。选一台就戴到手上，拍照模式也用这台。
// 从 dock 的「相机」按钮打开，也能被拍照模式里的「换机」拉起。

let mask: HTMLElement | null = null
let onChange: ((id: BodyId) => void) | null = null

const SPEC_ROWS = (body: CameraBody): [string, string][] => [
  ['传感器', body.sensor],
  ['ISO', `${Math.min(...body.iso)}–${Math.max(...body.iso)}`],
  ['快门', `${body.shutter.length} 挡`],
  ['镜头', body.focal.fixed ? `${focalLabel(body.focal.min)} 定焦` : `${focalLabel(body.focal.min)}–${focalLabel(body.focal.max)}`],
  ['数码变焦', `${body.zoomMax}×`],
  ['能力', [body.wide && '超广角', body.macro && '微距', body.level && '水平仪', `录像 ${body.video.presets[0]?.label ?? '—'}`].filter(Boolean).join(' · ')],
]

function build(): HTMLElement {
  const root = document.createElement('div')
  root.className = 'gear-mask'
  root.hidden = true
  root.innerHTML = `<section class="gear-panel" role="dialog" aria-label="相机包">
      <header><h2>相机包</h2><button class="gear-close" aria-label="关闭">×</button></header>
      <div class="gear-list"></div>
    </section>`
  root.addEventListener('click', event => {
    if (event.target === root) closeRack()
  })
  root.querySelector<HTMLButtonElement>('.gear-close')!.onclick = () => closeRack()
  return root
}

function render() {
  if (!mask) return
  const list = mask.querySelector<HTMLElement>('.gear-list')!
  const equipped = prefs().gear.equipped
  list.innerHTML = BODY_IDS.map(id => {
    const body = CAMERAS[id]
    const on = id === equipped
    return `<button class="gear-card${on ? ' on' : ''}" data-body="${id}" aria-pressed="${on}">
        <span class="gear-name">${body.name}</span>
        <span class="gear-tag">${body.tagline}</span>
        <span class="gear-spec">${SPEC_ROWS(body).map(([k, v]) => `<i>${k}</i>${v}`).join('')}</span>
        <span class="gear-badge">${on ? '已装备' : '装备'}</span>
      </button>`
  }).join('')
  list.querySelectorAll<HTMLButtonElement>('[data-body]').forEach(card => {
    card.onclick = () => {
      const id = card.dataset.body as BodyId
      setPrefs(next => ({...next, gear: {...next.gear, equipped: id}}))
      render()
      onChange?.(id)
    }
  })
}

export function openRack(onChangeBody?: (id: BodyId) => void) {
  onChange = onChangeBody ?? null
  mask ??= build()
  if (!mask.isConnected) document.body.append(mask)
  render()
  mask.hidden = false
  mask.classList.remove('in')
  void mask.offsetWidth
  mask.classList.add('in')
  holdWalker(true)
}

export function closeRack() {
  if (!mask || mask.hidden) return
  mask.hidden = true
  holdWalker(false)
}

export function isRackOpen(): boolean {
  return !!mask && !mask.hidden
}

let guard: ((on: boolean) => void) | null = null

/** 让宿主在面板打开时冻住移动（拍照/装备共用）。 */
export function bindRackGuard(fn: (on: boolean) => void) {
  guard = fn
}

function holdWalker(on: boolean) {
  guard?.(on)
}

export function mountRackEntry(host: HTMLElement) {
  if (host.querySelector('.dock-gear')) return
  const entry = document.createElement('button')
  entry.className = 'dock-gear'
  entry.textContent = '相机'
  entry.setAttribute('aria-label', '相机包')
  entry.title = '相机包（换机身）'
  entry.onclick = () => openRack()
  host.append(entry)
}
