// IDOK-338 登录面板 / 老用户迁移 UI 截图：本地 Postgres + 假的 QQ 互联 / 聚合登录上游 + vite dev + Playwright。
// 三个阶段（before / migrating / sunset）各起一次 API，同一个库从头走到尾：
//   node scripts/social-ui-shots.mjs            → captures/social/*.png
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {chromium} from 'playwright'
import {createServer as vite} from 'vite'
import {fixture} from './selfhost-test.mjs'

const out='captures/social',state=await mkdtemp(join(tmpdir(),'glol-social-ui-'))
await mkdir(out,{recursive:true})
const preload=join(state,'fake-upstream.mjs')
// 服务端的 fetch 换成本地假上游：graph.qq.com 用 code 当 openid，聚合登录用 code 当 uid
await writeFile(preload,`const real=globalThis.fetch
const names={'new-player-openid':'漓江新客','old-player-openid':'老桂林人'}
globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input.url),p=url.searchParams,json=o=>new Response(JSON.stringify(o),{headers:{'content-type':'application/json'}})
  if(url.host==='graph.qq.com'){
    if(url.pathname==='/oauth2.0/token')return json({access_token:p.get('code')})
    if(url.pathname==='/oauth2.0/me')return json({client_id:process.env.QQ_APPID,openid:p.get('access_token'),unionid:'union-'+p.get('access_token')})
    if(url.pathname==='/user/get_user_info')return json({ret:0,nickname:names[p.get('openid')]??'QQ 用户',figureurl_qq_2:'https://thirdqq.qlogo.cn/fake/'+p.get('openid')})
  }
  if(url.host==='login.mapay.cn'){
    if(p.get('act')==='login')return json({code:0,type:p.get('type'),url:'https://login.mapay.cn/fake-authorize?type='+p.get('type')})
    if(p.get('act')==='callback')return json({code:0,type:p.get('type'),social_uid:p.get('code'),nickname:'老桂林',faceimg:''})
  }
  return real(input,init)
}
`)
const port=async()=>{const probe=createServer().listen(0,'127.0.0.1');await once(probe,'listening');const value=probe.address().port;await new Promise(r=>probe.close(r));return value}
let storage,site,api,browser,logs='',lastPage
const shots=[]
try{
  storage=await fixture()
  const sql=(text,args)=>storage.sql(text,args)
  const apiPort=await port()
  site=await vite({root:resolve('web'),configFile:resolve('web/vite.config.ts'),logLevel:'warn',server:{host:'127.0.0.1',port:await port(),strictPort:true,proxy:{'/api':`http://127.0.0.1:${apiPort}`}}})
  await site.listen()
  const origin=`http://127.0.0.1:${site.config.server.port}`
  async function startApi(dates){
    if(api){process.kill(-api.pid,'SIGTERM');await once(api,'exit')}
    api=spawn(process.execPath,['--import','tsx','--import',preload,'server/index.mjs'],{detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,...storage.env,PORT:String(apiPort),PUBLIC_ORIGIN:origin,BRIDGE_TOKEN:'local-test',EMAIL_DEV_LOG:'1',
      QQ_APPID:'1906529607',QQ_APPKEY:'local-fake',SOCIAL_APPID:'1',SOCIAL_APPKEY:'local-fake',SOCIAL_ENABLED:'qq,wx',SOCIAL_REDIRECT:'https://glol.test/api/auth/social/callback',
      SOCIAL_LEGACY_CUTOFF:dates.cutoff,SOCIAL_LEGACY_SUNSET:dates.sunset}})
    for(const stream of [api.stdout,api.stderr])stream.on('data',chunk=>logs+=chunk)
    for(let attempt=0;;attempt++){
      if(await fetch(origin+'/api/me').then(r=>r.status===401).catch(()=>false))break
      if(api.exitCode!==null||attempt>200)throw Error('API failed: '+logs.slice(-3000))
      await delay(150)
    }
  }
  async function code(email){for(let attempt=0;attempt<80;attempt++){const all=[...logs.matchAll(new RegExp(`DEV_EMAIL ${email.replace('.','\\.')} verify (\\d{6})`,'g'))];if(all.length)return all.at(-1)[1];await delay(100)}throw Error('no mail for '+email)}
  // 老账号：迁移开始前用旧版 QQ 建的纯第三方账号（占位邮箱）
  const old=Math.floor(Date.parse('2026-06-01T00:00:00+08:00')/1000)
  for(const [id,uid,name] of [['old-player','old-player-uid','老桂林人'],['old-mail','old-mail-uid','象山脚下'],['old-other','old-other-uid','独秀峰顶']]){
    await sql(`INSERT INTO users(id,email,nickname,salt,digest,verified,email_placeholder,created_at) VALUES($1,$2,$3,'x','x',1,1,$4)`,[id,`qq.${uid.replaceAll('-','')}@social.invalid`,name,old])
    await sql(`INSERT INTO social_identities(type,social_uid,user_id,nickname,created_at,last_login_at) VALUES('qq',$1,$2,$3,$4,$4)`,[uid,id,name,old])
  }
  browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  let openid='',legacyUid=''
  async function context(mobile=false){
    const value=await browser.newContext(mobile?{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}:{viewport:{width:1100,height:860},deviceScaleFactor:2})
    await value.route('https://graph.qq.com/oauth2.0/authorize**',route=>{const url=new URL(route.request().url());route.fulfill({status:302,headers:{location:`${origin}/api/auth/oauth/qq/callback?code=${openid}&state=${url.searchParams.get('state')}`}})})
    await value.route('https://login.mapay.cn/fake-authorize**',route=>{const url=new URL(route.request().url());route.fulfill({status:302,headers:{location:`${origin}/api/auth/social/callback?type=${url.searchParams.get('type')}&code=${legacyUid}`}})})
    const avatar=await readFile('public/icons/qq-group.webp')
    await value.route('https://thirdqq.qlogo.cn/**',route=>route.fulfill({status:200,contentType:'image/webp',body:avatar}))
    return value
  }
  const dialog=page=>page.locator('dialog.account')
  async function open(page,path='/?verify'){
    lastPage=page
    await page.goto(origin+path)
    // 手机竖屏有「请横屏游玩」遮罩挡住角落的入口，直接调账号模块打开面板（和点入口是同一个函数）
    if(path==='/?verify')await page.evaluate(()=>import('/src/ui/account.ts').then(module=>module.openAccount()))
    await dialog(page).waitFor({state:'visible',timeout:120000});await delay(450)
  }
  async function shot(page,name){await delay(300);const file=`${out}/${name}.png`;await page.screenshot({path:file});shots.push(file)}
  const button=(page,name)=>dialog(page).getByRole('button',{name,exact:true})
  async function settle(page){await page.waitForLoadState('load');await dialog(page).waitFor({state:'visible',timeout:120000});await delay(500)}

  /* ── 阶段一：before（新版已开、迁移未开始 = QQ 审核期）── */
  await startApi({cutoff:'2026-12-20',sunset:'2027-03-20'})
  {const ctx=await context(),page=await ctx.newPage();await open(page)
    assert.equal(await dialog(page).locator('.acc-banner').isHidden(),true)
    await dialog(page).locator('.acc-direct').waitFor();await dialog(page).locator('.acc-sso').first().waitFor()
    await shot(page,'01-before-login');await ctx.close()}

  /* ── 阶段二：migrating ── */
  await startApi({cutoff:'2026-11-20',sunset:'2027-02-18'})
  {const ctx=await context(),page=await ctx.newPage();await open(page)
    await dialog(page).locator('.acc-legacy').waitFor();assert.match(await dialog(page).locator('.acc-banner').innerText(),/11 月 20 日前用 QQ 或微信登录过的玩家/)
    await shot(page,'02-migrating-login')
    await dialog(page).getByRole('tab',{name:'注册'}).click();await shot(page,'03-migrating-register')
    // 新 QQ 点「QQ 登录」→ 新玩家 / 老玩家 二选一
    await dialog(page).getByRole('tab',{name:'登录'}).click()
    openid='new-player-openid';await button(page,'QQ 登录').click();await settle(page)
    await dialog(page).getByText('这个 QQ 还没有网上桂林账号').waitFor();await shot(page,'04-new-choice')
    await button(page,'我是新玩家，创建账号').click();await dialog(page).waitFor({state:'hidden'})
    assert.equal((await (await page.request.get(origin+'/api/me')).json()).nickname,'漓江新客')
    await ctx.close()}
  {// 旧版入口遇到没有老账号的 QQ
    const ctx=await context(),page=await ctx.newPage();await open(page)
    legacyUid='never-played-uid';await button(page,'旧版 QQ').click();await settle(page)
    await dialog(page).getByText(/旧版入口已停止注册/).waitFor();await shot(page,'05-legacy-closed');await ctx.close()}
  {// 老玩家走旧版 QQ → 不能关的迁移面板 → 绑定新版 QQ（这个 QQ 刚误建了新号）→ 接管确认 → 迁移完成
    const ctx=await context(),page=await ctx.newPage();await open(page)
    legacyUid='old-player-uid';await button(page,'旧版 QQ').click();await settle(page)
    await button(page,'确认登录').click()
    await dialog(page).getByRole('heading',{name:'最后一步：绑定新版登录方式'}).waitFor();await shot(page,'06-migrate-panel')
    await page.keyboard.press('Escape');await delay(200);await page.mouse.click(8,8);await delay(300)
    assert.equal(await dialog(page).isVisible(),true,'migration panel must not close')
    openid='new-player-openid';await button(page,'绑定新版 QQ').click();await settle(page)
    await dialog(page).getByText(/新建的另一个账号上/).waitFor();await shot(page,'07-takeover')
    await button(page,'转到当前账号').click()
    await dialog(page).getByRole('heading',{name:'迁移完成'}).waitFor();await shot(page,'08-migrated')
    await button(page,'进入游戏').click();await dialog(page).waitFor({state:'hidden'})
    await page.evaluate(()=>import('/src/ui/account.ts').then(module=>module.openAccount()));await dialog(page).getByText(/QQ（旧版，2027 年 2 月 18 日停用）/).waitFor();await shot(page,'09-profile-after-migration')
    await ctx.close()}
  {// 改用邮箱和密码（手机竖屏）
    const ctx=await context(true),page=await ctx.newPage();await open(page)
    await shot(page,'10-mobile-login')
    legacyUid='old-mail-uid';await button(page,'旧版 QQ').tap();await settle(page)
    await button(page,'确认登录').tap()
    await dialog(page).getByRole('heading',{name:'最后一步：绑定新版登录方式'}).waitFor();await shot(page,'11-mobile-migrate-panel')
    await button(page,'改用邮箱和密码登录').tap()
    const email='xiangshan@example.test'
    await dialog(page).getByLabel('邮箱').fill(email);await dialog(page).getByLabel('密码（至少 8 位）').fill('migration-password');await shot(page,'12-mobile-migrate-email')
    await button(page,'发送验证码').tap();await dialog(page).getByLabel('六位验证码').fill(await code(email))
    await button(page,'完成迁移').tap();await dialog(page).getByRole('heading',{name:'迁移完成'}).waitFor();await shot(page,'13-mobile-migrated')
    await ctx.close()}
  {// 这个 QQ 已经属于另一个老账号：不能接管
    const ctx=await context(),page=await ctx.newPage();await open(page)
    legacyUid='old-other-uid';await button(page,'旧版 QQ').click();await settle(page);await button(page,'确认登录').click()
    await dialog(page).getByRole('heading',{name:'最后一步：绑定新版登录方式'}).waitFor()
    openid='new-player-openid';await button(page,'绑定新版 QQ').click();await settle(page)
    await dialog(page).getByText(/已经绑在别的账号上/).waitFor();await shot(page,'14-already-bound');await ctx.close()}
  {// 有邮箱、只剩旧版绑定的账号：账号页一条不强制的提示
    const email='mail-player@example.test',password='mail-player-pass'
    await fetch(origin+'/api/auth/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,password,nickname:'榕湖晨跑'})})
    await fetch(origin+'/api/auth/verify',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,password,code:await code(email)})})
    await sql(`INSERT INTO social_identities(type,social_uid,user_id,nickname,created_at,last_login_at) SELECT 'qq','mail-player-uid',id,'榕湖晨跑',$1,$1 FROM users WHERE email=$2`,[old,email])
    const ctx=await context(),page=await ctx.newPage();await open(page)
    await dialog(page).getByLabel('邮箱').fill(email);await dialog(page).getByLabel('密码',{exact:true}).fill(password);await button(page,'登录').click()
    await dialog(page).locator('.acc-bind-tip').waitFor();await shot(page,'15-profile-legacy-hint');await ctx.close()}
  {const ctx=await context(),page=await ctx.newPage()
    await open(page,'/?social=failed');await shot(page,'16-result-failed')
    await open(page,'/?social=expired');await shot(page,'17-result-expired');await ctx.close()}

  /* ── 阶段三：sunset ── */
  await startApi({cutoff:'2026-08-01',sunset:'2026-11-01'})
  {const ctx=await context(),page=await ctx.newPage();await open(page)
    await dialog(page).locator('.acc-legacy-gone').waitFor();assert.equal(await dialog(page).locator('.acc-legacy').count(),0);await shot(page,'18-sunset-login')
    await open(page,'/?social=legacy_sunset');await shot(page,'19-legacy-sunset');await ctx.close()
    const mobile=await context(true),phone=await mobile.newPage();await open(phone);await shot(phone,'20-mobile-sunset');await mobile.close()}
  console.log('Social UI screenshots:\n'+shots.join('\n'))
}catch(error){await lastPage?.screenshot({path:`${out}/failure.png`}).catch(()=>{});console.error(logs.slice(-4000).replace(/(DEV_EMAIL \S+ \S+) \d{6}/g,'$1 [redacted]'));throw error}
finally{
  await browser?.close()
  if(api&&api.exitCode===null){process.kill(-api.pid,'SIGTERM');await once(api,'exit')}
  await site?.close();await storage?.close();await rm(state,{recursive:true,force:true})
}
