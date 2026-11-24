import assert from 'node:assert/strict'
import {realpathSync} from 'node:fs'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const server = await createServer({root:'web', configFile:'web/vite.config.ts', server:{host:'127.0.0.1', port:0,
  fs:{allow:[process.cwd(), realpathSync('public/world')]}}})
let browser
try {
  await server.listen()
  browser = await chromium.launch(browserOptions())
  const page = await browser.newPage({viewport:{width:800,height:580}})
  await page.goto(`${server.resolvedUrls.local[0]}?verify&solo=1&radius=400`)
  await page.waitForFunction(() => window.viewer?.walk?.active && window.viewer.walk.parked('bike').length, null, {timeout:90000})
  assert(await page.evaluate(() => viewer.walkTo(-654,640,0,'shore-test')))
  assert(await page.evaluate(async () => {
    const {updateShopTrigger} = await import('/src/game/shops.ts')
    const shop = 'shop_shizijie_ebike'
    updateShopTrigger(shop,{testRideSpawn:{x:-654,y:144,z:640,yaw:0}})
    return viewer.walk.garage.startTestRide(shop,'xiangshan_gt').ok
  }))
  await page.waitForFunction(() => viewer.walk.vehicle==='bike' && viewer.walk.probe().wet && document.querySelector('.vehicle-action')?.textContent==='下车')
  await page.keyboard.press('f')
  const result = await page.evaluate(() => {
    const walk = viewer.walk
    const landing = walk.spawns.at(-1)
    const start = walk.probe()
    walk.drive(1,0,false)
    for(let frame=0;frame<50;frame++) walk.tick(1/60)
    walk.drive(0,0,false)
    const end = walk.probe()
    return {vehicle:walk.vehicle, rule:landing.rule, wet:start.wet, walked:Math.hypot(end.x-start.x,end.z-start.z)}
  })
  console.log(result)
  assert.equal(result.vehicle,'foot')
  assert.equal(result.rule,'water-rescue')
  assert.equal(result.wet,false)
  assert(result.walked>.4)
} finally {
  await browser?.close()
  await server.close()
}
