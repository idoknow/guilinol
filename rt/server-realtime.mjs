/**
 * 网上桂林 · 联机服务（M1：全服一个大房间）
 *
 * 协议（JSON over WebSocket，路径 /ws）
 *   客户端 → 服务端
 *     {t:'join', ticket, avatar, x,y,z,yaw}
 *     {t:'pos', x,y,z, yaw, v, bike, bx,bz,byaw, hb,hx,hz,hyaw, mv,cr,gr,pn, sc,sb,sp,br}
 *     {t:'punch', id?, kind, zone, s} 命中帧（空拳省略 id）
 *     {t:'rescue-start', id} / {t:'rescue-stop'}
 *     {t:'avatar', avatar}
 *     {t:'who'}
 *     {t:'chat', ch, text, cid} / {t:'chat_hist', ch} (docs/chat.md)
 *   服务端 → 客户端
 *     {t:'welcome', me, online, players:[...]}
 *     {t:'join', player} / {t:'leave', id}
 *     {t:'pos', id, x,y,z,yaw,v,bike,bx,bz,byaw, hb,hx,hz,hyaw, mv,cr,gr,dn,pn,hp, sc,sb,sp,br}
 *     {t:'combat', id, hp, dn, remaining, helper, progress, ...event}
 *     {t:'avatar', id, avatar}
 *     chat / chat_ack / chat_hist / chat_del / chat_mute (docs/chat.md)
 *     {t:'online', online}
 *     {t:'banned', reason}
 *
 * 姿态 / 战斗字段（都在 pos 里顺带传，不额外开消息）
 *   mv  = 在不在动      cr  = 蹲着        gr  = 着地        dn  = 倒地        pn  = 正在出拳
 *   hp  = 血量 0..100（出手方靠它看到自己打掉了多少，也画在对方头顶那条小血条上）
 *   hit.by = 出手者昵称（显示用）、hit.byId = 出手者会话 id（被打方拿它算挨打方向）
 *
 * 抽烟字段（别人也能看见你点烟/吸烟的动作）
 *   sc  = 0 没抽 / 1 正在点烟 / 2 已经点着 / 3–8 掏盒到待点燃
 *   sb  = 剩余烟身比例 × 1800（0..1800）
 *   sp  = 吸了几口的累计计数（0..999），换值就说明刚吸了一口
 *   br  = 品牌序号（0..5），ss 是本口强度，sd 是丢弃次数
 *
 * HTTP
 *   GET  /health          → {ok:true, online, proto, maxPlayers, banned, connections}
 *                           （proto = 协议版本，见下面的 PROTO；探针只用 ok）
 *   POST /kick {uid,reason} → {ok:true, kicked}（需要 X-Kick-Token，和 KICK_TOKEN 一致）
 *
 * 运维语义（和协议无关，但线上排障要知道）
 *   1) 单副本：在线玩家 / 封禁表都在进程内存里，多副本就是多个互不相通的房间，
 *      所以 k8s 里固定 replicas: 1 + Recreate，不要 HPA。
 *   2) 封禁只在本进程内存里生效，TTL 默认 10 分钟（KICK_BAN_SECONDS 可改），
 *      重启即清空；要跨副本 / 跨重启就得接账号系统或外部存储，这段代码不承担。
 *   3) 距离校验：hit / revive 由服务端用双方最近一次上报的 pos 算水平距离，
 *      hit 超过 3.5 m、revive 超过 3 m 直接丢弃 —— 客户端坐标本身仍可伪造，
 *      这里挡的是「站在地图另一头打人 / 救人」，不是防透视自瞄。
 *   4) uid 未做鉴权，仅用于展示和 /kick 定位：真正的登录鉴权要接入账号系统。
 *      当前实现只能保证同一房间内 uid 不重复、格式干净，防不了恶意客户端。
 *   5) 连接数上限 MAX_PLAYERS（含还没 join 的 socket），另加每 IP 8 条；
 *      慢客户端发送缓冲超过 1 MB 就跳过广播，连续 60 次断开（1013）。
 *
 * 启动：PORT=8790 node server-realtime.mjs
 * 依赖：npm i ws
 */
import {combat, config as combatConfig, snapshot as combatSnapshot} from './combat.mjs'
import {flatDistance,inEmoteRange,acceptEmote} from './emote.mjs'
import {createServer} from 'node:http'
import {createHmac,timingSafeEqual} from 'node:crypto'
import {WebSocketServer} from 'ws'
import * as obs from './observability.mjs'
import {createChat} from './chat.mjs'
import {resolveClientIp} from './client-ip.mjs'

const PORT = Number(process.env.PORT || 8790)
// 单进程 Node 只能用 1 核：AOI 压测 300 人密集场景已接近 1 核，先按 300 封顶（IDOK-224）
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 300)
const TICK_MS = 1000
const KICK_TOKEN = process.env.KICK_TOKEN || ''
/** 被踢后的封禁时长（秒），只在本进程内存里生效 */
const KICK_BAN_SECONDS = Number(process.env.KICK_BAN_SECONDS || 600)
/** 单个 IP 最多几条连接（反代后按 x-forwarded-for 首个地址算） */
// 每个出口 IP 的连接上限。默认 0 = 不限：校园网、宿舍、网吧、运营商 CGNAT 会让几十个
// 真实玩家共用一个公网 IP，按 IP 掐是错的（实测第 9 个人就进不来）。
// 防滥用改由「同一 uid 只允许 1 条在线连接」+ 全局 MAX_PLAYERS + 未 join 超时 兜住；
// 真要应急限流，把 RT_MAX_PER_IP 设成正数即可恢复按 IP 限制。
const MAX_PER_IP = Number(process.env.RT_MAX_PER_IP || 0)
const JOIN_TIMEOUT_MS = Number(process.env.RT_JOIN_TIMEOUT_MS || 15000)
// 每个 IP 同时「已握手、还没 join」的连接上限。已 join 的玩家不受限（CGNAT 友好），
// 但单个 IP 不能靠只握手不 join 在 15 秒窗口内把全局 MAX_PLAYERS 占满。0 = 不限。
const MAX_PENDING_PER_IP = Number(process.env.RT_MAX_PENDING_PER_IP ?? 8)
const pendingIp = new Map()
/** 昵称长度上限（字符） */
const MAX_NAME = 16
/** 广播前允许的发送缓冲；超了就跳过，连续跳过 60 次直接断开，别让慢客户端拖垮内存 */
const MAX_BUFFERED = 1024 * 1024
const MAX_SLOW_SKIPS = 60
/** 同一个连接最快 20 Hz 上报位置，防止有人狂发把广播压垮 */
const MIN_POS_GAP_MS = 45
/** 外形数据上限（字节），超了直接丢弃，别让畸形包把别人的客户端搞崩 */
const MAX_AVATAR_BYTES = 512
/**
 * 续连宽限：CDN 的大陆节点 40–60 秒就会掐一次 WebSocket（实测香港节点 150 秒不断、
 * 直连源站 130 秒不断），所以这条链路上长连接注定被反复断开。
 * 客户端会自动重连，但服务端如果一断就按「离开」处理，别人会看到玩家反复进出、
 * 本人界面也会闪「联机中」。因此异常断开先保留会话：同 uid 在宽限期内回来就原地续上
 * （id、位置、血量都照旧，不播 leave/join），超时才真正离场。
 */
const RESUME_MS = Number(process.env.RT_RESUME_MS || 20000)
const RESUMABLE = code => code === 1006 || code === 1005 || code === 1001 || code === 1011 || code == null

/**
 * 协议版本。用 GET /health 就能看到线上跑的是哪一版 —— 改 `pos` / `hit` 的字段就 +1。
 *   1 = 只有位置
 *   2 = 加了 mv / cr / gr / dn / pn（蹲下、倒地、出拳、在不在动）
 *   3 = 加了 hp（血量）和 hit.byId（挨打方向）
 *   4 = join 必须提供 API 签发的短期 ticket
 */
const PROTO = 4

/** id → {ws, uid, name, avatar, x,y,z, yaw, v, bike, bx,bz,byaw, lastPos} */
const players = new Map()
/** 所有已建立的 WebSocket 连接（含还没 join 的），把「握完手不 join」也算进容量 */
const sockets = new Set()
/** 每个 IP 的当前连接数，防止一个客户端开几百条把房间挤满 */
const ipCounts = new Map()
/** uid → {until, reason}，被 /kick 踢过的 uid 在 until 之前不许重新 join */
const bans = new Map()
let nextId = 1

const now = () => Date.now()
const clampNum = (value, min, max, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}
const clampInt = (value, min, max, fallback = 0) => Math.round(clampNum(value, min, max, fallback))
const clampStr = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '')

/** uid 的唯一归一化入口：join 和 /kick 都走这里，否则「截断后再比较」永远对不上 */
const normalizeUid = value => {
  const uid = typeof value === 'number' ? value : typeof value === 'string' && /^[1-9]\d{5,}$/.test(value) ? Number(value) : NaN
  return Number.isSafeInteger(uid) && uid >= 100000 ? uid : null
}
function identity(ticket) {
  const secret = process.env.RT_JOIN_SECRET
  if (!secret || typeof ticket !== 'string') return null
  const parts = /^([\w-]{1,1024})\.([\w-]{43})$/.exec(ticket)
  if (!parts) return null
  const expected = createHmac('sha256', secret).update(parts[1]).digest('base64url')
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return null
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    const time = Math.floor(Date.now()/1000)
    if (Number.isSafeInteger(claims.exp) && claims.exp > time && claims.exp <= time+60 &&
        normalizeUid(claims.uid) !== null && typeof claims.name === 'string') return {...claims,uid:normalizeUid(claims.uid)}
  } catch {}
  return null
}

/** 昵称去控制字符 + 限长；空则给默认名，避免别人客户端里被塞换行 / 伪造昵称 */
function cleanName(value) {
  const text = typeof value === 'string' ? value : ''
  const cleaned = text
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029]/g, '')
    .trim()
    .slice(0, MAX_NAME)
  return cleaned || '游客'
}

const VALID_ACTIVITIES = new Set(['walk', 'idle', 'ebike', 'bicycle', 'car', 'boat', 'fishing', 'mifen', 'drone', 'photo', 'shop', 'mission', 'smoke'])
const TRACKED_GAMEPLAY = new Set(['ebike', 'bicycle', 'car', 'boat', 'fishing', 'mifen', 'drone', 'photo', 'shop', 'mission', 'smoke'])
function cleanDetail(value) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029]/g, '').trim().slice(0, 48)
    : ''
}
function setActivity(p, nextAct, nextDetail = '', at = now()) {
  if (!VALID_ACTIVITIES.has(nextAct)) return
  const detail = cleanDetail(nextDetail)
  const prevAct = p.activity || 'walk'
  const prevDetail = p.activityDetail || ''
  if (prevAct === nextAct && prevDetail === detail) return
  const durSec = Math.max(0, Math.round((at - (p.activitySince || p.joinedAt || at)) / 1000))
  if (prevAct && durSec > 0) {
    p.activityTotals[prevAct] = (p.activityTotals[prevAct] ?? 0) + durSec
  }
  p.activity = nextAct
  p.activityDetail = detail
  p.activitySince = at
  if (prevAct !== nextAct) {
    // 结束一个专项玩法（且持续 >= 5 秒）时落一条带时长的结束记录，方便回看该账号刚玩了多久
    if (TRACKED_GAMEPLAY.has(prevAct) && durSec >= 5) {
      obs.activity(p, { kind: 'activity_end', activity: prevAct, detail: prevDetail, durationSec: durSec, ts: at })
    }
    // 跳过 walk <-> idle 频繁抖动，仅在切到专项玩法或显著变化时记入开始记录
    const quietBounce = (prevAct === 'walk' && nextAct === 'idle') || (prevAct === 'idle' && nextAct === 'walk')
    if (!quietBounce) {
      obs.activity(p, { kind: 'activity', activity: nextAct, detail, ts: at })
    }
  } else if (TRACKED_GAMEPLAY.has(nextAct) && detail && detail !== prevDetail) {
    obs.activity(p, { kind: 'activity', activity: nextAct, detail, ts: at })
  }
}

/**
 * 取真实客户端 IP 与 CDN 节点 IP。
 *
 * 线上拓扑是 CDN 节点 → Traefik/nginx → rt，只有直连对端属于可信代理（内网/回环或 TRUSTED_PROXIES）
 * 时才采信转发头，且头里的值必须通过合法 IP 字面量校验，不合法则回退到 socket 地址。
 */
function clientIpInfo(req) {
  return resolveClientIp(req.headers, req.socket.remoteAddress || '')
}

// 排障用：一段时间打一条「这次连接命中了哪个头」，确认 CDN 到底传了什么
let ipDebugAt = 0
function ipDebug(req, info) {
  if (process.env.RT_IP_DEBUG !== '1') return
  const at = now()
  if (at - ipDebugAt < 5000) return
  ipDebugAt = at
  const names = ['cf-connecting-ip', 'x-real-ip', 'x-client-ip', 'true-client-ip', 'x-forwarded-for', 'forwarded']
  const seen = {}
  for (const name of names) if (req.headers[name] !== undefined) seen[name] = String(req.headers[name]).slice(0, 120)
  console.log(JSON.stringify({ scope: 'rt-ip', ip: info.clientIp, nodeIp: info.nodeIp, trusted: info.trusted, socket: req.socket.remoteAddress, headers: seen }))
}

/** 每次 join 顺手清掉过期封禁，不起 setInterval（避免泄漏） */
function sweepBans() {
  const at = now()
  for (const [uid, ban] of bans) {
    if (!ban || ban.until <= at) bans.delete(uid)
  }
}

/** 同一房间内 uid 唯一，重复就当「顶号」拒绝，否则后来者能冒用前者身份 */
function uidTaken(uid) {
  for (const p of players.values()) {
    if (p.uid === uid) return true
  }
  return false
}

const HAIRS = {
  m: ['m_buzz', 'm_crop', 'm_perm', 'm_fade', 'm_mullet', 'm_part'],
  f: ['f_long', 'f_pony', 'f_bun', 'f_lob', 'f_wolf', 'f_bangs'],
}
const LOOKS = ['basic', 'sport', 'outdoor', 'chinese', 'office', 'campus', 'hoodie', 'shell', 'denim', 'plaid', 'knit', 'track']

/** 外形白名单校验：只放行角色系统认识的字段和取值，避免脏数据传到别人客户端 */
function sanitizeAvatar(value) {
  if (!value || typeof value !== 'object') return null
  if (value.v !== 1) return null
  const body = value.body === 'm' || value.body === 'f' ? value.body : null
  if (!body) return null
  const hair = clampStr(value.hair, 16)
  const look = clampStr(value.look, 16)
  const avatar = {
    v: 1,
    body,
    skin: clampInt(value.skin, 0, 4),
    face: clampInt(value.face, 0, 5),
    brows: clampInt(value.brows, 0, 3),
    eyes: clampInt(value.eyes, 0, 3),
    hair: HAIRS[body].includes(hair) ? hair : HAIRS[body][0],
    hairColor: clampInt(value.hairColor, 0, 3),
    look: LOOKS.includes(look) ? look : 'basic',
    createdAt: clampInt(value.createdAt, 0, 4e12),
  }
  return JSON.stringify(avatar).length <= MAX_AVATAR_BYTES ? avatar : null
}

function send(ws, payload, type=payload.t, size) {
  if (ws?.readyState === 1) {
    try {
      if (ws.readyState !== 1) return   // 已断开（续连宽限期内被标记 dead）的连接不再写
      const text=typeof payload === 'string' ? payload : JSON.stringify(payload)
      ws.send(text)
      obs.packet(ws,'out',type,size??Buffer.byteLength(text))
    } catch {
      /* 单个连接写失败就忽略，别影响别人 */
    }
  }
}

/**
 * 广播专用发送：先看发送缓冲，堆积超过 1 MB 说明对面跟不上（或故意不收），
 * 这一条直接跳过；连续跳过 60 次基本就是死连接，close(1013) 交给 close 回调回收。
 */
function sendSlowAware(ws, text, type, size) {
  if (ws.bufferedAmount > MAX_BUFFERED) {
    ws.slowSkips = (ws.slowSkips || 0) + 1
    obs.skipped(ws,ws.slowSkips===MAX_SLOW_SKIPS)
    if (ws.slowSkips >= MAX_SLOW_SKIPS) {
      try { ws.close(1013, 'slow client') } catch { /* 忽略 */ }
    }
    return
  }
  ws.slowSkips = 0
  send(ws, text,type,size)
}

function broadcast(payload, exceptId) {
  const text = JSON.stringify(payload)
  const size=Buffer.byteLength(text)
  for (const [id, p] of players) {
    if (id === exceptId) continue
    sendSlowAware(p.ws, text,payload.t,size)
  }
}


/* ───────────── AOI（兴趣范围裁剪） ───────────── */
// 100m 网格：同格 + 邻格（3×3）20Hz；外面一圈但 ≤150m 降到 5Hz；超过 150m 才移出视野（滞回）。
// 广播成本从 O(n²) 降到 O(n × 视野人数)。
const CELL = Number(process.env.RT_CELL || 100)
const AOI_HOLD = Number(process.env.RT_AOI_HOLD || 150)
const AOI_FAR_MS = Number(process.env.RT_AOI_FAR_MS || 200)
const ROSTER_MS = Number(process.env.RT_ROSTER_MS || 5000)
const GRID_RADIUS = 2
const grid = new Map()
const cellKey = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`

function gridAdd(p) {
  const key = cellKey(p.x, p.z)
  let set = grid.get(key)
  if (!set) grid.set(key, (set = new Set()))
  set.add(p.id)
  p.cell = key
}
function gridDel(p) {
  if (!p.cell) return
  const set = grid.get(p.cell)
  if (!set) return
  set.delete(p.id)
  if (!set.size) grid.delete(p.cell)
}
/** p 现在能看到谁：near = 3×3 内（20Hz），far = 外圈但 ≤150m（5Hz，含滞回保留） */
function aoiTargets(p) {
  const [cx, cz] = p.cell.split(',').map(Number)
  const near = new Set()
  const far = new Set()
  for (let dx = -GRID_RADIUS; dx <= GRID_RADIUS; dx++) {
    for (let dz = -GRID_RADIUS; dz <= GRID_RADIUS; dz++) {
      const set = grid.get(`${cx + dx},${cz + dz}`)
      if (!set) continue
      const inner = Math.max(Math.abs(dx), Math.abs(dz)) <= 1
      for (const id of set) {
        if (id === p.id) continue
        const q = players.get(id)
        if (!q) continue
        if (inner) near.add(id)
        else if (flatDistance(p, q) <= AOI_HOLD) far.add(id)
      }
    }
  }
  for (const id of p.visible) {
    if (near.has(id) || far.has(id)) continue
    const q = players.get(id)
    if (q && flatDistance(p, q) <= AOI_HOLD) far.add(id)
  }
  return { near, far }
}
/** 新增可见关系：双向登记并补一帧完整状态（不等下一条 pos） */
function aoiAttach(p, q, announceSelf = true) {
  if (!p.visible.has(q.id)) {
    p.visible.add(q.id)
    send(p.ws, { t: 'join', player: publicOf(q, p) })
  }
  if (!q.visible.has(p.id)) {
    q.visible.add(p.id)
    if (announceSelf) send(q.ws, { t: 'join', player: publicOf(p, q) })
  }
}
function aoiDetach(p, q) {
  if (p.visible.delete(q.id)) send(p.ws, { t: 'leave', id: q.id })
  if (q.visible.delete(p.id)) send(q.ws, { t: 'leave', id: p.id })
  p.farSent.delete(q.id)
  q.farSent.delete(p.id)
}
function aoiRefresh(p) {
  const { near, far } = aoiTargets(p)
  const next = new Set([...near, ...far])
  for (const id of next) {
    const q = players.get(id)
    if (q) aoiAttach(p, q)
  }
  for (const id of [...p.visible]) {
    if (next.has(id)) continue
    const q = players.get(id)
    if (q) aoiDetach(p, q)
    else { p.visible.delete(id); p.farSent.delete(id) }
  }
  p.far = far
  for (const id of [...p.farSent.keys()]) if (!far.has(id)) p.farSent.delete(id)
  // 分级是双向的：对方的分级跟着更新，否则站着不动的人发给走近者的频率会是旧的
  for (const id of near) { const q = players.get(id); if (q) q.far.delete(p.id) }
  for (const id of far) { const q = players.get(id); if (q) q.far.add(p.id) }
}
/** 跨格才重算，别每帧重建网格 */
function aoiMove(p) {
  const key = cellKey(p.x, p.z)
  if (key === p.cell) return
  gridDel(p)
  gridAdd(p)
  aoiRefresh(p)
}
/** 按视野发送：远端 5Hz 节流 */
function aoiSend(p, payload) {
  const text = JSON.stringify(payload)
  const size = Buffer.byteLength(text)
  const at = now()
  for (const id of p.visible) {
    const q = players.get(id)
    if (!q) continue
    if (p.far.has(id)) {
      const last = p.farSent.get(id) || 0
      if (at - last < AOI_FAR_MS) continue
      p.farSent.set(id, at)
    }
    sendSlowAware(q.ws, text, payload.t, size)
  }
}
/**
 * 统一的离场清理：网格、别人的 visible、leave 广播、players 表。
 * release（连接断开）和顶号（新设备接管）都必须走这里，否则网格里会留下死 id。
 */
function removePlayer(p, extra = {}) {
  if (!p || !players.has(p.id)) return false
  const at = now()
  if(p.helping)fight.cancel(p,at)
  if(p.helper){const helper=players.get(p.helper);if(helper)fight.cancel(helper,at)}
  const finalTotals = obs.liveTotals(p, at)
  p.activityTotals = finalTotals
  p.activitySince = at
  gridDel(p)
  for (const peerId of [...p.visible]) {
    const peer = players.get(peerId)
    if (peer) { peer.visible.delete(p.id); peer.farSent.delete(p.id); send(peer.ws, { t: 'leave', id: p.id }) }
  }
  p.visible.clear()
  p.farSent.clear()
  players.delete(p.id)
  obs.event('leave', p, { ...extra, activityTotals: finalTotals })
  obs.activity(p, {
    kind: 'leave',
    activity: p.activity ?? null,
    detail: extra?.reason ? String(extra.reason) : '',
    durationSec: p.joinedAt ? Math.floor((at - p.joinedAt) / 1000) : null,
    ts: at,
  })
  broadcast({ t: 'online', online: players.size })
  return true
}
/** 全服用低频名册：地图/名册面板要看到整座城的人，3D 场景仍然只来自 AOI */
function rosterPayload() {
  const list = []
  for (const p of players.values()) list.push([p.id, p.name, Math.round(p.x), Math.round(p.z), p.joinedAt])
  return { t: 'roster', players: list }
}

// ── 名册增量（roster2）──────────────────────────────────────────────
// 全量名册的带宽是 O(n²)：每人每 5 秒收一次全城名单，1000 人时约 76 Mbps。
// 支持 caps:['roster2'] 的客户端改为收增量（只发新增/离开/移动≥2m 的人），
// 每 RT_ROSTER_FULL_MS 强制一次全量对账，防止长期漂移。
// 老客户端仍然收全量 roster，行为完全不变。
const ROSTER_FULL_MS = Number(process.env.RT_ROSTER_FULL_MS || 30000)   // 未订阅者：低频全量
const ROSTER_SUB_MS = Number(process.env.RT_ROSTER_SUB_MS || 5000)      // 订阅者：增量间隔
const ROSTER_MOVE_M = Number(process.env.RT_ROSTER_MOVE_M || 8)         // 增量阈值（缩略图上 <2px）
const ROSTER_SUB_RADIUS = Number(process.env.RT_ROSTER_SUB_RADIUS || 500)
const ROSTER_SUB_TTL_MS = Number(process.env.RT_ROSTER_SUB_TTL_MS || 90000)
const ROSTER_FULL_QPS = Number(process.env.RT_ROSTER_FULL_QPS || 15)    // 全量快照全服限速
const ROSTER_HIST_MS = 60000

let rosterSnap = new Map()   // id -> {x, z, name}
let rosterV = 0
let rosterHist = []          // [{v, at, add, up, del, total}]，保留 60s 供 since 补发
const fullQueue = []         // 等全量快照的 socket（全局限速）

function rosterDelta() {
  const add = [], up = [], del = []
  const next = new Map()
  for (const p of players.values()) {
    const x = Math.round(p.x), z = Math.round(p.z)
    const prev = rosterSnap.get(p.id)
    next.set(p.id, { x, z, name: p.name })
    if (!prev || prev.name !== p.name) add.push([p.id, p.name, x, z])
    else if (Math.abs(prev.x - x) + Math.abs(prev.z - z) >= ROSTER_MOVE_M) up.push([p.id, x, z])
  }
  for (const id of rosterSnap.keys()) if (!next.has(id)) del.push(id)
  rosterSnap = next
  return { add, up, del, total: next.size }
}

function pushHist(entry) {
  rosterHist.push(entry)
  const cut = Date.now() - ROSTER_HIST_MS
  while (rosterHist.length && rosterHist[0].at < cut) rosterHist.shift()
}

/** 订阅者立刻能用的快照：附近 ROSTER_SUB_RADIUS 内的人 + 总人数 */
function nearPayload(me) {
  const near = []
  for (const p of players.values()) {
    if (me && p.id === me.id) continue
    if (me && flatDistance(p, me) > ROSTER_SUB_RADIUS) continue
    near.push([p.id, p.name, Math.round(p.x), Math.round(p.z)])
  }
  return { t: 'roster3', v: rosterV, near, total: players.size, radius: ROSTER_SUB_RADIUS }
}

/** since 命中历史就补发增量，避免重开地图/断线续连时重拉 50KB 全量 */
function replaySince(ws, since) {
  const idx = rosterHist.findIndex(e => e.v === since)
  if (idx < 0) return false
  const add = [], up = [], del = []
  for (const e of rosterHist.slice(idx + 1)) { add.push(...e.add); up.push(...e.up); del.push(...e.del) }
  send(ws, { t: 'roster3', v: rosterV, add, up, del, total: players.size })
  return true
}

function publicOf(p,viewer=p) {
  return {
    id: p.id, uid: p.uid, name: p.name, avatar: p.avatar, jt:p.joinedAt,
    x: p.x, y: p.y, z: p.z, yaw: p.yaw, v: p.v,
    foot:p.foot, bike: p.bike, bx: p.bx, bz: p.bz, byaw: p.byaw,
    hb: p.hb, hx: p.hx, hz: p.hz, hyaw: p.hyaw, mv: p.mv, pn: p.pn, wl: p.wl, cr: p.cr, gr: p.gr,
    ...combatSnapshot(p,now()), em:inEmoteRange(p,viewer)&&now()<p.emoteUntil?p.em:0, es:p.es,
    sc: p.sc, sb: p.sb, sp: p.sp, br: p.br, ss:p.ss, sd:p.sd, sr:p.sr,
  }
}

const fight=combat(players,(p,packet)=>{
  send(p.ws,packet)
  for(const id of p.visible)send(players.get(id)?.ws,packet)
})
setInterval(()=>fight.tick(now()),100).unref()
const chat=createChat({players,send,observed:obs.chatted})
const server = createServer(async(req, res) => {
  try {
    if(req.url==='/admin/chat'&&req.method==='POST'){
      if(!process.env.RT_ADMIN_TOKEN||req.headers['x-admin-token']!==process.env.RT_ADMIN_TOKEN){res.writeHead(403);res.end();return}
      let body='';for await(const chunk of req){body+=chunk;if(body.length>32768){res.writeHead(413);res.end();return}}
      try{const data=await chat.admin(JSON.parse(body));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data))}catch(error){res.writeHead(error.status??503);res.end(JSON.stringify({error:error.status?error.message:'chat unavailable'}))}return
    }
    if(req.method==='GET'&&req.url==='/admin/state'){
      if(!process.env.RT_ADMIN_TOKEN||req.headers['x-admin-token']!==process.env.RT_ADMIN_TOKEN){res.writeHead(403);res.end();return}
      sweepBans();res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'})
      res.end(JSON.stringify(obs.state(players,sockets,bans,PROTO,MAX_PLAYERS)));return
    }
    if (req.url === '/health') {
      res.writeHead(200, {'content-type': 'application/json'})
      // 保留 ok / online / proto 三个老字段（探针和监控在用），后面只是补容量信息
      res.end(JSON.stringify({
        ok: true,
        online: players.size,
        proto: PROTO,
        maxPlayers: MAX_PLAYERS,
        banned: bans.size,
        connections: sockets.size,
        chatBacklog: chat.backlog(),
        loopP99Ms: +obs.loopP99().toFixed(1),
      }))
      return
    }

    if (req.url === '/kick' && req.method === 'POST') {
      // 没配 token 就直接 403，一个连接都不碰：否则 /kick 等于把踢人权公开
      if (!KICK_TOKEN) {
        res.writeHead(403, {'content-type': 'application/json'})
        res.end('{"ok":false,"error":"kick disabled"}')
        return
      }
      let raw = ''
      req.on('data', chunk => { raw += chunk; if (raw.length > 4096) req.destroy() })
      req.on('end', () => {
        try {
          if (req.headers['x-kick-token'] !== KICK_TOKEN) {
            res.writeHead(401, {'content-type': 'application/json'})
            res.end('{"ok":false}')
            return
          }
          let body
          try {
            body = JSON.parse(raw || '{}')
          } catch {
            res.writeHead(400, {'content-type': 'application/json'})
            res.end('{"ok":false,"error":"bad json"}')
            return
          }
          // null / 数组 / 标量都当坏请求，别在 body.uid 上崩掉
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            res.writeHead(400, {'content-type': 'application/json'})
            res.end('{"ok":false,"error":"bad body"}')
            return
          }
          // 和 join 走同一个归一化，超长 / 带脏字符的 uid 也能匹配上
          const uid = normalizeUid(body.uid)
          // 空 uid 会匹配「所有匿名玩家」，必须挡住，一个都不踢
          if (!uid) {
            res.writeHead(400, {'content-type': 'application/json'})
            res.end('{"ok":false,"error":"uid required"}')
            return
          }
          const reason = clampStr(body.reason, 200).trim() || '账号已被封禁'
          // 只写内存封禁表（带 TTL），重启即失，够用来挡住「被踢后立刻重连」
          const minutes=body.minutes
          if(minutes!==undefined&&(!Number.isInteger(minutes)||minutes<1||minutes>10080)){res.writeHead(400);res.end('{}');return}
          bans.set(uid, {until: now() + (minutes===undefined?KICK_BAN_SECONDS:minutes*60) * 1000, reason})
          const target=[...players.values()].find(p=>p.uid===uid)
          obs.event('kick',target??{uid},{reason});obs.activity(target??{uid,name:''},{kind:'kick',detail:reason});if(target)target.kickReason=reason
          let kicked = 0
          for (const p of players.values()) {
            if (p.uid !== uid) continue
            send(p.ws, {t: 'banned', reason})
            setTimeout(() => { try { p.ws.close(4003, 'banned') } catch { /* 忽略 */ } }, 60)
            kicked++
          }
          res.writeHead(200, {'content-type': 'application/json'})
          res.end(JSON.stringify({ok: true, kicked}))
        } catch (err) {
          // 异常只记日志，不能把进程带走
          console.warn('[kick] 处理失败', err && err.message)
          if (!res.headersSent) {
            res.writeHead(500, {'content-type': 'application/json'})
            res.end('{"ok":false}')
          }
        }
      })
      return
    }

    res.writeHead(426, {'content-type': 'text/plain; charset=utf-8'})
    res.end('WebSocket only')
  } catch (err) {
    console.warn('[http] 处理失败', err && err.message)
    if (!res.headersSent) {
      res.writeHead(500, {'content-type': 'text/plain; charset=utf-8'})
      res.end('error')
    }
  }
})

const wss = new WebSocketServer({server, path: '/ws', maxPayload: 4096})

wss.on('connection', (ws, req) => {
  let ip = 'unknown'
  let nodeIp = null
  try {
    const ipInfo = clientIpInfo(req)
    ip = ipInfo.clientIp
    nodeIp = ipInfo.nodeIp
    ipDebug(req, ipInfo)
    // 容量按「所有连接」算：只数 players 的话，握完手不 join 就能无限占连接
    if (sockets.size >= MAX_PLAYERS) {
      console.warn(JSON.stringify({scope:'rt-reject',reason:'full',ip,players:players.size,sockets:sockets.size}))
      obs.reject('full')
      send(ws, {t: 'error', message: '服务器满员'})
      ws.close(1013, 'full')
      return
    }
    const used = ipCounts.get(ip) || 0
    if (MAX_PER_IP > 0 && used >= MAX_PER_IP) {
      // 排障要能看到到底是「满员」还是「同一出口 IP 挤爆」，否则线上只能靠猜
      console.warn(JSON.stringify({scope:'rt-reject',reason:'per-ip',ip,used,max:MAX_PER_IP,players:players.size,sockets:sockets.size}))
      obs.reject('ipLimit')
      send(ws, {t: 'error', message: '连接数过多'})
      ws.close(1013, 'too many connections')
      return
    }
    const pending = pendingIp.get(ip) || 0
    if (MAX_PENDING_PER_IP > 0 && pending >= MAX_PENDING_PER_IP) {
      obs.reject('ipLimit')
      console.warn(JSON.stringify({scope:'rt-reject',reason:'pending-per-ip',ip,pending,max:MAX_PENDING_PER_IP,players:players.size,sockets:sockets.size}))
      send(ws, {t: 'error', message: '连接数过多'})
      ws.close(1013, 'too many pending connections')
      return
    }
    sockets.add(ws)
    ipCounts.set(ip, used + 1)
    pendingIp.set(ip, pending + 1)
    ws.pending = true
    // 没有按 IP 限制以后，防的是「只握手不 join」白占名额：15 秒内不 join 直接收回
    ws.joinTimer = setTimeout(() => {
      if (!ws.joined) { try { ws.close(1008, 'join timeout') } catch { /* 忽略 */ } }
    }, JOIN_TIMEOUT_MS)
  } catch (err) {
    console.warn('[ws] 建连失败', err && err.message)
    try { ws.close(1011, 'error') } catch { /* 忽略 */ }
    return
  }

  const id = String(nextId++)
  ws.isAlive = true
  ws.on('pong', data => { ws.isAlive = true
    ws.lastPongAt=now()
    if(ws.pingStamp&&data.toString()===String(ws.pingStamp)){
      ws.rtt=performance.now()-ws.pingStamp;ws.pingStamp=0;ws.pongs=(ws.pongs??0)+1
      ws.meanRtt=(ws.meanRtt??0)+(ws.rtt-(ws.meanRtt??0))/ws.pongs
    }
  })

  // 连接回收：容量计数要减回去，ipCounts 不能只增不减
  const unpend = () => {
    if (!ws.pending) return
    ws.pending = false
    const left = (pendingIp.get(ip) || 1) - 1
    if (left > 0) pendingIp.set(ip, left)
    else pendingIp.delete(ip)
  }
  const release = (code, reason) => {
    clearTimeout(ws.joinTimer)
    unpend()
    // 续连过的连接：玩家登记在原 id 上（ws.playerId），按它找
    const pid = ws.playerId ?? id
    const joined = players.has(pid)
    if (sockets.delete(ws)) {
      const left = (ipCounts.get(ip) || 1) - 1
      if (left > 0) ipCounts.set(ip, left)
      else ipCounts.delete(ip)
    }
    // 关闭原因必须留痕：线上「联机不稳定」时，没有这行就只能靠猜是超时、满员还是顶号
    if (joined) console.log(JSON.stringify({scope:'rt-close',code:code??null,reason:String(reason??''),ip,nodeIp,uid:players.get(pid)?.uid??null,players:players.size}))
    if (joined) {
      const player=players.get(pid)
      // 竞态：旧 socket 的 close 晚到（新 socket 已经续连上了）——绝不能把活着的会话判死
      if (player && player.ws !== ws) {
        console.log(JSON.stringify({scope:'rt-stale-close',uid:player.uid,pid,code:code??null}))
        return
      }
      if(player?.helping)fight.cancel(player,now())
      if(player?.helper){const helper=players.get(player.helper);if(helper)fight.cancel(helper,now())}
      // 异常断开（CDN 掐连接、切网络、手机息屏）先保留会话，等同 uid 回来续连；
      // 主动关闭（pagehide/dispose）、被踢被封、顶号都不保留，避免留下假在线。
      if (player && RESUMABLE(code) && !player.kickReason && !player.replaced) {
        player.dead = true
        player.deadAt = now() + RESUME_MS
        player.lastCloseCode = code ?? null
        console.log(JSON.stringify({scope:'rt-hold',uid:player.uid,id:pid,code:code??null,holdMs:RESUME_MS,players:players.size}))
        return
      }
      removePlayer(player,{closeCode:code,reason:player?.kickReason||String(reason??'')})
    }
  }

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(String(raw))
      obs.packet(ws,'in',msg?.t,raw.length)
      // null / 数组 / 标量都不是合法消息，直接忽略（否则读 msg.t 会抛）
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return
      const me = players.get(ws.playerId??id)

      if (msg.t === 'join' && !me) {
        // 已经被拒（封禁 / 顶号）的连接不再给第二次机会
        if (ws.rejected) return
        // join 时再查一次：握手到 join 之间可能已经挤满
        if (players.size >= MAX_PLAYERS) {
          obs.reject('full')
          send(ws, {t: 'error', message: '服务器满员'})
          ws.close(1013, 'full')
          return
        }
        // 顺手清掉过期封禁，不起 setInterval（避免泄漏）
        sweepBans()
        // 客户端能力位：支持增量名册的客户端才收 roster2，老客户端继续收全量
        ws.roster2 = Array.isArray(msg.caps) && msg.caps.includes('roster2')
        const claims = identity(msg.ticket)
        if (!claims) { obs.reject('ticket');ws.rejected = true; ws.close(4003, 'ticket rejected'); return }
        const uid = claims.uid
        const ban = bans.get(uid)
        if (ban && ban.until > now()) {
          obs.reject('banned',{uid,name:cleanName(claims.name)})
          ws.rejected = true
          send(ws, {t: 'banned', reason: ban.reason || '账号已被封禁'})
          setTimeout(() => { try { ws.close(4003, 'banned') } catch { /* 忽略 */ } }, 60)
          return
        }
        // 同房间 uid 必须唯一，否则后来者能直接冒用前者的身份。
        // 冲突时让**新连接顶掉旧连接**（旧连接收 4001 'replaced'，客户端收到后不再自动重连）：
        // 原来「拒绝后来者」的写法会让用户换设备后一直连不上，还以为服务坏了。
        const previous = [...players.values()].find(p => p.uid === uid)
        if (previous && previous.ws !== ws) {
          // 续连：上一个连接是被 CDN/网络掐断的（dead），不是顶号。原地接管，不播 leave/join。
          if (previous.dead) {
            const p = previous
            const gapMs = Math.max(0, Math.round(now() - (p.deadAt - RESUME_MS)))
            p.ws = ws
            // 关键：这条 socket 的连接 id 是新的，后续 pos/close 必须按原玩家 id 找，
            // 否则续连后玩家在服务端「消失了」（消息被丢弃、断开也不清理）
            ws.playerId = p.id
            delete p.dead
            delete p.deadAt
            p.ip = ip
            p.nodeIp = nodeIp
            p.ua = clampStr(req.headers['user-agent'], 200)
            p.lastPos = 0            // 新连接的第一条 pos 不能被 MIN_POS_GAP_MS 挡掉
            ws.joined = true
            clearTimeout(ws.joinTimer)
            unpend()
            const { near, far } = aoiTargets(p)
            p.far = far
            p.visible.clear()
            p.farSent.clear()
            const visible = [...new Set([...near, ...far])]
            for (const peerId of visible) {
              p.visible.add(peerId)
              const peer = players.get(peerId)
              if (!peer || peer.dead) continue
              if (!peer.visible.has(p.id)) {
                peer.visible.add(p.id)
                send(peer.ws, { t: 'join', player: publicOf(p, peer) })
              }
            }
            send(ws, {
              t: 'welcome',
              me: { id: p.id, uid: p.uid, name: p.name, avatar: p.avatar, x: p.x, z: p.z, ...combatSnapshot(p,now()), resumed: true },
              online: players.size,
              players: visible.map(peerId => players.get(peerId)).filter(Boolean).map(q => publicOf(q, p)),
            })
            send(ws, rosterPayload())
            obs.event('resume', p)
            console.log(JSON.stringify({
              scope: 'rt-resume', uid, id: p.id,
              code: p.lastCloseCode ?? null,
              gapMs,
              players: players.size,
            }))
            delete p.lastCloseCode
            return
          }
          previous.ws.rejected = true
          previous.replaced = true
          // 走统一清理：网格、别人的 visible 都要摘掉，否则会留下永远不动的幽灵
          removePlayer(previous, {closeCode:4001, reason:'replaced'})
          try { previous.ws.close(4001, 'replaced') } catch { /* 忽略 */ }
          console.log(JSON.stringify({scope: 'rt-replace', uid, oldId: previous.id, newId: id}))
        }
        const initAct = VALID_ACTIVITIES.has(msg.act) ? msg.act : 'walk'
        const initDetail = cleanDetail(msg.actDetail)
        const joinedAt = now()
        const player = {
          joinedAt,ip,nodeIp,ua:clampStr(req.headers['user-agent'],200),positions:[],chats:0,
          activity: initAct, activityDetail: initDetail, activitySince: joinedAt, activityTotals: {},
          activityExplicit: VALID_ACTIVITIES.has(msg.act), lastMoveAt: joinedAt, lastActAt: 0,
          id,
          ws,
          uid,
          name: cleanName(claims.name),
          openid: typeof claims.wx_openid==='string'?claims.wx_openid:undefined,
          avatar: sanitizeAvatar(msg.avatar),
          x: clampNum(msg.x, -1e5, 1e5),
          y: clampNum(msg.y, -1000, 8000),
          z: clampNum(msg.z, -1e5, 1e5),
          yaw: clampNum(msg.yaw, -10, 10),
          v: 0,
          bike: '',
          bx: 0,
          bz: 0,
          byaw: 0,
          hb: 0,
          hx: 0,
          hz: 0,
          hyaw: 0,
          mv: 0,
          dn: 0,
          pn: 0,
          wl: 0,
          cr: 0,
          gr: 1,
          foot: msg.foot!==false,
          hp: combatConfig.hpMax,
          sc: 0,
          sb: 0,
          sp: 0,
          br: 0, ss:1, sd:0, sr:20,
          em:0, es:0, emoteTimes:[], emoteUntil:0,
          lastPos: 0,
          cell: '',
          visible: new Set(),
          far: new Set(),
          farSent: new Map(),
        }
        ws.joined = true
        clearTimeout(ws.joinTimer)
        unpend()
        players.set(id, player)
        void chat.joined(player)
        gridAdd(player)
        // 先把可见集合算出来：新玩家这一侧靠 welcome 的列表就够了，不再逐条发 join 给自己，
        // 对端则要一条 join（带完整状态），否则对方要等到自己下次移动才能看见新来的人。
        const { near, far } = aoiTargets(player)
        player.far = far
        const visible = [...new Set([...near, ...far])]
        for (const peerId of visible) {
          player.visible.add(peerId)
          const peer = players.get(peerId)
          if (!peer) continue
          if (!peer.visible.has(id)) {
            peer.visible.add(id)
            send(peer.ws, { t: 'join', player: publicOf(player, peer) })
          }
        }
        obs.joined(player,players.size)
        send(ws, {
          t: 'welcome',
          me: {...combatSnapshot(player,now()), id, uid: player.uid, name: player.name, avatar: player.avatar},
          online: players.size,
          players: visible.map(peerId => players.get(peerId)).filter(Boolean).map(p=>publicOf(p,player)),
        })
        // 全服名册立刻给一份，不用等下一个 5s 周期
        send(ws, rosterPayload())
        broadcast({t: 'online', online: players.size})
        return
      }

      if (!me) return

      if (msg.t === 'emote') {
        if (!acceptEmote(me,msg,now())) return
        obs.activity(me,{kind:'emote',activity:me.activity,detail:`表情 #${me.em}`})
        const packet=JSON.stringify({t:'emote',from:me.id,id:me.em,s:me.es})
        for(const peerId of me.visible){const peer=players.get(peerId);if(peer&&inEmoteRange(peer,me))sendSlowAware(peer.ws,packet,'emote')}
        return
      }

      if (msg.t === 'act') {
        const at = now()
        if (!VALID_ACTIVITIES.has(msg.act)) return
        if (at - (me.lastActAt || 0) < 200) return
        me.lastActAt = at
        me.activityExplicit = true
        setActivity(me, msg.act, msg.detail, at)
        return
      }

      if (msg.t === 'pos') {
        const at = now()
        if (at - me.lastPos < MIN_POS_GAP_MS) return
        me.lastPos = at
        obs.position(me,at)
        me.x = clampNum(msg.x, -1e5, 1e5)
        me.y = clampNum(msg.y, -1000, 8000)
        me.z = clampNum(msg.z, -1e5, 1e5)
        me.yaw = clampNum(msg.yaw, -10, 10)
        me.v = clampNum(msg.v, 0, 120)
        me.foot = msg.foot!==false
        me.bike = clampStr(msg.bike, 32)
        me.bx = clampNum(msg.bx, -1e5, 1e5)
        me.bz = clampNum(msg.bz, -1e5, 1e5)
        me.byaw = clampNum(msg.byaw, -20, 20)
        me.mv = clampNum(msg.mv, 0, 1)

        me.pn = clampNum(msg.pn, 0, 1)
        me.wl = clampNum(msg.wl, 0, 1)
        me.hb = clampNum(msg.hb, 0, 1)
        me.hx = clampNum(msg.hx, -1e5, 1e5)
        me.hz = clampNum(msg.hz, -1e5, 1e5)
        me.hyaw = clampNum(msg.hyaw, -20, 20)
        me.cr = clampNum(msg.cr, 0, 1)
        me.gr = clampNum(msg.gr, 0, 1, 1)
        me.sc = clampInt(msg.sc, 0, 9)
        me.sb = clampInt(msg.sb, 0, 1800)
        me.sp = clampInt(msg.sp, 0, 999)
        me.sr = clampInt(msg.sr, 0, 20, 20)
        me.sd = clampInt(msg.sd, 0, 999)
        me.ss = clampInt(msg.ss, 1, 2, 1)
        me.br = clampInt(msg.br, 0, 11)
        if (me.v > 0.12) me.lastMoveAt = at
        if (!me.activityExplicit) {
          const inferred = me.bike || me.hb ? 'ebike' : me.sc > 0 ? 'smoke' : me.v > 0.12 ? 'walk' : (at - (me.lastMoveAt || me.joinedAt) > 15000 ? 'idle' : me.activity)
          setActivity(me, inferred, '', at)
        }
        aoiMove(me)
        aoiSend(me, {
          t: 'pos', id: me.id,
          x: me.x, y: me.y, z: me.z, yaw: me.yaw, v: me.v,
          foot:me.foot, bike: me.bike, bx: me.bx, bz: me.bz, byaw: me.byaw,
          hb: me.hb, hx: me.hx, hz: me.hz, hyaw: me.hyaw, mv: me.mv, cr: me.cr, gr: me.gr, dn: me.dn, pn: me.pn, wl: me.wl,
          hp: me.hp,
          sc: me.sc, sb: me.sb, sp: me.sp, br: me.br, ss:me.ss, sd:me.sd, sr:me.sr,
        })
        return
      }

      if (['windup','punch','rescue-start','rescue-stop'].includes(msg.t)) {
        fight.input(me,msg,now())
        return
      }

      if (msg.t === 'avatar') {
        const avatar = sanitizeAvatar(msg.avatar)
        if (!avatar) return
        me.avatar = avatar
        obs.activity(me,{kind:'avatar',activity:me.activity,detail:avatar.look})
        for (const peerId of me.visible) { const peer = players.get(peerId); if (peer) sendSlowAware(peer.ws, JSON.stringify({t:'avatar',id:me.id,avatar}), 'avatar') }
        return
      }

      if (msg.t === 'roster_sub') {
        ws.rosterSub = { at: now() }
        send(ws, nearPayload(me))
        if (typeof msg.since === 'number' && replaySince(ws, msg.since)) return
        fullQueue.push(ws)
        return
      }
      if (msg.t === 'roster_unsub') { ws.rosterSub = null; return }
      if (msg.t === 'roster_ping') { if (ws.rosterSub) ws.rosterSub.at = now(); return }
      if (msg.t === 'who') {
        // 全服名单走 roster 通道；这里只回视野内的人，否则客户端会把视野外的人画进场景并永远停在原地
        send(ws, {
          t: 'players',
          online: players.size,
          players: [...me.visible].map(peerId => players.get(peerId)).filter(Boolean).map(p=>publicOf(p,me)),
        })
        return
      }

      if(msg.t==='chat')chat.submit(me,msg)
      if(msg.t==='chat_hist')void chat.history(me,msg.ch)
    } catch (err) {
      // 单条消息解析 / 处理失败不能把整个进程带走
      console.warn('[ws] 消息处理失败', err && err.message)
    }
  })

  ws.on('close', (code, reason) => release(code, reason))
  ws.on('error', () => { try { ws.close() } catch { /* 忽略 */ } })
})

// 在线人数：人数变了才广播，10s 兜底一次（原来是每秒无条件全服广播）
let onlineSent = -1, onlineAt = 0
setInterval(() => {
  const n = players.size
  const at = Date.now()
  if (n === onlineSent && at - onlineAt < 10000) return
  onlineSent = n; onlineAt = at
  broadcast({t: 'online', online: n})
}, TICK_MS)

// 订阅者增量：只有打开大地图/玩家列表的客户端在收（近距离位姿走 AOI，不受影响）
setInterval(() => {
  if (!players.size) return
  rosterV++
  const d = rosterDelta()
  pushHist({ v: rosterV, at: Date.now(), ...d })
  let text = null, size = 0
  for (const p of players.values()) {
    const ws = p.ws
    if (!ws || !ws.rosterSub) continue
    if (Date.now() - ws.rosterSub.at > ROSTER_SUB_TTL_MS) {
      ws.rosterSub = null
      send(ws, { t: 'roster3', v: rosterV, paused: true, total: players.size })
      continue
    }
    if (!text) { text = JSON.stringify({ t: 'roster3', v: rosterV, ...d }); size = Buffer.byteLength(text) }
    sendSlowAware(ws, text, 'roster', size)
    if (ws.slowSkips > 0) {
      ws.rosterSub = null
      send(ws, { t: 'roster3', v: rosterV, paused: true, total: players.size })
    }
  }
}, ROSTER_SUB_MS)

// 未订阅者：低频全量（老客户端从 5s 降到 30s，行为仍兼容，只是刷新慢）
setInterval(() => {
  if (!players.size) return
  const text = JSON.stringify(rosterPayload())
  const size = Buffer.byteLength(text)
  for (const p of players.values()) {
    const ws = p.ws
    if (!ws || ws.rosterSub) continue
    sendSlowAware(ws, text, 'roster', size)
  }
}, ROSTER_FULL_MS)

// 全量快照限速泵：全服共享 15 份/秒，避免 1000 人同时开图把端口打满
setInterval(() => {
  if (!fullQueue.length) return
  if (!players.size) { fullQueue.length = 0; return }
  const text = JSON.stringify({ t: 'roster3', v: rosterV, full: rosterPayload().players, total: players.size })
  const size = Buffer.byteLength(text)
  for (let i = 0; i < ROSTER_FULL_QPS && fullQueue.length; i++) {
    const ws = fullQueue.shift()
    if (!ws) continue
    sendSlowAware(ws, text, 'roster', size)
  }
}, 1000)

// 每 30s 一条 rt-stats：线上判断「单核是否顶满」看 loopP99Ms，> 50ms 玩家就能感到卡
const STATS_MS = Number(process.env.RT_STATS_MS || 30000)
setInterval(() => {
  console.log(JSON.stringify({scope: 'rt-stats', players: players.size, sockets: sockets.size, cells: grid.size, ...obs.window()}))
}, STATS_MS)

// 续连宽限期到点就真正离场：单独 1s 一次，别等 10s 的 ping 周期（否则幽灵会多站 10 秒）
setInterval(() => {
  const t = now()
  for (const p of players.values()) if (p.dead && t > p.deadAt) removePlayer(p, {closeCode: 1006, reason: 'resume timeout'})
}, 1000)

// 掉线清理：浏览器直接关掉时不会有 close 帧，用 ping/pong 兜住
setInterval(() => {
  for (const p of players.values()) {
    // 续连宽限期内的会话：不 ping、不判死（超时清扫见下面的 1s 定时器）
    if (p.dead) continue
    if (p.ws.isAlive === false && now()-(p.ws.lastPongAt??p.joinedAt)>=30000) {
      p.ws.terminate()
      continue
    }
    p.ws.isAlive = false
    try { p.ws.pingStamp=performance.now();p.ws.ping(String(p.ws.pingStamp)) } catch { /* 忽略 */ }
  }
}, 10000)

server.listen(PORT, () => {
  console.log(`网上桂林 · 联机服务已启动  ws://127.0.0.1:${PORT}/ws`)
  console.log(`  健康检查：http://127.0.0.1:${PORT}/health`)
})

// 优雅退出
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const p of players.values()) send(p.ws, {t: 'error', message: '服务器重启'})
    wss.close(() => server.close(() => process.exit(0)))
    setTimeout(() => process.exit(0), 1500)
  })
}
