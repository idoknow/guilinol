import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const server = await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser = await chromium.launch(browserOptions(true))
  const page = await browser.newPage({viewport:{width:1280,height:720}})
  const requests = []
  page.on('request', r=>requests.push(r.url()))
  page.on('pageerror', console.error)
  const shops = [[-924.31,-104.93],[-780.05,-160.08]]
  const go = pos=>page.evaluate(([x,z])=>window.viewer.walkTo(x,z,0,'verify-modes'),pos)
  const switchTo = async mode=>{
    await page.click('.btn-menu')
    await page.click(`[data-umami-event="home-${mode}"]`)
    await page.waitForFunction(()=>!document.body.hasAttribute('data-home'))
  }
  const capture = async mode=>{
    if (!process.env.MODE_CAPTURES) return
    await mkdir(process.env.MODE_CAPTURES,{recursive:true})
    await page.screenshot({path:`${process.env.MODE_CAPTURES}/${mode}.png`})
  }
  const originUrl = `http://127.0.0.1:${server.httpServer.address().port}`
  await page.goto(originUrl)
  await page.waitForFunction(()=>document.activeElement?.getAttribute('data-umami-event')==='home-solo')
  await page.goto(`${originUrl}/?play&verify`)
  await page.waitForFunction(()=>window.viewer?.walk?.active && window.viewer.trafficCount>0,null,{timeout:120000})
  await switchTo('tour')
  await page.waitForFunction(()=>window.viewer.trafficCount===0)
  await page.goto(originUrl)
  await page.waitForFunction(()=>document.activeElement?.getAttribute('data-umami-event')==='home-tour')
  await page.evaluate(()=>localStorage.setItem('glol.playMode','story'))
  await page.reload()
  await page.waitForFunction(()=>document.activeElement?.getAttribute('data-umami-event')==='home-solo')
  assert.equal(await page.evaluate(()=>localStorage.getItem('glol.playMode')),'solo')
  await page.evaluate(()=>localStorage.clear())
  requests.length=0
  await page.goto(`${originUrl}/?verify&flow=0&time=10.5&radius=480`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0 && window.viewer?.tour,null,{timeout:90000})
  assert.equal(await page.evaluate(()=>document.body.dataset.mode),'fly')
  const soloDom = '.gl-mission-entry,.mission-board,.gl-mission-hud,.shop-overlay'
  assert.equal(await page.locator(soloDom).count(),0)
  assert.equal(await page.evaluate(()=>window.viewer.game.missions.start('noodle-01').code),'SOLO_MODE_REQUIRED')
  for(const pos of shops){
    await go(pos)
    assert.equal(await page.evaluate(()=>window.viewer.walk.shop.ringsVisible()),false)
    await page.keyboard.press('KeyF')
    assert.equal(await page.locator('.shop-overlay.show').count(),0)
  }
  assert.equal(await page.evaluate(()=>localStorage.getItem('glol.save.v1')),null)
  assert.deepEqual(requests.filter(url=>/\/(solo-layer|mission-ui|commerce|shop-overlay)[.-]/.test(url)),[])
  await go(shops[0])
  await capture('tour')
  const origin = await page.evaluate(()=>performance.timeOrigin)
  await switchTo('solo')
  await page.waitForSelector('.gl-mission-entry')
  await capture('solo')
  await page.keyboard.press('KeyV')
  assert.equal(await page.locator('.btn-mode').isVisible(),false)
  const groundCheck = await page.evaluate(()=>{
    const v=window.viewer
    v.walk.face(v.walk.yaw,1.3)
    return {walking:v.walk.active,preset:v.setPreset('overview'),flight:v.flight(),height:v.camera.position.y-v.walk.probe().surfaceY}
  })
  assert.equal(groundCheck.walking,true)
  assert.equal(groundCheck.preset.code,'FLIGHT_DISABLED_IN_SOLO')
  assert.equal(groundCheck.flight.code,'FLIGHT_DISABLED_IN_SOLO')
  assert.ok(groundCheck.height>=0 && groundCheck.height<=6.6)
  await page.evaluate(()=>window.viewer.walk.face(window.viewer.walk.yaw))
  await page.waitForFunction(()=>window.viewer.tour.map)
  const mapOrigin=await page.evaluate(()=>window.viewer.walk.position.toArray())
  await page.keyboard.press('KeyM')
  await page.locator('.atlas canvas').click({position:{x:630,y:390}})
  await page.waitForSelector('.atlas-pop:not([hidden])')
  assert.equal(await page.locator('.atlas [data-act=go]').isVisible(),false)
  await page.evaluate(()=>window.viewer.tour.goPoint(-588,-212,'王城'))
  await page.keyboard.press('Escape')
  const mapEnd = await page.evaluate(()=>window.viewer.walk.position.toArray())
  assert.ok(Math.hypot(...mapEnd.map((value,i)=>value-mapOrigin[i]))<0.02)
  assert.equal(await page.locator(soloDom).count(),4)
  for(const pos of shops){
    await go(pos)
    await page.waitForFunction(()=>window.viewer.walk.shop.ringsVisible() && window.viewer.walk.shop.getInteractDecision().action==='open_shop')
    await page.keyboard.press('KeyF')
    await page.waitForSelector('.shop-overlay.show')
    await page.keyboard.press('Escape')
  }
  await page.click('.gl-mission-entry')
  await page.click('[data-start="noodle-01"]')
  const target = await page.evaluate(()=>window.viewer.game.getState().mission.target)
  await go(target)
  await page.waitForFunction(()=>window.viewer.game.getState().mission?.stepIndex===1)
  const position = ()=>page.evaluate(()=>window.viewer.walk.position.toArray())
  const before = await position()
  await switchTo('tour')
  const timer = ()=>page.evaluate(()=>window.viewer.game.getState().mission.timer)
  assert.equal(await page.evaluate(()=>document.body.dataset.mode),'fly')
  // Fly straight up over the same street before resuming the order.
  await page.evaluate(()=>{window.viewer.camera.position.y+=300})
  const paused = await timer()
  await page.waitForTimeout(1600)
  assert.equal(await timer(),paused)
  assert.equal(await page.locator(soloDom).count(),0)
  await switchTo('solo')
  await page.waitForFunction(value=>window.viewer.game.getState().mission?.timer < value,paused)
  const resumedHeight=await page.evaluate(()=>window.viewer.camera.position.y-window.viewer.walk.probe().surfaceY)
  assert.ok(resumedHeight>=0 && resumedHeight<=6.6)
  const after = await position()
  assert.ok(Math.hypot(before[0]-after[0],before[2]-after[2]) < 0.05)
  assert.equal(await page.evaluate(()=>performance.timeOrigin),origin)
  await page.goto(`${originUrl}/?verify&hud=street&phone=1`)
  const jobs = page.locator('[data-app=jobs]')
  await jobs.waitFor({state:'attached'})
  assert.equal(await jobs.isVisible(),false)
  assert.equal(await page.locator('.st-phone-cash').isVisible(),false)
  await switchTo('solo')
  assert.equal(await jobs.isVisible(),true)
  await jobs.click()
  await page.waitForSelector('dialog.mission-board[open]')
  await page.goto(`${originUrl}/?verify&solo=1&cam=overview`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  assert.equal(await page.evaluate(()=>window.viewer.walk.active),true)
  assert.equal(await page.evaluate(()=>document.body.dataset.mode),'walk')
  console.log('Tour and solo entry, shop triggers, lazy loading, delivery and in-place resume passed')
} finally {
  await browser?.close()
  await server.close()
}
