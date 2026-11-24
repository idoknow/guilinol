#!/usr/bin/env node
/**
 * 联机压测：N 个机器人走真实 join 流程（真 ticket 签名），20Hz 随机游走，统计
 *   - 服务端每秒转发的消息数（由机器人累计收到）
 *   - 每个客户端下行字节/秒
 *   - 服务端进程 CPU（给了 --pid 才算）
 *
 * 用法（默认完全离线：随机生成 RT_JOIN_SECRET，自己拉起一个本地 rt 子进程，不碰线上）：
 *   node scripts/rt-load.mjs --bots 300 --seconds 30 [--extent 1200]
 *   RT_JOIN_SECRET=xxx node scripts/rt-load.mjs --url ws://host:8790/ws --bots 300 --pid 1234   # 压一个已在跑的 rt
 *
 * 输出：下行消息/秒、单客户端 KB/s、rt 进程 CPU（1.0 = 一整个核，单进程 Node 的天花板），
 * 以及 rt 自己每 5s 打的 rt-stats：事件循环延迟 p99（> 50ms 玩家能感到卡）和慢客户端跳过数。
 */
import { createHmac } from 'node:crypto'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawn as spawnProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const EXTERNAL = arg('url', '')
const BOTS = Number(arg('bots', 100))
const SECONDS = Number(arg('seconds', 20))
const EXTENT = Number(arg('extent', 1200)) // 随机游走范围：±EXTENT 米（桂林可玩区大致这个量级）
const HZ = Number(arg('hz', 20))
let PID = Number(arg('pid', 0))
const SECRET = EXTERNAL ? process.env.RT_JOIN_SECRET || '' : randomBytes(24).toString('base64url')
if (!SECRET) {
  console.error('压外部 rt 需要 RT_JOIN_SECRET；不传 --url 则自动拉起本地 rt')
  process.exit(2)
}
let WS_URL = EXTERNAL
const stats = []
let child
if (!EXTERNAL) {
  const port = 20000 + Math.floor(Math.random() * 20000)
  const server = fileURLToPath(new URL('../rt/server-realtime.mjs', import.meta.url))
  child = spawnProcess(process.execPath, [server], {
    env: { ...process.env, PORT: String(port), RT_JOIN_SECRET: SECRET, MAX_PLAYERS: String(BOTS + 50), RT_STATS_MS: '5000' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  child.stdout.on('data', (chunk) => {
    for (const line of String(chunk).split('\n')) if (line.includes('"rt-stats"')) { try { stats.push(JSON.parse(line)) } catch {} }
  })
  await new Promise((resolve) => child.stdout.once('data', resolve))
  WS_URL = `ws://127.0.0.1:${port}/ws`
  PID = child.pid
}

const mint = (uid) => {
  const payload = Buffer.from(
    JSON.stringify({ uid, name: 'bot' + (uid % 10000), exp: Math.floor(Date.now() / 1000) + 60 }),
  ).toString('base64url')
  return `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`
}

const cpuTicks = () => {
  if (!PID) return 0
  try {
    const parts = readFileSync(`/proc/${PID}/stat`, 'utf8').split(' ')
    return Number(parts[13]) + Number(parts[14])
  } catch {
    return 0
  }
}

const bots = []
let recv = 0
let recvBytes = 0
let joined = 0

const spawn = (i) =>
  new Promise((resolve) => {
    // 每 IP 最多 8 条「未 join」的连接（RT_MAX_PENDING_PER_IP），用不同本地地址分散
    const localAddress = `127.0.${Math.floor(i / 8) % 250}.${(i % 8) + 1}`
    const ws = new WebSocket(WS_URL, { localAddress, perMessageDeflate: false })
    const bot = { ws, x: (Math.random() * 2 - 1) * EXTENT, z: (Math.random() * 2 - 1) * EXTENT, dir: Math.random() * Math.PI * 2, sent: 0 }
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', ticket: mint(200000 + i), x: bot.x, y: 30, z: bot.z, yaw: 0 })))
    ws.on('message', (m) => {
      recv++
      recvBytes += m.length
      if (String(m).includes('"welcome"')) { joined++; resolve(bot) }
    })
    ws.on('error', () => resolve(bot))
    setTimeout(() => resolve(bot), 8000)
  })

for (let i = 0; i < BOTS; i++) bots.push(await spawn(i))
await new Promise((r) => setTimeout(r, 1200))

const t0 = process.hrtime.bigint()
const c0 = cpuTicks()
const statsFrom = stats.length
const timer = setInterval(() => {
  for (const bot of bots) {
    if (bot.ws.readyState !== 1) continue
    bot.dir += (Math.random() - 0.5) * 0.6
    bot.x = Math.max(-EXTENT, Math.min(EXTENT, bot.x + Math.cos(bot.dir) * 1.6))
    bot.z = Math.max(-EXTENT, Math.min(EXTENT, bot.z + Math.sin(bot.dir) * 1.6))
    bot.ws.send(JSON.stringify({ t: 'pos', x: bot.x, y: 30, z: bot.z, yaw: bot.dir, v: 3 }))
    bot.sent++
  }
}, Math.round(1000 / HZ))

await new Promise((r) => setTimeout(r, SECONDS * 1000))
clearInterval(timer)
const wall = Number(process.hrtime.bigint() - t0) / 1e9
const c1 = cpuTicks()

const sent = bots.reduce((s, b) => s + b.sent, 0)
const cores = PID ? (c1 - c0) / 100 / wall : null
console.log(
  JSON.stringify(
    {
      bots: BOTS,
      joined,
      seconds: +wall.toFixed(1),
      upstreamPosPerSec: Math.round(sent / wall),
      downstreamMsgPerSec: Math.round(recv / wall),
      downstreamMBps: +(recvBytes / wall / 1048576).toFixed(2),
      perClientKBps: +(recvBytes / wall / 1024 / Math.max(joined, 1)).toFixed(2),
      serverCores: cores === null ? null : +cores.toFixed(2),
      ...(() => {
        const win = stats.slice(statsFrom)
        if (!win.length) return {}
        return {
          loopP99MsMax: Math.max(...win.map((s) => s.loopP99Ms)),
          loopP99MsAvg: +(win.reduce((a, s) => a + s.loopP99Ms, 0) / win.length).toFixed(1),
          slowSkips: win.reduce((a, s) => a + s.slowSkips, 0),
          serverOutPerSec: Math.round(win.reduce((a, s) => a + s.outPerSec, 0) / win.length),
        }
      })(),
    },
    null,
    0,
  ),
)

child?.stdout.removeAllListeners('data');child?.stdout.on('error',()=>{});child?.kill('SIGKILL')
for (const bot of bots) bot.ws.close()
process.exit(0)
