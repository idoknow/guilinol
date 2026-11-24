import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {gzipSync, gunzipSync} from 'node:zlib'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const buildDir=process.argv[2]??'dist'
const data=JSON.parse(gunzipSync(await readFile(`${buildDir}/world/vehicles.bin`)))
const bikesOnly=gzipSync(JSON.stringify({...data,bicycles:[],cars:[]}))
const server=await preview({root:'web',configFile:'web/vite.config.ts',build:{outDir:`../${buildDir}`},preview:{host:'127.0.0.1',port:0}})
const browser=await chromium.launch(browserOptions())
try {
  const page=await browser.newPage({viewport:{width:640,height:360}})
  await page.route('**/world/vehicles.bin',route=>route.fulfill({body:bikesOnly}))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk&flow=0`)
  await page.waitForFunction(()=>window.viewer?.walk?.parked('bike').length>0,null,{timeout:90000})
  assert(await page.evaluate(()=>window.viewer.walkTo(-115,-798,0,'bench-parked')))
  const sample=await page.evaluate(async()=>{
    const {camera,stream,freeze}=window.viewer
    await freeze()
    const scene=stream.scene
    const fleet=scene.children.find(group=>group.children.some(cell=>cell.children.some(record=>record.userData.parkedModel)))
    if(!fleet)throw Error('No loaded parking cells')
    const isolated=new scene.constructor()
    for(const cell of fleet.children)for(const batch of cell.children)if(batch.isInstancedMesh && batch.count)isolated.add(batch.clone())
    const probe=camera.clone()
    probe.position.set(-115,178,-810);probe.lookAt(-112,149,-772);probe.updateMatrixWorld()
    let renderer
    const previous=scene.onBeforeRender
    scene.onBeforeRender=r=>{renderer=r}
    window.viewer.resume();await new Promise(requestAnimationFrame);await freeze();scene.onBeforeRender=previous
    const gl=renderer.getContext(), pixel=new Uint8Array(4), times=[]
    for(let frame=0;frame<84;frame++){
      const start=performance.now();renderer.render(isolated,probe);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel)
      if(frame>=20)times.push(performance.now()-start)
    }
    times.sort((left,right)=>left-right)
    return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,p50Ms:times[32],p95Ms:times[60]}
  })
  assert(sample.calls>0);console.log(buildDir,sample)
} finally {await browser.close();await server.close()}
