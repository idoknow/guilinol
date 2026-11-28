// 全服统一时钟客户端（IDOK-502）。
//
// 权威时间是服务端时钟：`GET /api/health` 带有 `now`（epoch ms）。客户端只用这一次往返估计
// `serverNow - localNow` 的偏移，并在之后用本地单调时钟推进；每次联机上线、断线重连成功、
// 以及每 5 分钟各再校一次，把设备时钟漂移收回来。
//
// 取不到服务端时间（离线、接口 404、单机模式没连过网）时不要报错：直接退回本机时钟走同一套
// 确定性映射（lib/world-time.ts），并如实把 `source` 标成 'local'，方便排查"为什么我和别人
// 天色不一样"。
//
// 注意：这里只解决"现在几点"，不决定"几点该是什么颜色"——那是 look/time.ts 的职责。

import {worldTimeAt, type WorldWeather} from '../../lib/world-time'
import {mpEnabled} from './ui/mp-pref'
import {DEEP_LINK_KEYS} from './deeplink'

/** 两次自动校时的间隔。 */
const REFRESH_MS = 5 * 60_000
/** 保留最近多少个采样。 */
const SAMPLE_KEEP = 6
/** 偏移变化小于这个值就不打扰渲染。 */
const QUIET_MS = 400

let offsetMs = 0
let source: 'server' | 'local' = 'local'
let lastSampleAt = 0
let syncing: Promise<boolean> | null = null
let timer = 0
const samples: number[] = []
const listeners = new Set<(state: ClockState) => void>()

export interface ClockState {
  /** 估算出的服务端时刻（epoch ms）。 */
  now: number
  /** 'server' = 已对齐服务端；'local' = 兜底用本机时钟。 */
  source: 'server' | 'local'
  /** 最近一次成功校时的采样往返（ms），未校过为 null。 */
  rttMs: number | null
  /** 当前世界时间快照。 */
  world: {hour: number; weather: WorldWeather; remainingMs: number}
}

const state = (): ClockState => ({
  now: Date.now() + offsetMs,
  source,
  rttMs: samples.length ? samples[samples.length - 1] : null,
  world: worldTimeAt(Date.now() + offsetMs),
})

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
export const worldNow = () => Date.now() + offsetMs
export const clockSource = () => source
export const worldSnapshot = () => worldTimeAt(worldNow())

/**
 * 向服务端校时。并发调用共享同一个请求；失败返回 false 且不改动已有偏移。
 */
export function calibrateWorldClock(): Promise<boolean> {
  if (syncing) return syncing
  const started = Date.now()
  syncing = (async () => {
    try {
      const response = await fetch('/api/health', {cache: 'no-store', credentials: 'same-origin'})
      const finished = Date.now()
      if (!response.ok) return false
      const body = await response.json().catch(() => null) as {now?: unknown} | null
      // 老后端只有 {ok:true}：没有 now 就不算校时成功，继续用本机时钟。
      if (!body || typeof body.now !== 'number' || !Number.isFinite(body.now)) return false
      const rtt = Math.max(0, finished - started)
      // 单程补偿：请求与响应各占一半往返，误差上限就是 rtt/2。
      const estimate = body.now + rtt / 2 - finished
      const previous = offsetMs
      if (samples.length === 0) offsetMs = estimate
      // 只收轻微修正，避免一次抖动的采样把天色拽走；偏差很大（换设备时钟、跨时区）时允许快速收敛。
      else offsetMs = previous + (estimate - previous) * (Math.abs(estimate - previous) > 5_000 ? 1 : 0.25)
      samples.push(rtt)
      if (samples.length > SAMPLE_KEEP) samples.shift()
      source = 'server'
      lastSampleAt = Date.now()
      if (Math.abs(offsetMs - previous) >= QUIET_MS || samples.length === 1) emit()
      return true
    } catch {
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
 * 装上自动校时。联机状态下上线/重连成功会立刻校一次；平时每 5 分钟一次。
 * 纯本地/测试直链不主动打接口，避免给截图门禁增加一次网络往返。
 */
export function installWorldClock(params: URLSearchParams) {
  const deepLink = DEEP_LINK_KEYS.some(key => params.has(key))
  const shouldSync = mpEnabled() || !deepLink
  if (!shouldSync) return
  schedule()
  window.addEventListener('glol:mp-status', event => {
    const detail = (event as CustomEvent<{state?: string}>).detail
    // 上线与断线重连成功都要重新校一次：重连往往发生在熄屏/切网之后，那正是漂移最大的时候。
    if (detail?.state === 'online') void calibrateWorldClock()
  })
  // 回到前台时顺手校一次，长期挂机的页面也能拉回来。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastSampleAt > 30_000) void calibrateWorldClock()
  })
  void calibrateWorldClock()
}
