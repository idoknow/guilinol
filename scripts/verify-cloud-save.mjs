import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {randomBytes, createHash} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import pg from 'pg'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'
import {database} from '../server/postgres.mjs'
import {onRequest} from '../functions/api/[[path]].ts'

const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8'}).trim()
const password=randomBytes(16).toString('hex')
const container=docker('run','--pull=never','--rm','-d','--label','project=idoknow/guilinol','-e',`POSTGRES_PASSWORD=${password}`,'-p','127.0.0.1::5432','postgres:16-alpine')
let pool,server,browser
try {
  pool=new pg.Pool({host:'127.0.0.1',port:Number(docker('port',container,'5432/tcp').split(':').at(-1)),user:'postgres',database:'postgres',password})
  for(let attempt=0;;attempt++)try{await pool.query('SELECT 1');break}catch(error){if(attempt>=80)throw error;await delay(250)}
  for(const file of ['001-schema.sql','003-player-saves.sql','004-social.sql'])await pool.query(await readFile('deploy/postgres/'+file,'utf8'))
  const token=randomBytes(32).toString('hex')
  await pool.query("INSERT INTO users(id,email,nickname,salt,digest,verified) VALUES('test','test@example.invalid','test','','',1)")
  await pool.query("INSERT INTO sessions VALUES($1,'test',unixepoch()+600)",[createHash('sha256').update(token).digest('hex')])
  const DB=database(pool)
  server=await createServer({root:'web',configFile:'web/vite.config.ts',server:{host:'127.0.0.1',port:0},plugins:[{name:'cloud-test',configureServer(vite){
    vite.middlewares.use(async(req,res,next)=>{
      if(!req.url.startsWith('/api/'))return next()
      const chunks=[];for await(const chunk of req)chunks.push(chunk)
      const response=await onRequest({request:new Request('http://'+req.headers.host+req.url,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})}),env:{DB}})
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text())
    })
  }}]})
  await server.listen()
  const url=`http://127.0.0.1:${server.httpServer.address().port}`
  browser=await chromium.launch(browserOptions())
  const open=async(signedIn)=>{
    const context=await browser.newContext();if(signedIn)await context.addCookies([{name:'glol_session',value:token,url}])
    const page=await context.newPage();await page.goto(url);if(signedIn)await page.waitForFunction(()=>localStorage.getItem('glol.save.owner')==='test')
    return page
  }
  const edit=(page,money)=>page.evaluate(async money=>{
    const {loadLocalSave,persistSaveSync}=await import('/src/game/save.ts');const {save}=loadLocalSave();save.money=money;save.updatedAt=Date.now();persistSaveSync(save)
  },money)
  const stored=async()=>JSON.parse((await pool.query('SELECT payload_json FROM player_saves')).rows[0]?.payload_json??'null')
  const waitDB=async money=>{for(let attempt=0;;attempt++){if((await stored())?.money===money)return;if(attempt>=100)assert.fail(`Expected ${money} in Postgres`);await delay(100)}}
  const waitLocal=(page,money)=>page.waitForFunction(money=>JSON.parse(localStorage.getItem('glol.save.v1'))?.money===money,money)
  const guest=await open(false);await edit(guest,10);assert.equal(await stored(),null)
  const first=await open(true);await edit(first,400);await waitDB(400)
  const second=await open(true);await waitLocal(second,400)
  await first.context().setOffline(true);await edit(second,500);await waitDB(500);await edit(first,600);await waitLocal(first,600)
  await first.context().setOffline(false);await waitDB(600)
  await second.evaluate(()=>window.dispatchEvent(new Event('focus')));await waitLocal(second,600)
  await first.context().setOffline(true);await edit(first,700);await edit(second,800);await waitDB(800)
  await first.context().setOffline(false);await waitLocal(first,800)
  assert.equal((await guest.request.get(url+'/api/me/save')).status(),401)
  assert.equal((await first.request.get(url+'/api/me/save',{headers:{'X-Save-Owner':'other'}})).status(),409)
  console.log('PostgreSQL 16: two contexts synchronized; offline/local and remote winners converged; guest and owner isolation passed')
}finally{await browser?.close();await server?.close();await pool?.end();docker('stop','--time','1',container)}
