import {label, type Weather} from '../look/time'
import {getPlayMode, onPlayMode} from '../game/play-mode'
import {onWorldClock, worldSnapshot} from '../global-time'

// 时辰 / 天气 panel (top-left, under the stats line).
//
// IDOK-542: each key shows a 刻线小像 picked by data-sky (hud.css → ico-sky-*.svg); the character stays
// in the button (font-size:0) so screen readers and scripts still read 晨 / 午 / 晴 …
//
// IDOK-502 全服统一时间: by default the hour and the weather come from the deterministic world clock
// (lib/world-time.ts) fed by the server clock, so every player sees the same sky at the same instant
// — 1 game hour per real minute, 3 game hours per weather spell. The panel is a readout then; it only
// becomes an editor for a *local* preview (deliberate mood picks, photo mode, `clock.set()`), and the
// 「全服」 button hands control back.
//
// Capture harnesses stay reproducible: `?time=`, `?weather=`, `?flow=0` pin everything, and a bare
// `?verify` keeps the historical deterministic 10:00 start (the world clock is wall-clock time, so
// letting it through would make every screenshot depend on when it ran). Pass `?worldtime=1` on a
// `?verify` link to opt into the world clock — `scripts/verify-world-time.mjs` does exactly that.
// Solo (IDOK-154): no panel — the clock follows the world by itself.
const moods:[string,number,string][] = [['晨',6.6,'dawn'],['午',12.5,'noon'],['昏',18.1,'dusk'],['夜',21.5,'night']]
const skies:[string,Weather,string][] = [['晴','clear','clear'],['雾','mist','mist'],['雨','rain','rain']]
const WEATHERS:Weather[] = ['clear','mist','rain']
/** Seconds to absorb the remaining lag against the world hour; small enough to stay invisible. */
const CATCH_UP_S = 0.6
/** Hard cap on the per-frame catch-up gain, so an arbitrarily large `dt` can never hard-cut the sky. */
const MAX_GAIN = 0.25
/** A weather spell lasts 3 game minutes, so ease into a new one instead of cutting. */
const WORLD_BLEND_MS = 12000
/** Anything picked by hand switches fast. */
const MANUAL_BLEND_MS = 1200

export function skyClock(params:URLSearchParams) {
  const explicitTime = params.get('time')
  const weatherParam = params.get('weather')
  const weatherPinValid = WEATHERS.includes(weatherParam as Weather)
  const worldtime = params.has('worldtime')
  // A capture harness (`?verify` without `?worldtime`) without an explicit time keeps the old 10:00 start.
  const harness = params.has('verify') && !worldtime
  // A weather-only capture link must not render a drifting hour either.
  const capturePinned = explicitTime !== null || params.get('flow') === '0' || harness || (weatherPinValid && !worldtime)
  const requested = Number(explicitTime ?? 10), start = Number.isFinite(requested) ? requested : 10
  const initial = worldSnapshot()

  // Internal state; `clock.hour` is an accessor so a bare `clock.hour = h` (many harnesses do this)
  // stays pinned instead of being yanked back to the world hour on the next frame.
  let hour = capturePinned ? start : initial.hour
  let weather = (weatherPinValid ? weatherParam : capturePinned ? 'clear' : initial.weather) as Weather
  let flowing = !capturePinned, goal:number|null = null, world = !capturePinned, blendMs = MANUAL_BLEND_MS
  let source: 'server' | 'local' = 'local'
  let linkState = 'off'
  const weatherPinned = weatherPinValid
  // While linked, hour and weather are the server's call; a local preview must not survive a reconnect.
  const locked = ()=>linkState === 'online' || linkState === 'connecting'
  /** True while a capture anchor owns the clock — it must never be dragged back to world time. */
  const anchored = ()=>capturePinned
  /** Photo mode is an explicit local preview; a reconnect mid-shot must not interrupt it. */
  const shooting = ()=>document.body.dataset.photo === 'on'

  const panel = document.createElement('div'); panel.className = 'sky-ui'
  const time = document.createElement('span'); time.className = 'sky-time'
  const sourceTag = document.createElement('span'); sourceTag.className = 'sky-src'
  const flow = document.createElement('button'); flow.className = 'sky-flow'
  const follow = document.createElement('button'); follow.className = 'sky-follow'
  const fold = document.createElement('button'); fold.className = 'sky-fold'
  // The 全服 button carried no label at all in the first cut and rendered as a blank red block (IDOK-502 review).
  follow.textContent = '全服'
  follow.title = '回到全服统一时间'
  follow.setAttribute('aria-label', '回到全服统一时间')
  const row = (items:[string,unknown,string][], pick:(value:never)=>void, active:(value:never)=>boolean)=>{
    const group = document.createElement('span'); group.className = 'sky-group'
    const buttons = items.map(([text,value,key])=>{const b = document.createElement('button'); b.textContent = text; b.dataset.sky = key; b.title = text
      b.onclick = ()=>{if(locked())return; pick(value as never); refresh()}; group.append(b); return [b,value] as const})
    return {group,buttons,refresh(){for(const [b,value] of buttons) b.classList.toggle('on',active(value as never))}}
  }
  // A mood pick is a deliberate local preview: sweep to it, then hold. 「全服」 comes back.
  const hours = row(moods,(h:number)=>{world = false; flowing = false; goal = h},(h:number)=>{const d=Math.abs(hour-h)%24;return Math.min(d,24-d)<1.25})
  const weathers = row(skies,(w:Weather)=>{world = false; flowing = false; weather = w; blendMs = MANUAL_BLEND_MS},(w:Weather)=>weather===w)

  window.addEventListener('glol:mp-status', event => {
    const next = (event as CustomEvent<{state?: string}>).detail?.state ?? 'off'
    if(next === linkState) return
    const wasLinked = locked()
    linkState = next
    if(locked() && !wasLinked) {
      // Entering multiplayer: a local preview cannot come along. A capture anchor keeps its pin,
      // and an in-progress photo shoot keeps its preview until the shutter bar is closed.
      if(!anchored() && !shooting()) {world = true; goal = null; flowing = true}
    }
    refresh()
  })

  flow.onclick = ()=>{if(locked())return
    if(world){world = false; flowing = false} else {world = true; flowing = true; goal = null}
    refresh()}
  follow.onclick = ()=>{world = true; flowing = true; goal = null; refresh()}
  panel.append(time,sourceTag,hours.group,weathers.group,flow,follow,fold); document.body.append(panel)

  let lockedShown:boolean|null = null
  let shownHour = ''
  function refresh(){
    const lock = locked()
    hours.refresh(); weathers.refresh()
    for(const button of [...hours.buttons.map(([b])=>b),...weathers.buttons.map(([b])=>b),flow]) button.disabled = lock
    flow.textContent = world?'❚❚':'▶'
    // IDOK-542: the flow key carries an icon too (font-size:0); keep the character for a11y and scripts.
    flow.dataset.sky = world?'pause':'play'
    flow.setAttribute('aria-label',world?'本地预览：暂停全服时间':'回到全服时间')
    flow.title = flow.getAttribute('aria-label')!
    follow.hidden = world
    sourceTag.textContent = world ? (source === 'server' ? '全服' : '全服·本机') : '本地'
    sourceTag.title = world
      ? (source === 'server' ? '已与服务端时钟对齐' : '未连上服务端：按本机时钟推算同一个全服时间')
      : '本地预览：只影响这一台设备，点「全服」恢复'
    const text = label(hour)
    time.textContent = text
    if(lock !== lockedShown){lockedShown = lock; panel.classList.toggle('locked',lock)
      panel.title = lock?'联机中由全服统一时间':''
      if(lock) flow.setAttribute('aria-label','联机中由全服统一时间')}
    shownHour = text
  }
  refresh()

  // IDOK-158: on a phone the panel eats a third of the top edge, which matters most in landscape
  // where the view is the point. Fold it down to just the clock; remember the choice so rotating
  // back and forth doesn't undo it (stored per device, ignored when storage is blocked).
  // The chevron is drawn in CSS (hud.css .sky-fold::before) rather than set as a ‹/› glyph: at 20px and
  // 55% opacity that glyph read as decoration and people never found the control.
  // IDOK-468: folded by default everywhere; only an explicit 展开 is remembered (new key, so the old
  // per-device '0' written on every first load no longer pins the panel open).
  const OPEN_KEY = 'glol.sky.open'
  let folded = true
  function setFolded(on:boolean, remember = true) {
    folded = on; panel.classList.toggle('folded', on)
    fold.setAttribute('aria-expanded', String(!on))
    fold.setAttribute('aria-label', on?'展开时辰天气':'收起时辰天气'); fold.title = on?'展开时辰天气':'收起时辰天气'
    if(remember) try { localStorage.setItem(OPEN_KEY, on?'0':'1') } catch {}
  }
  fold.onclick = ()=>setFolded(!folded)
  let open = false
  try { open = localStorage.getItem(OPEN_KEY)==='1' } catch {}
  setFolded(!open, false)

  // Calibration state drives the 「全服 / 全服·本机」 badge only; the hour itself is read per frame.
  onWorldClock(state => {source = state.source; refresh()})

  function setAuto(on:boolean) {
    // Solo 单人模式下界面不显示时辰面板（IDOK-154）；时间仍然来自全服时钟。
    panel.hidden = on
    // Entering solo must not freeze whatever local preview the tour panel was showing.
    if(on && !anchored()) {goal = null; world = true; flowing = true}
    refresh()
  }
  setAuto(getPlayMode()==='solo'); onPlayMode(mode=>setAuto(mode==='solo'))

  const clock = {
    get hour(){return hour},
    /** A bare assignment is a local pin (harnesses do `clock.hour = h`); the world clock must not drag it back. */
    set hour(value:number){hour = value; world = false; goal = null; blendMs = MANUAL_BLEND_MS; refresh()},
    get weather(){return weather},
    set weather(value:Weather){weather = value; blendMs = MANUAL_BLEND_MS; refresh()},
    get flowing(){return flowing},
    set flowing(value:boolean){flowing = value; refresh()},
    get goal(){return goal},
    set goal(value:number|null){goal = value},
    get blendMs(){return blendMs},
    set blendMs(value:number){blendMs = value},
    /** true = following 全服 time; false = local preview (or a pinned capture anchor). */
    get world(){return world},
    set world(value:boolean){world = value; refresh()},
    /** True while connected/connecting to the multiplayer server — the panel is read-only then. */
    get linked(){return locked()},
    /** True when a capture anchor (`?time=` / `?verify` / `?weather=`) owns the clock. */
    get anchored(){return anchored()},
    /** 'server' = calibrated against the API clock, 'local' = offline fallback (still deterministic). */
    get source(){return source},
    rate:1/60,
    tick(dt:number){
      if(goal !== null) {
        // Travel forward through the day to the picked hour in ~1.5 s, so the sky sweeps rather than cuts.
        const ahead = ((goal-hour)%24+24)%24, stepH = Math.max(.02,ahead)*Math.min(1,dt*2.2)
        if(ahead<.02) {
          hour = goal; goal = null; flowing = false
          // A mood pick under multiplayer control (or after a status change slipped through) must not
          // strand the player on a private timeline.
          if(locked() && !anchored()) world = true
          blendMs = MANUAL_BLEND_MS
        } else {hour = (hour+Math.min(ahead,stepH))%24; blendMs = MANUAL_BLEND_MS}
        refresh()
      } else if(world) {
        // Advance at the canonical rate using the RAW dt (a 1–2 FPS device must not fall behind just
        // because its frames are long — IDOK-502 review), then pull toward the 全服 hour with a gain
        // based on a cap, so a stall can sweep fast but never apply the whole gap in one frame.
        const next = worldSnapshot()
        hour = (hour + dt*clock.rate) % 24
        let delta = ((next.hour - hour) % 24 + 24) % 24
        if(delta > 12) delta -= 24
        const gain = Math.min(MAX_GAIN, dt/CATCH_UP_S)
        hour = (hour + delta*gain + 24) % 24
        if(!weatherPinned) {
          if(weather !== next.weather) blendMs = WORLD_BLEND_MS
          weather = next.weather
        } else blendMs = MANUAL_BLEND_MS
        flowing = true
        // IDOK-502 review: only touch the DOM when the visible text actually changed — `tick` runs per
        // frame and blind refresh() calls (textContent/disabled/attributes) cost real time on phones.
        const text = label(hour)
        if(text !== shownHour || locked() !== lockedShown){shownHour = text; refresh()}
      } else if(flowing) {
        hour = (hour + dt*clock.rate) % 24
        blendMs = MANUAL_BLEND_MS
        const text = label(hour)
        if(text !== shownHour){shownHour = text; refresh()}
      }
    },
    set(value:number, next?:Weather) {
      hour = value
      if(next) weather = next
      // An explicit set is a local preview: it must not be yanked back to the 全服 hour a moment later.
      goal = null; world = false; flowing = false; blendMs = MANUAL_BLEND_MS; refresh()
    },
  }
  return clock
}
