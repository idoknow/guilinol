#!/usr/bin/env node
/**
 * 联机压测（离线自起，不碰线上）：
 *   自己生成一个随机 RT_JOIN_SECRET，拉起本地 rt 进程，用它签 ticket，
 *   跑 N 个机器人做真实 join + 20Hz 随机游走，输出服务端与客户端的观测量。
 *
 * 用法：
 *   node scripts/rt-load.mjs --bots 300 --seconds 20            # 自起 rt（默认端口 8790）
 *   node scripts/rt-load.mjs --bots 300 --seconds 20 --extent 250   # 挤在一起（密集场景）
 *   node scripts/rt-load.mjs --url ws://127.0.0.1:8790/ws --secret <s> --pid <p>   # 连已有实例
 *
 * 输出：joined / 上行 pos/s / 下行 msg/s / 单客户端 KB/s / rt CPU（单核=1.0）/ loop p99 / slow-skip
 * 注意：rt 是单进程 Node，事件循环只有一个核，CPU 到 1.0 就是天花板；看 loopP99 更有意义。
 */
import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import WebSocket from 'ws'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const BOTS = Number(arg('bots', 100))
const SECONDS = Number(arg('seconds', 20))
const EXTENT = Number(arg('extent', 1200))
const HZ = Number(arg('hz', 20))
const PORT = Number(arg('port', 8790))

let url = arg('url', '')
let secret = arg('secret', process.env.RT_JOIN_SECRET || '')
let pid = Number(arg('pid', 0))
let child = null

const rtPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'rt', 'server-realtime.mjs')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const health = async (port) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    return await res.json()
  } catch {
    return null
  }
}

if (!url) {
  secret = secret || randomBytes(24).toString('base64url')
  child = spawn(process.execPath, [rtPath], {
    env: { ...process.env, PORT: String(PORT), RT_JOIN_SECRET: secret, RT_MAX_PER_IP: '0', MAX_PLAYERS: String(BOTS + 50) },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  pid = child.pid
  url = `ws://127.0.0.1:${PORT}/ws`
  for (let i = 0; i < 50; i++) {
    if (await health(PORT)) break
    await sleep(100)
  }
}

if (!secret) {
  console.error('需要 --secret 或 RT_JOIN_SECRET（自起模式会自动生成）')
  process.exit(2)
}

const mint = (uid) => {
  const payload = Buffer.from(
    JSON.stringify({ uid, name: 'bot' + (uid % 10000), exp: Math.floor(Date.now() / 1000) + 60 }),
  ).toString('base64url')
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}

const cpuTicks = () => {
  if (!pid) return 0
  try {
    const parts = readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')
    return Number(parts[13]) + Number(parts[14])
  } catch {
    return 0
  }
}

const before = url.startsWith('ws://127.0.0.1') ? await health(PORT) : null

const bots = []
let recv = 0
let recvBytes = 0
let joined = 0

const spawnBot = (i) =>
  new Promise((resolve) => {
    // 每 IP 最多 8 条「未 join」连接（RT_MAX_PENDING_PER_IP），用不同本地地址分散
    const localAddress = `127.0.${Math.floor(i / 8) % 250}.${(i % 8) + 1}`
    const ws = new WebSocket(url, { localAddress, perMessageDeflate: false })
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

for (let i = 0; i < BOTS; i++) bots.push(await spawnBot(i))
await sleep(1200)

const samples = []
let sampling = false
const sampler = setInterval(async () => {
  if (!sampling || !url.startsWith('ws://127.0.0.1')) return
  const h = await health(PORT)
  if (h) samples.push(h.loopP99ms)
}, 1000)

const t0 = process.hrtime.bigint()
const c0 = cpuTicks()
sampling = true
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

await sleep(SECONDS * 1000)
clearInterval(timer)
sampling = false
clearInterval(sampler)
const wall = Number(process.hrtime.bigint() - t0) / 1e9
const c1 = cpuTicks()
const after = url.startsWith('ws://127.0.0.1') ? await health(PORT) : null
const sent = bots.reduce((s, b) => s + b.sent, 0)

console.log(
  JSON.stringify({
    bots: BOTS,
    joined,
    extent: EXTENT,
    seconds: +wall.toFixed(1),
    upstreamPosPerSec: Math.round(sent / wall),
    downstreamMsgPerSec: Math.round(recv / wall),
    downstreamMBps: +(recvBytes / wall / 1048576).toFixed(2),
    perClientKBps: +(recvBytes / wall / 1024 / Math.max(joined, 1)).toFixed(2),
    serverCores: pid ? +((c1 - c0) / 100 / wall).toFixed(2) : null,
    loopP99msMax: samples.length ? Math.max(...samples) : null,
    loopP99msAvg: samples.length ? +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(1) : null,
    slowSkips: after ? (after.slowSkips ?? 0) - (before?.slowSkips ?? 0) : null,
    slowCloses: after ? (after.slowCloses ?? 0) - (before?.slowCloses ?? 0) : null,
  }),
)

for (const bot of bots) bot.ws.close()
await sleep(200)
if (child) child.kill('SIGTERM')
process.exit(0)
