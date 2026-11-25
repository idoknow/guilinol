import {chromium} from 'playwright'
import {preview} from 'vite'
import {resolve,join} from 'node:path'
import {mkdir,readFile} from 'node:fs/promises'
import {gzipSync} from 'node:zlib'
import {browserOptions} from './qa-browser.mjs'

const project=resolve(process.env.GFX_PROJECT??'.'),baseline=resolve(process.env.GFX_BASELINE??'../baseline'),out=resolve(process.env.GFX_OUT??'captures/gfx')
await mkdir(out,{recursive:true})
const serve=root=>preview({root:join(root,'web'),configFile:join(root,'web/vite.config.ts'),preview:{host:'127.0.0.1',port:0}})
const servers=[],results=[]
function instrument(){
  const api=WebGL2RenderingContext.prototype
  let bound=null,previous=undefined,passes=0,calls=0,triangles=0
  const bind=api.bindFramebuffer
  api.bindFramebuffer=function(target,buffer){if(target!==this.READ_FRAMEBUFFER)bound=buffer;return bind.call(this,target,buffer)}
  function draw(mode,count,instances=1){
    if(bound!==previous){passes++;previous=bound}
    calls++;triangles+=instances*(mode===4?count/3:mode===5||mode===6?Math.max(0,count-2):0)
  }
  for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){
    const original=api[name];api[name]=function(...args){draw(args[0],args[name.includes('Arrays')?2:1],name.endsWith('Instanced')?args.at(-1):1);return original.apply(this,args)}
  }
  const extension=api.getExtension,seen=new WeakSet()
  api.getExtension=function(name){const ext=extension.call(this,name);if(ext&&name==='WEBGL_multi_draw'&&!seen.has(ext)){seen.add(ext)
    for(const method of ['multiDrawElementsWEBGL','multiDrawArraysWEBGL']){const original=ext[method];ext[method]=function(...args){const arrays=method.includes('Arrays'),list=args[arrays?3:1],offset=args[arrays?4:2];for(let index=0;index<args.at(-1);index++)draw(args[0],list[offset+index]);return original.apply(this,args)}}
  }return ext}
  window.takeGfxCounters=()=>{const result={passes,calls,triangles};passes=calls=triangles=0;previous=undefined;return result}
}
let browser
try{
  servers.push(await serve(baseline),await serve(project))
  browser=await chromium.launch(browserOptions())
  for(let round=1;round<=3;round++)for(const time of [12,21])for(const tier of ['baseline','low','mid','high']){
    const server=servers[Number(tier!=='baseline')]
    const page=await browser.newPage({viewport:{width:800,height:450}})
    await page.addInitScript(instrument)
    const errors=[];page.on('pageerror',error=>errors.push(String(error)))
    page.on('console',msg=>{if(/Shader Error|VALIDATE_STATUS|GL_INVALID|effects unavailable/i.test(msg.text()))errors.push(msg.text())})
    try{
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&debug&cam=elephant&dpr=1&gfx=${tier}&time=${time}`)
      await page.waitForFunction(()=>window.viewer?.stats.frame>10&&!window.viewer.stats.pending,null,{timeout:180000})
      const result=await page.evaluate(async()=>{
        const {stats}=window.viewer;let last=stats.frame,casters=0,calls=0,triangles=0,passes=0
        async function next(){do{await new Promise(requestAnimationFrame)}while(stats.frame===last);last=stats.frame;return window.takeGfxCounters()}
        for(let frame=0;frame<30;frame++)await next()
        const begin=performance.now()
        for(let frame=0;frame<120;frame++){const metrics=await next();calls+=metrics.calls;passes+=metrics.passes;triangles+=metrics.triangles;casters+=stats.shadowCasters??0}
        const js=performance.getEntriesByType('resource').filter(entry=>entry.responseEnd<=stats.firstMs).map(entry=>new URL(entry.name).pathname).filter(path=>path.startsWith('/assets/')&&path.endsWith('.js'))
        return {fps:120000/(performance.now()-begin),passes:passes/120,calls:calls/120,triangles:triangles/120,casters:casters/120,actual:window.gfx?.quality,js:[...new Set(js)]}
      })
      if(result.actual&&result.actual!==tier)throw Error('Tier changed during capture')
      const {js,...metrics}=result
      const sizes=await Promise.all(js.map(async path=>gzipSync(await readFile(join(tier==='baseline'?baseline:project,'dist',path))).length))
      const sample={round,tier,time,...metrics,firstJsGzip:sizes.reduce((sum,size)=>sum+size,0)}
      console.log(JSON.stringify(sample));results.push(sample)
      if(round===1){await page.evaluate(()=>window.viewer.freeze());await page.screenshot({path:join(out,`${tier}-${time}.png`),timeout:120000})}
      if(errors.length)throw Error(errors.join('\n'))
    }catch(error){console.error(JSON.stringify({tier,time,error:String(error),diagnostics:errors.slice(0,3)}));process.exitCode=1}finally{await page.close()}
  }
  for(const tier of ['baseline','low','mid','high'])for(const time of [12,21]){
    const samples=results.filter(row=>row.tier===tier&&row.time===time);if(samples.length!==3)continue
    const summary=Object.fromEntries(['fps','calls','passes','triangles','casters'].map(key=>{const values=samples.map(row=>row[key]).sort((left,right)=>left-right);return [key,{median:values[1],range:values[2]-values[0]}]}))
    console.log(JSON.stringify({tier,time,summary}))
  }
}finally{await browser?.close();await Promise.all(servers.map(server=>server.close()))}
