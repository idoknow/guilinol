import assert from 'node:assert/strict'
import {bindTravel,enterLanding,prepareTravel} from '../web/src/mp-travel.ts'
import {leaveHistory,precheckLeave} from '../rt/travel.mjs'

const history=leaveHistory(),player={uid:10,x:0,y:4,z:0}
let at=10000,online=true,toast=''
globalThis.window=new EventTarget()
window.addEventListener('walk:toast',event=>toast=event.detail)
bindTravel((reason,x,z)=>prepareTravel(reason,x,z,async target=>{
  assert.equal(target,null);return precheckLeave(player,at)
},delay=>{
  assert.ok(online);online=false;history.save(player,at)
  return ()=>{at+=delay;assert.equal(history.restore(player,at),undefined);online=true}
}))
player.lastCombat=at
assert.equal(await enterLanding('geolocation',1000,0,()=>assert.fail('combat landing')),false)
assert.equal(toast,'战斗中无法传送');assert.ok(online)
at+=10000
assert.ok(await enterLanding('geolocation',1000,0,async()=>{
  assert.equal(online,false);assert.equal(player.travel,null);player.x=1000;return true
}))
assert.ok(online);assert.equal(player.x,1000);assert.equal(player.tpAt,at)
assert.equal(await enterLanding('geolocation',2000,0,()=>assert.fail('cooldown landing')),false)
assert.equal(toast,'传送冷却中，请稍后')
