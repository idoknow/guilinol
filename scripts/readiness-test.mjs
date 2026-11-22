// 就绪判定的单元测试（不需要真数据库）：
//   node scripts/readiness-test.mjs
import assert from 'node:assert/strict'
import {createReadiness, SCHEMA_SQL, REQUIRED_TABLES} from '../server/readiness.mjs'

let passed = 0
const test = async (name, fn) => { await fn(); passed += 1; console.log(`ok ${name}`) }
const missing = n => ({ rows: [{ missing: n }] })

await test('迁移没跑完（缺表）→ 未就绪 schema_incomplete', async () => {
  const readiness = createReadiness({ query: async () => missing(3) })
  const status = await readiness.probe()
  assert.equal(status.ready, false)
  assert.equal(status.reason, 'schema_incomplete')
})

await test('全部表都在 → 就绪', async () => {
  const readiness = createReadiness({ query: async () => missing(0) })
  const status = await readiness.probe()
  assert.equal(status.ready, true)
  assert.equal(status.reason, 'ok')
})

await test('检查的是整批迁移表，不是单表/select 1', async () => {
  let seen = ''
  const readiness = createReadiness({ query: async sql => { seen = sql; return missing(0) } })
  await readiness.probe()
  assert.equal(seen, SCHEMA_SQL)
  assert.match(seen, /unnest\(array\[/)
  for (const table of ['users', 'sessions', 'social_pending', 'perf_server']) {
    assert.ok(seen.includes(`'${table}'`), `应包含 ${table}`)
  }
})

await test('DB 报错 → 未就绪 database', async () => {
  const readiness = createReadiness({ query: async () => { throw new Error('boom') } })
  const status = await readiness.probe()
  assert.equal(status.ready, false)
  assert.equal(status.reason, 'database')
})

await test('查询卡住 → probe 快速返回 timeout，且不会叠加新查询', async () => {
  let calls = 0
  const readiness = createReadiness({ query: () => { calls += 1; return new Promise(() => {}) }, timeoutMs: 30 })
  const started = Date.now()
  const status = await readiness.probe()
  assert.equal(status.ready, false)
  assert.equal(status.reason, 'timeout')
  assert.ok(Date.now() - started < 1000)
  // 底层查询仍挂在 inflight 上：两次追问都不会再发新查询，避免把连接池占满
  await readiness.probe()
  readiness.status()
  assert.equal(calls, 1)
})

await test('就绪后 DB 再挂也不掉就绪（静态页不能跟着死）', async () => {
  let healthy = true
  const readiness = createReadiness({ query: async () => { if (!healthy) throw new Error('down'); return missing(0) } })
  assert.equal((await readiness.probe()).ready, true)
  healthy = false
  const status = await readiness.probe()
  assert.equal(status.ready, true)
  assert.equal(status.reason, 'database')
})

await test('探针只读缓存：TTL 内只查一次、并发只发一个', async () => {
  let calls = 0
  const readiness = createReadiness({ query: async () => { calls += 1; await new Promise(r => setTimeout(r, 20)); return missing(0) }, ttlMs: 10_000 })
  const first = readiness.status()
  const second = readiness.status()
  assert.equal(first.ready, false)          // 首次还没结果，立即返回
  assert.equal(second.ready, false)
  await new Promise(r => setTimeout(r, 0))  // 查询在微任务里启动
  assert.equal(calls, 1, '只应发出一次查询')
  await new Promise(r => setTimeout(r, 60))
  assert.equal(readiness.status().ready, true)
  assert.equal(calls, 1, 'TTL 内不再查库')
})

await test('必查表清单覆盖迁移建的表', async () => {
  assert.ok(REQUIRED_TABLES.length >= 20)
  assert.ok(REQUIRED_TABLES.includes('users'))
  assert.ok(REQUIRED_TABLES.includes('social_identities'))
})

console.log(`\n${passed} 项通过`)
