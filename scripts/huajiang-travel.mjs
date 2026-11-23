import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const route=JSON.parse(await readFile(process.argv[2],'utf8'))
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser=await chromium.launch(browserOptions())
  for(const mode of ['foot','car']) {
    const page=await browser.newPage({viewport:{width:480,height:270}})
    try {
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk&radius=384&flow=0`)
      await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:90000})
      assert(await page.evaluate(async([x,z])=>{
        const {walk}=window.viewer
        walk.leave()
        return walk.enter(x,z,0,'huajiang-start',false,new AbortController().signal)
      },route.car),'initial spawn failed')
      if(mode==='car') {
        await page.waitForFunction(()=>document.querySelector('.vehicle-action')?.textContent==='开车')
        await page.keyboard.press('f')
        await page.waitForFunction(()=>window.viewer.walk.vehicle==='car')
      }
      const result=await page.evaluate(async({mode,route})=>{
        const {walk,stream}=window.viewer
        await window.viewer.freeze()
        const started=performance.now(), pressed=new Set(), dt=mode==='foot'?.1:1/30
        let distance=0, ticks=0, index=0
        function key(code,on){if(pressed.has(code)===on)return;window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code}));if(on)pressed.add(code);else pressed.delete(code)}
        function report(reason){return {mode,reached:!reason,reason,waypoint:index,meters:Math.round(distance),simSeconds:Math.round(ticks*dt),wallSeconds:Math.round((performance.now()-started)/1000),position:walk.position.toArray(),obstacle:walk.obstacle,hits:walk.probe().hits}}
        for(index=1;index<route.waypoints.length;index++) {
          const [east,south]=route.waypoints[index]
          let best=Infinity,lastProgress=ticks
          while(true){
            const {x,z}=walk.position,dx=east-x,dz=south-z,remaining=Math.hypot(dx,dz)
            if(remaining<(mode==='car'?4:1))break
            if(remaining<best-.5){best=remaining;lastProgress=ticks}
            if((ticks-lastProgress)*dt>25)return report('no forward progress for 25 simulated seconds')
            if(mode==='foot')walk.drive(dx,dz,false)
            else {
              const delta=Math.atan2(-dx,-dz)-walk.heading,error=Math.atan2(Math.sin(delta),Math.cos(delta))
              key('KeyA',error>.04);key('KeyD',error<-.04);key('KeyW',Math.abs(walk.speed)<(Math.abs(error)>.35?2.8:8))
            }
            walk.tick(dt);ticks++
            stream.tick(walk.position);stream.updateLandmarks?.(walk.position)
            const advance=Math.hypot(walk.position.x-x,walk.position.z-z);distance+=advance
            const probe=walk.probe()
            if(advance>15*dt+.3||probe.resets||probe.inHouse||probe.inPeak||probe.renderClearance<-.6||walk.vehicle!==mode)return report('discontinuity, collision or unexpected mode')
            if(ticks%12===0||walk.obstacle==='streaming')await new Promise(resolve=>setTimeout(resolve,0))
          }
        }
        return report(null)
      },{mode,route})
      console.log(JSON.stringify(result));if(!result.reached)process.exitCode=1
    } catch(error){console.error(mode,error);process.exitCode=1} finally{await page.close()}
  }
} finally{await browser?.close();await server.close()}
