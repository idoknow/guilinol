// 游戏内聊天框（IDOK-248）：附近 60 m / 世界 两个频道。只读写 chat-store，不碰 three。
// 收起 = 左侧一枚青玉小气泡，显示最新一条；展开 = 可拖动、可调高的墨青玻璃面板。
// 回车打开并聚焦输入框；输入框里回车发送、Shift+回车换行、Esc 收起。
import './chat.css'
import {chatStore, type Channel, type ChatAck, type ChatMessage} from '../chat-store'
import {isGlobalHotkeyBlocked} from '../walk/input-guard'
import type {MpStatus} from './mp-pref'

const LABEL: Record<Channel, string> = {near: '附近', world: '世界'}
const MAX = 100
const KEEP = 200
const BOX_KEY = 'glol.chat.box'
const CHANNEL_KEY = 'glol.chat.ch'
const ACK_TEXT: Record<string, string> = {
  blocked: '消息包含违规内容，无法发送',
  pending: '消息已提交审核，通过后会发出',
  rate: '发得太快了，歇几秒再说',
  too_long: `一条最多 ${MAX} 字`,
  muted: '你正在禁言中，暂时不能发言',
  error: '没发出去，检查联机后再试',
}

type Box = {left: number; bottom: number; height: number}
const lists: Record<Channel, ChatMessage[]> = {near: [], world: []}
const unread: Record<Channel, number> = {near: 0, world: 0}
const loaded: Record<Channel, boolean> = {near: false, world: false}
let channel: Channel = localStorage.getItem(CHANNEL_KEY) === 'near' ? 'near' : 'world'
let online = false
let open = false
let myUid = 0
let mute = {until: 0, reason: ''}
let muteTimer = 0
let sending = false
let noticeTimer = 0

let root: HTMLElement, bubble: HTMLButtonElement, bubbleText: HTMLElement, bubbleCount: HTMLElement
let panel: HTMLElement, list: HTMLOListElement, more: HTMLButtonElement, input: HTMLTextAreaElement
let counter: HTMLElement, sendButton: HTMLButtonElement, notice: HTMLElement, muteLine: HTMLElement
let tabs: Record<Channel, HTMLButtonElement>

const byMid = (a: ChatMessage, b: ChatMessage) => a.mid.length - b.mid.length || (a.mid < b.mid ? -1 : a.mid > b.mid ? 1 : 0)
function merge(into: ChatMessage[], incoming: ChatMessage[]) {
  const seen = new Map(into.map(m => [m.mid, m]))
  for (const m of incoming) seen.set(m.mid, m)
  return [...seen.values()].sort(byMid).slice(-KEEP)
}
function clock(ts: number) {
  const d = new Date(ts), now = new Date()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return d.toDateString() === now.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}
function length(text: string) { return [...text].length }
function latest() {
  const all = [...lists.near, ...lists.world].sort((a, b) => a.ts - b.ts || byMid(a, b))
  return all.at(-1)
}

function loadBox(): Box {
  try {
    const box = JSON.parse(localStorage.getItem(BOX_KEY) || '') as Box
    if ([box.left, box.bottom, box.height].every(Number.isFinite)) return box
  } catch { /* 默认位置 */ }
  return {left: NaN, bottom: NaN, height: 300}
}
let box = loadBox()
function placePanel() {
  // NaN = 跟随样式表里的默认停靠位；拖过之后才写内联位置，并夹在视口里
  const vw = innerWidth, vh = innerHeight
  const height = Math.round(Math.min(Math.max(box.height, 180), vh * .72))
  panel.style.height = `${height}px`
  if (!Number.isFinite(box.left)) { panel.style.left = panel.style.bottom = ''; return }
  const width = panel.offsetWidth || 340
  const left = Math.min(Math.max(box.left, 4), Math.max(4, vw - width - 4))
  const bottom = Math.min(Math.max(box.bottom, 4), Math.max(4, vh - height - 4))
  panel.style.left = `${left}px`
  panel.style.bottom = `${bottom}px`
}
function saveBox() { localStorage.setItem(BOX_KEY, JSON.stringify(box)) }

function nearBottom() { return list.scrollHeight - list.scrollTop - list.clientHeight < 28 }
function scrollToEnd() { list.scrollTop = list.scrollHeight; more.hidden = true; unread[channel] = 0; paintTabs() }

function row(m: ChatMessage) {
  const li = document.createElement('li')
  li.className = 'chat-msg'
  li.dataset.mid = m.mid
  if (m.sys) li.dataset.sys = m.sys
  else if (myUid && m.uid === myUid) li.dataset.self = '1'
  const head = document.createElement('div'); head.className = 'chat-msg-head'
  const tag = document.createElement('span'); tag.className = 'chat-tag'; tag.dataset.ch = m.ch
  tag.textContent = m.sys ? (m.sys === 'notice' ? '公告' : '系统') : LABEL[m.ch]
  const name = document.createElement('b'); name.textContent = m.sys ? '网上桂林' : m.name
  const time = document.createElement('time'); time.dateTime = new Date(m.ts).toISOString(); time.textContent = clock(m.ts)
  head.append(tag, name, time)
  const body = document.createElement('p'); body.textContent = m.text
  li.append(head, body)
  registerPageUI(li,true)
  return li
}
function paintList(stick = true) {
  if (!open) return
  const items = lists[channel]
  list.replaceChildren(...items.map(row))
  if (!items.length) {
    const empty = document.createElement('li'); empty.className = 'chat-empty'
    empty.textContent = !online ? '联机后才能聊天'
      : !loaded[channel] ? '正在取最近的消息…'
      : channel === 'near' ? '身边 60 米内还没人说话。说一句，附近的人都能看到。'
      : '世界频道还很安静，打个招呼吧。'
    list.append(empty)
  }
  if (stick) scrollToEnd()
}
function append(m: ChatMessage) {
  if (!open || m.ch !== channel) return
  const stick = nearBottom()
  list.querySelector('.chat-empty')?.remove()
  list.append(row(m))
  while (list.children.length > KEEP) list.firstElementChild!.remove()
  if (stick || myUid && m.uid === myUid && !m.sys) scrollToEnd()
  else { unread[channel]++; more.hidden = false; more.textContent = `↓ ${unread[channel]} 条新消息` }
}
function paintTabs() {
  for (const ch of ['near', 'world'] as Channel[]) {
    const tab = tabs[ch]
    tab.setAttribute('aria-selected', String(ch === channel))
    tab.dataset.unread = ch !== channel && unread[ch] ? String(Math.min(unread[ch], 99)) : ''
  }
}
function paintBubble() {
  const m = latest()
  const total = open ? 0 : unread.near + unread.world
  bubbleCount.textContent = total ? String(Math.min(total, 99)) : ''
  bubbleCount.hidden = !total
  if (!m) { bubbleText.textContent = online ? '聊天 · 回车说话' : '联机后可聊天'; bubble.dataset.ch = ''; return }
  bubble.dataset.ch = m.sys ? 'sys' : m.ch
  bubbleText.replaceChildren()
  const tag = document.createElement('span'); tag.className = 'chat-tag'; tag.dataset.ch = m.ch
  tag.textContent = m.sys ? '公告' : LABEL[m.ch]
  const who = document.createElement('b'); who.textContent = m.sys ? '' : `${m.name}：`
  bubbleText.append(tag, who, document.createTextNode(m.text))
  registerPageUI(bubbleText,true)
}
function remaining() {
  if (mute.until === -1) return '永久'
  const s = Math.max(0, Math.ceil((mute.until - Date.now()) / 1000))
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60)
  return d ? `${d} 天 ${h} 小时` : h ? `${h} 小时 ${m} 分` : m ? `${m} 分 ${s % 60} 秒` : `${s} 秒`
}
function paintInput() {
  const muted = mute.until === -1 || mute.until > Date.now()
  root.dataset.muted = muted ? '1' : ''
  input.disabled = muted || !online
  muteLine.hidden = !muted
  if (muted) muteLine.textContent = `禁言中 · 剩余 ${remaining()}${mute.reason ? ` · ${mute.reason}` : ''}`
  input.placeholder = muted ? '禁言期间不能发言' : !online ? '联机后才能聊天'
    : channel === 'near' ? '对身边 60 米内的人说…' : '对全城的人说…'
  const n = length(input.value.trim())
  counter.textContent = `${length(input.value)}/${MAX}`
  counter.dataset.over = length(input.value) > MAX ? '1' : ''
  sendButton.disabled = muted || !online || sending || !n || length(input.value) > MAX
  clearInterval(muteTimer)
  if (muted && mute.until > 0) muteTimer = window.setInterval(() => { if (mute.until <= Date.now()) mute = {until: 0, reason: ''}; paintInput() }, 1000)
}
function grow() {
  input.style.height = 'auto'
  input.style.height = `${Math.min(input.scrollHeight, 78)}px`
}
function say(text: string, tone: 'warn' | 'ok' = 'warn') {
  notice.textContent = text
  notice.dataset.tone = tone
  notice.hidden = false
  clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => { notice.hidden = true }, 4200)
}

function select(ch: Channel) {
  channel = ch
  localStorage.setItem(CHANNEL_KEY, ch)
  unread[ch] = 0
  paintTabs(); paintInput(); paintList()
  // 切频道也重新拉一次最近 30 条：附近频道的可见范围随你的位置变
  if (online) chatStore.history(ch)
}
export function openChat(focus = false) {
  if (!root || !online) return
  open = true
  root.dataset.open = '1'
  unread[channel] = 0
  placePanel(); paintTabs(); paintInput(); paintList(); paintBubble()
  if (online) chatStore.history(channel)
  if (focus) requestAnimationFrame(() => input.focus({preventScroll: true}))
}
export function closeChat() {
  if (!root || !open) return
  open = false
  root.dataset.open = ''
  input.blur()
  paintBubble()
}

async function submit() {
  const text = input.value.trim()
  if (!text || sending || length(input.value) > MAX) return
  sending = true; paintInput()
  const ack: ChatAck = await chatStore.send(channel, text)
  sending = false
  if (ack.ok) { input.value = ''; grow(); notice.hidden = true }
  else if (ack.code === 'pending') { input.value = ''; grow(); say(ACK_TEXT.pending, 'ok') }
  else say(ack.code === 'blocked' && ack.msg ? ack.msg : ACK_TEXT[ack.code ?? 'error'] ?? ACK_TEXT.error)
  paintInput()
  if (open) input.focus({preventScroll: true})
}

function drag(handle: HTMLElement, mode: 'move' | 'height') {
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return
    event.preventDefault()
    handle.setPointerCapture(event.pointerId)
    const rect = panel.getBoundingClientRect()
    const start = {x: event.clientX, y: event.clientY, left: rect.left, bottom: innerHeight - rect.bottom, height: rect.height}
    root.dataset.dragging = mode
    const move = (e: PointerEvent) => {
      if (mode === 'move') box = {...box, left: start.left + e.clientX - start.x, bottom: start.bottom - (e.clientY - start.y)}
      else box = {...box, left: Number.isFinite(box.left) ? box.left : start.left, bottom: Number.isFinite(box.bottom) ? box.bottom : start.bottom, height: start.height - (e.clientY - start.y)}
      placePanel()
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      root.dataset.dragging = ''
      saveBox()
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end, {once: true})
    handle.addEventListener('pointercancel', end, {once: true})
  })
  handle.addEventListener('dblclick', () => { box = {left: NaN, bottom: NaN, height: 300}; saveBox(); placePanel() })
}

function build() {
  root = document.createElement('section')
  root.className = 'chat-dock'
  root.setAttribute('aria-label', '聊天')
  root.hidden = true
  root.innerHTML = `
    <button type="button" class="chat-bubble" title="聊天（回车）">
      <span class="chat-bubble-mark" aria-hidden="true">聊</span><span class="chat-bubble-text"></span><span class="chat-bubble-count" hidden></span>
    </button>
    <div class="chat-panel" role="dialog" aria-label="聊天">
      <div class="chat-grip" title="上下拖动调整高度，双击复位" aria-hidden="true"></div>
      <header class="chat-head" title="按住拖动位置，双击复位">
        <div class="chat-tabs" role="tablist">
          <button type="button" role="tab" class="chat-tab" data-ch="near">附近<small>60 m</small></button>
          <button type="button" role="tab" class="chat-tab" data-ch="world">世界</button>
        </div>
        <button type="button" class="chat-fold" aria-label="收起聊天" title="收起（Esc）">–</button>
      </header>
      <ol class="chat-list" aria-live="polite"></ol>
      <button type="button" class="chat-more" hidden></button>
      <div class="chat-foot">
        <p class="chat-notice" role="status" hidden></p>
        <p class="chat-mute" hidden></p>
        <div class="chat-compose">
          <textarea class="chat-input" rows="1" maxlength="${MAX * 2}" enterkeyhint="send" autocomplete="off"></textarea>
          <button type="button" class="chat-send">发送</button>
        </div>
        <div class="chat-meta"><span>回车发送 · Shift+回车换行</span><span class="chat-count"></span></div>
      </div>
    </div>`
  bubble = root.querySelector('.chat-bubble')!
  bubbleText = root.querySelector('.chat-bubble-text')!
  bubbleCount = root.querySelector('.chat-bubble-count')!
  panel = root.querySelector('.chat-panel')!
  list = root.querySelector('.chat-list')!
  more = root.querySelector('.chat-more')!
  input = root.querySelector('.chat-input')!
  counter = root.querySelector('.chat-count')!
  sendButton = root.querySelector('.chat-send')!
  notice = root.querySelector('.chat-notice')!
  muteLine = root.querySelector('.chat-mute')!
  tabs = {near: root.querySelector('[data-ch="near"]')!, world: root.querySelector('[data-ch="world"]')!}

  bubble.onclick = () => openChat(true)
  root.querySelector<HTMLButtonElement>('.chat-fold')!.onclick = closeChat
  for (const ch of ['near', 'world'] as Channel[]) tabs[ch].onclick = () => { if (ch !== channel) select(ch) }
  more.onclick = scrollToEnd
  list.addEventListener('scroll', () => { if (nearBottom() && !more.hidden) scrollToEnd() }, {passive: true})
  sendButton.onclick = () => void submit()
  input.addEventListener('input', () => { grow(); paintInput() })
  input.addEventListener('keydown', event => {
    event.stopPropagation()
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submit() }
    else if (event.key === 'Escape') { event.preventDefault(); closeChat() }
  })
  // 打字时别让 keyup 漏给走路/骑车（keydown 已经被输入框拦下）
  input.addEventListener('keyup', event => event.stopPropagation())
  drag(root.querySelector('.chat-head')!, 'move')
  drag(root.querySelector('.chat-grip')!, 'height')
  addEventListener('resize', () => { if (open) placePanel() })
  addEventListener('keydown', event => {
    if (event.code !== 'Enter' || event.repeat || event.defaultPrevented || !online || root.hidden) return
    if (isGlobalHotkeyBlocked(event.target)) return
    event.preventDefault()
    openChat(true)
  })
  document.body.append(root)
  registerPageUI(root)
}

export function mountChat() {
  if (root) return
  build()
  chatStore.subscribe(event => {
    switch (event.t) {
      case 'chat': {
        lists[event.ch] = merge(lists[event.ch], [event])
        if (!open || event.ch !== channel) unread[event.ch]++
        append(event); paintTabs(); paintBubble()
        break
      }
      case 'chat_hist': {
        lists[event.ch] = merge(event.ch === 'near' ? [] : lists[event.ch], event.msgs)
        loaded[event.ch] = true
        if (open && event.ch === channel) paintList()
        paintBubble()
        break
      }
      case 'chat_del': {
        for (const ch of ['near', 'world'] as Channel[]) lists[ch] = lists[ch].filter(m => m.mid !== event.mid)
        list?.querySelector(`[data-mid="${CSS.escape(event.mid)}"]`)?.remove()
        paintBubble()
        break
      }
      case 'chat_mute': {
        mute = {until: event.until, reason: event.reason || ''}
        paintInput()
        break
      }
      case 'chat_reset': {
        lists.near = []; lists.world = []
        unread.near = unread.world = 0
        loaded.near = loaded.world = false
        mute = {until: 0, reason: ''}
        paintList(); paintInput(); paintBubble()
        break
      }
    }
  })
  addEventListener('glol:mp-status', event => {
    const next = (event as CustomEvent<MpStatus>).detail.state === 'online'
    if (next === online) return
    online = next
    root.hidden = !online
    if (online) { chatStore.history('world'); chatStore.history('near') }
    else closeChat()
    paintInput(); paintBubble(); paintList()
  })
  chatStore.onSelf(uid => { myUid = uid })
  paintTabs(); paintInput(); paintBubble()
}
import {registerPageUI} from '../capture-page'
