import {AVATAR_KEY} from '../../../lib/avatar'
import {SAVE_STORAGE_KEY,LEGACY_STAMPS_KEY,flushThrottledSave,loadLocalSave,sanitizeSave} from './save'

const ownerKey='glol.save.owner', keys=[SAVE_STORAGE_KEY,LEGACY_STAMPS_KEY,AVATAR_KEY]
let stop=()=>{}, active:string|null=null, initial=Promise.resolve()

function swap(owner:string|null) {
  const previous=localStorage.getItem(ownerKey)
  if(previous===owner)return
  flushThrottledSave()
  if(previous){
    const archive=keys.map(key=>localStorage.getItem(key))
    localStorage.setItem(`${ownerKey}.${previous}`,JSON.stringify(archive))
    keys.forEach(key=>localStorage.removeItem(key))
  }
  const stored=owner && localStorage.getItem(`${ownerKey}.${owner}`)
  if(stored){
    const values=JSON.parse(stored)
    keys.forEach((key,index)=>{if(values[index]!=null)localStorage.setItem(key,values[index]);else localStorage.removeItem(key)})
  }
  if(owner)localStorage.setItem(ownerKey,owner);else localStorage.removeItem(ownerKey)
  loadLocalSave(undefined,Date.now(),false)
}

export function setCloudAccount(owner:string|null) {
  if(active===owner && localStorage.getItem(ownerKey)===owner)return initial
  stop(); active=null; swap(owner)
  if(!owner)return initial=Promise.resolve()
  active=owner
  const events=new AbortController(), headers={'X-Save-Owner':owner}
  let running=false, pending=false, timer=0
  const valid=()=>!events.signal.aborted && localStorage.getItem(ownerKey)===owner
  const schedule=()=>{if(!valid())return; clearTimeout(timer);timer=window.setTimeout(()=>void sync(),350)}
  async function sync(){
    if(!valid()||!navigator.onLine)return
    if(running){pending=true;return}
    running=true
    try{
      const signal=AbortSignal.any([events.signal,AbortSignal.timeout(5000)])
      const response=await fetch('/api/me/save',{headers,signal})
      if(!response.ok)return
      let remote=await response.json()
      if(!valid())return
      flushThrottledSave()
      const original=localStorage.getItem(SAVE_STORAGE_KEY)
      const local=original?JSON.parse(original):null
      if(local && (!remote.save || local.updatedAt>remote.save.updatedAt)){
        const put=await fetch('/api/me/save',{method:'PUT',headers:{...headers,'Content-Type':'application/json','If-Match':`"${remote.revision}"`},body:JSON.stringify(sanitizeSave(local).save),signal})
        if(!put.ok){if(put.status===409)pending=true;return}
        remote=await put.json()
      }
      if(!valid() || !remote.save)return
      flushThrottledSave()
      if(localStorage.getItem(SAVE_STORAGE_KEY)!==original){pending=true;return}
      const winner=sanitizeSave(remote.save).save, text=JSON.stringify(winner)
      if(text!==original){
        localStorage.setItem(SAVE_STORAGE_KEY,text)
        localStorage.setItem(LEGACY_STAMPS_KEY,JSON.stringify(winner.spotsFound))
        if(winner[AVATAR_KEY])localStorage.setItem(AVATAR_KEY,JSON.stringify(winner[AVATAR_KEY]))
        loadLocalSave(undefined,Date.now(),false)
      }
    }catch{/* Local storage remains authoritative until a successful exchange. */}
    finally{running=false;if(pending){pending=false;schedule()}}
  }
  const options={signal:events.signal}
  window.addEventListener('glol:save-written',schedule,options)
  window.addEventListener('online',schedule,options)
  window.addEventListener('focus',schedule,options)
  window.addEventListener('storage',event=>{
    if(event.key===ownerKey && !valid())location.reload()
    if(event.key===SAVE_STORAGE_KEY)schedule()
  },options)
  const interval=setInterval(()=>{if(!document.hidden)void sync()},30000)
  stop=()=>{events.abort();clearInterval(interval);clearTimeout(timer)}
  return initial=sync()
}
