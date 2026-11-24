/**
 * 网上桂林 · 联机服务（M1：全服一个大房间）
 *
 * 协议（JSON over WebSocket，路径 /ws）
 *   客户端 → 服务端
 *     {t:'join', ticket, avatar, x,y,z,yaw}
 *     {t:'pos', x,y,z, yaw, v, bike, bx,bz,byaw, hb,hx,hz,hyaw, mv,cr,gr,dn,pn,hp, sc,sb,sp,br}
 *     {t:'hit', id, dmg}            出拳打到 id 这个人
 *     {t:'revive', id}              扶起倒地的 id
 *     {t:'avatar', avatar}
 *     {t:'who'}
 *     {t:'chat', text}
 *   服务端 → 客户端
 *     {t:'welcome', me, online, players:[...]}
 *     {t:'join', player} / {t:'leave', id}
 *     {t:'pos', id, x,y,z,yaw,v,bike,bx,bz,byaw, hb,hx,hz,hyaw, mv,cr,gr,dn,pn,hp, sc,sb,sp,br}
 *     {t:'hit', dmg, by, byId} / {t:'revive', by}
 *     {t:'avatar', id, avatar}
 *     {t:'chat', id, name, text}
 *     {t:'online', online}
 *     {t:'banned', reason}
 *
 * 姿态 / 战斗字段（都在 pos 里顺带传，不额外开消息）
 *   mv  = 在不在动      cr  = 蹲着        gr  = 着地        dn  = 倒地        pn  = 正在出拳
 *   hp  = 血量 0..100（出手方靠它看到自己打掉了多少，也画在对方头顶那条小血条上）
 *   hit.by = 出手者昵称（显示用）、hit.byId = 出手者会话 id（被打方拿它算挨打方向）
 *
 * 抽烟字段（别人也能看见你点烟/吸烟的动作）
 *   sc  = 0 没抽 / 1 正在点烟 / 2 已经点着
 *   sb  = 剩余可燃时间 × 10（0..1800）
 *   sp  = 吸了几口的累计计数（0..999），换值就说明刚吸了一口
 *   br  = 品牌序号（0..3）
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
import {flatDistance,inEmoteRange,acceptEmote} from './emote.mjs'
import {createServer} from 'node:http'
import {createHmac,timingSafeEqual} from 'node:crypto'
import {isIP} from 'node:net'
import {WebSocketServer} from 'ws'

const PORT = Number(process.env.PORT || 8790)
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 200)
const MAX_CHAT = 80
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
/** 昵称长度上限（字符） */
const MAX_NAME = 16
/** 服务端裁决 hit / revive 的水平距离（米） */
const HIT_RANGE = 3.5
const REVIVE_RANGE = 3
/** 广播前允许的发送缓冲；超了就跳过，连续跳过 60 次直接断开，别让慢客户端拖垮内存 */
const MAX_BUFFERED = 1024 * 1024
const MAX_SLOW_SKIPS = 60
/** 同一个连接最快 20 Hz 上报位置，防止有人狂发把广播压垮 */
const MIN_POS_GAP_MS = 45
/** 外形数据上限（字节），超了直接丢弃，别让畸形包把别人的客户端搞崩 */
const MAX_AVATAR_BYTES = 512

/**
 * 协议版本。用 GET /health 就能看到线上跑的是哪一版 —— 改 `pos` / `hit` 的字段就 +1。
 *   1 = 只有位置
 *   2 = 加了 mv / cr / gr / dn / pn（蹲下、倒地、出拳、在不在动）
 *   3 = 加了 hp（血量）和 hit.byId（挨打方向）
 *   4 = join 必须提供 API 签发的短期 ticket
 */
const PROTO = 4

/** id → {ws, uid, name, avatar, x,y,z, yaw, v, bike, bx,bz,byaw, lastChat, lastPos} */
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

/** 反代场景取 x-forwarded-for 第一跳，但只接受合法 IP 字面量；客户端乱写头就退回 socket 地址 */
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : ''
  if (isIP(first)) return first
  return req.socket.remoteAddress || 'unknown'
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
const LOOKS = ['basic', 'sport', 'outdoor', 'chinese', 'office', 'campus']

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
    face: clampInt(value.face, 0, 2),
    brows: clampInt(value.brows, 0, 2),
    eyes: clampInt(value.eyes, 0, 2),
    hair: HAIRS[body].includes(hair) ? hair : HAIRS[body][0],
    hairColor: clampInt(value.hairColor, 0, 3),
    look: LOOKS.includes(look) ? look : 'basic',
    createdAt: clampInt(value.createdAt, 0, 4e12),
  }
  return JSON.stringify(avatar).length <= MAX_AVATAR_BYTES ? avatar : null
}

function send(ws, payload) {
  if (ws.readyState === 1) {
    try {
      ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload))
    } catch {
      /* 单个连接写失败就忽略，别影响别人 */
    }
  }
}

/**
 * 广播专用发送：先看发送缓冲，堆积超过 1 MB 说明对面跟不上（或故意不收），
 * 这一条直接跳过；连续跳过 60 次基本就是死连接，close(1013) 交给 close 回调回收。
 */
function sendSlowAware(ws, text) {
  if (ws.bufferedAmount > MAX_BUFFERED) {
    ws.slowSkips = (ws.slowSkips || 0) + 1
    if (ws.slowSkips >= MAX_SLOW_SKIPS) {
      try { ws.close(1013, 'slow client') } catch { /* 忽略 */ }
    }
    return
  }
  ws.slowSkips = 0
  send(ws, text)
}

function broadcast(payload, exceptId) {
  const text = JSON.stringify(payload)
  for (const [id, p] of players) {
    if (id === exceptId) continue
    sendSlowAware(p.ws, text)
  }
}

function publicOf(p,viewer=p) {
  return {
    id: p.id, uid: p.uid, name: p.name, avatar: p.avatar,
    x: p.x, y: p.y, z: p.z, yaw: p.yaw, v: p.v,
    bike: p.bike, bx: p.bx, bz: p.bz, byaw: p.byaw,
    hb: p.hb, hx: p.hx, hz: p.hz, hyaw: p.hyaw, mv: p.mv, dn: p.dn, pn: p.pn, wl: p.wl, cr: p.cr, gr: p.gr,
    hp: p.hp, em:inEmoteRange(p,viewer)&&now()<p.emoteUntil?p.em:0, es:p.es,
    sc: p.sc, sb: p.sb, sp: p.sp, br: p.br,
  }
}

const server = createServer((req, res) => {
  try {
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
          bans.set(uid, {until: now() + KICK_BAN_SECONDS * 1000, reason})
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
  try {
    ip = clientIp(req)
    // 容量按「所有连接」算：只数 players 的话，握完手不 join 就能无限占连接
    if (sockets.size >= MAX_PLAYERS) {
      console.warn(JSON.stringify({scope:'rt-reject',reason:'full',ip,players:players.size,sockets:sockets.size}))
      send(ws, {t: 'error', message: '服务器满员'})
      ws.close(1013, 'full')
      return
    }
    const used = ipCounts.get(ip) || 0
    if (MAX_PER_IP > 0 && used >= MAX_PER_IP) {
      // 排障要能看到到底是「满员」还是「同一出口 IP 挤爆」，否则线上只能靠猜
      console.warn(JSON.stringify({scope:'rt-reject',reason:'per-ip',ip,used,max:MAX_PER_IP,players:players.size,sockets:sockets.size}))
      send(ws, {t: 'error', message: '连接数过多'})
      ws.close(1013, 'too many connections')
      return
    }
    sockets.add(ws)
    ipCounts.set(ip, used + 1)
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
  ws.on('pong', () => { ws.isAlive = true })

  // 连接回收：容量计数要减回去，ipCounts 不能只增不减
  const release = (code, reason) => {
    clearTimeout(ws.joinTimer)
    const joined = players.has(id)
    if (sockets.delete(ws)) {
      const left = (ipCounts.get(ip) || 1) - 1
      if (left > 0) ipCounts.set(ip, left)
      else ipCounts.delete(ip)
    }
    // 关闭原因必须留痕：线上「联机不稳定」时，没有这行就只能靠猜是超时、满员还是顶号
    if (joined) console.log(JSON.stringify({scope:'rt-close',code:code??null,reason:String(reason??''),ip,uid:players.get(id)?.uid??null,players:players.size}))
    if (joined) {
      players.delete(id)
      broadcast({t: 'leave', id})
      broadcast({t: 'online', online: players.size})
    }
  }

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(String(raw))
      // null / 数组 / 标量都不是合法消息，直接忽略（否则读 msg.t 会抛）
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return
      const me = players.get(id)

      if (msg.t === 'join' && !me) {
        // 已经被拒（封禁 / 顶号）的连接不再给第二次机会
        if (ws.rejected) return
        // join 时再查一次：握手到 join 之间可能已经挤满
        if (players.size >= MAX_PLAYERS) {
          send(ws, {t: 'error', message: '服务器满员'})
          ws.close(1013, 'full')
          return
        }
        // 顺手清掉过期封禁，不起 setInterval（避免泄漏）
        sweepBans()
        const claims = identity(msg.ticket)
        if (!claims) { ws.rejected = true; ws.close(4003, 'ticket rejected'); return }
        const uid = claims.uid
        const ban = bans.get(uid)
        if (ban && ban.until > now()) {
          ws.rejected = true
          send(ws, {t: 'banned', reason: ban.reason || '账号已被封禁'})
          setTimeout(() => { try { ws.close(4003, 'banned') } catch { /* 忽略 */ } }, 60)
          return
        }
        // 同房间 uid 必须唯一，否则后来者能直接冒用前者的身份
        if (uidTaken(uid)) {
          ws.rejected = true
          send(ws, {t: 'error', message: '该 uid 已在线'})
          setTimeout(() => { try { ws.close(4001, 'uid in use') } catch { /* 忽略 */ } }, 60)
          return
        }
        const player = {
          id,
          ws,
          uid,
          name: cleanName(claims.name),
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
          lastHit: 0,
          cr: 0,
          gr: 1,
          hp: 100,
          sc: 0,
          sb: 0,
          sp: 0,
          br: 0,
          em:0, es:0, emoteTimes:[], emoteUntil:0,
          lastChat: 0,
          lastPos: 0,
        }
        ws.joined = true
        clearTimeout(ws.joinTimer)
        players.set(id, player)
        send(ws, {
          t: 'welcome',
          me: {id, uid: player.uid, name: player.name, avatar: player.avatar},
          online: players.size,
          players: [...players.values()].filter(p => p.id !== id).map(p=>publicOf(p,player)),
        })
        broadcast({t: 'join', player: publicOf(player)}, id)
        broadcast({t: 'online', online: players.size})
        return
      }

      if (!me) return

      if (msg.t === 'emote') {
        if (!acceptEmote(me,msg,now())) return
        const packet=JSON.stringify({t:'emote',from:id,id:me.em,s:me.es})
        for(const peer of players.values())if(peer!==me&&inEmoteRange(peer,me))sendSlowAware(peer.ws,packet)
        return
      }

      if (msg.t === 'pos') {
        const at = now()
        if (at - me.lastPos < MIN_POS_GAP_MS) return
        me.lastPos = at
        me.x = clampNum(msg.x, -1e5, 1e5)
        me.y = clampNum(msg.y, -1000, 8000)
        me.z = clampNum(msg.z, -1e5, 1e5)
        me.yaw = clampNum(msg.yaw, -10, 10)
        me.v = clampNum(msg.v, 0, 120)
        me.bike = clampStr(msg.bike, 32)
        me.bx = clampNum(msg.bx, -1e5, 1e5)
        me.bz = clampNum(msg.bz, -1e5, 1e5)
        me.byaw = clampNum(msg.byaw, -20, 20)
        me.mv = clampNum(msg.mv, 0, 1)
        me.dn = clampNum(msg.dn, 0, 1)
        me.pn = clampNum(msg.pn, 0, 1)
        me.wl = clampNum(msg.wl, 0, 1)
        me.hb = clampNum(msg.hb, 0, 1)
        me.hx = clampNum(msg.hx, -1e5, 1e5)
        me.hz = clampNum(msg.hz, -1e5, 1e5)
        me.hyaw = clampNum(msg.hyaw, -20, 20)
        me.cr = clampNum(msg.cr, 0, 1)
        me.gr = clampNum(msg.gr, 0, 1, 1)
        // 血量：出手方靠它看到自己打掉了多少，被打的人也靠它对齐屏幕上的血条
        me.hp = clampInt(msg.hp, 0, 100, 100)
        me.sc = clampInt(msg.sc, 0, 2)
        me.sb = clampInt(msg.sb, 0, 1800)
        me.sp = clampInt(msg.sp, 0, 999)
        me.br = clampInt(msg.br, 0, 3)
        broadcast({
          t: 'pos', id,
          x: me.x, y: me.y, z: me.z, yaw: me.yaw, v: me.v,
          bike: me.bike, bx: me.bx, bz: me.bz, byaw: me.byaw,
          hb: me.hb, hx: me.hx, hz: me.hz, hyaw: me.hyaw, mv: me.mv, cr: me.cr, gr: me.gr, dn: me.dn, pn: me.pn, wl: me.wl,
          hp: me.hp,
          sc: me.sc, sb: me.sb, sp: me.sp, br: me.br,
        }, id)
        return
      }

      if (msg.t === 'hit') {
        // 出拳：限频 5 次/秒，只转给被打的那个人，伤害由出手方算（夹到 1..35）
        const at = now()
        if (at - me.lastHit < 200) return
        me.lastHit = at
        const target = players.get(clampStr(msg.id, 64))
        if (!target || target === me) return
        // 目标已经倒地就别再打；距离用双方最近一次 pos 裁决，挡「隔空打人」
        if (target.dn) return
        if (flatDistance(me, target) > HIT_RANGE) return
        const dmg = Math.max(1, Math.min(35, clampInt(msg.dmg, 1, 35, 9)))
        // byId 让被打的一方算出「从哪个方向挨的这一下」；by 只用来显示
        send(target.ws, {t: 'hit', dmg, by: me.name, byId: me.id})
        return
      }

      if (msg.t === 'revive') {
        const target = players.get(clampStr(msg.id, 64))
        if (!target || target === me) return
        // 只有对方倒地时才允许扶，且得站在 3 m 内
        if (!target.dn) return
        if (flatDistance(me, target) > REVIVE_RANGE) return
        send(target.ws, {t: 'revive', by: me.name})
        return
      }

      if (msg.t === 'avatar') {
        const avatar = sanitizeAvatar(msg.avatar)
        if (!avatar) return
        me.avatar = avatar
        broadcast({t: 'avatar', id, avatar}, id)
        return
      }

      if (msg.t === 'who') {
        send(ws, {
          t: 'players',
          online: players.size,
          players: [...players.values()].filter(p => p.id !== id).map(p=>publicOf(p,me)),
        })
        return
      }

      if (msg.t === 'chat') {
        const text = clampStr(msg.text, MAX_CHAT).trim()
        if (!text) return
        if (now() - me.lastChat < 1200) return // 简单防刷
        me.lastChat = now()
        broadcast({t: 'chat', id, name: me.name, text})
      }
    } catch (err) {
      // 单条消息解析 / 处理失败不能把整个进程带走
      console.warn('[ws] 消息处理失败', err && err.message)
    }
  })

  ws.on('close', (code, reason) => release(code, reason))
  ws.on('error', () => { try { ws.close() } catch { /* 忽略 */ } })
})

// 在线人数心跳
setInterval(() => {
  broadcast({t: 'online', online: players.size})
}, TICK_MS)

// 掉线清理：浏览器直接关掉时不会有 close 帧，用 ping/pong 兜住
setInterval(() => {
  for (const p of players.values()) {
    if (p.ws.isAlive === false) {
      p.ws.terminate()
      continue
    }
    p.ws.isAlive = false
    try { p.ws.ping() } catch { /* 忽略 */ }
  }
}, 30000)

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
