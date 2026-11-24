// 同城在线名册（IDOK-222）：点 HUD 左下「同城 N 人」打开。按离你远近排，显示方位、距离、步行/骑车、在线时长；
// 点一行 = 在地图上找到他。只读 mp-roster，不碰 three。
import './mp-roster-panel.css'
import {bearing, locatePlayer, onRoster, roster, type Roster, type RosterPlayer} from '../mp-roster'

let panel: HTMLElement | undefined
let list: HTMLOListElement
let count: HTMLElement
let unsubscribe: (() => void) | undefined

function since(joinedAt?: number) {
  if (!joinedAt) return ''
  const minutes = Math.max(0, Math.round((Date.now() - joinedAt) / 60000))
  return minutes < 1 ? '刚上线' : minutes < 60 ? `在线 ${minutes} 分` : `在线 ${Math.floor(minutes / 60)} 时 ${minutes % 60} 分`
}
function doing(p: RosterPlayer) {
  if (p.bike) return '骑车'
  return p.v > 3 ? '奔跑' : p.v > .12 ? '步行' : '驻足'
}
function row(p: RosterPlayer, me: Roster['me']) {
  const li = document.createElement('li')
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'mp-roster-row'
  button.dataset.state = p.bike ? 'bike' : p.v > .12 ? 'move' : 'idle'
  button.title = '在地图上查看'
  const name = document.createElement('b'); name.textContent = p.name
  const id = document.createElement('small'); id.textContent = p.uid ? String(p.uid) : ''
  const where = document.createElement('span'); where.className = 'mp-roster-where'; where.textContent = me ? bearing(me, p) : ''
  const meta = document.createElement('span'); meta.className = 'mp-roster-meta'; meta.textContent = [doing(p), since(p.joinedAt)].filter(Boolean).join(' · ')
  button.append(name, id, where, meta)
  button.onclick = () => locatePlayer(p.id)
  li.append(button)
  return li
}

function paint(current: Roster) {
  if (!panel || panel.hidden) return
  const me = current.me
  const players = [...current.players].sort((a, b) => me ? Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z) : 0)
  count.textContent = `${players.length + 1} 人`
  // 列表内容变化才重排，避免 300 ms 一次的刷新打断正在点的手指
  const signature = players.map(p => `${p.id}|${me ? bearing(me, p) : ''}|${doing(p)}|${since(p.joinedAt)}`).join(';')
  if (list.dataset.signature === signature) return
  list.dataset.signature = signature
  list.replaceChildren(...players.map(p => row(p, me)))
  if (!players.length) {
    const empty = document.createElement('li'); empty.className = 'mp-roster-empty'
    empty.textContent = '城里暂时只有你一个人。叫上朋友登录，打开「同城联机」就能互相看见。'
    list.append(empty)
  }
}

function build() {
  panel = document.createElement('section')
  panel.className = 'mp-roster'
  panel.hidden = true
  panel.setAttribute('aria-label', '同城在线玩家')
  panel.innerHTML = `<header><h2>同城在线</h2><span class="mp-roster-count"></span><button type="button" class="mp-roster-close" aria-label="关闭">×</button></header>
    <ol></ol><p class="mp-roster-foot">点名字在地图上找人 · 走近 40 m 内可见头顶名牌</p>`
  list = panel.querySelector('ol')!
  count = panel.querySelector('.mp-roster-count')!
  panel.querySelector<HTMLButtonElement>('.mp-roster-close')!.onclick = closeRoster
  addEventListener('keydown', event => { if (event.code === 'Escape' && panel && !panel.hidden) closeRoster() })
  // 断开联机就收起
  addEventListener('glol:mp-status', event => { if ((event as CustomEvent<{state: string}>).detail.state !== 'online') closeRoster() })
  document.body.append(panel)
}

export function openRoster() {
  if (!panel) build()
  panel!.hidden = false
  delete list.dataset.signature
  requestAnimationFrame(() => panel!.classList.add('show'))
  unsubscribe ??= onRoster(paint)
  paint(roster())
}
export function closeRoster() {
  if (!panel || panel.hidden) return
  panel.classList.remove('show')
  unsubscribe?.(); unsubscribe = undefined
  setTimeout(() => { if (panel && !panel.classList.contains('show')) panel.hidden = true }, 180)
}
export function toggleRoster() { if (!panel || panel.hidden) openRoster(); else closeRoster() }
