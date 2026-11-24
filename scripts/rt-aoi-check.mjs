#!/usr/bin/env node
/**
 * AOI 行为验收（IDOK-224）：自己拉起本地 rt（随机 secret），用真实 join 流程跑几个客户端，断言
 *   1) 600m 外的人不进场景，但在全服 roster 里
 *   2) 走近到 80m → 收到 1 次 join
 *   3) 在 120–140m 来回走 → 不闪（join/leave 都是 0，滞回）
 *   4) 走到 320m → 收到 1 次 leave
 *   5) 传送到身边 → 当帧收到 join
 *   6) who 只回视野内
 *   7) 同 uid 新设备顶号 → 旧连接 4001 replaced，旁观者收到旧 id 的 leave，之后不再收到旧 id 的 pos
 * 用法：node scripts/rt-aoi-check.mjs   （退出码非 0 = 失败）
 */
import { createHmac, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const SECRET = randomBytes(24).toString('base64url')
const PORT = 20000 + Math.floor(Math.random() * 20000)
const server = spawn(process.execPath, [fileURLToPath(new URL('../rt/server-realtime.mjs', import.meta.url))], {
  env: { ...process.env, PORT: String(PORT), RT_JOIN_SECRET: SECRET, RT_ROSTER_MS: '500', RT_STATS_MS: '600000' },
  stdio: ['ignore', 'pipe', 'inherit'],
})
await new Promise((resolve) => server.stdout.once('data', resolve))
server.stdout.resume()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mint = (uid, name) => {
  const payload = Buffer.from(JSON.stringify({ uid, name, exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url')
  return `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`
}
function client(uid, name, x, z) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
    const c = { ws, id: '', x, z, log: [], roster: [], welcome: null, closed: null }
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', ticket: mint(uid, name), x, y: 30, z, yaw: 0 })))
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw))
      if (msg.t === 'welcome') { c.id = msg.me.id; c.welcome = msg; resolve(c) }
      else if (msg.t === 'roster') c.roster = msg.players
      else c.log.push(msg)
    })
    ws.on('close', (code, reason) => { c.closed = { code, reason: String(reason) } })
  })
}
const move = async (c, x, z) => { c.x = x; c.z = z; c.ws.send(JSON.stringify({ t: 'pos', x, y: 30, z, yaw: 0, v: 3 })); await sleep(50) }
async function walk(c, toX, toZ, step = 8) {
  const n = Math.ceil(Math.hypot(toX - c.x, toZ - c.z) / step)
  const fx = c.x, fz = c.z
  for (let i = 1; i <= n; i++) await move(c, fx + ((toX - fx) * i) / n, fz + ((toZ - fz) * i) / n)
  await sleep(150)
}
const count = (c, t, id) => c.log.filter((m) => m.t === t && (m.player?.id ?? m.id) === id).length
const reset = (c) => { c.log.length = 0 }

let failed = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`); if (!ok) failed++ }

const A = await client(910001, 'A', 0, 0)
const B = await client(910002, 'B', 600, 0)
await sleep(700)
check('1) 600m 外不进场景', count(A, 'join', B.id) === 0 && !B.welcome.players.some((p) => p.id === A.id), `join=${count(A, 'join', B.id)}`)
check('1) 但在全服 roster 里', A.roster.some(([id]) => id === B.id), `roster=${A.roster.length}`)

reset(A); await walk(B, 80, 0)
check('2) 走近到 80m → join = 1', count(A, 'join', B.id) === 1, `join=${count(A, 'join', B.id)}`)
reset(A); for (let i = 0; i < 20; i++) await move(B, 80 - i * 0.5, 0)
await sleep(100)
check('2) 近处 20Hz 全收（20 帧收 20 条）', count(A, 'pos', B.id) === 20, `pos=${count(A, 'pos', B.id)}`)

reset(A)
for (let i = 0; i < 6; i++) { await walk(B, 140, 0, 4); await walk(B, 120, 0, 4) }
check('3) 120–140m 来回 6 次不闪', count(A, 'join', B.id) === 0 && count(A, 'leave', B.id) === 0, `join=${count(A, 'join', B.id)} leave=${count(A, 'leave', B.id)}`)

reset(A); await walk(B, 320, 0)
check('4) 走到 320m → leave = 1', count(A, 'leave', B.id) === 1 && count(A, 'join', B.id) === 0, `leave=${count(A, 'leave', B.id)}`)
reset(A); await walk(B, 340, 0)
check('4) 离开后不再收 pos', count(A, 'pos', B.id) === 0, `pos=${count(A, 'pos', B.id)}`)

reset(A); await move(B, 3, 2); await sleep(60)
check('5) 传送到身边 → 当帧 join', count(A, 'join', B.id) === 1, `join=${count(A, 'join', B.id)}`)

const C = await client(910003, 'C', 900, 900)
await sleep(100); reset(A)
A.ws.send(JSON.stringify({ t: 'who' })); await sleep(150)
const who = A.log.find((m) => m.t === 'players')
check('6) who 只回视野内', who && who.players.some((p) => p.id === B.id) && !who.players.some((p) => p.id === C.id), `n=${who?.players.length}`)

reset(A)
const B2 = await client(910002, 'B', 4, 2)
await sleep(200)
check('7) 旧连接 4001 replaced', B.closed?.code === 4001 && /replaced/.test(B.closed.reason), JSON.stringify(B.closed))
check('7) 旁观者收到旧 id leave + 新 id join', count(A, 'leave', B.id) === 1 && count(A, 'join', B2.id) === 1)
reset(A); await walk(B2, 30, 2); await sleep(200)
check('7) 顶号后旧 id 不再出现', count(A, 'pos', B.id) === 0 && count(A, 'pos', B2.id) > 0)
await sleep(600)
check('7) roster 里同 uid 只剩一条', A.roster.filter(([, name]) => name === 'B').length === 1, `n=${A.roster.filter(([, name]) => name === 'B').length}`)

for (const c of [A, B2, C]) c.ws.close()
server.kill('SIGKILL')
console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
