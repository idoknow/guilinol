import {readFileSync} from 'node:fs'
import {LIMITS} from './anti-cheat.mjs'
const sites=JSON.parse(readFileSync(new URL('./travel-sites.json',import.meta.url)))
export function grantTravel(player,reason,target,at) {
  player.travel=null
  if(typeof target!=='string'||!Object.hasOwn(sites,target))return false
  if(reason!=='map' && reason!=='flight' && reason!==target.split(':')[0])return false
  if(at-(player.lastCombat??-Infinity)<LIMITS.combatLockMs || at-(player.tpAt??-Infinity)<LIMITS.tpGapMs)return false
  const [x,z]=sites[target]; player.travel={x,z,until:at+90000}
  return true
}
