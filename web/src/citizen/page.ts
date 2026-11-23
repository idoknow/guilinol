import qrCode from 'qrcode-generator'
import {cardUrl} from './items'

async function show(){
  const uid=new URL(location.href).searchParams.get('uid')??''
  if(!/^[1-9]\d{5,15}$/.test(uid)||!Number.isSafeInteger(Number(uid)))throw Error('卡号无效')
  const response=await fetch(`/api/citizen/${uid}`)
  if(!response.ok)throw Error(response.status===404?'没有找到这张市民卡':'暂时无法读取市民卡')
  const card=await response.json()
  const fields=document.querySelector('#fields')!,images=document.querySelector('#images')!
  for(const [label,value] of [['卡号',uid],['昵称',card.nickname],['性别',card.gender==='m'?'男':card.gender==='f'?'女':'未设置'],['注册日期',new Date(card.registeredAt*1000).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})]]){
    const term=document.createElement('dt'),detail=document.createElement('dd')
    term.textContent=label;detail.textContent=value;fields.append(term,detail)
  }
  if(card.photoUrl){const photo=new Image();photo.alt='角色头像';photo.src=card.photoUrl;images.append(photo)}
  const qr=qrCode(0,'M');qr.addData(cardUrl(card.uid));qr.make()
  const code=new Image();code.alt='市民卡扫码链接';code.src=qr.createDataURL(4);images.append(code)
  document.querySelector('#status')!.textContent=''
}
void show().catch(error=>{document.querySelector('#status')!.textContent=error.message})
