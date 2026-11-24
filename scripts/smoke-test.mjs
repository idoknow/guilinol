import test from 'node:test'
import assert from 'node:assert/strict'
import {SmokeSession,RemoteSmoke} from '../web/src/smoke/session.ts'
import {queueCigarette,takeCigaretteIntent} from '../web/src/citizen/use-item.ts'

test('same-tab backpack intent can only be consumed once',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}
  queueCigarette(storage);assert.equal(takeCigaretteIntent(storage),true);assert.equal(takeCigaretteIntent(storage),false)
})
import {executePurchase} from '../web/src/game/commerce.ts'
import {resetSaveForTesting,getActiveSaveSnapshot,takeFromPack,loadLocalSave,setSaveStorageForTest} from '../web/src/game/save.ts'
function buy(id,key){
  return executePurchase({shopId:'smoke',itemType:'cigarette_pack',itemId:id,expectedPrice:25,idempotencyKey:key})
}
test('shop caps inventory atomically and discard never charges a second cigarette',()=>{
  resetSaveForTesting(100)
  const session=new SmokeSession()
  assert.equal(session.start(getActiveSaveSnapshot().packs[0]?.brand),false)
  for(let n=0;n<3;n++)assert.equal(buy('bailong',String(n)).code,'OK')
  assert.equal(buy('bailong','4').code,'ALREADY_FULL')
  assert.equal(getActiveSaveSnapshot().money,25)
  session.start('bailong')
  session.advance(1)
  const take=()=>takeFromPack('bailong')
  session.act(take);session.advance(1);session.act(take);session.advance(1)
  session.stop()
  assert.equal(getActiveSaveSnapshot().packs[0].remaining,19)
  resetSaveForTesting(0)
  assert.equal(buy('bailong','5').code,'INSUFFICIENT_FUNDS')
})
test('seeded burn interval and ten segments with single and double puffs',()=>{
  let seed=37
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32)
  const counts=new Set()
  for(let n=0;n<50;n++){
    const session=new SmokeSession(random)
    session.start('hehua')
    assert(session.total>=150 && session.total<=180)
    for(const phase of ['sealed','open','ready']){
      session.advance(1);assert.equal(session.phase,phase);assert(session.act(()=>true))
    }
    session.advance(1)
    assert(session.lit)
    session.act(()=>true)
    counts.add(session.strength)
    assert(Math.abs(session.length-(1-session.strength/10))<1e-10)
    assert(!session.act(()=>true))
    assert(session.advance(session.burn));assert(!session.active)
  }
  assert.deepEqual(counts,new Set([1,2]))
})
test('remote displays the six brands and all preparation stages',()=>{
  const peer=new RemoteSmoke()
  for(const [i,phase] of ['idle','light','smoking','draw','sealed','tear','open','take','ready'].entries()){
    peer.update(i,1800,0,5,.1)
    assert.equal(peer.view().phase,phase)
    assert.equal(peer.view().brand,'lijiang')
  }
})

test('mixed packs survive reload and an empty pack advances to the next brand',()=>{
  const disk=new Map()
  const storage={getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v),removeItem:k=>disk.delete(k)}
  setSaveStorageForTest(storage)
  resetSaveForTesting(200,storage)
  loadLocalSave(storage)
  assert.equal(buy('bailong','first').code,'OK')
  assert.equal(executePurchase({shopId:'smoke',itemType:'cigarette_pack',itemId:'hehua',expectedPrice:38,idempotencyKey:'second'}).code,'OK')
  for(let i=0;i<19;i++)assert(takeFromPack('bailong'))
  assert.deepEqual(loadLocalSave(storage).save.packs,[{brand:'bailong',remaining:1},{brand:'hehua',remaining:20}])
  assert(takeFromPack('bailong'))
  assert(!takeFromPack('bailong'))
  assert.deepEqual(loadLocalSave(storage).save.packs,[{brand:'hehua',remaining:20}])
})
