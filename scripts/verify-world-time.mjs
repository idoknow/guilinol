// IDOK-502 全服统一时间：多客户端一致性验收（重写版）。
//
// 上一版的断言是假阳性：它拿客户端**自报**的 `snapshot.now` 当权威基准去比客户端自己渲染的
// `hour`，等于自比自——`offsetMs` 恒为 0 也会全绿（IDOK-502 审核 P0-6）。这一版改成：
//
//   1. **权威时间由测试进程给出**：`/api/health` 被拦成返回 `真实时刻 + SERVER_SKEW`，所以
//      "服务端几点"是测试进程侧算出来的外部真值，客户端完全无从自证。
//   2. **每台设备各有独立的 /api/health 计数器**（挂在页面上），不再共用一个全局变量，
//      "裸 ?verify 不打接口" 才真的可测。
//   3. bob 的本机时钟偏 37 分钟：若客户端没有真正校时，`bob.now` 会与真值差出 37 分钟，
//      `hour` 差出几十游戏小时——这种偏差不可能被"自比自"掩盖。
//
// 覆盖：同刻一致 / 本机时钟偏 37 分钟被拉回 / 联机重复上报不惊群 / offline→online 校时 /
// 拍照本地预览与退出 / 裸 ?verify 零请求（即使 localStorage['glol.mp']='1'）/ 深链也校时 /
// 离线兜底。
//
// Run: npm run build && node scripts/verify-world-time.mjs
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'
import {hourAt, weatherAt} from '../lib/world-time.ts'

const OUT = 'captures/world-time'
/** 服务端相对测试进程真实时钟的固定偏移：模拟"服务端时间才是对的"。 */
const SERVER_SKEW_MS = 10 * 60_000
/** bob 的本机时钟故意快 37 分钟。 */
const CLIENT_SKEW_MS = 37 * 60_000
/** 允许的渲染滞后（游戏分钟）。1 游戏小时 = 1 现实分钟 → 1 游戏分钟 = 1 真实秒。 */
const HOUR_TOLERANCE_MIN = 6
/** 时钟容差（真实毫秒）：覆盖取数往返与 rtt/2 补偿的余量。 */
const CLOCK_TOLERANCE_MS = 2_000

/** 测试进程侧算出的"服务端现在几点"，不经过任何客户端。 */
const serverNow = () => Date.now() + SERVER_SKEW_MS

const site = await preview({root:'web', configFile:'web/vite.config.ts', preview:{port:0, host:'127.0.0.1'}})
const origin = 'http://127.0.0.1:' + site.httpServer.address().port
const browserOptionsFull = () => ({...browserOptions(), args:[...browserOptions().args, '--disable-renderer-backgrounding']})
let browser = await chromium.launch(browserOptionsFull())
const errors = []
/** 每台设备自己的 /api/health 命中次数。 */
const healthHits = new Map()

const POLL = {timeout:180000, polling:500}

const shortest = (a, b) => { const delta = Math.abs(a - b) % 24; return Math.min(delta, 24 - delta) }

/**
 * 读一次快照，同时夹住 Node 侧的读区间 `[nodeBefore, nodeAfter]`。
 * 无头 SwiftShader 下 `page.evaluate` 往返可达数秒，只拿一个时间点硬比会把往返延迟误判成
 * 时钟漂移，所以判定标准是"客户端自报的 epoch 落在读区间内（含容差与区间宽度）"。
 * `local` 用于离线兜底：那台设备本来就该跟本机时钟走，不能拿加了服务端偏移的真值去比。
 */
async function read(page, {local = false} = {}) {
  const now = local ? () => Date.now() : serverNow
  const nodeBefore = now()
  const snapshot = await page.evaluate(() => ({...window.viewer.worldClock(), night: window.viewer.env.night}))
  const nodeAfter = now()
  return {...snapshot, nodeBefore, nodeAfter}
}

/** 越界偏差（ms）：落在读区间内记 0。 */
function clockErrorMs(snapshot) {
  const slack = CLOCK_TOLERANCE_MS + (snapshot.nodeAfter - snapshot.nodeBefore)
  if(snapshot.now < snapshot.nodeBefore - slack) return snapshot.now - snapshot.nodeBefore
  if(snapshot.now > snapshot.nodeAfter + slack) return snapshot.now - snapshot.nodeAfter
  return 0
}
/** 便于日志：越界量，或相对读区间中点的偏差。 */
function clockErrLabel(snapshot) {
  const error = clockErrorMs(snapshot)
  if(error) return Math.round(error)
  return Math.round(snapshot.now - (snapshot.nodeBefore + snapshot.nodeAfter) / 2)
}
/**
 * 渲染小时与权威小时的差（游戏分钟）。
 * 这里比 `targetHour`（客户端算出的全服小时）而不是 Node 侧时刻：Node 侧的 `page.evaluate` 往返
 * 在软件渲染下有几秒宽，拿区间中点比会把取数延迟算成渲染误差。客户端的 `targetHour` 本身已经
 * 被 `clockErrorMs` 用 Node 侧真值校验过了，所以两步合起来是完整的"外部真值 → 渲染结果"链条。
 */
function hourErrMin(snapshot) {
  return shortest(snapshot.hour, snapshot.targetHour) * 60
}

async function open({name, skewMs = 0, offline = false, mpPreference = false, query = 'verify&worldtime=1&mode=walk&mp=1&radius=192', needWalk = true}) {
  const page = await browser.newPage({viewport:{width:480, height:270}})
  // 软件渲染下同时加载两个世界的导航可能远超 30s 默认值。
  page.setDefaultNavigationTimeout(180000)
  healthHits.set(name, 0)
  page.on('pageerror', error => errors.push(`${name}: ${error.message}`))
  page.on('console', message => {
    // 「Failed to load resource」是网络层的 4xx/5xx（/api/t 遥测本来就没有后端，离线那台还故意让
    // /api/health 返回 503），不属于被验证的客户端行为。
    if(message.type() !== 'error' || /Failed to load resource/i.test(message.text())) return
    errors.push(`${name}: ${message.text()}`)
  })
  if(skewMs) await page.addInitScript(ms => {
    // 只改 Date.now（本机时钟/兜底来源），不碰 performance.now（单调时钟与帧率不该被影响）。
    const real = Date.now.bind(Date)
    Date.now = () => real() + ms
  }, skewMs)
  if(mpPreference) await page.addInitScript(() => localStorage.setItem('glol.mp', '1'))
  await page.route('**/api/me', route => route.fulfill({json:{id:name, uid:name.length, nickname:name, verified:true}}))
  await page.route('**/api/rt/ticket', route => route.fulfill({json:{ticket:'world-time-fixture'}}))
  await page.route('**/api/health', route => {
    healthHits.set(name, (healthHits.get(name) ?? 0) + 1)
    if(offline) return route.fulfill({status:503, json:{ok:false}})
    // 权威时刻 = 测试进程真实时间 + 固定服务端偏移；客户端只能靠校时才对得上。
    return route.fulfill({json:{ok:true, now:serverNow()}})
  })
  await page.routeWebSocket('**/ws', connection => {
    connection.onMessage(raw => {
      const msg = JSON.parse(raw)
      if(msg.t === 'join') connection.send(JSON.stringify({t:'welcome', me:{id:name, uid:1, name}, players:[], online:1}))
    })
  })
  await page.goto(`${origin}/?${query}`, {waitUntil:'domcontentloaded'})
  await page.waitForFunction(() => !!window.viewer?.worldClock && Number.isFinite(window.viewer.clock.hour), null, POLL)
  if(needWalk) await page.waitForFunction(() => window.viewer.walk?.active === true, null, POLL)
  return page
}

/** 切前台后等收敛（后台标签页 rAF 被暂停，小时不会追赶；软件渲染下也很慢）。 */
async function syncedRead(page) {
  await page.bringToFront()
  // 先等一帧真的画出来，确认 tick 在跑（软件渲染下可能只有 1 FPS）。
  await page.waitForFunction(() => (window.viewer?.stats?.frame ?? 0) > 2, null, {timeout:120000, polling:250})
  await page.waitForFunction(tolerance => {
    const snapshot = window.viewer.worldClock()
    const shortestOf = (a, b) => { const d = Math.abs(a - b) % 24; return Math.min(d, 24 - d) }
    return snapshot.source === 'server' && shortestOf(snapshot.hour, snapshot.targetHour) * 60 < tolerance
  }, HOUR_TOLERANCE_MIN, {timeout:120000, polling:250})
  return read(page)
}

try {
  await mkdir(OUT, {recursive:true})

  // ---- 1. 两台设备同刻一致，其中一台本机时钟偏 37 分钟 -------------------------------
  const alice = await open({name:'alice'})
  const bob = await open({name:'bob', skewMs:CLIENT_SKEW_MS})

  for(const page of [alice, bob])
    await page.waitForFunction(() => window.viewer.worldClock().source === 'server', null, {timeout:60000, polling:100})

  const a = await syncedRead(alice)
  const b = await syncedRead(bob)

  for(const [label, snapshot, skew] of [['alice', a, 0], ['bob', b, CLIENT_SKEW_MS]]) {
    // 关键断言：与测试进程侧真值比，而不是与客户端自报的 now 比。
    const clockError = clockErrorMs(snapshot)
    assert.ok(Math.abs(clockError) < CLOCK_TOLERANCE_MS,
      `${label} 时钟偏离真值 ${clockErrLabel(snapshot)}ms（本机时钟偏差 ${skew / 60000} 分钟，应当已被校时拉回）`)
    // 若根本没有校时，bob 会与真值差 37 分钟。
    assert.ok(Math.abs(clockError) < CLIENT_SKEW_MS * 0.25,
      `${label} 的偏差大到像"根本没校时"：${clockErrLabel(snapshot)}ms`)
    assert.equal(snapshot.source, 'server', `${label} 应当已对齐服务端时钟`)
    assert.equal(snapshot.local, false, `${label} 应当在全服时间线上，而不是本地预览`)
    // 天气段长 3 游戏小时（= 3 真实分钟），取数区间可能刚好跨段，所以接受区间两端的任一段。
    const weatherOk = [snapshot.nodeBefore, snapshot.nodeAfter].some(at => weatherAt(at) === snapshot.weather)
    assert.ok(weatherOk, `${label} 的天气应当来自全服映射（实际 ${snapshot.weather}）`)
    const hourError = hourErrMin(snapshot)
    assert.ok(hourError < HOUR_TOLERANCE_MIN, `${label} 渲染的小时与全服相差 ${hourError.toFixed(2)} 游戏分钟`)
  }
  // 两台之间归一化后的差（各自减掉自己算出的权威小时，抵消取样时刻不同）。
  const gap = shortest(a.hour - a.targetHour, b.hour - b.targetHour) * 60
  assert.ok(gap < HOUR_TOLERANCE_MIN, `两台设备相差 ${gap.toFixed(3)} 游戏分钟`)
  // 光照状态也必须一致：night 是天空/路灯/亮窗/水面反射的共同开关。
  assert.ok(Math.abs(a.night - b.night) < 0.05, `两台设备的 night 因子相差 ${Math.abs(a.night - b.night).toFixed(3)}`)
  console.log('同刻 hour A/B / night A/B / 对真值偏差(ms) / 归一化差(游戏分钟):',
    a.hour.toFixed(4), b.hour.toFixed(4), a.night.toFixed(3), b.night.toFixed(3), clockErrLabel(a), clockErrLabel(b), gap.toFixed(3))

  // ---- 2. 联机状态重复上报不得惊群 ------------------------------------------------
  // 设计保证：没有中间非 online 状态的重复 `online` 上报，最多触发一次校时（15 秒冷却兜底）。
  // 为了让断言确定化，先打一个 `offline` 把状态打下去，再连发 6 个 `online`：
  // 第 1 个是真实跃迁（+1），后 5 个必须全部被跃迁判断挡掉。若惊群存在，这里会是 +6。
  await bob.bringToFront()
  await new Promise(done => setTimeout(done, 1000))
  await bob.evaluate(() => window.dispatchEvent(new CustomEvent('glol:mp-status', {detail:{state:'offline', online:0}})))
  await new Promise(done => setTimeout(done, 400))
  const before = healthHits.get('bob')
  for(let index = 0; index < 6; index++) {
    await bob.evaluate(() => window.dispatchEvent(new CustomEvent('glol:mp-status', {detail:{state:'online', online:2}})))
    await new Promise(done => setTimeout(done, 120))
  }
  await new Promise(done => setTimeout(done, 1200))
  const afterBurst = healthHits.get('bob')
  const burstExtra = afterBurst - before
  assert.ok(burstExtra <= 1, `6 次重复 online 上报最多 1 次校时，实际多打 ${burstExtra} 次（惊群未修复）`)
  console.log('offline→6×online：额外请求 =', burstExtra, '（期望 1：首个 online 跃迁，其余被挡）')

  // ---- 3. offline → online 跃迁会重新校时 -----------------------------------------
  await bob.evaluate(() => window.dispatchEvent(new CustomEvent('glol:mp-status', {detail:{state:'offline', online:0}})))
  await new Promise(done => setTimeout(done, 300))
  const beforeReconnect = healthHits.get('bob')
  await bob.evaluate(() => window.dispatchEvent(new CustomEvent('glol:mp-status', {detail:{state:'online', online:1}})))
  const deadline = Date.now() + 45000
  while(healthHits.get('bob') <= beforeReconnect && Date.now() < deadline) await new Promise(done => setTimeout(done, 100))
  assert.ok(healthHits.get('bob') > beforeReconnect, 'offline → online 应当重新校时')
  const reconnected = await syncedRead(bob)
  assert.ok(Math.abs(clockErrorMs(reconnected)) < CLOCK_TOLERANCE_MS, `重连后偏离真值 ${clockErrLabel(reconnected)}ms`)
  assert.ok(hourErrMin(reconnected) < HOUR_TOLERANCE_MIN)
  console.log('offline→online 重新校时 / 对真值偏差(ms):', healthHits.get('bob') - beforeReconnect, clockErrLabel(reconnected))

  // ---- 4. 拍照：本地预览可拨时辰，期间的重连不得打断，退出必须交回全服 ----------------
  await bob.bringToFront()
  await bob.evaluate(() => document.querySelector('.dock-photo').onclick())
  await bob.waitForFunction(() => document.body.dataset.photo === 'on', null, {timeout:60000, polling:250})
  const preview = await read(bob)
  assert.equal(preview.local, true, '拍照模式应当是本地预览')
  await bob.evaluate(() => window.viewer.clock.set(3.5))
  const moved = await read(bob)
  assert.equal(Math.round(moved.hour * 100), 350, '本地预览应当能拨到自己想要的时辰')
  // 拍照期间来一次联机状态抖动（重连）——预览不能被强行打断（审核 P1-7）。
  await bob.evaluate(() => window.dispatchEvent(new CustomEvent('glol:mp-status', {detail:{state:'offline', online:0}})))
  await bob.evaluate(() => window.dispatchEvent(new CustomEvent('glol:mp-status', {detail:{state:'online', online:1}})))
  const survived = await read(bob)
  assert.equal(survived.local, true, '拍照期间的重连不该打断本地预览')
  assert.equal(Math.round(survived.hour * 100), 350, '拍照期间的重连不该改动预览时辰')
  await bob.evaluate(() => document.querySelector('.photo-exit').onclick())
  await bob.waitForFunction(() => !document.body.dataset.photo, null, {timeout:60000, polling:250})
  const restored = await syncedRead(bob)
  assert.equal(restored.local, false, '退出拍照必须交回全服时间')
  assert.ok(hourErrMin(restored) < HOUR_TOLERANCE_MIN, `退出拍照后与全服相差 ${hourErrMin(restored).toFixed(2)} 游戏分钟`)
  console.log('拍照本地预览 → 重连存活 → 退出回全服:', preview.local, survived.local, moved.hour.toFixed(2), restored.local)

  await bob.screenshot({path:`${OUT}/client-synced.png`})
  await alice.close(); await bob.close()

  // 软件渲染下多个世界同开会让每个页面掉到 1 FPS 以下，后面的用例各自换一个干净浏览器。
  await browser.close()
  browser = await chromium.launch(browserOptionsFull())

  // ---- 5. 裸 ?verify 零请求（即使 localStorage['glol.mp']='1'），且仍是固定 10:00 -----
  const pinned = await open({name:'pinned', query:'verify&mode=walk', mpPreference:true, needWalk:false})
  await pinned.bringToFront()
  await pinned.waitForFunction(() => Number.isFinite(window.viewer?.clock?.hour), null, POLL)
  await new Promise(done => setTimeout(done, 3000))
  const anchor = await read(pinned)
  assert.equal(anchor.hour, 10, '裸 ?verify 必须仍是 10:00 起点')
  assert.equal(anchor.weather, 'clear', '裸 ?verify 必须仍是晴天')
  assert.equal(anchor.local, true, '裸 ?verify 不跟全服时钟')
  assert.equal(healthHits.get('pinned'), 0,
    `裸 ?verify 不该打 /api/health（实际 ${healthHits.get('pinned')} 次，localStorage['glol.mp']='1' 时也不例外）`)
  console.log('裸 ?verify（mp 偏好=1）: hour/weather/请求数 =', anchor.hour, anchor.weather, healthHits.get('pinned'))
  await pinned.close()

  // ---- 6. 深链 ?mode=walk（无 mp）也校时：之后开联机不会停留在 local --------------------
  // 注意：`window.viewer` 只在 `?verify` 下暴露，而裸 `?verify` 按设计不校时。所以这条用例
  // 直接用**网络层**判定：深链进城必须至少打一次 /api/health（旧实现在这里直接 return，0 次）。
  const deep = await browser.newPage({viewport:{width:480, height:270}})
  healthHits.set('deep', 0)
  deep.on('pageerror', error => errors.push(`deep: ${error.message}`))
  deep.on('console', message => {
    if(message.type() !== 'error' || /Failed to load resource/i.test(message.text())) return
    errors.push(`deep: ${message.text()}`)
  })
  await deep.route('**/api/me', route => route.fulfill({json:{id:'deep', uid:4, nickname:'deep', verified:true}}))
  await deep.route('**/api/health', route => {
    healthHits.set('deep', (healthHits.get('deep') ?? 0) + 1)
    return route.fulfill({json:{ok:true, now:serverNow()}})
  })
  await deep.goto(`${origin}/?mode=walk&radius=320`, {waitUntil:'domcontentloaded'})
  const deepDeadline = Date.now() + 60000
  while(healthHits.get('deep') === 0 && Date.now() < deepDeadline) await new Promise(done => setTimeout(done, 200))
  assert.ok(healthHits.get('deep') >= 1,
    '深链进入也必须校时（旧实现直接 return，进城后开联机永远停在 local）')
  console.log('深链 ?mode=walk 校时: /api/health 请求数 =', healthHits.get('deep'))
  await deep.close()

  // ---- 7. 离线兜底：接口不可用时无报错，退回本机时钟，仍是同一套确定性映射 ------------
  const offline = await open({name:'carol', offline:true, needWalk:false})
  await offline.bringToFront()
  await offline.waitForFunction(tolerance => {
    const shortestOf = (a, b) => { const d = Math.abs(a - b) % 24; return Math.min(d, 24 - d) }
    const snapshot = window.viewer.worldClock()
    return snapshot.source === 'local' && shortestOf(snapshot.hour, snapshot.targetHour) * 60 < tolerance
  }, HOUR_TOLERANCE_MIN, {timeout:90000, polling:250})
  const fallback = await read(offline, {local:true})
  assert.equal(fallback.source, 'local')
  assert.equal(fallback.local, false, '离线兜底仍然沿全服时间线走，只是用本机时钟推算')
  assert.ok(fallback.failures > 0, '连续失败应当被计数，便于排查"为什么一直是本机时间"')
  // 兜底时"权威"就是本机时钟（Date.now，无偏移），所以对**本机**真值比，而不是对加了服务端偏移的日期。
  assert.ok(Math.abs(clockErrorMs(fallback)) < CLOCK_TOLERANCE_MS, '离线兜底的小时应当与本机时钟推算一致')
  console.log('离线兜底: source / failures / 对本机偏差(ms) =', fallback.source, fallback.failures, clockErrLabel(fallback))

  assert.deepEqual(errors, [], JSON.stringify(errors))
  console.log('RESULT ok')
} finally {
  await browser.close()
  await site.close()
}
