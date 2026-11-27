// IDOK-502 全服时间：服务端权威时间 + 确定性世界时间映射。
//
// 设计要点
// - 权威源只有一个：服务端时钟（`GET /api/time` 的 `serverTime`，epoch 毫秒）。
// - 世界时间不是「各自累计」的，而是 epoch 的纯函数：所有客户端拿到同一个 epoch 就必然
//   算出同一个时辰、同一段天气，因此不需要在联机协议里逐帧广播时间。
// - 映射参数随接口一起下发，客户端不写死常量；以后调快慢只改服务端常量，旧客户端也一致。
// - 单机 / 离线：用本地时钟套同一个映射（或上次同步的 epoch 继续外推），行为明确且可预期。
//
export interface WorldClockMapping {
  /** 映射原点：世界时间在该 epoch 上恰好等于 anchorHour。 */
  anchorMs:number
  /** 映射原点对应的时辰（0–24，小数表示分钟）。 */
  anchorHour:number
  /** 每个现实毫秒推进的游戏小时数。 */
  hoursPerMs:number
}

// 节奏沿用 M3 定稿：1 现实分钟 = 1 游戏小时（一天 24 现实分钟）。
// 映射原点取一个固定 epoch（2026-01-01T00:00Z = 10:00 桂林清晨），于是世界时辰完全由 epoch
// 决定：重启、换设备、断线重连都不会重新计时，也不会因为服务端重启而「回到上午」。
export const WORLD_ANCHOR_MS = Date.UTC(2026, 0, 1)
export const WORLD_ANCHOR_HOUR = 10
/** 1 游戏小时 / 现实分钟。 */
export const GAME_HOURS_PER_MS = 1/60_000

export const worldClock:WorldClockMapping = {anchorMs:WORLD_ANCHOR_MS, anchorHour:WORLD_ANCHOR_HOUR, hoursPerMs:GAME_HOURS_PER_MS}

export const GAME_DAY_HOURS = 24

export type Weather = 'clear'|'mist'|'rain'

/** 天气对时辰情绪的乘数；`look/time.ts` 的插值直接用它。 */
export interface WeatherMix {
  fog:number; boost:number; grey:number; dim:number; clouds:number; rain:number
}
export const weatherFx:Record<Weather,WeatherMix> = {
  clear:{fog:1,boost:0,grey:0,dim:1,clouds:0,rain:0},
  mist:{fog:.42,boost:2.2,grey:.45,dim:.72,clouds:.15,rain:0},
  rain:{fog:.5,boost:1.2,grey:.62,dim:.5,clouds:.55,rain:1},
}

/** 一次天气切换的过渡时长，单位游戏小时：20 现实秒。 */
export const WEATHER_TRANSITION_HOURS = 20/60

export function normalizeHour(hour:number) {
  return ((hour % GAME_DAY_HOURS) + GAME_DAY_HOURS) % GAME_DAY_HOURS
}

/** epoch（毫秒）→ 全服时辰，纯函数，任意客户端结果相同。 */
export function worldHourAt(epochMs:number, mapping:WorldClockMapping = worldClock) {
  return normalizeHour(mapping.anchorHour + (epochMs - mapping.anchorMs) * mapping.hoursPerMs)
}

/** `worldHourAt` 的逆：给定「游戏时间轴上的小时」（可以超过 24）返回对应 epoch。 */
export function worldEpochAt(gameHours:number, mapping:WorldClockMapping = worldClock) {
  return mapping.anchorMs + (gameHours - mapping.anchorHour) / mapping.hoursPerMs
}

/** 两个时辰之间的最短有符号差（-12…12），跨零点也不会走反方向。 */
export function shortestHourDelta(from:number, to:number) {
  const delta = normalizeHour(to - from)
  return delta > GAME_DAY_HOURS/2 ? delta - GAME_DAY_HOURS : delta
}

export function advanceHour(hour:number, delta:number) {
  return normalizeHour(hour + delta)
}

/**
 * 平滑校准：把本地渲染时钟往权威时辰挪一步，绝不直接赋值。
 * 修正量按「剩余差的固定比例」给（下限 .02 小时），所以任何时候都不会跳变，
 * 大偏差（刚接入联机 / 退出拍照模式）会在一两秒内扫过去，小偏差几乎瞬间收敛。
 */
export function calibrateHour(current:number, target:number, dt:number, rate = 2.2, floor = .02) {
  const delta = shortestHourDelta(current, target)
  if(Math.abs(delta) <= 1e-4) return normalizeHour(target)
  const step = Math.max(floor, Math.abs(delta)) * Math.min(1, Math.max(0, dt) * rate)
  return advanceHour(current, Math.sign(delta) * Math.min(Math.abs(delta), step))
}

// ---- 确定性天气 ----------------------------------------------------------
// 天气按「游戏日」切成 24 小时的周期，每个周期的天气段由周期序号派生的伪随机数决定：
// 段长与权重沿用 sky.ts 的手感（晴 3–6 h，雾/雨 1.5–3 h，晨间多雾，不连续重复同一种）。
// 这样任意时刻的天气是 epoch 的纯函数，所有客户端同时切换，无需同步流量。

export interface WeatherSpell {
  /** 周期内的起始游戏小时，0–24。 */
  start:number
  /** 段长，游戏小时。 */
  length:number
  weather:Weather
}

export interface WorldWeather {
  /** 本段目标天气（UI 与后续逻辑用它）。 */
  weather:Weather
  /** 过渡中的天气乘数；同一 epoch 上所有客户端算出的值完全一致。 */
  mix:WeatherMix
  /** 0 = 上一段乘数，1 = 本段乘数。 */
  progress:number
  /** 本段开始时的游戏小时（周期内 0–24）。 */
  spellStart:number
}

/** 确定性 32 位伪随机数发生器（mulberry32）。 */
function mulberry32(seed:number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pickWeather(random:()=>number, hourOfDay:number, previous:Weather|null):Weather {
  const table:[Weather,number][] = [['clear',.62],['mist',hourOfDay >= 4.5 && hourOfDay < 9.5 ? .45 : .12],['rain',.22]]
  const pool = table.filter(([value])=>value !== previous)
  const sum = pool.reduce((total,[,weight])=>total+weight,0)
  let roll = random()*sum
  for(const [value,weight] of pool) if((roll -= weight) < 0) return value
  return 'clear'
}

const spellLength = (weather:Weather, random:()=>number) => weather === 'clear' ? 3 + random()*3 : 1.5 + random()*1.5

const schedules = new Map<number,WeatherSpell[]>()

/** 某个游戏日的天气排布；结果只取决于周期序号，跨端一致。 */
export function weatherSchedule(cycle:number):WeatherSpell[] {
  const cached = schedules.get(cycle)
  if(cached) return cached
  const random = mulberry32((cycle*2654435761) >>> 0)
  const spells:WeatherSpell[] = []
  let start = 0, previous:Weather|null = null
  // 段长有下限，循环必然终止；上限兜底防止浮点误差造成死循环。
  while(start < GAME_DAY_HOURS - 1e-9 && spells.length < 32) {
    const weather = pickWeather(random, normalizeHour(start), previous)
    const length = Math.min(spellLength(weather, random), GAME_DAY_HOURS - start)
    spells.push({start, length, weather})
    start += length
    previous = weather
  }
  if(!spells.length) spells.push({start:0, length:GAME_DAY_HOURS, weather:'clear'})
  if(schedules.size > 512) schedules.clear()
  schedules.set(cycle, spells)
  return spells
}

function mixLerp(from:WeatherMix, to:WeatherMix, t:number):WeatherMix {
  // 端点必须精确回到表里的值：过渡结束时乘数要与 weatherFx 逐位相等，否则「同一 epoch
  // 算出同一乘数」会被浮点误差破坏（1 + (0.42-1)*1 !== 0.42）。
  if(t <= 0) return {...from}
  if(t >= 1) return {...to}
  const out = {...from}
  for(const key of Object.keys(to) as (keyof WeatherMix)[]) out[key] = from[key] + (to[key]-from[key])*t
  return out
}

/** epoch（毫秒）→ 全服天气（确定性，含过渡插值）。 */
export function worldWeatherAt(epochMs:number, mapping:WorldClockMapping = worldClock):WorldWeather {
  const gameHours = mapping.anchorHour + (epochMs - mapping.anchorMs) * mapping.hoursPerMs
  const cycle = Math.floor(gameHours / GAME_DAY_HOURS)
  const local = gameHours - cycle*GAME_DAY_HOURS
  const schedule = weatherSchedule(cycle)
  let index = schedule.findIndex(spell => local < spell.start + spell.length)
  if(index < 0) index = schedule.length - 1
  const spell = schedule[index]
  // 跨日的那一段要跟上一游戏日的最后一段衔接，否则每天零点会硬切。
  const previous = index > 0 ? schedule[index-1].weather : weatherSchedule(cycle-1).at(-1)!.weather
  const progress = Math.min(1, Math.max(0, (local - spell.start) / WEATHER_TRANSITION_HOURS))
  const eased = progress*progress*(3 - 2*progress)
  return {
    weather: spell.weather,
    mix: mixLerp(weatherFx[previous], weatherFx[spell.weather], eased),
    progress,
    spellStart: spell.start,
  }
}

// ---- 接口载荷 ------------------------------------------------------------

export interface WorldTimePayload {
  /** 服务端此刻（epoch 毫秒）。客户端据此对齐，不看本地时钟。 */
  serverTime:number
  mapping:WorldClockMapping
  hour:number
  weather:Weather
  /** 协议版本：新增字段不升版，语义变化才升。 */
  proto:number
}

/** `GET /api/time` 的响应体；服务端与客户端共用，避免两份映射常量走偏。 */
export function worldTimePayload(now:number):WorldTimePayload {
  return {serverTime:now, mapping:worldClock, hour:worldHourAt(now), weather:worldWeatherAt(now).weather, proto:1}
}

/** 校验客户端拿到（或被篡改）的映射；不合法就退回内置常量。 */
export function sanitizeMapping(value:unknown):WorldClockMapping {
  if(!value || typeof value !== 'object' || Array.isArray(value)) return worldClock
  const raw = value as Record<string,unknown>
  const anchorMs = Number(raw.anchorMs), anchorHour = Number(raw.anchorHour), hoursPerMs = Number(raw.hoursPerMs)
  if(!Number.isFinite(anchorMs) || !Number.isFinite(anchorHour) || !Number.isFinite(hoursPerMs) || hoursPerMs <= 0) return worldClock
  // 一天不得短于 1 现实分钟、长于 30 现实天，挡住离谱值。
  if(hoursPerMs > 1/60_000 || hoursPerMs < GAME_DAY_HOURS/(30*86_400_000)) return worldClock
  return {anchorMs, anchorHour, hoursPerMs}
}
