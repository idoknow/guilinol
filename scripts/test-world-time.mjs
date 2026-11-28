// IDOK-502 全服统一时间：确定性映射的单元测试。
// Run: node --import tsx --test scripts/test-world-time.mjs
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {clockText, DAY_MS, EPOCH_MS, GAME_HOUR_MS, hourAt, WEATHER_SPELL_MS, weatherAt, weatherRemainingMs, worldTimeAt} from '../lib/world-time.ts'

test('同一个毫秒在任何客户端都算出同一个小节与天气', () => {
  const at = EPOCH_MS + 12 * GAME_HOUR_MS + 1234
  // 两个"客户端"只是各自调用同一个纯函数，不共享任何状态。
  const a = worldTimeAt(at), b = worldTimeAt(at)
  assert.deepEqual(a, b)
  assert.equal(hourAt(at), 12 + 1234 / GAME_HOUR_MS)
  assert.equal(weatherAt(at), b.weather)
})

test('小时随时间单调推进，并在 24 处循环回 0', () => {
  const base = EPOCH_MS + 7 * GAME_HOUR_MS
  assert.ok(hourAt(base + 1000) > hourAt(base))
  assert.equal(hourAt(EPOCH_MS), 0)
  assert.equal(hourAt(EPOCH_MS + DAY_MS), 0)
  assert.equal(hourAt(EPOCH_MS + DAY_MS / 2), 12)
  // 跨日点两侧必须是连续的：只在 23.99 → 0 处折返，不允许中间跳一小时。
  const justBefore = hourAt(EPOCH_MS + DAY_MS - 1)
  assert.ok(justBefore > 23.99 && justBefore < 24)
})

test('负数与小数值不炸，且与正方向同一套映射', () => {
  assert.equal(hourAt(EPOCH_MS - GAME_HOUR_MS), 23)
  assert.equal(hourAt(EPOCH_MS - 25 * GAME_HOUR_MS), 23)
  assert.ok(Number.isFinite(hourAt(EPOCH_MS + 1.5)))
  assert.equal(hourAt(NaN), 12)
  assert.equal(weatherAt(NaN), 'clear')
})

test('天气按时段切分，同一时段全服一致，且只会是三种天气之一', () => {
  const slot = 30
  const at = EPOCH_MS + slot * WEATHER_SPELL_MS
  assert.equal(weatherAt(at), weatherAt(at + WEATHER_SPELL_MS - 1))
  assert.notEqual(weatherAt(at), weatherAt(at + WEATHER_SPELL_MS))
  for (let index = 0; index < 48; index++) {
    const current = weatherAt(EPOCH_MS + index * WEATHER_SPELL_MS)
    assert.ok(['clear', 'mist', 'rain'].includes(current))
  }
})

test('清晨雾的频率确实高于其它时段（不是同一套权重套全天）', () => {
  const counts = {clear: 0, mist: 0, rain: 0}
  let morningSlots = 0, morningMist = 0, otherSlots = 0, otherMist = 0
  const slots = 24 * 60 * 30 // 三十天，够把 55% / 14% 的差距拉出来
  for(let index = 0; index < slots; index++) {
    const at = EPOCH_MS + index * WEATHER_SPELL_MS, hour = hourAt(at), weather = weatherAt(at)
    counts[weather]++
    if(hour >= 4.5 && hour < 9.5) {morningSlots++; if(weather === 'mist') morningMist++}
    else {otherSlots++; if(weather === 'mist') otherMist++}
  }
  const morningRate = morningMist / morningSlots, otherRate = otherMist / otherSlots
  // 目标 55% vs 约 14%；留足统计余量，但仍能识别"全天用同一套权重"（那样两者会几乎相等）。
  assert.ok(morningRate > otherRate * 2.5,
    `清晨起雾率 ${(morningRate*100).toFixed(1)}% 应当显著高于其它时段 ${(otherRate*100).toFixed(1)}%`)
  assert.ok(morningRate > .4, `清晨起雾率应接近 55%，实际 ${(morningRate*100).toFixed(1)}%`)
  assert.ok(counts.clear > counts.mist && counts.clear > counts.rain, JSON.stringify(counts))
  assert.ok(counts.rain > 0 && counts.mist > 0)
})

test('剩余时段在 (0, 时段长度] 内，并在换段时归零', () => {
  const at = EPOCH_MS + 7 * WEATHER_SPELL_MS + 1000
  const left = weatherRemainingMs(at)
  assert.ok(left > 0 && left <= WEATHER_SPELL_MS)
  assert.equal(left, WEATHER_SPELL_MS - 1000)
  assert.equal(Math.round(weatherRemainingMs(EPOCH_MS + 8 * WEATHER_SPELL_MS)), WEATHER_SPELL_MS)
})

test('HH:MM 文本与小时一致，供 HUD 和日志使用', () => {
  assert.equal(clockText(EPOCH_MS), '00:00')
  assert.equal(clockText(EPOCH_MS + 13.5 * GAME_HOUR_MS), '13:30')
  assert.equal(clockText(EPOCH_MS + 23 * GAME_HOUR_MS + 59_000), '23:59')
})

test('一天长度与节律常量自洽（1 游戏小时 = 1 现实分钟）', () => {
  assert.equal(GAME_HOUR_MS, 60_000)
  assert.equal(DAY_MS, 24 * 60_000)
  assert.equal(WEATHER_SPELL_MS, 3 * GAME_HOUR_MS)
})
