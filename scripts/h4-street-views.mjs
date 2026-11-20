import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {preview} from 'vite'
import {chromium} from 'playwright'

const schools=JSON.parse(await readFile('pipeline/landmarks.json','utf8')).filter(school=>['glmu_dongcheng','glut_primary','tianjiabing','chenshan_primary','lijiang_primary','longyin_primary'].includes(school.id))
const atlas=JSON.parse(gunzipSync(await readFile('public/world/atlas.bin')))
const cameras=JSON.parse(await readFile(process.argv[2]??'captures/h4-cameras.json','utf8'))
const folder='docs/layout/schools'
await mkdir(folder,{recursive:true})
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:800,height:480}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&radius=256&time=12`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  const readings=[]
  for(const school of schools){
    if(!atlas.places.some(place=>place.n===school.name))throw Error(`Missing search result: ${school.id}`)
    for(const [view,eye,look] of cameras[school.id]){
      const frame=await page.evaluate(({eye,look})=>{const {camera,stats}=window.viewer;camera.position.set(...eye);camera.lookAt(...look);camera.updateMatrixWorld();return stats.frame},{eye,look})
      await page.waitForFunction(({frame,eye})=>{const {stream,stats}=window.viewer;return stats.frame>frame+6&&!stream.pending.size&&[...stream.loaded.keys()].some(tile=>eye[0]>=tile.x&&eye[0]<tile.x+256&&eye[2]>=tile.z&&eye[2]<tile.z+256)},{frame,eye},{timeout:90000})
      await page.locator('canvas').first().screenshot({path:`${folder}/${school.id}-${view}.jpg`,quality:82})
      readings.push({school:school.id,view,...await page.evaluate(()=>({calls:window.viewer.stats.calls,triangles:window.viewer.stats.triangles}))})
    }
  }
  await writeFile('captures/h4-render.json',JSON.stringify(readings,null,2)+'\n')
}finally{await browser?.close();await server.close()}
