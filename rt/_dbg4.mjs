import {spawn} from 'node:child_process'
import WebSocket from 'ws'
import {createHmac} from 'node:crypto'
const SECRET='test-secret'
const mint=(uid,name)=>{const p=Buffer.from(JSON.stringify({uid,name,exp:Math.floor(Date.now()/1000)+50})).toString('base64url');return p+'.'+createHmac('sha256',SECRET).update(p).digest('base64url')}
const PORT=8894
const srv=spawn('node',['rt/server-realtime.mjs'],{env:{...process.env,RT_JOIN_SECRET:SECRET,PORT:String(PORT),RT_ROSTER_MS:'400',MAX_PLAYERS:'50'},stdio:['ignore','pipe','pipe']})
srv.stdout.on('data',d=>process.stdout.write('[out] '+d));srv.stderr.on('data',d=>process.stdout.write('[err] '+d))
await new Promise(r=>setTimeout(r,2500))
function run(extra,label){
  return new Promise(res=>{
    const ws=new WebSocket(`ws://127.0.0.1:${PORT}/ws`);const seen=[]
    ws.on('message',m=>seen.push(JSON.parse(m.toString())))
    ws.on('close',(c)=>res({label,close:c,types:seen.map(m=>m.t)}))
    ws.on('open',()=>ws.send(JSON.stringify({t:'join',ticket:mint(900001+Math.floor(Math.random()*1000),'A'),name:'A',x:1,y:3,z:1,yaw:0,...extra})))
  })
}
console.log('无 caps:', JSON.stringify(await run({},'plain')))
console.log('有 caps:', JSON.stringify(await run({caps:['roster2']},'caps')))
srv.kill();process.exit(0)
