import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'
import {mkdir} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {register} from 'tsx/esm/api'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
register()
const {withQueueDatabase}=await import('./test-helicopter-queue.mjs'),{fixture}=await import('./heli-fixture.mjs')
await withQueueDatabase(async pool=>{
const api=await fixture(pool)
const output=process.env.HELI_CAPTURE_DIR??'captures/helicopter',server=await preview({root:'web',configFile:'web/vite.config.ts',plugins:[api.plugin],preview:{host:'127.0.0.1',port:0}})
let browser
const rt=spawn(process.execPath,['rt/server-realtime.mjs'],{env:{PORT:'0',RT_BIND_HOST:'127.0.0.1',RT_JOIN_SECRET:api.secret},stdio:['ignore','pipe','inherit']})
try{
  const endpoint=await new Promise((resolve,reject)=>{rt.stdout.on('data',data=>{const url=data.toString().match(/ws:\/\/127\.0\.0\.1:\d+\/ws/);if(url)resolve(url[0])});rt.once('exit',code=>reject(Error(`RT exited: ${code}`)));rt.once('error',reject)})
  await mkdir(output,{recursive:true});browser=await chromium.launch(browserOptions(true))
  const quick=process.env.HELI_QUICK==='1',page=await browser.newPage({viewport:quick?{width:480,height:300}:{width:800,height:500}}),origin=`http://127.0.0.1:${server.httpServer.address().port}`
  const shot=async name=>{await page.screenshot({path:`${output}/${name}.jpg`,type:'jpeg',quality:80,timeout:120000});console.log('captured',name)}
  const phase=async name=>page.waitForFunction(state=>window.viewer.heli.phase===state,name,{timeout:180000})
  const other=await browser.newPage({viewport:{width:480,height:300}})
  for(const client of [page,other])await client.addInitScript(url=>localStorage.setItem('guiling.ws',url),endpoint)
  for(const client of [page,other])client.on('pageerror',error=>console.error('page error:',error.message))
  for(const [client,user] of [[page,'A'],[other,'B']])await client.context().addCookies([{name:'glol_session',value:api.tokens[user],url:origin,httpOnly:true}])
  const fps=async()=>page.evaluate(async count=>{const start=performance.now();for(let frame=0;frame<count;frame++)await new Promise(requestAnimationFrame);return 1000*count/(performance.now()-start)},quick?8:24)
  const url=`${origin}/?verify&solo=1&mp=1&flow=0&radius=480`
  await page.goto(url,{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:120000})
  assert.ok(await page.evaluate(()=>window.viewer.walkTo(-844,208,-2.51,'plaza-e2e')))
  await shot('01-spawn');const baseline=await fps()
  const approach=await page.evaluate(()=>{
    const player=window.viewer.walk
    for(let frame=0;frame<1000;frame++){
      const current=player.position,dx=-805.8-current.x,dz=257.6-current.z,distance=Math.hypot(dx,dz)
      if(distance<2){player.drive(0,0);return true}player.drive(dx/distance,dz/distance);player.tick(1/30)
    }
    return player.position.toArray()
  });assert.equal(approach,true,`walk to helipad: ${approach}`)
  await shot('02-pad');await page.locator('.heli-prompt').click();await shot('03-panel')
  const modes=process.env.HELI_HANDOFF_ONLY?['dynamic']:['low','high','dynamic']
  for(const mode of modes){
    if(mode==='dynamic'){await other.goto(url,{waitUntil:'domcontentloaded'});await other.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:180000});await other.evaluate(()=>window.viewer.walkTo(-805.8,257.6,-1.57,'observer'))}
    await page.locator('.heli-panel select').selectOption(mode);await page.getByRole('button',{name:'加入队列'}).click();await page.getByRole('button',{name:'确认登机'}).click();await phase('board');if(mode==='low')await shot('04-board');await phase('ascend');if(mode==='low')await shot('05-ascent');await phase('cruise')
    await page.keyboard.press('KeyF');assert.equal(await page.evaluate(()=>window.viewer.heli.phase),'cruise');if(mode==='low')await shot('06-third')
    const flightFps=await fps();await page.keyboard.press('KeyT');assert.ok(await page.evaluate(()=>window.viewer.heli.first));if(mode==='low')await shot('07-first');await page.keyboard.press('KeyT');
    const flight=await page.evaluate(()=>window.viewer.heli.queue().flight)
    const left=await page.evaluate(()=>window.viewer.heli.queue().now);api.advance(Math.max(0,flight.t0+({low:360,high:280,dynamic:330}[mode]-20)*1000-left))
    if(mode==='dynamic'){
      await other.locator('.heli-prompt').click();await other.getByRole('button',{name:'加入队列'}).click();await other.waitForFunction(()=>window.viewer.heli.queue()?.mine&&!window.viewer.heli.queue().mine.offered)
      assert.match(await other.locator('.heli-queue-status').innerText(),/前面 0 人 · 预计等待 [1-9]\d* 秒/)
      const stamp=flight.t0+30000,positions=await Promise.all([page,other].map(client=>client.evaluate(time=>window.viewer.heli.positionAt(time),stamp)));const [first,second]=positions;const error=Math.hypot(first.x-second.x,first.y-second.y,first.z-second.z);assert.ok(error<=.5);console.log({error,stamp});assert.ok(await other.evaluate(()=>window.viewer.heli.visible()));await other.screenshot({path:`${output}/10-observer-queue.jpg`})
    }
    await phase('landed');if(mode==='low')await shot('08-landed');await page.locator('.heli-prompt').filter({hasText:'按 F 键下机'}).waitFor();await page.keyboard.press('KeyF');await phase('idle');if(mode==='low')await shot('09-exit');console.log({mode,baseline,flightFps,ratio:flightFps/baseline})
    if(mode==='dynamic'){await other.getByRole('button',{name:'确认登机'}).click();await other.waitForFunction(()=>window.viewer.heli.active);await other.screenshot({path:`${output}/11-next-passenger.jpg`})}
    if(mode!=='dynamic')await page.locator('.heli-prompt').click()
  }
}finally{await browser?.close();await server.close();if(rt.exitCode===null){const ended=once(rt,'exit');rt.kill();await ended}}
})
