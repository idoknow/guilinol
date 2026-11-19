import {mkdir,readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const output=process.argv[2]??'captures/sections'
const report=JSON.parse(await readFile('public/world/street-report.json'))
function onRoad(name,forward=0,lateral=0,turn=0){
  const road=report.filter(item=>item.name===name).sort((a,b)=>b.length-a.length)[0]
  return [road.x-Math.sin(road.yaw)*forward+Math.cos(road.yaw)*lateral,road.z-Math.cos(road.yaw)*forward-Math.sin(road.yaw)*lateral,road.yaw+turn]
}
function yiwu(x,z){
  const angle=79.8*Math.PI/180
  return [(110.284794-110.300)*111320*Math.cos(25.28*Math.PI/180)+x*Math.cos(angle)+z*Math.sin(angle),-.00045*110574-x*Math.sin(angle)+z*Math.cos(angle),angle-Math.PI/2]
}
const views={
  '1345':yiwu(-58,0),'1346':yiwu(-45,-8.2),
  '1359-example':onRoad('三多路',12,7),'1360-example':onRoad('三多路',-22,-8,.55),
  '1380-example':onRoad('解放西路',8,8),'1382-example':onRoad('中山中路',56,8,-1.05),'1385-example':onRoad('解放东路',-22,6,.42),
  crossroads:[-891,-165,-1.2],zhongshan:onRoad('中山中路'),jiefang:onRoad('解放东路'),yiwu:yiwu(18,3),
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
    const success=await page.evaluate(async coords=>{const {walk}=window.viewer;walk.leave();return walk.enter(...coords,'screenshot')},view)
    if(!success){console.error('No walkable spawn',id);continue}
    await page.waitForFunction(()=>!window.viewer.stats.pending,null,{timeout:90000})
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await page.locator('canvas').first().screenshot({path:`${output}/${id}.jpg`,quality:88});console.log(id,view)
  }
}finally{await browser?.close();await server.close()}
