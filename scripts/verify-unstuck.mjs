// IDOK-234 复位按钮验收：CHROMIUM=/usr/bin/chromium node scripts/verify-unstuck.mjs（需先 vite build，public/world 就位）
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'
const out='captures/unstuck';await mkdir(out,{recursive:true})
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const browser=await chromium.launch({...browserOptions(),args:[...browserOptions().args,'--disable-dev-shm-usage']})
try{
  for(const [name,viewport] of [['desktop',{width:1280,height:720}],['phone',{width:844,height:390}]]){
    const page=await browser.newPage({viewport,isMobile:name==='phone',hasTouch:name==='phone'})
    page.on('pageerror',e=>console.log('pageerror',e.message))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk&flow=0`)
    await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:180000})
    await page.addStyleTag({content:'*{transition:none!important}'})
    const btn=page.locator('.btn-unstuck');await btn.waitFor({state:'visible'})
    console.log(name,'button',await btn.boundingBox(),await btn.getAttribute('title'))
    await page.screenshot({path:`${out}/${name}-hud.png`})
    if(name==='phone'){await page.close();continue}
    // 1. 正常站着点复位：挪到 ≥2 m 外的平地，仍在步行
    const before=await page.evaluate(()=>window.viewer.walk.position.toArray())
    await btn.click()
    await page.waitForFunction(([x,z])=>{const p=window.viewer.walk.position;return window.viewer.walk.active&&Math.hypot(p.x-x,p.z-z)>1.5},before,{timeout:60000})
    await page.waitForTimeout(1500)
    const after=await page.evaluate(()=>window.viewer.walk.position.toArray())
    console.log('click: from',before,'to',after,'d',Math.hypot(after[0]-before[0],after[2]-before[2]).toFixed(1))
    assert(Math.hypot(after[0]-before[0],after[2]-before[2])<=64)
    // 2. 漓江中（解放桥两侧 ±35 m）找最近平地
    const river=await page.evaluate(async()=>{
      const b=window.viewer.manifest.landmarks.find(e=>e.id==='jiefang_bridge');const a=b.rotation*Math.PI/180,[cx,,cz]=b.sphere
      const x=b.position[0]+cx*Math.cos(a)+cz*Math.sin(a),z=b.position[2]-cx*Math.sin(a)+cz*Math.cos(a)
      if(!await window.viewer.walkTo(x,z,0,'qa-bridge'))return {err:'walkTo bridge failed'}
      const p=window.viewer.walk.position,res=[]
      for(const [dx,dz] of [[0,35],[0,-35],[0,120],[0,-120]]){const t=performance.now();const spot=window.viewer.walk.findUnstuck({x:p.x+dx,z:p.z+dz});res.push({off:[dx,dz],ms:Math.round(performance.now()-t),d:spot&&Math.round(spot.distance),rule:spot?.rule})}
      return {at:[p.x,p.z],res}})
    console.log('river',JSON.stringify(river))
    // 3. 车上：第一下只是待确认
    await page.evaluate(async()=>{await window.viewer.freeze();document.body.setAttribute('data-aboard','');document.body.dataset.ride='bike'})
    const p0=await page.evaluate(()=>window.viewer.walk.position.toArray())
    await btn.click();await page.waitForTimeout(300)
    assert.equal(await btn.textContent(),'再点一次 · 弃车复位');assert(await btn.evaluate(e=>e.classList.contains('armed')))
    await page.screenshot({path:`${out}/armed.png`,clip:{x:0,y:0,width:640,height:140}})
    const p1=await page.evaluate(()=>window.viewer.walk.position.toArray());assert.deepEqual(p0,p1)
    await page.waitForTimeout(3300);assert.equal(await btn.textContent(),'复位')
    await page.evaluate(()=>{document.body.removeAttribute('data-aboard');delete document.body.dataset.ride;window.viewer.resume()})
    // 4. 热键 R
    const k0=await page.evaluate(()=>window.viewer.walk.position.toArray())
    await page.keyboard.press('r')
    await page.waitForFunction(([x,z])=>{const p=window.viewer.walk.position;return window.viewer.walk.active&&Math.hypot(p.x-x,p.z-z)>1.5},k0,{timeout:60000})
    await page.waitForTimeout(2500);console.log('hotkey', k0, await page.evaluate(()=>window.viewer.walk.position.toArray()), JSON.stringify(await page.evaluate(()=>window.viewer.walk.spawns.slice(-4))))
    await page.screenshot({path:`${out}/after.png`})
    await page.close()
  }
}finally{await browser.close();await server.close()}
