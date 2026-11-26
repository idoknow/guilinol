import assert from 'node:assert/strict'
import {view,uploadShot} from './feedback-view-fixture.mjs'
import { mkdir, readFile } from 'node:fs/promises'

export async function apiTest({ api, sql, id, second, photo,origin,cookie }) {
  const admin = (path, data = null, status = 200, headers = {}) =>
    api('admin/' + path, data, status, null, { headers: { ...second, ...headers } })
  const detail = 'feedback/' + id,
    transition = { status: 'rejected', message: '不在范围内' }
  for (const [path, data] of [
    ...['overview','timeseries','breakdown','funnel','errors','live','audit'].map(path=>[path,null]),
    ['users/other/role',{role:'admin'}],
    ['stats', null],
    ['users', null],
    ['feedback', null],
    [detail, null],
    [detail + '/status', transition],
  ]) {
    await admin(path, data, 401, { Cookie: '' })
    await admin(path, data, 403)
  }
  await sql(`UPDATE users SET role='admin' WHERE id='other';`)
  assert.equal((await admin('stats')).verified, 2)
  const users = await admin('users?q=WALKER')
  assert.equal(users.items.length, 1)
  assert.equal(users.items[0].feedback_count, 1)
  const walker=users.items[0], userPath='users/'+walker.id
  assert.deepEqual([walker.signup_method,walker.email_placeholder,walker.social,walker.banned_at,walker.ban_reason],['email',false,[],0,''])
  await sql(`INSERT INTO social_identities(type,social_uid,user_id,nickname,faceimg,created_at,last_login_at)
    VALUES('wx','admin-test-wx','${walker.id}','测试昵称','',123,456)`)
  const filtered=await admin('users?signup=email&bound=wx&status=active')
  assert.deepEqual(filtered.items.map(row=>row.id),[walker.id])
  assert.deepEqual(filtered.items[0].social,[{type:'wx',nickname:'测试昵称',created_at:123,last_login_at:456}])
  for (const filter of ['signup=qq','bound=qq','status=banned']) assert.equal((await admin('users?'+filter)).items.length,0)
  for (const key of ['signup','bound','status']) await admin('users?'+key+'=invalid',null,400)
  const reason='重复骚扰'
  assert.equal((await admin('users/other/ban',{reason},409)).error.code,'self_ban')
  const rolePath='users/'+users.items[0].id+'/role'
  assert.equal((await admin('users/other/role',{role:'user'},409)).error.code,'last_admin')
  await admin(rolePath,{role:'admin'})
  assert.equal((await admin('users/other/role',{role:'user'},409)).error.code,'self_demotion')
  assert.equal((await admin(userPath+'/ban',{reason},409)).error.code,'ban_admin')
  await admin(rolePath,{role:'user'})
  assert.equal((await admin('users?role=admin')).items.length,1)
  assert.equal((await admin('audit?target_type=user&target_id='+users.items[0].id)).items.length,2)
  for(const path of ['overview','timeseries','breakdown','funnel','errors','live']) await admin(path)
  const result = await admin(
    'feedback?status=live&q=' + encodeURIComponent('入口') + '&user=' + users.items[0].id,
  )
  assert.equal(result.items[0].photo_count, 4)
  assert.equal(result.items[0].id, id)
  assert.equal((await admin(detail)).photos[0].exif_dir, 45)
  await photo(id, 1, 200, second, 'GET')
  await photo(id, 1, 404, second, 'DELETE')
  const manual = (
    await api('feedback', { view,kind: '其他', title: '状态测试', body: '请核对', lat: 25.28, lon: 110.3 })
  ).id
  await photo(manual, 1, 200)
  await uploadShot(origin,cookie,manual)
  await api(`feedback/${manual}/submit`, {})
  const change = `feedback/${manual}/status`
  assert.deepEqual((await admin('feedback/'+manual)).allowed_transitions.map(t=>t.status),['approved','need_info','rejected','duplicate'])
  await admin(change,{status:'live'},409)
  await admin('feedback/'+manual+'/messages',{body:'收到'})
  await admin(change, {status:'rejected'}, 400)
  await admin(change, { status: 'queued' }, 403, { Origin: 'https://example.test' })
  await admin(change, { status: 'approved' });await api('bridge/'+change,{status:'queued'},200,null,{headers:{Authorization:'Bearer local-test'}})
  await admin(change, transition)
  const events = (await admin('feedback/' + manual)).events
  assert.deepEqual(
    events.map((row) => row.status),
    ['submitted','approved', 'queued', 'rejected'],
  )
  assert.equal(events.at(-1).message, transition.message)
  assert.deepEqual((await admin('audit?target_type=feedback&target_id='+manual)).items.map(row=>row.action),['status','start_ai','reply'])
  await sql(
    `UPDATE feedback SET submitted_at=unixepoch()-86401 WHERE id='${manual}'; WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n<51) INSERT INTO users(id,email,nickname,salt,digest) SELECT 'seed'||n,'seed'||n||'@example.test','分页','','' FROM numbers;`,
  )
  assert.equal((await admin('users/seed1/role',{role:'admin'},409)).error.code,'unverified')
  const first = await admin('users?q=seed'),
    last = await admin('users?q=seed&cursor=' + first.next_cursor)
  assert.equal(first.items.length, 50)
  assert.equal(last.items.length, 1)
  assert.equal(last.next_cursor, null)
  assert.equal(new Set([...first.items, ...last.items].map((row) => row.id)).size, 51)
  for (const reason of ['', '长'.repeat(201)]) await admin(userPath+'/ban',{reason},400)
  const ban=await admin(userPath+'/ban',{reason})
  assert.ok(ban.banned_at>0)
  assert.deepEqual(await admin(userPath+'/ban',{reason:'另一原因'}),ban)
  assert.equal((await admin('users?status=banned')).items[0].id,walker.id)
  const detailUser=(await admin(userPath)).user
  assert.deepEqual([detailUser.signup_method,detailUser.banned_at,detailUser.ban_reason,detailUser.banned_by],['email',ban.banned_at,reason,'other'])
  for (const path of ['me','auth/me','me/save','feedback']) await api(path,null,401,'unauthorized')
  const login={email:walker.email,password:'local-test-password'}
  const denied=await api('auth/login',login,403,'banned')
  assert.equal(denied.error.message,'账号已被封禁：'+reason)
  for (let i=0;i<2;i++) assert.deepEqual(await admin(userPath+'/unban',{}),{id:walker.id,banned_at:0,ban_reason:''})
  assert.deepEqual((await admin('audit?target_type=user&target_id='+walker.id)).items.map(row=>row.action),['unban','ban','role','role'])
  await api('auth/login',login)
  console.log('Admin signup/bound/status filters, ban/unban, session revocation, protected admins and audit passed')
  await sql("UPDATE users SET role='user' WHERE id='other'")
  await admin('stats', null, 403)
  await photo(id, 1, 404, second, 'GET')
}

export async function browserTest({ page, origin, email, password, nickname, code, sql }) {
  const request = page.request,
    headers = { Origin: origin }
  async function post(path, data) {
    const response = await request.post(origin + '/api/' + path, { headers, data })
    assert.equal(response.status(), 200, await response.text())
    return response.json()
  }
  await mkdir('captures/admin', { recursive: true })
  const shot = (name) => page.screenshot({ path: `captures/admin/${name}.png`, fullPage: true })
  await page.goto(origin + '/admin/')
  await page.getByText('请回首页登录').waitFor()
  await post('auth/register', { email, password, nickname })
  await post('auth/verify', { email, password, code: await code('verify') })
  await page.reload()
  await page.getByText('无权限').waitFor()
  const title = '象鼻山入口朝向',
    item = await post('feedback', {
      view,
      title,
      kind: '位置或朝向不对',
      body: '入口朝向滨江路，附入口正面照片。',
      lat: 25.28,
      lon: 110.3,
    })
  const upload = await request.put(`${origin}/api/feedback/${item.id}/photos/1`, {
    headers: {
      ...headers,
      'Content-Type': 'image/jpeg',
      'X-Photo-Meta': encodeURIComponent(JSON.stringify({ view_label: '正面', exif_dir: 45 })),
    },
    data: await readFile('public/og.jpg'),
  })
  assert.equal(upload.status(), 200)
  assert.equal((await request.put(`${origin}/api/feedback/${item.id}/view-shot`,{headers:{...headers,'Content-Type':'image/jpeg'},data:await readFile('public/og.jpg')})).status(),200)
  await post(`feedback/${item.id}/submit`, {})
  await sql(`UPDATE users SET role='admin' WHERE email='${email}'`)
  await page.reload()
  await page.getByRole('cell', { name: email }).waitFor()
  await shot('users')
  await page.getByRole('link', { name: '反馈列表' }).click()
  await page.getByLabel('状态').selectOption('submitted')
  await page.getByRole('button', { name: '搜索' }).click()
  await page.getByRole('link', { name: title }).waitFor()
  await shot('feedback')
  await page.getByRole('link', { name: title }).click()
  await page.getByLabel('说明').fill('已核对位置')
  await page.getByRole('button', { name: '保存状态' }).click()
  await page.getByText(/已核对位置/).waitFor()
  await page.waitForFunction(() => document.querySelector('figure img')?.naturalWidth > 0)
  await shot('detail')
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByAltText('照片 1').click()])
  await popup.waitForLoadState()
  assert.ok(popup.url().endsWith('/photos/1'))
  await popup.close()
  await sql("INSERT INTO web_ip_bans(ip,reason,expires) VALUES('198.51.100.77','honeypot',now()+interval '24 hours') ON CONFLICT(ip) DO UPDATE SET reason='honeypot',expires=excluded.expires")
  await sql("SELECT web_guard_hit('honeypot')")
  await page.goto(origin + '/admin/?view=bans')
  await page.getByRole('heading', { name: '当前防护项' }).waitFor()
  await page.getByRole('heading', { name: '生效中的 IP 封禁' }).waitFor()
  await page.getByText('198.51.100.77').waitFor()
  await page.getByText('蜜罐命中').waitFor()
  await shot('bans-desktop')
  await page.setViewportSize({ width: 390, height: 844 })
  await shot('bans-mobile')
  await page.setViewportSize({ width: 1100, height: 740 })
  await page.locator('tr', { hasText: '198.51.100.77' }).getByRole('button', { name: '解封' }).click()
  await page.locator('dialog.adm-dialog').getByRole('button', { name: '确认解封' }).click()
  await page.getByText('当前没有生效中的 IP 封禁').waitFor()
  await page.goto(origin + '/admin/?view=audit&target_type=ip')
  await page.getByText('IP 人工解封').waitFor()
  await page.getByText('198.51.100.77').waitFor()
  await shot('audit-ip')
}
