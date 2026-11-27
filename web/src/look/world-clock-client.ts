import {
  worldHourAt, worldTimePayload, worldWeatherAt,
  sanitizeMapping, type Weather, type WeatherMix, type WorldClockMapping, type WorldTimePayload,
} from '../../../lib/world-clock.ts'

// IDOK-502 全服时间（客户端）。
//
// 分工：
// - 本模块只管「权威 epoch」：向 `GET /api/time` 取服务端时刻，用往返延迟估出单程偏差，
//   把服务端时间记成本地单调时钟上的偏移量，之后只靠 `performance.now()` 就能算出当前
//   服务端 epoch —— 完全不读本机系统时钟，所以玩家改系统时间不影响天色。
// - 多次采样取最短 RTT，避免一次慢包把偏移量带偏；偏差大时（首次接入 / 休眠唤醒 / 断线
//   重连）立刻重采，平时每 5 分钟刷新一次，顺带吸收时钟漂移。
// - 离线 / 单机兜底：没有服务端时用本机时钟套同一套映射，并把 `source` 标成 `local`，
//   界面明示「本机」，因此「离线也能玩」与「在线的天色统一」并不冲突。
//
// 世界时辰与天气是 epoch 的纯函数（`lib/world-clock.ts`），由 `ui/sky.ts` 每帧读走，
// 所以联机协议里不需要额外广播时间，重连后自然收敛到同一个天色。

export type ClockSource = 'server' | 'local'

export interface ClockState {
  /** 当前权威来源；`local` = 离线兜底。 */
  source: ClockSource
  /** 是否拿到过至少一次服务端采样。 */
  synced: boolean
  /** 最近一次采样的往返延迟（ms）。 */
  rttMs: number
  /** 服务端 epoch 与本地单调时钟的偏移（ms）；`local` 时不使用。 */
  serverOffsetMs: number
}

export interface WorldClockClient {
  readonly state: ClockState
  readonly mapping: WorldClockMapping
  /** 当前服务端（或本机兜底）epoch，毫秒。 */
  now(): number
  /** 权威时辰（0–24），纯函数结果，未做平滑。 */
  authoritativeHour(): number
  /** 权威天气与乘数。 */
  weather(): {weather: Weather; mix: WeatherMix}
  /** 同步一次；并发调用会合并。返回是否成功。 */
  sync(force?: boolean): Promise<boolean>
  /** 启动周期同步（每 5 分钟 + 可见性事件）。 */
  start(): void
  /** 停止周期同步。 */
  stop(): void
  /** 是否处于离线兜底。 */
  offline(): boolean
}

const SYNC_INTERVAL_MS = 5 * 60_000
/** 每次同步的采样数：取最短 RTT 的那次，3 次足够滤掉偶发慢包。 */
const SAMPLE_COUNT = 3
const MAX_SAMPLES = 9
const ENDPOINT = '/api/time'

/** 单调时钟；无 `performance` 的环境（Node 测试）退回 `Date.now`。 */
const monotonic = () => typeof performance !== 'undefined' ? performance.now() : Date.now()

export function createWorldClock(fetcher: typeof fetch = (...args) => fetch(...args)): WorldClockClient {
  // 内置映射先兜底，拿到服务端下发的映射后覆盖（服务端是唯一真源）。
  let mapping:WorldClockMapping = sanitizeMapping(worldTimePayload(Date.now()).mapping)
  // 每个样本记下「本地单调时刻 ↔ 服务端 epoch」的对应，取最短 RTT 的那条。
  const samples:{at:number; server:number; rtt:number}[] = []
  let syncedAt = -Infinity
  let inflight:Promise<boolean>|null = null
  let timer = 0
  let started = false
  const state:ClockState = {source:'local', synced:false, rttMs:0, serverOffsetMs:0}

  function bestSample() {
    if(!samples.length) return null
    return samples.reduce((best, next) => next.rtt < best.rtt ? next : best)
  }

  function serverNow() {
    const best = bestSample()
    // 最短 RTT 的一半当作单程延迟，把采样点还原到服务端取时刻的瞬间。
    return best ? best.server + (monotonic() - best.at) : Date.now()
  }

  async function sampleOnce() {
    const before = monotonic()
    const response = await fetcher(ENDPOINT, {method:'GET', cache:'no-store', credentials:'same-origin'})
    if(!response.ok) throw Error(`time endpoint ${response.status}`)
    const payload = await response.json() as WorldTimePayload
    const after = monotonic()
    if(typeof payload?.serverTime !== 'number' || !Number.isFinite(payload.serverTime)) throw Error('bad time payload')
    const rtt = after - before
    samples.push({at:before + rtt/2, server:payload.serverTime, rtt})
    if(samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES)
    mapping = sanitizeMapping(payload.mapping)
    const best = bestSample()!
    state.source = 'server'
    state.synced = true
    state.rttMs = best.rtt
    state.serverOffsetMs = best.server - monotonic()
    syncedAt = monotonic()
  }

  async function sync(force = false) {
    if(inflight) return inflight
    if(!force && samples.length && monotonic() - syncedAt < 60_000) return true
    inflight = (async () => {
      try {
        for(let attempt = 0; attempt < SAMPLE_COUNT; attempt++) await sampleOnce()
        return true
      } catch {
        // 拿不到服务端：保留已有样本继续外推；一次都没成功过才退回本机时钟。
        if(!samples.length) { state.source = 'local'; state.synced = false }
        return false
      } finally { inflight = null }
    })()
    return inflight
  }

  const now = () => state.source === 'server' && samples.length ? serverNow() : Date.now()
  const authoritativeHour = () => worldHourAt(now(), mapping)
  function weather() {
    const snapshot = worldWeatherAt(now(), mapping)
    return {weather:snapshot.weather, mix:snapshot.mix}
  }

  const onVisible = () => { if(document.visibilityState === 'visible') void sync(true) }
  const onOnline = () => { void sync(true) }
  const onPageShow = () => { void sync(true) }

  function start() {
    if(started) return
    started = true
    void sync(true)
    timer = window.setInterval(() => { void sync() }, SYNC_INTERVAL_MS)
    // 休眠唤醒 / 切回前台时本地单调时钟会「冻住」，必须立刻重采，否则天色会落后一大截。
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('pageshow', onPageShow)
  }

  function stop() {
    if(!started) return
    started = false
    clearInterval(timer); timer = 0
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('pageshow', onPageShow)
  }

  return {state, get mapping(){return mapping}, now, authoritativeHour, weather, sync, start, stop, offline:() => state.source === 'local'}
}

/** 全服时间客户端：模块单例，`ui/sky.ts` 与联机层共用同一个。 */
let shared:WorldClockClient|undefined
export function worldClockClient() {
  shared ??= createWorldClock()
  return shared
}
