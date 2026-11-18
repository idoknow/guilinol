import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {preview} from 'vite'

const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
try {
  for(const mode of ['fly','walk']){
    const page=await browser.newPage({viewport:{width:960,height:540}})
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=${mode}`)
    await page.waitForFunction(mode=>{
      const viewer=window.viewer
      if(!viewer?.stats.firstMs||viewer.stats.pending||(mode==='walk'&&!viewer.walk?.active))return false
      const position=mode==='walk'?viewer.walk.position:viewer.camera.position
      return viewer.manifest.chunks.every(tile=>{
        const distance=Math.hypot(tile.x+128-position.x,tile.z+128-position.z)
        return (distance>viewer.stream.radius||viewer.stream.loaded.has(tile))&&(distance>1682||viewer.stream.forest.loaded.has(tile))
      })
    },mode,{timeout:120000})
    const result=await page.evaluate(()=>{
      const {firstMs,firstWorldBytes,calls}=window.viewer.stats
      const firstResourceBytes=performance.getEntriesByType('resource').filter(entry=>entry.responseEnd<=firstMs).reduce((sum,entry)=>sum+entry.encodedBodySize,0)
      return {firstMs,firstWorldBytes,firstResourceBytes,calls}
    });console.log(mode,result)
    if(mode==='fly'){assert(result.firstMs<=2000);assert(result.firstResourceBytes-1360531<=150000)}
    else assert(result.calls-56<=30)
    await page.close()
  }
} finally {await browser.close();await server.close()}
