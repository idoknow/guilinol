import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'

for(let round=0;round<3;round++)for(const directory of (round%2?process.argv.slice(2).reverse():process.argv.slice(2))){
  const server=await preview({root:resolve(directory,'web'),configFile:resolve(directory,'web/vite.config.ts'),build:{outDir:resolve(directory,'dist')},preview:{host:'127.0.0.1',port:0}})
  let browser
  try{
    browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
    const page=await browser.newPage({viewport:{width:960,height:540}})
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify`)
    await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
    console.log(JSON.stringify({directory,round,...await page.evaluate(()=>({firstMs:window.viewer.stats.firstMs,firstWorldBytes:window.viewer.stats.firstWorldBytes,ids:window.viewer.manifest.landmarks.length}))}))
  }finally{await browser?.close();await server.close()}
}
