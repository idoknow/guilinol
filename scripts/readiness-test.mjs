// 就绪判定的单元测试（不需要真数据库）：
//   node scripts/readiness-test.mjs
import assert from 'node:assert/strict'
import {createReadiness, SCHEMA_SQL} from '../server/readiness.mjs'

let passed = 0
const test = async (name, fn) => { await fn(); passed += 1; console.log(`ok ${name}`) }
const rows = users => ({ rows: [{ users }] })

await test('表不存在 → 未就绪 schema_missing', async () => {
  const readiness = createReadiness({ query: async () => rows(null) })
  const status = await readiness.probe()
  assert.equal(status.ready, false)
  assert.equal(status.reason, 'schema_missing')
})

await test('表存在 → 就绪', async () => {
  const readiness = createReadiness({ query: async () => rows('users') })
  const status = await readiness.probe()
  assert.equal(status.ready, true)
  assert.equal(status.reason, 'ok')
})

await test('查的是 users 表而不是 select 1', async () => {
  let seen = ''
  const readiness = createReadiness({ query: async sql => { seen = sql; return rows('users') } })
  await readiness.probe()
  assert.equal(seen, SCHEMA_SQL)
  assert.match(seen, /to_regclass\('public\.users'\)/)
})

await test('DB 报错 → 未就绪 database', async () => {
  const readiness = createReadiness({ query: async () => { throw new Error('boom') } })
  const status = await readiness.probe()
  assert.equal(status.ready, false)
  assert.equal(status.reason, 'database')
})

await test('查询超过超时 → 未就绪 timeout（不会一直卡住）', async () => {
  const readiness = createReadiness({ query: () => new Promise(() => {}), timeoutMs: 30 })
  const started = Date.now()
  const status = await readiness.probe()
  assert.equal(status.ready, false)
  assert.equal(status.reason, 'timeout')
  assert.ok(Date.now() - started < 1000)
})

await test('就绪后 DB 再挂也不掉就绪（静态页不能跟着死）', async () => {
  let healthy = true
  const readiness = createReadiness({ query: async () => { if (!healthy) throw new Error('down'); return rows('users') } })
  assert.equal((await readiness.probe()).ready, true)
  healthy = false
  const status = await readiness.probe()
  assert.equal(status.ready, true)
  assert.equal(status.reason, 'database')
})

await test('探针只读缓存：不阻塞、TTL 内只查一次、并发只发一个', async () => {
  let calls = 0
  const readiness = createReadiness({ query: async () => { calls += 1; await new Promise(r => setTimeout(r, 20)); return rows('users') }, ttlMs: 10_000 })
  const first = readiness.status()
  const second = readiness.status()
  assert.equal(first.ready, false)          // 首次还没结果，立即返回
  assert.equal(second.ready, false)
  assert.equal(calls, 1, '只应发出一次查询')
  await new Promise(r => setTimeout(r, 60))
  assert.equal(readiness.status().ready, true)
  assert.equal(calls, 1, 'TTL 内不再查库')
})

console.log(`\n${passed} 项通过`)
