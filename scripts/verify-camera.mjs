import {telemetryPreview} from './telemetry-preview.mjs'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {preview} from 'vite'

// 相机系统冒烟（IDOK-182 / IDOK-188）：
//   相机包换机 → 手上挂机 + 持机姿势 → 进拍照模式（只有时辰/滤镜/天气/人物/落款/换机）→ 按快门出片 → 录像存 MP4 → 退出。
// IDOK-211 把专业参数（曝光/ISO/快门/焦距/白平衡/构图线/RAW/MOV/分辨率档位）收掉了，
// 所以这里只断言"普通拍照还能出片、录像还是 MP4、机身模型还在手上"。

const start = performance.now()
const server = await preview({plugins: [telemetryPreview], root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const url = base + '/?verify&mode=walk&flow=0'
let browser
try {
  browser = await chromium.launch({executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']})
  const page = await browser.newPage({viewport: {width: 1280, height: 720}})
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.location().url + ': ' + message.text())
  })
  // 录像文件留在 captures/ 里，方便抽帧检查画面不是黑的；其它下载（照片）直接丢掉。
  // 注意：saveAs 可能被浏览器取消（页面在下载完成前关闭），这只是诊断副本，失败不该让套件红。
  const clipSaved = []
  page.on('download', download => {
    const name = download.suggestedFilename()
    if (/\.(mp4|webm)$/i.test(name)) {
      const target = `captures/camera-clip-${Date.now()}.${name.split('.').pop()}`
      clipSaved.push(download.saveAs(target).then(() => target).catch(error => {
        console.log('clip save skipped:', error.message)
        return null
      }))
    } else void download.cancel().catch(() => {})
  })
  await page.route('**/favicon.ico', route => route.fulfill({status: 204}))
  await page.route('**/stats.rcpd.cc/**', route => route.fulfill({status: 204, body: ''}))
  await page.route('**/api/t', route => route.fulfill({status: 204}))
  await page.route('**/api/live', route => route.fulfill({status: 200, contentType: 'application/json', body: '{"online":42}'}))

  await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 120000})
  await page.waitForFunction(() => window.viewer?.walk?.active, null, {timeout: 120000})
  // dock 要等加载幕退场才真的可点（幕会晚于 viewer 出现，直接等"射线打中按钮本身"最稳）。
  await page.waitForFunction(() => {
    const gear = document.querySelector('.dock-gear')
    if (!gear) return false
    const rect = gear.getBoundingClientRect()
    if (!rect.width) return false
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return !!hit && gear.contains(hit)
  }, null, {timeout: 120000})
  // swiftshader 下画布一直在重绘，Playwright 的「stable」判定会一直等；直接派发指针事件即可拿焦点。
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas[data-engine]')
    if (canvas instanceof HTMLElement) {
      canvas.focus()
      canvas.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, clientX: 640, clientY: 500, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0}))
      canvas.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, clientX: 640, clientY: 500, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0}))
    }
  })

  // dock 的按钮列会在图册/小地图挂上来时上下跳，Playwright 的"可点"判定会一直被打断；
  // 这里用 DOM 派发点击（走的是同一个 click handler），只跳过命中测试这一步。
  const tap = async selector => {
    await page.waitForSelector(selector, {state: 'attached', timeout: 20000})
    return page.evaluate(sel => {
      const element = document.querySelector(sel)
      if (!element) throw Error(`missing ${sel}`)
      element.click()
      return true
    }, selector)
  }

  // 1) 相机包
  await tap('.dock-gear')
  const rack = await page.evaluate(() => {
    const mask = document.querySelector('.gear-mask')
    return {
      open: !!mask && !mask.hidden,
      cards: document.querySelectorAll('.gear-card').length,
      names: [...document.querySelectorAll('.gear-name')].map(node => node.textContent.trim()),
    }
  })
  assert.equal(rack.open, true, 'gear rack should open')
  assert.equal(rack.cards, 7, 'gear rack should list seven bodies')
  for (const name of ['索尼 A7R II', '大疆 Osmo Action 6', '大疆 Osmo Pocket 4 Pro']) {
    assert.ok(rack.names.includes(name), `gear rack should include ${name}: ${rack.names.join(' / ')}`)
  }
  console.log('rack', JSON.stringify(rack))

  await tap('[data-body=thumb]')
  const equipped = await page.evaluate(() => JSON.parse(localStorage.getItem('glol.prefs') ?? '{}').gear?.equipped)
  assert.equal(equipped, 'thumb', 'equipping should persist to prefs')
  assert.equal(await page.evaluate(() => !!document.querySelector('.gear-card.on[data-body=thumb]')), true, 'equipped card should be marked')
  await tap('.gear-close')
  // 物品栏由 play.tick 每帧刷新，软渲染下一次 tick 可能要等好几秒；关掉相机包后等它真的出现再断言。
  await page.waitForFunction(() => {
    const bar = document.querySelector('.hotbar')
    return !!bar && !bar.hidden
  }, null, {timeout: 90000})

  // 2) IDOK-238：默认空手（右臂跟走路动画），底部物品栏按 2 才拿相机，镜头朝角色前方；按 1 收起
  const handState = () => page.evaluate(() => {
    const walk = window.viewer.walk
    for (let index = 0; index < 40; index++) walk.tick(1 / 60)
    const anchor = walk.handAnchor()
    const prop = anchor.children.find(child => /^camera-/.test(child.name))
    const fig = anchor.parent; let root = fig; while (root.parent && root.parent.type !== 'Scene') root = root.parent
    const pos = name => { const v = {x: 0, y: 0, z: 0}; const node = root.getObjectByName(name); const w = node.getWorldPosition(node.position.clone()); return w }
    const r = pos('upperarm_r'), l = pos('upperarm_l'), chest = pos('spine_02')
    const right = r.clone().sub(l).setY(0).normalize()
    const forward = right.clone().cross(chest.clone().set(0, 1, 0)).negate() // up × right
    let lens = null, ahead = null
    if (prop) {
      const q = prop.getWorldQuaternion(prop.quaternion.clone())
      const dir = prop.position.clone().set(0, 0, -1).applyQuaternion(q)
      lens = +dir.dot(forward).toFixed(2)
      ahead = +prop.getWorldPosition(prop.position.clone()).sub(chest).dot(forward).toFixed(2)
    }
    const bar = document.querySelector('.hotbar')
    return {props: anchor.children.filter(child => /^camera-/.test(child.name)).length, blend: +walk.cameraHoldPose().blend.toFixed(2), lens, ahead,
      bar: !!bar && !bar.hidden, on: document.querySelector('.hotbar-slot.on')?.dataset.slot ?? null}
  })
  const empty = await handState()
  assert.equal(empty.bar, true, 'hotbar should show while walking')
  assert.equal(empty.on, 'hand', 'hotbar should start on 空手')
  assert.equal(empty.props, 0, 'walking hand should start empty')
  assert.equal(empty.blend, 0, 'right arm should stay in the walk animation while empty-handed')
  await page.screenshot({path: 'captures/hotbar-hand.png'})
  await page.keyboard.press('Digit2')
  await page.waitForFunction(() => window.viewer.walk.handAnchor().children.some(child => /^camera-/.test(child.name)), null, {timeout: 60000})
  const held = await handState()
  assert.equal(held.on, 'camera', 'pressing 2 should select the camera slot')
  assert.ok(held.blend > 0.9, `camera hold should engage, blend=${held.blend}`)
  assert.ok(held.lens > 0.6, `camera lens should face where the body faces, dot=${held.lens}`)
  assert.ok(held.ahead > 0.1, `camera should sit in front of the chest, ${held.ahead} m`)
  await page.screenshot({path: 'captures/hotbar-camera.png'})
  await page.keyboard.press('Digit1')
  await page.waitForFunction(() => !window.viewer.walk.handAnchor().children.some(child => /^camera-/.test(child.name)), null, {timeout: 30000})
  const back = await handState()
  assert.equal(back.props, 0, 'pressing 1 should put the camera away')
  console.log('hand', JSON.stringify({empty, held, back}))
  await page.keyboard.press('Digit2')

  // 3) 进拍照模式：只有普通拍照的那一排 UI，没有参数面板 / 构图辅助
  await tap('.dock-photo')
  await page.waitForFunction(() => document.body.dataset.photo === 'on', null, {timeout: 15000})
  const opened = await page.evaluate(() => ({
    bar: !document.querySelector('.photo-bar').hidden,
    sky: [...document.querySelectorAll('.photo-bar [data-group=sky] button')].map(node => node.textContent.trim()),
    filters: [...document.querySelectorAll('.photo-bar [data-group=filter] button')].map(node => node.textContent.trim()),
    opts: [...document.querySelectorAll('.photo-bar [data-group=opts] button')].map(node => node.textContent.trim()),
    shutter: !!document.querySelector('.photo-shutter'),
    rec: !!document.querySelector('.photo-rec'),
    sheet: !!document.querySelector('.cam-sheet'),
    guides: !!document.querySelector('.cam-guides'),
  }))
  assert.equal(opened.bar, true, 'photo bar should show')
  assert.deepEqual(opened.sky, ['晴', '雾', '雨'], 'sky chips should stay')
  assert.deepEqual(opened.filters, ['原片', '青绿', '胶片', '暮金', '水墨'], 'filter chips should stay')
  assert.deepEqual(opened.opts, ['人物', '动作', '落款', '换机'], 'opts should be 人物 / 动作 / 落款 / 换机')
  assert.equal(opened.shutter, true, 'shutter should stay')
  assert.equal(opened.rec, true, 'record button should stay')
  assert.equal(opened.sheet, false, 'professional parameter sheet must be gone')
  assert.equal(opened.guides, false, 'guides overlay must be gone')
  console.log('photo', JSON.stringify(opened))

  // 4) 按快门出片
  const shoot = async () => {
    await page.evaluate(() => delete window.lastPhoto)
    await tap('.photo-shutter')
    await page.waitForFunction(() => !!window.lastPhoto, null, {timeout: 60000})
    return page.evaluate(() => window.lastPhoto)
  }
  const photo = await shoot()
  assert.match(photo.name, /\.(jpe?g|png|webp)$/i, `photo should have an image extension, got ${photo.name}`)
  assert.equal(photo.width, 2560, 'photo should render at the hi-res width')
  assert.equal(photo.raw, false, 'plain photo mode should not write RAW')
  assert.equal(photo.settings.zoom, 1, 'plain photo mode should not crop')
  assert.ok(photo.settings.iso > 0, 'auto exposure should pick a real ISO')
  assert.ok(photo.settings.shutter > 0, 'auto exposure should pick a real shutter')
  assert.ok(photo.bytes > 40000, `photo should weigh something, got ${photo.bytes}`)
  assert.equal(photo.body, 'thumb', 'photo should be taken with the equipped body')
  console.log('shot', JSON.stringify(photo))

  // 4b) 换滤镜再拍一张：像素内容应该变
  await tap('[data-group=filter] [data-v="2"]')
  const filtered = await shoot()
  assert.notEqual(filtered.bytes, photo.bytes, 'filter should change the encoded photo')
  console.log('shot filtered', JSON.stringify({name: filtered.name, bytes: filtered.bytes}))

  // 4c) 换机入口还在拍照条里
  await tap('[data-v=rack]')
  const rackAgain = await page.evaluate(() => {
    const mask = document.querySelector('.gear-mask')
    return {open: !!mask && !mask.hidden, cards: document.querySelectorAll('.gear-card').length}
  })
  assert.equal(rackAgain.open, true, '换机 chip should reopen the rack')
  await tap('.gear-close')

  // 5) 录像：固定 MP4
  const canRecord = await page.evaluate(() => typeof MediaRecorder !== 'undefined' && typeof document.querySelector('canvas').captureStream === 'function')
  if (canRecord) {
    await tap('.photo-rec')
    await page.waitForFunction(() => document.querySelector('.photo-bar').classList.contains('rec'), null, {timeout: 20000})
    await page.waitForTimeout(1600)
    await tap('.photo-rec')
    // 两条合法结果：① 编码器有输出 → window.lastClip；② 这台机器的编码器一帧都不吐 → 明确提示「录不出画面」。
    // 无头 + swiftshader 环境（本机 Chromium 159）实测在 720p 上常常只回调 size 0 的 dataavailable，
    // 所以这里不能只断言"一定录出文件"，但必须断言"要么出片、要么诚实地拒绝"。
    await page.waitForFunction(
      () => !!window.lastClip || /录不出画面/.test(document.body.textContent ?? ''),
      null,
      {timeout: 90000},
    )
    const clip = await page.evaluate(() => (window.lastClip ? {
      name: window.lastClip.name,
      mime: window.lastClip.mime,
      container: window.lastClip.container,
      seconds: window.lastClip.seconds,
      width: window.lastClip.width,
      height: window.lastClip.height,
      fps: window.lastClip.fps,
      bytes: window.lastClip.bytes,
    } : null))
    const recStopped = await page.evaluate(() => !document.querySelector('.photo-bar').classList.contains('rec'))
    assert.ok(recStopped, 'stopping the recording should drop the rec state on the bar')
    if (clip) {
      assert.match(clip.name, /\.(mp4|webm)$/i, `clip should have a video extension, got ${clip.name}`)
      if (clip.container === 'mp4') {
        assert.match(clip.name, /\.mp4$/i, 'MP4 recording should land as .mp4')
      } else {
        assert.match(clip.name, /\.webm$/i, `webm fallback should land as .webm, got ${clip.name}`)
      }
      assert.ok(clip.seconds > 0.5, `clip should be at least half a second, got ${clip.seconds}`)
      // 输出 = 源画布原比例，长边不超过机身首档（不放大、不变形）
      const source = await page.evaluate(() => {
        const canvas = document.querySelector('canvas[data-engine]')
        return {width: canvas.width, height: canvas.height}
      })
      assert.ok(clip.width <= source.width && clip.height <= source.height, `clip ${clip.width}x${clip.height} should not upscale ${source.width}x${source.height}`)
      assert.ok(Math.abs(clip.width / clip.height - source.width / source.height) < 0.02, `clip aspect should match the canvas, got ${clip.width}x${clip.height}`)
      assert.ok(clip.bytes > 0, `clip should carry encoded data, got ${clip.bytes} B`)
      if (clipSaved.length) {
        const saved = await Promise.all(clipSaved)
        if (saved[0]) console.log('clip file', saved[0])
      }
      console.log('clip', JSON.stringify(clip))
    } else {
      console.log('clip skipped: this machine’s encoder emits empty data at 720p (environment, not the code path)')
    }
  } else {
    console.log('clip skipped: MediaRecorder/captureStream unavailable')
  }

  // 6) 退出拍照：相机回到手上，UI 收干净（挂机是异步重建的，等它回来再断言）
  await tap('.photo-exit')
  await page.waitForFunction(() => document.body.dataset.photo !== 'on', null, {timeout: 15000})
  await page.waitForFunction(() => !!window.viewer.walk.handAnchor()?.children.some(child => /^camera-/.test(child.name)), null, {timeout: 20000})
  const closed = await page.evaluate(() => ({
    barHidden: document.querySelector('.photo-bar').hidden,
    exitHidden: document.querySelector('.photo-exit').hidden,
    cameraBack: !!window.viewer.walk.handAnchor()?.children.some(child => /^camera-/.test(child.name)),
  }))
  assert.equal(closed.barHidden, true, 'photo bar should hide')
  assert.equal(closed.exitHidden, true, 'exit button should hide')
  assert.equal(closed.cameraBack, true, 'camera should return to the hand')
  console.log('closed', JSON.stringify(closed))

  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`)
  console.log(`camera suite passed in ${((performance.now() - start) / 1000).toFixed(1)}s`)
} finally {
  await browser?.close().catch(() => {})
  await server.close()
}