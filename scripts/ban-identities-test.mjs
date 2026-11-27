import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes,createHash} from 'node:crypto'
import pg from 'pg'
import {fixture} from './selfhost-test.mjs'
import {database} from '../server/postgres.mjs'
import {multiplayer} from '../server/mp-admin.mjs'
import {feedback} from '../lib/feedback.ts'

test('admin search and active bans resolve shared devices in both directions',async context=>{
  const storage=await fixture({postgresOnly:true}),pool=new pg.Pool({connectionString:storage.env.DATABASE_URL})
  context.after(async()=>{await pool.end();await storage.close()})
  const fp='f123456789abcdef',tokens=[],uids=[]
  for(const [index,name] of ['Alice','Bob'].entries()){
    const {rows:[{uid}]}=await pool.query(`insert into users(id,email,nickname,salt,digest,verified,role) values($1,$2,$1,'','',1,$3) returning uid`,[name,name+'@example.test',index?'user':'admin'])
    uids.push(uid)
    const token=randomBytes(32).toString('hex');tokens.push(token)
    await pool.query('insert into sessions values($1,$2,unixepoch()+600)',[createHash('sha256').update(token).digest('hex'),name])
    await pool.query(`insert into mp_devices(uid,fp,model,first,last) values($1,$2,'Test Phone',1000,2000)`,[uid,fp])
  }
  context.mock.method(globalThis,'fetch',async()=>Response.json({bans:[{kind:'fp',value:fp},{kind:'uid',value:String(uids[0])}],reviews:[]}))
  const env={DB:database(pool),mpAdmin:multiplayer(pool,{RT_ADMIN_TOKEN:'test'}).route}
  const get=(path,index=0)=>feedback(new Request('http://local/api/admin/'+path,{headers:{cookie:'glol_session='+tokens[index]}}),env,'admin/'+path.split('?')[0])
  for(const path of ['user-search?q=lic','bans'])await assert.rejects(get(path,1),{status:403})
  assert.deepEqual(await (await get('user-search?q=%25')).json(),[])
  const matches=await (await get('user-search?q=LIC')).json()
  assert.deepEqual(matches.map(row=>row.nickname),['Alice']);assert.equal(matches[0].devices[0].model,'Test Phone')
  const {bans:[deviceBan,accountBan]}=await (await get('bans')).json()
  assert.deepEqual(deviceBan.accounts.map(account=>account.nickname).sort(),['Alice','Bob'])
  assert.equal(accountBan.nickname,'Alice');assert.deepEqual(accountBan.devices[0].accounts,deviceBan.accounts)
  await pool.query(`with added as (insert into users(id,email,nickname,salt,digest)
    select 'extra'||n,'extra'||n||'@example.test','Extra '||n,'','' from generate_series(1,21) n returning uid)
    insert into mp_devices(uid,fp) select uid,$1 from added`,[fp])
  assert.equal((await (await get('user-search?q=Extra')).json()).length,10)
  assert.equal((await (await get('bans')).json()).bans[0].accounts.length,23)
})
