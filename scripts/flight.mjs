import {chromium} from 'playwright'
import {preview} from 'vite'
import {mkdir} from 'node:fs/promises'
import assert from 'node:assert/strict'

const server = await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM, args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page = await browser.newPage({viewport:{width:960,height:540}})
  const errors = []
  page.on('pageerror',error=>errors.push(error.message))
  const out = process.env.CAPTURES??'captures'
  await mkdir(out,{recursive:true})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  const first = await page.evaluate(()=>{
    const {firstMs,firstWorldBytes}=window.viewer.stats
    const entries=[...performance.getEntriesByType('navigation'),...performance.getEntriesByType('resource')]
    return {firstMs,firstWorldBytes,firstBodyBytes:entries.filter(entry=>entry.responseEnd<=firstMs).reduce((sum,entry)=>sum+entry.encodedBodySize,0)}
  })
  const settled = (after=0)=>page.waitForFunction(prev=>{
    const {stats,stream,camera,manifest}=window.viewer
    return stats.frame>prev && !stats.pending && manifest.chunks.every(tile=>Math.hypot(tile.x+128-camera.position.x,tile.z+128-camera.position.z)>stream.radius||stream.loaded.has(tile))
  },after)
  for(const name of ['lijiang','elephant','overview','south','foot','palace']) {
    const mark = await page.evaluate(preset=>window.viewer.setPreset(preset),name)
    await settled(mark)
    if(name==='foot') {
      const probe = await page.evaluate(()=>window.viewer.probeFoot())
      console.log('foot',probe)
      assert.ok(probe.clearance>=2 && probe.clearance<=5)
      assert.equal(probe.lookingAt,'独秀峰')
    }
    await page.evaluate(()=>window.viewer.freeze())
    try { await page.screenshot({path:`${out}/${name}.png`}) }
    finally { await page.evaluate(()=>window.viewer.resume()) }
  }
  await page.evaluate(()=>{const {camera}=window.viewer;camera.position.set(-610,245,-90);camera.lookAt(-530,155,-680)})
  const before=await page.evaluate(()=>window.viewer.camera.position.toArray())
  await page.keyboard.down('KeyW');await page.waitForFunction(pos=>window.viewer.camera.position.distanceTo({x:pos[0],y:pos[1],z:pos[2]})>15,before)
  const normalFlight = await page.evaluate(async()=>{
    const samples=[],calls=[]
    for(let frame=0;frame<60;frame++) {
      await new Promise(resolve=>requestAnimationFrame(resolve));samples.push(window.viewer.stats.ms);calls.push(window.viewer.stats.calls)
    }
    return {meanMs:samples.reduce((a,b)=>a+b)/60,p95Ms:samples.sort((a,b)=>a-b)[57],meanCalls:calls.reduce((a,b)=>a+b)/60}
  })
  await page.keyboard.up('KeyW')
  const metrics = await page.evaluate(async()=>{
    const {manifest,stats,stream,camera}=window.viewer
    const [west,north,width,depth]=manifest.extent, samples=[], calls=[]
    let maxResident=0
    function frame(){return new Promise(resolve=>requestAnimationFrame(resolve))}
    for(let row=0;row<depth/256;row++) {
      for(let col=0;col<width/256;col++) {
        const actualCol=row%2?width/256-1-col:col
        camera.position.x=west+128+actualCol*256;camera.position.z=north+128+row*256
        await frame();samples.push(stats.ms);calls.push(stats.calls)
        const tile=manifest.chunks[row*(width/256)+actualCol], deadline=performance.now()+8000
        while(!stream.loaded.has(tile)){if(performance.now()>deadline)throw Error(`Missing ${tile.file}`);await frame();samples.push(stats.ms);calls.push(stats.calls)}
        maxResident=Math.max(maxResident,stats.loaded)
      }
    }
    const mean=list=>list.reduce((total,value)=>total+value,0)/list.length
    return {frames:samples.length,meanMs:mean(samples),p95Ms:samples.sort((a,b)=>a-b)[Math.floor(samples.length*.95)],meanCalls:mean(calls),maxResident,
      visited:stream.visited.size,total:manifest.chunks.length,failures:stats.failures}
  })
  console.log(JSON.stringify({...first,normalFlight,...metrics,errors},null,2))
  assert.equal(metrics.visited,metrics.total);assert.equal(metrics.failures,0);assert.equal(errors.length,0);assert.ok(first.firstMs<2000)
} finally {await browser?.close(); await server.close()}
