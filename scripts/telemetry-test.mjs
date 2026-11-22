import assert from 'node:assert/strict'
import test from 'node:test'
import {randomUUID} from 'node:crypto'
import {validate,receive} from '../server/telemetry.mjs'
import {Histogram,route} from '../server/perf-monitor.mjs'
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
test('receiver inserts one batch and keeps raw IP outside the event payload',async()=>{
  const message=batch(),calls=[]
  const db={async query(sql,args){calls.push({sql,args})}}
  const request=new Request('http://localhost/api/t',{method:'POST',headers:{Origin:'http://localhost','CF-Connecting-IP':'192.0.2.10','CF-IPCountry':'CN'},body:JSON.stringify(message)})
  assert.equal((await receive(request,db,'http://localhost')).status,204)
  assert.equal(calls.length,1)
  const [{args}]=calls
  assert.equal(args[0],'192.0.2.10')
  assert.equal(args[2],message.sid)
  assert.equal(args[7],'CN')
  assert.deepEqual(args[8],message.context)
  assert.deepEqual(JSON.parse(args[9]),message.rows)
})
test('admin aggregate rejects invalid dimensions and ranges before querying',async()=>{
  const {queryPerf}=await import('../server/telemetry.mjs')
  for(const query of ['group=unexpected','metric=unknown','to=invalid','from=2025-01-02&to=2025-01-01']){
    const response=await queryPerf(null,'admin/perf',new URLSearchParams(query))
    assert.equal(response.status,400)
  }
})
test('curl probe posts timings for eight fixed paths, including a failed target',async()=>{
  const {createServer}=await import('node:http')
  const {execFile}=await import('node:child_process')
  const {promisify}=await import('node:util')
  const seen=[]
  let payload
  const server=createServer(async(req,res)=>{
    if(req.url==='/api/t'){
      const parts=[]
      for await(const chunk of req)parts.push(chunk)
      payload=JSON.parse(Buffer.concat(parts))
      res.writeHead(204).end()
    }else{
      seen.push(req.url)
      res.writeHead(req.url==='/world/0_3.glc'?503:200).end('ok')
    }
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  try{
    await promisify(execFile)('sh',['deploy/k8s/probe/run.sh'],{env:{...process.env,PROBE_NODE:'cn-sh-tencent-01',PROBE_SESSION:randomUUID(),PROBE_ORIGIN:'http://127.0.0.1:'+server.address().port}})
    assert.deepEqual(seen,['/','/world/manifest.json',...[1,2,3,4,5].map(n=>'/world/0_'+n+'.glc'),'/api/health'])
    assert.ok(validate(payload))
    assert.equal(payload.rows.length,8)
    assert.equal(payload.rows.find(row=>row.target==='chunk3').status,503)
  }finally{await new Promise(resolve=>server.close(resolve))}
})

test('anonymous session context and event schemas',()=>{
  const context={vid:randomUUID(),firstDay:'2026-11-22',language:'zh',referrer:'search',maxTextureSize:8192,webgl2:1}
  const rows=[{kind:'vitals',cls:0},{kind:'session',total:42,walkMeters:10,walkSeconds:4},{kind:'error',count:1,errorKind:'error',signature:'deadbeef'},
    {kind:'retry',category:'landmark'},{kind:'failure',category:'chunk'},{kind:'funnel',step:'feedbackSuccess'}]
  assert.ok(validate({...batch(),context,rows}))
  for(const playMode of ['tour','story']) assert.ok(validate({...batch(),context,rows:[{kind:'session',total:42,playMode}]}))
  for(const row of [{kind:'session',total:42,playMode:'other'},{kind:'error',count:1,signature:'main.js:42'},{kind:'funnel',step:'admin@example.test'}])
    assert.equal(validate({...batch(),context,rows:[row]}),false)
})
