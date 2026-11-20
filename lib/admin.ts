import { invalid } from './auth'
import { labels } from './feedback-contract'

export async function adminList(db: D1Database, path: string, params: URLSearchParams) {
  const json = (value: unknown) => Response.json(value, { headers: { 'Cache-Control': 'private, no-store' } })
  if (path === 'admin/stats') {
    const [users, statuses] = await db.batch<Record<string, string | number>>([
      db.prepare(
        'SELECT count(*) AS total,count(*) FILTER(WHERE verified=1) AS verified,count(*) FILTER(WHERE created_at>=unixepoch()-86400) AS new_24h FROM users',
      ),
      db.prepare('SELECT status,count(*) AS count FROM feedback GROUP BY status'),
    ])
    return json({
      ...users.results[0],
      feedback: Object.fromEntries(statuses.results.map((row) => [row.status, row.count])),
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
  if (!users) {
    const status = params.get('status'),
      user = params.get('user')
    if(status==='pending')filters.push("f.status IN ('submitted','need_info')")
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
