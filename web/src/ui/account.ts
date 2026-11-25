import {record} from '../telemetry'
import {socialIcon} from './social-icon'
import './account.css'

// 账号：登录 / 注册（填写 → 邮箱验证 → 完成）/ 忘记密码 / 我的账号。
// Playing requires an account (IDOK-99): the title screen asks for a login before the city boots, see requireUser().
type Screen='login'|'register'|'verify'|'forgot'|'reset'|'profile'|'social'|'bindmail'
export type SocialBinding={channel?:string;type:string;label:string;nickname:string;avatar:string;uid:string}
export type User={id:string,uid:number,email:string,nickname:string,notify_email:boolean;email_placeholder?:boolean;social?:SocialBinding[];migration?:{blocking:boolean;options:string[]}}
const titles:Record<Screen,string>={login:'登录',register:'注册账号',verify:'验证邮箱',forgot:'忘记密码',reset:'重置密码',profile:'我的账号',social:'第三方账号',bindmail:'绑定邮箱'}
const submits:Record<Screen,string>={login:'登录',register:'注册账号',verify:'验证邮箱',forgot:'发送重置验证码',reset:'重置密码',profile:'保存设置',social:'确认',bindmail:'发送验证码'}
async function api(path:string,method='GET',data?:object) {
  const response=await fetch(`/api/${path}`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
  const result=await response.json().catch(()=>{throw new Error('网络不太顺畅，请稍后再试')})
  if(!response.ok) throw Object.assign(new Error(result.error?.message??'请求失败，请重试'),{code:result.error?.code})
  return result
}


/* ── 第三方（聚合登录）────────────────────────────────────────────
   账号一律是 uuid：第三方首次登录/注册直接建号，邮箱可选（没邮箱时用占位地址，
   之后可在「我的账号 → 绑定邮箱」补上；重复账号在后台用户详情里合并）。 */
type SocialIntentForUi='login'|'bind'|'register'
type SocialOption={type:string;label:string}
type SocialPending={intent:'login'|'bind'|'register';type:string;label:string;nickname:string;avatar:string}
let socialOptions:SocialOption[]|null=null
let directOptions:SocialOption[]=[],legacyPhase='before',legacyCutoff:string|null=null
let pendingSocial:SocialPending|null=null
let socialPhase:'send'|'code'='send'
let bindPhase:'send'|'code'='send'
async function loadSocialOptions(){
  if(socialOptions)return socialOptions
  try{const config=await api('auth/social/config');directOptions=config.direct??[];legacyPhase=config.migration?.phase??'before';legacyCutoff=config.migration?.cutoff??null;socialOptions=config.legacy??config.enabled??[]}catch{socialOptions=[]}
  socialOptions=[...(socialOptions??[])].sort((a,b)=>socialRank(a.type)-socialRank(b.type))
  return socialOptions
}
type SocialTicket={url:string;at:number}
const tickets=new Map<string,SocialTicket>()
const TICKET_TTL=90_000
const ticketKey=(type:string,intent:SocialIntentForUi)=>`${intent}:${type}`
/** 面板一渲染就先把授权地址取回来，用户点按钮时可以直接跳，不必再等上游 1–3 秒。 */
async function prefetchSocial(type:string,intent:SocialIntentForUi){
  const existing=tickets.get(ticketKey(type,intent))
  if(existing&&Date.now()-existing.at<TICKET_TTL)return
  try{
    const result=await api('auth/social/start','POST',{type,intent}) as {url?:string}
    if(result?.url)tickets.set(ticketKey(type,intent),{url:result.url,at:Date.now()})
  }catch{/* 预取失败就算了，点按钮时再走一次 */}
}
async function startSocial(type:string,intent:'login'|'bind'|'register'){
  if(intent!=='bind')store(PENDING_LOGIN_KEY,JSON.stringify({type,at:Date.now()}))
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
const socialNotes:Record<string,{screen:Screen;text:string;ok?:boolean}>={
  migrated:{screen:'profile',text:'迁移完成'},already_bound:{screen:'profile',text:'该身份已绑定其他账号'},legacy_sunset:{screen:'login',text:'旧版通道已停用'},legacy_closed:{screen:'login',text:'旧版通道仅供已有账号登录'},
  login:{screen:'profile',text:'已通过第三方账号登录',ok:true},
  bound:{screen:'profile',text:'第三方账号已绑定',ok:true},
  registered:{screen:'profile',text:'注册成功，第三方账号已绑定',ok:true},
  unbound:{screen:'login',text:'该第三方账号还没有绑定账号：请先登录，再到「我的账号」里绑定'},
  unverified:{screen:'login',text:'该账号还没有验证邮箱，请先用邮箱登录完成验证'},
  conflict:{screen:'login',text:'该第三方账号已经绑定过其它账号了'},
  pending:{screen:'login',text:'授权还没完成，请重新发起一次'},
  busy:{screen:'login',text:'操作太频繁了，请稍后再试'},
  unavailable:{screen:'login',text:'第三方登录服务暂时不可用，请稍后再试'},
  expired:{screen:'login',text:'授权已过期，请重新发起'},
  invalid:{screen:'login',text:'授权参数不合法，请重新发起'},
  failed:{screen:'login',text:'第三方授权失败，请重新发起'},
  disabled:{screen:'login',text:'第三方登录暂未开放'},
}

let user:User|null=null
const listeners=new Set<(user:User|null)=>void>()
let cloudReady=Promise.resolve()
const setUser=(value:User|null)=>{
  user=value
  if(value?.migration?.blocking) setTimeout(()=>{if(user===value && !document.querySelector('[data-oauth-panel]'))migrationPanel(value)},0)
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
let dialog:HTMLDialogElement|undefined,render:((screen:Screen,note?:string,pass?:string)=>void)|undefined
let gate:((user:User|null)=>void)|undefined
export async function openAccount(){
  build();await Promise.all([ready,socialConfigSoon()]);render!(user?'profile':'login');dialog!.showModal();if(!user)record('funnel',{step:'loginOpen'})
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
    dialog!.showModal()
    if(bootSocial==='new'||bootSocial==='takeover'){await loadSocialOptions();decisionPanel(bootSocial);return}
    if(bootSocial==='confirm'){
      try{await loadPendingSocial();render!('social')}
      catch(error){render!('login',error instanceof Error?error.message:'授权已过期，请重新发起')}
      return
    }
    if(bootSocial==='login'||bootSocial==='registered')settlePendingLogin(true)
    else if(bootSocial!=='bound')settlePendingLogin(false)
    if(bootSocial==='login'){try{setUser(await api('me') as User)}catch{}}
    const notice=socialNotes[bootSocial]
    render!(notice?.screen??'login',notice?.text??'第三方登录未完成，请重新发起')
    record('funnel',{step:'loginOpen'})
  })()
}

async function startDirect(type:string,intent:string){location.assign((await api('auth/oauth/start','POST',{type,intent})).url)}
function actionPanel(title:string){
  const panel=document.createElement('dialog'),message=document.createElement('p')
  panel.dataset.oauthPanel='';panel.setAttribute('aria-label',title);panel.append(document.createTextNode(title),message)
  panel.oncancel=event=>event.preventDefault();document.body.append(panel);panel.showModal()
  function button(label:string,action:()=>Promise<void>){const item=document.createElement('button');item.type='button';item.textContent=label;item.onclick=async()=>{item.disabled=true;try{await action()}catch(error){message.textContent=error instanceof Error?error.message:'操作失败'}finally{item.disabled=false}};panel.append(item)}
  return {panel,message,button}
}
function decisionPanel(reason:string){
  const {button}=actionPanel(reason==='new'?'此身份还没有账号':'此身份已绑定另一个账号。确认转移到当前账号？')
  const decide=(body:object)=>api('auth/social/confirm','POST',body)
  if(reason==='new'){
    button('我是新玩家',async()=>location.assign((await decide({choice:'register'})).redirect))
    if(socialOptions?.length)button(`我${legacyCutoff?'在 '+legacyCutoff+' 前':''}玩过`,async()=>{const {type}=await decide({choice:'legacy'});if(socialOptions?.some(option=>option.type===type))await startSocial(type,'login');else location.assign('/')})
  }else button('确认转移',async()=>location.assign((await decide({takeover:true})).redirect))
  button('返回',async()=>location.assign('/'))
}
function migrationPanel(account:User){
  const {panel,message,button}=actionPanel('请绑定新版登录方式或邮箱，以保留账号访问权')
  for(const type of account.migration!.options){
    if(type!=='email'){button(type==='qq'?'新版 QQ':'新版微信',()=>startDirect(type,'migrate'));continue}
    button('绑定邮箱和密码',async()=>{
      panel.replaceChildren(message);message.textContent='验证邮箱并设置密码'
      const input=(label:string,type:string)=>{const element=document.createElement('input');element.type=type;element.placeholder=label;element.setAttribute('aria-label',label);panel.append(element);return element}
      const email=input('邮箱','email'),password=input('密码（至少 8 位）','password'),code=input('验证码','text')
      const bind=(verify:boolean)=>api('auth/email/bind','POST',{email:email.value,password:password.value,migrate:true,...(verify?{code:code.value}:{})})
      button('发送验证码',async()=>{await bind(false);message.textContent='请查收验证码'})
      button('完成迁移',async()=>{if(!/^\d{6}$/.test(code.value))throw Error('请输入六位验证码');location.assign((await bind(true)).redirect)})
    })
  }
}

function build(){
  if(dialog)return
  dialog=document.createElement('dialog');const d=dialog
  d.className='about-panel account';d.setAttribute('aria-labelledby','account-title')
  d.innerHTML=`<header><h2 id="account-title"></h2><button class="about-close" type="button">关闭</button></header>
    <div class="acc-tabs" role="tablist" aria-label="登录或注册"><button type="button" role="tab" data-to="login">登录</button><button type="button" role="tab" data-to="register">注册</button></div>
    <ol class="acc-steps" aria-label="注册进度"><li>填写信息</li><li>验证邮箱</li><li>完成</li></ol>
    <form class="acc-body" novalidate><p class="acc-lead"></p><div class="acc-who"></div><div class="acc-quick" hidden></div><div class="fields"></div><p class="acc-msg" role="status"></p>
      <button class="ui-btn ui-btn--seal ui-btn--block acc-submit" type="submit"></button><nav class="acc-links"></nav></form>
    <p class="acc-guest">还没有账号？ <button type="button" class="acc-join">注册一个</button>，一分钟就好</p>`
  const form=d.querySelector('form')!,fields=form.querySelector('.fields')!,nav=form.querySelector('nav')!,message=form.querySelector<HTMLElement>('.acc-msg')!,
    lead=form.querySelector('.acc-lead')!,quick=form.querySelector<HTMLElement>('.acc-quick')!,who=form.querySelector<HTMLElement>('.acc-who')!,submitButton=form.querySelector<HTMLButtonElement>('.acc-submit')!,
    tabs=Array.from(d.querySelectorAll<HTMLButtonElement>('[role=tab]')),steps=Array.from(d.querySelectorAll('.acc-steps li'))
  let screen:Screen='login',email='',busy=false,verificationPassword='',cooldown=0,cooldownTimer=0
  const note=(text:string,kind:'info'|'ok'|'error'='info')=>{message.textContent=text;message.dataset.kind=kind}
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
  function socialButton(option:SocialOption,intent:SocialIntentForUi,quickStyle:boolean){
    const button=document.createElement('button'),label=document.createElement('span')
    button.type='button';button.dataset.type=option.type
    button.className=quickStyle?'acc-sso':'ui-btn ui-btn--ghost acc-social-btn'
    const icon=socialIcon(option.type,quickStyle?28:18)
    if(icon)button.append(icon)
    else if(quickStyle){const mark=document.createElement('span');mark.className='acc-sso-mark';mark.textContent=initial(option.label);button.append(mark)}
    label.textContent=quickStyle?option.label:`用${option.label}${intent==='bind'?'绑定':intent==='register'?'注册':'登录'}`
    button.append(label)
    if(quickStyle)button.setAttribute('aria-label',`用${option.label}${intent==='register'?'注册':'登录'}`)
    button.onclick=()=>{if(!busy)void submit(async()=>{await startSocial(option.type,intent)})}
    button.onpointerenter=()=>void prefetchSocial(option.type,intent)
    button.onfocus=()=>void prefetchSocial(option.type,intent)
    void prefetchSocial(option.type,intent)
    return button
  }
  /** 登录 / 注册：QQ、微信放在最上面，大按钮并排；下面才是邮箱表单。 */
  function quickLogin(next:Screen,options:SocialOption[]){
    quick.replaceChildren();quick.hidden=true
    if(next!=='login'&&next!=='register'||!options.length)return
    const intent:SocialIntentForUi=next==='register'?'register':'login',row=document.createElement('div'),last=lastLogin()
    row.className='acc-sso-row';row.dataset.count=String(Math.min(options.length,3))
    for(const option of options){
      const button=socialButton(option,intent,true)
      if(next==='login'&&last===option.type)lastBadge(button)
      row.append(button)
    }
    const or=document.createElement('p');or.className='acc-or';or.textContent=next==='register'?'或用邮箱注册':'或用邮箱登录'
    quick.append(row,or);quick.hidden=false
  }
  async function socialButtons(next:Screen){
    await loadSocialOptions()
    if(screen!==next)return
    for(const option of directOptions){if(next==='profile'&&user?.social?.some(item=>item.channel==='direct'&&item.type===option.type))continue;link(option.label,()=>void submit(()=>startDirect(option.type,next==='profile'?'bind':'login')))}
    if(next!=='login'&&legacyPhase!=='before')return
    if(next==='login'||next==='register'){
      if(socialOptions){quickLogin(next,socialOptions);return}
      const options=await loadSocialOptions()
      if(d.open&&screen===next)quickLogin(next,options)
      return
    }
    const options=await loadSocialOptions()
    if(!options.length||!d.open||screen!==next)return
    const bound=new Set((user?.social??[]).filter(item=>item.channel!=='direct').map(item=>item.type)),
      visible=options.filter(option=>!bound.has(option.type)),
      row=document.createElement('div')
    row.className='acc-social'
    if(!visible.length)return
    for(const option of visible)row.append(socialButton(option,'bind',false))
    if(nav.isConnected)nav.append(row)
  }
  render=(next:Screen,text='',pass='')=>{
    verificationPassword=next==='verify'&&d.open?pass:''
    screen=next;fields.replaceChildren();nav.replaceChildren();who.replaceChildren();quick.replaceChildren();quick.hidden=true
    submitButton.classList.remove('has-last');submitButton.removeAttribute('aria-description');note(text,/成功|已登录|已保存|已重置|已退出/.test(text)?'ok':'info')
    d.dataset.screen=next;d.querySelector('h2')!.textContent=titles[next];submitButton.textContent=submits[next]
    if(next==='bindmail')submitButton.textContent=bindPhase==='code'?'确认绑定':'发送验证码'
    for(const tab of tabs)tab.setAttribute('aria-selected',String(tab.dataset.to===next))
    d.querySelector('.acc-tabs')?.toggleAttribute('hidden',next==='social')
    const step=next==='register'?0:next==='verify'?1:-1
    steps.forEach((li,i)=>{li.classList.toggle('on',i===step);li.classList.toggle('done',i<step)})
    lead.textContent={login:socialOptions?.length?'登录即可进入游玩，QQ / 微信 首次登录会自动建号。':'登录后即可进入游玩。提交的反馈有回复时，也会发邮件告诉你。',register:socialOptions?.length?'QQ / 微信 一键注册；也可以只用邮箱和一个昵称。':'只需要邮箱和一个昵称，一分钟就好。',
      verify:`六位验证码已发到 ${email||'你的邮箱'}，10 分钟内有效。没收到可以看看垃圾邮件。`,forgot:'输入注册时用的邮箱，我们会发一个六位验证码给你。',
      reset:'输入邮箱里的验证码，再设一个新密码。',profile:'',
      social:pendingSocial?.intent==='register'?(socialPhase==='code'?`验证码已发到 ${email}，10 分钟内有效。`:'邮箱和密码都可以留空：留空就直接用这个第三方账号注册；填了就要收验证码。'):'',
      bindmail:bindPhase==='code'?`验证码已发到 ${email}，10 分钟内有效。`:'给这个账号补一个邮箱，之后也能用邮箱密码登录。'}[next]
    if(next==='social'&&pendingSocial){const social=pendingSocial,badge=document.createElement('span'),info=document.createElement('div')
      const letter=initial(social.nickname),platformIcon=socialIcon(social.type,28)
      badge.className='acc-avatar';badge.textContent=letter
      if(platformIcon){badge.classList.add('acc-avatar--brand');badge.replaceChildren(platformIcon)}
      if(social.avatar){const image=document.createElement('img');image.alt=`${social.label} 头像`;image.referrerPolicy='no-referrer';image.loading='lazy'
        image.src=social.avatar
        image.onerror=()=>badge.replaceChildren(...(platformIcon?[platformIcon]:[document.createTextNode(letter)]))
        badge.replaceChildren(image)}
      info.innerHTML='<b></b><small></small>'
      info.querySelector('b')!.textContent=`${pendingSocial.label} · ${pendingSocial.nickname||'（无昵称）'}`
      info.querySelector('small')!.textContent={login:'确认后即可登录已绑定的账号',bind:'确认后把它绑定到当前账号',
        register:'还需要绑定邮箱并设置密码，才完成注册'}[pendingSocial.intent]
      who.append(badge,info)}
    if(next==='profile'&&user){const badge=document.createElement('span'),info=document.createElement('div')
      badge.className='acc-avatar';badge.textContent=initial(user.nickname);info.innerHTML='<b></b><small></small>'
      info.querySelector('b')!.textContent=user.nickname
      info.querySelector('small')!.textContent=user.email_placeholder?'主账号：未绑定邮箱（仅第三方登录）':`主账号：${user.email}`
      who.append(badge,info)}
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
      else{field('email','邮箱','email','email',email);field('password','密码（可选，至少 8 位）','password','new-password').required=false}
    }
    if(!['profile','social','bindmail'].includes(next))field('email','邮箱','email','email',email).readOnly=next==='verify'&&!!email
    if(next==='verify'||next==='reset')field('code','六位验证码','text','one-time-code')
    if(next==='register'||next==='login'||next==='reset')field('password',next==='login'?'密码':'密码（至少 8 位）','password',next==='login'?'current-password':'new-password')
    if(next==='register'||next==='profile')field('nickname','昵称','text','nickname',user?.nickname,next==='register'?'以后可以在「我的账号」里修改':'')
    if(next==='profile'){const label=document.createElement('label'),toggle=document.createElement('input');label.className='acc-check';toggle.type='checkbox';toggle.name='notify_email';toggle.checked=!!user?.notify_email
      label.append(toggle,'反馈有回复时发邮件提醒我');fields.append(label)
      const bound=user?.social??[],list=document.createElement('div');list.className='acc-bindings'
      const heading=document.createElement('small');heading.className='acc-bind-title'
      heading.textContent=user?.email_placeholder?'第三方登录方式（当前账号没有邮箱）':'第三方登录方式（主账号仍是上面的邮箱）';list.append(heading)
      if(!bound.length){const empty=document.createElement('small');empty.className='acc-bind-empty'
        empty.textContent='还没有绑定，绑定后可以用 QQ / 微信 直接登录这个账号';list.append(empty)}
      for(const item of bound){
        const row=document.createElement('div'),name=document.createElement('span'),state=document.createElement('span')
        row.className='acc-bind-row';name.className='acc-bind-name'
        name.textContent=`${item.label} · ${item.nickname||'（无昵称）'}`
        state.className='acc-bind-state';state.textContent='已绑定'
        const icon=socialIcon(item.type,20)
        row.append(...(icon?[icon]:[]),name,state);list.append(row)
      }
      fields.append(list)}
    if(next==='profile')link('修改外形',()=>submit(async()=>{await editCharacter()}))
    if(next==='profile')link('我的背包',()=>location.assign('/backpack.html'))
    if(next==='profile'&&user?.email_placeholder)link('绑定邮箱',()=>{bindPhase='send';render!('bindmail')})
    if(next==='login'||next==='register'||next==='profile')void socialButtons(next)
    if(next==='login'&&lastLogin()==='email')lastBadge(submitButton)
    if(next==='social')link('取消',()=>{pendingSocial=null;render!(user?'profile':'login')})
    if(next==='login')link('忘记密码？',()=>render!('forgot'))
    else if(next==='profile')link('退出登录',()=>submit(async()=>{await api('auth/logout','POST');setUser(null);render!('login','已退出登录')}))
    else if(next!=='register')link('返回登录',()=>render!('login'))
    if(next==='verify'||next==='reset'){const resend=link('重新发送',()=>submit(async()=>{
      const input=form.elements.namedItem('email');await api('auth/resend','POST',{email:input instanceof HTMLInputElement?input.value:email,purpose:next==='verify'?'verify':'reset'});note('验证码已重新发送，请查收','ok');startCooldown(resend)}))
      resendLabel(resend)}
    // 有 QQ / 微信 按钮时不抢焦点到邮箱框（手机上会直接弹键盘，把首选的一键登录挤下去）
    requestAnimationFrame(()=>quick.hidden?fields.querySelector<HTMLInputElement>('input:not([readonly])')?.focus()
      :quick.querySelector<HTMLButtonElement>('.acc-sso')?.focus({focusVisible:false} as FocusOptions))
  }
  for(const tab of tabs)tab.onclick=()=>{if(!busy&&tab.dataset.to!==screen)render!(tab.dataset.to as Screen)}
  form.onsubmit=event=>{event.preventDefault()
    const invalid=Array.from(form.querySelectorAll<HTMLInputElement>('input')).find(input=>!input.checkValidity())
    if(invalid){const label=invalid.closest('label')?.firstChild?.textContent??'';note(invalid.value?`${label}格式不对，请检查一下`:`请填写${label.replace(/（.*）/,'')}`,'error');invalid.focus();return}
    void submit(async()=>{
    const data:Record<string,string>={};new FormData(form).forEach((value,key)=>{data[key]=String(value)});if(data.email)email=data.email
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
        render!('profile','已通过第三方账号登录')
        return
      }
      setUser(await api('me') as User)
      render!('profile','第三方账号已绑定')
      return
    }
    if(screen==='bindmail'){
      const payload:Record<string,string>={email:data.email??'',password:data.password??''}
      if(bindPhase==='code')payload.code=data.code??''
      const result=await api('auth/email/bind','POST',payload) as {needs_code?:boolean;email?:string}
      if(result.needs_code){bindPhase='code';render!('bindmail',`验证码已发到 ${result.email}，10 分钟内有效`);return}
      setUser(await api('me') as User);render!('profile','邮箱已绑定，之后也能用邮箱登录');return
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
  d.querySelector('header button')!.addEventListener('click',()=>d.close())
  d.querySelector('.acc-join')!.addEventListener('click',()=>{if(!busy)render!('register')})
  d.addEventListener('close',()=>{verificationPassword='';form.reset();const resolve=gate;gate=undefined;resolve?.(user)})
  d.addEventListener('click',event=>{if(event.target===d)d.close()})
  for(const type of ['keydown','keyup'])d.addEventListener(type,event=>event.stopPropagation())
  document.body.append(d)
}
