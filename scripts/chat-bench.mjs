import assert from 'node:assert/strict'
import {setTimeout as delay} from 'node:timers/promises'
import {setup,until} from './chat-fixture.mjs'
import {parseArgs} from 'node:util'
const providerDelay=Number(parseArgs({options:{'provider-delay':{type:'string',default:'0'}}}).values['provider-delay'])
assert.ok(Number.isSafeInteger(providerDelay)&&providerDelay>=0)
const fixture=await setup({providerDelay})
try{
  await fixture.admin('settings',{patch:{unmoderated_policy:'local_only'}})
  for(let index=0;index<300;index++)await fixture.join(400000+index,index*5)
  const {clients}=fixture;fixture.peaks.length=0;const start=Date.now(),expected=new Map()
  for(let round=0;round<10;round++){
    await delay(Math.max(0,start+round*2000-Date.now()))
    for(let index=0;index<75;index++){
      const ch=index<60?'near':'world',cid=round+'-'+index,sender=clients[index],text=cid.replace(/\d/g,digit=>'杉桐梧柏榕梓柚榆栗栎'[Number(digit)]);expected.set(cid,{sender,ch,text});sender.send({t:'chat',ch,cid,text})
    }
  }
  await delay(Math.max(0,start+20000-Date.now()));console.log('at 20s',await fixture.health(), 'acks', clients.flatMap(client=>client.events).filter(e=>e.t==='chat_ack').length);await until(()=>clients.flatMap(client=>client.events).filter(e=>e.t==='chat_ack').length===750)
  let deliveries=0,received=0,accepted=0,rates=0
  for(const [cid,{sender,ch,text}] of expected){const ack=sender.events.find(e=>e.t==='chat_ack'&&e.cid===cid);if(!ack.ok){assert.equal(ch,'world');assert.equal(ack.code,'rate');rates++;continue}accepted++
    for(const client of clients){const should=ch==='world'||Math.abs(client.x-sender.x)<=60;if(should)deliveries++;const events=client.events.filter(e=>e.t==='chat'&&e.mid===ack.mid);assert.equal(events.length,Number(should));if(should){received++;assert.equal(events[0].ch,ch);assert.equal(events[0].text,text)}}
  }
  for(const client of clients){const ids=client.events.filter(e=>e.t==='chat').map(e=>Number(e.mid));assert.deepEqual(ids,[...ids].sort((a,b)=>a-b))}
  assert.ok(rates>0&&accepted>=600);assert.equal(received,clients.flatMap(client=>client.events).filter(e=>e.t==='chat').length);console.log(JSON.stringify({bots:300,seconds:20,accepted,rates,expected:deliveries,received,loopP99MsMax:Math.max(...fixture.peaks,(await fixture.health()).loopP99Ms)}))
  if(providerDelay)assert.equal(fixture.checks.length,accepted)
}finally{await fixture.close()}
