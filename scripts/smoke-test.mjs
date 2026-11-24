import test from 'node:test'
import assert from 'node:assert/strict'
import {SmokeSession,RemoteSmoke} from '../web/src/smoke/session.ts'
import {queueCigarette,takeCigaretteIntent} from '../web/src/citizen/use-item.ts'

test('same-tab backpack intent can only be consumed once',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}
  queueCigarette(storage);assert.equal(takeCigaretteIntent(storage),true);assert.equal(takeCigaretteIntent(storage),false)
})
function lit(){
  const session=new SmokeSession();assert.equal(session.light(),false);session.start('plain','cigarette')
  assert.equal(session.puff(),false);for(let step=0;step<4;step++)session.advance(.25)
  assert.equal(session.phase,'ready');assert.equal(session.light(),true)
  let ignitions=0;while(!session.lit){session.advance(.25);ignitions+=Number(session.ignited)}
  assert.equal(ignitions,1);return session
}
test('draw, ignite, burn down in 180s, drop one stub',()=>{
  const session=lit();for(let step=0;step<719;step++)assert.equal(session.advance(.25),false)
  assert.equal(session.advance(.25),true);assert.equal(session.advance(.25),false);assert.equal(session.active,false)
})
test('puff costs 15s and cannot repeat immediately; cancel does not drop a stub',()=>{
  const session=lit();assert(session.puff());assert.equal(session.burn,165);assert(!session.puff());session.stop();assert(!session.advance(.25));assert(!session.active)
})
test('remote light, burn and puff follow wire fields',()=>{
  const peer=new RemoteSmoke();peer.update(1,1800,0,0,.1);assert(peer.view().light)
  peer.update(2,1650,1,0,.1);assert(peer.view().puff>0);assert.equal(peer.view().burn,165);assert(peer.view().lit)
  peer.update(0,0,1,0,.1);assert(!peer.active)
})
