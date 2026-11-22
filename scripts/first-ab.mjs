import {chromium} from 'playwright'
import {preview} from 'vite'

const [dir, count] = process.argv.slice(2)
const runs = Number(count)
if (!dir || !Number.isInteger(runs) || runs < 1) throw Error('Usage: node scripts/first-ab.mjs <repoDir> <runs>')
process.chdir(dir)
const server = await preview({root:'web', configFile:'web/vite.config.ts', preview:{host:'127.0.0.1', port:0}, logLevel:'silent'})
const url = `http://127.0.0.1:${server.httpServer.address().port}/?verify&slot=N&flow=0`
const out = []
try {
  for (let i=0; i<runs; i++) {
    const browser = await chromium.launch({executablePath:process.env.CHROMIUM, args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
    try {
      const page = await browser.newPage({viewport:{width:960,height:540}})
      await page.goto(url)
      await page.waitForFunction(()=>window.viewer?.stats.firstMs>0,null,{timeout:60000})
      const result = await page.waitForFunction(()=>{
        const v=window.viewer
        if(!v?.manifest?.chunks || v.stats.pending) return false
        const c=v.camera.position
        return v.manifest.chunks.every(t=>Math.hypot(t.x+128-c.x,t.z+128-c.z)>300 || v.stream.loaded.has(t)) && performance.now()
      },null,{timeout:120000,polling:100})
      out.push({firstMs:Math.round(await page.evaluate(()=>window.viewer.stats.firstMs)), nearMs:Math.round(await result.jsonValue())})
    } finally { await browser.close() }
  }
} finally { await server.close() }
console.log(JSON.stringify(out))
