import {spawn} from 'node:child_process'
import WebSocket from 'ws'
import {createHmac} from 'node:crypto'
const SECRET='test-secret'
const mint=(uid,name)=>{const p=Buffer.from(JSON.stringify({uid,name,exp:Math.floor(Date.now()/1000)+50})).toString('base64url');return p+'.'+createHmac('sha256',SECRET).update(p).digest('base64url')}
const PORT=8898, URL=`ws://127.0.0.1:${PORT}/ws`
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const srv=spawn('node',['rt/server-realtime.mjs'],{env:{...process.env,RT_JOIN_SECRET:SECRET,PORT:String(PORT),RT_ROSTER_MS:'500',RT_ROSTER_FULL_MS:'2500',RT_RESUME_MS:'800',MAX_PLAYERS:'50'},stdio:['ignore','pipe','pipe']})
let logs=''
srv.stdout.on('data',d=>{logs+=d}); srv.stderr.on('data',d=>{logs+='ERR '+d})
await sleep(2000)
let fail=0
const ok=(cond,msg)=>{console.log((cond?'  PASS ':'  FAIL ')+msg); if(!cond)fail++}

function client(uid,name,caps){
  const ws=new WebSocket(URL); const seen=[]
  ws.on('message',m=>seen.push(JSON.parse(m.toString())))
  ws.on('open',()=>ws.send(JSON.stringify({t:'join',ticket:mint(uid,name),name,caps,x:110.29,y:3,z:25.27,yaw:0})))
  return {ws,seen,send:o=>ws.send(JSON.stringify(o))}
}
const A=client(910001,'A-新客户端',['roster2'])
const B=client(910002,'B-老客户端',undefined)
await sleep(1500)
const bId=B.seen.find(m=>m.t==='welcome')?.me.id

console.log('\n[1] 老客户端仍收全量 roster，且不收 roster2')
ok(B.seen.some(m=>m.t==='roster'&&Array.isArray(m.players)), 'B 收到 roster.players')
ok(!B.seen.some(m=>m.t==='roster2'), 'B 没有收到 roster2')

console.log('\n[2] 新客户端收 roster2，且不收全量 roster')
const aR2=A.seen.filter(m=>m.t==='roster2')
ok(aR2.length>0, `A 收到 ${aR2.length} 条 roster2`)
ok(A.seen.filter(m=>m.t==='roster').length<=1, 'A 只在进服时收到 1 次全量 roster（初始快照），之后走增量')
const first=aR2[0]
const listed=new Set([...(first.full||[]).map(e=>e[0]), ...(first.add||[]).map(e=>e[0])])
ok(listed.size>=2, `首包列出了 ${listed.size} 个玩家（含 A 自己，客户端会自行过滤）`)

console.log('\n[3] 有玩家移动 → 只推 up 增量')
A.seen.length=0
B.send({t:'pos',x:160.5,y:3,z:80.5,yaw:1})
await sleep(1200)
const ups=A.seen.filter(m=>m.t==='roster2').flatMap(m=>m.up||[])
ok(ups.some(u=>u[0]===bId), `收到 B(${bId}) 的 up 增量，共 ${ups.length} 条`)

console.log('\n[4] 有人进来 → add；离开 → del')
A.seen.length=0
const C=client(910003,'C-新客户端',['roster2'])
await sleep(1200)
const adds=A.seen.filter(m=>m.t==='roster2').flatMap(m=>m.add||[])
const cId=C.seen.find(m=>m.t==='welcome')?.me.id
ok(adds.some(e=>e[0]===cId), `收到 C(${cId}) 的 add`)
A.seen.length=0
C.ws.close()
await sleep(1500)
const dels=A.seen.filter(m=>m.t==='roster2').flatMap(m=>m.del||[])
ok(dels.includes(cId), `收到 C(${cId}) 的 del`)

console.log('\n[5] 增量消息体积对比（同样人数下）')
const fullMsgs=B.seen.filter(m=>m.t==='roster')
const lastFull=fullMsgs[fullMsgs.length-1]
if(lastFull){const f=Buffer.byteLength(JSON.stringify(lastFull)); console.log(`  全量 roster（B 视角人数 ${lastFull.players.length}）: ${f} 字节`)}
const deltaSizes=aR2.map(m=>Buffer.byteLength(JSON.stringify(m)))
console.log(`  roster2 包体积: ${deltaSizes.join(', ')} 字节`)

srv.kill()
await sleep(300)
console.log(`\n结果: ${fail===0?'全部通过':'有 '+fail+' 项失败'}`)
if(fail){console.log('服务端日志尾部:', logs.slice(-400))}
process.exit(fail?1:0)
