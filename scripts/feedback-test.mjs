import assert from 'node:assert/strict'
import { view, uploadShot } from './feedback-view-fixture.mjs'
import { mkdir, readFile } from 'node:fs/promises'
import { createHash, createHmac } from 'node:crypto'

const bridge = { Authorization: 'Bearer local-test' },
  draft = { view, kind: '其他', title: '象鼻山入口', body: '请核对入口的朝向', lat: 25.28, lon: 110.3 }

export async function apiTest({ api, origin, cookie, sql, getCookie }) {
  const other = '1'.repeat(64),
    digest = createHash('sha256').update(other).digest('hex')
  await sql(
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
  for (const invalid of [
    undefined,
    { ...view, other: true },
    { ...view, x: 4000 },
    { ...view, pitch: 100 },
    { ...view, target: { ...view, distance: 2 } },
  ])
    await api('feedback', { ...draft, view: invalid }, 400)
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
  await sql(
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
  await api(path + '/submit', {}, 409)
  await uploadShot(origin, cookie, id)
  assert.equal((await fetch(`${origin}/api/${path}/view-shot`, { headers: second })).status, 404)
  assert.deepEqual((await api(path)).view, view)
  await sql(
    `INSERT INTO feedback_upload_usage SELECT user_id,unixepoch(),314572800-${picture.length}-(SELECT sum(bytes) FROM feedback_upload_usage) FROM feedback WHERE id='${id}'`,
  )
  await photo(id, 4, 200)
  await photo(id, 4, 200, {}, 'DELETE')
  await photo(id, 3, 429)
  await uploadShot(origin, cookie, id, 429)
  await sql('UPDATE feedback_upload_usage SET uploaded_at=unixepoch()-86400')
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
  await move(id, 'approved', 409)
  await move(id, 'queued', 409)
  await api('admin/' + path + '/status', { status: 'approved' }, 403)
  await api(path + '/messages', { body: '不应越权' }, 404, null, { headers: second })
  await api(path + '/messages', { body: 'x'.repeat(1001) }, 400)
  const adminHeaders = { headers: second }
  await sql("UPDATE users SET role='admin' WHERE id='other'")
  const approve = () => api('admin/' + path + '/status', { status: 'approved' }, 200, null, adminHeaders)
  await api('admin/' + path + '/messages', { body: '管理员回复' }, 200, null, adminHeaders)
  for (let index = 0; index < 19; index++) await api(path + '/messages', { body: '用户回复' })
  await api(path + '/messages', { body: '超过每小时额度' }, 429)
  await sql('UPDATE feedback_messages SET created_at=created_at-3601')
  await approve()
  assert.equal((await api('me', { notify_email: false }, 200, null, { method: 'PATCH' })).notify_email, false)
  await api('me', { notify_email: true }, 200, null, { method: 'PATCH' })
  const who = (await api('me')).id,
    sig = createHmac('sha256', 'local-test').update('feedback-unsubscribe:' + who).digest('hex')
  assert.equal((await fetch(`${origin}/api/unsubscribe?user=${who}&sig=bogus`)).status, 400)
  assert.equal((await fetch(`${origin}/api/unsubscribe?user=${who}&sig=${sig}`)).status, 200)
  assert.equal((await api('me')).notify_email, false)
  await move(id, 'queued')
  await move(id, 'reviewing')
  await move(id, 'resolved', 409)
  await move(id, 'reviewing')
  await move(id, 'queued', 409)
  await move(id, 'modelling')
  await move(id, 'need_info')
  await photo(id, 4, 200)
  await api(path + '/supplement', { body: '补充入口侧视图' })
  await approve()
  await sql("UPDATE users SET role='user' WHERE id='other'")
  await move(id, 'queued')
  await move(id, 'live')
  await move(id, 'live', 409)
  await move(id, 'modelling', 409)
  detail = await api(path)
  assert.deepEqual(
    detail.events.map((event) => event.status),
    ['submitted', 'approved', 'queued', 'reviewing', 'modelling', 'need_info', 'submitted', 'approved', 'queued', 'live'],
  )
  assert.equal(detail.photos.length, 4)
  await (await import('./admin-test.mjs')).apiTest({ api, sql, id, second, photo, origin, cookie })
  cookie = getCookie()
  for (let count = 1; count <= 5; count++) {
    // IDOK-219 / IDOK-497: 游戏 bug supports submitting without screenshot/photo when user removes it.
    const next = count === 1 ? (await api('feedback', { ...draft, kind: '游戏 bug' })).id : await create()
    if (count > 1) {
      await uploadShot(origin, cookie, next)
      await photo(next, 1, 200)
    } else {
      const blankBug = (await api('feedback', { ...draft, kind: '游戏 bug', body: '   ' })).id
      await api(`feedback/${blankBug}/submit`, {}, 409)
      await api(`feedback/${blankBug}`, null, 200, null, { method: 'DELETE' })
      const plain = await create()
      await uploadShot(origin, cookie, plain)
      await api(`feedback/${plain}/submit`, {}, 409)
      await api(`feedback/${plain}`, null, 200, null, { method: 'DELETE' })
    }
    await api(`feedback/${next}/submit`, {}, count === 5 ? 429 : 200)
  }
  console.log('Feedback: private photos, quota, transitions, idempotency and supplement passed')
  const appeal = (await api('feedback', { ...draft, kind: '封禁申诉' })).id
  await sql(`UPDATE feedback SET status='reviewing' WHERE id='${appeal}'`)
  await api(`bridge/feedback/${appeal}/status`, { status: 'resolved' }, 400, null, { headers: bridge })
  await move(appeal, 'resolved')
  assert.equal((await api(`feedback/${appeal}`)).events.at(-1).message, 'resolved')
  await api(`feedback/${appeal}/messages`, { body: '再回复' }, 409)
  await api(`feedback/${appeal}/supplement`, { body: '再补充' }, 409)
  await photo(appeal, 1, 409)
  assert.ok(!(await api('bridge/pending', null, 200, null, { headers: bridge })).some(row => row.id === appeal))
}

async function assertOnePageFit(fb, label) {
  const layout = await fb.evaluate((dialog) => {
    const body = dialog.querySelector('.fb-body')
    const box = dialog.getBoundingClientRect()
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      boxLeft: box.left,
      boxTop: box.top,
      boxRight: box.right,
      boxBottom: box.bottom,
      boxWidth: box.width,
      boxHeight: box.height,
      bodyScrollH: body?.scrollHeight ?? 0,
      bodyClientH: body?.clientHeight ?? 0,
      bodyScrollW: body?.scrollWidth ?? 0,
      bodyClientW: body?.clientWidth ?? 0,
    }
  })
  assert.ok(
    layout.boxTop >= 0 && layout.boxLeft >= 0 && layout.boxRight <= layout.vw + 1 && layout.boxBottom <= layout.vh + 1,
    `${label} dialog outside viewport: ${JSON.stringify(layout)}`,
  )
  assert.ok(
    layout.bodyScrollH <= layout.bodyClientH + 2,
    `${label} vertical overflow in fb-body: ${JSON.stringify(layout)}`,
  )
  assert.ok(
    layout.bodyScrollW <= layout.bodyClientW + 2,
    `${label} horizontal overflow in fb-body: ${JSON.stringify(layout)}`,
  )
  return layout
}

export async function uiTest(page, origin, sql) {
  page.on('response', (response) => {
    if (response.url().includes('/api/feedback') && response.status() >= 400)
      console.error('Feedback request failed:', response.request().method(), response.status(), response.url())
  })
  await mkdir('captures/feedback', { recursive: true })
  const shot = async (name) => {
    await page.evaluate(() => window.viewer.freeze?.())
    await page.screenshot({ path: `captures/feedback/${name}.png`, timeout: 120000 })
  }
  const fb = page.locator('.fb-panel')
  const click = (name) => fb.getByRole('button', { name, exact: true }).click()

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => {
    const viewer = window.viewer
    viewer.camera.position.set(-1530, 168, -82)
    viewer.camera.lookAt(-1530, 161, -116)
    viewer.resume()
  })
  await page.waitForFunction(
    () => [...window.viewer.stream.landmarks.keys()].some((entry) => entry.id === 'yiwu_old_house'),
    null,
    { timeout: 120000 },
  )

  await page.locator('.dock-more').click() // 反馈收在「工具」里（IDOK-468）
  await page.locator('.dock-feedback').click()
  await fb.locator('.fb-view-shot').waitFor({ timeout: 60000 })
  await page.waitForTimeout(300)
  await fb.locator('.fb-loc').getByText(/翊武路/).waitFor().catch(async (error) => {
    throw Error(`${error.message}\nfb-loc=${await fb.locator('.fb-loc').innerText()}\nfb-panel=${await fb.innerText()}`)
  })
  await fb.locator('.fb-view-shot').evaluate((image) => image.decode())
  const desktopLayout = await assertOnePageFit(fb, 'desktop-1440x900')
  console.log('Desktop one-page layout:', desktopLayout)
  await shot('desktop')
  await page.screenshot({ path: '/tmp/idok497-desktop.png', timeout: 120000 })

  await click('重拍')
  await shot('aim-bar')
  await page.evaluate(() => {
    const camera = window.viewer.camera
    camera.position.x += 4
    camera.lookAt(-1530, 161, -116)
  })
  await page.getByRole('button', { name: '截取', exact: true }).click()
  await fb.locator('.fb-view-shot').evaluate((image) => image.decode())

  // IDOK-497: 默认自带截图与当前位置，不手动上传照片即可直接一键提交非 bug 类反馈
  await fb.getByLabel('标题').fill(draft.title)
  await fb.getByLabel('描述（可选）').fill(draft.body)
  await click('提交反馈')
  await fb
    .locator('.fb-pill.fb-status--submitted')
    .waitFor({ timeout: 120000 })
    .catch(async (error) => {
      throw Error(`${error.message}: ${await fb.innerText()}`)
    })
  const [createdItem] = await (await page.request.get(origin + '/api/feedback?mine=1')).json()
  const createdDetail = await (await page.request.get(`${origin}/api/feedback/${createdItem.id}`)).json()
  assert.equal(createdDetail.has_view_shot, true)
  assert.equal(createdDetail.photos.length, 1)

  await click('我的反馈')
  await shot('list')
  await fb.locator('.fb-card').first().click()
  const reply = await page.request.post(`${origin}/api/bridge/feedback/${createdItem.id}/messages`, {
    headers: bridge,
    data: { source: 'mock-1', body: '模型入口朝哪个方向？' },
  })
  assert.equal(reply.status(), 200)
  await click('刷新进度')
  await page.locator('.fb-panel.fb-busy').waitFor({ state: 'detached' })
  await fb.getByText(/模型入口朝哪个方向/).waitFor()
  await fb.getByLabel('回复内容').fill('朝东')
  await click('发送回复')
  await fb.locator('.fb-msg--user .fb-msg-body', { hasText: '朝东' }).waitFor()

  await sql("UPDATE users SET role='admin' WHERE email='walker@example.test'")
  const adminPage = await page.context().newPage()
  const adminMessage = '已确认入口朝东，准备发起制作。'
  try {
    await adminPage.goto(origin + '/admin/?id=' + createdItem.id)
    const timeline = adminPage.locator('.adm-timeline')
    const approve = adminPage.getByRole('button', { name: '发起 AI 制作' })
    const capture = async (name) => {
      await adminPage.getByRole('heading', { name: '进度与对话', exact: true }).evaluate((node) => node.scrollIntoView({ block: 'start' }))
      await adminPage.screenshot({ path: `captures/feedback/${name}.png` })
    }
    await timeline.locator('.adm-msg--user', { hasText: '朝东' }).waitFor()
    await adminPage.getByLabel('管理员回复内容').fill(adminMessage)
    await adminPage.getByRole('button', { name: '发送回复', exact: true }).click()
    await timeline.getByText(adminMessage, { exact: false }).waitFor()
    await capture('admin-before-approval')
    await approve.click()
    await adminPage.locator('dialog.adm-dialog').getByRole('button', { name: '确认发起', exact: true }).click()
    await timeline.locator('.adm-status--approved').waitFor()
    assert.equal(await approve.count(), 0)
    await capture('admin-after-approval')
  } finally {
    await adminPage.close()
  }

  await click('刷新进度')
  await page.locator('.fb-panel.fb-busy').waitFor({ state: 'detached' })
  await fb.locator('.fb-pill.fb-status--approved').waitFor()
  const chat = fb.locator('.fb-chat')
  for (const role of ['agent', 'user', 'admin']) await chat.locator('.fb-msg--' + role).waitFor()
  await chat.screenshot({ path: 'captures/feedback/user-conversation.png' })
  for (const status of ['queued', 'modelling', 'reviewing', 'live']) {
    const response = await page.request.post(`${origin}/api/bridge/feedback/${createdItem.id}/status`, {
      headers: bridge,
      data: { status },
    })
    assert.equal(response.status(), 200)
  }
  await click('刷新进度')
  await page.locator('.fb-panel.fb-busy').waitFor({ state: 'detached' })
  await fb.locator('.fb-pill.fb-status--live').waitFor()
  assert.equal(await fb.locator('.fb-timeline li').count(), 9)
  await shot('timeline')
  await fb.locator('.fb-view-shot').evaluate((image) => image.decode())
  await fb.locator('.fb-view-shot').scrollIntoViewIfNeeded()
  await shot('view-detail')
  const stored = (await (await page.request.get(`${origin}/api/feedback/${createdItem.id}`)).json()).view
  await page.evaluate(() => window.viewer.camera.position.set(0, 500, 0))
  await click('飞过去看看')
  await fb.waitFor({ state: 'detached' })
  const errors = await page.evaluate((view) => {
    const camera = window.viewer.camera
    return {
      meters: Math.hypot(camera.position.x - view.x, camera.position.y - view.y, camera.position.z - view.z),
      yaw: Math.abs((camera.rotation.y * 180) / Math.PI - view.yaw),
      pitch: Math.abs((camera.rotation.x * 180) / Math.PI - view.pitch),
    }
  }, stored)
  assert.equal(stored.x, -1526)
  assert.ok(Object.values(errors).every((value) => value < 0.5), JSON.stringify(errors))
  console.log('Retaken camera replay errors:', errors)

  // 手机端 430×932 验证：深链接复现 + 打开反馈 + 一屏内适配 + 换图/粘贴 + 移除图提交 bug
  await page.setViewportSize({ width: 430, height: 932 })
  await page.goto(origin + '/?verify&view=' + Buffer.from(JSON.stringify(stored)).toString('base64url'))
  await page.waitForFunction(
    (view) => {
      const viewer = window.viewer
      if (!viewer || viewer.stats.loaded === 0) return false
      const camera = viewer.camera
      return (
        document.body.dataset.mode === 'fly' &&
        Math.hypot(camera.position.x - view.x, camera.position.y - view.y, camera.position.z - view.z) < 0.5 &&
        Math.abs((camera.rotation.y * 180) / Math.PI - view.yaw) < 0.5 &&
        Math.abs((camera.rotation.x * 180) / Math.PI - view.pitch) < 0.5
      )
    },
    stored,
    { timeout: 120000 },
  )
  await page.evaluate(() => window.viewer.freeze())
  const replay = await page.evaluate((view) => {
    const camera = window.viewer.camera
    return {
      meters: Math.hypot(camera.position.x - view.x, camera.position.y - view.y, camera.position.z - view.z),
      yaw: Math.abs((camera.rotation.y * 180) / Math.PI - view.yaw),
      pitch: Math.abs((camera.rotation.x * 180) / Math.PI - view.pitch),
    }
  }, stored)
  assert.ok(Object.values(replay).every((value) => value < 0.5), JSON.stringify(replay))
  console.log('Deep link camera replay errors:', replay)
  await shot('deep-link-replay')

  await page.locator('.dock-more').click()
  await page.locator('.dock-feedback').click()
  await fb.locator('.fb-view-shot').waitFor({ timeout: 60000 })
  await fb.locator('.fb-view-shot').evaluate((image) => image.decode())
  await fb.locator('.fb-loc').getByText(/翊武路/).waitFor()
  const mobileLayout = await assertOnePageFit(fb, 'mobile-430x932')
  console.log('Mobile 430x932 one-page layout:', mobileLayout)
  await shot('mobile')
  await page.screenshot({ path: '/tmp/idok497-mobile-430x932.png', timeout: 120000 })

  // 更换/粘贴图片仍可用且不溢出
  await fb.getByLabel('添加照片').setInputFiles(
    await Promise.all(
      ['正面', '侧面', '远景'].map(async (name) => ({
        name: name + '.jpg',
        mimeType: 'image/jpeg',
        buffer: await readFile('public/og.jpg'),
      })),
    ),
  )
  const pasted = (await readFile('public/og.jpg')).toString('base64')
  await fb.evaluate((panel, data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], 'clipboard.jpg', { type: 'image/jpeg' }))
    panel.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  }, pasted)
  assert.equal(await fb.locator('.fb-photo').count(), 4)
  await fb.getByLabel('拍摄视角').first().selectOption('正面')
  await fb.locator('.fb-grid img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())))
  await assertOnePageFit(fb, 'mobile-430x932-with-photos')
  await shot('photos')
  await page.screenshot({ path: '/tmp/idok497-mobile-photos.png', timeout: 120000 })

  // 移除图片后选择游戏 bug 仍可无图提交
  await click('移除')
  await fb.getByText('游戏 bug', { exact: true }).click()
  await fb.getByText('截图可选，可直接提交').waitFor()
  await fb.getByLabel('标题').fill('骑电动车过解放桥时卡住不动')
  await fb.getByLabel('描述（必填）').fill('在桥中间按方向键没反应，刷新后恢复。电脑 Chrome。')
  await assertOnePageFit(fb, 'mobile-430x932-bug-no-photo')
  await shot('bug-no-photo')
  await click('提交反馈')
  await fb.locator('.fb-pill.fb-status--submitted').waitFor({ timeout: 120000 })
  assert.match(await fb.locator('.fb-facts').innerText(), /游戏 bug/)
  await shot('bug-submitted')
  await click('关闭')
}
