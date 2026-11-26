import {onUser} from '../ui/account'
import type {Catch} from './engine'

let owner='',busy=false,timer=0
const prefix=(user:string)=>`glol.fishing.pending.${user}:`
async function flush(){
  if(!owner||busy)return
  const user=owner
  busy=true
  let retry=false
  try{
    const key=Object.keys(localStorage).find(entry=>entry.startsWith(prefix(user)))
    if(!key)return
    retry=true
    const response=await fetch('/api/fishing/catch',{method:'POST',headers:{'Content-Type':'application/json','X-Fishing-Owner':user},body:localStorage.getItem(key)})
    if(response.ok&&['ignored','recorded'].includes((await response.json()).status))localStorage.removeItem(key)
  }catch{}finally{busy=false;if(retry||user!==owner)timer=window.setTimeout(()=>{timer=0;void flush()},8100)}
}
onUser(user=>{owner=user?.id??'';if(!timer)void flush()})
export function reportCatch(item:Catch){
  if(!owner||!item.speciesId)return
  try{localStorage.setItem(prefix(owner)+item.id,JSON.stringify({clientCatchId:item.id,zoneId:item.water,speciesId:item.speciesId,grade:item.grade,weight:item.weight,method:item.method}));if(!timer)void flush()}catch{}
}
