import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const output=process.argv[2]??'captures/sections'
const views={
  '1345-翊武路':[-1539.5,13.5,2.8,24],'1346-翊武路':[-1539.5,-17.2,23.5,14],
  '1359-三多路':[-1228.3,-34.7,112,24],'1360-三多路':[-1254.3,-61.3,80,24],
  '1380-中山中路':[-780,-553,8.9,24],'1382-中山中路':[-773,-602.3,69,24],'1385-解放东路':[-560.2,-98.7,260,24],
  crossroads:[-891,-165,69,24],zhongshan:[-789.5,-548.2,9,24],jiefang:[-583,-98.4,284,24],yiwu:[-1524.5,-66.9,10,24],
}
await mkdir(output,{recursive:true})
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:720,height:480}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk&radius=256&time=12`)
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:90000})
  await page.addStyleTag({content:'body > :not(canvas):not(script){visibility:hidden} canvas{visibility:visible}'})
  for(const [id,view] of Object.entries(views)){
    await page.evaluate(async ([east,south,bearing,focal])=>{
      const {walk,camera}=window.viewer,angle=bearing*Math.PI/180
      walk.leave();if(!await walk.enter(east,south,-angle,'screenshot'))throw Error('No walkable spawn')
      const height=walk.probe().foot+1.5;walk.leave();camera.position.set(east,height,south)
      camera.near=.1;camera.fov=2*Math.atan(18/(focal*camera.aspect))*180/Math.PI;camera.updateProjectionMatrix()
      camera.lookAt(east+Math.sin(angle),height,south-Math.cos(angle))
    },view)
    await page.waitForFunction(()=>{const {stats,camera,stream,manifest}=window.viewer;return !stats.pending&&manifest.chunks.every(tile=>Math.hypot(tile.x+128-camera.position.x,tile.z+128-camera.position.z)>stream.radius||stream.loaded.has(tile))},null,{timeout:90000})
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await page.screenshot({path:`${output}/${id}.jpg`,quality:88,timeout:90000});console.log(id,view)
  }
}finally{await browser?.close();await server.close()}
