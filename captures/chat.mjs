// IDOK-248 shots: 游戏内聊天框（收起/展开/附近/世界/禁言/手机）+ 管理后台「聊天」各页。
// CHROMIUM=/usr/bin/chromium node captures/chat.mjs  (needs npm run build, public/world)
import {randomBytes,createHash,createHmac} from 'node:crypto'
import {spawn} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import {once} from 'node:events'
import {createServer} from 'node:net'
import {setTimeout as delay} from 'node:timers/promises'
import pg from 'pg'
import {chromium} from 'playwright'
import {preview} from 'vite'
import WebSocket from 'ws'
import {fixture} from '../scripts/selfhost-test.mjs'
import {importWords} from '../scripts/chat-words-import.mjs'

const secret=randomBytes(32).toString('hex'),children=[],sockets=[],out='captures/chat'
const appearance={body:'f',v:1,createdAt:123,skin:2,face:1,brows:0,eyes:0,hair:'f_bun',hairColor:1,look:'sport'}
const look2={body:'m',v:1,createdAt:124,skin:1,face:0,brows:0,eyes:0,hair:'m_short',hairColor:0,look:'casual'}
let database,site,browser,timer
async function port(){const s=createServer().listen(0,'127.0.0.1');await once(s,'listening');const n=s.address().port;await new Promise(d=>s.close(d));return n}
async function service(entry,env,path,status){const n=await port(),host=`127.0.0.1:${n}`
  const child=spawn(process.execPath,['--import','tsx',entry],{env:{...process.env,...env,PORT:String(n)},stdio:['ignore','ignore','inherit']});children.push(child)
  for(let i=0;i<200;i++){if(await fetch('http://'+host+path).then(r=>r.status===status).catch(()=>false))return host;await delay(100)}
  throw Error('start '+entry)}
function ticket(uid,name){const body=Buffer.from(JSON.stringify({uid,name,exp:Math.floor(Date.now()/1000)+50})).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url')}
const shot=async(page,name)=>{await page.screenshot({path:`${out}/${name}.png`});console.log('shot',name)}
async function run(){
  await mkdir(out,{recursive:true})
  database=await fixture({postgresOnly:true})
  const client=new pg.Client({connectionString:database.env.DATABASE_URL});await client.connect()
  await importWords(client)
  await client.query("update chat_settings set config=config||'{\"unmoderated_policy\":\"local_only\",\"world_ms\":0,\"near_ms\":0}'")
  const rt=await service('rt/server-realtime.mjs',{...database.env,RT_JOIN_SECRET:secret,RT_ADMIN_TOKEN:secret,RT_MAX_PENDING_PER_IP:'0'},'/health',200)
  const number=await port(),origin=`http://127.0.0.1:${number}`
  const api=await service('server/index.mjs',{...database.env,PUBLIC_ORIGIN:origin,RT_JOIN_SECRET:secret,RT_ADMIN_TOKEN:secret,RT_INTERNAL_URL:'http://'+rt},'/api/me',401)
  site=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:number,strictPort:true,proxy:{'/api':'http://'+api,'/ws':{target:'ws://'+rt,ws:true}}}})
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding']})
  const token=randomBytes(32).toString('hex')
  await database.sql("INSERT INTO users(id,email,nickname,salt,digest,verified,role) VALUES($1,$2,$3,'','',1,'admin')",['me','me@example.test','漓江边的我'])
  await database.sql('INSERT INTO sessions VALUES($1,$2,unixepoch()+3600)',[createHash('sha256').update(token).digest('hex'),'me'])
  const myUid=Number((await client.query("select uid from users where id='me'")).rows[0].uid)
  const context=await browser.newContext({viewport:{width:1280,height:720}})
  await context.addCookies([{name:'glol_session',value:token,url:origin,httpOnly:true}])
  await context.addInitScript(a=>{localStorage.setItem('glol.avatar.v1',JSON.stringify(a));localStorage.removeItem('glol.chat.box');addEventListener('DOMContentLoaded',()=>{const st=document.createElement('style');st.textContent='.chat-dock *,.chat-dock{transition:none!important}';document.head.append(st)})},appearance)
  const page=await context.newPage();page.setDefaultTimeout(150000)
  page.on('pageerror',e=>console.log('pageerror',e.message))
  await page.goto(origin+'/?verify&mode=walk&flow=0&mp=1&time=15')
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:150000})
  await page.waitForFunction(()=>window.viewer.walk.net?.status().state==='online',null,{timeout:60000})
  const c=await page.evaluate(()=>window.viewer.walk.probe().figPos)
  const bots=[
    {uid:100231,name:'象鼻山下',dx:-1.6,dz:-7},{uid:100488,name:'阿桂',dx:2.2,dz:-12},{uid:100512,name:'骑车的小周',dx:-4,dz:-22},
    {uid:100777,name:'正阳街吃米粉',dx:180,dz:260},{uid:100901,name:'Tourist_Lee',dx:-620,dz:-410},{uid:100090,name:'两江四湖',dx:900,dz:1300}]
  for(const b of bots){const ws=new WebSocket(`ws://${rt}/ws`);sockets.push(ws);b.acks=[];ws.on('message',raw=>{const m=JSON.parse(raw);if(m.t==='chat_ack')b.acks.push(m);if(!['pos','roster','online','join','leave','players','avatar'].includes(m.t))console.log('bot',b.name,raw.toString().slice(0,200))});await once(ws,'open')
    b.pose={x:c[0]+b.dx,y:c[1],z:c[2]+b.dz,yaw:1,v:0,gr:1}
    ws.send(JSON.stringify({t:'join',ticket:ticket(b.uid,b.name),avatar:b.uid%2?look2:appearance,...b.pose}));b.ws=ws;await delay(80)}
  timer=setInterval(()=>{for(const b of bots)b.ws.send(JSON.stringify({t:'pos',...b.pose}))},200)
  await delay(800)
  const say=async(b,ch,text)=>{b.ws.send(JSON.stringify({t:'chat',ch,text,cid:randomBytes(6).toString('hex')}));await delay(260)}
  const [xiang,agui,zhou,mifen,lee,lianjiang]=bots
  await say(mifen,'world','有人知道正阳步行街哪家米粉最地道吗？')
  await say(lee,'world','Hello from 两江四湖! The night view is amazing')
  await say(lianjiang,'world','日月双塔这边灯亮了，过来拍照的可以来')
  await say(agui,'world','正阳街口那家老字号，卤水够香')
  await say(xiang,'near','你也在象鼻山这边啊')
  await say(zhou,'near','我骑车绕一圈漓江，有一起的吗')
  await say(agui,'near','等我一下，马上到')
  await say(mifen,'world','加我qq 123456789 带你刷金币')            // 导流 → 待复核
  await say(lee,'world','这是一条测试复核的消息 微信号 abcdef123')   // 导流 → 待复核
  console.log('acks after say',JSON.stringify(bots.map(b=>b.acks)))
  const admin=(path,body,method=body?'POST':'GET')=>fetch(`http://${rt}/admin/chat`,{method:'POST',headers:{'X-Admin-Token':secret},body:JSON.stringify({method,actor:'me',path,params:{},body:body&&{reason:'截图',...body}})}).then(r=>r.json())
  await admin('notice',{ch:'world',text:'今晚 20:00 两江四湖灯光秀开始，欢迎来逛。文明聊天，共建网上桂林。'})
  await delay(600)
  await page.evaluate(()=>window.viewer.walk.net?.status())
  await delay(1500)
  await shot(page,'01-bubble')
  await page.keyboard.press('Enter');await delay(900)
  await shot(page,'02-world')
  await page.locator('.chat-tab[data-ch="near"]').click();await delay(1200)
  await shot(page,'03-near')
  // 自己说一句
  await page.locator('.chat-input').fill('大家好，我也在象鼻山');await page.keyboard.press('Enter');await delay(1200)
  // 违规 → 被拦截提示
  await page.locator('.chat-tab[data-ch="world"]').click();await delay(800)
  await page.locator('.chat-input').fill('法轮功');await page.keyboard.press('Enter');await delay(1200)
  console.log('tabs',await page.evaluate(()=>[...document.querySelectorAll('.chat-tab')].map(t=>t.dataset.ch+':'+t.getAttribute('aria-selected')).join(' ')))
  await shot(page,'04-blocked')
  // 拖动 + 调高
  const head=await page.locator('.chat-head').boundingBox()
  await page.mouse.move(head.x+head.width-50,head.y+12);await page.mouse.down();await page.mouse.move(head.x+head.width+180,head.y-120,{steps:8});await page.mouse.up()
  const grip=await page.locator('.chat-grip').boundingBox()
  await page.mouse.move(grip.x+grip.width/2,grip.y+6);await page.mouse.down();await page.mouse.move(grip.x+grip.width/2,grip.y-100,{steps:8});await page.mouse.up();await delay(500)
  await shot(page,'05-dragged')
  console.log('box',await page.evaluate(()=>localStorage.getItem('glol.chat.box')))
  await page.locator('.chat-panel').dblclick({position:{x:60,y:20}}).catch(()=>{})
  // 禁言
  await admin('mute',{uid:myUid,minutes:720,reason:'刷屏'});await delay(1000)
  await shot(page,'06-muted')
  await admin('unmute',{uid:myUid});await delay(500)
  await page.keyboard.press('Escape');await delay(500)
  await shot(page,'07-collapsed-again')
  // 手机横屏
  const phone=await browser.newContext({viewport:{width:844,height:390},deviceScaleFactor:2,isMobile:true,hasTouch:true})
  await phone.addCookies([{name:'glol_session',value:token,url:origin,httpOnly:true}])
  await phone.addInitScript(a=>{localStorage.setItem('glol.avatar.v1',JSON.stringify(a));addEventListener('DOMContentLoaded',()=>{const st=document.createElement('style');st.textContent='.chat-dock *,.chat-dock{transition:none!important}';document.head.append(st)})},appearance)
  await page.close()
  const mobile=await phone.newPage();mobile.setDefaultTimeout(150000)
  await mobile.goto(origin+'/?verify&mode=walk&flow=0&mp=1&time=15')
  await mobile.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:150000})
  await mobile.waitForFunction(()=>window.viewer.walk.net?.status().state==='online',null,{timeout:60000})
  await say(agui,'world','手机上也能聊天了');await delay(2000)
  await shot(mobile,'08-mobile-bubble')
  await mobile.locator('.chat-bubble').tap();await delay(1200)
  await shot(mobile,'09-mobile-panel')
  await phone.close()
  // 管理后台
  const desk=await browser.newContext({viewport:{width:1440,height:900}})
  await desk.addCookies([{name:'glol_session',value:token,url:origin,httpOnly:true}])
  const ad=await desk.newPage();ad.setDefaultTimeout(60000);ad.on('pageerror',e=>console.log('pageerror',e.message))
  await ad.goto(origin+'/admin/?view=chat');await ad.waitForSelector('.adm-chat-table');await delay(800)
  await shot(ad,'10-admin-messages')
  await ad.locator('.adm-chat-row',{hasText:'正阳街口'}).getByRole('button',{name:'上下文'}).click();await delay(900)
  await shot(ad,'11-admin-context')
  await ad.keyboard.press('Escape');await delay(300)
  await ad.locator('.adm-chat-row',{hasText:'骑车绕'}).getByRole('button',{name:'禁言'}).click();await delay(500)
  await ad.locator('.adm-chat-presets button',{hasText:'自定义'}).click();await ad.locator('.adm-dialog .adm-chat-num').fill('90')
  await shot(ad,'12-admin-mute-dialog')
  await ad.locator('.adm-dialog textarea').fill('骚扰其他玩家');await ad.locator('.adm-dialog button[type=submit]').click();await delay(900)
  await ad.goto(origin+'/admin/?view=chat&tab=reviews');await ad.waitForSelector('.adm-chat-table');await delay(600)
  await shot(ad,'13-admin-reviews')
  await ad.goto(origin+'/admin/?view=chat&tab=mutes');await ad.waitForSelector('.adm-chat-mutes');await delay(600)
  await shot(ad,'14-admin-mutes')
  await ad.goto(origin+'/admin/?view=chat&tab=words&wq=%E8%B1%A1');await ad.waitForSelector('.adm-chat-words, .adm-empty');await delay(600)
  await shot(ad,'15-admin-words')
  await ad.goto(origin+'/admin/?view=chat&tab=settings');await ad.waitForSelector('.adm-chat-form');await delay(600)
  await ad.locator('.adm-chat-notice').fill('维护通知：今晚 23:00 联机服务重启约 1 分钟')
  await shot(ad,'16-admin-settings')
  await ad.goto(origin+'/admin/?view=audit&target_type=chat');await ad.waitForSelector('.adm-audit');await delay(600)
  await shot(ad,'17-admin-audit')
  await ad.setViewportSize({width:390,height:844});await ad.goto(origin+'/admin/?view=chat');await ad.waitForSelector('.adm-chat-table');await delay(600)
  await shot(ad,'18-admin-mobile')
  console.log('bot acks',bots.map(b=>b.acks.map(a=>a.code??'ok').join(',')).join(' | '))
  await client.end()
}
try{await run()}finally{clearInterval(timer);sockets.forEach(s=>s.terminate());await browser?.close();await site?.close();for(const ch of children)if(ch.exitCode===null)ch.kill();await database?.close()}
