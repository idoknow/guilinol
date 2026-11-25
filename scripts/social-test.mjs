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
    // 注册意图也要能写 state：上游不可达应是 502，而不是撞 CHECK 的 500
    assert.equal((await call('auth/social/start',{method:'POST',body:{type:'qq',intent:'register'}})).status,502)
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
    const again=await call('auth/social/start',{method:'POST',cookie:`glol_session=${sa}`,body:{type:'wx',intent:'bind'}});assert.equal(again.status,409);assert.equal((await again.json()).error.code,'already_bound')
    const mine=await (await call('me',{cookie:`glol_session=${sa}`})).json();assert.deepEqual(mine.social.map(x=>[x.type,x.uid]),[['wx','…F60718']])

    // login（平台账号未绑定）：直接建 uuid 账号，占位邮箱
    const tn=await pending('login','C0FFEE0123456789ABCDEF',' ')
    const nextUid=Number((await sql('SELECT max(uid) AS last FROM users'))[0].results[0].last)+1
    const created=await call('auth/social/confirm',{method:'POST',cookie:`glol_social_pending=${tn}`,body:{}});assert.equal(created.status,200,await created.clone().text());assert.equal((await created.json()).created,true)
    const ns=created.headers.getSetCookie();assert.equal(ns.length,2)
    const nme=await (await call('me',{cookie:ns.find(c=>c.startsWith('glol_session=')).split(';')[0]})).json()
    assert.equal(nme.email_placeholder,true);assert.equal(nme.uid,nextUid)
    assert.equal((await sql(`SELECT signup_method FROM users WHERE id='${nme.id}'`))[0].results[0].signup_method,'wx')
    const rz=await call('auth/resend',{method:'POST',body:{email:nme.email,purpose:'reset'}});assert.equal(rz.status,400);assert.ok(['no_email','invalid_input'].includes((await rz.json()).error.code))
assert.match(nme.email,/^wx\.c0ffee0123456789abcdef@social\.invalid$/)

    // merge：target=刚建的占位账号，source=真实邮箱账号（含绑定 qq、存档、流水含一条同 key）
    const src='socialtest-src-0001',taken0=(await sql(`SELECT email FROM users WHERE id='${a}'`))[0].results[0].email
    await sql(`INSERT INTO users(id,email,nickname,salt,digest,verified) VALUES('${src}','merge-src@example.test','S','s1','d1',1)`)
    await sql(`INSERT INTO social_identities(type,social_uid,user_id,nickname,faceimg,created_at,last_login_at) VALUES('qq','AAAA0000BBBB1111CCCC','${src}','',' ',1,1),('wx','DDDD0000EEEE1111FFFF','${src}','','',1,1)`)
    await sql(`INSERT INTO player_saves(user_id,payload_json,client_updated_at,updated_at) VALUES('${src}','{}',1,1)`)
    await sql(`INSERT INTO player_ledger_txns(tx_id,user_id,idempotency_key,kind,delta,balance_after,created_at) VALUES('t1','${src}','k1','x',1,1,1),('t2','${src}','k2','x',1,2,1),('t3','${nme.id}','k1','x',5,5,1)`)
    await sql(`UPDATE users SET role='admin' WHERE id='${a}'`)
    await sql(`UPDATE users SET banned_at=123,ban_reason='测试',banned_by='${a}' WHERE id='${src}'`)
    const merged=await call(`admin/users/${nme.id}/merge`,{method:'POST',cookie:`glol_session=${sa}`,body:{from:'merge-src@example.test'}})
    assert.equal(merged.status,200,await merged.clone().text());const mj=await merged.json()
    assert.deepEqual([mj.moved,mj.conflicts,mj.adopted_email,mj.took_saves],[['qq'],['wx'],'merge-src@example.test',true])
    const tu=(await sql(`SELECT email,email_placeholder,digest FROM users WHERE id='${nme.id}'`))[0].results[0];assert.deepEqual([tu.email,Number(tu.email_placeholder),tu.digest],['merge-src@example.test',0,'d1'])
    assert.equal(Number((await sql(`SELECT count(*) n FROM users WHERE id='${src}'`))[0].results[0].n),0)
    assert.deepEqual((await sql(`SELECT tx_id FROM player_ledger_txns WHERE user_id='${nme.id}' ORDER BY tx_id`))[0].results.map(r=>r.tx_id),['t1','t2','t3'])
    assert.equal((await sql(`SELECT idempotency_key k FROM player_ledger_txns WHERE tx_id='t1'`))[0].results[0].k,'k1:merged:'+src)
    assert.equal(Number((await sql(`SELECT count(*) n FROM player_saves WHERE user_id='${nme.id}'`))[0].results[0].n),1)
    assert.equal(Number((await sql(`SELECT count(*) n FROM admin_audit WHERE action='merge_users'`))[0].results[0].n),1)
    // 运营：重置密码（无会话也要留审计）+ 改邮箱（占用 409）
    await sql(`DELETE FROM sessions WHERE user_id='${nme.id}'`)
    assert.equal((await sql(`SELECT banned_at FROM users WHERE id='${nme.id}'`))[0].results[0].banned_at,123)
    assert.equal((await sql("SELECT detail FROM admin_audit WHERE action='merge_users'"))[0].results[0].detail.banned,true)
    const pw=await call(`admin/users/${nme.id}/password`,{method:'POST',cookie:`glol_session=${sa}`,body:{}});assert.equal(pw.status,200,await pw.clone().text())
    const newPass=(await pw.json()).password;assert.ok(newPass.length>=8)
    assert.equal(Number((await sql(`SELECT count(*) n FROM admin_audit WHERE action='reset_password'`))[0].results[0].n),1)
    const mergeLogin={method:'POST',body:{email:'merge-src@example.test',password:newPass}}
    assert.equal((await call('auth/login',mergeLogin)).status,403)
    assert.equal((await call(`admin/users/${nme.id}/unban`,{method:'POST',cookie:`glol_session=${sa}`,body:{}})).status,200)
    assert.equal((await call('auth/login',mergeLogin)).status,200)
    assert.equal((await call(`admin/users/${nme.id}/email`,{method:'POST',cookie:`glol_session=${sa}`,body:{email:taken0}})).status,409)
    const em=await call(`admin/users/${nme.id}/email`,{method:'POST',cookie:`glol_session=${sa}`,body:{email:'renamed@example.test'}});assert.equal(em.status,200)
    assert.equal(Number((await sql(`SELECT count(*) n FROM admin_audit WHERE action='change_email'`))[0].results[0].n),1)
    await sql(`DELETE FROM player_ledger_txns`);await sql(`DELETE FROM player_saves`);await sql(`DELETE FROM sessions WHERE user_id='${nme.id}'`);await sql(`DELETE FROM social_identities WHERE user_id='${nme.id}'`);await sql(`DELETE FROM users WHERE id='${nme.id}'`);await sql(`UPDATE users SET role='user' WHERE id='${a}'`)

    // login：无会话确认 → 两条独立 Set-Cookie，新会话可用
    const tl=await pending('login','0123456789ABCDEFF60718',a)
    await sql(`UPDATE users SET banned_at=123,ban_reason='测试' WHERE id='${a}'`)
    for (const [path,body] of [['auth/me',null],['feedback',{}],['me/save',null],['auth/social/start',{intent:'bind',type:'wx'}]]) {
      const response=await call(path,{cookie:`glol_session=${sa}`,...(body?{method:'POST',body}:{})})
      assert.equal(response.status,403)
      assert.equal((await response.json()).error.code,'banned')
    }
    const denied=await call('auth/social/confirm',{method:'POST',cookie:`glol_social_pending=${tl}`,body:{}})
    assert.equal(denied.status,403)
    assert.deepEqual((await denied.json()).error,{code:'banned',message:'账号已被封禁：测试'})
    await sql(`UPDATE users SET banned_at=0,ban_reason='' WHERE id='${a}'`)
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
    assert.equal((await sql(`SELECT signup_method FROM users WHERE id='${me.id}'`))[0].results[0].signup_method,'qq')
    const tr2=await pending2('register','FEDCBA9876543210AAAAAA')
    assert.equal((await call('auth/social/register',{method:'POST',cookie:`glol_social_pending=${tr2}`,body:{email:'x2@example.test',password:'social-password-1'}})).status,409)
    await sql(`DELETE FROM social_identities`);await sql(`DELETE FROM social_pending`);await sql(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email='${reg.email}')`);await sql(`DELETE FROM users WHERE email='${reg.email}'`);await sql(`DELETE FROM mail_events WHERE email='${reg.email}'`);await sql(`DELETE FROM sessions WHERE user_id='${b}'`);await sql(`DELETE FROM users WHERE id='${b}'`)
    console.log('Social configured: start 502 w/o orphan state (login + register intent), cross-site callback→expired, bind confirm 403 (not consumed)/200/404 replay, re-bind start 409 already_bound, /api/me social list, social-only auto-create (placeholder email), admin merge on Postgres (moved/conflicts/adopted email/saves/ledger key-skip/audit) + reset password (audit w/o sessions, login works) + change email (409/200/audit), login confirm sets 2 cookies + working session; register 2-phase (409 email_taken/conflict, password mismatch 400, 2 cookies, verified+bound, code deleted)')
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
    {type:'wx',label:'微信（旧版）',nickname:'漓江',avatar:'https://thirdwx.qlogo.cn/a/0',uid:'…F60718'},
    {type:'qq',label:'QQ（旧版）',nickname:'象山',avatar:'',uid:'…AAAAAA'}])
  await api('admin/users/no-such-user-x',null,404,'not_found')
  await sql(`DELETE FROM social_identities`);await sql(`UPDATE users SET role='user' WHERE id='${id}'`)
  await api('auth/logout',{});await api(`admin/users/${id}`,null,401,'unauthorized')
  await configuredTest({sql,env})
  const directFixture=await (await import('./selfhost-test.mjs')).fixture({postgresOnly:true,beforeSocialDirect:true})
  try {await (await import('./social-direct-test.mjs')).testDirect(directFixture.env.DATABASE_URL)}
  finally {await directFixture.close()}
  console.log('Social: unconfigured 503/302 disabled, cross-site callback not rejected, admin detail 403→200 with masked uid + avatar allowlist, 404, 401')
}
