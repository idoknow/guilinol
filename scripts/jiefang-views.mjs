import {mkdir} from 'node:fs/promises'
import {preview} from 'vite'
import {chromium} from 'playwright'

const output = process.argv[2] ?? 'captures/jiefang'
await mkdir(output, {recursive:true})
const views = [
  ['37', [-130,8.7,-49], [-118,7,-35], 18.2],
  ['41', [-79,8.9,-65], [5,2.4,0], 18.2],
  ['42', [-116,4.7,-47], [-113,7.5,-35], 18.2],
  ['43', [-116,2.65,8], [-116,2.9,-52], 18.4],
  ['49', [-114.8,2.85,41], [-90,4.3,9], 18.15],
  ['58', [10,7.6,-16], [-122,7.7,-16], 21],
  ['60', [0,7.5,-19], [-145,47,-714], 21],
  ['elevation', [0,3,85], [0,3,0], 14],
  ['aerial', [-220,150,160], [-35,4,0], 14],
]
const server = await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page = await browser.newPage({viewport:{width:960,height:600}})
  for (const [name,eye,target,hour] of views) {
    if(process.argv.length>3 && !process.argv.slice(3).includes(name))continue
    const portrait=['42','43','58'].includes(name)
    await page.setViewportSize(name==='elevation'?{width:1280,height:280}:portrait?{width:570,height:760}:{width:960,height:720})
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&radius=512&time=${hour}`)
    await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
    await page.addStyleTag({content:'body > :not(canvas) { visibility:hidden!important }'})
    await page.evaluate(([eye,target,name])=>{
      const {camera,manifest}=window.viewer
      const bridge=manifest.landmarks.find(item=>item.id==='jiefang_bridge')
      const angle=bridge.rotation*Math.PI/180
      const world=([x,y,z])=>[bridge.position[0]+x*Math.cos(angle)+z*Math.sin(angle),bridge.position[1]+y,bridge.position[2]-x*Math.sin(angle)+z*Math.cos(angle)]
      if(name==='60'){camera.fov=13;camera.updateProjectionMatrix()}
      if(name==='elevation'){
        camera.projectionMatrix.makeOrthographic(-151,151,33,-33,.1,900,camera.coordinateSystem)
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
      }
      camera.position.set(...world(eye))
      camera.lookAt(...world(target))
    },[eye,target,name])
    await page.waitForFunction(()=>{
      const {stream,stats,camera,manifest}=window.viewer
      return !stats.pending && [...stream.landmarks.keys()].some(item=>item.id==='jiefang_bridge') &&
        manifest.chunks.every(tile=>Math.hypot(tile.x+128-camera.position.x,tile.z+128-camera.position.z)>stream.radius||stream.loaded.has(tile))
    },null,{timeout:60000})
    await page.evaluate(()=>window.viewer.freeze())
    await page.screenshot({path:`${output}/${name}.png`})
  }
} finally {
  await browser?.close()
  await server.close()
}
