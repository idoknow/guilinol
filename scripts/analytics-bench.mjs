import {serve} from '@hono/node-server'
import {createHash,randomBytes} from 'node:crypto'
import {onRequest} from '../functions/api/[[path]].ts'
import {database} from '../server/postgres.mjs'
import {summarizeDays} from '../server/day-summary.mjs'
// Runs exclusively in the isolated fixture schema or a disposable container.
import {fixture} from './selfhost-test.mjs'
import {analytics} from '../server/admin-analytics.mjs'
import pg from 'pg'
import {writeFile} from 'node:fs/promises'
const db=await fixture({postgresOnly:true}),pool=new pg.Pool({connectionString:db.env.DATABASE_URL})
pg.types.setTypeParser(20,Number)
let server
try {
  const end=new Date(),start=new Date(+end-90*86400000)
  const total=5000000
  for(let i=0;i<total;i+=100000){
    await pool.query(`INSERT INTO perf_event(received,batch,session,kind,mode,region,device,context,fields)
      SELECT $1::timestamptz+interval '90 days'*(i/5000000.0),sid,sid,kind,'walk','region'||(i/50%12),
        CASE WHEN i/50%2=0 THEN 'mobile' ELSE 'desktop' END,
        jsonb_build_object('vid',md5((i/70)::text),'firstDay','2026-01-01'),
        CASE kind WHEN 'window' THEN jsonb_build_object('fps',30+i%32) WHEN 'error' THEN '{"signature":"deadbeef","count":1,"errorKind":"error"}'::jsonb
        WHEN 'funnel' THEN '{"step":"loginOpen"}'::jsonb WHEN 'session' THEN '{"total":360}'::jsonb ELSE jsonb_build_object('ms',i%300) END
      FROM (SELECT i,md5((i/50)::text)::uuid sid,CASE i%50 WHEN 0 THEN 'playable' WHEN 1 THEN 'error' WHEN 2 THEN 'session' WHEN 3 THEN 'funnel'
        ELSE CASE WHEN i%3=0 THEN 'window' ELSE 'chunk' END END kind FROM generate_series($2::int,$3::int) i) s`,[start,i,i+99999])
  }
  await pool.query('ANALYZE perf_event')
  await summarizeDays(pool)
  await pool.query('ANALYZE perf_session_day; ANALYZE perf_value_day')
  const token=randomBytes(32).toString('hex'),digest=createHash('sha256').update(token).digest('hex')
  await pool.query("INSERT INTO users(id,email,nickname,salt,digest,verified,role) VALUES('bench','bench@example.test','admin','','',1,'admin'),('target','target@example.test','target','','',1,'user')")
  await pool.query("INSERT INTO sessions VALUES($1,'bench',unixepoch()+3600)",[digest])
  const env={DB:database(pool),perfQuery:(path,params)=>analytics(pool,path,params)}
  let origin
  await new Promise(resolve=>{
    server=serve({port:0,hostname:'127.0.0.1',fetch:request=>onRequest({env,request})},info=>{
      origin='http://127.0.0.1:'+info.port;resolve()
    })
  })
  const results=[],plans=[]
  for(const path of ['overview','timeseries?metric=fps.p50&bucket=1d&group=device','breakdown?dim=region&metric=chunk.p95','errors','funnel','live','audit','users/target/role']){
    const [endpoint,search]=path.split('?'),params=new URLSearchParams(search)
    params.set('from',start.toISOString());params.set('to',end.toISOString())
    const times=[]
    for(let run=0;run<5;run++){
      const statements=[],client={query(sql,args){statements.push({sql,args});return pool.query(sql,args)}}
      const before=performance.now()
      const options={headers:{Cookie:'glol_session='+token,Origin:origin,'Content-Type':'application/json'}}
      if(endpoint.endsWith('/role'))Object.assign(options,{method:'POST',body:JSON.stringify({role:run%2?'user':'admin'})})
      const response=await fetch(origin+'/api/admin/'+endpoint+'?'+params,options)
      if(!response.ok)throw Error(await response.text())
      const data=await response.json()
      times.push(performance.now()-before)
      if(run===0){
        if(endpoint==='audit')statements.push({sql:'SELECT * FROM admin_audit ORDER BY id DESC LIMIT 51',args:[]})
        else if(!endpoint.endsWith('/role'))await analytics(client,'admin/'+endpoint,params)
        console.log(endpoint,JSON.stringify(Array.isArray(data)?data.slice(0,1):data))
        for(const {sql,args} of statements)plans.push([path,(await pool.query('EXPLAIN '+sql,args)).rows.map(r=>r['QUERY PLAN']).join('\n')])
      }
    }
    const p95=Math.ceil(Math.max(...times))
    console.log(path,p95,times);results.push({path,p95})
  }
  if(process.argv[2])await writeFile(process.argv[2],JSON.stringify({results,plans},null,2))
}finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();await db.close()}
