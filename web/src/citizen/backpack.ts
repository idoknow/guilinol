import {backpackItems} from './items'
import {queueCigarette} from './use-item'
const status=document.querySelector('#status')!,button=document.querySelector<HTMLButtonElement>('#portrait')!
async function openBag(){
  const response=await fetch('/api/me')
  if(!response.ok)throw Error(response.status===401?'请先登录后查看背包':'暂时无法读取背包')
  const {uid}=await response.json()
  for(const item of backpackItems(uid)){
    const row=document.createElement('li')
    if(item.id==='citizen-card'){
      const link=document.createElement('a');link.href=item.viewUrl;link.textContent=item.name;row.append(link)
    }else{
      const use=document.createElement('button');use.textContent=item.name
      use.onclick=()=>{queueCigarette(sessionStorage);location.assign('/')};row.append(use)
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
