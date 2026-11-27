import './meter.css'
import {formatSmokeCount, isLowSmokeBurn} from './data'
import type {SmokeView} from './session'

export interface SmokeMeterHandle {
  sync(view: SmokeView, packCount: number, allowed: boolean): void
  hide(): void
  dispose(): void
}

/** 持烟燃烧进度条与剩余根数面板：仅在手里有烟时挂载到 DOM，未持烟时不渲染。 */
export function createSmokeMeter(): SmokeMeterHandle {
  const root = document.createElement('div')
  root.className = 'smoke-meter'
  root.setAttribute('role', 'status')
  root.setAttribute('aria-live', 'off')

  const track = document.createElement('div')
  track.className = 'smoke-meter-track'
  const fill = document.createElement('i')
  fill.className = 'smoke-meter-fill'
  track.append(fill)

  const text = document.createElement('span')
  text.className = 'smoke-meter-text'
  root.append(track, text)

  let lastPct = ''
  let lastLabel = ''
  let lastLow = false

  function hide() {
    if (root.isConnected) root.remove()
    delete document.body.dataset.smokeMeter
  }

  function sync(view: SmokeView, packCount: number, allowed: boolean) {
    if (!allowed || view.cig <= 0) {
      hide()
      return
    }
    if (!root.isConnected) {
      document.body.append(root)
      document.body.dataset.smokeMeter = 'on'
    }
    const pct = `${(Math.max(0, Math.min(1, view.length)) * 100).toFixed(2)}%`
    if (pct !== lastPct) {
      fill.style.width = pct
      lastPct = pct
    }
    const low = isLowSmokeBurn(view.length)
    if (low !== lastLow) {
      root.classList.toggle('is-low', low)
      lastLow = low
    }
    const label = formatSmokeCount(view.remaining, packCount, 'hud')
    if (label !== lastLabel) {
      text.textContent = label
      lastLabel = label
    }
  }

  return {
    sync,
    hide,
    dispose: hide,
  }
}
