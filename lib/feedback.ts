import { type Env, Problem, equal, hash, invalid, limited, now, sessionHash, unauthorized } from './auth'
import { ll2xz } from './projection'
import { edges, kinds, labels, views } from './feedback-contract'
import { adminList } from './admin'

const json = (value: unknown) => Response.json(value, { headers: { 'Cache-Control': 'private, no-store' } })
function missing(): never {
  throw new Problem(404, 'not_found', '未找到记录')
}
function conflict(): never {
  throw new Problem(409, 'conflict', '当前状态不允许此操作')
}
function text(value: unknown, max: number, required = false) {
  if (value == null && !required) return null
  if (typeof value !== 'string' || Array.from(value.trim()).length > max || (required && !value.trim()))
    invalid()
  return value.trim()
}
function number(value: unknown, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid()
  return value
}
function link(value: unknown) {
  const url = text(value, 2048)
  if (url && !/^https:\/\//i.test(url)) invalid()
  return url
}
async function fields(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json().catch(invalid)
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
export async function feedback(request: Request, env: Env, path: string) {
  const method = request.method,
    bridge = path.startsWith('bridge/'),
    auth = request.headers.get('Authorization')
  const admin = path.startsWith('admin/') || path === 'admin'
  const machine = !admin && (bridge || !!auth)
  const comparison = /^(bridge|feedback)\/comparisons\/([0-9a-f]{64})$/.exec(path)
  if (comparison?.[1] === 'feedback' && method === 'GET') {
    const object = await env.FEEDBACK.get(`public/comparisons/${comparison[2]}.png`)
    if (!object) missing()
    return new Response(object.body, {
      headers: {
        'Content-Type': 'image/png',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    })
  }
  const stmt = (sql: string, ...args: (number | string | null)[]) => env.DB.prepare(sql).bind(...args)
  let user = ''
  let isAdmin = false
  if (machine) {
    if (!env.BRIDGE_TOKEN || !auth || !equal(await hash(auth), await hash(`Bearer ${env.BRIDGE_TOKEN}`)))
      unauthorized()
    if (!bridge && method !== 'GET') missing()
    if (comparison?.[1] === 'bridge' && method === 'PUT') {
      const length = Number(request.headers.get('content-length'))
      if (!Number.isInteger(length) || length < 8 || length > 12 * 1024 * 1024) invalid()
      const bytes = await request.arrayBuffer(),
        digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
      if (
        bytes.byteLength !== length ||
        ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => new Uint8Array(bytes)[index] === value) ||
        Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('') !== comparison[2]
      )
        invalid()
      await env.FEEDBACK.put(`public/comparisons/${comparison[2]}.png`, bytes)
      return json({ ok: true })
    }
  } else {
    const account = await stmt(
      'SELECT users.id,role FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.digest=? AND expires>? AND verified=1',
      await sessionHash(request),
      now(),
    ).first<{ id: string; role: string }>()
    if (!account) unauthorized()
    user = account.id
    isAdmin = account.role === 'admin'
    if (admin && !isAdmin) throw new Problem(403, 'forbidden', '无权限')
    if (method !== 'GET' && request.headers.get('Origin') !== new URL(request.url).origin)
      throw new Problem(403, 'origin', '请求来源不符')
    if (admin && method === 'GET' && ['admin/stats', 'admin/users', 'admin/feedback'].includes(path))
      return adminList(env.DB, path, new URL(request.url).searchParams)
    if (
      admin &&
      !(method === 'GET' && /^admin\/feedback\/[\w-]+$/.test(path)) &&
      !(method === 'POST' && /^admin\/feedback\/[\w-]+\/status$/.test(path))
    )
      missing()
  }
  if (path === 'bridge/pending' && method === 'GET')
    return json(
      (
        await stmt(
          "SELECT * FROM feedback WHERE status='submitted' OR (multica_issue IS NOT NULL AND status NOT IN ('draft','live','rejected','duplicate')) ORDER BY updated_at,id",
        ).all()
      ).results,
    )
  if (path === 'feedback' && !machine) {
    if (method === 'GET')
      return json(
        (
          await stmt(
            'SELECT id,title,status,updated_at FROM feedback WHERE user_id=? ORDER BY updated_at DESC,rowid DESC',
            user,
          ).all()
        ).results,
      )
    if (method !== 'POST') missing()
    const data = await fields(request),
      lat = number(data.lat, -90, 90),
      lon = number(data.lon, -180, 180),
      point = ll2xz(lat, lon)
    if (
      Math.abs(point.x) > 3072.000001 ||
      Math.abs(point.z) > 3328.000001 ||
      !kinds.includes(String(data.kind))
    )
      invalid()
    const id = crypto.randomUUID()
    const created = await stmt(
      `INSERT INTO feedback(id,user_id,kind,title,body,lat,lon,heading,landmark_id) SELECT ?,?,?,?,?,?,?,?,?
       WHERE (SELECT count(*) FROM feedback WHERE user_id=? AND status='draft')<3`,
      id,
      user,
      String(data.kind),
      text(data.title, 40, true),
      text(data.body ?? '', 2000),
      lat,
      lon,
      data.heading == null ? null : number(data.heading, 0, 360),
      text(data.landmark_id, 120),
      user,
    ).run()
    if (!created.meta.changes) throw new Problem(429, 'draft_limit', '最多保留 3 条草稿，请先提交或删除草稿')
    return json({ id })
  }
  const match =
    /^(bridge\/|admin\/)?feedback\/([\w-]+)(?:\/(submit|supplement|status|photos\/(?:[1-9]|1\d|20)))?$/.exec(
      path,
    )
  if (!match || (!admin && bridge !== (match[3] === 'status'))) missing()
  const [, , id, action] = match,
    row = await stmt(
      (admin
        ? 'SELECT f.*,u.email,u.nickname FROM feedback f JOIN users u ON u.id=f.user_id WHERE f.id=?'
        : 'SELECT * FROM feedback WHERE id=?') + ' AND (user_id=? OR ?=1)',
      id,
      user,
      Number(machine || admin || (isAdmin && method === 'GET' && action?.startsWith('photos/')) || false),
    ).first<{ status: string; multica_issue: string | null }>()
  if (!row) missing()
  if (!action && method === 'DELETE') {
    if (row.status !== 'draft') conflict()
    const [photos, removed] = await env.DB.batch<{ r2_key: string }>([
      stmt(
        `DELETE FROM feedback_photos WHERE feedback_id=? AND EXISTS(SELECT 1 FROM feedback WHERE id=? AND status='draft') RETURNING r2_key`,
        id,
        id,
      ),
      stmt(`DELETE FROM feedback WHERE id=? AND status='draft'`, id),
    ])
    if (!removed.meta.changes) conflict()
    if (photos.results.length) await env.FEEDBACK.delete(photos.results.map((photo) => String(photo.r2_key)))
    return json({ ok: true })
  }
  const photos = () =>
    stmt(
      'SELECT n,bytes,mime,view_label,exif_lat,exif_lon,exif_dir,exif_time FROM feedback_photos WHERE feedback_id=? AND ready=1 ORDER BY n',
      id,
    ).all()
  if (!action && method === 'GET')
    return json({
      ...row,
      ...(admin
        ? {
            issue_url: row.multica_issue
              ? `https://multica.ai/idoknow/issues/${encodeURIComponent(row.multica_issue)}`
              : null,
          }
        : {}),
      photos: (await photos()).results,
      events: (await stmt('SELECT * FROM feedback_events WHERE feedback_id=? ORDER BY id', id).all()).results,
    })
  if (action?.startsWith('photos/')) {
    const slot = Number(action.slice(7))
    if (method === 'GET') {
      const photo = await stmt(
        'SELECT r2_key,mime FROM feedback_photos WHERE feedback_id=? AND n=? AND ready=1',
        id,
        slot,
      ).first<{ r2_key: string; mime: string }>()
      if (!photo) missing()
      const object = await env.FEEDBACK.get(photo.r2_key)
      if (!object) missing()
      return new Response(object.body, {
        headers: {
          'Content-Type': photo.mime,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'Cache-Control': 'private, no-store',
        },
      })
    }
    if (!['draft', 'need_info'].includes(row.status)) conflict()
    if (method === 'DELETE') {
      const photo = await stmt(
        `DELETE FROM feedback_photos WHERE feedback_id=? AND n=? AND EXISTS(SELECT 1 FROM feedback WHERE id=? AND status=?) RETURNING r2_key`,
        id,
        slot,
        id,
        row.status,
      ).first<{ r2_key: string }>()
      if (!photo) missing()
      await env.FEEDBACK.delete(photo.r2_key)
      return json({ ok: true })
    }
    if (method !== 'PUT') missing()
    const size = Number(request.headers.get('content-length')),
      mime = request.headers.get('content-type') ?? '',
      extensions: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/heic': 'heic',
      }
    if (
      !Number.isInteger(size) ||
      size <= 0 ||
      size > 12 * 1024 * 1024 ||
      !Object.hasOwn(extensions, mime) ||
      !request.body
    )
      invalid()
    let meta
    try {
      meta = JSON.parse(decodeURIComponent(request.headers.get('X-Photo-Meta') ?? '{}'))
    } catch {
      invalid()
    }
    if (!meta || typeof meta !== 'object' || (meta.view_label && !views.includes(meta.view_label))) invalid()
    const key = `fb/${id}/${slot}/${crypto.randomUUID()}.${extensions[mime]}`,
      num = (key: string, min: number, max: number) =>
        meta[key] == null ? null : number(meta[key], min, max)
    const [, prior, reserved] = await env.DB.batch<{ r2_key: string }>([
      stmt('DELETE FROM feedback_upload_usage WHERE uploaded_at<=unixepoch()-86400'),
      stmt('SELECT r2_key FROM feedback_photos WHERE feedback_id=? AND n=?', id, slot),
      stmt(
        `INSERT INTO feedback_photos(feedback_id,n,r2_key,bytes,mime,view_label,exif_lat,exif_lon,exif_dir,exif_time)
       SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM feedback WHERE id=? AND status=?)
       AND (SELECT coalesce(sum(bytes),0) FROM feedback_upload_usage WHERE user_id=?) + ? <= 314572800
       ON CONFLICT(feedback_id,n) DO UPDATE SET r2_key=excluded.r2_key,bytes=excluded.bytes,mime=excluded.mime,
       view_label=excluded.view_label,exif_lat=excluded.exif_lat,exif_lon=excluded.exif_lon,exif_dir=excluded.exif_dir,
       exif_time=excluded.exif_time,uploaded_at=excluded.uploaded_at,ready=0`,
        id,
        slot,
        key,
        size,
        mime,
        meta.view_label || null,
        num('exif_lat', -90, 90),
        num('exif_lon', -180, 180),
        num('exif_dir', 0, 360),
        text(meta.exif_time, 64),
        id,
        row.status,
        user,
        size,
      ),
    ])
    if (!reserved.meta.changes) {
      if ((await stmt('SELECT status FROM feedback WHERE id=?', id).first('status')) !== row.status)
        conflict()
      throw new Problem(429, 'upload_limit', '24 小时内最多上传 300 MB，请稍后再试')
    }
    try {
      if (prior.results.length) await env.FEEDBACK.delete(String(prior.results[0].r2_key))
      await env.FEEDBACK.put(key, request.body)
      const completed = await stmt(
        'UPDATE feedback_photos SET ready=1 WHERE feedback_id=? AND n=? AND r2_key=?',
        id,
        slot,
        key,
      ).run()
      if (!completed.meta.changes) conflict()
    } catch (error) {
      await env.FEEDBACK.delete(key)
      await stmt(
        'DELETE FROM feedback_photos WHERE feedback_id=? AND n=? AND r2_key=? AND ready=0',
        id,
        slot,
        key,
      ).run()
      throw error
    }
    return json({ n: slot })
  }
  if (method !== 'POST') missing()
  let target: string,
    message: string,
    screenshot = null,
    issue = null,
    pr = null,
    guard = ''
  if (action === 'submit') {
    if (row.status !== 'draft') conflict()
    target = 'submitted'
    message = '已提交，等待处理'
    guard = ` AND EXISTS(SELECT 1 FROM feedback_photos WHERE feedback_id=feedback.id AND ready=1) AND (SELECT count(*) FROM feedback f WHERE f.user_id=feedback.user_id AND f.submitted_at>unixepoch()-86400)<5`
  } else if (action === 'supplement') {
    if (row.status !== 'need_info') conflict()
    target = 'submitted'
    message = text((await fields(request)).body, 2000, true)!
  } else if (bridge || admin) {
    const data = await fields(request)
    target = String(data.status)
    if (!edges[row.status]) conflict()
    if (bridge && target === row.status) return json({ ok: true })
    if (!edges[row.status].includes(target)) conflict()
    message =
      text(data.message, 2000, ['need_info', 'rejected', 'duplicate'].includes(target)) || labels[target]
    if (bridge) {
      screenshot =
        typeof data.screenshot_url === 'string' &&
        /^\/api\/feedback\/comparisons\/[a-f0-9]{64}$/.test(data.screenshot_url)
          ? data.screenshot_url
          : link(data.screenshot_url)
      issue = text(data.multica_issue, 128)
      pr = link(data.pr_url)
    }
  } else missing()
  const [changed] = await env.DB.batch([
    stmt(
      `UPDATE feedback SET status=?,updated_at=unixepoch(),submitted_at=CASE WHEN status='draft' THEN unixepoch() ELSE submitted_at END,multica_issue=coalesce(?,multica_issue),pr_url=coalesce(?,pr_url) WHERE id=? AND status=? AND NOT EXISTS(SELECT 1 FROM feedback_photos WHERE feedback_id=feedback.id AND ready=0)${guard}`,
      target,
      issue,
      pr,
      id,
      row.status,
    ),
    stmt(
      'INSERT INTO feedback_events(feedback_id,status,message,screenshot_url) SELECT ?,?,?,? WHERE changes()=1',
      id,
      target,
      message,
      screenshot,
    ),
  ])
  if (!changed.meta.changes) {
    if (
      action === 'submit' &&
      ((await stmt(
        'SELECT count(*) AS total FROM feedback WHERE user_id=? AND submitted_at>unixepoch()-86400',
        user,
      ).first<number>('total')) ?? 0) >= 5
    )
      limited()
    if (
      bridge &&
      edges[target] &&
      (await stmt('SELECT status FROM feedback WHERE id=?', id).first('status')) === target
    )
      return json({ ok: true })
    conflict()
  }
  return json({ ok: true })
}
