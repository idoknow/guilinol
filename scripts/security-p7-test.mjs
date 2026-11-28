// P7 后台安全检索（记录号+审计）、ban-record 回退、按时间窗撤销与一键解封回复申诉单测（纯 Node，零外部依赖）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectKind, securitySearch } from '../server/security-search.mjs'
import { multiplayer } from '../server/mp-admin.mjs'

const REC_UUID = '12345678-1234-1234-1234-1234567890ab'

test('detectKind 准确区分记录号(UUID/legacy)、UID、IP、设备指纹与昵称', () => {
  assert.equal(detectKind(REC_UUID), 'record')
  assert.equal(detectKind('legacy-42'), 'record')
  assert.equal(detectKind('100088'), 'uid')
  assert.equal(detectKind('192.0.2.17'), 'ip')
  assert.equal(detectKind('a'.repeat(32)), 'fp')
  assert.equal(detectKind('桂林游侠'), 'nick')
})

test('securitySearch 按记录号查询并记录 security.search 审计', async () => {
  const audits = []
  const client = {
    async query(sql, args) {
      const q = sql.replace(/\s+/g, ' ').trim().toLowerCase()
      if (q.startsWith('begin') || q.startsWith('commit') || q.startsWith('rollback') || q.startsWith('select set_config')) {
        return { rows: [] }
      }
      if (q.includes('from mp_ban_records where id=$1')) {
        return {
          rows: [{
            id: REC_UUID, kind: 'uid', value: '100088', uid: 100088, fp: 'b'.repeat(32),
            tier: 'ban', reason: '持续异常移动', actor: 'auto', policy_version: 'v2',
            created_ms: 1_700_000_000_000, until_ms: 1_700_003_600_000,
            revoked_ms: null, revoked_by: null, revoke_reason: null, health: { p99: 42 }, meta: {},
          }],
        }
      }
      if (q.includes('from users where uid=$1')) {
        return { rows: [{ id: 'usr-1', uid: 100088, nickname: '小桂', email: 'u@example.com', created_at: 1700000000 }] }
      }
      if (q.includes('from mp_cheat_events where record_id=$1')) {
        return { rows: [{ id: 1, uid: 100088, kind: 'distance', at: 1_700_000_000_000, detail: { overflow: 35 } }] }
      }
      if (q.includes('from mp_cheat_captures where record_id=$1')) {
        return { rows: [{ id: 'cap-1', uid: 100088, kind: 'distance', capturedAt: 1_700_000_000_000 }] }
      }
      if (q.includes('from mp_devices d')) {
        return { rows: [{ uid: 100088, nickname: '小桂', last: 1_700_000_000_000 }, { uid: 100089, nickname: '同机号', last: 1_699_999_000_000 }] }
      }
      if (q.includes('from feedback where ban_record_id=$1')) {
        return { rows: [{ id: 'fb-1', title: '封禁申诉', status: 'submitted', submitted_at: 1700000100, updated_at: 1700000100 }] }
      }
      throw new Error('Unexpected SQL: ' + q)
    },
    release() {},
  }
  const pool = {
    async connect() { return client },
    async query(sql, args) {
      if (sql.includes('admin_audit')) audits.push(args)
      return { rows: [], rowCount: 1 }
    },
  }
  const res = await securitySearch(pool, new Request(`http://localhost/api/admin/security-search?q=${REC_UUID}`), 'admin-1')
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.kind, 'record')
  assert.equal(data.record.id, REC_UUID)
  assert.equal(data.account.nickname, '小桂')
  assert.equal(data.events.length, 1)
  assert.equal(data.captures[0].imageUrl, '/api/admin/mp/cheat-captures/cap-1/image')
  assert.equal(data.relatedAccounts.length, 2)
  assert.equal(data.appeals[0].id, 'fb-1')
  assert.equal(audits.length, 1)
  assert.equal(audits[0][0], 'admin-1')
  assert.equal(audits[0][1], 'record')
})

test('admin/ban-record 在 RT 不可用时优雅回退 PG，admin/unban-window 校验时间窗并写审计', async (t) => {
  const queries = []
  const pool = {
    async query(sql, args) {
      queries.push({ sql, args })
      if (sql.includes('from mp_ban_records where id=$1')) {
        return { rows: [{ id: REC_UUID, kind: 'uid', value: '100088', uid: 100088, fp: '', created_ms: 1700000000000 }] }
      }
      return { rows: [], rowCount: 1 }
    },
  }
  let rtWindowPayload = null
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).includes('/admin/ban-record')) throw new Error('ECONNREFUSED')
    if (String(url).includes('/admin/unban-window')) {
      rtWindowPayload = JSON.parse(init.body)
      return Response.json({ ok: true, revoked: 3 })
    }
    throw new Error('Unexpected fetch ' + url)
  })
  const { route } = multiplayer(pool, { RT_ADMIN_TOKEN: 'sec', RT_INTERNAL_URL: 'http://rt.local' })

  const recRes = await route('admin/ban-record', new Request(`http://localhost/api/admin/ban-record?id=${REC_UUID}`), 'admin-1')
  assert.equal(recRes.status, 200)
  const recData = await recRes.json()
  assert.equal(recData.record.id, REC_UUID)

  // 非法时间窗（超过 30 天）拒绝
  const badWin = await route('admin/unban-window', new Request('http://localhost/api/admin/unban-window', {
    method: 'POST', body: JSON.stringify({ fromMs: 0, toMs: 40 * 86400_000 }),
  }), 'admin-1')
  assert.equal(badWin.status, 400)

  // 正常时间窗转发到 RT 并记审计
  const okWin = await route('admin/unban-window', new Request('http://localhost/api/admin/unban-window', {
    method: 'POST', body: JSON.stringify({ fromMs: 1000, toMs: 60000, kind: 'distance', reason: '发版抖动误判' }),
  }), 'admin-1')
  assert.equal(okWin.status, 200)
  assert.equal((await okWin.json()).revoked, 3)
  assert.equal(rtWindowPayload.actor, 'admin-1')
  assert.equal(rtWindowPayload.kind, 'distance')
  assert.ok(queries.some((q) => q.sql.includes('mp.unban_window')))
})

test('admin/appeal-resolve 一键解封并回复申诉；RT 失败时绝不假结案', async (t) => {
  let fbStatus = 'submitted'
  const log = []
  const pool = {
    async query(sql, args) {
      log.push({ sql, args })
      if (sql.includes('from feedback f join users u')) {
        return { rows: [{ id: 'fb-appeal-1', user_id: 'u1', kind: '封禁申诉', status: fbStatus, ban_record_id: REC_UUID, account_uid: 100088 }] }
      }
      if (sql.includes('from mp_ban_records where id=$1')) {
        return { rows: [{ uid: 100088, fp: 'c'.repeat(32), kind: 'uid', value: '100088' }] }
      }
      if (sql.includes('update feedback set status=$1')) {
        fbStatus = args[0]
        return { rows: [], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    },
  }
  let failRt = true
  let unbanReq = null
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).includes('/admin/unban')) {
      unbanReq = JSON.parse(init.body)
      if (failRt) return Response.json({ error: 'rt error' }, { status: 500 })
      return Response.json({ ok: true, revoked: 2 })
    }
    throw new Error('Unexpected fetch ' + url)
  })
  const { route } = multiplayer(pool, { RT_ADMIN_TOKEN: 'sec', RT_INTERNAL_URL: 'http://rt.local' })

  // RT 失败时不改申诉状态
  const failRes = await route('admin/appeal-resolve', new Request('http://localhost/api/admin/appeal-resolve', {
    method: 'POST',
    body: JSON.stringify({ feedbackId: 'fb-appeal-1', status: 'unbanned', message: '已核实网络抖动，现解除限制' }),
  }), 'admin-1')
  assert.equal(failRes.status, 500)
  assert.equal(fbStatus, 'submitted')

  // RT 成功时连带解 uid+fp，并原子更新状态/事件/消息/审计
  failRt = false
  const okRes = await route('admin/appeal-resolve', new Request('http://localhost/api/admin/appeal-resolve', {
    method: 'POST',
    body: JSON.stringify({ feedbackId: 'fb-appeal-1', status: 'unbanned', message: '已核实网络抖动，现解除限制' }),
  }), 'admin-1')
  assert.equal(okRes.status, 200)
  assert.equal(fbStatus, 'unbanned')
  assert.equal(unbanReq.uid, 100088)
  assert.equal(unbanReq.fp, 'c'.repeat(32))
  assert.equal(unbanReq.recordId, REC_UUID)
  assert.ok(log.some((entry) => entry.sql.includes('insert into feedback_events')))
  assert.ok(log.some((entry) => entry.sql.includes('insert into feedback_messages')))
  assert.ok(log.some((entry) => entry.sql.includes('appeal.resolve')))
})
