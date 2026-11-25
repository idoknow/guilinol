import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash,createHmac,randomUUID,randomBytes} from 'node:crypto'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {createServer} from 'node:http'
import {writeFile} from 'node:fs/promises'
import {setTimeout as delay} from 'node:timers/promises'
import WebSocket from 'ws'
import pg from 'pg'
import {fixture} from './selfhost-test.mjs'
import {record} from '../server/mp-store.mjs'

test('two players: private RT state, role gate, public-safe admin state, persistence and kick',async context=>{
  const storage=await fixture({postgresOnly:true}),pool=new pg.Pool({connectionString:storage.env.DATABASE_URL})
  const secret=randomUUID(),children=[],sockets=[],ip='192.0.2.17'
  const manifest=createServer((req,res)=>res.end(JSON.stringify({
    landmarks:[{name:'auto-ignored',position:[10,0,20]},{name:'测试地标',position:[10,0,20]}],
    peaks:{entries:[{name:'伏波山',center:[500,0,500]}]},
  }))).listen(0,'127.0.0.1')
  await once(manifest,'listening')
  context.after(async()=>{
    for(const client of sockets)client.terminate()
    for(const child of children)if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill();await done}
    manifest.close();await pool.end();await storage.close()
  })
  async function service(entry,env,probe){
    const listener=createServer().listen(0,'127.0.0.1');await once(listener,'listening')
    const port=listener.address().port,base=`http://127.0.0.1:${port}`;await new Promise(done=>listener.close(done))
    const child=spawn(process.execPath,['--import','tsx',entry],{env:{...process.env,...storage.env,PORT:String(port),PUBLIC_ORIGIN:base,...env},stdio:'inherit'})
    children.push(child)
    for(let attempt=0;attempt<150;attempt++){if(await fetch(base+probe).then(()=>true).catch(()=>false))return {base,child};await delay(100)}
    throw Error('failed to start '+entry)
  }
  const {importWords}=await import('./chat-words-import.mjs');await importWords(pool)
  const rt=await service('rt/server-realtime.mjs',{RT_ADMIN_TOKEN:secret,RT_JOIN_SECRET:secret,KICK_TOKEN:secret},'/health')
  const raw=async()=> (await fetch(rt.base+'/admin/state',{headers:{'X-Admin-Token':secret}})).json()
  assert.equal((await fetch(rt.base+'/admin/state')).status,403)
  assert.notEqual((await fetch(rt.base+'/ws/admin/state',{headers:{'X-Admin-Token':secret}})).status,200)
  const tokens=[]
  for(const [index,name] of ['Alice','Bob'].entries()){
    const {rows:[{uid}]}=await pool.query(`insert into users(id,email,nickname,salt,digest,verified,role) values($1,$2,$1,'','',1,$3) returning uid`,[name,name+'@example.test',index?'user':'admin'])
    const token=randomBytes(32).toString('hex');tokens.push(token)
    await pool.query('insert into sessions values($1,$2,unixepoch()+600)',[createHash('sha256').update(token).digest('hex'),name])
    const client=new WebSocket(rt.base.replace('http','ws')+'/ws',{headers:{'x-forwarded-for':ip,'user-agent':'fixture'}});sockets.push(client);await once(client,'open')
    const body=Buffer.from(JSON.stringify({name,uid:Number(uid),exp:Math.floor(Date.now()/1000)+55})).toString('base64url')
    client.send(JSON.stringify({t:'join',ticket:body+'.'+createHmac('sha256',secret).update(body).digest('base64url')}));await once(client,'message')
  }
  const api=await service('server/index.mjs',{RT_INTERNAL_URL:rt.base,RT_ADMIN_TOKEN:secret,KICK_TOKEN:secret,
    MP_WORLD_MANIFEST_URL:`http://127.0.0.1:${manifest.address().port}/world/manifest.json`},'/api/health')
  const call=(suffix='',index=0,body)=>fetch(api.base+'/api/admin/mp'+suffix,{method:body?'POST':'GET',headers:{origin:api.base,cookie:'glol_session='+tokens[index]},body:body&&JSON.stringify(body)})
  for(const suffix of ['','/history','/sessions','/activities','/gameplay','/kick'])assert.equal((await call(suffix,1,suffix==='/kick'?{}:undefined)).status,403)
  const chatSettings=index=>fetch(api.base+'/api/admin/chat/settings',{headers:{cookie:'glol_session='+tokens[index]}})
  assert.equal((await chatSettings(1)).status,403);assert.equal((await (await chatSettings(0)).json()).unmoderated_policy,'local_only')
  await pool.query(`insert into perf_network values('192.0.2.0/24','CN','测试地区','测试市','测试网络')`)
  for(let attempt=0;attempt<120;attempt++){if((await raw()).players.every(player=>player.rttMs!==null))break;await delay(100)}
  sockets[0].send(JSON.stringify({t:'pos',x:10,z:20}))
  sockets[0].send(JSON.stringify({t:'act',act:'fishing',detail:'岸边垂钓'}))
  sockets[1].send(JSON.stringify({t:'pos',x:500,z:500,bike:'ebike_01'}))
  await delay(1100)
  sockets[0].send(JSON.stringify({t:'act',act:'mifen',detail:'田源米粉'}))
  await delay(150)
  await pool.query(`update chat_settings set config=config||'{"unmoderated_policy":"local_only"}'::jsonb`)
  const chatAck=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('chat ack timed out')),5000)
    const handler=raw=>{const reply=JSON.parse(raw);if(reply.t==='chat_ack'){clearTimeout(timer);sockets[0].off('message',handler);resolve(reply)}}
    sockets[0].on('message',handler)
  })
  sockets[0].send(JSON.stringify({t:'chat',text:'你好'}));assert.equal((await chatAck).ok,true)
  const snapshot=await (await call()).json();assert.equal(snapshot.rt,'up');assert.equal(snapshot.server.online,2)
  assert.equal(snapshot.chat[0].text,'你好');assert.equal(snapshot.server.traffic.in.pos.packets,2)
  assert.ok(!JSON.stringify(snapshot).includes(ip));assert.ok(!JSON.stringify(snapshot).includes('"ip":'));assert.ok(!JSON.stringify(snapshot).includes('"nodeIp":'))
  const alice=snapshot.players.find(p=>p.name==='Alice'),bob=snapshot.players.find(p=>p.name==='Bob')
  assert.equal(alice.landmark,'测试地标');assert.equal(alice.landmarkDist,0);assert.equal(alice.activity,'mifen');assert.equal(alice.activityDetail,'田源米粉')
  assert.ok(alice.activityTotals.fishing>=1)
  assert.equal(bob.landmark,'伏波山');assert.equal(bob.activity,'ebike')
  assert.ok(snapshot.activityBreakdown.length>=2)
  for(const player of snapshot.players){assert.ok(player.rttMs>0&&player.posHz>0);assert.equal(player.region.isp,'测试网络');assert.ok(player.account.id)}
  const uid=bob.uid,closed=once(sockets[1],'close')
  assert.deepEqual(await (await call('/kick',0,{uid,reason:'fixture kick',minutes:2})).json(),{ok:true,kicked:1});await closed
  assert.equal((await pool.query("select action from admin_audit where actor_id='Alice'")).rows[0].action,'mp.kick')
  const end=await raw();assert.equal(end.players[0].ip,ip);assert.equal(end.players[0].nodeIp,ip)
  const resolveLandmark=(x,z)=>Math.hypot(x-10,z-20)<Math.hypot(x-500,z-500)?{name:'测试地标',dist:0}:{name:'伏波山',dist:0}
  await record(pool,end,new Date(),resolveLandmark);await record(pool,end,new Date(),resolveLandmark)
  // 重复采样必须幂等：fishing 总秒数与单次采样完全一致，不翻倍
  const gpCheck=await pool.query("select seconds from mp_gameplay_hour where activity='fishing'")
  assert.equal(gpCheck.rows.length,1)
  assert.equal(Number(gpCheck.rows[0].seconds),Math.round(alice.activityTotals.fishing))
  const actsRes=await (await call('/activities?range=7d')).json()
  assert.ok(actsRes.items.some(item=>item.kind==='activity'&&item.activity==='fishing'&&item.detail==='岸边垂钓'))
  assert.ok(actsRes.accounts.length>=2)
  const filteredActs=await (await call('/activities?range=7d&activity=fishing&q='+encodeURIComponent('垂钓'))).json()
  assert.ok(filteredActs.items.length>=1&&filteredActs.items.every(i=>i.activity==='fishing'))
  const gpRes=await (await call('/gameplay?range=24h')).json()
  assert.ok(gpRes.totalSeconds>=1&&gpRes.activities.some(a=>a.activity==='fishing'&&a.players>=1))
  assert.ok((await (await call('/gameplay?range=7d')).json()).activities.length>=1)
  // 兜底地标验证：即使 manifest URL 不可达，也不得返回 null/野外，应命中内置桂林核心地标
  const fallbackApi=await service('server/index.mjs',{RT_INTERNAL_URL:rt.base,RT_ADMIN_TOKEN:secret,KICK_TOKEN:secret,
    MP_WORLD_MANIFEST_URL:'http://127.0.0.1:1/world/manifest.json'},'/api/health')
  sockets[0].send(JSON.stringify({t:'pos',x:-685,z:1182}))
  await delay(100)
  const fbSnap=await (await fetch(fallbackApi.base+'/api/admin/mp',{headers:{cookie:'glol_session='+tokens[0]}})).json()
  assert.equal(fbSnap.server.landmarkSource,'builtin')
  assert.equal(fbSnap.players[0].landmark,'象鼻山')
  assert.equal(fbSnap.players[0].landmarkDist,0)
  const storedSession=(await pool.query('select client_ip,node_ip from mp_sessions where uid=$1',[uid])).rows[0]
  assert.deepEqual(storedSession,{client_ip:ip,node_ip:ip})
  const {sessions}=await (await call('/sessions?uid='+uid)).json();assert.equal(sessions.length,1);assert.equal(sessions[0].closeCode,4003);assert.equal(sessions[0].reason,'fixture kick')
  const history=await (await call('/history?range=24h')).json();assert.ok(history.series.length);assert.equal(history.daily.at(-1).sessions,2);assert.equal(history.daily.at(-1).dau,2)
  assert.ok((await (await call('/history?range=30d')).json()).series.length)
  if(process.env.MP_SAMPLE_FILE)await writeFile(process.env.MP_SAMPLE_FILE,JSON.stringify({snapshot,history},null,2))
  const exit=once(rt.child,'exit');rt.child.kill();await exit;assert.equal((await (await call()).json()).rt,'down')
})
