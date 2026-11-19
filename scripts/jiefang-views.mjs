import {mkdir} from 'node:fs/promises'
import {preview} from 'vite'
import {chromium} from 'playwright'

const output = process.argv[2] ?? 'captures/jiefang'
await mkdir(output, {recursive:true})
const views = [
  ['37', [-126,2.85,36.8], [-109.5,4.6,36.8], 19.1],
  ['41', [-96,3.4,-66.4], [-6,4.8,0], 19.1],
  ['42', [-115.8,2.83,21.8], [-110.3,5.5,31.5], 19.1],
  ['43', [-116.2,2.48,-3], [-109.4,3.95,36.8], 19.1],
  ['49', [-96,3.4,66.4], [-6,4.8,0], 19.1],
  ['58', [10,7.45,-18], [-125,6.65,-18], 20.3],
  ['60', [98,7.15,-20], [-145,30,-714], 20.3],
  ['elevation', [0,3,85], [0,3,0], 19.1],
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
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&radius=768&weather=${name==='60'?'clear':'mist'}&time=${hour}`)
    await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
    await page.addStyleTag({content:'body > :not(canvas) { visibility:hidden!important }'})
    await page.evaluate(([eye,target,name])=>{
      const {camera,manifest}=window.viewer
      const bridge=manifest.landmarks.find(item=>item.id==='jiefang_bridge')
      const angle=bridge.rotation*Math.PI/180
      const world=([x,y,z])=>[bridge.position[0]+x*Math.cos(angle)+z*Math.sin(angle),bridge.position[1]+y,bridge.position[2]-x*Math.sin(angle)+z*Math.cos(angle)]
      if(name==='60'){camera.fov=24;camera.updateProjectionMatrix()}
      if(name==='elevation'){
        camera.projectionMatrix.makeOrthographic(-151,151,33,-33,59,111,camera.coordinateSystem)
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
      }
      camera.layers.disable(2) // Collectible stamps are HUD markers in photo mode.
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
