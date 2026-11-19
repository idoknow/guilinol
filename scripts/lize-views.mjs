import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const shots = {
  yiwu_street: [
    ['1345',[-58,2.6,0],[20,2,0]], ['1346',[-45,2.8,-8.2],[-8,2,-8]],
    ['1347',[-34,2.7,-5.7],[-26,3.5,-10.5]], ['1350',[73,1.9,.3],[89,3.8,5.5]],
  ],
  lize_bridge: [
    ['1354',[74,12.4,9],[35,17.5,1]], ['1355',[54,12.3,9.6],[-22,14,8.4]],
    ['1356',[-51,8.4,-9.7],[31,12,-8.4]], ['1357',[22,11.6,10.4],[-40,11.8,9.1]],
    ['side',[15,13,100],[0,15,0]], ['night',[65,16,32],[2,16,0],21.5],
  ],
}
const output = 'captures/lize'
await mkdir(output,{recursive:true})
const server = await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:540,height:720}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&radius=256&time=12`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  await page.addStyleTag({content:'body > :not(canvas):not(script){visibility:hidden} canvas{visibility:visible}'})
  for(const [id,views] of Object.entries(shots))for(const [name,eye,target,hour=12] of views){
    await page.evaluate(([id,eye,target,hour])=>{
      const {manifest,camera,clock}=window.viewer,entry=manifest.landmarks.find(item=>item.id===id)
      const angle=entry.rotation*Math.PI/180
      const point=([x,y,z])=>[entry.position[0]+x*Math.cos(angle)+z*Math.sin(angle),entry.position[1]+y,entry.position[2]-x*Math.sin(angle)+z*Math.cos(angle)]
      camera.position.set(...point(eye));camera.lookAt(...point(target));clock.set(hour)
    },[id,eye,target,hour])
    await page.waitForFunction(id=>!window.viewer.stats.pending&&[...window.viewer.stream.landmarks].some(([entry,root])=>entry.id===id&&root.getObjectByName('lod0')?.visible),id,{timeout:90000})
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await page.locator('canvas').first().screenshot({path:`${output}/${name}.jpg`,quality:90})
  }
}finally{await browser?.close();await server.close()}
