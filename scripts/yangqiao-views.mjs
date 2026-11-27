import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {telemetryPreview} from './telemetry-preview.mjs'

const output=process.argv[2]??'captures/yangqiao'
await mkdir(output,{recursive:true})
const center=[-1062,342]
const views=[['plan',0,0,0,0],['south',-25,34,18,-26],['north',25,-36,-18,26],
  ['west-walk',-15,-10,-41,-25],['east-walk',16,11,50,24],['ronghu',-63,-12,0,0],
  ['shanhu',56,23,0,0],['water-west',-30,-16,28,16],['water-east',31,20,-28,-16]]
if(process.argv.includes('--photos')){
  views.length=0
  for(const [id,lat,lon,bearing] of [
    ['C12345D',25.276864,110.289658,246.46],['C35518',25.276067,110.288942,263.23],
    ['89188',25.276530,110.289472,35],['89216',25.276672,110.290194,178],
    ['glass',25.277462,110.288562,269],['north-road',25.277569,110.289795,214],
  ]){
    const dx=(lon-110.3)*111320*Math.cos(25.28*Math.PI/180)-center[0],dz=(25.28-lat)*110574-center[1]
    views.push([id,dx,dz,dx+50*Math.sin(bearing*Math.PI/180),dz-50*Math.cos(bearing*Math.PI/180)])
  }
}
const server=await preview({root:'web',configFile:'web/vite.config.ts',plugins:[telemetryPreview],preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:800,height:600}})
  await page.goto(`${server.resolvedUrls.local[0]}?verify&flow=0&radius=320&time=12`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0,null,{timeout:120000})
  for(const [name,dx,dz,tx,tz] of views){
    const x=center[0]+dx,z=center[1]+dz
    await page.evaluate(([x,z])=>window.viewer.camera.position.set(x,175,z),[x,z]);
    await page.waitForFunction(([x,z])=>{const {stream,manifest,stats}=window.viewer;return !stats.pending&&manifest.chunks.filter(t=>Math.hypot(t.x+128-x,t.z+128-z)<260).every(t=>stream.loaded.has(t))},[x,z],{timeout:90000})
    const level=await page.evaluate(async({x,z,name,tx,tz})=>{
      const viewer=window.viewer,{camera}=viewer
      const y=name==='plan'?440:name.startsWith('water')?149.7:(await viewer.photoSupport(x,z)).y+1.65
      camera.position.set(x,y,z);camera.up.set(0,name==='plan'?0:1,name==='plan'?-1:0)
      camera.lookAt(tx,name==='plan'?150:y-.6,tz);camera.updateProjectionMatrix()
      if(name==='plan'){
        camera.projectionMatrix.makeOrthographic(-200,200,150,-150,.1,1500)
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
      }
      return y
    },{x,z,name,tx:center[0]+tx,tz:center[1]+tz})
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await page.locator('canvas').first().screenshot({path:`${output}/${name}.png`});console.log(name,x,level,z)
  }
}finally{await browser?.close();await server.close()}
