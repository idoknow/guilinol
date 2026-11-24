// IDOK-222 admin「联机」shots: real rt + api + vite dev, bot players over ws, seeded history/sessions.
// DATABASE_URL=… CHROMIUM=/usr/bin/chromium node captures/admin-mp.mjs
import {randomBytes,createHash,createHmac,randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import {once} from 'node:events'
import {createServer as net} from 'node:net'
import {setTimeout as delay} from 'node:timers/promises'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import WebSocket from 'ws'
import pg from 'pg'
import {fixture} from '../scripts/selfhost-test.mjs'

const secret=randomUUID(),children=[],sockets=[]
let storage,vite,browser,timer
async function port(){const s=net().listen(0,'127.0.0.1');await once(s,'listening');const n=s.address().port;await new Promise(d=>s.close(d));return n}
async function service(entry,env,path){const n=await port(),base=`http://127.0.0.1:${n}`
  const child=spawn(process.execPath,['--import','tsx',entry],{env:{...process.env,...storage.env,...env,PORT:String(n)},stdio:'ignore'});children.push(child)
  for(let i=0;i<200;i++){if(await fetch(base+path).then(()=>true).catch(()=>false))return base;await delay(100)}
  throw Error('start '+entry)}
const ticket=(uid,name)=>{const body=Buffer.from(JSON.stringify({uid,name,exp:Math.floor(Date.now()/1000)+60})).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url')}
async function run(){
  storage=await fixture({postgresOnly:true});const pool=new pg.Pool({connectionString:storage.env.DATABASE_URL})
  const vport=await port(),origin=`http://127.0.0.1:${vport}`
  const rt=await service('rt/server-realtime.mjs',{RT_ADMIN_TOKEN:secret,RT_JOIN_SECRET:secret,KICK_TOKEN:secret},'/health')
  // players: accounts + region rows
  await pool.query(`insert into perf_network values('192.0.2.0/24','CN','广西','桂林','中国电信'),('198.51.100.0/24','CN','广东','深圳','中国移动'),('203.0.113.0/24','US','California','Los Angeles','Comcast')`)
  const people=[['漓江边的我','192.0.2.10',-309,-6,'walk'],['象鼻山下','192.0.2.11',-300,-14,'walk'],['骑车的小周','198.51.100.7',-280,-40,'bike'],['正阳街吃米粉','192.0.2.30',-130,250,'walk'],['Tourist_Lee','203.0.113.9',-900,-420,'walk'],['两江四湖','198.51.100.8',560,1250,'walk']]
  const uids=[]
  for(const [i,[name,ip]] of people.entries()){
    const {rows:[{uid}]}=await pool.query(`insert into users(id,email,nickname,salt,digest,verified,role,signup_method) values($1,$2,$3,'','',1,$4,$5) returning uid`,['u'+i,`u${i}@example.test`,name,i?'user':'admin',i%2?'wx':'email'])
    uids.push(Number(uid))
    const ws=new WebSocket(rt.replace('http','ws')+'/ws',{headers:{'x-forwarded-for':ip,'user-agent':i%2?'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 MicroMessenger/8.0':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36'}})
    sockets.push(ws);await once(ws,'open')
    ws.send(JSON.stringify({t:'join',ticket:ticket(Number(uid),name),x:people[i][2],y:150,z:people[i][3],yaw:i}));await once(ws,'message')
  }
  sockets[1].send(JSON.stringify({t:'chat',text:'有人一起去象鼻山吗'}));await delay(1300);sockets[3].send(JSON.stringify({t:'chat',text:'正阳街这家米粉好吃'}))
  timer=setInterval(()=>{for(const [i,ws] of sockets.entries()){const p=people[i];ws.send(JSON.stringify({t:'pos',x:p[2]+Math.sin(Date.now()/3000+i)*3,y:150,z:p[3],yaw:i,v:p[4]==='bike'?4.2:i===4?1.4:0,gr:1,bike:p[4]==='bike'?'bike':'',hp:100}))}},120)
  // a leaver + history
  const extra=new WebSocket(rt.replace('http','ws')+'/ws',{headers:{'x-forwarded-for':'192.0.2.50'}});await once(extra,'open')
  const {rows:[{uid:xuid}]}=await pool.query(`insert into users(id,email,nickname,salt,digest,verified) values('ux','ux@example.test','路过的游客','','',1) returning uid`)
  extra.send(JSON.stringify({t:'join',ticket:ticket(Number(xuid),'路过的游客'),x:0,y:150,z:0,yaw:0}));await once(extra,'message');await delay(2500);extra.close()
  await pool.query(`insert into mp_online_minute select g, greatest(0,round(4+3*sin(extract(epoch from g)/5400.0)+random()*2))::int, 8, 60+random()*40, 100000 from generate_series(date_trunc('minute',now()-interval '24 hours'),date_trunc('minute',now()-interval '2 minutes'),'1 minute') g on conflict do nothing`)
  await pool.query(`insert into mp_sessions select 1, 'h'||i, $1::bigint+(i%5), '历史玩家'||(i%5), now()-(i*25||' minutes')::interval, now()-(i*25||' minutes')::interval+((5+i%40)||' minutes')::interval, now(), 'normal', 1001, '{"country":"CN","region":"广西","city":"桂林","isp":"中国电信"}' from generate_series(1,40) i`,[uids[1]])
  const api=await service('server/index.mjs',{RT_INTERNAL_URL:rt,RT_ADMIN_TOKEN:secret,KICK_TOKEN:secret,PUBLIC_ORIGIN:origin,MP_WORLD_MANIFEST_URL:`${origin}/world/manifest.json`},'/api/health')
  vite=await createServer({configFile:'web/vite.config.ts',root:'web',server:{host:'127.0.0.1',port:vport,strictPort:true,proxy:{'/api':api}},logLevel:'error'});await vite.listen()
  await delay(65000) // one api sample → sessions
  const token=randomBytes(32).toString('hex');await pool.query('insert into sessions values($1,$2,unixepoch()+3600)',[createHash('sha256').update(token).digest('hex'),'u0'])
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader']})
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(120000)
  page.on('pageerror',e=>console.log('pageerror',e.message))
  await page.context().addCookies([{name:'glol_session',value:token,url:origin,httpOnly:true}])
  await mkdir('captures/admin',{recursive:true})
  await page.goto(origin+'/admin/?view=mp');await page.waitForSelector('.adm-mp-map .adm-mp-dot');await page.waitForSelector('.adm-chart svg');await delay(3000)
  await page.screenshot({path:'captures/admin/idok222-admin-mp-top.png'})
  console.log('full');return
  await page.locator('.adm-mp-table button',{hasText:'踢出'}).nth(5).click();await page.waitForSelector('dialog.adm-dialog');await delay(500)
  await page.screenshot({path:'captures/admin/idok222-admin-mp-kick.png'});console.log('kick')
  await page.locator('dialog textarea').fill('测试踢出');await page.locator('dialog button[type=submit]').click();await delay(2500)
  console.log('after kick',await page.locator('.adm-toasts').innerText())
  await page.setViewportSize({width:390,height:844});await delay(1500);await page.screenshot({path:'captures/admin/idok222-admin-mp-mobile.png',fullPage:false});console.log('mobile')
  await pool.end()
}
try{await run()}finally{clearInterval(timer);sockets.forEach(s=>s.terminate());await browser?.close();await vite?.close();for(const c of children)if(c.exitCode===null)c.kill();await storage?.close()}
