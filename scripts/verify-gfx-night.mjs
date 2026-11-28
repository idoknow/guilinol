import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {gunzipSync} from 'node:zlib'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const dist=resolve(process.env.GFX_DIST??'dist'),out=resolve(process.env.GFX_OUT??'captures/gfx-night')
const site=await preview({root:'web',configFile:'web/vite.config.ts',build:{outDir:dist},preview:{host:'127.0.0.1',port:0}})
let browser
try{
  await mkdir(out,{recursive:true});browser=await chromium.launch(browserOptions())
  const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[]
  page.setDefaultTimeout(90000);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(/Shader Error|GL_INVALID|effects unavailable/i.test(message.text()))errors.push(message.text())})
  await page.route('**/api/me',route=>route.fulfill({json:{id:'gfx-local',nickname:'夜景测试',verified:true}}))
  await page.route('**/api/rt/ticket',route=>route.fulfill({json:{ticket:'local-fixture'}}))
  let socket,initialPose
  await page.routeWebSocket('**/ws',connection=>{socket=connection;connection.onMessage(raw=>{const msg=JSON.parse(raw)
    if(msg.t==='join'){initialPose=msg;connection.send(JSON.stringify({t:'welcome',me:{id:'self',uid:1},players:[],online:2}))}
  })})
  await page.addInitScript(()=>localStorage.setItem('glol.prefs',JSON.stringify({view:'third'})))
  await page.goto(`http://127.0.0.1:${site.httpServer.address().port}/?verify&gfx=high&mode=walk&mp=1&time=21&flow=0`,{waitUntil:'domcontentloaded'})
  const wait=condition=>page.waitForFunction(condition,null,{timeout:150000})
  const click=selector=>page.locator(selector).first().evaluate(element=>element.click())
  await wait(()=>window.viewer?.walk?.active&&window.viewer.stats.frame>5&&!document.body.hasAttribute('data-home')&&![1,2].includes(window.__loading?.level))
  const shot=async name=>{
    assert.equal(await page.evaluate(()=>window.viewer.clock.hour),21);await page.evaluate(()=>window.viewer.freeze())
    try{await page.screenshot({path:join(out,name+'.png'),timeout:120000});console.log('captured',name)}finally{await page.evaluate(()=>window.viewer.resume())}
  }
  const cases={
    async walk(){await page.keyboard.down('w');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await shot('walk');await page.keyboard.up('w')},
    async nameplate(){
      await wait(()=>document.querySelector('.chat-dock')?.hidden===false)
      const pos=await page.evaluate(()=>{const {camera,walk}=window.viewer,dir=camera.getWorldDirection(camera.position.clone());dir.y=0;dir.normalize();return walk.position.clone().addScaledVector(dir,3).toArray()})
      socket.send(JSON.stringify({t:'join',player:{...initialPose,id:'peer',uid:2,name:'漓江同行',x:pos[0],y:pos[1],z:pos[2],bike:''}}))
      await wait(()=>{let visible=false;const cam=window.viewer.camera;cam.parent.traverse(obj=>{if(obj.isSprite&&obj.userData.aspect&&obj.visible){const projected=obj.getWorldPosition(cam.position.clone()).project(cam);if(Math.abs(projected.x)<.9&&Math.abs(projected.y)<.9&&projected.z<1)visible=true}});return visible});await shot('nameplate')
    },
    async chat(){await wait(()=>document.querySelector('.chat-dock')?.hidden===false);await click('.chat-bubble');await click('.chat-tab[data-ch=near]');socket.send(JSON.stringify({t:'chat',ch:'near',mid:'gfx-message',id:'peer',uid:2,name:'漓江同行',text:'夜景画面正常吗？',ts:Date.now()}));await wait(()=>document.querySelector('.chat-panel')?.textContent.includes('夜景画面正常吗'));await shot('chat');await click('.chat-fold')},
    async bike(){await wait(()=>window.viewer.walk.parked('bike').length>0);const ok=await page.evaluate(()=>{const walk=window.viewer.walk,pos=walk.position;const spot=walk.parked('bike').sort((a,b)=>Math.hypot(a[0]-pos.x,a[2]-pos.z)-Math.hypot(b[0]-pos.x,b[2]-pos.z))[0];return window.viewer.walkTo(spot[0],spot[2],0,'gfx-bike')});assert.ok(ok);await wait(()=>document.querySelector('.vehicle-action')?.textContent.includes('骑'));await page.keyboard.press('f');await wait(()=>window.viewer.walk.vehicle==='bike');await shot('bike');await page.keyboard.press('f');await wait(()=>window.viewer.walk.vehicle==='foot')},
    async car(){const data=JSON.parse(gunzipSync(await readFile(join(dist,'world/vehicles.bin'))));const car=data.cars.sort((a,b)=>Math.hypot(a[0]+572,a[2]+92)-Math.hypot(b[0]+572,b[2]+92))[0];assert.ok(await page.evaluate(([x,,z])=>window.viewer.walkTo(x,z,0,'gfx-car'),car));await wait(()=>document.querySelector('.vehicle-action')?.textContent==='开车');await page.keyboard.press('f');await wait(()=>window.viewer.walk.vehicle==='car');await shot('car');await page.keyboard.press('f');await wait(()=>window.viewer.walk.vehicle==='foot')},
    async photo(){await click('.dock-gear');await click('[data-body=thumb]');await click('.gear-close');await page.keyboard.press('Digit2');await click('.dock-photo');await wait(()=>document.body.dataset.photo==='on');await shot('photo');await click('.photo-shutter');await click('.photo-exit')},
    async drone(){await click('.dock-drone');await click('[data-drone="fpv"]');await wait(()=>document.querySelector('.hotbar-drone')&&!document.querySelector('.hotbar-drone')?.hidden);await click('.hotbar-drone');await wait(()=>document.body.dataset.drone==='rc');await page.evaluate(()=>window.droneStep(.1,40));await shot('drone');await click('.rc [data-act="exit"]')},
    async smoke(){await page.keyboard.press('Digit3');await click('.shop-overlay.show .shop-act-primary');await click('.shop-act-close');await page.keyboard.press('Digit3');for(const phase of ['sealed','open','ready']){await page.waitForFunction(phase=>window.viewer.walk.probe().smoke.phase===phase&&!document.querySelector('.smoke-hint').hidden,phase,{timeout:90000});await page.keyboard.press('f')};await wait(()=>window.viewer.walk.probe().smoke.phase==='smoking');await shot('smoke')},
  }
  for(const name of (process.env.GFX_CASES??Object.keys(cases).join(',')).split(',')){try{await cases[name]()}catch(error){console.error(name,String(error));process.exitCode=1}}
  assert.deepEqual(errors,[])
}finally{await browser?.close();await site.close()}
