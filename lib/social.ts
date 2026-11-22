import { type Env, Problem, cookie, hash, lifetime, limit, now, random, sessionHash } from './auth'

/**
 * 佛系云聚合登录（https://a.idcfx.net/doc.php）接入层。
 *
 * 两条硬约束决定了这里的写法：
 * 1. appkey 只能出现在服务端请求里（上游把 appkey 放在 query 上），前端与日志都拿不到。
 * 2. 上游回调只带 type 和 code，不带 state，所以 CSRF 防护靠「发起时下发同浏览器 cookie +
 *    服务端一次性记录」，不能靠 query 里的 state。
 *
 * 站点没有独立登录页，账号面板在首页里，因此回调失败统一切回 `/?social=<reason>`。
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

export function socialConfigured(env: Env): boolean {
  return Boolean(env.SOCIAL_APPID && env.SOCIAL_APPKEY && env.SOCIAL_REDIRECT && enabledTypes(env).length)
}

const host = (env: Env) => (env.SOCIAL_HOST ?? 'https://a.idcfx.net').replace(/\/+$/, '')

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
  } catch {
    throw new Problem(502, 'social_unavailable', '登录服务暂时不可用，请稍后再试')
  }
  if (!response.ok) throw new Problem(502, 'social_unavailable', '登录服务暂时不可用，请稍后再试')
  const body = (await response.json().catch(() => ({}))) as Upstream
  if (body.code !== 0) {
    // appkey 与 code 都不进日志，只留类型与上游错误码
    console.log(JSON.stringify({ scope: 'social', action, type: params.type, code: body.code, errcode: body.errcode }))
  }
  return body
}

export const socialCookie = (state: string, age = 600) =>
  `glol_social=${state}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`

const stateFrom = (request: Request) =>
  request.headers.get('Cookie')?.match(/(?:^|;\s*)glol_social=([a-f0-9]{64})(?:;|$)/)?.[1] ?? ''

/**
 * 发起授权。
 * `bind` 必须带 userId（调用方已确认登录态），登录态的第三方账号不允许被串到别人名下。
 */
export async function startSocial(
  env: Env,
  db: D1Database,
  type: SocialType,
  ip: string,
  intent: SocialIntent = 'login',
  userId?: string,
) {
  if (!socialConfigured(env)) throw new Problem(503, 'social_unconfigured', '第三方登录尚未启用')
  if (!enabledTypes(env).includes(type)) throw new Problem(400, 'social_disabled', '该登录方式未启用')
  if (intent === 'bind' && !userId) throw new Problem(401, 'unauthorized', '请先登录')
  await limit(db, `social:start:${ip}`, 20, 60)
  const state = random(32)
  await db.batch([
    db.prepare('DELETE FROM social_states WHERE expires<=?').bind(now()),
    db
      .prepare('INSERT INTO social_states(state,type,intent,user_id,expires,used,ip) VALUES(?,?,?,?,?,0,?)')
      .bind(state, type, intent, intent === 'bind' ? (userId ?? null) : null, now() + 600, ip),
  ])
  const body = await callUpstream(env, 'login', { type, redirect_uri: env.SOCIAL_REDIRECT! })
  if (body.code !== 0 || body.type !== type || typeof body.url !== 'string' || !body.url.startsWith('https://'))
    throw new Problem(502, 'social_unavailable', '登录服务返回异常，请稍后再试')
  return {
    state,
    url: body.url,
    qrcode: typeof body.qrcode === 'string' && body.qrcode.startsWith('https://') ? body.qrcode : null,
  }
}

type Identity = { user_id: string; nickname: string; faceimg: string }
type StateRow = { intent: string; user_id: string | null }

/**
 * 回调入口：校验同浏览器凭据 → 消费 state → 换用户信息 → 登录或绑定。
 * 失败一律 302 回首页并带 `?social=<reason>`，由账号面板读参数给提示。
 */
export async function socialCallback(env: Env, db: D1Database, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const back = (reason: string) =>
    new Response(null, {
      status: 302,
      headers: { Location: new URL(`/?social=${reason}`, url.origin).toString(), 'Cache-Control': 'no-store' },
    })
  if (!socialConfigured(env)) return back('disabled')

  const site = request.headers.get('Sec-Fetch-Site')
  if (site && site !== 'same-origin' && site !== 'none') throw new Problem(403, 'origin', '请求来源不符')

  const type = url.searchParams.get('type'),
    code = url.searchParams.get('code') ?? ''
  if (!isSocialType(type) || !enabledTypes(env).includes(type) || !/^[A-Za-z0-9_-]{8,128}$/.test(code)) return back('invalid')

  await limit(db, `social:callback:${request.headers.get('CF-Connecting-IP') ?? 'local'}`, 20, 60)

  const state = stateFrom(request)
  if (!/^[a-f0-9]{64}$/.test(state)) return back('expired')
  // 一次性消费：并发重放只有一次能改到行
  const consumed = await db
    .prepare('UPDATE social_states SET used=1 WHERE state=? AND type=? AND used=0 AND expires>? RETURNING intent,user_id')
    .bind(state, type, now())
    .first<StateRow>()
  if (!consumed) return back('expired')
  const intent: SocialIntent = consumed.intent === 'bind' ? 'bind' : 'login'

  const profile = await callUpstream(env, 'callback', { type, code })
  if (profile.code === 2) return back('pending')
  if (profile.code !== 0 || profile.type !== type || !/^[A-Fa-f0-9]{16,64}$/.test(profile.social_uid ?? ''))
    return back('failed')

  const uid = profile.social_uid!,
    nickname = (profile.nickname ?? '').slice(0, 32),
    avatar = safeAvatar(profile.faceimg)

  const sessionDigest = await sessionHash(request)
  const current = await db
    .prepare('SELECT users.id,users.verified FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.digest=? AND expires>?')
    .bind(sessionDigest, now())
    .first<{ id: string; verified: number }>()
  const identity = await db
    .prepare('SELECT user_id,nickname,faceimg FROM social_identities WHERE type=? AND social_uid=?')
    .bind(type, uid)
    .first<Identity>()

  if (intent === 'bind') {
    if (!current) return back('unbound')
    if (!current.verified) return back('unverified')
    if (consumed.user_id && consumed.user_id !== current.id) return back('expired')
    if (identity) return back('conflict')
    try {
      await db
        .prepare(
          'INSERT INTO social_identities(type,social_uid,user_id,nickname,faceimg,created_at,last_login_at) VALUES(?,?,?,?,?,?,?)',
        )
        .bind(type, uid, current.id, nickname, avatar, now(), now())
        .run()
    } catch {
      // 唯一索引冲突 = 该用户这个平台已经绑过
      return back('conflict')
    }
    return new Response(null, {
      status: 302,
      headers: { Location: new URL('/?social=bound', url.origin).toString(), 'Cache-Control': 'no-store' },
    })
  }

  if (!identity) return back('unbound')
  const owner = await db.prepare('SELECT verified FROM users WHERE id=?').bind(identity.user_id).first<{ verified: number }>()
  if (!owner) return back('failed')
  if (!owner.verified) return back('unverified')

  const token = random(32),
    digest = await hash(token)
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE digest=?').bind(sessionDigest),
    db.prepare('INSERT INTO sessions(digest,user_id,expires) VALUES(?,?,?)').bind(digest, identity.user_id, now() + lifetime),
    db
      .prepare('UPDATE social_identities SET nickname=?,faceimg=?,last_login_at=? WHERE type=? AND social_uid=?')
      .bind(nickname || identity.nickname, avatar || identity.faceimg, now(), type, uid),
  ])
  return new Response(null, {
    status: 302,
    headers: { Location: new URL('/?social=login', url.origin).toString(), 'Set-Cookie': cookie(token), 'Cache-Control': 'no-store' },
  })
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
