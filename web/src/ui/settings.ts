// 设置面板（IDOK-178）：读数开关、第一/第三人称、自定义键位。
// 用现成的 .about-mask 弹层语言，好处是输入守卫会自动把移动/骑行热键挡住。
import './settings.css'
import {DEFAULT_PREFS, onPrefs, prefs, setPrefs, THUMB_SCALE_MAX, THUMB_SCALE_MIN, type StatsPrefs, type ThumbLayout} from './prefs'
import {ACTIONS, bindingLabel, isCustom, keyLabel, reservedFor, resetBindings, setBinding, type Action} from '../input/keymap'
import {setViewMode, viewModeLabel} from '../walk/view-mode'
import {masterVolume,setMasterVolume,rideSoundMuted,setRideSoundMuted,RIDE_SOUND_EVENT} from '../walk/ride-sound-pref'

const STAT_ROWS: [keyof StatsPrefs, string, string][] = [
  ['fps', '帧率', '读数条里的每秒帧数（FPS）'],
  ['net', '网速', '当前下载速度（KB/s、MB/s）'],
  ['online', '在线人数', '此刻在城里的人数，60 秒刷新'],
]

// IDOK-256：手机按键布局预设。小图是横放手机的示意：左边圆 = 摇杆，右边点 = 动作键。
const THUMB_PRESETS: [ThumbLayout, string, string][] = [
  ['arc', '弧形', '<circle cx="9" cy="21" r="5"/><circle cx="40" cy="13" r="3.2"/><circle cx="33" cy="19" r="2.6"/><circle cx="34" cy="25.5" r="2.4"/><circle cx="46" cy="13.5" r="2.2"/>'],
  ['column', '单列', '<circle cx="9" cy="21" r="5"/><circle cx="46" cy="8.5" r="2.2"/><circle cx="46" cy="15" r="3"/><circle cx="46" cy="21.5" r="2.6"/><circle cx="46" cy="27.5" r="2.6"/>'],
  ['corner', '贴右下', '<circle cx="9" cy="21" r="5"/><circle cx="45.5" cy="26" r="3.2"/><circle cx="38" cy="27" r="2.6"/><circle cx="46" cy="18.5" r="2.6"/><circle cx="38.5" cy="20" r="2.2"/>'],
]

let mask: HTMLDivElement | undefined
let capturing: Action | undefined

function row(label: string, hint: string) {
  return `<span class="set-what"><b>${label}</b><small>${hint}</small></span>`
}

import {geoActive,geoStatus,geoUI,requestGeo} from '../geolocation'

function build() {
  mask = document.createElement('div')
  mask.className = 'about-mask'
  mask.hidden = true
  mask.innerHTML = `<div class="about-panel settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <header><h2 id="settings-title">设置</h2><button type="button" class="about-close" aria-label="关闭">关闭</button></header>
    <div class="set-body">
      <section class="set-block"><h3>我的位置</h3>
        <p class="set-note">允许定位后，人物会移动到你的真实位置。经纬度仅在本机使用；联机玩家可从人物位置推知你的实际位置。</p>
        <div class="set-seg"><button type="button" data-geo-once>定位到我</button><button type="button" data-geo-follow>跟随定位</button></div>
        <p class="set-note" role="status" data-geo-status></p>
      </section>
      <section class="set-block"><h3>声音</h3>
        <label class="set-row set-row--range"><span class="set-what"><b>总音量</b><small>骑车和鸣笛</small></span><input data-volume type="range" min="0" max="1" step="0.01"><span class="set-val" data-volume-out></span></label>
        <label class="set-row"><span class="set-what"><b>静音</b><small>关闭全部游戏音效</small></span><input data-mute type="checkbox"></label>
      </section>
      <section class="set-block">
        <h3>读数显示</h3>
        ${STAT_ROWS.map(([id, label, hint]) => `<label class="set-row">
          <span class="set-what"><b>${label}</b><small>${hint}</small></span>
          <input type="checkbox" data-stat="${id}">
        </label>`).join('')}
      </section>
      <section class="set-block">
        <h3>动作</h3>
        <label class="set-row">
          <span class="set-what"><b>表情动作</b><small>长按 G 或点「表情」打开动作盘；关掉后也不显示别人的表情</small></span>
          <input type="checkbox" data-emotes>
        </label>
      </section>
      <section class="set-block">
        <h3>画面</h3>
        <label class="set-row"><span class="set-what"><b>进入时自动全屏</b><small>触屏设备进入游戏时尝试切到横屏</small></span><input data-fullscreen type="checkbox"></label>
      </section>
      <section class="set-block">
        <h3>视角</h3>
        <div class="set-seg" role="radiogroup" aria-label="视角">
          <button type="button" data-view="third">第三人称</button>
          <button type="button" data-view="first">第一人称</button>
        </div>
        <p class="set-note">落地步行时生效；骑车、开车、坐船仍是第三人称。</p>
      </section>
      <section class="set-block set-block--thumb">
        <h3>手机按键<button type="button" class="set-reset" data-thumb-reset>恢复默认</button></h3>
        <div class="set-seg set-seg--thumb" role="radiogroup" aria-label="按键布局">${THUMB_PRESETS.map(([id, label, dots]) => `<button type="button" data-thumb="${id}">
          <svg viewBox="0 0 54 34" aria-hidden="true"><rect x="1" y="1" width="52" height="32" rx="6"/>${dots}</svg><span>${label}</span>
        </button>`).join('')}</div>
        <label class="set-row set-row--range">
          <span class="set-what"><b>按钮大小</b><small>窄屏会自动收一点，保证不压到摇杆</small></span>
          <input type="range" data-thumb-scale min="${THUMB_SCALE_MIN}" max="${THUMB_SCALE_MAX}" step="0.05"><output data-thumb-scale-out></output>
        </label>
        <label class="set-row">
          <span class="set-what"><b>左手模式</b><small>摇杆换到右下，跃 / 蹲 / 远近换到左下</small></span>
          <input type="checkbox" data-thumb-mirror>
        </label>
        <p class="set-note">只在手机、平板触屏上生效；改完立刻生效并记住。</p>
      </section>
      <section class="set-block set-block--keys">
        <h3>键位<button type="button" class="set-reset">恢复默认</button></h3>
        <ul class="set-keys">${ACTIONS.map(action => `<li>
          <span class="set-what"><b>${action.label}</b></span>
          <button type="button" class="set-key" data-action="${action.id}"></button>
        </li>`).join('')}</ul>
        <p class="set-warn" role="alert" hidden></p>
        <p class="set-note">点键位按钮，然后按你想用的键。Esc 取消。<i class="set-custom">· 自改</i></p>
      </section>
    </div>
  </div>`
  const fullscreen = mask.querySelector<HTMLInputElement>('[data-fullscreen]')!
  const once=mask.querySelector<HTMLButtonElement>('[data-geo-once]')!, follow=mask.querySelector<HTMLButtonElement>('[data-geo-follow]')!
  const status=mask.querySelector<HTMLElement>('[data-geo-status]')!
  function paintGeo(){status.textContent=geoStatus;once.disabled=geoActive;follow.textContent=geoActive?'停止定位':'跟随定位';follow.classList.toggle('on',geoActive)}
  once.onclick=()=>requestGeo(false);follow.onclick=()=>requestGeo(true);geoUI.addEventListener('change',paintGeo);paintGeo()
  fullscreen.onchange = () => setPrefs(value => ({...value, autoFullscreen: fullscreen.checked}))
  const emotes=mask.querySelector<HTMLInputElement>('[data-emotes]')!
  const volume=mask.querySelector<HTMLInputElement>('[data-volume]')!,mute=mask.querySelector<HTMLInputElement>('[data-mute]')!
  const volumeOut=mask.querySelector<HTMLElement>('[data-volume-out]')!,showVolume=()=>{volumeOut.textContent=`${Math.round(volume.valueAsNumber*100)}%`}
  volume.value=String(masterVolume());showVolume();volume.oninput=()=>{setMasterVolume(volume.valueAsNumber);showVolume()}
  mute.checked=rideSoundMuted();mute.onchange=()=>setRideSoundMuted(mute.checked)
  window.addEventListener(RIDE_SOUND_EVENT,()=>{mute.checked=rideSoundMuted()})
  emotes.checked=localStorage.getItem('glol.emotes')!=='0'
  emotes.onchange=()=>localStorage.setItem('glol.emotes',emotes.checked?'1':'0')
  const close = () => {
    capturing = undefined
    mask!.hidden = true
  }
  mask.querySelector('.about-close')!.addEventListener('click', close)
  mask.addEventListener('click', event => {
    if (event.target === mask) close()
  })
  window.addEventListener('keydown', event => {
    if (event.code === 'Escape' && !mask!.hidden) close()
  })
  for (const input of Array.from(mask.querySelectorAll<HTMLInputElement>('[data-stat]'))) {
    input.addEventListener('change', () => {
      const id = input.dataset.stat as keyof StatsPrefs
      setPrefs(value => ({...value, stats: {...value.stats, [id]: input.checked}}))
    })
  }
  for (const button of Array.from(mask.querySelectorAll<HTMLButtonElement>('[data-view]'))) {
    button.addEventListener('click', () => setViewMode(button.dataset.view === 'first' ? 'first' : 'third'))
  }
  const setThumb = (patch: Partial<ReturnType<typeof prefs>['thumb']>) =>
    setPrefs(value => ({...value, thumb: {...value.thumb, ...patch}}))
  for (const button of Array.from(mask.querySelectorAll<HTMLButtonElement>('[data-thumb]'))) {
    button.addEventListener('click', () => setThumb({layout: button.dataset.thumb as ThumbLayout}))
  }
  const scale = mask.querySelector<HTMLInputElement>('[data-thumb-scale]')!
  scale.addEventListener('input', () => setThumb({scale: Math.round(Number(scale.value) * 100) / 100}))
  const mirror = mask.querySelector<HTMLInputElement>('[data-thumb-mirror]')!
  mirror.addEventListener('change', () => setThumb({mirror: mirror.checked}))
  mask.querySelector('[data-thumb-reset]')!.addEventListener('click', () => setThumb({...DEFAULT_PREFS.thumb}))
  onPrefs(() => paintThumb())
  mask.querySelector('.set-block--keys .set-reset')!.addEventListener('click', () => {
    resetBindings()
    paintKeys()
  })
  for (const button of Array.from(mask.querySelectorAll<HTMLButtonElement>('.set-key'))) {
    button.addEventListener('click', () => {
      capturing = button.dataset.action as Action
      paintKeys()
    })
  }
  // 抓键：capture 阶段拿下来并 stopPropagation，行走层的 window 监听收不到这一下。
  window.addEventListener(
    'keydown',
    event => {
      if (!capturing) return
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') {
        capturing = undefined
        paintKeys()
        return
      }
      const taken = capturing==='emote' && event.code==='KeyG' ? undefined : reservedFor(event.code)
      const note = mask!.querySelector<HTMLElement>('.set-warn')!
      if (taken) {
        // 保持抓键状态，提示换一个。
        note.textContent = `${keyLabel(event.code)} 已用于「${taken}」，换一个键`
        note.hidden = false
        return
      }
      note.hidden = true
      setBinding(capturing, event.code)
      capturing = undefined
      paintKeys()
    },
    {capture: true},
  )
  document.body.append(mask)
  paint()
}

function paint() {
  if (!mask) return
  const current = prefs()
  mask.querySelector<HTMLInputElement>('[data-fullscreen]')!.checked = current.autoFullscreen
  for (const input of Array.from(mask.querySelectorAll<HTMLInputElement>('[data-stat]'))) {
    input.checked = current.stats[input.dataset.stat as keyof StatsPrefs]
  }
  for (const button of Array.from(mask.querySelectorAll<HTMLButtonElement>('[data-view]'))) {
    const on = button.dataset.view === current.view
    button.classList.toggle('on', on)
    button.setAttribute('aria-pressed', String(on))
  }
  paintThumb()
  paintKeys()
}

function paintThumb() {
  if (!mask) return
  const thumb = prefs().thumb
  for (const button of Array.from(mask.querySelectorAll<HTMLButtonElement>('[data-thumb]'))) {
    const on = button.dataset.thumb === thumb.layout
    button.classList.toggle('on', on)
    button.setAttribute('aria-pressed', String(on))
  }
  const scale = mask.querySelector<HTMLInputElement>('[data-thumb-scale]')!
  scale.value = String(thumb.scale)
  mask.querySelector<HTMLOutputElement>('[data-thumb-scale-out]')!.textContent = `${Math.round(thumb.scale * 100)}%`
  mask.querySelector<HTMLInputElement>('[data-thumb-mirror]')!.checked = thumb.mirror
}

function paintKeys() {
  if (!mask) return
  for (const button of Array.from(mask.querySelectorAll<HTMLButtonElement>('.set-key'))) {
    const action = button.dataset.action as Action
    const waiting = capturing === action
    button.textContent = waiting ? '按新键…' : bindingLabel(action)
    button.classList.toggle('waiting', waiting)
    button.classList.toggle('custom', isCustom(action) && !waiting)
  }
}

export function openSettings() {
  if (!mask) build()
  paint()
  mask!.hidden = false
  mask!.querySelector<HTMLButtonElement>('.about-close')!.focus()
}

export function closeSettings() {
  if (mask) mask.hidden = true
}

function button(text: string, label: string, className: string) {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = className
  element.textContent = text
  element.setAttribute('aria-label', label)
  element.title = label
  return element
}

/** 右上角 dock 里的「设置」入口。 */
export function mountSettingsEntry(host: HTMLElement) {
  if (host.querySelector('.dock-settings')) return
  const entry = button('设置', '设置（N）', 'dock-settings')
  entry.addEventListener('click', () => openSettings())
  host.append(entry)
}

/** 右上角 dock 里的「第一/第三人称」切换。 */
export function mountViewEntry(host: HTMLElement) {
  const existing = host.querySelector<HTMLButtonElement>('.dock-view')
  if (existing) return existing
  const entry = button(viewModeLabel(), '切换第一/第三人称（T）', 'dock-view')
  const sync = () => {
    entry.textContent = viewModeLabel()
    entry.dataset.view = prefs().view
  }
  entry.addEventListener('click', () => {
    setViewMode(prefs().view === 'first' ? 'third' : 'first')
    sync()
  })
  onPrefs(sync)
  sync()
  host.append(entry)
  return entry
}
