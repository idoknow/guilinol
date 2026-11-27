import {readFileSync} from 'node:fs'
import {LIMITS} from './anti-cheat.mjs'
const sites=JSON.parse(readFileSync(new URL('./travel-sites.json',import.meta.url)))
function lockCode(player,at){
  if(at-(player.lastCombat??-Infinity)<LIMITS.combatLockMs)return 'combat'
  if(at-(player.tpAt??-Infinity)<LIMITS.tpGapMs)return 'cooldown'
  return 'ok'
}
export function leaveHistory(){
  const recentLeave=new Map(),ttl=Math.max(LIMITS.combatLockMs,LIMITS.tpGapMs)
  return {
    save({uid,lastCombat,tpAt,x,y,z},at){
      recentLeave.delete(uid);recentLeave.set(uid,{lastCombat,tpAt,x,y,z,at})
    },
    restore(player,at){
      for(const [uid,entry] of recentLeave){if(at-entry.at<ttl)break;recentLeave.delete(uid)}
      const entry=recentLeave.get(player.uid);if(!entry)return
      recentLeave.delete(player.uid)
      player.lastCombat=entry.lastCombat;player.tpAt=entry.tpAt
      if(Math.hypot(player.x-entry.x,player.z-entry.z)<=200)return
      const code=lockCode(player,at)
      if(code==='ok'){player.tpAt=at;return}
      const {x,y,z}=entry;Object.assign(player,{x,y,z});return {x,y,z,code}
    }
  }
}
export function grantTravel(player,reason,target,at) {
  player.travel=null
  if(typeof target!=='string'||!Object.hasOwn(sites,target))return 'site'
  if(reason!=='map' && reason!=='flight' && reason!==target.split(':')[0])return 'reason'
  const code=lockCode(player,at);if(code!=='ok')return code
  const [x,z]=sites[target]; player.travel={x,z,until:at+90000}
  return 'ok'
}
export function precheckLeave(player,at){
  const code=lockCode(player,at)
  if(code!=='ok')return {ok:false,code}
  player.travel=null;player.tpAt=at
  return {ok:true,code,leave:true,rejoinAfterMs:LIMITS.tpGapMs}
}
