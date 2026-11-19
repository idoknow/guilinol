import assert from 'node:assert/strict'
import {spawn,execFileSync} from 'node:child_process'
import {once} from 'node:events'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:net'
import {setTimeout as delay} from 'node:timers/promises'
import {chromium} from 'playwright'

const feedbackUI=process.argv.includes('--feedback-ui'),ui=feedbackUI||process.argv.includes('--ui'), email='walker@example.test', password='local-test-password', nickname='漓江访客'
const state=await mkdtemp(join(tmpdir(),'glol-auth-')), wrangler='node_modules/.bin/wrangler'
const local=['--local','--persist-to',state],sql=command=>execFileSync(wrangler,['d1','execute','glol',...local,'--command',command,'--json'],{encoding:'utf8'})
let child,browser,logs='',closed
try {
  execFileSync(wrangler,['d1','migrations','apply','glol',...local],{stdio:['ignore','pipe','inherit']})
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
  const origin=`http://127.0.0.1:${port}`
  const staticDir=ui?'dist':join(state,'empty-site');if(!ui)await mkdir(staticDir)
  child=spawn(wrangler,['pages','dev',staticDir,'--ip','127.0.0.1','--port',String(port),'--persist-to',state,'--binding','EMAIL_DEV_LOG=1','--binding','BRIDGE_TOKEN=local-test'],{stdio:['ignore','pipe','pipe'],detached:true});closed=once(child,'exit')
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>logs+=chunk)
  for(let attempt=0;attempt<200;attempt++) {
    if(await fetch(origin+'/api/me').then(response=>response.status===401).catch(()=>false))break
    if(child.exitCode!==null||attempt===199)throw Error('Wrangler failed: '+logs)
    await delay(150)
  }
  async function code(purpose,index=0){for(let attempt=0;attempt<50;attempt++){
    const match=Array.from(logs.matchAll(new RegExp(`DEV_EMAIL ${email} ${purpose} (\\d{6})`,'g')))[index];if(match)return match[1];await delay(100)
  }throw Error('Missing local email')}
  if(ui) {
    browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
    await mkdir('captures/auth',{recursive:true})
    const page=await browser.newPage({viewport:{width:1100,height:740}})
    await page.goto(origin+'/?verify');await page.locator('.account-entry').click();if(feedbackUI)await page.evaluate(()=>window.viewer.freeze())
    const dialog=page.getByRole('dialog'),click=name=>dialog.getByRole('button',{name,exact:true}).click(),fill=(name,value)=>dialog.getByLabel(name).fill(value)
    await page.screenshot({path:'captures/auth/login.png'});await click('注册账号');await fill('邮箱',email);await fill('密码',password);await fill('昵称',nickname);await click('注册账号');await fill('六位验证码',await code('verify'));await click('验证邮箱')
    await dialog.getByText('注册成功，已登录').waitFor();await page.screenshot({path:'captures/auth/registered.png'});await click('退出登录');await fill('密码',password);await click('登录');await dialog.getByText('已登录',{exact:true}).waitFor();await click('关闭');assert.equal(await page.locator('.account-entry').textContent(),nickname)
    if(feedbackUI)await (await import('./feedback-test.mjs')).uiTest(page,origin)
    await page.close();if(!feedbackUI){const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await mobile.goto(origin+'/?verify');await mobile.locator('.account-entry').tap();await mobile.getByRole('dialog').waitFor();await mobile.screenshot({path:'captures/auth/mobile.png'})}
  }else{
    let cookie=''
    async function api(path,data,status=200,code,options={}){
      const method=options.method??(data?'POST':'GET')
      const response=await fetch(origin+'/api/'+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json',...options.headers},body:data?JSON.stringify(data):undefined})
      const result=await response.json();assert.equal(response.status,status,`${path}: ${JSON.stringify(result)}`);if(code)assert.equal(result.error.code,code)
      const set=response.headers.get('set-cookie');if(set){assert.match(set,/HttpOnly; Secure; SameSite=Lax/);cookie=set.split(';')[0]}
      return result
    }
    const register={email,password,nickname},login={email,password}
    const firstPassword='first-registration-password'
    await api('auth/register',register,403,'origin',{headers:{Origin:'https://example.test'}});await api('auth/register',{},400,'invalid_input');await api('auth/register',{...register,password:firstPassword})
    sql('UPDATE mail_events SET sent=sent-61');await api('auth/register',register)
    await api('auth/resend',{email,purpose:'verify'},429,'rate_limited');await api('auth/login',login,403,'unverified')
    const verification={email,code:await code('verify',1)}
    await api('auth/verify',verification,400,'invalid_code');await api('auth/verify',{...verification,password:firstPassword},400,'invalid_code');await api('me',null,401,'unauthorized')
    await api('auth/verify',{...verification,password});await api('auth/verify',{...verification,password},400,'invalid_code');assert.equal((await api('me')).verified,true)
    console.log('Verification requires the latest registration password: missing and stale passwords rejected; current password accepted')
    assert.equal((await api('me',{nickname:'江岸' },200,null,{method:'PATCH'})).nickname,'江岸');const sessionRows=JSON.parse(sql('SELECT digest FROM sessions'))[0].results;assert.equal(sessionRows.length,1);assert.notEqual(sessionRows[0].digest,cookie.split('=')[1]);assert.notEqual(JSON.parse(sql('SELECT digest FROM users'))[0].results[0].digest,password)
    await api('auth/logout',{});await api('me',null,401,'unauthorized');await api('auth/login',login)
    await (await import('./feedback-test.mjs')).apiTest({api,origin,cookie,sql})
    for(let attempt=1;attempt<=5;attempt++)await api('auth/login',{email,password:'incorrect'},attempt===5?429:401,attempt===5?'locked':'credentials');await api('auth/login',login,429,'locked')
    sql('UPDATE mail_events SET sent=sent-61');await api('auth/resend',{email,purpose:'reset'});const reset={email,code:await code('reset'),password:'new-password'};await api('auth/reset',reset);await api('me',null,401,'unauthorized');await api('auth/reset',reset,400,'invalid_code');await api('auth/login',login,401,'credentials');await api('auth/login',reset)
    for(let index=0;index<7;index++)await api('auth/resend',{email:`other${index}@example.test`,purpose:'reset'});await api('auth/resend',{email:'capped@example.test',purpose:'reset'},429,'rate_limited')
  }
  console.log(ui?'UI registration, login and mobile screenshots passed':'API lifecycle, storage, lockout, cooldown, IP limit and Origin passed')
}finally{
  await browser?.close();if(child&&child.exitCode===null&&child.signalCode===null){process.kill(-child.pid,'SIGTERM');await closed}await rm(state,{recursive:true,force:true})
}
