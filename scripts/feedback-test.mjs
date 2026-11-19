import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const bridge = { Authorization: 'Bearer local-test' },
  draft = { kind: '其他', title: '象鼻山入口', body: '请核对入口的朝向', lat: 25.28, lon: 110.3 }
export async function apiTest({ api, origin, cookie, sql }) {
  const other = '1'.repeat(64),
    digest = createHash('sha256').update(other).digest('hex')
  sql(
    `INSERT INTO users(id,email,nickname,salt,digest,verified) VALUES('other','other@example.test','other','','',1); INSERT INTO sessions VALUES('${digest}','other',unixepoch()+3600)`,
  )
  const second = { Cookie: `glol_session=${other}` },
    picture = await readFile('public/og.jpg')
  const photo = async (id, slot, status, headers = {}, method = 'PUT') => {
    const res = await fetch(`${origin}/api/feedback/${id}/photos/${slot}`, {
      method,
      headers: {
        Origin: origin,
        Cookie: cookie,
        'Content-Type': 'image/jpeg',
        'X-Photo-Meta': encodeURIComponent(JSON.stringify({ exif_dir: 45, view_label: '左侧' })),
        ...headers,
      },
      body: method === 'PUT' ? picture : undefined,
    })
    assert.equal(res.status, status, `photo ${method} ${res.status}`)
    return res
  }
  const create = async () => (await api('feedback', draft)).id
  const move = (id, status, expected = 200) =>
    api(`bridge/feedback/${id}/status`, { status, message: status, multica_issue: 'demo' }, expected, null, {
      headers: bridge,
    })
  await api('feedback', { ...draft, lat: 0 }, 400)
  await api('bridge/pending', null, 401, null, { headers: { Authorization: 'Bearer bad' } })
  const id = await create(),
    path = 'feedback/' + id
  await api(path + '/submit', {}, 409)
  const discard = await create(),
    extra = await create()
  await api('feedback', draft, 429, 'draft_limit')
  await photo(discard, 1, 200)
  for (const unused of [discard, extra])
    await api('feedback/' + unused, null, 200, null, { method: 'DELETE' })
  sql(
    `INSERT INTO feedback_photos(feedback_id,n,r2_key,bytes,mime) VALUES('${id}',1,'fb/interrupted.png',4096,'image/png')`,
  )
  for (const n of [1, 2, 3]) await photo(id, n, 200)
  await photo(id, 4, 200)
  await photo(id, 4, 404, second, 'DELETE')
  await photo(id, 4, 200, {}, 'DELETE')
  assert.deepEqual(
    (await api(path)).photos.map((photo) => photo.n),
    [1, 2, 3],
  )
  await photo(id, 4, 404, {}, 'GET')
  sql(
    `INSERT INTO feedback_upload_usage SELECT user_id,unixepoch(),314572800-${picture.length}-(SELECT sum(bytes) FROM feedback_upload_usage) FROM feedback WHERE id='${id}'`,
  )
  await photo(id, 4, 200)
  await photo(id, 4, 200, {}, 'DELETE')
  await photo(id, 3, 429)
  sql('UPDATE feedback_upload_usage SET uploaded_at=unixepoch()-86400')
  await photo(id, 3, 200)
  await photo(id, 1, 404, second, 'GET')
  await photo(id, 4, 404, second)
  await api(path, null, 404, null, { headers: second })
  await api(path + '/submit', {}, 404, null, { headers: second })
  await api(path + '/submit', {})
  await photo(id, 1, 409, {}, 'DELETE')
  assert.equal((await api('feedback?mine=1'))[0].id, id)
  let detail = await api(path)
  assert.equal(detail.photos.length, 3)
  assert.equal(detail.photos[0].exif_dir, 45)
  assert.equal((await api('bridge/pending', null, 200, null, { headers: bridge }))[0].id, id)
  assert.deepEqual(Buffer.from(await (await photo(id, 1, 200, bridge, 'GET')).arrayBuffer()), picture)
  await move(id, 'live', 409)
  await move(id, 'queued')
  await move(id, 'reviewing')
  await move(id, 'reviewing')
  await move(id, 'queued', 409)
  await move(id, 'modelling')
  await move(id, 'need_info')
  await photo(id, 4, 200)
  await api(path + '/supplement', { body: '补充入口侧视图' })
  await move(id, 'queued')
  await move(id, 'live')
  await move(id, 'live', 409)
  await move(id, 'modelling', 409)
  detail = await api(path)
  assert.deepEqual(
    detail.events.map((event) => event.status),
    ['submitted', 'queued', 'reviewing', 'modelling', 'need_info', 'submitted', 'queued', 'live'],
  )
  assert.equal(detail.photos.length, 4)
  await (await import('./admin-test.mjs')).apiTest({api,sql,id,second,photo})
  for (let count = 1; count <= 5; count++) {
    const next = await create()
    await photo(next, 1, 200)
    await api(`feedback/${next}/submit`, {}, count === 5 ? 429 : 200)
  }
  console.log('Feedback: private photos, quota, transitions, idempotency and supplement passed')
}
export async function uiTest(page, origin) {
  await mkdir('captures/feedback', { recursive: true })
  const shot = (name) => page.screenshot({ path: `captures/feedback/${name}.png` })
  const fb = page.locator('.fb-panel')
  const click = (name) => fb.getByRole('button', { name, exact: true }).click()
  await page.evaluate(() => window.viewer.camera.position.set(-685, 420, 1182))
  await page.locator('.dock-feedback').click()
  await fb.getByLabel('标题').fill(draft.title)
  await fb.getByLabel('描述').fill(draft.body)
  await shot('desktop')
  await fb.getByLabel('添加照片').setInputFiles(
    await Promise.all(
      ['正面', '侧面', '远景'].map(async (name) => ({
        name: name + '.jpg',
        mimeType: 'image/jpeg',
        buffer: await readFile('public/og.jpg'),
      })),
    ),
  )
  await fb.getByLabel('拍摄视角').first().selectOption('正面')
  await fb.locator('.fb-grid').scrollIntoViewIfNeeded()
  await fb.locator('.fb-grid img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())))
  await shot('photos')
  await click('提交反馈')
  await fb
    .locator('.fb-status--submitted')
    .waitFor({ timeout: 120000 })
    .catch(async (error) => {
      throw Error(`${error.message}: ${await fb.innerText()}`)
    })
  await click('我的反馈')
  await click(draft.title + ' · 已提交')
  const [item] = await (await page.request.get(origin + '/api/feedback?mine=1')).json()
  for (const status of ['queued', 'modelling', 'reviewing', 'live']) {
    const response = await page.request.post(`${origin}/api/bridge/feedback/${item.id}/status`, {
      headers: bridge,
      data: { status },
    })
    assert.equal(response.status(), 200)
  }
  await click('刷新进度')
  await fb.locator('.fb-status--live').waitFor()
  assert.equal(await fb.locator('.fb-timeline li').count(), 5)
  await shot('timeline')
  await page.evaluate(() => window.viewer.camera.position.set(0, 500, 0))
  await click('飞过去看看')
  await fb.waitFor({ state: 'detached' })
  assert.ok(
    await page.evaluate(
      () => Math.hypot(window.viewer.camera.position.x + 685, window.viewer.camera.position.z - 1182) < 0.5,
    ),
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.dock-feedback').click()
  await fb.getByLabel('标题').waitFor()
  await shot('mobile')
  await click('关闭')
}
