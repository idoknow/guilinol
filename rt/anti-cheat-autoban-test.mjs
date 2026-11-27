// 自动封禁回归：阈值按"违规次数/10 分钟"分级，达到才封，重复不叠封，人工解封可恢复
import {spawn} from 'node:child_process'
import WebSocket from 'ws'
import {createHmac} from 'node:crypto'

const SECRET = 'test-secret'
const ADMIN = 'admin-token'
const PORT = 8898
const URL = `ws://127.0.0.1:${PORT}/ws`
const mint = (uid, name) => {
  const p = Buffer.from(JSON.stringify({uid, name, exp: Math.floor(Date.now() / 1000) + 50})).toString('base64url')
  return `${p}.${createHmac('sha256', SECRET).update(p).digest('base64url')}`
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const srv = spawn('node', ['rt/server-realtime.mjs'], {
  env: {...process.env, RT_JOIN_SECRET: SECRET, RT_ADMIN_TOKEN: ADMIN, PORT: String(PORT), MAX_PLAYERS: '20',
    DATABASE_URL: '', RT_AC_AUTOBAN: '1', RT_AC_BAN_1: '3', RT_AC_BAN_1_MIN: '5', RT_AC_BAN_2: '99', RT_AC_BAN_3: '999'},
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
srv.stdout.on('data', (d) => (logs += d))
srv.stderr.on('data', (d) => (logs += d))
await sleep(2000)

let fail = 0
const ok = (cond, label) => { console.log(`${cond ? '  PASS ' : '  FAIL '}${label}`); if (!cond) fail++ }

function client(uid, name) {
  const ws = new WebSocket(URL)
  const got = []
  ws.on('message', (m) => got.push(JSON.parse(m.toString())))
  ws.on('error', () => {})
  return {ws, got,
    join: () => ws.send(JSON.stringify({t: 'join', ticket: mint(uid, name), name, x: 0, y: 3, z: 0, yaw: 0, fp: 'b'.repeat(16), dev: 'Pixel 7|Chrome 121'})),
    pos: (x, y, z, o = {}) => ws.send(JSON.stringify({t: 'pos', x, y, z, yaw: 0, v: 0, ...o})),
  }
}
const connect = async (c) => { await new Promise((r) => c.ws.on('open', r)); c.join(); await sleep(500); return c }

// 1. 少量违规（低于阈值）不封
console.log('\n[1] 低于阈值不封')
const few = await connect(client(910001, 'few'))
for (let i = 1; i <= 4; i++) { few.pos(700, 3, 700); await sleep(2200) }
ok(!few.got.some(m=>m.t==='banned'),'同次拉回连续收到拒绝包不累计封禁')
const again = await connect(client(910001, 'few'))   // 重连同 uid（旧连接被顶掉，新连接仍能进）
ok(again.got.some((m) => m.t === 'welcome'), '2 次违规（阈值 3）：重连仍可进')

// 2. 达到阈值 → 自动封；封后重连被拦
console.log('\n[2] 达到阈值自动封')
for (let i = 1; i <= 2; i++) { again.pos(0,3,0);await sleep(100);again.pos(700, 3, 700); await sleep(2200) }
await sleep(500)
const bansNow = await fetch(`http://127.0.0.1:${PORT}/admin/bans`, {headers: {'x-admin-token': ADMIN}}).then((r) => r.json()).catch(() => ({}))
console.log('    封禁列表:', JSON.stringify(bansNow).slice(0, 200))
const back = await connect(client(910001, 'few'))
ok(back.got.some((m) => m.t === 'banned') || back.ws.readyState !== 1, '违规次数达阈值：被封，重连被拦')

// 3. 人工解封后立即可进
console.log('\n[3] 人工解封')
await fetch(`http://127.0.0.1:${PORT}/admin/unban`, {method: 'POST', headers: {'x-admin-token': ADMIN, 'content-type': 'application/json'}, body: JSON.stringify({uid: 910001, actor: 'test'})})
const freed = await connect(client(910001, 'few'))
ok(freed.got.some((m) => m.t === 'welcome'), '解封后可重连')

for (const c of [few, again, back, freed]) { try { c.ws.close() } catch {} }
srv.kill()
await sleep(200)
console.log(`\n结果: ${fail === 0 ? '全部通过' : `${fail} 项失败`}`)
if (fail) console.log(logs.slice(-800))
process.exit(fail ? 1 : 0)
