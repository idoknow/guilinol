import assert from 'node:assert/strict'
import {randomUUID,randomBytes} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {register} from 'tsx/esm/api'
import pg from 'pg'
register()
const {fishingStore}=await import('../server/fishing.mjs')
const {onRequest}=await import('../functions/api/[[path]].ts')
const {database}=await import('../server/postgres.mjs')
const {hash}=await import('../lib/auth.ts')
const connectionString=process.env.FISHING_TEST_DATABASE_URL
assert(connectionString&&['127.0.0.1','localhost','[::1]'].includes(new URL(connectionString).hostname),'set FISHING_TEST_DATABASE_URL to a local test database')
const schema='fishing_'+randomBytes(8).toString('hex'),admin=new pg.Pool({connectionString})
const pool=new pg.Pool({connectionString,options:`-c search_path=${schema}`})
try{
  await admin.query(`CREATE SCHEMA ${schema}`)
  await pool.query(`CREATE TABLE users(id text PRIMARY KEY,nickname text, uid bigint DEFAULT 100000,email text,verified int DEFAULT 1,role text,notify_email int,email_placeholder int,banned_at int DEFAULT 0,ban_reason text);
    CREATE TABLE sessions(digest text,user_id text,expires bigint);
    INSERT INTO users(id,nickname) VALUES ('a','甲'),('b','乙'),('browser','浏览器钓手')`)
  await pool.query(await readFile('deploy/postgres/021-fishing-catches.sql','utf8'))
  await pool.query(await readFile('deploy/postgres/004-social.sql','utf8'))
  const store=fishingStore(pool),sample={clientCatchId:randomUUID(),zoneId:'lijiang_xiangbi',speciesId:'001',grade:'low',weight:1,method:'路亚'}
  const results=await Promise.all(Array.from({length:8},()=>store.record('a',{...sample,clientCatchId:randomUUID()})))
  assert.equal(results.filter(row=>row.status==='recorded').length,1)
  const old=(await pool.query("UPDATE fishing_catches SET caught_at=now()-interval '10 seconds' RETURNING client_catch_id")).rows[0]
  for(const change of [{clientCatchId:old.client_catch_id},{zoneId:'ronghu',speciesId:'010'},{grade:'legendary'},{method:'bad'},{weight:999}]){
    assert.deepEqual(await store.record('a',{...sample,...change}),{status:'ignored'})
  }
  assert.deepEqual(await store.record('b',sample),{status:'recorded'})
  assert.deepEqual((await store.boards(sample.zoneId)).zone.topCount,[{nickname:'甲',count:1},{nickname:'乙',count:1}])
  await pool.query(`INSERT INTO fishing_catches(user_id,client_catch_id,zone_id,species_id,grade,weight,method,caught_at)
    SELECT 'a',gen_random_uuid(),'ronghu','027','legendary',2,'路亚',now()-interval '10 seconds' FROM generate_series(1,300)`)
  assert.equal((await store.record('a',sample)).status,'ignored');const other=await store.boards('ronghu')
  assert.deepEqual(other.global.topLegendary,[{nickname:'甲',count:300}]);assert.equal(other.global.topCount[0].count,301)
  assert.deepEqual((await store.boards(sample.zoneId)).global.topLegendary,[])
  console.log('PG: concurrent limit, duplicate, invalid catches, daily quota, ties, zone/global and cache OK')
  if(!process.argv.includes('--pg-only')){
    const env={DB:database(pool),fishing:fishingStore(pool)},token=randomBytes(32).toString('hex')
    await pool.query("INSERT INTO sessions VALUES($1,'browser',2147483647)",[await hash(token)])
    const {verifyFishing}=await import('./verify-fishing.mjs')
    await verifyFishing(async(page,origin)=>{
      await page.context().addCookies([{name:'glol_session',value:token,url:origin}])
      let landed=false
      await page.route(/\/api\/(me$|fishing\/)/,async route=>{
        const req=route.request(),url=req.url()
        const response=await onRequest({request:new Request(url,{headers:await req.allHeaders(),method:req.method(),body:req.postData()}),env})
        if(url.endsWith('/catch'))landed=(await response.clone().json()).status==='recorded'
        await route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'})
      })
      return async()=>{await page.waitForFunction(()=>!Object.keys(localStorage).some(key=>key.startsWith('glol.fishing.pending.')));assert(landed)
        await page.waitForFunction(async()=>{const board=await(await fetch('/api/fishing/boards?zone=lijiang_xiangbi')).json();return board.zone.topCount.some(row=>row.nickname==='浏览器钓手'&&row.count===1)},null,{polling:3000,timeout:75000});console.log('Browser catch appears on real zone board')}
    })
  }
}finally{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end()}
