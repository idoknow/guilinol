import './account.css'

type Screen='login'|'register'|'verify'|'forgot'|'reset'|'profile'
const titles={login:'登录',register:'注册账号',verify:'验证邮箱',forgot:'忘记密码',reset:'重置密码',profile:'我的账号'}
async function api(path:string,method='GET',data?:object) {
  const response=await fetch(`/api/${path}`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
  const result=await response.json()
  if(!response.ok) throw Object.assign(new Error(result.error.message),{code:result.error.code})
  return result
}
export function accountPanel() {
  const entry=document.createElement('button'), dialog=document.createElement('dialog')
  entry.type='button';entry.className='btn-about account-entry';entry.textContent='登录';entry.setAttribute('aria-haspopup','dialog')
  dialog.className='about-panel account';dialog.setAttribute('aria-labelledby','account-title')
  dialog.innerHTML='<header><h2 id="account-title"></h2><button class="about-close" type="button">关闭</button></header><form class="about-body"><div class="fields"></div><button class="about-close" type="submit"></button><nav></nav><p class="message" role="status"></p></form>'
  const form=dialog.querySelector('form')!,fields=form.querySelector('.fields')!,nav=form.querySelector('nav')!,message=form.querySelector('.message')!
  let screen:Screen='login',email='',user:{email:string,nickname:string,notify_email:boolean}|null=null,busy=false
  const setUser=(value:typeof user)=>{user=value;entry.textContent=user?.nickname??'登录'}
  function field(name:string,label:string,type:string,auto:string,value='') {
    const wrapper=document.createElement('label'),input=document.createElement('input')
    wrapper.textContent=label;input.type=type;input.name=name;input.value=value;input.required=true;input.setAttribute('autocomplete',auto)
    if(name==='code'){input.inputMode='numeric';input.pattern='[0-9]{6}';input.maxLength=6}
    if(name==='password'){input.minLength=8;input.maxLength=256}
    if(name==='nickname')input.maxLength=32
    wrapper.append(input);fields.append(wrapper)
  }
  function action(title:string,run:()=>void){const button=document.createElement('button');button.type='button';button.className='about-close';button.textContent=title;button.onclick=()=>{if(!busy)run()};nav.append(button)}
  async function submit(run:()=>Promise<void>){
    if(busy)return;busy=true;message.textContent='处理中…'
    try{await run()}catch(error){message.textContent=error instanceof Error?error.message:'请求失败，请重试'}finally{busy=false}
  }
  let verificationPassword=''
  function render(next:Screen,note='',pass='') {
    verificationPassword=next==='verify'&&dialog.open?pass:''
    screen=next;fields.replaceChildren();nav.replaceChildren();message.textContent=note
    dialog.querySelector('h2')!.textContent=titles[next]
    form.querySelector('button')!.textContent=next==='forgot'?'发送重置验证码':next==='profile'?'保存昵称':titles[next]
    if(next!=='profile')field('email','邮箱','email','email',email)
    if(next==='verify'||next==='reset')field('code','六位验证码','text','one-time-code')
    if(next==='register'||next==='login'||next==='reset')field('password',next==='login'?'密码':'密码（至少 8 位）','password',next==='login'?'current-password':'new-password')
    if(next==='register'||next==='profile')field('nickname','昵称','text','nickname',user?.nickname)
    if(next==='profile'){const label=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.name='notify_email';toggle.checked=!!user?.notify_email;label.append(toggle,'反馈邮件提醒');fields.append(label)}
    if(next==='login'){action('注册账号',()=>render('register'));action('忘记密码',()=>render('forgot'))}
    else if(next==='profile')action('退出登录',()=>submit(async()=>{await api('auth/logout','POST');setUser(null);render('login','已退出登录')}))
    else action('返回登录',()=>render('login'))
    if(next==='verify'||next==='reset')action('重新发送',()=>submit(async()=>{await api('auth/resend','POST',{email:form.elements.namedItem('email') instanceof HTMLInputElement?(form.elements.namedItem('email') as HTMLInputElement).value:email,purpose:next==='verify'?'verify':'reset'});message.textContent='请查收验证码'}))
  }
  form.onsubmit=event=>{event.preventDefault();void submit(async()=>{
    const data:Record<string,string>={};new FormData(form).forEach((value,key)=>{data[key]=String(value)});if(data.email)email=data.email
    if(screen==='profile'){setUser(await api('me','PATCH',{...data,notify_email:!!data.notify_email}));render('profile','账号设置已保存');return}
    if(screen==='forgot'){await api('auth/resend','POST',{email,purpose:'reset'});render('reset','如邮箱已注册，请查收验证码');return}
    const previous=screen
    if(previous==='verify') data.password=verificationPassword
    let result
    try {result=await api(`auth/${screen}`,'POST',data)} catch(error){if((error as {code?:string}).code==='unverified'){render('verify','请验证邮箱后登录',data.password);return}throw error}
    if(previous==='register')render('verify','请查收邮箱中的六位验证码，10 分钟内有效',data.password)
    else if(previous==='reset')render('login','密码已重置，请重新登录')
    else {setUser(result);render('profile',previous==='verify'?'注册成功，已登录':'已登录')}
  })}
  dialog.querySelector('header button')!.addEventListener('click',()=>dialog.close())
  dialog.addEventListener('close',()=>{verificationPassword='';form.reset()})
  for(const type of ['keydown','keyup'])dialog.addEventListener(type,event=>event.stopPropagation())
  const ready=api('me').then(setUser).catch(()=>{})
  entry.onclick=async()=>{await ready;render(user?'profile':'login');dialog.showModal()}
  document.body.append(entry,dialog)
}
