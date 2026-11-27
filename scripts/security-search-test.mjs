import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash,randomBytes} from 'node:crypto'
import pg from 'pg'
import {fixture} from './selfhost-test.mjs'
import {database} from '../server/postgres.mjs'
import {multiplayer} from '../server/mp-admin.mjs'
import {record} from '../server/mp-store.mjs'
import {detectKind} from '../server/security-search.mjs'
import {feedback} from '../lib/feedback.ts'

test('auto kind precedence',()=>{
  for(const [value,kind] of [['0000000000000001','uid'],['2001:db8::1','ip'],['192.0.2.1','ip'],['FE'.repeat(10),'fp'],['阿桂','nick'],['9'.repeat(65),'nick']])assert.equal(detectKind(value),kind)
})

test('authenticated profiles and network evidence on PostgreSQL',async context=>{
  const storage=await fixture({postgresOnly:true}),pool=new pg.Pool({connectionString:storage.env.DATABASE_URL})
  context.after(async()=>{await pool.end();await storage.close()})
  const migrate=await readFile('deploy/postgres/027-security-search.sql','utf8');await pool.query(migrate);await pool.query(migrate)
  const {rows:users}=await pool.query(`insert into users(id,email,nickname,salt,digest,verified,role)
    select 'acct'||n,n||'@example.test','Test'||n,'','',1,case when n=1 then 'admin' else 'user' end from generate_series(1,60) n returning uid,id,email`)
  const tokens=[]
  for(const owner of users.slice(0,2)){
    const token=randomBytes(32).toString('hex');tokens.push(token)
    await pool.query('insert into sessions values($1,$2,unixepoch()+600)',[createHash('sha256').update(token).digest('hex'),owner.id])
  }
  const env={DB:database(pool),mpAdmin:multiplayer(pool,{}).route}
  const get=(query,kind='auto',token=tokens[0])=>feedback(new Request('http://local/api/admin/security-search?'+new URLSearchParams({q:query,kind}),{headers:{cookie:'glol_session='+token}}),env,'admin/security-search')
  await assert.rejects(get('anything','auto',''),{status:401});await assert.rejects(get('anything','auto',tokens[1]),{status:403})
  for(const [query,kind] of [['1','wrong'],['x'.repeat(129),'auto'],['abc','ip']])assert.equal((await get(query,kind)).status,400)
  const fp='abcd'.repeat(4),uid=users[0].uid
  const player={id:'joined',uid:Number(uid),name:'fixture',ip:'198.51.100.5',joinedAt:Date.now()}
  const state={players:[player],server:{startedAt:Date.now(),online:1,connections:1,traffic:{out:{}}},events:[{type:'session-device',id:player.id,uid:player.uid,ip:player.ip,fp}]}
  await record(pool,state);state.events=[];await record(pool,state)
  assert.equal((await pool.query('select fp from mp_sessions where id=$1',[player.id])).rows[0].fp,fp)
  player.ip='198.51.100.6';await record(pool,state)
  assert.equal((await pool.query('select fp from mp_sessions where id=$1',[player.id])).rows[0].fp,null)
  await pool.query(`insert into mp_devices(uid,fp,first,last,ua,ip24) select uid,$1,1,extract(epoch from now())*1000,repeat('u',150),'192.0.2.0/24' from users`,[fp])
  await pool.query(`insert into mp_sessions(instance,id,uid,name,client_ip,fp,joined_at,last_seen)
    select 1,id,uid,nickname,'192.0.2.4',case when uid=$1 then $2 else null end,now(),now() from users`,[uid,fp])
  await pool.query(`insert into mp_sessions(instance,id,uid,name,client_ip,fp,joined_at,last_seen)
    select 2,n::text,$1,'v6',case when n=1 then '2001:db8::1' else '2001:db8::2' end,case when n=1 then $2 end,now(),now() from generate_series(1,25)n`,[uid,fp])
  const json=async(query,kind)=>{const response=await get(query,kind);assert.equal(response.status,200);return response.json()}
  assert.equal((await json('Test')).candidates.length,10);assert.equal((await json('Test1')).candidates[0].nickname,'Test1');assert.deepEqual((await json('%')).candidates,[])
  const profile=await json(uid);assert.equal(profile.account.email,users[0].email);assert.equal(profile.sessions.length,20);assert.equal(profile.devices[0].ua.length,120)
  const device=(await json(fp.toUpperCase())).device;assert.equal(device.accounts.length,50);assert.equal(Number(device.account_count),60)
  const ipv4=await json('192.0.2.4');assert.equal(ipv4.accounts.length,50);assert.equal(ipv4.subnet.length,30);assert.equal(ipv4.devices.length,1);assert.equal(ipv4.devices[0].uid,uid);assert.ok(ipv4.accounts.some(row=>row.historical))
  const ipv6=await json('2001:db8:0:0::1');assert.equal(ipv6.devices[0].fp,fp);assert.equal(ipv6.subnet.length,1);assert.equal(ipv6.subnet[0].fp,null)
  const lock=await pool.connect()
  try{await lock.query('begin');await lock.query('lock mp_sessions in access exclusive mode');const response=await get(uid);assert.equal(response.status,504);assert.equal((await response.json()).error.message,'查询超时，请缩小范围')}
  finally{await lock.query('rollback');lock.release()}
  assert.equal((await get(uid)).status,200)
})
