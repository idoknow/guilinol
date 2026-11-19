import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const shots = {
  guanyi_bridge: [
    ['1361',[76,9.7,9],[45,10,15]], ['1362',[55,9.7,11],[49,12.3,17.3]],
    ['1363',[-14,9.3,17.5],[-5,5.5,112]], ['1364',[-39,7.7,-16],[28,9,-19]],
  ],
  guangxi_arts: [
    ['1365',[-4,1.8,-34],[-18,3,-42]], ['1366',[-4,1.8,-36],[23,3,-41]],
    ['1367',[-22,2.2,-34],[-6,4.2,-10]], ['1368',[-24,2.5,-24],[-9,4,-6]],
    ['1369',[19,2.4,-30],[9,4.2,-8]], ['1370',[-15,2.2,-43],[0,5,-18]],
    ['1371',[12,2.3,-38],[0,4,-21]], ['1372',[-12,2.6,-39],[0,3.1,-22]],
  ],
  yiwu_street: [
    ['1345',[-58,2.6,0],[20,2,0]], ['1346',[-45,2.8,-8.2],[-8,2,-8]],
    ['1347',[-34,2.7,-5.7],[-26,3.5,-10.5]], ['1350',[83,1.9,4.1],[89,2.75,5.5]],
  ],
  lize_bridge: [
    ['1354',[74,12.4,9],[35,17.5,1]], ['1355',[54,12.3,9.6],[-22,14,8.4]],
    ['1356',[-51,8.4,-9.7],[31,12,-8.4]], ['1357',[22,11.6,10.4],[-40,11.8,9.1]],
    ['1358',[13,11.3,-11.0],[18,4.1,-25]],
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
  page.on('pageerror',error=>console.error(error.message))
  page.on('console',message=>{if(message.type()==='error')console.error(message.text())})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&radius=256&time=12`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  await page.addStyleTag({content:'body > :not(canvas):not(script){visibility:hidden} canvas{visibility:visible}'})
  for(const [id,views] of Object.entries(shots))for(const [name,eye,target,hour=12] of views){
    if(process.env.LANDMARKS&&!process.env.LANDMARKS.split(',').includes(id))continue
    if(process.env.VIEWS&&!process.env.VIEWS.split(',').includes(name))continue
    await page.evaluate(([id,eye,target,hour])=>{
      const {manifest,camera,clock}=window.viewer,entry=manifest.landmarks.find(item=>item.id===id)
      const angle=entry.rotation*Math.PI/180
      const point=([x,y,z])=>[entry.position[0]+x*Math.cos(angle)+z*Math.sin(angle),entry.position[1]+y,entry.position[2]-x*Math.sin(angle)+z*Math.cos(angle)]
      camera.near=.15;camera.updateProjectionMatrix()
      camera.position.set(...point(eye));camera.lookAt(...point(target));clock.set(hour)
    },[id,eye,target,hour])
    await page.waitForFunction(id=>!window.viewer.stats.pending&&[...window.viewer.stream.landmarks].some(([entry,root])=>entry.id===id&&root.getObjectByName('lod0')?.visible),id,{timeout:90000})
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await page.evaluate(name=>{for(const mesh of window.viewer.stream.forest.batches)if(mesh)mesh.layers.set(['1367','1368','1369','1370','1371','1372'].includes(name)?31:0)},name)
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await page.locator('canvas').first().screenshot({path:`${output}/${name}.jpg`,quality:90})
    if(process.env.VISIBILITY_CHECK){
      const subject=['1358','1363'].includes(name)?'guihu_moorings':id
      const toggle=async visible=>page.evaluate(([subject,visible])=>{
        const pair=[...window.viewer.stream.landmarks].find(([entry])=>entry.id===subject)
        if(!pair)throw Error(`Missing ${subject}`)
        pair[1].visible=visible
        return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
      },[subject,visible])
      await toggle(false)
      await page.locator('canvas').first().screenshot({path:`${output}/${name}-without.jpg`,quality:90})
      await toggle(true)
    }
  }
}finally{await browser?.close();await server.close()}
