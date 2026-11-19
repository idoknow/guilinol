import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const out='captures/shore',server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  await mkdir(out,{recursive:true})
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:800,height:450}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk&time=15&radius=480`)
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:90000})
  for(const [name,x,z,eye,target] of [['shan',-832,544,[-807,163,519],[-855,146,569]],['rong',-1336,332,[-1310,160,359],[-1365,145,304]]]){
    assert(await page.evaluate(async({x,z,eye,target})=>{
      const {walk,camera}=window.viewer;window.restoreView?.();walk.leave()
      if(!await walk.enter(x,z,0,'shore-photo'))return false
      const look=camera.lookAt;camera.lookAt=function(){camera.position.set(...eye);look.call(camera,...target)};window.restoreView=()=>camera.lookAt=look
      walk.showFigure(false);return true
    },{x,z,eye,target}))
    await page.waitForFunction(()=>{const {stream,walk,manifest}=window.viewer;return manifest.chunks.every(tile=>Math.hypot(tile.x+128-walk.position.x,tile.z+128-walk.position.z)>stream.radius||stream.loaded.has(tile))},null,{timeout:90000})
    await page.screenshot({path:`${out}/${name}.png`})
  }
} finally {await browser?.close();await server.close()}
