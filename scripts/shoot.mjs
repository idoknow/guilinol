import {chromium} from 'playwright'
import {preview} from 'vite'
const [out, ...names] = process.argv.slice(2)
const server = await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const browser = await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const page = await browser.newPage({viewport:{width:1280,height:720}})
page.on('pageerror',e=>console.log('ERR',e.message)); page.on('console',m=>m.type()==='error'&&console.log('CONSOLE',m.text()))
for (const spec of names) {
  const [name, query] = spec.split('?')
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&cam=${name}${query?'&'+query:''}`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  await page.waitForFunction(()=>{const {stats,stream,camera,manifest}=window.viewer;return !stats.pending && manifest.chunks.every(t=>Math.hypot(t.x+128-camera.position.x,t.z+128-camera.position.z)>stream.radius||stream.loaded.has(t))},{timeout:120000})
  await page.waitForTimeout(500)
  const file=spec.replace(/[?&=]/g,"_");await page.screenshot({path:`${out}/${file}.png`}); console.log("shot",file)
}
await browser.close(); server.httpServer.close()
