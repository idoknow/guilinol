import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const server = await preview({root:'web', configFile:'web/vite.config.ts', preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser = await chromium.launch(browserOptions())
  const page = await browser.newPage({viewport:{width:960,height:600}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&solo=1&mode=walk&time=10.5&flow=0`)
  await page.waitForFunction(() => window.viewer?.walk?.active && window.viewer.walk.parked('bike').length, null, {timeout:90000})
  await page.evaluate(() => window.viewer.walkTo(-782.25,-150.73,1.3391,'test-ride-recovery'))
  const failures = []
  for (const phase of ['standing_up','riding','crashed']) {
    for (const reason of phase==='standing_up'?['timeout']:['timeout','out_of_bounds','user','dismount_far','mode_switch','purchase']) {
      const result = await page.evaluate(({reason,phase}) => {
        const walk = window.viewer.walk
        const advance = frames => {for(let frame=0;frame<frames;frame++) walk.tick(1/60)}
        if (!walk.garage.startTestRide('shop_shizijie_ebike','xiangshan_gt').ok) throw Error('mount failed')
        advance(60)
        if (phase!=='riding') {walk.ebike.triggerCrash(); advance(60)}
        if (walk.vehicle!=='bike' || (document.body.dataset.rideCrash==='1')!==(phase!=='riding')) throw Error('bad fixture')
        if (phase==='standing_up') {
          if (!walk.ebike.recover()) throw Error('stand-up failed')
          advance(2)
          if (walk.probe().twoWheelFlow!==phase) throw Error('stand-up fixture not active')
        }
        walk.garage.endTestRide(reason)
        advance(60)
        const idle = walk.probe()
        const hud = document.body.dataset.ride ?? null
        const crash = document.body.dataset.rideCrash ?? null
        walk.drive(1,0,false); advance(45)
        const moving = walk.probe()
        walk.drive(0,0,false); advance(30)
        return {vehicle:walk.vehicle,flow:idle.twoWheelFlow,hud,crash,pitch:idle.figPitch,roll:idle.figRoll,downed:idle.downedCount,
          idle:idle.animClip,moving:moving.animClip,distance:Math.hypot(moving.x-idle.x,moving.z-idle.z)}
      }, {reason,phase})
      console.log(reason,phase,JSON.stringify(result))
      if (phase==='standing_up' && process.env.RIDE_END_SHOT) await page.screenshot({path:process.env.RIDE_END_SHOT})
      if (!(result.vehicle==='foot' && result.flow==='foot' && result.hud===null && result.crash===null &&
        Math.abs(result.pitch)<0.01 && Math.abs(result.roll)<0.01 && result.distance>0.4 &&
        result.downed===0 && /idle/i.test(result.idle) && /walk/i.test(result.moving))) failures.push({reason,phase,result})
    }
  }
  assert.deepEqual(failures,[])
} finally {
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
