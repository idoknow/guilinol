import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {xz2ll} from '../lib/projection.ts'

const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:640,height:390}})
  page.on('pageerror',error=>console.warn(error.message))
  await page.addInitScript(()=>{
    sessionStorage.setItem('glol.portraitOk','1')
    window.mockGPS={cleared:0,watchPosition(ok,err){this.ok=ok;this.err=err;return 0},clearWatch(){this.cleared++}}
    Object.defineProperty(navigator,'geolocation',{configurable:true,get:()=>window.mockGPS.enabled===false?undefined:window.mockGPS})
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk&flow=0`,{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.viewer?.walk?.active&&![1,2].includes(window.__loading?.level)&&document.querySelector('.dock-settings'),null,{timeout:120000})
  await page.evaluate(()=>document.querySelector('.dock-settings').click())
  const action=kind=>page.locator(`[data-geo-${kind}]`).evaluate(button=>button.click())
  const status=async text=>{await page.waitForFunction(text=>document.querySelector('[data-geo-status]').textContent.includes(text),text,{timeout:90000});console.log('OK',text)}
  const pos=()=>page.evaluate(()=>{const {x,z}=window.viewer.walk.position;return {x,z}})
  const origin=await pos(), point={x:-478,z:-182}
  const send=(x,z,accuracy=3,age=0)=>page.evaluate(({lat,lon,accuracy,age})=>window.mockGPS.ok({coords:{latitude:lat,longitude:lon,accuracy,heading:null,speed:null},timestamp:Date.now()-age}),{...xz2ll(x,z),accuracy,age})
  await page.evaluate(()=>window.mockGPS.enabled=false);await action('once');await status('不支持')
  await page.evaluate(()=>window.mockGPS.enabled=true)
  for(const [code,text] of [[1,'拒绝'],[3,'超时']]){await action('once');await page.evaluate(code=>window.mockGPS.err({code}),code);await status(text)}
  await action('once');await send(1e6,1e6);await status('不在桂林');assert.deepEqual(await pos(),origin)
  await action('once');await send(point.x,point.z,100);await status('精度不足');assert.deepEqual(await pos(),origin)
  await action('once');await send(point.x,point.z);await status('定位成功')
  const arrived=await pos();assert.ok(Math.hypot(arrived.x-point.x,arrived.z-point.z)<65)
  await action('follow');await send(point.x,point.z,3,4000);await status('跟随定位中')
  const start=await pos();await send(point.x+300,point.z);await status('跳点');assert.deepEqual(await pos(),start)
  await send(point.x+5,point.z);await page.waitForFunction(x=>window.viewer.walk.position.x>x+.15,start.x,{timeout:10000})
  assert.ok((await pos()).x<start.x+4.9,'follow must walk, not teleport')
  await mkdir('captures/geolocation',{recursive:true})
  for(const [name,width,height] of [['portrait',390,844],['landscape',844,390],['desktop',1280,720]]){
    await page.setViewportSize({width,height});await page.locator('[data-geo-follow]').scrollIntoViewIfNeeded()
    await page.screenshot({path:`captures/geolocation/${name}.png`})
  }
  await action('follow');await status('已停止');const stopped=await pos();await send(point.x+8,point.z);assert.deepEqual(await pos(),stopped)
  assert.equal(await page.evaluate(()=>window.mockGPS.cleared),6)
  console.log('PASS unsupported, denied, timeout, bounds, accuracy, teleport, jump, follow motion, clearWatch, stale callback')
}finally{await browser?.close();await server.close()}
