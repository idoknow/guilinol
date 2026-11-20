import {resolve} from 'node:path'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const roots=process.argv.slice(2)
if(roots.length!==2) throw Error('Usage: node scripts/first-frame-comparison.mjs <main-dist> <branch-dist>')
const profile=process.env.PERF_PROFILE
const mobile=profile==='mobile'
const servers=[]
let browser
try {
  for(const root of roots) servers.push(await preview({configFile:false,build:{outDir:resolve(root)},preview:{host:'127.0.0.1',port:0}}))
  const samples=[[],[]]
  for(let run=0;run<14;run++) {
    const index=run%2
    browser=await chromium.launch(browserOptions(profile==='desktop'||mobile))
    const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:960,height:540},isMobile:mobile,hasTouch:mobile})
    if(mobile)await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate:4})
    const requests=[]
    page.on('request',request=>requests.push(request))
    await page.goto(`http://127.0.0.1:${servers[index].httpServer.address().port}/?verify`)
    await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
    const sample=await page.evaluate(()=>({ms:window.viewer.stats.firstMs,bytes:window.viewer.stats.firstWorldBytes,origin:performance.timeOrigin}))
    const earlyGLBs=requests.filter(request=>new URL(request.url()).pathname.endsWith('.glb')&&request.timing().startTime>=sample.origin&&request.timing().startTime<=sample.origin+sample.ms).map(request=>new URL(request.url()).pathname)
    samples[index].push(sample.ms)
    console.log(JSON.stringify({build:index?'PR':'main',pair:1+Math.floor(run/2),...sample,earlyGLBs}))
    await browser.close();browser=undefined
  }
  const medians=samples.map(values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)])
  const ratio=medians[1]/medians[0]
  console.log(JSON.stringify({medians,ratio,limit:1.05}))
  if(ratio>1.05)process.exitCode=1
} finally {
  await browser?.close();await Promise.all(servers.map(server=>server.close()))
}
