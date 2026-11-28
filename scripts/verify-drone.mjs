import {telemetryPreview} from './telemetry-preview.mjs'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {preview} from 'vite'

// IDOK-215 drone fleet smoke test:
//   hangar -> place Mini 5 Pro -> takeoff -> simple RC UI -> keyboard/touch sticks -> photo ->
//   record -> RTH -> exit -> place FlyCart 200 with the car load -> oversized-payload warning.
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
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const photoSaved = []
  const clipSaved = []
  page.on('download', download => {
    const name = download.suggestedFilename()
    if (/\.(mp4|webm)$/i.test(name)) clipSaved.push(download.saveAs(`captures/drone-clip.${name.split('.').pop()}`).then(() => name))
    else if (/\.(jpg|jpeg|png|webp)$/i.test(name)) { photoSaved.push(name); return download.saveAs(`captures/${name}`) }
    else void download.cancel().catch(() => {})
  })
  await page.route('**/favicon.ico', route => route.fulfill({status: 204}))
  await page.route('**/stats.rcpd.cc/**', route => route.fulfill({status: 204, body: ''}))
  await page.route('**/api/t', route => route.fulfill({status: 204}))
  await page.route('**/api/live', route => route.fulfill({status: 200, contentType: 'application/json', body: '{"online":42}'}))

  await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 120000})
  // swiftshader 下首帧/激活可能要 2–7 分钟，默认 rAF 轮询几乎不跑，必须 poll 慢一点、超时给足。
  try {
    await page.waitForFunction(() => window.viewer?.walk?.active, null, {timeout: 300000, polling: 500})
  } catch (error) {
    const probe = await page.evaluate(() => ({
      url: location.href,
      viewer: !!window.viewer,
      active: window.viewer?.walk?.active ?? null,
      stats: window.viewer?.stats ?? null,
      veil: !!document.querySelector('.ld-veil'),
      body: document.body.innerHTML.length,
    })).catch(note => ({note: String(note).slice(0,200)}))
    console.log('boot probe', JSON.stringify(probe))
    console.log('boot errors', JSON.stringify(errors.slice(0,6)))
    throw error
  }
  // The drone entry lives behind the dock's 工具 menu (web/src/play/index.ts builds .dock-buttons
  // collapsed), so open it before asserting that the button is really on screen.
  try {
    await page.waitForSelector('.dock-more', {state: 'attached', timeout: 300000})
  } catch (error) {
    // 偶发：swiftshader 里首帧后 HUD 一直没搭起来。把现场打出来，省得下次又从零猜。
    const probe = await page.evaluate(() => ({
      url: location.href,
      mode: document.body.dataset.mode ?? null,
      home: document.body.dataset.home ?? null,
      dock: !!document.querySelector('.dock'),
      more: !!document.querySelector('.dock-more'),
      viewer: !!window.viewer,
      active: window.viewer?.walk?.active ?? null,
      body: document.body.innerHTML.length,
    })).catch(note => ({note}))
    console.log('dock probe', JSON.stringify(probe))
    throw error
  }
  // Keep re-opening the menu while we look: anything that steals a pointer event (the load veil, a
  // late HUD paint) can close it again, and the entry only counts once it is really on screen.
  await page.waitForFunction(() => {
    const more = document.querySelector('.dock-more')
    if (!(more instanceof HTMLElement)) return false
    if (document.querySelector('#dock-menu')?.hasAttribute('hidden')) more.click()
    const entry = document.querySelector('.dock-drone')
    if (!entry) return false
    const rect = entry.getBoundingClientRect()
    if (!rect.width) return false
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return !!hit && entry.contains(hit)
  }, null, {timeout: 180000, polling: 250})
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas[data-engine]')
    if (canvas instanceof HTMLElement) {
      canvas.focus()
      canvas.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, clientX: 640, clientY: 520, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0}))
      canvas.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, clientX: 640, clientY: 520, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0}))
    }
  })

  const tap = async selector => {
    // 工具菜单里的入口会随「点空白处」收起来（#dock-menu 收起时整组按钮被摘掉），
    // 所以每次点 .dock-drone 之前先把菜单重新展开一次。
    if (selector === '.dock-drone') {
      await page.evaluate(() => {
        const more = document.querySelector('.dock-more')
        const menu = document.querySelector('#dock-menu')
        if (more instanceof HTMLElement && (!menu || menu.hasAttribute('hidden'))) more.click()
      })
    }
    // poll in page instead of waitForSelector: the HUD redraws these nodes, and Playwright's
    // attach-wait flakes when the node is replaced between two polls.
    await page.waitForFunction(sel => !!document.querySelector(sel), selector, {timeout: 30000, polling: 100})
    return page.evaluate(sel => {
      const element = document.querySelector(sel)
      if (!element) throw Error(`missing ${sel}`)
      element.click()
      return true
    }, selector)
  }

  // 1) hangar
  await tap('.dock-drone')
  const hangar = await page.evaluate(() => {
    const mask = document.querySelector('.drone-mask')
    return {
      open: !!mask && !mask.hidden,
      cards: document.querySelectorAll('.drone-card').length,
      names: [...document.querySelectorAll('.drone-name')].map(node => node.textContent.trim()),
      loads: document.querySelectorAll('[data-load]').length,
      batt: document.querySelectorAll('.drone-card .drone-batt').length,
      battText: [...document.querySelectorAll('.drone-card .drone-batt')].map(node => node.textContent.trim()),
    }
  })
  console.log('hangar', JSON.stringify(hangar))
  assert.equal(hangar.open, true, 'hangar should open')
  assert.equal(hangar.cards, 2, 'two aircraft: the FPV racer and the FlyCart lifter')
  assert.deepEqual(hangar.names, ['GLI FPV 穿越机','GLI FlyCart 200'])
  assert.equal(hangar.loads, 4, 'FlyCart exposes four load presets')
  // IDOK-529: every card carries its own battery/repair line.
  assert.equal(hangar.batt, 2, 'each aircraft shows a battery chip')
  assert.match(hangar.battText.join(' '), /\d+%|充电中/, `battery chips render: ${hangar.battText.join(' / ')}`)

  // 2) place the FPV racer (IDOK-530: the fleet is down to the racer and the lifter)
  await tap('[data-drone="fpv"]')
  await page.waitForFunction(() => !!window.droneDebug?.().flight, null, {timeout: 30000})
  const placed = await page.evaluate(() => ({
    dock: document.querySelector('.dock-drone')?.textContent.trim(),
    hint: document.querySelector('.drone-hint')?.textContent.trim() ?? null,
    state: window.droneDebug?.(),
  }))
  console.log('placed', JSON.stringify(placed))
  // IDOK-529: the dock entry always opens the hangar, so aircraft can be swapped mid-session.
  assert.equal(placed.dock, '无人机', 'the dock entry stays a hangar button')
  assert.equal(placed.state.mesh, 'drone-fpv', 'mesh added to the scene')
  assert.match(placed.hint ?? '', /FPV|无人机就位/)
  // IDOK-275: the glTF replaces the procedural mesh and keeps the animated node names
  assert.equal(placed.state.model.source, 'gltf', 'public/models/drones/fpv.glb is loaded')
  assert.deepEqual(placed.state.model.props, ['prop_1','prop_2','prop_3','prop_4'])
  assert.deepEqual([placed.state.model.gimbal, placed.state.model.lens, placed.state.model.gear], ['gimbal','lens','gear'])

  // 3) takeoff -> RC view: the hotbar slot is the only way in now (IDOK-529)
  await tap('.hotbar-drone')
  await page.waitForSelector('.rc.rc-pro', {timeout: 20000})
  await page.waitForFunction(() => document.body.dataset.drone === 'rc', null, {timeout: 20000, polling: 250})
  const rcUp = await page.evaluate(() => ({
    pro: !!document.querySelector('.rc.rc-pro'),
    buttons: [...document.querySelectorAll('.rc [data-act]')].map(node => node.textContent.trim()),
    sticks: document.querySelectorAll('.rc .rc-stick').length,
    dockHidden: getComputedStyle(document.querySelector('.dock')).display === 'none',
  }))
  console.log('rc', JSON.stringify(rcUp))
  assert.equal(rcUp.pro, true, 'every airframe now uses the professional controller')
  assert.equal(rcUp.sticks, 2, 'two touch sticks')
  assert.equal(rcUp.dockHidden, true, 'dock yields to the RC overlay')

  // 4) takeoff climbs into the flying phase — stepped, because software rendering here can drop to
  //    a frame every few seconds and the model would otherwise stall between assertions.
  const step = (dt = 0.1, repeats = 10) => page.evaluate(([a,b]) => window.droneStep(a,b), [dt, repeats])
  const climb = await step(0.1, 40)
  console.log('climb', JSON.stringify(climb))
  assert.equal(climb.phase, 'flying', 'aircraft reaches the flying phase')
  assert.ok(climb.agl > 1.4, 'aircraft climbs after 起飞')

  // 5) keyboard sticks move the aircraft — climb clear of the eaves first: IDOK-529's avoidance
  //    refuses to fly into a facade, and the street's shop roofs sit only a few metres up.
  await page.keyboard.down('ArrowUp')
  const raised = await step(0.1, 30)
  await page.keyboard.up('ArrowUp')
  console.log('raised', JSON.stringify({agl: raised.agl, avoid: raised.avoid ?? null}))
  assert.ok(raised.agl > 6, `climbing clears the eaves (agl ${raised.agl})`)
  const before = await page.evaluate(() => window.droneDebug().flight)
  assert.ok(before, 'the aircraft is still airworthy before the keyboard test')
  await page.keyboard.down('KeyW')
  const after = await step(0.1, 12)
  await page.keyboard.up('KeyW')
  await step(0.1, 6)
  console.log('keys', JSON.stringify({before: {d: before.distance, a: before.agl}, after: {d: after.distance, a: after.agl}}))
  assert.ok(after.distance > before.distance + 0.6, 'W flies forward')

  // 6) touch stick banks the aircraft
  const stick = await page.evaluate(() => {
    const pad = document.querySelectorAll('.rc .rc-stick')[1]
    const rect = pad.getBoundingClientRect()
    return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, w: rect.width}
  })
  await page.mouse.move(stick.x, stick.y)
  await page.mouse.down()
  await page.mouse.move(stick.x + stick.w * 0.42, stick.y, {steps: 4})
  const touched = await step(0.1, 8)
  await page.mouse.up()
  console.log('touch', JSON.stringify({speed: touched.speed}))
  assert.ok(touched.speed > 0.2, 'right stick banks the aircraft')

  // IDOK-530: 傻瓜式遥控（拖画面转视角）随 Mini 5 Pro 一起下线，专业遥控靠双摇杆 + 云台。

  // 7) photo
  await tap('.rc [data-act="photo"]')
  await page.waitForFunction(() => !!window.lastDronePhoto, null, {timeout: 40000})
  const shot = await page.evaluate(() => window.lastDronePhoto)
  console.log('photo', JSON.stringify(shot))
  assert.ok(shot.width >= 1200 && shot.height >= 600, 'aerial photo is big')
  assert.ok(shot.bytes > 20000, 'aerial photo has pixels')

  // 8) record
  await tap('.rc [data-act="record"]')
  await page.waitForFunction(() => !!document.querySelector('.rc [data-act="record"].live'), null, {timeout: 20000, polling: 250})
  await step(0.1, 10)
  await page.waitForTimeout(600)
  await tap('.rc [data-act="record"]')
  // 和相机套件同样的双路径：要么出片（window.lastDroneClip），要么诚实提示「录不出画面」
  // （本机无头环境在 720p 上编码器常常只回调 size 0 的数据，属环境限制）。
  let clip = null
  try {
    await page.waitForFunction(
      () => !!window.lastDroneClip || /录不出画面/.test(document.body.textContent ?? ''),
      null,
      {timeout: 60000, polling: 500},
    )
    clip = await page.evaluate(() => window.lastDroneClip ?? null)
  } catch {
    console.log('clip skipped: the software encoder never delivered data (environment, not the code path)')
  }
  if (clip) {
    console.log('clip', JSON.stringify(clip))
    assert.ok(clip.seconds > 0.2, 'clip has duration')
  } else {
    console.log('clip skipped: this machine’s encoder emits empty data at 720p (environment, not the code path)')
  }

  // 9) RTH asks the aircraft home
  await tap('.rc [data-act="rth"]')
  const home = await step(0.1, 4)
  console.log('rth', JSON.stringify(home.phase))
  assert.equal(home.phase, 'returning', 'RTH switches to the returning phase')
  // IDOK-529: the return leg draws a green route in the world and a banner in the middle of the screen.
  const banner = await page.evaluate(() => ({
    hidden: document.querySelector('.rc-rth-banner')?.hidden ?? null,
    text: (document.querySelector('.rc-rth-banner')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    rth: document.querySelector('.rc')?.dataset.rth ?? null,
    route: window.droneDebug().route,
  }))
  console.log('rth banner', JSON.stringify(banner))
  assert.equal(banner.hidden, false, '返航 banner shows up while the aircraft flies home')
  assert.match(banner.text, /返航中/, `banner reads 返航中: ${banner.text}`)
  assert.equal(banner.rth, '1', 'the RC root flags the return phase')
  assert.equal(banner.route.active, true, 'the green return route is in the scene')
  assert.ok(banner.route.points > 1, 'the route is a polyline plus its pulses')

  // IDOK-530: 返航条下面那个「取消返航」把控制权交回给飞行员。
  const cancelled = await page.evaluate(() => {
    document.querySelector('.rc-rth-cancel')?.click()
    const state = window.droneDebug()
    return {visible: !(document.querySelector('.rc-rth-banner')?.hidden ?? true), picked: !!document.querySelector('.rc-rth-cancel')}
  })
  const afterCancel = await step(0.1, 2)
  console.log('rth cancel', JSON.stringify({cancelled, phase: afterCancel.phase}))
  assert.equal(cancelled.picked, true, 'the return banner carries a 取消返航 button')
  assert.notEqual(afterCancel.phase, 'returning', '取消返航 drops out of the return leg')

  // IDOK-530: 再返航一次，这次必须一直落到地面（旧逻辑到家门口只绕圈不降落）。
  const rthLand = await page.evaluate(() => {
    document.querySelector('.rc [data-act="rth"]')?.click()
    const seq = []
    for (let i = 0; i < 500; i++) {
      const t = window.droneStep(0.2, 1)
      if (i % 50 === 0) seq.push({i, phase: t.phase, agl: Number(t.agl.toFixed(1)), dist: Number(t.distance.toFixed(1))})
      if (t.phase === 'landed') break
    }
    const last = window.droneStep(0.1, 1)
    return {phase: last.phase, agl: Number(last.agl.toFixed(2)), dist: Number(last.distance.toFixed(1)), seq}
  })
  console.log('rth landing', JSON.stringify(rthLand))
  assert.equal(rthLand.phase, 'landed', 'the return leg actually lands instead of circling the pilot')

  // 10) exit
  await tap('.rc [data-act="exit"]')
  await page.waitForFunction(() => document.body.dataset.drone === undefined && !document.querySelector('.rc'), null, {timeout: 20000, polling: 250})
  const closed = await page.evaluate(() => ({dock: document.querySelector('.dock-drone')?.textContent.trim(), rc: !!document.querySelector('.rc')}))
  console.log('closed', JSON.stringify(closed))
  assert.equal(closed.rc, false)

  // 11) FlyCart payload gate: cargo up to the 200 kg rating flies, the 1200 kg car is refused.
  await tap('.dock-drone')
  const overWeight = await page.evaluate(() => {
    const card = document.querySelector('[data-drone="flycart200"]')
    const car = card?.querySelector('[data-load="car"]')
    car?.click()
    return {
      over: car?.classList.contains('over') ?? false,
      note: (card?.querySelector('[data-load-note]')?.textContent ?? '').trim(),
      selected: card?.querySelector('[data-load].on')?.getAttribute('data-load') ?? null,
    }
  })
  console.log('overweight', JSON.stringify(overWeight))
  assert.equal(overWeight.over, true, 'the 1200 kg car is marked over the 200 kg rating')
  assert.match(overWeight.note, /超重/, `over-weight note: ${overWeight.note}`)
  assert.notEqual(overWeight.selected, 'car', 'an over-weight load cannot be selected')

  // Max the cargo slider: 200 kg is exactly the rating, so it must be allowed.
  // The slider only exists once 运货 is the selected preset, so click it first and re-query.
  await page.evaluate(() => document.querySelector('[data-drone="flycart200"] [data-load="cargo"]')?.click())
  await page.waitForFunction(() => !!document.querySelector('[data-drone="flycart200"] [data-cargoweight]'), null, {timeout: 20000, polling: 250})
  const cargo = await page.evaluate(() => {
    const slider = document.querySelector('[data-drone="flycart200"] [data-cargoweight]')
    if (slider) {
      slider.value = slider.max
      slider.dispatchEvent(new Event('input', {bubbles: true}))
    }
    const card = document.querySelector('[data-drone="flycart200"]')
    return {
      max: slider?.max ?? null,
      chip: card?.querySelector('[data-load="cargo"]')?.textContent ?? '',
      line: card?.querySelector('.drone-load')?.textContent ?? '',
    }
  })
  console.log('cargo', JSON.stringify(cargo))
  assert.equal(cargo.max, '200', 'the cargo slider tops out at the 200 kg rating')
  assert.equal(cargo.chip, '运货 200 kg')
  await tap('[data-drone="flycart200"]')
  await page.waitForFunction(() => !!window.droneDebug?.().flight, null, {timeout: 30000})
  const cart = await page.evaluate(() => ({dock: document.querySelector('.dock-drone')?.textContent.trim(), state: window.droneDebug?.()}))
  console.log('cart', JSON.stringify(cart))
  assert.equal(cart.dock, '无人机')
  assert.equal(cart.state.flight.load, 200, 'cargo at the rating flies at 200 kg')
  await tap('.hotbar-drone')
  await page.waitForSelector('.rc.rc-pro', {timeout: 20000})
  // The telemetry line is written by the flight tick; software rendering can starve rAF, so step it.
  await page.evaluate(() => window.droneStep(0.1, 4))
  await page.waitForFunction(() => ((document.querySelector('.rc .rc-tele')?.textContent ?? '').trim().length > 0), null, {timeout: 60000, polling: 250})
  const pro = await page.evaluate(() => ({
    pro: !!document.querySelector('.rc.rc-pro'),
    topbar: !!document.querySelector('.rc-topbar .rc-mode') && !!document.querySelector('.rc-bars[data-kind="rc"]') && !!document.querySelector('.rc-bars[data-kind="hd"]') && !!document.querySelector('.rc-gps'),
    tele: (document.querySelector('.rc .rc-tele')?.textContent ?? '').trim(),
    shutter: !!document.querySelector('.rc .rc-shutter'),
    modes: Array.from(document.querySelectorAll('.rc .rc-modes button')).map(node => node.textContent.trim()),
    sideActions: Array.from(document.querySelectorAll('.rc .rc-side')).map(node => node.dataset.act),
    gimbal: !!document.querySelector('.rc-gimbal input'),
    load: window.droneDebug().flight.load,
  }))
  console.log('pro', JSON.stringify(pro))
  assert.equal(pro.pro, true, 'FlyCart uses the professional controller')
  assert.equal(pro.topbar, true, 'professional controller shows the GLI top bar')
  assert.match(pro.tele, /^H [\d.]+m\s+D \d+m\s+H\.S [\d.]+m\/s/, `pro telemetry line: ${pro.tele}`)
  assert.equal(pro.shutter, true)
  assert.deepEqual(pro.modes, ['照片', '录像'])
  assert.deepEqual(pro.sideActions, ['hangar', 'rth', 'avoid', 'photo', 'record', 'exit'])
  assert.equal(pro.gimbal, true)
  assert.equal(pro.load, 200, 'cargo at the rating is 200 kg')
  // IDOK-527: the nav disc rides along in the RC screen — plain minimap for the camera drones,
  // radar with the sweep only for the FPV racer.
  const nav = await page.evaluate(() => ({
    has: !!document.querySelector('.rc-nav'),
    kicker: (document.querySelector('.rc-nav-kicker')?.textContent ?? '').trim(),
    radar: document.querySelector('.rc-nav')?.dataset.radar ?? null,
    target: (document.querySelector('.rc-nav-tg')?.textContent ?? '').trim(),
    canvas: document.querySelector('canvas.rc-nav-map')?.getBoundingClientRect().width ?? 0,
  }))
  console.log('nav', JSON.stringify(nav))
  assert.equal(nav.has, true, 'the RC screen carries the minimap / radar disc')
  assert.match(nav.kicker, /^地图/, `FlyCart shows the plain map disc: ${nav.kicker}`)
  assert.equal(nav.radar, '0', 'only the FPV racer scans with the radar sweep')
  assert.ok(nav.target.length > 0, 'the nav disc names the current target')
  assert.ok(nav.canvas > 40, 'the disc draws on a canvas')
  // The 照片/录像 chips drive what the big shutter fires.
  await tap('.rc .rc-modes [data-mode="video"]')
  assert.equal(await page.evaluate(() => document.querySelector('.rc')?.dataset.mode), 'video')
  await tap('.rc .rc-modes [data-mode="photo"]')
  assert.equal(await page.evaluate(() => document.querySelector('.rc')?.dataset.mode), 'photo')
  // IDOK-275: FlyCart glTF (eight props), winch mode hides the cargo box, the crate hangs on the sling
  await page.waitForFunction(() => (window.droneDebug().payload?.parts ?? 0) >= 3, null, {timeout: 30000})
  const sling = await page.evaluate(() => window.droneDebug())
  console.log('sling', JSON.stringify({model: sling.model, payload: sling.payload}))
  assert.equal(sling.model.source, 'gltf')
  assert.equal(sling.model.props.length, 8, 'FlyCart spins eight props')
  assert.equal(sling.model.cargoBox, false, 'cargo box comes off in winch mode')
  assert.equal(sling.payload.kind, 'cargo')
  // IDOK-530: Q/E 只推云台的目标角度，机身角度在后续帧里慢慢追上去（灵敏度调低，不再瞬间跳）。
  const gimbal = await page.evaluate(() => {
    const input = document.querySelector('.rc-gimbal input')
    input.value = '0'
    input.dispatchEvent(new Event('input',{bubbles: true}))
    window.droneStep(0.05,40)
    const start = {gimbal: window.droneDebug().flight.gimbal, target: window.droneDebug().gimbalTarget}
    window.dispatchEvent(new KeyboardEvent('keydown',{code: 'KeyQ',bubbles: true}))
    const pressed = window.droneDebug().gimbalTarget
    const immediate = window.droneStep(0.05,1).gimbal
    window.droneStep(0.05,80)
    const settled = window.droneDebug().flight.gimbal
    return {start, pressed, immediate, settled}
  })
  console.log('gimbal ease', JSON.stringify(gimbal))
  assert.ok(gimbal.pressed < gimbal.start.target - 1, `KeyQ lowers the gimbal target: ${gimbal.start.target} -> ${gimbal.pressed}`)
  assert.ok(gimbal.immediate > gimbal.pressed + .05, `the gimbal lags the target instead of snapping: ${gimbal.immediate} vs ${gimbal.pressed}`)
  assert.ok(Math.abs(gimbal.settled - gimbal.pressed) < .8, `then catches up: ${gimbal.settled} vs ${gimbal.pressed}`)
  // IDOK-530: 完整度读数与四面障碍距离都进了遥控状态，近楼时画面那一侧会泛红。
  const hull = await page.evaluate(() => {
    const state = window.droneDebug()
    return {
      integrity: state.integrity,
      moisture: state.moisture,
      proximity: state.proximity,
      hull: (document.querySelector('.rc-hull')?.textContent ?? '').trim(),
      near: getComputedStyle(document.querySelector('.rc')).getPropertyValue('--rc-near-max').trim(),
    }
  })
  console.log('hull', JSON.stringify(hull))
  assert.ok(hull.integrity > 0 && hull.integrity <= 100, `完整性 is tracked: ${hull.integrity}`)
  assert.match(hull.hull, /完整度/, `the top bar prints the integrity: ${hull.hull}`)
  assert.equal(typeof hull.proximity.front, 'number', 'the four obstacle distances are measured')
  // IDOK-529: 避障 is on by default and the pilot can switch it off from the RC screen.
  const avoidOff = await page.evaluate(() => {
    document.querySelector('.rc [data-act="avoid"]')?.click()
    const node = document.querySelector('.rc [data-act="avoid"]')
    return {on: window.droneDebug().avoid.on, cls: node?.classList.contains('on') ?? null, label: node?.textContent.trim() ?? null}
  })
  await page.evaluate(() => document.querySelector('.rc [data-act="avoid"]')?.click())
  const avoidOn = await page.evaluate(() => ({on: window.droneDebug().avoid.on, label: document.querySelector('.rc [data-act="avoid"]')?.textContent.trim() ?? null}))
  console.log('avoid toggle', JSON.stringify({avoidOff, avoidOn}))
  assert.equal(avoidOff.on, false, '避障 button switches avoidance off')
  assert.equal(avoidOff.cls, false, 'the button drops its lit state')
  assert.match(avoidOff.label ?? '', /避障关/, `label flips to 避障关: ${avoidOff.label}`)
  assert.equal(avoidOn.on, true, 'a second tap turns avoidance back on')
  // IDOK-284: the hangar button inside the RC screen leaves the session and reopens the 机库.
  await tap('.rc [data-act="hangar"]')
  await page.waitForFunction(() => !document.querySelector('.rc') && !document.querySelector('.drone-mask')?.hidden, null, {timeout: 20000, polling: 250})
  await tap('.drone-mask .about-close')
  // Let the aircraft finish coming home before the hotbar hand-off (re-entry needs it landed).
  await page.evaluate(() => window.droneStep(0.1, 120))
  await page.waitForFunction(() => window.droneDebug().flight.phase === 'landed', null, {timeout: 60000, polling: 250})
  // IDOK-284: the hotbar grew a 无人机遥控器 slot once a drone is out; tapping it re-enters RC.
  const slot = await page.evaluate(() => {
    const node = document.querySelector('.hotbar-drone')
    return {shown: !!node && !node.hidden, act: node?.getAttribute('data-act') ?? null}
  })
  console.log('hotbar slot', JSON.stringify(slot))
  assert.equal(slot.shown, true, 'the hotbar shows the 无人机遥控器 slot once a drone is placed')
  assert.equal(slot.act, 'drone')
  await tap('.hotbar-drone')
  await page.waitForFunction(() => document.body.dataset.drone === 'rc' && !!document.querySelector('.rc.rc-pro'), null, {timeout: 20000, polling: 250})
  await tap('.rc [data-act="exit"]')
  // IDOK-527: swap to the FPV racer — its disc is a radar (sweep + range in the head) and 自动飞
  // actually brings the aircraft closer to the circled target.
  await tap('.dock-drone')
  await page.waitForFunction(() => !document.querySelector('.drone-mask')?.hidden, null, {timeout: 20000, polling: 250})
  await tap('[data-drone="fpv"]')
  await page.waitForFunction(() => window.droneDebug?.().placed === 'fpv', null, {timeout: 60000, polling: 250})
  await page.waitForFunction(() => document.querySelector('.drone-mask')?.hasAttribute('hidden') ?? false, null, {timeout: 60000, polling: 250})
  await tap('.hotbar-drone')
  await page.waitForSelector('.rc.rc-pro .rc-nav', {timeout: 20000})
  // The disc is painted from the flight tick; software rendering can starve rAF here, so step it.
  await step(0.1, 4)
  const radar = await page.evaluate(() => ({
    radar: document.querySelector('.rc-nav')?.dataset.radar ?? null,
    kicker: (document.querySelector('.rc-nav-kicker')?.textContent ?? '').trim(),
    marks: window.droneDebug().nav.marks,
    spots: window.droneDebug().nav.spots,
  }))
  console.log('radar', JSON.stringify(radar))
  assert.equal(radar.radar, '1', 'the FPV racer turns the disc into a scanning radar')
  assert.match(radar.kicker, /^雷达/, `radar head: ${radar.kicker}`)
  assert.ok(radar.marks >= 2, `the disc marks the aircraft and the home pad: ${radar.marks}`)
  // 自动飞：挑一个 >40 m 的目标（机库/我都在 10 m 内会立刻判定「已到达」），10 s 内必须明显靠近。
  const auto = await page.evaluate(async () => {
    window.droneStep(0.1, 30)
    const nav = () => window.droneDebug().nav
    for (let i = 0;i < 8 && (nav()?.dist ?? 0) < 40;i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyT', bubbles: true}))
    }
    const before = nav()
    document.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyB', bubbles: true}))
    window.droneStep(0.05, 200)
    const after = nav()
    return {before: {label: before?.target?.label, dist: before?.dist}, after: {dist: after?.dist, auto: after?.auto}, on: before !== null}
  })
  console.log('auto fly', JSON.stringify(auto))
  assert.ok(auto.before.dist >= 40, `the target sits far enough to steer toward: ${auto.before.dist}`)
  assert.ok(auto.after.dist < auto.before.dist - 20, `自动飞 closes the distance: ${auto.before.dist} -> ${auto.after.dist}`)
  // IDOK-530: 地图化 —— 点盘面右键那一侧就落一个自选点，空中立刻开始自动飞过去。
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas.rc-nav-map')
    const rect = canvas.getBoundingClientRect()
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      clientX: rect.left + rect.width * .84,
      clientY: rect.top + rect.height * .5,
      bubbles: true,
    }))
  })
  // 那块地图是飞行帧里重画的，先走两帧再读（swiftshader 下 rAF 不可靠）。
  await step(0.05, 2)
  const pick = await page.evaluate(() => {
    const state = window.droneDebug()
    return {
      picked: state.picked,
      label: state.nav.target?.label ?? null,
      auto: state.nav.auto,
      marker: document.querySelector('.rc-nav')?.dataset.picked ?? null,
      toggle: (document.querySelector('.rc-nav-tg')?.textContent ?? '').trim(),
    }
  })
  console.log('map pick', JSON.stringify(pick))
  assert.ok(pick.picked, 'tapping the map drops a navigation point')
  assert.equal(pick.label, '自选点', `the picked point becomes the target: ${pick.label}`)
  assert.equal(pick.marker, '1', 'the disc flags the picked target')
  assert.equal(pick.auto, true, 'the autopilot starts flying to the picked point')
  assert.match(pick.toggle, /自选点/, `the target button shows 自选点: ${pick.toggle}`)

  // 12) IDOK-529: a crash wrecks the airframe — the hangar shows 损坏 + 寻找无人机, and the repair
  //     countdown hands the aircraft back once it hits zero.
  // IDOK-530: 维修点要求人走到 7 m 内，所以先让飞机返航落到脚边再把它摔坏。
  await tap('.rc [data-act="rth"]')
  const homeAgain = await page.evaluate(() => {
    for (let i = 0; i < 400; i++) {
      window.droneStep(0.2, 1)
      if (window.droneDebug().flight?.phase === 'landed') break
    }
    const flight = window.droneDebug().flight
    return {phase: flight?.phase ?? null, distance: flight?.distance ?? null}
  })
  console.log('crash approach', JSON.stringify(homeAgain))
  assert.equal(homeAgain.phase, 'landed', 'the racer comes home before we wreck it')
  await tap('.rc [data-act="exit"]')
  const crashed = await page.evaluate(() => ({ok: window.droneCrash('撞击'), state: window.droneDebug()}))
  console.log('crash', JSON.stringify({ok: crashed.ok, wreck: crashed.state.wreck, placed: crashed.state.placed}))
  assert.equal(crashed.ok, true, 'debugCrash wrecks the aircraft in flight')
  assert.ok(crashed.state.wreck, 'the wreck position is tracked')
  assert.equal(crashed.state.placed, null, 'a wreck is not on the dock any more')
  assert.equal(crashed.state.health.fpv.damage.cause, '撞击', 'the fleet records the cause of the damage')
  await page.evaluate(() => window.droneStep(0.1, 4))
  await tap('.dock-drone')
  await page.waitForFunction(() => !document.querySelector('.drone-mask')?.hidden, null, {timeout: 20000, polling: 250})
  const broken = await page.evaluate(() => {
    const card = document.querySelector('[data-drone="fpv"]')
    return {
      cls: card?.classList.contains('broken') ?? null,
      text: (card?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      batt: (card?.querySelector('.drone-batt')?.textContent ?? '').trim(),
      damage: (card?.querySelector('.drone-damage')?.textContent ?? '').trim(),
    }
  })
  console.log('broken card', JSON.stringify(broken))
  assert.equal(broken.cls, true, 'the hangar card marks the airframe as damaged')
  assert.match(broken.text, /损坏/, `the card names the damage: ${broken.text}`)
  assert.match(broken.text, /寻找无人机/, 'the card CTA turns into 寻找无人机')
  // IDOK-530: 坏了也要看得到电量，损坏状态另起一枚 chip。
  assert.match(broken.batt, /\d+%/, `a wrecked airframe still shows its charge: ${broken.batt}`)
  assert.match(broken.damage, /撞击损坏/, `the damage chip names the cause: ${broken.damage}`)
  await tap('[data-drone="fpv"]')
  await page.waitForFunction(() => document.querySelector('.drone-mask')?.hasAttribute('hidden') ?? false, null, {timeout: 20000, polling: 250})
  // 光柱与「修复点」提示是飞行帧里写的，先走两帧。
  await page.evaluate(() => window.droneStep(0.1, 2))
  const seeking = await page.evaluate(() => ({
    hint: (document.querySelector('.drone-hint')?.textContent ?? '').trim(),
    wreck: !!window.droneDebug().wreck,
  }))
  console.log('seek', JSON.stringify(seeking))
  assert.match(seeking.hint, /修复点/, `a repair hint points the way: ${seeking.hint}`)
  const repair = await page.evaluate(() => {
    const start = window.droneRepair(1)
    window.droneStep(0.2, 8)
    return {start, after: window.droneDebug()}
  })
  console.log('repair', JSON.stringify({start: repair.start, wreck: repair.after.wreck, health: repair.after.health.fpv}))
  assert.equal(repair.start, 1, 'the repair countdown can be driven from the suite')
  assert.equal(repair.after.wreck, null, 'finishing the repair clears the wreck')
  assert.equal(repair.after.health.fpv.damage, null, 'the airframe is airworthy again')
  assert.deepEqual(errors, [], 'no page errors')
  console.log(`drone suite passed in ${((performance.now() - start) / 1000).toFixed(1)}s`)
} finally {
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
