import assert from 'node:assert/strict'
import {mkdir, writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {createServer} from 'vite'

// IDOK-226 拍照「动作」键验收：进拍照 → 开轮盘 → 选奶蛙笑 → 快门 → 录像，
// 断言快门/录像期间「动作」键与轮盘收起、人物动作照常播；电脑 + 手机横屏各一组，控制台 0 报错。
// BASE=已起的服务地址（可省，省了自己起 vite dev）；OUT=截图/成片目录；
// GL_ARGS=Chromium GL 参数（默认 swiftshader；软渲染每帧 >1s 时动作 2~4 帧就播完，mac 上用
// GL_ARGS='--use-angle=metal --ignore-gpu-blocklist --enable-gpu' 仍是无头、但有 30fps）。
const out = process.env.OUT || 'captures/photo-pose'
await mkdir(out, {recursive: true})
let server
let base = process.env.BASE
if (!base) {
  server = await createServer({root: 'web', configFile: 'web/vite.config.ts', server: {host: '127.0.0.1', port: 0}})
  await server.listen()
  base = `http://127.0.0.1:${server.httpServer.address().port}`
}
const profiles = [
  {name: 'desktop', context: {viewport: {width: 1280, height: 720}}},
  {name: 'mobile-landscape', context: {viewport: {width: 844, height: 390}, isMobile: true, hasTouch: true, deviceScaleFactor: 2}},
]
const POSE = '.photo-bar [data-v="pose"]'
const summary = []
const browser = await chromium.launch({executablePath: process.env.CHROMIUM, args: (process.env.GL_ARGS ?? '--use-angle=swiftshader --enable-unsafe-swiftshader').split(' ').filter(Boolean)})

async function run(profile) {
  const context = await browser.newContext(profile.context)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.location().url + ': ' + message.text())
  })
  let clipSaved = null
  page.on('download', download => {
    const name = download.suggestedFilename()
    if (/\.(mp4|webm)$/i.test(name)) clipSaved = download.saveAs(`${out}/${profile.name}-clip.${name.split('.').pop()}`).then(() => `${out}/${profile.name}-clip.${name.split('.').pop()}`)
    else void download.cancel().catch(() => {})
  })
  await page.route('**/favicon.ico', route => route.fulfill({status: 204}))
  await page.route('**/stats.rcpd.cc/**', route => route.fulfill({status: 204, body: ''}))
  await page.route('**/api/t', route => route.fulfill({status: 204}))
  await page.route('**/api/live', route => route.fulfill({status: 200, contentType: 'application/json', body: '{"online":42}'}))
  // vite dev 没有 Pages Functions：直升机排队按「空闲、无人排队」桩掉，免得 404 噪音盖住真报错。
  await page.route('**/api/helicopter', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({code: '', now: Date.now(), state: 'idle', mine: null, ahead: 0, eta: 0, flight: null})}))

  await page.goto(base + '/?play&verify&mode=walk&flow=0', {waitUntil: 'domcontentloaded', timeout: 120000})
  await page.waitForFunction(() => window.viewer?.walk?.active && window.viewer.walk.emotes, null, {timeout: 180000})
  // swiftshader 画布一直重绘，Playwright 的 stable 判定会卡住：一律 DOM click。
  const tap = selector => page.evaluate(sel => {
    const element = document.querySelector(sel)
    if (!element) throw Error(`missing ${sel}`)
    element.click()
  }, selector)
  const state = () => page.evaluate(sel => {
    const pose = document.querySelector(sel)
    const overlay = document.querySelector('.emote-overlay')
    return {
      photo: document.body.dataset.photo ?? null,
      busy: document.body.dataset.photoBusy ?? null,
      poseVisible: !!pose && pose.style.visibility !== 'hidden' && getComputedStyle(pose).visibility !== 'hidden' && pose.getBoundingClientRect().width > 0,
      poseDisabled: !!pose?.disabled,
      wheel: !!overlay && !overlay.hidden && getComputedStyle(overlay).display !== 'none',
      emote: window.viewer.walk.emote.id,
    }
  }, POSE)
  const pickPose = async () => {
    await tap(POSE)
    await page.waitForFunction(() => {
      const overlay = document.querySelector('.emote-overlay')
      return !!overlay && !overlay.hidden && getComputedStyle(overlay).display !== 'none'
    }, null, {timeout: 10000})
  }

  // 1) 进拍照
  await page.keyboard.press('KeyP')
  await page.waitForFunction(() => document.body.dataset.photo === 'on', null, {timeout: 1500}).catch(() => tap('.dock-photo'))
  await page.waitForFunction(() => document.body.dataset.photo === 'on', null, {timeout: 15000})
  const opts = await page.evaluate(() => [...document.querySelectorAll('.photo-bar [data-group=opts] button')].map(node => node.textContent.trim()))
  assert.deepEqual(opts, ['人物', '动作', '落款', '换机'])
  const opened = await state()
  assert.equal(opened.poseVisible, true, '动作键应可见')
  assert.equal(opened.poseDisabled, false, '动作键应可点')
  assert.equal(opened.wheel, false)
  await page.screenshot({path: `${out}/${profile.name}-1-photo.png`})

  // 2) 开轮盘 → 3) 选奶蛙笑（4.25s，不因移动打断）
  await pickPose()
  await page.screenshot({path: `${out}/${profile.name}-2-wheel.png`})
  const slot = () => page.evaluate(() => document.querySelectorAll('.emote-overlay .emote-slot')[2].click())
  await slot()
  const posed = await state()
  assert.equal(posed.wheel, false, '选完动作轮盘收起')
  assert.equal(posed.emote, 3, '奶蛙笑开始播')
  await page.screenshot({path: `${out}/${profile.name}-3-pose.png`})

  // 4) 快门：重新起动作（软渲染截图慢，上一段可能已播完），播 1.2s 后按快门；click 同步阶段就进 busy=shot
  await pickPose()
  await slot()
  const atShutter = await page.evaluate(async sel => {
    await new Promise(resolve => setTimeout(resolve, 1200))
    delete window.lastPhoto
    document.querySelector('.photo-shutter').click()
    const pose = document.querySelector(sel)
    return {busy: document.body.dataset.photoBusy, vis: pose.style.visibility, wheel: !document.querySelector('.emote-overlay').hidden, emote: window.viewer.walk.emote.id}
  }, POSE)
  assert.deepEqual(atShutter, {busy: 'shot', vis: 'hidden', wheel: false, emote: 3}, '快门期间动作键/轮盘收起、动作照播')
  await page.waitForFunction(() => !!window.lastPhoto, null, {timeout: 60000})
  const photo = await page.evaluate(async () => {
    const src = document.querySelector('.photo-shot img').src
    const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer())
    let binary = ''
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    return {name: window.lastPhoto.name, width: window.lastPhoto.width, height: window.lastPhoto.height, data: btoa(binary)}
  })
  const photoFile = `${out}/${profile.name}-photo.${photo.name.split('.').pop()}`
  await writeFile(photoFile, Buffer.from(photo.data, 'base64'))
  const afterShot = await state()
  assert.equal(afterShot.busy, null, '出片后 busy 清掉')
  assert.equal(afterShot.poseVisible, true, '出片后动作键回来')

  // 5) 录像：开录即收起，录像中点动作键也打不开轮盘，动作照播
  if (await page.evaluate(() => document.querySelector('.photo-shot .shot-close'))) await tap('.photo-shot .shot-close')
  await pickPose()
  await slot()
  let clip = null
  let recording = null
  const canRecord = await page.evaluate(() => typeof MediaRecorder !== 'undefined' && typeof document.querySelector('canvas').captureStream === 'function')
  if (canRecord) {
    await tap('.photo-rec')
    await page.waitForFunction(() => document.querySelector('.photo-bar').classList.contains('rec'), null, {timeout: 20000})
    recording = await state()
    assert.equal(recording.busy, 'rec')
    assert.equal(recording.poseVisible, false, '录像中动作键收起')
    assert.equal(recording.wheel, false)
    assert.equal(recording.emote, 3, '开录后动作照常播')
    await tap(POSE)
    await page.waitForTimeout(300)
    const blocked = await state()
    assert.equal(blocked.wheel, false, '录像中点动作键也打不开轮盘')
    await page.screenshot({path: `${out}/${profile.name}-4-recording.png`})
    await page.waitForTimeout(2500)
    await tap('.photo-rec')
    await page.waitForFunction(() => !!window.lastClip || /录不出画面/.test(document.body.textContent ?? ''), null, {timeout: 90000})
    clip = await page.evaluate(() => window.lastClip ?? {problem: window.lastClipProblem ?? null})
    const stopped = await state()
    assert.equal(stopped.busy, null, '停录后 busy 清掉')
    assert.equal(stopped.poseVisible, true, '停录后动作键回来')
    if (clipSaved) clip.file = await clipSaved.catch(() => null)
  }

  // 6) 退出拍照
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.body.dataset.photo !== 'on', null, {timeout: 10000})
  const exited = await state()
  assert.equal(exited.busy, null)
  assert.equal(exited.wheel, false)
  await context.close()
  assert.deepEqual(errors, [], `${profile.name} 控制台报错`)
  return {profile: profile.name, opened, posed, atShutter, photo: {file: photoFile, width: photo.width, height: photo.height}, recording, clip, errors}
}

try {
  for (const profile of profiles) summary.push(await run(profile))
  console.log(JSON.stringify(summary, null, 2))
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await browser.close()
  await server?.close()
}
