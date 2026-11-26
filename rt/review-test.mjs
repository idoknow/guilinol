import assert from 'node:assert/strict'
import {checkMove,createBanStore} from './anti-cheat.mjs'
import {acceptEmote} from './emote.mjs'

const store=createBanStore({RT_AC_AUTOBAN:'1'})
const evidence=(uid,kind)=>store.violation({uid,kind,detail:{from:[1,3,1],to:[3,4,3]}})
for(let index=0;index<24;index++) await evidence(51,index%2?'teleport':'speed')
assert.equal(store.check(51),null)
const [review]=await store.reviews();assert.equal(review.evidence.length,2)
await assert.rejects(store.ban({uid:52,reviewId:review.id}))
await store.dismiss(51,review.id,'test');assert.deepEqual(await store.reviews(),[])
for(let index=0;index<8;index++) await evidence(52,'speed')
assert.ok(store.check(52).until-Date.now()<=600000)
for(let index=0;index<24;index++) await evidence(53,'altitude_unverified')
assert.equal(store.check(53),null)
await evidence(54,'mount_player');assert.equal(store.check(54).reason,'试图骑乘其他在线玩家')
for(let index=0;index<24;index++) await evidence(55,'head_overlap')
assert.equal(store.check(55),null)
const player={x:0,y:12,z:0,posAt:10000,emoteTimes:[],es:0}
assert.ok(checkMove(player,0,7,0,10100).ok)
assert.ok(acceptEmote(player,{id:1,s:1},10100));assert.ok(checkMove(player,0,12,0,10150).ok)
assert.equal(checkMove(player,500,12,0,10150).kind,'teleport')
console.log('PASS: mixed evidence, review isolation, short ban, altitude, fall, emote, travel')
