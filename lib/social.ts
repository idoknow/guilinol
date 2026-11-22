import { type Env, Problem, cookie, hash, lifetime, limit, now, random, sessionHash } from './auth'

/**
 * 佛系云聚合登录（https://a.idcfx.net/doc.php）接入层。
 *
 * 三条硬约束决定了这里的写法：
 * 1. appkey 只能出现在服务端请求里（上游把 appkey 放在 query 上），前端与日志都拿不到。
 * 2. 上游回调只带 type 和 code，**不回传 state**，协议本身无法证明「这个 code 属于哪次流程」。
 *    因此回调不直接登录/绑定，只落一条一次性 pending，由用户在页面上确认后才生效——
 *    盲打 CSRF 点不了这个按钮。
 * 3. 站点没有独立登录页，账号面板在首页里，所以失败一律 302 回 `/?social=<reason>`。
 */

export const SOCIAL_TYPES = ['qq', 'wx', 'alipay', 'douyin', 'google', 'twitter', 'feishu'] as const
export type SocialType = (typeof SOCIAL_TYPES)[number]
export type SocialIntent = 'login' | 'bind'

export const SOCIAL_LABELS: Record<SocialType, string> = {
  qq: 'QQ',
  wx: '微信',
  alipay: '支付宝',
  douyin: '抖音',
  google: 'Google',
  twitter: 'Twitter',
  feishu: '飞书',
}

const DEFAULT_HOST = 'https://a.idcfx.net'
const STATE_TTL = 600
const PENDING_TTL = 300
const MAX_STATES_PER_BROWSER = 3

export function isSocialType(value: unknown): value is SocialType {
  return typeof value === 'string' && (SOCIAL_TYPES as readonly string[]).includes(value)
}

/** 启用的平台只来自环境变量（SOCIAL_ENABLED=qq,wx），不落库、后台不暴露。 */
export function enabledTypes(env: Env): SocialType[] {
  return (env.SOCIAL_ENABLED ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(isSocialType)
}

/** 只接受 https：http 会把 appkey 和 code 暴露在链路上，配错即视为未配置。 */
function httpsUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString().replace(/\/+$/, '') : null
  } catch {
    return null
  }
}

export function socialConfigured(env: Env): boolean {
  return Boolean(
    env.SOCIAL_APPID &&
      env.SOCIAL_APPKEY &&
      httpsUrl(env.SOCIAL_HOST ?? DEFAULT_HOST) &&
      httpsUrl(env.SOCIAL_REDIRECT) &&
      enabledTypes(env).length,
  )
}

const host = (env: Env) => httpsUrl(env.SOCIAL_HOST ?? DEFAULT_HOST) ?? DEFAULT_HOST

/** 只认列表里的头像域，避免把任意 URL 渲染进后台。 */
const AVATAR_HOSTS = [
  'qlogo.cn',
  'weixin.qq.com',
  'alipay.com',
  'alipayobjects.com',
  'douyinpic.com',
  'douyincdn.com',
  'googleusercontent.com',
  'pbs.twimg.com',
  'feishucdn.com',
  'feishu.cn',
]

export function safeAvatar(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512) return ''
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return ''
  }
  if (url.protocol !== 'https:') return ''
  const name = url.hostname.toLowerCase()
  return AVATAR_HOSTS.some((allowed) => name === allowed || name.endsWith(`.${allowed}`)) ? url.toString() : ''
}

export const maskUid = (value: string) => (value.length <= 6 ? '…' : `…${value.slice(-6)}`)

type Upstream = {
  code?: number
  errcode?: number
  msg?: string
  type?: string
  url?: string
  qrcode?: string
  social_uid?: string
  nickname?: string
  faceimg?: string
}

const logSocial = (payload: Record<string, unknown>) => console.log(JSON.stringify({ scope: 'social', ...payload }))

async function callUpstream(env: Env, action: 'login' | 'callback', params: Record<string, string>): Promise<Upstream> {
  const url = new URL('/connect.php', host(env))
  url.searchParams.set('act', action)
  url.searchParams.set('appid', env.SOCIAL_APPID!)
  url.searchParams.set('appkey', env.SOCIAL_APPKEY!)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  let response: Response
  try {
    response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'guilinol/1.0' },
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    })
  } catch (error) {
    // appkey 与 code 都不进日志
    logSocial({ action, type: params.type, failure: 'network', error: error instanceof Error ? error.message : 'unknown' })
    throw new Problem(502, 'social_unavailable', '登录服务暂时不可用，请稍后再试')
  }
  if (!response.ok) {
    logSocial({ action, type: params.type, failure: 'status', status: response.status })
    throw new Problem(502, 'social_unavailable', '登录服务暂时不可用，请稍后再试')
  }
  const body = (await response.json().catch(() => ({}))) as Upstream
  if (body.code !== 0) logSocial({ action, type: params.type, code: body.code, errcode: body.errcode })
  return body
}

/* ───────────── cookies ───────────── */

const stateCookie = (states: string[]) =>
  `glol_social=${states.join('.')}; Path=/; Max-Age=${STATE_TTL}; HttpOnly; Secure; SameSite=Lax`

const pendingCookie = (token: string, age = PENDING_TTL) =>
  `glol_social_pending=${token}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`

const clearPending = () => 'glol_social_pending=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'

export const socialStates = (request: Request): string[] =>
  (request.headers.get('Cookie')?.match(/(?:^|;\s*)glol_social=([a-f0-9.]+)(?:;|$)/)?.[1] ?? '')
    .split('.')
    .filter((state) => /^[a-f0-9]{64}$/.test(state))

const pendingToken = (request: Request): string =>
  request.headers.get('Cookie')?.match(/(?:^|;\s*)glol_social_pending=([a-f0-9]{64})(?:;|$)/)?.[1] ?? ''

/* ───────────── start ───────────── */

/**
 * 发起授权。
 * `bind` 必须带 userId（调用方已确认登录态），登录态的第三方账号不允许被串到别人名下。
 * 同一浏览器允许并行 3 个流程，互不顶掉（新 state 追加进 cookie，不覆盖旧的）。
 */
export async function startSocial(
  env: Env,
  db: D1Database,
  type: SocialType,
  ip: string,
  intent: SocialIntent = 'login',
  userId?: string,
  existingStates: string[] = [],
) {
  if (!socialConfigured(env)) throw new Problem(503, 'social_unconfigured', '第三方登录尚未启用')
  if (!enabledTypes(env).includes(type)) throw new Problem(400, 'social_disabled', '该登录方式未启用')
  if (intent === 'bind' && !userId) throw new Problem(401, 'unauthorized', '请先登录')
  await limit(db, `social:start:${ip}`, 20, 60)

  const state = random(32)
  await db.batch([
    // 有界批量清理，避免 social_states / rate_limits 无限增长
    db.prepare('DELETE FROM social_states WHERE state IN (SELECT state FROM social_states WHERE expires<=? LIMIT 200)').bind(now()),
    db.prepare('DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE until<=? LIMIT 200)').bind(now()),
    db
      .prepare('INSERT INTO social_states(state,type,intent,user_id,expires,used,ip) VALUES(?,?,?,?,?,0,?)')
      .bind(state, type, intent, intent === 'bind' ? (userId ?? null) : null, now() + STATE_TTL, ip),
  ])

  let body: Upstream
  try {
    body = await callUpstream(env, 'login', { type, redirect_uri: env.SOCIAL_REDIRECT! })
  } catch (error) {
    // 发起失败别留下孤儿 state
    await db.prepare('DELETE FROM social_states WHERE state=?').bind(state).run()
    throw error
  }
  if (body.code !== 0 || body.type !== type || typeof body.url !== 'string' || !body.url.startsWith('https://')) {
    await db.prepare('DELETE FROM social_states WHERE state=?').bind(state).run()
    throw new Problem(502, 'social_unavailable', '登录服务返回异常，请稍后再试')
  }

  const states = [...existingStates.filter((item) => item !== state), state].slice(-MAX_STATES_PER_BROWSER)
  return {
    states,
    cookie: stateCookie(states),
    url: body.url,
    qrcode: typeof body.qrcode === 'string' && body.qrcode.startsWith('https://') ? body.qrcode : null,
  }
}

/* ───────────── callback ───────────── */

type StateRow = { state: string; intent: string; user_id: string | null }
type Identity = { user_id: string; nickname: string; faceimg: string }

/**
 * 回调入口：核对同浏览器凭据 → 换用户信息 → 落一次性 pending → 回首页等用户确认。
 *
 * 注意这里**不直接登录或绑定**：上游回调不带 state，无法证明这个 code 属于本次流程，
 * 直接落库就等于允许攻击者把「自己的 code」塞进受害者的流程里完成登录/绑定。
 */
export async function socialCallback(env: Env, db: D1Database, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const back = (reason: string, headers: Record<string, string> = {}) =>
    new Response(null, {
      status: 302,
      headers: { Location: new URL(`/?social=${reason}`, url.origin).toString(), 'Cache-Control': 'no-store', ...headers },
    })
  if (!socialConfigured(env)) return back('disabled')

  // 上游是 302 跳回来的跨站导航，不能用 Sec-Fetch-Site 拦；CSRF 由「cookie 里的 state + 一次性 pending」保证
  const type = url.searchParams.get('type'),
    code = url.searchParams.get('code') ?? ''
  if (!isSocialType(type) || !enabledTypes(env).includes(type) || !/^[A-Za-z0-9_-]{8,128}$/.test(code))
    return back('invalid')

  try {
    await limit(db, `social:callback:${request.headers.get('CF-Connecting-IP') ?? 'local'}`, 20, 60)
  } catch {
    return back('busy')
  }

  const states = socialStates(request)
  if (!states.length) return back('expired')
  let matched: StateRow | null = null
  for (const state of states) {
    const row = await db
      .prepare('SELECT state,intent,user_id FROM social_states WHERE state=? AND type=? AND used=0 AND expires>?')
      .bind(state, type, now())
      .first<StateRow>()
    if (row) {
      matched = row
      break
    }
  }
  if (!matched) return back('expired')
  const intent: SocialIntent = matched.intent === 'bind' ? 'bind' : 'login'

  let profile: Upstream
  try {
    profile = await callUpstream(env, 'callback', { type, code })
  } catch {
    // 上游抖动不消费 state：用户重来一次仍可继续
    return back('unavailable')
  }
  if (profile.code === 2) return back('pending')
  if (profile.code !== 0 || profile.type !== type || !/^[A-Fa-f0-9]{16,64}$/.test(profile.social_uid ?? ''))
    return back('failed')

  // 换取成功后才一次性消费 state
  const consumed = await db
    .prepare('UPDATE social_states SET used=1 WHERE state=? AND used=0 RETURNING state')
    .bind(matched.state)
    .first<{ state: string }>()
  if (!consumed) return back('expired')

  const socialUid = profile.social_uid!,
    nickname = (profile.nickname ?? '').slice(0, 32),
    avatar = safeAvatar(profile.faceimg)

  const digest = await sessionHash(request)
  const current = await db
    .prepare('SELECT users.id,users.verified FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.digest=? AND expires>?')
    .bind(digest, now())
    .first<{ id: string; verified: number }>()
  const identity = await db
    .prepare('SELECT user_id,nickname,faceimg FROM social_identities WHERE type=? AND social_uid=?')
    .bind(type, socialUid)
    .first<Identity>()

  let target: string
  if (intent === 'bind') {
    if (!current) return back('unbound')
    if (!current.verified) return back('unverified')
    // state 记录的就是「谁发起了绑定」，当前会话必须是同一个人
    if (!matched.user_id || matched.user_id !== current.id) return back('expired')
    if (identity) return back('conflict')
    target = current.id
  } else {
    if (!identity) return back('unbound')
    const owner = await db.prepare('SELECT verified FROM users WHERE id=?').bind(identity.user_id).first<{ verified: number }>()
    if (!owner) return back('failed')
    if (!owner.verified) return back('unverified')
    target = identity.user_id
  }

  const token = random(32)
  await db.batch([
    db.prepare('DELETE FROM social_pending WHERE expires<=?').bind(now()),
    db
      .prepare('INSERT INTO social_pending(token,intent,type,social_uid,nickname,faceimg,user_id,expires,used) VALUES(?,?,?,?,?,?,?,?,0)')
      .bind(await hash(token), intent, type, socialUid, nickname, avatar, target, now() + PENDING_TTL),
  ])
  return back('confirm', { 'Set-Cookie': pendingCookie(token) })
}

/* ───────────── pending 展示与确认 ───────────── */

type PendingRow = { intent: string; type: string; social_uid?: string; nickname: string; faceimg: string; user_id: string }

/** 供前端确认框展示：这次授权解析出的是谁（不消费）。 */
export async function socialPending(env: Env, db: D1Database, request: Request): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store' }
  if (!socialConfigured(env))
    return Response.json({ error: { code: 'social_unconfigured', message: '第三方登录尚未启用' } }, { status: 503, headers })
  const token = pendingToken(request)
  if (!token) return Response.json({ error: { code: 'no_pending', message: '没有待确认的授权' } }, { status: 404, headers })
  const row = await db
    .prepare('SELECT intent,type,nickname,faceimg,user_id FROM social_pending WHERE token=? AND used=0 AND expires>?')
    .bind(await hash(token), now())
    .first<PendingRow>()
  if (!row) return Response.json({ error: { code: 'no_pending', message: '没有待确认的授权' } }, { status: 404, headers })
  const type = isSocialType(row.type) ? row.type : null
  return Response.json(
    {
      intent: row.intent === 'bind' ? 'bind' : 'login',
      type: type ?? row.type,
      label: type ? SOCIAL_LABELS[type] : row.type,
      nickname: row.nickname,
      avatar: safeAvatar(row.faceimg),
    },
    { headers },
  )
}

/**
 * 用户点了「确认」才真正登录或绑定。
 * - 登录：不需要既有会话，但必须持有 pending cookie（跨站无法写入）
 * - 绑定：会话必须与 pending.user_id 一致，且写入瞬间会话仍然存在（防登出竞态）
 */
export async function socialConfirm(env: Env, db: D1Database, request: Request): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store' }
  if (!socialConfigured(env))
    return Response.json({ error: { code: 'social_unconfigured', message: '第三方登录尚未启用' } }, { status: 503, headers })

  const token = pendingToken(request)
  if (!token) throw new Problem(404, 'no_pending', '授权已过期，请重新发起')
  const digest = await hash(token)
  // 先读不消费：校验没通过的请求不能把别人的授权烧掉
  const row = await db
    .prepare('SELECT intent,type,social_uid,nickname,faceimg,user_id FROM social_pending WHERE token=? AND used=0 AND expires>?')
    .bind(digest, now())
    .first<PendingRow>()
  if (!row) throw new Problem(404, 'no_pending', '授权已过期，请重新发起')
  const intent: SocialIntent = row.intent === 'bind' ? 'bind' : 'login'
  const type = isSocialType(row.type) ? row.type : null
  if (!type) throw new Problem(400, 'invalid_input', '不受支持的登录方式')
  const nickname = (row.nickname ?? '').slice(0, 32),
    faceimg = safeAvatar(row.faceimg)

  if (intent === 'bind') {
    const sessionDigest = await sessionHash(request)
    const sessionUser = await db
      .prepare('SELECT user_id FROM sessions WHERE digest=? AND expires>?')
      .bind(sessionDigest, now())
      .first<{ user_id: string }>()
    if (!sessionUser) throw new Problem(401, 'unauthorized', '请先登录')
    if (sessionUser.user_id !== row.user_id) throw new Problem(403, 'forbidden', '请用发起绑定的账号确认')

    // 消费与写入放在同一次校验里：会话在这一刻仍然存在才写
    const consumed = await db
      .prepare('UPDATE social_pending SET used=1 WHERE token=? AND used=0 AND user_id=? RETURNING token')
      .bind(digest, sessionUser.user_id)
      .first<{ token: string }>()
    if (!consumed) throw new Problem(404, 'no_pending', '授权已过期，请重新发起')

    let inserted
    try {
      inserted = await db
        .prepare(
          `INSERT INTO social_identities(type,social_uid,user_id,nickname,faceimg,created_at,last_login_at)
           SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sessions WHERE digest=? AND user_id=? AND expires>?)`,
        )
        .bind(type, row.social_uid!, row.user_id, nickname, faceimg, now(), now(), sessionDigest, row.user_id, now())
        .run()
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      // 只有唯一约束才算「已绑定」，别的数据库错误照常抛出记录
      if (/UNIQUE|PRIMARY KEY/i.test(message)) throw new Problem(409, 'conflict', '该平台账号已经绑定过了')
      throw error
    }
    if (!inserted.meta.changes) throw new Problem(409, 'expired', '会话已失效，请重新登录后再绑定')
    return Response.json({ ok: true, intent, redirect: '/?social=bound' }, { headers: { ...headers, 'Set-Cookie': clearPending() } })
  }

  const identity = await db
    .prepare('SELECT user_id FROM social_identities WHERE type=? AND social_uid=?')
    .bind(type, row.social_uid!)
    .first<{ user_id: string }>()
  if (!identity) throw new Problem(404, 'unbound', '该平台账号尚未绑定，请先用邮箱登录后再绑定')
  const owner = await db.prepare('SELECT verified FROM users WHERE id=?').bind(identity.user_id).first<{ verified: number }>()
  if (!owner?.verified) throw new Problem(403, 'unverified', '该账号尚未验证邮箱')

  const consumed = await db
    .prepare('UPDATE social_pending SET used=1 WHERE token=? AND used=0 RETURNING token')
    .bind(digest)
    .first<{ token: string }>()
  if (!consumed) throw new Problem(404, 'no_pending', '授权已过期，请重新发起')

  const sessionToken = random(32),
    sessionDigestNew = await hash(sessionToken),
    previous = await sessionHash(request)
  await db.batch([
    // 只轮换同一个人的旧会话，避免把别人（或没拿到 Set-Cookie 的访客）踢下线
    db.prepare('DELETE FROM sessions WHERE digest=? AND user_id=?').bind(previous, identity.user_id),
    db.prepare('INSERT INTO sessions(digest,user_id,expires) VALUES(?,?,?)').bind(sessionDigestNew, identity.user_id, now() + lifetime),
    db
      .prepare('UPDATE social_identities SET nickname=?,faceimg=?,last_login_at=? WHERE type=? AND social_uid=?')
      .bind(nickname, faceimg, now(), type, row.social_uid!),
  ])
  return Response.json(
    { ok: true, intent, redirect: '/?social=login' },
    { headers: { ...headers, 'Set-Cookie': `${cookie(sessionToken)}; ${clearPending()}` } },
  )
}

/** 后台用：某个账号绑定的第三方平台（平台名、平台用户名、头像）。 */
export async function userSocialIdentities(db: D1Database, userId: string) {
  const { results } = await db
    .prepare('SELECT type,social_uid,nickname,faceimg,created_at,last_login_at FROM social_identities WHERE user_id=? ORDER BY created_at')
    .bind(userId)
    .all<{ type: string; social_uid: string; nickname: string; faceimg: string; created_at: number; last_login_at: number }>()
  return results.map((row) => ({
    type: row.type,
    label: isSocialType(row.type) ? SOCIAL_LABELS[row.type] : row.type,
    nickname: row.nickname,
    avatar: safeAvatar(row.faceimg),
    uid: maskUid(row.social_uid),
    created_at: row.created_at,
    last_login_at: row.last_login_at,
  }))
}
