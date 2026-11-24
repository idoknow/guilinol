import * as THREE from 'three'
import type {Host} from './host'
import {label, type Weather} from '../look/time'
import {camera, focalLabel, focalToFov, isoLabel, sensorArea, shutterLabel, videoPreset, type BodyId, type CameraBody} from '../gear/cameras'
import {encode, extensionFor, grade, stamp, type ShotSettings} from '../gear/capture'
import {canRecord, saveRecording, startRecording, type Recording} from '../gear/video'
import {prefs} from '../ui/prefs'
import {openRack} from '../ui/gear-rack'
import {refreshCamera, setCameraShown} from '../gear/hand'
import {touchUi} from '../ui/input-mode'

// 拍照模式（IDOK-182 起接了相机装备，IDOK-211 又把专业参数收掉了）：
//   机身只决定取景广角、画质基线和手上拿的那台；UI 回到「时辰 / 滤镜 / 天气 / 人物 / 落款」，
//   按快门就出片，另外保留一颗录像键，固定录 MP4。
const filters: [string, string][] = [
  ['原片', 'none'],
  ['青绿', 'saturate(1.18) hue-rotate(-8deg) contrast(1.04)'],
  ['胶片', 'sepia(.2) contrast(1.08) saturate(.88) brightness(1.03)'],
  ['暮金', 'sepia(.32) saturate(1.3) hue-rotate(-12deg) brightness(1.02)'],
  ['水墨', 'grayscale(1) sepia(.12) contrast(1.18) brightness(1.06)'],
]
const skies: [string, Weather][] = [['晴', 'clear'], ['雾', 'mist'], ['雨', 'rain']]

type ToggleKey = 'figure' | 'sign'

interface ShotState {
  filter: number
  body: BodyId
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
      <span class="chips" data-group="opts"><button data-v="figure">人物</button><button data-v="sign">落款</button><button data-v="rack">换机</button></span></div>
    <div class="photo-actions"><button class="photo-rec" aria-label="录像"><i></i></button><button class="photo-shutter" aria-label="按快门"><i></i></button></div>`

  const flash = document.createElement('div')
  flash.className = 'photo-flash'
  const shot = document.createElement('figure')
  shot.className = 'photo-shot'
  shot.hidden = true
  const recBadge = document.createElement('div')
  recBadge.className = 'cg-rec'
  recBadge.hidden = true
  recBadge.innerHTML = '<i></i><span>00:00</span>'
  document.body.append(bar, exit, flash, shot, recBadge)

  const hour = bar.querySelector<HTMLInputElement>('input')!
  const hourText = bar.querySelector<HTMLElement>('.photo-hour span')!
  const recText = recBadge.querySelector('span')!

  const state: ShotState = {
    filter: 0,
    body: prefs().gear.equipped,
    toggle: {figure: true, sign: true},
  }

  let active = false
  let saved = {fov: 55, flowing: true}
  let recording: Recording | null = null
  let shotUrl = ''

  const body = (): CameraBody => camera(state.body)
  const focalValue = () => body().focal.min
  const fovNow = () => Math.min(110, Math.max(4, focalToFov(focalValue())))

  // 不暴露参数，但曝光仍然跟着时辰/天气走一档，夜里不至于全黑。
  function autoExposure() {
    const b = body()
    const hourNow = host.clock.hour
    const night = hourNow < 6.4 || hourNow > 18.6
    const dim = host.clock.weather !== 'clear'
    const isoFloor = night ? (dim ? 6400 : 3200) : dim ? 400 : b.iso[Math.min(1, b.iso.length - 1)]
    const iso = b.iso[Math.max(0, b.iso.findIndex(value => value >= isoFloor))]
    const shutterFloor = night ? 1 / 30 : dim ? 1 / 60 : 1 / 125
    // 快门表从快到慢排列：取最接近目标的一档（findIndex(≤) 会永远拿到 1/8000）
    const shutter = b.shutter.reduce((best, value) => (Math.abs(Math.log2(value / shutterFloor)) < Math.abs(Math.log2(best / shutterFloor)) ? value : best), b.shutter[0])
    return {iso, shutter, wb: night ? Math.max(b.wb.min, 4200) : Math.round((b.wb.min + b.wb.max) / 200) * 100}
  }

  function settings(): ShotSettings {
    const auto = autoExposure()
    const b = body()
    return {
      exposure: 0,
      // 自动曝光只挑 ISO/快门，测光基准差按 0 档算（成片亮度 = 2^exposure = 1，即「正常曝光」）
      meter: 0,
      iso: auto.iso,
      baseIso: b.baseIso,
      sensor: sensorArea(b),
      aperture: b.aperture.length ? b.aperture[Math.floor(b.aperture.length / 2)] : null,
      shutter: auto.shutter,
      wb: auto.wb,
      zoom: 1,
      macro: false,
      grid: 'none',
      format: b.formats[0],
      raw: false,
      level: false,
    }
  }

  function resetForBody(next: BodyId) {
    state.body = camera(next).id
  }

  // ---- 取景预览 ---------------------------------------------------------------------
  function previewFilter(): string {
    const look = filters[state.filter][1]
    const parts: string[] = []
    if (look !== 'none') parts.push(look)
    // 夜景/雾雨按自动挡的 EV 提示一下，让预览别和成片差太远。
    const ev = -Math.log2(autoExposure().iso / body().baseIso) * 0.35
    if (Math.abs(ev) > 0.05) parts.push(`brightness(${Math.pow(2, ev).toFixed(3)})`)
    return parts.join(' ')
  }

  function applyView() {
    host.camera.fov = fovNow()
    host.camera.updateProjectionMatrix()
    host.renderer.domElement.style.filter = previewFilter()
  }

  // ---- 快门 -------------------------------------------------------------------------
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

  // IDOK-239：成片右下角常驻一行小水印（与「落款」开关无关），注明测试画面并给出访问地址，
  // 照片被转发后别人也知道去哪玩；字小、半透明、贴角，不压主体。
  function watermark(g: CanvasRenderingContext2D, w: number, h: number) {
    const unit = Math.max(w, h) / 1600, pad = 22 * unit
    g.save()
    g.textAlign = 'right'
    g.textBaseline = 'alphabetic'
    g.shadowColor = 'rgba(0,0,0,.55)'
    g.shadowBlur = 4 * unit
    g.fillStyle = 'rgba(244,239,226,.82)'
    g.font = `600 ${14 * unit}px "Noto Serif SC","Source Han Serif SC","Songti SC",serif`
    g.fillText('glol.rcpd.cc', w - pad, h - pad)
    g.fillStyle = 'rgba(244,239,226,.62)'
    g.font = `${10.5 * unit}px "Noto Serif SC","Source Han Serif SC","Songti SC",serif`
    g.fillText('测试画面，不代表最终画质 · 浏览器访问', w - pad, h - pad - 18 * unit)
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
    renderer.setPixelRatio(hi)
    renderer.setSize(innerWidth, innerHeight, false)
    host.camera.fov = fovNow()
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

    const settingsNow = settings()
    const picture = grade(raw, settingsNow, filters[state.filter][1] === 'none' ? '' : filters[state.filter][1])
    const context = picture.getContext('2d')!
    if (state.toggle.sign) signature(context, picture.width, picture.height)
    watermark(context, picture.width, picture.height)
    const blob = await encode(picture, settingsNow.format)
    flash.classList.remove('go')
    void flash.offsetWidth
    flash.classList.add('go')
    onCapture?.()

    const name = `${fileTitle()}.${extensionFor(settingsNow.format)}`
    const file = new File([blob], name, {type: blob.type})

    if (shotUrl) URL.revokeObjectURL(shotUrl)
    shotUrl = URL.createObjectURL(blob)
    const share = navigator.canShare?.({files: [file]}) && touchUi()
    shot.innerHTML = `<img alt="刚拍的照片"><figcaption>
      <span class="shot-meta">${body().short} · ${focalLabel(focalValue())} · ${shutterLabel(settingsNow.shutter)} · ISO ${settingsNow.iso}</span>
      <a download="${name}">保存</a>${share ? '<button>分享</button>' : ''}<button class="shot-close" aria-label="收起">×</button></figcaption>`
    shot.querySelector('img')!.src = shotUrl
    shot.querySelector<HTMLAnchorElement>('a')!.href = shotUrl
    shot.querySelector<HTMLButtonElement>('figcaption button:not(.shot-close)')?.addEventListener('click', () => void navigator.share({files: [file], title: '网上桂林'}).catch(() => {}))
    shot.querySelector<HTMLButtonElement>('.shot-close')!.onclick = () => {
      shot.hidden = true
    }
    shot.hidden = false
    shot.classList.remove('in')
    void shot.offsetWidth
    shot.classList.add('in')
    Object.assign(window, {
      lastPhoto: {
        name,
        bytes: blob.size,
        width: picture.width,
        height: picture.height,
        body: body().id,
        raw: false,
        settings: settingsNow,
      },
    })
  }

  // ---- 录像（固定 MP4，档位用机身第一档） ---------------------------------------------
  async function toggleRecording() {
    if (recording) {
      const result = await recording.stop()
      recording = null
      recBadge.hidden = true
      bar.classList.remove('rec')
      const name = saveRecording(result, '网上桂林')
      if (!name) {
        window.dispatchEvent(new CustomEvent('walk:toast', {
          detail: {text: '这台机器录不出画面（浏览器编码器没有输出），换个浏览器再试', ms: 5200},
        }))
        return
      }
      const fellBack = result.container === 'webm'
      window.dispatchEvent(new CustomEvent('walk:toast', {
        detail: {text: fellBack ? `已保存 ${name}（这台机器编不出 MP4，存成 WebM）` : `已保存录像 ${name}`, ms: fellBack ? 5200 : 3600},
      }))
      Object.assign(window, {
        lastClip: {
          name,
          mime: result.mime,
          container: result.container,
          preset: result.preset,
          width: result.width,
          height: result.height,
          fps: result.fps,
          seconds: result.seconds,
          bytes: result.blob.size,
        },
      })
      return
    }
    const started = await startRecording(host.renderer.domElement, body(), videoPreset(body(), 0))
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
    chips('opts', v => (v === 'figure' ? state.toggle.figure : state.toggle.sign))
    applyView()
  }

  bar.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-v]')
    if (!button) return
    const group = button.parentElement!.dataset.group
    const value = button.dataset.v!
    if (group === 'sky') host.clock.weather = value as Weather
    if (group === 'filter') state.filter = +value
    if (group === 'opts') {
      if (value === 'rack') {
        openRack(id => {
          resetForBody(id)
          applyView()
          refreshCamera(host.walker())
        })
      } else {
        const key = value as ToggleKey
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
    host.camera.fov = saved.fov
    host.camera.updateProjectionMatrix()
    host.renderer.domElement.style.filter = ''
    delete document.body.dataset.photo
    bar.hidden = exit.hidden = true
    shot.hidden = true
    if (shotUrl) {
      URL.revokeObjectURL(shotUrl)
      shotUrl = ''
    }
  }

  let shown = ''
  function tick() {
    if (!active) return
    if (document.activeElement !== hour) hour.value = String(host.clock.hour)
    const text = label(host.clock.hour)
    if (text !== shown) {
      shown = text
      hourText.textContent = text
    }
    if (recording) recText.textContent = `${String(Math.floor(recording.seconds / 60)).padStart(2, '0')}:${String(Math.floor(recording.seconds % 60)).padStart(2, '0')}`
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
    get recording() {
      return !!recording
    },
    tick,
  }
}