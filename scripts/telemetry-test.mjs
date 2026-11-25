import assert from 'node:assert/strict'
import test from 'node:test'
import {randomUUID} from 'node:crypto'
import {validate,receive} from '../server/telemetry.mjs'
import {Histogram,route} from '../server/perf-monitor.mjs'
import {resolveClientIp} from '../server/client-ip.mjs'
import {resolveClientIp as resolveRtClientIp} from '../rt/client-ip.mjs'
import {createPerfCache} from '../server/perf-cache.mjs'
const batch=()=>({sid:randomUUID(),context:{device:'desktop'},rows:[{kind:'window',fps:60,grid:'-3,2',mode:'fly'}]})
test('bounded minute histogram',()=>{
  const h=new Histogram()
  assert.equal(h.percentile(.5),null)
  for(let i=1;i<=100;i++)h.add(i)
  assert.ok(h.percentile(.5)>=50&&h.percentile(.5)<55)
  assert.ok(h.percentile(.95)>=95&&h.percentile(.95)<105)
  assert.equal(h.count,100)
})
test('bounded routes omit player supplied identifiers',()=>{
  assert.equal(route('/api/feedback/example/photos/5'),'/api/feedback/:id/photos/:n')
  assert.equal(route('/api/me'),'/api/me')
  assert.equal(route('/api/secret'),'/api/other')
})
test('payload validation excludes identity, URLs and unsupported coordinates',()=>{
  assert.ok(validate(batch()))
  for(const extra of [{email:'a@b.com'},{x:21},{ms:-1},{count:'6'},{grid:'1.2,3'}])
    assert.equal(validate({...batch(),rows:[{kind:'window',...extra}]}),false)
})
test('bounded stream rejects oversized body before SQL',async()=>{
  const request=new Request('http://localhost/api/t',{method:'POST',body:'a'.repeat(4097)})
  assert.equal((await receive(request,null,'http://localhost')).status,413)
})
test('receiver inserts one batch with trusted client_ip and node_ip outside event payload',async()=>{
  const message=batch(),calls=[]
  const db={async query(sql,args){calls.push({sql,args})}}
  const request=new Request('http://localhost/api/t',{method:'POST',headers:{Origin:'http://localhost','CF-Connecting-IP':'192.0.2.10','CF-IPCountry':'CN'},body:JSON.stringify(message)})
  assert.equal((await receive(request,db,'http://localhost',{remoteAddr:'127.0.0.1'})).status,204)
  assert.equal(calls.length,1)
  const [{args}]=calls
  assert.equal(args[0],'192.0.2.10')
  assert.equal(args[2],message.sid)
  assert.equal(args[7],'CN')
  assert.deepEqual(args[8],message.context)
  assert.deepEqual(JSON.parse(args[9]),message.rows)
  assert.equal(args[10],'192.0.2.10')
  assert.equal(args[11],'127.0.0.1')
})
test('receiver rejects forged forwarded headers from untrusted remote_addr and falls back on invalid literals',async()=>{
  const message=batch(),calls=[]
  const db={async query(sql,args){calls.push({sql,args})}}
  // 不可信直连对端伪造 X-Forwarded-For / CF-Connecting-IP / CF-IPCountry：全部忽略，退回 remoteAddr
  const forged=new Request('http://localhost/api/t',{method:'POST',headers:{Origin:'http://localhost','CF-Connecting-IP':'202.103.225.68','X-Real-IP':'202.103.225.68','X-Forwarded-For':'202.103.225.68, 111.223.13.41','CF-IPCountry':'US'},body:JSON.stringify(message)})
  assert.equal((await receive(forged,db,'http://localhost',{remoteAddr:'198.51.100.99'})).status,204)
  assert.equal(calls[0].args[0],'198.51.100.99')
  assert.equal(calls[0].args[7],null)
  assert.equal(calls[0].args[10],'198.51.100.99')
  assert.equal(calls[0].args[11],'198.51.100.99')

  // 可信代理但头里是非法 IP 字面量：退回 remoteAddr
  const invalid=new Request('http://localhost/api/t',{method:'POST',headers:{Origin:'http://localhost','X-Real-IP':'not-an-ip','X-Forwarded-For':'192.0.2.1:8080'},body:JSON.stringify(message)})
  assert.equal((await receive(invalid,db,'http://localhost',{remoteAddr:'10.42.0.8'})).status,204)
  assert.equal(calls[1].args[0],'10.42.0.8')
  assert.equal(calls[1].args[10],'10.42.0.8')
  assert.equal(calls[1].args[11],'10.42.0.8')

  // CDN -> Traefik/nginx：x-real-ip 为真实客户端 IP，x-forwarded-for 带 CDN 节点 IP
  const cdn=new Request('http://localhost/api/t',{method:'POST',headers:{Origin:'http://localhost','X-Real-IP':'202.103.225.68','X-Forwarded-For':'202.103.225.68, 111.223.13.41'},body:JSON.stringify(message)})
  assert.equal((await receive(cdn,db,'http://localhost',{remoteAddr:'10.42.0.8'})).status,204)
  assert.equal(calls[2].args[0],'202.103.225.68')
  assert.equal(calls[2].args[10],'202.103.225.68')
  assert.equal(calls[2].args[11],'111.223.13.41')
})
test('receiver falls back gracefully when perf_event lacks client_ip/node_ip columns (42703)',async()=>{
  const message=batch(),calls=[]
  const db={async query(sql,args){
    calls.push({sql,args})
    if(sql.includes('client_ip'))throw Object.assign(new Error('column missing'),{code:'42703'})
  }}
  const request=new Request('http://localhost/api/t',{method:'POST',headers:{Origin:'http://localhost','X-Real-IP':'202.103.225.68'},body:JSON.stringify(message)})
  assert.equal((await receive(request,db,'http://localhost',{remoteAddr:'127.0.0.1'})).status,204)
  assert.equal(calls.length,2)
  assert.equal(calls[1].args.length,10)
  assert.equal(calls[1].args[0],'202.103.225.68')
})
test('client-ip resolver priority, trusted proxy CIDRs, and rt parity',()=>{
  for(const resolve of [resolveClientIp,resolveRtClientIp]){
    assert.deepEqual(
      resolve({'cf-connecting-ip':'202.103.225.68','x-real-ip':'198.51.100.1','x-forwarded-for':'111.223.13.41'},'::ffff:10.42.0.5'),
      {clientIp:'202.103.225.68',nodeIp:'111.223.13.41',trusted:true},
    )
    assert.deepEqual(
      resolve({'x-real-ip':'202.103.225.68','x-forwarded-for':'111.223.13.41'},'127.0.0.1'),
      {clientIp:'202.103.225.68',nodeIp:'111.223.13.41',trusted:true},
    )
    assert.deepEqual(
      resolve({'x-forwarded-for':'202.103.225.68, 111.223.13.41'},'43.248.12.3',{trustedProxies:'43.248.0.0/16'}),
      {clientIp:'202.103.225.68',nodeIp:'43.248.12.3',trusted:true},
    )
    assert.deepEqual(
      resolve({'x-forwarded-for':'202.103.225.68','x-real-ip':'202.103.225.68'},'198.51.100.55'),
      {clientIp:'198.51.100.55',nodeIp:'198.51.100.55',trusted:false},
    )
    assert.deepEqual(
      resolve({'x-forwarded-for':'bad, 202.103.225.68'},'127.0.0.1'),
      {clientIp:'127.0.0.1',nodeIp:'202.103.225.68',trusted:true},
    )
  }
})
test('perf cache deduplicates concurrent queries, canonicalizes param order, and serves hits/stale within ms',async()=>{
  let clock=1000000,calls=0
  const cache=createPerfCache({
    now:()=>clock,
    ttlMs:120000,
    staleMs:900000,
    runPerfQuery:async(path,params)=>{
      calls++
      await new Promise(r=>setTimeout(r,20))
      return Response.json({path,from:params.get('from'),calls})
    },
  })
  const p1=new URLSearchParams({from:'2026-11-24T00:00:00Z',to:'2026-11-25T00:00:00Z'})
  const p2=new URLSearchParams({to:'2026-11-25T00:00:00Z',from:'2026-11-24T00:00:00Z'})
  // 并发同 key（参数顺序不同）只打 1 次库
  const [r1,r2]=await Promise.all([cache('admin/overview',p1),cache('admin/overview',p2)])
  assert.equal(calls,1)
  assert.deepEqual(await r1.json(),await r2.json())
  // 缓存命中
  const t0=performance.now()
  const r3=await cache('admin/overview',p2)
  assert.ok(performance.now()-t0<50)
  assert.equal((await r3.json()).calls,1)
  // 过期但在 stale 窗口内：立即返回旧值并在后台刷新
  clock+=125000
  const r4=await cache('admin/overview',p1)
  assert.equal((await r4.json()).calls,1)
  await new Promise(r=>setTimeout(r,40))
  assert.equal(calls,2)
  const r5=await cache('admin/overview',p1)
  assert.equal((await r5.json()).calls,2)
})
test('admin aggregate rejects invalid dimensions and ranges before querying',async()=>{
  const {queryPerf}=await import('../server/telemetry.mjs')
  for(const query of ['group=unexpected','metric=unknown','to=invalid','from=2025-01-02&to=2025-01-01']){
    const response=await queryPerf(null,'admin/perf',new URLSearchParams(query))
    assert.equal(response.status,400)
  }
})
test('anonymous session context and event schemas',()=>{
  const context={vid:randomUUID(),firstDay:'2026-11-22',language:'zh',referrer:'search',maxTextureSize:8192,webgl2:1}
  const rows=[{kind:'vitals',cls:0},{kind:'session',total:42,walkMeters:10,walkSeconds:4},{kind:'error',count:1,errorKind:'error',signature:'deadbeef'},
    {kind:'retry',category:'landmark'},{kind:'failure',category:'chunk'},{kind:'funnel',step:'feedbackSuccess'}]
  assert.ok(validate({...batch(),context,rows}))
  for(const playMode of ['tour','solo']) assert.ok(validate({...batch(),context,rows:[{kind:'session',total:42,playMode}]}))
  for(const row of [{kind:'session',total:42,playMode:'other'},{kind:'error',count:1,signature:'main.js:42'},{kind:'funnel',step:'admin@example.test'}])
    assert.equal(validate({...batch(),context,rows:[row]}),false)
})
