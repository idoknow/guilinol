import assert from 'node:assert/strict'
import {createHash,createHmac} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import {build} from 'esbuild'
import {Miniflare} from 'miniflare'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {uiTest} from './feedback-test.mjs'

const bundle=await build({stdin:{contents:`import {onRequest} from './functions/api/[[path]].ts';export default {fetch(request,env){return onRequest({request,env})}}`,resolveDir:process.cwd()},write:false,bundle:true,format:'esm'})
const worker=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2025-06-01',d1Databases:['DB'],r2Buckets:['FEEDBACK'],bindings:{BRIDGE_TOKEN:'local-test',EMAIL_DEV_LOG:'1'}})
try{
  const db=await worker.getD1Database('DB')
  for(const file of (await readdir('migrations')).sort()){
    const sql=await readFile('migrations/'+file,'utf8');let statement=''
    for(const line of sql.split('\n')){statement+=line+'\n';if(line.trimEnd().endsWith(';')&&(!/CREATE TRIGGER/i.test(statement)||/END;\s*$/i.test(statement))){await db.prepare(statement).run();statement=''}}
  }
  for(const role of ['user','admin']){const token=(role==='user'?'a':'b').repeat(64),digest=createHash('sha256').update(token).digest('hex');await db.prepare('INSERT INTO users(id,email,nickname,salt,digest,verified,role) VALUES(?,?,?,\'\',\'\',1,?)').bind(role,role+'@example.test',role,role).run();await db.prepare('INSERT INTO sessions VALUES(?,?,unixepoch()+3600)').bind(digest,role).run()}
  await db.prepare("INSERT INTO feedback(id,user_id,kind,title,body,lat,lon,status) VALUES('test','user','其他','桥头','',25.28,110.3,'submitted')").run()
  const call=async(path,role,data,expected=200,method=data?'POST':'GET')=>{const headers={Origin:'https://example.test','Content-Type':'application/json'};if(role==='bridge')headers.Authorization='Bearer local-test';else if(role)headers.Cookie='glol_session='+(role==='user'?'a':'b').repeat(64);const response=await worker.dispatchFetch('https://example.test/api/'+path,{method,headers,body:data?JSON.stringify(data):undefined});const body=await response.text();assert.equal(response.status,expected,`${path}: ${body}`);return body.startsWith('{')?JSON.parse(body):body}
  const path='feedback/test',admin='admin/'+path,bridge='bridge/'+path
  const image=await readFile('public/og.jpg'),uploaded=await worker.dispatchFetch('https://example.test/api/'+path+'/photos/1',{method:'PUT',headers:{Origin:'https://example.test',Cookie:'glol_session='+'a'.repeat(64),'Content-Type':'image/jpeg','Content-Length':String(image.length)},body:image});assert.equal(uploaded.status,200,await uploaded.text())
  await call(bridge+'/bind','bridge',{issue:'demo'});assert.equal((await call(path,'user')).status,'submitted')
  await call(bridge+'/status','bridge',{status:'queued'},409);await call(bridge+'/status','bridge',{status:'approved'},409);await call(admin+'/status','user',{status:'approved'},403)
  await call(bridge+'/messages','bridge',{source:'one',body:'请确认方向'});await call(bridge+'/messages','bridge',{source:'one',body:'请确认方向'});await call(admin+'/messages','admin',{body:'请看附件'});for(let index=0;index<19;index++)await call(path+'/messages','user',{body:'朝东'})
  await call(path+'/messages','user',{body:'超额'},429);assert.equal((await call(path,'user')).messages.length,21)
  await call(admin+'/status','admin',{status:'approved'});await call(bridge+'/status','bridge',{status:'queued'});assert.equal((await call(path,'user')).status,'queued')
  await call('bridge/mail','bridge',{});const mail=await db.prepare('SELECT summary,next_at FROM feedback_mail').first();assert.equal(mail.summary,'');assert.ok(mail.next_at>Date.now()/1000+590)
  await call('me','user',{notify_email:false},200,'PATCH');assert.equal((await call('me','user')).notify_email,false);await call('me','user',{notify_email:true},200,'PATCH')
  await call('unsubscribe?user=user&sig=bad',null,null,400);await call('unsubscribe?user=user&sig='+createHmac('sha256','local-test').update('feedback-unsubscribe:user').digest('hex'),null);assert.equal((await call('me','user')).notify_email,false)
  console.log('Isolated Worker: approval gate, user/admin chat, reply deduplication, quota, mail debounce and unsubscribe passed')
  if(process.argv.includes('--ui')){
    await db.prepare("UPDATE users SET email='walker@example.test' WHERE id='user'").run()
    const server=await preview({configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:0,proxy:{'/api':{target:(await worker.ready).origin,changeOrigin:true,rewriteWsOrigin:false,configure(proxy){proxy.on('proxyReq',req=>req.setHeader('Origin',(new URL(req.protocol+'//'+req.getHeader('host'))).origin))}}}}})
    let browser;try{const origin=`http://127.0.0.1:${server.httpServer.address().port}`;browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const context=await browser.newContext({viewport:{width:960,height:620}});await context.addCookies([{name:'glol_session',value:'a'.repeat(64),url:origin}]);const page=await context.newPage();await page.goto(origin+'/?verify');await page.locator('.dock-feedback').waitFor({state:'attached',timeout:120000});await uiTest(page,origin,sql=>db.prepare(sql).run())}finally{await browser?.close();await server.close()}
  }
}finally{await worker.dispose()}
