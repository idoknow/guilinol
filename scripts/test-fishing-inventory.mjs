import assert from 'node:assert/strict'
import {test} from 'node:test'
import {buy, collect, consume, inventory, refundFullCast, removeCatch} from '../web/src/fishing/inventory.ts'
import {BAG_CAPACITY,RECENT_ACTION_LIMIT} from '../web/src/fishing/limits.ts'
import {executePurchase} from '../web/src/game/commerce.ts'
import {cloneSave,getActiveSaveSnapshot,mergeCloudAndLocalSave,persistSaveSync,resetSaveForTesting,sanitizeSave,setSaveStorageForTest,TX_HISTORY_RING_LIMIT,validateCloudPayload} from '../web/src/game/save.ts'

test('migration, lock gate, idempotency, streak floor and atomic daily cap',()=>{
  const legacy=sanitizeSave({money:120,schemaVersion:2}).save
  assert.equal(legacy.fishing.version,1);assert.equal(legacy.money,120)
  const storage={getItem:()=>null,setItem:()=>{}};setSaveStorageForTest(storage);resetSaveForTesting(100,storage)
  assert.equal(buy('line2','locked-line').code,'locked')
  assert.equal(buy('bait1','purchase-1').delta,-3);assert.equal(buy('bait1','purchase-1').code,'IDEMPOTENT_REPLAY')
  const fish={speciesId:'008',name:'鲻鱼',grade:'low',weight:1,price:100,size:'中型',time:Date.now(),water:'ronghu',method:'路亚'}
  for(let index=0;index<7;index++)assert.ok(collect({...fish,id:`catch-${index}`}).ok)
  assert.deepEqual(inventory().bag.map(item=>item.price),[100,88,76,64,52,40,40])
  assert.equal(inventory().collected.length,1)
  assert.equal(removeCatch(['catch-0','catch-1'],true,'sale-1').delta,188)
  assert.equal(removeCatch(['catch-0','catch-1'],true,'sale-1').code,'IDEMPOTENT_REPLAY')
  const next=cloneSave(getActiveSaveSnapshot());next.fishing.income=4999;persistSaveSync(next)
  assert.equal(removeCatch(['catch-2'],true,'sale-2').code,'今日渔获收入已达上限');assert.equal(inventory().bag.length,5)
  const before=structuredClone(getActiveSaveSnapshot());storage.setItem=()=>{throw Error('storage unavailable')}
  assert.equal(removeCatch(['catch-2'],false,'discard-1').code,'PERSIST_FAILED');assert.deepEqual(getActiveSaveSnapshot(),before)
})

const specimen=()=>({id:crypto.randomUUID(),speciesId:'021',name:'蓝宝石雷龙鱼',grade:'legendary',weight:0.49,price:1600,size:'小型',time:Date.now(),water:'lijiang_xiangbi',method:'台钓'})
function fresh(){setSaveStorageForTest({getItem:()=>null,setItem:()=>{}});resetSaveForTesting(1000)}
test('100 cast/catch/discard cycles retain a paid transaction and bound separate replay keys',()=>{
  fresh();const seed=cloneSave(getActiveSaveSnapshot());seed.fishing.bait.bait1=100;persistSaveSync(seed)
  const key=crypto.randomUUID(),purchase={shopId:'shop_nikoniko_apparel',itemType:'outfit_preset',itemId:'outfit_guilin_hoodie',expectedPrice:480,idempotencyKey:key};assert.equal(executePurchase(purchase).charged,480)
  for(let index=0;index<100;index++){
    assert.ok(consume('bait1').ok);const item=specimen();assert.ok(collect(item).ok);assert.equal(collect(item).code,'IDEMPOTENT_REPLAY');assert.ok(removeCatch([item.id],false).ok)
  }
  assert.deepEqual(getActiveSaveSnapshot().economy.txHistoryRing.map(tx=>tx.idempotencyKey),[key]);assert.equal(executePurchase(purchase).code,'IDEMPOTENT_REPLAY');assert.equal(inventory().recentActions.length,RECENT_ACTION_LIMIT)
})
test('full fishing bag rejects cast and catch without writes; worst populated fishing block fits cloud',context=>{
  fresh();for(let index=0;index<TX_HISTORY_RING_LIMIT;index++)assert.ok(buy('bait1').ok)
  for(let index=0;index<BAG_CAPACITY;index++){assert.ok(consume('bait1').ok);assert.ok(collect(specimen()).ok)}
  const before=cloneSave(getActiveSaveSnapshot());assert.equal(consume('bait1').code,'BAG_FULL');assert.equal(collect(specimen()).code,'BAG_FULL');assert.deepEqual(getActiveSaveSnapshot(),before)
  before.fishing.collected=Array.from({length:27},(_,index)=>String(index+1).padStart(3,'0'));assert.equal(before.economy.txHistoryRing.length,TX_HISTORY_RING_LIMIT)
  assert.equal(before.fishing.recentActions.length,RECENT_ACTION_LIMIT);assert.ok(validateCloudPayload(before).ok);const bytes=Buffer.byteLength(JSON.stringify(before));assert.ok(bytes<=65536);context.diagnostic(`full save: ${bytes} UTF-8 bytes`)
})
test('merging a newer unsold inventory with an older sale credits at most one sale',()=>{
  fresh();const item=specimen();assert.ok(collect(item).ok);const newer=cloneSave(getActiveSaveSnapshot());assert.ok(removeCatch([item.id],true).ok)
  const sold=cloneSave(getActiveSaveSnapshot());newer.updatedAt=sold.updatedAt+1
  for(const [local,cloud] of [[sold,newer],[newer,sold]]){
    const merged=mergeCloudAndLocalSave(local,cloud);assert.equal(merged.money,newer.money);persistSaveSync(merged)
    assert.ok(removeCatch([item.id],true).ok);assert.equal(getActiveSaveSnapshot().money,sold.money);assert.equal(removeCatch([item.id],true).code,'INVALID_ITEM')
  }
})

test('a full-bag race refunds only the original cast, once',()=>{
  fresh();const count=inventory().bait.bait1,key=crypto.randomUUID();assert.ok(consume('bait1',key).ok)
  const synced=cloneSave(getActiveSaveSnapshot());synced.fishing.bag=Array.from({length:BAG_CAPACITY},specimen);persistSaveSync(synced)
  assert.equal(collect(specimen()).code,'BAG_FULL');assert.equal(refundFullCast('bait1','other-device').code,'NO_LOCAL_DEBIT');assert.ok(refundFullCast('bait1',key).ok)
  assert.equal(refundFullCast('bait1',key).code,'IDEMPOTENT_REPLAY');assert.equal(inventory().bait.bait1,count);assert.equal(inventory().xp,0)
})
