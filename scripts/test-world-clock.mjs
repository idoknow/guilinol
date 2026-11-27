// IDOK-502 全服时间：确定性世界时钟的单元测试。
// Run: node --import tsx --test scripts/test-world-clock.mjs
//
// 这个测试只覆盖纯函数（lib/world-clock.ts），不需要浏览器：它要证明的就是「同一 epoch
// 必然得到同一时辰与同一天气」，这是全服天色一致的数学前提。
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {
  GAME_DAY_HOURS, GAME_HOURS_PER_MS, WEATHER_TRANSITION_HOURS, WORLD_ANCHOR_HOUR, WORLD_ANCHOR_MS,
  advanceHour, calibrateHour, normalizeHour, sanitizeMapping, shortestHourDelta,
  weatherFx, weatherSchedule, worldClock, worldEpochAt, worldHourAt, worldTimePayload, worldWeatherAt,
} from '../lib/world-clock.ts'

const MINUTE = 60_000

test('1 游戏小时 = 1 现实分钟，与 M3 定稿一致', () => {
  assert.equal(GAME_HOURS_PER_MS, 1/MINUTE)
  assert.equal(WORLD_ANCHOR_HOUR, 10)
  assert.equal(worldHourAt(WORLD_ANCHOR_MS), 10)
  assert.equal(worldHourAt(WORLD_ANCHOR_MS + GAME_DAY_HOURS*MINUTE), 10, '一整天（24 现实分钟）之后回到同一时辰')
  // 半分钟推进半游戏小时。
  assert.ok(Math.abs(worldHourAt(WORLD_ANCHOR_MS + MINUTE/2) - 10.5) < 1e-9)
})

test('世界时辰只取决于 epoch：任意两个客户端算出的结果完全相同', () => {
  for(const offset of [0, 1, 37_123, 86_400_000, 1_234_567_890, 31_536_000_000]) {
    const epoch = WORLD_ANCHOR_MS + offset
    // 同一个 epoch 调 100 次，结果必须逐位相同（纯函数，无隐藏状态）。
    const first = worldHourAt(epoch)
    for(let repeat = 0; repeat < 100; repeat++) assert.equal(worldHourAt(epoch), first)
    // 同一个 epoch 的天气也必须完全相同。
    const weather = worldWeatherAt(epoch)
    for(let repeat = 0; repeat < 20; repeat++) assert.deepEqual(worldWeatherAt(epoch).mix, weather.mix)
  }
})

test('世界时辰与天气都是连续的：跨零点、跨天气段都不跳变', () => {
  const step = 250
  const span = 3*GAME_DAY_HOURS*MINUTE
  let previousHour = worldHourAt(WORLD_ANCHOR_MS)
  let previousMix = worldWeatherAt(WORLD_ANCHOR_MS).mix
  // 每步最多推进的过渡进度 = step / 过渡窗口（20 现实秒），smoothstep 峰值斜率 1.5，
  // 所以单步乘数变化上限 = 全幅 × 1.5 × step/窗口。留 1.2 倍余量。
  const worst = Math.max(...Object.keys(weatherFx.clear).map(key =>
    Math.max(...Object.values(weatherFx).map(mix => mix[key])) - Math.min(...Object.values(weatherFx).map(mix => mix[key]))))
  const limit = worst * 1.5 * (step/(WEATHER_TRANSITION_HOURS*MINUTE)) * 1.2
  for(let at = step; at <= span; at += step) {
    const epoch = WORLD_ANCHOR_MS + at
    const hour = worldHourAt(epoch)
    // 每 250 ms 推进的游戏小时数远小于一小时；跨零点按环处理（不会从 23.99 跳回 0 算突变）。
    const delta = Math.abs(shortestHourDelta(previousHour, hour))
    assert.ok(delta < .01, `时辰跳变 ${previousHour} → ${hour} @ ${at}`)
    previousHour = hour
    const mix = worldWeatherAt(epoch).mix
    for(const key of Object.keys(mix)) {
      assert.ok(Math.abs(mix[key]-previousMix[key]) <= limit, `天气乘数 ${key} 跳变 @ epoch+${at}`)
    }
    previousMix = mix
  }
})

test('天气段落在 24 小时的周期内且不重复同一种天气', () => {
  for(let cycle = -3; cycle < 40; cycle++) {
    const spells = weatherSchedule(cycle)
    assert.ok(spells.length > 0 && spells.length <= 32)
    let cursor = 0
    for(let index = 0; index < spells.length; index++) {
      const spell = spells[index]
      assert.ok(Math.abs(spell.start - cursor) < 1e-9, '段与段首尾相接，无空档')
      assert.ok(spell.length > 0)
      assert.ok(['clear','mist','rain'].includes(spell.weather))
      if(index) assert.notEqual(spell.weather, spells[index-1].weather, '不连续重复同一种天气')
      cursor = spell.start + spell.length
    }
    assert.ok(Math.abs(cursor - GAME_DAY_HOURS) < 1e-9, '正好铺满 24 小时')
  }
})

test('天气过渡从上一段乘数平滑走到本段乘数', () => {
  // 找一个紧跟在别种天气之后、且过渡窗口还没结束的时刻。
  let found = false
  for(let cycle = 0; cycle < 12 && !found; cycle++) {
    const spells = weatherSchedule(cycle)
    for(let index = 1; index < spells.length; index++) {
      const spell = spells[index]
      if(spell.length <= WEATHER_TRANSITION_HOURS) continue
      const previous = spells[index-1].weather
      if(previous === spell.weather) continue
      // 进入该段 0.1 游戏小时（= 6 现实秒），仍在 20 秒过渡窗口内。
      const epoch = worldEpochAt(cycle*GAME_DAY_HOURS + spell.start + .1)
      const snapshot = worldWeatherAt(epoch)
      assert.equal(snapshot.weather, spell.weather)
      assert.ok(snapshot.progress > .1 && snapshot.progress < .9, `过渡进度应在 (0,1) 内：${snapshot.progress}`)
      // 乘数落在「上一段 → 本段」之间。
      for(const key of Object.keys(weatherFx.clear)) {
        const from = weatherFx[previous][key], to = weatherFx[spell.weather][key]
        const low = Math.min(from, to), high = Math.max(from, to)
        assert.ok(snapshot.mix[key] >= low - 1e-9 && snapshot.mix[key] <= high + 1e-9, `${key} 越界`)
      }
      found = true
      break
    }
  }
  assert.ok(found, '至少应找到一个进入过渡窗口的天气段')
})

test('瞬时切换：段开始时乘数等于上一段（progress = 0）', () => {
  let found = false
  for(let cycle = 0; cycle < 8 && !found; cycle++) {
    const spells = weatherSchedule(cycle)
    const second = spells[1]
    if(!second || second.length <= WEATHER_TRANSITION_HOURS) continue
    const epoch = worldEpochAt(cycle*GAME_DAY_HOURS + second.start + 1e-6)
    const snapshot = worldWeatherAt(epoch)
    assert.ok(snapshot.progress >= 0 && snapshot.progress < 1e-4, `段起点进度应为 0：${snapshot.progress}`)
    // 段起点乘数就是上一段的乘数（四舍五入误差内）。
    for(const key of Object.keys(weatherFx.clear)) {
      assert.ok(Math.abs(snapshot.mix[key]-weatherFx[spells[0].weather][key]) < 1e-3, `${key} 段起点应等于上一段`)
    }
    found = true
  }
  assert.ok(found, '至少应有一个跨日之外的天气段')
})

test('校准只做比例补偿，永不跳变', () => {
  // 大偏差（12 小时）在 1 秒内也不会一次性扫完。
  let hour = 0
  for(let frame = 0; frame < 60; frame++) hour = calibrateHour(hour, 12, 1/60)
  assert.ok(Math.abs(shortestHourDelta(0, hour)) > .05, '1 秒内不应走完 12 小时')

  // 偏差小的时候平滑收敛到目标。
  let near = 10
  for(let frame = 0; frame < 600; frame++) near = calibrateHour(near, 10.4, 1/60)
  assert.ok(Math.abs(shortestHourDelta(near, 10.4)) < 1e-3)

  // 单帧修正量有上限：不会从 23.9 直接跳到 0.1，也不会反向绕远路。
  const forward = calibrateHour(23.9, .1, 1/60)
  assert.ok(Math.abs(shortestHourDelta(23.9, forward)) < .06)
  assert.ok(shortestHourDelta(23.9, forward) > 0, '跨零点必须向前走')
})

test('归一化与最短差覆盖跨零点', () => {
  assert.equal(normalizeHour(-1), 23)
  assert.equal(normalizeHour(25), 1)
  assert.equal(normalizeHour(24), 0)
  assert.equal(shortestHourDelta(23, 1), 2)
  assert.equal(shortestHourDelta(1, 23), -2)
  assert.equal(shortestHourDelta(6, 18), 12)
  assert.equal(advanceHour(23.5, 1), .5)
})

test('接口载荷带上服务端时刻、映射与当时的时辰/天气', () => {
  const now = WORLD_ANCHOR_MS + 123*MINUTE
  const payload = worldTimePayload(now)
  assert.equal(payload.serverTime, now)
  assert.equal(payload.proto, 1)
  assert.deepEqual(payload.mapping, worldClock)
  assert.equal(payload.hour, worldHourAt(now))
  assert.equal(payload.weather, worldWeatherAt(now).weather)
  // 时钟与天气来自同一个 epoch。
  assert.equal(payload.weather, worldWeatherAt(payload.serverTime).weather)
})

test('被篡改的映射会被拒绝，退回内置常量', () => {
  assert.deepEqual(sanitizeMapping(null), worldClock)
  assert.deepEqual(sanitizeMapping([1,2]), worldClock)
  assert.deepEqual(sanitizeMapping({anchorMs:'x',anchorHour:1,hoursPerMs:1}), worldClock)
  // 速度为 0 或负数 → 拒绝。
  assert.deepEqual(sanitizeMapping({anchorMs:0,anchorHour:1,hoursPerMs:0}), worldClock)
  assert.deepEqual(sanitizeMapping({anchorMs:0,anchorHour:1,hoursPerMs:-1}), worldClock)
  // 一天不到 1 现实分钟 → 拒绝（离谱的快）。
  assert.deepEqual(sanitizeMapping({anchorMs:0,anchorHour:1,hoursPerMs:1/60_000*2}), worldClock)
  // 合法映射原样保留。
  const mapping = {anchorMs:WORLD_ANCHOR_MS, anchorHour:8, hoursPerMs:1/(2*MINUTE)}
  assert.deepEqual(sanitizeMapping(mapping), mapping)
})

test('自定义映射同样可复现（服务端以后调快慢，旧客户端也一致）', () => {
  const mapping = {anchorMs:WORLD_ANCHOR_MS, anchorHour:0, hoursPerMs:1/(2*MINUTE)}
  assert.equal(worldHourAt(WORLD_ANCHOR_MS, mapping), 0)
  assert.equal(worldHourAt(WORLD_ANCHOR_MS + MINUTE, mapping), .5)
  assert.equal(worldHourAt(WORLD_ANCHOR_MS + 48*MINUTE, mapping), 0)
})

test('同一 epoch 的天气乘数逐位相同（端点回到表里的精确值）', () => {
  // 过渡结束后乘数必须精确等于 weatherFx 里作者写的值，否则「同一 epoch 同一乘数」会被
  // 浮点误差（1 + (0.42-1)*1 !== 0.42）破坏，不同客户端就可能在 1e-16 量级上分叉。
  for(const weather of ['clear','mist','rain']) {
    const spell = weatherSchedule(0).find(entry => entry.weather === weather)
    if(!spell) continue
    // 段中（progress 已是 1）取两次。
    const epoch = worldEpochAt(spell.start + WEATHER_TRANSITION_HOURS*2)
    const first = worldWeatherAt(epoch).mix, second = worldWeatherAt(epoch).mix
    assert.deepEqual(first, second)
    assert.deepEqual(first, weatherFx[weather], `${weather} 过渡结束后应精确等于表里的乘数`)
  }
})
