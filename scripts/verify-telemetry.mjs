import assert from 'node:assert/strict'
import {createServer} from 'node:net'
import {spawn,execFileSync} from 'node:child_process'
import {once} from 'node:events'
import {readFile} from 'node:fs/promises'
import {randomBytes,createHash} from 'node:crypto'
import {gzipSync} from 'node:zlib'
import {setTimeout as delay} from 'node:timers/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {fixture} from './selfhost-test.mjs'
import {browserOptions} from './qa-browser.mjs'
import {validate} from '../server/telemetry.mjs'

const browserOnly=process.argv.includes('--browser-only')
let storage,api,site,browser
try {
  const probe=createServer().listen(0,'127.0.0.1')
  await once(probe,'listening')
  const port=probe.address().port
  await new Promise(resolve=>probe.close(resolve))
  if(!browserOnly)storage=await fixture({postgresOnly:true})
  site=await preview({configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:0,
    proxy:browserOnly?{}:{'/api':'http://127.0.0.1:'+port}}})
  const origin='http://127.0.0.1:'+site.httpServer.address().port
  if(storage){
    await storage.sql(await readFile('deploy/postgres/003-admin.sql','utf8'))
    await (await import('./summary-test.mjs')).verifySummaries(storage.env.DATABASE_URL)
    api=spawn(process.execPath,['--import','tsx','server/index.mjs'],{env:{...process.env,...storage.env,PORT:String(port),PUBLIC_ORIGIN:origin},stdio:'inherit'})
    for(let i=0;;i++){
      if(await fetch(origin+'/api/me').then(r=>r.status===401).catch(()=>false))break
      if(i===100||api.exitCode!==null)throw Error('Local API unavailable')
      await delay(100)
    }
    assert.equal((await fetch(origin+'/api/health')).status,200)
    assert.equal((await fetch(origin+'/api/admin/perf')).status,401)
    const ranges=JSON.parse(execFileSync('python3',['scripts/test-perf-region.py'],{encoding:'utf8'}))
    for(const {ip,prefix,country,region,city,isp} of ranges){
      await storage.sql('INSERT INTO perf_network VALUES ($1,$2,$3,$4,$5)',[prefix,country,region,city,isp])
      const sid=crypto.randomUUID()
      assert.equal((await fetch(origin+'/api/t',{method:'POST',headers:{'CF-Connecting-IP':ip},body:JSON.stringify({sid,context:{},rows:[{kind:'error',count:1}]})})).status,204)
      const [result]=await storage.sql("SELECT region,isp FROM perf_event WHERE session='"+sid+"'")
      assert.deepEqual(result.results,[{region,isp}])
    }
  }
  browser=await chromium.launch(browserOptions())
  const page=await browser.newPage({viewport:{width:800,height:450}})
  const batches=[],foreign=[]
  page.on('request',r=>{if(/^https?:/.test(r.url())&&![origin,'https://stats.rcpd.cc'].includes(new URL(r.url()).origin))foreign.push(r.url())})
  await page.route('https://stats.rcpd.cc/**',route=>route.fulfill({status:204}))
  await page.route('**/api/t',async route=>{
    const bytes=route.request().postDataBuffer(), body=JSON.parse(bytes)
    batches.push({body,bytes:bytes.length,gzip:gzipSync(bytes).length})
    if(browserOnly)await route.fulfill({status:204})
    else await route.continue()
  })
  await page.goto(origin+'/?verify&mode=walk')
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:120000})
  await page.keyboard.down('KeyW');await delay(30000);await page.keyboard.up('KeyW')
  await page.keyboard.press('KeyV')
  await page.waitForFunction(()=>!window.viewer.walk.active)
  await page.keyboard.down('KeyW');await delay(30000);await page.keyboard.up('KeyW')
  await page.waitForFunction(()=>!!window.viewer.tour?.map)
  await page.keyboard.press('KeyM')
  await page.waitForFunction(()=>window.viewer.tour.map.active)
  await page.keyboard.press('Escape')
  await page.evaluate(async()=>{
    const {walk,walkTo}=window.viewer
    const {x,z}=walk.position
    await walkTo(x,z,0,'verify')
    window.dispatchEvent(new ErrorEvent('error'))
    document.querySelector('canvas').dispatchEvent(new Event('webglcontextlost'))
  })
  // Exercise lifecycle delivery between normal 30-second batches.
  for(let i=0;i<6;i++){
    const delivered=page.waitForResponse(r=>r.url()===origin+'/api/t',{timeout:10000})
    await page.evaluate(async()=>{
      const response=await fetch('/api/me')
      await response.arrayBuffer()
      window.dispatchEvent(new ErrorEvent('error'))
      window.dispatchEvent(new PageTransitionEvent('pagehide'))
    })
    assert.equal((await delivered).status(),204)
  }
  assert.deepEqual(foreign,[])
  assert.ok(batches.length>=6)
  for(const {body,bytes,gzip} of batches){assert.ok(bytes<=3900);assert.ok(validate(body),JSON.stringify(body.context));assert.ok(gzip<=4096)}
  const rows=batches.flatMap(b=>b.body.rows),kinds=new Set(rows.map(r=>r.kind))
  for(const kind of ['navigation','resource','firstFrame','playable','window','chunk','switch','api','mapOpen','teleport','error','contextLost','session','vitals'])assert.ok(kinds.has(kind),kind)
  for(const mode of ['walk','fly'])assert.ok(rows.some(r=>r.kind==='window'&&r.mode===mode),mode)
  const fields={navigation:['dns','tcp','tls','ttfb','dcl','load'],window:['fps','frameP95','longFrames','calls','triangles','geometries','textures','chunks','grid','mode'],
    resource:['category','count','bytes','p50','p95','cache'],chunk:['ms','grid']}
  for(const [kind,keys] of Object.entries(fields)){
    const row=rows.find(r=>r.kind===kind)
    for(const key of keys)assert.ok(key in row,kind+'.'+key)
  }
  const ctx=batches.at(-1).body.context
  for(const key of ['device','os','browser','width','height','dpr','cores','build','world','quality','vid','firstDay','returnVisit','language','referrer','maxTextureSize','webgl2'])assert.ok(key in ctx,key)
  console.log('Browser batches',batches.length,'max raw bytes',Math.max(...batches.map(b=>b.bytes)),'max gzip bytes',Math.max(...batches.map(b=>b.gzip)))
  if(storage){
    const token=randomBytes(32).toString('hex'),digest=createHash('sha256').update(token).digest('hex')
    await storage.sql("INSERT INTO users(id,email,nickname,salt,digest,verified,role) VALUES('perf','perf@example.test','test','','',1,'admin'); INSERT INTO sessions VALUES('"+digest+"','perf',unixepoch()+300)")
    const [saved]=await storage.sql("SELECT count(distinct batch) n FROM perf_event WHERE session='"+batches[0].body.sid+"'")
    assert.ok(saved.results[0].n>=6)
    console.log('PostgreSQL batches',saved.results[0].n)
    for(const endpoint of ['overview','timeseries','breakdown','funnel','errors','live','audit']){
      const response=await fetch(origin+'/api/admin/'+endpoint,{headers:{Cookie:'glol_session='+token}})
      assert.equal(response.status,200)
      const result=await response.json()
      if(endpoint==='overview'){assert.ok(result.visitors.current>=1);assert.ok(result.durationAvg.current>0)}
      if(endpoint==='funnel')assert.ok(result.find(r=>r.step==='playable').sessions>=1)
      if(endpoint==='errors')assert.ok(result.some(r=>r.kind==='webgl'&&r.signature))
    }
    for(const path of ['?group=device','/grid','/server']){
      const response=await fetch(origin+'/api/admin/perf'+path,{headers:{Cookie:'glol_session='+token}})
      assert.equal(response.status,200);const {items}=await response.json();assert.ok(items.length,path)
      if(path!=='/server')console.log(path,JSON.stringify({items}))
    }
  }
}finally{
  await browser?.close()
  if(api&&api.exitCode===null){const closed=once(api,'exit');api.kill();await closed}
  await site?.close()
  await storage?.close()
}
