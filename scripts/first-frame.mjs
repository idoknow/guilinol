import {chromium} from 'playwright'
import {preview} from 'vite'

const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
try{
  for(let run=0;run<3;run++){
    const browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
    try{
      const page=await browser.newPage({viewport:{width:960,height:540}})
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify`)
      await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
      console.log(await page.evaluate(()=>{const {firstMs,firstWorldBytes}=window.viewer.stats
        return {firstMs,firstWorldBytes,assets:performance.getEntriesByType('resource').filter(resource=>resource.startTime<firstMs&&resource.name.includes('/world/')).map(resource=>resource.name.split('/').pop())}}))
    }finally{await browser.close()}
  }
}finally{await server.close()}
