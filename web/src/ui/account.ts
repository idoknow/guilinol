import {record} from '../telemetry'
import './account.css'

// 账号：登录 / 注册（填写 → 邮箱验证 → 完成）/ 忘记密码 / 我的账号。
// Playing requires an account (IDOK-99): the title screen asks for a login before the city boots, see requireUser().
type Screen='login'|'register'|'verify'|'forgot'|'reset'|'profile'
export type User={email:string,nickname:string,notify_email:boolean}
const titles:Record<Screen,string>={login:'登录',register:'注册账号',verify:'验证邮箱',forgot:'忘记密码',reset:'重置密码',profile:'我的账号'}
const submits:Record<Screen,string>={login:'登录',register:'注册账号',verify:'验证邮箱',forgot:'发送重置验证码',reset:'重置密码',profile:'保存设置'}
async function api(path:string,method='GET',data?:object) {
  const response=await fetch(`/api/${path}`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
  const result=await response.json().catch(()=>{throw new Error('网络不太顺畅，请稍后再试')})
  if(!response.ok) throw Object.assign(new Error(result.error?.message??'请求失败，请重试'),{code:result.error?.code})
  return result
}

let user:User|null=null
const listeners=new Set<(user:User|null)=>void>()
const setUser=(value:User|null)=>{user=value;for(const listen of listeners)listen(user)}
const ready=api('me').then(r=>setUser(r&&typeof r.nickname==='string'?r:null)).catch(()=>{})
/** Subscribe to sign-in changes; called immediately with the current value once known. */
export function onUser(listen:(user:User|null)=>void){listeners.add(listen);void ready.then(()=>listen(user))}
export const initial=(name='')=>[...name.trim()][0]??'客'

let dialog:HTMLDialogElement|undefined,render:((screen:Screen,note?:string,pass?:string)=>void)|undefined
let gate:((user:User|null)=>void)|undefined
export async function openAccount(){
  build();await ready;render!(user?'profile':'login');dialog!.showModal();if(!user)record('funnel',{step:'loginOpen'})
}
/** Resolve with the signed-in user, opening the login dialog first if needed; null if the player closes it without signing in. */
export async function requireUser():Promise<User|null>{
  await ready;if(user)return user
  build();gate?.(null)
  return new Promise(resolve=>{gate=resolve;render!('login');dialog!.showModal();if(!user)record('funnel',{step:'loginOpen'})})
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

function build(){
  if(dialog)return
  dialog=document.createElement('dialog');const d=dialog
  d.className='about-panel account';d.setAttribute('aria-labelledby','account-title')
  d.innerHTML=`<header><h2 id="account-title"></h2><button class="about-close" type="button">关闭</button></header>
    <div class="acc-tabs" role="tablist" aria-label="登录或注册"><button type="button" role="tab" data-to="login">登录</button><button type="button" role="tab" data-to="register">注册</button></div>
    <ol class="acc-steps" aria-label="注册进度"><li>填写信息</li><li>验证邮箱</li><li>完成</li></ol>
    <form class="acc-body" novalidate><p class="acc-lead"></p><div class="acc-who"></div><div class="fields"></div><p class="acc-msg" role="status"></p>
      <button class="ui-btn ui-btn--seal ui-btn--block acc-submit" type="submit"></button><nav class="acc-links"></nav></form>
    <p class="acc-guest">还没有账号？ <button type="button" class="acc-join">注册一个</button>，一分钟就好</p>`
  const form=d.querySelector('form')!,fields=form.querySelector('.fields')!,nav=form.querySelector('nav')!,message=form.querySelector<HTMLElement>('.acc-msg')!,
    lead=form.querySelector('.acc-lead')!,who=form.querySelector<HTMLElement>('.acc-who')!,submitButton=form.querySelector<HTMLButtonElement>('.acc-submit')!,
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
  render=(next:Screen,text='',pass='')=>{
    verificationPassword=next==='verify'&&d.open?pass:''
    screen=next;fields.replaceChildren();nav.replaceChildren();who.replaceChildren();note(text,/成功|已登录|已保存|已重置|已退出/.test(text)?'ok':'info')
    d.dataset.screen=next;d.querySelector('h2')!.textContent=titles[next];submitButton.textContent=submits[next]
    for(const tab of tabs)tab.setAttribute('aria-selected',String(tab.dataset.to===next))
    const step=next==='register'?0:next==='verify'?1:-1
    steps.forEach((li,i)=>{li.classList.toggle('on',i===step);li.classList.toggle('done',i<step)})
    lead.textContent={login:'登录后即可进入游玩。提交的反馈有回复时，也会发邮件告诉你。',register:'只需要邮箱和一个昵称，一分钟就好。',
      verify:`六位验证码已发到 ${email||'你的邮箱'}，10 分钟内有效。没收到可以看看垃圾邮件。`,forgot:'输入注册时用的邮箱，我们会发一个六位验证码给你。',
      reset:'输入邮箱里的验证码，再设一个新密码。',profile:''}[next]
    if(next==='profile'&&user){const badge=document.createElement('span'),info=document.createElement('div')
      badge.className='acc-avatar';badge.textContent=initial(user.nickname);info.innerHTML='<b></b><small></small>'
      info.querySelector('b')!.textContent=user.nickname;info.querySelector('small')!.textContent=user.email;who.append(badge,info)}
    if(next!=='profile')field('email','邮箱','email','email',email).readOnly=next==='verify'&&!!email
    if(next==='verify'||next==='reset')field('code','六位验证码','text','one-time-code')
    if(next==='register'||next==='login'||next==='reset')field('password',next==='login'?'密码':'密码（至少 8 位）','password',next==='login'?'current-password':'new-password')
    if(next==='register'||next==='profile')field('nickname','昵称','text','nickname',user?.nickname,next==='register'?'以后可以在「我的账号」里修改':'')
    if(next==='profile'){const label=document.createElement('label'),toggle=document.createElement('input');label.className='acc-check';toggle.type='checkbox';toggle.name='notify_email';toggle.checked=!!user?.notify_email
      label.append(toggle,'反馈有回复时发邮件提醒我');fields.append(label)}
    if(next==='login')link('忘记密码？',()=>render!('forgot'))
    else if(next==='profile')link('退出登录',()=>submit(async()=>{await api('auth/logout','POST');setUser(null);render!('login','已退出登录')}))
    else if(next!=='register')link('返回登录',()=>render!('login'))
    if(next==='verify'||next==='reset'){const resend=link('重新发送',()=>submit(async()=>{
      const input=form.elements.namedItem('email');await api('auth/resend','POST',{email:input instanceof HTMLInputElement?input.value:email,purpose:next==='verify'?'verify':'reset'});note('验证码已重新发送，请查收','ok');startCooldown(resend)}))
      resendLabel(resend)}
    requestAnimationFrame(()=>fields.querySelector<HTMLInputElement>('input:not([readonly])')?.focus())
  }
  for(const tab of tabs)tab.onclick=()=>{if(!busy&&tab.dataset.to!==screen)render!(tab.dataset.to as Screen)}
  form.onsubmit=event=>{event.preventDefault()
    const invalid=Array.from(form.querySelectorAll<HTMLInputElement>('input')).find(input=>!input.checkValidity())
    if(invalid){const label=invalid.closest('label')?.firstChild?.textContent??'';note(invalid.value?`${label}格式不对，请检查一下`:`请填写${label.replace(/（.*）/,'')}`,'error');invalid.focus();return}
    void submit(async()=>{
    const data:Record<string,string>={};new FormData(form).forEach((value,key)=>{data[key]=String(value)});if(data.email)email=data.email
    if(screen==='profile'){setUser(await api('me','PATCH',{...data,notify_email:!!data.notify_email}));render!('profile','账号设置已保存');return}
    if(screen==='forgot'){await api('auth/resend','POST',{email,purpose:'reset'});render!('reset','如邮箱已注册，请查收验证码');return}
    const previous=screen
    if(previous==='verify') data.password=verificationPassword
    let result
    try {result=await api(`auth/${screen}`,'POST',data);if(screen==='login')record('funnel',{step:'loginSuccess'})} catch(error){if((error as {code?:string}).code==='unverified'){render!('verify','请先验证邮箱再登录',data.password);return}throw error}
    if(previous==='register')render!('verify','',data.password)
    else if(previous==='reset')render!('login','密码已重置，请重新登录')
    else {setUser(result);if(gate){const resolve=gate;gate=undefined;d.close();resolve(result);return}
      render!('profile',previous==='verify'?'注册成功，已登录':'已登录')}
  })}
  d.querySelector('header button')!.addEventListener('click',()=>d.close())
  d.querySelector('.acc-join')!.addEventListener('click',()=>{if(!busy)render!('register')})
  d.addEventListener('close',()=>{verificationPassword='';form.reset();const resolve=gate;gate=undefined;resolve?.(user)})
  d.addEventListener('click',event=>{if(event.target===d)d.close()})
  for(const type of ['keydown','keyup'])d.addEventListener(type,event=>event.stopPropagation())
  document.body.append(d)
}
