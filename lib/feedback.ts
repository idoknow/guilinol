import { type Env, Problem, equal, hash, invalid, limited, now, sessionAccount, sessionHash, unauthorized } from './auth'
import { ll2xz } from './projection'
import { APPEAL, BUG, TERMINAL_STATUSES, appealEdges, edges, extractBanRecordId, kinds, labels, photosOptional, stripAppealTemplate, views, validView } from './feedback-contract'
import { adminList, adminMergeUsers, adminSetEmail, adminSetPassword, adminUserDetail, audit, setBan, setRole } from './admin'
import {flushMail} from './feedback-mail'

const json = (value: unknown) => Response.json(value, { headers: { 'Cache-Control': 'private, no-store' } })
const TERMINAL = new Set<string>(TERMINAL_STATUSES)
function transitions(current: string, bridge: boolean, kind?: string | null) {
  const table = kind === APPEAL ? appealEdges : edges
  return (table[current] ?? []).filter((status) => kind === APPEAL || status !== (bridge ? 'approved' : 'queued')).map((status) => ({
    status,
    label: labels[status],
    needs_message: ['need_info', 'rejected', 'duplicate', 'resolved', 'unbanned', 'upheld'].includes(status),
  }))
}
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
const DEFAULT_AUTO_APPROVE_EMAILS = ['xiepy244@gmail.com']
function autoApproveEmails(env: Env) {
  if (env.FEEDBACK_AUTO_APPROVE_EMAILS === undefined) return DEFAULT_AUTO_APPROVE_EMAILS
  return env.FEEDBACK_AUTO_APPROVE_EMAILS.split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry && entry !== 'none')
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
  let accountUid = 0
  let isAdmin = false
  let accountEmail = ''
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
    const account = await sessionAccount(env.DB,await sessionHash(request))
    if (!account?.verified) unauthorized()
    user = account.id
    accountUid = Number(account.uid) || 0
    isAdmin = account.role === 'admin'
    accountEmail = account.email.toLowerCase()
    if (admin && !isAdmin) throw new Problem(403, 'forbidden', '无权限')
    if (method !== 'GET' && request.headers.get('Origin') !== new URL(request.url).origin)
      throw new Problem(403, 'origin', '请求来源不符')
    const banTarget=/^admin\/users\/([\w-]+)\/(ban|unban)$/.exec(path)
    if(admin && env.traceAdmin && ['admin/trace','admin/trace/action'].includes(path)) return env.traceAdmin(path,request,user)
    if(admin&&path==='admin/smoke'&&env.smokeAdmin)return env.smokeAdmin(request,user)
    if(admin&&path==='admin/gfx'&&env.gfxAdmin)return env.gfxAdmin(request,user)
    if(admin&&path==='admin/npc'&&env.npcAdmin)return env.npcAdmin(request)
    if(admin && /^admin\/(?:mp|chat|bans|ban|ban-record|unban|unban-window|appeal-resolve|user-search|security-search)(?:\/|$)/.test(path) && env.mpAdmin) return env.mpAdmin(path,request,user)
    if (banTarget && method==='POST') {
      const ban=banTarget[2]==='ban'
      return setBan(env.DB,user,banTarget[1]!,ban,ban?(await fields(request)).reason:null)
    }
    const roleTarget=/^admin\/users\/([\w-]+)\/role$/.exec(path)
    if (roleTarget && method==='POST') return setRole(env.DB,user,roleTarget[1],(await fields(request)).role)
    if (admin && method==='GET' && env.perfQuery && ['admin/perf','admin/perf/grid','admin/perf/server','admin/overview','admin/timeseries','admin/breakdown','admin/funnel','admin/errors','admin/live'].includes(path))
      return env.perfQuery(path,new URL(request.url).searchParams)
    if (admin && method === 'GET' && ['admin/stats', 'admin/signups', 'admin/audit','admin/users', 'admin/feedback'].includes(path)) {
      const search = new URL(request.url).searchParams
      if (env.perfQuery && (path === 'admin/stats' || path === 'admin/signups'))
        return env.perfQuery(path, search, (p, q) => adminList(env.DB, p, q))
      return adminList(env.DB, path, search)
    }
    // 用户详情：与 admin/users/:id/role 走同一个 admin 鉴权分支（role 已是 'admin' 才走到这里）
    const userDetail = /^admin\/users\/([A-Za-z0-9-]{8,64})$/.exec(path)
    if (userDetail && method === 'GET') return adminUserDetail(env.DB, userDetail[1]!)
    // 合并账号：把 :id 之外的重复账号并进来（后台用户详情页用）
    const mergeTarget = /^admin\/users\/([A-Za-z0-9-]{8,64})\/merge$/.exec(path)
    if (mergeTarget && method === 'POST' && admin) return adminMergeUsers(env.DB, user, mergeTarget[1]!, await fields(request))
    // 运营操作：重置密码 / 改邮箱（占位邮箱账号也能用这两条救回来）
    const passwordTarget = /^admin\/users\/([A-Za-z0-9-]{8,64})\/password$/.exec(path)
    if (passwordTarget && method === 'POST' && admin) return adminSetPassword(env.DB, user, passwordTarget[1]!, await fields(request))
    const emailTarget = /^admin\/users\/([A-Za-z0-9-]{8,64})\/email$/.exec(path)
    if (emailTarget && method === 'POST' && admin) return adminSetEmail(env.DB, user, emailTarget[1]!, await fields(request))
    if (
      admin &&
      !(method === 'GET' && /^admin\/feedback\/[\w-]+$/.test(path)) &&
      !(method === 'POST' && /^admin\/feedback\/[\w-]+\/(status|messages)$/.test(path))
    )
      missing()
  }
  if (path === 'bridge/pending' && method === 'GET')
    return json(
      (
        await stmt(
          "SELECT f.*,u.email AS submitter_email,u.role AS submitter_role FROM feedback f JOIN users u ON u.id=f.user_id WHERE f.status IN ('submitted','approved','need_info') OR (f.multica_issue IS NOT NULL AND f.status NOT IN ('draft','live','resolved','rejected','duplicate','unbanned','upheld')) ORDER BY f.updated_at,f.id",
        ).all()
      ).results,
    )
  if(path==='bridge/mail'&&method==='POST'){await flushMail(env);return json({ok:true})}
  if (path === 'feedback' && !machine) {
    if (method === 'GET')
      return json(
        (
          await stmt(
            'SELECT id,title,kind,status,updated_at FROM feedback WHERE user_id=? ORDER BY updated_at DESC,rowid DESC',
            user,
          ).all()
        ).results,
      )
    if (method !== 'POST') missing()
    const data = await fields(request),
      lat = number(data.lat, -90, 90),
      lon = number(data.lon, -180, 180),
      point = ll2xz(lat, lon),
      kindStr = String(data.kind),
      bodyStr = text(data.body ?? '', 2000) ?? ''
    if (
      Math.abs(point.x) > 3072.000001 ||
      Math.abs(point.z) > 3328.000001 ||
      !kinds.includes(kindStr) ||
      !(photosOptional(kindStr) && data.view == null) && !validView(data.view)
    )
      invalid()
    let banRecordId: string | null = null
    let appealTriage: Record<string, unknown> | null = null
    if (kindStr === APPEAL) {
      if (Array.from(stripAppealTemplate(bodyStr)).length < 2) {
        throw new Problem(400, 'empty_appeal', '请填写具体的申诉说明，不能留空或只保留模板')
      }
      const rawRecordId = text(data.ban_record_id, 64)
      if (rawRecordId && !/^[A-Za-z0-9_-]{6,64}$/.test(rawRecordId)) invalid()
      banRecordId = rawRecordId || extractBanRecordId(bodyStr)
      if (env.appealTriage) {
        const result = await env.appealTriage({ uid: accountUid, userId: user, banRecordId, body: bodyStr })
        if (result?.ownerMismatch) {
          throw new Problem(403, 'record_owner_mismatch', '该记录编号不属于当前账号')
        }
        if (result?.recordId) banRecordId = result.recordId
        if (result?.triage) appealTriage = result.triage
      }
    }
    const id = crypto.randomUUID()
    const titleStr = text(data.title, 40, true)
    const headingVal = data.heading == null ? null : number(data.heading, 0, 360)
    const landmarkVal = text(data.landmark_id, 120)
    const viewJson = data.view == null ? null : JSON.stringify(data.view)
    let created
    try {
      created = await stmt(
        `INSERT INTO feedback(id,user_id,kind,title,body,lat,lon,heading,landmark_id,view_json,ban_record_id,appeal_triage) SELECT ?,?,?,?,?,?,?,?,?,?,?,?
         WHERE (SELECT count(*) FROM feedback WHERE user_id=? AND status='draft')<3`,
        id, user, kindStr, titleStr, bodyStr, lat, lon, headingVal, landmarkVal, viewJson,
        banRecordId, appealTriage ? JSON.stringify(appealTriage) : null, user,
      ).run()
    } catch (error) {
      // 兼容尚未迁移 ban_record_id / appeal_triage 列的旧环境
      if (/column|no such column/i.test(String((error as Error)?.message ?? error))) {
        created = await stmt(
          `INSERT INTO feedback(id,user_id,kind,title,body,lat,lon,heading,landmark_id,view_json) SELECT ?,?,?,?,?,?,?,?,?,?
           WHERE (SELECT count(*) FROM feedback WHERE user_id=? AND status='draft')<3`,
          id, user, kindStr, titleStr, bodyStr, lat, lon, headingVal, landmarkVal, viewJson, user,
        ).run()
      } else throw error
    }
    if (!created.meta.changes) throw new Problem(429, 'draft_limit', '最多保留 3 条草稿，请先提交或删除草稿')
    return json({ id, ...(banRecordId ? { ban_record_id: banRecordId } : {}) })
  }
  const match =
    /^(bridge\/|admin\/)?feedback\/([\w-]+)(?:\/(submit|supplement|status|messages|relayed|bind|view-shot|photos\/(?:[1-9]|1\d|20)))?$/.exec(
      path,
    )
  if (!match || (bridge&&!['status','messages','relayed','bind'].includes(match[3])) || (!bridge&&!admin&&['status','relayed','bind'].includes(match[3]))) missing()
  const [, , id, action] = match,
    row = await stmt(
      (admin || machine
        ? 'SELECT f.*,u.email,u.nickname,u.role AS submitter_role FROM feedback f JOIN users u ON u.id=f.user_id WHERE f.id=? AND (f.user_id=? OR ?=1)'
        : 'SELECT * FROM feedback WHERE id=? AND (user_id=? OR ?=1)'),
      id,
      user,
      Number(
        machine ||
          admin ||
          (isAdmin && method === 'GET' && (action === 'view-shot' || action?.startsWith('photos/'))) ||
          false,
      ),
    ).first<{ kind: string; status: string; body?: string; ban_record_id?: string | null; appeal_triage?: unknown; multica_issue: string | null; view_json: string | null; shot_state: number }>()
  if (!row) missing()
  if(method==='POST'&&bridge&&action==='bind'){
    const issue=text((await fields(request)).issue,128,true)!
    if(!(await stmt('UPDATE feedback SET multica_issue=? WHERE id=? AND (multica_issue IS NULL OR multica_issue=?)',issue,id,issue).run()).meta.changes)conflict()
    return json({ok:true})
  }
  if(method==='POST'&&bridge&&action==='relayed'){
    await stmt('UPDATE feedback_messages SET relayed_at=coalesce(relayed_at,unixepoch()) WHERE feedback_id=? AND id=?',id,number((await fields(request)).id,1,Number.MAX_SAFE_INTEGER)).run();return json({ok:true})
  }
  if(method==='POST'&&action==='messages'){
    if(TERMINAL.has(row.status)||row.status==='draft')conflict()
    const data=await fields(request),body=text(data.body,1000,true)!,kind=bridge?'agent':admin?'admin':'user',source=bridge?text(data.source,200,true):null
    const [result]=await env.DB.batch([stmt(`INSERT INTO feedback_messages(feedback_id,author_kind,author_name,body,source,relayed_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM feedback WHERE id=? AND status NOT IN ('draft','live','resolved','rejected','duplicate','unbanned','upheld')) AND (?='agent' OR (SELECT count(*) FROM feedback_messages WHERE feedback_id=? AND author_kind!='agent' AND created_at>unixepoch()-3600)<20) ON CONFLICT(feedback_id,source) DO NOTHING`,id,kind,bridge?'协调人':admin?'管理员':'提交人',body,source,bridge?now():null,id,kind,id),...(admin?[audit(env.DB,user,'reply','feedback',id,{})]:[])])
    if(!result.meta.changes&&!bridge)limited();return json({ok:true})
  }
  const shotKey = `fb/${id}/view.jpg`
  if (action === 'view-shot') {
    if (method === 'GET') {
      if (row.shot_state !== 1) missing()
      const object = await env.FEEDBACK.get(shotKey)
      if (!object) missing()
      return new Response(object.body, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
    if (method !== 'PUT') missing()
    if (!['draft', 'need_info'].includes(row.status)) conflict()
    const size = Number(request.headers.get('content-length'))
    if (
      request.headers.get('content-type') !== 'image/jpeg' ||
      !Number.isInteger(size) ||
      size < 4 ||
      size > 2097152
    )
      invalid()
    const bytes = new Uint8Array(await request.arrayBuffer())
    if (bytes.length !== size || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) invalid()
    const header = request.headers.get('X-Feedback-View')
    if (header !== null) {
      try {
        if (!validView(JSON.parse(header))) invalid()
      } catch {
        invalid()
      }
    }
    const [, lock, usage] = await env.DB.batch([
      stmt('DELETE FROM feedback_upload_usage WHERE uploaded_at<=unixepoch()-86400'),
      stmt(
        'UPDATE feedback SET shot_state=2 WHERE id=? AND status=? AND shot_state!=2 AND (SELECT coalesce(sum(bytes),0) FROM feedback_upload_usage WHERE user_id=?)+?<=314572800',
        id,
        row.status,
        user,
        size,
      ),
      stmt('INSERT INTO feedback_upload_usage SELECT ?,unixepoch(),? WHERE changes()=1', user, size),
    ])
    if (!lock.meta.changes || !usage.meta.changes) {
      if (
        Number(
          await stmt(
            'SELECT coalesce(sum(bytes),0) total FROM feedback_upload_usage WHERE user_id=?',
            user,
          ).first('total'),
        ) +
          size >
        314572800
      )
        throw new Problem(429, 'upload_limit', '24 小时上传额度已用完')
      conflict()
    }
    try {
      await env.FEEDBACK.put(shotKey, bytes)
    } catch (error) {
      await stmt('UPDATE feedback SET shot_state=? WHERE id=?', row.shot_state, id).run()
      throw error
    }
    await stmt(
      'UPDATE feedback SET shot_state=1,view_json=coalesce(?,view_json) WHERE id=?',
      header,
      id,
    ).run()
    return json({ ok: true })
  }
  if (!action && method === 'DELETE') {
    if (row.status !== 'draft' || row.shot_state === 2) conflict()
    const [photos, removed] = await env.DB.batch<{ r2_key: string }>([
      stmt(
        `DELETE FROM feedback_photos WHERE feedback_id=? AND EXISTS(SELECT 1 FROM feedback WHERE id=? AND status='draft' AND shot_state!=2) RETURNING r2_key`,
        id,
        id,
      ),
      stmt(`DELETE FROM feedback WHERE id=? AND status='draft' AND shot_state!=2`, id),
    ])
    if (!removed.meta.changes) conflict()
    await env.FEEDBACK.delete(shotKey)
    if (photos.results.length) await env.FEEDBACK.delete(photos.results.map((photo) => String(photo.r2_key)))
    return json({ ok: true })
  }
  const photos = () =>
    stmt(
      'SELECT n,bytes,mime,view_label,exif_lat,exif_lon,exif_dir,exif_time FROM feedback_photos WHERE feedback_id=? AND ready=1 ORDER BY n',
      id,
    ).all()
  if (!action && method === 'GET'){
    const messages=(await stmt('SELECT id,author_kind,author_name,body,created_at,relayed_at FROM feedback_messages WHERE feedback_id=? ORDER BY created_at,id',id).all()).results
    if(admin&&messages.length)await stmt('UPDATE feedback SET admin_read_id=max(admin_read_id,?) WHERE id=?',Number(messages.at(-1)?.id),id).run()
    let parsedTriage: unknown = null
    if ((admin || machine) && row.appeal_triage != null) {
      if (typeof row.appeal_triage === 'string') {
        try { parsedTriage = JSON.parse(row.appeal_triage) } catch { parsedTriage = null }
      } else parsedTriage = row.appeal_triage
    }
    return json({
      ...row,
      ban_record_id: row.ban_record_id ?? null,
      appeal_triage: admin || machine ? parsedTriage : undefined,
      messages,
      view_json: undefined,
      shot_state: undefined,
      view: row.view_json ? JSON.parse(row.view_json) : null,
      has_view_shot: row.shot_state === 1,
      ...(admin
        ? {
            allowed_transitions: transitions(row.status, false, row.kind),
            issue_url: row.multica_issue
              ? `https://multica.ai/idoknow/issues/${encodeURIComponent(row.multica_issue)}`
              : null,
          }
        : {}),
      photos: (await photos()).results,
      events: (await stmt('SELECT * FROM feedback_events WHERE feedback_id=? ORDER BY id', id).all()).results,
    })
  }
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
    if (!['draft', 'need_info'].includes(row.status) && (method!=='PUT'||TERMINAL.has(row.status)||await stmt('SELECT 1 FROM feedback_photos WHERE feedback_id=? AND n=?',id,slot).first())) conflict()
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
       exif_time=excluded.exif_time,uploaded_at=excluded.uploaded_at,ready=0 WHERE (SELECT status FROM feedback WHERE id=excluded.feedback_id) IN ('draft','need_info')`,
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
    credit = null,
    guard = ''
  const priorityAdmin = !machine && isAdmin && autoApproveEmails(env).includes(accountEmail)
  const priorityAutoApprove = priorityAdmin && row.kind !== APPEAL
  if (action === 'submit') {
    if (row.status !== 'draft') conflict()
    if (row.kind === APPEAL && Array.from(stripAppealTemplate(String(row.body ?? ''))).length < 2) {
      throw new Problem(400, 'empty_appeal', '请填写具体的申诉说明，不能留空或只保留模板')
    }
    target = priorityAutoApprove ? 'approved' : 'submitted'
    message = priorityAutoApprove ? '管理员直提已自动批准，等待专职 Agent 开工' : '已提交，等待处理'
    const quotaGuard = priorityAdmin
      ? ''
      : ' AND (SELECT count(*) FROM feedback f WHERE f.user_id=feedback.user_id AND f.submitted_at>unixepoch()-86400)<5'
    guard = ` AND ((kind IN ('${APPEAL}','${BUG}') AND shot_state!=2 AND length(trim(body))>0) OR (view_json IS NOT NULL AND shot_state=1 AND EXISTS(SELECT 1 FROM feedback_photos WHERE feedback_id=feedback.id AND ready=1)))${quotaGuard}`
  } else if (action === 'supplement') {
    if (row.status !== 'need_info') conflict()
    target = priorityAutoApprove ? 'approved' : 'submitted'
    message = text((await fields(request)).body, 1000, true)!
    guard = " AND shot_state!=2 AND (SELECT count(*) FROM feedback_messages WHERE feedback_id=feedback.id AND author_kind!='agent' AND created_at>unixepoch()-3600)<20"
  } else if (bridge || admin) {
    const data = await fields(request)
    target = String(data.status)
    const activeTable = row.kind === APPEAL ? appealEdges : edges
    if (bridge && target === row.status && target!=='approved' && activeTable[target]) return json({ ok: true })
    const change=transitions(row.status,bridge,row.kind).find(item=>item.status===target)
    if (!change) conflict()
    message=text(data.message,2000,change.needs_message)||change.label
    if (bridge) {
      screenshot =
        typeof data.screenshot_url === 'string' &&
        /^\/api\/feedback\/comparisons\/[a-f0-9]{64}$/.test(data.screenshot_url)
          ? data.screenshot_url
          : link(data.screenshot_url)
      issue = text(data.multica_issue, 128)
      pr = link(data.pr_url)
      // 「关于」页署名：上线时写几个字（IDOK-186）
      if (target === 'live') credit = text(data.credit, 16)
    }
  } else missing()
  const [changed] = await env.DB.batch([
    stmt(
      `UPDATE feedback SET status=?,updated_at=unixepoch(),submitted_at=CASE WHEN status='draft' THEN unixepoch() ELSE submitted_at END,multica_issue=coalesce(?,multica_issue),pr_url=coalesce(?,pr_url),credit=coalesce(?,credit) WHERE id=? AND status=? AND NOT EXISTS(SELECT 1 FROM feedback_photos WHERE feedback_id=feedback.id AND ready=0)${guard}`,
      target,
      issue,
      pr,
      credit,
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
    ...(admin?[audit(env.DB,user,target==='approved'?'start_ai':'status','feedback',id,{from:row.status,to:target})]:[]),
    ...(action==='supplement'?[stmt("INSERT INTO feedback_messages(feedback_id,author_kind,author_name,body) SELECT ?,'user','提交人',? WHERE changes()=1",id,message)]:[]),
  ])
  if (!changed.meta.changes) {
    if (
      action === 'submit' &&
      !priorityAdmin &&
      ((await stmt(
        'SELECT count(*) AS total FROM feedback WHERE user_id=? AND submitted_at>unixepoch()-86400',
        user,
      ).first<number>('total')) ?? 0) >= 5
    )
      limited()
    const activeTable = row.kind === APPEAL ? appealEdges : edges
    if (
      bridge &&
      activeTable[target] &&
      (await stmt('SELECT status FROM feedback WHERE id=?', id).first('status')) === target
    )
      return json({ ok: true })
    conflict()
  }
  return json({ ok: true })
}
