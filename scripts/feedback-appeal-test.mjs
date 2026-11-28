// 申诉结构化、空模板拦截、归属校验、独立状态机与初审可见性单测（纯 Node，零外部依赖）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.\w+$/.test(specifier) && context.parentURL) {
      const tsUrl = new URL(specifier + '.ts', context.parentURL)
      if (existsSync(fileURLToPath(tsUrl))) return { url: tsUrl.href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const { APPEAL, appealEdges, extractBanRecordId, stripAppealTemplate } = await import('../lib/feedback-contract.ts')
const { feedback } = await import('../lib/feedback.ts')
const { Problem } = await import('../lib/auth.ts')

const ORIGIN = 'https://guilin.example'

function createMockEnv({ user, triageFn } = {}) {
  const feedbackRows = new Map()
  const events = []
  const messages = []
  const photos = []
  const audits = []
  let seq = 0

  const currentUser = user ?? {
    id: 'user-1',
    uid: 1001,
    email: 'player@example.com',
    nickname: '游览者',
    verified: 1,
    role: 'user',
    banned_at: 0,
  }

  function exec(sql, args) {
    const q = sql.replace(/\s+/g, ' ').trim()
    if (/FROM sessions JOIN users/.test(q)) {
      return { results: [currentUser], meta: { changes: 0 } }
    }
    if (/^INSERT INTO feedback\(/.test(q)) {
      const [id, userId, kind, title, body, lat, lon, heading, landmarkId, viewJson, banRecordId, appealTriage] = args
      const row = {
        rowid: ++seq,
        id,
        user_id: userId,
        kind,
        title,
        body,
        lat,
        lon,
        heading,
        landmark_id: landmarkId,
        view_json: viewJson,
        ban_record_id: banRecordId ?? null,
        appeal_triage: appealTriage ?? null,
        status: 'draft',
        shot_state: 0,
        multica_issue: null,
        pr_url: null,
        credit: null,
        admin_read_id: 0,
        submitted_at: null,
        updated_at: Math.floor(Date.now() / 1000),
        email: currentUser.email,
        nickname: currentUser.nickname,
        submitter_role: currentUser.role,
      }
      feedbackRows.set(id, row)
      return { results: [], meta: { changes: 1 } }
    }
    if (/^SELECT f\.\*,u\.email/.test(q) || /^SELECT \* FROM feedback WHERE id=\?/.test(q)) {
      const [id, uidArg, bypass] = args
      const row = feedbackRows.get(id)
      if (!row || (row.user_id !== uidArg && !bypass)) return { results: [], meta: { changes: 0 } }
      return { results: [{ ...row }], meta: { changes: 0 } }
    }
    if (/^SELECT id,author_kind,author_name,body,created_at,relayed_at FROM feedback_messages/.test(q)) {
      return { results: messages.filter((m) => m.feedback_id === args[0]), meta: { changes: 0 } }
    }
    if (/^SELECT n,bytes,mime/.test(q)) {
      return { results: photos.filter((p) => p.feedback_id === args[0]), meta: { changes: 0 } }
    }
    if (/^SELECT \* FROM feedback_events/.test(q)) {
      return { results: events.filter((e) => e.feedback_id === args[0]), meta: { changes: 0 } }
    }
    if (/^UPDATE feedback SET status=\?/.test(q)) {
      const [target, issue, pr, credit, id, prevStatus] = args
      const row = feedbackRows.get(id)
      if (!row || row.status !== prevStatus) return { results: [], meta: { changes: 0 } }
      row.status = target
      if (issue != null) row.multica_issue = issue
      if (pr != null) row.pr_url = pr
      if (credit != null) row.credit = credit
      row.updated_at = Math.floor(Date.now() / 1000)
      if (prevStatus === 'draft') row.submitted_at = row.updated_at
      return { results: [], meta: { changes: 1 } }
    }
    if (/^INSERT INTO feedback_events/.test(q)) {
      const [fid, status, message, screenshot] = args
      events.push({ id: ++seq, feedback_id: fid, status, message, screenshot_url: screenshot, created_at: Math.floor(Date.now() / 1000) })
      return { results: [], meta: { changes: 1 } }
    }
    if (/^INSERT INTO admin_audit/.test(q)) {
      audits.push(args)
      return { results: [], meta: { changes: 1 } }
    }
    if (/^UPDATE feedback SET admin_read_id/.test(q)) {
      return { results: [], meta: { changes: 1 } }
    }
    if (/^INSERT INTO feedback_messages/.test(q)) {
      const [fid, authorKind, authorName, body] = args
      const row = feedbackRows.get(fid)
      if (!row || ['draft', 'live', 'resolved', 'rejected', 'duplicate', 'unbanned', 'upheld'].includes(row.status)) {
        return { results: [], meta: { changes: 0 } }
      }
      messages.push({ id: ++seq, feedback_id: fid, author_kind: authorKind, author_name: authorName, body, created_at: Math.floor(Date.now() / 1000) })
      return { results: [], meta: { changes: 1 } }
    }
    if (/^SELECT status FROM feedback WHERE id=\?/.test(q)) {
      const row = feedbackRows.get(args[0])
      return { results: row ? [{ status: row.status }] : [], meta: { changes: 0 } }
    }
    throw new Error('Unhandled SQL in mock: ' + q)
  }

  function makeStmt(sql, bound = []) {
    return {
      sql,
      bound,
      bind(...args) { return makeStmt(sql, args) },
      async all() { return exec(sql, bound) },
      async run() { return exec(sql, bound) },
      async first(col) {
        const res = exec(sql, bound).results[0]
        if (!res) return null
        return col ? res[col] : res
      },
    }
  }

  const db = {
    prepare(sql) { return makeStmt(sql) },
    async batch(stmts) {
      const out = []
      for (const s of stmts) out.push(exec(s.sql, s.bound))
      return out
    },
  }

  return {
    env: {
      DB: db,
      FEEDBACK: { get: async () => null, put: async () => {}, delete: async () => {} },
      BRIDGE_TOKEN: 'bridge-secret',
      appealTriage: triageFn,
    },
    feedbackRows,
    events,
    messages,
    setUser(u) { Object.assign(currentUser, u) },
  }
}

function req(method, path, body, headers = {}) {
  const init = {
    method,
    headers: {
      Origin: ORIGIN,
      Cookie: 'glol_session=' + 'a'.repeat(64),
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  }
  return new Request(`${ORIGIN}/api/${path}`, init)
}

test('stripAppealTemplate 剥离旧模板空行，extractBanRecordId 正确提取 UUID 与 legacy 编号', () => {
  assert.equal(stripAppealTemplate('封禁记录 ID：12345678-1234-1234-1234-1234567890ab\n申诉说明：   '), '')
  assert.equal(stripAppealTemplate('记录编号: legacy-42\n申诉理由: 当时地铁里断网重连'), '当时地铁里断网重连')
  assert.equal(extractBanRecordId('见记录 12345678-1234-1234-1234-1234567890ab 麻烦核实'), '12345678-1234-1234-1234-1234567890ab')
  assert.equal(extractBanRecordId('旧记录 legacy-99 误封'), 'legacy-99')
  assert.equal(extractBanRecordId('无编号文本'), null)
  assert.ok(!appealEdges.submitted.includes('approved'))
  assert.ok(!appealEdges.need_info.includes('approved'))
})

test('申诉正文为空或仅保留模板时返回 400 empty_appeal', async () => {
  const { env } = createMockEnv()
  const basePayload = { lat: 25.27, lon: 110.29, view: null, kind: APPEAL, title: APPEAL }

  await assert.rejects(
    () => feedback(req('POST', 'feedback', { ...basePayload, body: '   ' }), env, 'feedback'),
    (err) => err instanceof Problem && err.status === 400 && err.code === 'empty_appeal',
  )
  await assert.rejects(
    () => feedback(req('POST', 'feedback', { ...basePayload, body: '封禁记录 ID：legacy-12\n申诉说明：' }), env, 'feedback'),
    (err) => err instanceof Problem && err.status === 400 && err.code === 'empty_appeal',
  )
})

test('他人 ban_record_id 触发 403 record_owner_mismatch', async () => {
  const { env } = createMockEnv({
    triageFn: async () => ({ ownerMismatch: true }),
  })
  await assert.rejects(
    () => feedback(req('POST', 'feedback', {
      lat: 25.27, lon: 110.29, view: null, kind: APPEAL, title: APPEAL,
      body: '当时正常骑车过桥，麻烦核实',
      ban_record_id: '11111111-2222-3333-4444-555555555555',
    }), env, 'feedback'),
    (err) => err instanceof Problem && err.status === 403 && err.code === 'record_owner_mismatch',
  )
})

test('结构化申诉落库、普通用户隐藏 appeal_triage、管理员独立状态机拒绝 approved 并可结案 unbanned', async () => {
  const recId = '12345678-1234-1234-1234-1234567890ab'
  const triageObj = {
    suspected_misban: true,
    recommendation: 'recommend_unban',
    summary: ['封禁时刻服务端存在丢包峰值，疑似网络抖动误判'],
  }
  const ctx = createMockEnv({
    triageFn: async ({ banRecordId }) => ({ ownerMismatch: false, recordId: banRecordId, triage: triageObj }),
  })

  // 1. 用户创建并提交申诉
  const createRes = await feedback(req('POST', 'feedback', {
    lat: 25.27, lon: 110.29, view: null, kind: APPEAL, title: APPEAL,
    body: '当时地铁上断线重连后就弹出受限提示',
    ban_record_id: recId,
  }), ctx.env, 'feedback')
  const created = await createRes.json()
  assert.equal(created.ban_record_id, recId)

  const submitRes = await feedback(req('POST', `feedback/${created.id}/submit`, {}), ctx.env, `feedback/${created.id}/submit`)
  assert.equal(submitRes.status, 200)

  // 2. 普通用户读取详情：应看到 ban_record_id，绝看不到 appeal_triage
  const userView = await (await feedback(req('GET', `feedback/${created.id}`), ctx.env, `feedback/${created.id}`)).json()
  assert.equal(userView.ban_record_id, recId)
  assert.equal(userView.appeal_triage, undefined)

  // 3. 切管理员身份查看：应看到 appeal_triage 且 allowed_transitions 不含 approved
  ctx.setUser({ id: 'admin-1', role: 'admin', email: 'admin@example.com' })
  const adminView = await (await feedback(req('GET', `admin/feedback/${created.id}`), ctx.env, `admin/feedback/${created.id}`)).json()
  assert.equal(adminView.ban_record_id, recId)
  assert.deepEqual(adminView.appeal_triage, triageObj)
  const statuses = adminView.allowed_transitions.map((t) => t.status)
  assert.ok(!statuses.includes('approved'))
  assert.ok(statuses.includes('unbanned'))
  assert.ok(statuses.includes('upheld'))

  // 4. 申诉单尝试转 approved 必须被拒（409 conflict）
  await assert.rejects(
    () => feedback(req('POST', `admin/feedback/${created.id}/status`, { status: 'approved' }), ctx.env, `admin/feedback/${created.id}/status`),
    (err) => err instanceof Problem && err.status === 409 && err.code === 'conflict',
  )

  // 5. 转 unbanned 不写说明被拒（400），写说明成功结案
  await assert.rejects(
    () => feedback(req('POST', `admin/feedback/${created.id}/status`, { status: 'unbanned' }), ctx.env, `admin/feedback/${created.id}/status`),
    (err) => err instanceof Problem && err.status === 400,
  )
  const unbanRes = await feedback(
    req('POST', `admin/feedback/${created.id}/status`, { status: 'unbanned', message: '已核实网络抖动导致，现已解除限制。' }),
    ctx.env,
    `admin/feedback/${created.id}/status`,
  )
  assert.equal(unbanRes.status, 200)

  // 6. unbanned 终态后禁止再发消息
  await assert.rejects(
    () => feedback(req('POST', `admin/feedback/${created.id}/messages`, { body: '追加消息' }), ctx.env, `admin/feedback/${created.id}/messages`),
    (err) => err instanceof Problem && err.status === 409 && err.code === 'conflict',
  )
})

test('兼容 PR #549：存量申诉可从 reviewing 结案为 resolved（必填说明），非申诉转 resolved 返回 409', async () => {
  const ctx = createMockEnv()
  const appealRes = await feedback(req('POST', 'feedback', {
    lat: 25.27, lon: 110.29, view: null, kind: APPEAL, title: APPEAL,
    body: '历史存量申诉测试说明',
  }), ctx.env, 'feedback')
  const { id: appealId } = await appealRes.json()
  ctx.feedbackRows.get(appealId).status = 'reviewing'

  ctx.setUser({ id: 'admin-1', role: 'admin', email: 'admin@example.com' })
  await assert.rejects(
    () => feedback(req('POST', `admin/feedback/${appealId}/status`, { status: 'resolved' }), ctx.env, `admin/feedback/${appealId}/status`),
    (err) => err instanceof Problem && err.status === 400,
  )
  const resolvedRes = await feedback(
    req('POST', `admin/feedback/${appealId}/status`, { status: 'resolved', message: '历史申诉已核实处理' }),
    ctx.env,
    `admin/feedback/${appealId}/status`,
  )
  assert.equal(resolvedRes.status, 200)
  await assert.rejects(
    () => feedback(req('POST', `admin/feedback/${appealId}/messages`, { body: '再回复' }), ctx.env, `admin/feedback/${appealId}/messages`),
    (err) => err instanceof Problem && err.status === 409 && err.code === 'conflict',
  )

  // 非申诉单不可转 resolved
  const bugId = 'normal-fb-1'
  ctx.feedbackRows.set(bugId, {
    ...ctx.feedbackRows.get(appealId),
    id: bugId,
    kind: '游戏 bug',
    status: 'submitted',
  })
  await assert.rejects(
    () => feedback(req('POST', `admin/feedback/${bugId}/status`, { status: 'resolved', message: '不应允许' }), ctx.env, `admin/feedback/${bugId}/status`),
    (err) => err instanceof Problem && err.status === 409 && err.code === 'conflict',
  )
})
