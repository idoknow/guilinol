import {label, type Weather} from '../look/time'
import {getPlayMode, onPlayMode} from '../game/play-mode'

// 时辰 / 天气 panel (top-left, under the stats line). Time flows by default (1 game hour per real
// minute); ?time=6.6 pins the hour, ?weather=mist|rain picks weather, ?flow=0 pauses.
// Solo (IDOK-154): no panel — time always flows and the weather rotates by itself, easing in slowly.
const moods:[string,number][] = [['晨',6.6],['午',12.5],['昏',18.1],['夜',21.5]]
const skies:[string,Weather][] = [['晴','clear'],['雾','mist'],['雨','rain']]
export function skyClock(params:URLSearchParams) {
  const pinned = params.get('time'), start = Number(pinned ?? 10)
  const clock = {hour:Number.isFinite(start)?start:10, weather:(['clear','mist','rain'].includes(params.get('weather')??'')?params.get('weather'):'clear') as Weather,
    flowing:!pinned&&params.get('flow')!=='0', rate:1/60, goal:null as number|null,
    /** ms time constant for easing into a new weather; slow while the weather changes by itself. */
    blendMs:1200}
  const weatherPinned = params.has('weather'), flowPinned = !!pinned||params.get('flow')==='0'
  let auto = false, nextChange = 0, autoWeather:Weather|null = null
  const panel = document.createElement('div'); panel.className = 'sky-ui'
  const time = document.createElement('span'); time.className = 'sky-time'
  const flow = document.createElement('button'); flow.className = 'sky-flow'
  const fold = document.createElement('button'); fold.className = 'sky-fold'
  const row = (items:[string,unknown][], pick:(value:never)=>void, active:(value:never)=>boolean)=>{
    const group = document.createElement('span'); group.className = 'sky-group'
    const buttons = items.map(([text,value])=>{const b = document.createElement('button'); b.textContent = text
      b.onclick = ()=>{pick(value as never); refresh()}; group.append(b); return [b,value] as const})
    return {group,refresh(){for(const [b,value] of buttons) b.classList.toggle('on',active(value as never))}}
  }
  const hours = row(moods,(h:number)=>{clock.goal = h},(h:number)=>{const d=Math.abs(clock.hour-h)%24;return Math.min(d,24-d)<1.25})
  const weathers = row(skies,(w:Weather)=>{clock.weather = w; window.dispatchEvent(new CustomEvent('sky:weather',{detail:w}))},(w:Weather)=>clock.weather===w)
  flow.onclick = ()=>{clock.flowing = !clock.flowing; refresh()}
  panel.append(time,hours.group,weathers.group,flow,fold); document.body.append(panel)
  function refresh(){hours.refresh(); weathers.refresh(); flow.textContent = clock.flowing?'❚❚':'▶'
    flow.setAttribute('aria-label',clock.flowing?'暂停时间':'时间流转'); time.textContent = label(clock.hour)}
  refresh()
  // IDOK-158: on a phone the panel eats a third of the top edge, which matters most in landscape
  // where the view is the point. Fold it down to just the clock; remember the choice so rotating
  // back and forth doesn't undo it (stored per device, ignored when storage is blocked).
  // The chevron is drawn in CSS (hud.css .sky-fold::before) rather than set as a ‹/› glyph: at 20px and
  // 55% opacity that glyph read as decoration and people never found the control.
  const FOLD_KEY = 'glol.skyFolded'
  let folded = false
  function setFolded(on:boolean) {
    folded = on; panel.classList.toggle('folded', on)
    fold.setAttribute('aria-expanded', String(!on))
    fold.setAttribute('aria-label', on?'展开时辰天气':'收起时辰天气'); fold.title = on?'展开时辰天气':'收起时辰天气'
    try { localStorage.setItem(FOLD_KEY, on?'1':'0') } catch {}
  }
  fold.onclick = ()=>setFolded(!folded)
  try { setFolded(localStorage.getItem(FOLD_KEY)==='1') } catch { setFolded(false) }
  // Next weather: mostly clear, morning mist, the odd shower; never the same weather twice in a row.
  function nextWeather(hour:number):Weather {
    const w:[Weather,number][] = [['clear',.62],['mist',hour>=4.5&&hour<9.5?.45:.12],['rain',.22]]
    const pool = w.filter(([v])=>v!==clock.weather), sum = pool.reduce((a,[,n])=>a+n,0)
    let r = Math.random()*sum
    for(const [v,n] of pool) if((r -= n)<0) return v
    return 'clear'
  }
  // Clear spells last 3–6 game hours, mist/rain 1.5–3 (1 game hour = 1 real minute).
  const spell = ()=>clock.weather==='clear'?3+Math.random()*3:1.5+Math.random()*1.5
  function setAuto(on:boolean) {
    auto = on; panel.hidden = on; autoWeather = null
    if(on) {clock.goal = null; if(!flowPinned) clock.flowing = true; nextChange = spell()}
  }
  setAuto(getPlayMode()==='solo'); onPlayMode(mode=>setAuto(mode==='solo'))
  let shown = ''
  return Object.assign(clock,{tick(dt:number){
    if(clock.goal!==null) {
      // Travel forward through the day to the picked hour in ~1.5 s, so the sky sweeps rather than cuts.
      const ahead = ((clock.goal-clock.hour)%24+24)%24, stepH = Math.max(.02,ahead)*Math.min(1,dt*2.2)
      if(ahead<.02) {clock.hour = clock.goal; clock.goal = null} else clock.hour = (clock.hour+Math.min(ahead,stepH))%24
    } else if(clock.flowing) clock.hour = (clock.hour+dt*clock.rate)%24
    if(auto&&!weatherPinned&&clock.flowing&&(nextChange -= dt*clock.rate)<=0) {clock.weather = autoWeather = nextWeather(clock.hour); nextChange = spell()}
    const state = `${clock.hour.toFixed(2)}|${clock.weather}`
    if(state!==shown){shown = state; refresh(); window.dispatchEvent(new CustomEvent('sky:weather',{detail:clock.weather}))}
    // Self-driven changes drift in over ~20 s; anything picked by hand (photo mode) still switches in ~1 s.
    clock.blendMs = auto&&clock.weather===autoWeather?20000:1200
  },set(hour:number,weather?:Weather){
    clock.hour = hour; if(weather) clock.weather = weather; clock.goal = null; refresh()
    window.dispatchEvent(new CustomEvent('sky:weather',{detail:clock.weather}))
  }})
}
