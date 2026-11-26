import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {test} from 'node:test'
import {checkLoginIp,failedLoginIp,trustedLoginIp} from '../lib/auth.ts'

test('login only consumes explicitly verified identities',()=>{
  const headers=new Headers({'CF-Connecting-IP':'192.0.2.1'})
  const read=()=>trustedLoginIp(new Request('https://example.test',{headers}))
  assert.equal(read(),null)
  headers.set('X-Glol-Ip-Trusted','0');assert.equal(read(),null)
  headers.set('X-Glol-Ip-Trusted','1');assert.equal(read(),'192.0.2.1')
})

test('fifth failure locks for fifteen minutes from that failure',async context=>{
  const data=new DatabaseSync(':memory:')
  context.after(()=>data.close())
  data.exec('CREATE TABLE rate_limits(key TEXT PRIMARY KEY,until INTEGER NOT NULL,hits INTEGER NOT NULL)')
  const db={prepare:sql=>({bind:(...args)=>({first:()=>data.prepare(sql).get(...args)})})}
  const ip='192.0.2.1'
  let clock=1000000
  context.mock.method(Date,'now',()=>clock)
  for(let n=0;n<4;n++)await failedLoginIp(db,ip)
  await checkLoginIp(db,ip)
  clock+=1000
  await assert.rejects(failedLoginIp(db,ip),{status:429})
  clock+=899000
  await assert.rejects(checkLoginIp(db,ip),{status:429})
  await checkLoginIp(db,'192.0.2.2')
  clock+=1000
  await checkLoginIp(db,ip)
  await failedLoginIp(db,ip)
})
