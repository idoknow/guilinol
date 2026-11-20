import assert from 'node:assert/strict'
import {view,uploadShot} from './feedback-view-fixture.mjs'
import { mkdir, readFile } from 'node:fs/promises'

export async function apiTest({ api, sql, id, second, photo,origin,cookie }) {
  const admin = (path, data = null, status = 200, headers = {}) =>
    api('admin/' + path, data, status, null, { headers: { ...second, ...headers } })
  const detail = 'feedback/' + id,
    transition = { status: 'rejected', message: '不在范围内' }
  for (const [path, data] of [
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
  await sql(
    `UPDATE feedback SET submitted_at=unixepoch()-86401 WHERE id='${manual}'; WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n<51) INSERT INTO users(id,email,nickname,salt,digest) SELECT 'seed'||n,'seed'||n||'@example.test','分页','','' FROM numbers;`,
  )
  const first = await admin('users?q=seed'),
    last = await admin('users?q=seed&cursor=' + first.next_cursor)
  assert.equal(first.items.length, 50)
  assert.equal(last.items.length, 1)
  assert.equal(last.next_cursor, null)
  assert.equal(new Set([...first.items, ...last.items].map((row) => row.id)).size, 51)
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
}
