import './citizen.css'
import {markSurface,markSession} from '../session-mark'
import {backpackItems} from './items'
import {queueCigarette,smokeEnabled} from './use-item'
import { readJson } from '../lib/json'
import {setCloudAccount} from '../game/cloud-session'
import {getActiveSaveSnapshot,loadLocalSave} from '../game/save'
import {formatSmokeCount} from '../smoke/data'
const status=document.querySelector('#status')!,button=document.querySelector<HTMLButtonElement>('#portrait')!
const itemsEl=document.querySelector('#items')!

async function openBag(){
  const response=await fetch('/api/me').catch(()=>null)
  let user:{id?:string;uid?:number}|null=null
  markSurface(document.body)
  if(response?.ok){
    user=await readJson<{id?:string;uid?:number}>(response)
    if(typeof user?.uid==='number')markSession(user.uid)
    if(typeof user?.id==='string'&&user.id)await setCloudAccount(user.id).catch(()=>{})
    else loadLocalSave(undefined,Date.now(),false)
  }else if(smokeEnabled()&&(!response||response.status===401||response.status===404)){
    // 未登录或离线预览时回退读取本地 glol.save.v1
    loadLocalSave(undefined,Date.now(),false)
  }else{
    throw Error(response?.status===401?'请先登录后查看背包':'暂时无法读取背包')
  }

  let syncCigarette:(()=>void)|undefined
  for(const item of backpackItems(user?.uid??0)){
    if(item.id==='citizen-card'&&user?.uid===undefined)continue
    if(item.id==='cigarette'&&!smokeEnabled())continue
    const row=document.createElement('li'),icon=document.createElement('span'),text=document.createElement('span'),name=document.createElement('b'),note=document.createElement('small')
    row.className='cz-item';icon.setAttribute('aria-hidden','true');text.className='cz-item-text';name.textContent=item.name;text.append(name,note)
    if(item.id==='citizen-card'){
      icon.className='cz-item-icon cz-icon-card';note.textContent=`卡号 ${user!.uid} · 扫码就能给朋友看`
      const link=document.createElement('a');link.className='cz-btn';link.href=item.viewUrl;link.textContent='查看';row.append(icon,text,link)
    }else{
      // 抽烟入口刻意放低调：素色小图、灰字，不用朱砂主按钮（IDOK-192 Rock：入口弱化）。
      row.classList.add('cz-item--quiet');icon.className='cz-item-icon cz-icon-cig'
      const use=document.createElement('button');use.className='cz-btn cz-btn--ghost'
      use.onclick=()=>{queueCigarette(sessionStorage);location.assign('/')}
      syncCigarette=()=>{
        const packs=getActiveSaveSnapshot().packs
        const empty=packs.length===0
        row.classList.toggle('cz-item--empty',empty)
        if(empty){
          note.textContent='已抽完 · 点击前往香烟铺购买'
          use.textContent='去香烟铺'
          use.setAttribute('aria-label','香烟已抽完，前往香烟铺购买')
        }else{
          note.textContent=`${formatSmokeCount(packs[0].remaining,packs.length,'backpack')} · 按 3 或物品栏第 3 格拿出`
          use.textContent='香烟'
          use.removeAttribute('aria-label')
        }
      }
      syncCigarette()
      row.append(icon,text,use)
    }
    itemsEl.append(row)
  }
  if(syncCigarette)window.addEventListener('glol:save-written',syncCigarette)
  status.textContent=user?'':response?.status===401?'未登录：仅显示本地香烟（登录后可查看市民卡并同步云端）':''
  button.hidden=!user
}
button.onclick=async()=>{
  button.disabled=true
  try{
    const {updatePortrait}=await import('./portrait');await updatePortrait();status.textContent='卡面头像已更新'
  }catch(error){status.textContent=error instanceof Error?error.message:'头像更新失败'}
  finally{button.disabled=false}
}
void openBag().catch(error=>{status.textContent=error.message})
