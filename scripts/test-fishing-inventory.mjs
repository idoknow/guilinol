import assert from 'node:assert/strict'
import {test} from 'node:test'
import {buy, collect, inventory, removeCatch} from '../web/src/fishing/inventory.ts'
import {cloneSave,getActiveSaveSnapshot,persistSaveSync,resetSaveForTesting,sanitizeSave,setSaveStorageForTest} from '../web/src/game/save.ts'

test('migration, lock gate, idempotency, streak floor and atomic daily cap',()=>{
  const legacy=sanitizeSave({money:120,schemaVersion:2}).save
  assert.equal(legacy.fishing.version,1);assert.equal(legacy.money,120)
  const storage={getItem:()=>null,setItem:()=>{}};setSaveStorageForTest(storage);resetSaveForTesting(100,storage)
  assert.equal(buy('line2','locked-line').code,'locked')
  assert.equal(buy('bait1','purchase-1').delta,-3);assert.equal(buy('bait1','purchase-1').code,'IDEMPOTENT_REPLAY')
  const fish={speciesId:'008',name:'鲻鱼',grade:'low',weight:1,price:100,size:'中型',time:Date.now(),water:'ronghu',method:'路亚'}
  for(let index=0;index<7;index++)assert.ok(collect({...fish,id:`catch-${index}`}))
  assert.deepEqual(inventory().bag.map(item=>item.price),[100,88,76,64,52,40,40])
  assert.equal(inventory().collected.length,1)
  assert.equal(removeCatch(['catch-0','catch-1'],true,'sale-1').delta,188)
  assert.equal(removeCatch(['catch-0','catch-1'],true,'sale-1').code,'IDEMPOTENT_REPLAY')
  const next=cloneSave(getActiveSaveSnapshot());next.fishing.income=4999;persistSaveSync(next)
  assert.equal(removeCatch(['catch-2'],true,'sale-2').code,'今日渔获收入已达上限');assert.equal(inventory().bag.length,5)
  const before=structuredClone(getActiveSaveSnapshot());storage.setItem=()=>{throw Error('storage unavailable')}
  assert.equal(removeCatch(['catch-2'],false,'discard-1').code,'PERSIST_FAILED');assert.deepEqual(getActiveSaveSnapshot(),before)
})
