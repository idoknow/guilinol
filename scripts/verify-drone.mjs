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
  await page.waitForFunction(() => window.viewer?.walk?.active, null, {timeout: 120000})
  // The drone entry lives behind the dock's 工具 menu (web/src/play/index.ts builds .dock-buttons
  // collapsed), so open it before asserting that the button is really on screen.
  await page.waitForSelector('.dock-more', {state: 'attached', timeout: 120000})
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
    await page.waitForSelector(selector, {state: 'attached', timeout: 20000})
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
  assert.equal(hangar.cards, 5, 'five aircraft')
  assert.deepEqual(hangar.names, ['DJI Mavic 4 Pro','DJI Mini 5 Pro','DJI Air 3S','DJI FPV 穿越机','DJI FlyCart 200'])
  assert.equal(hangar.loads, 4, 'FlyCart exposes four load presets')
  // IDOK-529: every card carries its own battery/repair line.
  assert.equal(hangar.batt, 5, 'each aircraft shows a battery chip')
  assert.match(hangar.battText.join(' '), /\d+%|充电中/, `battery chips render: ${hangar.battText.join(' / ')}`)

  // 2) place the Mini 5 Pro
  await tap('[data-drone="mini5pro"]')
  await page.waitForFunction(() => !!window.droneDebug?.().flight, null, {timeout: 30000})
  const placed = await page.evaluate(() => ({
    dock: document.querySelector('.dock-drone')?.textContent.trim(),
    hint: document.querySelector('.drone-hint')?.textContent.trim() ?? null,
    state: window.droneDebug?.(),
  }))
  console.log('placed', JSON.stringify(placed))
  // IDOK-529: the dock entry always opens the hangar, so aircraft can be swapped mid-session.
  assert.equal(placed.dock, '无人机', 'the dock entry stays a hangar button')
  assert.equal(placed.state.mesh, 'drone-mini5pro', 'mesh added to the scene')
  assert.match(placed.hint ?? '', /Mini 5 Pro|无人机就位/)
  // IDOK-275: the glTF replaces the procedural mesh and keeps the animated node names
  assert.equal(placed.state.model.source, 'gltf', 'public/models/drones/mini5pro.glb is loaded')
  assert.deepEqual(placed.state.model.props, ['prop_1','prop_2','prop_3','prop_4'])
  assert.deepEqual([placed.state.model.gimbal, placed.state.model.lens, placed.state.model.gear], ['gimbal','lens','gear'])

  // 3) takeoff -> RC view: the hotbar slot is the only way in now (IDOK-529)
  await tap('.hotbar-drone')
  await page.waitForSelector('.rc.rc-simple', {timeout: 20000})
  await page.waitForFunction(() => document.body.dataset.drone === 'rc', null, {timeout: 20000})
  const rcUp = await page.evaluate(() => ({
    simple: !!document.querySelector('.rc.rc-simple'),
    buttons: [...document.querySelectorAll('.rc [data-act]')].map(node => node.textContent.trim()),
    sticks: document.querySelectorAll('.rc .rc-stick').length,
    dockHidden: getComputedStyle(document.querySelector('.dock')).display === 'none',
    readout: document.querySelector('.rc .rc-readout')?.textContent.trim(),
  }))
  console.log('rc', JSON.stringify(rcUp))
  assert.equal(rcUp.simple, true, 'Mini 5 Pro uses the simple controller')
  assert.equal(rcUp.sticks, 2, 'two touch sticks')
  assert.equal(rcUp.dockHidden, true, 'dock yields to the RC overlay')

  // 4) takeoff climbs into the flying phase — stepped, because software rendering here can drop to
  //    a frame every few seconds and the model would otherwise stall between assertions.
  const step = (dt = 0.1, repeats = 10) => page.evaluate(([a,b]) => window.droneStep(a,b), [dt, repeats])
  const climb = await step(0.1, 40)
  console.log('climb', JSON.stringify(climb))
  assert.equal(climb.phase, 'flying', 'aircraft reaches the flying phase')
  assert.ok(climb.agl > 1.4, 'aircraft climbs after 起飞')
  await page.waitForFunction(() => (document.querySelector('.rc .rc-readout')?.textContent ?? '').trim().length > 0, null, {timeout: 30000})
  const readout = await page.evaluate(() => document.querySelector('.rc .rc-readout').textContent.trim())
  console.log('readout', JSON.stringify(readout))

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

  // IDOK-284: the simple controller has no look stick; dragging the empty screen turns the camera.
  const pad = await page.evaluate(() => {
    const layer = document.querySelector('.rc-look')
    if (!layer) return null
    const rect = layer.getBoundingClientRect()
    const x = rect.x + rect.width / 2
    const y = rect.y + rect.height / 2
    return {x, y, hit: document.elementFromPoint(x, y)?.className ?? null}
  })
  assert.ok(pad, 'the simple controller has a drag-look layer')
  assert.match(pad.hit ?? '', /rc-look/, `the middle of the screen is the drag-look layer (${pad.hit})`)
  await page.mouse.move(pad.x, pad.y)
  await page.mouse.down()
  await page.mouse.move(pad.x - 90, pad.y + 40, {steps: 4})
  const during = await page.evaluate(() => ({flag: document.querySelector('.rc')?.dataset.look ?? null, look: window.droneDebug().look}))
  await page.mouse.up()
  const released = await page.evaluate(() => ({flag: document.querySelector('.rc')?.dataset.look ?? null, look: window.droneDebug().look}))
  console.log('drag look', JSON.stringify({during, released}))
  assert.equal(during.flag, '1', 'dragging flags the look layer')
  assert.equal(released.flag, null, 'releasing clears the drag flag')
  assert.ok(during.look.yaw > 0.1, `dragging left turns the camera right (yaw ${during.look.yaw})`)

  // 7) photo
  await tap('.rc [data-act="photo"]')
  await page.waitForFunction(() => !!window.lastDronePhoto, null, {timeout: 40000})
  const shot = await page.evaluate(() => window.lastDronePhoto)
  console.log('photo', JSON.stringify(shot))
  assert.ok(shot.width >= 1200 && shot.height >= 600, 'aerial photo is big')
  assert.ok(shot.bytes > 20000, 'aerial photo has pixels')

  // 8) record
  await tap('.rc [data-act="record"]')
  await page.waitForFunction(() => !!document.querySelector('.rc [data-act="record"].live'), null, {timeout: 20000})
  await step(0.1, 10)
  await page.waitForTimeout(600)
  await tap('.rc [data-act="record"]')
  // 和相机套件同样的双路径：要么出片（window.lastDroneClip），要么诚实提示「录不出画面」
  // （本机无头环境在 720p 上编码器常常只回调 size 0 的数据，属环境限制）。
  await page.waitForFunction(
    () => !!window.lastDroneClip || /录不出画面/.test(document.body.textContent ?? ''),
    null,
    {timeout: 90000},
  )
  const clip = await page.evaluate(() => window.lastDroneClip ?? null)
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

  // 10) exit
  await tap('.rc [data-act="exit"]')
  await page.waitForFunction(() => document.body.dataset.drone === undefined && !document.querySelector('.rc'), null, {timeout: 20000})
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
  await page.waitForFunction(() => !!document.querySelector('[data-drone="flycart200"] [data-cargoweight]'), null, {timeout: 20000})
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
  await page.waitForFunction(() => ((document.querySelector('.rc .rc-tele')?.textContent ?? '').trim().length > 0), null, {timeout: 60000})
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
  assert.equal(pro.topbar, true, 'professional controller shows the DJI top bar')
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
  assert.match(nav.kicker, /^小地图/, `FlyCart shows the plain minimap: ${nav.kicker}`)
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
  // IDOK-284: Q/E tilt the gimbal from the keyboard without touching the slider.
  const gimbalStart = await page.evaluate(() => {
    const input = document.querySelector('.rc-gimbal input')
    input.value = '0'
    input.dispatchEvent(new Event('input', {bubbles: true}))
    return window.droneDebug().flight.gimbal
  })
  await page.keyboard.press('KeyQ')
  const gimbalDown = await page.evaluate(() => window.droneDebug().flight.gimbal)
  await page.keyboard.press('KeyE')
  const gimbalBack = await page.evaluate(() => window.droneDebug().flight.gimbal)
  console.log('gimbal keys', JSON.stringify({gimbalStart, gimbalDown, gimbalBack}))
  assert.equal(gimbalDown, gimbalStart - 3, 'KeyQ tilts the gimbal down 3°')
  assert.equal(gimbalBack, gimbalStart, 'KeyE tilts it back')
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
  await page.waitForFunction(() => !document.querySelector('.rc') && !document.querySelector('.drone-mask')?.hidden, null, {timeout: 20000})
  await tap('.drone-mask .about-close')
  // Let the aircraft finish coming home before the hotbar hand-off (re-entry needs it landed).
  await page.evaluate(() => window.droneStep(0.1, 120))
  await page.waitForFunction(() => window.droneDebug().flight.phase === 'landed', null, {timeout: 60000})
  // IDOK-284: the hotbar grew a 无人机遥控器 slot once a drone is out; tapping it re-enters RC.
  const slot = await page.evaluate(() => {
    const node = document.querySelector('.hotbar-drone')
    return {shown: !!node && !node.hidden, act: node?.getAttribute('data-act') ?? null}
  })
  console.log('hotbar slot', JSON.stringify(slot))
  assert.equal(slot.shown, true, 'the hotbar shows the 无人机遥控器 slot once a drone is placed')
  assert.equal(slot.act, 'drone')
  await tap('.hotbar-drone')
  await page.waitForFunction(() => document.body.dataset.drone === 'rc' && !!document.querySelector('.rc.rc-pro'), null, {timeout: 20000})
  await tap('.rc [data-act="exit"]')
  // IDOK-527: swap to the FPV racer — its disc is a radar (sweep + range in the head) and 自动飞
  // actually brings the aircraft closer to the circled target.
  await tap('.dock-drone')
  await page.waitForFunction(() => !document.querySelector('.drone-mask')?.hidden, null, {timeout: 20000})
  await tap('[data-drone="fpv"]')
  await page.waitForFunction(() => window.droneDebug?.().placed === 'fpv', null, {timeout: 60000})
  await page.waitForFunction(() => document.querySelector('.drone-mask')?.hasAttribute('hidden') ?? false, null, {timeout: 60000})
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
  await tap('.rc [data-act="exit"]')

  // 12) IDOK-529: a crash wrecks the airframe — the hangar shows 损坏 + 寻找无人机, and the repair
  //     countdown hands the aircraft back once it hits zero.
  const crashed = await page.evaluate(() => ({ok: window.droneCrash('撞击'), state: window.droneDebug()}))
  console.log('crash', JSON.stringify({ok: crashed.ok, wreck: crashed.state.wreck, placed: crashed.state.placed}))
  assert.equal(crashed.ok, true, 'debugCrash wrecks the aircraft in flight')
  assert.ok(crashed.state.wreck, 'the wreck position is tracked')
  assert.equal(crashed.state.placed, null, 'a wreck is not on the dock any more')
  assert.equal(crashed.state.health.fpv.damage.cause, '撞击', 'the fleet records the cause of the damage')
  await page.evaluate(() => window.droneStep(0.1, 4))
  await tap('.dock-drone')
  await page.waitForFunction(() => !document.querySelector('.drone-mask')?.hidden, null, {timeout: 20000})
  const broken = await page.evaluate(() => {
    const card = document.querySelector('[data-drone="fpv"]')
    return {cls: card?.classList.contains('broken') ?? null, text: (card?.textContent ?? '').replace(/\s+/g, ' ').trim()}
  })
  console.log('broken card', JSON.stringify(broken))
  assert.equal(broken.cls, true, 'the hangar card marks the airframe as damaged')
  assert.match(broken.text, /损坏/, `the card names the damage: ${broken.text}`)
  assert.match(broken.text, /寻找无人机/, 'the card CTA turns into 寻找无人机')
  await tap('[data-drone="fpv"]')
  await page.waitForFunction(() => document.querySelector('.drone-mask')?.hasAttribute('hidden') ?? false, null, {timeout: 20000})
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
