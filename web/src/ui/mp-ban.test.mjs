// 联机受限提示（mp-ban.ts）的纯 Node 单元测试：轻量 DOM 桩 + 假时钟，不依赖浏览器和 node_modules。
// 运行：node --test web/src/ui/mp-ban.test.mjs（Node ≥ 22.18 / 23.6 自带 TypeScript 类型剥离）
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

// mp-ban.ts 顶部 import './mp-ban.css'：在 Node 里换成空模块
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true }
    return nextLoad(url, context)
  },
})

// ---------- 轻量 DOM 桩 ----------
class TextNode {
  constructor(text) { this.nodeType = 3; this.data = String(text); this.parentNode = null }
  get textContent() { return this.data }
  set textContent(value) { this.data = String(value) }
  remove() { this.parentNode?.removeChild(this) }
}
class Element {
  constructor(tag, doc) {
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.ownerDocument = doc
    this.childNodes = []; this.parentNode = null; this.attrs = new Map(); this.listeners = new Map()
    this.className = ''; this.type = ''; this.onclick = null; this.open = false
  }
  get id() { return this.attrs.get('id') ?? '' }
  set id(value) { this.attrs.set('id', String(value)) }
  get children() { return this.childNodes.filter(node => node.nodeType === 1) }
  get textContent() { return this.childNodes.map(node => node.textContent).join('') }
  set textContent(value) { this.childNodes.forEach(node => { node.parentNode = null }); this.childNodes = []; if (value !== '') this.append(String(value)) }
  get isConnected() { let node = this; while (node.parentNode) node = node.parentNode; return node === this.ownerDocument.root }
  append(...nodes) {
    for (const item of nodes) {
      const node = typeof item === 'string' ? new TextNode(item) : item
      node.parentNode?.removeChild(node); node.parentNode = this; this.childNodes.push(node)
    }
  }
  removeChild(node) { this.childNodes = this.childNodes.filter(child => child !== node); node.parentNode = null }
  remove() { this.parentNode?.removeChild(this) }
  setAttribute(name, value) { this.attrs.set(name, String(value)); if (name === 'open') this.open = true }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null }
  hasAttribute(name) { return this.attrs.has(name) }
  removeAttribute(name) { this.attrs.delete(name) }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn) }
  dispatchEvent(event) { for (const fn of this.listeners.get(event.type) ?? []) fn.call(this, event); return true }
  focus() { this.ownerDocument.activeElement = this }
  click() { this.onclick?.({ type: 'click', target: this }) }
  showModal() { if (!this.isConnected) throw new Error('InvalidStateError'); this.open = true; this.attrs.set('open', '') }
  close() { if (!this.open) return; this.open = false; this.attrs.delete('open'); this.dispatchEvent({ type: 'close' }) }
}
function makeDocument() {
  const doc = { activeElement: null }
  doc.root = new Element('html', doc)
  doc.body = new Element('body', doc); doc.root.append(doc.body)
  doc.createElement = tag => new Element(tag, doc)
  doc.createTextNode = text => new TextNode(text)
  doc.getElementById = id => find(doc.root, node => node.id === id)
  return doc
}
function find(root, pred) { for (const node of root.children) { if (pred(node)) return node; const hit = find(node, pred); if (hit) return hit } return null }
function findAll(root, pred, out = []) { for (const node of root.children) { if (pred(node)) out.push(node); findAll(node, pred, out) } return out }
const hasClass = (node, cls) => node.className.split(/\s+/).includes(cls)
const byClass = (root, cls) => find(root, node => hasClass(node, cls))
const action = (dialog, key) => find(dialog, node => node.getAttribute('data-mp-ban') === key)
const field = (dialog, key) => find(dialog, node => node.getAttribute('data-field') === key)
const fieldValue = (dialog, key) => find(field(dialog, key), node => node.tagName === 'DD')?.textContent

// ---------- 假时钟（setInterval / setTimeout / Date.now 都走它，好数还挂着几个定时器） ----------
const realNow = Date.now
const clock = {
  now: 0, seq: 0, timers: new Map(),
  add(fn, ms, repeat) { const id = ++this.seq; this.timers.set(id, { fn, at: this.now + Math.max(1, ms | 0), every: repeat ? Math.max(1, ms | 0) : 0 }); return id },
  clear(id) { this.timers.delete(id) },
  tick(ms) {
    const end = this.now + ms
    for (;;) {
      let next
      for (const [id, t] of this.timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t]
      if (!next) break
      const [id, t] = next; this.now = t.at
      if (t.every) t.at += t.every; else this.timers.delete(id)
      t.fn()
    }
    this.now = end
  },
  get pending() { return this.timers.size },
}
const NOW = new Date(2026, 10, 27, 10, 0, 0).getTime()
const MIN = 60_000, HOUR = 60 * MIN

function memoryStorage() {
  const map = new Map()
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
  }
}
const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })

let doc, store
beforeEach(() => {
  doc = makeDocument(); store = memoryStorage()
  clock.now = NOW; clock.timers.clear()
  define('document', doc)
  define('window', globalThis)
  define('sessionStorage', store)
  define('navigator', {})
  define('setInterval', (fn, ms) => clock.add(fn, ms, true))
  define('clearInterval', id => clock.clear(id))
  define('setTimeout', (fn, ms) => clock.add(fn, ms, false))
  define('clearTimeout', id => clock.clear(id))
  Date.now = () => clock.now
})
afterEach(() => {
  doc.getElementById('mp-ban-notice')?.close()
  Date.now = realNow
})

const { showMpBan, getLastMpBan, clearLastMpBan } = await import('./mp-ban.ts')
const noop = () => {}

// ---------- 两档渲染 ----------
test('ban 档：白文「封」印、默认标题，主动作是朱印「申诉」并拿到焦点', () => {
  const dialog = showMpBan({ tier: 'ban', reason: '服务端下发的原因', until: NOW + 3 * HOUR, recordId: 'rec_01' }, noop)
  assert.equal(dialog.getAttribute('data-tier'), 'ban')
  assert.equal(dialog.id, 'mp-ban-notice')
  assert.ok(dialog.open && dialog.isConnected)
  assert.equal(byClass(dialog, 'mp-ban-seal').textContent, '封')
  assert.equal(byClass(dialog, 'mp-ban-seal').getAttribute('aria-hidden'), 'true')
  assert.equal(doc.getElementById('mp-ban-title').textContent, '联机已暂停')
  const appeal = action(dialog, 'appeal'), later = action(dialog, 'continue')
  assert.equal(appeal.getAttribute('data-rank'), 'primary')
  assert.equal(later.getAttribute('data-rank'), 'secondary')
  assert.equal(doc.activeElement, appeal)
  const buttons = byClass(dialog, 'mp-ban-actions').children
  assert.deepEqual(buttons.map(b => b.getAttribute('data-mp-ban')), ['continue', 'appeal'], '主键在后：桌面靠右、窄屏 column-reverse 后在上')
  assert.equal(fieldValue(dialog, 'reason'), '服务端下发的原因')
  assert.equal(find(field(dialog, 'until'), n => n.tagName === 'DT').textContent, '解封')
  assert.equal(byClass(dialog, 'mp-ban-left').textContent, '还剩 3 小时')
  assert.equal(byClass(dialog, 'mp-ban-at').textContent, '今天 13:00')
  assert.equal(dialog.getAttribute('data-record-id'), 'rec_01')
  for (const b of findAll(dialog, n => n.tagName === 'BUTTON')) assert.equal(b.type, 'button')
})

test('cooldown 档：赭石「歇」印、默认标题，主动作是「继续单人游览」，倒计时在恢复行', () => {
  const dialog = showMpBan({ tier: 'cooldown', until: NOW + 12 * MIN + 5000, recordId: 'cd_9' }, noop)
  assert.equal(dialog.getAttribute('data-tier'), 'cooldown')
  assert.equal(byClass(dialog, 'mp-ban-seal').textContent, '歇')
  assert.equal(doc.getElementById('mp-ban-title').textContent, '联机暂歇')
  const appeal = action(dialog, 'appeal'), later = action(dialog, 'continue')
  assert.equal(later.getAttribute('data-rank'), 'primary')
  assert.equal(appeal.getAttribute('data-rank'), 'secondary')
  assert.equal(doc.activeElement, later)
  assert.deepEqual(byClass(dialog, 'mp-ban-actions').children.map(b => b.getAttribute('data-mp-ban')), ['appeal', 'continue'])
  assert.equal(find(field(dialog, 'until'), n => n.tagName === 'DT').textContent, '恢复')
  assert.equal(byClass(dialog, 'mp-ban-left').textContent, '还剩 13 分钟')
  assert.equal(byClass(dialog, 'mp-ban-left').getAttribute('role'), 'timer')
  assert.equal(fieldValue(dialog, 'reason'), '触发联机保护', '没下发原因时用中性兜底')
  assert.equal(dialog.hasAttribute('data-permanent'), false)
})

test('对话框无障碍：标题与正文由 aria 关联，关闭键保留可读文字', () => {
  const dialog = showMpBan({ tier: 'cooldown' }, noop)
  assert.equal(doc.getElementById(dialog.getAttribute('aria-labelledby'))?.tagName, 'H2')
  assert.equal(doc.getElementById(dialog.getAttribute('aria-describedby'))?.textContent, '单人游览不受影响。')
  assert.equal(action(dialog, 'close').textContent, '关闭')
})

// ---------- 服务端下发优先 ----------
test('服务端下发的标题 / 印字 / 导语 / 原因 / 说明优先于兜底，且只当纯文本', () => {
  const dialog = showMpBan({
    tier: 'cooldown', title: '  稍等片刻  ', seal: '候补', lede: '服务端导语\n第二行', reason: '<b>原因</b>',
    note: '服务端说明', until: NOW + HOUR, recordId: 'r-1',
  }, noop)
  assert.equal(doc.getElementById('mp-ban-title').textContent, '稍等片刻')
  assert.equal(byClass(dialog, 'mp-ban-seal').textContent, '候', '印章只刻一个字')
  assert.equal(byClass(dialog, 'mp-ban-lede').textContent, '服务端导语 第二行')
  assert.equal(fieldValue(dialog, 'reason'), '<b>原因</b>')
  assert.equal(byClass(dialog, 'mp-ban-reason').children.length, 0, '不解析成标签')
  assert.equal(byClass(dialog, 'mp-ban-note').textContent, '服务端说明')
})

test('下发文本过长会截断，空白字段回落到兜底', () => {
  const dialog = showMpBan({ tier: 'ban', title: '题'.repeat(80), reason: '   ', lede: '', seal: ' ' }, noop)
  assert.equal(doc.getElementById('mp-ban-title').textContent, '题'.repeat(24))
  assert.equal(fieldValue(dialog, 'reason'), '违反联机规则')
  assert.equal(byClass(dialog, 'mp-ban-lede').textContent, '单人游览、地图和反馈照常可用。')
  assert.equal(byClass(dialog, 'mp-ban-seal').textContent, '封')
})

test('auto 只挂 data-auto 并换中性原因兜底；下发了原因就用下发的', () => {
  let dialog = showMpBan({ auto: true }, noop)
  assert.ok(dialog.hasAttribute('data-auto'))
  assert.equal(fieldValue(dialog, 'reason'), '系统自动处理')
  dialog = showMpBan({ auto: true, reason: '服务端原因' }, noop)
  assert.equal(fieldValue(dialog, 'reason'), '服务端原因')
})

// ---------- 旧 payload 兼容 ----------
test('旧 payload {reason, until, recordId} 原样可用，默认按 ban 档', () => {
  const dialog = showMpBan({ reason: '旧原因', until: NOW + 30 * HOUR + 30 * MIN, recordId: 'old_1' }, noop)
  assert.equal(dialog.getAttribute('data-tier'), 'ban')
  assert.equal(fieldValue(dialog, 'reason'), '旧原因')
  assert.equal(byClass(dialog, 'mp-ban-left').textContent, '还剩 30 小时 30 分')
  assert.equal(find(field(dialog, 'record'), n => n.tagName === 'CODE').textContent, 'old_1')
  assert.equal(byClass(dialog, 'mp-ban-note').textContent, '申诉会自动附上记录号。')
})

test('旧 payload 没有 until = 永久，没有 recordId 就不出记录行和说明；未知 tier 与多余字段被忽略', () => {
  const dialog = showMpBan({ type: 'banned', tier: 'something-else', reason: 'x' }, noop)
  assert.equal(dialog.getAttribute('data-tier'), 'ban')
  assert.ok(dialog.hasAttribute('data-permanent'))
  assert.equal(fieldValue(dialog, 'until'), '需申诉后由管理员处理')
  assert.equal(field(dialog, 'record'), null)
  assert.equal(byClass(dialog, 'mp-ban-note'), null)
  assert.equal(clock.pending, 0, '没有到期时间就不起倒计时')
})

test('空 / 异常 payload 不抛错，按 ban 档中性兜底', () => {
  for (const bad of [undefined, null, {}, 'oops', { until: 'tomorrow', recordId: 42 }]) {
    const dialog = showMpBan(bad, noop)
    assert.equal(dialog.getAttribute('data-tier'), 'ban')
    assert.equal(doc.getElementById('mp-ban-title').textContent, '联机已暂停')
  }
  assert.equal(doc.getElementById('mp-ban-notice').getAttribute('data-record-id'), '42', '数字记录号转成字符串')
})

// ---------- behavior / networkNote 条件显隐 ----------
test('behavior / networkNote 下发才显示', () => {
  let dialog = showMpBan({ tier: 'cooldown', until: NOW + MIN }, noop)
  assert.equal(field(dialog, 'behavior'), null)
  assert.equal(field(dialog, 'network'), null)
  dialog = showMpBan({ tier: 'cooldown', behavior: '  ', networkNote: '' }, noop)
  assert.equal(field(dialog, 'behavior'), null, '只有空白不算下发')
  assert.equal(field(dialog, 'network'), null)
  dialog = showMpBan({ tier: 'ban', behavior: '行为摘要', networkNote: '网络摘要', recordId: 'r' }, noop)
  assert.equal(fieldValue(dialog, 'behavior'), '行为摘要')
  assert.equal(fieldValue(dialog, 'network'), '网络摘要')
  const order = findAll(byClass(dialog, 'mp-ban-sheet'), n => n.hasAttribute('data-field')).map(n => n.getAttribute('data-field'))
  assert.deepEqual(order, ['reason', 'behavior', 'network', 'until', 'record'])
})

// ---------- sessionStorage 持久化 ----------
test('showMpBan 把记录写进 sessionStorage，getLastMpBan 能找回（只存必要字段）', () => {
  showMpBan({ tier: 'cooldown', reason: '原因', behavior: '不该存', networkNote: '不该存', until: NOW + HOUR, recordId: 'keep_1' }, noop)
  const raw = JSON.parse(store.map.get('glol.lastMpBan'))
  assert.deepEqual(raw, { tier: 'cooldown', until: NOW + HOUR, savedAt: NOW, reason: '原因', recordId: 'keep_1' })
  doc.getElementById('mp-ban-notice').close()
  assert.deepEqual(getLastMpBan(), { tier: 'cooldown', until: NOW + HOUR, savedAt: NOW, reason: '原因', recordId: 'keep_1' })
})

test('旧 payload 存成 ban 档，缺的字段不写', () => {
  showMpBan({}, noop)
  assert.deepEqual(getLastMpBan(), { tier: 'ban', until: null, savedAt: NOW })
})

test('超过 24 小时返回 null 并清掉；clearLastMpBan 直接清', () => {
  showMpBan({ recordId: 'old' }, noop)
  clock.now = NOW + 24 * HOUR
  assert.equal(getLastMpBan()?.recordId, 'old', '正好 24 小时仍有效')
  clock.now = NOW + 24 * HOUR + 1
  assert.equal(getLastMpBan(), null)
  assert.equal(store.map.has('glol.lastMpBan'), false)
  clock.now = NOW
  showMpBan({ recordId: 'again' }, noop)
  clearLastMpBan()
  assert.equal(store.map.has('glol.lastMpBan'), false)
  assert.equal(getLastMpBan(), null)
})

test('损坏 / 被篡改的存档返回 null 并清掉', () => {
  for (const bad of ['{not json', 'null', '"str"', '{"tier":"ban"}', `{"savedAt":${NOW + HOUR}}`]) {
    store.map.set('glol.lastMpBan', bad)
    assert.equal(getLastMpBan(), null, bad)
    assert.equal(store.map.has('glol.lastMpBan'), false, bad)
  }
  store.map.set('glol.lastMpBan', JSON.stringify({ savedAt: NOW, tier: 'hack', until: 'x', recordId: { a: 1 } }))
  assert.deepEqual(getLastMpBan(), { tier: 'ban', until: null, savedAt: NOW })
})

test('sessionStorage 不可用或写满时不影响弹层', () => {
  define('sessionStorage', { getItem() { throw new Error('denied') }, setItem() { throw new Error('quota') }, removeItem() { throw new Error('denied') } })
  const dialog = showMpBan({ recordId: 'x' }, noop)
  assert.ok(dialog.open)
  assert.equal(getLastMpBan(), null)
  assert.doesNotThrow(() => clearLastMpBan())
  Object.defineProperty(globalThis, 'sessionStorage', { get() { throw new Error('SecurityError') }, configurable: true })
  assert.ok(showMpBan({ recordId: 'y' }, noop).open)
  assert.equal(getLastMpBan(), null)
})

// ---------- 动作回调 ----------
test('点「申诉」先关弹层再 onAppeal(recordId)', () => {
  const calls = []
  const dialog = showMpBan({ tier: 'ban', recordId: 'appeal_7' }, id => calls.push([id, dialog.isConnected]))
  action(dialog, 'appeal').click()
  assert.deepEqual(calls, [['appeal_7', false]])
  assert.equal(doc.getElementById('mp-ban-notice'), null)
  assert.equal(getLastMpBan()?.recordId, 'appeal_7', '关掉后还能找回记录号')
})

test('冷却档的次键「申诉」同样带记录号；没有记录号时传 undefined', () => {
  const calls = []
  let dialog = showMpBan({ tier: 'cooldown', recordId: 'cd_2' }, id => calls.push(id))
  action(dialog, 'appeal').click()
  dialog = showMpBan({ tier: 'cooldown' }, id => calls.push(id))
  action(dialog, 'appeal').click()
  assert.deepEqual(calls, ['cd_2', undefined])
})

test('「继续单人游览」和 × 只关弹层，不触发申诉', () => {
  let called = 0
  let dialog = showMpBan({ recordId: 'r' }, () => called++)
  action(dialog, 'continue').click()
  assert.equal(dialog.isConnected, false)
  dialog = showMpBan({ recordId: 'r' }, () => called++)
  action(dialog, 'close').click()
  assert.equal(dialog.isConnected, false)
  assert.equal(called, 0)
})

// ---------- 定时器 ----------
test('倒计时按分钟刷新，到期挂 data-expired 并停表', () => {
  const dialog = showMpBan({ tier: 'cooldown', until: NOW + 2 * MIN }, noop)
  const remain = byClass(dialog, 'mp-ban-left')
  assert.equal(remain.textContent, '还剩 2 分钟')
  assert.equal(clock.pending, 1)
  clock.tick(61_000)
  assert.equal(remain.textContent, '还剩 1 分钟')
  clock.tick(60_000)
  assert.equal(remain.textContent, '已到期，可以重新连接')
  assert.ok(dialog.hasAttribute('data-expired'))
  assert.equal(clock.pending, 0)
})

test('一打开就已到期：直接显示到期，不起定时器', () => {
  const dialog = showMpBan({ tier: 'cooldown', until: NOW - 1000 }, noop)
  assert.ok(dialog.hasAttribute('data-expired'))
  assert.equal(clock.pending, 0)
})

test('关闭释放倒计时和复制提示的定时器', async () => {
  define('navigator', { clipboard: { writeText: async () => {} } })
  const dialog = showMpBan({ tier: 'ban', until: NOW + 5 * HOUR, recordId: 'copy_1' }, noop)
  const copy = action(dialog, 'copy')
  copy.click(); await Promise.resolve(); await Promise.resolve()
  assert.equal(copy.textContent, '已复制')
  assert.equal(copy.getAttribute('data-state'), 'copied')
  assert.equal(clock.pending, 2, '倒计时 + 复制提示')
  dialog.close()
  assert.equal(clock.pending, 0)
  assert.equal(dialog.isConnected, false)
})

test('重复弹出会替换旧弹层并释放旧定时器', () => {
  const first = showMpBan({ tier: 'cooldown', until: NOW + HOUR }, noop)
  const second = showMpBan({ tier: 'ban', until: NOW + HOUR }, noop)
  assert.equal(first.isConnected, false)
  assert.equal(second.isConnected, true)
  assert.equal(findAll(doc.body, n => n.id === 'mp-ban-notice').length, 1)
  assert.equal(clock.pending, 1)
  second.close()
  assert.equal(clock.pending, 0)
})

test('复制：成功显示「已复制」1.6 秒后复原；剪贴板不可用 / 被拒时退为选中', async () => {
  const written = []
  define('navigator', { clipboard: { writeText: async text => { written.push(text) } } })
  let dialog = showMpBan({ recordId: 'id_ok' }, noop)
  let copy = action(dialog, 'copy')
  copy.click(); await Promise.resolve(); await Promise.resolve()
  assert.deepEqual(written, ['id_ok'])
  clock.tick(1600)
  assert.equal(copy.textContent, '复制')
  assert.equal(copy.hasAttribute('data-state'), false)

  define('navigator', {})
  dialog = showMpBan({ recordId: 'id_none' }, noop)
  copy = action(dialog, 'copy'); copy.click()
  assert.equal(copy.textContent, '已选中')

  define('navigator', { clipboard: { writeText: async () => { throw new Error('denied') } } })
  dialog = showMpBan({ recordId: 'id_denied' }, noop)
  copy = action(dialog, 'copy'); copy.click()
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  assert.equal(copy.getAttribute('data-state'), 'selected')
})

test('关闭后剪贴板才回来，不再改按钮也不留定时器', async () => {
  let resolve
  define('navigator', { clipboard: { writeText: () => new Promise(r => { resolve = r }) } })
  const dialog = showMpBan({ recordId: 'late' }, noop)
  const copy = action(dialog, 'copy'); copy.click()
  dialog.close(); resolve(); await Promise.resolve(); await Promise.resolve()
  assert.equal(copy.textContent, '复制')
  assert.equal(clock.pending, 0)
})
