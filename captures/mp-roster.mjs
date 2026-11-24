// IDOK-222 shots: 名牌 / 同城在线名册 / 地图上的玩家。One real browser player + raw-socket bots.
// CHROMIUM=/usr/bin/chromium node captures/mp-roster.mjs  (needs npm run build, public/world)
import {randomBytes,createHash,createHmac} from 'node:crypto'
import {spawn} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import {once} from 'node:events'
import {createServer} from 'node:net'
import {setTimeout as delay} from 'node:timers/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import WebSocket from 'ws'
import {fixture} from '../scripts/selfhost-test.mjs'

const secret=randomBytes(32).toString('hex'),children=[],sockets=[]
const appearance={body:'f',v:1,createdAt:123,skin:2,face:1,brows:0,eyes:0,hair:'f_bun',hairColor:1,look:'sport'}
const look2={body:'m',v:1,createdAt:124,skin:1,face:0,brows:0,eyes:0,hair:'m_short',hairColor:0,look:'casual'}
let database,site,browser,timer
async function port(){const s=createServer().listen(0,'127.0.0.1');await once(s,'listening');const n=s.address().port;await new Promise(d=>s.close(d));return n}
async function service(entry,env,path,status){const n=await port(),host=`127.0.0.1:${n}`
  const child=spawn(process.execPath,['--import','tsx',entry],{env:{...process.env,...env,PORT:String(n)},stdio:'ignore'});children.push(child)
  for(let i=0;i<150;i++){if(await fetch('http://'+host+path).then(r=>r.status===status).catch(()=>false))return host;await delay(100)}
  throw Error('start '+entry)}
function ticket(uid,name){const body=Buffer.from(JSON.stringify({uid,name,exp:Math.floor(Date.now()/1000)+60})).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url')}
async function run(){
  database=await fixture({postgresOnly:true})
  const rt=await service('rt/server-realtime.mjs',{RT_JOIN_SECRET:secret},'/health',200)
  const number=await port(),origin=`http://127.0.0.1:${number}`
  const api=await service('server/index.mjs',{...database.env,PUBLIC_ORIGIN:origin,RT_JOIN_SECRET:secret},'/api/me',401)
  site=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:number,strictPort:true,proxy:{'/api':'http://'+api,'/ws':{target:'ws://'+rt,ws:true}}}})
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding']})
  const page=await browser.newPage({viewport:{width:1280,height:720}});page.setDefaultTimeout(150000)
  page.on('pageerror',e=>console.log('pageerror',e.message))
  const token=randomBytes(32).toString('hex');await database.sql('INSERT INTO users(id,email,nickname,salt,digest,verified) VALUES($1,$2,$3,\'\',\'\',1)',['me','me@example.test','漓江边的我']);await database.sql('INSERT INTO sessions VALUES($1,$2,unixepoch()+600)',[createHash('sha256').update(token).digest('hex'),'me'])
  await page.context().addCookies([{name:'glol_session',value:token,url:origin,httpOnly:true}]);await page.addInitScript(a=>localStorage.setItem('glol.avatar.v1',JSON.stringify(a)),appearance)
  await page.goto(origin+'/?verify&mode=walk&flow=0&mp=1&time=15')
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:150000})
  console.log('enter',await page.evaluate(async()=>window.viewer.walk.enter(-309,-1,0,'mp-shot')))
  await page.waitForFunction(()=>window.viewer.walk.net?.status().state==='online',null,{timeout:60000})
  const c=await page.evaluate(()=>window.viewer.walk.probe().figPos)
  const bots=[
    {uid:100231,name:'象鼻山下',dx:-1.6,dz:-7,yaw:Math.PI},{uid:100488,name:'阿桂',dx:2.2,dz:-12,yaw:2.6},{uid:100512,name:'骑车的小周',dx:-4,dz:-22,yaw:.4,v:4.2},
    {uid:100777,name:'正阳街吃米粉',dx:180,dz:260,yaw:1},{uid:100901,name:'Tourist_Lee',dx:-620,dz:-410,yaw:2,v:1.3},{uid:100090,name:'两江四湖',dx:900,dz:1300,yaw:0,v:0}]
  for(const b of bots){const ws=new WebSocket(`ws://${rt}/ws`);sockets.push(ws);await once(ws,'open')
    b.pose={x:c[0]+b.dx,y:c[1],z:c[2]+b.dz,yaw:b.yaw,v:b.v??0,gr:1}
    ws.send(JSON.stringify({t:'join',ticket:ticket(b.uid,b.name),avatar:b.uid%2?look2:appearance,...b.pose}));b.ws=ws;await delay(50)}
  timer=setInterval(()=>{for(const b of bots)b.ws.send(JSON.stringify({t:'pos',...b.pose,bike:b.uid===100512?'bike':'',bx:b.pose.x,bz:b.pose.z,byaw:b.yaw}))},100)
  await page.waitForFunction(()=>window.viewer.walk.net.probe().filter(p=>p.ready).length>=3,null,{timeout:120000})
  await delay(4000)
  await mkdir('captures/mp',{recursive:true})
  await page.screenshot({path:'captures/mp/idok222-nameplates.png'});console.log('nameplates')
  await page.locator('.hud-stat--mp').click();await delay(1200)
  await page.screenshot({path:'captures/mp/idok222-roster.png'});console.log('roster')
  console.log(await page.locator('.mp-roster').innerText())
  console.log('locate',await page.evaluate(async()=>{const b=[...document.querySelectorAll('.mp-roster-row')].find(x=>x.textContent.includes('正阳街吃米粉'));b.click();await new Promise(r=>setTimeout(r,2500));const a=document.querySelector('.atlas');return {atlas:!!a,hidden:a?.hidden}}));await page.waitForFunction(()=>document.querySelector('.atlas.show')&&document.querySelector('.atlas-pop')?.textContent,null,{timeout:60000});await delay(3000)
  await page.screenshot({path:'captures/mp/idok222-map.png'});console.log('map')
  await page.keyboard.press('Escape');await delay(500)
  await page.setViewportSize({width:844,height:390});await delay(2500)
  await page.screenshot({path:'captures/mp/idok222-mobile-hud.png'})
}
try{await run()}finally{clearInterval(timer);sockets.forEach(s=>s.terminate());await browser?.close();await site?.close();for(const ch of children)if(ch.exitCode===null)ch.kill();await database?.close()}
