/**
 * 网上桂林 · 联机服务（M1：全服一个大房间）
 *
 * 协议（JSON over WebSocket，路径 /ws）
 *   客户端 → 服务端
 *     {t:'join', uid, name, avatar, x,y,z,yaw}
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
 *   GET  /health          → {ok:true, online, proto}（proto = 协议版本，见下面的 PROTO）
 *   POST /kick {uid,reason} → {ok:true, kicked}（需要 X-Kick-Token，和 KICK_TOKEN 一致）
 *
 * 启动：PORT=8790 node server-realtime.mjs
 * 依赖：npm i ws
 */
import {createServer} from 'node:http'
import {WebSocketServer} from 'ws'

const PORT = Number(process.env.PORT || 8790)
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 200)
const MAX_CHAT = 80
const TICK_MS = 1000
const KICK_TOKEN = process.env.KICK_TOKEN || ''
/** 同一个连接最快 20 Hz 上报位置，防止有人狂发把广播压垮 */
const MIN_POS_GAP_MS = 45
/** 外形数据上限（字节），超了直接丢弃，别让畸形包把别人的客户端搞崩 */
const MAX_AVATAR_BYTES = 512

/**
 * 协议版本。用 GET /health 就能看到线上跑的是哪一版 —— 改 `pos` / `hit` 的字段就 +1。
 *   1 = 只有位置
 *   2 = 加了 mv / cr / gr / dn / pn（蹲下、倒地、出拳、在不在动）
 *   3 = 加了 hp（血量）和 hit.byId（挨打方向）  ← 当前
 */
const PROTO = 3

/** id → {ws, uid, name, avatar, x,y,z, yaw, v, bike, bx,bz,byaw, lastChat, lastPos} */
const players = new Map()
let nextId = 1

const now = () => Date.now()
const clampNum = (value, min, max, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}
const clampInt = (value, min, max, fallback = 0) => Math.round(clampNum(value, min, max, fallback))
const clampStr = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '')

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

function broadcast(payload, exceptId) {
  const text = JSON.stringify(payload)
  for (const [id, p] of players) {
    if (id === exceptId) continue
    send(p.ws, text)
  }
}

function publicOf(p) {
  return {
    id: p.id, uid: p.uid, name: p.name, avatar: p.avatar,
    x: p.x, y: p.y, z: p.z, yaw: p.yaw, v: p.v,
    bike: p.bike, bx: p.bx, bz: p.bz, byaw: p.byaw,
    hb: p.hb, hx: p.hx, hz: p.hz, hyaw: p.hyaw, mv: p.mv, dn: p.dn, pn: p.pn, wl: p.wl, cr: p.cr, gr: p.gr,
    hp: p.hp,
    sc: p.sc, sb: p.sb, sp: p.sp, br: p.br,
  }
}

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, {'content-type': 'application/json'})
    res.end(JSON.stringify({ok: true, online: players.size, proto: PROTO}))
    return
  }

  if (req.url === '/kick' && req.method === 'POST') {
    let raw = ''
    req.on('data', chunk => { raw += chunk; if (raw.length > 4096) req.destroy() })
    req.on('end', () => {
      if (KICK_TOKEN && req.headers['x-kick-token'] !== KICK_TOKEN) {
        res.writeHead(401, {'content-type': 'application/json'})
        res.end('{"ok":false}')
        return
      }
      let body = {}
      try { body = JSON.parse(raw || '{}') } catch { /* 忽略坏 JSON */ }
      const uid = String(body.uid || '')
      const reason = String(body.reason || '账号已被封禁').slice(0, 200)
      let kicked = 0
      for (const p of players.values()) {
        if (p.uid !== uid) continue
        send(p.ws, {t: 'banned', reason})
        setTimeout(() => p.ws.close(4003, 'banned'), 60)
        kicked++
      }
      res.writeHead(200, {'content-type': 'application/json'})
      res.end(JSON.stringify({ok: true, kicked}))
    })
    return
  }

  res.writeHead(426, {'content-type': 'text/plain; charset=utf-8'})
  res.end('WebSocket only')
})

const wss = new WebSocketServer({server, path: '/ws', maxPayload: 4096})

wss.on('connection', ws => {
  if (players.size >= MAX_PLAYERS) {
    send(ws, {t: 'error', message: '服务器满员'})
    ws.close()
    return
  }
  const id = String(nextId++)
  ws.isAlive = true
  ws.on('pong', () => { ws.isAlive = true })

  ws.on('message', raw => {
    let msg
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }
    const me = players.get(id)

    if (msg.t === 'join' && !me) {
      const player = {
        id,
        ws,
        uid: clampStr(msg.uid, 16),
        name: clampStr(msg.name, 24).trim() || '游客',
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
        lastChat: 0,
        lastPos: 0,
      }
      players.set(id, player)
      send(ws, {
        t: 'welcome',
        me: {id, uid: player.uid, name: player.name, avatar: player.avatar},
        online: players.size,
        players: [...players.values()].filter(p => p.id !== id).map(publicOf),
      })
      broadcast({t: 'join', player: publicOf(player)}, id)
      broadcast({t: 'online', online: players.size})
      return
    }

    if (!me) return

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
      const dmg = Math.max(1, Math.min(35, clampInt(msg.dmg, 1, 35, 9)))
      // byId 让被打的一方算出「从哪个方向挨的这一下」；by 只用来显示
      send(target.ws, {t: 'hit', dmg, by: me.name, byId: me.id})
      return
    }

    if (msg.t === 'revive') {
      const target = players.get(clampStr(msg.id, 64))
      if (!target || target === me) return
      // 只有对方倒地时才允许扶
      if (!target.dn) return
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
        players: [...players.values()].filter(p => p.id !== id).map(publicOf),
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
  })

  ws.on('close', () => {
    if (!players.has(id)) return
    players.delete(id)
    broadcast({t: 'leave', id})
    broadcast({t: 'online', online: players.size})
  })

  ws.on('error', () => ws.close())
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
