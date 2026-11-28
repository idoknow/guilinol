import {readFileSync} from 'node:fs'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const server=await preview({root:'web',configFile:'web/vite.config.ts',plugins:[{name:'qa-raycaster',configurePreviewServer(server){
  server.middlewares.use((req,res,next)=>{
    if(!['/qa/three.core.js','/qa/three.module.js'].includes(req.url))return next()
    res.setHeader('content-type','text/javascript');res.end(readFileSync('node_modules/three/build/'+req.url.split('/').pop()))
  })
}}],preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch(browserOptions());const page=await browser.newPage({viewport:{width:1280,height:800}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&flow=0&time=11`)
  await page.waitForFunction(()=>window.viewer?.camera,null,{timeout:120000})
  for(const [name,eye,target] of [['threshold',[-26366,177,8248],[-26354,177,8170]],['stand',[-25894,177,7644],[-25874,180,7640]]]){
    await page.evaluate(([eye,target])=>{const {camera}=window.viewer;camera.position.set(...eye);camera.lookAt(...target);camera.updateMatrixWorld()},[eye,target])
    await page.waitForTimeout(5000);await page.waitForFunction(()=>{const {stream}=window.viewer;return stream.scene.getObjectByName('Airport props')&&!stream.pending.size},null,{timeout:120000})
    console.log(name,await page.evaluate(async()=>{
      const {Raycaster,Vector2}=await import('/qa/three.module.js'),{camera,stream}=window.viewer
      const meshes=[];stream.scene.traverseVisible(node=>{if(node.isMesh&&node.layers.test(camera.layers))meshes.push(node)})
      return [[510,625],[580,640],[660,630],[740,630],[820,635],[880,628],[970,645],[950,600],[1150,680],[850,650],[900,725],[1150,750],[640,460],[650,520]].map(([px,py])=>{
        const ray=new Raycaster();ray.layers.mask=camera.layers.mask;ray.setFromCamera(new Vector2(px/640-1,1-py/400),camera)
        const hits=ray.intersectObjects(meshes,false).filter(hit=>hit.distance<300)
        return {pixel:[px,py],hits:hits.slice(0,3).map(({object,face,point})=>({mesh:object.name,material:object.material.name,attributes:Object.keys(object.geometry.attributes),xyz:point.toArray(),normalY:face?.normal.y,height:point.y}))}
      })
    }).then(JSON.stringify))
  }
}finally{await browser?.close();await server.close()}
