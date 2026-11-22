import { invalid, Problem } from './auth'
import { labels } from './feedback-contract'
import { userSocialIdentities } from './social'

export function audit(db: D1Database, actor: string, action: string, type: string, id: string, detail: object) {
  return db.prepare('INSERT INTO admin_audit(actor_id,action,target_type,target_id,detail) SELECT ?,?,?,?,? WHERE changes()=1')
    .bind(actor,action,type,id,JSON.stringify(detail))
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
      `SELECT u.id,u.email,u.nickname,u.verified,u.role,u.created_at,
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
    ? `u.id,u.email,u.nickname,u.verified,u.role,u.created_at,
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
  return json({
    items: results
      .slice(0, 50)
      .map(({ page_key, ...row }) => (users ? { ...row, verified: !!row.verified } : row)),
    next_cursor: results.length > 50 ? String(results[49].page_key) : null,
  })
}
