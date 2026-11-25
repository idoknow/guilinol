import {record} from '../telemetry'
import {socialIcon} from './social-icon'
import './account.css'

// 账号：登录 / 注册（填写 → 邮箱验证 → 完成）/ 忘记密码 / 我的账号。
// Playing requires an account (IDOK-99): the title screen asks for a login before the city boots, see requireUser().
type Screen='login'|'register'|'verify'|'forgot'|'reset'|'profile'|'social'|'bindmail'|'choice'|'takeover'|'migrate'|'migrated'
export type SocialBinding={channel?:string;type:string;label:string;nickname:string;avatar:string;uid:string}
export type User={id:string,uid:number,email:string,nickname:string,notify_email:boolean;email_placeholder?:boolean;social?:SocialBinding[];migration?:{required?:boolean;blocking:boolean;deadline?:string|null;legacy?:string[];direct?:string[];options:string[]}}
const titles:Record<Screen,string>={login:'登录',register:'注册账号',verify:'验证邮箱',forgot:'忘记密码',reset:'重置密码',profile:'我的账号',social:'第三方账号',bindmail:'绑定邮箱',
  choice:'欢迎来到网上桂林',takeover:'把 QQ 转到这个账号？',migrate:'最后一步：绑定新版登录方式',migrated:'迁移完成'}
const submits:Record<Screen,string>={login:'登录',register:'注册账号',verify:'验证邮箱',forgot:'发送重置验证码',reset:'重置密码',profile:'保存设置',social:'确认',bindmail:'发送验证码',
  choice:'我是新玩家，创建账号',takeover:'转到当前账号',migrate:'',migrated:'进入游戏'}
async function api(path:string,method='GET',data?:object) {
  const response=await fetch(`/api/${path}`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
  const result=await response.json().catch(()=>{throw new Error('网络不太顺畅，请稍后再试')})
  if(!response.ok) throw Object.assign(new Error(result.error?.message??'请求失败，请重试'),{code:result.error?.code})
  return result
}


/* ── 第三方登录 ────────────────────────────────────────────────
   两条通道（IDOK-332）：
   - 新版 direct：我们自己的 QQ 互联 / 微信开放平台应用，按钮叫「QQ 登录」「微信登录」，是主入口；
   - 旧版 legacy：聚合登录 login.mapay.cn。迁移期（cutoff 之后）只给老账号登录用，叫「旧版 QQ」「旧版微信」，
     放在「老用户迁移入口」里；sunset 之后整个消失。
   没配新版、也没设日期时，界面和以前完全一样。 */
type SocialIntentForUi='login'|'bind'|'register'
type SocialOption={type:string;label:string}
type SocialPending={channel?:string;intent:string;takeover?:boolean;owner_created_at?:number|null;type:string;label:string;nickname:string;avatar:string}
type Phase='before'|'migrating'|'sunset'
let socialOptions:SocialOption[]|null=null
let directOptions:SocialOption[]=[]
const plan:{phase:Phase;cutoff:string|null;sunset:string|null;split:boolean}={phase:'before',cutoff:null,sunset:null,split:false}
let pendingSocial:SocialPending|null=null
let socialPhase:'send'|'code'='send'
let bindPhase:'send'|'code'='send',bindMigrate=false
async function loadSocialOptions(){
  if(socialOptions)return socialOptions
  try{
    const config=await api('auth/social/config')
    directOptions=[...(config.direct??[])].sort((a:SocialOption,b:SocialOption)=>socialRank(a.type)-socialRank(b.type))
    plan.phase=config.migration?.phase??'before';plan.cutoff=config.migration?.cutoff??null;plan.sunset=config.migration?.sunset??null
    // 迁移开始前旧版按钮保持原名（「QQ」「微信」），开始后才叫「旧版 QQ」并挪进迁移入口
    plan.split=plan.phase!=='before'
    socialOptions=plan.split?(config.legacy??[]).map((option:SocialOption)=>({...option,label:option.label.replace(/^旧版\s*/,'旧版').replace(/^旧版(?=[A-Za-z])/,'旧版 ')})):config.enabled??[]
  }catch{socialOptions=[]}
  socialOptions=[...(socialOptions??[])].sort((a,b)=>socialRank(a.type)-socialRank(b.type))
  return socialOptions
}
/** 「2026-12-05」→「12 月 5 日」（不是今年就带上年份）。 */
export function dayLabel(date:string|null|undefined){
  const match=date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)return ''
  const [,year,month,day]=match
  return `${Number(year)===new Date().getFullYear()?'':year+' 年 '}${Number(month)} 月 ${Number(day)} 日`
}
const unixDay=(seconds:number)=>{const date=new Date(seconds*1000+8*3600_000);return dayLabel(date.toISOString().slice(0,10))}
const directName=(type:string)=>type==='wx'?'微信':'QQ'
/** 新版主入口的名字（拿来写提示文案）：有 QQ 就说 QQ。 */
const primaryDirect=()=>directOptions[0]?directName(directOptions[0].type):'QQ'
type SocialTicket={url:string;at:number}
const tickets=new Map<string,SocialTicket>()
const TICKET_TTL=90_000
const ticketKey=(type:string,intent:SocialIntentForUi)=>`${intent}:${type}`
/** 面板一渲染就先把授权地址取回来，用户点按钮时可以直接跳，不必再等上游 1–3 秒。 */
// 每次 start 都会重写整条 glol_social（state 列表）cookie：QQ、微信并发预取时后回来的会把先回来的 state 顶掉，
// 点按钮回来就成了「授权已过期」。所以预取一个接一个排队。
let prefetchQueue:Promise<void>=Promise.resolve()
function prefetchSocial(type:string,intent:SocialIntentForUi){
  return prefetchQueue=prefetchQueue.then(()=>prefetchOne(type,intent))
}
async function prefetchOne(type:string,intent:SocialIntentForUi){
  const existing=tickets.get(ticketKey(type,intent))
  if(existing&&Date.now()-existing.at<TICKET_TTL)return
  try{
    const result=await api('auth/social/start','POST',{type,intent}) as {url?:string}
    if(result?.url)tickets.set(ticketKey(type,intent),{url:result.url,at:Date.now()})
  }catch{/* 预取失败就算了，点按钮时再走一次 */}
}
async function startSocial(type:string,intent:'login'|'bind'|'register'){
  if(intent!=='bind')store(PENDING_LOGIN_KEY,JSON.stringify({type,at:Date.now()}))
  await prefetchQueue
  const key=ticketKey(type,intent),cached=tickets.get(key)
  if(cached&&Date.now()-cached.at<TICKET_TTL){
    tickets.delete(key)
    location.assign(cached.url)
    return
  }
  const result=await api('auth/social/start','POST',{type,intent}) as {url?:string}
  const target=result?.url
  if(!target)throw new Error('没有拿到第三方跳转地址，请稍后再试')
  // 授权页有时加载很慢，看起来像卡死：4 秒后给一个可点的兜底链接
  window.setTimeout(()=>{
    const message=dialog?.querySelector<HTMLElement>('.acc-msg')
    if(!dialog?.open||!message)return
    const anchor=document.createElement('a')
    anchor.href=target;anchor.target='_blank';anchor.rel='noopener noreferrer'
    anchor.textContent='点这里打开授权页'
    message.replaceChildren(document.createTextNode('页面没有自动跳转？'),anchor)
    message.dataset.kind='info'
  },4000)
  location.assign(target)
}
/** 新版通道：拿授权地址直接跳。登录类的先记下「正在用新版 QQ」，回来成功后给按钮挂「上次登录」。 */
async function startDirect(type:string,intent:'login'|'bind'|'migrate'){
  if(intent==='login')store(PENDING_LOGIN_KEY,JSON.stringify({type:'direct:'+type,at:Date.now()}))
  const {url}=await api('auth/oauth/start','POST',{type,intent}) as {url?:string}
  if(!url)throw new Error('没有拿到 QQ 授权地址，请稍后再试')
  location.assign(url)
}
/* ── 本浏览器上次的登录方式（只存本地，用来在按钮角标上提示）──
   邮箱登录成功时直接记下；第三方要跳出站点，所以先记「正在用哪个」，回调成功后再转正。 */
type LoginMethod='email'|string
const LAST_LOGIN_KEY='glol.login.last',PENDING_LOGIN_KEY='glol.login.pending',PENDING_LOGIN_TTL=15*60_000
const store=(key:string,value:string|null)=>{try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value)}catch{/* 隐私模式 */}}
function lastLogin():LoginMethod|null{try{return localStorage.getItem(LAST_LOGIN_KEY)}catch{return null}}
const rememberLogin=(method:LoginMethod)=>store(LAST_LOGIN_KEY,method)
function settlePendingLogin(ok:boolean){
  let pending:{type?:string;at?:number}|null=null
  try{pending=JSON.parse(localStorage.getItem(PENDING_LOGIN_KEY)??'null')}catch{}
  store(PENDING_LOGIN_KEY,null)
  if(ok&&pending?.type&&Date.now()-(pending.at??0)<PENDING_LOGIN_TTL)rememberLogin(pending.type)
}
/** 第三方按钮的排序：QQ、微信永远在最前。 */
const SOCIAL_ORDER=['qq','wx']
const socialRank=(type:string)=>{const index=SOCIAL_ORDER.indexOf(type);return index<0?SOCIAL_ORDER.length:index}

async function loadPendingSocial(){
  pendingSocial=await api('auth/social/pending') as SocialPending
  socialPhase='send'
  return pendingSocial
}
/** ?social= 回跳的结果码 → 落在哪一屏、说什么。home = 已登录去「我的账号」（要迁移就去迁移面板），没登录去登录页。 */
type Note={screen:Screen|'home';text:()=>string;kind?:'ok'|'error'|'info'}
const socialNotes:Record<string,Note>={
  login:{screen:'home',text:()=>'已登录',kind:'ok'},
  bound:{screen:'home',text:()=>'绑定成功，以后可以直接用它登录这个账号',kind:'ok'},
  registered:{screen:'home',text:()=>'注册成功，欢迎来到网上桂林',kind:'ok'},
  legacy_closed:{screen:'login',kind:'error',text:()=>`这个账号不是${plan.cutoff?' '+dayLabel(plan.cutoff)+'前的':''}老账号，旧版入口已停止注册。新玩家请点「${primaryDirect()} 登录」。`},
  legacy_sunset:{screen:'login',kind:'error',text:()=>`旧版入口${plan.sunset?'已于 '+dayLabel(plan.sunset):'已'}关闭，请点「${primaryDirect()} 登录」。没来得及迁移的老账号，请进游戏后点「反馈」找回。`},
  already_bound:{screen:'home',kind:'error',text:()=>'这个 QQ 已经绑在别的账号上了，没有转过来。换一个 QQ，或点「反馈」说明情况，我们帮你核对。'},
  unbound:{screen:'login',text:()=>'该第三方账号还没有绑定账号：请先登录，再到「我的账号」里绑定'},
  unverified:{screen:'login',text:()=>'该账号还没有验证邮箱，请先用邮箱登录完成验证'},
  conflict:{screen:'login',kind:'error',text:()=>'该第三方账号已经绑定过其它账号了'},
  pending:{screen:'login',text:()=>'授权还没完成，请重新发起一次'},
  busy:{screen:'login',kind:'error',text:()=>'操作太频繁了，请稍后再试'},
  unavailable:{screen:'login',kind:'error',text:()=>'第三方登录服务暂时不可用，请稍后再试'},
  expired:{screen:'home',kind:'error',text:()=>'授权超时了（或是在别的浏览器里完成的），请在这里重新点一次。'},
  invalid:{screen:'login',kind:'error',text:()=>'授权参数不合法，请重新发起'},
  failed:{screen:'home',kind:'error',text:()=>'授权没有成功，请重新点一次；一直不行就点「反馈」告诉我们。'},
  disabled:{screen:'login',kind:'error',text:()=>'第三方登录暂未开放'},
}
let user:User|null=null
const listeners=new Set<(user:User|null)=>void>()
let cloudReady=Promise.resolve()
const setUser=(value:User|null)=>{
  user=value
  // 旧版通道登录的老账号：弹出不能关的「最后一步：绑定新版登录方式」
  if(value?.migration?.blocking)setTimeout(()=>{if(user===value)void showMigration()},0)
  if(value?.id || localStorage.getItem('glol.save.owner'))cloudReady=import('../game/cloud-session').then(module=>{
    if(user===value)return module.setCloudAccount(value?.id??null)
  }).catch(()=>{})
  for(const listen of listeners)listen(user)
}
let sessionUnknown=false
const refresh=()=>api('me').then(r=>{sessionUnknown=false;setUser(r&&typeof r.nickname==='string'?r:null)}).catch(error=>{
  sessionUnknown=error.code!=='unauthorized'
  if(!sessionUnknown)setUser(null)
})
const ready=refresh()
// IDOK-216: warm what the first click needs while the player reads the title screen — the login dialog's
// social buttons for guests, the avatar module + record for signed-in players — so entering is one wait, not four.
void ready.then(()=>{
  const warm=()=>{const owner=user?.id;if(owner)void import('./avatar-account').then(module=>module.prefetchAvatar(owner)).catch(()=>{});else void loadSocialOptions()}
  if('requestIdleCallback' in window)requestIdleCallback(warm,{timeout:1500});else setTimeout(warm,600)
})
window.addEventListener('online',()=>{if(sessionUnknown)void refresh()})
/** Subscribe to sign-in changes; called immediately with the current value once known. */
export function onUser(listen:(user:User|null)=>void){listeners.add(listen);void ready.then(()=>{if(listeners.has(listen))listen(user)});return ()=>listeners.delete(listen)}
export const initial=(name='')=>[...name.trim()][0]??'客'

/** 打开面板前最多等 1.2 秒把第三方配置取回来，让 QQ / 微信 按钮和面板一起出现。 */
const socialConfigSoon=()=>Promise.race([loadSocialOptions(),new Promise(resolve=>setTimeout(resolve,1200))])
type Kind='info'|'ok'|'error'
let dialog:HTMLDialogElement|undefined,render:((screen:Screen,note?:string,pass?:string,kind?:Kind)=>void)|undefined,shown:Screen='login'
let gate:((user:User|null)=>void)|undefined
/** 已登录去「我的账号」，必须迁移的去迁移面板，没登录去登录页。 */
const home=():Screen=>user?(user.migration?.blocking?'migrate':'profile'):'login'
export async function openAccount(){
  build();await Promise.all([ready,socialConfigSoon()]);render!(home());dialog!.showModal();if(!user)record('funnel',{step:'loginOpen'})
}
/** 迁移面板：已经停在迁移流程里（包括正在填邮箱）就不打断。 */
async function showMigration(){
  build();await socialConfigSoon()
  if(!user?.migration?.blocking)return
  if(!(dialog!.open&&(shown==='migrate'||shown==='bindmail'&&bindMigrate)))render!('migrate')
  if(!dialog!.open)dialog!.showModal()
}
/** Resolve with the signed-in user, opening the login dialog first if needed; null if the player closes it without signing in. */
async function signIn():Promise<User|null>{
  await ready;if(user)return user
  build();gate?.(null);await socialConfigSoon()
  return new Promise(resolve=>{gate=resolve;render!('login');dialog!.showModal();if(!user)record('funnel',{step:'loginOpen'})})
}

let firstSpawn=false
export function consumeCreatorSpawn(){const value=firstSpawn;firstSpawn=false;return value}
export async function requireUser(){
  const signedIn=await signIn()
  await cloudReady
  if(signedIn&&!firstSpawn)firstSpawn=await (await import('./avatar-account')).accountCharacter(signedIn.nickname,false,signedIn.id)
  return signedIn
}
export async function editCharacter(){
  if(user)await (await import('./avatar-account')).accountCharacter(user.nickname,true)
}

/** The in-game chip (top left): avatar initial + nickname, or 登录 for guests. */
export function accountEntry(parent:HTMLElement){
  const entry=document.createElement('button')
  entry.type='button';entry.className='account-entry';entry.setAttribute('aria-haspopup','dialog')
  onUser(value=>{entry.textContent=value?.nickname??'登录';entry.dataset.initial=value?initial(value.nickname):'';entry.toggleAttribute('data-guest',!value)})
  entry.textContent='登录';entry.dataset.initial='';entry.toggleAttribute('data-guest',true)
  entry.onclick=()=>void openAccount()
  parent.append(entry);return entry
}


/* 从第三方回调回来（?social=...）：直接在账号面板里把结果展示出来。 */
const bootSocial=new URLSearchParams(location.search).get('social')
if(bootSocial){
  const clean=new URL(location.href)
  clean.searchParams.delete('social')
  history.replaceState(null,'',clean.pathname+clean.search+clean.hash)
  void (async()=>{
    await ready
    build()
    await socialConfigSoon()
    dialog!.showModal()
    if(bootSocial==='new'||bootSocial==='takeover'||bootSocial==='confirm'){
      try{await loadPendingSocial();render!(bootSocial==='new'?'choice':bootSocial==='takeover'?'takeover':'social')}
      catch(error){render!(home(),'授权已过期，请重新点一次',undefined,'error')}
      return
    }
    if(bootSocial==='login'||bootSocial==='registered')settlePendingLogin(true)
    else if(bootSocial!=='bound'&&bootSocial!=='migrated')settlePendingLogin(false)
    if(bootSocial==='migrated'){render!('migrated');return}
    const notice=socialNotes[bootSocial]
    render!(notice?.screen==='home'?home():notice?.screen??'login',notice?.text()??'第三方登录未完成，请重新发起',undefined,notice?.kind??'error')
    record('funnel',{step:'loginOpen'})
  })()
}

function build(){
  if(dialog)return
  dialog=document.createElement('dialog');const d=dialog
  d.className='about-panel account';d.setAttribute('aria-labelledby','account-title')
  d.innerHTML=`<header><h2 id="account-title"></h2><button class="about-close" type="button">关闭</button></header>
    <p class="acc-banner" role="note" hidden></p>
    <div class="acc-tabs" role="tablist" aria-label="登录或注册"><button type="button" role="tab" data-to="login">登录</button><button type="button" role="tab" data-to="register">注册</button></div>
    <ol class="acc-steps" aria-label="注册进度"><li>填写信息</li><li>验证邮箱</li><li>完成</li></ol>
    <form class="acc-body" novalidate><p class="acc-lead"></p><div class="acc-who"></div><div class="acc-quick" hidden></div><div class="fields"></div><p class="acc-msg" role="status"></p>
      <button class="ui-btn ui-btn--seal ui-btn--block acc-submit" type="submit"></button><nav class="acc-links"></nav></form>
    <p class="acc-guest">还没有账号？ <button type="button" class="acc-join">注册一个</button>，一分钟就好</p>`
  const form=d.querySelector('form')!,fields=form.querySelector('.fields')!,nav=form.querySelector('nav')!,message=form.querySelector<HTMLElement>('.acc-msg')!,
    lead=form.querySelector('.acc-lead')!,quick=form.querySelector<HTMLElement>('.acc-quick')!,who=form.querySelector<HTMLElement>('.acc-who')!,submitButton=form.querySelector<HTMLButtonElement>('.acc-submit')!,
    tabs=Array.from(d.querySelectorAll<HTMLButtonElement>('[role=tab]')),steps=Array.from(d.querySelectorAll('.acc-steps li'))
  const banner=d.querySelector<HTMLElement>('.acc-banner')!
  let screen:Screen='login',email='',bindPassword='',busy=false,verificationPassword='',cooldown=0,cooldownTimer=0
  const note=(text:string,kind:Kind='info')=>{message.textContent=text;message.dataset.kind=kind}
  function field(name:string,label:string,type:string,auto:string,value='',hint=''){
    const wrapper=document.createElement('label'),input=document.createElement('input')
    wrapper.className='ui-field';wrapper.append(label);input.type=type;input.name=name;input.value=value;input.required=true;input.setAttribute('autocomplete',auto)
    if(name==='email')input.placeholder='name@example.com'
    if(name==='code'){input.inputMode='numeric';input.pattern='[0-9]{6}';input.maxLength=6;input.className='acc-code';input.placeholder='······'}
    if(name==='password'){input.minLength=8;input.maxLength=256}
    if(name==='nickname'){input.maxLength=32;input.placeholder='在游戏里显示的名字'}
    if(type==='password'){
      const row=document.createElement('span'),eye=document.createElement('button');row.className='acc-pass';eye.type='button';eye.className='acc-eye';eye.setAttribute('aria-label','显示明文')
      eye.onclick=()=>{const show=input.type==='password';input.type=show?'text':'password';eye.setAttribute('aria-label',show?'隐藏明文':'显示明文');eye.toggleAttribute('data-on',show)}
      row.append(input,eye);wrapper.append(row)
    }else wrapper.append(input)
    if(hint){const small=document.createElement('small');small.textContent=hint;wrapper.append(small)}
    fields.append(wrapper);return input
  }
  function link(title:string,run:()=>void){const button=document.createElement('button');button.type='button';button.className='ui-btn ui-btn--ghost';button.textContent=title;button.onclick=()=>{if(!busy)run()};nav.append(button);return button}
  async function submit(run:()=>Promise<void>){
    if(busy)return;busy=true;d.toggleAttribute('data-busy',true);note('请稍候…')
    try{await run()}catch(error){note(error instanceof Error?error.message:'请求失败，请重试','error')}finally{busy=false;d.toggleAttribute('data-busy',false)}
  }
  function resendLabel(button:HTMLButtonElement){button.textContent=cooldown>0?`重新发送（${cooldown}s）`:'重新发送';button.disabled=cooldown>0}
  function startCooldown(button:HTMLButtonElement){cooldown=60;resendLabel(button);clearInterval(cooldownTimer)
    cooldownTimer=window.setInterval(()=>{cooldown--;if(button.isConnected)resendLabel(button);if(cooldown<=0)clearInterval(cooldownTimer)},1000)}
  /** 上次登录角标：贴在按钮右上角的一枚小朱印。 */
  function lastBadge(target:HTMLElement){
    const badge=document.createElement('span');badge.className='acc-last';badge.textContent='上次登录'
    target.classList.add('has-last');target.append(badge)
    target.setAttribute('aria-description','本浏览器上次用的登录方式')
  }
  function socialButton(option:SocialOption,intent:SocialIntentForUi,quickStyle:boolean,text?:string){
    const button=document.createElement('button'),label=document.createElement('span')
    button.type='button';button.dataset.type=option.type
    button.className=quickStyle?'acc-sso':'ui-btn ui-btn--ghost acc-social-btn'
    const icon=socialIcon(option.type,quickStyle?28:18)
    if(icon)button.append(icon)
    else if(quickStyle){const mark=document.createElement('span');mark.className='acc-sso-mark';mark.textContent=initial(option.label);button.append(mark)}
    label.textContent=text??(quickStyle?option.label:`用${option.label}${intent==='bind'?'绑定':intent==='register'?'注册':'登录'}`)
    button.append(label)
    if(quickStyle)button.setAttribute('aria-label',`用${option.label}${intent==='register'?'注册':'登录'}`)
    button.onclick=()=>{if(!busy)void submit(async()=>{await startSocial(option.type,intent)})}
    button.onpointerenter=()=>void prefetchSocial(option.type,intent)
    button.onfocus=()=>void prefetchSocial(option.type,intent)
    void prefetchSocial(option.type,intent)
    return button
  }
  /** 新版通道按钮：QQ 互联官方样式（QQ 蓝底、白字、企鹅标），和旧版的宣纸按钮一眼就能分开。 */
  function directButton(option:SocialOption,intent:'login'|'bind'|'migrate',text:string,small=false){
    const button=document.createElement('button'),label=document.createElement('span')
    button.type='button';button.className=small?'acc-direct acc-direct--sm':'acc-direct';button.dataset.type=option.type
    const icon=socialIcon(option.type,small?20:26);if(icon)button.append(icon)
    label.textContent=text;button.append(label)
    button.onclick=()=>{if(!busy)void submit(()=>startDirect(option.type,intent))}
    return button
  }
  /** 登录 / 注册：第三方放在最上面，下面才是邮箱表单。
      - 没有新版：旧版 QQ、微信 两个大按钮并排（和以前一样）；
      - 新版已开、迁移没开始（审核期）：最上面加「QQ 登录」，旧版按钮原样留着；
      - 迁移期：「QQ 登录」是唯一的主按钮，旧版挪进下面单独的「老用户迁移入口」；
      - 停用后：只剩「QQ 登录」，加一句老账号怎么找回。 */
  function quickLogin(next:Screen,options:SocialOption[]){
    quick.replaceChildren();quick.hidden=true
    if(next!=='login'&&next!=='register')return
    const intent:SocialIntentForUi=next==='register'?'register':'login',last=lastLogin(),parts:HTMLElement[]=[]
    if(directOptions.length){
      const row=document.createElement('div');row.className='acc-direct-row'
      for(const option of directOptions){
        const button=directButton(option,'login',`${directName(option.type)} 登录`)
        if(next==='login'&&last==='direct:'+option.type)lastBadge(button)
        row.append(button)
      }
      parts.push(row)
    }
    if(options.length&&plan.split){
      if(next==='login'){
        const box=document.createElement('section'),head=document.createElement('h3'),text=document.createElement('p'),row=document.createElement('div')
        box.className='acc-legacy';box.setAttribute('aria-labelledby','acc-legacy-title');head.id='acc-legacy-title'
        head.textContent='老用户迁移入口'
        text.textContent=`${plan.cutoff?dayLabel(plan.cutoff)+'前':'以前'}用 QQ / 微信 玩过的账号从这里登录，再按提示绑定新版 ${primaryDirect()}，只需要做一次。`
        row.className='acc-legacy-row'
        for(const option of options){
          const button=socialButton(option,'login',false,option.label);button.className='acc-legacy-btn'
          if(last===option.type)lastBadge(button)
          row.append(button)
        }
        box.append(head,text,row);parts.push(box)
      }
    }else if(options.length){
      const row=document.createElement('div')
      row.className='acc-sso-row';row.dataset.count=String(Math.min(options.length,3))
      for(const option of options){
        const button=socialButton(option,intent,true)
        if(next==='login'&&last===option.type)lastBadge(button)
        row.append(button)
      }
      parts.push(row)
    }
    if(plan.phase==='sunset'&&next==='login'&&directOptions.length){
      const gone=document.createElement('p');gone.className='acc-legacy-gone'
      gone.textContent=`旧版 QQ / 微信 入口已${plan.sunset?'于 '+dayLabel(plan.sunset):''}关闭。没来得及迁移的老账号，可以先用「${primaryDirect()} 登录」进入游戏，再点「反馈」写上原来的昵称，我们帮你找回。`
      parts.push(gone)
    }
    if(!parts.length)return
    const or=document.createElement('p');or.className='acc-or';or.textContent=next==='register'?'或用邮箱注册':'或用邮箱登录'
    quick.append(...parts,or);quick.hidden=false
  }
  /** 「我的账号」里的绑定按钮：新版没绑就给「绑定新版 QQ」；旧版只在迁移开始前还能绑。 */
  async function socialButtons(next:Screen){
    const options=await loadSocialOptions()
    if(screen!==next||!d.open&&next!=='login'&&next!=='register')return
    if(next==='login'||next==='register'){quickLogin(next,options);return}
    const bound=user?.social??[],row=document.createElement('div')
    row.className='acc-social'
    for(const option of directOptions)
      if(!bound.some(item=>item.channel==='direct'&&item.type===option.type))row.append(directButton(option,'bind',`绑定新版 ${directName(option.type)}`,true))
    if(!plan.split){
      const legacy=new Set(bound.filter(item=>item.channel!=='direct').map(item=>item.type))
      for(const option of options.filter(option=>!legacy.has(option.type)))row.append(socialButton(option,'bind',false))
    }
    if(row.childElementCount&&nav.isConnected)nav.append(row)
  }
  /** 头像徽标：有头像用头像，没有就用平台图标 / 昵称首字。 */
  function avatarBadge(name:string,type?:string,avatar?:string){
    const badge=document.createElement('span'),letter=initial(name),platformIcon=type?socialIcon(type,28):null
    badge.className='acc-avatar';badge.textContent=letter
    if(platformIcon){badge.classList.add('acc-avatar--brand');badge.replaceChildren(platformIcon)}
    if(avatar){const image=document.createElement('img');image.alt='头像';image.referrerPolicy='no-referrer';image.loading='lazy'
      image.src=avatar
      image.onerror=()=>badge.replaceChildren(...(platformIcon?[platformIcon]:[document.createTextNode(letter)]))
      badge.replaceChildren(image)}
    return badge
  }
  function whoLine(badge:HTMLElement,title:string,sub:string){
    const info=document.createElement('div');info.innerHTML='<b></b><small></small>'
    info.querySelector('b')!.textContent=title;info.querySelector('small')!.textContent=sub
    who.append(badge,info)
  }
  /** 迁移完成后的一句话：以后点哪个按钮。 */
  function afterMigration(){
    const direct=user?.migration?.direct??(user?.social??[]).filter(item=>item.channel==='direct').map(item=>item.type)
    if(direct.length)return `以后直接点「${directName(direct.includes('qq')?'qq':direct[0])} 登录」，就能进到这个账号，存档、背包、昵称都在。`
    if(user&&!user.email_placeholder)return `以后用邮箱 ${user.email} 和密码登录，存档、背包、昵称都在。`
    return '存档、背包、昵称都在，旧版入口不用再点了。'
  }
  render=(next:Screen,text='',pass='',kind?:Kind)=>{
    verificationPassword=next==='verify'&&d.open?pass:''
    screen=next;shown=next;fields.replaceChildren();nav.replaceChildren();who.replaceChildren();quick.replaceChildren();quick.hidden=true
    if(next!=='bindmail')bindMigrate=false
    submitButton.classList.remove('has-last');submitButton.removeAttribute('aria-description');note(text,kind??(/成功|已登录|已保存|已重置|已退出/.test(text)?'ok':'info'))
    d.dataset.screen=next;d.querySelector('h2')!.textContent=titles[next];submitButton.textContent=submits[next]
    if(next==='bindmail')submitButton.textContent=bindPhase==='code'?(bindMigrate?'完成迁移':'确认绑定'):'发送验证码'
    if(next==='bindmail'&&bindMigrate)d.querySelector('h2')!.textContent='改用邮箱和密码登录'
    const pendingName=directName(pendingSocial?.type??'qq')
    if(next==='choice')d.querySelector('h2')!.textContent=`这个 ${pendingName} 还没有网上桂林账号`
    if(next==='takeover')d.querySelector('h2')!.textContent=`把 ${pendingName} 转到这个账号？`
    // 迁移面板不能关：只能绑定新方式，或退出登录
    const locked=!!user?.migration?.blocking&&(next==='migrate'||next==='bindmail'&&bindMigrate)
    d.toggleAttribute('data-locked',locked)
    for(const tab of tabs)tab.setAttribute('aria-selected',String(tab.dataset.to===next))
    d.querySelector('.acc-tabs')?.toggleAttribute('hidden',next==='social')
    const step=next==='register'?0:next==='verify'?1:-1
    steps.forEach((li,i)=>{li.classList.toggle('on',i===step);li.classList.toggle('done',i<step)})
    // 迁移期登录 / 注册页顶部常驻的提示条
    const migrating=plan.phase==='migrating'&&!!socialOptions?.length&&(next==='login'||next==='register')
    banner.hidden=!migrating
    if(migrating){
      const head=document.createElement('b')
      head.textContent=`${plan.cutoff?dayLabel(plan.cutoff)+'前':'以前'}用 QQ 或微信登录过的玩家：`
      banner.replaceChildren(head,`请点下方「老用户迁移入口」登录，再按提示绑定新版 ${primaryDirect()}，存档、背包、昵称都会完整保留。${plan.sunset?`旧版入口 ${dayLabel(plan.sunset)}关闭。`:''}`)
    }
    const direct=directOptions.length>0,since=plan.cutoff?dayLabel(plan.cutoff)+'前':'以前'
    lead.textContent={
      login:direct?(plan.split?'':`登录后即可进入游玩。`):socialOptions?.length?'登录即可进入游玩，QQ / 微信 首次登录会自动建号。':'登录后即可进入游玩。提交的反馈有回复时，也会发邮件告诉你。',
      register:direct?`新玩家点「${primaryDirect()} 登录」就能一键注册；也可以只用邮箱和一个昵称。`:socialOptions?.length?'QQ / 微信 一键注册；也可以只用邮箱和一个昵称。':'只需要邮箱和一个昵称，一分钟就好。',
      verify:`六位验证码已发到 ${email||'你的邮箱'}，10 分钟内有效。没收到可以看看垃圾邮件。`,forgot:'输入注册时用的邮箱，我们会发一个六位验证码给你。',
      reset:'输入邮箱里的验证码，再设一个新密码。',profile:'',
      social:pendingSocial?.intent==='register'?(socialPhase==='code'?`验证码已发到 ${email}，10 分钟内有效。`:'邮箱和密码都可以留空：留空就直接用这个第三方账号注册；填了就要收验证码。'):'',
      bindmail:bindPhase==='code'?`验证码已发到 ${email}，10 分钟内有效。`:bindMigrate?'填一个常用邮箱并设置密码，收到验证码确认后，以后就用它们登录这个账号。':'给这个账号补一个邮箱，之后也能用邮箱密码登录。',
      choice:socialOptions?.length
        ?`第一次来就直接创建账号。${since}玩过的老玩家，请点下面去「老用户迁移入口」找回原来的存档——在这里新建会是一个空账号。`
        :`第一次来就直接创建账号。${since}的老账号如果没来得及迁移，进游戏后点「反馈」写上原来的昵称，我们帮你找回。`,
      takeover:pendingSocial?`这个 ${pendingName} 绑在 ${pendingSocial.owner_created_at?unixDay(pendingSocial.owner_created_at)+' ':''}新建的另一个账号上。转到当前账号「${user?.nickname??''}」？那个新账号会保留，但不再能用这个 ${pendingName} 登录。`:'',
      migrate:`旧版 QQ / 微信 登录${plan.sunset?`将于 ${dayLabel(plan.sunset)}停用`:'即将停用'}。绑定后，以后直接点「${primaryDirect()} 登录」就能进到这个账号，存档、背包、昵称都不变。`,
      migrated:afterMigration(),
    }[next]
    if(next==='social'&&pendingSocial)whoLine(avatarBadge(pendingSocial.nickname,pendingSocial.type,pendingSocial.avatar),`${pendingSocial.label} · ${pendingSocial.nickname||'（无昵称）'}`,
      {login:'确认后即可登录已绑定的账号',bind:'确认后把它绑定到当前账号',register:'还需要绑定邮箱并设置密码，才完成注册'}[pendingSocial.intent]??'')
    if((next==='choice'||next==='takeover')&&pendingSocial)whoLine(avatarBadge(pendingSocial.nickname,pendingSocial.type,pendingSocial.avatar),
      pendingSocial.nickname||'（无昵称）',next==='choice'?`${pendingName} 授权成功 · 还没有账号`:`${pendingName} 授权成功 · 已绑在另一个账号上`)
    if((next==='profile'||next==='migrate'||next==='migrated')&&user){
      const badge=avatarBadge(user.nickname);if(next==='migrated')badge.classList.add('acc-avatar--done')
      whoLine(badge,user.nickname,next==='profile'?(user.email_placeholder?'主账号：未绑定邮箱（仅第三方登录）':`主账号：${user.email}`)
        :next==='migrate'?'当前账号 · 通过旧版入口登录':'已绑定新的登录方式')}
    if(next==='social'){
      submitButton.textContent=pendingSocial?.intent==='register'
        ? (socialPhase==='code'?'完成注册':'发送验证码')
        : pendingSocial?.intent==='bind'?'确认绑定':'确认登录'
    }
    if(next==='social'&&pendingSocial?.intent==='register'&&socialPhase==='code')field('code','六位验证码','text','one-time-code')
    else if(next==='social'&&pendingSocial?.intent==='register'){
      // 邮箱和密码都是可选的：不填就直接用第三方注册
      field('email','邮箱（可选）','email','email',email).required=false
      field('password','密码（可选，至少 8 位）','password','new-password').required=false
      field('nickname','昵称','text','nickname',pendingSocial.nickname)
      const hint=document.createElement('small');hint.className='acc-bind-empty'
      hint.textContent='都留空 = 直接用第三方账号注册，不需要邮箱和密码；填了邮箱就要收验证码。'
      fields.append(hint)
    }
    if(next==='bindmail'){
      if(bindPhase==='code')field('code','六位验证码','text','one-time-code')
      else{field('email','邮箱','email','email',email);const password=field('password',bindMigrate?'密码（至少 8 位）':'密码（可选，至少 8 位）','password','new-password');password.required=bindMigrate}
    }
    if(!['profile','social','bindmail','choice','takeover','migrate','migrated'].includes(next))field('email','邮箱','email','email',email).readOnly=next==='verify'&&!!email
    if(next==='verify'||next==='reset')field('code','六位验证码','text','one-time-code')
    if(next==='register'||next==='login'||next==='reset')field('password',next==='login'?'密码':'密码（至少 8 位）','password',next==='login'?'current-password':'new-password')
    if(next==='register'||next==='profile')field('nickname','昵称','text','nickname',user?.nickname,next==='register'?'以后可以在「我的账号」里修改':'')
    if(next==='profile'){const label=document.createElement('label'),toggle=document.createElement('input');label.className='acc-check';toggle.type='checkbox';toggle.name='notify_email';toggle.checked=!!user?.notify_email
      label.append(toggle,'反馈有回复时发邮件提醒我');fields.append(label)
      const bound=user?.social??[],list=document.createElement('div');list.className='acc-bindings'
      const heading=document.createElement('small');heading.className='acc-bind-title'
      heading.textContent=user?.email_placeholder?'第三方登录方式（当前账号没有邮箱）':'第三方登录方式（主账号仍是上面的邮箱）';list.append(heading)
      if(!bound.length){const empty=document.createElement('small');empty.className='acc-bind-empty'
        empty.textContent=direct?`还没有绑定，绑定后可以用「${primaryDirect()} 登录」直接进这个账号`:'还没有绑定，绑定后可以用 QQ / 微信 直接登录这个账号';list.append(empty)}
      const tagged=direct||plan.split
      for(const item of bound){
        const row=document.createElement('div'),name=document.createElement('span'),state=document.createElement('span'),old=item.channel==='legacy'&&tagged
        const base=item.label.replace('（旧版）','')
        row.className='acc-bind-row';name.className='acc-bind-name';row.toggleAttribute('data-legacy',old)
        name.textContent=`${old?`${base}（旧版${plan.sunset?`，${dayLabel(plan.sunset)}停用`:''}）`:base} · ${item.nickname||'（无昵称）'}`
        state.className='acc-bind-state';state.textContent=old&&plan.phase==='sunset'?'已停用':'已绑定'
        const icon=socialIcon(item.type,20)
        row.append(...(icon?[icon]:[]),name,state);list.append(row)
      }
      // 有邮箱、但只剩旧版绑定：不强制，只提醒一句
      if(plan.phase==='migrating'&&!user?.email_placeholder&&bound.some(item=>item.channel==='legacy')&&!bound.some(item=>item.channel==='direct')){
        const tip=document.createElement('p');tip.className='acc-bind-tip'
        tip.textContent=`旧版 QQ / 微信 登录${plan.sunset?` ${dayLabel(plan.sunset)}`:'即将'}停用。你照样可以用邮箱登录${direct?`；想继续一键登录，点下面「绑定新版 ${primaryDirect()}」`:''}。`
        list.append(tip)
      }
      fields.append(list)}
    if(next==='migrate'&&user){
      const box=document.createElement('div');box.className='acc-migrate-options'
      for(const type of user.migration?.options??[]){
        if(type==='email'){
          const button=document.createElement('button');button.type='button';button.className='ui-btn ui-btn--ghost ui-btn--block acc-migrate-email'
          button.textContent='改用邮箱和密码登录';button.onclick=()=>{if(!busy){bindMigrate=true;bindPhase='send';render!('bindmail')}}
          box.append(button);continue
        }
        const option=directOptions.find(item=>item.type===type)??{type,label:directName(type)}
        box.append(directButton(option,'migrate',type==='qq'?'绑定新版 QQ':'绑定微信'))
      }
      quick.append(box);quick.hidden=false
    }
    if(next==='choice'&&socialOptions?.length){
      const old=document.createElement('button');old.type='button';old.className='ui-btn ui-btn--ghost ui-btn--block acc-choice-old'
      old.textContent=`我${plan.cutoff?' '+dayLabel(plan.cutoff)+'前':'以前'}玩过 → 去老用户迁移入口`
      old.onclick=()=>void submit(async()=>{
        const result=await api('auth/social/confirm','POST',{choice:'legacy'}) as {type?:string}
        const legacy=socialOptions?.find(option=>option.type===result.type)??socialOptions?.[0]
        if(!legacy){pendingSocial=null;render!('login','旧版入口已关闭，请用「QQ 登录」',undefined,'error');return}
        pendingSocial=null;await startSocial(legacy.type,'login')
      })
      nav.before(old)
    }
    if(next==='profile')link('修改外形',()=>submit(async()=>{await editCharacter()}))
    if(next==='profile')link('我的背包',()=>location.assign('/backpack.html'))
    if(next==='profile'&&user?.email_placeholder)link('绑定邮箱',()=>{bindPhase='send';bindMigrate=false;render!('bindmail')})
    if(next==='login'||next==='register'||next==='profile')void socialButtons(next)
    if(next==='login'&&lastLogin()==='email')lastBadge(submitButton)
    if(next==='social'||next==='choice')link('取消',()=>{pendingSocial=null;render!(home())})
    if(next==='takeover')link('先不转',()=>{pendingSocial=null;render!(home())})
    if(next==='bindmail'&&bindMigrate)link('返回',()=>{bindPhase='send';render!('migrate')})
    if(next==='login')link('忘记密码？',()=>render!('forgot'))
    else if(next==='profile'||next==='migrate')link('退出登录',()=>submit(async()=>{await api('auth/logout','POST');setUser(null);render!('login','已退出登录')}))
    else if(!['register','choice','takeover','migrated','social'].includes(next)&&!(next==='bindmail'&&bindMigrate))link(next==='bindmail'?'返回':'返回登录',()=>render!(next==='bindmail'?home():'login'))
    if(next==='verify'||next==='reset'){const resend=link('重新发送',()=>submit(async()=>{
      const input=form.elements.namedItem('email');await api('auth/resend','POST',{email:input instanceof HTMLInputElement?input.value:email,purpose:next==='verify'?'verify':'reset'});note('验证码已重新发送，请查收','ok');startCooldown(resend)}))
      resendLabel(resend)}
    // 有 QQ / 微信 按钮时不抢焦点到邮箱框（手机上会直接弹键盘，把首选的一键登录挤下去）
    requestAnimationFrame(()=>quick.hidden?fields.querySelector<HTMLInputElement>('input:not([readonly])')?.focus()
      :quick.querySelector<HTMLButtonElement>('.acc-direct,.acc-sso')?.focus({focusVisible:false} as FocusOptions))
  }
  for(const tab of tabs)tab.onclick=()=>{if(!busy&&tab.dataset.to!==screen)render!(tab.dataset.to as Screen)}
  form.onsubmit=event=>{event.preventDefault()
    const invalid=Array.from(form.querySelectorAll<HTMLInputElement>('input')).find(input=>!input.checkValidity())
    if(invalid){const label=invalid.closest('label')?.firstChild?.textContent??'';note(invalid.value?`${label}格式不对，请检查一下`:`请填写${label.replace(/（.*）/,'')}`,'error');invalid.focus();return}
    void submit(async()=>{
    const data:Record<string,string>={};new FormData(form).forEach((value,key)=>{data[key]=String(value)});if(data.email)email=data.email
    if(screen==='migrated'){d.close();return}
    if(screen==='choice'){
      if(!pendingSocial)throw new Error('授权已过期，请重新点一次「QQ 登录」')
      await api('auth/social/confirm','POST',{choice:'register'})
      pendingSocial=null;settlePendingLogin(true)
      setUser(await api('me') as User)
      d.close();window.dispatchEvent(new Event('glol:registered'))
      return
    }
    if(screen==='takeover'){
      if(!pendingSocial)throw new Error('授权已过期，请重新发起')
      await api('auth/social/confirm','POST',{takeover:true})
      pendingSocial=null;setUser(await api('me') as User);render!('migrated');return
    }
    if(screen==='social'){
      if(!pendingSocial)throw new Error('授权已过期，请重新发起')
      if(pendingSocial.intent==='register'){
        const payload:Record<string,string>={email:data.email??'',password:data.password??'',nickname:data.nickname??pendingSocial.nickname}
        if(socialPhase==='code')payload.code=data.code??''
        const result=await api('auth/social/register','POST',payload) as {needs_code?:boolean;email?:string;nickname?:string}
        if(result.needs_code){
          email=payload.email;socialPhase='code'
          render!('social',`验证码已发到 ${email}，10 分钟内有效`)
          return
        }
        settlePendingLogin(true)
        setUser(await api('me') as User)
        d.close();window.dispatchEvent(new Event('glol:registered'))
        return
      }
      const result=await api('auth/social/confirm','POST',{}) as {intent?:string}
      if(result.intent==='login'){
        settlePendingLogin(true)
        setUser(await api('me') as User)
        render!(home(),home()==='migrate'?'':'已通过第三方账号登录')
        return
      }
      setUser(await api('me') as User)
      render!('profile','第三方账号已绑定')
      return
    }
    if(screen==='bindmail'){
      // 第二步只有验证码一栏：邮箱和密码沿用第一步填的（之前这里会发空邮箱，验证必失败）
      if(bindPhase==='send')bindPassword=data.password??''
      const payload:Record<string,string|boolean>={email:bindPhase==='code'?email:data.email??'',password:bindPassword,...(bindMigrate?{migrate:true}:{})}
      if(bindPhase==='code')payload.code=data.code??''
      const result=await api('auth/email/bind','POST',payload) as {needs_code?:boolean;email?:string;redirect?:string}
      if(result.needs_code){bindPhase='code';render!('bindmail',`验证码已发到 ${result.email}，10 分钟内有效`);return}
      bindPhase='send';bindPassword='';setUser(await api('me') as User)
      if(bindMigrate){render!('migrated');return}
      render!('profile','邮箱已绑定，之后也能用邮箱登录');return
    }
    if(screen==='profile'){setUser(await api('me','PATCH',{...data,notify_email:!!data.notify_email}));render!('profile','账号设置已保存');return}
    if(screen==='forgot'){await api('auth/resend','POST',{email,purpose:'reset'});render!('reset','如邮箱已注册，请查收验证码');return}
    const previous=screen
    if(previous==='verify') data.password=verificationPassword
    let result
    try {result=await api(`auth/${screen}`,'POST',data);if(screen==='login'||screen==='verify')rememberLogin('email');if(screen==='login')record('funnel',{step:'loginSuccess'})} catch(error){if((error as {code?:string}).code==='unverified'){render!('verify','请先验证邮箱再登录',data.password);return}throw error}
    // 登录/验证的响应里没有第三方绑定信息，补一次 me 让「我的账号」直接显示已绑定平台
    if(previous==='login'||previous==='verify'){try{result=await api('me')}catch{}}
    if(previous==='register')render!('verify','',data.password)
    else if(previous==='reset')render!('login','密码已重置，请重新登录')
    else {setUser(result);if(gate){const resolve=gate;gate=undefined;d.close();resolve(result);return}
      if(previous==='verify'){
        d.close();await cloudReady;firstSpawn=await (await import('./avatar-account')).accountCharacter(result.nickname)
        window.dispatchEvent(new Event('glol:registered'))
        return
      }
      render!('profile','已登录')}
  })}
  d.querySelector('header button')!.addEventListener('click',()=>{if(!d.hasAttribute('data-locked'))d.close()})
  d.addEventListener('cancel',event=>{if(d.hasAttribute('data-locked'))event.preventDefault()})
  d.querySelector('.acc-join')!.addEventListener('click',()=>{if(!busy)render!('register')})
  d.addEventListener('close',()=>{if(d.hasAttribute('data-locked')&&user?.migration?.blocking){queueMicrotask(()=>{if(!d.open)d.showModal()});return}
    verificationPassword='';form.reset();const resolve=gate;gate=undefined;resolve?.(user)})
  d.addEventListener('click',event=>{if(event.target===d&&!d.hasAttribute('data-locked'))d.close()})
  for(const type of ['keydown','keyup'])d.addEventListener(type,event=>event.stopPropagation())
  document.body.append(d)
}
