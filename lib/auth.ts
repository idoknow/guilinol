export interface Env {
  cheatCaptureUpload?:(request:Request,account:SessionAccount)=>Promise<Response>
  traceTile?:(uid:number)=>Promise<Response>
  traceAdmin?:(path:string,request:Request,actor:string)=>Promise<Response>
  helicopter?:(user:string,action:string,body:Record<string,unknown>)=>Promise<unknown>
  fishing?:{record:(user:string,body:unknown)=>Promise<unknown>,boards:(zone:string|null)=>Promise<unknown>}
  updateCards?:(request:Request, path:string)=>Promise<Response>
  mpAdmin?:(path:string,request:Request,actor:string)=>Promise<Response>
  smokeAdmin?:(request:Request,user:string)=>Promise<Response>
  gfxAdmin?:(request:Request,user:string)=>Promise<Response>
  npcAdmin?:(request:Request)=>Promise<Response>
  RT_JOIN_SECRET?: string
  perfQuery?:(path:string,params:URLSearchParams,runner?:(path:string,params:URLSearchParams)=>Promise<Response>)=>Promise<Response>
  clientIp?: string
  acceptsVerifiedIp?: boolean
  loginEvent?:(ip:string,kind:'login-attempt'|'login-failed',subject:string|null)=>Promise<boolean>
  countProtection?:(category:string)=>Promise<unknown>
  DB: D1Database; FEEDBACK:R2Bucket; BRIDGE_TOKEN?:string; EMAIL_DEV_LOG?: string; RESEND_API_KEY?: string
  /** 聚合登录：全部来自 Pages 环境变量/secret，不进 D1、后台不暴露 */
  SOCIAL_APPID?: string
  SOCIAL_APPKEY?: string
  SOCIAL_ENABLED?: string
  SOCIAL_HOST?: string
  SOCIAL_REDIRECT?: string
}
export function requestIp(request:Request, env:Pick<Env,'acceptsVerifiedIp'>):string|null {
  return env.acceptsVerifiedIp===true ? trustedLoginIp(request) : null
}
export function trustedLoginIp(request:Request):string|null {
  return request.headers.get('X-Glol-Ip-Trusted')==='1' ? request.headers.get('CF-Connecting-IP') : null
}
export async function checkLoginIp(db:D1Database,ip:string) {
  const row=await db.prepare('SELECT hits,until FROM rate_limits WHERE key=?').bind(`login-failed:${ip}`).first<{hits:number;until:number}>()
  if(row && row.hits>=5 && row.until>now()) limited()
}
export async function failedLoginIp(db:D1Database,ip:string) {
  const time=now()
  const row=await db.prepare(`INSERT INTO rate_limits(key,until,hits) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET
    hits=CASE WHEN rate_limits.until<=? THEN 1 ELSE rate_limits.hits+1 END,
    until=CASE WHEN rate_limits.until<=? OR rate_limits.hits=4 THEN excluded.until ELSE rate_limits.until END
    WHERE rate_limits.until<=? OR rate_limits.hits<5 RETURNING hits`).bind(`login-failed:${ip}`,time+900,time,time,time).first<{hits:number}>()
  if(!row || row.hits>=5) limited()
}
export const lifetime = 30 * 86400
export const now = () => Math.floor(Date.now()/1000)
export class Problem extends Error {
  constructor(readonly status:number, readonly code:string, message:string) { super(message) }
}
export type BanState = { banned_at: number; ban_reason: string }
export function checkBan(user: BanState | null) {
  if (user?.banned_at) throw new Problem(403,'banned','账号已被封禁：'+user.ban_reason)
}
export type SessionAccount = BanState & {id:string;uid:number;email:string;nickname:string;verified:number;role:string;notify_email:number;email_placeholder:number}
export async function sessionAccount(db:D1Database, digest:string) {
  if (!digest) return null
  const join = ' FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.digest=? AND expires>?'
  const account = await db.prepare('SELECT users.id,users.uid,email,nickname,verified,role,notify_email,email_placeholder,banned_at,ban_reason'+join+' AND banned_at=0')
    .bind(digest,now()).first<SessionAccount>()
  if (!account) checkBan(await db.prepare('SELECT banned_at,ban_reason'+join+' AND banned_at<>0').bind(digest,now()).first<BanState>())
  return account
}
export function invalid(): never { throw new Problem(400,'invalid_input','请检查填写的内容') }
export function limited(): never { throw new Problem(429,'rate_limited','请求过于频繁，请稍后再试') }
export function unauthorized(): never { throw new Problem(401,'unauthorized','请先登录') }
const hex = (bytes:ArrayBuffer) => Array.from(new Uint8Array(bytes), value=>value.toString(16).padStart(2,'0')).join('')
export const random = (length:number) => hex(crypto.getRandomValues(new Uint8Array(length)).buffer)
const encode = (text:string) => new TextEncoder().encode(text)
export const hash = async (text:string) => hex(await crypto.subtle.digest('SHA-256', encode(text)))
export async function passwordHash(password:string,salt:string) {
  const key = await crypto.subtle.importKey('raw',encode(password),'PBKDF2',false,['deriveBits'])
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:100000,
    salt:Uint8Array.from(salt.match(/../g)!,pair=>parseInt(pair,16))},key,256))
}
export const equal = (left:string,right:string) => crypto.subtle.timingSafeEqual(encode(left),encode(right))
export const cookie = (token:string,age=lifetime) => `glol_session=${token}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`
export async function sessionHash(request:Request) {
  const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)glol_session=([a-f0-9]{64})(?:;|$)/)?.[1]
  return token ? hash(token) : ''
}
export async function limit(db:D1Database,key:string,max:number,seconds:number) {
  const time=now()
  const result=await db.prepare(`INSERT INTO rate_limits VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET
    hits=CASE WHEN rate_limits.until<=? THEN 1 ELSE rate_limits.hits+1 END, until=CASE WHEN rate_limits.until<=? THEN excluded.until ELSE rate_limits.until END
    WHERE rate_limits.until<=? OR rate_limits.hits<?`).bind(key,time+seconds,time,time,time,max).run()
  if (!result.meta.changes) limited()
}
export async function reserveMail(db:D1Database,email:string,ip:string|null) {
  // 第三方专用账号的占位邮箱（*@social.invalid）收不到信：找回密码/重发验证码一律拒绝，不去打 Resend
  if(/@social\.invalid$/i.test(email)) throw new Problem(400,'no_email','该账号还没有绑定邮箱，请用第三方登录后在「我的账号」里绑定')
  const time=now()
  const [,result]=await db.batch([db.prepare('DELETE FROM mail_events WHERE sent<=?').bind(time-3600),
    db.prepare(`INSERT INTO mail_events SELECT ?,?,? WHERE NOT EXISTS
      (SELECT 1 FROM mail_events WHERE email=? AND sent>?) AND
      (?='' OR (SELECT COUNT(*) FROM mail_events WHERE ip=?)<10)`).bind(ip??'',email,time,email,time-60,ip??'',ip??'')])
  if (!result.meta.changes) limited()
}
export function newCode() {
  let value:number
  do { value=crypto.getRandomValues(new Uint32Array(1))[0] } while(value>=4294000000)
  return String(value%1000000).padStart(6,'0')
}
export async function deliver(env:Env,email:string,purpose:string,code:string) {
  if (env.EMAIL_DEV_LOG==='1') { console.log(`DEV_EMAIL ${email} ${purpose} ${code}`); return }
  const subject=purpose==='reset'?'重置密码':'验证邮箱'
  await sendMail(env,email,subject,`${subject}的验证码：${code}，10 分钟内有效。如果不是本人操作，请忽略。`)
}
export async function sendMail(env:Env,email:string,subject:string,message:string){
  if(env.EMAIL_DEV_LOG==='1'){console.log(`DEV_NOTIFICATION ${subject}`);return}
  if (!env.RESEND_API_KEY || !(await fetch('https://api.resend.com/emails',{method:'POST',
    headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({from:'网上桂林 <noreply@mail.idoknow.top>',to:[email],subject:`网上桂林 · ${subject}`,
      text:message})})).ok)
    throw new Problem(503,'mail_unavailable','邮件暂时未能发送，请稍后重试')
}
