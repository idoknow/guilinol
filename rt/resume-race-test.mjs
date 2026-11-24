
import {spawn} from 'node:child_process'
import WebSocket from 'ws'
import {createHmac} from 'node:crypto'
const SECRET='test-secret'
const mint=(uid,name)=>{const p=Buffer.from(JSON.stringify({uid,name,exp:Math.floor(Date.now()/1000)+50})).toString('base64url');return p+'.'+createHmac('sha256',SECRET).update(p).digest('base64url')}
const PORT=8898, URL=`ws://127.0.0.1:${PORT}/ws`
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const srv=spawn('node',['rt/server-realtime.mjs'],{env:{...process.env,RT_JOIN_SECRET:SECRET,PORT:String(PORT),RT_RESUME_MS:'5000'},stdio:['ignore','pipe','pipe']})
let logs=''; srv.stdout.on('data',d=>{logs+=d}); srv.stderr.on('data',d=>{logs+='ERR '+d})
await sleep(2200)
const mk=(uid,name)=>{const ws=new WebSocket(URL);const seen=[];ws.on('message',m=>seen.push(JSON.parse(m.toString())));ws.on('error',()=>{});ws.on('open',()=>ws.send(JSON.stringify({t:'join',ticket:mint(uid,name),name,x:110.29,y:3,z:25.27,yaw:0})));return {ws,seen}}
const B=mk(910002,'B')
await sleep(500)
// 竞态：切断 A 后立刻续连（close 事件可能晚于新 join 到达服务端）
const A1=mk(910001,'A'); await sleep(500)
A1.ws.terminate()
const A2=mk(910001,'A')          // 0ms 后立刻回来
await sleep(1200)
const w=A2.seen.find(m=>m.t==='welcome')
console.log('极端竞态续连:', JSON.stringify({id:w?.me?.id,resumed:w?.me?.resumed}))
await sleep(500)
A2.ws.send(JSON.stringify({t:'pos',x:110.30,y:3,z:25.28,yaw:1}))
await sleep(600)
console.log('续连后还能移动:', A2.ws.readyState===1, '| 服务端有 stale-close 日志:', /rt-stale-close/.test(logs))
const h=await fetch(`http://127.0.0.1:${PORT}/health`).then(r=>r.json())
console.log('在线人数:', h.online, '（应为 2，没有多出幽灵）')
srv.kill(); process.exit(0)
