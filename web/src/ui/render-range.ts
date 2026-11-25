import './render-range.css'
import {
  RENDER_PRESETS,
  RENDER_RADIUS_MAX,
  RENDER_RADIUS_MIN,
  RENDER_RADIUS_STEP,
  formatPresetLabel,
  presetForRadius,
  snapRenderRadius,
  type RenderConfigSource,
  type RenderRangeConfig,
} from '../render-config'

export interface RenderRangeControlOptions {
  gfx?:Pick<ReturnType<typeof import('../look/gfx-state').gfxState>,'quality'|'select'>
  initial: RenderRangeConfig
  onPreview: (config: RenderRangeConfig) => void
  onCommit: (config: RenderRangeConfig) => RenderRangeConfig
  onReset: () => RenderRangeConfig
  getStats?: (radius: number) => {target: number; loaded: number}
}

export interface RenderRangeHandle {
  entry: HTMLButtonElement
  panel: HTMLElement
  getConfig: () => RenderRangeConfig
  setConfig: (config: RenderRangeConfig) => void
  refreshStats: () => void
  open: () => void
  close: () => void
  dispose: () => void
}

const SOURCE_LABELS: Record<RenderConfigSource, string> = {
  url: 'URL 覆盖',
  storage: '已保存',
  default: '默认',
}

export function renderRangeControl(options: RenderRangeControlOptions): RenderRangeHandle {
  let current: RenderRangeConfig = {...options.initial}

  const entry = document.createElement('button')
  entry.type = 'button'
  entry.className = 'render-entry'
  entry.setAttribute('aria-haspopup', 'dialog')
  entry.setAttribute('aria-expanded', 'false')
  entry.title = '渲染范围设置（实时预览并自动保存）'

  const panel = document.createElement('section')
  panel.className = 'render-pop'
  panel.hidden = true
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', '渲染范围设置')

  const presetButtons = RENDER_PRESETS.map(
    preset => `<button type="button" data-preset="${preset.id}" title="${preset.summary}"><b>${preset.label}</b><span>${preset.radius}m</span></button>`,
  ).join('')

  panel.innerHTML = `
    <div class="render-head">
      <h3>渲染范围</h3>
      <span class="render-badge"></span>
      <button type="button" class="render-close" aria-label="关闭">×</button>
    </div>
    <div class="render-presets" role="group" aria-label="预设档位">${presetButtons}</div>
    <label class="render-slider">
      <span class="render-slider-row">
        <span>自定义半径</span>
        <strong class="render-val"></strong>
      </span>
      <input type="range" min="${RENDER_RADIUS_MIN}" max="${RENDER_RADIUS_MAX}" step="${RENDER_RADIUS_STEP}" />
      <span class="render-ticks"><span>${RENDER_RADIUS_MIN}m</span><span>${Math.round((RENDER_RADIUS_MIN + RENDER_RADIUS_MAX) / 2)}m</span><span>${RENDER_RADIUS_MAX}m</span></span>
    </label>
    <div class="render-foot">
      <span class="render-stats"></span>
      <button type="button" class="render-reset">恢复默认</button>
    </div>
  `

  const badge = panel.querySelector<HTMLElement>('.render-badge')!
  const gfxSelect=document.createElement('select')
  if(options.gfx){
    const label=document.createElement('label');label.textContent='光影画质 '
    for(const [value,text] of [['low','低'],['mid','中'],['high','高']])gfxSelect.add(new Option(text,value))
    gfxSelect.value=options.gfx.quality;gfxSelect.onchange=()=>options.gfx?.select(gfxSelect.value as 'low'|'mid'|'high')
    label.append(gfxSelect);panel.append(label)
  }
  const closeBtn = panel.querySelector<HTMLButtonElement>('.render-close')!
  const presetEls = Array.from(panel.querySelectorAll<HTMLButtonElement>('.render-presets button'))
  const slider = panel.querySelector<HTMLInputElement>('input[type="range"]')!
  const valueEl = panel.querySelector<HTMLElement>('.render-val')!
  const statsEl = panel.querySelector<HTMLElement>('.render-stats')!
  const resetBtn = panel.querySelector<HTMLButtonElement>('.render-reset')!

  function refreshStats() {
    if (panel.hidden) return
    if(options.gfx)gfxSelect.value=options.gfx.quality
    if (options.getStats) {
      const {target, loaded} = options.getStats(current.radius)
      statsEl.textContent = `目标 ${target} 块 · 已载 ${loaded} 块`
    } else {
      const preset = RENDER_PRESETS.find(item => item.id === current.preset)
      statsEl.textContent = preset ? preset.summary : '自定义加载半径'
    }
  }

  function syncUi() {
    const label = formatPresetLabel(current.preset, current.radius)
    entry.textContent = `视野 · ${label}`
    badge.textContent = SOURCE_LABELS[current.source]
    badge.dataset.source = current.source
    valueEl.textContent = current.preset === 'custom' ? `${current.radius} m（自定义）` : `${current.radius} m`
    slider.value = String(current.radius)
    for (const button of presetEls) {
      const on = button.dataset.preset === current.preset
      button.classList.toggle('on', on)
      button.setAttribute('aria-pressed', String(on))
    }
    refreshStats()
  }

  function open() {
    panel.hidden = false
    entry.setAttribute('aria-expanded', 'true')
    refreshStats()
  }

  function close() {
    panel.hidden = true
    entry.setAttribute('aria-expanded', 'false')
  }

  entry.onclick = () => (panel.hidden ? open() : close())
  closeBtn.onclick = close

  for (const button of presetEls) {
    button.onclick = () => {
      const preset = RENDER_PRESETS.find(item => item.id === button.dataset.preset)
      if (!preset) return
      current = options.onCommit({preset: preset.id, radius: preset.radius, source: 'storage'})
      syncUi()
    }
  }

  slider.addEventListener('input', () => {
    const radius = snapRenderRadius(Number(slider.value))
    current = {preset: presetForRadius(radius), radius, source: current.source}
    options.onPreview(current)
    syncUi()
  })

  slider.addEventListener('change', () => {
    const radius = snapRenderRadius(Number(slider.value))
    current = options.onCommit({preset: presetForRadius(radius), radius, source: 'storage'})
    syncUi()
  })

  resetBtn.onclick = () => {
    current = options.onReset()
    syncUi()
  }

  const stopBubble = (event: Event) => event.stopPropagation()
  for (const type of ['pointerdown', 'mousedown', 'touchstart', 'wheel']) {
    panel.addEventListener(type, stopBubble)
    entry.addEventListener(type, stopBubble)
  }

  const onPanelKey = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.code === 'Escape' && !panel.hidden) close()
  }
  panel.addEventListener('keydown', onPanelKey)
  panel.addEventListener('keyup', stopBubble)

  const onWindowKey = (event: KeyboardEvent) => {
    if (event.code === 'Escape' && !panel.hidden) close()
  }
  const onOutsidePointer = (event: PointerEvent) => {
    if (panel.hidden) return
    const target = event.target as Node | null
    if (target && (panel.contains(target) || entry.contains(target))) return
    close()
  }
  window.addEventListener('keydown', onWindowKey)
  document.addEventListener('pointerdown', onOutsidePointer)

  document.body.append(entry, panel)
  syncUi()

  return {
    entry,
    panel,
    getConfig: () => ({...current}),
    setConfig: (config: RenderRangeConfig) => {
      current = {...config}
      syncUi()
    },
    refreshStats,
    open,
    close,
    dispose: () => {
      window.removeEventListener('keydown', onWindowKey)
      document.removeEventListener('pointerdown', onOutsidePointer)
      entry.remove()
      panel.remove()
    },
  }
}
