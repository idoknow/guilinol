import assert from 'node:assert/strict'

// 聚合登录（未配置 SOCIAL_*）+ 后台用户详情绑定展示，跑在 hk01 同款 Postgres 上
export async function socialTest({api,origin,sql}) {
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
  console.log('Social: unconfigured 503/302 disabled, cross-site callback not rejected, admin detail 403→200 with masked uid + avatar allowlist, 404, 401')
}
