// 联机反外挂回归：作弊必须被拦，正常移动一次都不能误伤
import {spawn} from 'node:child_process'
import WebSocket from 'ws'
import {createHmac} from 'node:crypto'
import {passengerMove} from './flight-passenger.mjs'
import {checkMove} from './anti-cheat.mjs'
import {register} from 'tsx/esm/api'
register()
const {aircraftPose}=await import('../web/src/helicopter/flight.ts')
const {services,routeVersion}=await import('../lib/helicopter-clock.ts')

const SECRET = 'test-secret'
const ADMIN = 'admin-token'
const PORT = 8897
const URL = `ws://127.0.0.1:${PORT}/ws`
const mint = (uid, name) => {
  const p = Buffer.from(JSON.stringify({uid,name,exp:Math.floor(Date.now()/1000)+50})).toString('base64url')
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

for(const [mode,plan] of Object.entries(services)){
  const player={uid:900150,x:-805,y:154,z:258}
  const flight={uid:player.uid,ticket:'10',seat:2,mode,t0:100000,route_version:routeVersion}
  let events=0
  for(let elapsed=-7000;elapsed<=(plan.total+5)*1000;elapsed+=100){
    const at=flight.t0+elapsed,pose=aircraftPose(at,flight.t0,mode)
    const msg={x:pose.x+.6,y:pose.y+.7,z:pose.z-1,foot:false,bike:'',passenger:true}
    const verdict=passengerMove(flight,player,msg,at)
    if(!verdict?.ok)events++
    else Object.assign(player,msg)
  }
  ok(events===0,`有效座位 ${mode} 全程：${events} 次误报`)
  const away={x:0,y:300,z:200,passenger:true}
  ok(passengerMove(flight,player,away,flight.t0+50000)?.reject,'有效座位不能偏离航线')
  const at=flight.t0+60000,seat={...aircraftPose(at,flight.t0,mode),passenger:true}
  const rejoin={...seat,posAt:at,uid:player.uid}
  ok(passengerMove(flight,rejoin,seat,at)?.ok,'机上重连仍须贴合航线')
  ok(passengerMove(flight,{...rejoin,uid:900151},seat,at)?.reject,'其他 UID 不能借用座位')
  ok(passengerMove(flight,{...player,flightTicket:null},seat,at)?.reject,'不能从地面跳到巡航中的座位')
}
ok(checkMove({x:0,y:3,z:0,posAt:1000,foot:false,bike:''},0,103,0,1100).observation==='altitude_unverified','旧版乘客姿态不是高度豁免')
const unseated=client(900150,'not-seated')
await unseated.ready;unseated.join();await sleep(400)
unseated.pos(0,105,0,{foot:false,bike:'',passenger:true});await sleep(200)
ok(unseated.got.some(packet=>packet.t==='setback'&&packet.kind==='teleport'),'未获座位的乘客声明被拒并判违规')
unseated.ws.close()

// ── 2. 作弊必须被拦
console.log('\n[2] 作弊必须被拦')
const cheat = client(900201, 'cheat')
await cheat.ready; cheat.join(); await sleep(400)
cheat.pos(1000, 3, 0)
await sleep(200)
cheat.pos(2500, 3, 0)          // 3 秒内第二次 → 必须拦
await sleep(300)
ok(cheat.setbacks() >= 1, '连续瞬移（3s 内第二次）：被拉回')

const flyer = client(900202, 'fly')
await flyer.ready; flyer.join(); await sleep(400)
flyer.pos(0, 3, 0); await sleep(80)
flyer.pos(0, 60, 0)
await sleep(300)
ok(flyer.setbacks() === 0, '没有服务端高度：只记录，不处罚')

const speeder = client(900203, 'speed')
await speeder.ready; speeder.join(); await sleep(400)
let sx = 0
for (let i = 0; i < 30; i++) { sx += 2; speeder.pos(sx, 3, 0); await sleep(50) }   // 40 m/s 徒步
ok(speeder.setbacks() >= 1, '徒步 40 m/s 加速：被拉回')

// ── 3. 合法瞬移放行一次，但 3 秒内不能出拳
console.log('\n[3] 合法瞬移与出拳锁')
const jumper = client(900301, 'jump',1000,1000)
await jumper.ready; jumper.join(); await sleep(400)
const before = jumper.setbacks()
ok(before===0,'现网票据 join (1000,1000) 不拉回')
jumper.ws.send(JSON.stringify({t:'travel',reason:'map',target:{x:1500,z:1500}}));await sleep(100)
ok(jumper.got.filter(m=>m.t==='travel_result').at(-1)?.ok===false,'客户端任意坐标未获许可')
jumper.ws.send(JSON.stringify({t:'travel',reason:'map',target:'spot:pagodas'}));await sleep(100)
ok(jumper.got.filter(m=>m.t==='travel_result').at(-1)?.ok===true,'地标 ID 获得许可');jumper.pos(-905,3,520)
await sleep(300)
ok(jumper.setbacks() === before, '静止状态：允许系统许可指定的目的地')
const target = client(900302, 'target',-904,520)
await target.ready; target.join(undefined); await sleep(200)
target.pos(-904,3,520); await sleep(120)
jumper.pos(-904.1,3,520); await sleep(120)
jumper.ws.send(JSON.stringify({t: 'punch', id: target.got.find((m) => m.t === 'welcome')?.me?.id, kind: 'jab', zone: 'body', s: 1}))
await sleep(300)
const tHp = target.got.filter((m) => m.t === 'combat').map((m) => m.hp)
ok(!tHp.length || tHp.every((hp) => hp === tHp[0]), '瞬移后 3 秒内出拳：不生效')
target.ws.send(JSON.stringify({t:'punch',id:jumper.got.find(m=>m.t==='welcome')?.me.id,kind:'jab',zone:'body',s:1}))
target.ws.send(JSON.stringify({t:'travel',reason:'map',target:'spot:bridge'}));await sleep(150)
ok(target.got.filter(m=>m.t==='travel_result').at(-1)?.ok===false,'未传送过的玩家在战斗中不能取得许可')

// ── 4. 封禁与人工解封
console.log('\n[4] 封禁 / 人工解封')
const banned = client(900401, 'banned')
await banned.ready; banned.join(); await sleep(400)
const ban = await adminPost('/admin/ban', {uid: 900401, minutes: 10, reason: '测试', actor: 'test'})
ok(ban.status === 200 && ban.body.ok, '按 UID 封禁成功')
await sleep(200)
const again = client(900401, 'banned')
await again.ready; again.join(); await sleep(600)
ok(again.got.some(m=>m.t==='banned'&&m.reason==='测试'&&m.until>Date.now()&&m.recordId===ban.body.recordId), '重连收到同一封禁 ID、原因和截止时间')
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
