// IDOK-502 全服时间接口：直接跑真实的 Pages Functions 处理器（不需要数据库）。
// Run: node --import tsx --test scripts/test-world-time-api.mjs
//
// `/api/time` 是公开只读、在鉴权之前返回，所以这里给一个空 env 就够了 —— 顺带证明它
// 确实不依赖会话、不写库。
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {onRequest} from '../functions/api/[[path]].ts'
import {WORLD_ANCHOR_MS, worldHourAt, worldWeatherAt} from '../lib/world-clock.ts'

const ORIGIN = 'https://glol.test'
const env = {}

function call(path, init) {
  return onRequest({request: new Request(ORIGIN + path, init), env})
}

test('GET /api/time 无需登录即返回服务端时刻与映射', async () => {
  const before = Date.now()
  const response = await call('/api/time')
  const after = Date.now()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store', '时间不能被缓存')
  const payload = await response.json()
  assert.ok(typeof payload.serverTime === 'number')
  // 服务端时刻必须落在这次请求的时间窗里（不是客户端的时钟）。
  assert.ok(payload.serverTime >= before && payload.serverTime <= after, `serverTime ${payload.serverTime} 不在 [${before}, ${after}]`)
  assert.equal(payload.proto, 1)
  assert.equal(typeof payload.hour, 'number')
  assert.ok(payload.hour >= 0 && payload.hour < 24)
  assert.ok(['clear','mist','rain'].includes(payload.weather))
  assert.ok(payload.mapping && Number.isFinite(payload.mapping.anchorMs) && Number.isFinite(payload.mapping.hoursPerMs))
})

test('返回的时辰与天气可用 payload 里的映射复算（客户端就是这么做）', async () => {
  const payload = await (await call('/api/time')).json()
  assert.equal(payload.hour, worldHourAt(payload.serverTime, payload.mapping))
  assert.equal(payload.weather, worldWeatherAt(payload.serverTime, payload.mapping).weather)
})

test('两次请求相隔一段时间：时辰单调推进，不是每次都从同一个起点重来', async () => {
  const first = await (await call('/api/time')).json()
  // 等 1.2 现实秒 ≈ 1.2 游戏分钟。
  await new Promise(resolve => setTimeout(resolve, 1200))
  const second = await (await call('/api/time')).json()
  const delta = (second.serverTime - first.serverTime) * second.mapping.hoursPerMs
  assert.ok(delta > 0, '服务端时间必须前进')
  assert.ok(Math.abs(second.hour - worldHourAt(second.serverTime)) < 1e-9, '时辰由 epoch 纯函数决定')
})

test('不接受非 GET', async () => {
  const response = await call('/api/time', {method: 'POST'})
  assert.equal(response.status, 405)
})

test('映射原点是固定 epoch，服务端重启不会「回到上午」', async () => {
  const payload = await (await call('/api/time')).json()
  assert.equal(payload.mapping.anchorMs, WORLD_ANCHOR_MS)
  // 2026-01-01 之后任意时刻的时辰都只由该 epoch 决定。
  const a = worldHourAt(WORLD_ANCHOR_MS + 86_400_000)
  const b = worldHourAt(WORLD_ANCHOR_MS + 86_400_000)
  assert.equal(a, b)
})
