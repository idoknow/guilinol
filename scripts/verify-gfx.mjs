import {chromium} from 'playwright'
import {preview} from 'vite'
import {resolve,join} from 'node:path'
import {mkdir,readFile} from 'node:fs/promises'
import {gzipSync} from 'node:zlib'
import {browserOptions} from './qa-browser.mjs'

const project=resolve(process.env.GFX_PROJECT??'.'),out=resolve(process.env.GFX_OUT??'captures/gfx')
await mkdir(out,{recursive:true})
const server=await preview({root:join(project,'web'),configFile:join(project,'web/vite.config.ts'),preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch(browserOptions())
  for(const tier of (process.env.GFX_TIERS??'low,mid,high').split(','))for(const time of [12,21]){
    const page=await browser.newPage({viewport:{width:800,height:450}})
    const errors=[];page.on('pageerror',error=>errors.push(String(error)))
    page.on('console',msg=>{if(/Shader Error|VALIDATE_STATUS|GL_INVALID|effects unavailable/i.test(msg.text()))errors.push(msg.text())})
    try{
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&debug&cam=elephant&dpr=1&gfx=${tier}&time=${time}`)
      await page.waitForFunction(()=>window.viewer?.stats.frame>10&&!window.viewer.stats.pending,null,{timeout:180000})
      const result=await page.evaluate(async()=>{
        const {stats}=window.viewer;let calls=0,count=0,last=stats.frame
        const begin=performance.now()
        while(count<20){await new Promise(requestAnimationFrame);if(stats.frame!==last){count++;calls+=stats.calls;last=stats.frame}}
        const js=performance.getEntriesByType('resource').filter(entry=>entry.responseEnd<=stats.firstMs).map(entry=>new URL(entry.name).pathname).filter(path=>path.startsWith('/assets/')&&path.endsWith('.js'))
        return {fps:1000*count/(performance.now()-begin),calls:calls/count,actual:window.gfx?.quality,js:[...new Set(js)]}
      })
      if(result.actual&&result.actual!==tier)throw Error('Tier changed during capture')
      const {js,...metrics}=result
      const sizes=await Promise.all(js.map(async path=>gzipSync(await readFile(join(project,'dist',path))).length))
      console.log(JSON.stringify({tier,time,...metrics,firstJsGzip:sizes.reduce((sum,size)=>sum+size,0)}))
      await page.evaluate(()=>window.viewer.freeze());await page.screenshot({path:join(out,`${tier}-${time}.png`),timeout:120000})
      if(errors.length)throw Error(errors.join('\n'))
    }catch(error){console.error(JSON.stringify({tier,time,error:String(error),diagnostics:errors.slice(0,3)}));process.exitCode=1}finally{await page.close()}
  }
}finally{await browser?.close();await server.close()}
