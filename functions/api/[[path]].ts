import {type SessionAccount,type Env,checkBan,sessionAccount,Problem,cookie,deliver,equal,hash,invalid,lifetime,limit,newCode,now,passwordHash,random,reserveMail,sessionHash,unauthorized} from '../../lib/auth'

import {AVATAR_KEY, looks, sanitizeAvatar, starterOutfit} from '../../lib/avatar'
import {feedback} from '../../lib/feedback'
import {citizen} from '../../lib/citizen'
import {feedbackContributors} from '../../lib/contributors'
import {bindEmail,isSocialType,socialCallback,socialConfig,socialConfirm,socialPending,socialRegister,socialStates,startSocial,userSocialIdentities} from '../../lib/social'
import {unsubscribe} from '../../lib/feedback-mail'
import {cloudSave} from '../../lib/cloud-save'
type User = SessionAccount & {salt:string;digest:string;locked_until:number}
const profile=(user:SessionAccount)=>({id:user.id,uid:user.uid,email:user.email,nickname:user.nickname,verified:!!user.verified,role:user.role,notify_email:!!user.notify_email,email_placeholder:!!user.email_placeholder})
const json=(data:unknown,status=200,session?:string)=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...(session?{'Set-Cookie':session}:{})}})
function nickname(value:unknown) {
  if(typeof value!=='string'||!value.trim()||value.trim().length>32) invalid()
  return value.trim()
}
function password(value:unknown) {
  if(typeof value!=='string'||value.length<8||value.length>256) invalid()
  return value
}
const methods:Record<string,string[]>={'rt/ticket':['POST'],health:['GET'],'auth/me':['GET'],'me/avatar':['GET','PUT'],me:['GET','PATCH'],...Object.fromEntries(['register','resend','verify','reset','login','logout','social/start'].map(name=>[`auth/${name}`,['POST']])),'auth/social/callback':['GET'],'auth/social/pending':['GET'],'auth/social/confirm':['POST'],'auth/social/config':['GET'],'auth/social/register':['POST'],'auth/email/bind':['POST']}

async function handle(request:Request,env:Env) {
  const url=new URL(request.url), path=url.pathname.slice(5), method=request.method, db=env.DB
  const stmt=(sql:string,...args:(string|number)[])=>db.prepare(sql).bind(...args)
  if(method==='GET'&&path==='unsubscribe')return unsubscribe(env,url)
  if(method==='GET'&&path==='contributors')return feedbackContributors(env)
  if(/^(feedback|bridge|admin)(\/|$)/.test(path)) return feedback(request,env,path)
  if(path==='me/save')return cloudSave(request,env)
  if(path.startsWith('citizen/'))return citizen(request,env,path)
  if(!Object.hasOwn(methods,path)) throw new Problem(404,'not_found','接口不存在')
  if(!methods[path].includes(method)) throw new Problem(405,'method','不支持的请求方式')
  if(path==='health')return json({ok:true})
  if(method!=='GET'&&request.headers.get('Origin')!==url.origin) throw new Problem(403,'origin','请求来源不符')
  let body:Record<string,unknown>={}
  if(method!=='GET'&&path!=='auth/logout'&&path!=='rt/ticket') {
    try { body=await request.json() } catch { invalid() }
    if(!body||typeof body!=='object'||Array.isArray(body)) invalid()
  }
  if(path==='auth/social/callback') return socialCallback(env,db,request)
  if(path==='auth/social/config') return socialConfig(env)
  if(path==='auth/social/pending') return socialPending(env,db,request)
  if(path==='auth/social/register') return socialRegister(env,db,request,body)
  if(path==='auth/social/confirm') return socialConfirm(env,db,request)
  if(path==='auth/email/bind') return bindEmail(env,db,request,body)
  if(path==='auth/social/start') {
    const type=body.type
    if(!isSocialType(type)) invalid()
    const intent=body.intent==='bind'?'bind':body.intent==='register'?'register':'login'
    let userId:string|undefined
    if(intent==='bind') {
      const account=await sessionAccount(db,await sessionHash(request))
      if(!account?.verified) unauthorized()
      userId=account.id
    }
    const {cookie:stateCookie,url:target,qrcode}=await startSocial(env,db,type,request.headers.get('CF-Connecting-IP')||'local',intent,userId,socialStates(request))
    return json({url:target,qrcode},200,stateCookie)
  }
  if(path==='auth/logout') {
    await stmt('DELETE FROM sessions WHERE digest=?',await sessionHash(request)).run()
    return json({ok:true},200,cookie('',0))
  }
  if(path==='me' || path==='auth/me' || path==='me/avatar' || path==='rt/ticket') {
    const digest=await sessionHash(request)
    const user=await sessionAccount(db,digest)
    if(!user) unauthorized()
    if(path==='rt/ticket') {
      if(!user.verified) unauthorized()
      if(!env.RT_JOIN_SECRET) throw new Problem(503,'rt_disabled','联机暂不可用')
      const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
      const utf8=new TextEncoder()
      const payload=encode(utf8.encode(JSON.stringify({uid:user.uid,name:user.nickname,exp:now()+60})))
      const key=await crypto.subtle.importKey('raw',utf8.encode(env.RT_JOIN_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign'])
      return json({ticket:payload+'.'+encode(new Uint8Array(await crypto.subtle.sign('HMAC',key,utf8.encode(payload))))})
    }
    if(path==='me/avatar') {
      const row=await stmt('SELECT payload_json,revision FROM player_saves WHERE user_id=?',user.id)
        .first<{payload_json:string;revision:number}>()
      const payload=row ? JSON.parse(row.payload_json) : {}
      if(method==='GET') return json({avatar:sanitizeAvatar(payload[AVATAR_KEY]) ?? null})
      const avatar=sanitizeAvatar(body.avatar)
      if(!avatar) invalid()
      const timestamp=now()
      if(body.equipStarter===true || sanitizeAvatar(payload[AVATAR_KEY])?.look!==avatar.look) {
        const wardrobe=payload.wardrobe??{}
        const items=looks.flatMap(look=>Object.values(starterOutfit(look)))
        payload.wardrobe={...wardrobe,equipped:starterOutfit(avatar.look),
          ownedItemIds:[...new Set([...(wardrobe.ownedItemIds??[]),...items])],
          ownedPresetIds:[...new Set([...(wardrobe.ownedPresetIds??[]),...looks.map(l=>l==='basic'?'outfit_default':'starter_'+l)])]}
      }
      payload.schemaVersion=2
      payload.updatedAt=Date.now()
      payload[AVATAR_KEY]=avatar
      const saved=await stmt(`INSERT INTO player_saves(user_id,schema_version,revision,payload_json,client_updated_at,updated_at)
        VALUES(?,2,1,?,?,?) ON CONFLICT(user_id) DO UPDATE SET payload_json=excluded.payload_json,
        revision=player_saves.revision+1,client_updated_at=excluded.client_updated_at,updated_at=excluded.updated_at
        WHERE player_saves.revision=?`,user.id,JSON.stringify(payload),timestamp,timestamp,row?.revision ?? 0).run()
      if(!saved.meta.changes) throw new Problem(409,'conflict','存档已更新，请重试')
      return json({avatar})
    }
    const writes=[stmt('UPDATE sessions SET expires=? WHERE digest=? AND expires>?',now()+lifetime,digest,now())]
    if(method==='PATCH') {
      if('notify_email' in body){if(typeof body.notify_email!=='boolean')invalid();user.notify_email=Number(body.notify_email);writes.push(stmt('UPDATE users SET notify_email=? WHERE id=?',user.notify_email,user.id))}
      if('nickname' in body)user.nickname=nickname(body.nickname)
      writes.push(stmt('UPDATE users SET nickname=? WHERE id=? AND EXISTS (SELECT 1 FROM sessions WHERE digest=?)',user.nickname,user.id,digest))
    }
    if(!(await db.batch(writes))[0].meta.changes) unauthorized()
    // 带上已绑定的第三方平台，账号面板据此显示「已绑定」而不是还让用户去绑
    const social=await userSocialIdentities(db,user.id)
    return json({...profile(user),social},200,cookie(request.headers.get('Cookie')!.match(/(?:^|;\s*)glol_session=([a-f0-9]{64})(?:;|$)/)![1]))
  }
  const email=typeof body.email==='string'?body.email.trim().toLowerCase():''
  // @social.invalid 是第三方专用账号的占位域名，不允许被当成真实邮箱注册
  if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||email.split('@').length!==2||/@social\.invalid$/i.test(email)) invalid()
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
        DO UPDATE SET signup_method='email',nickname=excluded.nickname,salt=excluded.salt,digest=excluded.digest WHERE users.verified=0`,
        crypto.randomUUID(),email,name,salt,await passwordHash(pass,salt)))
    }
    writes.push(stmt('INSERT INTO email_codes VALUES(?,?,?,?,0) ON CONFLICT(email,purpose) DO UPDATE SET digest=excluded.digest,expires=excluded.expires,attempts=0',email,purpose,await hash(`${email}:${purpose}:${code}`),now()+600))
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
    checkBan(user)
    if(!user.verified) throw new Problem(403,'unverified','请先验证邮箱')
    const [session]=await db.batch([stmt(`INSERT INTO sessions SELECT ?,id,? FROM users WHERE id=? AND digest=? AND locked_until<=? AND banned_at=0`,sessionDigest,now()+lifetime,user.id,user.digest,now()),
      stmt('UPDATE users SET failures=0 WHERE id=? AND EXISTS(SELECT 1 FROM sessions WHERE digest=?)',user.id,sessionDigest)])
    if(!session.meta.changes) { checkBan(await getUser()); unauthorized() }
    return json(profile(user),200,cookie(token))
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
  if(!reset) checkBan(user)
  const salt=random(16)
  const deleteCode='DELETE FROM email_codes WHERE email=? AND purpose=? AND digest=? AND expires>?'
  const consume=reset?stmt(deleteCode,email,purpose,record.digest,now()):stmt(`${deleteCode} AND EXISTS
    (SELECT 1 FROM users WHERE id=? AND verified=0 AND banned_at=0 AND salt=? AND digest=?)`,email,purpose,record.digest,now(),user.id,user.salt,user.digest)
  const [used]=await db.batch(reset?[consume,
    stmt('UPDATE users SET salt=?,digest=?,failures=0,locked_until=0 WHERE id=? AND changes()=1',salt,await passwordHash(pass,salt),user.id),
    stmt('DELETE FROM sessions WHERE user_id=? AND changes()=1',user.id)]:[consume,
    stmt('UPDATE users SET verified=1 WHERE id=? AND verified=0 AND changes()=1',user.id),
    stmt('INSERT INTO sessions SELECT ?,?,? WHERE changes()=1',sessionDigest,user.id,now()+lifetime)])
  if(!used.meta.changes) throw bad()
  return reset?json({ok:true}):json(profile({...user,verified:1}),200,cookie(token))
}
export const onRequest:PagesFunction<Env>=async ({request,env})=>{
  try { return await handle(request,env) } catch(error) {
    if(!(error instanceof Problem)) console.error(error)
    const problem=error instanceof Problem?error:new Problem(500,'internal','服务暂时不可用')
    return json({error:{code:problem.code,message:problem.message}},problem.status)
  }
}
