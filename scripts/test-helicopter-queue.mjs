import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import pg from 'pg'
import {helicopterStore} from '../server/helicopter.mjs'

export async function withQueueDatabase(run){
  const password=randomBytes(18).toString('hex'),container=execFileSync('docker',['run','--rm','-d','--label','project=idoknow/guilinol','-p','127.0.0.1::5432','-e',`POSTGRES_PASSWORD=${password}`,'postgres:16'],{encoding:'utf8'}).trim()
  let pool
  try{
    const addr=execFileSync('docker',['port',container,'5432/tcp'],{encoding:'utf8'}).trim()
    pool=new pg.Pool({connectionString:`postgres://postgres:${password}@${addr}/postgres`})
    for(let attempt=0;;attempt++){try{await pool.query('SELECT 1');break}catch(error){if(attempt>300){execFileSync('docker',['logs','--tail','10',container],{stdio:'inherit'});throw error}await new Promise(resolve=>setTimeout(resolve,200))}}
    await pool.query('CREATE TABLE users(id text PRIMARY KEY,uid integer);INSERT INTO users VALUES (\'A\',100001),(\'B\',100002),(\'C\',100003)')
    for(const migration of ['003-player-saves','022-helicopter'])await pool.query(await readFile(`deploy/postgres/${migration}.sql`,'utf8'))
    for(const user of ['A','B','C'])await pool.query('INSERT INTO player_saves(user_id,payload_json,client_updated_at,updated_at) VALUES($1,$2,0,0)',[user,JSON.stringify({schemaVersion:2,money:user==='C'?2:100,updatedAt:1,economy:{helicopterTours:user==='C'?1:0}})])
    return await run(pool)
  }finally{await pool?.end();execFileSync('docker',['stop','-t','1',container])}
}

if(import.meta.url===new URL(process.argv[1],'file:').href)await withQueueDatabase(async pool=>{
  let now=Date.now(),command=helicopterStore(pool,()=>now)
  const join=user=>command(user,'join',{mode:'low'}),ping=user=>command(user,'ping'),confirm=(user,ticket)=>command(user,'confirm',{ticket})
  const [alice,bob]=await Promise.all([join('A'),join('B')]);assert.notEqual(alice.mine.offered,bob.mine.offered)
  const first=alice.mine.offered?'A':'B',second=first==='A'?'B':'A'
  assert.equal((await join(first)).code,'ALREADY_QUEUED');assert.equal((await ping(second)).ahead,0)
  for(let heartbeat=0;heartbeat<6;heartbeat++){now+=10000;await ping(second);if(heartbeat<5)await ping(first)}
  const offered=await ping(second);assert.ok(offered.mine.offered);assert.equal((await ping(first)).mine,null)
  const confirmed=await confirm(second,offered.mine.ticket);assert.ok(confirmed.flight);assert.equal((await confirm(second,offered.mine.ticket)).flight.t0,confirmed.flight.t0)
  now+=60000;command=helicopterStore(pool,()=>now);assert.deepEqual((await ping(first)).flight,confirmed.flight)
  assert.equal((await ping(first)).state,'flying');await join('C');let skipped=false;for(let heartbeat=0;heartbeat<45;heartbeat++){now+=10000;if((await ping('C')).code==='INSUFFICIENT_FUNDS')skipped=true}
  assert.ok(skipped);assert.equal((await ping('C')).mine,null)
  const again=await join(second);await confirm(second,again.mine.ticket)
  const ledger=await pool.query('SELECT delta FROM player_ledger_txns ORDER BY created_at');assert.deepEqual(ledger.rows.map(row=>row.delta),[0,0,-88])
  console.log('Concurrent FIFO, duplicate protection, 60s timeout, restart, disconnected passenger, insufficient funds, idempotent fares passed')
})
