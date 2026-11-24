import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {setup,until} from './chat-fixture.mjs'
import {moderate,wechat} from '../rt/chat-provider.mjs'

test('provider decisions fail closed regardless of local-only policy',async()=>{
  for(const policy of ['pending','local_only'])for(const [suggest,status] of [['pass','normal'],['risky','blocked'],['review','pending'],['timeout','pending'],['unknown','pending']]){
    const provider={name:'mock',available:()=>true,check:async()=>{if(suggest==='timeout')throw Error('timeout');return {suggest}}}
    assert.equal((await moderate({text:'hello'},[],policy,provider)).status,status)
  }
  const provider=wechat({WX_APPID:'mock',WX_SECRET:'mock'},()=>assert.fail('missing openid must not call WeChat'))
  for(const policy of ['pending','local_only'])assert.equal((await moderate({text:'hello'},[],policy,provider)).status,policy==='pending'?'pending':'normal')
})
test('chat over signed sockets and PostgreSQL',async context=>{
  const fixture=await setup();context.after(()=>fixture.close());const {admin,join}=fixture
  let sender=await join(300001,0),near=await join(300002,59),far=await join(300003,61)
  const send=async(ch,text,extra={})=>{const cid=extra.cid??randomUUID();sender.send({t:'chat',ch,text,cid,...extra});return until(()=>sender.events.find(e=>e.t==='chat_ack'&&e.cid===cid))}
  const seen=(player,mid)=>player.events.some(e=>e.t==='chat'&&e.mid===mid)
  const history=async(player,ch)=>{const index=player.events.length;player.send({t:'chat_hist',ch});return (await until(()=>player.events.slice(index).find(e=>e.t==='chat_hist'))).msgs}
  assert.equal((await admin('settings')).unmoderated_policy,'pending')
  await admin('settings',{patch:{near_ms:0,world_ms:0,threshold:100}})
  await admin('words',{word:'Bad',category:'test',enabled:true,action:'block'})
  await admin('words',{word:'maybe',category:'test',enabled:true,action:'review'})
  for(const policy of ['pending','local_only']){
    await admin('settings',{patch:{unmoderated_policy:policy}})
    for(const ch of ['near','world']){
      const ack=await send(ch,'clean');if(policy==='pending'){assert.equal(ack.code,'pending');assert.ok(!seen(sender,ack.mid)&&!seen(near,ack.mid)&&!seen(far,ack.mid));await admin('approve',{mid:ack.mid})}else assert.ok(ack.ok)
      await until(()=>seen(sender,ack.mid)&&seen(near,ack.mid));if(ch==='world')await until(()=>seen(far,ack.mid));else{assert.ok(!seen(far,ack.mid));assert.ok(!(await history(far,ch)).some(e=>e.mid===ack.mid))}
      for(const text of ['BAD','b A d','ＢＡＤ'])assert.equal((await send(ch,text,{sys:'notice',openid:'forged',status:'normal'})).code,'blocked')
      assert.equal((await send(ch,'maybe')).code,'pending')
    }
  }
  assert.equal((await send('WORLD','hello')).code,'error');assert.equal((await send(undefined,'BAD')).code,'blocked')
  await fixture.storage.sql(`create function chat_fixture_failure() returns trigger language plpgsql as $$ begin raise exception 'fixture'; end $$; create trigger chat_fixture_failure before insert on chat_messages for each row execute function chat_fixture_failure()`)
  const retryCid=randomUUID(),queued=send('world','retry after recovery',{cid:retryCid});await delay(200)
  assert.equal((await fixture.health()).chatBacklog,1);assert.ok(!near.events.some(event=>event.text==='retry after recovery'))
  await fixture.storage.sql('drop trigger chat_fixture_failure on chat_messages');const stored=await queued;assert.ok(stored.ok);await until(()=>seen(near,stored.mid))
  sender.send({t:'chat',cid:retryCid,ch:'world',text:'retry after recovery'});await until(()=>sender.events.filter(event=>event.t==='chat_ack'&&event.cid===retryCid).length===2);assert.equal(near.events.filter(event=>event.t==='chat'&&event.mid===stored.mid).length,1)
  far.send({t:'pos',x:60,z:0});await delay(100);const moved=await send('near','moved');await until(()=>seen(far,moved.mid))
  await admin('delete',{mid:moved.mid});await until(()=>near.events.some(e=>e.t==='chat_del'&&e.mid===moved.mid));assert.ok(!(await history(far,'near')).some(e=>e.mid===moved.mid))
  assert.equal((await send('near','😀'.repeat(101))).code,'too_long');assert.ok((await send('near','😀'.repeat(100))).ok)
  await admin('settings',{patch:{near_ms:1500}});assert.equal((await send('near','again')).code,'rate')
  await admin('mute',{uid:sender.uid,minutes:-1});for(const ch of ['world','near'])assert.equal((await send(ch,'quiet')).code,'muted')
  await fixture.restart();sender=await join(300001,0);await until(()=>sender.events.find(e=>e.t==='chat_mute'&&e.until===-1));await admin('unmute',{uid:sender.uid});await until(()=>sender.events.find(e=>e.t==='chat_mute'&&e.until===0))
  await admin('settings',{patch:{threshold:1,steps_minutes:[60,1440]}})
  for(const minutes of [60,1440]){assert.equal((await send('world','bad')).code,'blocked');const [last]=await admin('mutes',null,{uid:sender.uid});assert.equal(last.source,'auto');assert.ok(Math.abs(Number(last.until_ms)-Date.now()-minutes*60000)<5000);await admin('unmute',{uid:sender.uid})}
  for(let index=0;index<32;index++)assert.ok((await send('world','row'+index)).ok)
  await fixture.restart();sender=await join(300001,0);const rows=await history(sender,'world');assert.deepEqual(rows.map(row=>row.text),Array.from({length:30},(_,index)=>'row'+(index+2)))
  assert.ok((await admin('audit')).some(row=>row.action==='chat.settings'))
})
