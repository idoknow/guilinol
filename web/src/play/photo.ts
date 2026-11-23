import * as THREE from 'three'
import type {Host} from './host'
import {label, type Weather} from '../look/time'
import {camera, focalLabel, focalToFov, isoLabel, nearest, shutterLabel, type BodyId, type CameraBody} from '../gear/cameras'
import {drawGrid, encode, extensionFor, grade, rawSidecar, stamp, type GridMode, type ShotFormat, type ShotSettings} from '../gear/capture'
import {canRecord, saveRecording, startRecording, type Recording} from '../gear/video'
import {prefs} from '../ui/prefs'
import {openRack} from '../ui/gear-rack'
import {refreshCamera, setCameraShown} from '../gear/hand'

// 拍照模式（IDOK-182 起接了相机系统）：
//   机身来自相机包（gear-rack），参数按机型给：曝光 / ISO / 快门 / 光圈 / 焦距 / 数码变焦 /
//   白平衡 / 广角 / 微距 / 水平仪 / 构图线 / 输出格式 / RAW；出片走 gear/capture 的统一管线。
//   滤镜仍是 CSS filter 字符串 —— 预览（canvas 的 style.filter）和成片（ctx.filter）用同一段。
const filters: [string, string][] = [
  ['原片', 'none'],
  ['青绿', 'saturate(1.18) hue-rotate(-8deg) contrast(1.04)'],
  ['胶片', 'sepia(.2) contrast(1.08) saturate(.88) brightness(1.03)'],
  ['暮金', 'sepia(.32) saturate(1.3) hue-rotate(-12deg) brightness(1.02)'],
  ['水墨', 'grayscale(1) sepia(.12) contrast(1.18) brightness(1.06)'],
]
const skies: [string, Weather][] = [['晴', 'clear'], ['雾', 'mist'], ['雨', 'rain']]

const GRIDS: [string, GridMode][] = [['关', 'none'], ['三分', 'thirds'], ['黄金', 'golden'], ['中心', 'center'], ['网格', 'grid']]

type ToggleKey = 'figure' | 'sign' | 'macro' | 'wide' | 'level' | 'raw'

interface ShotState {
  filter: number
  figure: boolean
  sign: boolean
  body: BodyId
  ev: number
  iso: number
  shutter: number
  aperture: number | null
  focal: number
  zoom: number
  wb: number
  grid: GridMode
  format: ShotFormat
  toggle: Record<ToggleKey, boolean>
}

export function photoMode(host: Host, place: () => string, onCapture?: () => void) {
  const bar = document.createElement('section')
  bar.className = 'photo-bar'
  bar.hidden = true
  const exit = document.createElement('button')
  exit.className = 'photo-exit'
  exit.setAttribute('aria-label', '退出拍照')
  exit.textContent = '×'
  exit.hidden = true
  bar.innerHTML = `<div class="photo-row"><label class="photo-hour"><span></span><input type="range" min="0" max="23.9" step=".1" aria-label="时辰"></label>
      <span class="chips" data-group="sky">${skies.map(([t, v]) => `<button data-v="${v}">${t}</button>`).join('')}</span></div>
    <div class="photo-row"><span class="chips" data-group="filter">${filters.map(([t], i) => `<button data-v="${i}">${t}</button>`).join('')}</span>
      <span class="chips" data-group="opts"><button data-v="figure">人物</button><button data-v="sign">落款</button><button data-v="sheet">参数</button></span></div>
    <div class="photo-actions"><button class="photo-rec" aria-label="录像"><i></i></button><button class="photo-shutter" aria-label="按快门"><i></i></button></div>`

  const sheet = document.createElement('aside')
  sheet.className = 'cam-sheet'
  sheet.hidden = true

  const guides = document.createElement('div')
  guides.className = 'cam-guides'
  guides.hidden = true
  guides.innerHTML = `<div class="cg-grid"></div><div class="cg-level"><i></i><b></b></div><div class="cg-readout"></div><div class="cg-rec" hidden><i></i><span>00:00</span></div>`

  const flash = document.createElement('div')
  flash.className = 'photo-flash'
  const shot = document.createElement('figure')
  shot.className = 'photo-shot'
  shot.hidden = true
  document.body.append(bar, exit, sheet, guides, flash, shot)

  const hour = bar.querySelector<HTMLInputElement>('input')!
  const hourText = bar.querySelector<HTMLElement>('.photo-hour span')!
  const gridLayer = guides.querySelector<HTMLElement>('.cg-grid')!
  const levelLayer = guides.querySelector<HTMLElement>('.cg-level')!
  const readout = guides.querySelector<HTMLElement>('.cg-readout')!
  const recBadge = guides.querySelector<HTMLElement>('.cg-rec')!
  const recText = recBadge.querySelector('span')!

  const state: ShotState = {
    filter: 0,
    figure: true,
    sign: true,
    body: prefs().gear.equipped,
    ev: 0,
    iso: 0,
    shutter: 0,
    aperture: null,
    focal: 0,
    zoom: 1,
    wb: 5500,
    grid: 'thirds',
    format: 'jpeg',
    toggle: {figure: true, sign: true, macro: false, wide: false, level: true, raw: true},
  }

  let active = false
  let saved = {fov: 55, flowing: true}
  let recording: Recording | null = null
  let shotUrl = ''

  const body = (): CameraBody => camera(state.body)

  function resetForBody(next: BodyId) {
    const b = camera(next)
    state.body = next
    state.ev = 0
    state.iso = 0
    state.shutter = b.shutter.findIndex(value => value <= 1 / 100) >= 0 ? b.shutter.findIndex(value => value <= 1 / 100) : Math.floor(b.shutter.length / 2)
    state.aperture = b.aperture.length ? Math.min(2, b.aperture.length - 1) : null
    state.focal = 0
    state.zoom = 1
    state.wb = Math.round((b.wb.min + b.wb.max) / 200) * 100
    state.format = b.formats[0]
    state.toggle.raw = b.raw
    state.toggle.wide = false
    state.toggle.macro = false
    state.toggle.level = b.level
    if (!b.level) state.toggle.level = false
  }

  const isoValue = () => body().iso[Math.min(state.iso, body().iso.length - 1)]
  const shutterValue = () => body().shutter[Math.min(state.shutter, body().shutter.length - 1)]
  const apertureValue = () => (state.aperture === null ? null : body().aperture[Math.min(state.aperture, body().aperture.length - 1)])
  const focalValue = () => {
    const f = body().focal
    if (f.fixed) return f.min
    return Math.round((f.min + state.focal * f.step) * 10) / 10
  }

  function settings(zoom: number): ShotSettings {
    return {
      exposure: state.ev,
      iso: isoValue(),
      shutter: shutterValue(),
      wb: state.wb,
      zoom,
      macro: state.toggle.macro,
      grid: state.grid,
      format: state.format,
      raw: state.toggle.raw && body().raw,
      level: state.toggle.level,
    }
  }

  // ---- 取景预览：FOV、CSS 滤镜、辅助线 -------------------------------------------------
  function previewFilter(): string {
    const parts: string[] = []
    const look = filters[state.filter][1]
    if (look !== 'none') parts.push(look)
    if (state.ev !== 0) parts.push(`brightness(${Math.pow(2, state.ev).toFixed(3)})`)
    // 白平衡近似：暖了加 sepia、冷了转蓝，只是预览提示，成片才是精确增益。
    const wbShift = (state.wb - 5500) / 5500
    if (Math.abs(wbShift) > 0.02) parts.push(wbShift > 0 ? `sepia(${Math.min(0.35, wbShift * 0.5).toFixed(3)})` : `hue-rotate(${Math.round(wbShift * 16)}deg)`)
    if (state.toggle.macro) parts.push('contrast(1.04) saturate(1.05)')
    if (state.toggle.wide) parts.push('saturate(1.06)')
    return parts.join(' ')
  }

  function applyView() {
    const b = body()
    const fov = focalToFov(focalValue()) / Math.max(1, state.zoom)
    host.camera.fov = Math.min(110, Math.max(4, fov))
    host.camera.updateProjectionMatrix()
    host.renderer.domElement.style.filter = previewFilter()
  }

  function applyGuides() {
    if (!active) {
      guides.hidden = true
      return
    }
    guides.hidden = false
    gridLayer.className = `cg-grid grid-${state.grid}`
    levelLayer.hidden = !state.toggle.level
  }

  // ---- 参数表 -----------------------------------------------------------------------
  function slider(row: string, caption: string, min: number, max: number, step: number, value: number, text: string, input: (v: number) => void, disabled = false) {
    return `<label class="cs-row" data-row="${row}"><span class="cs-name">${caption}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${caption}"${disabled ? ' disabled' : ''}>
      <b class="cs-val">${text}</b></label>`
  }

  function buildSheet() {
    const b = body()
    const rows: string[] = []
    rows.push(`<header class="cs-head"><div><b>${b.name}</b><i>${b.sensor} · ${b.tagline}</i></div><button class="cs-rack">换机</button></header>`)
    rows.push(slider('ev', '曝光', b.ev.min, b.ev.max, b.ev.step, state.ev, `${state.ev > 0 ? '+' : ''}${state.ev.toFixed(1)}EV`, v => {
      state.ev = Math.round(v / b.ev.step) * b.ev.step
      applyView()
      syncSheetValues()
    }))
    rows.push(slider('iso', 'ISO', 0, b.iso.length - 1, 1, state.iso, isoLabel(isoValue()), v => {
      state.iso = Math.round(v)
      syncSheetValues()
    }))
    rows.push(slider('shutter', '快门', 0, b.shutter.length - 1, 1, state.shutter, shutterLabel(shutterValue()), v => {
      state.shutter = Math.round(v)
      syncSheetValues()
    }))
    if (b.aperture.length) {
      rows.push(slider('aperture', '光圈', 0, b.aperture.length - 1, 1, state.aperture ?? 0, `f/${apertureValue()}`, v => {
        state.aperture = Math.round(v)
        syncSheetValues()
      }))
    }
    const f = b.focal
    const focalSteps = f.fixed ? 0 : Math.round((f.max - f.min) / f.step)
    rows.push(slider('focal', '焦距', 0, Math.max(focalSteps, 1), 1, state.focal, focalLabel(focalValue()), v => {
      state.focal = Math.round(v)
      applyView()
      syncSheetValues()
    }, f.fixed))
    rows.push(slider('zoom', '放大', 1, b.zoomMax, 0.1, state.zoom, `${state.zoom.toFixed(1)}×`, v => {
      state.zoom = Math.round(v * 10) / 10
      applyView()
      syncSheetValues()
    }))
    rows.push(slider('wb', '白平衡', b.wb.min, b.wb.max, b.wb.step, state.wb, `${state.wb}K`, v => {
      state.wb = Math.round(v)
      applyView()
      syncSheetValues()
    }))
    const toggles: [ToggleKey, string, boolean][] = [
      ['wide', '广角', b.wide],
      ['macro', '微距', b.macro],
      ['level', '水平仪', b.level],
      ['raw', 'RAW', b.raw],
      ['figure', '人物', true],
      ['sign', '落款', true],
    ]
    rows.push(`<div class="cs-toggles">${toggles
      .filter(([, , supported]) => supported)
      .map(([key, text]) => `<button data-toggle="${key}" class="${state.toggle[key] ? 'on' : ''}">${text}</button>`)
      .join('')}</div>`)
    rows.push(`<div class="cs-grids"><span class="cs-name">构图线</span>${GRIDS.map(([text, value]) => `<button data-grid="${value}" class="${state.grid === value ? 'on' : ''}">${text}</button>`).join('')}</div>`)
    rows.push(`<div class="cs-grids"><span class="cs-name">格式</span>${b.formats.map(value => `<button data-format="${value}" class="${state.format === value ? 'on' : ''}">${value.toUpperCase()}</button>`).join('')}</div>`)
    rows.push(`<div class="cs-foot"><span>${b.video.label} · ${canRecord(host.renderer.domElement) ? '可录像' : '当前浏览器不支持录像'}</span></div>`)
    sheet.innerHTML = rows.join('')

    sheet.querySelector<HTMLButtonElement>('.cs-rack')!.onclick = () => {
      openRack(id => {
        resetForBody(id)
        buildSheet()
        applyView()
        refreshCamera(host.walker())
      })
    }
    for (const input of Array.from(sheet.querySelectorAll<HTMLInputElement>('input[type=range]'))) {
      const row = input.closest<HTMLElement>('.cs-row')!.dataset.row!
      const handler = handlers[row]
      input.oninput = () => handler(+input.value)
    }
    for (const button of Array.from(sheet.querySelectorAll<HTMLButtonElement>('[data-toggle]'))) {
      button.onclick = () => {
        const key = button.dataset.toggle as ToggleKey
        state.toggle[key] = !state.toggle[key]
        button.classList.toggle('on', state.toggle[key])
        if (key === 'figure') host.walker()?.showFigure(state.toggle.figure)
        if (key === 'macro' || key === 'wide') applyView()
        if (key === 'level') applyGuides()
      }
    }
    for (const button of Array.from(sheet.querySelectorAll<HTMLButtonElement>('[data-grid]'))) {
      button.onclick = () => {
        state.grid = button.dataset.grid as GridMode
        for (const other of Array.from(sheet.querySelectorAll<HTMLButtonElement>('[data-grid]'))) other.classList.toggle('on', other === button)
        applyGuides()
      }
    }
    for (const button of Array.from(sheet.querySelectorAll<HTMLButtonElement>('[data-format]'))) {
      button.onclick = () => {
        state.format = button.dataset.format as ShotFormat
        for (const other of Array.from(sheet.querySelectorAll<HTMLButtonElement>('[data-format]'))) other.classList.toggle('on', other === button)
      }
    }
  }

  const handlers: Record<string, (v: number) => void> = {
    ev: v => {
      const b = body()
      state.ev = Math.round(v / b.ev.step) * b.ev.step
      applyView()
      syncSheetValues()
    },
    iso: v => {
      state.iso = Math.round(v)
      syncSheetValues()
    },
    shutter: v => {
      state.shutter = Math.round(v)
      syncSheetValues()
    },
    aperture: v => {
      state.aperture = Math.round(v)
      syncSheetValues()
    },
    focal: v => {
      state.focal = Math.round(v)
      applyView()
      syncSheetValues()
    },
    zoom: v => {
      state.zoom = Math.round(v * 10) / 10
      applyView()
      syncSheetValues()
    },
    wb: v => {
      state.wb = Math.round(v)
      applyView()
      syncSheetValues()
    },
  }

  function syncSheetValues() {
    const set = (row: string, text: string, value?: number) => {
      const line = sheet.querySelector<HTMLElement>(`[data-row="${row}"]`)
      if (!line) return
      line.querySelector<HTMLElement>('.cs-val')!.textContent = text
      if (value !== undefined) line.querySelector<HTMLInputElement>('input')!.value = String(value)
    }
    set('ev', `${state.ev > 0 ? '+' : ''}${state.ev.toFixed(1)}EV`)
    set('iso', isoLabel(isoValue()))
    set('shutter', shutterLabel(shutterValue()))
    if (state.aperture !== null) set('aperture', `f/${apertureValue()}`)
    set('focal', focalLabel(focalValue()))
    set('zoom', `${state.zoom.toFixed(1)}×`)
    set('wb', `${state.wb}K`)
  }

  // ---- 快门 / 录像 ------------------------------------------------------------------
  function signature(g: CanvasRenderingContext2D, w: number, h: number) {
    const unit = Math.max(w, h) / 1600, x = 34 * unit, y = h - 34 * unit, s = 38 * unit
    g.save()
    g.shadowColor = 'rgba(0,0,0,.35)'
    g.shadowBlur = 8 * unit
    g.fillStyle = '#a9503c'
    g.beginPath()
    g.roundRect(x, y - s, s, s, 5 * unit)
    g.fill()
    g.shadowBlur = 0
    g.strokeStyle = 'rgba(244,239,226,.9)'
    g.lineWidth = 1.6 * unit
    g.beginPath()
    g.roundRect(x + 4 * unit, y - s + 4 * unit, s - 8 * unit, s - 8 * unit, 3 * unit)
    g.stroke()
    g.fillStyle = '#f4efe2'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `600 ${22 * unit}px "Noto Serif SC","Source Han Serif SC","Songti SC",serif`
    g.fillText('桂', x + s / 2, y - s / 2 + unit)
    const where = place(), text = ['网上桂林', where, label(host.clock.hour)].filter(Boolean).join('  ·  ')
    g.textAlign = 'left'
    g.font = `${17 * unit}px "Noto Serif SC","Source Han Serif SC","Songti SC",serif`
    g.shadowColor = 'rgba(0,0,0,.5)'
    g.shadowBlur = 6 * unit
    g.fillText(text, x + s + 12 * unit, y - s / 2 + unit)
    g.restore()
  }

  const fileTitle = (extra = '') => {
    const where = (place() || '桂林').replace(/[\\/:*?"<>|]/g, '')
    return `网上桂林-${where}${extra}-${stamp()}`
  }

  async function capture() {
    const renderer = host.renderer
    const ratio = renderer.getPixelRatio()
    const long = Math.max(innerWidth, innerHeight)
    const hi = Math.min(4096 / long, Math.max(ratio, 2560 / long))
    const zoom = state.zoom
    renderer.setPixelRatio(hi)
    renderer.setSize(innerWidth, innerHeight, false)
    // 高分辨率 + 宽视角渲染，再由 grade() 按数码变焦裁切 —— 与预览构图逐像素一致。
    host.camera.fov = Math.min(110, Math.max(4, focalToFov(focalValue())))
    host.camera.updateProjectionMatrix()
    host.draw()
    const raw = document.createElement('canvas')
    raw.width = renderer.domElement.width
    raw.height = renderer.domElement.height
    raw.getContext('2d')!.drawImage(renderer.domElement, 0, 0)
    renderer.setPixelRatio(ratio)
    renderer.setSize(innerWidth, innerHeight, false)
    applyView()
    host.draw()

    const picture = grade(raw, settings(zoom), filters[state.filter][1] === 'none' ? '' : filters[state.filter][1])
    const context = picture.getContext('2d')!
    if (state.sign) signature(context, picture.width, picture.height)
    const blob = await encode(picture, state.format)
    flash.classList.remove('go')
    void flash.offsetWidth
    flash.classList.add('go')
    onCapture?.()

    const name = `${fileTitle()}.${extensionFor(state.format)}`
    const file = new File([blob], name, {type: blob.type})
    const meta = {
      place: place() || '桂林',
      hour: host.clock.hour,
      weather: host.clock.weather,
      width: picture.width,
      height: picture.height,
      bodyId: body().id,
      bodyName: body().name,
      lens: focalLabel(focalValue()),
      when: new Date().toISOString(),
    }
    const sidecar = state.toggle.raw && body().raw ? rawSidecar(settings(zoom), body(), meta) : null

    if (shotUrl) URL.revokeObjectURL(shotUrl)
    shotUrl = URL.createObjectURL(blob)
    const share = navigator.canShare?.({files: [file]}) && matchMedia('(pointer:coarse)').matches
    const sideName = `${fileTitle()}.raw.json`
    shot.innerHTML = `<img alt="刚拍的照片"><figcaption>
      <span class="shot-meta">${body().short} · ${focalLabel(focalValue())} · ${shutterLabel(shutterValue())} · ISO ${isoValue()} · ${state.wb}K</span>
      <a download="${name}">保存</a>${sidecar ? `<a download="${sideName}">RAW</a>` : ''}${share ? '<button>分享</button>' : ''}<button class="shot-close" aria-label="收起">×</button></figcaption>`
    shot.querySelector('img')!.src = shotUrl
    const links = Array.from(shot.querySelectorAll<HTMLAnchorElement>('a'))
    links[0].href = shotUrl
    if (sidecar && links[1]) links[1].href = URL.createObjectURL(sidecar)
    shot.querySelector<HTMLButtonElement>('figcaption button:not(.shot-close)')?.addEventListener('click', () => void navigator.share({files: [file], title: '网上桂林'}).catch(() => {}))
    shot.querySelector<HTMLButtonElement>('.shot-close')!.onclick = () => {
      shot.hidden = true
    }
    shot.hidden = false
    shot.classList.remove('in')
    void shot.offsetWidth
    shot.classList.add('in')
    Object.assign(window, {
      lastPhoto: {name, bytes: blob.size, width: picture.width, height: picture.height, body: body().id, raw: !!sidecar, sidecarName: sidecar ? sideName : null, settings: settings(zoom)},
    })
  }

  async function toggleRecording() {
    if (recording) {
      const result = await recording.stop()
      recording = null
      recBadge.hidden = true
      bar.classList.remove('rec')
      const name = saveRecording(result, '网上桂林')
      window.dispatchEvent(new CustomEvent('walk:toast', {detail: {text: `已保存录像 ${name}`, ms: 3600}}))
      Object.assign(window, {lastClip: {...result, name, blob: undefined}})
      return
    }
    const started = startRecording(host.renderer.domElement, body())
    if (!started) {
      window.dispatchEvent(new CustomEvent('walk:toast', {detail: {text: '这台设备不支持网页录像', ms: 3000}}))
      return
    }
    recording = started
    recBadge.hidden = false
    bar.classList.add('rec')
  }

  // ---- 交互 -------------------------------------------------------------------------
  function chips(group: string, on: (v: string) => boolean) {
    for (const button of Array.from(bar.querySelectorAll<HTMLButtonElement>(`[data-group="${group}"] button`))) button.classList.toggle('on', on(button.dataset.v!))
  }

  function refresh() {
    chips('sky', v => host.clock.weather === v)
    chips('filter', v => +v === state.filter)
    chips('opts', v => (v === 'figure' ? state.toggle.figure : v === 'sign' ? state.toggle.sign : !sheet.hidden))
    applyView()
    applyGuides()
  }

  bar.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-v]')
    if (!button) return
    const group = button.parentElement!.dataset.group
    const value = button.dataset.v!
    if (group === 'sky') host.clock.weather = value as Weather
    if (group === 'filter') state.filter = +value
    if (group === 'opts') {
      if (value === 'sheet') {
        sheet.hidden = !sheet.hidden
        if (!sheet.hidden) buildSheet()
      } else {
        const key = value as 'figure' | 'sign'
        state.toggle[key] = !state.toggle[key]
        if (key === 'figure') host.walker()?.showFigure(state.toggle.figure)
      }
    }
    refresh()
  })
  hour.oninput = () => {
    host.clock.goal = null
    host.clock.set(+hour.value)
  }
  exit.onclick = close
  bar.querySelector<HTMLButtonElement>('.photo-shutter')!.onclick = () => void capture()
  bar.querySelector<HTMLButtonElement>('.photo-rec')!.onclick = () => void toggleRecording()

  function open() {
    if (active) return
    active = true
    saved = {fov: host.camera.fov, flowing: host.clock.flowing}
    resetForBody(prefs().gear.equipped)
    host.clock.flowing = false
    host.walker()?.hold(true)
    setCameraShown(false, host.walker())
    document.body.dataset.photo = 'on'
    bar.hidden = exit.hidden = false
    sheet.hidden = true
    buildSheet()
    refresh()
  }

  function close() {
    if (!active) return
    if (recording) void recording.stop().then(result => saveRecording(result, '网上桂林'))
    recording = null
    recBadge.hidden = true
    bar.classList.remove('rec')
    active = false
    host.clock.flowing = saved.flowing
    host.walker()?.hold(false)
    host.walker()?.showFigure(true)
    setCameraShown(true, host.walker())
    host.camera.fov = saved.fov
    host.camera.updateProjectionMatrix()
    host.renderer.domElement.style.filter = ''
    delete document.body.dataset.photo
    bar.hidden = exit.hidden = sheet.hidden = guides.hidden = true
    shot.hidden = true
    if (shotUrl) {
      URL.revokeObjectURL(shotUrl)
      shotUrl = ''
    }
  }

  let shown = ''
  const up = new THREE.Vector3()
  function tick() {
    if (!active) return
    if (document.activeElement !== hour) hour.value = String(host.clock.hour)
    const text = label(host.clock.hour)
    if (text !== shown) {
      shown = text
      hourText.textContent = text
    }
    // 水平仪：相机 up 轴的横滚
    if (state.toggle.level && !guides.hidden) {
      up.set(0, 1, 0).applyQuaternion(host.camera.quaternion)
      const roll = (Math.atan2(up.x, up.y) * 180) / Math.PI
      levelLayer.style.transform = `rotate(${roll.toFixed(2)}deg)`
      levelLayer.classList.toggle('level-ok', Math.abs(roll) < 1.2)
    }
    if (recording) recText.textContent = `${String(Math.floor(recording.seconds / 60)).padStart(2, '0')}:${String(Math.floor(recording.seconds % 60)).padStart(2, '0')}`
    const flashText = state.toggle.raw && body().raw ? ' · RAW' : ''
    readout.textContent = `${body().short} · ${focalLabel(focalValue())} · ${shutterLabel(shutterValue())} · ISO ${isoValue()}${apertureValue() ? ` · f/${apertureValue()}` : ''} · ${state.wb}K · ${state.zoom.toFixed(1)}×${flashText}`
  }

  return {
    open,
    close,
    capture: () => void capture(),
    record: () => void toggleRecording(),
    get active() {
      return active
    },
    get body() {
      return body()
    },
    tick,
  }
}
