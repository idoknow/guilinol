import {createServer} from 'vite'
import {chromium} from 'playwright'
import {mkdir,realpath} from 'node:fs/promises'

const output=process.argv[2]??'captures/dams'
await mkdir(output,{recursive:true})
const server=await createServer({root:'web',configFile:'web/vite.config.ts',server:{host:'127.0.0.1',port:0,fs:{allow:[process.cwd(),await realpath('public/world')]}}})
await server.listen()
let browser
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:960,height:540}})
  await page.goto(server.resolvedUrls.local[0]+'?verify&mode=fly&time=15&radius=384',{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.viewer?.camera,null,{timeout:120000})
  for(const [name,eye,target] of [['mulong',[-146,162,-1590],[-190,145,-1577]],['hongqiao',[-1556,167,1098],[-1607,149,1062]]]){
    await page.evaluate(({eye,target})=>{const {camera,walk}=window.viewer;walk?.leave();camera.position.set(...eye);camera.lookAt(...target);camera.updateMatrixWorld()}, {eye,target})
    await page.waitForFunction(([east,,south])=>{
      const {stream,manifest,camera}=window.viewer
      const nearby=manifest.chunks.filter(tile=>Math.hypot(tile.x+128-east,tile.z+128-south)<300)
      return Math.abs(camera.position.x-east)<.01&&nearby.length>0&&nearby.every(tile=>stream.loaded.has(tile))&&!stream.pending.size
    },eye,{timeout:120000})
    await page.addStyleTag({content:'body > :not(canvas){display:none!important}'})
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await page.screenshot({path:`${output}/${name}.png`})
  }
} finally {await browser?.close();await server.close()}
