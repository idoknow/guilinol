import assert from 'node:assert/strict'
import {createHash,createHmac} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import {build} from 'esbuild'
import {Miniflare} from 'miniflare'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {uiTest} from './feedback-test.mjs'
import {view} from './feedback-view-fixture.mjs'

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
  // 管理员定向路由：bridge/pending 与 bridge detail 带出 submitter_email/submitter_role；xiepy244@gmail.com 管理员直提非申诉自动 approved 且免 5 条限额
  const bossToken='c'.repeat(64),bossDigest=createHash('sha256').update(bossToken).digest('hex')
  await db.prepare("INSERT INTO users(id,email,nickname,salt,digest,verified,role) VALUES('boss','xiepy244@gmail.com','py','','',1,'admin')").run()
  await db.prepare('INSERT INTO sessions VALUES(?,?,unixepoch()+3600)').bind(bossDigest,'boss').run()
  const callAs=async(path,token,data,expected=200,method=data?'POST':'GET')=>{
    const headers={Origin:'https://example.test','Content-Type':'application/json',Cookie:'glol_session='+token}
    const response=await worker.dispatchFetch('https://example.test/api/'+path,{method,headers,body:data?JSON.stringify(data):undefined})
    const body=await response.text();assert.equal(response.status,expected,`${path}: ${body}`);return body.startsWith('{')||body.startsWith('[')?JSON.parse(body):body
  }
  const pendingBefore=JSON.parse(await call('bridge/pending','bridge'))
  assert.equal(pendingBefore[0].submitter_email,'user@example.test');assert.equal(pendingBefore[0].submitter_role,'user')
  const bossIds=[]
  for(let n=0;n<6;n++){
    const created=await callAs('feedback',bossToken,{view,kind:'游戏 bug',title:`老板直提-${n}`,body:'复现步骤',lat:25.28,lon:110.3})
    const shotRes=await worker.dispatchFetch(`https://example.test/api/feedback/${created.id}/view-shot`,{method:'PUT',headers:{Origin:'https://example.test',Cookie:'glol_session='+bossToken,'Content-Type':'image/jpeg','Content-Length':String(image.length)},body:image})
    assert.equal(shotRes.status,200,await shotRes.text())
    await callAs(`feedback/${created.id}/submit`,bossToken,{})
    const detail=await callAs(`feedback/${created.id}`,bossToken)
    assert.equal(detail.status,'approved');assert.equal(detail.submitter_role,undefined)
    bossIds.push(created.id)
  }
  const bossAppeal=await callAs('feedback',bossToken,{view:null,kind:'封禁申诉',title:'封禁申诉',body:'测试',lat:25.28,lon:110.3})
  await callAs(`feedback/${bossAppeal.id}/submit`,bossToken,{})
  assert.equal((await callAs(`feedback/${bossAppeal.id}`,bossToken)).status,'submitted')
  const pendingAfter=JSON.parse(await call('bridge/pending','bridge'))
  const bossPending=pendingAfter.find(item=>item.id===bossIds[0])
  assert.equal(bossPending.submitter_email,'xiepy244@gmail.com');assert.equal(bossPending.submitter_role,'admin');assert.equal(bossPending.status,'approved')
  const bridgeDetail=await call(`feedback/${bossIds[0]}`,'bridge')
  assert.equal(bridgeDetail.email,'xiepy244@gmail.com');assert.equal(bridgeDetail.submitter_role,'admin')
  await call(`bridge/feedback/${bossIds[0]}/status`,'bridge',{status:'queued'})
  await call(`bridge/feedback/${bossIds[0]}/status`,'bridge',{status:'need_info',message:'补充复现步骤'})
  await callAs(`feedback/${bossIds[0]}/supplement`,bossToken,{body:'已补充'})
  assert.equal((await callAs(`feedback/${bossIds[0]}`,bossToken)).status,'approved')
  const byEmail=await call('admin/feedback?email=xiepy244@gmail.com','admin')
  assert.equal(byEmail.items.length,7);assert.ok(byEmail.items.every(item=>item.email==='xiepy244@gmail.com'&&item.submitter_role==='admin'))
  const byRole=await call('admin/feedback?role=admin','admin')
  assert.equal(byRole.items.length,7)
  const idx=await db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='feedback_user_status'").first()
  assert.equal(idx?.name,'feedback_user_status')
  const blankBug=(await call('feedback','user',{view,kind:'游戏 bug',title:'空描述',body:'   ',lat:25.28,lon:110.3})).id
  await call(`feedback/${blankBug}/submit`,'user',{},409)
  await call(`feedback/${blankBug}`,'user',null,200,'DELETE')
  const blankBugNoView=(await call('feedback','user',{view:null,kind:'游戏 bug',title:'无视角空描述',body:'   ',lat:25.28,lon:110.3})).id
  await call(`feedback/${blankBugNoView}/submit`,'user',{},409)
  await call(`feedback/${blankBugNoView}`,'user',null,200,'DELETE')
  await call('feedback','user',{view:null,kind:'其他',title:'非bug无视角',body:'应该被拒',lat:25.28,lon:110.3},400)
  const okBug=(await call('feedback','user',{view,kind:'游戏 bug',title:'有描述',body:'骑车过桥卡住',lat:25.28,lon:110.3})).id
  await call(`feedback/${okBug}/submit`,'user',{},200)
  const okBugNoView=(await call('feedback','user',{view:null,heading:null,landmark_id:null,kind:'游戏 bug',title:'无截图bug',body:'截屏失败但文字清楚',lat:25.28,lon:110.3})).id
  await call(`feedback/${okBugNoView}/submit`,'user',{},200)
  const bugNoViewDetail=await call(`feedback/${okBugNoView}`,'user')
  assert.equal(bugNoViewDetail.view,null);assert.equal(bugNoViewDetail.has_view_shot,false);assert.equal(bugNoViewDetail.photos.length,0)
  const okBugPhotoNoView=(await call('feedback','user',{view:null,heading:null,landmark_id:null,kind:'游戏 bug',title:'无视角带本地图',body:'上传本地截图反馈',lat:25.28,lon:110.3})).id
  const bugPhotoRes=await worker.dispatchFetch(`https://example.test/api/feedback/${okBugPhotoNoView}/photos/1`,{method:'PUT',headers:{Origin:'https://example.test',Cookie:'glol_session='+'a'.repeat(64),'Content-Type':'image/jpeg','Content-Length':String(image.length)},body:image})
  assert.equal(bugPhotoRes.status,200,await bugPhotoRes.text())
  await call(`feedback/${okBugPhotoNoView}/submit`,'user',{},200)
  const bugPhotoDetail=await call(`feedback/${okBugPhotoNoView}`,'user')
  assert.equal(bugPhotoDetail.view,null);assert.equal(bugPhotoDetail.has_view_shot,false);assert.equal(bugPhotoDetail.photos.length,1)
  const plainNoPhoto=(await call('feedback','user',{view,kind:'其他',title:'无图普通',body:'有文字无图',lat:25.28,lon:110.3})).id
  await call(`feedback/${plainNoPhoto}/submit`,'user',{},409)
  await call(`feedback/${plainNoPhoto}`,'user',null,200,'DELETE')
  console.log('Isolated Worker: approval gate, user/admin chat, reply deduplication, quota, mail debounce, bug submit guard, unsubscribe and priority admin route passed')
  if(process.argv.includes('--ui')){
    await db.prepare("UPDATE users SET email='walker@example.test' WHERE id='user'").run()
    const server=await preview({configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:0,proxy:{'/api':{target:(await worker.ready).origin,changeOrigin:true,rewriteWsOrigin:false,configure(proxy){proxy.on('proxyReq',req=>req.setHeader('Origin',(new URL(req.protocol+'//'+req.getHeader('host'))).origin))}}}}})
    let browser;try{const origin=`http://127.0.0.1:${server.httpServer.address().port}`;browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const context=await browser.newContext({viewport:{width:960,height:620}});await context.addCookies([{name:'glol_session',value:'a'.repeat(64),url:origin}]);const page=await context.newPage();await page.goto(origin+'/?verify');await page.locator('.dock-feedback').waitFor({state:'attached',timeout:120000});await uiTest(page,origin,sql=>db.prepare(sql).run())}finally{await browser?.close();await server.close()}
  }
}finally{await worker.dispose()}
