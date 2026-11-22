import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createHash,randomBytes} from 'node:crypto'
import {once} from 'node:events'
import {createServer} from 'node:net'
import {setTimeout as delay} from 'node:timers/promises'

const sha=text=>createHash('sha256').update(text).digest('hex'),token=()=>randomBytes(32).toString('hex')

// 已配置 SOCIAL_* 的第二个 API 进程：上游指向不可达的 https，验证 pending/confirm 全流程（种子 pending 行代替真实回调）
async function configuredTest({sql,env}) {
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r))
  const origin=`http://127.0.0.1:${port}`
  const child=spawn(process.execPath,['--import','tsx','server/index.mjs'],{env:{...process.env,...env,PORT:String(port),PUBLIC_ORIGIN:origin,EMAIL_DEV_LOG:'1',
    SOCIAL_APPID:'1000',SOCIAL_APPKEY:'test-key',SOCIAL_ENABLED:'wx,qq',SOCIAL_HOST:'https://127.0.0.1:9',SOCIAL_REDIRECT:'https://glol.example/api/auth/social/callback'},stdio:['ignore','pipe','pipe'],detached:true})
  const closed=once(child,'exit');let logs='';for(const s of [child.stdout,child.stderr])s.on('data',c=>logs+=c)
  try{
    for(let i=0;;i++){if(await fetch(origin+'/api/me').then(r=>r.status===401).catch(()=>false))break;if(i>200)throw Error('social server not ready: '+logs);await delay(150)}
    const call=(path,{cookie='',method='GET',body}={})=>fetch(origin+'/api/'+path,{method,redirect:'manual',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body&&JSON.stringify(body)})
    const a=(await sql(`SELECT id FROM users ORDER BY created_at LIMIT 1`))[0].results[0].id,b='socialtest-b-0001',sa=token(),sb=token(),far=Math.floor(Date.now()/1000)+3600
    await sql(`INSERT INTO users(id,email,nickname,salt,digest,verified) VALUES('${b}','b@example.test','B','x','x',1)`)
    await sql(`INSERT INTO sessions(digest,user_id,expires) VALUES('${sha(sa)}','${a}',${far}),('${sha(sb)}','${b}',${far})`)
    const pending=(intent,uid,user)=>{const t=token();return sql(`INSERT INTO social_pending(token,intent,type,social_uid,nickname,faceimg,user_id,expires,used) VALUES('${sha(t)}','${intent}','wx','${uid}','漓江','https://thirdwx.qlogo.cn/a/0','${user}',${far},0)`).then(()=>t)}

    // start：上游不可达 → 502，且不留孤儿 state
    assert.equal((await call('auth/social/start',{method:'POST',body:{type:'wx'}})).status,502)
    assert.equal(Number((await sql(`SELECT count(*) n FROM social_states`))[0].results[0].n),0)
    // callback：跨站导航不被拒，没有 state cookie → expired
    const cb=await fetch(origin+'/api/auth/social/callback?type=wx&code=abcdefgh1234',{redirect:'manual',headers:{'Sec-Fetch-Site':'cross-site'}})
    assert.equal(cb.status,302);assert.equal(new URL(cb.headers.get('location')).search,'?social=expired')

    // bind：展示 → 别人确认 403 且不消费 → 发起人确认 200 → 重放 404
    const tb=await pending('bind','0123456789ABCDEFF60718',a),pc=`glol_social_pending=${tb}`
    const shown=await (await call('auth/social/pending',{cookie:pc})).json();assert.deepEqual([shown.intent,shown.label,shown.nickname],['bind','微信','漓江'])
    assert.equal((await call('auth/social/confirm',{method:'POST',cookie:`${pc}; glol_session=${sb}`,body:{}})).status,403)
    assert.equal(Number((await sql(`SELECT used FROM social_pending WHERE token='${sha(tb)}'`))[0].results[0].used),0)
    assert.equal((await call('auth/social/confirm',{method:'POST',cookie:`${pc}; glol_session=${sa}`,body:{}})).status,200)
    assert.equal((await sql(`SELECT user_id FROM social_identities WHERE social_uid='0123456789ABCDEFF60718'`))[0].results[0].user_id,a)
    assert.equal((await call('auth/social/confirm',{method:'POST',cookie:`${pc}; glol_session=${sa}`,body:{}})).status,404)

    // login：无会话确认 → 两条独立 Set-Cookie，新会话可用
    const tl=await pending('login','0123456789ABCDEFF60718',a)
    const ok=await call('auth/social/confirm',{method:'POST',cookie:`glol_social_pending=${tl}`,body:{}});assert.equal(ok.status,200)
    const set=ok.headers.getSetCookie();assert.equal(set.length,2,JSON.stringify(set))
    const session=set.find(c=>c.startsWith('glol_session='));assert.match(session,/Max-Age=2592000/);assert.doesNotMatch(session,/Max-Age=0/)
    assert.equal((await (await call('me',{cookie:session.split(';')[0]})).json()).id,a)

    // register：pending → confirm 400 → 发码 → 已注册邮箱 409 → 填码 200（两条 cookie、已验证、已绑定、码已删）→ 平台已绑定 409
    const pending2=(intent,uid)=>{const t=token();return sql(`INSERT INTO social_pending(token,intent,type,social_uid,nickname,faceimg,user_id,expires,used) VALUES('${sha(t)}','${intent}','qq','${uid}','象山','',' ',${far},0)`).then(()=>t)}
    const tr=await pending2('register','FEDCBA9876543210AAAAAA'),rc=`glol_social_pending=${tr}`,reg={email:'social-new@example.test',password:'social-password-1'}
    const bad=await call('auth/social/confirm',{method:'POST',cookie:rc,body:{}});assert.equal(bad.status,400);assert.equal((await bad.json()).error.code,'register_incomplete')
    const taken=(await sql(`SELECT email FROM users WHERE id='${a}'`))[0].results[0].email
    assert.equal((await call('auth/social/register',{method:'POST',cookie:rc,body:{...reg,email:taken}})).status,409)
    const p1=await call('auth/social/register',{method:'POST',cookie:rc,body:reg});assert.equal(p1.status,200,await p1.clone().text());assert.equal((await p1.json()).needs_code,true)
    let mailed;for(let i=0;i<50&&!mailed;i++){mailed=logs.match(/DEV_EMAIL social-new@example\.test verify (\d{6})/)?.[1];if(!mailed)await delay(100)}
    assert.ok(mailed,'register code mailed')
    const wrong=await call('auth/social/register',{method:'POST',cookie:rc,body:{...reg,password:'other-password-9',code:mailed}});assert.equal(wrong.status,400)
    const p2=await call('auth/social/register',{method:'POST',cookie:rc,body:{...reg,code:mailed}});assert.equal(p2.status,200,await p2.clone().text())
    const set2=p2.headers.getSetCookie();assert.equal(set2.length,2,JSON.stringify(set2))
    const me=await (await call('me',{cookie:set2.find(c=>c.startsWith('glol_session=')).split(';')[0]})).json();assert.equal(me.email,reg.email);assert.equal(me.verified,true)
    assert.equal((await sql(`SELECT u.email FROM social_identities s JOIN users u ON u.id=s.user_id WHERE s.social_uid='FEDCBA9876543210AAAAAA'`))[0].results[0].email,reg.email)
    assert.equal(Number((await sql(`SELECT count(*) n FROM email_codes WHERE email='${reg.email}'`))[0].results[0].n),0)
    const tr2=await pending2('register','FEDCBA9876543210AAAAAA')
    assert.equal((await call('auth/social/register',{method:'POST',cookie:`glol_social_pending=${tr2}`,body:{email:'x2@example.test',password:'social-password-1'}})).status,409)
    await sql(`DELETE FROM social_identities`);await sql(`DELETE FROM social_pending`);await sql(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email='${reg.email}')`);await sql(`DELETE FROM users WHERE email='${reg.email}'`);await sql(`DELETE FROM mail_events WHERE email='${reg.email}'`);await sql(`DELETE FROM sessions WHERE user_id='${b}'`);await sql(`DELETE FROM users WHERE id='${b}'`)
    console.log('Social configured: start 502 w/o orphan state, cross-site callback→expired, bind confirm 403 (not consumed)/200/404 replay, login confirm sets 2 cookies + working session; register 2-phase (409 email_taken/conflict, password mismatch 400, 2 cookies, verified+bound, code deleted)')
  }catch(error){console.error(logs.slice(-3000));throw error}
  finally{if(child.exitCode===null){process.kill(-child.pid,'SIGTERM');await closed}}
}

// 聚合登录（未配置 SOCIAL_*）+ 后台用户详情绑定展示，跑在 hk01 同款 Postgres 上
export async function socialTest({api,origin,sql,env}) {
  await api('auth/social/start',{type:'wx'},503,'social_unconfigured')
  await api('auth/social/start',{type:'bogus'},400,'invalid_input')
  const callback=await fetch(origin+'/api/auth/social/callback?type=wx&code=abcdefgh1234',{redirect:'manual',headers:{'Sec-Fetch-Site':'cross-site'}})
  assert.equal(callback.status,302);assert.equal(new URL(callback.headers.get('location')).search,'?social=disabled')

  const id=(await sql('SELECT id FROM users ORDER BY created_at LIMIT 1'))[0].results[0].id
  await api(`admin/users/${id}`,null,403,'forbidden')
  await sql(`UPDATE users SET role='admin' WHERE id='${id}'`)
  assert.deepEqual((await api(`admin/users/${id}`)).social,[])
  await sql(`INSERT INTO social_identities(type,social_uid,user_id,nickname,faceimg,created_at,last_login_at) VALUES
    ('wx','0123456789ABCDEFF60718','${id}','漓江','https://thirdwx.qlogo.cn/a/0',100,200),
    ('qq','FEDCBA9876543210AAAAAA','${id}','象山','https://evil.example/a.png',300,400)`)
  const detail=await api(`admin/users/${id}`)
  for(const key of ['salt','digest','failures','locked_until'])assert.equal(key in detail.user,false,key)
  assert.deepEqual(detail.social.map(({type,label,nickname,avatar,uid})=>({type,label,nickname,avatar,uid})),[
    {type:'wx',label:'微信',nickname:'漓江',avatar:'https://thirdwx.qlogo.cn/a/0',uid:'…F60718'},
    {type:'qq',label:'QQ',nickname:'象山',avatar:'',uid:'…AAAAAA'}])
  await api('admin/users/no-such-user-x',null,404,'not_found')
  await sql(`DELETE FROM social_identities`);await sql(`UPDATE users SET role='user' WHERE id='${id}'`)
  await api('auth/logout',{});await api(`admin/users/${id}`,null,401,'unauthorized')
  await configuredTest({sql,env})
  console.log('Social: unconfigured 503/302 disabled, cross-site callback not rejected, admin detail 403→200 with masked uid + avatar allowlist, 404, 401')
}
