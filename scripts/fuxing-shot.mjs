import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const directory=process.argv[2]??'captures/traffic'
const baseline=process.env.SHOT_ROADS
assert.ok(baseline,'Set SHOT_ROADS to the original roads directory')
await mkdir(directory,{recursive:true})
const server=await createServer({root:'web',configFile:'web/vite.config.ts',server:{host:'127.0.0.1',port:0}})
await server.listen()
let browser
try{
  browser=await chromium.launch(browserOptions())
  const fuxing={lane:622,fraction:(1127-921.29)/(1392.61-921.29),eye:[598,156.9,1122],look:[590.3,156.2,1127]}
  const bridge={lane:12776,fraction:.5,eye:[6,155.4,723],look:[0,152.2,712]}
  for(const [name,shot] of [['before',fuxing],['after',fuxing],['bridge',bridge]]){
    const page=await browser.newPage({viewport:{width:1000,height:640}})
    try{
      if(name==='before')await page.route('**/world/roads/**',route=>route.fulfill({path:join(baseline,new URL(route.request().url()).pathname.split('/roads/')[1])}))
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&traffic=1&flow=0&time=16&radius=480`)
      await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
      await page.evaluate(async({eye,look,lane,fraction})=>{
        const {Traffic}=await import('/src/traffic/sim.ts')
        const original=Traffic.prototype.step
        let fixture
        Traffic.prototype.step=function(...args){
          const track=Array.from(this.allTracks()).find(item=>item.id===lane)
          if(!track)return original.apply(this,args)
          if(!fixture){fixture={track,dist:fraction*track.length,kind:'car',speed:0,dodge:0,scale:1,down:0};Math.random=()=>.42}
          this.position(fixture)
          this.actors=[fixture]
          window.shotPose=[fixture.x,fixture.y,fixture.z]
        }
        const camera=window.viewer.camera
        camera.position.set(...eye);camera.lookAt(...look);camera.updateMatrixWorld()
      },shot)
      await page.addStyleTag({content:'body > :not(canvas){visibility:hidden!important}'})
      await page.waitForFunction(()=>{
        const viewer=window.viewer
        if(!window.shotPose||!viewer.trafficProbe?.motors||viewer.stats.pending||viewer.stream.forest.pending.size)return false
        const nearby=viewer.manifest.chunks.filter(tile=>Math.hypot(tile.x+128-window.shotPose[0],tile.z+128-window.shotPose[2])<320)
        return nearby.length>0&&nearby.every(tile=>viewer.stream.loaded.has(tile))
      },null,{timeout:180000})
      const result=await page.evaluate(async()=>{
        await window.viewer.freeze()
        return {position:window.shotPose,visible:await window.viewer.trafficPixels(),loaded:window.viewer.stats.loaded}
      })
      console.log(name,result)
      assert.deepEqual(result.visible,[0])
      const canvas=page.locator('body > canvas').first()
      const path=join(directory,`${name}.png`)
      await canvas.screenshot({path,timeout:90000})
      await page.evaluate(()=>{window.viewer.trafficProbe.staticOnly=true;window.viewer.resume()})
      await page.waitForFunction(()=>window.viewer.trafficProbe.allMotors.length===0)
      await page.evaluate(()=>window.viewer.freeze())
      const empty=await canvas.screenshot({timeout:90000})
      const {PNG}=await import('playwright-core/lib/utilsBundle').then(module=>module.default??module)
      const {readFile}=await import('node:fs/promises')
      const full=PNG.sync.read(await readFile(path)),background=PNG.sync.read(empty)
      let changed=0
      for(let index=0;index<full.data.length;index+=4){
        if([0,1,2].some(channel=>Math.abs(full.data[index+channel]-background.data[index+channel])>32))changed++
      }
      console.log(name,'changed pixels with/without test vehicle:',changed)
      assert.ok(changed>=1500,'Vehicle must be clearly visible in the captured frame')
    }finally{await page.close()}
  }
}finally{await browser?.close();await server.close()}
