import {label, type Weather} from '../look/time'
import {getPlayMode, onPlayMode} from '../game/play-mode'
import {worldClockClient, type WorldClockClient} from '../look/world-clock-client'
import {calibrateHour, normalizeHour, shortestHourDelta, type WeatherMix} from '../../../lib/world-clock.ts'

// 时辰 / 天气 panel (top-left, under the stats line).
//
// IDOK-502 全服统一时间：时辰与天气不再是「每个客户端自己累计 / 自己抽签」的状态，而是服务端
// epoch 的纯函数（`lib/world-clock.ts`）。这个时钟负责三件事：
//   1. 每帧把渲染用时辰平滑地追到权威时辰（`calibrateHour`，只做比例补偿，永不跳变）；
//   2. 保留 `?time=` / `?flow=0` / 面板按钮 / 拍照模式这些人工钉住手段；
//   3. 明示当前状态：全服 / 本机（离线兜底）/ 固定（人工）。
//
// 人工钉住 = 离开全服时间：`hour` / `goal` / `set()` / 天气按钮任一被写，就进入 `pinned`。
// 联机在线时面板锁定，避免单方面改全服天色（`?verify` 例外，验收脚本要能钉时辰）。
const moods:[string,number][] = [['晨',6.6],['午',12.5],['昏',18.1],['夜',21.5]]
const skies:[string,Weather][] = [['晴','clear'],['雾','mist'],['雨','rain']]

export function skyClock(params:URLSearchParams, world:WorldClockClient = worldClockClient()) {
  const verify = params.has('verify')
  const hourParam = params.get('time')
  const weatherParam = params.get('weather')
  const pinnedHour = hourParam !== null && Number.isFinite(Number(hourParam)) ? normalizeHour(Number(hourParam)) : null
  const pausedByUrl = params.get('flow') === '0'
  const urlWeather = (['clear','mist','rain'].includes(weatherParam ?? '') ? weatherParam : null) as Weather|null

  // ---- 可观察状态 --------------------------------------------------------
  let hour = pinnedHour ?? world.authoritativeHour()
  let weather:Weather = urlWeather ?? 'clear'
  let flowing = !pinnedHour && !pausedByUrl
  let goal:number|null = null
  let blendMs = 1200
  /** 人工钉住时辰；`true` 时不再跟随全服权威时辰。 */
  let manual = pinnedHour !== null || pausedByUrl
  let correction = 0
  let mix:WeatherMix|null = null
  let netOnline = false

  const panel = document.createElement('div'); panel.className = 'sky-ui'
  const time = document.createElement('span'); time.className = 'sky-time'
  const badge = document.createElement('span'); badge.className = 'sky-sync'
  const flowButton = document.createElement('button'); flowButton.className = 'sky-flow'
  const fold = document.createElement('button'); fold.className = 'sky-fold'
  const row = (items:[string,unknown][], pick:(value:never)=>void, active:(value:never)=>boolean)=>{
    const group = document.createElement('span'); group.className = 'sky-group'
    const buttons = items.map(([text,value])=>{const b = document.createElement('button'); b.textContent = text
      b.onclick = ()=>{if(!canTune())return; pick(value as never); refresh()}; group.append(b); return [b,value] as const})
    return {group,refresh(){for(const [b,value] of buttons) b.classList.toggle('on',active(value as never))}}
  }
  const hours = row(moods,
    (h:number)=>{manual = true; flowing = false; goal = h},
    (h:number)=>Math.abs(shortestHourDelta(hour, h)) < 1.25)
  const weathers = row(skies,
    (w:Weather)=>{manual = true; weather = w},
    (w:Weather)=>weather === w)
  flowButton.onclick = ()=>{
    if(!canTune()) return
    flowing = !flowing
    manual = !flowing
    if(manual) goal = null
    refresh()
  }
  panel.append(time,badge,hours.group,weathers.group,flowButton,fold); document.body.append(panel)

  /** 联机在线时不允许单方面改全服天色（`?verify` 例外）。 */
  function canTune() { return verify || !netOnline }
  function refresh(){
    hours.refresh(); weathers.refresh()
    flowButton.textContent = flowing ? '❚❚' : '▶'
    flowButton.setAttribute('aria-label', flowing ? '暂停时间' : '时间流转')
    time.textContent = label(hour)
    // 「全服」= 跟随服务端权威时间；「本机」= 离线兜底；「固定」= 人工钉住。三态必须可见。
    const state = manual ? '固定' : world.offline() ? '本机' : '全服'
    badge.textContent = state; badge.dataset.state = state
    panel.classList.toggle('manual', manual)
    panel.classList.toggle('locked', !canTune())
  }
  // IDOK-158/468：默认折叠，只记住「展开」。
  const OPEN_KEY = 'glol.sky.open'
  let folded = true
  function setFolded(on:boolean, remember = true) {
    folded = on; panel.classList.toggle('folded', on)
    fold.setAttribute('aria-expanded', String(!on))
    fold.setAttribute('aria-label', on?'展开时辰天气':'收起时辰天气'); fold.title = on?'展开时辰天气':'收起时辰天气'
    if (remember) try { localStorage.setItem(OPEN_KEY, on?'0':'1') } catch {}
  }
  fold.onclick = ()=>setFolded(!folded)
  let open = false
  try { open = localStorage.getItem(OPEN_KEY)==='1' } catch {}
  setFolded(!open, false)
  // 单人（solo）不显示面板：天色已经全服统一，不需要玩家自己调。
  function setAuto(on:boolean) { panel.hidden = on }
  setAuto(getPlayMode()==='solo'); onPlayMode(mode=>setAuto(mode==='solo'))
  // 联机状态变化：在线时重采服务端时间（断线重连 / 休眠唤醒后一次收干净偏差）。
  addEventListener('glol:mp-status', event=>{
    const online = (event as CustomEvent<{state:string}>).detail?.state === 'online'
    if(online !== netOnline) { netOnline = online; refresh() }
    if(online) void world.sync(true)
  })

  let shown = ''
  let shownManual = manual
  /** 采纳权威天气；时辰交给 `tick` 的比例校准，绝不在这里硬赋值（否则慢首采会闪一下）。 */
  function applyAuthority() {
    if(manual) return
    const snapshot = world.weather(); weather = snapshot.weather; mix = snapshot.mix
  }
  world.start()
  void world.sync(true).then(refresh)
  refresh()

  return {
    get hour(){ return hour },
    // 直写时辰 = 明确想停在那一刻：同时停下「继续流转」并进入「固定」，否则下一帧就飘走了。
    set hour(value:number){ hour = normalizeHour(value); manual = true; flowing = false; correction = 0; refresh() },
    get weather(){ return weather },
    set weather(value:Weather){ weather = value; refresh() },
    get flowing(){ return flowing },
    set flowing(value:boolean){ flowing = value; if(value) manual = false },
    get rate(){ return 1/60 },
    get goal(){ return goal },
    set goal(value:number|null){ goal = value; if(value !== null) manual = true; refresh() },
    get blendMs(){ return blendMs },
    set blendMs(value:number){ blendMs = value },
    /** 全服确定性天气的乘数；`null` = 人工钉住，主循环走平滑过渡。 */
    get mix():WeatherMix|null { return manual ? null : mix },
    /** 最近一帧的时辰修正量（小时），用于断言「校准无跳变」。 */
    get correction(){ return correction },
    /** 全服时间客户端（调试 / 验收探针）。 */
    world,
    get manual(){ return manual },
    /** 'server' 全服 / 'local' 离线兜底 / 'pinned' 人工固定。 */
    get source(){ return manual ? 'pinned' : world.offline() ? 'local' : 'server' },
    /** 恢复跟随全服时间（退出人工钉住）。 */
    follow(){
      manual = false; goal = null; flowing = true
      applyAuthority(); refresh()
    },    tick(dt:number){
      if(goal !== null) {
        // 人工跳时辰：向前扫过一天，天空连续而不是硬切。
        const ahead = ((goal-hour)%24+24)%24, stepH = Math.max(.02,ahead)*Math.min(1,dt*2.2)
        if(ahead < .02) {hour = goal; goal = null} else hour = (hour+Math.min(ahead,stepH))%24
        correction = 0
      } else if(!manual) {
        // 跟随权威时辰：只做比例校准，任何偏差都平滑收敛，绝不赋值跳变。
        const next = calibrateHour(hour, world.authoritativeHour(), dt)
        correction = shortestHourDelta(hour, next)
        hour = next
        const snapshot = world.weather(); weather = snapshot.weather; mix = snapshot.mix
      } else if(flowing) {
        // 人工「继续流转」：1 现实分钟 = 1 游戏小时，与全服同步脱钩。
        hour = (hour+dt/60)%24
        correction = 0
      } else correction = 0
      const text = label(hour)
      if(text !== shown || manual !== shownManual) { shown = text; shownManual = manual; refresh() }
    },
    set(value:number, nextWeather?:Weather){
      manual = true; flowing = false; goal = null
      hour = normalizeHour(value); correction = 0
      if(nextWeather) weather = nextWeather
      refresh()
    },
  }
}
