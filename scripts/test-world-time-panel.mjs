// IDOK-502 全服时间：真实 `skyClock()` 的集成测试（Node + 最小 DOM 垫片，不需要 WebGL）。
// Run: node --import tsx --test scripts/test-world-time-panel.mjs
//
// 这里跑的是浏览器里那份 `web/src/ui/sky.ts`，只是把 `document` / `window` 换成最小实现，
// 并注入一个用假 `fetch` 驱动的时钟实例。验证的是「面板读数 / 状态字 / 平滑校准 / 人工钉住 /
// 联机锁定」这些真实行为，而不是某个替身模型。
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {WORLD_ANCHOR_MS, worldHourAt, worldWeatherAt} from '../lib/world-clock.ts'
import {createWorldClock} from '../web/src/look/world-clock-client.ts'

// ---- 最小 DOM 垫片 ---------------------------------------------------------
class FakeClassList {
  constructor() { this.set = new Set() }
  add(...names) { for(const name of names) this.set.add(name) }
  remove(...names) { for(const name of names) this.set.delete(name) }
  contains(name) { return this.set.has(name) }
  toggle(name, on) { if(on === undefined) on = !this.set.has(name); on ? this.set.add(name) : this.set.delete(name); return on }
  toString() { return [...this.set].join(' ') }
}
class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.textContent = ''
    this.hidden = false; this.classList = new FakeClassList()
  }
  get className() { return this.classList.toString() }
  set className(value) { for(const name of String(value).split(/\s+/)) if(name) this.classList.add(name) }
  append(...nodes) { this.children.push(...nodes) }
  setAttribute(name, value) { this.dataset[name] = value }
  getAttribute(name) { return this.dataset[name] ?? null }
  querySelector() { return null }
  set innerHTML(_value) {}
  get innerHTML() { return '' }
}

/** 装上最小 DOM；返回事件触发器，方便模拟 `glol:mp-status`。 */
function installDom() {
  const body = new FakeElement('body')
  const listeners = new Map()
  const storage = new Map()
  const g = globalThis
  g.document = {
    body,
    visibilityState: 'visible',
    createElement: tag => new FakeElement(tag),
    addEventListener: (type, fn) => listeners.set('doc:' + type, fn),
    removeEventListener() {},
  }
  g.window = {
    addEventListener: (type, fn) => listeners.set('win:' + type, fn),
    removeEventListener() {},
    setInterval: () => 1,
    clearInterval: () => {},
    dispatchEvent: () => true,
  }
  g.addEventListener = (type, fn) => listeners.set(type, fn)
  g.removeEventListener = () => {}
  g.localStorage = {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key)}
  g.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail } }
  return {body, fire: (type, detail) => listeners.get(type)?.({type, detail})}
}

/** 用假 `/api/time` 驱动一个隔离的时钟实例，再挂一个真实面板。
 *  `authored.serverTime` 可以随时改写，用来模拟服务端时间跳跃。 */
async function mount(params = '', {serverTime = WORLD_ANCHOR_MS + 431*60_000, fail = false} = {}) {
  const dom = installDom()
  const authored = {serverTime, fail}
  const world = createWorldClock(async () => {
    if(authored.fail) throw Error('offline')
    return {ok:true, status:200, async json() {
      return {serverTime:authored.serverTime, mapping:{anchorMs:WORLD_ANCHOR_MS, anchorHour:10, hoursPerMs:1/60_000},
        hour:worldHourAt(authored.serverTime), weather:'clear', proto:1}
    }}
  })
  await world.sync(true)
  const {skyClock} = await import('../web/src/ui/sky.ts')
  const clock = skyClock(new URLSearchParams(params), world)
  const panel = dom.body.children[0]
  const badge = panel.children.find(child => child.dataset?.state !== undefined)
  return {clock, world, dom, panel, badge, authored}
}

/** 真实时间流逝会让服务端时钟外推，断言用它做容差（1 游戏小时 = 60 现实秒）。 */
const hourTolerance = (ms = 500) => ms / 60_000

/** 环形时辰差（小时，0…12）。 */
const hourGap = (a, b) => { const gap = ((a - b) % 24 + 24) % 24; return Math.min(gap, 24-gap) }

test('跟随服务端：面板显示「全服」，读数来自 /api/time 而不是本机时钟', async () => {
  const serverTime = WORLD_ANCHOR_MS + 431*60_000
  const {clock, badge} = await mount('', {serverTime})
  assert.equal(clock.source, 'server')
  assert.equal(clock.manual, false)
  assert.equal(badge.textContent, '全服')
  // 权威时辰接近载荷里的时刻（容差留给同步本身的真实耗时）。本机时钟是否被信任，由下一条
  // 「本机时钟偏 7 小时」用例专门验证。
  assert.ok(hourGap(clock.world.authoritativeHour(), worldHourAt(serverTime)) < hourTolerance(10_000),
    `权威时辰应来自 /api/time：${clock.world.authoritativeHour()} vs ${worldHourAt(serverTime)}`)
  // 面板读数在几帧内追上权威时辰，且每帧修正量都很小（无跳变）。
  for(let frame = 0; frame < 240; frame++) {
    clock.tick(1/60)
    assert.ok(Math.abs(clock.correction) < .06, `单帧修正量应很小：${clock.correction}`)
  }
  assert.ok(hourGap(clock.hour, clock.world.authoritativeHour()) < .01, `应收敛到权威时辰：${clock.hour}`)
})

test('本机时钟偏 7 小时也不影响权威时辰（用的是服务端 epoch）', async () => {
  const serverTime = WORLD_ANCHOR_MS + 431*60_000
  const originalNow = Date.now
  Date.now = () => originalNow() + 7*3600_000
  try {
    const {clock} = await mount('', {serverTime})
    // 若读本机时钟，时辰会差 7 小时；实际应只差这次调用实际流逝的那点时间。
    assert.ok(hourGap(clock.world.authoritativeHour(), worldHourAt(serverTime)) < hourTolerance(5_000),
      `本机时钟偏移不应影响权威时辰：${clock.world.authoritativeHour()} vs ${worldHourAt(serverTime)}`)
  } finally { Date.now = originalNow }
})

test('取不到服务端：面板显示「本机」，仍能给出合法时辰与天气', async () => {
  const {clock, badge} = await mount('', {fail:true})
  assert.equal(clock.source, 'local')
  assert.equal(clock.world.offline(), true)
  assert.equal(badge.textContent, '本机')
  assert.ok(clock.hour >= 0 && clock.hour < 24)
  assert.ok(['clear','mist','rain'].includes(clock.weather))
})

test('?time= 钉住时辰：状态「固定」，且不再跟随服务端', async () => {
  const {clock, badge} = await mount('?time=21.5')
  assert.equal(clock.manual, true)
  assert.equal(clock.source, 'pinned')
  assert.equal(badge.textContent, '固定')
  assert.ok(Math.abs(clock.hour - 21.5) < 1e-9)
  for(let frame = 0; frame < 240; frame++) clock.tick(1/60)
  assert.ok(Math.abs(clock.hour - 21.5) < 1e-9, `钉住后不应被权威时辰拉走：${clock.hour}`)
})

test('手动 set() 进入「固定」，人工钉住时交回平滑过渡（mix = null）', async () => {
  const {clock} = await mount('')
  clock.tick(1/60)
  assert.notEqual(clock.mix, null, '跟随全服时应带确定性乘数')
  clock.set(20.8)
  assert.equal(clock.manual, true)
  assert.equal(clock.source, 'pinned')
  assert.equal(clock.mix, null, '人工钉住时应交回主循环平滑过渡')
  assert.ok(Math.abs(clock.hour - 20.8) < 1e-9, `钉住的时辰应精确：${clock.hour}`)
})

test('联机在线时面板锁定，避免单方面改全服天色', async () => {
  const {clock, dom, panel} = await mount('')
  const before = clock.hour
  dom.fire('glol:mp-status', {state:'online'})
  assert.equal(panel.classList.contains('locked'), true, '在线时面板应锁定')
  const timeGroup = panel.children.find(child => child.className.includes('sky-group'))
  timeGroup.children[0].onclick()
  assert.equal(clock.manual, false, '锁定期间不能钉住时辰')
  assert.equal(clock.hour, before)
  // 离线后解锁。
  dom.fire('glol:mp-status', {state:'offline'})
  assert.equal(panel.classList.contains('locked'), false)
})

test('两个客户端同 epoch：面板读数与天气乘数完全一致', async () => {
  const serverTime = WORLD_ANCHOR_MS + 700*60_000
  const first = await mount('', {serverTime})
  first.clock.tick(1/60)
  const snapshot = {hour:first.clock.hour, weather:first.clock.weather, mix:{...first.clock.mix}}
  const second = await mount('', {serverTime})
  second.clock.tick(1/60)
  assert.ok(Math.abs(snapshot.hour - second.clock.hour) < .01, `两个客户端读数差 ${Math.abs(snapshot.hour-second.clock.hour)}`)
  assert.equal(snapshot.weather, second.clock.weather)
  assert.deepEqual(snapshot.mix, second.clock.mix)
  assert.deepEqual(snapshot.mix, worldWeatherAt(serverTime).mix)
})

test('服务端时间跳跃（模拟重连后一次大幅校正）：平滑追上，不跳变', async () => {
  const {clock, world, authored} = await mount('')
  clock.tick(1/60)
  // 服务端说时间往前走了 4 小时（休眠唤醒 / 长时间断线后的典型场景）。
  authored.serverTime += 4*3600_000
  await world.sync(true)
  let previous = clock.hour, maxStep = 0
  for(let frame = 0; frame < 1800; frame++) {
    clock.tick(1/60)
    maxStep = Math.max(maxStep, hourGap(clock.hour, previous))
    previous = clock.hour
  }
  assert.ok(maxStep < .16, `单帧修正量必须远小于跳变量，实际 ${maxStep}`)
  assert.ok(hourGap(clock.hour, world.authoritativeHour()) < .01, `最终应收敛回权威时辰，实际差 ${hourGap(clock.hour, world.authoritativeHour())} 小时`)
})

test('直接把 hour 写进去会钉住（验收脚本 ?time 之外的用法），不会被下一帧拉回', async () => {
  const {clock} = await mount('')
  clock.tick(1/60)
  clock.hour = 3.25
  assert.equal(clock.manual, true, '脚本直写 hour 视为人工钉住')
  for(let frame = 0; frame < 240; frame++) clock.tick(1/60)
  assert.ok(hourGap(clock.hour, 3.25) < 1e-9)
})
