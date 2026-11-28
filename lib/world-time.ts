// 全服统一时间（IDOK-502）。
//
// 时间不是"谁在线谁说了算"，而是一条只取决于绝对时间戳的确定性映射：任何客户端在同一个
// 服务端时刻算出的小时与天气完全相等，不需要额外的同步包，也不需要服务端保存任何状态。
// 授权来源只有服务端时钟（`/api/health` 的 `now`），本文件只管"给定毫秒数 → 世界时间"。
//
// 节律沿用现有观感：1 游戏小时 = 1 现实分钟，一轮昼夜 24 分钟；天气每 3 游戏小时换一段。
// 改动这里等于改动所有人的昼夜长度，必须同步 web/src/ui/sky.ts 的注释与 docs/world-time.md。

/** 1 游戏小时对应的现实毫秒数（沿用 1 小时 / 分钟）。 */
export const GAME_HOUR_MS = 60_000
/** 一整轮昼夜的现实毫秒数。 */
export const DAY_MS = 24 * GAME_HOUR_MS
/** 天气时段长度：每 3 游戏小时换一次，同一时刻全服一致。 */
export const WEATHER_SPELL_MS = 3 * GAME_HOUR_MS
/** hour=0 的锚点，取整点 UTC，避免本地时区参与计算。 */
export const EPOCH_MS = Date.UTC(2026, 0, 1)

export type WorldWeather = 'clear' | 'mist' | 'rain'

const mod = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor

/** 给定毫秒时间戳，返回 [0, 24) 的世界小时。 */
export function hourAt(ms: number) {
  if (!Number.isFinite(ms)) return 12
  return mod(ms - EPOCH_MS, DAY_MS) / GAME_HOUR_MS
}

/** 32 位整数混合（murmur3 的 finalizer），用于把时段号摊成稳定的伪随机数。 */
function hash32(seed: number) {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  x ^= x >>> 16
  return x >>> 0
}

/**
 * 时段 → 天气。权重按该时段的起始小时走：桂林的早晨多雾，其余时间以晴为主、偶有阵雨。
 * 相邻两段偶尔会撞成同一种天气，这是有意的（雾天和阴天本来就连着好几天），不影响一致性。
 */
function spellWeather(slot: number): WorldWeather {
  const hour = hourAt(EPOCH_MS + slot * WEATHER_SPELL_MS)
  const roll = hash32(slot) % 100
  if (hour >= 4.5 && hour < 9.5) return roll < 55 ? 'mist' : roll < 80 ? 'clear' : 'rain'
  if (hour >= 18 && hour < 21) return roll < 22 ? 'mist' : roll < 37 ? 'rain' : 'clear'
  return roll < 14 ? 'mist' : roll < 28 ? 'rain' : 'clear'
}

/** 给定毫秒时间戳，返回该时段全服统一的天气。 */
export function weatherAt(ms: number): WorldWeather {
  if (!Number.isFinite(ms)) return 'clear'
  return spellWeather(Math.floor((ms - EPOCH_MS) / WEATHER_SPELL_MS))
}

/** 当前天气时段还剩多少毫秒（客户端用它在换段前把过渡时间拉长，避免闪一下）。 */
export function weatherRemainingMs(ms: number) {
  if (!Number.isFinite(ms)) return WEATHER_SPELL_MS
  return WEATHER_SPELL_MS - mod(ms - EPOCH_MS, WEATHER_SPELL_MS)
}

/** 便于日志与测试：同一毫秒的世界时间快照。 */
export function worldTimeAt(ms: number) {
  return {hour: hourAt(ms), weather: weatherAt(ms), remainingMs: weatherRemainingMs(ms)}
}

const pad = (value: number) => String(value).padStart(2, '0')

/** `HH:MM`，用于 HUD 与日志。 */
export function clockText(ms: number) {
  const hour = hourAt(ms)
  const h = Math.floor(hour)
  return `${pad(h)}:${pad(Math.floor((hour - h) * 60))}`
}
