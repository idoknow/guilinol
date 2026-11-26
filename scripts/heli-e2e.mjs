import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'
import {mkdir} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {register} from 'tsx/esm/api'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
register()
const {services}=await import('../lib/helicopter-clock.ts');const {withQueueDatabase}=await import('./test-helicopter-queue.mjs'),{fixture}=await import('./heli-fixture.mjs')
await withQueueDatabase(async pool=>{
const api=await fixture(pool)
const output=process.env.HELI_CAPTURE_DIR??'captures/helicopter',server=await preview({root:'web',configFile:'web/vite.config.ts',plugins:[api.plugin],...(process.env.HELI_COMPARE_DIST?{build:{outDir:process.env.HELI_COMPARE_DIST}}:{}),preview:{host:'127.0.0.1',port:0}})
let browser
const rt=spawn(process.execPath,['rt/server-realtime.mjs'],{env:{PORT:'0',RT_BIND_HOST:'127.0.0.1',RT_JOIN_SECRET:api.secret},stdio:['ignore','pipe','inherit']})
try{
  const endpoint=await new Promise((resolve,reject)=>{rt.stdout.on('data',data=>{const url=data.toString().match(/ws:\/\/127\.0\.0\.1:\d+\/ws/);if(url)resolve(url[0])});rt.once('exit',code=>reject(Error(`RT exited: ${code}`)));rt.once('error',reject)})
  await mkdir(output,{recursive:true});browser=await chromium.launch(browserOptions(true))
  const quick=process.env.HELI_QUICK==='1',page=await browser.newPage({viewport:quick?{width:480,height:300}:{width:800,height:500}}),origin=`http://127.0.0.1:${server.httpServer.address().port}`
  const shot=async name=>{await page.screenshot({path:`${output}/${name}.jpg`,type:'jpeg',quality:80,timeout:120000});console.log('captured',name)}
  const phase=async name=>page.waitForFunction(state=>window.viewer.heli.phase===state,name,{timeout:180000})
  const other=await browser.newPage({viewport:{width:480,height:300}})
  for(const client of [page,other])client.setDefaultTimeout(45000)
  for(const client of [page,other])await client.addInitScript(url=>localStorage.setItem('guiling.ws',url),endpoint)
  for(const client of [page,other])client.on('pageerror',error=>console.error('page error:',error.message))
  for(const [client,user] of [[page,'A'],[other,'B']])await client.context().addCookies([{name:'glol_session',value:api.tokens[user],url:origin,httpOnly:true}])
  const fps=async(label)=>page.evaluate(async count=>{
    let previous=await new Promise(requestAnimationFrame);const intervals=[]
    for(let frame=0;frame<count;frame++){const next=await new Promise(requestAnimationFrame);intervals.push(next-previous);previous=next}
    intervals.sort((left,right)=>left-right);const percentile=value=>intervals[Math.ceil(count*value)-1]
    return {frames:count,fps:1000*count/intervals.reduce((sum,value)=>sum+value,0),p50:percentile(.5),p95:percentile(.95),p99:percentile(.99)}
  },quick?8:120).then(sample=>{console.log('FRAME_SAMPLE',JSON.stringify({label,...sample}));return sample.fps})
  const url=`${origin}/?verify&solo=1&mp=1&flow=0&radius=480${process.env.HELI_PROFILE?'&frameProfile':''}`
  if(process.env.HELI_B_ONLY){
    const started=Date.now(),path=request=>new URL(request.url()).pathname
    other.on('console',message=>console.log('B console',message.type(),message.text().slice(0,240)))
    other.on('requestfailed',request=>console.log('B failed',path(request),request.failure()?.errorText))
    other.on('response',response=>{if(response.status()>=400||['/api/auth/me','/api/me/save','/api/helicopter','/api/rt/ticket'].includes(path(response)))console.log('B HTTP',response.status(),path(response))})
    await other.goto(url,{waitUntil:'domcontentloaded'});await other.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:180000})
    const details=await other.evaluate(async()=>({account:(await (await fetch('/api/auth/me')).json()).id,walk:window.viewer.walk.active,position:window.viewer.walk.position.toArray(),queue:await (await fetch('/api/helicopter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'ping'})})).json()}))
    assert.equal(details.account,'B');assert.ok(details.walk);assert.equal(details.queue.code,'OK');console.log('B standalone landed',Date.now()-started,details);return
  }
  await page.goto(url,{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:120000})
  if(process.env.HELI_REWORK_CAPTURE){const {captureFlight}=await import('./heli-capture-flight.mjs');await captureFlight(page,output);return}
  if(process.env.HELI_HANDOFF_ONLY){const {handoff}=await import('./heli-handoff.mjs');await handoff({page,other,url,api,output});return}
  assert.ok(await page.evaluate(()=>window.viewer.walkTo(-844,208,-2.51,'plaza-e2e')))
  if(process.env.HELI_PROFILE){await (await import('./heli-profile.mjs')).profile(page,api,pool);return}
  const baseline=await fps('walk')
  if(process.env.HELI_PERF_ONLY){
    await page.evaluate(()=>window.viewer.walkTo(-805.8,257.6,-1.57,'benchmark'))
    const cmd=(action,fields={})=>page.evaluate(async body=>{const response=await fetch('/api/helicopter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return response.json()},{action,...fields})
    for(const mode of ['low','high','dynamic']){
      const join=await cmd('join',{mode});assert.ok(join.mine?.offered,JSON.stringify(join))
      const {flight}=await cmd('confirm',{ticket:join.mine.ticket});assert.ok(flight)
      api.advance((services[mode].ascend+15)*1000);await phase('cruise');const sampled=await fps(mode);console.log('CRUISE_RATIO',mode,sampled/baseline)
      api.advance((services[mode].total+65)*1000);await phase('idle')
    }
    return
  }
  await shot('01-spawn')
  const approach=await page.evaluate(()=>{
    const player=window.viewer.walk
    for(let frame=0;frame<1000;frame++){
      const current=player.position,dx=-805.8-current.x,dz=257.6-current.z,distance=Math.hypot(dx,dz)
      if(distance<2){player.drive(0,0);return true}player.drive(dx/distance,dz/distance);player.tick(1/30)
    }
    return player.position.toArray()
  });assert.equal(approach,true,`walk to helipad: ${approach}`)
  await shot('02-pad');await page.locator('.heli-prompt').click();await shot('03-panel')
  const modes=['low','high','dynamic']
  for(const mode of modes){
    await page.locator(`.heli-panel input[value=${mode}]`).check({force:true});await page.getByRole('button',{name:'加入队列'}).click();await page.getByRole('button',{name:'确认登机'}).click();await phase('board');if(mode==='low')await shot('04-board');await phase('ascend');if(mode==='low')await shot('05-ascent');await phase('cruise')
    await page.keyboard.press('KeyF');assert.equal(await page.evaluate(()=>window.viewer.heli.phase),'cruise');if(mode==='low')await shot('06-third')
    const flightFps=await fps(mode);await page.keyboard.press('KeyT');assert.ok(await page.evaluate(()=>window.viewer.heli.first));if(mode==='low')await shot('07-first');await page.keyboard.press('KeyT');
    const flight=await page.evaluate(()=>window.viewer.heli.queue().flight)
    const left=await page.evaluate(()=>window.viewer.heli.queue().now);api.advance(Math.max(0,flight.t0+(services[mode].total-15)*1000-left))
    await phase('landed');if(mode==='low')await shot('08-landed');await page.locator('.heli-prompt').filter({hasText:'按 F 键下机'}).waitFor();await page.keyboard.press('KeyF');await phase('idle');if(mode==='low')await shot('09-exit');console.log({mode,baseline,flightFps,ratio:flightFps/baseline})
    if(mode!=='dynamic')await page.locator('.heli-prompt').click()
  }
  const {handoff}=await import('./heli-handoff.mjs');await handoff({page,other,url,api,output})
}finally{await browser?.close();await server.close();if(rt.exitCode===null){const ended=once(rt,'exit');rt.kill();await ended}}
})
