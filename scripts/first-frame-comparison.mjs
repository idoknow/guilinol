import {resolve} from 'node:path'
import {preview} from 'vite'
import {chromium} from 'playwright'

const roots=process.argv.slice(2)
if(roots.length!==2) throw Error('Usage: node scripts/first-frame-comparison.mjs <main-dist> <branch-dist>')
const servers=[]
let browser
try {
  for(const root of roots) servers.push(await preview({configFile:false,build:{outDir:resolve(root)},preview:{host:'127.0.0.1',port:0}}))
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  for(const index of [0,1,1,0,0,1]) {
    const page=await browser.newPage({viewport:{width:960,height:540}})
    await page.goto(`http://127.0.0.1:${servers[index].httpServer.address().port}/?verify`)
    await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
    console.log(index?'branch':'main',await page.evaluate(()=>({ms:window.viewer.stats.firstMs,bytes:window.viewer.stats.firstWorldBytes})))
    await page.close()
  }
} finally {
  await browser?.close();await Promise.all(servers.map(server=>server.close()))
}
