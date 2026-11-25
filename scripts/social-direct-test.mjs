import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {readFile} from 'node:fs/promises'
import {createHash,timingSafeEqual} from 'node:crypto'
import {tsImport} from 'tsx/esm/api'
import pg from 'pg'
import {database} from '../server/postgres.mjs'

export async function testDirect(databaseUrl) {
  const {onRequest}=await tsImport('../functions/api/[[path]].ts',import.meta.url)
  const pool=new pg.Pool({connectionString:databaseUrl}), DB=database(pool)
  const env={DB,QQ_APPID:'1001',QQ_APPKEY:'secret',WX_APPID:'wx-test',WX_SECRET:'secret',EMAIL_DEV_LOG:'1',SOCIAL_APPID:'1',SOCIAL_APPKEY:'secret',SOCIAL_ENABLED:'qq,wx',SOCIAL_REDIRECT:'https://test.local/api/auth/social/callback'}
  const originalFetch=globalThis.fetch
  const originalEqual=crypto.subtle.timingSafeEqual
  crypto.subtle.timingSafeEqual=(left,right)=>left.byteLength===right.byteLength && timingSafeEqual(left,right)
  const upstream=createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost'),path=url.pathname, params=url.searchParams, token=params.get('access_token')
    let payload
    if(path==='/graph.qq.com/oauth2.0/token' && params.get('fmt')==='json')payload={access_token:params.get('code')}
    if(path==='/graph.qq.com/oauth2.0/me' && params.get('unionid')==='1')payload={client_id:'1001',openid:token}
    if(path==='/graph.qq.com/user/get_user_info')payload={ret:0,nickname:'QQ test'}
    if(path==='/api.weixin.qq.com/sns/oauth2/access_token')payload={access_token:params.get('code'),openid:params.get('code'),unionid:'union-test'}
    if(path==='/api.weixin.qq.com/sns/userinfo')payload={openid:token,nickname:'WeChat test'}
    if(path==='/login.mapay.cn/connect.php')payload={code:0,type:params.get('type'),social_uid:params.get('code'),url:'https://old.test/login'}
    res.writeHead(payload?200:400,{'Content-Type':'application/json'});res.end(JSON.stringify(payload??{}))
  })
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening')
  globalThis.fetch=(input,init)=>{const url=new URL(input);return originalFetch(`http://127.0.0.1:${upstream.address().port}/${url.host}${url.pathname}${url.search}`,init)}
  const origin='https://test.local',sha=value=>createHash('sha256').update(value).digest('hex')
  const call=(path,body,cookie='')=>onRequest({env,request:new Request(origin+'/api/'+path,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body&&JSON.stringify(body)})})
  const cookies=response=>response.headers.getSetCookie().map(value=>value.split(';')[0])
  const reason=response=>new URL(response.headers.get('location')).searchParams.get('social')
  async function flow(type,intent,openid,session='',checkBrowser=false){
    const start=await call('auth/oauth/start',{type,intent},session);assert.equal(start.status,200,await start.clone().text())
    const url=new URL((await start.json()).url);assert.equal(url.searchParams.get('redirect_uri'),origin+`/api/auth/oauth/${type}/callback`)
    const callback=`auth/oauth/${type}/callback?state=${url.searchParams.get('state')}&code=${openid}`
    if(checkBrowser)assert.equal(reason(await call(callback)), 'expired')
    const jar=[session,...cookies(start)].join('; '),response=await call(callback,null,jar)
    if(checkBrowser)assert.equal(reason(await call(callback,null,jar)),'expired')
    return response
  }
  const config=async()=>(await call('auth/social/config')).json()
  const me=async session=>(await call('me',null,session)).json()
  const confirm=(pending,body,session='')=>call('auth/social/confirm',body,[session,...cookies(pending)].join('; '))
  async function legacy(uid){
    const start=await call('auth/social/start',{type:'qq',intent:'login'})
    return call('auth/social/callback?type=qq&code='+uid,null,cookies(start).join('; '))
  }
  try {
    const {QQ_APPID,WX_APPID}=env;delete env.QQ_APPID;delete env.WX_APPID
    assert.deepEqual(await config(),{enabled:[{type:'qq',label:'QQ'},{type:'wx',label:'微信'}]});Object.assign(env,{QQ_APPID,WX_APPID})
    const token='b'.repeat(64),session='glol_session='+token
    await pool.query("INSERT INTO users(id,email,nickname,salt,digest,verified,email_placeholder) VALUES('oauth-test','oauth-test@social.invalid','test','test','test',1,1)")
    await pool.query("INSERT INTO sessions(digest,user_id,expires) VALUES($1,'oauth-test',unixepoch()+600)",[sha(token)])
    await pool.query("INSERT INTO social_identities(type,social_uid,user_id,created_at,last_login_at) VALUES('qq','old-identity','oauth-test',0,0)")
    const sql=await readFile('deploy/postgres/018-social-direct.sql','utf8');await pool.query(sql);await pool.query(sql)
    const oldStart=(intent,type='qq')=>call('auth/social/start',{intent,type},session)
    for(const intent of ['register','bind','login'])assert.equal((await oldStart(intent,'wx')).status,200)
    assert.equal((await me(session)).migration.required,false)
    env.SOCIAL_LEGACY_CUTOFF='2020-01-01'
    await pool.query("INSERT INTO users(id,email,nickname,salt,digest,verified,email_placeholder) VALUES('verified-test','already@example.test','test','test','test',1,0)")
    await pool.query("INSERT INTO social_identities(type,social_uid,user_id,created_at,last_login_at) VALUES('qq','verified-identity','verified-test',0,0)")
    const exempt=await confirm(await legacy('verified-identity'),{})
    assert.equal((await me(cookies(exempt).find(value=>value.startsWith('glol_session')))).migration.required,false)
    for(const intent of ['register','bind'])assert.equal((await (await oldStart(intent)).json()).error.code,'legacy_closed')
    assert.equal(reason(await legacy('old-unknown')),'legacy_closed')
    const first=await confirm(await legacy('old-identity'),{}),legacySession=cookies(first).find(c=>c.startsWith('glol_session'))
    assert.deepEqual((await me(legacySession)).migration,{required:true,blocking:true,deadline:null,legacy:['qq'],direct:[],options:['qq','wx','email']})
    const email='oauth-migrate@example.test',password='migration-password',bind={migrate:true,email,password}
    assert.equal((await (await call('auth/email/bind',{email,migrate:true},legacySession)).json()).error.code,'password_required')
    assert.equal((await (await call('auth/email/bind',bind,legacySession)).json()).needs_code,true)
    await pool.query("UPDATE email_codes SET digest=$1 WHERE email=$2 AND purpose='verify'",[sha(email+':verify:123456'),email])
    assert.equal((await (await call('auth/email/bind',{...bind,code:'123456'},legacySession)).json()).redirect,'/?social=migrated')
    assert.equal((await me(legacySession)).migration.required,false)
    const again=await confirm(await legacy('old-identity'),{});assert.equal((await me(cookies(again).find(c=>c.startsWith('glol_session')))).migration.blocking,false)
    assert.equal((await call('auth/oauth/start',{type:'qq',intent:'migrate'})).status,401)
    const choice=await flow('qq','login','old-identity','',true);assert.equal(reason(choice),'new')
    assert.equal((await confirm(choice,{choice:'legacy'})).status,200);assert.notEqual((await confirm(choice,{choice:'register'})).status,200)
    const fresh=await flow('qq','login','old-identity');assert.equal(reason(fresh),'new')
    const shown=await (await call('auth/social/pending',null,cookies(fresh).join('; '))).json();assert.deepEqual([shown.channel,shown.intent,shown.takeover,shown.label,shown.owner_created_at],['direct','new',false,'QQ 登录',null])
    const created=await confirm(fresh,{choice:'register'});assert.equal(cookies(created).length,2)
    const freshAccount=await me(cookies(created).find(c=>c.startsWith('glol_session')));assert.notEqual(freshAccount.id,'oauth-test')
    assert.equal(reason(await flow('qq','login','old-identity')),'login')
    const pending=await flow('qq','migrate','old-identity',session);assert.equal(reason(pending),'takeover')
    const takeoverShown=await (await call('auth/social/pending',null,[session,...cookies(pending)].join('; '))).json();assert.equal(takeoverShown.takeover,true);assert.equal(takeoverShown.owner_created_at,Number((await pool.query('SELECT created_at FROM users WHERE id=$1',[freshAccount.id])).rows[0].created_at))
    assert.equal((await confirm(pending,{},session)).status,409)
    assert.equal((await confirm(pending,{takeover:true},session)).status,200)
    assert.equal((await pool.query("SELECT id FROM users WHERE id=$1",[freshAccount.id])).rowCount,1)
    assert.equal((await pool.query("SELECT id FROM admin_audit WHERE action='social_takeover' AND target_id=$1",[freshAccount.id])).rowCount,1)
    assert.equal(reason(await flow('wx','bind','wx-openid',session)),'bound')
    assert.equal(reason(await flow('wx','migrate','wx-openid',session)),'migrated')
    const different=cookies(created).find(c=>c.startsWith('glol_session'))
    assert.equal((await flow('qq','bind','old-identity',different)).status,409)
    assert.deepEqual((await me(session)).migration.direct.sort(),['qq','wx'])
    assert.equal((await pool.query("SELECT unionid FROM social_identities WHERE type='wx' AND social_uid='wx-openid'")).rows[0].unionid,'union-test')
    env.SOCIAL_LEGACY_SUNSET='2021-01-01';assert.equal((await oldStart('login')).status,410);assert.deepEqual((await config()).legacy,[])
  } finally {globalThis.fetch=originalFetch;crypto.subtle.timingSafeEqual=originalEqual;await pool.end();await new Promise(resolve=>upstream.close(resolve))}
}
