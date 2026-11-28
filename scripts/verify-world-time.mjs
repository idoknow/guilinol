// IDOK-502 全服统一时间：多客户端一致性验收。
//
// 两个无头客户端跑同一份生产代码，但故意让其中一台的**本机时钟偏差 37 分钟**（模拟设备时间不准），
// 两台都只从 `/api/health` 的 `now` 校时。断言：
//   1. 两台渲染的小时与全服权威小时一致（容差见 HOUR_TOLERANCE_MIN）；
//   2. 设备时间不准的那台也能被拉回来（`source === 'server'`），且两台归一化后几乎相等；
//   3. 断线重连（offline → online）会重新校时，误差不扩大；
//   4. 拍照模式是本地预览，关掉相机交回全服时间；
//   5. 关掉接口（离线兜底）时不报错，退回 `source === 'local'` 且仍是同一套确定性映射。
//
// 注意：每次读取都用快照自带的 `now` 算权威小时，而不是测试进程的 Date.now()——一台在软件渲染下
// 只有 1 FPS 的无头页，`evaluate` 往返可能有几秒，用测试侧时间戳会把往返延迟误判成时钟漂移。
//
// Run: npm run build && node scripts/verify-world-time.mjs
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'
import {hourAt, weatherAt} from '../lib/world-time.ts'

const OUT = 'captures/world-time'
/**
 * 允许的渲染滞后，单位是**游戏分钟**。1 游戏小时 = 1 现实分钟，所以 1 游戏分钟只有 1 真实秒——
 * 这个容差覆盖的是"取快照 → 断言"之间的往返、首帧渲染和 0.6 秒追赶时间常数，不是时钟误差。
 * 参照系：若不做校时，37 分钟的设备时钟偏差会在这里显示成 2220 游戏分钟的偏差。
 */
const HOUR_TOLERANCE_MIN = 6
/** 第二台设备的本机时钟故意快 37 分钟。 */
const SKEW_MS = 37 * 60_000

const site = await preview({root:'web', configFile:'web/vite.config.ts', preview:{port:0, host:'127.0.0.1'}})
const origin = 'http://127.0.0.1:' + site.httpServer.address().port
const browser = await chromium.launch({...browserOptions(), args:[...browserOptions().args, '--disable-renderer-backgrounding']})
const errors = []
let healthHits = 0

/** 软件渲染下主线程被流式加载占满，Playwright 的 rAF 轮询会长时间挤不进去，统一用定时器轮询。 */
const POLL = {timeout:180000, polling:500}

async function open({name, skewMs = 0, offline = false, needWalk = true}) {
  const page = await browser.newPage({viewport:{width:480, height:270}})
  page.on('pageerror', error => errors.push(`${name}: ${error.message}`))
  page.on('console', message => {
    // 只收脚本错误：「Failed to load resource」是网络层的 4xx/5xx（这里 /api/t 遥测本来就没有后端，
    // 离线兜底那台还故意让 /api/health 返回 503），不属于被验证的客户端行为。
    if(message.type() !== 'error' || /Failed to load resource/i.test(message.text())) return
    errors.push(`${name}: ${message.text()}`)
  })
  if(skewMs) await page.addInitScript(ms => {
    // 只改 Date.now（世界时钟的兜底来源），不碰 performance.now（渲染与帧率不该被这条测试影响）。
    const real = Date.now.bind(Date)
    Date.now = () => real() + ms
  }, skewMs)
  await page.route('**/api/me', route => route.fulfill({json:{id:name, uid:name.length, nickname:name, verified:true}}))
  await page.route('**/api/rt/ticket', route => route.fulfill({json:{ticket:'world-time-fixture'}}))
  await page.route('**/api/health', route => {
    healthHits++
    return offline ? route.fulfill({status:503, json:{ok:false}}) : route.fulfill({json:{ok:true, now:Date.now()}})
  })
  // 联机服本身与时钟无关，回一个最小 welcome 让联机客户端走完握手。
  await page.routeWebSocket('**/ws', connection => {
    connection.onMessage(raw => {
      const msg = JSON.parse(raw)
      if(msg.t === 'join') connection.send(JSON.stringify({t:'welcome', me:{id:name, uid:1, name}, players:[], online:1}))
    })
  })
  // `?worldtime=1` 让 `?verify` 链接也走全服时钟：默认的 `?verify` 仍然是固定的 10:00，保证既有截图门禁可复现。
  await page.goto(`${origin}/?verify&worldtime=1&mode=walk&mp=1`, {waitUntil:'domcontentloaded'})
  await page.waitForFunction(() => !!window.viewer?.worldClock && Number.isFinite(window.viewer.clock.hour), null, POLL)
  if(needWalk) await page.waitForFunction(() => window.viewer.walk?.active === true, null, POLL)
  return page
}

/** 读一次快照，顺便带上它自己的服务端时刻。 */
const read = page => page.evaluate(() => {
  const snapshot = window.viewer.worldClock()
  return {...snapshot, authorityNow: snapshot.now}
})

/** 与全服权威小时的差（游戏分钟，取环形最短距离）。 */
function driftMinutes(snapshot) {
  const delta = Math.abs(snapshot.hour - hourAt(snapshot.authorityNow))
  return Math.min(delta, 24 - delta) * 60
}

/** 环形最短差值（小时）。 */
const shortest = (a, b) => { const delta = Math.abs(a - b) % 24; return Math.min(delta, 24 - delta) }

/**
 * 把页面切到前台再等它收敛。后台标签页的 rAF 会被浏览器暂停，此时小时不会追赶——这是正常的
 * （玩家看不见后台页面），但验收必须先让它真的在渲染。
 */
async function syncedRead(page) {
  await page.bringToFront()
  await page.waitForFunction(tolerance => {
    window.__shortest = (a, b) => { const delta = Math.abs(a - b) % 24; return Math.min(delta, 24 - delta) }
    const snapshot = window.viewer.worldClock()
    return snapshot.source === 'server' && window.__shortest(snapshot.hour, snapshot.targetHour) * 60 < tolerance
  }, HOUR_TOLERANCE_MIN, {timeout:60000, polling:250})
  return read(page)
}

try {
  await mkdir(OUT, {recursive:true})
  const alice = await open({name:'alice'})
  const bob = await open({name:'bob', skewMs:SKEW_MS})

  // 校准最多等 30 秒（一次 /api/health 往返 + 页面加载）。
  for(const page of [alice, bob])
    await page.waitForFunction(() => window.viewer.worldClock().source === 'server', null, {timeout:30000, polling:100})

  const a = await syncedRead(alice), b = await syncedRead(bob)
  for(const [label, snapshot] of [['alice', a], ['bob', b]]) {
    assert.equal(snapshot.source, 'server', `${label} 应当已对齐服务端时钟`)
    assert.equal(snapshot.local, false, `${label} 应当在全服时间线上，而不是本地预览`)
    assert.equal(snapshot.weather, weatherAt(snapshot.authorityNow), `${label} 的天气应当来自全服映射`)
    const drift = driftMinutes(snapshot)
    assert.ok(drift < HOUR_TOLERANCE_MIN, `${label} 与全服小时相差 ${drift.toFixed(2)} 游戏分钟`)
  }
  // 两台设备"同一时刻"的对比：按各自估算的服务端时刻把小时归一化，再比归一化后的残差。
  const residualA = a.hour - hourAt(a.authorityNow), residualB = b.hour - hourAt(b.authorityNow)
  const gap = shortest(residualA, residualB) * 60
  assert.ok(gap < HOUR_TOLERANCE_MIN, `两台设备相差 ${gap.toFixed(3)} 游戏分钟（本机时间差 37 分钟）`)
  console.log('同刻 hour A/B / 天气 / 归一化差(游戏分钟):', a.hour.toFixed(4), b.hour.toFixed(4), a.weather, gap.toFixed(4))

  // 断线重连：联机状态 offline → online 必须触发重新校时（CDN 掐断长连接后回来正是漂移最大的时候）。
  const hitsBefore = healthHits
  await bob.bringToFront()
  await bob.evaluate(() => {
    window.dispatchEvent(new CustomEvent('glol:mp-status', {detail:{state:'offline', online:0}}))
    window.dispatchEvent(new CustomEvent('glol:mp-status', {detail:{state:'online', online:1}}))
  })
  await bob.waitForFunction(() => window.viewer.worldClock().source === 'server', null, {timeout:30000, polling:100})
  // 等这次多出来的 /api/health 落下来（最多 10 秒）。
  const deadline = Date.now() + 10_000
  while(healthHits <= hitsBefore && Date.now() < deadline) await new Promise(done => setTimeout(done, 100))
  assert.ok(healthHits > hitsBefore, '重连后应当重新请求服务端时间')
  const after = await syncedRead(bob)
  const driftAfter = driftMinutes(after)
  assert.ok(driftAfter < HOUR_TOLERANCE_MIN, `重连后与全服小时相差 ${driftAfter.toFixed(2)} 游戏分钟`)
  assert.equal(after.source, 'server')
  console.log('断线重连：重新校时 / 误差(游戏分钟):', healthHits - hitsBefore, driftAfter.toFixed(3))

  // 拍照模式：本地预览可以拨时辰，关掉相机必须交回全服时间。
  // 直接调用 HUD 上「拍照」按钮的 onclick 处理器（工具菜单默认收起，pointer 事件在 1 FPS 的软件渲染下不稳，
  // 调用处理器走的仍是生产的 photo.open()/close()）。
  await bob.bringToFront()
  await bob.evaluate(() => document.querySelector('.dock-photo').onclick())
  await bob.waitForFunction(() => document.body.dataset.photo === 'on', null, {timeout:60000, polling:250})
  const preview = await read(bob)
  assert.equal(preview.local, true, '拍照模式应当是本地预览')
  // 拨到另一个时辰，确认预览真的生效。
  await bob.evaluate(() => window.viewer.clock.set(3.5))
  const moved = await read(bob)
  assert.equal(Math.round(moved.hour * 100), 350, '本地预览应当能拨到自己想要的时辰')
  await bob.evaluate(() => document.querySelector('.photo-exit').onclick())
  await bob.waitForFunction(() => !document.body.dataset.photo, null, {timeout:60000, polling:250})
  const restored = await syncedRead(bob)
  assert.equal(restored.local, false, '退出拍照必须交回全服时间')
  assert.ok(driftMinutes(restored) < HOUR_TOLERANCE_MIN, `退出拍照后与全服小时相差 ${driftMinutes(restored).toFixed(2)} 游戏分钟`)
  console.log('拍照本地预览 → 退出后回到全服:', preview.local, moved.hour.toFixed(2), restored.local, driftMinutes(restored).toFixed(3))

  await bob.screenshot({path:`${OUT}/client-synced.png`})

  // 旧的 `?verify` 锚点必须原样保留：裸 `?verify` 仍然是固定的 10:00 晴天，且不打 /api/health。
  const pinned = await browser.newPage({viewport:{width:480, height:270}})
  pinned.on('pageerror', error => errors.push(`pinned: ${error.message}`))
  const pinnedHealth = healthHits
  await pinned.route('**/api/me', route => route.fulfill({json:{id:'pinned', uid:9, nickname:'pinned', verified:true}}))
  await pinned.route('**/api/rt/ticket', route => route.fulfill({json:{ticket:'world-time-fixture'}}))
  await pinned.goto(`${origin}/?verify&mode=walk`, {waitUntil:'domcontentloaded'})
  await pinned.waitForFunction(() => Number.isFinite(window.viewer?.clock?.hour), null, POLL)
  const anchor = await pinned.evaluate(() => ({hour: window.viewer.clock.hour, weather: window.viewer.clock.weather,
    world: window.viewer.clock.world, source: window.viewer.worldClock().source}))
  assert.equal(anchor.hour, 10, '裸 ?verify 必须仍是 10:00 起点')
  assert.equal(anchor.weather, 'clear', '裸 ?verify 必须仍是晴天')
  assert.equal(anchor.world, false, '裸 ?verify 不跟全服时钟')
  assert.equal(pinnedHealth, healthHits, '裸 ?verify 不应打 /api/health')
  console.log('截图锚点 ?verify 仍固定:', anchor.hour, anchor.weather, anchor.source)
  await pinned.close()

  // 软件渲染下每个页面都占满主线程，先关掉前两台再开第三台，否则它拿不到帧、小时不会收敛。
  await alice.close(); await bob.close()

  // 离线兜底：接口不可用时不能报错，退回本机时钟但仍是同一套确定性映射。
  const offline = await open({name:'carol', offline:true, needWalk:false})
  await offline.bringToFront()
  await offline.waitForFunction(tolerance => {
    const shortestOf = (a, b) => { const delta = Math.abs(a - b) % 24; return Math.min(delta, 24 - delta) }
    const snapshot = window.viewer.worldClock()
    return snapshot.source === 'local' && shortestOf(snapshot.hour, snapshot.targetHour) * 60 < tolerance
  }, HOUR_TOLERANCE_MIN, {timeout:120000, polling:250})
  const fallback = await read(offline)
  assert.equal(fallback.source, 'local')
  assert.equal(fallback.local, false, '离线兜底仍然沿全服时间线走，只是用本机时钟推算')
  assert.ok(driftMinutes(fallback) < HOUR_TOLERANCE_MIN, '离线兜底的小时应当与本机时钟推算一致')
  console.log('离线兜底 hour / source:', fallback.hour.toFixed(4), fallback.source)

  assert.deepEqual(errors, [], JSON.stringify(errors))
  console.log('RESULT ok')
} finally {
  await browser.close()
  await site.close()
}
