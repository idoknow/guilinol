import {telemetryPreview} from './telemetry-preview.mjs'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {preview} from 'vite'

// 相机系统冒烟（IDOK-182）：
//   相机包换机 → 手上挂机 → 拍照参数（按机型给挡位）→ 出片（数码变焦裁切、RAW 旁车）→ 构图线/水平仪 → 录像。
// 只跑一条链路，不做像素级比对；成片的像素断言集中在"变焦裁切后的尺寸"和"参数写进了 lastPhoto"。

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
  page.on('download', download => void download.cancel().catch(() => {}))
  await page.route('**/favicon.ico', route => route.fulfill({status: 204}))
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
  await page.locator('canvas[data-engine]').first().click({position: {x: 640, y: 500}})

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
  assert.equal(rack.cards, 4, 'gear rack should list four bodies')
  console.log('rack', JSON.stringify(rack))

  await tap('[data-body=thumb]')
  const equipped = await page.evaluate(() => JSON.parse(localStorage.getItem('glol.prefs') ?? '{}').gear?.equipped)
  assert.equal(equipped, 'thumb', 'equipping should persist to prefs')
  assert.equal(await page.evaluate(() => !!document.querySelector('.gear-card.on[data-body=thumb]')), true, 'equipped card should be marked')
  await tap('.gear-close')

  // 2) 手上挂机（异步 glTF→占位回落，给足时间）
  await page.waitForFunction(() => {
    const anchor = window.viewer?.walk?.handAnchor?.()
    return !!anchor && anchor.children.some(child => /^camera-/.test(child.name))
  }, null, {timeout: 60000})
  const hand = await page.evaluate(() => {
    const anchor = window.viewer.walk.handAnchor()
    const prop = anchor.children.find(child => /^camera-/.test(child.name))
    return {
      name: prop?.name ?? null,
      source: prop?.userData?.source ?? null,
      parent: anchor.name,
      bone: anchor.parent?.name ?? null,
      meshes: prop ? prop.children.length : 0,
    }
  })
  assert.equal(hand.name, 'camera-thumb', 'hand prop should be the equipped body')
  assert.ok(hand.parent.startsWith('attach_'), 'camera prop should hang off the hand attachment anchor')
  console.log('hand', JSON.stringify(hand))

  // 3) 进拍照模式
  await tap('.dock-photo')
  await page.waitForFunction(() => document.body.dataset.photo === 'on', null, {timeout: 15000})
  // readout 由每帧 tick 写入，打开后要等一帧
  await page.waitForFunction(() => (document.querySelector('.cg-readout')?.textContent ?? '').trim().length > 0, null, {timeout: 15000})
  const opened = await page.evaluate(() => ({
    bar: !document.querySelector('.photo-bar').hidden,
    guides: !document.querySelector('.cam-guides').hidden,
    readout: document.querySelector('.cg-readout').textContent.trim(),
    grid: document.querySelector('.cg-grid').className,
  }))
  assert.equal(opened.bar, true, 'photo bar should show')
  assert.equal(opened.guides, true, 'guides overlay should show')
  assert.match(opened.readout, /ISO/, 'readout should carry exposure data')
  assert.match(opened.grid, /grid-thirds/, 'default grid should be thirds')
  console.log('photo', JSON.stringify(opened))

  // 4) 参数面板按机型给挡位：拇指机没有光圈行，微单有
  await tap('[data-v=sheet]')
  await page.waitForSelector('.cam-sheet:not([hidden])', {timeout: 8000})
  const thumbRows = await page.evaluate(() => ({
    sliders: document.querySelectorAll('.cam-sheet input[type=range]').length,
    rows: [...document.querySelectorAll('.cam-sheet .cs-row')].map(row => row.dataset.row),
    hasRaw: !!document.querySelector('.cam-sheet [data-toggle=raw]'),
    hasMacro: !!document.querySelector('.cam-sheet [data-toggle=macro]'),
  }))
  assert.equal(thumbRows.rows.includes('aperture'), false, 'thumb camera has a fixed aperture')
  assert.equal(thumbRows.hasRaw, false, 'thumb camera cannot shoot RAW')
  assert.equal(thumbRows.hasMacro, true, 'thumb camera offers macro')
  assert.ok(thumbRows.sliders >= 5, `thumb should expose sliders, got ${thumbRows.sliders}`)
  console.log('thumb sheet', JSON.stringify(thumbRows))

  // 5) 变焦出片：2× 应裁掉一半边长
  const shoot = async () => {
    await page.evaluate(() => delete window.lastPhoto)
    await tap('.photo-shutter')
    await page.waitForFunction(() => !!window.lastPhoto, null, {timeout: 60000})
    return page.evaluate(() => window.lastPhoto)
  }
  const wide = await shoot()
  await page.evaluate(() => {
    const row = document.querySelector('.cam-sheet [data-row=zoom] input')
    row.value = '2'
    row.dispatchEvent(new Event('input', {bubbles: true}))
  })
  // readout 每帧才刷新，软渲染下一帧可能好几百毫秒，这里等它追上
  await page.waitForFunction(() => /2\.0×/.test(document.querySelector('.cg-readout')?.textContent ?? ''), null, {timeout: 20000})
  const readoutZoom = await page.evaluate(() => document.querySelector('.cg-readout').textContent)
  assert.match(readoutZoom, /2\.0×/, 'readout should reflect digital zoom')
  const cropped = await shoot()
  assert.equal(cropped.settings.zoom, 2, 'settings should record the zoom')
  assert.ok(Math.abs(cropped.width - Math.round(wide.width / 2)) <= 2, `zoom 2x should halve width: ${cropped.width} vs ${wide.width}`)
  assert.ok(cropped.bytes > 0 && cropped.height > 0, 'shot should carry bytes')
  assert.equal(cropped.body, 'thumb', 'shot should record the equipped body')
  console.log('shots', JSON.stringify({wide: {w: wide.width, h: wide.height, bytes: wide.bytes}, cropped: {w: cropped.width, h: cropped.height, bytes: cropped.bytes}}))

  // 6) 换微单 → RAW 旁车 + 光圈行
  await tap('.cs-rack')
  await page.waitForSelector('.gear-card[data-body=mirrorless]', {timeout: 8000})
  await tap('[data-body=mirrorless]')
  await page.evaluate(() => document.querySelector('.gear-close').click())
  await page.waitForSelector('.cam-sheet [data-toggle=raw]', {timeout: 8000})
  const mirrorRows = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.cam-sheet .cs-row')].map(row => row.dataset.row),
    rawOn: document.querySelector('.cam-sheet [data-toggle=raw]')?.classList.contains('on'),
  }))
  assert.ok(mirrorRows.rows.includes('aperture'), 'mirrorless should expose aperture')
  assert.equal(mirrorRows.rawOn, true, 'mirrorless defaults to RAW on')
  const rawShot = await shoot()
  assert.equal(rawShot.raw, true, 'RAW sidecar should be produced')
  assert.match(rawShot.sidecarName, /\.raw\.json$/, 'sidecar should be named .raw.json')
  console.log('mirrorless', JSON.stringify({rows: mirrorRows.rows, raw: rawShot.raw, sidecar: rawShot.sidecarName, name: rawShot.name}))

  // 7) 构图线 + 水平仪
  await tap('[data-grid=golden]')
  const guideState = await page.evaluate(() => {
    const grid = document.querySelector('.cg-grid').className
    const level = document.querySelector('.cg-level')
    return {grid, levelVisible: !level.hidden, transform: getComputedStyle(level).transform}
  })
  assert.match(guideState.grid, /grid-golden/, 'grid mode should switch to golden ratio')
  assert.notEqual(guideState.transform, 'none', 'level should be rotated by camera roll')
  console.log('guides', JSON.stringify(guideState))

  // 8) 录像
  const canRecord = await page.evaluate(() => typeof MediaRecorder !== 'undefined' && typeof document.querySelector('canvas').captureStream === 'function')
  if (canRecord) {
    await tap('.photo-rec')
    await page.waitForTimeout(1400)
    await tap('.photo-rec')
    await page.waitForFunction(() => !!window.lastClip, null, {timeout: 30000})
    const clip = await page.evaluate(() => ({name: window.lastClip.name, mime: window.lastClip.mime, seconds: window.lastClip.seconds}))
    assert.match(clip.name, /\.webm$/, 'clip should be saved as webm')
    assert.ok(clip.seconds > 0.5, `clip should be at least half a second, got ${clip.seconds}`)
    console.log('clip', JSON.stringify(clip))
  } else {
    console.log('clip skipped: MediaRecorder/captureStream unavailable')
  }

  // 9) 退出后收干净
  await tap('.photo-exit')
  await page.waitForFunction(() => {
    const anchor = window.viewer?.walk?.handAnchor?.()
    return !!anchor && anchor.children.some(child => child.name === 'camera-mirrorless')
  }, null, {timeout: 20000})
  const closed = await page.evaluate(() => ({
    photo: document.body.dataset.photo ?? null,
    barHidden: document.querySelector('.photo-bar').hidden,
    guidesHidden: document.querySelector('.cam-guides').hidden,
    cameraBack: window.viewer.walk.handAnchor().children.some(child => child.name === 'camera-mirrorless'),
  }))
  assert.equal(closed.photo, null, 'photo mode should exit cleanly')
  assert.equal(closed.barHidden, true, 'bar should hide on exit')
  assert.equal(closed.guidesHidden, true, 'guides should hide on exit')
  assert.equal(closed.cameraBack, true, 'hand camera should come back after leaving photo mode')
  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`)
  console.log('closed', JSON.stringify(closed))
  console.log(`camera, gear, shot pipeline and recording passed in ${((performance.now() - start) / 1000).toFixed(1)}s`)
} finally {
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
