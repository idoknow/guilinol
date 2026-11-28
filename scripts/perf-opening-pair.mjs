import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {gzipSync} from 'node:zlib'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {telemetryPreview} from './telemetry-preview.mjs'

const [main,pr,output]=process.argv.slice(2)
if(!output)throw Error('Expected: main-dist pr-dist report.json')
const servers=[],runs=[],diagnostics=[]
let probing=false
function probe(){
  const marks=window.openingProbe={}
  function wrap(proto,name,after){
    const orig=proto[name]
    proto[name]=function(...args){const result=orig.apply(this,args);after.call(this,result,args);return result}
  }
  wrap(HTMLCanvasElement.prototype,'getContext',(result,args)=>{
    if(result&&args[0]==='webgl2')marks.context??=performance.now()
  })
  wrap(WebGL2RenderingContext.prototype,'compileShader',()=>{marks.compile??=performance.now()})
  wrap(WebGL2RenderingContext.prototype,'useProgram',function(_,args){
    if(args[0]&&!marks.program&&this.getProgramParameter(args[0],this.LINK_STATUS))marks.program=performance.now()
  })
}
try{
  for(const dist of [main,pr].map(dir=>resolve(dir))){
    const html=readFileSync(resolve(dist,'index.html'),'utf8')
    const entry=html.match(/<script type="module"[^>]*src="([^"]+)"/)[1]
    const server=await preview({root:'web',configFile:'web/vite.config.ts',build:{outDir:dist},
      plugins:[telemetryPreview,{name:'opening-diagnostic',configurePreviewServer(server){
        server.middlewares.use((req,res,next)=>{
          const path=req.url.split('?')[0],key=path===entry?'entry':/^\/assets\/main-[\w-]+\.js$/.test(path)?'engine':null
          if(!probing||!key)return next()
          res.setHeader('Content-Type','text/javascript');res.end(readFileSync(resolve(dist,'.'+path),'utf8')+`\nwindow.openingProbe.${key}=performance.now();`)
        })
      }}],preview:{host:'127.0.0.1',port:0}})
    servers.push({server,dist,url:`http://127.0.0.1:${server.httpServer.address().port}`})
  }
  for(let round=0;round<6;round++)for(const [index,{server,dist,url}] of servers.entries()){
    probing=round===5
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-precise-memory-info']})
    try{
      const page=await browser.newPage({viewport:{width:960,height:540}})
      const cdp=await page.context().newCDPSession(page)
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:1})
      if(probing)await page.addInitScript(probe)
      await page.goto(url+'/?verify&slot=N&flow=0',{waitUntil:'commit',timeout:120000})
      await page.waitForFunction(()=>window.viewer?.stats.firstMs>0,null,{timeout:120000})
      const row=await page.evaluate(()=>{
        const first=window.viewer.stats.firstMs
        return {first,marks:window.openingProbe,assets:[...new Set(performance.getEntriesByType('resource')
          .filter(item=>item.startTime<=first&&item.name.startsWith(location.origin+'/assets/')).map(item=>new URL(item.name).pathname)
          .filter(name=>/\.(js|css)$/.test(name)))].sort()}
      })
      const bytes={js:[0,0],css:[0,0]}
      for(const path of row.assets){const data=readFileSync(resolve(dist,'.'+path)),bucket=bytes[path.split('.').pop()];bucket[0]+=data.length;bucket[1]+=gzipSync(data).length}
      const result={side:index?'pr':'main',round:round+1,...row,bytes}
      ;(probing?diagnostics:runs).push(result)
      console.log(result.side,round+1,row.first.toFixed(1),probing?'diagnostic':'cold')
      writeFileSync(output,JSON.stringify({runs,diagnostics},null,2)+'\n')
    }finally{await browser.close()}
  }
}finally{for(const {server} of servers)await server.close()}
