
import {spawn} from 'node:child_process'
import WebSocket from 'ws'
import {createHmac} from 'node:crypto'
const SECRET='test-secret'
const mint=(uid,name)=>{const p=Buffer.from(JSON.stringify({uid,name,exp:Math.floor(Date.now()/1000)+50})).toString('base64url');return p+'.'+createHmac('sha256',SECRET).update(p).digest('base64url')}
const PORT=8899, URL=`ws://127.0.0.1:${PORT}/ws`
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const srv=spawn('node',['rt/server-realtime.mjs'],{env:{...process.env,RT_JOIN_SECRET:SECRET,PORT:String(PORT),RT_RESUME_MS:'3000',RT_JOIN_TIMEOUT_MS:'15000'},stdio:['ignore','pipe','pipe']})
let logs=''
srv.stdout.on('data',d=>{logs+=d})
srv.stderr.on('data',d=>{logs+='ERR '+d})
await sleep(2500)
console.log('spawn pid', srv.pid, 'exitCode', srv.exitCode, 'logs', JSON.stringify(logs.slice(0,120)))
if(srv.exitCode!==null){console.log('服务端启动失败:', logs.slice(0,300));process.exit(1)}

function client(uid,name){
  const ws=new WebSocket(URL); const seen=[]
  ws.on('message',m=>seen.push(JSON.parse(m.toString())))
  ws.on('error',e=>{console.log('client error',e.message);seen.push({t:'__error',msg:e.message})})
  ws.on('open',()=>ws.send(JSON.stringify({t:'join',ticket:mint(uid,name),name,x:110.29,y:3,z:25.27,yaw:0})))
  return {ws,seen}
}
const A=client(900001,'A'), B=client(900002,'B')
await sleep(800)
const aId=A.seen.find(m=>m.t==='welcome')?.me.id
const bId=B.seen.find(m=>m.t==='welcome')?.me.id
console.log('A id', aId, '| B id', bId, '| B 看到的人数', B.seen.find(m=>m.t==='welcome')?.online)

// 模拟 CDN 掐连接：直接掐 TCP（不发 close 帧）→ 服务端应当记为 1006 并保留会话
B.seen.length=0
A.ws.terminate()
await sleep(600)
console.log('断开后服务端日志:', logs.split('\n').filter(l=>l.includes('rt-close')||l.includes('rt-hold')).slice(-2).join(' | ').slice(0,220))

// 同 uid 在宽限期内回来
const A2=client(900001,'A')
await sleep(900)
const welcome2=A2.seen.find(m=>m.t==='welcome')
console.log('续连 welcome:', JSON.stringify({id:welcome2?.me?.id, resumed:welcome2?.me?.resumed}))
console.log('B 期间收到的事件:', B.seen.map(m=>m.t).join(',') || '（无）')

// 续连后还能不能正常上报位置（最容易漏的一环：socket 的 id 换新了）
B.seen.length=0
A2.ws.send(JSON.stringify({t:'pos',x:110.30,y:3,z:25.28,yaw:1}))
await sleep(400)
console.log('续连后 B 收到的位置更新:', B.seen.filter(m=>m.t==='pos').length, '条')

// 再断一次，等超过宽限期 → 应该真的离场
B.seen.length=0
console.log('A2 readyState 前:', A2.ws.readyState)
A2.ws.terminate()
await sleep(1000)
const health=await fetch(`http://127.0.0.1:${PORT}/health`).then(r=>r.json())
console.log('断开 1s 后 health online:', health.online, '| A2 readyState:', A2.ws.readyState)
await sleep(3500)
console.log('超时后 B 收到:', B.seen.map(m=>m.t).join(',') || '（无）')
console.log('B 的 roster 是否还有 A:', (B.seen.filter(m=>m.t==='roster').pop()?.players||[]).map(x=>x[0]).join(','))
console.log('服务端日志尾部:', logs.split('\n').filter(l=>/rt-|leave/.test(l)).slice(-4).join(' | ').slice(0,400))
srv.kill()
process.exit(0)
