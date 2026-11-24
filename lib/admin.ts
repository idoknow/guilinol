import { invalid, passwordHash, Problem, random } from './auth'
import { labels } from './feedback-contract'
import { isSocialType, userSocialIdentities } from './social'

export function audit(db: D1Database, actor: string, action: string, type: string, id: string, detail: object) {
  return db.prepare('INSERT INTO admin_audit(actor_id,action,target_type,target_id,detail) SELECT ?,?,?,?,? WHERE changes()=1')
    .bind(actor,action,type,id,JSON.stringify(detail))
}

export async function setBan(db: D1Database, actor: string, id: string, ban: boolean, reason: unknown) {
  const message = typeof reason === 'string' ? reason.trim() : ''
  if (ban && (!message || [...message].length > 200)) invalid()
  if (ban && actor === id) throw new Problem(409,'self_ban','不能封禁自己')
  const read = db.prepare('SELECT id,role,banned_at,ban_reason FROM users WHERE id=?').bind(id)
  const update = ban
    ? db.prepare("UPDATE users SET banned_at=unixepoch(),ban_reason=?,banned_by=? WHERE id=? AND banned_at=0 AND role<>'admin'").bind(message,actor,id)
    : db.prepare("UPDATE users SET banned_at=0,ban_reason='',banned_by='' WHERE id=? AND banned_at<>0").bind(id)
  const writes = [update, audit(db,actor,ban?'ban':'unban','user',id,ban?{reason:message}:{})]
  if (ban) writes.push(db.prepare('DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND banned_at<>0)').bind(id,id))
  const results = await db.batch<{role:string;banned_at:number;ban_reason:string}>([...writes,read])
  const row = results.at(-1)?.results[0]
  if (!row) throw new Problem(404,'not_found','找不到该用户')
  if (ban && row.role==='admin') throw new Problem(409,'ban_admin','请先取消管理员身份')
  return Response.json({id,banned_at:row.banned_at,ban_reason:row.ban_reason},{headers:{'Cache-Control':'private, no-store'}})
}

export async function setRole(db: D1Database, actor: string, id: string, role: unknown) {
  if (role !== 'admin' && role !== 'user') invalid()
  // PostgreSQL serializes these batches with its shared advisory lock. D1 batches are atomic.
  const [before, admins, changed] = await db.batch<{role:string; verified:number; n:number}>([
    db.prepare('SELECT role,verified FROM users WHERE id=?').bind(id),
    db.prepare("SELECT count(*) n FROM users WHERE role='admin'"),
    db.prepare(`UPDATE users SET role=? WHERE id=? AND verified=1 AND role<>?
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND role='admin')
      AND (?='admin' OR (id<>? AND (SELECT count(*) FROM users WHERE role='admin')>1))`)
      .bind(role,id,role,actor,role,actor),
    audit(db,actor,'role','user',id,{role}),
  ])
  const target=before.results[0]
  if (!target) throw new Problem(404,'not_found','找不到该用户')
  if (!target.verified) throw new Problem(409,'unverified','用户尚未验证邮箱')
  if (role==='user' && target.role==='admin' && admins.results[0].n===1) throw new Problem(409,'last_admin','必须保留至少一名管理员')
  if (role==='user' && actor===id) throw new Problem(409,'self_demotion','不能取消自己的管理员身份')
  if (role!==target.role && !changed.meta.changes) throw new Problem(403,'forbidden','无权限')
  return Response.json({id,role},{headers:{'Cache-Control':'private, no-store'}})
}


const pendingFilter = "(f.status='submitted' OR (f.status='need_info' AND EXISTS(SELECT 1 FROM feedback_messages m WHERE m.feedback_id=f.id AND m.author_kind='user' AND m.id>f.admin_read_id)))"

/** 后台用户详情：账号信息 + 已绑定的第三方平台（不含 salt/digest，social_uid 只回后 6 位）。 */
export async function adminUserDetail(db: D1Database, id: string) {
  const json = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } })
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) invalid()
  const user = await db
    .prepare(
      `SELECT u.id,u.email,u.nickname,u.verified,u.role,u.created_at,u.email_placeholder,u.signup_method,u.banned_at,u.ban_reason,u.banned_by,
      (SELECT count(*) FROM feedback WHERE user_id=u.id) feedback_count,
      (SELECT max(submitted_at) FROM feedback WHERE user_id=u.id) last_submitted_at FROM users u WHERE u.id=?`,
    )
    .bind(id)
    .first<Record<string, unknown>>()
  if (!user) return json({ error: { code: 'not_found', message: '未找到用户' } }, 404)
  return json({ user: { ...user, verified: !!user.verified }, social: await userSocialIdentities(db, id) })
}

export async function adminList(db: D1Database, path: string, params: URLSearchParams) {
  const json = (value: unknown) => Response.json(value, { headers: { 'Cache-Control': 'private, no-store' } })
  if(path==='admin/audit'){
    const filters:string[]=[],args:(string|number)[]=[]
    const cursor=params.get('cursor')
    if(cursor!==null){
      if(!/^\d+$/.test(cursor)||!Number.isSafeInteger(Number(cursor)))invalid()
      filters.push('id<?');args.push(Number(cursor))
    }
    for(const key of ['target_type','target_id']){
      const value=params.get(key)
      if(value!==null){filters.push(key+'=?');args.push(value)}
    }
    const where=filters.length?' WHERE '+filters.join(' AND '):''
    const {results}=await db.prepare('SELECT * FROM admin_audit'+where+' ORDER BY id DESC LIMIT 51').bind(...args).all()
    return json({items:results.slice(0,50).map(row=>({...row,detail:typeof row.detail==='string'?JSON.parse(row.detail):row.detail})),
      next_cursor:results.length>50?String(results[49].id):null})
  }
  if (path === 'admin/signups') {
    // 用户管理页的注册曲线：按小时分桶的新增数 + 窗口起点之前的存量（前端累加成总数曲线）。
    const hours = Math.min(Math.max(Math.floor(Number(params.get('hours')) || 72), 1), 24 * 90)
    const from = (Math.floor(Date.now() / 3600e3) - hours + 1) * 3600
    const [base, rows] = await db.batch<Record<string, string | number>>([
      db.prepare('SELECT count(*) AS n FROM users WHERE created_at<?').bind(from),
      db.prepare('SELECT (created_at/3600)*3600 AS t,count(*) AS n FROM users WHERE created_at>=? GROUP BY (created_at/3600)*3600 ORDER BY 1').bind(from),
    ])
    return json({ from, hours, base: Number(base.results[0]?.n ?? 0), points: rows.results.map((row) => ({ t: Number(row.t), n: Number(row.n) })) })
  }
  if (path === 'admin/stats') {
    const [users, statuses, pending] = await db.batch<Record<string, string | number>>([
      db.prepare(
        'SELECT count(*) AS total,count(*) FILTER(WHERE verified=1) AS verified,count(*) FILTER(WHERE created_at>=unixepoch()-86400) AS new_24h FROM users',
      ),
      db.prepare('SELECT status,count(*) AS count FROM feedback GROUP BY status'),
      db.prepare(`SELECT count(*) n FROM feedback f WHERE ${pendingFilter}`),
    ])
    return json({
      ...users.results[0],
      pending: pending.results[0].n,
      feedback: {...Object.fromEntries(Object.keys(labels).map(key=>[key,0])), ...Object.fromEntries(statuses.results.map(row=>[row.status,row.count]))},
    })
  }
  const users = path === 'admin/users',
    alias = users ? 'u' : 'f',
    filters: string[] = [],
    args: (number | string)[] = []
  const cursor = params.get('cursor'),
    query = params.get('q')?.trim()
  if (cursor) {
    if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) invalid()
    filters.push(`${alias}.rowid < ?`)
    args.push(Number(cursor))
  }
  if (query) {
    const columns = users ? ['u.email', 'u.nickname'] : ['f.title', 'f.body', 'u.email', 'u.nickname']
    filters.push(`(${columns.map((col) => `instr(lower(${col}),lower(?))>0`).join(' OR ')})`)
    args.push(...columns.map(() => query))
  }
  if (users && params.get('role')) {
    const role=params.get('role')
    if(role!=='admin' && role!=='user') invalid()
    filters.push('u.role=?')
    args.push(role)
  }
  if (users) {
    const signup=params.get('signup'), bound=params.get('bound'), status=params.get('status')
    if (signup!==null) {
      if (signup!=='email' && !isSocialType(signup)) invalid()
      filters.push('u.signup_method=?')
      args.push(signup)
    }
    if (bound!==null) {
      if (!isSocialType(bound)) invalid()
      filters.push('EXISTS(SELECT 1 FROM social_identities s WHERE s.user_id=u.id AND s.type=?)')
      args.push(bound)
    }
    if (status!==null) {
      if (status!=='active' && status!=='banned') invalid()
      filters.push(status==='active'?'u.banned_at=0':'u.banned_at<>0')
    }
  }
  if (!users) {
    const status = params.get('status'),
      user = params.get('user')
    if(status==='pending')filters.push(pendingFilter)
    else if (status) {
      if (!Object.hasOwn(labels, status)) invalid()
      filters.push('f.status=?')
      args.push(status)
    }
    if (user) {
      filters.push('f.user_id=?')
      args.push(user)
    }
  }
  const select = users
    ? `u.id,u.email,u.nickname,u.verified,u.role,u.created_at,u.signup_method,u.email_placeholder,u.banned_at,u.ban_reason,
    (SELECT count(*) FROM feedback WHERE user_id=u.id) feedback_count,
    (SELECT max(submitted_at) FROM feedback WHERE user_id=u.id) last_submitted_at FROM users u`
    : `f.id,f.user_id,f.title,f.kind,f.status,u.email,u.nickname,f.lat,f.lon,f.multica_issue,f.pr_url,f.submitted_at,f.updated_at,
    (SELECT count(*) FROM feedback_messages WHERE feedback_id=f.id AND author_kind='user' AND id>f.admin_read_id) unread,(SELECT count(*) FROM feedback_photos WHERE feedback_id=f.id AND ready=1) photo_count FROM feedback f JOIN users u ON u.id=f.user_id`
  const { results } = await db
    .prepare(
      `SELECT ${alias}.rowid AS page_key,${select} ${filters.length ? 'WHERE ' + filters.join(' AND ') : ''} ORDER BY ${alias}.rowid DESC LIMIT 51`,
    )
    .bind(...args)
    .all()
  const page = results.slice(0,50)
  const social = new Map<unknown, Record<string,unknown>[]>()
  if (users && page.length) {
    const ids = page.map(row=>row.id)
    const identities = await db.prepare(`SELECT user_id,type,nickname,created_at,last_login_at FROM social_identities
      WHERE user_id IN (${ids.map(()=>'?').join(',')}) ORDER BY user_id,created_at,type`).bind(...ids).all()
    for (const {user_id,...identity} of identities.results) {
      const group = social.get(user_id) ?? []
      group.push(identity)
      social.set(user_id,group)
    }
  }
  return json({
    items: page
      .map(({ page_key, ...row }) => (users ? { ...row, verified: !!row.verified, email_placeholder: !!row.email_placeholder, social: social.get(row.id) ?? [] } : row)),
    next_cursor: results.length > 50 ? String(results[49].page_key) : null,
  })
}

type MergeUserRow = {
  id: string
  email: string
  email_placeholder: number
  nickname: string
  verified: number
  role: string
  salt: string
  digest: string
}

/**
 * 合并账号：把 from 并入 target（target 保留），用于「同一个人先用第三方注册、
 * 后来又用邮箱注册」这类重复账号。
 *
 * - 第三方绑定：target 没有的平台搬过去；两边都有的平台保留 target 的（列进 conflicts）
 * - 邮箱：target 是占位邮箱而 from 有真实邮箱时，把邮箱/密码/验证状态继承过来
 * - 存档：target 没有存档才接管 from 的；流水/反馈一律搬过去
 * - from 的会话、待确认授权直接清掉，最后删掉 from 这行（连带清掉冲突的绑定）
 */
export async function adminMergeUsers(db: D1Database, actor: string, targetId: string, body: Record<string, unknown>) {
  const json = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } })
  const pattern = /^[A-Za-z0-9-]{8,64}$/
  let fromId = typeof body.from === 'string' ? body.from.trim() : ''
  // 允许直接填被合并账号的邮箱
  if (fromId.includes('@')) {
    const found = await db.prepare('SELECT id FROM users WHERE email=?').bind(fromId.toLowerCase()).first<{ id: string }>()
    if (!found) return json({ error: { code: 'not_found', message: '被合并账号不存在' } }, 404)
    fromId = found.id
  }
  if (!pattern.test(targetId) || !pattern.test(fromId) || fromId === targetId)
    return json({ error: { code: 'invalid_input', message: '请选择两个不同的账号' } }, 400)

  const cols = 'id,email,email_placeholder,nickname,verified,role,salt,digest'
  const target = await db.prepare(`SELECT ${cols} FROM users WHERE id=?`).bind(targetId).first<MergeUserRow>()
  const source = await db.prepare(`SELECT ${cols} FROM users WHERE id=?`).bind(fromId).first<MergeUserRow>()
  if (!target || !source) return json({ error: { code: 'not_found', message: '账号不存在' } }, 404)

  const sourceTypes = (
    await db.prepare('SELECT type FROM social_identities WHERE user_id=? ORDER BY type').bind(fromId).all<{ type: string }>()
  ).results.map((row) => row.type)
  const targetTypes = new Set(
    (await db.prepare('SELECT type FROM social_identities WHERE user_id=?').bind(targetId).all<{ type: string }>()).results.map(
      (row) => row.type,
    ),
  )
  const movable = sourceTypes.filter((type) => !targetTypes.has(type))
  const conflicts = sourceTypes.filter((type) => targetTypes.has(type))

  const statements: D1PreparedStatement[] = [
    db.prepare(`UPDATE users SET (banned_at,ban_reason,banned_by) =
      (SELECT banned_at,ban_reason,banned_by FROM users WHERE id=?)
      WHERE id=? AND banned_at=0 AND EXISTS(SELECT 1 FROM users WHERE id=? AND banned_at<>0)`).bind(fromId,targetId,fromId),
    db.prepare('DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND banned_at<>0)').bind(targetId,targetId),
  ]
  // 只在来源邮箱已验证时继承：未验证的邮箱继承过来会把目标账号降成 verified=0，
  // 之后 socialConfirm 的 verified 检查会把这个人的第三方登录也挡掉。
  const adoptedEmail = target.email_placeholder && !source.email_placeholder && source.verified ? source.email : ''
  // 邮箱唯一约束：必须在来源账号被删除之后才能把邮箱改到目标账号上（见语句最后一步）
  for (const type of movable)
    statements.push(db.prepare('UPDATE social_identities SET user_id=? WHERE user_id=? AND type=?').bind(targetId, fromId, type))

  const targetSaves = await db.prepare('SELECT count(*) n FROM player_saves WHERE user_id=?').bind(targetId).first<{ n: number }>()
  const sourceSaves = await db.prepare('SELECT count(*) n FROM player_saves WHERE user_id=?').bind(fromId).first<{ n: number }>()
  const force = body.force === true
  // 两边都有存档时合并只能留一份（user_id 是主键），默认拒绝，由管理员决定；
  // 不要用 UPDATE OR IGNORE：SQLite 专有，生产 Postgres 直接语法错误
  if (targetSaves?.n && sourceSaves?.n && !force)
    return json({ error: { code: 'save_conflict', message: '两个账号都有存档；确认丢弃被合并账号的存档请带 force:true 重试' } }, 409)
  const tookSaves = !targetSaves?.n && !!sourceSaves?.n
  // 存档：user_id 是主键，两边都有存档时只能留一份。
  // 计数只用于决定要不要 409（让管理员知道会丢存档），真正的迁移与删除放在同一个 batch 里：
  //   目标在「计数之后、批次执行之前」新建了存档时，先删掉来源的存档再迁移剩下的，
  //   既不撞主键让整个合并回滚，也不把来源存档留在即将被删除的账号上。
  // 不要用 UPDATE OR IGNORE：SQLite 专有，生产 Postgres 直接语法错误
  statements.push(
    db
      .prepare('DELETE FROM player_saves WHERE user_id=? AND EXISTS(SELECT 1 FROM player_saves t WHERE t.user_id=?)')
      .bind(fromId, targetId),
    db.prepare('UPDATE player_saves SET user_id=? WHERE user_id=?').bind(targetId, fromId),
  )
  // 来源是管理员而目标不是：把角色转过去，否则合并完就没人能进后台了
  if (source.role === 'admin' && target.role !== 'admin') {
    // 管理员要求 verified=1：目标没验证就把角色转过去，等于谁也别想进后台
    if (!target.verified)
      return json({ error: { code: 'target_unverified', message: '被保留的账号未验证邮箱，先把它的邮箱验证了再合并' } }, 400)
    statements.push(db.prepare("UPDATE users SET role='admin' WHERE id=?").bind(targetId))
  }

  statements.push(
    // 幂等键 (user_id,idempotency_key) 是唯一索引：先给与目标冲突的行换一个必定不重复的键，
    // 再整批搬过去，否则跳过冲突行会把这些行留在源账号上，随后 source 被删 → 流水凭空消失。
    // 新键用「原键 + :merged: + 来源用户 id」，而不是 merged-<tx_id>：
    // tx_id 只在表内唯一，原键在目标侧已存在时 merged-<tx_id> 仍可能与某个手写键撞上；
    // 拼上来源 id 后目标侧不可能存在同样的键（一个来源账号只能合并一次，合并后即删除）。
    db
      .prepare(
        `UPDATE player_ledger_txns SET idempotency_key = idempotency_key || ':merged:' || user_id
         WHERE user_id=? AND idempotency_key IN (SELECT idempotency_key FROM player_ledger_txns WHERE user_id=?)`,
      )
      .bind(fromId, targetId),
    db.prepare('UPDATE player_ledger_txns SET user_id=? WHERE user_id=?').bind(targetId, fromId),
    db.prepare('UPDATE feedback SET user_id=? WHERE user_id=?').bind(targetId, fromId),
    db.prepare('UPDATE feedback_upload_usage SET user_id=? WHERE user_id=?').bind(targetId, fromId),
    db.prepare('DELETE FROM sessions WHERE user_id=?').bind(fromId),
    db.prepare('DELETE FROM social_pending WHERE user_id=?').bind(fromId),
    db.prepare('DELETE FROM social_states WHERE user_id=?').bind(fromId),
    db.prepare('DELETE FROM users WHERE id=?').bind(fromId),
  )
  if (adoptedEmail)
    statements.push(
      db
        .prepare('UPDATE users SET email=?,salt=?,digest=?,verified=?,email_placeholder=0 WHERE id=?')
        .bind(source.email, source.salt, source.digest, source.verified, targetId),
    )
  // 存档计数进审计：目标侧已有存档、来源存档被丢弃时，事后能查到丢了几个
  const detail = {from:fromId,from_email:source.email,adopted_email:adoptedEmail,moved:movable,conflicts,took_saves:tookSaves,source_saves:sourceSaves?.n ?? 0,target_saves:targetSaves?.n ?? 0}
  // Read the resulting ban state in the same batch as the merge.
  for (const banned of [false,true]) {
    statements.push(db.prepare(`INSERT INTO admin_audit(actor_id,action,target_type,target_id,detail)
      SELECT ?,'merge_users','user',id,? FROM users WHERE id=? AND banned_at${banned?'<>':'='}0`)
      .bind(actor,JSON.stringify({...detail,banned}),targetId))
  }
  await db.batch(statements)
  return json({
    ok: true,
    target: { id: targetId, email: adoptedEmail || target.email },
    merged: { id: fromId, email: source.email, nickname: source.nickname },
    moved: movable,
    conflicts,
    adopted_email: adoptedEmail,
    took_saves: tookSaves,
  })
}

/**
 * 后台重置密码：不传就生成一个随机密码，返回给管理员转交用户。
 * 占位邮箱账号（第三方专用）也能用这个办法拿到可用的密码登录方式。
 */
export async function adminSetPassword(db: D1Database, actor: string, id: string, body: Record<string, unknown>) {
  const json = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } })
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) invalid()
  const user = await db.prepare('SELECT id,email FROM users WHERE id=?').bind(id).first<{ id: string; email: string }>()
  if (!user) return json({ error: { code: 'not_found', message: '未找到用户' } }, 404)

  const provided = typeof body.password === 'string' ? body.password : ''
  if (provided && (provided.length < 8 || provided.length > 256))
    return json({ error: { code: 'invalid_input', message: '密码长度需 8–256 位' } }, 400)
  const password = provided || random(6) + random(2).toUpperCase()
  const salt = random(16)
  await db.batch([
    db
      .prepare('UPDATE users SET salt=?,digest=?,failures=0,locked_until=0 WHERE id=?')
      .bind(salt, await passwordHash(password, salt), id),
    // audit() 用 changes()=1 判断上一条是否生效，必须紧跟 UPDATE users；
    // 放在 DELETE sessions 后面，用户不是恰好 1 个会话就不会留审计（#146 已修过一次）
    audit(db, actor, 'reset_password', 'user', id, { generated: !provided }),
    // 旧会话全部失效：改密码等于把人踢下线
    db.prepare('DELETE FROM sessions WHERE user_id=?').bind(id),
  ])
  return json({ ok: true, email: user.email, password })
}

/** 后台改邮箱：直接写，打掉占位标记；邮箱被占用时 409。 */
export async function adminSetEmail(db: D1Database, actor: string, id: string, body: Record<string, unknown>) {
  const json = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } })
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) invalid()
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (email.length > 254 || email.split('@').length !== 2 || !/^\S+@[^\s@]+\.[^\s@]+$/.test(email))
    return json({ error: { code: 'invalid_input', message: '邮箱格式不对' } }, 400)
  const user = await db.prepare('SELECT id,email FROM users WHERE id=?').bind(id).first<{ id: string; email: string }>()
  if (!user) return json({ error: { code: 'not_found', message: '未找到用户' } }, 404)
  const owner = await db.prepare('SELECT id FROM users WHERE email=?').bind(email).first<{ id: string }>()
  if (owner && owner.id !== id) return json({ error: { code: 'email_taken', message: '该邮箱已被其他账号使用' } }, 409)
  await db.batch([
    db.prepare('UPDATE users SET email=?,email_placeholder=0 WHERE id=?').bind(email, id),
    audit(db, actor, 'change_email', 'user', id, { from: user.email, to: email }),
  ])
  return json({ ok: true, email })
}
