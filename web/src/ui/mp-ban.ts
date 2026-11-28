import './mp-ban.css'

/** 联机受限提示。档位与文案以服务端下发为准；客户端只按档位换一套视觉，缺省字段用中性短句兜底。 */
export type MpBanTier='cooldown'|'ban'
export type MpBan={
  /** cooldown = 短时冷却，ban = 正式封禁；旧 payload 没有这个字段，按 ban 处理 */
  tier?:MpBanTier
  title?:string
  /** 印章上的一个字 */
  seal?:string
  lede?:string
  reason?:string
  /** 触发行为摘要，下发才显示 */
  behavior?:string
  /** 当时的网络状态摘要，下发才显示 */
  networkNote?:string
  note?:string
  /** 恢复时间（毫秒时间戳）；null / 缺省 = 没有到期时间 */
  until?:number|null
  recordId?:string
  /** 系统自动处理 */
  auto?:boolean
}
/** 关掉弹层后还能找回记录号：sessionStorage 里只留这几项 */
export type SavedMpBan={tier:MpBanTier,reason?:string,until:number|null,recordId?:string,savedAt:number}

const KEY='glol.lastMpBan',KEEP=24*60*60*1000
type Look={seal:string,title:string,lede:string,reason:string,until:string,open:string,primary:'appeal'|'continue',tick:number}
const LOOKS:Record<MpBanTier,Look>={
  cooldown:{seal:'歇',title:'联机暂歇',lede:'单人游览不受影响。',reason:'触发联机保护',until:'恢复',open:'稍后自动恢复',primary:'continue',tick:5000},
  ban:{seal:'封',title:'联机已暂停',lede:'单人游览、地图和反馈照常可用。',reason:'违反联机规则',until:'解封',open:'需申诉后由管理员处理',primary:'appeal',tick:30000},
}

const pad=(n:number)=>String(n).padStart(2,'0')
function stamp(at:number){
  const d=new Date(at),time=`${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.toDateString()===new Date(Date.now()).toDateString()?`今天 ${time}`:`${d.getMonth()+1} 月 ${d.getDate()} 日 ${time}`
}
function left(ms:number){
  if(ms<=0)return '已到期，可以重新连接'
  const m=Math.ceil(ms/60000)
  if(m<60)return `还剩 ${m} 分钟`
  const h=Math.floor(m/60),r=m%60
  if(h<48)return `还剩 ${h} 小时${r?` ${r} 分`:''}`
  return `还剩 ${Math.round(h/24)} 天`
}
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,cls?:string,text?:string)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node}
/** 下发文本只当纯文本：折叠空白、按字截断，一律走 textContent */
const clean=(value:unknown,max:number)=>typeof value==='string'?Array.from(value.replace(/\s+/g,' ').trim()).slice(0,max).join(''):''
const time=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>0?value:null

function read(ban:MpBan|null|undefined){
  const raw:Partial<Record<keyof MpBan,unknown>>=ban&&typeof ban==='object'?ban:{}
  const tier:MpBanTier=raw.tier==='cooldown'?'cooldown':'ban',look=LOOKS[tier],auto=raw.auto===true
  const reason=clean(raw.reason,120)
  return {tier,look,auto,reason,
    shownReason:reason||(tier==='ban'&&auto?'系统自动处理':look.reason),
    title:clean(raw.title,24)||look.title,
    seal:Array.from(clean(raw.seal,8))[0]||look.seal,
    lede:clean(raw.lede,160)||look.lede,
    behavior:clean(raw.behavior,120),
    networkNote:clean(raw.networkNote,120),
    note:clean(raw.note,160),
    until:time(raw.until),
    recordId:clean(typeof raw.recordId==='number'?String(raw.recordId):raw.recordId,128)}
}

const storage=()=>{try{return globalThis.sessionStorage??null}catch{return null}}
function saved(tier:MpBanTier,reason:string,until:number|null,recordId:string,savedAt:number):SavedMpBan{
  const out:SavedMpBan={tier,until,savedAt}
  if(reason)out.reason=reason
  if(recordId)out.recordId=recordId
  return out
}
export function clearLastMpBan(){try{storage()?.removeItem(KEY)}catch{/* 存储不可用时没有可清的 */}}
/** 最近一次联机受限记录（24 小时内）；过期或损坏的顺手清掉 */
export function getLastMpBan():SavedMpBan|null{
  try{
    const raw=storage()?.getItem(KEY);if(!raw)return null
    const v=JSON.parse(raw) as Partial<Record<keyof SavedMpBan,unknown>>|null
    const at=v&&typeof v==='object'&&typeof v.savedAt==='number'?v.savedAt:NaN,age=Date.now()-at
    if(!v||!(age>=0&&age<=KEEP)){clearLastMpBan();return null}
    return saved(v.tier==='cooldown'?'cooldown':'ban',clean(v.reason,120),time(v.until),clean(v.recordId,128),at)
  }catch{clearLastMpBan();return null}
}

let current:{dialog:HTMLDialogElement,dispose:()=>void}|undefined

/** 联机受限提示：cooldown 主动作是继续单人游览，ban 主动作是带着记录号申诉。单人游览不受影响。 */
export function showMpBan(ban:MpBan,onAppeal:(recordId?:string)=>void){
  current?.dispose();document.getElementById('mp-ban-notice')?.remove()
  const v=read(ban),look=v.look
  try{storage()?.setItem(KEY,JSON.stringify(saved(v.tier,v.reason,v.until,v.recordId,Date.now())))}catch{/* 隐私模式 / 配额满：不影响弹层 */}

  const dialog=el('dialog','ui-panel mp-ban');dialog.id='mp-ban-notice'
  dialog.setAttribute('data-tier',v.tier);dialog.setAttribute('aria-labelledby','mp-ban-title');dialog.setAttribute('aria-describedby','mp-ban-lede')
  if(v.auto)dialog.setAttribute('data-auto','')
  if(v.recordId)dialog.setAttribute('data-record-id',v.recordId)
  let ticker:ReturnType<typeof setInterval>|undefined,flashTimer:ReturnType<typeof setTimeout>|undefined,done=false
  const dispose=()=>{
    if(done)return;done=true
    clearInterval(ticker);clearTimeout(flashTimer);ticker=flashTimer=undefined
    dialog.remove();if(current?.dialog===dialog)current=undefined
  }

  const header=el('header'),head=el('div','mp-ban-head'),seal=el('span','mp-ban-seal',v.seal),title=el('h2',undefined,v.title)
  seal.setAttribute('aria-hidden','true');title.id='mp-ban-title'
  const close=el('button','about-close','关闭');close.type='button';close.setAttribute('data-mp-ban','close');close.onclick=()=>dialog.close()
  head.append(seal,title);header.append(head,close)

  const lede=el('p','mp-ban-lede',v.lede);lede.id='mp-ban-lede'
  const sheet=el('dl','mp-ban-sheet')
  const row=(field:string,label:string,...value:Node[])=>{
    const wrap=el('div','mp-ban-row'),dt=el('dt',undefined,label),dd=el('dd')
    wrap.setAttribute('data-field',field);dd.append(...value);wrap.append(dt,dd);sheet.append(wrap);return dd
  }
  row('reason','原因',el('span','mp-ban-reason',v.shownReason))
  if(v.behavior)row('behavior','行为',document.createTextNode(v.behavior))
  if(v.networkNote)row('network','网络',document.createTextNode(v.networkNote))
  if(v.until==null){
    row('until',look.until,document.createTextNode(look.open))
    if(v.tier==='ban')dialog.setAttribute('data-permanent','')
  }else{
    const until=v.until,at=el('span','mp-ban-at',stamp(until)),remain=el('span','mp-ban-left')
    remain.setAttribute('role','timer');row('until',look.until,at,remain)
    const tick=()=>{
      const ms=until-Date.now(),text=left(ms)
      if(remain.textContent!==text)remain.textContent=text
      if(ms<=0){dialog.setAttribute('data-expired','');clearInterval(ticker);ticker=undefined}
    }
    tick();if(!dialog.hasAttribute('data-expired'))ticker=setInterval(tick,look.tick)
  }
  if(v.recordId){
    const wrap=el('div','mp-ban-id'),code=el('code',undefined,v.recordId),copy=el('button','mp-ban-copy','复制')
    copy.type='button';copy.setAttribute('data-mp-ban','copy');copy.setAttribute('aria-live','polite')
    const flash=(text:string,state:string)=>{
      if(done)return
      copy.textContent=text;copy.setAttribute('data-state',state);clearTimeout(flashTimer)
      flashTimer=setTimeout(()=>{flashTimer=undefined;copy.textContent='复制';copy.removeAttribute('data-state')},1600)
    }
    // 剪贴板不可用（非安全上下文 / 被拒）时把记录号选中，长按或 Ctrl+C 即可
    const pick=()=>{try{const range=document.createRange(),sel=window.getSelection();range.selectNodeContents(code);sel?.removeAllRanges();sel?.addRange(range)}catch{/* 无选区 API */}}
    copy.onclick=()=>{
      const clip=typeof navigator==='undefined'?undefined:navigator.clipboard
      if(!clip?.writeText){pick();flash('已选中','selected');return}
      clip.writeText(v.recordId).then(()=>flash('已复制','copied'),()=>{pick();flash('已选中','selected')})
    }
    wrap.append(code,copy);row('record','记录',wrap)
  }

  const noteText=v.note||(v.recordId?'申诉会自动附上记录号。':'')
  const note=noteText?el('p','mp-ban-note',noteText):undefined
  const act=(text:string,key:string)=>{const node=el('button','mp-ban-act',text);node.type='button';node.setAttribute('data-mp-ban',key);return node}
  const appeal=act('申诉','appeal'),later=act('继续单人游览','continue')
  appeal.onclick=()=>{dialog.close();onAppeal(v.recordId||undefined)}
  later.onclick=()=>dialog.close()
  const primary=look.primary==='appeal'?appeal:later,secondary=primary===appeal?later:appeal
  primary.setAttribute('data-rank','primary');secondary.setAttribute('data-rank','secondary')
  const actions=el('div','mp-ban-actions');actions.append(secondary,primary)

  dialog.append(header,lede,sheet,...(note?[note]:[]),actions)
  dialog.addEventListener('close',dispose)
  current={dialog,dispose}
  document.body.append(dialog)
  try{dialog.showModal()}catch{dialog.setAttribute('open','')}
  primary.focus()
  return dialog
}
