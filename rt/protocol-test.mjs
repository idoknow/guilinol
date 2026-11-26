import assert from 'node:assert/strict'
import {createBanStore,checkMove} from './anti-cheat.mjs'
import {ipGate,tooFast} from './protocol-guard.mjs'
import {grantTravel,leaveHistory} from './travel.mjs'

for(const kind of ['foreign_position','oversize','invalid_packet','packet_rate','mount_player']){
  const store=createBanStore({}),uid=900101, starts=Date.now()
  await store.violation({uid,kind:'speed'})
  for(let strike=0;strike<(kind==='mount_player'?1:3);strike++)await store.violation({uid,kind})
  const hit=store.check(uid); assert.equal(hit.actor,'protocol');assert.ok(hit.until>=starts+600000 && hit.until<=Date.now()+600000)
  assert.equal((await store.reviews()).length,1);assert.equal(store.check(900102),null)
}
for(const [kind,limit] of [['connection',240],['ticket',16]]){
  let now=0;const accept=ipGate(()=>now)
  for(let count=0;count<limit;count++)assert.ok(accept('192.0.2.1',kind))
  assert.equal(accept('192.0.2.1',kind),false);assert.equal(accept('192.0.2.1','connection'),false)
  assert.ok(accept('192.0.2.2','connection'));now+=120001;assert.ok(accept('192.0.2.1','connection'))
}
const socket={};for(let count=0;count<100;count++)assert.equal(tooFast(socket,0),false)
assert.ok(tooFast(socket,0));assert.equal(tooFast(socket,1000),false)
const player={x:1000,y:4,z:1000,posAt:10000};const now=12000
assert.equal(grantTravel(player,'map',{x:1500,z:1500},now),'site')
assert.ok(checkMove(player,1500,4,1500,now).reject)
assert.equal(grantTravel(player,'map','spot:bridge',now),'ok');player.lastCombat=now
assert.ok(checkMove(player,-185,4,35,now).reject);assert.equal(grantTravel(player,'map','spot:bridge',now),'combat')
const history=leaveHistory(),first={uid:1,x:0,y:4,z:0,lastCombat:now},next={uid:1,x:1000,y:8,z:0}
history.save(first,now+100)
assert.deepEqual(history.restore(next,now+101),{x:0,y:4,z:0,code:'combat'})
history.save(next,now+102);next.x=1000
assert.equal(history.restore(next,now+5001),undefined);assert.equal(next.tpAt,now+5001)
history.save(next,now+5002);next.x=2000
assert.deepEqual(history.restore(next,now+5003),{x:1000,y:4,z:0,code:'cooldown'})
const cache=createBanStore({DATABASE_URL:'postgres://unused.invalid/test'})
cache.pool.query=async()=>{throw Error('offline')};await assert.rejects(cache.hydrate(),/offline/)
cache.pool.query=async()=>({rows:[{kind:'uid',value:'900101',record_id:'saved'}]});await cache.hydrate()
cache.pool.query=async()=>{throw Error('offline')};await cache.hydrate();assert.equal(cache.check(900101).recordId,'saved');await cache.pool.end()
console.log('PASS protocol strikes, mixed review, isolated IP holds, packet rate, travel, combat and cache fallback')
