// 联机反外挂回归：作弊必须被拦，正常移动一次都不能误伤
import {spawn} from 'node:child_process'
import WebSocket from 'ws'
import {createHmac} from 'node:crypto'

const SECRET = 'test-secret'
const ADMIN = 'admin-token'
const PORT = 8897
const URL = `ws://127.0.0.1:${PORT}/ws`
const mint = (uid, name) => {
  const p = Buffer.from(JSON.stringify({uid, name, exp: Math.floor(Date.now() / 1000) + 50})).toString('base64url')
  return `${p}.${createHmac('sha256', SECRET).update(p).digest('base64url')}`
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const srv = spawn('node', ['rt/server-realtime.mjs'], {
  env: {...process.env, RT_JOIN_SECRET: SECRET, RT_ADMIN_TOKEN: ADMIN, PORT: String(PORT), MAX_PLAYERS: '50', DATABASE_URL: ''},
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
srv.stdout.on('data', (d) => (logs += d))
srv.stderr.on('data', (d) => (logs += d))
await sleep(2000)

let fail = 0
const ok = (cond, label) => { console.log(`${cond ? '  PASS ' : '  FAIL '}${label}`); if (!cond) fail++ }

function client(uid, name, x = 0, z = 0, extra = {}) {
  const ws = new WebSocket(URL)
  const got = []
  ws.on('message', (m) => got.push(JSON.parse(m.toString())))
  ws.on('error', () => {})
  const ready = new Promise((res) => ws.on('open', res))
  return {ws, got, ready, uid,
    join: (opts = {}) => ws.send(JSON.stringify({t: 'join', ticket: mint(uid, name), name, x, y: 3, z, yaw: 0, ...extra, ...opts})),
    pos: (px, py, pz, o = {}) => ws.send(JSON.stringify({t: 'pos', x: px, y: py, z: pz, yaw: 0, v: 0, ...o})),
    setbacks: () => got.filter((m) => m.t === 'setback').length,
  }
}
const adminPost = async (path, body) => {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {method: 'POST', headers: {'x-admin-token': ADMIN, 'content-type': 'application/json'}, body: JSON.stringify(body)})
  return {status: res.status, body: await res.json().catch(() => ({}))}
}

// ── 1. 正常走路 / 跑步 / 开车都不许被拉回
console.log('\n[1] 正常移动不误伤')
const walker = client(900101, 'walk')
await walker.ready; walker.join(); await sleep(400)
let x = 0
for (let i = 0; i < 40; i++) { x += 0.07; walker.pos(x, 3, 0); await sleep(50) }   // 1.4 m/s
ok(walker.setbacks() === 0, '走路 1.4 m/s 2 秒：无误报')

const runner = client(900102, 'run')
await runner.ready; runner.join(); await sleep(400)
let rx = 0
for (let i = 0; i < 40; i++) { rx += 0.45; runner.pos(rx, 3, 0); await sleep(50) }   // 9 m/s
ok(runner.setbacks() === 0, '跑步 9 m/s 2 秒：无误报')

const driver = client(900103, 'drive')
await driver.ready; driver.join(); await sleep(400)
let dx = 0
for (let i = 0; i < 34; i++) { dx += 0.3; driver.pos(dx, 3, 0, {bike: 'bike'}); await sleep(50) }  // 先 6 m/s 热车 1.7s
for (let i = 0; i < 30; i++) { dx += 2.08; driver.pos(dx, 3, 0, {bike: 'bike'}); await sleep(50) }  // 41.7 m/s = 150 km/h
ok(driver.setbacks() === 0, '开车 150 km/h：无误报')

// 直升机/载具：foot=false 时向上速度不受限（飞行是合法玩法）
const flyerOk = client(900150, 'heli')
await flyerOk.ready; flyerOk.join(); await sleep(400)
for (let i = 1; i <= 40; i++) { flyerOk.pos(0, 3 + i * 2, 0, {foot: false, bike: 'heli'}); await sleep(50) }  // 40 m/s 爬升
ok(flyerOk.setbacks() === 0, '直升机爬升 40 m/s：无误报')

// ── 2. 作弊必须被拦
console.log('\n[2] 作弊必须被拦')
const cheat = client(900201, 'cheat')
await cheat.ready; cheat.join(); await sleep(400)
cheat.pos(1000, 3, 0)          // 第一次近似"合法传送"（静止、无战斗）会放行
await sleep(200)
cheat.pos(2500, 3, 0)          // 3 秒内第二次 → 必须拦
await sleep(300)
ok(cheat.setbacks() >= 1, '连续瞬移（3s 内第二次）：被拉回')

const flyer = client(900202, 'fly')
await flyer.ready; flyer.join(); await sleep(400)
flyer.pos(0, 3, 0); await sleep(80)
flyer.pos(0, 60, 0)
await sleep(300)
ok(flyer.setbacks() >= 1, '飞天（y 3→60 一帧）：被拉回')

const speeder = client(900203, 'speed')
await speeder.ready; speeder.join(); await sleep(400)
let sx = 0
for (let i = 0; i < 30; i++) { sx += 2; speeder.pos(sx, 3, 0); await sleep(50) }   // 40 m/s 徒步
ok(speeder.setbacks() >= 1, '徒步 40 m/s 加速：被拉回')

// ── 3. 合法瞬移放行一次，但 3 秒内不能出拳
console.log('\n[3] 合法瞬移与出拳锁')
const jumper = client(900301, 'jump')
await jumper.ready; jumper.join(); await sleep(400)
const before = jumper.setbacks()
jumper.pos(600, 3, 600)
await sleep(300)
ok(jumper.setbacks() === before, '静止状态瞬移 800m：允许（地图/传送）')
const target = client(900302, 'target')
await target.ready; target.join(undefined); await sleep(200)
target.pos(601, 3, 600); await sleep(120)
jumper.pos(600.9, 3, 600); await sleep(120)
jumper.ws.send(JSON.stringify({t: 'punch', id: target.got.find((m) => m.t === 'welcome')?.me?.id, kind: 'jab', zone: 'torso', s: 1}))
await sleep(300)
const tHp = target.got.filter((m) => m.t === 'combat').map((m) => m.hp)
ok(!tHp.length || tHp.every((hp) => hp === tHp[0]), '瞬移后 3 秒内出拳：不生效')

// ── 4. 封禁与人工解封
console.log('\n[4] 封禁 / 人工解封')
const banned = client(900401, 'banned')
await banned.ready; banned.join(); await sleep(400)
const ban = await adminPost('/admin/ban', {uid: 900401, minutes: 10, reason: '测试', actor: 'test'})
ok(ban.status === 200 && ban.body.ok, '按 UID 封禁成功')
await sleep(200)
const again = client(900401, 'banned')
await again.ready; again.join(); await sleep(600)
ok(again.got.some((m) => m.t === 'banned') || again.ws.readyState !== 1, '被封 UID 重连：被拦')
const unban = await adminPost('/admin/unban', {uid: 900401, actor: 'test'})
ok(unban.status === 200 && unban.body.ok, '人工解封成功')
const back = client(900401, 'banned')
await back.ready; back.join(); await sleep(600)
ok(back.got.some((m) => m.t === 'welcome'), '解封后可正常重连')

// 指纹封禁：换号也拦
const dev1 = client(900501, 'devA', 0, 0, {fp: 'a'.repeat(16), dev: 'Pixel 7|Chrome 121'})
await dev1.ready; dev1.join(); await sleep(400)
await adminPost('/admin/ban', {fp: 'a'.repeat(16), minutes: 10, reason: '设备测试'})
const dev2 = client(900502, 'devB', 0, 0, {fp: 'a'.repeat(16), dev: 'Pixel 7|Chrome 121'})
await dev2.ready; dev2.join(); await sleep(600)
ok(dev2.got.some((m) => m.t === 'banned') || dev2.ws.readyState !== 1, '同设备换号：被指纹拦下')

for (const c of [walker, runner, driver, cheat, flyer, speeder, jumper, target, banned, again, back, dev1, dev2]) {
  try { c.ws.close() } catch {}
}
srv.kill()
await sleep(200)
console.log(`\n结果: ${fail === 0 ? '全部通过' : `${fail} 项失败`}`)
if (fail) console.log(logs.slice(-1200))
process.exit(fail ? 1 : 0)
