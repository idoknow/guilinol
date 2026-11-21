export interface Env { perfQuery?:(path:string,params:URLSearchParams)=>Promise<Response>; DB: D1Database; FEEDBACK:R2Bucket; BRIDGE_TOKEN?:string; EMAIL_DEV_LOG?: string; RESEND_API_KEY?: string }
export const lifetime = 30 * 86400
export const now = () => Math.floor(Date.now()/1000)
export class Problem extends Error {
  constructor(readonly status:number, readonly code:string, message:string) { super(message) }
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
export async function reserveMail(db:D1Database,email:string,ip:string) {
  const time=now()
  const [,result]=await db.batch([db.prepare('DELETE FROM mail_events WHERE sent<=?').bind(time-3600),
    db.prepare(`INSERT INTO mail_events SELECT ?,?,? WHERE NOT EXISTS
      (SELECT 1 FROM mail_events WHERE email=? AND sent>?) AND
      (SELECT COUNT(*) FROM mail_events WHERE ip=?)<10`).bind(ip,email,time,email,time-60,ip)])
  if (!result.meta.changes) limited()
}
export function newCode() {
  let value:number
  do { value=crypto.getRandomValues(new Uint32Array(1))[0] } while(value>=4294000000)
  return String(value%1000000).padStart(6,'0')
}
export async function deliver(env:Env,email:string,purpose:string,code:string) {
  if (env.EMAIL_DEV_LOG==='1') { console.log(`DEV_EMAIL ${email} ${purpose} ${code}`); return }
  const subject=purpose==='verify'?'验证邮箱':'重置密码'
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
