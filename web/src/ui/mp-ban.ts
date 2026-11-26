import './mp-ban.css'

export type MpBan={reason?:string,until?:number|null,recordId?:string}

const pad=(n:number)=>String(n).padStart(2,'0')
function stamp(at:number){const d=new Date(at);return `${d.getMonth()+1} 月 ${d.getDate()} 日 ${pad(d.getHours())}:${pad(d.getMinutes())}`}
function left(ms:number){
  if(ms<=0)return '已到期，可以重新连接'
  const m=Math.ceil(ms/60000)
  if(m<60)return `还剩 ${m} 分钟`
  const h=Math.floor(m/60),r=m%60
  if(h<48)return `还剩 ${h} 小时${r?` ${r} 分`:''}`
  return `还剩 ${Math.round(h/24)} 天`
}
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,cls?:string,text?:string)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node}

/** 联机被封时的提示：说明原因、解封时间和记录 ID，主动作是带着记录 ID 去申诉。单人游览不受影响。 */
export function showMpBan(ban:MpBan,onAppeal:(recordId?:string)=>void){
  document.getElementById('mp-ban-notice')?.remove()
  const dialog=el('dialog','ui-panel mp-ban');dialog.id='mp-ban-notice';dialog.setAttribute('aria-labelledby','mp-ban-title')
  const header=el('header'),head=el('div','mp-ban-head'),seal=el('span','mp-ban-seal','封'),title=el('h2',undefined,'联机已暂停')
  seal.setAttribute('aria-hidden','true');title.id='mp-ban-title'
  const close=el('button','about-close','关闭');close.type='button';close.onclick=()=>dialog.close()
  head.append(seal,title);header.append(head,close)

  const lede=el('p','mp-ban-lede','这个账号暂时不能进入联机。单人游览、地图和反馈都可以照常使用。')
  const sheet=el('dl','mp-ban-sheet')
  const row=(label:string,...value:Node[])=>{const wrap=el('div','mp-ban-row'),dt=el('dt',undefined,label),dd=el('dd');dd.append(...value);wrap.append(dt,dd);sheet.append(wrap);return dd}
  row('原因',el('span','mp-ban-reason',ban.reason?.trim()||'违反联机规则'))
  const permanent=ban.until==null
  const until=row('解封',document.createTextNode(permanent?'需申诉后由管理员处理':stamp(ban.until!)))
  let timer=0
  if(!permanent){
    const remain=el('span','mp-ban-left');until.append(remain)
    const tick=()=>{remain.textContent=left(ban.until!-Date.now())}
    tick();timer=window.setInterval(tick,30000)
  }
  if(ban.recordId){
    const wrap=el('div','mp-ban-id'),code=el('code',undefined,ban.recordId),copy=el('button','mp-ban-copy','复制');copy.type='button'
    copy.onclick=()=>void navigator.clipboard?.writeText(ban.recordId!).then(()=>{copy.textContent='已复制';setTimeout(()=>{copy.textContent='复制'},1600)},()=>{})
    wrap.append(code,copy);row('记录',wrap)
  }
  const note=el('p','mp-ban-note','觉得是误封？点「申诉」，记录编号会自动带上，管理员核对服务端记录后处理。')
  const actions=el('div','mp-ban-actions')
  const later=el('button','ui-btn ui-btn--ghost','继续单人游览');later.type='button';later.onclick=()=>dialog.close()
  const appeal=el('button','ui-btn ui-btn--seal','申诉');appeal.type='button'
  appeal.onclick=()=>{dialog.close();onAppeal(ban.recordId)}
  actions.append(later,appeal)
  dialog.append(header,lede,sheet,note,actions)
  dialog.addEventListener('close',()=>{clearInterval(timer);dialog.remove()})
  document.body.append(dialog);dialog.showModal();appeal.focus()
  return dialog
}
