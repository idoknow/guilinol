import {spawn} from 'node:child_process'
import WebSocket from 'ws'
import {createHmac} from 'node:crypto'
const SECRET='test-secret'
const mint=(uid,name)=>{const p=Buffer.from(JSON.stringify({uid,name,exp:Math.floor(Date.now()/1000)+50})).toString('base64url');return p+'.'+createHmac('sha256',SECRET).update(p).digest('base64url')}
const PORT=8896, URL=`ws://127.0.0.1:${PORT}/ws`
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const srv=spawn('node',['rt/server-realtime.mjs'],{env:{...process.env,RT_JOIN_SECRET:SECRET,PORT:String(PORT),
  RT_ROSTER_SUB_MS:'400',RT_ROSTER_FULL_MS:'800',RT_ROSTER_SUB_TTL_MS:'6000',RT_ROSTER_FULL_QPS:'50',
  RT_ROSTER_SUB_RADIUS:'500',RT_RESUME_MS:'600',MAX_PLAYERS:'50'},stdio:['ignore','pipe','pipe']})
let logs=''; srv.stdout.on('data',d=>logs+=d); srv.stderr.on('data',d=>logs+='ERR '+d)
await sleep(2000)
let fail=0
const ok=(c,m)=>{console.log((c?'  PASS ':'  FAIL ')+m); if(!c)fail++}
function client(uid,name,x,z){
  const ws=new WebSocket(URL); const seen=[]
  ws.on('message',m=>seen.push(JSON.parse(m.toString())))
  ws.on('open',()=>ws.send(JSON.stringify({t:'join',ticket:mint(uid,name),name,caps:['roster3'],x,y:3,z,yaw:0})))
  return {ws,seen,send:o=>ws.send(JSON.stringify(o))}
}
const A=client(920001,'A',110.29,25.27)
const B=client(920002,'B',110.35,25.31)          // 附近
const F=client(920003,'F',110.29+3000,25.27) // 3km 外（世界坐标单位是米）
await sleep(1200)
const aId=A.seen.find(m=>m.t==='welcome')?.me.id
const bId=B.seen.find(m=>m.t==='welcome')?.me.id
const fId=F.seen.find(m=>m.t==='welcome')?.me.id

console.log('\n[1] 未订阅：不应该收到 roster3')
ok(!A.seen.some(m=>m.t==='roster3'), 'A 未订阅时没有 roster3')
ok(A.seen.some(m=>m.t==='roster'), 'A 仍收到低频全量 roster（老客户端兼容）')

console.log('\n[2] 订阅：立即收到附近快照 + 随后全量')
A.seen.length=0
A.send({t:'roster_sub'})
await sleep(600)
const near=A.seen.find(m=>m.t==='roster3'&&m.near)
ok(!!near, '收到 near 快照')
if(near){
  const ids=near.near.map(e=>e[0])
  ok(ids.includes(bId), `near 含附近玩家 B(${bId})`)
  ok(!ids.includes(fId), `near 不含 3km 外的 F(${fId})`)
  ok(near.total===3, `near.total=3（实际 ${near.total}）`)
}
await sleep(900)
const full=A.seen.find(m=>m.t==='roster3'&&m.full)
ok(!!full&&full.full.length===3, `随后收到全量快照（${full?full.full.length:0} 人）`)

console.log('\n[3] 增量：有人移动 → up')
A.seen.length=0
B.send({t:'pos',x:110.35+20,y:3,z:25.31,yaw:0})
await sleep(900)
const ups=A.seen.filter(m=>m.t==='roster3').flatMap(m=>m.up||[])
ok(ups.some(u=>u[0]===bId), `收到 B 的 up 增量`)

console.log('\n[4] since 补发：重订阅带 since 不应重发全量')
const lastV=[...A.seen].reverse().find(m=>m.t==='roster3'&&typeof m.v==='number')?.v
A.seen.length=0
A.send({t:'roster_unsub'})
await sleep(200)
A.send({t:'roster_sub',since:lastV})
await sleep(500)
ok(!A.seen.some(m=>m.t==='roster3'&&m.full), 'since 命中时没有重发全量')

console.log('\n[5] 退订：不再收到 roster3')
A.send({t:'roster_unsub'})
await sleep(300)
A.seen.length=0
B.send({t:'pos',x:110.5,y:3,z:25.5,yaw:0})
await sleep(900)
ok(!A.seen.some(m=>m.t==='roster3'), '退订后没有 roster3')

console.log('\n[6] 不续订 → 超时被暂停；续订 → 保持')
A.send({t:'roster_sub'})
A.seen.length=0
await sleep(6800)
const paused=A.seen.find(m=>m.t==='roster3'&&m.paused)
ok(!!paused, '超时后收到 paused')
A.seen.length=0
A.send({t:'roster_sub'}); await sleep(300); A.send({t:'roster_ping'})
await sleep(1200)
ok(A.seen.some(m=>m.t==='roster3'&&!m.paused), '重新订阅+续订后恢复推送')

srv.kill(); await sleep(200)
console.log(`\n结果: ${fail===0?'全部通过':'有 '+fail+' 项失败'}`)
if(fail) console.log('日志尾部:', logs.slice(-500))
process.exit(fail?1:0)
