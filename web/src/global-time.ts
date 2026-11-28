// 全服统一时钟客户端（IDOK-502）。
//
// 权威时间是服务端时钟：`GET /api/health` 带有 `now`（epoch ms）。客户端只用这一次往返估计
// 「服务端 epoch ↔ 本机单调时钟」的锚点，之后**只靠 performance.now() 外推**——完全不读系统
// 时钟，所以玩家改系统时间、系统时间自己跳变都不会让天色漂走。
//
// 采样不是"最后一次说了算"：保留最近若干个 (rtt, 偏移) 样本，取**最短 RTT** 的那条作为锚点。
// 一次 10 秒的弱网慢包只会在样本里排到末位，不会把之前准确的偏移毒化。
//
// 取不到服务端时间（离线、接口 404/503、老后端没有 `now`）时不报错：退回本机时钟走同一套
// 确定性映射（lib/world-time.ts），并把 `source` 标成 'local'，界面显示「全服·本机」。

import {worldTimeAt, type WorldWeather} from '../../lib/world-time'
import {mpEnabled} from './ui/mp-pref'
import {DEEP_LINK_KEYS} from './deeplink'

/** 两次自动校时的间隔。 */
const REFRESH_MS = 5 * 60_000
/** 保留最近多少个采样（取最短 RTT 的那条作锚点）。 */
const SAMPLE_KEEP = 5
/** 超过这个 RTT 的样本视为弱网毒样本，不参与锚点竞争。 */
const SLOW_SAMPLE_MS = 3_000
/** 锚点变动小于这个值就不打扰渲染。 */
const QUIET_MS = 400
/** 单次校时的超时：卡住的请求必须自己让出 `syncing`，否则后续校时永远复用同一个 Promise。 */
const CALIBRATE_TIMEOUT_MS = 8_000
/** 两次校时的最小间隔（防惊群）：任何触发源都要先过这道闸。 */
const MIN_GAP_MS = 15_000

interface Sample {
  /** 服务端 epoch（已按 rtt/2 补偿到响应处理完毕的时刻）。 */
  server: number
  /** 采样完毕时的单调时钟读数。 */
  mono: number
  rtt: number
}

let samples: Sample[] = []
let source: 'server' | 'local' = 'local'
let lastSampleAt = -Infinity
let lastAttemptAt = -Infinity
let syncing: Promise<boolean> | null = null
let timer = 0
let failures = 0
let lastFailureLog = -Infinity
const listeners = new Set<(state: ClockState) => void>()

/** 单调时钟；没有 `performance` 的环境（Node 测试）退回 Date.now。 */
const monotonic = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export interface ClockState {
  /** 估算出的服务端时刻（epoch ms）。 */
  now: number
  /** 'server' = 已对齐服务端；'local' = 兜底用本机时钟。 */
  source: 'server' | 'local'
  /** 当前锚点样本的往返（ms），未校过为 null。 */
  rttMs: number | null
  /** 连续失败的校时次数，便于排查「为什么一直是本机时间」。 */
  failures: number
  /** 当前世界时间快照。 */
  world: {hour: number; weather: WorldWeather; remainingMs: number}
}

/** 最早可用锚点：最短 RTT 的那条（相等取更近的）。 */
function anchor(): Sample | null {
  let best: Sample | null = null
  for(const sample of samples) {
    if(!best || sample.rtt < best.rtt || (sample.rtt === best.rtt && sample.mono > best.mono)) best = sample
  }
  return best
}

/**
 * 当前服务端 epoch。有锚点就完全用单调时钟外推；没有锚点才退回系统时钟（`source: 'local'`）。
 * 注意这里**刻意**不在有锚点时混用 Date.now：混用就等于把系统时钟的跳变重新引入天色。
 */
function serverNow() {
  const best = anchor()
  if(!best) return Date.now()
  return best.server + (monotonic() - best.mono)
}

const state = (): ClockState => {
  const now = serverNow()
  const best = anchor()
  return {now, source, rttMs: best ? best.rtt : null, failures, world: worldTimeAt(now)}
}

function emit() {
  const next = state()
  for (const listener of listeners) {
    try { listener(next) } catch { /* 单个订阅者出错不影响其它人 */ }
  }
}

export function onWorldClock(listener: (state: ClockState) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 当前服务端时刻（未校时就是本机时刻）。 */
export const worldNow = () => serverNow()
export const clockSource = () => source
export const worldSnapshot = () => worldTimeAt(serverNow())
/** 连续失败的校时次数（0 = 最近一次成功）。 */
export const clockFailures = () => failures

function logFailure(reason: string) {
  failures++
  // 限流日志：持续故障时每 60 秒最多一条，够定位「全站挂了」还是「这台机器网络差」。
  const now = monotonic()
  if(now - lastFailureLog < 60_000) return
  lastFailureLog = now
  console.warn(`[world-clock] 校时失败（连续 ${failures} 次）：${reason}`)
}

/** 带超时的 fetch：卡住的请求必须自己结束，否则 `syncing` 永远不清。 */
async function fetchWithTimeout(url: string, ms: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, {cache: 'no-store', credentials: 'same-origin', signal: controller.signal})
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 向服务端校时。并发调用共享同一个请求；失败返回 false 且不改动已有锚点。
 * `force` 只跳过冷却闸，不跳过"已有进行中的请求"。
 */
export function calibrateWorldClock({force = false} = {}): Promise<boolean> {
  if (syncing) return syncing
  const at = monotonic()
  if (!force && at - lastAttemptAt < MIN_GAP_MS) return Promise.resolve(false)
  lastAttemptAt = at
  syncing = (async () => {
    try {
      const sent = monotonic()
      const response = await fetchWithTimeout('/api/health', CALIBRATE_TIMEOUT_MS)
      if (!response.ok) { logFailure(`HTTP ${response.status}`); return false }
      const body = await response.json().catch(() => null) as {now?: unknown} | null
      const finished = monotonic()
      // 老后端只有 {ok:true}：没有 now 就不算校时成功，继续用本机时钟。
      if (!body || typeof body.now !== 'number' || !Number.isFinite(body.now)) {
        logFailure('响应缺少 now')
        return false
      }
      const rtt = Math.max(0, finished - sent)
      // 单程补偿：请求与响应各占一半往返。
      const sample: Sample = {server: body.now + rtt / 2, mono: finished, rtt}
      // 弱网毒样本不进锚点竞争，直接丢弃——宁可保留旧锚点也不要被一次 12 秒慢包带偏。
      if (rtt > SLOW_SAMPLE_MS) { logFailure(`RTT 过大 ${Math.round(rtt)}ms`); return false }
      const before = anchor()
      samples.push(sample)
      if (samples.length > SAMPLE_KEEP) samples.shift()
      const after = anchor()
      source = 'server'
      failures = 0
      lastSampleAt = monotonic()
      // 只有锚点真的动了才通知订阅者，避免每次采样都刷一遍面板。
      if (!before || Math.abs(after!.server - before.server) >= QUIET_MS) emit()
      return true
    } catch (error) {
      logFailure(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      syncing = null
    }
  })()
  return syncing
}

function schedule() {
  if (timer) return
  timer = window.setInterval(() => {
    if (document.visibilityState === 'hidden') return
    void calibrateWorldClock()
  }, REFRESH_MS)
}

/**
 * 是否该在这条 URL 上自动校时。
 * - 裸 `?verify`（没有 `?worldtime=1`）：**永远不校时**，截图门禁可复现且不打任何接口，
 *   与 `localStorage['glol.mp']` 无关（旧实现会因 mp 偏好泄漏一次请求）。
 * - 其余：一律校时。包括 `?mode=walk` 这类深链——玩家之后在游戏里开联机也要能对齐。
 */
export function shouldCalibrate(params: URLSearchParams) {
  if (params.has('verify') && !params.has('worldtime')) return false
  return true
}

/**
 * 装上自动校时。首次进入校一次；联机**从非 online 跃迁到 online** 时再校一次；
 * 回到前台校一次；平时每 5 分钟一次。
 *
 * 监听器无条件挂载（除了裸 `?verify`），所以深链进城后再开联机也能校时。
 */
export function installWorldClock(params: URLSearchParams) {
  if (!shouldCalibrate(params)) return
  schedule()
  let previousState = 'off'
  window.addEventListener('glol:mp-status', event => {
    const next = (event as CustomEvent<{state?: string}>).detail?.state ?? 'off'
    const wasOnline = previousState === 'online'
    previousState = next
    // 关键：`net.ts` 每次收到在线人数广播都会重发 state:'online'，若不加跃迁判断，
    // 任意一人上下线就会让全服所有客户端一起打 /api/health（惊群）。
    if (next === 'online' && !wasOnline) void calibrateWorldClock({force: true})
  })
  document.addEventListener('visibilitychange', () => {
    // 阻塞 60 秒（timeout 8s）的后台恢复：回来时强制校一次，不必等 5 分钟定时器。
    if (document.visibilityState === 'visible' && monotonic() - lastSampleAt > 60_000) void calibrateWorldClock({force: true})
  })
  void calibrateWorldClock({force: true})
}

/** 联机当前是否打开（面板锁定的判定来源之一；`sky.ts` 用 mp-status 的实际状态）。 */
export const multiplayerEnabled = () => mpEnabled()
/** 供调试与被其它模块判断"这条链接是否应该跟全服时间"。 */
export const isDeepLinkUrl = (params: URLSearchParams) => DEEP_LINK_KEYS.some(key => params.has(key))
