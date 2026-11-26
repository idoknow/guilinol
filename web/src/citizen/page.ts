import './citizen.css'
import {markSurface,markSession} from '../session-mark'
markSurface(document.body)
void fetch('/api/me',{cache:'no-store'}).then(async response=>{if(response.ok) markSession((await response.json()).uid)}).catch(()=>{})
import qrCode from 'qrcode-generator'
import {cardUrl} from './items'

async function show(){
  const uid=new URL(location.href).searchParams.get('uid')??''
  if(!/^[1-9]\d{5,15}$/.test(uid)||!Number.isSafeInteger(Number(uid)))throw Error('卡号无效')
  const response=await fetch(`/api/citizen/${uid}`)
  if(!response.ok)throw Error(response.status===404?'没有找到这张市民卡':'暂时无法读取市民卡')
  const card=await response.json()
  const fields=document.querySelector('#fields')!
  document.querySelector('#uid')!.textContent=String(card.uid)
  document.title=`${card.nickname} 的市民卡 · 网上桂林`
  for(const [label,value] of [['昵称',card.nickname],['性别',card.gender==='m'?'男':card.gender==='f'?'女':'未设置'],['注册日期',new Date(card.registeredAt*1000).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})]]){
    const term=document.createElement('dt'),detail=document.createElement('dd')
    term.textContent=label;detail.textContent=value;fields.append(term,detail)
  }
  if(card.photoUrl){const photo=new Image();photo.alt='角色头像';photo.src=card.photoUrl;document.querySelector('#photo')!.replaceChildren(photo)}
  const qr=qrCode(0,'M');qr.addData(cardUrl(card.uid));qr.make()
  const code=new Image();code.alt='市民卡扫码链接';code.src=qr.createDataURL(4,0)
  const hint=document.createElement('small');hint.textContent='扫码看这张卡'
  document.querySelector('#qr')!.append(code,hint)
  document.querySelector<HTMLElement>('.cz-card')!.hidden=false
  document.querySelector('#status')!.textContent=''
}
void show().catch(error=>{document.querySelector('#status')!.textContent=error.message})
