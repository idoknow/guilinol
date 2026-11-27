// IDOK-502 全服时间：多客户端一致性 + 断线重连 + 离线兜底的行为测试。
// Run: node --import tsx --test scripts/test-world-clock-sync.mjs
//
// 这里不启浏览器：`createWorldClock` 只依赖 `fetch` 和计时函数，所以可以在 Node 里用
// 假 fetch 模拟「两个客户端连同一台服务端、网络延迟不同、系统时钟不同、断线后重连」。
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {
  GAME_DAY_HOURS, WORLD_ANCHOR_MS, shortestHourDelta, worldHourAt, worldTimePayload, worldWeatherAt,
} from '../lib/world-clock.ts'
import {createWorldClock} from '../web/src/look/world-clock-client.ts'

const MINUTE = 60_000

/** 一台「服务端」：返回 `clock.now` 那一刻，可按需注入延迟或断网。 */
function server(clock) {
  return async () => {
    if (clock.fail) throw Error('offline')
    // 模拟往返延迟：载荷里的时刻是「服务端处理那一刻」的。
    clock.now += clock.latencyMs
    const payload = worldTimePayload(clock.now)
    return {ok: true, status: 200, async json() { return payload }}
  }
}

test('两个客户端的权威时辰与天气完全一致（相同 epoch）', async () => {
  const authority = {now: WORLD_ANCHOR_MS + 137*MINUTE, latencyMs: 0, fail: false}
  const fast = createWorldClock(server(authority))
  const slow = createWorldClock(server({...authority, latencyMs: 90}))
  assert.equal(await fast.sync(true), true)
  assert.equal(await slow.sync(true), true)
  assert.equal(fast.offline(), false)
  assert.equal(slow.offline(), false)
  // 两台机器采样时刻差不到 1 ms，权威时辰最多差一个采样中点，远小于一分钟。
  const gap = Math.abs(shortestHourDelta(fast.authoritativeHour(), slow.authoritativeHour()))
  assert.ok(gap < .01, `两个客户端的时辰差 ${gap} 小时`)
  assert.equal(fast.weather().weather, slow.weather().weather)
  for(const key of Object.keys(fast.weather().mix)) {
    assert.ok(Math.abs(fast.weather().mix[key]-slow.weather().mix[key]) < .02, `天气乘数 ${key} 不一致`)
  }
})

test('服务端时间与本地时钟无关：本机时间偏 7 小时也照样对齐', async () => {
  const authority = {now: WORLD_ANCHOR_MS + 400*MINUTE, latencyMs: 12, fail: false}
  const client = createWorldClock(server(authority))
  // 把本地系统时钟推到与真实相差 7 小时的位置。
  const originalNow = Date.now
  Date.now = () => originalNow() + 7*3600_000
  try {
    assert.equal(await client.sync(true), true)
    const expected = worldHourAt(authority.now)
    const gap = Math.abs(shortestHourDelta(client.authoritativeHour(), expected))
    assert.ok(gap < .01, `本机时钟偏移不应影响权威时辰，差 ${gap} 小时`)
  } finally { Date.now = originalNow }
})

test('断线后继续外推，重连立刻收敛', async () => {
  const authority = {now: WORLD_ANCHOR_MS + 250*MINUTE, latencyMs: 5, fail: false}
  const client = createWorldClock(server(authority))
  assert.equal(await client.sync(true), true)
  const synced = client.authoritativeHour()
  assert.equal(client.offline(), false)

  // 断网：仍保留上次样本，`now()` 按本地单调时钟继续外推。
  authority.fail = true
  await client.sync(true)
  assert.equal(client.offline(), false, '已有样本时断线只是停止刷新，不退回本机时钟')
  const drifted = client.authoritativeHour()
  assert.ok(Math.abs(shortestHourDelta(synced, drifted)) < .01, '外推应连续，不跳回旧值')

  // 服务端前进 3 小时，重连后立刻对上。
  authority.now += 3*60*MINUTE
  authority.fail = false
  assert.equal(await client.sync(true), true)
  const after = client.authoritativeHour()
  const gap = Math.abs(shortestHourDelta(after, worldHourAt(authority.now)))
  assert.ok(gap < .02, `重连后偏差应收干净，实际 ${gap} 小时`)
})

test('从未连上过服务端时退回本机时钟并标记 offline', async () => {
  const client = createWorldClock(async () => { throw Error('offline') })
  assert.equal(await client.sync(true), false)
  assert.equal(client.offline(), true)
  assert.equal(client.state.synced, false)
  // 本机兜底仍是同一套映射：时辰合法，天气合法。
  const hour = client.authoritativeHour()
  assert.ok(hour >= 0 && hour < GAME_DAY_HOURS)
  assert.ok(['clear','mist','rain'].includes(client.weather().weather))
})

test('采样取最短 RTT：一次慢包不会把偏移量带偏', async () => {
  const authority = {now: WORLD_ANCHOR_MS + 600*MINUTE}
  let call = 0
  const client = createWorldClock(async () => {
    call++
    // 第 2 次采样注入 400 ms 延迟（模拟慢包 / 排队）。
    authority.now += call === 2 ? 400 : 2
    return {ok:true, status:200, async json(){ return worldTimePayload(authority.now) }}
  })
  assert.equal(await client.sync(true), true)
  const expected = worldHourAt(authority.now)
  const gap = Math.abs(shortestHourDelta(client.authoritativeHour(), expected))
  assert.ok(gap < .01, `慢包不应污染偏移量，差 ${gap} 小时`)
  assert.ok(client.state.rttMs < 100, `报告的 RTT 应是短样本：${client.state.rttMs}`)
})

test('服务端天气与客户端按 epoch 重算的天气一致（同一份映射）', async () => {
  const authority = {now: WORLD_ANCHOR_MS + 900*MINUTE, latencyMs: 3, fail: false}
  const client = createWorldClock(server(authority))
  assert.equal(await client.sync(true), true)
  // 服务端在载荷里给的天气，与客户端用 epoch 重算的结果必须相同 —— 全服天色的核心保证。
  const payload = worldTimePayload(authority.now)
  assert.equal(client.weather().weather, payload.weather)
  assert.deepEqual(client.weather().mix, worldWeatherAt(authority.now).mix)
})
