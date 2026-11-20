// Renders the title-screen backdrops from a built dist: `npm run build && node scripts/home-shots.mjs ../shots [name…]`,
// then convert to public/home/<name>.webp (1600×900, quality ≈74). Fixed camera + pinned hour, so the set can be regenerated whenever the city changes.
import {chromium} from 'playwright'
import {preview} from 'vite'
import {mkdir} from 'node:fs/promises'
export const shots = {
  elephant:{eye:[-700,176,1290],at:[-855,182,1098],time:18.1,caption:'象鼻山 · 黄昏'},
  pagodas:{eye:[-890,198,470],at:[-985,185,650],time:19.7,caption:'日月双塔 · 入夜'},
  lijiang:{eye:[85,205,-340],at:[-110,180,-810],time:7.4,caption:'漓江 · 清晨'},
  duxiu:{eye:[-470,218,-430],at:[-513,200,-679],time:10,caption:'独秀峰 · 靖江王城'},
}
const [out='public/home', ...pick] = process.argv.slice(2)
await mkdir(out,{recursive:true})
const server = await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const browser = await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const page = await browser.newPage({viewport:{width:1600,height:900}})
page.on('pageerror',e=>console.log('ERR',e.message))
for (const [name,s] of Object.entries(shots)) {
  if (pick.length && !pick.includes(name)) continue
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&play&radius=900&time=${s.time}${s.weather?'&weather='+s.weather:''}`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0,null,{timeout:300000})
  await page.evaluate(s=>{const c=window.viewer.camera;c.position.set(...s.eye);c.lookAt(...s.at);c.updateMatrixWorld()},s)
  await page.waitForFunction(()=>{const {stats,stream,camera,manifest}=window.viewer;return !stats.pending && manifest.chunks.every(t=>Math.hypot(t.x+128-camera.position.x,t.z+128-camera.position.z)>stream.radius||stream.loaded.has(t))},null,{timeout:600000})
  await page.waitForTimeout(6000)
  await page.evaluate(()=>window.viewer.camera.layers.disable(2)) // stamp markers
  await page.addStyleTag({content:'body>*:not(canvas){display:none!important}'})
  await page.waitForTimeout(800)
  await page.screenshot({path:`${out}/${name}.jpg`,type:'jpeg',quality:90}); console.log('shot',name)
}
await browser.close(); server.httpServer.close()
