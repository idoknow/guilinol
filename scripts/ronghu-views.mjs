import {chromium} from 'playwright'
import {preview} from 'vite'
import {mkdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'

const views={
  1299:[21,3.1,-37,18,1,-24],1300:[58,5.8,-117,39,8.1,-115],1301:[43,5.8,-91,30,3,-56],
  1302:[28,3.8,-49,44,4.8,-90],1303:[31,5.6,-80,15.5,7,-82],1304:[-5,3.3,-22,0,5,-4],
  1305:[10,3.1,-23,-2,4,-4],1306:[20,2,13,14,2,4],1307:[34,3.9,-55,17,7.4,-51],
  1308:[4,2,-18,4,4,-5],1309:[14,2,12,14,2.1,4],1310:[-6,2,38,-22,7,20],
  1311:[-22,2,35,-22,6,20],1312:[-37,2,29,-21,7,20],1313:[0,2,33,0,6.4,5],
  1314:[-3,2,27,0,6.2,5],1315:[19,2,23,5,6,6],1316:[21,2,13,6,6,5],
  1317:[71,1,36,89,-1,54],1318:[84,.5,47,105,-1,55],1319:[83,1.2,65,106,-.4,64],
  1320:[105,1,57,108,-1,65],1321:[86,0,77,100,-.55,81],1322:[94,2,111,111,2,126],
  1323:[82,3,151,100,3,137],1324:[119,2.5,147,125,2,134],1325:[119,2,151,132,1,151],
  1326:[115,2,142,143,2,142],1327:[131,2,143,143,3,133],1328:[165,2.4,134,304,4.1,161],
  1330:[64,0,98,31,0,82],1331:[48,-.6,62,32,1.5,82],1332:[44,-1.1,59,33,1.4,80],
  1334:[-80,1.5,-16,-40,.3,-16],1335:[-68,1.7,-13,-45,1,-16],1336:[-62,2,-5,-46,2,-10],
  1337:[-22,3.9,-9,-22,7.6,-34],1338:[-19,3.9,-16,-22,8,-34],1339:[-34,4.1,-14,-23,7.8,-34],
  1340:[13,4,-19,-8,7,-37],1341:[1,4,-18,-6,3,-27],1342:[-97,.8,-25,-116,2.4,-24],
  1343:[-83,1,-49,-68,3,-62],
}
const out=process.env.CAPTURES??'captures/rock'
await mkdir(out,{recursive:true})
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:768,height:512}})
  await page.route('**/__survey_core.mjs',route=>route.fulfill({path:'node_modules/three/build/three.core.js',contentType:'text/javascript'}))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&radius=256&time=12`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  for(const [number,coords] of Object.entries(views)){
    if(process.env.PHOTO && process.env.PHOTO!==number)continue
    if(process.env.RESUME_CAPTURES && existsSync(`${out}/${number}.jpg`))continue
    const id=Number(number)<=1316?'gunanmen':'ronghu'
    await page.evaluate(([id,coords,number])=>{
      const {manifest,camera}=window.viewer
      const origin=manifest.landmarks.find(entry=>entry.id===id).position
      const position=coords.map((value,index)=>value+origin[index%3]);camera.position.set(...position.slice(0,3));camera.lookAt(...position.slice(3))
      camera.fov=number==='1328'?16:55;camera.updateProjectionMatrix()
    },[id,coords,number])
    await page.waitForFunction(id=>{const {stream,stats}=window.viewer;return !stats.pending&&[...stream.landmarks].some(([entry,root])=>entry.id===id&&root.getObjectByName('lod0')?.visible)},id,{timeout:60000})
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    if(['1300','1303','1307','1313','1315','1328','1337','1339','1342'].includes(number)){
      const hit=await page.evaluate(async([id,number])=>{
        const {Raycaster,Vector2,Vector3}=await import('/__survey_core.mjs')
        const {stream,camera}=window.viewer
        const [entry,root]=[...stream.landmarks].find(([entry])=>entry.id===id)
        const meshes=[];root.parent.traverseVisible(node=>{if(node.isMesh&&!node.isSprite&&node.material?.depthWrite!==false)meshes.push(node)})
        const ray=new Raycaster();ray.setFromCamera(new Vector2(0,0),camera)
        const survey=()=>ray.intersectObjects(meshes,false).slice(0,1).map(({object,point,distance})=>({mesh:object.parent?.name,material:object.material?.name,distance:Math.round(distance),local:point.toArray().map((value,index)=>Math.round(value-entry.position[index]))}))[0]
        if(number!=='1328')return survey()
        return [[302,4.45,160],[458.5,24,196.5]].map(local=>{
          const point=new Vector3(...entry.position).add(new Vector3(...local)).project(camera)
          ray.setFromCamera(point,camera);return {ndc:[point.x,point.y],first:survey()}
        })
      },[id,number])
      console.log(number,JSON.stringify(hit))
    }
    await page.screenshot({path:`${out}/${number}.jpg`,quality:89,timeout:120000})
  }
}finally{await browser?.close();await server.close()}
