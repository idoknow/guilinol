import assert from 'node:assert/strict'
import {view,uploadShot} from './feedback-view-fixture.mjs'
import { mkdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const bridge = { Authorization: 'Bearer local-test' },
  draft = { view,kind: '其他', title: '象鼻山入口', body: '请核对入口的朝向', lat: 25.28, lon: 110.3 }
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
  for(const invalid of [undefined,{...view,other:true},{...view,x:4000},{...view,pitch:100},{...view,target:{...view,distance:2}}])await api('feedback',{...draft,view:invalid},400)
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
  await api(path+'/submit',{},409)
  await uploadShot(origin,cookie,id)
  assert.equal((await fetch(`${origin}/api/${path}/view-shot`,{headers:second})).status,404)
  assert.deepEqual((await api(path)).view,view)
  sql(
    `INSERT INTO feedback_upload_usage SELECT user_id,unixepoch(),314572800-${picture.length}-(SELECT sum(bytes) FROM feedback_upload_usage) FROM feedback WHERE id='${id}'`,
  )
  await photo(id, 4, 200)
  await photo(id, 4, 200, {}, 'DELETE')
  await photo(id, 3, 429)
  await uploadShot(origin,cookie,id,429)
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
  await (await import('./admin-test.mjs')).apiTest({api,sql,id,second,photo,origin,cookie})
  for (let count = 1; count <= 5; count++) {
    const next = await create()
    await uploadShot(origin,cookie,next)
    await photo(next, 1, 200)
    await api(`feedback/${next}/submit`, {}, count === 5 ? 429 : 200)
  }
  console.log('Feedback: private photos, quota, transitions, idempotency and supplement passed')
}
export async function uiTest(page, origin) {
  await mkdir('captures/feedback', { recursive: true })
  const shot = async (name) => {
    // Pause the WebGL loop so screenshots don't time out on a loaded software-GL host.
    await page.evaluate(() => window.viewer.freeze?.())
    await page.screenshot({ path: `captures/feedback/${name}.png`, timeout: 120000 })
  }
  const fb = page.locator('.fb-panel')
  const click = (name) => fb.getByRole('button', { name, exact: true }).click()
  await page.evaluate(()=>{const viewer=window.viewer;viewer.camera.position.set(-1530,168,-82);viewer.camera.lookAt(-1530,161,-116);viewer.resume()})
  await page.waitForFunction(()=>[...window.viewer.stream.landmarks.keys()].some(entry=>entry.id==='yiwu_old_house'),null,{timeout:120000})
  await page.locator('.dock-feedback').click()
  await fb.locator('.fb-map canvas').waitFor({ timeout: 60000 })
  await page.waitForTimeout(400)
  await fb.locator('.fb-view').getByText(/翊武路青砖老楼/).waitFor()
  await fb.locator('.fb-view-shot').evaluate(image=>image.decode())
  await shot('view-step')
  await click('重新取景');await shot('aim-bar');await page.evaluate(()=>{const camera=window.viewer.camera;camera.position.x+=4;camera.lookAt(-1530,161,-116)})
  await page.getByRole('button',{name:'截取',exact:true}).click()
  const routeMode=fb.getByRole('radio',{name:'沿路拍摄'})
  await routeMode.evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));await routeMode.click()
  await fb.getByLabel('行走路径和方向').fill('从十字街沿解放东路向东走到解放桥西桥头')
  // The pin starts at the walker; zoom in once and check the painter drew map pixels (not a blank canvas).
  await fb.getByRole('button', { name: '放大' }).click()
  assert.ok(
    await fb.locator('.fb-map canvas').evaluate((c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      const seen = new Set()
      for (let i = 0; i < d.length; i += 4 * 97) seen.add(d[i] >> 4 << 8 | d[i + 1] >> 4 << 4 | d[i + 2] >> 4)
      return seen.size > 6
    }),
  )
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
  // Paste a screenshot from the clipboard into the panel.
  const pasted = (await readFile('public/og.jpg')).toString('base64')
  await fb.evaluate((panel, data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], 'clipboard.jpg', { type: 'image/jpeg' }))
    panel.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  }, pasted)
  assert.equal(await fb.locator('.fb-photo').count(), 4)
  await fb.getByLabel('拍摄视角').first().selectOption('正面')
  await fb.locator('.fb-grid').scrollIntoViewIfNeeded()
  await fb.locator('.fb-grid img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())))
  await shot('photos')
  await click('提交反馈')
  await fb
    .locator('.fb-pill.fb-status--submitted')
    .waitFor({ timeout: 120000 })
    .catch(async (error) => {
      throw Error(`${error.message}: ${await fb.innerText()}`)
    })
  assert.match(await fb.locator('.fb-facts').innerText(), /解放东路向东/)
  await click('我的反馈')
  await shot('list')
  await fb.locator('.fb-card').first().click()
  const [item] = await (await page.request.get(origin + '/api/feedback?mine=1')).json()
  for (const status of ['queued', 'modelling', 'reviewing', 'live']) {
    const response = await page.request.post(`${origin}/api/bridge/feedback/${item.id}/status`, {
      headers: bridge,
      data: { status },
    })
    assert.equal(response.status(), 200)
  }
  await click('刷新进度')
  await fb.locator('.fb-pill.fb-status--live').waitFor()
  assert.equal(await fb.locator('.fb-timeline li').count(), 5)
  await shot('timeline')
  await fb.locator('.fb-view-shot').evaluate(image=>image.decode());await fb.locator('.fb-view-shot').scrollIntoViewIfNeeded();await shot('view-detail')
  const stored=(await (await page.request.get(`${origin}/api/feedback/${item.id}`)).json()).view
  await page.evaluate(() => window.viewer.camera.position.set(0, 500, 0))
  await click('飞过去看看')
  await fb.waitFor({ state: 'detached' })
  assert.ok(
    await page.evaluate(
      view => {const camera=window.viewer.camera;return Math.hypot(camera.position.x-view.x,camera.position.y-view.y,camera.position.z-view.z)<.5 && Math.abs(camera.rotation.y*180/Math.PI-view.yaw)<.5 && Math.abs(camera.rotation.x*180/Math.PI-view.pitch)<.5 && view.landmark_id==='yiwu_old_house'},stored,
    ),
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(origin+'/?verify&view='+Buffer.from(JSON.stringify(stored)).toString('base64url'))
  await page.waitForFunction(view=>{const viewer=window.viewer;if(!viewer||viewer.stats.loaded===0)return false;const camera=viewer.camera;return document.body.dataset.mode==='fly'&&Math.hypot(camera.position.x-view.x,camera.position.y-view.y,camera.position.z-view.z)<.5&&Math.abs(camera.rotation.y*180/Math.PI-view.yaw)<.5&&Math.abs(camera.rotation.x*180/Math.PI-view.pitch)<.5},stored,{timeout:120000})
  await page.evaluate(()=>window.viewer.freeze())
  await page.locator('.dock-feedback').click()
  await fb.getByLabel('标题').waitFor()
  await fb.locator('.fb-map canvas').waitFor()
  await page.waitForTimeout(400)
  await shot('mobile')
  await click('关闭')
}
