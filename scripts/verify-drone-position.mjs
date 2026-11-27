import assert from 'node:assert/strict'
import {setTimeout as delay} from 'node:timers/promises'
import {writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const site=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser=await chromium.launch(browserOptions())
  const page=await browser.newPage({viewport:{width:640,height:360}})
  page.on('pageerror',error=>console.error(error.message))
  await page.addInitScript(()=>localStorage.setItem('glol.avatar.v1',JSON.stringify({body:'f',v:1,createdAt:123,skin:2,face:1,brows:0,eyes:0,hair:'f_bun',hairColor:1,look:'sport'})))
  const poses=[],trace=[]
  let socket,resumeOffset
  await page.route('**/api/**',route=>route.fulfill({json:route.request().url().endsWith('/me')?
    {id:'pilot',uid:900001,nickname:'Pilot'}:{ticket:'local-test'}}))
  await page.routeWebSocket('**/ws',ws=>{
    socket=ws
    ws.onMessage(raw=>{
      const packet=JSON.parse(raw)
      if(packet.t==='join'){
        const resume=resumeOffset===undefined?{}:{x:packet.x+resumeOffset,y:packet.y,z:packet.z,resumed:true}
        ws.send(JSON.stringify({t:'welcome',me:{id:'pilot',uid:900001,name:'Pilot',...resume},online:1,players:[]}))
      }
      if(packet.t==='join'||packet.t==='pos'){poses.push(packet);trace.push({t:packet.t,x:packet.x,y:packet.y,z:packet.z,v:packet.v,foot:packet.foot,gr:packet.gr})}
    })
  })
  await page.goto(`http://127.0.0.1:${site.httpServer.address().port}/?verify&play=tour&mp=1&flow=0&dpr=.4`,{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.viewer?.walkTo)
  assert.ok(await page.evaluate(()=>window.viewer.walkTo(-871.5,231.4,0,'qa-drone')))
  const samples=async(count=3)=>{
    const start=poses.length,deadline=Date.now()+45000
    while(poses.length<start+count&&Date.now()<deadline)await delay(50)
    assert.ok(poses.length>=start+count,JSON.stringify(await page.evaluate(()=>({walk:window.viewer?.walk?.active,net:window.viewer?.walk?.net?.status(),ui:document.body.innerText.slice(-600)}))))
  }
  await samples()
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)
  const check=(from,origin)=>{
    const drift=Math.max(...poses.slice(from).map(p=>distance(p,origin)))
    assert.ok(drift<1,`pilot drift ${drift} m`);return drift
  }
  for(const reconnect of [false,true]){
    const origin=poses.at(-1),start=poses.length
    if(reconnect)await page.evaluate(()=>window.droneStep(.1,2000))
    if(!reconnect){await page.locator('.dock-drone').evaluate(el=>el.click());await page.locator('[data-drone="mini5pro"]').evaluate(el=>el.click())}
    await page.waitForFunction(()=>document.querySelector('.dock-drone')?.textContent.trim()==='飞无人机')
    await page.locator('.dock-drone').evaluate(el=>el.click())
    await page.waitForFunction(()=>document.body.dataset.drone==='rc')
    await page.keyboard.down('KeyW');await page.keyboard.down('ArrowUp')
    const flight=await page.evaluate(()=>window.droneStep(.1,250))
    await page.keyboard.up('ArrowUp');await page.keyboard.up('KeyW')
    assert.ok(flight.distance>100&&flight.agl>5,JSON.stringify(flight));await samples()
    check(start,origin)
    if(reconnect){
      for(const offset of [.5,8]){
        resumeOffset=offset
        socket.close({code:4001,reason:'replaced'})
        await page.waitForFunction(()=>window.viewer.walk.net.status().state==='replaced')
        const before=poses.length
        await page.evaluate(()=>window.viewer.walk.net.reconnect());await samples()
        const join=poses[before];assert.equal(join.t,'join');assert.ok(distance(join,origin)<.05)
        assert.ok(check(before+1,{...join,x:join.x+(offset===8?8:0)})<.05)
      }
      socket.send(JSON.stringify({t:'setback',x:origin.x,y:origin.y,z:origin.z}))
      await samples();check(poses.length-2,origin)
    }
    const exit=poses.length
    await page.locator('.rc [data-act="exit"]').evaluate(el=>el.click());await samples(6)
    console.log({reconnect,distance:flight.distance,agl:flight.agl,pilotDrift:check(reconnect?exit:start,origin)})
  }
  if(process.env.POSE_TRACE)await writeFile(process.env.POSE_TRACE,JSON.stringify(trace))
  const motion=()=>page.evaluate(()=>({position:window.viewer.walk.position.toArray(),speed:window.viewer.walk.footSpeed}))
  resumeOffset=.5
  for(let cycle=1;cycle<=2;cycle++){
    await delay(44000)
    await page.evaluate(async()=>{
      await window.viewer.freeze()
      const walker=window.viewer.walk
      walker.drive(1,0,false);for(let frame=0;frame<8;frame++)walker.tick(1/60)
      window.resumeObserved=false
      const online=event=>{if(event.detail.state==='online'){window.resumeObserved=true;removeEventListener('glol:mp-status',online)}}
      addEventListener('glol:mp-status',online)
    })
    const before=await motion();assert.ok(before.speed>.2)
    socket.close({code:1011,reason:'periodic disconnect'})
    await page.waitForFunction(()=>window.resumeObserved)
    assert.deepEqual(await motion(),before)
    console.log({walkingResume:cycle,offset:resumeOffset,retainedSpeed:before.speed})
    await page.evaluate(()=>{window.viewer.walk.releaseDrive();window.viewer.resume()});await samples()
  }
} finally {await browser?.close();await site.close()}
