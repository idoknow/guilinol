import {mkdir,readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {sectionCamera} from './section-camera.mjs'

const output=process.argv[2]??'captures/sections'
const locations=JSON.parse(await readFile(new URL('../docs/refs/rock/photo-locations.json',import.meta.url),'utf8'))
// Acceptance-only offsets: 1299 ESE 3.22 m to the corner; 1365 SSW 13.49 m to the
// sidewalk edge; 1380 SSW 9.26 m to the nearest cycle lane; 1301 WSW 2.79 m
// beside the banyan pit; 1384 NNE 5.36 m to the sidewalk. Original EXIF is unchanged.
const photos=[1299,1301,1345,1346,1359,1360,1365,1380,1381,1382,1384,1385].map(id=>{
  const key=`IMG_${id}.jpg`
  const {x,z,heading,headingRef,focal35}=sectionCamera(key,locations[key])
  if(headingRef!=='T'||![x,z,heading,focal35].every(Number.isFinite)||focal35<=0)throw Error(`Invalid camera for IMG_${id}`)
  return [`IMG_${id}`,[x,z,heading,focal35]]
})
const views={
  ...Object.fromEntries(photos),
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
    if(process.argv.length>3&&!process.argv.slice(3).includes(id))continue
    await page.evaluate(([east,south])=>{
      const {walk,camera}=window.viewer
      if(walk.active)walk.leave()
      camera.position.set(east,200,south)
    },view)
    await page.waitForFunction(()=>{const {stats,camera,stream,manifest}=window.viewer;return !stats.pending&&manifest.chunks.every(tile=>Math.hypot(tile.x+128-camera.position.x,tile.z+128-camera.position.z)>stream.radius||(stream.loaded.has(tile)&&stream.forest.loaded.has(tile)))},null,{timeout:90000})
    await page.evaluate(([east,south,bearing,focal])=>{
      const {camera,stream}=window.viewer,angle=bearing*Math.PI/180
      const [tile,data]=[...stream.loaded].find(([tile])=>east>=tile.x&&east<tile.x+256&&south>=tile.z&&south<tile.z+256)??[]
      if(!data)throw Error('No ground mesh at photo coordinates')
      const geometry=data.groundMesh.geometry,segments=geometry.parameters.widthSegments,stride=segments+1
      const col=(east-tile.x)*segments/256,row=(south-tile.z)*segments/256,index=Math.floor(row)*stride+Math.floor(col)
      const u=col%1,v=row%1,[a,b,c,d]=[0,1,stride,stride+1].map(offset=>geometry.attributes.position.getY(index+offset))
      const height=1.5+(u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v))
      camera.position.set(east,height,south)
      camera.near=.1;camera.fov=2*Math.atan(18/(focal*camera.aspect))*180/Math.PI;camera.updateProjectionMatrix()
      camera.lookAt(east+Math.sin(angle),height,south-Math.cos(angle))
    },view)
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await page.screenshot({path:`${output}/${id}.jpg`,quality:88,timeout:90000});console.log(id,view)
  }
}finally{await browser?.close();await server.close()}
