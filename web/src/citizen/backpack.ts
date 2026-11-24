import './citizen.css'
import {backpackItems} from './items'
import {queueCigarette} from './use-item'
const status=document.querySelector('#status')!,button=document.querySelector<HTMLButtonElement>('#portrait')!
async function openBag(){
  const response=await fetch('/api/me')
  if(!response.ok)throw Error(response.status===401?'请先登录后查看背包':'暂时无法读取背包')
  const {uid}=await response.json()
  for(const item of backpackItems(uid)){
    const row=document.createElement('li'),icon=document.createElement('span'),text=document.createElement('span'),name=document.createElement('b'),note=document.createElement('small')
    row.className='cz-item';icon.setAttribute('aria-hidden','true');text.className='cz-item-text';name.textContent=item.name;text.append(name,note)
    if(item.id==='citizen-card'){
      icon.className='cz-item-icon cz-icon-card';note.textContent=`卡号 ${uid} · 扫码就能给朋友看`
      const link=document.createElement('a');link.className='cz-btn';link.href=item.viewUrl;link.textContent='查看';row.append(icon,text,link)
    }else{
      // 抽烟入口刻意放低调：素色小图、灰字，不用朱砂主按钮（IDOK-192 Rock：入口弱化）。
      row.classList.add('cz-item--quiet');icon.className='cz-item-icon cz-icon-cig';note.textContent='回到城里时取出一根，Y 点火'
      const use=document.createElement('button');use.className='cz-btn cz-btn--ghost';use.textContent='取一根'
      use.onclick=()=>{queueCigarette(sessionStorage);location.assign('/')};row.append(icon,text,use)
    }
    document.querySelector('#items')!.append(row)
  }
  status.textContent='';button.hidden=false
}
button.onclick=async()=>{
  button.disabled=true
  try{
    const {updatePortrait}=await import('./portrait');await updatePortrait();status.textContent='卡面头像已更新'
  }catch(error){status.textContent=error instanceof Error?error.message:'头像更新失败'}
  finally{button.disabled=false}
}
void openBag().catch(error=>{status.textContent=error.message})
