import {type Env, Problem, cookie, hash, lifetime, limit, now, random, sessionAccount, sessionHash, unauthorized, invalid} from './auth'
import {clearPending, socialRegister, isUniqueViolation, pendingCookie, pendingToken, safeAvatar} from './social'
import {midnight, providers, type Provider} from './social-policy'

const qq='https://graph.qq.com', wx='https://api.weixin.qq.com'
const callbackUrl=(env:Env,type:Provider,request:Request)=>(type==='qq'?env.QQ_REDIRECT:env.WX_REDIRECT) || `https://${new URL(request.url).host}/api/auth/oauth/${type}/callback`
const query=(base:string,params:Record<string,string>)=>base+'?'+new URLSearchParams(params)
const stateCookie=(state:string)=>`__Host-glol_oauth=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`
const back=(reason:string,request:Request,setCookie?:string)=>new Response(null,{status:302,headers:{Location:new URL('/?social='+reason,request.url).href,'Cache-Control':'no-store',...(setCookie?{'Set-Cookie':setCookie}:{})}})
const conflict=()=>new Problem(409,'already_bound','该身份已绑定其他账号')

function alreadyBound(request:Request) {
  const headers={'Cache-Control':'no-store'}
  return request.headers.get('Accept')?.includes('text/html')
    ? new Response('<meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/?social=already_bound"><a href="/?social=already_bound">该身份已绑定其他账号</a>',{status:409,headers:{...headers,'Content-Type':'text/html; charset=utf-8'}})
    : Response.json({error:{code:'already_bound',message:'该身份已绑定其他账号'},redirect:'/?social=already_bound'},{status:409,headers})
}

export async function oauthStart(env:Env,db:D1Database,request:Request,body:Record<string,unknown>) {
  const {type,intent}=body
  if ((type!=='qq' && type!=='wx') || (intent!=='login' && intent!=='bind' && intent!=='migrate')) invalid()
  if (!providers(env).includes(type)) throw new Problem(403,'social_disabled','该方式未启用')
  const account=intent==='login'?null:await sessionAccount(db,await sessionHash(request))
  if (intent!=='login' && !account?.verified) unauthorized()
  const state=random(32), ip=request.headers.get('CF-Connecting-IP') || 'local'
  await limit(db,'oauth:start:'+ip,30,60)
  await db.batch([db.prepare('DELETE FROM social_states WHERE expires<=?').bind(now()),db.prepare("INSERT INTO social_states(channel,state,type,intent,user_id,expires,ip) VALUES('direct',?,?,?,?,?,?)").bind(state,type,intent,account?.id??null,now()+600,ip)])
  const params={response_type:'code',redirect_uri:callbackUrl(env,type,request),state}
  const url=type==='qq'?query(qq+'/oauth2.0/authorize',{...params,client_id:env.QQ_APPID!,scope:'get_user_info'}):query('https://open.weixin.qq.com/connect/qrconnect',{...params,appid:env.WX_APPID!,scope:'snsapi_login'})+'#wechat_redirect'
  return Response.json({url},{headers:{'Cache-Control':'no-store','Set-Cookie':stateCookie(state)}})
}

async function providerJson(endpoint:string,params:Record<string,string>) {
  const response=await fetch(query(endpoint,params),{redirect:'error',signal:AbortSignal.timeout(8000)})
  if (!response.ok) throw Error('upstream')
  const data=await response.json() as Record<string,unknown>
  if (data.error || data.errcode || data.ret) throw Error('upstream')
  return data
}
function text(value:unknown) {return typeof value==='string'?value:''}
async function exchange(env:Env,type:Provider,code:string,request:Request) {
  const token=type==='qq'?await providerJson(qq+'/oauth2.0/token',{grant_type:'authorization_code',client_id:env.QQ_APPID!,client_secret:env.QQ_APPKEY!,code,redirect_uri:callbackUrl(env,type,request),fmt:'json'}):await providerJson(wx+'/sns/oauth2/access_token',{appid:env.WX_APPID!,secret:env.WX_SECRET!,grant_type:'authorization_code',code})
  const access_token=text(token.access_token)
  if (!access_token) throw Error('missing token')
  let identity=token
  if (type==='qq') {
    try {identity=await providerJson(qq+'/oauth2.0/me',{access_token,unionid:'1',fmt:'json'})}
    catch {identity=await providerJson(qq+'/oauth2.0/me',{access_token,fmt:'json'})}
  }
  const openid=text(identity.openid)
  if (!openid || openid.length>128 || (type==='qq' && String(identity.client_id)!==env.QQ_APPID)) throw Error('invalid identity')
  const info=type==='qq'?await providerJson(qq+'/user/get_user_info',{access_token,openid,oauth_consumer_key:env.QQ_APPID!}):await providerJson(wx+'/sns/userinfo',{access_token,openid,lang:'zh_CN'})
  if (type==='wx' && info.openid!==openid) throw Error('profile mismatch')
  return {openid,unionid:text(identity.unionid || info.unionid)||null,nickname:text(info.nickname).slice(0,32),avatar:safeAvatar(info.headimgurl || info.figureurl_qq_2 || info.figureurl_qq_1)}
}

const eligible=`EXISTS(SELECT 1 FROM users AS owner WHERE owner.id=social_identities.user_id AND owner.email_placeholder=1 AND owner.banned_at=0 AND owner.created_at>=?) AND NOT EXISTS(SELECT 1 FROM social_identities AS other WHERE other.user_id=social_identities.user_id AND NOT(other.channel='direct' AND other.type=social_identities.type AND other.social_uid=social_identities.social_uid))`
const live=`EXISTS(SELECT 1 FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.digest=? AND users.id=? AND expires>? AND banned_at=0 AND verified=1)`
const cutoff=(env:Env)=>Number.isFinite(midnight(env.SOCIAL_LEGACY_CUTOFF))?midnight(env.SOCIAL_LEGACY_CUTOFF):Number.MAX_SAFE_INTEGER

export async function oauthCallback(env:Env,db:D1Database,request:Request,type:Provider) {
  const params=new URL(request.url).searchParams, state=params.get('state'), code=params.get('code')
  const sameBrowser=request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-glol_oauth=([a-f0-9]{64})(?:;|$)/)?.[1]
  if (!state || state!==sameBrowser || !code || !providers(env).includes(type)) return back('expired',request)
  const flow=await db.prepare("UPDATE social_states SET used=1 WHERE channel='direct' AND type=? AND state=? AND used=0 AND expires>? RETURNING intent,user_id").bind(type,state,now()).first<{intent:string;user_id:string}>()
  if (!flow) return back('expired',request)
  const digest=await sessionHash(request)
  if (flow.intent!=='login' && (await sessionAccount(db,digest))?.id!==flow.user_id) return back('expired',request)
  let profile
  try {profile=await exchange(env,type,code,request)} catch {return back('failed',request)}
  const {openid,unionid,nickname,avatar}=profile
  const owner=await db.prepare("SELECT user_id FROM social_identities WHERE channel='direct' AND type=? AND social_uid=?").bind(type,openid).first<{user_id:string}>()
  if (owner && flow.intent==='login') {
    const token=random(32)
    const issued=await db.prepare(`INSERT INTO sessions(digest,user_id,expires) SELECT ?,u.id,? FROM users u JOIN social_identities s ON s.user_id=u.id WHERE u.id=? AND u.banned_at=0 AND u.verified=1 AND s.channel='direct' AND s.type=? AND s.social_uid=?`).bind(await hash(token),now()+lifetime,owner.user_id,type,openid).run()
    return issued.meta.changes?back('login',request,cookie(token)):back('failed',request)
  }
  if (flow.intent!=='login' && (!owner || owner.user_id===flow.user_id)) {
    if (!owner) try {
      const added=await db.prepare(`INSERT INTO social_identities(channel,type,social_uid,user_id,nickname,faceimg,unionid,created_at,last_login_at) SELECT 'direct',?,?,?,?,?,?,?,? WHERE ${live}`).bind(type,openid,flow.user_id,nickname,avatar,unionid,now(),now(),digest,flow.user_id,now()).run()
      if (!added.meta.changes) return back('expired',request)
    } catch(error) {if(isUniqueViolation(error)) return alreadyBound(request);throw error}
    return back(flow.intent==='migrate'?'migrated':'bound',request)
  }
  if (owner && !await db.prepare(`SELECT user_id FROM social_identities WHERE channel='direct' AND type=? AND social_uid=? AND user_id=? AND ${eligible}`).bind(type,openid,owner.user_id,cutoff(env)).first()) return alreadyBound(request)
  const token=random(32)
  await db.batch([db.prepare('DELETE FROM social_pending WHERE expires<=?').bind(now()),db.prepare("INSERT INTO social_pending(channel,token,intent,type,social_uid,user_id,nickname,faceimg,unionid,previous_owner,expires) VALUES('direct',?,?,?,?,?,?,?,?,?,?)").bind(await hash(token),owner?flow.intent:'new',type,openid,flow.user_id||'',nickname,avatar,unionid,owner?.user_id??null,now()+300)])
  return back(owner?'takeover':'new',request,pendingCookie(token))
}

export async function directDecision(env:Env,db:D1Database,request:Request,body:Record<string,unknown>) {
  const token=await hash(pendingToken(request))
  const row=await db.prepare("SELECT intent,user_id,type,social_uid,unionid,nickname,faceimg,previous_owner FROM social_pending WHERE channel='direct' AND token=? AND used=0 AND expires>?").bind(token,now()).first<{intent:string;user_id:string;type:Provider;social_uid:string;unionid:string|null;nickname:string;faceimg:string;previous_owner:string}>()
  if (!row) return null
  if (!providers(env).includes(row.type)) throw new Problem(403,'social_disabled','该方式未启用')
  const headers:[string,string][]=[['Cache-Control','no-store'],['Set-Cookie',clearPending()]]
  const consume=db.prepare("UPDATE social_pending SET used=1 WHERE token=? AND used=0 AND expires>?").bind(token,now())
  if (row.intent==='new') {
    if (body.choice!=='legacy' && body.choice!=='register') invalid()
    if (body.choice==='register') return socialRegister(env,db,request,body)
    if (!(await consume.run()).meta.changes) throw new Problem(404,'no_pending','授权已过期')
    return Response.json({ok:true,type:row.type},{headers})
  }
  const digest=await sessionHash(request)
  if ((await sessionAccount(db,digest))?.id!==row.user_id) unauthorized()
  if (body.takeover!==true) throw conflict()
  try {
    const [,transfer]=await db.batch([consume,db.prepare(`UPDATE social_identities SET user_id=? WHERE changes()=1 AND channel='direct' AND type=? AND social_uid=? AND user_id=? AND ${eligible} AND ${live}`).bind(row.user_id,row.type,row.social_uid,row.previous_owner,cutoff(env),digest,row.user_id,now()),db.prepare("INSERT INTO admin_audit(actor_id,action,target_type,target_id,detail) SELECT ?,'social_takeover','user',?,? WHERE changes()=1").bind(row.user_id,row.previous_owner,JSON.stringify({type:row.type,to:row.user_id}))])
    if (!transfer.meta.changes) throw conflict()
  } catch(error) {if(isUniqueViolation(error)) throw conflict();throw error}
  return Response.json({ok:true,redirect:'/?social=migrated'},{headers})
}
