import {chromium} from 'playwright'
import {preview} from 'vite'
import {mkdir} from 'node:fs/promises'

const views={
  1299:[25,3,-34,15,1,-23],1300:[53,11,-113,37,12,-115],1301:[52,8,-104,27,4,-50],
  1302:[26,4,-46,49,8,-111],1303:[32,7,-79,14,9,-86],1304:[-5,2,-22,0,5,-4],
  1305:[10,2,-23,-2,4,-4],1306:[20,2,13,14,2,4],1307:[34,4,-43,13,8,-51],
  1308:[4,2,-18,4,4,-5],1309:[14,2,12,14,2.1,4],1310:[-6,2,38,-22,7,20],
  1311:[-22,2,35,-22,6,20],1312:[-37,2,29,-21,7,20],1313:[0,2,33,0,6.4,5],
  1314:[-3,2,27,0,6.2,5],1315:[19,2,23,5,6,6],1316:[21,2,13,6,6,5],
  1317:[71,1,36,89,-1,54],1318:[84,.5,47,105,-1,55],1319:[83,1.2,65,106,-.4,64],
  1320:[105,1,57,108,-1,65],1321:[99,1,72,101,-.4,89],1322:[94,2,111,111,2,126],
  1323:[82,3,151,100,3,137],1324:[119,2.5,147,125,2,134],1325:[119,2,151,132,1,151],
  1326:[115,2,142,143,2,142],1327:[131,2,143,143,3,133],1328:[170,3,151,305,3,161],
  1330:[64,0,98,31,0,82],1331:[48,-.6,62,32,1.5,82],1332:[44,-1.1,59,33,1.4,80],
  1334:[-80,1.5,-16,-40,.3,-16],1335:[-68,1.7,-13,-45,1,-16],1336:[-62,2,-5,-46,2,-10],
  1337:[-22,4,-6,-22,7,-36],1338:[-18,4,-10,-22,7,-36],1339:[-47,4,-12,-23,7,-36],
  1340:[13,4,-19,-8,7,-37],1341:[1,4,-18,-6,3,-27],1342:[-93,1,-27,-116,2,-24],
  1343:[-83,1,-49,-68,3,-62],
}
const out='captures/rock'
await mkdir(out,{recursive:true})
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:768,height:512}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&radius=256&time=12`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  for(const [number,coords] of Object.entries(views)){
    const id=Number(number)<=1316?'gunanmen':'ronghu'
    await page.evaluate(([id,coords])=>{
      const {manifest,camera}=window.viewer
      const origin=manifest.landmarks.find(entry=>entry.id===id).position
      const position=coords.map((value,index)=>value+origin[index%3]);camera.position.set(...position.slice(0,3));camera.lookAt(...position.slice(3))
    },[id,coords])
    await page.waitForFunction(id=>{const {stream,stats}=window.viewer;return !stats.pending&&[...stream.landmarks].some(([entry,root])=>entry.id===id&&root.getObjectByName('lod0')?.visible)},id,{timeout:60000})
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await page.locator('canvas').first().screenshot({path:`${out}/${number}.jpg`,quality:89})
  }
}finally{await browser?.close();await server.close()}
