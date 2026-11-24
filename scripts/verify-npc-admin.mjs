import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createHash,randomBytes} from 'node:crypto'
import {once} from 'node:events'
import {createServer} from 'node:net'
import {mkdir,readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {gunzipSync} from 'node:zlib'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {fixture} from './selfhost-test.mjs'
import {browserOptions} from './qa-browser.mjs'
import {Traffic} from '../web/src/traffic/sim.ts'

const storage=await fixture({postgresOnly:true});let service,web,browser
try{
  const token=randomBytes(32).toString('hex')
  await storage.sql("insert into users(id,email,nickname,salt,digest,verified,role) values('npc_admin','npc@example.test','NPC test','','',1,'admin')")
  await storage.sql("insert into sessions values($1,'npc_admin',unixepoch()+600)",[createHash('sha256').update(token).digest('hex')])
  const listener=createServer().listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(done=>listener.close(done))
  const target=`http://127.0.0.1:${port}`
  web=await preview({root:'web',configFile:false,build:{outDir:resolve('dist')},preview:{host:'127.0.0.1',port:0,proxy:{'/api':target}}})
  const origin=`http://127.0.0.1:${web.httpServer.address().port}`
  service=spawn(process.execPath,['--import','tsx','server/index.mjs'],{env:{...process.env,...storage.env,PUBLIC_ORIGIN:origin,PORT:String(port)},stdio:'inherit'})
  for(let attempt=0;attempt<100;attempt++){if(await fetch(target+'/api/npc').then(response=>response.ok).catch(()=>false))break;await delay(100)}
  const previous=await fetch(origin+'/api/npc');assert.equal(previous.status,200);assert.equal((await previous.json()).carMax,2)
  browser=await chromium.launch(browserOptions());const admin=await browser.newContext({viewport:{width:1280,height:1400}})
  await admin.addCookies([{name:'glol_session',value:token,url:origin}]);const page=await admin.newPage();await page.goto(origin+'/admin/?view=npc');await page.locator('.adm-npc input').first().waitFor()
  for(const label of ['每街最少车辆','每街最多车辆','每街最少行人','每街最多行人'])await page.getByLabel(label).fill('1')
  const saved=page.waitForResponse(response=>response.url().endsWith('/api/admin/npc')&&response.request().method()==='POST');await page.getByRole('button',{name:'保存',exact:true}).click();assert.equal((await saved).status(),200)
  await mkdir('captures/npc',{recursive:true});await page.screenshot({path:'captures/npc/admin.png',fullPage:true});await admin.close()
  const fresh=await browser.newContext(),client=await fresh.newPage();const settings=await (await client.request.get(origin+'/api/npc',{headers:{'If-None-Match':previous.headers.get('etag')}})).json()
  assert.deepEqual([settings.carMin,settings.carMax,settings.personMin,settings.personMax],[1,1,1,1]);const graph=JSON.parse(gunzipSync(await readFile('public/world/roads/-2_-1.json.gz')))
  const sim=new Traffic(graph,Math.random,100,settings);for(let tick=0;tick<40;tick++)sim.step(.05,{x:-583,y:155,z:-98})
  const street=sim.actors.filter(actor=>actor.track.street==='解放东路');assert.equal(street.filter(actor=>actor.kind==='person').length,1);assert.equal(street.filter(actor=>actor.kind!=='person').length,1);console.log('PostgreSQL + admin form + new public reader + traffic cell: 1 vehicle / 1 pedestrian')
}finally{await browser?.close();await web?.close();if(service&&service.exitCode===null&&service.signalCode===null){const ended=once(service,'exit');service.kill();await ended}await storage.close()}
