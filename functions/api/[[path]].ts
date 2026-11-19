import {type Env,Problem,cookie,deliver,equal,hash,invalid,lifetime,limit,newCode,now,passwordHash,random,reserveMail,sessionHash,unauthorized} from '../../lib/auth'

import {feedback} from '../../lib/feedback'
type User={id:string;email:string;nickname:string;verified:number;role:string;salt:string;digest:string;locked_until:number}
const profile=(user:User)=>({id:user.id,email:user.email,nickname:user.nickname,verified:!!user.verified,role:user.role})
const json=(data:unknown,status=200,session?:string)=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...(session?{'Set-Cookie':session}:{})}})
function nickname(value:unknown) {
  if(typeof value!=='string'||!value.trim()||value.trim().length>32) invalid()
  return value.trim()
}
function password(value:unknown) {
  if(typeof value!=='string'||value.length<8||value.length>256) invalid()
  return value
}
const methods:Record<string,string[]>={me:['GET','PATCH'],...Object.fromEntries(['register','resend','verify','reset','login','logout'].map(name=>[`auth/${name}`,['POST']]))}

async function handle(request:Request,env:Env) {
  const url=new URL(request.url), path=url.pathname.slice(5), method=request.method, db=env.DB
  const secure=!(env.INSECURE_LOCAL_COOKIE==='1'&&url.protocol==='http:')
  const stmt=(sql:string,...args:(string|number)[])=>db.prepare(sql).bind(...args)
  if(/^(feedback|bridge|admin)(\/|$)/.test(path)) return feedback(request,env,path)
  if(!Object.hasOwn(methods,path)) throw new Problem(404,'not_found','接口不存在')
  if(!methods[path].includes(method)) throw new Problem(405,'method','不支持的请求方式')
  if(method!=='GET'&&request.headers.get('Origin')!==url.origin) throw new Problem(403,'origin','请求来源不符')
  let body:Record<string,unknown>={}
  if(method!=='GET'&&path!=='auth/logout') {
    try { body=await request.json() } catch { invalid() }
    if(!body||typeof body!=='object'||Array.isArray(body)) invalid()
  }
  if(path==='auth/logout') {
    await stmt('DELETE FROM sessions WHERE digest=?',await sessionHash(request)).run()
    return json({ok:true},200,cookie('',0,secure))
  }
  if(path==='me') {
    const digest=await sessionHash(request)
    const user=await stmt(`SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id
      WHERE sessions.digest=? AND expires>?`,digest,now()).first<User>()
    if(!user) unauthorized()
    const writes=[stmt('UPDATE sessions SET expires=? WHERE digest=? AND expires>?',now()+lifetime,digest,now())]
    if(method==='PATCH') {
      user.nickname=nickname(body.nickname)
      writes.push(stmt('UPDATE users SET nickname=? WHERE id=? AND EXISTS (SELECT 1 FROM sessions WHERE digest=?)',user.nickname,user.id,digest))
    }
    if(!(await db.batch(writes))[0].meta.changes) unauthorized()
    return json(profile(user),200,cookie(request.headers.get('Cookie')!.match(/(?:^|;\s*)glol_session=([a-f0-9]{64})(?:;|$)/)![1],lifetime,secure))
  }
  const email=typeof body.email==='string'?body.email.trim().toLowerCase():''
  if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||email.split('@').length!==2) invalid()
  const ip=request.headers.get('CF-Connecting-IP')||'local'
  const getUser=()=>stmt('SELECT * FROM users WHERE email=?',email).first<User>()
  if(path==='auth/register'||path==='auth/resend') {
    const register=path==='auth/register', purpose=register?'verify':body.purpose
    if(purpose!=='verify'&&purpose!=='reset') invalid()
    const name=register?nickname(body.nickname):'', pass=register?password(body.password):''
    await reserveMail(db,email,ip)
    const user=await getUser()
    if((purpose==='verify'&&user?.verified)||(purpose==='reset'&&!user?.verified)||(!register&&!user)) return json({ok:true})
    const code=newCode(),writes=[]
    if(register) {
      const salt=random(16)
      writes.push(stmt(`INSERT INTO users(id,email,nickname,salt,digest) VALUES(?,?,?,?,?) ON CONFLICT(email)
        DO UPDATE SET nickname=excluded.nickname,salt=excluded.salt,digest=excluded.digest WHERE users.verified=0`,
        crypto.randomUUID(),email,name,salt,await passwordHash(pass,salt)))
    }
    writes.push(stmt('INSERT OR REPLACE INTO email_codes VALUES(?,?,?,?,0)',email,purpose,await hash(`${email}:${purpose}:${code}`),now()+600))
    await db.batch(writes); await deliver(env,email,purpose,code)
    return json({ok:true})
  }
  const login=path==='auth/login', reset=path==='auth/reset'
  await limit(db,`${login?'login':'code'}:${ip}`,60,900)
  const user=await getUser(), token=random(32), sessionDigest=await hash(token)
  if(login) {
    const pass=password(body.password)
    const locked=()=>new Problem(429,'locked','密码错误次数过多，请在 15 分钟后重试')
    if(user&&user.locked_until>now()) throw locked()
    const valid=equal(await passwordHash(pass,user?.salt??'00'.repeat(16)),user?.digest??'00'.repeat(32))
    if(!valid||!user) {
      if(user) {
        const result=await stmt(`UPDATE users SET failures=CASE WHEN failures>=4 THEN 0 ELSE failures+1 END,
          locked_until=CASE WHEN failures>=4 THEN ? ELSE 0 END WHERE id=? AND locked_until<=? AND digest=? RETURNING locked_until`,now()+900,user.id,now(),user.digest).first<{locked_until:number}>()
        if(result?.locked_until) throw locked()
      }
      throw new Problem(401,'credentials','邮箱或密码不正确')
    }
    if(!user.verified) throw new Problem(403,'unverified','请先验证邮箱')
    const [session]=await db.batch([stmt(`INSERT INTO sessions SELECT ?,id,? FROM users WHERE id=? AND digest=? AND locked_until<=?`,sessionDigest,now()+lifetime,user.id,user.digest,now()),
      stmt('UPDATE users SET failures=0 WHERE id=? AND EXISTS(SELECT 1 FROM sessions WHERE digest=?)',user.id,sessionDigest)])
    if(!session.meta.changes) unauthorized()
    return json(profile(user),200,cookie(token,lifetime,secure))
  }
  const purpose=reset?'reset':'verify', pass=reset?password(body.password):''
  if(typeof body.code!=='string'||!/^\d{6}$/.test(body.code)) invalid()
  const bad=()=>new Problem(400,'invalid_code','验证码无效或已过期')
  const record=await stmt(`UPDATE email_codes SET attempts=attempts+1 WHERE email=? AND purpose=? AND expires>? AND attempts<5 RETURNING digest`,email,purpose,now()).first<{digest:string}>()
  if(!record||!user) throw bad()
  if(!reset) {
    const candidate=body.password
    if(typeof candidate!=='string'||candidate.length<8||candidate.length>256||
      !equal(user.digest,await passwordHash(candidate,user.salt))) throw bad()
  }
  if(!equal(record.digest,await hash(`${email}:${purpose}:${body.code}`))) throw bad()
  const salt=random(16)
  const deleteCode='DELETE FROM email_codes WHERE email=? AND purpose=? AND digest=? AND expires>?'
  const consume=reset?stmt(deleteCode,email,purpose,record.digest,now()):stmt(`${deleteCode} AND EXISTS
    (SELECT 1 FROM users WHERE id=? AND verified=0 AND salt=? AND digest=?)`,email,purpose,record.digest,now(),user.id,user.salt,user.digest)
  const [used]=await db.batch(reset?[consume,
    stmt('UPDATE users SET salt=?,digest=?,failures=0,locked_until=0 WHERE id=? AND changes()=1',salt,await passwordHash(pass,salt),user.id),
    stmt('DELETE FROM sessions WHERE user_id=? AND changes()=1',user.id)]:[consume,
    stmt('UPDATE users SET verified=1 WHERE id=? AND verified=0 AND changes()=1',user.id),
    stmt('INSERT INTO sessions SELECT ?,?,? WHERE changes()=1',sessionDigest,user.id,now()+lifetime)])
  if(!used.meta.changes) throw bad()
  return reset?json({ok:true}):json(profile({...user,verified:1}),200,cookie(token,lifetime,secure))
}
export const onRequest:PagesFunction<Env>=async ({request,env})=>{
  try { return await handle(request,env) } catch(error) {
    if(!(error instanceof Problem)) console.error(error)
    const problem=error instanceof Problem?error:new Problem(500,'internal','服务暂时不可用')
    return json({error:{code:problem.code,message:problem.message}},problem.status)
  }
}
