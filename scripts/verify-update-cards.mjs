import 'tsx/esm'
import assert from 'node:assert/strict'
import {randomBytes,createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import pg from 'pg'
import {serve} from '@hono/node-server'
import {build} from 'esbuild'
import {chromium} from 'playwright'
import {database} from '../server/postgres.mjs'
const {onRequest}=await import('../functions/api/[[path]].ts'),{cardRoutes}=await import('../server/update-cards.mjs')
const connectionString=process.env.UPDATE_CARDS_TEST_DB
assert(connectionString && ['127.0.0.1','localhost','[::1]'].includes(new URL(connectionString).hostname),'Set UPDATE_CARDS_TEST_DB to a disposable local PostgreSQL database')
const schema='cards_'+randomBytes(8).toString('hex'),admin=new pg.Pool({connectionString}),pool=new pg.Pool({connectionString,options:`-c search_path=${schema}`})
const objects=new Map(),token=randomBytes(32).toString('hex'),cookie=randomBytes(32).toString('hex')
const env={DB:database(pool),UPDATE_CARD_TOKEN:token,FEEDBACK:{put:(key,value)=>objects.set(key,value),get:key=>({body:objects.get(key)}),delete:keys=>keys.forEach(key=>objects.delete(key))}}
env.updateCards=cardRoutes(pool,env)
let server,browser
try{
  await admin.query(`CREATE SCHEMA ${schema}`)
  await pool.query(`CREATE TABLE users(id text PRIMARY KEY,created_at int,uid int,email text,nickname text,verified int,role text,notify_email int,email_placeholder int,banned_at int,ban_reason text);
    CREATE TABLE player_saves(user_id text); CREATE TABLE sessions(user_id text,digest text,expires bigint);
    INSERT INTO users VALUES ('player',0,1,'','',1,'user',0,0,0,'');`)
  await pool.query(await readFile('deploy/postgres/019-update-cards.sql','utf8'))
  await pool.query(`INSERT INTO sessions VALUES('player',$1,4102444800)`,[createHash('sha256').update(cookie).digest('hex')])
  const bundle=(await build({stdin:{contents:`import {startCards} from './web/src/ui/update-cards'; startCards(true).then(()=>window.finished=true)`,resolveDir:process.cwd()},bundle:true,write:false,loader:{'.css':'empty'}})).outputFiles[0].text
  server=serve({hostname:'127.0.0.1',port:0,fetch:request=>{
    const path=new URL(request.url).pathname
    if(path==='/')return new Response('<body><script src="/ui.js"></script></body>',{headers:{'content-type':'text/html'}})
    if(path==='/ui.js')return new Response(bundle,{headers:{'content-type':'text/javascript'}})
    return onRequest({env,request})
  }})
  if(!server.listening)await new Promise(resolve=>server.once('listening',resolve))
  const origin=`http://127.0.0.1:${server.address().port}`
  const cli=async(...args)=>JSON.parse((await promisify(execFile)(process.execPath,['scripts/publish-update-card.mjs',...args],{env:{...process.env,UPDATE_CARD_TOKEN:token,UPDATE_CARD_ORIGIN:origin}})).stdout)
  const publish=title=>cli('--kind','modeling','--title',title,'--slug',title,'--summary','新模型','--how','走到广场','--release','abcd123','--image','public/apple-touch-icon.png')
  const before=await publish('before'); assert.equal((await fetch(origin+before.images[0])).headers.get('content-type'),'image/webp')
  browser=await chromium.launch({executablePath:process.env.CHROMIUM})
  const page=await browser.newPage();page.on('response',res=>{if(res.status()>=400)console.error(res.status(),res.url())});page.on('pageerror',console.error)
  const empty=async()=>{await page.goto(origin);await page.waitForFunction(()=>window.finished);assert.equal(await page.locator('dialog').count(),0)}
  await empty();assert.equal((await pool.query('select first_game_entry from users')).rows[0].first_game_entry,null)
  await page.context().addCookies([{url:origin,name:'glol_session',value:cookie}]);await empty()
  const first=await publish('first');await page.goto(origin);await page.getByRole('heading',{name:'first'}).waitFor();await page.locator('.update-cards-next').click();await page.waitForFunction(()=>window.finished);await empty()
  const seen=()=>fetch(`${origin}/api/updates/${first.id}/seen`,{method:'POST',headers:{origin,cookie:`glol_session=${cookie}`},body:JSON.stringify({action:'skipped'})})
  assert.equal((await seen()).status,200);assert.deepEqual((await pool.query('SELECT action FROM update_card_views')).rows,[{action:'viewed'}])
  for(const name of ['one','two','three','off'])await publish(name)
  assert.equal((await cli('--list')).length,6);assert.equal((await cli('--deactivate','off')).active,false)
  await page.addInitScript(()=>{document.addEventListener('DOMContentLoaded',()=>{document.body.dataset.photo='on'})})
  await page.goto(origin);await page.waitForTimeout(400);assert.equal(await page.locator('dialog').count(),0);await page.evaluate(()=>delete document.body.dataset.photo)
  await page.getByRole('heading',{name:'one'}).waitFor();await page.getByText('跳过全部').click();await page.waitForFunction(()=>window.finished);await empty()
  assert.deepEqual((await pool.query('SELECT action FROM update_card_views ORDER BY at')).rows.map(row=>row.action),['viewed','viewed','skipped','skipped'])
  assert.equal((await fetch(origin+'/api/admin/updates')).status,403)
  console.log('PASS: publish/image/list/deactivate, authentication, first entry, returning player, photo guard, refresh, skip and idempotent PG receipts')
}finally{
  await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end()
}
